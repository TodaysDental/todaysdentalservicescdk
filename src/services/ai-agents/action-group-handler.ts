/**
 * Action Group Handler for Bedrock Agents
 * 
 * This Lambda is invoked by Bedrock Agents when they need to call OpenDental tools.
 * It receives the action group invocation request and executes the appropriate tool.
 * 
 * SECURITY FIX: Clinic credentials are now loaded from SSM Parameter Store at runtime
 * instead of being bundled in the deployment package.
 */

import axios from 'axios';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// ========================================================================
// CONFIGURATION
// ========================================================================

const CONFIG = {
  OPEN_DENTAL_API_URL: 'https://api.opendental.com/api/v1',
  API_TIMEOUT: 15000,
  MAX_API_RETRIES: 3,
  // Circuit breaker configuration
  CIRCUIT_BREAKER_THRESHOLD: 5,      // Failures before opening circuit
  CIRCUIT_BREAKER_RESET_MS: 60000,   // Time before attempting to close circuit (1 min)
  // NOTE: Bedrock agent flows can make multiple OpenDental calls per user message (patient lookup,
  // slot lookup, provider lookup, etc.). Keep this high enough to avoid false positives while still
  // protecting OpenDental from bursts. The searchPatients tool now checks rate limit once for its
  // multi-attempt fuzzy search, so this limit applies more to concurrent sessions.
  RATE_LIMIT_REQUESTS_PER_SEC: 500,   // Max requests per second per clinic
};

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CLINICS_TABLE = process.env.CLINICS_TABLE || 'Clinics';
const CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || 'ClinicSecrets';
const INSURANCE_PLANS_TABLE = process.env.INSURANCE_PLANS_TABLE || 'TodaysDentalInsightsInsurancePlanSyncN1-InsurancePlans';
const FEE_SCHEDULES_TABLE = process.env.FEE_SCHEDULES_TABLE || 'TodaysDentalInsightsFeeScheduleSyncN1-FeeSchedules';
const APPT_TYPES_TABLE = process.env.APPT_TYPES_TABLE || 'TodaysDentalInsightsPatientPortalApptTypesN1-ApptTypes';

// Callback table configuration for failed appointment bookings and patient searches
const CALLBACK_TABLE_PREFIX = process.env.CALLBACK_TABLE_PREFIX || 'todaysdentalinsights-callback-';
const DEFAULT_CALLBACK_TABLE = process.env.DEFAULT_CALLBACK_TABLE || 'todaysdentalinsights-callback-default';

// ========================================================================
// CIRCUIT BREAKER & RATE LIMITING (DynamoDB-backed for distributed state)
// ========================================================================

/**
 * Circuit breaker state stored in DynamoDB for distributed consistency.
 * 
 * ARCHITECTURE FIX: Previously used in-memory Map which:
 * 1. Lost state on Lambda cold starts
 * 2. Had inconsistent state across Lambda instances
 * 3. Allowed bypassing rate limits by routing to different instances
 * 
 * Now uses DynamoDB with atomic counters for reliable distributed state.
 */
interface CircuitState {
  clinicId: string;        // PK
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  windowStart: number;     // Rate limit window start
  requestCount: number;    // Requests in current window
  ttl: number;
}

// Local cache for performance (short TTL, falls back to DynamoDB)
const circuitCache: Map<string, { state: CircuitState; timestamp: number }> = new Map();
const CIRCUIT_CACHE_TTL_MS = 1000; // 1 second cache to reduce DynamoDB calls

// Circuit breaker table name
const CIRCUIT_BREAKER_TABLE = process.env.CIRCUIT_BREAKER_TABLE || 'AiAgents-CircuitBreaker';

/**
 * Get circuit state from DynamoDB with local caching
 */
async function getCircuitState(clinicId: string): Promise<CircuitState> {
  const now = Date.now();

  // Check local cache first
  const cached = circuitCache.get(clinicId);
  if (cached && now - cached.timestamp < CIRCUIT_CACHE_TTL_MS) {
    return cached.state;
  }

  try {
    const response = await docClient.send(new GetCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: { clinicId },
    }));

    if (response.Item) {
      const state = response.Item as CircuitState;
      circuitCache.set(clinicId, { state, timestamp: now });
      return state;
    }
  } catch (error) {
    console.warn(`[CircuitBreaker] Failed to get state for ${clinicId}:`, error);
  }

  // Return default state
  const defaultState: CircuitState = {
    clinicId,
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    windowStart: now,
    requestCount: 0,
    ttl: Math.floor(now / 1000) + 3600, // 1 hour TTL
  };

  return defaultState;
}

/**
 * Check circuit breaker and rate limit - uses atomic DynamoDB operations
 * 
 * SECURITY FIX: Fails CLOSED instead of open on DynamoDB errors.
 * Previously, if DynamoDB was unavailable, unlimited requests were allowed.
 * Now we use an in-memory fallback counter to prevent abuse.
 */

// In-memory fallback rate limiter (used when DynamoDB is unavailable)
// This is a last resort - not distributed, but prevents complete bypass
const fallbackRateLimiter: Map<string, { count: number; windowStart: number }> = new Map();
const FALLBACK_MAX_REQUESTS_PER_WINDOW = 5; // More conservative limit for fallback mode
const FALLBACK_WINDOW_MS = 1000;

async function checkCircuitBreaker(clinicId: string): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();

  let state: CircuitState;
  let usingFallback = false;

  try {
    state = await getCircuitState(clinicId);
  } catch (error) {
    // FIX: DynamoDB is unavailable - use in-memory fallback rate limiter
    console.warn(`[CircuitBreaker] DynamoDB unavailable, using fallback rate limiter for ${clinicId}:`, error);
    usingFallback = true;

    // Get or create fallback state
    let fallback = fallbackRateLimiter.get(clinicId);
    if (!fallback || now - fallback.windowStart > FALLBACK_WINDOW_MS) {
      fallback = { count: 0, windowStart: now };
    }

    fallback.count++;
    fallbackRateLimiter.set(clinicId, fallback);

    if (fallback.count > FALLBACK_MAX_REQUESTS_PER_WINDOW) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded (fallback mode). Please try again in a moment.'
      };
    }

    return { allowed: true };
  }

  // Check if circuit is open
  if (state.isOpen) {
    // Check if reset timeout has passed
    if (now - state.lastFailure > CONFIG.CIRCUIT_BREAKER_RESET_MS) {
      // Half-open: reset failures atomically
      try {
        await docClient.send(new UpdateCommand({
          TableName: CIRCUIT_BREAKER_TABLE,
          Key: { clinicId },
          UpdateExpression: 'SET isOpen = :false, failures = :zero',
          ExpressionAttributeValues: { ':false': false, ':zero': 0 },
        }));
        console.log(`[CircuitBreaker] Circuit half-open for clinic ${clinicId}, allowing test request`);
      } catch (error) {
        // FIX: If we can't reset the circuit, don't allow the request
        console.error(`[CircuitBreaker] Failed to reset circuit for ${clinicId}:`, error);
        return { allowed: false, reason: 'Unable to check circuit breaker status. Please try again.' };
      }
    } else {
      return { allowed: false, reason: 'Circuit breaker is open due to repeated failures. Try again later.' };
    }
  }

  // Rate limiting with atomic counter
  const windowStart = state.windowStart;
  const isNewWindow = now - windowStart > 1000;

  if (isNewWindow) {
    // New window - reset counter
    try {
      await docClient.send(new UpdateCommand({
        TableName: CIRCUIT_BREAKER_TABLE,
        Key: { clinicId },
        UpdateExpression: 'SET windowStart = :now, requestCount = :one, #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':now': now,
          ':one': 1,
          ':ttl': Math.floor(now / 1000) + 3600,
        },
      }));
      // FIX: Invalidate local cache after resetting window to prevent stale state in subsequent calls
      circuitCache.delete(clinicId);
    } catch (error) {
      // FIX: Failed to reset window - use fallback limiter
      console.warn(`[CircuitBreaker] Failed to reset rate limit window, using fallback:`, error);
      let fallback = fallbackRateLimiter.get(clinicId);
      if (!fallback || now - fallback.windowStart > FALLBACK_WINDOW_MS) {
        fallback = { count: 1, windowStart: now };
      } else {
        fallback.count++;
      }
      fallbackRateLimiter.set(clinicId, fallback);

      if (fallback.count > FALLBACK_MAX_REQUESTS_PER_WINDOW) {
        return { allowed: false, reason: 'Rate limit exceeded (fallback mode). Please try again.' };
      }
    }
    return { allowed: true };
  }

  // Same window - increment counter atomically
  if (state.requestCount >= CONFIG.RATE_LIMIT_REQUESTS_PER_SEC) {
    return { allowed: false, reason: 'Rate limit exceeded. Please slow down requests.' };
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: { clinicId },
      UpdateExpression: 'SET requestCount = if_not_exists(requestCount, :zero) + :one',
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
    }));
    // FIX: Invalidate local cache after incrementing to keep cache in sync
    circuitCache.delete(clinicId);
  } catch (error) {
    // FIX: Failed to increment - use in-memory tracking as backup
    console.warn(`[CircuitBreaker] Failed to increment counter, tracking in memory:`, error);
    let fallback = fallbackRateLimiter.get(clinicId);
    if (!fallback || now - fallback.windowStart > FALLBACK_WINDOW_MS) {
      fallback = { count: 1, windowStart: now };
    } else {
      fallback.count++;
    }
    fallbackRateLimiter.set(clinicId, fallback);

    // Still allow this request (we've tracked it in memory), but future ones may be blocked
    if (fallback.count > FALLBACK_MAX_REQUESTS_PER_WINDOW) {
      return { allowed: false, reason: 'Rate limit exceeded (fallback mode). Please try again.' };
    }
  }

  return { allowed: true };
}

/**
 * Record successful request - resets failure count
 */
async function recordSuccess(clinicId: string): Promise<void> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: { clinicId },
      UpdateExpression: 'SET failures = :zero, isOpen = :false',
      ExpressionAttributeValues: { ':zero': 0, ':false': false },
    }));

    // Invalidate cache
    circuitCache.delete(clinicId);
  } catch (error) {
    console.warn(`[CircuitBreaker] Failed to record success for ${clinicId}:`, error);
  }
}

/**
 * Record failed request - increments failure count and may open circuit
 */
async function recordFailure(clinicId: string): Promise<void> {
  const now = Date.now();

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: { clinicId },
      UpdateExpression: 'SET failures = if_not_exists(failures, :zero) + :one, lastFailure = :now, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': now,
        ':ttl': Math.floor(now / 1000) + 3600,
      },
      ReturnValues: 'UPDATED_NEW',
    }));

    const newFailures = result.Attributes?.failures || 1;

    // Open circuit if threshold exceeded
    if (newFailures >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      await docClient.send(new UpdateCommand({
        TableName: CIRCUIT_BREAKER_TABLE,
        Key: { clinicId },
        UpdateExpression: 'SET isOpen = :true',
        ExpressionAttributeValues: { ':true': true },
      }));
      console.warn(`[CircuitBreaker] Circuit OPEN for clinic ${clinicId} after ${newFailures} failures`);
    }

    // Invalidate cache
    circuitCache.delete(clinicId);
  } catch (error) {
    console.warn(`[CircuitBreaker] Failed to record failure for ${clinicId}:`, error);
  }
}

// ========================================================================
// CALLBACK HELPERS (Saves to Callback Table on various failures)
// ========================================================================

interface CallbackRecordDetails {
  clinicId: string;
  patientName?: string;
  patientPhone?: string;
  patientEmail?: string;
  patNum?: number;
  message: string;
  module: string;
  notes: string;
  source: 'ai-agent' | 'patient-portal';
  searchCriteria?: any;
}

/**
 * Save a callback record for clinic staff follow-up
 * This is used when AI operations fail (appointment booking or patient search)
 */
async function saveCallbackRecord(details: CallbackRecordDetails): Promise<void> {
  const tableName = `${CALLBACK_TABLE_PREFIX}${details.clinicId}`;
  const now = new Date().toISOString();
  const requestId = uuidv4();

  const callbackItem: Record<string, any> = {
    RequestID: requestId,
    name: details.patientName || `Patient ${details.patNum || 'Unknown'}`,
    phone: details.patientPhone || 'Not provided',
    email: details.patientEmail || undefined,
    message: details.message,
    module: details.module,
    clinicId: details.clinicId,
    calledBack: 'NO',
    notes: details.notes,
    createdAt: now,
    updatedAt: now,
    source: details.source,
  };

  // Add optional fields if provided
  if (details.patNum) {
    callbackItem.patNum = details.patNum;
  }
  if (details.searchCriteria) {
    callbackItem.searchCriteria = JSON.stringify(details.searchCriteria);
  }

  try {
    // Try clinic-specific table first
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: callbackItem,
    }));
    console.log(`[Callback] Saved callback ${requestId} for clinic ${details.clinicId}`);
  } catch (error: any) {
    // Fallback to default table if clinic-specific table doesn't exist
    if (error?.name === 'ResourceNotFoundException') {
      try {
        await docClient.send(new PutCommand({
          TableName: DEFAULT_CALLBACK_TABLE,
          Item: callbackItem,
        }));
        console.log(`[Callback] Saved callback ${requestId} to default table`);
      } catch (fallbackError) {
        console.error('[Callback] Failed to save to default callback table:', fallbackError);
      }
    } else {
      console.error('[Callback] Failed to save callback record:', error);
    }
  }
}

interface AppointmentFailureDetails {
  clinicId: string;
  patientName?: string;
  patientPhone?: string;
  patientEmail?: string;
  patNum?: number;
  requestedDate?: string;
  reason?: string;
  errorMessage: string;
  source: 'ai-agent' | 'patient-portal';
}

/**
 * Save a failed appointment booking as a callback request
 * This allows clinic staff to follow up with patients when AI scheduling fails
 */
async function saveAppointmentFailureAsCallback(details: AppointmentFailureDetails): Promise<void> {
  await saveCallbackRecord({
    clinicId: details.clinicId,
    patientName: details.patientName,
    patientPhone: details.patientPhone,
    patientEmail: details.patientEmail,
    patNum: details.patNum,
    message: `Appointment booking failed. Requested: ${details.requestedDate || 'Not specified'}. Reason: ${details.reason || 'General appointment'}. Error: ${details.errorMessage}`,
    module: 'Operations',
    notes: `Auto-created from failed ${details.source} appointment booking`,
    source: details.source,
  });
}

interface PatientSearchFailureDetails {
  clinicId: string;
  searchName?: string;
  searchPhone?: string;
  searchBirthdate?: string;
  searchCriteria: any;
  failureReason: string;
  source: 'ai-agent' | 'patient-portal';
}

/**
 * Save a failed patient search as a callback request
 * This allows clinic staff to follow up with callers when patient lookup fails
 */
async function savePatientSearchFailureAsCallback(details: PatientSearchFailureDetails): Promise<void> {
  await saveCallbackRecord({
    clinicId: details.clinicId,
    patientName: details.searchName || 'Unknown',
    patientPhone: details.searchPhone || 'Not provided',
    message: `Patient search failed. ${details.failureReason}. Search criteria: Name: ${details.searchName || 'N/A'}, DOB: ${details.searchBirthdate || 'N/A'}`,
    module: 'Operations',
    notes: `Auto-created from failed ${details.source} patient search - needs manual lookup`,
    source: details.source,
    searchCriteria: details.searchCriteria,
  });
}

// Default operatory mapping
const DEFAULT_OPERATORY_MAP: Record<string, number> = {
  ONLINE_BOOKING_EXAM: 1,
  ONLINE_BOOKING_MAJOR: 2,
  ONLINE_BOOKING_MINOR: 3,
  EXAM: 1,
  MAJOR: 2,
  MINOR: 3,
};

// ========================================================================
// TYPES
// ========================================================================

interface ClinicConfig {
  clinicId: string;
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  clinicEmail: string;
  clinicFax?: string;
  developerKey: string;
  customerKey: string;
}

// ========================================================================
// CLINIC CONFIG CACHE (Runtime loading from SSM/DynamoDB)
// ========================================================================

interface CachedClinicConfig {
  config: ClinicConfig;
  timestamp: number;
}

const clinicConfigCache: Map<string, CachedClinicConfig> = new Map();
const CLINIC_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get clinic configuration from DynamoDB (Clinics table from ChimeStack)
 * 
 * This reads clinic metadata AND credentials from the existing Clinics table,
 * avoiding the need for separate SSM parameters.
 * 
 * SECURITY NOTE: Credentials are stored in DynamoDB (encrypted at rest) 
 * rather than bundled in the Lambda deployment package.
 */
async function getClinicConfigSecure(clinicId: string): Promise<ClinicConfig | undefined> {
  // Check cache first
  const cached = clinicConfigCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < CLINIC_CONFIG_CACHE_TTL_MS) {
    return cached.config;
  }

  try {
    // Get clinic data from DynamoDB (includes credentials)
    const clinicResponse = await docClient.send(new GetCommand({
      TableName: CLINICS_TABLE,
      Key: { clinicId },
    }));

    let clinicData = clinicResponse.Item;
    let developerKey: string | undefined;
    let customerKey: string | undefined;

    if (clinicData) {
      // Check for credentials in Clinics table (primary location)
      developerKey = clinicData.developerKey || clinicData.openDentalDeveloperKey;
      customerKey = clinicData.customerKey || clinicData.openDentalCustomerKey;
    }

    // If credentials not found in Clinics table, try ClinicSecrets table
    if (!developerKey || !customerKey) {
      console.log(`[getClinicConfig] Credentials not in Clinics table for ${clinicId}, checking ClinicSecrets table...`);

      const secretsResponse = await docClient.send(new GetCommand({
        TableName: CLINIC_SECRETS_TABLE,
        Key: { clinicId },
      }));

      if (secretsResponse.Item) {
        developerKey = developerKey || secretsResponse.Item.openDentalDeveloperKey || secretsResponse.Item.developerKey;
        customerKey = customerKey || secretsResponse.Item.openDentalCustomerKey || secretsResponse.Item.customerKey;
        console.log(`[getClinicConfig] Found credentials in ClinicSecrets table for ${clinicId}`);
      }
    }

    // If still no credentials, return undefined
    if (!developerKey || !customerKey) {
      console.error(`[getClinicConfig] Clinic ${clinicId} missing OpenDental credentials in both Clinics and ClinicSecrets tables`);
      return undefined;
    }

    // If no clinicData from Clinics table, create minimal data
    if (!clinicData) {
      clinicData = { clinicId };
    }

    const config: ClinicConfig = {
      clinicId,
      clinicName: clinicData.clinicName || clinicData.name || '',
      clinicAddress: clinicData.clinicAddress || clinicData.address || '',
      clinicPhone: clinicData.clinicPhone || clinicData.phoneNumber || '',
      clinicEmail: clinicData.clinicEmail || clinicData.email || '',
      clinicFax: clinicData.clinicFax || clinicData.fax,
      developerKey,
      customerKey,
    };

    // Cache the config
    clinicConfigCache.set(clinicId, { config, timestamp: Date.now() });

    return config;
  } catch (error: any) {
    console.error(`[getClinicConfig] Error loading clinic config for ${clinicId}:`, error.message);
    return undefined;
  }
}

interface ActionGroupEvent {
  messageVersion: string;
  agent: {
    name: string;
    id: string;
    alias: string;
    version: string;
  };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters: Array<{
    name: string;
    type: string;
    value: string;
  }>;
  requestBody?: {
    content: {
      [contentType: string]: {
        properties: Array<{
          name: string;
          type: string;
          value: string;
        }>;
      };
    };
  };
  sessionAttributes: Record<string, string>;
  promptSessionAttributes: Record<string, string>;
}

interface ActionGroupResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: {
      [contentType: string]: {
        body: string;
      };
    };
    sessionAttributes?: Record<string, string>;
    promptSessionAttributes?: Record<string, string>;
  };
}

// ========================================================================
// OPENDENTAL API CLIENT (with Circuit Breaker & Rate Limiting)
// ========================================================================

class OpenDentalClient {
  private client: any;
  private clinicId: string;

  constructor(clinicId: string, developerKey: string, customerKey: string) {
    this.clinicId = clinicId;
    this.client = axios.create({
      baseURL: CONFIG.OPEN_DENTAL_API_URL,
      headers: {
        Authorization: `ODFHIR ${developerKey}/${customerKey}`,
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.API_TIMEOUT,
    });
  }

  getClinicId(): string {
    return this.clinicId;
  }

  async request(method: string, endpoint: string, { params, data, skipRateLimit }: any = {}) {
    // Check circuit breaker and rate limit before making request (unless skipped for internal retries)
    if (!skipRateLimit) {
      const circuitCheck = await checkCircuitBreaker(this.clinicId);
      if (!circuitCheck.allowed) {
        throw new Error(circuitCheck.reason || 'Request blocked by circuit breaker');
      }
    }

    for (let attempt = 1; attempt <= CONFIG.MAX_API_RETRIES; attempt++) {
      try {
        const config: any = { method, url: endpoint };
        if (params)
          config.params = Object.fromEntries(
            Object.entries(params).filter(([, v]) => v != null && v !== '')
          );
        if (data) config.data = data;
        const response = await this.client.request(config);

        // Success - record it for circuit breaker
        // FIX: Await the async operation to ensure state is persisted before Lambda terminates
        await recordSuccess(this.clinicId);

        return response.data || { status: 'success', statusCode: response.status };
      } catch (error: any) {
        const status = error.response?.status;

        // Check for rate limit response with Retry-After header
        if (status === 429) {
          const retryAfter = error.response?.headers?.['retry-after'];
          const waitTime = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : 1000 * Math.pow(2, attempt);

          console.warn(`[OpenDental] Rate limited for clinic ${this.clinicId}, waiting ${waitTime}ms`);

          if (attempt < CONFIG.MAX_API_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        }

        const isRetryable =
          status >= 500 || status === 429 || ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code);

        if (!isRetryable || attempt === CONFIG.MAX_API_RETRIES) {
          // Record failure for circuit breaker
          // FIX: Await the async operation to ensure state is persisted before Lambda terminates
          await recordFailure(this.clinicId);

          // Log useful debugging info WITHOUT leaking keys or PII (only field names + response body)
          try {
            const responseData = error.response?.data;
            const responseText =
              typeof responseData === 'string'
                ? responseData
                : responseData
                  ? JSON.stringify(responseData)
                  : undefined;

            const headers = error.response?.headers || {};
            const safeHeaders: Record<string, any> = {
              'content-type': headers['content-type'],
              'x-request-id': headers['x-request-id'] || headers['x-amzn-requestid'] || headers['x-amz-request-id'],
              date: headers['date'],
            };

            console.error('[OpenDental] Request failed', {
              clinicId: this.clinicId,
              method,
              endpoint,
              status,
              request: {
                paramsKeys: params ? Object.keys(params) : [],
                dataKeys: data ? Object.keys(data) : [],
              },
              response: {
                headers: safeHeaders,
                data: responseText ? responseText.slice(0, 2000) : undefined,
              },
            });
          } catch (logError) {
            console.error('[OpenDental] Failed to log error details:', logError);
          }

          const responseData = error.response?.data;
          const detail =
            (typeof responseData === 'string' && responseData.trim()) ||
            responseData?.message ||
            responseData?.Message ||
            responseData?.error ||
            responseData?.Error;

          throw new Error(
            detail
              ? `OpenDental API call failed (HTTP ${status}): ${detail}`
              : `OpenDental API call failed: ${error.message}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

function getOperatoryNumber(opInput: any): number | null {
  if (opInput == null) return null;
  if (typeof opInput === 'number' && !Number.isNaN(opInput)) return opInput;
  if (typeof opInput === 'string') {
    const n = parseInt(opInput, 10);
    if (!Number.isNaN(n)) return n;
    const key = opInput.trim().toUpperCase();
    if (DEFAULT_OPERATORY_MAP[key]) return DEFAULT_OPERATORY_MAP[key];
  }
  return null;
}

/**
 * Resolve operatory number from clinic-specific appointment types.
 * This function first tries to parse as a number, then looks up the OpName
 * in the clinic's ApptTypes DynamoDB table to get the actual operatory number.
 * 
 * This fixes the "Op is invalid" error that occurs when the agent passes
 * OpName like "ONLINE_BOOKING_MINOR" which maps to hardcoded values that
 * don't exist for specific clinics.
 * 
 * @param opInput - The operatory input (number, numeric string, or OpName)
 * @param clinicId - The clinic ID to look up appointment types
 * @param isNewPatient - Whether this is a new patient (affects which operatory to use)
 * @returns The resolved operatory number, or null if not found
 */
async function resolveOperatoryNumber(
  opInput: any,
  clinicId: string,
  isNewPatient: boolean = false
): Promise<number | null> {
  // First try direct number parsing
  if (opInput != null) {
    if (typeof opInput === 'number' && !Number.isNaN(opInput)) return opInput;
    if (typeof opInput === 'string') {
      const n = parseInt(opInput, 10);
      if (!Number.isNaN(n)) return n;
    }
  }

  // If we have a string OpName, try to look up the actual operatory from clinic's appointment types
  if (typeof opInput === 'string' && clinicId) {
    const opName = opInput.trim().toUpperCase();
    console.log(`[resolveOperatoryNumber] Looking up OpName "${opName}" for clinic ${clinicId}`);

    try {
      // Query all appointment types for this clinic
      const result = await docClient.send(new QueryCommand({
        TableName: APPT_TYPES_TABLE,
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': clinicId },
      }));

      const appointmentTypes = result.Items || [];

      if (appointmentTypes.length === 0) {
        console.warn(`[resolveOperatoryNumber] No appointment types found for clinic ${clinicId}, falling back to defaults`);
        return DEFAULT_OPERATORY_MAP[opName] || null;
      }

      // Try to find a matching appointment type by OpName
      const matchingType = appointmentTypes.find((apt: any) => {
        const aptOpName = (apt.opName || '').toUpperCase();
        const aptLabel = (apt.label || '').toUpperCase();

        // Match by opName (e.g., "ONLINE_BOOKING_MINOR")
        if (aptOpName === opName || aptOpName.includes(opName) || opName.includes(aptOpName)) {
          return true;
        }

        // Match by common keywords in the OpName
        if (opName.includes('MINOR') && aptLabel.includes('EMERGENCY') || aptLabel.includes('OTHER')) {
          return true;
        }
        if (opName.includes('EXAM') && (aptLabel.includes('NEW PATIENT') || aptLabel.includes('EXAM'))) {
          return true;
        }
        if (opName.includes('MAJOR') && aptLabel.includes('TREATMENT')) {
          return true;
        }

        return false;
      });

      if (matchingType && matchingType.opNum) {
        console.log(`[resolveOperatoryNumber] Found matching OpNum ${matchingType.opNum} for OpName "${opName}" (label: ${matchingType.label})`);
        return matchingType.opNum;
      }

      // If no exact match, try to select based on new patient status
      const newPatientType = appointmentTypes.find((apt: any) =>
        (apt.label || '').toLowerCase().includes('new patient')
      );
      const existingPatientType = appointmentTypes.find((apt: any) =>
        (apt.label || '').toLowerCase().includes('existing patient') ||
        (apt.label || '').toLowerCase().includes('emergency') ||
        (apt.label || '').toLowerCase().includes('other')
      );

      const selectedType = isNewPatient ? newPatientType : existingPatientType;
      if (selectedType && selectedType.opNum) {
        console.log(`[resolveOperatoryNumber] Selected OpNum ${selectedType.opNum} based on ${isNewPatient ? 'new' : 'existing'} patient status (label: ${selectedType.label})`);
        return selectedType.opNum;
      }

      // Last resort: use the first available appointment type
      if (appointmentTypes.length > 0 && appointmentTypes[0].opNum) {
        console.log(`[resolveOperatoryNumber] Using first available OpNum ${appointmentTypes[0].opNum} (label: ${appointmentTypes[0].label})`);
        return appointmentTypes[0].opNum;
      }

      console.warn(`[resolveOperatoryNumber] Could not find matching operatory for OpName "${opName}" in clinic ${clinicId}`);
    } catch (error: any) {
      console.error(`[resolveOperatoryNumber] Error looking up appointment types: ${error.message}`);
    }

    // Fall back to default mapping only if DynamoDB lookup fails
    return DEFAULT_OPERATORY_MAP[opName] || null;
  }

  return null;
}

function parseParameters(event: ActionGroupEvent): Record<string, any> {
  const params: Record<string, any> = {};

  // Parse URL parameters
  if (event.parameters) {
    for (const param of event.parameters) {
      params[param.name] = parseValue(param.value, param.type);
    }
  }

  // Parse request body properties
  if (event.requestBody?.content?.['application/json']?.properties) {
    for (const prop of event.requestBody.content['application/json'].properties) {
      params[prop.name] = parseValue(prop.value, prop.type);
    }
  }

  return params;
}

/**
 * Normalize date format to YYYY-MM-DD for OpenDental API
 * Handles common formats: MM/DD/YYYY, MM-DD-YYYY, YYYY/MM/DD, DD/MM/YYYY, etc.
 */
function normalizeDateFormat(dateStr: string): string {
  if (!dateStr) return dateStr;

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try to parse and normalize
  let normalized = dateStr.trim();

  // Handle numeric date formats: MM/DD/YYYY, DD/MM/YYYY, MM-DD-YYYY, DD-MM-YYYY
  // Detect format by checking if first number > 12 (must be day, so it's DD/MM/YYYY)
  const numericFormat = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (numericFormat) {
    const [, first, second, year] = numericFormat;
    const firstNum = parseInt(first, 10);
    const secondNum = parseInt(second, 10);

    let month: string, day: string;

    if (firstNum > 12) {
      // First number > 12, so it must be day (DD/MM/YYYY - European format)
      day = first;
      month = second;
      console.log(`[normalizeDateFormat] Detected European format (DD/MM/YYYY): ${dateStr}`);
    } else if (secondNum > 12) {
      // Second number > 12, so it must be day (MM/DD/YYYY - US format)
      month = first;
      day = second;
      console.log(`[normalizeDateFormat] Detected US format (MM/DD/YYYY): ${dateStr}`);
    } else {
      // Both could be valid - assume US format (MM/DD/YYYY) as default
      month = first;
      day = second;
      console.log(`[normalizeDateFormat] Ambiguous format, assuming US (MM/DD/YYYY): ${dateStr}`);
    }

    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Handle YYYY/MM/DD format
  const isoSlash = normalized.match(/^(\d{4})[\/](\d{1,2})[\/](\d{1,2})$/);
  if (isoSlash) {
    const [, year, month, day] = isoSlash;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Handle written dates like "July 11, 1984", "11 July 1984", "4th Oct 1975", "Nov 21st 1999"
  const monthNames: Record<string, string> = {
    'january': '01', 'jan': '01',
    'february': '02', 'feb': '02',
    'march': '03', 'mar': '03',
    'april': '04', 'apr': '04',
    'may': '05',
    'june': '06', 'jun': '06',
    'july': '07', 'jul': '07',
    'august': '08', 'aug': '08',
    'september': '09', 'sep': '09', 'sept': '09',
    'october': '10', 'oct': '10',
    'november': '11', 'nov': '11',
    'december': '12', 'dec': '12',
  };

  // Helper to strip ordinal suffix from day (1st, 2nd, 3rd, 4th, 21st, 22nd, 23rd, etc.)
  const stripOrdinal = (dayStr: string): string => {
    return dayStr.replace(/(st|nd|rd|th)$/i, '');
  };

  // "July 11, 1984" or "Jul 11 1984" or "Nov 21st 1999" or "July 4th, 1976"
  const writtenFormat1 = normalized.match(/^([a-zA-Z]+)\s+(\d{1,2}(?:st|nd|rd|th)?),?\s+(\d{4})$/i);
  if (writtenFormat1) {
    const [, monthName, dayWithOrdinal, year] = writtenFormat1;
    const day = stripOrdinal(dayWithOrdinal);
    const month = monthNames[monthName.toLowerCase()];
    if (month) {
      console.log(`[normalizeDateFormat] Parsed written format (Month Day Year): ${dateStr}`);
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }

  // "11 July 1984" or "4th Oct 1975" or "21st November 1999"
  const writtenFormat2 = normalized.match(/^(\d{1,2}(?:st|nd|rd|th)?)\s+([a-zA-Z]+)\s+(\d{4})$/i);
  if (writtenFormat2) {
    const [, dayWithOrdinal, monthName, year] = writtenFormat2;
    const day = stripOrdinal(dayWithOrdinal);
    const month = monthNames[monthName.toLowerCase()];
    if (month) {
      console.log(`[normalizeDateFormat] Parsed written format (Day Month Year): ${dateStr}`);
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }

  // "4th of October 1975" or "21st of Nov 1999"
  const writtenFormat3 = normalized.match(/^(\d{1,2}(?:st|nd|rd|th)?)\s+of\s+([a-zA-Z]+)\s+(\d{4})$/i);
  if (writtenFormat3) {
    const [, dayWithOrdinal, monthName, year] = writtenFormat3;
    const day = stripOrdinal(dayWithOrdinal);
    const month = monthNames[monthName.toLowerCase()];
    if (month) {
      console.log(`[normalizeDateFormat] Parsed written format (Day of Month Year): ${dateStr}`);
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }

  // Try native Date parsing as fallback
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      // Only use if year is reasonable (1900-2100)
      if (year >= 1900 && year <= 2100) {
        return `${year}-${month}-${day}`;
      }
    }
  } catch {
    // Ignore parsing errors
  }

  console.warn(`[normalizeDateFormat] Could not normalize date: ${dateStr}`);
  return dateStr; // Return as-is if we can't parse
}

function parseValue(value: string, type: string): any {
  switch (type.toLowerCase()) {
    case 'integer':
    case 'number':
      return parseInt(value, 10);
    case 'boolean':
      return value.toLowerCase() === 'true';
    default:
      return value;
  }
}

/**
 * @deprecated Use getClinicConfigSecure instead - this function is kept for reference only
 */
function getClinicConfig(_clinicId: string): ClinicConfig | undefined {
  // Legacy function - credentials should no longer be bundled
  console.error('[getClinicConfig] DEPRECATED: Use getClinicConfigSecure instead');
  return undefined;
}

// ========================================================================
// TOOL HANDLERS
// ========================================================================

async function getSignalods(
  params: Record<string, any>,
  odClient: OpenDentalClient
): Promise<{ statusCode: number; body: any }> {
  const { SigDateTime } = params;

  if (!SigDateTime) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'SigDateTime is required to get signalods',
      },
    };
  }

  try {
    const signalods = await odClient.request('GET', 'signalods', {
      params: { SigDateTime }
    });

    return {
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        data: signalods,
      },
    };
  } catch (error) {
    console.error('[getSignalods] Error:', error);
    return {
      statusCode: 500,
      body: {
        status: 'FAILURE',
        message: `Failed to get signalods: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    };
  }
}

async function handleTool(
  toolName: string,
  params: Record<string, any>,
  odClient: OpenDentalClient,
  sessionAttributes: Record<string, string>
): Promise<{ statusCode: number; body: any; updatedSessionAttributes?: Record<string, string> }> {
  const updatedSessionAttributes = { ...sessionAttributes };

  try {
    switch (toolName) {
      // ===== CLINIC INFORMATION TOOL (No OpenDental API needed) =====
      case 'getClinicInfo': {
        // Get clinic information from DynamoDB Clinics table
        // This tool is used for answering general questions about the clinic
        const clinicId = sessionAttributes.clinicId || params.clinicId;

        if (!clinicId) {
          return {
            statusCode: 400,
            body: {
              status: 'FAILURE',
              message: 'No clinic context available. Please specify clinicId.',
            },
          };
        }

        try {
          const clinicResponse = await docClient.send(new GetCommand({
            TableName: CLINICS_TABLE,
            Key: { clinicId },
          }));

          if (!clinicResponse.Item) {
            return {
              statusCode: 404,
              body: {
                status: 'FAILURE',
                message: `Clinic ${clinicId} not found`,
              },
            };
          }

          const clinic = clinicResponse.Item;

          // Build a comprehensive clinic info response for the AI
          // EXCLUDE sensitive fields like API keys, passwords, etc.
          const clinicInfo = {
            // Basic Information
            clinicId: clinic.clinicId,
            clinicName: clinic.clinicName || clinic.name,

            // Location & Address
            clinicAddress: clinic.clinicAddress || clinic.address,
            clinicCity: clinic.clinicCity || clinic.city,
            clinicState: clinic.clinicState || clinic.state,
            clinicZipCode: clinic.clinicZipCode || clinic.CliniczipCode || clinic.zipCode,

            // Contact Information
            clinicPhone: clinic.clinicPhone || clinic.phoneNumber,
            clinicEmail: clinic.clinicEmail || clinic.email,
            clinicFax: clinic.clinicFax || clinic.fax,

            // Online Presence
            websiteLink: clinic.websiteLink || clinic.wwwUrl,
            mapsUrl: clinic.mapsUrl,
            scheduleUrl: clinic.scheduleUrl,
            logoUrl: clinic.logoUrl,

            // Timezone
            timezone: clinic.timezone,
          };

          // Create a natural language response for the AI
          let directAnswer = `=== CLINIC INFORMATION ===\n\n`;
          directAnswer += `📍 CLINIC NAME: ${clinicInfo.clinicName}\n\n`;

          directAnswer += `📍 LOCATION:\n`;
          directAnswer += `• Address: ${clinicInfo.clinicAddress}\n`;
          directAnswer += `• City: ${clinicInfo.clinicCity}\n`;
          directAnswer += `• State: ${clinicInfo.clinicState}\n`;
          if (clinicInfo.clinicZipCode) directAnswer += `• Zip Code: ${clinicInfo.clinicZipCode}\n`;
          if (clinicInfo.mapsUrl) directAnswer += `• Google Maps: ${clinicInfo.mapsUrl}\n`;
          directAnswer += `\n`;

          directAnswer += `📞 CONTACT:\n`;
          directAnswer += `• Phone: ${clinicInfo.clinicPhone}\n`;
          if (clinicInfo.clinicEmail) directAnswer += `• Email: ${clinicInfo.clinicEmail}\n`;
          if (clinicInfo.clinicFax) directAnswer += `• Fax: ${clinicInfo.clinicFax}\n`;
          directAnswer += `\n`;

          directAnswer += `🌐 ONLINE:\n`;
          if (clinicInfo.websiteLink) directAnswer += `• Website: ${clinicInfo.websiteLink}\n`;
          if (clinicInfo.scheduleUrl) directAnswer += `• Online Scheduling: ${clinicInfo.scheduleUrl}\n`;
          directAnswer += `\n`;

          directAnswer += `ℹ️ GENERAL INFO:\n`;
          directAnswer += `• This is a standalone professional dental office\n`;
          directAnswer += `• The clinic is wheelchair accessible with free parking\n`;
          directAnswer += `• Handicap-accessible parking spaces are available\n`;
          directAnswer += `• The clinic follows CDC safety and hygiene guidelines\n`;
          directAnswer += `• All dentists are licensed in ${clinicInfo.clinicState}\n`;
          directAnswer += `• We welcome patients of all ages including children\n`;
          directAnswer += `• Staff speak English; Spanish may be available - call to confirm\n`;

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: `Retrieved clinic information for ${clinicInfo.clinicName}`,
              directAnswer,
              data: clinicInfo,
            },
          };
        } catch (error: any) {
          console.error('[getClinicInfo] Error:', error);
          return {
            statusCode: 500,
            body: {
              status: 'FAILURE',
              message: `Failed to get clinic info: ${error.message || 'Unknown error'}`,
            },
          };
        }
      }

      // ===== PATIENT TOOLS =====
      case 'getPatientByPatNum': {
        const data = await odClient.request('GET', `patients/${params.PatNum}`);
        return { statusCode: 200, body: { status: 'SUCCESS', data } };
      }

      case 'searchPatients': {
        const isPublicRequest = sessionAttributes?.isPublicRequest === 'true';

        const cleanName = (value: any): string => {
          if (!value || typeof value !== 'string') return '';
          return value
            .trim()
            .replace(/\s+/g, ' ')
            // keep common name punctuation
            .replace(/[^a-zA-Z\s'\-]/g, '')
            .trim();
        };

        const normalizeForCompare = (value: string): string =>
          (value || '').toUpperCase().replace(/[^A-Z]/g, '');

        const levenshteinDistance = (a: string, b: string): number => {
          if (a === b) return 0;
          if (!a) return b.length;
          if (!b) return a.length;
          const m = a.length;
          const n = b.length;
          const dp = new Array(n + 1);
          for (let j = 0; j <= n; j++) dp[j] = j;
          for (let i = 1; i <= m; i++) {
            let prev = dp[0];
            dp[0] = i;
            for (let j = 1; j <= n; j++) {
              const temp = dp[j];
              const cost = a[i - 1] === b[j - 1] ? 0 : 1;
              dp[j] = Math.min(
                dp[j] + 1,        // deletion
                dp[j - 1] + 1,    // insertion
                prev + cost       // substitution
              );
              prev = temp;
            }
          }
          return dp[n];
        };

        const similarity = (a: string, b: string): number => {
          if (!a || !b) return 0;
          const dist = levenshteinDistance(a, b);
          const maxLen = Math.max(a.length, b.length);
          return maxLen === 0 ? 1 : 1 - dist / maxLen;
        };

        const toSafePatient = (p: any) => ({
          PatNum: p.PatNum,
          LName: p.LName,
          FName: p.FName,
          Birthdate: p.Birthdate,
          DateFirstVisit: p.DateFirstVisit,
        });

        // Normalize birthdate to YYYY-MM-DD format (OpenDental API requirement)
        let normalizedBirthdate = params.Birthdate;
        if (normalizedBirthdate) {
          normalizedBirthdate = normalizeDateFormat(normalizedBirthdate);
          console.log(`[searchPatients] Normalized birthdate: ${params.Birthdate} → ${normalizedBirthdate}`);
        }

        const providedFName = cleanName(params.FName);
        const providedLName = cleanName(params.LName);

        const buildSearchParams = (p: { LName?: string; FName?: string; Birthdate?: string }) => {
          const out: any = {};
          if (p.LName) out.LName = p.LName;
          if (p.FName) out.FName = p.FName;
          if (p.Birthdate) out.Birthdate = p.Birthdate;
          return out;
        };

        // Check rate limit ONCE before the multi-attempt search loop
        // This prevents consuming multiple rate limit tokens for a single user request
        const circuitCheck = await checkCircuitBreaker(odClient.getClinicId());
        if (!circuitCheck.allowed) {
          throw new Error(circuitCheck.reason || 'Request blocked by circuit breaker');
        }

        const doSearch = async (label: string, p: { LName?: string; FName?: string; Birthdate?: string }) => {
          const searchParams = buildSearchParams(p);
          console.log(`[searchPatients] Attempt "${label}" with params:`, JSON.stringify(searchParams));
          // Skip rate limit check for internal retry calls (already checked once above)
          const resp = await odClient.request('GET', 'patients/Simple', { params: searchParams, skipRateLimit: true });
          const items = Array.isArray(resp) ? resp : resp?.items ?? [];
          return items as any[];
        };

        // Try progressively more flexible lookups while still requiring high-confidence name match.
        // Goal: tolerate swapped first/last name and minor typos (e.g., "Emani" vs "Eamani").
        const attempts: Array<{ label: string; p: { LName?: string; FName?: string; Birthdate?: string } }> = [];
        if (providedLName || providedFName || normalizedBirthdate) {
          attempts.push({ label: 'exact', p: { LName: providedLName, FName: providedFName, Birthdate: normalizedBirthdate } });
        }
        if (providedLName && providedFName) {
          attempts.push({ label: 'swapped', p: { LName: providedFName, FName: providedLName, Birthdate: normalizedBirthdate } });
        }
        // Relax one field at a time (still using DOB), then score candidates by similarity.
        if (normalizedBirthdate && providedFName) {
          attempts.push({ label: 'fname+dob', p: { FName: providedFName, Birthdate: normalizedBirthdate } });
        }
        if (normalizedBirthdate && providedLName) {
          attempts.push({ label: 'lname+dob', p: { LName: providedLName, Birthdate: normalizedBirthdate } });
        }
        // Also try swapped single-field searches (handles swapped names with typos)
        // e.g., user says "eamani, sumil" meaning "Sunil Eamani" - lname+dob with swapped name would find it
        if (normalizedBirthdate && providedLName && providedFName) {
          attempts.push({ label: 'swapped_lname+dob', p: { LName: providedFName, Birthdate: normalizedBirthdate } });
          attempts.push({ label: 'swapped_fname+dob', p: { FName: providedLName, Birthdate: normalizedBirthdate } });
        }

        let patients: any[] = [];
        let usedAttempt = 'exact';

        try {
          for (const a of attempts) {
            patients = await doSearch(a.label, a.p);
            usedAttempt = a.label;
            if (patients.length > 0) break;
          }
        } catch (searchError: any) {
          // OpenDental API failure - save callback for staff follow-up
          console.error(`[searchPatients] OpenDental API failed:`, searchError);

          const clinicId = sessionAttributes.clinicId || odClient.getClinicId();
          const searchName = `${providedFName} ${providedLName}`.trim();
          const callerPhone = sessionAttributes.callerPhone || sessionAttributes.PatientPhone || params.WirelessPhone;

          await savePatientSearchFailureAsCallback({
            clinicId,
            searchName: searchName || undefined,
            searchPhone: callerPhone,
            searchBirthdate: normalizedBirthdate,
            searchCriteria: { FName: providedFName, LName: providedLName, Birthdate: normalizedBirthdate },
            failureReason: `OpenDental API error: ${searchError?.message || 'Unknown error'}`,
            source: 'ai-agent',
          });

          return {
            statusCode: searchError?.response?.status || 500,
            body: {
              status: 'FAILURE',
              message: 'Unable to search patients - please try again or call the office',
              callbackCreated: true,
            },
            updatedSessionAttributes,
          };
        }

        if (patients.length === 0) {
          return {
            statusCode: 404,
            body: {
              status: 'FAILURE',
              data: { items: [] },
              message: 'No matching patient found',
            },
            updatedSessionAttributes,
          };
        }

        // Choose best candidate by name similarity (handles typos + swapped names)
        const pf = normalizeForCompare(providedFName);
        const pl = normalizeForCompare(providedLName);

        const scored = patients
          .filter((p) => !normalizedBirthdate || p?.Birthdate === normalizedBirthdate)
          .map((p) => {
            const cf = normalizeForCompare(String(p?.FName || ''));
            const cl = normalizeForCompare(String(p?.LName || ''));

            const directScore = pf && pl
              ? (similarity(pf, cf) * 0.5 + similarity(pl, cl) * 0.5)
              : (pf ? similarity(pf, cf) : similarity(pl, cl));

            const swappedScore = pf && pl
              ? (similarity(pf, cl) * 0.5 + similarity(pl, cf) * 0.5)
              : 0;

            return { p, score: Math.max(directScore, swappedScore) };
          })
          .sort((a, b) => b.score - a.score);

        const best = scored[0];
        const second = scored[1];

        // If we had to relax the search, require a stronger similarity threshold to avoid wrong matches.
        const minScore = usedAttempt === 'exact' ? 0.75 : 0.85;
        const isConfident =
          !!best &&
          best.score >= minScore &&
          (!second || best.score - second.score >= 0.08);

        if (!isConfident) {
          // Avoid leaking lists of patient records to public visitors when ambiguous.
          return {
            statusCode: 404,
            body: {
              status: 'FAILURE',
              data: { items: isPublicRequest ? [] : patients.slice(0, 5).map(toSafePatient) },
              message: isPublicRequest
                ? 'I found more than one possible match. Please double-check the spelling of your name, or call the office and we\'ll help you.'
                : `Multiple matches found (${patients.length}). Refine search.`,
            },
            updatedSessionAttributes,
          };
        }

        const patient = best.p;
        updatedSessionAttributes.PatNum = patient.PatNum.toString();
        updatedSessionAttributes.FName = patient.FName;
        updatedSessionAttributes.LName = patient.LName;
        updatedSessionAttributes.Birthdate = patient.Birthdate;
        updatedSessionAttributes.IsNewPatient = (patient.DateFirstVisit === '0001-01-01').toString();

        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            data: { items: [toSafePatient(patient)] },
            message: 'Found 1 patient(s)',
          },
          updatedSessionAttributes,
        };
      }

      case 'createPatient': {
        let phoneNumber = params.WirelessPhone;
        if (phoneNumber) {
          const parsedPhone = parsePhoneNumberFromString(phoneNumber, 'US');
          if (parsedPhone?.isValid()) {
            phoneNumber = parsedPhone.formatNational();
          }
        }

        // Normalize birthdate to YYYY-MM-DD format
        const normalizedBirthdate = params.Birthdate ? normalizeDateFormat(params.Birthdate) : undefined;

        // NOTE: OpenDental returns 400 if TxtMsgOk='Yes' but WirelessPhone is empty.
        // Only set TxtMsgOk when we have a valid wireless phone number.
        const createData: any = {
          LName: params.LName,
          FName: params.FName,
          Birthdate: normalizedBirthdate,
        };
        if (phoneNumber) {
          createData.WirelessPhone = phoneNumber;
          createData.TxtMsgOk = 'Yes';
        }
        const newPatient = await odClient.request('POST', 'patients', { data: createData });

        updatedSessionAttributes.PatNum = newPatient.PatNum.toString();
        updatedSessionAttributes.FName = newPatient.FName;
        updatedSessionAttributes.LName = newPatient.LName;
        updatedSessionAttributes.IsNewPatient = 'true';

        return {
          statusCode: 201,
          body: { status: 'SUCCESS', data: newPatient },
          updatedSessionAttributes,
        };
      }

      // ===== PROCEDURE TOOLS =====
      case 'getProcedureLogs': {
        const procParams: any = { PatNum: params.PatNum };
        // Always filter by ProcStatus if provided, default to TP for efficiency
        if (params.ProcStatus) procParams.ProcStatus = params.ProcStatus;
        const resp = await odClient.request('GET', 'procedurelogs', { params: procParams });
        const allProcedures = Array.isArray(resp) ? resp : resp?.items ?? [];

        // OPTIMIZATION: Filter to treatment-planned (TP) by default for efficiency
        // This prevents returning thousands of completed procedures
        const filterStatus = params.ProcStatus || 'TP';
        const procedures = allProcedures.filter((p: any) => p.ProcStatus === filterStatus);

        // OPTIMIZATION: Return only essential fields to reduce payload size for Bedrock
        const minimalProcedures = procedures.slice(0, 50).map((p: any) => ({
          ProcNum: p.ProcNum,
          ProcCode: p.ProcCode || p.CodeNum,
          descript: p.descript || p.Descript,
          ProcStatus: p.ProcStatus,
          ProcDate: p.ProcDate,
          ToothNum: p.ToothNum,
          Surf: p.Surf,
          ProcFee: p.ProcFee,
        }));

        if (procedures.length > 0) {
          updatedSessionAttributes.ProcedureDescripts = procedures.slice(0, 20).map((p: any) => p.descript || p.Descript).join(', ');
          updatedSessionAttributes.ProcNums = JSON.stringify(procedures.slice(0, 20).map((p: any) => p.ProcNum));
        }

        // Build a concise summary for the AI
        let directAnswer = '';
        if (procedures.length > 0) {
          directAnswer = `=== PROCEDURE LOGS (${filterStatus}) ===\n`;
          directAnswer += `Found ${procedures.length} procedure(s):\n\n`;
          const uniqueDescripts = [...new Set(procedures.map((p: any) => p.descript || p.Descript))];
          uniqueDescripts.slice(0, 15).forEach((desc, i) => {
            const count = procedures.filter((p: any) => (p.descript || p.Descript) === desc).length;
            directAnswer += `${i + 1}. ${desc}${count > 1 ? ` (x${count})` : ''}\n`;
          });
          if (uniqueDescripts.length > 15) {
            directAnswer += `... and ${uniqueDescripts.length - 15} more unique procedures\n`;
          }
        }

        return {
          statusCode: procedures.length > 0 ? 200 : 404,
          body: {
            status: procedures.length > 0 ? 'SUCCESS' : 'FAILURE',
            directAnswer,
            data: minimalProcedures,
            totalCount: procedures.length,
            message: procedures.length > 0
              ? `Found ${procedures.length} ${filterStatus} procedure(s)`
              : `No ${filterStatus} procedures found`,
          },
          updatedSessionAttributes,
        };
      }

      case 'getTreatmentPlans': {
        const plans = await odClient.request('GET', 'treatplans', { params: { PatNum: params.PatNum } });
        const activePlans = (plans.items || plans).filter(
          (plan: any) => plan.TPStatus === 'Active' || plan.TPStatus === 'Saved'
        );
        return {
          statusCode: activePlans.length > 0 ? 200 : 404,
          body: {
            status: activePlans.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: activePlans,
            message: activePlans.length > 0 ? `Found ${activePlans.length} treatment plan(s)` : 'No active treatment plans',
          },
        };
      }

      // ===== TREATPLANS TOOLS =====
      case 'TreatPlans GET': {
        // Get a list of treatplans that meet a set of search criteria
        const queryParams: any = {};

        // Optional parameters
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.SecDateTEdit !== undefined) queryParams.SecDateTEdit = params.SecDateTEdit;
        if (params.TPStatus !== undefined) queryParams.TPStatus = params.TPStatus;

        try {
          const treatPlans = await odClient.request('GET', 'treatplans', { params: queryParams });
          const plans = treatPlans.items || treatPlans;

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: plans,
              message: `Found ${plans.length} treatplan(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid search parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No treatplans found matching criteria' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get treatplans' } };
        }
      }

      case 'TreatPlans POST (create)': {
        // Creates an inactive treatplan for a patient
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        const treatPlanData: any = {
          PatNum: params.PatNum,
        };

        // Optional parameters
        if (params.Heading !== undefined) treatPlanData.Heading = params.Heading;
        if (params.Note !== undefined) treatPlanData.Note = params.Note;
        if (params.TPType !== undefined) treatPlanData.TPType = params.TPType;

        try {
          const newTreatPlan = await odClient.request('POST', 'treatplans', { data: treatPlanData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newTreatPlan,
              message: 'Inactive treatplan created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid treatplan data provided' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create treatplan' } };
        }
      }

      case 'TreatPlans POST Saved': {
        // Creates an unsigned Saved treatplan from an existing Active or Inactive treatplan
        if (!params.TreatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'TreatPlanNum is required' } };
        }

        const savedTreatPlanData: any = {
          TreatPlanNum: params.TreatPlanNum,
        };

        // Optional parameters
        if (params.Heading !== undefined) savedTreatPlanData.Heading = params.Heading;
        if (params.UserNumPresenter !== undefined) savedTreatPlanData.UserNumPresenter = params.UserNumPresenter;

        try {
          const savedTreatPlan = await odClient.request('POST', 'treatplans/Saved', { data: savedTreatPlanData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: savedTreatPlan,
              message: 'Saved treatplan created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid treatplan data provided' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Source treatplan not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create saved treatplan' } };
        }
      }

      case 'TreatPlans PUT (update)': {
        // Updates a treatplan
        if (!params.TreatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'TreatPlanNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional parameters
        if (params.DateTP !== undefined) updateData.DateTP = params.DateTP;
        if (params.Heading !== undefined) updateData.Heading = params.Heading;
        if (params.Note !== undefined) updateData.Note = params.Note;
        if (params.ResponsParty !== undefined) updateData.ResponsParty = params.ResponsParty;
        if (params.TPType !== undefined) updateData.TPType = params.TPType;
        if (params.SignatureText !== undefined) updateData.SignatureText = params.SignatureText;
        if (params.SignaturePracticeText !== undefined) updateData.SignaturePracticeText = params.SignaturePracticeText;
        if (params.isSigned !== undefined) updateData.isSigned = params.isSigned;
        if (params.isSignedPractice !== undefined) updateData.isSignedPractice = params.isSignedPractice;

        // Validate TPStatus constraint for DateTP
        if (params.DateTP && params.TPStatus !== 'Saved') {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'DateTP can only be set if TPStatus is "Saved"' } };
        }

        try {
          const updatedTreatPlan = await odClient.request('PUT', `treatplans/${params.TreatPlanNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedTreatPlan,
              message: 'Treatplan updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid update data or TPStatus constraint violation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Treatplan not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update treatplan' } };
        }
      }

      case 'TreatPlans DELETE': {
        // Deletes a treatplan
        if (!params.TreatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'TreatPlanNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `treatplans/${params.TreatPlanNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'Treatplan deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid request or treatplan cannot be deleted' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Treatplan not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete treatplan' } };
        }
      }

      // ===== TREATPLANATTACHES TOOLS =====
      case 'getTreatPlanAttaches': {
        // Get a list of treatplanattaches associated to a specified treatplan
        if (!params.TreatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'TreatPlanNum is required' } };
        }
        try {
          const attaches = await odClient.request('GET', 'treatplanattaches', { params: { TreatPlanNum: params.TreatPlanNum } });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: attaches,
              message: `Found ${attaches.length || 0} treatplan attach(es)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Treatment plan not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get treatplan attaches' } };
        }
      }

      case 'createTreatPlanAttach': {
        // Create an association between a treatment plan and a procedure
        if (!params.TreatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'TreatPlanNum is required' } };
        }
        if (!params.ProcNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcNum is required' } };
        }

        const attachData: any = {
          TreatPlanNum: params.TreatPlanNum,
          ProcNum: params.ProcNum,
        };

        // Optional field
        if (params.Priority !== undefined) attachData.Priority = params.Priority;

        try {
          const newAttach = await odClient.request('POST', 'treatplanattaches', { data: attachData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newAttach,
              message: 'Treatplan attach created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid data provided' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Treatment plan or procedure not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create treatplan attach' } };
        }
      }

      case 'updateTreatPlanAttach': {
        // Update the Priority on a treatplanattach
        if (!params.TreatPlanAttachNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'TreatPlanAttachNum is required in URL' } };
        }

        const updateData: any = {};

        // Priority field (definition.DefNum where definition.Category=20)
        if (params.Priority !== undefined) updateData.Priority = params.Priority;

        try {
          const updatedAttach = await odClient.request('PUT', `treatplanattaches/${params.TreatPlanAttachNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedAttach,
              message: 'Treatplan attach updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid data provided' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Treatplan attach not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update treatplan attach' } };
        }
      }

      // ===== PATPLANS TOOLS =====
      case 'getPatPlans': {
        // Get a list of PatPlans that meet a set of search criteria
        const queryParams: any = {};

        // Optional parameters
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.InsSubNum !== undefined) queryParams.InsSubNum = params.InsSubNum;

        try {
          const patPlans = await odClient.request('GET', 'patplans', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: patPlans,
              message: `Found ${patPlans.length || 0} patplan(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get patplans' } };
        }
      }

      case 'createPatPlan': {
        // Create a PatPlan row in the database
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.InsSubNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsSubNum is required' } };
        }

        const patPlanData: any = {
          PatNum: params.PatNum,
          InsSubNum: params.InsSubNum,
        };

        // Optional fields with defaults
        if (params.Ordinal !== undefined) patPlanData.Ordinal = params.Ordinal;
        if (params.Relationship !== undefined) patPlanData.Relationship = params.Relationship;
        if (params.PatID !== undefined) patPlanData.PatID = params.PatID;

        try {
          const newPatPlan = await odClient.request('POST', 'patplans', { data: patPlanData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newPatPlan,
              message: 'PatPlan created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Missing or invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient does not exist' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create patplan' } };
        }
      }

      case 'updatePatPlan': {
        // Update an existing PatPlan row in the database
        if (!params.PatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatPlanNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.InsSubNum !== undefined) updateData.InsSubNum = params.InsSubNum;
        if (params.Ordinal !== undefined) updateData.Ordinal = params.Ordinal;
        if (params.Relationship !== undefined) updateData.Relationship = params.Relationship;
        if (params.PatID !== undefined) updateData.PatID = params.PatID;

        try {
          const updatedPatPlan = await odClient.request('PUT', `patplans/${params.PatPlanNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPatPlan,
              message: 'PatPlan updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Missing or invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'InsSub does not exist' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update patplan' } };
        }
      }

      case 'deletePatPlan': {
        // Remove a PatPlan row from the database (called "Drop" in Open Dental UI)
        if (!params.PatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatPlanNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `patplans/${params.PatPlanNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'PatPlan deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'PatPlan not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete patplan' } };
        }
      }

      // ===== PAYMENTS TOOLS =====
      case 'getPayments': {
        // Get a list of payments
        const queryParams: any = {};

        // Optional parameters
        if (params.PayType !== undefined) queryParams.PayType = params.PayType;
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.DateEntry !== undefined) queryParams.DateEntry = params.DateEntry;

        try {
          const payments = await odClient.request('GET', 'payments', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: payments,
              message: `Found ${payments.length || 0} payment(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Missing or invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get payments' } };
        }
      }

      case 'createPayment': {
        // Create a payment for a patient
        if (!params.PayAmt) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayAmt is required' } };
        }
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        const paymentData: any = {
          PayAmt: params.PayAmt,
          PatNum: params.PatNum,
        };

        // Optional fields
        if (params.PayType !== undefined) paymentData.PayType = params.PayType;
        if (params.PayDate !== undefined) paymentData.PayDate = params.PayDate;
        if (params.CheckNum !== undefined) paymentData.CheckNum = params.CheckNum;
        if (params.PayNote !== undefined) paymentData.PayNote = params.PayNote;
        if (params.BankBranch !== undefined) paymentData.BankBranch = params.BankBranch;
        if (params.ClinicNum !== undefined) paymentData.ClinicNum = params.ClinicNum;
        if (params.isPatientPreferred !== undefined) paymentData.isPatientPreferred = params.isPatientPreferred;
        if (params.isPrepayment !== undefined) paymentData.isPrepayment = params.isPrepayment;
        if (params.procNums !== undefined) paymentData.procNums = params.procNums;
        if (params.payPlanNum !== undefined) paymentData.payPlanNum = params.payPlanNum;
        if (params.MerchantFee !== undefined) paymentData.MerchantFee = params.MerchantFee;

        try {
          const newPayment = await odClient.request('POST', 'payments', { data: paymentData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newPayment,
              message: 'Payment created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Missing or invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create payment' } };
        }
      }

      case 'createPaymentRefund': {
        // Create a refund payment
        if (!params.PayNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayNum is required' } };
        }

        const refundData = {
          PayNum: params.PayNum,
        };

        try {
          const refundPayment = await odClient.request('POST', 'payments/Refund', { data: refundData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: refundPayment,
              message: 'Refund payment created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create refund payment' } };
        }
      }

      case 'updatePayment': {
        // Update a payment
        if (!params.PayNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.PayType !== undefined) updateData.PayType = params.PayType;
        if (params.CheckNum !== undefined) updateData.CheckNum = params.CheckNum;
        if (params.BankBranch !== undefined) updateData.BankBranch = params.BankBranch;
        if (params.PayNote !== undefined) updateData.PayNote = params.PayNote;
        if (params.ProcessStatus !== undefined) updateData.ProcessStatus = params.ProcessStatus;

        try {
          const updatedPayment = await odClient.request('PUT', `payments/${params.PayNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPayment,
              message: 'Payment updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update payment' } };
        }
      }

      case 'updatePaymentPartial': {
        // Update payment with partial allocation
        if (!params.PayNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayNum is required in URL' } };
        }

        const partialData: any = {};

        // Optional fields - at least one must be provided
        if (params.procNumsAndAmounts !== undefined) partialData.procNumsAndAmounts = params.procNumsAndAmounts;
        if (params.payPlanChargeNumsAndAmounts !== undefined) partialData.payPlanChargeNumsAndAmounts = params.payPlanChargeNumsAndAmounts;

        try {
          const updatedPayment = await odClient.request('PUT', `payments/${params.PayNum}/Partial`, { data: partialData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPayment,
              message: 'Payment partial update completed successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update payment partial' } };
        }
      }

      // ===== PAYPLANCHARGES TOOLS =====
      case 'getPayPlanCharges': {
        // Get all payplancharges for a specified payment plan
        if (!params.PayPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayPlanNum is required' } };
        }

        try {
          const payPlanCharges = await odClient.request('GET', 'payplancharges', { params: { PayPlanNum: params.PayPlanNum } });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: payPlanCharges,
              message: `Found ${payPlanCharges.length || 0} payplancharge(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get payplancharges' } };
        }
      }

      // ===== PAYPLANS TOOLS =====
      case 'getPayPlan': {
        // Get a single payplan
        if (!params.PayPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayPlanNum is required in URL' } };
        }

        try {
          const payPlan = await odClient.request('GET', `payplans/${params.PayPlanNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: payPlan,
              message: 'PayPlan retrieved successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get payplan' } };
        }
      }

      case 'getPayPlans': {
        // Get a list of payment plans assigned to the patient
        const queryParams: any = {};

        // Either PatNum or Guarantor is required
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.Guarantor !== undefined) queryParams.Guarantor = params.Guarantor;

        if (!queryParams.PatNum && !queryParams.Guarantor) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either PatNum or Guarantor is required' } };
        }

        try {
          const payPlans = await odClient.request('GET', 'payplans', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: payPlans,
              message: `Found ${payPlans.length || 0} payplan(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient or Guarantor not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get payplans' } };
        }
      }

      case 'createPayPlanDynamic': {
        // Create a dynamic payment plan
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.PayAmt && !params.NumberOfPayments) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either PayAmt or NumberOfPayments is required' } };
        }
        if (!params.procNums && !params.adjNums) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either procNums or adjNums is required' } };
        }

        const payPlanData: any = {
          PatNum: params.PatNum,
        };

        // Required conditional fields
        if (params.PayAmt !== undefined) payPlanData.PayAmt = params.PayAmt;
        if (params.NumberOfPayments !== undefined) payPlanData.NumberOfPayments = params.NumberOfPayments;
        if (params.procNums !== undefined) payPlanData.procNums = params.procNums;
        if (params.adjNums !== undefined) payPlanData.adjNums = params.adjNums;

        // Optional fields
        if (params.Guarantor !== undefined) payPlanData.Guarantor = params.Guarantor;
        if (params.PayPlanDate !== undefined) payPlanData.PayPlanDate = params.PayPlanDate;
        if (params.APR !== undefined) payPlanData.APR = params.APR;
        if (params.DownPayment !== undefined) payPlanData.DownPayment = params.DownPayment;
        if (params.Note !== undefined) payPlanData.Note = params.Note;
        if (params.PlanCategory !== undefined) payPlanData.PlanCategory = params.PlanCategory;
        if (params.ChargeFrequency !== undefined) payPlanData.ChargeFrequency = params.ChargeFrequency;
        if (params.DatePayPlanStart !== undefined) payPlanData.DatePayPlanStart = params.DatePayPlanStart;
        if (params.DateInterestStart !== undefined) payPlanData.DateInterestStart = params.DateInterestStart;
        if (params.IsLocked !== undefined) payPlanData.IsLocked = params.IsLocked;
        if (params.DynamicPayPlanTPOption !== undefined) payPlanData.DynamicPayPlanTPOption = params.DynamicPayPlanTPOption;

        try {
          const newPayPlan = await odClient.request('POST', 'payplans/Dynamic', { data: payPlanData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newPayPlan,
              message: 'Dynamic PayPlan created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create dynamic payplan' } };
        }
      }

      case 'createPayPlan': {
        // Create a patient payment plan (deprecated - use createPayPlanDynamic instead)
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.useEstBalance && !params.principalAmount) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either useEstBalance or principalAmount is required' } };
        }
        if (!params.PayAmt && !params.NumberOfPayments) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either PayAmt or NumberOfPayments is required' } };
        }

        const payPlanData: any = {
          PatNum: params.PatNum,
        };

        // Required conditional fields
        if (params.useEstBalance !== undefined) payPlanData.useEstBalance = params.useEstBalance;
        if (params.principalAmount !== undefined) payPlanData.principalAmount = params.principalAmount;
        if (params.PayAmt !== undefined) payPlanData.PayAmt = params.PayAmt;
        if (params.NumberOfPayments !== undefined) payPlanData.NumberOfPayments = params.NumberOfPayments;

        // Optional fields
        if (params.Guarantor !== undefined) payPlanData.Guarantor = params.Guarantor;
        if (params.PayPlanDate !== undefined) payPlanData.PayPlanDate = params.PayPlanDate;
        if (params.APR !== undefined) payPlanData.APR = params.APR;
        if (params.DownPayment !== undefined) payPlanData.DownPayment = params.DownPayment;
        if (params.Note !== undefined) payPlanData.Note = params.Note;
        if (params.ChargeFrequency !== undefined) payPlanData.ChargeFrequency = params.ChargeFrequency;
        if (params.DatePayPlanStart !== undefined) payPlanData.DatePayPlanStart = params.DatePayPlanStart;
        if (params.DateInterestStart !== undefined) payPlanData.DateInterestStart = params.DateInterestStart;

        try {
          const newPayPlan = await odClient.request('POST', 'payplans', { data: payPlanData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newPayPlan,
              message: 'PayPlan created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Missing or invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient not found' } };
          }
          if (error.response?.status === 410) {
            return { statusCode: 410, body: { status: 'FAILURE', message: 'Deprecated' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create payplan' } };
        }
      }

      case 'closePayPlan': {
        // Close a single patient or dynamic payment plan
        if (!params.PayPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayPlanNum is required in URL' } };
        }

        try {
          const closedPayPlan = await odClient.request('PUT', `payplans/${params.PayPlanNum}/Close`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: closedPayPlan,
              message: 'PayPlan closed successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Missing or invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'PayPlan not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to close payplan' } };
        }
      }

      case 'updatePayPlanDynamic': {
        // Update a dynamic payment plan
        if (!params.PayPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PayPlanNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.PayAmt !== undefined) updateData.PayAmt = params.PayAmt;
        if (params.NumberOfPayments !== undefined) updateData.NumberOfPayments = params.NumberOfPayments;
        if (params.Guarantor !== undefined) updateData.Guarantor = params.Guarantor;
        if (params.PayPlanDate !== undefined) updateData.PayPlanDate = params.PayPlanDate;
        if (params.APR !== undefined) updateData.APR = params.APR;
        if (params.Note !== undefined) updateData.Note = params.Note;
        if (params.PlanCategory !== undefined) updateData.PlanCategory = params.PlanCategory;
        if (params.ChargeFrequency !== undefined) updateData.ChargeFrequency = params.ChargeFrequency;
        if (params.DatePayPlanStart !== undefined) updateData.DatePayPlanStart = params.DatePayPlanStart;
        if (params.DateInterestStart !== undefined) updateData.DateInterestStart = params.DateInterestStart;
        if (params.IsLocked !== undefined) updateData.IsLocked = params.IsLocked;
        if (params.SheetDefNum !== undefined) updateData.SheetDefNum = params.SheetDefNum;

        try {
          const updatedPayPlan = await odClient.request('PUT', `payplans/${params.PayPlanNum}/Dynamic`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPayPlan,
              message: 'Dynamic PayPlan updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update dynamic payplan' } };
        }
      }

      // ===== PAYSPLITS TOOLS =====
      case 'getPaySplits': {
        // Get a list of paysplits
        const queryParams: any = {};

        // Optional parameters
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.PayNum !== undefined) queryParams.PayNum = params.PayNum;
        if (params.ProcNum !== undefined) queryParams.ProcNum = params.ProcNum;

        try {
          const paySplits = await odClient.request('GET', 'paysplits', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: paySplits,
              message: `Found ${paySplits.length || 0} paysplit(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get paysplits' } };
        }
      }

      case 'updatePaySplit': {
        // Update a paysplit
        if (!params.SplitNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SplitNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.ProvNum !== undefined) updateData.ProvNum = params.ProvNum;
        if (params.ClinicNum !== undefined) updateData.ClinicNum = params.ClinicNum;

        try {
          const updatedPaySplit = await odClient.request('PUT', `paysplits/${params.SplitNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPaySplit,
              message: 'PaySplit updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update paysplit' } };
        }
      }

      // ===== PERIOEXAMS TOOLS =====
      case 'getPerioExam': {
        // Get a single perioexam
        if (!params.PerioExamNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PerioExamNum is required in URL' } };
        }

        try {
          const perioExam = await odClient.request('GET', `perioexams/${params.PerioExamNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: perioExam,
              message: 'PerioExam retrieved successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get perioexam' } };
        }
      }

      case 'getPerioExams': {
        // Get a list of perioexams
        const queryParams: any = {};

        // Optional parameters
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.ExamDate !== undefined) queryParams.ExamDate = params.ExamDate;

        try {
          const perioExams = await odClient.request('GET', 'perioexams', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: perioExams,
              message: `Found ${perioExams.length || 0} perioexam(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get perioexams' } };
        }
      }

      case 'createPerioExam': {
        // Create a new perioexam for a patient
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        const perioExamData: any = {
          PatNum: params.PatNum,
        };

        // Optional fields
        if (params.UpperFacial !== undefined) perioExamData.UpperFacial = params.UpperFacial;
        if (params.UpperLingual !== undefined) perioExamData.UpperLingual = params.UpperLingual;
        if (params.LowerLingual !== undefined) perioExamData.LowerLingual = params.LowerLingual;
        if (params.LowerFacial !== undefined) perioExamData.LowerFacial = params.LowerFacial;
        if (params.ExamDate !== undefined) perioExamData.ExamDate = params.ExamDate;
        if (params.ProvNum !== undefined) perioExamData.ProvNum = params.ProvNum;
        if (params.Note !== undefined) perioExamData.Note = params.Note;

        try {
          const newPerioExam = await odClient.request('POST', 'perioexams', { data: perioExamData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newPerioExam,
              message: 'PerioExam created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create perioexam' } };
        }
      }

      case 'updatePerioExam': {
        // Update a perioexam
        if (!params.PerioExamNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PerioExamNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.ExamDate !== undefined) updateData.ExamDate = params.ExamDate;
        if (params.ProvNum !== undefined) updateData.ProvNum = params.ProvNum;
        if (params.Note !== undefined) updateData.Note = params.Note;

        try {
          const updatedPerioExam = await odClient.request('PUT', `perioexams/${params.PerioExamNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPerioExam,
              message: 'PerioExam updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update perioexam' } };
        }
      }

      case 'deletePerioExam': {
        // Delete a perioexam and all associated periomeasures
        if (!params.PerioExamNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PerioExamNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `perioexams/${params.PerioExamNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'PerioExam deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete perioexam' } };
        }
      }

      // ===== PHARMACIES TOOLS =====
      case 'getPharmacy': {
        // Get a single pharmacy
        if (!params.PharmacyNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PharmacyNum is required in URL' } };
        }

        try {
          const pharmacy = await odClient.request('GET', `pharmacies/${params.PharmacyNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: pharmacy,
              message: 'Pharmacy retrieved successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get pharmacy' } };
        }
      }

      case 'getPharmacies': {
        // Get a list of all pharmacies
        try {
          const pharmacies = await odClient.request('GET', 'pharmacies');
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: pharmacies,
              message: `Found ${pharmacies.length || 0} pharmac(y/ies)`,
            },
          };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get pharmacies' } };
        }
      }

      // ===== PERIOMEASURES TOOLS =====
      case 'getPerioMeasures': {
        // Get a list of periomeasures
        const queryParams: any = {};

        // Optional parameter
        if (params.PerioExamNum !== undefined) queryParams.PerioExamNum = params.PerioExamNum;

        try {
          const perioMeasures = await odClient.request('GET', 'periomeasures', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: perioMeasures,
              message: `Found ${perioMeasures.length || 0} periomeasure(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get periomeasures' } };
        }
      }

      case 'createPerioMeasure': {
        // Create a new periomeasure
        if (!params.PerioExamNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PerioExamNum is required' } };
        }
        if (!params.SequenceType) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SequenceType is required' } };
        }
        if (!params.IntTooth) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'IntTooth is required' } };
        }

        const perioMeasureData: any = {
          PerioExamNum: params.PerioExamNum,
          SequenceType: params.SequenceType,
          IntTooth: params.IntTooth,
        };

        // Optional fields - defaults to -1 if not provided
        if (params.ToothValue !== undefined) perioMeasureData.ToothValue = params.ToothValue;
        if (params.MBvalue !== undefined) perioMeasureData.MBvalue = params.MBvalue;
        if (params.Bvalue !== undefined) perioMeasureData.Bvalue = params.Bvalue;
        if (params.DBvalue !== undefined) perioMeasureData.DBvalue = params.DBvalue;
        if (params.MLvalue !== undefined) perioMeasureData.MLvalue = params.MLvalue;
        if (params.Lvalue !== undefined) perioMeasureData.Lvalue = params.Lvalue;
        if (params.DLvalue !== undefined) perioMeasureData.DLvalue = params.DLvalue;

        try {
          const newPerioMeasure = await odClient.request('POST', 'periomeasures', { data: perioMeasureData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newPerioMeasure,
              message: 'PerioMeasure created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create periomeasure' } };
        }
      }

      case 'updatePerioMeasure': {
        // Update an existing periomeasure
        if (!params.PerioMeasureNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PerioMeasureNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.ToothValue !== undefined) updateData.ToothValue = params.ToothValue;
        if (params.MBvalue !== undefined) updateData.MBvalue = params.MBvalue;
        if (params.Bvalue !== undefined) updateData.Bvalue = params.Bvalue;
        if (params.DBvalue !== undefined) updateData.DBvalue = params.DBvalue;
        if (params.MLvalue !== undefined) updateData.MLvalue = params.MLvalue;
        if (params.Lvalue !== undefined) updateData.Lvalue = params.Lvalue;
        if (params.DLvalue !== undefined) updateData.DLvalue = params.DLvalue;

        try {
          const updatedPerioMeasure = await odClient.request('PUT', `periomeasures/${params.PerioMeasureNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPerioMeasure,
              message: 'PerioMeasure updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update periomeasure' } };
        }
      }

      case 'deletePerioMeasure': {
        // Delete an existing periomeasure with SequenceType of "Mobility" or "SkipTooth"
        if (!params.PerioMeasureNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PerioMeasureNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `periomeasures/${params.PerioMeasureNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'PerioMeasure deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete periomeasure' } };
        }
      }

      // ===== POPUPS TOOLS =====
      case 'getPopups': {
        // Get active and disabled popups for a patient and associated Family and SuperFamily
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        try {
          const popups = await odClient.request('GET', 'popups', { params: { PatNum: params.PatNum } });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: popups,
              message: `Found ${popups.length || 0} popup(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get popups' } };
        }
      }

      case 'createPopup': {
        // Create a new popup
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.Description) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Description is required' } };
        }

        const popupData: any = {
          PatNum: params.PatNum,
          Description: params.Description,
        };

        // Optional fields
        if (params.PopupLevel !== undefined) popupData.PopupLevel = params.PopupLevel;
        if (params.DateTimeDisabled !== undefined) popupData.DateTimeDisabled = params.DateTimeDisabled;

        try {
          const newPopup = await odClient.request('POST', 'popups', { data: popupData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newPopup,
              message: 'Popup created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create popup' } };
        }
      }

      case 'updatePopup': {
        // Update a popup
        if (!params.PopupNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PopupNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.Description !== undefined) updateData.Description = params.Description;
        if (params.PopupLevel !== undefined) updateData.PopupLevel = params.PopupLevel;
        if (params.DateTimeDisabled !== undefined) updateData.DateTimeDisabled = params.DateTimeDisabled;

        try {
          const updatedPopup = await odClient.request('PUT', `popups/${params.PopupNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedPopup,
              message: 'Popup updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update popup' } };
        }
      }

      // ===== PREFERENCES TOOLS =====
      case 'getPreferences': {
        // Get preferences - PrefName is optional, otherwise returns all ~1000 preferences paginated
        const queryParams: any = {};

        // Optional parameters
        if (params.PrefName !== undefined) queryParams.PrefName = params.PrefName;
        if (params.Offset !== undefined) queryParams.Offset = params.Offset;

        try {
          const preferences = await odClient.request('GET', 'preferences', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: preferences,
              message: `Found ${preferences.length || 0} preference(s)`,
            },
          };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get preferences' } };
        }
      }

      // ===== PROCEDURECODES TOOLS =====
      case 'getProcedureCode': {
        // Get a single procedure code
        if (!params.CodeNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'CodeNum is required in URL' } };
        }

        try {
          const procedureCode = await odClient.request('GET', `procedurecodes/${params.CodeNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: procedureCode,
              message: 'ProcedureCode retrieved successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get procedure code' } };
        }
      }

      case 'getProcedureCodes': {
        // Get a list of procedure codes
        const queryParams: any = {};

        // Optional parameter
        if (params.DateTStamp !== undefined) queryParams.DateTStamp = params.DateTStamp;

        try {
          const procedureCodes = await odClient.request('GET', 'procedurecodes', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: procedureCodes,
              message: `Found ${procedureCodes.length || 0} procedure code(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get procedure codes' } };
        }
      }

      case 'createProcedureCode': {
        // Create a new procedure code
        if (!params.ProcCode) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcCode is required' } };
        }
        if (!params.Descript) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Descript is required' } };
        }
        if (!params.AbbrDesc) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'AbbrDesc is required' } };
        }
        if (!params.ProcCat && !params.procCat) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either ProcCat or procCat is required' } };
        }

        const procedureCodeData: any = {
          ProcCode: params.ProcCode,
          Descript: params.Descript,
          AbbrDesc: params.AbbrDesc,
        };

        // Required conditional fields
        if (params.ProcCat !== undefined) procedureCodeData.ProcCat = params.ProcCat;
        if (params.procCat !== undefined) procedureCodeData.procCat = params.procCat;

        // Optional fields
        if (params.ProcTime !== undefined) procedureCodeData.ProcTime = params.ProcTime;
        if (params.TreatArea !== undefined) procedureCodeData.TreatArea = params.TreatArea;
        if (params.NoBillIns !== undefined) procedureCodeData.NoBillIns = params.NoBillIns;
        if (params.IsProsth !== undefined) procedureCodeData.IsProsth = params.IsProsth;
        if (params.DefaultNote !== undefined) procedureCodeData.DefaultNote = params.DefaultNote;
        if (params.IsHygiene !== undefined) procedureCodeData.IsHygiene = params.IsHygiene;
        if (params.AlternateCode1 !== undefined) procedureCodeData.AlternateCode1 = params.AlternateCode1;
        if (params.MedicalCode !== undefined) procedureCodeData.MedicalCode = params.MedicalCode;
        if (params.IsTaxed !== undefined) procedureCodeData.IsTaxed = params.IsTaxed;
        if (params.PaintType !== undefined) procedureCodeData.PaintType = params.PaintType;
        if (params.LaymanTerm !== undefined) procedureCodeData.LaymanTerm = params.LaymanTerm;
        if (params.IsCanadianLab !== undefined) procedureCodeData.IsCanadianLab = params.IsCanadianLab;
        if (params.BaseUnits !== undefined) procedureCodeData.BaseUnits = params.BaseUnits;
        if (params.SubstitutionCode !== undefined) procedureCodeData.SubstitutionCode = params.SubstitutionCode;
        if (params.SubstOnlyIf !== undefined) procedureCodeData.SubstOnlyIf = params.SubstOnlyIf;
        if (params.DrugNDC !== undefined) procedureCodeData.DrugNDC = params.DrugNDC;
        if (params.RevenueCodeDefault !== undefined) procedureCodeData.RevenueCodeDefault = params.RevenueCodeDefault;
        if (params.ProvNumDefault !== undefined) procedureCodeData.ProvNumDefault = params.ProvNumDefault;
        if (params.CanadaTimeUnits !== undefined) procedureCodeData.CanadaTimeUnits = params.CanadaTimeUnits;
        if (params.IsRadiology !== undefined) procedureCodeData.IsRadiology = params.IsRadiology;
        if (params.DefaultClaimNote !== undefined) procedureCodeData.DefaultClaimNote = params.DefaultClaimNote;
        if (params.DefaultTPNote !== undefined) procedureCodeData.DefaultTPNote = params.DefaultTPNote;
        if (params.PaintText !== undefined) procedureCodeData.PaintText = params.PaintText;
        if (params.AreaAlsoToothRange !== undefined) procedureCodeData.AreaAlsoToothRange = params.AreaAlsoToothRange;
        if (params.DiagnosticCodes !== undefined) procedureCodeData.DiagnosticCodes = params.DiagnosticCodes;

        try {
          const newProcedureCode = await odClient.request('POST', 'procedurecodes', { data: procedureCodeData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newProcedureCode,
              message: 'ProcedureCode created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create procedure code' } };
        }
      }

      case 'updateProcedureCode': {
        // Update an existing procedure code
        if (!params.CodeNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'CodeNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.Descript !== undefined) updateData.Descript = params.Descript;
        if (params.AbbrDesc !== undefined) updateData.AbbrDesc = params.AbbrDesc;
        if (params.ProcTime !== undefined) updateData.ProcTime = params.ProcTime;
        if (params.ProcCat !== undefined) updateData.ProcCat = params.ProcCat;
        if (params.procCat !== undefined) updateData.procCat = params.procCat;
        if (params.TreatArea !== undefined) updateData.TreatArea = params.TreatArea;
        if (params.NoBillIns !== undefined) updateData.NoBillIns = params.NoBillIns;
        if (params.IsProsth !== undefined) updateData.IsProsth = params.IsProsth;
        if (params.DefaultNote !== undefined) updateData.DefaultNote = params.DefaultNote;
        if (params.IsHygiene !== undefined) updateData.IsHygiene = params.IsHygiene;
        if (params.AlternateCode1 !== undefined) updateData.AlternateCode1 = params.AlternateCode1;
        if (params.MedicalCode !== undefined) updateData.MedicalCode = params.MedicalCode;
        if (params.IsTaxed !== undefined) updateData.IsTaxed = params.IsTaxed;
        if (params.PaintType !== undefined) updateData.PaintType = params.PaintType;
        if (params.LaymanTerm !== undefined) updateData.LaymanTerm = params.LaymanTerm;
        if (params.IsCanadianLab !== undefined) updateData.IsCanadianLab = params.IsCanadianLab;
        if (params.BaseUnits !== undefined) updateData.BaseUnits = params.BaseUnits;
        if (params.SubstitutionCode !== undefined) updateData.SubstitutionCode = params.SubstitutionCode;
        if (params.SubstOnlyIf !== undefined) updateData.SubstOnlyIf = params.SubstOnlyIf;
        if (params.DrugNDC !== undefined) updateData.DrugNDC = params.DrugNDC;
        if (params.RevenueCodeDefault !== undefined) updateData.RevenueCodeDefault = params.RevenueCodeDefault;
        if (params.ProvNumDefault !== undefined) updateData.ProvNumDefault = params.ProvNumDefault;
        if (params.CanadaTimeUnits !== undefined) updateData.CanadaTimeUnits = params.CanadaTimeUnits;
        if (params.IsRadiology !== undefined) updateData.IsRadiology = params.IsRadiology;
        if (params.DefaultClaimNote !== undefined) updateData.DefaultClaimNote = params.DefaultClaimNote;
        if (params.DefaultTPNote !== undefined) updateData.DefaultTPNote = params.DefaultTPNote;
        if (params.PaintText !== undefined) updateData.PaintText = params.PaintText;
        if (params.AreaAlsoToothRange !== undefined) updateData.AreaAlsoToothRange = params.AreaAlsoToothRange;
        if (params.DiagnosticCodes !== undefined) updateData.DiagnosticCodes = params.DiagnosticCodes;

        try {
          const updatedProcedureCode = await odClient.request('PUT', `procedurecodes/${params.CodeNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedProcedureCode,
              message: 'ProcedureCode updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update procedure code' } };
        }
      }

      // ===== PROCEDURELOGS TOOLS =====
      case 'getProcedureLog': {
        // Get a single procedurelog
        if (!params.ProcNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcNum is required in URL' } };
        }

        try {
          const procedureLog = await odClient.request('GET', `procedurelogs/${params.ProcNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: procedureLog,
              message: 'ProcedureLog retrieved successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get procedure log' } };
        }
      }

      case 'getProcedureLogs': {
        // Get a list of procedurelogs that meet search criteria
        const queryParams: any = {};

        // Optional parameters
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.AptNum !== undefined) queryParams.AptNum = params.AptNum;
        if (params.ProcDate !== undefined) queryParams.ProcDate = params.ProcDate;
        if (params.ProcStatus !== undefined) queryParams.ProcStatus = params.ProcStatus;
        if (params.PlannedAptNum !== undefined) queryParams.PlannedAptNum = params.PlannedAptNum;
        if (params.ClinicNum !== undefined) queryParams.ClinicNum = params.ClinicNum;
        if (params.CodeNum !== undefined) queryParams.CodeNum = params.CodeNum;
        if (params.DateTStamp !== undefined) queryParams.DateTStamp = params.DateTStamp;
        if (params.Offset !== undefined) queryParams.Offset = params.Offset;

        try {
          const procedureLogs = await odClient.request('GET', 'procedurelogs', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: procedureLogs,
              message: `Found ${procedureLogs.length || 0} procedure log(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get procedure logs' } };
        }
      }

      case 'getProcedureLogsInsuranceHistory': {
        // Get previous treatment dates of procedures for a patient's insurance plan
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.InsSubNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsSubNum is required' } };
        }

        try {
          const insuranceHistory = await odClient.request('GET', 'procedurelogs/InsuranceHistory', {
            params: { PatNum: params.PatNum, InsSubNum: params.InsSubNum }
          });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: insuranceHistory,
              message: `Found ${insuranceHistory.length || 0} insurance history item(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get insurance history' } };
        }
      }

      case 'getProcedureLogsGroupNotes': {
        // Get Group Notes for a set of procedures for a patient
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required in URL' } };
        }

        try {
          const groupNotes = await odClient.request('GET', 'procedurelogs/GroupNotes', {
            params: { PatNum: params.PatNum }
          });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: groupNotes,
              message: `Found ${groupNotes.length || 0} group note(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get group notes' } };
        }
      }

      case 'createProcedureLog': {
        // Create a new procedure for a given patient
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.ProcDate) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcDate is required' } };
        }
        if (!params.ProcStatus) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcStatus is required' } };
        }
        if (!params.CodeNum && !params.procCode) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either CodeNum or procCode is required' } };
        }

        const procedureLogData: any = {
          PatNum: params.PatNum,
          ProcDate: params.ProcDate,
          ProcStatus: params.ProcStatus,
        };

        // Required conditional fields
        if (params.CodeNum !== undefined) procedureLogData.CodeNum = params.CodeNum;
        if (params.procCode !== undefined) procedureLogData.procCode = params.procCode;

        // Optional fields
        if (params.AptNum !== undefined) procedureLogData.AptNum = params.AptNum;
        if (params.ProcFee !== undefined) procedureLogData.ProcFee = params.ProcFee;
        if (params.Surf !== undefined) procedureLogData.Surf = params.Surf;
        if (params.ToothNum !== undefined) procedureLogData.ToothNum = params.ToothNum;
        if (params.ToothRange !== undefined) procedureLogData.ToothRange = params.ToothRange;
        if (params.Priority !== undefined) procedureLogData.Priority = params.Priority;
        if (params.priority !== undefined) procedureLogData.priority = params.priority;
        if (params.ProvNum !== undefined) procedureLogData.ProvNum = params.ProvNum;
        if (params.Dx !== undefined) procedureLogData.Dx = params.Dx;
        if (params.dxName !== undefined) procedureLogData.dxName = params.dxName;
        if (params.PlannedAptNum !== undefined) procedureLogData.PlannedAptNum = params.PlannedAptNum;
        if (params.PlaceService !== undefined) procedureLogData.PlaceService = params.PlaceService;
        if (params.Prosthesis !== undefined) procedureLogData.Prosthesis = params.Prosthesis;
        if (params.DateOriginalProsth !== undefined) procedureLogData.DateOriginalProsth = params.DateOriginalProsth;
        if (params.ClaimNote !== undefined) procedureLogData.ClaimNote = params.ClaimNote;
        if (params.ClinicNum !== undefined) procedureLogData.ClinicNum = params.ClinicNum;
        if (params.DateTP !== undefined) procedureLogData.DateTP = params.DateTP;
        if (params.SiteNum !== undefined) procedureLogData.SiteNum = params.SiteNum;
        if (params.ProcTime !== undefined) procedureLogData.ProcTime = params.ProcTime;
        if (params.ProcTimeEnd !== undefined) procedureLogData.ProcTimeEnd = params.ProcTimeEnd;
        if (params.Prognosis !== undefined) procedureLogData.Prognosis = params.Prognosis;
        if (params.BillingNote !== undefined) procedureLogData.BillingNote = params.BillingNote;
        if (params.Discount !== undefined) procedureLogData.Discount = params.Discount;
        if (params.IsDateProsthEst !== undefined) procedureLogData.IsDateProsthEst = params.IsDateProsthEst;

        try {
          const newProcedureLog = await odClient.request('POST', 'procedurelogs', { data: procedureLogData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newProcedureLog,
              message: 'ProcedureLog created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create procedure log' } };
        }
      }

      case 'createProcedureLogGroupNote': {
        // Create a Group Note for a set of procedures
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.Note) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Note is required' } };
        }

        const groupNoteData: any = {
          PatNum: params.PatNum,
          Note: params.Note,
        };

        // Optional fields
        if (params.ProcNums !== undefined) groupNoteData.ProcNums = params.ProcNums;
        if (params.isSigned !== undefined) groupNoteData.isSigned = params.isSigned;
        if (params.ProvNum !== undefined) groupNoteData.ProvNum = params.ProvNum;

        try {
          const newGroupNote = await odClient.request('POST', 'procedurelogs/GroupNote', { data: groupNoteData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newGroupNote,
              message: 'GroupNote created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create group note' } };
        }
      }

      case 'createProcedureLogInsuranceHistory': {
        // Create a new Existing Other Provider procedure and Insurance History claimproc
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.InsSubNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsSubNum is required' } };
        }
        if (!params.insHistPrefName) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'insHistPrefName is required' } };
        }
        if (!params.ProcDate) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcDate is required' } };
        }

        const insuranceHistoryData = {
          PatNum: params.PatNum,
          InsSubNum: params.InsSubNum,
          insHistPrefName: params.insHistPrefName,
          ProcDate: params.ProcDate,
        };

        try {
          const newInsuranceHistory = await odClient.request('POST', 'procedurelogs/InsuranceHistory', { data: insuranceHistoryData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newInsuranceHistory,
              message: 'InsuranceHistory created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create insurance history' } };
        }
      }

      case 'updateProcedureLog': {
        // Update an existing procedure
        if (!params.ProcNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.AptNum !== undefined) updateData.AptNum = params.AptNum;
        if (params.ProcDate !== undefined) updateData.ProcDate = params.ProcDate;
        if (params.ProcFee !== undefined) updateData.ProcFee = params.ProcFee;
        if (params.Priority !== undefined) updateData.Priority = params.Priority;
        if (params.ProcStatus !== undefined) updateData.ProcStatus = params.ProcStatus;
        if (params.ProvNum !== undefined) updateData.ProvNum = params.ProvNum;
        if (params.Dx !== undefined) updateData.Dx = params.Dx;
        if (params.PlannedAptNum !== undefined) updateData.PlannedAptNum = params.PlannedAptNum;
        if (params.PlaceService !== undefined) updateData.PlaceService = params.PlaceService;
        if (params.Prosthesis !== undefined) updateData.Prosthesis = params.Prosthesis;
        if (params.DateOriginalProsth !== undefined) updateData.DateOriginalProsth = params.DateOriginalProsth;
        if (params.ClaimNote !== undefined) updateData.ClaimNote = params.ClaimNote;
        if (params.ClinicNum !== undefined) updateData.ClinicNum = params.ClinicNum;
        if (params.CodeNum !== undefined) updateData.CodeNum = params.CodeNum;
        if (params.procCode !== undefined) updateData.procCode = params.procCode;
        if (params.DateTP !== undefined) updateData.DateTP = params.DateTP;
        if (params.SiteNum !== undefined) updateData.SiteNum = params.SiteNum;
        if (params.ProcTime !== undefined) updateData.ProcTime = params.ProcTime;
        if (params.ProcTimeEnd !== undefined) updateData.ProcTimeEnd = params.ProcTimeEnd;
        if (params.Prognosis !== undefined) updateData.Prognosis = params.Prognosis;
        if (params.ToothNum !== undefined) updateData.ToothNum = params.ToothNum;
        if (params.Surf !== undefined) updateData.Surf = params.Surf;
        if (params.ToothRange !== undefined) updateData.ToothRange = params.ToothRange;
        if (params.BillingNote !== undefined) updateData.BillingNote = params.BillingNote;
        if (params.Discount !== undefined) updateData.Discount = params.Discount;
        if (params.IsDateProsthEst !== undefined) updateData.IsDateProsthEst = params.IsDateProsthEst;

        try {
          const updatedProcedureLog = await odClient.request('PUT', `procedurelogs/${params.ProcNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedProcedureLog,
              message: 'ProcedureLog updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update procedure log' } };
        }
      }

      case 'updateProcedureLogGroupNote': {
        // Update a specific Group Note procedure
        if (!params.ProcNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcNum is required in URL' } };
        }
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.Note) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Note is required' } };
        }

        const updateGroupNoteData: any = {
          PatNum: params.PatNum,
          Note: params.Note,
        };

        // Optional fields
        if (params.doAppendNote !== undefined) updateGroupNoteData.doAppendNote = params.doAppendNote;
        if (params.isSigned !== undefined) updateGroupNoteData.isSigned = params.isSigned;
        if (params.ProvNum !== undefined) updateGroupNoteData.ProvNum = params.ProvNum;

        try {
          const updatedGroupNote = await odClient.request('PUT', `procedurelogs/${params.ProcNum}/GroupNote`, { data: updateGroupNoteData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedGroupNote,
              message: 'GroupNote updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update group note' } };
        }
      }

      case 'deleteProcedureLog': {
        // Delete a procedure
        if (!params.ProcNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `procedurelogs/${params.ProcNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'ProcedureLog deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete procedure log' } };
        }
      }

      case 'deleteProcedureLogGroupNote': {
        // Delete a GroupNote procedure
        if (!params.ProcNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `procedurelogs/${params.ProcNum}/GroupNote`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'GroupNote deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete group note' } };
        }
      }

      // ===== PROCNOTES TOOLS =====
      case 'getProcNotes': {
        // Get a list of procnotes ordered by most recent
        const queryParams: any = {};

        // Optional parameters
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.ProcNum !== undefined) queryParams.ProcNum = params.ProcNum;

        try {
          const procNotes = await odClient.request('GET', 'procnotes', { params: queryParams });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: procNotes,
              message: `Found ${procNotes.length || 0} procnote(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get procnotes' } };
        }
      }

      case 'createProcNote': {
        // Create a new note that is associated with a procedure
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.ProcNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcNum is required' } };
        }
        if (!params.Note) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Note is required' } };
        }

        const procNoteData: any = {
          PatNum: params.PatNum,
          ProcNum: params.ProcNum,
          Note: params.Note,
        };

        // Optional fields
        if (params.isSigned !== undefined) procNoteData.isSigned = params.isSigned;
        if (params.doAppendNote !== undefined) procNoteData.doAppendNote = params.doAppendNote;

        try {
          const newProcNote = await odClient.request('POST', 'procnotes', { data: procNoteData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newProcNote,
              message: 'ProcNote created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create procnote' } };
        }
      }

      // ===== PROVIDERS TOOLS =====
      case 'Providers GET (single)': {
        try {
          const provNum = params.ProvNum;
          if (!provNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'ProvNum is required in URL' }
            };
          }

          const data = await odClient.request('GET', `providers/${provNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved provider ${provNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Provider not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve provider' } };
        }
      }

      case 'Providers GET (multiple)': {
        try {
          const queryParams: any = {};

          // Add optional ClinicNum parameter
          if (params.ClinicNum !== undefined && params.ClinicNum !== null) {
            queryParams.ClinicNum = params.ClinicNum;
          }

          // Add optional DateTStamp parameter
          if (params.DateTStamp !== undefined && params.DateTStamp !== null) {
            queryParams.DateTStamp = params.DateTStamp;
          }

          const data = await odClient.request('GET', 'providers', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved providers'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'DateTStamp format must be yyyy-MM-dd HH:mm:ss' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Clinic not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve providers' } };
        }
      }

      case 'Providers POST (create)': {
        try {
          const {
            Abbr,
            LName,
            FName,
            MI,
            Suffix,
            FeeSched,
            Specialty,
            SSN,
            StateLicense,
            IsSecondary,
            IsHidden,
            UsingTIN,
            SigOnFile,
            NationalProvID,
            IsNotPerson,
            IsHiddenReport,
            Birthdate,
            SchedNote,
            PreferredName
          } = params;

          // Validate required fields
          if (!Abbr || Abbr.trim() === '') {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'Abbr is required and cannot be blank' }
            };
          }

          const requestBody: any = { Abbr: Abbr.trim() };

          // Add optional fields
          if (LName !== undefined) requestBody.LName = LName;
          if (FName !== undefined) requestBody.FName = FName;
          if (MI !== undefined) requestBody.MI = MI;
          if (Suffix !== undefined) requestBody.Suffix = Suffix;
          if (FeeSched !== undefined) requestBody.FeeSched = FeeSched;
          if (Specialty !== undefined) requestBody.Specialty = Specialty;
          if (SSN !== undefined) requestBody.SSN = SSN;
          if (StateLicense !== undefined) requestBody.StateLicense = StateLicense;
          if (IsSecondary !== undefined) requestBody.IsSecondary = IsSecondary;
          if (IsHidden !== undefined) requestBody.IsHidden = IsHidden;
          if (UsingTIN !== undefined) requestBody.UsingTIN = UsingTIN;
          if (SigOnFile !== undefined) requestBody.SigOnFile = SigOnFile;
          if (NationalProvID !== undefined) requestBody.NationalProvID = NationalProvID;
          if (IsNotPerson !== undefined) requestBody.IsNotPerson = IsNotPerson;
          if (IsHiddenReport !== undefined) requestBody.IsHiddenReport = IsHiddenReport;
          if (Birthdate !== undefined) requestBody.Birthdate = Birthdate;
          if (SchedNote !== undefined) requestBody.SchedNote = SchedNote;
          if (PreferredName !== undefined) requestBody.PreferredName = PreferredName;

          const newProvider = await odClient.request('POST', 'providers', { data: requestBody });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newProvider,
              message: 'Provider created successfully'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create provider' } };
        }
      }

      case 'Providers PUT (update)': {
        try {
          const provNum = params.ProvNum;
          if (!provNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'ProvNum is required in URL' }
            };
          }

          const requestBody: any = {};

          // Add optional fields
          if (params.Abbr !== undefined) {
            if (params.Abbr.trim() === '') {
              return {
                statusCode: 400,
                body: { status: 'FAILURE', message: 'Abbr cannot be blank' }
              };
            }
            requestBody.Abbr = params.Abbr.trim();
          }
          if (params.FName !== undefined) requestBody.FName = params.FName;
          if (params.LName !== undefined) requestBody.LName = params.LName;
          if (params.MI !== undefined) requestBody.MI = params.MI;
          if (params.Suffix !== undefined) requestBody.Suffix = params.Suffix;
          if (params.PreferredName !== undefined) requestBody.PreferredName = params.PreferredName;
          if (params.Specialty !== undefined) requestBody.Specialty = params.Specialty;
          if (params.SigOnFile !== undefined) requestBody.SigOnFile = params.SigOnFile;
          if (params.NationalProvID !== undefined) requestBody.NationalProvID = params.NationalProvID;
          if (params.StateLicense !== undefined) requestBody.StateLicense = params.StateLicense;
          if (params.SSN !== undefined) requestBody.SSN = params.SSN;
          if (params.UsingTIN !== undefined) requestBody.UsingTIN = params.UsingTIN;

          const updatedProvider = await odClient.request('PUT', `providers/${provNum}`, { data: requestBody });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedProvider,
              message: `Provider ${provNum} updated successfully`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update provider' } };
        }
      }

      // ===== QUICKPASTENOTES TOOLS =====
      case 'QuickPasteNotes GET (single)': {
        try {
          const quickPasteNoteNum = params.QuickPasteNoteNum;
          if (!quickPasteNoteNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'QuickPasteNoteNum is required in URL' }
            };
          }

          const data = await odClient.request('GET', `quickpastenotes/${quickPasteNoteNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved QuickPasteNote ${quickPasteNoteNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'QuickPasteNote not found.' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve QuickPasteNote' } };
        }
      }

      case 'QuickPasteNotes GET (multiple)': {
        try {
          const queryParams: any = {};

          // Add optional QuickPasteCatNum parameter
          if (params.QuickPasteCatNum !== undefined && params.QuickPasteCatNum !== null) {
            queryParams.QuickPasteCatNum = params.QuickPasteCatNum;
          }

          const data = await odClient.request('GET', 'quickpastenotes', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved QuickPasteNotes'
            }
          };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve QuickPasteNotes' } };
        }
      }

      // ===== PROCTPS TOOLS =====
      case 'getProcTPs': {
        // Get a list of ProcTPs by the TreatPlanNum
        if (!params.TreatPlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'TreatPlanNum is required' } };
        }

        try {
          const procTPs = await odClient.request('GET', 'proctps', { params: { TreatPlanNum: params.TreatPlanNum } });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: procTPs,
              message: `Found ${procTPs.length || 0} proctp(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get proctps' } };
        }
      }

      case 'updateProcTP': {
        // Update a ProcTp - only unsigned treatment plans can be updated
        if (!params.ProcTPNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcTPNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional fields
        if (params.Priority !== undefined) updateData.Priority = params.Priority;
        if (params.ToothNumTP !== undefined) updateData.ToothNumTP = params.ToothNumTP;
        if (params.Surf !== undefined) updateData.Surf = params.Surf;
        if (params.ProcCode !== undefined) updateData.ProcCode = params.ProcCode;
        if (params.Descript !== undefined) updateData.Descript = params.Descript;
        if (params.FeeAmt !== undefined) updateData.FeeAmt = params.FeeAmt;
        if (params.PriInsAmt !== undefined) updateData.PriInsAmt = params.PriInsAmt;
        if (params.SecInsAmt !== undefined) updateData.SecInsAmt = params.SecInsAmt;
        if (params.PatAmt !== undefined) updateData.PatAmt = params.PatAmt;
        if (params.Discount !== undefined) updateData.Discount = params.Discount;
        if (params.Prognosis !== undefined) updateData.Prognosis = params.Prognosis;
        if (params.Dx !== undefined) updateData.Dx = params.Dx;
        if (params.ProcAbbr !== undefined) updateData.ProcAbbr = params.ProcAbbr;
        if (params.FeeAllowed !== undefined) updateData.FeeAllowed = params.FeeAllowed;

        try {
          const updatedProcTP = await odClient.request('PUT', `proctps/${params.ProcTPNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedProcTP,
              message: 'ProcTP updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update proctp' } };
        }
      }

      case 'deleteProcTP': {
        // Delete a ProcTp - only unsigned treatment plans can be deleted
        if (!params.ProcTPNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProcTPNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `proctps/${params.ProcTPNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'ProcTP deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete proctp' } };
        }
      }

      // ===== APPOINTMENT TOOLS =====
      case 'scheduleAppointment': {
        // The AI agent should call getClinicAppointmentTypes first to get available types,
        // then pass the appropriate Op, ProvNum, AppointmentTypeNum based on patient needs.
        const isNewPatient = sessionAttributes.IsNewPatient === 'true' || params.IsNewPatient === true || params.IsNewPatient === 'true';
        const reason = params.Reason || params.reason || 'Appointment';
        const clinicId = sessionAttributes.clinicId || params.clinicId;

        // Get operatory number - use clinic-specific lookup when OpName is provided
        // This resolves the "Op is invalid" error when hardcoded defaults don't match clinic operatories
        let opNum: number | null = null;
        const opInput = params.Op || params.OpName || params.opNum;

        if (opInput && clinicId) {
          // Use async clinic-specific lookup
          opNum = await resolveOperatoryNumber(opInput, clinicId, isNewPatient);
          if (opNum) {
            console.log(`[scheduleAppointment] Resolved Op ${opNum} from input "${opInput}" for clinic ${clinicId}`);
          }
        } else {
          // Fallback to synchronous lookup (backwards compatibility)
          opNum = getOperatoryNumber(opInput);
        }

        if (!opNum) {
          // Fallback to default if nothing resolved
          opNum = isNewPatient ? DEFAULT_OPERATORY_MAP.EXAM : DEFAULT_OPERATORY_MAP.MINOR;
          console.log(`[scheduleAppointment] No Op resolved, using default: ${opNum}`);
        }

        // Build appointment data using values provided by the AI agent
        const appointmentData: Record<string, any> = {
          PatNum: parseInt(params.PatNum.toString()),
          Op: opNum,
          AptDateTime: params.Date,
          ProcDescript: reason,
          Note: params.Note || `${reason} - Created by AI Agent`,
          ClinicNum: 0,
          IsNewPatient: isNewPatient,
        };

        // Add provider if specified by agent (from appointment type's defaultProvNum)
        if (params.ProvNum || params.provNum || params.defaultProvNum) {
          appointmentData.ProvNum = parseInt((params.ProvNum || params.provNum || params.defaultProvNum).toString());
        }

        // Add appointment type number if specified by agent
        if (params.AppointmentTypeNum || params.appointmentTypeNum) {
          appointmentData.AppointmentTypeNum = parseInt((params.AppointmentTypeNum || params.appointmentTypeNum).toString());
        }

        // Add pattern (duration) if specified - OpenDental uses Pattern string
        // Pattern is made of 'X' characters where each X is 5 minutes
        if (params.duration && !params.Pattern) {
          const patternLength = Math.ceil(parseInt(params.duration.toString()) / 5);
          appointmentData.Pattern = 'X'.repeat(patternLength);
        } else if (params.Pattern) {
          appointmentData.Pattern = params.Pattern;
        }

        try {
          const newAppt = await odClient.request('POST', 'appointments', { data: appointmentData });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newAppt,
              message: `Appointment scheduled successfully for ${params.Date}`,
            },
          };
        } catch (scheduleError: any) {
          console.error(`[scheduleAppointment] Failed to schedule appointment:`, scheduleError);

          // Save callback for failed appointment booking
          const patientName = sessionAttributes.FName && sessionAttributes.LName
            ? `${sessionAttributes.FName} ${sessionAttributes.LName}`
            : `Patient ${params.PatNum}`;
          const patientPhone = sessionAttributes.callerPhone || sessionAttributes.PatientPhone;

          await saveAppointmentFailureAsCallback({
            clinicId: clinicId || odClient.getClinicId(),
            patientName,
            patientPhone,
            patNum: parseInt(params.PatNum.toString()),
            requestedDate: params.Date,
            reason,
            errorMessage: scheduleError?.message || 'Unknown scheduling error',
            source: 'ai-agent',
          });

          return {
            statusCode: scheduleError?.response?.status || 500,
            body: {
              status: 'FAILURE',
              message: scheduleError?.message || 'Failed to schedule appointment',
              callbackCreated: true,
            },
          };
        }
      }

      case 'getUpcomingAppointments': {
        const resp = await odClient.request('GET', 'appointments', { params: { PatNum: params.PatNum } });
        const apts = Array.isArray(resp) ? resp : resp?.items ?? [];
        const futureApts = apts.filter((apt: any) => new Date(apt.AptDateTime) >= new Date());

        // OPTIMIZATION: Return only essential fields to reduce payload size for Bedrock
        const minimalApts = futureApts.slice(0, 20).map((apt: any) => ({
          AptNum: apt.AptNum,
          AptDateTime: apt.AptDateTime,
          ProcDescript: apt.ProcDescript,
          AptStatus: apt.AptStatus,
          Note: apt.Note ? (apt.Note.length > 100 ? apt.Note.substring(0, 100) + '...' : apt.Note) : undefined,
          ProvNum: apt.ProvNum,
          Op: apt.Op,
        }));

        // Build a concise summary for the AI
        let directAnswer = '';
        if (futureApts.length > 0) {
          directAnswer = `=== UPCOMING APPOINTMENTS ===\n`;
          directAnswer += `Found ${futureApts.length} upcoming appointment(s):\n\n`;
          minimalApts.slice(0, 10).forEach((apt: any, i: number) => {
            const date = new Date(apt.AptDateTime);
            directAnswer += `${i + 1}. ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
            directAnswer += `   Reason: ${apt.ProcDescript || 'Not specified'}\n`;
          });
          if (futureApts.length > 10) {
            directAnswer += `\n... and ${futureApts.length - 10} more appointments\n`;
          }
        }

        return {
          statusCode: futureApts.length > 0 ? 200 : 404,
          body: {
            status: futureApts.length > 0 ? 'SUCCESS' : 'FAILURE',
            directAnswer,
            data: minimalApts,
            totalCount: futureApts.length,
            message: futureApts.length > 0 ? `Found ${futureApts.length} upcoming appointment(s)` : 'No upcoming appointments',
          },
        };
      }

      case 'rescheduleAppointment': {
        const rescheduleData = {
          AptDateTime: params.NewDateTime,
          Note: params.Note ? `Rescheduled: ${params.Note}` : 'Rescheduled by AI Agent',
        };

        try {
          const rescheduled = await odClient.request('PUT', `appointments/${params.AptNum}`, { data: rescheduleData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: rescheduled,
              message: `Appointment rescheduled to ${params.NewDateTime}`,
            },
          };
        } catch (rescheduleError: any) {
          console.error(`[rescheduleAppointment] Failed to reschedule appointment:`, rescheduleError);

          // Save callback for failed appointment rescheduling
          const patientName = sessionAttributes.FName && sessionAttributes.LName
            ? `${sessionAttributes.FName} ${sessionAttributes.LName}`
            : sessionAttributes.PatNum ? `Patient ${sessionAttributes.PatNum}` : 'Unknown Patient';
          const patientPhone = sessionAttributes.callerPhone || sessionAttributes.PatientPhone;
          const clinicId = sessionAttributes.clinicId || odClient.getClinicId();

          await saveAppointmentFailureAsCallback({
            clinicId,
            patientName,
            patientPhone,
            patNum: sessionAttributes.PatNum ? parseInt(sessionAttributes.PatNum) : undefined,
            requestedDate: params.NewDateTime,
            reason: `Reschedule appointment ${params.AptNum}`,
            errorMessage: rescheduleError?.message || 'Unknown rescheduling error',
            source: 'ai-agent',
          });

          return {
            statusCode: rescheduleError?.response?.status || 500,
            body: {
              status: 'FAILURE',
              message: rescheduleError?.message || 'Failed to reschedule appointment',
              callbackCreated: true,
            },
          };
        }
      }

      case 'cancelAppointment': {
        const cancelData = {
          SendToUnscheduledList: params.SendToUnscheduledList !== false,
          Note: params.Note || 'Cancelled by AI Agent',
        };
        const cancelled = await odClient.request('PUT', `appointments/${params.AptNum}/Break`, { data: cancelData });
        return {
          statusCode: 200,
          body: { status: 'SUCCESS', data: cancelled, message: 'Appointment cancelled successfully' },
        };
      }

      case 'ScheduleOps GET': {
        const queryParams: any = {};
        if (params.ScheduleNum) {
          queryParams.ScheduleNum = params.ScheduleNum;
        }
        if (params.OperatoryNum) {
          queryParams.OperatoryNum = params.OperatoryNum;
        }

        const scheduleOps = await odClient.request('GET', 'scheduleops', { params: queryParams });

        // Ensure we return an array
        const scheduleOpsArray = Array.isArray(scheduleOps) ? scheduleOps : [];

        let message = `Found ${scheduleOpsArray.length} schedule operation(s)`;
        if (params.ScheduleNum) {
          message += ` for ScheduleNum ${params.ScheduleNum}`;
        }
        if (params.OperatoryNum) {
          message += ` for OperatoryNum ${params.OperatoryNum}`;
        }

        return {
          statusCode: scheduleOpsArray.length > 0 ? 200 : 404,
          body: {
            status: scheduleOpsArray.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: scheduleOpsArray,
            message,
          },
        };
      }

      case 'Schedules GET (single)': {
        if (!params.ScheduleNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'ScheduleNum is required' },
          };
        }

        try {
          const schedule = await odClient.request('GET', `schedules/${params.ScheduleNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: schedule,
              message: `Found schedule ${params.ScheduleNum}`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: 'Schedule not found' },
            };
          }
          throw error;
        }
      }

      case 'Schedules GET (multiple)': {
        const queryParams: any = {};

        // Single date filter (defaults to today if no date params provided)
        if (params.date) {
          queryParams.date = params.date;
        }
        // Date range filters
        if (params.dateStart) {
          queryParams.dateStart = params.dateStart;
        }
        if (params.dateEnd) {
          queryParams.dateEnd = params.dateEnd;
        }
        // SchedType filter: "Practice", "Provider", "Blockout", "Employee", or "WebSchedASAP"
        if (params.SchedType) {
          queryParams.SchedType = params.SchedType;
        }
        // BlockoutDefNum filter
        if (params.BlockoutDefNum) {
          queryParams.BlockoutDefNum = params.BlockoutDefNum;
        }
        // ProvNum filter
        if (params.ProvNum) {
          queryParams.ProvNum = params.ProvNum;
        }
        // EmployeeNum filter
        if (params.EmployeeNum) {
          queryParams.EmployeeNum = params.EmployeeNum;
        }

        try {
          const schedules = await odClient.request('GET', 'schedules', { params: queryParams });
          const schedulesArray = Array.isArray(schedules) ? schedules : [];

          // Build descriptive message
          let message = `Found ${schedulesArray.length} schedule(s)`;
          const filters: string[] = [];
          if (params.date) filters.push(`date=${params.date}`);
          if (params.dateStart && params.dateEnd) filters.push(`dateRange=${params.dateStart} to ${params.dateEnd}`);
          if (params.SchedType) filters.push(`SchedType=${params.SchedType}`);
          if (params.ProvNum) filters.push(`ProvNum=${params.ProvNum}`);
          if (params.EmployeeNum) filters.push(`EmployeeNum=${params.EmployeeNum}`);
          if (params.BlockoutDefNum) filters.push(`BlockoutDefNum=${params.BlockoutDefNum}`);
          if (filters.length > 0) {
            message += ` with filters: ${filters.join(', ')}`;
          }

          return {
            statusCode: schedulesArray.length > 0 ? 200 : 404,
            body: {
              status: schedulesArray.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: schedulesArray,
              message,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'SecurityLogs GET': {
        const queryParams: any = {};

        // Optional PermType filter (e.g., "PatientEdit", "PatientCreate")
        if (params.PermType) {
          queryParams.PermType = params.PermType;
        }

        try {
          const securityLogs = await odClient.request('GET', 'securitylogs', { params: queryParams });
          const logsArray = Array.isArray(securityLogs) ? securityLogs : [];

          let message = `Found ${logsArray.length} security log(s)`;
          if (params.PermType) {
            message += ` with PermType=${params.PermType}`;
          }

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: logsArray,
              message,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          throw error;
        }
      }

      case 'SheetDefs GET (single)': {
        if (!params.SheetDefNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'SheetDefNum is required' },
          };
        }

        try {
          const sheetDef = await odClient.request('GET', `sheetdefs/${params.SheetDefNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: sheetDef,
              message: `Found SheetDef ${params.SheetDefNum}`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: 'SheetDef not found' },
            };
          }
          throw error;
        }
      }

      case 'SheetDefs GET (multiple)': {
        const queryParams: any = {};

        // Optional SheetType filter (e.g., "PatientForm", "PatientLetter", "Screening")
        if (params.SheetType) {
          queryParams.SheetType = params.SheetType;
        }

        try {
          const sheetDefs = await odClient.request('GET', 'sheetdefs', { params: queryParams });
          const sheetDefsArray = Array.isArray(sheetDefs) ? sheetDefs : [];

          let message = `Found ${sheetDefsArray.length} SheetDef(s)`;
          if (params.SheetType) {
            message += ` with SheetType=${params.SheetType}`;
          }

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: sheetDefsArray,
              message,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          throw error;
        }
      }

      case 'getAppointment': {
        const apt = await odClient.request('GET', `appointments/${params.AptNum}`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: apt } };
      }

      case 'getAppointments': {
        const aptParams: any = {};
        if (params.PatNum) aptParams.PatNum = params.PatNum;
        if (params.AptStatus) aptParams.AptStatus = params.AptStatus;
        if (params.date) aptParams.date = params.date;
        if (params.dateStart) aptParams.dateStart = params.dateStart;
        if (params.dateEnd) aptParams.dateEnd = params.dateEnd;
        const resp = await odClient.request('GET', 'appointments', { params: aptParams });
        const apts = Array.isArray(resp) ? resp : resp?.items ?? [];

        // OPTIMIZATION: Return only essential fields to reduce payload size for Bedrock
        const minimalApts = apts.slice(0, 30).map((apt: any) => ({
          AptNum: apt.AptNum,
          AptDateTime: apt.AptDateTime,
          ProcDescript: apt.ProcDescript,
          AptStatus: apt.AptStatus,
          PatNum: apt.PatNum,
          ProvNum: apt.ProvNum,
          Op: apt.Op,
        }));

        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            data: minimalApts,
            totalCount: apts.length,
            truncated: apts.length > 30,
            message: `Found ${apts.length} appointment(s)${apts.length > 30 ? ' (showing first 30)' : ''}`,
          }
        };
      }

      case 'getHistAppointments': {
        const histAptParams: any = {};
        if (params.HistApptAction) histAptParams.HistApptAction = params.HistApptAction;
        if (params.AptNum) histAptParams.AptNum = params.AptNum;
        if (params.PatNum) histAptParams.PatNum = params.PatNum;
        if (params.AptStatus) histAptParams.AptStatus = params.AptStatus;
        if (params.ClinicNum) histAptParams.ClinicNum = params.ClinicNum;
        if (params.date) histAptParams.date = params.date;
        if (params.dateStart) histAptParams.dateStart = params.dateStart;
        if (params.dateEnd) histAptParams.dateEnd = params.dateEnd;

        const resp = await odClient.request('GET', 'histappointments', { params: histAptParams });
        const histApts = Array.isArray(resp) ? resp : resp?.items ?? [];

        // OPTIMIZATION: Return only essential fields to reduce payload size for Bedrock
        const minimalHistApts = histApts.slice(0, 50).map((apt: any) => ({
          HistApptNum: apt.HistApptNum,
          HistUserNum: apt.HistUserNum,
          HistDateTStamp: apt.HistDateTStamp,
          HistApptAction: apt.HistApptAction,
          ApptSource: apt.ApptSource,
          AptNum: apt.AptNum,
          PatNum: apt.PatNum,
          AptStatus: apt.AptStatus,
          AptDateTime: apt.AptDateTime,
          ProcDescript: apt.ProcDescript,
          ClinicNum: apt.ClinicNum,
        }));

        // Build a concise summary for the AI
        let directAnswer = '';
        if (histApts.length > 0) {
          directAnswer = `=== HISTORICAL APPOINTMENTS ===\n`;
          directAnswer += `Found ${histApts.length} historical appointment record(s):\n\n`;

          // Group by AptNum to show appointment history
          const aptGroups: { [key: number]: any[] } = {};
          histApts.forEach((apt: any) => {
            if (!aptGroups[apt.AptNum]) aptGroups[apt.AptNum] = [];
            aptGroups[apt.AptNum].push(apt);
          });

          Object.keys(aptGroups).slice(0, 10).forEach((aptNum, i) => {
            const group = aptGroups[parseInt(aptNum)];
            const latest = group.sort((a: any, b: any) => new Date(b.HistDateTStamp).getTime() - new Date(a.HistDateTStamp).getTime())[0];
            directAnswer += `Appointment ${aptNum}: ${group.length} change(s) - Latest: ${latest.HistApptAction} on ${latest.HistDateTStamp.substring(0, 10)}\n`;
          });

          if (Object.keys(aptGroups).length > 10) {
            directAnswer += `... and ${Object.keys(aptGroups).length - 10} more appointments\n`;
          }
        }

        return {
          statusCode: histApts.length > 0 ? 200 : 404,
          body: {
            status: histApts.length > 0 ? 'SUCCESS' : 'FAILURE',
            directAnswer,
            data: minimalHistApts,
            totalCount: histApts.length,
            truncated: histApts.length > 50,
            message: histApts.length > 0
              ? `Found ${histApts.length} historical appointment record(s)${histApts.length > 50 ? ' (showing first 50)' : ''}`
              : 'No historical appointment records found',
          }
        };
      }

      case 'createAppointment': {
        // The AI agent should call getClinicAppointmentTypes first to get available types,
        // then pass the appropriate Op, ProvNum, AppointmentTypeNum based on patient needs.
        const isNewPatient = params.IsNewPatient === true || params.IsNewPatient === 'true' || sessionAttributes.IsNewPatient === 'true';
        const clinicId = sessionAttributes.clinicId || params.clinicId;

        // Get operatory number - use clinic-specific lookup when OpName is provided
        let opNum: number | null = null;
        const opInput = params.Op || params.OpName || params.opNum;

        if (opInput && clinicId) {
          opNum = await resolveOperatoryNumber(opInput, clinicId, isNewPatient);
          if (opNum) {
            console.log(`[createAppointment] Resolved Op ${opNum} from input "${opInput}" for clinic ${clinicId}`);
          }
        } else {
          opNum = getOperatoryNumber(opInput);
        }

        if (!opNum) {
          opNum = isNewPatient ? DEFAULT_OPERATORY_MAP.EXAM : DEFAULT_OPERATORY_MAP.MINOR;
        }

        const aptData: any = {
          PatNum: parseInt(params.PatNum.toString()),
          Op: opNum,
          AptDateTime: params.AptDateTime,
        };

        if (params.Note) aptData.Note = params.Note;
        if (isNewPatient) aptData.IsNewPatient = 'true';
        if (params.ProvNum || params.provNum || params.defaultProvNum) {
          aptData.ProvNum = parseInt((params.ProvNum || params.provNum || params.defaultProvNum).toString());
        }
        if (params.AppointmentTypeNum || params.appointmentTypeNum) {
          aptData.AppointmentTypeNum = parseInt((params.AppointmentTypeNum || params.appointmentTypeNum).toString());
        }
        if (params.duration && !params.Pattern) {
          aptData.Pattern = 'X'.repeat(Math.ceil(parseInt(params.duration.toString()) / 5));
        } else if (params.Pattern) {
          aptData.Pattern = params.Pattern;
        }

        const newApt = await odClient.request('POST', 'appointments', { data: aptData });
        return {
          statusCode: 201,
          body: {
            status: 'SUCCESS',
            data: newApt,
            message: 'Appointment created successfully',
          },
        };
      }

      case 'updateAppointment': {
        const updateData: any = {};
        if (params.AptDateTime) updateData.AptDateTime = params.AptDateTime;
        if (params.Note) updateData.Note = params.Note;
        if (params.Op) updateData.Op = params.Op;
        const updated = await odClient.request('PUT', `appointments/${params.AptNum}`, { data: updateData });
        return { statusCode: 200, body: { status: 'SUCCESS', data: updated } };
      }

      case 'breakAppointment': {
        const breakData = { sendToUnscheduledList: params.sendToUnscheduledList };
        await odClient.request('PUT', `appointments/${params.AptNum}/Break`, { data: breakData });
        return { statusCode: 200, body: { status: 'SUCCESS', message: 'Appointment broken successfully' } };
      }

      case 'getAppointmentSlots': {
        // Use the same direct OpenDental appointments/Slots API as the chat implementation
        // for consistency across voice and chat channels
        const slotParams: any = {};

        // Support date or dateStart/dateEnd
        if (params.date || params.Date) {
          slotParams.date = params.date || params.Date;
        }
        if (params.dateStart || params.DateStart) {
          slotParams.dateStart = params.dateStart || params.DateStart;
        }
        if (params.dateEnd || params.DateEnd) {
          slotParams.dateEnd = params.dateEnd || params.DateEnd;
        }
        if (params.lengthMinutes || params.duration) {
          slotParams.lengthMinutes = params.lengthMinutes || params.duration || 30;
        }
        if (params.ProvNum) {
          slotParams.ProvNum = params.ProvNum;
        }
        if (params.OpNum) {
          slotParams.OpNum = params.OpNum;
        }

        try {
          const slots = await odClient.request('GET', 'appointments/Slots', { params: slotParams });
          const availableSlots = Array.isArray(slots) ? slots : (slots?.items ?? []);

          return {
            statusCode: availableSlots.length > 0 ? 200 : 404,
            body: {
              status: availableSlots.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: availableSlots,
              message: availableSlots.length > 0
                ? `Found ${availableSlots.length} available slot(s)`
                : 'No available slots found',
            },
          };
        } catch (error: any) {
          // Return error details for debugging
          return {
            statusCode: error.response?.status || 500,
            body: {
              status: 'FAILURE',
              message: error.response?.data?.message || error.message || 'Failed to get appointment slots',
            },
          };
        }
      }

      // ===== APPOINTMENTS API-NAMED TOOLS =====
      case 'Appointments GET (single)': {
        if (!params.AptNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'AptNum is required' },
          };
        }

        try {
          const apt = await odClient.request('GET', `appointments/${params.AptNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: apt,
              message: `Found appointment ${params.AptNum}`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: 'Appointment not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments GET (multiple)': {
        const queryParams: any = {};

        // Optional filters
        if (params.PatNum) queryParams.PatNum = params.PatNum;
        if (params.AptStatus) queryParams.AptStatus = params.AptStatus;
        if (params.Op) queryParams.Op = params.Op;
        if (params.date) queryParams.date = params.date;
        if (params.dateStart) queryParams.dateStart = params.dateStart;
        if (params.dateEnd) queryParams.dateEnd = params.dateEnd;
        if (params.ClinicNum !== undefined) queryParams.ClinicNum = params.ClinicNum;
        if (params.DateTStamp) queryParams.DateTStamp = params.DateTStamp;
        if (params.AppointmentTypeNum) queryParams.AppointmentTypeNum = params.AppointmentTypeNum;
        if (params.Offset) queryParams.Offset = params.Offset;

        try {
          const resp = await odClient.request('GET', 'appointments', { params: queryParams });
          const apts = Array.isArray(resp) ? resp : [];

          // Build descriptive message
          const filters: string[] = [];
          if (params.PatNum) filters.push(`PatNum=${params.PatNum}`);
          if (params.AptStatus) filters.push(`AptStatus=${params.AptStatus}`);
          if (params.Op) filters.push(`Op=${params.Op}`);
          if (params.date) filters.push(`date=${params.date}`);
          if (params.dateStart && params.dateEnd) filters.push(`dateRange=${params.dateStart} to ${params.dateEnd}`);
          if (params.ClinicNum !== undefined) filters.push(`ClinicNum=${params.ClinicNum}`);

          let message = `Found ${apts.length} appointment(s)`;
          if (filters.length > 0) {
            message += ` with filters: ${filters.join(', ')}`;
          }

          return {
            statusCode: apts.length > 0 ? 200 : 404,
            body: {
              status: apts.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: apts,
              message,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments GET ASAP': {
        const queryParams: any = {};

        // ClinicNum required if clinics are enabled
        if (params.ClinicNum !== undefined) queryParams.ClinicNum = params.ClinicNum;
        if (params.ProvNum) queryParams.ProvNum = params.ProvNum;
        if (params.Offset) queryParams.Offset = params.Offset;

        try {
          const resp = await odClient.request('GET', 'appointments/ASAP', { params: queryParams });
          const asapApts = Array.isArray(resp) ? resp : [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: asapApts,
              message: `Found ${asapApts.length} ASAP appointment(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          throw error;
        }
      }

      case 'Appointments GET Slots': {
        // Use the same direct OpenDental appointments/Slots API as chat implementation
        const queryParams: any = {};

        // Support date or dateStart/dateEnd
        if (params.date) queryParams.date = params.date;
        if (params.dateStart || params.DateStart) {
          queryParams.dateStart = params.dateStart || params.DateStart;
        }
        if (params.dateEnd || params.DateEnd) {
          queryParams.dateEnd = params.dateEnd || params.DateEnd;
        }
        if (params.lengthMinutes) queryParams.lengthMinutes = params.lengthMinutes;
        if (params.ProvNum) queryParams.ProvNum = params.ProvNum;
        if (params.OpNum) queryParams.OpNum = params.OpNum;

        try {
          const slots = await odClient.request('GET', 'appointments/Slots', { params: queryParams });
          const slotsArray = Array.isArray(slots) ? slots : (slots?.items ?? []);

          let message = `Found ${slotsArray.length} available slot(s)`;
          if (params.ProvNum) message += ` for ProvNum ${params.ProvNum}`;
          if (params.OpNum) message += ` in OpNum ${params.OpNum}`;

          return {
            statusCode: slotsArray.length > 0 ? 200 : 404,
            body: {
              status: slotsArray.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: slotsArray,
              message,
            },
          };
        } catch (error: any) {
          // Return error details for debugging
          return {
            statusCode: error.response?.status || 500,
            body: {
              status: 'FAILURE',
              message: error.response?.data?.message || error.message || 'Failed to get appointment slots',
            },
          };
        }
      }

      case 'Appointments GET SlotsWebSched': {
        const queryParams: any = {};

        // Optional filters
        if (params.date) queryParams.date = params.date;
        if (params.dateStart) queryParams.dateStart = params.dateStart;
        if (params.dateEnd) queryParams.dateEnd = params.dateEnd;
        if (params.ClinicNum) queryParams.ClinicNum = params.ClinicNum;
        if (params.defNumApptType) queryParams.defNumApptType = params.defNumApptType;
        if (params.isNewPatient !== undefined) queryParams.isNewPatient = params.isNewPatient;

        try {
          const slots = await odClient.request('GET', 'appointments/SlotsWebSched', { params: queryParams });
          const slotsArray = Array.isArray(slots) ? slots : [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: slotsArray,
              message: `Found ${slotsArray.length} WebSched slot(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          throw error;
        }
      }

      case 'Appointments GET WebSched': {
        const queryParams: any = {};

        // Optional filters
        if (params.date) queryParams.date = params.date;
        if (params.dateStart) queryParams.dateStart = params.dateStart;
        if (params.dateEnd) queryParams.dateEnd = params.dateEnd;
        if (params.DateTStamp) queryParams.DateTStamp = params.DateTStamp;
        if (params.ClinicNum) queryParams.ClinicNum = params.ClinicNum;
        if (params.Offset) queryParams.Offset = params.Offset;

        try {
          const resp = await odClient.request('GET', 'appointments/WebSched', { params: queryParams });
          const apts = Array.isArray(resp) ? resp : [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: apts,
              message: `Found ${apts.length} WebSched appointment(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          throw error;
        }
      }

      case 'Appointments POST (create)': {
        // Required fields
        if (!params.PatNum || !params.Op || !params.AptDateTime) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'PatNum, Op, and AptDateTime are required' },
          };
        }

        const aptData: any = {
          PatNum: parseInt(params.PatNum.toString()),
          Op: parseInt(params.Op.toString()),
          AptDateTime: params.AptDateTime,
        };

        // Optional fields
        if (params.AptStatus) aptData.AptStatus = params.AptStatus;
        if (params.Pattern) aptData.Pattern = params.Pattern;
        if (params.Confirmed) aptData.Confirmed = params.Confirmed;
        if (params.Note) aptData.Note = params.Note;
        if (params.ProvNum) aptData.ProvNum = params.ProvNum;
        if (params.ProvHyg) aptData.ProvHyg = params.ProvHyg;
        if (params.ClinicNum !== undefined) aptData.ClinicNum = params.ClinicNum;
        if (params.IsHygiene !== undefined) aptData.IsHygiene = params.IsHygiene.toString();
        if (params.DateTimeArrived) aptData.DateTimeArrived = params.DateTimeArrived;
        if (params.DateTimeSeated) aptData.DateTimeSeated = params.DateTimeSeated;
        if (params.DateTimeDismissed) aptData.DateTimeDismissed = params.DateTimeDismissed;
        if (params.IsNewPatient !== undefined) aptData.IsNewPatient = params.IsNewPatient.toString();
        if (params.Priority) aptData.Priority = params.Priority;
        if (params.AppointmentTypeNum) aptData.AppointmentTypeNum = params.AppointmentTypeNum;
        if (params.SecUserNumEntry) aptData.SecUserNumEntry = params.SecUserNumEntry;
        if (params.colorOverride) aptData.colorOverride = params.colorOverride;
        if (params.PatternSecondary) aptData.PatternSecondary = params.PatternSecondary;

        try {
          const newApt = await odClient.request('POST', 'appointments', { data: aptData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newApt,
              message: `Appointment created successfully for ${params.AptDateTime}`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments POST Planned': {
        // Required fields
        if (!params.PatNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'PatNum is required' },
          };
        }
        if (!params.AppointmentTypeNum && !params.procNums) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'Either AppointmentTypeNum or procNums is required' },
          };
        }

        const aptData: any = {
          PatNum: parseInt(params.PatNum.toString()),
        };

        // Either AppointmentTypeNum or procNums
        if (params.AppointmentTypeNum) aptData.AppointmentTypeNum = params.AppointmentTypeNum;
        if (params.procNums) aptData.procNums = params.procNums;

        // Optional fields
        if (params.Pattern) aptData.Pattern = params.Pattern;
        if (params.Confirmed) aptData.Confirmed = params.Confirmed;
        if (params.Note) aptData.Note = params.Note;
        if (params.ProvNum) aptData.ProvNum = params.ProvNum;
        if (params.ProvHyg) aptData.ProvHyg = params.ProvHyg;
        if (params.ClinicNum !== undefined) aptData.ClinicNum = params.ClinicNum;
        if (params.IsHygiene !== undefined) aptData.IsHygiene = params.IsHygiene.toString();
        if (params.IsNewPatient !== undefined) aptData.IsNewPatient = params.IsNewPatient.toString();
        if (params.Priority) aptData.Priority = params.Priority;
        if (params.PatternSecondary) aptData.PatternSecondary = params.PatternSecondary;

        try {
          const newApt = await odClient.request('POST', 'appointments/Planned', { data: aptData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newApt,
              message: `Planned appointment created successfully`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments POST SchedulePlanned': {
        // Required fields
        if (!params.AptNum || !params.AptDateTime || !params.ProvNum || !params.Op) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'AptNum, AptDateTime, ProvNum, and Op are required' },
          };
        }

        const aptData: any = {
          AptNum: parseInt(params.AptNum.toString()),
          AptDateTime: params.AptDateTime,
          ProvNum: parseInt(params.ProvNum.toString()),
          Op: parseInt(params.Op.toString()),
        };

        // Optional fields
        if (params.Confirmed) aptData.Confirmed = params.Confirmed;
        if (params.Note) aptData.Note = params.Note;

        try {
          const newApt = await odClient.request('POST', 'appointments/SchedulePlanned', { data: aptData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newApt,
              message: `Scheduled planned appointment ${params.AptNum} for ${params.AptDateTime}`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments POST WebSched': {
        // Required fields
        if (!params.PatNum || !params.DateTimeStart || !params.DateTimeEnd ||
          !params.ProvNum || !params.OpNum || !params.defNumApptType) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'PatNum, DateTimeStart, DateTimeEnd, ProvNum, OpNum, and defNumApptType are required' },
          };
        }

        const aptData: any = {
          PatNum: parseInt(params.PatNum.toString()),
          dateTimeStart: params.DateTimeStart,
          dateTimeEnd: params.DateTimeEnd,
          ProvNum: parseInt(params.ProvNum.toString()),
          OpNum: parseInt(params.OpNum.toString()),
          defNumApptType: parseInt(params.defNumApptType.toString()),
        };

        try {
          const newApt = await odClient.request('POST', 'appointments/WebSched', { data: aptData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newApt,
              message: `WebSched appointment created for ${params.DateTimeStart}`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments PUT (update)': {
        if (!params.AptNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'AptNum is required in URL' },
          };
        }

        const updateData: any = {};

        // All optional fields
        if (params.AptStatus) updateData.AptStatus = params.AptStatus;
        if (params.Pattern) updateData.Pattern = params.Pattern;
        if (params.Confirmed) updateData.Confirmed = params.Confirmed;
        if (params.Op) updateData.Op = params.Op;
        if (params.Note) updateData.Note = params.Note;
        if (params.ProvNum) updateData.ProvNum = params.ProvNum;
        if (params.ProvHyg) updateData.ProvHyg = params.ProvHyg;
        if (params.AptDateTime) updateData.AptDateTime = params.AptDateTime;
        if (params.ClinicNum !== undefined) updateData.ClinicNum = params.ClinicNum;
        if (params.IsHygiene !== undefined) updateData.IsHygiene = params.IsHygiene.toString();
        if (params.DateTimeArrived) updateData.DateTimeArrived = params.DateTimeArrived;
        if (params.DateTimeSeated) updateData.DateTimeSeated = params.DateTimeSeated;
        if (params.DateTimeDismissed) updateData.DateTimeDismissed = params.DateTimeDismissed;
        if (params.IsNewPatient !== undefined) updateData.IsNewPatient = params.IsNewPatient.toString();
        if (params.Priority) updateData.Priority = params.Priority;
        if (params.AppointmentTypeNum !== undefined) updateData.AppointmentTypeNum = params.AppointmentTypeNum;
        if (params.UnschedStatus !== undefined) updateData.UnschedStatus = params.UnschedStatus;
        if (params.colorOverride) updateData.colorOverride = params.colorOverride;
        if (params.PatternSecondary) updateData.PatternSecondary = params.PatternSecondary;

        try {
          const updated = await odClient.request('PUT', `appointments/${params.AptNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updated,
              message: `Appointment ${params.AptNum} updated successfully`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments PUT Break': {
        if (!params.AptNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'AptNum is required in URL' },
          };
        }
        if (params.sendToUnscheduledList === undefined) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'sendToUnscheduledList is required' },
          };
        }

        const breakData: any = {
          sendToUnscheduledList: params.sendToUnscheduledList.toString(),
        };

        // Optional breakType
        if (params.breakType) breakData.breakType = params.breakType;

        try {
          await odClient.request('PUT', `appointments/${params.AptNum}/Break`, { data: breakData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: `Appointment ${params.AptNum} broken successfully`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments PUT Note': {
        if (!params.AptNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'AptNum is required in URL' },
          };
        }
        if (!params.Note) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'Note is required' },
          };
        }

        try {
          await odClient.request('PUT', `appointments/${params.AptNum}/Note`, { data: { Note: params.Note } });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: `Note appended to appointment ${params.AptNum}`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      case 'Appointments PUT Confirm': {
        if (!params.AptNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'AptNum is required in URL' },
          };
        }
        if (!params.confirmVal && !params.defNum) {
          return {
            statusCode: 400,
            body: { status: 'FAILURE', message: 'Either confirmVal or defNum is required' },
          };
        }

        const confirmData: any = {};
        if (params.confirmVal) confirmData.confirmVal = params.confirmVal;
        if (params.defNum) confirmData.defNum = params.defNum;

        try {
          await odClient.request('PUT', `appointments/${params.AptNum}/Confirm`, { data: confirmData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: `Appointment ${params.AptNum} confirmation updated`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' },
            };
          }
          if (error.response?.status === 404) {
            return {
              statusCode: 404,
              body: { status: 'FAILURE', message: error.response?.data?.message || 'Not found' },
            };
          }
          throw error;
        }
      }

      // ===== STATEMENTS TOOLS =====
      case 'getStatement': {
        if (!params.StatementNum) {
          return {
            statusCode: 400,
            body: {
              status: 'FAILURE',
              message: 'StatementNum is required to retrieve a specific statement',
            },
          };
        }
        const statement = await odClient.request('GET', `statements/${params.StatementNum}`);
        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            data: statement,
            message: `Retrieved statement ${params.StatementNum}`,
          },
        };
      }

      case 'getStatements': {
        const statementParams: any = {};
        if (params.PatNum) statementParams.PatNum = params.PatNum;

        const resp = await odClient.request('GET', 'statements', { params: statementParams });
        const statements = Array.isArray(resp) ? resp : resp?.items ?? [];

        // OPTIMIZATION: Return only essential fields to reduce payload size for Bedrock
        const minimalStatements = statements.slice(0, 20).map((stmt: any) => ({
          StatementNum: stmt.StatementNum,
          PatNum: stmt.PatNum,
          DateSent: stmt.DateSent,
          DateRangeFrom: stmt.DateRangeFrom,
          DateRangeTo: stmt.DateRangeTo,
          Note: stmt.Note,
          NoteBold: stmt.NoteBold,
          Mode_: stmt.Mode_,
          HidePayment: stmt.HidePayment,
          IsSent: stmt.IsSent,
          DocNum: stmt.DocNum,
          DateTStamp: stmt.DateTStamp,
          IsReceipt: stmt.IsReceipt,
          IsInvoice: stmt.IsInvoice,
          IsInvoiceCopy: stmt.IsInvoiceCopy,
          BalTotal: stmt.BalTotal,
          StatementType: stmt.StatementType,
        }));

        // Build a concise summary for the AI
        let directAnswer = '';
        if (statements.length > 0) {
          directAnswer = `=== STATEMENTS ===\n`;
          directAnswer += `Found ${statements.length} statement(s):\n\n`;
          minimalStatements.slice(0, 10).forEach((stmt: any, i: number) => {
            const sentDate = stmt.DateSent !== '0001-01-01' ? new Date(stmt.DateSent).toLocaleDateString() : 'Not sent';
            directAnswer += `${i + 1}. Statement #${stmt.StatementNum} - Patient ${stmt.PatNum}\n`;
            directAnswer += `   Sent: ${sentDate}\n`;
            directAnswer += `   Balance: $${(stmt.BalTotal || 0).toFixed(2)}\n`;
            if (stmt.IsSent === 'true') directAnswer += `   Status: Sent\n`;
            if (stmt.Note) directAnswer += `   Note: ${stmt.Note.length > 50 ? stmt.Note.substring(0, 50) + '...' : stmt.Note}\n`;
            directAnswer += `\n`;
          });
          if (statements.length > 10) {
            directAnswer += `... and ${statements.length - 10} more statements\n`;
          }
        }

        return {
          statusCode: statements.length > 0 ? 200 : 404,
          body: {
            status: statements.length > 0 ? 'SUCCESS' : 'FAILURE',
            directAnswer,
            data: minimalStatements,
            totalCount: statements.length,
            message: statements.length > 0
              ? `Found ${statements.length} statement(s)${statements.length > 20 ? ' (showing first 20)' : ''}`
              : 'No statements found',
          },
        };
      }

      case 'createStatement': {
        if (!params.PatNum) {
          return {
            statusCode: 400,
            body: {
              status: 'FAILURE',
              message: 'PatNum is required to create a statement',
            },
          };
        }

        const statementData: any = {
          PatNum: parseInt(params.PatNum.toString()),
        };

        if (params.DateSent) statementData.DateSent = params.DateSent;
        if (params.Note) statementData.Note = params.Note;
        if (params.DocNum) statementData.DocNum = parseInt(params.DocNum.toString());

        const newStatement = await odClient.request('POST', 'statements', { data: statementData });
        return {
          statusCode: 201,
          body: {
            status: 'SUCCESS',
            data: newStatement,
            message: `Statement created successfully for patient ${params.PatNum}`,
          },
        };
      }

      // ===== ACCOUNT TOOLS =====
      case 'getAccountAging': {
        // Gets aging breakdown: Bal_0_30, Bal_31_60, Bal_61_90, BalOver90, Total, InsEst, EstBal, PatEstBal, Unearned
        const aging = await odClient.request('GET', `accountmodules/${params.PatNum}/Aging`);

        // Format a helpful response
        let directAnswer = `=== ACCOUNT AGING ===\n`;
        if (aging) {
          directAnswer += `Current (0-30 days): $${(aging.Bal_0_30 || 0).toFixed(2)}\n`;
          directAnswer += `31-60 days: $${(aging.Bal_31_60 || 0).toFixed(2)}\n`;
          directAnswer += `61-90 days: $${(aging.Bal_61_90 || 0).toFixed(2)}\n`;
          directAnswer += `Over 90 days: $${(aging.BalOver90 || 0).toFixed(2)}\n`;
          directAnswer += `\nTotal Balance: $${(aging.Total || 0).toFixed(2)}\n`;
          directAnswer += `Insurance Estimate: $${(aging.InsEst || 0).toFixed(2)}\n`;
          directAnswer += `Estimated Patient Balance: $${(aging.EstBal || 0).toFixed(2)}\n`;
          directAnswer += `Patient's Portion: $${(aging.PatEstBal || 0).toFixed(2)}\n`;
          if (aging.Unearned > 0) {
            directAnswer += `Prepayment/Credit: $${(aging.Unearned || 0).toFixed(2)}\n`;
          }
        }

        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            directAnswer,
            data: aging
          }
        };
      }

      case 'getPatientBalances': {
        // Gets individual balances for each family member
        const balances = await odClient.request('GET', `accountmodules/${params.PatNum}/PatientBalances`);

        let directAnswer = `=== PATIENT BALANCES ===\n`;
        if (Array.isArray(balances)) {
          for (const member of balances) {
            directAnswer += `${member.Name}: $${(member.Balance || 0).toFixed(2)}\n`;
          }
        }

        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            directAnswer,
            data: balances
          }
        };
      }

      case 'getServiceDateView': {
        // Gets detailed transaction history
        const serviceData = await odClient.request('GET', `accountmodules/${params.PatNum}/ServiceDateView`, {
          params: { isFamily: params.isFamily?.toString() || 'false' }
        });
        return { statusCode: 200, body: { status: 'SUCCESS', data: serviceData } };
      }

      case 'getPatientAccountSummary': {
        // Comprehensive account summary combining aging + balances
        const result = await getPatientAccountSummary(params, odClient);
        return result;
      }

      // ===== MEDICAL TOOLS =====
      case 'getAllergies': {
        const allergies = await odClient.request('GET', 'allergies', { params: { PatNum: params.PatNum } });
        return { statusCode: 200, body: { status: 'SUCCESS', data: allergies } };
      }

      case 'getProgNotes': {
        const notes = await odClient.request('GET', `chartmodules/${params.PatNum}/ProgNotes`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: notes } };
      }

      case 'getPatientInfo': {
        const info = await odClient.request('GET', `chartmodules/${params.PatNum}/PatientInfo`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: info } };
      }

      case 'getPatientRaces': {
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        try {
          const data = await odClient.request('GET', 'patientraces', { params: { PatNum: params.PatNum } });
          const races = Array.isArray(data) ? data : data?.items ?? [];
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: races,
              message: `Found ${races.length} race/ethnicity record(s) for patient`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Patient is deleted or invalid' } };
          }
          if (error.response?.status === 401) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient not found' } };
          }
          throw error;
        }
      }

      case 'getPlannedAppts': {
        const planned = await odClient.request('GET', `chartmodules/${params.PatNum}/PlannedAppts`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: planned } };
      }

      // ===== INSURANCE TOOLS =====
      case 'getBenefits': {
        const benefitParams: any = {};
        if (params.PlanNum) benefitParams.PlanNum = params.PlanNum;
        if (params.PatPlanNum) benefitParams.PatPlanNum = params.PatPlanNum;
        const benefits = await odClient.request('GET', 'benefits', { params: benefitParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: benefits } };
      }

      case 'getCarriers': {
        const carriers = await odClient.request('GET', 'carriers');
        return { statusCode: 200, body: { status: 'SUCCESS', data: carriers } };
      }

      case 'getClaims': {
        const claimParams: any = {};
        if (params.PatNum) claimParams.PatNum = params.PatNum;
        if (params.ClaimStatus) claimParams.ClaimStatus = params.ClaimStatus;
        const claims = await odClient.request('GET', 'claims', { params: claimParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: claims } };
      }

      case 'getFamilyInsurance': {
        const insurance = await odClient.request('GET', `familymodules/${params.PatNum}/Insurance`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: insurance } };
      }

      // ===== INSURANCE PLAN BENEFITS LOOKUP (from synced DynamoDB table) =====
      case 'getInsurancePlanBenefits': {
        // This tool reads from the InsurancePlans DynamoDB table (synced every 15 mins from OpenDental)
        // It can search by: insuranceName, groupName, groupNumber, or clinicId
        const result = await lookupInsurancePlanBenefits(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      // ===== APPOINTMENT TYPES LOOKUP (from PatientPortalApptTypesStack DynamoDB table) =====
      case 'getClinicAppointmentTypes': {
        // This tool reads from the ApptTypes DynamoDB table (configured in Patient Portal)
        // Helps AI book appointments by knowing available types, durations, and operatory mappings
        // Required: clinicId. Optional: label (to get a specific appointment type)
        const result = await lookupAppointmentTypes(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      // ===== INSPLANS TOOLS =====
      case 'getInsPlan': {
        // Get a single insurance plan by PlanNum
        if (!params.PlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PlanNum is required' } };
        }
        try {
          const insPlan = await odClient.request('GET', `insplans/${params.PlanNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: insPlan } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Insurance plan not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get insurance plan' } };
        }
      }

      case 'getInsPlans': {
        // Get multiple insurance plans with optional filtering
        const queryParams: any = {};
        if (params.PlanType) queryParams.PlanType = params.PlanType;
        if (params.CarrierNum) queryParams.CarrierNum = params.CarrierNum;
        try {
          const insPlans = await odClient.request('GET', 'insplans', { params: queryParams });
          return { statusCode: 200, body: { status: 'SUCCESS', data: insPlans } };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get insurance plans' } };
        }
      }

      case 'createInsPlan': {
        // Create a new insurance plan
        if (!params.CarrierNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'CarrierNum is required' } };
        }

        const insPlanData: any = {
          CarrierNum: params.CarrierNum,
        };

        // Optional fields
        if (params.GroupName) insPlanData.GroupName = params.GroupName;
        if (params.GroupNum) insPlanData.GroupNum = params.GroupNum;
        if (params.PlanNote) insPlanData.PlanNote = params.PlanNote;
        if (params.FeeSched) insPlanData.FeeSched = params.FeeSched;
        if (params.PlanType) insPlanData.PlanType = params.PlanType;
        if (params.ClaimFormNum) insPlanData.ClaimFormNum = params.ClaimFormNum;
        if (params.ClaimsUseUCR !== undefined) insPlanData.ClaimsUseUCR = params.ClaimsUseUCR;
        if (params.CopayFeeSched) insPlanData.CopayFeeSched = params.CopayFeeSched;
        if (params.EmployerNum) insPlanData.EmployerNum = params.EmployerNum;
        if (params.IsMedical !== undefined) insPlanData.IsMedical = params.IsMedical;
        if (params.FilingCode) insPlanData.FilingCode = params.FilingCode;
        if (params.ShowBaseUnits !== undefined) insPlanData.ShowBaseUnits = params.ShowBaseUnits;
        if (params.CodeSubstNone !== undefined) insPlanData.CodeSubstNone = params.CodeSubstNone;
        if (params.IsHidden !== undefined) insPlanData.IsHidden = params.IsHidden;
        if (params.MonthRenew) insPlanData.MonthRenew = params.MonthRenew;
        if (params.FilingCodeSubtype) insPlanData.FilingCodeSubtype = params.FilingCodeSubtype;
        if (params.CobRule) insPlanData.CobRule = params.CobRule;
        if (params.BillingType) insPlanData.BillingType = params.BillingType;
        if (params.ExclusionFeeRule) insPlanData.ExclusionFeeRule = params.ExclusionFeeRule;
        if (params.ManualFeeSchedNum) insPlanData.ManualFeeSchedNum = params.ManualFeeSchedNum;
        if (params.IsBlueBookEnabled !== undefined) insPlanData.IsBlueBookEnabled = params.IsBlueBookEnabled;
        if (params.InsPlansZeroWriteOffsOnAnnualMaxOverride) insPlanData.InsPlansZeroWriteOffsOnAnnualMaxOverride = params.InsPlansZeroWriteOffsOnAnnualMaxOverride;
        if (params.InsPlansZeroWriteOffsOnFreqOrAgingOverride) insPlanData.InsPlansZeroWriteOffsOnFreqOrAgingOverride = params.InsPlansZeroWriteOffsOnFreqOrAgingOverride;

        try {
          const newInsPlan = await odClient.request('POST', 'insplans', { data: insPlanData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: newInsPlan } };
        } catch (error: any) {
          return { statusCode: 400, body: { status: 'FAILURE', message: error.message || 'Failed to create insurance plan' } };
        }
      }

      case 'updateInsPlan': {
        // Update an existing insurance plan
        if (!params.PlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PlanNum is required in URL' } };
        }

        const insPlanData: any = {};

        // Optional fields for update
        if (params.GroupName !== undefined) insPlanData.GroupName = params.GroupName;
        if (params.GroupNum !== undefined) insPlanData.GroupNum = params.GroupNum;
        if (params.PlanNote !== undefined) insPlanData.PlanNote = params.PlanNote;
        if (params.FeeSched !== undefined) insPlanData.FeeSched = params.FeeSched;
        if (params.PlanType !== undefined) insPlanData.PlanType = params.PlanType;
        if (params.ClaimFormNum !== undefined) insPlanData.ClaimFormNum = params.ClaimFormNum;
        if (params.ClaimsUseUCR !== undefined) insPlanData.ClaimsUseUCR = params.ClaimsUseUCR;
        if (params.CopayFeeSched !== undefined) insPlanData.CopayFeeSched = params.CopayFeeSched;
        if (params.EmployerNum !== undefined) insPlanData.EmployerNum = params.EmployerNum;
        if (params.CarrierNum !== undefined) insPlanData.CarrierNum = params.CarrierNum;
        if (params.IsMedical !== undefined) insPlanData.IsMedical = params.IsMedical;
        if (params.FilingCode !== undefined) insPlanData.FilingCode = params.FilingCode;
        if (params.ShowBaseUnits !== undefined) insPlanData.ShowBaseUnits = params.ShowBaseUnits;
        if (params.CodeSubstNone !== undefined) insPlanData.CodeSubstNone = params.CodeSubstNone;
        if (params.IsHidden !== undefined) insPlanData.IsHidden = params.IsHidden;
        if (params.MonthRenew !== undefined) insPlanData.MonthRenew = params.MonthRenew;
        if (params.FilingCodeSubtype !== undefined) insPlanData.FilingCodeSubtype = params.FilingCodeSubtype;
        if (params.CobRule !== undefined) insPlanData.CobRule = params.CobRule;
        if (params.BillingType !== undefined) insPlanData.BillingType = params.BillingType;
        if (params.ExclusionFeeRule !== undefined) insPlanData.ExclusionFeeRule = params.ExclusionFeeRule;
        if (params.ManualFeeSchedNum !== undefined) insPlanData.ManualFeeSchedNum = params.ManualFeeSchedNum;
        if (params.IsBlueBookEnabled !== undefined) insPlanData.IsBlueBookEnabled = params.IsBlueBookEnabled;
        if (params.InsPlansZeroWriteOffsOnAnnualMaxOverride !== undefined) insPlanData.InsPlansZeroWriteOffsOnAnnualMaxOverride = params.InsPlansZeroWriteOffsOnAnnualMaxOverride;
        if (params.InsPlansZeroWriteOffsOnFreqOrAgingOverride !== undefined) insPlanData.InsPlansZeroWriteOffsOnFreqOrAgingOverride = params.InsPlansZeroWriteOffsOnFreqOrAgingOverride;

        try {
          const updatedInsPlan = await odClient.request('PUT', `insplans/${params.PlanNum}`, { data: insPlanData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedInsPlan } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Insurance plan not found' } };
          }
          return { statusCode: 400, body: { status: 'FAILURE', message: error.message || 'Failed to update insurance plan' } };
        }
      }

      // ===== SUBSTITUTIONLINKS TOOLS =====
      case 'getSubstitutionLinks': {
        // Get substitution links for a given insurance plan
        if (!params.PlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PlanNum is required' } };
        }
        try {
          const substitutionLinks = await odClient.request('GET', 'substitutionlinks', { params: { PlanNum: params.PlanNum } });
          return { statusCode: 200, body: { status: 'SUCCESS', data: substitutionLinks } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Substitution links not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get substitution links' } };
        }
      }

      case 'createSubstitutionLink': {
        // Create a new substitution link
        if (!params.PlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PlanNum is required' } };
        }
        if (!params.CodeNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'CodeNum is required' } };
        }
        if (!params.SubstitutionCode) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SubstitutionCode is required' } };
        }
        if (!params.SubstOnlyIf) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SubstOnlyIf is required' } };
        }

        const substitutionLinkData: any = {
          PlanNum: params.PlanNum,
          CodeNum: params.CodeNum,
          SubstitutionCode: params.SubstitutionCode,
          SubstOnlyIf: params.SubstOnlyIf,
        };

        try {
          const newSubstitutionLink = await odClient.request('POST', 'substitutionlinks', { data: substitutionLinkData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newSubstitutionLink } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create substitution link' } };
        }
      }

      case 'updateSubstitutionLink': {
        // Update an existing substitution link
        if (!params.SubstitutionLinkNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SubstitutionLinkNum is required in URL' } };
        }

        const substitutionLinkData: any = {};

        // Optional fields for update
        if (params.SubstitutionCode !== undefined) substitutionLinkData.SubstitutionCode = params.SubstitutionCode;
        if (params.SubstOnlyIf !== undefined) substitutionLinkData.SubstOnlyIf = params.SubstOnlyIf;

        if (Object.keys(substitutionLinkData).length === 0) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'At least one field must be provided for update' } };
        }

        try {
          const updatedSubstitutionLink = await odClient.request('PUT', `substitutionlinks/${params.SubstitutionLinkNum}`, { data: substitutionLinkData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedSubstitutionLink } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Substitution link not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update substitution link' } };
        }
      }

      case 'deleteSubstitutionLink': {
        // Delete an existing substitution link
        if (!params.SubstitutionLinkNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SubstitutionLinkNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `substitutionlinks/${params.SubstitutionLinkNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Substitution link deleted successfully' } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Substitution link not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete substitution link' } };
        }
      }

      // ===== INSSUBS TOOLS =====
      case 'getInsSub': {
        // Get a single insurance subscription by InsSubNum
        if (!params.InsSubNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsSubNum is required' } };
        }
        try {
          const insSub = await odClient.request('GET', `inssubs/${params.InsSubNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: insSub } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Insurance subscription not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get insurance subscription' } };
        }
      }

      case 'getInsSubs': {
        // Get multiple insurance subscriptions with optional filtering
        const queryParams: any = {};
        if (params.PlanNum) queryParams.PlanNum = params.PlanNum;
        if (params.Subscriber) queryParams.Subscriber = params.Subscriber;
        if (params.SecDateTEdit) queryParams.SecDateTEdit = params.SecDateTEdit;
        try {
          const insSubs = await odClient.request('GET', 'inssubs', { params: queryParams });
          return { statusCode: 200, body: { status: 'SUCCESS', data: insSubs } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Insurance subscriptions not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get insurance subscriptions' } };
        }
      }

      case 'createInsSub': {
        // Create a new insurance subscription
        if (!params.PlanNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PlanNum is required' } };
        }
        if (!params.Subscriber) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Subscriber is required' } };
        }
        if (!params.SubscriberID) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SubscriberID is required' } };
        }

        const insSubData: any = {
          PlanNum: params.PlanNum,
          Subscriber: params.Subscriber,
          SubscriberID: params.SubscriberID,
        };

        // Optional fields
        if (params.DateEffective) insSubData.DateEffective = params.DateEffective;
        if (params.DateTerm) insSubData.DateTerm = params.DateTerm;
        if (params.BenefitNotes) insSubData.BenefitNotes = params.BenefitNotes;
        if (params.ReleaseInfo !== undefined) insSubData.ReleaseInfo = params.ReleaseInfo;
        if (params.AssignBen !== undefined) insSubData.AssignBen = params.AssignBen;
        if (params.SubscNote) insSubData.SubscNote = params.SubscNote;

        try {
          const newInsSub = await odClient.request('POST', 'inssubs', { data: insSubData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newInsSub } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Missing or invalid fields' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create insurance subscription' } };
        }
      }

      case 'updateInsSub': {
        // Update an existing insurance subscription
        if (!params.InsSubNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsSubNum is required in URL' } };
        }

        const insSubData: any = {};

        // Optional fields for update
        if (params.PlanNum !== undefined) insSubData.PlanNum = params.PlanNum;
        if (params.Subscriber !== undefined) insSubData.Subscriber = params.Subscriber;
        if (params.SubscriberID !== undefined) insSubData.SubscriberID = params.SubscriberID;
        if (params.DateEffective !== undefined) insSubData.DateEffective = params.DateEffective;
        if (params.DateTerm !== undefined) insSubData.DateTerm = params.DateTerm;
        if (params.BenefitNotes !== undefined) insSubData.BenefitNotes = params.BenefitNotes;
        if (params.ReleaseInfo !== undefined) insSubData.ReleaseInfo = params.ReleaseInfo;
        if (params.AssignBen !== undefined) insSubData.AssignBen = params.AssignBen;
        if (params.SubscNote !== undefined) insSubData.SubscNote = params.SubscNote;

        try {
          await odClient.request('PUT', `inssubs/${params.InsSubNum}`, { data: insSubData });
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Insurance subscription updated successfully' } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Insurance subscription not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update insurance subscription' } };
        }
      }

      case 'deleteInsSub': {
        // Delete an insurance subscription
        if (!params.InsSubNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsSubNum is required' } };
        }
        try {
          await odClient.request('DELETE', `inssubs/${params.InsSubNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Insurance subscription deleted successfully' } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Can\'t delete InsSub because PatPlans are still attached' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete insurance subscription' } };
        }
      }

      // ===== INSVERIFIES TOOLS =====
      case 'getInsVerify': {
        // Get a single insurance verification by InsVerifyNum
        if (!params.InsVerifyNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsVerifyNum is required' } };
        }
        try {
          const insVerify = await odClient.request('GET', `insverifies/${params.InsVerifyNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: insVerify } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Insurance verification not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get insurance verification' } };
        }
      }

      case 'getInsVerifies': {
        // Get multiple insurance verifications with optional filtering
        const queryParams: any = {};
        if (params.VerifyType) queryParams.VerifyType = params.VerifyType;
        if (params.FKey) queryParams.FKey = params.FKey;
        if (params.SecDateTEdit) queryParams.SecDateTEdit = params.SecDateTEdit;
        try {
          const insVerifies = await odClient.request('GET', 'insverifies', { params: queryParams });
          return { statusCode: 200, body: { status: 'SUCCESS', data: insVerifies } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request - VerifyType is required if FKey is specified' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get insurance verifications' } };
        }
      }

      case 'updateInsVerify': {
        // Update an insurance verification
        if (!params.InsVerifyNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'InsVerifyNum is required in URL' } };
        }
        if (!params.VerifyType) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'VerifyType is required' } };
        }
        if (!params.FKey) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'FKey is required' } };
        }

        const insVerifyData: any = {
          VerifyType: params.VerifyType,
          FKey: params.FKey,
        };

        // Optional fields
        if (params.DateLastVerified !== undefined) insVerifyData.DateLastVerified = params.DateLastVerified;
        if (params.DefNum !== undefined) insVerifyData.DefNum = params.DefNum;
        if (params.Note !== undefined) insVerifyData.Note = params.Note;

        try {
          const updatedInsVerify = await odClient.request('PUT', 'insverifies', { data: insVerifyData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedInsVerify } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request - invalid fields or FKey not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update insurance verification' } };
        }
      }

      // ===== FEE SCHEDULE TOOLS (from synced DynamoDB table) =====
      case 'getFeeSchedules':
      case 'getFees': {
        // Look up fee schedules - can search by feeSchedule name, procCode, feeSchedNum, or clinicId
        const result = await lookupFeeSchedules(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getFeeForProcedure': {
        // Get the fee for a specific procedure code
        const result = await getFeeForProcedure(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'listFeeSchedules': {
        // List all available fee schedules for a clinic
        const result = await listFeeSchedules(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'compareProcedureFees': {
        // Compare fees for a procedure across different fee schedules
        const result = await compareProcedureFees(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getFeeScheduleAmounts': {
        // Get fees for procedures - handles natural language like "cleaning and exams"
        // Maps procedure names to codes and looks up fees
        const result = await getFeeScheduleAmounts(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getInsuranceDetails': {
        // Comprehensive insurance details - deductibles, maximums, waiting periods, limits, etc.
        const result = await getInsuranceDetails(params, sessionAttributes.clinicId || params.clinicId, odClient);
        return result;
      }

      case 'getDeductibleInfo':
      case 'checkDeductible':
      case 'deductibleStatus': {
        // Detailed deductible info - individual vs family, what's met, what it applies to
        const result = await getDeductibleInfo(params, sessionAttributes.clinicId || params.clinicId, odClient);
        return result;
      }

      case 'getAnnualMaxInfo':
      case 'checkAnnualMax':
      case 'getRemainingBenefits':
      case 'annualMaximum': {
        // Annual max info - amounts, remaining, separate maximums, reset dates
        const result = await getAnnualMaxInfo(params, sessionAttributes.clinicId || params.clinicId, odClient);
        return result;
      }

      case 'getCoverageBreakdown':
      case 'coverageDetails': {
        // Detailed coverage breakdown - percentages, downgrades, implants, perio, in/out of network
        const result = await getCoverageBreakdown(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getCopayAndFrequencyInfo':
      case 'getFrequencyLimits':
      case 'copayInfo': {
        // Copay vs coinsurance, frequency limits for cleanings/x-rays/etc.
        const result = await getCopayAndFrequencyInfo(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getWaitingPeriodInfo':
      case 'waitingPeriods':
      case 'getExclusions': {
        // Waiting periods, exclusions, missing tooth clause, pre-existing conditions
        const result = await getWaitingPeriodInfo(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getEstimateExplanation':
      case 'estimateAccuracy':
      case 'whyPriceChanges': {
        // Why estimates change, balance billing, sedation coverage, multi-visit billing
        const result = await getEstimateExplanation(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getCoordinationOfBenefits':
      case 'dualInsurance':
      case 'secondaryInsurance':
      case 'whichInsuranceIsPrimary': {
        // Dual insurance, primary vs secondary, coordination of benefits
        const result = await getCoordinationOfBenefits(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'getPaymentInfo':
      case 'paymentOptions':
      case 'paymentPlans':
      case 'financing': {
        // Payment timing, payment plans, financing options, HSA/FSA
        const result = await getPaymentInfo(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'checkProcedureCoverage':
      case 'isProcedureCovered':
      case 'checkCoverage': {
        // Directly answers "Is X covered?" questions
        const result = await checkProcedureCoverage(params, sessionAttributes.clinicId || params.clinicId);
        return result;
      }

      case 'calculateOutOfPocket': {
        // Calculate out-of-pocket cost for a specific procedure
        const result = await calculateOutOfPocket(params, sessionAttributes.clinicId || params.clinicId, odClient);
        return result;
      }

      case 'estimateTreatmentCost': {
        // Comprehensive tool: combines insurance coverage + fees + patient balance
        // Answers "Will my insurance cover X and how much will it cost?"
        const result = await estimateTreatmentCost(params, sessionAttributes.clinicId || params.clinicId, odClient);
        return result;
      }

      case 'suggestInsuranceCoverage': {
        // This is a higher-level tool that looks up insurance and formats coverage suggestions
        const lookupResult = await lookupInsurancePlanBenefits(params, sessionAttributes.clinicId || params.clinicId);

        if (lookupResult.statusCode !== 200 || !lookupResult.body.data?.plans?.length) {
          return {
            statusCode: 404,
            body: {
              status: 'FAILURE',
              message: 'No matching insurance plans found. Please verify the insurance name, group name, or group number.',
              suggestions: [
                'Check if the insurance carrier name is spelled correctly',
                'Verify the group number with the patient',
                'Ask for the insurance card to confirm details',
              ],
            },
          };
        }

        // Format coverage suggestions from the plan data
        const plans = lookupResult.body.data.plans as InsurancePlanRecord[];
        const coverageSuggestions = plans.map((plan: InsurancePlanRecord) => formatCoverageSuggestion(plan));

        // Build a clear, direct answer about what was found - ALL benefits
        const mainPlan = plans[0];

        // Helper to format percentage
        // Data can be stored as decimal (0.8) or whole number (80)
        const fmtPct = (pct: number | null | undefined): string => {
          if (pct === null || pct === undefined) return 'Not recorded';
          if (pct === 0) return '0% (Not covered)';
          // If value > 1, it's already a percentage (80 = 80%), otherwise it's decimal (0.8 = 80%)
          const percentage = pct > 1 ? Math.round(pct) : Math.round(pct * 100);
          return `${percentage}%`;
        };

        // Helper to format money
        const fmtMoney = (amt: number | null | undefined): string => {
          if (amt === null || amt === undefined) return 'Not recorded';
          if (amt === 0) return '$0';
          return `$${amt.toLocaleString()}`;
        };

        // Build a comprehensive direct answer string
        let directAnswer = '';
        if (plans.length === 1) {
          directAnswer = `=== INSURANCE PLAN DETAILS ===\n`;
          directAnswer += `PLAN: ${mainPlan.insuranceName || 'Unknown'} - ${mainPlan.groupName || 'Unknown Group'}\n`;
          if (mainPlan.groupNumber) directAnswer += `GROUP #: ${mainPlan.groupNumber}\n`;
          directAnswer += `\n`;

          // Maximums and Deductibles
          directAnswer += `=== MAXIMUMS & DEDUCTIBLES ===\n`;
          directAnswer += `Annual Maximum (Individual): ${fmtMoney(mainPlan.annualMaxIndividual)}\n`;
          if (mainPlan.annualMaxFamily) directAnswer += `Annual Maximum (Family): ${fmtMoney(mainPlan.annualMaxFamily)}\n`;
          directAnswer += `Deductible (Individual): ${fmtMoney(mainPlan.deductibleIndividual)}\n`;
          if (mainPlan.deductibleFamily) directAnswer += `Deductible (Family): ${fmtMoney(mainPlan.deductibleFamily)}\n`;
          directAnswer += `\n`;

          // Preventive Coverage
          directAnswer += `=== PREVENTIVE SERVICES ===\n`;
          directAnswer += `Exams & Diagnostics: ${fmtPct(mainPlan.preventiveDiagnosticsPct)}\n`;
          directAnswer += `X-Rays: ${fmtPct(mainPlan.preventiveXRaysPct)}\n`;
          directAnswer += `Cleanings & Preventive: ${fmtPct(mainPlan.preventiveRoutinePreventivePct)}\n`;
          directAnswer += `\n`;

          // Basic Coverage
          directAnswer += `=== BASIC SERVICES ===\n`;
          directAnswer += `Fillings (Restorative): ${fmtPct(mainPlan.basicRestorativePct)}\n`;
          directAnswer += `Root Canals (Endodontics): ${fmtPct(mainPlan.basicEndoPct)}\n`;
          directAnswer += `Gum Treatment (Periodontics): ${fmtPct(mainPlan.basicPerioPct)}\n`;
          directAnswer += `Extractions (Oral Surgery): ${fmtPct(mainPlan.basicOralSurgeryPct)}\n`;
          directAnswer += `\n`;

          // Major Coverage
          directAnswer += `=== MAJOR SERVICES ===\n`;
          directAnswer += `Crowns: ${fmtPct(mainPlan.majorCrownsPct)}\n`;
          if (mainPlan.majorCrownsPct !== null && mainPlan.majorCrownsPct !== undefined) {
            // Handle both decimal (0.5) and whole number (50) formats
            const crownPctValue = mainPlan.majorCrownsPct > 1 ? mainPlan.majorCrownsPct : mainPlan.majorCrownsPct * 100;
            const patientPctValue = 100 - crownPctValue;
            const estimatedPatientCost = Math.round(1200 * (patientPctValue / 100));
            directAnswer += `  → You pay ~${Math.round(patientPctValue)}% (~$${estimatedPatientCost} per crown)\n`;
          }
          directAnswer += `Bridges/Dentures (Prosthodontics): ${fmtPct(mainPlan.majorProsthodonticsPct)}\n`;
          directAnswer += `\n`;

          // Orthodontics
          if (mainPlan.orthoPct !== null || mainPlan.orthoLifetimeMax !== null) {
            directAnswer += `=== ORTHODONTICS ===\n`;
            directAnswer += `Ortho Coverage: ${fmtPct(mainPlan.orthoPct)}\n`;
            if (mainPlan.orthoLifetimeMax) directAnswer += `Ortho Lifetime Max: ${fmtMoney(mainPlan.orthoLifetimeMax)}\n`;
            directAnswer += `\n`;
          }

          // Limitations
          if (mainPlan.waitingPeriods || mainPlan.frequencyLimits || mainPlan.ageLimits) {
            directAnswer += `=== LIMITATIONS ===\n`;
            if (mainPlan.waitingPeriods) directAnswer += `Waiting Periods: ${mainPlan.waitingPeriods}\n`;
            if (mainPlan.frequencyLimits) {
              directAnswer += `Frequency Limits:\n`;
              mainPlan.frequencyLimits
                .split('|')
                .map((s) => s.trim())
                .filter(Boolean)
                .forEach((item) => {
                  directAnswer += `- ${item}\n`;
                });
            }
            if (mainPlan.ageLimits) directAnswer += `Age Limits: ${mainPlan.ageLimits}\n`;
            directAnswer += `\n`;
          }

          // Deductible Overrides by Category
          if (mainPlan.deductibleOverridesByCategory) {
            directAnswer += `=== DEDUCTIBLE OVERRIDES BY CATEGORY ===\n`;
            mainPlan.deductibleOverridesByCategory
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((item) => {
                directAnswer += `- ${item}\n`;
              });
            directAnswer += `\n`;
          }

          // Coinsurance Overrides by Procedure/CodeGroup
          if (mainPlan.coinsuranceOverridesByCodeOrGroup) {
            directAnswer += `=== COINSURANCE OVERRIDES BY PROCEDURE ===\n`;
            mainPlan.coinsuranceOverridesByCodeOrGroup
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((item) => {
                directAnswer += `- ${item}\n`;
              });
            directAnswer += `\n`;
          }

          // Copayments
          if (mainPlan.copayments) {
            directAnswer += `=== COPAYMENTS ===\n`;
            mainPlan.copayments
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((item) => {
                directAnswer += `- ${item}\n`;
              });
            directAnswer += `\n`;
          }

          // Exclusions
          if (mainPlan.exclusions) {
            directAnswer += `=== EXCLUSIONS (NOT COVERED) ===\n`;
            mainPlan.exclusions
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((item) => {
                directAnswer += `- ${item}\n`;
              });
            directAnswer += `\n`;
          }

          // Other Limitations
          if (mainPlan.otherLimitations) {
            directAnswer += `=== OTHER LIMITATIONS ===\n`;
            mainPlan.otherLimitations
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((item) => {
                directAnswer += `- ${item}\n`;
              });
            directAnswer += `\n`;
          }

          // Active Coverage Flags
          if (mainPlan.activeCoverageFlags) {
            directAnswer += `=== ACTIVE COVERAGE FLAGS ===\n`;
            mainPlan.activeCoverageFlags
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((item) => {
                directAnswer += `- ${item}\n`;
              });
            directAnswer += `\n`;
          }

          // Fluoride-specific hint (often requested; stored in limitations rather than a dedicated % field)
          const fluorideFreq = mainPlan.frequencyLimits
            ? mainPlan.frequencyLimits
              .split('|')
              .map((s) => s.trim())
              .find((s) => /^fluoride\s*:/i.test(s))
            : null;
          const fluorideAge = mainPlan.ageLimits && /fluoride/i.test(mainPlan.ageLimits) ? mainPlan.ageLimits : null;
          if (fluorideFreq || fluorideAge) {
            directAnswer += `=== FLUORIDE (FROM PLAN LIMITATIONS) ===\n`;
            directAnswer += `Fluoride benefit is listed in this plan's limitations.\n`;
            directAnswer += `Coverage % for fluoride is not stored as a separate field in this database.\n`;
            if (fluorideFreq) directAnswer += `${fluorideFreq}\n`;
            if (fluorideAge) directAnswer += `${fluorideAge}\n`;
            directAnswer += `\n`;
          }

          // Notes
          if (mainPlan.planNote) {
            directAnswer += `=== NOTES ===\n${mainPlan.planNote}\n`;
          }

          // Downgrades
          if (mainPlan.downgrades) {
            directAnswer += `\n⚠️ DOWNGRADES: ${mainPlan.downgrades}\n`;
          }

        } else {
          // MULTIPLE PLANS FOUND - Format for easy user selection
          directAnswer = `=== MULTIPLE ${mainPlan.insuranceName?.toUpperCase() || 'INSURANCE'} PLANS FOUND ===\n\n`;
          directAnswer += `I found ${plans.length} plan(s) matching that insurance. Please select your plan:\n\n`;

          plans.slice(0, 10).forEach((p, i) => {
            directAnswer += `${i + 1}. ${p.insuranceName || 'Unknown'} - ${p.groupName || 'Unknown Group'}\n`;
            if (p.groupNumber) {
              directAnswer += `   Group #: ${p.groupNumber}\n`;
            }
          });

          if (plans.length > 10) {
            directAnswer += `\n... and ${plans.length - 10} more plans\n`;
          }

          directAnswer += `\n📋 Please tell me your plan number (1-${Math.min(plans.length, 10)}) or provide your group number from your insurance card.\n`;
        }

        // Determine lookup status
        const crownCoverageFound = mainPlan.majorCrownsPct !== null && mainPlan.majorCrownsPct !== undefined;
        const hasAnyCoverage = mainPlan.preventiveDiagnosticsPct !== null ||
          mainPlan.basicRestorativePct !== null ||
          mainPlan.majorCrownsPct !== null;

        // OPTIMIZATION: Include a simple plan selection list for multiple plans
        // This helps the bot reference specific plans when user selects
        const planSelectionList = plans.length > 1 ? plans.slice(0, 10).map((p, i) => ({
          index: i + 1,
          insuranceName: p.insuranceName,
          groupName: p.groupName,
          groupNumber: p.groupNumber,
        })) : undefined;

        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            lookupStatus: plans.length > 1
              ? 'MULTIPLE_PLANS_FOUND'
              : (hasAnyCoverage ? 'COVERAGE_DETAILS_FOUND' : 'PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED'),
            message: plans.length > 1
              ? `Found ${plans.length} matching plans. Ask user to select their plan.`
              : `Successfully found insurance plan details. Use the directAnswer field to respond to the user.`,
            directAnswer: directAnswer,
            multiplePlansFound: plans.length > 1,
            planCount: plans.length,
            planSelectionList,
            data: {
              plans: plans.length > 1 ? planSelectionList : coverageSuggestions,
              summary: plans.length === 1 ? generateCoverageSummary(plans) : undefined,
            },
          },
        };
      }

      // ===== CALL TRANSFER TOOLS =====
      case 'transferToHuman': {
        // Get meeting and call information from session attributes
        const callId = sessionAttributes.callId || params.callId;
        const meetingId = sessionAttributes.meetingId || params.meetingId;
        const clinicId = sessionAttributes.clinicId;
        const transferReason = params.reason || 'Customer requested agent assistance';

        if (!callId) {
          return {
            statusCode: 400,
            body: {
              status: 'FAILURE',
              message: 'No active call to transfer. callId is required.',
            },
          };
        }

        console.log('[transferToHuman] Initiating transfer to human agent:', {
          callId,
          meetingId,
          clinicId,
          reason: transferReason,
        });

        try {
          // Import the meeting manager at runtime to avoid circular dependencies
          const { getMeetingByCallId } = await import('../chime/meeting-manager');

          // Get meeting info if not provided
          let meeting = null;
          if (meetingId) {
            const { getMeetingInfo } = await import('../chime/meeting-manager');
            meeting = await getMeetingInfo(meetingId);
          } else if (callId) {
            meeting = await getMeetingByCallId(callId);
          }

          if (!meeting) {
            console.warn('[transferToHuman] No meeting found for call, using fallback queue method');
            // Fallback: Add to call queue without meeting join
            // This works for non-meeting-based calls
          }

          // Add call to queue for human agents
          const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME || 'CallQueue';
          await docClient.send(new UpdateCommand({
            TableName: CALL_QUEUE_TABLE,
            Key: { callId },
            UpdateExpression: 'SET #status = :pending, transferReason = :reason, transferRequestedAt = :now',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':pending': 'pending',
              ':reason': transferReason,
              ':now': Date.now(),
            },
          }));

          console.log('[transferToHuman] Call added to queue for agent pickup:', callId);

          // TODO: Send push notification to available agents
          // TODO: Play hold music while waiting for agent

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'Transfer initiated. Connecting you to an available agent.',
              data: {
                callId,
                meetingId: meeting?.meetingId,
                transferStatus: 'pending',
              },
            },
          };
        } catch (error) {
          console.error('[transferToHuman] Error initiating transfer:', error);
          return {
            statusCode: 500,
            body: {
              status: 'FAILURE',
              message: 'Failed to initiate transfer. Please try again.',
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      }

      case 'getLabCase': {
        // Get a single labcase by LabCaseNum
        if (!params.LabCaseNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LabCaseNum is required' } };
        }
        try {
          const labCase = await odClient.request('GET', `labcases/${params.LabCaseNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: labCase } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Lab case not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get lab case' } };
        }
      }

      case 'getLabCases': {
        // Get multiple labcases with optional filtering
        const queryParams: any = {};
        if (params.PatNum) queryParams.PatNum = params.PatNum;
        if (params.LaboratoryNum) queryParams.LaboratoryNum = params.LaboratoryNum;
        if (params.AptNum) queryParams.AptNum = params.AptNum;
        if (params.PlannedAptNum) queryParams.PlannedAptNum = params.PlannedAptNum;
        if (params.ProvNum) queryParams.ProvNum = params.ProvNum;

        try {
          const labCases = await odClient.request('GET', 'labcases', { params: queryParams });
          const labCasesArray = Array.isArray(labCases) ? labCases : labCases?.items ?? [];
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: { items: labCasesArray },
              message: `Found ${labCasesArray.length} lab case(s)`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No lab cases found matching criteria' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get lab cases' } };
        }
      }

      case 'createLabCase': {
        // Create a new labcase
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.LaboratoryNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LaboratoryNum is required' } };
        }
        if (!params.ProvNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'ProvNum is required' } };
        }

        const labCaseData: any = {
          PatNum: params.PatNum,
          LaboratoryNum: params.LaboratoryNum,
          ProvNum: params.ProvNum,
        };

        // Optional fields
        if (params.AptNum !== undefined) labCaseData.AptNum = params.AptNum;
        if (params.PlannedAptNum !== undefined) labCaseData.PlannedAptNum = params.PlannedAptNum;
        if (params.DateTimeDue) labCaseData.DateTimeDue = params.DateTimeDue;
        if (params.DateTimeCreated) labCaseData.DateTimeCreated = params.DateTimeCreated;
        if (params.DateTimeSent) labCaseData.DateTimeSent = params.DateTimeSent;
        if (params.DateTimeRecd) labCaseData.DateTimeRecd = params.DateTimeRecd;
        if (params.DateTimeChecked) labCaseData.DateTimeChecked = params.DateTimeChecked;
        if (params.Instructions) labCaseData.Instructions = params.Instructions;
        if (params.LabFee !== undefined) labCaseData.LabFee = params.LabFee;
        if (params.InvoiceNum) labCaseData.InvoiceNum = params.InvoiceNum;

        try {
          const newLabCase = await odClient.request('POST', 'labcases', { data: labCaseData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newLabCase } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid lab case data' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create lab case' } };
        }
      }

      case 'updateLabCase': {
        // Update an existing labcase
        if (!params.LabCaseNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LabCaseNum is required in URL' } };
        }

        const labCaseData: any = {};

        // Optional fields for update
        if (params.LaboratoryNum !== undefined) labCaseData.LaboratoryNum = params.LaboratoryNum;
        if (params.AptNum !== undefined) labCaseData.AptNum = params.AptNum;
        if (params.PlannedAptNum !== undefined) labCaseData.PlannedAptNum = params.PlannedAptNum;
        if (params.DateTimeDue !== undefined) labCaseData.DateTimeDue = params.DateTimeDue;
        if (params.DateTimeCreated !== undefined) labCaseData.DateTimeCreated = params.DateTimeCreated;
        if (params.DateTimeSent !== undefined) labCaseData.DateTimeSent = params.DateTimeSent;
        if (params.DateTimeRecd !== undefined) labCaseData.DateTimeRecd = params.DateTimeRecd;
        if (params.DateTimeChecked !== undefined) labCaseData.DateTimeChecked = params.DateTimeChecked;
        if (params.ProvNum !== undefined) labCaseData.ProvNum = params.ProvNum;
        if (params.Instructions !== undefined) labCaseData.Instructions = params.Instructions;
        if (params.LabFee !== undefined) labCaseData.LabFee = params.LabFee;
        if (params.InvoiceNum !== undefined) labCaseData.InvoiceNum = params.InvoiceNum;

        try {
          const updatedLabCase = await odClient.request('PUT', `labcases/${params.LabCaseNum}`, { data: labCaseData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedLabCase } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Lab case not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid lab case data' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update lab case' } };
        }
      }

      case 'deleteLabCase': {
        // Delete a labcase
        if (!params.LabCaseNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LabCaseNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `labcases/${params.LabCaseNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Lab case deleted successfully' } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Lab case not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Cannot delete lab case' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete lab case' } };
        }
      }

      case 'getLaboratory': {
        // Get a single laboratory by LaboratoryNum
        if (!params.LaboratoryNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LaboratoryNum is required' } };
        }
        try {
          const laboratory = await odClient.request('GET', `laboratories/${params.LaboratoryNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: laboratory } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Laboratory not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get laboratory' } };
        }
      }

      case 'getLaboratories': {
        // Get multiple laboratories
        try {
          const laboratories = await odClient.request('GET', 'laboratories');
          const laboratoriesArray = Array.isArray(laboratories) ? laboratories : laboratories?.items ?? [];
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: { items: laboratoriesArray },
              message: `Found ${laboratoriesArray.length} laboratory(ies)`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No laboratories found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get laboratories' } };
        }
      }

      case 'createLaboratory': {
        // Create a new laboratory
        if (!params.Description) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Description is required' } };
        }

        const laboratoryData: any = {
          Description: params.Description,
        };

        // Optional fields
        if (params.Phone !== undefined) laboratoryData.Phone = params.Phone;
        if (params.Notes !== undefined) laboratoryData.Notes = params.Notes;
        if (params.Slip !== undefined) laboratoryData.Slip = params.Slip;
        if (params.Address !== undefined) laboratoryData.Address = params.Address;
        if (params.City !== undefined) laboratoryData.City = params.City;
        if (params.State !== undefined) laboratoryData.State = params.State;
        if (params.Zip !== undefined) laboratoryData.Zip = params.Zip;
        if (params.Email !== undefined) laboratoryData.Email = params.Email;
        if (params.WirelessPhone !== undefined) laboratoryData.WirelessPhone = params.WirelessPhone;
        if (params.IsHidden !== undefined) laboratoryData.IsHidden = params.IsHidden;

        try {
          const newLaboratory = await odClient.request('POST', 'laboratories', { data: laboratoryData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newLaboratory } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid laboratory data' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create laboratory' } };
        }
      }

      case 'updateLaboratory': {
        // Update an existing laboratory
        if (!params.LaboratoryNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LaboratoryNum is required in URL' } };
        }

        const laboratoryData: any = {};

        // Optional fields for update
        if (params.Description !== undefined) laboratoryData.Description = params.Description;
        if (params.Phone !== undefined) laboratoryData.Phone = params.Phone;
        if (params.Notes !== undefined) laboratoryData.Notes = params.Notes;
        if (params.Slip !== undefined) laboratoryData.Slip = params.Slip;
        if (params.Address !== undefined) laboratoryData.Address = params.Address;
        if (params.City !== undefined) laboratoryData.City = params.City;
        if (params.State !== undefined) laboratoryData.State = params.State;
        if (params.Zip !== undefined) laboratoryData.Zip = params.Zip;
        if (params.Email !== undefined) laboratoryData.Email = params.Email;
        if (params.WirelessPhone !== undefined) laboratoryData.WirelessPhone = params.WirelessPhone;
        if (params.IsHidden !== undefined) laboratoryData.IsHidden = params.IsHidden;

        try {
          const updatedLaboratory = await odClient.request('PUT', `laboratories/${params.LaboratoryNum}`, { data: laboratoryData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedLaboratory } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Laboratory not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid laboratory data' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update laboratory' } };
        }
      }

      // ===== MEDICATIONPATS TOOLS =====
      case 'getMedicationPat': {
        // Get a single medicationpat by MedicationPatNum
        if (!params.MedicationPatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'MedicationPatNum is required' } };
        }
        try {
          const medicationPat = await odClient.request('GET', `medicationpats/${params.MedicationPatNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: medicationPat } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'MedicationPat not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get medicationpat' } };
        }
      }

      case 'getMedicationPats': {
        // Get multiple medicationpats, optionally filtered by PatNum and includeDiscontinued
        try {
          const queryParams: any = {};
          if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
          if (params.includeDiscontinued !== undefined) queryParams.includeDiscontinued = params.includeDiscontinued;

          const medicationPats = await odClient.request('GET', 'medicationpats', { params: queryParams });
          const medicationPatsArray = Array.isArray(medicationPats) ? medicationPats : medicationPats?.items ?? [];
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: { items: medicationPatsArray },
              message: `Found ${medicationPatsArray.length} medicationpat(s)`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No medicationpats found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get medicationpats' } };
        }
      }

      case 'createMedicationPat': {
        // Create a new medicationpat
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.MedicationNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'MedicationNum is required' } };
        }

        const medicationPatData: any = {
          PatNum: params.PatNum,
          MedicationNum: params.MedicationNum,
        };

        // Optional fields
        if (params.PatNote !== undefined) medicationPatData.PatNote = params.PatNote;
        if (params.DateStart !== undefined) medicationPatData.DateStart = params.DateStart;
        if (params.DateStop !== undefined) medicationPatData.DateStop = params.DateStop;
        if (params.ProvNum !== undefined) medicationPatData.ProvNum = params.ProvNum;

        try {
          const newMedicationPat = await odClient.request('POST', 'medicationpats', { data: medicationPatData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newMedicationPat } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid medicationpat data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient or medication not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create medicationpat' } };
        }
      }

      case 'updateMedicationPat': {
        // Update an existing medicationpat
        if (!params.MedicationPatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'MedicationPatNum is required in URL' } };
        }

        const medicationPatData: any = {};

        // Optional fields for update
        if (params.PatNote !== undefined) medicationPatData.PatNote = params.PatNote;
        if (params.DateStart !== undefined) medicationPatData.DateStart = params.DateStart;
        if (params.DateStop !== undefined) medicationPatData.DateStop = params.DateStop;
        if (params.ProvNum !== undefined) medicationPatData.ProvNum = params.ProvNum;

        try {
          const updatedMedicationPat = await odClient.request('PUT', `medicationpats/${params.MedicationPatNum}`, { data: medicationPatData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedMedicationPat } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'MedicationPat not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid medicationpat data' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update medicationpat' } };
        }
      }

      case 'deleteMedicationPat': {
        // Delete a medicationpat
        if (!params.MedicationPatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'MedicationPatNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `medicationpats/${params.MedicationPatNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'MedicationPat deleted successfully' } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'MedicationPat not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Cannot delete medicationpat' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete medicationpat' } };
        }
      }

      // ===== MEDICATIONS TOOLS =====
      case 'getMedications': {
        // Get the list of medications that can be assigned to patients
        try {
          const medications = await odClient.request('GET', 'medications');
          const medicationsArray = Array.isArray(medications) ? medications : medications?.items ?? [];
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: medicationsArray,
              count: medicationsArray.length
            }
          };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get medications' } };
        }
      }

      case 'createMedication': {
        // Create a new medication
        if (!params.MedName) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'MedName is required' } };
        }

        const medicationData: any = {
          MedName: params.MedName,
        };

        // Optional fields
        if (params.genericName !== undefined) medicationData.genericName = params.genericName;
        if (params.Notes !== undefined) medicationData.Notes = params.Notes;

        try {
          const newMedication = await odClient.request('POST', 'medications', { data: medicationData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newMedication } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Missing or invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No medication with that genericName was found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create medication' } };
        }
      }

      // ===== LABTURNAROUNDS TOOLS =====
      case 'getLabTurnaround': {
        // Get a single labturnaround by LabTurnaroundNum
        if (!params.LabTurnaroundNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LabTurnaroundNum is required' } };
        }
        try {
          const labTurnaround = await odClient.request('GET', `labturnarounds/${params.LabTurnaroundNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: labTurnaround } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Lab turnaround not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get lab turnaround' } };
        }
      }

      case 'getLabTurnarounds': {
        // Get multiple labturnarounds with optional filtering
        const queryParams: any = {};
        if (params.LaboratoryNum) queryParams.LaboratoryNum = params.LaboratoryNum;

        try {
          const labTurnarounds = await odClient.request('GET', 'labturnarounds', { params: queryParams });
          const labTurnaroundsArray = Array.isArray(labTurnarounds) ? labTurnarounds : labTurnarounds?.items ?? [];
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: { items: labTurnaroundsArray },
              message: `Found ${labTurnaroundsArray.length} lab turnaround(s)`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No lab turnarounds found matching criteria' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get lab turnarounds' } };
        }
      }

      case 'createLabTurnaround': {
        // Create a new labturnaround
        if (!params.LaboratoryNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LaboratoryNum is required' } };
        }
        if (!params.Description) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Description is required' } };
        }
        if (params.DaysActual === undefined) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'DaysActual is required' } };
        }

        const labTurnaroundData: any = {
          LaboratoryNum: params.LaboratoryNum,
          Description: params.Description,
          DaysActual: params.DaysActual,
        };

        // Optional fields
        if (params.DaysPublished !== undefined) labTurnaroundData.DaysPublished = params.DaysPublished;

        try {
          const newLabTurnaround = await odClient.request('POST', 'labturnarounds', { data: labTurnaroundData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newLabTurnaround } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid lab turnaround data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Laboratory not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create lab turnaround' } };
        }
      }

      case 'updateLabTurnaround': {
        // Update an existing labturnaround
        if (!params.LabTurnaroundNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'LabTurnaroundNum is required in URL' } };
        }

        const labTurnaroundData: any = {};

        // Optional fields for update
        if (params.Description !== undefined) labTurnaroundData.Description = params.Description;
        if (params.DaysPublished !== undefined) labTurnaroundData.DaysPublished = params.DaysPublished;
        if (params.DaysActual !== undefined) labTurnaroundData.DaysActual = params.DaysActual;

        try {
          const updatedLabTurnaround = await odClient.request('PUT', `labturnarounds/${params.LabTurnaroundNum}`, { data: labTurnaroundData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedLabTurnaround } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Lab turnaround not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid lab turnaround data' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update lab turnaround' } };
        }
      }

      // ===== OPERATORIES TOOLS =====
      case 'getOperatory': {
        // Get a single operatory by OperatoryNum
        if (!params.OperatoryNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'OperatoryNum is required' } };
        }
        try {
          const operatory = await odClient.request('GET', `operatories/${params.OperatoryNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: operatory } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Operatory not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get operatory' } };
        }
      }

      case 'getOperatories': {
        // Get multiple operatories with optional clinic filtering
        const queryParams: any = {};
        if (params.ClinicNum) queryParams.ClinicNum = params.ClinicNum;
        try {
          const operatories = await odClient.request('GET', 'operatories', { params: queryParams });
          return { statusCode: 200, body: { status: 'SUCCESS', data: operatories } };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get operatories' } };
        }
      }

      // ===== PATFIELDDEFS TOOLS =====
      case 'getPatFieldDefs': {
        // Get all patient field definitions
        try {
          const patFieldDefs = await odClient.request('GET', 'patfielddefs');
          return { statusCode: 200, body: { status: 'SUCCESS', data: patFieldDefs } };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get patient field definitions' } };
        }
      }

      case 'createPatFieldDef': {
        // Create a new patient field definition
        if (!params.FieldName) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'FieldName is required' } };
        }
        if (!params.FieldType) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'FieldType is required' } };
        }

        const patFieldDefData: any = {
          FieldName: params.FieldName,
          FieldType: params.FieldType,
        };

        // Optional fields
        if (params.PickList !== undefined) patFieldDefData.PickList = params.PickList;
        if (params.IsHidden !== undefined) patFieldDefData.IsHidden = params.IsHidden;

        try {
          const newPatFieldDef = await odClient.request('POST', 'patfielddefs', { data: patFieldDefData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newPatFieldDef } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Failed to create patient field definition' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create patient field definition' } };
        }
      }

      case 'updatePatFieldDef': {
        // Update an existing patient field definition
        if (!params.PatFieldDefNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatFieldDefNum is required in URL' } };
        }

        const patFieldDefData: any = {};

        // Optional fields for update
        if (params.FieldName !== undefined) patFieldDefData.FieldName = params.FieldName;
        if (params.FieldType !== undefined) patFieldDefData.FieldType = params.FieldType;
        if (params.PickList !== undefined) patFieldDefData.PickList = params.PickList;
        if (params.IsHidden !== undefined) patFieldDefData.IsHidden = params.IsHidden;

        try {
          const updatedPatFieldDef = await odClient.request('PUT', `patfielddefs/${params.PatFieldDefNum}`, { data: patFieldDefData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedPatFieldDef } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient field definition not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Failed to update patient field definition' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update patient field definition' } };
        }
      }

      case 'deletePatFieldDef': {
        // Delete a patient field definition
        if (!params.PatFieldDefNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatFieldDefNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `patfielddefs/${params.PatFieldDefNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Patient field definition deleted successfully' } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient field definition not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Cannot delete patient field definition that is in use' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete patient field definition' } };
        }
      }

      // ===== PATFIELDS TOOLS =====
      case 'getPatField': {
        // PatFields GET (single) - Version Added: 22.4
        // Gets a single PatField. PatFieldNum is required in the URL.
        if (!params.PatFieldNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatFieldNum is required in URL' } };
        }

        try {
          const patField = await odClient.request('GET', `patfields/${params.PatFieldNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data: patField } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient field not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get patient field' } };
        }
      }

      case 'getPatFields': {
        // PatFields GET (multiple) - Version Added: 21.1
        // Gets a list of PatFields. All parameters optional (PatNum and FieldName optional after version 22.4.5)
        // Parameters: PatNum (patient's PatNum), FieldName (FK to patFieldDef.FieldName, case sensitive),
        // SecDateTEdit (timestamp in "yyyy-MM-dd HH:mm:ss" format, added in version 22.4.5)
        try {
          const queryParams: any = {};

          // Optional parameters
          if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
          if (params.FieldName !== undefined) queryParams.FieldName = params.FieldName;
          if (params.SecDateTEdit !== undefined) queryParams.SecDateTEdit = params.SecDateTEdit;

          const patFields = await odClient.request('GET', 'patfields', { params: queryParams });
          return { statusCode: 200, body: { status: 'SUCCESS', data: patFields } };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get patient fields' } };
        }
      }

      case 'createPatField': {
        // PatFields POST (create) - Version Added: 22.4
        // Creates a patfield. Cannot create PatFields associated with hidden PatFieldDefs.
        // FieldValue relies on PatFieldDef.FieldType for validation.
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.FieldName) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'FieldName is required' } };
        }
        if (params.FieldValue === undefined) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'FieldValue is required' } };
        }

        // Basic field type validation based on common patterns
        const fieldValue = params.FieldValue;
        if (typeof fieldValue === 'boolean') {
          // Convert boolean to "1" for Checkbox type
          params.FieldValue = fieldValue ? '1' : '0';
        } else if (typeof fieldValue === 'number') {
          // Convert number to string for Currency type
          params.FieldValue = fieldValue.toString();
        }

        const patFieldData: any = {
          PatNum: params.PatNum,
          FieldName: params.FieldName,
          FieldValue: params.FieldValue,
        };

        try {
          const newPatField = await odClient.request('POST', 'patfields', { data: patFieldData });
          return { statusCode: 201, body: { status: 'SUCCESS', data: newPatField } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Failed to create patient field' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: error.response?.data?.message || 'Patient or field definition not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create patient field' } };
        }
      }

      case 'updatePatField': {
        // PatFields PUT - Version Added: 21.1
        // Updates an existing patfield. FieldValue relies on PatFieldDef.FieldType for validation.
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.FieldName) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'FieldName is required' } };
        }
        if (params.FieldValue === undefined) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'FieldValue is required' } };
        }

        // Basic field type validation based on common patterns
        const fieldValue = params.FieldValue;
        if (typeof fieldValue === 'boolean') {
          // Convert boolean to "1" for Checkbox type
          params.FieldValue = fieldValue ? '1' : '0';
        } else if (typeof fieldValue === 'number') {
          // Convert number to string for Currency type
          params.FieldValue = fieldValue.toString();
        }

        const patFieldData: any = {
          PatNum: params.PatNum,
          FieldName: params.FieldName,
          FieldValue: params.FieldValue,
        };

        try {
          const updatedPatField = await odClient.request('PUT', 'patfields', { data: patFieldData });
          return { statusCode: 200, body: { status: 'SUCCESS', data: updatedPatField } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: error.response?.data?.message || 'Patient field not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Failed to update patient field' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update patient field' } };
        }
      }

      case 'deletePatField': {
        // PatFields DELETE - Version Added: 22.4
        // Deletes a patfield. Will not delete a PatField with an associated PatFieldDef of type CareCreditStatus.
        if (!params.PatFieldNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatFieldNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `patfields/${params.PatFieldNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Patient field deleted successfully' } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient field not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Cannot delete patient field (may be CareCreditStatus type)' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete patient field' } };
        }
      }

      // ===== PATIENT NOTES TOOLS =====
      case 'getPatientNote': {
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required in URL' } };
        }

        try {
          const data = await odClient.request('GET', `patientnotes/${params.PatNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', data } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient note not found' } };
          }
          throw error;
        }
      }

      case 'getPatientNotes': {
        try {
          const data = await odClient.request('GET', 'patientnotes');
          return { statusCode: 200, body: { status: 'SUCCESS', data } };
        } catch (error: any) {
          throw error;
        }
      }

      case 'updatePatientNote': {
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required in URL' } };
        }

        // Build update data from provided parameters
        const updateData: any = {};
        if (params.FamFinancial !== undefined) updateData.FamFinancial = params.FamFinancial;
        if (params.Medical !== undefined) updateData.Medical = params.Medical;
        if (params.Service !== undefined) updateData.Service = params.Service;
        if (params.MedicalComp !== undefined) updateData.MedicalComp = params.MedicalComp;
        if (params.Treatment !== undefined) updateData.Treatment = params.Treatment;
        if (params.ICEName !== undefined) updateData.ICEName = params.ICEName;
        if (params.ICEPhone !== undefined) updateData.ICEPhone = params.ICEPhone;

        if (Object.keys(updateData).length === 0) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'At least one field to update must be provided' } };
        }

        try {
          const data = await odClient.request('PUT', `patientnotes/${params.PatNum}`, { data: updateData });
          return { statusCode: 200, body: { status: 'SUCCESS', data } };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient note not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid update data' } };
          }
          throw error;
        }
      }

      // ===== SHEETS TOOLS =====
      case 'getSheets': {
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        try {
          const queryParams: any = { PatNum: params.PatNum };
          if (params.Offset !== undefined) {
            queryParams.Offset = params.Offset;
          }

          const data = await odClient.request('GET', 'sheets', { params: queryParams });
          const sheets = Array.isArray(data) ? data : [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: { items: sheets },
              message: `Found ${sheets.length} sheet(s) for patient ${params.PatNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient not found or no sheets available' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request parameters' } };
          }
          throw error;
        }
      }

      case 'createSheet': {
        if (!params.SheetDefNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SheetDefNum is required' } };
        }
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        try {
          const requestData: any = {
            SheetDefNum: params.SheetDefNum,
            PatNum: params.PatNum
          };

          if (params.InternalNote !== undefined) {
            requestData.InternalNote = params.InternalNote;
          }

          const data = await odClient.request('POST', 'sheets', { data: requestData });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data,
              message: `Sheet created successfully for patient ${params.PatNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'SheetDef or patient not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid sheet creation parameters' } };
          }
          throw error;
        }
      }

      case 'downloadSheetSftp': {
        if (!params.SheetNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SheetNum is required' } };
        }
        if (!params.SftpAddress) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SftpAddress is required' } };
        }
        if (!params.SftpUsername) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SftpUsername is required' } };
        }
        if (!params.SftpPassword) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SftpPassword is required' } };
        }

        try {
          const requestData = {
            SheetNum: params.SheetNum,
            SftpAddress: params.SftpAddress,
            SftpUsername: params.SftpUsername,
            SftpPassword: params.SftpPassword
          };

          const response = await odClient.request('POST', 'sheets/DownloadSftp', { data: requestData });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: response,
              message: `Sheet PDF downloaded successfully to SFTP location`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Sheet not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid SFTP download parameters or connection error' } };
          }
          throw error;
        }
      }

      // ===== SHEETFIELDS TOOLS =====
      case 'getSheetField': {
        if (!params.SheetFieldNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SheetFieldNum is required' } };
        }

        try {
          const data = await odClient.request('GET', `sheetfields/${params.SheetFieldNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data,
              message: `Retrieved SheetField ${params.SheetFieldNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'SheetField not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request' } };
          }
          throw error;
        }
      }

      case 'getSheetFields': {
        try {
          const queryParams: any = {};
          if (params.SheetNum !== undefined) {
            queryParams.SheetNum = params.SheetNum;
          }
          if (params.Offset !== undefined) {
            queryParams.Offset = params.Offset;
          }

          const data = await odClient.request('GET', 'sheetfields', { params: queryParams });
          const sheetFields = Array.isArray(data) ? data : [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: { items: sheetFields },
              message: `Found ${sheetFields.length} sheetfield(s)`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No sheetfields found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request parameters' } };
          }
          throw error;
        }
      }

      case 'updateSheetField': {
        if (!params.SheetFieldNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'SheetFieldNum is required' } };
        }

        try {
          const updateData: any = {};
          if (params.FieldValue !== undefined) {
            updateData.FieldValue = params.FieldValue;
          }

          const data = await odClient.request('PUT', `sheetfields/${params.SheetFieldNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data,
              message: `Updated SheetField ${params.SheetFieldNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'SheetField not found' } };
          }
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid update data or unsupported field type' } };
          }
          throw error;
        }
      }

      case 'getSignalods': {
        return await getSignalods(params, odClient);
      }

      // ===== SUBSCRIPTIONS TOOLS =====
      case 'createSubscription': {
        try {
          const data = await odClient.request('POST', 'subscriptions', { body: params });
          return { statusCode: 201, body: { status: 'SUCCESS', data } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Bad Request' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create subscription' } };
        }
      }

      case 'getSubscriptions': {
        try {
          const data = await odClient.request('GET', 'subscriptions');
          return { statusCode: 200, body: { status: 'SUCCESS', data: Array.isArray(data) ? data : [] } };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get subscriptions' } };
        }
      }

      case 'updateSubscription': {
        try {
          const subscriptionNum = params.SubscriptionNum;
          if (!subscriptionNum) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'SubscriptionNum is required' } };
          }

          // Remove SubscriptionNum from params as it's used in URL
          const { SubscriptionNum, ...updateData } = params;
          const data = await odClient.request('PUT', `subscriptions/${subscriptionNum}`, { body: updateData });
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Subscription updated successfully' } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Subscription not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update subscription' } };
        }
      }

      case 'deleteSubscription': {
        try {
          const subscriptionNum = params.SubscriptionNum;
          if (!subscriptionNum) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'SubscriptionNum is required' } };
          }

          await odClient.request('DELETE', `subscriptions/${subscriptionNum}`);
          return { statusCode: 200, body: { status: 'SUCCESS', message: 'Subscription deleted successfully' } };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid fields' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Subscription not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete subscription' } };
        }
      }

      case 'TaskLists GET': {
        try {
          // TaskListStatus is optional: "Active" or "Archived", defaults to "Active"
          const taskListStatus = params.TaskListStatus || 'Active';

          // Validate TaskListStatus parameter
          if (taskListStatus !== 'Active' && taskListStatus !== 'Archived') {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'Invalid TaskListStatus. Must be "Active" or "Archived".' }
            };
          }

          const queryParams: any = { TaskListStatus: taskListStatus };
          // Add Offset if provided (for pagination)
          if (params.Offset !== undefined && params.Offset !== null) {
            queryParams.Offset = params.Offset;
          }

          const data = await odClient.request('GET', 'tasklists', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: `Retrieved task lists with status: ${taskListStatus}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid TaskListStatus parameter' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve task lists' } };
        }
      }

      case 'TaskNotes PUT (update)': {
        try {
          const taskNoteNum = params.TaskNoteNum;
          if (!taskNoteNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'TaskNoteNum is required in URL' }
            };
          }

          const requestBody: any = {};

          // Add optional DateTimeNote parameter
          if (params.DateTimeNote !== undefined && params.DateTimeNote !== null) {
            requestBody.DateTimeNote = params.DateTimeNote;
          }

          // Add optional Note parameter
          if (params.Note !== undefined && params.Note !== null) {
            if (params.Note.trim() === '') {
              return {
                statusCode: 400,
                body: { status: 'FAILURE', message: 'Note cannot be blank' }
              };
            }
            requestBody.Note = params.Note.trim();
          }

          // Check if at least one field is being updated
          if (Object.keys(requestBody).length === 0) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'At least one field (DateTimeNote or Note) must be provided for update' }
            };
          }

          const data = await odClient.request('PUT', `tasknotes/${taskNoteNum}`, { data: requestBody });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Task note ${taskNoteNum} updated successfully`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Task note not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update task note' } };
        }
      }

      case 'TaskNotes POST (create)': {
        try {
          const { TaskNum, UserNum, Note } = params;

          // Validate required fields
          if (!TaskNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'TaskNum is required' }
            };
          }
          if (!UserNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'UserNum is required' }
            };
          }
          if (!Note || Note.trim() === '') {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'Note is required and cannot be blank' }
            };
          }

          const requestBody = {
            TaskNum: TaskNum,
            UserNum: UserNum,
            Note: Note.trim()
          };

          const data = await odClient.request('POST', 'tasknotes', { data: requestBody });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: data,
              message: 'Task note created successfully'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Related task or user not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create task note' } };
        }
      }

      case 'TaskNotes GET (multiple)': {
        try {
          const queryParams: any = {};

          // Add optional TaskNum parameter
          if (params.TaskNum !== undefined && params.TaskNum !== null) {
            queryParams.TaskNum = params.TaskNum;
          }

          // Add optional UserNum parameter
          if (params.UserNum !== undefined && params.UserNum !== null) {
            queryParams.UserNum = params.UserNum;
          }

          const data = await odClient.request('GET', 'tasknotes', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved task notes'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Task notes not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve task notes' } };
        }
      }

      case 'TaskNotes GET (single)': {
        try {
          const taskNoteNum = params.TaskNoteNum;
          if (!taskNoteNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'TaskNoteNum is required' }
            };
          }

          const data = await odClient.request('GET', `tasknotes/${taskNoteNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved task note ${taskNoteNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Task note not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve task note' } };
        }
      }

      // ===== TASKS TOOLS =====
      case 'Tasks GET (single)': {
        try {
          const taskNum = params.TaskNum;
          if (!taskNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'TaskNum is required in URL' }
            };
          }

          const data = await odClient.request('GET', `tasks/${taskNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved task ${taskNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Task not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve task' } };
        }
      }

      case 'Tasks GET (multiple)': {
        try {
          const queryParams: any = {};

          // Add optional TaskListNum parameter
          if (params.TaskListNum !== undefined && params.TaskListNum !== null) {
            queryParams.TaskListNum = params.TaskListNum;
          }

          // Add optional KeyNum parameter
          if (params.KeyNum !== undefined && params.KeyNum !== null) {
            queryParams.KeyNum = params.KeyNum;
          }

          // Add optional ObjectType parameter
          if (params.ObjectType !== undefined && params.ObjectType !== null) {
            queryParams.ObjectType = params.ObjectType;
          }

          // Add optional TaskStatus parameter
          if (params.TaskStatus !== undefined && params.TaskStatus !== null) {
            queryParams.TaskStatus = params.TaskStatus;
          }

          // Add optional DateTimeOriginal parameter
          if (params.DateTimeOriginal !== undefined && params.DateTimeOriginal !== null) {
            queryParams.DateTimeOriginal = params.DateTimeOriginal;
          }

          const data = await odClient.request('GET', 'tasks', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved tasks'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient or appointment not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve tasks' } };
        }
      }

      case 'Tasks POST (create)': {
        try {
          const { TaskListNum, Descript, UserNum, KeyNum, ObjectType, DateTimeEntry, PriorityDefNum, DescriptOverride, Category } = params;

          // Validate required fields
          if (!TaskListNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'TaskListNum is required' }
            };
          }
          if (!Descript || Descript.trim() === '') {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'Descript is required and cannot be blank' }
            };
          }
          if (!UserNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'UserNum is required' }
            };
          }

          const requestBody: any = {
            TaskListNum: TaskListNum,
            Descript: Descript.trim(),
            UserNum: UserNum
          };

          // Add optional fields
          if (KeyNum !== undefined && KeyNum !== null) {
            requestBody.KeyNum = KeyNum;
          }
          if (ObjectType !== undefined && ObjectType !== null) {
            requestBody.ObjectType = ObjectType;
          }
          if (DateTimeEntry !== undefined && DateTimeEntry !== null) {
            requestBody.DateTimeEntry = DateTimeEntry;
          }
          if (PriorityDefNum !== undefined && PriorityDefNum !== null) {
            requestBody.PriorityDefNum = PriorityDefNum;
          }
          if (DescriptOverride !== undefined && DescriptOverride !== null) {
            requestBody.DescriptOverride = DescriptOverride;
          }
          if (Category !== undefined && Category !== null) {
            requestBody.Category = Category;
          }

          const data = await odClient.request('POST', 'tasks', { data: requestBody });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: data,
              message: 'Task created successfully'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient or appointment not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create task' } };
        }
      }

      case 'Tasks PUT (update)': {
        try {
          const taskNum = params.TaskNum;
          if (!taskNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'TaskNum is required in URL' }
            };
          }

          const requestBody: any = {};

          // Add optional Descript parameter
          if (params.Descript !== undefined && params.Descript !== null) {
            if (params.Descript.trim() === '') {
              return {
                statusCode: 400,
                body: { status: 'FAILURE', message: 'Descript cannot be blank' }
              };
            }
            requestBody.Descript = params.Descript.trim();
          }

          // Add optional TaskStatus parameter
          if (params.TaskStatus !== undefined && params.TaskStatus !== null) {
            requestBody.TaskStatus = params.TaskStatus;
          }

          // Add optional KeyNum parameter
          if (params.KeyNum !== undefined && params.KeyNum !== null) {
            requestBody.KeyNum = params.KeyNum;
          }

          // Add optional ObjectType parameter
          if (params.ObjectType !== undefined && params.ObjectType !== null) {
            requestBody.ObjectType = params.ObjectType;
          }

          // Add optional DateTimeEntry parameter
          if (params.DateTimeEntry !== undefined && params.DateTimeEntry !== null) {
            requestBody.DateTimeEntry = params.DateTimeEntry;
          }

          // Add optional PriorityDefNum parameter
          if (params.PriorityDefNum !== undefined && params.PriorityDefNum !== null) {
            requestBody.PriorityDefNum = params.PriorityDefNum;
          }

          // Add optional DescriptOverride parameter
          if (params.DescriptOverride !== undefined && params.DescriptOverride !== null) {
            requestBody.DescriptOverride = params.DescriptOverride;
          }

          // Add optional Category parameter
          if (params.Category !== undefined && params.Category !== null) {
            requestBody.Category = params.Category;
          }

          // Check if at least one field is being updated
          if (Object.keys(requestBody).length === 0) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'At least one field must be provided for update' }
            };
          }

          const data = await odClient.request('PUT', `tasks/${taskNum}`, { data: requestBody });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Task ${taskNum} updated successfully`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Task not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update task' } };
        }
      }

      // ===== USERGROUPS TOOLS =====
      case 'UserGroups GET': {
        try {
          const queryParams: any = {};

          // Add optional includeCEMT parameter
          if (params.includeCEMT !== undefined && params.includeCEMT !== null) {
            queryParams.includeCEMT = params.includeCEMT;
          }

          const data = await odClient.request('GET', 'usergroups', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved ${Array.isArray(data) ? data.length : 0} user groups`
            }
          };
        } catch (error: any) {
          return {
            statusCode: 500,
            body: {
              status: 'FAILURE',
              message: error.message || 'Failed to get user groups'
            }
          };
        }
      }

      // ===== USERGROUPATTACHES TOOLS =====
      case 'UserGroupAttaches GET': {
        try {
          const queryParams: any = {};

          // Add optional UserNum parameter
          if (params.UserNum !== undefined && params.UserNum !== null) {
            queryParams.UserNum = params.UserNum;
          }

          // Add optional UserGroupNum parameter
          if (params.UserGroupNum !== undefined && params.UserGroupNum !== null) {
            queryParams.UserGroupNum = params.UserGroupNum;
          }

          const data = await odClient.request('GET', 'usergroupattaches', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved usergroupattaches'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'User group attaches not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve usergroupattaches' } };
        }
      }

      // ===== USERODS TOOLS =====
      case 'Userods GET': {
        try {
          const queryParams: any = {};

          // Add optional includeHidden parameter
          if (params.includeHidden !== undefined && params.includeHidden !== null) {
            queryParams.includeHidden = params.includeHidden;
          }

          // Add optional includeCEMT parameter
          if (params.includeCEMT !== undefined && params.includeCEMT !== null) {
            queryParams.includeCEMT = params.includeCEMT;
          }

          const data = await odClient.request('GET', 'userods', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved ${Array.isArray(data) ? data.length : 0} users`
            }
          };
        } catch (error: any) {
          return {
            statusCode: 500,
            body: {
              status: 'FAILURE',
              message: error.message || 'Failed to get users'
            }
          };
        }
      }

      case 'Userods POST (create)': {
        try {
          // Validate required parameters
          if (!params.UserName) {
            return {
              statusCode: 400,
              body: {
                status: 'FAILURE',
                message: 'UserName is required'
              }
            };
          }

          if (!params.UserGroupNum) {
            return {
              statusCode: 400,
              body: {
                status: 'FAILURE',
                message: 'UserGroupNum is required'
              }
            };
          }

          if (!params.Password) {
            return {
              statusCode: 400,
              body: {
                status: 'FAILURE',
                message: 'Password is required'
              }
            };
          }

          // Prepare create data
          const createData: any = {
            UserName: params.UserName,
            UserGroupNum: params.UserGroupNum,
            Password: params.Password
          };

          // Add optional IsPasswordResetRequired parameter
          if (params.IsPasswordResetRequired !== undefined && params.IsPasswordResetRequired !== null) {
            createData.IsPasswordResetRequired = params.IsPasswordResetRequired;
          }

          const data = await odClient.request('POST', 'userods', { data: createData });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: data,
              message: 'User created successfully'
            }
          };
        } catch (error: any) {
          return {
            statusCode: 500,
            body: {
              status: 'FAILURE',
              message: error.message || 'Failed to create user'
            }
          };
        }
      }

      case 'Userods PUT (update)': {
        try {
          // Validate required UserNum parameter
          if (!params.UserNum) {
            return {
              statusCode: 400,
              body: {
                status: 'FAILURE',
                message: 'UserNum is required in the URL'
              }
            };
          }

          // Prepare update data with optional fields
          const updateData: any = {};

          if (params.userGroupNums !== undefined && params.userGroupNums !== null) {
            updateData.userGroupNums = params.userGroupNums;
          }

          if (params.EmployeeNum !== undefined && params.EmployeeNum !== null) {
            updateData.EmployeeNum = params.EmployeeNum;
          }

          if (params.ProviderNum !== undefined && params.ProviderNum !== null) {
            updateData.ProviderNum = params.ProviderNum;
          }

          if (params.ClinicNum !== undefined && params.ClinicNum !== null) {
            updateData.ClinicNum = params.ClinicNum;
          }

          if (params.IsHidden !== undefined && params.IsHidden !== null) {
            updateData.IsHidden = params.IsHidden;
          }

          if (params.IsPasswordResetRequired !== undefined && params.IsPasswordResetRequired !== null) {
            updateData.IsPasswordResetRequired = params.IsPasswordResetRequired;
          }

          const data = await odClient.request('PUT', `userods/${params.UserNum}`, { data: updateData });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: 'User updated successfully'
            }
          };
        } catch (error: any) {
          return {
            statusCode: 500,
            body: {
              status: 'FAILURE',
              message: error.message || 'Failed to update user'
            }
          };
        }
      }

      // ===== TOOTHINITIALS TOOLS =====
      case 'ToothInitials GET': {
        try {
          const queryParams: any = {};
          // Add optional PatNum parameter
          if (params.PatNum !== undefined && params.PatNum !== null) {
            queryParams.PatNum = params.PatNum;
          }

          const data = await odClient.request('GET', 'toothinitials', { params: queryParams });
          const toothInitials = Array.isArray(data) ? data : data?.items ?? [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: { items: toothInitials },
              message: `Retrieved ${toothInitials.length} tooth initial(s)${params.PatNum ? ` for patient ${params.PatNum}` : ''}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient or tooth initials not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve tooth initials' } };
        }
      }

      case 'ToothInitials POST (create)': {
        try {
          const { PatNum, ToothNum, InitialType } = params;

          // Validate required fields
          if (!PatNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'PatNum is required' }
            };
          }
          if (!ToothNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'ToothNum is required' }
            };
          }
          if (!InitialType) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'InitialType is required' }
            };
          }

          // Validate InitialType
          const validInitialTypes = ['Missing', 'Hidden', 'Primary'];
          if (!validInitialTypes.includes(InitialType)) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'InitialType must be one of: Missing, Hidden, Primary' }
            };
          }

          const requestBody = {
            PatNum: PatNum,
            ToothNum: ToothNum.toString(),
            InitialType: InitialType
          };

          const data = await odClient.request('POST', 'toothinitials', { data: requestBody });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Tooth initial created successfully for tooth ${ToothNum} with type ${InitialType}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Patient not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create tooth initial' } };
        }
      }

      case 'ToothInitials DELETE': {
        try {
          const toothInitialNum = params.ToothInitialNum;
          if (!toothInitialNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'ToothInitialNum is required in URL' }
            };
          }

          await odClient.request('DELETE', `toothinitials/${toothInitialNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: `Tooth initial ${toothInitialNum} deleted successfully`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request or tooth initial type not allowed for deletion' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Tooth initial not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete tooth initial' } };
        }
      }

      // ===== REFATTACHES TOOLS =====
      case 'RefAttaches GET': {
        // Gets a list of refattaches with optional filtering
        const queryParams: any = {};

        // Optional parameters
        if (params.ReferralNum !== undefined) queryParams.ReferralNum = params.ReferralNum;
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;
        if (params.DateTStamp !== undefined) queryParams.DateTStamp = params.DateTStamp;

        try {
          const refAttaches = await odClient.request('GET', 'refattaches', { params: queryParams });
          const attaches = Array.isArray(refAttaches) ? refAttaches : refAttaches?.items || refAttaches;

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: attaches,
              message: `Found ${attaches.length} refattach(es)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid search parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No refattaches found matching criteria' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to get refattaches' } };
        }
      }

      case 'RefAttaches POST (create)': {
        // Attaches a patient to a referral source
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        if (!params.ReferralNum && !params.referralName) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'Either ReferralNum or referralName is required' } };
        }

        const refAttachData: any = {
          PatNum: params.PatNum,
        };

        // Required: either ReferralNum or referralName
        if (params.ReferralNum !== undefined) refAttachData.ReferralNum = params.ReferralNum;
        if (params.referralName !== undefined) refAttachData.referralName = params.referralName;

        // Optional parameters
        if (params.RefDate !== undefined) refAttachData.RefDate = params.RefDate;
        if (params.ReferralType !== undefined) refAttachData.ReferralType = params.ReferralType;
        if (params.RefToStatus !== undefined) refAttachData.RefToStatus = params.RefToStatus;
        if (params.Note !== undefined) refAttachData.Note = params.Note;
        if (params.IsTransitionOfCare !== undefined) refAttachData.IsTransitionOfCare = params.IsTransitionOfCare;
        if (params.ProcNum !== undefined) refAttachData.ProcNum = params.ProcNum;
        if (params.DateProcComplete !== undefined) refAttachData.DateProcComplete = params.DateProcComplete;
        if (params.ProvNum !== undefined) refAttachData.ProvNum = params.ProvNum;

        try {
          const newRefAttach = await odClient.request('POST', 'refattaches', { data: refAttachData });
          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newRefAttach,
              message: 'Refattach created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid refattach data or validation error' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Referral not found or patient not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create refattach' } };
        }
      }

      case 'RefAttaches PUT (update)': {
        // Updates an existing refattach
        if (!params.RefAttachNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'RefAttachNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional parameters
        if (params.ReferralNum !== undefined) updateData.ReferralNum = params.ReferralNum;
        if (params.RefDate !== undefined) updateData.RefDate = params.RefDate;
        if (params.ReferralType !== undefined) updateData.ReferralType = params.ReferralType;
        if (params.RefToStatus !== undefined) updateData.RefToStatus = params.RefToStatus;
        if (params.Note !== undefined) updateData.Note = params.Note;
        if (params.IsTransitionOfCare !== undefined) updateData.IsTransitionOfCare = params.IsTransitionOfCare;
        if (params.ProcNum !== undefined) updateData.ProcNum = params.ProcNum;
        if (params.DateProcComplete !== undefined) updateData.DateProcComplete = params.DateProcComplete;
        if (params.ProvNum !== undefined) updateData.ProvNum = params.ProvNum;

        try {
          const updatedRefAttach = await odClient.request('PUT', `refattaches/${params.RefAttachNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedRefAttach,
              message: 'Refattach updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid update data' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Refattach not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update refattach' } };
        }
      }

      case 'RefAttaches DELETE': {
        // Deletes a refattach
        if (!params.RefAttachNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'RefAttachNum is required in URL' } };
        }

        try {
          await odClient.request('DELETE', `refattaches/${params.RefAttachNum}`);
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'Refattach deleted successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid request or refattach cannot be deleted' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Refattach not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to delete refattach' } };
        }
      }

      // ===== RECALLS TOOLS =====
      case 'Recalls GET': {
        // Gets a list of recalls
        const queryParams: any = {};

        // Optional parameters
        if (params.PatNum !== undefined) queryParams.PatNum = params.PatNum;

        try {
          const recalls = await odClient.request('GET', 'recalls', { params: queryParams });
          const recallsList = Array.isArray(recalls) ? recalls : recalls?.items ?? [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: recallsList,
              message: `Found ${recallsList.length} recall(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid request parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No recalls found' } };
          }
          throw error;
        }
      }

      case 'Recalls GET List': {
        // Gets the Recall List similar to how it's shown in the Appointment Module
        const queryParams: any = {};

        // Optional parameters
        if (params.DateStart !== undefined) queryParams.DateStart = params.DateStart;
        if (params.DateEnd !== undefined) queryParams.DateEnd = params.DateEnd;
        if (params.ProvNum !== undefined) queryParams.ProvNum = params.ProvNum;
        if (params.ClinicNum !== undefined) queryParams.ClinicNum = params.ClinicNum;
        if (params.RecallType !== undefined) queryParams.RecallType = params.RecallType;
        if (params.IncludeReminded !== undefined) queryParams.IncludeReminded = params.IncludeReminded;
        if (params.Offset !== undefined) queryParams.Offset = params.Offset;

        try {
          const recallList = await odClient.request('GET', 'recalls/List', { params: queryParams });
          const recalls = Array.isArray(recallList) ? recallList : recallList?.items ?? [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: recalls,
              message: `Found ${recalls.length} recall list item(s)`,
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid request parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: error.response?.data?.message || 'No recall list items found' } };
          }
          throw error;
        }
      }

      case 'Recalls POST (create)': {
        // Creates a recall for a patient
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.RecallTypeNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'RecallTypeNum is required' } };
        }

        const recallData: any = {
          PatNum: params.PatNum,
          RecallTypeNum: params.RecallTypeNum,
        };

        // Optional parameters
        if (params.DateDue !== undefined) recallData.DateDue = params.DateDue;
        if (params.RecallInterval !== undefined) recallData.RecallInterval = params.RecallInterval;
        if (params.RecallStatus !== undefined) recallData.RecallStatus = params.RecallStatus;
        if (params.Note !== undefined) recallData.Note = params.Note;
        if (params.IsDisabled !== undefined) recallData.IsDisabled = params.IsDisabled;
        if (params.DisableUntilBalance !== undefined) recallData.DisableUntilBalance = params.DisableUntilBalance;
        if (params.DisableUntilDate !== undefined) recallData.DisableUntilDate = params.DisableUntilDate;
        if (params.Priority !== undefined) recallData.Priority = params.Priority;
        if (params.TimePatternOverride !== undefined) recallData.TimePatternOverride = params.TimePatternOverride;

        try {
          const newRecall = await odClient.request('POST', 'recalls', { data: recallData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: newRecall,
              message: 'Recall created successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid recall data provided' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: error.response?.data?.message || 'Patient or recall type not found' } };
          }
          throw error;
        }
      }

      case 'Recalls PUT (update)': {
        // Updates a recall
        if (!params.RecallNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'RecallNum is required in URL' } };
        }

        const updateData: any = {};

        // Optional parameters
        if (params.DateDue !== undefined) updateData.DateDue = params.DateDue;
        if (params.RecallInterval !== undefined) updateData.RecallInterval = params.RecallInterval;
        if (params.RecallStatus !== undefined) updateData.RecallStatus = params.RecallStatus;
        if (params.Note !== undefined) updateData.Note = params.Note;
        if (params.IsDisabled !== undefined) updateData.IsDisabled = params.IsDisabled;
        if (params.DisableUntilBalance !== undefined) updateData.DisableUntilBalance = params.DisableUntilBalance;
        if (params.DisableUntilDate !== undefined) updateData.DisableUntilDate = params.DisableUntilDate;
        if (params.Priority !== undefined) updateData.Priority = params.Priority;
        if (params.TimePatternOverride !== undefined) updateData.TimePatternOverride = params.TimePatternOverride;

        try {
          const updatedRecall = await odClient.request('PUT', `recalls/${params.RecallNum}`, { data: updateData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedRecall,
              message: 'Recall updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid recall data provided' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: error.response?.data?.message || 'Recall not found' } };
          }
          throw error;
        }
      }

      case 'Recalls PUT Status': {
        // Updates the RecallStatus on a patient's recall
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }
        if (!params.recallType) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'recallType is required' } };
        }

        const statusData: any = {
          PatNum: params.PatNum,
          recallType: params.recallType,
        };

        // Optional parameters
        if (params.RecallStatus !== undefined) statusData.RecallStatus = params.RecallStatus;
        if (params.commlogMode !== undefined) statusData.commlogMode = params.commlogMode;
        if (params.commlogNote !== undefined) statusData.commlogNote = params.commlogNote;

        try {
          await odClient.request('PUT', 'recalls/Status', { data: statusData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'Recall status updated successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid status data provided' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: error.response?.data?.message || 'Patient or recall type not found' } };
          }
          throw error;
        }
      }

      case 'Recalls PUT SwitchType': {
        // Switches a Recall's type between Prophy and Perio
        if (!params.PatNum) {
          return { statusCode: 400, body: { status: 'FAILURE', message: 'PatNum is required' } };
        }

        const switchData: any = {
          PatNum: params.PatNum,
        };

        try {
          await odClient.request('PUT', 'recalls/SwitchType', { data: switchData });
          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              message: 'Recall type switched successfully',
            },
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: error.response?.data?.message || 'Invalid switch type request' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: error.response?.data?.message || 'Patient not found or no recall to switch' } };
          }
          throw error;
        }
      }

      // ===== RXPATS TOOLS =====
      case 'RxPats GET (single)': {
        try {
          const rxNum = params.RxNum;
          if (!rxNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'RxNum is required in URL' }
            };
          }

          const data = await odClient.request('GET', `rxpats/${rxNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved rxpat ${rxNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'RxPat not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve rxpat' } };
        }
      }

      case 'RxPats GET (multiple)': {
        try {
          const queryParams: any = {};

          // Optional PatNum parameter
          if (params.PatNum !== undefined && params.PatNum !== null) {
            queryParams.PatNum = params.PatNum;
          }

          const data = await odClient.request('GET', 'rxpats', { params: queryParams });
          const rxpatsList = Array.isArray(data) ? data : data?.items ?? [];

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: rxpatsList,
              message: `Found ${rxpatsList.length} rxpat(s)`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid request parameters' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'No rxpats found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve rxpats' } };
        }
      }

      // ===== REFERRALS TOOLS =====
      case 'Referrals GET (single)': {
        try {
          const referralNum = params.ReferralNum;
          if (!referralNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'ReferralNum is required in URL' }
            };
          }

          const data = await odClient.request('GET', `referrals/${referralNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved referral ${referralNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Referral not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve referral' } };
        }
      }

      case 'Referrals GET (multiple)': {
        try {
          const queryParams: any = {};

          // Add optional filter parameters
          if (params.IsHidden !== undefined && params.IsHidden !== null) {
            queryParams.IsHidden = params.IsHidden;
          }
          if (params.NotPerson !== undefined && params.NotPerson !== null) {
            queryParams.NotPerson = params.NotPerson;
          }
          if (params.IsDoctor !== undefined && params.IsDoctor !== null) {
            queryParams.IsDoctor = params.IsDoctor;
          }
          if (params.IsPreferred !== undefined && params.IsPreferred !== null) {
            queryParams.IsPreferred = params.IsPreferred;
          }
          if (params.isPatient !== undefined && params.isPatient !== null) {
            queryParams.isPatient = params.isPatient;
          }
          if (params.BusinessName !== undefined && params.BusinessName !== null) {
            queryParams.BusinessName = params.BusinessName;
          }

          const data = await odClient.request('GET', 'referrals', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved referrals'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve referrals' } };
        }
      }

      case 'Referrals POST (create)': {
        try {
          const {
            LName,
            PatNum,
            FName,
            MName,
            SSN,
            UsingTIN,
            Specialty,
            specialty,
            ST,
            Telephone,
            Address,
            Address2,
            City,
            Zip,
            Note,
            Phone2,
            NotPerson,
            Title,
            EMail,
            IsDoctor,
            BusinessName,
            DisplayNote
          } = params;

          // Validate required fields
          if (!LName || LName.trim() === '') {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'LName is required and cannot be blank' }
            };
          }

          const requestBody: any = { LName: LName.trim() };

          // Add optional fields
          if (PatNum !== undefined) requestBody.PatNum = PatNum;
          if (FName !== undefined) requestBody.FName = FName;
          if (MName !== undefined) requestBody.MName = MName;
          if (SSN !== undefined) requestBody.SSN = SSN;
          if (UsingTIN !== undefined) requestBody.UsingTIN = UsingTIN;
          if (Specialty !== undefined) requestBody.Specialty = Specialty;
          if (specialty !== undefined) requestBody.specialty = specialty;
          if (ST !== undefined) requestBody.ST = ST;
          if (Telephone !== undefined) requestBody.Telephone = Telephone;
          if (Address !== undefined) requestBody.Address = Address;
          if (Address2 !== undefined) requestBody.Address2 = Address2;
          if (City !== undefined) requestBody.City = City;
          if (Zip !== undefined) requestBody.Zip = Zip;
          if (Note !== undefined) requestBody.Note = Note;
          if (Phone2 !== undefined) requestBody.Phone2 = Phone2;
          if (NotPerson !== undefined) requestBody.NotPerson = NotPerson;
          if (Title !== undefined) requestBody.Title = Title;
          if (EMail !== undefined) requestBody.EMail = EMail;
          if (IsDoctor !== undefined) requestBody.IsDoctor = IsDoctor;
          if (BusinessName !== undefined) requestBody.BusinessName = BusinessName;
          if (DisplayNote !== undefined) requestBody.DisplayNote = DisplayNote;

          const newReferral = await odClient.request('POST', 'referrals', { data: requestBody });

          return {
            statusCode: 201,
            body: {
              status: 'SUCCESS',
              data: newReferral,
              message: 'Referral created successfully'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to create referral' } };
        }
      }

      case 'Referrals PUT (update)': {
        try {
          const referralNum = params.ReferralNum;
          if (!referralNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'ReferralNum is required in URL' }
            };
          }

          const requestBody: any = {};

          // Add optional fields
          if (params.LName !== undefined) requestBody.LName = params.LName;
          if (params.FName !== undefined) requestBody.FName = params.FName;
          if (params.MName !== undefined) requestBody.MName = params.MName;
          if (params.SSN !== undefined) requestBody.SSN = params.SSN;
          if (params.UsingTIN !== undefined) requestBody.UsingTIN = params.UsingTIN;
          if (params.Specialty !== undefined) requestBody.Specialty = params.Specialty;
          if (params.ST !== undefined) requestBody.ST = params.ST;
          if (params.Telephone !== undefined) requestBody.Telephone = params.Telephone;
          if (params.Address !== undefined) requestBody.Address = params.Address;
          if (params.Address2 !== undefined) requestBody.Address2 = params.Address2;
          if (params.City !== undefined) requestBody.City = params.City;
          if (params.Zip !== undefined) requestBody.Zip = params.Zip;
          if (params.Note !== undefined) requestBody.Note = params.Note;
          if (params.Phone2 !== undefined) requestBody.Phone2 = params.Phone2;
          if (params.NotPerson !== undefined) requestBody.NotPerson = params.NotPerson;
          if (params.Title !== undefined) requestBody.Title = params.Title;
          if (params.EMail !== undefined) requestBody.EMail = params.EMail;
          if (params.IsDoctor !== undefined) requestBody.IsDoctor = params.IsDoctor;
          if (params.BusinessName !== undefined) requestBody.BusinessName = params.BusinessName;
          if (params.DisplayNote !== undefined) requestBody.DisplayNote = params.DisplayNote;

          const updatedReferral = await odClient.request('PUT', `referrals/${referralNum}`, { data: requestBody });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: updatedReferral,
              message: `Referral ${referralNum} updated successfully`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Bad request with explanation' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Not found with explanation' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to update referral' } };
        }
      }

      // ===== RECALLTYPES TOOLS =====
      case 'RecallTypes GET (single)': {
        try {
          const recallTypeNum = params.RecallTypeNum;
          if (!recallTypeNum) {
            return {
              statusCode: 400,
              body: { status: 'FAILURE', message: 'RecallTypeNum is required in URL' }
            };
          }

          const data = await odClient.request('GET', `recalltypes/${recallTypeNum}`);

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: data,
              message: `Retrieved recalltype ${recallTypeNum}`
            }
          };
        } catch (error: any) {
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'RecallType not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve recalltype' } };
        }
      }

      case 'RecallTypes GET (multiple)': {
        try {
          const data = await odClient.request('GET', 'recalltypes');

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved recalltypes'
            }
          };
        } catch (error: any) {
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve recalltypes' } };
        }
      }

      // ===== REPORTS TOOLS =====
      case 'Reports GET Aging': {
        try {
          const queryParams: any = {};

          // Add optional DateAsOf parameter (defaults to today's date)
          if (params.DateAsOf !== undefined && params.DateAsOf !== null) {
            queryParams.DateAsOf = params.DateAsOf;
          }

          // Add optional ClinicNum parameter
          if (params.ClinicNum !== undefined && params.ClinicNum !== null) {
            queryParams.ClinicNum = params.ClinicNum;
          }

          // Add optional Offset parameter for pagination
          if (params.Offset !== undefined && params.Offset !== null) {
            queryParams.Offset = params.Offset;
          }

          const data = await odClient.request('GET', 'reports/Aging', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved aging report'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid parameters. DateAsOf must be in yyyy-MM-dd format.' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Clinic not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve aging report' } };
        }
      }

      case 'Reports GET FinanceCharges': {
        try {
          const queryParams: any = {};

          // Add optional DateFrom parameter (defaults to today's date)
          if (params.DateFrom !== undefined && params.DateFrom !== null) {
            queryParams.DateFrom = params.DateFrom;
          }

          // Add optional DateTo parameter (defaults to today's date)
          if (params.DateTo !== undefined && params.DateTo !== null) {
            queryParams.DateTo = params.DateTo;
          }

          // Add optional ProvNums parameter (array of ProvNums)
          if (params.ProvNums !== undefined && params.ProvNums !== null) {
            if (Array.isArray(params.ProvNums)) {
              queryParams.ProvNums = params.ProvNums;
            } else if (typeof params.ProvNums === 'string') {
              // Handle comma-separated string
              queryParams.ProvNums = params.ProvNums.split(',').map((s: string) => s.trim());
            } else {
              queryParams.ProvNums = [params.ProvNums];
            }
          }

          // Add optional BillingTypes parameter (array of DefNums)
          if (params.BillingTypes !== undefined && params.BillingTypes !== null) {
            if (Array.isArray(params.BillingTypes)) {
              queryParams.BillingTypes = params.BillingTypes;
            } else if (typeof params.BillingTypes === 'string') {
              // Handle comma-separated string
              queryParams.BillingTypes = params.BillingTypes.split(',').map((s: string) => s.trim());
            } else {
              queryParams.BillingTypes = [params.BillingTypes];
            }
          }

          const data = await odClient.request('GET', 'reports/FinanceCharges', { params: queryParams });

          return {
            statusCode: 200,
            body: {
              status: 'SUCCESS',
              data: Array.isArray(data) ? data : data?.items ?? [],
              message: 'Retrieved finance charges report'
            }
          };
        } catch (error: any) {
          if (error.response?.status === 400) {
            return { statusCode: 400, body: { status: 'FAILURE', message: 'Invalid parameters. Dates must be in yyyy-MM-dd format.' } };
          }
          if (error.response?.status === 404) {
            return { statusCode: 404, body: { status: 'FAILURE', message: 'Report data not found' } };
          }
          return { statusCode: 500, body: { status: 'FAILURE', message: error.message || 'Failed to retrieve finance charges report' } };
        }
      }

      default:
        return {
          statusCode: 400,
          body: { status: 'FAILURE', message: `Unknown tool: ${toolName}` },
        };
    }
  } catch (error: any) {
    console.error(`Tool ${toolName} error:`, error);

    // For public website visitors, do NOT return internal/OpenDental error text.
    const isPublicRequest = sessionAttributes?.isPublicRequest === 'true';
    const safeMessage = isPublicRequest
      ? 'We couldn’t complete that request right now. Please try again, or call the office and we’ll help you.'
      : (error.message || 'Tool execution failed');

    return {
      statusCode: 500,
      body: { status: 'FAILURE', message: safeMessage },
    };
  }
}

// ========================================================================
// INSURANCE PLAN BENEFITS LOOKUP FUNCTIONS
// ========================================================================

/**
 * Common insurance name aliases and variations
 * Maps common variations to canonical names for better matching
 */
const INSURANCE_NAME_ALIASES: Record<string, string[]> = {
  'metlife': ['metlife', 'met life', 'metropolitan life', 'metlife dental'],
  'delta dental': ['delta dental', 'delta', 'deltadental'],
  'cigna': ['cigna', 'cigna dental', 'cigna health'],
  'aetna': ['aetna', 'aetna dental', 'aetna dmhc'],
  'united healthcare': ['united healthcare', 'uhc', 'united health', 'unitedhealthcare', 'united concordia'],
  'bcbs': ['bcbs', 'blue cross', 'blue shield', 'blue cross blue shield', 'anthem', 'anthem bcbs'],
  'guardian': ['guardian', 'guardian dental', 'guardian life'],
  'principal': ['principal', 'principal dental', 'principal financial'],
  'humana': ['humana', 'humana dental'],
  'lincoln': ['lincoln', 'lincoln financial', 'lincoln dental'],
  'ameritas': ['ameritas', 'ameritas life'],
  'sun life': ['sun life', 'sunlife'],
  'husky': ['husky', 'husky health', 'husky medicaid', 'ct husky'],
};

/**
 * Normalize an insurance name for better matching
 * Handles case variations, extra spaces, and common abbreviations
 */
function normalizeInsuranceName(name: string): string {
  if (!name) return '';

  // Lowercase and trim
  let normalized = name.toLowerCase().trim();

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  // Remove common suffixes
  normalized = normalized.replace(/\s*(insurance|ins|dental|health|group|inc|llc|corp|company|co)\s*/gi, ' ').trim();

  return normalized;
}

/**
 * Get all possible search variations for an insurance name
 */
function getInsuranceSearchVariations(insuranceName: string): string[] {
  const normalized = normalizeInsuranceName(insuranceName);
  const variations: Set<string> = new Set();

  // Add the original and normalized versions
  variations.add(insuranceName);
  variations.add(normalized);
  variations.add(insuranceName.toUpperCase());
  variations.add(insuranceName.toLowerCase());

  // Title case
  variations.add(insuranceName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '));

  // Check against known aliases
  for (const [canonical, aliases] of Object.entries(INSURANCE_NAME_ALIASES)) {
    if (aliases.some(alias => normalized.includes(alias) || alias.includes(normalized))) {
      // Add all aliases as potential search terms
      aliases.forEach(alias => {
        variations.add(alias);
        variations.add(alias.toUpperCase());
        variations.add(alias.charAt(0).toUpperCase() + alias.slice(1));
        // Title case for multi-word
        variations.add(alias.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '));
      });
      variations.add(canonical);
      variations.add(canonical.toUpperCase());
    }
  }

  return Array.from(variations).filter(v => v.length > 0);
}

/**
 * Normalize a group number for better matching.
 * Many group numbers contain dashes/spaces (e.g., "701420-15-001") while stored values may not.
 * Keeps only alphanumeric characters and lowercases.
 */
function normalizeGroupNumber(groupNumber: string): string {
  if (!groupNumber) return '';
  return groupNumber.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface InsurancePlanRecord {
  pk: string;
  sk: string;
  clinicId: string;
  clinicName: string;
  insuranceName: string | null;
  groupName: string | null;
  groupNumber: string | null;
  employer: string | null;
  feeSchedule: string | null;
  planNote: string | null;
  downgrades: string | null;
  annualMaxIndividual: number | null;
  annualMaxFamily: number | null;
  deductibleIndividual: number | null;
  deductibleFamily: number | null;
  deductibleOnPreventiveOverride: number | null;
  preventiveDiagnosticsPct: number | null;
  preventiveXRaysPct: number | null;
  preventiveRoutinePreventivePct: number | null;
  basicRestorativePct: number | null;
  basicEndoPct: number | null;
  basicPerioPct: number | null;
  basicOralSurgeryPct: number | null;
  majorCrownsPct: number | null;
  majorProsthodonticsPct: number | null;
  orthoPct: number | null;
  orthoLifetimeMax: number | null;
  waitingPeriods: string | null;
  frequencyLimits: string | null;
  ageLimits: string | null;
  // New comprehensive benefit fields
  deductibleOverridesByCategory: string | null;
  coinsuranceOverridesByCodeOrGroup: string | null;
  copayments: string | null;
  exclusions: string | null;
  activeCoverageFlags: string | null;
  otherLimitations: string | null;
  benefitRowsRaw: string | null;
  lastSyncAt: string;
}

/**
 * Fee Schedule Record - synced from OpenDental every 15 minutes
 * Contains fee amounts for procedure codes across all fee schedules
 */
interface FeeScheduleRecord {
  pk: string; // clinicId#FeeSchedNum
  sk: string; // ProcCode
  clinicId: string;
  clinicName: string;
  feeSchedNum: string;
  feeSchedule: string; // Description/name of the fee schedule
  procCode: string;
  abbrDesc: string | null;
  description: string | null;
  amount: number | null;
  lastSyncAt: string;
  contentHash: string;
}

/**
 * Appointment Type Record - from PatientPortalApptTypesStack
 * Contains clinic-specific appointment type definitions with duration and operatory mappings
 * Table schema: clinicId (PK), label (SK)
 * 
 * Example record:
 * {
 *   "clinicId": "dentistinbowie",
 *   "label": "Existing patient current treatment Plan",
 *   "AppointmentTypeNum": 24,
 *   "apptTypeName": "Online_Treatment_Plan",
 *   "defaultProvName": "Billing",
 *   "defaultProvNum": 3,
 *   "duration": 30,
 *   "opName": "ONLINE_BOOKING_MINOR",
 *   "opNum": 20,
 *   "value": "Existing patient current treatment Plan"
 * }
 */
interface AppointmentTypeRecord {
  clinicId: string;           // PK
  label: string;              // SK - e.g., "New Patient", "Existing patient emergency", etc.
  value: string;              // Internal value/code (usually same as label)
  duration: number;           // Duration in minutes (e.g., 30, 60)
  opNum: number;              // Operatory number for OpenDental
  opName?: string;            // Operatory name (e.g., "ONLINE_BOOKING_MINOR")
  AppointmentTypeNum?: number; // OpenDental AppointmentTypeNum
  apptTypeName?: string;      // OpenDental appointment type name (e.g., "Online_Treatment_Plan")
  defaultProvNum?: number;    // Default provider number
  defaultProvName?: string;   // Default provider name (e.g., "Billing")
}


/**
 * Look up appointment types from the ApptTypes DynamoDB table
 * Supports: listing all types for a clinic, getting a specific type by label,
 * or intelligent matching based on patient request
 * 
 * @param params - Search parameters:
 *   - clinicId: Required clinic identifier
 *   - label: Optional exact label match
 *   - patientRequest: Optional natural language request to match (e.g., "I need a cleaning")
 *   - isNewPatient: Optional flag for new patient matching
 * @param clinicId - Clinic ID from session (fallback)
 * @returns Appointment types data with optional best match
 */
async function lookupAppointmentTypes(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  try {
    const searchClinicId = clinicId || params.clinicId;
    const searchLabel = params.label || params.appointmentType;
    const patientRequest = params.patientRequest || params.reason || params.query;
    const isNewPatient = params.isNewPatient === true || params.isNewPatient === 'true';

    if (!searchClinicId) {
      return {
        statusCode: 400,
        body: {
          status: 'FAILURE',
          message: 'clinicId is required to look up appointment types',
        },
      };
    }

    console.log(`[AppointmentTypeLookup] Searching clinic=${searchClinicId}, label=${searchLabel || 'ALL'}, patientRequest=${patientRequest || 'NONE'}, isNewPatient=${isNewPatient}`);

    let appointmentTypes: AppointmentTypeRecord[] = [];

    if (searchLabel) {
      // First try exact match
      const result = await docClient.send(new GetCommand({
        TableName: APPT_TYPES_TABLE,
        Key: {
          clinicId: searchClinicId,
          label: searchLabel,
        },
      }));

      if (result.Item) {
        appointmentTypes = [result.Item as AppointmentTypeRecord];
      } else {
        // If exact match fails, fetch all and do fuzzy match on label
        const allResult = await docClient.send(new QueryCommand({
          TableName: APPT_TYPES_TABLE,
          KeyConditionExpression: 'clinicId = :clinicId',
          ExpressionAttributeValues: { ':clinicId': searchClinicId },
        }));
        const allTypes = (allResult.Items || []) as AppointmentTypeRecord[];

        // Fuzzy match on label
        const searchLower = searchLabel.toLowerCase();
        const fuzzyMatch = allTypes.find(t =>
          t.label.toLowerCase().includes(searchLower) ||
          searchLower.includes(t.label.toLowerCase()) ||
          (t.apptTypeName && t.apptTypeName.toLowerCase().includes(searchLower))
        );

        if (fuzzyMatch) {
          appointmentTypes = [fuzzyMatch];
          console.log(`[AppointmentTypeLookup] Fuzzy matched "${searchLabel}" to "${fuzzyMatch.label}"`);
        }
      }
    } else {
      // List all appointment types for the clinic
      const result = await docClient.send(new QueryCommand({
        TableName: APPT_TYPES_TABLE,
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': searchClinicId },
      }));

      appointmentTypes = (result.Items || []) as AppointmentTypeRecord[];
    }

    if (appointmentTypes.length === 0) {
      return {
        statusCode: 404,
        body: {
          status: 'FAILURE',
          message: searchLabel
            ? `Appointment type "${searchLabel}" not found for clinic ${searchClinicId}`
            : `No appointment types found for clinic ${searchClinicId}`,
          suggestions: [
            'Check that appointment types are configured in the Patient Portal',
            'Common types: New Patient, Cleaning, Crown, Filling, Emergency',
          ],
        },
      };
    }

    // Format response - provide all information for the AI agent to make the decision
    let directAnswer = '';
    if (searchLabel && appointmentTypes.length === 1) {
      const apptType = appointmentTypes[0];
      directAnswer = `=== APPOINTMENT TYPE: ${apptType.label} ===\n`;
      directAnswer += `Duration: ${apptType.duration} minutes\n`;
      directAnswer += `Operatory Number (Op): ${apptType.opNum}\n`;
      if (apptType.opName) {
        directAnswer += `Operatory Name: ${apptType.opName}\n`;
      }
      if (apptType.defaultProvNum) {
        directAnswer += `Default Provider: ${apptType.defaultProvName || 'Provider'} (ProvNum: ${apptType.defaultProvNum})\n`;
      }
      if (apptType.AppointmentTypeNum) {
        directAnswer += `AppointmentTypeNum: ${apptType.AppointmentTypeNum}\n`;
      }
      directAnswer += `\nUse these values when calling scheduleAppointment:\n`;
      directAnswer += `  Op: ${apptType.opNum}\n`;
      if (apptType.defaultProvNum) directAnswer += `  ProvNum: ${apptType.defaultProvNum}\n`;
      if (apptType.AppointmentTypeNum) directAnswer += `  AppointmentTypeNum: ${apptType.AppointmentTypeNum}\n`;
      directAnswer += `  duration: ${apptType.duration}\n`;
    } else {
      directAnswer = `=== AVAILABLE APPOINTMENT TYPES FOR CLINIC ===\n\n`;
      directAnswer += `Choose the best appointment type based on the patient's needs:\n\n`;

      // Group by new patient vs existing patient for easier selection
      const newPatientTypes = appointmentTypes.filter(t => t.label.toLowerCase().includes('new patient'));
      const existingPatientTypes = appointmentTypes.filter(t => !t.label.toLowerCase().includes('new patient'));

      if (newPatientTypes.length > 0) {
        directAnswer += `--- NEW PATIENT TYPES ---\n`;
        for (const apptType of newPatientTypes) {
          directAnswer += `• "${apptType.label}"\n`;
          directAnswer += `  Op: ${apptType.opNum} | Duration: ${apptType.duration}min`;
          if (apptType.defaultProvNum) directAnswer += ` | ProvNum: ${apptType.defaultProvNum}`;
          if (apptType.AppointmentTypeNum) directAnswer += ` | TypeNum: ${apptType.AppointmentTypeNum}`;
          directAnswer += `\n`;
        }
        directAnswer += `\n`;
      }

      if (existingPatientTypes.length > 0) {
        directAnswer += `--- EXISTING PATIENT TYPES ---\n`;
        for (const apptType of existingPatientTypes) {
          directAnswer += `• "${apptType.label}"\n`;
          directAnswer += `  Op: ${apptType.opNum} | Duration: ${apptType.duration}min`;
          if (apptType.defaultProvNum) directAnswer += ` | ProvNum: ${apptType.defaultProvNum}`;
          if (apptType.AppointmentTypeNum) directAnswer += ` | TypeNum: ${apptType.AppointmentTypeNum}`;
          directAnswer += `\n`;
        }
      }

      directAnswer += `\n=== HOW TO CHOOSE ===\n`;
      directAnswer += `• For emergencies/pain → Choose "emergency" type\n`;
      directAnswer += `• For treatment plan follow-up → Choose "treatment plan" type\n`;
      directAnswer += `• For routine checkup/cleaning → Choose "other" type\n`;
      directAnswer += `• New patients → Use "new patient" types\n`;
      directAnswer += `• Existing patients → Use "existing patient" types\n`;
      directAnswer += `\nPass the Op, ProvNum, AppointmentTypeNum, and duration to scheduleAppointment.\n`;
    }

    return {
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        directAnswer,
        data: {
          appointmentTypes,
          count: appointmentTypes.length,
          clinicId: searchClinicId,
        },
        message: searchLabel
          ? `Found appointment type "${searchLabel}"`
          : `Found ${appointmentTypes.length} appointment type(s) for clinic. Choose the best one based on the patient's needs.`,
      },
    };
  } catch (error: any) {
    console.error('[AppointmentTypeLookup] Error:', error);
    return {
      statusCode: 500,
      body: {
        status: 'FAILURE',
        message: error.message || 'Failed to look up appointment types',
      },
    };
  }
}

/**
 * Look up insurance plan benefits from the synced DynamoDB table
 * Supports searching by: insuranceName, groupName, groupNumber, or clinicId
 * 
 * IMPROVED: Now uses case-insensitive matching and common insurance name aliases
 * to better handle variations like "Metlife" vs "MetLife" vs "Met Life"
 */
async function lookupInsurancePlanBenefits(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  try {
    const { insuranceName, groupName, groupNumber } = params;
    const searchClinicId = clinicId || params.clinicId;

    console.log(`[InsurancePlanLookup] Searching with: insuranceName=${insuranceName}, groupName=${groupName}, groupNumber=${groupNumber}, clinicId=${searchClinicId}`);

    let plans: InsurancePlanRecord[] = [];

    // Generate search variations for the insurance name (handles case and common aliases)
    const insuranceVariations = insuranceName ? getInsuranceSearchVariations(insuranceName) : [];
    console.log(`[InsurancePlanLookup] Insurance name variations: ${insuranceVariations.slice(0, 5).join(', ')}${insuranceVariations.length > 5 ? '...' : ''}`);

    // Strategy 1: If we have clinicId, query by clinicId GSI first (most common case)
    // This allows us to filter by insuranceName and/or groupNumber locally
    // OPTIMIZATION: Reduced limit from 500 to 100 to prevent large payloads for Bedrock
    if (searchClinicId) {
      const result = await docClient.send(new QueryCommand({
        TableName: INSURANCE_PLANS_TABLE,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': searchClinicId },
        Limit: 100, // OPTIMIZED: Reduced limit to prevent large payloads
      }));

      plans = (result.Items || []) as InsurancePlanRecord[];
      console.log(`[InsurancePlanLookup] Found ${plans.length} total plans for clinic ${searchClinicId}`);

      // Filter by insurance name (case-insensitive, with aliases)
      if (insuranceName && plans.length > 0) {
        const normalizedSearch = normalizeInsuranceName(insuranceName);
        const matchingPlans = plans.filter(p => {
          if (!p.insuranceName) return false;
          const normalizedPlan = normalizeInsuranceName(p.insuranceName);

          // Direct match (normalized)
          if (normalizedPlan.includes(normalizedSearch) || normalizedSearch.includes(normalizedPlan)) {
            return true;
          }

          // Check against any variation
          return insuranceVariations.some(variation => {
            const normalizedVariation = normalizeInsuranceName(variation);
            return normalizedPlan.includes(normalizedVariation) ||
              p.insuranceName!.toLowerCase().includes(variation.toLowerCase()) ||
              (p.sk && p.sk.toLowerCase().includes(variation.toLowerCase()));
          });
        });

        if (matchingPlans.length > 0) {
          plans = matchingPlans;
          console.log(`[InsurancePlanLookup] After insurance name filter: ${plans.length} plans`);
        } else {
          console.log(`[InsurancePlanLookup] No match for "${insuranceName}" in clinic plans, showing all clinic plans`);
        }
      }

      // Filter by group name (employer/group name from the plan list)
      // This is critical when user selects a specific plan from a list of options
      if (groupName && plans.length > 0) {
        // Clean and normalize the group name for matching
        const normalizedSearch = groupName.toLowerCase()
          .replace(/['"]/g, '') // Remove quotes
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();

        console.log(`[InsurancePlanLookup] Filtering by groupName: "${normalizedSearch}"`);

        // Try exact match first
        let filtered = plans.filter(p => {
          if (!p.groupName) return false;
          const normalizedPlan = p.groupName.toLowerCase()
            .replace(/['"]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          return normalizedPlan === normalizedSearch;
        });

        // If no exact match, try partial/contains match
        if (filtered.length === 0) {
          filtered = plans.filter(p => {
            if (!p.groupName) return false;
            const normalizedPlan = p.groupName.toLowerCase()
              .replace(/['"]/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            return normalizedPlan.includes(normalizedSearch) || normalizedSearch.includes(normalizedPlan);
          });
        }

        // If still no match, try word-by-word matching (for cases like "RFS TECHNOLOGIES" vs "RFS TECHNOLOGIES INC.")
        if (filtered.length === 0) {
          const searchWords = normalizedSearch.split(' ').filter((w: string) => w.length > 2);
          filtered = plans.filter(p => {
            if (!p.groupName) return false;
            const planLower = p.groupName.toLowerCase();
            // Match if most search words are found
            const matchCount = searchWords.filter((word: string) => planLower.includes(word)).length;
            return matchCount >= Math.ceil(searchWords.length * 0.7); // 70% word match
          });
        }

        if (filtered.length > 0) {
          plans = filtered;
          console.log(`[InsurancePlanLookup] After groupName filter: ${plans.length} plans`);
        } else {
          console.log(`[InsurancePlanLookup] No match for groupName "${groupName}", keeping ${plans.length} plans`);
        }
      }

      // Filter by group number
      if (groupNumber && plans.length > 0) {
        const normalizedSearch = normalizeGroupNumber(String(groupNumber));
        const filtered = plans.filter(p => {
          if (!p.groupNumber) return false;
          const normalizedPlan = normalizeGroupNumber(p.groupNumber);
          return normalizedPlan === normalizedSearch ||
            normalizedPlan.includes(normalizedSearch) ||
            normalizedSearch.includes(normalizedPlan);
        });
        if (filtered.length > 0) {
          plans = filtered;
          console.log(`[InsurancePlanLookup] After group number filter: ${plans.length} plans`);
        }
      }
    }
    // Strategy 2: No clinicId, but have insuranceName - search across all clinics
    else if (insuranceName) {
      // Try each variation with GSI exact match first
      for (const variation of insuranceVariations.slice(0, 10)) { // Limit to 10 variations
        const result = await docClient.send(new QueryCommand({
          TableName: INSURANCE_PLANS_TABLE,
          IndexName: 'insuranceName-index',
          KeyConditionExpression: 'insuranceName = :insuranceName',
          ExpressionAttributeValues: { ':insuranceName': variation },
          Limit: 50,
        }));

        if (result.Items && result.Items.length > 0) {
          plans = [...plans, ...(result.Items as InsurancePlanRecord[])];
        }
      }

      // If still no results, try partial match with scan
      if (plans.length === 0) {
        console.log(`[InsurancePlanLookup] No GSI match for "${insuranceName}", trying partial scan...`);

        // Try multiple case variations
        for (const searchTerm of [insuranceName.toLowerCase(), insuranceName.toUpperCase(), insuranceName]) {
          const scanResult = await docClient.send(new ScanCommand({
            TableName: INSURANCE_PLANS_TABLE,
            FilterExpression: 'contains(#insuranceName, :searchTerm) OR contains(#sk, :searchTerm)',
            ExpressionAttributeNames: {
              '#insuranceName': 'insuranceName',
              '#sk': 'sk',
            },
            ExpressionAttributeValues: {
              ':searchTerm': searchTerm,
            },
            Limit: 50,
          }));

          if (scanResult.Items && scanResult.Items.length > 0) {
            plans = scanResult.Items as InsurancePlanRecord[];
            console.log(`[InsurancePlanLookup] Partial scan matched ${plans.length} plans with "${searchTerm}"`);
            break;
          }
        }
      }

      // Deduplicate plans by pk+sk
      const seen = new Set<string>();
      plans = plans.filter(p => {
        const key = `${p.pk}#${p.sk}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Filter by group criteria if provided
      if (groupName) {
        const searchTerm = groupName.toLowerCase();
        plans = plans.filter(p => p.groupName?.toLowerCase().includes(searchTerm));
      }
      if (groupNumber) {
        plans = plans.filter(p => p.groupNumber === groupNumber || p.groupNumber?.includes(groupNumber));
      }
    }
    // Strategy 3: Only groupNumber provided - scan for it
    else if (groupNumber) {
      console.log(`[InsurancePlanLookup] Searching by group number only: ${groupNumber}`);

      const result = await docClient.send(new ScanCommand({
        TableName: INSURANCE_PLANS_TABLE,
        FilterExpression: 'groupNumber = :groupNumber OR contains(pk, :groupNumber)',
        ExpressionAttributeValues: {
          ':groupNumber': groupNumber,
        },
        Limit: 50,
      }));

      plans = (result.Items || []) as InsurancePlanRecord[];
    }
    // Strategy 4: Scan with groupName filter (fallback)
    else if (groupName) {
      const result = await docClient.send(new ScanCommand({
        TableName: INSURANCE_PLANS_TABLE,
        FilterExpression: 'contains(groupName, :groupName)',
        ExpressionAttributeValues: { ':groupName': groupName },
        Limit: 50,
      }));

      plans = (result.Items || []) as InsurancePlanRecord[];
    }

    // Filter out UNKNOWN_CARRIER plans (these have no real insurance name)
    plans = plans.filter(p => p.insuranceName && p.insuranceName !== 'UNKNOWN_CARRIER');

    // Sort plans by relevance: exact insurance name matches first
    if (insuranceName) {
      const normalizedSearch = normalizeInsuranceName(insuranceName);
      plans.sort((a, b) => {
        const aExact = normalizeInsuranceName(a.insuranceName || '').includes(normalizedSearch) ? 0 : 1;
        const bExact = normalizeInsuranceName(b.insuranceName || '').includes(normalizedSearch) ? 0 : 1;
        return aExact - bExact;
      });
    }

    if (plans.length === 0) {
      console.log(`[InsurancePlanLookup] No plans found for: insuranceName=${insuranceName}, groupNumber=${groupNumber}, clinicId=${searchClinicId}`);

      // Provide more specific suggestions based on what was searched
      const suggestions: string[] = [];
      if (insuranceName && !groupNumber) {
        suggestions.push(`Try providing the group number from your ${insuranceName} insurance card`);
      }
      if (groupNumber && !insuranceName) {
        suggestions.push('Please provide the insurance carrier name (e.g., MetLife, Delta Dental, Cigna)');
      }
      suggestions.push('Verify the insurance carrier name spelling');
      suggestions.push('Contact the dental office directly for coverage details');

      return {
        statusCode: 404,
        body: {
          status: 'FAILURE',
          message: `No insurance plan details found for "${insuranceName || groupName || groupNumber}" in the clinic's database. The insurance plan may not have been synced yet, or the carrier name may be spelled differently in our system.`,
          searchCriteria: { insuranceName, groupName, groupNumber, clinicId: searchClinicId },
          suggestions,
        },
      };
    }

    console.log(`[InsurancePlanLookup] Found ${plans.length} matching plan(s)`);

    return {
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        message: `Found ${plans.length} matching insurance plan(s)`,
        data: {
          plans,
          count: plans.length,
        },
      },
    };
  } catch (error: any) {
    console.error('[InsurancePlanLookup] Error:', error);
    return {
      statusCode: 500,
      body: {
        status: 'FAILURE',
        message: `Failed to lookup insurance plans: ${error.message}`,
      },
    };
  }
}

/**
 * Format a single insurance plan into human-readable coverage suggestions
 * 
 * IMPROVED: Provides clearer messaging when coverage values are not available,
 * distinguishing between "not covered" and "coverage not recorded in system"
 */
function formatCoverageSuggestion(plan: InsurancePlanRecord): any {
  // Helper to normalize percentage (handles both decimal 0.8 and whole number 80)
  const normalizePct = (pct: number | null | undefined): number | null => {
    if (pct === null || pct === undefined) return null;
    // If value > 1, it's already a percentage (80), otherwise it's decimal (0.8)
    return pct > 1 ? pct : pct * 100;
  };

  const formatPercent = (pct: number | null, procedureType?: string): string => {
    if (pct === null || pct === undefined) {
      return 'Coverage not recorded in our system - please call the office for verification';
    }
    if (pct === 0) return '0% (Not covered)';
    const percentage = pct > 1 ? Math.round(pct) : Math.round(pct * 100);
    return `${percentage}% covered by insurance`;
  };

  const formatMoney = (amt: number | null): string => {
    if (amt === null || amt === undefined) return 'Not recorded in system';
    if (amt === 0) return '$0';
    return `$${amt.toLocaleString()}`;
  };

  // Calculate estimated patient cost for crowns if we have the coverage percentage
  const estimateCrownCost = (): string | null => {
    if (plan.majorCrownsPct !== null && plan.majorCrownsPct !== undefined) {
      const typicalCrownCost = 1200; // Average crown cost
      const coveragePct = normalizePct(plan.majorCrownsPct) || 0;
      const patientPct = 100 - coveragePct;
      const patientPays = Math.round(typicalCrownCost * (patientPct / 100));
      return `Estimated out-of-pocket for a crown: ~$${patientPays} (based on ${Math.round(coveragePct)}% coverage)`;
    }
    return null;
  };

  // Build a human-readable summary for crowns specifically (since this is commonly asked)
  const crownSummary = (): string => {
    if (plan.majorCrownsPct !== null && plan.majorCrownsPct !== undefined) {
      const pct = normalizePct(plan.majorCrownsPct) || 0;
      if (pct === 0) {
        return `Crowns are NOT covered under this plan.`;
      }
      return `Crowns are covered at ${Math.round(pct)}% by this plan. After your deductible is met, the insurance will pay ${Math.round(pct)}% of the crown cost and you will pay the remaining ${Math.round(100 - pct)}%.`;
    }
    return `Crown coverage percentage is not specifically recorded for this plan in our system. Please contact the dental office at your convenience to verify the exact coverage, or we can check with your insurance provider.`;
  };

  return {
    planInfo: {
      insuranceName: plan.insuranceName || 'Unknown',
      groupName: plan.groupName || 'Unknown',
      groupNumber: plan.groupNumber || 'Unknown',
      employer: plan.employer,
      feeSchedule: plan.feeSchedule,
      downgrades: plan.downgrades,
    },
    maximumsAndDeductibles: {
      annualMaxIndividual: formatMoney(plan.annualMaxIndividual),
      annualMaxFamily: formatMoney(plan.annualMaxFamily),
      deductibleIndividual: formatMoney(plan.deductibleIndividual),
      deductibleFamily: formatMoney(plan.deductibleFamily),
      deductibleOnPreventive: plan.deductibleOnPreventiveOverride !== null
        ? formatMoney(plan.deductibleOnPreventiveOverride)
        : 'Standard deductible applies',
    },
    coveragePercentages: {
      preventive: {
        diagnostics: formatPercent(plan.preventiveDiagnosticsPct),
        xrays: formatPercent(plan.preventiveXRaysPct),
        routinePreventive: formatPercent(plan.preventiveRoutinePreventivePct),
        summary: calculateCategoryAverage([
          plan.preventiveDiagnosticsPct,
          plan.preventiveXRaysPct,
          plan.preventiveRoutinePreventivePct,
        ]),
      },
      basic: {
        restorative: formatPercent(plan.basicRestorativePct),
        endodontics: formatPercent(plan.basicEndoPct),
        periodontics: formatPercent(plan.basicPerioPct),
        oralSurgery: formatPercent(plan.basicOralSurgeryPct),
        summary: calculateCategoryAverage([
          plan.basicRestorativePct,
          plan.basicEndoPct,
          plan.basicPerioPct,
          plan.basicOralSurgeryPct,
        ]),
      },
      major: {
        crowns: formatPercent(plan.majorCrownsPct),
        crownSummary: crownSummary(),
        estimatedCrownCost: estimateCrownCost(),
        prosthodontics: formatPercent(plan.majorProsthodonticsPct),
        summary: calculateCategoryAverage([
          plan.majorCrownsPct,
          plan.majorProsthodonticsPct,
        ]),
      },
      orthodontics: {
        coverage: formatPercent(plan.orthoPct),
        lifetimeMax: formatMoney(plan.orthoLifetimeMax),
      },
    },
    limitations: {
      waitingPeriods: plan.waitingPeriods || 'None specified',
      frequencyLimits: plan.frequencyLimits || 'None specified',
      ageLimits: plan.ageLimits || 'None specified',
      otherLimitations: plan.otherLimitations || 'None specified',
    },
    overrides: {
      deductiblesByCategory: plan.deductibleOverridesByCategory || 'None specified',
      coinsuranceByCodeOrGroup: plan.coinsuranceOverridesByCodeOrGroup || 'None specified',
    },
    copayments: plan.copayments || 'None specified',
    exclusions: plan.exclusions || 'None specified',
    activeCoverageFlags: plan.activeCoverageFlags || 'None specified',
    benefitRowsRaw: plan.benefitRowsRaw, // Raw dump for debugging/advanced analysis
    notes: plan.planNote,
    lastUpdated: plan.lastSyncAt,
  };
}

/**
 * Calculate average coverage percentage for a category
 * Handles both decimal (0.8) and whole number (80) formats
 */
function calculateCategoryAverage(percentages: (number | null)[]): string {
  const validPcts = percentages.filter((p): p is number => p !== null && p !== undefined);
  if (validPcts.length === 0) return 'Not specified';

  // Normalize all values to percentage (handle both decimal and whole number)
  const normalizedPcts = validPcts.map(p => p > 1 ? p : p * 100);
  const avg = normalizedPcts.reduce((a, b) => a + b, 0) / normalizedPcts.length;
  return `~${Math.round(avg)}% average`;
}

/**
 * Generate a summary of coverage across all matching plans
 */
function generateCoverageSummary(plans: InsurancePlanRecord[]): any {
  if (plans.length === 0) return null;

  // For single plan, provide detailed summary
  if (plans.length === 1) {
    const plan = plans[0];
    const preventiveAvg = calculateCategoryAverage([
      plan.preventiveDiagnosticsPct,
      plan.preventiveXRaysPct,
      plan.preventiveRoutinePreventivePct,
    ]);
    const basicAvg = calculateCategoryAverage([
      plan.basicRestorativePct,
      plan.basicEndoPct,
      plan.basicPerioPct,
      plan.basicOralSurgeryPct,
    ]);
    const majorAvg = calculateCategoryAverage([
      plan.majorCrownsPct,
      plan.majorProsthodonticsPct,
    ]);

    return {
      planType: determinePlanType(plan),
      quickSummary: `Annual Max: ${plan.annualMaxIndividual ? '$' + plan.annualMaxIndividual : 'N/A'} | Deductible: ${plan.deductibleIndividual ? '$' + plan.deductibleIndividual : 'N/A'} | Preventive: ${preventiveAvg} | Basic: ${basicAvg} | Major: ${majorAvg}`,
      recommendations: generateRecommendations(plan),
    };
  }

  // For multiple plans, show comparison
  return {
    multiplePlansFound: true,
    message: `Found ${plans.length} plans. Please specify more details to narrow down.`,
    planSummaries: plans.slice(0, 5).map(p => ({
      insuranceName: p.insuranceName,
      groupName: p.groupName,
      groupNumber: p.groupNumber,
      annualMax: p.annualMaxIndividual ? `$${p.annualMaxIndividual}` : 'N/A',
    })),
  };
}

/**
 * Determine the type of insurance plan based on coverage levels
 * Handles both decimal (0.8) and whole number (80) formats
 */
function determinePlanType(plan: InsurancePlanRecord): string {
  // Helper to normalize percentage
  const norm = (pct: number | null | undefined): number => {
    if (pct === null || pct === undefined) return 0;
    return pct > 1 ? pct : pct * 100;
  };

  const preventive = norm(plan.preventiveRoutinePreventivePct ?? plan.preventiveDiagnosticsPct);
  const basic = norm(plan.basicRestorativePct);
  const major = norm(plan.majorCrownsPct);

  if (preventive >= 90 && basic >= 70 && major >= 50) return 'Comprehensive (100-80-50 or better)';
  if (preventive >= 80 && basic >= 60 && major >= 40) return 'Standard (80-60-40 or similar)';
  if (preventive >= 80 && basic >= 50) return 'Basic Coverage';
  if (preventive >= 80) return 'Preventive-focused';
  return 'Limited Coverage';
}

/**
 * Generate treatment recommendations based on insurance coverage
 * Handles both decimal (0.8) and whole number (80) formats
 */
function generateRecommendations(plan: InsurancePlanRecord): string[] {
  const recommendations: string[] = [];

  // Helper to normalize percentage
  const norm = (pct: number | null | undefined): number => {
    if (pct === null || pct === undefined) return 0;
    return pct > 1 ? pct : pct * 100;
  };

  // Preventive recommendations
  const preventiveCoverage = norm(plan.preventiveRoutinePreventivePct ?? plan.preventiveDiagnosticsPct);
  if (preventiveCoverage >= 80) {
    recommendations.push('✓ Preventive services (cleanings, exams) are well covered - encourage regular visits');
  }

  // Deductible recommendations
  if (plan.deductibleOnPreventiveOverride === 0) {
    recommendations.push('✓ No deductible on preventive services');
  } else if (plan.deductibleIndividual && plan.deductibleIndividual > 0) {
    recommendations.push(`Note: $${plan.deductibleIndividual} individual deductible applies before benefits kick in`);
  }

  // Basic services
  const basicPct = norm(plan.basicRestorativePct);
  if (basicPct >= 70) {
    recommendations.push('✓ Good coverage for fillings and basic restorative work');
  } else if (basicPct > 0 && basicPct < 50) {
    recommendations.push('⚠ Limited coverage for fillings - patient should expect higher out-of-pocket');
  }

  // Major services
  const majorPct = norm(plan.majorCrownsPct);
  if (majorPct >= 50) {
    recommendations.push('✓ Reasonable coverage for crowns and major work');
  } else if (majorPct > 0 && majorPct < 40) {
    recommendations.push('⚠ Low coverage for major procedures - discuss payment options with patient');
  }

  // Waiting periods
  if (plan.waitingPeriods && plan.waitingPeriods.length > 0) {
    recommendations.push(`⏳ Waiting periods apply: ${plan.waitingPeriods}`);
  }

  // Annual max
  if (plan.annualMaxIndividual) {
    if (plan.annualMaxIndividual >= 2000) {
      recommendations.push(`✓ Good annual maximum of $${plan.annualMaxIndividual}`);
    } else if (plan.annualMaxIndividual < 1000) {
      recommendations.push(`⚠ Low annual maximum of $${plan.annualMaxIndividual} - may run out quickly with major work`);
    }
  }

  // Frequency limits
  if (plan.frequencyLimits) {
    recommendations.push(`📋 Frequency limits: ${plan.frequencyLimits}`);
  }

  // Exclusions (services NOT covered)
  if (plan.exclusions) {
    recommendations.push(`🚫 Exclusions: ${plan.exclusions}`);
  }

  // Copayments
  if (plan.copayments) {
    recommendations.push(`💵 Copayments apply: ${plan.copayments}`);
  }

  // Other limitations
  if (plan.otherLimitations) {
    recommendations.push(`⚠️ Other limitations: ${plan.otherLimitations}`);
  }

  return recommendations;
}

// ========================================================================
// FEE SCHEDULE LOOKUP FUNCTIONS
// ========================================================================

/**
 * Look up fee schedules from the synced DynamoDB table
 * Supports searching by: feeSchedule name, procCode, feeSchedNum, or clinicId
 * 
 * Access patterns:
 * 1. Get all fee schedules for a clinic (clinicId-index)
 * 2. Get fees for a specific procedure across all schedules (procCode-index)
 * 3. Get fees by fee schedule name across clinics (feeSchedule-index)
 * 4. Get specific fee for procedure in a schedule (pk + sk query)
 */
async function lookupFeeSchedules(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  try {
    const { feeSchedule, feeScheduleName, procCode, procedureCode, feeSchedNum } = params;
    const searchClinicId = clinicId || params.clinicId;
    const searchProcCode = procCode || procedureCode;
    const searchFeeSchedule = feeSchedule || feeScheduleName;

    console.log(`[FeeScheduleLookup] Searching with: feeSchedule=${searchFeeSchedule}, procCode=${searchProcCode}, feeSchedNum=${feeSchedNum}, clinicId=${searchClinicId}`);

    let fees: FeeScheduleRecord[] = [];

    // Strategy 1: Specific procedure code in a specific fee schedule for a clinic
    if (searchClinicId && feeSchedNum && searchProcCode) {
      const pk = `${searchClinicId}#${feeSchedNum}`;
      const result = await docClient.send(new QueryCommand({
        TableName: FEE_SCHEDULES_TABLE,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: { ':pk': pk, ':sk': searchProcCode },
      }));
      fees = (result.Items || []) as FeeScheduleRecord[];
    }
    // Strategy 2: All procedures in a specific fee schedule for a clinic
    // OPTIMIZATION: Reduced limit from 1000 to 100 to prevent hitting Bedrock limits
    else if (searchClinicId && feeSchedNum) {
      const pk = `${searchClinicId}#${feeSchedNum}`;
      const result = await docClient.send(new QueryCommand({
        TableName: FEE_SCHEDULES_TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        Limit: 100, // OPTIMIZED: Reduced limit to prevent large payloads
      }));
      fees = (result.Items || []) as FeeScheduleRecord[];
    }
    // Strategy 3: Search by procedure code across all schedules/clinics (procCode-index)
    // OPTIMIZATION: Reduced limit from 500 to 50 for targeted procedure lookups
    else if (searchProcCode) {
      const result = await docClient.send(new QueryCommand({
        TableName: FEE_SCHEDULES_TABLE,
        IndexName: 'procCode-index',
        KeyConditionExpression: 'procCode = :procCode',
        ExpressionAttributeValues: { ':procCode': searchProcCode.toUpperCase() },
        Limit: 50, // OPTIMIZED: Reduced limit for procedure code lookups
      }));
      fees = (result.Items || []) as FeeScheduleRecord[];

      // Filter by clinic if provided
      if (searchClinicId && fees.length > 0) {
        fees = fees.filter(f => f.clinicId === searchClinicId);
      }

      // Filter by fee schedule name if provided
      if (searchFeeSchedule && fees.length > 0) {
        const normalizedSearch = searchFeeSchedule.toLowerCase().trim();
        fees = fees.filter(f =>
          f.feeSchedule?.toLowerCase().includes(normalizedSearch) ||
          normalizedSearch.includes(f.feeSchedule?.toLowerCase() || '')
        );
      }
    }
    // Strategy 4: Search by fee schedule name (feeSchedule-index)
    // OPTIMIZATION: Reduced limits from 500 to 50 and avoid expensive scans
    else if (searchFeeSchedule) {
      // Try exact match first
      const result = await docClient.send(new QueryCommand({
        TableName: FEE_SCHEDULES_TABLE,
        IndexName: 'feeSchedule-index',
        KeyConditionExpression: 'feeSchedule = :feeSchedule',
        ExpressionAttributeValues: { ':feeSchedule': searchFeeSchedule },
        Limit: 50, // OPTIMIZED: Reduced limit
      }));
      fees = (result.Items || []) as FeeScheduleRecord[];

      // OPTIMIZATION: If no exact match, try partial match with scan but with strict limit
      if (fees.length === 0) {
        console.log(`[FeeScheduleLookup] No exact match for "${searchFeeSchedule}", trying partial scan with limit...`);
        const scanResult = await docClient.send(new ScanCommand({
          TableName: FEE_SCHEDULES_TABLE,
          FilterExpression: 'contains(#feeSchedule, :searchTerm)',
          ExpressionAttributeNames: { '#feeSchedule': 'feeSchedule' },
          ExpressionAttributeValues: { ':searchTerm': searchFeeSchedule },
          Limit: 30, // OPTIMIZED: Strict limit on scans to prevent large payloads
        }));
        fees = (scanResult.Items || []) as FeeScheduleRecord[];
      }

      // Filter by clinic if provided
      if (searchClinicId && fees.length > 0) {
        fees = fees.filter(f => f.clinicId === searchClinicId);
      }
    }
    // Strategy 5: Get all fee schedules for a clinic (clinicId-index)
    // OPTIMIZATION: Only get unique schedules, not all fee entries
    else if (searchClinicId) {
      const result = await docClient.send(new QueryCommand({
        TableName: FEE_SCHEDULES_TABLE,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': searchClinicId },
        Limit: 50, // OPTIMIZED: Reduced from 100, just enough to extract unique schedules
      }));
      fees = (result.Items || []) as FeeScheduleRecord[];
    }

    if (fees.length === 0) {
      console.log(`[FeeScheduleLookup] No fees found for: feeSchedule=${searchFeeSchedule}, procCode=${searchProcCode}, clinicId=${searchClinicId}`);
      return {
        statusCode: 404,
        body: {
          status: 'FAILURE',
          message: `No fee schedule data found. The fee schedule may not have been synced yet.`,
          searchCriteria: { feeSchedule: searchFeeSchedule, procCode: searchProcCode, feeSchedNum, clinicId: searchClinicId },
          suggestions: [
            'Verify the procedure code (e.g., D0120, D1110)',
            'Check the fee schedule name spelling',
            'Fee schedules are synced every 15 minutes from OpenDental',
          ],
        },
      };
    }

    console.log(`[FeeScheduleLookup] Found ${fees.length} fee entries`);

    // OPTIMIZATION: Return only essential fields to reduce payload size for Bedrock
    const minimalFees = fees.slice(0, 30).map(f => ({
      procCode: f.procCode,
      description: f.description || f.abbrDesc,
      amount: f.amount,
      feeSchedule: f.feeSchedule,
      feeSchedNum: f.feeSchedNum,
    }));

    // Get unique fee schedules for summary
    const uniqueSchedules = [...new Set(fees.map(f => f.feeSchedule))];

    // Build a concise summary for the AI
    let directAnswer = `=== FEE SCHEDULE LOOKUP ===\n`;
    directAnswer += `Found ${fees.length} fee entries across ${uniqueSchedules.length} schedule(s):\n\n`;

    // Group and summarize
    const bySchedule: Record<string, { count: number; sample: any[] }> = {};
    for (const fee of fees.slice(0, 30)) {
      const key = fee.feeSchedule;
      if (!bySchedule[key]) {
        bySchedule[key] = { count: 0, sample: [] };
      }
      bySchedule[key].count++;
      if (bySchedule[key].sample.length < 5) {
        bySchedule[key].sample.push({
          code: fee.procCode,
          desc: fee.description || fee.abbrDesc,
          amount: fee.amount,
        });
      }
    }

    for (const [schedule, info] of Object.entries(bySchedule)) {
      directAnswer += `${schedule} (${info.count} entries):\n`;
      for (const item of info.sample) {
        directAnswer += `  - ${item.code}: ${item.desc ? item.desc + ' - ' : ''}${item.amount !== null ? '$' + item.amount.toFixed(2) : 'N/A'}\n`;
      }
      directAnswer += '\n';
    }

    return {
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        directAnswer,
        message: `Found ${fees.length} fee entries across ${uniqueSchedules.length} fee schedule(s)`,
        data: {
          fees: minimalFees,
          uniqueSchedules,
          count: fees.length,
          truncated: fees.length > 30,
        },
      },
    };
  } catch (error: any) {
    console.error('[FeeScheduleLookup] Error:', error);
    return {
      statusCode: 500,
      body: {
        status: 'FAILURE',
        message: `Failed to lookup fee schedules: ${error.message}`,
      },
    };
  }
}

/**
 * Get the fee for a specific procedure code
 * Returns the fee amount from the specified fee schedule, or lists all available fees
 */
async function getFeeForProcedure(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const { procCode, procedureCode, feeSchedule, feeScheduleName, feeSchedNum } = params;
  const searchClinicId = clinicId || params.clinicId;
  const searchProcCode = (procCode || procedureCode || '').toUpperCase();
  const searchFeeSchedule = feeSchedule || feeScheduleName;

  if (!searchProcCode) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Procedure code (procCode) is required',
        examples: ['D0120 (periodic exam)', 'D1110 (adult prophy)', 'D2740 (crown)', 'D2750 (porcelain crown)'],
      },
    };
  }

  // Look up the fee
  const result = await lookupFeeSchedules({
    procCode: searchProcCode,
    feeSchedule: searchFeeSchedule,
    feeSchedNum,
    clinicId: searchClinicId,
  }, searchClinicId);

  if (result.statusCode !== 200 || !result.body.data?.fees?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: `No fee found for procedure code ${searchProcCode}`,
        searchCriteria: { procCode: searchProcCode, feeSchedule: searchFeeSchedule, clinicId: searchClinicId },
        suggestions: [
          'Verify the procedure code is correct (e.g., D0120, D1110, D2740)',
          'The procedure may not have a fee set in the fee schedule',
          'Fee schedules sync every 15 minutes from OpenDental',
        ],
      },
    };
  }

  const fees = result.body.data.fees as FeeScheduleRecord[];
  const firstFee = fees[0];

  // Format a clear response
  let directAnswer = '';
  if (fees.length === 1) {
    directAnswer = `=== FEE FOR ${searchProcCode} ===\n`;
    directAnswer += `Procedure: ${firstFee.procCode} - ${firstFee.description || firstFee.abbrDesc || 'No description'}\n`;
    directAnswer += `Fee Schedule: ${firstFee.feeSchedule}\n`;
    directAnswer += `Amount: ${firstFee.amount !== null ? `$${firstFee.amount.toFixed(2)}` : 'Not set'}\n`;
    if (firstFee.clinicName) directAnswer += `Clinic: ${firstFee.clinicName}\n`;
  } else {
    directAnswer = `=== FEES FOR ${searchProcCode} ===\n`;
    directAnswer += `Procedure: ${firstFee.description || firstFee.abbrDesc || searchProcCode}\n\n`;

    // Group by fee schedule
    const bySchedule = fees.reduce((acc, fee) => {
      if (!acc[fee.feeSchedule]) acc[fee.feeSchedule] = [];
      acc[fee.feeSchedule].push(fee);
      return acc;
    }, {} as Record<string, FeeScheduleRecord[]>);

    for (const [schedule, scheduleFees] of Object.entries(bySchedule)) {
      const fee = scheduleFees[0];
      directAnswer += `${schedule}: ${fee.amount !== null ? `$${fee.amount.toFixed(2)}` : 'Not set'}\n`;
    }
  }

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: `Found fee for ${searchProcCode}`,
      directAnswer,
      data: {
        procCode: searchProcCode,
        description: firstFee.description || firstFee.abbrDesc,
        fees: fees.map(f => ({
          feeSchedule: f.feeSchedule,
          feeSchedNum: f.feeSchedNum,
          amount: f.amount,
          clinicId: f.clinicId,
          clinicName: f.clinicName,
        })),
      },
    },
  };
}

/**
 * List all available fee schedules for a clinic
 */
async function listFeeSchedules(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const searchClinicId = clinicId || params.clinicId;

  if (!searchClinicId) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'clinicId is required to list fee schedules',
      },
    };
  }

  try {
    // OPTIMIZATION: Query with reduced limit - we only need enough to extract unique schedules
    const result = await docClient.send(new QueryCommand({
      TableName: FEE_SCHEDULES_TABLE,
      IndexName: 'clinicId-index',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': searchClinicId },
      Limit: 200, // OPTIMIZED: Reduced from 1000 - enough to identify unique schedules
    }));

    const fees = (result.Items || []) as FeeScheduleRecord[];

    if (fees.length === 0) {
      return {
        statusCode: 404,
        body: {
          status: 'FAILURE',
          message: `No fee schedules found for clinic ${searchClinicId}`,
          suggestions: [
            'Fee schedules are synced every 15 minutes from OpenDental',
            'Ensure the clinic has fee schedules configured in OpenDental',
          ],
        },
      };
    }

    // Extract unique fee schedules with their counts
    const scheduleMap = new Map<string, { feeSchedule: string; feeSchedNum: string; count: number; sampleAmount: number | null }>();
    for (const fee of fees) {
      const key = fee.feeSchedNum;
      if (!scheduleMap.has(key)) {
        scheduleMap.set(key, {
          feeSchedule: fee.feeSchedule,
          feeSchedNum: fee.feeSchedNum,
          count: 0,
          sampleAmount: fee.amount,
        });
      }
      const entry = scheduleMap.get(key)!;
      entry.count++;
      if (entry.sampleAmount === null && fee.amount !== null) {
        entry.sampleAmount = fee.amount;
      }
    }

    const schedules = Array.from(scheduleMap.values()).sort((a, b) =>
      a.feeSchedule.localeCompare(b.feeSchedule)
    );

    let directAnswer = `=== FEE SCHEDULES FOR CLINIC ===\n`;
    directAnswer += `Found ${schedules.length} fee schedule(s):\n\n`;

    // OPTIMIZATION: Limit output to prevent large responses
    const displaySchedules = schedules.slice(0, 15);
    for (const schedule of displaySchedules) {
      directAnswer += `• ${schedule.feeSchedule} (ID: ${schedule.feeSchedNum})\n`;
    }
    if (schedules.length > 15) {
      directAnswer += `... and ${schedules.length - 15} more schedules\n`;
    }

    return {
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        message: `Found ${schedules.length} fee schedule(s) for clinic`,
        directAnswer,
        data: {
          schedules: displaySchedules,
          totalSchedules: schedules.length,
          truncated: schedules.length > 15,
        },
      },
    };
  } catch (error: any) {
    console.error('[listFeeSchedules] Error:', error);
    return {
      statusCode: 500,
      body: {
        status: 'FAILURE',
        message: `Failed to list fee schedules: ${error.message}`,
      },
    };
  }
}

/**
 * Compare fees for a procedure across different fee schedules
 * Useful for seeing how UCR fees compare to insurance fee schedules
 */
async function compareProcedureFees(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const { procCode, procedureCode, procCodes, procedureCodes } = params;
  const searchClinicId = clinicId || params.clinicId;

  // Support single or multiple procedure codes
  let searchProcCodes: string[] = [];
  if (procCodes) {
    searchProcCodes = Array.isArray(procCodes) ? procCodes : [procCodes];
  } else if (procedureCodes) {
    searchProcCodes = Array.isArray(procedureCodes) ? procedureCodes : [procedureCodes];
  } else if (procCode) {
    searchProcCodes = [procCode];
  } else if (procedureCode) {
    searchProcCodes = [procedureCode];
  }

  searchProcCodes = searchProcCodes.map(c => c.toUpperCase().trim());

  if (searchProcCodes.length === 0) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'At least one procedure code (procCode) is required',
        examples: ['D0120', 'D1110', 'D2740', 'D2750'],
      },
    };
  }

  try {
    const allFees: FeeScheduleRecord[] = [];

    // OPTIMIZATION: Look up each procedure code with reduced limits
    for (const code of searchProcCodes.slice(0, 10)) { // Limit to 10 procedure codes
      const result = await docClient.send(new QueryCommand({
        TableName: FEE_SCHEDULES_TABLE,
        IndexName: 'procCode-index',
        KeyConditionExpression: 'procCode = :procCode',
        ExpressionAttributeValues: { ':procCode': code },
        Limit: 30, // OPTIMIZED: Reduced from 200
      }));

      let fees = (result.Items || []) as FeeScheduleRecord[];

      // Filter by clinic if provided
      if (searchClinicId) {
        fees = fees.filter(f => f.clinicId === searchClinicId);
      }

      allFees.push(...fees.slice(0, 20)); // OPTIMIZED: Limit per procedure
    }

    if (allFees.length === 0) {
      return {
        statusCode: 404,
        body: {
          status: 'FAILURE',
          message: `No fees found for procedure code(s): ${searchProcCodes.join(', ')}`,
        },
      };
    }

    // OPTIMIZATION: Group by procedure code, return minimal data
    const byProcCode: Record<string, { description: string; fees: { schedule: string; amount: number | null }[] }> = {};

    for (const fee of allFees) {
      if (!byProcCode[fee.procCode]) {
        byProcCode[fee.procCode] = {
          description: fee.description || fee.abbrDesc || '',
          fees: [],
        };
      }
      // Only add if we haven't seen this schedule yet
      if (!byProcCode[fee.procCode].fees.find(f => f.schedule === fee.feeSchedule)) {
        byProcCode[fee.procCode].fees.push({
          schedule: fee.feeSchedule,
          amount: fee.amount,
        });
      }
    }

    let directAnswer = `=== FEE COMPARISON ===\n\n`;

    for (const [code, data] of Object.entries(byProcCode)) {
      directAnswer += `${code} - ${data.description || 'No description'}\n`;
      directAnswer += `${'─'.repeat(40)}\n`;

      // Sort by amount descending and limit to 10 schedules
      const sortedFees = data.fees
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        .slice(0, 10);

      for (const fee of sortedFees) {
        const amountStr = fee.amount !== null ? `$${fee.amount.toFixed(2)}` : 'Not set';
        directAnswer += `  ${fee.schedule.substring(0, 28).padEnd(30)} ${amountStr}\n`;
      }
      if (data.fees.length > 10) {
        directAnswer += `  ... and ${data.fees.length - 10} more schedules\n`;
      }
      directAnswer += `\n`;
    }

    return {
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        message: `Fee comparison for ${searchProcCodes.length} procedure(s)`,
        directAnswer,
        data: {
          byProcCode,
          procCodes: searchProcCodes,
          totalFeeEntries: allFees.length,
        },
      },
    };
  } catch (error: any) {
    console.error('[compareProcedureFees] Error:', error);
    return {
      statusCode: 500,
      body: {
        status: 'FAILURE',
        message: `Failed to compare fees: ${error.message}`,
      },
    };
  }
}

/**
 * Get comprehensive patient account summary
 * Combines Aging + PatientBalances for a complete financial picture
 */
async function getPatientAccountSummary(
  params: Record<string, any>,
  odClient: OpenDentalClient
): Promise<{ statusCode: number; body: any }> {
  const { PatNum } = params;

  if (!PatNum) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'PatNum is required to get account summary',
      },
    };
  }

  let directAnswer = `=== PATIENT ACCOUNT SUMMARY ===\n\n`;
  let aging: any = null;
  let balances: any[] = [];

  // Get aging information
  try {
    aging = await odClient.request('GET', `accountmodules/${PatNum}/Aging`);

    if (aging) {
      directAnswer += `ACCOUNT AGING:\n`;
      directAnswer += `───────────────────────────\n`;

      const hasOverdue = (aging.Bal_31_60 || 0) > 0 || (aging.Bal_61_90 || 0) > 0 || (aging.BalOver90 || 0) > 0;

      if ((aging.Bal_0_30 || 0) > 0) {
        directAnswer += `  Current (0-30 days): $${aging.Bal_0_30.toFixed(2)}\n`;
      }
      if ((aging.Bal_31_60 || 0) > 0) {
        directAnswer += `  ⚠️ 31-60 days past due: $${aging.Bal_31_60.toFixed(2)}\n`;
      }
      if ((aging.Bal_61_90 || 0) > 0) {
        directAnswer += `  ⚠️ 61-90 days past due: $${aging.Bal_61_90.toFixed(2)}\n`;
      }
      if ((aging.BalOver90 || 0) > 0) {
        directAnswer += `  🔴 Over 90 days past due: $${aging.BalOver90.toFixed(2)}\n`;
      }

      directAnswer += `\n`;
      directAnswer += `BALANCE SUMMARY:\n`;
      directAnswer += `───────────────────────────\n`;
      directAnswer += `  Total Balance: $${(aging.Total || 0).toFixed(2)}\n`;

      if ((aging.InsEst || 0) > 0) {
        directAnswer += `  Pending Insurance: -$${(aging.InsEst || 0).toFixed(2)}\n`;
      }

      directAnswer += `  Patient Responsibility: $${(aging.EstBal || 0).toFixed(2)}\n`;
      directAnswer += `  This Patient's Portion: $${(aging.PatEstBal || 0).toFixed(2)}\n`;

      if ((aging.Unearned || 0) > 0) {
        directAnswer += `  💰 Credit/Prepayment: $${(aging.Unearned || 0).toFixed(2)}\n`;
      }

      directAnswer += `\n`;
    }
  } catch (e: any) {
    directAnswer += `Unable to retrieve aging information: ${e.message}\n\n`;
  }

  // Get individual family member balances
  try {
    balances = await odClient.request('GET', `accountmodules/${PatNum}/PatientBalances`);

    if (Array.isArray(balances) && balances.length > 0) {
      directAnswer += `FAMILY MEMBER BALANCES:\n`;
      directAnswer += `───────────────────────────\n`;

      for (const member of balances) {
        const balance = member.Balance || 0;
        if (member.Name === 'Entire Family') {
          directAnswer += `  ${member.Name}: $${balance.toFixed(2)} ✓\n`;
        } else {
          directAnswer += `  ${member.Name}: $${balance.toFixed(2)}\n`;
        }
      }
      directAnswer += `\n`;
    }
  } catch (e: any) {
    directAnswer += `Unable to retrieve family balances: ${e.message}\n\n`;
  }

  // Add helpful summary
  const patientBalance = aging?.PatEstBal || 0;
  const totalBalance = aging?.EstBal || 0;

  directAnswer += `───────────────────────────\n`;
  if (patientBalance === 0) {
    directAnswer += `✅ This patient has no outstanding balance.\n`;
  } else if (patientBalance > 0) {
    directAnswer += `💳 Amount due: $${patientBalance.toFixed(2)}\n`;
  }

  if ((aging?.Unearned || 0) > 0) {
    directAnswer += `💰 Credit available: $${aging.Unearned.toFixed(2)}\n`;
  }

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Account summary retrieved',
      directAnswer,
      data: {
        aging: {
          current: aging?.Bal_0_30 || 0,
          days31to60: aging?.Bal_31_60 || 0,
          days61to90: aging?.Bal_61_90 || 0,
          over90: aging?.BalOver90 || 0,
          total: aging?.Total || 0,
          insuranceEstimate: aging?.InsEst || 0,
          estimatedBalance: aging?.EstBal || 0,
          patientEstimatedBalance: aging?.PatEstBal || 0,
          unearned: aging?.Unearned || 0,
        },
        familyBalances: balances,
      },
    },
  };
}

/**
 * Get comprehensive insurance details - answers common patient questions about their coverage
 * Questions like: deductible, annual max, waiting periods, frequency limits, age limits, cosmetic coverage, etc.
 */
async function getInsuranceDetails(
  params: Record<string, any>,
  clinicId?: string,
  odClient?: OpenDentalClient
): Promise<{ statusCode: number; body: any }> {
  const { insuranceName, groupName, groupNumber, PatNum, question } = params;
  const searchClinicId = clinicId || params.clinicId;

  // First, look up the insurance plan
  const insuranceResult = await lookupInsurancePlanBenefits(
    { insuranceName, groupName, groupNumber },
    searchClinicId
  );

  if (insuranceResult.statusCode !== 200 || !insuranceResult.body.data?.plans?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: 'Insurance plan not found. Please provide insurance name, group name, or group number.',
        suggestions: [
          'Check the insurance card for the correct carrier name',
          'Provide the group number from the insurance card',
          'Ask for the employer/group name',
        ],
      },
    };
  }

  const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

  // Build comprehensive answer
  let directAnswer = `=== INSURANCE PLAN DETAILS ===\n`;
  directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || 'Unknown Group'}\n`;
  if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
  if (plan.employer) directAnswer += `Employer: ${plan.employer}\n`;
  directAnswer += `\n`;

  // === DEDUCTIBLES ===
  directAnswer += `=== DEDUCTIBLES ===\n`;
  if (plan.deductibleIndividual !== null) {
    directAnswer += `Individual Deductible: $${plan.deductibleIndividual}\n`;
  } else {
    directAnswer += `Individual Deductible: Not specified in plan\n`;
  }
  if (plan.deductibleFamily !== null) {
    directAnswer += `Family Deductible: $${plan.deductibleFamily}\n`;
  }
  if (plan.deductibleOnPreventiveOverride !== null) {
    directAnswer += `Preventive Services: ${plan.deductibleOnPreventiveOverride === 0 ? 'No deductible (waived)' : `$${plan.deductibleOnPreventiveOverride}`}\n`;
  }

  // Try to get current account status if PatNum provided
  if (PatNum && odClient) {
    try {
      // Use the Aging API to get current balance information
      const aging = await odClient.request('GET', `accountmodules/${PatNum}/Aging`);
      if (aging) {
        directAnswer += `\n📊 YOUR CURRENT ACCOUNT STATUS:\n`;
        directAnswer += `  Patient Balance: $${(aging.PatEstBal || 0).toFixed(2)}\n`;
        if ((aging.InsEst || 0) > 0) {
          directAnswer += `  Pending Insurance: $${(aging.InsEst || 0).toFixed(2)}\n`;
        }
        if ((aging.Unearned || 0) > 0) {
          directAnswer += `  Credit Available: $${(aging.Unearned || 0).toFixed(2)}\n`;
        }
        directAnswer += `\n  (For deductible/max remaining, please verify with the office)\n`;
      }
    } catch (e) {
      // Continue without real-time data
    }
  }
  directAnswer += `\n`;

  // === ANNUAL MAXIMUM ===
  directAnswer += `=== ANNUAL MAXIMUM ===\n`;
  if (plan.annualMaxIndividual !== null) {
    directAnswer += `Individual Annual Max: $${plan.annualMaxIndividual.toLocaleString()}\n`;
  } else {
    directAnswer += `Individual Annual Max: Not specified\n`;
  }
  if (plan.annualMaxFamily !== null) {
    directAnswer += `Family Annual Max: $${plan.annualMaxFamily.toLocaleString()}\n`;
  }

  // Note: Real-time annual max remaining requires checking claims data
  // The Aging API doesn't provide this directly - it requires claim analysis
  directAnswer += `\n  (To check remaining annual max, please verify with the office)\n\n`;

  // === COVERAGE PERCENTAGES (CO-INSURANCE) ===
  directAnswer += `=== COVERAGE PERCENTAGES ===\n`;

  const formatPct = (pct: number | null): string => {
    if (pct === null || pct === undefined) return 'Not specified';
    const val = pct > 1 ? pct : pct * 100;
    return `${Math.round(val)}% covered (you pay ${Math.round(100 - val)}%)`;
  };

  directAnswer += `PREVENTIVE SERVICES:\n`;
  directAnswer += `  • Exams/Diagnostics: ${formatPct(plan.preventiveDiagnosticsPct)}\n`;
  directAnswer += `  • X-Rays: ${formatPct(plan.preventiveXRaysPct)}\n`;
  directAnswer += `  • Cleanings: ${formatPct(plan.preventiveRoutinePreventivePct)}\n`;

  directAnswer += `\nBASIC SERVICES:\n`;
  directAnswer += `  • Fillings: ${formatPct(plan.basicRestorativePct)}\n`;
  directAnswer += `  • Root Canals: ${formatPct(plan.basicEndoPct)}\n`;
  directAnswer += `  • Gum Treatment: ${formatPct(plan.basicPerioPct)}\n`;
  directAnswer += `  • Extractions: ${formatPct(plan.basicOralSurgeryPct)}\n`;

  directAnswer += `\nMAJOR SERVICES:\n`;
  directAnswer += `  • Crowns: ${formatPct(plan.majorCrownsPct)}\n`;
  directAnswer += `  • Bridges/Dentures: ${formatPct(plan.majorProsthodonticsPct)}\n`;

  if (plan.orthoPct !== null || plan.orthoLifetimeMax !== null) {
    directAnswer += `\nORTHODONTICS:\n`;
    directAnswer += `  • Coverage: ${formatPct(plan.orthoPct)}\n`;
    if (plan.orthoLifetimeMax) {
      directAnswer += `  • Lifetime Max: $${plan.orthoLifetimeMax.toLocaleString()}\n`;
    }
  }
  directAnswer += `\n`;

  // === CO-PAYMENTS ===
  if (plan.copayments) {
    directAnswer += `=== CO-PAYMENTS ===\n`;
    plan.copayments.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
    directAnswer += `\n`;
  }

  // === WAITING PERIODS ===
  directAnswer += `=== WAITING PERIODS ===\n`;
  if (plan.waitingPeriods) {
    plan.waitingPeriods.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
  } else {
    directAnswer += `  No waiting periods specified\n`;
  }
  directAnswer += `\n`;

  // === FREQUENCY LIMITS ===
  directAnswer += `=== FREQUENCY LIMITS ===\n`;
  if (plan.frequencyLimits) {
    plan.frequencyLimits.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
  } else {
    directAnswer += `  No frequency limits specified\n`;
  }
  directAnswer += `\n`;

  // === AGE LIMITS ===
  directAnswer += `=== AGE LIMITS ===\n`;
  if (plan.ageLimits) {
    plan.ageLimits.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
  } else {
    directAnswer += `  No age limits specified\n`;
  }
  directAnswer += `\n`;

  // === EXCLUSIONS (WHAT'S NOT COVERED) ===
  directAnswer += `=== EXCLUSIONS (NOT COVERED) ===\n`;
  if (plan.exclusions) {
    plan.exclusions.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
  } else {
    directAnswer += `  No exclusions specified\n`;
  }

  // Check for cosmetic coverage specifically
  const cosmeticExcluded = plan.exclusions?.toLowerCase().includes('cosmetic') ||
    plan.exclusions?.toLowerCase().includes('whitening') ||
    plan.exclusions?.toLowerCase().includes('veneer');
  if (cosmeticExcluded) {
    directAnswer += `\n⚠️ COSMETIC SERVICES: Appear to be excluded from this plan\n`;
  }
  directAnswer += `\n`;

  // === OTHER LIMITATIONS ===
  if (plan.otherLimitations) {
    directAnswer += `=== OTHER LIMITATIONS ===\n`;
    plan.otherLimitations.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
    directAnswer += `\n`;
  }

  // === DOWNGRADES ===
  if (plan.downgrades) {
    directAnswer += `=== DOWNGRADE POLICY ===\n`;
    directAnswer += `${plan.downgrades}\n`;
    if (plan.downgrades.includes('Yes') || plan.downgrades.includes('Allowed')) {
      directAnswer += `(This means insurance may pay for amalgam even if you choose composite fillings)\n`;
    }
    directAnswer += `\n`;
  }

  // === PLAN NOTES ===
  if (plan.planNote) {
    directAnswer += `=== PLAN NOTES ===\n`;
    directAnswer += `${plan.planNote}\n\n`;
  }

  directAnswer += `─────────────────────────────────────\n`;
  directAnswer += `Last synced: ${plan.lastSyncAt}\n`;
  directAnswer += `For real-time benefit verification, please call the office.\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Insurance details retrieved',
      directAnswer,
      data: {
        plan: {
          insuranceName: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
          employer: plan.employer,
        },
        deductibles: {
          individual: plan.deductibleIndividual,
          family: plan.deductibleFamily,
          preventiveWaived: plan.deductibleOnPreventiveOverride === 0,
        },
        annualMax: {
          individual: plan.annualMaxIndividual,
          family: plan.annualMaxFamily,
        },
        coverage: {
          preventive: {
            exams: plan.preventiveDiagnosticsPct,
            xrays: plan.preventiveXRaysPct,
            cleanings: plan.preventiveRoutinePreventivePct,
          },
          basic: {
            fillings: plan.basicRestorativePct,
            rootCanals: plan.basicEndoPct,
            gumTreatment: plan.basicPerioPct,
            extractions: plan.basicOralSurgeryPct,
          },
          major: {
            crowns: plan.majorCrownsPct,
            prosthodontics: plan.majorProsthodonticsPct,
          },
          orthodontics: {
            coverage: plan.orthoPct,
            lifetimeMax: plan.orthoLifetimeMax,
          },
        },
        waitingPeriods: plan.waitingPeriods,
        frequencyLimits: plan.frequencyLimits,
        ageLimits: plan.ageLimits,
        exclusions: plan.exclusions,
        copayments: plan.copayments,
        downgrades: plan.downgrades,
      },
    },
  };
}

/**
 * Calculate out-of-pocket cost for a specific procedure
 * Considers: fee, coverage %, deductible, remaining annual max
 */
async function calculateOutOfPocket(
  params: Record<string, any>,
  clinicId?: string,
  odClient?: OpenDentalClient
): Promise<{ statusCode: number; body: any }> {
  const {
    procedure,
    procedureName,
    procCode,
    insuranceName,
    groupName,
    groupNumber,
    PatNum,
    deductibleMet, // Optional: if caller knows deductible status
  } = params;

  const searchClinicId = clinicId || params.clinicId;
  const treatmentName = procedure || procedureName || procCode;

  if (!treatmentName) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please specify the procedure (e.g., "crown", "cleaning", "D2740")',
      },
    };
  }

  // Map procedure name to codes
  const procedureMapping = mapProcedureToCode(treatmentName);
  if (!procedureMapping) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: `Could not identify procedure "${treatmentName}"`,
        examples: ['crown', 'cleaning', 'root canal', 'filling', 'extraction'],
      },
    };
  }

  let directAnswer = `=== OUT-OF-POCKET ESTIMATE ===\n`;
  directAnswer += `Procedure: ${procedureMapping.description}\n`;
  directAnswer += `CDT Code(s): ${procedureMapping.codes.join(', ')}\n\n`;

  // Get fee
  let fee: number | null = null;
  let feeScheduleName: string | null = null;

  for (const code of procedureMapping.codes) {
    const feeResult = await lookupFeeSchedules({ procCode: code, clinicId: searchClinicId }, searchClinicId);
    if (feeResult.statusCode === 200 && feeResult.body.data?.fees?.length > 0) {
      const feeRecord = feeResult.body.data.fees[0] as FeeScheduleRecord;
      if (feeRecord.amount !== null) {
        fee = feeRecord.amount;
        feeScheduleName = feeRecord.feeSchedule;
        directAnswer += `Fee (${feeScheduleName}): $${fee.toFixed(2)}\n`;
        break;
      }
    }
  }

  if (fee === null) {
    directAnswer += `Fee: Not found in fee schedule\n`;
  }

  // Get insurance coverage
  let coveragePercent: number | null = null;
  let deductible: number | null = null;
  let annualMax: number | null = null;
  let planName: string | null = null;

  if (insuranceName || groupName || groupNumber) {
    const insuranceResult = await lookupInsurancePlanBenefits(
      { insuranceName, groupName, groupNumber },
      searchClinicId
    );

    if (insuranceResult.statusCode === 200 && insuranceResult.body.data?.plans?.length > 0) {
      const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;
      planName = `${plan.insuranceName} - ${plan.groupName || ''}`;
      deductible = plan.deductibleIndividual;
      annualMax = plan.annualMaxIndividual;

      // Get coverage based on category
      switch (procedureMapping.category) {
        case 'preventive':
        case 'diagnostic':
          coveragePercent = plan.preventiveRoutinePreventivePct ?? plan.preventiveDiagnosticsPct;
          break;
        case 'basic':
          coveragePercent = plan.basicRestorativePct;
          break;
        case 'endo':
          coveragePercent = plan.basicEndoPct ?? plan.basicRestorativePct;
          break;
        case 'perio':
          coveragePercent = plan.basicPerioPct ?? plan.basicRestorativePct;
          break;
        case 'surgery':
          coveragePercent = plan.basicOralSurgeryPct ?? plan.basicRestorativePct;
          break;
        case 'major':
          coveragePercent = plan.majorCrownsPct ?? plan.majorProsthodonticsPct;
          break;
        case 'ortho':
          coveragePercent = plan.orthoPct;
          break;
      }

      // Normalize coverage percent
      if (coveragePercent !== null) {
        coveragePercent = coveragePercent > 1 ? coveragePercent : coveragePercent * 100;
      }

      directAnswer += `\nInsurance: ${planName}\n`;
      directAnswer += `Coverage for ${procedureMapping.category}: ${coveragePercent !== null ? `${Math.round(coveragePercent)}%` : 'Not specified'}\n`;
      if (deductible !== null) directAnswer += `Deductible: $${deductible}\n`;
      if (annualMax !== null) directAnswer += `Annual Max: $${annualMax}\n`;
    }
  }

  // Calculate out-of-pocket
  directAnswer += `\n=== COST BREAKDOWN ===\n`;

  if (fee !== null) {
    if (coveragePercent !== null) {
      const insurancePays = fee * (coveragePercent / 100);
      const patientPays = fee - insurancePays;

      directAnswer += `Total Fee: $${fee.toFixed(2)}\n`;
      directAnswer += `Insurance Pays (${Math.round(coveragePercent)}%): $${insurancePays.toFixed(2)}\n`;
      directAnswer += `Your Cost (${Math.round(100 - coveragePercent)}%): $${patientPays.toFixed(2)}\n`;

      // Deductible consideration
      if (deductible !== null && deductible > 0) {
        const isDeductibleMet = deductibleMet === true || deductibleMet === 'true' || deductibleMet === 'yes';

        if (isDeductibleMet) {
          directAnswer += `\n✓ Deductible already met - estimate above is accurate\n`;
        } else {
          directAnswer += `\n⚠️ IF DEDUCTIBLE NOT MET:\n`;
          directAnswer += `  Add up to $${deductible} to your cost\n`;
          directAnswer += `  Maximum out-of-pocket: $${(patientPays + deductible).toFixed(2)}\n`;
        }
      }
    } else {
      directAnswer += `Total Fee: $${fee.toFixed(2)}\n`;
      directAnswer += `Without insurance verification, you would pay the full amount.\n`;
    }
  } else {
    directAnswer += `Unable to calculate - fee not found in system\n`;
  }

  directAnswer += `\n─────────────────────────────────────\n`;
  directAnswer += `This is an ESTIMATE. Final cost depends on:\n`;
  directAnswer += `• Deductible status\n`;
  directAnswer += `• Remaining annual maximum\n`;
  directAnswer += `• Treatment complexity\n`;
  directAnswer += `• Any applicable waiting periods\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: `Out-of-pocket estimate for ${procedureMapping.description}`,
      directAnswer,
      data: {
        procedure: procedureMapping.description,
        procCodes: procedureMapping.codes,
        fee,
        feeSchedule: feeScheduleName,
        insurance: planName,
        coveragePercent,
        deductible,
        annualMax,
        estimatedInsurancePays: fee && coveragePercent ? fee * (coveragePercent / 100) : null,
        estimatedPatientPays: fee && coveragePercent ? fee * ((100 - coveragePercent) / 100) : fee,
      },
    },
  };
}

/**
 * Get annual maximum information
 * Answers questions about max amounts, remaining balance, separate maximums, reset dates
 */
async function getAnnualMaxInfo(
  params: Record<string, any>,
  clinicId?: string,
  odClient?: OpenDentalClient
): Promise<{ statusCode: number; body: any }> {
  const {
    insuranceName,
    groupName,
    groupNumber,
    PatNum,
  } = params;

  const searchClinicId = clinicId || params.clinicId;

  // Look up insurance plan
  if (!insuranceName && !groupName && !groupNumber) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please provide insurance information (insurance name, group name, or group number)',
      },
    };
  }

  const insuranceResult = await lookupInsurancePlanBenefits(
    { insuranceName, groupName, groupNumber },
    searchClinicId
  );

  if (insuranceResult.statusCode !== 200 || !insuranceResult.body.data?.plans?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: `Insurance plan not found for "${insuranceName || groupName || groupNumber}"`,
      },
    };
  }

  const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

  let directAnswer = `=== ANNUAL MAXIMUM INFORMATION ===\n\n`;
  directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
  if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
  directAnswer += `\n`;

  // === ANNUAL MAXIMUM AMOUNTS ===
  directAnswer += `💰 ANNUAL MAXIMUM AMOUNTS\n`;
  directAnswer += `───────────────────────────\n`;

  if (plan.annualMaxIndividual !== null) {
    directAnswer += `Individual Annual Max: $${plan.annualMaxIndividual.toLocaleString()}\n`;
    directAnswer += `  → Maximum the plan pays per person per year\n`;

    // Provide context on typical maximums
    if (plan.annualMaxIndividual >= 2000) {
      directAnswer += `  ✓ This is a good annual maximum\n`;
    } else if (plan.annualMaxIndividual >= 1500) {
      directAnswer += `  ℹ️ Average annual maximum for dental plans\n`;
    } else if (plan.annualMaxIndividual < 1000) {
      directAnswer += `  ⚠️ Lower than average - plan major work carefully\n`;
    }
  } else {
    directAnswer += `Individual Annual Max: Not specified\n`;
  }

  if (plan.annualMaxFamily !== null) {
    directAnswer += `\nFamily Annual Max: $${plan.annualMaxFamily.toLocaleString()}\n`;
    directAnswer += `  → Maximum the plan pays for entire family per year\n`;
  }
  directAnswer += `\n`;

  // === REMAINING BALANCE ===
  directAnswer += `📊 HOW MUCH IS REMAINING?\n`;
  directAnswer += `───────────────────────────\n`;

  let benefitsUsed: number | null = null;
  let benefitsRemaining: number | null = null;

  if (PatNum && odClient) {
    try {
      // Try to get insurance info which may include benefits used
      const familyInsurance = await odClient.request('GET', `familymodules/${PatNum}/Insurance`);

      if (familyInsurance && Array.isArray(familyInsurance)) {
        for (const ins of familyInsurance) {
          // Look for benefit/max used fields
          if (ins.AnnualMax !== undefined || ins.BenefitUsed !== undefined || ins.AmountUsed !== undefined) {
            const usedAmount = ins.BenefitUsed || ins.AmountUsed || 0;
            benefitsUsed = usedAmount;
            if (plan.annualMaxIndividual) {
              benefitsRemaining = Math.max(0, plan.annualMaxIndividual - usedAmount);
              directAnswer += `Benefits Used This Year: $${usedAmount.toFixed(2)}\n`;
              directAnswer += `Benefits Remaining: $${benefitsRemaining.toFixed(2)}\n`;

              // Usage percentage
              const usagePercent = (usedAmount / plan.annualMaxIndividual) * 100;
              if (usagePercent < 25) {
                directAnswer += `✅ Most of your benefits are still available\n`;
              } else if (usagePercent < 75) {
                directAnswer += `ℹ️ You've used about ${Math.round(usagePercent)}% of your annual max\n`;
              } else {
                directAnswer += `⚠️ You've used ${Math.round(usagePercent)}% - plan remaining work carefully\n`;
              }
            }
            break;
          }
        }
      }

      if (benefitsUsed === null) {
        directAnswer += `To check your remaining benefits:\n`;
        directAnswer += `  • Ask the front desk to verify benefits\n`;
        directAnswer += `  • They can check claims submitted this year\n`;
        directAnswer += `  • Or call your insurance company directly\n`;
      }
    } catch (e) {
      directAnswer += `To check your remaining benefits:\n`;
      directAnswer += `  • Ask the front desk to verify benefits\n`;
      directAnswer += `  • They can check claims submitted this year\n`;
    }
  } else {
    directAnswer += `To check how much you have remaining:\n`;
    directAnswer += `  • Provide your name and DOB for account lookup\n`;
    directAnswer += `  • Ask the dental office to check claims\n`;
    directAnswer += `  • Call your insurance company\n`;
    directAnswer += `  • Check your insurance company's online portal\n`;
  }
  directAnswer += `\n`;

  // === SEPARATE MAXIMUMS ===
  directAnswer += `🎯 SEPARATE MAXIMUMS BY SERVICE\n`;
  directAnswer += `───────────────────────────\n`;

  let hasSeparateMax = false;

  // Orthodontics lifetime max
  if (plan.orthoLifetimeMax !== null) {
    hasSeparateMax = true;
    directAnswer += `ORTHODONTICS:\n`;
    directAnswer += `  Lifetime Maximum: $${plan.orthoLifetimeMax.toLocaleString()}\n`;
    directAnswer += `  → This is separate from your annual max\n`;
    directAnswer += `  → It's a one-time lifetime amount for ortho treatment\n`;
    directAnswer += `  → Does NOT reset each year\n\n`;
  }

  // Check for other limitations that might indicate separate maximums
  if (plan.otherLimitations) {
    const limitations = plan.otherLimitations.split('|').map(s => s.trim()).filter(Boolean);
    const maxLimits = limitations.filter(l =>
      l.toLowerCase().includes('max') ||
      l.toLowerCase().includes('limit') ||
      l.toLowerCase().includes('$')
    );

    if (maxLimits.length > 0) {
      hasSeparateMax = true;
      directAnswer += `OTHER LIMITATIONS:\n`;
      maxLimits.forEach(limit => {
        directAnswer += `  • ${limit}\n`;
      });
      directAnswer += `\n`;
    }
  }

  if (!hasSeparateMax) {
    directAnswer += `No separate maximums found for this plan.\n`;
    directAnswer += `All covered services share the same annual maximum.\n\n`;
  }

  // === WHEN DOES IT RESET? ===
  directAnswer += `📅 WHEN DOES THE ANNUAL MAX RESET?\n`;
  directAnswer += `───────────────────────────\n`;
  directAnswer += `Most dental plans use one of two reset schedules:\n\n`;

  directAnswer += `CALENDAR YEAR (Most Common):\n`;
  directAnswer += `  • Resets January 1st each year\n`;
  directAnswer += `  • Most employer-sponsored plans use this\n\n`;

  directAnswer += `PLAN YEAR / BENEFIT YEAR:\n`;
  directAnswer += `  • Resets on your plan anniversary date\n`;
  directAnswer += `  • Common with individual plans\n`;
  directAnswer += `  • Check your enrollment date or policy documents\n\n`;

  directAnswer += `💡 TIP: Your insurance card or plan documents will show\n`;
  directAnswer += `   whether it's a calendar year or plan year schedule.\n\n`;

  // Note about unused benefits
  directAnswer += `⚠️ IMPORTANT: Unused benefits do NOT roll over!\n`;
  directAnswer += `   Any unused portion of your annual max is lost at reset.\n`;
  directAnswer += `   Use your benefits before the year ends!\n\n`;

  // === USING BENEFITS AT ANOTHER OFFICE ===
  directAnswer += `🏥 BENEFITS USED AT OTHER OFFICES\n`;
  directAnswer += `───────────────────────────\n`;
  directAnswer += `YES - Benefits used at any dental office count against\n`;
  directAnswer += `your annual maximum. Here's how it works:\n\n`;

  directAnswer += `• Your insurance tracks ALL claims for the year\n`;
  directAnswer += `• Doesn't matter which dentist or location\n`;
  directAnswer += `• All claims reduce your remaining annual max\n`;
  directAnswer += `• This includes specialists (orthodontist, oral surgeon)\n\n`;

  directAnswer += `To get accurate remaining benefits:\n`;
  directAnswer += `  1. Call your insurance company, or\n`;
  directAnswer += `  2. Ask this office to run a benefits verification\n`;
  directAnswer += `  3. Check your insurance portal online\n\n`;

  // === COVERAGE PERCENTAGES ===
  directAnswer += `📊 COVERAGE % (CO-INSURANCE) BY CATEGORY\n`;
  directAnswer += `───────────────────────────\n`;

  const formatPct = (pct: number | null): string => {
    if (pct === null || pct === undefined) return 'Not specified';
    const val = pct > 1 ? pct : pct * 100;
    return `${Math.round(val)}%`;
  };

  const formatRow = (name: string, pct: number | null, examples: string): string => {
    const coverage = formatPct(pct);
    const youPay = pct !== null ? `${Math.round(100 - (pct > 1 ? pct : pct * 100))}%` : '?';
    return `${name.padEnd(20)} ${coverage.padEnd(8)} You pay ${youPay}\n    Examples: ${examples}\n`;
  };

  directAnswer += `\nPREVENTIVE (usually 100%):\n`;
  directAnswer += `  Exams:         ${formatPct(plan.preventiveDiagnosticsPct)}\n`;
  directAnswer += `  X-Rays:        ${formatPct(plan.preventiveXRaysPct)}\n`;
  directAnswer += `  Cleanings:     ${formatPct(plan.preventiveRoutinePreventivePct)}\n`;

  directAnswer += `\nBASIC (usually 80%):\n`;
  directAnswer += `  Fillings:      ${formatPct(plan.basicRestorativePct)}\n`;
  directAnswer += `  Root Canals:   ${formatPct(plan.basicEndoPct)}\n`;
  directAnswer += `  Extractions:   ${formatPct(plan.basicOralSurgeryPct)}\n`;
  directAnswer += `  Gum Treatment: ${formatPct(plan.basicPerioPct)}\n`;

  directAnswer += `\nMAJOR (usually 50%):\n`;
  directAnswer += `  Crowns:        ${formatPct(plan.majorCrownsPct)}\n`;
  directAnswer += `  Bridges:       ${formatPct(plan.majorProsthodonticsPct)}\n`;
  directAnswer += `  Dentures:      ${formatPct(plan.majorProsthodonticsPct)}\n`;

  if (plan.orthoPct !== null) {
    directAnswer += `\nORTHODONTICS:\n`;
    directAnswer += `  Coverage:      ${formatPct(plan.orthoPct)}\n`;
    if (plan.orthoLifetimeMax) {
      directAnswer += `  Lifetime Max:  $${plan.orthoLifetimeMax.toLocaleString()}\n`;
    }
  }

  directAnswer += `\n`;

  // Summary
  directAnswer += `───────────────────────────\n`;
  directAnswer += `QUICK SUMMARY:\n`;
  if (plan.annualMaxIndividual) {
    directAnswer += `• Annual Max: $${plan.annualMaxIndividual.toLocaleString()}`;
    if (benefitsRemaining !== null) {
      directAnswer += ` (Remaining: $${benefitsRemaining.toFixed(2)})`;
    }
    directAnswer += `\n`;
  }
  if (plan.orthoLifetimeMax) {
    directAnswer += `• Ortho Lifetime Max: $${plan.orthoLifetimeMax.toLocaleString()} (separate)\n`;
  }
  directAnswer += `• Reset: Typically January 1 (verify with plan)\n`;
  directAnswer += `• Other offices: Yes, all claims reduce your max\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Annual maximum information retrieved',
      directAnswer,
      data: {
        plan: {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
        },
        annualMax: {
          individual: plan.annualMaxIndividual,
          family: plan.annualMaxFamily,
          orthoLifetime: plan.orthoLifetimeMax,
        },
        usage: {
          used: benefitsUsed,
          remaining: benefitsRemaining,
        },
        coveragePercentages: {
          preventive: {
            exams: plan.preventiveDiagnosticsPct,
            xrays: plan.preventiveXRaysPct,
            cleanings: plan.preventiveRoutinePreventivePct,
          },
          basic: {
            fillings: plan.basicRestorativePct,
            rootCanals: plan.basicEndoPct,
            extractions: plan.basicOralSurgeryPct,
            gumTreatment: plan.basicPerioPct,
          },
          major: {
            crowns: plan.majorCrownsPct,
            prosthodontics: plan.majorProsthodonticsPct,
          },
          ortho: plan.orthoPct,
        },
      },
    },
  };
}

/**
 * Get detailed deductible information
 * Answers questions about individual vs family, what's been met, what it applies to
 */
async function getDeductibleInfo(
  params: Record<string, any>,
  clinicId?: string,
  odClient?: OpenDentalClient
): Promise<{ statusCode: number; body: any }> {
  const {
    insuranceName,
    groupName,
    groupNumber,
    PatNum,
  } = params;

  const searchClinicId = clinicId || params.clinicId;

  // Look up insurance plan
  if (!insuranceName && !groupName && !groupNumber) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please provide insurance information (insurance name, group name, or group number)',
      },
    };
  }

  const insuranceResult = await lookupInsurancePlanBenefits(
    { insuranceName, groupName, groupNumber },
    searchClinicId
  );

  if (insuranceResult.statusCode !== 200 || !insuranceResult.body.data?.plans?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: `Insurance plan not found for "${insuranceName || groupName || groupNumber}"`,
      },
    };
  }

  const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

  let directAnswer = `=== DEDUCTIBLE INFORMATION ===\n\n`;
  directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
  if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
  directAnswer += `\n`;

  // === INDIVIDUAL VS FAMILY DEDUCTIBLE ===
  directAnswer += `📋 DEDUCTIBLE AMOUNTS\n`;
  directAnswer += `───────────────────────────\n`;

  if (plan.deductibleIndividual !== null) {
    directAnswer += `Individual Deductible: $${plan.deductibleIndividual}\n`;
    directAnswer += `  → Each person must meet this amount before insurance pays\n`;
  } else {
    directAnswer += `Individual Deductible: Not specified in plan\n`;
  }

  if (plan.deductibleFamily !== null) {
    directAnswer += `\nFamily Deductible: $${plan.deductibleFamily}\n`;
    directAnswer += `  → Once the family total reaches this, deductible is met for everyone\n`;

    // Explain how family deductible works
    if (plan.deductibleIndividual && plan.deductibleFamily) {
      const membersNeeded = Math.ceil(plan.deductibleFamily / plan.deductibleIndividual);
      directAnswer += `  → Usually ${membersNeeded} family members meeting individual = family met\n`;
    }
  }
  directAnswer += `\n`;

  // === DEDUCTIBLE MET STATUS ===
  directAnswer += `📊 DEDUCTIBLE STATUS\n`;
  directAnswer += `───────────────────────────\n`;

  if (PatNum && odClient) {
    try {
      // Try to get family insurance info which may have deductible usage
      const familyInsurance = await odClient.request('GET', `familymodules/${PatNum}/Insurance`);

      if (familyInsurance && Array.isArray(familyInsurance)) {
        // Look for deductible information in the response
        for (const ins of familyInsurance) {
          if (ins.DeductUsed !== undefined || ins.DeductibleUsed !== undefined) {
            const used = ins.DeductUsed || ins.DeductibleUsed || 0;
            const remaining = Math.max(0, (plan.deductibleIndividual || 0) - used);
            directAnswer += `Deductible Used: $${used.toFixed(2)}\n`;
            directAnswer += `Deductible Remaining: $${remaining.toFixed(2)}\n`;

            if (remaining === 0) {
              directAnswer += `✅ Your deductible has been MET!\n`;
            } else {
              directAnswer += `⏳ You still need $${remaining.toFixed(2)} to meet your deductible\n`;
            }
            break;
          }
        }
      } else {
        directAnswer += `To check how much you've met, please verify with the office.\n`;
        directAnswer += `They can check your claims history for the current year.\n`;
      }
    } catch (e) {
      directAnswer += `To check how much you've met, please verify with the office.\n`;
      directAnswer += `They can check your claims history for the current year.\n`;
    }
  } else {
    directAnswer += `To check how much you've met this year:\n`;
    directAnswer += `  • Provide your name and DOB for account lookup, or\n`;
    directAnswer += `  • Call the office - they can check your claims\n`;
    directAnswer += `  • Call your insurance company directly\n`;
  }
  directAnswer += `\n`;

  // === WHAT DOES DEDUCTIBLE APPLY TO? ===
  directAnswer += `🔍 WHAT DOES THE DEDUCTIBLE APPLY TO?\n`;
  directAnswer += `───────────────────────────\n`;

  // Preventive care
  if (plan.deductibleOnPreventiveOverride === 0) {
    directAnswer += `✅ PREVENTIVE CARE: NO deductible (waived)\n`;
    directAnswer += `   Cleanings, exams, and most preventive services - no deductible\n`;
  } else if (plan.deductibleOnPreventiveOverride !== null) {
    directAnswer += `⚠️ PREVENTIVE CARE: $${plan.deductibleOnPreventiveOverride} deductible applies\n`;
  } else {
    // Check if preventive has a category override
    const preventiveOverride = plan.deductibleOverridesByCategory?.toLowerCase().includes('preventive') ||
      plan.deductibleOverridesByCategory?.toLowerCase().includes('diagnostic');
    if (preventiveOverride) {
      directAnswer += `PREVENTIVE CARE: Special deductible - see overrides below\n`;
    } else {
      directAnswer += `PREVENTIVE CARE: Standard deductible likely waived (common for most plans)\n`;
      directAnswer += `   Most plans waive deductible for preventive - verify with office\n`;
    }
  }

  // X-rays and exams
  directAnswer += `\n📷 X-RAYS & EXAMS:\n`;
  if (plan.deductibleOnPreventiveOverride === 0) {
    directAnswer += `   Usually classified as preventive/diagnostic - NO deductible\n`;
  } else {
    directAnswer += `   May be subject to deductible depending on plan classification\n`;
    directAnswer += `   Routine x-rays often waived, but FMX/pano may apply\n`;
  }

  // Basic and Major
  directAnswer += `\n🔧 BASIC SERVICES (fillings, root canals, extractions):\n`;
  directAnswer += `   Standard deductible applies: $${plan.deductibleIndividual || 'N/A'}\n`;

  directAnswer += `\n👑 MAJOR SERVICES (crowns, bridges, dentures):\n`;
  directAnswer += `   Standard deductible applies: $${plan.deductibleIndividual || 'N/A'}\n`;
  directAnswer += `\n`;

  // === DEDUCTIBLE OVERRIDES BY CATEGORY ===
  if (plan.deductibleOverridesByCategory) {
    directAnswer += `📝 DEDUCTIBLE OVERRIDES BY CATEGORY\n`;
    directAnswer += `───────────────────────────\n`;
    plan.deductibleOverridesByCategory.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
    directAnswer += `\n`;
  }

  // === DUAL COVERAGE / COORDINATION OF BENEFITS ===
  directAnswer += `💡 DUAL COVERAGE (TWO INSURANCE PLANS)\n`;
  directAnswer += `───────────────────────────\n`;
  directAnswer += `If you have two dental insurance plans:\n`;
  directAnswer += `\n`;
  directAnswer += `1. PRIMARY PLAN pays first:\n`;
  directAnswer += `   • Usually the plan where you're the subscriber (not dependent)\n`;
  directAnswer += `   • For children: "Birthday Rule" - parent whose birthday comes\n`;
  directAnswer += `     first in the calendar year is primary\n`;
  directAnswer += `\n`;
  directAnswer += `2. SECONDARY PLAN pays after:\n`;
  directAnswer += `   • Picks up remaining costs after primary pays\n`;
  directAnswer += `   • May have its own deductible requirement\n`;
  directAnswer += `   • Combined payment usually won't exceed 100% of the fee\n`;
  directAnswer += `\n`;
  directAnswer += `3. DEDUCTIBLE COORDINATION:\n`;
  directAnswer += `   • Primary deductible must typically be met first\n`;
  directAnswer += `   • Secondary may credit primary's payment toward its deductible\n`;
  directAnswer += `   • Policies vary - verify with both insurers\n`;
  directAnswer += `\n`;

  // Summary
  directAnswer += `───────────────────────────\n`;
  directAnswer += `QUICK SUMMARY:\n`;
  if (plan.deductibleIndividual !== null) {
    directAnswer += `• Individual: $${plan.deductibleIndividual}`;
    if (plan.deductibleOnPreventiveOverride === 0) {
      directAnswer += ` (waived for preventive)`;
    }
    directAnswer += `\n`;
  }
  if (plan.deductibleFamily !== null) {
    directAnswer += `• Family: $${plan.deductibleFamily}\n`;
  }

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Deductible information retrieved',
      directAnswer,
      data: {
        plan: {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
        },
        deductibles: {
          individual: plan.deductibleIndividual,
          family: plan.deductibleFamily,
          preventiveWaived: plan.deductibleOnPreventiveOverride === 0,
          preventiveOverride: plan.deductibleOnPreventiveOverride,
          categoryOverrides: plan.deductibleOverridesByCategory,
        },
        explanations: {
          preventive: plan.deductibleOnPreventiveOverride === 0
            ? 'No deductible for preventive services'
            : 'Deductible may apply',
          xraysExams: plan.deductibleOnPreventiveOverride === 0
            ? 'Usually no deductible (preventive/diagnostic)'
            : 'Check plan details',
          basic: 'Standard deductible applies',
          major: 'Standard deductible applies',
        },
      },
    },
  };
}

/**
 * Get coordination of benefits / dual insurance information
 * Answers questions about primary/secondary insurance, COB, out-of-pocket with two plans
 */
async function getCoordinationOfBenefits(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const {
    insuranceName,
    groupName,
    groupNumber,
    primaryInsurance,
    secondaryInsurance,
  } = params;

  const searchClinicId = clinicId || params.clinicId;

  let directAnswer = `=== COORDINATION OF BENEFITS (DUAL INSURANCE) ===\n\n`;

  // Try to get plan info if provided
  let plan: InsurancePlanRecord | null = null;
  if (insuranceName || groupName || groupNumber) {
    const insuranceResult = await lookupInsurancePlanBenefits(
      { insuranceName, groupName, groupNumber },
      searchClinicId
    );
    if (insuranceResult.statusCode === 200 && insuranceResult.body.data?.plans?.length) {
      plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;
      directAnswer += `Plan on file: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
      if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
      directAnswer += `\n`;
    }
  }

  // === WILL YOU BILL BOTH? ===
  directAnswer += `📋 WILL WE BILL BOTH INSURANCES?\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `YES! We bill both insurances for you.\n\n`;

  directAnswer += `HOW IT WORKS:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `1. We submit the claim to your PRIMARY insurance first\n`;
  directAnswer += `2. After primary pays, we submit to SECONDARY insurance\n`;
  directAnswer += `3. Secondary pays based on what's remaining\n`;
  directAnswer += `4. You pay any remaining balance\n\n`;

  directAnswer += `TIMELINE:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Primary claim: 2-4 weeks to process\n`;
  directAnswer += `• Secondary claim: 2-4 weeks after primary pays\n`;
  directAnswer += `• Total: 4-8 weeks for both to process\n`;
  directAnswer += `• We handle all the paperwork!\n\n`;

  // === PRIMARY VS SECONDARY ===
  directAnswer += `🏆 WHICH PLAN IS PRIMARY VS SECONDARY?\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `DETERMINATION RULES (in order):\n`;
  directAnswer += `─────────────────────────────────────────\n\n`;

  directAnswer += `FOR ADULTS (Subscriber):\n`;
  directAnswer += `• YOUR employer plan = Primary\n`;
  directAnswer += `• Spouse's plan (you as dependent) = Secondary\n\n`;

  directAnswer += `FOR CHILDREN (under both parents):\n`;
  directAnswer += `• "BIRTHDAY RULE" applies:\n`;
  directAnswer += `  → Parent whose birthday comes FIRST in the year = Primary\n`;
  directAnswer += `  → (Month/day only, not year of birth)\n`;
  directAnswer += `  → Example: Dad born March 15, Mom born July 20\n`;
  directAnswer += `    Dad's plan is primary for the kids\n\n`;

  directAnswer += `DIVORCED/SEPARATED PARENTS:\n`;
  directAnswer += `• Court order determines if specified\n`;
  directAnswer += `• Otherwise: Custodial parent → Primary\n`;
  directAnswer += `• Then: Custodial parent's spouse\n`;
  directAnswer += `• Then: Non-custodial parent\n`;
  directAnswer += `• Then: Non-custodial parent's spouse\n\n`;

  directAnswer += `SPECIAL CASES:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• COBRA or retiree coverage: Usually Secondary\n`;
  directAnswer += `• Medicare + employer plan: Depends on employer size\n`;
  directAnswer += `  → Employer >20 employees: Employer plan = Primary\n`;
  directAnswer += `  → Employer <20 employees: Medicare = Primary\n`;
  directAnswer += `• Medicaid: ALWAYS Secondary (pay last)\n\n`;

  // === OUT OF POCKET ===
  directAnswer += `💵 WILL MY OUT-OF-POCKET DROP TO ZERO?\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `MAYBE, but often there's still a patient portion.\n\n`;

  directAnswer += `HOW SECONDARY INSURANCE CALCULATES:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `There are different COB methods:\n\n`;

  directAnswer += `1. TRADITIONAL / STANDARD COB:\n`;
  directAnswer += `   Secondary pays up to what IT would have paid\n`;
  directAnswer += `   as if it were primary, minus what primary paid.\n`;
  directAnswer += `   → Often reduces patient portion to $0\n\n`;

  directAnswer += `2. NON-DUPLICATION / DIFFERENCE COB:\n`;
  directAnswer += `   Secondary only pays if its benefit would have\n`;
  directAnswer += `   been HIGHER than what primary paid.\n`;
  directAnswer += `   → May still leave patient portion\n\n`;

  directAnswer += `3. CARVE-OUT COB:\n`;
  directAnswer += `   Secondary calculates its payment, then subtracts\n`;
  directAnswer += `   what primary paid.\n`;
  directAnswer += `   → Usually leaves patient portion\n\n`;

  directAnswer += `EXAMPLE (Cleaning $150):\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `Primary covers 100%: Pays $150 → You owe $0 ✓\n`;
  directAnswer += `(Secondary not needed)\n\n`;

  directAnswer += `Primary covers 80%: Pays $120\n`;
  directAnswer += `Secondary (Traditional): Pays remaining $30 → You owe $0 ✓\n`;
  directAnswer += `Secondary (Non-dup): May pay $0-$30 → You may owe $0-$30\n\n`;

  directAnswer += `EXAMPLE (Crown $1,000):\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `Primary covers 50%: Pays $500\n`;
  directAnswer += `Secondary covers 50%: \n`;
  directAnswer += `  • Traditional COB: Pays $500 → You owe $0 ✓\n`;
  directAnswer += `  • Non-dup COB: Pays $0 (already at 50%) → You owe $500\n\n`;

  directAnswer += `⚠️ KEY FACTORS:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Each plan's annual maximum still applies separately\n`;
  directAnswer += `• Secondary won't pay more than its own max\n`;
  directAnswer += `• Deductibles may apply to both plans\n`;
  directAnswer += `• Waiting periods on secondary still apply\n`;
  directAnswer += `• Total payments never exceed 100% of the fee\n\n`;

  directAnswer += `💡 TIP: With two plans, you can often maximize benefits\n`;
  directAnswer += `   by timing major procedures strategically.\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Coordination of benefits information retrieved',
      directAnswer,
      data: {
        plan: plan ? {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
        } : null,
        keyPoints: {
          billsBothInsurances: true,
          primaryDetermination: 'Birthday rule for children, subscriber rule for adults',
          outOfPocket: 'Depends on COB method - Traditional may reduce to $0, Non-duplication may leave balance',
        },
      },
    },
  };
}

/**
 * Get payment timing and options information
 * Answers questions about when to pay, payment plans, financing options
 */
async function getPaymentInfo(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const searchClinicId = clinicId || params.clinicId;

  let directAnswer = `=== PAYMENT TIMING & OPTIONS ===\n\n`;

  // === PAYMENT TIMING ===
  directAnswer += `💳 WHEN DO I PAY?\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `WHAT WE COLLECT AT YOUR VISIT:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Copay (if your plan has one): Due at check-in\n`;
  directAnswer += `• Estimated patient portion: Usually collected at time of service\n`;
  directAnswer += `• Deductible amount: If not yet met for the year\n\n`;

  directAnswer += `WHY WE COLLECT AN ESTIMATE:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Insurance takes 2-4 weeks to process claims\n`;
  directAnswer += `• Collecting estimates reduces outstanding balances\n`;
  directAnswer += `• Helps avoid surprise bills later\n`;
  directAnswer += `• Standard practice in dental offices\n\n`;

  directAnswer += `WHAT HAPPENS AFTER YOUR VISIT:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `1. We submit claim to insurance (within 24-48 hours)\n`;
  directAnswer += `2. Insurance processes (2-4 weeks typical)\n`;
  directAnswer += `3. We receive Explanation of Benefits (EOB)\n`;
  directAnswer += `4. We reconcile what insurance paid vs. estimate\n`;
  directAnswer += `5. If balance due: Statement sent to you\n`;
  directAnswer += `6. If overpaid: Credit applied or refund issued\n\n`;

  // === IF INSURANCE DOESN'T PAY ===
  directAnswer += `⚠️ IF INSURANCE DOESN'T PAY AS EXPECTED\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `CLAIM DENIED OR REDUCED:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• We'll review the denial reason\n`;
  directAnswer += `• Appeal if appropriate (many denials are reversed)\n`;
  directAnswer += `• Contact you before sending a bill\n`;
  directAnswer += `• Explain what happened and options\n\n`;

  directAnswer += `WHEN WE'LL BILL YOU:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• After insurance processes (usually 2-4 weeks)\n`;
  directAnswer += `• Statement shows:\n`;
  directAnswer += `  → Original charges\n`;
  directAnswer += `  → Insurance payment received\n`;
  directAnswer += `  → Adjustments/write-offs\n`;
  directAnswer += `  → Your remaining balance\n`;
  directAnswer += `  → Payments you've already made\n\n`;

  directAnswer += `PAYMENT DUE:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Balance typically due within 30 days of statement\n`;
  directAnswer += `• Payment plan options available (see below)\n`;
  directAnswer += `• Questions? Call us before the due date!\n\n`;

  // === PAYMENT METHODS ===
  directAnswer += `💰 ACCEPTED PAYMENT METHODS\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `AT TIME OF SERVICE:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `✓ Cash\n`;
  directAnswer += `✓ Credit cards (Visa, Mastercard, Amex, Discover)\n`;
  directAnswer += `✓ Debit cards\n`;
  directAnswer += `✓ HSA/FSA cards (Health Savings / Flex Spending)\n`;
  directAnswer += `✓ Personal checks\n`;
  directAnswer += `✓ CareCredit / Financing (if approved)\n\n`;

  directAnswer += `FOR MAILED STATEMENTS:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Pay online through patient portal\n`;
  directAnswer += `• Call office with card payment\n`;
  directAnswer += `• Mail check to office address\n\n`;

  // === PAYMENT PLANS ===
  directAnswer += `📆 PAYMENT PLANS & FINANCING\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `IN-HOUSE PAYMENT PLANS:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Available for larger treatment plans\n`;
  directAnswer += `• Split into 2-6 monthly payments\n`;
  directAnswer += `• Usually interest-free\n`;
  directAnswer += `• Requires down payment (often 50%)\n`;
  directAnswer += `• Credit card on file for auto-payments\n`;
  directAnswer += `• Ask our front desk for details!\n\n`;

  directAnswer += `THIRD-PARTY FINANCING:\n`;
  directAnswer += `─────────────────────────────────────────\n\n`;

  directAnswer += `CARECREDIT:\n`;
  directAnswer += `  • Healthcare credit card\n`;
  directAnswer += `  • 0% interest for 6-24 months (if paid in full)\n`;
  directAnswer += `  • Apply online or in-office\n`;
  directAnswer += `  • Instant approval decision\n`;
  directAnswer += `  • Use for dental, medical, vision, vet\n`;
  directAnswer += `  • www.carecredit.com\n\n`;

  directAnswer += `LENDING CLUB:\n`;
  directAnswer += `  • Personal loans for dental work\n`;
  directAnswer += `  • Fixed monthly payments\n`;
  directAnswer += `  • Various term lengths\n`;
  directAnswer += `  • Check rate without affecting credit\n\n`;

  directAnswer += `SUNBIT:\n`;
  directAnswer += `  • Buy now, pay later\n`;
  directAnswer += `  • Easy approval (high acceptance rate)\n`;
  directAnswer += `  • Split into monthly payments\n`;
  directAnswer += `  • Apply in-office at checkout\n\n`;

  directAnswer += `CHERRY / PROCEED FINANCE:\n`;
  directAnswer += `  • Patient financing options\n`;
  directAnswer += `  • Quick approval\n`;
  directAnswer += `  • Flexible payment terms\n\n`;

  // === HSA/FSA ===
  directAnswer += `🏦 HSA / FSA ACCOUNTS\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `USING HSA/FSA FOR DENTAL:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `✓ Cleanings, exams, x-rays\n`;
  directAnswer += `✓ Fillings, crowns, root canals\n`;
  directAnswer += `✓ Extractions, oral surgery\n`;
  directAnswer += `✓ Dentures, bridges, implants\n`;
  directAnswer += `✓ Orthodontics (braces/Invisalign)\n`;
  directAnswer += `✓ Periodontal treatment\n`;
  directAnswer += `✓ Anesthesia/sedation\n\n`;

  directAnswer += `USUALLY NOT HSA/FSA ELIGIBLE:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `✗ Teeth whitening (cosmetic)\n`;
  directAnswer += `✗ Cosmetic veneers\n`;
  directAnswer += `✗ Electric toothbrushes (usually)\n\n`;

  directAnswer += `💡 TIP: Use FSA funds before year-end!\n`;
  directAnswer += `   FSA funds often expire Dec 31 or have limited rollover.\n`;
  directAnswer += `   Schedule treatment to maximize benefits.\n\n`;

  // === DISCOUNTS ===
  directAnswer += `🏷️ DISCOUNTS & SAVINGS\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `ASK ABOUT:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• In-house dental savings plan (no insurance)\n`;
  directAnswer += `• Senior discounts\n`;
  directAnswer += `• Cash pay discounts (pay in full today)\n`;
  directAnswer += `• Multi-family member discounts\n`;
  directAnswer += `• Referral credits\n`;
  directAnswer += `• New patient specials\n\n`;

  directAnswer += `═══════════════════════════════════════\n`;
  directAnswer += `📞 QUESTIONS ABOUT YOUR BILL?\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Call us! We're happy to explain charges\n`;
  directAnswer += `• Review your EOB from insurance\n`;
  directAnswer += `• Ask about payment arrangements\n`;
  directAnswer += `• Request itemized statement if needed\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Payment information retrieved',
      directAnswer,
      data: {
        paymentTiming: {
          atVisit: 'Copay + estimated patient portion',
          afterInsurance: 'Statement sent if balance due (2-4 weeks)',
          dueDate: 'Typically 30 days from statement',
        },
        paymentMethods: ['Cash', 'Credit/Debit', 'HSA/FSA', 'Check', 'CareCredit'],
        financingOptions: [
          { name: 'In-house payment plan', interest: 'Usually 0%', terms: '2-6 months' },
          { name: 'CareCredit', interest: '0% promotional', terms: '6-24 months' },
          { name: 'Sunbit', interest: 'Varies', terms: 'Monthly payments' },
          { name: 'LendingClub', interest: 'Fixed rate', terms: 'Various' },
        ],
        hsaFsaEligible: true,
      },
    },
  };
}

/**
 * Get waiting period and eligibility information
 * Answers questions about waiting periods, pre-existing conditions, missing tooth clauses
 */
async function getWaitingPeriodInfo(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const {
    insuranceName,
    groupName,
    groupNumber,
  } = params;

  const searchClinicId = clinicId || params.clinicId;

  // Look up insurance plan
  if (!insuranceName && !groupName && !groupNumber) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please provide insurance information (insurance name, group name, or group number)',
      },
    };
  }

  const insuranceResult = await lookupInsurancePlanBenefits(
    { insuranceName, groupName, groupNumber },
    searchClinicId
  );

  if (insuranceResult.statusCode !== 200 || !insuranceResult.body.data?.plans?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: `Insurance plan not found for "${insuranceName || groupName || groupNumber}"`,
      },
    };
  }

  const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

  let directAnswer = `=== WAITING PERIODS & ELIGIBILITY ===\n\n`;
  directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
  if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
  directAnswer += `\n`;

  // === WAITING PERIODS ===
  directAnswer += `⏳ WAITING PERIODS\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  if (plan.waitingPeriods) {
    directAnswer += `YOUR PLAN'S WAITING PERIODS:\n`;
    directAnswer += `─────────────────────────────\n`;
    const periods = plan.waitingPeriods.split('|').map(s => s.trim()).filter(Boolean);
    periods.forEach(period => {
      directAnswer += `  • ${period}\n`;
    });
    directAnswer += `\n`;
  } else {
    directAnswer += `No specific waiting periods recorded for this plan.\n`;
    directAnswer += `(This may mean no waiting periods, or data not yet entered)\n\n`;
  }

  directAnswer += `COMMON WAITING PERIOD PATTERNS:\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `• PREVENTIVE (cleanings, exams, x-rays):\n`;
  directAnswer += `  Usually NO waiting period - covered immediately\n\n`;
  directAnswer += `• BASIC (fillings, extractions, root canals):\n`;
  directAnswer += `  Often 6-12 month waiting period\n\n`;
  directAnswer += `• MAJOR (crowns, bridges, dentures):\n`;
  directAnswer += `  Often 12 month waiting period\n`;
  directAnswer += `  Some plans: 6 months to 24 months\n\n`;
  directAnswer += `• ORTHODONTICS:\n`;
  directAnswer += `  Often 12-24 month waiting period\n`;
  directAnswer += `  Some plans exclude ortho entirely\n\n`;

  directAnswer += `JUST SWITCHED JOBS/PLANS?\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `• New employer plan: Waiting periods typically apply\n`;
  directAnswer += `• Group-to-group switch: Some carriers waive waiting periods\n`;
  directAnswer += `  if you had continuous coverage (ask HR/carrier)\n`;
  directAnswer += `• COBRA continuation: No new waiting periods\n`;
  directAnswer += `• Individual plan: Usually has waiting periods\n\n`;

  directAnswer += `💡 TIP: If you have an urgent major procedure need,\n`;
  directAnswer += `   ask if your employer negotiated waived waiting periods.\n`;
  directAnswer += `\n`;

  // === EXCLUSIONS ===
  directAnswer += `🚫 EXCLUSIONS & LIMITATIONS\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  if (plan.exclusions) {
    directAnswer += `YOUR PLAN'S EXCLUSIONS:\n`;
    directAnswer += `─────────────────────────────\n`;
    const exclusions = plan.exclusions.split('|').map(s => s.trim()).filter(Boolean);
    exclusions.forEach(excl => {
      directAnswer += `  ❌ ${excl}\n`;
    });
    directAnswer += `\n`;
  }

  // Check for missing tooth clause
  const hasMissingToothClause = plan.exclusions?.toLowerCase().includes('missing tooth') ||
    plan.otherLimitations?.toLowerCase().includes('missing tooth') ||
    plan.planNote?.toLowerCase().includes('missing tooth');

  directAnswer += `MISSING TOOTH CLAUSE:\n`;
  directAnswer += `─────────────────────────────\n`;
  if (hasMissingToothClause) {
    directAnswer += `⚠️ YOUR PLAN MAY HAVE A MISSING TOOTH CLAUSE\n\n`;
  }
  directAnswer += `What is it?\n`;
  directAnswer += `  If a tooth was already missing BEFORE your coverage\n`;
  directAnswer += `  started, the plan may NOT pay to replace it with:\n`;
  directAnswer += `  • Bridge\n`;
  directAnswer += `  • Implant\n`;
  directAnswer += `  • Partial denture\n\n`;
  directAnswer += `How to verify:\n`;
  directAnswer += `  1. Check your original enrollment date\n`;
  directAnswer += `  2. Compare to when tooth was extracted\n`;
  directAnswer += `  3. If extraction was BEFORE enrollment = may be excluded\n\n`;

  directAnswer += `PRE-EXISTING CONDITIONS:\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `Unlike medical insurance, dental plans CAN exclude\n`;
  directAnswer += `pre-existing conditions. Common examples:\n`;
  directAnswer += `  • Decay that existed before enrollment\n`;
  directAnswer += `  • Teeth already in need of root canal\n`;
  directAnswer += `  • Existing gum disease (periodontal condition)\n`;
  directAnswer += `  • Missing teeth (missing tooth clause)\n`;
  directAnswer += `  • Orthodontic treatment already started\n\n`;

  directAnswer += `REPLACEMENT CLAUSES:\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `Many plans won't replace existing work too soon:\n`;
  directAnswer += `  • Crowns: Usually 5-10 years before replacement covered\n`;
  directAnswer += `  • Bridges: Usually 5-10 years\n`;
  directAnswer += `  • Dentures: Usually 5-10 years\n`;
  directAnswer += `  • Fillings: Usually 2-5 years (varies by material)\n`;

  // Show other limitations if available
  if (plan.otherLimitations) {
    directAnswer += `\n`;
    directAnswer += `OTHER LIMITATIONS:\n`;
    directAnswer += `─────────────────────────────\n`;
    const limitations = plan.otherLimitations.split('|').map(s => s.trim()).filter(Boolean);
    limitations.forEach(limit => {
      directAnswer += `  • ${limit}\n`;
    });
  }

  // Show plan notes if available
  if (plan.planNote) {
    directAnswer += `\n`;
    directAnswer += `PLAN NOTES:\n`;
    directAnswer += `─────────────────────────────\n`;
    directAnswer += `${plan.planNote}\n`;
  }

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Waiting period and eligibility information retrieved',
      directAnswer,
      data: {
        plan: {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
        },
        waitingPeriods: plan.waitingPeriods,
        exclusions: plan.exclusions,
        hasMissingToothClause,
        otherLimitations: plan.otherLimitations,
        planNote: plan.planNote,
      },
    },
  };
}

/**
 * Explain dental estimates and why they can change
 * Answers questions about estimate accuracy, balance billing, and price changes
 */
async function getEstimateExplanation(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const {
    insuranceName,
    groupName,
    groupNumber,
    procedure,
  } = params;

  const searchClinicId = clinicId || params.clinicId;

  let directAnswer = `=== UNDERSTANDING DENTAL ESTIMATES ===\n\n`;

  // Try to get plan info if provided
  let plan: InsurancePlanRecord | null = null;
  if (insuranceName || groupName || groupNumber) {
    const insuranceResult = await lookupInsurancePlanBenefits(
      { insuranceName, groupName, groupNumber },
      searchClinicId
    );
    if (insuranceResult.statusCode === 200 && insuranceResult.body.data?.plans?.length) {
      plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;
      directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
      if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
      directAnswer += `\n`;
    }
  }

  // === ESTIMATE VS GUARANTEE ===
  directAnswer += `📋 IS THIS AN ESTIMATE OR GUARANTEED PRICE?\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `⚠️ IMPORTANT: Dental quotes are ESTIMATES, not guarantees.\n\n`;

  directAnswer += `WHY WE CAN'T GUARANTEE THE FINAL PRICE:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `1. Insurance must verify and process the claim\n`;
  directAnswer += `2. Unforeseen clinical findings during treatment\n`;
  directAnswer += `3. Benefit changes we're not yet aware of\n`;
  directAnswer += `4. Coordination with other insurance\n`;
  directAnswer += `5. Deductible status may differ from our records\n\n`;

  directAnswer += `WHAT THE ESTIMATE REPRESENTS:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `✓ Our best calculation based on:\n`;
  directAnswer += `  • Your plan's coverage percentages on file\n`;
  directAnswer += `  • Your deductible and remaining benefits\n`;
  directAnswer += `  • Our contracted/fee schedule rates\n`;
  directAnswer += `  • The procedure codes planned\n\n`;

  // === WHY PRICES CHANGE ===
  directAnswer += `💰 WHAT COULD MAKE MY PRICE CHANGE?\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `CLINICAL REASONS:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Additional decay found during treatment\n`;
  directAnswer += `  → Filling becomes crown, or needs larger restoration\n`;
  directAnswer += `• Tooth condition worse than x-rays showed\n`;
  directAnswer += `  → Simple extraction becomes surgical extraction\n`;
  directAnswer += `• Root canal complexity\n`;
  directAnswer += `  → Extra canals found = higher code\n`;
  directAnswer += `• Material changes\n`;
  directAnswer += `  → Patient requests different crown material\n`;
  directAnswer += `• Bone grafting needed for implant\n`;
  directAnswer += `  → Wasn't visible until surgery\n\n`;

  directAnswer += `INSURANCE REASONS:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Claim denied or reduced\n`;
  directAnswer += `  → Frequency limit exceeded, waiting period, etc.\n`;
  directAnswer += `• Different coverage % than expected\n`;
  directAnswer += `  → Plan classifies procedure differently\n`;
  directAnswer += `• Deductible not yet met\n`;
  directAnswer += `  → Applied to your claim first\n`;
  directAnswer += `• Annual maximum exhausted\n`;
  directAnswer += `  → Benefits used at another office\n`;
  directAnswer += `• Downgrades applied\n`;
  directAnswer += `  → Insurance pays for cheaper alternative\n`;

  if (plan?.downgrades) {
    directAnswer += `\n  YOUR PLAN'S DOWNGRADE POLICY:\n`;
    directAnswer += `  ${plan.downgrades}\n`;
  }

  directAnswer += `\n`;
  directAnswer += `• Coordination of benefits (COB)\n`;
  directAnswer += `  → Secondary insurance calculates differently\n`;
  directAnswer += `• Benefits changed since last verification\n`;
  directAnswer += `  → Employer changed plan mid-year\n\n`;

  // === BALANCE BILLING ===
  directAnswer += `📝 IF INSURANCE PAYS LESS, DO I OWE THE DIFFERENCE?\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `SHORT ANSWER: Usually yes, with some protections.\n\n`;

  directAnswer += `IN-NETWORK PROVIDER:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `✓ We accept the contracted rate\n`;
  directAnswer += `✓ You won't be "balance billed" above that rate\n`;
  directAnswer += `✓ BUT you still owe your coinsurance portion\n\n`;
  directAnswer += `Example:\n`;
  directAnswer += `  Crown fee: $1,200 (our charge)\n`;
  directAnswer += `  Contracted rate: $900 (PPO negotiated)\n`;
  directAnswer += `  Insurance pays: 50% = $450\n`;
  directAnswer += `  You owe: $450 (not $750)\n`;
  directAnswer += `  We write off: $300 (the discount)\n\n`;

  directAnswer += `OUT-OF-NETWORK PROVIDER:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `⚠️ No contracted rate protection\n`;
  directAnswer += `⚠️ You may owe the full difference\n\n`;
  directAnswer += `Example:\n`;
  directAnswer += `  Crown fee: $1,200 (our charge)\n`;
  directAnswer += `  Insurance pays: Based on UCR $800\n`;
  directAnswer += `  Insurance pays: 50% of $800 = $400\n`;
  directAnswer += `  You owe: $1,200 - $400 = $800\n\n`;

  directAnswer += `CLAIM DENIAL:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `If insurance denies the claim entirely:\n`;
  directAnswer += `• You are responsible for the full amount\n`;
  directAnswer += `• We can help appeal the denial\n`;
  directAnswer += `• Payment plans may be available\n\n`;

  // === MULTI-VISIT PROCEDURES ===
  directAnswer += `🔄 MULTIPLE VISITS / TREATMENT PHASES\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `HOW MULTI-VISIT PROCEDURES ARE BILLED:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• ROOT CANAL (multi-visit):\n`;
  directAnswer += `  Usually billed on completion date\n`;
  directAnswer += `  All visits = one procedure code & one fee\n\n`;
  directAnswer += `• CROWN (typically 2 visits):\n`;
  directAnswer += `  Visit 1: Prep & temporary (may bill D2799)\n`;
  directAnswer += `  Visit 2: Seat permanent crown (main code)\n`;
  directAnswer += `  Some offices bill all at seat date\n\n`;
  directAnswer += `• IMPLANT (multiple phases):\n`;
  directAnswer += `  1. Implant placement (D6010) - billed at surgery\n`;
  directAnswer += `  2. Healing period (3-6 months) - no charge\n`;
  directAnswer += `  3. Abutment (D6056/57) - billed when placed\n`;
  directAnswer += `  4. Crown (D6058-67) - billed when seated\n`;
  directAnswer += `  → Each phase may hit a new benefit year!\n\n`;
  directAnswer += `• ORTHODONTICS:\n`;
  directAnswer += `  Initial payment + monthly payments\n`;
  directAnswer += `  Insurance often pays in installments too\n\n`;

  // === SEDATION / ANESTHESIA ===
  directAnswer += `💉 SEDATION / ANESTHESIA COVERAGE\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `TYPES OF ANESTHESIA IN DENTISTRY:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Local anesthesia (numbing shot)\n`;
  directAnswer += `  → Usually INCLUDED in procedure fee\n`;
  directAnswer += `  → No separate charge\n\n`;
  directAnswer += `• Nitrous oxide (laughing gas) - D9230\n`;
  directAnswer += `  → Often NOT covered by dental insurance\n`;
  directAnswer += `  → Typical fee: $50-$150 per visit\n`;
  directAnswer += `  → Billed separately, usually patient pay\n\n`;
  directAnswer += `• Oral sedation (pill/liquid)\n`;
  directAnswer += `  → Usually NOT covered\n`;
  directAnswer += `  → Typical fee: $150-$500\n\n`;
  directAnswer += `• IV sedation / General anesthesia - D9222-D9243\n`;
  directAnswer += `  → Sometimes covered for:\n`;
  directAnswer += `    - Young children (under 5-7)\n`;
  directAnswer += `    - Special needs patients\n`;
  directAnswer += `    - Complex oral surgery\n`;
  directAnswer += `  → May be covered by MEDICAL insurance\n`;
  directAnswer += `  → Typical fee: $300-$1,500+\n\n`;

  // Check if plan excludes anesthesia
  const excludesAnesthesia = plan?.exclusions?.toLowerCase().includes('anesthesia') ||
    plan?.exclusions?.toLowerCase().includes('sedation');

  if (excludesAnesthesia) {
    directAnswer += `⚠️ YOUR PLAN MAY EXCLUDE ANESTHESIA/SEDATION\n`;
    directAnswer += `   Check with office for out-of-pocket cost\n\n`;
  }

  directAnswer += `TIP: If you need sedation, ask if it can be billed\n`;
  directAnswer += `     to your medical insurance instead.\n`;
  directAnswer += `\n`;

  directAnswer += `═══════════════════════════════════════\n`;
  directAnswer += `📞 BOTTOM LINE:\n`;
  directAnswer += `─────────────────────────────────────────\n`;
  directAnswer += `• Estimates are our best prediction, not a guarantee\n`;
  directAnswer += `• Ask for a pre-authorization if you need certainty\n`;
  directAnswer += `• Final cost depends on insurance processing\n`;
  directAnswer += `• Payment plans available if cost exceeds estimate\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Estimate explanation retrieved',
      directAnswer,
      data: {
        plan: plan ? {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
          downgrades: plan.downgrades,
        } : null,
        keyPoints: {
          isEstimateGuaranteed: false,
          reasonsForChange: [
            'Additional clinical findings',
            'Different procedure codes',
            'Insurance denial or reduction',
            'Downgrades applied',
            'Deductible/maximum changes',
          ],
          balanceBilling: 'In-network: protected by contracted rate. Out-of-network: may owe full difference.',
          sedationCoverage: 'Usually patient responsibility unless special circumstances',
        },
      },
    },
  };
}

/**
 * Get copay and frequency limit information
 * Answers questions about copays vs coinsurance, frequency limits for cleanings/x-rays/etc.
 */
async function getCopayAndFrequencyInfo(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const {
    insuranceName,
    groupName,
    groupNumber,
  } = params;

  const searchClinicId = clinicId || params.clinicId;

  // Look up insurance plan
  if (!insuranceName && !groupName && !groupNumber) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please provide insurance information (insurance name, group name, or group number)',
      },
    };
  }

  const insuranceResult = await lookupInsurancePlanBenefits(
    { insuranceName, groupName, groupNumber },
    searchClinicId
  );

  if (insuranceResult.statusCode !== 200 || !insuranceResult.body.data?.plans?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: `Insurance plan not found for "${insuranceName || groupName || groupNumber}"`,
      },
    };
  }

  const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

  let directAnswer = `=== COPAY & FREQUENCY LIMITS ===\n\n`;
  directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
  if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
  directAnswer += `\n`;

  // === COPAY VS COINSURANCE ===
  directAnswer += `💰 COPAY VS COINSURANCE\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  directAnswer += `UNDERSTANDING THE DIFFERENCE:\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `• COPAY: Fixed dollar amount (e.g., $25 per visit)\n`;
  directAnswer += `  - You pay the same regardless of service cost\n`;
  directAnswer += `  - Common in HMO/DHMO dental plans\n`;
  directAnswer += `  - Usually due at check-in\n\n`;
  directAnswer += `• COINSURANCE: Percentage you pay (e.g., 20%)\n`;
  directAnswer += `  - You pay a % after deductible (if applicable)\n`;
  directAnswer += `  - Common in PPO dental plans\n`;
  directAnswer += `  - Example: 80/20 means insurance pays 80%, you pay 20%\n\n`;

  // Check if plan has copayments
  if (plan.copayments) {
    directAnswer += `YOUR PLAN'S COPAYMENTS:\n`;
    directAnswer += `─────────────────────────────\n`;
    // Parse and format copayments
    const copays = plan.copayments.split('|').map(s => s.trim()).filter(Boolean);
    copays.forEach(copay => {
      directAnswer += `  • ${copay}\n`;
    });
    directAnswer += `\n`;
  } else {
    directAnswer += `YOUR PLAN:\n`;
    directAnswer += `─────────────────────────────\n`;
    directAnswer += `This appears to be a COINSURANCE-based plan:\n`;
    if (plan.preventiveRoutinePreventivePct !== null) {
      const prevPct = plan.preventiveRoutinePreventivePct > 1
        ? plan.preventiveRoutinePreventivePct
        : plan.preventiveRoutinePreventivePct * 100;
      directAnswer += `  • Preventive: Insurance pays ${prevPct}%, you pay ${100 - prevPct}%\n`;
    }
    if (plan.basicRestorativePct !== null) {
      const basicPct = plan.basicRestorativePct > 1
        ? plan.basicRestorativePct
        : plan.basicRestorativePct * 100;
      directAnswer += `  • Basic: Insurance pays ${basicPct}%, you pay ${100 - basicPct}%\n`;
    }
    if (plan.majorCrownsPct !== null) {
      const majorPct = plan.majorCrownsPct > 1
        ? plan.majorCrownsPct
        : plan.majorCrownsPct * 100;
      directAnswer += `  • Major: Insurance pays ${majorPct}%, you pay ${100 - majorPct}%\n`;
    }
    directAnswer += `\n`;
  }

  directAnswer += `WHEN IS PAYMENT DUE?\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `• Copay (if applicable): Usually collected at check-in\n`;
  directAnswer += `• Coinsurance portion: After insurance processes claim\n`;
  directAnswer += `• Estimated portion: Office may collect at time of service\n`;
  directAnswer += `• Deductible: Applied to first services of the year\n\n`;

  directAnswer += `DOES COPAY CHANGE BY PROVIDER?\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `• In-network: Standard copay/coinsurance rates apply\n`;
  directAnswer += `• Out-of-network: May have higher copay or lower coverage %\n`;
  directAnswer += `• Specialist vs GP: Some plans charge more for specialists\n`;
  directAnswer += `\n`;

  // === FREQUENCY LIMITS ===
  directAnswer += `📅 FREQUENCY LIMITS\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  if (plan.frequencyLimits) {
    directAnswer += `YOUR PLAN'S FREQUENCY LIMITS:\n`;
    directAnswer += `─────────────────────────────\n`;
    // Parse and format frequency limits
    const limits = plan.frequencyLimits.split('|').map(s => s.trim()).filter(Boolean);
    limits.forEach(limit => {
      directAnswer += `  • ${limit}\n`;
    });
    directAnswer += `\n`;
  } else {
    directAnswer += `TYPICAL FREQUENCY LIMITS (verify with your plan):\n`;
    directAnswer += `─────────────────────────────\n`;
  }

  // Provide common frequency info
  directAnswer += `CLEANINGS (Prophylaxis D1110/D1120):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  • Most plans: 2 per calendar year (every 6 months)\n`;
  directAnswer += `  • Some enhanced plans: 3-4 per year\n`;
  directAnswer += `  • Timing rule: Usually 6 months between cleanings\n`;
  directAnswer += `  ⚠️ Getting cleaned too early = denied claim!\n\n`;

  directAnswer += `BITEWING X-RAYS (D0272/D0274):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  • Most plans: 1 set per 12 months\n`;
  directAnswer += `  • Some plans: 1 set per 6 months\n`;
  directAnswer += `  • High-risk patients may get exception\n\n`;

  directAnswer += `PANORAMIC X-RAY (D0330) / FMX (D0210):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  • Most plans: 1 every 3-5 years\n`;
  directAnswer += `  • Pano OR FMX, not both (they're alternatives)\n`;
  directAnswer += `  • Some plans: 1 every 3 years\n\n`;

  directAnswer += `EXAMS (D0120/D0150):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  • Periodic exam (D0120): 2 per year\n`;
  directAnswer += `  • Comprehensive exam (D0150): 1 every 3-5 years\n`;
  directAnswer += `  • Limited/emergency exam (D0140): As needed\n\n`;

  // PERIO MAINTENANCE / SECOND CLEANING
  directAnswer += `PERIODONTAL MAINTENANCE (D4910):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  Q: "Does insurance cover a second cleaning if I have gum disease?"\n\n`;
  directAnswer += `  After scaling/root planing (deep cleaning), you transition from:\n`;
  directAnswer += `  • Prophylaxis (D1110) → Periodontal Maintenance (D4910)\n\n`;
  directAnswer += `  • Most plans: 2-4 perio maintenance visits per year\n`;
  directAnswer += `  • Often replaces regular cleanings (not in addition to)\n`;
  directAnswer += `  • Coded as Basic or Preventive (varies by plan)\n`;
  directAnswer += `  • May count against cleaning frequency\n\n`;

  directAnswer += `FLUORIDE (D1206/D1208):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  • Most plans: 2 per year (with cleanings)\n`;
  directAnswer += `  • Age limits often apply (typically under 14-19)\n`;
  if (plan.ageLimits) {
    directAnswer += `  • YOUR PLAN: ${plan.ageLimits}\n`;
  }
  directAnswer += `\n`;

  directAnswer += `SEALANTS (D1351):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  • Most plans: Once per tooth, permanent molars only\n`;
  directAnswer += `  • Age limits often apply (typically 6-14 years)\n`;
  directAnswer += `  • Usually only first and second molars\n`;
  directAnswer += `  • Replacement may not be covered\n\n`;

  directAnswer += `NIGHT GUARDS / OCCLUSAL GUARDS (D9944/D9945):\n`;
  directAnswer += `─────────────────────────────\n`;
  directAnswer += `  • Many plans: NOT covered (cosmetic/elective)\n`;
  directAnswer += `  • Some plans: 1 every 3-5 years\n`;
  directAnswer += `  • Often have lifetime limit or dollar cap\n`;
  directAnswer += `  • May require diagnosis of bruxism\n`;

  // Check if there are other limitations
  if (plan.otherLimitations) {
    directAnswer += `\n`;
    directAnswer += `OTHER LIMITATIONS:\n`;
    directAnswer += `─────────────────────────────\n`;
    const limitations = plan.otherLimitations.split('|').map(s => s.trim()).filter(Boolean);
    limitations.forEach(limit => {
      directAnswer += `  • ${limit}\n`;
    });
  }

  directAnswer += `\n`;
  directAnswer += `═══════════════════════════════════════\n`;
  directAnswer += `💡 PRO TIP: Ask our office to verify your exact frequency\n`;
  directAnswer += `   limits before scheduling. We can check your last claim\n`;
  directAnswer += `   dates to ensure you're eligible for coverage.\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Copay and frequency information retrieved',
      directAnswer,
      data: {
        plan: {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
        },
        hasCopays: !!plan.copayments,
        copayments: plan.copayments,
        frequencyLimits: plan.frequencyLimits,
        ageLimits: plan.ageLimits,
        otherLimitations: plan.otherLimitations,
        coveragePercentages: {
          preventive: plan.preventiveRoutinePreventivePct,
          basic: plan.basicRestorativePct,
          major: plan.majorCrownsPct,
        },
      },
    },
  };
}

/**
 * Get detailed coverage breakdown by category
 * Answers questions about percentages, downgrades, implants, perio vs cleaning, in/out of network
 */
async function getCoverageBreakdown(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const {
    insuranceName,
    groupName,
    groupNumber,
  } = params;

  const searchClinicId = clinicId || params.clinicId;

  // Look up insurance plan
  if (!insuranceName && !groupName && !groupNumber) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please provide insurance information (insurance name, group name, or group number)',
      },
    };
  }

  const insuranceResult = await lookupInsurancePlanBenefits(
    { insuranceName, groupName, groupNumber },
    searchClinicId
  );

  if (insuranceResult.statusCode !== 200 || !insuranceResult.body.data?.plans?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: `Insurance plan not found for "${insuranceName || groupName || groupNumber}"`,
      },
    };
  }

  const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

  // Helper to format percentage
  const formatPct = (pct: number | null): string => {
    if (pct === null || pct === undefined) return 'Not specified';
    const val = pct > 1 ? pct : pct * 100;
    return `${Math.round(val)}%`;
  };

  const getPctValue = (pct: number | null): number | null => {
    if (pct === null || pct === undefined) return null;
    return pct > 1 ? pct : pct * 100;
  };

  let directAnswer = `=== COVERAGE BREAKDOWN ===\n\n`;
  directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
  if (plan.groupNumber) directAnswer += `Group #: ${plan.groupNumber}\n`;
  directAnswer += `\n`;

  // === COVERAGE BY CATEGORY ===
  directAnswer += `📊 COVERAGE PERCENTAGES BY CATEGORY\n`;
  directAnswer += `═══════════════════════════════════════\n\n`;

  // PREVENTIVE
  const prevExam = getPctValue(plan.preventiveDiagnosticsPct);
  const prevXray = getPctValue(plan.preventiveXRaysPct);
  const prevClean = getPctValue(plan.preventiveRoutinePreventivePct);
  const prevAvg = [prevExam, prevXray, prevClean].filter(p => p !== null);

  directAnswer += `🦷 PREVENTIVE SERVICES\n`;
  directAnswer += `───────────────────────────\n`;
  directAnswer += `  Exams/Evaluations:    ${formatPct(plan.preventiveDiagnosticsPct)}\n`;
  directAnswer += `  X-Rays (diagnostic):  ${formatPct(plan.preventiveXRaysPct)}\n`;
  directAnswer += `  Cleanings (prophy):   ${formatPct(plan.preventiveRoutinePreventivePct)}\n`;
  directAnswer += `  Fluoride:             ${formatPct(plan.preventiveRoutinePreventivePct)} (typically same as preventive)\n`;
  directAnswer += `  Sealants:             ${formatPct(plan.preventiveRoutinePreventivePct)} (typically same as preventive)\n`;
  if (prevAvg.length > 0) {
    const avg = prevAvg.reduce((a, b) => a + b, 0) / prevAvg.length;
    if (avg >= 100) {
      directAnswer += `  ✅ Typical "100%" preventive plan\n`;
    }
  }
  directAnswer += `\n`;

  // BASIC
  const basicFilling = getPctValue(plan.basicRestorativePct);
  const basicEndo = getPctValue(plan.basicEndoPct);
  const basicPerio = getPctValue(plan.basicPerioPct);
  const basicSurgery = getPctValue(plan.basicOralSurgeryPct);

  directAnswer += `🔧 BASIC SERVICES\n`;
  directAnswer += `───────────────────────────\n`;
  directAnswer += `  Fillings:             ${formatPct(plan.basicRestorativePct)}\n`;
  directAnswer += `  Root Canals:          ${formatPct(plan.basicEndoPct)}\n`;
  directAnswer += `  Periodontal (SRP):    ${formatPct(plan.basicPerioPct)}\n`;
  directAnswer += `  Extractions:          ${formatPct(plan.basicOralSurgeryPct)}\n`;

  // Highlight if basic coverage varies
  const basicValues = [basicFilling, basicEndo, basicPerio, basicSurgery].filter(p => p !== null);
  const basicMin = basicValues.length > 0 ? Math.min(...basicValues as number[]) : null;
  const basicMax = basicValues.length > 0 ? Math.max(...basicValues as number[]) : null;
  if (basicMin !== basicMax && basicMin !== null && basicMax !== null) {
    directAnswer += `  ⚠️ Note: Basic coverage varies (${basicMin}% - ${basicMax}%)\n`;
  }
  directAnswer += `\n`;

  // MAJOR
  const majorCrowns = getPctValue(plan.majorCrownsPct);
  const majorProsth = getPctValue(plan.majorProsthodonticsPct);

  directAnswer += `👑 MAJOR SERVICES\n`;
  directAnswer += `───────────────────────────\n`;
  directAnswer += `  Crowns:               ${formatPct(plan.majorCrownsPct)}\n`;
  directAnswer += `  Bridges:              ${formatPct(plan.majorProsthodonticsPct)}\n`;
  directAnswer += `  Dentures:             ${formatPct(plan.majorProsthodonticsPct)}\n`;
  directAnswer += `  Inlays/Onlays:        ${formatPct(plan.majorCrownsPct)} (typically same as crowns)\n`;
  directAnswer += `\n`;

  // ORTHODONTICS
  if (plan.orthoPct !== null || plan.orthoLifetimeMax !== null) {
    directAnswer += `🦷 ORTHODONTICS\n`;
    directAnswer += `───────────────────────────\n`;
    directAnswer += `  Coverage:             ${formatPct(plan.orthoPct)}\n`;
    if (plan.orthoLifetimeMax) {
      directAnswer += `  Lifetime Maximum:     $${plan.orthoLifetimeMax.toLocaleString()}\n`;
    }
    directAnswer += `\n`;
  }

  // === DOWNGRADES ===
  directAnswer += `📉 DOWNGRADE POLICY (Important for Crowns!)\n`;
  directAnswer += `═══════════════════════════════════════\n`;

  if (plan.downgrades) {
    directAnswer += `${plan.downgrades}\n\n`;

    if (plan.downgrades.toLowerCase().includes('yes') || plan.downgrades.toLowerCase().includes('allowed')) {
      directAnswer += `What this means:\n`;
      directAnswer += `• Insurance may pay for less expensive alternative\n`;
      directAnswer += `• Example: You get a tooth-colored filling, but insurance\n`;
      directAnswer += `  pays based on the cheaper silver (amalgam) filling rate\n`;
      directAnswer += `• Example: You get a porcelain crown, but insurance pays\n`;
      directAnswer += `  based on a metal crown rate\n`;
      directAnswer += `• YOU pay the difference between what insurance covers\n`;
      directAnswer += `  and the actual cost of the procedure you chose\n`;
    } else if (plan.downgrades.toLowerCase().includes('no')) {
      directAnswer += `✅ Good news! No downgrades means insurance pays based on\n`;
      directAnswer += `   the actual procedure you receive, not a cheaper alternative.\n`;
    }
  } else {
    directAnswer += `Downgrade policy not specified in plan data.\n`;
    directAnswer += `Ask the office to verify with insurance.\n`;
  }
  directAnswer += `\n`;

  // === IMPLANTS ===
  directAnswer += `🔩 IMPLANT COVERAGE\n`;
  directAnswer += `═══════════════════════════════════════\n`;

  // Check if implants are in exclusions
  const implantsExcluded = plan.exclusions?.toLowerCase().includes('implant');

  if (implantsExcluded) {
    directAnswer += `❌ IMPLANTS EXCLUDED from this plan\n\n`;
    directAnswer += `However, related services MAY be covered:\n`;
    directAnswer += `• Crown on implant (D6058-D6067): Possibly covered as Major\n`;
    directAnswer += `• Abutment (D6056-D6057): Possibly covered as Major\n`;
    directAnswer += `• The implant fixture itself (D6010): NOT covered\n`;
  } else {
    directAnswer += `Implant coverage not explicitly excluded.\n\n`;
    directAnswer += `Typical implant coverage breakdown:\n`;
    directAnswer += `• Implant fixture (D6010): ${formatPct(plan.majorProsthodonticsPct)} (if covered)\n`;
    directAnswer += `• Implant abutment (D6056-D6057): ${formatPct(plan.majorProsthodonticsPct)}\n`;
    directAnswer += `• Crown on implant (D6058-D6067): ${formatPct(plan.majorCrownsPct)}\n`;
    directAnswer += `\n`;
    directAnswer += `⚠️ IMPORTANT: Many plans cover the crown on top of an implant\n`;
    directAnswer += `   but NOT the implant fixture itself. Verify with office.\n`;
  }

  // Check for implant-specific limitations
  if (plan.otherLimitations?.toLowerCase().includes('implant')) {
    directAnswer += `\nImplant limitations: ${plan.otherLimitations}\n`;
  }
  directAnswer += `\n`;

  // === PERIODONTAL VS CLEANING ===
  directAnswer += `🦠 PERIODONTAL vs ROUTINE CLEANING\n`;
  directAnswer += `═══════════════════════════════════════\n`;

  const prophyCoverage = getPctValue(plan.preventiveRoutinePreventivePct);
  const perioCoverage = getPctValue(plan.basicPerioPct);

  directAnswer += `ROUTINE CLEANING (Prophylaxis D1110/D1120):\n`;
  directAnswer += `  Coverage: ${formatPct(plan.preventiveRoutinePreventivePct)}\n`;
  directAnswer += `  Category: PREVENTIVE\n`;
  directAnswer += `  Deductible: Usually waived\n`;
  directAnswer += `  For: Patients with healthy gums\n\n`;

  directAnswer += `PERIODONTAL SERVICES:\n`;
  directAnswer += `  Scaling & Root Planing (D4341/D4342):\n`;
  directAnswer += `    Coverage: ${formatPct(plan.basicPerioPct)}\n`;
  directAnswer += `    Category: BASIC (sometimes Major)\n`;
  directAnswer += `    Deductible: Usually applies\n`;
  directAnswer += `    For: Patients with gum disease\n\n`;

  directAnswer += `  Periodontal Maintenance (D4910):\n`;
  directAnswer += `    Coverage: ${formatPct(plan.basicPerioPct)}\n`;
  directAnswer += `    Category: BASIC or PREVENTIVE (varies)\n`;
  directAnswer += `    For: After gum disease treatment\n\n`;

  if (prophyCoverage !== null && perioCoverage !== null && prophyCoverage !== perioCoverage) {
    directAnswer += `⚠️ YES - Your plan covers perio differently!\n`;
    directAnswer += `   Routine cleaning: ${prophyCoverage}%\n`;
    directAnswer += `   Periodontal: ${perioCoverage}%\n`;
  } else if (prophyCoverage !== null && perioCoverage !== null) {
    directAnswer += `ℹ️ Cleaning and perio have similar coverage percentages,\n`;
    directAnswer += `   but perio is categorized as Basic (deductible applies).\n`;
  }
  directAnswer += `\n`;

  // === IN-NETWORK VS OUT-OF-NETWORK ===
  directAnswer += `🏥 IN-NETWORK vs OUT-OF-NETWORK\n`;
  directAnswer += `═══════════════════════════════════════\n`;

  // Check plan type based on name
  const planNameLower = (plan.insuranceName || '').toLowerCase();
  const isPPO = planNameLower.includes('ppo') || planNameLower.includes('preferred');
  const isHMO = planNameLower.includes('hmo') || planNameLower.includes('dhmo');
  const isIndemnity = planNameLower.includes('indemnity') || planNameLower.includes('traditional');

  if (isHMO) {
    directAnswer += `Plan Type: HMO/DHMO\n\n`;
    directAnswer += `❌ OUT-OF-NETWORK: Generally NOT covered\n`;
    directAnswer += `   HMO plans require you to use assigned providers.\n`;
    directAnswer += `   Services outside the network are usually not covered\n`;
    directAnswer += `   except in emergencies.\n`;
  } else if (isPPO) {
    directAnswer += `Plan Type: PPO (Preferred Provider Organization)\n\n`;
    directAnswer += `IN-NETWORK PROVIDERS:\n`;
    directAnswer += `  • Higher coverage percentages\n`;
    directAnswer += `  • Negotiated/lower fees\n`;
    directAnswer += `  • You pay less overall\n\n`;
    directAnswer += `OUT-OF-NETWORK PROVIDERS:\n`;
    directAnswer += `  • Usually 10-20% lower coverage\n`;
    directAnswer += `  • No negotiated fees (higher costs)\n`;
    directAnswer += `  • May pay based on "usual and customary" rates\n`;
    directAnswer += `  • Balance billing may apply\n\n`;
    directAnswer += `Example:\n`;
    directAnswer += `  Crown (in-network): 50% of $1,000 = You pay $500\n`;
    directAnswer += `  Crown (out-of-network): 40% of $1,200 = You pay $720\n`;
  } else if (isIndemnity) {
    directAnswer += `Plan Type: Indemnity/Traditional\n\n`;
    directAnswer += `✅ Same coverage in or out of network!\n`;
    directAnswer += `   Indemnity plans typically pay the same percentage\n`;
    directAnswer += `   regardless of which dentist you see.\n`;
  } else {
    directAnswer += `General Network Information:\n\n`;
    directAnswer += `IN-NETWORK BENEFITS:\n`;
    directAnswer += `  • Contracted rates = lower fees\n`;
    directAnswer += `  • Full coverage percentages apply\n`;
    directAnswer += `  • No balance billing\n\n`;
    directAnswer += `OUT-OF-NETWORK:\n`;
    directAnswer += `  • Coverage may be reduced 10-20%\n`;
    directAnswer += `  • Higher fees possible\n`;
    directAnswer += `  • Balance billing may apply\n\n`;
    directAnswer += `💡 Verify your plan type with your insurance card or HR.\n`;
  }

  // Check if this office is in-network
  if (plan.feeSchedule) {
    directAnswer += `\nFee Schedule: ${plan.feeSchedule}\n`;
    directAnswer += `(This indicates negotiated/contracted rates are on file)\n`;
  }
  directAnswer += `\n`;

  // === COINSURANCE OVERRIDES ===
  if (plan.coinsuranceOverridesByCodeOrGroup) {
    directAnswer += `📝 PROCEDURE-SPECIFIC COVERAGE OVERRIDES\n`;
    directAnswer += `═══════════════════════════════════════\n`;
    directAnswer += `Some procedures have different coverage than their category:\n`;
    plan.coinsuranceOverridesByCodeOrGroup.split('|').map(s => s.trim()).filter(Boolean).forEach(item => {
      directAnswer += `  • ${item}\n`;
    });
    directAnswer += `\n`;
  }

  // Summary
  directAnswer += `───────────────────────────\n`;
  directAnswer += `QUICK REFERENCE:\n`;
  directAnswer += `  Preventive: ${formatPct(plan.preventiveRoutinePreventivePct)}\n`;
  directAnswer += `  Basic:      ${formatPct(plan.basicRestorativePct)}\n`;
  directAnswer += `  Major:      ${formatPct(plan.majorCrownsPct)}\n`;
  if (plan.orthoPct !== null) {
    directAnswer += `  Ortho:      ${formatPct(plan.orthoPct)}\n`;
  }
  if (plan.downgrades) {
    directAnswer += `  Downgrades: ${plan.downgrades.includes('Yes') || plan.downgrades.includes('Allowed') ? 'Yes' : 'No'}\n`;
  }

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: 'Coverage breakdown retrieved',
      directAnswer,
      data: {
        plan: {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
        },
        coverage: {
          preventive: {
            exams: getPctValue(plan.preventiveDiagnosticsPct),
            xrays: getPctValue(plan.preventiveXRaysPct),
            cleanings: getPctValue(plan.preventiveRoutinePreventivePct),
          },
          basic: {
            fillings: getPctValue(plan.basicRestorativePct),
            rootCanals: getPctValue(plan.basicEndoPct),
            periodontal: getPctValue(plan.basicPerioPct),
            extractions: getPctValue(plan.basicOralSurgeryPct),
          },
          major: {
            crowns: getPctValue(plan.majorCrownsPct),
            prosthodontics: getPctValue(plan.majorProsthodonticsPct),
          },
          ortho: getPctValue(plan.orthoPct),
        },
        downgrades: plan.downgrades,
        implantsExcluded: implantsExcluded,
        perioVsCleaning: {
          cleaning: getPctValue(plan.preventiveRoutinePreventivePct),
          periodontal: getPctValue(plan.basicPerioPct),
          different: prophyCoverage !== perioCoverage,
        },
        planType: isPPO ? 'PPO' : isHMO ? 'HMO' : isIndemnity ? 'Indemnity' : 'Unknown',
      },
    },
  };
}

/**
 * Check if a specific procedure is covered by insurance
 * Directly answers "Is X covered?" questions
 */
async function checkProcedureCoverage(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const {
    procedure,
    procedureName,
    procCode,
    insuranceName,
    groupName,
    groupNumber,
  } = params;

  const searchClinicId = clinicId || params.clinicId;
  const treatmentName = procedure || procedureName || procCode;

  if (!treatmentName) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please specify the procedure you want to check (e.g., "cleaning", "crown", "root canal")',
      },
    };
  }

  // Map procedure name to codes and category
  const procedureMapping = mapProcedureToCode(treatmentName);
  if (!procedureMapping) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: `Could not identify procedure "${treatmentName}"`,
        examples: ['exam', 'cleaning', 'x-ray', 'filling', 'crown', 'root canal', 'extraction', 'implant', 'braces'],
      },
    };
  }

  // Look up insurance plan
  if (!insuranceName && !groupName && !groupNumber) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please provide insurance information (insurance name, group name, or group number)',
      },
    };
  }

  const insuranceResult = await lookupInsurancePlanBenefits(
    { insuranceName, groupName, groupNumber },
    searchClinicId
  );

  if (insuranceResult.statusCode !== 200 || !insuranceResult.body.data?.plans?.length) {
    return {
      statusCode: 404,
      body: {
        status: 'FAILURE',
        message: `Insurance plan not found for "${insuranceName || groupName || groupNumber}"`,
      },
    };
  }

  const plan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

  // Get coverage based on category
  let coveragePercent: number | null = null;
  let categoryName = '';
  let additionalInfo: string[] = [];

  switch (procedureMapping.category) {
    case 'preventive':
      coveragePercent = plan.preventiveRoutinePreventivePct;
      categoryName = 'Preventive';
      if (plan.deductibleOnPreventiveOverride === 0) {
        additionalInfo.push('✓ No deductible for preventive services');
      }
      break;

    case 'diagnostic':
      coveragePercent = plan.preventiveDiagnosticsPct ?? plan.preventiveXRaysPct;
      categoryName = 'Diagnostic/X-Rays';
      break;

    case 'basic':
      coveragePercent = plan.basicRestorativePct;
      categoryName = 'Basic';
      break;

    case 'endo':
      coveragePercent = plan.basicEndoPct ?? plan.basicRestorativePct;
      categoryName = 'Endodontics (Root Canals)';
      break;

    case 'perio':
      coveragePercent = plan.basicPerioPct ?? plan.basicRestorativePct;
      categoryName = 'Periodontics';
      break;

    case 'surgery':
      coveragePercent = plan.basicOralSurgeryPct ?? plan.basicRestorativePct;
      categoryName = 'Oral Surgery';
      break;

    case 'major':
      coveragePercent = plan.majorCrownsPct ?? plan.majorProsthodonticsPct;
      categoryName = 'Major';
      // Check for waiting periods
      if (plan.waitingPeriods?.toLowerCase().includes('major')) {
        additionalInfo.push(`⚠️ Waiting period may apply: ${plan.waitingPeriods}`);
      }
      break;

    case 'ortho':
      coveragePercent = plan.orthoPct;
      categoryName = 'Orthodontics';
      if (plan.orthoLifetimeMax) {
        additionalInfo.push(`Lifetime maximum: $${plan.orthoLifetimeMax.toLocaleString()}`);
      }
      if (plan.ageLimits?.toLowerCase().includes('ortho')) {
        additionalInfo.push(`Age limit: ${plan.ageLimits}`);
      }
      if (plan.waitingPeriods?.toLowerCase().includes('ortho')) {
        additionalInfo.push(`⚠️ Waiting period: ${plan.waitingPeriods}`);
      }
      break;

    case 'anesthesia':
      // Anesthesia coverage varies - check if it's in exclusions or limitations
      categoryName = 'Anesthesia/Sedation';
      if (plan.exclusions?.toLowerCase().includes('anesthesia') ||
        plan.exclusions?.toLowerCase().includes('sedation')) {
        additionalInfo.push('❌ May be excluded - check with office');
      } else {
        additionalInfo.push('Coverage varies - often covered when medically necessary');
      }
      break;

    case 'cosmetic':
      // Cosmetic is usually excluded
      categoryName = 'Cosmetic';
      if (plan.exclusions?.toLowerCase().includes('cosmetic') ||
        plan.exclusions?.toLowerCase().includes('whitening')) {
        additionalInfo.push('❌ Typically NOT covered (cosmetic)');
        coveragePercent = 0;
      } else {
        additionalInfo.push('⚠️ Cosmetic services are often excluded - verify with office');
      }
      break;

    case 'adjunctive':
      categoryName = 'Adjunctive Services';
      additionalInfo.push('Coverage varies by plan - verify with office');
      break;

    default:
      categoryName = procedureMapping.category || 'Unknown';
  }

  // Normalize coverage percent
  if (coveragePercent !== null && coveragePercent !== undefined) {
    coveragePercent = coveragePercent > 1 ? coveragePercent : coveragePercent * 100;
  }

  // Check for exclusions specific to this procedure
  const procedureExcluded = plan.exclusions?.toLowerCase().includes(treatmentName.toLowerCase()) ||
    plan.exclusions?.toLowerCase().includes(procedureMapping.description.toLowerCase());

  // Check frequency limits
  const frequencyMatch = plan.frequencyLimits?.split('|')
    .map(s => s.trim())
    .find(s =>
      s.toLowerCase().includes(treatmentName.toLowerCase()) ||
      procedureMapping.codes.some(code => s.toUpperCase().includes(code))
    );

  if (frequencyMatch) {
    additionalInfo.push(`📋 Frequency limit: ${frequencyMatch}`);
  }

  // Check age limits
  const ageMatch = plan.ageLimits?.split('|')
    .map(s => s.trim())
    .find(s =>
      s.toLowerCase().includes(treatmentName.toLowerCase()) ||
      procedureMapping.codes.some(code => s.toUpperCase().includes(code))
    );

  if (ageMatch) {
    additionalInfo.push(`👤 Age limit: ${ageMatch}`);
  }

  // Build response
  let directAnswer = `=== IS ${procedureMapping.description.toUpperCase()} COVERED? ===\n\n`;
  directAnswer += `Plan: ${plan.insuranceName} - ${plan.groupName || ''}\n`;
  directAnswer += `Category: ${categoryName}\n\n`;

  if (procedureExcluded) {
    directAnswer += `❌ NO - This procedure appears to be EXCLUDED from your plan.\n`;
  } else if (coveragePercent === 0) {
    directAnswer += `❌ NO - This procedure is NOT covered (0% coverage).\n`;
  } else if (coveragePercent === null || coveragePercent === undefined) {
    directAnswer += `⚠️ COVERAGE NOT SPECIFIED - Please verify with the dental office.\n`;
    directAnswer += `The plan does not have specific coverage listed for ${categoryName} services.\n`;
  } else {
    directAnswer += `✅ YES - ${procedureMapping.description} is COVERED!\n\n`;
    directAnswer += `Coverage: ${Math.round(coveragePercent)}%\n`;
    directAnswer += `You pay: ${Math.round(100 - coveragePercent)}%\n`;

    if (plan.deductibleIndividual && plan.deductibleIndividual > 0) {
      if (categoryName === 'Preventive' && plan.deductibleOnPreventiveOverride === 0) {
        directAnswer += `Deductible: Waived for preventive\n`;
      } else {
        directAnswer += `Deductible: $${plan.deductibleIndividual} may apply\n`;
      }
    }
  }

  if (additionalInfo.length > 0) {
    directAnswer += `\n`;
    for (const info of additionalInfo) {
      directAnswer += `${info}\n`;
    }
  }

  // OPTIMIZATION: Look up office fee for this procedure to provide cost estimate
  let officeFee: number | null = null;
  let estimatedInsurancePays: number | null = null;
  let estimatedPatientCost: number | null = null;

  try {
    // Get fee for the first procedure code
    const primaryCode = procedureMapping.codes[0];
    const feeResult = await lookupFeeSchedules(
      { procCode: primaryCode, clinicId: searchClinicId },
      searchClinicId
    );

    if (feeResult.statusCode === 200 && feeResult.body.data?.fees?.length > 0) {
      const fees = feeResult.body.data.fees;
      // Get the fee (prefer UCR or first available)
      const feeRecord = fees.find((f: any) => f.feeSchedule?.toLowerCase().includes('ucr')) || fees[0];
      officeFee = feeRecord.amount;

      if (officeFee && coveragePercent !== null && coveragePercent > 0 && !procedureExcluded) {
        estimatedInsurancePays = Math.round(officeFee * (coveragePercent / 100));
        estimatedPatientCost = Math.round(officeFee - estimatedInsurancePays);

        // Account for deductible if applicable
        if (plan.deductibleIndividual && plan.deductibleIndividual > 0 &&
          !(categoryName === 'Preventive' && plan.deductibleOnPreventiveOverride === 0)) {
          directAnswer += `\n=== COST ESTIMATE ===\n`;
          directAnswer += `Office Fee: $${officeFee.toLocaleString()}\n`;
          directAnswer += `Your Coverage: ${Math.round(coveragePercent)}%\n`;
          directAnswer += `Estimated Insurance Pays: $${estimatedInsurancePays.toLocaleString()}\n`;
          directAnswer += `Estimated Your Cost: $${estimatedPatientCost.toLocaleString()}\n`;
          directAnswer += `Note: Deductible of $${plan.deductibleIndividual} may apply if not yet met.\n`;
        } else {
          directAnswer += `\n=== COST ESTIMATE ===\n`;
          directAnswer += `Office Fee: $${officeFee.toLocaleString()}\n`;
          directAnswer += `Your Coverage: ${Math.round(coveragePercent)}%\n`;
          directAnswer += `Estimated Insurance Pays: $${estimatedInsurancePays.toLocaleString()}\n`;
          directAnswer += `Estimated Your Cost: $${estimatedPatientCost.toLocaleString()}\n`;
        }
      } else if (officeFee && (procedureExcluded || coveragePercent === 0 || coveragePercent === null)) {
        directAnswer += `\n=== COST ESTIMATE ===\n`;
        directAnswer += `Office Fee: $${officeFee.toLocaleString()}\n`;
        directAnswer += `Since this is not covered, you would pay the full amount.\n`;
        estimatedPatientCost = officeFee;
      }
    }
  } catch (feeError) {
    console.log(`[checkProcedureCoverage] Could not fetch fee for ${procedureMapping.codes[0]}:`, feeError);
  }

  // Add prompt for exact cost lookup
  directAnswer += `\n───────────────────────────\n`;
  directAnswer += `CDT Codes: ${procedureMapping.codes.join(', ')}\n`;
  directAnswer += `\n💡 Want the EXACT cost? Provide your name and date of birth to check your remaining benefits and account balance.\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: `Coverage check for ${procedureMapping.description}`,
      directAnswer,
      data: {
        procedure: procedureMapping.description,
        category: categoryName,
        procCodes: procedureMapping.codes,
        isCovered: !procedureExcluded && coveragePercent !== null && coveragePercent > 0,
        coveragePercent,
        isExcluded: procedureExcluded,
        frequencyLimit: frequencyMatch || null,
        ageLimit: ageMatch || null,
        additionalInfo,
        officeFee,
        estimatedInsurancePays,
        estimatedPatientCost,
        plan: {
          name: plan.insuranceName,
          groupName: plan.groupName,
          groupNumber: plan.groupNumber,
        },
      },
    },
  };
}

/**
 * Get fee schedule amounts for procedures
 * Handles natural language requests like "cleaning and exams" or specific procedure codes
 */
async function getFeeScheduleAmounts(
  params: Record<string, any>,
  clinicId?: string
): Promise<{ statusCode: number; body: any }> {
  const searchClinicId = clinicId || params.clinicId;

  // Extract procedure names from various parameter formats
  const procedures: string[] = [];

  if (params.procedures) {
    if (Array.isArray(params.procedures)) {
      procedures.push(...params.procedures);
    } else {
      procedures.push(params.procedures);
    }
  }
  if (params.procedure) procedures.push(params.procedure);
  if (params.procedureName) procedures.push(params.procedureName);
  if (params.procCode) procedures.push(params.procCode);
  if (params.procCodes) {
    if (Array.isArray(params.procCodes)) {
      procedures.push(...params.procCodes);
    } else {
      procedures.push(params.procCodes);
    }
  }

  // OPTIMIZATION: Limit to specific procedures to reduce API calls and data
  // If no specific procedures provided, return just the most common ones
  if (procedures.length === 0) {
    procedures.push('cleaning', 'exam');
  }

  // OPTIMIZATION: Limit to max 5 procedures to prevent large responses
  const limitedProcedures = procedures.slice(0, 5);

  let directAnswer = `=== FEE SCHEDULE ===\n`;
  directAnswer += `Clinic: ${searchClinicId || 'Unknown'}\n\n`;

  const allFees: { procedure: string; codes: string[]; fees: any[] }[] = [];

  for (const procedureName of limitedProcedures) {
    // Map procedure name to CDT codes
    const mapping = mapProcedureToCode(procedureName);

    if (!mapping) {
      directAnswer += `⚠️ "${procedureName}": Could not identify procedure code\n`;
      continue;
    }

    directAnswer += `${mapping.description.toUpperCase()}\n`;

    const procedureFees: any[] = [];

    for (const code of mapping.codes) {
      const feeResult = await lookupFeeSchedules(
        { procCode: code, clinicId: searchClinicId },
        searchClinicId
      );

      if (feeResult.statusCode === 200 && feeResult.body.data?.fees?.length > 0) {
        const fees = feeResult.body.data.fees as FeeScheduleRecord[];
        // Get the first fee (typically UCR or standard fee schedule)
        const primaryFee = fees[0];

        if (primaryFee.amount !== null) {
          directAnswer += `  ${code} (${primaryFee.description || primaryFee.abbrDesc}): $${primaryFee.amount.toFixed(2)}\n`;
          procedureFees.push({
            code,
            description: primaryFee.description || primaryFee.abbrDesc,
            amount: primaryFee.amount,
            feeSchedule: primaryFee.feeSchedule,
          });
        }
      }
    }

    if (procedureFees.length === 0) {
      directAnswer += `  No fees found for ${mapping.codes.join(', ')}\n`;
    }

    directAnswer += `\n`;

    allFees.push({
      procedure: procedureName,
      codes: mapping.codes,
      fees: procedureFees,
    });
  }

  directAnswer += `─────────────────────────────────────\n`;
  directAnswer += `These are our standard fees. Actual costs may vary.\n`;
  directAnswer += `Please call for a personalized treatment estimate.\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: `Fee schedule amounts retrieved`,
      directAnswer,
      data: {
        clinicId: searchClinicId,
        fees: allFees,
      },
    },
  };
}

// ========================================================================
// PROCEDURE CODE MAPPING
// ========================================================================

/**
 * Common procedure name to CDT code mapping
 * Helps users ask about "crown" instead of "D2740"
 */
const PROCEDURE_NAME_TO_CODES: Record<string, { codes: string[]; category: string; description: string }> = {
  // Preventive
  'fluoride': { codes: ['D1206', 'D1208'], category: 'preventive', description: 'Fluoride treatment' },
  'fluoride varnish': { codes: ['D1206'], category: 'preventive', description: 'Topical fluoride varnish' },
  'cleaning': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Prophylaxis (cleaning)' },
  'adult cleaning': { codes: ['D1110'], category: 'preventive', description: 'Adult prophylaxis' },
  'child cleaning': { codes: ['D1120'], category: 'preventive', description: 'Child prophylaxis' },
  'prophy': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Prophylaxis' },
  'prophylaxis': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Prophylaxis' },
  'sealant': { codes: ['D1351'], category: 'preventive', description: 'Sealant per tooth' },
  'sealants': { codes: ['D1351'], category: 'preventive', description: 'Sealant per tooth' },
  'sealant repair': { codes: ['D1353'], category: 'preventive', description: 'Sealant repair per tooth' },
  'preventive resin': { codes: ['D1352'], category: 'preventive', description: 'Preventive resin restoration' },
  'caries arresting': { codes: ['D1354'], category: 'preventive', description: 'Interim caries arresting medicament' },
  'nutritional counseling': { codes: ['D1310'], category: 'preventive', description: 'Nutritional counseling' },
  'tobacco counseling': { codes: ['D1320'], category: 'preventive', description: 'Tobacco counseling' },
  'oral hygiene instructions': { codes: ['D1330'], category: 'preventive', description: 'Oral hygiene instructions' },

  // Diagnostic - Exams
  'exam': { codes: ['D0120', 'D0150', 'D0140'], category: 'diagnostic', description: 'Oral examination' },
  'periodic exam': { codes: ['D0120'], category: 'diagnostic', description: 'Periodic oral evaluation' },
  'comprehensive exam': { codes: ['D0150'], category: 'diagnostic', description: 'Comprehensive oral evaluation' },
  'new patient exam': { codes: ['D0150'], category: 'diagnostic', description: 'Comprehensive oral evaluation (new patient)' },
  'limited exam': { codes: ['D0140'], category: 'diagnostic', description: 'Limited oral evaluation - problem focused' },
  'problem focused exam': { codes: ['D0140'], category: 'diagnostic', description: 'Limited oral evaluation - problem focused' },
  'detailed exam': { codes: ['D0160'], category: 'diagnostic', description: 'Detailed and extensive oral evaluation' },
  're-evaluation': { codes: ['D0170', 'D0171'], category: 'diagnostic', description: 'Re-evaluation' },
  'post-op visit': { codes: ['D0171'], category: 'diagnostic', description: 'Re-evaluation post-operative visit' },
  'perio evaluation': { codes: ['D0180'], category: 'diagnostic', description: 'Comprehensive periodontal evaluation' },
  'perio charting': { codes: ['D0183'], category: 'diagnostic', description: 'Periodontal charting' },
  'screening': { codes: ['D0190'], category: 'diagnostic', description: 'Screening of a patient' },
  'assessment': { codes: ['D0191'], category: 'diagnostic', description: 'Assessment of a patient' },

  // Diagnostic - X-rays
  'xray': { codes: ['D0210', 'D0220', 'D0270', 'D0274'], category: 'diagnostic', description: 'Radiographs/X-rays' },
  'x-ray': { codes: ['D0210', 'D0220', 'D0270', 'D0274'], category: 'diagnostic', description: 'Radiographs/X-rays' },
  'fmx': { codes: ['D0210'], category: 'diagnostic', description: 'Full mouth X-rays' },
  'full mouth xray': { codes: ['D0210'], category: 'diagnostic', description: 'Full mouth X-rays' },
  'periapical': { codes: ['D0220', 'D0230'], category: 'diagnostic', description: 'Periapical X-ray' },
  'pa': { codes: ['D0220', 'D0230'], category: 'diagnostic', description: 'Periapical X-ray' },
  'bitewing': { codes: ['D0270', 'D0272', 'D0273', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'bitewings': { codes: ['D0270', 'D0272', 'D0273', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'bw': { codes: ['D0270', 'D0272', 'D0273', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'vertical bitewings': { codes: ['D0277'], category: 'diagnostic', description: 'Vertical bitewing X-rays' },
  'occlusal xray': { codes: ['D0240'], category: 'diagnostic', description: 'Occlusal X-ray' },
  'pano': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'panoramic': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'panorex': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'ceph': { codes: ['D0340'], category: 'diagnostic', description: 'Cephalometric X-ray' },
  'cephalometric': { codes: ['D0340'], category: 'diagnostic', description: 'Cephalometric X-ray' },
  'cbct': { codes: ['D0364', 'D0365', 'D0366', 'D0367'], category: 'diagnostic', description: 'Cone beam CT' },
  'cone beam': { codes: ['D0364', 'D0365', 'D0366', 'D0367'], category: 'diagnostic', description: 'Cone beam CT' },
  '3d xray': { codes: ['D0364', 'D0365', 'D0366', 'D0367'], category: 'diagnostic', description: 'Cone beam CT' },
  'tmj xray': { codes: ['D0368'], category: 'diagnostic', description: 'TMJ series' },

  // Diagnostic - Tests
  'pulp test': { codes: ['D0460'], category: 'diagnostic', description: 'Pulp vitality tests' },
  'vitality test': { codes: ['D0460'], category: 'diagnostic', description: 'Pulp vitality tests' },
  'caries risk': { codes: ['D0601', 'D0602', 'D0603'], category: 'diagnostic', description: 'Caries risk assessment' },
  'caries test': { codes: ['D0425'], category: 'diagnostic', description: 'Caries susceptibility tests' },
  'diagnostic cast': { codes: ['D0470'], category: 'diagnostic', description: 'Diagnostic casts' },
  'study models': { codes: ['D0470'], category: 'diagnostic', description: 'Diagnostic casts' },
  'biopsy': { codes: ['D0472', 'D0473', 'D0474'], category: 'diagnostic', description: 'Biopsy' },
  'tissue exam': { codes: ['D0472', 'D0473', 'D0474'], category: 'diagnostic', description: 'Tissue examination' },
  'oral pathology': { codes: ['D0502'], category: 'diagnostic', description: 'Oral pathology procedures' },
  'blood glucose': { codes: ['D0412'], category: 'diagnostic', description: 'Blood glucose test' },
  'hba1c': { codes: ['D0411'], category: 'diagnostic', description: 'HbA1c test' },

  // Restorative - Fillings
  'filling': { codes: ['D2140', 'D2150', 'D2160', 'D2161', 'D2330', 'D2331', 'D2332', 'D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Filling/Restoration' },
  'fillings': { codes: ['D2140', 'D2150', 'D2160', 'D2161', 'D2330', 'D2331', 'D2332', 'D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Filling/Restoration' },
  'amalgam': { codes: ['D2140', 'D2150', 'D2160', 'D2161'], category: 'basic', description: 'Amalgam filling' },
  'silver filling': { codes: ['D2140', 'D2150', 'D2160', 'D2161'], category: 'basic', description: 'Amalgam filling' },
  'composite': { codes: ['D2330', 'D2331', 'D2332', 'D2335', 'D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Composite filling' },
  'white filling': { codes: ['D2330', 'D2331', 'D2332', 'D2335', 'D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Composite (white) filling' },
  'resin filling': { codes: ['D2330', 'D2331', 'D2332', 'D2335', 'D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Resin-based composite filling' },
  'anterior filling': { codes: ['D2330', 'D2331', 'D2332', 'D2335'], category: 'basic', description: 'Anterior composite filling' },
  'posterior filling': { codes: ['D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Posterior composite filling' },
  'gold foil': { codes: ['D2410', 'D2420', 'D2430'], category: 'basic', description: 'Gold foil restoration' },

  // Restorative - Inlays/Onlays
  'inlay': { codes: ['D2510', 'D2520', 'D2530', 'D2610', 'D2620', 'D2630', 'D2650', 'D2651', 'D2652'], category: 'major', description: 'Inlay' },
  'onlay': { codes: ['D2542', 'D2543', 'D2544', 'D2642', 'D2643', 'D2644', 'D2662', 'D2663', 'D2664'], category: 'major', description: 'Onlay' },
  'porcelain inlay': { codes: ['D2610', 'D2620', 'D2630'], category: 'major', description: 'Porcelain/ceramic inlay' },
  'porcelain onlay': { codes: ['D2642', 'D2643', 'D2644'], category: 'major', description: 'Porcelain/ceramic onlay' },
  'metal inlay': { codes: ['D2510', 'D2520', 'D2530'], category: 'major', description: 'Metal inlay' },
  'metal onlay': { codes: ['D2542', 'D2543', 'D2544'], category: 'major', description: 'Metal onlay' },
  'composite inlay': { codes: ['D2650', 'D2651', 'D2652'], category: 'major', description: 'Composite inlay' },
  'composite onlay': { codes: ['D2662', 'D2663', 'D2664'], category: 'major', description: 'Composite onlay' },

  // Restorative - Core/Posts
  'core buildup': { codes: ['D2950'], category: 'basic', description: 'Core buildup' },
  'buildup': { codes: ['D2950'], category: 'basic', description: 'Core buildup' },
  'post and core': { codes: ['D2952', 'D2954'], category: 'basic', description: 'Post and core' },
  'post': { codes: ['D2952', 'D2954'], category: 'basic', description: 'Post and core' },
  'prefab post': { codes: ['D2954'], category: 'basic', description: 'Prefabricated post and core' },
  'custom post': { codes: ['D2952'], category: 'basic', description: 'Indirectly fabricated post and core' },
  'pin retention': { codes: ['D2951'], category: 'basic', description: 'Pin retention' },
  'post removal': { codes: ['D2955'], category: 'basic', description: 'Post removal' },

  // Restorative - Other
  'protective restoration': { codes: ['D2940'], category: 'basic', description: 'Protective restoration' },
  'interim restoration': { codes: ['D2941'], category: 'basic', description: 'Interim therapeutic restoration' },
  'temp crown': { codes: ['D2799'], category: 'basic', description: 'Provisional crown' },
  'provisional crown': { codes: ['D2799'], category: 'basic', description: 'Provisional crown' },
  'stainless steel crown': { codes: ['D2930', 'D2931'], category: 'basic', description: 'Stainless steel crown' },
  'ssc': { codes: ['D2930', 'D2931'], category: 'basic', description: 'Stainless steel crown' },
  'prefab crown': { codes: ['D2932', 'D2933', 'D2934'], category: 'basic', description: 'Prefabricated crown' },
  'recement crown': { codes: ['D2920'], category: 'basic', description: 'Re-cement crown' },
  'recement inlay': { codes: ['D2910'], category: 'basic', description: 'Re-cement inlay/onlay' },

  // Endodontics
  'root canal': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal treatment' },
  'rct': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal treatment' },
  'endo': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Endodontic therapy' },
  'anterior root canal': { codes: ['D3310'], category: 'endo', description: 'Anterior root canal' },
  'premolar root canal': { codes: ['D3320'], category: 'endo', description: 'Premolar root canal' },
  'molar root canal': { codes: ['D3330'], category: 'endo', description: 'Molar root canal' },
  'endo retreatment': { codes: ['D3346', 'D3347', 'D3348'], category: 'endo', description: 'Root canal retreatment' },
  'retreatment': { codes: ['D3346', 'D3347', 'D3348'], category: 'endo', description: 'Root canal retreatment' },
  'pulp cap': { codes: ['D3110', 'D3120'], category: 'endo', description: 'Pulp cap' },
  'direct pulp cap': { codes: ['D3110'], category: 'endo', description: 'Direct pulp cap' },
  'indirect pulp cap': { codes: ['D3120'], category: 'endo', description: 'Indirect pulp cap' },
  'pulpotomy': { codes: ['D3220', 'D3230', 'D3240'], category: 'endo', description: 'Pulpotomy' },
  'pulpectomy': { codes: ['D3221'], category: 'endo', description: 'Pulpal debridement' },
  'apexification': { codes: ['D3351', 'D3352', 'D3353'], category: 'endo', description: 'Apexification' },
  'apicoectomy': { codes: ['D3410', 'D3421', 'D3425', 'D3426'], category: 'endo', description: 'Apicoectomy' },
  'root amputation': { codes: ['D3450'], category: 'endo', description: 'Root amputation' },
  'hemisection': { codes: ['D3920'], category: 'endo', description: 'Hemisection' },
  'endo surgery': { codes: ['D3410', 'D3421', 'D3425', 'D3426', 'D3427'], category: 'endo', description: 'Periradicular surgery' },
  'retrograde filling': { codes: ['D3430'], category: 'endo', description: 'Retrograde filling' },
  'intentional reimplant': { codes: ['D3470'], category: 'endo', description: 'Intentional reimplantation' },

  // Periodontics
  'deep cleaning': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Scaling and root planing' },
  'scaling': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Scaling and root planing' },
  'srp': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Scaling and root planing' },
  'root planing': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Scaling and root planing' },
  'perio maintenance': { codes: ['D4910'], category: 'perio', description: 'Periodontal maintenance' },
  'perio scaling': { codes: ['D4346'], category: 'perio', description: 'Scaling in presence of inflammation' },
  'full mouth debridement': { codes: ['D4355'], category: 'perio', description: 'Full mouth debridement' },
  'gingivectomy': { codes: ['D4210', 'D4211', 'D4212'], category: 'perio', description: 'Gingivectomy' },
  'gingivoplasty': { codes: ['D4210', 'D4211'], category: 'perio', description: 'Gingivoplasty' },
  'crown lengthening': { codes: ['D4249'], category: 'perio', description: 'Clinical crown lengthening' },
  'gingival flap': { codes: ['D4240', 'D4241'], category: 'perio', description: 'Gingival flap procedure' },
  'osseous surgery': { codes: ['D4260', 'D4261'], category: 'perio', description: 'Osseous surgery' },
  'bone graft perio': { codes: ['D4263', 'D4264'], category: 'perio', description: 'Bone replacement graft' },
  'gtr': { codes: ['D4266', 'D4267'], category: 'perio', description: 'Guided tissue regeneration' },
  'guided tissue regeneration': { codes: ['D4266', 'D4267'], category: 'perio', description: 'Guided tissue regeneration' },
  'soft tissue graft': { codes: ['D4270', 'D4273', 'D4275', 'D4277'], category: 'perio', description: 'Soft tissue graft' },
  'gum graft': { codes: ['D4270', 'D4273', 'D4275', 'D4277'], category: 'perio', description: 'Soft tissue graft' },
  'connective tissue graft': { codes: ['D4273', 'D4275'], category: 'perio', description: 'Connective tissue graft' },
  'free gingival graft': { codes: ['D4277'], category: 'perio', description: 'Free soft tissue graft' },
  'pedicle graft': { codes: ['D4270'], category: 'perio', description: 'Pedicle soft tissue graft' },
  'frenectomy': { codes: ['D7960'], category: 'perio', description: 'Frenectomy' },
  'frenulectomy': { codes: ['D7960'], category: 'perio', description: 'Frenectomy' },
  'frenuloplasty': { codes: ['D7963'], category: 'perio', description: 'Frenuloplasty' },
  'antibiotic therapy': { codes: ['D4381'], category: 'perio', description: 'Localized antimicrobial delivery' },

  // Oral Surgery - Extractions
  'extraction': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Tooth extraction' },
  'simple extraction': { codes: ['D7140'], category: 'surgery', description: 'Simple extraction' },
  'surgical extraction': { codes: ['D7210'], category: 'surgery', description: 'Surgical extraction' },
  'erupted extraction': { codes: ['D7140'], category: 'surgery', description: 'Erupted tooth extraction' },
  'impacted extraction': { codes: ['D7210', 'D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Impacted tooth extraction' },
  'wisdom tooth': { codes: ['D7210', 'D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Wisdom tooth extraction' },
  'wisdom teeth': { codes: ['D7210', 'D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Wisdom teeth extraction' },
  'third molar': { codes: ['D7210', 'D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Third molar extraction' },
  'soft tissue impaction': { codes: ['D7220'], category: 'surgery', description: 'Soft tissue impacted extraction' },
  'partial bony impaction': { codes: ['D7230'], category: 'surgery', description: 'Partially bony impacted extraction' },
  'full bony impaction': { codes: ['D7240'], category: 'surgery', description: 'Completely bony impacted extraction' },
  'root removal': { codes: ['D7250'], category: 'surgery', description: 'Residual root removal' },
  'root tip removal': { codes: ['D7250'], category: 'surgery', description: 'Residual root removal' },
  'coronectomy': { codes: ['D7251'], category: 'surgery', description: 'Coronectomy' },
  'primary tooth extraction': { codes: ['D7111'], category: 'surgery', description: 'Primary tooth extraction' },

  // Oral Surgery - Other
  'alveoloplasty': { codes: ['D7310', 'D7311', 'D7320', 'D7321'], category: 'surgery', description: 'Alveoloplasty' },
  'bone recontouring': { codes: ['D7310', 'D7311', 'D7320', 'D7321'], category: 'surgery', description: 'Alveoloplasty' },
  'tori removal': { codes: ['D7471', 'D7472', 'D7473'], category: 'surgery', description: 'Tori removal' },
  'torus removal': { codes: ['D7471', 'D7472', 'D7473'], category: 'surgery', description: 'Torus removal' },
  'exostosis removal': { codes: ['D7471'], category: 'surgery', description: 'Exostosis removal' },
  'incision and drainage': { codes: ['D7510', 'D7511', 'D7520', 'D7521'], category: 'surgery', description: 'Incision and drainage' },
  'i&d': { codes: ['D7510', 'D7511', 'D7520', 'D7521'], category: 'surgery', description: 'Incision and drainage' },
  'abscess drainage': { codes: ['D7510', 'D7511', 'D7520', 'D7521'], category: 'surgery', description: 'Abscess drainage' },
  'biopsy surgery': { codes: ['D7285', 'D7286'], category: 'surgery', description: 'Incisional biopsy' },
  'lesion removal': { codes: ['D7410', 'D7411', 'D7412'], category: 'surgery', description: 'Lesion excision' },
  'cyst removal': { codes: ['D7450', 'D7451'], category: 'surgery', description: 'Cyst removal' },
  'tumor removal': { codes: ['D7440', 'D7441'], category: 'surgery', description: 'Tumor excision' },
  'exposure tooth': { codes: ['D7280'], category: 'surgery', description: 'Exposure of unerupted tooth' },
  'expose and bond': { codes: ['D7280'], category: 'surgery', description: 'Exposure of unerupted tooth' },
  'tooth transplant': { codes: ['D7272'], category: 'surgery', description: 'Tooth transplantation' },
  'tooth reimplant': { codes: ['D7270'], category: 'surgery', description: 'Tooth reimplantation' },
  'sinus lift': { codes: ['D7951', 'D7952'], category: 'surgery', description: 'Sinus augmentation' },
  'sinus augmentation': { codes: ['D7951', 'D7952'], category: 'surgery', description: 'Sinus augmentation' },
  'ridge preservation': { codes: ['D7953'], category: 'surgery', description: 'Ridge preservation graft' },
  'socket preservation': { codes: ['D7953'], category: 'surgery', description: 'Ridge preservation graft' },
  'bone graft surgery': { codes: ['D7950', 'D7953'], category: 'surgery', description: 'Bone graft' },

  // TMJ
  'tmj': { codes: ['D7880', 'D7899'], category: 'surgery', description: 'TMJ treatment' },
  'tmj appliance': { codes: ['D7880'], category: 'surgery', description: 'TMJ occlusal orthotic' },
  'tmj therapy': { codes: ['D9130', 'D7899'], category: 'surgery', description: 'TMJ therapy' },
  'arthrocentesis': { codes: ['D7870'], category: 'surgery', description: 'Arthrocentesis' },
  'arthroscopy': { codes: ['D7872', 'D7873', 'D7874', 'D7875', 'D7876', 'D7877'], category: 'surgery', description: 'Arthroscopy' },
  'condylectomy': { codes: ['D7840'], category: 'surgery', description: 'Condylectomy' },

  // Major - Crowns
  'crown': { codes: ['D2740', 'D2750', 'D2751', 'D2752', 'D2790', 'D2791', 'D2792', 'D2794'], category: 'major', description: 'Crown' },
  'crowns': { codes: ['D2740', 'D2750', 'D2751', 'D2752', 'D2790', 'D2791', 'D2792', 'D2794'], category: 'major', description: 'Crown' },
  'porcelain crown': { codes: ['D2740'], category: 'major', description: 'Porcelain/ceramic crown' },
  'ceramic crown': { codes: ['D2740'], category: 'major', description: 'Porcelain/ceramic crown' },
  'zirconia crown': { codes: ['D2740'], category: 'major', description: 'Zirconia crown' },
  'emax crown': { codes: ['D2740'], category: 'major', description: 'E-max crown' },
  'pfm crown': { codes: ['D2750', 'D2751', 'D2752'], category: 'major', description: 'Porcelain fused to metal crown' },
  'porcelain fused to metal': { codes: ['D2750', 'D2751', 'D2752'], category: 'major', description: 'Porcelain fused to metal crown' },
  'gold crown': { codes: ['D2790', 'D2791', 'D2792'], category: 'major', description: 'Gold/metal crown' },
  'metal crown': { codes: ['D2790', 'D2791', 'D2792'], category: 'major', description: 'Full cast metal crown' },
  'full cast crown': { codes: ['D2790', 'D2791', 'D2792'], category: 'major', description: 'Full cast metal crown' },
  'titanium crown': { codes: ['D2794'], category: 'major', description: 'Titanium crown' },
  '3/4 crown': { codes: ['D2780', 'D2781', 'D2782', 'D2783'], category: 'major', description: 'Three-quarter crown' },
  'three quarter crown': { codes: ['D2780', 'D2781', 'D2782', 'D2783'], category: 'major', description: 'Three-quarter crown' },
  'resin crown': { codes: ['D2710', 'D2720', 'D2721', 'D2722'], category: 'major', description: 'Resin crown' },
  'composite crown': { codes: ['D2710', 'D2390'], category: 'major', description: 'Resin-based composite crown' },

  // Major - Prosthodontics
  'bridge': { codes: ['D6210', 'D6240', 'D6245', 'D6750'], category: 'major', description: 'Bridge' },
  'fpd': { codes: ['D6210', 'D6240', 'D6245', 'D6750'], category: 'major', description: 'Fixed partial denture' },
  'fixed bridge': { codes: ['D6210', 'D6240', 'D6245', 'D6750'], category: 'major', description: 'Fixed partial denture' },
  'pontic': { codes: ['D6205', 'D6210', 'D6211', 'D6212', 'D6240', 'D6241', 'D6242', 'D6245'], category: 'major', description: 'Pontic' },
  'retainer crown': { codes: ['D6710', 'D6720', 'D6740', 'D6750', 'D6790'], category: 'major', description: 'Retainer crown for bridge' },
  'maryland bridge': { codes: ['D6545', 'D6548', 'D6549'], category: 'major', description: 'Resin bonded bridge' },
  'resin bonded bridge': { codes: ['D6545', 'D6548', 'D6549'], category: 'major', description: 'Resin bonded bridge' },

  'denture': { codes: ['D5110', 'D5120', 'D5130', 'D5140'], category: 'major', description: 'Denture' },
  'dentures': { codes: ['D5110', 'D5120', 'D5130', 'D5140'], category: 'major', description: 'Dentures' },
  'complete denture': { codes: ['D5110', 'D5120'], category: 'major', description: 'Complete denture' },
  'full denture': { codes: ['D5110', 'D5120'], category: 'major', description: 'Complete denture' },
  'upper denture': { codes: ['D5110'], category: 'major', description: 'Maxillary complete denture' },
  'lower denture': { codes: ['D5120'], category: 'major', description: 'Mandibular complete denture' },
  'immediate denture': { codes: ['D5130', 'D5140'], category: 'major', description: 'Immediate denture' },
  'partial denture': { codes: ['D5211', 'D5212', 'D5213', 'D5214'], category: 'major', description: 'Partial denture' },
  'partial': { codes: ['D5211', 'D5212', 'D5213', 'D5214'], category: 'major', description: 'Partial denture' },
  'rpd': { codes: ['D5211', 'D5212', 'D5213', 'D5214'], category: 'major', description: 'Removable partial denture' },
  'cast partial': { codes: ['D5213', 'D5214'], category: 'major', description: 'Cast metal partial denture' },
  'acrylic partial': { codes: ['D5211', 'D5212'], category: 'major', description: 'Acrylic partial denture' },
  'flexible partial': { codes: ['D5225', 'D5226'], category: 'major', description: 'Flexible partial denture' },
  'valplast': { codes: ['D5225', 'D5226'], category: 'major', description: 'Flexible partial denture' },
  'unilateral partial': { codes: ['D5281', 'D5282', 'D5283', 'D5284', 'D5286'], category: 'major', description: 'Unilateral partial denture' },
  'flipper': { codes: ['D5820', 'D5821'], category: 'major', description: 'Interim partial denture' },
  'interim denture': { codes: ['D5810', 'D5811', 'D5820', 'D5821'], category: 'major', description: 'Interim denture' },
  'overdenture': { codes: ['D5863', 'D5864', 'D5865', 'D5866'], category: 'major', description: 'Overdenture' },

  'denture adjustment': { codes: ['D5410', 'D5411', 'D5421', 'D5422'], category: 'major', description: 'Denture adjustment' },
  'denture repair': { codes: ['D5510', 'D5520', 'D5610', 'D5620', 'D5630', 'D5640'], category: 'major', description: 'Denture repair' },
  'reline denture': { codes: ['D5730', 'D5731', 'D5740', 'D5741', 'D5750', 'D5751', 'D5760', 'D5761'], category: 'major', description: 'Denture reline' },
  'rebase denture': { codes: ['D5710', 'D5711', 'D5720', 'D5721'], category: 'major', description: 'Denture rebase' },
  'tissue conditioning': { codes: ['D5850', 'D5851'], category: 'major', description: 'Tissue conditioning' },

  // Implants
  'implant': { codes: ['D6010'], category: 'major', description: 'Dental implant' },
  'implants': { codes: ['D6010'], category: 'major', description: 'Dental implant' },
  'implant placement': { codes: ['D6010'], category: 'major', description: 'Endosteal implant placement' },
  'endosteal implant': { codes: ['D6010'], category: 'major', description: 'Endosteal implant' },
  'mini implant': { codes: ['D6013'], category: 'major', description: 'Mini implant' },
  'implant surgery': { codes: ['D6010', 'D6011'], category: 'major', description: 'Implant surgery' },
  'second stage implant': { codes: ['D6011'], category: 'major', description: 'Second stage implant surgery' },
  'implant abutment': { codes: ['D6056', 'D6057'], category: 'major', description: 'Implant abutment' },
  'implant crown': { codes: ['D6058', 'D6059', 'D6060', 'D6061', 'D6062', 'D6063', 'D6064', 'D6065', 'D6066', 'D6067'], category: 'major', description: 'Implant crown' },
  'abutment crown': { codes: ['D6058', 'D6059', 'D6060', 'D6061', 'D6062', 'D6063', 'D6064'], category: 'major', description: 'Abutment supported crown' },
  'implant bridge': { codes: ['D6075', 'D6076', 'D6077'], category: 'major', description: 'Implant supported bridge' },
  'implant denture': { codes: ['D6110', 'D6111', 'D6112', 'D6113', 'D6114', 'D6115'], category: 'major', description: 'Implant supported denture' },
  'implant overdenture': { codes: ['D6110', 'D6111'], category: 'major', description: 'Implant supported overdenture' },
  'all on 4': { codes: ['D6114', 'D6115'], category: 'major', description: 'Implant supported fixed denture' },
  'hybrid denture': { codes: ['D6114', 'D6115'], category: 'major', description: 'Implant supported fixed denture' },
  'implant maintenance': { codes: ['D6080', 'D6081'], category: 'major', description: 'Implant maintenance' },
  'implant cleaning': { codes: ['D6080', 'D6081'], category: 'major', description: 'Implant maintenance' },
  'implant debridement': { codes: ['D6081', 'D6101', 'D6102'], category: 'major', description: 'Implant debridement' },
  'peri-implantitis': { codes: ['D6101', 'D6102', 'D6103'], category: 'major', description: 'Peri-implantitis treatment' },
  'implant removal': { codes: ['D6100'], category: 'major', description: 'Implant removal' },

  // Orthodontics
  'braces': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic treatment' },
  'orthodontics': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic treatment' },
  'ortho': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic treatment' },
  'comprehensive ortho': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Comprehensive orthodontic treatment' },
  'limited ortho': { codes: ['D8010', 'D8020', 'D8030', 'D8040'], category: 'ortho', description: 'Limited orthodontic treatment' },
  'interceptive ortho': { codes: ['D8050', 'D8060'], category: 'ortho', description: 'Interceptive orthodontic treatment' },
  'adolescent ortho': { codes: ['D8080'], category: 'ortho', description: 'Adolescent orthodontic treatment' },
  'adult ortho': { codes: ['D8090'], category: 'ortho', description: 'Adult orthodontic treatment' },
  'invisalign': { codes: ['D8090'], category: 'ortho', description: 'Clear aligners' },
  'clear aligners': { codes: ['D8090'], category: 'ortho', description: 'Clear aligners' },
  'retainer': { codes: ['D8680'], category: 'ortho', description: 'Orthodontic retainer' },
  'retainers': { codes: ['D8680'], category: 'ortho', description: 'Orthodontic retainer' },
  'ortho retention': { codes: ['D8680'], category: 'ortho', description: 'Orthodontic retention' },
  'ortho visit': { codes: ['D8670'], category: 'ortho', description: 'Periodic orthodontic visit' },
  'ortho adjustment': { codes: ['D8670'], category: 'ortho', description: 'Periodic orthodontic visit' },
  'retainer adjustment': { codes: ['D8681'], category: 'ortho', description: 'Retainer adjustment' },
  'ortho repair': { codes: ['D8691'], category: 'ortho', description: 'Orthodontic appliance repair' },
  'recement orthodontic': { codes: ['D8693', 'D8698', 'D8699'], category: 'ortho', description: 'Re-cement fixed retainer' },
  'removable appliance': { codes: ['D8210'], category: 'ortho', description: 'Removable appliance therapy' },
  'fixed appliance': { codes: ['D8220'], category: 'ortho', description: 'Fixed appliance therapy' },

  // Anesthesia/Sedation
  'anesthesia': { codes: ['D9210', 'D9211', 'D9212', 'D9215'], category: 'anesthesia', description: 'Anesthesia' },
  'local anesthesia': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },
  'block anesthesia': { codes: ['D9211', 'D9212'], category: 'anesthesia', description: 'Block anesthesia' },
  'sedation': { codes: ['D9223', 'D9239', 'D9243', 'D9248'], category: 'anesthesia', description: 'Sedation' },
  'nitrous': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide' },
  'nitrous oxide': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide' },
  'laughing gas': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide' },
  'iv sedation': { codes: ['D9239', 'D9243'], category: 'anesthesia', description: 'IV sedation' },
  'conscious sedation': { codes: ['D9239', 'D9243', 'D9248'], category: 'anesthesia', description: 'Conscious sedation' },
  'moderate sedation': { codes: ['D9239', 'D9243'], category: 'anesthesia', description: 'Moderate sedation' },
  'deep sedation': { codes: ['D9222', 'D9223'], category: 'anesthesia', description: 'Deep sedation' },
  'general anesthesia': { codes: ['D9222', 'D9223'], category: 'anesthesia', description: 'General anesthesia' },
  'ga': { codes: ['D9222', 'D9223'], category: 'anesthesia', description: 'General anesthesia' },
  'sedation evaluation': { codes: ['D9219'], category: 'anesthesia', description: 'Sedation evaluation' },

  // Night guards / Appliances
  'night guard': { codes: ['D9940', 'D9944', 'D9945', 'D9946'], category: 'adjunctive', description: 'Night guard/Occlusal guard' },
  'occlusal guard': { codes: ['D9940', 'D9944', 'D9945', 'D9946'], category: 'adjunctive', description: 'Occlusal guard' },
  'bite guard': { codes: ['D9940', 'D9944', 'D9945', 'D9946'], category: 'adjunctive', description: 'Occlusal guard' },
  'bruxism appliance': { codes: ['D9940', 'D9944', 'D9945', 'D9946'], category: 'adjunctive', description: 'Occlusal guard' },
  'hard night guard': { codes: ['D9944', 'D9946'], category: 'adjunctive', description: 'Hard occlusal guard' },
  'soft night guard': { codes: ['D9945'], category: 'adjunctive', description: 'Soft occlusal guard' },
  'night guard adjustment': { codes: ['D9943'], category: 'adjunctive', description: 'Occlusal guard adjustment' },
  'night guard repair': { codes: ['D9942'], category: 'adjunctive', description: 'Occlusal guard repair' },
  'sports guard': { codes: ['D9941'], category: 'adjunctive', description: 'Athletic mouthguard' },
  'athletic mouthguard': { codes: ['D9941'], category: 'adjunctive', description: 'Athletic mouthguard' },
  'mouthguard': { codes: ['D9941'], category: 'adjunctive', description: 'Athletic mouthguard' },

  // Space Maintainers
  'space maintainer': { codes: ['D1510', 'D1515', 'D1520', 'D1525'], category: 'preventive', description: 'Space maintainer' },
  'fixed space maintainer': { codes: ['D1510', 'D1515', 'D1516', 'D1517'], category: 'preventive', description: 'Fixed space maintainer' },
  'removable space maintainer': { codes: ['D1520', 'D1525', 'D1526', 'D1527'], category: 'preventive', description: 'Removable space maintainer' },
  'distal shoe': { codes: ['D1575'], category: 'preventive', description: 'Distal shoe space maintainer' },
  'recement space maintainer': { codes: ['D1550', 'D1551', 'D1552', 'D1553'], category: 'preventive', description: 'Re-cement space maintainer' },
  'remove space maintainer': { codes: ['D1555', 'D1556', 'D1557', 'D1558'], category: 'preventive', description: 'Remove space maintainer' },

  // Whitening/Cosmetic
  'whitening': { codes: ['D9972', 'D9973', 'D9974', 'D9975'], category: 'cosmetic', description: 'Teeth whitening' },
  'bleaching': { codes: ['D9972', 'D9973', 'D9974', 'D9975'], category: 'cosmetic', description: 'Teeth bleaching' },
  'teeth whitening': { codes: ['D9972', 'D9973', 'D9974', 'D9975'], category: 'cosmetic', description: 'Teeth whitening' },
  'in-office whitening': { codes: ['D9972'], category: 'cosmetic', description: 'In-office whitening' },
  'take home whitening': { codes: ['D9975'], category: 'cosmetic', description: 'Home whitening' },
  'internal bleaching': { codes: ['D9974'], category: 'cosmetic', description: 'Internal bleaching' },
  'veneer': { codes: ['D2960', 'D2961', 'D2962'], category: 'cosmetic', description: 'Veneer' },
  'veneers': { codes: ['D2960', 'D2961', 'D2962'], category: 'cosmetic', description: 'Veneers' },
  'porcelain veneer': { codes: ['D2962'], category: 'cosmetic', description: 'Porcelain veneer' },
  'composite veneer': { codes: ['D2960', 'D2961'], category: 'cosmetic', description: 'Composite veneer' },
  'resin veneer': { codes: ['D2960', 'D2961'], category: 'cosmetic', description: 'Resin veneer' },
  'bonding': { codes: ['D2330', 'D2331', 'D2332', 'D9997'], category: 'cosmetic', description: 'Cosmetic bonding' },
  'enamel microabrasion': { codes: ['D9970'], category: 'cosmetic', description: 'Enamel microabrasion' },
  'odontoplasty': { codes: ['D9971'], category: 'cosmetic', description: 'Odontoplasty' },

  // Adjunctive/Other Services
  'consultation': { codes: ['D9310', 'D9311'], category: 'adjunctive', description: 'Consultation' },
  'emergency': { codes: ['D9110'], category: 'adjunctive', description: 'Emergency treatment' },
  'emergency visit': { codes: ['D9110'], category: 'adjunctive', description: 'Emergency treatment' },
  'palliative treatment': { codes: ['D9110'], category: 'adjunctive', description: 'Palliative treatment' },
  'desensitizing': { codes: ['D9910', 'D9911'], category: 'adjunctive', description: 'Desensitizing treatment' },
  'desensitizing treatment': { codes: ['D9910', 'D9911'], category: 'adjunctive', description: 'Desensitizing treatment' },
  'behavior management': { codes: ['D9920'], category: 'adjunctive', description: 'Behavior management' },
  'occlusal adjustment': { codes: ['D9951', 'D9952'], category: 'adjunctive', description: 'Occlusal adjustment' },
  'equilibration': { codes: ['D9951', 'D9952'], category: 'adjunctive', description: 'Occlusal adjustment' },
  'occlusion analysis': { codes: ['D9950'], category: 'adjunctive', description: 'Occlusion analysis' },
  'case presentation': { codes: ['D9450'], category: 'adjunctive', description: 'Case presentation' },
  'office visit': { codes: ['D9430', 'D9440'], category: 'adjunctive', description: 'Office visit' },
  'house call': { codes: ['D9410'], category: 'adjunctive', description: 'House/facility call' },
  'hospital call': { codes: ['D9420'], category: 'adjunctive', description: 'Hospital call' },
  'post-op complications': { codes: ['D9930'], category: 'adjunctive', description: 'Post-operative complications' },
  'suture': { codes: ['D7910', 'D7911', 'D7912'], category: 'adjunctive', description: 'Suture' },
  'prp': { codes: ['D7921'], category: 'adjunctive', description: 'Platelet rich plasma' },
  'prf': { codes: ['D7921'], category: 'adjunctive', description: 'Platelet rich fibrin' },
  'blood concentrate': { codes: ['D7921'], category: 'adjunctive', description: 'Autologous blood concentrate' },
  'gelfoam': { codes: ['D7922'], category: 'adjunctive', description: 'Intra-socket biological dressing' },

  // Maxillofacial Prosthetics
  'obturator': { codes: ['D5931', 'D5932', 'D5936'], category: 'maxillofacial', description: 'Obturator prosthesis' },
  'surgical obturator': { codes: ['D5931'], category: 'maxillofacial', description: 'Surgical obturator' },
  'definitive obturator': { codes: ['D5932'], category: 'maxillofacial', description: 'Definitive obturator' },
  'facial prosthesis': { codes: ['D5913', 'D5914', 'D5915', 'D5919'], category: 'maxillofacial', description: 'Facial prosthesis' },
  'speech aid': { codes: ['D5952', 'D5953'], category: 'maxillofacial', description: 'Speech aid prosthesis' },
  'palatal lift': { codes: ['D5955', 'D5958'], category: 'maxillofacial', description: 'Palatal lift prosthesis' },
  'radiation carrier': { codes: ['D5983'], category: 'maxillofacial', description: 'Radiation carrier' },
  'fluoride carrier': { codes: ['D5986'], category: 'maxillofacial', description: 'Fluoride gel carrier' },

  // Fractures
  'fracture treatment': { codes: ['D7610', 'D7620', 'D7630', 'D7640', 'D7650', 'D7660', 'D7670', 'D7671', 'D7680'], category: 'surgery', description: 'Fracture treatment' },
  'mandible fracture': { codes: ['D7630', 'D7640'], category: 'surgery', description: 'Mandible fracture treatment' },
  'maxilla fracture': { codes: ['D7610', 'D7620'], category: 'surgery', description: 'Maxilla fracture treatment' },
  'jaw fracture': { codes: ['D7610', 'D7620', 'D7630', 'D7640'], category: 'surgery', description: 'Jaw fracture treatment' },

  // Orthognathic Surgery
  'orthognathic surgery': { codes: ['D7940', 'D7941', 'D7944', 'D7945', 'D7946', 'D7947'], category: 'surgery', description: 'Orthognathic surgery' },
  'lefort': { codes: ['D7946', 'D7947', 'D7948', 'D7949'], category: 'surgery', description: 'LeFort osteotomy' },
  'jaw surgery': { codes: ['D7940', 'D7941', 'D7944', 'D7945', 'D7946'], category: 'surgery', description: 'Jaw surgery' },
  'bsso': { codes: ['D7941'], category: 'surgery', description: 'Bilateral sagittal split osteotomy' },
  'mandibular osteotomy': { codes: ['D7941', 'D7945'], category: 'surgery', description: 'Mandibular osteotomy' },

  // Teledentistry
  'teledentistry': { codes: ['D9995', 'D9996'], category: 'adjunctive', description: 'Teledentistry' },
  'virtual visit': { codes: ['D9995', 'D9996'], category: 'adjunctive', description: 'Teledentistry' },

  // Case Management
  'case management': { codes: ['D9991', 'D9992', 'D9993', 'D9994', 'D9997'], category: 'adjunctive', description: 'Dental case management' },
  'patient education': { codes: ['D9994'], category: 'adjunctive', description: 'Patient education' },
  'motivational interviewing': { codes: ['D9993'], category: 'adjunctive', description: 'Motivational interviewing' },

  // Administrative
  'missed appointment': { codes: ['D9986'], category: 'administrative', description: 'Missed appointment' },
  'cancelled appointment': { codes: ['D9987'], category: 'administrative', description: 'Cancelled appointment' },
  'duplicate records': { codes: ['D9961'], category: 'administrative', description: 'Duplicate records' },

  // --- NEW ALIASES TO ADD ---

  // Common Patient Terms (Preventive/Diagnostic)
  'checkup': { codes: ['D0120', 'D0150'], category: 'diagnostic', description: 'Routine checkup' },
  'dental checkup': { codes: ['D0120', 'D0150'], category: 'diagnostic', description: 'Dental checkup' },
  'teeth cleaning': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Teeth cleaning' },
  'routine cleaning': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Routine cleaning' },
  'pictures': { codes: ['D0210', 'D0220', 'D0274'], category: 'diagnostic', description: 'X-rays/Radiographs' },

  // Common Patient Terms (Restorative)
  'cavity': { codes: ['D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Cavity filling' },
  'tooth filling': { codes: ['D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Tooth filling' },
  'cap': { codes: ['D2740', 'D2750'], category: 'major', description: 'Dental crown (cap)' },
  'tooth cap': { codes: ['D2740', 'D2750'], category: 'major', description: 'Dental crown' },
  'temporary crown': { codes: ['D2799'], category: 'basic', description: 'Temporary crown' },
  'temp': { codes: ['D2799'], category: 'basic', description: 'Temporary crown' },

  // Common Patient Terms (Endo/Surgery)
  'remove tooth': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Tooth removal' },
  'pull tooth': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Tooth pulling' },
  'pulling': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Tooth pulling' },
  'infected tooth': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal treatment' },
  'nerve treatment': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal therapy' },

  // Common Patient Terms (Pros/Ortho)
  'false teeth': { codes: ['D5110', 'D5120'], category: 'major', description: 'Dentures' },
  'plate': { codes: ['D5110', 'D5120'], category: 'major', description: 'Denture plate' },
  'partial plate': { codes: ['D5211', 'D5212', 'D5213', 'D5214'], category: 'major', description: 'Partial denture' },
  'straightening': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Teeth straightening' },
  'aligners': { codes: ['D8090'], category: 'ortho', description: 'Clear aligners' },

  // Clinical Abbreviations
  'ext': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Extraction' },
  'b/w': { codes: ['D0270', 'D0272', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'bws': { codes: ['D0270', 'D0272', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'comp': { codes: ['D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Composite filling' },
  'bu': { codes: ['D2950'], category: 'basic', description: 'Core buildup' },
  'crn': { codes: ['D2740'], category: 'major', description: 'Crown' },
  'perio maint': { codes: ['D4910'], category: 'perio', description: 'Periodontal maintenance' },
  'limited': { codes: ['D0140'], category: 'diagnostic', description: 'Limited exam' },
  'comp exam': { codes: ['D0150'], category: 'diagnostic', description: 'Comprehensive exam' },
  'periodic': { codes: ['D0120'], category: 'diagnostic', description: 'Periodic exam' },
  'seal': { codes: ['D1351'], category: 'preventive', description: 'Sealant' },

  // Spelling Variations / Plurals
  'xrays': { codes: ['D0210', 'D0220', 'D0274'], category: 'diagnostic', description: 'X-rays' },
  'radiograph': { codes: ['D0210', 'D0220', 'D0274'], category: 'diagnostic', description: 'Radiograph' },
  'radiographs': { codes: ['D0210', 'D0220', 'D0274'], category: 'diagnostic', description: 'Radiographs' },
  'mouhtguard': { codes: ['D9941'], category: 'adjunctive', description: 'Mouthguard (typo correction)' }, // typo handling
  'guard': { codes: ['D9940', 'D9944'], category: 'adjunctive', description: 'Occlusal guard' },
  'whitening tray': { codes: ['D9975'], category: 'cosmetic', description: 'Whitening trays' },
  'bleach': { codes: ['D9972', 'D9975'], category: 'cosmetic', description: 'Bleaching' },

  // --- MORE ALIASES (Part 2) ---

  // Symptom & Complaint Based (Mapping to Exams/Palliative)
  'toothache': { codes: ['D0140', 'D9110'], category: 'adjunctive', description: 'Emergency exam/Palliative' },
  'tooth pain': { codes: ['D0140', 'D9110'], category: 'adjunctive', description: 'Emergency exam/Palliative' },
  'broken tooth': { codes: ['D0140', 'D9110'], category: 'adjunctive', description: 'Broken tooth assessment' },
  'chipped tooth': { codes: ['D0140', 'D2391', 'D2330'], category: 'basic', description: 'Chipped tooth repair' },
  'swollen face': { codes: ['D0140', 'D9110'], category: 'adjunctive', description: 'Emergency exam for swelling' },
  'bleeding gums': { codes: ['D0140', 'D0180'], category: 'diagnostic', description: 'Gum evaluation' },
  'sensitive tooth': { codes: ['D0140', 'D9910'], category: 'adjunctive', description: 'Sensitivity eval/treatment' },
  'lost filling': { codes: ['D0140', 'D2940'], category: 'basic', description: 'Lost filling assessment' },
  'lost crown': { codes: ['D0140', 'D2920'], category: 'basic', description: 'Recement crown' },
  'dry socket': { codes: ['D9930'], category: 'adjunctive', description: 'Dry socket treatment' },
  'canker sore': { codes: ['D0140', 'D7465'], category: 'adjunctive', description: 'Lesion evaluation' },

  // Location Specific Fillings
  'front tooth filling': { codes: ['D2330', 'D2331', 'D2332', 'D2335'], category: 'basic', description: 'Anterior composite' },
  'back tooth filling': { codes: ['D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Posterior composite' },
  'molar filling': { codes: ['D2391', 'D2392', 'D2393', 'D2394'], category: 'basic', description: 'Molar composite' },
  'bonding front': { codes: ['D2330', 'D2331', 'D2332', 'D2335'], category: 'cosmetic', description: 'Anterior bonding' },
  'gap filling': { codes: ['D2335'], category: 'cosmetic', description: 'Diastema closure' },

  // Pediatric Specifics
  'baby tooth': { codes: ['D7111'], category: 'surgery', description: 'Primary tooth extraction' },
  'wiggle tooth': { codes: ['D7111'], category: 'surgery', description: 'Primary tooth extraction' },
  'baby root canal': { codes: ['D3220'], category: 'endo', description: 'Pulpotomy' },
  'silver cap': { codes: ['D2930'], category: 'basic', description: 'Stainless steel crown' },
  'kids cleaning': { codes: ['D1120'], category: 'preventive', description: 'Child prophylaxis' },
  'fluoride shot': { codes: ['D1206'], category: 'preventive', description: 'Fluoride varnish' }, // rare slang but happens

  // Denture Slang & Specifics
  'glue denture': { codes: ['D5510', 'D5610'], category: 'major', description: 'Denture repair' },
  'loose denture': { codes: ['D5730', 'D5731', 'D5750', 'D5751'], category: 'major', description: 'Denture reline' },
  'soft liner': { codes: ['D5850', 'D5851'], category: 'major', description: 'Tissue conditioning' },
  'click in denture': { codes: ['D6110', 'D6111', 'D6053'], category: 'major', description: 'Implant overdenture' },
  'snap on denture': { codes: ['D6110', 'D6111'], category: 'major', description: 'Implant overdenture' },

  // Ortho Variations
  'wires': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic adjustment' },
  'tightening': { codes: ['D8670'], category: 'ortho', description: 'Ortho monthly visit' },
  'broken bracket': { codes: ['D8691'], category: 'ortho', description: 'Bonding repair' },
  'lost retainer': { codes: ['D8680'], category: 'ortho', description: 'Replacement retainer' },
  'perm retainer': { codes: ['D8693'], category: 'ortho', description: 'Fixed retainer' },
  'permanent retainer': { codes: ['D8693'], category: 'ortho', description: 'Fixed retainer' },
  'buttons': { codes: ['D8080'], category: 'ortho', description: 'Ortho attachments' },

  // Implant Specifics
  'screw tooth': { codes: ['D6010', 'D6058'], category: 'major', description: 'Implant' },
  'new tooth': { codes: ['D6010', 'D6058'], category: 'major', description: 'Implant or Bridge' },
  'bone powder': { codes: ['D7950', 'D7953'], category: 'surgery', description: 'Bone graft' },
  'membrane': { codes: ['D4266'], category: 'perio', description: 'Guided tissue regeneration' },

  // Sedation Slang
  'sleep dentistry': { codes: ['D9222', 'D9223'], category: 'anesthesia', description: 'General anesthesia' },
  'twilight': { codes: ['D9239', 'D9243'], category: 'anesthesia', description: 'IV Sedation' },
  'numbing': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },
  'shot': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },

  // Follow-up / Post-Op
  'stitches out': { codes: ['D9930'], category: 'adjunctive', description: 'Suture removal' },
  'suture removal': { codes: ['D9930'], category: 'adjunctive', description: 'Suture removal' },
  'check healing': { codes: ['D0171'], category: 'diagnostic', description: 'Post-op re-evaluation' },

  // Administrative / Vague Terms
  'second opinion': { codes: ['D9310'], category: 'adjunctive', description: 'Consultation' },
  'referral': { codes: ['D9310'], category: 'adjunctive', description: 'Consultation' },
  'transfer records': { codes: ['D9990'], category: 'administrative', description: 'Records transfer' }, // Note: D9990 is rarely used but fits context
  'meds': { codes: ['D9610', 'D9612'], category: 'adjunctive', description: 'Therapeutic drug injection' },
  'prescription': { codes: ['D9630'], category: 'adjunctive', description: 'Drugs/medicaments dispensed' },

  /// --- MORE ALIASES (Part 3) ---

  // Common Misspellings & Typos (Critical for User Input)
  'flouride': { codes: ['D1206', 'D1208'], category: 'preventive', description: 'Fluoride (typo)' },
  'propholaxis': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Prophylaxis (typo)' },
  'root cannal': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal (typo)' },
  'absess': { codes: ['D7510', 'D0140'], category: 'surgery', description: 'Abscess (typo)' },
  'abcess': { codes: ['D7510', 'D0140'], category: 'surgery', description: 'Abscess (typo)' },
  'enamal': { codes: ['D9970'], category: 'cosmetic', description: 'Enamel (typo)' },
  'invisaline': { codes: ['D8090'], category: 'ortho', description: 'Invisalign (typo)' },
  'orthadontics': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontics (typo)' },
  'genral anesthesia': { codes: ['D9222', 'D9223'], category: 'anesthesia', description: 'General anesthesia (typo)' },
  'bridge work': { codes: ['D6210', 'D6750'], category: 'major', description: 'Bridge work' },
  'temp filling': { codes: ['D2940'], category: 'basic', description: 'Temporary filling' },

  // Periodontal (Gum) Colloquialisms
  'gum disease': { codes: ['D4341', 'D4342', 'D4910'], category: 'perio', description: 'Periodontal treatment' },
  'gum pockets': { codes: ['D0180'], category: 'diagnostic', description: 'Periodontal charting' },
  'gum infection': { codes: ['D4341', 'D0140'], category: 'perio', description: 'Periodontal infection' },
  'gum surgery': { codes: ['D4210', 'D4260'], category: 'perio', description: 'Gingivectomy/Osseous surgery' },
  'quad scale': { codes: ['D4341'], category: 'perio', description: 'Scaling and root planing (4 teeth+)' },
  'local meds': { codes: ['D4381'], category: 'perio', description: 'Arestin/Antibiotic placement' },
  'antibiotic powder': { codes: ['D4381'], category: 'perio', description: 'Localized delivery of antimicrobial' },
  'pocket reduction': { codes: ['D4260', 'D4261'], category: 'perio', description: 'Osseous surgery' },
  'long teeth': { codes: ['D4270', 'D4273'], category: 'perio', description: 'Recession/Grafting needed' },

  // Technology & Digital Dentistry
  'scan': { codes: ['D0470', 'D0364'], category: 'diagnostic', description: 'Digital impression/3D scan' },
  'digital impression': { codes: ['D0470'], category: 'diagnostic', description: 'Digital impression' },
  '3d scan': { codes: ['D0364', 'D0365'], category: 'diagnostic', description: 'CBCT Scan' },
  'ct scan': { codes: ['D0364', 'D0365'], category: 'diagnostic', description: 'Cone Beam CT' },
  'camera': { codes: ['D0350'], category: 'diagnostic', description: 'Intraoral photo' },
  'photos': { codes: ['D0350'], category: 'diagnostic', description: 'Intraoral photos' },
  'intraoral pictures': { codes: ['D0350'], category: 'diagnostic', description: '2D oral images' },
  'laser cleaning': { codes: ['D4999', 'D7465'], category: 'perio', description: 'Laser bacterial reduction' }, // Note: Codes vary by carrier for laser

  // Descriptive / Material Specific
  'gold tooth': { codes: ['D2790', 'D2791'], category: 'major', description: 'Gold crown' },
  'silver tooth': { codes: ['D2790', 'D2930'], category: 'major', description: 'Metal crown/SSC' },
  'white crown': { codes: ['D2740'], category: 'major', description: 'Ceramic crown' },
  'porcelain bridge': { codes: ['D6750', 'D6240'], category: 'major', description: 'Porcelain bridge' },
  'bruxism': { codes: ['D9940', 'D9944'], category: 'adjunctive', description: 'Grinding/Occlusal guard' },
  'grinding': { codes: ['D9940', 'D9944'], category: 'adjunctive', description: 'Teeth grinding' },
  'clenching': { codes: ['D9940', 'D9944'], category: 'adjunctive', description: 'Jaw clenching' },
  'jaw popping': { codes: ['D0140', 'D7880'], category: 'adjunctive', description: 'TMJ evaluation' },
  'lockjaw': { codes: ['D0140', 'D7880'], category: 'adjunctive', description: 'Trismus/TMJ eval' },

  // Hygiene/Preventive Additions
  'polish': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Polishing (part of prophy)' },
  'stain removal': { codes: ['D1110', 'D9970'], category: 'preventive', description: 'Prophylaxis or Microabrasion' },
  'perio clean': { codes: ['D4910'], category: 'perio', description: 'Periodontal maintenance' },
  'varnish': { codes: ['D1206'], category: 'preventive', description: 'Fluoride varnish' },
  'smoke stains': { codes: ['D1110', 'D9970'], category: 'preventive', description: 'Stain removal' },

  // --- MORE ALIASES (Part 4) ---

  // Orthodontic Hardware & Specifics
  'retainer check': { codes: ['D8681'], category: 'ortho', description: 'Retainer adjustment/Check' },
  'hawley': { codes: ['D8680'], category: 'ortho', description: 'Hawley retainer' },
  'essix': { codes: ['D8680'], category: 'ortho', description: 'Clear retainer (Essix)' },
  'expander': { codes: ['D8210', 'D8220'], category: 'ortho', description: 'Palatal expander' },
  'palatal expander': { codes: ['D8220'], category: 'ortho', description: 'Fixed appliance (Expander)' },
  'spacer': { codes: ['D8080'], category: 'ortho', description: 'Orthodontic spacers (sep)' },
  'separators': { codes: ['D8080'], category: 'ortho', description: 'Orthodontic spacers' },
  'bonded retainer': { codes: ['D8693'], category: 'ortho', description: 'Fixed lingual retainer' },
  'bar': { codes: ['D8693'], category: 'ortho', description: 'Fixed retainer bar' },
  'herbst': { codes: ['D8220'], category: 'ortho', description: 'Fixed appliance (Herbst)' },
  'headgear': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic headgear' },

  // Trauma & Emergency Scenarios
  'knocked out': { codes: ['D7270', 'D0140'], category: 'surgery', description: 'Tooth reimplantation/Emergency' },
  'avulsed': { codes: ['D7270'], category: 'surgery', description: 'Tooth reimplantation' },
  'loose tooth': { codes: ['D0140', 'D4341', 'D7140'], category: 'diagnostic', description: 'Mobility evaluation' },
  'splint': { codes: ['D4320', 'D4321'], category: 'perio', description: 'Periodontal splinting' },
  'jaw lock': { codes: ['D0140', 'D7880'], category: 'adjunctive', description: 'TMJ evaluation' },
  'cut lip': { codes: ['D0140', 'D7910'], category: 'surgery', description: 'Suture of soft tissue' },
  'bleeding': { codes: ['D9110', 'D0140'], category: 'adjunctive', description: 'Control of hemorrhage' },

  // Cosmetic & "Smile" Terms
  'smile makeover': { codes: ['D9310', 'D0150'], category: 'cosmetic', description: 'Cosmetic consultation' },
  'hollywood smile': { codes: ['D2962', 'D2740'], category: 'cosmetic', description: 'Veneers/Crowns' },
  'gum lift': { codes: ['D4211', 'D4212'], category: 'perio', description: 'Gingivectomy (Esthetic)' },
  'gum contouring': { codes: ['D4211', 'D4212'], category: 'perio', description: 'Gingivoplasty' },
  'gap closure': { codes: ['D2335', 'D8090'], category: 'cosmetic', description: 'Bonding or Ortho' },
  'tooth jewelry': { codes: ['D9999'], category: 'cosmetic', description: 'Tooth gem/jewel' },
  'grill': { codes: ['D9999'], category: 'cosmetic', description: 'Jewelry/Removable appliance' },

  // Old School / Colloquial Terms
  'novocaine': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },
  'lidocaine': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },
  'gas': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide' },
  'flipper tooth': { codes: ['D5820'], category: 'major', description: 'Interim partial denture' },
  'nesbit': { codes: ['D5284', 'D5286'], category: 'major', description: 'Removable unilateral partial' },
  'pyorrhea': { codes: ['D4341', 'D4910'], category: 'perio', description: 'Periodontal disease (Old term)' },
  'trench mouth': { codes: ['D4341', 'D4910'], category: 'perio', description: 'ANUG/Perio treatment' },

  // Administrative / Status Actions
  'broken appointment': { codes: ['D9986'], category: 'administrative', description: 'Missed appointment' },
  'no show': { codes: ['D9986'], category: 'administrative', description: 'Missed appointment' },
  'late cancel': { codes: ['D9987'], category: 'administrative', description: 'Cancelled appointment < 24h' },
  'files': { codes: ['D9990'], category: 'administrative', description: 'Records transfer' },
  'copy records': { codes: ['D9990'], category: 'administrative', description: 'Copying patient records' },
  'pre-med': { codes: ['D9610', 'D9630'], category: 'adjunctive', description: 'Prophylactic antibiotics' },

  // Maintenance & Specific Hygiene
  '3 month cleaning': { codes: ['D4910'], category: 'perio', description: 'Perio maintenance' },
  '4 month cleaning': { codes: ['D4910'], category: 'perio', description: 'Perio maintenance' },
  'flossing instructions': { codes: ['D1330'], category: 'preventive', description: 'Oral hygiene instructions' },
  'brushing instructions': { codes: ['D1330'], category: 'preventive', description: 'Oral hygiene instructions' },
  'ohi': { codes: ['D1330'], category: 'preventive', description: 'Oral hygiene instructions' },

  // --- MORE ALIASES (Part 5) ---

  // Brand Names & Products
  'zoom': { codes: ['D9972'], category: 'cosmetic', description: 'Zoom whitening (In-office)' },
  'zoom whitening': { codes: ['D9972'], category: 'cosmetic', description: 'Zoom whitening' },
  'opalescence': { codes: ['D9972', 'D9975'], category: 'cosmetic', description: 'Whitening' },
  'lumineers': { codes: ['D2962'], category: 'cosmetic', description: 'No-prep veneers' },
  'damon': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Self-ligating braces' },
  'suredsmile': { codes: ['D8090'], category: 'ortho', description: 'Clear aligners' },
  'lucitone': { codes: ['D5110', 'D5120'], category: 'major', description: 'Denture base material' },
  'nobel': { codes: ['D6010'], category: 'major', description: 'Nobel Biocare implant' },
  'straumann': { codes: ['D6010'], category: 'major', description: 'Straumann implant' },
  'arestin': { codes: ['D4381'], category: 'perio', description: 'Antibiotic placement' },
  'perio chip': { codes: ['D4381'], category: 'perio', description: 'Antimicrobial chip' },

  // "Fixing" & Repairing (Patient Phrasing)
  'glue crown': { codes: ['D2920'], category: 'basic', description: 'Re-cement crown' },
  'cement crown': { codes: ['D2920'], category: 'basic', description: 'Re-cement crown' },
  'glue bridge': { codes: ['D6930'], category: 'major', description: 'Re-cement bridge' },
  'recement bridge': { codes: ['D6930'], category: 'major', description: 'Re-cement bridge' },
  'tighten implant': { codes: ['D6080'], category: 'major', description: 'Implant maintenance/screw tightening' },
  'screw tightening': { codes: ['D6080', 'D6199'], category: 'major', description: 'Implant screw tightening' },
  'smooth chip': { codes: ['D9971', 'D2335'], category: 'cosmetic', description: 'Odontoplasty/Bonding' },
  'file tooth': { codes: ['D9971'], category: 'cosmetic', description: 'Odontoplasty (Enamel shaping)' },
  'shave tooth': { codes: ['D9971'], category: 'cosmetic', description: 'Odontoplasty' },
  'fix chip': { codes: ['D2335', 'D2391'], category: 'basic', description: 'Resin restoration' },
  'patch filling': { codes: ['D2335', 'D2391'], category: 'basic', description: 'Repair restoration' },

  // Material & Descriptive Slang
  'mercury filling': { codes: ['D2140', 'D2150', 'D2160'], category: 'basic', description: 'Amalgam filling' },
  'silver star': { codes: ['D2140', 'D2150'], category: 'basic', description: 'Amalgam filling' },
  'plastic filling': { codes: ['D2391', 'D2392'], category: 'basic', description: 'Composite filling' },
  'tooth colored': { codes: ['D2391', 'D2392', 'D2330'], category: 'basic', description: 'Composite restoration' },
  'porcelain cap': { codes: ['D2740', 'D2750'], category: 'major', description: 'Porcelain crown' },
  'gold cap': { codes: ['D2790'], category: 'major', description: 'Gold crown' },
  'metal cap': { codes: ['D2790', 'D2930'], category: 'major', description: 'Full cast/SSC' },

  // Specific Exam Contexts
  'school exam': { codes: ['D0120', 'D0150'], category: 'diagnostic', description: 'Routine exam for school' },
  'work clearance': { codes: ['D0140', 'D0150'], category: 'diagnostic', description: 'Dental clearance' },
  'surgery clearance': { codes: ['D0140', 'D0150'], category: 'diagnostic', description: 'Pre-op clearance' },
  'cancer screening': { codes: ['D0120', 'D0150', 'D0431'], category: 'diagnostic', description: 'Oral cancer screening' },
  'velscope': { codes: ['D0431'], category: 'diagnostic', description: 'Adjunctive pre-diagnostic test' },

  // Hygiene & "Cleaning" Variants
  'jet polish': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Prophy with air polisher' },
  'prophy jet': { codes: ['D1110', 'D1120'], category: 'preventive', description: 'Prophy with air polisher' },
  'heavy cleaning': { codes: ['D4341', 'D4342', 'D4355'], category: 'perio', description: 'Scaling/Debridement' },
  'debridement': { codes: ['D4355'], category: 'perio', description: 'Full mouth debridement' },
  'gross debridement': { codes: ['D4355'], category: 'perio', description: 'Full mouth debridement' },
  'numbs': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },

  // More Typos / Spacing Variants
  'rootcanal': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal (no space)' },
  'check up': { codes: ['D0120', 'D0150'], category: 'diagnostic', description: 'Checkup (space)' },
  'deepcleaning': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Deep cleaning (no space)' },
  'x ray': { codes: ['D0210', 'D0220', 'D0274'], category: 'diagnostic', description: 'X-ray (space)' },
  'mouth guard': { codes: ['D9941', 'D9944'], category: 'adjunctive', description: 'Mouthguard (space)' },
  'nightguard': { codes: ['D9944', 'D9940'], category: 'adjunctive', description: 'Night guard (no space)' },

  // --- MORE ALIASES (Part 6) ---

  // Anxiety & Comfort (Patient Language)
  'put me to sleep': { codes: ['D9222', 'D9223'], category: 'anesthesia', description: 'General anesthesia' },
  'knock me out': { codes: ['D9222', 'D9223'], category: 'anesthesia', description: 'General anesthesia' },
  'happy gas': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide' },
  'gas and air': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide' },
  'pill sedation': { codes: ['D9248'], category: 'anesthesia', description: 'Oral conscious sedation' },
  'oral sedation': { codes: ['D9248'], category: 'anesthesia', description: 'Oral conscious sedation' },
  'freezing': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },
  'numb lip': { codes: ['D9215'], category: 'anesthesia', description: 'Local anesthesia' },

  // Pediatric & Habit Appliances
  'thumb sucking': { codes: ['D8210'], category: 'ortho', description: 'Habit breaking appliance' },
  'thumb guard': { codes: ['D8210'], category: 'ortho', description: 'Habit breaking appliance' },
  'tongue thrust': { codes: ['D8210'], category: 'ortho', description: 'Tongue thrust appliance' },
  'crib': { codes: ['D8210'], category: 'ortho', description: 'Palatal crib' },
  'blue sealant': { codes: ['D1351'], category: 'preventive', description: 'Sealant' },
  'clear sealant': { codes: ['D1351'], category: 'preventive', description: 'Sealant' },
  'paint on': { codes: ['D1351', 'D1206'], category: 'preventive', description: 'Sealant or Fluoride' },
  'sugar bugs': { codes: ['D2330', 'D2391'], category: 'basic', description: 'Cavity removal (Pediatric term)' },

  // Orthodontic Phases & Specifics
  'phase 1': { codes: ['D8050', 'D8060'], category: 'ortho', description: 'Interceptive orthodontics' },
  'phase 2': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Comprehensive orthodontics' },
  'early braces': { codes: ['D8050', 'D8060'], category: 'ortho', description: 'Interceptive orthodontics' },
  'partial braces': { codes: ['D8010', 'D8020'], category: 'ortho', description: 'Limited orthodontics' },
  'chain': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Power chain (Adjustment)' },
  'elastics': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Rubber bands (Adjustment)' },
  'rubber bands': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic elastics' },
  'tighten braces': { codes: ['D8670'], category: 'ortho', description: 'Orthodontic adjustment' },

  // Administrative & Insurance Lingo
  'pre auth': { codes: ['D9999'], category: 'administrative', description: 'Pre-authorization (Admin)' },
  'estimate': { codes: ['D9450'], category: 'administrative', description: 'Treatment plan estimate' },
  'copay': { codes: ['D9999'], category: 'administrative', description: 'Co-payment collection' },
  'deductible': { codes: ['D9999'], category: 'administrative', description: 'Deductible collection' },
  'ins form': { codes: ['D9990'], category: 'administrative', description: 'Insurance form completion' },
  'narrative': { codes: ['D9990'], category: 'administrative', description: 'Claim narrative' },
  'predetermination': { codes: ['D9999'], category: 'administrative', description: 'Pre-determination of benefits' },

  // Prosthetic Components (Denture/Bridge Parts)
  'clasp': { codes: ['D5999'], category: 'major', description: 'Denture clasp' },
  'mesh': { codes: ['D5999'], category: 'major', description: 'Denture mesh reinforcement' },
  'metal framework': { codes: ['D5213', 'D5214'], category: 'major', description: 'Cast metal framework' },
  'precision attachment': { codes: ['D5862'], category: 'major', description: 'Precision attachment' },
  'wing': { codes: ['D6545'], category: 'major', description: 'Maryland bridge wing' },
  'cantilever': { codes: ['D6205', 'D6793'], category: 'major', description: 'Cantilever bridge' },

  // Specific Tooth Conditions
  'impacted': { codes: ['D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Impacted tooth' },
  'sideways tooth': { codes: ['D7240'], category: 'surgery', description: 'Horizontal impaction' },
  'dead tooth': { codes: ['D3310', 'D3320', 'D3330', 'D7140'], category: 'endo', description: 'Necrotic tooth treatment' },
  'dark tooth': { codes: ['D9974', 'D2962'], category: 'cosmetic', description: 'Internal bleaching or veneer' },
  'supernumerary': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Extra tooth extraction' },
  'extra tooth': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Supernumerary extraction' },
  'mesiodens': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Mesiodens extraction' },

  // Vague "Fix it" requests
  'fix my bite': { codes: ['D9950', 'D9951', 'D9952', 'D8090'], category: 'adjunctive', description: 'Occlusal adjustment or Ortho' },
  'even out': { codes: ['D9951', 'D9971'], category: 'adjunctive', description: 'Enameloplasty/Equilibration' },
  'patch up': { codes: ['D2335', 'D2940'], category: 'basic', description: 'Palliative repair' },
  'rebond': { codes: ['D2910', 'D2920', 'D8693'], category: 'basic', description: 'Re-cement/Re-bond' },

  // More Typos / Phonetic Spellings
  'crown prep': { codes: ['D2740', 'D2750'], category: 'major', description: 'Crown preparation' },
  'temp off': { codes: ['D2740'], category: 'major', description: 'Seat permanent crown' },
  'seat crown': { codes: ['D2740'], category: 'major', description: 'Seat permanent crown' },
  'deliver crown': { codes: ['D2740'], category: 'major', description: 'Seat permanent crown' },
  'impressions': { codes: ['D0470'], category: 'diagnostic', description: 'Impressions' },
  'molds': { codes: ['D0470'], category: 'diagnostic', description: 'Impressions/Molds' },
  'moulds': { codes: ['D0470'], category: 'diagnostic', description: 'Impressions (UK spelling)' },

  // --- MORE ALIASES (Part 7) ---

  // Same-Day & Digital Dentistry
  'cerec': { codes: ['D2740'], category: 'major', description: 'CAD/CAM Ceramic Crown' },
  'same day crown': { codes: ['D2740'], category: 'major', description: 'CAD/CAM Ceramic Crown' },
  'milled crown': { codes: ['D2740'], category: 'major', description: 'Milled Ceramic Crown' },
  'cad cam': { codes: ['D2740', 'D2962'], category: 'major', description: 'CAD/CAM Restoration' },
  'digital crown': { codes: ['D2740'], category: 'major', description: 'Digital Crown' },
  'digital impressions': { codes: ['D0470'], category: 'diagnostic', description: 'Digital impression/Scan' },

  // Urgent Care & Clinical Actions
  'hot tooth': { codes: ['D0140', 'D9110'], category: 'adjunctive', description: 'Acute pulpitis/Emergency' },
  'throbbing': { codes: ['D0140', 'D9110'], category: 'adjunctive', description: 'Severe pain/Emergency' },
  'open and drain': { codes: ['D3221', 'D7510'], category: 'endo', description: 'Pulpal debridement or I&D' },
  'pulp extirpation': { codes: ['D3221'], category: 'endo', description: 'Pulpal debridement' },
  'open and med': { codes: ['D3221'], category: 'endo', description: 'Pulpal debridement' },
  'nerve removal': { codes: ['D3221', 'D3310'], category: 'endo', description: 'Pulpectomy/RCT' },
  'vitality check': { codes: ['D0460'], category: 'diagnostic', description: 'Pulp vitality test' },
  'cold test': { codes: ['D0460'], category: 'diagnostic', description: 'Pulp vitality test' },

  // Denture & Appliance Specifics
  'stayplate': { codes: ['D5820', 'D5821'], category: 'major', description: 'Interim partial denture' },
  'sore spot': { codes: ['D5410', 'D5411', 'D5421', 'D5422'], category: 'major', description: 'Denture adjustment' },
  'denture sore': { codes: ['D5410', 'D5411'], category: 'major', description: 'Denture adjustment' },
  'clasp adjustment': { codes: ['D5421', 'D5422'], category: 'major', description: 'Partial denture adjustment' },
  'tighten partial': { codes: ['D5421', 'D5422'], category: 'major', description: 'Partial denture adjustment' },
  'denture cushion': { codes: ['D5850', 'D5851'], category: 'major', description: 'Tissue conditioning' },
  'denture reline': { codes: ['D5750', 'D5751'], category: 'major', description: 'Denture reline' },

  // Bone & Sinus Terminology
  'socket graft': { codes: ['D7953'], category: 'surgery', description: 'Socket preservation' },
  'ridge aug': { codes: ['D7950'], category: 'surgery', description: 'Ridge augmentation' },
  'bone build up': { codes: ['D7950', 'D7953'], category: 'surgery', description: 'Bone graft' },
  'sinus bump': { codes: ['D7952'], category: 'surgery', description: 'Sinus lift (internal)' },
  'lateral window': { codes: ['D7951'], category: 'surgery', description: 'Sinus lift (external)' },
  'membranes': { codes: ['D4266', 'D4267'], category: 'surgery', description: 'Barrier membrane' },
  'collagen plug': { codes: ['D7922'], category: 'surgery', description: 'Resorbable dressing' },

  // More Clinical Abbreviations
  'bwx': { codes: ['D0270', 'D0272', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'pa x': { codes: ['D0220', 'D0230'], category: 'diagnostic', description: 'Periapical X-ray' },
  'ox': { codes: ['D0240'], category: 'diagnostic', description: 'Occlusal X-ray' },
  'io photo': { codes: ['D0350'], category: 'diagnostic', description: 'Intraoral photo' },
  'eo photo': { codes: ['D0351'], category: 'diagnostic', description: 'Extraoral photo' },
  'wls': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Working length xray (part of RCT)' },

  // Ortho Brands & Retainers
  'vivera': { codes: ['D8680'], category: 'ortho', description: 'Vivera retainers' },
  'bonded wire': { codes: ['D8693'], category: 'ortho', description: 'Fixed retainer' },
  'lingual wire': { codes: ['D8693'], category: 'ortho', description: 'Fixed retainer' },
  'nance': { codes: ['D1510'], category: 'ortho', description: 'Space maintainer (Nance)' },
  'lingual arch': { codes: ['D1510'], category: 'ortho', description: 'Space maintainer (LLA)' },
  'band and loop': { codes: ['D1510'], category: 'ortho', description: 'Space maintainer' },

  // Specific "Fix It" Actions
  'smooth sharp edge': { codes: ['D9971'], category: 'adjunctive', description: 'Odontoplasty' },
  'buffing': { codes: ['D9971', 'D1110'], category: 'adjunctive', description: 'Polishing or Smoothing' },
  'reseat': { codes: ['D2920', 'D6930'], category: 'basic', description: 'Re-cementation' },
  'reglue': { codes: ['D2920', 'D6930'], category: 'basic', description: 'Re-cementation' },
  'recement veneer': { codes: ['D2920'], category: 'cosmetic', description: 'Re-cement veneer' },

  // --- MORE ALIASES (Part 8) ---

  // Insurance & Status Codes (Often confused by staff/patients)
  'comp exam adult': { codes: ['D0150'], category: 'diagnostic', description: 'Comprehensive exam' },
  'comp exam child': { codes: ['D0150'], category: 'diagnostic', description: 'Comprehensive exam' },
  'periodic oral eval': { codes: ['D0120'], category: 'diagnostic', description: 'Periodic exam' },
  'limited oral eval': { codes: ['D0140'], category: 'diagnostic', description: 'Limited exam' },
  'fms': { codes: ['D0210'], category: 'diagnostic', description: 'Full mouth series' },
  'fmx 18': { codes: ['D0210'], category: 'diagnostic', description: 'Full mouth series' },
  'pano view': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },

  // Specific Hygiene Intervals & Types
  '3 month recare': { codes: ['D4910'], category: 'perio', description: 'Perio maintenance' },
  '4 month recare': { codes: ['D4910'], category: 'perio', description: 'Perio maintenance' },
  '6 month recare': { codes: ['D1110', 'D0120'], category: 'preventive', description: 'Recall appointment' },
  'child prophy': { codes: ['D1120'], category: 'preventive', description: 'Child cleaning' },
  'adult prophy': { codes: ['D1110'], category: 'preventive', description: 'Adult cleaning' },
  'difficult prophy': { codes: ['D1110', 'D4346'], category: 'preventive', description: 'Prophy or Scaling w/ gingivitis' },
  'gingivitis cleaning': { codes: ['D4346'], category: 'perio', description: 'Scaling in presence of inflammation' },

  // Specific Repairs & Maintenance
  'repair broken tooth': { codes: ['D2335', 'D2391', 'D2740'], category: 'basic', description: 'Restoration or Crown' },
  'add tooth to partial': { codes: ['D5650'], category: 'major', description: 'Add tooth to partial' },
  'add clasp to partial': { codes: ['D5660'], category: 'major', description: 'Add clasp to partial' },
  'repair denture base': { codes: ['D5511', 'D5512'], category: 'major', description: 'Repair broken denture base' },
  'replace denture tooth': { codes: ['D5520'], category: 'major', description: 'Replace missing denture tooth' },
  'weld partial': { codes: ['D5611', 'D5612'], category: 'major', description: 'Repair partial framework' },

  // Old/Regional Terms
  'cap and pin': { codes: ['D2952', 'D2750'], category: 'basic', description: 'Post and core with crown' },
  'pivot tooth': { codes: ['D2952', 'D2750'], category: 'basic', description: 'Post crown (old term)' },
  'peg tooth': { codes: ['D2962', 'D2740'], category: 'cosmetic', description: 'Restoring microdontia' },
  'jacket crown': { codes: ['D2740'], category: 'major', description: 'Ceramic crown (old term)' },
  'dowel': { codes: ['D2952', 'D2954'], category: 'basic', description: 'Post and core' },

  // Specific Conditions/Locations
  'abfraction': { codes: ['D2391', 'D2335'], category: 'basic', description: 'Class V filling' },
  'erosion': { codes: ['D2391', 'D2335'], category: 'basic', description: 'Class V filling' },
  'black triangle': { codes: ['D2335', 'D2962'], category: 'cosmetic', description: 'Bioclear/Bonding' },
  'short tooth': { codes: ['D4249'], category: 'perio', description: 'Crown lengthening' },
  'gummy smile': { codes: ['D4211', 'D4249'], category: 'perio', description: 'Gingivectomy/Crown lengthening' },

  // Administrative "Bundles" (Phrases implying multiple codes)
  'new patient visit': { codes: ['D0150', 'D0210', 'D1110'], category: 'diagnostic', description: 'New patient bundle' },
  'recall visit': { codes: ['D0120', 'D0274', 'D1110'], category: 'preventive', description: 'Recall bundle' },
  'emergency appt': { codes: ['D0140', 'D0220'], category: 'adjunctive', description: 'Emergency bundle' },
  'implant consult': { codes: ['D9310', 'D0364'], category: 'adjunctive', description: 'Implant consultation' },
  'wisdom teeth consult': { codes: ['D9310', 'D0330'], category: 'surgery', description: 'OS Consultation' },

  // --- MORE ALIASES (Part 9) ---

  // Modern Clinical Acronyms
  'sdf': { codes: ['D1354'], category: 'preventive', description: 'Silver Diamine Fluoride' },
  'silver diamine': { codes: ['D1354'], category: 'preventive', description: 'Silver Diamine Fluoride' },
  'ipr': { codes: ['D8888'], category: 'ortho', description: 'Interproximal reduction (shaving)' }, // Note: D8888 is often used as placeholder or D7999
  'slenderizing': { codes: ['D8888', 'D9971'], category: 'ortho', description: 'Interproximal reduction' },
  'lbr': { codes: ['D4999', 'D7465'], category: 'perio', description: 'Laser bacterial reduction' },
  'laser perio': { codes: ['D4999', 'D7465'], category: 'perio', description: 'Laser bacterial reduction' },
  'wrb': { codes: ['D0272', 'D0274'], category: 'diagnostic', description: 'Bitewings (Working)' },

  // Surface/Filling Shorthand (Clinical Notes)
  'mod filling': { codes: ['D2393', 'D2160'], category: 'basic', description: '3-surface filling' },
  'mo filling': { codes: ['D2392', 'D2150'], category: 'basic', description: '2-surface filling' },
  'do filling': { codes: ['D2392', 'D2150'], category: 'basic', description: '2-surface filling' },
  'occlusal filling': { codes: ['D2391', 'D2140'], category: 'basic', description: '1-surface filling' },
  'buccal pit': { codes: ['D2391', 'D2140'], category: 'basic', description: '1-surface filling' },
  'class v': { codes: ['D2391', 'D2140'], category: 'basic', description: 'Gumline filling' },
  'incisal edge': { codes: ['D2335', 'D2990'], category: 'cosmetic', description: 'Bonding/Resin infiltration' },

  // Brand/Material Specifics
  'bruxzir': { codes: ['D2740'], category: 'major', description: 'Solid Zirconia Crown' },
  'ips emax': { codes: ['D2740'], category: 'major', description: 'Lithium Disilicate Crown' },
  'lava crown': { codes: ['D2740'], category: 'major', description: 'Zirconia Crown' },
  'valplast partial': { codes: ['D5225', 'D5226'], category: 'major', description: 'Flexible partial' },
  'biohorizons': { codes: ['D6010'], category: 'major', description: 'BioHorizons Implant' },
  'mis implant': { codes: ['D6010'], category: 'major', description: 'MIS Implant' },

  // International / UK / Canadian Terms
  'scale and polish': { codes: ['D1110'], category: 'preventive', description: 'Prophylaxis' },
  'fissure sealant': { codes: ['D1351'], category: 'preventive', description: 'Sealant' },
  'orthopantomogram': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'opt': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'dpt': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'root filling': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal treatment' },

  // Specialist Consultations
  'perio consult': { codes: ['D9310', 'D0180'], category: 'adjunctive', description: 'Periodontal consultation' },
  'endo consult': { codes: ['D9310', 'D0140'], category: 'adjunctive', description: 'Endodontic consultation' },
  'oral surgery consult': { codes: ['D9310', 'D0140'], category: 'adjunctive', description: 'Oral Surgery consultation' },
  'ortho consult': { codes: ['D9310', 'D8660'], category: 'ortho', description: 'Orthodontic screening' },
  'records appt': { codes: ['D8660', 'D0470', 'D0330'], category: 'ortho', description: 'Orthodontic records' },

  // Implant Retention Types (Restorative)
  'screw retained': { codes: ['D6058', 'D6059', 'D6065'], category: 'major', description: 'Screw retained crown' },
  'cement retained': { codes: ['D6058', 'D6059'], category: 'major', description: 'Cement retained crown' },
  'custom abutment': { codes: ['D6057'], category: 'major', description: 'Custom implant abutment' },
  'stock abutment': { codes: ['D6056'], category: 'major', description: 'Prefabricated implant abutment' },
  'locator': { codes: ['D5862', 'D6052'], category: 'major', description: 'Locator attachment (Overdenture)' },

  // More Slang/Vague Terms
  'gaps': { codes: ['D2335', 'D8090'], category: 'cosmetic', description: 'Diastema closure' },
  'ugly tooth': { codes: ['D2962', 'D2740'], category: 'cosmetic', description: 'Veneer/Crown' },
  'black tooth': { codes: ['D3310', 'D2962'], category: 'endo', description: 'Non-vital tooth/Esthetics' },
  'hole in tooth': { codes: ['D2391', 'D2140'], category: 'basic', description: 'Cavity' },
  'cracked tooth': { codes: ['D2740', 'D0140'], category: 'major', description: 'Crown/Eval' },

  // --- MORE ALIASES (Part 10) ---

  // Lab & Cosmetic Steps (Multi-step appointments)
  'wax up': { codes: ['D0470'], category: 'diagnostic', description: 'Diagnostic wax-up' },
  'mock up': { codes: ['D9999'], category: 'cosmetic', description: 'Smile trial/Mock-up' },
  'shade match': { codes: ['D9999'], category: 'cosmetic', description: 'Shade taking appointment' },
  'try in': { codes: ['D5999', 'D2999'], category: 'major', description: 'Appliance/Crown try-in' },
  'wax try in': { codes: ['D5999'], category: 'major', description: 'Denture wax try-in' },
  'delivery': { codes: ['D2740', 'D5110'], category: 'major', description: 'Final delivery of restoration' },
  'seat appointment': { codes: ['D2740', 'D5110'], category: 'major', description: 'Final seating' },
  'bite reg': { codes: ['D0470'], category: 'diagnostic', description: 'Bite registration' },

  // Orthodontic Debonding (Removal)
  'braces off': { codes: ['D8680', 'D8090'], category: 'ortho', description: 'Debonding/Removal of braces' },
  'debond': { codes: ['D8680', 'D8090'], category: 'ortho', description: 'Debonding' },
  'remove braces': { codes: ['D8680'], category: 'ortho', description: 'Removal of fixed appliances' },
  'retainer delivery': { codes: ['D8680'], category: 'ortho', description: 'Retainer delivery' },
  'scan for retainer': { codes: ['D0470'], category: 'ortho', description: 'Impression for retainer' },
  'lost aligner': { codes: ['D8090'], category: 'ortho', description: 'Replacement aligner' },

  // Specific Anatomy/Procedure Requests
  'lower wisdom tooth': { codes: ['D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Mandibular third molar' },
  'upper wisdom tooth': { codes: ['D7210', 'D7140'], category: 'surgery', description: 'Maxillary third molar' },
  'eye tooth': { codes: ['D7280', 'D0140'], category: 'surgery', description: 'Canine exposure/evaluation' },
  'canine exposure': { codes: ['D7280'], category: 'surgery', description: 'Surgical exposure of impacted tooth' },
  'tongue tie': { codes: ['D7960'], category: 'perio', description: 'Frenectomy (lingual)' },
  'lip tie': { codes: ['D7960'], category: 'perio', description: 'Frenectomy (labial)' },
  'clipped': { codes: ['D7960'], category: 'perio', description: 'Frenectomy (infant/child)' },

  // Quick Checks & Post-Op Variants
  'quick look': { codes: ['D0140'], category: 'diagnostic', description: 'Limited exam' },
  'spot check': { codes: ['D0140'], category: 'diagnostic', description: 'Limited exam' },
  'post op check': { codes: ['D0171'], category: 'diagnostic', description: 'Post-operative evaluation' },
  'dry socket paste': { codes: ['D9930'], category: 'adjunctive', description: 'Treatment of complications' },
  'socket dressing': { codes: ['D9930'], category: 'adjunctive', description: 'Treatment of complications' },
  'remove stitches': { codes: ['D9930'], category: 'adjunctive', description: 'Suture removal' },

  // Referral & Admin Terms
  'refer to oral surgeon': { codes: ['D9310'], category: 'administrative', description: 'Referral to OS' },
  'refer to endo': { codes: ['D9310'], category: 'administrative', description: 'Referral to Endodontist' },
  'refer to perio': { codes: ['D9310'], category: 'administrative', description: 'Referral to Periodontist' },
  'refer to ortho': { codes: ['D9310'], category: 'administrative', description: 'Referral to Orthodontist' },
  'medicaid exam': { codes: ['D0150', 'D0120'], category: 'diagnostic', description: 'Exam (Insurance specific)' },
  'cash pay': { codes: ['D9999'], category: 'administrative', description: 'Self-pay patient' },

  // More Implant Parts (Restorative side)
  'healing cap': { codes: ['D6010', 'D6011'], category: 'major', description: 'Healing abutment' },
  'healing abutment': { codes: ['D6010', 'D6011'], category: 'major', description: 'Healing abutment' },
  'impression post': { codes: ['D6010', 'D6059'], category: 'major', description: 'Implant impression' },
  'jig': { codes: ['D6059'], category: 'major', description: 'Implant verification jig' },
  'verification jig': { codes: ['D6059'], category: 'major', description: 'Implant verification jig' },

  // Vague "Pain" Descriptors (Diagnostic mapping)
  'zapping pain': { codes: ['D0140', 'D0460'], category: 'diagnostic', description: 'Acute pain eval/Vitality test' },
  'dull ache': { codes: ['D0140'], category: 'diagnostic', description: 'Limited exam' },
  'pressure pain': { codes: ['D0140', 'D0220'], category: 'diagnostic', description: 'Limited exam/PA' },
  'biting pain': { codes: ['D0140', 'D0460'], category: 'diagnostic', description: 'Cracked tooth eval/Bite test' },

  // =========================================================================
  // DENTAL TERMINOLOGY GLOSSARY
  // =========================================================================

  // --- I. Anatomy (Teeth & Mouth) - Formal Definitions ---
  'alveolar bone': { codes: [], category: 'anatomy', description: 'The bone that supports and surrounds the roots of the teeth.' },
  'apex': { codes: [], category: 'anatomy', description: 'The very tip of the root of a tooth.' },
  'canine': { codes: [], category: 'anatomy', description: 'The pointed tooth located between the incisors and premolars.' },
  'cuspid': { codes: [], category: 'anatomy', description: 'The pointed tooth located between the incisors and premolars.' },
  'cementum': { codes: [], category: 'anatomy', description: 'The hard connective tissue covering the tooth root.' },
  'condyle': { codes: [], category: 'anatomy', description: 'The rounded projection on the jawbone that forms the TMJ joint.' },
  'cusp': { codes: [], category: 'anatomy', description: 'The pointed or rounded projection on the chewing surface of a tooth.' },
  'dentin': { codes: [], category: 'anatomy', description: 'The hard layer of tooth structure located just beneath the enamel.' },
  'distal': { codes: [], category: 'anatomy', description: 'The surface of the tooth facing away from the center of the face.' },
  'enamel': { codes: [], category: 'anatomy', description: 'The hard, outer white layer of the tooth.' },
  'frenum': { codes: [], category: 'anatomy', description: 'A fold of tissue connecting the lip or tongue to the gum/jaw.' },
  'gingiva': { codes: [], category: 'anatomy', description: 'The gums.' },
  'incisor': { codes: [], category: 'anatomy', description: 'The front biting teeth (four upper, four lower).' },
  'labial': { codes: [], category: 'anatomy', description: 'The side of the tooth facing the lips.' },
  'lingual': { codes: [], category: 'anatomy', description: 'The side of the tooth facing the tongue.' },
  'mandible': { codes: [], category: 'anatomy', description: 'The lower jaw.' },
  'maxilla': { codes: [], category: 'anatomy', description: 'The upper jaw.' },
  'mesial': { codes: [], category: 'anatomy', description: 'The surface of the tooth facing toward the center of the face.' },
  'molar': { codes: [], category: 'anatomy', description: 'The large back teeth used for grinding.' },
  'occlusal': { codes: [], category: 'anatomy', description: 'The chewing surface of the back teeth.' },
  'periodontal ligament': { codes: [], category: 'anatomy', description: 'Tissue fibers that attach the tooth to the alveolar bone.' },
  'premolar': { codes: [], category: 'anatomy', description: 'The teeth located between the canines and molars.' },
  'bicuspid': { codes: [], category: 'anatomy', description: 'The teeth located between the canines and molars.' },
  'pulp': { codes: [], category: 'anatomy', description: 'The soft inner tissue of the tooth containing nerves and blood vessels.' },
  'root': { codes: [], category: 'anatomy', description: 'The part of the tooth embedded in the jawbone.' },
  'sulcus': { codes: [], category: 'anatomy', description: 'The pocket space between the tooth and the free gingiva.' },
  'temporomandibular joint': { codes: [], category: 'anatomy', description: 'The hinge connecting the lower jaw to the skull.' },
  'uvula': { codes: [], category: 'anatomy', description: 'The small fleshy piece of tissue hanging at the back of the throat.' },

  // --- I. Anatomy - Patient Terms ---
  'bone holding my tooth': { codes: [], category: 'anatomy', description: 'Alveolar bone - the bone that supports and surrounds the roots of the teeth.' },
  'tip of tooth root': { codes: [], category: 'anatomy', description: 'Apex - the very tip of the root of a tooth.' },
  'vampire tooth': { codes: [], category: 'anatomy', description: 'Canine/Cuspid - the pointed tooth located between the incisors and premolars.' },
  'covering on tooth root': { codes: [], category: 'anatomy', description: 'Cementum - the hard connective tissue covering the tooth root.' },
  'jaw hinge': { codes: [], category: 'anatomy', description: 'Condyle - the rounded projection on the jawbone that forms the TMJ joint.' },
  'white part of tooth': { codes: [], category: 'anatomy', description: 'Crown - the part of the tooth covered by enamel that is visible in the mouth.' },
  'pointy part of chewing tooth': { codes: [], category: 'anatomy', description: 'Cusp - the pointed or rounded projection on the chewing surface of a tooth.' },
  'layer under enamel': { codes: [], category: 'anatomy', description: 'Dentin - the hard layer of tooth structure located just beneath the enamel.' },
  'back side of tooth': { codes: [], category: 'anatomy', description: 'Distal - the surface of the tooth facing away from the center of the face.' },
  'hard white outer coating': { codes: [], category: 'anatomy', description: 'Enamel - the hard, outer white layer of the tooth.' },
  'skin connecting lip to gums': { codes: [], category: 'anatomy', description: 'Frenum - a fold of tissue connecting the lip or tongue to the gum/jaw.' },
  'gums': { codes: [], category: 'anatomy', description: 'Gingiva - the gums.' },
  'my gums': { codes: [], category: 'anatomy', description: 'Gingiva - the gums.' },
  'front teeth': { codes: [], category: 'anatomy', description: 'Incisor - the front biting teeth (four upper, four lower).' },
  'side touching lip': { codes: [], category: 'anatomy', description: 'Labial - the side of the tooth facing the lips.' },
  'side touching tongue': { codes: [], category: 'anatomy', description: 'Lingual - the side of the tooth facing the tongue.' },
  'lower jaw': { codes: [], category: 'anatomy', description: 'Mandible - the lower jaw.' },
  'upper jaw': { codes: [], category: 'anatomy', description: 'Maxilla - the upper jaw.' },
  'front side of tooth': { codes: [], category: 'anatomy', description: 'Mesial - the surface of the tooth facing toward the center of the face.' },
  'back chewing teeth': { codes: [], category: 'anatomy', description: 'Molar - the large back teeth used for grinding.' },
  'biting surface': { codes: [], category: 'anatomy', description: 'Occlusal - the chewing surface of the back teeth.' },
  'tissue holding tooth in socket': { codes: [], category: 'anatomy', description: 'Periodontal ligament - tissue fibers that attach the tooth to the alveolar bone.' },
  'teeth behind eye teeth': { codes: [], category: 'anatomy', description: 'Premolar/Bicuspid - the teeth located between the canines and molars.' },
  'nerve inside tooth': { codes: [], category: 'anatomy', description: 'Pulp - the soft inner tissue of the tooth containing nerves and blood vessels.' },
  'part of tooth under gum': { codes: [], category: 'anatomy', description: 'Root - the part of the tooth embedded in the jawbone.' },
  'pocket under gum line': { codes: [], category: 'anatomy', description: 'Sulcus - the pocket space between the tooth and the free gingiva.' },
  'jaw joint': { codes: [], category: 'anatomy', description: 'Temporomandibular joint (TMJ) - the hinge connecting the lower jaw to the skull.' },
  'where jaw clicks': { codes: [], category: 'anatomy', description: 'Temporomandibular joint (TMJ) - the hinge connecting the lower jaw to the skull.' },
  'punching bag in throat': { codes: [], category: 'anatomy', description: 'Uvula - the small fleshy piece of tissue hanging at the back of the throat.' },
  'last back teeth': { codes: [], category: 'anatomy', description: 'Wisdom tooth - the third molar, usually the last to erupt.' },

  // --- II. Conditions & Diseases - Formal Definitions ---
  'abscess': { codes: ['D7510', 'D7511'], category: 'conditions', description: 'A pocket of pus caused by a bacterial infection.' },
  'abrasion': { codes: [], category: 'conditions', description: 'Wear on a tooth caused by foreign objects (e.g., aggressive brushing).' },
  'attrition': { codes: [], category: 'conditions', description: 'Wear on a tooth caused by tooth-to-tooth contact.' },
  'calculus': { codes: [], category: 'conditions', description: 'Hardened plaque (also known as tartar).' },
  'tartar': { codes: [], category: 'conditions', description: 'Hardened plaque (also known as calculus).' },
  'caries': { codes: [], category: 'conditions', description: 'Tooth decay or cavities.' },
  'crossbite': { codes: [], category: 'conditions', description: 'When upper teeth fit inside lower teeth.' },
  'cyst': { codes: ['D7450', 'D7451'], category: 'conditions', description: 'A fluid-filled sac that can form in the jaw or soft tissue.' },
  'diastema': { codes: [], category: 'conditions', description: 'A space or gap between two teeth.' },
  'edentulous': { codes: [], category: 'conditions', description: 'Having no teeth.' },
  'gingivitis': { codes: [], category: 'conditions', description: 'Inflammation of the gums (early stage of gum disease).' },
  'halitosis': { codes: [], category: 'conditions', description: 'Bad breath.' },
  'hyperplasia': { codes: [], category: 'conditions', description: 'Overgrowth of gum tissue.' },
  'impacted tooth': { codes: [], category: 'conditions', description: 'A tooth blocked from erupting by bone or another tooth.' },
  'leukoplakia': { codes: [], category: 'conditions', description: 'White patches in the mouth that can be precancerous.' },
  'malocclusion': { codes: [], category: 'conditions', description: 'Misalignment of the teeth or jaws ("bad bite").' },
  'overbite': { codes: [], category: 'conditions', description: 'Vertical overlapping of upper teeth over lower teeth.' },
  'pericoronitis': { codes: [], category: 'conditions', description: 'Inflammation of the gum tissue around a partially erupted tooth.' },
  'periodontitis': { codes: [], category: 'conditions', description: 'Severe gum infection that damages soft tissue and bone.' },
  'plaque': { codes: [], category: 'conditions', description: 'A sticky film of bacteria that forms on teeth.' },
  'recession': { codes: [], category: 'conditions', description: 'The pulling away of gum tissue from the tooth.' },
  'thrush': { codes: [], category: 'conditions', description: 'A fungal infection of the mouth (candidiasis).' },
  'candidiasis': { codes: [], category: 'conditions', description: 'A fungal infection of the mouth (thrush).' },
  'xerostomia': { codes: [], category: 'conditions', description: 'Dry mouth caused by lack of saliva.' },

  // --- II. Conditions - Patient Terms ---
  'painful swollen bump with pus': { codes: ['D7510', 'D7511'], category: 'conditions', description: 'Abscess - a pocket of pus caused by a bacterial infection.' },
  'brushed too hard wore tooth down': { codes: [], category: 'conditions', description: 'Abrasion - wear on a tooth caused by foreign objects.' },
  'teeth wearing down from grinding': { codes: [], category: 'conditions', description: 'Attrition - wear on a tooth caused by tooth-to-tooth contact.' },
  'grind teeth at night': { codes: ['D9940', 'D9944'], category: 'conditions', description: 'Bruxism - the habitual grinding or clenching of teeth.' },
  'clench teeth': { codes: ['D9940', 'D9944'], category: 'conditions', description: 'Bruxism - the habitual grinding or clenching of teeth.' },
  'hard buildup on teeth': { codes: ['D4341', 'D4342'], category: 'conditions', description: 'Calculus/Tartar - hardened plaque.' },
  'cavity in tooth': { codes: ['D2391', 'D2392'], category: 'conditions', description: 'Caries - tooth decay or cavities.' },
  'bottom teeth outside top teeth': { codes: [], category: 'conditions', description: 'Crossbite - when upper teeth fit inside lower teeth.' },
  'fluid filled bump': { codes: ['D7450', 'D7451'], category: 'conditions', description: 'Cyst - a fluid-filled sac that can form in the jaw or soft tissue.' },
  'gap between front teeth': { codes: [], category: 'conditions', description: 'Diastema - a space or gap between two teeth.' },
  'intense pain where tooth pulled': { codes: ['D9930'], category: 'conditions', description: 'Dry socket - inflammation occurring after extraction if the blood clot is lost.' },
  'no teeth left': { codes: [], category: 'conditions', description: 'Edentulous - having no teeth.' },
  'teeth melting from acid': { codes: [], category: 'conditions', description: 'Erosion - chemical wearing away of enamel.' },
  'gums red and bleed when floss': { codes: [], category: 'conditions', description: 'Gingivitis - inflammation of the gums (early stage of gum disease).' },
  'bad breath': { codes: [], category: 'conditions', description: 'Halitosis - bad breath.' },
  'gums growing over teeth': { codes: [], category: 'conditions', description: 'Hyperplasia - overgrowth of gum tissue.' },
  'wisdom tooth stuck': { codes: ['D7220', 'D7230', 'D7240'], category: 'conditions', description: 'Impacted tooth - a tooth blocked from erupting by bone or another tooth.' },
  'white patch wont wipe off': { codes: [], category: 'conditions', description: 'Leukoplakia - white patches in the mouth that can be precancerous.' },
  'bite feels off': { codes: [], category: 'conditions', description: 'Malocclusion - misalignment of the teeth or jaws.' },
  'teeth are crooked': { codes: [], category: 'conditions', description: 'Malocclusion - misalignment of the teeth or jaws.' },
  'top teeth stick out over bottom': { codes: [], category: 'conditions', description: 'Overbite - vertical overlapping of upper teeth over lower teeth.' },
  'gum over wisdom tooth infected': { codes: [], category: 'conditions', description: 'Pericoronitis - inflammation of the gum tissue around a partially erupted tooth.' },
  'bone loss': { codes: ['D4341', 'D4342', 'D4910'], category: 'conditions', description: 'Periodontitis - severe gum infection that damages soft tissue and bone.' },
  'fuzzy white stuff on teeth': { codes: [], category: 'conditions', description: 'Plaque - a sticky film of bacteria that forms on teeth.' },
  'gums pulling back exposing root': { codes: ['D4270', 'D4273'], category: 'conditions', description: 'Recession - the pulling away of gum tissue from the tooth.' },
  'tooth hurts cold water': { codes: ['D9910', 'D9911'], category: 'conditions', description: 'Sensitivity - sharp pain caused by hot, cold, or sweet stimuli.' },
  'white fungal infection in mouth': { codes: [], category: 'conditions', description: 'Thrush (Candidiasis) - a fungal infection of the mouth.' },
  'mouth always dry': { codes: [], category: 'conditions', description: 'Xerostomia - dry mouth caused by lack of saliva.' },

  // --- III. Procedures & Treatments - Formal Definitions ---
  'bone graft definition': { codes: ['D7950', 'D7953'], category: 'procedures', description: 'Adding bone material to the jaw to build up volume (often for implants).' },
  'fluoride treatment definition': { codes: ['D1206', 'D1208'], category: 'procedures', description: 'Application of fluoride to strengthen enamel.' },
  'osseointegration': { codes: [], category: 'procedures', description: 'The process where bone fuses with a dental implant.' },
  'root planing definition': { codes: ['D4341', 'D4342'], category: 'procedures', description: 'Deep cleaning to smooth the root surface below the gumline.' },
  'scaling definition': { codes: ['D4341', 'D4342'], category: 'procedures', description: 'Removal of plaque and calculus from teeth.' },
  'sealant definition': { codes: ['D1351'], category: 'procedures', description: 'A plastic coating applied to chewing surfaces to prevent decay.' },
  'whitening definition': { codes: ['D9972', 'D9975'], category: 'procedures', description: 'Chemical process to lighten the color of teeth.' },

  // --- III. Procedures - Patient Terms ---
  'surgery to remove infected root tip': { codes: ['D3410', 'D3421', 'D3425'], category: 'procedures', description: 'Apicoectomy - surgical removal of the tip of a tooth root.' },
  'taking sample to test for cancer': { codes: ['D0472', 'D0473', 'D0474'], category: 'procedures', description: 'Biopsy - removal of tissue for microscopic examination.' },
  'fixing chip with tooth colored material': { codes: ['D2330', 'D2331', 'D2335'], category: 'procedures', description: 'Bonding - applying composite resin to repair or reshape a tooth.' },
  'adding bone for implant': { codes: ['D7950', 'D7953'], category: 'procedures', description: 'Bone graft - adding bone material to the jaw to build up volume.' },
  'pulling a tooth': { codes: ['D7140', 'D7210'], category: 'procedures', description: 'Extraction - removal of a tooth.' },
  'varnish treatment prevent cavities': { codes: ['D1206'], category: 'procedures', description: 'Fluoride treatment - application of fluoride to strengthen enamel.' },
  'clipping tongue tie': { codes: ['D7960'], category: 'procedures', description: 'Frenectomy - surgical removal or loosening of the frenum.' },
  'trimming gums back': { codes: ['D4210', 'D4211'], category: 'procedures', description: 'Gingivectomy - surgical removal of gum tissue.' },
  'implant fusing to bone': { codes: [], category: 'procedures', description: 'Osseointegration - the process where bone fuses with a dental implant.' },
  'regular cleaning definition': { codes: ['D1110', 'D1120'], category: 'procedures', description: 'Prophylaxis - a professional dental cleaning.' },
  'baby root canal definition': { codes: ['D3221'], category: 'procedures', description: 'Pulpectomy - complete removal of the pulp.' },
  'removing part of nerve': { codes: ['D3220'], category: 'procedures', description: 'Pulpotomy - partial removal of the pulp.' },
  'removing dead nerve save tooth': { codes: ['D3310', 'D3320', 'D3330'], category: 'procedures', description: 'Root canal therapy - removing infected pulp and sealing the root.' },
  'deep cleaning under gums': { codes: ['D4341', 'D4342'], category: 'procedures', description: 'Root planing - deep cleaning to smooth the root surface below the gumline.' },
  'scraping tartar off': { codes: ['D4341', 'D4342'], category: 'procedures', description: 'Scaling - removal of plaque and calculus from teeth.' },
  'protective coating for grooves of teeth': { codes: ['D1351'], category: 'procedures', description: 'Sealant - a plastic coating applied to chewing surfaces to prevent decay.' },
  'lifting sinus for implant': { codes: ['D7951', 'D7952'], category: 'procedures', description: 'Sinus lift - surgery to add bone to the upper jaw near the molars/sinus.' },
  'bleaching my teeth': { codes: ['D9972', 'D9975'], category: 'procedures', description: 'Whitening - chemical process to lighten the color of teeth.' },

  // --- IV. Restorations & Prosthetics - Formal Definitions ---
  'abutment definition': { codes: ['D6056', 'D6057'], category: 'restorations', description: 'A connector on an implant or tooth that supports a crown or bridge.' },
  'amalgam definition': { codes: ['D2140', 'D2150', 'D2160'], category: 'restorations', description: 'A silver-colored filling material.' },
  'bridge definition': { codes: ['D6210', 'D6750'], category: 'restorations', description: 'A fixed prosthetic replacing missing teeth by anchoring to neighbors.' },
  'composite definition': { codes: ['D2330', 'D2391'], category: 'restorations', description: 'A tooth-colored resin filling material.' },
  'crown definition': { codes: ['D2740', 'D2750'], category: 'restorations', description: 'A cover that restores the shape and strength of a damaged tooth.' },
  'denture definition': { codes: ['D5110', 'D5120'], category: 'restorations', description: 'Removable appliance replacing all teeth in an arch.' },
  'flipper definition': { codes: ['D5820', 'D5821'], category: 'restorations', description: 'A temporary removable partial denture.' },
  'implant definition': { codes: ['D6010'], category: 'restorations', description: 'A titanium screw placed in the bone to replace a tooth root.' },
  'inlay definition': { codes: ['D2610', 'D2620'], category: 'restorations', description: 'A custom filling made outside the mouth and cemented inside the cusp.' },
  'onlay definition': { codes: ['D2662', 'D2663'], category: 'restorations', description: 'Similar to an inlay but covers one or more cusps.' },
  'partial denture definition': { codes: ['D5211', 'D5213'], category: 'restorations', description: 'Removable appliance replacing a few missing teeth.' },
  'pontic definition': { codes: ['D6205', 'D6210'], category: 'restorations', description: 'The artificial tooth suspended in a bridge.' },
  'post and core definition': { codes: ['D2952', 'D2954'], category: 'restorations', description: 'A rod placed in a root canal to strengthen the tooth for a crown.' },
  'provisional definition': { codes: ['D2799'], category: 'restorations', description: 'A temporary crown or bridge worn while the permanent one is made.' },
  'veneer definition': { codes: ['D2960', 'D2962'], category: 'restorations', description: 'A thin shell (porcelain) bonded to the front of a tooth.' },

  // --- IV. Restorations - Patient Terms ---
  'connector piece for implant': { codes: ['D6056', 'D6057'], category: 'restorations', description: 'Abutment - a connector on an implant or tooth that supports a crown or bridge.' },
  'silver fillings': { codes: ['D2140', 'D2150', 'D2160'], category: 'restorations', description: 'Amalgam - a silver-colored filling material.' },
  'fake teeth connected to side teeth': { codes: ['D6210', 'D6750'], category: 'restorations', description: 'Bridge - a fixed prosthetic replacing missing teeth by anchoring to neighbors.' },
  'white fillings': { codes: ['D2330', 'D2391'], category: 'restorations', description: 'Composite - a tooth-colored resin filling material.' },
  'my false teeth': { codes: ['D5110', 'D5120'], category: 'restorations', description: 'Denture - removable appliance replacing all teeth in an arch.' },
  'my plates': { codes: ['D5110', 'D5120'], category: 'restorations', description: 'Denture - removable appliance replacing all teeth in an arch.' },
  'temporary retainer with fake tooth': { codes: ['D5820', 'D5821'], category: 'restorations', description: 'Flipper - a temporary removable partial denture.' },
  'screw in tooth': { codes: ['D6010'], category: 'restorations', description: 'Implant - a titanium screw placed in the bone to replace a tooth root.' },
  'custom porcelain filling': { codes: ['D2610', 'D2620'], category: 'restorations', description: 'Inlay - a custom filling made outside the mouth and cemented inside the cusp.' },
  'partial crown': { codes: ['D2662', 'D2663'], category: 'restorations', description: 'Onlay - similar to an inlay but covers one or more cusps.' },
  'removable bridge': { codes: ['D5211', 'D5213'], category: 'restorations', description: 'Partial denture - removable appliance replacing a few missing teeth.' },
  'fake tooth part of bridge': { codes: ['D6205', 'D6210'], category: 'restorations', description: 'Pontic - the artificial tooth suspended in a bridge.' },
  'pin in root canal hold crown': { codes: ['D2952', 'D2954'], category: 'restorations', description: 'Post and core - a rod placed in a root canal to strengthen the tooth for a crown.' },
  'temporary cap': { codes: ['D2799'], category: 'restorations', description: 'Provisional - a temporary crown or bridge worn while the permanent one is made.' },
  'porcelain facings glued to front': { codes: ['D2960', 'D2962'], category: 'restorations', description: 'Veneer - a thin shell (porcelain) bonded to the front of a tooth.' },

  // --- V. Orthodontics - Formal Definitions ---
  'aligner definition': { codes: ['D8090'], category: 'orthodontics', description: 'Clear, removable trays used to straighten teeth (e.g., Invisalign).' },
  'archwire': { codes: [], category: 'orthodontics', description: 'The wire connecting brackets that guides tooth movement.' },
  'bracket definition': { codes: [], category: 'orthodontics', description: 'The metal or ceramic piece bonded to the tooth to hold the wire.' },
  'ligature': { codes: [], category: 'orthodontics', description: 'Small rubber band or wire holding the archwire to the bracket.' },
  'palatal expander definition': { codes: ['D8210', 'D8220'], category: 'orthodontics', description: 'Device used to widen the upper jaw.' },
  'retainer definition': { codes: ['D8680'], category: 'orthodontics', description: 'Appliance worn to maintain teeth position after braces.' },
  'space maintainer definition': { codes: ['D1510', 'D1520'], category: 'orthodontics', description: 'Appliance holding space open for a permanent tooth.' },

  // --- V. Orthodontics - Patient Terms ---
  'clear trays': { codes: ['D8090'], category: 'orthodontics', description: 'Aligner - clear, removable trays used to straighten teeth (e.g., Invisalign).' },
  'wire running across braces': { codes: [], category: 'orthodontics', description: 'Archwire - the wire connecting brackets that guides tooth movement.' },
  'metal square glued to tooth': { codes: [], category: 'orthodontics', description: 'Bracket - the metal or ceramic piece bonded to the tooth to hold the wire.' },
  'colored rubber bands': { codes: [], category: 'orthodontics', description: 'Ligature - small rubber band or wire holding the archwire to the bracket.' },
  'crank device to widen jaw': { codes: ['D8210', 'D8220'], category: 'orthodontics', description: 'Palatal expander - device used to widen the upper jaw.' },
  'plastic guard wear at night': { codes: ['D8680'], category: 'orthodontics', description: 'Retainer - appliance worn to maintain teeth position after braces.' },
  'loop holding space for adult tooth': { codes: ['D1510', 'D1520'], category: 'orthodontics', description: 'Space maintainer - appliance holding space open for a permanent tooth.' },

  // --- VI. Tools & Diagnostics - Formal Definitions ---
  'autoclave': { codes: [], category: 'tools', description: 'Machine used to sterilize dental instruments.' },
  'bur': { codes: [], category: 'tools', description: 'The drill bit used in the dental handpiece.' },
  'explorer': { codes: [], category: 'tools', description: 'Hook-like instrument used to check for decay/cavities.' },
  'handpiece': { codes: [], category: 'tools', description: 'The dental drill.' },
  'impression definition': { codes: ['D0470'], category: 'tools', description: 'A mold taken of the teeth or gums.' },
  'radiograph definition': { codes: ['D0210', 'D0220'], category: 'tools', description: 'A dental X-ray.' },

};

/**
 * Map procedure name/description to CDT codes
 */
function mapProcedureToCode(procedureName: string): { codes: string[]; category: string; description: string } | null {
  const normalized = procedureName.toLowerCase().trim();

  // Direct match
  if (PROCEDURE_NAME_TO_CODES[normalized]) {
    return PROCEDURE_NAME_TO_CODES[normalized];
  }

  // Partial match
  for (const [key, value] of Object.entries(PROCEDURE_NAME_TO_CODES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  // Check if it's already a CDT code (starts with D followed by digits)
  if (/^[dD]\d{4}$/.test(normalized)) {
    return { codes: [normalized.toUpperCase()], category: 'unknown', description: normalized.toUpperCase() };
  }

  return null;
}

// ========================================================================
// TREATMENT COST ESTIMATOR
// ========================================================================

/**
 * Estimate treatment cost combining insurance coverage and fee schedule
 * This is the comprehensive tool that answers "Will my insurance cover X and how much will it cost?"
 */
async function estimateTreatmentCost(
  params: Record<string, any>,
  clinicId?: string,
  odClient?: OpenDentalClient
): Promise<{ statusCode: number; body: any }> {
  const {
    // Insurance identification
    insuranceName,
    groupName,
    groupNumber,
    // Treatment/procedure
    procedure,
    procedureName,
    procCode,
    // Patient info (optional - for balance lookup)
    PatNum,
    LName,
    FName,
    Birthdate,
    // Fee schedule (optional - defaults to insurance fee schedule or UCR)
    feeSchedule,
  } = params;

  const searchClinicId = clinicId || params.clinicId;
  const treatmentName = procedure || procedureName || procCode;

  if (!treatmentName) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: 'Please specify the treatment/procedure you want to check (e.g., "crown", "fluoride", "cleaning", or a CDT code like "D2740")',
        examples: Object.keys(PROCEDURE_NAME_TO_CODES).slice(0, 20),
      },
    };
  }

  // Map procedure name to codes
  const procedureMapping = mapProcedureToCode(treatmentName);
  if (!procedureMapping) {
    return {
      statusCode: 400,
      body: {
        status: 'FAILURE',
        message: `Could not identify procedure "${treatmentName}". Please use a common name or CDT code.`,
        examples: ['crown', 'fluoride', 'cleaning', 'root canal', 'filling', 'D2740'],
      },
    };
  }

  let directAnswer = `=== TREATMENT COST ESTIMATE ===\n`;
  directAnswer += `Treatment: ${procedureMapping.description}\n`;
  directAnswer += `CDT Code(s): ${procedureMapping.codes.join(', ')}\n`;
  directAnswer += `Category: ${procedureMapping.category.toUpperCase()}\n\n`;

  // Step 1: Look up insurance coverage
  let insurancePlan: InsurancePlanRecord | null = null;
  let coveragePercent: number | null = null;

  if (insuranceName || groupName || groupNumber) {
    const insuranceResult = await lookupInsurancePlanBenefits(
      { insuranceName, groupName, groupNumber },
      searchClinicId
    );

    if (insuranceResult.statusCode === 200 && insuranceResult.body.data?.plans?.length > 0) {
      insurancePlan = insuranceResult.body.data.plans[0] as InsurancePlanRecord;

      // Get coverage percentage based on category
      switch (procedureMapping.category) {
        case 'preventive':
        case 'diagnostic':
          coveragePercent = insurancePlan.preventiveRoutinePreventivePct ??
            insurancePlan.preventiveDiagnosticsPct ??
            insurancePlan.preventiveXRaysPct;
          break;
        case 'basic':
          coveragePercent = insurancePlan.basicRestorativePct;
          break;
        case 'endo':
          coveragePercent = insurancePlan.basicEndoPct ?? insurancePlan.basicRestorativePct;
          break;
        case 'perio':
          coveragePercent = insurancePlan.basicPerioPct ?? insurancePlan.basicRestorativePct;
          break;
        case 'surgery':
          coveragePercent = insurancePlan.basicOralSurgeryPct ?? insurancePlan.basicRestorativePct;
          break;
        case 'major':
          coveragePercent = insurancePlan.majorCrownsPct ?? insurancePlan.majorProsthodonticsPct;
          break;
        case 'ortho':
          coveragePercent = insurancePlan.orthoPct;
          break;
      }

      // Normalize coverage percent (handle both 0.8 and 80 formats)
      if (coveragePercent !== null && coveragePercent !== undefined) {
        coveragePercent = coveragePercent > 1 ? coveragePercent : coveragePercent * 100;
      }

      directAnswer += `=== INSURANCE COVERAGE ===\n`;
      directAnswer += `Plan: ${insurancePlan.insuranceName} - ${insurancePlan.groupName || 'Unknown Group'}\n`;
      if (insurancePlan.groupNumber) directAnswer += `Group #: ${insurancePlan.groupNumber}\n`;

      if (coveragePercent !== null) {
        directAnswer += `Coverage for ${procedureMapping.category}: ${Math.round(coveragePercent)}%\n`;
        directAnswer += `You pay: ${Math.round(100 - coveragePercent)}%\n`;
      } else {
        directAnswer += `Coverage for ${procedureMapping.category}: Not specifically recorded\n`;
      }

      if (insurancePlan.deductibleIndividual) {
        directAnswer += `Deductible: $${insurancePlan.deductibleIndividual} (may apply)\n`;
      }
      if (insurancePlan.annualMaxIndividual) {
        directAnswer += `Annual Max: $${insurancePlan.annualMaxIndividual}\n`;
      }

      // Check for waiting periods
      if (insurancePlan.waitingPeriods) {
        const relevantWaiting = insurancePlan.waitingPeriods
          .toLowerCase()
          .includes(procedureMapping.category);
        if (relevantWaiting) {
          directAnswer += `⚠️ Waiting Period may apply: ${insurancePlan.waitingPeriods}\n`;
        }
      }

      // Check for frequency limits (especially for fluoride, cleanings)
      if (insurancePlan.frequencyLimits &&
        (procedureMapping.category === 'preventive' || treatmentName.toLowerCase().includes('fluoride'))) {
        directAnswer += `📋 Frequency Limits: ${insurancePlan.frequencyLimits}\n`;
      }

      // Check for age limits (especially for fluoride, sealants)
      if (insurancePlan.ageLimits &&
        (treatmentName.toLowerCase().includes('fluoride') || treatmentName.toLowerCase().includes('sealant'))) {
        directAnswer += `👤 Age Limits: ${insurancePlan.ageLimits}\n`;
      }

      directAnswer += `\n`;
    } else {
      directAnswer += `⚠️ INSURANCE: Could not find plan details for "${insuranceName || groupName || groupNumber}"\n\n`;
    }
  } else {
    directAnswer += `ℹ️ No insurance info provided - showing fee only\n\n`;
  }

  // Step 2: Look up fees for the procedure codes
  directAnswer += `=== FEE SCHEDULE ===\n`;

  const feesByCode: Record<string, number | null> = {};
  let primaryFee: number | null = null;
  let usedFeeSchedule: string | null = null;

  for (const code of procedureMapping.codes) {
    const feeResult = await lookupFeeSchedules(
      {
        procCode: code,
        feeSchedule: feeSchedule || insurancePlan?.feeSchedule,
        clinicId: searchClinicId
      },
      searchClinicId
    );

    if (feeResult.statusCode === 200 && feeResult.body.data?.fees?.length > 0) {
      const fees = feeResult.body.data.fees as FeeScheduleRecord[];
      // Use the first matching fee (preferring the insurance fee schedule if available)
      const matchingFee = insurancePlan?.feeSchedule
        ? fees.find(f => f.feeSchedule === insurancePlan.feeSchedule) || fees[0]
        : fees[0];

      feesByCode[code] = matchingFee.amount;
      if (primaryFee === null && matchingFee.amount !== null) {
        primaryFee = matchingFee.amount;
        usedFeeSchedule = matchingFee.feeSchedule;
      }

      directAnswer += `${code} (${matchingFee.description || matchingFee.abbrDesc}): `;
      directAnswer += matchingFee.amount !== null ? `$${matchingFee.amount.toFixed(2)}` : 'Not set';
      directAnswer += ` [${matchingFee.feeSchedule}]\n`;
    }
  }

  if (primaryFee === null) {
    directAnswer += `Fee information not found for these procedure codes\n`;
  }
  directAnswer += `\n`;

  // Step 3: Calculate estimated patient cost
  if (primaryFee !== null && coveragePercent !== null) {
    const insurancePays = primaryFee * (coveragePercent / 100);
    const patientPays = primaryFee - insurancePays;
    const deductible = insurancePlan?.deductibleIndividual || 0;

    directAnswer += `=== ESTIMATED COST ===\n`;
    directAnswer += `Total Fee: $${primaryFee.toFixed(2)}\n`;
    directAnswer += `Insurance Pays (${Math.round(coveragePercent)}%): $${insurancePays.toFixed(2)}\n`;
    directAnswer += `Your Estimated Cost: $${patientPays.toFixed(2)}\n`;

    if (deductible > 0) {
      directAnswer += `\n⚠️ Note: If deductible ($${deductible}) hasn't been met, add that to your cost.\n`;
      directAnswer += `Maximum out-of-pocket with deductible: $${(patientPays + deductible).toFixed(2)}\n`;
    }
  } else if (primaryFee !== null) {
    directAnswer += `=== ESTIMATED COST ===\n`;
    directAnswer += `Total Fee: $${primaryFee.toFixed(2)}\n`;
    directAnswer += `(Insurance coverage not determined - this would be your full cost without insurance)\n`;
  }

  // Step 4: If patient info provided, look up their balance
  let patientBalance: number | null = null;
  let patientInfo: any = null;

  if (PatNum && odClient) {
    try {
      const balanceResult = await odClient.request('GET', `accountmodules/${PatNum}/Aging`);
      if (balanceResult) {
        patientBalance = balanceResult.BalTotal || balanceResult.Bal_0_30 || 0;
        directAnswer += `\n=== PATIENT ACCOUNT ===\n`;
        directAnswer += `Current Balance: $${(patientBalance ?? 0).toFixed(2)}\n`;
      }
    } catch (e) {
      // Patient balance lookup optional
    }
  } else if (LName && FName && Birthdate && odClient) {
    directAnswer += `\n=== PATIENT VERIFICATION ===\n`;
    directAnswer += `To look up your account balance, I'll need to verify your identity.\n`;
    directAnswer += `Searching for: ${FName} ${LName}, DOB: ${Birthdate}\n`;
  }

  directAnswer += `\n─────────────────────────────────────\n`;
  directAnswer += `This is an ESTIMATE. Actual costs may vary based on:\n`;
  directAnswer += `• Whether your deductible has been met\n`;
  directAnswer += `• Remaining annual maximum\n`;
  directAnswer += `• Specific plan exclusions or limitations\n`;
  directAnswer += `• Treatment complexity\n`;

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      message: `Treatment cost estimate for ${procedureMapping.description}`,
      directAnswer,
      data: {
        procedure: procedureMapping,
        insurance: insurancePlan ? {
          name: insurancePlan.insuranceName,
          groupName: insurancePlan.groupName,
          groupNumber: insurancePlan.groupNumber,
          coveragePercent,
          deductible: insurancePlan.deductibleIndividual,
          annualMax: insurancePlan.annualMaxIndividual,
        } : null,
        fees: feesByCode,
        primaryFee,
        feeSchedule: usedFeeSchedule,
        estimatedPatientCost: primaryFee && coveragePercent
          ? primaryFee * ((100 - coveragePercent) / 100)
          : primaryFee,
        patientBalance,
      },
    },
  };
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: ActionGroupEvent): Promise<ActionGroupResponse> => {
  console.log('Action Group Event:', JSON.stringify(event, null, 2));

  // Global try-catch to ensure we always return a valid ActionGroupResponse
  // Bedrock throws DependencyFailedException if the Lambda throws an unhandled exception
  try {
    // Extract tool name from apiPath or parameters
    // The apiPath may contain a template like "/open-dental/{toolName}" 
    // In that case, the actual tool name is in the parameters array
    let toolName = event.apiPath.replace(/^\//, '');

    // Handle proxy pattern: /open-dental/{toolName} or /open-dental/searchPatients
    if (toolName.startsWith('open-dental/')) {
      toolName = toolName.replace('open-dental/', '');
    }

    // If toolName is still a template placeholder like "{toolName}", extract from parameters
    if (toolName === '{toolName}' || toolName.includes('{')) {
      const toolNameParam = event.parameters?.find((p: { name: string; value: string }) => p.name === 'toolName');
      if (toolNameParam?.value) {
        toolName = toolNameParam.value;
      }
    }

    // Parse request parameters/body
    const params = parseParameters(event);

    // Robust fallback: Bedrock sometimes calls "/open-dental/{toolName}" without providing the
    // required toolName parameter. In that case, infer the intended tool from the request body.
    const ALLOWED_TOOL_NAMES = new Set<string>([
      'searchPatients',
      'createPatient',
      'getPatientByPatNum',
      'getProcedureLogs',
      'getTreatmentPlans',
      // TreatPlans Tools
      'TreatPlans GET',
      'TreatPlans POST (create)',
      'TreatPlans POST Saved',
      'TreatPlans PUT (update)',
      'TreatPlans DELETE',
      // TreatPlanAttaches Tools
      'getTreatPlanAttaches',
      'createTreatPlanAttach',
      'updateTreatPlanAttach',
      // PatPlans Tools
      'getPatPlans',
      'createPatPlan',
      'updatePatPlan',
      'deletePatPlan',
      // Payments Tools
      'getPayments',
      'createPayment',
      'createPaymentRefund',
      'updatePayment',
      'updatePaymentPartial',
      // PayPlanCharges Tools
      'getPayPlanCharges',
      // PayPlans Tools
      'getPayPlan',
      'getPayPlans',
      'createPayPlanDynamic',
      'createPayPlan',
      'closePayPlan',
      'updatePayPlanDynamic',
      // PaySplits Tools
      'getPaySplits',
      'updatePaySplit',
      // PerioExams Tools
      'getPerioExam',
      'getPerioExams',
      'createPerioExam',
      'updatePerioExam',
      'deletePerioExam',
      // Pharmacies Tools
      'getPharmacy',
      'getPharmacies',
      // PerioMeasures Tools
      'getPerioMeasures',
      'createPerioMeasure',
      'updatePerioMeasure',
      'deletePerioMeasure',
      // Popups Tools
      'getPopups',
      'createPopup',
      'updatePopup',
      // Preferences Tools
      'getPreferences',
      // ProcedureCodes Tools
      'getProcedureCode',
      'getProcedureCodes',
      'createProcedureCode',
      'updateProcedureCode',
      // ProcedureLogs Tools
      'getProcedureLog',
      'getProcedureLogs',
      'getProcedureLogsInsuranceHistory',
      'getProcedureLogsGroupNotes',
      'createProcedureLog',
      'createProcedureLogGroupNote',
      'createProcedureLogInsuranceHistory',
      'updateProcedureLog',
      'updateProcedureLogGroupNote',
      'deleteProcedureLog',
      'deleteProcedureLogGroupNote',
      // Providers Tools
      'Providers GET (single)',
      'Providers GET (multiple)',
      'Providers POST (create)',
      'Providers PUT (update)',
      // Recalls Tools
      'Recalls GET',
      'Recalls GET List',
      'Recalls POST (create)',
      'Recalls PUT (update)',
      'Recalls PUT Status',
      'Recalls PUT SwitchType',
      // RxPats Tools
      'RxPats GET (single)',
      'RxPats GET (multiple)',
      // Referrals Tools
      'Referrals GET (single)',
      'Referrals GET (multiple)',
      'Referrals POST (create)',
      'Referrals PUT (update)',
      // RecallTypes Tools
      'RecallTypes GET (single)',
      'RecallTypes GET (multiple)',
      // QuickPasteNotes Tools
      'QuickPasteNotes GET (single)',
      'QuickPasteNotes GET (multiple)',
      // ProcNotes Tools
      'getProcNotes',
      'createProcNote',
      // ProcTPs Tools
      'getProcTPs',
      'updateProcTP',
      'deleteProcTP',
      'scheduleAppointment',
      'getUpcomingAppointments',
      'rescheduleAppointment',
      'cancelAppointment',
      // Appointments Tools (API-named)
      'Appointments GET (single)',
      'Appointments GET (multiple)',
      'Appointments GET ASAP',
      'Appointments GET Slots',
      'Appointments GET SlotsWebSched',
      'Appointments GET WebSched',
      'Appointments POST (create)',
      'Appointments POST Planned',
      'Appointments POST SchedulePlanned',
      'Appointments POST WebSched',
      'Appointments PUT (update)',
      'Appointments PUT Break',
      'Appointments PUT Note',
      'Appointments PUT Confirm',
      // ScheduleOps Tools
      'ScheduleOps GET',
      // Schedules Tools
      'Schedules GET (single)',
      'Schedules GET (multiple)',
      // SecurityLogs Tools
      'SecurityLogs GET',
      // SheetDefs Tools
      'SheetDefs GET (single)',
      'SheetDefs GET (multiple)',
      'getAccountAging',
      'getPatientBalances',
      'getServiceDateView',
      'getPatientAccountSummary', // Comprehensive account summary
      'getAllergies',
      'getPatientInfo',
      'getPatientRaces',
      'getBenefits',
      'getCarriers',
      'getClaims',
      'getFamilyInsurance',
      'getInsurancePlanBenefits',
      'suggestInsuranceCoverage',
      // InsPlans Tools
      'getInsPlan',
      'getInsPlans',
      'createInsPlan',
      'updateInsPlan',
      // SubstitutionLinks Tools
      'getSubstitutionLinks',
      'createSubstitutionLink',
      'updateSubstitutionLink',
      'deleteSubstitutionLink',
      // InsSubs Tools
      'getInsSub',
      'getInsSubs',
      'createInsSub',
      'updateInsSub',
      'deleteInsSub',
      // InsVerifies Tools
      'getInsVerify',
      'getInsVerifies',
      'updateInsVerify',
      // Fee Schedule Tools
      'getFeeSchedules',
      'getFeeForProcedure',
      'getFeeScheduleAmounts', // Alias for getFeeForProcedure
      'listFeeSchedules',
      'compareProcedureFees',
      // Insurance Details & Cost Estimation
      'getInsuranceDetails', // Comprehensive: deductibles, maximums, waiting periods, limits, exclusions
      'getDeductibleInfo', // Detailed deductible questions
      'checkDeductible', // Alias
      'deductibleStatus', // Alias
      'getAnnualMaxInfo', // Annual max and remaining benefits
      'checkAnnualMax', // Alias
      'getRemainingBenefits', // Alias
      'annualMaximum', // Alias
      'checkProcedureCoverage', // Is X covered? Direct answer
      'isProcedureCovered', // Alias
      'getCoverageBreakdown', // Percentages, downgrades, implants, perio vs cleaning, in/out network
      'coverageDetails', // Alias
      'getCopayAndFrequencyInfo', // Copays, coinsurance, frequency limits
      'getFrequencyLimits', // Alias - how many cleanings/x-rays per year
      'copayInfo', // Alias
      'getWaitingPeriodInfo', // Waiting periods, exclusions, missing tooth clause
      'waitingPeriods', // Alias
      'getExclusions', // Alias
      'getEstimateExplanation', // Why estimates change, balance billing, sedation
      'estimateAccuracy', // Alias
      'whyPriceChanges', // Alias
      'getCoordinationOfBenefits', // Dual insurance, primary/secondary, COB
      'dualInsurance', // Alias
      'secondaryInsurance', // Alias
      // Statements Tools
      'getStatement',
      'getStatements',
      'createStatement',
      'whichInsuranceIsPrimary', // Alias
      'getPaymentInfo', // Payment timing, plans, financing, HSA/FSA
      'paymentOptions', // Alias
      'paymentPlans', // Alias
      'financing', // Alias
      'checkCoverage', // Alias
      'calculateOutOfPocket', // What will I pay for this procedure?
      'estimateTreatmentCost', // Combines insurance + fees
      'getHistAppointments', // Historical appointment changes
      // LabCases Tools
      'getLabCase',
      'getLabCases',
      'createLabCase',
      'updateLabCase',
      'deleteLabCase',
      // Laboratories Tools
      'getLaboratory',
      'getLaboratories',
      'createLaboratory',
      'updateLaboratory',
      // MedicationPats Tools
      'getMedicationPat',
      'getMedicationPats',
      'createMedicationPat',
      'updateMedicationPat',
      'deleteMedicationPat',
      // Medications Tools
      'getMedications',
      'createMedication',
      // LabTurnarounds Tools
      'getLabTurnaround',
      'getLabTurnarounds',
      'createLabTurnaround',
      'updateLabTurnaround',
      // Operatories Tools
      'getOperatory',
      'getOperatories',
      // PatFieldDefs Tools
      'getPatFieldDefs',
      'createPatFieldDef',
      'updatePatFieldDef',
      'deletePatFieldDef',
      // PatFields Tools
      'getPatField',
      'getPatFields',
      'createPatField',
      'updatePatField',
      'deletePatField',
      // PatientNotes Tools
      'getPatientNote',
      'getPatientNotes',
      'updatePatientNote',
      // Sheets Tools
      'getSheets',
      'createSheet',
      'downloadSheetSftp',
      // SheetFields Tools
      'getSheetField',
      'getSheetFields',
      'updateSheetField',
      // Signalods Tools
      'getSignalods',
      // Subscriptions Tools
      'createSubscription',
      'getSubscriptions',
      'updateSubscription',
      'deleteSubscription',
      // TaskLists Tools
      'TaskLists GET',
      // TaskNotes Tools
      'TaskNotes GET (single)',
      'TaskNotes GET (multiple)',
      'TaskNotes POST (create)',
      'TaskNotes PUT (update)',
      // Tasks Tools
      'Tasks GET (single)',
      'Tasks GET (multiple)',
      'Tasks POST (create)',
      'Tasks PUT (update)',
      // UserGroups Tools
      'UserGroups GET',
      // UserGroupAttaches Tools
      'UserGroupAttaches GET',
      // Userods Tools
      'Userods GET',
      'Userods POST (create)',
      'Userods PUT (update)',
      // ToothInitials Tools
      'ToothInitials GET',
      'ToothInitials POST (create)',
      'ToothInitials DELETE',
      // RefAttaches Tools
      'RefAttaches GET',
      'RefAttaches POST (create)',
      'RefAttaches PUT (update)',
      'RefAttaches DELETE',
      // Reports Tools
      'Reports GET Aging',
      'Reports GET FinanceCharges',
    ]);

    if (!ALLOWED_TOOL_NAMES.has(toolName)) {
      let inferredToolName: string | null = null;

      // Treatment cost estimate (combines insurance + fees + optional patient lookup)
      // Detected when: procedure/treatment name + insurance info
      if ((params.procedure || params.procedureName) &&
        (params.insuranceName || params.groupNumber || params.groupName)) {
        inferredToolName = 'estimateTreatmentCost';
      }

      // Insurance coverage questions (NO PatNum needed)
      if (!inferredToolName && (params.insuranceName || params.groupNumber || params.groupName)) {
        inferredToolName = 'suggestInsuranceCoverage';
      }

      // Fee schedule questions
      if (!inferredToolName && (params.procCode || params.procedureCode)) {
        // If asking about a specific procedure fee
        inferredToolName = 'getFeeForProcedure';
      } else if (!inferredToolName && (params.feeSchedule || params.feeScheduleName || params.feeSchedNum)) {
        // If asking about fee schedules
        inferredToolName = 'getFeeSchedules';
      }

      // Patient lookup (best-effort)
      if (!inferredToolName && params.LName && params.FName && params.Birthdate) {
        inferredToolName = 'searchPatients';
      }

      if (inferredToolName) {
        console.warn(
          `[ActionGroup] toolName missing/invalid ("${toolName}") for apiPath "${event.apiPath}". ` +
          `Inferred tool "${inferredToolName}" from request parameters.`
        );
        toolName = inferredToolName;
      }
    }

    console.log(`[ActionGroup] Executing tool: ${toolName}`);

    // Get clinic ID from session attributes
    const clinicId = event.sessionAttributes?.clinicId || event.promptSessionAttributes?.clinicId;
    if (!clinicId) {
      return {
        messageVersion: '1.0',
        response: {
          actionGroup: event.actionGroup,
          apiPath: event.apiPath,
          httpMethod: event.httpMethod,
          // IMPORTANT: Always return 200 to Bedrock. Non-2xx here can surface as DependencyFailedException.
          httpStatusCode: 200,
          responseBody: {
            'application/json': {
              body: JSON.stringify({
                status: 'FAILURE',
                message: 'clinicId is required in session attributes',
                httpStatusCode: 400,
              }),
            },
          },
        },
      };
    }

    // Get clinic config securely from SSM/DynamoDB (not bundled JSON)
    const clinicConfig = await getClinicConfigSecure(clinicId);
    if (!clinicConfig) {
      return {
        messageVersion: '1.0',
        response: {
          actionGroup: event.actionGroup,
          apiPath: event.apiPath,
          httpMethod: event.httpMethod,
          // IMPORTANT: Always return 200 to Bedrock. Non-2xx here can surface as DependencyFailedException.
          httpStatusCode: 200,
          responseBody: {
            'application/json': {
              body: JSON.stringify({
                status: 'FAILURE',
                message: `Clinic configuration not found: ${clinicId}. Ensure clinic credentials are configured in the Clinics or ClinicSecrets DynamoDB table.`,
                httpStatusCode: 400,
              }),
            },
          },
        },
      };
    }

    // Create OpenDental client with circuit breaker
    const odClient = new OpenDentalClient(clinicId, clinicConfig.developerKey, clinicConfig.customerKey);

    // Execute the tool
    const result = await handleTool(toolName, params, odClient, event.sessionAttributes);

    // IMPORTANT: Bedrock treats non-2xx action group responses as API execution failures
    // and can surface them as DependencyFailedException to the caller. We always return 200
    // and embed the tool-level status code in the JSON body.
    const safeBody =
      result.body && typeof result.body === 'object'
        ? { ...(result.body as any), httpStatusCode: result.statusCode }
        : {
          status: result.statusCode >= 200 && result.statusCode < 300 ? 'SUCCESS' : 'FAILURE',
          message: String(result.body ?? ''),
          httpStatusCode: result.statusCode,
        };

    // Build response
    const response: ActionGroupResponse = {
      messageVersion: '1.0',
      response: {
        actionGroup: event.actionGroup,
        apiPath: event.apiPath,
        httpMethod: event.httpMethod,
        // IMPORTANT: Always return 200 to Bedrock to avoid DependencyFailedException.
        httpStatusCode: 200,
        responseBody: {
          'application/json': {
            body: JSON.stringify(safeBody),
          },
        },
      },
    };

    // Update session attributes if needed
    if (result.updatedSessionAttributes) {
      response.response.sessionAttributes = result.updatedSessionAttributes;
    }

    console.log('Action Group Response:', JSON.stringify(response, null, 2));
    return response;
  } catch (error: any) {
    // CRITICAL: Always return a valid ActionGroupResponse to prevent DependencyFailedException
    // If we throw an unhandled exception, Bedrock receives DependencyFailedException and the user
    // gets a cryptic error message instead of a helpful response
    console.error('[ActionGroup] UNHANDLED ERROR:', error);
    console.error('[ActionGroup] Event that caused error:', JSON.stringify(event, null, 2));

    return {
      messageVersion: '1.0',
      response: {
        actionGroup: event.actionGroup || 'unknown',
        apiPath: event.apiPath || '/unknown',
        httpMethod: event.httpMethod || 'POST',
        // IMPORTANT: Always return 200 to Bedrock to avoid DependencyFailedException.
        httpStatusCode: 200,
        responseBody: {
          'application/json': {
            body: JSON.stringify({
              status: 'FAILURE',
              message: 'An internal error occurred. Please try again or contact support.',
              errorType: error.name || 'UnhandledException',
              httpStatusCode: 500,
            }),
          },
        },
      },
    };
  }
};

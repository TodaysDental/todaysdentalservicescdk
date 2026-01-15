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
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

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
  RATE_LIMIT_REQUESTS_PER_SEC: 10,   // Max requests per second per clinic
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

  async request(method: string, endpoint: string, { params, data }: any = {}) {
    // Check circuit breaker and rate limit before making request
    const circuitCheck = await checkCircuitBreaker(this.clinicId);
    if (!circuitCheck.allowed) {
      throw new Error(circuitCheck.reason || 'Request blocked by circuit breaker');
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

async function handleTool(
  toolName: string,
  params: Record<string, any>,
  odClient: OpenDentalClient,
  sessionAttributes: Record<string, string>
): Promise<{ statusCode: number; body: any; updatedSessionAttributes?: Record<string, string> }> {
  const updatedSessionAttributes = { ...sessionAttributes };

  try {
    switch (toolName) {
      // ===== PATIENT TOOLS =====
      case 'getPatientByPatNum': {
        const data = await odClient.request('GET', `patients/${params.PatNum}`);
        return { statusCode: 200, body: { status: 'SUCCESS', data } };
      }

      case 'searchPatients': {
        // Normalize birthdate to YYYY-MM-DD format (OpenDental API requirement)
        let normalizedBirthdate = params.Birthdate;
        if (normalizedBirthdate) {
          normalizedBirthdate = normalizeDateFormat(normalizedBirthdate);
          console.log(`[searchPatients] Normalized birthdate: ${params.Birthdate} → ${normalizedBirthdate}`);
        }
        
        const searchParams = { LName: params.LName, FName: params.FName, Birthdate: normalizedBirthdate };
        console.log(`[searchPatients] Searching with params:`, JSON.stringify(searchParams));
        
        const resp = await odClient.request('GET', 'patients/Simple', { params: searchParams });
        const patients = Array.isArray(resp) ? resp : resp?.items ?? [];

        if (patients.length === 1) {
          const patient = patients[0];
          updatedSessionAttributes.PatNum = patient.PatNum.toString();
          updatedSessionAttributes.FName = patient.FName;
          updatedSessionAttributes.LName = patient.LName;
          updatedSessionAttributes.Birthdate = patient.Birthdate;
          updatedSessionAttributes.IsNewPatient = (patient.DateFirstVisit === '0001-01-01').toString();
        }

        return {
          statusCode: patients.length > 0 ? 200 : 404,
          body: {
            status: patients.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: { items: patients },
            message: patients.length > 0 ? `Found ${patients.length} patient(s)` : 'No matching patient found',
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

      // ===== APPOINTMENT TOOLS =====
      case 'scheduleAppointment': {
        const isNewPatient = sessionAttributes.IsNewPatient === 'true';
        let opNum = getOperatoryNumber(params.Op || params.OpName);
        if (!opNum) opNum = isNewPatient ? DEFAULT_OPERATORY_MAP.EXAM : DEFAULT_OPERATORY_MAP.MINOR;

        const appointmentData = {
          PatNum: parseInt(params.PatNum.toString()),
          Op: opNum,
          AptDateTime: params.Date,
          ProcDescript: params.Reason,
          Note: params.Note || `${params.Reason} - Created by AI Agent`,
          ClinicNum: 0,
          IsNewPatient: isNewPatient,
        };
        const newAppt = await odClient.request('POST', 'appointments', { data: appointmentData });
        return {
          statusCode: 201,
          body: {
            status: 'SUCCESS',
            data: newAppt,
            message: `Appointment scheduled successfully for ${params.Date}`,
          },
        };
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
        const rescheduled = await odClient.request('PUT', `appointments/${params.AptNum}`, { data: rescheduleData });
        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            data: rescheduled,
            message: `Appointment rescheduled to ${params.NewDateTime}`,
          },
        };
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

      case 'createAppointment': {
        let opNum = getOperatoryNumber(params.Op);
        if (!opNum) opNum = DEFAULT_OPERATORY_MAP.MINOR;
        const aptData: any = {
          PatNum: parseInt(params.PatNum.toString()),
          Op: opNum,
          AptDateTime: params.AptDateTime,
        };
        if (params.Note) aptData.Note = params.Note;
        if (params.IsNewPatient !== undefined) aptData.IsNewPatient = params.IsNewPatient.toString();
        const newApt = await odClient.request('POST', 'appointments', { data: aptData });
        return { statusCode: 201, body: { status: 'SUCCESS', data: newApt } };
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
        const slots = await odClient.request('GET', 'appointments/Slots', {
          params: { date: params.date, lengthMinutes: params.lengthMinutes || 30 },
        });
        const availableSlots = Array.isArray(slots) ? slots : slots?.items ?? [];
        return {
          statusCode: availableSlots.length > 0 ? 200 : 404,
          body: {
            status: availableSlots.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: availableSlots,
            message: availableSlots.length > 0 ? `Found ${availableSlots.length} available slot(s)` : 'No available slots',
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

      // ===== FEE SCHEDULE TOOLS (from synced DynamoDB table) =====
      case 'getFeeSchedules': {
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
  'sealant': { codes: ['D1351'], category: 'preventive', description: 'Sealant per tooth' },
  'sealants': { codes: ['D1351'], category: 'preventive', description: 'Sealant per tooth' },
  
  // Diagnostic
  'exam': { codes: ['D0120', 'D0150'], category: 'diagnostic', description: 'Oral examination' },
  'periodic exam': { codes: ['D0120'], category: 'diagnostic', description: 'Periodic oral evaluation' },
  'comprehensive exam': { codes: ['D0150'], category: 'diagnostic', description: 'Comprehensive oral evaluation' },
  'new patient exam': { codes: ['D0150'], category: 'diagnostic', description: 'Comprehensive oral evaluation (new patient)' },
  'xray': { codes: ['D0210', 'D0220', 'D0270', 'D0274'], category: 'diagnostic', description: 'Radiographs/X-rays' },
  'x-ray': { codes: ['D0210', 'D0220', 'D0270', 'D0274'], category: 'diagnostic', description: 'Radiographs/X-rays' },
  'bitewing': { codes: ['D0270', 'D0272', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'bitewings': { codes: ['D0270', 'D0272', 'D0274'], category: 'diagnostic', description: 'Bitewing X-rays' },
  'pano': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'panoramic': { codes: ['D0330'], category: 'diagnostic', description: 'Panoramic X-ray' },
  'fmx': { codes: ['D0210'], category: 'diagnostic', description: 'Full mouth X-rays' },
  
  // Restorative (Basic)
  'filling': { codes: ['D2140', 'D2150', 'D2160', 'D2161', 'D2330', 'D2331', 'D2332'], category: 'basic', description: 'Filling/Restoration' },
  'fillings': { codes: ['D2140', 'D2150', 'D2160', 'D2161', 'D2330', 'D2331', 'D2332'], category: 'basic', description: 'Filling/Restoration' },
  'amalgam': { codes: ['D2140', 'D2150', 'D2160', 'D2161'], category: 'basic', description: 'Amalgam filling' },
  'composite': { codes: ['D2330', 'D2331', 'D2332', 'D2335'], category: 'basic', description: 'Composite filling' },
  'white filling': { codes: ['D2330', 'D2331', 'D2332', 'D2335'], category: 'basic', description: 'Composite (white) filling' },
  
  // Endodontics (Basic/Major)
  'root canal': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal treatment' },
  'rct': { codes: ['D3310', 'D3320', 'D3330'], category: 'endo', description: 'Root canal treatment' },
  'anterior root canal': { codes: ['D3310'], category: 'endo', description: 'Anterior root canal' },
  'premolar root canal': { codes: ['D3320'], category: 'endo', description: 'Premolar root canal' },
  'molar root canal': { codes: ['D3330'], category: 'endo', description: 'Molar root canal' },
  
  // Periodontics (Basic)
  'deep cleaning': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Scaling and root planing' },
  'scaling': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Scaling and root planing' },
  'srp': { codes: ['D4341', 'D4342'], category: 'perio', description: 'Scaling and root planing' },
  'perio maintenance': { codes: ['D4910'], category: 'perio', description: 'Periodontal maintenance' },
  
  // Oral Surgery (Basic)
  'extraction': { codes: ['D7140', 'D7210'], category: 'surgery', description: 'Tooth extraction' },
  'simple extraction': { codes: ['D7140'], category: 'surgery', description: 'Simple extraction' },
  'surgical extraction': { codes: ['D7210'], category: 'surgery', description: 'Surgical extraction' },
  'wisdom tooth': { codes: ['D7210', 'D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Wisdom tooth extraction' },
  'wisdom teeth': { codes: ['D7210', 'D7220', 'D7230', 'D7240'], category: 'surgery', description: 'Wisdom teeth extraction' },
  
  // Major - Crowns
  'crown': { codes: ['D2740', 'D2750', 'D2751', 'D2752', 'D2790', 'D2791', 'D2792'], category: 'major', description: 'Crown' },
  'crowns': { codes: ['D2740', 'D2750', 'D2751', 'D2752', 'D2790', 'D2791', 'D2792'], category: 'major', description: 'Crown' },
  'porcelain crown': { codes: ['D2740', 'D2750'], category: 'major', description: 'Porcelain crown' },
  'pfm crown': { codes: ['D2750', 'D2751', 'D2752'], category: 'major', description: 'Porcelain fused to metal crown' },
  'gold crown': { codes: ['D2790', 'D2791', 'D2792'], category: 'major', description: 'Gold/metal crown' },
  'zirconia crown': { codes: ['D2740'], category: 'major', description: 'Zirconia crown' },
  
  // Major - Prosthodontics
  'bridge': { codes: ['D6210', 'D6240', 'D6750'], category: 'major', description: 'Bridge' },
  'denture': { codes: ['D5110', 'D5120', 'D5130', 'D5140'], category: 'major', description: 'Denture' },
  'dentures': { codes: ['D5110', 'D5120', 'D5130', 'D5140'], category: 'major', description: 'Dentures' },
  'partial denture': { codes: ['D5211', 'D5212', 'D5213', 'D5214'], category: 'major', description: 'Partial denture' },
  'partial': { codes: ['D5211', 'D5212', 'D5213', 'D5214'], category: 'major', description: 'Partial denture' },
  'implant': { codes: ['D6010'], category: 'major', description: 'Dental implant' },
  'implants': { codes: ['D6010'], category: 'major', description: 'Dental implant' },
  
  // Orthodontics
  'braces': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic treatment' },
  'orthodontics': { codes: ['D8080', 'D8090'], category: 'ortho', description: 'Orthodontic treatment' },
  'invisalign': { codes: ['D8090'], category: 'ortho', description: 'Clear aligners' },
  'retainer': { codes: ['D8680'], category: 'ortho', description: 'Orthodontic retainer' },
  
  // Anesthesia/Sedation
  'anesthesia': { codes: ['D9210', 'D9211', 'D9212', 'D9215', 'D9219', 'D9223', 'D9239', 'D9243'], category: 'anesthesia', description: 'Anesthesia/Sedation' },
  'sedation': { codes: ['D9223', 'D9239', 'D9243', 'D9248'], category: 'anesthesia', description: 'Sedation' },
  'nitrous': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide (laughing gas)' },
  'laughing gas': { codes: ['D9230'], category: 'anesthesia', description: 'Nitrous oxide' },
  'iv sedation': { codes: ['D9239', 'D9243'], category: 'anesthesia', description: 'IV sedation' },
  'general anesthesia': { codes: ['D9223'], category: 'anesthesia', description: 'General anesthesia' },
  
  // Night guards / TMJ
  'night guard': { codes: ['D9940', 'D9944', 'D9945'], category: 'adjunctive', description: 'Night guard/Occlusal guard' },
  'occlusal guard': { codes: ['D9940', 'D9944', 'D9945'], category: 'adjunctive', description: 'Occlusal guard' },
  'tmj': { codes: ['D7880', 'D7899'], category: 'surgery', description: 'TMJ treatment' },
  
  // Whitening/Cosmetic (often excluded)
  'whitening': { codes: ['D9972', 'D9973', 'D9974'], category: 'cosmetic', description: 'Teeth whitening' },
  'bleaching': { codes: ['D9972', 'D9973', 'D9974'], category: 'cosmetic', description: 'Teeth bleaching' },
  'veneer': { codes: ['D2960', 'D2961', 'D2962'], category: 'cosmetic', description: 'Veneer' },
  'veneers': { codes: ['D2960', 'D2961', 'D2962'], category: 'cosmetic', description: 'Veneers' },
  'bonding': { codes: ['D2330', 'D2331', 'D2332', 'D9997'], category: 'cosmetic', description: 'Cosmetic bonding' },
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
    'scheduleAppointment',
    'getUpcomingAppointments',
    'rescheduleAppointment',
    'cancelAppointment',
    'getAccountAging',
    'getPatientBalances',
    'getServiceDateView',
    'getPatientAccountSummary', // Comprehensive account summary
    'getAllergies',
    'getPatientInfo',
    'getBenefits',
    'getCarriers',
    'getClaims',
    'getFamilyInsurance',
    'getInsurancePlanBenefits',
    'suggestInsuranceCoverage',
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
    'whichInsuranceIsPrimary', // Alias
    'getPaymentInfo', // Payment timing, plans, financing, HSA/FSA
    'paymentOptions', // Alias
    'paymentPlans', // Alias
    'financing', // Alias
    'checkCoverage', // Alias
    'calculateOutOfPocket', // What will I pay for this procedure?
    'estimateTreatmentCost', // Combines insurance + fees
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
        httpStatusCode: 400,
        responseBody: {
          'application/json': {
            body: JSON.stringify({ status: 'FAILURE', message: 'clinicId is required in session attributes' }),
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
        httpStatusCode: 400,
        responseBody: {
          'application/json': {
            body: JSON.stringify({ 
              status: 'FAILURE', 
              message: `Clinic configuration not found: ${clinicId}. Ensure clinic credentials are configured in the Clinics or ClinicSecrets DynamoDB table.` 
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

  // Build response
  const response: ActionGroupResponse = {
    messageVersion: '1.0',
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: result.statusCode,
      responseBody: {
        'application/json': {
          body: JSON.stringify(result.body),
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
};

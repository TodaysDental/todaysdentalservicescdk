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
const INSURANCE_PLANS_TABLE = process.env.INSURANCE_PLANS_TABLE || 'TodaysDentalInsightsInsurancePlanSyncN1-InsurancePlans';

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
 */
async function checkCircuitBreaker(clinicId: string): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();
  const state = await getCircuitState(clinicId);
  
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
        console.warn(`[CircuitBreaker] Failed to reset circuit for ${clinicId}:`, error);
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
      console.warn(`[CircuitBreaker] Failed to reset rate limit window:`, error);
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
    // Allow request even if counter update fails
    console.warn(`[CircuitBreaker] Failed to increment counter:`, error);
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

    if (!clinicResponse.Item) {
      console.error(`[getClinicConfig] Clinic not found in DynamoDB: ${clinicId}`);
      return undefined;
    }

    const clinicData = clinicResponse.Item;

    // Validate that credentials exist
    if (!clinicData.developerKey || !clinicData.customerKey) {
      console.error(`[getClinicConfig] Clinic ${clinicId} missing OpenDental credentials in Clinics table`);
      return undefined;
    }

    const config: ClinicConfig = {
      clinicId,
      clinicName: clinicData.clinicName || clinicData.name || '',
      clinicAddress: clinicData.clinicAddress || clinicData.address || '',
      clinicPhone: clinicData.clinicPhone || clinicData.phoneNumber || '',
      clinicEmail: clinicData.clinicEmail || clinicData.email || '',
      clinicFax: clinicData.clinicFax || clinicData.fax,
      developerKey: clinicData.developerKey,
      customerKey: clinicData.customerKey,
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
          
          throw new Error(
            error.response?.data?.message || `OpenDental API call failed: ${error.message}`
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
        const searchParams = { LName: params.LName, FName: params.FName, Birthdate: params.Birthdate };
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
        const createData = {
          LName: params.LName,
          FName: params.FName,
          WirelessPhone: phoneNumber,
          Birthdate: params.Birthdate,
          TxtMsgOk: 'Yes',
        };
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
        if (params.ProcStatus) procParams.ProcStatus = params.ProcStatus;
        const resp = await odClient.request('GET', 'procedurelogs', { params: procParams });
        const procedures = Array.isArray(resp) ? resp : resp?.items ?? [];

        const treatmentPlanned = procedures.filter((p: any) => p.ProcStatus === 'TP');
        if (treatmentPlanned.length > 0) {
          updatedSessionAttributes.ProcedureDescripts = treatmentPlanned.map((p: any) => p.descript).join(', ');
          updatedSessionAttributes.ProcNums = JSON.stringify(treatmentPlanned.map((p: any) => p.ProcNum));
        }

        return {
          statusCode: procedures.length > 0 ? 200 : 404,
          body: {
            status: procedures.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: procedures,
            message: procedures.length > 0 ? `Found ${procedures.length} procedure(s)` : 'No procedures found',
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
        return {
          statusCode: futureApts.length > 0 ? 200 : 404,
          body: {
            status: futureApts.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: futureApts,
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
        const apts = await odClient.request('GET', 'appointments', { params: aptParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: apts } };
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
        const aging = await odClient.request('GET', `accountmodules/${params.PatNum}/Aging`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: aging } };
      }

      case 'getPatientBalances': {
        const balances = await odClient.request('GET', `accountmodules/${params.PatNum}/PatientBalances`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: balances } };
      }

      case 'getServiceDateView': {
        const serviceParams: any = { PatNum: params.PatNum };
        if (params.isFamily !== undefined) serviceParams.isFamily = params.isFamily.toString();
        const serviceData = await odClient.request('GET', 'accountmodules/ServiceDateView', { params: serviceParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: serviceData } };
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
        const plans = lookupResult.body.data.plans;
        const coverageSuggestions = plans.map((plan: any) => formatCoverageSuggestion(plan));

        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            message: `Found ${plans.length} matching insurance plan(s)`,
            data: {
              plans: coverageSuggestions,
              summary: generateCoverageSummary(plans),
            },
          },
        };
      }

      default:
        return {
          statusCode: 400,
          body: { status: 'FAILURE', message: `Unknown tool: ${toolName}` },
        };
    }
  } catch (error: any) {
    console.error(`Tool ${toolName} error:`, error);
    return {
      statusCode: 500,
      body: { status: 'FAILURE', message: error.message || 'Tool execution failed' },
    };
  }
}

// ========================================================================
// INSURANCE PLAN BENEFITS LOOKUP FUNCTIONS
// ========================================================================

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
  lastSyncAt: string;
}

/**
 * Look up insurance plan benefits from the synced DynamoDB table
 * Supports searching by: insuranceName, groupName, groupNumber, or clinicId
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

    // Strategy 1: If we have clinicId and groupNumber, use direct key lookup
    if (searchClinicId && groupNumber) {
      const pk = `${searchClinicId}#${groupNumber}`;
      
      // Query all items with this partition key
      const result = await docClient.send(new QueryCommand({
        TableName: INSURANCE_PLANS_TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
      }));

      plans = (result.Items || []) as InsurancePlanRecord[];

      // If insuranceName provided, filter further
      if (insuranceName && plans.length > 0) {
        const searchTerm = insuranceName.toLowerCase();
        plans = plans.filter(p => 
          p.insuranceName?.toLowerCase().includes(searchTerm) ||
          p.sk.toLowerCase().includes(searchTerm)
        );
      }
    }
    // Strategy 2: Query by clinicId GSI
    else if (searchClinicId) {
      const result = await docClient.send(new QueryCommand({
        TableName: INSURANCE_PLANS_TABLE,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': searchClinicId },
        Limit: 100, // Limit results for performance
      }));

      plans = (result.Items || []) as InsurancePlanRecord[];

      // Filter by provided criteria
      if (insuranceName) {
        const searchTerm = insuranceName.toLowerCase();
        plans = plans.filter(p => p.insuranceName?.toLowerCase().includes(searchTerm));
      }
      if (groupName) {
        const searchTerm = groupName.toLowerCase();
        plans = plans.filter(p => p.groupName?.toLowerCase().includes(searchTerm));
      }
      if (groupNumber) {
        plans = plans.filter(p => p.groupNumber === groupNumber);
      }
    }
    // Strategy 3: Query by insuranceName GSI (cross-clinic search)
    else if (insuranceName) {
      const result = await docClient.send(new QueryCommand({
        TableName: INSURANCE_PLANS_TABLE,
        IndexName: 'insuranceName-index',
        KeyConditionExpression: 'insuranceName = :insuranceName',
        ExpressionAttributeValues: { ':insuranceName': insuranceName },
        Limit: 50,
      }));

      plans = (result.Items || []) as InsurancePlanRecord[];

      // Filter by group criteria if provided
      if (groupName) {
        const searchTerm = groupName.toLowerCase();
        plans = plans.filter(p => p.groupName?.toLowerCase().includes(searchTerm));
      }
      if (groupNumber) {
        plans = plans.filter(p => p.groupNumber === groupNumber);
      }
    }
    // Strategy 4: Scan with filters (fallback, less efficient)
    else {
      const filterExpressions: string[] = [];
      const expressionValues: Record<string, any> = {};

      if (groupName) {
        filterExpressions.push('contains(groupName, :groupName)');
        expressionValues[':groupName'] = groupName;
      }
      if (groupNumber) {
        filterExpressions.push('groupNumber = :groupNumber');
        expressionValues[':groupNumber'] = groupNumber;
      }

      if (filterExpressions.length > 0) {
        const result = await docClient.send(new ScanCommand({
          TableName: INSURANCE_PLANS_TABLE,
          FilterExpression: filterExpressions.join(' AND '),
          ExpressionAttributeValues: expressionValues,
          Limit: 50,
        }));

        plans = (result.Items || []) as InsurancePlanRecord[];
      }
    }

    if (plans.length === 0) {
      return {
        statusCode: 404,
        body: {
          status: 'FAILURE',
          message: 'No matching insurance plans found',
          searchCriteria: { insuranceName, groupName, groupNumber, clinicId: searchClinicId },
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
 */
function formatCoverageSuggestion(plan: InsurancePlanRecord): any {
  const formatPercent = (pct: number | null): string => {
    if (pct === null || pct === undefined) return 'Not specified';
    return `${Math.round(pct * 100)}%`;
  };

  const formatMoney = (amt: number | null): string => {
    if (amt === null || amt === undefined) return 'Not specified';
    return `$${amt.toLocaleString()}`;
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
    },
    notes: plan.planNote,
    lastUpdated: plan.lastSyncAt,
  };
}

/**
 * Calculate average coverage percentage for a category
 */
function calculateCategoryAverage(percentages: (number | null)[]): string {
  const validPcts = percentages.filter((p): p is number => p !== null && p !== undefined);
  if (validPcts.length === 0) return 'Not specified';
  const avg = validPcts.reduce((a, b) => a + b, 0) / validPcts.length;
  return `~${Math.round(avg * 100)}% average`;
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
 */
function determinePlanType(plan: InsurancePlanRecord): string {
  const preventive = plan.preventiveRoutinePreventivePct ?? plan.preventiveDiagnosticsPct ?? 0;
  const basic = plan.basicRestorativePct ?? 0;
  const major = plan.majorCrownsPct ?? 0;

  if (preventive >= 0.9 && basic >= 0.7 && major >= 0.5) return 'Comprehensive (100-80-50 or better)';
  if (preventive >= 0.8 && basic >= 0.6 && major >= 0.4) return 'Standard (80-60-40 or similar)';
  if (preventive >= 0.8 && basic >= 0.5) return 'Basic Coverage';
  if (preventive >= 0.8) return 'Preventive-focused';
  return 'Limited Coverage';
}

/**
 * Generate treatment recommendations based on insurance coverage
 */
function generateRecommendations(plan: InsurancePlanRecord): string[] {
  const recommendations: string[] = [];

  // Preventive recommendations
  const preventiveCoverage = plan.preventiveRoutinePreventivePct ?? plan.preventiveDiagnosticsPct;
  if (preventiveCoverage && preventiveCoverage >= 0.8) {
    recommendations.push('✓ Preventive services (cleanings, exams) are well covered - encourage regular visits');
  }

  // Deductible recommendations
  if (plan.deductibleOnPreventiveOverride === 0) {
    recommendations.push('✓ No deductible on preventive services');
  } else if (plan.deductibleIndividual && plan.deductibleIndividual > 0) {
    recommendations.push(`Note: $${plan.deductibleIndividual} individual deductible applies before benefits kick in`);
  }

  // Basic services
  if (plan.basicRestorativePct && plan.basicRestorativePct >= 0.7) {
    recommendations.push('✓ Good coverage for fillings and basic restorative work');
  } else if (plan.basicRestorativePct && plan.basicRestorativePct < 0.5) {
    recommendations.push('⚠ Limited coverage for fillings - patient should expect higher out-of-pocket');
  }

  // Major services
  if (plan.majorCrownsPct && plan.majorCrownsPct >= 0.5) {
    recommendations.push('✓ Reasonable coverage for crowns and major work');
  } else if (plan.majorCrownsPct && plan.majorCrownsPct < 0.4) {
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

  return recommendations;
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
  
  console.log(`[ActionGroup] Executing tool: ${toolName}`);
  const params = parseParameters(event);

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
              message: `Clinic configuration not found: ${clinicId}. Ensure SSM parameter /clinics/${clinicId}/opendental-credentials exists.` 
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

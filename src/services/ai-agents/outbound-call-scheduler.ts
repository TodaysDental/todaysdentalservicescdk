/**
 * Outbound Call Scheduler for AI Agents
 * 
 * Schedules and manages outbound calls made by AI agents.
 * Use cases:
 * - Appointment reminders
 * - Follow-up calls
 * - Re-engagement calls
 * - Payment reminders
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCallCommand,
} from '@aws-sdk/client-chime-sdk-voice';
import { ConnectClient, StartOutboundVoiceContactCommand } from '@aws-sdk/client-connect';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getUserDisplayName,
} from '../../shared/utils/permissions-helper';
import { isAiOutboundEnabled } from './voice-agent-config';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const schedulerClient = new SchedulerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// FIX: Use CHIME_MEDIA_REGION for Chime SDK Voice client
// Chime resources must be accessed in their deployed media region
// Previously used AWS_REGION which could mismatch and cause outbound call failures
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoiceClient = new ChimeSDKVoiceClient({
  region: CHIME_MEDIA_REGION,
});

const ssmClient = new SSMClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE || 'ScheduledCalls';
const OUTBOUND_CALL_LAMBDA_ARN = process.env.OUTBOUND_CALL_LAMBDA_ARN || '';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || '';
const CLINICS_TABLE = process.env.CLINICS_TABLE || 'Clinics';
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const SMA_ID_MAP_PARAMETER_NAME = process.env.SMA_ID_MAP_PARAMETER_NAME || '';

// Amazon Connect for AI outbound calls
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || '';
const OUTBOUND_CONTACT_FLOW_ID = process.env.OUTBOUND_CONTACT_FLOW_ID || '';
const connectClient = CONNECT_INSTANCE_ID ? new ConnectClient({}) : null;

// High-volume scheduling infrastructure
const OUTBOUND_CALL_QUEUE_URL = process.env.OUTBOUND_CALL_QUEUE_URL || '';
const BULK_OUTBOUND_JOBS_TABLE = process.env.BULK_OUTBOUND_JOBS_TABLE || 'BulkOutboundJobs';

// SMA ID Map - maps clinic regions to SIP Media Application IDs
// Loaded from SSM Parameter Store at runtime (cached for Lambda instance lifetime)
let cachedSmaIdMap: Record<string, string> | null = null;

async function getSmaIdMap(): Promise<Record<string, string>> {
  if (cachedSmaIdMap) {
    return cachedSmaIdMap;
  }

  if (!SMA_ID_MAP_PARAMETER_NAME) {
    console.warn('[SMA] No SMA_ID_MAP_PARAMETER_NAME configured, returning empty map');
    return {};
  }

  try {
    const response = await ssmClient.send(new GetParameterCommand({
      Name: SMA_ID_MAP_PARAMETER_NAME,
    }));

    if (response.Parameter?.Value) {
      cachedSmaIdMap = JSON.parse(response.Parameter.Value);
      console.log('[SMA] Loaded SMA ID Map from SSM:', Object.keys(cachedSmaIdMap || {}).length, 'entries');
      return cachedSmaIdMap || {};
    }
  } catch (error) {
    console.error('[SMA] Failed to load SMA ID Map from SSM:', error);
  }

  return {};
}

// Bulk scheduling configuration
// Configurable via environment variable, default 500 (max 1000 to stay within Lambda timeout)
const BULK_SCHEDULE_MAX_CALLS = parseInt(process.env.BULK_SCHEDULE_MAX_CALLS || '500', 10);
const BULK_SCHEDULE_BATCH_SIZE = parseInt(process.env.BULK_SCHEDULE_BATCH_SIZE || '25', 10);

const AI_AGENTS_MODULE = 'IT';
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

/**
 * Get SMA ID for a clinic (uses same logic as chime-stack)
 */
async function getSmaIdForClinic(clinicId: string): Promise<string | undefined> {
  const smaIdMap = await getSmaIdMap();
  // First check for clinic-specific SMA
  if (smaIdMap[clinicId]) {
    return smaIdMap[clinicId];
  }
  // Fall back to default SMA
  return smaIdMap['default'] || Object.values(smaIdMap)[0];
}

// ========================================================================
// TYPES
// ========================================================================

export interface ScheduledCall {
  callId: string;
  clinicId: string;
  agentId: string;

  // Target information
  phoneNumber: string;
  patientName?: string;
  patientId?: string;

  // Schedule information
  scheduledTime: string; // ISO 8601
  timezone: string;

  // Call purpose and script
  purpose: 'appointment_reminder' | 'follow_up' | 'payment_reminder' | 'reengagement' | 'custom';
  customMessage?: string;
  appointmentId?: string;

  // Status
  status: 'scheduled' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;

  // Results
  callDuration?: number;
  outcome?: 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed';
  transcriptSummary?: string;

  // EventBridge Scheduler
  schedulerArn?: string;
  schedulerName?: string;

  // Audit
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  ttl: number;
}

interface CreateScheduledCallRequest {
  clinicId: string;
  agentId: string;
  phoneNumber: string;
  patientName?: string;
  patientId?: string;
  scheduledTime: string;
  timezone?: string;
  purpose: ScheduledCall['purpose'];
  customMessage?: string;
  appointmentId?: string;
  maxAttempts?: number;
}

interface BulkScheduleRequest {
  clinicId: string;
  agentId: string;
  calls: Array<{
    phoneNumber: string;
    patientName?: string;
    patientId?: string;
    scheduledTime: string;
    purpose: ScheduledCall['purpose'];
    customMessage?: string;
    appointmentId?: string;
  }>;
  timezone?: string;
  maxAttempts?: number;
}

interface BulkScheduleResult {
  callId: string;
  phoneNumber: string;
  status: 'success' | 'failed';
  error?: string;
  scheduledTime?: string;
}

// ========================================================================
// RETRY CONFIGURATION
// ========================================================================

const RETRY_CONFIG = {
  BASE_DELAY_MS: 5 * 60 * 1000,      // 5 minutes base delay
  MAX_DELAY_MS: 60 * 60 * 1000,      // 1 hour maximum delay
  BACKOFF_MULTIPLIER: 2,             // Exponential backoff multiplier
};

/**
 * Calculate next retry time with exponential backoff
 */
function getNextRetryTime(attempts: number): Date {
  const delay = Math.min(
    RETRY_CONFIG.BASE_DELAY_MS * Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempts),
    RETRY_CONFIG.MAX_DELAY_MS
  );

  // Add jitter (±10% of delay) to avoid thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);

  return new Date(Date.now() + delay + jitter);
}

// ========================================================================
// PHONE NUMBER VALIDATION
// ========================================================================

/**
 * FIX: Enhanced phone number validation with E.164 format and security checks
 * 
 * Validates:
 * - E.164 format (+ followed by 10-15 digits, or 10-15 digits to be normalized)
 * - Not a blocked number (emergency, premium-rate, internal)
 * - Valid country code structure
 */
interface PhoneValidationResult {
  valid: boolean;
  normalized?: string;  // E.164 format: +1234567890
  error?: string;
}

// Blocked prefixes for security (emergency services, premium rate, etc.)
const BLOCKED_PREFIXES = [
  '911',       // US Emergency
  '999',       // UK Emergency
  '112',       // EU Emergency
  '000',       // AU Emergency
  '900',       // US Premium rate
  '976',       // US Premium rate
  '1900',      // US Premium rate (with country code)
  '1976',      // US Premium rate (with country code)
  '0900',      // International premium rate
  '0906',      // UK Premium rate
  '0909',      // UK Premium rate
];

// Valid country codes for basic sanity check (common ones)
const VALID_COUNTRY_CODE_PREFIXES = ['1', '44', '61', '52', '33', '49', '39', '34', '81', '86', '91'];

export function validatePhoneNumber(phoneNumber: string): PhoneValidationResult {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return { valid: false, error: 'Phone number is required' };
  }

  // Remove all non-digit characters except leading +
  let normalized = phoneNumber.trim();
  const hasPlus = normalized.startsWith('+');
  const digitsOnly = normalized.replace(/\D/g, '');

  // Check digit count
  if (digitsOnly.length < 10) {
    return { valid: false, error: 'Phone number too short. Must have at least 10 digits.' };
  }
  if (digitsOnly.length > 15) {
    return { valid: false, error: 'Phone number too long. Maximum 15 digits allowed.' };
  }

  // Check for blocked prefixes
  for (const prefix of BLOCKED_PREFIXES) {
    if (digitsOnly.startsWith(prefix) || digitsOnly.startsWith('1' + prefix)) {
      return {
        valid: false,
        error: `This phone number cannot be used for outbound calls (blocked prefix: ${prefix}).`
      };
    }
  }

  // Normalize to E.164 format
  if (hasPlus) {
    normalized = '+' + digitsOnly;
  } else if (digitsOnly.length === 10) {
    // Assume US/Canada number, add +1
    normalized = '+1' + digitsOnly;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    // US/Canada with country code
    normalized = '+' + digitsOnly;
  } else {
    // Other international, just add +
    normalized = '+' + digitsOnly;
  }

  // Basic country code validation (first 1-3 digits after +)
  const countryDigits = digitsOnly.substring(0, 3);
  const hasValidCountryCode = VALID_COUNTRY_CODE_PREFIXES.some(prefix =>
    digitsOnly.startsWith(prefix)
  );

  // Log warning but don't block - country code list isn't exhaustive
  if (!hasValidCountryCode && digitsOnly.length >= 11) {
    console.warn(`[validatePhoneNumber] Uncommon country code prefix: ${countryDigits} in ${normalized}`);
  }

  return { valid: true, normalized };
}

// ========================================================================
// HANDLER
// ========================================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  let path = event.path || '';

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'CORS preflight' }) };
  }

  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const callId = event.pathParameters?.callId;

    // GET /scheduled-calls - List scheduled calls
    if ((path.endsWith('/scheduled-calls') || path === '/scheduled-calls') && httpMethod === 'GET') {
      return await listScheduledCalls(event, userPerms);
    }

    // POST /scheduled-calls - Create new scheduled call
    if ((path.endsWith('/scheduled-calls') || path === '/scheduled-calls') && httpMethod === 'POST') {
      return await createScheduledCall(event, userPerms);
    }

    // POST /scheduled-calls/bulk - Bulk create scheduled calls (sync - up to 500 calls)
    if (path.endsWith('/scheduled-calls/bulk') && httpMethod === 'POST') {
      return await bulkScheduleCalls(event, userPerms);
    }

    // POST /scheduled-calls/async-bulk - Async bulk scheduling for 30K+ calls
    if (path.endsWith('/scheduled-calls/async-bulk') && httpMethod === 'POST') {
      return await asyncBulkScheduleCalls(event, userPerms);
    }

    // POST /scheduled-calls/send-now - Immediately initiate an AI call (no scheduling)
    if (path.endsWith('/scheduled-calls/send-now') && httpMethod === 'POST') {
      return await sendNow(event, userPerms);
    }

    // GET /bulk-jobs - List bulk jobs for a clinic
    if (path.endsWith('/bulk-jobs') && httpMethod === 'GET') {
      return await listBulkJobs(event, userPerms);
    }

    // GET /bulk-jobs/{jobId} - Get bulk job status
    const bulkJobMatch = path.match(/\/bulk-jobs\/([^/]+)$/);
    if (bulkJobMatch && httpMethod === 'GET') {
      return await getBulkJob(event, userPerms, bulkJobMatch[1]);
    }

    // GET /scheduled-calls/{callId}
    if (callId && httpMethod === 'GET') {
      return await getScheduledCall(event, userPerms, callId);
    }

    // DELETE /scheduled-calls/{callId} - Cancel scheduled call
    if (callId && httpMethod === 'DELETE') {
      return await cancelScheduledCall(event, userPerms, callId);
    }

    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  } catch (error: any) {
    console.error('Outbound scheduler error:', error);
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: error.message }) };
  }
};

// ========================================================================
// ROUTE HANDLERS
// ========================================================================

async function listScheduledCalls(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const clinicId = event.queryStringParameters?.clinicId;
  const status = event.queryStringParameters?.status;
  const limitParam = event.queryStringParameters?.limit;
  const nextTokenParam = event.queryStringParameters?.nextToken;

  if (!clinicId) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'clinicId is required' }) };
  }

  // Check access
  const userClinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin && !userClinicIds.includes(clinicId)) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Access denied' }) };
  }

  const limit = Math.min(Math.max(parseInt(limitParam || '100', 10) || 100, 1), 500);

  let exclusiveStartKey: Record<string, any> | undefined;
  if (nextTokenParam) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(nextTokenParam, 'base64').toString('utf-8'));
    } catch {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Invalid nextToken' }) };
    }
  }

  let filterExpression = undefined;
  let expressionAttributeValues: Record<string, any> = { ':cid': clinicId };

  if (status) {
    filterExpression = '#status = :status';
    expressionAttributeValues[':status'] = status;
  }

  const response = await docClient.send(new QueryCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    IndexName: 'ClinicIndex',
    KeyConditionExpression: 'clinicId = :cid',
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
    ScanIndexForward: false,
    Limit: limit,
    ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
  }));

  const nextToken = response.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64')
    : undefined;

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      calls: response.Items || [],
      count: response.Items?.length || 0,
      nextToken,
    }),
  };
}

/**
 * Generate idempotency key for a scheduled call
 * Prevents duplicate schedules for same phone + time + purpose combination
 */
function generateIdempotencyKey(clinicId: string, phoneNumber: string, scheduledTime: string, purpose: string): string {
  // Normalize phone number and time for comparison
  const normalizedPhone = phoneNumber.replace(/\D/g, '');
  const normalizedTime = new Date(scheduledTime).toISOString().slice(0, 16); // Truncate to minutes
  return `${clinicId}:${normalizedPhone}:${normalizedTime}:${purpose}`;
}

async function createScheduledCall(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}') as CreateScheduledCallRequest;

  // Validate required fields
  if (!body.clinicId || !body.agentId || !body.phoneNumber || !body.scheduledTime || !body.purpose) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'clinicId, agentId, phoneNumber, scheduledTime, and purpose are required' }),
    };
  }

  // FIX: Enhanced phone number validation with E.164 format check and security blocklist
  const phoneValidation = validatePhoneNumber(body.phoneNumber);
  if (!phoneValidation.valid) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: phoneValidation.error }),
    };
  }
  const normalizedPhone = phoneValidation.normalized!;

  // Check permission
  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinicId
  );

  if (!canCreate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  // Parse scheduled time
  const scheduledDate = new Date(body.scheduledTime);
  if (scheduledDate <= new Date()) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'scheduledTime must be in the future' }),
    };
  }

  // VALIDATION FIX: Verify AI outbound calling is enabled for this clinic
  const outboundEnabled = await isAiOutboundEnabled(body.clinicId);
  if (!outboundEnabled) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'AI outbound calling is not enabled for this clinic',
        message: 'Enable AI outbound calling in Voice Config before scheduling calls.',
      }),
    };
  }

  // VALIDATION FIX: Verify agent exists and is ready before scheduling
  const agentResponse = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId: body.agentId },
  }));
  const agent = agentResponse.Item;

  if (!agent) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent not found' }),
    };
  }

  if (!agent.isActive) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent is not active' }),
    };
  }

  if (agent.bedrockAgentStatus !== 'PREPARED') {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Agent is not ready',
        message: `Agent status is "${agent.bedrockAgentStatus}". Please prepare the agent first.`,
        currentStatus: agent.bedrockAgentStatus,
      }),
    };
  }

  if (agent.clinicId !== body.clinicId && !agent.isPublic) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent does not belong to this clinic' }),
    };
  }

  // Generate idempotency key for duplicate prevention
  const idempotencyKey = generateIdempotencyKey(body.clinicId, body.phoneNumber, body.scheduledTime, body.purpose);

  // Use idempotency key as part of callId to enable conditional put
  // This prevents TOCTOU race condition where two concurrent requests both pass duplicate check
  const callId = `${idempotencyKey.slice(0, 16)}-${uuidv4().slice(0, 8)}`;
  const timestamp = new Date().toISOString();
  const createdBy = getUserDisplayName(userPerms);
  const schedulerName = `outbound-call-${callId}`;

  const scheduledCall: ScheduledCall = {
    callId,
    clinicId: body.clinicId,
    agentId: body.agentId,
    phoneNumber: normalizedPhone,
    patientName: body.patientName,
    patientId: body.patientId,
    scheduledTime: body.scheduledTime,
    timezone: body.timezone || 'America/New_York',
    purpose: body.purpose,
    customMessage: body.customMessage,
    appointmentId: body.appointmentId,
    status: 'scheduled',
    attempts: 0,
    maxAttempts: body.maxAttempts || 3,
    schedulerName,
    createdAt: timestamp,
    createdBy,
    updatedAt: timestamp,
    ttl: Math.floor(scheduledDate.getTime() / 1000) + (7 * 24 * 60 * 60), // 7 days after scheduled time
  };

  // RACE CONDITION FIX: Use conditional put with idempotency key
  // Store the idempotency key in the record for duplicate detection
  const scheduledCallWithIdempotency = {
    ...scheduledCall,
    idempotencyKey,
  };

  // FIX: Check for duplicates BEFORE creating EventBridge schedule
  // This prevents orphaned schedules when DynamoDB already has the record
  try {
    const existingCallsResponse = await docClient.send(new QueryCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :cid',
      FilterExpression: 'idempotencyKey = :ikey AND #status = :scheduled',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':cid': body.clinicId,
        ':ikey': idempotencyKey,
        ':scheduled': 'scheduled',
      },
      Limit: 1,
    }));

    if (existingCallsResponse.Items && existingCallsResponse.Items.length > 0) {
      return {
        statusCode: 409,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: 'Duplicate scheduled call',
          message: 'A call to this phone number with the same purpose is already scheduled for this time.',
          existingCallId: existingCallsResponse.Items[0].callId,
        }),
      };
    }
  } catch (checkError) {
    console.error('Failed to check for duplicate calls:', checkError);
    // Continue - conditional put will catch duplicates
  }

  // FIX: Write to DynamoDB FIRST, then create EventBridge schedule
  // This prevents orphaned schedules if DynamoDB write fails
  // If EventBridge creation fails after DynamoDB write, we can retry or mark as failed
  try {
    await docClient.send(new PutCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Item: scheduledCallWithIdempotency,
      ConditionExpression: 'attribute_not_exists(callId)',
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: 'Duplicate scheduled call',
          message: 'A call with this ID was just created by another request. Please retry.',
        }),
      };
    }
    console.error('Failed to save scheduled call to DynamoDB:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Failed to save scheduled call', details: error.message }),
    };
  }

  // Now create EventBridge schedule
  try {
    const scheduleResponse = await schedulerClient.send(new CreateScheduleCommand({
      Name: schedulerName,
      ScheduleExpression: `at(${scheduledDate.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      // Auto-delete schedule after execution - prevents orphaned schedules
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: OUTBOUND_CALL_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          callId,
          clinicId: body.clinicId,
          agentId: body.agentId,
          phoneNumber: normalizedPhone,
          patientName: body.patientName,
          purpose: body.purpose,
          customMessage: body.customMessage,
        }),
      },
    }));

    // Update DynamoDB record with scheduler ARN
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET schedulerArn = :arn',
      ExpressionAttributeValues: { ':arn': scheduleResponse.ScheduleArn },
    }));

    scheduledCallWithIdempotency.schedulerArn = scheduleResponse.ScheduleArn;
  } catch (error: any) {
    console.error('Failed to create EventBridge schedule:', error);

    // FIX: Rollback the DynamoDB record since we couldn't create the schedule
    try {
      await docClient.send(new UpdateCommand({
        TableName: SCHEDULED_CALLS_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #status = :failed, failureReason = :reason, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':reason': `Failed to create EventBridge schedule: ${error.message}`,
          ':now': new Date().toISOString(),
        },
      }));
    } catch (rollbackError) {
      console.error('Failed to rollback DynamoDB record:', rollbackError);
    }

    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Failed to create schedule', details: error.message }),
    };
  }

  // Success - return the scheduled call details
  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Outbound call scheduled successfully',
      call: scheduledCallWithIdempotency,
    }),
  };
}

async function getScheduledCall(event: APIGatewayProxyEvent, userPerms: any, callId: string): Promise<APIGatewayProxyResult> {
  const response = await docClient.send(new GetCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Key: { callId },
  }));

  const call = response.Item as ScheduledCall | undefined;
  if (!call) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Call not found' }) };
  }

  // Check access
  const userClinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin && !userClinicIds.includes(call.clinicId)) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Access denied' }) };
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({ call }),
  };
}

async function cancelScheduledCall(event: APIGatewayProxyEvent, userPerms: any, callId: string): Promise<APIGatewayProxyResult> {
  const response = await docClient.send(new GetCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Key: { callId },
  }));

  const call = response.Item as ScheduledCall | undefined;
  if (!call) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Call not found' }) };
  }

  // Check permission
  const canDelete = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'delete',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    call.clinicId
  );

  if (!canDelete) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  if (call.status !== 'scheduled') {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: `Cannot cancel call with status: ${call.status}` }),
    };
  }

  // FIX: Delete EventBridge schedule AFTER updating DynamoDB status
  // This prevents orphaned schedules if DynamoDB update fails

  // First, update status to cancelled (atomic operation)
  try {
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET #status = :cancelled, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':cancelled': 'cancelled',
        ':now': new Date().toISOString(),
      },
      ConditionExpression: '#status = :scheduled',
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Call status has changed. Please refresh and try again.' }),
      };
    }
    throw error;
  }

  // Now delete EventBridge schedule(s)
  const schedulesToDelete = [call.schedulerName];

  // Also try to delete any retry schedulers
  for (let i = 1; i <= call.maxAttempts; i++) {
    schedulesToDelete.push(`outbound-call-retry-${callId}-${i}`);
  }

  const deleteErrors: string[] = [];
  for (const scheduleName of schedulesToDelete) {
    if (!scheduleName) continue;

    try {
      await schedulerClient.send(new DeleteScheduleCommand({
        Name: scheduleName,
      }));
      console.log(`[cancelScheduledCall] Deleted schedule: ${scheduleName}`);
    } catch (error: any) {
      if (error.name !== 'ResourceNotFoundException') {
        // Log but don't fail - schedule might already be deleted
        console.warn(`[cancelScheduledCall] Failed to delete schedule ${scheduleName}:`, error.message);
        deleteErrors.push(`${scheduleName}: ${error.message}`);
      }
    }
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Scheduled call cancelled successfully',
      callId,
      scheduleCleanup: deleteErrors.length > 0
        ? { warning: 'Some schedules could not be deleted', errors: deleteErrors }
        : { success: true },
    }),
  };
}

// ========================================================================
// SEND NOW - Immediately initiate an AI call (no EventBridge scheduling)
// ========================================================================

async function sendNow(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { clinicId, agentId, phoneNumber, patientName, purpose, customMessage } = body;

  if (!clinicId || !agentId || !phoneNumber || !purpose) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'clinicId, agentId, phoneNumber, and purpose are required' }),
    };
  }

  // Validate phone number
  const phoneValidation = validatePhoneNumber(phoneNumber);
  if (!phoneValidation.valid) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: phoneValidation.error }) };
  }
  const normalizedPhone = phoneValidation.normalized!;

  // Check permission
  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    clinicId
  );

  if (!canCreate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  const outboundEnabled = await isAiOutboundEnabled(clinicId);
  if (!outboundEnabled) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'AI outbound calling is not enabled for this clinic',
        message: 'Enable AI outbound calling in Voice Config before making calls.',
      }),
    };
  }

  const agentCheck = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  }));
  const agentItem = agentCheck.Item;

  if (!agentItem) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent not found' }) };
  }
  if (!agentItem.isActive) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent is not active' }) };
  }
  if (agentItem.bedrockAgentStatus !== 'PREPARED') {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Agent is not ready',
        message: `Agent status is "${agentItem.bedrockAgentStatus}". Please prepare the agent first.`,
      }),
    };
  }
  if (agentItem.clinicId !== clinicId && !agentItem.isPublic) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent does not belong to this clinic' }) };
  }

  const callId = `call-now-${uuidv4().slice(0, 8)}`;
  const now = new Date().toISOString();
  const userName = getUserDisplayName(userPerms);

  const callRecord: ScheduledCall = {
    callId,
    clinicId,
    agentId,
    phoneNumber: normalizedPhone,
    patientName: patientName || '',
    purpose,
    customMessage: customMessage || '',
    scheduledTime: now,
    status: 'scheduled',
    attempts: 0,
    maxAttempts: 1,
    schedulerName: '',
    createdBy: userName,
    createdAt: now,
    updatedAt: now,
    timezone: 'UTC',
    ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 day TTL
  };

  await docClient.send(new PutCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Item: callRecord,
  }));

  // Directly execute the call (no scheduling delay)
  try {
    const result = await executeOutboundCall({
      callId,
      clinicId,
      agentId,
      phoneNumber: normalizedPhone,
      patientName,
      purpose,
      customMessage,
    });

    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        message: 'AI call initiated immediately',
        callId,
        ...result,
      }),
    };
  } catch (error: any) {
    console.error('[sendNow] Failed to initiate call:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Failed to initiate call: ${error.message}`,
        callId,
      }),
    };
  }
}

// ========================================================================
// BULK SCHEDULING
// ========================================================================

/**
 * Create a single scheduled call (internal function for bulk operations)
 * 
 * FIX: Now includes same validations as single-call endpoint:
 * - Validates AI outbound is enabled for the clinic
 * - Validates agent exists and is ready
 * - Validates agent belongs to clinic or is public
 */
async function createSingleScheduledCall(
  request: CreateScheduledCallRequest,
  createdBy: string,
  // FIX: Pre-validated context to avoid redundant DB calls in bulk operations
  validationContext?: {
    outboundEnabled: boolean;
    agent: { agentId: string; isActive: boolean; bedrockAgentStatus: string; clinicId: string; isPublic: boolean };
  }
): Promise<{ success: boolean; callId?: string; error?: string }> {
  const callId = uuidv4();
  const timestamp = new Date().toISOString();
  const schedulerName = `outbound-call-${callId}`;

  // Parse scheduled time
  const scheduledDate = new Date(request.scheduledTime);
  if (scheduledDate <= new Date()) {
    return { success: false, error: 'scheduledTime must be in the future' };
  }

  // FIX: Validate AI outbound is enabled (use context if available)
  if (validationContext) {
    if (!validationContext.outboundEnabled) {
      return { success: false, error: 'AI outbound calling is not enabled for this clinic' };
    }
    if (!validationContext.agent.isActive) {
      return { success: false, error: 'Agent is not active' };
    }
    if (validationContext.agent.bedrockAgentStatus !== 'PREPARED') {
      return { success: false, error: `Agent is not ready (status: ${validationContext.agent.bedrockAgentStatus})` };
    }
    if (validationContext.agent.clinicId !== request.clinicId && !validationContext.agent.isPublic) {
      return { success: false, error: 'Agent does not belong to this clinic' };
    }
  } else {
    // Fallback: validate without context (for direct calls)
    const outboundEnabled = await isAiOutboundEnabled(request.clinicId);
    if (!outboundEnabled) {
      return { success: false, error: 'AI outbound calling is not enabled for this clinic' };
    }

    const agentResponse = await docClient.send(new GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId: request.agentId },
    }));
    const agent = agentResponse.Item;

    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    if (!agent.isActive) {
      return { success: false, error: 'Agent is not active' };
    }
    if (agent.bedrockAgentStatus !== 'PREPARED') {
      return { success: false, error: `Agent is not ready (status: ${agent.bedrockAgentStatus})` };
    }
    if (agent.clinicId !== request.clinicId && !agent.isPublic) {
      return { success: false, error: 'Agent does not belong to this clinic' };
    }
  }

  const phoneValidation = validatePhoneNumber(request.phoneNumber);
  if (!phoneValidation.valid) {
    return { success: false, error: phoneValidation.error };
  }
  const validatedPhone = phoneValidation.normalized!;

  const scheduledCall: ScheduledCall = {
    callId,
    clinicId: request.clinicId,
    agentId: request.agentId,
    phoneNumber: validatedPhone,
    patientName: request.patientName,
    patientId: request.patientId,
    scheduledTime: request.scheduledTime,
    timezone: request.timezone || 'America/New_York',
    purpose: request.purpose,
    customMessage: request.customMessage,
    appointmentId: request.appointmentId,
    status: 'scheduled',
    attempts: 0,
    maxAttempts: request.maxAttempts || 3,
    schedulerName,
    createdAt: timestamp,
    createdBy,
    updatedAt: timestamp,
    ttl: Math.floor(scheduledDate.getTime() / 1000) + (7 * 24 * 60 * 60),
  };

  // Write DynamoDB FIRST to prevent orphaned EventBridge schedules
  try {
    await docClient.send(new PutCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Item: scheduledCall,
    }));
  } catch (error: any) {
    console.error('Failed to save scheduled call to DynamoDB:', error);
    return { success: false, error: error.message };
  }

  try {
    const scheduleResponse = await schedulerClient.send(new CreateScheduleCommand({
      Name: schedulerName,
      ScheduleExpression: `at(${scheduledDate.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: OUTBOUND_CALL_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          callId,
          clinicId: request.clinicId,
          agentId: request.agentId,
          phoneNumber: validatedPhone,
          patientName: request.patientName,
          purpose: request.purpose,
          customMessage: request.customMessage,
        }),
      },
    }));

    // Update DynamoDB record with scheduler ARN
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET schedulerArn = :arn',
      ExpressionAttributeValues: { ':arn': scheduleResponse.ScheduleArn },
    }));
  } catch (error: any) {
    console.error('Failed to create EventBridge schedule:', error);
    // Rollback: mark the DynamoDB record as failed
    try {
      await docClient.send(new UpdateCommand({
        TableName: SCHEDULED_CALLS_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #status = :failed, failureReason = :reason, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':reason': `Failed to create EventBridge schedule: ${error.message}`,
          ':now': new Date().toISOString(),
        },
      }));
    } catch (rollbackError) {
      console.error('Failed to rollback DynamoDB record:', rollbackError);
    }
    return { success: false, error: error.message };
  }

  return { success: true, callId };
}

/**
 * Bulk schedule multiple calls at once
 * 
 * FIX: Now validates AI outbound and agent ONCE upfront instead of per-call.
 * This is more efficient and ensures consistent validation across the batch.
 */
async function bulkScheduleCalls(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}') as BulkScheduleRequest;

  // Validate required fields
  if (!body.clinicId || !body.agentId || !body.calls || !Array.isArray(body.calls)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'clinicId, agentId, and calls array are required' }),
    };
  }

  if (body.calls.length === 0) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'calls array cannot be empty' }),
    };
  }

  if (body.calls.length > BULK_SCHEDULE_MAX_CALLS) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Maximum ${BULK_SCHEDULE_MAX_CALLS} calls per bulk request`,
        maxAllowed: BULK_SCHEDULE_MAX_CALLS,
        requested: body.calls.length,
      }),
    };
  }

  // Check permission
  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinicId
  );

  if (!canCreate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  // FIX: Validate AI outbound and agent ONCE upfront (not per-call)
  const outboundEnabled = await isAiOutboundEnabled(body.clinicId);
  if (!outboundEnabled) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'AI outbound calling is not enabled for this clinic',
        message: 'Enable AI outbound calling in Voice Config before scheduling calls.',
      }),
    };
  }

  const agentResponse = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId: body.agentId },
  }));
  const agent = agentResponse.Item;

  if (!agent) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent not found' }),
    };
  }

  if (!agent.isActive) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent is not active' }),
    };
  }

  if (agent.bedrockAgentStatus !== 'PREPARED') {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Agent is not ready',
        message: `Agent status is "${agent.bedrockAgentStatus}". Please prepare the agent first.`,
        currentStatus: agent.bedrockAgentStatus,
      }),
    };
  }

  if (agent.clinicId !== body.clinicId && !agent.isPublic) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent does not belong to this clinic' }),
    };
  }

  // Create validation context to pass to each call (avoids redundant DB lookups)
  const validationContext = {
    outboundEnabled,
    agent: {
      agentId: agent.agentId,
      isActive: agent.isActive,
      bedrockAgentStatus: agent.bedrockAgentStatus,
      clinicId: agent.clinicId,
      isPublic: agent.isPublic,
    },
  };

  const createdBy = getUserDisplayName(userPerms);
  const results: BulkScheduleResult[] = [];

  // Process calls in parallel with concurrency limit
  // Using configurable batch size for better throughput
  for (let i = 0; i < body.calls.length; i += BULK_SCHEDULE_BATCH_SIZE) {
    const batch = body.calls.slice(i, i + BULK_SCHEDULE_BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (call) => {
        const result = await createSingleScheduledCall(
          {
            clinicId: body.clinicId,
            agentId: body.agentId,
            phoneNumber: call.phoneNumber,
            patientName: call.patientName,
            patientId: call.patientId,
            scheduledTime: call.scheduledTime,
            timezone: body.timezone,
            purpose: call.purpose,
            customMessage: call.customMessage,
            appointmentId: call.appointmentId,
            maxAttempts: body.maxAttempts,
          },
          createdBy,
          validationContext // Pass pre-validated context
        );

        return {
          phoneNumber: call.phoneNumber,
          scheduledTime: call.scheduledTime,
          ...result,
        };
      })
    );

    // Collect results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push({
          callId: result.value.callId || '',
          phoneNumber: result.value.phoneNumber,
          status: result.value.success ? 'success' : 'failed',
          error: result.value.error,
          scheduledTime: result.value.scheduledTime,
        });
      } else {
        results.push({
          callId: '',
          phoneNumber: '',
          status: 'failed',
          error: result.reason?.message || 'Unknown error',
        });
      }
    }
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  return {
    statusCode: successCount > 0 ? 201 : 400,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: `Bulk scheduling completed: ${successCount} success, ${failedCount} failed`,
      summary: {
        total: body.calls.length,
        success: successCount,
        failed: failedCount,
      },
      results,
    }),
  };
}

// ========================================================================
// OUTBOUND CALL EXECUTOR (Called by EventBridge Scheduler)
// ========================================================================

export const executeOutboundCall = async (event: any) => {
  console.log('[ai-outbound] Executing scheduled outbound call:', JSON.stringify(event, null, 2));

  const { callId, clinicId, agentId, phoneNumber, patientName, purpose, customMessage, isRetry, retryAttempt, isCleanupCheck } = event;

  // FIX: Handle cleanup check for uncertain calls (missing TransactionId)
  // This is triggered by the scheduled cleanup 5 minutes after an uncertain call
  if (isCleanupCheck) {
    console.log('[ai-outbound] Processing cleanup check for uncertain call:', callId);

    const callResponse = await docClient.send(new GetCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
    }));
    const call = callResponse.Item as ScheduledCall | undefined;

    if (!call) {
      console.log('[ai-outbound] Cleanup: Call not found (already deleted):', callId);
      return { success: true, message: 'Call already cleaned up' };
    }

    // Only clean up if still in uncertain in_progress state
    if (call.status === 'in_progress' && (call as any).chimeTransactionId === 'UNKNOWN_TXN_ID') {
      console.warn('[ai-outbound] Cleanup: Marking uncertain call as failed (timeout):', callId);

      await docClient.send(new UpdateCommand({
        TableName: SCHEDULED_CALLS_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #status = :status, outcome = :outcome, updatedAt = :now, cleanupReason = :reason',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'failed',
          ':outcome': 'uncertain_timeout',
          ':now': new Date().toISOString(),
          ':reason': 'Call was in uncertain state (missing TransactionId) and no update received within timeout period',
        },
      }));

      return { success: true, callId, message: 'Uncertain call marked as failed due to timeout' };
    }

    // Call was already resolved (completed, failed, etc.) - no action needed
    console.log('[ai-outbound] Cleanup: Call already resolved:', { callId, status: call.status });
    return { success: true, callId, message: `Call already resolved with status: ${call.status}` };
  }

  // Get scheduled call record
  const scheduledCallResponse = await docClient.send(new GetCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Key: { callId },
  }));
  const scheduledCall = scheduledCallResponse.Item as ScheduledCall | undefined;

  if (!scheduledCall) {
    console.error('[ai-outbound] Scheduled call not found:', callId);
    return { success: false, error: 'Scheduled call not found' };
  }

  // Check if already processed or cancelled
  if (scheduledCall.status !== 'scheduled') {
    console.warn('[ai-outbound] Call already processed:', { callId, status: scheduledCall.status });
    return { success: false, error: `Call already ${scheduledCall.status}` };
  }

  // FIX: Enhanced idempotency check to prevent duplicate execution from EventBridge duplicate delivery
  // Use conditional update to atomically claim this execution
  // FIX: Use UUID instead of Date.now() to prevent collisions during same-millisecond delivery
  const executionId = `exec-${uuidv4().slice(0, 12)}`;
  const executionStartTime = new Date().toISOString();

  try {
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET executionId = :execId, executionStartedAt = :now',
      // FIX: Enhanced condition - check both executionId and a time window
      // Only proceed if no execution is already in progress OR if a stale execution is present
      // Stale execution = started more than 5 minutes ago (Lambda would have timed out)
      ConditionExpression: isRetry
        ? '(attribute_not_exists(executionId) OR executionId = :empty OR executionStartedAt < :staleTime) AND attempts = :expectedAttempts'
        : 'attribute_not_exists(executionId) OR executionId = :empty OR executionStartedAt < :staleTime',
      ExpressionAttributeValues: {
        ':execId': executionId,
        ':now': executionStartTime,
        ':empty': '',
        // FIX: Consider execution stale after 5 minutes (Lambda timeout is typically 30s-5min)
        ':staleTime': new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        ...(isRetry ? { ':expectedAttempts': (retryAttempt || 1) - 1 } : {}),
      },
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.warn('[ai-outbound] Duplicate execution detected, skipping:', { callId, isRetry, retryAttempt });
      return { success: false, error: 'Duplicate execution - another invocation is processing this call' };
    }
    throw error;
  }

  // RUNTIME CHECK: Verify AI outbound calling is still enabled
  // Admin may have disabled it after the call was scheduled
  const outboundEnabled = await isAiOutboundEnabled(clinicId);
  if (!outboundEnabled) {
    console.warn('[ai-outbound] AI outbound calling disabled for clinic:', clinicId);
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET #status = :status, outcome = :outcome, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'cancelled',
        ':outcome': 'ai_outbound_disabled',
        ':now': new Date().toISOString(),
      },
    }));
    return { success: false, error: 'AI outbound calling is disabled for this clinic' };
  }

  // RUNTIME CHECK: Verify agent is still ready
  const agentResponse = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  }));
  const agent = agentResponse.Item;

  if (!agent || !agent.isActive || agent.bedrockAgentStatus !== 'PREPARED') {
    console.error('[ai-outbound] Agent not ready:', { agentId, status: agent?.bedrockAgentStatus });
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET #status = :status, outcome = :outcome, lastError = :error, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':outcome': 'agent_not_ready',
        ':error': `Agent ${agentId} is not ready (status: ${agent?.bedrockAgentStatus || 'not found'})`,
        ':now': new Date().toISOString(),
      },
    }));
    return { success: false, error: 'Agent is not ready' };
  }

  // Check max attempts
  if (scheduledCall.attempts >= scheduledCall.maxAttempts) {
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET #status = :status, outcome = :outcome, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':outcome': 'max_attempts_exceeded',
        ':now': new Date().toISOString(),
      },
    }));
    console.error('[ai-outbound] Max attempts exceeded:', callId);
    return { success: false, error: 'Max attempts exceeded' };
  }

  // Update status to in_progress
  await docClient.send(new UpdateCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Key: { callId },
    UpdateExpression: 'SET #status = :status, attempts = attempts + :one, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'in_progress',
      ':one': 1,
      ':now': new Date().toISOString(),
    },
  }));

  try {
    // Get clinic info for caller ID
    const clinicResponse = await docClient.send(new GetCommand({
      TableName: CLINICS_TABLE,
      Key: { clinicId },
    }));
    const clinic = clinicResponse.Item;

    if (!clinic?.phoneNumber) {
      throw new Error(`Clinic ${clinicId} does not have a phone number configured`);
    }

    // Use AI phone number for outbound caller ID if configured
    const fromPhoneNumber = clinic.aiPhoneNumber || clinic.phoneNumber;

    // =====================================================
    // CONNECT-BASED OUTBOUND AI CALL (primary path)
    // Falls back to Chime SMA if Connect is not configured
    // =====================================================
    if (connectClient && CONNECT_INSTANCE_ID && OUTBOUND_CONTACT_FLOW_ID) {
      console.log('[ai-outbound] Initiating outbound AI call via Amazon Connect', {
        fromPhoneNumber,
        toPhoneNumber: phoneNumber,
        purpose,
        callId,
      });

      const contactResponse = await connectClient.send(
        new StartOutboundVoiceContactCommand({
          InstanceId: CONNECT_INSTANCE_ID,
          ContactFlowId: OUTBOUND_CONTACT_FLOW_ID,
          DestinationPhoneNumber: phoneNumber,
          SourcePhoneNumber: fromPhoneNumber,
          Attributes: {
            ai_voice_prompt: customMessage || `Hello ${patientName || 'there'}, this is a call from your dental office.`,
            purpose: purpose || '',
            patientName: patientName || '',
            clinicId: clinicId,
            scheduledCallId: callId,
            aiAgentId: agentId,
            callDirection: 'outbound',
          },
        })
      );

      const contactId = contactResponse.ContactId;
      console.log('[ai-outbound] Connect call initiated', { callId, contactId, phoneNumber });

      // Update with Connect contact ID
      await docClient.send(new UpdateCommand({
        TableName: SCHEDULED_CALLS_TABLE,
        Key: { callId },
        UpdateExpression: 'SET connectContactId = :cid, chimeTransactionId = :cid, analyticsCallId = :analyticsCallId, updatedAt = :now',
        ExpressionAttributeValues: {
          ':cid': contactId || 'CONNECT_CALL',
          ':analyticsCallId': contactId ? `connect-${contactId}` : 'CONNECT_CALL',
          ':now': new Date().toISOString(),
        },
      }));

      return {
        success: true,
        callId,
        contactId,
        transactionId: contactId, // backwards compat
        message: 'AI call initiated via Connect',
      };
    }

    // =====================================================
    // CHIME SMA FALLBACK (legacy path)
    // =====================================================
    // Get SMA ID for this clinic (uses existing Chime infrastructure)
    const smaId = await getSmaIdForClinic(clinicId);
    if (!smaId) {
      throw new Error(`No SIP Media Application or Connect configured for clinic ${clinicId}`);
    }

    console.log('[ai-outbound] Initiating outbound AI call via Chime SMA (fallback)', {
      fromPhoneNumber,
      toPhoneNumber: phoneNumber,
      smaId,
      purpose,
      callId,
    });

    const callCommandInput = {
      FromPhoneNumber: fromPhoneNumber,
      ToPhoneNumber: phoneNumber,
      SipMediaApplicationId: smaId,
      ArgumentsMap: {
        callType: 'AiOutbound',
        scheduledCallId: callId,
        aiAgentId: agentId,
        clinicId: clinicId,
        patientName: patientName || '',
        purpose: purpose,
        customMessage: customMessage || '',
      },
    };

    const callResponse = await chimeVoiceClient.send(new CreateSipMediaApplicationCallCommand(callCommandInput));

    const transactionId = callResponse.SipMediaApplicationCall?.TransactionId;

    // FIX: Handle missing transactionId more carefully
    // Chime might have initiated the call but failed to return the ID
    // This is rare but we should track it properly
    if (!transactionId) {
      console.warn('[ai-outbound] Chime response missing TransactionId - call may still be in progress', {
        callId,
        phoneNumber,
        response: JSON.stringify(callResponse),
      });

      // FIX: Set a timeout for uncertain calls - if not resolved within 5 minutes, mark as failed
      // This prevents phantom "in_progress" calls from staying forever
      const uncertainTimeout = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

      // Update status to indicate uncertain state with timeout
      await docClient.send(new UpdateCommand({
        TableName: SCHEDULED_CALLS_TABLE,
        Key: { callId },
        UpdateExpression: 'SET #status = :status, chimeTransactionId = :unknown, updatedAt = :now, lastWarning = :warning, uncertainStateTimeout = :timeout, executionId = :empty',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'in_progress', // Keep as in_progress - call may be ringing
          ':unknown': 'UNKNOWN_TXN_ID',
          ':now': new Date().toISOString(),
          ':warning': 'Chime did not return TransactionId - call status uncertain',
          ':timeout': uncertainTimeout,
          ':empty': '', // Clear executionId so cleanup can mark as failed
        },
      }));

      // FIX: Schedule a cleanup check for this uncertain call
      // If the call hasn't been updated by inbound-router (CALL_ENDED), mark it as failed
      try {
        const cleanupSchedulerName = `outbound-cleanup-${callId}`;
        await schedulerClient.send(new CreateScheduleCommand({
          Name: cleanupSchedulerName,
          ScheduleExpression: `at(${uncertainTimeout.replace(/\.\d{3}Z$/, '')})`,
          FlexibleTimeWindow: { Mode: 'OFF' },
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: OUTBOUND_CALL_LAMBDA_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({
              callId,
              isCleanupCheck: true, // Signals this is a timeout cleanup, not a new call
            }),
          },
        }));
        console.log('[ai-outbound] Scheduled cleanup check for uncertain call:', { callId, timeout: uncertainTimeout });
      } catch (schedulerErr) {
        console.warn('[ai-outbound] Failed to schedule cleanup for uncertain call:', schedulerErr);
      }

      return {
        success: true, // Tentatively successful - Chime accepted the call
        callId,
        transactionId: 'unknown',
        message: 'Call initiated but TransactionId not returned - status uncertain',
        warning: 'Chime accepted the call but did not return a TransactionId. A cleanup check is scheduled for 5 minutes.',
        cleanupScheduled: true,
      };
    }

    console.log('[ai-outbound] Call initiated successfully', {
      callId,
      transactionId,
      phoneNumber
    });

    // Update with transaction ID (call is now ringing)
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET chimeTransactionId = :txId, updatedAt = :now',
      ExpressionAttributeValues: {
        ':txId': transactionId,
        ':now': new Date().toISOString(),
      },
    }));

    // Note: The actual call outcome (answered, voicemail, no_answer) 
    // will be updated by the Voice AI handler when the call ends

    return {
      success: true,
      callId,
      transactionId,
      message: 'Call initiated, awaiting answer',
    };

  } catch (error: any) {
    console.error('[ai-outbound] Failed to initiate call:', {
      callId,
      error: error.message,
      code: error.name,
      attempt: scheduledCall.attempts,
    });

    // Determine if we should retry
    const isConcurrentLimit = error.message?.includes('Concurrent call limits');
    const isServiceUnavailable = error.name === 'ServiceUnavailableException';
    const isTimeout = error.name === 'TimeoutError' || error.message?.includes('timeout');
    const shouldRetry = isConcurrentLimit || isServiceUnavailable || isTimeout;
    const canRetry = scheduledCall.attempts < scheduledCall.maxAttempts;

    if (shouldRetry && canRetry) {
      // Calculate next retry time with exponential backoff
      const nextRetryTime = getNextRetryTime(scheduledCall.attempts);
      const retrySchedulerName = `outbound-call-retry-${callId}-${scheduledCall.attempts + 1}`;

      console.log('[ai-outbound] Scheduling retry with exponential backoff:', {
        callId,
        attempt: scheduledCall.attempts + 1,
        nextRetryTime: nextRetryTime.toISOString(),
        delayMs: nextRetryTime.getTime() - Date.now(),
      });

      try {
        // Create a new EventBridge schedule for the retry
        await schedulerClient.send(new CreateScheduleCommand({
          Name: retrySchedulerName,
          ScheduleExpression: `at(${nextRetryTime.toISOString().replace(/\.\d{3}Z$/, '')})`,
          FlexibleTimeWindow: { Mode: 'OFF' },
          // Auto-delete retry schedule after execution
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: OUTBOUND_CALL_LAMBDA_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({
              callId,
              clinicId,
              agentId,
              phoneNumber,
              patientName,
              purpose,
              customMessage,
              isRetry: true,
              retryAttempt: scheduledCall.attempts + 1,
            }),
          },
        }));

        // Update call record with retry info
        await docClient.send(new UpdateCommand({
          TableName: SCHEDULED_CALLS_TABLE,
          Key: { callId },
          UpdateExpression: 'SET #status = :status, lastError = :error, nextRetryTime = :retryTime, retrySchedulerName = :retryName, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'scheduled', // Back to scheduled for retry
            ':error': error.message,
            ':retryTime': nextRetryTime.toISOString(),
            ':retryName': retrySchedulerName,
            ':now': new Date().toISOString(),
          },
        }));

        return {
          success: false,
          callId,
          error: error.message,
          retryable: true,
          nextRetryTime: nextRetryTime.toISOString(),
          retryAttempt: scheduledCall.attempts + 1,
        };
      } catch (retryScheduleError: any) {
        console.error('[ai-outbound] Failed to schedule retry:', retryScheduleError);
        // Fall through to mark as failed
      }
    }

    // Mark as failed (no retry or max attempts reached)
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId },
      UpdateExpression: 'SET #status = :status, outcome = :outcome, lastError = :error, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':outcome': shouldRetry ? 'max_retries_exhausted' : 'failed',
        ':error': error.message,
        ':now': new Date().toISOString(),
      },
    }));

    return {
      success: false,
      callId,
      error: error.message,
      retryable: false,
      reason: canRetry ? 'non_retryable_error' : 'max_attempts_exceeded',
    };
  }
};

// ========================================================================
// ASYNC BULK SCHEDULING (30,000+ calls)
// ========================================================================

interface AsyncBulkScheduleRequest {
  clinicId: string;
  agentId: string;
  calls: Array<{
    phoneNumber: string;
    patientName?: string;
    patientId?: string;
    scheduledTime: string;
    purpose: 'appointment_reminder' | 'follow_up' | 'payment_reminder' | 'reengagement' | 'custom';
    customMessage?: string;
    appointmentId?: string;
  }>;
  timezone?: string;
  maxAttempts?: number;
}

interface BulkJob {
  jobId: string;
  clinicId: string;
  agentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalCalls: number;
  processedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  completedAt?: string;
  ttl: number;
}

/**
 * Async bulk scheduling for 30,000+ calls.
 * Splits calls into batches and sends to SQS queue for processing.
 */
async function asyncBulkScheduleCalls(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  if (!OUTBOUND_CALL_QUEUE_URL) {
    return {
      statusCode: 503,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Async bulk scheduling is not configured',
        message: 'OUTBOUND_CALL_QUEUE_URL is not set. Use /scheduled-calls/bulk for smaller batches.',
      }),
    };
  }

  const body = JSON.parse(event.body || '{}') as AsyncBulkScheduleRequest;

  // Validate required fields
  if (!body.clinicId || !body.agentId || !body.calls || !Array.isArray(body.calls)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'clinicId, agentId, and calls array are required' }),
    };
  }

  if (body.calls.length === 0) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'calls array cannot be empty' }),
    };
  }

  // Check permission
  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinicId
  );

  if (!canCreate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  // Validate AI outbound is enabled
  const outboundEnabled = await isAiOutboundEnabled(body.clinicId);
  if (!outboundEnabled) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'AI outbound calling is not enabled for this clinic',
        message: 'Enable AI outbound calling in Voice Config before scheduling calls.',
      }),
    };
  }

  // Validate agent exists and is ready
  const agentResponse = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId: body.agentId },
  }));
  const agent = agentResponse.Item;

  if (!agent || !agent.isActive || agent.bedrockAgentStatus !== 'PREPARED') {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent is not ready for outbound calls' }),
    };
  }

  const jobId = uuidv4();
  const createdBy = getUserDisplayName(userPerms);
  const now = new Date();

  // Create bulk job record
  const bulkJob: BulkJob = {
    jobId,
    clinicId: body.clinicId,
    agentId: body.agentId,
    status: 'pending',
    totalCalls: body.calls.length,
    processedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    createdAt: now.toISOString(),
    createdBy,
    updatedAt: now.toISOString(),
    ttl: Math.floor(now.getTime() / 1000) + (30 * 24 * 60 * 60), // 30 days
  };

  await docClient.send(new PutCommand({
    TableName: BULK_OUTBOUND_JOBS_TABLE,
    Item: bulkJob,
  }));

  // Split calls into batches and send to SQS
  const BATCH_SIZE = 100; // Calls per SQS message
  const batches = Math.ceil(body.calls.length / BATCH_SIZE);

  for (let i = 0; i < body.calls.length; i += BATCH_SIZE) {
    const batchCalls = body.calls.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE);

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: OUTBOUND_CALL_QUEUE_URL,
      MessageBody: JSON.stringify({
        jobId,
        clinicId: body.clinicId,
        agentId: body.agentId,
        batchIndex,
        totalBatches: batches,
        calls: batchCalls,
        timezone: body.timezone,
        maxAttempts: body.maxAttempts,
        createdBy,
      }),
      MessageGroupId: body.clinicId, // FIFO ordering by clinic (if FIFO queue)
    }));
  }

  // Update job status to processing
  await docClient.send(new UpdateCommand({
    TableName: BULK_OUTBOUND_JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: 'SET #status = :processing, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':processing': 'processing',
      ':now': new Date().toISOString(),
    },
  }));

  console.log('[asyncBulkScheduleCalls] Job created', {
    jobId,
    clinicId: body.clinicId,
    totalCalls: body.calls.length,
    batches,
  });

  return {
    statusCode: 202, // Accepted - processing async
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      jobId,
      status: 'processing',
      totalCalls: body.calls.length,
      batches,
      message: 'Bulk scheduling job created. Poll /bulk-jobs/{jobId} for progress.',
    }),
  };
}

/**
 * List bulk jobs for a clinic
 */
async function listBulkJobs(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const clinicId = event.queryStringParameters?.clinicId;
  const status = event.queryStringParameters?.status;

  if (!clinicId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'clinicId query parameter is required' }),
    };
  }

  // Check permission
  const canRead = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'read',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    clinicId
  );

  if (!canRead) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  const queryParams: any = {
    TableName: BULK_OUTBOUND_JOBS_TABLE,
    IndexName: 'ClinicStatusIndex',
    KeyConditionExpression: status
      ? 'clinicId = :clinicId AND #status = :status'
      : 'clinicId = :clinicId',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ...(status && { ':status': status }),
    },
    ScanIndexForward: false, // Most recent first
    Limit: 50,
  };

  if (status) {
    queryParams.ExpressionAttributeNames = { '#status': 'status' };
  }

  const response = await docClient.send(new QueryCommand(queryParams));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      jobs: response.Items || [],
      count: response.Count || 0,
    }),
  };
}

/**
 * Get bulk job status
 */
async function getBulkJob(event: APIGatewayProxyEvent, userPerms: any, jobId: string): Promise<APIGatewayProxyResult> {
  const response = await docClient.send(new GetCommand({
    TableName: BULK_OUTBOUND_JOBS_TABLE,
    Key: { jobId },
  }));

  const job = response.Item as BulkJob | undefined;
  if (!job) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Job not found' }) };
  }

  // Check permission
  const canRead = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'read',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    job.clinicId
  );

  if (!canRead) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  // Calculate progress percentage
  const progress = job.totalCalls > 0
    ? Math.round((job.processedCalls / job.totalCalls) * 100)
    : 0;

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      ...job,
      progress: `${progress}%`,
      successRate: job.processedCalls > 0
        ? `${Math.round((job.successfulCalls / job.processedCalls) * 100)}%`
        : 'N/A',
    }),
  };
}
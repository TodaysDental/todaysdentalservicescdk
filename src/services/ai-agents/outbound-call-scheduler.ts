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
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getUserDisplayName,
} from '../../shared/utils/permissions-helper';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const schedulerClient = new SchedulerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const chimeVoiceClient = new ChimeSDKVoiceClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const ssmClient = new SSMClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE || 'ScheduledCalls';
const OUTBOUND_CALL_LAMBDA_ARN = process.env.OUTBOUND_CALL_LAMBDA_ARN || '';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || '';
const CLINICS_TABLE = process.env.CLINICS_TABLE || 'Clinics';
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const SMA_ID_MAP_PARAMETER_NAME = process.env.SMA_ID_MAP_PARAMETER_NAME || '';

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

    // POST /scheduled-calls/bulk - Bulk create scheduled calls
    if (path.endsWith('/scheduled-calls/bulk') && httpMethod === 'POST') {
      return await bulkScheduleCalls(event, userPerms);
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
  
  if (!clinicId) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'clinicId is required' }) };
  }

  // Check access
  const userClinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin && !userClinicIds.includes(clinicId)) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Access denied' }) };
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
    ScanIndexForward: false, // Newest first
  }));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      calls: response.Items || [],
      count: response.Items?.length || 0,
    }),
  };
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

  const callId = uuidv4();
  const timestamp = new Date().toISOString();
  const createdBy = getUserDisplayName(userPerms);
  const schedulerName = `outbound-call-${callId}`;

  // Parse scheduled time
  const scheduledDate = new Date(body.scheduledTime);
  if (scheduledDate <= new Date()) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'scheduledTime must be in the future' }),
    };
  }

  const scheduledCall: ScheduledCall = {
    callId,
    clinicId: body.clinicId,
    agentId: body.agentId,
    phoneNumber: body.phoneNumber,
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

  // Create EventBridge schedule
  try {
    const scheduleResponse = await schedulerClient.send(new CreateScheduleCommand({
      Name: schedulerName,
      ScheduleExpression: `at(${scheduledDate.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: OUTBOUND_CALL_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          callId,
          clinicId: body.clinicId,
          agentId: body.agentId,
          phoneNumber: body.phoneNumber,
          patientName: body.patientName,
          purpose: body.purpose,
          customMessage: body.customMessage,
        }),
      },
    }));

    scheduledCall.schedulerArn = scheduleResponse.ScheduleArn;
  } catch (error: any) {
    console.error('Failed to create EventBridge schedule:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Failed to create schedule', details: error.message }),
    };
  }

  // Save to DynamoDB
  await docClient.send(new PutCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Item: scheduledCall,
  }));

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Outbound call scheduled successfully',
      call: scheduledCall,
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

  // Delete EventBridge schedule
  if (call.schedulerName) {
    try {
      await schedulerClient.send(new DeleteScheduleCommand({
        Name: call.schedulerName,
      }));
    } catch (error: any) {
      console.error('Failed to delete EventBridge schedule:', error);
      // Continue anyway - schedule might already be deleted
    }
  }

  // Update status
  await docClient.send(new UpdateCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Key: { callId },
    UpdateExpression: 'SET #status = :cancelled, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':cancelled': 'cancelled',
      ':now': new Date().toISOString(),
    },
  }));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Scheduled call cancelled successfully',
      callId,
    }),
  };
}

// ========================================================================
// BULK SCHEDULING
// ========================================================================

/**
 * Create a single scheduled call (internal function for bulk operations)
 */
async function createSingleScheduledCall(
  request: CreateScheduledCallRequest,
  createdBy: string
): Promise<{ success: boolean; callId?: string; error?: string }> {
  const callId = uuidv4();
  const timestamp = new Date().toISOString();
  const schedulerName = `outbound-call-${callId}`;

  // Parse scheduled time
  const scheduledDate = new Date(request.scheduledTime);
  if (scheduledDate <= new Date()) {
    return { success: false, error: 'scheduledTime must be in the future' };
  }

  const scheduledCall: ScheduledCall = {
    callId,
    clinicId: request.clinicId,
    agentId: request.agentId,
    phoneNumber: request.phoneNumber,
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

  // Create EventBridge schedule
  try {
    const scheduleResponse = await schedulerClient.send(new CreateScheduleCommand({
      Name: schedulerName,
      ScheduleExpression: `at(${scheduledDate.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: OUTBOUND_CALL_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          callId,
          clinicId: request.clinicId,
          agentId: request.agentId,
          phoneNumber: request.phoneNumber,
          patientName: request.patientName,
          purpose: request.purpose,
          customMessage: request.customMessage,
        }),
      },
    }));

    scheduledCall.schedulerArn = scheduleResponse.ScheduleArn;
  } catch (error: any) {
    console.error('Failed to create EventBridge schedule:', error);
    return { success: false, error: error.message };
  }

  // Save to DynamoDB
  await docClient.send(new PutCommand({
    TableName: SCHEDULED_CALLS_TABLE,
    Item: scheduledCall,
  }));

  return { success: true, callId };
}

/**
 * Bulk schedule multiple calls at once
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
          createdBy
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

  const { callId, clinicId, agentId, phoneNumber, patientName, purpose, customMessage } = event;

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

    // Get SMA ID for this clinic (uses existing Chime infrastructure)
    const smaId = await getSmaIdForClinic(clinicId);
    if (!smaId) {
      throw new Error(`No SIP Media Application configured for clinic ${clinicId}`);
    }

    console.log('[ai-outbound] Initiating SIP call via existing Chime infrastructure', {
      fromPhoneNumber: clinic.phoneNumber,
      toPhoneNumber: phoneNumber,
      smaId,
      purpose,
    });

    // Initiate call using EXISTING Chime SIP Media Application
    // The SMA's Lambda (inbound-router.ts) will route based on callType: 'AiOutbound'
    const callCommandInput = {
      FromPhoneNumber: clinic.phoneNumber,
      ToPhoneNumber: phoneNumber,
      SipMediaApplicationId: smaId,
      ArgumentsMap: {
        callType: 'AiOutbound', // Tells inbound-router this is an AI-initiated call
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
    if (!transactionId) {
      throw new Error('Chime did not return a TransactionId');
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


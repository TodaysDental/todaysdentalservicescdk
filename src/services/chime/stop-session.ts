import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt } from '../../shared/utils/permissions-helper';
import { getSmaIdForClinic } from './utils/sma-map';
import { DistributedLock } from './utils/distributed-lock';

const ddb = getDynamoDBClient();
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;

/**
 * Helper to find and cleanup an active call
 * FIX: Uses distributed lock with unified lock key to prevent race conditions
 */
async function cleanupActiveCall(callId: string, agentId: string): Promise<void> {
    if (!callId || !CALL_QUEUE_TABLE_NAME) return;
    
    console.log('[stop-session] Cleaning up active call', { callId, agentId });
    
    // FIX: Acquire unified call-state lock to prevent race conditions with other operations
    // (hold, resume, transfer, hungup) that may be processing this call simultaneously
    let lock: DistributedLock | null = null;
    
    if (LOCKS_TABLE_NAME) {
        lock = new DistributedLock(ddb, {
            tableName: LOCKS_TABLE_NAME,
            lockKey: `call-state-${callId}`, // Unified lock key matching hold-call.ts and resume-call.ts
            ttlSeconds: 15,
            maxRetries: 3,
            retryDelayMs: 100
        });
        
        const lockAcquired = await lock.acquire();
        if (!lockAcquired) {
            console.warn('[stop-session] Could not acquire lock for call cleanup - another operation in progress', { callId });
            // Continue anyway - the other operation will handle the call
            return;
        }
    } else {
        console.warn('[stop-session] LOCKS_TABLE_NAME not configured - cleanup may have race conditions');
    }
    
    try {
        // Find the call record
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));
        
        if (!callRecords || callRecords.length === 0) {
            console.warn('[stop-session] Call record not found for cleanup', { callId });
            return;
        }
        
        const callRecord = callRecords[0];
        const { clinicId, queuePosition, status } = callRecord;
        
        // Only cleanup calls that are still active
        if (['completed', 'abandoned', 'failed'].includes(status)) {
            console.log('[stop-session] Call already in terminal state', { callId, status });
            return;
        }
        
        // Try to hangup via SMA first
        const smaId = getSmaIdForClinic(clinicId);
        if (smaId) {
            try {
                await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: smaId,
                    TransactionId: callId,
                    Arguments: {
                        Action: 'Hangup',
                        Reason: 'agent_session_stopped'
                    }
                }));
                console.log('[stop-session] SMA hangup successful', { callId });
            } catch (smaErr: any) {
                // Call may already be disconnected
                console.warn('[stop-session] SMA hangup failed (call may already be ended)', {
                    callId,
                    error: smaErr.message
                });
            }
        }
        
        // Update call record to abandoned state
        // FIX: Add ConditionExpression to ensure call hasn't already been completed
        const timestamp = new Date().toISOString();
        try {
            await ddb.send(new UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                UpdateExpression: 'SET #status = :status, callStatus = :status, completedAt = :timestamp, ' +
                                 'abandonedReason = :reason, abandonedByAgentId = :agentId',
                ConditionExpression: 'attribute_exists(callId) AND NOT #status IN (:completed, :abandoned, :failed)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'abandoned',
                    ':timestamp': timestamp,
                    ':reason': 'agent_session_stopped',
                    ':agentId': agentId,
                    ':completed': 'completed',
                    ':abandoned': 'abandoned',
                    ':failed': 'failed'
                }
            }));
            console.log('[stop-session] Call marked as abandoned', { callId, clinicId });
        } catch (updateErr: any) {
            if (updateErr.name === 'ConditionalCheckFailedException') {
                console.log('[stop-session] Call already in terminal state during update', { callId });
            } else {
                throw updateErr;
            }
        }
        
    } catch (err: any) {
        console.error('[stop-session] Error cleaning up call', { callId, error: err.message });
        // Don't throw - we want to continue with session stop even if cleanup fails
    } finally {
        // FIX: Always release lock if acquired
        if (lock) {
            await lock.release();
        }
    }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Log function invocation with request metadata
  console.log('[stop-session] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId,
    sourceIp: (event.requestContext as any)?.identity?.sourceIp,
    userAgent: (event.requestContext as any)?.identity?.userAgent
  });

  const corsHeaders = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] });
  if (event.httpMethod === 'OPTIONS') {
    console.log('[stop-session] Handling OPTIONS preflight request');
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    console.log('[stop-session] Verifying auth token', { hasToken: !!authz });
    
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      console.warn('[stop-session] Auth verification failed', { 
        code: verifyResult.code, 
        message: verifyResult.message 
      });
      return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }
    
    console.log('[stop-session] Auth verification successful');

    const agentId = getUserIdFromJwt(verifyResult.payload!);
    if (!agentId) {
      console.error('[stop-session] Missing subject claim in token');
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing sub' }) };
    }
    
    console.log('[stop-session] Processing stop request for agent:', agentId);

    // 1. Get current presence record to find active calls and meeting info
    console.log('[stop-session] Retrieving current presence record', { agentId });
    const { Item } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));
    
    console.log('[stop-session] Current presence state', {
      agentExists: !!Item,
      status: Item?.status,
      hasMeetingInfo: !!(Item?.meetingInfo?.MeetingId),
      currentCallId: Item?.currentCallId,
      heldCallId: Item?.heldCallId,
      ringingCallId: Item?.ringingCallId
    });

    // 2. FIX: Cleanup any active calls BEFORE deleting the meeting
    // This ensures customers aren't left stranded
    const callsToCleanup: string[] = [];
    if (Item?.currentCallId) callsToCleanup.push(Item.currentCallId);
    if (Item?.heldCallId && Item.heldCallId !== Item?.currentCallId) callsToCleanup.push(Item.heldCallId);
    if (Item?.ringingCallId && !callsToCleanup.includes(Item.ringingCallId)) callsToCleanup.push(Item.ringingCallId);
    
    if (callsToCleanup.length > 0) {
        console.log('[stop-session] Cleaning up active calls before session stop', { 
            callCount: callsToCleanup.length,
            callIds: callsToCleanup 
        });
        
        // Cleanup all calls in parallel
        await Promise.all(callsToCleanup.map(callId => cleanupActiveCall(callId, agentId)));
    }

    // 3. Delete the Chime meeting (agent's session meeting)
    if (Item && Item.meetingInfo?.MeetingId) {
        const meetingId = Item.meetingInfo.MeetingId;
        console.log('[stop-session] Attempting to delete Chime meeting', { meetingId });
        
        try {
            await chimeClient.send(new DeleteMeetingCommand({
                MeetingId: meetingId,
            }));
            console.log('[stop-session] Successfully deleted Chime meeting', { meetingId });
        } catch (err: any) {
            // Log and ignore if meeting already deleted
            console.warn('[stop-session] Could not delete meeting (may already be ended)', {
              meetingId,
              error: err.message,
              errorCode: err.name
            });
        }
    }

    // 4. Update agent status to Offline in DynamoDB
    // FIX: Also remove all call-related fields to ensure clean state
    console.log('[stop-session] Updating agent status to Offline', { agentId });
    await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt ' +
                         'REMOVE activeClinicIds, meetingInfo, attendeeInfo, #ttl, ' +
                         'currentCallId, heldCallId, ringingCallId, callStatus, ' +
                         'heldCallMeetingId, heldCallAttendeeId, inboundMeetingInfo, inboundAttendeeInfo, ' +
                         'ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ' +
                         'ringingCallTransferAgentId, ringingCallTransferMode',
        ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
            ':status': 'Offline',
            ':updatedAt': new Date().toISOString(),
        },
    }));
    
    console.log('[stop-session] Agent status updated to Offline successfully');

    const responseBody = { 
        success: true, 
        message: 'Session stopped',
        cleanedUpCalls: callsToCleanup.length
    };
    console.log('[stop-session] Request completed successfully', responseBody);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody),
    };
  } catch (err: any) {
    const errorContext = {
      message: err?.message,
      code: err?.name || err?.code,
      stack: err?.stack,
      requestId: event.requestContext?.requestId
    };
    console.error('[stop-session] Error stopping session:', errorContext);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Failed to stop session', 
        error: err?.message,
        code: err?.name || err?.code
      }),
    };
  }
};

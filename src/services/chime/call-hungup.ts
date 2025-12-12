import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
// CORRECTED IMPORT: Use UpdateSipMediaApplicationCallCommand to manipulate an active call
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { createCheckQueueForWork } from './utils/check-queue-for-work';
import { CHIME_CONFIG } from './config';
import { isValidStateTransition, CALL_STATE_MACHINE, getValidNextStates } from '../shared/utils/state-machine';
import { DistributedLock } from './utils/distributed-lock';

const ddb = getDynamoDBClient();
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

// CRITICAL FIX #6: Initialize checkQueueForWork to assign queued calls after hangup
const checkQueueForWork = createCheckQueueForWork({
    ddb,
    callQueueTableName: CALL_QUEUE_TABLE_NAME,
    agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
    chime,
    chimeVoiceClient
}); 


/**
 * Lambda handler for call hangup notification
 * This is triggered by the frontend when an agent hangs up.
 * It is updated to explicitly terminate the entire call session using Chime SDK Voice API.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Call hungup event:', JSON.stringify(event, null, 2));
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing request body' }) 
            };
        }
        
        // CRITICAL FIX: Add JWT verification for security
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[call-hungup] Auth verification failed', { 
                code: verifyResult.code, 
                message: verifyResult.message 
            });
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        console.log('[call-hungup] Auth verification successful');
        const requestingAgentId = getUserIdFromJwt(verifyResult.payload!);
        if (!requestingAgentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId, reason } = body;

        if (!callId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameter: callId' }) 
            };
        }
        
        // CRITICAL FIX: Verify the requesting agent is the one hanging up the call
        if (agentId && requestingAgentId !== agentId) {
            console.warn('[call-hungup] Authorization failed - agent attempting to hang up call they are not on', {
                requestingAgentId,
                agentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden: You can only hang up calls you are on' })
            };
        }

        const { Items: callLookupRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));

        const callMetadata = callLookupRecords && callLookupRecords.length > 0 ? callLookupRecords[0] : undefined;
        if (!callMetadata) {
            console.error('[call-hungup] Call record not found for hangup', { callId });
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        // FIX: Add clinic authorization check (was missing)
        if (callMetadata.clinicId) {
            const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, callMetadata.clinicId);
            if (!authzCheck.authorized) {
                console.warn('[call-hungup] Agent not authorized for call clinic', {
                    agentId: requestingAgentId,
                    callId,
                    clinicId: callMetadata.clinicId,
                    reason: authzCheck.reason
                });
                return {
                    statusCode: 403,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'You are not authorized to hang up calls for this clinic',
                        reason: authzCheck.reason
                    })
                };
            }
            console.log('[call-hungup] Clinic authorization verified', { requestingAgentId, clinicId: callMetadata.clinicId });
        }

        // CRITICAL FIX #4: Add timeout for stale holds and supervisor override
        // CRITICAL FIX: Use configurable hold timeout instead of hardcoded value
        const currentCallStatus = callMetadata.status || callMetadata.callStatus;
        if (currentCallStatus === 'on_hold' && callMetadata.heldByAgentId && agentId && callMetadata.heldByAgentId !== agentId) {
            // Check if hold is stale or requester is supervisor
            const holdStartTime = callMetadata.holdStartTime ? new Date(callMetadata.holdStartTime).getTime() : 0;
            const holdDuration = holdStartTime > 0 ? (Date.now() - holdStartTime) / 1000 : 0;
            const MAX_HOLD_DURATION = CHIME_CONFIG.HOLD.MAX_HOLD_DURATION_MINUTES * 60; // Use config
            const payload = verifyResult.payload as any;
            const isSupervisor = requestingAgentId && payload && 
                                (payload.isSuperAdmin || payload.isGlobalSuperAdmin || 
                                 payload.roles?.includes('supervisor') || payload.roles?.includes('admin'));
            
            if (holdDuration > MAX_HOLD_DURATION) {
                console.warn('[call-hungup] Overriding stale hold', {
                    callId,
                    heldByAgentId: callMetadata.heldByAgentId,
                    holdDuration,
                    maxHoldDuration: MAX_HOLD_DURATION,
                    requestingAgentId: agentId
                });
            } else if (isSupervisor && CHIME_CONFIG.HOLD.ALLOW_SUPERVISOR_OVERRIDE) {
                console.warn('[call-hungup] Supervisor override of hold', {
                    callId,
                    heldByAgentId: callMetadata.heldByAgentId,
                    requestingAgentId: agentId
                });
            } else {
                console.warn('[call-hungup] Blocking hangup because call is on hold by another agent', {
                    callId,
                    heldByAgentId: callMetadata.heldByAgentId,
                    requestingAgentId: agentId,
                    holdDuration: Math.floor(holdDuration)
                });
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Call is currently on hold by another agent. Please wait for them to resume or complete the hold.',
                        holdDuration: Math.floor(holdDuration),
                        heldByAgentId: callMetadata.heldByAgentId
                    })
                };
            }
        }

        const clinicId = typeof callMetadata.clinicId === 'string' ? callMetadata.clinicId : undefined;
        
        // FIX: Determine final status based on state machine validation
        // 'ringing' calls should transition to 'abandoned', not 'completed'
        let finalStatus: 'completed' | 'abandoned' = 'completed';
        
        if (currentCallStatus && !isValidStateTransition(currentCallStatus, 'completed', CALL_STATE_MACHINE)) {
            // Special case: 'ringing' should transition to 'abandoned' not 'completed' when hung up
            if (isValidStateTransition(currentCallStatus, 'abandoned', CALL_STATE_MACHINE)) {
                console.log(`[call-hungup] Using 'abandoned' instead of 'completed' for ${currentCallStatus} -> transition`);
                finalStatus = 'abandoned';
            } else {
                const validNextStates = getValidNextStates(currentCallStatus, CALL_STATE_MACHINE);
                console.warn('[call-hungup] Invalid state transition', {
                    callId,
                    currentStatus: currentCallStatus,
                    attemptedTransition: 'completed',
                    validNextStates
                });
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: `Cannot hang up call in ${currentCallStatus} state`,
                        currentStatus: currentCallStatus,
                        validNextStates
                    })
                };
            }
        }
        
        const smaId = getSmaIdForClinic(clinicId);
        if (!smaId) {
            console.error('[call-hungup] Missing SMA mapping for clinic', { clinicId, callId });
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call hangup is not configured for this clinic' })
            };
        }

        // 1. Hangup via SMA FIRST, then atomically update database
        // CRITICAL FIX #3: Accept eventual consistency - SMA is source of truth
        // If SMA succeeds but DB fails, cleanup-monitor will fix DB state
        // If SMA fails, call may already be disconnected - continue with DB cleanup
        try {
            await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: callId,
                Arguments: {
                    Action: "Hangup"
                }
            }));
            console.log(`[call-hungup] SMA hangup successful for call ${callId}`);
        } catch (smaError: any) {
            console.error(`[call-hungup] SMA hangup failed for call ${callId}:`, smaError);
            // Log but continue - we still need to clean up database state
            // Even if SMA hangup fails, the call is likely already disconnected
            // Cleanup-monitor will reconcile any inconsistencies
        }
        
        // 2. ATOMIC: Update agent status and call record together in single transaction
        // This ensures agent isn't marked as available until both updates succeed
        // CRITICAL FIX: Update BOTH status AND callStatus fields for consistency
        const timestamp = new Date().toISOString();
        
        // Calculate duration BEFORE the transaction so we can include it atomically
        let calculatedDuration = 0;
        const startTime = callMetadata.acceptedAt ? Date.parse(callMetadata.acceptedAt) : null;
        if (startTime && !isNaN(startTime)) {
            const endTime = Date.now();
            calculatedDuration = Math.max(0, Math.floor((endTime - startTime) / 1000));
            console.log(`[call-hungup] Call ${callId} duration calculated from acceptedAt: ${calculatedDuration}s`);
        } else {
            console.warn(`[call-hungup] No acceptedAt timestamp for ${callId} - cannot calculate duration`);
        }
        
        if (agentId && callMetadata.clinicId && typeof callMetadata.queuePosition !== 'undefined') {
            try {
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                // CRITICAL FIX: Include stats update atomically to prevent data drift
                                UpdateExpression: 'SET #status = :online, lastActivityAt = :now ADD completedCalls :one, totalCallDuration :duration REMOVE currentCallId, ringingCallId, heldCallId, heldCallMeetingId, callStatus',
                                ConditionExpression: 'currentCallId = :callId OR ringingCallId = :callId OR heldCallId = :callId',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':online': 'Online',
                                    ':now': timestamp,
                                    ':callId': callId,
                                    ':one': 1,
                                    ':duration': calculatedDuration
                                }
                            }
                        },
                        {
                            Update: {
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId: callMetadata.clinicId, queuePosition: callMetadata.queuePosition },
                                // CRITICAL FIX: Use finalStatus (completed or abandoned) based on state machine
                                UpdateExpression: 'SET #status = :finalStatus, callStatus = :finalStatus, completedAt = :timestamp, completedByAgentId = :agentId, callDuration = :duration',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':finalStatus': finalStatus,
                                    ':timestamp': timestamp,
                                    ':agentId': agentId,
                                    ':duration': calculatedDuration
                                }
                            }
                        }
                    ]
                }));
                console.log('[call-hungup] Hangup completed atomically', { callId, agentId, finalStatus, duration: calculatedDuration });
            } catch (txErr: any) {
                if (txErr.name === 'TransactionCanceledException') {
                    console.warn('[call-hungup] Hangup transaction failed - agent state may be inconsistent', {
                        callId, agentId, reasons: txErr.CancellationReasons
                    });
                    // Return error so caller can retry
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Call state changed during hangup. Please retry.' })
                    };
                }
                throw txErr;
            }
        } else if (agentId) {
            // Fallback if call doesn't have queue key: update agent status AND try to find/update call record
            // FIX: Try to find call record using callId-index and update it if found
            console.warn('[call-hungup] Call record missing queue key, attempting alternative update', { callId, agentId });
            
            try {
                // Find the call record using callId-index
                const { Items: callRecords } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :callId',
                    ExpressionAttributeValues: { ':callId': callId }
                }));
                
                if (callRecords && callRecords.length > 0) {
                    const foundCall = callRecords[0];
                    // Now we have the correct keys, attempt atomic update
                    // CRITICAL FIX: Use finalStatus and include stats atomically
                    await ddb.send(new TransactWriteCommand({
                        TransactItems: [
                            {
                                Update: {
                                    TableName: AGENT_PRESENCE_TABLE_NAME,
                                    Key: { agentId },
                                    UpdateExpression: 'SET #status = :online, lastActivityAt = :now ADD completedCalls :one, totalCallDuration :duration REMOVE currentCallId, ringingCallId, heldCallId, heldCallMeetingId, callStatus',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':online': 'Online',
                                        ':now': timestamp,
                                        ':one': 1,
                                        ':duration': calculatedDuration
                                    }
                                }
                            },
                            {
                                Update: {
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId: foundCall.clinicId, queuePosition: foundCall.queuePosition },
                                    UpdateExpression: 'SET #status = :finalStatus, callStatus = :finalStatus, completedAt = :timestamp, callDuration = :duration',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':finalStatus': finalStatus,
                                        ':timestamp': timestamp,
                                        ':duration': calculatedDuration
                                    }
                                }
                            }
                        ]
                    }));
                    console.log(`[call-hungup] Atomic fallback update successful for call ${callId}`, { finalStatus, duration: calculatedDuration });
                } else {
                    // Call record truly not found, just update agent with stats
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId },
                        UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp ADD completedCalls :one, totalCallDuration :duration REMOVE currentCallId, ringingCallId, heldCallId',
                        ExpressionAttributeNames: {
                            '#status': 'status'
                        },
                        ExpressionAttributeValues: {
                            ':status': 'Online',
                            ':timestamp': new Date().toISOString(),
                            ':one': 1,
                            ':duration': calculatedDuration
                        }
                    }));
                    console.warn(`[call-hungup] Call record not found for ${callId}, only updated agent status with stats`);
                }
            } catch (fallbackErr: any) {
                console.error('[call-hungup] Fallback update failed:', fallbackErr);
                // Still try to update agent status as last resort (include stats)
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp ADD completedCalls :one REMOVE currentCallId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':status': 'Online',
                        ':timestamp': new Date().toISOString(),
                        ':one': 1
                    }
                }));
            }
            console.log(`[call-hungup] Agent ${agentId} marked as Online after successful hangup`);
        }

        // CRITICAL FIX #6: Proactively check for queued work for this newly-free agent
        // This ensures queued calls are routed to agents after they hang up
        // FIX: Use distributed lock to prevent race condition where multiple calls could be assigned
        if (agentId) {
            if (LOCKS_TABLE_NAME) {
                const lock = new DistributedLock(ddb, {
                    tableName: LOCKS_TABLE_NAME,
                    lockKey: `queue-check-${agentId}`,
                    ttlSeconds: 10,
                    maxRetries: 3,
                    retryDelayMs: 100
                });

                const lockAcquired = await lock.acquire();
                if (lockAcquired) {
                    try {
                        const { Item: refreshedAgentInfo } = await ddb.send(new GetCommand({
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId }
                        }));
                        
                        // Only check queue if agent is still Online (no call assigned during lock acquisition)
                        if (refreshedAgentInfo && refreshedAgentInfo.status === 'Online' && !refreshedAgentInfo.currentCallId) {
                            await checkQueueForWork(agentId, refreshedAgentInfo);
                        } else {
                            console.log(`[call-hungup] Agent ${agentId} already has a call or is not online, skipping queue check`);
                        }
                    } catch (queueErr) {
                        // Non-fatal error - log but continue
                        console.error('[call-hungup] Error checking queue for work:', queueErr);
                    } finally {
                        await lock.release();
                    }
                } else {
                    console.log(`[call-hungup] Could not acquire lock for queue check - another operation in progress for ${agentId}`);
                }
            } else {
                // Fallback if locks table not configured - use original logic with warning
                console.warn('[call-hungup] LOCKS_TABLE_NAME not configured - queue check may have race conditions');
                try {
                    const { Item: refreshedAgentInfo } = await ddb.send(new GetCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId }
                    }));
                    
                    if (refreshedAgentInfo && refreshedAgentInfo.status === 'Online') {
                        await checkQueueForWork(agentId, refreshedAgentInfo);
                    }
                } catch (queueErr) {
                    console.error('[call-hungup] Error checking queue for work:', queueErr);
                }
            }
        }

        // Return success response
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Call hung up successfully',
                callId,
                duration: calculatedDuration
            })
        };

    } catch (error) {
        console.error('Error processing call hangup:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

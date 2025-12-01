import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
// CORRECTED IMPORT: Use UpdateSipMediaApplicationCallCommand to manipulate an active call
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt } from '../../shared/utils/permissions-helper';
import { createCheckQueueForWork } from './utils/check-queue-for-work';

const ddb = getDynamoDBClient();
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const chimeVoiceClient = new ChimeSDKVoiceClient({});
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });
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
        // CRITICAL FIX: Don't trust client-provided duration, we'll calculate it server-side
        // Initialize variable for server-calculated duration
        let calculatedDuration = 0;

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

        // CRITICAL FIX #4: Add timeout for stale holds and supervisor override
        const currentCallStatus = callMetadata.status || callMetadata.callStatus;
        if (currentCallStatus === 'on_hold' && callMetadata.heldByAgentId && agentId && callMetadata.heldByAgentId !== agentId) {
            // Check if hold is stale (>30 minutes) or requester is supervisor
            const holdStartTime = callMetadata.holdStartTime ? new Date(callMetadata.holdStartTime).getTime() : 0;
            const holdDuration = holdStartTime > 0 ? (Date.now() - holdStartTime) / 1000 : 0;
            const MAX_HOLD_DURATION = 30 * 60; // 30 minutes
            const isSupervisor = requestingAgentId && verifyResult.payload && (verifyResult.payload.isSuperAdmin || verifyResult.payload.isGlobalSuperAdmin);
            
            if (holdDuration > MAX_HOLD_DURATION) {
                console.warn('[call-hungup] Overriding stale hold', {
                    callId,
                    heldByAgentId: callMetadata.heldByAgentId,
                    holdDuration,
                    requestingAgentId: agentId
                });
            } else if (isSupervisor) {
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
        if (agentId && callMetadata.clinicId && typeof callMetadata.queuePosition !== 'undefined') {
            try {
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                UpdateExpression: 'SET #status = :online, lastActivityAt = :now REMOVE currentCallId, ringingCallId',
                                ConditionExpression: 'currentCallId = :callId OR ringingCallId = :callId',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':online': 'Online',
                                    ':now': new Date().toISOString(),
                                    ':callId': callId
                                }
                            }
                        },
                        {
                            Update: {
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId: callMetadata.clinicId, queuePosition: callMetadata.queuePosition },
                                UpdateExpression: 'SET #status = :completed, completedAt = :timestamp, completedByAgentId = :agentId',
                                ConditionExpression: 'assignedAgentId = :agentId',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':completed': 'completed',
                                    ':timestamp': new Date().toISOString(),
                                    ':agentId': agentId
                                }
                            }
                        }
                    ]
                }));
                console.log('[call-hungup] Hangup completed atomically', { callId, agentId });
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
            // Fallback if call doesn't have queue key: just update agent status
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp REMOVE currentCallId',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': 'Online',
                    ':timestamp': new Date().toISOString()
                }
            }));
            console.log(`[call-hungup] Agent ${agentId} marked as Online after successful hangup`);
        }

        // CRITICAL FIX #8: Use consistent timestamp for duration calculation
        try {
            const callRecord = callMetadata;
            // Always use acceptedAt as the single source of truth for agent talk time
            const startTime = callRecord.acceptedAt ? Date.parse(callRecord.acceptedAt) : null;
            
            if (startTime && !isNaN(startTime)) {
                const endTime = Date.now();
                calculatedDuration = Math.max(0, Math.floor((endTime - startTime) / 1000));
                console.log(`[call-hungup] Call ${callId} duration calculated from acceptedAt: ${calculatedDuration}s`);
                
                // Calculate queue wait time separately for analytics
                if (callRecord.queueEntryTimeIso) {
                    const queueStartTime = Date.parse(callRecord.queueEntryTimeIso);
                    if (!isNaN(queueStartTime) && queueStartTime < startTime) {
                        const queueDuration = Math.floor((startTime - queueStartTime) / 1000);
                        console.log(`[call-hungup] Call ${callId} queue wait time: ${queueDuration}s`);
                        // Store queue duration if needed for analytics
                    }
                }
            } else {
                console.warn(`[call-hungup] No acceptedAt timestamp for ${callId} - cannot calculate duration`);
                calculatedDuration = 0;
            }

            // Log call statistics for the agent
            if (agentId) {
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'ADD completedCalls :one, totalCallDuration :duration',
                    ExpressionAttributeValues: {
                        ':one': 1,
                        ':duration': calculatedDuration
                    }
                }));
            }
        } catch (durationErr) {
            console.error(`[call-hungup] Error calculating call duration:`, durationErr);
            // Still increment completed calls counter even if duration calculation fails
            if (agentId) {
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'ADD completedCalls :one',
                    ExpressionAttributeValues: {
                        ':one': 1
                    }
                }));
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

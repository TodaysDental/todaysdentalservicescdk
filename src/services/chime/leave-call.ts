import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { createCheckQueueForWork } from './utils/check-queue-for-work';
import { DistributedLock } from './utils/distributed-lock';
import { isPushNotificationsEnabled, sendCallEndedToAgent } from './utils/push-notifications';
import { CHIME_CONFIG } from './config';

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
const ddb = getDynamoDBClient();

// CRITICAL FIX: Add helper for finding call record
async function getCallRecord(callId: string): Promise<any | null> {
    const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId }
    }));
    return callRecords && callRecords.length > 0 ? callRecords[0] : null;
}

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
// Note: These clients are needed for checkQueueForWork utility
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

// Initialize checkQueueForWork utility - requires Chime clients for assigning queued calls
const checkQueueForWork = createCheckQueueForWork({
    ddb,
    callQueueTableName: CALL_QUEUE_TABLE_NAME,
    agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
    chime,
    chimeVoiceClient
});

/**
 * Lambda handler for non-destructive call leave
 * This is triggered when an agent leaves a call without ending it (e.g., during transfer)
 * It updates the agent's status but does NOT terminate the Chime SMA call
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Leave call event:', JSON.stringify(event, null, 2));

    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        // Authenticate request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[leave-call] Auth verification failed', verifyResult);
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        const requestingAgentId = getUserIdFromJwt(verifyResult.payload!);

        if (!event.body) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing request body' })
            };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId, reason, duration } = body;

        if (!callId || !agentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' })
            };
        }

        if (!requestingAgentId || requestingAgentId !== agentId) {
            console.warn('[leave-call] Agent token mismatch', { requestingAgentId, agentId });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden' })
            };
        }

        // CRITICAL FIX: Fetch call record to verify clinic authorization
        const callRecord = await getCallRecord(callId);
        if (!callRecord) {
            console.warn('[leave-call] Call not found', { callId, agentId });
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        // CRITICAL FIX: Add clinic authorization check (was missing)
        const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, callRecord.clinicId);
        if (!authzCheck.authorized) {
            console.warn('[leave-call] Agent not authorized for call clinic', {
                agentId,
                callId,
                clinicId: callRecord.clinicId,
                reason: authzCheck.reason
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'You are not authorized for this clinic',
                    reason: authzCheck.reason
                })
            };
        }

        const { Item: agentInfo } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId }
        }));

        if (!agentInfo) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Agent presence not found' })
            };
        }

        const isOnCall = agentInfo.currentCallId === callId || agentInfo.ringingCallId === callId || agentInfo.heldCallId === callId;
        if (!isOnCall) {
            console.warn('[leave-call] Agent attempted to leave call they are not on', { agentId, callId });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'You are not actively connected to this call' })
            };
        }

        // CRITICAL FIX: Use transaction to update agent status AND stats atomically
        // This prevents race condition where another call could be assigned between status update and stats update
        const timestamp = new Date().toISOString();
        try {
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId },
                            UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp, ' +
                                'lastCompletedCallId = :callId, lastCompletedAt = :timestamp ' +
                                'ADD completedCalls :one, totalCallDuration :duration ' +
                                'REMOVE currentCallId, ringingCallId, heldCallId, heldCallMeetingId, heldCallAttendeeId, callStatus, inboundMeetingInfo, inboundAttendeeInfo',
                            ExpressionAttributeNames: {
                                '#status': 'status'
                            },
                            ConditionExpression: 'currentCallId = :callId OR ringingCallId = :callId OR heldCallId = :callId',
                            ExpressionAttributeValues: {
                                ':status': 'Online', // Back to available
                                ':timestamp': timestamp,
                                ':callId': callId,
                                ':one': 1,
                                ':duration': duration || 0
                            }
                        }
                    }
                ]
            }));
        } catch (updateErr: any) {
            if (updateErr.name === 'TransactionCanceledException' || updateErr.name === 'ConditionalCheckFailedException') {
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Agent session changed before leave completed' })
                };
            }
            throw updateErr;
        }

        console.log(`Agent ${agentId} left call ${callId} non-destructively (status: Online)`);

        // Push notification: notify the agent's mobile app that the call has ended (state sync)
        if (isPushNotificationsEnabled() && CHIME_CONFIG.PUSH.ENABLE_LEAVE_CALL_PUSH) {
            sendCallEndedToAgent({
                callId,
                clinicId: callRecord.clinicId,
                clinicName: callRecord.clinicName || callRecord.clinicId,
                agentId,
                reason: 'agent_left',
                message: 'You left the call',
                direction: callRecord.direction || 'inbound',
                timestamp,
            }).catch(err => console.warn('[leave-call] Push notification failed (non-fatal):', err.message));
        }

        // FIX #1: Use distributed lock to prevent race condition when checking queue
        // This prevents duplicate call assignments if multiple requests arrive concurrently
        // FIX #10: LOCKS_TABLE_NAME is now required - fail fast if not configured
        if (!LOCKS_TABLE_NAME) {
            console.error('[leave-call] CRITICAL: LOCKS_TABLE_NAME not configured - cannot safely check queue');
            // Still return success for the leave operation, but log critical error
            // The agent left successfully, we just can't safely assign new work
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Agent successfully left the call without ending it',
                    callId,
                    agentId,
                    duration: duration || 0,
                    warning: 'Queue check skipped due to missing lock configuration'
                })
            };
        }

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
                // Check for queued calls that could be assigned to this agent
                const { Item: refreshedAgentInfo } = await ddb.send(new GetCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId }
                }));

                // Only check queue if agent is still Online (no call assigned during lock acquisition)
                if (refreshedAgentInfo && refreshedAgentInfo.status === 'Online' && !refreshedAgentInfo.currentCallId) {
                    await checkQueueForWork(agentId, refreshedAgentInfo);
                } else {
                    console.log(`[leave-call] Agent ${agentId} already has a call or is not online, skipping queue check`);
                }
            } catch (queueError) {
                // Non-fatal error - log but continue
                console.error('[leave-call] Error processing call queue:', queueError);
            } finally {
                await lock.release();
            }
        } else {
            console.log(`[leave-call] Could not acquire lock for queue check - another operation in progress for ${agentId}`);
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Agent successfully left the call without ending it',
                callId,
                agentId,
                duration: duration || 0
            })
        };

    } catch (error) {
        console.error('Error processing call leave:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

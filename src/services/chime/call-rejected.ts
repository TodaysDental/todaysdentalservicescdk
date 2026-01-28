import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings'; 
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { createCheckQueueForWork } from './utils/check-queue-for-work';
import { RejectionTracker } from './utils/rejection-tracker';
import { DistributedLock } from './utils/distributed-lock';

const ddb = getDynamoDBClient();
const rejectionTracker = new RejectionTracker({
    rejectionWindowMinutes: 5,
    maxRejections: 50
});
// FIX: Use CHIME_MEDIA_REGION for both clients to ensure consistency
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
const checkQueueForWork = createCheckQueueForWork({
    ddb,
    callQueueTableName: CALL_QUEUE_TABLE_NAME,
    agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
    chime,
    chimeVoiceClient
});

/**
 * Lambda handler for call rejection notification
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[call-rejected] Function invoked', {
      httpMethod: event.httpMethod,
      path: event.path,
      requestId: event.requestContext?.requestId,
    });
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Missing request body' }) };
        }

        // 1. Authenticate the request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[call-rejected] Auth verification failed', { code: verifyResult.code, message: verifyResult.message });
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const requestingAgentId = getUserIdFromJwt(verifyResult.payload!);
        if (!requestingAgentId) {
             return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId, reason } = body;
        
        console.log('[call-rejected] Parsed request body', { callId, agentId, reason });

        if (!callId || !agentId) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) };
        }

        // Security check
        if (requestingAgentId !== agentId) {
            console.warn('[call-rejected] Auth mismatch', { requestingAgentId, agentId });
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Forbidden' }) };
        }

        // 2. Get the current call details
        console.log('[call-rejected] Retrieving call details', { callId });
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));

        if (!callRecords || callRecords.length === 0) {
            console.error('[call-rejected] Call not found', { callId });
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Call not found' }) };
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition } = callRecord;

        // FIX #10: Add clinic authorization check (was missing)
        const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
        if (!authzCheck.authorized) {
            console.warn('[call-rejected] Agent not authorized for call clinic', {
                agentId,
                callId,
                clinicId,
                reason: authzCheck.reason
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'You are not authorized to reject calls for this clinic',
                    reason: authzCheck.reason
                })
            };
        }

        // 3. Acquire distributed lock to avoid racing with call acceptance / other rejections
        const lock = LOCKS_TABLE_NAME ? new DistributedLock(ddb, {
            tableName: LOCKS_TABLE_NAME,
            lockKey: `call-assignment-${callId}`,
            ttlSeconds: 30,
            maxRetries: 10,
            retryDelayMs: 150
        }) : null;

        const lockAcquired = lock ? await lock.acquire() : true;
        if (!lockAcquired) {
            console.warn('[call-rejected] Failed to acquire lock - call being processed', { callId, agentId });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call is being handled by another agent. Please try again.' })
            };
        }

        // We'll determine final call status based on whether other agents are still ringing.
        let newCallStatus: 'ringing' | 'queued' | 'escalated' = 'queued';

        try {
            // Re-fetch call record with consistent read (callId-index is eventually consistent).
            const { Item: freshCall } = await ddb.send(new GetCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                ConsistentRead: true
            }));

            if (!freshCall) {
                console.error('[call-rejected] Call record missing during rejection', { callId, clinicId, queuePosition });
                // Clean up this agent's ringing status just in case
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId',
                    ConditionExpression: 'ringingCallId = :callId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: { ':online': 'Online', ':callId': callId }
                })).catch(() => {});

                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call not found' })
                };
            }

            // If call already moved on, just clean up this agent and exit.
            if (freshCall.status !== 'ringing') {
                console.warn('[call-rejected] Call already handled', { callId, status: freshCall.status });
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId',
                    ConditionExpression: 'ringingCallId = :callId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: { ':online': 'Online', ':callId': callId }
                })).catch(err => console.warn(`[call-rejected] Agent cleanup failed for handled call: ${err.message}`));

                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call already handled' })
                };
            }

            // Compute remaining ringing agents for ring-all strategy
            const ringList: string[] = Array.isArray(freshCall.agentIds)
                ? (freshCall.agentIds as any[]).filter((v) => typeof v === 'string')
                : [];
            const remainingAgentIds = ringList.filter((id: string) => id !== agentId);

            // 4. Escalate if rejection limit exceeded
            if (rejectionTracker.hasExceededRejectionLimit(freshCall)) {
                const stats = rejectionTracker.getStatistics(freshCall);
                console.warn(`[call-rejected] Call ${callId} exceeded rejection limit`, stats);

                const MAX_ESCALATION_RETRIES = 3;
                let escalationSuccess = false;
                let lastEscalationError: any = null;

                for (let attempt = 1; attempt <= MAX_ESCALATION_RETRIES; attempt++) {
                    try {
                        await ddb.send(new TransactWriteCommand({
                            TransactItems: [
                                {
                                    Update: {
                                        TableName: AGENT_PRESENCE_TABLE_NAME,
                                        Key: { agentId },
                                        UpdateExpression: 'SET #status = :online, lastActivityAt = :ts, lastRejectedCallId = :callId ' +
                                                         'REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, inboundMeetingInfo, inboundAttendeeInfo',
                                        ConditionExpression: 'ringingCallId = :callId',
                                        ExpressionAttributeNames: { '#status': 'status' },
                                        ExpressionAttributeValues: {
                                            ':online': 'Online',
                                            ':ts': new Date().toISOString(),
                                            ':callId': callId
                                        }
                                    }
                                },
                                {
                                    Update: {
                                        TableName: CALL_QUEUE_TABLE_NAME,
                                        Key: { clinicId, queuePosition },
                                        UpdateExpression: 'SET #status = :escalated, escalationReason = :reason, escalatedAt = :timestamp ' +
                                                         'REMOVE agentAttendeeInfo, agentIds, assignedAgentId',
                                        ConditionExpression: '#status = :ringing',
                                        ExpressionAttributeNames: { '#status': 'status' },
                                        ExpressionAttributeValues: {
                                            ':escalated': 'escalated',
                                            ':reason': 'excessive_rejections',
                                            ':timestamp': new Date().toISOString(),
                                            ':ringing': 'ringing'
                                        }
                                    }
                                }
                            ]
                        }));
                        escalationSuccess = true;
                        break;
                    } catch (escalationErr: any) {
                        lastEscalationError = escalationErr;

                        if (escalationErr.name === 'TransactionCanceledException') {
                            console.warn('[call-rejected] Escalation transaction failed - state changed', {
                                callId,
                                agentId,
                                reasons: escalationErr.CancellationReasons
                            });
                            return {
                                statusCode: 409,
                                headers: corsHeaders,
                                body: JSON.stringify({ message: 'Call state changed during escalation' })
                            };
                        }

                        const isRetryable = ['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded'].includes(escalationErr.name);
                        if (isRetryable && attempt < MAX_ESCALATION_RETRIES) {
                            const backoff = 100 * Math.pow(2, attempt - 1);
                            console.warn(`[call-rejected] Escalation throttled, retrying in ${backoff}ms (attempt ${attempt}/${MAX_ESCALATION_RETRIES})`);
                            await new Promise(resolve => setTimeout(resolve, backoff));
                            continue;
                        }

                        throw escalationErr;
                    }
                }

                if (!escalationSuccess) {
                    console.error('[call-rejected] Escalation failed after retries', { callId, agentId, error: lastEscalationError?.message });
                    throw lastEscalationError;
                }

                // Best-effort: clear ringing state for other agents, since the call is no longer offerable.
                if (remainingAgentIds.length > 0) {
                    Promise.allSettled(remainingAgentIds.map(async (otherId: string) => {
                        await ddb.send(new UpdateCommand({
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId: otherId },
                            UpdateExpression: 'SET #status = :online, lastActivityAt = :ts REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, inboundMeetingInfo, inboundAttendeeInfo',
                            ConditionExpression: 'ringingCallId = :callId',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':online': 'Online',
                                ':ts': new Date().toISOString(),
                                ':callId': callId
                            }
                        }));
                    })).catch(() => {});
                }

                newCallStatus = 'escalated';
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Call escalated to supervisor due to excessive rejections',
                        callId,
                        agentId,
                        newCallStatus,
                        stats
                    })
                };
            }

            const timestamp = new Date().toISOString();
            const rejectionUpdate = rejectionTracker.recordRejection(callId, agentId);

            // If other agents are still ringing, keep the call in ringing state and just remove this agent from the ring list.
            // If no other agents remain, move the call back to queued.
            newCallStatus = remainingAgentIds.length > 0 ? 'ringing' : 'queued';

            const callUpdateExpression = remainingAgentIds.length > 0
                ? `${rejectionUpdate.UpdateExpression}, agentIds = :agentIds, updatedAt = :ts REMOVE assignedAgentId, agentAttendeeInfo`
                : `${rejectionUpdate.UpdateExpression}, #status = :queued, updatedAt = :ts, lastStateChange = :ts REMOVE agentAttendeeInfo, agentIds, assignedAgentId`;

            const callExpressionAttributeNames = {
                '#status': 'status',
                ...rejectionUpdate.ExpressionAttributeNames
            };

            const callExpressionAttributeValues: Record<string, any> = {
                ':ringing': 'ringing',
                ':ts': timestamp,
                ...rejectionUpdate.ExpressionAttributeValues
            };
            if (remainingAgentIds.length > 0) {
                callExpressionAttributeValues[':agentIds'] = remainingAgentIds;
            } else {
                callExpressionAttributeValues[':queued'] = 'queued';
            }

            try {
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                UpdateExpression: 'SET #status = :online, lastActivityAt = :ts, lastRejectedCallId = :callId ' +
                                                 'REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, inboundMeetingInfo, inboundAttendeeInfo',
                                ConditionExpression: 'ringingCallId = :callId',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':online': 'Online',
                                    ':ts': timestamp,
                                    ':callId': callId
                                }
                            }
                        },
                        {
                            Update: {
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition },
                                UpdateExpression: callUpdateExpression,
                                ConditionExpression: '#status = :ringing',
                                ExpressionAttributeNames: callExpressionAttributeNames,
                                ExpressionAttributeValues: callExpressionAttributeValues
                            }
                        }
                    ]
                }));
            } catch (err: any) {
                if (err.name === 'TransactionCanceledException') {
                    console.warn('[call-rejected] Transaction failed. Race condition detected.', { callId, agentId, reasons: err.CancellationReasons });
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Call state changed during rejection.' })
                    };
                }
                throw err;
            }
        } finally {
            if (lock) {
                await lock.release();
            }
        }

        // 5. Proactively check for queued work for this newly-free agent
        try {
            const { Item: agentInfo } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId }
            }));
            
            if (agentInfo) {
                await checkQueueForWork(agentId, agentInfo);
            }
        } catch (queueErr) {
            console.error(`[call-rejected] Error during post-rejection queue check: ${queueErr}`);
            // Non-fatal, just log
        }
        
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call rejection recorded',
                callId,
                agentId,
                newCallStatus
            })
        };

    } catch (err: any) {
        console.error('Error processing call rejection:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};


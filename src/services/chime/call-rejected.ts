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

        // 3. Check for race condition (call already accepted)
        if (callRecord.status !== 'ringing') {
            console.warn('[call-rejected] Call already handled', { callId, status: callRecord.status });
            // Clean up this agent's ringing status just in case
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId',
                ConditionExpression: 'ringingCallId = :callId',
                ExpressionAttributeNames: {'#status': 'status'},
                ExpressionAttributeValues: { ':online': 'Online', ':callId': callId }
            })).catch(err => console.warn(`[call-rejected] Agent cleanup failed for handled call: ${err.message}`));
            
            return {
                statusCode: 409, // Conflict
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call already handled' })
            };
        }
        
        // 4. CRITICAL FIX #11: Use RejectionTracker for time-windowed rejection tracking
        // Check if call has exceeded rejection limit
        if (rejectionTracker.hasExceededRejectionLimit(callRecord)) {
            const stats = rejectionTracker.getStatistics(callRecord);
            console.warn(`[call-rejected] Call ${callId} exceeded rejection limit`, stats);
            
            // FIX: Add retry logic for escalation transaction
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
                                    // FIX: Keep meetingInfo so supervisors can still join the escalated call
                                    // Only remove agent-specific attendee info, not the meeting itself
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
                        // Condition check failed - state changed, don't retry
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
                    
                    // Check for retryable errors (throttling, etc.)
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
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Call escalated to supervisor due to excessive rejections',
                    callId,
                    agentId,
                    newCallStatus: 'escalated',
                    stats
                })
            };
        }
        
        const timestamp = new Date().toISOString();

        // Get rejection update expression from tracker
        const rejectionUpdate = rejectionTracker.recordRejection(callId, agentId);

        try {
            console.log(`[call-rejected] Agent ${agentId} rejecting call ${callId}. Moving to queue.`);
            
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
                            // FIX: Preserve meetingInfo and customerAttendeeInfo - the customer is still waiting!
                            // Only remove agent-specific data (agentAttendeeInfo, agentIds, assignedAgentId)
                            UpdateExpression: `${rejectionUpdate.UpdateExpression}, #status = :queued ` +
                                             'REMOVE agentAttendeeInfo, agentIds, assignedAgentId',
                            ConditionExpression: '#status = :ringing',
                            ExpressionAttributeNames: { 
                                '#status': 'status',
                                ...rejectionUpdate.ExpressionAttributeNames
                            },
                            ExpressionAttributeValues: {
                                ':queued': 'queued',
                                ':ringing': 'ringing',
                                ...rejectionUpdate.ExpressionAttributeValues
                            }
                        }
                    }
                ]
            }));
            console.log(`[call-rejected] Transaction successful. Call ${callId} moved to 'queued' state (meeting preserved for next agent).`);

        } catch (err: any) {
             if (err.name === 'TransactionCanceledException') {
                console.warn('[call-rejected] Transaction failed. Race condition detected.', { callId, agentId, reasons: err.CancellationReasons });
                return {
                    statusCode: 409, // Conflict
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call state changed during rejection.' })
                };
            }
            // Other transaction error
            throw err;
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
                message: 'Call rejection recorded, call moved to queue',
                callId,
                agentId,
                newCallStatus: 'queued'
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


import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings'; 
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { createCheckQueueForWork } from './utils/check-queue-for-work';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({});
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const checkQueueForWork = createCheckQueueForWork({
    ddb,
    callQueueTableName: CALL_QUEUE_TABLE_NAME,
    agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
    chime,
    chimeVoiceClient
});

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

// --- Auth Helpers ---
async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, code: 401, message: "Missing Bearer token" };
  }
  if (!ISSUER) {
    return { ok: false, code: 500, message: "Issuer not configured" };
  }
  const token = authorizationHeader.slice(7).trim();
  try {
    JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
    if ((payload as any).token_use !== "id") {
      return { ok: false, code: 401, message: "ID token required" };
    }
    return { ok: true, payload };
  } catch (err: any) {
    return { ok: false, code: 401, message: `Invalid token: ${err.message}` };
  }
}
// --- End Auth Helpers ---

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
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const requestingAgentId = verifyResult.payload.sub;
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

        // 3. Check for race condition (call already accepted)
        if (callRecord.status !== 'ringing') {
            console.warn('[call-rejected] Call already handled', { callId, status: callRecord.status });
            // Clean up this agent's ringing status just in case
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom',
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
        
        // 4. Atomically update agent and re-queue the call
        const newRejectedAgents = [...(callRecord.rejectedAgentIds || []), agentId];
        const timestamp = new Date().toISOString();

        try {
            console.log(`[call-rejected] Agent ${agentId} rejecting call ${callId}. Moving to queue.`);
            
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId },
                            UpdateExpression: 'SET #status = :online, lastActivityAt = :ts, lastRejectedCallId = :callId REMOVE ringingCallId, ringingCallTime, ringingCallFrom, inboundMeetingInfo, inboundAttendeeInfo',
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
                            UpdateExpression: 'SET #status = :queued, agentIds = :null, assignedAgentId = :null, rejectedAgentIds = :newRejected REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo',
                            ConditionExpression: '#status = :ringing',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':queued': 'queued',
                                ':null': null,
                                ':newRejected': newRejectedAgents,
                                ':ringing': 'ringing'
                            }
                        }
                    }
                ]
            }));
            console.log(`[call-rejected] Transaction successful. Call ${callId} moved to 'queued' state.`);

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


import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { createCheckQueueForWork } from './utils/check-queue-for-work';

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const ddb = getDynamoDBClient();
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });
const chimeVoiceClient = new ChimeSDKVoiceClient({});
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

async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
    if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith('bearer ')) {
        return { ok: false, code: 401, message: 'Missing Bearer token' };
    }
    if (!ISSUER) {
        return { ok: false, code: 500, message: 'Issuer not configured' };
    }
    const token = authorizationHeader.slice(7).trim();
    try {
        JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
        const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
        if ((payload as any).token_use !== 'id') {
            return { ok: false, code: 401, message: 'ID token required' };
        }
        return { ok: true, payload };
    } catch (err: any) {
        return { ok: false, code: 401, message: `Invalid token: ${err.message}` };
    }
}

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
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        const requestingAgentId = verifyResult.payload.sub;

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

        // Update the agent's status
        try {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp REMOVE currentCallId, ringingCallId, heldCallId, heldCallMeetingId, heldCallAttendeeId, callStatus, inboundMeetingInfo, inboundAttendeeInfo',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ConditionExpression: 'currentCallId = :callId OR ringingCallId = :callId OR heldCallId = :callId',
                ExpressionAttributeValues: {
                    ':status': 'Online', // Back to available
                    ':timestamp': new Date().toISOString(),
                    ':callId': callId
                }
            }));
        } catch (updateErr: any) {
            if (updateErr.name === 'ConditionalCheckFailedException') {
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Agent session changed before leave completed' })
                };
            }
            throw updateErr;
        }

        // Log call statistics for the agent
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'ADD completedCalls :one, totalCallDuration :duration',
            ExpressionAttributeValues: {
                ':one': 1,
                ':duration': duration || 0
            }
        }));

        console.log(`Agent ${agentId} left call ${callId} non-destructively (status: Online)`);

        // Check for queued calls that could be assigned to this agent
        try {
            const { Item: refreshedAgentInfo } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId }
            }));

            if (refreshedAgentInfo) {
                await checkQueueForWork(agentId, refreshedAgentInfo);
            } else {
                console.log(`[leave-call] Agent presence not found for ${agentId} when checking queue.`);
            }
        } catch (queueError) {
            // Non-fatal error - log but continue
            console.error('[leave-call] Error processing call queue:', queueError);
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

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

/**
 * Heartbeat Lambda
 * Allows agents to periodically update their presence to stay "Online"
 * Prevents agents from staying online indefinitely if their browser crashes
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
const SESSION_MAX_SECONDS = Math.max(3600, Number.parseInt(process.env.AGENT_SESSION_MAX_SECONDS || `${8 * 60 * 60}`, 10));
const HEARTBEAT_GRACE_SECONDS = Math.max(300, Number.parseInt(process.env.AGENT_HEARTBEAT_GRACE_SECONDS || `${15 * 60}`, 10));
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

// Auth Helpers
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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    console.log('[heartbeat] Processing heartbeat request');

    try {
        // Verify JWT token
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[heartbeat] Auth verification failed', { 
                code: verifyResult.code, 
                message: verifyResult.message 
            });
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const agentId = verifyResult.payload.sub;
        if (!agentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Invalid token: missing subject claim' })
            };
        }

        // Check current agent status
        const { Item: agent } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId }
        }));

        if (!agent) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Agent presence not found. Please start a new session.' })
            };
        }

        // Update lastActivityAt and extend TTL
        const now = new Date();
        const nowSeconds = Math.floor(now.getTime() / 1000);
        const sessionExpiryEpoch = typeof agent.sessionExpiresAtEpoch === 'number'
            ? agent.sessionExpiresAtEpoch
            : agent.sessionExpiresAt
                ? Math.floor(new Date(agent.sessionExpiresAt).getTime() / 1000)
                : nowSeconds + SESSION_MAX_SECONDS;

        if (sessionExpiryEpoch <= nowSeconds) {
            console.warn('[heartbeat] Session expired for agent', { agentId, sessionExpiryEpoch, nowSeconds });
            try {
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :offline, lastActivityAt = :timestamp, cleanupReason = :reason REMOVE currentCallId, ringingCallId, callStatus, heldCallId, heldCallMeetingId, heldCallAttendeeId, inboundMeetingInfo, inboundAttendeeInfo',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':offline': 'Offline',
                        ':timestamp': now.toISOString(),
                        ':reason': 'session_expired'
                    }
                }));
            } catch (expireErr) {
                console.warn('[heartbeat] Failed to mark session expired', expireErr);
            }
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Session expired. Please start a new session.' })
            };
        }

        const newTtl = Math.min(sessionExpiryEpoch, nowSeconds + HEARTBEAT_GRACE_SECONDS);

        // CRITICAL FIX: Add separate lastHeartbeatAt field distinct from lastActivityAt
        // This allows cleanup monitor to distinguish between heartbeats and other activity
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET lastActivityAt = :timestamp, lastHeartbeatAt = :timestamp, ttl = :ttl, sessionExpiresAtEpoch = :sessionExpiry, sessionExpiresAt = if_not_exists(sessionExpiresAt, :sessionExpiryIso), heartbeatCount = if_not_exists(heartbeatCount, :zero) + :one',
            ConditionExpression: 'attribute_exists(agentId)',
            ExpressionAttributeValues: {
                ':timestamp': now.toISOString(),
                ':ttl': newTtl,
                ':sessionExpiry': sessionExpiryEpoch,
                ':sessionExpiryIso': new Date(sessionExpiryEpoch * 1000).toISOString(),
                ':zero': 0,
                ':one': 1
            }
        }));

        console.log(`[heartbeat] Updated heartbeat for agent ${agentId}`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Heartbeat recorded',
                timestamp: now.toISOString(),
                status: agent.status,
                ttl: newTtl
            })
        };

    } catch (error: any) {
        console.error('[heartbeat] Error processing heartbeat:', error);
        
        if (error.name === 'ConditionalCheckFailedException') {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Agent session not found. Please start a new session.' })
            };
        }
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

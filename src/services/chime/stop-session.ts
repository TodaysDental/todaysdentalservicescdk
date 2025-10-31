import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeClient = new ChimeSDKMeetingsClient({});

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
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
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
    }
    
    console.log('[stop-session] Auth verification successful');

    const agentId = verifyResult.payload.sub;
    if (!agentId) {
      console.error('[stop-session] Missing subject claim in token');
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing sub' }) };
    }
    
    console.log('[stop-session] Processing stop request for agent:', agentId);

    // 1. Get current presence record to find the MeetingId
    console.log('[stop-session] Retrieving current presence record', { agentId });
    const { Item } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
    }));
    
    console.log('[stop-session] Current presence state', {
      agentExists: !!Item,
      status: Item?.status,
      hasMeetingInfo: !!(Item?.meetingInfo?.MeetingId)
    });

    if (Item && Item.meetingInfo?.MeetingId) {
        // 2. Delete the Chime meeting
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

    // 3. Update agent status to Offline in DynamoDB
    console.log('[stop-session] Updating agent status to Offline', { agentId });
    await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt REMOVE activeClinicIds, meetingInfo, attendeeInfo, #ttl',
        ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#ttl': 'ttl', // Added alias for reserved keyword 'ttl'
        },
        ExpressionAttributeValues: {
            ':status': 'Offline',
            ':updatedAt': new Date().toISOString(),
        },
    }));
    
    console.log('[stop-session] Agent status updated to Offline successfully');

    const responseBody = { success: true, message: 'Session stopped' };
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
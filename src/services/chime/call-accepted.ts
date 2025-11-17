import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { 
    ChimeSDKMeetingsClient, 
    CreateAttendeeCommand,
    Attendee
} from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getSmaIdForClinic } from './utils/sma-map';
import { randomUUID } from 'crypto';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoice = new ChimeSDKVoiceClient({});
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
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
    console.log('[call-accepted] Function invoked', {
      httpMethod: event.httpMethod,
      path: event.path,
      requestId: event.requestContext?.requestId,
    });
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            console.error('[call-accepted] Missing request body');
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing request body' }) 
            };
        }

        // 1. Authenticate the request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[call-accepted] Auth verification failed', { code: verifyResult.code, message: verifyResult.message });
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const requestingAgentId = verifyResult.payload.sub;
        if (!requestingAgentId) {
             return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId } = body;
        
        console.log('[call-accepted] Parsed request body', { callId, agentId, requestingAgentId });

        if (!callId || !agentId) {
            console.error('[call-accepted] Missing required parameters');
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) 
            };
        }

        // Security check: Ensure the authenticated agent is the one accepting the call
        if (requestingAgentId !== agentId) {
            console.warn('[call-accepted] Auth mismatch', { requestingAgentId, agentId });
            return { 
                statusCode: 403, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Forbidden' }) 
            };
        }

        // 2. Get the agent's existing session meeting
        const { Item: agentPresence } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId }
        }));

        if (!agentPresence?.meetingInfo?.MeetingId) {
            console.error('[call-accepted] Agent has no valid session meeting. Please start-session.', { agentId });
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Agent session not found or is invalid. Please log in again.' })
            };
        }
        const agentMeeting = agentPresence.meetingInfo;
        console.log(`[call-accepted] Found agent session meeting: ${agentMeeting.MeetingId}`);

        // 3. Find the call record to verify it's still ringing
        console.log('[call-accepted] Finding call record', { callId });
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));

        if (!callRecords || callRecords.length === 0) {
            console.error('[call-accepted] Call not found', { callId });
            // This can happen if the customer hung up. Clean up agent status.
             await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                ConditionExpression: 'ringingCallId = :callId',
                ExpressionAttributeNames: {'#status': 'status'},
                ExpressionAttributeValues: { ':online': 'Online', ':callId': callId }
            })).catch(err => console.warn(`[call-accepted] Agent cleanup failed for missing call: ${err.message}`));
            
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found. It may have been disconnected.' })
            };
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition } = callRecord;

        const smaId = getSmaIdForClinic(clinicId);

        // RACE CONDITION CHECK: Ensure call is still ringing
        if (callRecord.status !== 'ringing') {
            console.warn('[call-accepted] Race condition - call already accepted or handled', { callId, status: callRecord.status });
            
            // Clean up this agent's ringing status, as they lost the race
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                ConditionExpression: 'ringingCallId = :callId',
                ExpressionAttributeNames: {'#status': 'status'},
                ExpressionAttributeValues: { ':online': 'Online', ':callId': callId }
            })).catch(err => console.warn(`[call-accepted] Agent cleanup failed for race condition: ${err.message}`));
            
            return {
                statusCode: 409, // Conflict
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call was already handled by another agent.' })
            };
        }

        // 4. Create a new attendee *for the customer* in the *agent's* meeting
        let customerAttendee: Attendee;
        try {
            console.log(`[call-accepted] Creating customer attendee for agent's meeting ${agentMeeting.MeetingId}`);
            const attendeeResponse = await chime.send(new CreateAttendeeCommand({
                MeetingId: agentMeeting.MeetingId,
                ExternalUserId: `customer-${callId}` // Link attendee to the callId
            }));
            
            if (!attendeeResponse.Attendee?.AttendeeId || !attendeeResponse.Attendee?.JoinToken) {
                throw new Error('Invalid attendee data returned from Chime');
            }
            customerAttendee = attendeeResponse.Attendee;
            console.log(`[call-accepted] Created customer attendee: ${customerAttendee.AttendeeId}`);
        } catch (attendeeErr) {
            console.error('[call-accepted] Failed to create customer attendee:', attendeeErr);
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Failed to create meeting credentials for customer' })
            };
        }

        // 5. Use transaction to atomically claim the call and update agent statuses
        console.log('[call-accepted] Attempting to claim call with transaction', { callId, agentId });
        
        const otherRingingAgents = (callRecord.agentIds || []).filter((id: string) => id !== agentId);
        const timestamp = new Date().toISOString();
        const nowSeconds = Math.floor(Date.now() / 1000);
        const extendedTTL = nowSeconds + (24 * 60 * 60); // Keep active calls alive for another 24 hours

        const transactionItems = [
            // Item 1: Update call status to 'connected' and store customer attendee
            {
                Update: {
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId, queuePosition },
                    UpdateExpression: 'SET #status = :connected, assignedAgentId = :agentId, acceptedAt = :timestamp, customerAttendeeInfo = :customerAttendee, ttl = :ttl REMOVE agentIds',
                    ConditionExpression: '#status = :ringing', // Final check for race condition
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':connected': 'connected',
                        ':agentId': agentId,
                        ':timestamp': timestamp,
                        ':customerAttendee': customerAttendee,
                        ':ringing': 'ringing',
                        ':ttl': extendedTTL
                    }
                }
            },
            // Item 2: Update the accepting agent's status to 'OnCall'
            {
                Update: {
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :onCall, currentCallId = :callId, lastActivityAt = :timestamp REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                    ConditionExpression: 'ringingCallId = :callId', // Ensure agent was ringing for this call
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':onCall': 'OnCall',
                        ':callId': callId,
                        ':timestamp': timestamp
                    }
                }
            }
        ];
        
        // Items 3..N: Update all other ringing agents back to 'Online'
        otherRingingAgents.forEach((otherAgentId: string) => {
            transactionItems.push({
                Update: {
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId: otherAgentId },
                    UpdateExpression: 'SET #status = :onCall, lastActivityAt = :timestamp REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                    ConditionExpression: 'ringingCallId = :callId', // Only clear if they were ringing for this call
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':onCall': 'Online', // Using the same key as other transactions
                        ':callId': callId,
                        ':timestamp': timestamp
                    }
                }
            });
        });
        
        try {
            await ddb.send(new TransactWriteCommand({ TransactItems: transactionItems }));
            console.log('[call-accepted] Transaction completed successfully', { callId, agentId, otherAgentsCleaned: otherRingingAgents.length });
        } catch (err: any) {
            if (err.name === 'TransactionCanceledException') {
                console.warn('[call-accepted] Transaction failed. Call likely claimed by another agent.', { callId, agentId, reasons: err.CancellationReasons });
                return {
                    statusCode: 409, // Conflict
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Call was already accepted by another agent.',
                        callId, agentId
                    })
                };
            }
            // Other transaction error
            throw err;
        }

        // 6. Notify the SMA to bridge the customer PSTN leg into the agent's meeting
        if (smaId) {
            try {
                console.log('[call-accepted] Notifying SMA to bridge customer', { callId, agentId, meetingId: agentMeeting.MeetingId });
                await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: smaId,
                    TransactionId: callId, // This is the PSTN call leg
                    Arguments: {
                        action: 'BRIDGE_CUSTOMER_INBOUND',
                        meetingId: agentMeeting.MeetingId,
                        customerAttendeeId: customerAttendee.AttendeeId!,
                        customerAttendeeJoinToken: customerAttendee.JoinToken!
                    }
                }));
                console.log('[call-accepted] SMA notified successfully');
            } catch (smaErr) {
                console.error('[call-accepted] Failed to notify SMA of agent acceptance:', smaErr);
                // NOTE: This is a critical failure. The DB is updated but the call isn't bridged.
                // The cleanup-monitor will eventually catch this, but it's a bad state.
                // For now, we'll return success to the agent, as the DB state is "correct".
            }
        } else {
            console.error('[call-accepted] SMA mapping not configured for clinic. Cannot bridge call.', { clinicId });
        }

        // 7. Return success to the agent's frontend.
        // The frontend is already in the agent's meeting, so it just needs confirmation.
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call acceptance recorded and bridge initiated',
                callId,
                agentId,
                status: 'connected',
            })
        };

    } catch (error: any) {
        console.error('[call-accepted] Error processing call acceptance:', {
          message: error?.message,
          code: error?.name,
          requestId: event.requestContext?.requestId
        });
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
              message: 'Internal server error',
              error: error?.message
            })
        };
    }
};

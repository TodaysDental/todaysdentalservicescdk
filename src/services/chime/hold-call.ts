import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getSmaIdForClinic } from './utils/sma-map';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoice = new ChimeSDKVoiceClient({});

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
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
/**
 * Lambda handler for placing a call on hold
 * This is triggered by the frontend when an agent wants to put a customer on hold
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Hold call event:', JSON.stringify(event, null, 2));
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        // Authenticate request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[hold-call] Auth verification failed', verifyResult);
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
        const { callId, agentId } = body;

        if (!callId || !agentId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) 
            };
        }

        if (!requestingAgentId || requestingAgentId !== agentId) {
            console.warn('[hold-call] Agent token mismatch', { requestingAgentId, agentId });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden' })
            };
        }

        // Update the call status in the database
        // 1. Find the call record in the queue table
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: {
                ':callId': callId
            }
        }));

        if (!callRecords || callRecords.length === 0) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition } = callRecord;
        if (callRecord.assignedAgentId && callRecord.assignedAgentId !== agentId) {
            console.warn('[hold-call] Agent attempting to hold call they are not assigned to', { agentId, assignedAgentId: callRecord.assignedAgentId });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'You are not assigned to this call' })
            };
        }

        const smaId = getSmaIdForClinic(clinicId);
        if (!smaId) {
            console.error('[hold-call] Missing SMA mapping for clinic', { clinicId });
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Hold is not configured for this clinic' })
            };
        }

        // Fetch agent presence record and ensure they are on this call
        const { Item: agentRecord } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId }
        }));

        if (!agentRecord) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Agent presence not found' })
            };
        }

        const isOnCall = agentRecord.currentCallId === callId || agentRecord.ringingCallId === callId;
        if (!isOnCall) {
            console.warn('[hold-call] Agent not actively on this call', { agentId, callId });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'You are not actively connected to this call' })
            };
        }

        // CRITICAL FIX: Check if this call has an active meeting
        let meetingId = null;
        let agentAttendeeId = null;
        
        if (callRecord.meetingInfo?.MeetingId) {
            meetingId = callRecord.meetingInfo.MeetingId;
            console.log(`[hold-call] Found active meeting ${meetingId} for call ${callId}`);
            
            // Check for attendee ID in various fields
            if (agentRecord?.currentMeetingAttendeeId) {
                agentAttendeeId = agentRecord.currentMeetingAttendeeId;
                console.log(`[hold-call] Found agent attendee ID in currentMeetingAttendeeId: ${agentAttendeeId}`);
            } else if (agentRecord?.inboundAttendeeInfo?.AttendeeId) {
                agentAttendeeId = agentRecord.inboundAttendeeInfo.AttendeeId;
                console.log(`[hold-call] Found agent attendee ID in inboundAttendeeInfo: ${agentAttendeeId}`);
            } else if (agentRecord?.attendeeInfo?.AttendeeId) {
                agentAttendeeId = agentRecord.attendeeInfo.AttendeeId;
                console.log(`[hold-call] Found agent attendee ID in attendeeInfo: ${agentAttendeeId}`);
            }
        } else {
            console.log(`[hold-call] No active meeting found for call ${callId}`);
        }
        
        try {
            // Send the hold command to the SMA with enhanced hold information
            await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: callId,
                Arguments: {
                    action: 'HOLD_CALL',
                    agentId,
                    meetingId,
                    agentAttendeeId: agentAttendeeId || '',
                    removeAgent: 'true'  // Indicate that agent should be removed from meeting (as string)
                }
            }));
            
            console.log(`[hold-call] SMA hold command successful for call ${callId}`);
            
            // First update the call record
            await ddb.send(new UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                UpdateExpression: 'SET #status = :status, callStatus = :status, holdStartTime = :time, heldByAgentId = :agentId',
                ConditionExpression: '#status = :connectedStatus AND assignedAgentId = :agentId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'on_hold',
                    ':time': new Date().toISOString(),
                    ':connectedStatus': 'connected',
                    ':agentId': agentId
                }
            }));

            // CRITICAL FIX: Store the agent's attendee ID, meeting ID, and other info for reconnection later
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET callStatus = :status, lastActivityAt = :timestamp, ' +
                                 'heldCallMeetingId = :meetingId, heldCallId = :callId, ' +
                                 'heldCallAttendeeId = :attendeeId',
                ConditionExpression: 'currentCallId = :callId',
                ExpressionAttributeValues: {
                    ':status': 'on_hold',
                    ':timestamp': new Date().toISOString(),
                    ':meetingId': meetingId || null,
                    ':callId': callId,
                    ':attendeeId': agentAttendeeId || null // Store attendee ID for potential reuse
                }
            }));

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Call placed on hold',
                    callId,
                    status: 'on_hold'
                })
            };
        } catch (smaError: any) {
            console.error('[hold-call] Error placing call on hold:', smaError);
            
            // Provide more specific error message
            if (smaError.name === 'ConditionalCheckFailedException') {
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call is not in a valid state to be placed on hold' })
                };
            }
            
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Failed to place call on hold', 
                    error: smaError.message 
                })
            };
        }

    } catch (error) {
        console.error('Error processing hold call request:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

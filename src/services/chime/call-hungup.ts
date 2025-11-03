import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
// CORRECTED IMPORT: Use UpdateSipMediaApplicationCallCommand to manipulate an active call
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoiceClient = new ChimeSDKVoiceClient({});
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
// FIX: SMA_ID environment variable is REQUIRED for this function
const SMA_ID = process.env.SMA_ID;
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
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        console.log('[call-hungup] Auth verification successful');
        const requestingAgentId = verifyResult.payload.sub;
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
        
        // CRITICAL FIX: Check for SMA_ID and return error if missing
        if (!SMA_ID) {
            console.error('[call-hungup] SMA_ID environment variable is missing');
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Server configuration error: Missing SMA_ID' })
            };
        }

        // 1. CRITICAL FIX: First try to hangup via SMA, only mark agent available if successful
        let smaHangupSuccess = false;
        if (agentId) {
            try {
                await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: SMA_ID,
                    TransactionId: callId,
                    Arguments: {
                        Action: "Hangup" 
                    }
                }));
                smaHangupSuccess = true;
                console.log(`[call-hungup] SMA hangup successful for call ${callId}`);
            } catch (smaError: any) {
                console.error(`[call-hungup] SMA hangup failed for call ${callId}:`, smaError);
                // Continue but don't mark agent as available immediately
            }
        }
        
        // 2. Update the agent's status and metrics
        if (agentId) {
            if (smaHangupSuccess || !SMA_ID) {
                // Only mark agent as available if SMA hangup succeeded or SMA_ID not configured
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp REMOVE currentCallId',
                    ExpressionAttributeNames: {
                        '#status': 'status'
                    },
                    ExpressionAttributeValues: {
                        ':status': 'Online', // Back to available
                        ':timestamp': new Date().toISOString()
                    }
                }));
                console.log(`[call-hungup] Agent ${agentId} marked as Online after successful hangup`);
            } else {
                // Mark agent as in an error state - requires manual intervention
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp, errorReason = :error REMOVE currentCallId',
                    ExpressionAttributeNames: {
                        '#status': 'status'
                    },
                    ExpressionAttributeValues: {
                        ':status': 'Error',
                        ':timestamp': new Date().toISOString(),
                        ':error': 'sma_hangup_failed'
                    }
                }));
                console.warn(`[call-hungup] Agent ${agentId} marked as Error due to SMA hangup failure`);
            }

            // CRITICAL FIX: Get call record to calculate duration server-side
            try {
                // First, find the call record
                const { Items: callRecords } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :callId',
                    ExpressionAttributeValues: { ':callId': callId }
                }));

                // Calculate duration server-side based on acceptedAt timestamp
                if (callRecords && callRecords.length > 0) {
                    const callRecord = callRecords[0];
                    if (callRecord.acceptedAt) {
                        // Calculate duration in seconds from acceptedAt to now
                        const acceptedTime = new Date(callRecord.acceptedAt).getTime();
                        const endTime = Date.now();
                        calculatedDuration = Math.floor((endTime - acceptedTime) / 1000);
                        console.log(`[call-hungup] Call ${callId} duration calculated: ${calculatedDuration}s (started at ${callRecord.acceptedAt})`);
                    }
                } else {
                    console.warn(`[call-hungup] Call record not found for ${callId} - unable to calculate duration`);
                }

                // Log call statistics for the agent regardless of hangup success
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'ADD completedCalls :one, totalCallDuration :duration',
                    ExpressionAttributeValues: {
                        ':one': 1,
                        ':duration': calculatedDuration // Use server-calculated duration
                    }
                }));
            } catch (durationErr) {
                console.error(`[call-hungup] Error calculating call duration:`, durationErr);
                // Still increment completed calls counter even if duration calculation fails
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

        // Note: SMA hangup is handled above in the agent status section to ensure proper error handling
        
        console.log(`Agent ${agentId} marked as available after hanging up call ${callId}`);
        
        // Check for queued calls that could be assigned to this agent
        if (agentId) {
            try {
                // Get the agent's active clinics
                const { Item: agentInfo } = await ddb.send(new GetCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId }
                }));
                
                if (!agentInfo || !agentInfo.activeClinicIds || agentInfo.activeClinicIds.length === 0) {
                    console.log(`No active clinics found for agent ${agentId} to check for queued calls`);
                } else {
                    const activeClinicIds = agentInfo.activeClinicIds;
                    console.log(`Checking for queued calls in clinics for agent ${agentId}:`, activeClinicIds);
                    
                    // For each clinic, look for the oldest queued call
                    for (const clinicId of activeClinicIds) {
                        const { Items: queuedCalls } = await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            KeyConditionExpression: 'clinicId = :clinicId',
                            FilterExpression: '#status = :status',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':clinicId': clinicId,
                                ':status': 'queued'
                            },
                            // Sort by queuePosition (timestamp-based) to get oldest first
                            ScanIndexForward: true,
                            Limit: 1 // Just get the oldest call
                        }));
                        
                        if (queuedCalls && queuedCalls.length > 0) {
                            const oldestCall = queuedCalls[0];
                            console.log(`Found queued call for clinic ${clinicId}:`, {
                                callId: oldestCall.callId,
                                queuedSince: oldestCall.queueEntryTime,
                                hasMeeting: !!oldestCall.meetingInfo?.MeetingId
                            });
                            
                            // Make sure the call has a valid meeting
                            if (oldestCall.meetingInfo?.MeetingId) {
                                // Create an attendee for this agent in the call's meeting
                                const attendeeResponse = await chime.send(new CreateAttendeeCommand({
                                    MeetingId: oldestCall.meetingInfo.MeetingId,
                                    ExternalUserId: agentId
                                }));
                                
                            if (!attendeeResponse.Attendee) {
                                console.error(`Failed to create attendee for queued call ${oldestCall.callId}`);
                                continue;
                            }
                            
                            // CRITICAL FIX: Atomic claim operation - only assign if still queued and not already assigned
                            try {
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { 
                                        clinicId: oldestCall.clinicId, 
                                        queuePosition: oldestCall.queuePosition 
                                    },
                                    UpdateExpression: 'SET #status = :status, agentIds = :agentIds, claimedAt = :timestamp',
                                    ConditionExpression: '#status = :queuedStatus AND (attribute_not_exists(agentIds) OR size(agentIds) = :emptyArray)',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':status': 'ringing',
                                        ':agentIds': [agentId],
                                        ':queuedStatus': 'queued',
                                        ':timestamp': new Date().toISOString(),
                                        ':emptyArray': 0
                                    }
                                }));
                            } catch (claimErr: any) {
                                if (claimErr.name === 'ConditionalCheckFailedException') {
                                    console.warn(`[call-hungup] Race condition - queued call ${oldestCall.callId} already claimed by another agent`);
                                    continue; // Try next queued call
                                }
                                throw claimErr;
                            }
                                
                                // Update agent's presence to show the ringing call
                                await ddb.send(new UpdateCommand({
                                    TableName: AGENT_PRESENCE_TABLE_NAME,
                                    Key: { agentId },
                                    UpdateExpression: 'SET ringingCallId = :callId, callStatus = :status, ' + 
                                                    'inboundMeetingInfo = :meeting, inboundAttendeeInfo = :attendee, ' +
                                                    'ringingCallTime = :time',
                                    ExpressionAttributeValues: {
                                        ':callId': oldestCall.callId,
                                        ':status': 'ringing',
                                        ':meeting': oldestCall.meetingInfo,
                                        ':attendee': attendeeResponse.Attendee,
                                        ':time': new Date().toISOString()
                                    }
                                }));
                                
                                console.log(`Assigned queued call ${oldestCall.callId} to agent ${agentId}`);
                                
                                // Only assign one call, even if there are multiple queued calls
                                break;
                            } else {
                                console.error('Queued call has no valid meeting info:', oldestCall);
                            }
                        } else {
                            console.log(`No queued calls found for clinic ${clinicId}`);
                        }
                    }
                }
            } catch (queueError) {
                // Non-fatal error - log but continue
                console.error('Error processing call queue:', queueError);
            }
        }

        // Use calculatedDuration declared at higher scope
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call termination initiated and agent status updated',
                callId,
                agentId,
                duration: calculatedDuration || 0
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
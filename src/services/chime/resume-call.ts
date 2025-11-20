import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand, DeleteAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { checkClinicAuthorization } from '../shared/utils/authorization';

const ddb = getDynamoDBClient();
const chimeVoice = new ChimeSDKVoiceClient({});

// Initialize Chime Meetings client for attendee operations
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || 'us-east-1';
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;

/**
 * Lambda handler for resuming a call from hold
 * This is triggered by the frontend when an agent wants to resume a call that was on hold
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Resume call event:', JSON.stringify(event, null, 2));
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        // CRITICAL FIX: Add JWT verification for security
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdTokenCached(authz, REGION!, USER_POOL_ID!);
        if (!verifyResult.ok) {
            console.warn('[resume-call] Auth verification failed', { 
                code: verifyResult.code, 
                message: verifyResult.message 
            });
            return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const requestingAgentId = verifyResult.payload.sub;
        console.log('[resume-call] Auth verification successful', { requestingAgentId });
        
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
        
        // CRITICAL FIX: Verify requesting agent is the agent resuming
        if (requestingAgentId !== agentId) {
            console.warn('[resume-call] Authorization failed - agent attempting to resume call they are not on', {
                requestingAgentId,
                agentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden: You can only resume your own calls' })
            };
        }

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

        // Check clinic authorization
        const authzCheck = checkClinicAuthorization(verifyResult.payload, clinicId);
        if (!authzCheck.authorized) {
            console.warn('[resume-call] Authorization failed', {
                agentId: requestingAgentId,
                clinicId,
                reason: authzCheck.reason
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: authzCheck.reason })
            };
        }

        const smaId = getSmaIdForClinic(clinicId);
        if (!smaId) {
            console.error('[resume-call] Missing SMA mapping for clinic', { clinicId });
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Resume call is not configured for this clinic' })
            };
        }
        
        // CRITICAL FIX: Verify agent is actually on this call
        if (callRecord.assignedAgentId !== agentId) {
            console.warn('[resume-call] Agent not on this call', {
                agentId,
                assignedAgentId: callRecord.assignedAgentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'You are not currently on this call' })
            };
        }
        
        const callState = callRecord.status || callRecord.callStatus;
        // CRITICAL FIX: Verify call is actually on hold
        if (callState !== 'on_hold') {
            console.warn('[resume-call] Call is not on hold', {
                callId,
                currentStatus: callState
            });
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call is not on hold' })
            };
        }

        if (callRecord.heldByAgentId && callRecord.heldByAgentId !== agentId) {
            console.warn('[resume-call] Call held by different agent', {
                callId,
                heldBy: callRecord.heldByAgentId,
                agentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Another agent placed this call on hold' })
            };
        }

        // Calculate hold duration if applicable
        let holdDuration = 0;
        if (callRecord.holdStartTime) {
            const holdStart = new Date(callRecord.holdStartTime).getTime();
            const now = new Date().getTime();
            holdDuration = Math.floor((now - holdStart) / 1000); // seconds
        }

        // CRITICAL FIX: Check if this agent has meeting info stored for the held call
        const { Item: agentRecord } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId }
        }));
        
        // Get meeting ID from agent record or call record
        let meetingId = null;
        if (agentRecord?.heldCallMeetingId) {
            meetingId = agentRecord.heldCallMeetingId;
            console.log(`[resume-call] Found stored meeting ID ${meetingId} for agent ${agentId}`);
        } else if (callRecord.meetingInfo?.MeetingId) {
            meetingId = callRecord.meetingInfo.MeetingId;
            console.log(`[resume-call] Using call record meeting ID ${meetingId}`);
        } else {
            console.log(`[resume-call] No meeting ID found for call ${callId}`);
        }

        try {
            let agentAttendeeId = null;
            
            // CRITICAL FIX #2: Delete OLD attendee BEFORE creating new one
            // This prevents "Attendee already exists" errors
            const storedAttendeeId = agentRecord?.heldCallAttendeeId;

            if (storedAttendeeId && meetingId) {
                try {
                    await chimeClient.send(new DeleteAttendeeCommand({
                        MeetingId: meetingId,
                        AttendeeId: storedAttendeeId
                    }));
                    console.log(`[resume-call] Cleaned up old attendee ${storedAttendeeId} before resume`);
                } catch (deleteErr: any) {
                    if (deleteErr.name === 'NotFoundException') {
                        console.log(`[resume-call] Old attendee ${storedAttendeeId} already removed`);
                    } else {
                        console.warn('[resume-call] Could not delete old attendee:', deleteErr);
                        // Continue anyway - might still be able to create new attendee
                    }
                }
            }
            
            // CRITICAL FIX: Create a new attendee for the agent to resume the call
            // The old attendee was already cleaned up above
            if (meetingId) {
                try {
                    // CreateAttendeeCommand will validate meeting exists
                    const attendeeResponse = await chimeClient.send(new CreateAttendeeCommand({
                        MeetingId: meetingId,
                        ExternalUserId: agentId
                    }));
                    
                    if (attendeeResponse.Attendee?.AttendeeId) {
                        agentAttendeeId = attendeeResponse.Attendee.AttendeeId;
                        console.log(`[resume-call] Created new attendee ${agentAttendeeId} for agent ${agentId}`);
                        
                        // Store the entire attendee response for use later
                        const joinToken = attendeeResponse.Attendee.JoinToken || '';
                        
                        // Update the call record with attendee info here to ensure we have the join token
                        try {
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition },
                                UpdateExpression: 'SET agentAttendeeInfo = :attendeeInfo',
                                ExpressionAttributeValues: {
                                    ':attendeeInfo': {
                                        AttendeeId: agentAttendeeId,
                                        JoinToken: joinToken,
                                        ExternalUserId: agentId
                                    }
                                }
                            }));
                            console.log(`[resume-call] Stored attendee info in call record`);
                        } catch (updateErr) {
                            console.warn('[resume-call] Failed to store attendee info in call record:', updateErr);
                        }
                    }
                } catch (attendeeErr) {
                    console.error(`[resume-call] Failed to create attendee:`, attendeeErr);
                }
            }
            
            // Send command to SMA with enhanced information for rejoining
            await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: callId,
                Arguments: {
                    action: 'RESUME_CALL',
                    agentId,
                    meetingId: meetingId || '',
                    agentAttendeeId: agentAttendeeId || '',
                    reconnectAgent: 'true' // Convert to string as API expects string values
                }
            }));
            
            console.log(`[resume-call] SMA resume command successful for call ${callId}`);
            
            // Only update database after SMA command succeeds
            await ddb.send(new UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                UpdateExpression: 'SET #status = :status, callStatus = :status, holdEndTime = :endTime, holdDuration = :duration REMOVE holdStartTime, heldByAgentId',
                ConditionExpression: '#status = :holdStatus AND heldByAgentId = :agentId',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': 'connected',
                    ':endTime': new Date().toISOString(),
                    ':duration': holdDuration,
                    ':holdStatus': 'on_hold',
                    ':agentId': agentId
                }
            }));

            // Update the agent's record with the new attendee ID
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET callStatus = :status, lastActivityAt = :timestamp, currentMeetingAttendeeId = :attendeeId REMOVE heldCallMeetingId, heldCallId, heldCallAttendeeId',
                ExpressionAttributeValues: {
                    ':status': 'connected',
                    ':timestamp': new Date().toISOString(),
                    ':attendeeId': agentAttendeeId
                }
            }));
            
            // CRITICAL FIX: Update call record with resume metadata
            // Since we already stored the attendee info above, we just update the timestamps here
            try {
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId, queuePosition },
                    UpdateExpression: 'SET resumeTime = :timestamp, lastUpdated = :timestamp',
                    ExpressionAttributeValues: {
                        ':timestamp': new Date().toISOString()
                    }
                }));
                console.log(`[resume-call] Updated call record with resume metadata for call ${callId}`);
            } catch (callUpdateErr) {
                // Non-fatal error
                console.warn(`[resume-call] Failed to update call record with resume metadata:`, callUpdateErr);
            }

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Call resumed',
                    callId,
                    status: 'connected',
                    holdDuration,
                    meetingId,
                    attendeeId: agentAttendeeId
                })
            };
        } catch (smaError: any) {
            console.error('[resume-call] Error resuming call:', smaError);
            
            // Provide more specific error message
            if (smaError.name === 'ConditionalCheckFailedException') {
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call is not in a valid state to be resumed' })
                };
            }
            
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Failed to resume call',
                    error: smaError.message
                })
            };
        }

    } catch (error) {
        console.error('Error processing resume call request:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, DeleteAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { checkClinicAuthorization } from '../shared/utils/authorization';
import { randomUUID } from 'crypto';

const ddb = getDynamoDBClient();
const chimeVoice = new ChimeSDKVoiceClient({});
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || 'us-east-1';
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
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
        const verifyResult = await verifyIdTokenCached(authz, REGION!, USER_POOL_ID!);
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
        
        // Check clinic authorization
        const authzCheck = checkClinicAuthorization(verifyResult.payload, clinicId);
        if (!authzCheck.authorized) {
            console.warn('[hold-call] Authorization failed', {
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
        
        // CRITICAL FIX #5: Make hold operation as atomic as possible
        // CRITICAL FIX #4: Comprehensive error handling for each step
        // Log operation ID for debugging and potential retry
        const holdOperationId = randomUUID();
        console.log('[hold-call] Starting hold operation', { holdOperationId, callId, agentId });
        
        // Step 1: Send the hold command to the SMA
        try {
            await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: callId,
                Arguments: {
                    action: 'HOLD_CALL',
                    agentId,
                    meetingId,
                    agentAttendeeId: agentAttendeeId || '',
                    removeAgent: 'true',
                    holdOperationId // Include for idempotency
                }
            }));
            console.log(`[hold-call] SMA hold command successful (${holdOperationId})`);
        } catch (smaErr: any) {
            console.error(`[hold-call] STEP 1 FAILED - SMA hold command failed (${holdOperationId}):`, smaErr);
            return {
                statusCode: 503,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'SMA service unavailable. Please try again.',
                    error: 'SMA_COMMAND_FAILED',
                    holdOperationId
                })
            };
        }
        
        // Step 2: Verify attendee removal (if applicable)
        if (agentAttendeeId && meetingId) {
            try {
                await chimeClient.send(new DeleteAttendeeCommand({
                    MeetingId: meetingId,
                    AttendeeId: agentAttendeeId
                }));
                console.log(`[hold-call] Agent attendee removed from meeting (${holdOperationId})`);
            } catch (deleteErr: any) {
                if (deleteErr.name === 'NotFoundException') {
                    console.log(`[hold-call] Agent attendee already removed (${holdOperationId})`);
                } else {
                    console.warn(`[hold-call] STEP 2 WARNING - Could not verify attendee removal (${holdOperationId}):`, deleteErr);
                    // Non-fatal - continue with hold operation (SMA already on hold)
                }
            }
        }
        
        // Step 3: Update both records atomically in a transaction
        const timestamp = new Date().toISOString();
        try {
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'SET #status = :status, callStatus = :status, holdStartTime = :time, heldByAgentId = :agentId, holdOperationId = :operationId',
                            ConditionExpression: '#status = :connectedStatus AND assignedAgentId = :agentId',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':status': 'on_hold',
                                ':time': timestamp,
                                ':connectedStatus': 'connected',
                                ':agentId': agentId,
                                ':operationId': holdOperationId
                            }
                        }
                    },
                    {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId },
                            // CRITICAL FIX #9: Don't store heldCallAttendeeId - always create new attendee on resume
                            UpdateExpression: 'SET callStatus = :status, lastActivityAt = :timestamp, ' +
                                             'heldCallMeetingId = :meetingId, heldCallId = :callId',
                            ConditionExpression: 'currentCallId = :callId',
                            ExpressionAttributeValues: {
                                ':status': 'on_hold',
                                ':timestamp': timestamp,
                                ':meetingId': meetingId || null,
                                ':callId': callId
                            }
                        }
                    }
                ]
            }));
            
            console.log(`[hold-call] Database updated successfully (${holdOperationId})`);

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Call placed on hold',
                    callId,
                    status: 'on_hold',
                    holdOperationId
                })
            };
        } catch (dbErr: any) {
            console.error(`[hold-call] STEP 3 FAILED - Database transaction failed (${holdOperationId}):`, dbErr);
            
            // CRITICAL: SMA is on hold but DB not updated - state inconsistent
            // Cleanup monitor should reconcile this
            
            if (dbErr.name === 'TransactionCanceledException') {
                console.error(`[hold-call] INCONSISTENT STATE - SMA on hold but DB update failed due to condition check (${holdOperationId})`);
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Call state changed during hold operation. Call may be on hold - please check status.',
                        error: 'STATE_CHANGED',
                        holdOperationId
                    })
                };
            }
            
            console.error(`[hold-call] INCONSISTENT STATE - SMA on hold but DB update failed (${holdOperationId})`);
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Database update failed. Call may be on hold - please check status.',
                    error: 'DB_UPDATE_FAILED',
                    holdOperationId
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

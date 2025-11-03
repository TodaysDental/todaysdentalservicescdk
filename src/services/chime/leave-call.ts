import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

/**
 * Lambda handler for non-destructive call leave
 * This is triggered when an agent leaves a call without ending it (e.g., during transfer)
 * It updates the agent's status but does NOT terminate the Chime SMA call
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Leave call event:', JSON.stringify(event, null, 2));
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
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

        // Update the agent's status
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
                                    console.warn(`[leave-call] Race condition - queued call ${oldestCall.callId} already claimed by another agent`);
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
                            
                            console.log(`Assigned queued call ${oldestCall.callId} to agent ${agentId} after leaving previous call`);
                            
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

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chime = new ChimeSDKMeetingsClient({});
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

/**
 * Lambda handler for call hangup notification
 * This is triggered when a call ends (either party hangs up)
 * Cleans up the database and Chime resources
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

        const body = JSON.parse(event.body);
        const { callId, agentId, reason, duration } = body;

        if (!callId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameter: callId' }) 
            };
        }

        // 1. Get the call details
        const { Item: callRecord } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { callId }
        }));

        if (!callRecord) {
            console.warn(`Call ${callId} not found in database`);
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found' })
            };
        }

        // 2. Update the call status to 'ended'
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { callId },
            UpdateExpression: 'SET callStatus = :status, endedAt = :timestamp, endReason = :reason, callDuration = :duration',
            ExpressionAttributeValues: {
                ':status': 'ended',
                ':timestamp': new Date().toISOString(),
                ':reason': reason || 'normal_hangup',
                ':duration': duration || 0
            }
        }));

        // 3. If an agent was on the call, update their status
        const assignedAgentId = agentId || callRecord.assignedAgentId;
        if (assignedAgentId) {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: assignedAgentId },
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
                Key: { agentId: assignedAgentId },
                UpdateExpression: 'ADD completedCalls :one, totalCallDuration :duration',
                ExpressionAttributeValues: {
                    ':one': 1,
                    ':duration': duration || 0
                }
            }));
        }

        // 4. If there were agents still ringing, clear their ringing status
        if (callRecord.agentIds && Array.isArray(callRecord.agentIds)) {
            await Promise.all(callRecord.agentIds.map(async (agentId: string) => {
                try {
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId },
                        UpdateExpression: 'REMOVE ringingCallId SET lastActivityAt = :timestamp',
                        ExpressionAttributeValues: {
                            ':timestamp': new Date().toISOString()
                        },
                        ConditionExpression: 'attribute_exists(agentId)' // Only update if agent exists
                    }));
                } catch (err) {
                    // Ignore if agent doesn't exist
                    console.warn(`Agent ${agentId} not found, skipping update`);
                }
            }));
        }

        // 5. Clean up the Chime meeting if it exists
        if (callRecord.meetingId) {
            try {
                await chime.send(new DeleteMeetingCommand({
                    MeetingId: callRecord.meetingId
                }));
                console.log(`Deleted Chime meeting ${callRecord.meetingId}`);
            } catch (deleteError: any) {
                // Meeting might already be deleted or expired
                if (deleteError.name !== 'NotFoundException') {
                    console.error('Error deleting meeting:', deleteError);
                }
            }
        }

        // 6. If the call was in a queue, update the queue status
        if (CALL_QUEUE_TABLE_NAME && callRecord.clinicId) {
            const { Items: queueItems } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: {
                    ':callId': callId
                }
            }));

            if (queueItems && queueItems[0]) {
                const queueEntry = queueItems[0];
                const finalStatus = callRecord.callStatus === 'connected' ? 'completed' : 'abandoned';
                
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: {
                        clinicId: callRecord.clinicId,
                        queuePosition: queueEntry.queuePosition
                    },
                    UpdateExpression: 'SET #status = :status, endedAt = :timestamp',
                    ExpressionAttributeNames: {
                        '#status': 'status'
                    },
                    ExpressionAttributeValues: {
                        ':status': finalStatus,
                        ':timestamp': new Date().toISOString()
                    }
                }));

                // Reorder remaining queue positions if needed
                if (queueEntry.status === 'queued') {
                    const { Items: remainingItems } = await ddb.send(new QueryCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        KeyConditionExpression: 'clinicId = :cid',
                        FilterExpression: '#status = :status AND queuePosition > :pos',
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':cid': callRecord.clinicId,
                            ':status': 'queued',
                            ':pos': queueEntry.queuePosition
                        }
                    }));

                    if (remainingItems) {
                        await Promise.all(remainingItems.map(item =>
                            ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: {
                                    clinicId: callRecord.clinicId,
                                    queuePosition: item.queuePosition
                                },
                                UpdateExpression: 'SET queuePosition = :newPos',
                                ExpressionAttributeValues: {
                                    ':newPos': item.queuePosition - 1
                                }
                            }))
                        ));
                    }
                }
            }
        }

        // 7. Archive the call record (optional - move to a separate table for analytics)
        // This could be done asynchronously via DynamoDB Streams or EventBridge
        
        console.log(`Call ${callId} ended. Cleanup completed.`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call hangup processed',
                callId,
                agentId: assignedAgentId,
                duration: duration || 0,
                status: 'ended'
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

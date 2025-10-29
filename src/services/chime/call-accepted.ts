import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

/**
 * Lambda handler for call acceptance notification
 * This is triggered when an agent accepts an incoming call and Chime fires the MEETING_ACCEPTED event
 * Updates the database to reflect that the call has been accepted and which agent accepted it
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Call accepted event:', JSON.stringify(event, null, 2));
    
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
        const { callId, agentId, meetingId } = body;

        if (!callId || !agentId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) 
            };
        }

        // 1. Update the call status to 'connected' and assign the agent
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { callId },
            UpdateExpression: 'SET callStatus = :status, assignedAgentId = :agentId, acceptedAt = :timestamp',
            ExpressionAttributeValues: {
                ':status': 'connected',
                ':agentId': agentId,
                ':timestamp': new Date().toISOString()
            }
        }));

        // 2. Update the agent's status to indicate they're on a call
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId },
            UpdateExpression: 'SET #status = :status, currentCallId = :callId, lastActivityAt = :timestamp',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'OnCall',
                ':callId': callId,
                ':timestamp': new Date().toISOString()
            }
        }));

        // 3. Update all other agents who were ringing for this call to stop ringing
        // First, get the list of agents who were notified
        const { Items } = await ddb.send(new QueryCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: {
                ':callId': callId
            },
            ProjectionExpression: 'agentIds'
        }));

        if (Items && Items[0] && Items[0].agentIds) {
            const otherAgents = Items[0].agentIds.filter((id: string) => id !== agentId);
            
            // Update each other agent's ringing status
            await Promise.all(otherAgents.map((otherAgentId: string) => 
                ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId: otherAgentId },
                    UpdateExpression: 'REMOVE ringingCallId SET lastActivityAt = :timestamp',
                    ExpressionAttributeValues: {
                        ':timestamp': new Date().toISOString()
                    }
                }))
            ));
        }

        // 4. If the call was in a queue, remove it from the queue
        if (CALL_QUEUE_TABLE_NAME) {
            // Get the call's clinic ID
            const { Item: callRecord } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { callId }
            }));

            if (callRecord?.clinicId) {
                // Find and update the queue entry
                const { Items: queueItems } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :callId',
                    ExpressionAttributeValues: {
                        ':callId': callId
                    }
                }));

                if (queueItems && queueItems[0]) {
                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: {
                            clinicId: callRecord.clinicId,
                            queuePosition: queueItems[0].queuePosition
                        },
                        UpdateExpression: 'SET #status = :status, connectedAt = :timestamp',
                        ExpressionAttributeNames: {
                            '#status': 'status'
                        },
                        ExpressionAttributeValues: {
                            ':status': 'connected',
                            ':timestamp': new Date().toISOString()
                        }
                    }));
                }
            }
        }

        console.log(`Call ${callId} accepted by agent ${agentId}`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call acceptance recorded',
                callId,
                agentId,
                status: 'connected'
            })
        };

    } catch (error) {
        console.error('Error processing call acceptance:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

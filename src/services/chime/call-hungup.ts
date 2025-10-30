import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

/**
 * Lambda handler for call hangup notification
 * This is triggered by the frontend when an agent hangs up
 * Only updates agent status - the SMA handles actual call cleanup
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

        // Only update the agent's status back to Online
        if (agentId) {
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
        }

        // Note: All call cleanup (meeting deletion, queue updates) is handled by the SMA
        // This API only updates agent status
        
        console.log(`Agent ${agentId} marked as available after hanging up call ${callId}`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Agent status updated',
                callId,
                agentId,
                duration: duration || 0
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

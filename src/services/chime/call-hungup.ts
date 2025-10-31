import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
// CORRECTED IMPORT: Use UpdateSipMediaApplicationCallCommand to manipulate an active call
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoiceClient = new ChimeSDKVoiceClient({});

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const SMA_ID = process.env.SMA_ID;


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

        const body = JSON.parse(event.body);
        const { callId, agentId, reason, duration } = body;

        if (!callId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameter: callId' }) 
            };
        }
        
        if (!SMA_ID) {
            console.error('SMA_ID environment variable is missing. Cannot hang up customer leg.');
        }

        // 1. Update the agent's status and metrics
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
             console.log(`Agent ${agentId} status updated to Online.`);
        }

        // 2. Terminate the customer's call leg (the entire transaction)
        
        if (SMA_ID) {
            console.log(`Attempting to force hangup on call transaction: ${callId}`);
            
            try {
                // CORRECTED COMMAND: Use UpdateSipMediaApplicationCallCommand with Hangup action
                await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: SMA_ID,
                    TransactionId: callId,
                    Arguments: {
                        Action: "Hangup" // This signals the SMA to hang up the transaction
                    }
                }));
                 console.log(`Successfully sent Hangup action for TransactionId: ${callId}`);
                 
            } catch (error: any) {
                console.error(`Error forcing Hangup on SMA call for ${callId}:`, error.message, error.name);
            }
        } else {
             console.warn('SMA_ID not defined. Customer leg not explicitly terminated. Relying on passive SMA cleanup.');
        }
        
        console.log(`Agent ${agentId} marked as available after hanging up call ${callId}`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Call termination initiated and agent status updated',
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
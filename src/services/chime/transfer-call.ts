import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chimeVoice = new ChimeSDKVoiceClient({});
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const SMA_ID = process.env.SMA_ID;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Missing request body' }) };
        }

        const body = JSON.parse(event.body);
        const { callId, fromAgentId, toAgentId } = body;

        if (!callId || !fromAgentId || !toAgentId) {
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, fromAgentId, toAgentId' }) 
            };
        }

        // 1. Verify the target agent is available
        const { Item: targetAgent } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId: toAgentId }
        }));

        if (!targetAgent || targetAgent.status !== 'Online') {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Target agent is not available' })
            };
        }

        // 2. Find the call record in the call queue table
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

        // Update call record with transfer status
        await ddb.send(new UpdateCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: { clinicId, queuePosition },
            UpdateExpression: 'SET transferStatus = :ts, transferToAgentId = :ta',
            ExpressionAttributeValues: {
                ':ts': 'pending',
                ':ta': toAgentId
            }
        }));

        // 3. Trigger the SMA to handle the transfer
        if (SMA_ID) {
            try {
                await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: SMA_ID,
                    TransactionId: callId,
                    Arguments: {
                        action: 'TRANSFER_INITIATED',
                        fromAgentId,
                        toAgentId
                    }
                }));
            } catch (updateError) {
                console.error('Error triggering SMA for transfer:', updateError);
                // Continue even if SMA update fails - the transfer status is already recorded
            }
        } else {
            console.warn('SMA_ID not configured - transfer will not be triggered automatically');
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Transfer initiated',
                transferStatus: 'pending'
            })
        };

    } catch (error) {
        console.error('Error processing transfer request:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};
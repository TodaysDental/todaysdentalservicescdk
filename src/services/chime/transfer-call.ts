import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;

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

        // 2. Update call record with transfer status
        await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { callId },
            UpdateExpression: 'SET transferStatus = :ts, transferToAgentId = :ta',
            ExpressionAttributeValues: {
                ':ts': 'pending',
                ':ta': toAgentId
            }
        }));

        // The SIP Media Application will handle the actual transfer in its next event cycle

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
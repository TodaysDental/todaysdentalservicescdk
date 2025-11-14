import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

/**
 * Handles the $disconnect event by removing the connection ID from the mapping table.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId as string;

    try {
        await ddb.send(new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId: connectionId },
        }));

        console.log(`Connection removed: ${connectionId}`);
        return { statusCode: 200, body: 'Disconnected' };
    } catch (error) {
        console.error('Error handling disconnect:', error);
        return { statusCode: 500, body: 'Failed to disconnect' };
    }
};
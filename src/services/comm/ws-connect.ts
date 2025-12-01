import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { verifyToken } from '../../shared/utils/jwt';

const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

/**
 * Handles the $connect event. It authenticates the user using the access token 
 * passed in the query string and stores the connection ID and user ID.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId;
    const token = event.queryStringParameters?.token || event.queryStringParameters?.idToken;

    if (!token) {
        console.error('Missing access token in query string.');
        // Unauthenticated connections are rejected
        return { statusCode: 401, body: 'Unauthorized' };
    }

    try {
        // 1. Verify the access token using custom JWT
        const payload = await verifyToken(token);
        
        // Ensure it's an access token (not refresh token)
        if (payload.type !== 'access') {
            console.error('Invalid token type. Access token required.');
            return { statusCode: 401, body: 'Access token required' };
        }
        
        // The user ID is the email (sub)
        const userID = payload.sub || payload.email;

        if (!userID) {
            return { statusCode: 401, body: 'Invalid Token Payload' };
        }

        // 2. Register the connection in DynamoDB
        await ddb.send(new PutCommand({
            TableName: CONNECTIONS_TABLE,
            Item: {
                connectionId: connectionId,
                userID: userID,
                email: payload.email,
                // TTL (e.g., 2 hours from now) for automatic cleanup
                ttl: Math.floor(Date.now() / 1000) + 7200, 
                connectedAt: new Date().toISOString(),
            },
        }));

        console.log(`Connection registered for user ${userID} with ID ${connectionId}`);
        return { statusCode: 200, body: 'Connected' };

    } catch (error) {
        console.error('Authentication or connection failed:', error);
        return { statusCode: 401, body: 'Unauthorized or Internal Error' };
    }
};
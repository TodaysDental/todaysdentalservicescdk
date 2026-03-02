import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { verifyToken } from '../../shared/utils/jwt';
import { ddb, env, createLogger } from './shared';

const log = createLogger('ws-connect');
const CONNECTIONS_TABLE = env.CONNECTIONS_TABLE;

/**
 * Handles the $connect event. It authenticates the user using the access token 
 * passed in the query string and stores the connection ID and user ID.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId;
    const token = event.queryStringParameters?.token || event.queryStringParameters?.idToken;
    const deviceIdRaw = event.queryStringParameters?.deviceId;
    const clientRaw = event.queryStringParameters?.client;

    const deviceId = typeof deviceIdRaw === 'string' ? deviceIdRaw.trim().slice(0, 128) : '';
    const client = typeof clientRaw === 'string' ? clientRaw.trim().slice(0, 32) : '';

    if (!token) {
        log.warn('Missing access token in query string');
        return { statusCode: 401, body: 'Unauthorized' };
    }

    try {
        // 1. Verify the access token using custom JWT
        const payload = await verifyToken(token);
        
        if (payload.type !== 'access') {
            log.warn('Invalid token type, access token required');
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
                ...(deviceId ? { deviceId } : {}),
                ...(client ? { client } : {}),
                // TTL (e.g., 2 hours from now) for automatic cleanup
                ttl: Math.floor(Date.now() / 1000) + 7200, 
                connectedAt: new Date().toISOString(),
            },
        }));

        log.info('Connection registered', { userID: userID as string, connectionId: connectionId as string });
        return { statusCode: 200, body: 'Connected' };

    } catch (error) {
        log.error('Authentication or connection failed', {}, error as Error);
        return { statusCode: 401, body: 'Unauthorized or Internal Error' };
    }
};
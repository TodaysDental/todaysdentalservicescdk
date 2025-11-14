import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// Auth setup (using same logic as your existing files)
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Handles the $connect event. It authenticates the user using the ID Token 
 * passed in the query string and stores the connection ID and user ID.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId;
    const token = event.queryStringParameters?.idToken;

    if (!token) {
        console.error('Missing ID Token in query string.');
        // Unauthenticated connections are rejected
        return { statusCode: 401, body: 'Unauthorized' };
    }

    try {
        // 1. Verify the ID Token
        JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
        const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
        
        // The user ID should be the Cognito UUID (`sub`)
        const userID = payload.sub;

        if (!userID) {
            return { statusCode: 401, body: 'Invalid Token Payload' };
        }

        // 2. Register the connection in DynamoDB
        await ddb.send(new PutCommand({
            TableName: CONNECTIONS_TABLE,
            Item: {
                connectionId: connectionId,
                userID: userID,
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
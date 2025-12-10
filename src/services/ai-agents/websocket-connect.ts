/**
 * WebSocket Connect Handler for AI Agents
 * 
 * Handles new WebSocket connections for public AI agent chat.
 * No authentication required - uses CORS for security.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'AiAgentConnections';

// WebSocket connect event has headers and queryStringParameters like regular API Gateway
interface WebSocketConnectEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent['requestContext'] & {
    connectionId: string;
    routeKey: string;
    eventType: string;
  };
}

export const handler = async (event: WebSocketConnectEvent) => {
  console.log('WebSocket Connect:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const origin = event.headers?.origin || event.headers?.Origin || '';

  // Validate origin (CORS check)
  const isAllowedOrigin = ALLOWED_ORIGINS_LIST.some(allowed => 
    origin === allowed || 
    origin.startsWith(allowed.replace(/\/$/, ''))
  );

  if (!isAllowedOrigin && origin !== '') {
    console.warn('Connection rejected - invalid origin:', origin);
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Origin not allowed' }),
    };
  }

  // Extract query parameters
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  const agentId = queryParams.agentId;

  if (!clinicId || !agentId) {
    console.warn('Connection rejected - missing clinicId or agentId');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'clinicId and agentId are required as query parameters' }),
    };
  }

  // Store connection info
  const ttl = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hour TTL

  await docClient.send(new PutCommand({
    TableName: CONNECTIONS_TABLE,
    Item: {
      connectionId,
      clinicId,
      agentId,
      origin,
      connectedAt: new Date().toISOString(),
      ttl,
    },
  }));

  console.log('Connection established:', { connectionId, clinicId, agentId, origin });

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Connected', connectionId }),
  };
};


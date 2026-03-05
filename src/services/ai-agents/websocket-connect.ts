/**
 * WebSocket Connect Handler for AI Agents
 * 
 * Handles new WebSocket connections for public AI agent chat.
 * No authentication required - uses CORS for security.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';
import { AiAgent } from './agents';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'AiAgentConnections';
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';

// DEBUG: Log environment variables at module load time
console.log('[WsConnect] Environment variables:', {
  CONNECTIONS_TABLE,
  AGENTS_TABLE,
  ENV_CONNECTIONS_TABLE: process.env.CONNECTIONS_TABLE,
  ENV_AGENTS_TABLE: process.env.AGENTS_TABLE,
});

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
  // SECURITY FIX: Empty origin should be rejected in production
  // Empty origin occurs with non-browser clients (scripts, cURL, etc.)
  // Only allow empty origin in development for testing
  const isDevelopment = process.env.NODE_ENV === 'development' || 
                        process.env.AWS_SAM_LOCAL === 'true';
  
  if (!origin && !isDevelopment) {
    console.warn('Connection rejected - empty origin (non-browser client)');
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'WebSocket connections require a valid origin header' }),
    };
  }
  
  const isAllowedOrigin = origin === '' || ALLOWED_ORIGINS_LIST.some(allowed => 
    origin === allowed || 
    origin.startsWith(allowed.replace(/\/$/, ''))
  );

  if (!isAllowedOrigin) {
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

  // FIX: Validate agent upfront to fail fast on invalid connections
  // This prevents storing connections for non-existent or inactive agents
  try {
    const agentResponse = await docClient.send(new GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId },
    }));

    const agent = agentResponse.Item as AiAgent | undefined;

    if (!agent) {
      console.warn('Connection rejected - agent not found:', agentId);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Agent not found' }),
      };
    }

    if (!agent.isActive) {
      console.warn('Connection rejected - agent not active:', agentId);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Agent is not active' }),
      };
    }

    if (!agent.isWebsiteEnabled) {
      console.warn('Connection rejected - agent not website-enabled:', agentId);
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Agent is not enabled for website chat' }),
      };
    }

    if (agent.clinicId !== clinicId && !agent.isPublic) {
      console.warn('Connection rejected - agent does not belong to clinic:', { agentId, clinicId, agentClinicId: agent.clinicId });
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Agent does not belong to this clinic' }),
      };
    }

    if (agent.bedrockAgentStatus !== 'PREPARED') {
      console.warn('Connection rejected - agent not ready:', { agentId, status: agent.bedrockAgentStatus });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Agent is not ready. Please try again later.' }),
      };
    }
  } catch (error) {
    console.error('Error validating agent:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to validate agent' }),
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
      // Initialize rate limit fields
      rateLimitCount: 0,
      rateLimitWindowStart: 0,
      sessionMessageCount: 0,
    },
  }));

  console.log('Connection established:', { connectionId, clinicId, agentId, origin });

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Connected', connectionId }),
  };
};


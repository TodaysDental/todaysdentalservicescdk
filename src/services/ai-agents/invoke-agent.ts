/**
 * Invoke Agent Handler - Uses Bedrock Agent Runtime
 * 
 * Invokes a prepared Bedrock Agent with session management.
 * The agent uses Action Groups to call OpenDental tools.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { AiAgent } from './agents';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';

const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

// ========================================================================
// TYPES
// ========================================================================

interface InvokeRequest {
  message: string;
  clinicId?: string; // Optional if provided in URL path
  sessionId?: string; // Optional - will create new if not provided
  endSession?: boolean; // End the session after this message
  enableTrace?: boolean; // Enable agent trace for debugging
}

interface InvokeResponse {
  response: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  clinicId: string;
  trace?: any[]; // Trace events if enabled
  metrics?: {
    latencyMs: number;
  };
}

// ========================================================================
// HELPERS
// ========================================================================

/**
 * Check if this is a public (website) request
 */
function isPublicRequest(event: APIGatewayProxyEvent): boolean {
  const path = event.path || event.resource || '';
  return path.includes('/public/');
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const isPublic = isPublicRequest(event);

  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  if (httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // For authenticated requests, check JWT
  let userPerms: UserPermissions | null = null;
  let userName = 'Website Visitor';
  let userId = '';

  if (!isPublic) {
    userPerms = getUserPermissions(event);
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }
    userName = getUserDisplayName(userPerms);
    userId = userPerms.email || '';
  }

  const agentId = event.pathParameters?.agentId;
  const pathClinicId = event.pathParameters?.clinicId;
  
  if (!agentId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent ID is required' }),
    };
  }

  const startTime = Date.now();

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}') as InvokeRequest;
    const clinicId = pathClinicId || body.clinicId;
    
    if (!clinicId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'clinicId is required (in path or body)' }),
      };
    }

    if (!body.message) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'message is required' }),
      };
    }

    // Get agent from DynamoDB
    const getAgentResponse = await docClient.send(
      new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } })
    );
    const agent = getAgentResponse.Item as AiAgent | undefined;

    if (!agent) {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Agent not found' }),
      };
    }

    // Verify agent belongs to the clinic
    if (agent.clinicId !== clinicId && !agent.isPublic) {
      return {
        statusCode: 403,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Agent does not belong to this clinic' }),
      };
    }

    // ========== PUBLIC REQUEST VALIDATION ==========
    if (isPublic) {
      // Check if website chatbot is enabled
      if (!agent.isWebsiteEnabled) {
        return {
          statusCode: 403,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ error: 'Website chatbot is not enabled for this agent' }),
        };
      }

      // CORS is handled by buildCorsHeaders using ALLOWED_ORIGINS_LIST from cors.ts
      // which includes all clinic websiteLinks

      // Use visitor info from body if provided
      userName = (body as any).visitorName || 'Website Visitor';
      userId = (body as any).visitorId || `visitor-${uuidv4().slice(0, 8)}`;
    }
    // ========== AUTHENTICATED REQUEST VALIDATION ==========
    else {
      // Check user access permissions
      const userClinicIds = userPerms!.clinicRoles.map((cr) => cr.clinicId);
      const isAdmin = userPerms!.isSuperAdmin || userPerms!.isGlobalSuperAdmin;

      if (!isAdmin && !userClinicIds.includes(clinicId)) {
        return {
          statusCode: 403,
          headers: getCorsHeaders(event),
          body: JSON.stringify({ error: 'You do not have access to this clinic' }),
        };
      }
    }

    // ========== COMMON VALIDATION ==========
    
    // Check if agent is ready
    if (!agent.isActive) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Agent is not active' }),
      };
    }

    if (!agent.bedrockAgentId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'No Bedrock Agent associated with this agent' }),
      };
    }

    if (!agent.bedrockAgentAliasId) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Agent is not prepared',
          status: agent.bedrockAgentStatus,
        }),
      };
    }

    if (agent.bedrockAgentStatus !== 'PREPARED') {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: `Agent is not ready. Current status: ${agent.bedrockAgentStatus}`,
          status: agent.bedrockAgentStatus,
        }),
      };
    }

    // Generate or use provided session ID
    const sessionId = body.sessionId || uuidv4();

    // Build session attributes (passed to action group Lambda)
    const sessionAttributes: Record<string, string> = {
      clinicId: clinicId,
      userId: userId,
      userName: userName,
      isPublicRequest: isPublic ? 'true' : 'false',
    };

    // Invoke the Bedrock Agent
    const invokeCommand = new InvokeAgentCommand({
      agentId: agent.bedrockAgentId,
      agentAliasId: agent.bedrockAgentAliasId,
      sessionId: sessionId,
      inputText: body.message,
      enableTrace: body.enableTrace || false,
      endSession: body.endSession || false,
      sessionState: {
        sessionAttributes,
      },
    });

    const bedrockResponse: InvokeAgentCommandOutput = await bedrockAgentRuntimeClient.send(invokeCommand);

    // Process the streaming response
    let responseText = '';
    const traceEvents: any[] = [];

    if (bedrockResponse.completion) {
      for await (const event of bedrockResponse.completion) {
        if (event.chunk?.bytes) {
          const chunk = new TextDecoder().decode(event.chunk.bytes);
          responseText += chunk;
        }
        if (event.trace && body.enableTrace) {
          traceEvents.push(event.trace);
        }
      }
    }

    const latencyMs = Date.now() - startTime;

    // Update usage count
    await docClient.send(
      new UpdateCommand({
        TableName: AGENTS_TABLE,
        Key: { agentId },
        UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :zero) + :one',
        ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
      })
    );

    const response: InvokeResponse = {
      response: responseText || 'No response from agent',
      sessionId,
      agentId: agent.agentId,
      agentName: agent.name,
      clinicId,
      metrics: {
        latencyMs,
      },
    };

    if (body.enableTrace && traceEvents.length > 0) {
      response.trace = traceEvents;
    }

    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify(response),
    };
  } catch (error: any) {
    console.error('Invoke agent error:', error);

    // Handle specific Bedrock Agent errors
    if (error.name === 'ValidationException') {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Invalid request to Bedrock Agent',
          details: error.message,
        }),
      };
    }

    if (error.name === 'ResourceNotFoundException') {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Bedrock Agent not found. It may have been deleted.',
          details: error.message,
        }),
      };
    }

    if (error.name === 'ThrottlingException') {
      return {
        statusCode: 429,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Too many requests. Please try again later.',
          details: error.message,
        }),
      };
    }

    if (error.name === 'AccessDeniedException') {
      return {
        statusCode: 403,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Access denied to Bedrock Agent',
          details: error.message,
        }),
      };
    }

    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ 
        error: error.message || 'Internal server error',
        errorType: error.name,
      }),
    };
  }
};

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { AiAgent, AVAILABLE_MODELS } from './agents';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const EXECUTIONS_TABLE = process.env.EXECUTIONS_TABLE || 'AgentExecutions';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

/**
 * Execution record for tracking agent invocations
 */
interface AgentExecution {
  executionId: string;
  agentId: string;
  timestamp: number;
  
  // Request data
  userMessage: string;
  contextData?: Record<string, any>;
  
  // Full prompt that was sent (for debugging/audit)
  fullPrompt: string;
  
  // Response data
  response: string;
  
  // Performance metrics
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  
  // Metadata
  modelId: string;
  clinicId: string;
  invokedBy: string;
  
  // TTL for auto-cleanup (90 days)
  ttl: number;
}

/**
 * Invoke request body
 */
interface InvokeRequest {
  message: string;                    // User's input message
  context?: Record<string, any>;      // Additional context data
  overrideUserPrompt?: string;        // Optional: Override the agent's user prompt for this call
  conversationHistory?: Array<{       // Optional: Previous conversation for context
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;

  // Handle OPTIONS request for CORS preflight
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: 'CORS preflight response' }),
    };
  }

  // Only handle POST requests
  if (httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return {
      statusCode: 401,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized - Invalid token' }),
    };
  }

  const agentId = event.pathParameters?.agentId;
  if (!agentId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent ID is required' }),
    };
  }

  try {
    return await invokeAgent(event, userPerms, agentId);
  } catch (error: any) {
    console.error('Invoke agent error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message ?? 'Internal Server Error' }),
    };
  }
};

/**
 * Invoke an AI agent with the 3-level prompt system
 */
async function invokeAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();

  // Get the agent configuration
  const agentResponse = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  }));

  const agent = agentResponse.Item as AiAgent | undefined;
  if (!agent) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent not found' }),
    };
  }

  // Check if agent is active
  if (!agent.isActive) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent is currently disabled' }),
    };
  }

  // Check access permissions
  const userClinicIds = userPerms.clinicRoles.map(cr => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin && !userClinicIds.includes(agent.clinicId) && !agent.isPublic) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have access to this agent' }),
    };
  }

  // Parse request body
  const body = JSON.parse(event.body || '{}') as InvokeRequest;

  if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Message is required' }),
    };
  }

  // Build the 3-level prompt
  const fullPrompt = buildPrompt(agent, body);

  // Get model info
  const modelInfo = AVAILABLE_MODELS.find(m => m.id === agent.modelId);
  if (!modelInfo) {
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Invalid model configuration' }),
    };
  }

  // Invoke the AI model
  let response: string;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await invokeBedrockModel(
      agent.modelId,
      fullPrompt,
      body.conversationHistory || [],
      agent.temperature,
      agent.maxTokens,
      agent.topP
    );
    response = result.response;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
  } catch (error: any) {
    console.error('Bedrock invocation error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ 
        error: 'Failed to invoke AI model',
        details: error.message,
      }),
    };
  }

  const latencyMs = Date.now() - startTime;

  // Record the execution
  const execution: AgentExecution = {
    executionId: uuidv4(),
    agentId,
    timestamp: Date.now(),
    userMessage: body.message,
    contextData: body.context,
    fullPrompt,
    response,
    inputTokens,
    outputTokens,
    latencyMs,
    modelId: agent.modelId,
    clinicId: agent.clinicId,
    invokedBy: getUserDisplayName(userPerms),
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
  };

  // Save execution record and increment usage count in parallel
  await Promise.all([
    docClient.send(new PutCommand({
      TableName: EXECUTIONS_TABLE,
      Item: execution,
    })),
    docClient.send(new UpdateCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :zero) + :one',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
      },
    })),
  ]);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      response,
      executionId: execution.executionId,
      agentId,
      agentName: agent.name,
      modelId: agent.modelId,
      metrics: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs,
      },
    }),
  };
}

/**
 * Build the complete prompt using the 3-level system:
 * 1. System Prompt (constant behavior definition)
 * 2. Negative Prompt (what NOT to do)
 * 3. User Prompt (customizable instructions)
 */
function buildPrompt(agent: AiAgent, request: InvokeRequest): string {
  const parts: string[] = [];

  // Level 1: System Prompt (constant)
  parts.push('=== SYSTEM INSTRUCTIONS ===');
  parts.push(agent.systemPrompt);
  parts.push('');

  // Level 2: Negative Prompt (constant restrictions)
  parts.push('=== RESTRICTIONS ===');
  parts.push(agent.negativePrompt);
  parts.push('');

  // Level 3: User-customizable Prompt
  const userPrompt = request.overrideUserPrompt || agent.userPrompt;
  if (userPrompt && userPrompt.trim().length > 0) {
    parts.push('=== ADDITIONAL INSTRUCTIONS ===');
    parts.push(userPrompt);
    parts.push('');
  }

  // Add context if provided
  if (request.context && Object.keys(request.context).length > 0) {
    parts.push('=== CONTEXT ===');
    parts.push(JSON.stringify(request.context, null, 2));
    parts.push('');
  }

  // Add the user's message
  parts.push('=== USER MESSAGE ===');
  parts.push(request.message);

  return parts.join('\n');
}

/**
 * Invoke a Bedrock model with the given prompt
 */
async function invokeBedrockModel(
  modelId: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  temperature: number,
  maxTokens: number,
  topP: number
): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
  // Build the request based on the model provider
  const isAnthropic = modelId.startsWith('anthropic.');
  const isAmazon = modelId.startsWith('amazon.');
  const isMeta = modelId.startsWith('meta.');
  const isMistral = modelId.startsWith('mistral.');

  let requestBody: Record<string, any>;

  if (isAnthropic) {
    // Anthropic Claude format
    const messages = [
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content: systemPrompt, // Our combined prompt goes as the user message
      },
    ];

    requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      messages,
    };
  } else if (isAmazon) {
    // Amazon Titan format
    requestBody = {
      inputText: systemPrompt,
      textGenerationConfig: {
        maxTokenCount: maxTokens,
        temperature,
        topP,
      },
    };
  } else if (isMeta) {
    // Meta Llama format
    requestBody = {
      prompt: systemPrompt,
      max_gen_len: maxTokens,
      temperature,
      top_p: topP,
    };
  } else if (isMistral) {
    // Mistral format
    requestBody = {
      prompt: `<s>[INST] ${systemPrompt} [/INST]`,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
    };
  } else {
    // Default format (fallback)
    requestBody = {
      prompt: systemPrompt,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
    };
  }

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Parse response based on model provider
  let text: string;
  let inputTokens = 0;
  let outputTokens = 0;

  if (isAnthropic) {
    text = responseBody.content?.[0]?.text || '';
    inputTokens = responseBody.usage?.input_tokens || 0;
    outputTokens = responseBody.usage?.output_tokens || 0;
  } else if (isAmazon) {
    text = responseBody.results?.[0]?.outputText || '';
    inputTokens = responseBody.inputTextTokenCount || 0;
    outputTokens = responseBody.results?.[0]?.tokenCount || 0;
  } else if (isMeta) {
    text = responseBody.generation || '';
    inputTokens = responseBody.prompt_token_count || 0;
    outputTokens = responseBody.generation_token_count || 0;
  } else if (isMistral) {
    text = responseBody.outputs?.[0]?.text || '';
    // Mistral doesn't always return token counts in the same way
    inputTokens = 0;
    outputTokens = 0;
  } else {
    text = responseBody.generation || responseBody.completions?.[0]?.data?.text || '';
    inputTokens = 0;
    outputTokens = 0;
  }

  return {
    response: text.trim(),
    inputTokens,
    outputTokens,
  };
}


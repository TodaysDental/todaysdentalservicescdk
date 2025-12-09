import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const EXECUTIONS_TABLE = process.env.EXECUTIONS_TABLE || 'AgentExecutions';

// Module for permission checks
const AI_AGENTS_MODULE = 'IT';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

/**
 * Available AI Models for agent configuration
 */
export const AVAILABLE_MODELS = [
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    name: 'Claude 3.5 Sonnet v2',
    provider: 'Anthropic',
    description: 'Latest Claude 3.5 Sonnet - Best balance of intelligence and speed',
    maxTokens: 8192,
    contextWindow: 200000,
    recommended: true,
  },
  {
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    name: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    description: 'Fast and efficient for simple tasks',
    maxTokens: 8192,
    contextWindow: 200000,
    recommended: false,
  },
  {
    id: 'anthropic.claude-3-opus-20240229-v1:0',
    name: 'Claude 3 Opus',
    provider: 'Anthropic',
    description: 'Most powerful Claude model for complex reasoning',
    maxTokens: 4096,
    contextWindow: 200000,
    recommended: false,
  },
  {
    id: 'amazon.titan-text-premier-v1:0',
    name: 'Amazon Titan Text Premier',
    provider: 'Amazon',
    description: 'Amazon\'s premier text generation model',
    maxTokens: 3072,
    contextWindow: 32000,
    recommended: false,
  },
  {
    id: 'meta.llama3-1-70b-instruct-v1:0',
    name: 'Llama 3.1 70B Instruct',
    provider: 'Meta',
    description: 'Open-source large language model',
    maxTokens: 2048,
    contextWindow: 128000,
    recommended: false,
  },
  {
    id: 'mistral.mistral-large-2407-v1:0',
    name: 'Mistral Large',
    provider: 'Mistral AI',
    description: 'Mistral\'s flagship model for complex tasks',
    maxTokens: 8192,
    contextWindow: 128000,
    recommended: false,
  },
] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];

/**
 * AI Agent configuration interface
 */
export interface AiAgent {
  agentId: string;
  name: string;
  description: string;
  modelId: ModelId;
  
  // 3-Level Prompt System
  systemPrompt: string;      // Level 1: Constant system prompt (we define the base behavior)
  negativePrompt: string;    // Level 2: Constant negative prompt (what NOT to do)
  userPrompt: string;        // Level 3: Customizable prompt from frontend
  
  // Model configuration
  temperature: number;       // 0.0 - 1.0, controls randomness
  maxTokens: number;         // Maximum tokens in response
  topP: number;              // 0.0 - 1.0, nucleus sampling
  
  // Agent metadata
  clinicId: string;          // Clinic this agent belongs to
  isActive: boolean;         // Whether the agent is enabled
  isPublic: boolean;         // Whether the agent is shared across clinics
  
  // Audit fields
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  
  // Optional features
  tags?: string[];           // Tags for categorization
  usageCount?: number;       // Track how many times the agent has been used
}

/**
 * Default system prompt for dental clinic AI agents
 */
const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant for a dental clinic. Your role is to help dental staff with various tasks including:
- Patient communication and scheduling
- Clinical documentation assistance
- Insurance and billing inquiries
- Treatment planning support
- General dental knowledge questions

Always be professional, accurate, and HIPAA-compliant. Never provide medical diagnoses - always recommend patients consult with their dentist for clinical decisions.

When responding:
1. Be concise and clear
2. Use professional medical terminology when appropriate
3. Provide actionable information
4. Respect patient privacy and confidentiality`;

/**
 * Default negative prompt (what the agent should NOT do)
 */
const DEFAULT_NEGATIVE_PROMPT = `DO NOT:
- Provide specific medical diagnoses or treatment recommendations
- Share patient information across different conversations
- Make up or guess information - if unsure, say so
- Engage in inappropriate or unprofessional conversations
- Discuss topics unrelated to dental care or clinic operations
- Provide legal or financial advice beyond general information
- Access or reference external systems or patient records without explicit authorization
- Use offensive, discriminatory, or harmful language
- Make promises about treatment outcomes or costs without verification`;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  let path = event.path || event.resource || '';

  // Normalize path for custom domain mapping
  if (path.startsWith('/ai-agents/ai-agents')) {
    path = path.replace('/ai-agents/ai-agents', '/ai-agents');
  }

  // Handle OPTIONS request for CORS preflight
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: 'CORS preflight response' }),
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

  try {
    // Route handling
    const agentId = event.pathParameters?.agentId;

    // GET /models - List available AI models
    if ((path === '/models' || path.endsWith('/models')) && httpMethod === 'GET') {
      return listModels(event);
    }

    // GET /agents/{agentId}/executions - Get execution history
    if (agentId && (path.endsWith('/executions') || path.includes('/executions')) && httpMethod === 'GET') {
      return await getAgentExecutions(event, userPerms, agentId);
    }

    // GET /agents - List all agents
    if ((path === '/agents' || path.endsWith('/agents')) && httpMethod === 'GET') {
      return await listAgents(event, userPerms);
    }

    // POST /agents - Create new agent
    if ((path === '/agents' || path.endsWith('/agents')) && httpMethod === 'POST') {
      return await createAgent(event, userPerms);
    }

    // GET /agents/{agentId} - Get specific agent
    if (agentId && httpMethod === 'GET' && !path.includes('/executions')) {
      return await getAgent(event, userPerms, agentId);
    }

    // PUT /agents/{agentId} - Update agent
    if (agentId && httpMethod === 'PUT') {
      return await updateAgent(event, userPerms, agentId);
    }

    // DELETE /agents/{agentId} - Delete agent
    if (agentId && httpMethod === 'DELETE') {
      return await deleteAgent(event, userPerms, agentId);
    }

    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Not Found', path, method: httpMethod }),
    };
  } catch (error: any) {
    console.error('AI Agents handler error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message ?? 'Internal Server Error' }),
    };
  }
};

/**
 * List available AI models
 */
function listModels(event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      models: AVAILABLE_MODELS,
      defaultModel: AVAILABLE_MODELS.find(m => m.recommended)?.id || AVAILABLE_MODELS[0].id,
    }),
  };
}

/**
 * List all agents accessible to the user
 */
async function listAgents(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const clinicId = event.queryStringParameters?.clinicId;
  const includePublic = event.queryStringParameters?.includePublic !== 'false';

  let command: ScanCommand | QueryCommand;

  if (clinicId) {
    // Query by clinic using GSI
    command = new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :cid',
      ExpressionAttributeValues: {
        ':cid': clinicId,
      },
    });
  } else {
    // Scan all agents
    command = new ScanCommand({
      TableName: AGENTS_TABLE,
    });
  }

  const response = await docClient.send(command);
  let agents = (response.Items || []) as AiAgent[];

  // Filter based on user permissions
  // Users can see:
  // 1. Agents from clinics they have access to
  // 2. Public agents (isPublic = true)
  const userClinicIds = userPerms.clinicRoles.map(cr => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin) {
    agents = agents.filter(agent => 
      userClinicIds.includes(agent.clinicId) || (includePublic && agent.isPublic)
    );
  }

  // Sort by createdAt descending
  agents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      agents,
      totalCount: agents.length,
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
    }),
  };
}

/**
 * Get a specific agent by ID
 */
async function getAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  const command = new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  });

  const response = await docClient.send(command);
  const agent = response.Item as AiAgent | undefined;

  if (!agent) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent not found' }),
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

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      agent,
      model: AVAILABLE_MODELS.find(m => m.id === agent.modelId),
    }),
  };
}

/**
 * Create a new AI agent
 */
async function createAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');

  // Validate required fields
  if (!body.name) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent name is required' }),
    };
  }

  if (!body.clinicId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Clinic ID is required' }),
    };
  }

  // Check permission to create agents
  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinicId
  );

  if (!canCreate) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have permission to create AI agents' }),
    };
  }

  // Validate model ID
  const modelId = body.modelId || AVAILABLE_MODELS.find(m => m.recommended)?.id || AVAILABLE_MODELS[0].id;
  const selectedModel = AVAILABLE_MODELS.find(m => m.id === modelId);
  if (!selectedModel) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ 
        error: 'Invalid model ID',
        availableModels: AVAILABLE_MODELS.map(m => ({ id: m.id, name: m.name })),
      }),
    };
  }

  const timestamp = new Date().toISOString();
  const createdBy = getUserDisplayName(userPerms);

  const agent: AiAgent = {
    agentId: uuidv4(),
    name: body.name,
    description: body.description || '',
    modelId: modelId as ModelId,
    
    // 3-Level Prompt System
    systemPrompt: body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    negativePrompt: body.negativePrompt || DEFAULT_NEGATIVE_PROMPT,
    userPrompt: body.userPrompt || '',
    
    // Model configuration with sensible defaults
    temperature: typeof body.temperature === 'number' ? Math.min(1, Math.max(0, body.temperature)) : 0.7,
    maxTokens: typeof body.maxTokens === 'number' ? Math.min(selectedModel.maxTokens, Math.max(1, body.maxTokens)) : Math.min(4096, selectedModel.maxTokens),
    topP: typeof body.topP === 'number' ? Math.min(1, Math.max(0, body.topP)) : 0.9,
    
    // Agent metadata
    clinicId: body.clinicId,
    isActive: body.isActive !== false, // Default to active
    isPublic: body.isPublic === true,  // Default to private
    
    // Audit fields
    createdAt: timestamp,
    createdBy,
    updatedAt: timestamp,
    updatedBy: createdBy,
    
    // Optional fields
    tags: Array.isArray(body.tags) ? body.tags : [],
    usageCount: 0,
  };

  await docClient.send(new PutCommand({
    TableName: AGENTS_TABLE,
    Item: agent,
  }));

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Agent created successfully',
      agent,
      model: selectedModel,
    }),
  };
}

/**
 * Update an existing AI agent
 */
async function updateAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  // First, get the existing agent
  const getResponse = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  }));

  const existingAgent = getResponse.Item as AiAgent | undefined;
  if (!existingAgent) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent not found' }),
    };
  }

  // Check permission to update
  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'put',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    existingAgent.clinicId
  );

  if (!canUpdate) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have permission to update this agent' }),
    };
  }

  const body = JSON.parse(event.body || '{}');

  // Validate model ID if provided
  let selectedModel = AVAILABLE_MODELS.find(m => m.id === existingAgent.modelId);
  if (body.modelId) {
    selectedModel = AVAILABLE_MODELS.find(m => m.id === body.modelId);
    if (!selectedModel) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ 
          error: 'Invalid model ID',
          availableModels: AVAILABLE_MODELS.map(m => ({ id: m.id, name: m.name })),
        }),
      };
    }
  }

  const timestamp = new Date().toISOString();
  const updatedBy = getUserDisplayName(userPerms);

  const updatedAgent: AiAgent = {
    ...existingAgent,
    name: body.name ?? existingAgent.name,
    description: body.description ?? existingAgent.description,
    modelId: (body.modelId ?? existingAgent.modelId) as ModelId,
    
    // 3-Level Prompt System - Allow updating all three
    systemPrompt: body.systemPrompt ?? existingAgent.systemPrompt,
    negativePrompt: body.negativePrompt ?? existingAgent.negativePrompt,
    userPrompt: body.userPrompt ?? existingAgent.userPrompt,
    
    // Model configuration
    temperature: typeof body.temperature === 'number' 
      ? Math.min(1, Math.max(0, body.temperature)) 
      : existingAgent.temperature,
    maxTokens: typeof body.maxTokens === 'number' && selectedModel
      ? Math.min(selectedModel.maxTokens, Math.max(1, body.maxTokens))
      : existingAgent.maxTokens,
    topP: typeof body.topP === 'number' 
      ? Math.min(1, Math.max(0, body.topP)) 
      : existingAgent.topP,
    
    // Agent metadata
    isActive: typeof body.isActive === 'boolean' ? body.isActive : existingAgent.isActive,
    isPublic: typeof body.isPublic === 'boolean' ? body.isPublic : existingAgent.isPublic,
    
    // Audit fields
    updatedAt: timestamp,
    updatedBy,
    
    // Optional fields
    tags: Array.isArray(body.tags) ? body.tags : existingAgent.tags,
  };

  await docClient.send(new PutCommand({
    TableName: AGENTS_TABLE,
    Item: updatedAgent,
  }));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Agent updated successfully',
      agent: updatedAgent,
      model: selectedModel,
    }),
  };
}

/**
 * Delete an AI agent
 */
async function deleteAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  // First, get the existing agent
  const getResponse = await docClient.send(new GetCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  }));

  const existingAgent = getResponse.Item as AiAgent | undefined;
  if (!existingAgent) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Agent not found' }),
    };
  }

  // Check permission to delete
  const canDelete = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'delete',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    existingAgent.clinicId
  );

  if (!canDelete) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have permission to delete this agent' }),
    };
  }

  await docClient.send(new DeleteCommand({
    TableName: AGENTS_TABLE,
    Key: { agentId },
  }));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Agent deleted successfully',
      agentId,
    }),
  };
}

/**
 * Get execution history for an agent
 */
async function getAgentExecutions(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  // First verify the user has access to this agent
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

  // Query executions for this agent
  const limit = parseInt(event.queryStringParameters?.limit || '50');
  
  const command = new QueryCommand({
    TableName: EXECUTIONS_TABLE,
    IndexName: 'AgentExecutionIndex',
    KeyConditionExpression: 'agentId = :aid',
    ExpressionAttributeValues: {
      ':aid': agentId,
    },
    ScanIndexForward: false, // Descending order (newest first)
    Limit: Math.min(limit, 100),
  });

  const response = await docClient.send(command);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      executions: response.Items || [],
      agentId,
      agentName: agent.name,
    }),
  };
}


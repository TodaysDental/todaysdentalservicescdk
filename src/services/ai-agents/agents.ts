import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentClient,
  CreateAgentCommand,
  UpdateAgentCommand,
  DeleteAgentCommand,
  GetAgentCommand,
  PrepareAgentCommand,
  CreateAgentActionGroupCommand,
  UpdateAgentActionGroupCommand,
  ListAgentActionGroupsCommand,
  GetAgentActionGroupCommand,
  CreateAgentAliasCommand,
  UpdateAgentAliasCommand,
  GetAgentAliasCommand,
  ListAgentAliasesCommand,
  AgentStatus,
} from '@aws-sdk/client-bedrock-agent';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import {
  // Channel-specific prompts
  VOICE_SYSTEM_PROMPT,
  VOICE_NEGATIVE_PROMPT,
  CHAT_SYSTEM_PROMPT,
  CHAT_NEGATIVE_PROMPT,
  // Legacy aliases (for backward compatibility)
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  buildSystemPromptWithDate,
  getDateContext,
} from '../../shared/prompts/ai-prompts';

// Re-export prompts for backward compatibility
export {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  buildSystemPromptWithDate,
  // Also export channel-specific prompts
  VOICE_SYSTEM_PROMPT,
  VOICE_NEGATIVE_PROMPT,
  CHAT_SYSTEM_PROMPT,
  CHAT_NEGATIVE_PROMPT,
};

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgentClient = new BedrockAgentClient({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || 'us-east-1',
});

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const BEDROCK_AGENT_ROLE_ARN = process.env.BEDROCK_AGENT_ROLE_ARN || '';
const ACTION_GROUP_LAMBDA_ARN = process.env.ACTION_GROUP_LAMBDA_ARN || '';

const AI_AGENTS_MODULE = 'IT';
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

// ========================================================================
// MODELS
// ========================================================================

/**
 * Available foundation models for Bedrock Agents
 * 
 * Note: IAM permissions in ai-agents-stack.ts grant access to all foundation models
 * via wildcard. This list controls which models are exposed in the UI.
 */
export const AVAILABLE_MODELS = [
  // ========================================
  // ðŸ§  ANTHROPIC CLAUDE FAMILY
  // ========================================
  {
    id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    description: 'Latest Claude - powerful text generation, reasoning, and summarization',
    recommended: true,
  },
  {
    id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    description: 'Strong performer for general-purpose tasks',
    recommended: false,
  },
  {
    id: 'us.anthropic.claude-opus-4-20250514-v1:0',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
    description: 'Complex problem solving and deep reasoning',
    recommended: false,
  },
  {
    id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    description: 'Optimized for broad use with strong capabilities (cross-region)',
    recommended: false,
  },
  {
    id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    name: 'Claude 3.5 Sonnet v2',
    provider: 'Anthropic',
    description: 'Best balance of intelligence and speed (cross-region inference)',
    recommended: false,
  },
  {
    id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    name: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    description: 'Fast and efficient for simple tasks (cross-region inference)',
    recommended: true,
  },
  {
    id: 'anthropic.claude-3-sonnet-20240229-v1:0',
    name: 'Claude 3 Sonnet',
    provider: 'Anthropic',
    description: 'Previous generation - stable and reliable',
    recommended: false,
  },
  {
    id: 'anthropic.claude-3-haiku-20240307-v1:0',
    name: 'Claude 3 Haiku',
    provider: 'Anthropic',
    description: 'Fast and affordable for high-volume tasks',
    recommended: false,
  },
  // ========================================
  // ðŸ˜ AMAZON NOVA SERIES
  // ========================================
  {
    id: 'amazon.nova-micro-v1:0',
    name: 'Amazon Nova Micro',
    provider: 'Amazon',
    description: 'Ultra low-latency, cost-efficient text model',
    recommended: false,
  },
  {
    id: 'amazon.nova-lite-v1:0',
    name: 'Amazon Nova Lite',
    provider: 'Amazon',
    description: 'Low-cost multimodal (text/image/video)',
    recommended: false,
  },
  {
    id: 'amazon.nova-pro-v1:0',
    name: 'Amazon Nova Pro',
    provider: 'Amazon',
    description: 'Balanced high-capability multimodal model',
    recommended: false,
  },
  // ========================================
  //  META LLAMA FAMILY
  // ========================================
  {
    id: 'meta.llama3-3-70b-instruct-v1:0',
    name: 'Llama 3.3 70B Instruct',
    provider: 'Meta',
    description: 'Performance-tuned for instruction following',
    recommended: false,
  },
  {
    id: 'meta.llama3-2-90b-instruct-v1:0',
    name: 'Llama 3.2 90B Instruct',
    provider: 'Meta',
    description: 'Large multimodal variant with vision',
    recommended: false,
  },
  {
    id: 'meta.llama3-1-70b-instruct-v1:0',
    name: 'Llama 3.1 70B Instruct',
    provider: 'Meta',
    description: '128K context, strong instruction following',
    recommended: false,
  },
  {
    id: 'meta.llama3-1-8b-instruct-v1:0',
    name: 'Llama 3.1 8B Instruct',
    provider: 'Meta',
    description: 'Fast and efficient for simple tasks',
    recommended: false,
  },
  {
    id: 'meta.llama3-70b-instruct-v1:0',
    name: 'Llama 3 70B Instruct',
    provider: 'Meta',
    description: 'High-performance open LLM',
    recommended: false,
  },
  {
    id: 'meta.llama3-8b-instruct-v1:0',
    name: 'Llama 3 8B Instruct',
    provider: 'Meta',
    description: 'Compact and efficient',
    recommended: false,
  },
  // ========================================
  //  COHERE COMMAND MODELS
  // ========================================
  {
    id: 'cohere.command-r-v1:0',
    name: 'Cohere Command R',
    provider: 'Cohere',
    description: 'Enterprise text generation with RAG abilities',
    recommended: false,
  },
  {
    id: 'cohere.command-r-plus-v1:0',
    name: 'Cohere Command R+',
    provider: 'Cohere',
    description: 'Enhanced enterprise model with 128K context',
    recommended: false,
  },
  // ========================================
  // DEEPSEEK MODELS
  // ========================================
  {
    id: 'deepseek.deepseek-r1-v1:0',
    name: 'DeepSeek-R1',
    provider: 'DeepSeek',
    description: 'Open reasoning model with strong performance',
    recommended: false,
  },
  // ========================================
  // MISTRAL AI MODELS
  // ========================================
  {
    id: 'mistral.mistral-large-2407-v1:0',
    name: 'Mistral Large',
    provider: 'Mistral AI',
    description: 'Powerful multilingual model with long context',
    recommended: false,
  },
  {
    id: 'mistral.mistral-small-2402-v1:0',
    name: 'Mistral Small',
    provider: 'Mistral AI',
    description: 'Efficient and fast for general tasks',
    recommended: false,
  },
  {
    id: 'mistral.mixtral-8x7b-instruct-v0:1',
    name: 'Mixtral 8x7B',
    provider: 'Mistral AI',
    description: 'Mixture-of-experts architecture, cost-effective',
    recommended: false,
  },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id'];

// Default model choice for voice agents (optimize for low latency).
// NOTE: This can be overridden by explicitly passing modelId in the create/update request.
// PERFORMANCE: Use Claude 3.5 Haiku with cross-region inference profile for best latency/quality.
// The 'us.' prefix enables system-defined inference profiles (required for Claude 3.5 models).
// Alternative: 'amazon.nova-micro-v1:0' for ultra-low latency (but less capable).
const DEFAULT_VOICE_MODEL_ID: ModelId = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

/**
 * Normalize model IDs to use cross-region inference profiles where required.
 *
 * AWS Bedrock requires the 'us.' prefix for newer third-party models (Anthropic Claude 3.5+,
 * Meta Llama, Cohere, Mistral, DeepSeek). Without the prefix, Bedrock returns a 403
 * "Access denied when calling Bedrock" because the direct model ID is not available”
 * only the cross-region inference profile is.
 *
 * This function ensures the correct prefix is always used, regardless of how the model ID
 * was originally stored (e.g., from older agent configurations).
 */
export function normalizeModelId(modelId: string): string {
  // If it already has a region prefix (e.g., 'us.anthropic...'), it's fine
  if (modelId.startsWith('us.') || modelId.startsWith('eu.') || modelId.startsWith('ap.')) {
    return modelId;
  }

  // Amazon models don't need the prefix they're native to Bedrock
  if (modelId.startsWith('amazon.')) {
    return modelId;
  }

  // AI21 models â€” older ones don't need prefix, but newer ones might
  // For safety, only prefix known providers that require it
  const PROVIDERS_NEEDING_PREFIX = [
    'anthropic.',
    'meta.',
    'cohere.',
    'mistral.',
    'deepseek.',
  ];

  for (const provider of PROVIDERS_NEEDING_PREFIX) {
    if (modelId.startsWith(provider)) {
      console.log(`[normalizeModelId] Adding 'us.' prefix to model ID: ${modelId} â†’ us.${modelId}`);
      return `us.${modelId}`;
    }
  }

  // Unknown provider â€” return as-is
  return modelId;
}

// ========================================================================
// TYPES
// ========================================================================

export interface AiAgent {
  agentId: string; // Our internal ID (stored in DynamoDB)
  name: string;
  description: string;
  modelId: ModelId;

  // 3-Level Prompt System
  systemPrompt: string; // Level 1: Constant system prompt (ToothFairy)
  negativePrompt: string; // Level 2: Constant restrictions
  userPrompt: string; // Level 3: Customizable from frontend

  // Bedrock Agent IDs
  bedrockAgentId?: string; // The Bedrock Agent ID
  bedrockAgentAliasId?: string; // The alias ID for invocation
  bedrockAgentVersion?: string; // Agent version
  bedrockAgentStatus?: string; // CREATING | PREPARING | PREPARED | NOT_PREPARED | FAILED

  // Agent metadata
  clinicId: string;
  isActive: boolean;
  isPublic: boolean; // Shared across clinics (for internal users)

  // Website chatbot settings
  isWebsiteEnabled: boolean; // Enable public website chatbot

  // Voice AI settings
  isVoiceEnabled: boolean; // Enable voice/phone AI
  isDefaultVoiceAgent: boolean; // Default agent for after-hours inbound calls

  // Audit fields
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  tags?: string[];
  usageCount?: number;
}

// ========================================================================
// OPENAPI SCHEMA FOR ACTION GROUP (CALLBACK-BASED TOOLS)
// ========================================================================

/**
 * OpenAPI Schema for Bedrock Agent Action Groups
 *
 * Defines the callback-based tools available to the AI dental assistant.
 * All appointment/scheduling requests create Callback records in DynamoDB
 * for clinic staff to review and action in their dental management system.
 *
 * Tools:
 *   - requestAppointment   : Book / schedule a new appointment
 *   - rescheduleAppointment: Request to change an existing appointment time
 *   - cancelAppointment    : Request to cancel an appointment
 *   - getClinicInfo        : Return clinic hours, address, phone, services
 *   - requestCallback      : Generic callback / message for clinic staff
 */
const OPENAPI_SCHEMA = {
  openapi: '3.0.0',
  info: {
    title: 'Dental Assistant Tools API',
    version: '1.0.0',
    description: 'Callback-based tools for the AI dental assistant. All requests create callback records for clinic staff to action.',
  },
  paths: {
    // â”€â”€ Appointment Booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    '/requestAppointment': {
      post: {
        operationId: 'requestAppointment',
        summary: 'Request a new appointment',
        description:
          'Collect patient name, phone, reason, and preferred date/time, then call this tool to create a callback record. ' +
          'Clinic staff will follow up to confirm the appointment in the dental management system.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  patientName: { type: 'string', description: 'Full name of the patient.' },
                  patientPhone: { type: 'string', description: 'Phone number to reach the patient.' },
                  reason: { type: 'string', description: 'Reason for the appointment (e.g. "cleaning", "toothache", "crown").' },
                  preferredDate: { type: 'string', description: 'Preferred date (YYYY-MM-DD or natural language like "next Tuesday").' },
                  preferredTime: { type: 'string', description: 'Preferred time (e.g. "morning", "2:00 PM").' },
                  notes: { type: 'string', description: 'Any additional notes or special requests.' },
                },
                required: ['patientName', 'patientPhone', 'reason'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Appointment request created successfully.' },
        },
      },
    },

    // â”€â”€ Reschedule Appointment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    '/rescheduleAppointment': {
      post: {
        operationId: 'rescheduleAppointment',
        summary: 'Request to reschedule an existing appointment',
        description:
          'Collect patient name, phone, and new preferred date/time. ' +
          'Creates a callback record so clinic staff can update the appointment.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  patientName: { type: 'string', description: 'Full name of the patient.' },
                  patientPhone: { type: 'string', description: 'Phone number to reach the patient.' },
                  currentAppointmentDate: { type: 'string', description: 'Date of the existing appointment to reschedule.' },
                  newPreferredDate: { type: 'string', description: 'New preferred date.' },
                  newPreferredTime: { type: 'string', description: 'New preferred time.' },
                  reason: { type: 'string', description: 'Reason for rescheduling.' },
                  notes: { type: 'string', description: 'Any additional notes.' },
                },
                required: ['patientName', 'patientPhone'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Reschedule request created successfully.' },
        },
      },
    },

    // â”€â”€ Cancel Appointment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    '/cancelAppointment': {
      post: {
        operationId: 'cancelAppointment',
        summary: 'Request to cancel an existing appointment',
        description:
          'Collect patient name, phone, and appointment details. ' +
          'Creates a callback record so clinic staff can cancel the appointment.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  patientName: { type: 'string', description: 'Full name of the patient.' },
                  patientPhone: { type: 'string', description: 'Phone number to reach the patient.' },
                  appointmentDate: { type: 'string', description: 'Date of the appointment to cancel.' },
                  reason: { type: 'string', description: 'Reason for cancellation.' },
                  notes: { type: 'string', description: 'Any additional notes.' },
                },
                required: ['patientName', 'patientPhone'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Cancellation request created successfully.' },
        },
      },
    },

    // â”€â”€ Get Clinic Info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    '/getClinicInfo': {
      post: {
        operationId: 'getClinicInfo',
        summary: 'Get clinic information',
        description:
          'Returns clinic details: address, phone, email, website, hours, services, and directions. ' +
          'No patient identification required. Use for questions about location, contact info, or general clinic information.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  clinicId: { type: 'string', description: 'Clinic ID (auto-filled from session if omitted).' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Clinic information returned successfully.' },
        },
      },
    },

    // â”€â”€ Generic Callback Request â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    '/requestCallback': {
      post: {
        operationId: 'requestCallback',
        summary: 'Request a callback from clinic staff',
        description:
          'For any request that is not an appointment booking, rescheduling, or cancellation. ' +
          'Examples: insurance inquiries, billing questions, medical records, referrals, general questions. ' +
          'Collect patient name and phone, then create a callback record for staff.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  patientName: { type: 'string', description: 'Full name of the patient or caller.' },
                  patientPhone: { type: 'string', description: 'Phone number for the callback.' },
                  reason: { type: 'string', description: 'Reason for the callback (e.g. "insurance inquiry", "billing question").' },
                  notes: { type: 'string', description: 'Details about the request.' },
                  urgency: { type: 'string', enum: ['low', 'normal', 'high', 'emergency'], description: 'Urgency level. Default: normal.' },
                },
                required: ['patientName', 'patientPhone', 'reason'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Callback request created successfully.' },
        },
      },
    },
  },
};

export default OPENAPI_SCHEMA;

// ========================================================================
// HANDLER
// ========================================================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  let path = event.path || event.resource || '';

  // Normalize path
  if (path.startsWith('/ai-agents/ai-agents')) {
    path = path.replace('/ai-agents/ai-agents', '/ai-agents');
  }

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'CORS preflight' }) };
  }

  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const agentId = event.pathParameters?.agentId;

    // GET /models
    if ((path === '/models' || path.endsWith('/models')) && httpMethod === 'GET') {
      return listModels(event);
    }

    // POST /agents/{agentId}/prepare
    if (agentId && path.endsWith('/prepare') && httpMethod === 'POST') {
      return await prepareAgent(event, userPerms, agentId);
    }

    // GET /agents
    if ((path === '/agents' || path.endsWith('/agents')) && httpMethod === 'GET') {
      return await listAgents(event, userPerms);
    }

    // POST /agents
    if ((path === '/agents' || path.endsWith('/agents')) && httpMethod === 'POST') {
      return await createAgent(event, userPerms);
    }

    // GET /agents/{agentId}
    if (agentId && httpMethod === 'GET' && !path.includes('/prepare')) {
      return await getAgent(event, userPerms, agentId);
    }

    // PUT /agents/{agentId}
    if (agentId && httpMethod === 'PUT') {
      return await updateAgent(event, userPerms, agentId);
    }

    // DELETE /agents/{agentId}
    if (agentId && httpMethod === 'DELETE') {
      return await deleteAgent(event, userPerms, agentId);
    }

    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  } catch (error: any) {
    console.error('Handler error:', error);
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: error.message }) };
  }
};

// ========================================================================
// ROUTE HANDLERS
// ========================================================================

function listModels(event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      models: AVAILABLE_MODELS,
      defaultModel: AVAILABLE_MODELS.find((m) => m.recommended)?.id,
    }),
  };
}

async function listAgents(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const clinicId = event.queryStringParameters?.clinicId;
  const includePublic = event.queryStringParameters?.includePublic !== 'false';

  let command: ScanCommand | QueryCommand;
  if (clinicId) {
    command = new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :cid',
      ExpressionAttributeValues: { ':cid': clinicId },
    });
  } else {
    command = new ScanCommand({ TableName: AGENTS_TABLE });
  }

  const response = await docClient.send(command);
  let agents = (response.Items || []) as AiAgent[];

  const userClinicIds = userPerms.clinicRoles.map((cr) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin) {
    agents = agents.filter((agent) => userClinicIds.includes(agent.clinicId) || (includePublic && agent.isPublic));
  }

  agents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      agents,
      totalCount: agents.length,
      // Legacy prompts (backward compatibility)
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
      // Channel-specific prompts for voice and chat
      voiceSystemPrompt: VOICE_SYSTEM_PROMPT,
      voiceNegativePrompt: VOICE_NEGATIVE_PROMPT,
      chatSystemPrompt: CHAT_SYSTEM_PROMPT,
      chatNegativePrompt: CHAT_NEGATIVE_PROMPT,
    }),
  };
}

async function getAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  const response = await docClient.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item as AiAgent | undefined;

  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent not found' }) };
  }

  // Sync status from Bedrock
  if (agent.bedrockAgentId) {
    try {
      const bedrockAgent = await bedrockAgentClient.send(new GetAgentCommand({ agentId: agent.bedrockAgentId }));
      if (bedrockAgent.agent?.agentStatus && bedrockAgent.agent.agentStatus !== agent.bedrockAgentStatus) {
        agent.bedrockAgentStatus = bedrockAgent.agent.agentStatus;
        await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: agent }));
      }
    } catch (e) {
      console.error('Failed to sync Bedrock status:', e);
    }
  }

  const userClinicIds = userPerms.clinicRoles.map((cr) => cr.clinicId);
  const isAdmin = userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin;

  if (!isAdmin && !userClinicIds.includes(agent.clinicId) && !agent.isPublic) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Access denied' }) };
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({ agent, model: AVAILABLE_MODELS.find((m) => m.id === agent.modelId) }),
  };
}

async function createAgent(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');

  if (!body.name) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent name is required' }) };
  }
  if (!body.clinicId) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Clinic ID is required' }) };
  }

  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinicId
  );
  if (!canCreate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  // Voice calls have a strict real-time budget (e.g., Amazon Connect ~8s hard limit on InvokeLambdaFunction),
  // so default voice-enabled agents to a fast model unless explicitly overridden.
  const defaultModelId = body.isVoiceEnabled === true
    ? DEFAULT_VOICE_MODEL_ID
    : (AVAILABLE_MODELS.find((m) => m.recommended)?.id || AVAILABLE_MODELS[0].id);

  const modelId = body.modelId || defaultModelId;
  const selectedModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!selectedModel) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Invalid model ID' }) };
  }

  const timestamp = new Date().toISOString();
  const createdBy = getUserDisplayName(userPerms);
  const internalAgentId = uuidv4();

  // Determine channel type based on agent configuration
  // Voice-enabled agents get VOICE prompts optimized for phone calls
  // All other agents (website chat, etc.) get CHAT prompts optimized for text
  const isVoiceAgent = body.isVoiceEnabled === true;
  const defaultSystem = isVoiceAgent ? VOICE_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
  const defaultNegative = isVoiceAgent ? VOICE_NEGATIVE_PROMPT : CHAT_NEGATIVE_PROMPT;

  // Build instruction from 3-level prompt system
  const systemPrompt = body.systemPrompt || defaultSystem;
  const negativePrompt = body.negativePrompt || defaultNegative;
  const userPrompt = body.userPrompt || '';

  const fullInstruction = [
    '=== CORE INSTRUCTIONS ===',
    systemPrompt,
    '',
    '=== RESTRICTIONS ===',
    negativePrompt,
    userPrompt ? '\n=== ADDITIONAL INSTRUCTIONS ===\n' + userPrompt : '',
  ].join('\n');

  // Create Bedrock Agent
  let bedrockAgentId: string | undefined;
  let bedrockAgentStatus: string = 'CREATING';
  let actionGroupCreated = false;
  let actionGroupError: string | undefined;

  try {
    const createResponse = await bedrockAgentClient.send(
      new CreateAgentCommand({
        agentName: `${body.name.replace(/[^a-zA-Z0-9-_]/g, '-')}-${internalAgentId.slice(0, 8)}`,
        agentResourceRoleArn: BEDROCK_AGENT_ROLE_ARN,
        foundationModel: normalizeModelId(modelId),
        instruction: fullInstruction,
        description: body.description || `AI Agent: ${body.name}`,
        idleSessionTTLInSeconds: 1800,
      })
    );

    bedrockAgentId = createResponse.agent?.agentId;
    bedrockAgentStatus = createResponse.agent?.agentStatus || 'CREATING';

    // Create Action Group (separate try-catch to track action group errors specifically)
    if (bedrockAgentId) {
      try {
        await bedrockAgentClient.send(
          new CreateAgentActionGroupCommand({
            agentId: bedrockAgentId,
            agentVersion: 'DRAFT',
            actionGroupName: 'DentalAssistantTools',
            description: 'Callback-based tools for patient and appointment management',
            actionGroupExecutor: {
              lambda: ACTION_GROUP_LAMBDA_ARN,
            },
            apiSchema: {
              payload: JSON.stringify(OPENAPI_SCHEMA),
            },
          })
        );
        actionGroupCreated = true;
        console.log(`[createAgent] Action group created successfully for agent ${bedrockAgentId}`);
      } catch (agError: any) {
        console.error('Failed to create Action Group:', agError);
        actionGroupError = agError.message;
        // Don't fail the whole agent creation - it can be fixed via /prepare
      }
    }
  } catch (error: any) {
    console.error('Failed to create Bedrock Agent:', error);
    bedrockAgentStatus = 'FAILED';
  }

  // FIX: When setting isDefaultVoiceAgent=true, clear it from other agents in the same clinic
  if (body.isDefaultVoiceAgent === true) {
    try {
      const existingDefaultsResponse = await docClient.send(new QueryCommand({
        TableName: AGENTS_TABLE,
        IndexName: 'ClinicIndex',
        KeyConditionExpression: 'clinicId = :cid',
        FilterExpression: 'isDefaultVoiceAgent = :true',
        ExpressionAttributeValues: {
          ':cid': body.clinicId,
          ':true': true,
        },
      }));

      if (existingDefaultsResponse.Items && existingDefaultsResponse.Items.length > 0) {
        for (const existingDefault of existingDefaultsResponse.Items) {
          console.log(`[createAgent] Clearing isDefaultVoiceAgent from ${existingDefault.agentId}`);
          const updatedAgent = { ...existingDefault, isDefaultVoiceAgent: false, updatedAt: timestamp, updatedBy: createdBy };
          await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: updatedAgent }));
        }
      }
    } catch (error) {
      console.error('[createAgent] Failed to clear existing default voice agents:', error);
      // Continue with the creation - don't fail the whole operation
    }
  }

  const agent: AiAgent = {
    agentId: internalAgentId,
    name: body.name,
    description: body.description || '',
    modelId: modelId as ModelId,
    systemPrompt,
    negativePrompt,
    userPrompt,
    bedrockAgentId,
    bedrockAgentStatus,
    clinicId: body.clinicId,
    isActive: bedrockAgentStatus !== 'FAILED',
    isPublic: body.isPublic === true,
    // Website chatbot settings
    isWebsiteEnabled: body.isWebsiteEnabled === true,
    // Voice AI settings
    isVoiceEnabled: body.isVoiceEnabled === true,
    isDefaultVoiceAgent: body.isDefaultVoiceAgent === true,

    createdAt: timestamp,
    createdBy,
    updatedAt: timestamp,
    updatedBy: createdBy,
    tags: Array.isArray(body.tags) ? body.tags : [],
    usageCount: 0,
  };

  await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: agent }));

  // Build response message based on status
  let message = 'Agent created. Call /prepare to make it ready for invocation.';
  if (bedrockAgentStatus === 'FAILED') {
    message = 'Agent created but Bedrock Agent creation failed';
  } else if (!actionGroupCreated) {
    message = 'Agent created but Action Group (function tools) failed. Call /prepare to retry.';
  }

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message,
      agent,
      nextStep: bedrockAgentStatus !== 'FAILED' ? 'POST /agents/{agentId}/prepare' : undefined,
      actionGroup: {
        created: actionGroupCreated,
        error: actionGroupError,
        lambdaArn: ACTION_GROUP_LAMBDA_ARN,
      },
    }),
  };
}

async function prepareAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  const response = await docClient.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item as AiAgent | undefined;

  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent not found' }) };
  }

  if (!agent.bedrockAgentId) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'No Bedrock Agent associated' }) };
  }

  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'put',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    agent.clinicId
  );
  if (!canUpdate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  try {
    // ========================================
    // FIX: Check and create/update Action Group before preparing
    // This ensures the action group exists and has the correct Lambda ARN
    // ========================================
    let actionGroupStatus = 'unknown';
    try {
      // List existing action groups
      const actionGroupsResponse = await bedrockAgentClient.send(
        new ListAgentActionGroupsCommand({
          agentId: agent.bedrockAgentId,
          agentVersion: 'DRAFT',
        })
      );

      const existingActionGroup = actionGroupsResponse.actionGroupSummaries?.find(
        (ag) => ag.actionGroupName === 'DentalAssistantTools' || ag.actionGroupName === 'OpenDentalTools'
      );

      if (existingActionGroup) {
        // Action group exists - ALWAYS update to ensure schema and Lambda ARN are current
        // This is important because the OpenAPI schema may have changed in the code
        console.log(`[prepareAgent] Updating action group to ensure schema and Lambda ARN are current`);

        await bedrockAgentClient.send(
          new UpdateAgentActionGroupCommand({
            agentId: agent.bedrockAgentId,
            agentVersion: 'DRAFT',
            actionGroupId: existingActionGroup.actionGroupId!,
            actionGroupName: 'DentalAssistantTools',
            description: 'Callback-based tools for patient and appointment management',
            actionGroupExecutor: {
              lambda: ACTION_GROUP_LAMBDA_ARN,
            },
            apiSchema: {
              payload: JSON.stringify(OPENAPI_SCHEMA),
            },
          })
        );
        actionGroupStatus = 'updated';
      } else {
        // Action group doesn't exist - create it
        console.log(`[prepareAgent] Creating missing action group for agent ${agent.bedrockAgentId}`);

        await bedrockAgentClient.send(
          new CreateAgentActionGroupCommand({
            agentId: agent.bedrockAgentId,
            agentVersion: 'DRAFT',
            actionGroupName: 'DentalAssistantTools',
            description: 'Callback-based tools for patient and appointment management',
            actionGroupExecutor: {
              lambda: ACTION_GROUP_LAMBDA_ARN,
            },
            apiSchema: {
              payload: JSON.stringify(OPENAPI_SCHEMA),
            },
          })
        );
        actionGroupStatus = 'created';
      }

      console.log(`[prepareAgent] Action group status: ${actionGroupStatus}`);
    } catch (actionGroupError: any) {
      console.error('[prepareAgent] Failed to check/create action group:', actionGroupError);
      // Return error - action group is critical for tools to work
      return {
        statusCode: 500,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: 'Failed to configure action group (function tools)',
          details: actionGroupError.message,
          actionGroupLambdaArn: ACTION_GROUP_LAMBDA_ARN,
          hint: 'Check that the ACTION_GROUP_LAMBDA_ARN environment variable is correct',
        }),
      };
    }

    // Normalize model ID if needed
    const normalizedModelId = normalizeModelId(agent.modelId);
    if (normalizedModelId !== agent.modelId) {
      console.log(`[prepareAgent] Fixing model ID: ${agent.modelId} -> ${normalizedModelId}`);
      agent.modelId = normalizedModelId as ModelId;
    }

    // ALWAYS update the agent instruction with the latest prompts from code.
    // This ensures re-preparing picks up any prompt changes without
    // needing to delete and recreate the agent.
    const isVoiceAgent = agent.isVoiceEnabled === true;
    const latestSystemPrompt = isVoiceAgent ? VOICE_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
    const latestNegativePrompt = isVoiceAgent ? VOICE_NEGATIVE_PROMPT : CHAT_NEGATIVE_PROMPT;

    // Sync DynamoDB record with latest prompts
    agent.systemPrompt = latestSystemPrompt;
    agent.negativePrompt = latestNegativePrompt;

    const fullInstruction = [
      '=== CORE INSTRUCTIONS ===',
      latestSystemPrompt,
      '',
      '=== RESTRICTIONS ===',
      latestNegativePrompt,
      agent.userPrompt ? '\n=== ADDITIONAL INSTRUCTIONS ===\n' + agent.userPrompt : '',
    ].join('\n');

    try {
      await bedrockAgentClient.send(
        new UpdateAgentCommand({
          agentId: agent.bedrockAgentId,
          agentName: `${agent.name.replace(/[^a-zA-Z0-9-_]/g, '-')}-${agent.agentId.slice(0, 8)}`,
          agentResourceRoleArn: BEDROCK_AGENT_ROLE_ARN,
          foundationModel: normalizedModelId,
          instruction: fullInstruction,
          description: agent.description,
          idleSessionTTLInSeconds: 1800,
        })
      );
      console.log(`[prepareAgent] Updated agent instruction and model (${normalizedModelId})`);
    } catch (updateError: any) {
      console.error('[prepareAgent] Failed to update agent:', updateError);
    }

    // Prepare the agent
    const prepareResponse = await bedrockAgentClient.send(
      new PrepareAgentCommand({ agentId: agent.bedrockAgentId })
    );

    agent.bedrockAgentStatus = prepareResponse.agentStatus || 'PREPARING';
    agent.bedrockAgentVersion = prepareResponse.agentVersion;

    // FIX: Reduce polling to stay within Lambda timeout (60s)
    // Poll for up to 20 seconds (5 iterations x 4 seconds)
    // This leaves ~30 seconds for alias creation and response
    let prepared = false;
    let failureReasons: string[] = [];
    let recommendedActions: string[] = [];
    const MAX_POLL_ITERATIONS = 5;
    const POLL_INTERVAL_MS = 4000;

    for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const getResponse = await bedrockAgentClient.send(new GetAgentCommand({ agentId: agent.bedrockAgentId }));
      agent.bedrockAgentStatus = getResponse.agent?.agentStatus;

      if (agent.bedrockAgentStatus === AgentStatus.PREPARED) {
        prepared = true;
        break;
      } else if (agent.bedrockAgentStatus === AgentStatus.FAILED) {
        // Capture failure reasons from Bedrock
        failureReasons = getResponse.agent?.failureReasons || [];
        recommendedActions = getResponse.agent?.recommendedActions || [];
        console.error('[prepareAgent] Agent preparation failed:', {
          failureReasons,
          recommendedActions,
          agentId: agent.bedrockAgentId,
        });
        break;
      }
    }

    // If still preparing after polling, save state and return async response
    if (!prepared && agent.bedrockAgentStatus === 'PREPARING') {
      agent.updatedAt = new Date().toISOString();
      agent.updatedBy = getUserDisplayName(userPerms);
      await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: agent }));

      return {
        statusCode: 202, // Accepted - still processing
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          message: 'Agent is still preparing. Poll GET /agents/{agentId} to check status.',
          agent,
          isReady: false,
          checkAgain: true,
          actionGroup: {
            status: actionGroupStatus,
            lambdaArn: ACTION_GROUP_LAMBDA_ARN,
          },
        }),
      };
    }

    // If agent failed, return detailed error info
    if (agent.bedrockAgentStatus === AgentStatus.FAILED) {
      agent.isActive = false;
      agent.updatedAt = new Date().toISOString();
      agent.updatedBy = getUserDisplayName(userPerms);
      await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: agent }));

      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: 'Agent preparation failed',
          message: 'Bedrock Agent failed to prepare. Check the failure reasons below.',
          agent,
          isReady: false,
          failureReasons: failureReasons.length > 0 ? failureReasons : ['Unknown - check AWS Console for details'],
          recommendedActions: recommendedActions.length > 0 ? recommendedActions : [
            'Check the Bedrock Agent in AWS Console for detailed error messages',
            'Ensure the agent instruction is valid and not too long',
            'Verify the model is available in your region',
          ],
          actionGroup: {
            status: actionGroupStatus,
            lambdaArn: ACTION_GROUP_LAMBDA_ARN,
          },
        }),
      };
    }

    // Create or update alias for invocation — must point to the latest prepared version
    if (prepared) {
      try {
        const aliasesResponse = await bedrockAgentClient.send(
          new ListAgentAliasesCommand({ agentId: agent.bedrockAgentId })
        );
        const liveAlias = aliasesResponse.agentAliasSummaries?.find((a) => a.agentAliasName === 'live');

        if (liveAlias) {
          // CRITICAL: Update the alias to route to the latest prepared version.
          // Without this, the alias keeps pointing to the old version and
          // the updated action group schema / Lambda code is never used.
          console.log(`[prepareAgent] Updating live alias to point to latest version`);
          await bedrockAgentClient.send(
            new UpdateAgentAliasCommand({
              agentId: agent.bedrockAgentId,
              agentAliasId: liveAlias.agentAliasId!,
              agentAliasName: 'live',
              description: 'Live alias for agent invocation',
            })
          );
          agent.bedrockAgentAliasId = liveAlias.agentAliasId;
        } else {
          const createAliasResponse = await bedrockAgentClient.send(
            new CreateAgentAliasCommand({
              agentId: agent.bedrockAgentId,
              agentAliasName: 'live',
              description: 'Live alias for agent invocation',
            })
          );
          agent.bedrockAgentAliasId = createAliasResponse.agentAlias?.agentAliasId;
        }
      } catch (aliasError) {
        console.error('Failed to create/update alias:', aliasError);
      }
    }

    agent.updatedAt = new Date().toISOString();
    agent.updatedBy = getUserDisplayName(userPerms);
    agent.isActive = agent.bedrockAgentStatus === AgentStatus.PREPARED;

    await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: agent }));

    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        message: prepared ? 'Agent prepared and ready for invocation!' : `Agent status: ${agent.bedrockAgentStatus}`,
        agent,
        isReady: prepared && !!agent.bedrockAgentAliasId,
        actionGroup: {
          status: actionGroupStatus,
          lambdaArn: ACTION_GROUP_LAMBDA_ARN,
        },
      }),
    };
  } catch (error: any) {
    console.error('Prepare agent error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message || 'Failed to prepare agent' }),
    };
  }
}

async function updateAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  const response = await docClient.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item as AiAgent | undefined;

  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent not found' }) };
  }

  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'put',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    agent.clinicId
  );
  if (!canUpdate) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  const body = JSON.parse(event.body || '{}');
  const timestamp = new Date().toISOString();
  const updatedBy = getUserDisplayName(userPerms);

  // Update local fields
  agent.name = body.name ?? agent.name;
  agent.description = body.description ?? agent.description;
  agent.systemPrompt = body.systemPrompt ?? agent.systemPrompt;
  agent.negativePrompt = body.negativePrompt ?? agent.negativePrompt;
  agent.userPrompt = body.userPrompt ?? agent.userPrompt;
  if (body.modelId && body.modelId !== agent.modelId) {
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === body.modelId);
    if (!selectedModel) {
      return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Invalid model ID' }) };
    }
    agent.modelId = body.modelId as ModelId;
  }
  agent.isPublic = typeof body.isPublic === 'boolean' ? body.isPublic : agent.isPublic;
  agent.tags = Array.isArray(body.tags) ? body.tags : agent.tags;

  // Website chatbot settings
  if (typeof body.isWebsiteEnabled === 'boolean') {
    agent.isWebsiteEnabled = body.isWebsiteEnabled;
  }
  // Voice AI settings
  if (typeof body.isVoiceEnabled === 'boolean') {
    agent.isVoiceEnabled = body.isVoiceEnabled;
  }

  // FIX: When setting isDefaultVoiceAgent=true, clear it from other agents in the same clinic
  // This ensures only one agent is the default voice agent per clinic
  if (body.isDefaultVoiceAgent === true && !agent.isDefaultVoiceAgent) {
    // Clear isDefaultVoiceAgent from other agents in the same clinic
    try {
      const existingDefaultsResponse = await docClient.send(new QueryCommand({
        TableName: AGENTS_TABLE,
        IndexName: 'ClinicIndex',
        KeyConditionExpression: 'clinicId = :cid',
        FilterExpression: 'isDefaultVoiceAgent = :true AND agentId <> :currentAgentId',
        ExpressionAttributeValues: {
          ':cid': agent.clinicId,
          ':true': true,
          ':currentAgentId': agentId,
        },
      }));

      if (existingDefaultsResponse.Items && existingDefaultsResponse.Items.length > 0) {
        // Clear isDefaultVoiceAgent from each existing default
        for (const existingDefault of existingDefaultsResponse.Items) {
          console.log(`[updateAgent] Clearing isDefaultVoiceAgent from ${existingDefault.agentId}`);
          const updatedAgent = { ...existingDefault, isDefaultVoiceAgent: false, updatedAt: timestamp, updatedBy };
          await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: updatedAgent }));
        }
      }
    } catch (error) {
      console.error('[updateAgent] Failed to clear existing default voice agents:', error);
      // Continue with the update - don't fail the whole operation
    }
  }

  if (typeof body.isDefaultVoiceAgent === 'boolean') {
    agent.isDefaultVoiceAgent = body.isDefaultVoiceAgent;
  }

  agent.updatedAt = timestamp;
  agent.updatedBy = updatedBy;

  // Update Bedrock Agent if exists
  let bedrockUpdateError: string | undefined;

  if (agent.bedrockAgentId) {
    try {
      const fullInstruction = [
        '=== CORE INSTRUCTIONS ===',
        agent.systemPrompt,
        '',
        '=== RESTRICTIONS ===',
        agent.negativePrompt,
        agent.userPrompt ? '\n=== ADDITIONAL INSTRUCTIONS ===\n' + agent.userPrompt : '',
      ].join('\n');

      await bedrockAgentClient.send(
        new UpdateAgentCommand({
          agentId: agent.bedrockAgentId,
          agentName: `${agent.name.replace(/[^a-zA-Z0-9-_]/g, '-')}-${agent.agentId.slice(0, 8)}`,
          agentResourceRoleArn: BEDROCK_AGENT_ROLE_ARN,
          foundationModel: normalizeModelId(agent.modelId),
          instruction: fullInstruction,
          description: agent.description,
          idleSessionTTLInSeconds: 1800,
        })
      );

      agent.bedrockAgentStatus = 'NOT_PREPARED';
    } catch (error: any) {
      console.error('Failed to update Bedrock Agent:', error);
      // FIX: Capture error instead of silently continuing
      bedrockUpdateError = error.message || 'Unknown Bedrock error';
      // FIX: Use a valid status instead of custom 'SYNC_ERROR'
      // Keep the original status but mark as needing attention via the response
      // The agent may still work with its previous configuration
      // Don't change bedrockAgentStatus to avoid breaking status checks
    }
  }

  await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: agent }));

  // FIX: Return different status codes and messages based on Bedrock sync result
  if (bedrockUpdateError) {
    return {
      statusCode: 207, // Multi-Status - partial success
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        message: 'Agent saved locally but Bedrock sync failed',
        warning: `Bedrock update failed: ${bedrockUpdateError}. The agent may be out of sync.`,
        agent,
        bedrockSyncFailed: true,
        // FIX: Provide clear next steps for the user
        nextSteps: [
          'The local agent configuration has been saved',
          'Bedrock Agent update failed - the agent is running with its previous configuration',
          'Try calling /prepare to re-sync the agent with Bedrock',
          'If the problem persists, check the agent in AWS Console',
        ],
      }),
    };
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: agent.bedrockAgentStatus === 'NOT_PREPARED'
        ? 'Agent updated. Call /prepare to apply changes.'
        : 'Agent updated.',
      agent,
      needsPrepare: agent.bedrockAgentStatus === 'NOT_PREPARED',
    }),
  };
}

async function deleteAgent(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  agentId: string
): Promise<APIGatewayProxyResult> {
  const response = await docClient.send(new GetCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));
  const agent = response.Item as AiAgent | undefined;

  if (!agent) {
    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Agent not found' }) };
  }

  const canDelete = hasModulePermission(
    userPerms.clinicRoles,
    AI_AGENTS_MODULE,
    'delete',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    agent.clinicId
  );
  if (!canDelete) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Permission denied' }) };
  }

  const bedrockAgentId = agent.bedrockAgentId;

  // FIX: Delete DynamoDB record FIRST
  // If DynamoDB deletion fails, Bedrock agent remains (can retry)
  // If Bedrock deletion fails after DynamoDB delete, that's acceptable (orphaned Bedrock agent)
  // But we avoid orphaned DynamoDB records pointing to deleted Bedrock agents
  await docClient.send(new DeleteCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));

  // Then delete Bedrock Agent if it exists
  let bedrockDeleteError: string | undefined;
  if (bedrockAgentId) {
    try {
      await bedrockAgentClient.send(
        new DeleteAgentCommand({
          agentId: bedrockAgentId,
          skipResourceInUseCheck: true,
        })
      );
    } catch (error: any) {
      console.error('Failed to delete Bedrock Agent:', error);
      bedrockDeleteError = error.message;
      // Don't throw - DynamoDB record is already deleted, log for manual cleanup
    }
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Agent deleted successfully',
      agentId,
      bedrockAgentDeleted: !bedrockDeleteError,
      bedrockCleanupWarning: bedrockDeleteError
        ? `Bedrock agent may need manual cleanup: ${bedrockDeleteError}`
        : undefined,
    }),
  };
}

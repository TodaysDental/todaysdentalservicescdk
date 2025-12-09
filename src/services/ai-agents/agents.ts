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
  CreateAgentAliasCommand,
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
 */
export const AVAILABLE_MODELS = [
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    name: 'Claude 3.5 Sonnet v2',
    provider: 'Anthropic',
    description: 'Latest Claude 3.5 Sonnet - Best balance of intelligence and speed',
    recommended: true,
  },
  {
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    name: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    description: 'Fast and efficient for simple tasks',
    recommended: false,
  },
  {
    id: 'anthropic.claude-3-sonnet-20240229-v1:0',
    name: 'Claude 3 Sonnet',
    provider: 'Anthropic',
    description: 'Previous generation Claude - stable and reliable',
    recommended: false,
  },
  {
    id: 'anthropic.claude-3-haiku-20240307-v1:0',
    name: 'Claude 3 Haiku',
    provider: 'Anthropic',
    description: 'Fast and affordable for high-volume tasks',
    recommended: false,
  },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id'];

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
// PROMPTS
// ========================================================================

/**
 * Default system prompt for the Bedrock Agent instruction
 */
export const DEFAULT_SYSTEM_PROMPT = `You are ToothFairy, a AI dental assistant. Manage appointment booking, cancellation, rescheduling, and details using API tools. Follow these principles:

**Principles**:
1. **State Management**:
   - If 'PatNum' is present in session attributes, use it and do not ask for name or birthdate again.
   - If 'AppointmentType' is present, prompt for the appointment date and time unless provided.
   - If 'ProcedureDescripts' is present, confirm with the user if they want to book an appointment for these procedures, then prompt for date and time.

2. **Efficient Communication**: Perform tasks (e.g., patient lookup, procedure log checks) without intermediate prompts unless needed.

3. **Continuous Flow**: After any successful tool call, ALWAYS continue the conversation. Never stop after a single tool call.

4. **Patient Identification**:
   - NEVER use hardcoded PatNum values.
   - ONLY call appointment-related functions if 'PatNum' exists in session attributes.
   - If no PatNum, collect First Name, Last Name, and Date of Birth (YYYY-MM-DD) first.
   - If 'searchPatients' returns FAILURE, offer to create a new patient profile.
   - If multiple patients found, list them numbered for selection.
   - After patient found, call 'getProcedureLogs' for treatment-planned procedures.

5. **Procedure Log Handling**:
   - After successful patient lookup, call 'getProcedureLogs' for ProcStatus: "TP".
   - Summarize unique 'descript' fields and ask if user wants to book for these.

6. **Appointment Scheduling**:
   - Check for treatment-planned procedures first.
   - Prompt for date and time in 'YYYY-MM-DD HH:mm:ss' format.
   - For new patients: use 'OpName: ONLINE_BOOKING_EXAM'.
   - For existing patients: use appropriate operatory based on procedure type.

7. **Error Handling**: Respond clearly with helpful guidance on failures.

8. **Date Format**: Use 'YYYY-MM-DD HH:mm:ss'. Validate dates are today or later.

9. **Reschedule**: Use 'getUpcomingAppointments' first, then 'rescheduleAppointment'.

10. **Cancel**: Use 'getUpcomingAppointments' first, confirm, then 'cancelAppointment'.

**Account Information**: Use getAccountAging, getPatientBalances, getServiceDateView for account queries.

**Insurance Information**: Use getBenefits, getCarriers, getClaims, getFamilyInsurance for insurance queries.

**DO NOT CHECK FOR AVAILABILITY. BOOK THE APPOINTMENT FOR THE ASKED DATE AND TIME.**

**DO NOT MENTION THE PROVIDER NAME IN THE RESPONSE.**`;

/**
 * Default negative prompt (restrictions)
 */
export const DEFAULT_NEGATIVE_PROMPT = `=== CRITICAL RESTRICTIONS ===

**Patient Privacy & HIPAA**:
- NEVER share patient information across sessions
- NEVER discuss one patient's info with another
- NEVER provide PHI to unauthorized parties

**Medical Boundaries**:
- NEVER provide diagnoses
- NEVER recommend treatment without dentist authorization
- NEVER prescribe medications
- NEVER guarantee treatment outcomes

**Financial & Legal**:
- NEVER guarantee exact prices
- NEVER promise insurance coverage amounts
- NEVER provide legal advice

**Communication**:
- NEVER use offensive language
- NEVER discuss unrelated topics
- NEVER make up information
- NEVER use technical API terminology in responses

**Data Integrity**:
- NEVER use fabricated PatNum values
- NEVER create fake records
- NEVER modify data without authorization

When in doubt, direct the patient to contact the clinic directly.`;

// ========================================================================
// OPENAPI SCHEMA FOR ACTION GROUP
// ========================================================================

const OPENAPI_SCHEMA = {
  openapi: '3.0.0',
  info: {
    title: 'OpenDental Tools API',
    version: '1.0.0',
    description: 'API for OpenDental operations used by Bedrock Agent',
  },
  paths: {
    '/searchPatients': {
      post: {
        operationId: 'searchPatients',
        description: 'Searches for patients by name and birthdate',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  LName: { type: 'string', description: 'Last name' },
                  FName: { type: 'string', description: 'First name' },
                  Birthdate: { type: 'string', description: 'YYYY-MM-DD format' },
                },
                required: ['LName', 'FName', 'Birthdate'],
              },
            },
          },
        },
        responses: { '200': { description: 'Search results' } },
      },
    },
    '/createPatient': {
      post: {
        operationId: 'createPatient',
        description: 'Creates a new patient record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  LName: { type: 'string' },
                  FName: { type: 'string' },
                  WirelessPhone: { type: 'string' },
                  Birthdate: { type: 'string' },
                },
                required: ['LName', 'FName', 'Birthdate'],
              },
            },
          },
        },
        responses: { '201': { description: 'Patient created' } },
      },
    },
    '/getPatientByPatNum': {
      get: {
        operationId: 'getPatientByPatNum',
        description: 'Retrieves a patient by PatNum',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Patient data' } },
      },
    },
    '/getProcedureLogs': {
      get: {
        operationId: 'getProcedureLogs',
        description: 'Gets procedure logs for a patient',
        parameters: [
          { name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'ProcStatus', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Procedure logs' } },
      },
    },
    '/getTreatmentPlans': {
      get: {
        operationId: 'getTreatmentPlans',
        description: 'Gets treatment plans for a patient',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Treatment plans' } },
      },
    },
    '/scheduleAppointment': {
      post: {
        operationId: 'scheduleAppointment',
        description: 'Schedules an appointment',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  PatNum: { type: 'integer' },
                  Reason: { type: 'string' },
                  Date: { type: 'string', description: 'YYYY-MM-DD HH:mm:ss format' },
                  OpName: { type: 'string' },
                  Note: { type: 'string' },
                },
                required: ['PatNum', 'Reason', 'Date', 'OpName'],
              },
            },
          },
        },
        responses: { '201': { description: 'Appointment created' } },
      },
    },
    '/getUpcomingAppointments': {
      get: {
        operationId: 'getUpcomingAppointments',
        description: 'Gets upcoming appointments for a patient',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Upcoming appointments' } },
      },
    },
    '/rescheduleAppointment': {
      post: {
        operationId: 'rescheduleAppointment',
        description: 'Reschedules an appointment',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  AptNum: { type: 'integer' },
                  NewDateTime: { type: 'string' },
                  Note: { type: 'string' },
                },
                required: ['AptNum', 'NewDateTime'],
              },
            },
          },
        },
        responses: { '200': { description: 'Appointment rescheduled' } },
      },
    },
    '/cancelAppointment': {
      post: {
        operationId: 'cancelAppointment',
        description: 'Cancels an appointment',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  AptNum: { type: 'integer' },
                  SendToUnscheduledList: { type: 'boolean' },
                  Note: { type: 'string' },
                },
                required: ['AptNum'],
              },
            },
          },
        },
        responses: { '200': { description: 'Appointment cancelled' } },
      },
    },
    '/getAppointment': {
      get: {
        operationId: 'getAppointment',
        description: 'Gets a single appointment by AptNum',
        parameters: [{ name: 'AptNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Appointment data' } },
      },
    },
    '/getAppointments': {
      get: {
        operationId: 'getAppointments',
        description: 'Gets appointments with optional filtering',
        parameters: [
          { name: 'PatNum', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'AptStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dateStart', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dateEnd', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Appointments list' } },
      },
    },
    '/getAccountAging': {
      get: {
        operationId: 'getAccountAging',
        description: 'Gets account aging for a patient',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Account aging data' } },
      },
    },
    '/getPatientBalances': {
      get: {
        operationId: 'getPatientBalances',
        description: 'Gets patient balances',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Patient balances' } },
      },
    },
    '/getServiceDateView': {
      get: {
        operationId: 'getServiceDateView',
        description: 'Gets service date view for a patient',
        parameters: [
          { name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'isFamily', in: 'query', required: false, schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: 'Service date view' } },
      },
    },
    '/getAllergies': {
      get: {
        operationId: 'getAllergies',
        description: 'Gets allergies for a patient',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Allergies list' } },
      },
    },
    '/getProgNotes': {
      get: {
        operationId: 'getProgNotes',
        description: 'Gets progress notes for a patient',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Progress notes' } },
      },
    },
    '/getPatientInfo': {
      get: {
        operationId: 'getPatientInfo',
        description: 'Gets comprehensive patient info',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Patient info' } },
      },
    },
    '/getPlannedAppts': {
      get: {
        operationId: 'getPlannedAppts',
        description: 'Gets planned appointments for a patient',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Planned appointments' } },
      },
    },
    '/getBenefits': {
      get: {
        operationId: 'getBenefits',
        description: 'Gets insurance benefits',
        parameters: [
          { name: 'PlanNum', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'PatPlanNum', in: 'query', required: false, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Benefits data' } },
      },
    },
    '/getCarriers': {
      get: {
        operationId: 'getCarriers',
        description: 'Gets insurance carriers',
        responses: { '200': { description: 'Carriers list' } },
      },
    },
    '/getClaims': {
      get: {
        operationId: 'getClaims',
        description: 'Gets insurance claims',
        parameters: [
          { name: 'PatNum', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'ClaimStatus', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Claims list' } },
      },
    },
    '/getFamilyInsurance': {
      get: {
        operationId: 'getFamilyInsurance',
        description: 'Gets family insurance info',
        parameters: [{ name: 'PatNum', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Family insurance data' } },
      },
    },
  },
};

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
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
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

  const modelId = body.modelId || AVAILABLE_MODELS.find((m) => m.recommended)?.id || AVAILABLE_MODELS[0].id;
  const selectedModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!selectedModel) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Invalid model ID' }) };
  }

  const timestamp = new Date().toISOString();
  const createdBy = getUserDisplayName(userPerms);
  const internalAgentId = uuidv4();

  // Build instruction from 3-level prompt system
  const systemPrompt = body.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const negativePrompt = body.negativePrompt || DEFAULT_NEGATIVE_PROMPT;
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

  try {
    const createResponse = await bedrockAgentClient.send(
      new CreateAgentCommand({
        agentName: `${body.name.replace(/[^a-zA-Z0-9-_]/g, '-')}-${internalAgentId.slice(0, 8)}`,
        agentResourceRoleArn: BEDROCK_AGENT_ROLE_ARN,
        foundationModel: modelId,
        instruction: fullInstruction,
        description: body.description || `AI Agent: ${body.name}`,
        idleSessionTTLInSeconds: 1800,
      })
    );

    bedrockAgentId = createResponse.agent?.agentId;
    bedrockAgentStatus = createResponse.agent?.agentStatus || 'CREATING';

    // Create Action Group
    if (bedrockAgentId) {
      await bedrockAgentClient.send(
        new CreateAgentActionGroupCommand({
          agentId: bedrockAgentId,
          agentVersion: 'DRAFT',
          actionGroupName: 'OpenDentalTools',
          description: 'OpenDental API tools for patient and appointment management',
          actionGroupExecutor: {
            lambda: ACTION_GROUP_LAMBDA_ARN,
          },
          apiSchema: {
            payload: JSON.stringify(OPENAPI_SCHEMA),
          },
        })
      );
    }
  } catch (error: any) {
    console.error('Failed to create Bedrock Agent:', error);
    bedrockAgentStatus = 'FAILED';
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

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message:
        bedrockAgentStatus === 'FAILED'
          ? 'Agent created but Bedrock Agent creation failed'
          : 'Agent created. Call /prepare to make it ready for invocation.',
      agent,
      nextStep: bedrockAgentStatus !== 'FAILED' ? 'POST /agents/{agentId}/prepare' : undefined,
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
    // Prepare the agent
    const prepareResponse = await bedrockAgentClient.send(
      new PrepareAgentCommand({ agentId: agent.bedrockAgentId })
    );

    agent.bedrockAgentStatus = prepareResponse.agentStatus || 'PREPARING';
    agent.bedrockAgentVersion = prepareResponse.agentVersion;

    // Wait for agent to be prepared (poll for up to 30 seconds)
    let prepared = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const getResponse = await bedrockAgentClient.send(new GetAgentCommand({ agentId: agent.bedrockAgentId }));
      agent.bedrockAgentStatus = getResponse.agent?.agentStatus;

      if (agent.bedrockAgentStatus === AgentStatus.PREPARED) {
        prepared = true;
        break;
      } else if (agent.bedrockAgentStatus === AgentStatus.FAILED) {
        break;
      }
    }

    // Create or get alias for invocation
    if (prepared) {
      try {
        const aliasesResponse = await bedrockAgentClient.send(
          new ListAgentAliasesCommand({ agentId: agent.bedrockAgentId })
        );
        const liveAlias = aliasesResponse.agentAliasSummaries?.find((a) => a.agentAliasName === 'live');

        if (liveAlias) {
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
        console.error('Failed to create alias:', aliasError);
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
  if (typeof body.isDefaultVoiceAgent === 'boolean') {
    agent.isDefaultVoiceAgent = body.isDefaultVoiceAgent;
  }
  
  agent.updatedAt = timestamp;
  agent.updatedBy = updatedBy;

  // Update Bedrock Agent if exists
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
          foundationModel: agent.modelId,
          instruction: fullInstruction,
          description: agent.description,
          idleSessionTTLInSeconds: 1800,
        })
      );

      agent.bedrockAgentStatus = 'NOT_PREPARED';
    } catch (error: any) {
      console.error('Failed to update Bedrock Agent:', error);
    }
  }

  await docClient.send(new PutCommand({ TableName: AGENTS_TABLE, Item: agent }));

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

  // Delete Bedrock Agent if exists
  if (agent.bedrockAgentId) {
    try {
      await bedrockAgentClient.send(
        new DeleteAgentCommand({
          agentId: agent.bedrockAgentId,
          skipResourceInUseCheck: true,
        })
      );
    } catch (error: any) {
      console.error('Failed to delete Bedrock Agent:', error);
    }
  }

  await docClient.send(new DeleteCommand({ TableName: AGENTS_TABLE, Key: { agentId } }));

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({ message: 'Agent deleted successfully', agentId }),
  };
}

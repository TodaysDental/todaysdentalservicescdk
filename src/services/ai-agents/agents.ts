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
 * Get current date info for system prompt
 * Returns today's date and day name for accurate date calculations
 */
function getDateContext(): { today: string; dayName: string; tomorrowDate: string; nextWeekDates: Record<string, string> } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  
  // Calculate tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  
  // Calculate next 7 days for day name reference
  const nextWeekDates: Record<string, string> = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (let i = 0; i < 7; i++) {
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + i);
    const futureDayName = dayNames[futureDate.getDay()];
    nextWeekDates[futureDayName] = futureDate.toISOString().slice(0, 10);
  }
  
  return { today, dayName, tomorrowDate, nextWeekDates };
}

/**
 * Default system prompt for the Bedrock Agent instruction
 * NOTE: This is a template - actual prompt should include current date info
 */
export const DEFAULT_SYSTEM_PROMPT = `You are ToothFairy, a AI dental assistant. Manage appointment booking, cancellation, rescheduling, and details using API tools. Follow these principles:

**Principles**:
1. **State Management**:
   - If 'PatNum' is present in session attributes, use it and do not ask for name or birthdate again.
   - If 'AppointmentType' is present, prompt for the appointment date and time unless provided.
   - If 'ProcedureDescripts' is present, confirm with the user if they want to book an appointment for these procedures, then prompt for date and time.

2. **Efficient Communication**: Perform tasks (e.g., patient lookup, procedure log checks) without intermediate prompts unless needed. Do not use systematic prompts like "let me check in our system" - this is a strict rule.

3. **Continuous Flow**: After any successful tool call, ALWAYS continue the conversation. Never stop after a single tool call - proceed to the next logical step.

4. **Patient Identification** (ONLY for patient-specific operations like appointments, account, claims):
   - NEVER use hardcoded PatNum values like 12345 or any other arbitrary numbers.
   - ONLY call appointment-related functions if 'PatNum' exists in session attributes.
   - Collect First Name, Last Name, and Date of Birth ONLY when needed for: appointments, account info, claims, or patient-specific benefits.
   - **DO NOT collect patient info for insurance coverage questions** - use suggestInsuranceCoverage instead.
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

8. **Date Format & Calculation - CRITICAL**:
   - Use 'YYYY-MM-DD HH:mm:ss' for scheduling. Validate dates are today or later.
   - Do NOT ask user for a particular format. Accept any format they provide.
   - **CRITICAL DATE CALCULATION**: When user says day names, you MUST calculate the correct date:
     * "today" = the current date provided in session
     * "tomorrow" = current date + 1 day
     * "Friday" = find the next Friday from current date (could be today if today is Friday)
     * "next Monday" = find the Monday of next week
     * "this Saturday" = the Saturday of the current week
   - **VALIDATION REQUIRED**: Always double-check your date calculation before calling scheduleAppointment.
   - Example: If today is Thursday Dec 19, 2024:
     * "Friday" = 2024-12-20 (tomorrow)
     * "Monday" = 2024-12-23 (next Monday)
     * "Saturday" = 2024-12-21 (this Saturday)
   - NEVER schedule appointments in the past. If user asks for a past date, inform them and ask for a future date.

9. **Reschedule**: Use 'getUpcomingAppointments' first, then 'rescheduleAppointment'.

10. **Cancel**: Use 'getUpcomingAppointments' first, confirm, then 'cancelAppointment'.

**Account Information**: Use getAccountAging, getPatientBalances, getServiceDateView for account queries.

**Insurance Information - IMPORTANT**:
When a patient asks about insurance coverage, benefits, or what their insurance covers:
1. **NEVER ask for patient name or date of birth for insurance coverage questions.**
2. **IMMEDIATELY use suggestInsuranceCoverage or getInsurancePlanBenefits** with the insurance name they provide.
3. These tools search the clinic's database directly by insurance name - NO PatNum needed!

Examples - when user asks about insurance, call suggestInsuranceCoverage with {"insuranceName": "NAME"}:
- "Does Cigna cover crowns?" → Call: suggestInsuranceCoverage({"insuranceName": "Cigna"})
- "What does Delta Dental cover?" → Call: suggestInsuranceCoverage({"insuranceName": "Delta Dental"})
- "husky medicaid" or "what benefits does husky give" → Call: suggestInsuranceCoverage({"insuranceName": "Husky"})
- "I have Aetna, am I covered for fillings?" → Call: suggestInsuranceCoverage({"insuranceName": "Aetna"})
- "What's my coverage with BCBS?" → Call: suggestInsuranceCoverage({"insuranceName": "BCBS"})
- "United Healthcare benefits" → Call: suggestInsuranceCoverage({"insuranceName": "United Healthcare"})

Patient-specific insurance tools (ONLY use when patient is already identified with PatNum):
- getBenefits, getFamilyInsurance - Use only when patient is identified and you need their specific benefit usage
- getClaims - Use only when patient needs their claims history
- getCarriers - List of carriers (rarely needed)

**If the patient asks for anytime sooner or earliest available appointment, book the appointment for the next day at 8:00 AM for the requested appointment type.**

**DO NOT CHECK FOR AVAILABILITY. BOOK THE APPOINTMENT FOR THE ASKED DATE AND TIME.**

**DO NOT MENTION THE PROVIDER NAME IN THE RESPONSE.**`;

/**
 * Build system prompt with current date context
 * This should be called when creating/updating agents to include accurate date info
 */
export function buildSystemPromptWithDate(basePrompt?: string): string {
  const dateContext = getDateContext();
  const prompt = basePrompt || DEFAULT_SYSTEM_PROMPT;
  
  const dateSection = `
**CURRENT DATE CONTEXT**:
- Today is ${dateContext.dayName}, ${dateContext.today}
- Tomorrow is ${dateContext.tomorrowDate}
- Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}
- All appointments must be scheduled on or after ${dateContext.today}
`;
  
  return prompt + '\n' + dateSection;
}

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
// OPENAPI SCHEMA FOR ACTION GROUP (PROXY PATTERN)
// ========================================================================

/**
 * OpenAPI Schema for Bedrock Agent Action Groups
 * 
 * PROXY PATTERN: Uses a single endpoint to avoid the 11 API limit per action group.
 * The agent learns about available tools from the detailed description and enum.
 * 
 * This approach:
 * 1. Reduces API count from 15+ to just 1
 * 2. Avoids "Number of enabled APIs exceeded limit" error
 * 3. Still provides full tool documentation for the agent
 */
const OPENAPI_SCHEMA = {
  openapi: '3.0.0',
  info: {
    title: 'OpenDental Tools API',
    version: '2.0.0',
    description: 'Unified proxy API for OpenDental operations used by Bedrock Agent',
  },
  paths: {
    '/open-dental/{toolName}': {
      post: {
        operationId: 'executeOpenDentalTool',
        summary: 'Execute an OpenDental tool',
        description: `Execute any OpenDental tool by specifying the tool name and parameters.

=== PATIENT TOOLS ===
• searchPatients - Search for patients by name and birthdate
  Required: LName, FName, Birthdate (YYYY-MM-DD)
  
• createPatient - Create a new patient record
  Required: LName, FName, Birthdate
  Optional: WirelessPhone
  
• getPatientByPatNum - Get patient details by ID
  Required: PatNum

=== PROCEDURE TOOLS ===
• getProcedureLogs - Get procedure logs for a patient
  Required: PatNum
  Optional: ProcStatus (use "TP" for treatment-planned)
  
• getTreatmentPlans - Get active treatment plans
  Required: PatNum

=== APPOINTMENT TOOLS ===
• scheduleAppointment - Schedule a new appointment
  Required: PatNum, Reason, Date (YYYY-MM-DD HH:mm:ss), OpName
  Optional: Note
  OpName values: ONLINE_BOOKING_EXAM (new patients), ONLINE_BOOKING_MINOR, ONLINE_BOOKING_MAJOR
  
• getUpcomingAppointments - Get future appointments
  Required: PatNum
  
• rescheduleAppointment - Change appointment date/time
  Required: AptNum, NewDateTime (YYYY-MM-DD HH:mm:ss)
  Optional: Note
  
• cancelAppointment - Cancel an appointment
  Required: AptNum
  Optional: SendToUnscheduledList, Note

=== ACCOUNT TOOLS ===
• getAccountAging - Get outstanding balance aging
  Required: PatNum
  
• getPatientBalances - Get current account balances
  Required: PatNum
  
• getServiceDateView - Get services by date
  Required: PatNum
  Optional: isFamily

=== MEDICAL TOOLS ===
• getAllergies - Get patient allergies
  Required: PatNum
  
• getPatientInfo - Get comprehensive patient info
  Required: PatNum

=== INSURANCE TOOLS (Patient-Specific - requires PatNum) ===
• getBenefits - Get patient's specific insurance benefits usage
  Optional: PlanNum, PatPlanNum (at least one required)
  NOTE: Only use after patient is identified!
  
• getCarriers - Get insurance carriers list
  No parameters required
  
• getClaims - Get patient's insurance claims history
  Optional: PatNum, ClaimStatus
  NOTE: Only use after patient is identified!
  
• getFamilyInsurance - Get family insurance info
  Required: PatNum
  NOTE: Only use after patient is identified!

=== INSURANCE COVERAGE LOOKUP (USE THESE FIRST - NO PatNum Required!) ===
**IMPORTANT**: When patient asks about insurance coverage, USE THESE TOOLS FIRST!
Do NOT ask for patient name or DOB - just use the insurance name they provide.

• suggestInsuranceCoverage - Get formatted coverage suggestions with smart recommendations
  **CALL THIS TOOL with just the insuranceName parameter!**
  Example: User asks "what does Husky cover?" → Call with: {"insuranceName": "Husky"}
  Example: User asks "Cigna benefits?" → Call with: {"insuranceName": "Cigna"}
  NO PatNum needed! Just pass insuranceName.
  Optional: groupName, groupNumber (if patient provides them)
  Returns: Human-readable summary with recommendations
  
• getInsurancePlanBenefits - Look up raw insurance plan coverage details
  Call with: {"insuranceName": "Delta Dental"} or {"groupNumber": "12345"}
  NO PatNum needed! 
  Returns: Annual max, deductibles, coverage percentages, waiting periods, frequency limits`,
        parameters: [
          {
            name: 'toolName',
            in: 'path',
            required: true,
            description: 'The OpenDental tool to execute',
            schema: {
              type: 'string',
              enum: [
                'searchPatients',
                'createPatient',
                'getPatientByPatNum',
                'getProcedureLogs',
                'getTreatmentPlans',
                'scheduleAppointment',
                'getUpcomingAppointments',
                'rescheduleAppointment',
                'cancelAppointment',
                'getAccountAging',
                'getPatientBalances',
                'getServiceDateView',
                'getAllergies',
                'getPatientInfo',
                'getBenefits',
                'getCarriers',
                'getClaims',
                'getFamilyInsurance',
                'getInsurancePlanBenefits',
                'suggestInsuranceCoverage',
              ],
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: `Parameters for the tool. Required fields depend on the toolName selected.

INSURANCE LOOKUP EXAMPLES (no PatNum needed):
- suggestInsuranceCoverage: {"insuranceName": "Husky"}
- suggestInsuranceCoverage: {"insuranceName": "Cigna"}
- getInsurancePlanBenefits: {"insuranceName": "Delta Dental"}

PATIENT LOOKUP EXAMPLE:
- searchPatients: {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}`,
                properties: {
                  // Patient identifiers
                  PatNum: {
                    type: 'integer',
                    description: 'Patient number (unique ID). Required for most tools after patient lookup.',
                  },
                  LName: {
                    type: 'string',
                    description: 'Patient last name. Required for searchPatients and createPatient.',
                  },
                  FName: {
                    type: 'string',
                    description: 'Patient first name. Required for searchPatients and createPatient.',
                  },
                  Birthdate: {
                    type: 'string',
                    description: 'Patient date of birth in YYYY-MM-DD format. Required for searchPatients and createPatient.',
                  },
                  WirelessPhone: {
                    type: 'string',
                    description: 'Patient mobile phone number. Optional for createPatient.',
                  },
                  // Procedure parameters
                  ProcStatus: {
                    type: 'string',
                    description: 'Procedure status filter. Use "TP" for treatment-planned, "C" for complete.',
                  },
                  // Appointment parameters
                  AptNum: {
                    type: 'integer',
                    description: 'Appointment number (unique ID). Required for reschedule/cancel.',
                  },
                  Date: {
                    type: 'string',
                    description: 'Appointment date and time in YYYY-MM-DD HH:mm:ss format. Required for scheduleAppointment.',
                  },
                  NewDateTime: {
                    type: 'string',
                    description: 'New date and time in YYYY-MM-DD HH:mm:ss format. Required for rescheduleAppointment.',
                  },
                  Reason: {
                    type: 'string',
                    description: 'Reason for the appointment. Required for scheduleAppointment.',
                  },
                  OpName: {
                    type: 'string',
                    description: 'Operatory name. Use ONLINE_BOOKING_EXAM for new patients, ONLINE_BOOKING_MINOR or ONLINE_BOOKING_MAJOR for existing.',
                  },
                  Note: {
                    type: 'string',
                    description: 'Additional notes for the appointment or action.',
                  },
                  SendToUnscheduledList: {
                    type: 'boolean',
                    description: 'Whether to add cancelled appointment to unscheduled list. Default true.',
                  },
                  // Account parameters
                  isFamily: {
                    type: 'boolean',
                    description: 'Include family members in account view. For getServiceDateView.',
                  },
                  // Insurance parameters
                  PlanNum: {
                    type: 'integer',
                    description: 'Insurance plan number. For getBenefits.',
                  },
                  PatPlanNum: {
                    type: 'integer',
                    description: 'Patient plan number. For getBenefits.',
                  },
                  ClaimStatus: {
                    type: 'string',
                    description: 'Claim status filter. For getClaims.',
                  },
                  // Insurance Plan Benefits lookup parameters (NO PatNum required!)
                  insuranceName: {
                    type: 'string',
                    description: 'Insurance carrier name to search for. Examples: "Husky", "Delta Dental", "Cigna", "Aetna", "BCBS", "United Healthcare", "Metlife". REQUIRED for getInsurancePlanBenefits and suggestInsuranceCoverage. NO PatNum needed - just provide the insurance name.',
                  },
                  groupName: {
                    type: 'string',
                    description: 'Insurance group name (employer group). For getInsurancePlanBenefits/suggestInsuranceCoverage. NO PatNum needed.',
                  },
                  groupNumber: {
                    type: 'string',
                    description: 'Insurance group number from the insurance card. For getInsurancePlanBenefits/suggestInsuranceCoverage. NO PatNum needed.',
                  },
                  clinicId: {
                    type: 'string',
                    description: 'Clinic ID (auto-filled from session). For getInsurancePlanBenefits/suggestInsuranceCoverage.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful tool execution',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['SUCCESS', 'FAILURE'],
                      description: 'Result status of the tool execution',
                    },
                    data: {
                      type: 'object',
                      description: 'The returned data from the tool',
                    },
                    message: {
                      type: 'string',
                      description: 'Human-readable message about the result',
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid request - missing required parameters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Resource not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
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
  let actionGroupCreated = false;
  let actionGroupError: string | undefined;

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

    // Create Action Group (separate try-catch to track action group errors specifically)
    if (bedrockAgentId) {
      try {
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
        (ag) => ag.actionGroupName === 'OpenDentalTools'
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
        actionGroupStatus = 'updated';
      } else {
        // Action group doesn't exist - create it
        console.log(`[prepareAgent] Creating missing action group for agent ${agent.bedrockAgentId}`);
        
        await bedrockAgentClient.send(
          new CreateAgentActionGroupCommand({
            agentId: agent.bedrockAgentId,
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
          foundationModel: agent.modelId,
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

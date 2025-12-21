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
2. **IMMEDIATELY use suggestInsuranceCoverage or getInsurancePlanBenefits** with the information they provide.
3. These tools search the clinic's database directly - NO PatNum needed!
4. **COMBINE all available information** - if user provides both insurance name AND group number, include BOTH in the search!

**INSURANCE SEARCH FLOW**:
- If user provides INSURANCE NAME only → Call with {"insuranceName": "NAME"}
- If user provides GROUP NUMBER only → Ask for insurance carrier name to narrow results
- If user provides BOTH insurance name AND group number → Call with BOTH: {"insuranceName": "NAME", "groupNumber": "NUMBER"}
- If first search fails, ask for additional details (carrier name, group number from card)

**WHEN MULTIPLE PLANS ARE FOUND**:
- If suggestInsuranceCoverage returns multiple plans (e.g., 5 different Metlife plans with different employers), LIST them for the user to choose
- When user selects a specific plan by number or name (e.g., "3" or "RFS TECHNOLOGIES INC."), call suggestInsuranceCoverage AGAIN with BOTH insuranceName AND groupName
- Example: User says "3. Metlife - RFS TECHNOLOGIES INC." → Call: suggestInsuranceCoverage({"insuranceName": "Metlife", "groupName": "RFS TECHNOLOGIES INC."})

**CRITICAL**: 
- When user provides group number first and then carrier name later, REMEMBER the group number and include BOTH in the next search!
- When user selects from a list of plans, include BOTH insuranceName AND groupName (the employer/group name shown in the list)!

Examples - when user asks about insurance:
- "Does Cigna cover crowns?" → Call: suggestInsuranceCoverage({"insuranceName": "Cigna"})
- "What does Delta Dental cover?" → Call: suggestInsuranceCoverage({"insuranceName": "Delta Dental"})
- "my group number is 212391" → Ask for insurance carrier name
- "it's Metlife" (after user gave group 212391) → Call: suggestInsuranceCoverage({"insuranceName": "Metlife", "groupNumber": "212391"})
- "I have Aetna group 12345" → Call: suggestInsuranceCoverage({"insuranceName": "Aetna", "groupNumber": "12345"})
- "Husky medicaid" → Call: suggestInsuranceCoverage({"insuranceName": "Husky"})
- "What's my coverage with BCBS?" → Call: suggestInsuranceCoverage({"insuranceName": "BCBS"})

Examples - when user selects from a list of plans:
- User selects "3. Metlife - RFS TECHNOLOGIES INC." → Call: suggestInsuranceCoverage({"insuranceName": "Metlife", "groupName": "RFS TECHNOLOGIES INC."})
- User says "number 2" (from a list showing Delta Dental - ACME CORP) → Call: suggestInsuranceCoverage({"insuranceName": "Delta Dental", "groupName": "ACME CORP"})

**INTERPRETING INSURANCE LOOKUP RESULTS - VERY IMPORTANT**:
- **ALWAYS USE THE directAnswer FIELD FROM THE TOOL RESPONSE** - it contains the ACTUAL coverage data from this clinic's database!
- **NEVER make up or guess coverage percentages** - only quote the EXACT numbers from directAnswer!
- **NEVER say "typically" or "usually" when discussing coverage** - use the SPECIFIC percentages from the data!

When tool returns SUCCESS:
- Quote the EXACT coverage percentages from directAnswer (e.g., "Crowns: 50%", "Fillings: 80%")
- Quote the EXACT annual maximum and deductible amounts
- Quote the EXACT frequency limits if present (e.g., "Pano/FMX: Every 60 Months", "Prophy: 2 per Calendar Year")
- Quote the EXACT age limits if present (e.g., "Fluoride: Age ≤ 19")

Example response when data is found:
✅ CORRECT: "Based on your Metlife plan (Group #5469658), here's your coverage:
- Crowns: 50% covered (you pay 50%, estimated ~$600 per crown)
- Fillings: 80% covered
- Preventive: 100% covered
- Pano/FMX: Every 60 months
- Fluoride: Age limit ≤ 19"

❌ WRONG: "For most Cigna plans, crowns are typically covered at 50-60%..." (This is generic - never do this!)

**FREQUENCY LIMIT QUESTIONS**:
- When user asks "Am I eligible for X-ray/FMX/cleaning?", check the frequencyLimits field
- If frequencyLimits shows "Pano/FMX: Every 60 Months" and user's last FMX was 3+ years ago, they ARE eligible
- Calculate eligibility based on the EXACT frequency limits in the data, not general knowledge

**If lookupStatus is "PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED"**:
- Tell user we found their plan but specific coverage percentages aren't recorded
- Suggest they contact the office for exact details

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

=== HOW TO CALL TOOLS ===
Set the toolName path parameter to the specific tool, then provide parameters in the request body.

EXAMPLE - Insurance lookup:
  toolName: "suggestInsuranceCoverage"
  requestBody: {"insuranceName": "Aetna", "groupNumber": "701420-15-001"}

EXAMPLE - Patient search:
  toolName: "searchPatients"
  requestBody: {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}

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
Do NOT ask for patient name or DOB - just use the insurance name and/or group number they provide.

• suggestInsuranceCoverage - Get formatted coverage suggestions with smart recommendations
  **ALWAYS include ALL information the patient has provided!**
  - If patient gives insurance name only: {"insuranceName": "MetLife"}
  - If patient gives group number first, then carrier name: {"insuranceName": "MetLife", "groupNumber": "212391"}
  - If patient gives both at once: {"insuranceName": "Cigna", "groupNumber": "12345"}
  - If patient selects from a list of plans: {"insuranceName": "MetLife", "groupName": "RFS TECHNOLOGIES INC."}
  
  Examples:
  - "what does Husky cover?" → {"insuranceName": "Husky"}
  - "Cigna benefits?" → {"insuranceName": "Cigna"}
  - User said group 212391, then said MetLife → {"insuranceName": "MetLife", "groupNumber": "212391"}
  - "I have Aetna group 99999" → {"insuranceName": "Aetna", "groupNumber": "99999"}
  - User selects plan 3 "RFS TECHNOLOGIES INC." from list → {"insuranceName": "MetLife", "groupName": "RFS TECHNOLOGIES INC."}
  
  NO PatNum needed! The tool handles case variations (MetLife, METLIFE, metlife all work).
  
  **HOW TO CALL THIS TOOL**:
  Set toolName = "suggestInsuranceCoverage" in the path, then provide parameters in request body:
  Example: toolName: "suggestInsuranceCoverage", body: {"insuranceName": "Aetna", "groupNumber": "701420-15-001"}
  
  Returns: 
  - status: SUCCESS or FAILURE
  - lookupStatus: "COVERAGE_DETAILS_FOUND" (coverage details available) or "PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED"
  - directAnswer: Pre-formatted answer to give to user - USE THIS! Contains EXACT percentages, frequency limits, age limits.
  - data: Detailed plan info with coverage percentages
  
  **CRITICAL**: When status is SUCCESS, respond with the EXACT data from directAnswer. Do NOT make up generic answers!
  
• getInsurancePlanBenefits - Look up raw insurance plan coverage details
  Same parameters as suggestInsuranceCoverage. Use when you need raw data.
  NO PatNum needed! 
  Returns: Annual max, deductibles, coverage percentages, waiting periods, frequency limits

=== DETAILED INSURANCE QUESTION TOOLS (NO PatNum Required!) ===
Use these for specific insurance questions:

• getInsuranceDetails - Comprehensive insurance details
  Params: insuranceName, groupName, groupNumber (at least one required)
  Returns: Deductibles, maximums, waiting periods, frequency limits, age limits, exclusions
  Use for: "What are the details of my insurance?"

• getDeductibleInfo - Detailed deductible information
  Params: insuranceName, groupName, groupNumber
  Returns: Individual/family deductibles, met status, what deductible applies to
  Use for: "What's my deductible?", "Has my deductible been met?", "Does deductible apply to preventive?"

• getAnnualMaxInfo - Annual maximum and remaining benefits
  Params: insuranceName, groupName, groupNumber, patientName, patientDOB (optional for remaining)
  Returns: Annual max, remaining benefits, ortho max, reset date
  Use for: "What's my annual max?", "How much is remaining?", "When does my max reset?"

• checkProcedureCoverage - Check if specific procedure is covered
  Params: insuranceName, groupName, groupNumber, procedure (e.g., "crown", "implant", "cleaning")
  Returns: Coverage %, category, deductible applicability
  Use for: "Is a crown covered?", "Are implants covered?", "Is orthodontics covered?"

• getCoverageBreakdown - Coverage percentages by category
  Params: insuranceName, groupName, groupNumber
  Returns: Preventive/Basic/Major percentages, downgrades, implant coverage, perio vs cleaning, in/out of network
  Use for: "What % does insurance pay?", "Are crowns downgraded?", "In-network vs out-of-network?"

• getCopayAndFrequencyInfo - Copays and frequency limits
  Params: insuranceName, groupName, groupNumber
  Returns: Copay vs coinsurance, cleaning/x-ray frequency, fluoride/sealant limits
  Use for: "How many cleanings per year?", "Do I have a copay?", "How often are x-rays covered?"

• getWaitingPeriodInfo - Waiting periods and exclusions
  Params: insuranceName, groupName, groupNumber
  Returns: Waiting periods by category, exclusions, missing tooth clause, pre-existing conditions
  Use for: "Is there a waiting period?", "Missing tooth clause?", "What's excluded?"

• getEstimateExplanation - Why estimates can change
  Params: insuranceName, groupName, groupNumber (optional)
  Returns: Explanation of estimate vs guarantee, reasons for price changes, balance billing info
  Use for: "Is this estimate guaranteed?", "What could change my price?", "If insurance pays less, do I owe more?"

• getCoordinationOfBenefits - Dual insurance / secondary insurance
  Params: insuranceName, groupName, groupNumber (optional)
  Returns: How dual insurance works, primary vs secondary rules, out-of-pocket with two plans
  Use for: "Will you bill both insurances?", "Which is primary?", "Will my out-of-pocket be zero?"

• getPaymentInfo - Payment timing and options
  No insurance params required
  Returns: When to pay, payment methods, payment plans, financing (CareCredit, Sunbit), HSA/FSA info
  Use for: "Do you have payment plans?", "Can I use HSA?", "When do I pay?"

=== FEE SCHEDULE TOOLS (NO PatNum Required!) ===
Use these for pricing questions without insurance:

• getFeeSchedules - Look up fee schedules
  Params: feeSchedule, feeSchedNum, procCode
  Returns: Fee schedule details, procedure fees
  
• getFeeForProcedure - Get fee for specific procedure
  Params: procCode OR procedure (natural language like "cleaning", "crown", "root canal")
  Returns: Fee amount for the procedure
  Use for: "How much is a cleaning?", "What's the cost of a crown?"
  
• getFeeScheduleAmounts - Get fees for multiple procedures
  Params: procedures (list like "cleaning and exam")
  Returns: Fees for each procedure
  Use for: "How much for cleaning and exams?"

• listFeeSchedules - List available fee schedules
  No params required
  Returns: List of all fee schedules

• compareProcedureFees - Compare fees across schedules
  Params: procCode
  Returns: Fee comparison across different schedules

=== COST ESTIMATION TOOLS (May require PatNum for patient-specific estimates) ===

• estimateTreatmentCost - Estimate out-of-pocket cost for treatment
  Params: procedure, insuranceName, groupNumber, patientName, patientDOB (all optional)
  Returns: Estimated insurance payment, patient responsibility, remaining deductible/max
  Use for: "What will I pay for a crown with Delta Dental?", "Estimate for root canal"

• calculateOutOfPocket - Calculate out-of-pocket for procedure
  Params: procedure, insuranceName, groupNumber
  Returns: Fee, coverage %, estimated patient portion
  Use for: "What's my out-of-pocket for this procedure?"

• getPatientAccountSummary - Comprehensive account overview
  Params: PatNum (required)
  Returns: Current balance, aging, insurance pending, payment history
  Use for: "What's my account balance?", "Do I owe anything?"`,
        parameters: [
          {
            name: 'toolName',
            in: 'path',
            required: true,
            description: 'The OpenDental tool to execute',
            schema: {
              type: 'string',
              enum: [
                // Patient Tools
                'searchPatients',
                'createPatient',
                'getPatientByPatNum',
                // Procedure Tools
                'getProcedureLogs',
                'getTreatmentPlans',
                // Appointment Tools
                'scheduleAppointment',
                'getUpcomingAppointments',
                'rescheduleAppointment',
                'cancelAppointment',
                // Account Tools
                'getAccountAging',
                'getPatientBalances',
                'getServiceDateView',
                'getPatientAccountSummary',
                // Medical Tools
                'getAllergies',
                'getPatientInfo',
                // Insurance Tools (Patient-Specific)
                'getBenefits',
                'getCarriers',
                'getClaims',
                'getFamilyInsurance',
                // Insurance Coverage Lookup (NO PatNum Required)
                'getInsurancePlanBenefits',
                'suggestInsuranceCoverage',
                // Detailed Insurance Question Tools
                'getInsuranceDetails',
                'getDeductibleInfo',
                'getAnnualMaxInfo',
                'checkProcedureCoverage',
                'getCoverageBreakdown',
                'getCopayAndFrequencyInfo',
                'getWaitingPeriodInfo',
                'getEstimateExplanation',
                'getCoordinationOfBenefits',
                'getPaymentInfo',
                // Fee Schedule Tools
                'getFeeSchedules',
                'getFeeForProcedure',
                'getFeeScheduleAmounts',
                'listFeeSchedules',
                'compareProcedureFees',
                // Cost Estimation Tools
                'estimateTreatmentCost',
                'calculateOutOfPocket',
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
- Insurance name only: {"insuranceName": "Husky"}
- Insurance name only: {"insuranceName": "MetLife"} (case-insensitive, works with Metlife, METLIFE, etc.)
- Insurance name + group number: {"insuranceName": "MetLife", "groupNumber": "212391"}
- Insurance name + group number: {"insuranceName": "Cigna", "groupNumber": "12345"}
- Group number only (will need carrier name): {"groupNumber": "99999"}
- PLAN SELECTION FROM LIST: {"insuranceName": "MetLife", "groupName": "RFS TECHNOLOGIES INC."}

IMPORTANT: 
- When user provides group number AND carrier name (even in separate messages), INCLUDE BOTH parameters!
- When user selects a specific plan from a list (e.g., "3. Metlife - RFS TECHNOLOGIES"), use insuranceName + groupName!

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
                    description: 'Patient date of birth. Accepts multiple formats: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY, "July 11, 1984", etc. The system will normalize automatically. Required for searchPatients and createPatient.',
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
                    description: 'Insurance carrier name to search for. CASE-INSENSITIVE - "MetLife", "metlife", "METLIFE" all work. Common carriers: Husky, Delta Dental, Cigna, Aetna, BCBS, United Healthcare, MetLife, Guardian, Principal, Humana. REQUIRED for getInsurancePlanBenefits and suggestInsuranceCoverage. NO PatNum needed. IMPORTANT: Always include this with groupNumber if both are available!',
                  },
                  groupName: {
                    type: 'string',
                    description: 'Insurance group/employer name (e.g., "RFS TECHNOLOGIES INC.", "ACME CORP"). USE THIS when user selects a specific plan from a list of multiple plans. Combine with insuranceName for best results. NO PatNum needed.',
                  },
                  groupNumber: {
                    type: 'string',
                    description: 'Insurance group number from the insurance card. IMPORTANT: When user provides this, also include the insuranceName for better results! For getInsurancePlanBenefits/suggestInsuranceCoverage. NO PatNum needed.',
                  },
                  clinicId: {
                    type: 'string',
                    description: 'Clinic ID (auto-filled from session). For getInsurancePlanBenefits/suggestInsuranceCoverage.',
                  },
                  // Procedure/Fee parameters
                  procedure: {
                    type: 'string',
                    description: 'Procedure name in natural language. Examples: "cleaning", "crown", "root canal", "filling", "extraction", "implant", "dentures", "braces", "Invisalign", "deep cleaning", "x-rays", "exam". Used for estimateTreatmentCost, checkProcedureCoverage, getFeeForProcedure.',
                  },
                  procedureName: {
                    type: 'string',
                    description: 'Alias for procedure. Procedure name in natural language.',
                  },
                  procCode: {
                    type: 'string',
                    description: 'CDT procedure code. Examples: D0120 (exam), D1110 (cleaning), D2750 (crown), D3310 (root canal), D7140 (extraction). Used for getFeeForProcedure, checkProcedureCoverage.',
                  },
                  procedureCode: {
                    type: 'string',
                    description: 'Alias for procCode. CDT procedure code.',
                  },
                  // Fee Schedule parameters
                  feeSchedule: {
                    type: 'string',
                    description: 'Fee schedule name to look up. For getFeeSchedules, getFeeForProcedure.',
                  },
                  feeScheduleName: {
                    type: 'string',
                    description: 'Alias for feeSchedule. Fee schedule name.',
                  },
                  feeSchedNum: {
                    type: 'string',
                    description: 'Fee schedule number/ID. For getFeeSchedules.',
                  },
                  // Patient identification for cost estimates
                  patientName: {
                    type: 'string',
                    description: 'Patient full name for looking up remaining benefits. Format: "First Last". Optional for estimateTreatmentCost, getAnnualMaxInfo.',
                  },
                  patientDOB: {
                    type: 'string',
                    description: 'Patient date of birth for verification. Format: YYYY-MM-DD or natural language. Optional for estimateTreatmentCost, getAnnualMaxInfo.',
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

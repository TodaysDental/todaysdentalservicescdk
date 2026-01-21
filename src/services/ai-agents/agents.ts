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
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_NEGATIVE_PROMPT,
  buildSystemPromptWithDate,
  getDateContext,
} from '../../shared/prompts/ai-prompts';

// Re-export prompts for backward compatibility
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_NEGATIVE_PROMPT, buildSystemPromptWithDate };

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
  // 🧠 ANTHROPIC CLAUDE FAMILY
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
  // 🐘 AMAZON NOVA SERIES
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
  // 🦙 META LLAMA FAMILY
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
  // 🤖 COHERE COMMAND MODELS
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
  // 🔍 DEEPSEEK MODELS
  // ========================================
  {
    id: 'deepseek.deepseek-r1-v1:0',
    name: 'DeepSeek-R1',
    provider: 'DeepSeek',
    description: 'Open reasoning model with strong performance',
    recommended: false,
  },
  // ========================================
  // 🌟 MISTRAL AI MODELS
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
    version: '3.0.0',
    description: 'Unified proxy API for OpenDental operations used by Bedrock Agent',
  },
  paths: {
    '/open-dental/{toolName}': {
      post: {
        operationId: 'executeOpenDentalTool',
        summary: 'Execute an OpenDental tool',
        description: `Execute any OpenDental tool by specifying the tool name and parameters.

══════════════════════════════════════════════════════════════════════════════
                           HOW TO CALL TOOLS
══════════════════════════════════════════════════════════════════════════════

Set the toolName path parameter to the specific tool, then provide parameters in the request body.

EXAMPLE - Insurance lookup:
  toolName: "suggestInsuranceCoverage"
  requestBody: {"insuranceName": "Aetna", "groupNumber": "701420-15-001"}

EXAMPLE - Patient search:
  toolName: "searchPatients"
  requestBody: {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}

EXAMPLE - Schedule appointment:
  toolName: "scheduleAppointment"
  requestBody: {"PatNum": 123, "Reason": "Crown prep", "Date": "2024-12-20 09:00:00", "OpName": "ONLINE_BOOKING_MAJOR"}

EXAMPLE - Get clinic info:
  toolName: "getClinicInfo"
  requestBody: {}

══════════════════════════════════════════════════════════════════════════════
                    CLINIC INFORMATION TOOL (NO PATIENT ID REQUIRED)
══════════════════════════════════════════════════════════════════════════════

▸ getClinicInfo - Get clinic location, contact, and general information
  Required: None (uses clinicId from session context)
  Optional: clinicId (to query a specific clinic)
  Returns: Complete clinic information including:
    - Clinic name and address (street, city, state, zip)
    - Phone, email, fax
    - Website and Google Maps links
    - Online scheduling URL
    - General information about accessibility, parking, safety
  
  USE THIS TOOL for questions about:
    - Location / address / directions
    - Contact information (phone, email)
    - Website and online resources
    - Parking and accessibility
    - General clinic information
  
  DO NOT require patient identification for these questions!

══════════════════════════════════════════════════════════════════════════════
                           PATIENT TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ searchPatients - Search for patients by name and birthdate
  Required: LName, FName, Birthdate (YYYY-MM-DD or any common format)
  Returns: List of matching patients with PatNum
  Notes: PatNum is saved to session if single match found
  
▸ createPatient - Create a new patient record
  Required: LName, FName, Birthdate
  Optional: WirelessPhone, Email, Address, City, State, Zip
  Returns: New patient record with PatNum
  
▸ getPatientByPatNum - Get complete patient details
  Required: PatNum
  Returns: Full patient demographics and contact info

▸ updatePatient - Update patient information
  Required: PatNum
  Optional: LName, FName, MiddleI, Preferred, Address, Address2, City, State, Zip,
            HmPhone, WkPhone, WirelessPhone, Email, Birthdate, Gender

══════════════════════════════════════════════════════════════════════════════
                           APPOINTMENT TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ scheduleAppointment - Schedule a new appointment
  Required: PatNum, Reason, Date (YYYY-MM-DD HH:mm:ss), OpName
  Optional: Note, ProvNum
  OpName values:
    - ONLINE_BOOKING_EXAM: New patient exams
    - ONLINE_BOOKING_MINOR: Cleanings, fillings, minor work
    - ONLINE_BOOKING_MAJOR: Crowns, root canals, extractions
  IMPORTANT: Book the requested date/time - do NOT check availability

▸ getUpcomingAppointments - Get future appointments for patient
  Required: PatNum
  Returns: List of upcoming appointments with AptNum, date, time, status

▸ rescheduleAppointment - Change appointment date/time
  Required: AptNum, NewDateTime (YYYY-MM-DD HH:mm:ss)
  Optional: Note
  Notes: Call getUpcomingAppointments first to get AptNum

▸ cancelAppointment - Cancel an existing appointment
  Required: AptNum
  Optional: SendToUnscheduledList (default: true), Note
  Notes: Call getUpcomingAppointments first to confirm

▸ getHistAppointments - Get appointment history and changes
  Required: PatNum
  Optional: DateStart, DateEnd

▸ Appointments GET (single) - Get single appointment by AptNum
  Required: AptNum

▸ Appointments GET (multiple) - Get appointments with filters
  Optional: PatNum, DateStart, DateEnd, Status, ProvNum, ClinicNum

▸ Appointments GET Slots - ⭐ PRIMARY TOOL FOR FINDING AVAILABLE TIMES
  Use this tool to find the NEXT AVAILABLE appointment slot!
  Optional Parameters:
    • date: Specific date (YYYY-MM-DD)
    • dateStart: Start of date range (YYYY-MM-DD) - use today's date
    • dateEnd: End of date range (YYYY-MM-DD) - typically 2 weeks out
    • lengthMinutes: Required appointment duration (30, 60, 90, etc.)
    • ProvNum: Specific provider number (for provider preference)
    • OpNum: Specific operatory number (for procedure type)
  Returns: List of available time slots with date, time, ProvNum, OpNum
  
  USAGE FOR "NEXT AVAILABLE" REQUESTS:
  1. First call getClinicAppointmentTypes to get correct duration
  2. Then call this tool with dateStart=today, dateEnd=14 days out
  3. Filter results by patient preferences (AM/PM, specific days)
  4. Present earliest 3-5 options to patient
  
  Example: {"dateStart": "2024-01-15", "dateEnd": "2024-01-29", "lengthMinutes": 60}

▸ Appointments GET ASAP - Get patients on ASAP/waitlist
  Optional: ClinicNum, ProvNum
  Returns: List of patients waiting for earlier appointments

▸ Appointments PUT (update) - Update appointment details
  Required: AptNum
  Optional: AptDateTime, Pattern, Confirmed, Note, ProvNum, Op

▸ Appointments PUT Break - Break/cancel an appointment
  Required: AptNum
  Optional: SendToUnscheduledList, Note

▸ Appointments PUT Confirm - Confirm an appointment
  Required: AptNum, Confirmed

▸ getClinicAppointmentTypes - Get appointment types with durations
  Optional: label (to get a specific type)
  Returns: List of appointment types with duration, operatory, and TypeNum
  Example types: "New Patient", "Cleaning", "Crown", "Filling", "Emergency"
  IMPORTANT: Call this FIRST to get correct lengthMinutes before searching slots!
  
  Common durations:
  • New Patient Exam: 60-90 minutes
  • Cleaning: 30-60 minutes
  • Crown/Major: 60-90 minutes
  • Filling/Minor: 30-45 minutes
  • Emergency: 30-60 minutes

══════════════════════════════════════════════════════════════════════════════
                           PROCEDURE & TREATMENT PLAN TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getProcedureLogs - Get procedure logs for a patient
  Required: PatNum
  Optional: ProcStatus ("TP"=treatment-planned, "C"=complete, "EC"=existing current)
  Returns: List of procedures with codes, descriptions, fees
  Notes: Use ProcStatus="TP" to find pending procedures

▸ getProcedureLog - Get single procedure by ProcNum
  Required: ProcNum

▸ getTreatmentPlans - Get active treatment plans
  Required: PatNum
  Returns: Treatment plans with procedures and total fees

▸ TreatPlans GET - Get treatment plans with filters
  Optional: PatNum, Heading, Note, ResponsParty, DateTP

▸ createProcedureLog - Create new procedure record
  Required: PatNum, ProcDate, ProcStatus, (CodeNum OR procCode)
  Optional: ProcFee, ToothNum, Surf, Note, ProvNum, AptNum

▸ updateProcedureLog - Update existing procedure
  Required: ProcNum
  Optional: ProcStatus, ProcFee, Note, ToothNum, Surf

▸ deleteProcedureLog - Delete a procedure
  Required: ProcNum

▸ getProcedureCodes - Search procedure codes
  Optional: ProcCode, Descript, CodeNum
  Returns: Matching CDT codes with descriptions and fees

▸ createTreatPlan - Create new treatment plan
  Required: PatNum, Heading
  Optional: Note, DateTP, ResponsParty

▸ updateTreatPlan - Update treatment plan
  Required: TreatPlanNum
  Optional: Heading, Note, DateTP, TPStatus

▸ getTreatPlanAttaches - Get procedures attached to treatment plan
  Required: TreatPlanNum

▸ createTreatPlanAttach - Attach procedure to treatment plan
  Required: TreatPlanNum, ProcNum
  Optional: Priority

▸ getProcNotes - Get notes for a procedure
  Required: PatNum
  Optional: ProcNum

▸ createProcNote - Add note to procedure
  Required: PatNum, ProcNum, Note
  Optional: isSigned, doAppendNote

══════════════════════════════════════════════════════════════════════════════
             INSURANCE COVERAGE LOOKUP (NO PatNum Required!)
══════════════════════════════════════════════════════════════════════════════

IMPORTANT: Use these tools FIRST for insurance questions - NO patient lookup needed!

▸ suggestInsuranceCoverage - Get formatted coverage with recommendations
  Parameters (at least one required):
    - insuranceName: Carrier name ("Delta Dental", "Cigna", "Aetna", etc.)
    - groupNumber: Group number from insurance card
    - groupName: Employer/group name (use when selecting from list)
  Returns:
    - directAnswer: Pre-formatted response - USE THIS IN YOUR RESPONSE!
    - lookupStatus: "COVERAGE_DETAILS_FOUND" or "PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED"
    - data: Detailed plan info with coverage percentages
  Examples:
    - "What does Husky cover?" → {"insuranceName": "Husky"}
    - "I have Cigna group 12345" → {"insuranceName": "Cigna", "groupNumber": "12345"}
    - User selects plan from list → {"insuranceName": "MetLife", "groupName": "ACME CORP"}
  CRITICAL: Always use EXACT data from directAnswer - NEVER make up percentages!

▸ getInsurancePlanBenefits - Get raw insurance plan data
  Same parameters as suggestInsuranceCoverage
  Returns: Annual max, deductibles, coverage percentages, limits

▸ checkProcedureCoverage - Check if specific procedure is covered
  Required: insuranceName, groupNumber, procedure
  procedure examples: "crown", "root canal", "cleaning", "implant", "braces"
  Returns: Coverage %, estimated patient cost, waiting periods, exclusions

▸ getInsuranceDetails - Comprehensive insurance details
  Params: insuranceName, groupName, groupNumber (at least one)
  Returns: All plan details including deductibles, maximums, limits, exclusions

▸ getDeductibleInfo - Detailed deductible information
  Params: insuranceName, groupName, groupNumber
  Returns: Individual/family deductibles, what applies to which services

▸ getAnnualMaxInfo - Annual maximum and remaining benefits
  Params: insuranceName, groupName, groupNumber
  Optional: patientName, patientDOB (for remaining benefits lookup)
  Returns: Annual max, remaining benefits, ortho max, reset date

▸ getCoverageBreakdown - Coverage percentages by category
  Params: insuranceName, groupName, groupNumber
  Returns: Preventive/Basic/Major percentages, downgrades, in/out network differences

▸ getCopayAndFrequencyInfo - Copays and frequency limits
  Params: insuranceName, groupName, groupNumber
  Returns: Copays, cleaning/x-ray frequency, fluoride/sealant limits

▸ getWaitingPeriodInfo - Waiting periods and exclusions
  Params: insuranceName, groupName, groupNumber
  Returns: Waiting periods by category, exclusions, missing tooth clause

▸ getEstimateExplanation - Why estimates can change
  Optional params: insuranceName, groupNumber
  Returns: Explanation of estimate accuracy, balance billing info

▸ getCoordinationOfBenefits - Dual insurance / COB rules
  Optional params: insuranceName, groupNumber
  Returns: Primary/secondary rules, how dual insurance works
  Aliases: dualInsurance, secondaryInsurance, whichInsuranceIsPrimary

▸ getPaymentInfo - Payment options and timing
  No params required
  Returns: Payment plans, financing (CareCredit, Sunbit), HSA/FSA info
  Aliases: paymentOptions, paymentPlans, financing

══════════════════════════════════════════════════════════════════════════════
             PATIENT-SPECIFIC INSURANCE TOOLS (Require PatNum)
══════════════════════════════════════════════════════════════════════════════

▸ getBenefits - Get patient's benefit usage and remaining
  Required: PatNum OR (PlanNum/PatPlanNum)
  Returns: Benefits used, remaining annual max, deductible status

▸ getFamilyInsurance - Get family insurance info
  Required: PatNum
  Returns: Insurance info for patient and family members

▸ getClaims - Get patient's claims history
  Optional: PatNum, ClaimStatus, DateStart, DateEnd
  Returns: List of claims with status and amounts

▸ getCarriers - Get list of insurance carriers
  No params required
  Returns: All insurance carriers in system

▸ getInsPlans - Get insurance plans
  Optional: PlanNum, CarrierNum, GroupNum
  Returns: Insurance plan details

▸ getInsPlan - Get single insurance plan
  Required: PlanNum
  Returns: Full plan details

▸ getInsSubs - Get insurance subscribers
  Optional: PatNum, InsSubNum
  Returns: Subscriber information

▸ getPatPlans - Get patient's plan assignments
  Optional: PatNum, InsSubNum
  Returns: Patient insurance assignments with ordinal

▸ createPatPlan - Assign insurance to patient
  Required: PatNum, InsSubNum
  Optional: Ordinal (1=primary, 2=secondary), Relationship, PatID

▸ updatePatPlan - Update patient insurance assignment
  Required: PatPlanNum
  Optional: InsSubNum, Ordinal, Relationship

▸ deletePatPlan - Remove insurance from patient
  Required: PatPlanNum

▸ getInsVerifies - Get insurance verifications
  Optional: PatNum, InsSubNum, DateLastVerified

▸ updateInsVerify - Update verification status
  Required: InsVerifyNum
  Optional: DateLastVerified, VerifyUserNum, Note

══════════════════════════════════════════════════════════════════════════════
                           FEE SCHEDULE TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getFeeSchedules - Get fee schedules
  Optional: FeeSchedNum, FeeSchedType
  Returns: Fee schedule list

▸ getFeeForProcedure - Get fee for specific procedure
  Required: procCode OR procedure (natural language)
  Optional: feeSchedNum
  Examples: procCode="D2750" or procedure="crown"
  Returns: Fee amount for the procedure

▸ getFeeScheduleAmounts - Get fees for multiple procedures
  Params: procedures (comma-separated or list)
  Returns: Fees for each procedure

▸ listFeeSchedules - List all available fee schedules
  No params required
  Returns: All fee schedules with names and types

▸ compareProcedureFees - Compare fees across schedules
  Required: procCode
  Returns: Fee comparison across different schedules

▸ getFees - Get fees matching criteria
  Optional: FeeSchedNum, CodeNum, ClinicNum
  Returns: Matching fees

══════════════════════════════════════════════════════════════════════════════
                           COST ESTIMATION TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ estimateTreatmentCost - Estimate out-of-pocket cost
  Required: procedure
  Optional: insuranceName, groupNumber, patientName, patientDOB
  Returns: Estimated insurance payment, patient responsibility, breakdown

▸ calculateOutOfPocket - Calculate patient portion
  Required: procedure OR procCode
  Optional: insuranceName, groupNumber, PatNum
  Returns: Fee, coverage %, estimated patient cost

══════════════════════════════════════════════════════════════════════════════
                           ACCOUNT & BILLING TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getAccountAging - Get balance aging breakdown
  Required: PatNum
  Returns: Bal_0_30, Bal_31_60, Bal_61_90, BalOver90, Total, InsEst, PatEstBal

▸ getPatientBalances - Get family member balances
  Required: PatNum
  Returns: Individual balances for each family member

▸ getServiceDateView - Get transaction history by date
  Required: PatNum
  Optional: isFamily (boolean)
  Returns: Detailed service history with charges and payments

▸ getPatientAccountSummary - Comprehensive account overview
  Required: PatNum
  Returns: Combined aging, balances, insurance pending, summary

▸ getPayments - Get payments list
  Optional: PatNum, PayType, DateEntry
  Returns: List of payments

▸ createPayment - Record a payment
  Required: PatNum, PayAmt, PayDate
  Optional: PayType, PayNote, CheckNum

▸ getPaySplits - Get payment allocations
  Optional: PayNum, PatNum
  Returns: How payments are split across procedures

▸ createPaySplit - Allocate payment to procedure
  Required: PayNum, PatNum, SplitAmt
  Optional: ProcNum, ProvNum

══════════════════════════════════════════════════════════════════════════════
                           STATEMENT TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getStatement - Get single statement
  Required: StatementNum
  Returns: Statement details

▸ getStatements - Get statements list
  Optional: PatNum
  Returns: List of statements with dates and totals

▸ createStatement - Create new statement
  Required: PatNum
  Optional: DateSent, Note, DocNum

══════════════════════════════════════════════════════════════════════════════
                           MEDICAL HISTORY TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getAllergies - Get patient allergies
  Required: PatNum
  Returns: List of allergies with reactions

▸ createAllergy - Add allergy to patient
  Required: PatNum, AllergyDefNum
  Optional: Reaction, StatusIsActive

▸ updateAllergy - Update allergy record
  Required: AllergyNum
  Optional: Reaction, StatusIsActive

▸ deleteAllergy - Remove allergy
  Required: AllergyNum

▸ getDiseaseDefs - Get disease/condition definitions
  No params required
  Returns: List of available conditions

▸ getDiseases - Get patient diseases/conditions
  Required: PatNum
  Returns: Patient's medical conditions

▸ createDisease - Add condition to patient
  Required: PatNum, DiseaseDefNum
  Optional: ProbStatus, DateStart, DateStop

▸ updateDisease - Update condition
  Required: DiseaseNum
  Optional: ProbStatus, DateStart, DateStop

▸ getMedicationPats - Get patient medications
  Required: PatNum
  Returns: Current medications

▸ getMedicationPat - Get single medication record
  Required: MedicationPatNum

▸ createMedicationPat - Add medication to patient
  Required: PatNum, MedicationNum
  Optional: PatNote, DateStart, DateStop

▸ updateMedicationPat - Update medication
  Required: MedicationPatNum
  Optional: PatNote, DateStart, DateStop

▸ deleteMedicationPat - Remove medication
  Required: MedicationPatNum

▸ getMedications - Get all medications in system
  No params required
  Returns: Medication list

▸ getPatientInfo - Get comprehensive patient info
  Required: PatNum
  Returns: Demographics, allergies, conditions, medications

▸ getPatientRaces - Get patient race/ethnicity
  Required: PatNum

══════════════════════════════════════════════════════════════════════════════
                           RECALL & SCHEDULING TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ Recalls GET - Get single recall
  Required: RecallNum

▸ Recalls GET List - Get recalls with filters
  Optional: PatNum, DateStart, DateEnd, RecallTypeNum

▸ Recalls POST (create) - Create recall
  Required: PatNum, RecallTypeNum
  Optional: DateScheduled, DateDue

▸ Recalls PUT (update) - Update recall
  Required: RecallNum
  Optional: DateScheduled, DateDue, Note

▸ RecallTypes GET (single) - Get recall type
  Required: RecallTypeNum

▸ RecallTypes GET (multiple) - Get all recall types
  No params required

▸ Schedules GET (single) - Get single schedule
  Required: ScheduleNum

▸ Schedules GET (multiple) - Get schedules
  Optional: date, dateStart, dateEnd, SchedType, ProvNum, EmployeeNum

▸ ScheduleOps GET - Get schedule operations
  Optional: ScheduleNum, OperatoryNum

▸ getOperatory - Get single operatory
  Required: OperatoryNum

▸ getOperatories - Get all operatories
  No params required
  Returns: Treatment rooms with names and settings

══════════════════════════════════════════════════════════════════════════════
                           PROVIDER & STAFF TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ Providers GET (single) - Get single provider
  Required: ProvNum
  Returns: Provider details

▸ Providers GET (multiple) - Get providers list
  Optional: ClinicNum, DateTStamp
  Returns: All providers

▸ Providers POST (create) - Create new provider
  Required: Abbr
  Optional: LName, FName, Specialty, NationalProvID

▸ Providers PUT (update) - Update provider
  Required: ProvNum
  Optional: Abbr, LName, FName, Specialty, IsHidden

▸ Employees GET (single) - Get single employee
  Required: EmployeeNum

▸ Employees GET (multiple) - Get employees list
  Optional: ClinicNum, IsHidden

▸ Userods GET - Get user accounts
  No params required

▸ Userods POST (create) - Create user account
  Required: UserName
  Optional: EmployeeNum, ProvNum, ClinicNum

▸ Userods PUT (update) - Update user account
  Required: UserNum
  Optional: UserName, EmployeeNum, ProvNum

▸ UserGroups GET - Get user groups
  No params required

▸ UserGroupAttaches GET - Get user group assignments
  Optional: UserNum

══════════════════════════════════════════════════════════════════════════════
                           LAB & REFERRAL TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getLabCase - Get single lab case
  Required: LabCaseNum

▸ getLabCases - Get lab cases
  Optional: PatNum
  Returns: Lab cases with status and dates

▸ createLabCase - Create new lab case
  Required: PatNum, LaboratoryNum, DateTimeSent
  Optional: Instructions, DateTimeRecd

▸ updateLabCase - Update lab case
  Required: LabCaseNum
  Optional: DateTimeRecd, DateTimeCheckedQuality

▸ deleteLabCase - Delete lab case
  Required: LabCaseNum

▸ getLaboratory - Get single laboratory
  Required: LaboratoryNum

▸ getLaboratories - Get all laboratories
  No params required

▸ createLaboratory - Create laboratory
  Required: Description
  Optional: Address, City, State, Zip, Phone

▸ getLabTurnarounds - Get lab turnaround times
  Optional: LaboratoryNum

▸ Referrals GET (single) - Get single referral source
  Required: ReferralNum

▸ Referrals GET (multiple) - Get referrals list
  No params required

▸ Referrals POST (create) - Create referral
  Required: LName
  Optional: FName, Title, Specialty, Address

▸ RefAttaches GET - Get referral attachments
  Optional: PatNum, ReferralNum

▸ RefAttaches POST (create) - Create referral attachment
  Required: PatNum, ReferralNum
  Optional: RefType, DateTStamp

▸ RefAttaches PUT (update) - Update referral attachment
  Required: RefAttachNum
  Optional: RefType

▸ RefAttaches DELETE - Delete referral attachment
  Required: RefAttachNum

══════════════════════════════════════════════════════════════════════════════
                           PERIODONTAL TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getPerioExams - Get perio exams for patient
  Required: PatNum
  Returns: List of periodontal exams

▸ getPerioExam - Get single perio exam
  Required: PerioExamNum

▸ createPerioExam - Create new perio exam
  Required: PatNum, ExamDate
  Optional: ProvNum, Note

▸ updatePerioExam - Update perio exam
  Required: PerioExamNum
  Optional: ExamDate, ProvNum, Note

▸ deletePerioExam - Delete perio exam
  Required: PerioExamNum

▸ getPerioMeasures - Get perio measurements
  Optional: PerioExamNum
  Returns: Probing depths and other measurements

▸ createPerioMeasure - Add perio measurement
  Required: PerioExamNum, SequenceType, IntTooth
  Optional: ToothValue, MBvalue, Bvalue, DBvalue, MLvalue, Lvalue, DLvalue

▸ updatePerioMeasure - Update perio measurement
  Required: PerioMeasureNum
  Optional: ToothValue, values for each position

══════════════════════════════════════════════════════════════════════════════
                           DOCUMENT & FORM TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getSheets - Get patient sheets/forms
  Optional: PatNum, SheetType
  Returns: Completed forms

▸ createSheet - Create new sheet
  Required: PatNum, SheetDefNum
  Optional: DateTimeSheet

▸ downloadSheetSftp - Download sheet via SFTP
  Required: SheetNum

▸ getSheetField - Get single sheet field
  Required: SheetFieldNum

▸ getSheetFields - Get sheet fields
  Optional: SheetNum
  Returns: All fields on a sheet

▸ updateSheetField - Update sheet field value
  Required: SheetFieldNum
  Optional: FieldValue

▸ SheetDefs GET (single) - Get sheet definition
  Required: SheetDefNum

▸ SheetDefs GET (multiple) - Get sheet definitions
  Optional: SheetType
  Returns: Available form templates

▸ Documents GET (single) - Get single document
  Required: DocNum

▸ Documents GET (multiple) - Get documents
  Optional: PatNum, DocCategory

▸ Documents POST (create) - Upload document
  Required: PatNum, DocCategory, fileName, fileData (base64)

▸ Documents PUT (update) - Update document
  Required: DocNum
  Optional: DocCategory, Description

▸ Documents DELETE - Delete document
  Required: DocNum

══════════════════════════════════════════════════════════════════════════════
                           TASK & COMMUNICATION TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ Tasks GET (single) - Get single task
  Required: TaskNum

▸ Tasks GET (multiple) - Get tasks
  Optional: TaskListNum, UserNum, PatNum

▸ Tasks POST (create) - Create task
  Required: TaskListNum, Descript
  Optional: PatNum, UserNum, DateTask

▸ Tasks PUT (update) - Update task
  Required: TaskNum
  Optional: Descript, TaskStatus, UserNum

▸ TaskLists GET - Get task lists
  No params required

▸ TaskNotes GET (single) - Get single task note
  Required: TaskNoteNum

▸ TaskNotes GET (multiple) - Get task notes
  Optional: TaskNum

▸ TaskNotes POST (create) - Create task note
  Required: TaskNum, Note
  Optional: DateTimeNote

▸ TaskNotes PUT (update) - Update task note
  Required: TaskNoteNum
  Optional: Note

▸ CommLogs GET (single) - Get single comm log
  Required: CommlogNum

▸ CommLogs GET (multiple) - Get comm logs
  Optional: PatNum, DateStart, DateEnd

▸ CommLogs POST (create) - Create comm log
  Required: PatNum, CommDateTime, Mode_, Note
  Mode_ values: "None", "Email", "Phone", "InPerson", "Letter", "Text"

▸ CommLogs PUT (update) - Update comm log
  Required: CommlogNum
  Optional: Note, Mode_

▸ CommLogs DELETE - Delete comm log
  Required: CommlogNum

══════════════════════════════════════════════════════════════════════════════
                           PATIENT FIELD TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getPatFieldDefs - Get patient field definitions
  No params required
  Returns: Custom field definitions

▸ createPatFieldDef - Create custom field definition
  Required: FieldName
  Optional: FieldType, PickList

▸ updatePatFieldDef - Update field definition
  Required: PatFieldDefNum
  Optional: FieldName, IsHidden

▸ deletePatFieldDef - Delete field definition
  Required: PatFieldDefNum

▸ getPatField - Get single patient field
  Required: PatFieldNum

▸ getPatFields - Get patient fields
  Optional: PatNum
  Returns: Custom field values for patient

▸ createPatField - Create patient field value
  Required: PatNum, FieldName, FieldValue

▸ updatePatField - Update patient field value
  Required: PatFieldNum
  Optional: FieldValue

▸ deletePatField - Delete patient field
  Required: PatFieldNum

▸ getPatientNote - Get patient note
  Required: PatNum

▸ getPatientNotes - Get all notes for patient
  Required: PatNum

▸ updatePatientNote - Update patient note
  Required: PatNum
  Optional: FamFinancial, ICEName, ICEPhone, MedUrgNote

══════════════════════════════════════════════════════════════════════════════
                           PHARMACY & PRESCRIPTION TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getPharmacy - Get single pharmacy
  Required: PharmacyNum

▸ getPharmacies - Get all pharmacies
  No params required

▸ RxPats GET (single) - Get single prescription
  Required: RxNum

▸ RxPats GET (multiple) - Get prescriptions
  Optional: PatNum

══════════════════════════════════════════════════════════════════════════════
                           REPORT TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ Reports GET Aging - Get aging report
  Optional: Date (as-of date)
  Returns: Patient aging balances

▸ Reports GET FinanceCharges - Get finance charges report
  Optional: DateStart, DateEnd
  Returns: Finance charges applied

▸ SecurityLogs GET - Get security/audit logs
  Optional: PermType, DateStart, DateEnd

══════════════════════════════════════════════════════════════════════════════
                           MISCELLANEOUS TOOLS
══════════════════════════════════════════════════════════════════════════════

▸ getSignalods - Get signals/notifications
  Required: SigDateTime
  Returns: System signals since datetime

▸ createSubscription - Create webhook subscription
  Required: EndPointUrl, WorkstationName

▸ getSubscriptions - Get webhook subscriptions
  No params required

▸ updateSubscription - Update subscription
  Required: SubscriptionNum
  Optional: EndPointUrl, Enabled

▸ deleteSubscription - Delete subscription
  Required: SubscriptionNum

▸ ToothInitials GET - Get tooth initial conditions
  Optional: PatNum

▸ ToothInitials POST (create) - Create tooth initial
  Required: PatNum, ToothNum, InitialType

▸ ToothInitials DELETE - Delete tooth initial
  Required: ToothInitialNum

▸ QuickPasteNotes GET (single) - Get quick paste note
  Required: QuickPasteNoteNum

▸ QuickPasteNotes GET (multiple) - Get quick paste notes
  Optional: QuickPasteCatNum

▸ getSubstitutionLinks - Get procedure substitution links
  Optional: PlanNum, CodeNum

▸ createSubstitutionLink - Create substitution link
  Required: PlanNum, CodeNum, SubstitutionCode

▸ updateSubstitutionLink - Update substitution link
  Required: SubstitutionLinkNum
  Optional: SubstitutionCode

▸ deleteSubstitutionLink - Delete substitution link
  Required: SubstitutionLinkNum

▸ getProcTPs - Get procedure treatment plan info
  Optional: TreatPlanNum, PatNum

▸ updateProcTP - Update procedure TP
  Required: ProcTPNum
  Optional: Priority, ToothNumTP

▸ deleteProcTP - Delete procedure TP
  Required: ProcTPNum`,
        parameters: [
          {
            name: 'toolName',
            in: 'path',
            required: true,
            description: 'The OpenDental tool to execute',
            schema: {
              type: 'string',
              enum: [
                // ===== CLINIC INFO TOOL (No patient ID required) =====
                'getClinicInfo',

                // ===== PATIENT TOOLS =====
                'searchPatients',
                'createPatient',
                'getPatientByPatNum',
                'updatePatient',

                // ===== APPOINTMENT TOOLS =====
                'scheduleAppointment',
                'getUpcomingAppointments',
                'rescheduleAppointment',
                'cancelAppointment',
                'getHistAppointments',
                'Appointments GET (single)',
                'Appointments GET (multiple)',
                'Appointments GET ASAP',
                'Appointments GET Slots',
                'Appointments GET SlotsWebSched',
                'Appointments GET WebSched',
                'Appointments POST (create)',
                'Appointments POST Planned',
                'Appointments POST SchedulePlanned',
                'Appointments POST WebSched',
                'Appointments PUT (update)',
                'Appointments PUT Break',
                'Appointments PUT Note',
                'Appointments PUT Confirm',
                'getClinicAppointmentTypes', // Get available appointment types (duration, operatory, etc.)
                'getAppointment',
                'getAppointments',
                'createAppointment',
                'updateAppointment',
                'breakAppointment',
                'getAppointmentSlots',
                'getPlannedAppts',

                // ===== PROCEDURE & TREATMENT PLAN TOOLS =====
                'getProcedureLogs',
                'getProcedureLog',
                'getTreatmentPlans',
                'TreatPlans GET',
                'TreatPlans POST (create)',
                'TreatPlans POST Saved',
                'TreatPlans PUT (update)',
                'TreatPlans DELETE',
                'getProcedureCode',
                'createProcedureLog',
                'updateProcedureLog',
                'deleteProcedureLog',
                'getProcedureCodes',
                'createProcedureCode',
                'updateProcedureCode',
                'getProcedureLogsInsuranceHistory',
                'getProcedureLogsGroupNotes',
                'createProcedureLogGroupNote',
                'createProcedureLogInsuranceHistory',
                'updateProcedureLogGroupNote',
                'deleteProcedureLogGroupNote',
                'createTreatPlan',
                'updateTreatPlan',
                'getTreatPlanAttaches',
                'createTreatPlanAttach',
                'updateTreatPlanAttach',
                'getProcNotes',
                'createProcNote',
                'getProgNotes',
                'getProcTPs',
                'updateProcTP',
                'deleteProcTP',

                // ===== INSURANCE COVERAGE LOOKUP (NO PatNum) =====
                'suggestInsuranceCoverage',
                'getInsurancePlanBenefits',
                'checkProcedureCoverage',
                'isProcedureCovered',
                'getInsuranceDetails',
                'getDeductibleInfo',
                'checkDeductible',
                'deductibleStatus',
                'getAnnualMaxInfo',
                'checkAnnualMax',
                'getRemainingBenefits',
                'annualMaximum',
                'getCoverageBreakdown',
                'coverageDetails',
                'getCopayAndFrequencyInfo',
                'getFrequencyLimits',
                'copayInfo',
                'getWaitingPeriodInfo',
                'waitingPeriods',
                'getExclusions',
                'getEstimateExplanation',
                'estimateAccuracy',
                'whyPriceChanges',
                'getCoordinationOfBenefits',
                'dualInsurance',
                'secondaryInsurance',
                'whichInsuranceIsPrimary',
                'getPaymentInfo',
                'paymentOptions',
                'paymentPlans',
                'financing',
                'checkCoverage',

                // ===== PATIENT-SPECIFIC INSURANCE TOOLS =====
                'getBenefits',
                'getFamilyInsurance',
                'getClaims',
                'getCarriers',
                'getInsPlan',
                'getInsPlans',
                'createInsPlan',
                'updateInsPlan',
                'getInsSub',
                'getInsSubs',
                'createInsSub',
                'updateInsSub',
                'deleteInsSub',
                'getPatPlans',
                'createPatPlan',
                'updatePatPlan',
                'deletePatPlan',
                'getInsVerify',
                'getInsVerifies',
                'updateInsVerify',
                'getSubstitutionLinks',
                'createSubstitutionLink',
                'updateSubstitutionLink',
                'deleteSubstitutionLink',

                // ===== FEE SCHEDULE TOOLS =====
                'getFeeSchedules',
                'getFeeForProcedure',
                'getFeeScheduleAmounts',
                'listFeeSchedules',
                'compareProcedureFees',
                'getFees',

                // ===== COST ESTIMATION TOOLS =====
                'estimateTreatmentCost',
                'calculateOutOfPocket',

                // ===== ACCOUNT & BILLING TOOLS =====
                'getAccountAging',
                'getPatientBalances',
                'getServiceDateView',
                'getPatientAccountSummary',
                'getPayments',
                'createPayment',
                'createPaymentRefund',
                'updatePayment',
                'updatePaymentPartial',
                'getPaySplits',
                'createPaySplit',
                'updatePaySplit',
                'getPayPlan',
                'getPayPlans',
                'getPayPlanCharges',
                'createPayPlan',
                'createPayPlanDynamic',
                'updatePayPlanDynamic',
                'closePayPlan',

                // ===== STATEMENT TOOLS =====
                'getStatement',
                'getStatements',
                'createStatement',

                // ===== MEDICAL HISTORY TOOLS =====
                'getAllergies',
                'createAllergy',
                'updateAllergy',
                'deleteAllergy',
                'getDiseaseDefs',
                'getDiseases',
                'createDisease',
                'updateDisease',
                'getMedicationPat',
                'getMedicationPats',
                'createMedicationPat',
                'updateMedicationPat',
                'deleteMedicationPat',
                'getMedications',
                'createMedication',
                'getPatientInfo',
                'getPatientRaces',

                // ===== RECALL & SCHEDULING TOOLS =====
                'Recalls GET',
                'Recalls GET List',
                'Recalls POST (create)',
                'Recalls PUT (update)',
                'Recalls PUT Status',
                'Recalls PUT SwitchType',
                'RecallTypes GET (single)',
                'RecallTypes GET (multiple)',
                'Schedules GET (single)',
                'Schedules GET (multiple)',
                'ScheduleOps GET',
                'getOperatory',
                'getOperatories',

                // ===== PROVIDER & STAFF TOOLS =====
                'Providers GET (single)',
                'Providers GET (multiple)',
                'Providers POST (create)',
                'Providers PUT (update)',
                'Employees GET (single)',
                'Employees GET (multiple)',
                'Userods GET',
                'Userods POST (create)',
                'Userods PUT (update)',
                'UserGroups GET',
                'UserGroupAttaches GET',

                // ===== LAB & REFERRAL TOOLS =====
                'getLabCase',
                'getLabCases',
                'createLabCase',
                'updateLabCase',
                'deleteLabCase',
                'getLaboratory',
                'getLaboratories',
                'createLaboratory',
                'updateLaboratory',
                'getLabTurnaround',
                'getLabTurnarounds',
                'createLabTurnaround',
                'updateLabTurnaround',
                'Referrals GET (single)',
                'Referrals GET (multiple)',
                'Referrals POST (create)',
                'Referrals PUT (update)',
                'RefAttaches GET',
                'RefAttaches POST (create)',
                'RefAttaches PUT (update)',
                'RefAttaches DELETE',

                // ===== PERIODONTAL TOOLS =====
                'getPerioExams',
                'getPerioExam',
                'createPerioExam',
                'updatePerioExam',
                'deletePerioExam',
                'getPerioMeasures',
                'createPerioMeasure',
                'updatePerioMeasure',
                'deletePerioMeasure',

                // ===== DOCUMENT & FORM TOOLS =====
                'getSheets',
                'createSheet',
                'downloadSheetSftp',
                'getSheetField',
                'getSheetFields',
                'updateSheetField',
                'SheetDefs GET (single)',
                'SheetDefs GET (multiple)',
                'Documents GET (single)',
                'Documents GET (multiple)',
                'Documents POST (create)',
                'Documents PUT (update)',
                'Documents DELETE',

                // ===== TASK & COMMUNICATION TOOLS =====
                'Tasks GET (single)',
                'Tasks GET (multiple)',
                'Tasks POST (create)',
                'Tasks PUT (update)',
                'TaskLists GET',
                'TaskNotes GET (single)',
                'TaskNotes GET (multiple)',
                'TaskNotes POST (create)',
                'TaskNotes PUT (update)',
                'CommLogs GET (single)',
                'CommLogs GET (multiple)',
                'CommLogs POST (create)',
                'CommLogs PUT (update)',
                'CommLogs DELETE',

                // ===== PATIENT FIELD TOOLS =====
                'getPatFieldDefs',
                'createPatFieldDef',
                'updatePatFieldDef',
                'deletePatFieldDef',
                'getPatField',
                'getPatFields',
                'createPatField',
                'updatePatField',
                'deletePatField',
                'getPatientNote',
                'getPatientNotes',
                'updatePatientNote',

                // ===== PHARMACY & PRESCRIPTION TOOLS =====
                'getPharmacy',
                'getPharmacies',
                'RxPats GET (single)',
                'RxPats GET (multiple)',

                // ===== REPORT TOOLS =====
                'Reports GET Aging',
                'Reports GET FinanceCharges',
                'SecurityLogs GET',

                // ===== MISCELLANEOUS TOOLS =====
                'getSignalods',
                'createSubscription',
                'getSubscriptions',
                'updateSubscription',
                'deleteSubscription',
                'ToothInitials GET',
                'ToothInitials POST (create)',
                'ToothInitials DELETE',
                'QuickPasteNotes GET (single)',
                'QuickPasteNotes GET (multiple)',
                'getPopups',
                'createPopup',
                'updatePopup',
                'getPreferences',
                'transferToHuman',
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

══════════════════════════════════════════════════════════════════════════════
                     COMMON PARAMETER EXAMPLES
══════════════════════════════════════════════════════════════════════════════

INSURANCE LOOKUP (no PatNum needed):
- Insurance name only: {"insuranceName": "Delta Dental"}
- With group number: {"insuranceName": "Cigna", "groupNumber": "12345"}
- Selecting from list: {"insuranceName": "MetLife", "groupName": "ACME CORP"}

PATIENT LOOKUP:
- {"LName": "Smith", "FName": "John", "Birthdate": "1990-01-15"}

APPOINTMENT BOOKING:
- {"PatNum": 123, "Reason": "Crown", "Date": "2024-12-20 09:00:00", "OpName": "ONLINE_BOOKING_MAJOR"}

PROCEDURE LOOKUP:
- {"PatNum": 123, "ProcStatus": "TP"}

IMPORTANT NOTES:
- When user provides group number AND carrier name, include BOTH parameters
- When user selects a plan from a list, use insuranceName + groupName
- Date formats are flexible - system normalizes automatically`,
                properties: {
                  // ===== PATIENT IDENTIFIERS =====
                  PatNum: {
                    type: 'integer',
                    description: 'Patient number (unique ID). Required for most patient-specific tools.',
                  },
                  LName: {
                    type: 'string',
                    description: 'Patient last name. Required for searchPatients and createPatient.',
                  },
                  FName: {
                    type: 'string',
                    description: 'Patient first name. Required for searchPatients and createPatient.',
                  },
                  MiddleI: {
                    type: 'string',
                    description: 'Patient middle initial.',
                  },
                  Preferred: {
                    type: 'string',
                    description: 'Patient preferred/nickname.',
                  },
                  Birthdate: {
                    type: 'string',
                    description: 'Date of birth. Accepts: YYYY-MM-DD, MM/DD/YYYY, "July 11, 1984", etc.',
                  },
                  Gender: {
                    type: 'string',
                    description: 'Patient gender.',
                  },

                  // ===== CONTACT INFO =====
                  WirelessPhone: {
                    type: 'string',
                    description: 'Mobile phone number.',
                  },
                  HmPhone: {
                    type: 'string',
                    description: 'Home phone number.',
                  },
                  WkPhone: {
                    type: 'string',
                    description: 'Work phone number.',
                  },
                  Email: {
                    type: 'string',
                    description: 'Email address.',
                  },
                  Address: {
                    type: 'string',
                    description: 'Street address line 1.',
                  },
                  Address2: {
                    type: 'string',
                    description: 'Street address line 2.',
                  },
                  City: {
                    type: 'string',
                    description: 'City.',
                  },
                  State: {
                    type: 'string',
                    description: 'State abbreviation.',
                  },
                  Zip: {
                    type: 'string',
                    description: 'ZIP/postal code.',
                  },

                  // ===== APPOINTMENT PARAMETERS =====
                  AptNum: {
                    type: 'integer',
                    description: 'Appointment number. Required for reschedule/cancel.',
                  },
                  appointmentType: {
                    type: 'string',
                    description: 'Appointment type label for getClinicAppointmentTypes. Examples: "New Patient", "Cleaning", "Crown"',
                  },
                  Date: {
                    type: 'string',
                    description: 'Appointment datetime. Format: YYYY-MM-DD HH:mm:ss',
                  },
                  NewDateTime: {
                    type: 'string',
                    description: 'New datetime for rescheduling. Format: YYYY-MM-DD HH:mm:ss',
                  },
                  Reason: {
                    type: 'string',
                    description: 'Appointment reason/purpose.',
                  },
                  OpName: {
                    type: 'string',
                    description: 'Operatory name: ONLINE_BOOKING_EXAM, ONLINE_BOOKING_MINOR, ONLINE_BOOKING_MAJOR',
                  },
                  Note: {
                    type: 'string',
                    description: 'Additional notes.',
                  },
                  SendToUnscheduledList: {
                    type: 'boolean',
                    description: 'Add to unscheduled list when cancelling. Default: true',
                  },
                  ProvNum: {
                    type: 'integer',
                    description: 'Provider number.',
                  },
                  OperatoryNum: {
                    type: 'integer',
                    description: 'Operatory number.',
                  },
                  DateStart: {
                    type: 'string',
                    description: 'Start date for date range queries.',
                  },
                  DateEnd: {
                    type: 'string',
                    description: 'End date for date range queries.',
                  },

                  // ===== PROCEDURE PARAMETERS =====
                  ProcNum: {
                    type: 'integer',
                    description: 'Procedure number.',
                  },
                  ProcStatus: {
                    type: 'string',
                    description: 'Procedure status: TP (treatment-planned), C (complete), EC (existing current).',
                  },
                  ProcDate: {
                    type: 'string',
                    description: 'Procedure date.',
                  },
                  CodeNum: {
                    type: 'integer',
                    description: 'Procedure code number.',
                  },
                  procCode: {
                    type: 'string',
                    description: 'CDT procedure code (e.g., D2750 for crown).',
                  },
                  procedureCode: {
                    type: 'string',
                    description: 'Alias for procCode.',
                  },
                  ProcFee: {
                    type: 'number',
                    description: 'Procedure fee amount.',
                  },
                  ToothNum: {
                    type: 'string',
                    description: 'Tooth number.',
                  },
                  Surf: {
                    type: 'string',
                    description: 'Surface(s) for the procedure.',
                  },

                  // ===== TREATMENT PLAN PARAMETERS =====
                  TreatPlanNum: {
                    type: 'integer',
                    description: 'Treatment plan number.',
                  },
                  Heading: {
                    type: 'string',
                    description: 'Treatment plan heading/title.',
                  },
                  TPStatus: {
                    type: 'string',
                    description: 'Treatment plan status.',
                  },
                  Priority: {
                    type: 'integer',
                    description: 'Priority level.',
                  },

                  // ===== INSURANCE LOOKUP PARAMETERS (NO PatNum needed) =====
                  insuranceName: {
                    type: 'string',
                    description: 'Insurance carrier name. Case-insensitive. Examples: Delta Dental, Cigna, Aetna, BCBS, MetLife, Guardian, Humana, United Healthcare.',
                  },
                  groupName: {
                    type: 'string',
                    description: 'Employer/group name. Use when selecting from a list of plans.',
                  },
                  groupNumber: {
                    type: 'string',
                    description: 'Group number from insurance card. Include with insuranceName for best results.',
                  },
                  procedure: {
                    type: 'string',
                    description: 'Procedure name in natural language: cleaning, crown, root canal, filling, extraction, implant, dentures, braces, etc.',
                  },
                  procedureName: {
                    type: 'string',
                    description: 'Alias for procedure.',
                  },

                  // ===== PATIENT-SPECIFIC INSURANCE PARAMETERS =====
                  PlanNum: {
                    type: 'integer',
                    description: 'Insurance plan number.',
                  },
                  PatPlanNum: {
                    type: 'integer',
                    description: 'Patient plan assignment number.',
                  },
                  InsSubNum: {
                    type: 'integer',
                    description: 'Insurance subscriber number.',
                  },
                  CarrierNum: {
                    type: 'integer',
                    description: 'Carrier number.',
                  },
                  ClaimStatus: {
                    type: 'string',
                    description: 'Claim status filter.',
                  },
                  Ordinal: {
                    type: 'integer',
                    description: 'Insurance ordinal: 1=primary, 2=secondary.',
                  },
                  Relationship: {
                    type: 'string',
                    description: 'Relationship to subscriber.',
                  },

                  // ===== FEE SCHEDULE PARAMETERS =====
                  FeeSchedNum: {
                    type: 'integer',
                    description: 'Fee schedule number.',
                  },
                  feeSchedNum: {
                    type: 'integer',
                    description: 'Alias for FeeSchedNum.',
                  },
                  feeSchedule: {
                    type: 'string',
                    description: 'Fee schedule name.',
                  },
                  feeScheduleName: {
                    type: 'string',
                    description: 'Alias for feeSchedule.',
                  },

                  // ===== ACCOUNT PARAMETERS =====
                  isFamily: {
                    type: 'boolean',
                    description: 'Include family members in query.',
                  },
                  PayNum: {
                    type: 'integer',
                    description: 'Payment number.',
                  },
                  PayAmt: {
                    type: 'number',
                    description: 'Payment amount.',
                  },
                  PayDate: {
                    type: 'string',
                    description: 'Payment date.',
                  },
                  PayType: {
                    type: 'string',
                    description: 'Payment type.',
                  },
                  PayNote: {
                    type: 'string',
                    description: 'Payment note.',
                  },
                  CheckNum: {
                    type: 'string',
                    description: 'Check number.',
                  },
                  SplitAmt: {
                    type: 'number',
                    description: 'Payment split amount.',
                  },
                  StatementNum: {
                    type: 'integer',
                    description: 'Statement number.',
                  },
                  DateSent: {
                    type: 'string',
                    description: 'Date statement was sent.',
                  },

                  // ===== MEDICAL HISTORY PARAMETERS =====
                  AllergyNum: {
                    type: 'integer',
                    description: 'Allergy record number.',
                  },
                  AllergyDefNum: {
                    type: 'integer',
                    description: 'Allergy definition number.',
                  },
                  Reaction: {
                    type: 'string',
                    description: 'Allergy reaction description.',
                  },
                  StatusIsActive: {
                    type: 'boolean',
                    description: 'Whether allergy/condition is active.',
                  },
                  DiseaseNum: {
                    type: 'integer',
                    description: 'Disease record number.',
                  },
                  DiseaseDefNum: {
                    type: 'integer',
                    description: 'Disease definition number.',
                  },
                  ProbStatus: {
                    type: 'string',
                    description: 'Problem status.',
                  },
                  MedicationNum: {
                    type: 'integer',
                    description: 'Medication number.',
                  },
                  MedicationPatNum: {
                    type: 'integer',
                    description: 'Patient medication record number.',
                  },
                  PatNote: {
                    type: 'string',
                    description: 'Patient-specific medication note.',
                  },

                  // ===== RECALL PARAMETERS =====
                  RecallNum: {
                    type: 'integer',
                    description: 'Recall number.',
                  },
                  RecallTypeNum: {
                    type: 'integer',
                    description: 'Recall type number.',
                  },
                  DateScheduled: {
                    type: 'string',
                    description: 'Scheduled date for recall.',
                  },
                  DateDue: {
                    type: 'string',
                    description: 'Due date for recall.',
                  },

                  // ===== SCHEDULE PARAMETERS =====
                  ScheduleNum: {
                    type: 'integer',
                    description: 'Schedule number.',
                  },
                  date: {
                    type: 'string',
                    description: 'Single date for schedule query.',
                  },
                  dateStart: {
                    type: 'string',
                    description: 'Start date for schedule range.',
                  },
                  dateEnd: {
                    type: 'string',
                    description: 'End date for schedule range.',
                  },
                  SchedType: {
                    type: 'string',
                    description: 'Schedule type: Practice, Provider, Blockout, Employee, WebSchedASAP.',
                  },
                  EmployeeNum: {
                    type: 'integer',
                    description: 'Employee number.',
                  },

                  // ===== LAB PARAMETERS =====
                  LabCaseNum: {
                    type: 'integer',
                    description: 'Lab case number.',
                  },
                  LaboratoryNum: {
                    type: 'integer',
                    description: 'Laboratory number.',
                  },
                  DateTimeSent: {
                    type: 'string',
                    description: 'Date/time lab case was sent.',
                  },
                  DateTimeRecd: {
                    type: 'string',
                    description: 'Date/time lab case was received.',
                  },
                  Instructions: {
                    type: 'string',
                    description: 'Lab case instructions.',
                  },

                  // ===== REFERRAL PARAMETERS =====
                  ReferralNum: {
                    type: 'integer',
                    description: 'Referral number.',
                  },
                  RefAttachNum: {
                    type: 'integer',
                    description: 'Referral attachment number.',
                  },
                  RefType: {
                    type: 'string',
                    description: 'Referral type.',
                  },

                  // ===== PERIODONTAL PARAMETERS =====
                  PerioExamNum: {
                    type: 'integer',
                    description: 'Perio exam number.',
                  },
                  PerioMeasureNum: {
                    type: 'integer',
                    description: 'Perio measurement number.',
                  },
                  ExamDate: {
                    type: 'string',
                    description: 'Exam date.',
                  },
                  SequenceType: {
                    type: 'string',
                    description: 'Perio measurement sequence type.',
                  },
                  IntTooth: {
                    type: 'integer',
                    description: 'Tooth number for perio measurement.',
                  },
                  ToothValue: {
                    type: 'integer',
                    description: 'Perio measurement tooth value.',
                  },
                  MBvalue: { type: 'integer', description: 'Mesio-buccal value.' },
                  Bvalue: { type: 'integer', description: 'Buccal value.' },
                  DBvalue: { type: 'integer', description: 'Disto-buccal value.' },
                  MLvalue: { type: 'integer', description: 'Mesio-lingual value.' },
                  Lvalue: { type: 'integer', description: 'Lingual value.' },
                  DLvalue: { type: 'integer', description: 'Disto-lingual value.' },

                  // ===== DOCUMENT/SHEET PARAMETERS =====
                  SheetNum: {
                    type: 'integer',
                    description: 'Sheet number.',
                  },
                  SheetDefNum: {
                    type: 'integer',
                    description: 'Sheet definition number.',
                  },
                  SheetType: {
                    type: 'string',
                    description: 'Sheet type.',
                  },
                  SheetFieldNum: {
                    type: 'integer',
                    description: 'Sheet field number.',
                  },
                  FieldValue: {
                    type: 'string',
                    description: 'Field value.',
                  },
                  DocNum: {
                    type: 'integer',
                    description: 'Document number.',
                  },
                  DocCategory: {
                    type: 'integer',
                    description: 'Document category.',
                  },
                  fileName: {
                    type: 'string',
                    description: 'File name for uploads.',
                  },
                  fileData: {
                    type: 'string',
                    description: 'Base64 encoded file data.',
                  },
                  Description: {
                    type: 'string',
                    description: 'Description text.',
                  },

                  // ===== TASK PARAMETERS =====
                  TaskNum: {
                    type: 'integer',
                    description: 'Task number.',
                  },
                  TaskListNum: {
                    type: 'integer',
                    description: 'Task list number.',
                  },
                  TaskNoteNum: {
                    type: 'integer',
                    description: 'Task note number.',
                  },
                  Descript: {
                    type: 'string',
                    description: 'Task description.',
                  },
                  TaskStatus: {
                    type: 'string',
                    description: 'Task status.',
                  },
                  DateTask: {
                    type: 'string',
                    description: 'Task date.',
                  },
                  UserNum: {
                    type: 'integer',
                    description: 'User number.',
                  },

                  // ===== COMMUNICATION PARAMETERS =====
                  CommlogNum: {
                    type: 'integer',
                    description: 'Communication log number.',
                  },
                  CommDateTime: {
                    type: 'string',
                    description: 'Communication date/time.',
                  },
                  Mode_: {
                    type: 'string',
                    description: 'Communication mode: None, Email, Phone, InPerson, Letter, Text.',
                  },

                  // ===== PATIENT FIELD PARAMETERS =====
                  PatFieldNum: {
                    type: 'integer',
                    description: 'Patient field number.',
                  },
                  PatFieldDefNum: {
                    type: 'integer',
                    description: 'Patient field definition number.',
                  },
                  FieldName: {
                    type: 'string',
                    description: 'Custom field name.',
                  },
                  FieldType: {
                    type: 'string',
                    description: 'Custom field type.',
                  },

                  // ===== MISC PARAMETERS =====
                  ClinicNum: {
                    type: 'integer',
                    description: 'Clinic number.',
                  },
                  clinicId: {
                    type: 'string',
                    description: 'Clinic ID (auto-filled from session).',
                  },
                  DateTStamp: {
                    type: 'string',
                    description: 'Timestamp for filtering changed records.',
                  },
                  Offset: {
                    type: 'integer',
                    description: 'Pagination offset.',
                  },
                  SigDateTime: {
                    type: 'string',
                    description: 'Signal datetime for getSignalods.',
                  },
                  SubscriptionNum: {
                    type: 'integer',
                    description: 'Subscription number.',
                  },
                  EndPointUrl: {
                    type: 'string',
                    description: 'Webhook endpoint URL.',
                  },
                  WorkstationName: {
                    type: 'string',
                    description: 'Workstation name for subscription.',
                  },
                  Enabled: {
                    type: 'boolean',
                    description: 'Whether subscription is enabled.',
                  },
                  ToothInitialNum: {
                    type: 'integer',
                    description: 'Tooth initial number.',
                  },
                  InitialType: {
                    type: 'string',
                    description: 'Tooth initial type.',
                  },
                  QuickPasteNoteNum: {
                    type: 'integer',
                    description: 'Quick paste note number.',
                  },
                  QuickPasteCatNum: {
                    type: 'integer',
                    description: 'Quick paste category number.',
                  },
                  SubstitutionLinkNum: {
                    type: 'integer',
                    description: 'Substitution link number.',
                  },
                  SubstitutionCode: {
                    type: 'string',
                    description: 'Substitution procedure code.',
                  },
                  ProcTPNum: {
                    type: 'integer',
                    description: 'Procedure treatment plan number.',
                  },
                  PermType: {
                    type: 'string',
                    description: 'Permission type for security logs.',
                  },
                  IsHidden: {
                    type: 'boolean',
                    description: 'Whether record is hidden.',
                  },

                  // ===== COST ESTIMATION PARAMETERS =====
                  patientName: {
                    type: 'string',
                    description: 'Patient full name for benefit lookup. Format: "First Last".',
                  },
                  patientDOB: {
                    type: 'string',
                    description: 'Patient DOB for verification.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful operation',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['SUCCESS', 'FAILURE'],
                      description: 'Operation status',
                    },
                    directAnswer: {
                      type: 'string',
                      description: 'Pre-formatted answer to give to user. USE THIS IN YOUR RESPONSE!',
                    },
                    lookupStatus: {
                      type: 'string',
                      description: 'For insurance lookups: COVERAGE_DETAILS_FOUND or PLAN_FOUND_BUT_COVERAGE_NOT_RECORDED',
                    },
                    data: {
                      type: 'object',
                      description: 'Response data specific to the tool',
                    },
                    message: {
                      type: 'string',
                      description: 'Human-readable message',
                    },
                    totalCount: {
                      type: 'integer',
                      description: 'Total count of results (when paginated)',
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Bad request - missing or invalid parameters',
          },
          '404': {
            description: 'Resource not found',
          },
          '500': {
            description: 'Server error',
          },
        },
      },
    },
  },
};

export default OPENAPI_SCHEMA; 1032

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

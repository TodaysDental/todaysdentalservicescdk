/*
 * Enhanced ToothFairy AI ChatBot - WebSocket Message Handler
 * 
 * PRODUCTION CONFIGURATION - CLAUDE 3.5 SONNET
 * ================================================
 * 
 * Features:
 * - Complete OpenDental API integration
 * - Advanced error handling and logging
 * - Smart throttling and rate limiting
 * - Comprehensive appointment management
 * - Real-time patient data access
 * - Modern security and performance optimizations
 */

import { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import axios from 'axios';
import clinicsData from '../../infrastructure/configs/clinics.json';
import { buildCorsHeaders } from '../../shared/utils/cors';

// ========================================================================
// CONFIGURATION & INITIALIZATION
// ========================================================================

const CONFIG = {
  AWS_REGION: 'us-east-1',
  ENVIRONMENT: process.env.NODE_ENV || 'production',
  DEBUG_MODE: process.env.DEBUG_MODE === 'true',
  
  // API Configuration
  OPEN_DENTAL_API_URL: 'https://api.opendental.com/api/v1',
  API_TIMEOUT: 15000,
  MAX_API_RETRIES: 3,
  
  // Claude Configuration
  MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
  MAX_BEDROCK_RETRIES: 4,
  
  // Chat Configuration
  MAX_CHAT_LOOPS: 8,
  MAX_HISTORY_LENGTH: 12,
  REQUEST_TIMEOUT: 25000,
  
  // Performance
  ENABLE_FILLER_RESPONSES: true,
  FILLER_RESPONSE_THRESHOLD_MS: 800,
  THROTTLE_INTERVAL: 500,
  
  // Appointment Configuration
  APPOINTMENT_DURATIONS: {
    ONLINE_BOOKING_EXAM: 30,
    ONLINE_BOOKING_MAJOR: 60,
    ONLINE_BOOKING_MINOR: 30
  },
  OPERATORY_NAMES: {
    EXAM: 'ONLINE_BOOKING_EXAM',
    MAJOR: 'ONLINE_BOOKING_MAJOR',
    MINOR: 'ONLINE_BOOKING_MINOR'
  }
};

// Default operatory number mapping (inferred). If you have clinic-specific operatory numbers,
// extend clinics.json and use that mapping instead.
const DEFAULT_OPERATORY_MAP: Record<string, number> = {
  ONLINE_BOOKING_EXAM: 1,
  ONLINE_BOOKING_MAJOR: 2,
  ONLINE_BOOKING_MINOR: 3,
  EXAM: 1,
  MAJOR: 2,
  MINOR: 3
};

function getOperatoryNumber(opInput: any, clinicConfig?: ClinicConfig): number | null {
  if (opInput == null) return null;

  // If already a number or numeric string
  if (typeof opInput === 'number' && !Number.isNaN(opInput)) return opInput;
  if (typeof opInput === 'string') {
    const n = parseInt(opInput, 10);
    if (!Number.isNaN(n)) return n;

    // Normalize and lookup by name
    const key = opInput.trim().toUpperCase();
    if (DEFAULT_OPERATORY_MAP[key]) return DEFAULT_OPERATORY_MAP[key];

    // Try matching known configured names
    const clinicOpKey = Object.keys(DEFAULT_OPERATORY_MAP).find(k => k.toUpperCase() === key);
    if (clinicOpKey) return DEFAULT_OPERATORY_MAP[clinicOpKey];
  }

  return null;
}

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ 
  region: CONFIG.AWS_REGION,
  maxAttempts: 3
});

const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false
  }
});

const bedrockClient = new BedrockRuntimeClient({ 
  region: CONFIG.AWS_REGION,
  maxAttempts: CONFIG.MAX_BEDROCK_RETRIES
});

// Environment variables
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE!;
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE!;
const CLINIC_PRICING_TABLE = process.env.CLINIC_PRICING_TABLE!;
const CLINIC_INSURANCE_TABLE = process.env.CLINIC_INSURANCE_TABLE!;

// ========================================================================
// TYPES & INTERFACES
// ========================================================================

interface ClinicConfig {
  clinicId: string;
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  clinicEmail: string;
  clinicFax?: string;
  developerKey: string;
  customerKey: string;
  websiteLink?: string;
  clinicHours?: Record<string, string>;
  pricing?: Array<{
    category: string;
    minPrice: number;
    maxPrice: number;
  }>;
  insurance?: Record<string, string[]>;
}

interface SessionState {
  PatNum?: string;
  FName?: string;
  LName?: string;
  Birthdate?: string;
  IsNewPatient?: boolean;
  ProcedureDescripts?: string;
  ProcNums?: string;
  AppointmentType?: string;
  clinicId: string;
  sessionId: string;
  history?: string;
  conversationStep?: 'IDENTIFYING_PATIENT' | 'CHECKING_PROCEDURES' | 'CONFIRMING_PROCEDURES' | 'SCHEDULING_APPOINTMENT' | 'RESCHEDULE_SELECT' | 'RESCHEDULE_DATETIME' | 'CANCEL_SELECT' | 'CANCEL_CONFIRM' | 'COMPLETE';
  proceduresChecked?: boolean;
  forceScheduleNow?: boolean;
}

interface WebSocketEvent {
  requestContext: {
    connectionId: string;
    domainName: string;
    stage: string;
    apiId: string;
    identity?: {
      sourceIp?: string;
      userAgent?: string;
    };
  };
  body: string;
  headers?: Record<string, string>;
}

// ========================================================================
// ERROR HANDLING & LOGGING
// ========================================================================

class ApiError extends Error {
  public readonly timestamp: string;
  public readonly errorId: string;

  constructor(
    message: string, 
    public statusCode: number, 
    public details: any = {},
    public context: any = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.timestamp = new Date().toISOString();
    this.errorId = uuidv4();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      context: this.context,
      timestamp: this.timestamp,
      errorId: this.errorId,
      stack: CONFIG.DEBUG_MODE ? this.stack : undefined
    };
  }
}

class Logger {
  private static log(level: string, message: string, context: any = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      environment: CONFIG.ENVIRONMENT,
      ...(context.sessionId && { sessionId: context.sessionId }),
      ...(context.clinicId && { clinicId: context.clinicId })
    };

    if (CONFIG.ENVIRONMENT === 'production') {
      console.log(JSON.stringify(logEntry));
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`, context);
    }
  }

  static info(message: string, context: any = {}) {
    this.log('info', message, context);
  }

  static warn(message: string, context: any = {}) {
    this.log('warn', message, context);
  }

  static error(message: string, error?: Error | any, context: any = {}) {
    this.log('error', message, {
      ...context,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: CONFIG.DEBUG_MODE ? error.stack : undefined
      } : error
    });
  }

  static debug(message: string, context: any = {}) {
    if (CONFIG.DEBUG_MODE) {
      this.log('debug', message, context);
    }
  }
}

// ========================================================================
// OPENDENTAL API CLIENT
// ========================================================================

class OpenDentalClient {
  private client: any;

  constructor(developerKey: string, customerKey: string) {
    this.client = axios.create({
      baseURL: CONFIG.OPEN_DENTAL_API_URL,
      headers: {
        'Authorization': `ODFHIR ${developerKey}/${customerKey}`,
        'Content-Type': 'application/json'
      },
      timeout: CONFIG.API_TIMEOUT
    });
  }

  async request(method: string, endpoint: string, { params, data }: any = {}) {
    for (let attempt = 1; attempt <= CONFIG.MAX_API_RETRIES; attempt++) {
      try {
        const config: any = { method, url: endpoint };
        if (params) config.params = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
        if (data) config.data = data;
        
        const response = await this.client.request(config);
        Logger.debug(`OpenDental API ${method} ${endpoint} succeeded`, {
          attempt,
          status: response.status,
          dataLength: JSON.stringify(response.data).length
        });
        
        return response.data || { status: 'success', statusCode: response.status };
      } catch (error: any) {
        const status = error.response?.status;
        const errorDetails = error.response?.data || {};
        const isRetryable = status >= 500 || status === 429 || ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
        
        Logger.warn(`OpenDental API ${method} ${endpoint} attempt ${attempt} failed`, {
          error: error.message,
          status,
          isRetryable,
          response: errorDetails,
          errorCode: error.code,
          errorType: error.constructor?.name
        });
        
        if (!isRetryable || attempt === CONFIG.MAX_API_RETRIES) {
          throw new ApiError(
            error.response?.data?.message || `OpenDental API call failed: ${error.message}`,
            status || 500,
            {
              response: errorDetails,
              endpoint,
              method,
              errorCode: error.code,
              attempt,
              isRetryable
            }
          );
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }
}

// ========================================================================
// DATA FETCHING FUNCTIONS
// ========================================================================

async function getClinicHours(clinicId: string): Promise<Record<string, string>> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: CLINIC_HOURS_TABLE,
      Key: { clinicId }
    }));
    
    if (response.Item?.hours) {
      return response.Item.hours;
    }
  } catch (error) {
    Logger.error('Failed to fetch clinic hours', error, { clinicId });
  }
  
  // Default hours
  return {
    monday: '9:00 AM - 5:00 PM',
    tuesday: '9:00 AM - 5:00 PM',
    wednesday: '9:00 AM - 5:00 PM',
    thursday: '9:00 AM - 5:00 PM',
    friday: '9:00 AM - 5:00 PM',
    saturday: 'Closed',
    sunday: 'Closed'
  };
}

async function getClinicPricing(clinicId: string): Promise<Array<{category: string; minPrice: number; maxPrice: number}>> {
  try {
    const response = await docClient.send(new QueryCommand({
      TableName: CLINIC_PRICING_TABLE,
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': clinicId },
      Limit: 100
    }));
    
    if (response.Items && response.Items.length > 0) {
      return response.Items.map(item => ({
        category: item.category,
        minPrice: item.minPrice || 0,
        maxPrice: item.maxPrice || 0
      }));
    }
  } catch (error) {
    Logger.error('Failed to fetch clinic pricing', error, { clinicId });
  }
  
  // Default pricing
  return [
    { category: "Cleaning", minPrice: 108, maxPrice: 145 },
    { category: "Exam", minPrice: 85, maxPrice: 252 },
    { category: "X-Ray", minPrice: 34, maxPrice: 635 },
    { category: "Root Canal", minPrice: 1336, maxPrice: 1790 },
    { category: "Crown", minPrice: 683, maxPrice: 1943 },
    { category: "Filling", minPrice: 207, maxPrice: 390 }
  ];
}

async function getClinicInsurance(clinicId: string): Promise<Record<string, string[]>> {
  try {
    const response = await docClient.send(new QueryCommand({
      TableName: CLINIC_INSURANCE_TABLE,
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': clinicId },
      Limit: 100
    }));
    
    if (response.Items && response.Items.length > 0) {
      const groupedByProvider = new Map<string, string[]>();
      
      for (const item of response.Items) {
        const provider = item.insuranceProvider;
        if (!groupedByProvider.has(provider)) {
          groupedByProvider.set(provider, []);
        }
        
        if (item.planName) {
          groupedByProvider.get(provider)!.push(item.planName);
        }
      }
      
      return Object.fromEntries(groupedByProvider.entries());
    }
  } catch (error) {
    Logger.error('Failed to fetch clinic insurance', error, { clinicId });
  }
  
  // Default insurance
  return {
    "Aetna": ["Aetna Dental PPO", "Aetna Medicare Advantage Dental"],
    "Humana": ["Humana Dental PPO", "Humana One"],
    "UnitedHealthcare": ["AARP Medicare Complete", "Medicare Silver"],
    "Medicaid": ["medicaid"],
    "Medicare": ["medicare"],
    "Delta Dental": ["Delta Dental Premier", "Delta Dental PPO"]
  };
}

async function getEnhancedClinicConfig(clinicId: string): Promise<ClinicConfig | null> {
  const staticConfig = clinicsData.find(clinic => clinic.clinicId === clinicId);
  if (!staticConfig) {
    return null;
  }
  
  const [hours, pricing, insurance] = await Promise.all([
    getClinicHours(clinicId),
    getClinicPricing(clinicId),
    getClinicInsurance(clinicId)
  ]);
  
  return {
    clinicId: staticConfig.clinicId,
    clinicName: staticConfig.clinicName,
    clinicAddress: staticConfig.clinicAddress,
    clinicPhone: staticConfig.clinicPhone,
    clinicEmail: staticConfig.clinicEmail,
    clinicFax: staticConfig.clinicFax || staticConfig.clinicPhone,
    developerKey: staticConfig.developerKey,
    customerKey: staticConfig.customerKey,
    websiteLink: staticConfig.websiteLink,
    clinicHours: hours,
    pricing,
    insurance
  };
}

// ========================================================================
// OPENDENTAL TOOL DEFINITIONS
// ========================================================================

const OPEN_DENTAL_TOOLS = [
  {
    name: 'getPatientByPatNum',
    description: 'Retrieves a single patient by PatNum.',
    input_schema: { 
      type: 'object', 
      properties: { PatNum: { type: 'number' } }, 
      required: ['PatNum'] 
    }
  },
  {
    name: 'searchPatients',
    description: 'Searches for patients by name and birthdate.',
    input_schema: {
      type: 'object',
      properties: {
        LName: { type: 'string', description: 'Last name' },
        FName: { type: 'string', description: 'First name' },
        Birthdate: { type: 'string', description: 'YYYY-MM-DD format' }
      },
      required: ['LName', 'FName', 'Birthdate']
    }
  },
  {
    name: 'createPatient',
    description: 'Creates a new patient record.',
    input_schema: {
      type: 'object',
      properties: {
        LName: { type: 'string', description: 'Last name' },
        FName: { type: 'string', description: 'First name' },
        WirelessPhone: { type: 'string', description: 'Phone number' },
        Birthdate: { type: 'string', description: 'YYYY-MM-DD format' }
      },
      required: ['LName', 'FName', 'Birthdate']
    }
  },
  {
    name: 'getProcedureLogs',
    description: 'Retrieves procedure logs for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        ProcStatus: { type: 'string', description: 'e.g., TP for Treatment Planned' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'scheduleAppointment',
    description: 'Schedules an appointment after all details are confirmed.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        Reason: { type: 'string', description: 'Appointment reason' },
        Date: { type: 'string', description: 'YYYY-MM-DD HH:mm:ss format' },
        OpName: { type: 'string', description: 'Operatory name' },
        Note: { type: 'string', description: 'Additional notes' }
      },
      required: ['PatNum', 'Reason', 'Date', 'OpName']
    }
  },
  {
    name: 'getUpcomingAppointments',
    description: 'Retrieves upcoming appointments for a patient.',
    input_schema: { 
      type: 'object', 
      properties: { PatNum: { type: 'number' } }, 
      required: ['PatNum'] 
    }
  },
  {
    name: 'rescheduleAppointment',
    description: 'Reschedules an existing appointment.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        NewDateTime: { type: 'string', description: 'New date/time in YYYY-MM-DD HH:mm:ss format' },
        Note: { type: 'string', description: 'Reschedule reason' }
      },
      required: ['AptNum', 'NewDateTime']
    }
  },
  {
    name: 'cancelAppointment',
    description: 'Cancels an existing appointment.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        SendToUnscheduledList: { type: 'boolean', description: 'Send to unscheduled list' },
        Note: { type: 'string', description: 'Cancellation reason' }
      },
      required: ['AptNum']
    }
  },
  {
    name: 'getTreatmentPlans',
    description: 'Retrieves treatment plans for a patient.',
    input_schema: { 
      type: 'object', 
      properties: { PatNum: { type: 'number' } }, 
      required: ['PatNum'] 
    }
  },
  {
    name: 'getAppointmentSlots',
    description: 'Gets available appointment slots.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        lengthMinutes: { type: 'number', description: 'Appointment length in minutes' }
      }
    }
  },
  {
    name: 'getAccountAging',
    description: 'Gets the Aging information for a patient and their family.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getPatientBalances',
    description: 'Gets the patient portion balances for a patient\'s family.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getServiceDateView',
    description: 'Gets a list of all charges and credits for a patient and their family.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        isFamily: { type: 'boolean', description: 'Include entire family (default: false)' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getAdjustments',
    description: 'Gets all adjustments for a specified patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        AdjType: { type: 'number', description: 'Adjustment type definition.DefNum (optional)' },
        ProcNum: { type: 'number', description: 'Procedure number to filter by (optional)' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'createAdjustment',
    description: 'Creates an adjustment for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        AdjType: { type: 'number', description: 'Adjustment type definition.DefNum' },
        AdjAmt: { type: 'number', description: 'Adjustment amount (positive for +, negative for -)' },
        AdjDate: { type: 'string', description: 'Adjustment date in YYYY-MM-DD format' },
        ProvNum: { type: 'number', description: 'Provider number (optional)' },
        ProcNum: { type: 'number', description: 'Procedure number to attach to (optional)' },
        ClinicNum: { type: 'number', description: 'Clinic number (optional)' },
        ProcDate: { type: 'string', description: 'Procedure date in YYYY-MM-DD format (optional)' },
        AdjNote: { type: 'string', description: 'Adjustment note (optional)' }
      },
      required: ['PatNum', 'AdjType', 'AdjAmt', 'AdjDate']
    }
  },
  {
    name: 'updateAdjustment',
    description: 'Updates an existing adjustment.',
    input_schema: {
      type: 'object',
      properties: {
        AdjNum: { type: 'number', description: 'Adjustment number' },
        AdjDate: { type: 'string', description: 'Adjustment date in YYYY-MM-DD format (optional)' },
        AdjAmt: { type: 'number', description: 'Adjustment amount (optional)' },
        AdjType: { type: 'number', description: 'Adjustment type definition.DefNum (optional)' },
        ProvNum: { type: 'number', description: 'Provider number (optional)' },
        AdjNote: { type: 'string', description: 'Adjustment note (optional)' },
        ProcNum: { type: 'number', description: 'Procedure number to attach to (optional)' },
        ClinicNum: { type: 'number', description: 'Clinic number (optional)' }
      },
      required: ['AdjNum']
    }
  },
  {
    name: 'getAllergies',
    description: 'Gets all allergies for a specified patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getAllergyDefs',
    description: 'Gets a list of all allergies that are assigned to patients.',
    input_schema: {
      type: 'object',
      properties: {
        Offset: { type: 'number', description: 'Offset for pagination (optional)' }
      },
      required: []
    }
  },
  {
    name: 'createAllergyDef',
    description: 'Creates a new allergy definition.',
    input_schema: {
      type: 'object',
      properties: {
        Description: { type: 'string', description: 'Allergy description/name' }
      },
      required: ['Description']
    }
  },
  {
    name: 'getAppointment',
    description: 'Gets a single appointment by AptNum.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' }
      },
      required: ['AptNum']
    }
  },
  {
    name: 'getAppointments',
    description: 'Gets multiple appointments with optional filtering.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Filter by patient number (optional)' },
        AptStatus: { type: 'string', description: 'Filter by appointment status (optional)' },
        Op: { type: 'number', description: 'Filter by operatory number (optional)' },
        date: { type: 'string', description: 'Search for a single day in YYYY-MM-DD format (optional)' },
        dateStart: { type: 'string', description: 'Search start date in YYYY-MM-DD format (optional)' },
        dateEnd: { type: 'string', description: 'Search end date in YYYY-MM-DD format (optional)' },
        ClinicNum: { type: 'number', description: 'Filter by clinic number (optional)' },
        DateTStamp: { type: 'string', description: 'Filter by timestamp (optional)' },
        AppointmentTypeNum: { type: 'number', description: 'Filter by appointment type (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getAsapAppointments',
    description: 'Gets the ASAP appointment list.',
    input_schema: {
      type: 'object',
      properties: {
        ClinicNum: { type: 'number', description: 'Clinic number (required if clinics enabled)' },
        ProvNum: { type: 'number', description: 'Provider number (optional)' },
        Offset: { type: 'number', description: 'Offset for pagination (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getSlotsWebSched',
    description: 'Gets WebSched appointment slots.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Search for a single day in YYYY-MM-DD format (optional)' },
        dateStart: { type: 'string', description: 'Search start date in YYYY-MM-DD format (optional)' },
        dateEnd: { type: 'string', description: 'Search end date in YYYY-MM-DD format (optional)' },
        ClinicNum: { type: 'number', description: 'Clinic number (required if clinics enabled)' },
        defNumApptType: { type: 'number', description: 'Appointment type definition number (optional)' },
        isNewPatient: { type: 'boolean', description: 'Is new patient (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getWebSchedAppointments',
    description: 'Gets appointments made through WebSched.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Search for a single day in YYYY-MM-DD format (optional)' },
        dateStart: { type: 'string', description: 'Search start date in YYYY-MM-DD format (optional)' },
        dateEnd: { type: 'string', description: 'Search end date in YYYY-MM-DD format (optional)' },
        DateTStamp: { type: 'string', description: 'Filter by timestamp (optional)' },
        ClinicNum: { type: 'number', description: 'Filter by clinic number (optional)' },
        Offset: { type: 'number', description: 'Offset for pagination (optional)' }
      },
      required: []
    }
  },
  {
    name: 'createAppointment',
    description: 'Creates a new appointment for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        Op: { type: 'number', description: 'Operatory number' },
        AptDateTime: { type: 'string', description: 'Appointment date/time in YYYY-MM-DD HH:mm:ss format' },
        AptStatus: { type: 'string', description: 'Appointment status (optional)' },
        Pattern: { type: 'string', description: 'Time pattern (optional)' },
        Confirmed: { type: 'number', description: 'Confirmation definition number (optional)' },
        Note: { type: 'string', description: 'Appointment note (optional)' },
        ProvNum: { type: 'number', description: 'Provider number (optional)' },
        ProvHyg: { type: 'number', description: 'Hygiene provider number (optional)' },
        ClinicNum: { type: 'number', description: 'Clinic number (optional)' },
        IsHygiene: { type: 'boolean', description: 'Is hygiene appointment (optional)' },
        DateTimeArrived: { type: 'string', description: 'Arrival time in HH:mm:ss format (optional)' },
        DateTimeSeated: { type: 'string', description: 'Seated time in HH:mm:ss format (optional)' },
        DateTimeDismissed: { type: 'string', description: 'Dismissed time in HH:mm:ss format (optional)' },
        IsNewPatient: { type: 'boolean', description: 'Is new patient (optional)' },
        Priority: { type: 'string', description: 'Priority (Normal or ASAP) (optional)' },
        AppointmentTypeNum: { type: 'number', description: 'Appointment type number (optional)' },
        SecUserNumEntry: { type: 'number', description: 'User number for entry (optional)' },
        colorOverride: { type: 'string', description: 'Color override in R,G,B format (optional)' },
        PatternSecondary: { type: 'string', description: 'Secondary pattern (optional)' }
      },
      required: ['PatNum', 'Op', 'AptDateTime']
    }
  },
  {
    name: 'createPlannedAppointment',
    description: 'Creates a planned appointment for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        AppointmentTypeNum: { type: 'number', description: 'Appointment type number (optional)' },
        procNums: { type: 'array', description: 'Array of procedure numbers (optional)' },
        Pattern: { type: 'string', description: 'Time pattern (optional)' },
        Confirmed: { type: 'number', description: 'Confirmation definition number (optional)' },
        Note: { type: 'string', description: 'Appointment note (optional)' },
        ProvNum: { type: 'number', description: 'Provider number (optional)' },
        ProvHyg: { type: 'number', description: 'Hygiene provider number (optional)' },
        ClinicNum: { type: 'number', description: 'Clinic number (optional)' },
        IsHygiene: { type: 'boolean', description: 'Is hygiene appointment (optional)' },
        IsNewPatient: { type: 'boolean', description: 'Is new patient (optional)' },
        Priority: { type: 'string', description: 'Priority (Normal or ASAP) (optional)' },
        PatternSecondary: { type: 'string', description: 'Secondary pattern (optional)' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'schedulePlannedAppointment',
    description: 'Schedules a planned appointment.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Planned appointment number' },
        AptDateTime: { type: 'string', description: 'Appointment date/time in YYYY-MM-DD HH:mm:ss format' },
        ProvNum: { type: 'number', description: 'Provider number' },
        Op: { type: 'number', description: 'Operatory number' },
        Confirmed: { type: 'number', description: 'Confirmation definition number (optional)' },
        Note: { type: 'string', description: 'Appointment note (optional)' }
      },
      required: ['AptNum', 'AptDateTime', 'ProvNum', 'Op']
    }
  },
  {
    name: 'createWebSchedAppointment',
    description: 'Creates a WebSched appointment.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        dateTimeStart: { type: 'string', description: 'Start date/time in YYYY-MM-DD HH:mm:ss format' },
        dateTimeEnd: { type: 'string', description: 'End date/time in YYYY-MM-DD HH:mm:ss format' },
        ProvNum: { type: 'number', description: 'Provider number' },
        OpNum: { type: 'number', description: 'Operatory number' },
        defNumApptType: { type: 'number', description: 'Appointment type definition number' }
      },
      required: ['PatNum', 'dateTimeStart', 'dateTimeEnd', 'ProvNum', 'OpNum', 'defNumApptType']
    }
  },
  {
    name: 'updateAppointment',
    description: 'Updates an existing appointment.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        AptStatus: { type: 'string', description: 'Appointment status (optional)' },
        Pattern: { type: 'string', description: 'Time pattern (optional)' },
        Confirmed: { type: 'number', description: 'Confirmation definition number (optional)' },
        Op: { type: 'number', description: 'Operatory number (optional)' },
        Note: { type: 'string', description: 'Appointment note (optional)' },
        ProvNum: { type: 'number', description: 'Provider number (optional)' },
        ProvHyg: { type: 'number', description: 'Hygiene provider number (optional)' },
        AptDateTime: { type: 'string', description: 'Appointment date/time (optional)' },
        ClinicNum: { type: 'number', description: 'Clinic number (optional)' },
        IsHygiene: { type: 'boolean', description: 'Is hygiene appointment (optional)' },
        DateTimeArrived: { type: 'string', description: 'Arrival time (optional)' },
        DateTimeSeated: { type: 'string', description: 'Seated time (optional)' },
        DateTimeDismissed: { type: 'string', description: 'Dismissed time (optional)' },
        IsNewPatient: { type: 'boolean', description: 'Is new patient (optional)' },
        Priority: { type: 'string', description: 'Priority (optional)' },
        AppointmentTypeNum: { type: 'number', description: 'Appointment type number (optional)' },
        UnschedStatus: { type: 'number', description: 'Unscheduled status (optional)' },
        colorOverride: { type: 'string', description: 'Color override (optional)' },
        PatternSecondary: { type: 'string', description: 'Secondary pattern (optional)' }
      },
      required: ['AptNum']
    }
  },
  {
    name: 'breakAppointment',
    description: 'Breaks an appointment.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        sendToUnscheduledList: { type: 'boolean', description: 'Send to unscheduled list' },
        breakType: { type: 'string', description: 'Break type (Missed or Cancelled) (optional)' }
      },
      required: ['AptNum', 'sendToUnscheduledList']
    }
  },
  {
    name: 'appendAppointmentNote',
    description: 'Appends a note to an appointment.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        Note: { type: 'string', description: 'Note to append' }
      },
      required: ['AptNum', 'Note']
    }
  },
  {
    name: 'updateAppointmentConfirm',
    description: 'Updates appointment confirmation status.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        confirmVal: { type: 'string', description: 'Confirmation value (None, Sent, Confirmed, Not Accepted, Failed)' },
        defNum: { type: 'number', description: 'Confirmation definition number (optional)' }
      },
      required: ['AptNum']
    }
  },
  {
    name: 'getAppointmentTypes',
    description: 'Gets a list of appointment types.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'getApptField',
    description: 'Gets an appointment field value by AptNum and FieldName.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        FieldName: { type: 'string', description: 'Field name' }
      },
      required: ['AptNum', 'FieldName']
    }
  },
  {
    name: 'setApptField',
    description: 'Sets or updates an appointment field value.',
    input_schema: {
      type: 'object',
      properties: {
        AptNum: { type: 'number', description: 'Appointment number' },
        FieldName: { type: 'string', description: 'Field name' },
        FieldValue: { type: 'string', description: 'Field value' }
      },
      required: ['AptNum', 'FieldName', 'FieldValue']
    }
  },
  {
    name: 'getBenefit',
    description: 'Gets a single benefit by BenefitNum.',
    input_schema: {
      type: 'object',
      properties: {
        BenefitNum: { type: 'number', description: 'Benefit number' }
      },
      required: ['BenefitNum']
    }
  },
  {
    name: 'getBenefits',
    description: 'Gets all benefits for a given Insurance Plan or Patient Plan.',
    input_schema: {
      type: 'object',
      properties: {
        PlanNum: { type: 'number', description: 'Insurance plan number (optional)' },
        PatPlanNum: { type: 'number', description: 'Patient plan number (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getCarrier',
    description: 'Gets a single insurance carrier by CarrierNum.',
    input_schema: {
      type: 'object',
      properties: {
        CarrierNum: { type: 'number', description: 'Carrier number' }
      },
      required: ['CarrierNum']
    }
  },
  {
    name: 'getCarriers',
    description: 'Gets a list of insurance carriers.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'getProgNotes',
    description: 'Gets the Progress Notes for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        Offset: { type: 'number', description: 'Offset for pagination (optional)' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getPatientInfo',
    description: 'Gets Patient Info for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getPlannedAppts',
    description: 'Gets Planned Appointments for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getClaimForm',
    description: 'Gets a single claimform by ClaimFormNum.',
    input_schema: {
      type: 'object',
      properties: {
        ClaimFormNum: { type: 'number', description: 'Claim form number' }
      },
      required: ['ClaimFormNum']
    }
  },
  {
    name: 'getClaimForms',
    description: 'Gets a list of claimforms.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'getClaimPayment',
    description: 'Gets a single claim payment by ClaimPaymentNum.',
    input_schema: {
      type: 'object',
      properties: {
        ClaimPaymentNum: { type: 'number', description: 'Claim payment number' }
      },
      required: ['ClaimPaymentNum']
    }
  },
  {
    name: 'getClaimPayments',
    description: 'Gets a list of claim payments.',
    input_schema: {
      type: 'object',
      properties: {
        SecDateTEdit: { type: 'string', description: 'Filter by edit date (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getClaimProc',
    description: 'Gets a single ClaimProc by ClaimProcNum.',
    input_schema: {
      type: 'object',
      properties: {
        ClaimProcNum: { type: 'number', description: 'Claim procedure number' }
      },
      required: ['ClaimProcNum']
    }
  },
  {
    name: 'getClaimProcs',
    description: 'Gets a list of ClaimProcs with optional filtering.',
    input_schema: {
      type: 'object',
      properties: {
        ProcNum: { type: 'number', description: 'Procedure number (optional)' },
        ClaimNum: { type: 'number', description: 'Claim number (optional)' },
        PatNum: { type: 'number', description: 'Patient number (optional)' },
        Status: { type: 'string', description: 'Claim status (optional)' },
        ClaimPaymentNum: { type: 'number', description: 'Claim payment number (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getClaim',
    description: 'Gets a single claim by ClaimNum.',
    input_schema: {
      type: 'object',
      properties: {
        ClaimNum: { type: 'number', description: 'Claim number' }
      },
      required: ['ClaimNum']
    }
  },
  {
    name: 'getClaims',
    description: 'Gets a list of claims with optional filtering.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number (optional)' },
        ClaimStatus: { type: 'string', description: 'Claim status (optional)' },
        SecDateTEdit: { type: 'string', description: 'Filter by edit date (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getClaimTrackings',
    description: 'Gets a list of ClaimTrackings.',
    input_schema: {
      type: 'object',
      properties: {
        ClaimNum: { type: 'number', description: 'Claim number (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getCovCat',
    description: 'Gets a single covcat by CovCatNum.',
    input_schema: {
      type: 'object',
      properties: {
        CovCatNum: { type: 'number', description: 'Coverage category number' }
      },
      required: ['CovCatNum']
    }
  },
  {
    name: 'getCovCats',
    description: 'Gets a list of covcats.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'getCovSpan',
    description: 'Gets a single CovSpan by CovSpanNum.',
    input_schema: {
      type: 'object',
      properties: {
        CovSpanNum: { type: 'number', description: 'Coverage span number' }
      },
      required: ['CovSpanNum']
    }
  },
  {
    name: 'getCovSpans',
    description: 'Gets a list of CovSpans.',
    input_schema: {
      type: 'object',
      properties: {
        CovCatNum: { type: 'number', description: 'Coverage category number (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getDefinitions',
    description: 'Gets a list of definitions.',
    input_schema: {
      type: 'object',
      properties: {
        Category: { type: 'number', description: 'Definition category (optional)' },
        includeHidden: { type: 'boolean', description: 'Include hidden definitions (optional)' }
      },
      required: []
    }
  },
  {
    name: 'getDiscountPlan',
    description: 'Gets a single discount plan by DiscountPlanNum.',
    input_schema: {
      type: 'object',
      properties: {
        DiscountPlanNum: { type: 'number', description: 'Discount plan number' }
      },
      required: ['DiscountPlanNum']
    }
  },
  {
    name: 'getDiscountPlans',
    description: 'Gets a list of discount plans.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'getDiseaseDef',
    description: 'Gets a single DiseaseDef by DiseaseDefNum.',
    input_schema: {
      type: 'object',
      properties: {
        DiseaseDefNum: { type: 'number', description: 'Disease definition number' }
      },
      required: ['DiseaseDefNum']
    }
  },
  {
    name: 'getDiseaseDefs',
    description: 'Gets a list of DiseaseDefs.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'getDisease',
    description: 'Gets a single disease by DiseaseNum.',
    input_schema: {
      type: 'object',
      properties: {
        DiseaseNum: { type: 'number', description: 'Disease number' }
      },
      required: ['DiseaseNum']
    }
  },
  {
    name: 'getDiseases',
    description: 'Gets a list of diseases for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number (optional)' }
      },
      required: []
    }
  },
  {
    name: 'createDisease',
    description: 'Attaches a disease to a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        DiseaseDefNum: { type: 'number', description: 'Disease definition number (optional)' },
        diseaseDefName: { type: 'string', description: 'Disease definition name (optional)' },
        DateStart: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
        DateStop: { type: 'string', description: 'Stop date in YYYY-MM-DD format (optional)' },
        ProbStatus: { type: 'string', description: 'Problem status (Active, Resolved, Inactive) (optional)' },
        PatNote: { type: 'string', description: 'Patient note (optional)' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'updateDisease',
    description: 'Updates a disease for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        DiseaseNum: { type: 'number', description: 'Disease number' },
        DateStart: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
        DateStop: { type: 'string', description: 'Stop date in YYYY-MM-DD format (optional)' },
        ProbStatus: { type: 'string', description: 'Problem status (Active, Resolved, Inactive) (optional)' },
        PatNote: { type: 'string', description: 'Patient note (optional)' }
      },
      required: ['DiseaseNum']
    }
  },
  {
    name: 'deleteDisease',
    description: 'Deletes a disease for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        DiseaseNum: { type: 'number', description: 'Disease number' }
      },
      required: ['DiseaseNum']
    }
  },
  {
    name: 'getEhrPatient',
    description: 'Gets a single EHR patient by PatNum.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'updateEhrPatient',
    description: 'Updates an EHR patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' },
        DischargeDate: { type: 'string', description: 'Discharge date in YYYY-MM-DD format (optional)' },
        MedicaidState: { type: 'string', description: 'Medicaid state (optional)' }
      },
      required: ['PatNum']
    }
  },
  {
    name: 'getFamilyInsurance',
    description: 'Gets the insurance information for a patient.',
    input_schema: {
      type: 'object',
      properties: {
        PatNum: { type: 'number', description: 'Patient number' }
      },
      required: ['PatNum']
    }
  }
];

// ========================================================================
// INPUT PARSING HELPERS
// ========================================================================

function parsePatientInput(input: string): { FName?: string; LName?: string; Birthdate?: string } | null {
  const trimmed = input.trim();

  // Handle "FirstName LastName, DD MMM YYYY" format
  const nameDateRegex = /^(.+?)\s+(.+?),\s*(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s*,\s*(\d{4})$/i;
  const match = trimmed.match(nameDateRegex);

  if (match) {
    const [, firstName, lastName, day, month, year] = match;

    // Convert month name to number
    const monthMap: { [key: string]: string } = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
      'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };

    const monthNum = monthMap[month.toLowerCase()];
    if (!monthNum) return null;

    const formattedDate = `${year}-${monthNum}-${day.padStart(2, '0')}`;

    return {
      FName: firstName.trim(),
      LName: lastName.trim(),
      Birthdate: formattedDate
    };
  }

  // Handle "FirstName LastName, YYYY-MM-DD" format
  const standardRegex = /^(.+?)\s+(.+?),\s*(\d{4}-\d{2}-\d{2})$/;
  const standardMatch = trimmed.match(standardRegex);

  if (standardMatch) {
    const [, firstName, lastName, birthdate] = standardMatch;
    return {
      FName: firstName.trim(),
      LName: lastName.trim(),
      Birthdate: birthdate
    };
  }

  return null;
}

// ========================================================================
// TOOL EXECUTION
// ========================================================================

async function executeTool(call: any, odClient: OpenDentalClient, sessionAttributes: SessionState): Promise<any> {
  const { name, args } = call;
  
  try {
    switch (name) {
      case 'getPatientByPatNum':
        const patientData = await odClient.request('GET', `patients/${args.PatNum}`);
        return { name, response: { content: JSON.stringify({ status: 'SUCCESS', data: patientData }) } };

      case 'searchPatients':
        const searchParams = {
          LName: args.LName,
          FName: args.FName,
          Birthdate: args.Birthdate
        };
        const searchResponse = await odClient.request('GET', 'patients/Simple', { params: searchParams });
        const patients = Array.isArray(searchResponse) ? searchResponse : (searchResponse?.items ?? []);

        Logger.debug(`Patient search completed`, {
          searchParams,
          patientsFound: patients.length,
          firstPatient: patients.length > 0 ? patients[0] : null
        });
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: patients.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: { items: patients },
              message: patients.length > 0 ? `Found ${patients.length} patient(s)` : 'No matching patient found'
            })
          } 
        };

      case 'createPatient':
        const phoneNumber = args.WirelessPhone;
        if (!phoneNumber) {
          throw new ApiError('Phone number is required for new patients', 400);
        }
        // Format phone number using libphonenumber-js
        const parsedPhone = parsePhoneNumberFromString(phoneNumber, 'US');
        if (!parsedPhone?.isValid()) {
          throw new ApiError('Invalid phone number format', 400);
        }
        const createData = {
          LName: args.LName,
          FName: args.FName,
          WirelessPhone: parsedPhone.formatNational(),
          Birthdate: args.Birthdate,
          TxtMsgOk: 'Yes'
        };
        const newPatient = await odClient.request('POST', 'patients', { data: createData });
        return { name, response: { content: JSON.stringify({ status: 'SUCCESS', data: newPatient }) } };

      case 'getProcedureLogs':
        const procParams: any = { PatNum: args.PatNum };
        if (args.ProcStatus) procParams.ProcStatus = args.ProcStatus;
        
        const procResponse = await odClient.request('GET', 'procedurelogs', { params: procParams });
        const procedures = Array.isArray(procResponse) ? procResponse : (procResponse?.items ?? []);
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: procedures.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: procedures,
              message: procedures.length > 0 ? `Found ${procedures.length} procedure(s)` : 'No procedures found'
            })
          } 
        };

      case 'scheduleAppointment':
        // Ensure Op (operatory number) is provided as a number. If client provided OpName, map it.
        let opNum = getOperatoryNumber(args.Op || args.OpName);
        if (!opNum) {
          // Choose a sensible default: exam for new patients, minor for existing
          opNum = sessionAttributes.IsNewPatient ? DEFAULT_OPERATORY_MAP[CONFIG.OPERATORY_NAMES.EXAM] : DEFAULT_OPERATORY_MAP[CONFIG.OPERATORY_NAMES.MINOR];
        }

        const appointmentData = {
          PatNum: parseInt(args.PatNum.toString()),
          Op: opNum,
          AptDateTime: args.Date,
          ProcDescript: args.Reason,
          Note: args.Note || `${args.Reason} - Created by ToothFairy AI`,
          ClinicNum: 0,
          IsNewPatient: sessionAttributes.IsNewPatient || false
        };

        const newAppt = await odClient.request('POST', 'appointments', { data: appointmentData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newAppt,
              message: `Appointment scheduled successfully for ${args.Date}`
            })
          }
        };
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newAppt,
              message: `Appointment scheduled successfully for ${args.Date}`
            })
          } 
        };

      case 'getUpcomingAppointments':
        const upcomingApptList = await odClient.request('GET', 'appointments', {
          params: { PatNum: args.PatNum } 
        });
        const upcomingApts = Array.isArray(upcomingApptList) ? upcomingApptList : (upcomingApptList?.items ?? []);
        const futureApts = upcomingApts.filter((apt: any) => new Date(apt.AptDateTime) >= new Date());
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: futureApts.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: futureApts,
              message: futureApts.length > 0 ? `Found ${futureApts.length} upcoming appointment(s)` : 'No upcoming appointments'
            })
          } 
        };

      case 'rescheduleAppointment':
        const rescheduleData = {
          AptDateTime: args.NewDateTime,
          Note: args.Note ? `Rescheduled: ${args.Note}` : 'Rescheduled by ToothFairy AI'
        };
        
        const rescheduled = await odClient.request('PUT', `appointments/${args.AptNum}`, { data: rescheduleData });
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: 'SUCCESS',
              data: rescheduled,
              message: `Appointment rescheduled to ${args.NewDateTime}`
            })
          } 
        };

      case 'cancelAppointment':
        const cancelData = {
          SendToUnscheduledList: args.SendToUnscheduledList !== false,
          Note: args.Note || 'Cancelled by ToothFairy AI'
        };
        
        const cancelled = await odClient.request('PUT', `appointments/${args.AptNum}/Break`, { data: cancelData });
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: 'SUCCESS',
              data: cancelled,
              message: 'Appointment cancelled successfully'
            })
          } 
        };

      case 'getTreatmentPlans':
        const plans = await odClient.request('GET', 'treatplans', { 
          params: { PatNum: args.PatNum } 
        });
        const activePlans = (plans.items || plans).filter((plan: any) => 
          plan.TPStatus === 'Active' || plan.TPStatus === 'Saved'
        );
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: activePlans.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: activePlans,
              message: activePlans.length > 0 ? `Found ${activePlans.length} treatment plan(s)` : 'No active treatment plans'
            })
          } 
        };

      case 'getAppointmentSlots':
        const slots = await odClient.request('GET', 'appointments/Slots', { 
          params: { 
            date: args.date,
            lengthMinutes: args.lengthMinutes || 30
          } 
        });
        const availableSlots = Array.isArray(slots) ? slots : (slots?.items ?? []);
        
        return { 
          name, 
          response: { 
            content: JSON.stringify({
              status: availableSlots.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: availableSlots,
              message: availableSlots.length > 0 ? `Found ${availableSlots.length} available slot(s)` : 'No available slots'
            })
          } 
        };

      case 'getAccountAging':
        const aging = await odClient.request('GET', `accountmodules/${args.PatNum}/Aging`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: aging,
              message: 'Account aging information retrieved successfully'
            })
          }
        };

      case 'getPatientBalances':
        const balances = await odClient.request('GET', `accountmodules/${args.PatNum}/PatientBalances`);
        const balanceData = Array.isArray(balances) ? balances : (balances?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: balanceData.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: balanceData,
              message: balanceData.length > 0 ? `Found ${balanceData.length} balance record(s)` : 'No balance records found'
            })
          }
        };

      case 'getServiceDateView':
        const serviceParams: any = { PatNum: args.PatNum };
        if (args.isFamily !== undefined) {
          serviceParams.isFamily = args.isFamily.toString();
        }

        const serviceData = await odClient.request('GET', 'accountmodules/ServiceDateView', { params: serviceParams });
        const serviceRecords = Array.isArray(serviceData) ? serviceData : (serviceData?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: serviceRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: serviceRecords,
              message: serviceRecords.length > 0 ? `Found ${serviceRecords.length} service record(s)` : 'No service records found'
            })
          }
        };

      case 'getAdjustments':
        const adjParams: any = { PatNum: args.PatNum };
        if (args.AdjType !== undefined) {
          adjParams.AdjType = args.AdjType;
        }
        if (args.ProcNum !== undefined) {
          adjParams.ProcNum = args.ProcNum;
        }

        const adjustments = await odClient.request('GET', 'adjustments', { params: adjParams });
        const adjustmentRecords = Array.isArray(adjustments) ? adjustments : (adjustments?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: adjustmentRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: adjustmentRecords,
              message: adjustmentRecords.length > 0 ? `Found ${adjustmentRecords.length} adjustment(s)` : 'No adjustments found'
            })
          }
        };

      case 'createAdjustment':
        const createAdjData = {
          PatNum: parseInt(args.PatNum.toString()),
          AdjType: parseInt(args.AdjType.toString()),
          AdjAmt: parseFloat(args.AdjAmt.toString()),
          AdjDate: args.AdjDate,
          ...(args.ProvNum && { ProvNum: parseInt(args.ProvNum.toString()) }),
          ...(args.ProcNum && { ProcNum: parseInt(args.ProcNum.toString()) }),
          ...(args.ClinicNum && { ClinicNum: parseInt(args.ClinicNum.toString()) }),
          ...(args.ProcDate && { ProcDate: args.ProcDate }),
          ...(args.AdjNote && { AdjNote: args.AdjNote })
        };

        const newAdjustment = await odClient.request('POST', 'adjustments', { data: createAdjData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newAdjustment,
              message: 'Adjustment created successfully'
            })
          }
        };

      case 'updateAdjustment':
        const updateAdjData: any = {};
        if (args.AdjDate !== undefined) updateAdjData.AdjDate = args.AdjDate;
        if (args.AdjAmt !== undefined) updateAdjData.AdjAmt = parseFloat(args.AdjAmt.toString());
        if (args.AdjType !== undefined) updateAdjData.AdjType = parseInt(args.AdjType.toString());
        if (args.ProvNum !== undefined) updateAdjData.ProvNum = parseInt(args.ProvNum.toString());
        if (args.AdjNote !== undefined) updateAdjData.AdjNote = args.AdjNote;
        if (args.ProcNum !== undefined) updateAdjData.ProcNum = parseInt(args.ProcNum.toString());
        if (args.ClinicNum !== undefined) updateAdjData.ClinicNum = parseInt(args.ClinicNum.toString());

        const updatedAdjustment = await odClient.request('PUT', `adjustments/${args.AdjNum}`, { data: updateAdjData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: updatedAdjustment,
              message: 'Adjustment updated successfully'
            })
          }
        };

      case 'getAllergies':
        const allergies = await odClient.request('GET', 'allergies', { params: { PatNum: args.PatNum } });
        const allergyRecords = Array.isArray(allergies) ? allergies : (allergies?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: allergyRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: allergyRecords,
              message: allergyRecords.length > 0 ? `Found ${allergyRecords.length} allerg(y/ies)` : 'No allergies found'
            })
          }
        };

      case 'getAllergyDefs':
        const allergyDefParams: any = {};
        if (args.Offset !== undefined) {
          allergyDefParams.Offset = args.Offset;
        }

        const allergyDefs = await odClient.request('GET', 'allergydefs', { params: allergyDefParams });
        const allergyDefRecords = Array.isArray(allergyDefs) ? allergyDefs : (allergyDefs?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: allergyDefRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: allergyDefRecords,
              message: allergyDefRecords.length > 0 ? `Found ${allergyDefRecords.length} allergy definition(s)` : 'No allergy definitions found'
            })
          }
        };

      case 'createAllergyDef':
        const createAllergyDefData = {
          Description: args.Description
        };

        const newAllergyDef = await odClient.request('POST', 'allergydefs', { data: createAllergyDefData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newAllergyDef,
              message: 'Allergy definition created successfully'
            })
          }
        };

      case 'getAppointment':
        const singleAppointment = await odClient.request('GET', `appointments/${args.AptNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: singleAppointment,
              message: 'Appointment retrieved successfully'
            })
          }
        };

      case 'getAppointments':
        const appointmentParams: any = {};
        if (args.PatNum !== undefined) appointmentParams.PatNum = args.PatNum;
        if (args.AptStatus !== undefined) appointmentParams.AptStatus = args.AptStatus;
        if (args.Op !== undefined) appointmentParams.Op = args.Op;
        if (args.date !== undefined) appointmentParams.date = args.date;
        if (args.dateStart !== undefined) appointmentParams.dateStart = args.dateStart;
        if (args.dateEnd !== undefined) appointmentParams.dateEnd = args.dateEnd;
        if (args.ClinicNum !== undefined) appointmentParams.ClinicNum = args.ClinicNum;
        if (args.DateTStamp !== undefined) appointmentParams.DateTStamp = args.DateTStamp;
        if (args.AppointmentTypeNum !== undefined) appointmentParams.AppointmentTypeNum = args.AppointmentTypeNum;

        const appointmentList = await odClient.request('GET', 'appointments', { params: appointmentParams });
        const appointmentRecords = Array.isArray(appointmentList) ? appointmentList : (appointmentList?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: appointmentRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: appointmentRecords,
              message: appointmentRecords.length > 0 ? `Found ${appointmentRecords.length} appointment(s)` : 'No appointments found'
            })
          }
        };

      case 'getAsapAppointments':
        const asapParams: any = {};
        if (args.ClinicNum !== undefined) asapParams.ClinicNum = args.ClinicNum;
        if (args.ProvNum !== undefined) asapParams.ProvNum = args.ProvNum;
        if (args.Offset !== undefined) asapParams.Offset = args.Offset;

        const asapAppointments = await odClient.request('GET', 'appointments/ASAP', { params: asapParams });
        const asapRecords = Array.isArray(asapAppointments) ? asapAppointments : (asapAppointments?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: asapRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: asapRecords,
              message: asapRecords.length > 0 ? `Found ${asapRecords.length} ASAP appointment(s)` : 'No ASAP appointments found'
            })
          }
        };

      case 'getSlotsWebSched':
        const webSchedParams: any = {};
        if (args.date !== undefined) webSchedParams.date = args.date;
        if (args.dateStart !== undefined) webSchedParams.dateStart = args.dateStart;
        if (args.dateEnd !== undefined) webSchedParams.dateEnd = args.dateEnd;
        if (args.ClinicNum !== undefined) webSchedParams.ClinicNum = args.ClinicNum;
        if (args.defNumApptType !== undefined) webSchedParams.defNumApptType = args.defNumApptType;
        if (args.isNewPatient !== undefined) webSchedParams.isNewPatient = args.isNewPatient.toString();

        const webSchedSlots = await odClient.request('GET', 'appointments/SlotsWebSched', { params: webSchedParams });
        const webSchedSlotRecords = Array.isArray(webSchedSlots) ? webSchedSlots : (webSchedSlots?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: webSchedSlotRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: webSchedSlotRecords,
              message: webSchedSlotRecords.length > 0 ? `Found ${webSchedSlotRecords.length} WebSched slot(s)` : 'No WebSched slots found'
            })
          }
        };

      case 'getWebSchedAppointments':
        const webSchedApptParams: any = {};
        if (args.date !== undefined) webSchedApptParams.date = args.date;
        if (args.dateStart !== undefined) webSchedApptParams.dateStart = args.dateStart;
        if (args.dateEnd !== undefined) webSchedApptParams.dateEnd = args.dateEnd;
        if (args.DateTStamp !== undefined) webSchedApptParams.DateTStamp = args.DateTStamp;
        if (args.ClinicNum !== undefined) webSchedApptParams.ClinicNum = args.ClinicNum;
        if (args.Offset !== undefined) webSchedApptParams.Offset = args.Offset;

        const webSchedAppointments = await odClient.request('GET', 'appointments/WebSched', { params: webSchedApptParams });
        const webSchedApptRecords = Array.isArray(webSchedAppointments) ? webSchedAppointments : (webSchedAppointments?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: webSchedApptRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: webSchedApptRecords,
              message: webSchedApptRecords.length > 0 ? `Found ${webSchedApptRecords.length} WebSched appointment(s)` : 'No WebSched appointments found'
            })
          }
        };

      case 'createAppointment':
        // Accept either numeric Op or named OpName
        let createOp = getOperatoryNumber(args.Op || args.OpNum || args.OpName);
        if (!createOp) createOp = DEFAULT_OPERATORY_MAP[CONFIG.OPERATORY_NAMES.MINOR];

        const createApptData: any = {
          PatNum: parseInt(args.PatNum.toString()),
          Op: createOp,
          AptDateTime: args.AptDateTime
        };

        if (args.AptStatus !== undefined) createApptData.AptStatus = args.AptStatus;
        if (args.Pattern !== undefined) createApptData.Pattern = args.Pattern;
        if (args.Confirmed !== undefined) createApptData.Confirmed = parseInt(args.Confirmed.toString());
        if (args.Note !== undefined) createApptData.Note = args.Note;
        if (args.ProvNum !== undefined) createApptData.ProvNum = parseInt(args.ProvNum.toString());
        if (args.ProvHyg !== undefined) createApptData.ProvHyg = parseInt(args.ProvHyg.toString());
        if (args.ClinicNum !== undefined) createApptData.ClinicNum = parseInt(args.ClinicNum.toString());
        if (args.IsHygiene !== undefined) createApptData.IsHygiene = args.IsHygiene.toString();
        if (args.DateTimeArrived !== undefined) createApptData.DateTimeArrived = args.DateTimeArrived;
        if (args.DateTimeSeated !== undefined) createApptData.DateTimeSeated = args.DateTimeSeated;
        if (args.DateTimeDismissed !== undefined) createApptData.DateTimeDismissed = args.DateTimeDismissed;
        if (args.IsNewPatient !== undefined) createApptData.IsNewPatient = args.IsNewPatient.toString();
        if (args.Priority !== undefined) createApptData.Priority = args.Priority;
        if (args.AppointmentTypeNum !== undefined) createApptData.AppointmentTypeNum = parseInt(args.AppointmentTypeNum.toString());
        if (args.SecUserNumEntry !== undefined) createApptData.SecUserNumEntry = parseInt(args.SecUserNumEntry.toString());
        if (args.colorOverride !== undefined) createApptData.colorOverride = args.colorOverride;
        if (args.PatternSecondary !== undefined) createApptData.PatternSecondary = args.PatternSecondary;

        const newAppointment = await odClient.request('POST', 'appointments', { data: createApptData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newAppointment,
              message: 'Appointment created successfully'
            })
          }
        };

      case 'createPlannedAppointment':
        const createPlannedData: any = {
          PatNum: parseInt(args.PatNum.toString())
        };

        if (args.AppointmentTypeNum !== undefined) createPlannedData.AppointmentTypeNum = parseInt(args.AppointmentTypeNum.toString());
        if (args.procNums !== undefined) createPlannedData.procNums = args.procNums;
        if (args.Pattern !== undefined) createPlannedData.Pattern = args.Pattern;
        if (args.Confirmed !== undefined) createPlannedData.Confirmed = parseInt(args.Confirmed.toString());
        if (args.Note !== undefined) createPlannedData.Note = args.Note;
        if (args.ProvNum !== undefined) createPlannedData.ProvNum = parseInt(args.ProvNum.toString());
        if (args.ProvHyg !== undefined) createPlannedData.ProvHyg = parseInt(args.ProvHyg.toString());
        if (args.ClinicNum !== undefined) createPlannedData.ClinicNum = parseInt(args.ClinicNum.toString());
        if (args.IsHygiene !== undefined) createPlannedData.IsHygiene = args.IsHygiene.toString();
        if (args.IsNewPatient !== undefined) createPlannedData.IsNewPatient = args.IsNewPatient.toString();
        if (args.Priority !== undefined) createPlannedData.Priority = args.Priority;
        if (args.PatternSecondary !== undefined) createPlannedData.PatternSecondary = args.PatternSecondary;

        const newPlannedAppointment = await odClient.request('POST', 'appointments/Planned', { data: createPlannedData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newPlannedAppointment,
              message: 'Planned appointment created successfully'
            })
          }
        };

      case 'schedulePlannedAppointment':
        let schedOp = getOperatoryNumber(args.Op || args.OpName);
        if (!schedOp) schedOp = DEFAULT_OPERATORY_MAP[CONFIG.OPERATORY_NAMES.MINOR];

        const schedulePlannedData: any = {
          AptNum: parseInt(args.AptNum.toString()),
          AptDateTime: args.AptDateTime,
          ProvNum: parseInt(args.ProvNum.toString()),
          Op: schedOp
        };

        if (args.Confirmed !== undefined) schedulePlannedData.Confirmed = parseInt(args.Confirmed.toString());
        if (args.Note !== undefined) schedulePlannedData.Note = args.Note;

        const scheduledAppointment = await odClient.request('POST', 'appointments/SchedulePlanned', { data: schedulePlannedData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: scheduledAppointment,
              message: 'Planned appointment scheduled successfully'
            })
          }
        };

      case 'createWebSchedAppointment':
        const createWebSchedData = {
          PatNum: parseInt(args.PatNum.toString()),
          dateTimeStart: args.dateTimeStart,
          dateTimeEnd: args.dateTimeEnd,
          ProvNum: parseInt(args.ProvNum.toString()),
          OpNum: parseInt(args.OpNum.toString()),
          defNumApptType: parseInt(args.defNumApptType.toString())
        };

        const newWebSchedAppointment = await odClient.request('POST', 'appointments/WebSched', { data: createWebSchedData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newWebSchedAppointment,
              message: 'WebSched appointment created successfully'
            })
          }
        };

      case 'updateAppointment':
        const updateApptData: any = {};
        if (args.AptStatus !== undefined) updateApptData.AptStatus = args.AptStatus;
        if (args.Pattern !== undefined) updateApptData.Pattern = args.Pattern;
        if (args.Confirmed !== undefined) updateApptData.Confirmed = parseInt(args.Confirmed.toString());
        if (args.Op !== undefined) updateApptData.Op = parseInt(args.Op.toString());
        if (args.Note !== undefined) updateApptData.Note = args.Note;
        if (args.ProvNum !== undefined) updateApptData.ProvNum = parseInt(args.ProvNum.toString());
        if (args.ProvHyg !== undefined) updateApptData.ProvHyg = parseInt(args.ProvHyg.toString());
        if (args.AptDateTime !== undefined) updateApptData.AptDateTime = args.AptDateTime;
        if (args.ClinicNum !== undefined) updateApptData.ClinicNum = parseInt(args.ClinicNum.toString());
        if (args.IsHygiene !== undefined) updateApptData.IsHygiene = args.IsHygiene.toString();
        if (args.DateTimeArrived !== undefined) updateApptData.DateTimeArrived = args.DateTimeArrived;
        if (args.DateTimeSeated !== undefined) updateApptData.DateTimeSeated = args.DateTimeSeated;
        if (args.DateTimeDismissed !== undefined) updateApptData.DateTimeDismissed = args.DateTimeDismissed;
        if (args.IsNewPatient !== undefined) updateApptData.IsNewPatient = args.IsNewPatient.toString();
        if (args.Priority !== undefined) updateApptData.Priority = args.Priority;
        if (args.AppointmentTypeNum !== undefined) updateApptData.AppointmentTypeNum = parseInt(args.AppointmentTypeNum.toString());
        if (args.UnschedStatus !== undefined) updateApptData.UnschedStatus = parseInt(args.UnschedStatus.toString());
        if (args.colorOverride !== undefined) updateApptData.colorOverride = args.colorOverride;
        if (args.PatternSecondary !== undefined) updateApptData.PatternSecondary = args.PatternSecondary;

        const updatedAppointment = await odClient.request('PUT', `appointments/${args.AptNum}`, { data: updateApptData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: updatedAppointment,
              message: 'Appointment updated successfully'
            })
          }
        };

      case 'breakAppointment':
        const breakApptData = {
          sendToUnscheduledList: args.sendToUnscheduledList,
          ...(args.breakType && { breakType: args.breakType })
        };

        await odClient.request('PUT', `appointments/${args.AptNum}/Break`, { data: breakApptData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: {},
              message: 'Appointment broken successfully'
            })
          }
        };

      case 'appendAppointmentNote':
        await odClient.request('PUT', `appointments/${args.AptNum}/Note`, { data: { Note: args.Note } });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: {},
              message: 'Note appended to appointment successfully'
            })
          }
        };

      case 'updateAppointmentConfirm':
        const confirmData: any = {};
        if (args.confirmVal !== undefined) confirmData.confirmVal = args.confirmVal;
        if (args.defNum !== undefined) confirmData.defNum = parseInt(args.defNum.toString());

        await odClient.request('PUT', `appointments/${args.AptNum}/Confirm`, { data: confirmData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: {},
              message: 'Appointment confirmation updated successfully'
            })
          }
        };

      case 'getAppointmentTypes':
        const appointmentTypes = await odClient.request('GET', 'appointmenttypes');
        const appointmentTypeRecords = Array.isArray(appointmentTypes) ? appointmentTypes : (appointmentTypes?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: appointmentTypeRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: appointmentTypeRecords,
              message: appointmentTypeRecords.length > 0 ? `Found ${appointmentTypeRecords.length} appointment type(s)` : 'No appointment types found'
            })
          }
        };

      case 'getApptField':
        const apptField = await odClient.request('GET', 'apptfields', {
          params: {
            AptNum: args.AptNum,
            FieldName: args.FieldName
          }
        });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: apptField,
              message: 'Appointment field retrieved successfully'
            })
          }
        };

      case 'setApptField':
        const setApptFieldData = {
          AptNum: parseInt(args.AptNum.toString()),
          FieldName: args.FieldName,
          FieldValue: args.FieldValue
        };

        await odClient.request('PUT', 'apptfields', { data: setApptFieldData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: {},
              message: 'Appointment field updated successfully'
            })
          }
        };

      case 'getBenefit':
        const benefit = await odClient.request('GET', `benefits/${args.BenefitNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: benefit,
              message: 'Benefit retrieved successfully'
            })
          }
        };

      case 'getBenefits':
        const benefitParams: any = {};
        if (args.PlanNum !== undefined) benefitParams.PlanNum = args.PlanNum;
        if (args.PatPlanNum !== undefined) benefitParams.PatPlanNum = args.PatPlanNum;

        const benefits = await odClient.request('GET', 'benefits', { params: benefitParams });
        const benefitRecords = Array.isArray(benefits) ? benefits : (benefits?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: benefitRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: benefitRecords,
              message: benefitRecords.length > 0 ? `Found ${benefitRecords.length} benefit(s)` : 'No benefits found'
            })
          }
        };

      case 'getCarrier':
        const carrier = await odClient.request('GET', `carriers/${args.CarrierNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: carrier,
              message: 'Carrier retrieved successfully'
            })
          }
        };

      case 'getCarriers':
        const carriers = await odClient.request('GET', 'carriers');
        const carrierRecords = Array.isArray(carriers) ? carriers : (carriers?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: carrierRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: carrierRecords,
              message: carrierRecords.length > 0 ? `Found ${carrierRecords.length} carrier(s)` : 'No carriers found'
            })
          }
        };

      case 'getProgNotes':
        const progNotesParams: any = { PatNum: args.PatNum };
        if (args.Offset !== undefined) {
          progNotesParams.Offset = args.Offset;
        }

        const progNotes = await odClient.request('GET', `chartmodules/${args.PatNum}/ProgNotes`, { params: progNotesParams });
        const progNotesRecords = Array.isArray(progNotes) ? progNotes : (progNotes?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: progNotesRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: progNotesRecords,
              message: progNotesRecords.length > 0 ? `Found ${progNotesRecords.length} progress note(s)` : 'No progress notes found'
            })
          }
        };

      case 'getPatientInfo':
        const patientInfo = await odClient.request('GET', `chartmodules/${args.PatNum}/PatientInfo`);
        const patientInfoRecords = Array.isArray(patientInfo) ? patientInfo : (patientInfo?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: patientInfoRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: patientInfoRecords,
              message: patientInfoRecords.length > 0 ? `Found ${patientInfoRecords.length} patient info field(s)` : 'No patient info found'
            })
          }
        };

      case 'getPlannedAppts':
        const plannedAppts = await odClient.request('GET', `chartmodules/${args.PatNum}/PlannedAppts`);
        const plannedApptRecords = Array.isArray(plannedAppts) ? plannedAppts : (plannedAppts?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: plannedApptRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: plannedApptRecords,
              message: plannedApptRecords.length > 0 ? `Found ${plannedApptRecords.length} planned appointment(s)` : 'No planned appointments found'
            })
          }
        };

      case 'getClaimForm':
        const claimForm = await odClient.request('GET', `claimforms/${args.ClaimFormNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: claimForm,
              message: 'Claim form retrieved successfully'
            })
          }
        };

      case 'getClaimForms':
        const claimForms = await odClient.request('GET', 'claimforms');
        const claimFormRecords = Array.isArray(claimForms) ? claimForms : (claimForms?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: claimFormRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: claimFormRecords,
              message: claimFormRecords.length > 0 ? `Found ${claimFormRecords.length} claim form(s)` : 'No claim forms found'
            })
          }
        };

      case 'getClaimPayment':
        const claimPayment = await odClient.request('GET', `claimpayments/${args.ClaimPaymentNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: claimPayment,
              message: 'Claim payment retrieved successfully'
            })
          }
        };

      case 'getClaimPayments':
        const claimPaymentParams: any = {};
        if (args.SecDateTEdit !== undefined) {
          claimPaymentParams.SecDateTEdit = args.SecDateTEdit;
        }

        const claimPayments = await odClient.request('GET', 'claimpayments', { params: claimPaymentParams });
        const claimPaymentRecords = Array.isArray(claimPayments) ? claimPayments : (claimPayments?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: claimPaymentRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: claimPaymentRecords,
              message: claimPaymentRecords.length > 0 ? `Found ${claimPaymentRecords.length} claim payment(s)` : 'No claim payments found'
            })
          }
        };

      case 'getClaimProc':
        const claimProc = await odClient.request('GET', `claimprocs/${args.ClaimProcNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: claimProc,
              message: 'Claim procedure retrieved successfully'
            })
          }
        };

      case 'getClaimProcs':
        const claimProcParams: any = {};
        if (args.ProcNum !== undefined) claimProcParams.ProcNum = args.ProcNum;
        if (args.ClaimNum !== undefined) claimProcParams.ClaimNum = args.ClaimNum;
        if (args.PatNum !== undefined) claimProcParams.PatNum = args.PatNum;
        if (args.Status !== undefined) claimProcParams.Status = args.Status;
        if (args.ClaimPaymentNum !== undefined) claimProcParams.ClaimPaymentNum = args.ClaimPaymentNum;

        const claimProcs = await odClient.request('GET', 'claimprocs', { params: claimProcParams });
        const claimProcRecords = Array.isArray(claimProcs) ? claimProcs : (claimProcs?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: claimProcRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: claimProcRecords,
              message: claimProcRecords.length > 0 ? `Found ${claimProcRecords.length} claim procedure(s)` : 'No claim procedures found'
            })
          }
        };

      case 'getClaim':
        const claim = await odClient.request('GET', `claims/${args.ClaimNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: claim,
              message: 'Claim retrieved successfully'
            })
          }
        };

      case 'getClaims':
        const claimParams: any = {};
        if (args.PatNum !== undefined) claimParams.PatNum = args.PatNum;
        if (args.ClaimStatus !== undefined) claimParams.ClaimStatus = args.ClaimStatus;
        if (args.SecDateTEdit !== undefined) claimParams.SecDateTEdit = args.SecDateTEdit;

        const claims = await odClient.request('GET', 'claims', { params: claimParams });
        const claimRecords = Array.isArray(claims) ? claims : (claims?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: claimRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: claimRecords,
              message: claimRecords.length > 0 ? `Found ${claimRecords.length} claim(s)` : 'No claims found'
            })
          }
        };

      case 'getClaimTrackings':
        const trackingParams: any = {};
        if (args.ClaimNum !== undefined) {
          trackingParams.ClaimNum = args.ClaimNum;
        }

        const claimTrackings = await odClient.request('GET', 'claimtrackings', { params: trackingParams });
        const trackingRecords = Array.isArray(claimTrackings) ? claimTrackings : (claimTrackings?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: trackingRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: trackingRecords,
              message: trackingRecords.length > 0 ? `Found ${trackingRecords.length} claim tracking(s)` : 'No claim trackings found'
            })
          }
        };

      case 'getCovCat':
        const covCat = await odClient.request('GET', `covcats/${args.CovCatNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: covCat,
              message: 'Coverage category retrieved successfully'
            })
          }
        };

      case 'getCovCats':
        const covCats = await odClient.request('GET', 'covcats');
        const covCatRecords = Array.isArray(covCats) ? covCats : (covCats?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: covCatRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: covCatRecords,
              message: covCatRecords.length > 0 ? `Found ${covCatRecords.length} coverage categor(y/ies)` : 'No coverage categories found'
            })
          }
        };

      case 'getCovSpan':
        const covSpan = await odClient.request('GET', `covspans/${args.CovSpanNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: covSpan,
              message: 'Coverage span retrieved successfully'
            })
          }
        };

      case 'getCovSpans':
        const covSpanParams: any = {};
        if (args.CovCatNum !== undefined) {
          covSpanParams.CovCatNum = args.CovCatNum;
        }

        const covSpans = await odClient.request('GET', 'covspans', { params: covSpanParams });
        const covSpanRecords = Array.isArray(covSpans) ? covSpans : (covSpans?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: covSpanRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: covSpanRecords,
              message: covSpanRecords.length > 0 ? `Found ${covSpanRecords.length} coverage span(s)` : 'No coverage spans found'
            })
          }
        };

      case 'getDefinitions':
        const definitionParams: any = {};
        if (args.Category !== undefined) {
          definitionParams.Category = args.Category;
        }
        if (args.includeHidden !== undefined) {
          definitionParams.includeHidden = args.includeHidden.toString();
        }

        const definitions = await odClient.request('GET', 'definitions', { params: definitionParams });
        const definitionRecords = Array.isArray(definitions) ? definitions : (definitions?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: definitionRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: definitionRecords,
              message: definitionRecords.length > 0 ? `Found ${definitionRecords.length} definition(s)` : 'No definitions found'
            })
          }
        };

      case 'getDiscountPlan':
        const discountPlan = await odClient.request('GET', `discountplans/${args.DiscountPlanNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: discountPlan,
              message: 'Discount plan retrieved successfully'
            })
          }
        };

      case 'getDiscountPlans':
        const discountPlans = await odClient.request('GET', 'discountplans');
        const discountPlanRecords = Array.isArray(discountPlans) ? discountPlans : (discountPlans?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: discountPlanRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: discountPlanRecords,
              message: discountPlanRecords.length > 0 ? `Found ${discountPlanRecords.length} discount plan(s)` : 'No discount plans found'
            })
          }
        };

      case 'getDiseaseDef':
        const diseaseDef = await odClient.request('GET', `diseasedefs/${args.DiseaseDefNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: diseaseDef,
              message: 'Disease definition retrieved successfully'
            })
          }
        };

      case 'getDiseaseDefs':
        const diseaseDefs = await odClient.request('GET', 'diseasedefs');
        const diseaseDefRecords = Array.isArray(diseaseDefs) ? diseaseDefs : (diseaseDefs?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: diseaseDefRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: diseaseDefRecords,
              message: diseaseDefRecords.length > 0 ? `Found ${diseaseDefRecords.length} disease definition(s)` : 'No disease definitions found'
            })
          }
        };

      case 'getDisease':
        const disease = await odClient.request('GET', `diseases/${args.DiseaseNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: disease,
              message: 'Disease retrieved successfully'
            })
          }
        };

      case 'getDiseases':
        const diseaseParams: any = {};
        if (args.PatNum !== undefined) {
          diseaseParams.PatNum = args.PatNum;
        }

        const diseases = await odClient.request('GET', 'diseases', { params: diseaseParams });
        const diseaseRecords = Array.isArray(diseases) ? diseases : (diseases?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: diseaseRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: diseaseRecords,
              message: diseaseRecords.length > 0 ? `Found ${diseaseRecords.length} disease(s)` : 'No diseases found'
            })
          }
        };

      case 'createDisease':
        const createDiseaseData: any = {
          PatNum: parseInt(args.PatNum.toString())
        };

        if (args.DiseaseDefNum !== undefined) createDiseaseData.DiseaseDefNum = parseInt(args.DiseaseDefNum.toString());
        if (args.diseaseDefName !== undefined) createDiseaseData.diseaseDefName = args.diseaseDefName;
        if (args.DateStart !== undefined) createDiseaseData.DateStart = args.DateStart;
        if (args.DateStop !== undefined) createDiseaseData.DateStop = args.DateStop;
        if (args.ProbStatus !== undefined) createDiseaseData.ProbStatus = args.ProbStatus;
        if (args.PatNote !== undefined) createDiseaseData.PatNote = args.PatNote;

        const newDisease = await odClient.request('POST', 'diseases', { data: createDiseaseData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: newDisease,
              message: 'Disease created successfully'
            })
          }
        };

      case 'updateDisease':
        const updateDiseaseData: any = {};
        if (args.DateStart !== undefined) updateDiseaseData.DateStart = args.DateStart;
        if (args.DateStop !== undefined) updateDiseaseData.DateStop = args.DateStop;
        if (args.ProbStatus !== undefined) updateDiseaseData.ProbStatus = args.ProbStatus;
        if (args.PatNote !== undefined) updateDiseaseData.PatNote = args.PatNote;

        const updatedDisease = await odClient.request('PUT', `diseases/${args.DiseaseNum}`, { data: updateDiseaseData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: updatedDisease,
              message: 'Disease updated successfully'
            })
          }
        };

      case 'deleteDisease':
        await odClient.request('DELETE', `diseases/${args.DiseaseNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: {},
              message: 'Disease deleted successfully'
            })
          }
        };

      case 'getEhrPatient':
        const ehrPatient = await odClient.request('GET', `ehrpatients/${args.PatNum}`);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: ehrPatient,
              message: 'EHR patient retrieved successfully'
            })
          }
        };

      case 'updateEhrPatient':
        const updateEhrData: any = {};
        if (args.DischargeDate !== undefined) updateEhrData.DischargeDate = args.DischargeDate;
        if (args.MedicaidState !== undefined) updateEhrData.MedicaidState = args.MedicaidState;

        const updatedEhrPatient = await odClient.request('PUT', `ehrpatients/${args.PatNum}`, { data: updateEhrData });
        return {
          name,
          response: {
            content: JSON.stringify({
              status: 'SUCCESS',
              data: updatedEhrPatient,
              message: 'EHR patient updated successfully'
            })
          }
        };

      case 'getFamilyInsurance':
        const insuranceInfo = await odClient.request('GET', `familymodules/${args.PatNum}/Insurance`);
        const insuranceRecords = Array.isArray(insuranceInfo) ? insuranceInfo : (insuranceInfo?.items ?? []);
        return {
          name,
          response: {
            content: JSON.stringify({
              status: insuranceRecords.length > 0 ? 'SUCCESS' : 'FAILURE',
              data: insuranceRecords,
              message: insuranceRecords.length > 0 ? `Found ${insuranceRecords.length} insurance record(s)` : 'No insurance records found'
            })
          }
        };

      default:
        throw new ApiError(`Function ${name} not implemented`, 400);
    }
  } catch (error: any) {
    Logger.error(`Tool ${name} error`, error, {
      args,
      errorType: error.constructor?.name,
      statusCode: error.statusCode,
      isApiError: error instanceof ApiError
    });

    let errorMessage = 'Tool execution failed';
    let errorDetails = {};

    if (error instanceof ApiError) {
      errorMessage = `OpenDental API Error: ${error.message}`;
      errorDetails = {
        statusCode: error.statusCode,
        endpoint: error.details?.endpoint,
        method: error.details?.method
      };
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout - OpenDental API is taking too long to respond';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Cannot connect to OpenDental API - network error';
    } else {
      errorMessage = error.message || 'Unknown error occurred';
    }

    return { 
      name, 
      response: { 
        content: JSON.stringify({ 
          status: 'FAILURE', 
          message: errorMessage,
          details: errorDetails
        }) 
      } 
    };
  }
}

// ========================================================================
// AI RESPONSE GENERATION
// ========================================================================

// Helper function to provide step-specific instructions to prevent loops
function getStepInstructions(step: string, sessionAttributes: SessionState): string {
  switch (step) {
    case 'IDENTIFYING_PATIENT':
      return 'Ask for the patient\'s First Name, Last Name, and Date of Birth (YYYY-MM-DD). If they provide information in other formats like "FirstName LastName, DD MMM YYYY", parse it correctly. Only after collecting all three pieces of information, search for their record. Once found, move to checking procedures.';
    case 'CHECKING_PROCEDURES':
      return 'Use getProcedureLogs to check if the patient has treatment-planned procedures. If found, present them for confirmation.';
    case 'CONFIRMING_PROCEDURES':
      return 'Present the treatment-planned procedures and ask for confirmation. Once confirmed, ask for preferred appointment date/time.';
    case 'SCHEDULING_APPOINTMENT':
      return `CRITICAL: The patient has confirmed procedures (${sessionAttributes.proceduresChecked ? 'CONFIRMED' : 'NOT CONFIRMED'}). ${sessionAttributes.forceScheduleNow ? '⚡ FORCE SCHEDULE NOW - USER PROVIDED EXACT FORMAT - CALL scheduleAppointment IMMEDIATELY!' : 'DO NOT ask about procedures again. Parse ANY natural language date/time from the user and convert it to "YYYY-MM-DD HH:mm:ss" yourself. Then call scheduleAppointment with that exact string. If the user says "earliest" or "tomorrow" without a time, ask for a specific date/time.'}`;
    case 'RESCHEDULE_SELECT':
      return 'Use getUpcomingAppointments to show their current appointments in a numbered list. Ask which appointment they want to reschedule.';
    case 'RESCHEDULE_DATETIME':
      return 'Ask for their preferred new date and time for the selected appointment. Once provided, use rescheduleAppointment to reschedule it.';
    case 'CANCEL_SELECT':
      return 'Use getUpcomingAppointments to show their current appointments in a numbered list. Ask which appointment they want to cancel.';
    case 'CANCEL_CONFIRM':
      return 'Ask for confirmation before canceling the selected appointment. Once confirmed, use cancelAppointment with SendToUnscheduledList: true.';
    case 'COMPLETE':
      return 'The appointment operation has been completed successfully. Provide confirmation details and ask if they need anything else.';
    default:
      return 'Follow the normal conversation flow.';
  }
}

function createSystemPrompt(clinicConfig: ClinicConfig, sessionState: SessionState, userMessage?: string, todayDate?: string, currentDay?: string): string {
  const today = todayDate || new Date().toLocaleDateString('en-US');
  const day = currentDay || new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const conversationStep = sessionState.conversationStep || 'IDENTIFYING_PATIENT';
  
  const patientContext = sessionState.PatNum ?
    `\n\n**CURRENT PATIENT CONTEXT**: You are currently helping patient ${sessionState.FName || ''} ${sessionState.LName || ''} (PatNum: ${sessionState.PatNum}, DOB: ${sessionState.Birthdate || 'Unknown'}). Do not ask for their name or birthdate again.` :
    '';
  const newPatientContext = sessionState.IsNewPatient ?
    `\n\n**NEW PATIENT ALERT**: This is a NEW PATIENT who has never visited before. For ANY appointment type they request, you MUST use 'OpName: ${CONFIG.OPERATORY_NAMES.EXAM}' - this comprehensive exam appointment covers both the initial examination and any minor procedures they need. Only ONE booking is required.` :
    '';
  const conversationStepContext = `\n\n**CONVERSATION STEP**: Current step is ${conversationStep}. ${getStepInstructions(conversationStep, sessionState)}`;
  const appointmentContext = sessionState.AppointmentType ?
    `\n\n**APPOINTMENT CONTEXT**: The patient has requested a ${sessionState.AppointmentType} appointment. Prompt for the date and time if not yet provided.` :
    '';

  // Enhanced procedure context logic
  let procedureContext = '';
  if (sessionState.ProcedureDescripts) {
      if (sessionState.proceduresChecked) {
          // Once confirmed, DO NOT show the procedure list to the model. This prevents repetition.
          procedureContext = `\n\n**PROCEDURE CONTEXT**: ✅ The patient's procedures have been confirmed. Your ONLY goal now is to get a date and time to schedule the appointment. DO NOT mention the specific procedures again. Immediately ask for a preferred date and time.`;
      } else {
          // Before confirmation, show the list and ask the user to confirm.
          procedureContext = `\n\n**PROCEDURE CONTEXT**: The patient has treatment-planned procedures: ${sessionState.ProcedureDescripts}. After confirming with the user, prompt for date and time to book a planned appointment for these procedures.`;
      }
  }
  
  // Add scheduling urgency context if we're in scheduling mode
  const schedulingContext = (conversationStep === 'SCHEDULING_APPOINTMENT' && sessionState.proceduresChecked) ?
    `\n\n**🚨 SCHEDULING MODE ACTIVE**: User has confirmed procedures. DO NOT repeat procedure lists. You MUST parse any natural language date/time the user provides (e.g., "tomorrow 3pm", "next Tuesday at noon", "Sep 16 10:00", "2025-09-16T10:00") and convert it into the exact format "YYYY-MM-DD HH:mm:ss". Then call 'scheduleAppointment' with that value. If the user says "earliest" or "tomorrow" without a time, ask for a specific date and time.` :
    '';

  // Add immediate scheduling trigger for exact format
  const immediateSchedulingTrigger = (sessionState.forceScheduleNow ||  
    (/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(userMessage || '') &&  
     sessionState.PatNum && sessionState.ProcedureDescripts && sessionState.proceduresChecked)) ?
    `\n\n**⚡ IMMEDIATE SCHEDULING REQUIRED**: The user provided the EXACT date/time format "YYYY-MM-DD HH:mm:ss". STOP ALL CONVERSATION. DO NOT ask about procedures or confirmation. IMMEDIATELY call 'scheduleAppointment' tool NOW with PatNum: ${sessionState.PatNum}, Date: the exact string they provided (${userMessage || 'provided date/time'}), Reason: "Treatment planned procedures", OpName: ${sessionState.IsNewPatient ? CONFIG.OPERATORY_NAMES.EXAM : CONFIG.OPERATORY_NAMES.MINOR}, Note: "Scheduled for: ${sessionState.ProcedureDescripts}". NO OTHER RESPONSE IS ALLOWED.` :
    '';

  const clinicInfo = {
    name: clinicConfig.clinicName,
    address: clinicConfig.clinicAddress,
    email: clinicConfig.clinicEmail,
    phone: clinicConfig.clinicPhone,
    fax: clinicConfig.clinicFax,
    hours: clinicConfig.clinicHours || {}
  };

  return `
You are ToothFairy, a AI dental assistant for ${clinicInfo.name}. Manage appointment booking, cancellation, rescheduling, and details using API tools. Today is ${day}, ${today}; appointments must be on or after this date.${patientContext}${newPatientContext}${appointmentContext}${procedureContext} Follow these principles:
**Principles**:
1. **State Management**:
   - If 'PatNum' is present in session attributes, use it and do not ask for name or birthdate again.
   - If 'AppointmentType' is present, prompt for the appointment date and time unless provided.
   - If 'ProcedureDescripts' is present, confirm with the user if they want to book an appointment for these procedures, then prompt for date and time.
2. **Efficient Communication**: Perform tasks (e.g., patient lookup, procedure log checks) without intermediate prompts unless needed and dont use any systematic prompts (ex:let me check in our system) this is a strict rule.
3. **Continuous Flow**: After any successful tool call, ALWAYS continue the conversation. Never stop after a single tool call - proceed to the next logical step.
4. **Patient Identification - CRITICAL REQUIREMENTS**:
   - NEVER use hardcoded PatNum values like 12345 or any other arbitrary numbers.
   - ONLY call appointment-related functions (getUpcomingAppointments, getProcedureLogs, etc.) if 'PatNum' exists in session attributes.
   - If no PatNum is available in session attributes, first collect the patient's First Name, Last Name, and Date of Birth (YYYY-MM-DD). Do NOT call 'searchPatients' until you have all three.
   - **INPUT PARSING**: When users provide information in formats like "FirstName LastName, DD MMM YYYY" or "FirstName LastName, YYYY-MM-DD", parse it correctly. For example, "sunil eamani, 4th oct , 1975" should become FName="sunil", LName="eamani", Birthdate="1975-10-04".
  - If 'searchPatients' returns FAILURE, respond: "I couldn't find your record. Are you a new patient? If so, please provide your phone number so I can create your profile and continue booking your appointment."
   - Always check with the patient if the spelling and date of birth by telling them what you have recorded (e.g., 'I have recorded your name as J-O-H-N S-M-I-T-H and birthdate as 1990-01-01. Is that correct?').
   - If multiple patients are found, list them numbered for selection.
   - If a patient is found, immediately call 'getProcedureLogs' to check for treatment-planned procedures (ProcStatus: "TP").
5. **Procedure Log Handling**:
   - After a successful 'searchPatients' or if 'PatNum' exists, call 'getProcedureLogs' with PatNum to retrieve procedures with ProcStatus: "TP".
   - After receiving the 'getProcedureLogs' result, summarize unique 'descript' fields into a concise one-liner, e.g., "You have planned procedures: prophylaxis, root canal."
   - Ask the user: "Is this what you want to book an appointment for?" If yes, prompt for date and time, then call 'createPlannedAppointment' with the ProcNums.
   - Store ProcNums in session attributes for use in 'createPlannedAppointment'.
6. **Appointment Scheduling**:
   - After identifying the patient, check for treatment-planned procedures via 'getProcedureLogs'.
   - If no treatment-planned procedures exist, prompt for the appointment type (New Patient Emergency/Other, Existing Patient Emergency/Other and Existing Patient Current Treatment Plan).
   - After receiving the appointment type or procedure confirmation, ALWAYS prompt for the date and time unless provided in 'YYYY-MM-DD HH:mm:ss' format.
   - **IMMEDIATE SCHEDULING RULE**: If user provides date/time in YYYY-MM-DD HH:mm:ss format (e.g., "2025-09-16 10:00:00"), immediately call scheduleAppointment. DO NOT ask about procedures again. DO NOT ask for confirmation. SCHEDULE IMMEDIATELY.
   - **NO CONFIRMATION REQUIRED**: When user provides exact date/time format and procedures are already confirmed, do NOT ask "Is this what you want to schedule?" - just schedule it.
   - For 'scheduleAppointment', set 'Reason' to the appointment type without additional notes. Include notes like "Appointment created by ToothFairy AI assistant" in the 'Note' field.
   - For 'createPlannedAppointment', include all ProcNums with ProcStatus: "TP" and set Note to "Planned appointment for [procedure descriptions] by ToothFairy AI assistant".
   - **CRITICAL - NEW PATIENT OPERATORY RULE**: If this is a new patient (DateFirstVisit is "0001-01-01" or patient was just created), ALWAYS use 'OpName: ${CONFIG.OPERATORY_NAMES.EXAM}' regardless of the appointment type requested. This comprehensive exam appointment covers both the initial examination and any minor procedures (cleaning, fillings, etc.) - only ONE booking is required, no separate ONLINE_BOOKING_MINOR appointment needed.
   - **NEW PATIENT SINGLE BOOKING**: For new patients requesting multiple services (e.g., "cleaning and checkup"), book only ONE comprehensive exam appointment that will handle everything. Do not create multiple appointments.
   - For existing patients: Use 'OpName: ${CONFIG.OPERATORY_NAMES.MAJOR}' (60 mins) for root canal, '${CONFIG.OPERATORY_NAMES.MINOR}' (30 mins) for cleaning/other procedures.
7. **Error Handling**:
   - If a tool fails, respond clearly: "I couldn't find a patient record with that information. Would you like me to create a new patient record? If so, please provide your phone number and date of birth in YYYY-MM-DD format."
   - If the user provides an invalid date or time, respond: "The requested time is invalid or outside clinic hours. Please provide a date and time within our hours: ${JSON.stringify(clinicInfo.hours)}."
   - Never mention API endpoints or technical details in responses.
8. **Date Format**: Use 'YYYY-MM-DD HH:mm:ss' for scheduling. Validate dates are today or later. Donot Ask User for a particular format. He can provide in any format.
   - **CRITICAL DATE CALCULATION**: When user says day names, calculate carefully:
     * If today is Thursday (${today}) and user says "Friday", use ${new Date(new Date(today).getTime() + 24*60*60*1000).toISOString().slice(0,10)} (tomorrow)
     * If today is Thursday (${today}) and user says "Monday", use ${new Date(new Date(today).getTime() + 4*24*60*60*1000).toISOString().slice(0,10)} (next Monday)
     * If today is Thursday (${today}) and user says "Saturday", use ${new Date(new Date(today).getTime() + 2*24*60*60*1000).toISOString().slice(0,10)} (this Saturday)
   - **VALIDATION REQUIRED**: Always validate your date calculation before calling scheduleAppointment. If you calculate Friday as 2025-09-27 when today is 2025-09-25 (Thursday), that's WRONG - Friday should be 2025-09-26.
   - Double-check: Thursday + 1 day = Friday, Thursday + 2 days = Saturday, Thursday + 3 days = Sunday.
9. **Notes**: Include "[Reason/Procedures] - Appointment created by ToothFairy AI assistant" in the 'Note' field for appointments.
10. **Reschedule Appointments**:
   - When user requests to reschedule an appointment, first use 'getUpcomingAppointments' to show their current appointments.
   - Present the upcoming appointments in a numbered list and ask which one to reschedule.
   - Once they select an appointment, ask for their preferred new date and time.
   - Use 'getAppointmentSlots' to find available times if needed.
   - Finally use 'rescheduleAppointment' with the AptNum and new date/time.
11. **Cancel Appointments**:
   - When user requests to cancel an appointment, first use 'getUpcomingAppointments' to show their current appointments.
   - Present the upcoming appointments in a numbered list and ask which one to cancel.
   - Once they confirm the appointment to cancel, use 'cancelAppointment' with SendToUnscheduledList: true.
   - Always ask for confirmation before canceling an appointment.
**Tool Usage**:
- NEVER call getUpcomingAppointments, getProcedureLogs, getAdjustments, getAllergies, getAllergyDefs, getAppointment, getAppointments, getProgNotes, getPatientInfo, getPlannedAppts, or other patient-related functions without a valid PatNum from session attributes.
- After a successful 'searchPatients' call that finds a patient, call 'getProcedureLogs' to check for treatment-planned procedures.
- After 'getProcedureLogs' returns, generate a response summarizing unique procedure descriptions and ask for user confirmation, e.g., "You have planned procedures: [descriptions]. Is this what you want to book an appointment for?"
- After user confirms procedures or provides appointment type, prompt for date and time, e.g., "When would you like to schedule your [appointment type/procedures] appointment?"
- **NEW PATIENT BOOKING**: For new patients, regardless of what services they request (cleaning, checkup, fillings, etc.), book only ONE comprehensive exam appointment using ONLINE_BOOKING_EXAM. This single appointment covers everything they need.
- DONOT MENTION THE PROVIDER NAME IN THE RESPONSE.
- Only call 'scheduleAppointment' or 'createPlannedAppointment' after receiving and validating a user-provided date and time.
- Handle errors with friendly messages, e.g., "The requested time is outside clinic hours. Try another time or call ${clinicInfo.phone}."

**Account Information Tools**:
- Use 'getAccountAging' when patients ask about their account aging or overdue balances. This shows balances by age categories (0-30 days, 31-60 days, etc.).
- Use 'getPatientBalances' when patients ask about their account balance or want to see balances for family members.
- Use 'getServiceDateView' when patients ask about their account history, charges, payments, or want to see a detailed breakdown of their account activity.

**Adjustment Tools**:
- Use 'getAdjustments' when patients ask about discounts, charges, or adjustments applied to their account. Can filter by adjustment type or procedure.
- Use 'createAdjustment' when patients need discounts, finance charges, or other adjustments applied to their account.
- Use 'updateAdjustment' when existing adjustments need to be modified or corrected.

**Patient Information Tools**:
- Use 'getAllergies' when patients mention allergies or when checking for medication contraindications before procedures.
- Use 'getAllergyDefs' when you need to see all available allergy types in the system (rarely used).
- Use 'createAllergyDef' when you need to add a new allergy type to the system (rarely used).

**Advanced Appointment Tools**:
- Use 'getAppointment' when you need to retrieve a specific appointment by its AptNum.
- Use 'getAppointments' when you need to search for appointments with various filters (patient, status, date range, etc.).
- Use 'getAsapAppointments' when patients want to see ASAP (urgent) appointments.
- Use 'getSlotsWebSched' when patients want to schedule through WebSched (online scheduling).
- Use 'getWebSchedAppointments' when you need to see appointments made through WebSched.
- Use 'createAppointment' when you need to create a regular appointment (use scheduleAppointment for the main workflow).
- Use 'createPlannedAppointment' when you need to create a planned appointment for future scheduling.
- Use 'schedulePlannedAppointment' when converting a planned appointment to a scheduled one.
- Use 'createWebSchedAppointment' when creating appointments through the WebSched system.
- Use 'updateAppointment' when you need to modify an existing appointment (use rescheduleAppointment for the main workflow).
- Use 'breakAppointment' when canceling or breaking an appointment.
- Use 'appendAppointmentNote' when adding notes to an appointment.
- Use 'updateAppointmentConfirm' when updating appointment confirmation status.
- Use 'getAppointmentTypes' when you need to see available appointment types in the system.
- Use 'getApptField' when you need to retrieve a specific appointment field value.
- Use 'setApptField' when you need to set or update an appointment field value (e.g., insurance verification status).
- Use 'getBenefit' when you need to retrieve a specific insurance benefit by its BenefitNum.
- Use 'getBenefits' when you need to retrieve all benefits for an insurance plan or patient plan.

**Insurance Information Tools**:
- Use 'getBenefit' when you need to retrieve a specific insurance benefit by its BenefitNum.
- Use 'getBenefits' when you need to retrieve all benefits for an insurance plan or patient plan.
- Use 'getCarrier' when you need to retrieve a specific insurance carrier by its CarrierNum.
- Use 'getCarriers' when you need to see all available insurance carriers in the system.

**Chart Module Tools**:
- Use 'getProgNotes' when you need to retrieve a patient's progress notes (appointments, procedures, commlogs, tasks, emails, lab cases, Rx, sheets).
- Use 'getPatientInfo' when you need to retrieve comprehensive patient information (age, billing type, providers, insurance, problems, medications, allergies, restrictions).
- Use 'getPlannedAppts' when you need to retrieve a patient's planned appointments.

**Claim Form Tools**:
- Use 'getClaimForm' when you need to retrieve a specific claim form by its ClaimFormNum.
- Use 'getClaimForms' when you need to see all available claim forms in the system.

**Claim Payment Tools**:
- Use 'getClaimPayment' when you need to retrieve a specific claim payment by its ClaimPaymentNum.
- Use 'getClaimPayments' when you need to retrieve claim payments, optionally filtered by edit date.

**Claim Procedure Tools**:
- Use 'getClaimProc' when you need to retrieve a specific claim procedure by its ClaimProcNum.
- Use 'getClaimProcs' when you need to retrieve claim procedures, optionally filtered by procedure, claim, patient, status, or claim payment.

**Claim Tools**:
- Use 'getClaim' when you need to retrieve a specific claim by its ClaimNum.
- Use 'getClaims' when you need to retrieve claims, optionally filtered by patient, status, or edit date.
- Use 'getClaimTrackings' when you need to retrieve claim tracking history, optionally filtered by claim number.

**Coverage Category Tools**:
- Use 'getCovCat' when you need to retrieve a specific coverage category by its CovCatNum.
- Use 'getCovCats' when you need to see all available coverage categories in the system.

**Coverage Span Tools**:
- Use 'getCovSpan' when you need to retrieve a specific coverage span by its CovSpanNum.
- Use 'getCovSpans' when you need to retrieve coverage spans, optionally filtered by coverage category.

**Definition Tools**:
- Use 'getDefinitions' when you need to retrieve definitions, optionally filtered by category or including hidden definitions.

**Discount Plan Tools**:
- Use 'getDiscountPlan' when you need to retrieve a specific discount plan by its DiscountPlanNum.
- Use 'getDiscountPlans' when you need to see all available discount plans in the system.

**Disease Definition Tools**:
- Use 'getDiseaseDef' when you need to retrieve a specific disease definition by its DiseaseDefNum.
- Use 'getDiseaseDefs' when you need to see all available disease definitions (problems) in the system.

**Disease Tools**:
- Use 'getDisease' when you need to retrieve a specific disease by its DiseaseNum.
- Use 'getDiseases' when you need to retrieve diseases for a patient, optionally filtered by patient number.
- Use 'createDisease' when you need to attach a disease/problem to a patient.
- Use 'updateDisease' when you need to update a disease's status, dates, or notes.
- Use 'deleteDisease' when you need to remove a disease from a patient.

**EHR Patient Tools**:
- Use 'getEhrPatient' when you need to retrieve EHR patient information by PatNum.
- Use 'updateEhrPatient' when you need to update EHR patient information like discharge date or Medicaid state.

**Family Module Tools**:
- Use 'getFamilyInsurance' when you need to retrieve comprehensive insurance information for a patient, including subscriber details, carriers, and plan information.

**Pricing Information**:
When patients ask about procedure costs or pricing, you can provide general price ranges using the available pricing data. Always present pricing as ranges (e.g., "$108-$145 for cleaning") and remind patients that exact costs depend on their specific case and insurance coverage. Encourage them to contact the office for detailed estimates. You have access to pricing for categories including: ${clinicConfig?.pricing?.map(p => `${p.category} ($${p.minPrice}-$${p.maxPrice})`).join(', ') || 'Cleaning ($108-$145), Root Canal ($1,615-$2,093), Crowns ($1,264-$8,051), Fillings ($207-$390), Consultations ($58-$216), X-rays ($42-$42)'}. Always suggest patients verify pricing and insurance coverage with the office.
When The Patient Asks About Insurance Coverage, You Can provide the following information: ${JSON.stringify(clinicConfig?.insurance || {})}). Prefering Statement would be We accept most insurances including medicare/medicaid/delta dental/aetna/BCBS. Plan names and participation may vary by employer or location. Call our office to confirm your coverage before your visit.
If the Patient asks anytime sooner or earliest available appointment, It should Book the appointment for the next day 8Am for the Requested appointment.
**DO NOT CHECK FOR AVAILABILITY OF THE APPOINTMENT. BOOK THE APPOINTMENT FOR THE ASKED DATE AND TIME.**
**Today is ${day}, ${today}**

**Clinic Info**: ${JSON.stringify(clinicInfo)}
**Available Procedure Pricing**: ${JSON.stringify(clinicConfig?.pricing || [])}
**Insurance Coverage**: ${JSON.stringify(clinicConfig?.insurance || {})}
${immediateSchedulingTrigger}
${schedulingContext}
${conversationStepContext}
${patientContext}
${newPatientContext}
${appointmentContext}
${procedureContext}
`;
}

async function generateAIResponse(
  userMessage: string,
  history: any[],
  clinicConfig: ClinicConfig,
  sessionState: SessionState,
  sendProgress?: (payload: any) => Promise<void>
): Promise<string> {
  try {
    const systemPrompt = createSystemPrompt(clinicConfig, sessionState, userMessage);
    
    // Prepare messages for Claude
    const messages = [
      ...history.slice(-CONFIG.MAX_HISTORY_LENGTH),
      { role: 'user', content: [{ type: 'text', text: userMessage }] }
    ];

    // Ensure proper message alternation
    const validatedMessages = [];
    let lastRole = '';
    
    for (const msg of messages) {
      if (msg.role !== lastRole) {
        validatedMessages.push(msg);
        lastRole = msg.role;
      }
    }

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: CONFIG.MAX_TOKENS,
      temperature: CONFIG.TEMPERATURE,
      system: systemPrompt,
      messages: validatedMessages,
      tools: OPEN_DENTAL_TOOLS
    };

    const command = new InvokeModelCommand({
      modelId: CONFIG.MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await bedrockClient.send(command);
    const claudeResponse = JSON.parse(new TextDecoder().decode(response.body));
    
    // Handle tool calls if present (pass sendProgress so we can stream dynamic updates)
    if (claudeResponse.content?.some((c: any) => c.type === 'tool_use')) {
      return await handleToolCalls(claudeResponse, clinicConfig, sessionState, history, sendProgress, userMessage);
    }
    
    // Return text response
    const textContent = claudeResponse.content?.find((c: any) => c.type === 'text');
    return textContent?.text || 'I apologize, but I\'m having trouble processing your request right now.';
    
  } catch (error: any) {
    Logger.error('Error generating AI response', error, {
      userMessage,
      sessionState: {
        PatNum: sessionState.PatNum,
        conversationStep: sessionState.conversationStep,
        clinicId: sessionState.clinicId
      }
    });

    // Provide more specific error messages based on the error type
    if (error?.message?.includes('timeout')) {
      return 'I\'m taking longer than expected to process your request. Please try again in a moment.';
    } else if (error?.message?.includes('Bedrock')) {
      return 'I\'m having trouble connecting to my AI service. Please try again or call our office for assistance.';
    } else if (error?.message?.includes('OpenDental')) {
      return 'I\'m having trouble accessing our patient records. Please try again or call our office for assistance.';
    } else {
    return 'I\'m experiencing technical difficulties. Please try again or call our office for assistance.';
    }
  }
}

async function handleToolCalls(
  claudeResponse: any,
  clinicConfig: ClinicConfig, 
  sessionState: SessionState,
  history: any[],
  sendProgress?: (payload: any) => Promise<void>,
  originalUserMessage?: string
): Promise<string> {
  const odClient = new OpenDentalClient(clinicConfig.developerKey, clinicConfig.customerKey);
  const toolCalls = claudeResponse.content.filter((c: any) => c.type === 'tool_use');
  
  // Execute all tool calls
  const toolResults = [];
  const friendlyBefore: Record<string,string> = {
    searchPatients: 'Looking up the patient record...',
    getProcedureLogs: 'Checking the patient\'s treatment plan and procedures...',
    scheduleAppointment: 'Booking the appointment now...',
    getUpcomingAppointments: 'Checking upcoming appointments for this patient...',
    getAppointmentSlots: 'Finding available appointment slots...',
    createPatient: 'Creating a new patient record...'
  };

  for (const toolCall of toolCalls) {
    // Send a user-friendly progress message
    if (sendProgress) {
      try { await sendProgress({ type: 'progress', message: friendlyBefore[toolCall.name] || 'Working on your request...' }); } catch(_) {}
    }

    let result: any = null;
    try {
      result = await executeTool(
        { name: toolCall.name, args: toolCall.input },
        odClient,
        sessionState
      );
    } catch (toolError: any) {
      // Log internally with details (already helpful for devs)
      Logger.error(`Tool ${toolCall.name} error`, {
        args: toolCall.input,
        errorType: toolError.constructor?.name || typeof toolError,
        statusCode: toolError?.statusCode || null,
        isApiError: toolError instanceof ApiError,
        error: toolError instanceof Error ? { name: toolError.name, message: toolError.message } : toolError
      });

      // Prepare a friendly, non-technical message for the user
      let friendlyMsg = 'I had a problem completing that step. Please try again or contact the office for help.';
      try {
        const apiResp = toolError?.details?.response || toolError?.response || toolError?.message || '';
        const respText = typeof apiResp === 'string' ? apiResp : JSON.stringify(apiResp || '');
        // If the API returns a clear text reason, surface it concisely
        if (respText && respText.length > 0) {
          // Keep it short and user-friendly
          if (respText.toLowerCase().includes('op is required')) {
            friendlyMsg = 'I couldn\'t book the appointment because the office requires a room/operatory. Please choose a provider or a specific timeslot.';
          } else if (respText.toLowerCase().includes('invalid json')) {
            friendlyMsg = 'I couldn\'t process the appointment details — there was a problem with the data format. Please try again.';
          } else {
            friendlyMsg = respText;
          }
        }
      } catch (_) {}

      if (sendProgress) {
        try { await sendProgress({ type: 'message', message: friendlyMsg, sessionState }); } catch(_) {}
      }

      // Continue to next tool; add a failure placeholder so follow-up logic can adapt
      toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: JSON.stringify({ status: 'FAILURE', message: friendlyMsg }) });
      // move to next tool
      continue;
    }
    
    toolResults.push({
      type: 'tool_result',
      tool_use_id: toolCall.id,
      content: result.response.content
    });
    
    // Update session state based on tool results
    updateSessionState(toolCall.name, result, sessionState);

    // Send a short, user-facing summary of the tool result to the client
    if (sendProgress) {
      try {
        const parsed = JSON.parse(result.response.content);
        let userMessage = parsed.message || '';

        // Special-case procedure logs to be more helpful
        if (toolCall.name === 'getProcedureLogs') {
          const procedures = parsed.data || [];
          if (procedures.length > 0) {
            const names = procedures.slice(0,5).map((p: any) => p.descript || p.name || 'procedure').join(', ');
            userMessage = `I found ${procedures.length} planned procedure(s): ${names}. I can help you schedule an appointment for these.`;
          } else {
            userMessage = `I don't see any treatment-planned procedures for this patient. Would you like to book an appointment anyway?`;
          }
        } else if (!userMessage) {
          // Fallback friendly summaries for other tools
          if (parsed.status === 'SUCCESS') userMessage = 'I found the information requested.';
          else userMessage = 'I couldn\'t find anything matching that request.';
        }

        // Send the summary as an assistant-style message so the client displays it naturally
        await sendProgress({ type: 'message', message: userMessage, sessionState });
      } catch (_) {}
    }

    // If the tool was getProcedureLogs and procedures were found, and the original user message
    // contains an intent to book/schedule, attempt an automatic booking for next day 08:00
    try {
      if (toolCall.name === 'getProcedureLogs' && originalUserMessage && /\b(book|schedule|appointment)\b/i.test(originalUserMessage)) {
        const parsed = JSON.parse(result.response.content);
        const procedures = parsed.data || [];
        if (procedures.length > 0) {
          // compute next day at 08:00
          const nextDay = new Date();
          nextDay.setDate(nextDay.getDate() + 1);
          nextDay.setHours(8, 0, 0, 0);
          const dateStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth()+1).padStart(2,'0')}-${String(nextDay.getDate()).padStart(2,'0')} ${String(nextDay.getHours()).padStart(2,'0')}:00:00`;

          const scheduleArgs: any = {
            PatNum: sessionState.PatNum || parsed.PatNum || (parsed.data && parsed.data[0] && parsed.data[0].PatNum),
            Date: dateStr,
            Reason: 'Treatment-planned procedures',
            OpName: sessionState.IsNewPatient ? CONFIG.OPERATORY_NAMES.EXAM : CONFIG.OPERATORY_NAMES.MINOR,
            Note: 'Appointment created for treatment-planned procedures.'
          };

          if (sendProgress) {
            try { await sendProgress({ type: 'progress', message: `Scheduling an appointment for tomorrow at 8:00 AM for the planned procedures...` }); } catch(_) {}
          }

          try {
            const schedResult = await executeTool({ name: 'scheduleAppointment', args: scheduleArgs }, odClient, sessionState);
            toolResults.push({ type: 'tool_result', tool_use_id: `auto-schedule-${Date.now()}`, content: schedResult.response.content });
            try { updateSessionState('scheduleAppointment', schedResult, sessionState); } catch (_) {}

            if (sendProgress) {
              try {
                const schedParsed = JSON.parse(schedResult.response.content);
                const friendly = schedParsed?.status === 'SUCCESS' ? `I've scheduled the appointment for ${dateStr}.` : `I couldn't schedule the appointment: ${schedParsed?.message || 'unknown error'}`;
                await sendProgress({ type: 'message', message: friendly, sessionState });
              } catch (_) {}
            }
          } catch (schedErr: any) {
            Logger.error('Auto-schedule failed', schedErr, { sessionId: sessionState.sessionId });
            if (sendProgress) {
              try { await sendProgress({ type: 'message', message: 'I tried to book the appointment automatically but something went wrong. Please try again or call the office.' , sessionState }); } catch(_) {}
            }
          }
        }
      }
    } catch (_) {}
  }
  
  // Send tool results back to Claude for final response
  // Only make follow-up call if we have both tool calls and results
  if (toolCalls.length === 0 || toolResults.length === 0) {
    Logger.warn('Missing tool calls or results for follow-up', {
      toolCallsCount: toolCalls.length,
      toolResultsCount: toolResults.length,
      sessionState: {
        PatNum: sessionState.PatNum,
        conversationStep: sessionState.conversationStep,
        clinicId: sessionState.clinicId
      }
    });
    return 'I\'ve completed your request. Is there anything else I can help you with?';
  }

  // Format the conversation properly for Bedrock tool use
  // We need to include the original context that led to the tool calls
  // History is in chronological order (oldest first), so find the last user message
  const lastUserMessage = history
    .slice()
    .reverse()
    .find(msg => msg.role === 'user') || { role: 'user', content: [{ type: 'text', text: 'Please help with this request.' }] };

  const followUpPayload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: CONFIG.MAX_TOKENS,
    temperature: CONFIG.TEMPERATURE,
    system: createSystemPrompt(clinicConfig, sessionState),
    messages: [
      lastUserMessage,
      { role: 'assistant', content: toolCalls },
      { role: 'user', content: toolResults }
    ],
    tools: OPEN_DENTAL_TOOLS  // Add tools configuration for follow-up calls
  };
  
  if (sendProgress) {
    try { await sendProgress({ type: 'progress', message: 'Finalizing your request...' }); } catch(_) {}
  }

  const followUpCommand = new InvokeModelCommand({
    modelId: CONFIG.MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(followUpPayload)
  });
  
  Logger.debug('Making follow-up Bedrock API call', {
    toolCallsCount: toolCalls.length,
    toolResultsCount: toolResults.length,
    firstToolCall: toolCalls.length > 0 ? toolCalls[0] : null,
    firstToolResult: toolResults.length > 0 ? toolResults[0] : null,
    sessionState: {
      PatNum: sessionState.PatNum,
      conversationStep: sessionState.conversationStep,
      clinicId: sessionState.clinicId
    }
  });

  try {
  const followUpResponse = await bedrockClient.send(followUpCommand);
  const finalResponse = JSON.parse(new TextDecoder().decode(followUpResponse.body));
  
  // Prefer explicit 'text' content if present
  let textContent = finalResponse.content?.find((c: any) => c.type === 'text');
  if (textContent?.text) {
    return textContent.text;
  }

  // Otherwise try to assemble a friendly message from any text-like pieces
  try {
    const parts: string[] = [];
    if (Array.isArray(finalResponse.content)) {
      for (const c of finalResponse.content) {
        if (c.type === 'text' && c.text) parts.push(c.text);
        else if (c.type === 'tool_result' && c.content) {
          try {
            const parsed = typeof c.content === 'string' ? JSON.parse(c.content) : c.content;
            if (parsed.message) parts.push(parsed.message);
            else if (parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) {
              // For procedure lists, summarize
              const names = parsed.data.slice(0,5).map((p: any) => p.descript || p.name || 'procedure').join(', ');
              parts.push(`I found ${parsed.data.length} item(s): ${names}`);
            }
          } catch (_) {}
        } else if (typeof c === 'string') {
          parts.push(c);
        }
      }
    }

    if (parts.length > 0) return parts.join(' \n');
  } catch (_) {}

  // As a final fallback, synthesize a reply from the toolResults we executed earlier (especially getProcedureLogs)
  try {
    const procResult = toolResults.find((r: any) => {
      try { const p = JSON.parse(r.content); return p && Array.isArray(p.data) && p.data.length >= 0; } catch { return false; }
    });

    if (procResult) {
      const parsed = JSON.parse(procResult.content);
      const procedures = parsed.data || [];
      if (procedures.length > 0) {
        const names = procedures.slice(0,5).map((p: any) => p.descript || p.name || 'procedure').join(', ');
        return `I found ${procedures.length} planned procedure(s): ${names}. Would you like me to book an appointment for these?`;
      } else {
        return `I don't see any treatment-planned procedures for this patient. Would you like to schedule an appointment anyway?`;
      }
    }
  } catch (_) {}

  return 'I\'ve completed your request. Is there anything else I can help you with?';

  } catch (error) {
    Logger.error('Follow-up Bedrock API call failed', error, {
      toolCallsCount: toolCalls.length,
      sessionState: {
        PatNum: sessionState.PatNum,
        conversationStep: sessionState.conversationStep,
        clinicId: sessionState.clinicId
      }
    });

    // If the follow-up call fails, provide a fallback response based on the tool results
    if (toolResults.length > 0) {
      const lastToolResult = JSON.parse(toolResults[toolResults.length - 1].content);
      if (lastToolResult.status === 'SUCCESS') {
        return 'I\'ve processed your request successfully. Is there anything else I can help you with?';
      } else {
        return 'I encountered an issue while processing your request. Please try again or call our office for assistance.';
      }
    }

    throw error; // Re-throw to be caught by the main error handler
  }
}

function updateSessionState(toolName: string, result: any, sessionState: SessionState) {
  const resultData = JSON.parse(result.response.content);
  
  switch (toolName) {
    case 'searchPatients':
      if (resultData.status === 'SUCCESS' && resultData.data.items.length === 1) {
        const patient = resultData.data.items[0];
        sessionState.PatNum = patient.PatNum.toString();
        sessionState.FName = patient.FName;
        sessionState.LName = patient.LName;
        sessionState.Birthdate = patient.Birthdate;
        sessionState.IsNewPatient = patient.DateFirstVisit === "0001-01-01";
        sessionState.conversationStep = 'CHECKING_PROCEDURES';
      } else if (resultData.status === 'FAILURE') {
        // Patient not found - prompt for phone number for new patient creation
        Logger.info('Patient search failed - no matching patients found', {
          sessionId: sessionState.sessionId,
          searchCriteria: resultData.message
        });
        sessionState.IsNewPatient = true;
        sessionState.conversationStep = 'IDENTIFYING_PATIENT';
      }
      break;
      
    case 'createPatient':
      if (resultData.status === 'SUCCESS') {
        const patient = resultData.data;
        sessionState.PatNum = patient.PatNum.toString();
        sessionState.FName = patient.FName;
        sessionState.LName = patient.LName;
        sessionState.Birthdate = patient.Birthdate;
        sessionState.IsNewPatient = true;
        sessionState.conversationStep = 'CHECKING_PROCEDURES';
      }
      break;
      
    case 'getProcedureLogs':
      if (resultData.status === 'SUCCESS' && resultData.data.length > 0) {
        const treatmentPlanned = resultData.data.filter((p: any) => p.ProcStatus === 'TP');
        if (treatmentPlanned.length > 0) {
          sessionState.ProcedureDescripts = treatmentPlanned.map((p: any) => p.descript).join(', ');
          sessionState.ProcNums = JSON.stringify(treatmentPlanned.map((p: any) => p.ProcNum));
          sessionState.conversationStep = 'CONFIRMING_PROCEDURES';
        }
      }
      break;
      
    case 'scheduleAppointment':
    case 'rescheduleAppointment':
    case 'cancelAppointment':
      if (resultData.status === 'SUCCESS') {
        sessionState.conversationStep = 'COMPLETE';
      }
      break;
  }
}

// ========================================================================
// WEBSOCKET UTILITIES
// ========================================================================

async function sendToClient(
  apiClient: ApiGatewayManagementApiClient,
  connectionId: string,
  data: any
): Promise<void> {
  try {
    await apiClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data)
    }));
  } catch (error: any) {
    if (error.statusCode === 410) {
      Logger.info('Stale connection detected', { connectionId: connectionId.substring(0, 8) + '***' });
    } else {
      Logger.error('Failed to send message to client', error, { connectionId: connectionId.substring(0, 8) + '***' });
      throw error;
    }
  }
}

async function storeMessage(
  sessionId: string,
  clinicId: string,
  connectionId: string,
  messageType: 'user' | 'assistant',
  message: string,
  metadata: any = {}
): Promise<void> {
  try {
    const timestamp = Date.now();
    const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

    await docClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        sessionId,
        timestamp,
        clinicId,
        connectionId,
        messageType,
        message,
        metadata,
        ttl
      }
    }));
  } catch (error) {
    Logger.error('Failed to store message', error, { sessionId, messageType });
  }
}

async function storeSessionState(sessionId: string, clinicId: string, sessionState: SessionState): Promise<void> {
  try {
    await docClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        sessionId: `${sessionId}_state`,
        timestamp: 0,
        message: JSON.stringify(sessionState),
        clinicId,
        messageType: 'session_state',
        lastUpdated: new Date().toISOString()
      }
    }));
  } catch (error) {
    Logger.error('Failed to store session state', error, { sessionId });
  }
}

async function getConversationHistory(sessionId: string): Promise<any[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: CONVERSATIONS_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      FilterExpression: 'messageType IN (:user, :assistant)',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
        ':user': 'user',
        ':assistant': 'assistant'
      },
      ScanIndexForward: false, // Most recent first
      Limit: CONFIG.MAX_HISTORY_LENGTH
    }));

    return (result.Items || [])
      .reverse() // Oldest first for conversation context
      .map(item => ({
        role: item.messageType === 'user' ? 'user' : 'assistant',
        content: [{ type: 'text', text: item.message }]
      }));
  } catch (error) {
    Logger.error('Error fetching conversation history', error, { sessionId });
    return [];
  }
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: WebSocketEvent): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  Logger.info('WebSocket message handler started', { 
    requestId, 
    connectionId: event.requestContext.connectionId
  });

  try {
    const { connectionId, domainName, stage, apiId } = event.requestContext;
    
    if (!connectionId) {
      throw new ApiError('Missing connection ID', 400);
    }

    // Create API Gateway management client
    const endpoint = `https://${apiId}.execute-api.${CONFIG.AWS_REGION}.amazonaws.com/${stage}`;
    const apiGatewayManagementApi = new ApiGatewayManagementApiClient({ endpoint });

    // Parse and validate request
    if (!event.body) {
      throw new ApiError('Request body is required', 400);
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch (error) {
      throw new ApiError('Invalid JSON in request body', 400);
    }

    const { message: userMessage, sessionId, clinicId } = body;

    if (!userMessage || !sessionId || !clinicId) {
      throw new ApiError('Missing required fields: message, sessionId, clinicId', 400);
    }

    // Get clinic configuration
    const clinicConfig = await getEnhancedClinicConfig(clinicId);
    if (!clinicConfig) {
      throw new ApiError('Invalid clinic configuration', 400);
    }

    // Initialize or restore session state
    let sessionState: SessionState = { clinicId, sessionId };
    
    try {
      const sessionStateResult = await docClient.send(new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { 
          sessionId: `${sessionId}_state`,
          timestamp: 0
        }
      }));
      
      if (sessionStateResult.Item?.message) {
        const restoredState = JSON.parse(sessionStateResult.Item.message);
        sessionState = { ...sessionState, ...restoredState };
      }
    } catch (error) {
      Logger.warn('Could not restore session state', { sessionId });
    }

    // Get conversation history
    const history = await getConversationHistory(sessionId);

    // Store user message
    await storeMessage(sessionId, clinicId, connectionId, 'user', userMessage);

    // Generate AI response with filler/typing support and robust fallback
    let aiResponse: string;
    let generateError: any = null;

    // Helper to send progress messages to the client
    const sendProgress = async (payload: any) => {
      try {
        await sendToClient(apiGatewayManagementApi, connectionId, payload);
      } catch (e) {
        Logger.warn('sendProgress failed', { error: e, connectionId });
      }
    };

    // Start a filler/typing timer to notify client if AI is slow (use sendProgress)
    let fillerTimer: any = null;
    if (CONFIG.ENABLE_FILLER_RESPONSES && CONFIG.FILLER_RESPONSE_THRESHOLD_MS > 0) {
      fillerTimer = setTimeout(async () => {
        try {
          await sendProgress({ type: 'filler', message: 'Thinking...' });
          Logger.debug('Sent filler message to client', { connectionId });
        } catch (sendErr) {
          Logger.warn('Failed to send filler message', { error: sendErr, connectionId });
        }
      }, CONFIG.FILLER_RESPONSE_THRESHOLD_MS);
    }

    try {
  aiResponse = await generateAIResponse(userMessage, history, clinicConfig, sessionState, sendProgress);
    } catch (err: any) {
      generateError = err;
      Logger.error('generateAIResponse failed', err, { sessionId, clinicId });

      // Provide a safe fallback message to ensure the client receives something useful
      if (err instanceof ApiError) {
        aiResponse = err.message;
      } else if (err?.message && typeof err.message === 'string') {
        aiResponse = 'I\'m having trouble processing your request right now. Please try again.';
      } else {
        aiResponse = 'I\'m experiencing technical difficulties. Please try again or call our office for assistance.';
      }
    } finally {
      if (fillerTimer) {
        clearTimeout(fillerTimer);
      }
    }

    // Store AI response and session state (best-effort; don't block final send on DB failures)
    try {
      await Promise.all([
        storeMessage(sessionId, clinicId, connectionId, 'assistant', aiResponse),
        storeSessionState(sessionId, clinicId, sessionState)
      ]);
    } catch (storeErr) {
      Logger.warn('Failed to persist AI response or session state', { error: storeErr, sessionId });
    }

    // Send final response to client (include an error flag if generation failed)
    try {
      await sendToClient(apiGatewayManagementApi, connectionId, {
        type: 'message',
        message: aiResponse,
        sessionId,
        clinicId,
        sessionState,
        timestamp: Date.now(),
        requestId,
        ...(generateError && { generatedWithError: true })
      });
    } catch (sendFinalErr) {
      Logger.error('Failed to send final AI response to client', sendFinalErr, { connectionId, sessionId });
      // If sending final message fails, still return success so API Gateway connection isn't retried excessively
    }

    Logger.info('Request completed successfully', { 
      sessionId, 
      totalTime: Date.now() - startTime,
      requestId 
    });

    return { 
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...buildCorsHeaders()
      },
      body: JSON.stringify({ 
        message: 'Message processed successfully', 
        requestId,
        processingTime: Date.now() - startTime
      })
    };

  } catch (error: any) {
    const totalTime = Date.now() - startTime;
    
    Logger.error('WebSocket message handler error', error, { 
      requestId, 
      totalTime,
      connectionId: event.requestContext.connectionId
    });
    
    // Try to send error to client
    try {
      const { connectionId, apiId, stage } = event.requestContext;
      if (connectionId) {
        const endpoint = `https://${apiId}.execute-api.${CONFIG.AWS_REGION}.amazonaws.com/${stage}`;
        const apiGatewayManagementApi = new ApiGatewayManagementApiClient({ endpoint });
        
        await sendToClient(apiGatewayManagementApi, connectionId, {
          type: 'error',
          message: error instanceof ApiError ? error.message : 'An error occurred processing your message',
          errorId: error instanceof ApiError ? error.errorId : requestId,
          requestId
        });
      }
    } catch (sendError) {
      Logger.error('Failed to send error message to client', sendError);
    }

    const statusCode = error instanceof ApiError ? error.statusCode : 500;

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...buildCorsHeaders()
      },
      body: JSON.stringify({ 
        message: CONFIG.ENVIRONMENT === 'production' ? 'Internal server error' : error.message,
        requestId,
        ...(error instanceof ApiError && { errorId: error.errorId })
      })
    };
  }
};
/**
 * Action Group Handler for Bedrock Agents
 * 
 * This Lambda is invoked by Bedrock Agents when they need to call OpenDental tools.
 * It receives the action group invocation request and executes the appropriate tool.
 */

import axios from 'axios';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import clinicsData from '../../infrastructure/configs/clinics.json';

// ========================================================================
// CONFIGURATION
// ========================================================================

const CONFIG = {
  OPEN_DENTAL_API_URL: 'https://api.opendental.com/api/v1',
  API_TIMEOUT: 15000,
  MAX_API_RETRIES: 3,
};

// Default operatory mapping
const DEFAULT_OPERATORY_MAP: Record<string, number> = {
  ONLINE_BOOKING_EXAM: 1,
  ONLINE_BOOKING_MAJOR: 2,
  ONLINE_BOOKING_MINOR: 3,
  EXAM: 1,
  MAJOR: 2,
  MINOR: 3,
};

// ========================================================================
// TYPES
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
}

interface ActionGroupEvent {
  messageVersion: string;
  agent: {
    name: string;
    id: string;
    alias: string;
    version: string;
  };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters: Array<{
    name: string;
    type: string;
    value: string;
  }>;
  requestBody?: {
    content: {
      [contentType: string]: {
        properties: Array<{
          name: string;
          type: string;
          value: string;
        }>;
      };
    };
  };
  sessionAttributes: Record<string, string>;
  promptSessionAttributes: Record<string, string>;
}

interface ActionGroupResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: {
      [contentType: string]: {
        body: string;
      };
    };
    sessionAttributes?: Record<string, string>;
    promptSessionAttributes?: Record<string, string>;
  };
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
        Authorization: `ODFHIR ${developerKey}/${customerKey}`,
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.API_TIMEOUT,
    });
  }

  async request(method: string, endpoint: string, { params, data }: any = {}) {
    for (let attempt = 1; attempt <= CONFIG.MAX_API_RETRIES; attempt++) {
      try {
        const config: any = { method, url: endpoint };
        if (params)
          config.params = Object.fromEntries(
            Object.entries(params).filter(([, v]) => v != null && v !== '')
          );
        if (data) config.data = data;
        const response = await this.client.request(config);
        return response.data || { status: 'success', statusCode: response.status };
      } catch (error: any) {
        const status = error.response?.status;
        const isRetryable =
          status >= 500 || status === 429 || ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
        if (!isRetryable || attempt === CONFIG.MAX_API_RETRIES) {
          throw new Error(
            error.response?.data?.message || `OpenDental API call failed: ${error.message}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

function getOperatoryNumber(opInput: any): number | null {
  if (opInput == null) return null;
  if (typeof opInput === 'number' && !Number.isNaN(opInput)) return opInput;
  if (typeof opInput === 'string') {
    const n = parseInt(opInput, 10);
    if (!Number.isNaN(n)) return n;
    const key = opInput.trim().toUpperCase();
    if (DEFAULT_OPERATORY_MAP[key]) return DEFAULT_OPERATORY_MAP[key];
  }
  return null;
}

function parseParameters(event: ActionGroupEvent): Record<string, any> {
  const params: Record<string, any> = {};

  // Parse URL parameters
  if (event.parameters) {
    for (const param of event.parameters) {
      params[param.name] = parseValue(param.value, param.type);
    }
  }

  // Parse request body properties
  if (event.requestBody?.content?.['application/json']?.properties) {
    for (const prop of event.requestBody.content['application/json'].properties) {
      params[prop.name] = parseValue(prop.value, prop.type);
    }
  }

  return params;
}

function parseValue(value: string, type: string): any {
  switch (type.toLowerCase()) {
    case 'integer':
    case 'number':
      return parseInt(value, 10);
    case 'boolean':
      return value.toLowerCase() === 'true';
    default:
      return value;
  }
}

function getClinicConfig(clinicId: string): ClinicConfig | undefined {
  return clinicsData.find((c) => c.clinicId === clinicId) as ClinicConfig | undefined;
}

// ========================================================================
// TOOL HANDLERS
// ========================================================================

async function handleTool(
  toolName: string,
  params: Record<string, any>,
  odClient: OpenDentalClient,
  sessionAttributes: Record<string, string>
): Promise<{ statusCode: number; body: any; updatedSessionAttributes?: Record<string, string> }> {
  const updatedSessionAttributes = { ...sessionAttributes };

  try {
    switch (toolName) {
      // ===== PATIENT TOOLS =====
      case 'getPatientByPatNum': {
        const data = await odClient.request('GET', `patients/${params.PatNum}`);
        return { statusCode: 200, body: { status: 'SUCCESS', data } };
      }

      case 'searchPatients': {
        const searchParams = { LName: params.LName, FName: params.FName, Birthdate: params.Birthdate };
        const resp = await odClient.request('GET', 'patients/Simple', { params: searchParams });
        const patients = Array.isArray(resp) ? resp : resp?.items ?? [];

        if (patients.length === 1) {
          const patient = patients[0];
          updatedSessionAttributes.PatNum = patient.PatNum.toString();
          updatedSessionAttributes.FName = patient.FName;
          updatedSessionAttributes.LName = patient.LName;
          updatedSessionAttributes.Birthdate = patient.Birthdate;
          updatedSessionAttributes.IsNewPatient = (patient.DateFirstVisit === '0001-01-01').toString();
        }

        return {
          statusCode: patients.length > 0 ? 200 : 404,
          body: {
            status: patients.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: { items: patients },
            message: patients.length > 0 ? `Found ${patients.length} patient(s)` : 'No matching patient found',
          },
          updatedSessionAttributes,
        };
      }

      case 'createPatient': {
        let phoneNumber = params.WirelessPhone;
        if (phoneNumber) {
          const parsedPhone = parsePhoneNumberFromString(phoneNumber, 'US');
          if (parsedPhone?.isValid()) {
            phoneNumber = parsedPhone.formatNational();
          }
        }
        const createData = {
          LName: params.LName,
          FName: params.FName,
          WirelessPhone: phoneNumber,
          Birthdate: params.Birthdate,
          TxtMsgOk: 'Yes',
        };
        const newPatient = await odClient.request('POST', 'patients', { data: createData });

        updatedSessionAttributes.PatNum = newPatient.PatNum.toString();
        updatedSessionAttributes.FName = newPatient.FName;
        updatedSessionAttributes.LName = newPatient.LName;
        updatedSessionAttributes.IsNewPatient = 'true';

        return {
          statusCode: 201,
          body: { status: 'SUCCESS', data: newPatient },
          updatedSessionAttributes,
        };
      }

      // ===== PROCEDURE TOOLS =====
      case 'getProcedureLogs': {
        const procParams: any = { PatNum: params.PatNum };
        if (params.ProcStatus) procParams.ProcStatus = params.ProcStatus;
        const resp = await odClient.request('GET', 'procedurelogs', { params: procParams });
        const procedures = Array.isArray(resp) ? resp : resp?.items ?? [];

        const treatmentPlanned = procedures.filter((p: any) => p.ProcStatus === 'TP');
        if (treatmentPlanned.length > 0) {
          updatedSessionAttributes.ProcedureDescripts = treatmentPlanned.map((p: any) => p.descript).join(', ');
          updatedSessionAttributes.ProcNums = JSON.stringify(treatmentPlanned.map((p: any) => p.ProcNum));
        }

        return {
          statusCode: procedures.length > 0 ? 200 : 404,
          body: {
            status: procedures.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: procedures,
            message: procedures.length > 0 ? `Found ${procedures.length} procedure(s)` : 'No procedures found',
          },
          updatedSessionAttributes,
        };
      }

      case 'getTreatmentPlans': {
        const plans = await odClient.request('GET', 'treatplans', { params: { PatNum: params.PatNum } });
        const activePlans = (plans.items || plans).filter(
          (plan: any) => plan.TPStatus === 'Active' || plan.TPStatus === 'Saved'
        );
        return {
          statusCode: activePlans.length > 0 ? 200 : 404,
          body: {
            status: activePlans.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: activePlans,
            message: activePlans.length > 0 ? `Found ${activePlans.length} treatment plan(s)` : 'No active treatment plans',
          },
        };
      }

      // ===== APPOINTMENT TOOLS =====
      case 'scheduleAppointment': {
        const isNewPatient = sessionAttributes.IsNewPatient === 'true';
        let opNum = getOperatoryNumber(params.Op || params.OpName);
        if (!opNum) opNum = isNewPatient ? DEFAULT_OPERATORY_MAP.EXAM : DEFAULT_OPERATORY_MAP.MINOR;

        const appointmentData = {
          PatNum: parseInt(params.PatNum.toString()),
          Op: opNum,
          AptDateTime: params.Date,
          ProcDescript: params.Reason,
          Note: params.Note || `${params.Reason} - Created by AI Agent`,
          ClinicNum: 0,
          IsNewPatient: isNewPatient,
        };
        const newAppt = await odClient.request('POST', 'appointments', { data: appointmentData });
        return {
          statusCode: 201,
          body: {
            status: 'SUCCESS',
            data: newAppt,
            message: `Appointment scheduled successfully for ${params.Date}`,
          },
        };
      }

      case 'getUpcomingAppointments': {
        const resp = await odClient.request('GET', 'appointments', { params: { PatNum: params.PatNum } });
        const apts = Array.isArray(resp) ? resp : resp?.items ?? [];
        const futureApts = apts.filter((apt: any) => new Date(apt.AptDateTime) >= new Date());
        return {
          statusCode: futureApts.length > 0 ? 200 : 404,
          body: {
            status: futureApts.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: futureApts,
            message: futureApts.length > 0 ? `Found ${futureApts.length} upcoming appointment(s)` : 'No upcoming appointments',
          },
        };
      }

      case 'rescheduleAppointment': {
        const rescheduleData = {
          AptDateTime: params.NewDateTime,
          Note: params.Note ? `Rescheduled: ${params.Note}` : 'Rescheduled by AI Agent',
        };
        const rescheduled = await odClient.request('PUT', `appointments/${params.AptNum}`, { data: rescheduleData });
        return {
          statusCode: 200,
          body: {
            status: 'SUCCESS',
            data: rescheduled,
            message: `Appointment rescheduled to ${params.NewDateTime}`,
          },
        };
      }

      case 'cancelAppointment': {
        const cancelData = {
          SendToUnscheduledList: params.SendToUnscheduledList !== false,
          Note: params.Note || 'Cancelled by AI Agent',
        };
        const cancelled = await odClient.request('PUT', `appointments/${params.AptNum}/Break`, { data: cancelData });
        return {
          statusCode: 200,
          body: { status: 'SUCCESS', data: cancelled, message: 'Appointment cancelled successfully' },
        };
      }

      case 'getAppointment': {
        const apt = await odClient.request('GET', `appointments/${params.AptNum}`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: apt } };
      }

      case 'getAppointments': {
        const aptParams: any = {};
        if (params.PatNum) aptParams.PatNum = params.PatNum;
        if (params.AptStatus) aptParams.AptStatus = params.AptStatus;
        if (params.date) aptParams.date = params.date;
        if (params.dateStart) aptParams.dateStart = params.dateStart;
        if (params.dateEnd) aptParams.dateEnd = params.dateEnd;
        const apts = await odClient.request('GET', 'appointments', { params: aptParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: apts } };
      }

      case 'createAppointment': {
        let opNum = getOperatoryNumber(params.Op);
        if (!opNum) opNum = DEFAULT_OPERATORY_MAP.MINOR;
        const aptData: any = {
          PatNum: parseInt(params.PatNum.toString()),
          Op: opNum,
          AptDateTime: params.AptDateTime,
        };
        if (params.Note) aptData.Note = params.Note;
        if (params.IsNewPatient !== undefined) aptData.IsNewPatient = params.IsNewPatient.toString();
        const newApt = await odClient.request('POST', 'appointments', { data: aptData });
        return { statusCode: 201, body: { status: 'SUCCESS', data: newApt } };
      }

      case 'updateAppointment': {
        const updateData: any = {};
        if (params.AptDateTime) updateData.AptDateTime = params.AptDateTime;
        if (params.Note) updateData.Note = params.Note;
        if (params.Op) updateData.Op = params.Op;
        const updated = await odClient.request('PUT', `appointments/${params.AptNum}`, { data: updateData });
        return { statusCode: 200, body: { status: 'SUCCESS', data: updated } };
      }

      case 'breakAppointment': {
        const breakData = { sendToUnscheduledList: params.sendToUnscheduledList };
        await odClient.request('PUT', `appointments/${params.AptNum}/Break`, { data: breakData });
        return { statusCode: 200, body: { status: 'SUCCESS', message: 'Appointment broken successfully' } };
      }

      case 'getAppointmentSlots': {
        const slots = await odClient.request('GET', 'appointments/Slots', {
          params: { date: params.date, lengthMinutes: params.lengthMinutes || 30 },
        });
        const availableSlots = Array.isArray(slots) ? slots : slots?.items ?? [];
        return {
          statusCode: availableSlots.length > 0 ? 200 : 404,
          body: {
            status: availableSlots.length > 0 ? 'SUCCESS' : 'FAILURE',
            data: availableSlots,
            message: availableSlots.length > 0 ? `Found ${availableSlots.length} available slot(s)` : 'No available slots',
          },
        };
      }

      // ===== ACCOUNT TOOLS =====
      case 'getAccountAging': {
        const aging = await odClient.request('GET', `accountmodules/${params.PatNum}/Aging`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: aging } };
      }

      case 'getPatientBalances': {
        const balances = await odClient.request('GET', `accountmodules/${params.PatNum}/PatientBalances`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: balances } };
      }

      case 'getServiceDateView': {
        const serviceParams: any = { PatNum: params.PatNum };
        if (params.isFamily !== undefined) serviceParams.isFamily = params.isFamily.toString();
        const serviceData = await odClient.request('GET', 'accountmodules/ServiceDateView', { params: serviceParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: serviceData } };
      }

      // ===== MEDICAL TOOLS =====
      case 'getAllergies': {
        const allergies = await odClient.request('GET', 'allergies', { params: { PatNum: params.PatNum } });
        return { statusCode: 200, body: { status: 'SUCCESS', data: allergies } };
      }

      case 'getProgNotes': {
        const notes = await odClient.request('GET', `chartmodules/${params.PatNum}/ProgNotes`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: notes } };
      }

      case 'getPatientInfo': {
        const info = await odClient.request('GET', `chartmodules/${params.PatNum}/PatientInfo`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: info } };
      }

      case 'getPlannedAppts': {
        const planned = await odClient.request('GET', `chartmodules/${params.PatNum}/PlannedAppts`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: planned } };
      }

      // ===== INSURANCE TOOLS =====
      case 'getBenefits': {
        const benefitParams: any = {};
        if (params.PlanNum) benefitParams.PlanNum = params.PlanNum;
        if (params.PatPlanNum) benefitParams.PatPlanNum = params.PatPlanNum;
        const benefits = await odClient.request('GET', 'benefits', { params: benefitParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: benefits } };
      }

      case 'getCarriers': {
        const carriers = await odClient.request('GET', 'carriers');
        return { statusCode: 200, body: { status: 'SUCCESS', data: carriers } };
      }

      case 'getClaims': {
        const claimParams: any = {};
        if (params.PatNum) claimParams.PatNum = params.PatNum;
        if (params.ClaimStatus) claimParams.ClaimStatus = params.ClaimStatus;
        const claims = await odClient.request('GET', 'claims', { params: claimParams });
        return { statusCode: 200, body: { status: 'SUCCESS', data: claims } };
      }

      case 'getFamilyInsurance': {
        const insurance = await odClient.request('GET', `familymodules/${params.PatNum}/Insurance`);
        return { statusCode: 200, body: { status: 'SUCCESS', data: insurance } };
      }

      default:
        return {
          statusCode: 400,
          body: { status: 'FAILURE', message: `Unknown tool: ${toolName}` },
        };
    }
  } catch (error: any) {
    console.error(`Tool ${toolName} error:`, error);
    return {
      statusCode: 500,
      body: { status: 'FAILURE', message: error.message || 'Tool execution failed' },
    };
  }
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: ActionGroupEvent): Promise<ActionGroupResponse> => {
  console.log('Action Group Event:', JSON.stringify(event, null, 2));

  // Extract tool name from apiPath (e.g., "/searchPatients" -> "searchPatients")
  const toolName = event.apiPath.replace(/^\//, '');
  const params = parseParameters(event);

  // Get clinic ID from session attributes
  const clinicId = event.sessionAttributes?.clinicId || event.promptSessionAttributes?.clinicId;
  if (!clinicId) {
    return {
      messageVersion: '1.0',
      response: {
        actionGroup: event.actionGroup,
        apiPath: event.apiPath,
        httpMethod: event.httpMethod,
        httpStatusCode: 400,
        responseBody: {
          'application/json': {
            body: JSON.stringify({ status: 'FAILURE', message: 'clinicId is required in session attributes' }),
          },
        },
      },
    };
  }

  // Get clinic config
  const clinicConfig = getClinicConfig(clinicId);
  if (!clinicConfig) {
    return {
      messageVersion: '1.0',
      response: {
        actionGroup: event.actionGroup,
        apiPath: event.apiPath,
        httpMethod: event.httpMethod,
        httpStatusCode: 400,
        responseBody: {
          'application/json': {
            body: JSON.stringify({ status: 'FAILURE', message: `Invalid clinic ID: ${clinicId}` }),
          },
        },
      },
    };
  }

  // Create OpenDental client
  const odClient = new OpenDentalClient(clinicConfig.developerKey, clinicConfig.customerKey);

  // Execute the tool
  const result = await handleTool(toolName, params, odClient, event.sessionAttributes);

  // Build response
  const response: ActionGroupResponse = {
    messageVersion: '1.0',
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: result.statusCode,
      responseBody: {
        'application/json': {
          body: JSON.stringify(result.body),
        },
      },
    },
  };

  // Update session attributes if needed
  if (result.updatedSessionAttributes) {
    response.response.sessionAttributes = result.updatedSessionAttributes;
  }

  console.log('Action Group Response:', JSON.stringify(response, null, 2));
  return response;
};


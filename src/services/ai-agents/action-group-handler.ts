/**
 * Action Group Handler for Bedrock AI Agents
 *
 * Handles patient-facing AI voice/chat requests without any direct
 * OpenDental API integration. All appointment requests, patient inquiries,
 * and service requests are recorded as Callback entries for clinic staff
 * to review and action in their dental management system.
 *
 * Tools exposed to the Bedrock Agent:
 *   - requestAppointment   : Book / schedule a new appointment
 *   - rescheduleAppointment: Request to change an existing appointment time
 *   - cancelAppointment    : Request to cancel an appointment
 *   - getClinicInfo        : Return clinic hours, address, phone, services
 *   - requestCallback      : Generic callback / message for clinic staff
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// CLIENTS & CONFIG
// ============================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CLINICS_TABLE = process.env.CLINICS_TABLE || 'TodaysDentalInsightsChimeN1-Clinics';
const CALLBACK_TABLE_PREFIX = process.env.CALLBACK_TABLE_PREFIX || 'todaysdentalinsights-callback-';
const DEFAULT_CALLBACK_TABLE =
  process.env.DEFAULT_CALLBACK_TABLE || 'todaysdentalinsights-callback-default';

// ============================================================
// BEDROCK ACTION GROUP TYPES
// ============================================================

interface ActionGroupEvent {
  messageVersion: string;
  agent: { name: string; id: string; alias: string; version: string };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters?: Array<{ name: string; type: string; value: string }>;
  requestBody?: {
    content: {
      [contentType: string]: {
        properties: Array<{ name: string; type: string; value: string }>;
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
    responseBody: { [contentType: string]: { body: string } };
    sessionAttributes?: Record<string, string>;
    promptSessionAttributes?: Record<string, string>;
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Flatten all parameters and request body properties into a single map.
 *
 * CRITICAL FIX: Also merge session attributes as lower-priority fallbacks.
 * The Bedrock Agent passes clinicId, callerPhone, patientName etc. via
 * sessionAttributes (set by the WebSocket handler or Lex hook), but may
 * NOT include them as explicit tool parameters. Without this fallback,
 * every tool call fails with 400 "Missing required fields" because
 * clinicId/patientPhone are undefined.
 */
function parseParameters(event: ActionGroupEvent): Record<string, string> {
  const result: Record<string, string> = {};

  // 1. Session attributes as lowest-priority defaults
  //    These are set by the invoking Lambda (WebSocket message handler or
  //    Lex Bedrock hook) and include clinicId, callerPhone, patientName, etc.
  const sessionAttrs = event.sessionAttributes ?? {};
  for (const [key, value] of Object.entries(sessionAttrs)) {
    if (value) result[key] = value;
  }

  // Map common session attribute aliases to the parameter names the tool
  // handlers expect (e.g. callerPhone → patientPhone for voice calls)
  if (!result.patientPhone && (sessionAttrs.callerPhone || sessionAttrs.PatientPhone || sessionAttrs.callerNumber)) {
    result.patientPhone = sessionAttrs.callerPhone || sessionAttrs.PatientPhone || sessionAttrs.callerNumber;
  }
  if (!result.patientName && sessionAttrs.patientName) {
    result.patientName = sessionAttrs.patientName;
  }

  // 2. URL / path parameters (override session defaults)
  for (const p of event.parameters ?? []) {
    if (p.value) result[p.name] = p.value;
  }

  // 3. Request body properties — highest priority (application/json)
  const bodyContent = event.requestBody?.content;
  if (bodyContent) {
    for (const contentType of Object.keys(bodyContent)) {
      for (const prop of bodyContent[contentType]?.properties ?? []) {
        if (prop.value) result[prop.name] = prop.value;
      }
    }
  }

  return result;
}

/**
 * Build a structured Bedrock action group response.
 */
function buildResponse(
  event: ActionGroupEvent,
  statusCode: number,
  body: Record<string, unknown>
): ActionGroupResponse {
  return {
    messageVersion: event.messageVersion || '1.0',
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: statusCode,
      responseBody: {
        'application/json': { body: JSON.stringify(body) },
      },
      sessionAttributes: event.sessionAttributes,
      promptSessionAttributes: event.promptSessionAttributes,
    },
  };
}

/**
 * Persist a callback record to the clinic-specific DynamoDB table,
 * falling back to the default table if the clinic table does not exist.
 */
async function saveCallback(item: Record<string, unknown>): Promise<void> {
  const clinicId = String(item.clinicId || 'unknown');
  const clinicTable = `${CALLBACK_TABLE_PREFIX}${clinicId}`;

  try {
    await docClient.send(new PutCommand({ TableName: clinicTable, Item: item }));
    console.log(`[Callback] Saved ${item.RequestID} to ${clinicTable}`);
  } catch (err: any) {
    if (err?.name === 'ResourceNotFoundException') {
      // Clinic-specific table not yet created — use default
      await docClient.send(new PutCommand({ TableName: DEFAULT_CALLBACK_TABLE, Item: item }));
      console.log(`[Callback] Saved ${item.RequestID} to default table`);
    } else {
      throw err;
    }
  }
}

/**
 * Fetch basic clinic metadata (name, phone, address, hours) from the
 * ChimeStack Clinics table. Returns null if not found.
 */
async function getClinicData(
  clinicId: string
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await docClient.send(
      new GetCommand({ TableName: CLINICS_TABLE, Key: { clinicId } })
    );
    return resp.Item ?? null;
  } catch (err) {
    console.warn(`[getClinicData] Could not fetch clinic ${clinicId}:`, err);
    return null;
  }
}

// ============================================================
// TOOL HANDLERS
// ============================================================

/**
 * requestAppointment
 *
 * Patient wants to book a new appointment. We create a Callback record
 * so that a clinic staff member can confirm and book it in the dental
 * management system.
 *
 * Parameters:
 *   clinicId, patientName, patientPhone, patientEmail?,
 *   preferredDate?, preferredTime?, appointmentReason?, isNewPatient?
 */
async function handleRequestAppointment(
  event: ActionGroupEvent,
  params: Record<string, string>
): Promise<ActionGroupResponse> {
  const {
    clinicId,
    patientName,
    patientPhone,
    patientEmail,
    preferredDate,
    preferredTime,
    appointmentReason,
    isNewPatient,
  } = params;

  if (!clinicId || !patientName || !patientPhone) {
    return buildResponse(event, 400, {
      success: false,
      message:
        'Missing required fields: clinicId, patientName, and patientPhone are required.',
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const preferredSlot =
    [preferredDate, preferredTime].filter(Boolean).join(' at ') ||
    'No preference provided';

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: patientName,
    phone: patientPhone,
    email: patientEmail || undefined,
    message: `New appointment request. Reason: ${appointmentReason || 'General visit'}. Preferred: ${preferredSlot}. New patient: ${isNewPatient || 'unknown'}.`,
    module: 'Operations',
    notes: `Auto-created by AI Agent — patient called to book an appointment. Please confirm availability and call back to schedule.`,
    source: 'ai-agent',
    type: 'appointment-request',
    preferredDate: preferredDate || null,
    preferredTime: preferredTime || null,
    appointmentReason: appointmentReason || null,
    isNewPatient: isNewPatient === 'true' || isNewPatient === '1',
    calledBack: 'NO',
    createdAt: now,
    updatedAt: now,
  };

  await saveCallback(callbackItem);

  return buildResponse(event, 200, {
    success: true,
    requestId,
    message:
      `Your appointment request has been received. A team member from your clinic will call you back at ${patientPhone} to confirm your appointment. ` +
      `If you provided a preferred date of ${preferredDate || 'any time'}, we will do our best to accommodate that.`,
  });
}

/**
 * rescheduleAppointment
 *
 * Patient wants to move an existing appointment to a different day/time.
 * Creates a Callback record for staff to action.
 *
 * Parameters:
 *   clinicId, patientName, patientPhone, currentDate?,
 *   preferredDate?, preferredTime?, reason?
 */
async function handleRescheduleAppointment(
  event: ActionGroupEvent,
  params: Record<string, string>
): Promise<ActionGroupResponse> {
  const {
    clinicId,
    patientName,
    patientPhone,
    currentDate,
    preferredDate,
    preferredTime,
    reason,
  } = params;

  if (!clinicId || !patientName || !patientPhone) {
    return buildResponse(event, 400, {
      success: false,
      message:
        'Missing required fields: clinicId, patientName, and patientPhone are required.',
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: patientName,
    phone: patientPhone,
    message: `Reschedule request. Current appointment: ${currentDate || 'unknown'}. Preferred new slot: ${[preferredDate, preferredTime].filter(Boolean).join(' at ') || 'flexible'}. Reason: ${reason || 'not specified'}.`,
    module: 'Operations',
    notes: `Auto-created by AI Agent — patient requested to reschedule. Please look up the existing appointment and call back.`,
    source: 'ai-agent',
    type: 'reschedule-request',
    currentDate: currentDate || null,
    preferredDate: preferredDate || null,
    preferredTime: preferredTime || null,
    calledBack: 'NO',
    createdAt: now,
    updatedAt: now,
  };

  await saveCallback(callbackItem);

  return buildResponse(event, 200, {
    success: true,
    requestId,
    message:
      `Your reschedule request has been received. A team member will call you at ${patientPhone} to confirm the new appointment time.`,
  });
}

/**
 * cancelAppointment
 *
 * Patient wants to cancel an upcoming appointment.
 * Creates a Callback record for staff to process the cancellation.
 *
 * Parameters:
 *   clinicId, patientName, patientPhone, appointmentDate?, reason?
 */
async function handleCancelAppointment(
  event: ActionGroupEvent,
  params: Record<string, string>
): Promise<ActionGroupResponse> {
  const { clinicId, patientName, patientPhone, appointmentDate, reason } =
    params;

  if (!clinicId || !patientName || !patientPhone) {
    return buildResponse(event, 400, {
      success: false,
      message:
        'Missing required fields: clinicId, patientName, and patientPhone are required.',
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: patientName,
    phone: patientPhone,
    message: `Cancellation request for appointment on ${appointmentDate || 'unknown date'}. Reason: ${reason || 'not specified'}.`,
    module: 'Operations',
    notes: `Auto-created by AI Agent — patient requested cancellation. Please cancel the appointment in the system and update availability.`,
    source: 'ai-agent',
    type: 'cancellation-request',
    appointmentDate: appointmentDate || null,
    calledBack: 'NO',
    createdAt: now,
    updatedAt: now,
  };

  await saveCallback(callbackItem);

  return buildResponse(event, 200, {
    success: true,
    requestId,
    message:
      `Your cancellation request has been received. A team member will process this and send you a confirmation. ` +
      `If you change your mind, please call us back.`,
  });
}

/**
 * getClinicInfo
 *
 * Returns publicly available clinic information: address, phone, hours.
 * This reads from the ChimeStack Clinics DynamoDB table — no external API call.
 *
 * Parameters:
 *   clinicId
 */
async function handleGetClinicInfo(
  event: ActionGroupEvent,
  params: Record<string, string>
): Promise<ActionGroupResponse> {
  const { clinicId } = params;

  if (!clinicId) {
    return buildResponse(event, 400, {
      success: false,
      message: 'clinicId is required.',
    });
  }

  const clinic = await getClinicData(clinicId);

  if (!clinic) {
    return buildResponse(event, 404, {
      success: false,
      message: `Clinic information for '${clinicId}' could not be found. Please contact us directly.`,
    });
  }

  return buildResponse(event, 200, {
    success: true,
    clinic: {
      clinicId: clinic.clinicId,
      name: clinic.clinicName || clinic.name,
      phone: clinic.phoneNumber || clinic.clinicPhone,
      address: clinic.address || clinic.clinicAddress,
      email: clinic.email || clinic.clinicEmail,
      hours: clinic.hours || clinic.officeHours || 'Please call for hours',
      services: clinic.services || [],
      timezone: clinic.timezone || 'America/New_York',
    },
  });
}

/**
 * requestCallback
 *
 * Generic tool for any other patient request that doesn't fit the above
 * (billing questions, insurance queries, general enquiries, etc.).
 * Creates a Callback record for staff.
 *
 * Parameters:
 *   clinicId, patientName, patientPhone, patientEmail?,
 *   message, reason?
 */
async function handleRequestCallback(
  event: ActionGroupEvent,
  params: Record<string, string>
): Promise<ActionGroupResponse> {
  const {
    clinicId,
    patientName,
    patientPhone,
    patientEmail,
    message,
    reason,
  } = params;

  if (!clinicId || !patientName || !patientPhone || !message) {
    return buildResponse(event, 400, {
      success: false,
      message:
        'Missing required fields: clinicId, patientName, patientPhone, and message are required.',
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: patientName,
    phone: patientPhone,
    email: patientEmail || undefined,
    message,
    module: 'Operations',
    notes: `Auto-created by AI Agent. Reason: ${reason || 'General inquiry'}. Patient left a message via the AI phone agent.`,
    source: 'ai-agent',
    type: 'general-callback',
    calledBack: 'NO',
    createdAt: now,
    updatedAt: now,
  };

  await saveCallback(callbackItem);

  return buildResponse(event, 200, {
    success: true,
    requestId,
    message: `Your message has been recorded. A team member will call you back at ${patientPhone} as soon as possible. Thank you!`,
  });
}

// ============================================================
// MAIN HANDLER
// ============================================================

export const handler = async (
  event: ActionGroupEvent
): Promise<ActionGroupResponse> => {
  console.log('[ActionGroupHandler] Event:', JSON.stringify(event, null, 2));

  try {
    // Normalise tool name from apiPath: "/requestAppointment" → "requestAppointment"
    let toolName = event.apiPath.replace(/^\//, '');

    const params = parseParameters(event);

    console.log(`[ActionGroupHandler] Tool: ${toolName}`, {
      mergedParams: params,
      sessionAttributes: event.sessionAttributes,
      rawParameters: event.parameters,
      clinicIdSource: event.parameters?.find(p => p.name === 'clinicId')
        ? 'tool-parameter'
        : event.sessionAttributes?.clinicId
          ? 'session-attribute'
          : 'MISSING',
    });

    switch (toolName) {
      case 'requestAppointment':
        return await handleRequestAppointment(event, params);

      case 'rescheduleAppointment':
        return await handleRescheduleAppointment(event, params);

      case 'cancelAppointment':
        return await handleCancelAppointment(event, params);

      case 'getClinicInfo':
        return await handleGetClinicInfo(event, params);

      case 'requestCallback':
        return await handleRequestCallback(event, params);

      default:
        console.warn(`[ActionGroupHandler] Unknown tool: ${toolName}`);
        return buildResponse(event, 400, {
          success: false,
          message: `Unknown tool '${toolName}'. Supported tools: requestAppointment, rescheduleAppointment, cancelAppointment, getClinicInfo, requestCallback.`,
        });
    }
  } catch (err: any) {
    console.error('[ActionGroupHandler] Unhandled error:', err);
    return buildResponse(event, 500, {
      success: false,
      message:
        'An internal error occurred. Please call the clinic directly to complete your request.',
    });
  }
};

/**
 * Action Group Handler for Bedrock Agent
 *
 * Handles tool calls from the AI dental assistant. All appointment requests, patient inquiries,
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

  // Helper: detect unresolved Bedrock template variables like "$clinicName" or "{toolName}"
  const isUnresolved = (v: string) => !v || v.startsWith('$') || (v.startsWith('{') && v.endsWith('}'));

  // 2. URL / path parameters (override session defaults, skip unresolved templates)
  for (const p of event.parameters ?? []) {
    if (p.value && !isUnresolved(p.value)) result[p.name] = p.value;
  }

  // 3. Request body properties — highest priority (application/json)
  //    Skip unresolved template variables (e.g. "$clinicName") that Bedrock
  //    sends when using the proxy schema — these would overwrite valid
  //    session attribute values.
  const bodyContent = event.requestBody?.content;
  if (bodyContent) {
    for (const contentType of Object.keys(bodyContent)) {
      for (const prop of bodyContent[contentType]?.properties ?? []) {
        if (prop.value && !isUnresolved(prop.value)) result[prop.name] = prop.value;
      }
    }
  }

  // 4. FORCE clinicId from session attributes — Bedrock's body values are
  //    unreliable (sends "clinicName", "$clinicName", etc.)
  if (sessionAttrs.clinicId) {
    result.clinicId = sessionAttrs.clinicId;
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
    patientPhone,
    patientEmail,
    preferredDate,
    preferredTime,
    appointmentReason,
    isNewPatient,
  } = params;

  if (!clinicId) {
    return buildResponse(event, 400, {
      success: false,
      message: 'Missing required field: clinicId is required.',
    });
  }

  // CRITICAL FIX: Reject requests with missing patient info.
  // When the AI eagerly calls this tool with empty fields, return a message
  // that instructs it to go back and ask the user for the info.
  const effectiveName = params.patientName || params.userName;
  const effectivePhone = patientPhone || params.callerPhone;
  const effectiveReason = appointmentReason || params.Reason || params.reason;

  const missingFields: string[] = [];
  if (!effectiveName || effectiveName === 'Website Visitor' || effectiveName === 'Unknown') {
    missingFields.push('patient\'s full name');
  }
  if (!effectivePhone) {
    missingFields.push('phone number');
  }
  if (!effectiveReason) {
    missingFields.push('reason for the visit');
  }

  if (missingFields.length > 0) {
    console.log(`[requestAppointment] Missing fields, instructing agent to collect: ${missingFields.join(', ')}`);
    // Build a list of what is already confirmed so the agent does NOT re-ask for it
    const alreadyHave: string[] = [];
    if (effectiveName && effectiveName !== 'Website Visitor' && effectiveName !== 'Unknown') {
      alreadyHave.push(`name="${effectiveName}"`);
    }
    if (effectivePhone) alreadyHave.push(`phone="${effectivePhone}"`);
    if (effectiveReason) alreadyHave.push(`reason="${effectiveReason}"`);
    const haveClause = alreadyHave.length > 0
      ? ` You already have: ${alreadyHave.join(', ')} — do NOT ask for these again.`
      : '';
    return buildResponse(event, 200, {
      success: false,
      message:
        `Still need: ${missingFields.join(', ')}.${haveClause} ` +
        `Ask the patient ONLY for the missing item(s) listed above, one at a time. ` +
        `Do NOT restart the booking flow or re-ask for information already collected. ` +
        `Once you have the missing info, call requestAppointment again with all details.`,
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const effectiveDate = preferredDate || params.Date || params.date || null;
  const preferredSlot =
    [effectiveDate, preferredTime].filter(Boolean).join(' at ') ||
    'No preference provided';

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: effectiveName,
    phone: effectivePhone,
    email: patientEmail || undefined,
    message: `New appointment request. Reason: ${effectiveReason}. Preferred: ${preferredSlot}. New patient: ${isNewPatient || 'unknown'}.`,
    module: 'Operations',
    notes: `Auto-created by AI Agent — patient requested an appointment via website chat. Please confirm availability and follow up.`,
    source: 'ai-agent',
    type: 'appointment-request',
    preferredDate: effectiveDate,
    preferredTime: preferredTime || null,
    appointmentReason: effectiveReason,
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
      `Your appointment request has been received! A team member will follow up with you to confirm your appointment. ` +
      `Preferred date: ${effectiveDate || 'flexible'}. Reason: ${effectiveReason}.`,
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

  if (!clinicId) {
    return buildResponse(event, 400, {
      success: false,
      message: 'Missing required field: clinicId.',
    });
  }

  // Validate required patient info before saving
  const effectiveName = patientName || params.userName;
  const effectivePhone = patientPhone || params.callerPhone;

  const missingFields: string[] = [];
  if (!effectiveName || effectiveName === 'Website Visitor' || effectiveName === 'Unknown') {
    missingFields.push('patient\'s full name');
  }
  if (!effectivePhone) {
    missingFields.push('phone number');
  }

  if (missingFields.length > 0) {
    console.log(`[rescheduleAppointment] Missing fields: ${missingFields.join(', ')}`);
    return buildResponse(event, 200, {
      success: false,
      message:
        `Cannot create reschedule request yet — missing: ${missingFields.join(', ')}. ` +
        `Please ask the patient for each missing piece of information one at a time, then call this tool again.`,
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: effectiveName,
    phone: effectivePhone,
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
      `Your reschedule request has been received. A team member will call you at ${effectivePhone} to confirm the new appointment time.`,
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

  if (!clinicId) {
    return buildResponse(event, 400, {
      success: false,
      message: 'Missing required field: clinicId.',
    });
  }

  // Validate required patient info before saving
  const effectiveName = patientName || params.userName;
  const effectivePhone = patientPhone || params.callerPhone;

  const missingFields: string[] = [];
  if (!effectiveName || effectiveName === 'Website Visitor' || effectiveName === 'Unknown') {
    missingFields.push('patient\'s full name');
  }
  if (!effectivePhone) {
    missingFields.push('phone number');
  }

  if (missingFields.length > 0) {
    console.log(`[cancelAppointment] Missing fields: ${missingFields.join(', ')}`);
    return buildResponse(event, 200, {
      success: false,
      message:
        `Cannot create cancellation request yet — missing: ${missingFields.join(', ')}. ` +
        `Please ask the patient for each missing piece of information one at a time, then call this tool again.`,
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: effectiveName,
    phone: effectivePhone,
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
 * Returns publicly available clinic information: address, phone, website, etc.
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

  // Build a comprehensive clinic info object from all available fields.
  // Field names vary between clinics — try all known variants.
  const clinicInfo: Record<string, unknown> = {
    clinicId: clinic.clinicId,
    name: clinic.clinicName || clinic.name || clinicId,
    phone: clinic.clinicPhone || clinic.phoneNumber || 'Please call for our phone number',
    address: clinic.clinicAddress || clinic.address || 'Please call for our address',
    city: clinic.clinicCity || undefined,
    state: clinic.clinicState || undefined,
    zipCode: clinic.clinicZipCode || undefined,
    email: clinic.clinicEmail || clinic.email || undefined,
    website: clinic.websiteLink || clinic.website || undefined,
    directionsUrl: clinic.mapsUrl || undefined,
    bookingUrl: clinic.scheduleUrl || undefined,
    timezone: clinic.timezone || 'America/New_York',
  };

  // Remove undefined fields for cleaner responses
  Object.keys(clinicInfo).forEach(key => {
    if (clinicInfo[key] === undefined) delete clinicInfo[key];
  });

  return buildResponse(event, 200, {
    success: true,
    clinic: clinicInfo,
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

  if (!clinicId) {
    return buildResponse(event, 400, {
      success: false,
      message: 'Missing required field: clinicId.',
    });
  }

  // Validate required patient info before saving
  const effectiveName = patientName || params.userName;
  const effectivePhone = patientPhone || params.callerPhone;
  const effectiveMessage = message || reason;

  const missingFields: string[] = [];
  if (!effectiveName || effectiveName === 'Website Visitor' || effectiveName === 'Unknown') {
    missingFields.push('patient\'s full name');
  }
  if (!effectivePhone) {
    missingFields.push('phone number');
  }
  if (!effectiveMessage) {
    missingFields.push('reason for the callback');
  }

  if (missingFields.length > 0) {
    console.log(`[requestCallback] Missing fields: ${missingFields.join(', ')}`);
    return buildResponse(event, 200, {
      success: false,
      message:
        `Cannot create callback request yet — missing: ${missingFields.join(', ')}. ` +
        `Please ask the patient for each missing piece of information one at a time, then call this tool again.`,
    });
  }

  const now = new Date().toISOString();
  const requestId = uuidv4();

  const callbackItem = {
    RequestID: requestId,
    clinicId,
    name: effectiveName,
    phone: effectivePhone,
    email: patientEmail || undefined,
    message: effectiveMessage,
    module: 'Operations',
    notes: `Auto-created by AI Agent. Reason: ${reason || effectiveMessage}. Patient contacted via website chat.`,
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
    message: `Your request has been recorded. A team member will follow up with you as soon as possible. Thank you!`,
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
    // Normalise tool name from apiPath
    // Handles direct paths ("/requestAppointment" → "requestAppointment"),
    // proxy paths ("/open-dental/scheduleAppointment" → "scheduleAppointment"),
    // and literal templates ("/open-dental/{toolName}" → extract from parameters/body)
    let toolName = event.apiPath.replace(/^\//, '').replace(/^open-dental\//, '');

    // CRITICAL FIX: When Bedrock uses the proxy schema, apiPath is the literal
    // template "/open-dental/{toolName}" — the {toolName} is NOT resolved.
    // The actual tool name comes as a parameter named "toolName" in the event.
    if (toolName.includes('{') || toolName === '{toolName}') {
      const fromParams = event.parameters?.find(p => p.name === 'toolName')?.value;
      const fromBody = event.requestBody?.content?.['application/json']?.properties
        ?.find((p: any) => p.name === 'toolName')?.value;
      toolName = fromParams || fromBody || toolName;
      console.log(`[ActionGroupHandler] Resolved toolName from parameters: ${toolName}`);
    }

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
      // Appointment booking
      case 'requestAppointment':
      case 'scheduleAppointment':
        return await handleRequestAppointment(event, params);

      case 'rescheduleAppointment':
        return await handleRescheduleAppointment(event, params);

      // Cancellation
      case 'cancelAppointment':
      case 'breakAppointment':
        return await handleCancelAppointment(event, params);

      case 'getClinicInfo':
        return await handleGetClinicInfo(event, params);

      case 'requestCallback':
        return await handleRequestCallback(event, params);

      default:
        console.warn(`[ActionGroupHandler] Unknown/unsupported tool: ${toolName}`);
        // Return a helpful message that guides the AI to use callback-based tools
        return buildResponse(event, 200, {
          success: false,
          message:
            `The tool '${toolName}' is not directly supported. ` +
            `To book an appointment, use requestAppointment or scheduleAppointment. ` +
            `To reschedule, use rescheduleAppointment. ` +
            `To cancel, use cancelAppointment. ` +
            `For other requests, use requestCallback to leave a message for staff.`,
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

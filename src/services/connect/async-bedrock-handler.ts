/**
 * Async Bedrock Handler for Amazon Connect
 * 
 * Implements the async Lambda pattern to overcome Connect's 8-second sync limit:
 * 
 * 1. START: Connect invokes `startAsync` asynchronously (up to 60s timeout)
 *    - Returns immediately with { requestId, status: 'started' }
 *    - Lambda continues running in background, invokes Bedrock, stores result
 * 
 * 2. POLL: Connect loops calling `checkResult` (sync, must be fast)
 *    - Returns { status: 'pending|completed|error', aiResponse? }
 *    - Connect plays keyboard sound between polls
 * 
 * This allows Bedrock agent tool calls (like patient search) to take 10-30+ seconds
 * while the caller hears continuous typing sounds.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getDateContext } from '../../shared/prompts/ai-prompts';

// ========================================================================
// CONFIGURATION
// ========================================================================

const ASYNC_RESULTS_TABLE = process.env.ASYNC_RESULTS_TABLE || 'ConnectAsyncResults';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'AiAgentSessions';
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE || '';
const RESULT_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || 'dentistingreenville';

type SpeakingRate = 'x-slow' | 'slow' | 'medium' | 'fast' | 'x-fast';
type Pitch = 'x-low' | 'low' | 'medium' | 'high' | 'x-high';
type Volume = 'silent' | 'x-soft' | 'soft' | 'medium' | 'loud' | 'x-loud';

interface ProsodySettings {
  speakingRate: SpeakingRate;
  pitch: Pitch;
  volume: Volume;
}

const DEFAULT_PROSODY: ProsodySettings = {
  speakingRate: 'medium',
  pitch: 'medium',
  volume: 'medium',
};

const ALLOWED_SPEAKING_RATES = new Set<SpeakingRate>(['x-slow', 'slow', 'medium', 'fast', 'x-fast']);
const ALLOWED_PITCH = new Set<Pitch>(['x-low', 'low', 'medium', 'high', 'x-high']);
const ALLOWED_VOLUME = new Set<Volume>(['silent', 'x-soft', 'soft', 'medium', 'loud', 'x-loud']);

function normalizeProsody<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const raw = typeof value === 'string' ? value.trim() : '';
  return (raw && allowed.has(raw as T)) ? (raw as T) : fallback;
}

function getProsodyFromContactAttributes(attrs: Record<string, string>): ProsodySettings {
  return {
    speakingRate: normalizeProsody(attrs.ttsSpeakingRate, ALLOWED_SPEAKING_RATES, DEFAULT_PROSODY.speakingRate),
    pitch: normalizeProsody(attrs.ttsPitch, ALLOWED_PITCH, DEFAULT_PROSODY.pitch),
    volume: normalizeProsody(attrs.ttsVolume, ALLOWED_VOLUME, DEFAULT_PROSODY.volume),
  };
}

// AI phone numbers mapping: aiPhoneNumber -> clinicId
const AI_PHONE_NUMBERS_JSON = process.env.AI_PHONE_NUMBERS_JSON || '{}';
let aiPhoneNumberMap: Record<string, string> = {};
try {
  aiPhoneNumberMap = JSON.parse(AI_PHONE_NUMBERS_JSON);
} catch (e) {
  console.warn('[AsyncBedrock] Failed to parse AI_PHONE_NUMBERS_JSON:', e);
}

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});
const bedrockAgentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Used by the START path to spawn a separate background invocation that can run up to the Lambda timeout.
// Defaulting to AWS_LAMBDA_FUNCTION_NAME allows "self-invocation" without extra wiring.
const ASYNC_WORKER_FUNCTION_NAME =
  process.env.ASYNC_WORKER_FUNCTION_NAME ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  '';

// ========================================================================
// TYPES
// ========================================================================

interface AsyncResult {
  requestId: string;
  contactId: string;
  status: 'pending' | 'completed' | 'error';
  response?: string;
  ssmlResponse?: string;
  errorMessage?: string;
  toolsUsed?: string[];
  startedAt: string;
  completedAt?: string;
  pollCount?: number;
  lastPolledAt?: string;
  ttl: number;
}

interface AgentInfo {
  agentId: string;
  aliasId: string;
  agentName?: string;
  internalAgentId?: string;
}

// PERFORMANCE: Cache agent lookups to avoid repeated DynamoDB queries
const agentCache = new Map<string, { agent: AgentInfo | null; timestamp: number }>();
const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ========================================================================
// AGENT LOOKUP (reused from lex-bedrock-hook.ts)
// ========================================================================

function isCallableVoiceAgentRecord(agent: any, clinicId: string): boolean {
  if (!agent) return false;
  const belongsToClinic = agent.clinicId === clinicId || agent.isPublic === true;
  return (
    belongsToClinic &&
    agent.isActive === true &&
    agent.isVoiceEnabled === true &&
    agent.bedrockAgentStatus === 'PREPARED' &&
    typeof agent.bedrockAgentId === 'string' &&
    agent.bedrockAgentId.trim().length > 0 &&
    typeof agent.bedrockAgentAliasId === 'string' &&
    agent.bedrockAgentAliasId.trim().length > 0
  );
}

function toAgentInfo(agent: any): AgentInfo | null {
  const bedrockAgentId = typeof agent?.bedrockAgentId === 'string' ? agent.bedrockAgentId.trim() : '';
  const bedrockAgentAliasId = typeof agent?.bedrockAgentAliasId === 'string' ? agent.bedrockAgentAliasId.trim() : '';
  if (!bedrockAgentId || !bedrockAgentAliasId) return null;

  return {
    agentId: bedrockAgentId,
    aliasId: bedrockAgentAliasId,
    agentName: (agent.agentName || agent.name || '').toString(),
    internalAgentId: (agent.agentId || '').toString(),
  };
}

async function getAgentRecordById(agentId: string): Promise<any | null> {
  const id = typeof agentId === 'string' ? agentId.trim() : '';
  if (!id) return null;

  try {
    const resp = await docClient.send(new GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId: id },
    }));
    return resp.Item || null;
  } catch (error: any) {
    console.warn('[AsyncBedrock] Error getting agent by id', {
      agentId: id,
      error: error?.message || String(error),
    });
    return null;
  }
}

async function getConfiguredInboundAgentIdFromVoiceConfig(clinicId: string): Promise<string | null> {
  const effectiveClinicId = clinicId || DEFAULT_CLINIC_ID;
  if (!VOICE_CONFIG_TABLE) return null;

  try {
    const resp = await docClient.send(new GetCommand({
      TableName: VOICE_CONFIG_TABLE,
      Key: { clinicId: effectiveClinicId },
      ProjectionExpression: 'inboundAgentId, aiInboundEnabled',
    }));
    const cfg = resp.Item as any;
    if (!cfg) return null;

    // If explicitly disabled, do not use a configured agent.
    if (cfg.aiInboundEnabled === false) return null;

    const id = typeof cfg.inboundAgentId === 'string' ? cfg.inboundAgentId.trim() : '';
    return id || null;
  } catch (error: any) {
    console.warn('[AsyncBedrock] Failed to load configured inbound agent from voice config', {
      clinicId: effectiveClinicId,
      error: error?.message || String(error),
    });
    return null;
  }
}

async function getAgentForClinic(clinicId: string): Promise<AgentInfo | null> {
  const effectiveClinicId = clinicId || DEFAULT_CLINIC_ID;

  // Check cache first
  const cached = agentCache.get(effectiveClinicId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }

  // 1) Prefer configured inbound agent from VoiceAgentConfig (matches lex-bedrock-hook behavior)
  const configuredId = await getConfiguredInboundAgentIdFromVoiceConfig(effectiveClinicId);
  if (configuredId) {
    const record = await getAgentRecordById(configuredId);
    if (isCallableVoiceAgentRecord(record, effectiveClinicId)) {
      const resolved = toAgentInfo(record);
      if (resolved) {
        agentCache.set(effectiveClinicId, { agent: resolved, timestamp: Date.now() });
        console.log('[AsyncBedrock] Using configured inbound voice agent', {
          clinicId: effectiveClinicId,
          internalAgentId: resolved.internalAgentId,
          bedrockAgentId: resolved.agentId,
        });
        return resolved;
      }
    }

    console.warn('[AsyncBedrock] Configured inbound agent not callable; falling back', {
      clinicId: effectiveClinicId,
      configuredId,
      hasRecord: !!record,
      isVoiceEnabled: record?.isVoiceEnabled,
      status: record?.bedrockAgentStatus,
    });
  }

  // 2) Fallback: choose best callable voice agent for the clinic
  try {
    const allAgents = await docClient.send(new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: {
        ':clinicId': effectiveClinicId,
      },
      Limit: 50,
      ScanIndexForward: false,
    }));

    const items = (allAgents.Items || []) as any[];
    if (items.length === 0) {
      agentCache.set(effectiveClinicId, { agent: null, timestamp: Date.now() });
      return null;
    }

    const callable = items.filter((a: any) => isCallableVoiceAgentRecord(a, effectiveClinicId));
    if (callable.length === 0) {
      console.warn('[AsyncBedrock] No callable voice-capable agent found for clinic', {
        clinicId: effectiveClinicId,
        scanned: items.length,
      });
      agentCache.set(effectiveClinicId, { agent: null, timestamp: Date.now() });
      return null;
    }

    // Prioritize a default voice agent if present
    const selectedAgent = callable.find((a: any) => a.isDefaultVoiceAgent === true) || callable[0];
    const agentInfo = toAgentInfo(selectedAgent);
    if (!agentInfo) {
      agentCache.set(effectiveClinicId, { agent: null, timestamp: Date.now() });
      return null;
    }

    agentCache.set(effectiveClinicId, { agent: agentInfo, timestamp: Date.now() });
    console.log('[AsyncBedrock] Selected fallback voice agent for clinic', {
      clinicId: effectiveClinicId,
      internalAgentId: agentInfo.internalAgentId,
      bedrockAgentId: agentInfo.agentId,
    });
    return agentInfo;
  } catch (error) {
    console.error('[AsyncBedrock] Error looking up agent:', error);
    agentCache.set(effectiveClinicId, { agent: null, timestamp: Date.now() });
    return null;
  }
}

// ========================================================================
// SESSION MANAGEMENT
// ========================================================================

interface SessionInfo {
  bedrockSessionId: string;
  clinicId: string;
}

async function getOrCreateSession(contactId: string, clinicId: string): Promise<SessionInfo> {
  const sessionKey = `lex-${contactId}`;

  try {
    const existing = await docClient.send(new GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: sessionKey },
    }));

    if (existing.Item) {
      return {
        bedrockSessionId: existing.Item.bedrockSessionId,
        clinicId: existing.Item.clinicId || clinicId,
      };
    }
  } catch (error) {
    console.warn('[AsyncBedrock] Error getting session:', error);
  }

  // Create new session
  const bedrockSessionId = uuidv4();
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (60 * 60); // 1 hour TTL

  try {
    await docClient.send(new PutCommand({
      TableName: SESSIONS_TABLE,
      Item: {
        sessionId: sessionKey,
        callId: `connect-${contactId}`,
        clinicId,
        bedrockSessionId,
        callStartMs: now,
        turnCount: 1,
        createdAt: new Date(now).toISOString(),
        lastActivity: new Date(now).toISOString(),
        ttl,
      },
    }));
  } catch (error) {
    console.error('[AsyncBedrock] Error creating session:', error);
  }

  return { bedrockSessionId, clinicId };
}

// ========================================================================
// START ASYNC INVOCATION
// ========================================================================

/**
 * Called by Connect asynchronously. Returns immediately with requestId.
 * Continues running in background to invoke Bedrock and store result.
 */
async function startAsync(event: any): Promise<{ requestId: string; status: string }> {
  const contactData = event.Details?.ContactData;
  const params = event.Details?.Parameters || {};

  const contactId = contactData?.ContactId || '';
  const inputTranscript = params.inputTranscript || '';
  const callerNumber = contactData?.CustomerEndpoint?.Address || '';
  const dialedNumber = contactData?.SystemEndpoint?.Address || '';
  const contactAttributes = contactData?.Attributes || {};

  const requestId = uuidv4();
  const now = new Date().toISOString();

  console.log('[AsyncBedrock] Starting async invocation:', {
    requestId,
    contactId,
    inputText: inputTranscript.substring(0, 50),
  });

  // Determine clinic from dialed number
  let clinicId = contactAttributes.clinicId || '';
  if (!clinicId && dialedNumber) {
    const normalizedDialed = dialedNumber.replace(/\D/g, '');
    for (const [phone, clinic] of Object.entries(aiPhoneNumberMap)) {
      if (phone.replace(/\D/g, '') === normalizedDialed) {
        clinicId = clinic;
        break;
      }
    }
  }
  if (!clinicId) {
    clinicId = DEFAULT_CLINIC_ID;
  }

  const prosody = getProsodyFromContactAttributes(contactAttributes);

  // Store pending status immediately (so polling can start)
  const pendingResult: AsyncResult = {
    requestId,
    contactId,
    status: 'pending',
    startedAt: now,
    pollCount: 0,
    ttl: Math.floor(Date.now() / 1000) + RESULT_TTL_SECONDS,
  };

  await docClient.send(new PutCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Item: pendingResult,
  }));

  // Spawn a separate invocation (InvocationType=Event) to do the long Bedrock work.
  // This is the crucial piece that avoids relying on "work continues after return",
  // which is not a safe assumption for Lambda runtimes.
  if (!ASYNC_WORKER_FUNCTION_NAME) {
    console.error('[AsyncBedrock] Missing ASYNC_WORKER_FUNCTION_NAME/AWS_LAMBDA_FUNCTION_NAME');
    const response = "I'm sorry, the AI assistant is not available right now. Please try again.";
    await updateResult(requestId, {
      status: 'error',
      response,
      ssmlResponse: buildProsodySsml(response, prosody),
      errorMessage: 'Missing ASYNC_WORKER_FUNCTION_NAME',
    });
    throw new Error('Missing ASYNC_WORKER_FUNCTION_NAME');
  }

  try {
    const payload = {
      Details: {
        Parameters: {
          functionType: 'process',
          requestId,
          contactId,
          inputText: inputTranscript.trim(),
          clinicId,
          callerNumber,
          dialedNumber,
          timezone: String(contactAttributes.timezone || 'UTC'),
          ttsSpeakingRate: prosody.speakingRate,
          ttsPitch: prosody.pitch,
          ttsVolume: prosody.volume,
          // Patient identity from the welcome lookup (if present)
          PatNum: String(contactAttributes.PatNum || '').trim(),
          FName: String(contactAttributes.FName || '').trim(),
          LName: String(contactAttributes.LName || '').trim(),
          Birthdate: String(contactAttributes.Birthdate || '').trim(),
          IsNewPatient: String(contactAttributes.IsNewPatient || contactAttributes.isNewPatient || '').trim(),
          patientName: String(contactAttributes.patientName || '').trim(),
          patientFirstName: String(contactAttributes.patientFirstName || '').trim(),
          initialGreetingAlreadyPlayed: 'true',
        },
      },
    };

    await lambdaClient.send(new InvokeCommand({
      FunctionName: ASYNC_WORKER_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(payload)),
    }));
  } catch (err: any) {
    console.error('[AsyncBedrock] Failed to invoke async worker:', err);
    const response = "I'm sorry, I'm having trouble right now. Please try again.";
    await updateResult(requestId, {
      status: 'error',
      response,
      ssmlResponse: buildProsodySsml(response, prosody),
      errorMessage: err?.message || 'Failed to invoke async worker',
    });
    throw err;
  }

  // Return immediately so Connect can start playing thinking sounds
  return {
    requestId,
    status: 'started',
  };
}

/**
 * Background task that invokes Bedrock and stores the result
 */
async function processBedrockInvocation(params: {
  requestId: string;
  contactId: string;
  inputText: string;
  clinicId: string;
  callerNumber?: string;
  dialedNumber?: string;
  timezone?: string;
  ttsSpeakingRate?: string;
  ttsPitch?: string;
  ttsVolume?: string;
  // Patient identity from welcome lookup (optional)
  PatNum?: string;
  FName?: string;
  LName?: string;
  Birthdate?: string;
  IsNewPatient?: string;
  patientName?: string;
  patientFirstName?: string;
  initialGreetingAlreadyPlayed?: string;
}): Promise<void> {
  const { requestId, contactId, inputText, clinicId } = params;
  const prosody: ProsodySettings = {
    speakingRate: normalizeProsody(params.ttsSpeakingRate, ALLOWED_SPEAKING_RATES, DEFAULT_PROSODY.speakingRate),
    pitch: normalizeProsody(params.ttsPitch, ALLOWED_PITCH, DEFAULT_PROSODY.pitch),
    volume: normalizeProsody(params.ttsVolume, ALLOWED_VOLUME, DEFAULT_PROSODY.volume),
  };

  try {
    // Handle empty input
    if (!inputText) {
      const response = "I'm sorry, I didn't catch that. Could you please repeat what you said?";
      await updateResult(requestId, {
        status: 'completed',
        response,
        ssmlResponse: buildProsodySsml(response, prosody),
      });
      return;
    }

    // Get session and agent
    const session = await getOrCreateSession(contactId, clinicId);
    const agent = await getAgentForClinic(session.clinicId);

    if (!agent) {
      const response = "I'm sorry, the AI assistant is not available right now. Please call back during office hours.";
      await updateResult(requestId, {
        status: 'error',
        errorMessage: `No Bedrock agent configured for clinic: ${clinicId}`,
        response,
        ssmlResponse: buildProsodySsml(response, prosody),
      });
      return;
    }

    console.log('[AsyncBedrock] Invoking Bedrock agent:', {
      requestId,
      agentId: agent.agentId,
      sessionId: session.bedrockSessionId,
    });

    // Add lightweight date context so the agent can resolve "tomorrow", weekdays, etc.
    const timezone = String(params.timezone || 'UTC').trim() || 'UTC';
    const d = getDateContext(timezone);
    const [year, month, day] = d.today.split('-');
    const todayFormatted = `${month}/${day}/${year}`;

    const callerNumber = String(params.callerNumber || '').trim();
    const dialedNumber = String(params.dialedNumber || '').trim();
    const patNum = String(params.PatNum || '').trim();
    const fName = String(params.FName || params.patientFirstName || '').trim();
    const lName = String(params.LName || '').trim();
    const birthdate = String(params.Birthdate || '').trim();
    const isNewPatient = String(params.IsNewPatient || '').trim();
    const resolvedPatientName =
      String(params.patientName || '').trim() ||
      [fName, lName].filter(Boolean).join(' ').trim();

    // Bedrock Agents do not always reliably surface session attributes to the LLM.
    // To prevent the agent from re-asking for name/DOB when we already identified the caller,
    // include a compact, non-spoken context prefix in the input text.
    const inputTextForAgent = (() => {
      const raw = String(inputText || '').trim();
      if (!patNum) return raw;
      const name = resolvedPatientName || 'the caller';
      const newFlag = isNewPatient === 'true' || isNewPatient === 'false' ? isNewPatient : 'unknown';
      const context = [
        'SYSTEM CONTEXT (do not read aloud):',
        `Caller is already identified in OpenDental: ${name} (PatNum ${patNum}).`,
        `IsNewPatient=${newFlag}.`,
        'Do NOT ask for first name, last name, date of birth, or phone number again.',
        'Use the inbound caller ID as the phone number unless the caller says it is different or blocked.',
        'If they want to book/schedule an appointment and have NOT given a reason yet: ask "Perfect. May I know the reason for the appointment?" and STOP. Wait for their answer before calling any scheduling tools.',
        'After you have the reason, ask: "When would you like to schedule?"',
        'When booking, choose an appointment type that matches BOTH the reason and patient status (IsNewPatient=false → "existing patient" types; IsNewPatient=true → "new patient" types).',
      ].join(' ');
      return `${context}\n\nCaller: ${raw}`;
    })();

    const sessionAttributes: Record<string, string> = {
      clinicId: session.clinicId,
      callerNumber,
      dialedNumber,
      callerPhone: callerNumber,
      PatientPhone: callerNumber,
      contactId,
      inputMode: 'Speech',
      channel: 'voice',
      initialGreetingAlreadyPlayed: 'true',
      todayDate: d.today,
      todayFormatted,
      dayName: d.dayName,
      tomorrowDate: d.tomorrowDate,
      currentTime: d.currentTime,
      nextWeekDates: JSON.stringify(d.nextWeekDates),
      timezone: d.timezone,
    };

    // If we already identified the patient at call start, pass it into the agent session
    // so it DOES NOT re-ask for first name / DOB.
    if (patNum) sessionAttributes.PatNum = patNum;
    if (fName) sessionAttributes.FName = fName;
    if (lName) sessionAttributes.LName = lName;
    if (birthdate) sessionAttributes.Birthdate = birthdate;
    if (isNewPatient === 'true' || isNewPatient === 'false') sessionAttributes.IsNewPatient = isNewPatient;
    if (resolvedPatientName) sessionAttributes.patientName = resolvedPatientName;

    // Invoke Bedrock agent (this can take 10-30+ seconds with tool calls)
    const command = new InvokeAgentCommand({
      agentId: agent.agentId,
      agentAliasId: agent.aliasId,
      sessionId: session.bedrockSessionId,
      inputText: inputTextForAgent,
      sessionState: {
        sessionAttributes,
        promptSessionAttributes: {
          callerNumber,
          currentDate: `Today is ${d.dayName}, ${todayFormatted} (${d.today}). Current time: ${d.currentTime} (${d.timezone})`,
          dateContext: `When scheduling appointments, use ${d.today} as today's date. Tomorrow is ${d.tomorrowDate}. Next week dates: ${JSON.stringify(d.nextWeekDates)}`,
          ...(patNum
            ? {
                patientContext: `Caller already identified in OpenDental: ${resolvedPatientName || 'Patient'} (PatNum ${patNum}). IsNewPatient=${(isNewPatient === 'true' || isNewPatient === 'false') ? isNewPatient : 'unknown'}. Do NOT ask for first name, last name, date of birth, or phone number again. Use the inbound caller ID as the phone number unless the caller says it is different or blocked. If they want to book/schedule an appointment and have NOT given a reason yet: ask "Perfect. May I know the reason for the appointment?" and STOP. Wait for their answer before calling any scheduling tools. After you have the reason, ask: "When would you like to schedule?" When booking, choose an appointment type that matches BOTH the reason and patient status (IsNewPatient=false → "existing patient" types; IsNewPatient=true → "new patient" types).`,
              }
            : {}),
        },
      },
    });

    const response = await bedrockAgentClient.send(command);

    let fullResponse = '';
    const toolsUsed: string[] = [];

    if (response.completion) {
      for await (const chunk of response.completion) {
        if (chunk.chunk?.bytes) {
          fullResponse += new TextDecoder().decode(chunk.chunk.bytes);
        }
        // Track tools used
        if ((chunk as any).trace?.trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const actionGroup = (chunk as any).trace.trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          if (actionGroup.function) {
            toolsUsed.push(actionGroup.function);
          }
        }
      }
    }

    console.log('[AsyncBedrock] Bedrock completed:', {
      requestId,
      responseLength: fullResponse.length,
      toolsUsed,
    });

    const rawResponse = (fullResponse.trim() || "I'm sorry, I couldn't process that. How else can I help you?");
    const safeResponse = sanitizeVoiceTtsText(rawResponse);

    await updateResult(requestId, {
      status: 'completed',
      response: safeResponse,
      ssmlResponse: buildProsodySsml(safeResponse, prosody),
      toolsUsed: [...new Set(toolsUsed)],
    });

  } catch (error: any) {
    console.error('[AsyncBedrock] Bedrock invocation error:', error);

    const response = "I'm sorry, I had trouble processing that. Could you please try again?";
    await updateResult(requestId, {
      status: 'error',
      errorMessage: error.message || 'Unknown error',
      response,
      ssmlResponse: buildProsodySsml(response, prosody),
    });
  }
}

/**
 * Update the result in DynamoDB for polling.
 * Uses UpdateItem so we don't clobber fields like startedAt/pollCount.
 */
async function updateResult(
  requestId: string,
  result: {
    status: 'completed' | 'error';
    response?: string;
    ssmlResponse?: string;
    errorMessage?: string;
    toolsUsed?: string[];
  }
): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + RESULT_TTL_SECONDS;

  await docClient.send(new UpdateCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Key: { requestId },
    UpdateExpression: [
      'SET #status = :status',
      '#response = :response',
      '#ssmlResponse = :ssmlResponse',
      '#completedAt = :completedAt',
      '#ttl = :ttl',
      '#errorMessage = :errorMessage',
      '#toolsUsed = :toolsUsed',
    ].join(', '),
    ExpressionAttributeNames: {
      '#status': 'status',
      '#response': 'response',
      '#ssmlResponse': 'ssmlResponse',
      '#completedAt': 'completedAt',
      '#ttl': 'ttl',
      '#errorMessage': 'errorMessage',
      '#toolsUsed': 'toolsUsed',
    },
    ExpressionAttributeValues: {
      ':status': result.status,
      ':response': result.response || '',
      ':ssmlResponse': result.ssmlResponse || '',
      ':completedAt': now,
      ':ttl': ttl,
      ':errorMessage': result.errorMessage || '',
      ':toolsUsed': result.toolsUsed || [],
    },
  }));
}

// ========================================================================
// CHECK RESULT (called by Connect sync - must be fast)
// ========================================================================

/**
 * Called by Connect synchronously to poll for results.
 * Must complete in <2 seconds.
 */
async function checkResult(event: any): Promise<{
  status: string;
  aiResponse?: string;
  ssmlResponse?: string;
}> {
  const params = event.Details?.Parameters || {};
  const requestId = params.requestId || '';
  const contactAttributes = event.Details?.ContactData?.Attributes || {};
  const prosody = getProsodyFromContactAttributes(contactAttributes);

  if (!requestId) {
    console.warn('[AsyncBedrock] checkResult called without requestId');
    const aiResponse = "I'm sorry, there was an error. Please try again.";
    return {
      status: 'error',
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody),
    };
  }

  try {
    const result = await docClient.send(new GetCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
    }));

    if (!result.Item) {
      // Request not found - might not have been created yet
      return { status: 'pending' };
    }

    const item = result.Item as AsyncResult;

    if (item.status === 'completed') {
      console.log('[AsyncBedrock] Result ready:', { requestId, responseLength: item.response?.length });

      // Clean up the record (fire and forget)
      docClient.send(new DeleteCommand({
        TableName: ASYNC_RESULTS_TABLE,
        Key: { requestId },
      })).catch(() => { });

      return {
        status: 'completed',
        aiResponse: item.response || '',
        ssmlResponse: item.ssmlResponse || buildProsodySsml(item.response || '', prosody),
      };
    }

    if (item.status === 'error') {
      console.warn('[AsyncBedrock] Result has error:', { requestId, error: item.errorMessage });

      // Return the fallback response
      const aiResponse = item.response || "I'm sorry, I had trouble processing that. Could you please try again?";
      return {
        status: 'completed', // Still "completed" so Connect plays the message
        aiResponse,
        ssmlResponse: item.ssmlResponse || buildProsodySsml(aiResponse, prosody),
      };
    }

    // Still pending
    return { status: 'pending' };

  } catch (error) {
    console.error('[AsyncBedrock] checkResult error:', error);
    const aiResponse = "I'm sorry, something went wrong. Please try again.";
    return {
      status: 'error',
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody),
    };
  }
}

// ========================================================================
// POLL RESULT (Connect loop + prompt drives the wait; Lambda should be fast)
// ========================================================================

/**
 * Called by Connect synchronously. Must be fast (< ~1s typical).
 *
 * This function does NOT sleep/long-poll. The Connect contact flow provides the
 * caller experience by looping a short typing prompt while polling.
 */
async function pollResult(event: any): Promise<{
  status: string;
  aiResponse?: string;
  ssmlResponse?: string;
}> {
  const params = event.Details?.Parameters || {};
  const requestId = params.requestId || '';
  const maxPollLoopsRaw = params.maxPollLoops || '';
  const contactAttributes = event.Details?.ContactData?.Attributes || {};
  const prosody = getProsodyFromContactAttributes(contactAttributes);
  const maxPollLoops = (() => {
    const n = parseInt(String(maxPollLoopsRaw || '20'), 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
  })();

  if (!requestId) {
    console.warn('[AsyncBedrock] pollResult called without requestId');
    const aiResponse = "I'm sorry, there was an error. Please try again.";
    return {
      status: 'error',
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody),
    };
  }

  // Read the record once
  const result = await docClient.send(new GetCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Key: { requestId },
  }));

  if (!result.Item) {
    // Not found yet (or expired). Keep polling a bit.
    console.log('[AsyncBedrock] pollResult: request not found yet', { requestId });
    return { status: 'pending' };
  }

  const item = result.Item as AsyncResult;

  if (item.status === 'completed') {
    // Clean up the record (fire and forget)
    docClient.send(new DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
    })).catch(() => { });

    const aiResponse = item.response || '';
    console.log('[AsyncBedrock] pollResult: completed', {
      requestId,
      responseLen: aiResponse.length,
      ssmlLen: (item.ssmlResponse || '').length,
    });
    return {
      status: 'completed',
      aiResponse,
      ssmlResponse: item.ssmlResponse || buildProsodySsml(aiResponse, prosody),
    };
  }

  if (item.status === 'error') {
    // Clean up the record (fire and forget)
    docClient.send(new DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
    })).catch(() => { });

    const aiResponse = item.response || "I'm sorry, I had trouble processing that. Could you please try again?";
    console.log('[AsyncBedrock] pollResult: error -> completing with fallback message', {
      requestId,
      responseLen: aiResponse.length,
      ssmlLen: (item.ssmlResponse || '').length,
    });
    return {
      status: 'completed',
      aiResponse,
      ssmlResponse: item.ssmlResponse || buildProsodySsml(aiResponse, prosody),
    };
  }

  // Pending: increment pollCount (best-effort). If we exceed max loops, fail closed with a message.
  let nextPollCount = (item.pollCount ?? 0) + 1;
  try {
    const updated = await docClient.send(new UpdateCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
      UpdateExpression: 'SET lastPolledAt = :now, pollCount = if_not_exists(pollCount, :zero) + :one',
      ConditionExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':zero': 0,
        ':one': 1,
        ':pending': 'pending',
      },
      ReturnValues: 'UPDATED_NEW',
    }));
    if (updated.Attributes && typeof (updated.Attributes as any).pollCount === 'number') {
      nextPollCount = (updated.Attributes as any).pollCount;
    }
  } catch {
    // Ignore conditional failures/throttles; we'll just keep polling.
  }

  if (nextPollCount >= maxPollLoops) {
    // Avoid clobbering a just-completed response: re-check once before timing out.
    try {
      const reread = await docClient.send(new GetCommand({
        TableName: ASYNC_RESULTS_TABLE,
        Key: { requestId },
      }));
      const current = reread.Item as AsyncResult | undefined;
      if (current && current.status === 'completed') {
        const aiResponse = current.response || '';
        // Clean up (fire and forget)
        docClient.send(new DeleteCommand({
          TableName: ASYNC_RESULTS_TABLE,
          Key: { requestId },
        })).catch(() => { });
        return {
          status: 'completed',
          aiResponse,
          ssmlResponse: current.ssmlResponse || buildProsodySsml(aiResponse, prosody),
        };
      }
      if (current && current.status === 'error') {
        const aiResponse = current.response || "I'm sorry, I had trouble processing that. Could you please try again?";
        docClient.send(new DeleteCommand({
          TableName: ASYNC_RESULTS_TABLE,
          Key: { requestId },
        })).catch(() => { });
        return {
          status: 'completed',
          aiResponse,
          ssmlResponse: current.ssmlResponse || buildProsodySsml(aiResponse, prosody),
        };
      }
    } catch {
      // Ignore and proceed with timeout handling
    }

    const aiResponse = "I'm sorry — this is taking longer than expected. Could you please repeat your question?";
    await updateResult(requestId, {
      status: 'completed',
      response: aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody),
      errorMessage: 'Polling timeout',
    });
    // Clean up (fire and forget)
    docClient.send(new DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
    })).catch(() => { });

    return {
      status: 'completed',
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody),
    };
  }

  console.log('[AsyncBedrock] pollResult: pending', { requestId, pollCount: nextPollCount, maxPollLoops });
  return { status: 'pending' };
}

// ========================================================================
// HELPERS
// ========================================================================

function escapeSSML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeVoiceTtsText(text: string): string {
  let out = String(text || '');
  out = out.replace(/\s+([?.!,;:])/g, '$1');
  out = out.replace(/(?<=\b[A-Za-z])\s*[\/\\]\s*(?=[A-Za-z]\b)/g, ' ');
  out = out.replace(/(?<=\b[A-Za-z])\s*-\s*(?=[A-Za-z]\b)/g, ' ');
  out = out.replace(/(?<=\b[A-Za-z])\s*_\s*(?=[A-Za-z]\b)/g, ' ');
  out = out.replace(/(?<=\b[A-Za-z])\s*\.\s*(?=[A-Za-z]\b)/g, ' ');
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

function buildProsodySsml(text: string, prosody: ProsodySettings): string {
  const escaped = escapeSSML(sanitizeVoiceTtsText(text || ''));
  return `<speak><prosody rate="${prosody.speakingRate}" pitch="${prosody.pitch}" volume="${prosody.volume}">${escaped}</prosody></speak>`;
}

// ========================================================================
// MAIN HANDLER (routes to appropriate function)
// ========================================================================

export const handler = async (event: any): Promise<any> => {
  console.log('[AsyncBedrock] Received event:', JSON.stringify(event, null, 2));

  const functionType = event.Details?.Parameters?.functionType || 'start';

  switch (functionType) {
    case 'check':
      // Quick check - used by flows with their own looping logic
      return checkResult(event);

    case 'poll':
      // Fast poll - Connect flow loops while playing typing prompt
      return pollResult(event);

    case 'process': {
      // Background worker invocation (InvocationType=Event)
      const params = event.Details?.Parameters || {};
      const requestId = params.requestId || '';
      const contactId = params.contactId || '';
      const inputText = (params.inputText || '').toString();
      const clinicId = params.clinicId || DEFAULT_CLINIC_ID;
      const callerNumber = (params.callerNumber || '').toString();
      const dialedNumber = (params.dialedNumber || '').toString();
      const timezone = (params.timezone || 'UTC').toString();
      const ttsSpeakingRate = params.ttsSpeakingRate;
      const ttsPitch = params.ttsPitch;
      const ttsVolume = params.ttsVolume;
      // Patient identity from welcome lookup (if present)
      const patNum = String(params.PatNum || '').trim();
      const fName = String(params.FName || '').trim();
      const lName = String(params.LName || '').trim();
      const birthdate = String(params.Birthdate || '').trim();
      const isNewPatient = String(params.IsNewPatient || '').trim();
      const patientName = String(params.patientName || '').trim();
      const patientFirstName = String(params.patientFirstName || '').trim();
      const initialGreetingAlreadyPlayed = String(params.initialGreetingAlreadyPlayed || '').trim();

      if (!requestId) {
        console.error('[AsyncBedrock] process called without requestId');
        return { status: 'error' };
      }

      await processBedrockInvocation({
        requestId,
        contactId,
        inputText: inputText.trim(),
        clinicId,
        callerNumber,
        dialedNumber,
        timezone,
        ttsSpeakingRate,
        ttsPitch,
        ttsVolume,
        ...(patNum ? { PatNum: patNum } : {}),
        ...(fName ? { FName: fName } : {}),
        ...(lName ? { LName: lName } : {}),
        ...(birthdate ? { Birthdate: birthdate } : {}),
        ...((isNewPatient === 'true' || isNewPatient === 'false') ? { IsNewPatient: isNewPatient } : {}),
        ...(patientName ? { patientName } : {}),
        ...(patientFirstName ? { patientFirstName } : {}),
        ...(initialGreetingAlreadyPlayed ? { initialGreetingAlreadyPlayed } : {}),
      });
      return { status: 'processing_complete' };
    }

    case 'start':
    default:
      // Start async processing, return immediately with requestId
      return startAsync(event);
  }
};

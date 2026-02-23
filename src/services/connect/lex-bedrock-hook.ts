/**
 * Lex V2 Code Hook for Amazon Connect AI Voice
 * 
 * Handles Lex V2 fulfillment events invoked from Amazon Connect contact flows.
 * 
 * Features:
 * - Maps dialed number → clinicId using AI_PHONE_NUMBERS_JSON
 * - Invokes Bedrock Agent for AI responses
 * - Writes every caller+AI turn to TranscriptBuffersV2
 * - Updates CallAnalyticsN1 per turn for unified dashboards
 * - Uses the same schema/indexes as Chime/SMA AI calls
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { v4 as uuidv4 } from 'uuid';
import {
  TranscriptBufferManager,
  TranscriptSegment,
} from '../shared/utils/transcript-buffer-manager';
import { getDateContext } from '../../shared/prompts/ai-prompts';

// ========================================================================
// CONFIGURATION
// ========================================================================

const CONFIG = {
  // Analytics retention (90 days TTL, aligned with Chime analytics)
  ANALYTICS_TTL_DAYS: 90,

  // Bedrock timeout
  BEDROCK_TIMEOUT_MS: 25000, // 25 seconds (leaves buffer for Lambda timeout)

  // Max retries for analytics writes
  ANALYTICS_MAX_RETRIES: 2,
  ANALYTICS_RETRY_DELAY_MS: 50,
};

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Environment variables
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE || '';
const TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME || '';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'AiAgentSessions';
const VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE || '';

// NOTE: Thinking audio is now handled by the Connect contact flow.
// The flow plays a short keyboard typing WAV prompt after Lex completes
// and before invoking Lambda. This provides a consistent single mechanism
// instead of trying to do audio in both Lex and Connect.

// If Lex speech recognition is low-confidence, ask the caller to repeat instead of sending
// potentially incorrect text to Bedrock.
const TRANSCRIPTION_CONFIDENCE_THRESHOLD = Number(process.env.TRANSCRIPTION_CONFIDENCE_THRESHOLD || '0.6');

// Amazon Connect InvokeLambdaFunction has a hard ~8s execution limit.
// If we get too close to that, the contact flow will time out and may disconnect before
// the caller hears the first response.
//
// Default to ~7.2s for Bedrock, and cap any env override to a safe maximum.
// Since analytics/transcript updates are now fire-and-forget, we only need ~500ms buffer
// for Lambda overhead (return serialization, final network I/O).
// This gives tool-calling operations (like patient search) more time to complete.
const CONNECT_LAMBDA_HARD_LIMIT_MS = 8000;
const CONNECT_SAFE_MAX_BEDROCK_TIMEOUT_MS = CONNECT_LAMBDA_HARD_LIMIT_MS - 800;
const CONNECT_BEDROCK_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CONNECT_BEDROCK_TIMEOUT_MS || '7200');
  const n = Number.isFinite(raw) ? raw : 7200;
  return Math.max(1000, Math.min(n, CONNECT_SAFE_MAX_BEDROCK_TIMEOUT_MS));
})();

// Maximum time to spend iterating streaming chunks before returning a partial response.
// This is a last-resort guard in case the abort signal doesn't terminate the stream promptly.
// Leave 500ms for Lambda response serialization and network overhead.
const CONNECT_SAFE_MAX_STREAMING_LOOP_MS = CONNECT_LAMBDA_HARD_LIMIT_MS - 500;

// AI phone numbers mapping: aiPhoneNumber -> clinicId
const AI_PHONE_NUMBERS_JSON = process.env.AI_PHONE_NUMBERS_JSON || '{}';
let aiPhoneNumberMap: Record<string, string> = {};
try {
  aiPhoneNumberMap = JSON.parse(AI_PHONE_NUMBERS_JSON);
} catch (e) {
  console.warn('[LexBedrockHook] Failed to parse AI_PHONE_NUMBERS_JSON:', e);
}

// Default clinic ID fallback
const DEFAULT_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || 'dentistingreenville';

// Transcript buffer manager
let transcriptManager: TranscriptBufferManager | null = null;
if (TRANSCRIPT_BUFFER_TABLE) {
  transcriptManager = new TranscriptBufferManager(docClient, TRANSCRIPT_BUFFER_TABLE);
}

// ========================================================================
// TYPES - Lex V2 Event/Response
// ========================================================================

interface LexV2Event {
  messageVersion: string;
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook';
  inputMode: 'Text' | 'Speech' | 'DTMF';
  responseContentType: string;
  sessionId: string;
  inputTranscript: string;
  bot: {
    id: string;
    name: string;
    aliasId: string;
    aliasName: string;
    localeId: string;
    version: string;
  };
  interpretations: Array<{
    intent: {
      name: string;
      state: string;
      confirmationState?: string;
      slots?: Record<string, any>;
    };
    nluConfidence?: { score: number };
  }>;
  sessionState: {
    activeContexts?: any[];
    sessionAttributes?: Record<string, string>;
    intent?: {
      name: string;
      state: string;
      confirmationState?: string;
      slots?: Record<string, any>;
    };
    dialogAction?: {
      type: string;
      slotToElicit?: string;
    };
  };
  requestAttributes?: Record<string, string>;
  transcriptions?: Array<{
    transcription: string;
    transcriptionConfidence: number;
    resolvedContext?: any;
    resolvedSlots?: any;
  }>;
}

interface LexV2Response {
  sessionState: {
    activeContexts?: any[];
    sessionAttributes?: Record<string, string>;
    dialogAction: {
      type: 'Close' | 'ConfirmIntent' | 'Delegate' | 'ElicitIntent' | 'ElicitSlot';
      slotToElicit?: string;
      fulfillmentState?: 'Fulfilled' | 'Failed' | 'InProgress';
    };
    intent?: {
      name: string;
      state: 'Fulfilled' | 'Failed' | 'InProgress' | 'ReadyForFulfillment';
      confirmationState?: string;
      slots?: Record<string, any>;
    };
  };
  messages?: Array<{
    contentType: 'PlainText' | 'SSML' | 'CustomPayload' | 'ImageResponseCard';
    content: string;
  }>;
  requestAttributes?: Record<string, string>;
}

// ========================================================================
// AGENT LOOKUP (supports explicit outbound agent selection)
// ========================================================================

type CallDirection = 'inbound' | 'outbound';

interface ResolvedAgent {
  // Internal agentId (PK in AiAgents DynamoDB table)
  internalAgentId: string;
  internalAgentName?: string;
  // Bedrock identifiers used for InvokeAgent
  bedrockAgentId: string;
  bedrockAgentAliasId: string;
  // Metadata
  isPublic?: boolean;
}

// PERFORMANCE: Cache resolved agents (per clinic + direction) to avoid repeated DynamoDB queries.
// Agents/config rarely change, so a short cache significantly reduces latency.
const agentCache = new Map<string, { agent: ResolvedAgent | null; timestamp: number }>();
const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const getAgentCacheKey = (clinicId: string, direction: CallDirection) => `${clinicId}:${direction}`;

function isCallableAgentRecord(agent: any, clinicId: string): boolean {
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

function toResolvedAgent(agent: any): ResolvedAgent | null {
  const internalAgentId = typeof agent?.agentId === 'string' ? agent.agentId.trim() : '';
  const bedrockAgentId = typeof agent?.bedrockAgentId === 'string' ? agent.bedrockAgentId.trim() : '';
  const bedrockAgentAliasId = typeof agent?.bedrockAgentAliasId === 'string' ? agent.bedrockAgentAliasId.trim() : '';

  if (!internalAgentId || !bedrockAgentId || !bedrockAgentAliasId) return null;

  return {
    internalAgentId,
    internalAgentName: (agent.agentName || agent.name || '').toString(),
    bedrockAgentId,
    bedrockAgentAliasId,
    isPublic: agent.isPublic === true,
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
    console.warn('[LexBedrockHook] Error getting agent by id', {
      agentId: id,
      error: error?.message || String(error),
    });
    return null;
  }
}

async function getConfiguredAgentIdFromVoiceConfig(clinicId: string, direction: CallDirection): Promise<string | null> {
  const effectiveClinicId = clinicId || DEFAULT_CLINIC_ID;
  if (!VOICE_CONFIG_TABLE) return null;

  try {
    const resp = await docClient.send(new GetCommand({
      TableName: VOICE_CONFIG_TABLE,
      Key: { clinicId: effectiveClinicId },
      ProjectionExpression: 'inboundAgentId, outboundAgentId, aiInboundEnabled, aiOutboundEnabled',
    }));

    const cfg = resp.Item as any;
    if (!cfg) return null;

    const enabled = direction === 'outbound'
      ? cfg.aiOutboundEnabled !== false
      : cfg.aiInboundEnabled !== false;
    if (!enabled) return null;

    const id = direction === 'outbound'
      ? (typeof cfg.outboundAgentId === 'string' ? cfg.outboundAgentId.trim() : '')
      : (typeof cfg.inboundAgentId === 'string' ? cfg.inboundAgentId.trim() : '');

    return id || null;
  } catch (error: any) {
    console.warn('[LexBedrockHook] Failed to load configured agent from voice config', {
      clinicId: effectiveClinicId,
      direction,
      error: error?.message || String(error),
    });
    return null;
  }
}

async function resolveAgentForCall(params: {
  clinicId: string;
  direction: CallDirection;
  explicitAgentId?: string;
}): Promise<ResolvedAgent | null> {
  const clinicId = params.clinicId || DEFAULT_CLINIC_ID;
  const direction = params.direction;
  const explicitAgentId = typeof params.explicitAgentId === 'string' ? params.explicitAgentId.trim() : '';

  // 1) Explicit agent (used by Connect-based outbound scheduler)
  if (explicitAgentId) {
    const record = await getAgentRecordById(explicitAgentId);
    if (isCallableAgentRecord(record, clinicId)) {
      const resolved = toResolvedAgent(record);
      if (resolved) return resolved;
    }
    console.warn('[LexBedrockHook] Explicit agent not callable; falling back', {
      clinicId,
      direction,
      explicitAgentId,
    });
  }

  // 2) Configured agent from VoiceAgentConfig table (inbound/outbound)
  const configuredId = await getConfiguredAgentIdFromVoiceConfig(clinicId, direction);
  if (configuredId) {
    const record = await getAgentRecordById(configuredId);
    if (isCallableAgentRecord(record, clinicId)) {
      const resolved = toResolvedAgent(record);
      if (resolved) {
        agentCache.set(getAgentCacheKey(clinicId, direction), { agent: resolved, timestamp: Date.now() });
        return resolved;
      }
    }
    console.warn('[LexBedrockHook] Configured agent not callable; falling back', {
      clinicId,
      direction,
      configuredId,
    });
  }

  // 3) Cached fallback
  const cacheKey = getAgentCacheKey(clinicId, direction);
  const cached = agentCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }

  // 4) Fallback: choose best callable voice agent for the clinic
  try {
    const allAgents = await docClient.send(new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': clinicId },
      Limit: 50,
      ScanIndexForward: false,
    }));

    const items = (allAgents.Items || []) as any[];
    if (items.length === 0) {
      agentCache.set(cacheKey, { agent: null, timestamp: Date.now() });
      return null;
    }

    const callable = items.filter((a) => isCallableAgentRecord(a, clinicId));
    if (callable.length === 0) {
      agentCache.set(cacheKey, { agent: null, timestamp: Date.now() });
      return null;
    }

    const selected = callable.find((a) => a.isDefaultVoiceAgent === true) || callable[0];
    const resolved = toResolvedAgent(selected);
    agentCache.set(cacheKey, { agent: resolved, timestamp: Date.now() });

    if (resolved) {
      console.log('[LexBedrockHook] Resolved fallback agent:', {
        clinicId,
        direction,
        agentId: resolved.internalAgentId,
        agentName: resolved.internalAgentName,
      });
    }

    return resolved;
  } catch (error) {
    console.error('[LexBedrockHook] Error resolving agent:', error);
    agentCache.set(getAgentCacheKey(clinicId, direction), { agent: null, timestamp: Date.now() });
    return null;
  }
}

// ========================================================================
// VOICE SETTINGS (per-clinic, from VoiceAgentConfig table)
// ========================================================================

interface ClinicVoiceSettings {
  voiceId: string;
  engine: 'standard' | 'neural' | 'generative' | 'long-form';
  speakingRate: 'x-slow' | 'slow' | 'medium' | 'fast' | 'x-fast';
  pitch: 'x-low' | 'low' | 'medium' | 'high' | 'x-high';
  volume: 'silent' | 'x-soft' | 'soft' | 'medium' | 'loud' | 'x-loud';
}

const DEFAULT_TTS_VOICE: ClinicVoiceSettings = {
  voiceId: 'Joanna',
  engine: 'neural',
  speakingRate: 'medium',
  pitch: 'medium',
  volume: 'medium',
};

const ALLOWED_SPEAKING_RATES = new Set<ClinicVoiceSettings['speakingRate']>([
  'x-slow',
  'slow',
  'medium',
  'fast',
  'x-fast',
]);
const ALLOWED_PITCH = new Set<ClinicVoiceSettings['pitch']>([
  'x-low',
  'low',
  'medium',
  'high',
  'x-high',
]);
const ALLOWED_VOLUME = new Set<ClinicVoiceSettings['volume']>([
  'silent',
  'x-soft',
  'soft',
  'medium',
  'loud',
  'x-loud',
]);

function normalizeProsody<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const raw = typeof value === 'string' ? value.trim() : '';
  return (raw && allowed.has(raw as T)) ? (raw as T) : fallback;
}

function normalizeEngine(value: unknown): ClinicVoiceSettings['engine'] {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'standard' || raw === 'neural' || raw === 'generative' || raw === 'long-form') {
    return raw;
  }
  return DEFAULT_TTS_VOICE.engine;
}

async function getVoiceSettingsForClinic(clinicId: string): Promise<ClinicVoiceSettings> {
  const effectiveClinicId = clinicId || DEFAULT_CLINIC_ID;

  // If the table isn't configured, fall back to defaults (Connect will use Joanna otherwise).
  if (!VOICE_CONFIG_TABLE) {
    return { ...DEFAULT_TTS_VOICE };
  }

  try {
    const resp = await docClient.send(new GetCommand({
      TableName: VOICE_CONFIG_TABLE,
      Key: { clinicId: effectiveClinicId },
    }));

    const item = (resp.Item as any) || {};
    const voiceSettings = item.voiceSettings || {};

    // Backwards-compatible reads:
    // Some environments may have older items that stored voice fields at the top-level.
    const rawVoiceId =
      (typeof voiceSettings.voiceId === 'string' && voiceSettings.voiceId.trim())
      || (typeof voiceSettings.VoiceId === 'string' && voiceSettings.VoiceId.trim())
      || (typeof voiceSettings.TextToSpeechVoice === 'string' && voiceSettings.TextToSpeechVoice.trim())
      || (typeof item.voiceId === 'string' && item.voiceId.trim())
      || (typeof item.VoiceId === 'string' && item.VoiceId.trim())
      || (typeof item.voice_voiceId === 'string' && item.voice_voiceId.trim())
      || (typeof item.TextToSpeechVoice === 'string' && item.TextToSpeechVoice.trim())
      || '';
    const rawEngine =
      (typeof voiceSettings.engine === 'string' && voiceSettings.engine.trim())
      || (typeof voiceSettings.Engine === 'string' && voiceSettings.Engine.trim())
      || (typeof voiceSettings.TextToSpeechEngine === 'string' && voiceSettings.TextToSpeechEngine.trim())
      || (typeof item.engine === 'string' && item.engine.trim())
      || (typeof item.Engine === 'string' && item.Engine.trim())
      || (typeof item.voice_engine === 'string' && item.voice_engine.trim())
      || (typeof item.TextToSpeechEngine === 'string' && item.TextToSpeechEngine.trim())
      || '';
    const rawSpeakingRate =
      (typeof voiceSettings.speakingRate === 'string' && voiceSettings.speakingRate.trim())
      || (typeof voiceSettings.SpeakingRate === 'string' && voiceSettings.SpeakingRate.trim())
      || (typeof item.speakingRate === 'string' && item.speakingRate.trim())
      || (typeof item.ttsSpeakingRate === 'string' && item.ttsSpeakingRate.trim())
      || (typeof item.voice_speakingRate === 'string' && item.voice_speakingRate.trim())
      || '';
    const rawPitch =
      (typeof voiceSettings.pitch === 'string' && voiceSettings.pitch.trim())
      || (typeof voiceSettings.Pitch === 'string' && voiceSettings.Pitch.trim())
      || (typeof item.pitch === 'string' && item.pitch.trim())
      || (typeof item.ttsPitch === 'string' && item.ttsPitch.trim())
      || (typeof item.voice_pitch === 'string' && item.voice_pitch.trim())
      || '';
    const rawVolume =
      (typeof voiceSettings.volume === 'string' && voiceSettings.volume.trim())
      || (typeof voiceSettings.Volume === 'string' && voiceSettings.Volume.trim())
      || (typeof item.volume === 'string' && item.volume.trim())
      || (typeof item.ttsVolume === 'string' && item.ttsVolume.trim())
      || (typeof item.voice_volume === 'string' && item.voice_volume.trim())
      || '';

    const voice: ClinicVoiceSettings = {
      voiceId: rawVoiceId || DEFAULT_TTS_VOICE.voiceId,
      engine: normalizeEngine(rawEngine),
      speakingRate: normalizeProsody(rawSpeakingRate, ALLOWED_SPEAKING_RATES, DEFAULT_TTS_VOICE.speakingRate),
      pitch: normalizeProsody(rawPitch, ALLOWED_PITCH, DEFAULT_TTS_VOICE.pitch),
      volume: normalizeProsody(rawVolume, ALLOWED_VOLUME, DEFAULT_TTS_VOICE.volume),
    };
    return voice;
  } catch (error: any) {
    console.warn('[LexBedrockHook] Failed to load voice settings, using defaults', {
      clinicId: effectiveClinicId,
      error: error?.message || String(error),
    });
    return { ...DEFAULT_TTS_VOICE };
  }
}

// ========================================================================
// ANALYTICS - Unified with AnalyticsStack
// ========================================================================

interface ConnectCallAnalytics {
  callId: string;             // PK: connect-${contactId}
  timestamp: number;          // SK: call start time in ms
  clinicId: string;
  callCategory: 'ai_voice' | 'ai_outbound';
  callType: 'inbound' | 'outbound';
  callStatus: 'active' | 'completed' | 'error';
  outcome?: 'answered' | 'completed' | 'error';
  callerNumber?: string;
  dialedNumber?: string;
  callDirection?: CallDirection;
  scheduledCallId?: string;
  purpose?: string;
  patientName?: string;
  aiAgentId: string;
  agentId: string;            // Alias for dashboards that use agentId
  aiAgentName?: string;
  analyticsSource: 'connect_lex';
  contactId: string;          // Original Connect ContactId
  turnCount: number;
  transcriptCount: number;
  lastActivityTime: string;
  lastCallerUtterance?: string;
  lastAiResponse?: string;
  toolsUsed?: string[];
  ttl: number;
}

/**
 * Create or update analytics record for a Connect/Lex call
 */
async function ensureAnalyticsRecord(params: {
  callId: string;
  contactId: string;
  clinicId: string;
  callStartMs: number;
  callerNumber?: string;
  dialedNumber?: string;
  callDirection: CallDirection;
  scheduledCallId?: string;
  purpose?: string;
  patientName?: string;
  aiAgentId: string;
  aiAgentName?: string;
}): Promise<{ callId: string; timestamp: number }> {
  if (!CALL_ANALYTICS_TABLE) {
    console.warn('[LexBedrockHook] CALL_ANALYTICS_TABLE not configured, skipping analytics');
    const ts = Number.isFinite(params.callStartMs) ? Math.floor(params.callStartMs) : Date.now();
    return { callId: params.callId, timestamp: ts };
  }

  const {
    callId,
    contactId,
    clinicId,
    callStartMs,
    callerNumber,
    dialedNumber,
    callDirection,
    scheduledCallId,
    purpose,
    patientName,
    aiAgentId,
    aiAgentName,
  } = params;
  const timestamp = Number.isFinite(callStartMs) ? Math.floor(callStartMs) : Date.now();
  const ttl = Math.floor(timestamp / 1000) + (CONFIG.ANALYTICS_TTL_DAYS * 24 * 60 * 60);

  // Check if record already exists
  try {
    const existing = await docClient.send(new QueryCommand({
      TableName: CALL_ANALYTICS_TABLE,
      KeyConditionExpression: 'callId = :callId AND #ts = :ts',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: { ':callId': callId, ':ts': timestamp },
      Limit: 1,
      ConsistentRead: true,
    }));

    if (existing.Items && existing.Items.length > 0) {
      return { callId, timestamp };
    }
  } catch (error) {
    console.warn('[LexBedrockHook] Error checking existing analytics:', error);
  }

  // Create new record
  const callCategory: ConnectCallAnalytics['callCategory'] = callDirection === 'outbound' ? 'ai_outbound' : 'ai_voice';
  const callType: ConnectCallAnalytics['callType'] = callDirection === 'outbound' ? 'outbound' : 'inbound';
  const analytics: ConnectCallAnalytics = {
    callId,
    timestamp,
    clinicId,
    callCategory,
    callType,
    callStatus: 'active',
    outcome: 'answered',
    callerNumber,
    dialedNumber,
    callDirection,
    scheduledCallId,
    purpose,
    patientName,
    aiAgentId,
    agentId: aiAgentId, // Alias for existing dashboards
    aiAgentName,
    analyticsSource: 'connect_lex',
    contactId,
    turnCount: 0,
    transcriptCount: 0,
    lastActivityTime: new Date(timestamp).toISOString(),
    toolsUsed: [],
    ttl,
  };

  try {
    await docClient.send(new PutCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Item: analytics,
      ConditionExpression: 'attribute_not_exists(callId)',
    }));
    console.log('[LexBedrockHook] Created analytics record:', { callId, clinicId });
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Record was created by another invocation; treat as success.
      return { callId, timestamp };
    }
    console.error('[LexBedrockHook] Error creating analytics record:', error);
  }

  return { callId, timestamp };
}

/**
 * Update analytics record with turn data
 */
async function updateAnalyticsTurn(params: {
  callId: string;
  timestamp: number;
  callerUtterance: string;
  aiResponse: string;
  toolsUsed?: string[];
}): Promise<void> {
  if (!CALL_ANALYTICS_TABLE) return;

  const { callId, timestamp, callerUtterance, aiResponse, toolsUsed } = params;
  const now = new Date().toISOString();

  try {
    // Build SET clause items
    const setItems = [
      'lastActivityTime = :now',
      'lastCallerUtterance = :caller',
      'lastAiResponse = :ai',
    ];
    const exprValues: Record<string, any> = {
      ':now': now,
      ':caller': callerUtterance.substring(0, 500), // Truncate for storage
      ':ai': aiResponse.substring(0, 1000),
      ':one': 1,
      ':two': 2, // One for caller, one for AI
    };

    if (toolsUsed && toolsUsed.length > 0) {
      setItems.push('toolsUsed = list_append(if_not_exists(toolsUsed, :emptyList), :tools)');
      exprValues[':emptyList'] = [];
      exprValues[':tools'] = toolsUsed.slice(0, 10); // Limit tools per turn
    }

    // Combine SET and ADD clauses properly (no comma between them)
    const updateExpr = `SET ${setItems.join(', ')} ADD turnCount :one, transcriptCount :two`;

    await docClient.send(new UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Key: { callId, timestamp },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues,
    }));
  } catch (error) {
    console.error('[LexBedrockHook] Error updating analytics turn:', error);
  }
}

// ========================================================================
// TRANSCRIPT BUFFERING - Unified with TranscriptBuffersV2
// ========================================================================

/**
 * Add a turn to the transcript buffer (CUSTOMER + AGENT segments)
 */
async function addTranscriptTurn(params: {
  callId: string;
  callerUtterance: string;
  aiResponse: string;
  callStartMs: number;
  confidence?: number;
}): Promise<void> {
  if (!transcriptManager) {
    console.warn('[LexBedrockHook] TranscriptBufferManager not configured');
    return;
  }

  const { callId, callerUtterance, aiResponse, callStartMs, confidence } = params;
  const nowMs = Date.now();

  // Calculate time offsets in seconds since call start
  const callerStartTime = (nowMs - callStartMs) / 1000;
  const callerEndTime = callerStartTime + 0.5; // Approximate
  const aiStartTime = callerEndTime + 0.1;
  const aiEndTime = aiStartTime + (aiResponse.length / 15); // ~15 chars per second speaking

  try {
    // Ensure buffer is initialized
    await transcriptManager.initialize(callId);

    // Add CUSTOMER segment
    const customerSegment: TranscriptSegment = {
      content: callerUtterance,
      startTime: callerStartTime,
      endTime: callerEndTime,
      speaker: 'CUSTOMER',
      confidence: confidence || 0.9,
    };
    await transcriptManager.addSegment(callId, customerSegment);

    // Add AGENT segment
    const agentSegment: TranscriptSegment = {
      content: aiResponse,
      startTime: aiStartTime,
      endTime: aiEndTime,
      speaker: 'AGENT',
      confidence: 1.0, // AI response is always 100% confidence
    };
    await transcriptManager.addSegment(callId, agentSegment);

    console.log('[LexBedrockHook] Added transcript segments:', { callId, callerLen: callerUtterance.length, aiLen: aiResponse.length });
  } catch (error) {
    console.error('[LexBedrockHook] Error adding transcript segments:', error);
  }
}

// ========================================================================
// SESSION MANAGEMENT (Connect sessions via Lex sessionId)
// ========================================================================

interface ConnectLexSession {
  sessionId: string;        // PK: Lex sessionId (equals Connect ContactId)
  callId: string;           // connect-${contactId}
  clinicId: string;
  // Internal agentId (AiAgents table PK) for analytics + debugging
  aiAgentId: string;
  aiAgentName?: string;
  // Bedrock identifiers for InvokeAgent (resolved at call start; stable for the session)
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  bedrockSessionId: string; // Session ID for Bedrock Agent
  callStartMs: number;
  turnCount: number;
  createdAt: string;
  lastActivity: string;
  callerNumber?: string;
  // Optional call context (primarily for outbound)
  callDirection?: CallDirection;
  scheduledCallId?: string;
  purpose?: string;
  patientName?: string;
  ttl: number;
}

async function getOrCreateSession(
  lexSessionId: string,
  clinicId: string,
  callerNumber?: string,
  options?: {
    callDirection?: CallDirection;
    explicitAgentId?: string;
    scheduledCallId?: string;
    purpose?: string;
    patientName?: string;
  }
): Promise<ConnectLexSession> {
  const sessionKey = `lex-${lexSessionId}`;
  const direction: CallDirection = options?.callDirection === 'outbound' ? 'outbound' : 'inbound';

  // Try to get existing session
  try {
    const existing = await docClient.send(new GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: sessionKey },
    }));

    if (existing.Item) {
      // Update last activity and increment turn count.
      // ReturnValues ensures the in-memory session reflects the incremented turnCount.
      const updated = await docClient.send(new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId: sessionKey },
        UpdateExpression: 'SET lastActivity = :now, turnCount = if_not_exists(turnCount, :zero) + :one',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
          ':zero': 0,
          ':one': 1,
        },
        ReturnValues: 'ALL_NEW',
      }));
      return (updated.Attributes || existing.Item) as ConnectLexSession;
    }
  } catch (error) {
    console.warn('[LexBedrockHook] Error getting session:', error);
  }

  // Resolve agent for this call (explicit agent for outbound, configured agent for clinic, then fallback)
  const resolvedAgent = await resolveAgentForCall({
    clinicId,
    direction,
    explicitAgentId: options?.explicitAgentId,
  });
  if (!resolvedAgent) {
    throw new Error(`No voice-capable Bedrock agent available for clinic: ${clinicId}`);
  }

  // Create new session
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (60 * 60); // 1 hour TTL

  const session: ConnectLexSession = {
    sessionId: sessionKey,
    callId: `connect-${lexSessionId}`,
    clinicId,
    aiAgentId: resolvedAgent.internalAgentId,
    aiAgentName: resolvedAgent.internalAgentName,
    bedrockAgentId: resolvedAgent.bedrockAgentId,
    bedrockAgentAliasId: resolvedAgent.bedrockAgentAliasId,
    bedrockSessionId: uuidv4(),
    callStartMs: now,
    turnCount: 1,
    createdAt: new Date(now).toISOString(),
    lastActivity: new Date(now).toISOString(),
    callerNumber,
    callDirection: direction,
    scheduledCallId: options?.scheduledCallId,
    purpose: options?.purpose,
    patientName: options?.patientName,
    ttl,
  };

  try {
    await docClient.send(new PutCommand({
      TableName: SESSIONS_TABLE,
      Item: session,
    }));
    console.log('[LexBedrockHook] Created new session:', {
      sessionId: sessionKey,
      clinicId,
      direction,
      agentId: resolvedAgent.internalAgentId,
      scheduledCallId: options?.scheduledCallId || undefined,
    });
  } catch (error) {
    console.error('[LexBedrockHook] Error creating session:', error);
  }

  return session;
}

// ========================================================================
// BEDROCK AGENT INVOCATION
// ========================================================================

async function invokeBedrock(params: {
  agentId: string;
  aliasId: string;
  sessionId: string;
  inputText: string;
  clinicId: string;
  inputMode?: 'Text' | 'Speech' | 'DTMF';
  channel?: 'voice' | 'chat';
  sessionAttributes?: Record<string, string>;
  promptSessionAttributes?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ response: string; toolsUsed: string[] }> {
  const { agentId, aliasId, sessionId, inputText, clinicId, inputMode, channel, timeoutMs } = params;

  // Voice-specific instructions are now at the TOP of the system prompt (baked into agent)
  // No need for runtime prefix - the agent knows to use short responses for voice calls
  const isVoiceCall = channel === 'voice';

  const effectiveTimeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : CONFIG.BEDROCK_TIMEOUT_MS;
  const controller = new AbortController();
  const bedrockTimeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  // Track when we started for streaming loop timeout
  const invocationStartMs = Date.now();
  const streamingLoopMaxMs = isVoiceCall
    ? Math.min(effectiveTimeoutMs + 250, CONNECT_SAFE_MAX_STREAMING_LOOP_MS)
    : effectiveTimeoutMs + 2000;

  try {
    const mergedSessionAttributes: Record<string, string> = {
      ...(params.sessionAttributes || {}),
      clinicId,
      // Pass input mode so agent knows to use voice-optimized responses
      inputMode: inputMode || 'Text',
      channel: channel || (inputMode === 'Speech' ? 'voice' : 'chat'),
    };

    const command = new InvokeAgentCommand({
      agentId,
      agentAliasId: aliasId,
      sessionId,
      inputText,
      sessionState: {
        sessionAttributes: mergedSessionAttributes,
        ...(params.promptSessionAttributes && Object.keys(params.promptSessionAttributes).length > 0
          ? { promptSessionAttributes: params.promptSessionAttributes }
          : {}),
      },
    });

    const response = await bedrockAgentClient.send(command, { abortSignal: controller.signal });

    let fullResponse = '';
    const toolsUsed: string[] = [];
    let streamingTimedOut = false;

    if (response.completion) {
      for await (const event of response.completion) {
        // FIX: Check if we're exceeding the streaming loop timeout
        // The abort signal may not properly terminate the stream, so we need
        // to manually break out of the loop to ensure we respond before Connect times out
        const elapsedMs = Date.now() - invocationStartMs;
        if (elapsedMs > streamingLoopMaxMs || controller.signal.aborted) {
          console.warn('[LexBedrockHook] Streaming loop timeout, returning partial response', {
            elapsedMs,
            maxMs: streamingLoopMaxMs,
            aborted: controller.signal.aborted,
            partialResponseLength: fullResponse.length,
          });
          streamingTimedOut = true;
          break;
        }

        if (event.chunk?.bytes) {
          fullResponse += new TextDecoder().decode(event.chunk.bytes);
        }
        // Track tools used from trace events
        if ((event as any).trace?.trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const actionGroup = (event as any).trace.trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          if (actionGroup.function) {
            toolsUsed.push(actionGroup.function);
          }
        }
      }
    }

    // If we got a partial response due to timeout but have some content, return it
    // Otherwise, return a timeout message
    if (streamingTimedOut && !fullResponse.trim()) {
      return {
        response: isVoiceCall
          ? "I'm sorry — I'm still working on that. Could you ask again in a moment?"
          : "I apologize, the request is taking longer than expected. Please try again.",
        toolsUsed: [...new Set(toolsUsed)],
      };
    }

    return {
      response: fullResponse.trim() || "I'm sorry, I couldn't generate a response. How else can I help you?",
      toolsUsed: [...new Set(toolsUsed)], // Dedupe
    };
  } catch (error) {
    const isAbort =
      controller.signal.aborted ||
      (error as any)?.name === 'AbortError' ||
      (error as any)?.code === 'ABORT_ERR';

    if (isAbort) {
      console.warn('[LexBedrockHook] Bedrock invocation timed out', {
        clinicId,
        timeoutMs: effectiveTimeoutMs,
        inputTextPreview: inputText.substring(0, 50),
      });
      // Provide a more natural voice response that acknowledges we're still processing
      // and invites the caller to repeat their request
      return {
        response: isVoiceCall
          ? "I'm still looking that up. Could you please repeat what you just said?"
          : "I apologize, but I'm having trouble processing your request right now. Please try again.",
        toolsUsed: [],
      };
    }

    console.error('[LexBedrockHook] Bedrock invocation error:', error);
    return {
      response: isVoiceCall
        ? "I'm sorry — I'm having trouble right now. Could you please try again?"
        : "I apologize, but I'm having trouble processing your request right now. Please try again or call back during office hours.",
      toolsUsed: [],
    };
  } finally {
    clearTimeout(bedrockTimeout);
  }
}

// ========================================================================
// CONNECT DIRECT LAMBDA EVENT TYPES
// ========================================================================

/**
 * Amazon Connect InvokeLambdaFunction event format.
 * This is different from Lex V2 fulfillment events.
 */
interface ConnectLambdaEvent {
  Name?: string;
  Details?: {
    ContactData?: {
      ContactId: string;
      CustomerEndpoint?: { Address: string };
      SystemEndpoint?: { Address: string };
      Attributes?: Record<string, string>;
    };
    Parameters?: Record<string, string>;
  };
}

/**
 * Response format for Connect direct Lambda invocation.
 * Connect reads these keys for playback in the contact flow.
 */
interface ConnectLambdaResponse {
  aiResponse: string;
  ssmlResponse?: string;
  clinicId?: string;
  turnCount?: string;
  // Used by Connect UpdateContactTextToSpeechVoice (Set voice block)
  TextToSpeechVoice?: string;
  TextToSpeechEngine?: string;
  TextToSpeechStyle?: string;
  // Used by SSML <prosody> for Connect prompts/responses
  speakingRate?: ClinicVoiceSettings['speakingRate'];
  pitch?: ClinicVoiceSettings['pitch'];
  volume?: ClinicVoiceSettings['volume'];
}

/**
 * Detect if event is from Connect InvokeLambdaFunction (not Lex)
 */
function isConnectDirectEvent(event: any): event is ConnectLambdaEvent {
  return event?.Details?.ContactData?.ContactId !== undefined;
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: LexV2Event | ConnectLambdaEvent): Promise<LexV2Response | ConnectLambdaResponse> => {
  console.log('[LexBedrockHook] Received event:', JSON.stringify(event, null, 2));

  // Handle Connect direct Lambda invocation (from new contact flow with Loop Prompts)
  if (isConnectDirectEvent(event)) {
    return handleConnectDirectEvent(event);
  }

  // Handle Lex V2 fulfillment event (legacy flow)
  return handleLexEvent(event as LexV2Event);
};

/**
 * Handle direct Connect Lambda invocation (new flow with keyboard sounds)
 */
async function handleConnectDirectEvent(event: ConnectLambdaEvent): Promise<ConnectLambdaResponse> {
  const contactData = event.Details?.ContactData;
  const params = event.Details?.Parameters || {};

  const contactId = contactData?.ContactId || '';
  const inputTranscript = params['inputTranscript'] || '';
  const confidenceRaw = params['confidence'];
  const transcriptionConfidence = confidenceRaw !== undefined && confidenceRaw !== ''
    ? Number(confidenceRaw)
    : 0.9;
  const safeConfidence = Number.isFinite(transcriptionConfidence) ? transcriptionConfidence : 0.9;
  const callerNumber = contactData?.CustomerEndpoint?.Address || '';
  const dialedNumber = contactData?.SystemEndpoint?.Address || '';
  const contactAttributes = contactData?.Attributes || {};

  // =====================================================================
  // Voice-config request (used by Connect "Set voice" block)
  // =====================================================================
  const requestType = String(params['requestType'] || params['functionType'] || '').trim();
  if (requestType === 'voiceConfig') {
    // Determine clinic from explicit attribute first, then dialed number mapping.
    let voiceClinicId = String(contactAttributes['clinicId'] || params['clinicId'] || '').trim();

    if (!voiceClinicId && dialedNumber) {
      const normalizedDialed = dialedNumber.replace(/\D/g, '');
      for (const [phone, clinic] of Object.entries(aiPhoneNumberMap)) {
        if (phone.replace(/\D/g, '') === normalizedDialed) {
          voiceClinicId = clinic;
          break;
        }
      }
    }

    if (!voiceClinicId) {
      voiceClinicId = DEFAULT_CLINIC_ID;
    }

    const voice = await getVoiceSettingsForClinic(voiceClinicId);
    const connectEngine = voice.engine === 'long-form' ? 'neural' : voice.engine;

    console.log('[LexBedrockHook] Voice config resolved:', {
      clinicId: voiceClinicId,
      voiceId: voice.voiceId,
      engine: connectEngine,
      speakingRate: voice.speakingRate,
      pitch: voice.pitch,
      volume: voice.volume,
    });

    return {
      // Not used by the flow in this requestType, but Connect expects a JSON object response.
      aiResponse: '',
      clinicId: voiceClinicId,
      TextToSpeechVoice: voice.voiceId,
      TextToSpeechEngine: connectEngine,
      speakingRate: voice.speakingRate,
      pitch: voice.pitch,
      volume: voice.volume,
    };
  }

  // Determine clinic from dialed number
  let clinicId = contactAttributes['clinicId'] || '';
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
    console.warn('[LexBedrockHook] Connect direct: No clinicId found, using default:', clinicId);
  }

  const prosody = getProsodyFromContactAttributes(contactAttributes);
  const buildResponse = (text: string): ConnectLambdaResponse => ({
    aiResponse: text,
    ssmlResponse: buildProsodySsml(text, prosody),
    clinicId,
  });

  // Determine call direction + outbound context from attributes/params
  const callDirectionRaw = String(params['callDirection'] || contactAttributes['callDirection'] || '').trim().toLowerCase();
  const callDirection: CallDirection = callDirectionRaw === 'outbound' ? 'outbound' : 'inbound';
  const explicitAgentId = String(contactAttributes['aiAgentId'] || contactAttributes['agentId'] || '').trim() || undefined;
  const scheduledCallId = String(contactAttributes['scheduledCallId'] || '').trim() || undefined;
  const purpose = String(contactAttributes['purpose'] || '').trim() || undefined;
  const patientName = String(contactAttributes['patientName'] || '').trim() || undefined;

  // Get or create session
  let session: ConnectLexSession;
  try {
    session = await getOrCreateSession(contactId, clinicId, callerNumber, {
      callDirection,
      explicitAgentId,
      scheduledCallId,
      purpose,
      patientName,
    });
  } catch (error) {
    console.error('[LexBedrockHook] Connect direct: Session creation failed:', error);
    return buildResponse("I'm sorry, I'm having trouble setting up our conversation. Please try again.");
  }

  // Ensure analytics record exists
  const analyticsInfo = await ensureAnalyticsRecord({
    callId: session.callId,
    contactId,
    clinicId: session.clinicId,
    callStartMs: session.callStartMs,
    callerNumber: session.callerNumber,
    dialedNumber,
    callDirection,
    scheduledCallId,
    purpose,
    patientName,
    aiAgentId: session.aiAgentId,
    aiAgentName: session.aiAgentName,
  });

  // Resolve Bedrock agent for this session (stored at session creation; backfill if missing)
  let bedrockAgentId = session.bedrockAgentId;
  let bedrockAgentAliasId = session.bedrockAgentAliasId;
  if (!bedrockAgentId || !bedrockAgentAliasId) {
    const resolved = await resolveAgentForCall({
      clinicId,
      direction: callDirection,
      explicitAgentId,
    });
    if (!resolved) {
      console.error('[LexBedrockHook] Connect direct: No voice-capable agent found for clinic:', clinicId);
      return buildResponse("I'm sorry, the AI assistant is not available right now. Please call back during office hours.");
    }
    bedrockAgentId = resolved.bedrockAgentId;
    bedrockAgentAliasId = resolved.bedrockAgentAliasId;
  }

  // Handle empty/timeout input from Connect
  const trimmedInput = inputTranscript.trim();
  const normalizedInput = trimmedInput.toLowerCase();
  const isTimeoutInput = normalizedInput === 'timeout' ||
    normalizedInput === 'noinput' ||
    normalizedInput === 'no input' ||
    normalizedInput === 'inputtimelimitexceeded';
  if (!trimmedInput || isTimeoutInput) {
    return buildResponse("I'm sorry, I didn't catch that. Could you please repeat what you said?");
  }

  // If Lex ASR is low-confidence, ask for a repeat instead of risking a wrong Bedrock response.
  if (safeConfidence < TRANSCRIPTION_CONFIDENCE_THRESHOLD) {
    console.warn('[LexBedrockHook] Connect direct: Low transcription confidence; prompting caller to repeat', {
      transcriptionConfidence: safeConfidence,
      threshold: TRANSCRIPTION_CONFIDENCE_THRESHOLD,
      inputTranscript,
    });
    return buildResponse("I'm sorry, I didn't catch that clearly. Could you please repeat what you said?");
  }

  // Add lightweight date context so the agent can resolve "tomorrow", weekdays, etc.
  // Prefer a timezone passed from Connect if present; otherwise default to UTC.
  const timezone = String(contactAttributes['timezone'] || 'UTC').trim() || 'UTC';
  const d = getDateContext(timezone);
  const [year, month, day] = d.today.split('-');
  const todayFormatted = `${month}/${day}/${year}`;

  const bedrockSessionAttributes: Record<string, string> = {
    callerNumber,
    dialedNumber,
    // Common aliases used by action-group tools/callbacks
    callerPhone: callerNumber,
    PatientPhone: callerNumber,
    callDirection,
    contactId,
    ...(scheduledCallId ? { scheduledCallId } : {}),
    ...(purpose ? { purpose } : {}),
    ...(patientName ? { patientName } : {}),
    // Date context for relative scheduling
    todayDate: d.today,
    todayFormatted,
    dayName: d.dayName,
    tomorrowDate: d.tomorrowDate,
    currentTime: d.currentTime,
    nextWeekDates: JSON.stringify(d.nextWeekDates),
    timezone: d.timezone,
  };

  const bedrockPromptSessionAttributes: Record<string, string> = {
    callerNumber,
    currentDate: `Today is ${d.dayName}, ${todayFormatted} (${d.today}). Current time: ${d.currentTime} (${d.timezone})`,
    dateContext: `When scheduling appointments, use ${d.today} as today's date. Tomorrow is ${d.tomorrowDate}. Next week dates: ${JSON.stringify(d.nextWeekDates)}`,
  };

  // Invoke Bedrock
  const { response: aiResponse, toolsUsed } = await invokeBedrock({
    agentId: bedrockAgentId,
    aliasId: bedrockAgentAliasId,
    sessionId: session.bedrockSessionId,
    inputText: trimmedInput,
    clinicId,
    inputMode: 'Speech',
    channel: 'voice',
    sessionAttributes: bedrockSessionAttributes,
    promptSessionAttributes: bedrockPromptSessionAttributes,
    timeoutMs: CONNECT_BEDROCK_TIMEOUT_MS,
  });

  // FIX: Make analytics and transcript updates fire-and-forget to reduce response time
  // These are non-critical for the voice response and shouldn't block the caller
  // The Lambda will continue running after we return the response
  updateAnalyticsTurn({
    callId: session.callId,
    timestamp: analyticsInfo.timestamp,
    callerUtterance: trimmedInput,
    aiResponse,
    toolsUsed,
  }).catch(err => console.error('[LexBedrockHook] Analytics update failed (non-blocking):', err));

  addTranscriptTurn({
    callId: session.callId,
    callerUtterance: trimmedInput,
    aiResponse,
    callStartMs: session.callStartMs,
    confidence: safeConfidence,
  }).catch(err => console.error('[LexBedrockHook] Transcript buffer update failed (non-blocking):', err));

  console.log('[LexBedrockHook] Connect direct: Returning response:', {
    clinicId,
    turnCount: session.turnCount,
    responseLength: aiResponse.length,
  });

  return {
    ...buildResponse(aiResponse),
    turnCount: String(session.turnCount),
  };
}

/**
 * Handle Lex V2 fulfillment event (legacy flow)
 */
async function handleLexEvent(event: LexV2Event): Promise<LexV2Response> {
  const lexSessionId = event.sessionId; // This is the Connect ContactId
  const inputTranscript = event.inputTranscript || '';
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const requestAttributes = event.requestAttributes || {};

  // Get transcription confidence from Lex
  const transcriptionConfidence = event.transcriptions?.[0]?.transcriptionConfidence || 0.9;
  const isVoiceCall = event.inputMode === 'Speech';

  // Determine clinic from dialed number or session attributes
  let clinicId = sessionAttributes['clinicId'] || '';
  let callerNumber = requestAttributes['x-amz-lex:caller-number'] || sessionAttributes['callerNumber'] || '';

  // Try to get dialed number from Connect system endpoint
  const dialedNumber = requestAttributes['x-amz-lex:dialed-number'] || sessionAttributes['dialedNumber'] || '';

  if (!clinicId && dialedNumber) {
    // Look up clinic from AI phone numbers mapping
    const normalizedDialed = dialedNumber.replace(/\D/g, '');
    for (const [phone, clinic] of Object.entries(aiPhoneNumberMap)) {
      if (phone.replace(/\D/g, '') === normalizedDialed) {
        clinicId = clinic;
        break;
      }
    }
  }

  // Fallback to default clinic
  if (!clinicId) {
    clinicId = DEFAULT_CLINIC_ID;
    console.warn('[LexBedrockHook] No clinicId found, using default:', clinicId);
  }

  const callDirectionRaw = String(sessionAttributes['callDirection'] || '').trim().toLowerCase();
  const callDirection: CallDirection = callDirectionRaw === 'outbound' ? 'outbound' : 'inbound';

  // Get or create session
  let session: ConnectLexSession;
  try {
    session = await getOrCreateSession(lexSessionId, clinicId, callerNumber, { callDirection });
  } catch (error) {
    console.error('[LexBedrockHook] Session creation failed:', error);
    return buildErrorResponse(event, "I'm sorry, I'm having trouble setting up our conversation. Please try again.");
  }

  // Ensure analytics record exists
  const analyticsInfo = await ensureAnalyticsRecord({
    callId: session.callId,
    contactId: lexSessionId,
    clinicId: session.clinicId,
    callStartMs: session.callStartMs,
    callerNumber: session.callerNumber,
    dialedNumber,
    callDirection,
    aiAgentId: session.aiAgentId,
    aiAgentName: session.aiAgentName,
  });

  // Resolve Bedrock agent for this session (stored at session creation; backfill if missing)
  let bedrockAgentId = session.bedrockAgentId;
  let bedrockAgentAliasId = session.bedrockAgentAliasId;
  if (!bedrockAgentId || !bedrockAgentAliasId) {
    const resolved = await resolveAgentForCall({ clinicId, direction: callDirection });
    if (!resolved) {
      console.error('[LexBedrockHook] No voice-capable agent found for clinic:', clinicId, {
        dialedNumber,
        defaultClinicId: DEFAULT_CLINIC_ID,
        hasPhoneMap: Object.keys(aiPhoneNumberMap || {}).length > 0,
      });
      return buildErrorResponse(event, "I'm sorry, the AI assistant is not available right now. Please call back during office hours.");
    }
    bedrockAgentId = resolved.bedrockAgentId;
    bedrockAgentAliasId = resolved.bedrockAgentAliasId;
  }

  // Handle empty input (silence or no transcription)
  // Bedrock requires non-empty inputText, so we prompt the user to repeat
  const trimmedInput = inputTranscript.trim();
  if (!trimmedInput) {
    console.log('[LexBedrockHook] Empty input transcript, prompting user to repeat');
    return {
      sessionState: {
        sessionAttributes: {
          ...sessionAttributes,
          clinicId,
          callerNumber,
          callId: session.callId,
          turnCount: String(session.turnCount),
        },
        dialogAction: {
          type: 'ElicitIntent',
        },
      },
      messages: [
        {
          contentType: 'PlainText',
          content: "I'm sorry, I didn't catch that. Could you please repeat what you said?",
        },
      ],
    };
  }

  // If Lex ASR is low-confidence, ask for a repeat instead of risking a wrong Bedrock response.
  if (isVoiceCall && transcriptionConfidence < TRANSCRIPTION_CONFIDENCE_THRESHOLD) {
    console.warn('[LexBedrockHook] Low transcription confidence; prompting caller to repeat', {
      transcriptionConfidence,
      threshold: TRANSCRIPTION_CONFIDENCE_THRESHOLD,
      inputTranscript,
    });
    return {
      sessionState: {
        sessionAttributes: {
          ...sessionAttributes,
          clinicId,
          callerNumber,
          callId: session.callId,
          turnCount: String(session.turnCount),
        },
        dialogAction: {
          type: 'ElicitIntent',
        },
      },
      messages: [
        {
          contentType: 'PlainText',
          content: "I'm sorry, I didn't catch that clearly. Could you please repeat what you said?",
        },
      ],
    };
  }

  // Invoke Bedrock - pass inputMode so agent uses voice-optimized responses
  // Add lightweight date context so the agent can resolve "tomorrow", weekdays, etc.
  const timezone = String(sessionAttributes['timezone'] || 'UTC').trim() || 'UTC';
  const d = getDateContext(timezone);
  const [year, month, day] = d.today.split('-');
  const todayFormatted = `${month}/${day}/${year}`;

  const bedrockSessionAttributes: Record<string, string> = {
    callerNumber,
    dialedNumber,
    callerPhone: callerNumber,
    PatientPhone: callerNumber,
    callDirection,
    contactId: lexSessionId,
    todayDate: d.today,
    todayFormatted,
    dayName: d.dayName,
    tomorrowDate: d.tomorrowDate,
    currentTime: d.currentTime,
    nextWeekDates: JSON.stringify(d.nextWeekDates),
    timezone: d.timezone,
  };

  const bedrockPromptSessionAttributes: Record<string, string> = {
    callerNumber,
    currentDate: `Today is ${d.dayName}, ${todayFormatted} (${d.today}). Current time: ${d.currentTime} (${d.timezone})`,
    dateContext: `When scheduling appointments, use ${d.today} as today's date. Tomorrow is ${d.tomorrowDate}. Next week dates: ${JSON.stringify(d.nextWeekDates)}`,
  };

  const { response: aiResponse, toolsUsed } = await invokeBedrock({
    agentId: bedrockAgentId,
    aliasId: bedrockAgentAliasId,
    sessionId: session.bedrockSessionId,
    inputText: trimmedInput,
    clinicId,
    inputMode: event.inputMode, // 'Speech' for voice calls, 'Text' for chat
    channel: event.inputMode === 'Speech' ? 'voice' : 'chat',
    sessionAttributes: bedrockSessionAttributes,
    promptSessionAttributes: bedrockPromptSessionAttributes,
    timeoutMs: event.inputMode === 'Speech' ? CONNECT_BEDROCK_TIMEOUT_MS : CONFIG.BEDROCK_TIMEOUT_MS,
  });

  // FIX: Make analytics and transcript updates fire-and-forget to reduce response time
  // These are non-critical for the voice response and shouldn't block the caller
  updateAnalyticsTurn({
    callId: session.callId,
    timestamp: analyticsInfo.timestamp,
    callerUtterance: trimmedInput,
    aiResponse,
    toolsUsed,
  }).catch(err => console.error('[LexBedrockHook] Lex analytics update failed (non-blocking):', err));

  addTranscriptTurn({
    callId: session.callId,
    callerUtterance: trimmedInput,
    aiResponse,
    callStartMs: session.callStartMs,
    confidence: transcriptionConfidence,
  }).catch(err => console.error('[LexBedrockHook] Lex transcript buffer update failed (non-blocking):', err));

  // Build Lex response
  // IMPORTANT: Store lastUtterance in session attributes so Connect can read it
  // via $.Lex.SessionAttributes.lastUtterance for the InvokeLambdaFunction block.
  // This is required because Connect cannot access voice transcripts via $.StoredCustomerInput
  // (that only works for DTMF input).
  const nextSessionAttributes = {
    ...sessionAttributes,
    clinicId,
    callerNumber,
    callId: session.callId,
    turnCount: String(session.turnCount),
    // CRITICAL: Pass transcript to Connect via Lex session attributes
    // Connect reads this as $.Lex.SessionAttributes.lastUtterance
    lastUtterance: trimmedInput.substring(0, 1000),
    lastUtteranceConfidence: String(transcriptionConfidence),
  };

  // For voice calls, use plain text since we're now using Connect for response playback.
  // Lex fulfillment updates handle "thinking" messages during Lambda execution.
  const response: LexV2Response = {
    sessionState: {
      sessionAttributes: nextSessionAttributes,
      dialogAction: {
        type: 'ElicitIntent', // Keep conversation going
      },
    },
    messages: [
      {
        contentType: 'PlainText',
        content: aiResponse,
      },
    ],
  };

  console.log('[LexBedrockHook] Returning response:', {
    clinicId,
    turnCount: session.turnCount,
    responseLength: aiResponse.length,
    lastUtteranceSet: !!nextSessionAttributes.lastUtterance,
  });
  return response;
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

/**
 * Escape special characters for safe inclusion in SSML
 */
function escapeSSML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getProsodyFromContactAttributes(
  attrs: Record<string, string>
): Pick<ClinicVoiceSettings, 'speakingRate' | 'pitch' | 'volume'> {
  return {
    speakingRate: normalizeProsody(attrs['ttsSpeakingRate'], ALLOWED_SPEAKING_RATES, DEFAULT_TTS_VOICE.speakingRate),
    pitch: normalizeProsody(attrs['ttsPitch'], ALLOWED_PITCH, DEFAULT_TTS_VOICE.pitch),
    volume: normalizeProsody(attrs['ttsVolume'], ALLOWED_VOLUME, DEFAULT_TTS_VOICE.volume),
  };
}

function buildProsodySsml(
  text: string,
  prosody: Pick<ClinicVoiceSettings, 'speakingRate' | 'pitch' | 'volume'>
): string {
  const escaped = escapeSSML(text || '');
  return `<speak><prosody rate="${prosody.speakingRate}" pitch="${prosody.pitch}" volume="${prosody.volume}">${escaped}</prosody></speak>`;
}

/**
 * Build an error response for Lex
 */
function buildErrorResponse(event: LexV2Event, message: string): LexV2Response {
  return {
    sessionState: {
      sessionAttributes: event.sessionState?.sessionAttributes || {},
      dialogAction: {
        // Keep the Lex session open so Connect doesn't immediately hang up.
        // This makes transient infra/config issues non-fatal to the phone call.
        type: 'ElicitIntent',
      },
    },
    messages: [
      {
        contentType: 'PlainText',
        content: message,
      },
    ],
  };
}

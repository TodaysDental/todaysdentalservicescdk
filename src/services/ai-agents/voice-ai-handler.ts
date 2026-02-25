/**
 * Voice AI Handler for After-Hours Calls
 * 
 * Handles real-time voice conversations using:
 * - Amazon Transcribe for speech-to-text
 * - Bedrock Agent for AI conversation
 * - Amazon Polly for text-to-speech
 * - Filler phrases to avoid silence during thinking
 * - Configurable voice settings per clinic
 * - Purpose-specific greetings for outbound calls
 * - Call analytics tracking
 * 
 * Integrates with Amazon Chime SIP Media Application
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
import {
  PollyClient,
  SynthesizeSpeechCommand,
  OutputFormat,
  VoiceId,
  Engine,
} from '@aws-sdk/client-polly';
import {
  ChimeSDKVoiceClient,
  UpdateSipMediaApplicationCallCommand,
} from '@aws-sdk/client-chime-sdk-voice';
import { v4 as uuidv4 } from 'uuid';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { AiAgent } from './agents';
import {
  getConfiguredVoiceAgent,
  getFullVoiceConfig,
  VoiceAgentConfig,
  VoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_FILLER_PHRASES,
  DEFAULT_OUTBOUND_GREETINGS,
  DEFAULT_AFTER_HOURS_GREETING,
} from './voice-agent-config';
import {
  createStreamingTTSManager,
  generateFullTTS,
  TTSChunk,
} from '../chime/utils/streaming-tts-manager';
import { getDateContext, getClinicName, getClinicTimezone } from '../../shared/prompts/ai-prompts';

// ========================================================================
// CONFIGURATION
// ========================================================================

const CONFIG = {
  // Default voice settings (can be overridden per clinic)
  DEFAULT_VOICE_ID: VoiceId.Joanna,
  DEFAULT_VOICE_ENGINE: Engine.NEURAL,
  SAMPLE_RATE: '8000', // Telephony standard
  OUTPUT_FORMAT: OutputFormat.PCM,

  // Goodbye message
  GOODBYE_MESSAGE: "Thank you for calling. Have a great day!",

  // Error message
  ERROR_MESSAGE: "I apologize, but I'm having trouble processing your request. Please try calling back during office hours or leave a message.",

  // Analytics retention (90 days TTL)
  ANALYTICS_TTL_DAYS: 90,

  // FIX: Cache configuration to prevent memory leaks
  MAX_CACHE_SIZE: 100, // Maximum number of clinic configs to cache

  // FIX: Streaming timeout - reduced to allow fallback within Lambda timeout
  STREAMING_TIMEOUT_MS: 18000, // 18 seconds (leaves 12s for fallback + cleanup)

  // FIX: Chunk retry configuration
  CHUNK_MAX_RETRIES: 2,
  CHUNK_RETRY_DELAY_MS: 100,

  // FIX: Analytics DLQ retry configuration
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
const pollyClient = new PollyClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Chime client for streaming responses
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoiceClient = new ChimeSDKVoiceClient({
  region: CHIME_MEDIA_REGION,
});
const ssmClient = new SSMClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const VOICE_SESSIONS_TABLE = process.env.VOICE_SESSIONS_TABLE || 'VoiceAiSessions';
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';
const CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE || '';
const CALL_ANALYTICS_ENABLED = process.env.CALL_ANALYTICS_ENABLED === 'true';
const CALL_RECORDINGS_BUCKET = process.env.CALL_RECORDINGS_BUCKET || '';

// Streaming response configuration
const STREAMING_ENABLED = process.env.ENABLE_STREAMING_RESPONSES === 'true';
const MIN_CHUNK_SIZE = 50; // Minimum characters before sending a chunk
const SMA_ID_MAP_PARAMETER = process.env.SMA_ID_MAP_PARAMETER || '';

// ========================================================================
// TYPES
// ========================================================================

interface ClinicHours {
  clinicId: string;
  timezone: string;
  hours: {
    [day: string]: {
      open: string; // "09:00"
      close: string; // "17:00"
      closed?: boolean;
    };
  };
}

interface VoiceSession {
  sessionId: string;
  callId: string;
  clinicId: string;
  agentId: string;
  callerNumber: string;
  bedrockSessionId: string;
  startTime: string;
  lastActivityTime: string;
  status: 'active' | 'ended';
  transcripts: Array<{
    speaker: 'caller' | 'ai';
    text: string;
    timestamp: string;
  }>;
  // ANALYTICS FIX: Track tools used across invocations
  toolsUsed: string[];
  ttl: number;
}

interface VoiceAiEvent {
  eventType: 'NEW_CALL' | 'TRANSCRIPT' | 'CALL_ENDED' | 'DTMF';
  callId: string;
  clinicId: string;
  callerNumber?: string;
  transcript?: string;
  dtmfDigits?: string;
  sessionId?: string;
  // Outbound call context
  isOutbound?: boolean;
  purpose?: 'appointment_reminder' | 'follow_up' | 'payment_reminder' | 'reengagement' | 'custom';
  patientName?: string;
  customMessage?: string;
  scheduledCallId?: string;
  aiAgentId?: string;
  clinicName?: string;
  appointmentDate?: string;
  // AI Phone Number context
  // When true, call came to an AI-dedicated phone number (always AI, no hours check needed)
  isAiPhoneNumber?: boolean;
}

interface VoiceAiResponse {
  action: 'SPEAK' | 'PLAY_AUDIO' | 'HANG_UP' | 'TRANSFER' | 'CONTINUE';
  text?: string;
  audioUrl?: string;
  transferNumber?: string;
  sessionId?: string;
}

/**
 * Call Analytics Record
 * 
 * IMPORTANT: This uses the SHARED CallAnalytics table from AnalyticsStack.
 * Schema must match AnalyticsStack.analyticsTable:
 *   - PK: callId (String) - unique call identifier
 *   - SK: timestamp (Number) - call start timestamp in milliseconds
 *   - GSIs: clinicId-timestamp, agentId-timestamp, callStatus-timestamp, etc.
 * 
 * This ensures Voice AI records appear alongside Chime stream records in dashboards.
 */
interface CallAnalytics {
  // Primary Key (shared table schema)
  callId: string;             // PK - unique call identifier
  timestamp: number;          // SK - call timestamp in milliseconds

  // Core fields (aligned with AnalyticsStack)
  clinicId: string;
  callStatus: 'active' | 'completed' | 'error';  // For GSI queries
  callCategory: 'ai_voice' | 'ai_outbound';      // Distinguishes AI calls

  // Call details
  callType: 'inbound' | 'outbound';
  purpose?: string;           // For outbound: appointment_reminder, follow_up, etc.
  duration: number;           // seconds
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'completed' | 'transferred' | 'error';

  // Agent info
  aiAgentId: string;          // Maps to agentId GSI
  aiAgentName?: string;

  // Caller info
  callerNumber?: string;
  patientName?: string;

  // Analytics fields
  transcriptSummary?: string;
  toolsUsed?: string[];       // Which OpenDental tools were called
  appointmentBooked?: boolean;
  overallSentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'MIXED';  // Aligned with Comprehend

  // Source identifier
  analyticsSource: 'voice_ai';  // Identifies these records came from Voice AI

  // TTL
  ttl: number;
}

/**
 * Cached voice config per clinic (for performance)
 * 
 * FIX: Implements LRU eviction with max size to prevent memory leaks.
 * Previously had unbounded growth in multi-tenant environments.
 */
const voiceConfigCache: Map<string, { config: VoiceAgentConfig | null; timestamp: number; lastAccess: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * FIX: LRU cache eviction - removes oldest entries when cache exceeds max size
 */
function evictCacheIfNeeded(): void {
  if (voiceConfigCache.size <= CONFIG.MAX_CACHE_SIZE) return;

  // Find and remove the least recently accessed entries
  const entriesToRemove = voiceConfigCache.size - CONFIG.MAX_CACHE_SIZE + 10; // Remove 10 extra to avoid frequent evictions
  const entries = Array.from(voiceConfigCache.entries())
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    .slice(0, entriesToRemove);

  for (const [key] of entries) {
    voiceConfigCache.delete(key);
  }

  console.log(`[voiceConfigCache] Evicted ${entries.length} entries, cache size now: ${voiceConfigCache.size}`);
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

/**
 * Check if clinic is currently open
 */
async function isClinicOpen(clinicId: string): Promise<boolean> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: CLINIC_HOURS_TABLE,
      Key: { clinicId },
    }));

    const clinicHours = response.Item as ClinicHours | undefined;
    if (!clinicHours?.hours) {
      // No hours defined = always use AI
      return false;
    }

    const now = new Date();
    const timezone = clinicHours.timezone || 'America/New_York';

    // Get current time in clinic's timezone
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);

    const dayOfWeek = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const currentTime = hour * 60 + minute; // Minutes since midnight

    const todayHours = clinicHours.hours[dayOfWeek];
    if (!todayHours || todayHours.closed) {
      return false;
    }

    const [openHour, openMin] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
    const openTime = openHour * 60 + openMin;
    const closeTime = closeHour * 60 + closeMin;

    return currentTime >= openTime && currentTime < closeTime;
  } catch (error) {
    console.error('Error checking clinic hours:', error);
    return false; // Default to AI if can't check hours
  }
}

/**
 * Get cached voice config for a clinic
 * 
 * FIX: Now updates lastAccess for LRU tracking and evicts old entries
 */
async function getCachedVoiceConfig(clinicId: string): Promise<VoiceAgentConfig | null> {
  const now = Date.now();
  const cached = voiceConfigCache.get(clinicId);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    // FIX: Update last access time for LRU tracking
    cached.lastAccess = now;
    return cached.config;
  }

  const config = await getFullVoiceConfig(clinicId);

  // FIX: Evict old entries before adding new one
  evictCacheIfNeeded();

  voiceConfigCache.set(clinicId, { config, timestamp: now, lastAccess: now });
  return config;
}

/**
 * Get a random thinking phrase (uses clinic-specific or defaults)
 */
async function getThinkingPhrase(clinicId: string): Promise<string> {
  const config = await getCachedVoiceConfig(clinicId);
  const phrases = config?.customFillerPhrases?.length
    ? config.customFillerPhrases
    : DEFAULT_FILLER_PHRASES;

  const index = Math.floor(Math.random() * phrases.length);
  return phrases[index];
}

/**
 * Get greeting for the call based on type and purpose
 */
async function getGreeting(
  clinicId: string,
  isOutbound: boolean,
  purpose?: string,
  context?: { patientName?: string; clinicName?: string; appointmentDate?: string; customMessage?: string }
): Promise<string> {
  const config = await getCachedVoiceConfig(clinicId);
  let greeting: string;

  if (isOutbound && purpose) {
    // Use outbound greeting based on purpose
    const customGreetings = config?.outboundGreetings;
    greeting = customGreetings?.[purpose as keyof typeof customGreetings]
      || DEFAULT_OUTBOUND_GREETINGS[purpose]
      || DEFAULT_OUTBOUND_GREETINGS['custom'];
  } else {
    // Use after-hours inbound greeting
    greeting = config?.afterHoursGreeting || DEFAULT_AFTER_HOURS_GREETING;
  }

  // Replace placeholders with context
  if (context) {
    greeting = greeting
      .replace(/{patientName}/g, context.patientName || 'there')
      .replace(/{clinicName}/g, context.clinicName || 'our dental office')
      .replace(/{appointmentDate}/g, context.appointmentDate || 'your scheduled date')
      .replace(/{customMessage}/g, context.customMessage || '');
  }

  return greeting;
}

/**
 * Get voice settings for a clinic (or defaults)
 */
async function getVoiceSettings(clinicId: string): Promise<VoiceSettings> {
  const config = await getCachedVoiceConfig(clinicId);
  return config?.voiceSettings || DEFAULT_VOICE_SETTINGS;
}

/**
 * Convert text to speech using Amazon Polly with clinic-specific voice settings
 */
async function textToSpeech(text: string, clinicId?: string): Promise<Buffer> {
  const voiceSettings = clinicId ? await getVoiceSettings(clinicId) : DEFAULT_VOICE_SETTINGS;

  const command = new SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: CONFIG.OUTPUT_FORMAT,
    VoiceId: voiceSettings.voiceId as VoiceId,
    // NOTE: We intentionally pass through the configured engine (standard/neural/generative/long-form).
    // Availability depends on voice + region; Polly will reject unsupported combinations.
    Engine: (voiceSettings.engine || 'neural') as unknown as Engine,
    SampleRate: CONFIG.SAMPLE_RATE,
  });

  const response = await pollyClient.send(command);

  if (response.AudioStream) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.AudioStream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  throw new Error('No audio stream returned from Polly');
}

/**
 * Record call analytics to the SHARED CallAnalytics table (from AnalyticsStack)
 * 
 * Uses the correct schema: PK=callId, SK=timestamp (Number)
 * This ensures Voice AI records are visible in the same dashboards as Chime records.
 * 
 * FIX: Added retry logic with exponential backoff to prevent data loss.
 * Previously, transient DynamoDB errors would silently drop analytics records.
 */
async function recordCallAnalytics(params: {
  callId: string;
  clinicId: string;
  callType: 'inbound' | 'outbound';
  purpose?: string;
  duration: number;
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'completed' | 'transferred' | 'error';
  aiAgentId: string;
  aiAgentName?: string;
  callerNumber?: string;
  patientName?: string;
  transcriptSummary?: string;
  toolsUsed?: string[];
  appointmentBooked?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
}): Promise<void> {
  if (!CALL_ANALYTICS_ENABLED || !CALL_ANALYTICS_TABLE) {
    console.warn('[recordCallAnalytics] Call analytics disabled or table not configured');
    return;
  }

  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (CONFIG.ANALYTICS_TTL_DAYS * 24 * 60 * 60);

  // Map sentiment to Comprehend format
  const overallSentiment = params.sentiment
    ? params.sentiment.toUpperCase() as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'
    : undefined;

  const analytics: CallAnalytics = {
    // Primary Key (shared table schema)
    callId: params.callId,
    timestamp: now,

    // Core fields
    clinicId: params.clinicId,
    callStatus: params.outcome === 'error' ? 'error' : 'completed',
    callCategory: params.callType === 'outbound' ? 'ai_outbound' : 'ai_voice',

    // Call details
    callType: params.callType,
    purpose: params.purpose,
    duration: params.duration,
    outcome: params.outcome,

    // Agent info
    aiAgentId: params.aiAgentId,
    aiAgentName: params.aiAgentName,

    // Caller info
    callerNumber: params.callerNumber,
    patientName: params.patientName,

    // Analytics fields
    transcriptSummary: params.transcriptSummary,
    toolsUsed: params.toolsUsed,
    appointmentBooked: params.appointmentBooked,
    overallSentiment,

    // Source identifier
    analyticsSource: 'voice_ai',

    // TTL
    ttl,
  };

  // FIX: Retry logic for transient DynamoDB errors
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= CONFIG.ANALYTICS_MAX_RETRIES + 1; attempt++) {
    try {
      await docClient.send(new PutCommand({
        TableName: CALL_ANALYTICS_TABLE,
        Item: analytics,
      }));

      console.log('[recordCallAnalytics] Analytics recorded to shared table:', {
        callId: analytics.callId,
        clinicId: analytics.clinicId,
        callType: analytics.callType,
        callCategory: analytics.callCategory,
        outcome: analytics.outcome,
        analyticsSource: analytics.analyticsSource,
        attempt,
      });
      return; // Success - exit

    } catch (error: any) {
      lastError = error;

      // FIX: Only retry on transient errors
      const isRetryable = error.name === 'ProvisionedThroughputExceededException' ||
        error.name === 'ServiceUnavailable' ||
        error.name === 'InternalServerError' ||
        error.message?.includes('ECONNRESET');

      if (isRetryable && attempt <= CONFIG.ANALYTICS_MAX_RETRIES) {
        console.warn(`[recordCallAnalytics] Transient error, retrying (attempt ${attempt}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, CONFIG.ANALYTICS_RETRY_DELAY_MS * attempt));
        continue;
      }

      // Non-retryable error or max retries exceeded
      break;
    }
  }

  // FIX: Log detailed error for monitoring/alerting, but don't throw
  console.error('[recordCallAnalytics] Failed to record analytics after retries:', {
    callId: params.callId,
    clinicId: params.clinicId,
    error: lastError?.message || 'Unknown error',
    errorName: (lastError as any)?.name,
    // Include enough data to manually recover if needed
    analyticsPayload: JSON.stringify(analytics).substring(0, 1000),
  });
}

/**
 * Get or create voice session
 * 
 * FIX: Enhanced race condition prevention using:
 * 1. Deterministic sessionId based on callId (ensures same ID across Lambda instances)
 * 2. Conditional PutItem with callId check in a separate lock-like entry
 * 3. Longer exponential backoff with jitter to handle GSI eventual consistency
 * 4. Direct table query as final fallback (consistent read on main table)
 */
async function getOrCreateSession(
  callId: string,
  clinicId: string,
  agentId: string,
  callerNumber: string
): Promise<VoiceSession> {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 75;

  // FIX: Use deterministic sessionId based on callId to prevent duplicate sessions
  // This ensures all Lambda instances generate the same sessionId for the same call
  const sessionId = `voice-${callId}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // First, try to get existing session by deterministic sessionId (direct table read)
    try {
      const directRead = await docClient.send(new GetCommand({
        TableName: VOICE_SESSIONS_TABLE,
        Key: { sessionId },
        ConsistentRead: true, // FIX: Use consistent read on main table
      }));

      if (directRead.Item) {
        console.log(`[getOrCreateSession] Found existing session via direct read for callId ${callId}`);
        return directRead.Item as VoiceSession;
      }
    } catch (readError) {
      console.warn(`[getOrCreateSession] Direct read failed, falling back to GSI:`, readError);
    }

    // Fallback: Check GSI (eventually consistent, but covers edge cases)
    const existingResponse = await docClient.send(new QueryCommand({
      TableName: VOICE_SESSIONS_TABLE,
      IndexName: 'CallIdIndex',
      KeyConditionExpression: 'callId = :cid',
      ExpressionAttributeValues: { ':cid': callId },
    }));

    if (existingResponse.Items && existingResponse.Items.length > 0) {
      console.log(`[getOrCreateSession] Found existing session via GSI for callId ${callId}`);
      return existingResponse.Items[0] as VoiceSession;
    }

    // No existing session found - create new one
    const bedrockSessionId = uuidv4();
    const now = new Date().toISOString();

    const session: VoiceSession = {
      sessionId,
      callId,
      clinicId,
      agentId,
      callerNumber,
      bedrockSessionId,
      startTime: now,
      lastActivityTime: now,
      status: 'active',
      transcripts: [],
      toolsUsed: [],
      ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hour TTL
    };

    try {
      // FIX: Conditional put that fails if sessionId already exists
      await docClient.send(new PutCommand({
        TableName: VOICE_SESSIONS_TABLE,
        Item: session,
        ConditionExpression: 'attribute_not_exists(sessionId)',
      }));

      console.log(`[getOrCreateSession] Created new session for callId ${callId}`, { sessionId, attempt });
      return session;

    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Session was created by another Lambda instance - retrieve it
        console.log(`[getOrCreateSession] Session already exists (created by parallel request), retrieving...`);

        // FIX: Use consistent read to get the session that was just created
        const existingSession = await docClient.send(new GetCommand({
          TableName: VOICE_SESSIONS_TABLE,
          Key: { sessionId },
          ConsistentRead: true,
        }));

        if (existingSession.Item) {
          return existingSession.Item as VoiceSession;
        }

        // If still not found, wait with jitter and retry
        if (attempt < MAX_RETRIES) {
          // FIX: Exponential backoff with jitter to prevent thundering herd
          const jitter = Math.random() * 50;
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Re-throw if it's a different error
      throw error;
    }
  }

  // FIX: Final fallback with consistent read
  const finalCheck = await docClient.send(new GetCommand({
    TableName: VOICE_SESSIONS_TABLE,
    Key: { sessionId },
    ConsistentRead: true,
  }));

  if (finalCheck.Item) {
    console.log(`[getOrCreateSession] Found session in final check for callId ${callId}`);
    return finalCheck.Item as VoiceSession;
  }

  throw new Error(`[getOrCreateSession] Failed to create or find session for callId ${callId} after ${MAX_RETRIES} attempts`);
}

/**
 * Update session with new transcript and optionally add tools used
 * 
 * TTL FIX: Also refreshes TTL on every activity to prevent mid-call expiry
 */
async function updateSessionTranscript(
  sessionId: string,
  speaker: 'caller' | 'ai',
  text: string,
  newToolsUsed?: string[]
): Promise<void> {
  const now = new Date().toISOString();
  // TTL FIX: Refresh TTL to 24 hours from now on every activity
  const newTtl = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

  let updateExpression = 'SET transcripts = list_append(if_not_exists(transcripts, :empty), :transcript), lastActivityTime = :now, #ttl = :newTtl';
  const expressionAttributeValues: Record<string, any> = {
    ':empty': [],
    ':transcript': [{ speaker, text, timestamp: now }],
    ':now': now,
    ':newTtl': newTtl,
  };
  const expressionAttributeNames: Record<string, string> = { '#ttl': 'ttl' };

  // ANALYTICS FIX: Append new tools to the session's toolsUsed array
  if (newToolsUsed && newToolsUsed.length > 0) {
    updateExpression += ', toolsUsed = list_append(if_not_exists(toolsUsed, :emptyTools), :newTools)';
    expressionAttributeValues[':emptyTools'] = [];
    expressionAttributeValues[':newTools'] = newToolsUsed;
  }

  await docClient.send(new UpdateCommand({
    TableName: VOICE_SESSIONS_TABLE,
    Key: { sessionId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * Get the voice AI agent for a clinic's after-hours calls
 * 
 * SECURITY FIX: Respects aiInboundEnabled flag at all levels.
 * If aiInboundEnabled is explicitly false, returns null (no fallback).
 * 
 * Priority order (only if AI inbound is enabled):
 * 1. CONFIGURED agent (from VoiceAgentConfig - change anytime via API)
 * 2. Agent with isDefaultVoiceAgent = true (fallback)
 * 3. Any voice-enabled agent for the clinic
 * 4. Any active agent for the clinic (ONLY if no voice config exists)
 * 
 * LOGIC FIX: Consistent handling of config states:
 * - Config exists + aiInboundEnabled=false → null (user disabled AI)
 * - Config exists + aiInboundEnabled=true/undefined + no agent → null (user wants voicemail)
 * - Config exists + agent set → use that agent
 * - No config at all → use fallback agents (new clinic, not yet configured)
 */
async function getVoiceAgent(clinicId: string): Promise<AiAgent | null> {
  // FIRST: Get voice config to check enabled state
  const voiceConfig = await getFullVoiceConfig(clinicId);

  // If config exists, check the enabled flag FIRST (before any agent lookup)
  if (voiceConfig) {
    // CRITICAL: If AI inbound is explicitly disabled, return null immediately
    if (voiceConfig.aiInboundEnabled === false) {
      console.log(`[getVoiceAgent] AI inbound is explicitly DISABLED for clinic ${clinicId}`);
      return null;
    }

    // If agent is configured, try to use it
    if (voiceConfig.inboundAgentId) {
      const agentResponse = await docClient.send(new GetCommand({
        TableName: AGENTS_TABLE,
        Key: { agentId: voiceConfig.inboundAgentId },
      }));

      if (agentResponse.Item && agentResponse.Item.isActive && agentResponse.Item.bedrockAgentStatus === 'PREPARED') {
        console.log(`[getVoiceAgent] Using CONFIGURED agent for clinic ${clinicId}:`, voiceConfig.inboundAgentId);
        return agentResponse.Item as AiAgent;
      }

      // Configured agent is not ready - log warning but continue to fallbacks
      console.warn(`[getVoiceAgent] Configured agent ${voiceConfig.inboundAgentId} is not ready, trying fallbacks`);
    }

    // Config exists but no working agent configured
    // If aiInboundEnabled is explicitly true, try fallbacks
    // If aiInboundEnabled is undefined (legacy), try fallbacks for backwards compatibility
    if (voiceConfig.aiInboundEnabled === undefined && !voiceConfig.inboundAgentId) {
      // Legacy config without explicit toggle and no agent = use voicemail
      console.log(`[getVoiceAgent] Config exists but no agent set for clinic ${clinicId}, using voicemail`);
      return null;
    }
  }

  // At this point, either:
  // - No config exists (new clinic)
  // - Config exists with aiInboundEnabled=true/undefined but configured agent failed
  // Try fallback agents

  // SECOND: Try to find the DEFAULT voice agent for this clinic
  const defaultResponse = await docClient.send(new QueryCommand({
    TableName: AGENTS_TABLE,
    IndexName: 'ClinicIndex',
    KeyConditionExpression: 'clinicId = :cid',
    FilterExpression: 'isActive = :active AND isVoiceEnabled = :voice AND isDefaultVoiceAgent = :default AND bedrockAgentStatus = :status',
    ExpressionAttributeValues: {
      ':cid': clinicId,
      ':active': true,
      ':voice': true,
      ':default': true,
      ':status': 'PREPARED',
    },
  }));

  if (defaultResponse.Items && defaultResponse.Items.length > 0) {
    console.log(`[getVoiceAgent] Using DEFAULT voice agent for clinic ${clinicId}:`, defaultResponse.Items[0].agentId);
    return defaultResponse.Items[0] as AiAgent;
  }

  // THIRD: Try any voice-enabled agent for the clinic
  const voiceResponse = await docClient.send(new QueryCommand({
    TableName: AGENTS_TABLE,
    IndexName: 'ClinicIndex',
    KeyConditionExpression: 'clinicId = :cid',
    FilterExpression: 'isActive = :active AND isVoiceEnabled = :voice AND bedrockAgentStatus = :status',
    ExpressionAttributeValues: {
      ':cid': clinicId,
      ':active': true,
      ':voice': true,
      ':status': 'PREPARED',
    },
    Limit: 1,
  }));

  if (voiceResponse.Items && voiceResponse.Items.length > 0) {
    console.log(`[getVoiceAgent] Using voice-enabled agent for clinic ${clinicId}:`, voiceResponse.Items[0].agentId);
    return voiceResponse.Items[0] as AiAgent;
  }

  // FOURTH: Only use any-active-agent fallback if NO config exists at all
  // This allows new clinics to get AI while configured clinics respect their settings
  if (!voiceConfig) {
    const fallbackResponse = await docClient.send(new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :cid',
      FilterExpression: 'isActive = :active AND bedrockAgentStatus = :status',
      ExpressionAttributeValues: {
        ':cid': clinicId,
        ':active': true,
        ':status': 'PREPARED',
      },
      Limit: 1,
    }));

    if (fallbackResponse.Items && fallbackResponse.Items.length > 0) {
      console.log(`[getVoiceAgent] Using fallback agent for clinic ${clinicId}:`, fallbackResponse.Items[0].agentId);
      return fallbackResponse.Items[0] as AiAgent;
    }
  }

  console.warn(`[getVoiceAgent] No suitable agent found for clinic ${clinicId}`);
  return null;
}

// ========================================================================
// STREAMING RESPONSE HELPERS
// ========================================================================

// Cache for SMA ID map
let smaIdMapCache: Record<string, string> | null = null;
let smaIdMapCacheTime = 0;
const SMA_ID_MAP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get SMA ID for a clinic from SSM parameter
 */
async function getSmaIdForClinic(clinicId: string): Promise<string | null> {
  if (!SMA_ID_MAP_PARAMETER) {
    console.warn('[getSmaIdForClinic] SMA_ID_MAP_PARAMETER not configured');
    return null;
  }

  try {
    // Check cache
    const now = Date.now();
    if (smaIdMapCache && now - smaIdMapCacheTime < SMA_ID_MAP_CACHE_TTL) {
      return smaIdMapCache[clinicId] || smaIdMapCache['default'] || null;
    }

    // Fetch from SSM
    const response = await ssmClient.send(new GetParameterCommand({
      Name: SMA_ID_MAP_PARAMETER,
    }));

    if (response.Parameter?.Value) {
      smaIdMapCache = JSON.parse(response.Parameter.Value);
      smaIdMapCacheTime = now;
      return smaIdMapCache?.[clinicId] || smaIdMapCache?.['default'] || null;
    }

    return null;
  } catch (error) {
    console.error('[getSmaIdForClinic] Error fetching SMA ID:', error);
    return null;
  }
}

/**
 * Send a streaming chunk to the call via UpdateSipMediaApplicationCall
 * This interrupts the current action (pause) and speaks the chunk immediately
 * 
 * FIX: Added retry logic to prevent lost chunks. Previously, transient Chime errors
 * would silently drop parts of the AI's response, causing conversation coherence issues.
 */
async function sendStreamingChunk(
  callId: string,
  clinicId: string,
  text: string,
  isFinal: boolean,
  sessionId?: string
): Promise<boolean> {
  const smaId = await getSmaIdForClinic(clinicId);
  if (!smaId) {
    console.warn('[sendStreamingChunk] No SMA ID found for clinic:', clinicId);
    return false;
  }

  const actions = [
    {
      Type: 'Speak',
      Parameters: {
        Text: text,
        Engine: 'neural',
        LanguageCode: 'en-US',
        TextType: 'text',
        VoiceId: 'Joanna',
      },
    },
  ];

  // If this is the final chunk, add CONTINUE to keep listening
  if (isFinal) {
    actions.push({
      Type: 'Pause',
      Parameters: {
        DurationInMilliseconds: '500',
      },
    } as any);
  }

  // FIX: Retry logic for transient Chime errors
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= CONFIG.CHUNK_MAX_RETRIES + 1; attempt++) {
    try {
      await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: callId, // callId is the transactionId
        Arguments: {
          pendingAiActions: JSON.stringify(actions),
          aiResponseTime: new Date().toISOString(),
          isStreamingChunk: 'true',
          isFinalChunk: isFinal ? 'true' : 'false',
          sessionId: sessionId || '',
        },
      }));

      console.log('[sendStreamingChunk] Sent chunk:', { callId, textLength: text.length, isFinal, attempt });
      return true;

    } catch (error: any) {
      lastError = error;

      // FIX: Only retry on transient errors, not on call-ended errors
      const isRetryable = error.name === 'ThrottlingException' ||
        error.name === 'ServiceUnavailableException' ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('socket hang up');

      // Don't retry if the call is no longer active
      const isCallEnded = error.name === 'NotFoundException' ||
        error.message?.includes('Call not found') ||
        error.message?.includes('Transaction');

      if (isCallEnded) {
        console.warn('[sendStreamingChunk] Call is no longer active, skipping chunk');
        return false;
      }

      if (isRetryable && attempt <= CONFIG.CHUNK_MAX_RETRIES) {
        console.warn(`[sendStreamingChunk] Transient error, retrying (attempt ${attempt}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, CONFIG.CHUNK_RETRY_DELAY_MS * attempt));
        continue;
      }

      break;
    }
  }

  console.error('[sendStreamingChunk] Failed to send chunk after retries:', {
    callId,
    textLength: text.length,
    error: lastError?.message,
    // Include chunk text for debugging (truncated)
    chunkPreview: text.substring(0, 100),
  });
  return false;
}

/**
 * Split text into sentences for streaming
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries while keeping the delimiter
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Sanitize AI response text for voice (Polly / Chime Speak action).
 *
 * Bedrock can emit markdown, XML-like tags, ISO datetimes and other
 * formatting that sounds terrible when read aloud. This function:
 *  1. Converts ISO datetime strings → natural spoken form
 *  2. Removes all Markdown formatting (headers, bold, bullets, etc.)
 *  3. Removes HTML / XML / AWS-style <<...>> tags
 *  4. Collapses whitespace
 */
function sanitizeForVoice(text: string): string {
  if (!text) return text;

  let out = text;

  // --- 1. Convert ISO datetime strings e.g. "2026-02-26 09:00:00" or "2026-02-26T09:30:00" ---
  out = out.replace(
    /\b(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}):(\d{2})(?::\d{2})?\b/g,
    (_match, year, month, day, hour, minute) => {
      try {
        const dt = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        if (isNaN(dt.getTime())) return _match;

        const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
        const monthName = dt.toLocaleDateString('en-US', { month: 'long' });
        const dayNum = parseInt(day, 10);
        const suffix = dayNum === 1 || dayNum === 21 || dayNum === 31 ? 'st'
          : dayNum === 2 || dayNum === 22 ? 'nd'
            : dayNum === 3 || dayNum === 23 ? 'rd'
              : 'th';
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        const ampm = h < 12 ? 'AM' : 'PM';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        const timePart = m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;

        return `${weekday}, ${monthName} ${dayNum}${suffix} at ${timePart}`;
      } catch {
        return _match;
      }
    }
  );

  // --- 2. Convert date-only strings e.g. "2026-02-26" that remain ---
  out = out.replace(
    /\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g,
    (_match, year, month, day) => {
      try {
        const dt = new Date(`${year}-${month}-${day}T12:00:00`);
        if (isNaN(dt.getTime())) return _match;
        const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
        const monthName = dt.toLocaleDateString('en-US', { month: 'long' });
        const dayNum = parseInt(day, 10);
        const suffix = dayNum === 1 || dayNum === 21 || dayNum === 31 ? 'st'
          : dayNum === 2 || dayNum === 22 ? 'nd'
            : dayNum === 3 || dayNum === 23 ? 'rd'
              : 'th';
        return `${weekday}, ${monthName} ${dayNum}${suffix}`;
      } catch {
        return _match;
      }
    }
  );

  // --- 3. Strip AWS-style <<...>> delimiters (e.g. <<question_mark>>, <<less_than>>) ---
  out = out.replace(/<<[^>]*>>/g, '');
  out = out.replace(/<[^>]+>/g, '');       // HTML / XML tags

  // --- 4. Strip Markdown formatting ---
  // Headers  (### Title)
  out = out.replace(/^#{1,6}\s+/gm, '');
  // Bold / italic  (**text**, *text*, __text__, _text_)
  out = out.replace(/(\*{1,3}|_{1,3})([^*_]+?)\1/g, '$2');
  // Inline code  (`code`)
  out = out.replace(/`([^`]+)`/g, '$1');
  // Code blocks  (``` ... ```)
  out = out.replace(/```[\s\S]*?```/g, '');
  // Horizontal rules
  out = out.replace(/^[-*_]{3,}\s*$/gm, '');
  // Bullet / numbered list markers  (• - * or 1.)
  out = out.replace(/^\s*([•\-\*]|\d+\.?)\s+/gm, '');
  // Blockquotes
  out = out.replace(/^>\s*/gm, '');
  // Links  [text](url)
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Escaped characters  \* \_ etc.
  out = out.replace(/\\([\*_`#~|>])/g, '$1');
  // Remaining literal asterisks / underscores used as decoration
  out = out.replace(/[\*_]{2,}/g, '');
  // Table separators  | --- |
  out = out.replace(/\|[-:| ]+\|/g, '');
  // Table pipe characters
  out = out.replace(/\|/g, ' ');

  // --- 5. Clean up whitespace ---
  out = out.replace(/[ \t]{2,}/g, ' ');   // collapse multiple spaces
  out = out.replace(/\n{3,}/g, '\n\n');   // collapse multiple blank lines
  out = out.replace(/^\s+|\s+$/gm, '');   // trim each line
  out = out.trim();

  return out;
}

/**
 * Invoke AI agent with streaming response
 * Sends partial responses via UpdateSipMediaApplicationCall as they arrive
 * 
 * Enhanced with sentence-level TTS for lower latency:
 * - Uses StreamingTTSManager to detect sentence boundaries
 * - Generates TTS for each sentence immediately
 * - Sends audio via PlayAudio action for better quality
 */
async function invokeAiAgentWithStreaming(
  agent: AiAgent,
  session: VoiceSession,
  userMessage: string,
  callId: string,
  clinicId: string,
  // FIX: Add cancellation signal to stop streaming when timeout fires
  cancellationSignal?: { cancelled: boolean }
): Promise<{ response: string; thinking: string[]; chunksSent: number }> {
  const thinking: string[] = [];
  let fullResponse = '';
  let chunksSent = 0;

  // Initialize streaming TTS manager for sentence-level TTS
  const ttsManager = createStreamingTTSManager(callId);

  // Get voice settings for clinic
  let voiceSettings = DEFAULT_VOICE_SETTINGS;
  try {
    const voiceConfig = await getFullVoiceConfig(clinicId);
    if (voiceConfig?.voiceSettings) {
      voiceSettings = voiceConfig.voiceSettings;
    }
  } catch (err) {
    console.warn('[invokeAiAgentWithStreaming] Failed to get voice config, using defaults');
  }

  const ttsOptions = {
    voiceId: voiceSettings.voiceId || 'Joanna',
    engine: voiceSettings.engine || 'neural',
  };

  // Get timezone-aware date context + clinic display name for accurate scheduling & natural greetings
  const [clinicTimezone, clinicName] = await Promise.all([
    getClinicTimezone(session.clinicId),
    getClinicName(session.clinicId),
  ]);
  const dateContext = getDateContext(clinicTimezone);
  const [year, month, day] = dateContext.today.split('-');
  const todayFormatted = `${month}/${day}/${year}`;

  const sessionAttributes: Record<string, string> = {
    clinicId: session.clinicId,
    clinicName,
    callerNumber: session.callerNumber,
    isVoiceCall: 'true',
    inputMode: 'Speech',
    // Current date information for accurate scheduling (timezone-aware)
    todayDate: dateContext.today,
    todayFormatted: todayFormatted,
    dayName: dateContext.dayName,
    tomorrowDate: dateContext.tomorrowDate,
    currentTime: dateContext.currentTime,
    nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
    timezone: dateContext.timezone,
  };

  const promptSessionAttributes: Record<string, string> = {
    clinicName,
    currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
    dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`,
  };

  const invokeCommand = new InvokeAgentCommand({
    agentId: agent.bedrockAgentId,
    agentAliasId: agent.bedrockAgentAliasId,
    sessionId: session.bedrockSessionId,
    inputText: userMessage,
    enableTrace: true,
    sessionState: {
      sessionAttributes,
      promptSessionAttributes,
    },
  });

  const bedrockResponse = await bedrockAgentClient.send(invokeCommand);

  if (bedrockResponse.completion) {
    for await (const event of bedrockResponse.completion) {
      // FIX: Check cancellation signal and stop processing if cancelled
      // This prevents continued streaming after timeout fires
      if (cancellationSignal?.cancelled) {
        console.log('[invokeAiAgentWithStreaming] Cancellation requested, stopping stream processing');
        ttsManager.reset(); // Clean up TTS manager state
        break;
      }

      // Capture thinking/trace
      if (event.trace?.trace) {
        const trace = event.trace.trace;

        if (trace.orchestrationTrace?.rationale?.text) {
          thinking.push(trace.orchestrationTrace.rationale.text);
        }

        if (trace.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const action = trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          thinking.push(`Checking: ${action.apiPath}`);
        }
      }

      // Capture response chunks and process with streaming TTS
      if (event.chunk?.bytes) {
        const chunkText = new TextDecoder().decode(event.chunk.bytes);
        fullResponse += chunkText;

        // Skip TTS processing if cancelled
        if (cancellationSignal?.cancelled) {
          console.log('[invokeAiAgentWithStreaming] Skipping TTS processing due to cancellation');
          continue;
        }

        // Sanitize chunk before feeding to TTS - removes markdown / XML tags / ISO dates
        // Note: sanitization works best on complete tokens; the TTS manager buffers until
        // sentence boundaries, so stray markdown symbols in mid-sentence chunks are handled.
        const cleanedChunkText = sanitizeForVoice(chunkText);

        // Process text through TTS manager - emits chunks for complete sentences
        await ttsManager.processText(
          cleanedChunkText,
          async (ttsChunk: TTSChunk) => {
            // Double-check cancellation before sending
            if (cancellationSignal?.cancelled) return;

            const sent = await sendStreamingChunkWithTTS(
              callId,
              clinicId,
              ttsChunk,
              session.sessionId
            );
            if (sent) chunksSent++;
          },
          ttsOptions
        );
      }
    }
  }

  // FIX: Don't flush if cancelled - prevents sending more audio after timeout
  if (cancellationSignal?.cancelled) {
    console.log('[invokeAiAgentWithStreaming] Skipping flush due to cancellation');
    return { response: fullResponse, thinking, chunksSent };
  }

  // Flush any remaining text as final chunk
  await ttsManager.flush(
    async (ttsChunk: TTSChunk) => {
      const sent = await sendStreamingChunkWithTTS(
        callId,
        clinicId,
        { ...ttsChunk, isFinal: true },
        session.sessionId
      );
      if (sent) chunksSent++;
    },
    ttsOptions
  );

  return {
    response: fullResponse || "I'm sorry, I couldn't process that request.",
    thinking,
    chunksSent
  };
}

/**
 * Send streaming chunk with pre-generated TTS audio
 * Uses PlayAudio action instead of Speak for lower latency
 */
async function sendStreamingChunkWithTTS(
  callId: string,
  clinicId: string,
  ttsChunk: TTSChunk,
  sessionId?: string
): Promise<boolean> {
  const smaId = await getSmaIdForClinic(clinicId);
  if (!smaId) {
    console.warn('[sendStreamingChunkWithTTS] No SMA ID found for clinic:', clinicId);
    return false;
  }

  const actions = [
    {
      Type: 'PlayAudio',
      Parameters: {
        AudioSource: {
          Type: 'S3',
          BucketName: process.env.TTS_AUDIO_BUCKET || process.env.HOLD_MUSIC_BUCKET,
          Key: ttsChunk.audioS3Key,
        },
      },
    },
  ];

  // If this is the final chunk, add CONTINUE to keep listening
  if (ttsChunk.isFinal) {
    actions.push({
      Type: 'Pause',
      Parameters: {
        DurationInMilliseconds: '500',
      },
    } as any);
  }

  // Retry logic for transient Chime errors
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= CONFIG.CHUNK_MAX_RETRIES + 1; attempt++) {
    try {
      await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: callId,
        Arguments: {
          pendingAiActions: JSON.stringify(actions),
          aiResponseTime: new Date().toISOString(),
          isStreamingChunk: 'true',
          isFinalChunk: ttsChunk.isFinal ? 'true' : 'false',
          sessionId: sessionId || '',
          ttsSequence: String(ttsChunk.sequenceNumber),
        },
      }));

      console.log('[sendStreamingChunkWithTTS] Sent TTS chunk:', {
        callId,
        textLength: ttsChunk.text.length,
        isFinal: ttsChunk.isFinal,
        sequence: ttsChunk.sequenceNumber,
        attempt
      });
      return true;

    } catch (error: any) {
      lastError = error;

      const isRetryable = error.name === 'ThrottlingException' ||
        error.name === 'ServiceUnavailableException' ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('socket hang up');

      const isCallEnded = error.name === 'NotFoundException' ||
        error.message?.includes('Call not found') ||
        error.message?.includes('Transaction');

      if (isCallEnded) {
        console.warn('[sendStreamingChunkWithTTS] Call is no longer active, skipping chunk');
        return false;
      }

      if (isRetryable && attempt <= CONFIG.CHUNK_MAX_RETRIES) {
        console.warn(`[sendStreamingChunkWithTTS] Transient error, retrying (attempt ${attempt}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, CONFIG.CHUNK_RETRY_DELAY_MS * attempt));
        continue;
      }

      console.error('[sendStreamingChunkWithTTS] Failed to send chunk:', {
        error: lastError?.message,
        callId,
        attempt
      });
      return false;
    }
  }

  return false;
}

/**
 * Invoke AI agent and get response (non-streaming version)
 */
async function invokeAiAgent(
  agent: AiAgent,
  session: VoiceSession,
  userMessage: string
): Promise<{ response: string; thinking: string[] }> {
  const thinking: string[] = [];
  let fullResponse = '';

  // Get timezone-aware date context + clinic display name for accurate scheduling & natural greetings
  const [clinicTimezone, clinicName] = await Promise.all([
    getClinicTimezone(session.clinicId),
    getClinicName(session.clinicId),
  ]);
  const dateContext = getDateContext(clinicTimezone);
  const [year, month, day] = dateContext.today.split('-');
  const todayFormatted = `${month}/${day}/${year}`;

  const sessionAttributes: Record<string, string> = {
    clinicId: session.clinicId,
    clinicName,
    callerNumber: session.callerNumber,
    isVoiceCall: 'true',
    inputMode: 'Speech',
    // Current date information for accurate scheduling (timezone-aware)
    todayDate: dateContext.today,
    todayFormatted: todayFormatted,
    dayName: dateContext.dayName,
    tomorrowDate: dateContext.tomorrowDate,
    currentTime: dateContext.currentTime,
    nextWeekDates: JSON.stringify(dateContext.nextWeekDates),
    timezone: dateContext.timezone,
  };

  const promptSessionAttributes: Record<string, string> = {
    clinicName,
    currentDate: `Today is ${dateContext.dayName}, ${todayFormatted} (${dateContext.today}). Current time: ${dateContext.currentTime} (${dateContext.timezone})`,
    dateContext: `When scheduling appointments, use ${dateContext.today} as today's date. Tomorrow is ${dateContext.tomorrowDate}. Next week dates: ${JSON.stringify(dateContext.nextWeekDates)}`,
  };

  const invokeCommand = new InvokeAgentCommand({
    agentId: agent.bedrockAgentId,
    agentAliasId: agent.bedrockAgentAliasId,
    sessionId: session.bedrockSessionId,
    inputText: userMessage,
    enableTrace: true,
    sessionState: {
      sessionAttributes,
      promptSessionAttributes,
    },
  });

  const bedrockResponse = await bedrockAgentClient.send(invokeCommand);

  if (bedrockResponse.completion) {
    for await (const event of bedrockResponse.completion) {
      // Capture thinking/trace
      if (event.trace?.trace) {
        const trace = event.trace.trace;

        if (trace.orchestrationTrace?.rationale?.text) {
          thinking.push(trace.orchestrationTrace.rationale.text);
        }

        if (trace.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const action = trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          thinking.push(`Checking: ${action.apiPath}`);
        }
      }

      // Capture response
      if (event.chunk?.bytes) {
        fullResponse += new TextDecoder().decode(event.chunk.bytes);
      }
    }
  }

  return { response: fullResponse || "I'm sorry, I couldn't process that request.", thinking };
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: VoiceAiEvent): Promise<VoiceAiResponse[]> => {
  console.log('Voice AI Event:', JSON.stringify(event, null, 2));

  const responses: VoiceAiResponse[] = [];
  const callStartTime = Date.now();
  // FIX: Removed unused local toolsUsed variable
  // Tools used are tracked in session.toolsUsed (persisted in DynamoDB) instead

  try {
    switch (event.eventType) {
      case 'NEW_CALL': {
        const {
          callId,
          clinicId,
          callerNumber,
          isOutbound,
          purpose,
          patientName,
          customMessage,
          clinicName,
          appointmentDate,
          aiAgentId,
          isAiPhoneNumber,
        } = event;

        // For outbound calls, we skip the "is clinic open" check
        // For AI phone numbers, we also skip the hours check (always AI)
        if (!isOutbound && !isAiPhoneNumber) {
          // Inbound call to regular number - check if clinic is open
          const isOpen = await isClinicOpen(clinicId);
          if (isOpen) {
            // During office hours - transfer to human
            return [{
              action: 'TRANSFER',
              transferNumber: 'QUEUE', // Transfer to agent queue
            }];
          }
        }

        // Log AI phone number routing
        if (isAiPhoneNumber) {
          console.log(`[NEW_CALL] AI Phone Number call - bypassing hours check`, {
            callId,
            clinicId,
            callerNumber,
          });
        }

        // Get AI agent (use specific agent for outbound, or find one for inbound)
        let agent: AiAgent | null = null;

        if (aiAgentId) {
          // Specific agent requested (for outbound calls)
          const agentResponse = await docClient.send(new GetCommand({
            TableName: AGENTS_TABLE,
            Key: { agentId: aiAgentId },
          }));
          if (agentResponse.Item?.isActive && agentResponse.Item?.bedrockAgentStatus === 'PREPARED') {
            agent = agentResponse.Item as AiAgent;
          }
        }

        // Fallback to finding an agent
        if (!agent) {
          agent = await getVoiceAgent(clinicId);
        }

        if (!agent) {
          // Record analytics for failed call
          await recordCallAnalytics({
            callId,
            clinicId,
            callType: isOutbound ? 'outbound' : 'inbound',
            purpose,
            duration: 0,
            outcome: 'error',
            aiAgentId: '',
            callerNumber,
            patientName,
          });

          return [{
            action: 'SPEAK',
            text: "I'm sorry, our AI assistant is not available right now. Please call back during office hours.",
          }, {
            action: 'HANG_UP',
          }];
        }

        // Create session
        const session = await getOrCreateSession(callId, clinicId, agent.agentId, callerNumber || 'unknown');

        // Get appropriate greeting
        const greeting = await getGreeting(
          clinicId,
          isOutbound || false,
          purpose,
          { patientName, clinicName, appointmentDate, customMessage }
        );

        // Play greeting
        responses.push({
          action: 'SPEAK',
          text: greeting,
          sessionId: session.sessionId,
        });

        // Continue listening
        responses.push({
          action: 'CONTINUE',
          sessionId: session.sessionId,
        });

        console.log('[NEW_CALL] Session created:', {
          sessionId: session.sessionId,
          callId,
          clinicId,
          isOutbound,
          purpose,
          agentId: agent.agentId,
        });

        break;
      }

      case 'TRANSCRIPT': {
        // Caller said something - this can come from:
        // 1. Direct invocation with sessionId (legacy)
        // 2. AI Transcript Bridge Lambda (via Media Insights Pipeline)
        const { callId, clinicId, transcript, sessionId, aiAgentId } = event;

        if (!transcript) {
          console.warn('[TRANSCRIPT] Empty transcript received, skipping');
          return [{ action: 'CONTINUE', sessionId }];
        }

        // Get session - try sessionId first, then lookup by callId
        let session: VoiceSession | undefined;

        if (sessionId) {
          const sessionResponse = await docClient.send(new GetCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId },
          }));
          session = sessionResponse.Item as VoiceSession | undefined;
        }

        // If no session found by sessionId, try to find by callId
        if (!session && callId) {
          const callIdQuery = await docClient.send(new QueryCommand({
            TableName: VOICE_SESSIONS_TABLE,
            IndexName: 'CallIdIndex',
            KeyConditionExpression: 'callId = :cid',
            ExpressionAttributeValues: { ':cid': callId },
            Limit: 1,
          }));
          session = callIdQuery.Items?.[0] as VoiceSession | undefined;
        }

        // If still no session, create one on-the-fly for real-time transcripts
        if (!session && callId && clinicId) {
          console.log('[TRANSCRIPT] No existing session found, creating new session for real-time transcript');

          // Try to get agent by aiAgentId or find default for clinic
          let agentId = aiAgentId;
          if (!agentId) {
            const voiceAgent = await getVoiceAgent(clinicId);
            agentId = voiceAgent?.agentId;
          }

          if (agentId) {
            session = await getOrCreateSession(callId, clinicId, agentId, 'real-time-transcript');
          }
        }

        if (!session) {
          return [{
            action: 'SPEAK',
            text: CONFIG.ERROR_MESSAGE,
          }, {
            action: 'HANG_UP',
          }];
        }

        // CRITICAL FIX: Use session.sessionId instead of the original sessionId variable
        // The original sessionId from event may be undefined if session was created on-the-fly
        const activeSessionId = session.sessionId;

        // Save caller transcript
        await updateSessionTranscript(activeSessionId, 'caller', transcript);

        // CONSISTENCY FIX: Get agent using session.agentId to ensure same agent throughout call
        // Previously re-queried for voice agent which could return different agent if config changed mid-call
        const agentResponse = await docClient.send(new GetCommand({
          TableName: AGENTS_TABLE,
          Key: { agentId: session.agentId },
        }));
        let agent = agentResponse.Item as AiAgent | undefined;

        // FIX: Graceful degradation if original agent is deleted/deactivated mid-call
        // Try to find another available agent for the clinic instead of hanging up
        if (!agent || !agent.isActive || agent.bedrockAgentStatus !== 'PREPARED') {
          console.warn(`[TRANSCRIPT] Original agent ${session.agentId} not found or not ready, attempting fallback`);

          // Try to find any other active voice agent for this clinic
          const fallbackAgent = await getVoiceAgent(session.clinicId);

          if (fallbackAgent) {
            console.log(`[TRANSCRIPT] Using fallback agent ${fallbackAgent.agentId} for call`);
            agent = fallbackAgent;

            // FIX: When switching agents, we need a NEW bedrockSessionId since
            // Bedrock agent sessions are bound to specific agent IDs.
            // Generate a new session ID but preserve conversation context via prompt.
            const newBedrockSessionId = uuidv4();

            await docClient.send(new UpdateCommand({
              TableName: VOICE_SESSIONS_TABLE,
              Key: { sessionId: activeSessionId },
              UpdateExpression: 'SET agentId = :newAgentId, bedrockSessionId = :newBedrockSessionId, agentFallbackUsed = :true, originalAgentId = :originalAgentId, previousBedrockSessionId = :prevSessionId',
              ExpressionAttributeValues: {
                ':newAgentId': agent.agentId,
                ':newBedrockSessionId': newBedrockSessionId,
                ':true': true,
                ':originalAgentId': session.agentId,
                ':prevSessionId': session.bedrockSessionId,
              },
            }));

            // Update session object for this invocation
            session.bedrockSessionId = newBedrockSessionId;
            session.agentId = agent.agentId;
          } else {
            // No fallback available - apologize and offer callback
            console.error(`[TRANSCRIPT] No fallback agent available for clinic ${session.clinicId}`);
            const apologyMessage = "I apologize, but I'm experiencing technical difficulties. " +
              "Please call back in a few minutes, or I can have someone from our office call you back. " +
              "Would you like us to call you back?";

            await updateSessionTranscript(activeSessionId, 'ai', apologyMessage);
            return [{
              action: 'SPEAK',
              text: apologyMessage,
              sessionId: activeSessionId,
            }, {
              action: 'CONTINUE', // Keep listening for response instead of hanging up immediately
              sessionId: activeSessionId,
            }];
          }
        }

        // FIX: Enhanced goodbye detection with context awareness
        // Check for goodbye phrases using word boundaries to avoid false positives
        // e.g., "Byron" shouldn't trigger goodbye, "thank you for helping, now..." shouldn't end call
        const lowerTranscript = transcript.toLowerCase().trim();
        const wordCount = lowerTranscript.split(/\s+/).length;

        // FIX: Relaxed word count limit from 6 to 8 to catch phrases like "thanks bye for now"
        const isShortUtterance = wordCount <= 8;

        // FIX: Improved patterns to avoid false positives
        const definitiveGoodbyePatterns = [
          /^(bye|goodbye|good\s*bye|bye\s*bye|bye\s*now)\.?$/i,  // Just "bye" variations alone
          /^(ok\s*)?(thanks?|thank\s*you)[\s,]*(bye|goodbye)?\.?$/i,  // "thanks bye" or just "thanks"
          /\bthat'?s\s+all\s+(i\s+need(ed)?|for\s+(now|today))\b/i,  // "that's all I needed"
          /\b(have\s+a\s+(good|great|nice)\s+(day|one|evening|night))\s*(bye)?\.?$/i,
          /\bi'?m\s+(all\s+)?done[\s,.]*(thanks?|thank\s*you)?\.?$/i,
          /\bnothing\s+(else|more)[\s,.]*(thanks?|bye)?\.?$/i,
        ];

        // FIX: Context-aware goodbye detection
        // Don't trigger goodbye if the phrase contains question indicators
        const hasQuestionIndicator = /\?|\bcan\s+you\b|\bwhat\b|\bhow\b|\bwhen\b|\bwhere\b|\bwhy\b|\bwill\b|\bcould\b|\bwould\b/i.test(lowerTranscript);

        // Don't trigger goodbye if it seems like the caller is still engaging
        const hasEngagementIndicator = /\bactually\b|\balso\b|\band\b.*\?|\bbut\b|\bone\s+more\b|\banother\b/i.test(lowerTranscript);

        const isGoodbye = isShortUtterance &&
          !hasQuestionIndicator &&
          !hasEngagementIndicator &&
          definitiveGoodbyePatterns.some(pattern => pattern.test(lowerTranscript));

        if (isGoodbye) {
          console.log('[TRANSCRIPT] Goodbye phrase detected:', { transcript: lowerTranscript });
          await updateSessionTranscript(activeSessionId, 'ai', CONFIG.GOODBYE_MESSAGE);
          return [{
            action: 'SPEAK',
            text: CONFIG.GOODBYE_MESSAGE,
            sessionId: activeSessionId,
          }, {
            action: 'HANG_UP',
          }];
        }

        // ========== STREAMING vs NON-STREAMING RESPONSE ==========
        // When streaming is enabled:
        //   - We return a brief filler immediately
        //   - AI response chunks are sent via UpdateSipMediaApplicationCall
        //   - This reduces perceived latency by starting TTS as AI generates
        // When streaming is disabled:
        //   - We wait for full AI response
        //   - Return filler + full response together

        if (STREAMING_ENABLED && callId && clinicId) {
          console.log('[TRANSCRIPT] Using streaming response mode');

          // Return a brief filler immediately - streaming chunks will follow
          const fillerPhrase = await getThinkingPhrase(clinicId);
          responses.push({
            action: 'SPEAK',
            text: fillerPhrase,
            sessionId: activeSessionId,
          });

          // FIX: Store pending response marker AND generate fallback response synchronously
          // This ensures that if streaming fails or Lambda terminates, there's a fallback
          const streamingStartTime = new Date().toISOString();
          await docClient.send(new UpdateCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId: activeSessionId },
            UpdateExpression: 'SET streamingInProgress = :streaming, lastTranscript = :transcript, streamingStartTime = :now',
            ExpressionAttributeValues: {
              ':streaming': true,
              ':transcript': transcript,
              ':now': streamingStartTime,
            },
          }));

          // FIX: Use Promise.race with timeout AND cancellation signal
          // When timeout fires, set cancellation flag to stop streaming immediately
          // This prevents: some chunks sent + fallback spoken + remaining streaming still sending

          try {
            // FIX: Create cancellation signal to stop streaming when timeout fires
            const cancellationSignal = { cancelled: false };

            const streamingPromise = invokeAiAgentWithStreaming(
              agent, session, transcript, callId, clinicId, cancellationSignal
            );

            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => {
                // FIX: Set cancellation flag BEFORE rejecting to stop streaming loop
                cancellationSignal.cancelled = true;
                console.log('[TRANSCRIPT] Streaming timeout - cancellation signal set');
                reject(new Error('Streaming timeout'));
              }, CONFIG.STREAMING_TIMEOUT_MS);
            });

            const { response: aiResponse, thinking, chunksSent } = await Promise.race([
              streamingPromise,
              timeoutPromise
            ]);

            console.log('[TRANSCRIPT] Streaming complete:', {
              chunksSent,
              responseLength: aiResponse.length
            });

            // Extract and save tools used
            const detectedTools = thinking
              .filter((t: string) => t.includes('Checking:'))
              .map((t: string) => t.replace('Checking: ', ''));

            await updateSessionTranscript(activeSessionId, 'ai', aiResponse, detectedTools);

            // Clear streaming flag after successful completion
            await docClient.send(new UpdateCommand({
              TableName: VOICE_SESSIONS_TABLE,
              Key: { sessionId: activeSessionId },
              UpdateExpression: 'SET streamingInProgress = :streaming, lastAiResponse = :response, streamingCompletedAt = :now',
              ExpressionAttributeValues: {
                ':streaming': false,
                ':response': aiResponse,
                ':now': new Date().toISOString(),
              },
            }));

            // If no chunks were sent via UpdateSipMediaApplicationCall, speak the response now
            if (chunksSent === 0 && aiResponse) {
              responses.push({
                action: 'SPEAK',
                text: sanitizeForVoice(aiResponse),
                sessionId: activeSessionId,
              });
            }

          } catch (err: any) {
            console.error('[TRANSCRIPT] Streaming error or timeout:', err.message);

            // Clear streaming flag and store error
            await docClient.send(new UpdateCommand({
              TableName: VOICE_SESSIONS_TABLE,
              Key: { sessionId: activeSessionId },
              UpdateExpression: 'SET streamingInProgress = :streaming, streamingError = :error',
              ExpressionAttributeValues: {
                ':streaming': false,
                ':error': err.message || 'Unknown streaming error',
              },
            }));

            // FIX: Fall back to non-streaming response on error
            console.log('[TRANSCRIPT] Falling back to non-streaming response');
            const { response: aiResponse, thinking } = await invokeAiAgent(agent, session, transcript);
            const detectedTools = thinking
              .filter((t: string) => t.includes('Checking:'))
              .map((t: string) => t.replace('Checking: ', ''));
            await updateSessionTranscript(activeSessionId, 'ai', aiResponse, detectedTools);

            responses.push({
              action: 'SPEAK',
              text: sanitizeForVoice(aiResponse),
              sessionId: activeSessionId,
            });
          }

          // Continue listening after response
          responses.push({
            action: 'CONTINUE',
            sessionId: activeSessionId,
          });

        } else {
          // Non-streaming mode: wait for full response
          console.log('[TRANSCRIPT] Using non-streaming response mode');

          // Play thinking phrase while AI processes (avoid silence)
          const fillerPhrase = await getThinkingPhrase(clinicId);
          responses.push({
            action: 'SPEAK',
            text: fillerPhrase,
            sessionId: activeSessionId,
          });

          // Invoke AI agent (waits for full response)
          const { response: aiResponse, thinking } = await invokeAiAgent(agent, session, transcript);

          // Extract tools used from thinking trace
          const detectedTools = thinking
            .filter((t: string) => t.includes('Checking:'))
            .map((t: string) => t.replace('Checking: ', ''));

          // ANALYTICS FIX: Save AI response WITH tools used to session record
          // This persists toolsUsed across Lambda invocations
          await updateSessionTranscript(activeSessionId, 'ai', aiResponse, detectedTools);

          // Speak AI response
          responses.push({
            action: 'SPEAK',
            text: sanitizeForVoice(aiResponse),
            sessionId: activeSessionId,
          });

          // Continue listening
          responses.push({
            action: 'CONTINUE',
            sessionId: activeSessionId,
          });
        }

        break;
      }

      case 'DTMF': {
        // Caller pressed a key
        const { sessionId, dtmfDigits } = event;

        // Handle DTMF input (e.g., "Press 0 to speak to a representative")
        if (dtmfDigits === '0') {
          return [{
            action: 'SPEAK',
            text: "I'll connect you to our voicemail. Please leave a message after the tone.",
            sessionId,
          }, {
            action: 'TRANSFER',
            transferNumber: 'VOICEMAIL',
          }];
        }

        responses.push({
          action: 'CONTINUE',
          sessionId,
        });
        break;
      }

      case 'CALL_ENDED': {
        // Call ended
        const { sessionId, callId, clinicId, isOutbound, purpose, patientName, callerNumber } = event;

        if (sessionId) {
          // Get session for duration calculation
          const sessionResponse = await docClient.send(new GetCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId },
          }));
          const session = sessionResponse.Item as VoiceSession | undefined;

          // Update session status
          await docClient.send(new UpdateCommand({
            TableName: VOICE_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET #status = :ended, lastActivityTime = :now',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':ended': 'ended',
              ':now': new Date().toISOString(),
            },
          }));

          // Record analytics
          if (session) {
            const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
            const transcriptSummary = session.transcripts
              ?.slice(-5)
              .map((t: { speaker: string; text: string }) => `${t.speaker}: ${t.text}`)
              .join(' | ');

            // Check if an appointment was booked (look for scheduling keywords in AI responses)
            const aiResponses = session.transcripts
              ?.filter((t: { speaker: string }) => t.speaker === 'ai')
              .map((t: { text: string }) => t.text.toLowerCase())
              .join(' ') || '';
            const appointmentBooked =
              aiResponses.includes('scheduled') ||
              aiResponses.includes('booked') ||
              aiResponses.includes('appointment confirmed');

            // ANALYTICS FIX: Use session.toolsUsed which persists across Lambda invocations
            // instead of the local toolsUsed variable which gets reset each invocation
            const persistedToolsUsed = session.toolsUsed || [];

            await recordCallAnalytics({
              callId: session.callId,
              clinicId: session.clinicId,
              callType: isOutbound ? 'outbound' : 'inbound',
              purpose,
              duration,
              outcome: 'completed',
              aiAgentId: session.agentId,
              callerNumber: session.callerNumber,
              patientName,
              transcriptSummary,
              toolsUsed: [...new Set(persistedToolsUsed)], // Deduplicate
              appointmentBooked,
            });
          }
        }

        break;
      }

      default:
        console.warn('Unknown event type:', event.eventType);
    }

    return responses;
  } catch (error: any) {
    console.error('Voice AI error:', error);

    // Try to record error analytics
    try {
      await recordCallAnalytics({
        callId: event.callId,
        clinicId: event.clinicId,
        callType: event.isOutbound ? 'outbound' : 'inbound',
        purpose: event.purpose,
        duration: Math.floor((Date.now() - callStartTime) / 1000),
        outcome: 'error',
        aiAgentId: '',
        callerNumber: event.callerNumber,
        patientName: event.patientName,
      });
    } catch {
      // Ignore analytics errors
    }

    return [{
      action: 'SPEAK',
      text: CONFIG.ERROR_MESSAGE,
    }, {
      action: 'HANG_UP',
    }];
  }
};

// ========================================================================
// EXPORTS FOR CHIME INTEGRATION
// ========================================================================

export {
  textToSpeech,
  isClinicOpen,
  getVoiceAgent,
  getGreeting,
  getVoiceSettings,
  recordCallAnalytics,
};


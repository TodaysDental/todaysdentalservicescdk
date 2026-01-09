/**
 * AI Transcript Bridge Lambda
 * 
 * Consumes real-time transcripts from Kinesis Data Stream (via Media Insights Pipeline)
 * and invokes the Voice AI handler to generate AI responses.
 * 
 * This Lambda bridges Amazon Chime SDK Voice Analytics transcription with
 * the Bedrock AI Agent for real-time voice conversations.
 * 
 * Flow:
 * 1. Media Insights Pipeline → Amazon Transcribe → Kinesis Data Stream
 * 2. This Lambda (triggered by Kinesis) → Voice AI Handler
 * 3. Voice AI Handler → Bedrock Agent → Response
 * 4. Response is stored in DynamoDB and sent via UpdateSipMediaApplicationCall
 * 
 * CRITICAL FIX: Uses chime-sdk-voice client and SSM for SMA ID lookup
 */

import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
// CRITICAL FIX: Use ChimeSDKVoiceClient, not ChimeClient
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
// Use shared SMA map utility to avoid code duplication
import { getSmaIdForClinicSSM } from './utils/sma-map-ssm';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';

// CRITICAL FIX: Use ChimeSDKVoiceClient with configurable region
const chimeClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

// Environment variables
const VOICE_AI_LAMBDA_ARN = process.env.VOICE_AI_LAMBDA_ARN!;
const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME!;
const VOICE_SESSIONS_TABLE = process.env.VOICE_SESSIONS_TABLE!;
const VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE || '';

// Minimum transcript length to process (avoid processing partial words)
const MIN_TRANSCRIPT_LENGTH = 3;

// ========================================================================
// VOICE SETTINGS
// ========================================================================

/**
 * Voice settings for clinic-specific TTS configuration
 */
interface VoiceSettings {
  voiceId: string;
  engine: 'neural' | 'standard';
}

// Default voice settings (used when clinic config not found)
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voiceId: 'Joanna',
  engine: 'neural',
};

// Cache voice settings to reduce DynamoDB reads
const voiceSettingsCache: Map<string, { settings: VoiceSettings; expiresAt: number }> = new Map();
const VOICE_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get voice settings for a clinic (with caching)
 * Falls back to defaults if not configured
 */
async function getVoiceSettingsForClinic(clinicId: string): Promise<VoiceSettings> {
  if (!clinicId || !VOICE_CONFIG_TABLE) {
    return DEFAULT_VOICE_SETTINGS;
  }

  // Check cache first
  const cached = voiceSettingsCache.get(clinicId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  try {
    const response = await ddb.send(new GetCommand({
      TableName: VOICE_CONFIG_TABLE,
      Key: { clinicId },
      ProjectionExpression: 'voiceSettings',
    }));

    const config = response.Item;
    const settings: VoiceSettings = {
      voiceId: config?.voiceSettings?.voiceId || DEFAULT_VOICE_SETTINGS.voiceId,
      engine: config?.voiceSettings?.engine || DEFAULT_VOICE_SETTINGS.engine,
    };

    // Cache the result
    voiceSettingsCache.set(clinicId, {
      settings,
      expiresAt: Date.now() + VOICE_SETTINGS_CACHE_TTL_MS,
    });

    return settings;
  } catch (error) {
    console.warn('[AITranscriptBridge] Failed to get voice settings for clinic:', clinicId, error);
    return DEFAULT_VOICE_SETTINGS;
  }
}

// Cache call records to reduce DynamoDB queries for high-frequency transcript streams
const CALL_RECORD_CACHE_TTL_MS = 15_000;
const callRecordCache: Map<string, { record: any | null; expiresAt: number }> = new Map();

// FIX: Add max cache sizes to prevent memory leaks
const MAX_CALL_RECORD_CACHE_SIZE = 500;
const MAX_PENDING_UTTERANCES_SIZE = 200;

// Debounce time in ms to wait for complete utterances
const UTTERANCE_COMPLETE_TIMEOUT_MS = 1500;

// FIX: Max age for pending utterances before forced cleanup (5 minutes)
const PENDING_UTTERANCE_MAX_AGE_MS = 5 * 60 * 1000;

// Track pending utterances per call (for debouncing)
const pendingUtterances: Map<string, {
  text: string;
  lastUpdate: number;
  timeoutId?: NodeJS.Timeout;
  createdAt: number; // FIX: Track creation time for staleness detection
}> = new Map();

/**
 * FIX: Cleanup stale pending utterances and caches to prevent memory leaks
 * Called periodically during processing
 */
function cleanupStaleEntries(): void {
  const now = Date.now();
  
  // Cleanup stale pending utterances
  for (const [callId, entry] of pendingUtterances.entries()) {
    if (now - entry.createdAt > PENDING_UTTERANCE_MAX_AGE_MS) {
      console.warn(`[AITranscriptBridge] Cleaning up stale pending utterance for callId ${callId} (age: ${Math.floor((now - entry.createdAt) / 1000)}s)`);
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      pendingUtterances.delete(callId);
    }
  }
  
  // Cleanup expired call record cache entries
  for (const [callId, entry] of callRecordCache.entries()) {
    if (now > entry.expiresAt) {
      callRecordCache.delete(callId);
    }
  }
  
  // FIX: Enforce max cache sizes with LRU-like eviction
  if (callRecordCache.size > MAX_CALL_RECORD_CACHE_SIZE) {
    const entriesToRemove = callRecordCache.size - MAX_CALL_RECORD_CACHE_SIZE + 50;
    const entries = Array.from(callRecordCache.entries())
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      .slice(0, entriesToRemove);
    for (const [key] of entries) {
      callRecordCache.delete(key);
    }
    console.log(`[AITranscriptBridge] Evicted ${entries.length} call record cache entries`);
  }
  
  if (pendingUtterances.size > MAX_PENDING_UTTERANCES_SIZE) {
    const entriesToRemove = pendingUtterances.size - MAX_PENDING_UTTERANCES_SIZE + 20;
    const entries = Array.from(pendingUtterances.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, entriesToRemove);
    for (const [key, entry] of entries) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      pendingUtterances.delete(key);
    }
    console.log(`[AITranscriptBridge] Evicted ${entries.length} stale pending utterances`);
  }
}

/**
 * FIX: Clean up pending utterance for a specific call (call on call end)
 */
function cleanupCallUtterance(callId: string): void {
  const entry = pendingUtterances.get(callId);
  if (entry) {
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    pendingUtterances.delete(callId);
    console.log(`[AITranscriptBridge] Cleaned up pending utterance for ended call ${callId}`);
  }
  
  // Also clean up call record cache
  callRecordCache.delete(callId);
}

/**
 * Transcript event from Amazon Transcribe via Media Insights Pipeline
 */
interface TranscriptEvent {
  // Event metadata
  EventType: 'TranscriptEvent' | 'TranscribeCallAnalyticsEvent';
  
  // Transcript data
  Transcript?: {
    Results?: Array<{
      ResultId: string;
      StartTime: number;
      EndTime: number;
      IsPartial: boolean;
      Alternatives?: Array<{
        Transcript: string;
        Items?: Array<{
          Content: string;
          Type: 'pronunciation' | 'punctuation';
          StartTime: number;
          EndTime: number;
          Confidence: number;
        }>;
      }>;
      ChannelId?: string; // 'ch_0' = agent/AI, 'ch_1' = customer/caller
    }>;
  };
  
  // Call Analytics data (if using Call Analytics)
  CallAnalyticsTranscriptResultStream?: {
    UtteranceEvent?: {
      UtteranceId: string;
      IsPartial: boolean;
      ParticipantRole: 'AGENT' | 'CUSTOMER';
      BeginOffsetMillis: number;
      EndOffsetMillis: number;
      Transcript: string;
      Sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
      Items?: Array<any>;
    };
  };
  
  // Runtime metadata (passed when creating pipeline)
  MediaInsightsRuntimeMetadata?: {
    callId?: string;
    clinicId?: string;
    sessionId?: string;
    aiAgentId?: string;
    transactionId?: string;
    isAiCall?: string;
    aiSessionId?: string;
  };
}

/**
 * Voice AI Response
 */
interface VoiceAiResponse {
  action: 'SPEAK' | 'HANG_UP' | 'TRANSFER' | 'CONTINUE';
  text?: string;
  sessionId?: string;
}

// SMA ID lookup is handled by shared utility: getSmaIdForClinicSSM from './utils/sma-map-ssm'

/**
 * Main handler for Kinesis stream events
 */
export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  console.log('[AITranscriptBridge] Processing batch', {
    recordCount: event.Records.length,
    timestamp: new Date().toISOString()
  });

  // FIX: Periodically cleanup stale entries to prevent memory leaks
  cleanupStaleEntries();

  const results = {
    processed: 0,
    skipped: 0,
    errors: 0
  };

  for (const record of event.Records) {
    try {
      const processed = await processKinesisRecord(record);
      if (processed) {
        results.processed++;
      } else {
        results.skipped++;
      }
    } catch (error: any) {
      console.error('[AITranscriptBridge] Error processing record:', {
        error: error.message,
        sequenceNumber: record.kinesis.sequenceNumber
      });
      results.errors++;
    }
  }

  console.log('[AITranscriptBridge] Batch complete', results);
};

/**
 * Process a single Kinesis record containing transcript data
 */
async function processKinesisRecord(record: KinesisStreamRecord): Promise<boolean> {
  // Decode base64 payload
  const payload = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
  
  let transcriptEvent: TranscriptEvent;
  try {
    transcriptEvent = JSON.parse(payload);
  } catch (e) {
    console.warn('[AITranscriptBridge] Failed to parse transcript event:', payload.substring(0, 200));
    return false;
  }

  // Check if this is an AI call based on metadata
  const metadata = transcriptEvent.MediaInsightsRuntimeMetadata;

  // Identify the SMA TransactionId (what UpdateSipMediaApplicationCall needs).
  // Prefer metadata, but tolerate other event shapes (Voice Connector streaming differs).
  const callId =
    (metadata as any)?.transactionId ||
    (metadata as any)?.TransactionId ||
    (metadata as any)?.callId ||
    (metadata as any)?.CallId ||
    (transcriptEvent as any)?.TransactionId ||
    (transcriptEvent as any)?.transactionId ||
    (transcriptEvent as any)?.CallId ||
    (transcriptEvent as any)?.callId;

  if (!callId || typeof callId !== 'string') {
    console.warn('[AITranscriptBridge] No callId/transactionId found in transcript event');
    return false;
  }

  // Load the call record and verify this is actually an AI call.
  // This avoids relying on MediaInsightsRuntimeMetadata.isAiCall (not always present).
  const callRecord = await getCallRecord(callId);
  if (!callRecord) {
    console.warn('[AITranscriptBridge] Call record not found for transcript event (skipping):', callId);
    return false;
  }
  if (!callRecord.isAiCall) {
    // Not an AI call - skip processing
    return false;
  }

  // Extract transcript text and metadata
  const { transcript, isPartial, channelId } = extractTranscript(transcriptEvent);
  
  if (!transcript || transcript.length < MIN_TRANSCRIPT_LENGTH) {
    return false; // Skip empty or very short transcripts
  }

  // Only process customer/caller speech (not agent/AI).
  // NOTE: Voice Connector streams are often single-channel and Transcribe may label the only channel as "ch_0".
  // Since this Lambda only processes AI calls (callRecord.isAiCall), we do NOT treat "ch_0" as agent by default.
  const kvsRole = (metadata as any)?.kvsParticipantRole;
  if (channelId === 'AGENT' || kvsRole === 'AGENT') {
    console.log('[AITranscriptBridge] Skipping agent/AI transcript', { channelId, kvsRole });
    return false;
  }

  // Get call context (prefer DynamoDB since metadata may be incomplete)
  const clinicId = (metadata as any)?.clinicId || callRecord.clinicId;
  const sessionId = (metadata as any)?.aiSessionId || (metadata as any)?.sessionId || callRecord.aiSessionId;

  console.log('[AITranscriptBridge] Transcript received:', {
    callId,
    clinicId,
    isPartial,
    transcriptLength: transcript.length,
    transcript: transcript.substring(0, 100)
  });

  // If partial transcript, accumulate and wait for completion
  if (isPartial) {
    accumulateUtterance(callId, clinicId || '', sessionId || '', transcript);
    return true;
  }

  // Complete utterance - process it
  return await processCompleteUtterance(callId, clinicId || '', sessionId || '', transcript, callRecord);
}

/**
 * Extract transcript text from various event formats
 */
function extractTranscript(event: TranscriptEvent): {
  transcript: string;
  isPartial: boolean;
  channelId: string;
} {
  // Handle Call Analytics format (preferred)
  if (event.CallAnalyticsTranscriptResultStream?.UtteranceEvent) {
    const utterance = event.CallAnalyticsTranscriptResultStream.UtteranceEvent;
    return {
      transcript: utterance.Transcript || '',
      isPartial: utterance.IsPartial,
      channelId: utterance.ParticipantRole,
    };
  }

  // Handle standard Transcribe format
  if (event.Transcript?.Results?.[0]) {
    const result = event.Transcript.Results[0];
    const transcript = result.Alternatives?.[0]?.Transcript || '';
    return {
      transcript,
      isPartial: result.IsPartial,
      channelId: result.ChannelId || 'ch_1', // Default to customer
    };
  }

  return { transcript: '', isPartial: true, channelId: '' };
}

/**
 * Accumulate partial utterances and debounce
 * 
 * FIX: Now tracks createdAt for staleness detection and cleanup
 */
function accumulateUtterance(callId: string, clinicId: string, sessionId: string, transcript: string): void {
  const existing = pendingUtterances.get(callId);
  const now = Date.now();
  
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  // Store/update the accumulated transcript
  // FIX: Preserve original createdAt or set new one
  pendingUtterances.set(callId, {
    text: transcript, // Partials typically include full text so far
    lastUpdate: now,
    createdAt: existing?.createdAt ?? now, // FIX: Preserve original creation time
    timeoutId: setTimeout(async () => {
      const pending = pendingUtterances.get(callId);
      if (pending && pending.text) {
        console.log('[AITranscriptBridge] Utterance timeout - processing accumulated:', {
          callId,
          transcriptLength: pending.text.length,
          ageMs: Date.now() - pending.createdAt
        });
        
        // Process the accumulated transcript
        try {
          await processCompleteUtterance(callId, clinicId, sessionId, pending.text);
        } catch (error) {
          console.error('[AITranscriptBridge] Error processing timeout utterance:', error);
        }
        
        pendingUtterances.delete(callId);
      }
    }, UTTERANCE_COMPLETE_TIMEOUT_MS)
  });
}

/**
 * Process a complete utterance - invoke Voice AI and update call
 */
async function processCompleteUtterance(
  callId: string,
  clinicId: string,
  sessionId: string,
  transcript: string,
  callRecordOverride?: any
): Promise<boolean> {
  // Clear any pending accumulation
  const pending = pendingUtterances.get(callId);
  if (pending?.timeoutId) {
    clearTimeout(pending.timeoutId);
    pendingUtterances.delete(callId);
  }

  // Get call record for full context
  const callRecord = callRecordOverride || await getCallRecord(callId);
  if (!callRecord) {
    console.warn('[AITranscriptBridge] Call record not found:', callId);
    return false;
  }
  
  if (!callRecord.isAiCall) {
    console.log('[AITranscriptBridge] Not an AI call, skipping:', callId);
    return false;
  }

  const finalClinicId = clinicId || callRecord.clinicId;
  const finalSessionId = sessionId || callRecord.aiSessionId;
  const aiAgentId = callRecord.aiAgentId;
  const transactionId = callRecord.transactionId || callId;

  console.log('[AITranscriptBridge] Processing complete utterance:', {
    callId,
    clinicId: finalClinicId,
    sessionId: finalSessionId,
    transcript: transcript.substring(0, 50) + '...'
  });

  // Invoke Voice AI handler with TRANSCRIPT event
  const voiceAiResponse = await invokeVoiceAiHandler({
    eventType: 'TRANSCRIPT',
    callId,
    clinicId: finalClinicId,
    transcript,
    sessionId: finalSessionId,
    aiAgentId
  });

  if (!voiceAiResponse || voiceAiResponse.length === 0) {
    console.warn('[AITranscriptBridge] No response from Voice AI handler');
    return false;
  }

  // Send AI response back to caller via SMA
  await sendResponseToCall(callRecord, transactionId, voiceAiResponse);

  return true;
}

/**
 * Get call record from DynamoDB
 */
async function getCallRecord(callId: string): Promise<any | null> {
  const cached = callRecordCache.get(callId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.record;
  }

  try {
    const result = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1
    }));

    const record = result.Items?.[0] || null;
    callRecordCache.set(callId, { record, expiresAt: now + CALL_RECORD_CACHE_TTL_MS });
    return record;
  } catch (error) {
    console.error('[AITranscriptBridge] Error getting call record:', error);
    return null;
  }
}

/**
 * Invoke the Voice AI handler Lambda
 */
async function invokeVoiceAiHandler(event: {
  eventType: 'TRANSCRIPT' | 'DTMF' | 'CALL_ENDED';
  callId: string;
  clinicId: string;
  transcript?: string;
  dtmfDigits?: string;
  sessionId?: string;
  aiAgentId?: string;
}): Promise<VoiceAiResponse[]> {
  if (!VOICE_AI_LAMBDA_ARN) {
    console.error('[AITranscriptBridge] VOICE_AI_LAMBDA_ARN not configured');
    return [];
  }

  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: VOICE_AI_LAMBDA_ARN,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(event))
    }));

    if (response.Payload) {
      const result = JSON.parse(Buffer.from(response.Payload).toString());
      console.log('[AITranscriptBridge] Voice AI response:', result);
      return Array.isArray(result) ? result : [result];
    }

    return [];
  } catch (error) {
    console.error('[AITranscriptBridge] Error invoking Voice AI:', error);
    return [];
  }
}

/**
 * Send AI response back to the call via SMA UpdateSipMediaApplicationCall
 * 
 * CRITICAL FIX: Uses proper SDK and dynamic SMA ID lookup
 * FIX: Now uses clinic-specific voice settings instead of hardcoded values
 */
async function sendResponseToCall(
  callRecord: any,
  transactionId: string,
  responses: VoiceAiResponse[]
): Promise<void> {
  const clinicId = callRecord?.clinicId;

  // Always store a DynamoDB backup BEFORE attempting UpdateSipMediaApplicationCall.
  // This prevents duplicates/races and ensures ACTION_SUCCESSFUL can still deliver the response if the update path fails.
  await storePendingResponseForCallRecord(callRecord, responses);

  // Use shared SMA map utility (no duplication)
  const smaId = await getSmaIdForClinicSSM(clinicId);
  
  if (!smaId) {
    console.error('[AITranscriptBridge] No SMA ID found for clinic:', clinicId);
    return;
  }

  // FIX: Get clinic-specific voice settings instead of using hardcoded values
  const voiceSettings = await getVoiceSettingsForClinic(clinicId);

  // Build SMA actions from Voice AI responses
  const actions: any[] = [];

  for (const response of responses) {
    switch (response.action) {
      case 'SPEAK':
        if (response.text) {
          actions.push({
            Type: 'Speak',
            Parameters: {
              Text: response.text,
              Engine: voiceSettings.engine,
              LanguageCode: 'en-US',
              TextType: 'text',
              VoiceId: voiceSettings.voiceId,
            }
          });
        }
        break;
      
      case 'HANG_UP':
        actions.push({
          Type: 'Hangup',
          Parameters: {
            SipResponseCode: '0'
          }
        });
        break;
      
      case 'TRANSFER':
        actions.push({
          Type: 'Speak',
          Parameters: {
            Text: 'I will transfer you to an available agent.',
            Engine: voiceSettings.engine,
            LanguageCode: 'en-US',
            TextType: 'text',
            VoiceId: voiceSettings.voiceId,
          }
        });
        break;
      
      case 'CONTINUE':
        // Add a pause and continue listening
        actions.push({
          Type: 'Pause',
          Parameters: {
            DurationInMilliseconds: '500'
          }
        });
        break;
    }
  }

  if (actions.length === 0) {
    console.log('[AITranscriptBridge] No actions to send for call:', transactionId);
    return;
  }

  try {
    console.log('[AITranscriptBridge] Sending actions to call:', {
      transactionId,
      smaId,
      actionCount: actions.length,
      firstAction: actions[0].Type
    });

    // CRITICAL FIX: UpdateSipMediaApplicationCall passes arguments to SMA Lambda
    // The SMA Lambda must handle the 'actions' argument and return the actions
    await chimeClient.send(new UpdateSipMediaApplicationCallCommand({
      SipMediaApplicationId: smaId,
      TransactionId: transactionId,
      Arguments: {
        // These arguments are passed to the SMA Lambda on next invocation
        pendingAiActions: JSON.stringify(actions),
        aiResponseTime: new Date().toISOString(),
      }
    }));

    console.log('[AITranscriptBridge] Successfully sent update to SMA');
  } catch (error: any) {
    console.error('[AITranscriptBridge] Error sending response to call:', {
      transactionId,
      smaId,
      error: error.message,
      code: error.code,
    });
  }
}

/**
 * Store pending AI response in DynamoDB for SMA handler to retrieve
 * This is a fallback mechanism when UpdateSipMediaApplicationCall fails
 */
async function storePendingResponseForCallRecord(callRecord: any, responses: VoiceAiResponse[]): Promise<void> {
  try {
    if (!callRecord?.clinicId || callRecord?.queuePosition === undefined) {
      console.warn('[AITranscriptBridge] Cannot store pending response - call record missing keys');
      return;
    }

    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE,
      Key: { 
        clinicId: callRecord.clinicId, 
        queuePosition: callRecord.queuePosition 
      },
      UpdateExpression: 'SET pendingAiResponse = :response, pendingAiResponseTime = :time',
      ExpressionAttributeValues: {
        ':response': JSON.stringify(responses),
        ':time': new Date().toISOString(),
      },
    }));

    console.log('[AITranscriptBridge] Stored pending AI response in DynamoDB:', callRecord.callId || callRecord.transactionId);
  } catch (error) {
    console.error('[AITranscriptBridge] Failed to store pending response:', error);
  }
}

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
// AGENT LOOKUP (with caching for performance)
// ========================================================================

interface AgentInfo {
  agentId: string;
  aliasId: string;
  agentName?: string;
}

// PERFORMANCE: Cache agent lookups to avoid repeated DynamoDB queries
// Agents rarely change, so a 5-minute cache significantly reduces latency
const agentCache = new Map<string, { agent: AgentInfo | null; timestamp: number }>();
const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getAgentForClinic(clinicId: string): Promise<AgentInfo | null> {
  // Check cache first
  const cached = agentCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }

  try {
    // PERFORMANCE: Single query with broader filter, then prioritize in-memory
    // This reduces 2-3 DynamoDB calls to just 1
    const allAgents = await docClient.send(new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
      },
      Limit: 20,
      ScanIndexForward: false, // Most recent first
    }));

    if (!allAgents.Items || allAgents.Items.length === 0) {
      agentCache.set(clinicId, { agent: null, timestamp: Date.now() });
      return null;
    }

    // Prioritize: 1) default voice agent, 2) any voice-enabled, 3) any agent
    let selectedAgent: any = null;

    // Look for default voice agent first
    const defaultVoice = allAgents.Items.find(
      (a: any) => a.isDefaultVoiceAgent === true && a.isVoiceEnabled === true
    );
    if (defaultVoice) {
      selectedAgent = defaultVoice;
      console.log('[LexBedrockHook] Selected default voice agent:', {
        clinicId,
        agentId: selectedAgent.agentId,
        agentName: selectedAgent.agentName || selectedAgent.name,
      });
    }

    // Fall back to any voice-enabled agent
    if (!selectedAgent) {
      const voiceEnabled = allAgents.Items.find((a: any) => a.isVoiceEnabled === true);
      if (voiceEnabled) {
        selectedAgent = voiceEnabled;
        console.log('[LexBedrockHook] Selected voice-enabled agent:', {
          clinicId,
          agentId: selectedAgent.agentId,
          agentName: selectedAgent.agentName || selectedAgent.name,
        });
      }
    }

    // Final fallback: any agent
    if (!selectedAgent) {
      selectedAgent = allAgents.Items[0];
      console.log('[LexBedrockHook] Using fallback agent (any type):', selectedAgent.agentId || selectedAgent.agentName);
    }

    const agentInfo: AgentInfo = {
      agentId: selectedAgent.bedrockAgentId,
      aliasId: selectedAgent.bedrockAliasId || 'TSTALIASID',
      agentName: selectedAgent.agentName || selectedAgent.name,
    };

    // Cache the result
    agentCache.set(clinicId, { agent: agentInfo, timestamp: Date.now() });
    return agentInfo;
  } catch (error) {
    console.error('[LexBedrockHook] Error looking up agent:', error);
    return null;
  }
}

// ========================================================================
// ANALYTICS - Unified with AnalyticsStack
// ========================================================================

interface ConnectCallAnalytics {
  callId: string;             // PK: connect-${contactId}
  timestamp: number;          // SK: call start time in ms
  clinicId: string;
  callCategory: 'ai_voice';
  callType: 'inbound';
  callStatus: 'active' | 'completed' | 'error';
  outcome?: 'answered' | 'completed' | 'error';
  callerNumber?: string;
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
  callerNumber?: string;
  aiAgentId: string;
  aiAgentName?: string;
}): Promise<{ callId: string; timestamp: number }> {
  if (!CALL_ANALYTICS_TABLE) {
    console.warn('[LexBedrockHook] CALL_ANALYTICS_TABLE not configured, skipping analytics');
    return { callId: params.callId, timestamp: Date.now() };
  }

  const { callId, contactId, clinicId, callerNumber, aiAgentId, aiAgentName } = params;
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (CONFIG.ANALYTICS_TTL_DAYS * 24 * 60 * 60);

  // Check if record already exists
  try {
    const existing = await docClient.send(new QueryCommand({
      TableName: CALL_ANALYTICS_TABLE,
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1,
    }));

    if (existing.Items && existing.Items.length > 0) {
      // Record exists, return its timestamp
      return { callId, timestamp: existing.Items[0].timestamp };
    }
  } catch (error) {
    console.warn('[LexBedrockHook] Error checking existing analytics:', error);
  }

  // Create new record
  const analytics: ConnectCallAnalytics = {
    callId,
    timestamp: now,
    clinicId,
    callCategory: 'ai_voice',
    callType: 'inbound',
    callStatus: 'active',
    outcome: 'answered',
    callerNumber,
    aiAgentId,
    agentId: aiAgentId, // Alias for existing dashboards
    aiAgentName,
    analyticsSource: 'connect_lex',
    contactId,
    turnCount: 0,
    transcriptCount: 0,
    lastActivityTime: new Date(now).toISOString(),
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
      // Record was created by another invocation, get the timestamp
      const result = await docClient.send(new QueryCommand({
        TableName: CALL_ANALYTICS_TABLE,
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId },
        Limit: 1,
      }));
      if (result.Items && result.Items.length > 0) {
        return { callId, timestamp: result.Items[0].timestamp };
      }
    }
    console.error('[LexBedrockHook] Error creating analytics record:', error);
  }

  return { callId, timestamp: now };
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
  aiAgentId: string;
  aiAgentName?: string;
  bedrockSessionId: string; // Session ID for Bedrock Agent
  callStartMs: number;
  turnCount: number;
  createdAt: string;
  lastActivity: string;
  callerNumber?: string;
  ttl: number;
}

async function getOrCreateSession(
  lexSessionId: string,
  clinicId: string,
  callerNumber?: string
): Promise<ConnectLexSession> {
  const sessionKey = `lex-${lexSessionId}`;

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

  // Look up agent for clinic
  const agent = await getAgentForClinic(clinicId);
  if (!agent) {
    throw new Error(`No Bedrock agent configured for clinic: ${clinicId}`);
  }

  // Create new session
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (60 * 60); // 1 hour TTL

  const session: ConnectLexSession = {
    sessionId: sessionKey,
    callId: `connect-${lexSessionId}`,
    clinicId,
    aiAgentId: agent.agentId,
    aiAgentName: agent.agentName,
    bedrockSessionId: uuidv4(),
    callStartMs: now,
    turnCount: 1,
    createdAt: new Date(now).toISOString(),
    lastActivity: new Date(now).toISOString(),
    callerNumber,
    ttl,
  };

  try {
    await docClient.send(new PutCommand({
      TableName: SESSIONS_TABLE,
      Item: session,
    }));
    console.log('[LexBedrockHook] Created new session:', { sessionId: sessionKey, clinicId, agentId: agent.agentId });
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
    const command = new InvokeAgentCommand({
      agentId,
      agentAliasId: aliasId,
      sessionId,
      inputText,
      sessionState: {
        sessionAttributes: {
          clinicId,
          // Pass input mode so agent knows to use voice-optimized responses
          inputMode: inputMode || 'Text',
          channel: channel || (inputMode === 'Speech' ? 'voice' : 'chat'),
        },
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

  // Get or create session
  let session: ConnectLexSession;
  try {
    session = await getOrCreateSession(contactId, clinicId, callerNumber);
  } catch (error) {
    console.error('[LexBedrockHook] Connect direct: Session creation failed:', error);
    return {
      aiResponse: "I'm sorry, I'm having trouble setting up our conversation. Please try again.",
    };
  }

  // Ensure analytics record exists
  await ensureAnalyticsRecord({
    callId: session.callId,
    contactId,
    clinicId: session.clinicId,
    callerNumber: session.callerNumber,
    aiAgentId: session.aiAgentId,
    aiAgentName: session.aiAgentName,
  });

  // Get agent info
  const agent = await getAgentForClinic(clinicId);
  if (!agent) {
    console.error('[LexBedrockHook] Connect direct: No agent found for clinic:', clinicId);
    return {
      aiResponse: "I'm sorry, the AI assistant is not available right now. Please call back during office hours.",
    };
  }

  // Handle empty/timeout input from Connect
  const trimmedInput = inputTranscript.trim();
  const normalizedInput = trimmedInput.toLowerCase();
  const isTimeoutInput = normalizedInput === 'timeout' ||
    normalizedInput === 'noinput' ||
    normalizedInput === 'no input' ||
    normalizedInput === 'inputtimelimitexceeded';
  if (!trimmedInput || isTimeoutInput) {
    return {
      aiResponse: "I'm sorry, I didn't catch that. Could you please repeat what you said?",
    };
  }

  // If Lex ASR is low-confidence, ask for a repeat instead of risking a wrong Bedrock response.
  if (safeConfidence < TRANSCRIPTION_CONFIDENCE_THRESHOLD) {
    console.warn('[LexBedrockHook] Connect direct: Low transcription confidence; prompting caller to repeat', {
      transcriptionConfidence: safeConfidence,
      threshold: TRANSCRIPTION_CONFIDENCE_THRESHOLD,
      inputTranscript,
    });
    return {
      aiResponse: "I'm sorry, I didn't catch that clearly. Could you please repeat what you said?",
    };
  }

  // Invoke Bedrock
  const { response: aiResponse, toolsUsed } = await invokeBedrock({
    agentId: agent.agentId,
    aliasId: agent.aliasId,
    sessionId: session.bedrockSessionId,
    inputText: trimmedInput,
    clinicId,
    inputMode: 'Speech',
    channel: 'voice',
    timeoutMs: CONNECT_BEDROCK_TIMEOUT_MS,
  });

  // FIX: Make analytics and transcript updates fire-and-forget to reduce response time
  // These are non-critical for the voice response and shouldn't block the caller
  // The Lambda will continue running after we return the response
  updateAnalyticsTurn({
    callId: session.callId,
    timestamp: session.callStartMs,
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
    aiResponse,
    ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
    clinicId,
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

  // Get or create session
  let session: ConnectLexSession;
  try {
    session = await getOrCreateSession(lexSessionId, clinicId, callerNumber);
  } catch (error) {
    console.error('[LexBedrockHook] Session creation failed:', error);
    return buildErrorResponse(event, "I'm sorry, I'm having trouble setting up our conversation. Please try again.");
  }

  // Ensure analytics record exists
  const analyticsInfo = await ensureAnalyticsRecord({
    callId: session.callId,
    contactId: lexSessionId,
    clinicId: session.clinicId,
    callerNumber: session.callerNumber,
    aiAgentId: session.aiAgentId,
    aiAgentName: session.aiAgentName,
  });

  // Get the agent info
  const agent = await getAgentForClinic(clinicId);
  if (!agent) {
    console.error('[LexBedrockHook] No agent found for clinic:', clinicId, {
      dialedNumber,
      defaultClinicId: DEFAULT_CLINIC_ID,
      hasPhoneMap: Object.keys(aiPhoneNumberMap || {}).length > 0,
    });
    return buildErrorResponse(event, "I'm sorry, the AI assistant is not available right now. Please call back during office hours.");
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
  const { response: aiResponse, toolsUsed } = await invokeBedrock({
    agentId: agent.agentId,
    aliasId: agent.aliasId,
    sessionId: session.bedrockSessionId,
    inputText: trimmedInput,
    clinicId,
    inputMode: event.inputMode, // 'Speech' for voice calls, 'Text' for chat
    channel: event.inputMode === 'Speech' ? 'voice' : 'chat',
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

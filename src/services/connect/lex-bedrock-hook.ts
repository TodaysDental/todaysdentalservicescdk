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
// AGENT LOOKUP
// ========================================================================

interface AgentInfo {
  agentId: string;
  aliasId: string;
  agentName?: string;
}

async function getAgentForClinic(clinicId: string): Promise<AgentInfo | null> {
  try {
    // Query for voice-type agent for this clinic
    const result = await docClient.send(new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'clinicId-agentType-index',
      KeyConditionExpression: 'clinicId = :clinicId AND agentType = :agentType',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':agentType': 'voice',
      },
      Limit: 1,
    }));

    if (result.Items && result.Items.length > 0) {
      const agent = result.Items[0];
      return {
        agentId: agent.bedrockAgentId,
        aliasId: agent.bedrockAliasId || 'TSTALIASID',
        agentName: agent.agentName || agent.name,
      };
    }

    // Fallback: query for any chatbot agent
    const fallback = await docClient.send(new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'clinicId-agentType-index',
      KeyConditionExpression: 'clinicId = :clinicId AND agentType = :agentType',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':agentType': 'chatbot',
      },
      Limit: 1,
    }));

    if (fallback.Items && fallback.Items.length > 0) {
      const agent = fallback.Items[0];
      return {
        agentId: agent.bedrockAgentId,
        aliasId: agent.bedrockAliasId || 'TSTALIASID',
        agentName: agent.agentName || agent.name,
      };
    }

    return null;
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
    const updateExpr = [
      'SET lastActivityTime = :now',
      'lastCallerUtterance = :caller',
      'lastAiResponse = :ai',
      'ADD turnCount :one, transcriptCount :two',
    ];
    const exprValues: Record<string, any> = {
      ':now': now,
      ':caller': callerUtterance.substring(0, 500), // Truncate for storage
      ':ai': aiResponse.substring(0, 1000),
      ':one': 1,
      ':two': 2, // One for caller, one for AI
    };

    if (toolsUsed && toolsUsed.length > 0) {
      updateExpr.push('toolsUsed = list_append(if_not_exists(toolsUsed, :emptyList), :tools)');
      exprValues[':emptyList'] = [];
      exprValues[':tools'] = toolsUsed.slice(0, 10); // Limit tools per turn
    }

    await docClient.send(new UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Key: { callId, timestamp },
      UpdateExpression: updateExpr.join(', '),
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
      // Update last activity
      await docClient.send(new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId: sessionKey },
        UpdateExpression: 'SET lastActivity = :now, turnCount = turnCount + :one',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
          ':one': 1,
        },
      }));
      return existing.Item as ConnectLexSession;
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
}): Promise<{ response: string; toolsUsed: string[] }> {
  const { agentId, aliasId, sessionId, inputText, clinicId } = params;

  try {
    const command = new InvokeAgentCommand({
      agentId,
      agentAliasId: aliasId,
      sessionId,
      inputText,
      sessionState: {
        sessionAttributes: {
          clinicId,
        },
      },
    });

    const response = await bedrockAgentClient.send(command);
    
    let fullResponse = '';
    const toolsUsed: string[] = [];

    if (response.completion) {
      for await (const event of response.completion) {
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

    return { 
      response: fullResponse.trim() || "I'm sorry, I couldn't generate a response. How else can I help you?",
      toolsUsed: [...new Set(toolsUsed)], // Dedupe
    };
  } catch (error) {
    console.error('[LexBedrockHook] Bedrock invocation error:', error);
    return {
      response: "I apologize, but I'm having trouble processing your request right now. Please try again or call back during office hours.",
      toolsUsed: [],
    };
  }
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: LexV2Event): Promise<LexV2Response> => {
  console.log('[LexBedrockHook] Received event:', JSON.stringify(event, null, 2));

  const lexSessionId = event.sessionId; // This is the Connect ContactId
  const inputTranscript = event.inputTranscript || '';
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const requestAttributes = event.requestAttributes || {};

  // Get transcription confidence from Lex
  const transcriptionConfidence = event.transcriptions?.[0]?.transcriptionConfidence || 0.9;

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
    return buildErrorResponse(event, "I'm sorry, the AI assistant is not available right now. Please call back during office hours.");
  }

  // Invoke Bedrock
  const { response: aiResponse, toolsUsed } = await invokeBedrock({
    agentId: agent.agentId,
    aliasId: agent.aliasId,
    sessionId: session.bedrockSessionId,
    inputText: inputTranscript,
    clinicId,
  });

  // Update analytics with this turn
  await updateAnalyticsTurn({
    callId: session.callId,
    timestamp: analyticsInfo.timestamp,
    callerUtterance: inputTranscript,
    aiResponse,
    toolsUsed,
  });

  // Add to transcript buffer
  await addTranscriptTurn({
    callId: session.callId,
    callerUtterance: inputTranscript,
    aiResponse,
    callStartMs: session.callStartMs,
    confidence: transcriptionConfidence,
  });

  // Build Lex response
  const response: LexV2Response = {
    sessionState: {
      sessionAttributes: {
        ...sessionAttributes,
        clinicId,
        callerNumber,
        callId: session.callId,
        turnCount: String(session.turnCount),
      },
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

  console.log('[LexBedrockHook] Returning response:', { clinicId, turnCount: session.turnCount, responseLength: aiResponse.length });
  return response;
};

/**
 * Build an error response for Lex
 */
function buildErrorResponse(event: LexV2Event, message: string): LexV2Response {
  return {
    sessionState: {
      sessionAttributes: event.sessionState?.sessionAttributes || {},
      dialogAction: {
        type: 'Close',
        fulfillmentState: 'Failed',
      },
      intent: event.sessionState?.intent ? {
        ...event.sessionState.intent,
        state: 'Failed',
      } : undefined,
    },
    messages: [
      {
        contentType: 'PlainText',
        content: message,
      },
    ],
  };
}

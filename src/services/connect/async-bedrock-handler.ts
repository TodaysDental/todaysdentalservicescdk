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
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { v4 as uuidv4 } from 'uuid';

// ========================================================================
// CONFIGURATION
// ========================================================================

const ASYNC_RESULTS_TABLE = process.env.ASYNC_RESULTS_TABLE || 'ConnectAsyncResults';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'AiAgentSessions';
const AGENTS_TABLE = process.env.AGENTS_TABLE || 'AiAgents';
const RESULT_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || 'dentistingreenville';

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
const bedrockAgentClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// ========================================================================
// TYPES
// ========================================================================

interface AsyncResult {
  requestId: string;
  contactId: string;
  status: 'pending' | 'completed' | 'error';
  response?: string;
  errorMessage?: string;
  toolsUsed?: string[];
  startedAt: string;
  completedAt?: string;
  ttl: number;
}

interface AgentInfo {
  agentId: string;
  aliasId: string;
  agentName?: string;
}

// PERFORMANCE: Cache agent lookups to avoid repeated DynamoDB queries
const agentCache = new Map<string, { agent: AgentInfo | null; timestamp: number }>();
const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ========================================================================
// AGENT LOOKUP (reused from lex-bedrock-hook.ts)
// ========================================================================

async function getAgentForClinic(clinicId: string): Promise<AgentInfo | null> {
  // Check cache first
  const cached = agentCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }

  try {
    const allAgents = await docClient.send(new QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
      },
      Limit: 20,
      ScanIndexForward: false,
    }));

    if (!allAgents.Items || allAgents.Items.length === 0) {
      agentCache.set(clinicId, { agent: null, timestamp: Date.now() });
      return null;
    }

    // Prioritize: 1) default voice agent, 2) any voice-enabled, 3) any agent
    let selectedAgent: any = null;

    const defaultVoice = allAgents.Items.find(
      (a: any) => a.isDefaultVoiceAgent === true && a.isVoiceEnabled === true
    );
    if (defaultVoice) {
      selectedAgent = defaultVoice;
      console.log('[AsyncBedrock] Selected default voice agent:', selectedAgent.agentId);
    }

    if (!selectedAgent) {
      const voiceEnabled = allAgents.Items.find((a: any) => a.isVoiceEnabled === true);
      if (voiceEnabled) {
        selectedAgent = voiceEnabled;
        console.log('[AsyncBedrock] Selected voice-enabled agent:', selectedAgent.agentId);
      }
    }

    if (!selectedAgent) {
      selectedAgent = allAgents.Items[0];
      console.log('[AsyncBedrock] Using fallback agent:', selectedAgent.agentId);
    }

    const agentInfo: AgentInfo = {
      agentId: selectedAgent.bedrockAgentId,
      aliasId: selectedAgent.bedrockAliasId || 'TSTALIASID',
      agentName: selectedAgent.agentName || selectedAgent.name,
    };

    agentCache.set(clinicId, { agent: agentInfo, timestamp: Date.now() });
    return agentInfo;
  } catch (error) {
    console.error('[AsyncBedrock] Error looking up agent:', error);
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

  // Store pending status immediately (so polling can start)
  const pendingResult: AsyncResult = {
    requestId,
    contactId,
    status: 'pending',
    startedAt: now,
    ttl: Math.floor(Date.now() / 1000) + RESULT_TTL_SECONDS,
  };

  await docClient.send(new PutCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Item: pendingResult,
  }));

  // Start background processing (don't await - let Lambda continue in background)
  // NOTE: In Lambda, the handler returns but execution continues until completion
  processBedrockInvocation({
    requestId,
    contactId,
    inputText: inputTranscript.trim(),
    clinicId,
  }).catch(err => {
    console.error('[AsyncBedrock] Background processing error:', err);
  });

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
}): Promise<void> {
  const { requestId, contactId, inputText, clinicId } = params;

  try {
    // Handle empty input
    if (!inputText) {
      await storeResult(requestId, contactId, {
        status: 'completed',
        response: "I'm sorry, I didn't catch that. Could you please repeat what you said?",
      });
      return;
    }

    // Get session and agent
    const session = await getOrCreateSession(contactId, clinicId);
    const agent = await getAgentForClinic(session.clinicId);

    if (!agent) {
      await storeResult(requestId, contactId, {
        status: 'error',
        errorMessage: `No Bedrock agent configured for clinic: ${clinicId}`,
        response: "I'm sorry, the AI assistant is not available right now. Please call back during office hours.",
      });
      return;
    }

    console.log('[AsyncBedrock] Invoking Bedrock agent:', {
      requestId,
      agentId: agent.agentId,
      sessionId: session.bedrockSessionId,
    });

    // Invoke Bedrock agent (this can take 10-30+ seconds with tool calls)
    const command = new InvokeAgentCommand({
      agentId: agent.agentId,
      agentAliasId: agent.aliasId,
      sessionId: session.bedrockSessionId,
      inputText,
      sessionState: {
        sessionAttributes: {
          clinicId: session.clinicId,
          inputMode: 'Speech',
          channel: 'voice',
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

    await storeResult(requestId, contactId, {
      status: 'completed',
      response: fullResponse.trim() || "I'm sorry, I couldn't process that. How else can I help you?",
      toolsUsed: [...new Set(toolsUsed)],
    });

  } catch (error: any) {
    console.error('[AsyncBedrock] Bedrock invocation error:', error);

    await storeResult(requestId, contactId, {
      status: 'error',
      errorMessage: error.message || 'Unknown error',
      response: "I'm sorry, I had trouble processing that. Could you please try again?",
    });
  }
}

/**
 * Store the result in DynamoDB for polling
 */
async function storeResult(
  requestId: string,
  contactId: string,
  result: {
    status: 'completed' | 'error';
    response?: string;
    errorMessage?: string;
    toolsUsed?: string[];
  }
): Promise<void> {
  const completedResult: AsyncResult = {
    requestId,
    contactId,
    status: result.status,
    response: result.response,
    errorMessage: result.errorMessage,
    toolsUsed: result.toolsUsed,
    startedAt: new Date().toISOString(), // Will be overwritten but that's OK
    completedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + RESULT_TTL_SECONDS,
  };

  await docClient.send(new PutCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Item: completedResult,
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

  if (!requestId) {
    console.warn('[AsyncBedrock] checkResult called without requestId');
    return {
      status: 'error',
      aiResponse: "I'm sorry, there was an error. Please try again.",
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
      })).catch(() => {});

      return {
        status: 'completed',
        aiResponse: item.response || '',
        ssmlResponse: `<speak>${escapeSSML(item.response || '')}</speak>`,
      };
    }

    if (item.status === 'error') {
      console.warn('[AsyncBedrock] Result has error:', { requestId, error: item.errorMessage });

      // Return the fallback response
      return {
        status: 'completed', // Still "completed" so Connect plays the message
        aiResponse: item.response || "I'm sorry, I had trouble processing that. Could you please try again?",
      };
    }

    // Still pending
    return { status: 'pending' };

  } catch (error) {
    console.error('[AsyncBedrock] checkResult error:', error);
    return {
      status: 'error',
      aiResponse: "I'm sorry, something went wrong. Please try again.",
    };
  }
}

// ========================================================================
// POLL RESULT (long-polling - simplifies Connect flow by avoiding loops)
// ========================================================================

/**
 * Called by Connect synchronously. Does internal long-polling to wait for results.
 * This simplifies the Connect flow by avoiding complex branching loops.
 * 
 * Polls DynamoDB every 500ms for up to 6 seconds, then returns:
 * - aiResponse with the actual AI response if ready
 * - aiResponse with a timeout message if still pending after 6s
 */
async function pollResult(event: any): Promise<{
  status: string;
  aiResponse: string;
  ssmlResponse?: string;
}> {
  const params = event.Details?.Parameters || {};
  const requestId = params.requestId || '';
  
  // Long-poll settings: 14 attempts × 500ms = 7 seconds max
  // (Connect has 8s Lambda limit, leave 1s buffer for response serialization)
  const MAX_POLL_ATTEMPTS = 50;
  const POLL_INTERVAL_MS = 500;

  if (!requestId) {
    console.warn('[AsyncBedrock] pollResult called without requestId');
    return {
      status: 'error',
      aiResponse: "I'm sorry, there was an error. Please try again.",
    };
  }

  console.log('[AsyncBedrock] Starting long-poll for:', { requestId });

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: ASYNC_RESULTS_TABLE,
        Key: { requestId },
      }));

      if (result.Item) {
        const item = result.Item as AsyncResult;

        if (item.status === 'completed') {
          console.log('[AsyncBedrock] Long-poll completed:', { 
            requestId, 
            attempt, 
            responseLength: item.response?.length 
          });

          // Clean up the record (fire and forget)
          docClient.send(new DeleteCommand({
            TableName: ASYNC_RESULTS_TABLE,
            Key: { requestId },
          })).catch(() => {});

          const aiResponse = item.response || '';
          return {
            status: 'completed',
            aiResponse,
            ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
          };
        }

        if (item.status === 'error') {
          console.warn('[AsyncBedrock] Long-poll found error:', { requestId, error: item.errorMessage });

          const aiResponse = item.response || "I'm sorry, I had trouble processing that. Could you please try again?";
          return {
            status: 'completed',
            aiResponse,
            ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
          };
        }
      }

      // Still pending - wait before next poll (unless this is the last attempt)
      if (attempt < MAX_POLL_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      }

    } catch (error) {
      console.error('[AsyncBedrock] Long-poll error:', error);
      // Don't fail immediately - continue polling
    }
  }

  // Timed out after MAX_POLL_ATTEMPTS
  console.warn('[AsyncBedrock] Long-poll timed out:', { requestId, attempts: MAX_POLL_ATTEMPTS });
  
  return {
    status: 'timeout',
    aiResponse: "I'm still working on that. Let me look this up for you.",
    ssmlResponse: '<speak>I\'m still working on that. Let me look this up for you.</speak>',
  };
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
      // Long-poll - simplifies Connect flow by doing internal polling
      return pollResult(event);
    
    case 'start':
    default:
      // Start async processing, return immediately with requestId
      return startAsync(event);
  }
};

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
    await updateResult(requestId, {
      status: 'error',
      response: "I'm sorry, the AI assistant is not available right now. Please try again.",
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
    await updateResult(requestId, {
      status: 'error',
      response: "I'm sorry, I'm having trouble right now. Please try again.",
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
}): Promise<void> {
  const { requestId, contactId, inputText, clinicId } = params;

  try {
    // Handle empty input
    if (!inputText) {
      await updateResult(requestId, {
        status: 'completed',
        response: "I'm sorry, I didn't catch that. Could you please repeat what you said?",
      });
      return;
    }

    // Get session and agent
    const session = await getOrCreateSession(contactId, clinicId);
    const agent = await getAgentForClinic(session.clinicId);

    if (!agent) {
      await updateResult(requestId, {
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

    await updateResult(requestId, {
      status: 'completed',
      response: fullResponse.trim() || "I'm sorry, I couldn't process that. How else can I help you?",
      toolsUsed: [...new Set(toolsUsed)],
    });

  } catch (error: any) {
    console.error('[AsyncBedrock] Bedrock invocation error:', error);

    await updateResult(requestId, {
      status: 'error',
      errorMessage: error.message || 'Unknown error',
      response: "I'm sorry, I had trouble processing that. Could you please try again?",
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
      'completedAt = :completedAt',
      'ttl = :ttl',
      'errorMessage = :errorMessage',
      'toolsUsed = :toolsUsed',
    ].join(', '),
    ExpressionAttributeNames: {
      '#status': 'status',
      '#response': 'response',
    },
    ExpressionAttributeValues: {
      ':status': result.status,
      ':response': result.response || '',
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
  const maxPollLoops = (() => {
    const n = parseInt(String(maxPollLoopsRaw || '20'), 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
  })();

  if (!requestId) {
    console.warn('[AsyncBedrock] pollResult called without requestId');
    return {
      status: 'error',
      aiResponse: "I'm sorry, there was an error. Please try again.",
    };
  }

  // Read the record once
  const result = await docClient.send(new GetCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Key: { requestId },
  }));

  if (!result.Item) {
    // Not found yet (or expired). Keep polling a bit.
    return { status: 'pending' };
  }

  const item = result.Item as AsyncResult;

  if (item.status === 'completed') {
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
    // Clean up the record (fire and forget)
    docClient.send(new DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
    })).catch(() => {});

    const aiResponse = item.response || "I'm sorry, I had trouble processing that. Could you please try again?";
    return {
      status: 'completed',
      aiResponse,
      ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
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
        })).catch(() => {});
        return {
          status: 'completed',
          aiResponse,
          ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
        };
      }
      if (current && current.status === 'error') {
        const aiResponse = current.response || "I'm sorry, I had trouble processing that. Could you please try again?";
        docClient.send(new DeleteCommand({
          TableName: ASYNC_RESULTS_TABLE,
          Key: { requestId },
        })).catch(() => {});
        return {
          status: 'completed',
          aiResponse,
          ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
        };
      }
    } catch {
      // Ignore and proceed with timeout handling
    }

    const aiResponse = "I'm sorry — this is taking longer than expected. Could you please repeat your question?";
    await updateResult(requestId, {
      status: 'completed',
      response: aiResponse,
      errorMessage: 'Polling timeout',
    });
    // Clean up (fire and forget)
    docClient.send(new DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
    })).catch(() => {});

    return {
      status: 'completed',
      aiResponse,
      ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
    };
  }

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

      if (!requestId) {
        console.error('[AsyncBedrock] process called without requestId');
        return { status: 'error' };
      }

      await processBedrockInvocation({
        requestId,
        contactId,
        inputText: inputText.trim(),
        clinicId,
      });
      return { status: 'processing_complete' };
    }
    
    case 'start':
    default:
      // Start async processing, return immediately with requestId
      return startAsync(event);
  }
};

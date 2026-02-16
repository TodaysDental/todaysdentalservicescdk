/**
 * RCS Auto Reply Processor
 *
 * Triggered asynchronously by `incoming-message.ts` after a patient sends an RCS message.
 * - Resolves the correct AI Agent (from AiAgents stack) for the clinic
 * - Invokes the Bedrock Agent Runtime with a stable sessionId per phone number
 * - Sends the agent response back to the patient using the existing `send-message` Lambda
 * - Logs both sides of the conversation into AiAgentConversations for auditing/analytics
 *
 * Session memory:
 * - We use a deterministic sessionId: `rcs:${clinicId}:${phone}` so the Bedrock Agent
 *   retains the full chat context across the entire text session.
 */

import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

// ======================================================================================
// ENV
// ======================================================================================

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE || '';
const RCS_SEND_MESSAGE_FUNCTION_ARN = process.env.RCS_SEND_MESSAGE_FUNCTION_ARN || '';
const AI_AGENTS_TABLE = process.env.AI_AGENTS_TABLE || '';
const AI_AGENT_CONVERSATIONS_TABLE = process.env.AI_AGENT_CONVERSATIONS_TABLE || '';

// Optional config
const RCS_REPLY_ENABLED = (process.env.RCS_REPLY_ENABLED || 'true').toLowerCase() !== 'false';
const RCS_REPLY_AGENT_ID = (process.env.RCS_REPLY_AGENT_ID || '').trim(); // Internal agentId (UUID)
const RCS_REPLY_AGENT_TAG = (process.env.RCS_REPLY_AGENT_TAG || 'rcs').trim().toLowerCase();
const RCS_REPLY_AGENT_ID_MAP_JSON = (process.env.RCS_REPLY_AGENT_ID_MAP_JSON || '').trim();

// Per-clinic config item
const CONFIG_SK = 'CONFIG#AUTO_REPLY';

// ======================================================================================
// CLIENTS
// ======================================================================================

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const bedrockAgentRuntime = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || 'us-east-1',
  maxAttempts: 3,
});

const lambdaClient = new LambdaClient({});

// ======================================================================================
// TYPES
// ======================================================================================

type RcsAutoReplyEvent = {
  clinicId: string;
  messageSid: string;
  from: string;
  to?: string;
  body: string;
  timestamp?: number;
  profileName?: string;
  rcsSenderId?: string;
};

type AiAgentRecord = {
  agentId: string;
  name?: string;
  clinicId: string;
  isActive?: boolean;
  isPublic?: boolean;
  isWebsiteEnabled?: boolean;
  tags?: string[];
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  bedrockAgentStatus?: string;
};

type ConversationLogItem = {
  sessionId: string;
  timestamp: number;
  messageType: 'user' | 'assistant' | 'system' | 'error' | 'trace';
  content: string;
  clinicId: string;
  agentId: string;
  agentName?: string;
  userId?: string;
  userName?: string;
  visitorId?: string;
  channel: 'rcs';
  isPublicChat: boolean;
  responseTimeMs?: number;
  traceData?: string;
  toolCalls?: string;
  tokenCount?: number;
};

// ======================================================================================
// HELPERS
// ======================================================================================

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseAgentIdMap(raw: string): Record<string, string> {
  if (!raw) return {};
  const parsed = safeJsonParse<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const key = String(k || '').trim();
    const val = typeof v === 'string' ? v.trim() : String(v || '').trim();
    if (key && val) out[key] = val;
  }
  return out;
}

const agentIdMap = parseAgentIdMap(RCS_REPLY_AGENT_ID_MAP_JSON);

type AutoReplyConfig = {
  enabled: boolean;
  agentId?: string;
  agentName?: string;
};

function normalizeRcsAddress(addr: string | undefined): string {
  const raw = String(addr || '').trim();
  if (!raw) return '';

  // Twilio often prefixes channels like "rcs:+1555..."
  const last = raw.includes(':') ? raw.split(':').pop() || raw : raw;
  const cleaned = last.replace(/[^\d+]/g, '');
  if (!cleaned) return '';

  // Ensure it starts with + for E.164 where possible
  if (cleaned.startsWith('+')) return cleaned;
  // If it's digits only and looks like US 10/11 digits, still keep it stable
  return cleaned;
}

function sanitizeBedrockSessionIdPart(input: string): string {
  // Bedrock Agents Runtime requires: [0-9a-zA-Z._:-]+
  return String(input || '')
    .trim()
    .replace(/[^0-9a-zA-Z._:-]/g, '-');
}

function buildSessionId(clinicId: string, from: string): string {
  const rawPhone = normalizeRcsAddress(from) || 'unknown';
  // Prefer digits-only phone key (avoids '+' which is not allowed by Bedrock sessionId regex)
  const digits = rawPhone.replace(/\D/g, '');
  const phonePart = digits || sanitizeBedrockSessionIdPart(rawPhone) || 'unknown';
  const clinicPart = sanitizeBedrockSessionIdPart(clinicId) || 'unknown';
  // Keep it short/stable for Bedrock sessionId limits.
  return `rcs:${clinicPart}:${phonePart}`.slice(0, 96);
}

async function getClinicAutoReplyConfig(clinicId: string): Promise<AutoReplyConfig | null> {
  if (!RCS_MESSAGES_TABLE) return null;
  try {
    const resp = await ddb.send(new GetCommand({
      TableName: RCS_MESSAGES_TABLE,
      Key: {
        pk: `CLINIC#${clinicId}`,
        sk: CONFIG_SK,
      },
    }));
    const item = resp.Item as any;
    if (!item) return null;
    return {
      enabled: item.enabled === true,
      agentId: typeof item.agentId === 'string' ? item.agentId : undefined,
      agentName: typeof item.agentName === 'string' ? item.agentName : undefined,
    };
  } catch (err) {
    console.error('[RcsAutoReply] Failed to read clinic auto-reply config:', err);
    return null;
  }
}

function looksLikeOptOut(body: string): boolean {
  const t = (body || '').trim().toLowerCase();
  if (!t) return false;
  return (
    t === 'stop' ||
    t === 'unsubscribe' ||
    t === 'cancel' ||
    t === 'end' ||
    t === 'quit'
  );
}

function pickPreferredAgent(candidates: AiAgentRecord[]): AiAgentRecord | null {
  if (candidates.length === 0) return null;

  const prepared = candidates.filter(
    (a) =>
      a.isActive === true &&
      a.bedrockAgentStatus === 'PREPARED' &&
      !!a.bedrockAgentId &&
      !!a.bedrockAgentAliasId
  );
  if (prepared.length === 0) return null;

  // 1) Prefer explicit tag match (e.g. "rcs")
  const tagged = prepared.filter((a) =>
    Array.isArray(a.tags) &&
    a.tags.some((t) => String(t).trim().toLowerCase() === RCS_REPLY_AGENT_TAG)
  );
  if (tagged.length > 0) return tagged[0];

  // 2) Prefer website-enabled (text-optimized) agents
  const website = prepared.filter((a) => a.isWebsiteEnabled === true);
  if (website.length > 0) return website[0];

  // 3) Fallback to first prepared agent
  return prepared[0];
}

async function getAgentById(agentId: string): Promise<AiAgentRecord | null> {
  const resp = await ddb.send(
    new GetCommand({
      TableName: AI_AGENTS_TABLE,
      Key: { agentId },
    })
  );
  return (resp.Item as AiAgentRecord) || null;
}

async function getClinicAgents(clinicId: string): Promise<AiAgentRecord[]> {
  const params: QueryCommandInput = {
    TableName: AI_AGENTS_TABLE,
    IndexName: 'ClinicIndex',
    KeyConditionExpression: 'clinicId = :clinicId',
    ExpressionAttributeValues: { ':clinicId': clinicId },
    ScanIndexForward: false,
    Limit: 50,
  };
  const resp = await ddb.send(new QueryCommand(params));
  return (resp.Items as AiAgentRecord[]) || [];
}

async function resolveAgentForClinic(clinicId: string): Promise<AiAgentRecord | null> {
  const mapped = agentIdMap[clinicId];
  if (mapped) return await getAgentById(mapped);
  if (RCS_REPLY_AGENT_ID) return await getAgentById(RCS_REPLY_AGENT_ID);

  const agents = await getClinicAgents(clinicId);
  return pickPreferredAgent(agents);
}

async function logConversation(item: Omit<ConversationLogItem, 'ttl'>): Promise<void> {
  if (!AI_AGENT_CONVERSATIONS_TABLE) return;
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days
  try {
    await ddb.send(
      new PutCommand({
        TableName: AI_AGENT_CONVERSATIONS_TABLE,
        Item: { ...item, ttl },
      })
    );
  } catch (err) {
    console.error('[RcsAutoReply] Failed to log conversation message:', err);
  }
}

async function markReplyIdempotency(clinicId: string, messageSid: string): Promise<boolean> {
  if (!RCS_MESSAGES_TABLE) return true; // best-effort
  try {
    await ddb.send(
      new PutCommand({
        TableName: RCS_MESSAGES_TABLE,
        Item: {
          pk: `CLINIC#${clinicId}`,
          sk: `AI_REPLY_SID#${messageSid}`,
          clinicId,
          messageSid,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days (enough for retries)
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
    return true;
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}

async function releaseReplyIdempotency(clinicId: string, messageSid: string): Promise<void> {
  if (!RCS_MESSAGES_TABLE) return;
  try {
    await ddb.send(new DeleteCommand({
      TableName: RCS_MESSAGES_TABLE,
      Key: {
        pk: `CLINIC#${clinicId}`,
        sk: `AI_REPLY_SID#${messageSid}`,
      },
    }));
  } catch (err) {
    console.error('[RcsAutoReply] Failed to release idempotency record:', err);
  }
}

async function invokeSendRcsMessage(args: {
  clinicId: string;
  to: string;
  body: string;
  campaignId?: string;
  campaignName?: string;
  aiAgentId?: string;
  aiAgentName?: string;
  aiSessionId?: string;
  inReplyToSid?: string;
}): Promise<{ ok: boolean; messageSid?: string; error?: string; statusCode?: number; skipped?: boolean; reason?: string }> {
  if (!RCS_SEND_MESSAGE_FUNCTION_ARN) {
    return { ok: false, error: 'RCS_SEND_MESSAGE_FUNCTION_ARN not set' };
  }

  const invokeEvent = {
    httpMethod: 'POST',
    body: JSON.stringify({
      clinicId: args.clinicId,
      to: args.to,
      body: args.body,
      ...(args.campaignId ? { campaignId: args.campaignId } : {}),
      ...(args.campaignName ? { campaignName: args.campaignName } : {}),
      ...(args.aiAgentId ? { aiAgentId: args.aiAgentId } : {}),
      ...(args.aiAgentName ? { aiAgentName: args.aiAgentName } : {}),
      ...(args.aiSessionId ? { aiSessionId: args.aiSessionId } : {}),
      ...(args.inReplyToSid ? { inReplyToSid: args.inReplyToSid } : {}),
    }),
  };

  const resp = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: RCS_SEND_MESSAGE_FUNCTION_ARN,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(invokeEvent)),
    })
  );

  if (resp.FunctionError) {
    const rawErr = resp.Payload ? Buffer.from(resp.Payload as Uint8Array).toString('utf-8') : '';
    return { ok: false, error: rawErr || resp.FunctionError };
  }

  const raw = resp.Payload ? Buffer.from(resp.Payload as Uint8Array).toString('utf-8') : '';
  const apiResult = raw ? safeJsonParse<any>(raw) : null;
  const statusCode = Number(apiResult?.statusCode || 0);
  const bodyStr = apiResult?.body;
  const bodyObj = typeof bodyStr === 'string' ? safeJsonParse<any>(bodyStr) : null;

  if (statusCode >= 200 && statusCode < 300 && bodyObj?.success) {
    return { ok: true, messageSid: bodyObj.messageSid, statusCode };
  }

  // Treat "skipped" responses (e.g. unsubscribed) as handled (no retries).
  if (statusCode >= 200 && statusCode < 300 && bodyObj?.skipped) {
    return {
      ok: true,
      skipped: true,
      reason: bodyObj?.reason,
      error: bodyObj?.message || bodyObj?.error || bodyObj?.reason,
      statusCode,
    };
  }

  return {
    ok: false,
    statusCode,
    error:
      bodyObj?.error ||
      bodyObj?.message ||
      bodyObj?.reason ||
      (typeof bodyStr === 'string' ? bodyStr : raw) ||
      'RCS send failed',
  };
}

async function invokeBedrockAgent(args: {
  bedrockAgentId: string;
  bedrockAgentAliasId: string;
  sessionId: string;
  inputText: string;
  sessionAttributes: Record<string, string>;
  promptSessionAttributes: Record<string, string>;
}): Promise<string> {
  const invokeCmd = new InvokeAgentCommand({
    agentId: args.bedrockAgentId,
    agentAliasId: args.bedrockAgentAliasId,
    sessionId: args.sessionId,
    inputText: args.inputText,
    enableTrace: false,
    endSession: false,
    sessionState: {
      sessionAttributes: args.sessionAttributes,
      promptSessionAttributes: args.promptSessionAttributes,
    },
  });

  const bedrockResp = await bedrockAgentRuntime.send(invokeCmd);
  let responseText = '';

  if (bedrockResp.completion) {
    for await (const evt of bedrockResp.completion) {
      if (evt.chunk?.bytes) {
        responseText += new TextDecoder().decode(evt.chunk.bytes);
      }
    }
  }

  return (responseText || '').trim();
}

// ======================================================================================
// HANDLER
// ======================================================================================

export const handler = async (event: RcsAutoReplyEvent): Promise<void> => {
  if (!RCS_REPLY_ENABLED) {
    console.log('[RcsAutoReply] Disabled via RCS_REPLY_ENABLED=false');
    return;
  }

  const clinicId = String(event?.clinicId || '').trim();
  const messageSid = String(event?.messageSid || '').trim();
  const fromRaw = String(event?.from || '').trim();
  const bodyRaw = String(event?.body || '').trim();

  if (!clinicId || !messageSid || !fromRaw) {
    console.warn('[RcsAutoReply] Missing required fields', { clinicId, messageSid, from: fromRaw });
    return;
  }

  if (!bodyRaw) {
    console.log('[RcsAutoReply] Empty body - skipping');
    return;
  }

  if (looksLikeOptOut(bodyRaw)) {
    console.log('[RcsAutoReply] Opt-out keyword detected - skipping AI reply', { clinicId, messageSid });
    return;
  }

  if (!AI_AGENTS_TABLE) {
    console.error('[RcsAutoReply] AI_AGENTS_TABLE not set - cannot resolve agent');
    return;
  }

  // Per-clinic config (UI-controlled)
  const config = await getClinicAutoReplyConfig(clinicId);
  if (!config || config.enabled !== true) {
    console.log('[RcsAutoReply] Auto-reply disabled (or not configured) - skipping', { clinicId, messageSid });
    return;
  }

  // Resolve agent (prefer explicit configured agentId)
  let agent: AiAgentRecord | null = null;
  const configuredAgentId = (config.agentId || '').trim();
  if (configuredAgentId) {
    agent = await getAgentById(configuredAgentId);
    const belongsToClinic = agent?.clinicId === clinicId || agent?.isPublic === true;
    const isPrepared =
      agent?.isActive === true &&
      agent?.bedrockAgentStatus === 'PREPARED' &&
      !!agent?.bedrockAgentId &&
      !!agent?.bedrockAgentAliasId;
    if (!agent || !belongsToClinic || !isPrepared) {
      console.warn('[RcsAutoReply] Configured agent invalid/not ready - skipping', {
        clinicId,
        configuredAgentId,
        found: !!agent,
        belongsToClinic,
        status: agent?.bedrockAgentStatus,
        isActive: agent?.isActive,
      });
      return;
    }
  } else {
    agent = await resolveAgentForClinic(clinicId);
  }

  if (!agent?.bedrockAgentId || !agent?.bedrockAgentAliasId || agent.bedrockAgentStatus !== 'PREPARED' || agent.isActive !== true) {
    console.warn('[RcsAutoReply] No prepared/active agent found for clinic - skipping', {
      clinicId,
      resolvedAgentId: agent?.agentId,
      status: agent?.bedrockAgentStatus,
    });
    return;
  }

  // Idempotency: ensure we only reply once per inbound Twilio MessageSid
  // IMPORTANT: Acquire only after we know we can proceed (agent resolved).
  const canProceed = await markReplyIdempotency(clinicId, messageSid);
  if (!canProceed) {
    console.log('[RcsAutoReply] Duplicate messageSid - already replied', { clinicId, messageSid });
    return;
  }

  const sessionId = buildSessionId(clinicId, fromRaw);
  const patientAddress = normalizeRcsAddress(fromRaw) || fromRaw;

  const start = Date.now();

  try {
    // Log user message
    await logConversation({
      sessionId,
      timestamp: event.timestamp || Date.now(),
      messageType: 'user',
      content: bodyRaw,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId: patientAddress,
      channel: 'rcs',
      isPublicChat: true,
    });

    const sessionAttributes: Record<string, string> = {
      clinicId,
      channel: 'rcs',
      userId: patientAddress,
      userName: event.profileName ? String(event.profileName).slice(0, 80) : 'Patient',
      from: patientAddress,
    };

    const promptSessionAttributes: Record<string, string> = {
      channel: 'rcs',
      clinicId,
    };

    let replyText = '';
    try {
      replyText = await invokeBedrockAgent({
        bedrockAgentId: agent.bedrockAgentId,
        bedrockAgentAliasId: agent.bedrockAgentAliasId,
        sessionId,
        inputText: bodyRaw,
        sessionAttributes,
        promptSessionAttributes,
      });
    } catch (err) {
      console.error('[RcsAutoReply] Bedrock InvokeAgent failed', err);
      await logConversation({
        sessionId,
        timestamp: Date.now(),
        messageType: 'error',
        content: `InvokeAgent failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        clinicId,
        agentId: agent.agentId,
        agentName: agent.name,
        visitorId: patientAddress,
        channel: 'rcs',
        isPublicChat: true,
      });
      throw err;
    }

    // Basic guard: avoid sending empty responses
    if (!replyText) {
      replyText = "Thanks for reaching out — how can I help you today?";
    }

    // Keep RCS replies reasonably short (can be overridden by prompt customization)
    if (replyText.length > 1200) {
      replyText = replyText.slice(0, 1190).trimEnd() + '…';
    }

    const sendResult = await invokeSendRcsMessage({
      clinicId,
      to: patientAddress,
      body: replyText,
      campaignId: 'ai-auto-reply',
      campaignName: 'AI Auto Reply',
      aiAgentId: agent.agentId,
      aiAgentName: agent.name || config.agentName,
      aiSessionId: sessionId,
      inReplyToSid: messageSid,
    });

    const latencyMs = Date.now() - start;

    // Log assistant message (even if send failed, for audit)
    await logConversation({
      sessionId,
      timestamp: Date.now(),
      messageType: 'assistant',
      content: replyText,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId: patientAddress,
      channel: 'rcs',
      isPublicChat: true,
      responseTimeMs: latencyMs,
    });

    if (!sendResult.ok) {
      console.warn('[RcsAutoReply] Failed to send RCS reply', {
        clinicId,
        messageSid,
        to: patientAddress,
        error: sendResult.error,
        statusCode: sendResult.statusCode,
      });
      throw new Error(sendResult.error || 'Failed to send RCS reply');
    }

    if (sendResult.skipped) {
      console.log('[RcsAutoReply] RCS reply skipped', {
        clinicId,
        inboundMessageSid: messageSid,
        agentId: agent.agentId,
        sessionId,
        reason: sendResult.reason,
        message: sendResult.error,
      });
      return;
    }

    console.log('[RcsAutoReply] Sent RCS AI reply', {
      clinicId,
      inboundMessageSid: messageSid,
      outboundMessageSid: sendResult.messageSid,
      agentId: agent.agentId,
      sessionId,
      durationMs: latencyMs,
    });
  } catch (err) {
    // Allow async invocation retries: release idempotency lock and rethrow.
    await releaseReplyIdempotency(clinicId, messageSid);
    throw err;
  }
};


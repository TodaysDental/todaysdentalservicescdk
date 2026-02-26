/**
 * SMS AI Auto Reply Processor
 *
 * Triggered asynchronously by `incoming-message.ts` after a customer sends an SMS.
 * - Resolves the correct AI Agent (from AiAgents stack) for the clinic
 * - Invokes the Bedrock Agent Runtime with a stable sessionId per phone number
 * - Sends the agent response back to the customer via AWS End User Messaging SMS
 * - Logs both sides of the conversation into AiAgentConversations for auditing/analytics
 */

import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { getClinicConfig } from '../../shared/utils/secrets-helper';
import { isUnsubscribed, type CommunicationChannel } from '../shared/unsubscribe';

// Pinpoint SMS Voice V2 Client (AWS End User Messaging SMS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

// ======================================================================================
// ENV
// ======================================================================================

const SMS_MESSAGES_TABLE = process.env.SMS_MESSAGES_TABLE || '';
const UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE || '';
const AI_AGENTS_TABLE = process.env.AI_AGENTS_TABLE || '';
const AI_AGENT_CONVERSATIONS_TABLE = process.env.AI_AGENT_CONVERSATIONS_TABLE || '';

// Optional config
const SMS_REPLY_ENABLED = (process.env.SMS_REPLY_ENABLED || 'true').toLowerCase() !== 'false';
const SMS_REPLY_AGENT_ID = (process.env.SMS_REPLY_AGENT_ID || '').trim(); // Internal agentId (UUID)
const SMS_REPLY_AGENT_TAG = (process.env.SMS_REPLY_AGENT_TAG || 'sms').trim().toLowerCase();
const SMS_REPLY_AGENT_ID_MAP_JSON = (process.env.SMS_REPLY_AGENT_ID_MAP_JSON || '').trim();
const SMS_DEFAULT_ORIGINATION_ARN = (process.env.SMS_DEFAULT_ORIGINATION_ARN || '').trim();

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

const smsClient = new (PinpointSMSVoiceV2Client as any)({});

// ======================================================================================
// TYPES
// ======================================================================================

export type SmsAutoReplyEvent = {
  clinicId: string;
  inboundMessageId: string;
  originationNumber: string; // customer phone
  destinationNumber: string; // our phone
  messageBody: string;
  messageKeyword?: string;
  previousPublishedMessageId?: string;
  timestamp?: number;
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
  channel: 'sms';
  isPublicChat: boolean;
  responseTimeMs?: number;
  traceData?: string;
  toolCalls?: string;
  tokenCount?: number;
};

type AutoReplyConfig = {
  enabled: boolean;
  agentId?: string;
  agentName?: string;
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

const agentIdMap = parseAgentIdMap(SMS_REPLY_AGENT_ID_MAP_JSON);

function normalizePhone(phone: string | undefined): string {
  const s = String(phone || '').trim();
  if (!s) return '';
  const cleaned = s.replace(/[^0-9+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

function sanitizeBedrockSessionIdPart(input: string): string {
  // Bedrock Agents Runtime requires: [0-9a-zA-Z._:-]+
  return String(input || '')
    .trim()
    .replace(/[^0-9a-zA-Z._:-]/g, '-');
}

function buildSessionId(args: { clinicId: string; from: string; to: string }): string {
  const clinicPart = sanitizeBedrockSessionIdPart(args.clinicId) || 'unknown';
  const fromDigits = normalizePhone(args.from).replace(/\D/g, '') || 'unknown';
  const toDigits = normalizePhone(args.to).replace(/\D/g, '') || 'unknown';
  return `sms:${clinicPart}:${toDigits}:${fromDigits}`.slice(0, 96);
}

function looksLikeOptOut(body: string): boolean {
  const t = (body || '').trim().toLowerCase();
  if (!t) return false;
  return t === 'stop' || t === 'unsubscribe' || t === 'cancel' || t === 'end' || t === 'quit';
}

function looksLikeOptIn(body: string): boolean {
  const t = (body || '').trim().toLowerCase();
  if (!t) return false;
  return t === 'start' || t === 'yes' || t === 'unstop';
}

async function getClinicAutoReplyConfig(clinicId: string): Promise<AutoReplyConfig | null> {
  if (!SMS_MESSAGES_TABLE) return null;
  try {
    const resp = await ddb.send(new GetCommand({
      TableName: SMS_MESSAGES_TABLE,
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
    console.error('[SmsAutoReply] Failed to read clinic auto-reply config:', err);
    return null;
  }
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

  // 1) Prefer explicit tag match (e.g. "sms")
  const tagged = prepared.filter((a) =>
    Array.isArray(a.tags) &&
    a.tags.some((t) => String(t).trim().toLowerCase() === SMS_REPLY_AGENT_TAG)
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
  if (SMS_REPLY_AGENT_ID) return await getAgentById(SMS_REPLY_AGENT_ID);

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
    console.error('[SmsAutoReply] Failed to log conversation message:', err);
  }
}

async function markReplyIdempotency(inboundMessageId: string): Promise<boolean> {
  if (!SMS_MESSAGES_TABLE) return true;
  try {
    await ddb.send(
      new PutCommand({
        TableName: SMS_MESSAGES_TABLE,
        Item: {
          pk: `AI_REPLY#${inboundMessageId}`,
          sk: 'AI_REPLY',
          inboundMessageId,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
    return true;
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function releaseReplyIdempotency(inboundMessageId: string): Promise<void> {
  if (!SMS_MESSAGES_TABLE) return;
  try {
    await ddb.send(new DeleteCommand({
      TableName: SMS_MESSAGES_TABLE,
      Key: { pk: `AI_REPLY#${inboundMessageId}`, sk: 'AI_REPLY' },
    }));
  } catch (err) {
    console.error('[SmsAutoReply] Failed to release idempotency record:', err);
  }
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

async function getClinicSmsOriginationArn(clinicId: string): Promise<string | undefined> {
  try {
    const cfg = await getClinicConfig(clinicId);
    const arn = String(cfg?.smsOriginationArn || '').trim();
    return arn || undefined;
  } catch (err) {
    console.warn('[SmsAutoReply] Failed to load clinic config (non-fatal):', err);
    return undefined;
  }
}

async function sendSmsReply(args: {
  originationArn: string;
  to: string;
  body: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const toNorm = normalizePhone(args.to);
  if (!toNorm) return { ok: false, error: 'Invalid destination phone' };

  try {
    const cmd = new SendTextMessageCommand({
      DestinationPhoneNumber: toNorm,
      MessageBody: args.body,
      OriginationIdentity: args.originationArn,
      MessageType: 'TRANSACTIONAL',
    });
    const resp = await smsClient.send(cmd);
    return { ok: true, messageId: resp?.MessageId };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to send SMS' };
  }
}

async function storeOutboundMessage(args: {
  clinicId: string;
  to: string;
  from: string;
  body: string;
  messageId?: string;
  inboundMessageId: string;
  aiAgentId?: string;
  aiAgentName?: string;
  aiSessionId?: string;
}): Promise<void> {
  if (!SMS_MESSAGES_TABLE) return;
  const timestamp = Date.now();
  const createdAt = new Date(timestamp).toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

  await ddb.send(new PutCommand({
    TableName: SMS_MESSAGES_TABLE,
    Item: {
      pk: `CLINIC#${args.clinicId}`,
      sk: `OUTBOUND#${timestamp}#${args.messageId || 'unknown'}`,
      clinicId: args.clinicId,
      direction: 'outbound',
      messageType: 'text',
      messageId: args.messageId,
      to: normalizePhone(args.to) || args.to,
      from: normalizePhone(args.from) || args.from,
      body: args.body,
      status: 'sent',
      timestamp,
      createdAt,
      ttl,
      // AI metadata
      aiAgentId: args.aiAgentId || undefined,
      aiAgentName: args.aiAgentName || undefined,
      aiSessionId: args.aiSessionId || undefined,
      inReplyToInboundMessageId: args.inboundMessageId,
      // Date fields for analytics
      dateKey: createdAt.split('T')[0],
      hourKey: new Date(timestamp).getUTCHours(),
    },
  }));
}

// ======================================================================================
// HANDLER
// ======================================================================================

export const handler = async (event: SmsAutoReplyEvent): Promise<void> => {
  if (!SMS_REPLY_ENABLED) {
    console.log('[SmsAutoReply] Disabled via SMS_REPLY_ENABLED=false');
    return;
  }

  const clinicId = String(event?.clinicId || '').trim();
  const inboundMessageId = String(event?.inboundMessageId || '').trim();
  const fromRaw = String(event?.originationNumber || '').trim();
  const toRaw = String(event?.destinationNumber || '').trim();
  const bodyRaw = String(event?.messageBody || '').trim();

  if (!clinicId || !inboundMessageId || !fromRaw || !toRaw) {
    console.warn('[SmsAutoReply] Missing required fields', { clinicId, inboundMessageId, from: fromRaw, to: toRaw });
    return;
  }

  if (!bodyRaw) {
    console.log('[SmsAutoReply] Empty body - skipping');
    return;
  }

  // Never AI-reply to STOP/START style keywords (handled by inbound handler + carrier rules)
  if (looksLikeOptOut(bodyRaw) || looksLikeOptIn(bodyRaw)) {
    console.log('[SmsAutoReply] Opt keyword detected - skipping AI reply', { clinicId, inboundMessageId });
    return;
  }

  if (!AI_AGENTS_TABLE) {
    console.error('[SmsAutoReply] AI_AGENTS_TABLE not set - cannot resolve agent');
    return;
  }

  // Per-clinic config (UI-controlled)
  const config = await getClinicAutoReplyConfig(clinicId);
  if (!config || config.enabled !== true) {
    console.log('[SmsAutoReply] Auto-reply disabled (or not configured) - skipping', { clinicId, inboundMessageId });
    return;
  }

  // Check unsubscribe preferences (fail open if table not configured)
  if (UNSUBSCRIBE_TABLE) {
    const unsubscribed = await isUnsubscribed(
      ddb,
      UNSUBSCRIBE_TABLE,
      { phone: fromRaw },
      clinicId,
      'SMS' as CommunicationChannel
    );
    if (unsubscribed) {
      console.log('[SmsAutoReply] Recipient unsubscribed - skipping AI reply', { clinicId, inboundMessageId });
      return;
    }
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
      console.warn('[SmsAutoReply] Configured agent invalid/not ready - skipping', {
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
    console.warn('[SmsAutoReply] No prepared/active agent found for clinic - skipping', {
      clinicId,
      resolvedAgentId: agent?.agentId,
      status: agent?.bedrockAgentStatus,
    });
    return;
  }

  // Idempotency: ensure we only reply once per inbound message id
  const canProceed = await markReplyIdempotency(inboundMessageId);
  if (!canProceed) {
    console.log('[SmsAutoReply] Duplicate inboundMessageId - already replied', { clinicId, inboundMessageId });
    return;
  }

  const sessionId = buildSessionId({ clinicId, from: fromRaw, to: toRaw });
  const customerPhone = normalizePhone(fromRaw) || fromRaw;
  const destinationNumber = normalizePhone(toRaw) || toRaw;

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
      visitorId: customerPhone,
      channel: 'sms',
      isPublicChat: true,
    });

    const sessionAttributes: Record<string, string> = {
      clinicId,
      channel: 'sms',
      userId: customerPhone,
      userName: 'Patient',
      from: customerPhone,
      to: destinationNumber,
    };

    const promptSessionAttributes: Record<string, string> = {
      channel: 'sms',
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
      console.error('[SmsAutoReply] Bedrock InvokeAgent failed', err);
      await logConversation({
        sessionId,
        timestamp: Date.now(),
        messageType: 'error',
        content: `InvokeAgent failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        clinicId,
        agentId: agent.agentId,
        agentName: agent.name,
        visitorId: customerPhone,
        channel: 'sms',
        isPublicChat: true,
      });
      throw err;
    }

    if (!replyText) {
      replyText = 'Thanks for texting — how can I help you today?';
    }

    // Keep SMS replies short-ish (multipart SMS costs more and looks noisy)
    if (replyText.length > 600) {
      replyText = replyText.slice(0, 590).trimEnd() + '…';
    }

    const clinicOriginationArn = await getClinicSmsOriginationArn(clinicId);
    const originationArn = clinicOriginationArn || SMS_DEFAULT_ORIGINATION_ARN;
    if (!originationArn) {
      throw new Error(`No SMS origination identity configured for clinic ${clinicId}`);
    }

    const sendResult = await sendSmsReply({
      originationArn,
      to: customerPhone,
      body: replyText,
    });

    const latencyMs = Date.now() - start;

    // Log assistant message
    await logConversation({
      sessionId,
      timestamp: Date.now(),
      messageType: 'assistant',
      content: replyText,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId: customerPhone,
      channel: 'sms',
      isPublicChat: true,
      responseTimeMs: latencyMs,
    });

    // Store outbound message record (best-effort for auditing)
    await storeOutboundMessage({
      clinicId,
      to: customerPhone,
      from: destinationNumber,
      body: replyText,
      messageId: sendResult.messageId,
      inboundMessageId,
      aiAgentId: agent.agentId,
      aiAgentName: agent.name || config.agentName,
      aiSessionId: sessionId,
    }).catch((err) => console.warn('[SmsAutoReply] Failed to store outbound message (non-fatal):', err));

    if (!sendResult.ok) {
      console.warn('[SmsAutoReply] Failed to send SMS reply', {
        clinicId,
        inboundMessageId,
        to: customerPhone,
        error: sendResult.error,
      });
      throw new Error(sendResult.error || 'Failed to send SMS reply');
    }

    console.log('[SmsAutoReply] Sent SMS AI reply', {
      clinicId,
      inboundMessageId,
      outboundMessageId: sendResult.messageId,
      agentId: agent.agentId,
      sessionId,
      durationMs: latencyMs,
    });
  } catch (err) {
    await releaseReplyIdempotency(inboundMessageId);
    throw err;
  }
};


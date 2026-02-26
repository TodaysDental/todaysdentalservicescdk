/**
 * SMS Two-Way Incoming Message Handler (SNS)
 *
 * Triggered by AWS End User Messaging SMS two-way messaging.
 * The service publishes a JSON payload to an SNS topic containing:
 *  - originationNumber (customer phone)
 *  - destinationNumber (our phone)
 *  - messageBody
 *  - inboundMessageId (UUID)
 *
 * This handler:
 *  - Idempotently stores the inbound message in DynamoDB
 *  - Handles STOP/START opt-out keywords (updates UnsubscribePreferences)
 *  - Asynchronously invokes the SMS Bedrock-agent auto-reply processor
 */

import type { SNSEvent, SNSEventRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  type PutCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getAllClinicConfigs, getClinicConfig } from '../../shared/utils/secrets-helper';
import { recordResubscribe, recordUnsubscribe } from '../shared/unsubscribe';

// Pinpoint SMS Voice V2 Client (AWS End User Messaging SMS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

// ======================================================================================
// ENV
// ======================================================================================

const SMS_MESSAGES_TABLE = process.env.SMS_MESSAGES_TABLE || '';
const SMS_AUTO_REPLY_FUNCTION_ARN = process.env.SMS_AUTO_REPLY_FUNCTION_ARN || '';
const ENABLE_SMS_AUTO_REPLY = (process.env.ENABLE_SMS_AUTO_REPLY || 'true').toLowerCase() !== 'false';
const UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE || '';

// Optional fallback when clinic resolution fails (e.g., one shared number).
const SMS_DEFAULT_ORIGINATION_ARN = (process.env.SMS_DEFAULT_ORIGINATION_ARN || '').trim();

// ======================================================================================
// CLIENTS
// ======================================================================================

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const lambdaClient = new LambdaClient({});
const smsClient = new (PinpointSMSVoiceV2Client as any)({});

// ======================================================================================
// TYPES
// ======================================================================================

type TwoWaySmsPayload = {
  originationNumber: string;
  destinationNumber: string;
  messageKeyword?: string;
  messageBody?: string;
  inboundMessageId: string;
  previousPublishedMessageId?: string;
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

function normalizePhone(phone: string): string | undefined {
  const s = String(phone || '').trim();
  if (!s) return undefined;

  const cleaned = s.replace(/[^0-9+]/g, '');
  if (!cleaned) return undefined;

  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    if (digits.length < 7) return undefined;
    return `+${digits}`;
  }

  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 7) return `+${digits}`;
  return undefined;
}

function looksLikeOptOut(body: string): boolean {
  const t = String(body || '').trim().toLowerCase();
  if (!t) return false;
  return t === 'stop' || t === 'unsubscribe' || t === 'cancel' || t === 'end' || t === 'quit';
}

function looksLikeOptIn(body: string): boolean {
  const t = String(body || '').trim().toLowerCase();
  if (!t) return false;
  // Common carrier keywords: START, YES, UNSTOP
  return t === 'start' || t === 'yes' || t === 'unstop';
}

let destinationToClinicCache: { expiresAt: number; map: Map<string, string> } | null = null;
const DESTINATION_CACHE_TTL_MS = 5 * 60 * 1000;

let topicArnToClinicCache: { expiresAt: number; map: Map<string, string> } | null = null;
const TOPIC_ARN_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeTopicArn(topicArn: string): string | undefined {
  const s = String(topicArn || '').trim();
  return s ? s : undefined;
}

async function getClinicIdForTopicArn(topicArn: string): Promise<string | null> {
  const arn = normalizeTopicArn(topicArn);
  if (!arn) return null;

  const cached = topicArnToClinicCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.map.get(arn) || null;
  }

  const configs = await getAllClinicConfigs();
  const map = new Map<string, string>();
  for (const cfg of configs || []) {
    const cfgArn = normalizeTopicArn(String(cfg?.smsIncomingSnsTopicArn || ''));
    const clinicId = String(cfg?.clinicId || '').trim();
    if (cfgArn && clinicId) map.set(cfgArn, clinicId);
  }

  topicArnToClinicCache = { map, expiresAt: Date.now() + TOPIC_ARN_CACHE_TTL_MS };
  return map.get(arn) || null;
}

async function getClinicIdForDestination(destinationNumber: string): Promise<string | null> {
  const dest = normalizePhone(destinationNumber);
  if (!dest) return null;

  const cached = destinationToClinicCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.map.get(dest) || null;
  }

  const configs = await getAllClinicConfigs();
  const map = new Map<string, string>();
  for (const cfg of configs || []) {
    const phone = normalizePhone(String(cfg?.smsPhoneNumber || cfg?.phoneNumber || ''));
    const clinicId = String(cfg?.clinicId || '').trim();
    if (phone && clinicId) map.set(phone, clinicId);
  }

  destinationToClinicCache = { map, expiresAt: Date.now() + DESTINATION_CACHE_TTL_MS };
  return map.get(dest) || null;
}

async function markInboundIdempotency(inboundMessageId: string): Promise<boolean> {
  if (!SMS_MESSAGES_TABLE) return true;
  const pk = `INBOUND#${inboundMessageId}`;
  const sk = 'INBOUND';
  try {
    const params: PutCommandInput = {
      TableName: SMS_MESSAGES_TABLE,
      Item: {
        pk,
        sk,
        inboundMessageId,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    };
    await ddb.send(new PutCommand(params));
    return true;
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function releaseInboundIdempotency(inboundMessageId: string): Promise<void> {
  if (!SMS_MESSAGES_TABLE) return;
  try {
    await ddb.send(new DeleteCommand({
      TableName: SMS_MESSAGES_TABLE,
      Key: { pk: `INBOUND#${inboundMessageId}`, sk: 'INBOUND' },
    }));
  } catch (err) {
    console.error('[SmsIncoming] Failed to release inbound idempotency record (non-fatal):', err);
  }
}

async function storeInboundMessage(args: {
  clinicId: string;
  payload: TwoWaySmsPayload;
  timestamp: number;
}): Promise<void> {
  if (!SMS_MESSAGES_TABLE) return;

  const { clinicId, payload, timestamp } = args;
  const createdAt = new Date(timestamp).toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

  await ddb.send(new PutCommand({
    TableName: SMS_MESSAGES_TABLE,
    Item: {
      pk: `CLINIC#${clinicId}`,
      sk: `MSG#${timestamp}#${payload.inboundMessageId}`,
      clinicId,
      direction: 'inbound',
      inboundMessageId: payload.inboundMessageId,
      originationNumber: normalizePhone(payload.originationNumber) || payload.originationNumber,
      destinationNumber: normalizePhone(payload.destinationNumber) || payload.destinationNumber,
      messageKeyword: payload.messageKeyword || undefined,
      messageBody: payload.messageBody || undefined,
      previousPublishedMessageId: payload.previousPublishedMessageId || undefined,
      status: 'received',
      timestamp,
      createdAt,
      ttl,
    },
  }));
}

async function sendSmsFromArn(args: { originationArn: string; to: string; body: string }): Promise<string | undefined> {
  const toNorm = normalizePhone(args.to);
  if (!toNorm) return undefined;

  const cmd = new SendTextMessageCommand({
    DestinationPhoneNumber: toNorm,
    MessageBody: args.body,
    OriginationIdentity: args.originationArn,
    MessageType: 'TRANSACTIONAL',
  });
  const resp = await smsClient.send(cmd);
  return resp?.MessageId;
}

async function trySendKeywordConfirmation(args: {
  clinicId: string | null;
  to: string;
  kind: 'stop' | 'start';
}): Promise<void> {
  const toNorm = normalizePhone(args.to);
  if (!toNorm) return;

  let originationArn = '';
  if (args.clinicId) {
    try {
      const cfg = await getClinicConfig(args.clinicId);
      originationArn = String(cfg?.smsOriginationArn || '').trim();
    } catch (err) {
      console.warn('[SmsIncoming] Failed to load clinic config for keyword confirmation (non-fatal):', err);
    }
  }
  if (!originationArn) originationArn = SMS_DEFAULT_ORIGINATION_ARN;
  if (!originationArn) return;

  const body =
    args.kind === 'stop'
      ? 'You are unsubscribed. Reply START to resubscribe.'
      : 'You are resubscribed. Reply STOP to unsubscribe.';

  try {
    await sendSmsFromArn({ originationArn, to: toNorm, body });
  } catch (err) {
    console.warn('[SmsIncoming] Failed to send keyword confirmation (non-fatal):', err);
  }
}

async function invokeAutoReply(payload: any): Promise<void> {
  if (!SMS_AUTO_REPLY_FUNCTION_ARN) return;
  await lambdaClient.send(new InvokeCommand({
    FunctionName: SMS_AUTO_REPLY_FUNCTION_ARN,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}

async function processRecord(record: SNSEventRecord): Promise<void> {
  const raw = record?.Sns?.Message || '';
  const payload = safeJsonParse<TwoWaySmsPayload>(raw);
  if (!payload || !payload.inboundMessageId) {
    console.warn('[SmsIncoming] Invalid two-way SMS payload - skipping', { messageId: record?.Sns?.MessageId });
    return;
  }

  if (!SMS_MESSAGES_TABLE) {
    console.error('[SmsIncoming] SMS_MESSAGES_TABLE not set - cannot process');
    return;
  }

  const inboundMessageId = String(payload.inboundMessageId || '').trim();
  const originationNumber = normalizePhone(payload.originationNumber) || payload.originationNumber;
  const destinationNumber = normalizePhone(payload.destinationNumber) || payload.destinationNumber;
  const messageBody = String(payload.messageBody || '').trim();

  if (!inboundMessageId || !originationNumber || !destinationNumber) {
    console.warn('[SmsIncoming] Missing required fields - skipping', { inboundMessageId, originationNumber, destinationNumber });
    return;
  }

  // Idempotency: SNS may deliver duplicates
  const firstTime = await markInboundIdempotency(inboundMessageId);
  if (!firstTime) {
    console.log('[SmsIncoming] Duplicate inboundMessageId - already processed', { inboundMessageId });
    return;
  }

  const timestamp = Date.now();

  let clinicId: string | null = null;
  try {
    const topicArn = normalizeTopicArn(String(record?.Sns?.TopicArn || ''));
    if (topicArn) {
      clinicId = await getClinicIdForTopicArn(topicArn);
    }

    // Fallback: if multiple clinics share a topic, or events come from a generic topic,
    // attempt to resolve clinic by destination number (our SMS number).
    if (!clinicId) {
      clinicId = await getClinicIdForDestination(destinationNumber);
    }
  } catch (err) {
    console.warn('[SmsIncoming] Failed to resolve clinic for inbound SMS (non-fatal):', err);
  }
  const effectiveClinicId = clinicId || 'unknown';

  try {
    // Store inbound message (best-effort, but we do want retries on failure)
    await storeInboundMessage({
      clinicId: effectiveClinicId,
      payload: {
        ...payload,
        originationNumber,
        destinationNumber,
        messageBody,
        inboundMessageId,
      },
      timestamp,
    });

    // STOP/START handling (updates unsubscribe preferences)
    if (UNSUBSCRIBE_TABLE && messageBody) {
      if (looksLikeOptOut(messageBody)) {
        await recordUnsubscribe(
          ddb,
          UNSUBSCRIBE_TABLE,
          { phone: originationNumber },
          'GLOBAL',
          ['SMS'],
          'STOP keyword',
          inboundMessageId
        );
        await trySendKeywordConfirmation({ clinicId, to: originationNumber, kind: 'stop' });
        return;
      }

      if (looksLikeOptIn(messageBody)) {
        await recordResubscribe(
          ddb,
          UNSUBSCRIBE_TABLE,
          { phone: originationNumber },
          'GLOBAL',
          ['SMS']
        );
        await trySendKeywordConfirmation({ clinicId, to: originationNumber, kind: 'start' });
        return;
      }
    }

    // Trigger async AI auto-reply (if configured)
    if (
      ENABLE_SMS_AUTO_REPLY &&
      SMS_AUTO_REPLY_FUNCTION_ARN &&
      messageBody &&
      clinicId // if we can't map a clinic, don't waste an AI invocation
    ) {
      await invokeAutoReply({
        clinicId,
        inboundMessageId,
        originationNumber,
        destinationNumber,
        messageKeyword: payload.messageKeyword,
        messageBody,
        previousPublishedMessageId: payload.previousPublishedMessageId,
        timestamp,
      });
    }
  } catch (err) {
    // Allow retries: release idempotency record and rethrow
    await releaseInboundIdempotency(inboundMessageId);
    throw err;
  }
}

export const handler = async (event: SNSEvent): Promise<void> => {
  if (!event?.Records?.length) return;

  const results = await Promise.allSettled(event.Records.map((r) => processRecord(r)));
  const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

  if (failures.length > 0) {
    console.error(`[SmsIncoming] ${failures.length} record(s) failed`, failures.map((f) => f.reason));
    // Throw to trigger SNS retry for failed records (idempotency prevents duplicate processing)
    throw failures[0]?.reason || new Error('SmsIncoming failed');
  }
};


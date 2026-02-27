/**
 * SMS Manual Reply Handler
 *
 * POST /sms/{clinicId}/reply
 *
 * Sends a manual SMS reply from the inbox when AI auto-messaging is turned off.
 * Stores the outbound message in SmsMessagesTable for the conversation thread.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getClinicConfig } from '../../shared/utils/secrets-helper';
import { buildCorsHeaders } from '../../shared/utils/cors';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const smsClient = new (PinpointSMSVoiceV2Client as any)({});

const SMS_MESSAGES_TABLE = process.env.SMS_MESSAGES_TABLE || '';
const SMS_DEFAULT_ORIGINATION_ARN = (process.env.SMS_DEFAULT_ORIGINATION_ARN || '').trim();
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || '';

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

const CONFIG_SK = 'CONFIG#AUTO_REPLY';

async function isAutoReplyEnabled(clinicId: string): Promise<boolean> {
  if (!SMS_MESSAGES_TABLE) return false;
  try {
    const resp = await ddb.send(new GetCommand({
      TableName: SMS_MESSAGES_TABLE,
      Key: { pk: `CLINIC#${clinicId}`, sk: CONFIG_SK },
    }));
    return resp.Item?.enabled === true;
  } catch {
    return false;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const clinicId = event.pathParameters?.clinicId;
    if (!clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing clinicId' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const to = normalizePhone(body.to);
    const message = String(body.message || '').trim();

    if (!to) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or missing "to" phone number' }),
      };
    }

    if (!message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Message body is required' }),
      };
    }

    if (message.length > 1600) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Message exceeds 1600 character limit' }),
      };
    }

    const autoReplyEnabled = await isAutoReplyEnabled(clinicId);
    if (autoReplyEnabled) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'AI auto-reply is enabled for this clinic. Disable it before sending manual replies.',
          autoReplyEnabled: true,
        }),
      };
    }

    let originationArn = '';
    try {
      const cfg = await getClinicConfig(clinicId);
      originationArn = String(cfg?.smsOriginationArn || '').trim();
    } catch (err) {
      console.warn('[SmsReply] Failed to load clinic config:', err);
    }
    if (!originationArn) originationArn = SMS_DEFAULT_ORIGINATION_ARN;

    if (!originationArn) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No SMS origination identity configured for this clinic' }),
      };
    }

    let clinicPhone = '';
    try {
      const cfg = await getClinicConfig(clinicId);
      clinicPhone = normalizePhone(String(cfg?.smsPhoneNumber || cfg?.phoneNumber || ''));
    } catch { /* ignore */ }

    const cmd = new SendTextMessageCommand({
      DestinationPhoneNumber: to,
      MessageBody: message,
      OriginationIdentity: originationArn,
      MessageType: 'TRANSACTIONAL',
    });

    const sendResult = await smsClient.send(cmd);
    const messageId = sendResult?.MessageId || `manual-${Date.now()}`;

    if (SMS_MESSAGES_TABLE) {
      const timestamp = Date.now();
      const createdAt = new Date(timestamp).toISOString();
      const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

      await ddb.send(new PutCommand({
        TableName: SMS_MESSAGES_TABLE,
        Item: {
          pk: `CLINIC#${clinicId}`,
          sk: `OUTBOUND#${timestamp}#${messageId}`,
          clinicId,
          direction: 'outbound',
          messageType: 'text',
          messageId,
          to,
          from: clinicPhone || 'clinic',
          body: message,
          status: 'sent',
          timestamp,
          createdAt,
          ttl,
          manualReply: true,
          dateKey: createdAt.split('T')[0],
          hourKey: new Date(timestamp).getUTCHours(),
        },
      }));
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        messageId,
        to,
        status: 'sent',
        timestamp: Date.now(),
      }),
    };
  } catch (error: any) {
    console.error('[SmsReply] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error?.message || 'Failed to send reply' }),
    };
  }
};

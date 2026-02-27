/**
 * SMS Conversations Handler
 *
 * Provides two operations for the SMS Inbox:
 *  1. GET /sms/{clinicId}/conversations          – list unique phone numbers with latest message
 *  2. GET /sms/{clinicId}/conversations/{phone}   – full conversation thread for a phone number
 *
 * Queries SmsMessagesTable (inbound + AI auto-reply outbound) and NotificationsTable
 * (manual outbound) to build a unified conversation view.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const SMS_MESSAGES_TABLE = process.env.SMS_MESSAGES_TABLE || '';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE || '';

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

interface UnifiedMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  phone: string;
  body: string;
  status: string;
  timestamp: number;
  createdAt: string;
  source: 'two-way' | 'notification';
  aiAgentId?: string;
  aiAgentName?: string;
  templateName?: string;
  recipientName?: string;
}

interface ConversationSummary {
  phone: string;
  lastMessage: string;
  lastTimestamp: number;
  lastDirection: 'inbound' | 'outbound';
  messageCount: number;
  unreadInbound: number;
  recipientName?: string;
}

async function querySmsMessagesTable(clinicId: string, phone?: string): Promise<UnifiedMessage[]> {
  if (!SMS_MESSAGES_TABLE) return [];

  const messages: UnifiedMessage[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const params: QueryCommandInput = {
      TableName: SMS_MESSAGES_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `CLINIC#${clinicId}` },
      FilterExpression: 'attribute_exists(direction)',
      ScanIndexForward: false,
      Limit: 500,
    };

    if (lastKey) params.ExclusiveStartKey = lastKey;

    const result = await ddb.send(new QueryCommand(params));
    lastKey = result.LastEvaluatedKey;

    for (const item of result.Items || []) {
      const direction = item.direction as 'inbound' | 'outbound';
      if (!direction) continue;

      const msgPhone = direction === 'inbound'
        ? normalizePhone(item.originationNumber)
        : normalizePhone(item.to);

      if (!msgPhone) continue;
      if (phone && msgPhone !== phone) continue;

      messages.push({
        id: item.inboundMessageId || item.messageId || item.sk || '',
        direction,
        phone: msgPhone,
        body: item.messageBody || item.body || '',
        status: item.status || 'unknown',
        timestamp: item.timestamp || new Date(item.createdAt || 0).getTime(),
        createdAt: item.createdAt || new Date(item.timestamp || 0).toISOString(),
        source: 'two-way',
        aiAgentId: item.aiAgentId,
        aiAgentName: item.aiAgentName,
      });
    }
  } while (lastKey);

  return messages;
}

async function queryNotificationsTable(clinicId: string, phone?: string): Promise<UnifiedMessage[]> {
  if (!NOTIFICATIONS_TABLE) return [];

  const messages: UnifiedMessage[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const params: QueryCommandInput = {
      TableName: NOTIFICATIONS_TABLE,
      IndexName: 'clinicId-sentAt-index',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':sms': 'SMS',
      },
      FilterExpression: '#type = :sms',
      ExpressionAttributeNames: { '#type': 'type' },
      ScanIndexForward: false,
      Limit: 500,
    };

    if (lastKey) params.ExclusiveStartKey = lastKey;

    const result = await ddb.send(new QueryCommand(params));
    lastKey = result.LastEvaluatedKey;

    for (const item of result.Items || []) {
      const msgPhone = normalizePhone(item.phone || item.recipientPhone);
      if (!msgPhone) continue;
      if (phone && msgPhone !== phone) continue;

      messages.push({
        id: item.notificationId || '',
        direction: 'outbound',
        phone: msgPhone,
        body: item.message || '',
        status: (item.status || 'sent').toLowerCase(),
        timestamp: item.sentAt ? new Date(item.sentAt).getTime() : 0,
        createdAt: item.sentAt || item.createdAt || '',
        source: 'notification',
        templateName: item.templateName,
        recipientName: item.recipientName,
      });
    }
  } while (lastKey);

  return messages;
}

function buildConversationsList(messages: UnifiedMessage[]): ConversationSummary[] {
  const byPhone = new Map<string, UnifiedMessage[]>();

  for (const msg of messages) {
    const existing = byPhone.get(msg.phone) || [];
    existing.push(msg);
    byPhone.set(msg.phone, existing);
  }

  const conversations: ConversationSummary[] = [];

  for (const [phone, msgs] of byPhone) {
    msgs.sort((a, b) => b.timestamp - a.timestamp);
    const latest = msgs[0];
    const inboundCount = msgs.filter(m => m.direction === 'inbound').length;
    const name = msgs.find(m => m.recipientName)?.recipientName;

    conversations.push({
      phone,
      lastMessage: latest.body || '(no message)',
      lastTimestamp: latest.timestamp,
      lastDirection: latest.direction,
      messageCount: msgs.length,
      unreadInbound: inboundCount,
      recipientName: name,
    });
  }

  conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return conversations;
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

    const phoneParam = event.pathParameters?.phone;

    if (phoneParam) {
      const phone = normalizePhone(decodeURIComponent(phoneParam));
      if (!phone) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid phone number' }),
        };
      }

      const [smsMessages, notifMessages] = await Promise.all([
        querySmsMessagesTable(clinicId, phone),
        queryNotificationsTable(clinicId, phone),
      ]);

      const allMessages = [...smsMessages, ...notifMessages];
      allMessages.sort((a, b) => a.timestamp - b.timestamp);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          phone,
          messages: allMessages,
          total: allMessages.length,
        }),
      };
    }

    const [smsMessages, notifMessages] = await Promise.all([
      querySmsMessagesTable(clinicId),
      queryNotificationsTable(clinicId),
    ]);

    const allMessages = [...smsMessages, ...notifMessages];
    const conversations = buildConversationsList(allMessages);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        conversations,
        totalConversations: conversations.length,
        totalMessages: allMessages.length,
      }),
    };
  } catch (error) {
    console.error('[GetSmsConversations] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to fetch conversations' }),
    };
  }
};

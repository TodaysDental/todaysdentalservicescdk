/**
 * RCS Status Callback Webhook Handler
 * 
 * Handles delivery status updates from Twilio for RCS messages sent via the API.
 * Twilio sends POST requests to this endpoint with message delivery status updates.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

interface TwilioRcsStatusCallback {
  MessageSid: string;
  AccountSid: string;
  From: string;
  To: string;
  MessageStatus: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  RcsSenderId?: string;
  ApiVersion?: string;
  // Additional status fields
  SmsStatus?: string;
  SmsSid?: string;
}

// RCS message status progression
const STATUS_PRIORITY: Record<string, number> = {
  'queued': 1,
  'sending': 2,
  'sent': 3,
  'delivered': 4,
  'read': 5,
  'failed': 10,
  'undelivered': 10,
};

/**
 * Validates Twilio signature to ensure request authenticity
 */
function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
    return true;
  }

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const computedSignature = crypto
    .createHmac('sha1', authToken)
    .update(data, 'utf8')
    .digest('base64');

  return computedSignature === signature;
}

/**
 * Parse form-urlencoded body from Twilio
 */
function parseFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  const pairs = body.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }
  return params;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('RCS Status Callback Event:', JSON.stringify(event, null, 2));

  const clinicId = event.pathParameters?.clinicId;
  if (!clinicId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing clinicId' }),
    };
  }

  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body || '';

    const params = parseFormBody(body);
    
    // Validate Twilio signature
    const twilioSignature = event.headers['X-Twilio-Signature'] || event.headers['x-twilio-signature'];
    const webhookUrl = `https://${event.headers.Host || event.headers.host}${event.path}`;
    
    if (TWILIO_AUTH_TOKEN && twilioSignature) {
      const isValid = validateTwilioSignature(TWILIO_AUTH_TOKEN, twilioSignature, webhookUrl, params);
      if (!isValid) {
        console.error('Invalid Twilio signature on status callback');
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Invalid signature' }),
        };
      }
    }

    const statusUpdate: TwilioRcsStatusCallback = {
      MessageSid: params.MessageSid || '',
      AccountSid: params.AccountSid || '',
      From: params.From || '',
      To: params.To || '',
      MessageStatus: params.MessageStatus || params.SmsStatus || '',
      ErrorCode: params.ErrorCode,
      ErrorMessage: params.ErrorMessage,
      RcsSenderId: params.RcsSenderId,
      ApiVersion: params.ApiVersion,
      SmsStatus: params.SmsStatus,
      SmsSid: params.SmsSid,
    };

    const timestamp = Date.now();
    const newStatus = statusUpdate.MessageStatus.toLowerCase();

    // Store the status update as a separate record for audit trail
    await ddb.send(new PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `STATUS#${statusUpdate.MessageSid}#${timestamp}`,
        clinicId,
        messageSid: statusUpdate.MessageSid,
        accountSid: statusUpdate.AccountSid,
        from: statusUpdate.From,
        to: statusUpdate.To,
        status: newStatus,
        errorCode: statusUpdate.ErrorCode,
        errorMessage: statusUpdate.ErrorMessage,
        rcsSenderId: statusUpdate.RcsSenderId,
        timestamp,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
      },
    }));

    // Try to update the original outbound message record with the new status
    // Query for the original message
    const queryResult = await ddb.send(new QueryCommand({
      TableName: RCS_MESSAGES_TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `CLINIC#${clinicId}`,
        ':sk': `OUTBOUND#`,
      },
      FilterExpression: 'messageSid = :msgSid',
      ExpressionAttributeNames: undefined,
    }));

    // Find the message to update
    for (const item of queryResult.Items || []) {
      if (item.messageSid === statusUpdate.MessageSid) {
        // Only update if new status is more advanced (or is an error)
        const currentPriority = STATUS_PRIORITY[item.status] || 0;
        const newPriority = STATUS_PRIORITY[newStatus] || 0;

        if (newPriority > currentPriority || newPriority === 10) {
          await ddb.send(new UpdateCommand({
            TableName: RCS_MESSAGES_TABLE,
            Key: {
              pk: item.pk,
              sk: item.sk,
            },
            UpdateExpression: 'SET #status = :status, lastStatusUpdate = :timestamp, errorCode = :errorCode, errorMessage = :errorMessage',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': newStatus,
              ':timestamp': timestamp,
              ':errorCode': statusUpdate.ErrorCode || null,
              ':errorMessage': statusUpdate.ErrorMessage || null,
            },
          }));
        }
        break;
      }
    }

    console.log(`RCS status update for clinic ${clinicId}: ${statusUpdate.MessageSid} -> ${newStatus}`);

    // Handle error statuses
    if (newStatus === 'failed' || newStatus === 'undelivered') {
      console.error(`RCS message failed for clinic ${clinicId}:`, {
        messageSid: statusUpdate.MessageSid,
        errorCode: statusUpdate.ErrorCode,
        errorMessage: statusUpdate.ErrorMessage,
      });

      // TODO: Implement error handling logic:
      // - Retry with SMS fallback
      // - Alert staff
      // - Log for analytics
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error processing RCS status callback:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};


/**
 * RCS Fallback Message Webhook Handler
 * 
 * Handles fallback requests from Twilio when the primary incoming message
 * webhook cannot be reached or encounters a runtime exception.
 * This ensures no messages are lost even during primary webhook failures.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

interface TwilioRcsFallbackMessage {
  MessageSid: string;
  AccountSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  RcsSenderId?: string;
  ProfileName?: string;
  ApiVersion?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

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
  console.log('RCS Fallback Message Event:', JSON.stringify(event, null, 2));

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
        console.error('Invalid Twilio signature on fallback');
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Invalid signature' }),
        };
      }
    }

    const message: TwilioRcsFallbackMessage = {
      MessageSid: params.MessageSid || '',
      AccountSid: params.AccountSid || '',
      From: params.From || '',
      To: params.To || '',
      Body: params.Body || '',
      NumMedia: params.NumMedia,
      MediaUrl0: params.MediaUrl0,
      MediaContentType0: params.MediaContentType0,
      RcsSenderId: params.RcsSenderId,
      ProfileName: params.ProfileName,
      ApiVersion: params.ApiVersion,
      ErrorCode: params.ErrorCode,
      ErrorMessage: params.ErrorMessage,
    };

    // Store the fallback message with special flag
    const timestamp = Date.now();
    const messageId = `${clinicId}#FALLBACK#${message.MessageSid}`;

    await ddb.send(new PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `FALLBACK#${timestamp}#${message.MessageSid}`,
        messageId,
        clinicId,
        direction: 'inbound',
        isFallback: true,
        messageSid: message.MessageSid,
        accountSid: message.AccountSid,
        from: message.From,
        to: message.To,
        body: message.Body,
        numMedia: message.NumMedia ? parseInt(message.NumMedia) : 0,
        mediaUrl: message.MediaUrl0,
        mediaContentType: message.MediaContentType0,
        rcsSenderId: message.RcsSenderId,
        profileName: message.ProfileName,
        errorCode: message.ErrorCode,
        errorMessage: message.ErrorMessage,
        status: 'received_fallback',
        timestamp,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
      },
    }));

    console.log(`RCS fallback message stored for clinic ${clinicId}:`, message.MessageSid);

    // Log the error that caused primary webhook to fail
    if (message.ErrorCode || message.ErrorMessage) {
      console.error(`Primary webhook failed - Error Code: ${message.ErrorCode}, Message: ${message.ErrorMessage}`);
    }

    // TODO: Send alert to operations team about fallback activation
    // This indicates the primary webhook had issues

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  } catch (error) {
    console.error('Error processing RCS fallback message:', error);
    
    // Even on error, try to return 200 to acknowledge receipt
    // Twilio will retry on non-2xx responses
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  }
};


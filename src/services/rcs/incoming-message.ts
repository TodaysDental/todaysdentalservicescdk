/**
 * RCS Incoming Message Webhook Handler
 * 
 * Handles incoming RCS messages from Twilio for each clinic.
 * Twilio sends POST requests to this endpoint when a patient sends an RCS message.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import crypto from 'crypto';
import { getTwilioCredentials } from '../../shared/utils/secrets-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const RCS_AUTO_REPLY_FUNCTION_ARN = process.env.RCS_AUTO_REPLY_FUNCTION_ARN || '';
const ENABLE_RCS_AUTO_REPLY = (process.env.ENABLE_RCS_AUTO_REPLY || 'true').toLowerCase() !== 'false';

// Twilio auth token cache (fetched from DynamoDB GlobalSecrets table)
let twilioAuthTokenCache: string | null = null;
let twilioAuthTokenCacheExpiry = 0;
const TWILIO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedTwilioAuthToken(): Promise<string | null> {
  if (twilioAuthTokenCache && Date.now() < twilioAuthTokenCacheExpiry) {
    return twilioAuthTokenCache;
  }
  
  const creds = await getTwilioCredentials();
  if (!creds) {
    console.warn('Twilio credentials not found in GlobalSecrets table');
    return null;
  }
  
  twilioAuthTokenCache = creds.authToken;
  twilioAuthTokenCacheExpiry = Date.now() + TWILIO_CACHE_TTL_MS;
  return creds.authToken;
}

interface TwilioRcsIncomingMessage {
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
  // Skip validation in development/testing
  if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
    return true;
  }

  // Build the data string for signature validation
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // Create HMAC SHA1 signature
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
  if (!body || body.trim() === '') return params;
  
  const pairs = body.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }
  return params;
}

/**
 * Parse JSON body (for testing via Postman)
 */
function parseJsonBody(body: string): Record<string, string> {
  try {
    const parsed = JSON.parse(body);
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined && value !== null) {
        params[key] = String(value);
      }
    }
    return params;
  } catch {
    return {};
  }
}

/**
 * Generate a unique message ID for testing
 */
function generateTestMessageSid(): string {
  return `TEST_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Idempotency: Twilio may retry webhooks on timeout/network issues.
 * We create a stable record keyed by MessageSid to prevent double-processing.
 */
async function markInboundIdempotency(clinicId: string, messageSid: string): Promise<boolean> {
  try {
    await ddb.send(new PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `INBOUND_SID#${messageSid}`,
        clinicId,
        messageSid,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return true;
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}

async function releaseInboundIdempotency(clinicId: string, messageSid: string): Promise<void> {
  try {
    await ddb.send(new DeleteCommand({
      TableName: RCS_MESSAGES_TABLE,
      Key: {
        pk: `CLINIC#${clinicId}`,
        sk: `INBOUND_SID#${messageSid}`,
      },
    }));
  } catch (err) {
    console.error('Failed to release inbound idempotency record (non-fatal):', err);
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('RCS Incoming Message Event:', JSON.stringify(event, null, 2));

  const clinicId = event.pathParameters?.clinicId;
  if (!clinicId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing clinicId' }),
    };
  }

  try {
    // Parse the incoming body (form-urlencoded from Twilio or JSON from testing)
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body || '';

    const contentType = event.headers['Content-Type'] || event.headers['content-type'] || '';
    
    // Parse based on content type
    let params: Record<string, string>;
    if (contentType.includes('application/json')) {
      params = parseJsonBody(rawBody);
    } else {
      params = parseFormBody(rawBody);
    }
    
    // Validate Twilio signature (skip for JSON/test requests)
    const twilioSignature = event.headers['X-Twilio-Signature'] || event.headers['x-twilio-signature'];
    const webhookUrl = `https://${event.headers.Host || event.headers.host}${event.path}`;
    
    if (twilioSignature && !contentType.includes('application/json')) {
      const twilioAuthToken = await getCachedTwilioAuthToken();
      if (twilioAuthToken) {
        const isValid = validateTwilioSignature(twilioAuthToken, twilioSignature, webhookUrl, params);
        if (!isValid) {
          console.error('Invalid Twilio signature');
          return {
            statusCode: 403,
            body: JSON.stringify({ error: 'Invalid signature' }),
          };
        }
      }
    }

    // Generate a test message SID if not provided (for testing)
    const messageSid = params.MessageSid || params.messageSid || generateTestMessageSid();

    // Idempotency guard - if we've already seen this MessageSid, just ACK
    const firstTime = await markInboundIdempotency(clinicId, messageSid);
    if (!firstTime) {
      console.log(`Duplicate Twilio inbound messageSid ${messageSid} for clinic ${clinicId} - ignoring`);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/xml',
        },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      };
    }

    const message: TwilioRcsIncomingMessage = {
      MessageSid: messageSid,
      AccountSid: params.AccountSid || params.accountSid || 'TEST_ACCOUNT',
      From: params.From || params.from || '+10000000000',
      To: params.To || params.to || '+10000000001',
      Body: params.Body || params.body || '',
      NumMedia: params.NumMedia || params.numMedia,
      MediaUrl0: params.MediaUrl0 || params.mediaUrl,
      MediaContentType0: params.MediaContentType0 || params.mediaContentType,
      RcsSenderId: params.RcsSenderId || params.rcsSenderId,
      ProfileName: params.ProfileName || params.profileName,
      ApiVersion: params.ApiVersion || params.apiVersion,
    };

    // Store the message in DynamoDB
    const timestamp = Date.now();
    const messageId = `${clinicId}#${message.MessageSid}`;

    // Build item, avoiding empty strings for GSI key attributes
    const item: Record<string, any> = {
      pk: `CLINIC#${clinicId}`,
      sk: `MSG#${timestamp}#${message.MessageSid}`,
      messageId,
      clinicId,
      direction: 'inbound',
      messageSid: message.MessageSid, // Always has a value now
      timestamp,
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
      status: 'received',
    };

    // Only add non-empty string values
    if (message.AccountSid) item.accountSid = message.AccountSid;
    if (message.From) item.from = message.From;
    if (message.To) item.to = message.To;
    if (message.Body) item.body = message.Body;
    if (message.NumMedia) item.numMedia = parseInt(message.NumMedia);
    if (message.MediaUrl0) item.mediaUrl = message.MediaUrl0;
    if (message.MediaContentType0) item.mediaContentType = message.MediaContentType0;
    if (message.RcsSenderId) item.rcsSenderId = message.RcsSenderId;
    if (message.ProfileName) item.profileName = message.ProfileName;

    try {
      await ddb.send(new PutCommand({
        TableName: RCS_MESSAGES_TABLE,
        Item: item,
      }));
    } catch (storeErr) {
      // If we fail to store the message, release the idempotency lock so Twilio retries can succeed.
      await releaseInboundIdempotency(clinicId, messageSid);
      throw storeErr;
    }

    console.log(`RCS message stored for clinic ${clinicId}:`, message.MessageSid);

    // Trigger async AI auto-reply (if configured)
    if (ENABLE_RCS_AUTO_REPLY && RCS_AUTO_REPLY_FUNCTION_ARN && message.Body?.trim()) {
      try {
        const payload = {
          clinicId,
          messageSid: message.MessageSid,
          from: message.From,
          to: message.To,
          body: message.Body,
          timestamp,
          profileName: message.ProfileName,
          rcsSenderId: message.RcsSenderId,
        };

        await lambdaClient.send(new InvokeCommand({
          FunctionName: RCS_AUTO_REPLY_FUNCTION_ARN,
          InvocationType: 'Event', // async
          Payload: Buffer.from(JSON.stringify(payload)),
        }));
      } catch (invokeErr) {
        console.error('Failed to invoke RCS auto-reply function (non-fatal):', invokeErr);
      }
    }

    // Return TwiML response (empty for RCS, just acknowledge receipt)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  } catch (error) {
    console.error('Error processing RCS incoming message:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};


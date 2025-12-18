/**
 * RCS Send Message Handler
 * 
 * Handles outbound RCS message sending via Twilio API.
 * This Lambda is called by internal services to send RCS messages to patients.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import https from 'https';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

interface SendRcsMessageRequest {
  clinicId: string;
  to: string;
  body: string;
  mediaUrl?: string;
  rcsSenderId?: string;
  statusCallback?: string;
  messagingServiceSid?: string;
}

interface TwilioMessageResponse {
  sid: string;
  status: string;
  error_code?: number;
  error_message?: string;
}

/**
 * Send RCS message via Twilio API
 */
async function sendTwilioRcsMessage(
  to: string,
  body: string,
  rcsSenderId: string,
  statusCallbackUrl: string,
  messagingServiceSid?: string,
  mediaUrl?: string
): Promise<TwilioMessageResponse> {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams();
    data.append('To', to);
    data.append('Body', body);
    
    if (messagingServiceSid) {
      data.append('MessagingServiceSid', messagingServiceSid);
    } else if (rcsSenderId) {
      data.append('From', rcsSenderId);
    }
    
    if (statusCallbackUrl) {
      data.append('StatusCallback', statusCallbackUrl);
    }
    
    if (mediaUrl) {
      data.append('MediaUrl', mediaUrl);
    }

    const postData = data.toString();
    
    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(responseBody);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
          } else {
            reject(new Error(`Twilio API error: ${response.message || responseBody}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Twilio response: ${responseBody}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('RCS Send Message Event:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const body: SendRcsMessageRequest = JSON.parse(event.body || '{}');
    const { clinicId, to, body: messageBody, mediaUrl, rcsSenderId, messagingServiceSid } = body;

    if (!clinicId || !to || !messageBody) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Missing required fields: clinicId, to, body',
        }),
      };
    }

    // Build status callback URL for this clinic
    const statusCallbackUrl = `https://apig.todaysdentalinsights.com/rcs/${clinicId}/status`;

    // Get clinic RCS configuration (in a real scenario, fetch from DynamoDB or config)
    const effectiveRcsSenderId = rcsSenderId || process.env[`RCS_SENDER_${clinicId.toUpperCase()}`] || '';

    if (!effectiveRcsSenderId && !messagingServiceSid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'No RCS sender ID or Messaging Service SID configured for this clinic',
        }),
      };
    }

    // Send via Twilio
    const twilioResponse = await sendTwilioRcsMessage(
      to,
      messageBody,
      effectiveRcsSenderId,
      statusCallbackUrl,
      messagingServiceSid,
      mediaUrl
    );

    const timestamp = Date.now();

    // Store the outbound message
    await ddb.send(new PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `OUTBOUND#${timestamp}#${twilioResponse.sid}`,
        messageId: `${clinicId}#${twilioResponse.sid}`,
        clinicId,
        direction: 'outbound',
        messageSid: twilioResponse.sid,
        to,
        body: messageBody,
        mediaUrl,
        rcsSenderId: effectiveRcsSenderId,
        messagingServiceSid,
        status: twilioResponse.status || 'queued',
        timestamp,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
      },
    }));

    console.log(`RCS message sent for clinic ${clinicId}:`, twilioResponse.sid);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        messageSid: twilioResponse.sid,
        status: twilioResponse.status,
      }),
    };
  } catch (error) {
    console.error('Error sending RCS message:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to send RCS message',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};


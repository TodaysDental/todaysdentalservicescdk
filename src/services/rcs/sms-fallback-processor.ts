/**
 * SMS Fallback Processor
 * 
 * Subscribes to the RCS Fallback SNS topic and sends SMS messages
 * when RCS message delivery fails or the primary webhook is unreachable.
 * 
 * This ensures patients receive notifications even when RCS is unavailable.
 */

import { SNSEvent, SNSEventRecord, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getClinicConfig } from '../../shared/utils/secrets-helper';

// Pinpoint SMS Voice V2 Client
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const smsClient = new (PinpointSMSVoiceV2Client as any)({});

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || 'TodaysDentalInsights-ClinicConfig';

/**
 * Fallback message structure from SNS
 */
interface RcsFallbackMessage {
  eventType: 'RCS_FALLBACK_RECEIVED';
  clinicId: string;
  messageSid: string;
  from: string;
  to: string;
  body: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: string;
  rawMessage: {
    MessageSid: string;
    AccountSid: string;
    From: string;
    To: string;
    Body: string;
    RcsSenderId?: string;
    ProfileName?: string;
    ErrorCode?: string;
    ErrorMessage?: string;
  };
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone: string): string | undefined {
  if (!phone) return undefined;
  
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^0-9+]/g, '');
  
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    if (digits.length < 7) return undefined;
    return `+${digits}`;
  }
  
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return undefined;
  
  // US/Canada numbers
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 7) return `+${digits}`;
  
  return undefined;
}

/**
 * Get clinic SMS origination identity (phone number or pool ARN)
 */
async function getClinicSmsOriginationArn(clinicId: string): Promise<string | undefined> {
  const config = await getClinicConfig(clinicId);
  return config?.smsOriginationArn;
}

/**
 * Send SMS via AWS Pinpoint SMS Voice V2
 */
async function sendSms(
  clinicId: string, 
  to: string, 
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const originationArn = await getClinicSmsOriginationArn(clinicId);
    
    if (!originationArn) {
      console.error(`No SMS origination ARN configured for clinic ${clinicId}`);
      return { success: false, error: 'No SMS origination ARN configured' };
    }
    
    const normalizedPhone = normalizePhone(to);
    if (!normalizedPhone) {
      console.error(`Invalid phone number: ${to}`);
      return { success: false, error: 'Invalid phone number format' };
    }
    
    const cmd = new SendTextMessageCommand({
      DestinationPhoneNumber: normalizedPhone,
      MessageBody: body,
      OriginationIdentity: originationArn,
      MessageType: 'TRANSACTIONAL',
    });
    
    const response = await smsClient.send(cmd);
    console.log(`SMS sent successfully to ${normalizedPhone}:`, response.MessageId);
    
    return { success: true, messageId: response.MessageId };
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Store fallback SMS record in DynamoDB for tracking
 */
async function storeFallbackSmsRecord(
  clinicId: string,
  originalMessageSid: string,
  to: string,
  body: string,
  smsResult: { success: boolean; messageId?: string; error?: string }
): Promise<void> {
  const timestamp = Date.now();
  
  await ddb.send(new PutCommand({
    TableName: RCS_MESSAGES_TABLE,
    Item: {
      pk: `CLINIC#${clinicId}`,
      sk: `SMS_FALLBACK#${timestamp}#${originalMessageSid}`,
      clinicId,
      direction: 'outbound',
      messageType: 'sms_fallback',
      originalRcsMessageSid: originalMessageSid,
      to,
      body,
      smsMessageId: smsResult.messageId,
      status: smsResult.success ? 'sent' : 'failed',
      error: smsResult.error,
      timestamp,
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
    },
  }));
}

/**
 * Process a single fallback message from SNS
 */
async function processFallbackMessage(record: SNSEventRecord): Promise<void> {
  console.log('Processing fallback message:', record.Sns.MessageId);
  
  let message: RcsFallbackMessage;
  try {
    message = JSON.parse(record.Sns.Message);
  } catch (error) {
    console.error('Failed to parse SNS message:', error);
    return;
  }
  
  // Only process RCS_FALLBACK_RECEIVED events
  if (message.eventType !== 'RCS_FALLBACK_RECEIVED') {
    console.log(`Ignoring event type: ${message.eventType}`);
    return;
  }
  
  const { clinicId, messageSid, from, body, errorCode, errorMessage } = message;
  
  console.log(`Processing RCS fallback for clinic ${clinicId}:`, {
    messageSid,
    from,
    errorCode,
    errorMessage,
  });
  
  // Prepare SMS fallback message
  // Note: For incoming messages that hit fallback, we may want to notify the clinic
  // rather than reply to the patient. This depends on your use case.
  
  // For now, we'll log the incoming message and optionally alert the clinic
  // If you want to send an auto-reply SMS to the patient when RCS fails:
  
  if (!from) {
    console.log('No sender phone number - skipping SMS fallback');
    return;
  }
  
  // Create a simple acknowledgment message
  // Customize this based on your business needs
  const smsBody = body 
    ? `We received your message: "${body.substring(0, 100)}${body.length > 100 ? '...' : ''}". We'll respond shortly.`
    : 'We received your message and will respond shortly.';
  
  // Send SMS fallback
  const smsResult = await sendSms(clinicId, from, smsBody);
  
  // Store the fallback record
  await storeFallbackSmsRecord(clinicId, messageSid, from, smsBody, smsResult);
  
  if (smsResult.success) {
    console.log(`SMS fallback sent successfully for message ${messageSid}`);
  } else {
    console.error(`SMS fallback failed for message ${messageSid}:`, smsResult.error);
  }
}

/**
 * Lambda handler for SNS events
 */
export const handler = async (event: SNSEvent, context: Context): Promise<void> => {
  console.log('SMS Fallback Processor Event:', JSON.stringify(event, null, 2));
  
  const results = await Promise.allSettled(
    event.Records.map(record => processFallbackMessage(record))
  );
  
  // Log any failures
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`${failures.length} message(s) failed to process:`, 
      failures.map(f => (f as PromiseRejectedResult).reason)
    );
  }
  
  console.log(`Processed ${event.Records.length} messages, ${failures.length} failures`);
};

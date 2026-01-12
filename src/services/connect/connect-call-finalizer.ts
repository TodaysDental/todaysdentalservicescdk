/**
 * Amazon Connect Call Finalizer
 * 
 * Invoked from an Amazon Connect Disconnect flow to finalize call analytics.
 * 
 * This Lambda:
 * - Derives callId from Connect ContactId
 * - Computes call duration
 * - Updates CallAnalyticsN1 with final status, duration, and outcome
 * - Optionally shortens TranscriptBuffer TTL
 * 
 * Uses the same schema as Chime/SMA calls for unified analytics.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE || '';
const TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME || '';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'AiAgentSessions';

// ========================================================================
// TYPES - Connect Lambda Event
// ========================================================================

/**
 * Connect invokes Lambdas with this structure from contact flows.
 * For disconnect flows, contactData includes disconnect reason.
 */
interface ConnectLambdaEvent {
  Details: {
    ContactData: {
      ContactId: string;
      InitialContactId?: string;
      Channel: 'VOICE' | 'CHAT' | 'TASK';
      InstanceARN: string;
      InitiationMethod: string;
      SystemEndpoint?: {
        Type: string;
        Address: string;
      };
      CustomerEndpoint?: {
        Type: string;
        Address: string;
      };
      Queue?: {
        Name: string;
        ARN: string;
      };
      Attributes?: Record<string, string>;
      InitiationTimestamp?: string;
      DisconnectTimestamp?: string;
      PreviousContactId?: string;
    };
    Parameters?: Record<string, string>;
  };
  Name?: string;
}

interface ConnectLambdaResponse {
  [key: string]: string;
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

/**
 * Find the analytics record for a Connect call
 */
async function findAnalyticsRecord(callId: string): Promise<{ callId: string; timestamp: number; record: any } | null> {
  if (!CALL_ANALYTICS_TABLE) {
    console.warn('[ConnectFinalizer] CALL_ANALYTICS_TABLE not configured');
    return null;
  }

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: CALL_ANALYTICS_TABLE,
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1,
    }));

    if (result.Items && result.Items.length > 0) {
      const record = result.Items[0];
      return {
        callId,
        timestamp: record.timestamp,
        record,
      };
    }

    return null;
  } catch (error) {
    console.error('[ConnectFinalizer] Error finding analytics record:', error);
    return null;
  }
}

/**
 * Finalize the analytics record with duration and outcome
 */
async function finalizeAnalytics(params: {
  callId: string;
  timestamp: number;
  callStartMs: number;
  disconnectReason?: string;
}): Promise<void> {
  if (!CALL_ANALYTICS_TABLE) return;

  const { callId, timestamp, callStartMs, disconnectReason } = params;
  const now = Date.now();
  const durationSec = Math.round((now - callStartMs) / 1000);

  try {
    await docClient.send(new UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Key: { callId, timestamp },
      UpdateExpression: `
        SET callStatus = :completed,
            outcome = :outcome,
            callEndTime = :endTime,
            duration = :duration,
            disconnectReason = :reason,
            lastActivityTime = :now
      `,
      ExpressionAttributeValues: {
        ':completed': 'completed',
        ':outcome': 'completed',
        ':endTime': new Date(now).toISOString(),
        ':duration': durationSec,
        ':reason': disconnectReason || 'customer_disconnect',
        ':now': new Date(now).toISOString(),
      },
    }));

    console.log('[ConnectFinalizer] Analytics finalized:', { callId, durationSec, disconnectReason });
  } catch (error) {
    console.error('[ConnectFinalizer] Error finalizing analytics:', error);
    throw error;
  }
}

/**
 * Shorten transcript buffer TTL (optional cleanup)
 */
async function shortenTranscriptTTL(callId: string): Promise<void> {
  if (!TRANSCRIPT_BUFFER_TABLE) return;

  const shortTTL = Math.floor(Date.now() / 1000) + (60 * 60); // 1 hour from now

  try {
    await docClient.send(new UpdateCommand({
      TableName: TRANSCRIPT_BUFFER_TABLE,
      Key: { callId },
      UpdateExpression: 'SET ttl = :ttl',
      ExpressionAttributeValues: { ':ttl': shortTTL },
      ConditionExpression: 'attribute_exists(callId)',
    }));
    console.log('[ConnectFinalizer] Shortened transcript TTL:', { callId });
  } catch (error: any) {
    if (error.name !== 'ConditionalCheckFailedException') {
      console.warn('[ConnectFinalizer] Error shortening transcript TTL:', error);
    }
  }
}

/**
 * Get session to retrieve call start time
 */
async function getSession(contactId: string): Promise<{ callStartMs: number } | null> {
  const sessionKey = `lex-${contactId}`;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: sessionKey },
    }));

    if (result.Item) {
      return { callStartMs: result.Item.callStartMs || Date.now() };
    }
    return null;
  } catch (error) {
    console.warn('[ConnectFinalizer] Error getting session:', error);
    return null;
  }
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (event: ConnectLambdaEvent): Promise<ConnectLambdaResponse> => {
  console.log('[ConnectFinalizer] Received event:', JSON.stringify(event, null, 2));

  const contactData = event.Details?.ContactData;
  if (!contactData) {
    console.error('[ConnectFinalizer] Missing ContactData');
    return { status: 'error', reason: 'Missing ContactData' };
  }

  const contactId = contactData.ContactId;
  const callId = `connect-${contactId}`;
  const disconnectReason = event.Details?.Parameters?.disconnectReason || 'unknown';

  // Find the analytics record
  const analyticsInfo = await findAnalyticsRecord(callId);
  if (!analyticsInfo) {
    console.warn('[ConnectFinalizer] No analytics record found for call:', callId);
    return { status: 'no_record', callId };
  }

  // Check if already finalized
  if (analyticsInfo.record.callStatus === 'completed') {
    console.log('[ConnectFinalizer] Call already finalized:', callId);
    return { status: 'already_finalized', callId };
  }

  // Get session for call start time
  const session = await getSession(contactId);
  const callStartMs = session?.callStartMs || analyticsInfo.record.timestamp;

  // Finalize the analytics
  await finalizeAnalytics({
    callId,
    timestamp: analyticsInfo.timestamp,
    callStartMs,
    disconnectReason,
  });

  // Optionally shorten transcript buffer TTL
  await shortenTranscriptTTL(callId);

  console.log('[ConnectFinalizer] Call finalized successfully:', {
    callId,
    durationSec: Math.round((Date.now() - callStartMs) / 1000),
    disconnectReason,
  });

  return {
    status: 'success',
    callId,
    duration: String(Math.round((Date.now() - callStartMs) / 1000)),
  };
};

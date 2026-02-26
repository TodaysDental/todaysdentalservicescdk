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
const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE || '';

type ScheduledCallFinalStatus = 'completed' | 'failed';
type ScheduledCallOutcome = 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed';

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
            totalDuration = :duration,
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

function mapDisconnectReasonToScheduledCall(disconnectReasonRaw: string | undefined): {
  status: ScheduledCallFinalStatus;
  outcome: ScheduledCallOutcome;
} {
  const reason = String(disconnectReasonRaw || '').trim().toUpperCase();

  if (reason.includes('BUSY')) {
    return { status: 'completed', outcome: 'busy' };
  }
  if (reason.includes('NO_ANSWER') || reason.includes('NOANSWER') || reason.includes('TIMEOUT')) {
    return { status: 'completed', outcome: 'no_answer' };
  }
  if (reason.includes('VOICEMAIL') || reason.includes('ANSWERING_MACHINE')) {
    return { status: 'completed', outcome: 'voicemail' };
  }
  if (reason.includes('ERROR') || reason.includes('FAILED')) {
    return { status: 'failed', outcome: 'failed' };
  }

  // Default: the customer answered and the conversation ended normally.
  return { status: 'completed', outcome: 'answered' };
}

async function finalizeScheduledCall(params: {
  scheduledCallId: string;
  connectContactId: string;
  analyticsCallId: string;
  durationSec: number;
  disconnectReason?: string;
}): Promise<void> {
  if (!SCHEDULED_CALLS_TABLE) return;

  const { scheduledCallId, connectContactId, analyticsCallId, durationSec, disconnectReason } = params;
  const nowIso = new Date().toISOString();
  const mapped = mapDisconnectReasonToScheduledCall(disconnectReason);

  try {
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId: scheduledCallId },
      UpdateExpression: `
        SET #status = :status,
            outcome = :outcome,
            endedAt = :endedAt,
            durationSec = :duration,
            disconnectReason = :reason,
            connectContactId = :contactId,
            analyticsCallId = :analyticsCallId,
            updatedAt = :now
      `,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': mapped.status,
        ':outcome': mapped.outcome,
        ':endedAt': nowIso,
        ':duration': durationSec,
        ':reason': disconnectReason || 'unknown',
        ':contactId': connectContactId,
        ':analyticsCallId': analyticsCallId,
        ':now': nowIso,
        ':in_progress': 'in_progress',
        ':scheduled': 'scheduled',
      },
      // Avoid overwriting terminal statuses (idempotency + safety)
      ConditionExpression: 'attribute_exists(callId) AND (#status = :in_progress OR #status = :scheduled)',
    }));

    console.log('[ConnectFinalizer] ScheduledCalls updated:', {
      scheduledCallId,
      status: mapped.status,
      outcome: mapped.outcome,
      durationSec,
      disconnectReason,
    });
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') {
      // Record does not exist or is already terminal/cancelled; ignore.
      console.log('[ConnectFinalizer] ScheduledCalls not updated (already final or missing):', {
        scheduledCallId,
      });
      return;
    }
    console.warn('[ConnectFinalizer] Failed to update ScheduledCalls:', {
      scheduledCallId,
      error: error?.message || String(error),
    });
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
  const contactAttributes = contactData.Attributes || {};
  const scheduledCallId = typeof contactAttributes.scheduledCallId === 'string'
    ? contactAttributes.scheduledCallId.trim()
    : '';

  // Compute start/end timestamps (prefer session; fall back to Connect timestamps)
  const session = await getSession(contactId);
  const initiationMs = contactData.InitiationTimestamp ? new Date(contactData.InitiationTimestamp).getTime() : NaN;
  const disconnectMs = contactData.DisconnectTimestamp ? new Date(contactData.DisconnectTimestamp).getTime() : NaN;
  const startMs = session?.callStartMs
    || (Number.isFinite(initiationMs) ? initiationMs : Date.now());
  const endMs = Number.isFinite(disconnectMs) ? disconnectMs : Date.now();
  const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));

  // Find the analytics record (optional; may not exist for busy/no-answer calls)
  const analyticsInfo = await findAnalyticsRecord(callId);

  if (analyticsInfo) {
    // Check if already finalized
    if (analyticsInfo.record.callStatus === 'completed') {
      console.log('[ConnectFinalizer] Call already finalized:', callId);
      // Still ensure ScheduledCalls is finalized (idempotent update)
    } else {
      // Finalize the analytics
      await finalizeAnalytics({
        callId,
        timestamp: analyticsInfo.timestamp,
        callStartMs: startMs,
        disconnectReason,
      });

      // Optionally shorten transcript buffer TTL
      await shortenTranscriptTTL(callId);
    }
  } else {
    console.warn('[ConnectFinalizer] No analytics record found for call (non-fatal):', callId);
  }

  // If this was an AI outbound scheduled call, finalize the ScheduledCalls record too.
  // Scheduler passes scheduledCallId as a Connect contact attribute.
  if (scheduledCallId) {
    await finalizeScheduledCall({
      scheduledCallId,
      connectContactId: contactId,
      analyticsCallId: callId,
      durationSec,
      disconnectReason,
    });
  }

  console.log('[ConnectFinalizer] Call finalized successfully:', {
    callId,
    durationSec,
    disconnectReason,
    scheduledCallId: scheduledCallId || undefined,
    hadAnalyticsRecord: !!analyticsInfo,
  });

  return {
    status: 'success',
    callId,
    duration: String(durationSec),
  };
};

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
      ScanIndexForward: false, // Most recent first (defensive; some callIds may have multiple rows)
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

function buildTranscriptArtifactsFromSegments(params: {
  segments: any[];
}): {
  latestTranscripts: Array<{ timestamp: number; speaker: 'AGENT' | 'CUSTOMER'; text: string; confidence?: number }>;
  latestTranscriptsTruncated: boolean;
  fullTranscript: string;
  fullTranscriptTruncated: boolean;
  segmentCount: number;
} {
  const MAX_LATEST_SEGMENTS = 400;
  const MAX_FULL_CHARS = 20000;

  const rawSegments = Array.isArray(params.segments) ? params.segments : [];

  const normalized = rawSegments
    .map((seg: any, idx: number) => {
      const rawSpeaker = String(seg?.speaker || 'CUSTOMER').toUpperCase();
      const speaker: 'AGENT' | 'CUSTOMER' =
        rawSpeaker === 'AGENT' || rawSpeaker === 'ASSISTANT' ? 'AGENT' : 'CUSTOMER';

      const timestamp =
        typeof seg?.startTime === 'number'
          ? seg.startTime
          : (typeof seg?.timestamp === 'number' ? seg.timestamp : idx);

      const text = String(seg?.content ?? seg?.text ?? seg?.message ?? '').trim();
      const confidence = typeof seg?.confidence === 'number' ? seg.confidence : undefined;

      return { timestamp, speaker, text, confidence };
    })
    .filter((t: any) => typeof t.text === 'string' && t.text.trim().length > 0);

  const segmentCount = normalized.length;

  const latestTranscriptsTruncated = normalized.length > MAX_LATEST_SEGMENTS;
  const latestTranscripts = latestTranscriptsTruncated
    ? normalized.slice(-MAX_LATEST_SEGMENTS)
    : normalized;

  const fullLines = normalized.map((t) => `${t.speaker}: ${t.text}`);
  let fullTranscript = fullLines.join('\n');
  let fullTranscriptTruncated = false;

  if (fullTranscript.length > MAX_FULL_CHARS) {
    fullTranscript = fullTranscript.substring(fullTranscript.length - MAX_FULL_CHARS);
    fullTranscriptTruncated = true;
  }

  return {
    latestTranscripts,
    latestTranscriptsTruncated,
    fullTranscript,
    fullTranscriptTruncated,
    segmentCount,
  };
}

async function persistTranscriptToAnalytics(params: {
  callId: string;
  timestamp: number;
  existingTranscriptCount?: number;
  hasTranscriptAlready?: boolean;
}): Promise<boolean> {
  if (!CALL_ANALYTICS_TABLE) return false;
  if (!TRANSCRIPT_BUFFER_TABLE) return false;

  const { callId, timestamp, existingTranscriptCount, hasTranscriptAlready } = params;

  if (hasTranscriptAlready) {
    return true;
  }

  const fetchBuffer = async (): Promise<any[]> => {
    const bufferResult = await docClient.send(new GetCommand({
      TableName: TRANSCRIPT_BUFFER_TABLE,
      Key: { callId },
    }));
    const buffer: any = bufferResult.Item;
    return Array.isArray(buffer?.segments) ? buffer.segments : [];
  };

  try {
    let segments = await fetchBuffer();

    // The lex-bedrock-hook writes transcript segments with fire-and-forget DynamoDB calls.
    // If the caller hangs up immediately after the last AI response, the finalizer may
    // run before those writes complete. Retry once after a short delay.
    if (segments.length === 0) {
      console.log('[ConnectFinalizer] Buffer empty on first read, retrying after delay:', { callId });
      await new Promise(r => setTimeout(r, 1500));
      segments = await fetchBuffer();
    }

    if (segments.length === 0) {
      console.log('[ConnectFinalizer] No transcript segments found to persist after retry:', { callId });
      return false;
    }

    const artifacts = buildTranscriptArtifactsFromSegments({ segments });

    const existingCount = typeof existingTranscriptCount === 'number' ? existingTranscriptCount : 0;
    const transcriptCount = Math.max(existingCount, artifacts.segmentCount);

    const nowIso = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Key: { callId, timestamp },
      UpdateExpression: `
        SET latestTranscripts = :latest,
            fullTranscript = :full,
            transcriptCount = :count,
            latestTranscriptsTruncated = :latestTrunc,
            fullTranscriptTruncated = :fullTrunc,
            transcriptPersistedAt = :now,
            updatedAt = :now,
            lastActivityTime = :now
      `,
      ExpressionAttributeValues: {
        ':latest': artifacts.latestTranscripts,
        ':full': artifacts.fullTranscript,
        ':count': transcriptCount,
        ':latestTrunc': artifacts.latestTranscriptsTruncated,
        ':fullTrunc': artifacts.fullTranscriptTruncated,
        ':now': nowIso,
      },
    }));

    console.log('[ConnectFinalizer] Persisted transcript into CallAnalytics:', {
      callId,
      timestamp,
      segmentCount: artifacts.segmentCount,
      latestTruncated: artifacts.latestTranscriptsTruncated,
      fullTruncated: artifacts.fullTranscriptTruncated,
    });
    return true;
  } catch (error: any) {
    console.warn('[ConnectFinalizer] Failed to persist transcript (non-fatal):', {
      callId,
      errorName: error?.name,
      errorMessage: error?.message,
    });
    return false;
  }
}

/**
 * Finalize the analytics record with duration and outcome
 */
async function finalizeAnalytics(params: {
  callId: string;
  timestamp: number;
  callStartMs: number;
  callEndMs: number;
  disconnectReason?: string;
  callerNumber?: string;
  dialedNumber?: string;
  patientName?: string;
}): Promise<void> {
  if (!CALL_ANALYTICS_TABLE) return;

  const { callId, timestamp, callStartMs, callEndMs, disconnectReason, callerNumber, dialedNumber, patientName } = params;
  const durationSec = Math.max(0, Math.round((callEndMs - callStartMs) / 1000));
  const nowIso = new Date(callEndMs).toISOString();

  try {
    const setItems = [
      'callStatus = :completed',
      'outcome = :outcome',
      'callEndTime = :endTime',
      'duration = :duration',
      'totalDuration = :duration',
      'disconnectReason = :reason',
      'lastActivityTime = :now',
      'updatedAt = :now',
    ];
    const exprValues: Record<string, any> = {
      ':completed': 'completed',
      ':outcome': 'completed',
      ':endTime': nowIso,
      ':duration': durationSec,
      ':reason': disconnectReason || 'customer_disconnect',
      ':now': nowIso,
    };

    if (callerNumber) {
      setItems.push(
        'callerNumber = if_not_exists(callerNumber, :caller)',
        'customerPhone = if_not_exists(customerPhone, :caller)',
      );
      exprValues[':caller'] = callerNumber;
    }
    if (dialedNumber) {
      setItems.push('dialedNumber = if_not_exists(dialedNumber, :dialed)');
      exprValues[':dialed'] = dialedNumber;
    }
    if (patientName) {
      setItems.push('patientName = if_not_exists(patientName, :patient)');
      exprValues[':patient'] = patientName;
    }

    await docClient.send(new UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Key: { callId, timestamp },
      UpdateExpression: `SET ${setItems.join(', ')}`,
      ExpressionAttributeValues: exprValues,
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

interface SessionData {
  callStartMs: number;
  callerNumber?: string;
  clinicId?: string;
  callDirection?: string;
  patientName?: string;
  aiAgentId?: string;
  aiAgentName?: string;
  purpose?: string;
}

async function getSession(contactId: string): Promise<SessionData | null> {
  const sessionKey = `lex-${contactId}`;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: sessionKey },
    }));

    if (result.Item) {
      return {
        callStartMs: result.Item.callStartMs || Date.now(),
        callerNumber: result.Item.callerNumber,
        clinicId: result.Item.clinicId,
        callDirection: result.Item.callDirection,
        patientName: result.Item.patientName,
        aiAgentId: result.Item.aiAgentId,
        aiAgentName: result.Item.aiAgentName,
        purpose: result.Item.purpose,
      };
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

  // Extract caller/dialed numbers from Connect contact data
  const callerNumber = contactData.CustomerEndpoint?.Address || '';
  const dialedNumber = contactData.SystemEndpoint?.Address || '';

  // Compute start/end timestamps (prefer session; fall back to Connect timestamps)
  const session = await getSession(contactId);
  const initiationMs = contactData.InitiationTimestamp ? new Date(contactData.InitiationTimestamp).getTime() : NaN;
  const disconnectMs = contactData.DisconnectTimestamp ? new Date(contactData.DisconnectTimestamp).getTime() : NaN;
  const startMs = session?.callStartMs
    || (Number.isFinite(initiationMs) ? initiationMs : Date.now());
  const endMs = Number.isFinite(disconnectMs) ? disconnectMs : Date.now();
  const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));

  const effectiveCallerNumber = session?.callerNumber || callerNumber;
  const effectivePatientName = session?.patientName || contactAttributes.patientName || '';

  // Find the analytics record (optional; may not exist for busy/no-answer calls)
  const analyticsInfo = await findAnalyticsRecord(callId);

  if (analyticsInfo) {
    const hasTranscriptAlready =
      (typeof analyticsInfo.record?.fullTranscript === 'string' && analyticsInfo.record.fullTranscript.trim().length > 0) ||
      (Array.isArray(analyticsInfo.record?.latestTranscripts) && analyticsInfo.record.latestTranscripts.length > 0);

    const alreadyFinalized = analyticsInfo.record.callStatus === 'completed';

    if (alreadyFinalized) {
      console.log('[ConnectFinalizer] Call already finalized:', callId);
    } else {
      await finalizeAnalytics({
        callId,
        timestamp: analyticsInfo.timestamp,
        callStartMs: startMs,
        callEndMs: endMs,
        disconnectReason,
        callerNumber: effectiveCallerNumber,
        dialedNumber,
        patientName: effectivePatientName,
      });
    }

    // Always attempt transcript persistence if transcript is missing, even on
    // duplicate invocations where callStatus is already 'completed'. The previous
    // invocation may have set the status but failed to persist the transcript
    // (e.g., TranscriptBuffersV2 was empty due to a race with fire-and-forget writes).
    let transcriptPersisted = hasTranscriptAlready;
    if (!hasTranscriptAlready) {
      transcriptPersisted = await persistTranscriptToAnalytics({
        callId,
        timestamp: analyticsInfo.timestamp,
        existingTranscriptCount: typeof analyticsInfo.record?.transcriptCount === 'number'
          ? analyticsInfo.record.transcriptCount
          : undefined,
        hasTranscriptAlready: false,
      });
    }

    // Only shorten buffer TTL after successful persistence (or if transcript was already present).
    // If persistence failed, keep the buffer alive so a retry can succeed.
    if (transcriptPersisted) {
      await shortenTranscriptTTL(callId);
    } else {
      console.log('[ConnectFinalizer] Skipping TTL shortening - transcript not yet persisted:', { callId });
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

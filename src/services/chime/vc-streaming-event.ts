/**
 * Voice Connector Streaming Event Handler
 *
 * Triggered by EventBridge events:
 *   detail-type: "Chime VoiceConnector Streaming Status"
 *   source: "aws.chime"
 *
 * We use the STARTED event to obtain the *actual* Kinesis Video Stream ARN and
 * start fragment number for the call leg. This is required because KVS stream
 * names are not predictable and DescribeStream by name is unreliable.
 *
 * For after-hours AI calls, we only start a Media Insights Pipeline for the
 * caller leg (detail.isCaller === true) to avoid transcribing our own TTS audio.
 */

import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { startMediaPipelineFromKvsStream, type VoiceParticipantRole } from './utils/media-pipeline-manager';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const START_MEDIA_PIPELINE_FROM_STREAMING_EVENT = process.env.START_MEDIA_PIPELINE_FROM_STREAMING_EVENT === 'true';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface VoiceConnectorStreamingStatusDetail {
  callId?: string; // Voice Connector call leg ID
  transactionId?: string; // Voice Connector transaction ID (matches SMA TransactionId in most cases)
  streamArn?: string; // Kinesis Video Stream ARN
  startFragmentNumber?: string;
  voiceConnectorId?: string;
  streamingStatus?: 'STARTED' | 'ENDED' | 'UPDATED' | 'FAILED' | string;
  isCaller?: boolean;
  direction?: string;
  fromNumber?: string;
  toNumber?: string;
  startTime?: string;
  mediaType?: string;
}

async function findCallRecord(transactionId: string, vcCallId?: string): Promise<any | null> {
  // Fast path: query by SMA transaction ID (stored as callId)
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :id',
      ExpressionAttributeValues: { ':id': transactionId },
      Limit: 1,
    }));

    if (result.Items?.[0]) return result.Items[0];
  } catch (err: any) {
    console.warn('[VcStreamingEvent] Query by callId-index failed:', err?.message || err);
  }

  // Fallback: query by PSTN leg call id (if stored)
  if (vcCallId) {
    try {
      const result = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'pstnCallId-index',
        KeyConditionExpression: 'pstnCallId = :pid',
        ExpressionAttributeValues: { ':pid': vcCallId },
        Limit: 1,
      }));

      if (result.Items?.[0]) return result.Items[0];
    } catch (err: any) {
      console.warn('[VcStreamingEvent] Query by pstnCallId-index failed:', err?.message || err);
    }
  }

  return null;
}

export const handler = async (
  event: EventBridgeEvent<'Chime VoiceConnector Streaming Status', VoiceConnectorStreamingStatusDetail>
): Promise<void> => {
  const detail = event.detail || {};
  const streamingStatus = detail.streamingStatus;

  // Always log a compact summary for debugging (these events are critical for real-time AI).
  console.log('[VcStreamingEvent] Event received', {
    streamingStatus,
    transactionId: detail.transactionId,
    vcCallId: detail.callId,
    voiceConnectorId: detail.voiceConnectorId,
    isCaller: detail.isCaller,
    direction: detail.direction,
    fromNumber: detail.fromNumber,
    toNumber: detail.toNumber,
    startFragmentNumber: detail.startFragmentNumber,
    streamArn: detail.streamArn,
    region: event.region,
    time: event.time,
  });

  const transactionId = detail.transactionId;
  const streamArn = detail.streamArn;
  const startFragmentNumber = detail.startFragmentNumber;
  const vcCallId = detail.callId;

  if (streamingStatus !== 'STARTED' && streamingStatus !== 'FAILED') {
    return;
  }

  if (!transactionId) {
    console.warn('[VcStreamingEvent] Missing transactionId in streaming event', { streamingStatus, vcCallId, streamArn });
    return;
  }

  // For after-hours AI calls, only process the caller leg to avoid transcribing TTS.
  // If isCaller is absent, proceed (some integrations may omit it).
  if (streamingStatus === 'STARTED' && detail.isCaller === false) {
    console.log('[VcStreamingEvent] Ignoring non-caller stream for STARTED event', {
      transactionId,
      vcCallId,
      streamArn,
    });
    return;
  }

  // Calls can start streaming before the SMA Lambda writes the call record; retry briefly.
  let callRecord: any | null = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    callRecord = await findCallRecord(transactionId, vcCallId);
    if (callRecord) break;
    await sleep(250);
  }

  if (!callRecord) {
    console.warn('[VcStreamingEvent] Call record not found for streaming STARTED event (skipping)', {
      transactionId,
      vcCallId,
      streamArn,
    });
    return;
  }

  if (!callRecord.isAiCall) {
    // Only start pipelines for AI calls in this handler.
    return;
  }

  // If the call has already switched to DTMF fallback, do not start a media pipeline.
  // This avoids unnecessary cost and prevents late-start pipelines from confusing the call flow.
  if (streamingStatus === 'STARTED' && (callRecord.useDtmfFallback || callRecord.pipelineStatus === 'fallback')) {
    console.log('[VcStreamingEvent] Call is in DTMF fallback; skipping pipeline start', {
      transactionId,
      vcCallId,
      pipelineStatus: callRecord.pipelineStatus,
      useDtmfFallback: callRecord.useDtmfFallback,
    });
    return;
  }

  // If streaming failed, immediately flip the call into DTMF fallback to avoid silence.
  if (streamingStatus === 'FAILED') {
    try {
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: 'SET pipelineStatus = :status, transcriptionEnabled = :f, useDtmfFallback = :t, pipelineError = :err',
        ExpressionAttributeValues: {
          ':status': 'failed',
          ':f': false,
          ':t': true,
          ':err': JSON.stringify({ streamingStatus, detail }),
        },
      }));
    } catch (err: any) {
      console.warn('[VcStreamingEvent] Failed to mark call for DTMF fallback after streaming FAILED:', err?.message || err);
    }
    return;
  }

  if (!streamArn) {
    console.warn('[VcStreamingEvent] Missing streamArn for STARTED event', { transactionId, vcCallId });
    return;
  }

  // Always store the stream details for debugging/troubleshooting (best-effort).
  try {
    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
      UpdateExpression: 'SET kvsStreamArn = :kvsArn, kvsStartFragmentNumber = :frag, vcCallId = :vcCallId, vcStreamingStartTime = :vcStart',
      ExpressionAttributeValues: {
        ':kvsArn': streamArn,
        ':frag': startFragmentNumber || '',
        ':vcCallId': vcCallId || '',
        ':vcStart': detail.startTime || new Date().toISOString(),
      },
    }));
  } catch (err: any) {
    console.warn('[VcStreamingEvent] Failed to persist stream details (non-fatal):', err?.message || err);
  }

  // If the Voice Connector is already configured with MediaInsightsConfiguration (VC-managed call analytics),
  // do NOT create an additional Media Insights Pipeline here (it would duplicate cost and can create feedback loops).
  if (!START_MEDIA_PIPELINE_FROM_STREAMING_EVENT) {
    return;
  }

  if (callRecord.mediaPipelineId || callRecord.pipelineStatus === 'active') {
    console.log('[VcStreamingEvent] Pipeline already active for call, skipping', {
      transactionId,
      mediaPipelineId: callRecord.mediaPipelineId,
      pipelineStatus: callRecord.pipelineStatus,
    });
    return;
  }

  const participantRole: VoiceParticipantRole = 'CUSTOMER';

  const pipelineId = await startMediaPipelineFromKvsStream({
    callId: transactionId,
    meetingId: transactionId, // not a meeting; used for tags/metadata consistency
    clinicId: callRecord.clinicId,
    agentId: callRecord.aiAgentId || callRecord.assignedAgentId || '',
    customerPhone: callRecord.phoneNumber || callRecord.from || detail.fromNumber || '',
    direction: (callRecord.direction as any) || 'inbound',
    isAiCall: true,
    aiSessionId: callRecord.aiSessionId,
    kvsStreamArn: streamArn,
    startFragmentNumber,
    participantRole,
    mediaSampleRate: 8000,
  });

  const update = async (status: 'active' | 'failed', extra?: Record<string, any>) => {
    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: {
        clinicId: callRecord!.clinicId,
        queuePosition: callRecord!.queuePosition,
      },
      UpdateExpression: [
        'SET pipelineStatus = :status',
        'kvsStreamArn = :kvsArn',
        'kvsStartFragmentNumber = :frag',
        'vcCallId = :vcCallId',
        'vcStreamingStartTime = :vcStart',
        ...(status === 'active' ? ['mediaPipelineId = :pid', 'transcriptionEnabled = :t', 'useDtmfFallback = :f'] : ['transcriptionEnabled = :f2', 'useDtmfFallback = :t2']),
        ...(extra?.pipelineError ? ['pipelineError = :perr'] : []),
      ].join(', '),
      ExpressionAttributeValues: {
        ':status': status,
        ':kvsArn': streamArn,
        ':frag': startFragmentNumber || '',
        ':vcCallId': vcCallId || '',
        ':vcStart': detail.startTime || new Date().toISOString(),
        ...(status === 'active'
          ? { ':pid': pipelineId, ':t': true, ':f': false }
          : { ':f2': false, ':t2': true }),
        ...(extra?.pipelineError ? { ':perr': extra.pipelineError } : {}),
      },
    }));
  };

  if (pipelineId) {
    console.log('[VcStreamingEvent] Started Media Insights Pipeline for AI call', {
      transactionId,
      pipelineId,
      streamArn,
      startFragmentNumber,
      vcCallId,
    });
    await update('active');
  } else {
    console.warn('[VcStreamingEvent] Failed to start Media Insights Pipeline for AI call; enabling DTMF fallback', {
      transactionId,
      streamArn,
      startFragmentNumber,
      vcCallId,
    });
    await update('failed', { pipelineError: 'CreateMediaInsightsPipeline returned null' });
  }
};



/**
 * FIX #48, #49, #50: Recording Processing Lambda
 * 
 * Processes call recordings from S3 with:
 * - Idempotent processing (Fix #49)
 * - Automatic transcription with unique job names (Fix #50)
 * - Metadata storage and call record updates
 */

import { S3Event, S3EventRecord } from 'aws-lambda';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { 
  processRecordingIdempotent, 
  startTranscription,
  RecordingMetadata 
} from '../shared/utils/recording-manager';
import { getErrorTracker } from '../shared/utils/error-tracker';
import { extractCallMetrics, trackCallCompletion } from '../shared/utils/agent-performance-tracker';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { isPushNotificationsEnabled, sendRecordingReadyToAgent } from './utils/push-notifications';

const ddb = getDynamoDBClient();
const errorTracker = getErrorTracker();

const RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME!;
const RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET_NAME!;
const AUTO_TRANSCRIBE = process.env.AUTO_TRANSCRIBE_RECORDINGS === 'true';

export const handler = async (event: S3Event): Promise<void> => {
  console.log(`[RecordingProcessor] Processing ${event.Records.length} S3 events`);

  for (const record of event.Records) {
    try {
      await processRecordingEvent(record);
    } catch (err) {
      console.error('[RecordingProcessor] Error processing recording:', err);
      await errorTracker.trackError(
        'process_recording',
        err as Error,
        'HIGH',
        { 
          bucket: record.s3.bucket.name,
          key: record.s3.object.key
        }
      );
      // Don't throw - continue processing other recordings
    }
  }

  await errorTracker.flush();
};

async function processRecordingEvent(record: S3EventRecord): Promise<void> {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  console.log(`[RecordingProcessor] Processing recording: s3://${bucket}/${key}`);

  // Only process files in the recordings/ prefix
  if (!key.startsWith('recordings/')) {
    console.log('[RecordingProcessor] Skipping non-recording file:', key);
    return;
  }

  // Skip transcription output files
  if (key.includes('/transcriptions/')) {
    console.log('[RecordingProcessor] Skipping transcription output:', key);
    return;
  }

  // Process recording with idempotency
  const metadata = await processRecordingIdempotent(
    ddb,
    RECORDING_METADATA_TABLE,
    CALL_QUEUE_TABLE_NAME,
    bucket,
    key
  );

  if (!metadata) {
    console.warn('[RecordingProcessor] Could not process recording metadata');
    return;
  }

  // Start transcription if enabled
  if (AUTO_TRANSCRIBE && metadata.fileSize && metadata.fileSize > 0) {
    try {
      // Get custom vocabulary name from environment
      const vocabularyName = process.env.MEDICAL_VOCABULARY_NAME;
      const enableLanguageId = process.env.ENABLE_LANGUAGE_IDENTIFICATION === 'true';
      
      await startTranscription(
        ddb,
        RECORDING_METADATA_TABLE,
        metadata,
        RECORDINGS_BUCKET,
        {
          vocabularyName,
          identifyLanguage: enableLanguageId,
          languageOptions: ['en-US', 'es-US', 'fr-CA'], // English, Spanish, French
        }
      );
    } catch (err) {
      console.error('[RecordingProcessor] Transcription failed:', err);
      await errorTracker.trackError(
        'start_transcription',
        err as Error,
        'MEDIUM',
        { recordingId: metadata.recordingId }
      );
      // Don't throw - transcription failure is not critical
    }
  }

  // Track agent performance if agent is assigned
  if (metadata.agentId) {
    try {
      // Get call record to extract full metrics
      // RecordingMetadata.callId is the analytics TransactionId; CallQueue lookup needs the PSTN leg callId.
      const callRecord = await getCallRecord(metadata.pstnCallId || metadata.callId);
      
      if (callRecord) {
        const callMetrics = extractCallMetrics(callRecord);
        
        if (callMetrics) {
          // **FIXED: Extract sentiment data from call record if available**
          const sentiment = callRecord.overallSentiment && callRecord.averageSentiment ? {
            sentiment: callRecord.overallSentiment,
            score: callRecord.averageSentiment
          } : undefined;
          
          await trackCallCompletion(
            ddb,
            AGENT_PERFORMANCE_TABLE_NAME,
            callMetrics,
            sentiment // Pass sentiment data
          );
          console.log('[RecordingProcessor] Updated agent performance for:', {
            agentId: metadata.agentId,
            hasSentiment: !!sentiment
          });
        }
      }
    } catch (err) {
      console.error('[RecordingProcessor] Failed to track agent performance:', err);
      // Don't throw - performance tracking is not critical
    }
  }

  // Push notification: notify the agent that their recording is ready
  if (metadata.agentId && isPushNotificationsEnabled()) {
    const callRecord = metadata.pstnCallId ? await getCallRecord(metadata.pstnCallId) : null;
    sendRecordingReadyToAgent({
      callId: metadata.callId,
      clinicId: callRecord?.clinicId || '',
      clinicName: callRecord?.clinicName || '',
      agentId: metadata.agentId,
      recordingId: metadata.recordingId,
      durationSeconds: metadata.durationSeconds,
      hasTranscription: AUTO_TRANSCRIBE,
      timestamp: new Date().toISOString(),
    }).catch(err => console.warn('[RecordingProcessor] Recording-ready push failed (non-fatal):', err.message));
  }

  console.log('[RecordingProcessor] Recording processed successfully:', metadata.recordingId);
}

/**
 * Get call record by pstnCallId
 */
async function getCallRecord(pstnCallId: string): Promise<any | null> {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: 'pstnCallId-index',
      KeyConditionExpression: 'pstnCallId = :pstnCallId',
      ExpressionAttributeValues: {
        ':pstnCallId': pstnCallId,
      },
      Limit: 1,
    }));

    return result.Items?.[0] || null;
  } catch (err) {
    console.error('[RecordingProcessor] Error getting call record:', err);
    return null;
  }
}

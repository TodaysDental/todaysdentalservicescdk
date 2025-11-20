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

const ddb = getDynamoDBClient();
const errorTracker = getErrorTracker();

const RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
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
      await startTranscription(
        ddb,
        RECORDING_METADATA_TABLE,
        metadata,
        RECORDINGS_BUCKET
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

  console.log('[RecordingProcessor] Recording processed successfully:', metadata.recordingId);
}

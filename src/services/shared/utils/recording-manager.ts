/**
 * FIX #48: Recording Started Before Agent Joins
 * FIX #49: Multiple Recordings Per Call
 * FIX #50: Transcription Job Name Collision
 * 
 * Manages call recording lifecycle with proper timing and deduplication
 */

import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { 
  TranscribeClient, 
  StartTranscriptionJobCommand, 
  GetTranscriptionJobCommand 
} from '@aws-sdk/client-transcribe';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const transcribe = new TranscribeClient({});
const s3 = new S3Client({});

export type RecordingState = 
  | 'WAITING_FOR_AGENT' 
  | 'ACTIVE' 
  | 'COMPLETED' 
  | 'FAILED';

/**
 * Recording metadata stored in DynamoDB
 */
export interface RecordingMetadata {
  recordingId: string;
  timestamp: number;
  callId: string;
  clinicId: string;
  s3Bucket: string;
  s3Key: string;
  fileSize?: number;
  format?: string;
  uploadedAt: string;
  agentId?: string;
  duration?: number;
  transcriptionJobName?: string;
  transcriptionStatus?: string;
  transcriptionStartedAt?: string;
  transcriptionCompletedAt?: string;
  transcriptionError?: string;
  ttl: number;
}

/**
 * FIX #48: Start recording only after agent joins
 * Updates call record to track recording state
 */
export async function markRecordingWaitingForAgent(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  clinicId: string,
  queuePosition: number
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { clinicId, queuePosition },
    UpdateExpression: 'SET customerJoinedAt = :now, recordingState = :waiting',
    ExpressionAttributeValues: {
      ':now': new Date().toISOString(),
      ':waiting': 'WAITING_FOR_AGENT' as RecordingState
    }
  }));
}

/**
 * FIX #48: Mark recording as active when agent joins
 */
export async function markRecordingActive(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  clinicId: string,
  queuePosition: number
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: { clinicId, queuePosition },
    UpdateExpression: `
      SET agentJoinedAt = :now, 
          recordingState = :active, 
          recordingStartedAt = :now
    `,
    ConditionExpression: 'recordingState = :waiting',
    ExpressionAttributeValues: {
      ':now': new Date().toISOString(),
      ':active': 'ACTIVE' as RecordingState,
      ':waiting': 'WAITING_FOR_AGENT' as RecordingState
    }
  }));
}

/**
 * FIX #49: Generate deterministic recording ID to prevent duplicates
 */
export function generateRecordingId(callId: string, s3Key: string): string {
  const hash = createHash('sha256')
    .update(`${callId}:${s3Key}`)
    .digest('hex')
    .substring(0, 16);
  
  return `rec-${callId}-${hash}`;
}

/**
 * Extract call ID from S3 key path
 */
export function extractCallIdFromKey(key: string): string | null {
  // Expected format: recordings/YYYY-MM-DD/{callId}/recording.wav
  const match = key.match(/recordings\/[^/]+\/([^/]+)\//);
  return match ? match[1] : null;
}

/**
 * FIX #49: Process recording with idempotency
 * Ensures recordings are only processed once even if S3 event triggers multiple times
 */
export async function processRecordingIdempotent(
  ddb: DynamoDBDocumentClient,
  metadataTableName: string,
  callQueueTableName: string,
  bucket: string,
  key: string
): Promise<RecordingMetadata | null> {
  const callId = extractCallIdFromKey(key);
  
  if (!callId) {
    console.error('[RecordingManager] Cannot extract callId from key:', key);
    return null;
  }

  // Generate deterministic recording ID
  const recordingId = generateRecordingId(callId, key);

  // Check if already processed (idempotency check)
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: metadataTableName,
      Key: { recordingId }
    }));

    if (Item) {
      console.log('[RecordingManager] Recording already processed:', recordingId);
      return Item as RecordingMetadata;
    }
  } catch (err) {
    // Continue if not found
  }

  // Get object metadata from S3
  const headResult = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const fileSize = headResult.ContentLength || 0;

  // Get call record to enrich metadata
  const callRecord = await findCallByCallId(ddb, callQueueTableName, callId);
  
  const timestamp = callRecord?.queueEntryTime 
    ? new Date(callRecord.queueEntryTime).getTime()
    : Date.now();

  // Store metadata with idempotent put
  const metadata: RecordingMetadata = {
    recordingId,
    timestamp,
    callId,
    clinicId: callRecord?.clinicId || 'unknown',
    s3Bucket: bucket,
    s3Key: key,
    fileSize,
    format: headResult.ContentType || 'audio/wav',
    uploadedAt: new Date().toISOString(),
    agentId: callRecord?.assignedAgentId,
    ttl: Math.floor(Date.now() / 1000) + (2555 * 24 * 60 * 60) // 7 years retention
  };

  try {
    await ddb.send(new PutCommand({
      TableName: metadataTableName,
      Item: metadata,
      ConditionExpression: 'attribute_not_exists(recordingId)'
    }));

    console.log('[RecordingManager] Stored recording metadata:', recordingId);

    // Update call record with recording reference
    if (callRecord) {
      await ddb.send(new UpdateCommand({
        TableName: callQueueTableName,
        Key: {
          clinicId: callRecord.clinicId,
          queuePosition: callRecord.queuePosition
        },
        UpdateExpression: 'ADD recordingIds :recordingId SET recordingCompleted = :true',
        ExpressionAttributeValues: {
          ':recordingId': new Set([recordingId]),
          ':true': true
        }
      }));
    }

    return metadata;

  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log('[RecordingManager] Duplicate prevented:', recordingId);
      // Fetch and return existing metadata
      const { Item } = await ddb.send(new GetCommand({
        TableName: metadataTableName,
        Key: { recordingId }
      }));
      return Item as RecordingMetadata;
    }
    throw err;
  }
}

/**
 * Helper to find call record by callId
 */
async function findCallByCallId(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  callId: string
): Promise<any | null> {
  try {
    const result = await ddb.send({
      TableName: tableName,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1
    } as any);

    return result.Items?.[0] || null;
  } catch (err) {
    console.error('[RecordingManager] Error finding call:', err);
    return null;
  }
}

/**
 * FIX #50: Start transcription with unique job name
 * Uses UUID to prevent job name collisions on retries
 */
export async function startTranscription(
  ddb: DynamoDBDocumentClient,
  metadataTableName: string,
  metadata: RecordingMetadata,
  outputBucket: string
): Promise<void> {
  // Generate unique job name with UUID to prevent collisions
  const jobName = `transcription-${metadata.callId}-${randomUUID().substring(0, 8)}`;

  console.log('[RecordingManager] Starting transcription:', jobName);

  try {
    await transcribe.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US', // TODO: Make configurable based on clinic
      MediaFormat: 'wav',
      Media: {
        MediaFileUri: `s3://${metadata.s3Bucket}/${metadata.s3Key}`
      },
      OutputBucketName: outputBucket,
      OutputKey: `transcriptions/${metadata.callId}/${jobName}/`,
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2,
        ChannelIdentification: true
      },
      // Add tags for tracking
      Tags: [
        { Key: 'callId', Value: metadata.callId },
        { Key: 'recordingId', Value: metadata.recordingId },
        { Key: 'clinicId', Value: metadata.clinicId }
      ]
    }));

    // Update metadata with transcription job info
    await ddb.send(new UpdateCommand({
      TableName: metadataTableName,
      Key: { recordingId: metadata.recordingId },
      UpdateExpression: `
        SET transcriptionJobName = :jobName, 
            transcriptionStatus = :status, 
            transcriptionStartedAt = :now
      `,
      ExpressionAttributeValues: {
        ':jobName': jobName,
        ':status': 'IN_PROGRESS',
        ':now': new Date().toISOString()
      }
    }));

    console.log('[RecordingManager] Transcription job started:', jobName);

  } catch (err: any) {
    // Handle specific transcription errors
    if (err.name === 'ConflictException') {
      console.warn('[RecordingManager] Transcription job already exists:', jobName);
      // Job already running - that's OK, just update status
      return;
    }

    console.error('[RecordingManager] Transcription failed:', err);

    // Update metadata with error
    await ddb.send(new UpdateCommand({
      TableName: metadataTableName,
      Key: { recordingId: metadata.recordingId },
      UpdateExpression: 'SET transcriptionStatus = :status, transcriptionError = :error',
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':error': err.message
      }
    }));

    throw err;
  }
}

/**
 * Check transcription job status and update metadata
 */
export async function checkTranscriptionStatus(
  ddb: DynamoDBDocumentClient,
  metadataTableName: string,
  recordingId: string,
  jobName: string
): Promise<string> {
  try {
    const result = await transcribe.send(new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    }));

    const status = result.TranscriptionJob?.TranscriptionJobStatus || 'UNKNOWN';

    // Update metadata
    const updateExpr = status === 'COMPLETED'
      ? 'SET transcriptionStatus = :status, transcriptionCompletedAt = :now'
      : 'SET transcriptionStatus = :status';

    await ddb.send(new UpdateCommand({
      TableName: metadataTableName,
      Key: { recordingId },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: {
        ':status': status,
        ...(status === 'COMPLETED' ? { ':now': new Date().toISOString() } : {})
      }
    }));

    return status;

  } catch (err: any) {
    console.error('[RecordingManager] Error checking transcription status:', err);
    throw err;
  }
}


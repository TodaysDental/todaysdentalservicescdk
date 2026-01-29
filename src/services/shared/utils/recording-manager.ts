/**
 * FIX #48: Recording Started Before Agent Joins
 * FIX #49: Multiple Recordings Per Call
 * FIX #50: Transcription Job Name Collision
 * 
 * Manages call recording lifecycle with proper timing and deduplication
 */

import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
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
  // PSTN leg call ID extracted from the recording S3 key path (used for mapping/diagnostics)
  pstnCallId?: string;
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
  // Expected format: recordings/YYYY-MM-DD/{callId}/YYYY/MM/DD/timestamp_transactionId_callId.wav
  // AWS Chime automatically appends: year/month/date/timestamp_transactionId_callId.wav
  // We want to extract the callId which is the 3rd segment in the path
  const match = key.match(/recordings\/[^/]+\/([^/]+)\//);
  
  if (!match) {
    // Try alternative format: extract callId from filename if present
    // Format: timestamp_transactionId_callId.wav
    const filenameMatch = key.match(/([a-f0-9-]+)\.wav$/);
    if (filenameMatch) {
      console.log('[RecordingManager] Extracted callId from filename:', filenameMatch[1]);
      return filenameMatch[1];
    }
    
    console.error('[RecordingManager] Could not extract callId from key:', key);
    return null;
  }
  
  console.log('[RecordingManager] Extracted callId from path:', match[1]);
  return match[1];
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
  // NOTE: The ID embedded in the S3 key path is the PSTN leg call ID (not always the analytics `callId` / transactionId).
  const pstnCallId = extractCallIdFromKey(key);
  
  if (!pstnCallId) {
    console.error('[RecordingManager] Cannot extract callId from key:', key);
    return null;
  }

  // Generate deterministic recording ID
  const recordingId = generateRecordingId(pstnCallId, key);

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
  const callRecord = await findCallByCallId(ddb, callQueueTableName, pstnCallId);
  
  if (!callRecord) {
    console.warn('[RecordingManager] Call record not found for pstnCallId:', pstnCallId);
    console.warn('[RecordingManager] S3 key:', key);
    console.warn('[RecordingManager] This will cause clinicId to be set as "unknown"');
    console.warn('[RecordingManager] Possible causes: 1) Call record not created yet, 2) pstnCallId not stored in record, 3) Timing issue');
  } else {
    console.log('[RecordingManager] Found call record:', {
      callId: callRecord.callId,
      pstnCallId: callRecord.pstnCallId,
      clinicId: callRecord.clinicId,
      phoneNumber: callRecord.phoneNumber
    });
  }
  
  const timestamp = callRecord?.queueEntryTime 
    ? new Date(callRecord.queueEntryTime).getTime()
    : Date.now();

  // CRITICAL FIX: Extract segment identifier from S3 key for multi-segment recordings
  // Format: recordings/.../timestamp_transactionId_callId.wav
  const segmentMatch = key.match(/(\d+)_([^_]+)_[^/]+\.wav$/);
  const segmentTimestamp = segmentMatch ? parseInt(segmentMatch[1]) : timestamp;
  const segmentId = segmentMatch ? segmentMatch[2] : 'unknown';
  
  // Store metadata with idempotent put
  const metadata: RecordingMetadata = {
    recordingId,
    timestamp,
    // Prefer the analytics callId/transactionId (callRecord.callId) so the UI can fetch recordings by the same callId
    // it uses for analytics. Fall back to pstnCallId when we cannot resolve the call record yet.
    callId: callRecord?.callId || pstnCallId,
    pstnCallId,
    clinicId: callRecord?.clinicId || 'unknown',
    s3Bucket: bucket,
    s3Key: key,
    fileSize,
    format: headResult.ContentType || 'audio/wav',
    uploadedAt: new Date().toISOString(),
    agentId: callRecord?.assignedAgentId,
    ttl: Math.floor(Date.now() / 1000) + (2555 * 24 * 60 * 60), // 7 years retention
    // Additional metadata for multi-segment tracking
    segmentTimestamp,
    segmentId,
    isMultiSegment: (callRecord?.recordingIds?.size || 0) > 0
  } as any;

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
 * Helper to find call record by pstnCallId (extracted from S3 recording key)
 * The recording S3 key contains the pstnCallId, not the meeting callId,
 * so we need to query using the pstnCallId-index
 */
async function findCallByCallId(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  pstnCallId: string
): Promise<any | null> {
  try {
    console.log('[RecordingManager] Querying for pstnCallId:', pstnCallId);
    console.log('[RecordingManager] Table:', tableName);
    
    // Query using pstnCallId-index since the recording path uses pstnCallId
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'pstnCallId-index',
      KeyConditionExpression: 'pstnCallId = :pstnCallId',
      ExpressionAttributeValues: { ':pstnCallId': pstnCallId },
      Limit: 1
    }));

    console.log('[RecordingManager] Query returned', result.Items?.length || 0, 'items');
    
    if (result.Items && result.Items.length > 0) {
      console.log('[RecordingManager] Found call record with clinicId:', result.Items[0].clinicId);
    } else {
      console.warn('[RecordingManager] No call record found for pstnCallId:', pstnCallId);
      console.warn('[RecordingManager] This may indicate the call record was not created yet or pstnCallId was not stored');
    }

    return result.Items?.[0] || null;
  } catch (err) {
    console.error('[RecordingManager] Error finding call by pstnCallId:', pstnCallId, 'Error:', err);
    return null;
  }
}

/**
 * FIX #50: Start transcription with unique job name
 * Enhanced with custom vocabulary and multi-language support
 */
export async function startTranscription(
  ddb: DynamoDBDocumentClient,
  metadataTableName: string,
  metadata: RecordingMetadata,
  outputBucket: string,
  options?: {
    vocabularyName?: string;
    languageCode?: string;
    identifyLanguage?: boolean;
    languageOptions?: string[];
  }
): Promise<void> {
  // Generate unique job name with UUID to prevent collisions
  const jobName = `transcription-${metadata.callId}-${randomUUID().substring(0, 8)}`;

  console.log('[RecordingManager] Starting transcription:', jobName);

  // Support automatic language identification or specific language
  const languageCode = options?.languageCode || process.env.DEFAULT_LANGUAGE_CODE || 'en-US';
  const identifyLanguage = options?.identifyLanguage || false;
  const languageOptions = options?.languageOptions || ['en-US', 'es-US', 'fr-CA'];

  // Build settings with optional custom vocabulary
  const settings: any = {
    ShowSpeakerLabels: true,
    MaxSpeakerLabels: 2,
    ChannelIdentification: true,
  };

  // Add custom vocabulary if provided and not using language identification
  if (options?.vocabularyName && !identifyLanguage) {
    settings.VocabularyName = options.vocabularyName;
  }

  const baseCommand: any = {
    TranscriptionJobName: jobName,
    MediaFormat: 'wav',
    Media: {
      MediaFileUri: `s3://${metadata.s3Bucket}/${metadata.s3Key}`
    },
    OutputBucketName: outputBucket,
    OutputKey: `transcriptions/${metadata.callId}/${jobName}/`,
    // Add tags for tracking
    Tags: [
      { Key: 'callId', Value: metadata.callId },
      { Key: 'recordingId', Value: metadata.recordingId },
      { Key: 'clinicId', Value: metadata.clinicId },
      { Key: 'languageCode', Value: languageCode }
    ]
  };

  // Either identify language automatically or use specified language
  if (identifyLanguage) {
    baseCommand.IdentifyLanguage = true;
    baseCommand.LanguageOptions = languageOptions;
  } else {
    baseCommand.LanguageCode = languageCode;
  }

  const startJob = async (settingsOverride: any): Promise<void> => {
    const command = {
      ...baseCommand,
      Settings: settingsOverride,
    };

    await transcribe.send(new StartTranscriptionJobCommand(command));

    // Update metadata with transcription job info
    // FIXED: Include both partition key AND sort key for composite key table
    await ddb.send(new UpdateCommand({
      TableName: metadataTableName,
      Key: { 
        recordingId: metadata.recordingId,
        timestamp: metadata.timestamp // Required - table has composite key
      },
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

    console.log('[RecordingManager] ✅ Transcription job started successfully');
    console.log('[RecordingManager] Job name:', jobName);
    console.log('[RecordingManager] Recording ID:', metadata.recordingId);
    console.log('[RecordingManager] Call ID:', metadata.callId);
    console.log('[RecordingManager] Saved transcriptionJobName to DynamoDB for EventBridge lookup');
  };

  try {
    await startJob({ ...settings });
  } catch (err: any) {
    const message = err?.message || '';
    const isVocabularyNotReady = err?.name === 'BadRequestException' &&
      settings?.VocabularyName &&
      /vocabulary/i.test(message) &&
      /ready/i.test(message);

    if (isVocabularyNotReady) {
      console.warn('[RecordingManager] Vocabulary not READY - retrying without custom vocabulary', {
        vocabularyName: settings.VocabularyName,
        jobName,
      });

      const fallbackSettings = { ...settings };
      delete fallbackSettings.VocabularyName;

      try {
        await startJob(fallbackSettings);
        return;
      } catch (retryErr: any) {
        console.error('[RecordingManager] Retry without vocabulary failed:', retryErr?.message || retryErr);
        err = retryErr;
      }
    }
    // Handle specific transcription errors
    if (err.name === 'ConflictException') {
      console.warn('[RecordingManager] Transcription job already exists:', jobName);
      // Job already running - that's OK, just update status
      return;
    }

    console.error('[RecordingManager] Transcription failed:', err);

    // Update metadata with error
    // FIXED: Include both partition key AND sort key for composite key table
    await ddb.send(new UpdateCommand({
      TableName: metadataTableName,
      Key: { 
        recordingId: metadata.recordingId,
        timestamp: metadata.timestamp // Required - table has composite key
      },
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
    // FIXED: Table has composite key (recordingId + timestamp), so we need to scan
    // to find the record when we only have recordingId
    const { Items } = await ddb.send(new ScanCommand({
      TableName: metadataTableName,
      FilterExpression: 'recordingId = :recordingId',
      ExpressionAttributeValues: {
        ':recordingId': recordingId
      },
      Limit: 1
    }));

    const metadata = Items?.[0];
    if (!metadata) {
      console.error('[RecordingManager] Recording metadata not found:', recordingId);
      throw new Error(`Recording metadata not found: ${recordingId}`);
    }

    const result = await transcribe.send(new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    }));

    const status = result.TranscriptionJob?.TranscriptionJobStatus || 'UNKNOWN';

    // Update metadata - include both keys for composite key table
    const updateExpr = status === 'COMPLETED'
      ? 'SET transcriptionStatus = :status, transcriptionCompletedAt = :now'
      : 'SET transcriptionStatus = :status';

    await ddb.send(new UpdateCommand({
      TableName: metadataTableName,
      Key: { 
        recordingId,
        timestamp: metadata.timestamp // Required - table has composite key
      },
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


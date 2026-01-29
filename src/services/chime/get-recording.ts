/**
 * Get Recording Lambda
 * Provides authenticated access to call recordings
 * 
 * GET /recordings/{recordingId} - Get recording metadata and presigned download URL
 * GET /recordings/call/{callId} - Get all recordings for a call
 * GET /recordings/clinic/{clinicId} - List recordings for clinic (with pagination)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getUserPermissions,
  getAllowedClinicIds,
  hasClinicAccess,
} from '../../shared/utils/permissions-helper';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const s3 = new S3Client({});

const RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET || '';
const RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE || '';
// Optional: used to map analytics callId/transactionId -> pstnCallId for older recording metadata schemas
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME || '';

// CRITICAL FIX: Check if recording is enabled via environment variable
// This allows the Lambda to be deployed even when recording is disabled
const RECORDING_ENABLED = process.env.RECORDING_ENABLED !== 'false';

function getS3Location(recording: any): { bucket: string; key: string } | null {
  // Prefer persisted metadata; fallback to env bucket for older schemas that omitted s3Bucket.
  const bucket = recording?.s3Bucket || recording?.bucket || RECORDINGS_BUCKET;
  const key = recording?.s3Key || recording?.key || recording?.objectKey;

  if (!bucket || !key) return null;
  return { bucket, key };
}

async function scanRecordingsByCallId(callId: string, maxItems: number = 50): Promise<any[]> {
  const found: any[] = [];
  let lastEvaluatedKey: any = undefined;
  let page = 0;
  const MAX_PAGES = 10;

  // NOTE: This is a fallback for deployments missing the `callId-index` GSI.
  // It is intentionally bounded to avoid long scans / timeouts.
  while (page < MAX_PAGES && found.length < maxItems) {
    const res = await ddb.send(new ScanCommand({
      TableName: RECORDING_METADATA_TABLE,
      FilterExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: 200
    }));

    if (res.Items && res.Items.length > 0) {
      found.push(...res.Items);
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
    if (!lastEvaluatedKey) break;
    page++;
  }

  return found.slice(0, maxItems);
}

async function scanRecordingsBySegmentId(segmentId: string, maxItems: number = 50): Promise<any[]> {
  const found: any[] = [];
  let lastEvaluatedKey: any = undefined;
  let page = 0;
  const MAX_PAGES = 10;

  // NOTE: Fallback for deployments missing the `segmentId-index` GSI.
  // Intentionally bounded to avoid long scans/timeouts.
  while (page < MAX_PAGES && found.length < maxItems) {
    const res = await ddb.send(new ScanCommand({
      TableName: RECORDING_METADATA_TABLE,
      FilterExpression: 'segmentId = :segmentId',
      ExpressionAttributeValues: { ':segmentId': segmentId },
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: 200
    }));

    if (res.Items && res.Items.length > 0) {
      found.push(...res.Items);
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
    if (!lastEvaluatedKey) break;
    page++;
  }

  return found.slice(0, maxItems);
}

function safeAttachmentFilename(s3Key: string, fallback: string): string {
  const raw = (s3Key.split('/').pop() || fallback).toString();
  const cleaned = raw.replace(/[\r\n"]/g, '').trim();
  return cleaned || fallback;
}

async function queryRecordingsByCallId(callId: string, maxItems: number = 50): Promise<any[]> {
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: RECORDING_METADATA_TABLE,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId }
    }));
    return (res.Items || []).slice(0, maxItems);
  } catch (err: any) {
    const msg = String(err?.message || '');
    const isMissingIndex =
      err?.name === 'ValidationException' &&
      /specified index/i.test(msg);

    console.error('[GetRecording] Query by callId-index failed', {
      callId,
      errorName: err?.name,
      errorMessage: err?.message
    });

    if (isMissingIndex) {
      console.warn('[GetRecording] Falling back to Scan (callId-index missing)', { callId });
      return await scanRecordingsByCallId(callId, maxItems);
    }
    throw err;
  }
}

async function queryRecordingsBySegmentId(segmentId: string, maxItems: number = 50): Promise<any[]> {
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: RECORDING_METADATA_TABLE,
      IndexName: 'segmentId-index',
      KeyConditionExpression: 'segmentId = :segmentId',
      ExpressionAttributeValues: { ':segmentId': segmentId }
    }));
    return (res.Items || []).slice(0, maxItems);
  } catch (err: any) {
    const msg = String(err?.message || '');
    const isMissingIndex =
      err?.name === 'ValidationException' &&
      /specified index/i.test(msg);

    console.error('[GetRecording] Query by segmentId-index failed', {
      segmentId,
      errorName: err?.name,
      errorMessage: err?.message
    });

    if (isMissingIndex) {
      console.warn('[GetRecording] Falling back to Scan (segmentId-index missing)', { segmentId });
      return await scanRecordingsBySegmentId(segmentId, maxItems);
    }
    throw err;
  }
}

async function mapCallIdToPstnCallId(callId: string): Promise<string | null> {
  if (!CALL_QUEUE_TABLE_NAME) return null;

  try {
    const res = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1
    }));

    const record = res.Items?.[0];
    const pstn = record?.pstnCallId || record?.vcCallId || record?.pstnLegCallId;
    if (typeof pstn === 'string' && pstn.trim()) {
      return pstn.trim();
    }
  } catch (err: any) {
    console.warn('[GetRecording] Failed to map callId -> pstnCallId (non-fatal):', {
      callId,
      errorName: err?.name,
      errorMessage: err?.message
    });
  }

  return null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[GetRecording] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters,
    recordingEnabled: RECORDING_ENABLED
  });

  const corsHeaders = buildCorsHeaders({ allowMethods: ['GET', 'OPTIONS'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // CRITICAL FIX: Return appropriate error if recording is disabled or not configured
  if (!RECORDING_ENABLED || !RECORDINGS_BUCKET || !RECORDING_METADATA_TABLE) {
    console.log('[GetRecording] Recording is disabled or not configured', {
      recordingEnabled: RECORDING_ENABLED,
      hasBucket: !!RECORDINGS_BUCKET,
      hasTable: !!RECORDING_METADATA_TABLE
    });
    
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Call recording is not enabled for this deployment',
        code: 'RECORDING_DISABLED'
      })
    };
  }

  try {
    // Get user permissions from authorizer context
    const userPerms = getUserPermissions(event);
    
    if (!userPerms) {
      return { 
        statusCode: 401, 
        headers: corsHeaders, 
        body: JSON.stringify({ message: 'Unauthorized' }) 
      };
    }

    // Get allowed clinics from authorizer context
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    const path = event.path;

    // Route based on path
    if (path.includes('/recordings/call/')) {
      return await getRecordingsForCall(event, allowedClinics, corsHeaders);
    } else if (path.includes('/recordings/clinic/')) {
      return await listRecordingsForClinic(event, allowedClinics, corsHeaders);
    } else if (path.includes('/recordings/')) {
      return await getRecording(event, allowedClinics, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Not found' })
    };

  } catch (err: any) {
    console.error('[GetRecording] Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Internal server error',
        error: typeof err?.message === 'string' && err.message.trim()
          ? err.message
          : (typeof err === 'string' ? err : JSON.stringify(err))
      })
    };
  }
};

async function getRecording(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const recordingId = event.pathParameters?.recordingId;

  if (!recordingId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Missing recordingId' })
    };
  }

  // Get recording metadata
  const { Items: recordings } = await ddb.send(new QueryCommand({
    TableName: RECORDING_METADATA_TABLE,
    KeyConditionExpression: 'recordingId = :recordingId',
    ExpressionAttributeValues: { ':recordingId': recordingId },
    Limit: 1
  }));

  const recording = recordings?.[0];

  if (!recording) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Recording not found' })
    };
  }

  // Check authorization
  if (!hasClinicAccess(allowedClinics, recording.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }

  // Generate presigned URL (valid for 1 hour)
  const loc = getS3Location(recording);
  if (!loc) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Recording metadata is missing S3 location',
        recordingId: recording.recordingId
      })
    };
  }

  const fileName = safeAttachmentFilename(
    loc.key,
    `recording-${recording.recordingId || recordingId}.wav`
  );

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: loc.bucket,
      Key: loc.key,
      ResponseContentDisposition: `attachment; filename="${fileName}"`
    }),
    { expiresIn: 3600 } // 1 hour
  );

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      recordingId: recording.recordingId,
      callId: recording.callId,
      clinicId: recording.clinicId,
      duration: recording.duration,
      uploadedAt: recording.uploadedAt,
      fileSize: recording.fileSize,
      format: recording.format,
      transcriptionStatus: recording.transcriptionStatus,
      downloadUrl: presignedUrl,
      downloadUrlExpiresAt: new Date(Date.now() + 3600000).toISOString()
    })
  };
}

async function getRecordingsForCall(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const callId = event.pathParameters?.callId;

  if (!callId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Missing callId' })
    };
  }

  // 1) Primary: callId-index lookup using the callId provided by the client (usually analytics callId/transactionId)
  let recordings: any[] = await queryRecordingsByCallId(callId);

  // 2) Backward compatibility: older RecordingMetadata rows stored `callId` as pstnCallId (from the S3 key path).
  // If we didn't find recordings, try to map callId -> pstnCallId via CallQueue and query again.
  if (!recordings || recordings.length === 0) {
    const pstnCallId = await mapCallIdToPstnCallId(callId);
    if (pstnCallId && pstnCallId !== callId) {
      console.log('[GetRecording] No recordings found for callId; retrying with pstnCallId', {
        callId,
        pstnCallId
      });
      recordings = await queryRecordingsByCallId(pstnCallId);
    }
  }

  // 3) Backward compatibility: for older records, RecordingMetadata.callId is the PSTN leg ID,
  // but the *transactionId* is stored as `segmentId` (from the filename: timestamp_transactionId_callId.wav).
  // This lets us look up recordings by the analytics callId even after the CallQueue item has been removed.
  if (!recordings || recordings.length === 0) {
    recordings = await queryRecordingsBySegmentId(callId);
  }

  if (!recordings || recordings.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'No recordings found for this call' })
    };
  }

  // Check authorization (use first recording's clinic)
  const clinicId = recordings.find(r => r?.clinicId)?.clinicId;
  if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }
  // If clinicId is missing entirely, only allow access for super admins (allowedClinics contains '*')
  if (!clinicId && !allowedClinics.has('*')) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }

  // Generate presigned URLs for all recordings
  const recordingsWithUrls = (await Promise.all(
    recordings.map(async (recording) => {
      const loc = getS3Location(recording);
      if (!loc) {
        console.warn('[GetRecording] Skipping recording with missing S3 location', {
          callId,
          recordingId: recording?.recordingId
        });
        return null;
      }

      try {
        const fileName = safeAttachmentFilename(
          loc.key,
          `recording-${recording?.recordingId || recording?.callId || callId}.wav`
        );

        const presignedUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: loc.bucket,
            Key: loc.key,
            ResponseContentDisposition: `attachment; filename="${fileName}"`
          }),
          { expiresIn: 3600 }
        );

        return {
          recordingId: recording.recordingId,
          callId: recording.callId,
          duration: recording.duration,
          uploadedAt: recording.uploadedAt,
          fileSize: recording.fileSize,
          transcriptionStatus: recording.transcriptionStatus,
          downloadUrl: presignedUrl
        };
      } catch (err: any) {
        console.warn('[GetRecording] Failed to presign recording', {
          callId,
          recordingId: recording?.recordingId,
          errorName: err?.name,
          errorMessage: err?.message
        });
        return null;
      }
    })
  )).filter(Boolean) as Array<{
    recordingId: string;
    callId: string;
    duration?: number;
    uploadedAt?: string;
    fileSize?: number;
    transcriptionStatus?: string;
    downloadUrl: string;
  }>;

  if (recordingsWithUrls.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'No downloadable recordings found for this call' })
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      callId,
      recordings: recordingsWithUrls,
      downloadUrlExpiresAt: new Date(Date.now() + 3600000).toISOString()
    })
  };
}

async function listRecordingsForClinic(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const clinicId = event.pathParameters?.clinicId;
  const queryParams = event.queryStringParameters || {};

  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Missing clinicId' })
    };
  }

  // Check authorization
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }

  // Parse time range
  const startTime = queryParams.startTime 
    ? parseInt(queryParams.startTime, 10)
    : Date.now() - (7 * 24 * 60 * 60 * 1000); // Default: last 7 days

  const endTime = queryParams.endTime
    ? parseInt(queryParams.endTime, 10)
    : Date.now();

  const limit = Math.min(parseInt(queryParams.limit || '100', 10), 100);

  // Parse pagination token
  let exclusiveStartKey: any = undefined;
  if (queryParams.lastEvaluatedKey) {
    try {
      exclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8')
      );
    } catch (parseErr) {
      console.warn('[GetRecording] Invalid pagination token');
    }
  }

  // Query recordings
  const queryResult = await ddb.send(new QueryCommand({
    TableName: RECORDING_METADATA_TABLE,
    IndexName: 'clinicId-timestamp-index',
    KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':start': startTime,
      ':end': endTime
    },
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey,
    ScanIndexForward: false // Most recent first
  }));

  const recordings = (queryResult.Items || []).map(recording => ({
    recordingId: recording.recordingId,
    callId: recording.callId,
    duration: recording.duration,
    uploadedAt: recording.uploadedAt,
    fileSize: recording.fileSize,
    agentId: recording.agentId,
    transcriptionStatus: recording.transcriptionStatus
  }));

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      clinicId,
      recordings,
      hasMore: !!queryResult.LastEvaluatedKey,
      lastEvaluatedKey: queryResult.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString('base64')
        : null
    })
  };
}


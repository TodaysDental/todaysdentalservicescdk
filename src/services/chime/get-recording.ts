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
import { S3Client, GetObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
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

// Optional: used to locate Connect call recordings (Connect/Lex AI calls use callId like "connect-{ContactId}")
const CALL_ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME || '';
const CONNECT_RECORDINGS_BUCKET = process.env.CONNECT_RECORDINGS_BUCKET || '';
const CONNECT_RECORDINGS_PREFIX = process.env.CONNECT_RECORDINGS_PREFIX || '';

// CRITICAL FIX: Check if recording is enabled via environment variable
// This allows the Lambda to be deployed even when recording is disabled
const RECORDING_ENABLED = process.env.RECORDING_ENABLED !== 'false';

const CONNECT_CALL_ID_PREFIX = 'connect-';

function normalizeS3Prefix(prefix: string): string {
  return String(prefix || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function joinS3Prefix(...parts: Array<string | undefined | null>): string {
  const cleaned = parts
    .map((p) => normalizeS3Prefix(String(p || '')))
    .filter(Boolean);
  return cleaned.join('/');
}

function isConnectCallId(callId: string): boolean {
  return typeof callId === 'string' && callId.startsWith(CONNECT_CALL_ID_PREFIX);
}

function extractConnectContactId(callId: string): string | null {
  if (!isConnectCallId(callId)) return null;
  const contactId = callId.slice(CONNECT_CALL_ID_PREFIX.length).trim();
  if (!contactId) return null;
  // ContactId is UUID-ish; keep permissive (Connect may use other formats in future).
  if (!/^[0-9a-fA-F-]{16,}$/.test(contactId)) return null;
  return contactId;
}

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

async function getConnectCallInfo(callId: string): Promise<{ clinicId: string; timestampMs: number; contactId: string } | null> {
  if (!CALL_ANALYTICS_TABLE_NAME) return null;

  const contactId = extractConnectContactId(callId);
  if (!contactId) return null;

  try {
    const res = await ddb.send(new QueryCommand({
      TableName: CALL_ANALYTICS_TABLE_NAME,
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1,
      ScanIndexForward: false,
    }));

    const item: any = res.Items?.[0];
    if (!item) return null;

    const clinicId = String(item.clinicId || '').trim();
    const ts = item.timestamp;

    // Connect/Lex analytics stores timestamp in ms (SK). Guard if seconds slip in.
    const timestampMs =
      typeof ts === 'number' && Number.isFinite(ts)
        ? (ts > 2_000_000_000_000 ? ts : ts * 1000)
        : Date.now();

    if (!clinicId) {
      // Without clinicId we can't authorize safely.
      return null;
    }

    return {
      clinicId,
      timestampMs,
      contactId: String(item.contactId || contactId).trim() || contactId,
    };
  } catch (err: any) {
    console.warn('[GetRecording] Failed to query CallAnalytics for Connect call', {
      callId,
      errorName: err?.name,
      errorMessage: err?.message,
    });
    return null;
  }
}

async function findConnectRecordingObject(params: {
  contactId: string;
  timestampMs: number;
}): Promise<{ bucket: string; key: string; size?: number; lastModified?: string } | null> {
  if (!CONNECT_RECORDINGS_BUCKET) return null;

  const { contactId, timestampMs } = params;
  const basePrefix = normalizeS3Prefix(CONNECT_RECORDINGS_PREFIX);

  const listBestMatchUnderPrefix = async (prefix: string, maxPages: number): Promise<{
    key: string;
    size?: number;
    lastModified?: string;
  } | null> => {
    let continuationToken: string | undefined = undefined;
    let page = 0;
    const matches: Array<{ key: string; size?: number; lastModified?: string }> = [];

    while (page < maxPages) {
      const resp: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({
        Bucket: CONNECT_RECORDINGS_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      const contents = resp.Contents || [];
      for (const obj of contents) {
        const key = obj.Key || '';
        if (!key) continue;
        if (!key.includes(contactId)) continue;
        if (!/\.(wav|mp3)$/i.test(key)) continue;

        matches.push({
          key,
          size: typeof obj.Size === 'number' ? obj.Size : undefined,
          lastModified: obj.LastModified ? obj.LastModified.toISOString() : undefined,
        });
      }

      continuationToken = resp.NextContinuationToken;
      if (!continuationToken) break;
      page++;
    }

    if (matches.length === 0) return null;

    // Prefer the largest file (most complete), then newest.
    matches.sort((a, b) => {
      const as = typeof a.size === 'number' ? a.size : 0;
      const bs = typeof b.size === 'number' ? b.size : 0;
      if (as !== bs) return bs - as;

      const at = Date.parse(a.lastModified || '') || 0;
      const bt = Date.parse(b.lastModified || '') || 0;
      return bt - at;
    });

    return matches[0];
  };

  // Try a small window around the call date to handle timezone boundaries.
  const base = new Date(timestampMs);
  const dayOffsets = [-1, 0, 1];

  for (const delta of dayOffsets) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + delta));
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const m = String(d.getUTCMonth() + 1); // non-padded fallback
    const day = String(d.getUTCDate()); // non-padded fallback

    // Connect S3 layouts vary slightly by configuration; try the most common patterns first.
    const candidatePrefixes = [
      // Common: .../<YYYY>/<MM>/<DD>/...
      `${joinS3Prefix(basePrefix, yyyy, mm, dd)}/`,
      // Common: .../<YYYY>-<MM>-<DD>/...
      `${joinS3Prefix(basePrefix, `${yyyy}-${mm}-${dd}`)}/`,
      // Fallback (some prefixes omit zero-padding)
      `${joinS3Prefix(basePrefix, yyyy, m, day)}/`,
      `${joinS3Prefix(basePrefix, `${yyyy}-${m}-${day}`)}/`,
    ];

    for (const prefix of candidatePrefixes) {
      const best = await listBestMatchUnderPrefix(prefix, 5);
      if (best) {
        return {
          bucket: CONNECT_RECORDINGS_BUCKET,
          key: best.key,
          size: best.size,
          lastModified: best.lastModified,
        };
      }
    }

    // Additional fallback: search one directory higher (month) with a smaller bound.
    const monthPrefixes = [
      `${joinS3Prefix(basePrefix, yyyy, mm)}/`,
      `${joinS3Prefix(basePrefix, yyyy, m)}/`,
    ];
    for (const prefix of monthPrefixes) {
      const best = await listBestMatchUnderPrefix(prefix, 2);
      if (best) {
        return {
          bucket: CONNECT_RECORDINGS_BUCKET,
          key: best.key,
          size: best.size,
          lastModified: best.lastModified,
        };
      }
    }
  }

  // Fallback (bounded): if the bucket layout differs from the expected date partitioning,
  // try a few pages under the base prefix and look for the contactId.
  try {
    const baseListPrefix = basePrefix ? `${basePrefix}/` : '';
    const best = await listBestMatchUnderPrefix(baseListPrefix, 5);
    if (best) {
      return {
        bucket: CONNECT_RECORDINGS_BUCKET,
        key: best.key,
        size: best.size,
        lastModified: best.lastModified,
      };
    }
  } catch (err: any) {
    console.warn('[GetRecording] Connect recordings fallback list failed (non-fatal)', {
      contactId,
      errorName: err?.name,
      errorMessage: err?.message,
    });
  }

  return null;
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

  // Use request origin to support www/local origins (keeps behavior aligned with other Admin APIs)
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = buildCorsHeaders(
    {
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Referer', 'X-Clinic-Id'],
    },
    requestOrigin
  );

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const hasChimeRecordingConfig = RECORDING_ENABLED && Boolean(RECORDINGS_BUCKET) && Boolean(RECORDING_METADATA_TABLE);
  const hasConnectRecordingConfig = Boolean(CALL_ANALYTICS_TABLE_NAME) && Boolean(CONNECT_RECORDINGS_BUCKET) && Boolean(CONNECT_RECORDINGS_PREFIX);

  // Return an error only if *no* recording mechanism is configured.
  if (!hasChimeRecordingConfig && !hasConnectRecordingConfig) {
    console.log('[GetRecording] Recording is disabled or not configured', {
      recordingEnabled: RECORDING_ENABLED,
      hasBucket: !!RECORDINGS_BUCKET,
      hasTable: !!RECORDING_METADATA_TABLE,
      hasConnectConfig: hasConnectRecordingConfig,
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

  if (!RECORDING_METADATA_TABLE) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Recording metadata store is not configured' })
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
      // Include transcript text and sentiment from post-call transcription
      transcriptionText: recording.transcriptText || recording.transcriptionText || undefined,
      sentiment: recording.sentiment || undefined,
      sentimentScore: typeof recording.sentimentScore === 'number' ? recording.sentimentScore : undefined,
      downloadUrl: presignedUrl,
      downloadUrlExpiresAt: new Date(Date.now() + 3600000).toISOString()
    })
  };
}

async function getConnectRecordingForCall(
  callId: string,
  allowedClinics: Set<string>,
  corsHeaders: any
): Promise<APIGatewayProxyResult | null> {
  if (!isConnectCallId(callId)) return null;

  const info = await getConnectCallInfo(callId);
  if (!info) return null;

  // Authorization via clinicId on the analytics record
  if (!hasClinicAccess(allowedClinics, info.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }

  const obj = await findConnectRecordingObject({
    contactId: info.contactId,
    timestampMs: info.timestampMs,
  });

  if (!obj) {
    // Recording not available yet (or recording disabled in the flow)
    return null;
  }

  const fileName = safeAttachmentFilename(
    obj.key,
    `connect-recording-${callId}.wav`
  );

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: obj.bucket,
      Key: obj.key,
      ResponseContentDisposition: `attachment; filename="${fileName}"`
    }),
    { expiresIn: 3600 }
  );

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      callId,
      recordings: [
        {
          recordingId: `connect-${info.contactId}`,
          callId,
          uploadedAt: obj.lastModified,
          fileSize: obj.size,
          transcriptionStatus: undefined,
          downloadUrl: presignedUrl
        }
      ],
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

  // Connect/Lex AI calls use callId like "connect-{ContactId}". If recordings exist for these calls,
  // they are stored in the Connect call recordings bucket (not the Chime recordings bucket).
  const connectResp = await getConnectRecordingForCall(callId, allowedClinics, corsHeaders);
  if (connectResp) return connectResp;

  // 1) Primary: callId-index lookup using the callId provided by the client (usually analytics callId/transactionId)
  let recordings: any[] = [];
  if (RECORDING_METADATA_TABLE) {
    recordings = await queryRecordingsByCallId(callId);
  }

  // 2) Backward compatibility: older RecordingMetadata rows stored `callId` as pstnCallId (from the S3 key path).
  // If we didn't find recordings, try to map callId -> pstnCallId via CallQueue and query again.
  if (!recordings || recordings.length === 0) {
    const pstnCallId = await mapCallIdToPstnCallId(callId);
    if (pstnCallId && pstnCallId !== callId) {
      console.log('[GetRecording] No recordings found for callId; retrying with pstnCallId', {
        callId,
        pstnCallId
      });
      if (RECORDING_METADATA_TABLE) {
        recordings = await queryRecordingsByCallId(pstnCallId);
      }
    }
  }

  // 3) Backward compatibility: for older records, RecordingMetadata.callId is the PSTN leg ID,
  // but the *transactionId* is stored as `segmentId` (from the filename: timestamp_transactionId_callId.wav).
  // This lets us look up recordings by the analytics callId even after the CallQueue item has been removed.
  if (!recordings || recordings.length === 0) {
    if (RECORDING_METADATA_TABLE) {
      recordings = await queryRecordingsBySegmentId(callId);
    }
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
          // Include transcript text and sentiment from post-call transcription
          transcriptionText: recording.transcriptText || recording.transcriptionText || undefined,
          sentiment: recording.sentiment || undefined,
          sentimentScore: typeof recording.sentimentScore === 'number' ? recording.sentimentScore : undefined,
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
    transcriptionText?: string;
    sentiment?: string;
    sentimentScore?: number;
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

  if (!RECORDING_METADATA_TABLE) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Recording metadata store is not configured' })
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


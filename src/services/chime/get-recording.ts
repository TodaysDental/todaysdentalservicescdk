/**
 * Get Recording Lambda
 * Provides authenticated access to call recordings
 * 
 * GET /recordings/{recordingId} - Get recording metadata and presigned download URL
 * GET /recordings/call/{callId} - Get all recordings for a call
 * GET /recordings/clinic/{clinicId} - List recordings for clinic (with pagination)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const s3 = new S3Client({});

const RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET!;
const RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE!;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Import JWT verification from shared utilities
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { getClinicsFromClaims, hasClinicAccess } from '../shared/utils/authorization';
import { buildCorsHeaders } from '../../shared/utils/cors';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[GetRecording] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters
  });

  const corsHeaders = buildCorsHeaders({ allowMethods: ['GET', 'OPTIONS'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // Authenticate
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdTokenCached(authz, REGION!, USER_POOL_ID);
    
    if (!verifyResult.ok) {
      return { 
        statusCode: verifyResult.code, 
        headers: corsHeaders, 
        body: JSON.stringify({ message: verifyResult.message }) 
      };
    }

    const authorizedClinics = getClinicsFromClaims(verifyResult.payload);
    const path = event.path;

    // Route based on path
    if (path.includes('/recordings/call/')) {
      return await getRecordingsForCall(event, authorizedClinics, corsHeaders);
    } else if (path.includes('/recordings/clinic/')) {
      return await listRecordingsForClinic(event, authorizedClinics, corsHeaders);
    } else if (path.includes('/recordings/')) {
      return await getRecording(event, authorizedClinics, corsHeaders);
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
        error: err?.message 
      })
    };
  }
};

async function getRecording(
  event: APIGatewayProxyEvent,
  authorizedClinics: string[],
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
  if (!hasClinicAccess(authorizedClinics, recording.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }

  // Generate presigned URL (valid for 1 hour)
  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: recording.s3Bucket,
      Key: recording.s3Key
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
  authorizedClinics: string[],
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

  const { Items: recordings } = await ddb.send(new QueryCommand({
    TableName: RECORDING_METADATA_TABLE,
    IndexName: 'callId-index',
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId }
  }));

  if (!recordings || recordings.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'No recordings found for this call' })
    };
  }

  // Check authorization (use first recording's clinic)
  const clinicId = recordings[0].clinicId;
  if (!hasClinicAccess(authorizedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }

  // Generate presigned URLs for all recordings
  const recordingsWithUrls = await Promise.all(
    recordings.map(async (recording) => {
      const presignedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: recording.s3Bucket,
          Key: recording.s3Key
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
    })
  );

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
  authorizedClinics: string[],
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
  if (!hasClinicAccess(authorizedClinics, clinicId)) {
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


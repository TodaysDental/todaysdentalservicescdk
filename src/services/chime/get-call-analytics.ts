import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createHmac } from 'crypto';
import {
  getUserPermissions,
  getAllowedClinicIds,
  hasClinicAccess,
  isAdminUser,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { AnalyticsState, getFinalizationEstimate } from '../../types/analytics-state-machine';
import { getAnalyticsState } from '../shared/utils/analytics-state-manager';
import {
  RankingCriteria,
  RankingPeriod,
  AgentRankingEntry,
  AgentRankingsResponse,
  AgentBadge,
  AgentStatus,
  AGENT_BADGES
} from '../../types/analytics';
import { ScanCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

// CRITICAL FIX #15: Pagination token signing for security
// Use JWT secret or a dedicated signing key
const PAGINATION_TOKEN_SECRET = process.env.JWT_SECRET || process.env.PAGINATION_SECRET || 'default-pagination-secret';
const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/**
 * CRITICAL FIX #15: Sign pagination token to prevent tampering
 */
function signPaginationToken(data: any, context: string): string {
  const payload = {
    ...data,
    _ctx: context,
    _exp: Date.now() + TOKEN_EXPIRY_MS
  };
  
  const payloadStr = JSON.stringify(payload);
  const signature = createHmac('sha256', PAGINATION_TOKEN_SECRET)
    .update(payloadStr)
    .digest('hex')
    .substring(0, 16); // Use first 16 chars for brevity
  
  const signedToken = Buffer.from(JSON.stringify({ p: payload, s: signature })).toString('base64');
  return signedToken;
}

/**
 * CRITICAL FIX #15: Verify and decode signed pagination token
 */
function verifyPaginationToken(token: string, expectedContext: string): { valid: boolean; data?: any; error?: string } {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    
    // Check for signed token format
    if (decoded.p && decoded.s) {
      const { p: payload, s: signature } = decoded;
      
      // Verify signature
      const expectedSig = createHmac('sha256', PAGINATION_TOKEN_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex')
        .substring(0, 16);
      
      if (signature !== expectedSig) {
        return { valid: false, error: 'Invalid token signature' };
      }
      
      // Check expiry
      if (payload._exp && payload._exp < Date.now()) {
        return { valid: false, error: 'Token expired' };
      }
      
      // Check context (clinic/agent)
      if (payload._ctx && payload._ctx !== expectedContext) {
        return { valid: false, error: 'Token context mismatch' };
      }
      
      // Remove internal fields before returning
      const { _ctx, _exp, ...data } = payload;
      return { valid: true, data };
    }
    
    // Fallback: Handle legacy unsigned tokens (for backward compatibility)
    // Log warning but still validate structure
    console.warn('[verifyPaginationToken] Legacy unsigned token detected - consider re-issuing');
    return { valid: true, data: decoded };
    
  } catch (err: any) {
    return { valid: false, error: `Cannot decode token: ${err.message}` };
  }
}

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const STAFF_USER_TABLE_NAME = process.env.STAFF_USER_TABLE || 'StaffUser';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);

const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
const AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME; // Optional
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME; // For queue calls endpoint
const TRANSCRIPT_BUFFER_TABLE_NAME = process.env.TRANSCRIPT_BUFFER_TABLE_NAME; // Optional (TranscriptBuffersV2)

// Validate required environment variables
if (!ANALYTICS_TABLE_NAME) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}

/**
 * CRITICAL FIX #13: Normalize timestamp to epoch seconds
 * Handles both seconds and milliseconds input
 */
function normalizeTimestamp(value: number): number {
  // Detect if timestamp is in milliseconds (>= year 2001 in ms)
  // Year 2001 in seconds: 978307200
  // Year 2100 in seconds: 4102444800
  const YEAR_2100_SECONDS = 4102444800;
  
  if (value > YEAR_2100_SECONDS) {
    // Definitely milliseconds, convert to seconds
    return Math.floor(value / 1000);
  }
  return value;
}

/**
 * Validate time range parameters
 * CRITICAL FIX #13: Auto-normalize timestamps to handle ms/s inconsistency
 */
function validateTimeRange(startTime: number, endTime: number): { valid: boolean; error?: any; normalizedStart?: number; normalizedEnd?: number } {
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - (365 * 24 * 60 * 60);
  
  if (isNaN(startTime) || isNaN(endTime)) {
    return {
      valid: false,
      error: { 
        message: 'Invalid time format. Use epoch seconds.',
        error: 'INVALID_TIME_FORMAT'
      }
    };
  }
  
  // CRITICAL FIX #13: Normalize timestamps to handle ms/s inconsistency
  const normalizedStart = normalizeTimestamp(startTime);
  const normalizedEnd = normalizeTimestamp(endTime);
  
  if (normalizedStart !== startTime || normalizedEnd !== endTime) {
    console.log('[validateTimeRange] Normalized timestamps from ms to seconds:', {
      originalStart: startTime,
      normalizedStart,
      originalEnd: endTime,
      normalizedEnd
    });
  }
  
  if (normalizedStart >= normalizedEnd) {
    return {
      valid: false,
      error: { 
        message: 'startTime must be before endTime',
        error: 'INVALID_TIME_RANGE',
        startTime: normalizedStart,
        endTime: normalizedEnd
      }
    };
  }
  
  if (normalizedStart < oneYearAgo) {
    return {
      valid: false,
      error: { 
        message: 'startTime cannot be more than 1 year in the past',
        error: 'TIME_RANGE_TOO_OLD',
        maxStartTime: oneYearAgo
      }
    };
  }
  
  if (normalizedEnd > now + 3600) {
    return {
      valid: false,
      error: { 
        message: 'endTime cannot be more than 1 hour in the future',
        error: 'TIME_RANGE_FUTURE',
        currentTime: now
      }
    };
  }
  
  // Prevent excessively large time ranges (max 90 days)
  const MAX_RANGE_SECONDS = 90 * 24 * 60 * 60;
  if (normalizedEnd - normalizedStart > MAX_RANGE_SECONDS) {
    return {
      valid: false,
      error: { 
        message: 'Time range cannot exceed 90 days',
        error: 'TIME_RANGE_TOO_LARGE',
        requestedRange: normalizedEnd - normalizedStart,
        maxRange: MAX_RANGE_SECONDS
      }
    };
  }
  
  return { valid: true, normalizedStart, normalizedEnd };
}

/**
 * Lambda handler for retrieving call analytics
 * 
 * Endpoints:
 * GET /analytics/call/{callId} - Get analytics for specific call
 * GET /analytics/live?callId={callId} - Get live/real-time analytics (query param)
 * GET /analytics/clinic/{clinicId} - Get analytics for clinic (with filters)
 * GET /analytics/agent/{agentId} - Get analytics for agent
 * GET /analytics/summary - Get aggregate metrics
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[get-analytics] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId
  });
  
  // Use proper CORS headers that match API Gateway configuration
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = buildCorsHeaders({
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }, requestOrigin);
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // Get user permissions from authorizer context
    const userPerms = getUserPermissions(event);
    
    if (!userPerms) {
      console.warn('[get-analytics] No user permissions in authorizer context');
      return { 
        statusCode: 401, 
        headers: corsHeaders, 
        body: JSON.stringify({ message: 'Unauthorized' }) 
      };
    }
    
    const path = event.path;
    
    // Route to appropriate handler
    if (path.includes('/call/')) {
      return await getCallAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes('/live')) {
      return await getLiveCallAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes('/clinic/')) {
      return await getClinicAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes('/agent/')) {
      return await getAgentAnalytics(event, userPerms, corsHeaders);
    } else if (path.includes('/summary')) {
      return await getAnalyticsSummary(event, userPerms, corsHeaders);
    } else if (path.includes('/rankings')) {
      return await getAgentRankings(event, userPerms, corsHeaders);
    } else if (path.includes('/queue')) {
      return await getQueueCalls(event, userPerms, corsHeaders);
    }
    
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Not found' })
    };
    
  } catch (error: any) {
    console.error('[get-analytics] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Internal server error',
        error: error?.message
      })
    };
  }
};

async function getCallAnalytics(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const callId = event.pathParameters?.callId;
  
  if (!callId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Missing callId parameter' })
    };
  }
  
  // Query analytics for this call
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId },
    ScanIndexForward: false, // Get most recent record first (callId is PK, timestamp is SK)
    Limit: 1
  }));

  const analytics = queryResult.Items?.[0];
  
  if (!analytics) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Call analytics not found' })
    };
  }
  
  // Check authorization using authorizer context
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, analytics.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }
  
  // ----------------------------------------
  // Transcript hydration (Lex/Connect & Voice AI)
  // ----------------------------------------
  // Some call sources (e.g., Connect/Lex AI) store transcript segments in TranscriptBuffersV2,
  // but do not persist `latestTranscripts` / `fullTranscript` in CallAnalytics.
  // Hydrate missing fields from TranscriptBuffers to make the UI consistent.
  let transcriptBuffer: any | null = null;
  if (TRANSCRIPT_BUFFER_TABLE_NAME) {
    try {
      const bufferResult = await ddb.send(new GetCommand({
        TableName: TRANSCRIPT_BUFFER_TABLE_NAME,
        Key: { callId }
      }));
      transcriptBuffer = bufferResult.Item || null;
    } catch (err: any) {
      console.warn('[getCallAnalytics] Failed to fetch transcript buffer (non-fatal):', {
        callId,
        errorName: err?.name,
        errorMessage: err?.message
      });
    }
  }

  if (transcriptBuffer && Array.isArray(transcriptBuffer.segments) && transcriptBuffer.segments.length > 0) {
    const segments: any[] = transcriptBuffer.segments;
    const bufferSegmentCount =
      typeof transcriptBuffer.segmentCount === 'number'
        ? transcriptBuffer.segmentCount
        : segments.length;

    // Ensure transcriptCount is at least the buffer segment count
    const existingCount = typeof analytics.transcriptCount === 'number' ? analytics.transcriptCount : 0;
    analytics.transcriptCount = Math.max(existingCount, bufferSegmentCount);

    // Hydrate latestTranscripts if missing/empty
    const existingLatest = Array.isArray(analytics.latestTranscripts) ? analytics.latestTranscripts : [];
    if (existingLatest.length === 0) {
      analytics.latestTranscripts = segments
        .slice(-10)
        .map((seg: any, idx: number) => {
          const rawSpeaker = String(seg.speaker || 'CUSTOMER').toUpperCase();
          const speaker = rawSpeaker === 'AGENT' || rawSpeaker === 'ASSISTANT' ? 'AGENT' : 'CUSTOMER';
          const timestamp =
            typeof seg.startTime === 'number'
              ? seg.startTime
              : (typeof seg.timestamp === 'number' ? seg.timestamp : idx);
          const text = String(seg.content ?? seg.text ?? seg.message ?? '').trim();
          const confidence = typeof seg.confidence === 'number' ? seg.confidence : undefined;
          return { timestamp, speaker, text, confidence };
        })
        .filter((t: any) => typeof t.text === 'string' && t.text.trim().length > 0);
    }

    // Hydrate fullTranscript if missing/empty (bounded to avoid huge payloads)
    const hasFullTranscript = typeof analytics.fullTranscript === 'string' && analytics.fullTranscript.trim().length > 0;
    if (!hasFullTranscript) {
      const MAX_SEGMENTS_FOR_FULL = 400;
      const MAX_CHARS_FOR_FULL = 20000;

      const segmentsForFull = segments.length > MAX_SEGMENTS_FOR_FULL
        ? segments.slice(-MAX_SEGMENTS_FOR_FULL)
        : segments;

      const lines: string[] = [];
      for (const seg of segmentsForFull) {
        const rawSpeaker = String(seg.speaker || 'CUSTOMER').toUpperCase();
        const speaker = rawSpeaker === 'AGENT' || rawSpeaker === 'ASSISTANT' ? 'AGENT' : 'CUSTOMER';
        const text = String(seg.content ?? seg.text ?? seg.message ?? '').trim();
        if (!text) continue;
        lines.push(`${speaker}: ${text}`);
      }

      let fullText = lines.join('\n');
      let truncated = false;

      if (segments.length > MAX_SEGMENTS_FOR_FULL) truncated = true;
      if (fullText.length > MAX_CHARS_FOR_FULL) {
        fullText = fullText.substring(fullText.length - MAX_CHARS_FOR_FULL);
        truncated = true;
      }

      analytics.fullTranscript = fullText;
      // Extra field (not required by clients) to indicate truncation.
      (analytics as any).fullTranscriptTruncated = truncated;
    }
  }

  // ----------------------------------------
  // Caching / ETag
  // ----------------------------------------
  const isFinalized =
    analytics.analyticsState === AnalyticsState.FINALIZED ||
    analytics.finalized === true ||
    analytics.callStatus === 'completed' ||
    analytics.callStatus === 'finalized';

  // For active/finalizing calls, do not allow caching (prevents stale transcripts for Connect/Lex records
  // that update `lastActivityTime` but may not set `updatedAt`).
  const cacheControl = isFinalized ? 'public, max-age=3600' : 'no-store';

  // CRITICAL FIX: Generate ETag for caching (include transcript buffer metadata to avoid stale reads)
  const changeMarker =
    analytics.finalizedAt ||
    analytics.updatedAt ||
    analytics.lastActivityTime ||
    analytics.callEndTime ||
    analytics.timestamp;

  const bufferMarker = transcriptBuffer
    ? `${transcriptBuffer.lastUpdate || ''}-${transcriptBuffer.segmentCount || transcriptBuffer.segments?.length || 0}`
    : '';

  const etagSource = `${callId}-${analytics.timestamp}-${changeMarker}-${bufferMarker}`;
  const etag = Buffer.from(etagSource).toString('base64');
  
  // Check If-None-Match header
  const clientETag = event.headers?.['If-None-Match'] || event.headers?.['if-none-match'];
  if (clientETag === etag) {
    return {
      statusCode: 304,
      headers: {
        ...corsHeaders,
        'ETag': etag,
        'Cache-Control': cacheControl
      },
      body: ''
    };
  }
  
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'ETag': etag,
      'Cache-Control': cacheControl,
      'X-Data-Version': analytics.timestamp.toString()
    },
    body: JSON.stringify({
      ...analytics,
      etag
    })
  };
}

async function getLiveCallAnalytics(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const callId = event.queryStringParameters?.callId;
  
  if (!callId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Missing callId query parameter' })
    };
  }
  
  console.log('[getLiveCallAnalytics] Fetching live analytics for callId:', callId);
  
  // Query analytics for this call
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId },
    ScanIndexForward: false, // Get most recent first
    Limit: 1
  }));

  const analytics = queryResult.Items?.[0];
  
  if (!analytics) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Call analytics not found',
        callId: callId 
      })
    };
  }
  
  // Check authorization using authorizer context
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, analytics.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }
  
  // CRITICAL FIX: Use state machine for accurate status tracking
  const analyticsState = analytics.analyticsState || AnalyticsState.ACTIVE;
  const hasCallEnded = analytics.callEndTime || analytics.finalized;
  
  // CRITICAL FIX #1: Validate call is actually still active in real-time
  // Check if call ended timestamp is recent (within last 5 seconds) to catch stale data
  const callStartTimestamp = analytics.callStartTimestamp || new Date(analytics.callStartTime).getTime();
  const now = Date.now();
  const callDuration = now - callStartTimestamp;
  const MAX_REASONABLE_CALL_DURATION = 4 * 60 * 60 * 1000; // 4 hours
  
  // If call has been "active" for more than 4 hours, something is wrong
  if (analyticsState === AnalyticsState.ACTIVE && callDuration > MAX_REASONABLE_CALL_DURATION) {
    console.error('[getLiveCallAnalytics] Stale active call detected (>4 hours):', {
      callId,
      callStartTimestamp,
      callDuration: Math.floor(callDuration / 1000 / 60), // minutes
      analyticsState
    });
    
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Call data appears stale. Call may have ended without proper finalization.',
        callId,
        error: 'STALE_CALL_DATA',
        callDuration: Math.floor(callDuration / 1000 / 60), // minutes
        hint: 'Contact support if this persists. The call may need manual finalization.'
      })
    };
  }
  
  // Validate last update timestamp is recent for truly live calls
  const lastUpdate = new Date(analytics.updatedAt).getTime();
  const timeSinceUpdate = now - lastUpdate;
  const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  
  if (analyticsState === AnalyticsState.ACTIVE && timeSinceUpdate > STALE_THRESHOLD) {
    console.warn('[getLiveCallAnalytics] No recent updates for active call:', {
      callId,
      lastUpdate: analytics.updatedAt,
      minutesSinceUpdate: Math.floor(timeSinceUpdate / 1000 / 60)
    });
    
    // Return data but flag as potentially stale
    analytics._warning = 'No recent updates received. Call may have ended.';
    analytics._lastUpdateMinutesAgo = Math.floor(timeSinceUpdate / 1000 / 60);
  }
  
  // Handle FINALIZING state - return helpful response instead of 400 error
  if (analyticsState === AnalyticsState.FINALIZING) {
    const stateMetadata = await getAnalyticsState(ddb, ANALYTICS_TABLE_NAME!, callId, analytics.timestamp);
    const estimatedMsRaw = stateMetadata ? getFinalizationEstimate(stateMetadata) : null;
    const estimatedMs = estimatedMsRaw ?? 30000; // Use 30s default if null
    
    console.log('[getLiveCallAnalytics] Call is in FINALIZING state', {
      callId,
      estimatedMs
    });
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ...analytics,
        status: 'finalizing',
        message: 'Call has ended and is being finalized. Check back shortly for complete analytics.',
        estimatedReadyIn: Math.ceil(estimatedMs / 1000), // seconds
        estimatedReadyAt: Date.now() + estimatedMs,
        isLive: false,
        isFinalizing: true,
        hint: 'Poll this endpoint or use GET /analytics/call/{callId} once finalized',
        fetchedAt: Date.now()
      })
    };
  }
  
  // Handle FINALIZED state - redirect to post-call endpoint
  if (analyticsState === AnalyticsState.FINALIZED || hasCallEnded) {
    console.log('[getLiveCallAnalytics] Call is finalized', {
      callId,
      analyticsState,
      hasCallEnded
    });
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        status: 'finalized',
        message: 'Call has been finalized. Use GET /analytics/call/{callId} for complete analytics.',
        callId,
        callEndTime: analytics.callEndTime,
        isCompleted: true,
        redirectTo: `/analytics/call/${callId}`,
        hint: 'This call is no longer live. Complete analytics are available at the redirectTo endpoint.'
      })
    };
  }
  
  // Validate call is actually active
  if (analyticsState !== AnalyticsState.ACTIVE && analyticsState !== AnalyticsState.INITIALIZING) {
    console.error('[getLiveCallAnalytics] Unexpected analytics state', {
      callId,
      analyticsState
    });
    
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Call is not in an active state',
        analyticsState,
        error: 'INVALID_STATE_FOR_LIVE_ANALYTICS'
      })
    };
  }
  
  // Calculate how long call has been active (using previously declared callStartTimestamp)
  const activeSeconds = Math.floor((Date.now() - callStartTimestamp) / 1000);
  
  // CRITICAL FIX: Generate ETag for idempotency and caching
  // ETag based on callId, timestamp, and last update time
  const etagSource = `${callId}-${analytics.timestamp}-${new Date(analytics.updatedAt).getTime()}`;
  const etag = Buffer.from(etagSource).toString('base64');
  
  // Check If-None-Match header for conditional GET support
  const clientETag = event.headers?.['If-None-Match'] || event.headers?.['if-none-match'];
  if (clientETag === etag) {
    return {
      statusCode: 304, // Not Modified
      headers: {
        ...corsHeaders,
        'ETag': etag,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
  }
  
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'ETag': etag,
      'Cache-Control': 'no-cache, must-revalidate',
      'X-Data-Version': analytics.timestamp.toString(),
      'X-Last-Updated': analytics.updatedAt
    },
    body: JSON.stringify({
      ...analytics,
      isLive: true, // Indicator that this is from the live endpoint
      fetchedAt: Date.now(),
      activeSeconds, // How long the call has been active
      lastUpdatedSeconds: Math.floor((Date.now() - new Date(analytics.updatedAt).getTime()) / 1000),
      etag // Include in response for client reference
    })
  };
}

async function getClinicAnalytics(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const clinicId = event.pathParameters?.clinicId;
  const queryParams = event.queryStringParameters || {};
  
  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Missing clinicId parameter' })
    };
  }
  
  // Check authorization using authorizer context
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
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
    : Math.floor(Date.now() / 1000) - (24 * 60 * 60); // Default: last 24 hours
  
  const endTime = queryParams.endTime
    ? parseInt(queryParams.endTime, 10)
    : Math.floor(Date.now() / 1000);
  
  // CRITICAL FIX: Validate time range
  const timeValidation = validateTimeRange(startTime, endTime);
  if (!timeValidation.valid) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify(timeValidation.error)
    };
  }
  
  // CRITICAL FIX #15: Pagination token validation with cryptographic signature verification
  let exclusiveStartKey: any = undefined;
  if (queryParams.lastEvaluatedKey) {
    // Use signed token verification
    const tokenResult = verifyPaginationToken(queryParams.lastEvaluatedKey, `clinic:${clinicId}`);
    
    if (!tokenResult.valid) {
      console.warn('[getClinicAnalytics] Token verification failed:', {
        error: tokenResult.error,
        requestedClinic: clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: `Invalid pagination token: ${tokenResult.error}`,
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    exclusiveStartKey = tokenResult.data;
    
    // Validate the structure has required keys
    if (!exclusiveStartKey || typeof exclusiveStartKey !== 'object') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: malformed structure',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    if (!exclusiveStartKey.clinicId || !exclusiveStartKey.timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: missing required fields (clinicId, timestamp)',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    // Additional validation: Validate token belongs to requested clinic
    if (exclusiveStartKey.clinicId !== clinicId) {
      console.warn('[getClinicAnalytics] Token clinic mismatch:', {
        requestedClinic: clinicId,
        tokenClinic: exclusiveStartKey.clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: does not match requested clinic',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
  }

  const limit = Math.min(parseInt(queryParams.limit || '100', 10), 100); // Max 100 per request

  // FIXED FLAW #14: Build filter expression for DynamoDB instead of filtering after fetch
  // This ensures we get full results even with filters applied
  let filterExpression = '';
  const filterValues: any = {
    ':clinicId': clinicId,
    ':start': startTime,
    ':end': endTime
  };
  const filterNames: any = { '#ts': 'timestamp' };

  if (queryParams.sentiment) {
    filterExpression = 'overallSentiment = :sentiment';
    filterValues[':sentiment'] = queryParams.sentiment;
  }

  if (queryParams.minDuration) {
    const minDuration = parseInt(queryParams.minDuration, 10);
    filterExpression = filterExpression
      ? `${filterExpression} AND totalDuration >= :minDuration`
      : 'totalDuration >= :minDuration';
    filterValues[':minDuration'] = minDuration;
  }

  if (queryParams.hasIssues === 'true') {
    filterExpression = filterExpression
      ? `${filterExpression} AND attribute_exists(detectedIssues) AND size(detectedIssues) > :zero`
      : 'attribute_exists(detectedIssues) AND size(detectedIssues) > :zero';
    filterValues[':zero'] = 0;
  }

  // Add call category filter
  if (queryParams.category) {
    filterExpression = filterExpression
      ? `${filterExpression} AND callCategory = :category`
      : 'callCategory = :category';
    filterValues[':category'] = queryParams.category;
  }

  // Query analytics for clinic
  const queryCommand: any = {
    TableName: ANALYTICS_TABLE_NAME,
    IndexName: 'clinicId-timestamp-index',
    KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: filterNames,
    ExpressionAttributeValues: filterValues,
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey
  };

  if (filterExpression) {
    queryCommand.FilterExpression = filterExpression;
  }

  const queryResult = await ddb.send(new QueryCommand(queryCommand));
  const analytics = queryResult.Items || [];
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      clinicId,
      startTime,
      endTime,
      totalCalls: analytics.length,
      calls: analytics,
      // **FLAW #10 FIX: Include signed pagination tokens**
      // CRITICAL FIX #15: Sign tokens to prevent tampering
      hasMore: !!queryResult.LastEvaluatedKey,
      lastEvaluatedKey: queryResult.LastEvaluatedKey
        ? signPaginationToken(queryResult.LastEvaluatedKey, `clinic:${clinicId}`)
        : null
    })
  };
}

async function getAgentAnalytics(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const agentId = event.pathParameters?.agentId;
  const queryParams = event.queryStringParameters || {};
  
  if (!agentId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Missing agentId parameter' })
    };
  }
  
  // Get allowed clinics and check admin status from authorizer context
  const requestingAgentId = userPerms.email;
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  
  if (!isAdmin && requestingAgentId !== agentId) {
    console.warn('[getAgentAnalytics] Unauthorized access attempt', {
      requestingAgentId,
      requestedAgentId: agentId,
      allowedClinics: Array.from(allowedClinics)
    });
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Forbidden: You can only view your own analytics',
        error: 'INSUFFICIENT_PERMISSIONS'
      })
    };
  }
  
  // FIX #6: Verify agent belongs to an authorized clinic (prevents cross-clinic data leak)
  if (isAdmin) {
    // For admins, verify the target agent belongs to one of their authorized clinics
    // Query ALL of agent's calls and verify each clinic is authorized (handles clinic transfers)
    // FIX: Increased limit and use pagination to check all clinics agent has worked at
    const agentClinicsSet = new Set<string>();
    let lastEvaluatedKey: any = undefined;
    let pageCount = 0;
    const MAX_PAGES = 10; // Check up to 1000 calls (100 per page)
    
    do {
      const sampleQuery = await ddb.send(new QueryCommand({
        TableName: ANALYTICS_TABLE_NAME,
        IndexName: 'agentId-timestamp-index',
        KeyConditionExpression: 'agentId = :agentId',
        ExpressionAttributeValues: { ':agentId': agentId },
        ProjectionExpression: 'clinicId',
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      
      // Collect all unique clinics
      if (sampleQuery.Items) {
        sampleQuery.Items.forEach(item => {
          if (item.clinicId) {
            agentClinicsSet.add(item.clinicId);
          }
        });
      }
      
      lastEvaluatedKey = sampleQuery.LastEvaluatedKey;
      pageCount++;
      
    } while (lastEvaluatedKey && pageCount < MAX_PAGES);
    
    const sampleQuery = { Items: Array.from(agentClinicsSet).map(clinicId => ({ clinicId })) };
    
    // SECURITY FIX: If agent has NO calls, check AgentPresence table for their clinic assignment
    if (!sampleQuery.Items || sampleQuery.Items.length === 0) {
      console.warn('[getAgentAnalytics] Agent has no call history, checking presence table', {
        requestingAgentId,
        requestedAgentId: agentId
      });
      
      // Query AgentPresence table to get clinic assignment
      const AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME;
      if (AGENT_PRESENCE_TABLE) {
        try {
          const presenceResult = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE,
            Key: { agentId }
          }));
          
          if (presenceResult.Item && presenceResult.Item.clinicId) {
            const agentClinicId = presenceResult.Item.clinicId;
            if (!hasClinicAccess(allowedClinics, agentClinicId)) {
              console.warn('[getAgentAnalytics] Admin attempted access to new agent in unauthorized clinic', {
                requestingAgentId,
                requestedAgentId: agentId,
                agentClinicId,
                allowedClinics: Array.from(allowedClinics)
              });
              return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ 
                  message: 'Forbidden: Agent belongs to a clinic you do not have access to',
                  error: 'CROSS_CLINIC_ACCESS_DENIED'
                })
              };
            }
          } else {
            // Agent not found in presence table either - may not exist
            return {
              statusCode: 404,
              headers: corsHeaders,
              body: JSON.stringify({ 
                message: 'Agent not found or has no clinic assignment',
                error: 'AGENT_NOT_FOUND'
              })
            };
          }
        } catch (err: any) {
          console.error('[getAgentAnalytics] Error checking agent presence:', err);
          // Continue - will return empty metrics
        }
      }
    } else {
      // SECURITY FIX: Verify ALL clinics agent has worked at are authorized
      const agentClinics = new Set(sampleQuery.Items.map(item => item.clinicId).filter(Boolean));
      
      for (const agentClinicId of agentClinics) {
        if (!hasClinicAccess(allowedClinics, agentClinicId)) {
          console.warn('[getAgentAnalytics] Admin attempted cross-clinic access', {
            requestingAgentId,
            requestedAgentId: agentId,
            agentClinicId,
            allowedClinics: Array.from(allowedClinics),
            note: 'Agent has worked at multiple clinics'
          });
          return {
            statusCode: 403,
            headers: corsHeaders,
            body: JSON.stringify({ 
              message: 'Forbidden: Agent has worked at clinics you do not have access to',
              error: 'CROSS_CLINIC_ACCESS_DENIED',
              hint: 'Agent may have transferred between clinics. You must have access to all clinics they worked at.'
            })
          };
        }
      }
    }
  }
  
  // Parse time range
  const startTime = queryParams.startTime 
    ? parseInt(queryParams.startTime, 10)
    : Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60); // Default: last 7 days
  
  const endTime = queryParams.endTime
    ? parseInt(queryParams.endTime, 10)
    : Math.floor(Date.now() / 1000);
  
  // CRITICAL FIX #15: Pagination token validation with cryptographic signature verification
  let exclusiveStartKey: any = undefined;
  if (queryParams.lastEvaluatedKey) {
    // Use signed token verification
    const tokenResult = verifyPaginationToken(queryParams.lastEvaluatedKey, `agent:${agentId}`);
    
    if (!tokenResult.valid) {
      console.warn('[getAgentAnalytics] Token verification failed:', {
        error: tokenResult.error,
        requestedAgent: agentId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: `Invalid pagination token: ${tokenResult.error}`,
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    exclusiveStartKey = tokenResult.data;
    
    // Validate the structure
    if (!exclusiveStartKey || typeof exclusiveStartKey !== 'object') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: malformed structure',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    if (!exclusiveStartKey.agentId || !exclusiveStartKey.timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: missing required fields (agentId, timestamp)',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    // Additional validation: Validate token belongs to requested agent
    if (exclusiveStartKey.agentId !== agentId) {
      console.warn('[getAgentAnalytics] Token agent mismatch:', {
        requestedAgent: agentId,
        tokenAgent: exclusiveStartKey.agentId,
        requestingUser: requestingAgentId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: does not match requested agent',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
  }

  const limit = Math.min(parseInt(queryParams.limit || '100', 10), 100);
  
  // Query analytics for agent
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    IndexName: 'agentId-timestamp-index',
    KeyConditionExpression: 'agentId = :agentId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':agentId': agentId,
      ':start': startTime,
      ':end': endTime
    },
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey
  }));

  const analytics = queryResult.Items || [];
  
  if (analytics.length === 0) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        agentId,
        totalCalls: 0,
        metrics: {},
        calls: [],
        hasMore: false,
        lastEvaluatedKey: null
      })
    };
  }
  
  // CRITICAL FIX: Detect if this is paginated data
  const isPaginated = !!queryParams.lastEvaluatedKey || !!queryResult.LastEvaluatedKey;
  
  // Calculate aggregate metrics from current page
  const pageMetrics = calculateAgentMetrics(analytics);
  
  // For paginated results, try to get pre-aggregated metrics from AgentPerformance table
  let fullMetrics = null;
  if (isPaginated && AGENT_PERFORMANCE_TABLE_NAME) {
    try {
      // Query AgentPerformance table for complete metrics
      const perfResult = await ddb.send(new QueryCommand({
        TableName: AGENT_PERFORMANCE_TABLE_NAME,
        KeyConditionExpression: 'agentId = :agentId AND periodDate BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':agentId': agentId,
          ':start': new Date(startTime * 1000).toISOString().split('T')[0],
          ':end': new Date(endTime * 1000).toISOString().split('T')[0]
        }
      }));
      
      if (perfResult.Items && perfResult.Items.length > 0) {
        // Aggregate performance records from AgentPerformance table
        fullMetrics = aggregatePerformanceRecords(perfResult.Items);
      } else {
        // CRITICAL FIX: Fallback to querying all call analytics if no pre-aggregated data
        console.log('[getAgentAnalytics] No pre-aggregated data, falling back to full scan');
        fullMetrics = await fetchAllAgentCallAnalytics(agentId, startTime, endTime);
      }
    } catch (err: any) {
      console.warn('[getAgentAnalytics] Could not fetch pre-aggregated metrics:', err.message);
      // Try fallback even on error
      try {
        fullMetrics = await fetchAllAgentCallAnalytics(agentId, startTime, endTime);
      } catch (fallbackErr: any) {
        console.error('[getAgentAnalytics] Fallback query also failed:', fallbackErr.message);
      }
    }
  }
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      agentId,
      startTime,
      endTime,
      // CRITICAL FIX: Distinguish between page-level and total counts with better clarity
      callsInPage: analytics.length,
      totalCalls: fullMetrics?.totalCalls !== undefined ? fullMetrics.totalCalls : analytics.length,
      totalCallsNote: fullMetrics?.totalCalls !== undefined 
        ? 'Complete total from pre-aggregated data'
        : 'Showing page total only - use pagination to get all records',
      // Provide both page-level and full metrics when available
      metrics: {
        page: {
          ...pageMetrics,
          _note: 'These metrics calculated from current page only',
          _isPageLevel: true,
          _scope: 'current_page'
        },
        ...(fullMetrics && {
          total: {
            ...fullMetrics,
            _note: 'These metrics calculated from complete dataset',
            _isComplete: true,
            _scope: 'all_calls_in_range'
          }
        })
      },
      calls: analytics,
      pagination: {
        hasMore: !!queryResult.LastEvaluatedKey,
        // CRITICAL FIX #15: Use signed pagination tokens
        lastEvaluatedKey: queryResult.LastEvaluatedKey
          ? signPaginationToken(queryResult.LastEvaluatedKey, `agent:${agentId}`)
          : null,
        isPaginated,
        warning: isPaginated && !fullMetrics
          ? 'Metrics are calculated from current page only. For complete metrics across all calls, aggregate all pages client-side or use the agent performance summary endpoint.'
          : null
      }
    })
  };
}

async function getAnalyticsSummary(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  
  // Check authorization if clinicId specified
  if (clinicId) {
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized' })
      };
    }
  } else {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'clinicId required for summary' })
    };
  }
  
  // Parse time range
  const startTime = queryParams.startTime 
    ? parseInt(queryParams.startTime, 10)
    : Math.floor(Date.now() / 1000) - (24 * 60 * 60); // Default: last 24 hours
  
  const endTime = queryParams.endTime
    ? parseInt(queryParams.endTime, 10)
    : Math.floor(Date.now() / 1000);
  
  // **FIXED: Add pagination support for large result sets to prevent timeout**
  const limit = Math.min(parseInt(queryParams.limit || '1000', 10), 1000); // Max 1000 per request
  let exclusiveStartKey: any = undefined;
  
  // CRITICAL FIX #5.1: Use signed pagination tokens for summary endpoint (matching clinic/agent endpoints)
  if (queryParams.lastEvaluatedKey) {
    // Use signed token verification for consistency and security
    const tokenResult = verifyPaginationToken(queryParams.lastEvaluatedKey, `summary:${clinicId}`);
    
    if (!tokenResult.valid) {
      console.warn('[getAnalyticsSummary] Token verification failed:', {
        error: tokenResult.error,
        requestedClinic: clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: `Invalid pagination token: ${tokenResult.error}`,
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    exclusiveStartKey = tokenResult.data;
    
    if (!exclusiveStartKey?.clinicId || !exclusiveStartKey?.timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: missing required fields',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
    
    // CRITICAL FIX #5.1: Validate token matches requested clinic (prevent cross-clinic access)
    if (exclusiveStartKey.clinicId !== clinicId) {
      console.warn('[getAnalyticsSummary] Token clinic mismatch - possible security issue:', {
        requestedClinic: clinicId,
        tokenClinic: exclusiveStartKey.clinicId
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: clinic mismatch',
          error: 'INVALID_PAGINATION_TOKEN'
        })
      };
    }
  }
  
  // Query analytics with pagination
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    IndexName: 'clinicId-timestamp-index',
    KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':start': startTime,
      ':end': endTime
    },
    Limit: limit,
    ExclusiveStartKey: exclusiveStartKey
  }));

  const analytics = queryResult.Items || [];
  
  // CRITICAL FIX: Detect partial data and provide clear warnings to client
  const isPartialData = !!queryResult.LastEvaluatedKey;
  const hitLimit = analytics.length >= limit;
  
  if (hitLimit && !queryParams.lastEvaluatedKey) {
    console.warn('[getAnalyticsSummary] Large result set detected. Client receiving partial data.', {
      clinicId,
      recordsReturned: analytics.length,
      limit
    });
  }
  
  // Calculate summary metrics
  const summary = calculateSummaryMetrics(analytics);
  
  // Add metadata about data completeness
  const dataCompleteness = {
    isComplete: !isPartialData,
    isPartial: isPartialData,
    recordsAnalyzed: analytics.length,
    estimatedTotalRecords: isPartialData ? '>' + analytics.length : analytics.length,
    dataQuality: isPartialData ? 'PARTIAL' : 'COMPLETE',
    warning: isPartialData 
      ? 'This summary is calculated from partial data. Metrics may not reflect complete picture. Use pagination to retrieve all records.'
      : null
  };
  
    // CRITICAL FIX #5.2: Add warning header for partial results
    const responseHeaders = {
      ...corsHeaders,
      ...(isPartialData && {
        'X-Data-Partial': 'true',
        'X-Data-Warning': 'Results are partial. Use pagination to get complete data.'
      })
    };
    
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        clinicId,
        startTime,
        endTime,
        summary: {
          ...summary,
          // CRITICAL: Add warning flags directly to summary object
          _isPartial: isPartialData,
          _warning: dataCompleteness.warning
        },
        dataCompleteness,
        pagination: {
          hasMore: !!queryResult.LastEvaluatedKey,
          // CRITICAL FIX #5.1: Use signed pagination tokens for summary
          lastEvaluatedKey: queryResult.LastEvaluatedKey
            ? signPaginationToken(queryResult.LastEvaluatedKey, `summary:${clinicId}`)
            : null,
          recordsInPage: analytics.length,
          limit
        }
      })
    };
  }

/**
 * CRITICAL FIX #14: Fallback function to fetch all call analytics when pre-aggregated data unavailable
 * Used for new agents or when AgentPerformance table has gaps
 * 
 * PERFORMANCE FIX: Added timeout protection and streaming approach to prevent Lambda timeout
 */
async function fetchAllAgentCallAnalytics(
  agentId: string,
  startTime: number,
  endTime: number
): Promise<any> {
  const allAnalytics: any[] = [];
  let lastEvaluatedKey: any = undefined;
  let pageCount = 0;
  const MAX_PAGES = 20; // Safety limit (100/page × 20 = 2000 max records)
  const MAX_DURATION_MS = 25000; // Max 25 seconds to leave buffer for response
  const startTimeMs = Date.now();
  let hitLimit = false;
  let hitTimeout = false;
  
  try {
    do {
      // CRITICAL FIX #14: Check elapsed time before each query to prevent Lambda timeout
      const elapsedMs = Date.now() - startTimeMs;
      if (elapsedMs > MAX_DURATION_MS) {
        hitTimeout = true;
        console.warn('[fetchAllAgentCallAnalytics] Approaching timeout limit - stopping early:', {
          agentId,
          recordsFetched: allAnalytics.length,
          elapsedMs,
          maxDurationMs: MAX_DURATION_MS
        });
        break;
      }
      
      const queryResult = await ddb.send(new QueryCommand({
        TableName: ANALYTICS_TABLE_NAME,
        IndexName: 'agentId-timestamp-index',
        KeyConditionExpression: 'agentId = :agentId AND #ts BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':agentId': agentId,
          ':start': startTime,
          ':end': endTime
        },
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      
      if (queryResult.Items) {
        allAnalytics.push(...queryResult.Items);
      }
      
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
      pageCount++;
      
      // Safety check to prevent infinite loops
      if (pageCount >= MAX_PAGES) {
        hitLimit = true;
        console.warn('[fetchAllAgentCallAnalytics] Hit max pages limit - INCOMPLETE DATA:', {
          agentId,
          recordsFetched: allAnalytics.length,
          warning: 'Metrics are incomplete for high-volume agents'
        });
        break;
      }
    } while (lastEvaluatedKey);
    
    // Calculate metrics from all fetched calls
    const isIncomplete = hitLimit || hitTimeout;
    const incompleteReason = hitTimeout 
      ? 'Query timeout - consider using a shorter time range'
      : hitLimit 
        ? 'Data incomplete: Agent has >2000 calls in range. Metrics calculated from first 2000 calls only.'
        : null;
    
    // CRITICAL FIX #5.2: Log warning for incomplete data to CloudWatch for monitoring
    if (isIncomplete) {
      console.warn('[fetchAllAgentCallAnalytics] INCOMPLETE_DATA_WARNING', {
        agentId,
        recordsFetched: allAnalytics.length,
        hitTimeout,
        hitLimit,
        elapsedMs: Date.now() - startTimeMs,
        recommendation: hitTimeout 
          ? 'Consider reducing time range or increasing Lambda memory'
          : 'Consider using pre-aggregated AgentPerformance table'
      });
    }
    
    return {
      ...calculateAgentMetrics(allAnalytics),
      totalCalls: allAnalytics.length,
      _source: 'fallback_full_scan',
      _pagesFetched: pageCount,
      _elapsedMs: Date.now() - startTimeMs,
      _isIncomplete: isIncomplete,
      _hitTimeout: hitTimeout,
      _warning: incompleteReason,
      _estimatedTotalCalls: isIncomplete ? `>${allAnalytics.length}` : allAnalytics.length,
      // CRITICAL FIX #5.2: Add explicit field for client to check
      dataQuality: isIncomplete ? 'PARTIAL' : 'COMPLETE'
    };
  } catch (err: any) {
    console.error('[fetchAllAgentCallAnalytics] Error fetching all analytics:', err.message);
    throw err;
  }
}

function calculateAgentMetrics(analytics: any[]): any {
  const totalCalls = analytics.length;
  
  if (totalCalls === 0) {
    return {
      averageDuration: 0,
      averageTalkPercentage: 0,
      sentimentBreakdown: {},
      categoryBreakdown: {},
      issuesDetected: 0,
      averageQualityScore: 0,
      weightedSentimentScore: 0
    };
  }
  
  const totalDuration = analytics.reduce((sum, a) => sum + (a.totalDuration || 0), 0);
  const totalTalkPercentage = analytics.reduce((sum, a) => 
    sum + (a.speakerMetrics?.agentTalkPercentage || 0), 0
  );
  
  // CRITICAL FIX: Track both counts AND weighted scores for sentiment
  const sentimentCounts = analytics.reduce((acc: any, a: any) => {
    const sentiment = a.overallSentiment || 'NEUTRAL';
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // CRITICAL FIX: Calculate weighted sentiment score (0-100 scale)
  // Uses actual sentiment scores from each call, not just categories
  const sentimentScores = analytics
    .filter(a => a.sentimentScore)
    .map(a => {
      const scores = a.sentimentScore;
      // Convert category scores to 0-100 scale
      // Positive = 75-100, Mixed = 40-60, Neutral = 50, Negative = 0-25
      if (scores.positive > 0.6) return 75 + (scores.positive * 25);
      if (scores.negative > 0.6) return 25 - (scores.negative * 25);
      if (scores.mixed > 0.4) return 50 + ((scores.positive - scores.negative) * 25);
      return 50; // Neutral default
    });
  
  const weightedSentimentScore = sentimentScores.length > 0
    ? Math.round(sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length)
    : 50;
  
  // Calculate category breakdown
  const categoryCounts = analytics.reduce((acc: any, a: any) => {
    const category = a.callCategory || 'uncategorized';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const totalIssues = analytics.reduce((sum, a) => 
    sum + (a.detectedIssues?.length || 0), 0
  );
  
  const qualityScores = analytics
    .filter(a => a.audioQuality?.qualityScore)
    .map(a => a.audioQuality.qualityScore);
  
  const averageQualityScore = qualityScores.length > 0
    ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length
    : 0;
  
  return {
    // FIX: Ensure division by zero is handled (totalCalls checked at start but adding safety)
    averageDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
    averageTalkPercentage: totalCalls > 0 ? Math.round(totalTalkPercentage / totalCalls) : 0,
    sentimentBreakdown: sentimentCounts,
    categoryBreakdown: categoryCounts,
    issuesDetected: totalIssues,
    averageQualityScore: qualityScores.length > 0 ? Math.round(averageQualityScore * 10) / 10 : 0,
    // CRITICAL FIX: Include weighted sentiment score for more nuanced analysis
    weightedSentimentScore,
    sentimentAnalysis: {
      categoryCounts: sentimentCounts,
      weightedScore: weightedSentimentScore,
      scoreInterpretation: 
        weightedSentimentScore >= 75 ? 'Highly Positive' :
        weightedSentimentScore >= 60 ? 'Positive' :
        weightedSentimentScore >= 40 ? 'Neutral/Mixed' :
        weightedSentimentScore >= 25 ? 'Negative' :
        'Highly Negative'
    }
  };
}

function calculateSummaryMetrics(analytics: any[]): any {
  const totalCalls = analytics.length;
  
  // CRITICAL FIX: Early return with proper structure if no data
  if (totalCalls === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      sentimentBreakdown: {},
      categoryBreakdown: {},
      topIssues: [],
      averageQualityScore: 0,
      callVolumeByHour: new Array(24).fill(0).map((count, hour) => ({ hour, count }))
    };
  }
  
  // Reuse agent metrics calculation
  const baseMetrics = calculateAgentMetrics(analytics);
  
  // Calculate top issues
  const issuesCounts = analytics.reduce((acc: any, a: any) => {
    (a.detectedIssues || []).forEach((issue: string) => {
      acc[issue] = (acc[issue] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);
  
  const topIssues = Object.entries(issuesCounts)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([issue, count]) => ({ issue, count }));
  
  // **FIXED: Add null safety and timezone support for callStartTime**
  const volumeByHour = new Array(24).fill(0);
  
  // CRITICAL FIX: Validate analytics array before accessing first element
  if (analytics.length === 0) {
    // Return early with empty volume data
    return volumeByHour.map((count, hour) => ({ hour, count }));
  }
  
  // CRITICAL FIX #10: Get clinic timezone with proper validation
  const clinicTimezone = analytics[0]?.clinicTimezone || analytics[0]?.timezone || 'UTC';
  
  // CRITICAL FIX #10: Validate timezone is a valid IANA timezone
  const validTimezone = (() => {
    try {
      // Test if timezone is valid by trying to format a date with it
      new Intl.DateTimeFormat('en-US', { timeZone: clinicTimezone }).format(new Date());
      return clinicTimezone;
    } catch (err) {
      console.warn('[calculateSummaryMetrics] Invalid timezone, using UTC:', {
        invalidTimezone: clinicTimezone,
        error: (err as Error).message
      });
      return 'UTC';
    }
  })();
  
  // CRITICAL FIX: DST handling - detect and normalize DST transitions
  let dstTransitionDetected = false;
  const hourCounts = new Map<number, number>();
  const dstMetadata = {
    isDSTDay: false,
    springForward: false, // Lost hour (2am doesn't exist)
    fallBack: false,      // Repeated hour (1am happens twice)
    affectedHour: -1
  };
  
  analytics.forEach(a => {
    if (a.callStartTime) {
      try {
        // Convert to clinic's local timezone for accurate hour calculation
        const callDate = new Date(a.callStartTime);
        
        // CRITICAL FIX #10: Validate date before timezone conversion
        if (isNaN(callDate.getTime())) {
          console.warn('[calculateSummaryMetrics] Invalid date:', {
            callStartTime: a.callStartTime,
            callId: a.callId
          });
          return;
        }
        
        // CRITICAL FIX #10: Use validated timezone for conversion
        const hour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            hour12: false,
            timeZone: validTimezone
          }).format(callDate),
          10
        );
        
        // CRITICAL FIX #10: Enhanced hour validation with DST handling
        if (!isNaN(hour) && hour >= 0 && hour < 24) {
          volumeByHour[hour]++;
          hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        } else {
          dstTransitionDetected = true;
          console.warn('[calculateSummaryMetrics] Hour outside 0-23 range (DST?):', {
            hour,
            callStartTime: a.callStartTime,
            timezone: validTimezone,
            originalTimezone: clinicTimezone
          });
        }
      } catch (err: any) {
        console.warn('[calculateSummaryMetrics] Error converting timezone:', {
          callStartTime: a.callStartTime,
          timezone: validTimezone,
          error: err.message,
          callId: a.callId
        });
        // CRITICAL FIX #10: Fallback to UTC if timezone conversion fails
        try {
          const fallbackHour = new Date(a.callStartTime).getUTCHours();
          if (!isNaN(fallbackHour) && fallbackHour >= 0 && fallbackHour < 24) {
            volumeByHour[fallbackHour]++;
            hourCounts.set(fallbackHour, (hourCounts.get(fallbackHour) || 0) + 1);
          }
        } catch (fallbackErr) {
          console.error('[calculateSummaryMetrics] Failed fallback hour calculation:', fallbackErr);
        }
      }
    }
  });
  
  // CRITICAL FIX: Detect and flag DST transition days
  if (hourCounts.size === 23) {
    // Spring forward: one hour is missing (typically 2am)
    dstMetadata.isDSTDay = true;
    dstMetadata.springForward = true;
    
    // Find missing hour
    for (let h = 0; h < 24; h++) {
      if (!hourCounts.has(h)) {
        dstMetadata.affectedHour = h;
        break;
      }
    }
    
    console.warn('[calculateSummaryMetrics] DST Spring Forward detected:', {
      timezone: validTimezone,
      missingHour: dstMetadata.affectedHour,
      note: 'Hour-based metrics show 23 hours for this day'
    });
  } else if (hourCounts.size === 25 || hourCounts.size > 24) {
    // Fall back: one hour repeats (typically 1am happens twice)
    dstMetadata.isDSTDay = true;
    dstMetadata.fallBack = true;
    
    console.warn('[calculateSummaryMetrics] DST Fall Back detected:', {
      timezone: validTimezone,
      uniqueHours: hourCounts.size,
      note: 'Hour-based metrics show 25 hours for this day'
    });
  }
  
  return {
    totalCalls,
    ...baseMetrics,
    topIssues,
    callVolumeByHour: volumeByHour.map((count, hour) => ({ hour, count })),
    // CRITICAL FIX: Include DST metadata for accurate client-side interpretation
    dstMetadata: dstMetadata.isDSTDay ? {
      isDSTDay: true,
      type: dstMetadata.springForward ? 'spring_forward' : 'fall_back',
      affectedHour: dstMetadata.affectedHour,
      expectedHours: dstMetadata.springForward ? 23 : 25,
      warning: dstMetadata.springForward 
        ? `DST spring forward: Hour ${dstMetadata.affectedHour} does not exist on this day`
        : 'DST fall back: One hour is repeated on this day'
    } : null
  };
}

/**
 * CRITICAL FIX: Aggregate pre-calculated performance records from AgentPerformance table
 * Used when paginated agent analytics queries need complete metrics
 */
function aggregatePerformanceRecords(records: any[]): any {
  if (records.length === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      averageTalkPercentage: 0,
      sentimentBreakdown: {},
      categoryBreakdown: {},
      issuesDetected: 0,
      averageQualityScore: 0
    };
  }
  
  // Sum up all metrics across daily records
  const totals = records.reduce((acc, record) => ({
    totalCalls: acc.totalCalls + (record.totalCalls || 0),
    inboundCalls: acc.inboundCalls + (record.inboundCalls || 0),
    outboundCalls: acc.outboundCalls + (record.outboundCalls || 0),
    totalTalkTime: acc.totalTalkTime + (record.totalTalkTime || 0),
    totalHandleTime: acc.totalHandleTime + (record.totalHandleTime || 0),
    sentimentScores: {
      positive: acc.sentimentScores.positive + (record.sentimentScores?.positive || 0),
      negative: acc.sentimentScores.negative + (record.sentimentScores?.negative || 0),
      neutral: acc.sentimentScores.neutral + (record.sentimentScores?.neutral || 0),
      mixed: acc.sentimentScores.mixed + (record.sentimentScores?.mixed || 0)
    }
  }), {
    totalCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    totalTalkTime: 0,
    totalHandleTime: 0,
    sentimentScores: { positive: 0, negative: 0, neutral: 0, mixed: 0 }
  });
  
  // Calculate averages
  const averageDuration = totals.totalCalls > 0 
    ? Math.round(totals.totalHandleTime / totals.totalCalls)
    : 0;
  
  const totalSentimentCalls = 
    totals.sentimentScores.positive + 
    totals.sentimentScores.negative + 
    totals.sentimentScores.neutral + 
    totals.sentimentScores.mixed;
  
  return {
    totalCalls: totals.totalCalls,
    inboundCalls: totals.inboundCalls,
    outboundCalls: totals.outboundCalls,
    averageDuration,
    sentimentBreakdown: totals.sentimentScores,
    periodStart: records[0]?.periodDate,
    periodEnd: records[records.length - 1]?.periodDate,
    daysIncluded: records.length
  };
}

// ========================================
// Agent Rankings Endpoint
// ========================================

/**
 * GET /analytics/rankings
 * Returns agent rankings for a clinic based on performance metrics
 * 
 * Query Parameters:
 * - clinicId: Required. Clinic to get rankings for
 * - period: Optional. 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom' (default: 'weekly')
 * - criteria: Optional. Ranking criteria (default: 'performanceScore')
 * - startTime: Optional. Start timestamp for custom period
 * - endTime: Optional. End timestamp for custom period
 * - limit: Optional. Max agents to return (default: 50, max: 100)
 * - includeInactive: Optional. Include agents with 0 calls (default: false)
 */
async function getAgentRankings(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  
  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'clinicId query parameter is required',
        error: 'MISSING_CLINIC_ID'
      })
    };
  }
  
  // Check authorization
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Forbidden: You do not have access to this clinic',
        error: 'INSUFFICIENT_PERMISSIONS'
      })
    };
  }
  
  // Parse ranking options
  const period = (queryParams.period || 'weekly') as RankingPeriod;
  const criteria = (queryParams.criteria || 'performanceScore') as RankingCriteria;
  const limit = Math.min(parseInt(queryParams.limit || '50', 10), 100);
  const includeInactive = queryParams.includeInactive === 'true';
  
  // Calculate time range based on period
  const now = Math.floor(Date.now() / 1000);
  let startTime: number;
  let endTime = now;
  let periodLabel: string;
  
  if (period === 'custom') {
    startTime = queryParams.startTime ? parseInt(queryParams.startTime, 10) : now - (7 * 24 * 60 * 60);
    endTime = queryParams.endTime ? parseInt(queryParams.endTime, 10) : now;
    periodLabel = `Custom: ${new Date(startTime * 1000).toLocaleDateString()} - ${new Date(endTime * 1000).toLocaleDateString()}`;
  } else {
    const periodConfig = getPeriodConfig(period, now);
    startTime = periodConfig.startTime;
    endTime = periodConfig.endTime;
    periodLabel = periodConfig.label;
  }
  
  // Validate time range
  const timeValidation = validateTimeRange(startTime, endTime);
  if (!timeValidation.valid) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify(timeValidation.error)
    };
  }
  
  console.log('[getAgentRankings] Fetching rankings', {
    clinicId,
    period,
    criteria,
    startTime,
    endTime,
    limit
  });
  
  try {
    // Fetch all call analytics for the clinic in the time range
    const allAnalytics = await fetchClinicCallAnalytics(clinicId, startTime, endTime);
    
    if (allAnalytics.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          clinicId,
          period: { type: period, startTime, endTime, label: periodLabel },
          criteria,
          rankings: [],
          totalAgents: 0,
          clinicStats: {
            avgPerformanceScore: 0,
            totalCalls: 0,
            avgSentimentScore: 0,
            avgHandleTime: 0
          },
          highlights: {
            topPerformer: null,
            mostImproved: null,
            callLeader: null,
            sentimentLeader: null
          },
          generatedAt: new Date().toISOString(),
          dataCompleteness: 'complete'
        } as AgentRankingsResponse)
      };
    }
    
    // Group analytics by agent
    const agentAnalyticsMap = new Map<string, any[]>();
    allAnalytics.forEach(record => {
      if (!record.agentId) return;
      
      if (!agentAnalyticsMap.has(record.agentId)) {
        agentAnalyticsMap.set(record.agentId, []);
      }
      agentAnalyticsMap.get(record.agentId)!.push(record);
    });
    
    // Get today's timestamp range for today-specific metrics
    const todayStart = getTodayStartTimestamp();
    const todayEnd = now;
    
    // Fetch today's analytics for each agent
    const todayAnalytics = await fetchClinicCallAnalytics(clinicId, todayStart, todayEnd);
    const agentTodayMap = new Map<string, any[]>();
    todayAnalytics.forEach(record => {
      if (!record.agentId) return;
      if (!agentTodayMap.has(record.agentId)) {
        agentTodayMap.set(record.agentId, []);
      }
      agentTodayMap.get(record.agentId)!.push(record);
    });
    
    // Fetch agent presence data (status)
    const agentIds = Array.from(agentAnalyticsMap.keys());
    const agentPresenceMap = await fetchAgentPresenceData(agentIds, clinicId);
    
    // Fetch agent names from staff table
    const agentNamesMap = await fetchAgentNames(agentIds);
    
    // Calculate metrics for each agent
    const agentMetrics: AgentRankingEntry[] = [];
    
    for (const [agentId, agentCalls] of agentAnalyticsMap.entries()) {
      if (agentCalls.length === 0 && !includeInactive) continue;
      
      const todayCalls = agentTodayMap.get(agentId) || [];
      const presence = agentPresenceMap.get(agentId);
      const nameInfo = agentNamesMap.get(agentId);
      
      const metrics = calculateAgentRankingMetrics(
        agentId, 
        agentCalls, 
        clinicId, 
        todayCalls,
        presence,
        nameInfo
      );
      agentMetrics.push(metrics);
    }
    
    // Sort by the specified criteria
    const sortedMetrics = sortAgentsByCriteria(agentMetrics, criteria);
    
    // Assign ranks and rank labels
    sortedMetrics.forEach((agent, index) => {
      agent.rank = index + 1;
      agent.rankLabel = formatRankLabel(index + 1);
    });
    
    // Apply limit
    const topAgents = sortedMetrics.slice(0, limit);
    
    // Assign badges
    topAgents.forEach(agent => {
      agent.badges = calculateAgentBadges(agent, sortedMetrics);
    });
    
    // Calculate clinic-wide stats
    const clinicStats = calculateClinicStats(allAnalytics);
    
    // Calculate highlights
    const highlights = calculateHighlights(sortedMetrics);
    
    // Fetch previous period data for trend calculation
    const previousPeriod = getPreviousPeriod(period, startTime, endTime);
    const previousAnalytics = await fetchClinicCallAnalytics(clinicId, previousPeriod.startTime, previousPeriod.endTime);
    
    // Calculate trends
    if (previousAnalytics.length > 0) {
      const previousAgentMap = new Map<string, any[]>();
      previousAnalytics.forEach(record => {
        if (!record.agentId) return;
        if (!previousAgentMap.has(record.agentId)) {
          previousAgentMap.set(record.agentId, []);
        }
        previousAgentMap.get(record.agentId)!.push(record);
      });
      
      const previousMetrics = Array.from(previousAgentMap.entries()).map(([agentId, calls]) => 
        calculateAgentRankingMetrics(agentId, calls, clinicId)
      );
      const previousSorted = sortAgentsByCriteria(previousMetrics, criteria);
      previousSorted.forEach((agent, index) => {
        agent.rank = index + 1;
      });
      
      // Update trends for current agents
      topAgents.forEach(agent => {
        const previousAgent = previousSorted.find(p => p.agentId === agent.agentId);
        if (previousAgent) {
          const rankChange = previousAgent.rank - agent.rank;
          const scoreChange = agent.performanceScore - previousAgent.performanceScore;
          
          agent.trend = {
            direction: rankChange > 0 ? 'up' : rankChange < 0 ? 'down' : 'stable',
            changePercent: previousAgent.performanceScore > 0 
              ? Math.round((scoreChange / previousAgent.performanceScore) * 100)
              : 0,
            previousRank: previousAgent.rank
          };
        }
      });
    }
    
    const response: AgentRankingsResponse = {
      clinicId,
      period: {
        type: period,
        startTime,
        endTime,
        label: periodLabel
      },
      criteria,
      rankings: topAgents,
      totalAgents: sortedMetrics.length,
      clinicStats,
      highlights,
      generatedAt: new Date().toISOString(),
      dataCompleteness: allAnalytics.length >= 2000 ? 'partial' : 'complete',
      warning: allAnalytics.length >= 2000 
        ? 'Large dataset - results may be incomplete. Consider using a shorter time period.'
        : undefined
    };
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
    
  } catch (error: any) {
    console.error('[getAgentRankings] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Failed to fetch agent rankings',
        error: error.message
      })
    };
  }
}

/**
 * Fetch all call analytics for a clinic within a time range
 */
async function fetchClinicCallAnalytics(
  clinicId: string,
  startTime: number,
  endTime: number
): Promise<any[]> {
  const allAnalytics: any[] = [];
  let lastEvaluatedKey: any = undefined;
  let pageCount = 0;
  const MAX_PAGES = 20; // Safety limit
  
  do {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: ANALYTICS_TABLE_NAME,
      IndexName: 'clinicId-timestamp-index',
      KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':start': startTime,
        ':end': endTime
      },
      Limit: 100,
      ExclusiveStartKey: lastEvaluatedKey
    }));
    
    if (queryResult.Items) {
      allAnalytics.push(...queryResult.Items);
    }
    
    lastEvaluatedKey = queryResult.LastEvaluatedKey;
    pageCount++;
    
  } while (lastEvaluatedKey && pageCount < MAX_PAGES);
  
  return allAnalytics;
}

/**
 * Calculate ranking metrics for a single agent
 */
function calculateAgentRankingMetrics(
  agentId: string,
  calls: any[],
  clinicId: string,
  todayCalls: any[] = [],
  presence?: { status: string; },
  nameInfo?: { givenName?: string; familyName?: string; }
): AgentRankingEntry {
  const totalCalls = calls.length;
  const completedCalls = calls.filter(c => c.callStatus === 'completed').length;
  const missedCalls = calls.filter(c => c.callStatus === 'abandoned' || c.callStatus === 'failed').length;
  
  // Today's specific metrics
  const callsToday = todayCalls.length;
  const missedToday = todayCalls.filter(c => c.callStatus === 'abandoned' || c.callStatus === 'failed').length;
  
  // Duration metrics
  const totalDuration = calls.reduce((sum, c) => sum + (c.totalDuration || 0), 0);
  const totalTalkTime = calls.reduce((sum, c) => sum + (c.talkTime || c.speakerMetrics?.agentTalkPercentage / 100 * (c.totalDuration || 0) || 0), 0);
  const totalHoldTime = calls.reduce((sum, c) => sum + (c.holdTime || 0), 0);
  
  // Sentiment breakdown
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  calls.forEach(c => {
    const sentiment = c.overallSentiment?.toLowerCase() || 'neutral';
    if (sentimentCounts[sentiment as keyof typeof sentimentCounts] !== undefined) {
      sentimentCounts[sentiment as keyof typeof sentimentCounts]++;
    }
  });
  
  const totalSentimentCalls = sentimentCounts.positive + sentimentCounts.negative + sentimentCounts.neutral + sentimentCounts.mixed;
  
  // Calculate weighted sentiment score (0-100)
  // Positive = 100, Neutral = 50, Mixed = 50, Negative = 0
  const sentimentScore = totalSentimentCalls > 0
    ? Math.round((
        (sentimentCounts.positive * 100) +
        (sentimentCounts.neutral * 50) +
        (sentimentCounts.mixed * 50) +
        (sentimentCounts.negative * 0)
      ) / totalSentimentCalls)
    : 50;
  
  // Calculate satisfaction rating (positive calls percentage with minimum threshold)
  // Uses a slightly more generous formula: positive + (neutral * 0.7) to account for neutral being OK
  const satisfactionRating = totalSentimentCalls > 0
    ? Math.round(((sentimentCounts.positive + sentimentCounts.neutral * 0.7) / totalSentimentCalls) * 100)
    : 50;
  
  // Issue count
  const issueCount = calls.reduce((sum, c) => sum + (c.detectedIssues?.length || 0), 0);
  
  // Audio quality average
  const qualityScores = calls
    .filter(c => c.audioQuality?.qualityScore)
    .map(c => c.audioQuality.qualityScore);
  const qualityScore = qualityScores.length > 0
    ? Math.round((qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length) * 10) / 10
    : 3; // Default to 3 (average)
  
  // Calculate performance score (0-100)
  // Factors: completion rate (40%), sentiment (30%), efficiency (20%), quality (10%)
  const completionRate = totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0;
  const issueFreeFactor = totalCalls > 0 ? Math.max(0, 100 - (issueCount / totalCalls * 50)) : 100;
  const qualityFactor = ((qualityScore - 1) / 4) * 100; // Convert 1-5 to 0-100
  
  const performanceScore = Math.round(
    (completionRate * 0.4) +
    (sentimentScore * 0.3) +
    (issueFreeFactor * 0.2) +
    (qualityFactor * 0.1)
  );
  
  // Calculate average handle time
  const avgHandleTime = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
  
  // Format agent name and initials
  const firstName = nameInfo?.givenName || '';
  const lastName = nameInfo?.familyName || '';
  const agentName = firstName && lastName 
    ? `${firstName} ${lastName}` 
    : firstName || lastName || agentId.split('@')[0];
  const initials = getInitials(firstName, lastName, agentId);
  
  // Get agent status
  const { status, statusLabel } = formatAgentStatus(presence?.status);
  
  return {
    rank: 0, // Will be assigned after sorting
    rankLabel: '', // Will be assigned after sorting
    agentId,
    agentName,
    firstName,
    lastName,
    initials,
    clinicId,
    status,
    statusLabel,
    performanceScore: Math.min(100, Math.max(0, performanceScore)),
    totalCalls,
    completedCalls,
    missedCalls,
    callsToday,
    missedToday,
    sentimentScore,
    satisfactionRating,
    positiveCallsPercent: totalSentimentCalls > 0 ? Math.round((sentimentCounts.positive / totalSentimentCalls) * 100) : 0,
    negativeCallsPercent: totalSentimentCalls > 0 ? Math.round((sentimentCounts.negative / totalSentimentCalls) * 100) : 0,
    avgHandleTime,
    avgHandleTimeFormatted: formatDuration(avgHandleTime),
    avgTalkTime: totalCalls > 0 ? Math.round(totalTalkTime / totalCalls) : 0,
    avgHoldTime: totalCalls > 0 ? Math.round(totalHoldTime / totalCalls) : 0,
    issueCount,
    qualityScore,
    trend: {
      direction: 'stable',
      changePercent: 0
    }
  };
}

/**
 * Sort agents by the specified criteria
 */
function sortAgentsByCriteria(agents: AgentRankingEntry[], criteria: RankingCriteria): AgentRankingEntry[] {
  const sortFns: Record<RankingCriteria, (a: AgentRankingEntry, b: AgentRankingEntry) => number> = {
    performanceScore: (a, b) => b.performanceScore - a.performanceScore,
    callVolume: (a, b) => b.totalCalls - a.totalCalls,
    sentimentScore: (a, b) => b.sentimentScore - a.sentimentScore,
    avgHandleTime: (a, b) => a.avgHandleTime - b.avgHandleTime, // Lower is better
    customerSatisfaction: (a, b) => b.positiveCallsPercent - a.positiveCallsPercent,
    efficiency: (a, b) => {
      // Efficiency = high completion rate + low issues + reasonable handle time
      const efficiencyA = (a.completedCalls / Math.max(1, a.totalCalls)) * 100 - (a.issueCount * 5);
      const efficiencyB = (b.completedCalls / Math.max(1, b.totalCalls)) * 100 - (b.issueCount * 5);
      return efficiencyB - efficiencyA;
    }
  };
  
  return [...agents].sort(sortFns[criteria] || sortFns.performanceScore);
}

/**
 * Calculate badges for an agent based on their performance
 */
function calculateAgentBadges(agent: AgentRankingEntry, allAgents: AgentRankingEntry[]): AgentBadge[] {
  const badges: AgentBadge[] = [];
  const earnedAt = new Date().toISOString();
  
  // Top Performer - Rank #1
  if (agent.rank === 1) {
    badges.push({ ...AGENT_BADGES.TOP_PERFORMER, earnedAt });
  }
  
  // Call Champion - 100+ calls
  if (agent.totalCalls >= 100) {
    badges.push({ ...AGENT_BADGES.CALL_CHAMPION, earnedAt });
  }
  
  // Sentiment Star - 90%+ positive
  if (agent.positiveCallsPercent >= 90) {
    badges.push({ ...AGENT_BADGES.SENTIMENT_STAR, earnedAt });
  }
  
  // Speed Demon - Below average handle time with good quality
  const avgHandleTime = allAgents.reduce((sum, a) => sum + a.avgHandleTime, 0) / allAgents.length;
  if (agent.avgHandleTime < avgHandleTime * 0.8 && agent.qualityScore >= 3.5) {
    badges.push({ ...AGENT_BADGES.SPEED_DEMON, earnedAt });
  }
  
  // Rising Star - Improved 20%+
  if (agent.trend.direction === 'up' && agent.trend.changePercent >= 20) {
    badges.push({ ...AGENT_BADGES.RISING_STAR, earnedAt });
  }
  
  // Zero Issues - Flawless
  if (agent.totalCalls >= 10 && agent.issueCount === 0) {
    badges.push({ ...AGENT_BADGES.ZERO_ISSUES, earnedAt });
  }
  
  // Customer Favorite - 95%+ satisfaction
  if (agent.positiveCallsPercent >= 95 && agent.totalCalls >= 20) {
    badges.push({ ...AGENT_BADGES.CUSTOMER_FAVORITE, earnedAt });
  }
  
  return badges;
}

/**
 * Calculate clinic-wide statistics
 */
function calculateClinicStats(analytics: any[]): AgentRankingsResponse['clinicStats'] {
  if (analytics.length === 0) {
    return {
      avgPerformanceScore: 0,
      totalCalls: 0,
      avgSentimentScore: 0,
      avgHandleTime: 0
    };
  }
  
  const totalCalls = analytics.length;
  const totalDuration = analytics.reduce((sum, c) => sum + (c.totalDuration || 0), 0);
  
  // Sentiment breakdown
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  analytics.forEach(c => {
    const sentiment = c.overallSentiment?.toLowerCase() || 'neutral';
    if (sentimentCounts[sentiment as keyof typeof sentimentCounts] !== undefined) {
      sentimentCounts[sentiment as keyof typeof sentimentCounts]++;
    }
  });
  
  const totalSentimentCalls = Object.values(sentimentCounts).reduce((a, b) => a + b, 0);
  const avgSentimentScore = totalSentimentCalls > 0
    ? Math.round((
        (sentimentCounts.positive * 100) +
        (sentimentCounts.neutral * 50) +
        (sentimentCounts.mixed * 50) +
        (sentimentCounts.negative * 0)
      ) / totalSentimentCalls)
    : 50;
  
  // Calculate average performance (simplified - just use sentiment and completion)
  const completedCalls = analytics.filter(c => c.callStatus === 'completed').length;
  const completionRate = (completedCalls / totalCalls) * 100;
  const avgPerformanceScore = Math.round((completionRate * 0.5) + (avgSentimentScore * 0.5));
  
  return {
    avgPerformanceScore,
    totalCalls,
    avgSentimentScore,
    avgHandleTime: Math.round(totalDuration / totalCalls)
  };
}

/**
 * Calculate leaderboard highlights
 */
function calculateHighlights(sortedAgents: AgentRankingEntry[]): AgentRankingsResponse['highlights'] {
  if (sortedAgents.length === 0) {
    return {
      topPerformer: null,
      mostImproved: null,
      callLeader: null,
      sentimentLeader: null
    };
  }
  
  // Top performer is already first in the sorted list
  const topPerformer = sortedAgents[0];
  
  // Most improved - highest positive trend change
  const mostImproved = [...sortedAgents]
    .filter(a => a.trend.direction === 'up')
    .sort((a, b) => b.trend.changePercent - a.trend.changePercent)[0] || null;
  
  // Call leader - most calls
  const callLeader = [...sortedAgents]
    .sort((a, b) => b.totalCalls - a.totalCalls)[0] || null;
  
  // Sentiment leader - highest sentiment score
  const sentimentLeader = [...sortedAgents]
    .sort((a, b) => b.sentimentScore - a.sentimentScore)[0] || null;
  
  return {
    topPerformer,
    mostImproved,
    callLeader,
    sentimentLeader
  };
}

/**
 * Get period configuration (start time, end time, label)
 */
function getPeriodConfig(period: RankingPeriod, now: number): { startTime: number; endTime: number; label: string } {
  const nowDate = new Date(now * 1000);
  
  switch (period) {
    case 'daily': {
      const startOfDay = new Date(nowDate);
      startOfDay.setHours(0, 0, 0, 0);
      return {
        startTime: Math.floor(startOfDay.getTime() / 1000),
        endTime: now,
        label: `Today (${nowDate.toLocaleDateString()})`
      };
    }
    
    case 'weekly': {
      const startOfWeek = new Date(nowDate);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return {
        startTime: Math.floor(startOfWeek.getTime() / 1000),
        endTime: now,
        label: `Week of ${startOfWeek.toLocaleDateString()}`
      };
    }
    
    case 'monthly': {
      const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
      return {
        startTime: Math.floor(startOfMonth.getTime() / 1000),
        endTime: now,
        label: `${nowDate.toLocaleString('default', { month: 'long' })} ${nowDate.getFullYear()}`
      };
    }
    
    case 'quarterly': {
      const quarter = Math.floor(nowDate.getMonth() / 3);
      const startOfQuarter = new Date(nowDate.getFullYear(), quarter * 3, 1);
      return {
        startTime: Math.floor(startOfQuarter.getTime() / 1000),
        endTime: now,
        label: `Q${quarter + 1} ${nowDate.getFullYear()}`
      };
    }
    
    case 'yearly': {
      const startOfYear = new Date(nowDate.getFullYear(), 0, 1);
      return {
        startTime: Math.floor(startOfYear.getTime() / 1000),
        endTime: now,
        label: `${nowDate.getFullYear()}`
      };
    }
    
    default:
      // Default to weekly
      const defaultStart = new Date(nowDate);
      defaultStart.setDate(defaultStart.getDate() - 7);
      return {
        startTime: Math.floor(defaultStart.getTime() / 1000),
        endTime: now,
        label: `Last 7 days`
      };
  }
}

/**
 * Get previous period for trend comparison
 */
function getPreviousPeriod(
  period: RankingPeriod,
  currentStart: number,
  currentEnd: number
): { startTime: number; endTime: number } {
  const duration = currentEnd - currentStart;
  
  return {
    startTime: currentStart - duration,
    endTime: currentStart - 1
  };
}

/**
 * Get today's start timestamp (midnight local time)
 */
function getTodayStartTimestamp(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
}

/**
 * Fetch agent presence data for multiple agents
 */
async function fetchAgentPresenceData(
  agentIds: string[],
  clinicId: string
): Promise<Map<string, { status: string }>> {
  const presenceMap = new Map<string, { status: string }>();
  
  if (!AGENT_PRESENCE_TABLE_NAME || agentIds.length === 0) {
    return presenceMap;
  }
  
  try {
    // Batch get presence data (DynamoDB BatchGetItem supports up to 100 items)
    const batches: string[][] = [];
    for (let i = 0; i < agentIds.length; i += 100) {
      batches.push(agentIds.slice(i, i + 100));
    }
    
    for (const batch of batches) {
      const keys = batch.map(agentId => ({ agentId }));
      
      const result = await ddb.send(new BatchGetCommand({
        RequestItems: {
          [AGENT_PRESENCE_TABLE_NAME]: {
            Keys: keys,
            ProjectionExpression: 'agentId, #status',
            ExpressionAttributeNames: { '#status': 'status' }
          }
        }
      }));
      
      const responses = result.Responses?.[AGENT_PRESENCE_TABLE_NAME] || [];
      responses.forEach((item: any) => {
        presenceMap.set(item.agentId, { status: item.status || 'Offline' });
      });
    }
    
    // Set Offline for agents not found in presence table
    agentIds.forEach(agentId => {
      if (!presenceMap.has(agentId)) {
        presenceMap.set(agentId, { status: 'Offline' });
      }
    });
    
  } catch (error: any) {
    console.error('[fetchAgentPresenceData] Error:', error.message);
    // Return empty map, agents will show as Offline
  }
  
  return presenceMap;
}

/**
 * Fetch agent names from staff user table
 * CRITICAL FIX #5.3: Added proper error handling and schema detection
 */
async function fetchAgentNames(
  agentIds: string[]
): Promise<Map<string, { givenName?: string; familyName?: string }>> {
  const namesMap = new Map<string, { givenName?: string; familyName?: string }>();
  
  if (!STAFF_USER_TABLE_NAME || agentIds.length === 0) {
    return namesMap;
  }
  
  try {
    // Batch get staff user data
    const batches: string[][] = [];
    for (let i = 0; i < agentIds.length; i += 100) {
      batches.push(agentIds.slice(i, i + 100));
    }
    
    for (const batch of batches) {
      const keys = batch.map(email => ({ email: email.toLowerCase() }));
      
      try {
        const result = await ddb.send(new BatchGetCommand({
          RequestItems: {
            [STAFF_USER_TABLE_NAME]: {
              Keys: keys,
              ProjectionExpression: 'email, givenName, familyName'
            }
          }
        }));
        
        const responses = result.Responses?.[STAFF_USER_TABLE_NAME] || [];
        responses.forEach((item: any) => {
          namesMap.set(item.email, {
            givenName: item.givenName,
            familyName: item.familyName
          });
        });
        
        // CRITICAL FIX #5.3: Handle unprocessed keys
        const unprocessedKeys = result.UnprocessedKeys?.[STAFF_USER_TABLE_NAME]?.Keys;
        if (unprocessedKeys && unprocessedKeys.length > 0) {
          console.warn('[fetchAgentNames] Some keys were not processed:', {
            unprocessedCount: unprocessedKeys.length,
            totalInBatch: batch.length
          });
        }
        
      } catch (batchErr: any) {
        // CRITICAL FIX #5.3: Handle schema mismatch errors specifically
        if (batchErr.name === 'ValidationException' && batchErr.message.includes('key')) {
          console.error('[fetchAgentNames] Table schema mismatch - email may not be the partition key:', {
            tableName: STAFF_USER_TABLE_NAME,
            error: batchErr.message,
            hint: 'Verify STAFF_USER_TABLE schema has email as partition key'
          });
          // Return early - no point retrying with wrong schema
          return namesMap;
        }
        throw batchErr;
      }
    }
    
  } catch (error: any) {
    console.error('[fetchAgentNames] Error fetching agent names:', {
      error: error.message,
      tableName: STAFF_USER_TABLE_NAME,
      agentCount: agentIds.length
    });
    // Return empty map, names will fall back to email
  }
  
  return namesMap;
}

/**
 * Format rank as ordinal (1st, 2nd, 3rd, #4, etc.)
 */
function formatRankLabel(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `#${rank}`;
}

/**
 * Format duration in seconds to M:SS or H:MM:SS format
 */
function formatDuration(seconds: number): string {
  if (seconds < 0) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get initials from first name and last name
 */
function getInitials(firstName: string, lastName: string, email: string): string {
  if (firstName && lastName) {
    return `${firstName.charAt(0).toUpperCase()}${lastName.charAt(0).toUpperCase()}`;
  }
  if (firstName) {
    return firstName.substring(0, 2).toUpperCase();
  }
  if (lastName) {
    return lastName.substring(0, 2).toUpperCase();
  }
  // Fall back to email
  const emailName = email.split('@')[0];
  return emailName.substring(0, 2).toUpperCase();
}

/**
 * Format agent status to display-friendly format
 */
function formatAgentStatus(status?: string): { status: AgentStatus; statusLabel: string } {
  const normalizedStatus = status?.toLowerCase() || 'offline';
  
  switch (normalizedStatus) {
    case 'online':
      return { status: 'Available', statusLabel: 'Available' };
    case 'oncall':
    case 'on_call':
      return { status: 'OnCall', statusLabel: 'On Call' };
    case 'ringing':
      return { status: 'ringing', statusLabel: 'Ringing' };
    case 'dialing':
      return { status: 'dialing', statusLabel: 'Dialing' };
    case 'busy':
      return { status: 'Busy', statusLabel: 'Busy' };
    case 'offline':
    default:
      return { status: 'Offline', statusLabel: 'Offline' };
  }
}

// ========================================
// Queue Calls Endpoint
// ========================================

/**
 * Queue call status types
 */
type QueueCallStatus = 'queued' | 'ringing' | 'connected' | 'active' | 'on_hold' | 'transferring';

/**
 * Individual call in queue
 */
interface QueueCallEntry {
  callId: string;
  phoneNumber: string;
  callerName?: string;
  queuePosition: number;
  status: QueueCallStatus;
  statusLabel: string;
  priority: 'vip' | 'high' | 'normal' | 'low';
  priorityLabel: string;
  
  // Time metrics
  waitTime: number;  // seconds
  waitTimeFormatted: string;  // "M:SS"
  queuedAt: string;  // ISO date
  
  // Assignment info
  assignedAgentId?: string;
  assignedAgentName?: string;
  
  // Call metadata
  direction: 'inbound' | 'outbound';
  isVip: boolean;
  callbackRequested?: boolean;
}

/**
 * Queue calls response
 */
interface QueueCallsResponse {
  clinicId: string;
  
  // Calls by status
  queuedCalls: QueueCallEntry[];
  ringingCalls: QueueCallEntry[];
  activeCalls: QueueCallEntry[];
  onHoldCalls: QueueCallEntry[];
  
  // Summary counts
  summary: {
    totalQueued: number;
    totalRinging: number;
    totalActive: number;
    totalOnHold: number;
    avgWaitTime: number;
    avgWaitTimeFormatted: string;
    longestWait: number;
    longestWaitFormatted: string;
  };
  
  // Metadata
  generatedAt: string;
}

/**
 * GET /analytics/queue
 * Returns all calls in queue with their status and details
 * 
 * Query Parameters:
 * - clinicId: Required. Clinic to get queue for
 * - status: Optional. Filter by status ('queued', 'ringing', 'active', 'on_hold', 'all')
 * - limit: Optional. Max calls to return (default: 100)
 */
async function getQueueCalls(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  
  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'clinicId query parameter is required',
        error: 'MISSING_CLINIC_ID'
      })
    };
  }
  
  // Check authorization
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Forbidden: You do not have access to this clinic',
        error: 'INSUFFICIENT_PERMISSIONS'
      })
    };
  }
  
  // Check if CallQueue table is configured
  if (!CALL_QUEUE_TABLE_NAME) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Call queue table not configured',
        error: 'MISSING_CONFIGURATION'
      })
    };
  }
  
  const statusFilter = queryParams.status || 'all';
  const limit = Math.min(parseInt(queryParams.limit || '100', 10), 500);
  
  console.log('[getQueueCalls] Fetching queue calls', {
    clinicId,
    statusFilter,
    limit
  });
  
  try {
    // Query all calls for this clinic from CallQueue table
    const allCalls: any[] = [];
    let lastEvaluatedKey: any = undefined;
    
    do {
      const queryResult = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: {
          ':clinicId': clinicId
        },
        Limit: 200,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      
      if (queryResult.Items) {
        allCalls.push(...queryResult.Items);
      }
      
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
      
      // Stop if we have enough calls
      if (allCalls.length >= limit * 2) break;
      
    } while (lastEvaluatedKey);
    
    const now = Date.now();
    
    // Process and categorize calls
    const queuedCalls: QueueCallEntry[] = [];
    const ringingCalls: QueueCallEntry[] = [];
    const activeCalls: QueueCallEntry[] = [];
    const onHoldCalls: QueueCallEntry[] = [];
    
    let totalWaitTime = 0;
    let waitingCount = 0;
    let longestWait = 0;
    
    for (const call of allCalls) {
      const callStatus = call.status?.toLowerCase() || 'unknown';
      
      // Skip completed/ended calls
      if (['completed', 'ended', 'abandoned', 'failed', 'hungup'].includes(callStatus)) {
        continue;
      }
      
      // Calculate wait time
      const queueEntryTime = call.queueEntryTime 
        ? (typeof call.queueEntryTime === 'number' 
            ? (call.queueEntryTime > 9999999999 ? call.queueEntryTime : call.queueEntryTime * 1000)
            : new Date(call.queueEntryTime).getTime())
        : call.queueEntryTimeIso 
          ? new Date(call.queueEntryTimeIso).getTime() 
          : now;
      
      const waitTime = Math.max(0, Math.floor((now - queueEntryTime) / 1000));
      
      // Determine priority
      const isVip = call.isVip || call.priority === 'vip' || call.vipStatus === true;
      const priority = isVip ? 'vip' : (call.priority || 'normal');
      
      const queueCall: QueueCallEntry = {
        callId: call.callId,
        phoneNumber: call.phoneNumber || call.callerPhone || 'Unknown',
        callerName: call.callerName || call.customerName,
        queuePosition: call.queuePosition || 0,
        status: callStatus as QueueCallStatus,
        statusLabel: formatQueueStatus(callStatus),
        priority: priority as QueueCallEntry['priority'],
        priorityLabel: formatPriority(priority),
        waitTime,
        waitTimeFormatted: formatDuration(waitTime),
        queuedAt: call.queueEntryTimeIso || new Date(queueEntryTime).toISOString(),
        assignedAgentId: call.assignedAgentId || call.agentId,
        assignedAgentName: call.assignedAgentName,
        direction: call.direction || 'inbound',
        isVip,
        callbackRequested: call.callbackRequested || false
      };
      
      // Categorize by status
      switch (callStatus) {
        case 'queued':
        case 'waiting':
          queuedCalls.push(queueCall);
          totalWaitTime += waitTime;
          waitingCount++;
          longestWait = Math.max(longestWait, waitTime);
          break;
        case 'ringing':
          ringingCalls.push(queueCall);
          break;
        case 'connected':
        case 'active':
          activeCalls.push(queueCall);
          break;
        case 'on_hold':
        case 'hold':
          onHoldCalls.push(queueCall);
          break;
      }
    }
    
    // Sort queued calls by position and priority
    queuedCalls.sort((a, b) => {
      // VIP calls first
      if (a.isVip && !b.isVip) return -1;
      if (!a.isVip && b.isVip) return 1;
      // Then by queue position
      return a.queuePosition - b.queuePosition;
    });
    
    // Apply status filter if specified
    let response: QueueCallsResponse;
    
    if (statusFilter !== 'all') {
      const filteredCalls = {
        queued: statusFilter === 'queued' ? queuedCalls.slice(0, limit) : [],
        ringing: statusFilter === 'ringing' ? ringingCalls.slice(0, limit) : [],
        active: statusFilter === 'active' ? activeCalls.slice(0, limit) : [],
        on_hold: statusFilter === 'on_hold' ? onHoldCalls.slice(0, limit) : []
      };
      
      response = {
        clinicId,
        queuedCalls: filteredCalls.queued,
        ringingCalls: filteredCalls.ringing,
        activeCalls: filteredCalls.active,
        onHoldCalls: filteredCalls.on_hold,
        summary: {
          totalQueued: queuedCalls.length,
          totalRinging: ringingCalls.length,
          totalActive: activeCalls.length,
          totalOnHold: onHoldCalls.length,
          avgWaitTime: waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0,
          avgWaitTimeFormatted: formatDuration(waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0),
          longestWait,
          longestWaitFormatted: formatDuration(longestWait)
        },
        generatedAt: new Date().toISOString()
      };
    } else {
      response = {
        clinicId,
        queuedCalls: queuedCalls.slice(0, limit),
        ringingCalls: ringingCalls.slice(0, limit),
        activeCalls: activeCalls.slice(0, limit),
        onHoldCalls: onHoldCalls.slice(0, limit),
        summary: {
          totalQueued: queuedCalls.length,
          totalRinging: ringingCalls.length,
          totalActive: activeCalls.length,
          totalOnHold: onHoldCalls.length,
          avgWaitTime: waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0,
          avgWaitTimeFormatted: formatDuration(waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0),
          longestWait,
          longestWaitFormatted: formatDuration(longestWait)
        },
        generatedAt: new Date().toISOString()
      };
    }
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
    
  } catch (error: any) {
    console.error('[getQueueCalls] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Failed to fetch queue calls',
        error: error.message
      })
    };
  }
}

/**
 * Format queue call status to display-friendly label
 */
function formatQueueStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'queued':
    case 'waiting':
      return 'Waiting';
    case 'ringing':
      return 'Ringing';
    case 'connected':
    case 'active':
      return 'Active';
    case 'on_hold':
    case 'hold':
      return 'On Hold';
    case 'transferring':
      return 'Transferring';
    default:
      return status || 'Unknown';
  }
}

/**
 * Format priority to display-friendly label
 */
function formatPriority(priority: string): string {
  switch (priority?.toLowerCase()) {
    case 'vip':
      return 'VIP';
    case 'high':
      return 'High';
    case 'normal':
      return 'Normal';
    case 'low':
      return 'Low';
    default:
      return 'Normal';
  }
}

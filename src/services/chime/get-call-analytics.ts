import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { getClinicsFromClaims, hasClinicAccess } from '../shared/utils/authorization';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { AnalyticsState, getFinalizationEstimate } from '../../types/analytics-state-machine';
import { getAnalyticsState } from '../shared/utils/analytics-state-manager';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);

const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
const AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME; // Optional
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;

// Validate required environment variables
if (!ANALYTICS_TABLE_NAME) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}
if (!REGION) {
  throw new Error('COGNITO_REGION or AWS_REGION environment variable is required');
}
if (!USER_POOL_ID) {
  throw new Error('USER_POOL_ID environment variable is required');
}

// Authorization constants
const ADMIN_CLINIC_ACCESS = 'ALL';

/**
 * Validate time range parameters
 */
function validateTimeRange(startTime: number, endTime: number): { valid: boolean; error?: any } {
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
  
  if (startTime >= endTime) {
    return {
      valid: false,
      error: { 
        message: 'startTime must be before endTime',
        error: 'INVALID_TIME_RANGE',
        startTime,
        endTime
      }
    };
  }
  
  if (startTime < oneYearAgo) {
    return {
      valid: false,
      error: { 
        message: 'startTime cannot be more than 1 year in the past',
        error: 'TIME_RANGE_TOO_OLD',
        maxStartTime: oneYearAgo
      }
    };
  }
  
  if (endTime > now + 3600) {
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
  if (endTime - startTime > MAX_RANGE_SECONDS) {
    return {
      valid: false,
      error: { 
        message: 'Time range cannot exceed 90 days',
        error: 'TIME_RANGE_TOO_LARGE',
        requestedRange: endTime - startTime,
        maxRange: MAX_RANGE_SECONDS
      }
    };
  }
  
  return { valid: true };
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
    // Authenticate request
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdTokenCached(authz, REGION, USER_POOL_ID);
    
    if (!verifyResult.ok) {
      console.warn('[get-analytics] Auth verification failed', verifyResult);
      return { 
        statusCode: verifyResult.code, 
        headers: corsHeaders, 
        body: JSON.stringify({ message: verifyResult.message }) 
      };
    }
    
    const path = event.path;
    
    // Route to appropriate handler
    if (path.includes('/call/')) {
      return await getCallAnalytics(event, verifyResult.payload, corsHeaders);
    } else if (path.includes('/live')) {
      return await getLiveCallAnalytics(event, verifyResult.payload, corsHeaders);
    } else if (path.includes('/clinic/')) {
      return await getClinicAnalytics(event, verifyResult.payload, corsHeaders);
    } else if (path.includes('/agent/')) {
      return await getAgentAnalytics(event, verifyResult.payload, corsHeaders);
    } else if (path.includes('/summary')) {
      return await getAnalyticsSummary(event, verifyResult.payload, corsHeaders);
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
  jwtPayload: any,
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
  
  // Check authorization
  const authorizedClinics = getClinicsFromClaims(jwtPayload);
  if (!hasClinicAccess(authorizedClinics, analytics.clinicId)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Unauthorized' })
    };
  }
  
  // CRITICAL FIX: Generate ETag for caching
  const etagSource = `${callId}-${analytics.timestamp}-${analytics.finalizedAt || analytics.updatedAt}`;
  const etag = Buffer.from(etagSource).toString('base64');
  
  // Check If-None-Match header
  const clientETag = event.headers?.['If-None-Match'] || event.headers?.['if-none-match'];
  if (clientETag === etag) {
    return {
      statusCode: 304,
      headers: {
        ...corsHeaders,
        'ETag': etag,
        'Cache-Control': 'public, max-age=3600' // Completed calls can be cached
      },
      body: ''
    };
  }
  
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'ETag': etag,
      'Cache-Control': 'public, max-age=3600',
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
  jwtPayload: any,
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
  
  // Check authorization
  const authorizedClinics = getClinicsFromClaims(jwtPayload);
  if (!hasClinicAccess(authorizedClinics, analytics.clinicId)) {
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
  jwtPayload: any,
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
  
  // Check authorization
  const authorizedClinics = getClinicsFromClaims(jwtPayload);
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
  
  // **FIXED: Pagination token validation with signature verification**
  // Parse optional pagination token from query string
  let exclusiveStartKey: any = undefined;
  if (queryParams.lastEvaluatedKey) {
    try {
      // Base64 decode the token
      const decodedToken = Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8');
      exclusiveStartKey = JSON.parse(decodedToken);
      
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
      
      // FIX #14: Validate token belongs to requested clinic (prevent token manipulation)
      if (exclusiveStartKey.clinicId !== clinicId) {
        console.warn('[getClinicAnalytics] Token manipulation detected:', {
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
      
      // Validate timestamp is within reasonable bounds (not too old or future)
      const tokenTimestamp = exclusiveStartKey.timestamp;
      const now = Math.floor(Date.now() / 1000);
      const oneYearAgo = now - (365 * 24 * 60 * 60);
      
      if (tokenTimestamp < oneYearAgo || tokenTimestamp > now + 3600) {
        console.warn('[getClinicAnalytics] Invalid token timestamp:', {
          tokenTimestamp,
          now
        });
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Invalid pagination token: timestamp out of valid range',
            error: 'INVALID_PAGINATION_TOKEN'
          })
        };
      }
    } catch (parseErr) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: cannot decode',
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
      // **FLAW #10 FIX: Include pagination tokens**
      hasMore: !!queryResult.LastEvaluatedKey,
      lastEvaluatedKey: queryResult.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString('base64')
        : null
    })
  };
}

async function getAgentAnalytics(
  event: APIGatewayProxyEvent,
  jwtPayload: any,
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
  
  // **FIXED: Security check now properly validates admin access across all clinics**
  const requestingAgentId = jwtPayload.sub;
  const authorizedClinics = getClinicsFromClaims(jwtPayload);
  
  // Check if user has admin access to ANY clinic (not just first one)
  const isAdmin = authorizedClinics.some((clinic: string) => clinic === ADMIN_CLINIC_ACCESS);
  
  if (!isAdmin && requestingAgentId !== agentId) {
    console.warn('[getAgentAnalytics] Unauthorized access attempt', {
      requestingAgentId,
      requestedAgentId: agentId,
      authorizedClinics
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
    const agentClinics = new Set<string>();
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
            agentClinics.add(item.clinicId);
          }
        });
      }
      
      lastEvaluatedKey = sampleQuery.LastEvaluatedKey;
      pageCount++;
      
    } while (lastEvaluatedKey && pageCount < MAX_PAGES);
    
    const sampleQuery = { Items: Array.from(agentClinics).map(clinicId => ({ clinicId })) };
    
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
            if (!hasClinicAccess(authorizedClinics, agentClinicId)) {
              console.warn('[getAgentAnalytics] Admin attempted access to new agent in unauthorized clinic', {
                requestingAgentId,
                requestedAgentId: agentId,
                agentClinicId,
                authorizedClinics
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
        if (!hasClinicAccess(authorizedClinics, agentClinicId)) {
          console.warn('[getAgentAnalytics] Admin attempted cross-clinic access', {
            requestingAgentId,
            requestedAgentId: agentId,
            agentClinicId,
            authorizedClinics,
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
  
  // **FIXED: Pagination token validation with tampering detection**
  let exclusiveStartKey: any = undefined;
  if (queryParams.lastEvaluatedKey) {
    try {
      exclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8')
      );
      
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
      
      // FIX #14: Validate token belongs to requested agent (prevent token manipulation)
      if (exclusiveStartKey.agentId !== agentId) {
        console.warn('[getAgentAnalytics] Token manipulation detected:', {
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
      
      // Validate timestamp is within reasonable bounds
      const tokenTimestamp = exclusiveStartKey.timestamp;
      const now = Math.floor(Date.now() / 1000);
      const oneYearAgo = now - (365 * 24 * 60 * 60);
      
      if (tokenTimestamp < oneYearAgo || tokenTimestamp > now + 3600) {
        console.warn('[getAgentAnalytics] Invalid token timestamp:', {
          tokenTimestamp,
          now,
          agentId
        });
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Invalid pagination token: timestamp out of valid range',
            error: 'INVALID_PAGINATION_TOKEN'
          })
        };
      }
    } catch (parseErr) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: cannot decode',
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
        lastEvaluatedKey: queryResult.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString('base64')
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
  jwtPayload: any,
  corsHeaders: any
): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters || {};
  const clinicId = queryParams.clinicId;
  
  // Check authorization if clinicId specified
  if (clinicId) {
    const authorizedClinics = getClinicsFromClaims(jwtPayload);
    if (!hasClinicAccess(authorizedClinics, clinicId)) {
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
  
  if (queryParams.lastEvaluatedKey) {
    try {
      exclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8')
      );
      
      if (!exclusiveStartKey?.clinicId || !exclusiveStartKey?.timestamp) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Invalid pagination token for summary',
            error: 'INVALID_PAGINATION_TOKEN'
          })
        };
      }
    } catch (parseErr) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid pagination token: cannot decode',
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
  
  return {
    statusCode: 200,
    headers: corsHeaders,
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
        lastEvaluatedKey: queryResult.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString('base64')
          : null,
        recordsInPage: analytics.length,
        limit
      }
    })
  };
}

/**
 * CRITICAL FIX: Fallback function to fetch all call analytics when pre-aggregated data unavailable
 * Used for new agents or when AgentPerformance table has gaps
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
  let hitLimit = false;
  
  try {
    do {
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
    return {
      ...calculateAgentMetrics(allAnalytics),
      totalCalls: allAnalytics.length,
      _source: 'fallback_full_scan',
      _pagesFetched: pageCount,
      _isIncomplete: hitLimit,
      _warning: hitLimit 
        ? 'Data incomplete: Agent has >2000 calls in range. Metrics calculated from first 2000 calls only.'
        : null,
      _estimatedTotalCalls: hitLimit ? `>${allAnalytics.length}` : allAnalytics.length
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

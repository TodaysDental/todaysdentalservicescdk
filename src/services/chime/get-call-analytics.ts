import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { getClinicsFromClaims, hasClinicAccess } from '../shared/utils/authorization';
import { buildCorsHeaders } from '../../shared/utils/cors';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);

const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;

// Authorization constants
const ADMIN_CLINIC_ACCESS = 'ALL';

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
    const verifyResult = await verifyIdTokenCached(authz, REGION!, USER_POOL_ID!);
    
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
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(analytics)
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
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      ...analytics,
      isLive: true, // Indicator that this is from the live endpoint
      fetchedAt: Date.now()
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
  
  // **FLAW #10 FIX: Add pagination support with lastEvaluatedKey**
  // Parse optional pagination token from query string
  let exclusiveStartKey: any = undefined;
  if (queryParams.lastEvaluatedKey) {
    try {
      // Base64 decode the token
      exclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8')
      );
      
      // Validate the structure has required keys
      if (!exclusiveStartKey || typeof exclusiveStartKey !== 'object') {
        console.warn('[get-analytics] Invalid pagination token structure, starting from beginning');
        exclusiveStartKey = undefined;
      } else if (!exclusiveStartKey.callId || !exclusiveStartKey.timestamp) {
        console.warn('[get-analytics] Pagination token missing required fields, starting from beginning');
        exclusiveStartKey = undefined;
      }
    } catch (parseErr) {
      console.warn('[get-analytics] Invalid pagination token, starting from beginning');
      exclusiveStartKey = undefined;
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
  
  // Security: Agents can only view their own analytics unless they're admin
  const requestingAgentId = jwtPayload.sub;
  const authorizedClinics = getClinicsFromClaims(jwtPayload);
  const isAdmin = authorizedClinics[0] === ADMIN_CLINIC_ACCESS;
  
  if (!isAdmin && requestingAgentId !== agentId) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Forbidden' })
    };
  }
  
  // Parse time range
  const startTime = queryParams.startTime 
    ? parseInt(queryParams.startTime, 10)
    : Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60); // Default: last 7 days
  
  const endTime = queryParams.endTime
    ? parseInt(queryParams.endTime, 10)
    : Math.floor(Date.now() / 1000);
  
  // **FLAW #10 FIX: Add pagination support**
  let exclusiveStartKey: any = undefined;
  if (queryParams.lastEvaluatedKey) {
    try {
      exclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8')
      );
      
      // Validate the structure
      if (!exclusiveStartKey || typeof exclusiveStartKey !== 'object') {
        console.warn('[get-analytics] Invalid pagination token structure in agent analytics');
        exclusiveStartKey = undefined;
      } else if (!exclusiveStartKey.agentId || !exclusiveStartKey.timestamp) {
        console.warn('[get-analytics] Pagination token missing required fields in agent analytics');
        exclusiveStartKey = undefined;
      }
    } catch (parseErr) {
      console.warn('[get-analytics] Invalid pagination token in agent analytics');
      exclusiveStartKey = undefined;
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
  
  // Calculate aggregate metrics
  const metrics = calculateAgentMetrics(analytics);
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      agentId,
      startTime,
      endTime,
      totalCalls: analytics.length,
      metrics,
      calls: analytics,
      // **FLAW #10 FIX: Include pagination info**
      hasMore: !!queryResult.LastEvaluatedKey,
      lastEvaluatedKey: queryResult.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString('base64')
        : null
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
  
  // Query analytics
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    IndexName: 'clinicId-timestamp-index',
    KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':start': startTime,
      ':end': endTime
    }
  }));

  const analytics = queryResult.Items || [];
  
  // Calculate summary metrics
  const summary = calculateSummaryMetrics(analytics);
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      clinicId,
      startTime,
      endTime,
      summary
    })
  };
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
      averageQualityScore: 0
    };
  }
  
  const totalDuration = analytics.reduce((sum, a) => sum + (a.totalDuration || 0), 0);
  const totalTalkPercentage = analytics.reduce((sum, a) => 
    sum + (a.speakerMetrics?.agentTalkPercentage || 0), 0
  );
  
  const sentimentCounts = analytics.reduce((acc: any, a: any) => {
    const sentiment = a.overallSentiment || 'NEUTRAL';
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
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
    averageQualityScore: qualityScores.length > 0 ? Math.round(averageQualityScore * 10) / 10 : 0
  };
}

function calculateSummaryMetrics(analytics: any[]): any {
  const totalCalls = analytics.length;
  
  if (totalCalls === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      sentimentBreakdown: {},
      categoryBreakdown: {},
      topIssues: [],
      averageQualityScore: 0,
      callVolumeByHour: []
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
  
  // FIXED FLAW #16: Add null safety for callStartTime
  const volumeByHour = new Array(24).fill(0);
  analytics.forEach(a => {
    if (a.callStartTime) {
      try {
        const hour = new Date(a.callStartTime).getHours();
        if (!isNaN(hour) && hour >= 0 && hour < 24) {
          volumeByHour[hour]++;
        }
      } catch (err) {
        console.warn('[calculateSummaryMetrics] Invalid callStartTime:', a.callStartTime);
      }
    }
  });
  
  return {
    totalCalls,
    ...baseMetrics,
    topIssues,
    callVolumeByHour: volumeByHour.map((count, hour) => ({ hour, count }))
  };
}

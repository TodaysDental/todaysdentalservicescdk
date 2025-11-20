import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { verifyIdTokenCached } from '../shared/utils/jwt-verification';
import { getClinicsFromClaims, hasClinicAccess } from '../shared/utils/authorization';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);

const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;

/**
 * Lambda handler for retrieving call analytics
 * 
 * Endpoints:
 * GET /analytics/call/{callId} - Get analytics for specific call
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
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
  
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
  
  // Query analytics for clinic
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
    Limit: parseInt(queryParams.limit || '100', 10)
  }));

  let analytics = queryResult.Items || [];
  
  // Apply filters
  if (queryParams.sentiment) {
    analytics = analytics.filter(a => 
      a.overallSentiment === queryParams.sentiment
    );
  }
  
  if (queryParams.minDuration) {
    const minDuration = parseInt(queryParams.minDuration, 10);
    analytics = analytics.filter(a => 
      (a.totalDuration || 0) >= minDuration
    );
  }
  
  if (queryParams.hasIssues === 'true') {
    analytics = analytics.filter(a =>
      a.detectedIssues && a.detectedIssues.length > 0
    );
  }
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      clinicId,
      startTime,
      endTime,
      totalCalls: analytics.length,
      calls: analytics
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
  const isAdmin = authorizedClinics[0] === 'ALL';
  
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
    }
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
        calls: []
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
      calls: analytics
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
    averageDuration: Math.round(totalDuration / totalCalls),
    averageTalkPercentage: Math.round(totalTalkPercentage / totalCalls),
    sentimentBreakdown: sentimentCounts,
    issuesDetected: totalIssues,
    averageQualityScore: Math.round(averageQualityScore * 10) / 10
  };
}

function calculateSummaryMetrics(analytics: any[]): any {
  const totalCalls = analytics.length;
  
  if (totalCalls === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      sentimentBreakdown: {},
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
  
  // Calculate call volume by hour
  const volumeByHour = new Array(24).fill(0);
  analytics.forEach(a => {
    const hour = new Date(a.callStartTime).getHours();
    volumeByHour[hour]++;
  });
  
  return {
    totalCalls,
    ...baseMetrics,
    topIssues,
    callVolumeByHour: volumeByHour.map((count, hour) => ({ hour, count }))
  };
}

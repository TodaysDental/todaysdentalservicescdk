import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  getUserPermissions,
  getAllowedClinicIds,
  hasClinicAccess,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { buildCorsHeaders } from '../../shared/utils/cors';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const CALL_ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
const AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;

// Validate required environment variables
if (!CALL_QUEUE_TABLE_NAME) {
  throw new Error('CALL_QUEUE_TABLE_NAME environment variable is required');
}
if (!CALL_ANALYTICS_TABLE_NAME) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}

/**
 * Call Center Dashboard Response Interface
 * Provides all metrics needed for a unified call center dashboard view
 * 
 * NOTE: This interface matches the documented API format in ANALYTICS-STACK-API.md
 */
export interface CallCenterDashboardResponse {
  // Real-time metrics for live call center status
  realTimeMetrics: {
    agentsOnline: number;       // Total agents logged in
    agentsOnCall: number;       // Agents currently on calls
    agentsAvailable: number;    // Agents available to take calls
    callsInQueue: number;       // Calls waiting in queue
    callsRinging: number;       // Calls currently ringing
    activeCalls: number;        // Calls currently active/connected
    callsOnHold: number;        // Calls currently on hold
    averageWaitTime: number;    // Average queue wait time in seconds
    longestWait: number;        // Longest current wait in seconds
    serviceLevelPercent: number; // Service level percentage (calls answered within threshold)
  };

  // Today's aggregated metrics
  todayMetrics: {
    totalCalls: number;         // Total calls today
    inboundCalls: number;       // Inbound calls today
    outboundCalls: number;      // Outbound calls today
    completedCalls: number;     // Calls completed/answered today
    abandonedCalls: number;     // Calls abandoned by caller
    missedCalls: number;        // Calls missed/failed
    averageHandleTime: number;  // Average handle time in seconds
    averageWaitTime: number;    // Average wait time for today's calls
    averageTalkTime: number;    // Average talk time in seconds
  };

  // Today's sentiment analysis
  sentimentToday: {
    positive: number;           // Count of positive sentiment calls
    negative: number;           // Count of negative sentiment calls
    neutral: number;            // Count of neutral sentiment calls
    mixed: number;              // Count of mixed sentiment calls
    averageScore: number;       // Average sentiment score (0-100)
  };

  // Hourly call volume for today
  hourlyVolume: Array<{
    hour: number;               // Hour of day (0-23)
    calls: number;              // Total calls this hour
    avgWait: number;            // Average wait time this hour
  }>;

  // Current agent statuses (optional, may be empty for performance)
  agentStatus?: Array<{
    agentId: string;
    name: string;
    status: string;
    currentCallDuration?: number;
    callsToday?: number;
  }>;

  // Active alerts
  alerts: Array<{
    type: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    value?: number;
    threshold?: number;
  }>;

  // Metadata
  clinicId: string;
  generatedAt: string;
  timezone?: string;
  
  // Legacy fields for backward compatibility
  // TODO: Remove after mobile app migration
  liveStatus?: {
    activeCalls: number;
    waitingCalls: number;
    onHoldCalls: number;
    ringingCalls: number;
    onlineAgents: number;
  };
  todaysPerformance?: {
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    abandonedCalls: number;
    avgDuration: number;
    avgDurationFormatted: string;
  };
  waitTimeMetrics?: {
    avgWaitTime: number;
    avgWaitTimeFormatted: string;
    longestWait: number;
    longestWaitFormatted: string;
  };
  qualityMetrics?: {
    satisfactionRate: number;
    positiveCallsPercent: number;
    negativeCallsPercent: number;
    avgSentimentScore: number;
  };
  callVolumeByHour?: Array<{ hour: number; count: number }>;
}

/**
 * Lambda handler for unified call center dashboard metrics
 * 
 * GET /analytics/dashboard?clinicId={clinicId}
 * 
 * Returns all call center metrics in a single API call for dashboard rendering
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[CallCenterDashboard] Function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
    requestId: event.requestContext?.requestId
  });

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

    // Check authorization - ensure userPerms is not null
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Unable to retrieve user permissions',
          error: 'INVALID_PERMISSIONS'
        })
      };
    }

    const allowedClinics = getAllowedClinicIds(
      userPerms.clinicRoles, 
      userPerms.isSuperAdmin, 
      userPerms.isGlobalSuperAdmin
    );
    
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized access to clinic' })
      };
    }

    // Get timezone from query or default to clinic's timezone
    const timezone = queryParams.timezone || 'America/New_York';

    // Calculate today's date range in the specified timezone
    const { startOfDay, endOfDay, todayDate } = getTodayRange(timezone);
    const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    const endTimestamp = Math.floor(endOfDay.getTime() / 1000);

    // Execute all queries in parallel for performance
    const [
      liveStatusResult,
      todaysAnalyticsResult,
      agentPresenceResult
    ] = await Promise.all([
      getLiveCallStatus(clinicId),
      getTodaysAnalytics(clinicId, startTimestamp, endTimestamp),
      getOnlineAgentsCount(clinicId)
    ]);

    // Calculate derived metrics
    const agentsOnCall = liveStatusResult.activeCalls;
    const agentsOnline = agentPresenceResult.onlineAgents;
    const agentsAvailable = Math.max(0, agentsOnline - agentsOnCall);
    
    // Calculate service level (calls answered within 30 seconds threshold)
    // Using a simple proxy: if there are no waiting calls, service level is 100%
    // Otherwise, use ratio of answered calls to total calls
    const serviceLevelPercent = todaysAnalyticsResult.totalCalls > 0
      ? Math.round((todaysAnalyticsResult.answeredCalls / todaysAnalyticsResult.totalCalls) * 100)
      : 100;

    // Generate alerts based on current metrics
    const alerts: CallCenterDashboardResponse['alerts'] = [];
    
    if (liveStatusResult.avgWaitTime > 60) {
      alerts.push({
        type: 'high_wait_time',
        severity: liveStatusResult.avgWaitTime > 120 ? 'critical' : 'warning',
        message: `Average wait time exceeds ${liveStatusResult.avgWaitTime > 120 ? '2 minutes' : '60 seconds'}`,
        value: liveStatusResult.avgWaitTime,
        threshold: 60
      });
    }
    
    if (liveStatusResult.waitingCalls > 5) {
      alerts.push({
        type: 'high_queue_volume',
        severity: liveStatusResult.waitingCalls > 10 ? 'critical' : 'warning',
        message: `${liveStatusResult.waitingCalls} calls waiting in queue`,
        value: liveStatusResult.waitingCalls,
        threshold: 5
      });
    }

    if (agentsAvailable === 0 && agentsOnline > 0) {
      alerts.push({
        type: 'no_available_agents',
        severity: 'warning',
        message: 'All agents are currently busy',
        value: agentsOnCall,
        threshold: agentsOnline
      });
    }

    // Build dashboard response matching documented API format
    const dashboard: CallCenterDashboardResponse = {
      // Primary fields (documented API format)
      realTimeMetrics: {
        agentsOnline,
        agentsOnCall,
        agentsAvailable,
        callsInQueue: liveStatusResult.waitingCalls,
        callsRinging: liveStatusResult.ringingCalls,
        activeCalls: liveStatusResult.activeCalls,
        callsOnHold: liveStatusResult.onHoldCalls,
        averageWaitTime: liveStatusResult.avgWaitTime,
        longestWait: liveStatusResult.longestWait,
        serviceLevelPercent,
      },
      todayMetrics: {
        totalCalls: todaysAnalyticsResult.totalCalls,
        inboundCalls: todaysAnalyticsResult.inboundCalls,
        outboundCalls: todaysAnalyticsResult.outboundCalls,
        completedCalls: todaysAnalyticsResult.answeredCalls,
        abandonedCalls: todaysAnalyticsResult.abandonedCalls,
        missedCalls: todaysAnalyticsResult.missedCalls,
        averageHandleTime: todaysAnalyticsResult.avgDuration,
        averageWaitTime: todaysAnalyticsResult.avgWaitTime,
        averageTalkTime: todaysAnalyticsResult.avgTalkTime,
      },
      sentimentToday: {
        positive: todaysAnalyticsResult.positiveCount,
        negative: todaysAnalyticsResult.negativeCount,
        neutral: todaysAnalyticsResult.neutralCount,
        mixed: todaysAnalyticsResult.mixedCount,
        averageScore: todaysAnalyticsResult.avgSentimentScore,
      },
      hourlyVolume: todaysAnalyticsResult.callVolumeByHour.map(h => ({
        hour: h.hour,
        calls: h.count,
        avgWait: h.avgWait || 0,
      })),
      alerts,
      clinicId,
      generatedAt: new Date().toISOString(),
      timezone,
      
      // Legacy fields for backward compatibility with existing clients
      liveStatus: {
        activeCalls: liveStatusResult.activeCalls,
        waitingCalls: liveStatusResult.waitingCalls,
        onHoldCalls: liveStatusResult.onHoldCalls,
        ringingCalls: liveStatusResult.ringingCalls,
        onlineAgents: agentPresenceResult.onlineAgents,
      },
      todaysPerformance: {
        totalCalls: todaysAnalyticsResult.totalCalls,
        answeredCalls: todaysAnalyticsResult.answeredCalls,
        missedCalls: todaysAnalyticsResult.missedCalls,
        abandonedCalls: todaysAnalyticsResult.abandonedCalls,
        avgDuration: todaysAnalyticsResult.avgDuration,
        avgDurationFormatted: formatDuration(todaysAnalyticsResult.avgDuration),
      },
      waitTimeMetrics: {
        avgWaitTime: liveStatusResult.avgWaitTime,
        avgWaitTimeFormatted: formatDuration(liveStatusResult.avgWaitTime),
        longestWait: liveStatusResult.longestWait,
        longestWaitFormatted: formatDuration(liveStatusResult.longestWait),
      },
      qualityMetrics: {
        satisfactionRate: todaysAnalyticsResult.satisfactionRate,
        positiveCallsPercent: todaysAnalyticsResult.positiveCallsPercent,
        negativeCallsPercent: todaysAnalyticsResult.negativeCallsPercent,
        avgSentimentScore: todaysAnalyticsResult.avgSentimentScore,
      },
      callVolumeByHour: todaysAnalyticsResult.callVolumeByHour,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(dashboard)
    };

  } catch (error: any) {
    console.error('[CallCenterDashboard] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Failed to retrieve dashboard metrics',
        error: error.message
      })
    };
  }
};

/**
 * Get today's date range in the specified timezone
 */
function getTodayRange(timezone: string): { 
  startOfDay: Date; 
  endOfDay: Date; 
  todayDate: string; 
} {
  const now = new Date();
  
  // Get the current time in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00';
  
  const year = parseInt(getPart('year'));
  const month = parseInt(getPart('month')) - 1;
  const day = parseInt(getPart('day'));

  // Create start of day in the timezone (00:00:00)
  const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  // Adjust for timezone offset
  const tzOffset = getTimezoneOffset(timezone, now);
  startOfDay.setTime(startOfDay.getTime() + tzOffset);

  // End of day (23:59:59.999)
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

  const todayDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { startOfDay, endOfDay, todayDate };
}

/**
 * Get timezone offset in milliseconds
 */
function getTimezoneOffset(timezone: string, date: Date): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return utcDate.getTime() - tzDate.getTime();
}

/**
 * Format seconds to MM:SS or HH:MM:SS format
 */
function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Get live call status from CallQueue table
 */
async function getLiveCallStatus(clinicId: string): Promise<{
  activeCalls: number;
  waitingCalls: number;
  onHoldCalls: number;
  ringingCalls: number;
  avgWaitTime: number;
  longestWait: number;
}> {
  try {
    const { Items: calls } = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: {
        ':clinicId': clinicId
      }
    }));

    if (!calls || calls.length === 0) {
      return {
        activeCalls: 0,
        waitingCalls: 0,
        onHoldCalls: 0,
        ringingCalls: 0,
        avgWaitTime: 0,
        longestWait: 0
      };
    }

    const now = Date.now();
    let activeCalls = 0;
    let waitingCalls = 0;
    let onHoldCalls = 0;
    let ringingCalls = 0;
    let totalWaitTime = 0;
    let longestWait = 0;
    let waitingCount = 0;

    for (const call of calls) {
      const status = call.status;

      switch (status) {
        case 'connected':
        case 'active':
          activeCalls++;
          break;
        case 'queued':
          waitingCalls++;
          // Calculate wait time
          const queueEntryTime = call.queueEntryTime 
            ? (typeof call.queueEntryTime === 'number' ? call.queueEntryTime * 1000 : new Date(call.queueEntryTime).getTime())
            : call.queueEntryTimeIso 
              ? new Date(call.queueEntryTimeIso).getTime() 
              : now;
          const waitTime = Math.max(0, (now - queueEntryTime) / 1000);
          totalWaitTime += waitTime;
          longestWait = Math.max(longestWait, waitTime);
          waitingCount++;
          break;
        case 'on_hold':
          onHoldCalls++;
          break;
        case 'ringing':
          ringingCalls++;
          break;
      }
    }

    const avgWaitTime = waitingCount > 0 ? Math.round(totalWaitTime / waitingCount) : 0;

    return {
      activeCalls,
      waitingCalls,
      onHoldCalls,
      ringingCalls,
      avgWaitTime,
      longestWait: Math.round(longestWait)
    };
  } catch (error: any) {
    console.error('[getLiveCallStatus] Error:', error.message);
    return {
      activeCalls: 0,
      waitingCalls: 0,
      onHoldCalls: 0,
      ringingCalls: 0,
      avgWaitTime: 0,
      longestWait: 0
    };
  }
}

/**
 * Today's analytics result interface
 */
interface TodaysAnalyticsResult {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  abandonedCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  avgDuration: number;
  avgWaitTime: number;
  avgTalkTime: number;
  satisfactionRate: number;
  positiveCallsPercent: number;
  negativeCallsPercent: number;
  avgSentimentScore: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  mixedCount: number;
  callVolumeByHour: Array<{ hour: number; count: number; avgWait: number }>;
}

/**
 * Get today's call analytics from Analytics table
 */
async function getTodaysAnalytics(
  clinicId: string, 
  startTimestamp: number, 
  endTimestamp: number
): Promise<TodaysAnalyticsResult> {
  const emptyResult: TodaysAnalyticsResult = {
    totalCalls: 0,
    answeredCalls: 0,
    missedCalls: 0,
    abandonedCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    avgDuration: 0,
    avgWaitTime: 0,
    avgTalkTime: 0,
    satisfactionRate: 0,
    positiveCallsPercent: 0,
    negativeCallsPercent: 0,
    avgSentimentScore: 50,
    positiveCount: 0,
    negativeCount: 0,
    neutralCount: 0,
    mixedCount: 0,
    callVolumeByHour: new Array(24).fill(0).map((_, hour) => ({ hour, count: 0, avgWait: 0 }))
  };

  try {
    // Paginate through all results
    let allAnalytics: any[] = [];
    let lastEvaluatedKey: any = undefined;

    do {
      const result = await ddb.send(new QueryCommand({
        TableName: CALL_ANALYTICS_TABLE_NAME,
        IndexName: 'clinicId-timestamp-index',
        KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
          ':start': startTimestamp,
          ':end': endTimestamp
        },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 500
      }));

      if (result.Items) {
        allAnalytics.push(...result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey && allAnalytics.length < 5000); // Safety limit

    if (allAnalytics.length === 0) {
      return emptyResult;
    }

    // Calculate metrics
    let answeredCalls = 0;
    let abandonedCalls = 0;
    let missedCalls = 0;
    let inboundCalls = 0;
    let outboundCalls = 0;
    let totalDuration = 0;
    let durationCount = 0;
    let totalTalkTime = 0;
    let talkTimeCount = 0;
    let totalWaitTime = 0;
    let waitTimeCount = 0;

    // Sentiment tracking
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    let mixedCount = 0;
    let sentimentTotal = 0;
    let sentimentCount = 0;

    // Call volume by hour with wait time tracking
    const volumeByHour: Array<{ count: number; totalWait: number; waitCount: number }> = 
      new Array(24).fill(null).map(() => ({ count: 0, totalWait: 0, waitCount: 0 }));

    for (const call of allAnalytics) {
      // Count by direction
      const direction = call.direction?.toLowerCase();
      if (direction === 'inbound') {
        inboundCalls++;
      } else if (direction === 'outbound') {
        outboundCalls++;
      } else {
        // Default to inbound if not specified
        inboundCalls++;
      }

      // Count by status
      const status = call.callStatus?.toLowerCase();
      if (status === 'completed' || status === 'connected' || status === 'active') {
        answeredCalls++;
      } else if (status === 'abandoned') {
        abandonedCalls++;
        missedCalls++;
      } else if (status === 'failed' || status === 'missed') {
        missedCalls++;
      }

      // Duration (only count completed calls)
      if (call.totalDuration && call.totalDuration > 0) {
        totalDuration += call.totalDuration;
        durationCount++;
      }

      // Talk time
      if (call.talkTime && call.talkTime > 0) {
        totalTalkTime += call.talkTime;
        talkTimeCount++;
      } else if (call.totalDuration && call.totalDuration > 0) {
        // Fallback: use totalDuration as talk time if talkTime not available
        totalTalkTime += call.totalDuration;
        talkTimeCount++;
      }

      // Wait time (queue wait time before answering)
      if (call.waitTime && call.waitTime > 0) {
        totalWaitTime += call.waitTime;
        waitTimeCount++;
      } else if (call.queueWaitTime && call.queueWaitTime > 0) {
        totalWaitTime += call.queueWaitTime;
        waitTimeCount++;
      }

      // Sentiment
      const sentiment = call.overallSentiment?.toUpperCase();
      if (sentiment === 'POSITIVE') {
        positiveCount++;
        sentimentTotal += 85;
        sentimentCount++;
      } else if (sentiment === 'NEGATIVE') {
        negativeCount++;
        sentimentTotal += 20;
        sentimentCount++;
      } else if (sentiment === 'NEUTRAL') {
        neutralCount++;
        sentimentTotal += 50;
        sentimentCount++;
      } else if (sentiment === 'MIXED') {
        mixedCount++;
        sentimentTotal += 50;
        sentimentCount++;
      }

      // Call volume by hour
      if (call.callStartTime) {
        try {
          const hour = new Date(call.callStartTime).getHours();
          if (hour >= 0 && hour < 24) {
            volumeByHour[hour].count++;
            if (call.waitTime && call.waitTime > 0) {
              volumeByHour[hour].totalWait += call.waitTime;
              volumeByHour[hour].waitCount++;
            }
          }
        } catch (err) {
          // Skip invalid dates
        }
      }
    }

    const totalCalls = allAnalytics.length;
    const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
    const avgTalkTime = talkTimeCount > 0 ? Math.round(totalTalkTime / talkTimeCount) : 0;
    const avgWaitTime = waitTimeCount > 0 ? Math.round(totalWaitTime / waitTimeCount) : 0;
    const totalSentimentCalls = positiveCount + negativeCount + neutralCount + mixedCount;
    
    // CSAT proxy: (positive + 0.5*neutral) / total * 100
    const satisfactionRate = totalSentimentCalls > 0
      ? Math.round(((positiveCount + neutralCount * 0.5) / totalSentimentCalls) * 100)
      : 0;

    const positiveCallsPercent = totalSentimentCalls > 0 
      ? Math.round((positiveCount / totalSentimentCalls) * 100) 
      : 0;
    const negativeCallsPercent = totalSentimentCalls > 0 
      ? Math.round((negativeCount / totalSentimentCalls) * 100) 
      : 0;
    const avgSentimentScore = sentimentCount > 0 
      ? Math.round(sentimentTotal / sentimentCount) 
      : 50;

    return {
      totalCalls,
      answeredCalls,
      missedCalls,
      abandonedCalls,
      inboundCalls,
      outboundCalls,
      avgDuration,
      avgWaitTime,
      avgTalkTime,
      satisfactionRate,
      positiveCallsPercent,
      negativeCallsPercent,
      avgSentimentScore,
      positiveCount,
      negativeCount,
      neutralCount,
      mixedCount,
      callVolumeByHour: volumeByHour.map((hourData, hour) => ({
        hour,
        count: hourData.count,
        avgWait: hourData.waitCount > 0 ? Math.round(hourData.totalWait / hourData.waitCount) : 0
      }))
    };
  } catch (error: any) {
    console.error('[getTodaysAnalytics] Error:', error.message);
    return emptyResult;
  }
}

/**
 * Get count of online agents for this clinic
 */
async function getOnlineAgentsCount(clinicId: string): Promise<{ onlineAgents: number }> {
  if (!AGENT_PRESENCE_TABLE_NAME) {
    return { onlineAgents: 0 };
  }

  try {
    const { Items: agents } = await ddb.send(new QueryCommand({
      TableName: AGENT_PRESENCE_TABLE_NAME,
      IndexName: 'status-index',
      KeyConditionExpression: '#status = :status',
      FilterExpression: 'contains(activeClinicIds, :clinicId)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'Online',
        ':clinicId': clinicId
      }
    }));

    return { onlineAgents: agents?.length || 0 };
  } catch (error: any) {
    console.error('[getOnlineAgentsCount] Error:', error.message);
    return { onlineAgents: 0 };
  }
}


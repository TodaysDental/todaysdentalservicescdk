/**
 * RCS Analytics Handler
 * 
 * Provides comprehensive analytics for RCS messaging:
 * - Delivery rates (sent, delivered, failed)
 * - Engagement metrics (read receipts, button clicks)
 * - Template performance
 * - Response time analytics
 * - Campaign tracking
 * - Time-series aggregations
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cloudwatch = new CloudWatchClient({});

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const RCS_TEMPLATES_TABLE = process.env.RCS_TEMPLATES_TABLE!;
const RCS_ANALYTICS_TABLE = process.env.RCS_ANALYTICS_TABLE!;

// ============================================
// TYPES
// ============================================

export interface RcsAnalyticsSummary {
  clinicId: string;
  period: {
    start: string;
    end: string;
    granularity: 'hour' | 'day' | 'week' | 'month';
  };
  delivery: {
    total: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    undelivered: number;
    deliveryRate: number;
    readRate: number;
  };
  engagement: {
    buttonClicks: number;
    replies: number;
    avgResponseTimeMs: number;
    engagementRate: number;
  };
  messageTypes: {
    text: number;
    richCard: number;
    carousel: number;
    media: number;
    template: number;
  };
  direction: {
    inbound: number;
    outbound: number;
  };
  topTemplates: Array<{
    templateId: string;
    name: string;
    sendCount: number;
    deliveryRate: number;
    readRate: number;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
  smsFallback: {
    total: number;
    successRate: number;
  };
}

export interface RcsTimeSeriesPoint {
  timestamp: number;
  date: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  inbound: number;
  engagementRate: number;
}

interface AnalyticsQueryParams {
  clinicId: string;
  startDate?: number;
  endDate?: number;
  granularity?: 'hour' | 'day' | 'week' | 'month';
  templateId?: string;
  direction?: 'inbound' | 'outbound';
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse date range from query params
 */
function parseDateRange(params: Record<string, string | undefined>): { startDate: number; endDate: number } {
  const now = Date.now();
  const defaultRange = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  const endDate = params.endDate ? parseInt(params.endDate) : now;
  const startDate = params.startDate ? parseInt(params.startDate) : (endDate - defaultRange);
  
  return { startDate, endDate };
}

/**
 * Aggregate message status counts
 */
function aggregateStatusCounts(messages: any[]): Record<string, number> {
  const counts: Record<string, number> = {
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    undelivered: 0,
    received: 0,
    received_fallback: 0,
  };
  
  for (const msg of messages) {
    const status = (msg.status || 'unknown').toLowerCase();
    if (counts[status] !== undefined) {
      counts[status]++;
    }
  }
  
  return counts;
}

/**
 * Aggregate message types
 */
function aggregateMessageTypes(messages: any[]): Record<string, number> {
  const types: Record<string, number> = {
    text: 0,
    richCard: 0,
    carousel: 0,
    media: 0,
    template: 0,
  };
  
  for (const msg of messages) {
    if (msg.direction !== 'outbound') continue;
    
    const type = msg.messageType || 'text';
    if (types[type] !== undefined) {
      types[type]++;
    }
  }
  
  return types;
}

/**
 * Calculate hourly distribution
 */
function calculateHourlyDistribution(messages: any[]): Array<{ hour: number; count: number }> {
  const hourCounts = new Array(24).fill(0);
  
  for (const msg of messages) {
    if (msg.timestamp) {
      const date = new Date(msg.timestamp);
      hourCounts[date.getUTCHours()]++;
    }
  }
  
  return hourCounts.map((count, hour) => ({ hour, count }));
}

/**
 * Calculate average response time for conversations
 */
function calculateAvgResponseTime(messages: any[]): number {
  const sortedMsgs = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const responseTimes: number[] = [];
  
  // Group by phone number and calculate response times
  const conversationMap = new Map<string, any[]>();
  
  for (const msg of sortedMsgs) {
    const phone = msg.from || msg.to;
    if (!phone) continue;
    
    if (!conversationMap.has(phone)) {
      conversationMap.set(phone, []);
    }
    conversationMap.get(phone)!.push(msg);
  }
  
  // Calculate response times per conversation
  for (const [_, convMsgs] of conversationMap) {
    for (let i = 1; i < convMsgs.length; i++) {
      const prev = convMsgs[i - 1];
      const curr = convMsgs[i];
      
      // Measure time from inbound to outbound response
      if (prev.direction === 'inbound' && curr.direction === 'outbound') {
        const responseTime = (curr.timestamp || 0) - (prev.timestamp || 0);
        if (responseTime > 0 && responseTime < 24 * 60 * 60 * 1000) { // Less than 24 hours
          responseTimes.push(responseTime);
        }
      }
    }
  }
  
  if (responseTimes.length === 0) return 0;
  return Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
}

/**
 * Get template performance metrics
 */
async function getTemplatePerformance(
  clinicId: string,
  messages: any[]
): Promise<Array<{ templateId: string; name: string; sendCount: number; deliveryRate: number; readRate: number }>> {
  // Group messages by template
  const templateStats = new Map<string, { sent: number; delivered: number; read: number }>();
  
  for (const msg of messages) {
    const templateId = msg.templateId || msg.contentSid;
    if (!templateId || msg.direction !== 'outbound') continue;
    
    if (!templateStats.has(templateId)) {
      templateStats.set(templateId, { sent: 0, delivered: 0, read: 0 });
    }
    
    const stats = templateStats.get(templateId)!;
    stats.sent++;
    
    if (msg.status === 'delivered' || msg.status === 'read') {
      stats.delivered++;
    }
    if (msg.status === 'read') {
      stats.read++;
    }
  }
  
  // Fetch template names
  const results: Array<{ templateId: string; name: string; sendCount: number; deliveryRate: number; readRate: number }> = [];
  
  for (const [templateId, stats] of templateStats) {
    let name = templateId;
    
    try {
      const templateResult = await ddb.send(new GetCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Key: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${templateId}`,
        },
      }));
      
      if (templateResult.Item) {
        name = templateResult.Item.name || templateId;
      }
    } catch (e) {
      // Template not found, use ID as name
    }
    
    results.push({
      templateId,
      name,
      sendCount: stats.sent,
      deliveryRate: stats.sent > 0 ? Math.round((stats.delivered / stats.sent) * 100) / 100 : 0,
      readRate: stats.sent > 0 ? Math.round((stats.read / stats.sent) * 100) / 100 : 0,
    });
  }
  
  // Sort by send count descending and take top 10
  return results.sort((a, b) => b.sendCount - a.sendCount).slice(0, 10);
}

/**
 * Push custom metrics to CloudWatch
 */
async function pushCloudWatchMetrics(clinicId: string, metrics: RcsAnalyticsSummary): Promise<void> {
  const dimensions = [{ Name: 'ClinicId', Value: clinicId }];
  
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'TodaysDental/RCS',
      MetricData: [
        {
          MetricName: 'MessagesSent',
          Dimensions: dimensions,
          Value: metrics.delivery.sent,
          Unit: 'Count',
        },
        {
          MetricName: 'MessagesDelivered',
          Dimensions: dimensions,
          Value: metrics.delivery.delivered,
          Unit: 'Count',
        },
        {
          MetricName: 'MessagesRead',
          Dimensions: dimensions,
          Value: metrics.delivery.read,
          Unit: 'Count',
        },
        {
          MetricName: 'MessagesFailed',
          Dimensions: dimensions,
          Value: metrics.delivery.failed,
          Unit: 'Count',
        },
        {
          MetricName: 'DeliveryRate',
          Dimensions: dimensions,
          Value: metrics.delivery.deliveryRate * 100,
          Unit: 'Percent',
        },
        {
          MetricName: 'ReadRate',
          Dimensions: dimensions,
          Value: metrics.delivery.readRate * 100,
          Unit: 'Percent',
        },
        {
          MetricName: 'EngagementRate',
          Dimensions: dimensions,
          Value: metrics.engagement.engagementRate * 100,
          Unit: 'Percent',
        },
        {
          MetricName: 'AvgResponseTime',
          Dimensions: dimensions,
          Value: metrics.engagement.avgResponseTimeMs,
          Unit: 'Milliseconds',
        },
        {
          MetricName: 'InboundMessages',
          Dimensions: dimensions,
          Value: metrics.direction.inbound,
          Unit: 'Count',
        },
        {
          MetricName: 'SmsFallbackCount',
          Dimensions: dimensions,
          Value: metrics.smsFallback.total,
          Unit: 'Count',
        },
      ],
    }));
  } catch (e) {
    console.error('Failed to push CloudWatch metrics:', e);
  }
}

/**
 * Generate time series data
 */
function generateTimeSeries(
  messages: any[],
  startDate: number,
  endDate: number,
  granularity: 'hour' | 'day' | 'week' | 'month'
): RcsTimeSeriesPoint[] {
  // Determine bucket size
  let bucketMs: number;
  switch (granularity) {
    case 'hour':
      bucketMs = 60 * 60 * 1000;
      break;
    case 'day':
      bucketMs = 24 * 60 * 60 * 1000;
      break;
    case 'week':
      bucketMs = 7 * 24 * 60 * 60 * 1000;
      break;
    case 'month':
      bucketMs = 30 * 24 * 60 * 60 * 1000;
      break;
  }
  
  // Create buckets
  const buckets = new Map<number, RcsTimeSeriesPoint>();
  const bucketStart = Math.floor(startDate / bucketMs) * bucketMs;
  const bucketEnd = Math.ceil(endDate / bucketMs) * bucketMs;
  
  for (let ts = bucketStart; ts <= bucketEnd; ts += bucketMs) {
    buckets.set(ts, {
      timestamp: ts,
      date: new Date(ts).toISOString(),
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      inbound: 0,
      engagementRate: 0,
    });
  }
  
  // Populate buckets
  for (const msg of messages) {
    if (!msg.timestamp) continue;
    
    const bucketTs = Math.floor(msg.timestamp / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketTs);
    if (!bucket) continue;
    
    if (msg.direction === 'inbound') {
      bucket.inbound++;
    } else {
      bucket.sent++;
      
      const status = (msg.status || '').toLowerCase();
      if (status === 'delivered' || status === 'read') {
        bucket.delivered++;
      }
      if (status === 'read') {
        bucket.read++;
      }
      if (status === 'failed' || status === 'undelivered') {
        bucket.failed++;
      }
    }
  }
  
  // Calculate engagement rates
  for (const bucket of buckets.values()) {
    if (bucket.delivered > 0) {
      bucket.engagementRate = Math.round((bucket.read / bucket.delivered) * 100) / 100;
    }
  }
  
  return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// ============================================
// MAIN HANDLER
// ============================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('RCS Analytics Event:', JSON.stringify(event, null, 2));

  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;

    if (!clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing clinicId' }),
      };
    }

    const queryParams = event.queryStringParameters || {};
    const { startDate, endDate } = parseDateRange(queryParams);
    const granularity = (queryParams.granularity as 'hour' | 'day' | 'week' | 'month') || 'day';

    // ---------------------------------------------------------
    // GET /{clinicId}/analytics/summary - Get analytics summary
    // ---------------------------------------------------------
    if (path.endsWith('/analytics/summary') && method === 'GET') {
      // Fetch all messages in date range
      const messages = await fetchMessagesInRange(clinicId, startDate, endDate);
      
      // Aggregate statistics
      const statusCounts = aggregateStatusCounts(messages);
      const messageTypes = aggregateMessageTypes(messages);
      const hourlyDist = calculateHourlyDistribution(messages);
      const avgResponseTime = calculateAvgResponseTime(messages);
      const topTemplates = await getTemplatePerformance(clinicId, messages);
      
      const outboundMsgs = messages.filter(m => m.direction === 'outbound');
      const inboundMsgs = messages.filter(m => m.direction === 'inbound');
      const smsFallbackMsgs = messages.filter(m => m.messageType === 'sms_fallback');
      
      const totalSent = statusCounts.queued + statusCounts.sending + statusCounts.sent + 
                        statusCounts.delivered + statusCounts.read + 
                        statusCounts.failed + statusCounts.undelivered;
      
      const delivered = statusCounts.delivered + statusCounts.read;
      const engagementActions = statusCounts.read + inboundMsgs.length;
      
      const summary: RcsAnalyticsSummary = {
        clinicId,
        period: {
          start: new Date(startDate).toISOString(),
          end: new Date(endDate).toISOString(),
          granularity,
        },
        delivery: {
          total: totalSent,
          sent: statusCounts.sent + statusCounts.delivered + statusCounts.read,
          delivered,
          read: statusCounts.read,
          failed: statusCounts.failed,
          undelivered: statusCounts.undelivered,
          deliveryRate: totalSent > 0 ? Math.round((delivered / totalSent) * 100) / 100 : 0,
          readRate: delivered > 0 ? Math.round((statusCounts.read / delivered) * 100) / 100 : 0,
        },
        engagement: {
          buttonClicks: 0, // Requires tracking via postback data
          replies: inboundMsgs.length,
          avgResponseTimeMs: avgResponseTime,
          engagementRate: totalSent > 0 ? Math.round((engagementActions / totalSent) * 100) / 100 : 0,
        },
        messageTypes: {
          text: messageTypes.text,
          richCard: messageTypes.richCard,
          carousel: messageTypes.carousel,
          media: messageTypes.media,
          template: messageTypes.template,
        },
        direction: {
          inbound: inboundMsgs.length,
          outbound: outboundMsgs.length,
        },
        topTemplates,
        hourlyDistribution: hourlyDist,
        smsFallback: {
          total: smsFallbackMsgs.length,
          successRate: smsFallbackMsgs.length > 0 
            ? Math.round((smsFallbackMsgs.filter(m => m.status === 'sent').length / smsFallbackMsgs.length) * 100) / 100 
            : 0,
        },
      };
      
      // Push metrics to CloudWatch
      await pushCloudWatchMetrics(clinicId, summary);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          summary,
        }),
      };
    }

    // ---------------------------------------------------------
    // GET /{clinicId}/analytics/timeseries - Get time series data
    // ---------------------------------------------------------
    if (path.endsWith('/analytics/timeseries') && method === 'GET') {
      const messages = await fetchMessagesInRange(clinicId, startDate, endDate);
      const timeSeries = generateTimeSeries(messages, startDate, endDate, granularity);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          period: {
            start: new Date(startDate).toISOString(),
            end: new Date(endDate).toISOString(),
            granularity,
          },
          timeSeries,
        }),
      };
    }

    // ---------------------------------------------------------
    // GET /{clinicId}/analytics/templates - Template performance
    // ---------------------------------------------------------
    if (path.endsWith('/analytics/templates') && method === 'GET') {
      const messages = await fetchMessagesInRange(clinicId, startDate, endDate);
      const topTemplates = await getTemplatePerformance(clinicId, messages);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          period: {
            start: new Date(startDate).toISOString(),
            end: new Date(endDate).toISOString(),
          },
          templates: topTemplates,
        }),
      };
    }

    // ---------------------------------------------------------
    // GET /{clinicId}/analytics/delivery-rates - Delivery breakdown
    // ---------------------------------------------------------
    if (path.endsWith('/analytics/delivery-rates') && method === 'GET') {
      const messages = await fetchMessagesInRange(clinicId, startDate, endDate);
      const outbound = messages.filter(m => m.direction === 'outbound');
      const statusCounts = aggregateStatusCounts(outbound);
      const messageTypes = aggregateMessageTypes(outbound);
      
      // Calculate delivery rates by message type
      const ratesByType: Record<string, { sent: number; delivered: number; rate: number }> = {};
      
      for (const type of Object.keys(messageTypes)) {
        const typeMsgs = outbound.filter(m => (m.messageType || 'text') === type);
        const delivered = typeMsgs.filter(m => m.status === 'delivered' || m.status === 'read').length;
        ratesByType[type] = {
          sent: typeMsgs.length,
          delivered,
          rate: typeMsgs.length > 0 ? Math.round((delivered / typeMsgs.length) * 100) / 100 : 0,
        };
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          period: {
            start: new Date(startDate).toISOString(),
            end: new Date(endDate).toISOString(),
          },
          statusBreakdown: statusCounts,
          ratesByMessageType: ratesByType,
        }),
      };
    }

    // ---------------------------------------------------------
    // GET /{clinicId}/analytics/engagement - Engagement metrics
    // ---------------------------------------------------------
    if (path.endsWith('/analytics/engagement') && method === 'GET') {
      const messages = await fetchMessagesInRange(clinicId, startDate, endDate);
      const avgResponseTime = calculateAvgResponseTime(messages);
      const hourlyDist = calculateHourlyDistribution(messages);
      
      // Find peak hours
      const sortedHours = [...hourlyDist].sort((a, b) => b.count - a.count);
      const peakHours = sortedHours.slice(0, 3).map(h => h.hour);
      
      const inbound = messages.filter(m => m.direction === 'inbound');
      const outbound = messages.filter(m => m.direction === 'outbound');
      const conversations = new Set(messages.map(m => m.from || m.to)).size;
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          period: {
            start: new Date(startDate).toISOString(),
            end: new Date(endDate).toISOString(),
          },
          engagement: {
            totalMessages: messages.length,
            inboundCount: inbound.length,
            outboundCount: outbound.length,
            uniqueConversations: conversations,
            avgResponseTimeMs: avgResponseTime,
            avgResponseTimeFormatted: formatDuration(avgResponseTime),
            peakHoursUtc: peakHours,
            hourlyDistribution: hourlyDist,
          },
        }),
      };
    }

    // ---------------------------------------------------------
    // POST /{clinicId}/analytics/export - Export analytics data
    // ---------------------------------------------------------
    if (path.endsWith('/analytics/export') && method === 'POST') {
      const messages = await fetchMessagesInRange(clinicId, startDate, endDate);
      const summary = await buildFullSummary(clinicId, messages, startDate, endDate, granularity);
      
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Disposition': `attachment; filename="rcs-analytics-${clinicId}-${new Date().toISOString().split('T')[0]}.json"`,
        },
        body: JSON.stringify({
          exportedAt: new Date().toISOString(),
          clinicId,
          ...summary,
          messages: messages.map(m => ({
            messageSid: m.messageSid,
            direction: m.direction,
            status: m.status,
            messageType: m.messageType,
            timestamp: m.timestamp,
            to: m.to,
            from: m.from,
          })),
        }),
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' }),
    };

  } catch (error) {
    console.error('Error in RCS analytics:', error);
    return {
      statusCode: 500,
      headers: buildCorsHeaders({}),
      body: JSON.stringify({
        error: 'Failed to fetch analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

// ============================================
// DATA FETCHING
// ============================================

async function fetchMessagesInRange(clinicId: string, startDate: number, endDate: number): Promise<any[]> {
  const messages: any[] = [];
  let lastKey: any = undefined;
  
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: RCS_MESSAGES_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `CLINIC#${clinicId}`,
      },
      FilterExpression: '#ts >= :start AND #ts <= :end AND attribute_exists(direction)',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExclusiveStartKey: lastKey,
    }));
    
    messages.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  
  return messages;
}

async function buildFullSummary(
  clinicId: string,
  messages: any[],
  startDate: number,
  endDate: number,
  granularity: 'hour' | 'day' | 'week' | 'month'
) {
  const statusCounts = aggregateStatusCounts(messages);
  const messageTypes = aggregateMessageTypes(messages);
  const hourlyDist = calculateHourlyDistribution(messages);
  const avgResponseTime = calculateAvgResponseTime(messages);
  const topTemplates = await getTemplatePerformance(clinicId, messages);
  const timeSeries = generateTimeSeries(messages, startDate, endDate, granularity);
  
  return {
    summary: {
      totalMessages: messages.length,
      inbound: messages.filter(m => m.direction === 'inbound').length,
      outbound: messages.filter(m => m.direction === 'outbound').length,
      statusBreakdown: statusCounts,
      messageTypes,
    },
    engagement: {
      avgResponseTimeMs: avgResponseTime,
      hourlyDistribution: hourlyDist,
    },
    templates: topTemplates,
    timeSeries,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

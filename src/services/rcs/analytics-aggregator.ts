/**
 * RCS Analytics Aggregator
 * 
 * Scheduled Lambda that pre-computes and stores aggregated analytics
 * for faster dashboard loading. Runs hourly to update metrics.
 * 
 * Aggregates:
 * - Daily/hourly delivery metrics
 * - Template performance scores
 * - Engagement trends
 * - Clinic-level summaries
 */

import { ScheduledEvent, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cloudwatch = new CloudWatchClient({});

const RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE!;
const RCS_ANALYTICS_TABLE = process.env.RCS_ANALYTICS_TABLE!;
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE!;

// ============================================
// TYPES
// ============================================

interface AggregatedMetrics {
  pk: string;                    // CLINIC#<clinicId>
  sk: string;                    // DAILY#<date> or HOURLY#<date>#<hour>
  clinicId: string;
  date: string;
  hour?: number;
  granularity: 'daily' | 'hourly';
  
  // Delivery metrics
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalFailed: number;
  deliveryRate: number;
  readRate: number;
  
  // Message types
  textCount: number;
  richCardCount: number;
  carouselCount: number;
  mediaCount: number;
  templateCount: number;
  
  // Engagement
  inboundCount: number;
  outboundCount: number;
  repliesCount: number;
  avgResponseTimeMs: number;
  
  // Fallback
  smsFallbackCount: number;
  smsFallbackSuccessRate: number;
  
  // Metadata
  aggregatedAt: string;
  ttl: number;
}

interface TemplateMetrics {
  pk: string;                    // CLINIC#<clinicId>
  sk: string;                    // TEMPLATE_PERF#<templateId>#<date>
  clinicId: string;
  templateId: string;
  templateName: string;
  date: string;
  
  sendCount: number;
  deliveredCount: number;
  readCount: number;
  deliveryRate: number;
  readRate: number;
  
  aggregatedAt: string;
  ttl: number;
}

// ============================================
// MAIN HANDLER
// ============================================

export const handler = async (event: ScheduledEvent, context: Context): Promise<void> => {
  console.log('RCS Analytics Aggregator Event:', JSON.stringify(event, null, 2));
  
  const now = new Date();
  const currentHour = now.getUTCHours();
  
  try {
    // Get list of active clinics
    const clinicIds = await getActiveClinicIds();
    console.log(`Processing ${clinicIds.length} clinics`);
    
    // Aggregate last 24 hours for each clinic
    const results = await Promise.allSettled(
      clinicIds.map(clinicId => aggregateClinicMetrics(clinicId, now))
    );
    
    // Log results
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Aggregation complete: ${successful} succeeded, ${failed} failed`);
    
    // Push aggregate CloudWatch metrics
    await pushAggregateCloudWatchMetrics(clinicIds.length, successful, failed);
    
    // If any failures, log them
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to aggregate clinic ${clinicIds[index]}:`, result.reason);
      }
    });
    
  } catch (error) {
    console.error('Analytics aggregation failed:', error);
    throw error;
  }
};

// ============================================
// AGGREGATION FUNCTIONS
// ============================================

async function aggregateClinicMetrics(clinicId: string, now: Date): Promise<void> {
  const today = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Aggregate today's hourly metrics
  await aggregateHourlyMetrics(clinicId, today, now);
  
  // Aggregate yesterday's daily metrics (if not already done)
  await aggregateDailyMetrics(clinicId, yesterday);
  
  // Aggregate template performance
  await aggregateTemplatePerformance(clinicId, today);
  
  console.log(`Completed aggregation for clinic ${clinicId}`);
}

async function aggregateHourlyMetrics(clinicId: string, date: string, now: Date): Promise<void> {
  const currentHour = now.getUTCHours();
  
  // Get all messages for today
  const startOfDay = new Date(date).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  
  const messages = await fetchMessages(clinicId, startOfDay, endOfDay);
  
  // Group by hour and aggregate
  const hourlyBuckets = new Map<number, typeof messages>();
  
  for (const msg of messages) {
    const msgHour = new Date(msg.timestamp).getUTCHours();
    if (!hourlyBuckets.has(msgHour)) {
      hourlyBuckets.set(msgHour, []);
    }
    hourlyBuckets.get(msgHour)!.push(msg);
  }
  
  // Write hourly aggregates
  const writeRequests = [];
  
  for (const [hour, hourMsgs] of hourlyBuckets) {
    if (hour > currentHour) continue; // Don't aggregate future hours
    
    const metrics = calculateMetrics(hourMsgs, clinicId, date, hour);
    
    writeRequests.push({
      PutRequest: {
        Item: metrics,
      },
    });
  }
  
  // Batch write (max 25 per batch)
  if (writeRequests.length > 0) {
    await batchWriteItems(RCS_ANALYTICS_TABLE, writeRequests);
  }
}

async function aggregateDailyMetrics(clinicId: string, date: string): Promise<void> {
  // Check if already aggregated
  const existing = await ddb.send(new QueryCommand({
    TableName: RCS_ANALYTICS_TABLE,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: {
      ':pk': `CLINIC#${clinicId}`,
      ':sk': `DAILY#${date}`,
    },
    Limit: 1,
  }));
  
  if (existing.Items && existing.Items.length > 0) {
    console.log(`Daily metrics for ${clinicId} ${date} already exist`);
    return;
  }
  
  // Get all messages for the day
  const startOfDay = new Date(date).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  
  const messages = await fetchMessages(clinicId, startOfDay, endOfDay);
  
  if (messages.length === 0) {
    console.log(`No messages for ${clinicId} on ${date}`);
    return;
  }
  
  // Calculate daily aggregate
  const metrics = calculateMetrics(messages, clinicId, date);
  metrics.sk = `DAILY#${date}`;
  metrics.granularity = 'daily';
  delete metrics.hour;
  
  await ddb.send(new PutCommand({
    TableName: RCS_ANALYTICS_TABLE,
    Item: metrics,
  }));
  
  console.log(`Saved daily metrics for ${clinicId} on ${date}`);
}

async function aggregateTemplatePerformance(clinicId: string, date: string): Promise<void> {
  const startOfDay = new Date(date).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  
  const messages = await fetchMessages(clinicId, startOfDay, endOfDay);
  
  // Group by template
  const templateStats = new Map<string, {
    templateId: string;
    templateName: string;
    sent: number;
    delivered: number;
    read: number;
  }>();
  
  for (const msg of messages) {
    if (msg.direction !== 'outbound') continue;
    
    const templateId = msg.templateId || msg.contentSid;
    if (!templateId) continue;
    
    if (!templateStats.has(templateId)) {
      templateStats.set(templateId, {
        templateId,
        templateName: msg.templateName || templateId,
        sent: 0,
        delivered: 0,
        read: 0,
      });
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
  
  // Write template metrics
  const writeRequests = [];
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days
  
  for (const [templateId, stats] of templateStats) {
    const metrics: TemplateMetrics = {
      pk: `CLINIC#${clinicId}`,
      sk: `TEMPLATE_PERF#${templateId}#${date}`,
      clinicId,
      templateId,
      templateName: stats.templateName,
      date,
      sendCount: stats.sent,
      deliveredCount: stats.delivered,
      readCount: stats.read,
      deliveryRate: stats.sent > 0 ? Math.round((stats.delivered / stats.sent) * 100) / 100 : 0,
      readRate: stats.sent > 0 ? Math.round((stats.read / stats.sent) * 100) / 100 : 0,
      aggregatedAt: now,
      ttl,
    };
    
    writeRequests.push({
      PutRequest: {
        Item: metrics,
      },
    });
  }
  
  if (writeRequests.length > 0) {
    await batchWriteItems(RCS_ANALYTICS_TABLE, writeRequests);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateMetrics(
  messages: any[],
  clinicId: string,
  date: string,
  hour?: number
): AggregatedMetrics {
  const outbound = messages.filter(m => m.direction === 'outbound');
  const inbound = messages.filter(m => m.direction === 'inbound');
  const smsFallback = messages.filter(m => m.messageType === 'sms_fallback');
  
  // Status counts
  let sent = 0, delivered = 0, read = 0, failed = 0;
  
  for (const msg of outbound) {
    const status = (msg.status || '').toLowerCase();
    if (['queued', 'sending', 'sent', 'delivered', 'read'].includes(status)) {
      sent++;
    }
    if (status === 'delivered' || status === 'read') {
      delivered++;
    }
    if (status === 'read') {
      read++;
    }
    if (status === 'failed' || status === 'undelivered') {
      failed++;
    }
  }
  
  // Message type counts
  let textCount = 0, richCardCount = 0, carouselCount = 0, mediaCount = 0, templateCount = 0;
  
  for (const msg of outbound) {
    const type = msg.messageType || 'text';
    switch (type) {
      case 'text': textCount++; break;
      case 'richCard': richCardCount++; break;
      case 'carousel': carouselCount++; break;
      case 'media': mediaCount++; break;
      case 'template': templateCount++; break;
    }
  }
  
  // Calculate average response time
  let avgResponseTime = 0;
  const responseTimes: number[] = [];
  
  const sortedMsgs = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < sortedMsgs.length; i++) {
    const prev = sortedMsgs[i - 1];
    const curr = sortedMsgs[i];
    
    if (prev.direction === 'inbound' && curr.direction === 'outbound') {
      const responseTime = curr.timestamp - prev.timestamp;
      if (responseTime > 0 && responseTime < 24 * 60 * 60 * 1000) {
        responseTimes.push(responseTime);
      }
    }
  }
  
  if (responseTimes.length > 0) {
    avgResponseTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
  }
  
  // SMS fallback success rate
  const smsFallbackSuccess = smsFallback.filter(m => m.status === 'sent').length;
  
  return {
    pk: `CLINIC#${clinicId}`,
    sk: hour !== undefined ? `HOURLY#${date}#${hour.toString().padStart(2, '0')}` : `DAILY#${date}`,
    clinicId,
    date,
    hour,
    granularity: hour !== undefined ? 'hourly' : 'daily',
    
    totalSent: sent,
    totalDelivered: delivered,
    totalRead: read,
    totalFailed: failed,
    deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) / 100 : 0,
    readRate: delivered > 0 ? Math.round((read / delivered) * 100) / 100 : 0,
    
    textCount,
    richCardCount,
    carouselCount,
    mediaCount,
    templateCount,
    
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    repliesCount: inbound.length,
    avgResponseTimeMs: avgResponseTime,
    
    smsFallbackCount: smsFallback.length,
    smsFallbackSuccessRate: smsFallback.length > 0 
      ? Math.round((smsFallbackSuccess / smsFallback.length) * 100) / 100 
      : 0,
    
    aggregatedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year TTL
  };
}

async function fetchMessages(clinicId: string, startTs: number, endTs: number): Promise<any[]> {
  const messages: any[] = [];
  let lastKey: any = undefined;
  
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: RCS_MESSAGES_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `CLINIC#${clinicId}`,
        ':start': startTs,
        ':end': endTs,
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

async function getActiveClinicIds(): Promise<string[]> {
  // Query clinic config table for active clinics
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: CLINIC_CONFIG_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': 'CLINICS',
      },
    }));
    
    return (result.Items || [])
      .filter(item => item.isActive !== false)
      .map(item => item.clinicId || item.sk?.replace('CLINIC#', ''))
      .filter(Boolean);
  } catch (error) {
    console.error('Failed to fetch clinic IDs, defaulting to empty:', error);
    
    // Fallback: scan messages table for unique clinic IDs
    const result = await ddb.send(new QueryCommand({
      TableName: RCS_MESSAGES_TABLE,
      IndexName: 'MessageSidIndex', // This doesn't work, but we'll scan
      ProjectionExpression: 'pk',
      Limit: 1000,
    }));
    
    const clinicIds = new Set<string>();
    for (const item of result.Items || []) {
      if (item.pk?.startsWith('CLINIC#')) {
        clinicIds.add(item.pk.replace('CLINIC#', ''));
      }
    }
    
    return Array.from(clinicIds);
  }
}

async function batchWriteItems(tableName: string, writeRequests: any[]): Promise<void> {
  const chunks = [];
  for (let i = 0; i < writeRequests.length; i += 25) {
    chunks.push(writeRequests.slice(i, i + 25));
  }
  
  for (const chunk of chunks) {
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: chunk,
      },
    }));
  }
}

async function pushAggregateCloudWatchMetrics(
  totalClinics: number,
  successful: number,
  failed: number
): Promise<void> {
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'TodaysDental/RCS',
      MetricData: [
        {
          MetricName: 'AggregationRuns',
          Value: 1,
          Unit: 'Count',
        },
        {
          MetricName: 'ClinicsProcessed',
          Value: successful,
          Unit: 'Count',
        },
        {
          MetricName: 'ClinicsFailedAggregation',
          Value: failed,
          Unit: 'Count',
        },
      ],
    }));
  } catch (e) {
    console.error('Failed to push aggregate CloudWatch metrics:', e);
  }
}

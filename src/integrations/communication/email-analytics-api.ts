/**
 * Email Analytics API Handler
 * 
 * Provides API endpoints for querying email analytics:
 * - GET /email-analytics/stats - Get aggregated email statistics
 * - GET /email-analytics/emails - List email tracking records
 * - GET /email-analytics/emails/{messageId} - Get specific email details
 * - GET /email-analytics/dashboard - Get dashboard summary
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getAllowedClinicIds,
  hasClinicAccess,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import {
  EmailAnalyticsStats,
  EmailTrackingRecord,
  EmailStatus,
} from '../../shared/types/email-analytics';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE!;
const EMAIL_STATS_TABLE = process.env.EMAIL_STATS_TABLE!;

const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);
const MODULE_NAME = 'Marketing';

function http(code: number, body: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return { statusCode: code, headers: getCorsHeaders(event), body: payload };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Email Analytics API:', event.httpMethod, event.path);
  
  if (event.httpMethod === 'OPTIONS') return http(204, '', event);
  
  // Get user permissions
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return http(401, { error: 'Unauthorized - Invalid token' }, event);
  }
  
  // Check module permission
  if (!hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    'read',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return http(403, { error: 'You do not have permission to view email analytics' }, event);
  }
  
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const path = event.path || '';
  
  try {
    // Route handling
    if (path.includes('/email-analytics/stats')) {
      return await handleGetStats(event, allowedClinics);
    }
    
    if (path.includes('/email-analytics/dashboard')) {
      return await handleGetDashboard(event, allowedClinics);
    }
    
    if (path.match(/\/email-analytics\/emails\/[^\/]+$/)) {
      return await handleGetEmailDetail(event, allowedClinics);
    }
    
    if (path.includes('/email-analytics/emails')) {
      return await handleListEmails(event, allowedClinics);
    }
    
    return http(404, { error: 'Not Found' }, event);
  } catch (error) {
    console.error('Error handling request:', error);
    return http(500, { error: 'Internal Server Error' }, event);
  }
};

/**
 * GET /email-analytics/stats
 * Query params: clinicId, period (YYYY-MM or 'all'), startDate, endDate
 */
async function handleGetStats(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters || {};
  const clinicId = query.clinicId;
  const period = query.period || getCurrentMonth();
  
  if (clinicId && !allowedClinics.has('*') && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'No access to this clinic' }, event);
  }
  
  // Get stats for specific clinic or aggregate all allowed clinics
  const clinicsToQuery = clinicId ? [clinicId] : 
    (allowedClinics.has('*') ? await getAllClinicIds() : Array.from(allowedClinics));
  
  const statsPromises = clinicsToQuery.map(async (cid) => {
    try {
      const result = await ddb.send(new GetCommand({
        TableName: EMAIL_STATS_TABLE,
        Key: { clinicId: cid, period },
      }));
      return result.Item as EmailAnalyticsStats | undefined;
    } catch (error) {
      console.error(`Error getting stats for clinic ${cid}:`, error);
      return undefined;
    }
  });
  
  const allStats = await Promise.all(statsPromises);
  const validStats = allStats.filter(Boolean) as EmailAnalyticsStats[];
  
  // Aggregate stats
  const aggregated = aggregateStats(validStats, period);
  
  // Calculate rates
  if (aggregated.totalSent > 0) {
    aggregated.deliveryRate = Math.round((aggregated.totalDelivered / aggregated.totalSent) * 100 * 100) / 100;
    aggregated.bounceRate = Math.round((aggregated.totalBounced / aggregated.totalSent) * 100 * 100) / 100;
  }
  if (aggregated.totalDelivered > 0) {
    aggregated.openRate = Math.round((aggregated.totalOpened / aggregated.totalDelivered) * 100 * 100) / 100;
    aggregated.complaintRate = Math.round((aggregated.totalComplained / aggregated.totalDelivered) * 100 * 100) / 100;
  }
  if (aggregated.totalOpened > 0) {
    aggregated.clickRate = Math.round((aggregated.totalClicked / aggregated.totalOpened) * 100 * 100) / 100;
  }
  
  return http(200, {
    success: true,
    clinicId: clinicId || 'all',
    period,
    stats: aggregated,
  }, event);
}

/**
 * GET /email-analytics/dashboard
 * Returns a comprehensive dashboard view with recent activity, trends, and alerts
 */
async function handleGetDashboard(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters || {};
  const clinicId = query.clinicId;
  
  if (clinicId && !allowedClinics.has('*') && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'No access to this clinic' }, event);
  }
  
  const currentMonth = getCurrentMonth();
  const lastMonth = getLastMonth();
  
  // Get current and previous month stats
  const clinicsToQuery = clinicId ? [clinicId] : 
    (allowedClinics.has('*') ? await getAllClinicIds() : Array.from(allowedClinics));
  
  const [currentStats, previousStats, recentEmails] = await Promise.all([
    getAggregatedStatsForClinics(clinicsToQuery, currentMonth),
    getAggregatedStatsForClinics(clinicsToQuery, lastMonth),
    getRecentEmails(clinicsToQuery, 10),
  ]);
  
  // Calculate trends (percentage change from last month)
  const trends = {
    sentTrend: calculateTrend(previousStats.totalSent, currentStats.totalSent),
    deliveryTrend: calculateTrend(previousStats.deliveryRate, currentStats.deliveryRate),
    openTrend: calculateTrend(previousStats.openRate, currentStats.openRate),
    clickTrend: calculateTrend(previousStats.clickRate, currentStats.clickRate),
  };
  
  // Get alerts (high bounce rate, complaints, etc.)
  const alerts: string[] = [];
  if (currentStats.bounceRate > 5) {
    alerts.push(`High bounce rate: ${currentStats.bounceRate}% (target: <5%)`);
  }
  if (currentStats.complaintRate > 0.1) {
    alerts.push(`High complaint rate: ${currentStats.complaintRate}% (target: <0.1%)`);
  }
  if (currentStats.deliveryRate < 95) {
    alerts.push(`Low delivery rate: ${currentStats.deliveryRate}% (target: >95%)`);
  }
  
  // Status breakdown for pie chart
  const statusBreakdown = await getStatusBreakdown(clinicsToQuery, currentMonth);
  
  return http(200, {
    success: true,
    clinicId: clinicId || 'all',
    dashboard: {
      currentPeriod: currentMonth,
      stats: currentStats,
      trends,
      alerts,
      statusBreakdown,
      recentEmails: recentEmails.map(formatEmailForList),
    },
  }, event);
}

/**
 * GET /email-analytics/emails
 * List emails with filtering and pagination
 */
async function handleListEmails(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters || {};
  const clinicId = query.clinicId;
  const status = query.status as EmailStatus | undefined;
  const startDate = query.startDate;
  const endDate = query.endDate;
  const limit = Math.min(parseInt(query.limit || '50'), 100);
  const nextToken = query.nextToken;
  
  if (clinicId && !allowedClinics.has('*') && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'No access to this clinic' }, event);
  }
  
  // Build filter expression
  const filterExpressions: string[] = [];
  const expressionValues: Record<string, any> = {};
  const expressionNames: Record<string, string> = {};
  
  if (clinicId) {
    filterExpressions.push('clinicId = :clinicId');
    expressionValues[':clinicId'] = clinicId;
  } else if (!allowedClinics.has('*')) {
    // Filter to allowed clinics
    const clinicConditions = Array.from(allowedClinics).map((c, i) => {
      expressionValues[`:clinic${i}`] = c;
      return `clinicId = :clinic${i}`;
    });
    if (clinicConditions.length > 0) {
      filterExpressions.push(`(${clinicConditions.join(' OR ')})`);
    }
  }
  
  if (status) {
    filterExpressions.push('#status = :status');
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = status;
  }
  
  if (startDate) {
    filterExpressions.push('sentAt >= :startDate');
    expressionValues[':startDate'] = startDate;
  }
  
  if (endDate) {
    filterExpressions.push('sentAt <= :endDate');
    expressionValues[':endDate'] = endDate;
  }
  
  const scanParams: any = {
    TableName: EMAIL_ANALYTICS_TABLE,
    Limit: limit,
  };
  
  if (filterExpressions.length > 0) {
    scanParams.FilterExpression = filterExpressions.join(' AND ');
    scanParams.ExpressionAttributeValues = expressionValues;
  }
  
  if (Object.keys(expressionNames).length > 0) {
    scanParams.ExpressionAttributeNames = expressionNames;
  }
  
  if (nextToken) {
    try {
      scanParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    } catch (e) {
      console.warn('Invalid nextToken');
    }
  }
  
  const result = await ddb.send(new ScanCommand(scanParams));
  const emails = (result.Items || []) as EmailTrackingRecord[];
  
  // Sort by sentAt descending
  emails.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  
  let responseNextToken: string | undefined;
  if (result.LastEvaluatedKey) {
    responseNextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }
  
  return http(200, {
    success: true,
    clinicId: clinicId || 'all',
    emails: emails.map(formatEmailForList),
    total: emails.length,
    nextToken: responseNextToken,
  }, event);
}

/**
 * GET /email-analytics/emails/{messageId}
 * Get detailed information about a specific email
 */
async function handleGetEmailDetail(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const messageId = event.pathParameters?.messageId;
  
  if (!messageId) {
    return http(400, { error: 'messageId is required' }, event);
  }
  
  const result = await ddb.send(new GetCommand({
    TableName: EMAIL_ANALYTICS_TABLE,
    Key: { messageId },
  }));
  
  if (!result.Item) {
    return http(404, { error: 'Email not found' }, event);
  }
  
  const email = result.Item as EmailTrackingRecord;
  
  // Check clinic access
  if (email.clinicId && !allowedClinics.has('*') && !hasClinicAccess(allowedClinics, email.clinicId)) {
    return http(403, { error: 'No access to this email' }, event);
  }
  
  // Build event timeline from timestamps
  const events = buildEventTimeline(email);
  
  return http(200, {
    success: true,
    email: formatEmailForDetail(email),
    events,
  }, event);
}

// Helper functions

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getLastMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getAllClinicIds(): Promise<string[]> {
  // For admin users, get all clinic IDs from the stats table
  try {
    const result = await ddb.send(new ScanCommand({
      TableName: EMAIL_STATS_TABLE,
      ProjectionExpression: 'clinicId',
    }));
    const uniqueClinicIds = new Set((result.Items || []).map((item: any) => item.clinicId));
    return Array.from(uniqueClinicIds);
  } catch (error) {
    console.error('Error getting all clinic IDs:', error);
    return [];
  }
}

function aggregateStats(stats: EmailAnalyticsStats[], period: string): EmailAnalyticsStats {
  const aggregated: EmailAnalyticsStats = {
    clinicId: 'all',
    period,
    totalSent: 0,
    totalDelivered: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalBounced: 0,
    totalComplained: 0,
    totalFailed: 0,
    hardBounces: 0,
    softBounces: 0,
    deliveryRate: 0,
    openRate: 0,
    clickRate: 0,
    bounceRate: 0,
    complaintRate: 0,
    uniqueRecipients: 0,
    uniqueOpeners: 0,
    uniqueClickers: 0,
    lastUpdated: new Date().toISOString(),
  };
  
  for (const stat of stats) {
    aggregated.totalSent += stat.totalSent || 0;
    aggregated.totalDelivered += stat.totalDelivered || 0;
    aggregated.totalOpened += stat.totalOpened || 0;
    aggregated.totalClicked += stat.totalClicked || 0;
    aggregated.totalBounced += stat.totalBounced || 0;
    aggregated.totalComplained += stat.totalComplained || 0;
    aggregated.totalFailed += stat.totalFailed || 0;
    aggregated.hardBounces += stat.hardBounces || 0;
    aggregated.softBounces += stat.softBounces || 0;
    aggregated.uniqueRecipients += stat.uniqueRecipients || 0;
    aggregated.uniqueOpeners += stat.uniqueOpeners || 0;
    aggregated.uniqueClickers += stat.uniqueClickers || 0;
  }
  
  return aggregated;
}

async function getAggregatedStatsForClinics(clinicIds: string[], period: string): Promise<EmailAnalyticsStats> {
  const statsPromises = clinicIds.map(async (cid) => {
    try {
      const result = await ddb.send(new GetCommand({
        TableName: EMAIL_STATS_TABLE,
        Key: { clinicId: cid, period },
      }));
      return result.Item as EmailAnalyticsStats | undefined;
    } catch (error) {
      return undefined;
    }
  });
  
  const allStats = await Promise.all(statsPromises);
  const validStats = allStats.filter(Boolean) as EmailAnalyticsStats[];
  const aggregated = aggregateStats(validStats, period);
  
  // Calculate rates
  if (aggregated.totalSent > 0) {
    aggregated.deliveryRate = Math.round((aggregated.totalDelivered / aggregated.totalSent) * 100 * 100) / 100;
    aggregated.bounceRate = Math.round((aggregated.totalBounced / aggregated.totalSent) * 100 * 100) / 100;
  }
  if (aggregated.totalDelivered > 0) {
    aggregated.openRate = Math.round((aggregated.totalOpened / aggregated.totalDelivered) * 100 * 100) / 100;
    aggregated.complaintRate = Math.round((aggregated.totalComplained / aggregated.totalDelivered) * 100 * 100) / 100;
  }
  if (aggregated.totalOpened > 0) {
    aggregated.clickRate = Math.round((aggregated.totalClicked / aggregated.totalOpened) * 100 * 100) / 100;
  }
  
  return aggregated;
}

function calculateTrend(previous: number, current: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 100) / 100;
}

async function getRecentEmails(clinicIds: string[], limit: number): Promise<EmailTrackingRecord[]> {
  // Build filter for clinic access
  const filterExpressions: string[] = [];
  const expressionValues: Record<string, any> = {};
  
  if (clinicIds.length > 0 && !clinicIds.includes('*')) {
    const clinicConditions = clinicIds.map((c, i) => {
      expressionValues[`:clinic${i}`] = c;
      return `clinicId = :clinic${i}`;
    });
    filterExpressions.push(`(${clinicConditions.join(' OR ')})`);
  }
  
  const scanParams: any = {
    TableName: EMAIL_ANALYTICS_TABLE,
    Limit: limit * 3, // Over-fetch to account for filtering
  };
  
  if (filterExpressions.length > 0) {
    scanParams.FilterExpression = filterExpressions.join(' AND ');
    scanParams.ExpressionAttributeValues = expressionValues;
  }
  
  const result = await ddb.send(new ScanCommand(scanParams));
  const emails = (result.Items || []) as EmailTrackingRecord[];
  
  // Sort by sentAt descending and take top N
  emails.sort((a, b) => new Date(b.sentAt || '').getTime() - new Date(a.sentAt || '').getTime());
  return emails.slice(0, limit);
}

async function getStatusBreakdown(clinicIds: string[], period: string): Promise<Record<EmailStatus, number>> {
  const breakdown: Record<EmailStatus, number> = {
    'QUEUED': 0,
    'SENT': 0,
    'DELIVERED': 0,
    'OPENED': 0,
    'CLICKED': 0,
    'BOUNCED': 0,
    'COMPLAINED': 0,
    'REJECTED': 0,
    'FAILED': 0,
  };
  
  // Get counts from aggregate stats
  const stats = await getAggregatedStatsForClinics(clinicIds, period);
  
  // Map stats to status breakdown
  // Note: These are cumulative, so we calculate the "final" status counts
  breakdown['BOUNCED'] = stats.totalBounced;
  breakdown['COMPLAINED'] = stats.totalComplained;
  breakdown['FAILED'] = stats.totalFailed;
  breakdown['CLICKED'] = stats.totalClicked;
  breakdown['OPENED'] = Math.max(0, stats.totalOpened - stats.totalClicked);
  breakdown['DELIVERED'] = Math.max(0, stats.totalDelivered - stats.totalOpened - stats.totalBounced - stats.totalComplained);
  breakdown['SENT'] = Math.max(0, stats.totalSent - stats.totalDelivered - stats.totalFailed);
  
  return breakdown;
}

function formatEmailForList(email: EmailTrackingRecord): any {
  return {
    messageId: email.messageId,
    clinicId: email.clinicId,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    templateName: email.templateName,
    sentBy: email.sentBy,
    sentAt: email.sentAt,
    status: email.status,
    openCount: email.openCount || 0,
  };
}

function formatEmailForDetail(email: EmailTrackingRecord): any {
  return {
    ...email,
    openCount: email.openCount || 0,
    clickedLinks: email.clickedLinks || [],
  };
}

function buildEventTimeline(email: EmailTrackingRecord): Array<{ eventType: string; timestamp: string; details?: any }> {
  const events: Array<{ eventType: string; timestamp: string; details?: any }> = [];
  
  if (email.sendTimestamp) {
    events.push({ eventType: 'Send', timestamp: email.sendTimestamp });
  }
  
  if (email.deliveryTimestamp) {
    events.push({ eventType: 'Delivery', timestamp: email.deliveryTimestamp });
  }
  
  if (email.openTimestamp) {
    events.push({ 
      eventType: 'Open', 
      timestamp: email.openTimestamp,
      details: { openCount: email.openCount, userAgent: email.userAgent }
    });
  }
  
  if (email.clickTimestamp) {
    events.push({ 
      eventType: 'Click', 
      timestamp: email.clickTimestamp,
      details: { links: email.clickedLinks }
    });
  }
  
  if (email.bounceTimestamp) {
    events.push({ 
      eventType: 'Bounce', 
      timestamp: email.bounceTimestamp,
      details: { 
        bounceType: email.bounceType, 
        bounceSubType: email.bounceSubType,
        reason: email.bounceReason 
      }
    });
  }
  
  if (email.complaintTimestamp) {
    events.push({ 
      eventType: 'Complaint', 
      timestamp: email.complaintTimestamp,
      details: { feedbackType: email.complaintFeedbackType }
    });
  }
  
  // Sort by timestamp ascending
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  return events;
}

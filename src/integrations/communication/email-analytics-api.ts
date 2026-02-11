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

  // Aggregate stats and compute rates as decimals (0–1)
  const aggregated = aggregateStats(validStats, period);
  computeRatesAsDecimals(aggregated);

  return http(200, {
    success: true,
    clinicId: clinicId || 'all',
    period,
    stats: aggregated,
  }, event);
}

/**
 * GET /email-analytics/dashboard
 * Returns a comprehensive dashboard view with recent activity, trends, and alerts.
 * Query params: clinicId, period ('7d' | '30d' | '90d' | 'all')
 *
 * Returns a flat object matching the frontend's EmailAnalyticsDashboard interface:
 *   { totalSent, totalDelivered, ..., deliveryRate (0–1), ..., trends: { sent, delivered, opened, clicked } }
 */
async function handleGetDashboard(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters || {};
  const clinicId = query.clinicId;
  const period = query.period || '30d';

  if (clinicId && !allowedClinics.has('*') && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'No access to this clinic' }, event);
  }

  const clinicsToQuery = clinicId ? [clinicId] :
    (allowedClinics.has('*') ? await getAllClinicIds() : Array.from(allowedClinics));

  // Convert frontend period ('7d','30d','90d','all') to month lists
  const { current: currentPeriods, previous: previousPeriods } = getPeriodsForRange(period);

  // Get current and previous period stats aggregated across all requested months
  const [currentStats, previousStats] = await Promise.all([
    getAggregatedStatsForClinicsMultiPeriod(clinicsToQuery, currentPeriods),
    getAggregatedStatsForClinicsMultiPeriod(clinicsToQuery, previousPeriods),
  ]);

  // Calculate trends (percentage change from previous period)
  // Frontend expects: { sent, delivered, opened, clicked } (matching its trend key names)
  const trends = {
    sent: calculateTrend(previousStats.totalSent, currentStats.totalSent),
    delivered: calculateTrend(previousStats.deliveryRate, currentStats.deliveryRate),
    opened: calculateTrend(previousStats.openRate, currentStats.openRate),
    clicked: calculateTrend(previousStats.clickRate, currentStats.clickRate),
  };

  // Return flat structure matching frontend's EmailAnalyticsDashboard interface
  return http(200, {
    totalSent: currentStats.totalSent,
    totalDelivered: currentStats.totalDelivered,
    totalOpened: currentStats.totalOpened,
    totalClicked: currentStats.totalClicked,
    totalBounced: currentStats.totalBounced,
    totalComplaints: currentStats.totalComplained,  // map field name for frontend
    deliveryRate: currentStats.deliveryRate,   // decimal 0–1
    openRate: currentStats.openRate,           // decimal 0–1
    clickRate: currentStats.clickRate,         // decimal 0–1
    bounceRate: currentStats.bounceRate,       // decimal 0–1
    complaintRate: currentStats.complaintRate, // decimal 0–1
    trends,
  }, event);
}

/**
 * GET /email-analytics/emails
 * List emails with filtering and pagination.
 * Uses GSI clinicId-sentAt-index for efficient queries instead of full table scans.
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

  // Determine which clinics to query
  const clinicIds = clinicId ? [clinicId] :
    (!allowedClinics.has('*') ? Array.from(allowedClinics) : []);

  let emails: EmailTrackingRecord[] = [];
  let responseNextToken: string | undefined;

  if (clinicIds.length > 0) {
    // Use GSI (clinicId-sentAt-index) for efficient per-clinic queries
    // Query each clinic and merge results, sorted by sentAt descending
    const allEmails: EmailTrackingRecord[] = [];

    for (const cid of clinicIds) {
      const queryParams: any = {
        TableName: EMAIL_ANALYTICS_TABLE,
        IndexName: 'clinicId-sentAt-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': cid } as Record<string, any>,
        ScanIndexForward: false, // Descending by sentAt
        Limit: limit,
      };

      // Add sort key range conditions
      if (startDate && endDate) {
        queryParams.KeyConditionExpression += ' AND sentAt BETWEEN :startDate AND :endDate';
        queryParams.ExpressionAttributeValues[':startDate'] = startDate;
        queryParams.ExpressionAttributeValues[':endDate'] = endDate;
      } else if (startDate) {
        queryParams.KeyConditionExpression += ' AND sentAt >= :startDate';
        queryParams.ExpressionAttributeValues[':startDate'] = startDate;
      } else if (endDate) {
        queryParams.KeyConditionExpression += ' AND sentAt <= :endDate';
        queryParams.ExpressionAttributeValues[':endDate'] = endDate;
      }

      // Add filter for status (not a key attribute, so it goes in FilterExpression)
      if (status) {
        queryParams.FilterExpression = '#status = :status';
        queryParams.ExpressionAttributeNames = { '#status': 'status' };
        queryParams.ExpressionAttributeValues[':status'] = status;
      }

      if (nextToken) {
        try {
          queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
        } catch (e) {
          console.warn('Invalid nextToken');
        }
      }

      try {
        const result = await ddb.send(new QueryCommand(queryParams));
        allEmails.push(...((result.Items || []) as EmailTrackingRecord[]));
        if (result.LastEvaluatedKey) {
          responseNextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
        }
      } catch (err) {
        console.error(`Error querying emails for clinic ${cid}:`, err);
      }
    }

    // Sort merged results by sentAt descending and take top N
    allEmails.sort((a, b) => new Date(b.sentAt || '').getTime() - new Date(a.sentAt || '').getTime());
    emails = allEmails.slice(0, limit);
  } else {
    // Admin/wildcard: fall back to scan (no clinic filter)
    const scanParams: any = {
      TableName: EMAIL_ANALYTICS_TABLE,
      Limit: limit,
    };

    const filterExpressions: string[] = [];
    const expressionValues: Record<string, any> = {};
    const expressionNames: Record<string, string> = {};

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
    emails = (result.Items || []) as EmailTrackingRecord[];
    emails.sort((a, b) => new Date(b.sentAt || '').getTime() - new Date(a.sentAt || '').getTime());

    if (result.LastEvaluatedKey) {
      responseNextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }
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

// ========================
// Helper functions
// ========================

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getLastMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Convert a frontend period string ('7d','30d','90d','all') into
 * { current: string[], previous: string[] } arrays of YYYY-MM month keys.
 */
function getPeriodsForRange(period: string): { current: string[]; previous: string[] } {
  const now = new Date();

  switch (period) {
    case '7d':
    case '30d': {
      // Roughly one month
      return { current: [getCurrentMonth()], previous: [getLastMonth()] };
    }
    case '90d': {
      const current: string[] = [];
      const previous: string[] = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - i);
        current.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
      }
      for (let i = 3; i < 6; i++) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - i);
        previous.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
      }
      return { current, previous };
    }
    case 'all':
    default: {
      // 'all' — use current month vs last month for trend comparison
      return { current: [getCurrentMonth()], previous: [getLastMonth()] };
    }
  }
}

/**
 * Get all unique clinic IDs from the stats table with full pagination.
 */
async function getAllClinicIds(): Promise<string[]> {
  try {
    const uniqueClinicIds = new Set<string>();
    let lastKey: Record<string, any> | undefined;

    do {
      const result = await ddb.send(new ScanCommand({
        TableName: EMAIL_STATS_TABLE,
        ProjectionExpression: 'clinicId',
        ExclusiveStartKey: lastKey,
      }));
      for (const item of result.Items || []) {
        if (item.clinicId) uniqueClinicIds.add(item.clinicId as string);
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

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
    // Note: unique counts are summed across clinics, which over-counts
    // when the same recipient appears in multiple clinics. This is an
    // acceptable approximation; true dedup would require record-level scans.
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

/**
 * Compute rate fields on an already-aggregated stats object.
 * All rates are stored as **decimals** (0–1), e.g. 0.985 = 98.5%.
 */
function computeRatesAsDecimals(stats: EmailAnalyticsStats): void {
  if (stats.totalSent > 0) {
    stats.deliveryRate = Math.round((stats.totalDelivered / stats.totalSent) * 10000) / 10000;
    stats.bounceRate = Math.round((stats.totalBounced / stats.totalSent) * 10000) / 10000;
  }
  if (stats.totalDelivered > 0) {
    stats.openRate = Math.round((stats.totalOpened / stats.totalDelivered) * 10000) / 10000;
    stats.complaintRate = Math.round((stats.totalComplained / stats.totalDelivered) * 10000) / 10000;
  }
  if (stats.totalOpened > 0) {
    stats.clickRate = Math.round((stats.totalClicked / stats.totalOpened) * 10000) / 10000;
  }
}

/**
 * Aggregate stats across multiple clinics for a single period, then compute rates.
 */
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
  computeRatesAsDecimals(aggregated);
  return aggregated;
}

/**
 * Aggregate stats across multiple clinics AND multiple month periods.
 * Used by the dashboard to handle ranges like '90d' (3 months).
 */
async function getAggregatedStatsForClinicsMultiPeriod(
  clinicIds: string[],
  periods: string[]
): Promise<EmailAnalyticsStats> {
  const perPeriod = await Promise.all(
    periods.map((p) => getAggregatedStatsForClinics(clinicIds, p))
  );

  // Re-aggregate across periods (sum the raw counts, then recompute rates)
  const combined = aggregateStats(perPeriod, periods.join(','));
  computeRatesAsDecimals(combined);
  return combined;
}

function calculateTrend(previous: number, current: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 100) / 100;
}

/**
 * Get the N most recent emails for the given clinics using the GSI.
 */
async function getRecentEmails(clinicIds: string[], limit: number): Promise<EmailTrackingRecord[]> {
  if (clinicIds.length === 0 || clinicIds.includes('*')) {
    // Admin/wildcard — fall back to limited scan
    const result = await ddb.send(new ScanCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Limit: limit * 3,
    }));
    const emails = (result.Items || []) as EmailTrackingRecord[];
    emails.sort((a, b) => new Date(b.sentAt || '').getTime() - new Date(a.sentAt || '').getTime());
    return emails.slice(0, limit);
  }

  // Use GSI for each clinic, merge and sort
  const allEmails: EmailTrackingRecord[] = [];

  for (const cid of clinicIds) {
    try {
      const result = await ddb.send(new QueryCommand({
        TableName: EMAIL_ANALYTICS_TABLE,
        IndexName: 'clinicId-sentAt-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': cid },
        ScanIndexForward: false,
        Limit: limit,
      }));
      allEmails.push(...((result.Items || []) as EmailTrackingRecord[]));
    } catch (err) {
      console.error(`Error querying recent emails for clinic ${cid}:`, err);
    }
  }

  allEmails.sort((a, b) => new Date(b.sentAt || '').getTime() - new Date(a.sentAt || '').getTime());
  return allEmails.slice(0, limit);
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

  // Map stats to status breakdown.
  // These represent the "final" status of each email:
  //   • Bounced emails never reached delivery, so they don't reduce delivered.
  //   • Clicked is a subset of Opened, Opened is a subset of Delivered.
  breakdown['BOUNCED'] = stats.totalBounced;
  breakdown['COMPLAINED'] = stats.totalComplained;
  breakdown['FAILED'] = stats.totalFailed;
  breakdown['CLICKED'] = stats.totalClicked;
  breakdown['OPENED'] = Math.max(0, stats.totalOpened - stats.totalClicked);
  breakdown['DELIVERED'] = Math.max(0, stats.totalDelivered - stats.totalOpened);
  breakdown['SENT'] = Math.max(0, stats.totalSent - stats.totalDelivered - stats.totalBounced - stats.totalFailed);

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

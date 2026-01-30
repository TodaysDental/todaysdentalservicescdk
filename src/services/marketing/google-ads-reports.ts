/**
 * Google Ads Reports Lambda
 * 
 * Comprehensive reporting for Google Ads:
 * - Campaign performance reports
 * - Ad group reports
 * - Ad performance reports
 * - Keyword reports
 * - Geographic reports
 * - Device reports
 * - Custom date ranges
 * - Report download (CSV generation)
 * 
 * Endpoints:
 * - GET /google-ads/reports/campaign - Campaign performance report
 * - GET /google-ads/reports/adgroup - Ad group performance report
 * - GET /google-ads/reports/ad - Ad performance report
 * - GET /google-ads/reports/keyword - Keyword performance report
 * - GET /google-ads/reports/geographic - Geographic performance report
 * - GET /google-ads/reports/device - Device performance report
 * - GET /google-ads/reports/download - Download report as CSV
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';
import {
  getGoogleAdsClient,
  microsToDollars,
} from '../../shared/utils/google-ads-client';

// Module permission configuration
const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;

  console.log(`[GoogleAdsReports] ${method} ${path}`);

  // Handle OPTIONS for CORS
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Permission check
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }
  const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
  if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, requiredPermission, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ success: false, error: `Access denied: requires ${MODULE_NAME} module access` }) };
  }

  try {
    // Route: GET /google-ads/reports/campaign
    if (method === 'GET' && path.includes('/reports/campaign')) {
      return await getCampaignReport(event, corsHeaders);
    }

    // Route: GET /google-ads/reports/adgroup
    if (method === 'GET' && path.includes('/reports/adgroup')) {
      return await getAdGroupReport(event, corsHeaders);
    }

    // Route: GET /google-ads/reports/ad
    if (method === 'GET' && path.includes('/reports/ad')) {
      return await getAdReport(event, corsHeaders);
    }

    // Route: GET /google-ads/reports/keyword
    if (method === 'GET' && path.includes('/reports/keyword')) {
      return await getKeywordReport(event, corsHeaders);
    }

    // Route: GET /google-ads/reports/geographic
    if (method === 'GET' && path.includes('/reports/geographic')) {
      return await getGeographicReport(event, corsHeaders);
    }

    // Route: GET /google-ads/reports/device
    if (method === 'GET' && path.includes('/reports/device')) {
      return await getDeviceReport(event, corsHeaders);
    }

    // Route: GET /google-ads/reports/download
    if (method === 'GET' && path.includes('/reports/download')) {
      return await downloadReport(event, corsHeaders);
    }

    // Route: GET /google-ads/reports/summary
    if (method === 'GET' && path.includes('/reports/summary')) {
      return await getAccountSummary(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
    };
  }
}

// ============================================
// HELPER: Parse date range
// ============================================

function parseDateRange(startDate?: string, endDate?: string, preset?: string): { start: string; end: string } {
  const today = new Date();

  if (preset) {
    switch (preset) {
      case 'TODAY':
        const todayStr = today.toISOString().split('T')[0];
        return { start: todayStr, end: todayStr };
      case 'YESTERDAY':
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        return { start: yesterdayStr, end: yesterdayStr };
      case 'LAST_7_DAYS':
        const last7 = new Date(today);
        last7.setDate(today.getDate() - 7);
        return {
          start: last7.toISOString().split('T')[0],
          end: today.toISOString().split('T')[0],
        };
      case 'LAST_14_DAYS':
        const last14 = new Date(today);
        last14.setDate(today.getDate() - 14);
        return {
          start: last14.toISOString().split('T')[0],
          end: today.toISOString().split('T')[0],
        };
      case 'LAST_30_DAYS':
        const last30 = new Date(today);
        last30.setDate(today.getDate() - 30);
        return {
          start: last30.toISOString().split('T')[0],
          end: today.toISOString().split('T')[0],
        };
      case 'LAST_90_DAYS':
        const last90 = new Date(today);
        last90.setDate(today.getDate() - 90);
        return {
          start: last90.toISOString().split('T')[0],
          end: today.toISOString().split('T')[0],
        };
      case 'THIS_MONTH':
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        return {
          start: monthStart.toISOString().split('T')[0],
          end: today.toISOString().split('T')[0],
        };
      case 'LAST_MONTH':
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return {
          start: lastMonthStart.toISOString().split('T')[0],
          end: lastMonthEnd.toISOString().split('T')[0],
        };
      case 'THIS_QUARTER':
        const currentQuarter = Math.floor(today.getMonth() / 3);
        const quarterStart = new Date(today.getFullYear(), currentQuarter * 3, 1);
        return {
          start: quarterStart.toISOString().split('T')[0],
          end: today.toISOString().split('T')[0],
        };
      case 'LAST_QUARTER':
        const lastQuarter = Math.floor(today.getMonth() / 3) - 1;
        const lastQuarterYear = lastQuarter < 0 ? today.getFullYear() - 1 : today.getFullYear();
        const lastQuarterNum = lastQuarter < 0 ? 3 : lastQuarter;
        const lastQuarterStart = new Date(lastQuarterYear, lastQuarterNum * 3, 1);
        const lastQuarterEnd = new Date(lastQuarterYear, lastQuarterNum * 3 + 3, 0);
        return {
          start: lastQuarterStart.toISOString().split('T')[0],
          end: lastQuarterEnd.toISOString().split('T')[0],
        };
    }
  }

  // Default to last 30 days if no dates provided
  if (!startDate || !endDate) {
    const defaultStart = new Date(today);
    defaultStart.setDate(today.getDate() - 30);
    return {
      start: defaultStart.toISOString().split('T')[0],
      end: today.toISOString().split('T')[0],
    };
  }

  return { start: startDate, end: endDate };
}


// ============================================
// REPORT HANDLERS
// ============================================

async function getCampaignReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_per_conversion,
        metrics.all_conversions,
        segments.date
      FROM campaign
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `;

    const results = await client.query(query);

    // Aggregate by campaign
    const campaignData: Record<string, any> = {};

    results.forEach((row: any) => {
      const campaignId = row.campaign.id?.toString();
      if (!campaignData[campaignId]) {
        campaignData[campaignId] = {
          campaignId,
          campaignName: row.campaign.name,
          status: row.campaign.status,
          channelType: row.campaign.advertising_channel_type,
          budget: microsToDollars(row.campaign_budget?.amount_micros || 0),
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
          conversionsValue: 0,
          dailyData: [],
        };
      }

      campaignData[campaignId].impressions += row.metrics?.impressions || 0;
      campaignData[campaignId].clicks += row.metrics?.clicks || 0;
      campaignData[campaignId].cost += microsToDollars(row.metrics?.cost_micros || 0);
      campaignData[campaignId].conversions += row.metrics?.conversions || 0;
      campaignData[campaignId].conversionsValue += row.metrics?.conversions_value || 0;

      campaignData[campaignId].dailyData.push({
        date: row.segments?.date,
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: microsToDollars(row.metrics?.cost_micros || 0),
        conversions: row.metrics?.conversions || 0,
      });
    });

    // Calculate derived metrics
    const campaigns = Object.values(campaignData).map((c: any) => ({
      ...c,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions * 100).toFixed(2) : 0,
      avgCpc: c.clicks > 0 ? (c.cost / c.clicks).toFixed(2) : 0,
      costPerConversion: c.conversions > 0 ? (c.cost / c.conversions).toFixed(2) : 0,
      roas: c.cost > 0 ? (c.conversionsValue / c.cost).toFixed(2) : 0,
    }));

    // Calculate totals
    const totals = {
      impressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
      clicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
      cost: campaigns.reduce((sum, c) => sum + c.cost, 0),
      conversions: campaigns.reduce((sum, c) => sum + c.conversions, 0),
      conversionsValue: campaigns.reduce((sum, c) => sum + c.conversionsValue, 0),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        report: {
          dateRange: { start, end },
          campaigns,
          totals: {
            ...totals,
            ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions * 100).toFixed(2) : 0,
            avgCpc: totals.clicks > 0 ? (totals.cost / totals.clicks).toFixed(2) : 0,
            costPerConversion: totals.conversions > 0 ? (totals.cost / totals.conversions).toFixed(2) : 0,
          },
          campaignCount: campaigns.length,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error getting campaign report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getAdGroupReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const campaignId = event.queryStringParameters?.campaignId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    let query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM ad_group
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND ad_group.status != 'REMOVED'
    `;

    if (campaignId) {
      query += ` AND campaign.id = ${campaignId}`;
    }

    query += ' ORDER BY metrics.cost_micros DESC LIMIT 200';

    const results = await client.query(query);

    const adGroups = results.map((row: any) => ({
      adGroupId: row.ad_group.id?.toString(),
      adGroupName: row.ad_group.name,
      status: row.ad_group.status,
      campaignId: row.campaign.id?.toString(),
      campaignName: row.campaign.name,
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      cost: microsToDollars(row.metrics?.cost_micros || 0),
      conversions: row.metrics?.conversions || 0,
      ctr: ((row.metrics?.ctr || 0) * 100).toFixed(2),
      avgCpc: microsToDollars(row.metrics?.average_cpc || 0),
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        report: {
          dateRange: { start, end },
          adGroups,
          total: adGroups.length,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error getting ad group report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getAdReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const adGroupId = event.queryStringParameters?.adGroupId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    let query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group.name,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND ad_group_ad.status != 'REMOVED'
    `;

    if (adGroupId) {
      query += ` AND ad_group.id = ${adGroupId}`;
    }

    query += ' ORDER BY metrics.impressions DESC LIMIT 100';

    const results = await client.query(query);

    const ads = results.map((row: any) => ({
      adId: row.ad_group_ad.ad?.id?.toString(),
      adType: row.ad_group_ad.ad?.type,
      status: row.ad_group_ad.status,
      approvalStatus: row.ad_group_ad.policy_summary?.approval_status,
      adGroupName: row.ad_group.name,
      campaignName: row.campaign.name,
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      cost: microsToDollars(row.metrics?.cost_micros || 0),
      conversions: row.metrics?.conversions || 0,
      ctr: ((row.metrics?.ctr || 0) * 100).toFixed(2),
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        report: {
          dateRange: { start, end },
          ads,
          total: ads.length,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error getting ad report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getKeywordReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const campaignId = event.queryStringParameters?.campaignId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    let query = `
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group.name,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM keyword_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND ad_group_criterion.status != 'REMOVED'
    `;

    if (campaignId) {
      query += ` AND campaign.id = ${campaignId}`;
    }

    query += ' ORDER BY metrics.cost_micros DESC LIMIT 200';

    const results = await client.query(query);

    const keywords = results.map((row: any) => ({
      keyword: row.ad_group_criterion.keyword?.text,
      matchType: row.ad_group_criterion.keyword?.match_type,
      status: row.ad_group_criterion.status,
      qualityScore: row.ad_group_criterion.quality_info?.quality_score,
      adGroupName: row.ad_group.name,
      campaignName: row.campaign.name,
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      cost: microsToDollars(row.metrics?.cost_micros || 0),
      conversions: row.metrics?.conversions || 0,
      ctr: ((row.metrics?.ctr || 0) * 100).toFixed(2),
      avgCpc: microsToDollars(row.metrics?.average_cpc || 0),
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        report: {
          dateRange: { start, end },
          keywords,
          total: keywords.length,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error getting keyword report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getGeographicReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        geographic_view.country_criterion_id,
        geographic_view.location_type,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM geographic_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
      ORDER BY metrics.impressions DESC
      LIMIT 100
    `;

    const results = await client.query(query);

    const locations = results.map((row: any) => ({
      countryCriterionId: row.geographic_view.country_criterion_id?.toString(),
      locationType: row.geographic_view.location_type,
      campaignName: row.campaign.name,
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      cost: microsToDollars(row.metrics?.cost_micros || 0),
      conversions: row.metrics?.conversions || 0,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        report: {
          dateRange: { start, end },
          locations,
          total: locations.length,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error getting geographic report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getDeviceReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        segments.device,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND campaign.status = 'ENABLED'
    `;

    const results = await client.query(query);

    // Aggregate by device
    const deviceData: Record<string, any> = {};

    results.forEach((row: any) => {
      const device = row.segments?.device || 'UNKNOWN';
      if (!deviceData[device]) {
        deviceData[device] = {
          device,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
        };
      }

      deviceData[device].impressions += row.metrics?.impressions || 0;
      deviceData[device].clicks += row.metrics?.clicks || 0;
      deviceData[device].cost += microsToDollars(row.metrics?.cost_micros || 0);
      deviceData[device].conversions += row.metrics?.conversions || 0;
    });

    const devices = Object.values(deviceData).map((d: any) => ({
      ...d,
      ctr: d.impressions > 0 ? (d.clicks / d.impressions * 100).toFixed(2) : 0,
      avgCpc: d.clicks > 0 ? (d.cost / d.clicks).toFixed(2) : 0,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        report: {
          dateRange: { start, end },
          devices,
          total: devices.length,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error getting device report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function downloadReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const reportType = event.queryStringParameters?.type || 'campaign';
  const customerId = event.queryStringParameters?.customerId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    // Get the appropriate report data
    let reportData: any;

    // Create a mock event with the same parameters
    const mockEvent = { ...event };

    switch (reportType) {
      case 'campaign':
        const campaignResult = await getCampaignReport(mockEvent, {});
        reportData = JSON.parse(campaignResult.body);
        break;
      case 'keyword':
        const keywordResult = await getKeywordReport(mockEvent, {});
        reportData = JSON.parse(keywordResult.body);
        break;
      default:
        reportData = { success: false, error: 'Invalid report type' };
    }

    if (!reportData.success) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to generate report' }),
      };
    }

    // Generate CSV
    let csv = '';

    if (reportType === 'campaign' && reportData.report?.campaigns) {
      csv = 'Campaign Name,Status,Impressions,Clicks,Cost,Conversions,CTR,Avg CPC,Cost/Conversion\n';
      reportData.report.campaigns.forEach((c: any) => {
        csv += `"${c.campaignName}",${c.status},${c.impressions},${c.clicks},${c.cost},${c.conversions},${c.ctr}%,$${c.avgCpc},$${c.costPerConversion}\n`;
      });
    } else if (reportType === 'keyword' && reportData.report?.keywords) {
      csv = 'Keyword,Match Type,Campaign,Ad Group,Impressions,Clicks,Cost,Conversions,Quality Score\n';
      reportData.report.keywords.forEach((k: any) => {
        csv += `"${k.keyword}",${k.matchType},"${k.campaignName}","${k.adGroupName}",${k.impressions},${k.clicks},${k.cost},${k.conversions},${k.qualityScore || 'N/A'}\n`;
      });
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${reportType}_report_${start}_${end}.csv"`,
      },
      body: csv,
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error downloading report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getAccountSummary(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const { start, end } = parseDateRange(
    event.queryStringParameters?.startDate,
    event.queryStringParameters?.endDate,
    event.queryStringParameters?.preset
  );

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Get account-level summary
    const query = `
      SELECT
        customer.id,
        customer.descriptive_name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM customer
      WHERE segments.date BETWEEN '${start}' AND '${end}'
    `;

    const results = await client.query(query);

    // Aggregate metrics
    const summary = {
      customerId,
      customerName: results[0]?.customer?.descriptive_name,
      dateRange: { start, end },
      metrics: {
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        conversionsValue: 0,
      },
    };

    results.forEach((row: any) => {
      summary.metrics.impressions += row.metrics?.impressions || 0;
      summary.metrics.clicks += row.metrics?.clicks || 0;
      summary.metrics.cost += microsToDollars(row.metrics?.cost_micros || 0);
      summary.metrics.conversions += row.metrics?.conversions || 0;
      summary.metrics.conversionsValue += row.metrics?.conversions_value || 0;
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        summary: {
          ...summary,
          metrics: {
            ...summary.metrics,
            ctr: summary.metrics.impressions > 0
              ? (summary.metrics.clicks / summary.metrics.impressions * 100).toFixed(2)
              : 0,
            avgCpc: summary.metrics.clicks > 0
              ? (summary.metrics.cost / summary.metrics.clicks).toFixed(2)
              : 0,
            costPerConversion: summary.metrics.conversions > 0
              ? (summary.metrics.cost / summary.metrics.conversions).toFixed(2)
              : 0,
          },
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsReports] Error getting account summary:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

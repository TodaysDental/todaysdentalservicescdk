/**
 * Google Ads Search Query Report Lambda
 * 
 * Handles search query reports for analyzing search terms that triggered ads.
 * Uses global MCC credentials - customerId is passed as a parameter.
 * 
 * Endpoints:
 * - GET /google-ads/search-queries/report - Get search query report
 * - GET /google-ads/search-queries/global - Run global report across all customer IDs
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getSearchQueryReport,
  microsToDollars,
} from '../../shared/utils/google-ads-client';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface SearchQueryItem {
  term: string;
  campaign: string;
  impressions: number;
  clicks: number;
  cost: number;
  customerId: string;
  officeName?: string;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;

  console.log(`[GoogleAdsSearchQueries] ${method} ${path}`);

  try {
    // Route: GET /google-ads/search-queries/report
    if (method === 'GET' && path.includes('/search-queries/report')) {
      return await getSearchQueryReportHandler(event, corsHeaders);
    }

    // Route: GET /google-ads/search-queries/global
    if (method === 'GET' && path.includes('/search-queries/global')) {
      return await runGlobalReport(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsSearchQueries] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message || 'Internal server error',
      }),
    };
  }
}

// ============================================
// SEARCH QUERY REPORT HANDLERS
// ============================================

async function getSearchQueryReportHandler(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const startDate = event.queryStringParameters?.startDate;
  const endDate = event.queryStringParameters?.endDate;
  const limitStr = event.queryStringParameters?.limit;
  const officeName = event.queryStringParameters?.officeName || '';

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  // Default to last 30 days if dates not provided
  const end = endDate || new Date().toISOString().split('T')[0];
  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const limit = limitStr ? parseInt(limitStr, 10) : 10000;

  try {
    // Fetch from Google Ads API
    const searchTerms = await getSearchQueryReport(customerId, start, end, limit);

    const formattedResults: SearchQueryItem[] = searchTerms.map((st) => ({
      term: st.search_term_view?.search_term || '',
      campaign: st.campaign?.name || '',
      impressions: st.metrics?.impressions || 0,
      clicks: st.metrics?.clicks || 0,
      cost: microsToDollars(st.metrics?.cost_micros || 0),
      customerId,
      officeName,
    }));

    // Sort by impressions (highest first)
    formattedResults.sort((a, b) => b.impressions - a.impressions);

    // Calculate summary stats
    const totalImpressions = formattedResults.reduce((sum, r) => sum + r.impressions, 0);
    const totalClicks = formattedResults.reduce((sum, r) => sum + r.clicks, 0);
    const totalCost = formattedResults.reduce((sum, r) => sum + r.cost, 0);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: formattedResults,
        totalTerms: formattedResults.length,
        summary: {
          totalImpressions,
          totalClicks,
          totalCost,
          ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
          costPerClick: totalClicks > 0 ? totalCost / totalClicks : 0,
        },
        dateRange: { startDate: start, endDate: end },
        customerId,
        officeName,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsSearchQueries] Error fetching report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function runGlobalReport(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const startDate = event.queryStringParameters?.startDate;
  const endDate = event.queryStringParameters?.endDate;
  const customerIdsParam = event.queryStringParameters?.customerIds;
  const limitPerAccount = event.queryStringParameters?.limitPerAccount;

  if (!customerIdsParam) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerIds is required (comma-separated list)' }),
    };
  }

  // Default to last 30 days if dates not provided
  const end = endDate || new Date().toISOString().split('T')[0];
  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const limit = limitPerAccount ? parseInt(limitPerAccount, 10) : 1000;

  // Parse customer IDs
  const customerIds = customerIdsParam.split(',').map(id => id.trim()).filter(Boolean);

  console.log(`[GoogleAdsSearchQueries] Running global report for ${customerIds.length} accounts`);

  const allResults: SearchQueryItem[] = [];
  const accountResults: Record<string, { success: boolean; count: number; error?: string }> = {};

  try {
    // Process accounts in parallel batches of 5
    const batchSize = 5;
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (customerId) => {
        try {
          const searchTerms = await getSearchQueryReport(customerId, start, end, limit);

          const formattedResults = searchTerms.map((st) => ({
            term: st.search_term_view?.search_term || '',
            campaign: st.campaign?.name || '',
            impressions: st.metrics?.impressions || 0,
            clicks: st.metrics?.clicks || 0,
            cost: microsToDollars(st.metrics?.cost_micros || 0),
            customerId,
            officeName: customerId, // Could be mapped to office name
          }));

          accountResults[customerId] = {
            success: true,
            count: formattedResults.length,
          };

          return formattedResults;
        } catch (error: any) {
          console.error(`[GoogleAdsSearchQueries] Error for account ${customerId}:`, error.message);
          accountResults[customerId] = {
            success: false,
            count: 0,
            error: error.message,
          };
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(results => allResults.push(...results));
    }

    // Sort by impressions (highest first)
    allResults.sort((a, b) => b.impressions - a.impressions);

    // Calculate global summary stats
    const totalImpressions = allResults.reduce((sum, r) => sum + r.impressions, 0);
    const totalClicks = allResults.reduce((sum, r) => sum + r.clicks, 0);
    const totalCost = allResults.reduce((sum, r) => sum + r.cost, 0);

    const successfulAccounts = Object.values(accountResults).filter(r => r.success).length;
    const failedAccounts = Object.values(accountResults).filter(r => !r.success).length;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: allResults,
        totalTerms: allResults.length,
        summary: {
          totalImpressions,
          totalClicks,
          totalCost,
          ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
          costPerClick: totalClicks > 0 ? totalCost / totalClicks : 0,
        },
        dateRange: { startDate: start, endDate: end },
        accountsProcessed: {
          total: customerIds.length,
          successful: successfulAccounts,
          failed: failedAccounts,
        },
        accountResults,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsSearchQueries] Error running global report:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

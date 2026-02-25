/**
 * Google Ads Ads Management Lambda
 * 
 * Handles CRUD operations for Google Ads ads including:
 * - Responsive Search Ads (RSA)
 * - Display Ads
 * - Ad Extensions (Sitelinks, Callouts, Call, Location)
 * 
 * Endpoints:
 * - GET /google-ads/ads - List ads for an ad group
 * - POST /google-ads/ads - Create a new ad
 * - GET /google-ads/ads/{id} - Get single ad
 * - PUT /google-ads/ads/{id} - Update ad
 * - DELETE /google-ads/ads/{id} - Delete ad (set to REMOVED)
 * - POST /google-ads/ads/pause - Pause an ad
 * - POST /google-ads/ads/enable - Enable an ad
 * - GET /google-ads/extensions - List ad extensions
 * - POST /google-ads/extensions - Create ad extension
 * - DELETE /google-ads/extensions/{id} - Delete extension
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
// TYPE DEFINITIONS
// ============================================

interface CreateRSARequest {
  customerId: string;
  adGroupResourceName: string;
  headlines: string[]; // 3-15 headlines (max 30 chars each)
  descriptions: string[]; // 2-4 descriptions (max 90 chars each)
  finalUrl: string;
  path1?: string;
  path2?: string;
  status?: 'ENABLED' | 'PAUSED';
}

interface UpdateAdRequest {
  customerId: string;
  adGroupResourceName?: string; // Required for content updates (delete & recreate)
  status?: 'ENABLED' | 'PAUSED';
  // RSA content fields (triggers delete & recreate)
  headlines?: string[];
  descriptions?: string[];
  finalUrl?: string;
  path1?: string;
  path2?: string;
}

interface CreateSitelinkRequest {
  customerId: string;
  campaignResourceName: string;
  sitelinkText: string;
  description1?: string;
  description2?: string;
  finalUrl: string;
}

interface CreateCalloutRequest {
  customerId: string;
  campaignResourceName: string;
  calloutText: string;
}

interface CreateCallExtensionRequest {
  customerId: string;
  campaignResourceName: string;
  phoneNumber: string;
  countryCode?: string;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;
  const pathParts = path.split('/').filter(Boolean);

  console.log(`[GoogleAdsAds] ${method} ${path}`);

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
    // Route: GET /google-ads/ads - List ads
    if (method === 'GET' && path.endsWith('/ads')) {
      return await listAds(event, corsHeaders);
    }

    // Route: POST /google-ads/ads - Create ad
    if (method === 'POST' && path.endsWith('/ads')) {
      return await createAd(event, corsHeaders);
    }

    // Route: GET /google-ads/ads/{id} - Get single ad
    if (method === 'GET' && pathParts.includes('ads') && pathParts.length > pathParts.indexOf('ads') + 1 && !path.includes('/extensions')) {
      return await getAd(event, corsHeaders);
    }

    // Route: PUT /google-ads/ads/{id} - Update ad
    if (method === 'PUT' && pathParts.includes('ads')) {
      return await updateAd(event, corsHeaders);
    }

    // Route: DELETE /google-ads/ads/{id} - Delete ad
    if (method === 'DELETE' && pathParts.includes('ads') && !path.includes('/extensions')) {
      return await deleteAd(event, corsHeaders);
    }

    // Route: POST /google-ads/ads/pause - Pause ad
    if (method === 'POST' && path.includes('/ads/pause')) {
      return await pauseAd(event, corsHeaders);
    }

    // Route: POST /google-ads/ads/enable - Enable ad
    if (method === 'POST' && path.includes('/ads/enable')) {
      return await enableAd(event, corsHeaders);
    }

    // Route: GET /google-ads/extensions - List extensions
    if (method === 'GET' && path.endsWith('/extensions')) {
      return await listExtensions(event, corsHeaders);
    }

    // Route: POST /google-ads/extensions - Create extension
    if (method === 'POST' && path.endsWith('/extensions')) {
      return await createExtension(event, corsHeaders);
    }

    // Route: DELETE /google-ads/extensions/{id} - Delete extension
    if (method === 'DELETE' && pathParts.includes('extensions')) {
      return await deleteExtension(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error:', error);
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
// AD HANDLERS
// ============================================

async function listAds(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const adGroupResourceName = event.queryStringParameters?.adGroupResourceName;

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
        ad_group_ad.ad.resource_name,
        ad_group_ad.ad.type,
        ad_group_ad.ad.name,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group.id,
        ad_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM ad_group_ad
      WHERE ad_group_ad.status != 'REMOVED'
    `;

    if (adGroupResourceName) {
      query += ` AND ad_group.resource_name = '${adGroupResourceName}'`;
    }

    query += ' ORDER BY metrics.impressions DESC LIMIT 100';

    const results = await client.query(query);

    const ads = results.map((row: any) => ({
      adId: row.ad_group_ad.ad.id.toString(),
      resourceName: row.ad_group_ad.ad.resource_name,
      type: row.ad_group_ad.ad.type,
      name: row.ad_group_ad.ad.name,
      finalUrls: row.ad_group_ad.ad.final_urls || [],
      status: row.ad_group_ad.status,
      approvalStatus: row.ad_group_ad.policy_summary?.approval_status,
      responsiveSearchAd: row.ad_group_ad.ad.responsive_search_ad ? {
        headlines: row.ad_group_ad.ad.responsive_search_ad.headlines?.map((h: any) => h.text) || [],
        descriptions: row.ad_group_ad.ad.responsive_search_ad.descriptions?.map((d: any) => d.text) || [],
        path1: row.ad_group_ad.ad.responsive_search_ad.path1,
        path2: row.ad_group_ad.ad.responsive_search_ad.path2,
      } : null,
      adGroup: {
        id: row.ad_group.id.toString(),
        name: row.ad_group.name,
      },
      metrics: {
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: microsToDollars(row.metrics?.cost_micros || 0),
        conversions: row.metrics?.conversions || 0,
        ctr: row.metrics?.ctr || 0,
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        ads,
        total: ads.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error listing ads:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createAd(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: CreateRSARequest = JSON.parse(event.body || '{}');
  const { customerId, adGroupResourceName, headlines, descriptions, finalUrl, path1, path2, status = 'PAUSED' } = body;

  // Validation
  if (!customerId || !adGroupResourceName || !headlines || !descriptions || !finalUrl) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: customerId, adGroupResourceName, headlines, descriptions, finalUrl',
      }),
    };
  }

  if (headlines.length < 3 || headlines.length > 15) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Headlines must be between 3 and 15 items',
      }),
    };
  }

  if (descriptions.length < 2 || descriptions.length > 4) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Descriptions must be between 2 and 4 items',
      }),
    };
  }

  // Validate headline lengths
  const invalidHeadlines = headlines.filter(h => h.length > 30);
  if (invalidHeadlines.length > 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: `Headlines must be 30 characters or less. Invalid: ${invalidHeadlines.join(', ')}`,
      }),
    };
  }

  // Validate description lengths
  const invalidDescriptions = descriptions.filter(d => d.length > 90);
  if (invalidDescriptions.length > 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: `Descriptions must be 90 characters or less`,
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const adGroupAdOperation = {
      ad_group: adGroupResourceName,
      status,
      ad: {
        responsive_search_ad: {
          headlines: headlines.map(text => ({ text })),
          descriptions: descriptions.map(text => ({ text })),
          path1: path1 || undefined,
          path2: path2 || undefined,
        },
        final_urls: [finalUrl],
      },
    };

    const response = await (client as any).adGroupAds.create([adGroupAdOperation]);
    const resourceName = response.results[0].resource_name;

    console.log(`[GoogleAdsAds] Created RSA: ${resourceName}`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        ad: {
          resourceName,
          type: 'RESPONSIVE_SEARCH_AD',
          status,
          headlines,
          descriptions,
          finalUrl,
        },
        message: 'Responsive Search Ad created successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error creating ad:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getAd(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const adId = event.pathParameters?.id;
  const customerId = event.queryStringParameters?.customerId;

  if (!adId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'adId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.resource_name,
        ad_group_ad.ad.type,
        ad_group_ad.ad.name,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.policy_topic_entries,
        ad_group.id,
        ad_group.name,
        ad_group.resource_name,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM ad_group_ad
      WHERE ad_group_ad.ad.id = ${adId}
    `;

    const results = await client.query(query);

    if (results.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Ad not found' }),
      };
    }

    const row = results[0];
    const adGroupAd = row.ad_group_ad;
    const adData = adGroupAd?.ad;
    const adGroup = row.ad_group;

    const ad = {
      adId: adData?.id?.toString() || '',
      resourceName: adData?.resource_name || '',
      type: adData?.type || '',
      name: adData?.name || '',
      finalUrls: adData?.final_urls || [],
      status: adGroupAd?.status || '',
      approvalStatus: adGroupAd?.policy_summary?.approval_status,
      policyTopics: adGroupAd?.policy_summary?.policy_topic_entries,
      responsiveSearchAd: adData?.responsive_search_ad ? {
        headlines: adData.responsive_search_ad.headlines?.map((h: any) => ({
          text: h.text,
          pinnedField: h.pinned_field,
        })) || [],
        descriptions: adData.responsive_search_ad.descriptions?.map((d: any) => ({
          text: d.text,
          pinnedField: d.pinned_field,
        })) || [],
        path1: adData.responsive_search_ad.path1,
        path2: adData.responsive_search_ad.path2,
      } : null,
      adGroup: {
        id: adGroup?.id?.toString() || '',
        name: adGroup?.name || '',
        resourceName: adGroup?.resource_name || '',
      },
      campaign: {
        name: row.campaign?.name,
      },
      metrics: {
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: microsToDollars(row.metrics?.cost_micros || 0),
        conversions: row.metrics?.conversions || 0,
        ctr: row.metrics?.ctr || 0,
        averageCpc: microsToDollars(row.metrics?.average_cpc || 0),
      },
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        ad,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error getting ad:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateAd(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const adId = event.pathParameters?.id;
  const body: UpdateAdRequest = JSON.parse(event.body || '{}');
  const { customerId, adGroupResourceName, status, headlines, descriptions, finalUrl, path1, path2 } = body;

  if (!adId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'adId and customerId are required' }),
    };
  }

  // Check if this is a content update (requires delete & recreate)
  const hasContentUpdate = headlines || descriptions || finalUrl !== undefined;

  try {
    const client = await getGoogleAdsClient(customerId);

    // First get the current ad details
    const query = `
      SELECT 
        ad_group_ad.ad.id, 
        ad_group_ad.ad.resource_name, 
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.status,
        ad_group.resource_name
      FROM ad_group_ad
      WHERE ad_group_ad.ad.id = ${adId}
    `;

    const results = await client.query(query);
    if (results.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Ad not found' }),
      };
    }

    const currentAd = results[0];
    const currentAdGroupResourceName = adGroupResourceName || currentAd.ad_group?.resource_name || '';
    const adGroupId = currentAdGroupResourceName ? currentAdGroupResourceName.split('/').pop() : '';
    const adGroupAdResourceName = `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`;

    // If content update, we need to delete and recreate
    if (hasContentUpdate) {
      // Validate adGroupResourceName for content updates
      if (!currentAdGroupResourceName) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'adGroupResourceName is required for content updates' }),
        };
      }

      // Get current values for fields not being updated
      const currentRsa = currentAd.ad_group_ad?.ad?.responsive_search_ad;
      const currentHeadlines = currentRsa?.headlines?.map((h: any) => h.text) || [];
      const currentDescriptions = currentRsa?.descriptions?.map((d: any) => d.text) || [];
      const currentFinalUrl = currentAd.ad_group_ad?.ad?.final_urls?.[0] || '';
      const currentPath1 = currentRsa?.path1 || '';
      const currentPath2 = currentRsa?.path2 || '';
      const currentStatus = currentAd.ad_group_ad?.status || 'PAUSED';

      // Merge with new values
      const newHeadlines = headlines || currentHeadlines;
      const newDescriptions = descriptions || currentDescriptions;
      const newFinalUrl = finalUrl !== undefined ? finalUrl : currentFinalUrl;
      const newPath1 = path1 !== undefined ? path1 : currentPath1;
      const newPath2 = path2 !== undefined ? path2 : currentPath2;
      const newStatus = status || currentStatus;

      // Validate new headlines
      if (newHeadlines.length < 3 || newHeadlines.length > 15) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Headlines must be between 3 and 15 items' }),
        };
      }

      // Validate new descriptions
      if (newDescriptions.length < 2 || newDescriptions.length > 4) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Descriptions must be between 2 and 4 items' }),
        };
      }

      // Validate headline lengths
      const invalidHeadlines = newHeadlines.filter((h: string) => h.length > 30);
      if (invalidHeadlines.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: `Headlines must be 30 characters or less` }),
        };
      }

      // Validate description lengths
      const invalidDescriptions = newDescriptions.filter((d: string) => d.length > 90);
      if (invalidDescriptions.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: `Descriptions must be 90 characters or less` }),
        };
      }

      // Step 1: Delete the old ad
      // Google Ads API doesn't allow setting status to REMOVED via update;
      // must use the remove operation instead
      await (client as any).adGroupAds.remove([adGroupAdResourceName]);
      console.log(`[GoogleAdsAds] Removed old ad: ${adId}`);

      // Step 2: Create new ad with updated content
      const adGroupAdOperation = {
        ad_group: currentAdGroupResourceName,
        status: newStatus,
        ad: {
          responsive_search_ad: {
            headlines: newHeadlines.map((text: string) => ({ text })),
            descriptions: newDescriptions.map((text: string) => ({ text })),
            path1: newPath1 || undefined,
            path2: newPath2 || undefined,
          },
          final_urls: [newFinalUrl],
        },
      };

      const response = await (client as any).adGroupAds.create([adGroupAdOperation]);
      const newResourceName = response.results[0].resource_name;

      console.log(`[GoogleAdsAds] Created new ad: ${newResourceName}`);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Ad updated successfully (replaced)',
          newResourceName,
          updatedFields: ['headlines', 'descriptions', 'finalUrl', 'path1', 'path2', 'status'].filter(
            f => body[f as keyof UpdateAdRequest] !== undefined
          ),
        }),
      };
    }

    // Status-only update (in-place)
    if (status) {
      // google-ads-api library auto-computes field masks from provided fields
      const updateOperation = {
        resource_name: adGroupAdResourceName,
        status,
      };

      await (client as any).adGroupAds.update([updateOperation]);

      console.log(`[GoogleAdsAds] Updated ad status: ${adId}`);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Ad updated successfully',
          updatedFields: ['status'],
        }),
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No fields to update' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error updating ad:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}


async function deleteAd(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const adId = event.pathParameters?.id;
  const customerId = event.queryStringParameters?.customerId;

  if (!adId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'adId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Get ad group for the ad
    const query = `
      SELECT ad_group_ad.ad.id, ad_group.resource_name
      FROM ad_group_ad
      WHERE ad_group_ad.ad.id = ${adId}
    `;

    const results = await client.query(query);
    if (results.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Ad not found' }),
      };
    }

    const adGroupResourceName = results[0].ad_group?.resource_name || '';
    const adGroupId = adGroupResourceName ? adGroupResourceName.split('/').pop() : '';
    const adGroupAdResourceName = `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`;

    // Remove the ad — Google Ads API requires .remove(), not update with REMOVED status
    await (client as any).adGroupAds.remove([adGroupAdResourceName]);

    console.log(`[GoogleAdsAds] Deleted (removed) ad: ${adId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Ad deleted successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error deleting ad:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function pauseAd(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { customerId, adId } = body;

  if (!customerId || !adId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId and adId are required' }),
    };
  }

  // Use update handler with PAUSED status
  event.pathParameters = { id: adId };
  event.body = JSON.stringify({ customerId, status: 'PAUSED' });
  return updateAd(event, corsHeaders);
}

async function enableAd(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { customerId, adId } = body;

  if (!customerId || !adId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId and adId are required' }),
    };
  }

  // Use update handler with ENABLED status
  event.pathParameters = { id: adId };
  event.body = JSON.stringify({ customerId, status: 'ENABLED' });
  return updateAd(event, corsHeaders);
}

// ============================================
// EXTENSION HANDLERS
// ============================================

async function listExtensions(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const campaignResourceName = event.queryStringParameters?.campaignResourceName;
  const type = event.queryStringParameters?.type; // sitelink, callout, call, etc.

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const extensions: any[] = [];

    // Query sitelinks
    const sitelinkQuery = `
      SELECT
        asset.id,
        asset.name,
        asset.resource_name,
        asset.type,
        asset.sitelink_asset.link_text,
        asset.sitelink_asset.description1,
        asset.sitelink_asset.description2,
        asset.final_urls
      FROM asset
      WHERE asset.type = 'SITELINK'
      LIMIT 50
    `;

    const sitelinkResults = await client.query(sitelinkQuery);
    sitelinkResults.forEach((row: any) => {
      extensions.push({
        id: row.asset.id.toString(),
        resourceName: row.asset.resource_name,
        type: 'SITELINK',
        name: row.asset.name,
        sitelinkAsset: {
          linkText: row.asset.sitelink_asset?.link_text,
          description1: row.asset.sitelink_asset?.description1,
          description2: row.asset.sitelink_asset?.description2,
        },
        finalUrls: row.asset.final_urls || [],
      });
    });

    // Query callouts
    const calloutQuery = `
      SELECT
        asset.id,
        asset.name,
        asset.resource_name,
        asset.type,
        asset.callout_asset.callout_text
      FROM asset
      WHERE asset.type = 'CALLOUT'
      LIMIT 50
    `;

    const calloutResults = await client.query(calloutQuery);
    calloutResults.forEach((row: any) => {
      extensions.push({
        id: row.asset.id.toString(),
        resourceName: row.asset.resource_name,
        type: 'CALLOUT',
        name: row.asset.name,
        calloutAsset: {
          calloutText: row.asset.callout_asset?.callout_text,
        },
      });
    });

    // Query call extensions
    const callQuery = `
      SELECT
        asset.id,
        asset.name,
        asset.resource_name,
        asset.type,
        asset.call_asset.phone_number,
        asset.call_asset.country_code
      FROM asset
      WHERE asset.type = 'CALL'
      LIMIT 20
    `;

    const callResults = await client.query(callQuery);
    callResults.forEach((row: any) => {
      extensions.push({
        id: row.asset.id.toString(),
        resourceName: row.asset.resource_name,
        type: 'CALL',
        name: row.asset.name,
        callAsset: {
          phoneNumber: row.asset.call_asset?.phone_number,
          countryCode: row.asset.call_asset?.country_code,
        },
      });
    });

    // Filter by type if specified
    const filteredExtensions = type
      ? extensions.filter(e => e.type === type.toUpperCase())
      : extensions;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        extensions: filteredExtensions,
        total: filteredExtensions.length,
        byType: {
          sitelinks: extensions.filter(e => e.type === 'SITELINK').length,
          callouts: extensions.filter(e => e.type === 'CALLOUT').length,
          calls: extensions.filter(e => e.type === 'CALL').length,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error listing extensions:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createExtension(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { customerId, type, campaignResourceName } = body;

  if (!customerId || !type) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId and type are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    let assetOperation: any;
    let assetType: string;

    switch (type.toUpperCase()) {
      case 'SITELINK':
        const sitelinkBody = body as CreateSitelinkRequest;
        if (!sitelinkBody.sitelinkText || !sitelinkBody.finalUrl) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'sitelinkText and finalUrl are required for sitelinks' }),
          };
        }
        assetOperation = {
          create: {
            sitelink_asset: {
              link_text: sitelinkBody.sitelinkText,
              description1: sitelinkBody.description1,
              description2: sitelinkBody.description2,
            },
            final_urls: [sitelinkBody.finalUrl],
          },
        };
        assetType = 'SITELINK';
        break;

      case 'CALLOUT':
        const calloutBody = body as CreateCalloutRequest;
        if (!calloutBody.calloutText) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'calloutText is required for callouts' }),
          };
        }
        assetOperation = {
          create: {
            callout_asset: {
              callout_text: calloutBody.calloutText,
            },
          },
        };
        assetType = 'CALLOUT';
        break;

      case 'CALL':
        const callBody = body as CreateCallExtensionRequest;
        if (!callBody.phoneNumber) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'phoneNumber is required for call extensions' }),
          };
        }
        assetOperation = {
          create: {
            call_asset: {
              phone_number: callBody.phoneNumber,
              country_code: callBody.countryCode || 'US',
            },
          },
        };
        assetType = 'CALL';
        break;

      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: `Unsupported extension type: ${type}` }),
        };
    }

    console.log(`[GoogleAdsAds] Creating ${assetType} asset with operation:`, JSON.stringify(assetOperation, null, 2));

    const response = await (client as any).assets.create([assetOperation]);
    const resourceName = response.results[0].resource_name;

    console.log(`[GoogleAdsAds] Created ${assetType} extension: ${resourceName}`);

    // If campaign is specified, link the asset to the campaign with the correct field_type
    if (campaignResourceName) {
      // Determine the correct field_type based on asset type
      let fieldType: string;
      switch (assetType) {
        case 'SITELINK':
          fieldType = 'SITELINK';
          break;
        case 'CALLOUT':
          fieldType = 'CALLOUT';
          break;
        case 'CALL':
          fieldType = 'CALL';
          break;
        default:
          fieldType = assetType;
      }

      const linkOperation = {
        create: {
          asset: resourceName,
          campaign: campaignResourceName,
          field_type: fieldType,
        },
      };

      console.log(`[GoogleAdsAds] Linking asset to campaign with operation:`, JSON.stringify(linkOperation, null, 2));

      await (client as any).campaignAssets.create([linkOperation]);
      console.log(`[GoogleAdsAds] Linked asset to campaign: ${campaignResourceName}`);
    }

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        extension: {
          resourceName,
          type: assetType,
        },
        message: `${assetType} extension created successfully`,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error creating extension:', error);
    // Include more detailed error information
    const errorMessage = error.errors?.[0]?.message || error.message || 'Unknown error';
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: errorMessage,
        details: error.errors ? error.errors.map((e: any) => ({ message: e.message, code: e.error_code })) : undefined
      }),
    };
  }
}

async function deleteExtension(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const extensionId = event.pathParameters?.id;
  const customerId = event.queryStringParameters?.customerId;

  if (!extensionId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'extensionId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/assets/${extensionId}`;

    const removeOperation = {
      remove: resourceName,
    };

    await (client as any).assets.remove([removeOperation]);

    console.log(`[GoogleAdsAds] Deleted extension: ${resourceName}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Extension deleted successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAds] Error deleting extension:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

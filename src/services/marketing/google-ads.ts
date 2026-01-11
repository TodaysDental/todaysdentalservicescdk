/**
 * Google Ads Campaign Management Lambda
 * 
 * Handles CRUD operations for Google Ads campaigns.
 * Uses global MCC credentials - customerId is passed as a parameter.
 * 
 * Endpoints:
 * - GET /google-ads/campaigns - List campaigns
 * - POST /google-ads/campaigns - Create campaign
 * - GET /google-ads/campaigns/{id} - Get single campaign
 * - PUT /google-ads/campaigns/{id} - Update campaign
 * - DELETE /google-ads/campaigns/{id} - Delete campaign
 * - GET /google-ads/ad-groups - List ad groups for a campaign
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';
import {
  getGoogleAdsClient,
  getCampaigns,
  getAdGroups,
  microsToDollars,
  dollarsToMicros,
  getAllClinicsWithGoogleAdsStatus,
} from '../../shared/utils/google-ads-client';

// Module permission configuration
// Requires 'Marketing' module access OR SuperAdmin/GlobalSuperAdmin
const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const GOOGLE_ADS_CAMPAIGNS_TABLE = process.env.GOOGLE_ADS_CAMPAIGNS_TABLE || 'GoogleAdsCampaigns';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface Campaign {
  campaignId: string;
  customerId: string;
  googleCampaignId: string;
  name: string;
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
  type: string;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  costPerConversion: number;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
}

interface CreateCampaignRequest {
  customerId: string;
  name: string;
  type: 'SEARCH' | 'DISPLAY' | 'VIDEO';
  dailyBudget: number;
  status?: 'ENABLED' | 'PAUSED';
  // Smart bidding options
  biddingStrategy?: 'MANUAL_CPC' | 'TARGET_CPA' | 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CLICKS' | 'TARGET_ROAS';
  targetCpa?: number; // Target CPA in dollars
  targetRoas?: number; // Target ROAS as percentage (e.g., 300 = 300%)
  // Ad group and ad creation
  adGroup?: {
    name: string;
    cpcBidMicros?: number;
  };
  ad?: {
    headlines: string[]; // Up to 15 headlines
    descriptions: string[]; // Up to 4 descriptions
    finalUrl: string;
    path1?: string;
    path2?: string;
  };
}

interface UpdateCampaignRequest {
  status?: 'ENABLED' | 'PAUSED';
  dailyBudget?: number;
  name?: string;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;
  const pathParts = path.split('/').filter(Boolean);

  console.log(`[GoogleAds] ${method} ${path}`);

  // Handle preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // ============================================
  // PERMISSION CHECK
  // Requires: SuperAdmin, GlobalSuperAdmin, OR Marketing module access
  // ============================================
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Unauthorized - Invalid token' }),
    };
  }

  const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
  if (!hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: `Access denied: requires ${MODULE_NAME} module ${requiredPermission} permission or SuperAdmin access` 
      }),
    };
  }

  try {
    // Route: GET /google-ads/campaigns
    if (method === 'GET' && path.endsWith('/campaigns')) {
      return await listCampaigns(event, corsHeaders);
    }

    // Route: POST /google-ads/campaigns
    if (method === 'POST' && path.endsWith('/campaigns')) {
      return await createCampaign(event, corsHeaders);
    }

    // Route: GET /google-ads/campaigns/{id}
    if (method === 'GET' && pathParts.includes('campaigns') && pathParts.length > pathParts.indexOf('campaigns') + 1) {
      return await getCampaign(event, corsHeaders);
    }

    // Route: PUT /google-ads/campaigns/{id}
    if (method === 'PUT' && pathParts.includes('campaigns')) {
      return await updateCampaign(event, corsHeaders);
    }

    // Route: DELETE /google-ads/campaigns/{id}
    if (method === 'DELETE' && pathParts.includes('campaigns')) {
      return await deleteCampaign(event, corsHeaders);
    }

    // Route: GET /google-ads/ad-groups
    if (method === 'GET' && path.endsWith('/ad-groups')) {
      return await listAdGroups(event, corsHeaders);
    }

    // Route: POST /google-ads/ad-groups
    if (method === 'POST' && path.endsWith('/ad-groups')) {
      return await createAdGroup(event, corsHeaders);
    }

    // Route: GET /google-ads/ad-groups/{id}
    if (method === 'GET' && pathParts.includes('ad-groups') && pathParts.length > pathParts.indexOf('ad-groups') + 1) {
      return await getAdGroup(event, corsHeaders);
    }

    // Route: PUT /google-ads/ad-groups/{id}
    if (method === 'PUT' && pathParts.includes('ad-groups')) {
      return await updateAdGroup(event, corsHeaders);
    }

    // Route: DELETE /google-ads/ad-groups/{id}
    if (method === 'DELETE' && pathParts.includes('ad-groups')) {
      return await deleteAdGroup(event, corsHeaders);
    }

    // Route: GET /google-ads/clinics
    if (method === 'GET' && path.endsWith('/clinics')) {
      return await listClinics(event, corsHeaders);
    }

    // Route: GET /google-ads/dashboard
    if (method === 'GET' && path.endsWith('/dashboard')) {
      return await getDashboard(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error:', error);
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
// CAMPAIGN HANDLERS
// ============================================

async function listCampaigns(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const status = event.queryStringParameters?.status;
  const syncFromGoogle = event.queryStringParameters?.sync === 'true';

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    if (syncFromGoogle) {
      // Fetch fresh data from Google Ads API
      const googleCampaigns = await getCampaigns(customerId);

      const campaigns = googleCampaigns.map(gc => ({
        campaignId: `${customerId}-${gc.campaign.id}`,
        customerId,
        googleCampaignId: gc.campaign.id.toString(),
        name: gc.campaign.name,
        status: gc.campaign.status,
        type: gc.campaign.advertising_channel_type,
        budget: microsToDollars(gc.campaign_budget?.amount_micros || 0),
        spent: microsToDollars(gc.metrics?.cost_micros || 0),
        impressions: gc.metrics?.impressions || 0,
        clicks: gc.metrics?.clicks || 0,
        ctr: gc.metrics?.impressions ? (gc.metrics.clicks / gc.metrics.impressions) * 100 : 0,
        conversions: gc.metrics?.conversions || 0,
        costPerConversion: gc.metrics?.conversions 
          ? microsToDollars(gc.metrics.cost_micros || 0) / gc.metrics.conversions 
          : 0,
        syncedAt: new Date().toISOString(),
      }));

      // Store in DynamoDB for caching
      for (const campaign of campaigns) {
        await ddb.send(new PutCommand({
          TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
          Item: {
            ...campaign,
            updatedAt: new Date().toISOString(),
          },
        }));
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          campaigns,
          total: campaigns.length,
          syncedFromGoogle: true,
        }),
      };
    }

    // Query from DynamoDB by customerId
    const response = await ddb.send(new QueryCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      IndexName: 'ByCustomer',
      KeyConditionExpression: 'customerId = :customerId',
      FilterExpression: status ? '#status = :status' : undefined,
      ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
      ExpressionAttributeValues: {
        ':customerId': customerId,
        ...(status && { ':status': status }),
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        campaigns: response.Items || [],
        total: response.Items?.length || 0,
        syncedFromGoogle: false,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error listing campaigns:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createCampaign(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: CreateCampaignRequest = JSON.parse(event.body || '{}');
  const { 
    customerId, 
    name, 
    type, 
    dailyBudget, 
    status = 'PAUSED',
    biddingStrategy = 'MANUAL_CPC',
    targetCpa,
    targetRoas,
    adGroup,
    ad,
  } = body;

  if (!customerId || !name || !type || !dailyBudget) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: customerId, name, type, dailyBudget',
      }),
    };
  }

  // Validate smart bidding requirements
  if (biddingStrategy === 'TARGET_CPA' && !targetCpa) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'targetCpa is required when using TARGET_CPA bidding strategy',
      }),
    };
  }

  if (biddingStrategy === 'TARGET_ROAS' && !targetRoas) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'targetRoas is required when using TARGET_ROAS bidding strategy',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Create budget first
    const budgetOperation = {
      create: {
        name: `Budget - ${name} - ${Date.now()}`,
        amount_micros: dollarsToMicros(dailyBudget),
        delivery_method: 'STANDARD',
      },
    };

    const budgetResponse = await (client as any).campaignBudgets.create([budgetOperation]);
    const budgetResourceName = budgetResponse.results[0].resource_name;

    // Build bidding strategy configuration
    const biddingConfig: any = {};
    switch (biddingStrategy) {
      case 'MANUAL_CPC':
        biddingConfig.manual_cpc = { enhanced_cpc_enabled: true };
        break;
      case 'TARGET_CPA':
        biddingConfig.target_cpa = { target_cpa_micros: dollarsToMicros(targetCpa!) };
        break;
      case 'MAXIMIZE_CONVERSIONS':
        biddingConfig.maximize_conversions = {};
        break;
      case 'MAXIMIZE_CLICKS':
        biddingConfig.maximize_clicks = {};
        break;
      case 'TARGET_ROAS':
        biddingConfig.target_roas = { target_roas: targetRoas! / 100 }; // Convert percentage to decimal
        break;
    }

    // Create campaign
    const campaignOperation = {
      create: {
        name,
        status,
        advertising_channel_type: type,
        campaign_budget: budgetResourceName,
        ...biddingConfig,
        network_settings: type === 'SEARCH' ? {
          target_google_search: true,
          target_search_network: true,
        } : undefined,
      },
    };

    const campaignResponse = await (client as any).campaigns.create([campaignOperation]);
    const campaignResourceName = campaignResponse.results[0].resource_name;
    const googleCampaignId = campaignResourceName.split('/').pop();

    let adGroupResourceName: string | undefined;
    let adResourceName: string | undefined;

    // Create Ad Group if provided
    if (adGroup) {
      const adGroupOperation = {
        create: {
          name: adGroup.name || `${name} - Ad Group`,
          campaign: campaignResourceName,
          status: 'ENABLED',
          type: type === 'SEARCH' ? 'SEARCH_STANDARD' : 'DISPLAY_STANDARD',
          cpc_bid_micros: adGroup.cpcBidMicros || dollarsToMicros(2), // Default $2 CPC
        },
      };

      const adGroupResponse = await (client as any).adGroups.create([adGroupOperation]);
      adGroupResourceName = adGroupResponse.results[0].resource_name;
      console.log(`[GoogleAds] Created ad group: ${adGroupResourceName}`);

      // Create Responsive Search Ad if provided
      if (ad && type === 'SEARCH') {
        if (!ad.headlines || ad.headlines.length < 3) {
          console.warn('[GoogleAds] At least 3 headlines required for RSA, skipping ad creation');
        } else if (!ad.descriptions || ad.descriptions.length < 2) {
          console.warn('[GoogleAds] At least 2 descriptions required for RSA, skipping ad creation');
        } else if (!ad.finalUrl) {
          console.warn('[GoogleAds] finalUrl required for RSA, skipping ad creation');
        } else {
          const adOperation = {
            create: {
              ad_group: adGroupResourceName,
              status: 'ENABLED',
              ad: {
                responsive_search_ad: {
                  headlines: ad.headlines.slice(0, 15).map((text, index) => ({
                    text,
                    pinned_field: index < 3 ? undefined : undefined, // Optional: pin first 3
                  })),
                  descriptions: ad.descriptions.slice(0, 4).map(text => ({ text })),
                  path1: ad.path1,
                  path2: ad.path2,
                },
                final_urls: [ad.finalUrl],
              },
            },
          };

          const adResponse = await (client as any).adGroupAds.create([adOperation]);
          adResourceName = adResponse.results[0].resource_name;
          console.log(`[GoogleAds] Created responsive search ad: ${adResourceName}`);
        }
      }
    }

    // Store in DynamoDB with TTL (90 days for cached data)
    const campaignId = `${customerId}-${googleCampaignId}`;
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days from now

    const campaign: Campaign & { biddingStrategy?: string; ttl?: number; adGroupResourceName?: string } = {
      campaignId,
      customerId,
      googleCampaignId,
      name,
      status,
      type,
      budget: dailyBudget,
      spent: 0,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      conversions: 0,
      costPerConversion: 0,
      createdAt: now,
      updatedAt: now,
      syncedAt: now,
      biddingStrategy,
      ttl,
      adGroupResourceName,
    };

    await ddb.send(new PutCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Item: campaign,
    }));

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        campaign,
        adGroupCreated: !!adGroupResourceName,
        adCreated: !!adResourceName,
        message: adGroupResourceName 
          ? 'Campaign, ad group, and ad created successfully' 
          : 'Campaign created successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error creating campaign:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getCampaign(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const campaignId = event.pathParameters?.id || event.pathParameters?.campaignId;

  if (!campaignId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Campaign ID is required' }),
    };
  }

  try {
    const response = await ddb.send(new GetCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Key: { campaignId },
    }));

    if (!response.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Campaign not found' }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        campaign: response.Item,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error getting campaign:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateCampaign(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const campaignId = event.pathParameters?.id || event.pathParameters?.campaignId;
  const body: UpdateCampaignRequest = JSON.parse(event.body || '{}');

  if (!campaignId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Campaign ID is required' }),
    };
  }

  try {
    // Get existing campaign
    const existing = await ddb.send(new GetCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Key: { campaignId },
    }));

    if (!existing.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Campaign not found' }),
      };
    }

    const campaign = existing.Item as Campaign;
    const client = await getGoogleAdsClient(campaign.customerId);

    // Update in Google Ads
    const updateOperation: any = {
      update: {
        resource_name: `customers/${campaign.customerId}/campaigns/${campaign.googleCampaignId}`,
      },
      update_mask: { paths: [] },
    };

    if (body.status) {
      updateOperation.update.status = body.status;
      updateOperation.update_mask.paths.push('status');
    }

    if (body.name) {
      updateOperation.update.name = body.name;
      updateOperation.update_mask.paths.push('name');
    }

    if (updateOperation.update_mask.paths.length > 0) {
      await (client as any).campaigns.update([updateOperation]);
    }

    // Update in DynamoDB
    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Key: { campaignId },
      UpdateExpression: 'SET #status = :status, #name = :name, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#name': 'name',
      },
      ExpressionAttributeValues: {
        ':status': body.status || campaign.status,
        ':name': body.name || campaign.name,
        ':updatedAt': now,
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Campaign updated successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error updating campaign:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function deleteCampaign(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const campaignId = event.pathParameters?.id || event.pathParameters?.campaignId;

  if (!campaignId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Campaign ID is required' }),
    };
  }

  try {
    // Get existing campaign
    const existing = await ddb.send(new GetCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Key: { campaignId },
    }));

    if (!existing.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Campaign not found' }),
      };
    }

    const campaign = existing.Item as Campaign;
    const client = await getGoogleAdsClient(campaign.customerId);

    // Remove (set status to REMOVED) in Google Ads
    const removeOperation = {
      update: {
        resource_name: `customers/${campaign.customerId}/campaigns/${campaign.googleCampaignId}`,
        status: 'REMOVED',
      },
      update_mask: { paths: ['status'] },
    };

    await (client as any).campaigns.update([removeOperation]);

    // Delete from DynamoDB
    await ddb.send(new DeleteCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Key: { campaignId },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Campaign deleted successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error deleting campaign:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// AD GROUP HANDLERS
// ============================================

async function listAdGroups(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const campaignResourceName = event.queryStringParameters?.campaignResourceName;

  if (!customerId || !campaignResourceName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId and campaignResourceName are required' }),
    };
  }

  try {
    const adGroups = await getAdGroups(customerId, campaignResourceName);

    const formattedAdGroups = adGroups.map(ag => ({
      adGroupId: ag.ad_group.id.toString(),
      resourceName: ag.ad_group.resource_name,
      name: ag.ad_group.name,
      status: ag.ad_group.status,
      type: ag.ad_group.type,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        adGroups: formattedAdGroups,
        total: formattedAdGroups.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error listing ad groups:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

interface CreateAdGroupRequest {
  customerId: string;
  campaignResourceName: string;
  name: string;
  cpcBidMicros?: number;
  status?: 'ENABLED' | 'PAUSED';
  type?: 'SEARCH_STANDARD' | 'DISPLAY_STANDARD';
}

interface UpdateAdGroupRequest {
  customerId: string;
  resourceName: string;
  name?: string;
  cpcBidMicros?: number;
  status?: 'ENABLED' | 'PAUSED';
}

async function createAdGroup(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: CreateAdGroupRequest = JSON.parse(event.body || '{}');
  const { customerId, campaignResourceName, name, cpcBidMicros, status = 'ENABLED', type = 'SEARCH_STANDARD' } = body;

  if (!customerId || !campaignResourceName || !name) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: customerId, campaignResourceName, name',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const adGroupOperation = {
      create: {
        name,
        campaign: campaignResourceName,
        status,
        type,
        cpc_bid_micros: cpcBidMicros || dollarsToMicros(2), // Default $2 CPC
      },
    };

    const response = await (client as any).adGroups.create([adGroupOperation]);
    const resourceName = response.results[0].resource_name;
    const adGroupId = resourceName.split('/').pop();

    console.log(`[GoogleAds] Created ad group: ${resourceName}`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        adGroup: {
          adGroupId,
          resourceName,
          name,
          status,
          type,
          cpcBidMicros: cpcBidMicros || dollarsToMicros(2),
        },
        message: 'Ad group created successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error creating ad group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getAdGroup(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const adGroupId = event.pathParameters?.id;
  const customerId = event.queryStringParameters?.customerId;

  if (!adGroupId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'adGroupId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;

    const query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group.cpc_bid_micros,
        ad_group.resource_name,
        campaign.name,
        campaign.resource_name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM ad_group
      WHERE ad_group.resource_name = '${resourceName}'
    `;

    const results = await client.query(query);

    if (results.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Ad group not found' }),
      };
    }

    const ag = results[0];
    const adGroupData = ag.ad_group;
    const adGroup = {
      adGroupId: adGroupData?.id?.toString() || '',
      resourceName: adGroupData?.resource_name || '',
      name: adGroupData?.name || '',
      status: adGroupData?.status || '',
      type: adGroupData?.type || '',
      cpcBidMicros: adGroupData?.cpc_bid_micros,
      cpcBidDollars: microsToDollars(adGroupData?.cpc_bid_micros || 0),
      campaign: {
        name: ag.campaign?.name,
        resourceName: ag.campaign?.resource_name,
      },
      metrics: {
        impressions: ag.metrics?.impressions || 0,
        clicks: ag.metrics?.clicks || 0,
        cost: microsToDollars(ag.metrics?.cost_micros || 0),
        conversions: ag.metrics?.conversions || 0,
      },
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        adGroup,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error getting ad group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateAdGroup(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const adGroupId = event.pathParameters?.id;
  const body: UpdateAdGroupRequest = JSON.parse(event.body || '{}');
  const { customerId, name, cpcBidMicros, status } = body;

  if (!adGroupId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'adGroupId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;

    const updateOperation: any = {
      update: {
        resource_name: resourceName,
      },
      update_mask: { paths: [] },
    };

    if (name) {
      updateOperation.update.name = name;
      updateOperation.update_mask.paths.push('name');
    }

    if (cpcBidMicros !== undefined) {
      updateOperation.update.cpc_bid_micros = cpcBidMicros;
      updateOperation.update_mask.paths.push('cpc_bid_micros');
    }

    if (status) {
      updateOperation.update.status = status;
      updateOperation.update_mask.paths.push('status');
    }

    if (updateOperation.update_mask.paths.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No fields to update' }),
      };
    }

    await (client as any).adGroups.update([updateOperation]);

    console.log(`[GoogleAds] Updated ad group: ${resourceName}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Ad group updated successfully',
        updatedFields: updateOperation.update_mask.paths,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error updating ad group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function deleteAdGroup(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const adGroupId = event.pathParameters?.id;
  const customerId = event.queryStringParameters?.customerId;

  if (!adGroupId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'adGroupId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;

    // Remove = set status to REMOVED
    const removeOperation = {
      update: {
        resource_name: resourceName,
        status: 'REMOVED',
      },
      update_mask: { paths: ['status'] },
    };

    await (client as any).adGroups.update([removeOperation]);

    console.log(`[GoogleAds] Deleted (removed) ad group: ${resourceName}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Ad group deleted successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error deleting ad group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// CLINIC HANDLERS
// ============================================

async function listClinics(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const clinics = await getAllClinicsWithGoogleAdsStatus();

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        clinics,
        total: clinics.length,
        configured: clinics.filter(c => c.hasGoogleAds).length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error listing clinics:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// DASHBOARD HANDLER
// ============================================

async function getDashboard(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;

  try {
    let campaigns: Campaign[] = [];

    if (customerId) {
      // Use Query with GSI for efficient lookup by customerId
      const response = await ddb.send(new QueryCommand({
        TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
        IndexName: 'ByCustomer',
        KeyConditionExpression: 'customerId = :customerId',
        ExpressionAttributeValues: {
          ':customerId': customerId,
        },
        ScanIndexForward: false, // Most recent first
      }));
      campaigns = (response.Items || []) as Campaign[];
    } else {
      // For all campaigns, use Scan but with pagination and limit
      // Note: Consider caching aggregated metrics in a separate table for production
      const response = await ddb.send(new ScanCommand({
        TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
        Limit: 1000, // Limit to prevent timeout
      }));
      campaigns = (response.Items || []) as Campaign[];
    }

    // Calculate dashboard metrics
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter(c => c.status === 'ENABLED').length;
    const pausedCampaigns = campaigns.filter(c => c.status === 'PAUSED').length;
    const totalImpressions = campaigns.reduce((sum, c) => sum + (c.impressions || 0), 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + (c.clicks || 0), 0);
    const totalSpend = campaigns.reduce((sum, c) => sum + (c.spent || 0), 0);
    const totalConversions = campaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgCostPerConversion = totalConversions > 0 ? totalSpend / totalConversions : 0;

    // Performance alerts
    const alerts: Array<{ type: 'warning' | 'error' | 'info'; message: string; campaignId?: string }> = [];
    
    // Check for low-performing campaigns
    campaigns.forEach(campaign => {
      if (campaign.status === 'ENABLED') {
        // Low CTR warning (below 2%)
        if (campaign.impressions > 1000 && campaign.ctr < 2) {
          alerts.push({
            type: 'warning',
            message: `"${campaign.name}" has low CTR (${campaign.ctr.toFixed(2)}%). Consider improving ad copy.`,
            campaignId: campaign.campaignId,
          });
        }
        // High cost per conversion warning
        if (campaign.conversions > 0 && campaign.costPerConversion > 100) {
          alerts.push({
            type: 'warning',
            message: `"${campaign.name}" has high CPA ($${campaign.costPerConversion.toFixed(2)}). Review targeting.`,
            campaignId: campaign.campaignId,
          });
        }
        // No conversions warning
        if (campaign.clicks > 100 && campaign.conversions === 0) {
          alerts.push({
            type: 'error',
            message: `"${campaign.name}" has no conversions with ${campaign.clicks} clicks. Check conversion tracking.`,
            campaignId: campaign.campaignId,
          });
        }
      }
    });

    // Sort campaigns by spend (highest first) for top campaigns
    const topCampaigns = [...campaigns]
      .sort((a, b) => (b.spent || 0) - (a.spent || 0))
      .slice(0, 10);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        dashboard: {
          totalCampaigns,
          activeCampaigns,
          pausedCampaigns,
          totalImpressions,
          totalClicks,
          totalSpend,
          totalConversions,
          ctr: avgCtr,
          costPerConversion: avgCostPerConversion,
          avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
        },
        alerts: alerts.slice(0, 10), // Limit alerts
        campaigns: topCampaigns,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error getting dashboard:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

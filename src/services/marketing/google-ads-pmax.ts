/**
 * Google Ads Performance Max & Shopping Lambda
 * 
 * Handles Performance Max campaigns and Shopping campaigns:
 * - Performance Max campaign creation
 * - Asset groups management
 * - Shopping campaign support
 * - Feed management
 * 
 * Endpoints:
 * - GET /google-ads/pmax/campaigns - List Performance Max campaigns
 * - POST /google-ads/pmax/campaigns - Create Performance Max campaign
 * - GET /google-ads/pmax/asset-groups - List asset groups
 * - POST /google-ads/pmax/asset-groups - Create asset group
 * - PUT /google-ads/pmax/asset-groups/{id} - Update asset group
 * - GET /google-ads/pmax/assets - List assets for asset group
 * - POST /google-ads/pmax/assets - Add assets to asset group
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
  dollarsToMicros,
  enums,
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

interface CreatePMaxCampaignRequest {
  customerId: string;
  name: string;
  dailyBudget: number;
  targetRoas?: number;
  targetCpa?: number;
  status?: 'ENABLED' | 'PAUSED';
  finalUrl: string;
}

interface CreateAssetGroupRequest {
  customerId: string;
  campaignResourceName: string;
  name: string;
  finalUrl: string;
  finalMobileUrl?: string;
  headlines: string[];
  descriptions: string[];
  longHeadlines?: string[];
  businessName: string;
  path1?: string;
  path2?: string;
  status?: 'ENABLED' | 'PAUSED';
}

interface UpdateAssetGroupRequest {
  customerId: string;
  name?: string;
  status?: 'ENABLED' | 'PAUSED';
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;
  const pathParts = path.split('/').filter(Boolean);

  console.log(`[GoogleAdsPMax] ${method} ${path}`);

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
    // Route: GET /google-ads/pmax/campaigns
    if (method === 'GET' && path.includes('/pmax/campaigns')) {
      return await listPMaxCampaigns(event, corsHeaders);
    }

    // Route: POST /google-ads/pmax/campaigns
    if (method === 'POST' && path.includes('/pmax/campaigns')) {
      return await createPMaxCampaign(event, corsHeaders);
    }

    // Route: GET /google-ads/pmax/asset-groups
    if (method === 'GET' && path.includes('/pmax/asset-groups')) {
      return await listAssetGroups(event, corsHeaders);
    }

    // Route: POST /google-ads/pmax/asset-groups
    if (method === 'POST' && path.includes('/pmax/asset-groups')) {
      return await createAssetGroup(event, corsHeaders);
    }

    // Route: PUT /google-ads/pmax/asset-groups/{id}
    if (method === 'PUT' && path.includes('/pmax/asset-groups')) {
      return await updateAssetGroup(event, corsHeaders);
    }

    // Route: GET /google-ads/pmax/assets
    if (method === 'GET' && path.includes('/pmax/assets')) {
      return await listAssets(event, corsHeaders);
    }

    // Route: POST /google-ads/pmax/assets
    if (method === 'POST' && path.includes('/pmax/assets')) {
      return await addAssets(event, corsHeaders);
    }

    // Route: GET /google-ads/pmax/listing-groups
    if (method === 'GET' && path.includes('/pmax/listing-groups')) {
      return await listListingGroups(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error:', error);
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
// PMAX CAMPAIGN HANDLERS
// ============================================

async function listPMaxCampaigns(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;

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
        campaign.resource_name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        campaign.maximize_conversion_value.target_roas,
        campaign.maximize_conversions.target_cpa_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `;

    const results = await client.query(query);

    const campaigns = results.map((row: any) => ({
      id: row.campaign.id?.toString(),
      name: row.campaign.name,
      resourceName: row.campaign.resource_name,
      status: row.campaign.status,
      channelType: row.campaign.advertising_channel_type,
      budget: microsToDollars(row.campaign_budget?.amount_micros || 0),
      targetRoas: row.campaign.maximize_conversion_value?.target_roas,
      targetCpa: row.campaign.maximize_conversions?.target_cpa_micros
        ? microsToDollars(row.campaign.maximize_conversions.target_cpa_micros)
        : null,
      metrics: {
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: microsToDollars(row.metrics?.cost_micros || 0),
        conversions: row.metrics?.conversions || 0,
        conversionsValue: row.metrics?.conversions_value || 0,
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        campaigns,
        total: campaigns.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error listing PMax campaigns:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createPMaxCampaign(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { customerId, name, dailyBudget, targetRoas, targetCpa, status = 'PAUSED', finalUrl, assetGroup, languageTargets } = body;

  if (!customerId || !name || !dailyBudget || !finalUrl) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, name, dailyBudget, and finalUrl are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Step 1: Create budget — must set explicitly_shared to false for campaign-specific budgets
    const budgetResource = {
      name: `PMax Budget - ${name} - ${Date.now()}`,
      amount_micros: dollarsToMicros(dailyBudget),
      explicitly_shared: false,
    };

    console.log('[GoogleAdsPMax] Creating budget:', JSON.stringify(budgetResource));
    const budgetResponse = await (client as any).campaignBudgets.create([budgetResource]);
    const budgetResourceName = budgetResponse.results[0].resource_name;
    console.log(`[GoogleAdsPMax] Budget created: ${budgetResourceName}`);

    // Step 2: Create Performance Max campaign with proper enum values
    const statusEnum = status === 'ENABLED'
      ? enums.CampaignStatus.ENABLED
      : enums.CampaignStatus.PAUSED;

    const campaignResource: any = {
      name,
      campaign_budget: budgetResourceName,
      advertising_channel_type: enums.AdvertisingChannelType.PERFORMANCE_MAX,
      status: statusEnum,
      // Bidding strategy
      ...(targetRoas ? {
        maximize_conversion_value: {
          target_roas: targetRoas,
        },
      } : {
        maximize_conversions: {
          ...(targetCpa ? { target_cpa_micros: dollarsToMicros(targetCpa) } : {}),
        },
      }),
    };

    console.log('[GoogleAdsPMax] Creating campaign:', JSON.stringify(campaignResource));
    const campaignResponse = await (client as any).campaigns.create([campaignResource]);
    const campaignResourceName = campaignResponse.results[0].resource_name;
    const campaignId = campaignResourceName.split('/').pop();

    console.log(`[GoogleAdsPMax] Created Performance Max campaign: ${campaignResourceName}`);

    // Step 3: If assetGroup data is included, create asset group + assets inline
    let assetGroupResult: any = null;
    if (assetGroup && assetGroup.name && assetGroup.headlines?.length && assetGroup.descriptions?.length && assetGroup.businessName) {
      try {
        console.log('[GoogleAdsPMax] Creating inline asset group...');

        // Create asset group
        const assetGroupResource = {
          name: assetGroup.name,
          campaign: campaignResourceName,
          status: 'ENABLED',
          final_urls: [finalUrl],
          path1: assetGroup.path1 || '',
          path2: assetGroup.path2 || '',
        };

        const agResponse = await (client as any).assetGroups.create([assetGroupResource]);
        const agResourceName = agResponse.results[0].resource_name;
        console.log(`[GoogleAdsPMax] Asset group created: ${agResourceName}`);

        // Create and link text assets
        const assetGroupAssetOps: any[] = [];

        // Headlines
        for (const text of assetGroup.headlines) {
          const assetRes = await (client as any).assets.create([{ text_asset: { text } }]);
          assetGroupAssetOps.push({
            asset_group: agResourceName, asset: assetRes.results[0].resource_name, field_type: 'HEADLINE',
          });
        }

        // Long headlines
        if (assetGroup.longHeadlines?.length) {
          for (const text of assetGroup.longHeadlines) {
            const assetRes = await (client as any).assets.create([{ text_asset: { text } }]);
            assetGroupAssetOps.push({
              asset_group: agResourceName, asset: assetRes.results[0].resource_name, field_type: 'LONG_HEADLINE',
            });
          }
        }

        // Descriptions
        for (const text of assetGroup.descriptions) {
          const assetRes = await (client as any).assets.create([{ text_asset: { text } }]);
          assetGroupAssetOps.push({
            asset_group: agResourceName, asset: assetRes.results[0].resource_name, field_type: 'DESCRIPTION',
          });
        }

        // Business name
        const bnRes = await (client as any).assets.create([{ text_asset: { text: assetGroup.businessName } }]);
        assetGroupAssetOps.push({
          asset_group: agResourceName, asset: bnRes.results[0].resource_name, field_type: 'BUSINESS_NAME',
        });

        // Link all assets to asset group
        if (assetGroupAssetOps.length > 0) {
          await (client as any).assetGroupAssets.create(assetGroupAssetOps);
          console.log(`[GoogleAdsPMax] Linked ${assetGroupAssetOps.length} assets to asset group`);
        }

        assetGroupResult = {
          resourceName: agResourceName,
          name: assetGroup.name,
          assetsLinked: assetGroupAssetOps.length,
        };
      } catch (agError: any) {
        console.error('[GoogleAdsPMax] Asset group creation failed (campaign still created):', agError);
        assetGroupResult = { error: extractPMaxErrorMessage(agError) };
      }
    }

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        campaign: {
          id: campaignId,
          resourceName: campaignResourceName,
          name,
          status,
          budget: dailyBudget,
        },
        assetGroup: assetGroupResult,
        message: `Performance Max campaign created successfully${assetGroupResult && !assetGroupResult.error ? ' with asset group' : ''}.`,
      }),
    };
  } catch (error: any) {
    const errorMsg = extractPMaxErrorMessage(error);
    console.error('[GoogleAdsPMax] Error creating PMax campaign:', errorMsg);
    console.error('[GoogleAdsPMax] Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)).slice(0, 2000));
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: errorMsg }),
    };
  }
}

/**
 * Extract meaningful error message from Google Ads gRPC errors
 */
function extractPMaxErrorMessage(error: any): string {
  if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.map((e: any) => e.message || JSON.stringify(e.error_code) || 'Unknown API error').join('; ');
  }
  if (error.message && typeof error.message === 'string') return error.message;
  if (error.details && typeof error.details === 'string') return error.details;
  try {
    const str = String(error);
    if (str && str !== '[object Object]') return str;
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return 'Unknown error';
  }
}


// ============================================
// ASSET GROUP HANDLERS
// ============================================

async function listAssetGroups(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const campaignResourceName = event.queryStringParameters?.campaignResourceName;

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
        asset_group.id,
        asset_group.name,
        asset_group.resource_name,
        asset_group.status,
        asset_group.final_urls,
        asset_group.path1,
        asset_group.path2,
        campaign.name,
        campaign.resource_name
      FROM asset_group
      WHERE asset_group.status != 'REMOVED'
    `;

    if (campaignResourceName) {
      query += ` AND campaign.resource_name = '${campaignResourceName}'`;
    }

    const results = await client.query(query);

    const assetGroups = results.map((row: any) => ({
      id: row.asset_group.id?.toString(),
      name: row.asset_group.name,
      resourceName: row.asset_group.resource_name,
      status: row.asset_group.status,
      finalUrls: row.asset_group.final_urls || [],
      path1: row.asset_group.path1,
      path2: row.asset_group.path2,
      campaign: {
        name: row.campaign?.name,
        resourceName: row.campaign?.resource_name,
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        assetGroups,
        total: assetGroups.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error listing asset groups:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createAssetGroup(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: CreateAssetGroupRequest = JSON.parse(event.body || '{}');
  const {
    customerId,
    campaignResourceName,
    name,
    finalUrl,
    finalMobileUrl,
    headlines,
    descriptions,
    longHeadlines,
    businessName,
    path1,
    path2,
    status = 'ENABLED'
  } = body;

  if (!customerId || !campaignResourceName || !name || !finalUrl || !headlines?.length || !descriptions?.length || !businessName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, campaignResourceName, name, finalUrl, headlines, descriptions, and businessName are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Create asset group
    const assetGroupResource = {
      name,
      campaign: campaignResourceName,
      status,
      final_urls: [finalUrl],
      final_mobile_urls: finalMobileUrl ? [finalMobileUrl] : undefined,
      path1: path1 || '',
      path2: path2 || '',
    };

    const assetGroupResponse = await (client as any).assetGroups.create([assetGroupResource]);
    const assetGroupResourceName = assetGroupResponse.results[0].resource_name;

    console.log(`[GoogleAdsPMax] Created asset group: ${assetGroupResourceName}`);

    // Create headline assets
    const headlineResources = headlines.map(text => ({
      text_asset: { text },
    }));

    const headlineResponse = await (client as any).assets.create(headlineResources);

    // Create description assets
    const descriptionResources = descriptions.map(text => ({
      text_asset: { text },
    }));

    const descriptionResponse = await (client as any).assets.create(descriptionResources);

    // Link assets to asset group
    const assetGroupAssetOperations: any[] = [];

    // Link headlines
    headlineResponse.results.forEach((result: any) => {
      assetGroupAssetOperations.push({
        asset_group: assetGroupResourceName,
        asset: result.resource_name,
        field_type: 'HEADLINE',
      });
    });

    // Link descriptions
    descriptionResponse.results.forEach((result: any) => {
      assetGroupAssetOperations.push({
        asset_group: assetGroupResourceName,
        asset: result.resource_name,
        field_type: 'DESCRIPTION',
      });
    });

    // Create and link business name
    const businessNameAsset = await (client as any).assets.create([{
      text_asset: { text: businessName },
    }]);

    assetGroupAssetOperations.push({
      asset_group: assetGroupResourceName,
      asset: businessNameAsset.results[0].resource_name,
      field_type: 'BUSINESS_NAME',
    });

    await (client as any).assetGroupAssets.create(assetGroupAssetOperations);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        assetGroup: {
          resourceName: assetGroupResourceName,
          name,
          status,
          finalUrl,
          assetsLinked: assetGroupAssetOperations.length,
        },
        message: 'Asset group created successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error creating asset group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateAssetGroup(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const assetGroupId = event.pathParameters?.id;
  const body: UpdateAssetGroupRequest = JSON.parse(event.body || '{}');
  const { customerId, name, status } = body;

  if (!assetGroupId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'assetGroupId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/assetGroups/${assetGroupId}`;

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

    await (client as any).assetGroups.update([updateOperation]);

    console.log(`[GoogleAdsPMax] Updated asset group: ${resourceName}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Asset group updated successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error updating asset group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// ASSET HANDLERS
// ============================================

async function listAssets(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const assetGroupResourceName = event.queryStringParameters?.assetGroupResourceName;

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
        asset_group_asset.resource_name,
        asset_group_asset.field_type,
        asset_group_asset.status,
        asset.id,
        asset.name,
        asset.type,
        asset.text_asset.text,
        asset.image_asset.full_size.url,
        asset_group.name
      FROM asset_group_asset
    `;

    if (assetGroupResourceName) {
      query += ` WHERE asset_group.resource_name = '${assetGroupResourceName}'`;
    }

    query += ' LIMIT 200';

    const results = await client.query(query);

    const assets = results.map((row: any) => ({
      resourceName: row.asset_group_asset.resource_name,
      fieldType: row.asset_group_asset.field_type,
      status: row.asset_group_asset.status,
      asset: {
        id: row.asset.id?.toString(),
        name: row.asset.name,
        type: row.asset.type,
        text: row.asset.text_asset?.text,
        imageUrl: row.asset.image_asset?.full_size?.url,
      },
      assetGroupName: row.asset_group?.name,
    }));

    // Group by field type
    const grouped: Record<string, any[]> = {};
    assets.forEach((a: any) => {
      if (!grouped[a.fieldType]) grouped[a.fieldType] = [];
      grouped[a.fieldType].push(a);
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        assets,
        grouped,
        total: assets.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error listing assets:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function addAssets(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { customerId, assetGroupResourceName, fieldType, texts } = body;

  if (!customerId || !assetGroupResourceName || !fieldType || !texts?.length) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, assetGroupResourceName, fieldType, and texts are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Create text assets
    const assetOperations = texts.map((text: string) => ({
      create: {
        text_asset: { text },
      },
    }));

    const assetResponse = await (client as any).assets.create(assetOperations);

    // Link assets to asset group
    const linkOperations = assetResponse.results.map((result: any) => ({
      create: {
        asset_group: assetGroupResourceName,
        asset: result.resource_name,
        field_type: fieldType,
      },
    }));

    await (client as any).assetGroupAssets.create(linkOperations);

    console.log(`[GoogleAdsPMax] Added ${texts.length} ${fieldType} assets`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        addedCount: texts.length,
        fieldType,
        message: `Added ${texts.length} ${fieldType} assets`,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error adding assets:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// LISTING GROUP HANDLERS (for Shopping)
// ============================================

async function listListingGroups(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const assetGroupResourceName = event.queryStringParameters?.assetGroupResourceName;

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
        asset_group_listing_group_filter.resource_name,
        asset_group_listing_group_filter.type,
        asset_group_listing_group_filter.case_value.product_brand.value,
        asset_group_listing_group_filter.case_value.product_category.level,
        asset_group_listing_group_filter.case_value.product_category.category_id,
        asset_group.name,
        asset_group.resource_name
      FROM asset_group_listing_group_filter
    `;

    if (assetGroupResourceName) {
      query += ` WHERE asset_group.resource_name = '${assetGroupResourceName}'`;
    }

    query += ' LIMIT 100';

    const results = await client.query(query);

    const listingGroups = results.map((row: any) => ({
      resourceName: row.asset_group_listing_group_filter.resource_name,
      type: row.asset_group_listing_group_filter.type,
      caseValue: {
        productBrand: row.asset_group_listing_group_filter.case_value?.product_brand?.value,
        productCategoryLevel: row.asset_group_listing_group_filter.case_value?.product_category?.level,
        productCategoryId: row.asset_group_listing_group_filter.case_value?.product_category?.category_id,
      },
      assetGroup: {
        name: row.asset_group?.name,
        resourceName: row.asset_group?.resource_name,
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        listingGroups,
        total: listingGroups.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsPMax] Error listing listing groups:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

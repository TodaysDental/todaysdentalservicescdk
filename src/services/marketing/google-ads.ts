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
  CAMPAIGN_TYPE_TO_AD_GROUP_TYPE,
  VALID_CAMPAIGN_TYPES,
  CampaignType,
  sanitizeGaqlValue,
  validateAdText,
  truncateToLimit,
  HEADLINE_MAX_CHARS,
  DESCRIPTION_MAX_CHARS,
  PATH_MAX_CHARS,
  MIN_TARGET_ROAS_PERCENT,
  MAX_TARGET_ROAS_PERCENT,
  PERFORMANCE_THRESHOLDS,
  validateTargetRoas,
  enums,
  createCampaignViaRest,
  createBudgetViaRest,
  removeBudgetViaRest,
  uploadImageAssetViaUrl,
} from '../../shared/utils/google-ads-client';
import {
  getAllowedClinicIds,
  hasClinicAccess,
} from '../../shared/utils/permissions-helper';

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

// Note: HEADLINE_MAX_CHARS, DESCRIPTION_MAX_CHARS, PATH_MAX_CHARS, validateAdText, truncateToLimit
// are now imported from google-ads-client.ts for consistency

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
  type: CampaignType; // 'SEARCH' | 'DISPLAY' | 'VIDEO' | 'DEMAND_GEN'
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
    headlines: string[]; // Search: up to 15 (30 chars), Display: up to 5 (30 chars), DemandGen: up to 5 (40 chars)
    descriptions: string[]; // Search: up to 4 (90 chars), Display/DemandGen: up to 5 (90 chars)
    finalUrl: string;
    path1?: string;
    path2?: string;
    // Display-specific fields
    longHeadline?: string; // Required for Display (90 chars)
    businessName?: string; // Required for Display and Demand Gen
    imageUrl?: string; // Required for Display and Demand Gen - marketing image URL
    logoUrl?: string; // Optional for Demand Gen - logo image URL
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

// Cache staleness threshold (15 minutes)
const CACHE_STALENESS_THRESHOLD_MS = 15 * 60 * 1000;

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
      body: JSON.stringify({ success: false, error: 'customerId is required' }),
    };
  }

  try {
    if (syncFromGoogle) {
      // Fetch fresh data from Google Ads API
      const googleCampaigns = await getCampaigns(customerId);
      const now = new Date().toISOString();
      // FIX: Add TTL for consistency with createCampaign (90 days)
      const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60);

      // FIX: Look up clinicId for consistency with createCampaign
      const clinics = await getAllClinicsWithGoogleAdsStatus();
      const clinic = clinics.find(c => c.customerId === customerId);
      const clinicId = clinic?.clinicId || '';

      if (!clinic) {
        console.warn(`[GoogleAds] No clinic found for customerId ${customerId} during sync - campaigns will have empty clinicId`);
      }

      const campaigns = googleCampaigns.map(gc => ({
        campaignId: `${customerId}-${gc.campaign.id}`,
        clinicId, // FIX: Now includes clinicId for consistency
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
        syncedAt: now,
        ttl, // FIX: Now includes TTL for consistency
      }));

      // Store in DynamoDB for caching
      for (const campaign of campaigns) {
        await ddb.send(new PutCommand({
          TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
          Item: {
            ...campaign,
            updatedAt: now,
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
          lastSyncedAt: now,
          isStale: false,
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

    const campaigns = response.Items || [];

    // Calculate staleness based on most recent syncedAt
    let lastSyncedAt: string | null = null;
    let isStale = true;

    if (campaigns.length > 0) {
      const syncTimes = campaigns
        .map((c: any) => c.syncedAt)
        .filter(Boolean)
        .sort()
        .reverse();

      if (syncTimes.length > 0) {
        lastSyncedAt = syncTimes[0];
        const syncTime = new Date(lastSyncedAt as string).getTime();
        const now = Date.now();
        isStale = (now - syncTime) > CACHE_STALENESS_THRESHOLD_MS;
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        campaigns,
        total: campaigns.length,
        syncedFromGoogle: false,
        lastSyncedAt,
        isStale,
        stalenessThresholdMinutes: CACHE_STALENESS_THRESHOLD_MS / 60000,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error listing campaigns:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
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

  // Validate campaign type
  if (!VALID_CAMPAIGN_TYPES.includes(type as CampaignType)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: `Invalid campaign type: ${type}. Valid types are: ${VALID_CAMPAIGN_TYPES.join(', ')}`,
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

  // Validate targetRoas range (Google Ads API requires >= 0.01 and <= 100)
  if (biddingStrategy === 'TARGET_ROAS' && targetRoas) {
    const roasValidation = validateTargetRoas(targetRoas);
    if (!roasValidation.isValid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: roasValidation.error,
        }),
      };
    }
  }

  // Track created resources for cleanup on failure
  let budgetResourceName: string | undefined;
  let campaignResourceName: string | undefined;
  let client: any;

  try {
    // VALIDATION: Check for duplicate campaign name before creation
    client = await getGoogleAdsClient(customerId);
    // FIX: Use sanitizeGaqlValue() for proper GAQL injection prevention
    const sanitizedName = sanitizeGaqlValue(name);
    const existingCampaignsQuery = `
      SELECT campaign.name
      FROM campaign
      WHERE campaign.name = '${sanitizedName}'
        AND campaign.status != 'REMOVED'
    `;
    const existingCampaigns = await (client as any).query(existingCampaignsQuery);
    if (existingCampaigns && existingCampaigns.length > 0) {
      return {
        statusCode: 409, // Conflict
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: `A campaign with the name "${name}" already exists. Please use a unique name.`,
        }),
      };
    }

    // Create budget first via REST API (bypass gRPC proto limitation)
    const budgetResource = {
      name: `Budget - ${name} - ${Date.now()}`,
      amount_micros: dollarsToMicros(dailyBudget),
      delivery_method: enums.BudgetDeliveryMethod.STANDARD,
      explicitly_shared: false,
    };

    budgetResourceName = await createBudgetViaRest(customerId, budgetResource);

    // Validate conversion tracking for strategies that require it
    // TARGET_CPA, MAXIMIZE_CONVERSIONS, and TARGET_ROAS all require at least one
    // enabled conversion action on the account, otherwise the API returns:
    //   "The operation is not allowed for the given context" (context_error: 2)
    const conversionRequiredStrategies = ['TARGET_CPA', 'MAXIMIZE_CONVERSIONS', 'TARGET_ROAS'];
    if (conversionRequiredStrategies.includes(biddingStrategy)) {
      try {
        const convQuery = `SELECT conversion_action.id FROM conversion_action WHERE conversion_action.status = 'ENABLED' LIMIT 1`;
        const convResults = await (client as any).query(convQuery);
        if (!convResults || convResults.length === 0) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({
              success: false,
              error: `${biddingStrategy} bidding strategy requires conversion tracking to be set up on this Google Ads account. ` +
                `Please create at least one conversion action first, or use MANUAL_CPC or MAXIMIZE_CLICKS instead.`,
            }),
          };
        }
      } catch (convCheckError: any) {
        console.warn(`[GoogleAds] Could not verify conversion tracking for ${customerId}: ${convCheckError.message}`);
        // Proceed anyway — the API will return a descriptive error if tracking is truly missing
      }
    }

    // Map campaign type and status to enum values
    // Map campaign type to Google Ads AdvertisingChannelType enum
    // Note: DEMAND_GEN (14) is not in the library's TypeScript types but exists at runtime
    const channelTypeMap: Record<string, number> = {
      'SEARCH': enums.AdvertisingChannelType.SEARCH,
      'DISPLAY': enums.AdvertisingChannelType.DISPLAY,
      'VIDEO': enums.AdvertisingChannelType.VIDEO,
      'DEMAND_GEN': 14, // enums.AdvertisingChannelType.DEMAND_GEN - not in lib types
    };
    const channelTypeEnum = channelTypeMap[type] || enums.AdvertisingChannelType.SEARCH;

    const statusEnum = status === 'ENABLED'
      ? enums.CampaignStatus.ENABLED
      : enums.CampaignStatus.PAUSED;

    // Build network settings based on campaign type
    const networkSettings = type === 'SEARCH' ? {
      targetGoogleSearch: true,
      targetSearchNetwork: true,
    } : undefined;

    // Create campaign via REST API (bypasses gRPC proto3 serialization issues)
    // This properly sends contains_eu_political_advertising and bidding strategy
    console.log('[GoogleAds] Creating campaign via REST API...');
    console.log('[GoogleAds] Bidding strategy:', biddingStrategy, 'Target CPA:', targetCpa, 'Target ROAS:', targetRoas);

    campaignResourceName = await createCampaignViaRest(customerId, {
      name,
      status: statusEnum,
      advertisingChannelType: channelTypeEnum,
      campaignBudget: budgetResourceName!,
      biddingStrategy,
      targetCpaMicros: targetCpa ? dollarsToMicros(targetCpa) : undefined,
      targetRoas: targetRoas ? targetRoas / 100 : undefined,
      networkSettings,
    });
    const googleCampaignId = campaignResourceName!.split('/').pop()!;

    let adGroupResourceName: string | undefined;
    let adResourceName: string | undefined;
    let adValidationWarnings: string[] = [];
    let adSkipped = false;
    let adSkipReason: string | undefined;

    // Create Ad Group if provided
    if (adGroup) {
      // VALIDATION: CPC bid is now required (removed default $2 CPC)
      if (!adGroup.cpcBidMicros) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'adGroup.cpcBidMicros is required when creating an ad group. Specify the CPC bid in micros (e.g., 2000000 for $2)',
          }),
        };
      }

      // Get proper ad group type based on campaign type
      const adGroupType = CAMPAIGN_TYPE_TO_AD_GROUP_TYPE[type] || 'SEARCH_STANDARD';

      const adGroupResource = {
        name: adGroup.name || `${name} - Ad Group`,
        campaign: campaignResourceName!,
        status: 'ENABLED',
        type: adGroupType,
        cpc_bid_micros: adGroup.cpcBidMicros,
      };
      const adGroupResponse = await (client as any).adGroups.create([adGroupResource]);
      adGroupResourceName = adGroupResponse.results[0].resource_name;
      console.log(`[GoogleAds] Created ad group: ${adGroupResourceName}`);

      // ============================================
      // CAMPAIGN-TYPE-SPECIFIC AD CREATION
      // Each campaign type requires a different ad format per Google Ads API
      // ============================================

      if (ad && type === 'SEARCH') {
        // SEARCH → Responsive Search Ad (RSA)
        if (!ad.headlines || ad.headlines.length < 3) {
          adSkipped = true;
          adSkipReason = 'At least 3 headlines required for RSA';
          console.warn('[GoogleAds] At least 3 headlines required for RSA, skipping ad creation');
        } else if (!ad.descriptions || ad.descriptions.length < 2) {
          adSkipped = true;
          adSkipReason = 'At least 2 descriptions required for RSA';
          console.warn('[GoogleAds] At least 2 descriptions required for RSA, skipping ad creation');
        } else if (!ad.finalUrl) {
          adSkipped = true;
          adSkipReason = 'finalUrl is required for RSA';
          console.warn('[GoogleAds] finalUrl required for RSA, skipping ad creation');
        } else {
          const { validHeadlines, validDescriptions, warnings } = validateAdText(
            ad.headlines,
            ad.descriptions
          );
          adValidationWarnings = warnings;
          if (warnings.length > 0) {
            console.warn(`[GoogleAds] Ad text validation warnings: ${warnings.join('; ')}`);
          }
          const adResource = {
            ad_group: adGroupResourceName,
            status: 'ENABLED',
            ad: {
              responsive_search_ad: {
                headlines: validHeadlines.slice(0, 15).map((text) => ({ text })),
                descriptions: validDescriptions.slice(0, 4).map(text => ({ text })),
                path1: ad.path1,
                path2: ad.path2,
              },
              final_urls: [ad.finalUrl],
            },
          };
          const adResponse = await (client as any).adGroupAds.create([adResource]);
          adResourceName = adResponse.results[0].resource_name;
          console.log(`[GoogleAds] Created responsive search ad: ${adResourceName}`);
        }

      } else if (ad && type === 'DISPLAY') {
        // DISPLAY → Responsive Display Ad (requires images)
        if (!ad.headlines || ad.headlines.length < 1) {
          adSkipped = true;
          adSkipReason = 'At least 1 headline required for Display ad';
        } else if (!ad.descriptions || ad.descriptions.length < 1) {
          adSkipped = true;
          adSkipReason = 'At least 1 description required for Display ad';
        } else if (!ad.longHeadline) {
          adSkipped = true;
          adSkipReason = 'longHeadline is required for Display ad (90 chars max)';
        } else if (!ad.businessName) {
          adSkipped = true;
          adSkipReason = 'businessName is required for Display ad';
        } else if (!ad.imageUrl) {
          adSkipped = true;
          adSkipReason = 'imageUrl is required for Display ad (marketing image)';
        } else if (!ad.finalUrl) {
          adSkipped = true;
          adSkipReason = 'finalUrl is required for Display ad';
        } else {
          try {
            // Upload marketing image as asset
            const imageAssetName = `${name} - Marketing Image - ${Date.now()}`;
            const imageAssetResourceName = await uploadImageAssetViaUrl(client, ad.imageUrl, imageAssetName);
            console.log(`[GoogleAds] Uploaded marketing image asset: ${imageAssetResourceName}`);

            // Upload logo as asset if provided
            let logoAssetResourceName: string | undefined;
            if (ad.logoUrl) {
              const logoAssetName = `${name} - Logo - ${Date.now()}`;
              logoAssetResourceName = await uploadImageAssetViaUrl(client, ad.logoUrl, logoAssetName);
              console.log(`[GoogleAds] Uploaded logo asset: ${logoAssetResourceName}`);
            }

            // Build Responsive Display Ad
            const displayAdData: any = {
              headlines: ad.headlines.slice(0, 5).map(text => ({ text: text.slice(0, 30) })),
              long_headline: { text: ad.longHeadline.slice(0, 90) },
              descriptions: ad.descriptions.slice(0, 5).map(text => ({ text: text.slice(0, 90) })),
              business_name: ad.businessName,
              marketing_images: [{ asset: imageAssetResourceName }],
            };

            if (logoAssetResourceName) {
              displayAdData.logo_images = [{ asset: logoAssetResourceName }];
            }

            const adResource = {
              ad_group: adGroupResourceName,
              status: 'ENABLED',
              ad: {
                responsive_display_ad: displayAdData,
                final_urls: [ad.finalUrl],
              },
            };

            const adResponse = await (client as any).adGroupAds.create([adResource]);
            adResourceName = adResponse.results[0].resource_name;
            console.log(`[GoogleAds] Created responsive display ad: ${adResourceName}`);
          } catch (displayError: any) {
            console.error('[GoogleAds] Display ad creation failed:', displayError.message || displayError);
            adSkipped = true;
            adSkipReason = `Display ad creation failed: ${displayError.message || 'Unknown error'}`;
          }
        }

      } else if (ad && type === 'DEMAND_GEN') {
        // DEMAND_GEN → Demand Gen Multi-Asset Ad (requires images + logo)
        if (!ad.headlines || ad.headlines.length < 1) {
          adSkipped = true;
          adSkipReason = 'At least 1 headline required for Demand Gen ad';
        } else if (!ad.descriptions || ad.descriptions.length < 1) {
          adSkipped = true;
          adSkipReason = 'At least 1 description required for Demand Gen ad';
        } else if (!ad.businessName) {
          adSkipped = true;
          adSkipReason = 'businessName is required for Demand Gen ad';
        } else if (!ad.imageUrl) {
          adSkipped = true;
          adSkipReason = 'imageUrl is required for Demand Gen ad (marketing image)';
        } else if (!ad.finalUrl) {
          adSkipped = true;
          adSkipReason = 'finalUrl is required for Demand Gen ad';
        } else {
          try {
            // Upload marketing image
            const imageAssetName = `${name} - Marketing Image - ${Date.now()}`;
            const imageAssetResourceName = await uploadImageAssetViaUrl(client, ad.imageUrl, imageAssetName);
            console.log(`[GoogleAds] Uploaded marketing image for DemandGen: ${imageAssetResourceName}`);

            // Upload logo (use imageUrl if logoUrl not provided)
            const logoUrl = ad.logoUrl || ad.imageUrl;
            const logoAssetName = `${name} - Logo - ${Date.now()}`;
            const logoAssetResourceName = await uploadImageAssetViaUrl(client, logoUrl, logoAssetName);
            console.log(`[GoogleAds] Uploaded logo for DemandGen: ${logoAssetResourceName}`);

            const adResource = {
              ad_group: adGroupResourceName,
              status: 'ENABLED',
              ad: {
                demand_gen_multi_asset_ad: {
                  headline_text_list: ad.headlines.slice(0, 5).map(text => text.slice(0, 40)),
                  description_text_list: ad.descriptions.slice(0, 5).map(text => text.slice(0, 90)),
                  marketing_images: [{ asset: imageAssetResourceName }],
                  logo_images: [{ asset: logoAssetResourceName }],
                  business_name: ad.businessName,
                },
                final_urls: [ad.finalUrl],
              },
            };

            const adResponse = await (client as any).adGroupAds.create([adResource]);
            adResourceName = adResponse.results[0].resource_name;
            console.log(`[GoogleAds] Created demand gen multi-asset ad: ${adResourceName}`);
          } catch (demandGenError: any) {
            console.error('[GoogleAds] Demand Gen ad creation failed:', demandGenError.message || demandGenError);
            adSkipped = true;
            adSkipReason = `Demand Gen ad creation failed: ${demandGenError.message || 'Unknown error'}`;
          }
        }

      } else if (ad && type === 'VIDEO') {
        // VIDEO → Requires YouTube video URL, cannot auto-create
        console.info('[GoogleAds] Skipping ad for VIDEO campaign: requires YouTube video URL');
        adSkipped = true;
        adSkipReason = 'VIDEO campaigns require a YouTube video URL. Create video ads manually in Google Ads UI.';
      }
    }

    // VALIDATION: Look up clinicId from customerId - fail if clinic not found
    const clinics = await getAllClinicsWithGoogleAdsStatus();
    const clinic = clinics.find(c => c.customerId === customerId);
    if (!clinic) {
      // Previously this would silently proceed with empty clinicId, creating orphaned records
      // Now we fail explicitly to prevent data integrity issues
      console.error(`[GoogleAds] No clinic found for customerId: ${customerId}`);

      // Cleanup the campaign we just created since we can't associate it with a clinic
      if (campaignResourceName && client) {
        try {
          const removeOperation = {
            update: { resource_name: campaignResourceName, status: 'REMOVED' },
            update_mask: { paths: ['status'] },
          };
          await (client as any).campaigns.update([removeOperation]);
          console.log(`[GoogleAds] Cleaned up campaign due to missing clinic: ${campaignResourceName}`);
        } catch (cleanupError: any) {
          // ORPHAN TRACKING: Log cleanup failure for manual remediation
          console.error(`[GoogleAds] ORPHAN_RESOURCE: Failed to cleanup campaign ${campaignResourceName}: ${cleanupError.message}`);
        }
      }

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: `No clinic configuration found for Google Ads customer ID: ${customerId}. Please configure the clinic's Google Ads mapping first.`,
        }),
      };
    }
    const clinicId = clinic.clinicId;

    // PERMISSION CROSS-VALIDATION: Verify user has access to this clinic
    const userPerms = getUserPermissions(event);
    if (userPerms) {
      const allowedClinics = getAllowedClinicIds(
        userPerms.clinicRoles,
        userPerms.isSuperAdmin,
        userPerms.isGlobalSuperAdmin
      );
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        console.warn(`[GoogleAds] User ${userPerms.email} attempted to create campaign for unauthorized clinic: ${clinicId}`);

        // Cleanup the campaign since user doesn't have permission
        if (campaignResourceName && client) {
          try {
            const removeOperation = {
              update: { resource_name: campaignResourceName, status: 'REMOVED' },
              update_mask: { paths: ['status'] },
            };
            await (client as any).campaigns.update([removeOperation]);
            console.log(`[GoogleAds] Cleaned up campaign due to permission denial: ${campaignResourceName}`);
          } catch (cleanupError: any) {
            console.error(`[GoogleAds] ORPHAN_RESOURCE: Failed to cleanup campaign ${campaignResourceName}: ${cleanupError.message}`);
          }
        }

        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: `Access denied: You do not have permission to create campaigns for clinic ${clinic.clinicName}`,
          }),
        };
      }
    }

    // Store in DynamoDB with TTL (90 days for cached data)
    const campaignId = `${customerId}-${googleCampaignId}`;
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days from now

    const campaign: Campaign & { clinicId?: string; biddingStrategy?: string; ttl?: number; adGroupResourceName?: string } = {
      campaignId,
      clinicId, // Now storing clinicId for easier querying
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

    // Build accurate success message
    const createdComponents: string[] = ['Campaign'];
    if (adGroupResourceName) createdComponents.push('ad group');
    if (adResourceName) createdComponents.push('ad');

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        campaign,
        adGroupCreated: !!adGroupResourceName,
        adCreated: !!adResourceName,
        adSkipped: adSkipped || undefined,
        adSkipReason: adSkipReason || undefined,
        warnings: adValidationWarnings.length > 0 ? adValidationWarnings : undefined,
        message: `${createdComponents.join(', ')} created successfully`,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error creating campaign:', error);
    // Extract detailed error info from Google Ads API errors
    if (error.errors) {
      error.errors.forEach((e: any, i: number) => {
        console.error(`[GoogleAds] Error detail [${i}]:`, JSON.stringify({
          message: e.message,
          error_code: e.error_code,
          location: e.location,
          fieldPathElements: e.location?.field_path_elements || e.location?.fieldPathElements,
          trigger: e.trigger,
        }, null, 2));
      });
    }

    // CLEANUP: Remove orphaned budget if campaign creation failed
    if (budgetResourceName && !campaignResourceName) {
      console.warn(`[GoogleAds] Cleaning up orphaned budget ${budgetResourceName} due to campaign creation failure`);
      await removeBudgetViaRest(customerId, budgetResourceName);
    }

    // CLEANUP: Mark orphaned campaign as REMOVED if ad group/ad creation failed
    if (campaignResourceName && client) {
      console.warn(`[GoogleAds] Cleaning up orphaned campaign ${campaignResourceName} due to subsequent failure`);
      try {
        const removeOperation = {
          update: {
            resource_name: campaignResourceName,
            status: 'REMOVED',
          },
          update_mask: { paths: ['status'] },
        };
        await (client as any).campaigns.update([removeOperation]);
        console.log(`[GoogleAds] Successfully cleaned up orphaned campaign: ${campaignResourceName}`);
      } catch (cleanupError: any) {
        // ORPHAN TRACKING: Log for manual remediation via CloudWatch alerts/metrics
        console.error(`[GoogleAds] ORPHAN_RESOURCE: Campaign cleanup failed - ${campaignResourceName} may need manual removal. Error: ${cleanupError.message}`);
      }
    }

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
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
      body: JSON.stringify({ success: false, error: 'Campaign ID is required' }),
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
        body: JSON.stringify({ success: false, error: 'Campaign not found' }),
      };
    }

    const campaign = existing.Item as Campaign & { budgetResourceName?: string };
    const client = await getGoogleAdsClient(campaign.customerId);
    const updatesMade: string[] = [];

    // Update campaign properties in Google Ads
    const campaignUpdateOperation: any = {
      update: {
        resource_name: `customers/${campaign.customerId}/campaigns/${campaign.googleCampaignId}`,
      },
      update_mask: { paths: [] },
    };

    if (body.status) {
      campaignUpdateOperation.update.status = body.status;
      campaignUpdateOperation.update_mask.paths.push('status');
      updatesMade.push(`status: ${body.status}`);
    }

    if (body.name) {
      campaignUpdateOperation.update.name = body.name;
      campaignUpdateOperation.update_mask.paths.push('name');
      updatesMade.push(`name: ${body.name}`);
    }

    if (campaignUpdateOperation.update_mask.paths.length > 0) {
      await (client as any).campaigns.update([campaignUpdateOperation]);
    }

    // UPDATE BUDGET IN GOOGLE ADS (FIX: This was previously missing!)
    let newBudget = campaign.budget;
    if (body.dailyBudget && body.dailyBudget !== campaign.budget) {
      // First, get the campaign's budget resource name from Google Ads
      const campaignQuery = `
        SELECT campaign.campaign_budget
        FROM campaign
        WHERE campaign.resource_name = 'customers/${campaign.customerId}/campaigns/${campaign.googleCampaignId}'
      `;
      const campaignData = await (client as any).query(campaignQuery);

      if (campaignData && campaignData.length > 0 && campaignData[0].campaign?.campaign_budget) {
        const budgetResourceName = campaignData[0].campaign.campaign_budget;

        // Update the budget
        const budgetUpdateOperation = {
          update: {
            resource_name: budgetResourceName,
            amount_micros: dollarsToMicros(body.dailyBudget),
          },
          update_mask: { paths: ['amount_micros'] },
        };

        await (client as any).campaignBudgets.update([budgetUpdateOperation]);
        newBudget = body.dailyBudget;
        updatesMade.push(`dailyBudget: $${body.dailyBudget}`);
        console.log(`[GoogleAds] Updated budget for campaign ${campaignId} to $${body.dailyBudget}`);
      } else {
        console.warn(`[GoogleAds] Could not find budget resource for campaign ${campaignId}`);
      }
    }

    // Update in DynamoDB
    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Key: { campaignId },
      UpdateExpression: 'SET #status = :status, #name = :name, budget = :budget, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#name': 'name',
      },
      ExpressionAttributeValues: {
        ':status': body.status || campaign.status,
        ':name': body.name || campaign.name,
        ':budget': newBudget,
        ':updatedAt': now,
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: updatesMade.length > 0
          ? `Campaign updated: ${updatesMade.join(', ')}`
          : 'No changes made',
        updatedFields: updatesMade,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAds] Error updating campaign:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
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
      body: JSON.stringify({ success: false, error: 'Campaign ID is required' }),
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
        body: JSON.stringify({ success: false, error: 'Campaign not found' }),
      };
    }

    const campaign = existing.Item as Campaign;
    const originalStatus = campaign.status;

    // Step 1: Soft delete in DynamoDB first (mark as REMOVED)
    // This prevents orphaned records if Google Ads update fails
    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
      TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
      Key: { campaignId },
      UpdateExpression: 'SET #status = :status, deletedAt = :deletedAt, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'REMOVED',
        ':deletedAt': now,
        ':updatedAt': now,
      },
    }));

    try {
      // Step 2: Remove (set status to REMOVED) in Google Ads
      const client = await getGoogleAdsClient(campaign.customerId);
      const removeOperation = {
        update: {
          resource_name: `customers/${campaign.customerId}/campaigns/${campaign.googleCampaignId}`,
          status: 'REMOVED',
        },
        update_mask: { paths: ['status'] },
      };

      await (client as any).campaigns.update([removeOperation]);

      // Step 3: Now fully delete from DynamoDB since Google Ads succeeded
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
    } catch (googleAdsError: any) {
      // COMPENSATION: Google Ads failed, revert DynamoDB soft delete
      console.error('[GoogleAds] Google Ads update failed, reverting DynamoDB:', googleAdsError.message);

      await ddb.send(new UpdateCommand({
        TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
        Key: { campaignId },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt REMOVE deletedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': originalStatus,
          ':updatedAt': new Date().toISOString(),
        },
      }));

      throw googleAdsError; // Re-throw to be caught by outer handler
    }
  } catch (error: any) {
    console.error('[GoogleAds] Error deleting campaign:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
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

  // FIX: Require cpcBidMicros explicitly (no default) for consistency with createCampaign
  // This prevents unexpected billing charges from silent $2 defaults
  if (!cpcBidMicros) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'cpcBidMicros is required. Specify the CPC bid in micros (e.g., 2000000 for $2)',
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
        cpc_bid_micros: cpcBidMicros, // FIX: No longer has default fallback
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
          cpcBidMicros,
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

    // Check for low-performing campaigns using configurable thresholds
    campaigns.forEach(campaign => {
      if (campaign.status === 'ENABLED') {
        // Low CTR warning (configurable threshold)
        if (campaign.impressions > PERFORMANCE_THRESHOLDS.minImpressionsForCtrAlert &&
          campaign.ctr < PERFORMANCE_THRESHOLDS.lowCtrPercent) {
          alerts.push({
            type: 'warning',
            message: `"${campaign.name}" has low CTR (${campaign.ctr.toFixed(2)}%). Consider improving ad copy.`,
            campaignId: campaign.campaignId,
          });
        }
        // High cost per conversion warning (configurable threshold)
        if (campaign.conversions > 0 && campaign.costPerConversion > PERFORMANCE_THRESHOLDS.highCpaDollars) {
          alerts.push({
            type: 'warning',
            message: `"${campaign.name}" has high CPA ($${campaign.costPerConversion.toFixed(2)}). Review targeting.`,
            campaignId: campaign.campaignId,
          });
        }
        // No conversions warning (configurable threshold)
        if (campaign.clicks > PERFORMANCE_THRESHOLDS.minClicksForConversionAlert && campaign.conversions === 0) {
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

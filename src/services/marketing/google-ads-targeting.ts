/**
 * Google Ads Targeting Lambda
 * 
 * Handles advanced targeting features:
 * - Location targeting (radius, city, region, country)
 * - Audience targeting (custom audiences, remarketing)
 * - Demographic targeting (age, gender, income)
 * - Device bid adjustments
 * - Ad scheduling (day parting)
 * 
 * Endpoints:
 * - GET /google-ads/targeting/locations - Get location targeting
 * - POST /google-ads/targeting/locations - Add location targeting
 * - DELETE /google-ads/targeting/locations/{id} - Remove location targeting
 * - GET /google-ads/targeting/audiences - Get audience targeting
 * - POST /google-ads/targeting/audiences - Add audience targeting
 * - GET /google-ads/targeting/demographics - Get demographic targeting
 * - POST /google-ads/targeting/demographics - Update demographic targeting
 * - GET /google-ads/targeting/devices - Get device bid adjustments
 * - POST /google-ads/targeting/devices - Update device bid adjustments
 * - GET /google-ads/targeting/schedule - Get ad schedule
 * - POST /google-ads/targeting/schedule - Update ad schedule
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

interface LocationTargetRequest {
  customerId: string;
  campaignResourceName: string;
  locations: Array<{
    geoTargetConstant?: string; // e.g., 'geoTargetConstants/1014044' for NYC
    locationName?: string;
    radiusMiles?: number;
    latitude?: number;
    longitude?: number;
  }>;
  negative?: boolean;
}

interface DeviceBidRequest {
  customerId: string;
  campaignResourceName: string;
  devices: Array<{
    deviceType: 'MOBILE' | 'DESKTOP' | 'TABLET';
    bidModifier: number; // -100 to +900 (-1.0 to 10.0)
  }>;
}

interface AdScheduleRequest {
  customerId: string;
  campaignResourceName: string;
  schedules: Array<{
    dayOfWeek: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
    startHour: number;
    startMinute: 0 | 15 | 30 | 45;
    endHour: number;
    endMinute: 0 | 15 | 30 | 45;
    bidModifier?: number;
  }>;
}

interface DemographicTargetRequest {
  customerId: string;
  campaignResourceName?: string;
  adGroupResourceName?: string;
  ageRanges?: Array<{
    range: 'AGE_RANGE_18_24' | 'AGE_RANGE_25_34' | 'AGE_RANGE_35_44' | 'AGE_RANGE_45_54' | 'AGE_RANGE_55_64' | 'AGE_RANGE_65_UP' | 'AGE_RANGE_UNDETERMINED';
    bidModifier?: number;
  }>;
  genders?: Array<{
    gender: 'MALE' | 'FEMALE' | 'UNDETERMINED';
    bidModifier?: number;
  }>;
  householdIncomes?: Array<{
    range: 'INCOME_RANGE_0_50' | 'INCOME_RANGE_50_60' | 'INCOME_RANGE_60_70' | 'INCOME_RANGE_70_80' | 'INCOME_RANGE_80_90' | 'INCOME_RANGE_90_100' | 'INCOME_RANGE_UNDETERMINED';
    bidModifier?: number;
  }>;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;
  const pathParts = path.split('/').filter(Boolean);

  console.log(`[GoogleAdsTargeting] ${method} ${path}`);

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
    // --- Location Targeting Routes ---
    if (path.includes('/targeting/locations')) {
      if (method === 'GET') return await getLocationTargeting(event, corsHeaders);
      if (method === 'POST') return await addLocationTargeting(event, corsHeaders);
      if (method === 'DELETE') return await removeLocationTargeting(event, corsHeaders);
    }

    // --- Audience Targeting Routes ---
    if (path.includes('/targeting/audiences')) {
      if (method === 'GET') return await getAudienceTargeting(event, corsHeaders);
      if (method === 'POST') return await addAudienceTargeting(event, corsHeaders);
    }

    // --- Demographic Targeting Routes ---
    if (path.includes('/targeting/demographics')) {
      if (method === 'GET') return await getDemographicTargeting(event, corsHeaders);
      if (method === 'POST') return await updateDemographicTargeting(event, corsHeaders);
    }

    // --- Device Targeting Routes ---
    if (path.includes('/targeting/devices')) {
      if (method === 'GET') return await getDeviceBidAdjustments(event, corsHeaders);
      if (method === 'POST') return await updateDeviceBidAdjustments(event, corsHeaders);
    }

    // --- Ad Schedule Routes ---
    if (path.includes('/targeting/schedule')) {
      if (method === 'GET') return await getAdSchedule(event, corsHeaders);
      if (method === 'POST') return await updateAdSchedule(event, corsHeaders);
    }

    // --- Geo Target Constant Search ---
    if (path.includes('/targeting/geo-search') && method === 'GET') {
      return await searchGeoTargetConstants(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error:', error);
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
// LOCATION TARGETING HANDLERS
// ============================================

async function getLocationTargeting(
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
        campaign_criterion.resource_name,
        campaign_criterion.criterion_id,
        campaign_criterion.location.geo_target_constant,
        campaign_criterion.negative,
        campaign_criterion.bid_modifier,
        campaign.name,
        campaign.resource_name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'LOCATION'
    `;

    if (campaignResourceName) {
      query += ` AND campaign.resource_name = '${campaignResourceName}'`;
    }

    const results = await client.query(query);

    const locations = results.map((row: any) => ({
      resourceName: row.campaign_criterion.resource_name,
      criterionId: row.campaign_criterion.criterion_id?.toString(),
      geoTargetConstant: row.campaign_criterion.location?.geo_target_constant,
      negative: row.campaign_criterion.negative || false,
      bidModifier: row.campaign_criterion.bid_modifier,
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
        locations,
        total: locations.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error getting locations:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function addLocationTargeting(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: LocationTargetRequest = JSON.parse(event.body || '{}');
  const { customerId, campaignResourceName, locations, negative = false } = body;

  if (!customerId || !campaignResourceName || !locations?.length) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, campaignResourceName, and locations are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const operations = locations.map(loc => ({
      create: {
        campaign: campaignResourceName,
        location: {
          geo_target_constant: loc.geoTargetConstant,
        },
        negative: negative,
      },
    }));

    const response = await (client as any).campaignCriteria.create(operations);

    console.log(`[GoogleAdsTargeting] Added ${locations.length} location targets`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        addedCount: response.results?.length || locations.length,
        message: `Added ${locations.length} location targets`,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error adding locations:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function removeLocationTargeting(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const criterionId = event.pathParameters?.id;
  const customerId = event.queryStringParameters?.customerId;
  const campaignId = event.queryStringParameters?.campaignId;

  if (!criterionId || !customerId || !campaignId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'criterionId, customerId, and campaignId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/campaignCriteria/${campaignId}~${criterionId}`;

    const removeOperation = {
      remove: resourceName,
    };

    await (client as any).campaignCriteria.remove([removeOperation]);

    console.log(`[GoogleAdsTargeting] Removed location target: ${resourceName}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Location target removed',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error removing location:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// AUDIENCE TARGETING HANDLERS
// ============================================

async function getAudienceTargeting(
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

    // Get user lists (remarketing audiences)
    const userListQuery = `
      SELECT
        user_list.id,
        user_list.name,
        user_list.description,
        user_list.membership_status,
        user_list.size_for_display,
        user_list.size_for_search,
        user_list.type
      FROM user_list
      LIMIT 50
    `;

    const userLists = await client.query(userListQuery);

    const audiences = userLists.map((row: any) => ({
      id: row.user_list.id?.toString(),
      name: row.user_list.name,
      description: row.user_list.description,
      membershipStatus: row.user_list.membership_status,
      sizeForDisplay: row.user_list.size_for_display,
      sizeForSearch: row.user_list.size_for_search,
      type: row.user_list.type,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        audiences,
        total: audiences.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error getting audiences:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function addAudienceTargeting(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { customerId, adGroupResourceName, userListId, bidModifier } = body;

  if (!customerId || !adGroupResourceName || !userListId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, adGroupResourceName, and userListId are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const operation = {
      create: {
        ad_group: adGroupResourceName,
        user_list: {
          user_list: `customers/${customerId}/userLists/${userListId}`,
        },
        bid_modifier: bidModifier || 1.0,
      },
    };

    const response = await (client as any).adGroupCriteria.create([operation]);

    console.log(`[GoogleAdsTargeting] Added audience targeting`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Audience targeting added',
        resourceName: response.results?.[0]?.resource_name,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error adding audience:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// DEMOGRAPHIC TARGETING HANDLERS
// ============================================

async function getDemographicTargeting(
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

    // Get age range targeting
    let ageQuery = `
      SELECT
        ad_group_criterion.resource_name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.age_range.type,
        ad_group_criterion.bid_modifier,
        ad_group_criterion.negative
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'AGE_RANGE'
    `;

    if (adGroupResourceName) {
      ageQuery += ` AND ad_group.resource_name = '${adGroupResourceName}'`;
    }

    ageQuery += ' LIMIT 50';

    const ageResults = await client.query(ageQuery);

    // Get gender targeting
    let genderQuery = `
      SELECT
        ad_group_criterion.resource_name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.gender.type,
        ad_group_criterion.bid_modifier,
        ad_group_criterion.negative
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'GENDER'
    `;

    if (adGroupResourceName) {
      genderQuery += ` AND ad_group.resource_name = '${adGroupResourceName}'`;
    }

    genderQuery += ' LIMIT 20';

    const genderResults = await client.query(genderQuery);

    const demographics = {
      ageRanges: ageResults.map((row: any) => ({
        resourceName: row.ad_group_criterion.resource_name,
        criterionId: row.ad_group_criterion.criterion_id?.toString(),
        type: row.ad_group_criterion.age_range?.type,
        bidModifier: row.ad_group_criterion.bid_modifier,
        negative: row.ad_group_criterion.negative || false,
      })),
      genders: genderResults.map((row: any) => ({
        resourceName: row.ad_group_criterion.resource_name,
        criterionId: row.ad_group_criterion.criterion_id?.toString(),
        type: row.ad_group_criterion.gender?.type,
        bidModifier: row.ad_group_criterion.bid_modifier,
        negative: row.ad_group_criterion.negative || false,
      })),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        demographics,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error getting demographics:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateDemographicTargeting(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: DemographicTargetRequest = JSON.parse(event.body || '{}');
  const { customerId, adGroupResourceName, ageRanges, genders } = body;

  if (!customerId || !adGroupResourceName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId and adGroupResourceName are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const operations: any[] = [];

    // Add age range criteria
    if (ageRanges?.length) {
      ageRanges.forEach(ar => {
        operations.push({
          create: {
            ad_group: adGroupResourceName,
            age_range: {
              type: ar.range,
            },
            bid_modifier: ar.bidModifier || 1.0,
          },
        });
      });
    }

    // Add gender criteria
    if (genders?.length) {
      genders.forEach(g => {
        operations.push({
          create: {
            ad_group: adGroupResourceName,
            gender: {
              type: g.gender,
            },
            bid_modifier: g.bidModifier || 1.0,
          },
        });
      });
    }

    if (operations.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No demographic criteria to update' }),
      };
    }

    const response = await (client as any).adGroupCriteria.create(operations);

    console.log(`[GoogleAdsTargeting] Updated ${operations.length} demographic targets`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        updatedCount: response.results?.length || operations.length,
        message: 'Demographic targeting updated',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error updating demographics:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// DEVICE BID ADJUSTMENT HANDLERS
// ============================================

async function getDeviceBidAdjustments(
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
        campaign_criterion.resource_name,
        campaign_criterion.criterion_id,
        campaign_criterion.device.type,
        campaign_criterion.bid_modifier,
        campaign.name,
        campaign.resource_name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'DEVICE'
    `;

    if (campaignResourceName) {
      query += ` AND campaign.resource_name = '${campaignResourceName}'`;
    }

    const results = await client.query(query);

    const devices = results.map((row: any) => ({
      resourceName: row.campaign_criterion.resource_name,
      criterionId: row.campaign_criterion.criterion_id?.toString(),
      deviceType: row.campaign_criterion.device?.type,
      bidModifier: row.campaign_criterion.bid_modifier,
      bidModifierPercent: row.campaign_criterion.bid_modifier 
        ? Math.round((row.campaign_criterion.bid_modifier - 1) * 100) 
        : 0,
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
        devices,
        total: devices.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error getting device bids:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateDeviceBidAdjustments(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: DeviceBidRequest = JSON.parse(event.body || '{}');
  const { customerId, campaignResourceName, devices } = body;

  if (!customerId || !campaignResourceName || !devices?.length) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, campaignResourceName, and devices are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const operations = devices.map(d => ({
      create: {
        campaign: campaignResourceName,
        device: {
          type: d.deviceType,
        },
        bid_modifier: 1 + (d.bidModifier / 100), // Convert percent to modifier
      },
    }));

    const response = await (client as any).campaignCriteria.create(operations);

    console.log(`[GoogleAdsTargeting] Updated ${devices.length} device bid adjustments`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        updatedCount: response.results?.length || devices.length,
        message: 'Device bid adjustments updated',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error updating device bids:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// AD SCHEDULE HANDLERS
// ============================================

async function getAdSchedule(
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
        campaign_criterion.resource_name,
        campaign_criterion.criterion_id,
        campaign_criterion.ad_schedule.day_of_week,
        campaign_criterion.ad_schedule.start_hour,
        campaign_criterion.ad_schedule.start_minute,
        campaign_criterion.ad_schedule.end_hour,
        campaign_criterion.ad_schedule.end_minute,
        campaign_criterion.bid_modifier,
        campaign.name,
        campaign.resource_name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'AD_SCHEDULE'
    `;

    if (campaignResourceName) {
      query += ` AND campaign.resource_name = '${campaignResourceName}'`;
    }

    const results = await client.query(query);

    const schedules = results.map((row: any) => ({
      resourceName: row.campaign_criterion.resource_name,
      criterionId: row.campaign_criterion.criterion_id?.toString(),
      dayOfWeek: row.campaign_criterion.ad_schedule?.day_of_week,
      startHour: row.campaign_criterion.ad_schedule?.start_hour,
      startMinute: row.campaign_criterion.ad_schedule?.start_minute,
      endHour: row.campaign_criterion.ad_schedule?.end_hour,
      endMinute: row.campaign_criterion.ad_schedule?.end_minute,
      bidModifier: row.campaign_criterion.bid_modifier,
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
        schedules,
        total: schedules.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error getting ad schedule:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateAdSchedule(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: AdScheduleRequest = JSON.parse(event.body || '{}');
  const { customerId, campaignResourceName, schedules } = body;

  if (!customerId || !campaignResourceName || !schedules?.length) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, campaignResourceName, and schedules are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const operations = schedules.map(s => ({
      create: {
        campaign: campaignResourceName,
        ad_schedule: {
          day_of_week: s.dayOfWeek,
          start_hour: s.startHour,
          start_minute: s.startMinute === 0 ? 'ZERO' : s.startMinute === 15 ? 'FIFTEEN' : s.startMinute === 30 ? 'THIRTY' : 'FORTY_FIVE',
          end_hour: s.endHour,
          end_minute: s.endMinute === 0 ? 'ZERO' : s.endMinute === 15 ? 'FIFTEEN' : s.endMinute === 30 ? 'THIRTY' : 'FORTY_FIVE',
        },
        bid_modifier: s.bidModifier || 1.0,
      },
    }));

    const response = await (client as any).campaignCriteria.create(operations);

    console.log(`[GoogleAdsTargeting] Added ${schedules.length} ad schedule entries`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        addedCount: response.results?.length || schedules.length,
        message: 'Ad schedule updated',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error updating ad schedule:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// GEO TARGET CONSTANT SEARCH
// ============================================

async function searchGeoTargetConstants(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const searchQuery = event.queryStringParameters?.q;
  const countryCode = event.queryStringParameters?.countryCode || 'US';

  if (!customerId || !searchQuery) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId and q (search query) are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Search for geo target constants matching the query
    const query = `
      SELECT
        geo_target_constant.resource_name,
        geo_target_constant.id,
        geo_target_constant.name,
        geo_target_constant.country_code,
        geo_target_constant.target_type,
        geo_target_constant.canonical_name
      FROM geo_target_constant
      WHERE geo_target_constant.country_code = '${countryCode}'
        AND geo_target_constant.name LIKE '%${searchQuery}%'
      LIMIT 20
    `;

    const results = await client.query(query);

    const locations = results.map((row: any) => ({
      resourceName: row.geo_target_constant.resource_name,
      id: row.geo_target_constant.id?.toString(),
      name: row.geo_target_constant.name,
      countryCode: row.geo_target_constant.country_code,
      targetType: row.geo_target_constant.target_type,
      canonicalName: row.geo_target_constant.canonical_name,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        locations,
        total: locations.length,
        query: searchQuery,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsTargeting] Error searching geo targets:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

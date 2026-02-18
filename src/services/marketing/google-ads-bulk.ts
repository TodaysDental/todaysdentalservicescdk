/**
 * Google Ads Bulk Operations Lambda
 * 
 * Handles bulk operations across multiple customer accounts.
 * Uses global MCC credentials - customerIds are passed as parameters.
 * 
 * Endpoints:
 * - GET /google-ads/bulk/clinics - Get all clinics for selection
 * - POST /google-ads/bulk/publish - Bulk publish campaigns to selected accounts
 * - POST /google-ads/bulk/keywords - Bulk add keywords to selected accounts
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';
import {
  getAllClinicsWithGoogleAdsStatus,
  getGoogleAdsClient,
  dollarsToMicros,
  addKeywords as addKeywordsToGoogle,
  CAMPAIGN_TYPE_TO_AD_GROUP_TYPE,
  validateAdText,
  truncateToLimit,
  HEADLINE_MAX_CHARS,
  DESCRIPTION_MAX_CHARS,
  PATH_MAX_CHARS,
  MIN_TARGET_ROAS_PERCENT,
  MAX_TARGET_ROAS_PERCENT,
  validateTargetRoas,
  sanitizeAdTextValue,
  enums,
} from '../../shared/utils/google-ads-client';
import {
  getAllowedClinicIds,
  hasClinicAccess,
} from '../../shared/utils/permissions-helper';

// Module permission configuration
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
// RATE LIMITING CONSTANTS (matching Ayrshare pattern)
// ============================================
const BATCH_SIZE = 3; // Max accounts to process in parallel
const DELAY_BETWEEN_BATCHES_MS = 2000; // 2 second delay between batches
const MAX_RETRIES = 2; // Retry failed operations up to 2 times
const RETRY_DELAY_MS = 1000; // 1 second before retry

// Lambda timeout protection (4.5 minutes to leave buffer before 5-minute timeout)
const LAMBDA_TIMEOUT_BUFFER_MS = 4.5 * 60 * 1000;

// NOTE: startTime is now passed as parameter to isApproachingTimeout() to fix warm Lambda issue
// Previously, module-level startTime would persist across warm invocations

// Note: HEADLINE_MAX_CHARS, DESCRIPTION_MAX_CHARS, PATH_MAX_CHARS, validateAdText, truncateToLimit
// are now imported from google-ads-client.ts for consistency

/**
 * Helper to delay execution
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract a meaningful error message from Google Ads API / gRPC errors.
 * gRPC errors don't always have .message — they may use .errors[], .details, or toString().
 */
function extractErrorMessage(error: any): string {
  // Standard Error.message
  if (error.message && typeof error.message === 'string' && error.message !== 'undefined') {
    return error.message;
  }

  // Google Ads API error shape: { errors: [{ message, error_code, ... }] }
  if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.map((e: any) => e.message || JSON.stringify(e.error_code) || 'Unknown API error').join('; ');
  }

  // gRPC .details field
  if (error.details && typeof error.details === 'string') {
    return error.details;
  }

  // gRPC status code
  if (error.code !== undefined && error.code !== null) {
    return `gRPC error code ${error.code}: ${error.details || error.metadata?.toString() || 'Unknown gRPC error'}`;
  }

  // Fallback: stringify the entire error
  try {
    const str = String(error);
    if (str && str !== '[object Object]') return str;
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return 'Unknown error (could not extract message)';
  }
}

/**
 * Deep-extract Google Ads API error details from protobuf objects.
 * Protobuf objects don't serialize with JSON.stringify (shows {}), so we manually extract fields.
 */
function extractDetailedErrors(error: any): string {
  const details: string[] = [];

  if (error.errors && Array.isArray(error.errors)) {
    error.errors.forEach((e: any, i: number) => {
      const parts: string[] = [`Error ${i + 1}:`];

      // Try to access common protobuf fields
      if (e.message) parts.push(`message=${e.message}`);
      if (e.error_code) {
        // error_code is an object like { campaign_error: 9 } or { request_error: 3 }
        try {
          const codeKeys = Object.keys(e.error_code);
          if (codeKeys.length > 0) {
            parts.push(`error_code={${codeKeys.map(k => `${k}: ${e.error_code[k]}`).join(', ')}}`);
          } else {
            // Try to get it via JSON or toString
            parts.push(`error_code=${String(e.error_code)}`);
          }
        } catch { parts.push('error_code=(unreadable)'); }
      }
      if (e.trigger) {
        try {
          parts.push(`trigger=${e.trigger.string_value || JSON.stringify(e.trigger)}`);
        } catch { /* skip */ }
      }
      if (e.location) {
        try {
          const fieldPaths = e.location?.field_path_elements?.map((fp: any) =>
            fp.field_name + (fp.index !== undefined ? `[${fp.index}]` : '')
          );
          if (fieldPaths?.length) parts.push(`field_path=${fieldPaths.join('.')}`);
        } catch { /* skip */ }
      }

      details.push(parts.join(' '));
    });
  }

  if (error.request_id) details.push(`request_id=${error.request_id}`);

  return details.length > 0 ? details.join(' | ') : 'No detailed error info available';
}

/**
 * Check if error is retryable (rate limiting, network issues, gRPC metadata failures)
 */
function isRetryableError(error: any): boolean {
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('quota') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('all promises were rejected') ||
    message.includes('metadata') ||
    message.includes('dns') ||
    message.includes('unavailable') ||
    message.includes('deadline exceeded')
  );
}

/**
 * Check if Lambda is approaching timeout
 * @param startTime - The start time of the current request (not module load time)
 */
function isApproachingTimeout(startTime: number): boolean {
  return (Date.now() - startTime) > LAMBDA_TIMEOUT_BUFFER_MS;
}

/**
 * Comprehensive placeholder replacement - matches Aryshare's resolvePostPlaceholders
 * Supports both snake_case and camelCase placeholders
 * FIX: Now sanitizes clinic values to prevent injection via malicious clinic config
 */
function replacePlaceholders(text: string, clinic: any): string {
  if (!text) return text;

  // Sanitize clinic values before interpolation to prevent injection
  const sanitize = (val: string | undefined) => sanitizeAdTextValue(val || '');

  const replacements: Record<string, string> = {
    // CamelCase placeholders (primary format)
    'clinicName': sanitize(clinic.clinicName),
    'clinicCity': sanitize(clinic.clinicCity),
    'city': sanitize(clinic.clinicCity),
    'clinicState': sanitize(clinic.clinicState),
    'state': sanitize(clinic.clinicState),
    'clinicAddress': sanitize(clinic.clinicAddress),
    'address': sanitize(clinic.clinicAddress),
    'clinicZipCode': sanitize(clinic.clinicZipCode),
    'zipCode': sanitize(clinic.clinicZipCode),
    'clinicPhone': sanitize(clinic.clinicPhone),
    'phone': sanitize(clinic.clinicPhone),
    'phoneNumber': sanitize(clinic.clinicPhone),
    'clinicEmail': sanitize(clinic.clinicEmail),
    'email': sanitize(clinic.clinicEmail),
    'websiteLink': clinic.websiteLink || '', // URLs don't need text sanitization
    'website': clinic.websiteLink || '',
    'domain': clinic.domain || '',
    'logoUrl': clinic.logoUrl || '',
    'mapsUrl': clinic.mapsUrl || '',
    'scheduleUrl': clinic.scheduleUrl || '',
    'clinicId': clinic.clinicId || '',

    // Snake_case placeholders (for compatibility)
    'clinic_name': sanitize(clinic.clinicName),
    'clinic_city': sanitize(clinic.clinicCity),
    'clinic_state': sanitize(clinic.clinicState),
    'clinic_address': sanitize(clinic.clinicAddress),
    'clinic_zip_code': sanitize(clinic.clinicZipCode),
    'clinic_phone': sanitize(clinic.clinicPhone),
    'phone_number': sanitize(clinic.clinicPhone),
    'clinic_email': sanitize(clinic.clinicEmail),
    'website_link': clinic.websiteLink || '',
    'logo_url': clinic.logoUrl || '',
    'maps_url': clinic.mapsUrl || '',
    'schedule_url': clinic.scheduleUrl || '',
    'clinic_id': clinic.clinicId || '',
  };

  let result = text;
  for (const [placeholder, value] of Object.entries(replacements)) {
    const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }

  // Final check: Warn if any unresolved placeholders remain
  const unresolvedMatch = result.match(/\{\{[^}]+\}\}/g);
  if (unresolvedMatch) {
    console.warn(`[GoogleAdsBulk] Unresolved placeholders in text: ${unresolvedMatch.join(', ')}`);
    // Remove unresolved placeholders to prevent rejection
    result = result.replace(/\{\{[^}]+\}\}/g, '');
  }

  return result;
}

// ============================================
// TYPE DEFINITIONS
// ============================================

interface BulkPublishRequest {
  customerIds: string[];
  campaignTemplate: {
    name: string;
    type: 'SEARCH' | 'DISPLAY' | 'VIDEO';
    dailyBudget: number;
    status: 'ENABLED' | 'PAUSED';
    // Smart bidding options (parity with single-campaign endpoint)
    biddingStrategy?: 'MANUAL_CPC' | 'TARGET_CPA' | 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CLICKS' | 'TARGET_ROAS';
    targetCpa?: number; // Required when biddingStrategy is TARGET_CPA
    targetRoas?: number; // Required when biddingStrategy is TARGET_ROAS (e.g., 300 = 300%)
  };
  // Ad group template (required for functional campaigns)
  adGroupTemplate?: {
    name: string; // Use {{clinicName}} placeholder
    cpcBid: number; // REQUIRED: CPC bid in dollars (no default - must be explicit)
  };
  // Ad template for responsive search ads
  adTemplate?: {
    headlines: string[]; // Use {{clinicName}}, {{city}} placeholders
    descriptions: string[];
    finalUrlTemplate: string; // e.g., "https://{{domain}}/schedule"
    path1?: string;
    path2?: string;
  };
  // Default keywords to add
  defaultKeywords?: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;
  // Default negative keywords
  defaultNegativeKeywords?: string[];
}

interface BulkKeywordsRequest {
  customerIds: string[];
  adGroupResourceName: string;
  keywords: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;
}

interface BulkOperationResult {
  total: number;
  successful: Array<{
    customerId: string;
    campaignId?: string;
    message?: string;
  }>;
  failed: Array<{
    customerId: string;
    error: string;
  }>;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;

  console.log(`[GoogleAdsBulk] ${method} ${path}`);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
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
    // Route: GET /google-ads/bulk/clinics
    if (method === 'GET' && path.includes('/bulk/clinics')) {
      return await listClinicsForSelection(event, corsHeaders);
    }

    // Route: POST /google-ads/bulk/publish
    if (method === 'POST' && path.includes('/bulk/publish')) {
      return await bulkPublishCampaigns(event, corsHeaders);
    }

    // Route: POST /google-ads/bulk/keywords
    if (method === 'POST' && path.includes('/bulk/keywords')) {
      return await bulkAddKeywords(event, corsHeaders);
    }

    // Route: GET /google-ads/bulk/rate-limit
    if (method === 'GET' && path.includes('/bulk/rate-limit')) {
      return await getRateLimitInfo(corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsBulk] Error:', error);
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
// BULK OPERATION HANDLERS
// ============================================

async function listClinicsForSelection(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const filterConfigured = event.queryStringParameters?.configured === 'true';

  try {
    const clinics = await getAllClinicsWithGoogleAdsStatus();

    // Sort by clinic name
    clinics.sort((a, b) => a.clinicName.localeCompare(b.clinicName));

    // Filter to only configured clinics if requested
    const filteredClinics = filterConfigured
      ? clinics.filter(c => c.hasGoogleAds)
      : clinics;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        clinics: filteredClinics,
        total: filteredClinics.length,
        configured: clinics.filter(c => c.hasGoogleAds).length,
        unconfigured: clinics.filter(c => !c.hasGoogleAds).length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsBulk] Error listing clinics:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function bulkPublishCampaigns(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: BulkPublishRequest = JSON.parse(event.body || '{}');
  const { customerIds, campaignTemplate, adGroupTemplate, adTemplate, defaultKeywords, defaultNegativeKeywords } = body;

  if (!customerIds || customerIds.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No customerIds provided' }),
    };
  }

  if (!campaignTemplate || !campaignTemplate.name || !campaignTemplate.dailyBudget) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: campaignTemplate with name and dailyBudget',
      }),
    };
  }

  // Validate smart bidding requirements (parity with single-campaign endpoint)
  if (campaignTemplate.biddingStrategy === 'TARGET_CPA' && !campaignTemplate.targetCpa) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'targetCpa is required when using TARGET_CPA bidding strategy',
      }),
    };
  }

  if (campaignTemplate.biddingStrategy === 'TARGET_ROAS' && !campaignTemplate.targetRoas) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'targetRoas is required when using TARGET_ROAS bidding strategy',
      }),
    };
  }

  // Validate targetRoas range (Google Ads API requires >= 0.01 and <= 100)
  if (campaignTemplate.biddingStrategy === 'TARGET_ROAS' && campaignTemplate.targetRoas) {
    const roasValidation = validateTargetRoas(campaignTemplate.targetRoas);
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

  // Track request start time for timeout detection (not module load time)
  const requestStartTime = Date.now();

  console.log(`[GoogleAdsBulk] Publishing to ${customerIds.length} accounts in batches of ${BATCH_SIZE}`);

  // Get clinic configs for placeholder replacement
  const clinics = await getAllClinicsWithGoogleAdsStatus();
  const clinicMap = new Map(clinics.map(c => [c.customerId, c]));
  // Also map by clinicId for cases where clinicId is passed instead of customerId
  const clinicByIdMap = new Map(clinics.map(c => [c.clinicId, c]));

  const result: BulkOperationResult = {
    total: customerIds.length,
    successful: [],
    failed: [],
  };

  // Collect all validation warnings
  const allWarnings: string[] = [];

  // PERMISSION CROSS-VALIDATION: Build set of allowed clinics for the user
  const userPerms = getUserPermissions(event);
  let allowedClinicIds: Set<string> | null = null;
  if (userPerms) {
    allowedClinicIds = getAllowedClinicIds(
      userPerms.clinicRoles,
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    );
  }

  /**
   * Process a single account with retry logic
   */
  async function processAccountWithRetry(customerId: string, retries: number = 0): Promise<void> {
    // Look up clinic by customerId or clinicId
    let clinic = clinicMap.get(customerId) || clinicByIdMap.get(customerId);

    // If we found by clinicId, get the actual customerId
    if (clinic && !clinicMap.has(customerId)) {
      customerId = clinic.customerId;
    }

    if (!clinic) {
      result.failed.push({
        customerId,
        error: 'Clinic not found for this customerId/clinicId',
      });
      return;
    }

    // VALIDATION: Check if customerId is valid (not empty)
    if (!customerId || customerId.trim() === '') {
      result.failed.push({
        customerId: clinic.clinicId || 'unknown',
        error: `Clinic "${clinic.clinicName}" does not have Google Ads configured (missing customerId)`,
      });
      return;
    }

    // PERMISSION CROSS-VALIDATION: Verify user has access to this clinic
    if (allowedClinicIds && !hasClinicAccess(allowedClinicIds, clinic.clinicId)) {
      console.warn(`[GoogleAdsBulk] Permission denied for clinic ${clinic.clinicId} (${clinic.clinicName})`);
      result.failed.push({
        customerId,
        error: `Access denied: You do not have permission to manage campaigns for clinic ${clinic.clinicName}`,
      });
      return;
    }

    // Declare outside try for cleanup access in catch
    let client: any;
    let budgetResourceName: string | undefined;
    let campaignResourceName: string | undefined;

    try {
      console.log(`[GoogleAdsBulk] Creating campaign for ${customerId} (${clinic.clinicName})${retries > 0 ? ` [retry ${retries}]` : ''}`);

      client = await getGoogleAdsClient(customerId);
      const campaignName = replacePlaceholders(campaignTemplate.name, clinic);

      // Create budget first — must set explicitly_shared to false for campaign-specific budgets
      const budgetResource = {
        name: `Budget - ${campaignName} - ${Date.now()}`,
        amount_micros: dollarsToMicros(campaignTemplate.dailyBudget),
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      };

      console.log(`[GoogleAdsBulk] Budget resource:`, JSON.stringify(budgetResource));
      const budgetResponse = await (client as any).campaignBudgets.create([budgetResource]);
      budgetResourceName = budgetResponse.results[0].resource_name;
      console.log(`[GoogleAdsBulk] Budget created: ${budgetResourceName}`);

      // Build bidding configuration
      // IMPORTANT: Google Ads API uses protobuf `oneof` for campaign_bidding_strategy.
      // Empty objects like `maximize_clicks: {}` serialize as null in protobuf,
      // causing "The required field was not present" error on campaign_bidding_strategy.
      // Each bidding strategy object MUST have at least one concrete field value.
      //
      // NOTE: TARGET_CPA, MAXIMIZE_CONVERSIONS, and TARGET_ROAS require conversion tracking
      // to be set up on the account first. If no conversion actions exist, the API returns:
      //   "The operation is not allowed for the given context" (context_error: 2)
      // We fall back to MAXIMIZE_CLICKS for safety during bulk operations.
      let effectiveStrategy = campaignTemplate.biddingStrategy || 'MAXIMIZE_CLICKS';
      const conversionRequiredStrategies = ['TARGET_CPA', 'MAXIMIZE_CONVERSIONS', 'TARGET_ROAS'];

      // For conversion-dependent strategies, verify conversion tracking exists
      if (conversionRequiredStrategies.includes(effectiveStrategy)) {
        try {
          const convQuery = `SELECT conversion_action.id FROM conversion_action WHERE conversion_action.status = 'ENABLED' LIMIT 1`;
          const convResults = await (client as any).query(convQuery);
          if (!convResults || convResults.length === 0) {
            console.warn(`[GoogleAdsBulk] Account ${customerId} has no conversion actions. Falling back from ${effectiveStrategy} to MAXIMIZE_CLICKS.`);
            allWarnings.push(`${clinic.clinicName}: ${effectiveStrategy} requires conversion tracking — fell back to MAXIMIZE_CLICKS`);
            effectiveStrategy = 'MAXIMIZE_CLICKS';
          }
        } catch (convCheckError: any) {
          console.warn(`[GoogleAdsBulk] Could not verify conversion tracking for ${customerId}: ${convCheckError.message}. Falling back to MAXIMIZE_CLICKS.`);
          allWarnings.push(`${clinic.clinicName}: Could not verify conversion tracking — fell back to MAXIMIZE_CLICKS`);
          effectiveStrategy = 'MAXIMIZE_CLICKS';
        }
      }

      const biddingConfig: any = {};
      switch (effectiveStrategy) {
        case 'MANUAL_CPC':
          biddingConfig.manual_cpc = { enhanced_cpc_enabled: true };
          break;
        case 'TARGET_CPA':
          biddingConfig.target_cpa = { target_cpa_micros: dollarsToMicros(campaignTemplate.targetCpa!) };
          break;
        case 'MAXIMIZE_CONVERSIONS':
          biddingConfig.maximize_conversions = { target_cpa_micros: 1 };
          break;
        case 'MAXIMIZE_CLICKS':
          biddingConfig.maximize_clicks = { cpc_bid_ceiling_micros: 10000000000 };
          break;
        case 'TARGET_ROAS':
          biddingConfig.target_roas = { target_roas: campaignTemplate.targetRoas! / 100 };
          break;
      }

      // Map campaign type string to enum value
      const campaignTypeStr = campaignTemplate.type || 'SEARCH';
      const channelTypeEnum = campaignTypeStr === 'SEARCH'
        ? enums.AdvertisingChannelType.SEARCH
        : campaignTypeStr === 'DISPLAY'
          ? enums.AdvertisingChannelType.DISPLAY
          : campaignTypeStr === 'VIDEO'
            ? enums.AdvertisingChannelType.VIDEO
            : enums.AdvertisingChannelType.SEARCH;

      // Map status string to enum value
      const statusStr = campaignTemplate.status || 'PAUSED';
      const statusEnum = statusStr === 'ENABLED'
        ? enums.CampaignStatus.ENABLED
        : enums.CampaignStatus.PAUSED;

      // Build network settings based on campaign type
      const networkSettings = campaignTypeStr === 'SEARCH' ? {
        target_google_search: true,
        target_search_network: true,
      } : campaignTypeStr === 'VIDEO' ? {
        target_youtube: true,
      } : undefined;

      // Create campaign with proper enum values
      // REQUIRED: contains_eu_political_advertising must be set on all campaigns (Google Ads API mandate)
      const campaignResource = {
        name: campaignName,
        status: statusEnum,
        advertising_channel_type: channelTypeEnum,
        campaign_budget: budgetResourceName,
        ...biddingConfig,
        ...(networkSettings ? { network_settings: networkSettings } : {}),
        // EU Political Advertising compliance — required field since Google Ads API v15+
        contains_eu_political_advertising: false,
      };

      console.log(`[GoogleAdsBulk] Campaign resource:`, JSON.stringify(campaignResource));

      // Note: campaignResourceName is declared outside try block for cleanup access
      let googleCampaignId: string | undefined;

      const campaignResponse = await (client as any).campaigns.create([campaignResource]);
      campaignResourceName = campaignResponse.results[0].resource_name;
      googleCampaignId = campaignResourceName?.split('/').pop();

      let adGroupResourceName: string | undefined;
      let adCreated = false;
      let keywordsAdded = 0;
      let negativeKeywordsAdded = 0;

      // Create Ad Group if template provided
      if (adGroupTemplate) {
        // VALIDATION: cpcBid is required (no default)
        if (!adGroupTemplate.cpcBid) {
          throw new Error('adGroupTemplate.cpcBid is required. Specify the CPC bid in dollars.');
        }

        const adGroupName = replacePlaceholders(adGroupTemplate.name || `${campaignName} - Ad Group`, clinic);

        // Get proper ad group type based on campaign type
        const adGroupType = CAMPAIGN_TYPE_TO_AD_GROUP_TYPE[campaignTemplate.type || 'SEARCH'] || 'SEARCH_STANDARD';

        const adGroupResource = {
          name: adGroupName,
          campaign: campaignResourceName,
          status: 'ENABLED',
          type: adGroupType,
          cpc_bid_micros: dollarsToMicros(adGroupTemplate.cpcBid),
        };

        const adGroupResponse = await (client as any).adGroups.create([adGroupResource]);
        adGroupResourceName = adGroupResponse.results[0].resource_name;
        console.log(`[GoogleAdsBulk] Created ad group for ${customerId}: ${adGroupResourceName}`);

        // Create Responsive Search Ad if template provided (only for SEARCH campaigns)
        // NOTE: VIDEO campaigns require VIDEO_IN_STREAM_AD or similar - RSA is not supported
        if (adTemplate && campaignTemplate.type === 'SEARCH') {
          const rawHeadlines = adTemplate.headlines.map(h => replacePlaceholders(h, clinic));
          const rawDescriptions = adTemplate.descriptions.map(d => replacePlaceholders(d, clinic));
          const finalUrl = replacePlaceholders(adTemplate.finalUrlTemplate, clinic);

          // Validate and truncate to fit Google Ads character limits
          const { validHeadlines, validDescriptions, warnings } = validateAdText(rawHeadlines, rawDescriptions);

          if (warnings.length > 0) {
            allWarnings.push(`${clinic.clinicName}: ${warnings.join('; ')}`);
          }

          // Validate path lengths
          let path1 = adTemplate.path1 ? replacePlaceholders(adTemplate.path1, clinic) : undefined;
          let path2 = adTemplate.path2 ? replacePlaceholders(adTemplate.path2, clinic) : undefined;

          if (path1 && path1.length > PATH_MAX_CHARS) {
            path1 = truncateToLimit(path1, PATH_MAX_CHARS);
            allWarnings.push(`${clinic.clinicName}: path1 truncated to ${PATH_MAX_CHARS} chars`);
          }
          if (path2 && path2.length > PATH_MAX_CHARS) {
            path2 = truncateToLimit(path2, PATH_MAX_CHARS);
            allWarnings.push(`${clinic.clinicName}: path2 truncated to ${PATH_MAX_CHARS} chars`);
          }

          if (validHeadlines.length >= 3 && validDescriptions.length >= 2) {
            const adResource = {
              ad_group: adGroupResourceName,
              status: 'ENABLED',
              ad: {
                responsive_search_ad: {
                  headlines: validHeadlines.slice(0, 15).map(text => ({ text })),
                  descriptions: validDescriptions.slice(0, 4).map(text => ({ text })),
                  path1,
                  path2,
                },
                final_urls: [finalUrl],
              },
            };

            await (client as any).adGroupAds.create([adResource]);
            adCreated = true;
            console.log(`[GoogleAdsBulk] Created ad for ${customerId}`);
          } else {
            console.warn(`[GoogleAdsBulk] Skipping ad creation for ${customerId}: need at least 3 headlines and 2 descriptions`);
          }
        } else if (adTemplate && campaignTemplate.type === 'VIDEO') {
          // VIDEO campaigns don't support RSA - log informational message
          console.info(`[GoogleAdsBulk] Skipping RSA for VIDEO campaign ${customerId}: VIDEO campaigns require manual ad creation (VIDEO_IN_STREAM_AD, etc.)`);
        }

        // Add default keywords if provided
        // NOTE: The google-ads-api library's create() expects resource objects directly,
        // NOT wrapped in { create: { ... } } operation objects
        if (defaultKeywords && defaultKeywords.length > 0) {
          const keywordResources = defaultKeywords.map(kw => ({
            ad_group: adGroupResourceName,
            status: 'ENABLED',
            keyword: {
              text: replacePlaceholders(kw.text, clinic),
              match_type: kw.matchType,
            },
          }));

          await (client as any).adGroupCriteria.create(keywordResources);
          keywordsAdded = defaultKeywords.length;
          console.log(`[GoogleAdsBulk] Added ${keywordsAdded} keywords for ${customerId}`);
        }

        // Add default negative keywords if provided
        if (defaultNegativeKeywords && defaultNegativeKeywords.length > 0) {
          const negativeKeywordResources = defaultNegativeKeywords.map(text => ({
            ad_group: adGroupResourceName,
            negative: true,
            keyword: {
              text: replacePlaceholders(text, clinic),
              match_type: 'PHRASE',
            },
          }));

          await (client as any).adGroupCriteria.create(negativeKeywordResources);
          negativeKeywordsAdded = defaultNegativeKeywords.length;
          console.log(`[GoogleAdsBulk] Added ${negativeKeywordsAdded} negative keywords for ${customerId}`);
        }
      }

      // Store in DynamoDB with TTL - now includes clinicId!
      const campaignId = `${customerId}-${googleCampaignId}`;
      const now = new Date().toISOString();
      const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days

      await ddb.send(new PutCommand({
        TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
        Item: {
          campaignId,
          clinicId: clinic.clinicId, // Now storing clinicId for easier querying
          customerId,
          googleCampaignId,
          name: campaignName,
          status: campaignTemplate.status || 'PAUSED',
          type: campaignTemplate.type || 'SEARCH',
          budget: campaignTemplate.dailyBudget,
          biddingStrategy: campaignTemplate.biddingStrategy || 'MANUAL_CPC',
          spent: 0,
          impressions: 0,
          clicks: 0,
          ctr: 0,
          conversions: 0,
          costPerConversion: 0,
          adGroupResourceName,
          createdAt: now,
          updatedAt: now,
          syncedAt: now,
          ttl,
        },
      }));

      result.successful.push({
        customerId,
        campaignId,
        message: `Campaign "${campaignName}" created${adGroupResourceName ? ' with ad group' : ''}${adCreated ? ' and ad' : ''}${keywordsAdded > 0 ? ` (${keywordsAdded} keywords)` : ''}`,
      });
    } catch (error: any) {
      const errorMsg = extractErrorMessage(error);
      console.error(`[GoogleAdsBulk] Error for account ${customerId}:`, errorMsg);
      // Log detailed error info (protobuf objects don't serialize well with JSON.stringify)
      console.error(`[GoogleAdsBulk] Detailed errors:`, extractDetailedErrors(error));
      // Also try to log all own property names for deep debugging
      try {
        const errKeys = Object.getOwnPropertyNames(error);
        console.error(`[GoogleAdsBulk] Error keys: [${errKeys.join(', ')}]`);
        if (error.errors && Array.isArray(error.errors)) {
          error.errors.forEach((e: any, i: number) => {
            const eKeys = Object.getOwnPropertyNames(e);
            console.error(`[GoogleAdsBulk] errors[${i}] keys: [${eKeys.join(', ')}], values:`,
              eKeys.reduce((acc: any, k: string) => { acc[k] = e[k]; return acc; }, {}));
          });
        }
      } catch { /* best-effort logging */ }

      // CLEANUP: Remove orphaned budget if campaign creation failed
      if (budgetResourceName && !campaignResourceName && client) {
        console.warn(`[GoogleAdsBulk] Cleaning up orphaned budget ${budgetResourceName} due to campaign creation failure`);
        try {
          await client.campaignBudgets.remove([budgetResourceName]);
          console.log(`[GoogleAdsBulk] Cleaned up orphaned budget: ${budgetResourceName}`);
        } catch (cleanupError: any) {
          console.error(`[GoogleAdsBulk] ORPHAN_RESOURCE: Budget cleanup failed - ${budgetResourceName} for customer ${customerId} may need manual removal. Error: ${extractErrorMessage(cleanupError)}`);
        }
      }

      // CLEANUP: If campaign was created but subsequent steps failed, mark it as REMOVED
      if (campaignResourceName && client) {
        console.warn(`[GoogleAdsBulk] Cleaning up orphaned campaign ${campaignResourceName} due to partial failure`);
        try {
          const removeOperation = {
            update: {
              resource_name: campaignResourceName,
              status: 'REMOVED',
            },
            update_mask: { paths: ['status'] },
          };
          await client.campaigns.update([removeOperation]);
          console.log(`[GoogleAdsBulk] Cleaned up orphaned campaign: ${campaignResourceName}`);
        } catch (cleanupError: any) {
          console.error(`[GoogleAdsBulk] ORPHAN_RESOURCE: Campaign cleanup failed - ${campaignResourceName} for customer ${customerId} may need manual removal. Error: ${extractErrorMessage(cleanupError)}`);
        }
      }

      // Retry if we have retries left and it's a potentially transient error
      if (retries < MAX_RETRIES && isRetryableError(error)) {
        console.log(`[GoogleAdsBulk] Retrying account ${customerId} (attempt ${retries + 1}/${MAX_RETRIES})`);
        await delay(RETRY_DELAY_MS * (retries + 1)); // Exponential backoff
        return processAccountWithRetry(customerId, retries + 1);
      }

      result.failed.push({
        customerId,
        error: errorMsg,
      });
    }
  }

  // Process accounts in parallel batches with rate limiting and timeout protection
  let earlyExitDueToTimeout = false;
  let processedCount = 0;

  for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
    // Check for Lambda timeout before processing next batch (use request start time, not module load time)
    if (isApproachingTimeout(requestStartTime)) {
      console.warn(`[GoogleAdsBulk] Approaching Lambda timeout after ${processedCount} accounts. Stopping early.`);
      earlyExitDueToTimeout = true;
      // Mark remaining accounts as skipped
      const remainingIds = customerIds.slice(i);
      for (const remainingId of remainingIds) {
        result.failed.push({
          customerId: remainingId,
          error: 'Skipped due to Lambda timeout - please retry remaining accounts',
        });
      }
      break;
    }

    const batch = customerIds.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(customerIds.length / BATCH_SIZE);

    console.log(`[GoogleAdsBulk] Processing batch ${batchNumber}/${totalBatches} (${batch.length} accounts)`);

    await Promise.all(batch.map(customerId => processAccountWithRetry(customerId)));
    processedCount += batch.length;

    // Delay between batches (except for the last batch)
    if (i + BATCH_SIZE < customerIds.length) {
      console.log(`[GoogleAdsBulk] Waiting ${DELAY_BETWEEN_BATCHES_MS}ms before next batch...`);
      await delay(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`[GoogleAdsBulk] Complete: ${result.successful.length} success, ${result.failed.length} failed${earlyExitDueToTimeout ? ' (early exit due to timeout)' : ''}`);

  return {
    statusCode: earlyExitDueToTimeout ? 206 : 200, // 206 Partial Content if timed out
    headers: corsHeaders,
    body: JSON.stringify({
      success: !earlyExitDueToTimeout,
      partialSuccess: earlyExitDueToTimeout,
      result,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
      message: earlyExitDueToTimeout
        ? `Partial completion: Published to ${result.successful.length} accounts before timeout. ${result.failed.length} accounts need retry.`
        : `Published to ${result.successful.length} accounts, ${result.failed.length} failed`,
      batchInfo: {
        batchSize: BATCH_SIZE,
        totalBatches: Math.ceil(customerIds.length / BATCH_SIZE),
        processedBatches: Math.ceil(processedCount / BATCH_SIZE),
        delayMs: DELAY_BETWEEN_BATCHES_MS,
        maxRetries: MAX_RETRIES,
        earlyExitDueToTimeout,
      },
    }),
  };
}

async function bulkAddKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: BulkKeywordsRequest = JSON.parse(event.body || '{}');
  const { customerIds, adGroupResourceName, keywords } = body;

  if (!customerIds || customerIds.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No customerIds provided' }),
    };
  }

  if (!adGroupResourceName || !keywords || keywords.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: adGroupResourceName and keywords',
      }),
    };
  }

  // FIX: Extract adGroupId from resource name to construct customer-specific resource names
  // Resource name format: customers/{customerId}/adGroups/{adGroupId}
  // IMPORTANT: This assumes all target accounts have ad groups with the SAME adGroupId
  // which is the case when campaigns are bulk-created with the same template
  const adGroupIdMatch = adGroupResourceName.match(/adGroups\/(\d+)$/);
  if (!adGroupIdMatch) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: `Invalid adGroupResourceName format: ${adGroupResourceName}. Expected format: customers/{customerId}/adGroups/{adGroupId}`,
      }),
    };
  }
  const adGroupId = adGroupIdMatch[1];

  console.log(`[GoogleAdsBulk] Adding keywords to ${customerIds.length} accounts in batches of ${BATCH_SIZE} (adGroupId: ${adGroupId})`);

  // Get clinic configs for placeholder replacement in keywords
  const clinics = await getAllClinicsWithGoogleAdsStatus();
  const clinicMap = new Map(clinics.map(c => [c.customerId, c]));

  const result: BulkOperationResult = {
    total: customerIds.length,
    successful: [],
    failed: [],
  };

  /**
   * Process a single account with retry logic
   */
  async function addKeywordsWithRetry(customerId: string, retries: number = 0): Promise<void> {
    const clinic = clinicMap.get(customerId);

    // FIX: Validate clinic exists before attempting to add keywords
    // This prevents unresolved placeholders like "{{clinicName}} dentist" from being added
    if (!clinic) {
      console.warn(`[GoogleAdsBulk] No clinic found for customerId ${customerId} - cannot resolve keyword placeholders`);
      result.failed.push({
        customerId,
        error: `No clinic configuration found for customerId ${customerId}. Cannot resolve keyword placeholders.`,
      });
      return;
    }

    try {
      console.log(`[GoogleAdsBulk] Adding keywords for ${customerId}${retries > 0 ? ` [retry ${retries}]` : ''}`);

      // Replace placeholders in keyword text
      const resolvedKeywords = keywords.map(kw => ({
        text: replacePlaceholders(kw.text, clinic),
        matchType: kw.matchType,
      }));

      // FIX: Construct customer-specific ad group resource name
      // Previously used the same resource name for all customers, which would fail
      const customerAdGroupResourceName = `customers/${customerId.replace(/-/g, '')}/adGroups/${adGroupId}`;

      await addKeywordsToGoogle(customerId, customerAdGroupResourceName, resolvedKeywords);

      result.successful.push({
        customerId,
        message: `Added ${keywords.length} keywords successfully`,
      });
    } catch (error: any) {
      const errorMsg = extractErrorMessage(error);
      console.error(`[GoogleAdsBulk] Error for account ${customerId}:`, errorMsg);

      // Retry if we have retries left and it's a potentially transient error
      if (retries < MAX_RETRIES && isRetryableError(error)) {
        console.log(`[GoogleAdsBulk] Retrying keywords for ${customerId} (attempt ${retries + 1}/${MAX_RETRIES})`);
        await delay(RETRY_DELAY_MS * (retries + 1));
        return addKeywordsWithRetry(customerId, retries + 1);
      }

      result.failed.push({
        customerId,
        error: errorMsg,
      });
    }
  }

  // Process accounts in parallel batches with rate limiting
  for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
    const batch = customerIds.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(customerIds.length / BATCH_SIZE);

    console.log(`[GoogleAdsBulk] Processing batch ${batchNumber}/${totalBatches} (${batch.length} accounts)`);

    await Promise.all(batch.map(customerId => addKeywordsWithRetry(customerId)));

    // Delay between batches (except for the last batch)
    if (i + BATCH_SIZE < customerIds.length) {
      console.log(`[GoogleAdsBulk] Waiting ${DELAY_BETWEEN_BATCHES_MS}ms before next batch...`);
      await delay(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`[GoogleAdsBulk] Keywords complete: ${result.successful.length} success, ${result.failed.length} failed`);

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      result,
      message: `Added keywords to ${result.successful.length} accounts, ${result.failed.length} failed`,
      batchInfo: {
        batchSize: BATCH_SIZE,
        totalBatches: Math.ceil(customerIds.length / BATCH_SIZE),
        delayMs: DELAY_BETWEEN_BATCHES_MS,
        maxRetries: MAX_RETRIES,
      },
    }),
  };
}

/**
 * Get rate limit configuration info
 */
async function getRateLimitInfo(
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      rateLimits: {
        batchSize: BATCH_SIZE,
        delayBetweenBatchesMs: DELAY_BETWEEN_BATCHES_MS,
        maxRetries: MAX_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
      },
      characterLimits: {
        headline: HEADLINE_MAX_CHARS,
        description: DESCRIPTION_MAX_CHARS,
        path: PATH_MAX_CHARS,
      },
      recommendations: {
        maxAccountsPerMinute: Math.floor(60000 / DELAY_BETWEEN_BATCHES_MS) * BATCH_SIZE,
        optimalBatchSize: BATCH_SIZE,
      },
    }),
  };
}

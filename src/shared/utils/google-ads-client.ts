/**
 * Google Ads API Client Utility
 * 
 * Uses global MCC (Manager Account) credentials from GlobalSecrets.
 * Customer IDs are provided per-request, not stored per-clinic.
 * 
 * This matches the approach in ads_factory.py where:
 * - Client is initialized with global credentials from a config file
 * - Customer ID is passed to each method as a parameter
 * 
 * Usage:
 *   import { getGoogleAdsClient, executeQuery } from '../../shared/utils/google-ads-client';
 *   
 *   const client = await getGoogleAdsClient();
 *   const campaigns = await executeQuery(client, customerId, 'SELECT campaign.id FROM campaign');
 */

import { GoogleAdsApi, Customer } from 'google-ads-api';

// Google Ads API enum values (numeric protobuf values)
// Defined locally to avoid TS resolution issues — google-ads-api is only available at Lambda runtime
export const enums = {
  AdvertisingChannelType: {
    SEARCH: 2,
    DISPLAY: 3,
    SHOPPING: 4,
    VIDEO: 6,
    PERFORMANCE_MAX: 13,
  },
  CampaignStatus: {
    ENABLED: 2,
    PAUSED: 3,
    REMOVED: 4,
  },
  BudgetDeliveryMethod: {
    STANDARD: 2,
    ACCELERATED: 3,
  },
  ConversionActionCategory: {
    DEFAULT: 0,
    PAGE_VIEW: 2,
    PURCHASE: 3,
    SIGNUP: 4,
    LEAD: 5,
    DOWNLOAD: 6,
    ADD_TO_CART: 7,
    BEGIN_CHECKOUT: 8,
    SUBSCRIBE_PAID: 9,
    PHONE_CALL_LEAD: 10,
    IMPORTED_LEAD: 11,
    SUBMIT_LEAD_FORM: 12,
    BOOK_APPOINTMENT: 13,
    REQUEST_QUOTE: 14,
    GET_DIRECTIONS: 15,
    OUTBOUND_CLICK: 16,
    CONTACT: 17,
    ENGAGEMENT: 18,
    STORE_VISIT: 19,
    STORE_SALE: 20,
    QUALIFIED_LEAD: 21,
    CONVERTED_LEAD: 22,
  },
  ConversionActionType: {
    AD_CALL: 2,
    CLICK_TO_CALL: 3,
    GOOGLE_PLAY_DOWNLOAD: 4,
    GOOGLE_PLAY_IN_APP_PURCHASE: 5,
    UPLOAD_CALLS: 6,
    UPLOAD_CLICKS: 7,
    WEBPAGE: 8,
    WEBSITE_CALL: 9,
    STORE_SALES_DIRECT_UPLOAD: 10,
    STORE_SALES: 11,
    // Add others if needed
  },
  ConversionActionStatus: {
    ENABLED: 2,
    REMOVED: 3,
    HIDDEN: 4,
  },
  ConversionActionCountingType: {
    ONE_PER_CLICK: 2,
    MANY_PER_CLICK: 3,
  },
} as const;
import {
  getGlobalSecret,
  getAllClinicConfigs,
  ClinicConfig,
} from './secrets-helper';

// ========================================
// TYPES
// ========================================

export interface GoogleAdsCredentials {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId: string;
}

export interface ClinicGoogleAdsMapping {
  clinicId: string;
  clinicName: string;
  clinicCity: string;
  clinicState: string;
  clinicAddress: string;
  clinicZipCode: string;
  clinicPhone: string;
  clinicEmail: string;
  websiteLink: string;
  logoUrl: string;
  mapsUrl: string;
  scheduleUrl: string;
  domain: string; // Extracted from websiteLink
  customerId: string;
  hasGoogleAds: boolean;
}

// Cache for the Google Ads API instance
let googleAdsApiInstance: GoogleAdsApi | null = null;
let globalRefreshToken: string | null = null;
let globalLoginCustomerId: string | null = null;

// Mutex for thread-safe singleton initialization
let initializationPromise: Promise<GoogleAdsApi> | null = null;

// ========================================
// GOOGLE ADS API INITIALIZATION
// ========================================

// ========================================
// GOOGLE ADS CHARACTER LIMITS & VALIDATION
// ========================================
export const HEADLINE_MAX_CHARS = 30;
export const DESCRIPTION_MAX_CHARS = 90;
export const PATH_MAX_CHARS = 15;

// Target ROAS must be >= 0.01 (1%) and <= 100 (10000%) per Google Ads API
export const MIN_TARGET_ROAS_PERCENT = 1;
export const MAX_TARGET_ROAS_PERCENT = 10000; // 10000% = 100.0 in API

// Configurable performance alert thresholds
export const PERFORMANCE_THRESHOLDS = {
  lowCtrPercent: 2,
  highCpaDollars: 100,
  minImpressionsForCtrAlert: 1000,
  minClicksForConversionAlert: 100,
};

/**
 * Sanitize text for use in Google Ads ad copy to prevent injection via placeholders
 * Removes or escapes characters that could cause ad rejection or display issues
 * @param value - The text value to sanitize
 * @returns Sanitized value safe for ad copy
 */
export function sanitizeAdTextValue(value: string): string {
  if (!value) return '';
  return value
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove HTML tags (basic protection)
    .replace(/<[^>]*>/g, '')
    // Escape characters that could break ad rendering
    .replace(/[{}]/g, '') // Remove stray braces (unresolved placeholders)
    .trim();
}

/**
 * Validate Target ROAS is within acceptable range
 * @param targetRoas - Target ROAS percentage (e.g., 300 = 300%)
 * @returns Object with isValid flag and error message if invalid
 */
export function validateTargetRoas(targetRoas: number): { isValid: boolean; error?: string } {
  if (targetRoas < MIN_TARGET_ROAS_PERCENT) {
    return {
      isValid: false,
      error: `targetRoas must be at least ${MIN_TARGET_ROAS_PERCENT}% (received ${targetRoas}%)`,
    };
  }
  if (targetRoas > MAX_TARGET_ROAS_PERCENT) {
    return {
      isValid: false,
      error: `targetRoas cannot exceed ${MAX_TARGET_ROAS_PERCENT}% (received ${targetRoas}%)`,
    };
  }
  return { isValid: true };
}

/**
 * Truncate text to fit within character limit
 * Uses ASCII periods (...) instead of Unicode ellipsis (…) for better Google Ads API compatibility
 */
export function truncateToLimit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Use 3 ASCII periods instead of Unicode ellipsis for API compatibility
  return text.substring(0, maxChars - 3) + '...';
}

/**
 * Validate and truncate headlines/descriptions to fit Google Ads limits
 */
export function validateAdText(headlines: string[], descriptions: string[]): {
  validHeadlines: string[];
  validDescriptions: string[];
  warnings: string[];
} {
  const warnings: string[] = [];

  const validHeadlines = headlines.map((h, i) => {
    if (h.length > HEADLINE_MAX_CHARS) {
      warnings.push(`Headline ${i + 1} truncated from ${h.length} to ${HEADLINE_MAX_CHARS} chars`);
      return truncateToLimit(h, HEADLINE_MAX_CHARS);
    }
    return h;
  });

  const validDescriptions = descriptions.map((d, i) => {
    if (d.length > DESCRIPTION_MAX_CHARS) {
      warnings.push(`Description ${i + 1} truncated from ${d.length} to ${DESCRIPTION_MAX_CHARS} chars`);
      return truncateToLimit(d, DESCRIPTION_MAX_CHARS);
    }
    return d;
  });

  return { validHeadlines, validDescriptions, warnings };
}

/**
 * Sanitize a value for use in GAQL queries to prevent injection
 * @param value - The value to sanitize
 * @returns Sanitized value safe for GAQL interpolation
 */
export function sanitizeGaqlValue(value: string): string {
  if (!value) return '';
  // IMPORTANT: Escape backslashes FIRST, then single quotes
  // GAQL uses single quotes for string literals
  return value
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/'/g, "\\'")    // Then escape single quotes
    .replace(/\n/g, ' ')     // Remove newlines
    .replace(/\r/g, ' ');    // Remove carriage returns
}

/**
 * Validate that a resource name follows the expected format
 * @param resourceName - The resource name to validate
 * @param expectedPattern - Regex pattern the resource name should match
 * @returns true if valid, false otherwise
 */
export function validateResourceName(resourceName: string, expectedPattern: RegExp): boolean {
  if (!resourceName) return false;
  return expectedPattern.test(resourceName);
}

/**
 * Get Google Ads API credentials from GlobalSecrets
 * All credentials are stored globally (MCC/Manager Account approach)
 */
export async function getGoogleAdsCredentials(): Promise<GoogleAdsCredentials | null> {
  try {
    const [developerToken, clientId, clientSecret, refreshToken, loginCustomerId] = await Promise.all([
      getGlobalSecret('google-ads', 'developer_token'),
      getGlobalSecret('google-ads', 'client_id'),
      getGlobalSecret('google-ads', 'client_secret'),
      getGlobalSecret('google-ads', 'refresh_token'),
      getGlobalSecret('google-ads', 'login_customer_id'),
    ]);

    if (!developerToken || !clientId || !clientSecret || !refreshToken) {
      console.warn('[GoogleAdsClient] Missing Google Ads credentials in GlobalSecrets');
      return null;
    }

    // loginCustomerId is REQUIRED for MCC (Manager Account) access to sub-accounts
    if (!loginCustomerId) {
      console.error('[GoogleAdsClient] login_customer_id is required for MCC access but was not found in GlobalSecrets');
      throw new Error('login_customer_id is required for MCC access. Please configure it in GlobalSecrets under google-ads/login_customer_id');
    }

    return {
      developerToken,
      clientId,
      clientSecret,
      refreshToken,
      loginCustomerId,
    };
  } catch (error) {
    console.error('[GoogleAdsClient] Error fetching Google Ads credentials:', error);
    throw error;
  }
}

/**
 * Initialize the Google Ads API instance
 * Uses singleton pattern with mutex to prevent race conditions
 * Credentials are global (MCC approach)
 */
export async function initializeGoogleAdsApi(): Promise<GoogleAdsApi> {
  // Fast path: already initialized
  if (googleAdsApiInstance && globalRefreshToken) {
    return googleAdsApiInstance;
  }

  // Mutex pattern: if initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization and store the promise (mutex)
  // FIX: Don't clear initializationPromise inside the async IIFE to prevent race condition
  const initPromise = (async () => {
    try {
      // Double-check after acquiring "lock"
      if (googleAdsApiInstance && globalRefreshToken) {
        return googleAdsApiInstance;
      }

      const credentials = await getGoogleAdsCredentials();
      if (!credentials) {
        throw new Error('Google Ads credentials not found in GlobalSecrets');
      }

      googleAdsApiInstance = new GoogleAdsApi({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        developer_token: credentials.developerToken,
      });

      globalRefreshToken = credentials.refreshToken;
      globalLoginCustomerId = credentials.loginCustomerId;

      console.log('[GoogleAdsClient] Google Ads API initialized with global credentials');
      console.log(`[GoogleAdsClient] Login Customer ID (MCC): ${globalLoginCustomerId}`);

      return googleAdsApiInstance;
    } catch (error) {
      throw error;
    }
  })();

  initializationPromise = initPromise;

  try {
    const result = await initPromise;
    return result;
  } finally {
    // Clear mutex AFTER the promise resolves/rejects, not inside the async IIFE
    // This prevents race conditions where concurrent callers could start new initialization
    initializationPromise = null;
  }
}

// ========================================
// CLIENT FACTORY
// ========================================

/**
 * Get a Google Ads customer client for a specific customer ID
 * Uses global refresh token (MCC approach - all accounts under one manager)
 * 
 * @param customerId - The Google Ads customer ID (e.g., "1234567890" or "123-456-7890")
 * @returns Customer instance
 */
export async function getGoogleAdsClient(customerId: string): Promise<Customer> {
  const api = await initializeGoogleAdsApi();

  if (!globalRefreshToken) {
    throw new Error('Global refresh token not initialized');
  }

  // When accessing accounts under an MCC, include login_customer_id
  const customerConfig: any = {
    customer_id: customerId.replace(/-/g, ''), // Remove dashes from customer ID
    refresh_token: globalRefreshToken,
  };

  // Add login_customer_id for MCC access (required when accessing sub-accounts)
  if (globalLoginCustomerId) {
    customerConfig.login_customer_id = globalLoginCustomerId.replace(/-/g, '');
  }

  return api.Customer(customerConfig);
}

// ========================================
// CLINIC TO CUSTOMER ID MAPPING
// ========================================

/**
 * Get Google Ads customer ID for a clinic from ClinicConfig
 */
export async function getCustomerIdForClinic(clinicId: string): Promise<string | null> {
  const { getClinicConfig } = await import('./secrets-helper');
  const config = await getClinicConfig(clinicId);

  if (!config) {
    console.warn(`[GoogleAdsClient] Clinic config not found: ${clinicId}`);
    return null;
  }

  // Get customerId from googleAds config section
  const googleAdsConfig = (config as any).googleAds;
  if (googleAdsConfig?.enabled && googleAdsConfig?.customerId) {
    return googleAdsConfig.customerId;
  }

  console.warn(`[GoogleAdsClient] No Google Ads customer ID for clinic: ${clinicId}`);
  return null;
}

/**
 * Extract domain from a URL (e.g., "https://example.com/path" -> "example.com")
 */
function extractDomainFromUrl(url: string): string {
  if (!url) return '';
  try {
    // Handle URLs with or without protocol
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(urlWithProtocol);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    // Fallback: simple extraction
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * Get all clinics with their Google Ads customer IDs and all placeholder fields
 * Used for bulk operations and clinic selection
 */
export async function getAllClinicsWithGoogleAdsStatus(): Promise<ClinicGoogleAdsMapping[]> {
  const configs = await getAllClinicConfigs();

  return configs.map(config => {
    // Get customerId from googleAds config section
    const googleAdsConfig = (config as any).googleAds;
    const customerId = googleAdsConfig?.customerId || '';
    const hasGoogleAds = googleAdsConfig?.enabled && !!customerId;

    // Extract domain from websiteLink for URL templates
    const domain = extractDomainFromUrl(config.websiteLink);

    return {
      clinicId: config.clinicId,
      clinicName: config.clinicName,
      clinicCity: config.clinicCity,
      clinicState: config.clinicState,
      clinicAddress: config.clinicAddress || '',
      clinicZipCode: config.clinicZipCode || '',
      clinicPhone: config.clinicPhone || config.phoneNumber || '',
      clinicEmail: config.clinicEmail || '',
      websiteLink: config.websiteLink || '',
      logoUrl: config.logoUrl || '',
      mapsUrl: config.mapsUrl || '',
      scheduleUrl: config.scheduleUrl || '',
      domain,
      customerId,
      hasGoogleAds,
    };
  });
}

/**
 * Get clinics that have Google Ads configured (have a customer ID mapping)
 */
export async function getClinicsWithGoogleAds(): Promise<ClinicGoogleAdsMapping[]> {
  const allClinics = await getAllClinicsWithGoogleAdsStatus();
  return allClinics.filter(clinic => clinic.hasGoogleAds);
}

// ========================================
// QUERY HELPERS
// ========================================

// Regex patterns for validating Google Ads resource names
export const RESOURCE_NAME_PATTERNS = {
  campaign: /^customers\/\d+\/campaigns\/\d+$/,
  adGroup: /^customers\/\d+\/adGroups\/\d+$/,
  // Note: adGroupCriteria uses plural form in resource names per Google Ads API spec
  adGroupCriterion: /^customers\/\d+\/adGroupCriteria\/\d+~\d+$/,
  budget: /^customers\/\d+\/campaignBudgets\/\d+$/,
};

// Supported campaign types and their corresponding ad group types
export const CAMPAIGN_TYPE_TO_AD_GROUP_TYPE: Record<string, string> = {
  SEARCH: 'SEARCH_STANDARD',
  DISPLAY: 'DISPLAY_STANDARD',
  VIDEO: 'VIDEO_TRUE_VIEW_IN_STREAM', // Default VIDEO ad group type
};

// Valid campaign types
export const VALID_CAMPAIGN_TYPES = ['SEARCH', 'DISPLAY', 'VIDEO'] as const;
export type CampaignType = typeof VALID_CAMPAIGN_TYPES[number];

/**
 * Execute a GAQL query against Google Ads API with pagination support
 * @param customerId - The Google Ads customer ID
 * @param query - GAQL query string
 * @param options - Query options including pagination
 * @returns Query results
 * 
 * NOTE: Google Ads API v22+ has fixed page size of 10,000 rows.
 * Setting page_size is no longer supported.
 */
export async function executeGoogleAdsQuery(
  customerId: string,
  query: string,
  options: { maxResults?: number } = {}
): Promise<any[]> {
  const client = await getGoogleAdsClient(customerId);
  const { maxResults = 100000 } = options;

  try {
    const allResults: any[] = [];
    let pageToken: string | undefined;

    do {
      // NOTE: Google Ads API v22+ does not support page_size parameter
      // Fixed page size of 10,000 rows is used automatically
      const queryOptions: any = {};
      if (pageToken) {
        queryOptions.page_token = pageToken;
      }

      const response: any = await client.query(query, Object.keys(queryOptions).length > 0 ? queryOptions : undefined);

      if (Array.isArray(response)) {
        allResults.push(...response);
        break; // Array responses don't have pagination
      } else if (response?.results) {
        allResults.push(...response.results);
        pageToken = response.next_page_token;
      } else {
        // Single page or empty response
        break;
      }

      // Prevent runaway queries
      if (allResults.length >= maxResults) {
        console.warn(`[GoogleAdsClient] Query hit maxResults limit (${maxResults})`);
        break;
      }
    } while (pageToken);

    return allResults;
  } catch (error: any) {
    console.error(`[GoogleAdsClient] Query error for customer ${customerId}:`, error.message);
    throw error;
  }
}

// ========================================
// COMMON QUERIES
// ========================================

/**
 * Get all campaigns for a customer ID
 */
export async function getCampaigns(customerId: string): Promise<any[]> {
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
      metrics.conversions
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.name
  `;

  return executeGoogleAdsQuery(customerId, query);
}

/**
 * Get all ad groups for a campaign
 */
export async function getAdGroups(customerId: string, campaignResourceName: string): Promise<any[]> {
  // Validate resource name format to prevent GAQL injection
  if (!validateResourceName(campaignResourceName, RESOURCE_NAME_PATTERNS.campaign)) {
    throw new Error(`Invalid campaign resource name format: ${campaignResourceName}`);
  }

  const sanitizedResourceName = sanitizeGaqlValue(campaignResourceName);
  const query = `
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      ad_group.resource_name
    FROM ad_group
    WHERE ad_group.campaign = '${sanitizedResourceName}'
      AND ad_group.status != 'REMOVED'
    ORDER BY ad_group.name
  `;

  return executeGoogleAdsQuery(customerId, query);
}

/**
 * Get keywords for an ad group
 */
export async function getKeywords(customerId: string, adGroupResourceName: string): Promise<any[]> {
  // Validate resource name format to prevent GAQL injection
  if (!validateResourceName(adGroupResourceName, RESOURCE_NAME_PATTERNS.adGroup)) {
    throw new Error(`Invalid ad group resource name format: ${adGroupResourceName}`);
  }

  const sanitizedResourceName = sanitizeGaqlValue(adGroupResourceName);
  const query = `
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group_criterion.ad_group = '${sanitizedResourceName}'
      AND ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
  `;

  return executeGoogleAdsQuery(customerId, query);
}

/**
 * Validate date format (YYYY-MM-DD)
 */
function validateDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Get search query performance report
 */
export async function getSearchQueryReport(
  customerId: string,
  startDate: string,
  endDate: string,
  limit: number = 10000
): Promise<any[]> {
  // Validate date formats to prevent GAQL injection
  if (!validateDateFormat(startDate) || !validateDateFormat(endDate)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD');
  }

  const query = `
    SELECT
      search_term_view.search_term,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND metrics.impressions > 0
    ORDER BY metrics.impressions DESC
    LIMIT ${limit}
  `;

  return executeGoogleAdsQuery(customerId, query);
}

// ========================================
// MUTATION HELPERS
// ========================================

/**
 * Add keywords to an ad group
 * 
 * NOTE: The google-ads-api library's create() method expects an array of
 * resource objects directly (IAdGroupCriterion), NOT wrapped in operation
 * objects like { create: { ... } }. The library handles operation types internally.
 */
export async function addKeywords(
  customerId: string,
  adGroupResourceName: string,
  keywords: Array<{ text: string; matchType: string }>
): Promise<any> {
  console.log(`[GoogleAdsClient] addKeywords called with customerId=${customerId}, adGroup=${adGroupResourceName}, keywordCount=${keywords.length}`);

  try {
    const client = await getGoogleAdsClient(customerId);

    // The library's create() expects resource objects directly, not operation wrappers
    const resources = keywords.map(kw => ({
      ad_group: adGroupResourceName,
      status: 'ENABLED',
      keyword: {
        text: kw.text.trim(),
        match_type: kw.matchType,
      },
    }));

    console.log(`[GoogleAdsClient] Creating ${resources.length} keywords`);
    console.log('[GoogleAdsClient] Resources:', JSON.stringify(resources, null, 2));

    const result = await (client as any).adGroupCriteria.create(resources);

    console.log('[GoogleAdsClient] Successfully created keywords:', JSON.stringify(result, null, 2));
    return result;
  } catch (error: any) {
    console.error('[GoogleAdsClient] Error adding keywords:', error);
    console.error('[GoogleAdsClient] Error details:', JSON.stringify({
      message: error.message,
      code: error.code,
      errors: error.errors,
      details: error.details,
    }, null, 2));

    // Re-throw with more context
    throw error;
  }
}

/**
 * Remove keywords by resource names
 * 
 * NOTE: The library's remove() expects an array of resource name strings directly.
 */
export async function removeKeywords(
  customerId: string,
  keywordResourceNames: string[]
): Promise<any> {
  const client = await getGoogleAdsClient(customerId);

  // The library's remove() expects resource names directly as strings
  return (client as any).adGroupCriteria.remove(keywordResourceNames);
}

/**
 * Add negative keywords to an ad group
 * 
 * NOTE: The google-ads-api library's create() method expects an array of
 * resource objects directly (IAdGroupCriterion), NOT wrapped in operation
 * objects like { create: { ... } }. The library handles operation types internally.
 */
export async function addNegativeKeywords(
  customerId: string,
  adGroupResourceName: string,
  keywords: Array<{ text: string; matchType?: string }>
): Promise<any> {
  const client = await getGoogleAdsClient(customerId);

  // The library's create() expects resource objects directly, not operation wrappers
  const resources = keywords.map(kw => ({
    ad_group: adGroupResourceName,
    negative: true,
    keyword: {
      text: kw.text.trim(),
      match_type: kw.matchType || 'BROAD',
    },
  }));

  return (client as any).adGroupCriteria.create(resources);
}

/**
 * Add radius targeting (proximity) to a campaign
 * Uses Google Ads Proximity criterion for radius-based geotargeting
 */
export async function addRadiusTarget(
  customerId: string,
  campaignResourceName: string,
  options: {
    latitude: number;
    longitude: number;
    radius: number;
    units: 'MILES' | 'KILOMETERS';
    bidModifier?: number;
  }
): Promise<any> {
  // Validate resource name format
  if (!validateResourceName(campaignResourceName, RESOURCE_NAME_PATTERNS.campaign)) {
    throw new Error(`Invalid campaign resource name format: ${campaignResourceName}`);
  }

  const client = await getGoogleAdsClient(customerId);

  // NOTE: The google-ads-api library's create() method expects an array of
  // resource objects directly (ICampaignCriterion), NOT wrapped in operation
  // objects like { create: { ... } }. The library handles operation types internally.
  const resource = {
    campaign: campaignResourceName,
    proximity: {
      geo_point: {
        latitude_in_micro_degrees: Math.round(options.latitude * 1000000),
        longitude_in_micro_degrees: Math.round(options.longitude * 1000000),
      },
      radius: options.radius,
      radius_units: options.units,
    },
    bid_modifier: options.bidModifier || 1.0,
  };

  console.log(`[GoogleAdsClient] Adding radius target: ${options.radius} ${options.units} around (${options.latitude}, ${options.longitude})`);
  console.log('[GoogleAdsClient] Radius resource:', JSON.stringify(resource, null, 2));

  return (client as any).campaignCriteria.create([resource]);
}

/**
 * Add location targets to a campaign using geo target constants
 */
export async function addLocationTargets(
  customerId: string,
  campaignResourceName: string,
  locations: Array<{
    geoTargetConstant: string; // e.g., 'geoTargetConstants/1014044'
  }>,
  options?: {
    negative?: boolean;
  }
): Promise<any> {
  // Validate resource name format
  if (!validateResourceName(campaignResourceName, RESOURCE_NAME_PATTERNS.campaign)) {
    throw new Error(`Invalid campaign resource name format: ${campaignResourceName}`);
  }

  const client = await getGoogleAdsClient(customerId);

  // NOTE: The google-ads-api library's create() method expects an array of
  // resource objects directly (ICampaignCriterion), NOT wrapped in operation
  // objects like { create: { ... } }. The library handles operation types internally.
  const resources = locations.map(loc => ({
    campaign: campaignResourceName,
    location: {
      geo_target_constant: loc.geoTargetConstant,
    },
    negative: options?.negative || false,
  }));

  console.log(`[GoogleAdsClient] Adding ${locations.length} location targets to campaign`);
  console.log('[GoogleAdsClient] Location resources:', JSON.stringify(resources, null, 2));

  return (client as any).campaignCriteria.create(resources);
}

/**
 * Remove a campaign criterion (location, radius, device, etc.)
 */
export async function removeCampaignCriterion(
  customerId: string,
  criterionResourceName: string
): Promise<any> {
  const client = await getGoogleAdsClient(customerId);

  // The library's remove() expects resource name strings directly
  return (client as any).campaignCriteria.remove([criterionResourceName]);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Convert cost in micros to dollars
 */
export function microsToDollars(micros: number): number {
  return micros / 1000000;
}

/**
 * Convert dollars to micros
 */
export function dollarsToMicros(dollars: number): number {
  return Math.round(dollars * 1000000);
}

/**
 * Format customer ID with dashes (xxx-xxx-xxxx)
 */
export function formatCustomerId(customerId: string): string {
  const cleaned = customerId.replace(/\D/g, '');
  if (cleaned.length !== 10) return customerId;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
}

/**
 * Get the MCC/Manager Account login customer ID
 */
export async function getLoginCustomerId(): Promise<string> {
  await initializeGoogleAdsApi();
  return globalLoginCustomerId || '';
}

/**
 * Clear the cached Google Ads API instance
 */
export function clearGoogleAdsApiCache(): void {
  googleAdsApiInstance = null;
  globalRefreshToken = null;
  globalLoginCustomerId = null;
  console.log('[GoogleAdsClient] API cache cleared');
}

// ========================================
// REST API CAMPAIGN CREATION (Bypass gRPC proto limitation)
// ========================================

/**
 * Get an OAuth2 access token for REST API calls.
 * Uses the same credentials as the gRPC client.
 */
async function getAccessToken(): Promise<string> {
  const credentials = await getGoogleAdsCredentials();
  if (!credentials) {
    throw new Error('Google Ads credentials not found');
  }

  // Exchange refresh token for access token using Google's token endpoint
  const https = await import('https');
  const querystring = await import('querystring');

  const postData = querystring.stringify({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            reject(new Error(`Failed to get access token: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Make a REST API call to Google Ads API v22.
 * Bypasses the gRPC protobuf serialization which silently drops
 * fields not in its proto definitions (e.g. contains_eu_political_advertising).
 */
async function googleAdsRestCall(
  customerId: string,
  endpoint: string,
  body: any
): Promise<any> {
  const credentials = await getGoogleAdsCredentials();
  if (!credentials) {
    throw new Error('Google Ads credentials not found');
  }

  const accessToken = await getAccessToken();
  const https = await import('https');

  const cleanCustomerId = customerId.replace(/-/g, '');
  const postData = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'googleads.googleapis.com',
      path: `/v22/customers/${cleanCustomerId}/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': credentials.developerToken,
        'login-customer-id': credentials.loginCustomerId.replace(/-/g, ''),
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            // Extract detailed error messages from Google Ads API error response
            const errors = parsed?.error?.details
              ?.filter((d: any) => d.errors)
              ?.flatMap((d: any) => d.errors)
              ?.map((e: any) => `${e.message} (field: ${e.location?.fieldPathElements?.map((f: any) => f.fieldName).join('.')})`)
              ?.join('; ');

            const errorMessage = errors || parsed?.error?.message || JSON.stringify(parsed);
            const error: any = new Error(errorMessage);
            error.statusCode = res.statusCode;
            error.details = parsed;
            reject(error);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response (status ${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Create a campaign budget via REST API.
 * Returns the budget resource name.
 */
export async function createBudgetViaRest(
  customerId: string,
  budgetResource: {
    name: string;
    amount_micros: number;
    delivery_method: number;
    explicitly_shared?: boolean;
  }
): Promise<string> {
  const cleanCustomerId = customerId.replace(/-/g, '');

  // Map numeric enum to string enum for REST API
  const deliveryMethodMap: Record<number, string> = {
    2: 'STANDARD',
    3: 'ACCELERATED',
  };

  const body = {
    operations: [{
      create: {
        name: budgetResource.name,
        amountMicros: String(budgetResource.amount_micros),
        deliveryMethod: deliveryMethodMap[budgetResource.delivery_method] || 'STANDARD',
        explicitlyShared: budgetResource.explicitly_shared ?? false,
      },
    }],
  };

  console.log(`[GoogleAdsClient] Creating budget via REST for ${cleanCustomerId}:`, JSON.stringify(body, null, 2));

  const response = await googleAdsRestCall(cleanCustomerId, 'campaignBudgets:mutate', body);

  const budgetResourceName = response?.results?.[0]?.resourceName;
  if (!budgetResourceName) {
    throw new Error(`Budget creation returned no resource name: ${JSON.stringify(response)}`);
  }

  console.log(`[GoogleAdsClient] Budget created via REST: ${budgetResourceName}`);
  return budgetResourceName;
}

/**
 * Create a campaign via REST API.
 * This bypasses the gRPC library's protobuf serialization which silently
 * drops the `contains_eu_political_advertising` field.
 * Returns the campaign resource name.
 */
export async function createCampaignViaRest(
  customerId: string,
  campaignResource: {
    name: string;
    status: number;
    advertisingChannelType: number;
    campaignBudget: string;
    biddingStrategy: string;
    targetCpaMicros?: number;
    targetRoas?: number;
    networkSettings?: {
      targetGoogleSearch?: boolean;
      targetSearchNetwork?: boolean;
    };
  }
): Promise<string> {
  const cleanCustomerId = customerId.replace(/-/g, '');

  // Map numeric enums to string enums for REST API
  const statusMap: Record<number, string> = {
    2: 'ENABLED',
    3: 'PAUSED',
    4: 'REMOVED',
  };
  const channelTypeMap: Record<number, string> = {
    2: 'SEARCH',
    3: 'DISPLAY',
    4: 'SHOPPING',
    6: 'VIDEO',
    13: 'PERFORMANCE_MAX',
  };

  // Build REST campaign object
  const campaign: any = {
    name: campaignResource.name,
    status: statusMap[campaignResource.status] || 'PAUSED',
    advertisingChannelType: channelTypeMap[campaignResource.advertisingChannelType] || 'SEARCH',
    campaignBudget: campaignResource.campaignBudget,
    // CRITICAL: This field is REQUIRED since Google Ads API v22 (Sept 3, 2025)
    // The gRPC library silently drops this because its protobuf defs are outdated
    containsEuPoliticalAdvertising: false,
  };

  // Add network settings
  if (campaignResource.networkSettings) {
    campaign.networkSettings = {
      targetGoogleSearch: campaignResource.networkSettings.targetGoogleSearch ?? true,
      targetSearchNetwork: campaignResource.networkSettings.targetSearchNetwork ?? true,
    };
  }

  // Build bidding strategy
  // NOTE: Enhanced CPC (enhanced_cpc_enabled) is DEPRECATED by Google (context_error: 2)
  // Use manual_cpc without it — REST API handles empty message types correctly
  switch (campaignResource.biddingStrategy) {
    case 'MANUAL_CPC':
      campaign.manualCpc = {};
      break;
    case 'TARGET_CPA':
      campaign.targetCpa = {
        targetCpaMicros: String(campaignResource.targetCpaMicros || 0),
      };
      break;
    case 'MAXIMIZE_CONVERSIONS':
      campaign.maximizeConversions = {};
      break;
    case 'MAXIMIZE_CLICKS':
      campaign.maximizeClicks = {};
      break;
    case 'TARGET_ROAS':
      campaign.targetRoas = {
        targetRoas: campaignResource.targetRoas || 0,
      };
      break;
  }

  const body = {
    operations: [{
      create: campaign,
    }],
  };

  console.log(`[GoogleAdsClient] Creating campaign via REST for ${cleanCustomerId}:`, JSON.stringify(body, null, 2));

  const response = await googleAdsRestCall(cleanCustomerId, 'campaigns:mutate', body);

  const campaignResourceName = response?.results?.[0]?.resourceName;
  if (!campaignResourceName) {
    throw new Error(`Campaign creation returned no resource name: ${JSON.stringify(response)}`);
  }

  console.log(`[GoogleAdsClient] Campaign created via REST: ${campaignResourceName}`);
  return campaignResourceName;
}

/**
 * Remove a campaign budget via REST API (for cleanup on failure).
 */
export async function removeBudgetViaRest(
  customerId: string,
  budgetResourceName: string
): Promise<void> {
  const cleanCustomerId = customerId.replace(/-/g, '');

  const body = {
    operations: [{
      remove: budgetResourceName,
    }],
  };

  try {
    await googleAdsRestCall(cleanCustomerId, 'campaignBudgets:mutate', body);
    console.log(`[GoogleAdsClient] Cleaned up budget via REST: ${budgetResourceName}`);
  } catch (error: any) {
    console.error(`[GoogleAdsClient] Failed to cleanup budget ${budgetResourceName}: ${error.message}`);
  }
}

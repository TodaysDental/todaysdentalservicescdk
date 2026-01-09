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
  customerId: string;
  hasGoogleAds: boolean;
}

// Cache for the Google Ads API instance
let googleAdsApiInstance: GoogleAdsApi | null = null;
let globalRefreshToken: string | null = null;
let globalLoginCustomerId: string | null = null;

// ========================================
// GOOGLE ADS API INITIALIZATION
// ========================================

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

    return { 
      developerToken, 
      clientId, 
      clientSecret, 
      refreshToken,
      loginCustomerId: loginCustomerId || '',
    };
  } catch (error) {
    console.error('[GoogleAdsClient] Error fetching Google Ads credentials:', error);
    throw error;
  }
}

/**
 * Initialize the Google Ads API instance
 * Uses singleton pattern - credentials are global (MCC approach)
 */
export async function initializeGoogleAdsApi(): Promise<GoogleAdsApi> {
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
 * Get all clinics with their Google Ads customer IDs
 * Used for bulk operations and clinic selection
 */
export async function getAllClinicsWithGoogleAdsStatus(): Promise<ClinicGoogleAdsMapping[]> {
  const configs = await getAllClinicConfigs();

  return configs.map(config => {
    // Get customerId from googleAds config section
    const googleAdsConfig = (config as any).googleAds;
    const customerId = googleAdsConfig?.customerId || '';
    const hasGoogleAds = googleAdsConfig?.enabled && !!customerId;
    
    return {
      clinicId: config.clinicId,
      clinicName: config.clinicName,
      clinicCity: config.clinicCity,
      clinicState: config.clinicState,
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

/**
 * Execute a GAQL query against Google Ads API
 * @param customerId - The Google Ads customer ID
 * @param query - GAQL query string
 * @returns Query results
 */
export async function executeGoogleAdsQuery(customerId: string, query: string): Promise<any[]> {
  const client = await getGoogleAdsClient(customerId);
  
  try {
    const results = await client.query(query);
    return results;
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
  const query = `
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      ad_group.resource_name
    FROM ad_group
    WHERE ad_group.campaign = '${campaignResourceName}'
      AND ad_group.status != 'REMOVED'
    ORDER BY ad_group.name
  `;

  return executeGoogleAdsQuery(customerId, query);
}

/**
 * Get keywords for an ad group
 */
export async function getKeywords(customerId: string, adGroupResourceName: string): Promise<any[]> {
  const query = `
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status
    FROM ad_group_criterion
    WHERE ad_group_criterion.ad_group = '${adGroupResourceName}'
      AND ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
  `;

  return executeGoogleAdsQuery(customerId, query);
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
 */
export async function addKeywords(
  customerId: string,
  adGroupResourceName: string,
  keywords: Array<{ text: string; matchType: string }>
): Promise<any> {
  const client = await getGoogleAdsClient(customerId);
  
  const operations = keywords.map(kw => ({
    create: {
      ad_group: adGroupResourceName,
      status: 'ENABLED',
      keyword: {
        text: kw.text.trim(),
        match_type: kw.matchType,
      },
    },
  }));

  return (client as any).adGroupCriteria.create(operations);
}

/**
 * Remove keywords by resource names
 */
export async function removeKeywords(
  customerId: string,
  keywordResourceNames: string[]
): Promise<any> {
  const client = await getGoogleAdsClient(customerId);
  
  const operations = keywordResourceNames.map(resourceName => ({
    remove: resourceName,
  }));

  return (client as any).adGroupCriteria.remove(operations);
}

/**
 * Add negative keywords to an ad group
 */
export async function addNegativeKeywords(
  customerId: string,
  adGroupResourceName: string,
  keywords: Array<{ text: string; matchType?: string }>
): Promise<any> {
  const client = await getGoogleAdsClient(customerId);
  
  const operations = keywords.map(kw => ({
    create: {
      ad_group: adGroupResourceName,
      negative: true,
      keyword: {
        text: kw.text.trim(),
        match_type: kw.matchType || 'BROAD',
      },
    },
  }));

  return (client as any).adGroupCriteria.create(operations);
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

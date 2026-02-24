/**
 * Meta Ads Graph API Client
 *
 * Shared utility for calling the Meta Marketing API v21.
 * Credentials are stored in GlobalSecrets DynamoDB table:
 *   - secretId: 'meta_ads', secretType: 'access_token'
 *   - secretId: 'meta_ads', secretType: 'app_id'
 *   - secretId: 'meta_ads', secretType: 'app_secret'
 *
 * Usage:
 *   import { getMetaAdsCredentials, metaGraphGet, metaGraphPost } from '../../shared/utils/meta-ads-client';
 *   const creds = await getMetaAdsCredentials();
 *   const campaigns = await metaGraphGet(`act_${adAccountId}/campaigns`, { fields: 'name,status' }, creds.accessToken);
 */

import { getGlobalSecret } from './secrets-helper';

// ============================================
// CONSTANTS
// ============================================

const META_GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ============================================
// TYPES
// ============================================

export interface MetaAdsCredentials {
    accessToken: string;
    appId: string;
    appSecret: string;
}

export interface MetaGraphResponse<T = any> {
    data?: T;
    paging?: {
        cursors?: { before: string; after: string };
        next?: string;
        previous?: string;
    };
    error?: MetaGraphError;
}

export interface MetaGraphError {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
}

// ============================================
// CREDENTIALS
// ============================================

let cachedCredentials: MetaAdsCredentials | null = null;
let credentialsCacheExpiry = 0;
const CREDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get Meta Ads credentials from GlobalSecrets table.
 * Results are cached in-memory for 5 minutes.
 */
export async function getMetaAdsCredentials(): Promise<MetaAdsCredentials> {
    if (cachedCredentials && Date.now() < credentialsCacheExpiry) {
        return cachedCredentials;
    }

    const [accessToken, appId, appSecret] = await Promise.all([
        getGlobalSecret('meta_ads', 'access_token'),
        getGlobalSecret('meta_ads', 'app_id'),
        getGlobalSecret('meta_ads', 'app_secret'),
    ]);

    if (!accessToken) {
        throw new Error('Meta Ads access_token not found in GlobalSecrets. Please add secretId=meta_ads, secretType=access_token.');
    }
    if (!appId) {
        throw new Error('Meta Ads app_id not found in GlobalSecrets.');
    }
    if (!appSecret) {
        throw new Error('Meta Ads app_secret not found in GlobalSecrets.');
    }

    cachedCredentials = { accessToken, appId, appSecret };
    credentialsCacheExpiry = Date.now() + CREDS_CACHE_TTL;
    return cachedCredentials;
}

/**
 * Clear the cached credentials (useful after token refresh)
 */
export function clearMetaAdsCredentialsCache(): void {
    cachedCredentials = null;
    credentialsCacheExpiry = 0;
}

// ============================================
// GRAPH API CALLERS
// ============================================

/**
 * Make a GET request to the Meta Graph API.
 */
export async function metaGraphGet<T = any>(
    endpoint: string,
    params: Record<string, any> = {},
    accessToken: string
): Promise<MetaGraphResponse<T>> {
    const url = new URL(`${META_GRAPH_BASE_URL}/${endpoint}`);
    url.searchParams.set('access_token', accessToken);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    }

    return metaFetchWithRetry<T>(url.toString(), { method: 'GET' });
}

/**
 * Make a POST request to the Meta Graph API (JSON body).
 */
export async function metaGraphPost<T = any>(
    endpoint: string,
    body: Record<string, any>,
    accessToken: string
): Promise<MetaGraphResponse<T>> {
    const url = `${META_GRAPH_BASE_URL}/${endpoint}`;

    // For Meta Graph API, POST params are sent as form-urlencoded
    const formBody = new URLSearchParams();
    formBody.set('access_token', accessToken);
    for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) {
            formBody.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
    }

    return metaFetchWithRetry<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
    });
}

/**
 * Make a DELETE request to the Meta Graph API.
 */
export async function metaGraphDelete<T = any>(
    endpoint: string,
    accessToken: string
): Promise<MetaGraphResponse<T>> {
    const url = new URL(`${META_GRAPH_BASE_URL}/${endpoint}`);
    url.searchParams.set('access_token', accessToken);

    return metaFetchWithRetry<T>(url.toString(), { method: 'DELETE' });
}

// ============================================
// INTERNAL FETCH WITH RETRY
// ============================================

async function metaFetchWithRetry<T>(
    url: string,
    options: RequestInit,
    attempt = 0
): Promise<MetaGraphResponse<T>> {
    try {
        const response = await fetch(url, options);
        const json = await response.json() as MetaGraphResponse<T>;

        // Handle rate limiting (HTTP 429) or throttling (error code 32)
        if (
            (response.status === 429 || json.error?.code === 32) &&
            attempt < MAX_RETRIES
        ) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
            console.warn(`[MetaAds] Rate limited. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(delay);
            return metaFetchWithRetry<T>(url, options, attempt + 1);
        }

        if (json.error) {
            console.error(`[MetaAds] Graph API error:`, json.error);
            throw new MetaApiError(
                json.error.message,
                json.error.code,
                json.error.type,
                json.error.error_subcode,
                response.status
            );
        }

        return json;
    } catch (error) {
        if (error instanceof MetaApiError) throw error;
        console.error(`[MetaAds] Network error:`, error);
        throw new MetaApiError(
            `Network error calling Meta API: ${(error as Error).message}`,
            -1,
            'NetworkError',
            undefined,
            500
        );
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// ERROR CLASS
// ============================================

export class MetaApiError extends Error {
    public readonly code: number;
    public readonly type: string;
    public readonly subcode?: number;
    public readonly httpStatus: number;

    constructor(
        message: string,
        code: number,
        type: string,
        subcode?: number,
        httpStatus = 400
    ) {
        super(message);
        this.name = 'MetaApiError';
        this.code = code;
        this.type = type;
        this.subcode = subcode;
        this.httpStatus = httpStatus;
    }
}

// ============================================
// RESPONSE BUILDERS
// ============================================

/**
 * Build a standard success response for the frontend.
 * Matches the MetaApiResponse<T> envelope: { success, data, message? }
 */
export function metaSuccess<T>(data: T, statusCode = 200, corsHeaders: Record<string, string>) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, data }),
    };
}

/**
 * Build a standard paginated response for the frontend.
 * Matches MetaPaginatedResponse<T>: { success, data[], paging?, total_count? }
 */
export function metaPaginatedSuccess<T>(
    data: T[],
    paging?: MetaGraphResponse['paging'],
    totalCount?: number,
    corsHeaders: Record<string, string> = {}
) {
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            data,
            paging: paging || undefined,
            total_count: totalCount,
        }),
    };
}

/**
 * Build a standard error response.
 */
export function metaError(
    message: string,
    statusCode = 500,
    corsHeaders: Record<string, string> = {}
) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: message }),
    };
}

// ============================================
// COMMON FIELDS CONSTANTS
// ============================================

/** Default fields requested when fetching campaigns */
export const CAMPAIGN_FIELDS = [
    'id', 'account_id', 'name', 'objective', 'status', 'effective_status',
    'special_ad_categories', 'buying_type', 'bid_strategy',
    'daily_budget', 'lifetime_budget', 'budget_remaining', 'spend_cap',
    'start_time', 'stop_time', 'created_time', 'updated_time',
].join(',');

/** Default fields requested when fetching ad sets */
export const AD_SET_FIELDS = [
    'id', 'account_id', 'campaign_id', 'name', 'status', 'effective_status',
    'daily_budget', 'lifetime_budget', 'budget_remaining',
    'optimization_goal', 'billing_event', 'bid_amount', 'bid_strategy',
    'targeting', 'promoted_object', 'start_time', 'end_time',
    'created_time', 'updated_time',
].join(',');

/** Default fields requested when fetching ad creatives */
export const AD_CREATIVE_FIELDS = [
    'id', 'account_id', 'name', 'status',
    'object_story_spec', 'thumbnail_url', 'image_url', 'image_hash',
    'video_id', 'body', 'title', 'link_url', 'call_to_action_type',
    'effective_object_story_id', 'created_time',
].join(',');

/** Default fields requested when fetching ads */
export const AD_FIELDS = [
    'id', 'account_id', 'adset_id', 'campaign_id', 'name',
    'status', 'effective_status', 'creative{id}',
    'tracking_specs', 'conversion_specs',
    'created_time', 'updated_time',
].join(',');

/** Default insight fields */
export const INSIGHT_FIELDS = [
    'impressions', 'reach', 'frequency', 'clicks', 'unique_clicks',
    'ctr', 'unique_ctr', 'cpc', 'cpm', 'cpp', 'spend',
    'actions', 'cost_per_action_type', 'cost_per_unique_action_type',
    'conversions', 'cost_per_conversion',
    'video_avg_time_watched_actions',
    'video_p25_watched_actions', 'video_p50_watched_actions',
    'video_p75_watched_actions', 'video_p100_watched_actions',
    'date_start', 'date_stop',
].join(',');

/** Default fields for ad accounts */
export const AD_ACCOUNT_FIELDS = [
    'account_id', 'id', 'name', 'account_status', 'currency',
    'timezone_name', 'timezone_offset_hours_utc',
    'business_name', 'business_city', 'business_country_code',
    'amount_spent', 'balance', 'spend_cap', 'disable_reason', 'created_time',
].join(',');

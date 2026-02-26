/**
 * Meta Ads — Audiences, Interests, Leads & Pixels Lambda
 *
 * Endpoints:
 * - GET    /meta-ads/audiences                  - List custom audiences
 * - POST   /meta-ads/audiences                  - Create custom audience
 * - POST   /meta-ads/audiences/lookalike         - Create lookalike audience
 * - DELETE /meta-ads/audiences/{id}              - Delete audience
 * - GET    /meta-ads/interests/search            - Search targeting interests
 * - GET    /meta-ads/behaviors                   - Get behavior categories
 * - POST   /meta-ads/reach-estimate              - Get reach estimate
 * - GET    /meta-ads/pixels                      - List pixels
 * - GET    /meta-ads/pixels/{id}/events          - Get pixel events
 * - GET    /meta-ads/leads/forms/{pageId}        - List lead forms
 * - POST   /meta-ads/leads/forms                 - Create lead form
 * - GET    /meta-ads/leads/{formId}              - Get leads from form
 * - GET    /meta-ads/leads/ad/{adId}             - Get leads for ad
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
    getUserPermissions, hasModulePermission, PermissionType,
} from '../../shared/utils/permissions-helper';
import {
    getMetaAdsCredentials, metaGraphGet, metaGraphPost, metaGraphDelete,
    metaSuccess, metaPaginatedSuccess, metaError, MetaApiError,
} from '../../shared/utils/meta-ads-client';

const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
    GET: 'read', POST: 'write', DELETE: 'delete',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = await buildCorsHeadersAsync({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;
    const pathParts = path.split('/').filter(Boolean);

    console.log(`[MetaAds:Audiences] ${method} ${path}`);

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const userPerms = getUserPermissions(event);
    if (!userPerms) return metaError('Unauthorized', 401, corsHeaders);

    const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
    if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, requiredPermission, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
        return metaError('Access denied', 403, corsHeaders);
    }

    try {
        // --- Audiences ---
        if (path.endsWith('/audiences/lookalike') && method === 'POST') return await createLookalikeAudience(event, corsHeaders);
        if (path.endsWith('/audiences') && method === 'GET') return await listAudiences(event, corsHeaders);
        if (path.endsWith('/audiences') && method === 'POST') return await createAudience(event, corsHeaders);
        if (pathParts.includes('audiences') && pathParts.length > pathParts.indexOf('audiences') + 1 && method === 'DELETE') {
            return await deleteAudience(event, corsHeaders);
        }

        // --- Interests & Behaviors ---
        if (path.endsWith('/interests/search') && method === 'GET') return await searchInterests(event, corsHeaders);
        if (path.endsWith('/behaviors') && method === 'GET') return await getBehaviors(event, corsHeaders);

        // --- Reach Estimate ---
        if (path.endsWith('/reach-estimate') && method === 'POST') return await getReachEstimate(event, corsHeaders);

        // --- Pixels ---
        if (path.endsWith('/pixels') && method === 'GET') return await listPixels(event, corsHeaders);
        if (path.includes('/pixels/') && path.endsWith('/events') && method === 'GET') return await getPixelEvents(event, corsHeaders);

        // --- Leads ---
        if (path.endsWith('/leads/forms') && method === 'POST') return await createLeadForm(event, corsHeaders);
        if (pathParts.includes('leads') && pathParts.includes('forms') && pathParts.length > pathParts.indexOf('forms') + 1 && method === 'GET') {
            return await listLeadForms(event, corsHeaders);
        }
        if (pathParts.includes('leads') && pathParts.includes('ad') && method === 'GET') {
            return await getAdLeads(event, corsHeaders);
        }
        if (pathParts.includes('leads') && !pathParts.includes('forms') && !pathParts.includes('ad') && pathParts.length > pathParts.indexOf('leads') + 1 && method === 'GET') {
            return await getFormLeads(event, corsHeaders);
        }

        return metaError(`Route not found: ${method} ${path}`, 404, corsHeaders);
    } catch (err) {
        if (err instanceof MetaApiError) return metaError(err.message, err.httpStatus, corsHeaders);
        console.error('[MetaAds:Audiences] Error:', err);
        return metaError('Internal server error', 500, corsHeaders);
    }
}

// ============================================
// AUDIENCE HANDLERS
// ============================================

async function listAudiences(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const response = await metaGraphGet(`${actId}/customaudiences`, {
        fields: 'id,account_id,name,description,subtype,approximate_count,approximate_count_lower_bound,approximate_count_upper_bound,data_source,retention_days,delivery_status,operation_status,time_created,time_updated',
        limit: event.queryStringParameters?.limit || 50,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function createAudience(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, name, description, subtype, customer_file_source, retention_days, rule } = body;

    if (!ad_account_id || !name || !subtype) {
        return metaError('Missing required fields: ad_account_id, name, subtype', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const createBody: Record<string, any> = { name, subtype };
    if (description) createBody.description = description;
    if (customer_file_source) createBody.customer_file_source = customer_file_source;
    if (retention_days) createBody.retention_days = retention_days;
    if (rule) createBody.rule = rule;

    const response = await metaGraphPost(`${actId}/customaudiences`, createBody, creds.accessToken);
    return metaSuccess(response.data || response, 201, corsHeaders);
}

async function createLookalikeAudience(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, name, origin_audience_id, lookalike_spec } = body;

    if (!ad_account_id || !name || !origin_audience_id || !lookalike_spec) {
        return metaError('Missing required fields', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const response = await metaGraphPost(`${actId}/customaudiences`, {
        name,
        subtype: 'LOOKALIKE',
        origin_audience_id,
        lookalike_spec,
    }, creds.accessToken);

    return metaSuccess(response.data || response, 201, corsHeaders);
}

async function deleteAudience(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const audienceId = event.pathParameters?.id;
    if (!audienceId) return metaError('Missing audience ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    await metaGraphDelete(audienceId, creds.accessToken);
    return metaSuccess({ id: audienceId }, 200, corsHeaders);
}

// ============================================
// INTEREST & BEHAVIOR SEARCH
// ============================================

async function searchInterests(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const query = event.queryStringParameters?.q;
    if (!query) return metaError('Missing search query parameter "q"', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const type = event.queryStringParameters?.type || 'adinterest';

    const response = await metaGraphGet('search', {
        type,
        q: query,
        limit: event.queryStringParameters?.limit || 25,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function getBehaviors(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const creds = await getMetaAdsCredentials();

    const response = await metaGraphGet('search', {
        type: 'adTargetingCategory',
        class: 'behaviors',
        limit: event.queryStringParameters?.limit || 100,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

// ============================================
// REACH ESTIMATE
// ============================================

async function getReachEstimate(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, targeting } = body;

    if (!ad_account_id || !targeting) {
        return metaError('Missing ad_account_id and targeting', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const response = await metaGraphGet(`${actId}/reachestimate`, {
        targeting_spec: JSON.stringify(targeting),
    }, creds.accessToken);

    return metaSuccess(response.data || response, 200, corsHeaders);
}

// ============================================
// PIXEL HANDLERS
// ============================================

async function listPixels(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const response = await metaGraphGet(`${actId}/adspixels`, {
        fields: 'id,name,code,last_fired_time,creation_time,is_unavailable,data_use_setting,owner_ad_account',
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function getPixelEvents(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const pathParts = event.path.split('/').filter(Boolean);
    const pixelsIdx = pathParts.indexOf('pixels');
    const pixelId = pathParts[pixelsIdx + 1];
    if (!pixelId) return metaError('Missing pixel ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(pixelId, {
        fields: 'id,name,code,last_fired_time,creation_time,is_unavailable,data_use_setting',
    }, creds.accessToken);

    return metaSuccess(response, 200, corsHeaders);
}

// ============================================
// LEAD FORM HANDLERS
// ============================================

async function listLeadForms(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const pathParts = event.path.split('/').filter(Boolean);
    const formsIdx = pathParts.indexOf('forms');
    const pageId = pathParts[formsIdx + 1];
    if (!pageId) return metaError('Missing page ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(`${pageId}/leadgen_forms`, {
        fields: 'id,name,status,leads_count,locale,questions,privacy_policy,thank_you_page,context_card,created_time',
        limit: event.queryStringParameters?.limit || 25,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function createLeadForm(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { page_id, name, questions, privacy_policy, thank_you_page, context_card } = body;

    if (!page_id || !name || !questions || !privacy_policy) {
        return metaError('Missing required fields: page_id, name, questions, privacy_policy', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const createBody: Record<string, any> = { name, questions, privacy_policy };
    if (thank_you_page) createBody.thank_you_page = thank_you_page;
    if (context_card) createBody.context_card = context_card;

    const response = await metaGraphPost(`${page_id}/leadgen_forms`, createBody, creds.accessToken);
    return metaSuccess(response.data || response, 201, corsHeaders);
}

async function getFormLeads(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const pathParts = event.path.split('/').filter(Boolean);
    const leadsIdx = pathParts.indexOf('leads');
    const formId = pathParts[leadsIdx + 1];
    if (!formId) return metaError('Missing form ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(`${formId}/leads`, {
        fields: 'id,form_id,ad_id,adset_id,campaign_id,field_data,created_time,is_organic,platform',
        limit: event.queryStringParameters?.limit || 50,
        after: event.queryStringParameters?.after,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function getAdLeads(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const pathParts = event.path.split('/').filter(Boolean);
    const adIdx = pathParts.indexOf('ad');
    const adId = pathParts[adIdx + 1];
    if (!adId) return metaError('Missing ad ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(`${adId}/leads`, {
        fields: 'id,form_id,ad_id,adset_id,campaign_id,field_data,created_time,is_organic,platform',
        limit: event.queryStringParameters?.limit || 50,
        after: event.queryStringParameters?.after,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

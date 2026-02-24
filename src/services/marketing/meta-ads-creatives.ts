/**
 * Meta Ads — Ad Creative & Ad Management Lambda
 *
 * Endpoints:
 * - GET    /meta-ads/creatives          - List ad creatives
 * - POST   /meta-ads/creatives          - Create ad creative
 * - GET    /meta-ads/creatives/{id}     - Get creative
 * - PUT    /meta-ads/creatives/{id}     - Update creative
 * - GET    /meta-ads/ads                - List ads
 * - POST   /meta-ads/ads               - Create ad
 * - GET    /meta-ads/ads/{id}          - Get ad
 * - PUT    /meta-ads/ads/{id}          - Update ad
 * - DELETE /meta-ads/ads/{id}          - Delete ad
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions, hasModulePermission, PermissionType,
} from '../../shared/utils/permissions-helper';
import {
    getMetaAdsCredentials, metaGraphGet, metaGraphPost, metaGraphDelete,
    metaSuccess, metaPaginatedSuccess, metaError,
    MetaApiError, AD_CREATIVE_FIELDS, AD_FIELDS,
} from '../../shared/utils/meta-ads-client';

const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
    GET: 'read', POST: 'write', PUT: 'put', DELETE: 'delete',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;
    const pathParts = path.split('/').filter(Boolean);

    console.log(`[MetaAds:Creatives] ${method} ${path}`);

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
        // --- Creatives ---
        if (path.endsWith('/creatives') && method === 'GET') return await listCreatives(event, corsHeaders);
        if (path.endsWith('/creatives') && method === 'POST') return await createCreative(event, corsHeaders);
        if (pathParts.includes('creatives') && pathParts.length > pathParts.indexOf('creatives') + 1) {
            if (method === 'GET') return await getCreative(event, corsHeaders);
            if (method === 'PUT') return await updateCreative(event, corsHeaders);
        }

        // --- Ads ---
        if (path.endsWith('/ads') && method === 'GET') return await listAds(event, corsHeaders);
        if (path.endsWith('/ads') && method === 'POST') return await createAd(event, corsHeaders);
        if (pathParts.includes('ads') && pathParts.length > pathParts.indexOf('ads') + 1) {
            if (method === 'GET') return await getAd(event, corsHeaders);
            if (method === 'PUT') return await updateAd(event, corsHeaders);
            if (method === 'DELETE') return await deleteAd(event, corsHeaders);
        }

        return metaError(`Route not found: ${method} ${path}`, 404, corsHeaders);
    } catch (err) {
        if (err instanceof MetaApiError) return metaError(err.message, err.httpStatus, corsHeaders);
        console.error('[MetaAds:Creatives] Error:', err);
        return metaError('Internal server error', 500, corsHeaders);
    }
}

// ============================================
// CREATIVE HANDLERS
// ============================================

async function listCreatives(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const params: Record<string, any> = {
        fields: AD_CREATIVE_FIELDS,
        limit: event.queryStringParameters?.limit || 25,
    };
    if (event.queryStringParameters?.after) params.after = event.queryStringParameters.after;

    const response = await metaGraphGet(`${actId}/adcreatives`, params, creds.accessToken);
    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function createCreative(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, name, object_story_spec } = body;

    if (!ad_account_id || !name || !object_story_spec) {
        return metaError('Missing required fields: ad_account_id, name, object_story_spec', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const response = await metaGraphPost(`${actId}/adcreatives`, {
        name,
        object_story_spec,
    }, creds.accessToken);

    return metaSuccess(response.data || response, 201, corsHeaders);
}

async function getCreative(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const creativeId = event.pathParameters?.id;
    if (!creativeId) return metaError('Missing creative ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(creativeId, { fields: AD_CREATIVE_FIELDS }, creds.accessToken);
    return metaSuccess(response, 200, corsHeaders);
}

async function updateCreative(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const creativeId = event.pathParameters?.id;
    if (!creativeId) return metaError('Missing creative ID', 400, corsHeaders);

    const body = JSON.parse(event.body || '{}');
    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.object_story_spec !== undefined) updates.object_story_spec = body.object_story_spec;

    if (Object.keys(updates).length === 0) return metaError('No update fields', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphPost(creativeId, updates, creds.accessToken);
    return metaSuccess({ id: creativeId, ...response.data }, 200, corsHeaders);
}

// ============================================
// AD HANDLERS
// ============================================

async function listAds(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const params: Record<string, any> = {
        fields: AD_FIELDS,
        limit: event.queryStringParameters?.limit || 25,
    };

    // Build filters
    const filters: any[] = [];
    if (event.queryStringParameters?.adset_id) {
        filters.push({ field: 'adset.id', operator: 'EQUAL', value: event.queryStringParameters.adset_id });
    }
    if (event.queryStringParameters?.campaign_id) {
        filters.push({ field: 'campaign.id', operator: 'EQUAL', value: event.queryStringParameters.campaign_id });
    }
    if (event.queryStringParameters?.status) {
        filters.push({ field: 'effective_status', operator: 'IN', value: [event.queryStringParameters.status] });
    }
    if (filters.length > 0) params.filtering = JSON.stringify(filters);
    if (event.queryStringParameters?.after) params.after = event.queryStringParameters.after;

    const response = await metaGraphGet(`${actId}/ads`, params, creds.accessToken);
    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function createAd(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, adset_id, name, creative, status, tracking_specs } = body;

    if (!ad_account_id || !adset_id || !name || !creative?.creative_id) {
        return metaError('Missing required fields: ad_account_id, adset_id, name, creative.creative_id', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const createBody: Record<string, any> = {
        adset_id, name,
        creative: { creative_id: creative.creative_id },
        status: status || 'PAUSED',
    };
    if (tracking_specs) createBody.tracking_specs = tracking_specs;

    const response = await metaGraphPost(`${actId}/ads`, createBody, creds.accessToken);
    return metaSuccess(response.data || response, 201, corsHeaders);
}

async function getAd(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adId = event.pathParameters?.id;
    if (!adId) return metaError('Missing ad ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(adId, { fields: AD_FIELDS }, creds.accessToken);
    return metaSuccess(response, 200, corsHeaders);
}

async function updateAd(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adId = event.pathParameters?.id;
    if (!adId) return metaError('Missing ad ID', 400, corsHeaders);

    const body = JSON.parse(event.body || '{}');
    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.status !== undefined) updates.status = body.status;
    if (body.creative !== undefined) updates.creative = body.creative;

    if (Object.keys(updates).length === 0) return metaError('No update fields', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphPost(adId, updates, creds.accessToken);
    return metaSuccess({ id: adId, ...response.data }, 200, corsHeaders);
}

async function deleteAd(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adId = event.pathParameters?.id;
    if (!adId) return metaError('Missing ad ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    await metaGraphDelete(adId, creds.accessToken);
    return metaSuccess({ id: adId }, 200, corsHeaders);
}

/**
 * Meta Ads — Ad Set Management Lambda
 *
 * Endpoints:
 * - GET    /meta-ads/adsets          - List ad sets
 * - POST   /meta-ads/adsets          - Create ad set
 * - GET    /meta-ads/adsets/{id}     - Get ad set
 * - PUT    /meta-ads/adsets/{id}     - Update ad set
 * - DELETE /meta-ads/adsets/{id}     - Delete ad set
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
    getUserPermissions, hasModulePermission, PermissionType,
} from '../../shared/utils/permissions-helper';
import {
    getMetaAdsCredentials, metaGraphGet, metaGraphPost, metaGraphDelete,
    metaSuccess, metaPaginatedSuccess, metaError,
    MetaApiError, AD_SET_FIELDS,
} from '../../shared/utils/meta-ads-client';

const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
    GET: 'read', POST: 'write', PUT: 'put', DELETE: 'delete',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = await buildCorsHeadersAsync({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;
    const pathParts = path.split('/').filter(Boolean);

    console.log(`[MetaAds:AdSets] ${method} ${path}`);

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
        const hasId = pathParts.includes('adsets') && pathParts.length > pathParts.indexOf('adsets') + 1;

        if (path.endsWith('/adsets') && method === 'GET') return await listAdSets(event, corsHeaders);
        if (path.endsWith('/adsets') && method === 'POST') return await createAdSet(event, corsHeaders);
        if (hasId && method === 'GET') return await getAdSet(event, corsHeaders);
        if (hasId && method === 'PUT') return await updateAdSet(event, corsHeaders);
        if (hasId && method === 'DELETE') return await deleteAdSet(event, corsHeaders);

        return metaError(`Route not found: ${method} ${path}`, 404, corsHeaders);
    } catch (err) {
        if (err instanceof MetaApiError) return metaError(err.message, err.httpStatus, corsHeaders);
        console.error('[MetaAds:AdSets] Error:', err);
        return metaError('Internal server error', 500, corsHeaders);
    }
}

// ============================================
// HANDLERS
// ============================================

async function listAdSets(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const params: Record<string, any> = {
        fields: AD_SET_FIELDS,
        limit: event.queryStringParameters?.limit || 25,
    };

    // Filter by campaign_id if provided
    const campaignId = event.queryStringParameters?.campaign_id;
    if (campaignId) {
        params.filtering = JSON.stringify([{
            field: 'campaign.id', operator: 'EQUAL', value: campaignId,
        }]);
    }
    if (event.queryStringParameters?.status) {
        const existingFilter = params.filtering ? JSON.parse(params.filtering) : [];
        existingFilter.push({ field: 'effective_status', operator: 'IN', value: [event.queryStringParameters.status] });
        params.filtering = JSON.stringify(existingFilter);
    }
    if (event.queryStringParameters?.after) params.after = event.queryStringParameters.after;

    const response = await metaGraphGet(`${actId}/adsets`, params, creds.accessToken);
    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function createAdSet(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, campaign_id, name, optimization_goal, billing_event,
        status, daily_budget, lifetime_budget, bid_amount, targeting,
        promoted_object, start_time, end_time } = body;

    if (!ad_account_id || !campaign_id || !name || !optimization_goal || !billing_event) {
        return metaError('Missing required fields: ad_account_id, campaign_id, name, optimization_goal, billing_event', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const createBody: Record<string, any> = {
        campaign_id, name,
        optimization_goal, billing_event,
        status: status || 'PAUSED',
        start_time: start_time || new Date().toISOString(),
    };

    if (daily_budget) createBody.daily_budget = daily_budget;
    if (lifetime_budget) createBody.lifetime_budget = lifetime_budget;
    if (bid_amount) createBody.bid_amount = bid_amount;
    if (targeting) createBody.targeting = targeting;
    if (promoted_object) createBody.promoted_object = promoted_object;
    if (end_time) createBody.end_time = end_time;

    const response = await metaGraphPost(`${actId}/adsets`, createBody, creds.accessToken);
    return metaSuccess(response.data || response, 201, corsHeaders);
}

async function getAdSet(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adSetId = event.pathParameters?.id;
    if (!adSetId) return metaError('Missing ad set ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(adSetId, { fields: AD_SET_FIELDS }, creds.accessToken);
    return metaSuccess(response, 200, corsHeaders);
}

async function updateAdSet(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adSetId = event.pathParameters?.id;
    if (!adSetId) return metaError('Missing ad set ID', 400, corsHeaders);

    const body = JSON.parse(event.body || '{}');
    const updates: Record<string, any> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.status !== undefined) updates.status = body.status;
    if (body.daily_budget !== undefined) updates.daily_budget = body.daily_budget;
    if (body.lifetime_budget !== undefined) updates.lifetime_budget = body.lifetime_budget;
    if (body.optimization_goal !== undefined) updates.optimization_goal = body.optimization_goal;
    if (body.bid_amount !== undefined) updates.bid_amount = body.bid_amount;
    if (body.targeting !== undefined) updates.targeting = body.targeting;
    if (body.end_time !== undefined) updates.end_time = body.end_time;

    if (Object.keys(updates).length === 0) return metaError('No update fields', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphPost(adSetId, updates, creds.accessToken);
    return metaSuccess({ id: adSetId, ...response.data }, 200, corsHeaders);
}

async function deleteAdSet(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adSetId = event.pathParameters?.id;
    if (!adSetId) return metaError('Missing ad set ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    await metaGraphDelete(adSetId, creds.accessToken);
    return metaSuccess({ id: adSetId }, 200, corsHeaders);
}

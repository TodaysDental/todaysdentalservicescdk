/**
 * Meta Ads — Insights / Analytics Lambda
 *
 * Endpoints:
 * - GET /meta-ads/insights/account/{id}   - Account-level insights
 * - GET /meta-ads/insights/campaign/{id}  - Campaign insights
 * - GET /meta-ads/insights/adset/{id}     - Ad set insights
 * - GET /meta-ads/insights/ad/{id}        - Ad-level insights
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions, hasModulePermission,
} from '../../shared/utils/permissions-helper';
import {
    getMetaAdsCredentials, metaGraphGet,
    metaSuccess, metaPaginatedSuccess, metaError,
    MetaApiError, INSIGHT_FIELDS,
} from '../../shared/utils/meta-ads-client';

const MODULE_NAME = 'Marketing';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;
    const pathParts = path.split('/').filter(Boolean);

    console.log(`[MetaAds:Insights] ${method} ${path}`);

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const userPerms = getUserPermissions(event);
    if (!userPerms) return metaError('Unauthorized', 401, corsHeaders);
    if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, 'read', userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
        return metaError('Access denied', 403, corsHeaders);
    }

    try {
        // Determine the level and ID from path
        // Expected paths: /meta-ads/insights/account/{id}, /meta-ads/insights/campaign/{id}, etc.
        const insightsIdx = pathParts.indexOf('insights');
        if (insightsIdx === -1 || pathParts.length < insightsIdx + 3) {
            return metaError('Invalid insights path. Use: insights/{level}/{id}', 400, corsHeaders);
        }

        const level = pathParts[insightsIdx + 1]; // 'account', 'campaign', 'adset', 'ad'
        const entityId = pathParts[insightsIdx + 2];

        if (!['account', 'campaign', 'adset', 'ad'].includes(level)) {
            return metaError(`Invalid insight level: ${level}. Use: account, campaign, adset, ad`, 400, corsHeaders);
        }

        return await getInsights(level, entityId, event, corsHeaders);
    } catch (err) {
        if (err instanceof MetaApiError) return metaError(err.message, err.httpStatus, corsHeaders);
        console.error('[MetaAds:Insights] Error:', err);
        return metaError('Internal server error', 500, corsHeaders);
    }
}

async function getInsights(
    level: string,
    entityId: string,
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const creds = await getMetaAdsCredentials();
    const qs = event.queryStringParameters || {};

    // Build the endpoint: for account level, prefix with act_
    let endpoint: string;
    if (level === 'account') {
        endpoint = `${entityId.startsWith('act_') ? entityId : `act_${entityId}`}/insights`;
    } else {
        endpoint = `${entityId}/insights`;
    }

    const params: Record<string, any> = {
        fields: qs.fields || INSIGHT_FIELDS,
    };

    // Date range
    if (qs.date_preset) {
        params.date_preset = qs.date_preset;
    } else if (qs.since && qs.until) {
        params.time_range = JSON.stringify({ since: qs.since, until: qs.until });
    } else {
        params.date_preset = 'last_30d';
    }

    // Time increment (daily, monthly, etc.)
    if (qs.time_increment) {
        params.time_increment = qs.time_increment;
    }

    // Breakdowns
    if (qs.breakdowns) {
        params.breakdowns = qs.breakdowns;
    }

    // Limit
    if (qs.limit) params.limit = qs.limit;

    const response = await metaGraphGet(endpoint, params, creds.accessToken);

    // Insights returns an array of data points
    const data = Array.isArray(response.data) ? response.data : (response.data ? [response.data] : []);
    return metaPaginatedSuccess(data, response.paging, undefined, corsHeaders);
}

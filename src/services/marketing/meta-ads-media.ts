/**
 * Meta Ads — Media Upload Lambda
 *
 * Endpoints:
 * - POST /meta-ads/media/images   - Upload image (expects multipart form data)
 * - GET  /meta-ads/media/images   - List ad images
 * - POST /meta-ads/media/videos   - Upload video
 * - GET  /meta-ads/media/videos   - List ad videos
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
    getUserPermissions, hasModulePermission, PermissionType,
} from '../../shared/utils/permissions-helper';
import {
    getMetaAdsCredentials, metaGraphGet,
    metaSuccess, metaPaginatedSuccess, metaError, MetaApiError,
} from '../../shared/utils/meta-ads-client';

const MODULE_NAME = 'Marketing';
const META_GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = await buildCorsHeadersAsync({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;

    console.log(`[MetaAds:Media] ${method} ${path}`);

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const userPerms = getUserPermissions(event);
    if (!userPerms) return metaError('Unauthorized', 401, corsHeaders);

    const requiredPermission: PermissionType = method === 'POST' ? 'write' : 'read';
    if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, requiredPermission, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
        return metaError('Access denied', 403, corsHeaders);
    }

    try {
        // --- Images ---
        if (path.endsWith('/media/images') && method === 'GET') return await listImages(event, corsHeaders);
        if (path.endsWith('/media/images') && method === 'POST') return await uploadImage(event, corsHeaders);

        // --- Videos ---
        if (path.endsWith('/media/videos') && method === 'GET') return await listVideos(event, corsHeaders);
        if (path.endsWith('/media/videos') && method === 'POST') return await uploadVideo(event, corsHeaders);

        return metaError(`Route not found: ${method} ${path}`, 404, corsHeaders);
    } catch (err) {
        if (err instanceof MetaApiError) return metaError(err.message, err.httpStatus, corsHeaders);
        console.error('[MetaAds:Media] Error:', err);
        return metaError('Internal server error', 500, corsHeaders);
    }
}

// ============================================
// IMAGE HANDLERS
// ============================================

async function listImages(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const response = await metaGraphGet(`${actId}/adimages`, {
        fields: 'hash,url,url_128,name,width,height,created_time',
        limit: event.queryStringParameters?.limit || 50,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function uploadImage(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    // Image upload via base64 or URL
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, image_url, image_base64, filename } = body;

    if (!ad_account_id) return metaError('Missing ad_account_id', 400, corsHeaders);
    if (!image_url && !image_base64) return metaError('Provide either image_url or image_base64', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    // Use URL-based upload for simplicity (Lambda has limited multipart support)
    const url = `${META_GRAPH_BASE_URL}/${actId}/adimages`;

    const formParams = new URLSearchParams();
    formParams.set('access_token', creds.accessToken);

    if (image_url) {
        formParams.set('url', image_url);
    } else if (image_base64) {
        formParams.set('bytes', image_base64);
    }
    if (filename) formParams.set('name', filename);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formParams.toString(),
    });

    const json: any = await response.json();
    if (json.error) {
        return metaError(json.error.message, response.status, corsHeaders);
    }

    // Meta returns images keyed by hash
    const images = json.images || json;
    const imageData = Object.values(images)[0] || images;

    return metaSuccess(imageData, 201, corsHeaders);
}

// ============================================
// VIDEO HANDLERS
// ============================================

async function listVideos(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const response = await metaGraphGet(`${actId}/advideos`, {
        fields: 'id,title,description,source,picture,length,status,created_time,updated_time',
        limit: event.queryStringParameters?.limit || 50,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function uploadVideo(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, file_url, title } = body;

    if (!ad_account_id || !file_url) {
        return metaError('Missing required fields: ad_account_id, file_url', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const url = `${META_GRAPH_BASE_URL}/${actId}/advideos`;
    const formParams = new URLSearchParams();
    formParams.set('access_token', creds.accessToken);
    formParams.set('file_url', file_url);
    if (title) formParams.set('title', title);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formParams.toString(),
    });

    const json: any = await response.json();
    if (json.error) {
        return metaError(json.error.message, response.status, corsHeaders);
    }

    return metaSuccess(json, 201, corsHeaders);
}

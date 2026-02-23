/**
 * Meta Ads Campaign & Account Management Lambda
 *
 * Handles campaign CRUD, account info, dashboard stats, and account settings.
 *
 * Endpoints:
 * - GET    /meta-ads/accounts           - List ad accounts
 * - GET    /meta-ads/accounts/{id}      - Get ad account details
 * - GET    /meta-ads/settings           - Get connection settings
 * - PUT    /meta-ads/settings           - Update connection settings
 * - GET    /meta-ads/dashboard          - Dashboard stats
 * - GET    /meta-ads/campaigns          - List campaigns
 * - POST   /meta-ads/campaigns          - Create campaign
 * - GET    /meta-ads/campaigns/{id}     - Get single campaign
 * - PUT    /meta-ads/campaigns/{id}     - Update campaign
 * - DELETE /meta-ads/campaigns/{id}     - Delete campaign
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient, PutCommand, GetCommand,
    QueryCommand, UpdateCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions, hasModulePermission, PermissionType,
} from '../../shared/utils/permissions-helper';
import {
    getMetaAdsCredentials, metaGraphGet, metaGraphPost, metaGraphDelete,
    metaSuccess, metaPaginatedSuccess, metaError,
    MetaApiError, CAMPAIGN_FIELDS, AD_ACCOUNT_FIELDS, INSIGHT_FIELDS,
} from '../../shared/utils/meta-ads-client';
import { getGlobalSecret } from '../../shared/utils/secrets-helper';

// ============================================
// CONFIG
// ============================================

const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
    GET: 'read', POST: 'write', PUT: 'put', DELETE: 'delete',
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const META_ADS_CAMPAIGNS_TABLE = process.env.META_ADS_CAMPAIGNS_TABLE || 'MetaAdsCampaigns';

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;
    const pathParts = path.split('/').filter(Boolean);

    console.log(`[MetaAds] ${method} ${path}`);

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Permission check
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
        return metaError('Unauthorized - Invalid token', 401, corsHeaders);
    }

    const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
    if (!hasModulePermission(
        userPerms.clinicRoles, MODULE_NAME, requiredPermission,
        userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin
    )) {
        return metaError(`Access denied: requires ${MODULE_NAME} ${requiredPermission} permission`, 403, corsHeaders);
    }

    try {
        // --- Account Routes ---
        if (path.endsWith('/accounts') && method === 'GET') {
            return await listAdAccounts(event, corsHeaders);
        }
        if (pathParts.includes('accounts') && pathParts.length > pathParts.indexOf('accounts') + 1 && method === 'GET') {
            return await getAdAccount(event, corsHeaders);
        }

        // --- Settings Routes ---
        if (path.endsWith('/settings') && method === 'GET') {
            return await getSettings(corsHeaders);
        }
        if (path.endsWith('/settings') && method === 'PUT') {
            return await updateSettings(event, corsHeaders);
        }

        // --- Dashboard Route ---
        if (path.endsWith('/dashboard') && method === 'GET') {
            return await getDashboard(event, corsHeaders);
        }

        // --- Campaign Routes ---
        if (path.endsWith('/campaigns') && method === 'GET') {
            return await listCampaigns(event, corsHeaders);
        }
        if (path.endsWith('/campaigns') && method === 'POST') {
            return await createCampaign(event, corsHeaders);
        }
        if (pathParts.includes('campaigns') && pathParts.length > pathParts.indexOf('campaigns') + 1) {
            if (method === 'GET') return await getCampaignById(event, corsHeaders);
            if (method === 'PUT') return await updateCampaign(event, corsHeaders);
            if (method === 'DELETE') return await deleteCampaign(event, corsHeaders);
        }

        return metaError(`Route not found: ${method} ${path}`, 404, corsHeaders);
    } catch (err) {
        if (err instanceof MetaApiError) {
            return metaError(err.message, err.httpStatus, corsHeaders);
        }
        console.error('[MetaAds] Unhandled error:', err);
        return metaError('Internal server error', 500, corsHeaders);
    }
}

// ============================================
// ACCOUNT HANDLERS
// ============================================

async function listAdAccounts(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet('me/adaccounts', {
        fields: AD_ACCOUNT_FIELDS,
        limit: 50,
    }, creds.accessToken);

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function getAdAccount(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const adAccountId = event.pathParameters?.id;
    if (!adAccountId) return metaError('Missing ad account ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const response = await metaGraphGet(actId, {
        fields: AD_ACCOUNT_FIELDS,
    }, creds.accessToken);

    return metaSuccess(response, 200, corsHeaders);
}

// ============================================
// SETTINGS HANDLERS
// ============================================

async function getSettings(
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const [accessToken, appId, appSecret, adAccountId, pageId, instagramActorId, pixelId] = await Promise.all([
        getGlobalSecret('meta_ads', 'access_token'),
        getGlobalSecret('meta_ads', 'app_id'),
        getGlobalSecret('meta_ads', 'app_secret'),
        getGlobalSecret('meta_ads', 'ad_account_id'),
        getGlobalSecret('meta_ads', 'page_id'),
        getGlobalSecret('meta_ads', 'instagram_actor_id'),
        getGlobalSecret('meta_ads', 'pixel_id'),
    ]);

    return metaSuccess({
        adAccountId: adAccountId || '',
        accessToken: accessToken ? '••••••' + accessToken.slice(-6) : '',
        appId: appId || '',
        appSecret: appSecret ? '••••••' + appSecret.slice(-6) : '',
        pageId: pageId || '',
        instagramActorId: instagramActorId || '',
        pixelId: pixelId || '',
        isConnected: !!accessToken && !!adAccountId,
    }, 200, corsHeaders);
}

async function updateSettings(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    // Settings updates are handled via admin UI writing to GlobalSecrets.
    // This endpoint would need DynamoDB PutItem permission to GlobalSecrets.
    // For now, return a placeholder response.
    return metaSuccess({ message: 'Settings update not yet implemented. Update GlobalSecrets directly.' }, 200, corsHeaders);
}

// ============================================
// DASHBOARD HANDLER
// ============================================

async function getDashboard(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id parameter', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const datePreset = event.queryStringParameters?.date_preset || 'this_month';

    // Fetch campaigns and insights in parallel
    const [campaignsRes, insightsRes] = await Promise.all([
        metaGraphGet(`${actId}/campaigns`, {
            fields: 'id,status,effective_status',
            limit: 500,
        }, creds.accessToken),
        metaGraphGet(`${actId}/insights`, {
            fields: INSIGHT_FIELDS,
            date_preset: datePreset,
        }, creds.accessToken),
    ]);

    const campaigns = campaignsRes.data || [];
    const activeCampaigns = Array.isArray(campaigns)
        ? campaigns.filter((c: any) => c.effective_status === 'ACTIVE').length
        : 0;

    const insight = Array.isArray(insightsRes.data) ? insightsRes.data[0] : insightsRes.data;

    const stats = {
        activeCampaigns,
        totalSpendMTD: parseFloat(insight?.spend || '0'),
        totalImpressions: parseInt(insight?.impressions || '0', 10),
        totalReach: parseInt(insight?.reach || '0', 10),
        totalClicks: parseInt(insight?.clicks || '0', 10),
        totalLeads: 0,
        averageCTR: parseFloat(insight?.ctr || '0'),
        averageCPC: parseFloat(insight?.cpc || '0'),
        averageCPM: parseFloat(insight?.cpm || '0'),
        costPerLead: 0,
    };

    // Calculate leads from actions
    if (insight?.actions) {
        const leadAction = insight.actions.find((a: any) => a.action_type === 'lead');
        if (leadAction) {
            stats.totalLeads = parseInt(leadAction.value, 10);
            stats.costPerLead = stats.totalLeads > 0 ? stats.totalSpendMTD / stats.totalLeads : 0;
        }
    }

    return metaSuccess(stats, 200, corsHeaders);
}

// ============================================
// CAMPAIGN HANDLERS
// ============================================

async function listCampaigns(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const adAccountId = event.queryStringParameters?.ad_account_id;
    if (!adAccountId) return metaError('Missing ad_account_id parameter', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const params: Record<string, any> = {
        fields: CAMPAIGN_FIELDS,
        limit: event.queryStringParameters?.limit || 25,
    };
    if (event.queryStringParameters?.status) {
        params.filtering = JSON.stringify([{
            field: 'effective_status',
            operator: 'IN',
            value: [event.queryStringParameters.status],
        }]);
    }
    if (event.queryStringParameters?.after) {
        params.after = event.queryStringParameters.after;
    }

    const response = await metaGraphGet(`${actId}/campaigns`, params, creds.accessToken);

    // Cache campaigns to DynamoDB for quick access
    if (Array.isArray(response.data)) {
        await Promise.allSettled(
            response.data.map((campaign: any) =>
                ddb.send(new PutCommand({
                    TableName: META_ADS_CAMPAIGNS_TABLE,
                    Item: {
                        campaignId: campaign.id,
                        adAccountId: adAccountId.replace('act_', ''),
                        ...campaign,
                        syncedAt: new Date().toISOString(),
                    },
                }))
            )
        );
    }

    return metaPaginatedSuccess(response.data || [], response.paging, undefined, corsHeaders);
}

async function createCampaign(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { ad_account_id, name, objective, status, special_ad_categories,
        buying_type, bid_strategy, daily_budget, lifetime_budget, spend_cap,
        start_time, stop_time } = body;

    if (!ad_account_id || !name || !objective) {
        return metaError('Missing required fields: ad_account_id, name, objective', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const actId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const createBody: Record<string, any> = {
        name,
        objective,
        status: status || 'PAUSED',
        special_ad_categories: special_ad_categories || [],
    };

    if (buying_type) createBody.buying_type = buying_type;
    if (bid_strategy) createBody.bid_strategy = bid_strategy;
    if (daily_budget) createBody.daily_budget = daily_budget;
    if (lifetime_budget) createBody.lifetime_budget = lifetime_budget;
    if (spend_cap) createBody.spend_cap = spend_cap;
    if (start_time) createBody.start_time = start_time;
    if (stop_time) createBody.stop_time = stop_time;

    const response = await metaGraphPost(`${actId}/campaigns`, createBody, creds.accessToken);

    // Cache to DynamoDB
    if (response.data?.id) {
        await ddb.send(new PutCommand({
            TableName: META_ADS_CAMPAIGNS_TABLE,
            Item: {
                campaignId: response.data.id,
                adAccountId: ad_account_id.replace('act_', ''),
                name, objective, status: status || 'PAUSED',
                createdAt: new Date().toISOString(),
                syncedAt: new Date().toISOString(),
            },
        }));
    }

    return metaSuccess(response.data || response, 201, corsHeaders);
}

async function getCampaignById(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const campaignId = event.pathParameters?.id;
    if (!campaignId) return metaError('Missing campaign ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphGet(campaignId, {
        fields: CAMPAIGN_FIELDS,
    }, creds.accessToken);

    return metaSuccess(response, 200, corsHeaders);
}

async function updateCampaign(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const campaignId = event.pathParameters?.id;
    if (!campaignId) return metaError('Missing campaign ID', 400, corsHeaders);

    const body = JSON.parse(event.body || '{}');
    const updates: Record<string, any> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.status !== undefined) updates.status = body.status;
    if (body.daily_budget !== undefined) updates.daily_budget = body.daily_budget;
    if (body.lifetime_budget !== undefined) updates.lifetime_budget = body.lifetime_budget;
    if (body.bid_strategy !== undefined) updates.bid_strategy = body.bid_strategy;
    if (body.spend_cap !== undefined) updates.spend_cap = body.spend_cap;
    if (body.stop_time !== undefined) updates.stop_time = body.stop_time;

    if (Object.keys(updates).length === 0) {
        return metaError('No update fields provided', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const response = await metaGraphPost(campaignId, updates, creds.accessToken);

    return metaSuccess({ id: campaignId, ...response.data }, 200, corsHeaders);
}

async function deleteCampaign(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const campaignId = event.pathParameters?.id;
    if (!campaignId) return metaError('Missing campaign ID', 400, corsHeaders);

    const creds = await getMetaAdsCredentials();
    await metaGraphDelete(campaignId, creds.accessToken);

    // Remove from DynamoDB cache
    await ddb.send(new DeleteCommand({
        TableName: META_ADS_CAMPAIGNS_TABLE,
        Key: { campaignId },
    })).catch(() => { }); // Ignore cache deletion errors

    return metaSuccess({ id: campaignId }, 200, corsHeaders);
}

/**
 * Meta Ads — Bulk Operations Lambda
 *
 * Endpoints:
 * - POST /meta-ads/bulk/publish          - Publish campaign template to multiple clinics
 * - GET  /meta-ads/bulk/{batchId}/status - Get batch status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
    getUserPermissions, hasModulePermission,
} from '../../shared/utils/permissions-helper';
import {
    getMetaAdsCredentials, metaGraphPost,
    metaSuccess, metaError, MetaApiError,
} from '../../shared/utils/meta-ads-client';

const MODULE_NAME = 'Marketing';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const META_ADS_CAMPAIGNS_TABLE = process.env.META_ADS_CAMPAIGNS_TABLE || 'MetaAdsCampaigns';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = await buildCorsHeadersAsync({}, event.headers?.origin || event.headers?.Origin);
    const method = event.httpMethod;
    const path = event.path;

    console.log(`[MetaAds:Bulk] ${method} ${path}`);

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const userPerms = getUserPermissions(event);
    if (!userPerms) return metaError('Unauthorized', 401, corsHeaders);
    if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, 'write', userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
        return metaError('Access denied', 403, corsHeaders);
    }

    try {
        if (path.endsWith('/bulk/publish') && method === 'POST') {
            return await bulkPublish(event, corsHeaders);
        }
        if (path.includes('/bulk/') && path.endsWith('/status') && method === 'GET') {
            return await getBatchStatus(event, corsHeaders);
        }

        return metaError(`Route not found: ${method} ${path}`, 404, corsHeaders);
    } catch (err) {
        if (err instanceof MetaApiError) return metaError(err.message, err.httpStatus, corsHeaders);
        console.error('[MetaAds:Bulk] Error:', err);
        return metaError('Internal server error', 500, corsHeaders);
    }
}

// ============================================
// BULK PUBLISH
// ============================================

async function bulkPublish(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { clinicIds, campaignTemplate, adSetTemplate, creativeTemplate } = body;

    if (!clinicIds?.length || !campaignTemplate) {
        return metaError('Missing clinicIds or campaignTemplate', 400, corsHeaders);
    }

    const creds = await getMetaAdsCredentials();
    const batchId = uuidv4();
    const results: Array<{ clinicId: string; success: boolean; campaignId?: string; error?: string }> = [];

    for (const clinicId of clinicIds) {
        try {
            // Each clinic needs its own ad_account_id — for now use the same global one
            const adAccountId = campaignTemplate.ad_account_id;
            const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

            // Create campaign
            const campaignRes = await metaGraphPost(`${actId}/campaigns`, {
                name: `${campaignTemplate.name} - ${clinicId}`,
                objective: campaignTemplate.objective,
                status: campaignTemplate.status || 'PAUSED',
                special_ad_categories: campaignTemplate.special_ad_categories || [],
                daily_budget: campaignTemplate.daily_budget,
            }, creds.accessToken);

            const campaignId = campaignRes.data?.id;

            // Cache to DynamoDB
            if (campaignId) {
                await ddb.send(new PutCommand({
                    TableName: META_ADS_CAMPAIGNS_TABLE,
                    Item: {
                        campaignId,
                        adAccountId: adAccountId.replace('act_', ''),
                        clinicId,
                        batchId,
                        name: `${campaignTemplate.name} - ${clinicId}`,
                        objective: campaignTemplate.objective,
                        status: 'PAUSED',
                        createdAt: new Date().toISOString(),
                        syncedAt: new Date().toISOString(),
                    },
                }));

                // Create ad set if template provided
                if (adSetTemplate && campaignId) {
                    await metaGraphPost(`${actId}/adsets`, {
                        campaign_id: campaignId,
                        name: adSetTemplate.name || `${campaignTemplate.name} - Ad Set`,
                        optimization_goal: adSetTemplate.optimization_goal,
                        billing_event: adSetTemplate.billing_event,
                        daily_budget: adSetTemplate.daily_budget || campaignTemplate.daily_budget,
                        targeting: adSetTemplate.targeting,
                        start_time: adSetTemplate.start_time || new Date().toISOString(),
                        status: 'PAUSED',
                    }, creds.accessToken);
                }
            }

            results.push({ clinicId, success: true, campaignId });
        } catch (err: any) {
            console.error(`[MetaAds:Bulk] Failed for clinic ${clinicId}:`, err);
            results.push({ clinicId, success: false, error: err.message });
        }
    }

    return metaSuccess(results, 200, corsHeaders);
}

// ============================================
// BATCH STATUS
// ============================================

async function getBatchStatus(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
    const pathParts = event.path.split('/').filter(Boolean);
    const bulkIdx = pathParts.indexOf('bulk');
    const batchId = pathParts[bulkIdx + 1];

    if (!batchId || batchId === 'status') return metaError('Missing batch ID', 400, corsHeaders);

    // Query DynamoDB for campaigns with this batchId
    // For now, return a placeholder — batch tracking would need a GSI on batchId
    return metaSuccess({
        batchId,
        message: 'Batch status tracking requires GSI on batchId. Check campaign table directly.',
    }, 200, corsHeaders);
}

/**
 * Google Ads Account Management Lambda
 * 
 * Handles account-level operations:
 * - Account structure queries
 * - Shared budgets management
 * - Budget recommendations
 * - Experiments and drafts
 * - Billing info viewing
 * 
 * Endpoints:
 * - GET /google-ads/account/structure - Get account structure
 * - GET /google-ads/account/budgets - List shared budgets
 * - POST /google-ads/account/budgets - Create shared budget
 * - PUT /google-ads/account/budgets/{id} - Update shared budget
 * - GET /google-ads/account/recommendations - Get budget recommendations
 * - GET /google-ads/account/experiments - List experiments
 * - POST /google-ads/account/experiments - Create experiment
 * - GET /google-ads/account/billing - Get billing info
 * - GET /google-ads/account/change-history - Get change history
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';
import {
  getGoogleAdsClient,
  microsToDollars,
  dollarsToMicros,
} from '../../shared/utils/google-ads-client';

// Module permission configuration
const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

// ============================================
// TYPE DEFINITIONS
// ============================================

interface CreateSharedBudgetRequest {
  customerId: string;
  name: string;
  amountMicros: number;
  deliveryMethod?: 'STANDARD' | 'ACCELERATED';
}

interface UpdateSharedBudgetRequest {
  customerId: string;
  name?: string;
  amountMicros?: number;
}

interface CreateExperimentRequest {
  customerId: string;
  name: string;
  baseCampaignResourceName: string;
  trafficSplitPercent: number;
  startDate: string;
  endDate?: string;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = await buildCorsHeadersAsync({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;
  const pathParts = path.split('/').filter(Boolean);

  console.log(`[GoogleAdsAccount] ${method} ${path}`);

  // Handle OPTIONS for CORS
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Permission check
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }
  const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
  if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, requiredPermission, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ success: false, error: `Access denied: requires ${MODULE_NAME} module access` }) };
  }

  try {
    // Route: GET /google-ads/account/structure
    if (method === 'GET' && path.includes('/account/structure')) {
      return await getAccountStructure(event, corsHeaders);
    }

    // Route: GET /google-ads/account/budgets
    if (method === 'GET' && path.includes('/account/budgets')) {
      return await listSharedBudgets(event, corsHeaders);
    }

    // Route: POST /google-ads/account/budgets
    if (method === 'POST' && path.includes('/account/budgets')) {
      return await createSharedBudget(event, corsHeaders);
    }

    // Route: PUT /google-ads/account/budgets/{id}
    if (method === 'PUT' && path.includes('/account/budgets')) {
      return await updateSharedBudget(event, corsHeaders);
    }

    // Route: GET /google-ads/account/recommendations
    if (method === 'GET' && path.includes('/account/recommendations')) {
      return await getBudgetRecommendations(event, corsHeaders);
    }

    // Route: GET /google-ads/account/experiments
    if (method === 'GET' && path.includes('/account/experiments')) {
      return await listExperiments(event, corsHeaders);
    }

    // Route: POST /google-ads/account/experiments
    if (method === 'POST' && path.includes('/account/experiments')) {
      return await createExperiment(event, corsHeaders);
    }

    // Route: GET /google-ads/account/billing
    if (method === 'GET' && path.includes('/account/billing')) {
      return await getBillingInfo(event, corsHeaders);
    }

    // Route: GET /google-ads/account/change-history
    if (method === 'GET' && path.includes('/account/change-history')) {
      return await getChangeHistory(event, corsHeaders);
    }

    // Route: GET /google-ads/account/labels
    if (method === 'GET' && path.includes('/account/labels')) {
      return await listLabels(event, corsHeaders);
    }

    // Route: POST /google-ads/account/labels
    if (method === 'POST' && path.includes('/account/labels')) {
      return await createLabel(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
    };
  }
}

// ============================================
// ACCOUNT STRUCTURE HANDLERS
// ============================================

async function getAccountStructure(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const managerId = event.queryStringParameters?.managerId;

  // If no customerId provided, list all accessible customers under the MCC
  if (!customerId) {
    return await listAccessibleCustomers(corsHeaders);
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Get account info
    const accountQuery = `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.auto_tagging_enabled,
        customer.conversion_tracking_setting.conversion_tracking_id,
        customer.manager
      FROM customer
      WHERE customer.id = ${customerId}
    `;

    const accountResults = await client.query(accountQuery);

    // Get campaign count
    const campaignQuery = `
      SELECT campaign.id, campaign.status
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `;

    const campaigns = await client.query(campaignQuery);

    // Get ad group count
    const adGroupQuery = `
      SELECT ad_group.id
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
      LIMIT 1000
    `;

    const adGroups = await client.query(adGroupQuery);

    const account = accountResults[0];
    const structure = {
      account: {
        id: account?.customer?.id?.toString(),
        name: account?.customer?.descriptive_name,
        currencyCode: account?.customer?.currency_code,
        timeZone: account?.customer?.time_zone,
        autoTaggingEnabled: account?.customer?.auto_tagging_enabled,
        conversionTrackingId: account?.customer?.conversion_tracking_setting?.conversion_tracking_id,
        isManager: account?.customer?.manager,
      },
      counts: {
        campaigns: campaigns.length,
        campaignsByStatus: {
          enabled: campaigns.filter((c: any) => c.campaign.status === 'ENABLED').length,
          paused: campaigns.filter((c: any) => c.campaign.status === 'PAUSED').length,
        },
        adGroups: adGroups.length,
      },
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        structure,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error getting account structure:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

/**
 * List all accessible customers under the MCC (Manager Account)
 * Uses getAllClinicsWithGoogleAdsStatus to get configured customers
 */
async function listAccessibleCustomers(
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    // Import at runtime to avoid circular dependencies
    const { getClinicsWithGoogleAds, getLoginCustomerId } = await import('../../shared/utils/google-ads-client');

    // Get all clinics with Google Ads configured
    const clinicsWithAds = await getClinicsWithGoogleAds();

    if (clinicsWithAds.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          customers: [],
          message: 'No Google Ads accounts configured',
        }),
      };
    }

    // Fetch account details for each configured customer
    const customers: any[] = [];

    for (const clinic of clinicsWithAds) {
      try {
        const { getGoogleAdsClient } = await import('../../shared/utils/google-ads-client');
        const client = await getGoogleAdsClient(clinic.customerId);

        const query = `
          SELECT
            customer.id,
            customer.descriptive_name,
            customer.currency_code,
            customer.time_zone,
            customer.manager,
            customer.test_account
          FROM customer
          WHERE customer.id = ${clinic.customerId.replace(/-/g, '')}
          LIMIT 1
        `;

        const results = await client.query(query);

        if (results.length > 0) {
          const customer = results[0].customer;
          const customerIdNum = customer?.id?.toString() || clinic.customerId.replace(/-/g, '');
          customers.push({
            resourceName: `customers/${customerIdNum}`,
            customerId: customerIdNum,
            descriptiveName: customer?.descriptive_name || clinic.clinicName,
            currencyCode: customer?.currency_code || 'USD',
            timeZone: customer?.time_zone || 'America/New_York',
            manager: customer?.manager || false,
            testAccount: customer?.test_account || false,
            clinicId: clinic.clinicId,
            clinicName: clinic.clinicName,
          });
        }
      } catch (err: any) {
        console.warn(`[GoogleAdsAccount] Could not fetch details for customer ${clinic.customerId}:`, err.message);
        // Still include the clinic with basic info
        const customerIdNum = clinic.customerId.replace(/-/g, '');
        customers.push({
          resourceName: `customers/${customerIdNum}`,
          customerId: customerIdNum,
          descriptiveName: clinic.clinicName,
          currencyCode: 'USD',
          timeZone: 'America/New_York',
          manager: false,
          testAccount: false,
          clinicId: clinic.clinicId,
          clinicName: clinic.clinicName,
          error: 'Could not fetch Google Ads details',
        });
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        customers,
        total: customers.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error listing accessible customers:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// SHARED BUDGET HANDLERS
// ============================================

async function listSharedBudgets(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        campaign_budget.id,
        campaign_budget.name,
        campaign_budget.resource_name,
        campaign_budget.amount_micros,
        campaign_budget.delivery_method,
        campaign_budget.explicitly_shared,
        campaign_budget.reference_count,
        campaign_budget.status,
        campaign_budget.total_amount_micros
      FROM campaign_budget
      WHERE campaign_budget.explicitly_shared = TRUE
        AND campaign_budget.status != 'REMOVED'
      ORDER BY campaign_budget.name
    `;

    const results = await client.query(query);

    const budgets = results.map((row: any) => ({
      id: row.campaign_budget.id?.toString(),
      name: row.campaign_budget.name,
      resourceName: row.campaign_budget.resource_name,
      amountMicros: row.campaign_budget.amount_micros,
      amountDollars: microsToDollars(row.campaign_budget.amount_micros || 0),
      deliveryMethod: row.campaign_budget.delivery_method,
      isShared: row.campaign_budget.explicitly_shared,
      campaignCount: row.campaign_budget.reference_count || 0,
      status: row.campaign_budget.status,
      totalAmountMicros: row.campaign_budget.total_amount_micros,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        budgets,
        total: budgets.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error listing shared budgets:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createSharedBudget(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: CreateSharedBudgetRequest = JSON.parse(event.body || '{}');
  const { customerId, name, amountMicros, deliveryMethod = 'STANDARD' } = body;

  if (!customerId || !name || !amountMicros) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, name, and amountMicros are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const budgetOperation = {
      create: {
        name,
        amount_micros: amountMicros,
        delivery_method: deliveryMethod,
        explicitly_shared: true,
      },
    };

    const response = await (client as any).campaignBudgets.create([budgetOperation]);
    const resourceName = response.results[0].resource_name;
    const budgetId = resourceName.split('/').pop();

    console.log(`[GoogleAdsAccount] Created shared budget: ${resourceName}`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        budget: {
          id: budgetId,
          resourceName,
          name,
          amountMicros,
          amountDollars: microsToDollars(amountMicros),
        },
        message: 'Shared budget created successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error creating shared budget:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateSharedBudget(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const budgetId = event.pathParameters?.id;
  const body: UpdateSharedBudgetRequest = JSON.parse(event.body || '{}');
  const { customerId, name, amountMicros } = body;

  if (!budgetId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'budgetId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/campaignBudgets/${budgetId}`;

    const updateOperation: any = {
      update: {
        resource_name: resourceName,
      },
      update_mask: { paths: [] },
    };

    if (name) {
      updateOperation.update.name = name;
      updateOperation.update_mask.paths.push('name');
    }

    if (amountMicros) {
      updateOperation.update.amount_micros = amountMicros;
      updateOperation.update_mask.paths.push('amount_micros');
    }

    if (updateOperation.update_mask.paths.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No fields to update' }),
      };
    }

    await (client as any).campaignBudgets.update([updateOperation]);

    console.log(`[GoogleAdsAccount] Updated shared budget: ${resourceName}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Shared budget updated successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error updating shared budget:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// RECOMMENDATIONS HANDLERS
// ============================================

async function getBudgetRecommendations(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        recommendation.resource_name,
        recommendation.type,
        recommendation.impact.base_metrics.impressions,
        recommendation.impact.base_metrics.clicks,
        recommendation.impact.base_metrics.cost_micros,
        recommendation.impact.potential_metrics.impressions,
        recommendation.impact.potential_metrics.clicks,
        recommendation.impact.potential_metrics.cost_micros,
        recommendation.campaign_budget_recommendation.current_budget_amount_micros,
        recommendation.campaign_budget_recommendation.recommended_budget_amount_micros,
        recommendation.campaign_budget_recommendation.budget_options,
        campaign.name
      FROM recommendation
      WHERE recommendation.type = 'CAMPAIGN_BUDGET'
      LIMIT 50
    `;

    const results = await client.query(query);

    const recommendations = results.map((row: any) => ({
      resourceName: row.recommendation.resource_name,
      type: row.recommendation.type,
      campaignName: row.campaign?.name,
      currentBudget: row.recommendation.campaign_budget_recommendation?.current_budget_amount_micros
        ? microsToDollars(row.recommendation.campaign_budget_recommendation.current_budget_amount_micros)
        : null,
      recommendedBudget: row.recommendation.campaign_budget_recommendation?.recommended_budget_amount_micros
        ? microsToDollars(row.recommendation.campaign_budget_recommendation.recommended_budget_amount_micros)
        : null,
      impact: {
        base: {
          impressions: row.recommendation.impact?.base_metrics?.impressions || 0,
          clicks: row.recommendation.impact?.base_metrics?.clicks || 0,
          cost: microsToDollars(row.recommendation.impact?.base_metrics?.cost_micros || 0),
        },
        potential: {
          impressions: row.recommendation.impact?.potential_metrics?.impressions || 0,
          clicks: row.recommendation.impact?.potential_metrics?.clicks || 0,
          cost: microsToDollars(row.recommendation.impact?.potential_metrics?.cost_micros || 0),
        },
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        recommendations,
        total: recommendations.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error getting recommendations:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// EXPERIMENT HANDLERS
// ============================================

async function listExperiments(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        experiment.resource_name,
        experiment.name,
        experiment.description,
        experiment.status,
        experiment.start_date,
        experiment.end_date,
        experiment.goals
      FROM experiment
      WHERE experiment.status != 'REMOVED'
      ORDER BY experiment.name
      LIMIT 50
    `;

    const results = await client.query(query);

    const experiments = results.map((row: any) => ({
      resourceName: row.experiment.resource_name,
      name: row.experiment.name,
      description: row.experiment.description,
      status: row.experiment.status,
      startDate: row.experiment.start_date,
      endDate: row.experiment.end_date,
      goals: row.experiment.goals,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        experiments,
        total: experiments.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error listing experiments:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createExperiment(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: CreateExperimentRequest = JSON.parse(event.body || '{}');
  const { customerId, name, baseCampaignResourceName, trafficSplitPercent, startDate, endDate } = body;

  if (!customerId || !name || !baseCampaignResourceName || !trafficSplitPercent || !startDate) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, name, baseCampaignResourceName, trafficSplitPercent, and startDate are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const experimentOperation = {
      create: {
        name,
        type: 'SEARCH_CUSTOM',
        status: 'SETUP',
        start_date: startDate,
        end_date: endDate,
        goals: [{
          metric: 'CLICKS',
          direction: 'INCREASE',
        }],
      },
    };

    const response = await (client as any).experiments.create([experimentOperation]);
    const resourceName = response.results[0].resource_name;

    console.log(`[GoogleAdsAccount] Created experiment: ${resourceName}`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        experiment: {
          resourceName,
          name,
          status: 'SETUP',
        },
        message: 'Experiment created. Add experiment arms to complete setup.',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error creating experiment:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// BILLING HANDLERS
// ============================================

async function getBillingInfo(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Get billing setup info
    const query = `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        billing_setup.id,
        billing_setup.status,
        billing_setup.payments_account,
        billing_setup.payments_account_info.payments_account_name,
        billing_setup.start_date_time,
        billing_setup.end_date_time
      FROM billing_setup
      WHERE billing_setup.status = 'APPROVED'
      LIMIT 10
    `;

    const results = await client.query(query);

    const billingSetups = results.map((row: any) => ({
      id: row.billing_setup?.id?.toString(),
      status: row.billing_setup?.status,
      paymentsAccount: row.billing_setup?.payments_account,
      paymentsAccountName: row.billing_setup?.payments_account_info?.payments_account_name,
      startDateTime: row.billing_setup?.start_date_time,
      endDateTime: row.billing_setup?.end_date_time,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        billing: {
          customerId,
          customerName: results[0]?.customer?.descriptive_name,
          currencyCode: results[0]?.customer?.currency_code,
          billingSetups,
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error getting billing info:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// CHANGE HISTORY HANDLERS
// ============================================

async function getChangeHistory(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const limit = parseInt(event.queryStringParameters?.limit || '50', 10);

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        change_event.resource_name,
        change_event.change_date_time,
        change_event.change_resource_type,
        change_event.change_resource_name,
        change_event.resource_change_operation,
        change_event.user_email,
        change_event.client_type,
        campaign.name,
        ad_group.name
      FROM change_event
      ORDER BY change_event.change_date_time DESC
      LIMIT ${limit}
    `;

    const results = await client.query(query);

    const changes = results.map((row: any) => ({
      resourceName: row.change_event.resource_name,
      changeDateTime: row.change_event.change_date_time,
      resourceType: row.change_event.change_resource_type,
      changedResource: row.change_event.change_resource_name,
      operation: row.change_event.resource_change_operation,
      userEmail: row.change_event.user_email,
      clientType: row.change_event.client_type,
      campaignName: row.campaign?.name,
      adGroupName: row.ad_group?.name,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        changes,
        total: changes.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error getting change history:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// LABEL HANDLERS
// ============================================

async function listLabels(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        label.id,
        label.name,
        label.resource_name,
        label.status,
        label.text_label.background_color,
        label.text_label.description
      FROM label
      WHERE label.status = 'ENABLED'
      ORDER BY label.name
      LIMIT 100
    `;

    const results = await client.query(query);

    const labels = results.map((row: any) => ({
      id: row.label.id?.toString(),
      name: row.label.name,
      resourceName: row.label.resource_name,
      status: row.label.status,
      backgroundColor: row.label.text_label?.background_color,
      description: row.label.text_label?.description,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        labels,
        total: labels.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error listing labels:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createLabel(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { customerId, name, backgroundColor, description } = body;

  if (!customerId || !name) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId and name are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const labelOperation = {
      create: {
        name,
        text_label: {
          background_color: backgroundColor || '#336699',
          description: description || '',
        },
      },
    };

    const response = await (client as any).labels.create([labelOperation]);
    const resourceName = response.results[0].resource_name;

    console.log(`[GoogleAdsAccount] Created label: ${resourceName}`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        label: {
          resourceName,
          name,
        },
        message: 'Label created successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAccount] Error creating label:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

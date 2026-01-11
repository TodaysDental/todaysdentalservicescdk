/**
 * Google Ads Conversions Lambda
 * 
 * Handles conversion tracking features:
 * - Conversion action CRUD
 * - Offline conversion uploads
 * - Conversion tracking tag generation
 * 
 * Endpoints:
 * - GET /google-ads/conversions - List conversion actions
 * - POST /google-ads/conversions - Create conversion action
 * - GET /google-ads/conversions/{id} - Get conversion action
 * - PUT /google-ads/conversions/{id} - Update conversion action
 * - POST /google-ads/conversions/upload - Upload offline conversions
 * - GET /google-ads/conversions/tag - Get conversion tracking tag
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
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

interface CreateConversionActionRequest {
  customerId: string;
  name: string;
  category: 'DEFAULT' | 'PAGE_VIEW' | 'PURCHASE' | 'SIGNUP' | 'LEAD' | 'DOWNLOAD' | 'ADD_TO_CART' | 'BEGIN_CHECKOUT' | 'SUBSCRIBE_PAID' | 'PHONE_CALL_LEAD' | 'IMPORTED_LEAD' | 'SUBMIT_LEAD_FORM' | 'BOOK_APPOINTMENT' | 'REQUEST_QUOTE' | 'GET_DIRECTIONS' | 'OUTBOUND_CLICK' | 'CONTACT' | 'ENGAGEMENT' | 'STORE_VISIT' | 'STORE_SALE';
  type: 'WEBPAGE' | 'CLICK_TO_CALL' | 'APP' | 'UPLOAD';
  countingType?: 'ONE_PER_CLICK' | 'MANY_PER_CLICK';
  defaultValue?: number;
  status?: 'ENABLED' | 'REMOVED' | 'HIDDEN';
}

interface OfflineConversionUpload {
  customerId: string;
  conversionActionId: string;
  conversions: Array<{
    gclid?: string;
    conversionDateTime: string; // Format: "yyyy-MM-dd HH:mm:ss+|-HH:mm"
    conversionValue?: number;
    currencyCode?: string;
    orderId?: string;
  }>;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;
  const pathParts = path.split('/').filter(Boolean);

  console.log(`[GoogleAdsConversions] ${method} ${path}`);

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
    // Route: GET /google-ads/conversions - List conversion actions
    if (method === 'GET' && path.endsWith('/conversions')) {
      return await listConversionActions(event, corsHeaders);
    }

    // Route: POST /google-ads/conversions - Create conversion action
    if (method === 'POST' && path.endsWith('/conversions')) {
      return await createConversionAction(event, corsHeaders);
    }

    // Route: GET /google-ads/conversions/{id}
    if (method === 'GET' && pathParts.includes('conversions') && pathParts.length > pathParts.indexOf('conversions') + 1 && !path.includes('/upload') && !path.includes('/tag')) {
      return await getConversionAction(event, corsHeaders);
    }

    // Route: PUT /google-ads/conversions/{id}
    if (method === 'PUT' && pathParts.includes('conversions')) {
      return await updateConversionAction(event, corsHeaders);
    }

    // Route: POST /google-ads/conversions/upload - Upload offline conversions
    if (method === 'POST' && path.includes('/conversions/upload')) {
      return await uploadOfflineConversions(event, corsHeaders);
    }

    // Route: GET /google-ads/conversions/tag - Get conversion tracking tag
    if (method === 'GET' && path.includes('/conversions/tag')) {
      return await getConversionTag(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsConversions] Error:', error);
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
// CONVERSION ACTION HANDLERS
// ============================================

async function listConversionActions(
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
        conversion_action.id,
        conversion_action.name,
        conversion_action.resource_name,
        conversion_action.category,
        conversion_action.type,
        conversion_action.status,
        conversion_action.counting_type,
        conversion_action.value_settings.default_value,
        conversion_action.value_settings.default_currency_code,
        conversion_action.tag_snippets
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      ORDER BY conversion_action.name
      LIMIT 100
    `;

    const results = await client.query(query);

    const conversionActions = results.map((row: any) => ({
      id: row.conversion_action.id?.toString(),
      name: row.conversion_action.name,
      resourceName: row.conversion_action.resource_name,
      category: row.conversion_action.category,
      type: row.conversion_action.type,
      status: row.conversion_action.status,
      countingType: row.conversion_action.counting_type,
      valueSettings: {
        defaultValue: row.conversion_action.value_settings?.default_value,
        defaultCurrencyCode: row.conversion_action.value_settings?.default_currency_code,
      },
      hasTagSnippets: !!row.conversion_action.tag_snippets?.length,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        conversionActions,
        total: conversionActions.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsConversions] Error listing conversion actions:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createConversionAction(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: CreateConversionActionRequest = JSON.parse(event.body || '{}');
  const { customerId, name, category, type, countingType = 'ONE_PER_CLICK', defaultValue, status = 'ENABLED' } = body;

  if (!customerId || !name || !category || !type) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, name, category, and type are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const conversionActionOperation = {
      create: {
        name,
        category,
        type,
        counting_type: countingType,
        status,
        value_settings: defaultValue ? {
          default_value: defaultValue,
          always_use_default_value: false,
        } : undefined,
      },
    };

    const response = await (client as any).conversionActions.create([conversionActionOperation]);
    const resourceName = response.results[0].resource_name;
    const actionId = resourceName.split('/').pop();

    console.log(`[GoogleAdsConversions] Created conversion action: ${resourceName}`);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        conversionAction: {
          id: actionId,
          resourceName,
          name,
          category,
          type,
          status,
        },
        message: 'Conversion action created successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsConversions] Error creating conversion action:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function getConversionAction(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const conversionActionId = event.pathParameters?.id;
  const customerId = event.queryStringParameters?.customerId;

  if (!conversionActionId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'conversionActionId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    const query = `
      SELECT
        conversion_action.id,
        conversion_action.name,
        conversion_action.resource_name,
        conversion_action.category,
        conversion_action.type,
        conversion_action.status,
        conversion_action.counting_type,
        conversion_action.value_settings.default_value,
        conversion_action.value_settings.default_currency_code,
        conversion_action.tag_snippets,
        conversion_action.attribution_model_settings.attribution_model,
        conversion_action.attribution_model_settings.data_driven_model_status
      FROM conversion_action
      WHERE conversion_action.id = ${conversionActionId}
    `;

    const results = await client.query(query);

    if (results.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Conversion action not found' }),
      };
    }

    const row = results[0];
    const ca = row.conversion_action;
    const conversionAction = {
      id: ca?.id?.toString() || '',
      name: ca?.name || '',
      resourceName: ca?.resource_name || '',
      category: ca?.category || '',
      type: ca?.type || '',
      status: ca?.status || '',
      countingType: ca?.counting_type || '',
      valueSettings: {
        defaultValue: ca?.value_settings?.default_value,
        defaultCurrencyCode: ca?.value_settings?.default_currency_code,
      },
      tagSnippets: ca?.tag_snippets,
      attributionModel: ca?.attribution_model_settings?.attribution_model,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        conversionAction,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsConversions] Error getting conversion action:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function updateConversionAction(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const conversionActionId = event.pathParameters?.id;
  const body = JSON.parse(event.body || '{}');
  const { customerId, name, status, countingType, defaultValue } = body;

  if (!conversionActionId || !customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'conversionActionId and customerId are required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const resourceName = `customers/${customerId}/conversionActions/${conversionActionId}`;

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

    if (status) {
      updateOperation.update.status = status;
      updateOperation.update_mask.paths.push('status');
    }

    if (countingType) {
      updateOperation.update.counting_type = countingType;
      updateOperation.update_mask.paths.push('counting_type');
    }

    if (updateOperation.update_mask.paths.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No fields to update' }),
      };
    }

    await (client as any).conversionActions.update([updateOperation]);

    console.log(`[GoogleAdsConversions] Updated conversion action: ${resourceName}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Conversion action updated successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsConversions] Error updating conversion action:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// OFFLINE CONVERSION UPLOAD
// ============================================

async function uploadOfflineConversions(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: OfflineConversionUpload = JSON.parse(event.body || '{}');
  const { customerId, conversionActionId, conversions } = body;

  if (!customerId || !conversionActionId || !conversions?.length) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'customerId, conversionActionId, and conversions are required',
      }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);
    const conversionActionResourceName = `customers/${customerId}/conversionActions/${conversionActionId}`;

    const clickConversions = conversions.map(conv => ({
      gclid: conv.gclid,
      conversion_action: conversionActionResourceName,
      conversion_date_time: conv.conversionDateTime,
      conversion_value: conv.conversionValue,
      currency_code: conv.currencyCode || 'USD',
      order_id: conv.orderId,
    }));

    const response = await (client as any).conversionUploadService.uploadClickConversions({
      customer_id: customerId,
      conversions: clickConversions,
      partial_failure: true,
    });

    const uploadedCount = response.results?.length || 0;
    const failedCount = conversions.length - uploadedCount;

    console.log(`[GoogleAdsConversions] Uploaded ${uploadedCount} offline conversions`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        uploadedCount,
        failedCount,
        message: `Uploaded ${uploadedCount} conversions${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsConversions] Error uploading offline conversions:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// CONVERSION TRACKING TAG
// ============================================

async function getConversionTag(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const conversionActionId = event.queryStringParameters?.conversionActionId;

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    const client = await getGoogleAdsClient(customerId);

    // Get account-level conversion linker tag
    const accountQuery = `
      SELECT customer.id, customer.conversion_tracking_setting.google_ads_conversion_customer
      FROM customer
      WHERE customer.id = ${customerId}
    `;

    const accountResults = await client.query(accountQuery);
    const conversionCustomerId = accountResults[0]?.customer?.conversion_tracking_setting?.google_ads_conversion_customer || customerId;

    // Generate the global site tag
    const globalSiteTag = `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-${conversionCustomerId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-${conversionCustomerId}');
</script>
`.trim();

    let conversionSnippet = '';
    if (conversionActionId) {
      // Get specific conversion action tag
      const actionQuery = `
        SELECT
          conversion_action.id,
          conversion_action.tag_snippets
        FROM conversion_action
        WHERE conversion_action.id = ${conversionActionId}
      `;

      const actionResults = await client.query(actionQuery);
      if (actionResults[0]?.conversion_action?.tag_snippets?.length) {
        const snippet = actionResults[0].conversion_action.tag_snippets[0];
        conversionSnippet = `
<!-- Event snippet for conversion -->
<script>
  gtag('event', 'conversion', {
    'send_to': 'AW-${conversionCustomerId}/${conversionActionId}'
  });
</script>
`.trim();
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        conversionCustomerId,
        globalSiteTag,
        conversionSnippet: conversionSnippet || null,
        instructions: {
          step1: 'Add the Global Site Tag to all pages of your website, inside the <head> section.',
          step2: 'Add the Event Snippet on the conversion page (e.g., thank you page) or trigger it via JavaScript when a conversion occurs.',
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsConversions] Error getting conversion tag:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

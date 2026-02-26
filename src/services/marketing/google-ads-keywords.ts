/**
 * Google Ads Keyword Management Lambda
 * 
 * Handles keyword operations including add, delete, and negative keywords.
 * Uses global MCC credentials - customerId is passed as a parameter.
 * 
 * Endpoints:
 * - GET /google-ads/keywords/fetch - Fetch keywords from ad group
 * - POST /google-ads/keywords/add - Add keywords to ad group
 * - POST /google-ads/keywords/delete - Delete selected keywords
 * - GET /google-ads/keywords/negatives - Get negative keywords
 * - POST /google-ads/keywords/negatives - Add negative keywords
 * - DELETE /google-ads/keywords/negatives/{id} - Remove negative keyword
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';
import {
  getGoogleAdsClient,
  getKeywords,
  executeGoogleAdsQuery,
  addKeywords as addKeywordsToGoogle,
  removeKeywords as removeKeywordsFromGoogle,
  addNegativeKeywords as addNegativeKeywordsToGoogle,
} from '../../shared/utils/google-ads-client';

// Module permission configuration
const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const GOOGLE_ADS_KEYWORDS_TABLE = process.env.GOOGLE_ADS_KEYWORDS_TABLE || 'GoogleAdsKeywords';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface AddKeywordsRequest {
  customerId: string;
  adGroupResourceName: string;
  keywords: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;
}

interface DeleteKeywordsRequest {
  customerId: string;
  keywordResourceNames: string[];
}

interface AddNegativeKeywordsRequest {
  customerId: string;
  adGroupResourceName?: string; // Optional - for ad group level
  campaignResourceName?: string; // Optional - for campaign level
  level: 'AD_GROUP' | 'CAMPAIGN'; // Specify the level
  keywords: Array<{
    text: string;
    matchType?: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;
}

// Default negative keywords for dental practices
const DENTAL_NEGATIVE_KEYWORD_TEMPLATES = {
  basic: [
    'free', 'cheap', 'diy', 'how to', 'jobs', 'career', 'salary', 'school',
    'classes', 'training', 'certification', 'degree', 'assistant', 'hygienist',
  ],
  competitors: [
    'aspen dental', 'heartland dental', 'pacific dental', 'western dental',
  ],
  irrelevant: [
    'dog', 'cat', 'pet', 'animal', 'veterinary', 'vet',
    'insurance', 'malpractice', 'lawsuit', 'complaint',
  ],
};

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = await buildCorsHeadersAsync({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;

  console.log(`[GoogleAdsKeywords] ${method} ${path}`);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
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
    // Route: GET /google-ads/keywords/fetch
    if (method === 'GET' && path.includes('/keywords/fetch')) {
      return await fetchKeywords(event, corsHeaders);
    }

    // Route: POST /google-ads/keywords/add
    if (method === 'POST' && path.includes('/keywords/add')) {
      return await addKeywords(event, corsHeaders);
    }

    // Route: POST /google-ads/keywords/delete
    if (method === 'POST' && path.includes('/keywords/delete')) {
      return await deleteKeywords(event, corsHeaders);
    }

    // Route: GET /google-ads/keywords/negatives
    if (method === 'GET' && path.includes('/keywords/negatives')) {
      return await getNegativeKeywords(event, corsHeaders);
    }

    // Route: POST /google-ads/keywords/negatives
    if (method === 'POST' && path.includes('/keywords/negatives')) {
      return await addNegativeKeywords(event, corsHeaders);
    }

    // Route: DELETE /google-ads/keywords/negatives/{id}
    if (method === 'DELETE' && path.includes('/keywords/negatives')) {
      return await removeNegativeKeyword(event, corsHeaders);
    }

    // Route: GET /google-ads/keywords/templates - Get negative keyword templates
    if (method === 'GET' && path.includes('/keywords/templates')) {
      return await getNegativeKeywordTemplates(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsKeywords] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message || 'Internal server error',
      }),
    };
  }
}

// ============================================
// KEYWORD HANDLERS
// ============================================

async function fetchKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const adGroupResourceName = event.queryStringParameters?.adGroupResourceName;
  const campaignResourceName = event.queryStringParameters?.campaignResourceName;

  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId is required' }),
    };
  }

  try {
    let keywords: any[] = [];

    if (adGroupResourceName) {
      // Fetch from specific ad group
      keywords = await getKeywords(customerId, adGroupResourceName);
    } else if (campaignResourceName) {
      // Fetch all keywords for campaign
      const query = `
        SELECT
          ad_group_criterion.resource_name,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status,
          ad_group.resource_name,
          ad_group.name
        FROM ad_group_criterion
        WHERE ad_group.campaign = '${campaignResourceName}'
          AND ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.status != 'REMOVED'
      `;
      keywords = await executeGoogleAdsQuery(customerId, query);
    } else {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Either adGroupResourceName or campaignResourceName is required' }),
      };
    }

    const formattedKeywords = keywords.map(kw => ({
      resourceName: kw.ad_group_criterion?.resource_name,
      text: kw.ad_group_criterion?.keyword?.text,
      matchType: kw.ad_group_criterion?.keyword?.match_type,
      status: kw.ad_group_criterion?.status,
      adGroupResourceName: kw.ad_group?.resource_name,
      adGroupName: kw.ad_group?.name,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        keywords: formattedKeywords,
        total: formattedKeywords.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsKeywords] Error fetching keywords:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function addKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  console.log('[GoogleAdsKeywords] addKeywords called with body:', event.body);

  let body: AddKeywordsRequest;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (parseError: any) {
    console.error('[GoogleAdsKeywords] Failed to parse request body:', parseError.message);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Invalid JSON in request body',
      }),
    };
  }

  const { customerId, adGroupResourceName, keywords } = body;

  // Validate required fields
  if (!customerId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Missing required field: customerId',
      }),
    };
  }

  if (!adGroupResourceName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Missing required field: adGroupResourceName',
      }),
    };
  }

  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Missing or invalid required field: keywords (must be non-empty array)',
      }),
    };
  }

  // Validate each keyword has required fields
  const validMatchTypes = ['EXACT', 'PHRASE', 'BROAD'];
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    if (!kw.text || typeof kw.text !== 'string' || kw.text.trim().length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: `Invalid keyword at index ${i}: text is required and must be non-empty`,
        }),
      };
    }
    if (!kw.matchType || !validMatchTypes.includes(kw.matchType)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: `Invalid keyword at index ${i}: matchType must be one of ${validMatchTypes.join(', ')}`,
        }),
      };
    }
  }

  console.log(`[GoogleAdsKeywords] Adding ${keywords.length} keywords to customerId=${customerId}, adGroup=${adGroupResourceName}`);
  console.log('[GoogleAdsKeywords] Keywords:', JSON.stringify(keywords));

  try {
    const response = await addKeywordsToGoogle(customerId, adGroupResourceName, keywords);
    console.log('[GoogleAdsKeywords] Successfully added keywords, response:', JSON.stringify(response));

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        addedCount: keywords.length,
        message: `Successfully added ${keywords.length} keywords`,
        response,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsKeywords] Error adding keywords:', error);
    console.error('[GoogleAdsKeywords] Error stack:', error.stack);

    // Extract more detailed error information from Google Ads API errors
    let errorMessage = error.message || 'Unknown error occurred';
    let errorDetails: any = {};

    // Check for Google Ads API specific error structure
    if (error.errors && Array.isArray(error.errors)) {
      errorDetails.googleAdsErrors = error.errors.map((e: any) => ({
        message: e.message,
        errorCode: e.errorCode,
        trigger: e.trigger,
        location: e.location,
      }));
      errorMessage = error.errors.map((e: any) => e.message).join('; ');
    }

    // Check for request validation errors
    if (error.code) {
      errorDetails.code = error.code;
    }

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        details: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
        customerId,
        adGroupResourceName,
        keywordCount: keywords.length,
      }),
    };
  }
}

async function deleteKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: DeleteKeywordsRequest = JSON.parse(event.body || '{}');
  const { customerId, keywordResourceNames } = body;

  if (!customerId || !keywordResourceNames || keywordResourceNames.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: customerId, keywordResourceNames',
      }),
    };
  }

  try {
    await removeKeywordsFromGoogle(customerId, keywordResourceNames);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        deletedCount: keywordResourceNames.length,
        message: `Successfully deleted ${keywordResourceNames.length} keywords`,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsKeywords] Error deleting keywords:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// ============================================
// NEGATIVE KEYWORD HANDLERS
// ============================================

async function getNegativeKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const adGroupResourceName = event.queryStringParameters?.adGroupResourceName;
  const campaignResourceName = event.queryStringParameters?.campaignResourceName;

  if (!customerId || (!adGroupResourceName && !campaignResourceName)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId and either adGroupResourceName or campaignResourceName are required' }),
    };
  }

  try {
    let formattedKeywords: any[] = [];

    if (campaignResourceName) {
      // Campaign-level negative keywords use campaign_criterion
      const query = `
        SELECT
          campaign_criterion.resource_name,
          campaign_criterion.keyword.text,
          campaign_criterion.keyword.match_type,
          campaign_criterion.negative
        FROM campaign_criterion
        WHERE campaign_criterion.campaign = '${campaignResourceName}'
          AND campaign_criterion.type = 'KEYWORD'
          AND campaign_criterion.negative = TRUE
      `;

      const negativeKeywords = await executeGoogleAdsQuery(customerId, query);

      formattedKeywords = negativeKeywords.map(nk => ({
        resourceName: nk.campaign_criterion?.resource_name,
        text: nk.campaign_criterion?.keyword?.text,
        matchType: nk.campaign_criterion?.keyword?.match_type,
      }));
    } else {
      // Ad group-level negative keywords use ad_group_criterion
      const query = `
        SELECT
          ad_group_criterion.resource_name,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.negative
        FROM ad_group_criterion
        WHERE ad_group_criterion.ad_group = '${adGroupResourceName}'
          AND ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.negative = TRUE
          AND ad_group_criterion.status != 'REMOVED'
      `;

      const negativeKeywords = await executeGoogleAdsQuery(customerId, query);

      formattedKeywords = negativeKeywords.map(nk => ({
        resourceName: nk.ad_group_criterion?.resource_name,
        text: nk.ad_group_criterion?.keyword?.text,
        matchType: nk.ad_group_criterion?.keyword?.match_type,
      }));
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        negativeKeywords: formattedKeywords,
        total: formattedKeywords.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsKeywords] Error fetching negative keywords:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function addNegativeKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: AddNegativeKeywordsRequest = JSON.parse(event.body || '{}');
  const { customerId, adGroupResourceName, campaignResourceName, level = 'AD_GROUP', keywords } = body;

  if (!customerId || !keywords || keywords.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: customerId, keywords',
      }),
    };
  }

  if (level === 'AD_GROUP' && !adGroupResourceName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'adGroupResourceName is required for AD_GROUP level negative keywords',
      }),
    };
  }

  if (level === 'CAMPAIGN' && !campaignResourceName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'campaignResourceName is required for CAMPAIGN level negative keywords',
      }),
    };
  }

  try {
    if (level === 'AD_GROUP') {
      // Ad group level negative keywords
      await addNegativeKeywordsToGoogle(customerId, adGroupResourceName!, keywords);
    } else {
      // Campaign level negative keywords use CampaignCriterionService
      const client = await getGoogleAdsClient(customerId);

      // The library's .create() method auto-wraps in {create: ...}, so pass resources directly
      const resources = keywords.map(kw => ({
        campaign: campaignResourceName,
        negative: true,
        keyword: {
          text: kw.text.trim(),
          match_type: kw.matchType ? (kw.matchType === 'EXACT' ? 2 : kw.matchType === 'PHRASE' ? 3 : 4) : 3,
        },
      }));

      console.log('[GoogleAdsKeywords] Campaign-level negative keyword resources:', JSON.stringify(resources));
      await (client as any).campaignCriteria.create(resources);
    }

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        addedCount: keywords.length,
        level,
        message: `Successfully added ${keywords.length} negative keywords at ${level} level`,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsKeywords] Error adding negative keywords:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function removeNegativeKeyword(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const customerId = event.queryStringParameters?.customerId;
  const resourceName = event.pathParameters?.id || event.queryStringParameters?.resourceName;

  if (!customerId || !resourceName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'customerId and resourceName are required' }),
    };
  }

  try {
    await removeKeywordsFromGoogle(customerId, [resourceName]);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Negative keyword removed successfully',
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsKeywords] Error removing negative keyword:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

/**
 * Get pre-defined negative keyword templates for dental practices
 */
async function getNegativeKeywordTemplates(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const category = event.queryStringParameters?.category;

  const templates = {
    basic: {
      name: 'Basic Exclusions',
      description: 'Common irrelevant terms that waste ad spend',
      keywords: DENTAL_NEGATIVE_KEYWORD_TEMPLATES.basic,
    },
    competitors: {
      name: 'Competitor Names',
      description: 'Exclude searches for competitor dental chains',
      keywords: DENTAL_NEGATIVE_KEYWORD_TEMPLATES.competitors,
    },
    irrelevant: {
      name: 'Irrelevant Terms',
      description: 'Terms unrelated to dental services',
      keywords: DENTAL_NEGATIVE_KEYWORD_TEMPLATES.irrelevant,
    },
    all: {
      name: 'All Recommended',
      description: 'Complete list of recommended negative keywords for dental practices',
      keywords: [
        ...DENTAL_NEGATIVE_KEYWORD_TEMPLATES.basic,
        ...DENTAL_NEGATIVE_KEYWORD_TEMPLATES.competitors,
        ...DENTAL_NEGATIVE_KEYWORD_TEMPLATES.irrelevant,
      ],
    },
  };

  if (category && templates[category as keyof typeof templates]) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        template: templates[category as keyof typeof templates],
      }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      templates: {
        basic: templates.basic,
        competitors: templates.competitors,
        irrelevant: templates.irrelevant,
      },
      allKeywords: templates.all.keywords,
      totalKeywords: templates.all.keywords.length,
    }),
  };
}

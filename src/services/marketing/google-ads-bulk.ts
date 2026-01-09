/**
 * Google Ads Bulk Operations Lambda
 * 
 * Handles bulk operations across multiple customer accounts.
 * Uses global MCC credentials - customerIds are passed as parameters.
 * 
 * Endpoints:
 * - GET /google-ads/bulk/clinics - Get all clinics for selection
 * - POST /google-ads/bulk/publish - Bulk publish campaigns to selected accounts
 * - POST /google-ads/bulk/keywords - Bulk add keywords to selected accounts
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getAllClinicsWithGoogleAdsStatus,
  getGoogleAdsClient,
  dollarsToMicros,
  addKeywords as addKeywordsToGoogle,
} from '../../shared/utils/google-ads-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const GOOGLE_ADS_CAMPAIGNS_TABLE = process.env.GOOGLE_ADS_CAMPAIGNS_TABLE || 'GoogleAdsCampaigns';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface BulkPublishRequest {
  customerIds: string[];
  campaignTemplate: {
    name: string;
    type: 'SEARCH' | 'DISPLAY';
    dailyBudget: number;
    status: 'ENABLED' | 'PAUSED';
    // Smart bidding options
    biddingStrategy?: 'MANUAL_CPC' | 'TARGET_CPA' | 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CLICKS';
    targetCpa?: number;
  };
  // Ad group template (required for functional campaigns)
  adGroupTemplate?: {
    name: string; // Use {{clinicName}} placeholder
    cpcBid?: number; // Default CPC bid in dollars
  };
  // Ad template for responsive search ads
  adTemplate?: {
    headlines: string[]; // Use {{clinicName}}, {{city}} placeholders
    descriptions: string[];
    finalUrlTemplate: string; // e.g., "https://{{domain}}/schedule"
    path1?: string;
    path2?: string;
  };
  // Default keywords to add
  defaultKeywords?: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;
  // Default negative keywords
  defaultNegativeKeywords?: string[];
}

interface BulkKeywordsRequest {
  customerIds: string[];
  adGroupResourceName: string;
  keywords: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  }>;
}

interface BulkOperationResult {
  total: number;
  successful: Array<{
    customerId: string;
    campaignId?: string;
    message?: string;
  }>;
  failed: Array<{
    customerId: string;
    error: string;
  }>;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;

  console.log(`[GoogleAdsBulk] ${method} ${path}`);

  try {
    // Route: GET /google-ads/bulk/clinics
    if (method === 'GET' && path.includes('/bulk/clinics')) {
      return await listClinicsForSelection(event, corsHeaders);
    }

    // Route: POST /google-ads/bulk/publish
    if (method === 'POST' && path.includes('/bulk/publish')) {
      return await bulkPublishCampaigns(event, corsHeaders);
    }

    // Route: POST /google-ads/bulk/keywords
    if (method === 'POST' && path.includes('/bulk/keywords')) {
      return await bulkAddKeywords(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsBulk] Error:', error);
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
// BULK OPERATION HANDLERS
// ============================================

async function listClinicsForSelection(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const filterConfigured = event.queryStringParameters?.configured === 'true';

  try {
    const clinics = await getAllClinicsWithGoogleAdsStatus();

    // Sort by clinic name
    clinics.sort((a, b) => a.clinicName.localeCompare(b.clinicName));

    // Filter to only configured clinics if requested
    const filteredClinics = filterConfigured 
      ? clinics.filter(c => c.hasGoogleAds)
      : clinics;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        clinics: filteredClinics,
        total: filteredClinics.length,
        configured: clinics.filter(c => c.hasGoogleAds).length,
        unconfigured: clinics.filter(c => !c.hasGoogleAds).length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsBulk] Error listing clinics:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function bulkPublishCampaigns(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: BulkPublishRequest = JSON.parse(event.body || '{}');
  const { customerIds, campaignTemplate, adGroupTemplate, adTemplate, defaultKeywords, defaultNegativeKeywords } = body;

  if (!customerIds || customerIds.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No customerIds provided' }),
    };
  }

  if (!campaignTemplate || !campaignTemplate.name || !campaignTemplate.dailyBudget) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: campaignTemplate with name and dailyBudget',
      }),
    };
  }

  console.log(`[GoogleAdsBulk] Publishing to ${customerIds.length} accounts`);

  // Get clinic configs for placeholder replacement
  const clinics = await getAllClinicsWithGoogleAdsStatus();
  const clinicMap = new Map(clinics.map(c => [c.customerId, c]));

  const result: BulkOperationResult = {
    total: customerIds.length,
    successful: [],
    failed: [],
  };

  // Helper to replace placeholders
  const replacePlaceholders = (text: string, clinic: any): string => {
    return text
      .replace(/\{\{clinicName\}\}/g, clinic.clinicName || '')
      .replace(/\{\{city\}\}/g, clinic.clinicCity || '')
      .replace(/\{\{state\}\}/g, clinic.clinicState || '')
      .replace(/\{\{domain\}\}/g, clinic.domain || 'example.com');
  };

  // Process accounts in parallel batches of 3
  const batchSize = 3;
  for (let i = 0; i < customerIds.length; i += batchSize) {
    const batch = customerIds.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (customerId) => {
      const clinic = clinicMap.get(customerId);
      
      try {
        console.log(`[GoogleAdsBulk] Creating campaign for ${customerId} (${clinic?.clinicName || 'Unknown'})`);
        
        const client = await getGoogleAdsClient(customerId);
        const campaignName = replacePlaceholders(campaignTemplate.name, clinic || {});

        // Create budget first
        const budgetOperation = {
          create: {
            name: `Budget - ${campaignName} - ${Date.now()}`,
            amount_micros: dollarsToMicros(campaignTemplate.dailyBudget),
            delivery_method: 'STANDARD',
          },
        };

        const budgetResponse = await (client as any).campaignBudgets.create([budgetOperation]);
        const budgetResourceName = budgetResponse.results[0].resource_name;

        // Build bidding configuration
        const biddingConfig: any = {};
        switch (campaignTemplate.biddingStrategy || 'MANUAL_CPC') {
          case 'MANUAL_CPC':
            biddingConfig.manual_cpc = { enhanced_cpc_enabled: true };
            break;
          case 'TARGET_CPA':
            biddingConfig.target_cpa = { target_cpa_micros: dollarsToMicros(campaignTemplate.targetCpa || 50) };
            break;
          case 'MAXIMIZE_CONVERSIONS':
            biddingConfig.maximize_conversions = {};
            break;
          case 'MAXIMIZE_CLICKS':
            biddingConfig.maximize_clicks = {};
            break;
        }

        // Create campaign
        const campaignOperation = {
          create: {
            name: campaignName,
            status: campaignTemplate.status || 'PAUSED',
            advertising_channel_type: campaignTemplate.type || 'SEARCH',
            campaign_budget: budgetResourceName,
            ...biddingConfig,
            network_settings: campaignTemplate.type === 'SEARCH' ? {
              target_google_search: true,
              target_search_network: true,
            } : undefined,
          },
        };

        const campaignResponse = await (client as any).campaigns.create([campaignOperation]);
        const campaignResourceName = campaignResponse.results[0].resource_name;
        const googleCampaignId = campaignResourceName.split('/').pop();

        let adGroupResourceName: string | undefined;
        let adCreated = false;
        let keywordsAdded = 0;
        let negativeKeywordsAdded = 0;

        // Create Ad Group if template provided
        if (adGroupTemplate) {
          const adGroupName = replacePlaceholders(adGroupTemplate.name || `${campaignName} - Ad Group`, clinic || {});
          
          const adGroupOperation = {
            create: {
              name: adGroupName,
              campaign: campaignResourceName,
              status: 'ENABLED',
              type: campaignTemplate.type === 'SEARCH' ? 'SEARCH_STANDARD' : 'DISPLAY_STANDARD',
              cpc_bid_micros: dollarsToMicros(adGroupTemplate.cpcBid || 2),
            },
          };

          const adGroupResponse = await (client as any).adGroups.create([adGroupOperation]);
          adGroupResourceName = adGroupResponse.results[0].resource_name;
          console.log(`[GoogleAdsBulk] Created ad group for ${customerId}: ${adGroupResourceName}`);

          // Create Responsive Search Ad if template provided
          if (adTemplate && campaignTemplate.type === 'SEARCH') {
            const headlines = adTemplate.headlines.map(h => ({
              text: replacePlaceholders(h, clinic || {}),
            }));
            const descriptions = adTemplate.descriptions.map(d => ({
              text: replacePlaceholders(d, clinic || {}),
            }));
            const finalUrl = replacePlaceholders(adTemplate.finalUrlTemplate, clinic || {});

            if (headlines.length >= 3 && descriptions.length >= 2) {
              const adOperation = {
                create: {
                  ad_group: adGroupResourceName,
                  status: 'ENABLED',
                  ad: {
                    responsive_search_ad: {
                      headlines: headlines.slice(0, 15),
                      descriptions: descriptions.slice(0, 4),
                      path1: adTemplate.path1,
                      path2: adTemplate.path2,
                    },
                    final_urls: [finalUrl],
                  },
                },
              };

              await (client as any).adGroupAds.create([adOperation]);
              adCreated = true;
              console.log(`[GoogleAdsBulk] Created ad for ${customerId}`);
            }
          }

          // Add default keywords if provided
          if (defaultKeywords && defaultKeywords.length > 0) {
            const keywordOperations = defaultKeywords.map(kw => ({
              create: {
                ad_group: adGroupResourceName,
                status: 'ENABLED',
                keyword: {
                  text: replacePlaceholders(kw.text, clinic || {}),
                  match_type: kw.matchType,
                },
              },
            }));

            await (client as any).adGroupCriteria.create(keywordOperations);
            keywordsAdded = defaultKeywords.length;
            console.log(`[GoogleAdsBulk] Added ${keywordsAdded} keywords for ${customerId}`);
          }

          // Add default negative keywords if provided
          if (defaultNegativeKeywords && defaultNegativeKeywords.length > 0) {
            const negativeKeywordOperations = defaultNegativeKeywords.map(text => ({
              create: {
                ad_group: adGroupResourceName,
                negative: true,
                keyword: {
                  text,
                  match_type: 'PHRASE',
                },
              },
            }));

            await (client as any).adGroupCriteria.create(negativeKeywordOperations);
            negativeKeywordsAdded = defaultNegativeKeywords.length;
            console.log(`[GoogleAdsBulk] Added ${negativeKeywordsAdded} negative keywords for ${customerId}`);
          }
        }

        // Store in DynamoDB with TTL
        const campaignId = `${customerId}-${googleCampaignId}`;
        const now = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days

        await ddb.send(new PutCommand({
          TableName: GOOGLE_ADS_CAMPAIGNS_TABLE,
          Item: {
            campaignId,
            customerId,
            googleCampaignId,
            name: campaignName,
            status: campaignTemplate.status || 'PAUSED',
            type: campaignTemplate.type || 'SEARCH',
            budget: campaignTemplate.dailyBudget,
            biddingStrategy: campaignTemplate.biddingStrategy || 'MANUAL_CPC',
            spent: 0,
            impressions: 0,
            clicks: 0,
            ctr: 0,
            conversions: 0,
            costPerConversion: 0,
            adGroupResourceName,
            createdAt: now,
            updatedAt: now,
            syncedAt: now,
            ttl,
          },
        }));

        result.successful.push({
          customerId,
          campaignId,
          message: `Campaign "${campaignName}" created${adGroupResourceName ? ' with ad group' : ''}${adCreated ? ' and ad' : ''}${keywordsAdded > 0 ? ` (${keywordsAdded} keywords)` : ''}`,
        });
      } catch (error: any) {
        console.error(`[GoogleAdsBulk] Error for account ${customerId}:`, error.message);
        result.failed.push({
          customerId,
          error: error.message,
        });
      }
    });

    await Promise.all(batchPromises);
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      result,
      message: `Published to ${result.successful.length} accounts, ${result.failed.length} failed`,
    }),
  };
}

async function bulkAddKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: BulkKeywordsRequest = JSON.parse(event.body || '{}');
  const { customerIds, adGroupResourceName, keywords } = body;

  if (!customerIds || customerIds.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No customerIds provided' }),
    };
  }

  if (!adGroupResourceName || !keywords || keywords.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required fields: adGroupResourceName and keywords',
      }),
    };
  }

  console.log(`[GoogleAdsBulk] Adding keywords to ${customerIds.length} accounts`);

  const result: BulkOperationResult = {
    total: customerIds.length,
    successful: [],
    failed: [],
  };

  // Process accounts in parallel batches of 3
  const batchSize = 3;
  for (let i = 0; i < customerIds.length; i += batchSize) {
    const batch = customerIds.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (customerId) => {
      try {
        console.log(`[GoogleAdsBulk] Adding keywords for ${customerId}`);

        await addKeywordsToGoogle(customerId, adGroupResourceName, keywords);

        result.successful.push({
          customerId,
          message: `Added ${keywords.length} keywords successfully`,
        });
      } catch (error: any) {
        console.error(`[GoogleAdsBulk] Error for account ${customerId}:`, error.message);
        result.failed.push({
          customerId,
          error: error.message,
        });
      }
    });

    await Promise.all(batchPromises);
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      result,
      message: `Added keywords to ${result.successful.length} accounts, ${result.failed.length} failed`,
    }),
  };
}

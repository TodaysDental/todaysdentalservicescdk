import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ayrshareBoostPost,
  ayrshareCreateAdCampaign,
  ayrshareGetAdCampaigns,
  ayrshareGetAdCampaign,
  ayrshareUpdateAdCampaign,
  ayrshareDeleteAdCampaign,
  ayrshareGetAdAnalytics,
  ayrshareGetAdAccount,
  BoostPostParams,
  CreateAdCampaignParams
} from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';
import clinicsData from '../../infrastructure/configs/clinics.json';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

// Type for clinic config from clinics.json
interface ClinicConfig {
  clinicId: string;
  clinicName: string;
  ayrshare?: {
    profileKey: string;
    refId: string;
    enabled: boolean;
    connectedPlatforms: string[];
    facebook?: {
      connected: boolean;
      pageId: string;
      pageName: string;
    };
  };
}

// Helper to get clinic config from clinics.json
function getClinicConfig(clinicId: string): ClinicConfig | undefined {
  return (clinicsData as ClinicConfig[]).find(c => c.clinicId === clinicId);
}

// Helper to get Ayrshare profile key for a clinic
async function getProfileKey(clinicId: string): Promise<string | null> {
  // First check DynamoDB
  const dbRes = await ddb.send(new GetCommand({
    TableName: PROFILES_TABLE,
    Key: { clinicId }
  }));

  if (dbRes.Item?.ayrshareProfileKey) {
    return dbRes.Item.ayrshareProfileKey;
  }

  // Fallback to clinics.json
  const clinicConfig = getClinicConfig(clinicId);
  return clinicConfig?.ayrshare?.profileKey || null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'PUT', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;

    // ---------------------------------------------------------
    // POST /ads/{clinicId}/boost - Boost an existing post
    // ---------------------------------------------------------
    if (path.includes('/boost') && method === 'POST') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { postId, budget, durationDays, targetAudience, objective } = body;

      if (!postId || !budget || !durationDays) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'postId, budget, and durationDays are required' 
          })
        };
      }

      const boostParams: BoostPostParams = {
        postId,
        budget: Number(budget),
        durationDays: Number(durationDays),
        targetAudience,
        objective
      };

      const result = await ayrshareBoostPost(API_KEY, profileKey, boostParams);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Post boosted successfully',
          clinicId,
          postId,
          budget: boostParams.budget,
          durationDays: boostParams.durationDays,
          boostResult: result
        })
      };
    }

    // ---------------------------------------------------------
    // POST /ads/{clinicId}/campaigns - Create a new ad campaign
    // ---------------------------------------------------------
    if (path.endsWith('/campaigns') && method === 'POST') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { name, objective, budget, startDate, endDate, platforms, creative, targeting } = body;

      if (!name || !objective || !budget || !startDate || !platforms || !creative) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'name, objective, budget, startDate, platforms, and creative are required' 
          })
        };
      }

      const campaignParams: CreateAdCampaignParams = {
        name,
        objective,
        budget: Number(budget),
        startDate,
        endDate,
        platforms,
        creative,
        targeting
      };

      const result = await ayrshareCreateAdCampaign(API_KEY, profileKey, campaignParams);

      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Ad campaign created successfully',
          clinicId,
          campaign: result
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/campaigns - Get all campaigns
    // ---------------------------------------------------------
    if (path.endsWith('/campaigns') && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const status = event.queryStringParameters?.status as 'active' | 'paused' | 'completed' | 'all' | undefined;
      const limit = event.queryStringParameters?.limit ? Number(event.queryStringParameters.limit) : undefined;

      const result = await ayrshareGetAdCampaigns(API_KEY, profileKey, { status, limit });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          campaigns: result.campaigns || result,
          total: Array.isArray(result) ? result.length : result.campaigns?.length || 0
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/campaigns/{campaignId} - Get single campaign
    // ---------------------------------------------------------
    if (path.match(/\/campaigns\/[^\/]+$/) && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const campaignId = event.pathParameters?.campaignId;
      if (!campaignId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'campaignId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const result = await ayrshareGetAdCampaign(API_KEY, profileKey, campaignId);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          campaign: result
        })
      };
    }

    // ---------------------------------------------------------
    // PUT /ads/{clinicId}/campaigns/{campaignId} - Update campaign
    // ---------------------------------------------------------
    if (path.match(/\/campaigns\/[^\/]+$/) && method === 'PUT') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const campaignId = event.pathParameters?.campaignId;
      if (!campaignId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'campaignId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { status, budget, endDate } = body;

      const result = await ayrshareUpdateAdCampaign(API_KEY, profileKey, campaignId, {
        status,
        budget: budget ? Number(budget) : undefined,
        endDate
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Campaign updated successfully',
          clinicId,
          campaignId,
          campaign: result
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /ads/{clinicId}/campaigns/{campaignId} - Delete campaign
    // ---------------------------------------------------------
    if (path.match(/\/campaigns\/[^\/]+$/) && method === 'DELETE') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const campaignId = event.pathParameters?.campaignId;
      if (!campaignId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'campaignId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      await ayrshareDeleteAdCampaign(API_KEY, profileKey, campaignId);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Campaign deleted successfully',
          clinicId,
          campaignId
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/analytics - Get ad analytics
    // ---------------------------------------------------------
    if (path.includes('/analytics') && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const campaignId = event.queryStringParameters?.campaignId;
      const postId = event.queryStringParameters?.postId;
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;

      const result = await ayrshareGetAdAnalytics(API_KEY, profileKey, {
        campaignId,
        postId,
        startDate,
        endDate
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          analytics: result
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/account - Get ad account info
    // ---------------------------------------------------------
    if (path.includes('/account') && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const result = await ayrshareGetAdAccount(API_KEY, profileKey);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          account: result
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('Ads Handler Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};

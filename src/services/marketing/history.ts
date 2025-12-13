import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { ayrshareGetHistory } from './ayrshare-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // GET /history - Get post history from Ayrshare
    // ---------------------------------------------------------
    if (method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const platform = event.queryStringParameters?.platform;
      const lastRecords = parseInt(event.queryStringParameters?.lastRecords || '25');
      const lastDays = event.queryStringParameters?.lastDays 
        ? parseInt(event.queryStringParameters.lastDays) 
        : undefined;

      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId is required' })
        };
      }

      // Get clinic profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      // Build params for Ayrshare
      const params: any = {};
      if (lastRecords) params.lastRecords = lastRecords;
      if (lastDays) params.lastDays = lastDays;
      if (platform) params.platform = platform;

      // Get history from Ayrshare
      const result = await ayrshareGetHistory(API_KEY, profileRes.Item.ayrshareProfileKey, params);

      // Format the response
      const history = (Array.isArray(result) ? result : result.history || []).map((post: any) => ({
        id: post.id,
        post: post.post,
        platforms: post.platforms || [],
        status: post.status,
        postIds: post.postIds || {},
        createdAt: post.created || post.createdAt,
        publishedAt: post.publishedAt || post.scheduledDate,
        mediaUrls: post.mediaUrls || [],
        errors: post.errors || []
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          history,
          total: history.length,
          filters: {
            platform: platform || 'all',
            lastRecords,
            lastDays: lastDays || null
          }
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('History Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: err.message,
        code: 'HISTORY_ERROR'
      })
    };
  }
};

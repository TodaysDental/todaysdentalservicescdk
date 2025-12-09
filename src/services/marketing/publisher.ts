import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { ayrsharePost } from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.MARKETING_CONFIG_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { targetClinicIds, postData } = body; 
    // postData structure: { post: "text", platforms: ["facebook"], mediaUrls: [] }

    if (!targetClinicIds || !Array.isArray(targetClinicIds) || targetClinicIds.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'targetClinicIds array required' }) };
    }

    // 1. Get Profile Keys for all requested clinics
    // BatchGet is efficient (Max 100 items per call)
    const keys = targetClinicIds.map(id => ({ clinicId: String(id) }));
    
    const dbRes = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: { Keys: keys }
      }
    }));

    const configs = dbRes.Responses?.[TABLE_NAME] || [];

    if (configs.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No marketing profiles found for selected clinics' }) };
    }

    // 2. Loop and Post
    const results = await Promise.allSettled(configs.map(async (config) => {
      if (!config.ayrshareProfileKey) throw new Error('Missing profile key');
      
      const res = await ayrsharePost(API_KEY, config.ayrshareProfileKey, postData);
      return { clinicId: config.clinicId, status: 'success', id: res.id, refId: res.refId };
    }));

    // 3. Summarize
    const summary = {
      total: results.length,
      success: results.filter(r => r.status === 'fulfilled').length,
      details: results.map(r => r.status === 'fulfilled' ? (r as any).value : { error: (r as any).reason.message })
    };

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(summary) };

  } catch (err: any) {
    console.error(err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
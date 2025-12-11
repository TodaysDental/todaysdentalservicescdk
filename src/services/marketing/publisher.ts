import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { 
  ayrsharePost, 
  ayrshareDeletePost,
  ayrshareGetHistory,
  ayrshareGetAnalytics,
  ayrshareGetComments,
  ayrshareReplyToComment,
  ayrshareGetSocialStats
} from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const TABLE_NAME = process.env.MARKETING_CONFIG_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE || 'MarketingPosts';
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // ============================================
    // 1. POST - Create & Publish Posts
    // ============================================
    if (event.path.endsWith('/post') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { targetClinicIds, postData, saveHistory = true } = body; 
      // postData: { post: "text", platforms: ["facebook"], mediaUrls: [], scheduleDate?: "..." }

      if (!targetClinicIds || !Array.isArray(targetClinicIds) || targetClinicIds.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'targetClinicIds array required' }) };
      }

      // Get Profile Keys for all requested clinics
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

      // Post to all clinics in parallel
      const results = await Promise.allSettled(configs.map(async (config) => {
        if (!config.ayrshareProfileKey) throw new Error('Missing profile key');
        
        const res = await ayrsharePost(API_KEY, config.ayrshareProfileKey, postData);
        
        // Save post history to DynamoDB
        if (saveHistory) {
          await ddb.send(new PutCommand({
            TableName: POSTS_TABLE,
            Item: {
              postId: res.id,
              clinicId: config.clinicId,
              refId: res.refId,
              postContent: postData.post,
              platforms: postData.platforms,
              scheduledDate: postData.scheduleDate || null,
              status: res.status || 'success',
              createdAt: new Date().toISOString()
            }
          }));
        }
        
        return { clinicId: config.clinicId, status: 'success', id: res.id, refId: res.refId };
      }));

      // Summarize results
      const summary = {
        total: results.length,
        success: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length,
        details: results.map(r => r.status === 'fulfilled' ? (r as any).value : { error: (r as any).reason.message })
      };

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(summary) };
    }

    // ============================================
    // 2. DELETE POST - Remove published post
    // ============================================
    if (event.path.endsWith('/post') && event.httpMethod === 'DELETE') {
      const { clinicId, postId } = JSON.parse(event.body || '{}');

      if (!clinicId || !postId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId and postId required' }) };
      }

      // Get profile key
      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
      }

      // Delete from Ayrshare
      await ayrshareDeletePost(API_KEY, dbRes.Item.ayrshareProfileKey, postId);

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, message: 'Post deleted' }) };
    }

    // ============================================
    // 3. GET HISTORY - Fetch posting history
    // ============================================
    if (event.path.endsWith('/history') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const lastRecords = event.queryStringParameters?.lastRecords;
      const lastDays = event.queryStringParameters?.lastDays;

      if (!clinicId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId required' }) };
      }

      // Get profile key
      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
      }

      // Get history from Ayrshare
      const history = await ayrshareGetHistory(API_KEY, dbRes.Item.ayrshareProfileKey, {
        lastRecords: lastRecords ? parseInt(lastRecords) : undefined,
        lastDays: lastDays ? parseInt(lastDays) : undefined
      });

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(history) };
    }

    // ============================================
    // 4. GET ANALYTICS - Post performance metrics
    // ============================================
    if (event.path.endsWith('/analytics') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const postId = event.queryStringParameters?.postId;

      if (!clinicId || !postId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId and postId required' }) };
      }

      // Get profile key
      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
      }

      // Get analytics from Ayrshare
      const analytics = await ayrshareGetAnalytics(API_KEY, dbRes.Item.ayrshareProfileKey, postId);

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(analytics) };
    }

    // ============================================
    // 5. GET COMMENTS - Fetch post comments
    // ============================================
    if (event.path.endsWith('/comments') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const postId = event.queryStringParameters?.postId;

      if (!clinicId || !postId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId and postId required' }) };
      }

      // Get profile key
      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
      }

      // Get comments from Ayrshare
      const comments = await ayrshareGetComments(API_KEY, dbRes.Item.ayrshareProfileKey, postId);

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(comments) };
    }

    // ============================================
    // 6. REPLY TO COMMENT - Post comment response
    // ============================================
    if (event.path.endsWith('/comments/reply') && event.httpMethod === 'POST') {
      const { clinicId, commentId, replyText, platform } = JSON.parse(event.body || '{}');

      if (!clinicId || !commentId || !replyText || !platform) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId, commentId, replyText, platform required' }) };
      }

      // Get profile key
      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
      }

      // Reply to comment
      const result = await ayrshareReplyToComment(
        API_KEY, 
        dbRes.Item.ayrshareProfileKey, 
        commentId,
        replyText,
        platform
      );

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
    }

    // ============================================
    // 7. GET SOCIAL STATS - Overall platform metrics
    // ============================================
    if (event.path.endsWith('/stats') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const platforms = event.queryStringParameters?.platforms?.split(',') || ['facebook', 'instagram'];

      if (!clinicId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId required' }) };
      }

      // Get profile key
      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
      }

      // Get social stats
      const stats = await ayrshareGetSocialStats(API_KEY, dbRes.Item.ayrshareProfileKey, platforms);

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(stats) };
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Publisher Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
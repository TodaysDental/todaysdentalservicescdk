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

// ============================================
// Rate Limiting Constants for Ayrshare Business Plan
// ============================================
const BATCH_SIZE = 3; // Max clinics to post to in parallel
const DELAY_BETWEEN_BATCHES_MS = 2000; // 2 second delay between batches
const MAX_RETRIES = 2; // Retry failed posts up to 2 times
const RETRY_DELAY_MS = 1000; // 1 second before retry

/**
 * Helper to delay execution
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Batch array into chunks
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Post to a single clinic with retry logic
 */
async function postToClinicWithRetry(
  config: any,
  postData: any,
  saveHistory: boolean,
  retries: number = 0
): Promise<{ clinicId: string; status: 'success' | 'failed'; id?: string; refId?: string; error?: string }> {
  try {
    if (!config.ayrshareProfileKey) {
      throw new Error('Missing Ayrshare profile key');
    }

    const res = await ayrsharePost(API_KEY, config.ayrshareProfileKey, postData);

    // Save post history to DynamoDB
    if (saveHistory && res.id) {
      await ddb.send(new PutCommand({
        TableName: POSTS_TABLE,
        Item: {
          postId: res.id,
          clinicId: config.clinicId,
          refId: res.refId,
          postContent: postData.post,
          platforms: postData.platforms,
          mediaUrls: postData.mediaUrls || [],
          scheduledDate: postData.scheduleDate || null,
          status: res.status || 'success',
          createdAt: new Date().toISOString()
        }
      }));
    }

    return { 
      clinicId: config.clinicId, 
      status: 'success', 
      id: res.id, 
      refId: res.refId 
    };
  } catch (error: any) {
    console.error(`Post failed for clinic ${config.clinicId}:`, error.message);

    // Retry if we have retries left and it's a potentially transient error
    if (retries < MAX_RETRIES && isRetryableError(error)) {
      console.log(`Retrying clinic ${config.clinicId} (attempt ${retries + 1})`);
      await delay(RETRY_DELAY_MS);
      return postToClinicWithRetry(config, postData, saveHistory, retries + 1);
    }

    return { 
      clinicId: config.clinicId, 
      status: 'failed', 
      error: error.message 
    };
  }
}

/**
 * Check if error is retryable (rate limiting, network issues)
 */
function isRetryableError(error: any): boolean {
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('timeout') ||
    message.includes('network')
  );
}

/**
 * Replace placeholders in post content with clinic data
 */
function resolvePostPlaceholders(postData: any, clinicData: any): any {
  const resolvedPost = { ...postData };
  
  if (resolvedPost.post) {
    resolvedPost.post = resolvedPost.post
      .replace(/\{\{clinic_name\}\}/g, clinicData.clinicName || '')
      .replace(/\{\{phone_number\}\}/g, clinicData.phone || '')
      .replace(/\{\{address\}\}/g, clinicData.address || '')
      .replace(/\{\{email\}\}/g, clinicData.email || '')
      .replace(/\{\{website\}\}/g, clinicData.website || '')
      .replace(/\{\{working_hours\}\}/g, clinicData.workingHours || '');
  }
  
  return resolvedPost;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // ============================================
    // 1. POST - Create & Publish Posts (with rate limiting)
    // ============================================
    if (event.path.endsWith('/post') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { targetClinicIds, postData, saveHistory = true, resolvePlaceholders = false } = body; 
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

      // Batch clinics for rate limiting (Ayrshare Business Plan)
      const batches = chunkArray(configs, BATCH_SIZE);
      const allResults: Array<{ clinicId: string; status: 'success' | 'failed'; id?: string; refId?: string; error?: string }> = [];

      console.log(`Publishing to ${configs.length} clinics in ${batches.length} batches`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} clinics)`);

        // Process batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (config) => {
            // Resolve placeholders if requested
            const resolvedPostData = resolvePlaceholders 
              ? resolvePostPlaceholders(postData, config)
              : postData;
            
            return postToClinicWithRetry(config, resolvedPostData, saveHistory);
          })
        );

        allResults.push(...batchResults);

        // Delay between batches (except for the last batch)
        if (i < batches.length - 1) {
          console.log(`Waiting ${DELAY_BETWEEN_BATCHES_MS}ms before next batch...`);
          await delay(DELAY_BETWEEN_BATCHES_MS);
        }
      }

      // Summarize results
      const successCount = allResults.filter(r => r.status === 'success').length;
      const failedCount = allResults.filter(r => r.status === 'failed').length;

      const summary = {
        total: allResults.length,
        success: successCount,
        failed: failedCount,
        results: allResults,
        batchInfo: {
          batchSize: BATCH_SIZE,
          totalBatches: batches.length,
          delayMs: DELAY_BETWEEN_BATCHES_MS
        }
      };

      console.log(`Publishing complete: ${successCount} success, ${failedCount} failed`);

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(summary) };
    }

    // ============================================
    // 2. POST BULK - Enhanced Bulk Publishing with Image Generation
    // ============================================
    if (event.path.endsWith('/post/bulk') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { 
        targetClinicIds, 
        postData, 
        canvasJson,
        saveHistory = true 
      } = body;

      if (!targetClinicIds || !Array.isArray(targetClinicIds) || targetClinicIds.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'targetClinicIds array required' }) };
      }

      // Get clinic configs
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

      // Batch processing for Business Plan rate limits
      const batches = chunkArray(configs, BATCH_SIZE);
      const allResults: Array<{ clinicId: string; status: 'success' | 'failed'; id?: string; error?: string }> = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        const batchResults = await Promise.all(
          batch.map(async (config) => {
            try {
              // For bulk posts, always resolve placeholders
              const resolvedPostData = resolvePostPlaceholders(postData, config);
              
              // If canvasJson is provided, we would generate per-clinic images here
              // For now, use the provided mediaUrls
              // In a future enhancement, call image-generator Lambda
              
              if (!config.ayrshareProfileKey) {
                throw new Error('Missing Ayrshare profile key');
              }

              const res = await ayrsharePost(API_KEY, config.ayrshareProfileKey, resolvedPostData);

              if (saveHistory && res.id) {
                await ddb.send(new PutCommand({
                  TableName: POSTS_TABLE,
                  Item: {
                    postId: res.id,
                    clinicId: config.clinicId,
                    refId: res.refId,
                    postContent: resolvedPostData.post,
                    platforms: resolvedPostData.platforms,
                    mediaUrls: resolvedPostData.mediaUrls || [],
                    scheduledDate: resolvedPostData.scheduleDate || null,
                    status: 'success',
                    bulkJobId: body.bulkJobId || null,
                    createdAt: new Date().toISOString()
                  }
                }));
              }

              return { clinicId: config.clinicId, status: 'success' as const, id: res.id };
            } catch (error: any) {
              console.error(`Bulk post failed for clinic ${config.clinicId}:`, error);
              return { clinicId: config.clinicId, status: 'failed' as const, error: error.message };
            }
          })
        );

        allResults.push(...batchResults);

        // Rate limit delay between batches
        if (i < batches.length - 1) {
          await delay(DELAY_BETWEEN_BATCHES_MS);
        }
      }

      const summary = {
        total: allResults.length,
        success: allResults.filter(r => r.status === 'success').length,
        failed: allResults.filter(r => r.status === 'failed').length,
        results: allResults
      };

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(summary) };
    }

    // ============================================
    // 3. DELETE POST - Remove published post
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
    // 4. GET HISTORY - Fetch posting history
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
    // 5. GET ANALYTICS - Post performance metrics
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
    // 6. GET COMMENTS - Fetch post comments
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
    // 7. REPLY TO COMMENT - Post comment response
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
    // 8. GET SOCIAL STATS - Overall platform metrics
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

    // ============================================
    // 9. GET RATE LIMIT INFO - Check current rate limit status
    // ============================================
    if (event.path.endsWith('/rate-limit') && event.httpMethod === 'GET') {
      // Return rate limiting configuration
      return { 
        statusCode: 200, 
        headers: corsHeaders, 
        body: JSON.stringify({
          plan: 'business',
          batchSize: BATCH_SIZE,
          delayBetweenBatchesMs: DELAY_BETWEEN_BATCHES_MS,
          maxRetries: MAX_RETRIES,
          retryDelayMs: RETRY_DELAY_MS,
          recommendations: {
            maxClinicsPerMinute: Math.floor(60000 / DELAY_BETWEEN_BATCHES_MS) * BATCH_SIZE,
            optimalBatchSize: BATCH_SIZE
          }
        })
      };
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Publisher Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

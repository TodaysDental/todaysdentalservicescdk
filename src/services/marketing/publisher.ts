import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
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
import { getAyrshareApiKey } from '../../shared/utils/secrets-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const lambda = new LambdaClient({});
const TABLE_NAME = process.env.MARKETING_CONFIG_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE || 'MarketingPosts';
const IMAGE_GENERATOR_FUNCTION = process.env.IMAGE_GENERATOR_FUNCTION || 'ImageGeneratorFn';

// ============================================
// Rate Limiting Constants for Ayrshare Business Plan
// ============================================
const BATCH_SIZE = 3; // Max clinics to post to in parallel
const DELAY_BETWEEN_BATCHES_MS = 2000; // 2 second delay between batches
const MAX_RETRIES = 2; // Retry failed posts up to 2 times
const RETRY_DELAY_MS = 1000; // 1 second before retry

// ============================================
// Ayrshare API Key (cached from GlobalSecrets)
// ============================================
let cachedApiKey: string | null = null;

/**
 * Get Ayrshare API Key from GlobalSecrets (with caching)
 */
async function getApiKey(): Promise<string> {
  if (cachedApiKey) {
    return cachedApiKey;
  }
  const apiKey = await getAyrshareApiKey();
  if (!apiKey) {
    throw new Error('Ayrshare API key not found in GlobalSecrets. Please add secretId="ayrshare", secretType="api_key" to GlobalSecrets table.');
  }
  cachedApiKey = apiKey;
  return apiKey;
}

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
  apiKey: string,
  config: any,
  postData: any,
  saveHistory: boolean,
  retries: number = 0
): Promise<{ clinicId: string; status: 'success' | 'failed'; id?: string; refId?: string; error?: string }> {
  try {
    if (!config.ayrshareProfileKey) {
      throw new Error('Missing Ayrshare profile key');
    }

    const res = await ayrsharePost(apiKey, config.ayrshareProfileKey, postData);

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
      return postToClinicWithRetry(apiKey, config, postData, saveHistory, retries + 1);
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
 * Supports both snake_case placeholders ({{clinic_name}}) and camelCase ({{clinicName}})
 * for compatibility with frontend and backend formats
 */
function resolvePostPlaceholders(postData: any, clinicData: any): any {
  const resolvedPost = { ...postData };

  if (resolvedPost.post) {
    // Build replacement map from all possible clinic data fields
    const replacements: Record<string, string> = {
      // Snake_case placeholders (frontend format)
      'clinic_name': clinicData.clinicName || clinicData.name || '',
      'phone_number': clinicData.clinicPhone || clinicData.phoneNumber || clinicData.phone || '',
      'address': clinicData.clinicAddress || clinicData.address || '',
      'email': clinicData.clinicEmail || clinicData.email || '',
      'website': clinicData.websiteLink || clinicData.website || '',
      'working_hours': clinicData.workingHours || clinicData.hours || '',
      'clinic_logo': clinicData.logoUrl || clinicData.logo || '',
      'clinic_city': clinicData.clinicCity || clinicData.city || '',
      'clinic_state': clinicData.clinicState || clinicData.state || '',
      // CamelCase placeholders (bulk-processor format)
      'clinicName': clinicData.clinicName || clinicData.name || '',
      'clinicPhone': clinicData.clinicPhone || clinicData.phoneNumber || '',
      'clinicAddress': clinicData.clinicAddress || clinicData.address || '',
      'clinicEmail': clinicData.clinicEmail || clinicData.email || '',
      'clinicCity': clinicData.clinicCity || clinicData.city || '',
      'clinicState': clinicData.clinicState || clinicData.state || '',
      'websiteLink': clinicData.websiteLink || clinicData.website || '',
      'phoneNumber': clinicData.phoneNumber || clinicData.clinicPhone || '',
      'logoUrl': clinicData.logoUrl || clinicData.logo || '',
      'scheduleUrl': clinicData.scheduleUrl || '',
      'mapsUrl': clinicData.mapsUrl || '',
    };

    // Apply all replacements
    let text = resolvedPost.post;
    for (const [placeholder, value] of Object.entries(replacements)) {
      const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
      text = text.replace(regex, value);
    }
    resolvedPost.post = text;
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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

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

            return postToClinicWithRetry(apiKey, config, resolvedPostData, saveHistory);
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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // If canvasJson is provided, generate images for each clinic using image-generator Lambda
      let generatedImages: Record<string, string> = {};
      if (canvasJson && canvasJson.objects && canvasJson.objects.length > 0) {
        try {
          console.log('Generating images for', targetClinicIds.length, 'clinics');
          const invokeRes = await lambda.send(new InvokeCommand({
            FunctionName: IMAGE_GENERATOR_FUNCTION,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({
              httpMethod: 'POST',
              body: JSON.stringify({
                canvasJson,
                clinicIds: targetClinicIds,
                format: 'png',
                mode: 'generate',
              }),
            }),
          }));

          if (invokeRes.Payload) {
            const payload = JSON.parse(Buffer.from(invokeRes.Payload).toString());
            const imageGenResponse = JSON.parse(payload.body || '{}');

            if (imageGenResponse.images) {
              for (const img of imageGenResponse.images) {
                generatedImages[img.clinicId] = img.imageUrl;
              }
              console.log('Generated', Object.keys(generatedImages).length, 'images');
            } else if (imageGenResponse.canvases) {
              // Fallback: If only resolution mode available, log it
              console.log('Image generator in resolve mode - canvasJson resolved for', imageGenResponse.canvases?.length, 'clinics');
            }
          }
        } catch (imgError: any) {
          console.error('Image generation failed, proceeding without images:', imgError.message);
        }
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

              // If we have generated images for this clinic, add them to mediaUrls
              if (generatedImages[config.clinicId]) {
                resolvedPostData.mediaUrls = [generatedImages[config.clinicId], ...(resolvedPostData.mediaUrls || [])];
              }

              if (!config.ayrshareProfileKey) {
                throw new Error('Missing Ayrshare profile key');
              }

              const res = await ayrsharePost(apiKey, config.ayrshareProfileKey, resolvedPostData);

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
                    status: res.status || 'success',
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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // Delete from Ayrshare
      await ayrshareDeletePost(apiKey, dbRes.Item.ayrshareProfileKey, postId);

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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // Get history from Ayrshare
      const history = await ayrshareGetHistory(apiKey, dbRes.Item.ayrshareProfileKey, {
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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // Get analytics from Ayrshare
      const analytics = await ayrshareGetAnalytics(apiKey, dbRes.Item.ayrshareProfileKey, postId);

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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // Get comments from Ayrshare
      const comments = await ayrshareGetComments(apiKey, dbRes.Item.ayrshareProfileKey, postId);

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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // Reply to comment
      const result = await ayrshareReplyToComment(
        apiKey,
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
      const platforms = event.queryStringParameters?.platforms?.split(',') || ['facebook', 'instagram', 'x', 'threads', 'gbusiness'];

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

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // Get social stats
      const stats = await ayrshareGetSocialStats(apiKey, dbRes.Item.ayrshareProfileKey, platforms);

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

    // ============================================
    // 10. GET SCHEDULED POSTS - For calendar integration
    // ============================================
    if (event.path.endsWith('/scheduled') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;

      try {
        let posts: any[] = [];

        if (clinicId) {
          // Query by clinic ID
          const queryRes = await ddb.send(new QueryCommand({
            TableName: POSTS_TABLE,
            IndexName: 'ByClinic',
            KeyConditionExpression: 'clinicId = :clinicId',
            FilterExpression: 'attribute_exists(scheduledDate) AND scheduledDate <> :null',
            ExpressionAttributeValues: {
              ':clinicId': clinicId,
              ':null': null,
            },
            Limit: 100,
          }));
          posts = queryRes.Items || [];
        } else {
          // Scan for all scheduled posts
          const scanRes = await ddb.send(new ScanCommand({
            TableName: POSTS_TABLE,
            FilterExpression: 'attribute_exists(scheduledDate) AND scheduledDate <> :null',
            ExpressionAttributeValues: {
              ':null': null,
            },
            Limit: 200,
          }));
          posts = scanRes.Items || [];
        }

        // Filter by date range if provided
        if (startDate || endDate) {
          posts = posts.filter(post => {
            const postDate = post.scheduledDate;
            if (!postDate) return false;
            if (startDate && postDate < startDate) return false;
            if (endDate && postDate > endDate) return false;
            return true;
          });
        }

        // Sort by scheduled date
        posts.sort((a, b) =>
          new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
        );

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            posts,
            count: posts.length,
            filters: { clinicId, startDate, endDate },
          })
        };
      } catch (error: any) {
        console.error('Failed to fetch scheduled posts:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: error.message })
        };
      }
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Publisher Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

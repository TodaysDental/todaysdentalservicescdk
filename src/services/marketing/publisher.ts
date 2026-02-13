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
  ayrshareGetSocialStats,
  ayrshareAutoHashtag,
  ayrshareRecommendHashtags,
  ayrshareSearchHashtags,
  ayrshareCheckBannedHashtags,
  ayrshareContentModeration,
  ayrshareResizeImage,
  ayrshareSetAutoSchedule,
  ayrshareGetAutoSchedule,
  ayrshareDeleteAutoSchedule,
  ayrshareRegisterWebhook,
  ayrshareUnregisterWebhook,
  ayrshareGetWebhooks,
  ayrshareGetLinkAnalytics,
  ayrshareValidateMedia,
  ayrshareVerifyMediaUrl,
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
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE;

// ============================================
// Rate Limiting Constants for Ayrshare Business Plan
// ============================================
const BATCH_SIZE = 3; // Max clinics to post to in parallel
const DELAY_BETWEEN_BATCHES_MS = 2000; // 2 second delay between batches
const MAX_RETRIES = 1; // Keep bounded to avoid API Gateway 504s
const RETRY_DELAY_MS = 1000; // 1 second before retry
const MAX_SYNC_CLINICS = (() => {
  const raw = Number.parseInt(process.env.PUBLISHER_MAX_SYNC_CLINICS || String(BATCH_SIZE), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : BATCH_SIZE;
})();

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
  // Timeouts are ambiguous for posting: the request may have succeeded upstream,
  // so retrying can trigger duplicate-content errors (or accidental duplicates).
  if (message.includes('timeout')) return false;
  return (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
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

async function getClinicConfigMap(clinicIds: string[]): Promise<Record<string, any>> {
  if (!CLINIC_CONFIG_TABLE) return {};
  if (!Array.isArray(clinicIds) || clinicIds.length === 0) return {};

  try {
    const keys = clinicIds.map(id => ({ clinicId: String(id) }));
    const response = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [CLINIC_CONFIG_TABLE]: { Keys: keys }
      }
    }));
    const items = response.Responses?.[CLINIC_CONFIG_TABLE] || [];
    const map: Record<string, any> = {};
    for (const item of items) {
      if (item?.clinicId) {
        map[String(item.clinicId)] = item;
      }
    }
    return map;
  } catch (err: any) {
    console.warn('[publisher] Failed to load clinic config table data; falling back to marketing profile fields only.', err?.message || err);
    return {};
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const origin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] }, origin);

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
      // Fix #14: Normalize scheduleDate/scheduledDate — accept both field names
      if (postData) {
        postData.scheduleDate = postData.scheduledDate || postData.scheduleDate;
      }

      if (!targetClinicIds || !Array.isArray(targetClinicIds) || targetClinicIds.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'targetClinicIds array required' }) };
      }

      // IMPORTANT: API Gateway has a ~29s max integration timeout. Large multi-clinic
      // publishes should be chunked client-side (or moved to an async job).
      if (targetClinicIds.length > MAX_SYNC_CLINICS) {
        return {
          statusCode: 413,
          headers: corsHeaders,
          body: JSON.stringify({
            error: `Too many clinics for synchronous publish: ${targetClinicIds.length}. Please publish in chunks of ${MAX_SYNC_CLINICS} (or fewer) to avoid gateway timeouts.`,
            maxClinicsPerRequest: MAX_SYNC_CLINICS,
          }),
        };
      }

      // Get Profile Keys for all requested clinics
      const requestedClinicIds = targetClinicIds.map((id: any) => String(id));
      const keys = requestedClinicIds.map(id => ({ clinicId: id }));

      const dbRes = await ddb.send(new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: { Keys: keys }
        }
      }));

      const configs = dbRes.Responses?.[TABLE_NAME] || [];
      const configByClinicId: Record<string, any> = {};
      for (const cfg of configs) {
        if (cfg?.clinicId) {
          configByClinicId[String(cfg.clinicId)] = cfg;
        }
      }
      const missingClinicIds = requestedClinicIds.filter(id => !configByClinicId[id]);
      const orderedConfigs = requestedClinicIds.map(id => configByClinicId[id]).filter(Boolean);

      if (orderedConfigs.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No marketing profiles found for selected clinics' }) };
      }

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      // If placeholder resolution is requested, load canonical clinic config (address/phone/etc.)
      // from CLINIC_CONFIG_TABLE to keep placeholders consistent with the editor.
      const clinicConfigMap = resolvePlaceholders
        ? await getClinicConfigMap(requestedClinicIds)
        : {};

      // Batch clinics for rate limiting (Ayrshare Business Plan)
      const batches = chunkArray(orderedConfigs, BATCH_SIZE);
      const allResults: Array<{ clinicId: string; status: 'success' | 'failed'; id?: string; refId?: string; error?: string }> = [
        ...missingClinicIds.map(clinicId => ({
          clinicId,
          status: 'failed' as const,
          error: 'No marketing profile found for clinic',
        })),
      ];

      console.log(`Publishing to ${orderedConfigs.length} clinics in ${batches.length} batches`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} clinics)`);

        // Process batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (config) => {
            // Resolve placeholders if requested
            const clinicDataForPlaceholders = clinicConfigMap[String(config?.clinicId)] || config;
            const resolvedPostData = resolvePlaceholders
              ? resolvePostPlaceholders(postData, clinicDataForPlaceholders)
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
    // 1b. POST VALIDATE - Pre-publish validation (Fix #3)
    // ============================================
    if (event.path.endsWith('/post/validate') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { postData } = body;

      const warnings: string[] = [];
      const errors: string[] = [];

      if (!postData) {
        errors.push('postData is required');
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ valid: false, warnings, errors }) };
      }

      // Platform constraints
      const PLATFORM_LIMITS: Record<string, { maxCaption?: number; maxImages?: number; videoOnly?: boolean; requiresField?: string }> = {
        twitter: { maxCaption: 280, maxImages: 4 },
        tiktok: { videoOnly: true },
        youtube: { videoOnly: true },
        pinterest: { requiresField: 'link' },
        reddit: { maxCaption: 300, requiresField: 'subreddit' },
        instagram: { maxImages: 10 },
        facebook: { maxImages: 10 },
        linkedin: { maxImages: 9 },
      };

      const platforms = postData.platforms || [];
      const captionLength = (postData.post || '').length;
      const mediaCount = (postData.mediaUrls || []).length;

      for (const platform of platforms) {
        const limits = PLATFORM_LIMITS[platform];
        if (!limits) continue;

        if (limits.videoOnly) {
          errors.push(`${platform}: Only supports video content, not images`);
        }
        if (limits.maxCaption && captionLength > limits.maxCaption) {
          warnings.push(`${platform}: Caption (${captionLength} chars) exceeds ${limits.maxCaption} character limit`);
        }
        if (limits.maxImages && mediaCount > limits.maxImages) {
          warnings.push(`${platform}: ${mediaCount} images exceeds max of ${limits.maxImages}`);
        }
        if (limits.requiresField) {
          if (!postData[limits.requiresField]) {
            warnings.push(`${platform}: Missing required field "${limits.requiresField}"`);
          }
        }
      }

      // Validate schedule date format if provided
      const scheduleDate = postData.scheduledDate || postData.scheduleDate;
      if (scheduleDate) {
        const parsed = new Date(scheduleDate);
        if (isNaN(parsed.getTime())) {
          errors.push('Invalid schedule date format. Use ISO 8601 (e.g. 2026-02-14T09:00:00-05:00)');
        } else if (parsed <= new Date()) {
          warnings.push('Schedule date is in the past');
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          valid: errors.length === 0,
          warnings,
          errors,
        }),
      };
    }

    // ============================================
    // 1c. POST HASHTAGS - Auto-generate hashtags (Fix #8)
    // ============================================
    if (event.path.endsWith('/hashtags') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { post } = body;

      if (!post) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'post text required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const hashtagResult = await ayrshareAutoHashtag(apiKey, post);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ hashtags: hashtagResult.hashtags || [] }),
        };
      } catch (error: any) {
        console.error('Failed to generate hashtags:', error.message);
        return {
          statusCode: 200,
          headers: corsHeaders,
          // Return empty hashtags instead of error — this is a non-critical feature
          body: JSON.stringify({ hashtags: [], error: error.message }),
        };
      }
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

      // Same API Gateway timeout constraint as /post.
      if (targetClinicIds.length > MAX_SYNC_CLINICS) {
        return {
          statusCode: 413,
          headers: corsHeaders,
          body: JSON.stringify({
            error: `Too many clinics for synchronous bulk publish: ${targetClinicIds.length}. Please publish in chunks of ${MAX_SYNC_CLINICS} (or fewer) to avoid gateway timeouts.`,
            maxClinicsPerRequest: MAX_SYNC_CLINICS,
          }),
        };
      }

      // Get clinic configs
      const requestedClinicIds = targetClinicIds.map((id: any) => String(id));
      const keys = requestedClinicIds.map(id => ({ clinicId: id }));

      const dbRes = await ddb.send(new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: { Keys: keys }
        }
      }));

      const configs = dbRes.Responses?.[TABLE_NAME] || [];
      const configByClinicId: Record<string, any> = {};
      for (const cfg of configs) {
        if (cfg?.clinicId) {
          configByClinicId[String(cfg.clinicId)] = cfg;
        }
      }
      const missingClinicIds = requestedClinicIds.filter(id => !configByClinicId[id]);
      const orderedConfigs = requestedClinicIds.map(id => configByClinicId[id]).filter(Boolean);

      if (orderedConfigs.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No marketing profiles found for selected clinics' }) };
      }

      // Get Ayrshare API key from GlobalSecrets
      const apiKey = await getApiKey();

      const clinicConfigMap = await getClinicConfigMap(requestedClinicIds);

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
      const batches = chunkArray(orderedConfigs, BATCH_SIZE);
      const allResults: Array<{ clinicId: string; status: 'success' | 'failed'; id?: string; refId?: string; error?: string }> = [
        ...missingClinicIds.map(clinicId => ({
          clinicId,
          status: 'failed' as const,
          error: 'No marketing profile found for clinic',
        })),
      ];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        const batchResults = await Promise.all(
          batch.map(async (config) => {
            try {
              // For bulk posts, always resolve placeholders
              const clinicDataForPlaceholders = clinicConfigMap[String(config?.clinicId)] || config;
              const resolvedPostData = resolvePostPlaceholders(postData, clinicDataForPlaceholders);

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

              return { clinicId: config.clinicId, status: 'success' as const, id: res.id, refId: res.refId };
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
          maxSyncClinicsPerRequest: MAX_SYNC_CLINICS,
          batchSize: BATCH_SIZE,
          delayBetweenBatchesMs: DELAY_BETWEEN_BATCHES_MS,
          maxRetries: MAX_RETRIES,
          retryDelayMs: RETRY_DELAY_MS,
          recommendations: {
            // API Gateway REST APIs have a hard ~29s integration timeout.
            // Keep each publish request to a small number of clinics (preferably 1).
            maxClinicsPerRequest: MAX_SYNC_CLINICS,
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

    // ============================================
    // 11. POST HASHTAGS RECOMMEND - Get hashtag recommendations
    // ============================================
    if (event.path.endsWith('/hashtags/recommend') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { keyword, limit = 10 } = body;

      if (!keyword) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'keyword required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const result = await ayrshareRecommendHashtags(apiKey, keyword, limit);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      } catch (error: any) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ hashtags: [], error: error.message }) };
      }
    }

    // ============================================
    // 12. POST HASHTAGS SEARCH - Search hashtags on a platform
    // ============================================
    if (event.path.endsWith('/hashtags/search') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { query, platform = 'instagram' } = body;

      if (!query) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'query required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const result = await ayrshareSearchHashtags(apiKey, query, platform);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      } catch (error: any) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ hashtags: [], error: error.message }) };
      }
    }

    // ============================================
    // 13. POST HASHTAGS BANNED - Check if hashtags are banned
    // ============================================
    if (event.path.endsWith('/hashtags/banned') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { hashtags } = body;

      if (!hashtags || !Array.isArray(hashtags) || hashtags.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'hashtags array required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const result = await ayrshareCheckBannedHashtags(apiKey, hashtags);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      } catch (error: any) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ banned: [], error: error.message }) };
      }
    }

    // ============================================
    // 14. POST MODERATE - AI content moderation
    // ============================================
    if (event.path.endsWith('/moderate') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { content } = body;

      if (!content) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'content required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const result = await ayrshareContentModeration(apiKey, content);

        // Ayrshare returns: { status, text, moderation: [{ flagged, categories, categoryScores }] }
        // Frontend expects: { flagged, categories, ... }
        const first = Array.isArray((result as any)?.moderation) ? (result as any).moderation[0] : undefined;
        const flagged = Boolean(first?.flagged ?? (result as any)?.flagged ?? false);
        const categories = (first?.categories ?? (result as any)?.categories ?? {}) as Record<string, boolean>;
        const categoryScores = first?.categoryScores ?? (result as any)?.categoryScores;

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            status: (result as any)?.status || 'success',
            text: (result as any)?.text || content,
            flagged,
            categories,
            ...(categoryScores ? { categoryScores } : {}),
          }),
        };
      } catch (error: any) {
        console.error('Content moderation failed:', error?.response?.data || error?.message || error);
        return {
          // Don't throw 500 for a non-critical feature; the UI should not be blocked.
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            status: 'unavailable',
            flagged: false,
            categories: {},
            serviceUnavailable: true,
            error: error?.message || 'Content moderation unavailable',
          }),
        };
      }
    }

    // ============================================
    // 15. POST MEDIA RESIZE - Resize image for platform
    // ============================================
    if (event.path.endsWith('/media/resize') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { imageUrl, width, height } = body;

      if (!imageUrl || !width || !height) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'imageUrl, width, and height required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const result = await ayrshareResizeImage(apiKey, imageUrl, width, height);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      } catch (error: any) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
      }
    }

    // ============================================
    // 16. AUTO-SCHEDULE - Manage auto-scheduling rules
    // ============================================
    if (event.path.endsWith('/auto-schedule')) {
      const clinicId = event.httpMethod === 'GET'
        ? event.queryStringParameters?.clinicId
        : JSON.parse(event.body || '{}').clinicId;

      if (!clinicId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId required' }) };
      }

      // Get profile key
      const dbRes = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { clinicId } }));
      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
      }
      const apiKey = await getApiKey();
      const profileKey = dbRes.Item.ayrshareProfileKey;

      // GET - Retrieve current auto-schedule
      if (event.httpMethod === 'GET') {
        try {
          const result = await ayrshareGetAutoSchedule(apiKey, profileKey);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }

      // POST - Set auto-schedule
      if (event.httpMethod === 'POST') {
        const body = JSON.parse(event.body || '{}');
        const { schedule } = body;
        if (!schedule || !schedule.scheduleDate || !schedule.scheduleTime || !schedule.title) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'schedule with scheduleDate[], scheduleTime[], and title required' }) };
        }
        try {
          const result = await ayrshareSetAutoSchedule(apiKey, profileKey, schedule);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }

      // DELETE - Remove auto-schedule by title
      if (event.httpMethod === 'DELETE') {
        const body = JSON.parse(event.body || '{}');
        const { title } = body;
        if (!title) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'title required' }) };
        }
        try {
          const result = await ayrshareDeleteAutoSchedule(apiKey, profileKey, title);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }
    }

    // ============================================
    // 17. WEBHOOKS - Manage webhook subscriptions
    // ============================================
    if (event.path.endsWith('/webhooks')) {
      const apiKey = await getApiKey();

      // GET - List registered webhooks
      if (event.httpMethod === 'GET') {
        const profileKey = event.queryStringParameters?.profileKey;
        try {
          const result = await ayrshareGetWebhooks(apiKey, profileKey);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }

      // POST - Register a webhook
      if (event.httpMethod === 'POST') {
        const body = JSON.parse(event.body || '{}');
        const { action, url, secret, profileKey } = body;
        if (!action || !url || !secret) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'action, url, and secret required' }) };
        }
        try {
          const result = await ayrshareRegisterWebhook(apiKey, action, url, secret, profileKey);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }

      // DELETE - Unregister a webhook
      if (event.httpMethod === 'DELETE') {
        const body = JSON.parse(event.body || '{}');
        const { action, profileKey } = body;
        if (!action) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'action required' }) };
        }
        try {
          const result = await ayrshareUnregisterWebhook(apiKey, action, profileKey);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }
    }

    // ============================================
    // 18. GET LINK ANALYTICS - Click/link tracking
    // ============================================
    if (event.path.endsWith('/analytics/links') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const postId = event.queryStringParameters?.postId;

      if (!clinicId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId required' }) };
      }

      try {
        const dbRes = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { clinicId } }));
        if (!dbRes.Item?.ayrshareProfileKey) {
          return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not found' }) };
        }
        const apiKey = await getApiKey();
        const result = await ayrshareGetLinkAnalytics(apiKey, dbRes.Item.ayrshareProfileKey, postId);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      } catch (error: any) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
      }
    }

    // ============================================
    // 19. POST MEDIA VALIDATE - Validate media for platform compatibility
    // ============================================
    if (event.path.endsWith('/media/validate') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { mediaUrls, platforms } = body;

      if (!mediaUrls || !Array.isArray(mediaUrls) || !platforms || !Array.isArray(platforms)) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'mediaUrls[] and platforms[] required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const result = await ayrshareValidateMedia(apiKey, mediaUrls, platforms);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      } catch (error: any) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
      }
    }

    // ============================================
    // 20. POST MEDIA VERIFY - Verify a media URL is accessible
    // ============================================
    if (event.path.endsWith('/media/verify') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { url } = body;

      if (!url) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'url required' }) };
      }

      try {
        const apiKey = await getApiKey();
        const result = await ayrshareVerifyMediaUrl(apiKey, url);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      } catch (error: any) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
      }
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Publisher Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

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
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
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

// Async worker gets a generous timeout (not constrained by API Gateway's ~29 s limit).
const ASYNC_POST_TIMEOUT_MS = 55_000;

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
): Promise<{ clinicId: string; status: 'success' | 'failed'; id?: string; refId?: string; error?: string; platformResults?: any[]; platformErrors?: any[] }> {
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
          platformResults: res.platformResults,
          platformErrors: res.platformErrors,
          createdAt: new Date().toISOString()
        }
      }));
    }

    // If some platforms failed but at least one succeeded, report partial success
    // so the user knows which platforms worked.
    if (res.platformErrors?.length) {
      return {
        clinicId: config.clinicId,
        status: 'success',
        id: res.id,
        refId: res.refId,
        platformResults: res.platformResults,
        platformErrors: res.platformErrors,
        error: res.partialFailureMessage,
      };
    }

    return {
      clinicId: config.clinicId,
      status: 'success',
      id: res.id,
      refId: res.refId,
      platformResults: res.platformResults,
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

// ============================================
// Async publish worker — invoked directly by Lambda (not via API Gateway)
// with a generous timeout so Ayrshare can take as long as it needs.
// ============================================
async function handleAsyncPublishWorker(payload: {
  profileKey: string;
  postData: any;
  clinicId: string;
  saveHistory: boolean;
  publishJobId: string;
  bulkJobId?: string;
}): Promise<{ status: string; clinicId: string; id?: string; error?: string }> {
  const { profileKey, postData, clinicId, saveHistory, publishJobId, bulkJobId } = payload;

  // Fetch API key at runtime (never passed in the invocation payload for security).
  const apiKey = await getApiKey();

  try {
    const res = await ayrsharePost(apiKey, profileKey, postData, ASYNC_POST_TIMEOUT_MS);

    if (saveHistory && res.id) {
      await ddb.send(new PutCommand({
        TableName: POSTS_TABLE,
        Item: {
          postId: res.id,
          clinicId,
          refId: res.refId,
          postContent: postData.post,
          platforms: postData.platforms,
          mediaUrls: postData.mediaUrls || [],
          scheduledDate: postData.scheduleDate || null,
          status: res.status || 'success',
          publishJobId,
          bulkJobId: bulkJobId || null,
          platformResults: res.platformResults,
          platformErrors: res.platformErrors,
          createdAt: new Date().toISOString(),
        },
      }));
    }

    console.log(`[asyncWorker] Published for ${clinicId}: postId=${res.id}`);
    return { status: 'success', clinicId, id: res.id };
  } catch (err: any) {
    console.error(`[asyncWorker] Failed for ${clinicId}:`, err.message);

    // Persist failure so the user can see it in History.
    try {
      await ddb.send(new PutCommand({
        TableName: POSTS_TABLE,
        Item: {
          postId: `failed-${publishJobId}-${clinicId}`,
          clinicId,
          postContent: postData.post,
          platforms: postData.platforms,
          mediaUrls: postData.mediaUrls || [],
          status: 'failed',
          error: err.message,
          publishJobId,
          bulkJobId: bulkJobId || null,
          createdAt: new Date().toISOString(),
        },
      }));
    } catch (dbErr: any) {
      console.error(`[asyncWorker] Also failed to save failure record:`, dbErr.message);
    }

    return { status: 'failed', clinicId, error: err.message };
  }
}

export const handler = async (event: any): Promise<any> => {
  // ============================================
  // ASYNC WORKER MODE — direct Lambda invocation (not via API Gateway)
  // ============================================
  if (event.__asyncPublishWorker) {
    return handleAsyncPublishWorker(event);
  }

  // ============================================
  // API GATEWAY MODE — normal HTTP request handling
  // ============================================
  const apiGwEvent = event as APIGatewayProxyEvent;
  const origin = apiGwEvent.headers?.origin || apiGwEvent.headers?.Origin;
  const corsHeaders = await buildCorsHeadersAsync({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] }, origin);

  if (apiGwEvent.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // ============================================
    // 1. POST - Create & Publish Posts (async fire-and-forget)
    // ============================================
    if (apiGwEvent.path.endsWith('/post') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
      const { targetClinicIds, postData, saveHistory = true, resolvePlaceholders = false } = body;
      // Fix #14: Normalize scheduleDate/scheduledDate — accept both field names
      if (postData) {
        postData.scheduleDate = postData.scheduledDate || postData.scheduleDate;
      }

      if (!targetClinicIds || !Array.isArray(targetClinicIds) || targetClinicIds.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'targetClinicIds array required' }) };
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

      // If placeholder resolution is requested, load canonical clinic config (address/phone/etc.)
      // from CLINIC_CONFIG_TABLE to keep placeholders consistent with the editor.
      const clinicConfigMap = resolvePlaceholders
        ? await getClinicConfigMap(requestedClinicIds)
        : {};

      // Generate a unique publish job ID so all async invocations can be correlated.
      const publishJobId = `pub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const selfFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;

      if (!selfFunctionName) {
        // Fallback: if we can't self-invoke, fall back to synchronous posting
        console.warn('[publisher] AWS_LAMBDA_FUNCTION_NAME not set; falling back to synchronous publish');
        const apiKey = await getApiKey();
        const batches = chunkArray(orderedConfigs, BATCH_SIZE);
        const allResults: Array<{ clinicId: string; status: 'success' | 'failed'; id?: string; error?: string }> = [
          ...missingClinicIds.map(clinicId => ({ clinicId, status: 'failed' as const, error: 'No marketing profile found for clinic' })),
        ];
        for (const batch of batches) {
          const batchResults = await Promise.all(
            batch.map(config => {
              const clinicData = clinicConfigMap[String(config?.clinicId)] || config;
              const resolved = resolvePlaceholders ? resolvePostPlaceholders(postData, clinicData) : postData;
              return postToClinicWithRetry(apiKey, config, resolved, saveHistory);
            })
          );
          allResults.push(...batchResults);
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ total: allResults.length, success: allResults.filter(r => r.status === 'success').length, failed: allResults.filter(r => r.status === 'failed').length, results: allResults }) };
      }

      // ---- SYNC vs ASYNC decision ----
      // Post synchronously only when the batch is small AND there is no media.
      // Media posts (especially Instagram) routinely take 15-27+ s on Ayrshare,
      // which risks hitting API Gateway's ~29 s integration timeout.  The async
      // worker has a generous 55 s HTTP budget and a 120 s Lambda timeout.
      const hasMedia = !!(postData?.mediaUrls?.length);
      if (orderedConfigs.length <= MAX_SYNC_CLINICS && !hasMedia) {
        console.log(`[publisher] Synchronous publish for ${orderedConfigs.length} clinic(s) (≤ ${MAX_SYNC_CLINICS}, no media)`);
        const apiKey = await getApiKey();
        const allResults: Array<{ clinicId: string; status: 'success' | 'failed'; id?: string; refId?: string; error?: string; platformResults?: any[]; platformErrors?: any[] }> = [
          ...missingClinicIds.map(clinicId => ({ clinicId, status: 'failed' as const, error: 'No marketing profile found for clinic' })),
        ];
        const batches = chunkArray(orderedConfigs, BATCH_SIZE);
        for (const batch of batches) {
          const batchResults = await Promise.all(
            batch.map(config => {
              const clinicData = clinicConfigMap[String(config?.clinicId)] || config;
              const resolved = resolvePlaceholders ? resolvePostPlaceholders(postData, clinicData) : postData;
              return postToClinicWithRetry(apiKey, config, resolved, saveHistory);
            })
          );
          allResults.push(...batchResults);
          if (batches.indexOf(batch) < batches.length - 1) {
            await delay(DELAY_BETWEEN_BATCHES_MS);
          }
        }
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            total: allResults.length,
            success: allResults.filter(r => r.status === 'success').length,
            failed: allResults.filter(r => r.status === 'failed').length,
            results: allResults,
            publishJobId,
          }),
        };
      }

      // ---- ASYNC FIRE-AND-FORGET ----
      // Invoke self asynchronously for each clinic. The async worker has a
      // generous 55 s timeout per platform, well beyond API Gateway's ~29 s cap.
      // Triggered for large batches OR when media is present (slow Ayrshare uploads).
      console.log(`[publisher] Dispatching async publish for ${orderedConfigs.length} clinic(s) (jobId=${publishJobId})${hasMedia ? ' [media]' : ''}`);

      const invokePromises = orderedConfigs.map(config => {
        const clinicData = clinicConfigMap[String(config?.clinicId)] || config;
        const resolvedPostData = resolvePlaceholders
          ? resolvePostPlaceholders(postData, clinicData)
          : postData;

        return lambda.send(new InvokeCommand({
          FunctionName: selfFunctionName,
          InvocationType: 'Event',
          Payload: JSON.stringify({
            __asyncPublishWorker: true,
            profileKey: config.ayrshareProfileKey,
            postData: resolvedPostData,
            clinicId: config.clinicId,
            saveHistory,
            publishJobId,
          }),
        }));
      });

      await Promise.all(invokePromises);

      const allResults = [
        ...orderedConfigs.map(config => ({
          clinicId: config.clinicId,
          status: 'success' as const,
        })),
        ...missingClinicIds.map(clinicId => ({
          clinicId,
          status: 'failed' as const,
          error: 'No marketing profile found for clinic',
        })),
      ];

      const summary = {
        total: allResults.length,
        success: orderedConfigs.length,
        failed: missingClinicIds.length,
        results: allResults,
        publishJobId,
        async: true,
      };

      console.log(`[publisher] Async publish dispatched: ${orderedConfigs.length} clinics`);

      return { statusCode: 202, headers: corsHeaders, body: JSON.stringify(summary) };
    }

    // ============================================
    // 1b. POST VALIDATE - Pre-publish validation (Fix #3)
    // ============================================
    if (apiGwEvent.path.endsWith('/post/validate') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/hashtags') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    // 2. POST BULK - Enhanced Bulk Publishing with Image Generation (async)
    // ============================================
    if (apiGwEvent.path.endsWith('/post/bulk') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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

      const clinicConfigMap = await getClinicConfigMap(requestedClinicIds);

      // If canvasJson is provided, generate images SYNCHRONOUSLY first (we need the URLs for the post).
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
            const payloadStr = Buffer.from(invokeRes.Payload).toString();
            const imgPayload = JSON.parse(payloadStr);
            const imageGenResponse = JSON.parse(imgPayload.body || '{}');

            if (imageGenResponse.images) {
              for (const img of imageGenResponse.images) {
                generatedImages[img.clinicId] = img.imageUrl;
              }
              console.log('Generated', Object.keys(generatedImages).length, 'images');
            } else if (imageGenResponse.canvases) {
              console.log('Image generator in resolve mode - canvasJson resolved for', imageGenResponse.canvases?.length, 'clinics');
            }
          }
        } catch (imgError: any) {
          console.error('Image generation failed, proceeding without images:', imgError.message);
        }
      }

      const publishJobId = `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const selfFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;

      // ---- SYNC vs ASYNC decision (same as /post) ----
      const hasMedia = !!(postData?.mediaUrls?.length) || Object.keys(generatedImages).length > 0;
      if (!selfFunctionName || (orderedConfigs.length <= MAX_SYNC_CLINICS && !hasMedia)) {
        if (!selfFunctionName) {
          console.warn('[publisher] AWS_LAMBDA_FUNCTION_NAME not set; falling back to synchronous bulk publish');
        } else {
          console.log(`[publisher] Synchronous bulk publish for ${orderedConfigs.length} clinic(s) (≤ ${MAX_SYNC_CLINICS}, no media)`);
        }
        const apiKey = await getApiKey();
        const allResults: Array<any> = [...missingClinicIds.map(clinicId => ({ clinicId, status: 'failed' as const, error: 'No marketing profile found for clinic' }))];
        const batches = chunkArray(orderedConfigs, BATCH_SIZE);
        for (const batch of batches) {
          const batchResults = await Promise.all(
            batch.map(config => {
              const clinicData = clinicConfigMap[String(config?.clinicId)] || config;
              const resolved = resolvePostPlaceholders(postData, clinicData);
              if (generatedImages[config.clinicId]) {
                resolved.mediaUrls = [generatedImages[config.clinicId], ...(resolved.mediaUrls || [])];
              }
              return postToClinicWithRetry(apiKey, config, resolved, saveHistory);
            })
          );
          allResults.push(...batchResults);
          if (batches.indexOf(batch) < batches.length - 1) {
            await delay(DELAY_BETWEEN_BATCHES_MS);
          }
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ total: allResults.length, success: allResults.filter(r => r.status === 'success').length, failed: allResults.filter(r => r.status === 'failed').length, results: allResults, publishJobId }) };
      }

      // ---- ASYNC FIRE-AND-FORGET ----
      console.log(`[publisher] Dispatching async bulk publish for ${orderedConfigs.length} clinic(s) (jobId=${publishJobId})${hasMedia ? ' [media]' : ''}`);

      const invokePromises = orderedConfigs.map(config => {
        const clinicData = clinicConfigMap[String(config?.clinicId)] || config;
        const resolvedPostData = resolvePostPlaceholders(postData, clinicData);

        if (generatedImages[config.clinicId]) {
          resolvedPostData.mediaUrls = [generatedImages[config.clinicId], ...(resolvedPostData.mediaUrls || [])];
        }

        return lambda.send(new InvokeCommand({
          FunctionName: selfFunctionName,
          InvocationType: 'Event',
          Payload: JSON.stringify({
            __asyncPublishWorker: true,
            profileKey: config.ayrshareProfileKey,
            postData: resolvedPostData,
            clinicId: config.clinicId,
            saveHistory,
            publishJobId,
            bulkJobId: body.bulkJobId || null,
          }),
        }));
      });

      await Promise.all(invokePromises);

      const allResults = [
        ...orderedConfigs.map(config => ({
          clinicId: config.clinicId,
          status: 'success' as const,
        })),
        ...missingClinicIds.map(clinicId => ({
          clinicId,
          status: 'failed' as const,
          error: 'No marketing profile found for clinic',
        })),
      ];

      const summary = {
        total: allResults.length,
        success: orderedConfigs.length,
        failed: missingClinicIds.length,
        results: allResults,
        publishJobId,
        async: true,
      };

      console.log(`[publisher] Async bulk publish dispatched: ${orderedConfigs.length} clinics`);

      return { statusCode: 202, headers: corsHeaders, body: JSON.stringify(summary) };
    }

    // ============================================
    // 3. DELETE POST - Remove published post
    // ============================================
    if (apiGwEvent.path.endsWith('/post') && apiGwEvent.httpMethod === 'DELETE') {
      const { clinicId, postId } = JSON.parse(apiGwEvent.body || '{}');

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
    if (apiGwEvent.path.endsWith('/history') && apiGwEvent.httpMethod === 'GET') {
      const clinicId = apiGwEvent.queryStringParameters?.clinicId;
      const lastRecords = apiGwEvent.queryStringParameters?.lastRecords;
      const lastDays = apiGwEvent.queryStringParameters?.lastDays;

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
    if (apiGwEvent.path.endsWith('/analytics') && apiGwEvent.httpMethod === 'GET') {
      const clinicId = apiGwEvent.queryStringParameters?.clinicId;
      const postId = apiGwEvent.queryStringParameters?.postId;

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
    if (apiGwEvent.path.endsWith('/comments') && apiGwEvent.httpMethod === 'GET') {
      const clinicId = apiGwEvent.queryStringParameters?.clinicId;
      const postId = apiGwEvent.queryStringParameters?.postId;

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
    if (apiGwEvent.path.endsWith('/comments/reply') && apiGwEvent.httpMethod === 'POST') {
      const { clinicId, commentId, replyText, platform } = JSON.parse(apiGwEvent.body || '{}');

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
    if (apiGwEvent.path.endsWith('/stats') && apiGwEvent.httpMethod === 'GET') {
      const clinicId = apiGwEvent.queryStringParameters?.clinicId;
      const platforms = apiGwEvent.queryStringParameters?.platforms?.split(',') || ['facebook', 'instagram', 'x', 'threads', 'gbusiness'];

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
    if (apiGwEvent.path.endsWith('/rate-limit') && apiGwEvent.httpMethod === 'GET') {
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
    if (apiGwEvent.path.endsWith('/scheduled') && apiGwEvent.httpMethod === 'GET') {
      const clinicId = apiGwEvent.queryStringParameters?.clinicId;
      const startDate = apiGwEvent.queryStringParameters?.startDate;
      const endDate = apiGwEvent.queryStringParameters?.endDate;

      try {
        let posts: any[] = [];

        if (clinicId) {
          const queryRes = await ddb.send(new QueryCommand({
            TableName: POSTS_TABLE,
            IndexName: 'ByClinic',
            KeyConditionExpression: 'clinicId = :clinicId',
            FilterExpression: '(attribute_exists(scheduledDate) AND scheduledDate <> :null) OR (attribute_exists(scheduleDate) AND scheduleDate <> :null)',
            ExpressionAttributeValues: {
              ':clinicId': clinicId,
              ':null': null,
            },
            Limit: 200,
          }));
          posts = queryRes.Items || [];
        } else {
          const scanRes = await ddb.send(new ScanCommand({
            TableName: POSTS_TABLE,
            FilterExpression: '(attribute_exists(scheduledDate) AND scheduledDate <> :null) OR (attribute_exists(scheduleDate) AND scheduleDate <> :null)',
            ExpressionAttributeValues: {
              ':null': null,
            },
            Limit: 500,
          }));
          posts = scanRes.Items || [];
        }

        // Normalize: unify scheduledDate / scheduleDate
        posts = posts.map(post => ({
          ...post,
          scheduledDate: post.scheduledDate || post.scheduleDate,
        }));

        if (startDate || endDate) {
          posts = posts.filter(post => {
            const postDate = post.scheduledDate;
            if (!postDate) return false;
            if (startDate && postDate < startDate) return false;
            if (endDate && postDate > endDate) return false;
            return true;
          });
        }

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
    if (apiGwEvent.path.endsWith('/hashtags/recommend') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/hashtags/search') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/hashtags/banned') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/moderate') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/media/resize') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/auto-schedule')) {
      const clinicId = apiGwEvent.httpMethod === 'GET'
        ? apiGwEvent.queryStringParameters?.clinicId
        : JSON.parse(apiGwEvent.body || '{}').clinicId;

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
      if (apiGwEvent.httpMethod === 'GET') {
        try {
          const result = await ayrshareGetAutoSchedule(apiKey, profileKey);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }

      // POST - Set auto-schedule
      if (apiGwEvent.httpMethod === 'POST') {
        const body = JSON.parse(apiGwEvent.body || '{}');
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
      if (apiGwEvent.httpMethod === 'DELETE') {
        const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/webhooks')) {
      const apiKey = await getApiKey();

      // GET - List registered webhooks
      if (apiGwEvent.httpMethod === 'GET') {
        const profileKey = apiGwEvent.queryStringParameters?.profileKey;
        try {
          const result = await ayrshareGetWebhooks(apiKey, profileKey);
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
        } catch (error: any) {
          return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
        }
      }

      // POST - Register a webhook
      if (apiGwEvent.httpMethod === 'POST') {
        const body = JSON.parse(apiGwEvent.body || '{}');
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
      if (apiGwEvent.httpMethod === 'DELETE') {
        const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/analytics/links') && apiGwEvent.httpMethod === 'GET') {
      const clinicId = apiGwEvent.queryStringParameters?.clinicId;
      const postId = apiGwEvent.queryStringParameters?.postId;

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
    if (apiGwEvent.path.endsWith('/media/validate') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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
    if (apiGwEvent.path.endsWith('/media/verify') && apiGwEvent.httpMethod === 'POST') {
      const body = JSON.parse(apiGwEvent.body || '{}');
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

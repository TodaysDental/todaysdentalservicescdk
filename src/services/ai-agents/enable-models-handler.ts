/**
 * Enable Models Custom Resource Handler
 *
 * Runs during CDK deployment to auto-subscribe to all Bedrock foundation
 * models by invoking each one once. This triggers the AWS Marketplace
 * subscription for third-party models (Anthropic, Meta, Cohere, etc.).
 *
 * Models that are already subscribed will succeed immediately.
 * Models that need subscription will auto-subscribe (assuming IAM has
 * aws-marketplace:Subscribe permission).
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

/**
 * All model IDs to enable. Uses cross-region inference profiles (us.*)
 * for third-party models as required by Bedrock.
 */
const MODELS_TO_ENABLE = [
  // Anthropic Claude Family
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'us.anthropic.claude-sonnet-4-20250514-v1:0',
  'us.anthropic.claude-sonnet-4-6',
  'us.anthropic.claude-opus-4-20250514-v1:0',
  'us.anthropic.claude-opus-4-1-20250805-v1:0',
  'us.anthropic.claude-opus-4-5-20251101-v1:0',
  'us.anthropic.claude-opus-4-6-v1',
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',

  // Amazon Nova (native — no us. prefix needed)
  'amazon.nova-micro-v1:0',
  'amazon.nova-lite-v1:0',
  'amazon.nova-pro-v1:0',

  // Meta Llama
  'us.meta.llama3-3-70b-instruct-v1:0',
  'us.meta.llama3-1-70b-instruct-v1:0',

  // Cohere
  'us.cohere.command-r-v1:0',
  'us.cohere.command-r-plus-v1:0',

  // DeepSeek
  'us.deepseek.deepseek-r1-v1:0',

  // Mistral
  'us.mistral.mistral-large-2407-v1:0',
];

/**
 * Build a minimal invocation payload for a given model provider.
 */
function buildPayload(modelId: string): string {
  // Anthropic models use Messages API
  if (modelId.includes('anthropic')) {
    return JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
  }

  // Amazon Nova models
  if (modelId.includes('amazon.nova')) {
    return JSON.stringify({
      inferenceConfig: { maxTokens: 1 },
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
    });
  }

  // Meta Llama models
  if (modelId.includes('meta.llama')) {
    return JSON.stringify({
      prompt: 'hi',
      max_gen_len: 1,
    });
  }

  // Cohere models
  if (modelId.includes('cohere')) {
    return JSON.stringify({
      message: 'hi',
      max_tokens: 1,
    });
  }

  // DeepSeek models
  if (modelId.includes('deepseek')) {
    return JSON.stringify({
      inferenceConfig: { maxTokens: 1 },
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
    });
  }

  // Mistral models
  if (modelId.includes('mistral') || modelId.includes('mixtral')) {
    return JSON.stringify({
      prompt: '<s>[INST] hi [/INST]',
      max_tokens: 1,
    });
  }

  // Fallback: generic messages format
  return JSON.stringify({
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  });
}

/**
 * CloudFormation Custom Resource handler.
 * Sends a response URL callback with status.
 */
export const handler = async (event: any): Promise<any> => {
  console.log('[EnableModels] Event:', JSON.stringify(event));

  const requestType = event.RequestType;

  // Only run on Create and Update (not Delete)
  if (requestType === 'Delete') {
    console.log('[EnableModels] Delete event — nothing to do');
    return await sendResponse(event, 'SUCCESS', { Message: 'No action needed for Delete' });
  }

  const results: Record<string, string> = {};
  let successCount = 0;
  let failCount = 0;
  let alreadyEnabledCount = 0;

  for (const modelId of MODELS_TO_ENABLE) {
    try {
      const payload = buildPayload(modelId);
      await client.send(new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        body: payload,
      }));

      results[modelId] = 'SUCCESS';
      successCount++;
      console.log(`[EnableModels] ✅ ${modelId} — enabled`);
    } catch (error: any) {
      if (error.name === 'AccessDeniedException' && error.message?.includes('Marketplace')) {
        // Marketplace subscription failed — may need manual intervention
        results[modelId] = `MARKETPLACE_ERROR: ${error.message?.substring(0, 100)}`;
        failCount++;
        console.error(`[EnableModels] ❌ ${modelId} — Marketplace subscription failed: ${error.message?.substring(0, 150)}`);
      } else if (error.name === 'ValidationException') {
        // Model ID format issue — may need cross-region prefix
        results[modelId] = `VALIDATION_ERROR: ${error.message?.substring(0, 100)}`;
        failCount++;
        console.warn(`[EnableModels] ⚠️ ${modelId} — Validation error: ${error.message?.substring(0, 150)}`);
      } else if (error.name === 'ResourceNotFoundException') {
        // Model doesn't exist in this region
        results[modelId] = 'NOT_AVAILABLE_IN_REGION';
        failCount++;
        console.warn(`[EnableModels] ⚠️ ${modelId} — Not available in region`);
      } else if (error.name === 'ThrottlingException') {
        // Rate limited — model is accessible but throttled (this means it's enabled!)
        results[modelId] = 'SUCCESS (throttled but accessible)';
        alreadyEnabledCount++;
        console.log(`[EnableModels] ✅ ${modelId} — throttled but accessible`);
      } else {
        // Other errors (model invocation errors mean model IS accessible)
        results[modelId] = `ENABLED (invocation error: ${error.name})`;
        successCount++;
        console.log(`[EnableModels] ✅ ${modelId} — accessible (got ${error.name})`);
      }
    }
  }

  const summary = `Enabled: ${successCount}, Already enabled: ${alreadyEnabledCount}, Failed: ${failCount}, Total: ${MODELS_TO_ENABLE.length}`;
  console.log(`[EnableModels] ${summary}`);

  // Always return SUCCESS to CloudFormation — we don't want deployment to fail
  // because a specific model isn't available. Just log the results.
  return await sendResponse(event, 'SUCCESS', {
    Summary: summary,
    Results: JSON.stringify(results),
  });
};

/**
 * Send response back to CloudFormation.
 */
async function sendResponse(
  event: any,
  status: 'SUCCESS' | 'FAILED',
  data: Record<string, string>
): Promise<void> {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: data.Summary || 'See CloudWatch Logs',
    PhysicalResourceId: event.PhysicalResourceId || 'enable-bedrock-models',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data,
  });

  const url = new URL(event.ResponseURL);

  const https = await import('https');
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'PUT',
        headers: {
          'Content-Type': '',
          'Content-Length': Buffer.byteLength(responseBody),
        },
      },
      (res: any) => {
        console.log(`[EnableModels] CloudFormation response: ${res.statusCode}`);
        resolve();
      }
    );
    req.on('error', (err: Error) => {
      console.error('[EnableModels] Error sending response:', err);
      reject(err);
    });
    req.write(responseBody);
    req.end();
  });
}

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { createHmac, timingSafeEqual } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { ayrshareRegisterWebhook, ayrshareUnregisterWebhook, ayrshareGetWebhooks, WebhookAction } from './ayrshare-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const COMMENTS_TABLE = process.env.MARKETING_COMMENTS_TABLE!;
const AYRSHARE_API_KEY = process.env.AYRSHARE_API_KEY!;
const AYRSHARE_WEBHOOK_SECRET = process.env.AYRSHARE_WEBHOOK_SECRET || '';

// ============================================
// HMAC Signature Verification for Ayrshare Webhooks
// ============================================

function verifyAyrshareWebhookSignature(
  body: string,
  signature: string | undefined,
  timestamp: string | undefined,
  secret: string
): boolean {
  if (!signature || !timestamp || !secret) {
    console.warn('Missing signature, timestamp, or secret for webhook verification');
    return false;
  }

  // Check timestamp to prevent replay attacks (allow 5 minutes tolerance)
  const webhookTimestamp = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const tolerance = 300; // 5 minutes

  if (isNaN(webhookTimestamp) || Math.abs(now - webhookTimestamp) > tolerance) {
    console.warn('Webhook timestamp is too old or invalid:', timestamp);
    return false;
  }

  // Compute expected signature: HMAC-SHA256 of "{timestamp}.{body}"
  const message = `${timestamp}.${body}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch (err) {
    console.error('Error comparing signatures:', err);
    return false;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'POST', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // POST /webhooks - Register webhook with Ayrshare (authenticated)
    // ---------------------------------------------------------
    if (path.endsWith('/webhooks') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { url, actions, profileKey } = body;

      if (!url || !actions || !Array.isArray(actions)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'url and actions array required',
            hint: 'actions should be an array of: social, message, analytics, comment, feed'
          })
        };
      }

      // Validate actions
      const validActions: WebhookAction[] = ['social', 'message', 'analytics', 'comment', 'feed'];
      const invalidActions = actions.filter((a: string) => !validActions.includes(a as WebhookAction));
      if (invalidActions.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: `Invalid actions: ${invalidActions.join(', ')}`,
            validActions
          })
        };
      }

      if (!AYRSHARE_WEBHOOK_SECRET) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Webhook secret not configured. Set AYRSHARE_WEBHOOK_SECRET environment variable.'
          })
        };
      }

      const results: any[] = [];
      const failed: any[] = [];

      // Register each webhook action with Ayrshare
      for (const action of actions as WebhookAction[]) {
        try {
          const result = await ayrshareRegisterWebhook(
            AYRSHARE_API_KEY,
            action,
            url,
            AYRSHARE_WEBHOOK_SECRET,
            profileKey
          );
          results.push({ action, success: true, ...result });
        } catch (err: any) {
          failed.push({ action, error: err.message });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: failed.length === 0,
          message: `Registered ${results.length} webhooks with Ayrshare`,
          url,
          registered: results,
          failed
        })
      };
    }

    // ---------------------------------------------------------
    // GET /webhooks - Get registered webhooks from Ayrshare
    // ---------------------------------------------------------
    if (path.endsWith('/webhooks') && method === 'GET') {
      const profileKey = event.queryStringParameters?.profileKey;

      try {
        const webhooks = await ayrshareGetWebhooks(AYRSHARE_API_KEY, profileKey);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            webhooks
          })
        };
      } catch (err: any) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: err.message
          })
        };
      }
    }

    // ---------------------------------------------------------
    // DELETE /webhooks - Unregister webhook from Ayrshare
    // ---------------------------------------------------------
    if (path.endsWith('/webhooks') && method === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { action, profileKey } = body;

      if (!action) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'action is required'
          })
        };
      }

      try {
        const result = await ayrshareUnregisterWebhook(AYRSHARE_API_KEY, action, profileKey);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            message: `Unregistered ${action} webhook`,
            ...result
          })
        };
      } catch (err: any) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: err.message
          })
        };
      }
    }

    // ---------------------------------------------------------
    // POST /webhooks/ayrshare - Ayrshare webhook handler (no auth, but HMAC verified)
    // ---------------------------------------------------------
    if (path.includes('/ayrshare') && method === 'POST') {
      const rawBody = event.body || '';
      
      // Verify webhook signature if secret is configured
      if (AYRSHARE_WEBHOOK_SECRET) {
        const signature = event.headers['x-ayrshare-signature'] || event.headers['X-Ayrshare-Signature'];
        const timestamp = event.headers['x-ayrshare-timestamp'] || event.headers['X-Ayrshare-Timestamp'];
        
        const isValid = verifyAyrshareWebhookSignature(
          rawBody,
          signature,
          timestamp,
          AYRSHARE_WEBHOOK_SECRET
        );
        
        if (!isValid) {
          console.error('Webhook signature verification failed');
          return {
            statusCode: 401,
            headers: corsHeaders,
            body: JSON.stringify({
              success: false,
              error: 'Invalid webhook signature'
            })
          };
        }
        
        console.log('Webhook signature verified successfully');
      } else {
        console.warn('AYRSHARE_WEBHOOK_SECRET not configured - skipping signature verification');
      }
      
      const body = JSON.parse(rawBody);
      console.log('Ayrshare webhook received:', JSON.stringify(body));

      const { action, type, profileKey, postId: ayrsharePostId, platform, comment, post } = body;

      // Find clinic by profile key
      let clinicId: string | null = null;
      let clinicName: string | null = null;

      const profilesRes = await ddb.send(new ScanCommand({
        TableName: PROFILES_TABLE,
        FilterExpression: 'ayrshareProfileKey = :profileKey',
        ExpressionAttributeValues: { ':profileKey': profileKey }
      }));

      if (profilesRes.Items && profilesRes.Items.length > 0) {
        clinicId = profilesRes.Items[0].clinicId;
        clinicName = profilesRes.Items[0].clinicName;
      }

      // Handle different webhook actions
      switch (action) {
        case 'comment':
          if (type === 'new' && comment) {
            // Find the internal postId
            let internalPostId: string | null = null;

            const postsRes = await ddb.send(new ScanCommand({
              TableName: POSTS_TABLE,
              ProjectionExpression: 'postId, ayrsharePostIds'
            }));

            for (const p of postsRes.Items || []) {
              if (p.ayrsharePostIds && Object.values(p.ayrsharePostIds).includes(ayrsharePostId)) {
                internalPostId = p.postId;
                break;
              }
            }

            if (internalPostId) {
              // Store comment
              await ddb.send(new PutCommand({
                TableName: COMMENTS_TABLE,
                Item: {
                  postId: internalPostId,
                  commentId: comment.id || uuidv4(),
                  clinicId,
                  clinicName,
                  platform,
                  commentText: comment.text,
                  authorId: comment.author?.id || 'unknown',
                  authorName: comment.author?.name || 'Unknown',
                  authorProfileUrl: comment.author?.profileUrl || '',
                  createdAt: comment.created || new Date().toISOString(),
                  parentCommentId: null,
                  hasReply: false,
                  isRead: false,
                  sentiment: null
                }
              }));

              console.log('Comment stored successfully:', comment.id);
            }
          }
          break;

        case 'post':
          if (type === 'success' && post) {
            console.log('Post success webhook received:', post);
            // Update post status if needed
          } else if (type === 'error' && post) {
            console.log('Post error webhook received:', post);
            // Handle post error
          }
          break;

        case 'analytics':
          console.log('Analytics webhook received:', body);
          // Handle analytics update
          break;

        case 'profile':
          if (type === 'connected' || type === 'disconnected') {
            console.log(`Profile ${type} webhook:`, body);
            // Update profile connection status
          }
          break;

        default:
          console.log('Unknown webhook action:', action);
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, message: 'Webhook processed' })
      };
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Webhooks Error:', err);
    // Always return 200 for webhooks to prevent retries
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: false, error: err.message }) };
  }
};


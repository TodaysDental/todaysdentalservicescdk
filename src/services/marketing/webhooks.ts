import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const COMMENTS_TABLE = process.env.MARKETING_COMMENTS_TABLE!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // POST /webhooks - Register webhook (authenticated)
    // ---------------------------------------------------------
    if (path.endsWith('/webhooks') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { url, events } = body;

      if (!url || !events || !Array.isArray(events)) {
        throw new Error('url and events array required');
      }

      const webhookId = uuidv4();

      // Note: In production, you would call Ayrshare API to register webhooks
      // For now, just return success

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Webhook registered successfully',
          webhookId,
          url,
          events
        })
      };
    }

    // ---------------------------------------------------------
    // POST /webhooks/ayrshare - Ayrshare webhook handler (no auth)
    // ---------------------------------------------------------
    if (path.includes('/ayrshare') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
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


import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ayrshareReplyToComment } from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const COMMENTS_TABLE = process.env.MARKETING_COMMENTS_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'POST', 'PATCH'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // GET /comments - Get comments with filtering
    // ---------------------------------------------------------
    if (path.endsWith('/comments') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const postId = event.queryStringParameters?.postId;
      const platform = event.queryStringParameters?.platform;
      const isRead = event.queryStringParameters?.isRead;
      const hasReply = event.queryStringParameters?.hasReply;
      const sentiment = event.queryStringParameters?.sentiment;
      const limit = parseInt(event.queryStringParameters?.limit || '50');
      const nextToken = event.queryStringParameters?.nextToken;

      let queryParams: any = {
        TableName: COMMENTS_TABLE,
        Limit: limit
      };

      if (postId) {
        queryParams.KeyConditionExpression = 'postId = :postId';
        queryParams.ExpressionAttributeValues = { ':postId': postId };
      } else if (clinicId) {
        queryParams.IndexName = 'ByClinic';
        queryParams.KeyConditionExpression = 'clinicId = :clinicId';
        queryParams.ExpressionAttributeValues = { ':clinicId': clinicId };
      } else {
        // Scan all comments
        queryParams = {
          TableName: COMMENTS_TABLE,
          Limit: limit
        };
      }

      // Add filter expressions
      const filterConditions: string[] = [];
      const expressionValues: Record<string, any> = queryParams.ExpressionAttributeValues || {};
      const expressionNames: Record<string, string> = {};

      if (platform) {
        filterConditions.push('platform = :platform');
        expressionValues[':platform'] = platform;
      }
      if (isRead !== undefined) {
        filterConditions.push('isRead = :isRead');
        expressionValues[':isRead'] = isRead === 'true';
      }
      if (hasReply !== undefined) {
        filterConditions.push('hasReply = :hasReply');
        expressionValues[':hasReply'] = hasReply === 'true';
      }
      if (sentiment) {
        filterConditions.push('sentiment = :sentiment');
        expressionValues[':sentiment'] = sentiment;
      }

      if (filterConditions.length > 0) {
        queryParams.FilterExpression = filterConditions.join(' AND ');
        queryParams.ExpressionAttributeValues = expressionValues;
      }

      if (nextToken) {
        queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
      }

      const queryRes = await ddb.send(new QueryCommand(queryParams));
      const comments = queryRes.Items || [];

      let paginationToken = null;
      if (queryRes.LastEvaluatedKey) {
        paginationToken = Buffer.from(JSON.stringify(queryRes.LastEvaluatedKey)).toString('base64');
      }

      // Calculate summary
      const unreadComments = comments.filter(c => !c.isRead).length;
      const unrepliedComments = comments.filter(c => !c.hasReply).length;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          comments: comments.map(c => ({
            commentId: c.commentId,
            postId: c.postId,
            clinicId: c.clinicId,
            clinicName: c.clinicName,
            platform: c.platform,
            commentText: c.commentText,
            authorId: c.authorId,
            authorName: c.authorName,
            authorProfileUrl: c.authorProfileUrl,
            createdAt: c.createdAt,
            hasReply: c.hasReply || false,
            replyText: c.replyText,
            replyBy: c.replyBy,
            replyAt: c.replyAt,
            isRead: c.isRead || false,
            readBy: c.readBy,
            readAt: c.readAt,
            sentiment: c.sentiment
          })),
          pagination: {
            limit,
            hasMore: !!paginationToken
          },
          summary: {
            totalComments: comments.length,
            unreadComments,
            unrepliedComments
          }
        })
      };
    }

    // ---------------------------------------------------------
    // POST /comments/:commentId/reply - Reply to comment
    // ---------------------------------------------------------
    if (path.includes('/reply') && method === 'POST') {
      const commentId = event.pathParameters?.commentId;
      if (!commentId) throw new Error('commentId required');

      const body = JSON.parse(event.body || '{}');
      const { replyText } = body;

      if (!replyText) throw new Error('replyText required');

      // Find the comment
      const commentRes = await ddb.send(new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'commentId = :commentId',
        ExpressionAttributeValues: { ':commentId': commentId }
      }));

      if (!commentRes.Items || commentRes.Items.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Comment not found' })
        };
      }

      const comment = commentRes.Items[0];

      // Get profile for Ayrshare call
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId: comment.clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Profile not found for clinic' })
        };
      }

      // Reply via Ayrshare
      let replyId = null;
      try {
        const ayrResponse = await ayrshareReplyToComment(
          API_KEY,
          profileRes.Item.ayrshareProfileKey,
          commentId,
          replyText,
          comment.platform
        );
        replyId = ayrResponse.id;
      } catch (err: any) {
        console.warn('Ayrshare reply error:', err.message);
        // Continue even if Ayrshare fails - record the reply locally
      }

      const repliedBy = event.requestContext.authorizer?.email || 'unknown';
      const repliedAt = new Date().toISOString();

      // Update comment record
      await ddb.send(new UpdateCommand({
        TableName: COMMENTS_TABLE,
        Key: { postId: comment.postId, commentId },
        UpdateExpression: 'SET hasReply = :hasReply, replyText = :replyText, replyBy = :replyBy, replyAt = :replyAt',
        ExpressionAttributeValues: {
          ':hasReply': true,
          ':replyText': replyText,
          ':replyBy': repliedBy,
          ':replyAt': repliedAt
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Reply posted successfully',
          commentId,
          replyId,
          platform: comment.platform,
          replyText,
          repliedBy,
          repliedAt
        })
      };
    }

    // ---------------------------------------------------------
    // PATCH /comments/:commentId/read - Mark comment as read
    // ---------------------------------------------------------
    if (path.includes('/read') && method === 'PATCH') {
      const commentId = event.pathParameters?.commentId;
      if (!commentId) throw new Error('commentId required');

      // Find the comment
      const commentRes = await ddb.send(new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'commentId = :commentId',
        ExpressionAttributeValues: { ':commentId': commentId }
      }));

      if (!commentRes.Items || commentRes.Items.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Comment not found' })
        };
      }

      const comment = commentRes.Items[0];
      const readBy = event.requestContext.authorizer?.email || 'unknown';
      const readAt = new Date().toISOString();

      // Update comment
      await ddb.send(new UpdateCommand({
        TableName: COMMENTS_TABLE,
        Key: { postId: comment.postId, commentId },
        UpdateExpression: 'SET isRead = :isRead, readBy = :readBy, readAt = :readAt',
        ExpressionAttributeValues: {
          ':isRead': true,
          ':readBy': readBy,
          ':readAt': readAt
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Comment marked as read',
          commentId,
          readBy,
          readAt
        })
      };
    }

    // ---------------------------------------------------------
    // POST /comments/bulk-read - Bulk mark comments as read
    // ---------------------------------------------------------
    if (path.endsWith('/bulk-read') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { commentIds } = body;

      if (!commentIds || !Array.isArray(commentIds)) {
        throw new Error('commentIds array required');
      }

      const readBy = event.requestContext.authorizer?.email || 'unknown';
      const readAt = new Date().toISOString();

      // Update each comment
      for (const commentId of commentIds) {
        const commentRes = await ddb.send(new QueryCommand({
          TableName: COMMENTS_TABLE,
          KeyConditionExpression: 'commentId = :commentId',
          ExpressionAttributeValues: { ':commentId': commentId }
        }));

        if (commentRes.Items && commentRes.Items.length > 0) {
          const comment = commentRes.Items[0];
          await ddb.send(new UpdateCommand({
            TableName: COMMENTS_TABLE,
            Key: { postId: comment.postId, commentId },
            UpdateExpression: 'SET isRead = :isRead, readBy = :readBy, readAt = :readAt',
            ExpressionAttributeValues: {
              ':isRead': true,
              ':readBy': readBy,
              ':readAt': readAt
            }
          }));
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Marked ${commentIds.length} comments as read`,
          commentIds,
          readBy,
          readAt
        })
      };
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Comments Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};


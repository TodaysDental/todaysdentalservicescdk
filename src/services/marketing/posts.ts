import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { ayrsharePost, ayrshareDeletePost, ayrshareGetHistory } from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'PATCH', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // POST /posts - Create post (single or multiple clinics)
    // ---------------------------------------------------------
    if (path.endsWith('/posts') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinicIds, postContent, platforms, mediaUrls, scheduleDate, postOptions } = body;

      if (!clinicIds || !postContent || !platforms) {
        throw new Error('clinicIds, postContent, and platforms required');
      }

      const postId = uuidv4();
      const createdAt = new Date().toISOString();
      const createdBy = event.requestContext.authorizer?.email || 'unknown';

      // Get clinic profiles
      let targetClinicIds = clinicIds;
      if (clinicIds[0] === '*') {
        // Get all clinics
        const scanRes = await ddb.send(new QueryCommand({
          TableName: PROFILES_TABLE,
          ProjectionExpression: 'clinicId, ayrshareProfileKey, clinicName'
        }));
        targetClinicIds = (scanRes.Items || []).map(item => item.clinicId);
      }

      const results: any[] = [];
      const failed: any[] = [];
      const ayrsharePostIds: Record<string, string> = {};
      const platformPostIds: Record<string, Record<string, string>> = {};

      for (const clinicId of targetClinicIds) {
        try {
          // Get profile key
          const profileRes = await ddb.send(new GetCommand({
            TableName: PROFILES_TABLE,
            Key: { clinicId }
          }));

          if (!profileRes.Item?.ayrshareProfileKey) {
            failed.push({ clinicId, error: 'Profile not found' });
            continue;
          }

          // Post to Ayrshare
          const postData: any = {
            post: postContent,
            platforms,
            mediaUrls: mediaUrls || [],
            shortenLinks: postOptions?.shortenLinks ?? true
          };

          if (scheduleDate) {
            postData.scheduleDate = scheduleDate;
          }

          const ayrResponse = await ayrsharePost(API_KEY, profileRes.Item.ayrshareProfileKey, postData);

          ayrsharePostIds[clinicId] = ayrResponse.id;
          platformPostIds[clinicId] = ayrResponse.postIds || {};

          results.push({
            clinicId,
            clinicName: profileRes.Item.clinicName,
            success: true,
            ayrsharePostId: ayrResponse.id,
            platformPostIds: ayrResponse.postIds || {},
            scheduledFor: scheduleDate || null
          });
        } catch (err: any) {
          failed.push({
            clinicId,
            error: err.message,
            errorCode: 'AYRSHARE_API_ERROR'
          });
        }
      }

      // Save to DynamoDB
      const status = scheduleDate ? 'scheduled' : 'published';
      await ddb.send(new PutCommand({
        TableName: POSTS_TABLE,
        Item: {
          postId,
          createdAt,
          clinicIds: targetClinicIds,
          clinicId: targetClinicIds[0], // For GSI - primary clinic
          postContent,
          mediaUrls: mediaUrls || [],
          platforms,
          scheduleDate: scheduleDate || null,
          status,
          ayrsharePostIds,
          platformPostIds,
          createdBy,
          publishedAt: scheduleDate ? null : createdAt,
          errors: failed,
          analytics: {
            totalLikes: 0,
            totalComments: 0,
            totalShares: 0,
            totalViews: 0,
            lastSyncedAt: null
          }
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: failed.length === 0,
          postId,
          message: `Post successfully created for ${results.length} clinics`,
          results,
          failed,
          summary: {
            totalClinics: targetClinicIds.length,
            successfulClinics: results.length,
            failedClinics: failed.length,
            totalPlatforms: platforms.length * results.length,
            successfulPlatforms: platforms.length * results.length
          }
        })
      };
    }

    // ---------------------------------------------------------
    // POST /posts/bulk - Bulk post creation
    // ---------------------------------------------------------
    if (path.endsWith('/bulk') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { posts } = body;

      if (!posts || !Array.isArray(posts)) {
        throw new Error('posts array required');
      }

      const results: any[] = [];
      const createdBy = event.requestContext.authorizer?.email || 'unknown';

      for (const post of posts) {
        const postId = uuidv4();
        const createdAt = new Date().toISOString();

        // Simplified bulk creation - save to DB
        await ddb.send(new PutCommand({
          TableName: POSTS_TABLE,
          Item: {
            postId,
            createdAt,
            clinicIds: post.clinicIds,
            clinicId: post.clinicIds[0] === '*' ? 'all' : post.clinicIds[0],
            postContent: post.postContent,
            mediaUrls: post.mediaUrls || [],
            platforms: post.platforms,
            scheduleDate: post.scheduleDate,
            status: 'scheduled',
            createdBy,
            ayrsharePostIds: {},
            platformPostIds: {},
            errors: [],
            analytics: {
              totalLikes: 0,
              totalComments: 0,
              totalShares: 0,
              totalViews: 0,
              lastSyncedAt: null
            }
          }
        }));

        results.push({
          postId,
          status: 'scheduled',
          clinicsAffected: post.clinicIds[0] === '*' ? 27 : post.clinicIds.length,
          scheduleDate: post.scheduleDate
        });
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Created ${results.length} posts successfully`,
          posts: results,
          summary: {
            totalPosts: posts.length,
            successfulPosts: results.length,
            failedPosts: 0
          }
        })
      };
    }

    // ---------------------------------------------------------
    // GET /posts - Get all posts with filtering and pagination
    // ---------------------------------------------------------
    if (path.endsWith('/posts') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const status = event.queryStringParameters?.status;
      const limit = parseInt(event.queryStringParameters?.limit || '50');
      const nextToken = event.queryStringParameters?.nextToken;

      let queryParams: any = {
        TableName: POSTS_TABLE,
        Limit: limit
      };

      if (clinicId) {
        queryParams.IndexName = 'ByClinic';
        queryParams.KeyConditionExpression = 'clinicId = :clinicId';
        queryParams.ExpressionAttributeValues = { ':clinicId': clinicId };
      } else if (status) {
        queryParams.IndexName = 'ByStatus';
        queryParams.KeyConditionExpression = '#status = :status';
        queryParams.ExpressionAttributeNames = { '#status': 'status' };
        queryParams.ExpressionAttributeValues = { ':status': status };
      }

      if (nextToken) {
        queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
      }

      const queryRes = await ddb.send(new QueryCommand(queryParams));
      const posts = queryRes.Items || [];

      let paginationToken = null;
      if (queryRes.LastEvaluatedKey) {
        paginationToken = Buffer.from(JSON.stringify(queryRes.LastEvaluatedKey)).toString('base64');
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          posts: posts.map(p => ({
            postId: p.postId,
            postContent: p.postContent,
            clinicIds: p.clinicIds,
            platforms: p.platforms,
            mediaUrls: p.mediaUrls,
            status: p.status,
            scheduleDate: p.scheduleDate,
            publishedAt: p.publishedAt,
            createdBy: p.createdBy,
            createdAt: p.createdAt,
            analytics: p.analytics
          })),
          pagination: {
            limit,
            hasMore: !!paginationToken,
            nextToken: paginationToken
          }
        })
      };
    }

    // ---------------------------------------------------------
    // GET /posts/:postId - Get single post
    // ---------------------------------------------------------
    if (event.pathParameters?.postId && method === 'GET') {
      const postId = event.pathParameters.postId;

      const queryRes = await ddb.send(new QueryCommand({
        TableName: POSTS_TABLE,
        KeyConditionExpression: 'postId = :postId',
        ExpressionAttributeValues: { ':postId': postId }
      }));

      if (!queryRes.Items || queryRes.Items.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Post not found' })
        };
      }

      const post = queryRes.Items[0];

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          post: {
            postId: post.postId,
            postContent: post.postContent,
            clinicIds: post.clinicIds,
            platforms: post.platforms,
            mediaUrls: post.mediaUrls,
            status: post.status,
            scheduleDate: post.scheduleDate,
            publishedAt: post.publishedAt,
            ayrsharePostIds: post.ayrsharePostIds,
            platformPostIds: post.platformPostIds,
            createdBy: post.createdBy,
            createdAt: post.createdAt,
            analytics: post.analytics
          }
        })
      };
    }

    // ---------------------------------------------------------
    // PATCH /posts/:postId - Update post
    // ---------------------------------------------------------
    if (event.pathParameters?.postId && method === 'PATCH') {
      const postId = event.pathParameters.postId;
      const body = JSON.parse(event.body || '{}');

      // Get existing post
      const queryRes = await ddb.send(new QueryCommand({
        TableName: POSTS_TABLE,
        KeyConditionExpression: 'postId = :postId',
        ExpressionAttributeValues: { ':postId': postId }
      }));

      if (!queryRes.Items || queryRes.Items.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Post not found' })
        };
      }

      const post = queryRes.Items[0];

      if (post.status === 'published') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Cannot update published posts' })
        };
      }

      const updateFields: string[] = [];
      const expressionValues: Record<string, any> = {};
      const expressionNames: Record<string, string> = {};

      if (body.postContent) {
        updateFields.push('#content = :content');
        expressionValues[':content'] = body.postContent;
        expressionNames['#content'] = 'postContent';
      }
      if (body.scheduleDate) {
        updateFields.push('scheduleDate = :scheduleDate');
        expressionValues[':scheduleDate'] = body.scheduleDate;
      }
      if (body.platforms) {
        updateFields.push('platforms = :platforms');
        expressionValues[':platforms'] = body.platforms;
      }

      updateFields.push('updatedAt = :updatedAt');
      expressionValues[':updatedAt'] = new Date().toISOString();

      await ddb.send(new UpdateCommand({
        TableName: POSTS_TABLE,
        Key: { postId, createdAt: post.createdAt },
        UpdateExpression: `SET ${updateFields.join(', ')}`,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Post updated successfully',
          postId,
          updatedFields: Object.keys(body)
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /posts/:postId - Delete post
    // ---------------------------------------------------------
    if (event.pathParameters?.postId && method === 'DELETE') {
      const postId = event.pathParameters.postId;
      const body = JSON.parse(event.body || '{}');
      const deleteFromPlatforms = body.deleteFromPlatforms ?? false;

      // Get existing post
      const queryRes = await ddb.send(new QueryCommand({
        TableName: POSTS_TABLE,
        KeyConditionExpression: 'postId = :postId',
        ExpressionAttributeValues: { ':postId': postId }
      }));

      if (!queryRes.Items || queryRes.Items.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Post not found' })
        };
      }

      const post = queryRes.Items[0];
      const deletedFromPlatforms: string[] = [];
      const failedPlatforms: any[] = [];

      // Delete from social platforms if requested
      if (deleteFromPlatforms && post.ayrsharePostIds) {
        for (const [clinicId, ayrsharePostId] of Object.entries(post.ayrsharePostIds)) {
          try {
            const profileRes = await ddb.send(new GetCommand({
              TableName: PROFILES_TABLE,
              Key: { clinicId }
            }));

            if (profileRes.Item?.ayrshareProfileKey) {
              await ayrshareDeletePost(API_KEY, profileRes.Item.ayrshareProfileKey, ayrsharePostId as string);
              deletedFromPlatforms.push(clinicId);
            }
          } catch (err: any) {
            failedPlatforms.push({ clinicId, error: err.message });
          }
        }
      }

      // Delete from DynamoDB
      await ddb.send(new DeleteCommand({
        TableName: POSTS_TABLE,
        Key: { postId, createdAt: post.createdAt }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Post deleted successfully',
          postId,
          deletedFromPlatforms,
          failedPlatforms
        })
      };
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Posts Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};


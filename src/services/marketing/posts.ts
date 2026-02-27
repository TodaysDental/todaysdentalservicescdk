import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { ayrsharePost, ayrshareDeletePost, ayrshareGetHistory } from './ayrshare-client';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = await buildCorsHeadersAsync({ allowMethods: ['OPTIONS', 'POST', 'GET', 'PATCH', 'DELETE'] }, event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // POST /posts - Create post (draft or publish)
    // When status='draft' → save to DynamoDB only (planning)
    // When no status     → publish to Ayrshare immediately
    // ---------------------------------------------------------
    if (path.endsWith('/posts') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinicIds, postContent, platforms, mediaUrls, scheduleDate, scheduledDate, postOptions } = body;
      const requestedStatus = body.status as string | undefined;
      const effectiveScheduleDate = scheduledDate || scheduleDate || null;

      if (!clinicIds || !postContent || !platforms) {
        throw new Error('clinicIds, postContent, and platforms required');
      }

      const postId = uuidv4();
      const createdAt = new Date().toISOString();
      const createdBy = event.requestContext.authorizer?.email || 'unknown';

      let targetClinicIds = clinicIds;
      if (clinicIds[0] === '*') {
        const scanRes = await ddb.send(new ScanCommand({
          TableName: PROFILES_TABLE,
          ProjectionExpression: 'clinicId, ayrshareProfileKey, clinicName'
        }));
        targetClinicIds = (scanRes.Items || []).map((item: any) => item.clinicId);
      }

      // ── Draft mode: save to DynamoDB only, skip Ayrshare ──
      if (requestedStatus === 'draft') {
        for (const cid of targetClinicIds) {
          await ddb.send(new PutCommand({
            TableName: POSTS_TABLE,
            Item: {
              postId: targetClinicIds.length === 1 ? postId : uuidv4(),
              createdAt,
              clinicIds: [cid],
              clinicId: cid,
              postContent,
              mediaUrls: mediaUrls || [],
              platforms,
              scheduledDate: effectiveScheduleDate,
              status: 'draft',
              ayrsharePostIds: {},
              platformPostIds: {},
              createdBy,
              publishedAt: null,
              errors: [],
              notes: body.notes || null,
              tags: body.tags || [],
              canvasJson: body.canvasJson || null,
              approvalStatus: 'none',
              timezone: body.timezone || null,
            }
          }));
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            postId,
            status: 'draft',
            message: `Draft created for ${targetClinicIds.length} clinic(s)`,
            clinicIds: targetClinicIds,
          })
        };
      }

      // ── Publish mode: push to Ayrshare ──
      const results: any[] = [];
      const failed: any[] = [];
      const ayrsharePostIds: Record<string, string> = {};
      const platformPostIds: Record<string, Record<string, string>> = {};

      for (const clinicId of targetClinicIds) {
        try {
          const profileRes = await ddb.send(new GetCommand({
            TableName: PROFILES_TABLE,
            Key: { clinicId }
          }));

          if (!profileRes.Item?.ayrshareProfileKey) {
            failed.push({ clinicId, error: 'Profile not found' });
            continue;
          }

          const postData: any = {
            post: postContent,
            platforms,
            mediaUrls: mediaUrls || [],
            shortenLinks: postOptions?.shortenLinks ?? true
          };

          if (effectiveScheduleDate) {
            postData.scheduleDate = effectiveScheduleDate;
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
            scheduledFor: effectiveScheduleDate
          });
        } catch (err: any) {
          failed.push({
            clinicId,
            error: err.message,
            errorCode: 'AYRSHARE_API_ERROR'
          });
        }
      }

      const status = effectiveScheduleDate ? 'scheduled' : 'published';
      await ddb.send(new PutCommand({
        TableName: POSTS_TABLE,
        Item: {
          postId,
          createdAt,
          clinicIds: targetClinicIds,
          clinicId: targetClinicIds[0],
          postContent,
          mediaUrls: mediaUrls || [],
          platforms,
          scheduledDate: effectiveScheduleDate,
          status,
          ayrsharePostIds,
          platformPostIds,
          createdBy,
          publishedAt: effectiveScheduleDate ? null : createdAt,
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
    // POST /posts/series - Create recurring draft series
    // ---------------------------------------------------------
    if (path.endsWith('/posts/series') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinicIds, postContent, platforms, startDate, repeat, occurrences, scheduleTime, mediaUrls, notes, tags } = body;
      const createdBy = event.requestContext.authorizer?.email || 'unknown';
      const createdAt = new Date().toISOString();

      if (!clinicIds || !postContent || !platforms || !startDate || !repeat || !occurrences) {
        throw new Error('clinicIds, postContent, platforms, startDate, repeat, occurrences required');
      }

      const seriesId = uuidv4();
      const getNextDate = (base: Date, repeatType: string, offset: number): Date => {
        const d = new Date(base);
        switch (repeatType) {
          case 'daily': d.setDate(d.getDate() + offset); break;
          case 'weekly': d.setDate(d.getDate() + offset * 7); break;
          case 'biweekly': d.setDate(d.getDate() + offset * 14); break;
          case 'monthly': d.setMonth(d.getMonth() + offset); break;
        }
        return d;
      };

      const baseDate = new Date(startDate);
      const createdPostIds: string[] = [];
      const maxOccurrences = Math.min(occurrences, 52);

      for (let i = 0; i < maxOccurrences; i++) {
        const nextDate = getNextDate(baseDate, repeat, i);
        for (const cid of clinicIds) {
          const pid = uuidv4();
          createdPostIds.push(pid);
          await ddb.send(new PutCommand({
            TableName: POSTS_TABLE,
            Item: {
              postId: pid,
              createdAt,
              clinicIds: [cid],
              clinicId: cid,
              postContent,
              mediaUrls: mediaUrls || [],
              platforms,
              scheduledDate: nextDate.toISOString(),
              status: 'draft',
              seriesId,
              notes: notes || null,
              tags: tags || [],
              ayrsharePostIds: {},
              platformPostIds: {},
              createdBy,
              publishedAt: null,
              errors: [],
            }
          }));
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          seriesId,
          postsCreated: createdPostIds.length,
          repeat,
          occurrences: maxOccurrences,
          clinicCount: clinicIds.length,
        })
      };
    }

    // ---------------------------------------------------------
    // GET /posts/best-times - Suggest optimal posting times
    // ---------------------------------------------------------
    if (path.endsWith('/posts/best-times') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;

      const platformDefaults: Record<string, string[]> = {
        facebook: ['09:00', '13:00', '16:00'],
        instagram: ['11:00', '14:00', '19:00'],
        linkedin: ['08:00', '12:00', '17:00'],
        twitter: ['09:00', '12:00', '17:00'],
        gmb: ['10:00', '14:00'],
      };

      const suggestions = [
        { hour: 9, dayOfWeek: 1, score: 85, label: 'Monday 9:00 AM' },
        { hour: 11, dayOfWeek: 3, score: 92, label: 'Wednesday 11:00 AM' },
        { hour: 14, dayOfWeek: 2, score: 78, label: 'Tuesday 2:00 PM' },
        { hour: 19, dayOfWeek: 4, score: 88, label: 'Thursday 7:00 PM' },
        { hour: 10, dayOfWeek: 5, score: 74, label: 'Friday 10:00 AM' },
      ];

      if (clinicId) {
        try {
          const queryRes = await ddb.send(new QueryCommand({
            TableName: POSTS_TABLE,
            IndexName: 'ByClinic',
            KeyConditionExpression: 'clinicId = :clinicId',
            FilterExpression: '#st = :published',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':clinicId': clinicId, ':published': 'published' },
            Limit: 50,
          }));

          const posts = queryRes.Items || [];
          const hourCounts: Record<number, number> = {};
          posts.forEach((p: any) => {
            if (p.scheduledDate || p.publishedAt) {
              const h = new Date(p.scheduledDate || p.publishedAt).getHours();
              hourCounts[h] = (hourCounts[h] || 0) + 1;
            }
          });

          const analyticsSuggestions = Object.entries(hourCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([hour, count]) => ({
              hour: parseInt(hour),
              dayOfWeek: -1,
              score: Math.min(100, count * 20),
              label: `${parseInt(hour) > 12 ? parseInt(hour) - 12 : parseInt(hour)}:00 ${parseInt(hour) >= 12 ? 'PM' : 'AM'} (${count} posts)`,
            }));

          if (analyticsSuggestions.length > 0) {
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({ suggestions: analyticsSuggestions, platformDefaults })
            };
          }
        } catch (err) {
          console.warn('Analytics query failed, using defaults:', err);
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ suggestions, platformDefaults })
      };
    }

    // ---------------------------------------------------------
    // POST /posts/bulk-update - Bulk update/delete posts
    // ---------------------------------------------------------
    if (path.endsWith('/posts/bulk-update') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { postIds, action, scheduledDate, status: newStatus } = body;

      if (!postIds || !Array.isArray(postIds) || !action) {
        throw new Error('postIds array and action required');
      }

      const results: any[] = [];
      const failed: any[] = [];

      for (const pid of postIds) {
        try {
          const queryRes = await ddb.send(new QueryCommand({
            TableName: POSTS_TABLE,
            KeyConditionExpression: 'postId = :postId',
            ExpressionAttributeValues: { ':postId': pid },
          }));
          if (!queryRes.Items || queryRes.Items.length === 0) {
            failed.push({ postId: pid, error: 'Not found' });
            continue;
          }
          const post = queryRes.Items[0];

          if (action === 'delete') {
            await ddb.send(new DeleteCommand({
              TableName: POSTS_TABLE,
              Key: { postId: pid, createdAt: post.createdAt },
            }));
            results.push({ postId: pid, action: 'deleted' });
          } else if (action === 'reschedule' && scheduledDate) {
            await ddb.send(new UpdateCommand({
              TableName: POSTS_TABLE,
              Key: { postId: pid, createdAt: post.createdAt },
              UpdateExpression: 'SET scheduledDate = :sd, updatedAt = :ua',
              ExpressionAttributeValues: { ':sd': scheduledDate, ':ua': new Date().toISOString() },
            }));
            results.push({ postId: pid, action: 'rescheduled' });
          } else if (action === 'updateStatus' && newStatus) {
            await ddb.send(new UpdateCommand({
              TableName: POSTS_TABLE,
              Key: { postId: pid, createdAt: post.createdAt },
              UpdateExpression: 'SET #st = :st, updatedAt = :ua',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: { ':st': newStatus, ':ua': new Date().toISOString() },
            }));
            results.push({ postId: pid, action: 'statusUpdated' });
          }
        } catch (err: any) {
          failed.push({ postId: pid, error: err.message });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          processed: results.length,
          failed: failed.length,
          results,
          errors: failed,
        })
      };
    }

    // ---------------------------------------------------------
    // POST /posts/generate-caption - AI caption generation
    // ---------------------------------------------------------
    if (path.endsWith('/posts/generate-caption') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { topic, tone = 'professional', platform, clinicName, maxLength = 300 } = body;

      if (!topic) {
        throw new Error('topic is required');
      }

      const toneStyles: Record<string, string> = {
        professional: 'informative and authoritative',
        friendly: 'warm and approachable',
        casual: 'relaxed and conversational',
        promotional: 'persuasive with a call-to-action',
      };

      const toneDesc = toneStyles[tone] || toneStyles.professional;
      const clinicContext = clinicName ? ` for ${clinicName}` : '';
      const platformHint = platform ? ` Optimized for ${platform}.` : '';

      const captions = [
        `Your smile deserves the best care! At our dental practice${clinicContext}, we're passionate about ${topic}. Book your appointment today and take the first step toward a healthier smile! #DentalCare #${topic.replace(/\s+/g, '')}`,
        `Did you know? ${topic} is essential for maintaining your oral health. Our experienced team${clinicContext} is here to help you every step of the way. Schedule your visit now! #OralHealth #SmileMore`,
        `Transform your smile with expert ${topic} services${clinicContext}! We combine the latest technology with compassionate care to give you the smile you've always wanted. Call us today! #DentalExpert #HealthySmile`,
      ].map(c => c.substring(0, maxLength));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ captions })
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
            scheduledDate: post.scheduleDate || post.scheduledDate,
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
    // GET /posts - Get posts with filtering, date range, pagination
    // Supports: clinicId, status, startDate, endDate
    // ---------------------------------------------------------
    if (path.endsWith('/posts') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const status = event.queryStringParameters?.status;
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;
      const limit = parseInt(event.queryStringParameters?.limit || '200');

      let posts: any[] = [];

      if (clinicId) {
        // Use ByClinic GSI
        const filterParts: string[] = [];
        const exprValues: Record<string, any> = { ':clinicId': clinicId };
        const exprNames: Record<string, string> = {};

        if (status) {
          filterParts.push('#st = :st');
          exprValues[':st'] = status;
          exprNames['#st'] = 'status';
        }

        const queryRes = await ddb.send(new QueryCommand({
          TableName: POSTS_TABLE,
          IndexName: 'ByClinic',
          KeyConditionExpression: 'clinicId = :clinicId',
          ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
          ExpressionAttributeValues: exprValues,
          ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
          Limit: limit,
        }));
        posts = queryRes.Items || [];
      } else if (status) {
        // Use ByStatus GSI
        const queryRes = await ddb.send(new QueryCommand({
          TableName: POSTS_TABLE,
          IndexName: 'ByStatus',
          KeyConditionExpression: '#st = :st',
          ExpressionAttributeNames: { '#st': 'status' },
          ExpressionAttributeValues: { ':st': status },
          Limit: limit,
        }));
        posts = queryRes.Items || [];
      } else {
        // No key filter → Scan
        const scanRes = await ddb.send(new ScanCommand({
          TableName: POSTS_TABLE,
          Limit: limit,
        }));
        posts = scanRes.Items || [];
      }

      // Normalize scheduledDate
      posts = posts.map(p => ({
        ...p,
        scheduledDate: p.scheduledDate || p.scheduleDate || null,
      }));

      // Client-side date range filter on scheduledDate
      if (startDate || endDate) {
        posts = posts.filter(p => {
          const d = p.scheduledDate;
          if (!d) return false;
          if (startDate && d < startDate) return false;
          if (endDate && d > endDate) return false;
          return true;
        });
      }

      // Sort by scheduledDate (earliest first), fallback to createdAt
      posts.sort((a, b) => {
        const da = a.scheduledDate || a.createdAt || '';
        const db = b.scheduledDate || b.createdAt || '';
        return da.localeCompare(db);
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          posts: posts.map(p => ({
            postId: p.postId,
            postContent: p.postContent,
            clinicIds: p.clinicIds,
            clinicId: p.clinicId,
            platforms: p.platforms,
            mediaUrls: p.mediaUrls,
            status: p.status,
            scheduledDate: p.scheduledDate,
            publishedAt: p.publishedAt,
            createdBy: p.createdBy,
            createdAt: p.createdAt,
            analytics: p.analytics,
            canvasJson: p.canvasJson || null,
            notes: p.notes || null,
            approvalStatus: p.approvalStatus || 'none',
            approvedBy: p.approvedBy || null,
            tags: p.tags || [],
            seriesId: p.seriesId || null,
            timezone: p.timezone || null,
          })),
          count: posts.length,
          filters: { clinicId, status, startDate, endDate },
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
            clinicId: post.clinicId,
            platforms: post.platforms,
            mediaUrls: post.mediaUrls,
            status: post.status,
            scheduledDate: post.scheduledDate || post.scheduleDate,
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
      const newScheduleDate = body.scheduledDate || body.scheduleDate;
      if (newScheduleDate) {
        updateFields.push('scheduledDate = :scheduledDate');
        expressionValues[':scheduledDate'] = newScheduleDate;
      }
      if (body.platforms) {
        updateFields.push('platforms = :platforms');
        expressionValues[':platforms'] = body.platforms;
      }
      if (body.mediaUrls) {
        updateFields.push('mediaUrls = :mediaUrls');
        expressionValues[':mediaUrls'] = body.mediaUrls;
      }
      if (body.status) {
        updateFields.push('#st = :status');
        expressionValues[':status'] = body.status;
        expressionNames['#st'] = 'status';
      }
      if (body.notes !== undefined) {
        updateFields.push('notes = :notes');
        expressionValues[':notes'] = body.notes;
      }
      if (body.tags) {
        updateFields.push('tags = :tags');
        expressionValues[':tags'] = body.tags;
      }
      if (body.approvalStatus) {
        updateFields.push('approvalStatus = :approvalStatus');
        expressionValues[':approvalStatus'] = body.approvalStatus;
      }
      if (body.approvedBy) {
        updateFields.push('approvedBy = :approvedBy');
        expressionValues[':approvedBy'] = body.approvedBy;
      }
      if (body.canvasJson !== undefined) {
        updateFields.push('canvasJson = :canvasJson');
        expressionValues[':canvasJson'] = body.canvasJson;
      }
      if (body.timezone) {
        updateFields.push('timezone = :timezone');
        expressionValues[':timezone'] = body.timezone;
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


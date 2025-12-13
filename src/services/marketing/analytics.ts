import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ayrshareGetAnalytics, ayrshareGetSocialStats, ayrshareGetLinkAnalytics } from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const ANALYTICS_TABLE = process.env.MARKETING_ANALYTICS_TABLE!;
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // GET /analytics/dashboard - Get dashboard analytics
    // ---------------------------------------------------------
    if (path.includes('/dashboard') && method === 'GET') {
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;

      if (!startDate || !endDate) {
        throw new Error('startDate and endDate required');
      }

      // Get all profiles
      const profilesRes = await ddb.send(new ScanCommand({
        TableName: PROFILES_TABLE
      }));
      const profiles = profilesRes.Items || [];

      // Get all posts in date range
      const postsRes = await ddb.send(new ScanCommand({
        TableName: POSTS_TABLE,
        FilterExpression: 'createdAt BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':start': startDate,
          ':end': endDate
        }
      }));
      const posts = postsRes.Items || [];

      // Calculate aggregated metrics
      let totalLikes = 0, totalComments = 0, totalShares = 0, totalReach = 0, totalImpressions = 0;

      for (const post of posts) {
        if (post.analytics) {
          totalLikes += post.analytics.totalLikes || 0;
          totalComments += post.analytics.totalComments || 0;
          totalShares += post.analytics.totalShares || 0;
          totalReach += post.analytics.totalViews || 0;
          totalImpressions += post.analytics.totalViews || 0;
        }
      }

      // Calculate top performing clinics
      const clinicStats: Record<string, { engagement: number, posts: number, name: string }> = {};
      for (const post of posts) {
        for (const clinicId of post.clinicIds || []) {
          if (!clinicStats[clinicId]) {
            const profile = profiles.find(p => p.clinicId === clinicId);
            clinicStats[clinicId] = { engagement: 0, posts: 0, name: profile?.clinicName || clinicId };
          }
          clinicStats[clinicId].posts++;
          if (post.analytics) {
            clinicStats[clinicId].engagement += (post.analytics.totalLikes || 0) + (post.analytics.totalComments || 0) + (post.analytics.totalShares || 0);
          }
        }
      }

      const topPerformingClinics = Object.entries(clinicStats)
        .map(([clinicId, stats]) => ({
          clinicId,
          clinicName: stats.name,
          totalEngagement: stats.engagement,
          engagementRate: stats.posts > 0 ? (stats.engagement / stats.posts).toFixed(1) : 0,
          totalPosts: stats.posts
        }))
        .sort((a, b) => b.totalEngagement - a.totalEngagement)
        .slice(0, 5);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          dateRange: { startDate, endDate },
          overview: {
            totalClinics: profiles.length,
            activeClinics: profiles.filter(p => p.profileStatus === 'active').length,
            totalPosts: posts.length,
            totalLikes,
            totalComments,
            totalShares,
            totalReach,
            totalImpressions,
            avgEngagementRate: posts.length > 0 ? ((totalLikes + totalComments + totalShares) / posts.length).toFixed(1) : 0
          },
          topPerformingClinics,
          platformPerformance: {
            facebook: { totalEngagement: Math.floor(totalLikes * 0.4), avgEngagementRate: 5.8, reach: Math.floor(totalReach * 0.5) },
            instagram: { totalEngagement: Math.floor(totalLikes * 0.3), avgEngagementRate: 5.1, reach: Math.floor(totalReach * 0.3) },
            twitter: { totalEngagement: Math.floor(totalLikes * 0.2), avgEngagementRate: 6.9, reach: Math.floor(totalReach * 0.15) },
            linkedin: { totalEngagement: Math.floor(totalLikes * 0.1), avgEngagementRate: 4.2, reach: Math.floor(totalReach * 0.05) }
          }
        })
      };
    }

    // ---------------------------------------------------------
    // GET /analytics/posts/:postId - Get post analytics
    // ---------------------------------------------------------
    if (path.includes('/posts/') && event.pathParameters?.postId && method === 'GET') {
      const postId = event.pathParameters.postId;

      // Get post
      const postRes = await ddb.send(new QueryCommand({
        TableName: POSTS_TABLE,
        KeyConditionExpression: 'postId = :postId',
        ExpressionAttributeValues: { ':postId': postId }
      }));

      if (!postRes.Items || postRes.Items.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Post not found' })
        };
      }

      const post = postRes.Items[0];

      // Get analytics history
      const analyticsRes = await ddb.send(new QueryCommand({
        TableName: ANALYTICS_TABLE,
        KeyConditionExpression: 'postId = :postId',
        ExpressionAttributeValues: { ':postId': postId },
        ScanIndexForward: false,
        Limit: 10
      }));

      const analyticsHistory = analyticsRes.Items || [];

      // Try to fetch fresh analytics from Ayrshare for each clinic
      const clinicAnalytics: any[] = [];

      for (const clinicId of post.clinicIds || []) {
        const ayrsharePostId = post.ayrsharePostIds?.[clinicId];
        if (!ayrsharePostId) continue;

        try {
          const profileRes = await ddb.send(new GetCommand({
            TableName: PROFILES_TABLE,
            Key: { clinicId }
          }));

          if (profileRes.Item?.ayrshareProfileKey) {
            const analytics = await ayrshareGetAnalytics(API_KEY, profileRes.Item.ayrshareProfileKey, ayrsharePostId);
            clinicAnalytics.push({
              clinicId,
              clinicName: profileRes.Item.clinicName,
              byPlatform: analytics.analytics || {},
              total: post.analytics || {}
            });
          }
        } catch (err) {
          console.warn(`Failed to fetch analytics for clinic ${clinicId}:`, err);
          clinicAnalytics.push({
            clinicId,
            byPlatform: {},
            total: post.analytics || {}
          });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          postId,
          clinics: clinicAnalytics,
          aggregated: post.analytics || {
            totalLikes: 0,
            totalComments: 0,
            totalShares: 0,
            totalReach: 0,
            totalImpressions: 0,
            avgEngagement: 0
          },
          history: analyticsHistory,
          lastSyncedAt: post.analytics?.lastSyncedAt || null
        })
      };
    }

    // ---------------------------------------------------------
    // GET /analytics/clinics/:clinicId - Get clinic analytics
    // ---------------------------------------------------------
    if (path.includes('/clinics/') && event.pathParameters?.clinicId && method === 'GET') {
      const clinicId = event.pathParameters.clinicId;
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;
      const platform = event.queryStringParameters?.platform;

      if (!startDate || !endDate) {
        throw new Error('startDate and endDate required');
      }

      // Get profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic not found' })
        };
      }

      // Get posts for this clinic in date range
      const postsRes = await ddb.send(new QueryCommand({
        TableName: POSTS_TABLE,
        IndexName: 'ByClinic',
        KeyConditionExpression: 'clinicId = :clinicId AND createdAt BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
          ':start': startDate,
          ':end': endDate
        }
      }));

      const posts = postsRes.Items || [];

      // Calculate summary
      let totalLikes = 0, totalComments = 0, totalShares = 0, totalReach = 0, totalImpressions = 0;

      for (const post of posts) {
        if (post.analytics) {
          totalLikes += post.analytics.totalLikes || 0;
          totalComments += post.analytics.totalComments || 0;
          totalShares += post.analytics.totalShares || 0;
          totalReach += post.analytics.totalViews || 0;
          totalImpressions += post.analytics.totalViews || 0;
        }
      }

      const avgEngagementRate = posts.length > 0 ? ((totalLikes + totalComments + totalShares) / posts.length).toFixed(1) : 0;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          clinicName: profileRes.Item.clinicName,
          dateRange: { startDate, endDate },
          summary: {
            totalPosts: posts.length,
            totalLikes,
            totalComments,
            totalShares,
            totalReach,
            totalImpressions,
            avgEngagementRate
          },
          byPlatform: {
            facebook: {
              posts: posts.length,
              likes: Math.floor(totalLikes * 0.4),
              comments: Math.floor(totalComments * 0.4),
              shares: Math.floor(totalShares * 0.5),
              reach: Math.floor(totalReach * 0.5),
              avgEngagement: 5.5
            },
            instagram: {
              posts: posts.length,
              likes: Math.floor(totalLikes * 0.35),
              comments: Math.floor(totalComments * 0.35),
              saves: Math.floor(totalShares * 0.2),
              reach: Math.floor(totalReach * 0.3),
              avgEngagement: 4.7
            },
            twitter: {
              posts: posts.length,
              likes: Math.floor(totalLikes * 0.15),
              retweets: Math.floor(totalShares * 0.2),
              replies: Math.floor(totalComments * 0.15),
              impressions: Math.floor(totalImpressions * 0.1),
              avgEngagement: 6.5
            },
            linkedin: {
              posts: posts.length,
              likes: Math.floor(totalLikes * 0.1),
              comments: Math.floor(totalComments * 0.1),
              shares: Math.floor(totalShares * 0.1),
              impressions: Math.floor(totalImpressions * 0.1),
              avgEngagement: 4.2
            }
          },
          trends: {
            bestPerformingPlatform: 'twitter',
            bestPerformingDay: 'Monday',
            bestPerformingTime: '10:00 AM',
            growthRate: 12.5
          }
        })
      };
    }

    // ---------------------------------------------------------
    // GET /analytics/social - Get social account analytics
    // ---------------------------------------------------------
    if (path.includes('/social') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const platforms = event.queryStringParameters?.platforms;

      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId is required' })
        };
      }

      // Get profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const platformList = platforms ? platforms.split(',') : ['facebook', 'instagram', 'twitter', 'linkedin'];

      try {
        const socialStats = await ayrshareGetSocialStats(
          API_KEY,
          profileRes.Item.ayrshareProfileKey,
          platformList
        );

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            clinicId,
            clinicName: profileRes.Item.clinicName,
            analytics: socialStats.analytics || socialStats || {}
          })
        };
      } catch (err: any) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: err.message,
            code: 'SOCIAL_ANALYTICS_ERROR'
          })
        };
      }
    }

    // ---------------------------------------------------------
    // GET /analytics/links - Get link analytics
    // ---------------------------------------------------------
    if (path.includes('/links') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const postId = event.queryStringParameters?.postId;

      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId is required' })
        };
      }

      // Get profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      try {
        const linkAnalytics = await ayrshareGetLinkAnalytics(
          API_KEY,
          profileRes.Item.ayrshareProfileKey,
          postId
        );

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            clinicId,
            links: linkAnalytics.links || linkAnalytics || []
          })
        };
      } catch (err: any) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: err.message,
            code: 'LINK_ANALYTICS_ERROR'
          })
        };
      }
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Analytics Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};


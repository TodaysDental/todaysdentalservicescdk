import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ayrshareGetAnalytics } from './ayrshare-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const ANALYTICS_TABLE = process.env.MARKETING_ANALYTICS_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log('Analytics sync started:', new Date().toISOString());

  try {
    // Get all published posts from the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const postsRes = await ddb.send(new ScanCommand({
      TableName: POSTS_TABLE,
      FilterExpression: '#status = :status AND createdAt > :startDate',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'published',
        ':startDate': thirtyDaysAgo.toISOString()
      }
    }));

    const posts = postsRes.Items || [];
    console.log(`Found ${posts.length} published posts to sync`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const post of posts) {
      try {
        const ayrsharePostIds = post.ayrsharePostIds || {};
        let totalLikes = 0, totalComments = 0, totalShares = 0, totalViews = 0;

        for (const [clinicId, ayrsharePostId] of Object.entries(ayrsharePostIds)) {
          try {
            // Get profile key
            const profileRes = await ddb.send(new GetCommand({
              TableName: PROFILES_TABLE,
              Key: { clinicId }
            }));

            if (!profileRes.Item?.ayrshareProfileKey) continue;

            // Get analytics from Ayrshare
            const analytics = await ayrshareGetAnalytics(
              API_KEY,
              profileRes.Item.ayrshareProfileKey,
              ayrsharePostId as string
            );

            // Parse analytics for each platform
            if (analytics.analytics) {
              for (const [platform, platformData] of Object.entries(analytics.analytics)) {
                const data = platformData as any;
                totalLikes += data.likes || 0;
                totalComments += data.comments || 0;
                totalShares += data.shares || data.retweets || 0;
                totalViews += data.views || data.impressions || 0;
              }
            }

            // Store analytics snapshot
            const syncedAt = new Date().toISOString();
            await ddb.send(new PutCommand({
              TableName: ANALYTICS_TABLE,
              Item: {
                postId: post.postId,
                syncedAt,
                clinicId,
                platform: 'all',
                metrics: analytics.analytics || {},
                rawData: analytics
              }
            }));

          } catch (clinicErr) {
            console.warn(`Error syncing analytics for clinic ${clinicId}:`, clinicErr);
          }
        }

        // Update post with aggregated analytics
        await ddb.send(new UpdateCommand({
          TableName: POSTS_TABLE,
          Key: { postId: post.postId, createdAt: post.createdAt },
          UpdateExpression: 'SET analytics = :analytics',
          ExpressionAttributeValues: {
            ':analytics': {
              totalLikes,
              totalComments,
              totalShares,
              totalViews,
              lastSyncedAt: new Date().toISOString()
            }
          }
        }));

        syncedCount++;
      } catch (postErr) {
        console.error(`Error syncing post ${post.postId}:`, postErr);
        errorCount++;
      }
    }

    console.log(`Analytics sync completed: ${syncedCount} synced, ${errorCount} errors`);

  } catch (err) {
    console.error('Analytics sync failed:', err);
    throw err;
  }
};


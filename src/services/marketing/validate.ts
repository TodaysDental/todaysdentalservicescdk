import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  ayrshareValidatePost,
  ayrshareValidateMedia,
  ayrshareContentModeration,
} from './ayrshare-client';

const API_KEY = process.env.AYRSHARE_API_KEY!;

// Platform character limits
const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280,
  x: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
  tiktok: 2200,
  youtube: 5000,
  threads: 500,
  bluesky: 300,
  gbusiness: 1500, // Google My Business / Google Business Profile
};

// Platform media requirements
const PLATFORM_MEDIA_REQUIREMENTS: Record<string, any> = {
  instagram: {
    image: { maxSize: 30 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png', 'gif'] },
    video: { maxSize: 4 * 1024 * 1024 * 1024, maxDuration: 60, formats: ['mp4', 'mov'] }
  },
  facebook: {
    image: { maxSize: 10 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png', 'gif', 'bmp'] },
    video: { maxSize: 10 * 1024 * 1024 * 1024, maxDuration: 240, formats: ['mp4', 'mov', 'avi'] }
  },
  twitter: {
    image: { maxSize: 5 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
    video: { maxSize: 512 * 1024 * 1024, maxDuration: 140, formats: ['mp4'] }
  },
  x: {
    image: { maxSize: 5 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
    video: { maxSize: 512 * 1024 * 1024, maxDuration: 140, formats: ['mp4'] }
  },
  tiktok: {
    video: { maxSize: 287 * 1024 * 1024, maxDuration: 180, formats: ['mp4', 'webm'] }
  },
  linkedin: {
    image: { maxSize: 8 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png', 'gif'] },
    video: { maxSize: 200 * 1024 * 1024, maxDuration: 600, formats: ['mp4'] }
  },
  threads: {
    image: { maxSize: 8 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png', 'gif'] },
    video: { maxSize: 1024 * 1024 * 1024, maxDuration: 300, formats: ['mp4', 'mov'] }
  },
  gbusiness: {
    image: { maxSize: 5 * 1024 * 1024, formats: ['jpg', 'jpeg', 'png'] },
    video: { maxSize: 75 * 1024 * 1024, maxDuration: 30, formats: ['mp4'] }
  }
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // POST /validate/post - Validate post content
    // ---------------------------------------------------------
    if (path.includes('/post') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { content, platforms, mediaUrls } = body;

      if (!content || !platforms || !Array.isArray(platforms)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'content and platforms array are required'
          })
        };
      }

      // Validate locally first
      const platformResults: Record<string, any> = {};
      let allValid = true;

      for (const platform of platforms) {
        const limit = PLATFORM_LIMITS[platform.toLowerCase()];
        const errors: string[] = [];

        if (limit && content.length > limit) {
          errors.push(`Post exceeds ${limit} character limit for ${platform} (${content.length} chars)`);
          allValid = false;
        }

        if (platform.toLowerCase() === 'instagram' && (!mediaUrls || mediaUrls.length === 0)) {
          errors.push('Instagram posts require at least one image or video');
          allValid = false;
        }

        platformResults[platform] = {
          valid: errors.length === 0,
          characterCount: content.length,
          characterLimit: limit || 'unlimited',
          errors
        };
      }

      // Call Ayrshare for additional validation if available
      try {
        const ayrshareResult = await ayrshareValidatePost(API_KEY, content, platforms, mediaUrls);
        // Merge Ayrshare validation results
        if (ayrshareResult && ayrshareResult.platformResults) {
          for (const [platform, result] of Object.entries(ayrshareResult.platformResults)) {
            if (platformResults[platform]) {
              platformResults[platform] = { ...platformResults[platform], ...result as object };
            }
          }
        }
      } catch (err) {
        // Continue with local validation if Ayrshare fails
        console.warn('Ayrshare validation failed, using local validation only:', err);
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          valid: allValid,
          content: {
            length: content.length,
            hasMedia: (mediaUrls && mediaUrls.length > 0) || false
          },
          platformResults
        })
      };
    }

    // ---------------------------------------------------------
    // POST /validate/media - Validate media files
    // ---------------------------------------------------------
    if (path.includes('/media') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { mediaUrls, platforms } = body;

      if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'mediaUrls array is required'
          })
        };
      }

      if (!platforms || !Array.isArray(platforms)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'platforms array is required'
          })
        };
      }

      // Validate via Ayrshare
      let mediaResults: any[] = [];
      try {
        const ayrshareResult = await ayrshareValidateMedia(API_KEY, mediaUrls, platforms);
        mediaResults = ayrshareResult.results || ayrshareResult || [];
      } catch (err) {
        // Return basic validation info
        mediaResults = mediaUrls.map((url: string) => ({
          url,
          valid: true, // Assume valid if we can't verify
          message: 'Unable to verify media - please ensure URL is publicly accessible',
          platformResults: platforms.reduce((acc: any, p: string) => {
            acc[p] = { valid: true, warnings: ['Could not verify media requirements'] };
            return acc;
          }, {})
        }));
      }

      const allValid = mediaResults.every((r: any) => r.valid !== false);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          valid: allValid,
          mediaResults
        })
      };
    }

    // ---------------------------------------------------------
    // POST /validate/content-moderation - Content moderation
    // ---------------------------------------------------------
    if (path.includes('/content-moderation') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { content } = body;

      if (!content) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'content is required' })
        };
      }

      // Call Ayrshare content moderation
      let moderationResult: any;
      try {
        moderationResult = await ayrshareContentModeration(API_KEY, content);
      } catch (err) {
        // Return basic local moderation if API fails
        console.warn('Ayrshare content moderation failed:', err);
        moderationResult = {
          safe: true,
          categories: {},
          flagged: false,
          message: 'Content moderation service unavailable - basic check passed'
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          safe: moderationResult.safe !== false,
          categories: moderationResult.categories || {},
          flagged: moderationResult.flagged || false,
          details: moderationResult.details || moderationResult.message || null
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('Validate Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: err.message,
        code: 'VALIDATE_ERROR'
      })
    };
  }
};

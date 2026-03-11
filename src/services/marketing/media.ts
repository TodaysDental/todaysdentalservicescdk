import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { buildCorsHeadersAsync, getAllowedOriginsAsync } from '../../shared/utils/cors';
import { ayrshareResizeImage, ayrshareVerifyMediaUrl } from './ayrshare-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const s3 = new S3Client({});
// Separate S3 client for pre-signed URL generation.
// The default S3 client auto-injects x-amz-checksum-crc32=AAAAAA== (a zeroed placeholder)
// into pre-signed URLs when the bucket has checksum requirements. When the browser then
// PUTs a real file, S3 rejects it with 403 because the real CRC32 doesn't match zero.
// Disabling requestChecksumCalculation removes the checksum from the signed URL entirely.
const s3Presign = new S3Client({
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const MEDIA_TABLE = process.env.MARKETING_MEDIA_TABLE!;
const MEDIA_BUCKET = process.env.MEDIA_BUCKET!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

// Cache allowed hosts for SSRF protection in /media/import
let allowedHostsCache: Set<string> | null = null;
async function getAllowedHosts(): Promise<Set<string>> {
  if (allowedHostsCache) return allowedHostsCache;
  const hosts = new Set<string>();

  // 1. Add all CORS-allowed origins
  const origins = await getAllowedOriginsAsync();
  for (const origin of origins) {
    try {
      const u = new URL(origin);
      if (u.hostname) hosts.add(u.hostname);
    } catch {
      // Ignore invalid origins
    }
  }

  allowedHostsCache = hosts;
  return hosts;
}

function inferExtensionFromContentType(contentType?: string): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('image/png')) return 'png';
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return 'jpg';
  if (ct.includes('image/webp')) return 'webp';
  if (ct.includes('image/gif')) return 'gif';
  if (ct.includes('image/svg')) return 'svg';
  return 'bin';
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = await buildCorsHeadersAsync({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] }, event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // POST /media/upload - Upload media (returns presigned URL)
    // ---------------------------------------------------------
    if (path.includes('/upload') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { fileName, fileType, mimeType, tags, clinicIds, fileSize } = body;

      if (!fileName || !mimeType) {
        throw new Error('fileName and mimeType required');
      }

      const mediaId = uuidv4();
      const uploadedBy = event.requestContext.authorizer?.email || 'unknown';
      const uploadedAt = new Date().toISOString();

      // Determine file type
      const detectedFileType = mimeType.startsWith('video/') ? 'video' : 'image';
      const s3Key = `uploads/${mediaId}/${fileName}`;
      const publicUrl = `https://${MEDIA_BUCKET}.s3.us-east-1.amazonaws.com/${s3Key}`;

      // Create presigned URL for upload
      const putCommand = new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: s3Key,
        ContentType: mimeType
      });

      const presignedUrl = await getSignedUrl(s3Presign, putCommand, { expiresIn: 3600 });

      // Also generate a presigned GET URL for immediate display (7 days)
      const signedUrl = await getSignedUrl(s3Presign, new GetObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: s3Key,
      }), { expiresIn: 604800 }); // 7 days

      // Save metadata to DynamoDB
      await ddb.send(new PutCommand({
        TableName: MEDIA_TABLE,
        Item: {
          mediaId,
          fileName,
          fileType: fileType || detectedFileType,
          mimeType,
          s3Bucket: MEDIA_BUCKET,
          s3Key,
          publicUrl,
          fileSize: fileSize || 0,
          dimensions: { width: 0, height: 0 },
          uploadedBy,
          uploadedAt,
          tags: tags || [],
          usedInPosts: [],
          clinicIds: clinicIds || []
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Media upload initialized',
          media: {
            mediaId,
            fileName,
            fileType: fileType || detectedFileType,
            mimeType,
            publicUrl,
            signedUrl,      // use this to display the image — publicUrl is private
            uploadUrl: presignedUrl,
            uploadedBy,
            uploadedAt,
            tags: tags || [],
            clinicIds: clinicIds || []
          }
        })
      };
    }

    // ---------------------------------------------------------
    // POST /media/import - Import media from an external URL (server-side fetch)
    // Used for CORS-safe clinic logos (e.g., Amplify-hosted /logo.png without CORS headers)
    // ---------------------------------------------------------
    if (path.includes('/import') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { url, clinicId, purpose, fileName: requestedFileName, tags } = body as {
        url?: string;
        clinicId?: string;
        purpose?: string; // e.g. 'logo'
        fileName?: string;
        tags?: string[];
      };

      if (!url) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'url is required' }),
        };
      }

      // SSRF protection: only allow https URLs to known clinic hosts
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Invalid url' }),
        };
      }

      if (parsedUrl.protocol !== 'https:') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Only https URLs are allowed' }),
        };
      }

      const allowedHosts = await getAllowedHosts();
      if (!allowedHosts.has(parsedUrl.hostname)) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: `URL host not allowed: ${parsedUrl.hostname}`,
          }),
        };
      }

      // Fetch bytes server-side (no browser CORS limitations)
      let resp;
      try {
        resp = await axios.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxContentLength: 10 * 1024 * 1024, // 10MB
          maxBodyLength: 10 * 1024 * 1024,
          validateStatus: (s) => s >= 200 && s < 300,
        });
      } catch (fetchErr: any) {
        const upstreamStatus = fetchErr?.response?.status || 0;
        console.error('[media/import] Failed to fetch source URL:', {
          url,
          status: upstreamStatus,
          message: fetchErr?.message,
        });
        return {
          statusCode: 502,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: `Failed to fetch source URL (${upstreamStatus || 'network error'}): ${fetchErr?.message || 'Unknown error'}`,
            sourceUrl: url,
          }),
        };
      }

      const contentType = String(resp.headers?.['content-type'] || 'application/octet-stream');
      const extension = inferExtensionFromContentType(contentType);
      const buffer = Buffer.from(resp.data as any);

      const uploadedBy = event.requestContext.authorizer?.email || 'unknown';
      const uploadedAt = new Date().toISOString();

      // Deterministic key for clinic logos to avoid duplication
      const isLogo = (purpose || '').toLowerCase() === 'logo' && !!clinicId;
      const mediaId = isLogo ? `logo-${clinicId}` : uuidv4();
      const finalFileName = requestedFileName || (isLogo ? `logo.${extension}` : parsedUrl.pathname.split('/').pop() || `import.${extension}`);
      const safeClinicId = clinicId ? String(clinicId).replace(/[^a-zA-Z0-9_-]/g, '') : 'global';
      const s3Key = isLogo
        ? `clinic-logos/${safeClinicId}/${finalFileName}`
        : `imports/${mediaId}/${finalFileName}`;

      const publicUrl = `https://${MEDIA_BUCKET}.s3.us-east-1.amazonaws.com/${s3Key}`;

      // Upload directly (no presigned URL required)
      try {
        await s3.send(new PutObjectCommand({
          Bucket: MEDIA_BUCKET,
          Key: s3Key,
          Body: buffer,
          ContentType: contentType,
        }));
      } catch (s3Err: any) {
        console.error('[media/import] Failed to upload to S3:', {
          bucket: MEDIA_BUCKET,
          key: s3Key,
          message: s3Err?.message,
        });
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: `Failed to upload to S3: ${s3Err?.message || 'Unknown error'}`,
          }),
        };
      }

      // Generate a presigned GET URL for immediate display (7 days)
      let signedUrl = publicUrl;
      try {
        signedUrl = await getSignedUrl(s3Presign, new GetObjectCommand({
          Bucket: MEDIA_BUCKET,
          Key: s3Key,
        }), { expiresIn: 604800 });
      } catch {
        // fallback to publicUrl
      }

      // Save metadata to DynamoDB so it's visible in media library
      await ddb.send(new PutCommand({
        TableName: MEDIA_TABLE,
        Item: {
          mediaId,
          fileName: finalFileName,
          fileType: contentType.startsWith('video/') ? 'video' : 'image',
          mimeType: contentType,
          s3Bucket: MEDIA_BUCKET,
          s3Key,
          publicUrl,
          fileSize: buffer.length,
          dimensions: { width: 0, height: 0 },
          uploadedBy,
          uploadedAt,
          tags: tags || (isLogo ? ['clinic-logo', 'imported'] : ['imported']),
          usedInPosts: [],
          clinicIds: clinicId ? [clinicId] : [],
          sourceUrl: url,
          purpose: purpose || null,
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Media imported successfully',
          media: {
            mediaId,
            fileName: finalFileName,
            mimeType: contentType,
            publicUrl,
            signedUrl,
            s3Key,
            clinicIds: clinicId ? [clinicId] : [],
            sourceUrl: url,
            purpose: purpose || null,
          },
        }),
      };
    }

    // ---------------------------------------------------------
    // GET /media - Get media library
    // ---------------------------------------------------------
    if (path.endsWith('/media') && method === 'GET') {
      const fileType = event.queryStringParameters?.fileType;
      const tags = event.queryStringParameters?.tags;
      const clinicId = event.queryStringParameters?.clinicId;
      const limit = parseInt(event.queryStringParameters?.limit || '50');
      const nextToken = event.queryStringParameters?.nextToken;

      let scanParams: any = {
        TableName: MEDIA_TABLE,
        Limit: limit
      };

      // Build filter expressions
      const filterConditions: string[] = [];
      const expressionValues: Record<string, any> = {};

      if (fileType) {
        filterConditions.push('fileType = :fileType');
        expressionValues[':fileType'] = fileType;
      }

      if (tags) {
        const tagList = tags.split(',');
        tagList.forEach((tag, index) => {
          filterConditions.push(`contains(tags, :tag${index})`);
          expressionValues[`:tag${index}`] = tag.trim();
        });
      }

      if (clinicId) {
        filterConditions.push('contains(clinicIds, :clinicId)');
        expressionValues[':clinicId'] = clinicId;
      }

      if (filterConditions.length > 0) {
        scanParams.FilterExpression = filterConditions.join(' AND ');
        scanParams.ExpressionAttributeValues = expressionValues;
      }

      if (nextToken) {
        scanParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
      }

      const scanRes = await ddb.send(new ScanCommand(scanParams));
      const media = scanRes.Items || [];

      // Generate fresh presigned GET URLs for all items (7-day expiry)
      // The bucket has Block Public Access enabled, so direct publicUrls return 403.
      const mediaWithSignedUrls = await Promise.all(
        media.map(async (m) => {
          let signedUrl = m.publicUrl; // fallback
          if (m.s3Key) {
            try {
              signedUrl = await getSignedUrl(s3Presign, new GetObjectCommand({
                Bucket: MEDIA_BUCKET,
                Key: m.s3Key,
              }), { expiresIn: 604800 });
            } catch {
              // keep fallback
            }
          }
          return { ...m, signedUrl };
        })
      );

      let paginationToken = null;
      if (scanRes.LastEvaluatedKey) {
        paginationToken = Buffer.from(JSON.stringify(scanRes.LastEvaluatedKey)).toString('base64');
      }

      // Calculate summary
      const totalImages = media.filter(m => m.fileType === 'image').length;
      const totalVideos = media.filter(m => m.fileType === 'video').length;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          media: mediaWithSignedUrls.map((m: any) => ({
            mediaId: m.mediaId,
            fileName: m.fileName,
            fileType: m.fileType,
            publicUrl: m.publicUrl,
            signedUrl: m.signedUrl,  // use this to display images (bucket is private)
            thumbnailUrl: m.signedUrl || m.publicUrl,
            dimensions: m.dimensions,
            fileSize: m.fileSize,
            uploadedBy: m.uploadedBy,
            uploadedAt: m.uploadedAt,
            tags: m.tags,
            usedInPosts: (m.usedInPosts || []).length
          })),
          pagination: {
            limit,
            hasMore: !!paginationToken
          },
          summary: {
            totalMedia: media.length,
            totalImages,
            totalVideos
          }
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /media/:mediaId - Delete media
    // ---------------------------------------------------------
    if (event.pathParameters?.mediaId && method === 'DELETE') {
      const mediaId = event.pathParameters.mediaId;

      // Get media record
      const mediaRes = await ddb.send(new GetCommand({
        TableName: MEDIA_TABLE,
        Key: { mediaId }
      }));

      if (!mediaRes.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Media not found' })
        };
      }

      // Delete from S3
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: MEDIA_BUCKET,
          Key: mediaRes.Item.s3Key
        }));
      } catch (err) {
        console.warn('S3 delete error:', err);
        // Continue even if S3 delete fails
      }

      // Delete from DynamoDB
      await ddb.send(new DeleteCommand({
        TableName: MEDIA_TABLE,
        Key: { mediaId }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Media deleted successfully',
          mediaId
        })
      };
    }

    // ---------------------------------------------------------
    // GET /media/upload-url - Get pre-signed upload URL
    // ---------------------------------------------------------
    if (path.includes('/upload-url') && method === 'GET') {
      const fileName = event.queryStringParameters?.fileName;
      const fileType = event.queryStringParameters?.fileType;
      const clinicId = event.queryStringParameters?.clinicId;

      if (!fileName || !fileType) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'fileName and fileType are required' })
        };
      }

      const fileId = uuidv4();
      const key = `temp/uploads/${fileId}_${fileName}`;

      // Create presigned URL for upload
      const putCommand = new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: key,
        ContentType: fileType
      });

      const uploadUrl = await getSignedUrl(s3Presign, putCommand, { expiresIn: 3600 });
      const fileUrl = `https://${MEDIA_BUCKET}.s3.us-east-1.amazonaws.com/${key}`;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          uploadUrl,
          fileUrl,
          key,
          expiresIn: 3600
        })
      };
    }

    // ---------------------------------------------------------
    // POST /media/resize - Resize image via Ayrshare
    // ---------------------------------------------------------
    if (path.includes('/resize') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { imageUrl, width, height } = body;

      if (!imageUrl || !width || !height) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'imageUrl, width, and height are required'
          })
        };
      }

      try {
        const result = await ayrshareResizeImage(API_KEY, imageUrl, width, height);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            originalUrl: imageUrl,
            resizedUrl: result.resizedUrl || result.url,
            width,
            height
          })
        };
      } catch (err: any) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: err.message,
            code: 'RESIZE_ERROR'
          })
        };
      }
    }

    // ---------------------------------------------------------
    // POST /media/verify-url - Verify media URL accessibility
    // ---------------------------------------------------------
    if (path.includes('/verify-url') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { url } = body;

      if (!url) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'url is required' })
        };
      }

      try {
        const result = await ayrshareVerifyMediaUrl(API_KEY, url);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            url,
            valid: result.valid !== false,
            contentType: result.contentType,
            size: result.size,
            accessible: result.accessible !== false
          })
        };
      } catch (err: any) {
        // If verification fails, the URL might be inaccessible
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            url,
            valid: false,
            error: err.message,
            message: 'URL could not be verified - it may be inaccessible or private'
          })
        };
      }
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Media Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};


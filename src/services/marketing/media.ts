import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { ayrshareResizeImage, ayrshareVerifyMediaUrl } from './ayrshare-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const s3 = new S3Client({});
const MEDIA_TABLE = process.env.MARKETING_MEDIA_TABLE!;
const MEDIA_BUCKET = process.env.MEDIA_BUCKET!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] });

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
      const publicUrl = `https://${MEDIA_BUCKET}.s3.amazonaws.com/${s3Key}`;

      // Create presigned URL for upload
      const putCommand = new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: s3Key,
        ContentType: mimeType
      });

      const presignedUrl = await getSignedUrl(s3, putCommand, { expiresIn: 3600 });

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
          media: media.map(m => ({
            mediaId: m.mediaId,
            fileName: m.fileName,
            fileType: m.fileType,
            publicUrl: m.publicUrl,
            thumbnailUrl: m.thumbnailUrl || m.publicUrl,
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

      const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 3600 });
      const fileUrl = `https://${MEDIA_BUCKET}.s3.amazonaws.com/${key}`;

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


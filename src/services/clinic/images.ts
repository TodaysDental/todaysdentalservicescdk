import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  getAllowedClinicIds,
  hasClinicAccess,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME || 'ClinicImages';
const BUCKET_NAME = process.env.BUCKET_NAME || 'clinic-images';
const PRESIGNED_URL_EXPIRY = parseInt(process.env.PRESIGNED_URL_EXPIRY || '3600', 10); // 1 hour default

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

// Image metadata interface
interface ImageMetadata {
  imageId: string;
  clinicId: string;
  s3Key: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  description: string;
  category?: string; // e.g., 'before-after', 'office', 'team', 'procedures', 'equipment'
  tags?: string[];
  uploadedBy: string;
  uploadedAt: string;
  modifiedBy: string;
  modifiedAt: string;
  isPublic?: boolean; // Whether image is publicly accessible
}

// Allowed file content types (images + PDFs + videos)
const ALLOWED_CONTENT_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // PDFs
  'application/pdf',
  // Videos
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
  'video/ogg',
];

// Video content types for validation
const VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
  'video/ogg',
];

// Max file size - 10MB for images/PDFs, 100MB for videos
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  let path = event.path || event.resource || '';

  // Normalize path for custom domain mapping (strip leading /images if present)
  if (path.startsWith('/images/images')) {
    path = path.replace('/images/images', '/images');
  }

  // Handle OPTIONS request for CORS preflight
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: 'CORS preflight response' }),
    };
  }

  try {
    // ========================================
    // PUBLIC ENDPOINTS (No authentication required)
    // ========================================
    
    // Route: GET /images - List all images (PUBLIC)
    if ((path === '/images' || path.endsWith('/images')) && httpMethod === 'GET') {
      return await listImagesPublic(event);
    }
    
    // Route: GET /images/:imageId - Get specific image details (PUBLIC)
    if (path.match(/\/images\/[^/]+$/) && httpMethod === 'GET') {
      const imageId = event.pathParameters?.imageId || path.split('/').pop() as string;
      return await getImagePublic(event, imageId);
    }
    
    // Route: GET /images/:imageId/download - Get presigned download URL (PUBLIC)
    if (path.match(/\/images\/[^/]+\/download$/) && httpMethod === 'GET') {
      const pathParts = path.split('/');
      const imageId = pathParts[pathParts.length - 2];
      return await getDownloadUrlPublic(event, imageId);
    }

    // ========================================
    // PROTECTED ENDPOINTS (Authentication required)
    // ========================================
    
    // Get user permissions from custom authorizer
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return {
        statusCode: 401,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Unauthorized - Invalid token' }),
      };
    }
    
    // Route: POST /images - Request upload URL (returns presigned PUT URL)
    if ((path === '/images' || path.endsWith('/images')) && httpMethod === 'POST') {
      return await createUploadUrl(event, userPerms);
    }
    
    // Route: POST /images/confirm - Confirm upload completed and save metadata
    if ((path === '/images/confirm' || path.endsWith('/images/confirm')) && httpMethod === 'POST') {
      return await confirmUpload(event, userPerms);
    }

    // ========================================
    // BULK OPERATIONS (Multiple images)
    // ========================================
    
    // Route: POST /images/bulk - Request multiple upload URLs
    if ((path === '/images/bulk' || path.endsWith('/images/bulk')) && httpMethod === 'POST') {
      return await createBulkUploadUrls(event, userPerms);
    }
    
    // Route: POST /images/bulk/confirm - Confirm multiple uploads
    if ((path === '/images/bulk/confirm' || path.endsWith('/images/bulk/confirm')) && httpMethod === 'POST') {
      return await confirmBulkUpload(event, userPerms);
    }
    
    // Route: PUT /images/bulk - Update multiple images
    if ((path === '/images/bulk' || path.endsWith('/images/bulk')) && httpMethod === 'PUT') {
      return await updateBulkImages(event, userPerms);
    }
    
    // Route: DELETE /images/bulk - Delete multiple images
    if ((path === '/images/bulk' || path.endsWith('/images/bulk')) && httpMethod === 'DELETE') {
      return await deleteBulkImages(event, userPerms);
    }
    
    // Route: PUT /images/:imageId - Update image description/metadata
    if (path.match(/\/images\/[^/]+$/) && httpMethod === 'PUT') {
      const imageId = event.pathParameters?.imageId || path.split('/').pop() as string;
      return await updateImage(event, userPerms, imageId);
    }
    
    // Route: DELETE /images/:imageId - Delete image
    if (path.match(/\/images\/[^/]+$/) && httpMethod === 'DELETE') {
      const imageId = event.pathParameters?.imageId || path.split('/').pop() as string;
      return await deleteImage(event, userPerms, imageId);
    }

    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Not Found', path, method: httpMethod }),
    };
  } catch (error: any) {
    console.error('Images handler error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message ?? 'Internal Server Error' }),
    };
  }
};

/**
 * List images for authorized clinics
 */
async function listImages(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const clinicId = event.queryStringParameters?.clinicId;
  const category = event.queryStringParameters?.category;
  const limit = parseInt(event.queryStringParameters?.limit || '50', 10);

  // Get allowed clinic IDs for the user
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  // If clinicId provided, verify user has access
  if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: `You do not have access to clinic: ${clinicId}` }),
    };
  }

  let images: ImageMetadata[] = [];

  if (clinicId) {
    // Query by clinic ID (more efficient with GSI)
    const queryCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'ClinicIdIndex',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
      },
      Limit: limit,
    });
    const response = await docClient.send(queryCommand);
    images = (response.Items || []) as ImageMetadata[];
  } else if (allowedClinics.has('*')) {
    // Super admin - scan all
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      Limit: limit,
    });
    const response = await docClient.send(scanCommand);
    images = (response.Items || []) as ImageMetadata[];
  } else {
    // Fetch images for each allowed clinic
    const clinicIds = Array.from(allowedClinics);
    const results = await Promise.all(
      clinicIds.map(async (cid) => {
        const queryCommand = new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'ClinicIdIndex',
          KeyConditionExpression: 'clinicId = :clinicId',
          ExpressionAttributeValues: {
            ':clinicId': cid,
          },
        });
        const response = await docClient.send(queryCommand);
        return (response.Items || []) as ImageMetadata[];
      })
    );
    images = results.flat().slice(0, limit);
  }

  // Filter by category if provided
  if (category) {
    images = images.filter((img) => img.category === category);
  }

  // Sort by uploadedAt descending (newest first)
  images.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      images,
      count: images.length,
      clinicId: clinicId || 'all',
    }),
  };
}

/**
 * Get specific image details
 */
async function getImage(event: APIGatewayProxyEvent, userPerms: UserPermissions, imageId: string): Promise<APIGatewayProxyResult> {
  const getCommand = new GetCommand({
    TableName: TABLE_NAME,
    Key: { imageId },
  });

  const response = await docClient.send(getCommand);
  const image = response.Item as ImageMetadata | undefined;

  if (!image) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Image not found' }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, image.clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have access to this image' }),
    };
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify(image),
  };
}

/**
 * Get presigned download URL for an image
 */
async function getDownloadUrl(event: APIGatewayProxyEvent, userPerms: UserPermissions, imageId: string): Promise<APIGatewayProxyResult> {
  const getCommand = new GetCommand({
    TableName: TABLE_NAME,
    Key: { imageId },
  });

  const response = await docClient.send(getCommand);
  const image = response.Item as ImageMetadata | undefined;

  if (!image) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Image not found' }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, image.clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have access to this image' }),
    };
  }

  // Generate presigned GET URL
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: image.s3Key,
  });

  const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRY });

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      downloadUrl,
      expiresIn: PRESIGNED_URL_EXPIRY,
      fileName: image.fileName,
      contentType: image.contentType,
    }),
  };
}

/**
 * Create presigned upload URL
 */
async function createUploadUrl(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { clinicId, fileName, contentType, fileSize, description, category, tags, isPublic } = body;

  // Validate required fields
  if (!clinicId || !fileName || !contentType) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Missing required fields: clinicId, fileName, contentType',
      }),
    };
  }

  // Validate content type
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Invalid content type. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      }),
    };
  }

  // Validate file size - different limits for videos vs images
  const isVideo = VIDEO_CONTENT_TYPES.includes(contentType);
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;
  
  if (fileSize && fileSize > maxSize) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB ${isVideo ? 'for videos' : 'for images/PDFs'}`,
      }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: `You do not have access to clinic: ${clinicId}` }),
    };
  }

  // Generate unique image ID and S3 key
  const imageId = uuidv4();
  const fileExtension = fileName.split('.').pop() || 'jpg';
  const s3Key = `${clinicId}/${imageId}.${fileExtension}`;

  // Generate presigned PUT URL
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: contentType,
    Metadata: {
      'image-id': imageId,
      'clinic-id': clinicId,
      'original-filename': encodeURIComponent(fileName),
    },
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRY });

  // Return the upload URL and image ID for confirmation
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      imageId,
      uploadUrl,
      s3Key,
      expiresIn: PRESIGNED_URL_EXPIRY,
      message: 'Upload the file to the presigned URL, then call POST /images/confirm with the imageId',
    }),
  };
}

/**
 * Confirm upload completed and save metadata to DynamoDB
 */
async function confirmUpload(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { imageId, clinicId, s3Key, fileName, contentType, fileSize, description, category, tags, isPublic } = body;

  // Validate required fields
  if (!imageId || !clinicId || !s3Key || !fileName || !contentType) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Missing required fields: imageId, clinicId, s3Key, fileName, contentType',
      }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: `You do not have access to clinic: ${clinicId}` }),
    };
  }

  // Verify the file exists in S3
  try {
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });
    await s3Client.send(headCommand);
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({
          error: 'Image file not found in S3. Please upload the file first using the presigned URL.',
        }),
      };
    }
    throw error;
  }

  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  const imageMetadata: ImageMetadata = {
    imageId,
    clinicId,
    s3Key,
    fileName,
    contentType,
    fileSize: fileSize || 0,
    description: description || '',
    category: category || 'general',
    tags: tags || [],
    uploadedBy: modifiedBy,
    uploadedAt: timestamp,
    modifiedBy,
    modifiedAt: timestamp,
    isPublic: isPublic || false,
  };

  const putCommand = new PutCommand({
    TableName: TABLE_NAME,
    Item: imageMetadata,
  });

  await docClient.send(putCommand);

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Image uploaded successfully',
      image: imageMetadata,
    }),
  };
}

/**
 * Update image metadata (description, category, tags)
 */
async function updateImage(event: APIGatewayProxyEvent, userPerms: UserPermissions, imageId: string): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');

  // Get existing image
  const getCommand = new GetCommand({
    TableName: TABLE_NAME,
    Key: { imageId },
  });

  const response = await docClient.send(getCommand);
  const existingImage = response.Item as ImageMetadata | undefined;

  if (!existingImage) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Image not found' }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, existingImage.clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have access to this image' }),
    };
  }

  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  // Update only allowed fields
  const updatedImage: ImageMetadata = {
    ...existingImage,
    description: body.description !== undefined ? body.description : existingImage.description,
    category: body.category !== undefined ? body.category : existingImage.category,
    tags: body.tags !== undefined ? body.tags : existingImage.tags,
    isPublic: body.isPublic !== undefined ? body.isPublic : existingImage.isPublic,
    modifiedBy,
    modifiedAt: timestamp,
  };

  const putCommand = new PutCommand({
    TableName: TABLE_NAME,
    Item: updatedImage,
  });

  await docClient.send(putCommand);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Image updated successfully',
      image: updatedImage,
    }),
  };
}

/**
 * Delete image from S3 and DynamoDB
 */
async function deleteImage(event: APIGatewayProxyEvent, userPerms: UserPermissions, imageId: string): Promise<APIGatewayProxyResult> {
  // Get existing image
  const getCommand = new GetCommand({
    TableName: TABLE_NAME,
    Key: { imageId },
  });

  const response = await docClient.send(getCommand);
  const existingImage = response.Item as ImageMetadata | undefined;

  if (!existingImage) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Image not found' }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, existingImage.clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have access to this image' }),
    };
  }

  // Delete from S3
  try {
    const deleteS3Command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: existingImage.s3Key,
    });
    await s3Client.send(deleteS3Command);
  } catch (error: any) {
    console.error('Error deleting from S3:', error);
    // Continue with DynamoDB deletion even if S3 fails
  }

  // Delete from DynamoDB
  const deleteDbCommand = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { imageId },
  });

  await docClient.send(deleteDbCommand);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Image deleted successfully',
      imageId,
      clinicId: existingImage.clinicId,
    }),
  };
}

// ========================================
// BULK OPERATIONS (Multiple images)
// ========================================

// Max number of images in a single bulk operation
const MAX_BULK_SIZE = 20;

/**
 * Request presigned upload URLs for multiple images
 */
async function createBulkUploadUrls(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { clinicId, images } = body;

  // Validate required fields
  if (!clinicId || !images || !Array.isArray(images)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Missing required fields: clinicId, images (array)',
        example: {
          clinicId: 'dentistinnewbritain',
          images: [
            { fileName: 'image1.jpg', contentType: 'image/jpeg' },
            { fileName: 'image2.png', contentType: 'image/png' },
          ],
        },
      }),
    };
  }

  // Check bulk size limit
  if (images.length > MAX_BULK_SIZE) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Too many images. Maximum ${MAX_BULK_SIZE} images per bulk upload request.`,
      }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: `You do not have access to clinic: ${clinicId}` }),
    };
  }

  // Generate presigned URLs for each image
  const uploadResults = await Promise.all(
    images.map(async (img: any, index: number) => {
      const { fileName, contentType, fileSize } = img;

      // Validate each image
      if (!fileName || !contentType) {
        return {
          index,
          success: false,
          error: 'Missing fileName or contentType',
        };
      }

      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        return {
          index,
          success: false,
          error: `Invalid content type: ${contentType}`,
        };
      }

      if (fileSize && fileSize > MAX_FILE_SIZE) {
        return {
          index,
          success: false,
          error: `File too large: ${fileSize} bytes`,
        };
      }

      // Generate unique image ID and S3 key
      const imageId = uuidv4();
      const fileExtension = fileName.split('.').pop() || 'jpg';
      const s3Key = `${clinicId}/${imageId}.${fileExtension}`;

      // Generate presigned PUT URL
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        ContentType: contentType,
        Metadata: {
          'image-id': imageId,
          'clinic-id': clinicId,
          'original-filename': encodeURIComponent(fileName),
        },
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRY });

      return {
        index,
        success: true,
        imageId,
        fileName,
        uploadUrl,
        s3Key,
        contentType,
      };
    })
  );

  const successful = uploadResults.filter((r) => r.success);
  const failed = uploadResults.filter((r) => !r.success);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      clinicId,
      expiresIn: PRESIGNED_URL_EXPIRY,
      totalRequested: images.length,
      successCount: successful.length,
      failedCount: failed.length,
      uploads: successful,
      errors: failed,
      message: 'Upload files to the presigned URLs, then call POST /images/bulk/confirm',
    }),
  };
}

/**
 * Confirm multiple uploads and save metadata to DynamoDB
 */
async function confirmBulkUpload(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { clinicId, images } = body;

  // Validate required fields
  if (!clinicId || !images || !Array.isArray(images)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Missing required fields: clinicId, images (array)',
      }),
    };
  }

  // Check bulk size limit
  if (images.length > MAX_BULK_SIZE) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Too many images. Maximum ${MAX_BULK_SIZE} images per bulk operation.`,
      }),
    };
  }

  // Check clinic access
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: `You do not have access to clinic: ${clinicId}` }),
    };
  }

  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  // Process each image
  const results = await Promise.all(
    images.map(async (img: any, index: number) => {
      const { imageId, s3Key, fileName, contentType, fileSize, description, category, tags, isPublic } = img;

      // Validate required fields
      if (!imageId || !s3Key || !fileName || !contentType) {
        return {
          index,
          imageId,
          success: false,
          error: 'Missing required fields: imageId, s3Key, fileName, contentType',
        };
      }

      // Verify the file exists in S3
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
        });
        await s3Client.send(headCommand);
      } catch (error: any) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
          return {
            index,
            imageId,
            success: false,
            error: 'Image file not found in S3',
          };
        }
        return {
          index,
          imageId,
          success: false,
          error: error.message,
        };
      }

      // Save metadata
      const imageMetadata: ImageMetadata = {
        imageId,
        clinicId,
        s3Key,
        fileName,
        contentType,
        fileSize: fileSize || 0,
        description: description || '',
        category: category || 'general',
        tags: tags || [],
        uploadedBy: modifiedBy,
        uploadedAt: timestamp,
        modifiedBy,
        modifiedAt: timestamp,
        isPublic: isPublic || false,
      };

      try {
        const putCommand = new PutCommand({
          TableName: TABLE_NAME,
          Item: imageMetadata,
        });
        await docClient.send(putCommand);

        return {
          index,
          imageId,
          success: true,
          image: imageMetadata,
        };
      } catch (error: any) {
        return {
          index,
          imageId,
          success: false,
          error: error.message,
        };
      }
    })
  );

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Bulk upload completed',
      clinicId,
      totalProcessed: images.length,
      successCount: successful.length,
      failedCount: failed.length,
      successful: successful.map((r) => ({ imageId: r.imageId, image: r.image })),
      errors: failed.map((r) => ({ index: r.index, imageId: r.imageId, error: r.error })),
    }),
  };
}

/**
 * Update multiple images at once
 */
async function updateBulkImages(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { images } = body;

  // Validate required fields
  if (!images || !Array.isArray(images)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Missing required field: images (array)',
        example: {
          images: [
            { imageId: 'uuid-1', description: 'New description', category: 'office' },
            { imageId: 'uuid-2', tags: ['dental', 'whitening'] },
          ],
        },
      }),
    };
  }

  // Check bulk size limit
  if (images.length > MAX_BULK_SIZE) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Too many images. Maximum ${MAX_BULK_SIZE} images per bulk operation.`,
      }),
    };
  }

  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  // Get allowed clinics for permission check
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  // Process each image update
  const results = await Promise.all(
    images.map(async (img: any, index: number) => {
      const { imageId, description, category, tags, isPublic } = img;

      if (!imageId) {
        return {
          index,
          imageId: null,
          success: false,
          error: 'Missing imageId',
        };
      }

      // Get existing image
      try {
        const getCommand = new GetCommand({
          TableName: TABLE_NAME,
          Key: { imageId },
        });
        const response = await docClient.send(getCommand);
        const existingImage = response.Item as ImageMetadata | undefined;

        if (!existingImage) {
          return {
            index,
            imageId,
            success: false,
            error: 'Image not found',
          };
        }

        // Check clinic access
        if (!hasClinicAccess(allowedClinics, existingImage.clinicId)) {
          return {
            index,
            imageId,
            success: false,
            error: 'Access denied',
          };
        }

        // Update the image
        const updatedImage: ImageMetadata = {
          ...existingImage,
          description: description !== undefined ? description : existingImage.description,
          category: category !== undefined ? category : existingImage.category,
          tags: tags !== undefined ? tags : existingImage.tags,
          isPublic: isPublic !== undefined ? isPublic : existingImage.isPublic,
          modifiedBy,
          modifiedAt: timestamp,
        };

        const putCommand = new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedImage,
        });
        await docClient.send(putCommand);

        return {
          index,
          imageId,
          success: true,
          image: updatedImage,
        };
      } catch (error: any) {
        return {
          index,
          imageId,
          success: false,
          error: error.message,
        };
      }
    })
  );

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Bulk update completed',
      totalProcessed: images.length,
      successCount: successful.length,
      failedCount: failed.length,
      updated: successful.map((r) => ({ imageId: r.imageId })),
      errors: failed.map((r) => ({ index: r.index, imageId: r.imageId, error: r.error })),
    }),
  };
}

/**
 * Delete multiple images at once
 */
async function deleteBulkImages(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { imageIds } = body;

  // Validate required fields
  if (!imageIds || !Array.isArray(imageIds)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Missing required field: imageIds (array of image IDs)',
        example: {
          imageIds: ['uuid-1', 'uuid-2', 'uuid-3'],
        },
      }),
    };
  }

  // Check bulk size limit
  if (imageIds.length > MAX_BULK_SIZE) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Too many images. Maximum ${MAX_BULK_SIZE} images per bulk operation.`,
      }),
    };
  }

  // Get allowed clinics for permission check
  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  // Process each image deletion
  const results = await Promise.all(
    imageIds.map(async (imageId: string, index: number) => {
      if (!imageId) {
        return {
          index,
          imageId: null,
          success: false,
          error: 'Invalid imageId',
        };
      }

      try {
        // Get existing image
        const getCommand = new GetCommand({
          TableName: TABLE_NAME,
          Key: { imageId },
        });
        const response = await docClient.send(getCommand);
        const existingImage = response.Item as ImageMetadata | undefined;

        if (!existingImage) {
          return {
            index,
            imageId,
            success: false,
            error: 'Image not found',
          };
        }

        // Check clinic access
        if (!hasClinicAccess(allowedClinics, existingImage.clinicId)) {
          return {
            index,
            imageId,
            success: false,
            error: 'Access denied',
          };
        }

        // Delete from S3
        try {
          const deleteS3Command = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: existingImage.s3Key,
          });
          await s3Client.send(deleteS3Command);
        } catch (error: any) {
          console.error(`Error deleting ${imageId} from S3:`, error);
          // Continue with DynamoDB deletion
        }

        // Delete from DynamoDB
        const deleteDbCommand = new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { imageId },
        });
        await docClient.send(deleteDbCommand);

        return {
          index,
          imageId,
          clinicId: existingImage.clinicId,
          success: true,
        };
      } catch (error: any) {
        return {
          index,
          imageId,
          success: false,
          error: error.message,
        };
      }
    })
  );

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Bulk delete completed',
      totalProcessed: imageIds.length,
      successCount: successful.length,
      failedCount: failed.length,
      deleted: successful.map((r) => ({ imageId: r.imageId, clinicId: r.clinicId })),
      errors: failed.map((r) => ({ index: r.index, imageId: r.imageId, error: r.error })),
    }),
  };
}

// ========================================
// PUBLIC ENDPOINTS (No authentication)
// ========================================

/**
 * List images publicly - filter by clinicId (required for public access)
 */
async function listImagesPublic(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const clinicId = event.queryStringParameters?.clinicId;
  const category = event.queryStringParameters?.category;
  const limit = parseInt(event.queryStringParameters?.limit || '50', 10);

  // For public access, clinicId is required
  if (!clinicId) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'clinicId query parameter is required for public access' }),
    };
  }

  // Query by clinic ID
  const queryCommand = new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'ClinicIdIndex',
    KeyConditionExpression: 'clinicId = :clinicId',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
    },
    Limit: limit,
  });

  const response = await docClient.send(queryCommand);
  let images = (response.Items || []) as ImageMetadata[];

  // Filter by category if provided
  if (category) {
    images = images.filter((img) => img.category === category);
  }

  // Sort by uploadedAt descending (newest first)
  images.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      images,
      count: images.length,
      clinicId,
    }),
  };
}

/**
 * Get specific image details publicly
 */
async function getImagePublic(event: APIGatewayProxyEvent, imageId: string): Promise<APIGatewayProxyResult> {
  const getCommand = new GetCommand({
    TableName: TABLE_NAME,
    Key: { imageId },
  });

  const response = await docClient.send(getCommand);
  const image = response.Item as ImageMetadata | undefined;

  if (!image) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Image not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify(image),
  };
}

/**
 * Get presigned download URL publicly
 */
async function getDownloadUrlPublic(event: APIGatewayProxyEvent, imageId: string): Promise<APIGatewayProxyResult> {
  const getCommand = new GetCommand({
    TableName: TABLE_NAME,
    Key: { imageId },
  });

  const response = await docClient.send(getCommand);
  const image = response.Item as ImageMetadata | undefined;

  if (!image) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Image not found' }),
    };
  }

  // Generate presigned GET URL
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: image.s3Key,
  });

  const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRY });

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      downloadUrl,
      expiresIn: PRESIGNED_URL_EXPIRY,
      fileName: image.fileName,
      contentType: image.contentType,
    }),
  };
}


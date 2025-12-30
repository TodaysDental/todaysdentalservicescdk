import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const s3Client = new S3Client({});
const LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET!;
const LEGAL_MODULE = 'Legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get Document Event:', JSON.stringify(event, null, 2));

  try {
    // Check user permissions
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: 'Unauthorized' });
    }

    // Support multiple ways to specify the document
    const fileKey = event.queryStringParameters?.fileKey;
    const documentId = event.queryStringParameters?.documentId;
    const clinicIdParam = event.queryStringParameters?.clinicId || event.headers['x-clinic-id'];
    const leaseId = event.queryStringParameters?.leaseId;

    let resolvedFileKey: string | undefined = fileKey;

    // If documentId is provided instead of fileKey, we need to construct or lookup the key
    if (!resolvedFileKey && documentId && clinicIdParam && leaseId) {
      // Try to find the file by listing objects with the documentId prefix
      resolvedFileKey = await findFileKeyByDocumentId(clinicIdParam, leaseId, documentId) || undefined;
    }

    if (!resolvedFileKey) {
      return createResponse(400, { 
        success: false, 
        error: 'fileKey is required, or provide documentId with clinicId and leaseId' 
      });
    }

    // Extract clinicId from fileKey (format: clinicId/leaseId/documentId-filename or clinicId/temp/documentId-filename)
    const clinicId = resolvedFileKey.split('/')[0];

    // Check if user has Legal module read permission for this clinic
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: 'Permission denied. Legal module access required.' });
    }

    // Verify the file exists and get metadata
    let fileMetadata: any = {};
    try {
      const headResult = await s3Client.send(new HeadObjectCommand({
        Bucket: LEASE_DOCUMENTS_BUCKET,
        Key: resolvedFileKey
      }));
      fileMetadata = {
        contentType: headResult.ContentType,
        contentLength: headResult.ContentLength,
        lastModified: headResult.LastModified,
        metadata: headResult.Metadata
      };
    } catch (headError: any) {
      if (headError.name === 'NotFound' || headError.$metadata?.httpStatusCode === 404) {
        return createResponse(404, { success: false, error: 'Document not found' });
      }
      throw headError;
    }

    // Generate presigned URL for download (valid for 1 hour)
    const command = new GetObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: resolvedFileKey
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    // Extract document info from the key
    const keyParts = resolvedFileKey.split('/');
    const filename = keyParts[keyParts.length - 1];
    const docIdMatch = filename.match(/^(DOC-[a-zA-Z0-9]+)/);
    const extractedDocId = docIdMatch ? docIdMatch[1] : null;

    return createResponse(200, {
      success: true,
      data: {
        downloadUrl,
        fileKey: resolvedFileKey,
        documentId: extractedDocId,
        clinicId,
        leaseId: keyParts[1] !== 'temp' ? keyParts[1] : null,
        filename,
        originalFilename: fileMetadata.metadata?.['original-filename'] || filename,
        contentType: fileMetadata.contentType,
        contentLength: fileMetadata.contentLength,
        lastModified: fileMetadata.lastModified,
        expiresIn: 3600
      }
    });

  } catch (error: any) {
    console.error('Error generating download URL:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

// Find file key by documentId (searches for files starting with the documentId)
async function findFileKeyByDocumentId(clinicId: string, leaseId: string, documentId: string): Promise<string | null> {
  try {
    const prefix = `${clinicId}/${leaseId}/${documentId}`;
    const result = await s3Client.send(new ListObjectsV2Command({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Prefix: prefix,
      MaxKeys: 1
    }));

    if (result.Contents && result.Contents.length > 0) {
      return result.Contents[0].Key || null;
    }

    // Also check temp folder
    const tempPrefix = `${clinicId}/temp/${documentId}`;
    const tempResult = await s3Client.send(new ListObjectsV2Command({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Prefix: tempPrefix,
      MaxKeys: 1
    }));

    if (tempResult.Contents && tempResult.Contents.length > 0) {
      return tempResult.Contents[0].Key || null;
    }

    return null;
  } catch (error) {
    console.error('Error finding file by documentId:', error);
    return null;
  }
}

function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-clinic-id',
    },
    body: JSON.stringify(body),
  };
}
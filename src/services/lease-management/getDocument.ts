import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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

    // fileKey can come from query param or body
    const fileKey = event.queryStringParameters?.fileKey;

    if (!fileKey) {
      return createResponse(400, { success: false, error: 'fileKey is required' });
    }

    // Extract clinicId from fileKey (format: clinicId/leaseId/documentId-filename)
    const clinicId = fileKey.split('/')[0];

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

    // Generate presigned URL for download (valid for 1 hour)
    const command = new GetObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: fileKey
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return createResponse(200, {
      success: true,
      data: {
        downloadUrl,
        fileKey,
        expiresIn: 3600
      }
    });

  } catch (error: any) {
    console.error('Error generating download URL:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

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
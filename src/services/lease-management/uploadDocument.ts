import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({});
const LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Upload Document Event:', JSON.stringify(event, null, 2));

  try {
    if (!event.body) {
      return createResponse(400, { success: false, error: 'Request body is required' });
    }

    const { clinicId, leaseId, fileName, contentType, documentType, description } = JSON.parse(event.body);

    // clinicId from header or body
    const clinic = event.headers['x-clinic-id'] || clinicId;

    if (!clinic) {
      return createResponse(400, { success: false, error: 'clinicId is required' });
    }

    if (!fileName || !contentType) {
      return createResponse(400, { success: false, error: 'fileName and contentType are required' });
    }

    // Generate unique file key: clinicId/leaseId/documentId-filename
    const documentId = `DOC-${uuidv4().substring(0, 8)}`;
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = leaseId 
      ? `${clinic}/${leaseId}/${documentId}-${sanitizedFileName}`
      : `${clinic}/temp/${documentId}-${sanitizedFileName}`;

    // Generate presigned URL for upload (valid for 15 minutes)
    const command = new PutObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: fileKey,
      ContentType: contentType,
      Metadata: {
        'clinic-id': clinic,
        'lease-id': leaseId || 'pending',
        'document-type': documentType || 'Other',
        'description': description || '',
        'original-filename': fileName
      }
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    return createResponse(200, {
      success: true,
      data: {
        uploadUrl,
        fileKey,
        documentId,
        bucket: LEASE_DOCUMENTS_BUCKET,
        expiresIn: 900
      },
      message: 'Upload URL generated successfully'
    });

  } catch (error: any) {
    console.error('Error generating upload URL:', error);
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
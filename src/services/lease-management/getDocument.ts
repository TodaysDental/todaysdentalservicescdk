import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({});
const LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get Document Event:', JSON.stringify(event, null, 2));

  try {
    // fileKey can come from query param or body
    const fileKey = event.queryStringParameters?.fileKey;

    if (!fileKey) {
      return createResponse(400, { success: false, error: 'fileKey is required' });
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
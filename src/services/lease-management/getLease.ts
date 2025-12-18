import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({});

const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get Lease Event:', JSON.stringify(event, null, 2));

  try {
    const clinicId = event.pathParameters?.clinicId;
    const leaseId = event.pathParameters?.leaseId;

    if (!clinicId || !leaseId) {
      return createResponse(400, { success: false, error: 'clinicId and leaseId are required' });
    }

    const result = await docClient.send(new GetCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK: `CLINIC#${clinicId}`, SK: `LEASE#${leaseId}` }
    }));

    if (!result.Item) {
      return createResponse(404, { success: false, error: 'Lease not found' });
    }

    // Generate presigned URLs for documents
    if (result.Item.documents && Array.isArray(result.Item.documents)) {
      for (const doc of result.Item.documents) {
        if (doc.fileKey) {
          doc.downloadUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: LEASE_DOCUMENTS_BUCKET, Key: doc.fileKey }),
            { expiresIn: 3600 }
          );
        }
      }
    }

    return createResponse(200, { success: true, data: result.Item });

  } catch (error: any) {
    console.error('Error retrieving lease:', error);
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
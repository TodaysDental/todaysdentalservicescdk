import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.AWS_REGION || 'us-east-1';
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';

// Initialize S3 Client
const s3 = new S3Client({ region: REGION });

/**
 * Generates an S3 Presigned URL for GetObject and redirects the user to it (HTTP 302).
 * This function runs inside a Lambda deployed by CommStack, providing the secure link.
 * Authentication is expected to be handled by the AdminStack's API Gateway prior to invocation.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    // The S3 key is passed as a path parameter named 'key'
    const encodedFileKey = event.pathParameters?.key;

    if (!encodedFileKey) {
        console.error('Missing file key in path parameters.');
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing file key' }) };
    }
    
    // Decode the key passed in the URL path before using it as the S3 Key.
    const fileKey = decodeURIComponent(encodedFileKey);
    
    if (!FILE_BUCKET_NAME) {
        console.error('FILE_BUCKET_NAME is not configured.');
        return { statusCode: 500, body: JSON.stringify({ message: 'Server configuration error: Bucket not found' }) };
    }

    try {
        // 1. Define the GetObject command
        const command = new GetObjectCommand({
            Bucket: FILE_BUCKET_NAME,
            Key: fileKey,
        });

        // 2. Generate the presigned URL, valid for 5 minutes (300 seconds)
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); 

        // 3. Return a 302 Found redirect to the Presigned URL
        return {
            statusCode: 302,
            headers: {
                'Location': presignedUrl,
                'Access-Control-Allow-Origin': '*', 
                'Access-Control-Allow-Methods': 'GET',
            },
            body: '', 
        };

    } catch (e) {
        console.error(`Error generating signed URL for download key ${fileKey}:`, e);
        // Return 404 if the key is likely missing, otherwise 500
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to generate download URL' }) };
    }
};
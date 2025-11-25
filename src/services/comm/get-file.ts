import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.AWS_REGION || 'us-east-1';
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';

// Initialize S3 Client
const s3 = new S3Client({ region: REGION });

/**
 * Utility to guess MIME type based on file extension.
 */
function getContentType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'pdf': return 'application/pdf';
        case 'txt': return 'text/plain';
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        default: return 'application/octet-stream';
    }
}

/**
 * Generates an S3 Presigned URL for GetObject and redirects the user to it (HTTP 302).
 * This function runs after the Admin API Gateway has authenticated the user.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    
    // --- CRITICAL FIX: CORS PREFLIGHT BYPASS ---
    // The browser sends an OPTIONS request before the authenticated GET. 
    // This Lambda block handles it, returning 200 OK immediately, which is often 
    // required when the API Gateway Authorizer is enabled on the resource.
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                // Allow the Authorization header to be sent in the subsequent GET request
                'Access-Control-Allow-Headers': 'Content-Type,Authorization', 
                'Access-Control-Allow-Methods': 'GET,OPTIONS', 
            },
            body: '',
        };
    }
    // --- END CORS BYPASS ---

    // The S3 key is passed as a path parameter named 'key'
    const encodedFileKey = event.pathParameters?.key;

    if (!encodedFileKey) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing file key' }) };
    }
    
    // Decode the key passed in the URL path before using it as the S3 Key.
    const fileKey = decodeURIComponent(encodedFileKey);
    
    if (!FILE_BUCKET_NAME) {
        return { statusCode: 500, body: JSON.stringify({ message: 'Server configuration error: Bucket not found' }) };
    }

    try {
        // Try to extract original filename
        // The S3 key contains the filename (e.g., .../UUID-Happy%20couple.png)
        const filenameMatch = fileKey.match(/([^\/]+)$/);
        const filename = filenameMatch ? filenameMatch[1] : 'download';
        
        // Determine Content Type based on the filename
        const contentType = getContentType(filename);

        // 1. Define the GetObject command
        const command = new GetObjectCommand({
            Bucket: FILE_BUCKET_NAME,
            Key: fileKey,
            // CRITICAL FIX: Force download behavior and correct filename
            ResponseContentDisposition: `attachment; filename="${filename}"`, 
            // CRITICAL FIX: Ensure the browser is told the correct content type
            ResponseContentType: contentType,
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
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
            body: '', 
        };

    } catch (e) {
        console.error(`Error generating signed URL for download key ${fileKey}:`, e);
        // Return 404 if the key is correct but the object is missing/deleted
        return { statusCode: 404, body: JSON.stringify({ message: 'File not found or access denied.' }) };
    }
};
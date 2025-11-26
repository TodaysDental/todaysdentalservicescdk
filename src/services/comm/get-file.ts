import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { buildCorsHeaders } from '../../shared/utils/cors';

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
    // Get the request origin for CORS
    const requestOrigin = event.headers?.origin || event.headers?.Origin;
    
    // Build CORS headers using your utility
    const corsHeaders = buildCorsHeaders({}, requestOrigin);
    
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        console.log('[CORS] Handling OPTIONS preflight request');
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: '',
        };
    }

    // The S3 key is passed as a path parameter named 'key'
    // Note: With {key+} greedy parameter, this captures the full path including slashes
    const encodedFileKey = event.pathParameters?.key;

    if (!encodedFileKey) {
        console.error('[ERROR] Missing file key in path parameters');
        return { 
            statusCode: 400, 
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Missing file key' }) 
        };
    }
    
    // Decode the key passed in the URL path before using it as the S3 Key.
    const fileKey = decodeURIComponent(encodedFileKey);
    
    console.log('[INFO] Processing file download request', { 
        encodedFileKey, 
        fileKey,
        requestOrigin 
    });
    
    if (!FILE_BUCKET_NAME) {
        console.error('[ERROR] FILE_BUCKET_NAME environment variable not set');
        return { 
            statusCode: 500, 
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Server configuration error: Bucket not found' }) 
        };
    }

    try {
        // Try to extract original filename
        // The S3 key contains the filename (e.g., .../UUID-Happy%20couple.png)
        const filenameMatch = fileKey.match(/([^\/]+)$/);
        const filename = filenameMatch ? filenameMatch[1] : 'download';
        
        console.log('[INFO] Extracted filename:', filename);
        
        // Determine Content Type based on the filename
        const contentType = getContentType(filename);

        // 1. Define the GetObject command
        const command = new GetObjectCommand({
            Bucket: FILE_BUCKET_NAME,
            Key: fileKey,
            // Force download behavior and correct filename
            ResponseContentDisposition: `attachment; filename="${filename}"`, 
            // Ensure the browser is told the correct content type
            ResponseContentType: contentType,
        });

        // 2. Generate the presigned URL, valid for 5 minutes (300 seconds)
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); 

        console.log('[SUCCESS] Generated presigned URL for file:', fileKey);

        // 3. Return a 302 Found redirect to the Presigned URL with CORS headers
        return {
            statusCode: 302,
            headers: {
                'Location': presignedUrl,
                ...corsHeaders,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
            body: '', 
        };

    } catch (e) {
        console.error(`[ERROR] Error generating signed URL for download key ${fileKey}:`, e);
        // Return 404 if the key is correct but the object is missing/deleted
        return { 
            statusCode: 404, 
            headers: corsHeaders,
            body: JSON.stringify({ message: 'File not found or access denied.' }) 
        };
    }
};
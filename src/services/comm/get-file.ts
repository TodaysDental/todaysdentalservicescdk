import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { buildCorsHeaders } from '../../shared/utils/cors';

const REGION = process.env.AWS_REGION || 'us-east-1';
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';

// Initialize S3 Client
const s3 = new S3Client({ region: REGION });

/**
 * Redirects the user to the public S3 URL for the requested file.
 * The S3 bucket is configured with public read access, so no authentication is required.
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

        // 1. Verify the file exists by doing a HeadObject call
        try {
            await s3.send(new HeadObjectCommand({
                Bucket: FILE_BUCKET_NAME,
                Key: fileKey,
            }));
        } catch (headError: any) {
            if (headError.name === 'NotFound' || headError.$metadata?.httpStatusCode === 404) {
                console.log('[INFO] File not found:', fileKey);
                return { 
                    statusCode: 404, 
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'File not found.' }) 
                };
            }
            throw headError;
        }

        // 2. Build the direct public S3 URL
        // The bucket is now public, so we can access files directly without presigned URLs
        const publicS3Url = `https://${FILE_BUCKET_NAME}.s3.${REGION}.amazonaws.com/${encodeURIComponent(fileKey).replace(/%2F/g, '/')}`;

        console.log('[SUCCESS] Redirecting to public S3 URL for file:', fileKey);

        // 3. Return a 302 Found redirect to the public S3 URL with CORS headers
        return {
            statusCode: 302,
            headers: {
                'Location': publicS3Url,
                ...corsHeaders,
                'Cache-Control': 'public, max-age=3600', // Cache for 1 hour since it's a public URL
            },
            body: '', 
        };

    } catch (e) {
        console.error(`[ERROR] Error processing download for key ${fileKey}:`, e);
        // Return 500 for other errors
        return { 
            statusCode: 500, 
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error.' }) 
        };
    }
};
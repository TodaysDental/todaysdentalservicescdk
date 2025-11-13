// services/communications/upload-file.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from 'uuid';
import { sendPush } from './utils';

const s3Client = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables are accessed directly here but asserted below
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;
const BUCKET_NAME = process.env.FILE_BUCKET_NAME;

// ApiGatewayManagementApiClient initialization requires a string endpoint
const api = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT! });

export const handler = async (event: any) => {
  const callerConnectionId = event.requestContext.connectionId;
  const callerId = event.requestContext.authorizer?.claims?.sub;
  let body;
  try { body = JSON.parse(event.body); } catch { body = {}; }

  const { fileName, fileType } = body;

  // Type Safety Check: Ensure all critical variables are defined
  if (!callerId || !BUCKET_NAME || !CONNECTIONS_TABLE || !fileName || !fileType) {
    const message = 'Missing required file details, user ID, or configuration.';
    if (callerConnectionId && CONNECTIONS_TABLE) {
        await sendPush(callerConnectionId, { event: 'error', message }, api, CONNECTIONS_TABLE!, ddb);
    }
    return { statusCode: 400, body: message };
  }

  // 1. Generate a unique key for the file in S3 (e.g., userId/requestId/uuid.ext)
  const fileExtension = fileName.split('.').pop();
  const fileKey = `favors/${callerId}/${uuidv4()}.${fileExtension}`;

  try {
    // 2. Create the PutObject command
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME!, // Asserted
      Key: fileKey,
      ContentType: fileType,
    });

    // 3. Generate the presigned URL, valid for 7 days (604,800 seconds)
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });

    // 4. Push the presigned URL back to the client (Synchronous result)
    const responsePayload = {
      event: 'uploadUrlReady',
      fileKey,
      uploadUrl,
    };

    await sendPush(callerConnectionId, responsePayload, api, CONNECTIONS_TABLE!, ddb); // Asserted

  } catch (e) {
    console.error("Presign URL generation failed:", e);
    await sendPush(callerConnectionId, { event: 'error', message: 'Failed to generate file upload link.' }, api, CONNECTIONS_TABLE!, ddb); // Asserted
  }

  return { statusCode: 200 };
};
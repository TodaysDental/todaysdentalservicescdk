// services/communications/history.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sendPush } from './utils';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({}); // Initialize S3 Client

const MESSAGES_TABLE = process.env.FAVORS_MESSAGES_TABLE;
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;
const BUCKET_NAME = process.env.FILE_BUCKET_NAME;

const api = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT! });

export const handler = async (event: any) => {
  const callerConnectionId = event.requestContext.connectionId;
  const callerId = event.requestContext.authorizer?.claims?.sub; 
  let body;
  try { body = JSON.parse(event.body); } catch { body = {}; }

  const { requestId } = body;

  // Type Safety Check
  if (!callerId || !requestId || !MESSAGES_TABLE || !CONNECTIONS_TABLE || !BUCKET_NAME) {
    const message = 'Missing user ID, request ID, or required configuration.';
    if (callerConnectionId && CONNECTIONS_TABLE) {
        await sendPush(callerConnectionId, { event: 'error', message }, api, CONNECTIONS_TABLE!, ddb);
    }
    return { statusCode: 400, body: message };
  }

  try {
    // 1. Query all messages for the specific requestId
    const result = await ddb.send(new QueryCommand({
        TableName: MESSAGES_TABLE!,
        KeyConditionExpression: 'requestId = :rId',
        ExpressionAttributeValues: { ':rId': requestId },
        ScanIndexForward: true,
    }));
    
    const messages = result.Items || [];

    // 2. Generate temporary download URLs for any file attachments
    const messagesWithUrls = await Promise.all(messages.map(async (msg) => {
        if (msg.fileKey) {
            const downloadCommand = new GetObjectCommand({
                Bucket: BUCKET_NAME!, // Asserted
                Key: msg.fileKey,
            });
            // Generate a secure, temporary download URL (valid for 30 days)
            const downloadUrl = await getSignedUrl(s3Client, downloadCommand, { expiresIn: 2592000 });
            return { ...msg, downloadUrl };
        }
        return msg;
    }));

    // 3. Push the full message history back to the Caller (Synchronous result)
    const historyPayload = {
        event: 'historyData',
        requestId,
        messages: messagesWithUrls,
    };

    await sendPush(callerConnectionId, historyPayload, api, CONNECTIONS_TABLE!, ddb); // Asserted

  } catch (e) {
    console.error("History retrieval failed:", e);
    await sendPush(callerConnectionId, { event: 'error', message: 'Internal server error retrieving history.' }, api, CONNECTIONS_TABLE!, ddb); // Asserted
  }

  return { statusCode: 200 };
};
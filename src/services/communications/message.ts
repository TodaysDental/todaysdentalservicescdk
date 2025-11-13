// services/communications/message.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";
import { v4 as uuidv4 } from 'uuid';
import { sendPush } from './utils';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const REQUESTS_TABLE = process.env.FAVORS_REQUESTS_TABLE;
const MESSAGES_TABLE = process.env.FAVOR_MESSAGES_TABLE;
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

const api = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT! });

export const handler = async (event: any) => {
  const senderConnectionId = event.requestContext.connectionId;
  const senderId = event.requestContext.authorizer?.claims?.sub; // Authenticated sender
  let body;
  try { body = JSON.parse(event.body); } catch { body = {}; }

  const { requestId, content, fileKey, fileName, fileSize } = body; // Handles both text and file metadata

  // Type Safety Check: Ensure all critical variables are defined
  if (!senderId || !requestId || (!content && !fileKey) || !REQUESTS_TABLE || !MESSAGES_TABLE || !CONNECTIONS_TABLE) {
    const message = 'Missing required fields (content/fileKey) or table configuration.';
    if (senderConnectionId && CONNECTIONS_TABLE) {
        await sendPush(senderConnectionId, { event: 'error', message }, api, CONNECTIONS_TABLE!, ddb);
    }
    return { statusCode: 400, body: message };
  }

  try {
    // 1. Get Request Metadata to find the Receiver
    const requestItem = await ddb.send(new GetCommand({ TableName: REQUESTS_TABLE!, Key: { requestId } }));
    const favorRequest = requestItem.Item;

    if (!favorRequest) {
      await sendPush(senderConnectionId, { event: 'error', message: 'Request not found.' }, api, CONNECTIONS_TABLE!, ddb);
      return { statusCode: 200 };
    }

    // Determine the recipient (the other user in the chat)
    const receiverId = (favorRequest.senderId === senderId) ? favorRequest.receiverId : favorRequest.senderId;

    // 2. Persist the Message
    const timestamp = new Date().toISOString();
    const message = {
        requestId,
        timestamp,
        messageId: uuidv4(),
        senderId,
        content: content || null,
        // Include file metadata if available
        ...(fileKey && { fileKey, fileName, fileSize }), 
    };
    await ddb.send(new PutCommand({ TableName: MESSAGES_TABLE!, Item: message }));

    // 3. Prepare Real-Time Push payload
    const pushPayload = { event: 'newMessage', message };

    // 4. Look up Receiver Connection and Push (Real-Time Notification)
    const receiverConn = await ddb.send(new GetCommand({ TableName: CONNECTIONS_TABLE!, Key: { userId: receiverId } }));
    const receiverConnectionId = receiverConn.Item?.connectionId;

    if (receiverConnectionId) {
      await sendPush(receiverConnectionId, pushPayload, api, CONNECTIONS_TABLE!, ddb);
    }
    
    // 5. Confirmation to Sender (Synchronous result)
    await sendPush(senderConnectionId, { event: 'messageConfirmed', messageId: message.messageId }, api, CONNECTIONS_TABLE!, ddb);


  } catch (e) {
    console.error("Message processing failed:", e);
    await sendPush(senderConnectionId, { event: 'error', message: 'Internal server error during message send.' }, api, CONNECTIONS_TABLE!, ddb);
  }
  return { statusCode: 200 };
};
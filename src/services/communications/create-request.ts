// services/communications/create-request.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";
import { v4 as uuidv4 } from 'uuid';
import { sendPush } from './utils';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const REQUESTS_TABLE = process.env.FAVORS_REQUESTS_TABLE;
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;
const USER_POOL_ID = process.env.USER_POOL_ID;

const api = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT! });

export const handler = async (event: any) => {
  const senderConnectionId = event.requestContext.connectionId;
  const senderId = event.requestContext.authorizer?.claims?.sub; 
  let body;
  try { body = JSON.parse(event.body); } catch { body = {}; }

  const { receiverEmail } = body;

  // Type Safety Check
  if (!senderId || !receiverEmail || !REQUESTS_TABLE || !CONNECTIONS_TABLE || !USER_POOL_ID) {
    const message = 'Missing sender ID, receiver email, or configuration.';
    if (senderConnectionId && CONNECTIONS_TABLE) {
        await sendPush(senderConnectionId, { event: 'error', message }, api, CONNECTIONS_TABLE!, ddb);
    }
    return { statusCode: 400, body: message };
  }

  let receiverId: string | undefined;

  try {
    // 1. Look up Receiver in Cognito (Simulating Search)
    const userResp = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID!, Username: receiverEmail })); // Asserted
    if (userResp.UserStatus !== 'CONFIRMED' || !userResp.Username) throw new Error("Receiver user not active or found.");
    receiverId = userResp.Username;

    if (receiverId === senderId) throw new Error("Cannot request a favor from yourself.");

    // 2. Create New Request Record
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    await ddb.send(new PutCommand({
        TableName: REQUESTS_TABLE!, // Asserted
        Item: {
            requestId,
            senderId: senderId, // Asserted
            receiverId,
            status: 'OPEN',
            createdAt: timestamp,
            lastUpdated: timestamp,
        }
    }));

    // 3. Push confirmation back to Sender (Synchronous result)
    await sendPush(senderConnectionId, { 
        event: 'requestCreated', 
        requestId,
        receiverId,
        message: `Request created for ${receiverEmail}.` 
    }, api, CONNECTIONS_TABLE!, ddb); // Asserted

    // 4. Push notification to Receiver (Asynchronous push)
    const receiverConn = await ddb.send(new GetCommand({ TableName: CONNECTIONS_TABLE!, Key: { userId: receiverId } })); // Asserted
    const receiverConnectionId = receiverConn.Item?.connectionId;

    if (receiverConnectionId) {
        await sendPush(receiverConnectionId, {
            event: 'newFavorRequest',
            requestId,
            senderId,
            message: `You have a new favor request from ${senderId}.`
        }, api, CONNECTIONS_TABLE!, ddb); // Asserted
    }

  } catch (e: any) {
    console.error("Create request failed:", e);
    await sendPush(senderConnectionId, { event: 'error', message: e.message || 'Failed to create request.' }, api, CONNECTIONS_TABLE!, ddb); // Asserted
  }
  return { statusCode: 200 };
};
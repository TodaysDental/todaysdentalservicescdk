// services/communications/resolve-request.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";
import { sendPush } from './utils'; 

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const REQUESTS_TABLE = process.env.FAVORS_REQUESTS_TABLE;
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

const api = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT! });

export const handler = async (event: any) => {
  const callerConnectionId = event.requestContext.connectionId;
  const callerId = event.requestContext.authorizer?.claims?.sub; 
  let body;
  try { body = JSON.parse(event.body); } catch { body = {}; }

  const { requestId } = body;

  // Type Safety Check
  if (!callerId || !requestId || !REQUESTS_TABLE || !CONNECTIONS_TABLE) {
    const message = 'Missing user ID, request ID, or table configuration.';
    if (callerConnectionId && CONNECTIONS_TABLE) {
        await sendPush(callerConnectionId, { event: 'error', message }, api, CONNECTIONS_TABLE!, ddb);
    }
    return { statusCode: 400, body: message };
  }

  try {
    // 1. Fetch Request Metadata
    const requestItem = await ddb.send(new GetCommand({ TableName: REQUESTS_TABLE!, Key: { requestId } }));
    const favorRequest = requestItem.Item;

    if (!favorRequest) {
        await sendPush(callerConnectionId, { event: 'error', message: 'Request not found.' }, api, CONNECTIONS_TABLE!, ddb);
        return { statusCode: 200 };
    }
    
    // Authorization Check
    if (callerId !== favorRequest.senderId && callerId !== favorRequest.receiverId) {
        await sendPush(callerConnectionId, { event: 'error', message: 'Forbidden: You are not authorized to resolve this request.' }, api, CONNECTIONS_TABLE!, ddb);
        return { statusCode: 200 };
    }

    // 2. Update Status in FavorsRequests Table
    const timestamp = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: REQUESTS_TABLE!,
        Key: { requestId },
        UpdateExpression: 'SET #status = :resolved, lastUpdated = :timestamp',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':resolved': 'RESOLVED', ':timestamp': timestamp },
    }));

    // 3. Prepare Notification Push Payload
    const notificationPayload = { 
        event: 'requestResolved', 
        requestId,
        resolvedBy: callerId,
        status: 'RESOLVED',
        message: 'The favor request has been marked as resolved.'
    };
    
    // 4. Identify Target Users
    const targetUsers = new Set([favorRequest.senderId, favorRequest.receiverId]);
    
    // 5. Asynchronously Push to All Parties (Real-Time Notification)
    for (const userId of targetUsers) {
        const connItem = await ddb.send(new GetCommand({ TableName: CONNECTIONS_TABLE!, Key: { userId } }));
        const targetConnectionId = connItem.Item?.connectionId;

        if (targetConnectionId) {
            await sendPush(targetConnectionId, notificationPayload, api, CONNECTIONS_TABLE!, ddb);
        }
    }
    // Also push confirmation back to caller
    await sendPush(callerConnectionId, { event: 'confirmation', message: 'Request marked RESOLVED and users notified.' }, api, CONNECTIONS_TABLE!, ddb);


  } catch (e) {
    console.error("Resolve request failed:", e);
    await sendPush(callerConnectionId, { event: 'error', message: 'Internal server error during resolution.' }, api, CONNECTIONS_TABLE!, ddb);
  }

  return { statusCode: 200 };
};
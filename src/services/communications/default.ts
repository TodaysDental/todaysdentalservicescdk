// services/communications/default.ts
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { sendPush } from './utils';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;
const api = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT! });

export const handler = async (event: any) => {
  const connectionId = event.requestContext.connectionId;
  
  // Type Safety Check
  if (!CONNECTIONS_TABLE) {
    // Cannot proceed without the connections table, but we must return 200 to API GW
    console.error("CONNECTIONS_TABLE is not configured.");
    return { statusCode: 500 };
  }

  // Send an error back indicating the requested action was not recognized
  const errorMessage = {
    event: 'error',
    message: 'Action not recognized. Ensure the payload has a valid "action" field.',
    rawMessage: event.body
  };

  await sendPush(connectionId, errorMessage, api, CONNECTIONS_TABLE!, ddb);

  return { statusCode: 200, body: "Message delivered to default handler." };
};
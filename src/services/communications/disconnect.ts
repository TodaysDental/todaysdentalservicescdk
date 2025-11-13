// services/communications/disconnect.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;

export const handler = async (event: any) => {
  const connectionId = event.requestContext.connectionId;
  
  // NOTE: Cleanup relies on the next 'connect' event to overwrite stale entries.
  console.log(`Disconnection event received for ConnectionId: ${connectionId}.`);
  
  return { statusCode: 200, body: "Disconnected." };
};
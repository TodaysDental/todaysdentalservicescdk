// services/communications/connect.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.FAVORS_CONNECTIONS_TABLE;

export const handler = async (event: any) => {
  const connectionId = event.requestContext.connectionId;
  // Get the authenticated User ID from the Cognito Authorizer
  const userId = event.requestContext.authorizer?.claims?.sub || event.requestContext.authorizer?.claims['cognito:username'];

  if (!userId || !CONNECTIONS_TABLE) {
    console.error("Missing User ID or table configuration. Connection rejected.");
    return { statusCode: 401, body: "Unauthorized" };
  }
  
  try {
    // Store/Overwrite the active connection (UserId is PK)
    await ddb.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        userId: userId,
        connectionId: connectionId,
        connectedAt: new Date().toISOString(),
      },
    }));

    return { statusCode: 200, body: "Connected and ID stored." };
  } catch (e) {
    console.error("Connection failed on storage:", e);
    return { statusCode: 500, body: "Failed to establish connection." };
  }
};
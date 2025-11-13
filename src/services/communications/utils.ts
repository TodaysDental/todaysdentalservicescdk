import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Pushes data asynchronously to a specific WebSocket connection ID.
 * This function is critical for all server-to-client communication.
 * It gracefully handles 'stale' connections (GoneException).
 * * @param connectionId The WebSocket connection ID to send data to.
 * @param data The JSON object to send.
 * @param api The initialized ApiGatewayManagementApiClient.
 * @param connectionTableName The name of the DynamoDB connection table.
 * @param ddb The initialized DynamoDBDocumentClient.
 */
export async function sendPush(
    connectionId: string, 
    data: any, 
    api: ApiGatewayManagementApiClient,
    connectionTableName: string,
    ddb: DynamoDBDocumentClient,
) {
    try {
        await api.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(data),
        }));
    } catch (e) {
        if (e instanceof GoneException) {
            // This happens when the client connection is dead, but the record wasn't removed on $disconnect.
            console.warn(`Connection ${connectionId} is stale (GoneException).`);
            // We rely on the next $connect event to overwrite the stale record.
        } else {
            console.error(`Failed to push to connection ${connectionId}:`, e);
            throw e; 
        }
    }
}
/**
 * WebSocket Disconnect Handler for AI Agents
 * 
 * Cleans up connection data when client disconnects.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';

interface WebSocketDisconnectEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent['requestContext'] & {
    connectionId: string;
  };
}
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'AiAgentConnections';

export const handler = async (event: WebSocketDisconnectEvent) => {
  console.log('WebSocket Disconnect:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;

  try {
    await docClient.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
    }));

    console.log('Connection removed:', connectionId);
  } catch (error) {
    console.error('Error removing connection:', error);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Disconnected' }),
  };
};


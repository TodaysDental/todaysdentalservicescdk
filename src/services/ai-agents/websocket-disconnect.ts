/**
 * WebSocket Disconnect Handler for AI Agents
 * 
 * Cleans up connection data when client disconnects.
 * 
 * SECURITY FIX: Also expires the session bound to this connection to prevent
 * session hijacking where an attacker guesses a sessionId after the legitimate
 * user disconnects.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';

interface WebSocketDisconnectEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent['requestContext'] & {
    connectionId: string;
  };
}
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'AiAgentConnections';
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || 'AiAgentConversations';

export const handler = async (event: WebSocketDisconnectEvent) => {
  console.log('WebSocket Disconnect:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;

  try {
    // First, get the connection to find the bound sessionId
    const connectionResponse = await docClient.send(new GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
    }));
    
    const connection = connectionResponse.Item;
    const sessionId = connection?.sessionId;
    
    // FIX: Mark the session as expired to prevent hijacking
    // If someone tries to use this sessionId later, they won't be able to resume the conversation
    if (sessionId && CONVERSATIONS_TABLE) {
      try {
        // Add an expiration marker to the session's last message
        // This is a lightweight way to invalidate without deleting history
        await docClient.send(new UpdateCommand({
          TableName: CONVERSATIONS_TABLE,
          Key: { 
            sessionId, 
            timestamp: Date.now(), // New message marking session end
          },
          UpdateExpression: 'SET messageType = :type, content = :content, sessionExpiredAt = :now, expiredByConnectionId = :connId',
          ExpressionAttributeValues: {
            ':type': 'system',
            ':content': 'Session ended - connection closed',
            ':now': new Date().toISOString(),
            ':connId': connectionId,
          },
        }));
        console.log('[Disconnect] Session marked as expired:', { sessionId, connectionId });
      } catch (sessionErr) {
        console.warn('[Disconnect] Failed to mark session as expired (non-fatal):', sessionErr);
        // Non-fatal - session will still timeout eventually via TTL
      }
    }

    // Delete the connection record
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


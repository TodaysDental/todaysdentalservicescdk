import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

// Initialize AWS clients
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE!;
const WEBSOCKET_API_ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT!;

interface WebSocketConnection {
  connectionId: string;
  userId: string;
  clinicId?: string;
  connectedAt: number;
  lastSeen: number;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId!;
  const routeKey = event.requestContext.routeKey!;

  try {
    switch (routeKey) {
      case '$connect':
        return await handleConnect(connectionId, event);
      case '$disconnect':
        return await handleDisconnect(connectionId);
      case 'ping':
        return await handlePing(connectionId, event.body);
      case 'subscribe':
        return await handleSubscribe(connectionId, event.body);
      case 'unsubscribe':
        return await handleUnsubscribe(connectionId, event.body);
      default:
        console.log('Unknown route:', routeKey);
        return { statusCode: 200, body: 'OK' };
    }
  } catch (error) {
    console.error('WebSocket handler error:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

async function handleConnect(connectionId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Extract user context from query parameters or headers
    const queryParams = event.queryStringParameters || {};
    const token = queryParams.token;

    if (!token) {
      console.log('No token provided for WebSocket connection');
      return { statusCode: 401, body: 'Unauthorized' };
    }

    // Decode JWT token to get user info
    const userContext = await extractUserContextFromToken(token);
    if (!userContext) {
      console.log('Invalid token for WebSocket connection');
      return { statusCode: 401, body: 'Unauthorized' };
    }

    // Store connection
    const connection: WebSocketConnection = {
      connectionId,
      userId: userContext.userId,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    };

    await dynamodb.send(new PutCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Item: connection,
    }));

    console.log(`WebSocket connected: ${connectionId} for user ${userContext.userId}`);
    
    // Temporarily disabled welcome message to test connection stability
    // await sendToConnection(connectionId, {
    //   type: 'connected',
    //   message: 'WebSocket connected successfully',
    //   timestamp: Date.now(),
    // });

    return { statusCode: 200, body: 'Connected' };

  } catch (error) {
    console.error('WebSocket connect error:', error);
    return { statusCode: 500, body: 'Failed to connect' };
  }
}

async function handleDisconnect(connectionId: string): Promise<APIGatewayProxyResult> {
  try {
    await dynamodb.send(new DeleteCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId },
    }));

    console.log(`WebSocket disconnected: ${connectionId}`);
    return { statusCode: 200, body: 'Disconnected' };

  } catch (error) {
    console.error('WebSocket disconnect error:', error);
    return { statusCode: 500, body: 'Failed to disconnect' };
  }
}

async function handlePing(connectionId: string, body: string | null): Promise<APIGatewayProxyResult> {
  try {
    // Update last seen timestamp
    const timestamp = Date.now();

    await dynamodb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET lastSeen = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': timestamp,
      },
    }));

    // Send pong response
    await sendToConnection(connectionId, {
      type: 'pong',
      timestamp,
    });

    return { statusCode: 200, body: 'Pong' };

  } catch (error) {
    console.error('WebSocket ping error:', error);
    return { statusCode: 500, body: 'Failed to ping' };
  }
}

async function handleSubscribe(connectionId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return { statusCode: 400, body: 'Missing subscription data' };
  }

  try {
    const { clinicId, topics } = JSON.parse(body);

    // Update connection with subscription info
    const updateParams: any = {
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET lastSeen = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': Date.now(),
      },
    };

    if (clinicId) {
      updateParams.UpdateExpression += ', clinicId = :clinicId';
      updateParams.ExpressionAttributeValues[':clinicId'] = clinicId;
    }

    if (topics && Array.isArray(topics)) {
      updateParams.UpdateExpression += ', topics = :topics';
      updateParams.ExpressionAttributeValues[':topics'] = topics;
    }

    await dynamodb.send(new UpdateCommand(updateParams));

    // Send subscription confirmation
    await sendToConnection(connectionId, {
      type: 'subscribed',
      clinicId,
      topics,
      timestamp: Date.now(),
    });

    console.log(`WebSocket subscribed: ${connectionId} to clinic ${clinicId}, topics: ${topics?.join(', ')}`);
    return { statusCode: 200, body: 'Subscribed' };

  } catch (error) {
    console.error('WebSocket subscribe error:', error);
    return { statusCode: 500, body: 'Failed to subscribe' };
  }
}

async function handleUnsubscribe(connectionId: string, body: string | null): Promise<APIGatewayProxyResult> {
  try {
    // Remove subscription info from connection
    await dynamodb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'REMOVE clinicId, topics SET lastSeen = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': Date.now(),
      },
    }));

    // Send unsubscription confirmation
    await sendToConnection(connectionId, {
      type: 'unsubscribed',
      timestamp: Date.now(),
    });

    console.log(`WebSocket unsubscribed: ${connectionId}`);
    return { statusCode: 200, body: 'Unsubscribed' };

  } catch (error) {
    console.error('WebSocket unsubscribe error:', error);
    return { statusCode: 500, body: 'Failed to unsubscribe' };
  }
}

// Utility function to send message to a specific connection
export async function sendToConnection(connectionId: string, data: any): Promise<void> {
  try {
    const apiGateway = new ApiGatewayManagementApiClient({
      endpoint: WEBSOCKET_API_ENDPOINT,
    });

    await apiGateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    }));

  } catch (error: any) {
    console.error('Failed to send message to connection:', error);
    
    // If connection is stale, remove it
    if (error.statusCode === 410) {
      try {
        await dynamodb.send(new DeleteCommand({
          TableName: WEBSOCKET_CONNECTIONS_TABLE,
          Key: { connectionId },
        }));
        console.log(`Removed stale connection: ${connectionId}`);
      } catch (deleteError) {
        console.error('Failed to remove stale connection:', deleteError);
      }
    }
    throw error;
  }
}

// Utility function to broadcast message to all connections in a clinic
export async function broadcastToClinic(clinicId: string, data: any, excludeConnectionId?: string): Promise<void> {
  try {
    const response = await dynamodb.send(new ScanCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      FilterExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
      },
    }));

    const connections = response.Items || [];
    const promises = connections
      .filter(conn => conn.connectionId !== excludeConnectionId)
      .map(conn => sendToConnection(conn.connectionId, data));

    await Promise.allSettled(promises);

  } catch (error) {
    console.error('Failed to broadcast to clinic:', error);
    throw error;
  }
}

// Utility function to broadcast message to all connections
export async function broadcastToAll(data: any, excludeConnectionId?: string): Promise<void> {
  try {
    const response = await dynamodb.send(new ScanCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
    }));

    const connections = response.Items || [];
    const promises = connections
      .filter(conn => conn.connectionId !== excludeConnectionId)
      .map(conn => sendToConnection(conn.connectionId, data));

    await Promise.allSettled(promises);

  } catch (error) {
    console.error('Failed to broadcast to all:', error);
    throw error;
  }
}

async function extractUserContextFromToken(token: string): Promise<any> {
  try {
    // Decode JWT token
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    return {
      userId: payload.sub || payload.email || payload.username,
      email: payload.email || '',
      isSuperAdmin: payload['custom:x_is_super_admin'] === 'true',
      clinics: JSON.parse(payload['custom:x_clinics'] || '[]'),
    };
  } catch (error) {
    console.error('Failed to extract user context from token:', error);
    return null;
  }
}

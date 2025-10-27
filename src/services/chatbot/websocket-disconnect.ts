import { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket Disconnect event:', JSON.stringify(event, null, 2));

  try {
    const connectionId = event.requestContext.connectionId;
    const timestamp = Date.now();
    const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days TTL

    // Production optimization: Use ConnectionIndex to efficiently find the connection record
    let sessionId = `disconnect-${connectionId}-${timestamp}`;
    let clinicId = 'unknown';

    try {
      // Query by connectionId using the new ConnectionIndex GSI
      const connectionQuery = await docClient.send(new QueryCommand({
        TableName: process.env.CONVERSATIONS_TABLE!,
        IndexName: 'ConnectionIndex',
        KeyConditionExpression: 'connectionId = :connectionId',
        FilterExpression: 'messageType = :messageType',
        ExpressionAttributeValues: {
          ':connectionId': connectionId,
          ':messageType': 'connection'
        },
        ScanIndexForward: false, // Get most recent first
        Limit: 1
      }));

      if (connectionQuery.Items && connectionQuery.Items.length > 0) {
        const connectionRecord = connectionQuery.Items[0];
        sessionId = connectionRecord.sessionId;
        clinicId = connectionRecord.clinicId || 'unknown';
        
        console.log(`Found connection record for clinic: ${clinicId}, session: ${sessionId}`);
      }
    } catch (queryError) {
      console.warn('Could not find connection record, using fallback:', queryError);
    }

    // Store disconnection information
    const disconnectionRecord = {
      sessionId: `${sessionId}-disconnect`,
      timestamp,
      clinicId,
      connectionId,
      messageType: 'disconnection',
      message: 'WebSocket connection closed',
      ttl,
      metadata: {
        disconnectionTime: new Date().toISOString(),
        originalSessionId: sessionId !== `disconnect-${connectionId}-${timestamp}` ? sessionId : undefined,
        disconnectionReason: 'client_disconnect'
      }
    };

    await docClient.send(new PutCommand({
      TableName: process.env.CONVERSATIONS_TABLE!,
      Item: disconnectionRecord
    }));

    console.log(`Connection disconnected for clinic ${clinicId}, original session: ${sessionId}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...buildCorsHeaders()
      },
      body: JSON.stringify({ message: 'Disconnected successfully' }),
    };

  } catch (error) {
    console.error('WebSocket disconnect error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        ...buildCorsHeaders()
      },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};

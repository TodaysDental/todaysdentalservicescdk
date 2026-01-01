import { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
// Read clinic data from clinics.json
import { 
  getClinicConfig, 
  getAllClinicConfigs,
  ClinicConfig 
} from '../../shared/utils/secrets-helper';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('WebSocket Connect event:', JSON.stringify(event, null, 2));

  try {
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;
    
    // Origin validation for CORS (permissive for open chatbot)
    const origin = event.headers?.Origin || event.headers?.origin;
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    
    // Log origin for monitoring but don't block connections for open chatbot
    if (origin) {
      console.log(`WebSocket connection from origin: ${origin}`);
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
        console.warn(`Origin ${origin} not in allowed list, but allowing for open chatbot`);
      }
    } else {
      console.log('WebSocket connection with no origin header');
    }
    
    // Extract clinicId from query parameters
    const queryParams = event.queryStringParameters || {};
    const clinicId = queryParams.clinicId;
    
    if (!clinicId) {
      console.error('Missing clinicId parameter');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          ...buildCorsHeaders()
        },
        body: JSON.stringify({ message: 'Missing clinicId parameter' }),
      };
    }

    // Validate clinic exists in DynamoDB
    const clinicConfig = await getClinicConfig(clinicId);

    if (!clinicConfig) {
      console.error(`Invalid clinicId: ${clinicId}`);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          ...buildCorsHeaders()
        },
        body: JSON.stringify({ message: 'Invalid clinicId' }),
      };
    }

    // Generate session ID
    const sessionId = `${clinicId}-${connectionId}-${Date.now()}`;
    const timestamp = Date.now();
    const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days TTL

    // Store connection information
    const connectionRecord = {
      sessionId,
      timestamp,
      clinicId,
      connectionId,
      messageType: 'connection',
      message: 'WebSocket connection established',
      ttl,
      metadata: {
        userAgent: event.requestContext.identity?.userAgent || 'unknown',
        sourceIp: event.requestContext.identity?.sourceIp || 'unknown',
        connectionTime: new Date().toISOString(),
        clinicName: clinicConfig.clinicName,
        routeKey: routeKey || 'unknown'
      }
    };

    await docClient.send(new PutCommand({
      TableName: process.env.CONVERSATIONS_TABLE!,
      Item: connectionRecord
    }));

    console.log(`Connection established for clinic ${clinicId}, sessionId: ${sessionId}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...buildCorsHeaders()
      },
      body: JSON.stringify({ 
        message: 'Connected successfully',
        sessionId,
        clinicId,
        clinicName: clinicConfig.clinicName
      }),
    };

  } catch (error) {
    console.error('WebSocket connect error:', error);
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

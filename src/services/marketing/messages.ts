import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { ayrshareGetMessages, ayrshareSendMessage } from './ayrshare-client';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // ---------------------------------------------------------
    // GET /messages - Get direct messages
    // ---------------------------------------------------------
    if (path.endsWith('/messages') && method === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      const platform = event.queryStringParameters?.platform || 'instagram';
      const limit = parseInt(event.queryStringParameters?.limit || '20');

      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId is required' })
        };
      }

      // Get clinic profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      // Get messages from Ayrshare
      const result = await ayrshareGetMessages(
        API_KEY,
        profileRes.Item.ayrshareProfileKey,
        platform,
        limit
      );

      const messages = (Array.isArray(result) ? result : result.messages || []).map((msg: any) => ({
        id: msg.id,
        platform: msg.platform || platform,
        from: msg.from || msg.sender,
        text: msg.text || msg.message,
        timestamp: msg.timestamp || msg.createdAt,
        read: msg.read || false
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          platform,
          messages,
          total: messages.length
        })
      };
    }

    // ---------------------------------------------------------
    // POST /messages/send - Send a direct message
    // ---------------------------------------------------------
    if (path.includes('/send') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinicId, platform, recipientId, message } = body;

      if (!clinicId || !platform || !recipientId || !message) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'clinicId, platform, recipientId, and message are required' 
          })
        };
      }

      // Get clinic profile
      const profileRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!profileRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      // Send message via Ayrshare
      const result = await ayrshareSendMessage(
        API_KEY,
        profileRes.Item.ayrshareProfileKey,
        platform,
        recipientId,
        message
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          platform,
          recipientId,
          message: 'Message sent successfully',
          messageId: result.id || result.messageId,
          sentAt: new Date().toISOString()
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('Messages Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: err.message,
        code: 'MESSAGES_ERROR'
      })
    };
  }
};

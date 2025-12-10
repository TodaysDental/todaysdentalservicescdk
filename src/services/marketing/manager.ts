import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ayrshareCreateProfile, ayrshareGenerateJWT, ayrshareDeleteProfile, ayrshareGetProfile } from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.MARKETING_CONFIG_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;
const FRONTEND_DOMAIN = 'todaysdentalinsights.com';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // ---------------------------------------------------------
    // 1. SETUP (POST): Create Profile
    // ---------------------------------------------------------
    if (event.path.endsWith('/setup') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinicId, clinicName } = body;

      if (!clinicId || !clinicName) throw new Error('clinicId and clinicName required');

      // Check if exists
      const existing = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId: String(clinicId) }
      }));

      if (existing.Item?.ayrshareProfileKey) {
        return { 
          statusCode: 200, 
          headers: corsHeaders, 
          body: JSON.stringify({ 
            success: true, 
            profileKey: existing.Item.ayrshareProfileKey, 
            message: 'Profile already exists',
            setupComplete: true
          }) 
        };
      }

      // Create in Ayrshare
      const ayrResponse = await ayrshareCreateProfile(API_KEY, clinicName);
      
      // Save to DynamoDB
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          clinicId: String(clinicId),
          ayrshareProfileKey: ayrResponse.profileKey,
          clinicName: clinicName,
          createdAt: new Date().toISOString(),
          setupComplete: false // Will be true after linking accounts
        }
      }));

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, profileKey: ayrResponse.profileKey }) };
    }

    // ---------------------------------------------------------
    // 2. DISCONNECT (DELETE): Delete Profile
    // ---------------------------------------------------------
    if (event.path.endsWith('/setup') && event.httpMethod === 'DELETE') {
      const clinicId = event.queryStringParameters?.clinicId;
      if (!clinicId) throw new Error('clinicId required');

      // Get Profile Key first
      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (dbRes.Item?.ayrshareProfileKey) {
        // Delete from Ayrshare
        await ayrshareDeleteProfile(API_KEY, dbRes.Item.ayrshareProfileKey);
        
        // Delete from DynamoDB
        await ddb.send(new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { clinicId }
        }));
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, message: 'Profile deleted/disconnected' }) };
    }

    // ---------------------------------------------------------
    // 3. GET JWT (GET): For Frontend Widget
    // ---------------------------------------------------------
    if (event.path.endsWith('/jwt') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      if (!clinicId) throw new Error('clinicId required');

      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Clinic not set up' }) };
      }

      const jwtRes = await ayrshareGenerateJWT(API_KEY, dbRes.Item.ayrshareProfileKey, FRONTEND_DOMAIN);
      
      return { 
        statusCode: 200, 
        headers: corsHeaders, 
        body: JSON.stringify({
          ...jwtRes,
          userProfileKey: dbRes.Item.ayrshareProfileKey // Include profile key for widget
        }) 
      };
    }

    // ---------------------------------------------------------
    // 4. GET STATUS (GET): Check clinic setup & linked accounts
    // ---------------------------------------------------------
    if (event.path.endsWith('/status') && event.httpMethod === 'GET') {
      const clinicId = event.queryStringParameters?.clinicId;
      if (!clinicId) throw new Error('clinicId required');

      const dbRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return { 
          statusCode: 200, 
          headers: corsHeaders, 
          body: JSON.stringify({ 
            setupComplete: false,
            linkedAccounts: []
          }) 
        };
      }

      // Get profile info from Ayrshare
      const profileInfo = await ayrshareGetProfile(API_KEY, dbRes.Item.ayrshareProfileKey);
      
      return { 
        statusCode: 200, 
        headers: corsHeaders, 
        body: JSON.stringify({
          setupComplete: true,
          profileKey: dbRes.Item.ayrshareProfileKey,
          linkedAccounts: profileInfo.activeSocialAccounts || [],
          createdAt: dbRes.Item.createdAt
        }) 
      };
    }

    // ---------------------------------------------------------
    // 5. LIST ALL CLINICS (GET): Get all configured clinics
    // ---------------------------------------------------------
    if (event.path.endsWith('/clinics') && event.httpMethod === 'GET') {
      const scanRes = await ddb.send(new ScanCommand({
        TableName: TABLE_NAME
      }));

      const clinics = (scanRes.Items || []).map(item => ({
        clinicId: item.clinicId,
        clinicName: item.clinicName,
        setupComplete: item.setupComplete || false,
        createdAt: item.createdAt
      }));

      return { 
        statusCode: 200, 
        headers: corsHeaders, 
        body: JSON.stringify({ clinics }) 
      };
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Manager Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
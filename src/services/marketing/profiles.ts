import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ayrshareCreateProfile, ayrshareGenerateJWT, ayrshareDeleteProfile, ayrshareGetProfile } from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;
const AYRSHARE_DOMAIN = process.env.AYRSHARE_DOMAIN || 'todaysdentalinsights';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const pathParts = path.split('/').filter(Boolean);

    // ---------------------------------------------------------
    // POST /profiles/initialize - Create Ayrshare profiles for all clinics
    // ---------------------------------------------------------
    if (path.endsWith('/initialize') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinics } = body;

      if (!clinics || !Array.isArray(clinics)) {
        throw new Error('clinics array required');
      }

      const results: any[] = [];
      const failed: any[] = [];

      for (const clinic of clinics) {
        try {
          const { clinicId, clinicName, clinicEmail, address, city, state, phone, website, logoUrl } = clinic;

          // Check if exists
          const existing = await ddb.send(new GetCommand({
            TableName: PROFILES_TABLE,
            Key: { clinicId: String(clinicId) }
          }));

          if (existing.Item?.ayrshareProfileKey) {
            results.push({
              clinicId,
              clinicName,
              ayrshareProfileKey: existing.Item.ayrshareProfileKey,
              ayrshareRefId: existing.Item.ayrshareRefId,
              status: 'active',
              message: 'Profile already exists'
            });
            continue;
          }

          // Create in Ayrshare
          const ayrResponse = await ayrshareCreateProfile(API_KEY, clinicName);

          // Save to DynamoDB
          await ddb.send(new PutCommand({
            TableName: PROFILES_TABLE,
            Item: {
              clinicId: String(clinicId),
              clinicName,
              ayrshareProfileKey: ayrResponse.profileKey,
              ayrshareRefId: ayrResponse.refId,
              connectedPlatforms: [],
              profileStatus: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              createdBy: event.requestContext.authorizer?.email || 'system',
              clinicMetadata: {
                address,
                city,
                state,
                phone,
                email: clinicEmail,
                website,
                logoUrl
              }
            }
          }));

          // Generate JWT URL
          const jwtRes = await ayrshareGenerateJWT(API_KEY, ayrResponse.profileKey, AYRSHARE_DOMAIN);

          results.push({
            clinicId,
            clinicName,
            ayrshareProfileKey: ayrResponse.profileKey,
            ayrshareRefId: ayrResponse.refId,
            status: 'active',
            jwtUrl: jwtRes.url
          });
        } catch (err: any) {
          failed.push({
            clinicId: clinic.clinicId,
            error: err.message
          });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Created ${results.length} Ayrshare profiles`,
          profiles: results,
          failed
        })
      };
    }

    // ---------------------------------------------------------
    // GET /profiles - Get all clinic profiles
    // ---------------------------------------------------------
    if (path.endsWith('/profiles') && method === 'GET') {
      const status = event.queryStringParameters?.status;
      const platform = event.queryStringParameters?.platform;

      const scanRes = await ddb.send(new ScanCommand({
        TableName: PROFILES_TABLE
      }));

      let profiles = scanRes.Items || [];

      // Filter by status if provided
      if (status) {
        profiles = profiles.filter(p => p.profileStatus === status);
      }

      // Filter by platform if provided
      if (platform) {
        profiles = profiles.filter(p =>
          p.connectedPlatforms?.includes(platform)
        );
      }

      const formattedProfiles = profiles.map(p => ({
        clinicId: p.clinicId,
        clinicName: p.clinicName,
        ayrshareRefId: p.ayrshareRefId,
        status: p.profileStatus,
        connectedPlatforms: p.connectedPlatforms || [],
        clinicMetadata: p.clinicMetadata,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          profiles: formattedProfiles,
          totalProfiles: profiles.length,
          activeProfiles: profiles.filter(p => p.profileStatus === 'active').length,
          pendingProfiles: profiles.filter(p => p.profileStatus === 'pending').length
        })
      };
    }

    // ---------------------------------------------------------
    // GET /profiles/:clinicId - Get single clinic profile
    // ---------------------------------------------------------
    if (pathParts.includes('profiles') && pathParts.length >= 2 && !path.includes('generate-jwt') && !path.includes('social') && method === 'GET') {
      const clinicId = event.pathParameters?.clinicId;
      if (!clinicId) throw new Error('clinicId required');

      const dbRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!dbRes.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Profile not found' })
        };
      }

      // Get profile info from Ayrshare
      let platformDetails = {};
      try {
        const profileInfo = await ayrshareGetProfile(API_KEY, dbRes.Item.ayrshareProfileKey);
        platformDetails = profileInfo.activeSocialAccounts || [];
      } catch (err) {
        console.warn('Could not fetch Ayrshare profile details:', err);
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          profile: {
            clinicId: dbRes.Item.clinicId,
            clinicName: dbRes.Item.clinicName,
            ayrshareRefId: dbRes.Item.ayrshareRefId,
            status: dbRes.Item.profileStatus,
            connectedPlatforms: dbRes.Item.connectedPlatforms || [],
            platformDetails,
            clinicMetadata: dbRes.Item.clinicMetadata,
            recentActivity: dbRes.Item.recentActivity || {},
            createdAt: dbRes.Item.createdAt,
            updatedAt: dbRes.Item.updatedAt
          }
        })
      };
    }

    // ---------------------------------------------------------
    // POST /profiles/:clinicId/generate-jwt - Generate JWT for social account linking
    // ---------------------------------------------------------
    if (path.includes('/generate-jwt') && method === 'POST') {
      const clinicId = event.pathParameters?.clinicId;
      console.log('Generate JWT request for clinicId:', clinicId);
      
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'clinicId is required in the path' 
          })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const expiresIn = body.expiresIn || 300;

      const dbRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      console.log('DB lookup result:', dbRes.Item ? 'Found profile' : 'No profile found');

      if (!dbRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'Clinic profile not found. Please initialize the profile first.',
            clinicId,
            hint: 'Call POST /profiles/initialize with this clinic first to create an Ayrshare profile.'
          })
        };
      }

      try {
        console.log('Generating JWT for profile:', dbRes.Item.ayrshareProfileKey, 'domain:', AYRSHARE_DOMAIN);
        const jwtRes = await ayrshareGenerateJWT(API_KEY, dbRes.Item.ayrshareProfileKey, AYRSHARE_DOMAIN);
        console.log('JWT generated successfully, URL:', jwtRes.url ? 'Present' : 'Missing');

        if (!jwtRes.url) {
          console.error('Ayrshare returned response without URL:', JSON.stringify(jwtRes));
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
              success: false,
              error: 'Ayrshare did not return a JWT URL. Please try again.',
              details: 'The social media service returned an incomplete response.'
            })
          };
        }

        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            clinicId,
            clinicName: dbRes.Item.clinicName,
            jwtUrl: jwtRes.url,
            expiresAt,
            instructions: 'Open this URL in a new window to connect social media accounts. The link expires in 5 minutes.'
          })
        };
      } catch (jwtError: any) {
        console.error('JWT generation failed:', jwtError.message);
        return {
          statusCode: 502,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Failed to generate social media connection link.',
            details: jwtError.message,
            hint: 'The Ayrshare service may be temporarily unavailable. Please try again.'
          })
        };
      }
    }

    // ---------------------------------------------------------
    // DELETE /profiles/:clinicId/social/:platform - Unlink social network
    // ---------------------------------------------------------
    if (path.includes('/social/') && method === 'DELETE') {
      const clinicId = event.pathParameters?.clinicId;
      const platform = event.pathParameters?.platform;

      if (!clinicId || !platform) {
        throw new Error('clinicId and platform required');
      }

      const dbRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      if (!dbRes.Item?.ayrshareProfileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Clinic profile not found' })
        };
      }

      // Note: Ayrshare API call to unlink would go here
      // For now, just update local database
      const currentPlatforms = dbRes.Item.connectedPlatforms || [];
      const remainingPlatforms = currentPlatforms.filter((p: string) => p !== platform);

      await ddb.send(new UpdateCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId },
        UpdateExpression: 'SET connectedPlatforms = :platforms, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':platforms': remainingPlatforms,
          ':updatedAt': new Date().toISOString()
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Successfully unlinked ${platform} from ${dbRes.Item.clinicName}`,
          clinicId,
          platform,
          remainingPlatforms
        })
      };
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (err: any) {
    console.error('Profiles Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};


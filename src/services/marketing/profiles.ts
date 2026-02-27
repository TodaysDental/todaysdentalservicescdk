import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ayrshareCreateProfile, ayrshareGenerateJWT, ayrshareDeleteProfile, ayrshareGetProfile } from './ayrshare-client';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
  getClinicConfig as getClinicConfigFromDynamo,
  getClinicSecrets,
  getAllClinicConfigs,
  getAllClinicSecrets,
  getAyrshareApiKey,
  getAyrsharePrivateKey,
  getAyrshareDomain,
  ClinicConfig,
  ClinicSecrets
} from '../../shared/utils/secrets-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;

// ============================================
// Ayrshare credentials (cached from GlobalSecrets)
// ============================================
let cachedApiKey: string | null = null;
let cachedPrivateKey: string | null = null;
let cachedDomain: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const apiKey = await getAyrshareApiKey();
  if (!apiKey) throw new Error('Ayrshare API key not found in GlobalSecrets');
  cachedApiKey = apiKey;
  return apiKey;
}

async function getPrivateKey(): Promise<string> {
  if (cachedPrivateKey) return cachedPrivateKey;
  const privateKey = await getAyrsharePrivateKey();
  if (!privateKey) throw new Error('Ayrshare private key not found in GlobalSecrets');
  cachedPrivateKey = privateKey;
  return privateKey;
}

async function getDomain(): Promise<string> {
  if (cachedDomain) return cachedDomain;
  const domain = await getAyrshareDomain();
  cachedDomain = domain || 'id-lJiXe';
  return cachedDomain;
}

// Helper to get clinic config from DynamoDB
async function getClinicConfigWithSecrets(clinicId: string): Promise<{ config: ClinicConfig | null, secrets: ClinicSecrets | null }> {
  const [config, secrets] = await Promise.all([
    getClinicConfigFromDynamo(clinicId),
    getClinicSecrets(clinicId),
  ]);
  return { config, secrets };
}

// Helper to get all enabled Ayrshare clinics
async function getEnabledAyrshareClinics(): Promise<Array<{ config: ClinicConfig, secrets: ClinicSecrets }>> {
  const [configs, allSecrets] = await Promise.all([
    getAllClinicConfigs(),
    getAllClinicSecrets(),
  ]);

  const secretsMap = new Map(allSecrets.map(s => [s.clinicId, s]));

  return configs
    .filter(c => c.ayrshare?.enabled)
    .map(config => ({
      config,
      secrets: secretsMap.get(config.clinicId)!,
    }))
    .filter(item => item.secrets?.ayrshareProfileKey);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = await buildCorsHeadersAsync({ allowMethods: ['OPTIONS', 'POST', 'GET', 'DELETE'] }, event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const pathParts = path.split('/').filter(Boolean);

    // ---------------------------------------------------------
    // POST /profiles/sync - Sync profiles from clinics.json to DynamoDB
    // Uses existing Ayrshare profiles from clinics.json (does NOT create new ones)
    // ---------------------------------------------------------
    if (path.endsWith('/sync') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { clinicIds } = body; // Optional: specific clinic IDs to sync

      const allEnabledClinics = await getEnabledAyrshareClinics();
      const clinicsToSync = clinicIds && Array.isArray(clinicIds) && clinicIds.length > 0
        ? allEnabledClinics.filter(c => clinicIds.includes(c.config.clinicId))
        : allEnabledClinics;

      const results: any[] = [];
      const failed: any[] = [];

      for (const clinic of clinicsToSync) {
        const { config, secrets } = clinic;
        try {
          if (!secrets?.ayrshareProfileKey) {
            failed.push({
              clinicId: config.clinicId,
              error: 'No Ayrshare profile configured'
            });
            continue;
          }

          // Check if already synced in DynamoDB
          const existing = await ddb.send(new GetCommand({
            TableName: PROFILES_TABLE,
            Key: { clinicId: config.clinicId }
          }));

          const now = new Date().toISOString();
          const profileData = {
            clinicId: config.clinicId,
            clinicName: config.clinicName,
            ayrshareProfileKey: secrets.ayrshareProfileKey,
            ayrshareRefId: secrets.ayrshareRefId,
            connectedPlatforms: config.ayrshare?.connectedPlatforms || [],
            profileStatus: config.ayrshare?.enabled ? 'active' : 'inactive',
            createdAt: existing.Item?.createdAt || now,
            updatedAt: now,
            createdBy: existing.Item?.createdBy || 'config',
            syncedFromConfig: true,
            clinicMetadata: {
              address: config.clinicAddress,
              city: config.clinicCity,
              state: config.clinicState,
              phone: config.clinicPhone,
              email: config.clinicEmail,
              website: config.websiteLink,
              logoUrl: config.logoUrl,
              mapsUrl: config.mapsUrl,
              scheduleUrl: config.scheduleUrl
            },
            facebook: config.ayrshare?.facebook
          };

          // Upsert to DynamoDB
          await ddb.send(new PutCommand({
            TableName: PROFILES_TABLE,
            Item: profileData
          }));

          results.push({
            clinicId: config.clinicId,
            clinicName: config.clinicName,
            ayrshareProfileKey: secrets.ayrshareProfileKey,
            ayrshareRefId: secrets.ayrshareRefId,
            status: config.ayrshare?.enabled ? 'active' : 'inactive',
            connectedPlatforms: config.ayrshare?.connectedPlatforms || [],
            message: existing.Item ? 'Profile updated from config' : 'Profile synced from config'
          });
        } catch (err: any) {
          failed.push({
            clinicId: config.clinicId,
            error: err.message
          });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Synced ${results.length} profiles from config`,
          profiles: results,
          failed,
          totalClinicsInConfig: allEnabledClinics.length
        })
      };
    }

    // ---------------------------------------------------------
    // POST /profiles/initialize - DEPRECATED: Use /profiles/sync instead
    // Kept for backwards compatibility but now just calls sync
    // ---------------------------------------------------------
    if (path.endsWith('/initialize') && method === 'POST') {
      // Redirect to sync - no longer creates new Ayrshare profiles
      const clinicsToSync = await getEnabledAyrshareClinics();
      const results: any[] = [];
      const failed: any[] = [];

      for (const clinic of clinicsToSync) {
        const { config, secrets } = clinic;
        try {
          if (!secrets?.ayrshareProfileKey) {
            failed.push({
              clinicId: config.clinicId,
              error: 'No Ayrshare profile configured'
            });
            continue;
          }

          const existing = await ddb.send(new GetCommand({
            TableName: PROFILES_TABLE,
            Key: { clinicId: config.clinicId }
          }));

          if (existing.Item?.ayrshareProfileKey) {
            results.push({
              clinicId: config.clinicId,
              clinicName: config.clinicName,
              ayrshareProfileKey: existing.Item.ayrshareProfileKey,
              ayrshareRefId: existing.Item.ayrshareRefId,
              status: 'active',
              message: 'Profile already exists'
            });
            continue;
          }

          const now = new Date().toISOString();
          await ddb.send(new PutCommand({
            TableName: PROFILES_TABLE,
            Item: {
              clinicId: config.clinicId,
              clinicName: config.clinicName,
              ayrshareProfileKey: secrets.ayrshareProfileKey,
              ayrshareRefId: secrets.ayrshareRefId,
              connectedPlatforms: config.ayrshare?.connectedPlatforms || [],
              profileStatus: 'active',
              createdAt: now,
              updatedAt: now,
              createdBy: event.requestContext.authorizer?.email || 'system',
              syncedFromConfig: true,
              clinicMetadata: {
                address: config.clinicAddress,
                city: config.clinicCity,
                state: config.clinicState,
                phone: config.clinicPhone,
                email: config.clinicEmail,
                website: config.websiteLink,
                logoUrl: config.logoUrl
              }
            }
          }));

          results.push({
            clinicId: config.clinicId,
            clinicName: config.clinicName,
            ayrshareProfileKey: secrets.ayrshareProfileKey,
            ayrshareRefId: secrets.ayrshareRefId,
            status: 'active',
            message: 'Synced from config (no new Ayrshare profile created)'
          });
        } catch (err: any) {
          failed.push({
            clinicId: config.clinicId,
            error: err.message
          });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Synced ${results.length} profiles from clinics.json (initialize is deprecated, use /sync)`,
          profiles: results,
          failed,
          deprecated: true,
          useInstead: '/profiles/sync'
        })
      };
    }

    // ---------------------------------------------------------
    // GET /profiles - Get all clinic profiles (from DynamoDB + clinics.json)
    // ---------------------------------------------------------
    if (path.endsWith('/profiles') && method === 'GET') {
      const status = event.queryStringParameters?.status;
      const platform = event.queryStringParameters?.platform;
      const includeConfigOnly = event.queryStringParameters?.includeConfigOnly !== 'false';

      // Get profiles from DynamoDB
      const scanRes = await ddb.send(new ScanCommand({
        TableName: PROFILES_TABLE
      }));

      const dbProfiles = scanRes.Items || [];
      const dbClinicIds = new Set(dbProfiles.map(p => p.clinicId));

      // Merge with config profiles that aren't in DynamoDB
      let allProfiles = [...dbProfiles];

      if (includeConfigOnly) {
        const configClinics = await getEnabledAyrshareClinics();
        for (const clinic of configClinics) {
          const { config, secrets } = clinic;
          if (!dbClinicIds.has(config.clinicId) && secrets?.ayrshareProfileKey) {
            allProfiles.push({
              clinicId: config.clinicId,
              clinicName: config.clinicName,
              ayrshareProfileKey: secrets.ayrshareProfileKey,
              ayrshareRefId: secrets.ayrshareRefId,
              connectedPlatforms: config.ayrshare?.connectedPlatforms || [],
              profileStatus: config.ayrshare?.enabled ? 'active' : 'inactive',
              syncedFromConfig: false,
              configOnly: true,
              clinicMetadata: {
                address: config.clinicAddress,
                city: config.clinicCity,
                state: config.clinicState,
                phone: config.clinicPhone,
                email: config.clinicEmail,
                website: config.websiteLink,
                logoUrl: config.logoUrl
              }
            });
          }
        }
      }

      // Filter by status if provided
      if (status) {
        allProfiles = allProfiles.filter(p => p.profileStatus === status);
      }

      // Filter by platform if provided
      if (platform) {
        allProfiles = allProfiles.filter(p =>
          p.connectedPlatforms?.includes(platform)
        );
      }

      const formattedProfiles = allProfiles.map(p => ({
        clinicId: p.clinicId,
        clinicName: p.clinicName,
        ayrshareRefId: p.ayrshareRefId,
        ayrshareProfileKey: p.ayrshareProfileKey,
        status: p.profileStatus,
        connectedPlatforms: p.connectedPlatforms || [],
        clinicMetadata: p.clinicMetadata,
        syncedFromConfig: p.syncedFromConfig,
        configOnly: p.configOnly || false,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          profiles: formattedProfiles,
          totalProfiles: allProfiles.length,
          activeProfiles: allProfiles.filter(p => p.profileStatus === 'active').length,
          pendingProfiles: allProfiles.filter(p => p.profileStatus === 'pending' || p.profileStatus === 'inactive').length,
          configOnlyProfiles: allProfiles.filter(p => p.configOnly).length,
          syncedProfiles: allProfiles.filter(p => p.syncedFromConfig).length
        })
      };
    }

    // ---------------------------------------------------------
    // GET /profiles/:clinicId - Get single clinic profile (from DynamoDB or clinics.json)
    // ---------------------------------------------------------
    if (pathParts.includes('profiles') && pathParts.length >= 2 && !path.includes('generate-jwt') && !path.includes('social') && method === 'GET') {
      const clinicId = event.pathParameters?.clinicId;
      if (!clinicId) throw new Error('clinicId required');

      const dbRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      let profileData = dbRes.Item;
      let configOnly = false;

      // If not in DynamoDB, check config from DynamoDB
      if (!profileData) {
        const [clinicConfig, clinicSecrets] = await Promise.all([
          getClinicConfigFromDynamo(clinicId),
          getClinicSecrets(clinicId)
        ]);
        if (clinicSecrets?.ayrshareProfileKey) {
          profileData = {
            clinicId: clinicConfig?.clinicId || clinicId,
            clinicName: clinicConfig?.clinicName || clinicId,
            ayrshareProfileKey: clinicSecrets.ayrshareProfileKey,
            ayrshareRefId: clinicSecrets.ayrshareRefId,
            connectedPlatforms: clinicConfig?.ayrshare?.connectedPlatforms || [],
            profileStatus: clinicConfig?.ayrshare?.enabled ? 'active' : 'inactive',
            clinicMetadata: {
              address: clinicConfig?.clinicAddress,
              city: clinicConfig?.clinicCity,
              state: clinicConfig?.clinicState,
              phone: clinicConfig?.clinicPhone,
              email: clinicConfig?.clinicEmail,
              website: clinicConfig?.websiteLink,
              logoUrl: clinicConfig?.logoUrl,
              mapsUrl: clinicConfig?.mapsUrl,
              scheduleUrl: clinicConfig?.scheduleUrl
            },
            facebook: clinicConfig?.ayrshare?.facebook
          };
          configOnly = true;
        }
      }

      if (!profileData) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Profile not found in DynamoDB or clinics.json' })
        };
      }

      // Get profile info from Ayrshare
      let platformDetails = {};
      try {
        const apiKey = await getApiKey();
        const profileInfo = await ayrshareGetProfile(apiKey, profileData.ayrshareProfileKey);
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
            clinicId: profileData.clinicId,
            clinicName: profileData.clinicName,
            ayrshareProfileKey: profileData.ayrshareProfileKey,
            ayrshareRefId: profileData.ayrshareRefId,
            status: profileData.profileStatus,
            connectedPlatforms: profileData.connectedPlatforms || [],
            platformDetails,
            clinicMetadata: profileData.clinicMetadata,
            facebook: profileData.facebook,
            recentActivity: profileData.recentActivity || {},
            configOnly,
            syncedFromConfig: profileData.syncedFromConfig || false,
            createdAt: profileData.createdAt,
            updatedAt: profileData.updatedAt
          },
          hint: configOnly ? 'Profile loaded from clinics.json. Call POST /profiles/sync to persist to DynamoDB.' : undefined
        })
      };
    }

    // ---------------------------------------------------------
    // POST /profiles/:clinicId/generate-jwt - Generate JWT for social account linking
    // Now also supports profiles from clinics.json
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

      // First check DynamoDB
      const dbRes = await ddb.send(new GetCommand({
        TableName: PROFILES_TABLE,
        Key: { clinicId }
      }));

      let profileKey = dbRes.Item?.ayrshareProfileKey;
      let clinicName = dbRes.Item?.clinicName;
      let fromConfig = false;

      // If not in DynamoDB, check config from DynamoDB
      if (!profileKey) {
        const [clinicConfig, clinicSecrets] = await Promise.all([
          getClinicConfigFromDynamo(clinicId),
          getClinicSecrets(clinicId)
        ]);
        if (clinicSecrets?.ayrshareProfileKey) {
          profileKey = clinicSecrets.ayrshareProfileKey;
          clinicName = clinicConfig?.clinicName || clinicId;
          fromConfig = true;
          console.log('Using profile from config:', profileKey);
        }
      }

      console.log('Profile lookup result:', profileKey ? 'Found profile' : 'No profile found', fromConfig ? '(from config)' : '');

      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Clinic profile not found in DynamoDB or clinics.json.',
            clinicId,
            hint: 'Ensure this clinic has an ayrshare configuration in clinics.json or call POST /profiles/sync first.'
          })
        };
      }

      try {
        // Get Ayrshare credentials from GlobalSecrets
        const [apiKey, domain, privateKey] = await Promise.all([
          getApiKey(),
          getDomain(),
          getPrivateKey()
        ]);

        console.log('Generating JWT for profile:', profileKey, 'domain:', domain);
        const jwtRes = await ayrshareGenerateJWT(apiKey, profileKey, domain, privateKey, expiresIn);
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
            clinicName,
            jwtUrl: jwtRes.url,
            expiresAt,
            fromConfig,
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


/**
 * Register Device Handler for Push Notifications
 * 
 * Handles device token registration from mobile apps (iOS/Android).
 * Creates SNS Platform Endpoints and stores device metadata in DynamoDB.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, CreatePlatformEndpointCommand, GetEndpointAttributesCommand, SetEndpointAttributesCommand, DeleteEndpointCommand } from '@aws-sdk/client-sns';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasClinicAccess,
  getAllowedClinicIds,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

// Environment variables
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';
const APNS_PLATFORM_ARN = process.env.APNS_PLATFORM_ARN || '';
const APNS_SANDBOX_PLATFORM_ARN = process.env.APNS_SANDBOX_PLATFORM_ARN || '';
const FCM_PLATFORM_ARN = process.env.FCM_PLATFORM_ARN || '';

// Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});

// Helper functions
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

function http(code: number, body: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return { statusCode: code, headers: getCorsHeaders(event), body: payload };
}

function parseBody(body: any): Record<string, any> {
  try {
    return typeof body === 'string' ? JSON.parse(body) : (body || {});
  } catch {
    return {};
  }
}

// Platform types
type Platform = 'ios' | 'android';
type Environment = 'production' | 'sandbox';

interface RegisterDeviceRequest {
  deviceToken: string;
  platform: Platform;
  environment?: Environment; // For iOS: production vs sandbox (default: production)
  deviceName?: string;
  appVersion?: string;
  osVersion?: string;
}

interface DeviceTokenRecord {
  userId: string;
  deviceId: string; // Unique identifier for the device (hash of token)
  clinicId: string;
  deviceToken: string;
  platform: Platform;
  environment: Environment;
  endpointArn: string;
  deviceName?: string;
  appVersion?: string;
  osVersion?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
}

/**
 * Get the appropriate Platform Application ARN based on platform and environment
 */
function getPlatformApplicationArn(platform: Platform, environment: Environment): string {
  if (platform === 'android') {
    return FCM_PLATFORM_ARN;
  }
  // iOS
  return environment === 'sandbox' ? APNS_SANDBOX_PLATFORM_ARN : APNS_PLATFORM_ARN;
}

/**
 * Create a unique device ID from the token (for idempotency)
 */
function createDeviceId(deviceToken: string): string {
  // Use a simple hash for device ID
  let hash = 0;
  for (let i = 0; i < deviceToken.length; i++) {
    const char = deviceToken.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `device_${Math.abs(hash).toString(16)}`;
}

/**
 * Create or update SNS Platform Endpoint
 */
async function createOrUpdateEndpoint(
  platformArn: string,
  deviceToken: string,
  userId: string,
  clinicId: string
): Promise<string> {
  const customUserData = JSON.stringify({ userId, clinicId });

  try {
    // Try to create the endpoint
    const createResult = await sns.send(new CreatePlatformEndpointCommand({
      PlatformApplicationArn: platformArn,
      Token: deviceToken,
      CustomUserData: customUserData,
    }));

    const endpointArn = createResult.EndpointArn!;

    // Check if the endpoint already exists and needs updating
    try {
      const attributes = await sns.send(new GetEndpointAttributesCommand({
        EndpointArn: endpointArn,
      }));

      const currentToken = attributes.Attributes?.Token;
      const enabled = attributes.Attributes?.Enabled;

      // If token changed or endpoint is disabled, update it
      if (currentToken !== deviceToken || enabled !== 'true') {
        await sns.send(new SetEndpointAttributesCommand({
          EndpointArn: endpointArn,
          Attributes: {
            Token: deviceToken,
            Enabled: 'true',
            CustomUserData: customUserData,
          },
        }));
      }
    } catch (getError: any) {
      // If we can't get attributes, just continue with the created endpoint
      console.warn('Could not get endpoint attributes:', getError.message);
    }

    return endpointArn;
  } catch (error: any) {
    // Handle the case where endpoint already exists with different token
    if (error.name === 'InvalidParameterException' && error.message?.includes('already exists')) {
      // Extract the existing endpoint ARN from the error message
      const arnMatch = error.message.match(/Endpoint (arn:aws:sns:[^)]+)/);
      if (arnMatch) {
        const existingArn = arnMatch[1];
        
        // Update the existing endpoint with new token
        await sns.send(new SetEndpointAttributesCommand({
          EndpointArn: existingArn,
          Attributes: {
            Token: deviceToken,
            Enabled: 'true',
            CustomUserData: customUserData,
          },
        }));
        
        return existingArn;
      }
    }
    throw error;
  }
}

/**
 * Handle device registration
 */
async function handleRegister(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  const pathClinicId = event.pathParameters?.clinicId;

  // Validate required fields
  const { deviceToken, platform, environment = 'production', deviceName, appVersion, osVersion } = body as RegisterDeviceRequest;

  if (!deviceToken) {
    return http(400, { error: 'deviceToken is required' }, event);
  }

  if (!platform || !['ios', 'android'].includes(platform)) {
    return http(400, { error: 'platform must be "ios" or "android"' }, event);
  }

  // Determine clinic ID
  let clinicId = pathClinicId;
  if (!clinicId) {
    // Try to get default clinic from user permissions
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    if (allowedClinics.size === 1) {
      clinicId = Array.from(allowedClinics)[0];
    } else {
      return http(400, { error: 'clinicId is required when user has multiple clinics' }, event);
    }
  }

  // Verify user has access to the clinic
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'Forbidden: no access to this clinic' }, event);
  }

  const userId = userPerms.userId || userPerms.email || 'unknown';
  const deviceId = createDeviceId(deviceToken);
  const env: Environment = platform === 'android' ? 'production' : (environment as Environment);

  try {
    // Get platform application ARN
    const platformArn = getPlatformApplicationArn(platform, env);
    if (!platformArn) {
      return http(500, { error: `Platform application not configured for ${platform}/${env}` }, event);
    }

    // Create or update SNS endpoint
    const endpointArn = await createOrUpdateEndpoint(platformArn, deviceToken, userId, clinicId);

    const now = new Date().toISOString();
    const record: DeviceTokenRecord = {
      userId,
      deviceId,
      clinicId,
      deviceToken,
      platform,
      environment: env,
      endpointArn,
      deviceName,
      appVersion,
      osVersion,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    // Store in DynamoDB
    await ddb.send(new PutCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Item: record,
    }));

    console.log(`[RegisterDevice] Registered device for user ${userId}, clinic ${clinicId}, platform ${platform}`);

    return http(200, {
      success: true,
      deviceId,
      endpointArn,
      platform,
      environment: env,
    }, event);
  } catch (error: any) {
    console.error('[RegisterDevice] Error:', error);
    return http(500, { error: `Failed to register device: ${error.message}` }, event);
  }
}

/**
 * Handle getting registered devices for a user
 */
async function handleGetDevices(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const userId = userPerms.userId || userPerms.email || 'unknown';

  try {
    const result = await ddb.send(new QueryCommand({
      TableName: DEVICE_TOKENS_TABLE,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    }));

    const devices = (result.Items || []).map((item: any) => ({
      deviceId: item.deviceId,
      platform: item.platform,
      environment: item.environment,
      deviceName: item.deviceName,
      appVersion: item.appVersion,
      osVersion: item.osVersion,
      enabled: item.enabled,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return http(200, { devices }, event);
  } catch (error: any) {
    console.error('[GetDevices] Error:', error);
    return http(500, { error: `Failed to get devices: ${error.message}` }, event);
  }
}

/**
 * Main handler
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[RegisterDevice] Request:', event.httpMethod, event.path);

  if (event.httpMethod === 'OPTIONS') {
    return http(204, '', event);
  }

  // Get user permissions
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return http(401, { error: 'Unauthorized - Invalid token' }, event);
  }

  // Route based on method
  switch (event.httpMethod) {
    case 'POST':
      return handleRegister(event, userPerms);
    case 'GET':
      return handleGetDevices(event, userPerms);
    default:
      return http(405, { error: 'Method Not Allowed' }, event);
  }
};


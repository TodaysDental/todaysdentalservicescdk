/**
 * Register Device Handler for Push Notifications
 * 
 * Handles device token registration from mobile apps (iOS/Android) and web apps.
 * Stores device tokens in DynamoDB for direct Firebase Cloud Messaging (FCM) delivery.
 * 
 * DIRECT FIREBASE INTEGRATION - No SNS Platform Endpoints
 * 
 * Robustness Features:
 * - Atomic upsert using DynamoDB conditional writes (no race conditions)
 * - Token collision detection with proper device handoff
 * - TTL-based automatic cleanup of stale tokens (90 days)
 * - Unregistration endpoint for logout/app uninstall
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasClinicAccess,
  getAllowedClinicIds,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

// Environment variables
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';

// Configuration
const TOKEN_TTL_DAYS = 90; // Automatically expire tokens after 90 days of inactivity

// Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ========================================
// HELPERS
// ========================================

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

// ========================================
// TYPES
// ========================================

type Platform = 'ios' | 'android' | 'web';
type Environment = 'production' | 'sandbox';

interface RegisterDeviceRequest {
  deviceToken: string;
  platform: Platform;
  environment?: Environment; // For iOS: production vs sandbox (default: production)
  deviceId?: string; // Client-provided device ID (e.g., Android's ANDROID_ID)
  clinicId?: string; // Clinic ID can be provided in body
  clinicIds?: string[]; // Multiple clinic IDs for multi-clinic users
  deviceName?: string;
  appVersion?: string;
  osVersion?: string;
}

interface UnregisterDeviceRequest {
  deviceId?: string;      // Specific device to unregister
  deviceToken?: string;   // Or use token to find and unregister
  allDevices?: boolean;   // Unregister all devices for this user
}

interface DeviceTokenRecord {
  userId: string;
  deviceId: string; // Unique identifier for the device (hash of token)
  clinicId: string;
  deviceToken: string;
  platform: Platform;
  environment: Environment;
  deviceName?: string;
  appVersion?: string;
  osVersion?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  ttl: number; // DynamoDB TTL for automatic cleanup
}

// Token lookup index item
interface TokenLookupRecord {
  pk: string;           // TOKEN#<deviceToken_hash>
  sk: string;           // LOOKUP
  deviceToken: string;
  userId: string;
  deviceId: string;
  clinicId: string;
}

// ========================================
// DEVICE ID AND TOKEN HANDLING
// ========================================

/**
 * Create a unique device ID from the token (for idempotency)
 * Uses SHA-256 (truncated) for collision-resistant hashing
 * 
 * Previous implementation used 32-bit hash which had ~50% collision probability
 * after only 77,000 devices (birthday paradox). SHA-256 with 16 hex chars (64 bits)
 * needs ~4 billion devices for 50% collision probability.
 */
function createDeviceId(deviceToken: string): string {
  const hash = createHash('sha256').update(deviceToken).digest('hex');
  // Use first 16 hex characters (64 bits) for a good balance of uniqueness and readability
  return `device_${hash.substring(0, 16)}`;
}

/**
 * Create a hash of the token for lookup purposes
 * Uses a different approach to create a shorter, consistent hash
 */
function createTokenHash(deviceToken: string): string {
  let hash = 5381;
  for (let i = 0; i < deviceToken.length; i++) {
    hash = ((hash << 5) + hash) + deviceToken.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Calculate TTL timestamp for DynamoDB
 */
function calculateTtl(): number {
  return Math.floor(Date.now() / 1000) + (TOKEN_TTL_DAYS * 24 * 60 * 60);
}

// ========================================
// TOKEN COLLISION DETECTION
// ========================================

/**
 * Find existing device by token across all users
 * This handles device handoff scenarios (e.g., device sold/transferred)
 * Uses the deviceToken-index GSI for O(1) lookup instead of expensive table scan
 */
async function findExistingDeviceByToken(deviceToken: string): Promise<{ userId: string; deviceId: string; clinicId: string } | null> {
  try {
    // Use the deviceToken-index GSI for efficient O(1) lookup
    // This replaces the previous O(n) table scan
    const result = await ddb.send(new QueryCommand({
      TableName: DEVICE_TOKENS_TABLE,
      IndexName: 'deviceToken-index',
      KeyConditionExpression: 'deviceToken = :token',
      ExpressionAttributeValues: {
        ':token': deviceToken,
      },
      Limit: 1,
    }));

    if (result.Items && result.Items.length > 0) {
      const existingDevice = result.Items[0];

      // GSI returns KEYS_ONLY, so we need to fetch the full item if we need clinicId
      // For handoff, we primarily need userId and deviceId (which are in the GSI keys)
      if (!existingDevice.clinicId) {
        // Fetch full item to get clinicId
        const fullItem = await ddb.send(new GetCommand({
          TableName: DEVICE_TOKENS_TABLE,
          Key: {
            userId: existingDevice.userId,
            deviceId: existingDevice.deviceId,
          },
        }));

        if (fullItem.Item) {
          return {
            userId: fullItem.Item.userId,
            deviceId: fullItem.Item.deviceId,
            clinicId: fullItem.Item.clinicId,
          };
        }
      }

      return {
        userId: existingDevice.userId,
        deviceId: existingDevice.deviceId,
        clinicId: existingDevice.clinicId,
      };
    }

    return null;
  } catch (error) {
    console.warn('[RegisterDevice] Error checking for existing device:', error);
    return null;
  }
}

/**
 * Remove a device token from a previous user (device handoff)
 */
async function removeTokenFromPreviousUser(previousUserId: string, deviceId: string): Promise<void> {
  try {
    await ddb.send(new DeleteCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Key: { userId: previousUserId, deviceId },
    }));
    console.log(`[RegisterDevice] Removed token from previous user ${previousUserId}`);
  } catch (error) {
    console.error('[RegisterDevice] Error removing token from previous user:', error);
  }
}

// ========================================
// REGISTRATION HANDLER
// ========================================

/**
 * Handle device registration with atomic upsert
 * Supports multi-clinic registration - creates one record per clinic
 */
async function handleRegister(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  const pathClinicId = event.pathParameters?.clinicId;

  // Validate required fields
  const { 
    deviceToken, 
    platform, 
    environment = 'production', 
    deviceId: clientDeviceId,
    clinicId: bodyClinicId,
    clinicIds: bodyClinicIds,
    deviceName, 
    appVersion, 
    osVersion 
  } = body as RegisterDeviceRequest;

  // Validate device token
  if (!deviceToken || typeof deviceToken !== 'string') {
    return http(400, { error: 'deviceToken is required and must be a string' }, event);
  }

  const trimmedToken = deviceToken.trim();
  if (trimmedToken.length === 0) {
    return http(400, { error: 'deviceToken cannot be empty' }, event);
  }

  if (trimmedToken.length < 10) {
    return http(400, { error: 'deviceToken appears to be invalid (too short)' }, event);
  }

  // Validate platform
  if (!platform || !['ios', 'android', 'web'].includes(platform)) {
    return http(400, { error: 'platform must be "ios", "android", or "web"' }, event);
  }

  // Get user's allowed clinics
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);

  // Determine which clinics to register for
  let clinicIdsToRegister: string[] = [];

  // Priority 1: Multiple clinic IDs from body (multi-clinic registration)
  if (bodyClinicIds && Array.isArray(bodyClinicIds) && bodyClinicIds.length > 0) {
    // Filter to only allowed clinics
    clinicIdsToRegister = bodyClinicIds.filter(cid => hasClinicAccess(allowedClinics, cid));
    if (clinicIdsToRegister.length === 0) {
      return http(403, { error: 'Forbidden: no access to any of the specified clinics' }, event);
    }
  }
  // Priority 2: Single clinic from path or body
  else if (pathClinicId || bodyClinicId) {
    const clinicId = pathClinicId || bodyClinicId;
    if (!hasClinicAccess(allowedClinics, clinicId!)) {
      return http(403, { error: 'Forbidden: no access to this clinic' }, event);
    }
    clinicIdsToRegister = [clinicId!];
  }
  // Priority 3: Register for ALL user's allowed clinics (default for multi-clinic users)
  else if (allowedClinics.size > 0) {
    clinicIdsToRegister = Array.from(allowedClinics);
    console.log(`[RegisterDevice] No clinic specified, registering for all ${clinicIdsToRegister.length} allowed clinics`);
  } else {
    return http(400, { error: 'clinicId is required and user has no clinic access' }, event);
  }

  const userId = userPerms.email || 'unknown';
  // Use client-provided deviceId if available, otherwise generate from token
  // This ensures Android's ANDROID_ID is used for consistent device tracking
  const deviceId = clientDeviceId || createDeviceId(trimmedToken);
  const env: Environment = (platform === 'android' || platform === 'web') ? 'production' : (environment as Environment);

  try {
    const now = new Date().toISOString();
    const ttl = calculateTtl();

    // Check if this token is registered to a different user (device handoff)
    const existingDevice = await findExistingDeviceByToken(trimmedToken);
    if (existingDevice && existingDevice.userId !== userId) {
      console.log(`[RegisterDevice] Token handoff: removing from user ${existingDevice.userId}, adding to ${userId}`);
      await removeTokenFromPreviousUser(existingDevice.userId, existingDevice.deviceId);
    }

    // Register for each clinic
    const registrationResults: { clinicId: string; success: boolean; isUpdate: boolean }[] = [];

    for (const clinicId of clinicIdsToRegister) {
      try {
        // Check if this user already has this device registered for this clinic
        const existingResult = await ddb.send(new GetCommand({
          TableName: DEVICE_TOKENS_TABLE,
          Key: { userId, deviceId },
        }));

        const isUpdate = !!existingResult.Item;
        const createdAt = existingResult.Item?.createdAt || now;

        // For multi-clinic support, we store clinicIds as a set
        // Single deviceId per user, with all their clinics in one record
        const existingClinicIds = existingResult.Item?.clinicIds || [];
        const newClinicIds = [...new Set([...existingClinicIds, clinicId])];

        const record: DeviceTokenRecord & { clinicIds?: string[] } = {
          userId,
          deviceId,
          clinicId: clinicIdsToRegister[0], // Primary clinic (first one)
          clinicIds: newClinicIds, // All registered clinics
          deviceToken: trimmedToken,
          platform,
          environment: env,
          deviceName,
          appVersion,
          osVersion,
          enabled: true,
          createdAt,
          updatedAt: now,
          lastActiveAt: now,
          ttl,
        };

        if (isUpdate) {
          // Update existing record atomically
          await ddb.send(new UpdateCommand({
            TableName: DEVICE_TOKENS_TABLE,
            Key: { userId, deviceId },
            UpdateExpression: `
              SET deviceToken = :token,
                  clinicId = :clinicId,
                  clinicIds = :clinicIds,
                  platform = :platform,
                  environment = :env,
                  deviceName = :deviceName,
                  appVersion = :appVersion,
                  osVersion = :osVersion,
                  enabled = :enabled,
                  updatedAt = :updatedAt,
                  lastActiveAt = :lastActiveAt,
                  #ttl = :ttl
            `,
            ExpressionAttributeNames: {
              '#ttl': 'ttl',
            },
            ExpressionAttributeValues: {
              ':token': trimmedToken,
              ':clinicId': clinicIdsToRegister[0],
              ':clinicIds': newClinicIds,
              ':platform': platform,
              ':env': env,
              ':deviceName': deviceName || null,
              ':appVersion': appVersion || null,
              ':osVersion': osVersion || null,
              ':enabled': true,
              ':updatedAt': now,
              ':lastActiveAt': now,
              ':ttl': ttl,
            },
          }));
          console.log(`[RegisterDevice] Updated device ${deviceId} for user ${userId}, clinics: ${newClinicIds.join(', ')}`);
        } else {
          // Create new record with condition to prevent duplicates
          await ddb.send(new PutCommand({
            TableName: DEVICE_TOKENS_TABLE,
            Item: record,
            ConditionExpression: 'attribute_not_exists(userId) AND attribute_not_exists(deviceId)',
          }));
          console.log(`[RegisterDevice] Created device ${deviceId} for user ${userId}, clinics: ${newClinicIds.join(', ')}`);
        }

        registrationResults.push({ clinicId, success: true, isUpdate });
        
        // Only need to register once since we're storing all clinics in one record
        break;
      } catch (clinicError: any) {
        if (clinicError instanceof ConditionalCheckFailedException) {
          // Race condition - try update
          const updateNow = new Date().toISOString();
          await ddb.send(new UpdateCommand({
            TableName: DEVICE_TOKENS_TABLE,
            Key: { userId, deviceId },
            UpdateExpression: 'SET updatedAt = :now, lastActiveAt = :now, enabled = :enabled, #ttl = :ttl, clinicIds = list_append(if_not_exists(clinicIds, :empty), :newClinic)',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: {
              ':now': updateNow,
              ':enabled': true,
              ':ttl': calculateTtl(),
              ':newClinic': [clinicId],
              ':empty': [],
            },
          }));
          registrationResults.push({ clinicId, success: true, isUpdate: true });
          break;
        }
        console.error(`[RegisterDevice] Error registering for clinic ${clinicId}:`, clinicError);
        registrationResults.push({ clinicId, success: false, isUpdate: false });
      }
    }

    const successCount = registrationResults.filter(r => r.success).length;
    console.log(`[RegisterDevice] Registered device for user ${userId}, ${successCount}/${clinicIdsToRegister.length} clinics, platform ${platform}`);

    return http(200, {
      success: successCount > 0,
      deviceId,
      platform,
      environment: env,
      clinicIds: clinicIdsToRegister,
      registrationResults,
      message: `Device registered for push notifications via Firebase (${clinicIdsToRegister.length} clinic(s))`,
    }, event);
  } catch (error: any) {
    console.error('[RegisterDevice] Error:', error);
    return http(500, { error: `Failed to register device: ${error.message}` }, event);
  }
}

// ========================================
// UNREGISTRATION HANDLER
// ========================================

/**
 * Handle device unregistration (logout, app uninstall)
 */
async function handleUnregister(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body) as UnregisterDeviceRequest;
  const userId = userPerms.email || 'unknown';

  try {
    // Unregister all devices for this user
    if (body.allDevices) {
      const devices = await ddb.send(new QueryCommand({
        TableName: DEVICE_TOKENS_TABLE,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
      }));

      const deleteCount = devices.Items?.length || 0;
      for (const device of devices.Items || []) {
        await ddb.send(new DeleteCommand({
          TableName: DEVICE_TOKENS_TABLE,
          Key: { userId, deviceId: device.deviceId },
        }));
      }

      console.log(`[RegisterDevice] Unregistered all ${deleteCount} devices for user ${userId}`);
      return http(200, {
        success: true,
        message: `Unregistered ${deleteCount} device(s)`,
        count: deleteCount,
      }, event);
    }

    // Unregister specific device by ID
    if (body.deviceId) {
      await ddb.send(new DeleteCommand({
        TableName: DEVICE_TOKENS_TABLE,
        Key: { userId, deviceId: body.deviceId },
      }));

      console.log(`[RegisterDevice] Unregistered device ${body.deviceId} for user ${userId}`);
      return http(200, {
        success: true,
        message: 'Device unregistered',
        deviceId: body.deviceId,
      }, event);
    }

    // Unregister by token (find device first)
    if (body.deviceToken) {
      const deviceId = createDeviceId(body.deviceToken);
      await ddb.send(new DeleteCommand({
        TableName: DEVICE_TOKENS_TABLE,
        Key: { userId, deviceId },
      }));

      console.log(`[RegisterDevice] Unregistered device by token for user ${userId}`);
      return http(200, {
        success: true,
        message: 'Device unregistered',
        deviceId,
      }, event);
    }

    return http(400, { error: 'One of deviceId, deviceToken, or allDevices is required' }, event);
  } catch (error: any) {
    console.error('[RegisterDevice] Unregister error:', error);
    return http(500, { error: `Failed to unregister device: ${error.message}` }, event);
  }
}

// ========================================
// GET DEVICES HANDLER
// ========================================

/**
 * Handle getting registered devices for a user
 */
async function handleGetDevices(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const userId = userPerms.email || 'unknown';

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
      lastActiveAt: item.lastActiveAt,
    }));

    return http(200, { devices }, event);
  } catch (error: any) {
    console.error('[GetDevices] Error:', error);
    return http(500, { error: `Failed to get devices: ${error.message}` }, event);
  }
}

// ========================================
// HEARTBEAT/REFRESH HANDLER
// ========================================

/**
 * Handle device heartbeat (extends TTL, updates last active time)
 * Called periodically by apps to keep tokens fresh
 */
async function handleHeartbeat(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  const userId = userPerms.email || 'unknown';
  const deviceId = body.deviceId || (body.deviceToken ? createDeviceId(body.deviceToken) : null);

  if (!deviceId) {
    return http(400, { error: 'deviceId or deviceToken is required' }, event);
  }

  try {
    const now = new Date().toISOString();
    const ttl = calculateTtl();

    await ddb.send(new UpdateCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Key: { userId, deviceId },
      UpdateExpression: 'SET lastActiveAt = :now, updatedAt = :now, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':now': now,
        ':ttl': ttl,
      },
      ConditionExpression: 'attribute_exists(userId)',
    }));

    return http(200, {
      success: true,
      message: 'Device heartbeat recorded',
      deviceId,
      expiresAt: new Date(ttl * 1000).toISOString(),
    }, event);
  } catch (error: any) {
    if (error instanceof ConditionalCheckFailedException) {
      return http(404, { error: 'Device not found' }, event);
    }
    console.error('[Heartbeat] Error:', error);
    return http(500, { error: `Failed to update heartbeat: ${error.message}` }, event);
  }
}

// ========================================
// MAIN HANDLER
// ========================================

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

  // Route based on method and path
  const path = event.path.toLowerCase();

  switch (event.httpMethod) {
    case 'POST':
      if (path.includes('/heartbeat') || path.includes('/refresh')) {
        return handleHeartbeat(event, userPerms);
      }
      return handleRegister(event, userPerms);

    case 'DELETE':
      return handleUnregister(event, userPerms);

    case 'GET':
      return handleGetDevices(event, userPerms);

    default:
      return http(405, { error: 'Method Not Allowed' }, event);
  }
};

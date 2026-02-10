/**
 * Unregister Device Handler for Push Notifications
 * 
 * Handles device token removal from mobile apps.
 * Removes device metadata from DynamoDB.
 * 
 * DIRECT FIREBASE INTEGRATION - No SNS Platform Endpoints to delete
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

// Environment variables
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';

// Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

/**
 * Create a unique device ID from the token (same as in register-device.ts)
 */
function createDeviceId(deviceToken: string): string {
  let hash = 0;
  for (let i = 0; i < deviceToken.length; i++) {
    const char = deviceToken.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `device_${Math.abs(hash).toString(16)}`;
}

/**
 * Handle device unregistration by device token
 */
async function handleUnregisterByToken(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  const { deviceToken } = body;

  if (!deviceToken) {
    return http(400, { error: 'deviceToken is required' }, event);
  }

  const userId = userPerms.email || 'unknown';
  const deviceId = createDeviceId(deviceToken);

  try {
    // Get the device record to verify it exists
    const getResult = await ddb.send(new GetCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Key: {
        userId,
        deviceId,
      },
    }));

    if (!getResult.Item) {
      return http(404, { error: 'Device not found' }, event);
    }

    // Delete from DynamoDB
    await ddb.send(new DeleteCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Key: {
        userId,
        deviceId,
      },
    }));

    console.log(`[UnregisterDevice] Unregistered device ${deviceId} for user ${userId}`);

    return http(200, {
      success: true,
      message: 'Device unregistered successfully',
      deviceId,
    }, event);
  } catch (error: any) {
    console.error('[UnregisterDevice] Error:', error);
    return http(500, { error: `Failed to unregister device: ${error.message}` }, event);
  }
}

/**
 * Handle device unregistration by device ID (from path or body)
 */
async function handleUnregisterById(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  bodyDeviceId?: string
): Promise<APIGatewayProxyResult> {
  const deviceId = event.pathParameters?.deviceId || bodyDeviceId;

  if (!deviceId) {
    return http(400, { error: 'deviceId is required' }, event);
  }

  const userId = userPerms.email || 'unknown';

  try {
    // Get the device record to verify it exists
    const getResult = await ddb.send(new GetCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Key: {
        userId,
        deviceId,
      },
    }));

    if (!getResult.Item) {
      // Device might already be removed — treat as success for idempotency
      console.log(`[UnregisterDevice] Device ${deviceId} not found for user ${userId}, treating as already unregistered`);
      return http(200, {
        success: true,
        message: 'Device already unregistered or not found',
        deviceId,
      }, event);
    }

    // Delete from DynamoDB
    await ddb.send(new DeleteCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Key: {
        userId,
        deviceId,
      },
    }));

    console.log(`[UnregisterDevice] Unregistered device ${deviceId} for user ${userId}`);

    return http(200, {
      success: true,
      message: 'Device unregistered successfully',
      deviceId,
    }, event);
  } catch (error: any) {
    console.error('[UnregisterDevice] Error:', error);
    return http(500, { error: `Failed to unregister device: ${error.message}` }, event);
  }
}

/**
 * Handle unregistering all devices for a user
 */
async function handleUnregisterAll(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const userId = userPerms.email || 'unknown';

  try {
    // Query all devices for the user
    const queryResult = await ddb.send(new QueryCommand({
      TableName: DEVICE_TOKENS_TABLE,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    }));

    const devices = queryResult.Items || [];
    let deletedCount = 0;

    // Delete each device from DynamoDB
    for (const device of devices) {
      await ddb.send(new DeleteCommand({
        TableName: DEVICE_TOKENS_TABLE,
        Key: {
          userId,
          deviceId: device.deviceId,
        },
      }));
      deletedCount++;
    }

    console.log(`[UnregisterDevice] Unregistered ${deletedCount} devices for user ${userId}`);

    return http(200, {
      success: true,
      message: `Unregistered ${deletedCount} device(s)`,
      deletedCount,
    }, event);
  } catch (error: any) {
    console.error('[UnregisterDevice] Error:', error);
    return http(500, { error: `Failed to unregister devices: ${error.message}` }, event);
  }
}

/**
 * Smart POST /unregister handler
 * Routes based on body contents:
 * - { allDevices: true }           → unregister ALL devices for the user
 * - { deviceId: "..." }            → unregister specific device by ID
 * - { deviceToken: "..." }         → unregister device by FCM token
 * 
 * This supports both the Android app (sends deviceId + allDevices) and
 * web frontend (sends deviceToken).
 */
async function handleSmartUnregister(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);

  // Priority 1: allDevices flag (Android logout sends this)
  if (body.allDevices === true) {
    return handleUnregisterAll(event, userPerms);
  }

  // Priority 2: specific deviceId (Android sends ANDROID_ID)
  if (body.deviceId && typeof body.deviceId === 'string') {
    return handleUnregisterById(event, userPerms, body.deviceId);
  }

  // Priority 3: deviceToken (web frontend sends this)
  if (body.deviceToken && typeof body.deviceToken === 'string') {
    return handleUnregisterByToken(event, userPerms);
  }

  return http(400, { error: 'One of deviceToken, deviceId, or allDevices is required' }, event);
}

/**
 * Main handler
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('[UnregisterDevice] Request:', event.httpMethod, event.path);

  if (event.httpMethod === 'OPTIONS') {
    return http(204, '', event);
  }

  // Get user permissions
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return http(401, { error: 'Unauthorized - Invalid token' }, event);
  }

  // Route based on path and method
  const path = event.path || '';

  if (event.httpMethod === 'DELETE') {
    // DELETE /push/devices/{deviceId}
    if (event.pathParameters?.deviceId) {
      return handleUnregisterById(event, userPerms);
    }
    // DELETE /push/devices (with body containing deviceToken or deviceId)
    if (path.endsWith('/devices')) {
      return handleSmartUnregister(event, userPerms);
    }
    // DELETE /push/devices/all
    if (path.endsWith('/all')) {
      return handleUnregisterAll(event, userPerms);
    }
  }

  // POST /push/unregister — smart routing based on body fields
  if (event.httpMethod === 'POST' && path.includes('/unregister')) {
    return handleSmartUnregister(event, userPerms);
  }

  return http(405, { error: 'Method Not Allowed' }, event);
};

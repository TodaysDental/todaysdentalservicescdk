/**
 * Send Push Notification Handler
 * 
 * Sends push notifications to registered devices via SNS.
 * Supports sending to individual users, all users in a clinic, or specific device endpoints.
 * 
 * This Lambda supports two invocation modes:
 * 1. API Gateway - External HTTP requests with authorization
 * 2. Direct Lambda Invocation - Internal service calls (Comm Stack, Chime Stack)
 * 
 * For internal invocations, the caller should include:
 * - _internalCall: true (bypasses permission checks)
 * - notification: { title, body, type, data }
 * - One of: userId, userIds, clinicId
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  hasClinicAccess,
  getAllowedClinicIds,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

// Environment variables
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';

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

// Push notification types
type NotificationType = 
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'new_message'
  | 'treatment_update'
  | 'payment_due'
  | 'general'
  | 'staff_alert';

interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  type?: NotificationType;
  badge?: number;
  sound?: string;
  imageUrl?: string;
}

interface SendPushRequest {
  // Target (one of these is required)
  userId?: string;        // Send to specific user
  clinicId?: string;      // Send to all devices in a clinic
  endpointArn?: string;   // Send to specific endpoint
  
  // Notification content
  notification: PushNotificationPayload;
  
  // Options
  dryRun?: boolean;       // If true, don't actually send
}

interface DeviceRecord {
  userId: string;
  deviceId: string;
  clinicId: string;
  endpointArn: string;
  platform: 'ios' | 'android';
  enabled: boolean;
}

/**
 * Build platform-specific message payload
 */
function buildMessage(notification: PushNotificationPayload, platform: 'ios' | 'android'): string {
  const { title, body, data, badge, sound, imageUrl } = notification;
  
  // Build APNS payload for iOS
  const apnsPayload = {
    aps: {
      alert: {
        title,
        body,
      },
      badge: badge ?? 1,
      sound: sound ?? 'default',
      'mutable-content': imageUrl ? 1 : 0,
    },
    // Custom data
    ...data,
    type: notification.type || 'general',
  };
  
  // Build FCM payload for Android
  const fcmPayload = {
    notification: {
      title,
      body,
      sound: sound ?? 'default',
      ...(imageUrl && { image: imageUrl }),
    },
    data: {
      ...data,
      type: notification.type || 'general',
      title,
      body,
    },
    android: {
      notification: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        channel_id: 'high_importance_channel',
      },
    },
  };
  
  // Return platform-specific message structure for SNS
  const message: Record<string, string> = {
    default: body,
    APNS: JSON.stringify(apnsPayload),
    APNS_SANDBOX: JSON.stringify(apnsPayload),
    GCM: JSON.stringify(fcmPayload),
  };
  
  return JSON.stringify(message);
}

/**
 * Send push notification to a single endpoint
 */
async function sendToEndpoint(
  endpointArn: string,
  notification: PushNotificationPayload,
  platform: 'ios' | 'android'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const message = buildMessage(notification, platform);
    
    const result = await sns.send(new PublishCommand({
      TargetArn: endpointArn,
      Message: message,
      MessageStructure: 'json',
    }));
    
    return {
      success: true,
      messageId: result.MessageId,
    };
  } catch (error: any) {
    console.error(`[SendPush] Failed to send to ${endpointArn}:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get devices for a user
 */
async function getDevicesForUser(userId: string): Promise<DeviceRecord[]> {
  const result = await ddb.send(new QueryCommand({
    TableName: DEVICE_TOKENS_TABLE,
    KeyConditionExpression: 'userId = :userId',
    FilterExpression: 'enabled = :enabled',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':enabled': true,
    },
  }));
  
  return (result.Items || []) as DeviceRecord[];
}

/**
 * Get devices for a clinic
 */
async function getDevicesForClinic(clinicId: string): Promise<DeviceRecord[]> {
  // Use the GSI on clinicId
  const result = await ddb.send(new QueryCommand({
    TableName: DEVICE_TOKENS_TABLE,
    IndexName: 'clinicId-index',
    KeyConditionExpression: 'clinicId = :clinicId',
    FilterExpression: 'enabled = :enabled',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':enabled': true,
    },
  }));
  
  return (result.Items || []) as DeviceRecord[];
}

/**
 * Handle sending push notification to a user
 */
async function handleSendToUser(
  userId: string,
  notification: PushNotificationPayload,
  dryRun: boolean
): Promise<{ sent: number; failed: number; results: any[] }> {
  const devices = await getDevicesForUser(userId);
  
  if (devices.length === 0) {
    return { sent: 0, failed: 0, results: [] };
  }
  
  const results: any[] = [];
  let sent = 0;
  let failed = 0;
  
  for (const device of devices) {
    if (dryRun) {
      results.push({
        deviceId: device.deviceId,
        platform: device.platform,
        dryRun: true,
      });
      sent++;
      continue;
    }
    
    const result = await sendToEndpoint(device.endpointArn, notification, device.platform);
    results.push({
      deviceId: device.deviceId,
      platform: device.platform,
      ...result,
    });
    
    if (result.success) {
      sent++;
    } else {
      failed++;
    }
  }
  
  return { sent, failed, results };
}

/**
 * Handle sending push notification to a clinic
 */
async function handleSendToClinic(
  clinicId: string,
  notification: PushNotificationPayload,
  dryRun: boolean
): Promise<{ sent: number; failed: number; userCount: number; results: any[] }> {
  const devices = await getDevicesForClinic(clinicId);
  
  if (devices.length === 0) {
    return { sent: 0, failed: 0, userCount: 0, results: [] };
  }
  
  const results: any[] = [];
  let sent = 0;
  let failed = 0;
  const uniqueUsers = new Set(devices.map(d => d.userId));
  
  for (const device of devices) {
    if (dryRun) {
      results.push({
        userId: device.userId,
        deviceId: device.deviceId,
        platform: device.platform,
        dryRun: true,
      });
      sent++;
      continue;
    }
    
    const result = await sendToEndpoint(device.endpointArn, notification, device.platform);
    results.push({
      userId: device.userId,
      deviceId: device.deviceId,
      platform: device.platform,
      ...result,
    });
    
    if (result.success) {
      sent++;
    } else {
      failed++;
    }
  }
  
  return { sent, failed, userCount: uniqueUsers.size, results };
}

/**
 * Handle sending push notification request
 */
async function handleSendPush(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body) as SendPushRequest;
  const pathClinicId = event.pathParameters?.clinicId;
  
  // Validate notification payload
  if (!body.notification) {
    return http(400, { error: 'notification object is required' }, event);
  }
  
  if (!body.notification.title || !body.notification.body) {
    return http(400, { error: 'notification.title and notification.body are required' }, event);
  }
  
  // Check permissions for sending notifications
  if (!hasModulePermission(
    userPerms.clinicRoles,
    'Marketing',
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return http(403, { error: 'You do not have permission to send push notifications' }, event);
  }
  
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const dryRun = body.dryRun ?? false;
  
  try {
    // Send to specific endpoint
    if (body.endpointArn) {
      // Admin only for direct endpoint access
      if (!userPerms.isSuperAdmin && !userPerms.isGlobalSuperAdmin) {
        return http(403, { error: 'Direct endpoint access requires admin privileges' }, event);
      }
      
      if (dryRun) {
        return http(200, {
          success: true,
          dryRun: true,
          targetType: 'endpoint',
          endpointArn: body.endpointArn,
        }, event);
      }
      
      // Assume iOS for direct endpoint (could be enhanced with metadata lookup)
      const result = await sendToEndpoint(body.endpointArn, body.notification, 'ios');
      return http(200, {
        targetType: 'endpoint',
        ...result,
      }, event);
    }
    
    // Send to clinic (from path or body)
    const targetClinicId = pathClinicId || body.clinicId;
    if (targetClinicId) {
      if (!hasClinicAccess(allowedClinics, targetClinicId)) {
        return http(403, { error: 'Forbidden: no access to this clinic' }, event);
      }
      
      const result = await handleSendToClinic(targetClinicId, body.notification, dryRun);
      return http(200, {
        success: true,
        targetType: 'clinic',
        clinicId: targetClinicId,
        dryRun,
        ...result,
      }, event);
    }
    
    // Send to specific user
    if (body.userId) {
      const result = await handleSendToUser(body.userId, body.notification, dryRun);
      return http(200, {
        success: true,
        targetType: 'user',
        userId: body.userId,
        dryRun,
        ...result,
      }, event);
    }
    
    return http(400, { error: 'One of userId, clinicId, or endpointArn is required' }, event);
  } catch (error: any) {
    console.error('[SendPush] Error:', error);
    return http(500, { error: `Failed to send push notification: ${error.message}` }, event);
  }
}

/**
 * Internal invocation payload structure
 * Used when other Lambda functions (Comm, Chime) invoke this function directly
 */
interface InternalInvocationPayload {
  _internalCall: true;
  userId?: string;
  userIds?: string[];
  clinicId?: string;
  notification: PushNotificationPayload;
}

/**
 * Handle internal Lambda invocation (from Comm Stack, Chime Stack)
 * Bypasses API Gateway auth checks since the caller is a trusted internal service
 */
async function handleInternalInvocation(
  payload: InternalInvocationPayload
): Promise<{ statusCode: number; body: string }> {
  const { userId, userIds, clinicId, notification } = payload;
  
  // Validate notification payload
  if (!notification || !notification.title || !notification.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'notification.title and notification.body are required' }),
    };
  }
  
  try {
    // Send to multiple users (batch)
    if (userIds && userIds.length > 0) {
      let totalSent = 0;
      let totalFailed = 0;
      const allResults: any[] = [];
      
      for (const uid of userIds) {
        const result = await handleSendToUser(uid, notification, false);
        totalSent += result.sent;
        totalFailed += result.failed;
        allResults.push(...result.results);
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          targetType: 'users',
          userCount: userIds.length,
          sent: totalSent,
          failed: totalFailed,
          results: allResults,
        }),
      };
    }
    
    // Send to specific user
    if (userId) {
      const result = await handleSendToUser(userId, notification, false);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          targetType: 'user',
          userId,
          ...result,
        }),
      };
    }
    
    // Send to clinic
    if (clinicId) {
      const result = await handleSendToClinic(clinicId, notification, false);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          targetType: 'clinic',
          clinicId,
          ...result,
        }),
      };
    }
    
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'One of userId, userIds, or clinicId is required' }),
    };
  } catch (error: any) {
    console.error('[SendPush] Internal invocation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to send push notification: ${error.message}` }),
    };
  }
}

/**
 * Main handler
 * Supports both API Gateway events and direct Lambda invocation
 */
export const handler = async (
  event: APIGatewayProxyEvent | InternalInvocationPayload,
  context?: Context
): Promise<APIGatewayProxyResult | { statusCode: number; body: string }> => {
  // Check if this is an internal Lambda invocation
  if ('_internalCall' in event && event._internalCall === true) {
    console.log('[SendPush] Internal invocation');
    return handleInternalInvocation(event as InternalInvocationPayload);
  }
  
  // Handle as API Gateway event
  const apiEvent = event as APIGatewayProxyEvent;
  console.log('[SendPush] Request:', apiEvent.httpMethod, apiEvent.path);

  if (apiEvent.httpMethod === 'OPTIONS') {
    return http(204, '', apiEvent);
  }

  // Get user permissions
  const userPerms = getUserPermissions(apiEvent);
  if (!userPerms) {
    return http(401, { error: 'Unauthorized - Invalid token' }, apiEvent);
  }

  if (apiEvent.httpMethod !== 'POST') {
    return http(405, { error: 'Method Not Allowed' }, apiEvent);
  }

  return handleSendPush(apiEvent, userPerms);
};


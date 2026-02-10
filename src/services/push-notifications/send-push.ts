/**
 * Send Push Notification Handler
 * 
 * Sends push notifications to registered devices via Firebase Cloud Messaging (FCM) HTTP v1 API.
 * Supports sending to individual users, all users in a clinic, or specific devices.
 * 
 * DIRECT FIREBASE INTEGRATION - No SNS Platform Applications
 * 
 * This Lambda supports two invocation modes:
 * 1. API Gateway - External HTTP requests with authorization
 * 2. Direct Lambda Invocation - Internal service calls (Comm Stack, Chime Stack, HR Stack)
 * 
 * For internal invocations, the caller should include:
 * - _internalCall: true (bypasses permission checks)
 * - notification: { title, body, type, data }
 * - One of: userId, userIds, clinicId
 * 
 * Robustness Features:
 * - User preference checking (respects unsubscribe preferences)
 * - Idempotency via notification deduplication
 * - Invalid token cleanup on FCM errors
 * - Proper validation of notification payloads
 * - Detailed error reporting in batch results
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand, GetCommand, PutCommand, BatchGetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  hasClinicAccess,
  getAllowedClinicIds,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

// Import FCM v1 client for direct Firebase integration
import { sendFcmV1Notification, sendFcmV1NotificationBatch, isFcmV1Available, registerInvalidTokenCallback } from './fcm-v1-client';

// Environment variables
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';
const UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE || '';
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || '';
const DEDUPLICATION_TTL_MS = 60 * 1000; // 1 minute deduplication window

// Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// In-memory deduplication cache (per Lambda instance)
const recentNotifications = new Map<string, number>();

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

// ========================================
// TYPES
// ========================================

// Push notification types
type NotificationType =
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'new_message'
  | 'sync_unread'
  | 'treatment_update'
  | 'payment_due'
  | 'general'
  | 'staff_alert'
  | 'incoming_call'
  | 'call_ended'
  | 'call_cancelled'
  | 'missed_call'
  | 'voicemail'
  | 'mention'
  | 'shift_assigned'
  | 'shift_updated'
  | 'shift_cancelled'
  | 'shift_reminder'
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_denied'
  | 'advance_pay_submitted'
  | 'advance_pay_approved'
  | 'advance_pay_denied'
  | 'advance_pay_disbursed'
  | 'calendar_event'
  | 'hr_alert';

interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  type?: NotificationType;
  badge?: number;
  sound?: string;
  imageUrl?: string;
  category?: string;
  threadId?: string;
  idempotencyKey?: string; // Optional key for deduplication
}

interface SendPushRequest {
  // Target (one of these is required)
  userId?: string;        // Send to specific user
  clinicId?: string;      // Send to all devices in a clinic
  excludeDeviceIds?: string[]; // Do not send to these deviceIds

  // Notification content
  notification: PushNotificationPayload;

  // Options
  dryRun?: boolean;       // If true, don't actually send
  skipPreferenceCheck?: boolean; // Skip unsubscribe check (for critical notifications)
}

interface DeviceRecord {
  userId: string;
  deviceId: string;
  clinicId: string;
  deviceToken: string;   // Raw FCM/APNs/Web token
  platform: 'ios' | 'android' | 'web';
  enabled: boolean;
}

interface SendResult {
  deviceId: string;
  platform: string;
  success: boolean;
  messageId?: string;
  error?: string;
  tokenRemoved?: boolean;
}

// ========================================
// INITIALIZATION
// ========================================

// Register the invalid token callback for automatic cleanup
registerInvalidTokenCallback(async (deviceToken: string, reason: string) => {
  await cleanupInvalidToken(deviceToken, reason);
});

// ========================================
// INVALID TOKEN CLEANUP
// ========================================

/**
 * Remove invalid device token from DynamoDB
 * Called automatically when FCM returns token errors (404, UNREGISTERED, etc.)
 */
async function cleanupInvalidToken(deviceToken: string, reason: string): Promise<void> {
  if (!DEVICE_TOKENS_TABLE) {
    console.warn('[SendPush] Cannot cleanup token - DEVICE_TOKENS_TABLE not configured');
    return;
  }

  try {
    // Query for all records with this token using GSI
    // Note: This requires a GSI on deviceToken, or we need to scan
    // For now, we'll log the cleanup request - the actual cleanup happens via
    // the deviceId which we have in the batch results
    console.log(`[SendPush] Invalid token detected. Token: ${deviceToken.substring(0, 20)}... Reason: ${reason}`);

    // We'll handle the actual deletion in the batch result processing
    // since we have the userId and deviceId there
  } catch (error) {
    console.error('[SendPush] Error during token cleanup:', error);
  }
}

/**
 * Delete a specific device record from DynamoDB
 */
async function deleteDeviceRecord(userId: string, deviceId: string): Promise<boolean> {
  try {
    await ddb.send(new DeleteCommand({
      TableName: DEVICE_TOKENS_TABLE,
      Key: { userId, deviceId },
    }));
    console.log(`[SendPush] Deleted invalid device record: userId=${userId}, deviceId=${deviceId}`);
    return true;
  } catch (error) {
    console.error(`[SendPush] Failed to delete device record: userId=${userId}, deviceId=${deviceId}`, error);
    return false;
  }
}

// ========================================
// DEDUPLICATION (DynamoDB-backed for cross-instance consistency)
// ========================================

/**
 * Simple djb2 hash for generating shorter dedup keys
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a deduplication key for a notification
 * Includes data hash for more precise deduplication to avoid content collisions
 */
function generateDeduplicationKey(
  targetType: 'user' | 'clinic',
  targetId: string,
  notification: PushNotificationPayload
): string {
  // Use provided idempotency key if available (highest priority)
  if (notification.idempotencyKey) {
    return `idem:${notification.idempotencyKey}`;
  }

  // Create a more unique key including data hash to prevent content collisions
  // Two notifications with same type/title but different data should NOT be deduplicated
  const dataHash = notification.data
    ? simpleHash(JSON.stringify(notification.data))
    : '0';
  const timeBucket = Math.floor(Date.now() / DEDUPLICATION_TTL_MS);
  const content = `${notification.type}:${simpleHash(notification.title)}:${dataHash}`;
  return `${targetType}:${targetId}:${content}:${timeBucket}`;
}

/**
 * Check if a notification was recently sent (deduplication)
 * Uses DynamoDB for cross-instance consistency with in-memory cache as fast-path
 */
async function isDuplicateNotification(key: string): Promise<boolean> {
  const now = Date.now();

  // Clean up old entries from in-memory cache
  for (const [k, timestamp] of recentNotifications.entries()) {
    if (now - timestamp > DEDUPLICATION_TTL_MS) {
      recentNotifications.delete(k);
    }
  }

  // Check in-memory cache first (fast path for same-instance duplicates)
  if (recentNotifications.has(key)) {
    console.log(`[SendPush] Duplicate detected (in-memory): ${key.substring(0, 50)}...`);
    return true;
  }

  // Check DynamoDB for cross-instance deduplication
  // Uses UNSUBSCRIBE_TABLE with DEDUP# prefix to avoid creating another table
  if (UNSUBSCRIBE_TABLE) {
    try {
      const dedupKey = simpleHash(key);
      const result = await ddb.send(new GetCommand({
        TableName: UNSUBSCRIBE_TABLE,
        Key: {
          pk: `DEDUP#${dedupKey}`,
          sk: 'NOTIFICATION',
        },
      }));

      if (result.Item) {
        console.log(`[SendPush] Duplicate detected (DynamoDB): ${key.substring(0, 50)}...`);
        return true;
      }

      // Mark as sent in DynamoDB with TTL for auto-cleanup
      const ttl = Math.floor(Date.now() / 1000) + 120; // 2 minute TTL
      try {
        await ddb.send(new PutCommand({
          TableName: UNSUBSCRIBE_TABLE,
          Item: {
            pk: `DEDUP#${dedupKey}`,
            sk: 'NOTIFICATION',
            fullKey: key.substring(0, 200), // Store truncated key for debugging
            createdAt: new Date().toISOString(),
            ttl,
          },
          // Use conditional write to handle race conditions between Lambda instances
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
      } catch (putError: any) {
        // ConditionalCheckFailedException means another instance already wrote this key
        if (putError.name === 'ConditionalCheckFailedException') {
          console.log(`[SendPush] Concurrent duplicate detected: ${key.substring(0, 50)}...`);
          return true;
        }
        // Other errors - log but don't fail the dedup check
        console.warn('[SendPush] DynamoDB dedup put failed:', putError);
      }
    } catch (error) {
      // Log but don't fail - dedup is best-effort
      console.warn('[SendPush] DynamoDB dedup check failed:', error);
    }
  }

  // Mark in in-memory cache
  recentNotifications.set(key, now);
  return false;
}


// ========================================
// USER PREFERENCES
// ========================================

/**
 * Check if user has opted out of push notifications
 * Respects the unsubscribe system for 'PUSH' channel
 */
async function isUserUnsubscribed(userId: string, notificationType?: NotificationType): Promise<boolean> {
  if (!UNSUBSCRIBE_TABLE) {
    // No unsubscribe table configured - allow all
    return false;
  }

  try {
    // Check for PUSH notification preferences
    // The unsubscribe table uses pk = EMAIL#<email> or PREF#<userId>
    const result = await ddb.send(new GetCommand({
      TableName: UNSUBSCRIBE_TABLE,
      Key: {
        pk: `PREF#${userId}`,
        sk: 'GLOBAL',
      },
    }));

    if (result.Item) {
      const unsubscribedChannels = result.Item.unsubscribedChannels as string[] || [];
      // Check if user has unsubscribed from PUSH channel
      // Note: The unsubscribe system currently supports EMAIL, SMS, RCS
      // We'll extend it to support PUSH as well
      if (unsubscribedChannels.includes('PUSH')) {
        console.log(`[SendPush] User ${userId} has unsubscribed from PUSH notifications`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('[SendPush] Error checking unsubscribe status:', error);
    // Fail open - if we can't check, allow sending
    return false;
  }
}

/**
 * Batch check if users have opted out of push notifications
 * Uses BatchGetItem for O(1) per batch instead of O(n) sequential queries
 * Solves the N+1 problem when sending to clinics with many users
 */
async function getUnsubscribedUsers(userIds: string[], notificationType?: NotificationType): Promise<Set<string>> {
  const unsubscribedUsers = new Set<string>();

  if (!UNSUBSCRIBE_TABLE || userIds.length === 0) {
    return unsubscribedUsers;
  }

  try {
    // DynamoDB BatchGetItem has a limit of 100 items per request
    const BATCH_SIZE = 100;

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const keys = batch.map(userId => ({
        pk: `PREF#${userId}`,
        sk: 'GLOBAL',
      }));

      const result = await ddb.send(new BatchGetCommand({
        RequestItems: {
          [UNSUBSCRIBE_TABLE]: {
            Keys: keys,
            ProjectionExpression: 'pk, unsubscribedChannels',
          },
        },
      }));

      const responses = result.Responses?.[UNSUBSCRIBE_TABLE] || [];
      for (const item of responses) {
        const unsubscribedChannels = item.unsubscribedChannels as string[] || [];
        if (unsubscribedChannels.includes('PUSH')) {
          // Extract userId from pk (format: PREF#userId)
          const userId = (item.pk as string).replace('PREF#', '');
          unsubscribedUsers.add(userId);
        }
      }

      // Handle unprocessed keys (DynamoDB throttling)
      let unprocessedKeys = result.UnprocessedKeys?.[UNSUBSCRIBE_TABLE]?.Keys;
      let retryCount = 0;
      while (unprocessedKeys && unprocessedKeys.length > 0 && retryCount < 3) {
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount)); // Exponential backoff

        const retryResult = await ddb.send(new BatchGetCommand({
          RequestItems: {
            [UNSUBSCRIBE_TABLE]: {
              Keys: unprocessedKeys,
              ProjectionExpression: 'pk, unsubscribedChannels',
            },
          },
        }));

        const retryResponses = retryResult.Responses?.[UNSUBSCRIBE_TABLE] || [];
        for (const item of retryResponses) {
          const unsubscribedChannels = item.unsubscribedChannels as string[] || [];
          if (unsubscribedChannels.includes('PUSH')) {
            const userId = (item.pk as string).replace('PREF#', '');
            unsubscribedUsers.add(userId);
          }
        }
        unprocessedKeys = retryResult.UnprocessedKeys?.[UNSUBSCRIBE_TABLE]?.Keys;
      }
    }

    console.log(`[SendPush] Batch preference check: ${userIds.length} users, ${unsubscribedUsers.size} unsubscribed`);
  } catch (error) {
    console.error('[SendPush] Error in batch unsubscribe check:', error);
    // Fail open - if batch fails, fall back to allowing all
  }

  return unsubscribedUsers;
}

// ========================================
// NOTIFICATION CHANNEL MAPPING
// ========================================

/**
 * Get notification channel based on notification type
 * IMPORTANT: These channel IDs must match the channels created in the Android app
 * Android channels defined in TDIFirebaseMessagingService.kt:
 * - tdi_calls_channel: Calls (missed calls, voicemail, incoming calls)
 * - tdi_hr_channel: HR Notifications (shifts, leave, etc.)
 * - tdi_messages_channel: Messages (chat, tasks)
 * - tdi_general_channel: General notifications
 */
function getChannelForType(type?: NotificationType): string {
  switch (type) {
    // Call-related notifications - high importance
    case 'incoming_call':
    case 'call_ended':
    case 'call_cancelled':
    case 'missed_call':
    case 'voicemail':
      return 'tdi_calls_channel';

    // HR-related notifications
    case 'shift_assigned':
    case 'shift_updated':
    case 'shift_cancelled':
    case 'shift_reminder':
    case 'leave_submitted':
    case 'leave_approved':
    case 'leave_denied':
    case 'advance_pay_submitted':
    case 'advance_pay_approved':
    case 'advance_pay_denied':
    case 'advance_pay_disbursed':
    case 'calendar_event':
    case 'hr_alert':
      return 'tdi_hr_channel';

    // Message and task notifications
    case 'new_message':
    case 'mention':
    case 'staff_alert':
      return 'tdi_messages_channel';

    // General/default notifications
    case 'appointment_reminder':
    case 'appointment_confirmation':
    case 'treatment_update':
    case 'payment_due':
    case 'general':
    default:
      return 'tdi_general_channel';
  }
}

/**
 * Check if notification type should bypass preference checks
 * Critical notifications (incoming calls) should always be delivered
 */
function isCriticalNotification(type?: NotificationType): boolean {
  return type === 'incoming_call' || type === 'call_ended' || type === 'call_cancelled';
}

/**
 * Check if notification type should use data-only FCM messages.
 * 
 * Data-only messages omit the FCM `notification` field so that on Android,
 * `onMessageReceived()` in TDIFirebaseMessagingService is ALWAYS called,
 * even when the app is in the background. This is critical for:
 * 
 * - incoming_call: Needs to start IncomingCallService for ringtone, vibration,
 *   full-screen intent, and device wake-up
 * - voicemail: Needs deep-link handling and custom notification with playback action
 * 
 * Without data-only, Android's system notification handler intercepts the message
 * and shows a generic notification, bypassing all custom logic.
 */
function isDataOnlyNotification(type?: NotificationType): boolean {
  return type === 'incoming_call' || type === 'call_ended' || type === 'call_cancelled' || type === 'voicemail';
}

// ========================================
// DEVICE RETRIEVAL
// ========================================

/**
 * Get all devices for a user with pagination support
 * Handles DynamoDB 1MB limit by iterating through all pages
 */
async function getDevicesForUser(userId: string): Promise<DeviceRecord[]> {
  const devices: DeviceRecord[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: DEVICE_TOKENS_TABLE,
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'enabled = :enabled',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':enabled': true,
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    devices.push(...(result.Items || []) as DeviceRecord[]);
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return devices;
}

/**
 * Resolve current userIds that have access to a clinic.
 *
 * IMPORTANT: Clinic access can change over time. We treat the StaffUser table
 * (clinicRoles) as the source of truth so clinic-targeted pushes always reflect
 * current access, even if devices haven't re-registered.
 */
async function getUserIdsForClinicFromStaffUser(clinicId: string): Promise<string[]> {
  if (!STAFF_USER_TABLE) {
    console.warn('[SendPush] STAFF_USER_TABLE not configured; cannot resolve clinic recipients dynamically');
    return [];
  }

  const userIds: string[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: STAFF_USER_TABLE,
      ProjectionExpression: 'email, isActive, clinicRoles',
      ConsistentRead: true,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of (result.Items || [])) {
      const email = String((item as any)?.email || '').trim().toLowerCase();
      if (!email) continue;
      if ((item as any)?.isActive === false) continue;

      const clinicRoles = (item as any)?.clinicRoles;
      const roles = Array.isArray(clinicRoles) ? clinicRoles : [];
      const hasClinicAccess = roles.some((cr: any) => String(cr?.clinicId || '') === clinicId);

      if (hasClinicAccess) {
        userIds.push(email);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return userIds;
}

/**
 * Legacy clinic device lookup (kept as a fallback).
 * Queries DeviceTokens table by clinicId-index and scans for clinicIds array membership.
 */
async function getDevicesForClinicLegacy(clinicId: string): Promise<DeviceRecord[]> {
  const devices: DeviceRecord[] = [];
  const seenDeviceIds = new Set<string>();
  let lastEvaluatedKey: Record<string, any> | undefined;

  // Step 1: Query using the clinicId-index (finds devices where this is the PRIMARY clinic)
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: DEVICE_TOKENS_TABLE,
      IndexName: 'clinicId-index',
      KeyConditionExpression: 'clinicId = :clinicId',
      FilterExpression: 'enabled = :enabled',
      ExpressionAttributeValues: {
        ':clinicId': clinicId,
        ':enabled': true,
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of (result.Items || [])) {
      const device = item as DeviceRecord;
      const key = `${device.userId}:${device.deviceId}`;
      if (!seenDeviceIds.has(key)) {
        seenDeviceIds.add(key);
        devices.push(device);
      }
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Step 2: Scan for devices where clinicIds array CONTAINS this clinic
  // This finds multi-clinic users where this clinic is NOT their primary
  // but they should still receive notifications
  // Note: Scan is O(n) but necessary for array-contains on non-GSI fields
  // For dental practice scale (~1000s of devices), this is acceptable
  try {
    let scanLastKey: Record<string, any> | undefined;
    do {
      const scanResult = await ddb.send(new ScanCommand({
        TableName: DEVICE_TOKENS_TABLE,
        FilterExpression: 'enabled = :enabled AND contains(clinicIds, :targetClinic) AND clinicId <> :targetClinic',
        ExpressionAttributeValues: {
          ':enabled': true,
          ':targetClinic': clinicId,
        },
        ExclusiveStartKey: scanLastKey,
        // Limit each scan page to reduce memory usage
        Limit: 100,
      }));

      for (const item of (scanResult.Items || [])) {
        const device = item as DeviceRecord;
        const key = `${device.userId}:${device.deviceId}`;
        if (!seenDeviceIds.has(key)) {
          seenDeviceIds.add(key);
          devices.push(device);
        }
      }
      scanLastKey = scanResult.LastEvaluatedKey;
    } while (scanLastKey);
  } catch (error) {
    // If scan fails, we still have devices from the primary query
    console.warn('[SendPush] Failed to scan for multi-clinic devices:', error);
  }

  console.log(`[SendPush] Found ${devices.length} devices for clinic ${clinicId} (${seenDeviceIds.size} unique)`);
  return devices;
}

/**
 * Get all devices for a clinic based on CURRENT clinic access.
 *
 * Implementation:
 * 1. Scan StaffUser to find users whose clinicRoles include the clinicId (source of truth)
 * 2. Query DeviceTokens by userId for those users (concurrency-limited)
 */
async function getDevicesForClinic(clinicId: string): Promise<DeviceRecord[]> {
  if (!STAFF_USER_TABLE) {
    console.warn('[SendPush] STAFF_USER_TABLE not configured; falling back to legacy clinic device lookup');
    return getDevicesForClinicLegacy(clinicId);
  }

  const userIds = await getUserIdsForClinicFromStaffUser(clinicId);
  if (userIds.length === 0) {
    console.log(`[SendPush] No users with access to clinic ${clinicId}`);
    return [];
  }

  const devices: DeviceRecord[] = [];
  const seenDeviceIds = new Set<string>();

  // Concurrency limit to avoid DynamoDB throttling when clinics have many users
  const CONCURRENCY = 10;
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((userId) => getDevicesForUser(userId)));
    for (const deviceList of batchResults) {
      for (const device of deviceList) {
        const key = `${device.userId}:${device.deviceId}`;
        if (seenDeviceIds.has(key)) continue;
        seenDeviceIds.add(key);
        devices.push(device);
      }
    }
  }

  console.log(`[SendPush] Found ${devices.length} devices for clinic ${clinicId} from ${userIds.length} user(s)`);
  return devices;
}

// ========================================
// SEND HANDLERS
// ========================================

/**
 * Handle sending push notification to a user
 */
async function handleSendToUser(
  userId: string,
  notification: PushNotificationPayload,
  dryRun: boolean,
  skipPreferenceCheck: boolean = false,
  excludeDeviceIds?: string[]
): Promise<{ sent: number; failed: number; results: SendResult[]; skipped?: string }> {
  // Check for duplicates
  const dedupKey = generateDeduplicationKey('user', userId, notification);
  if (await isDuplicateNotification(dedupKey)) {
    console.log(`[SendPush] Duplicate notification detected for user ${userId}, skipping`);
    return { sent: 0, failed: 0, results: [], skipped: 'duplicate' };
  }

  // Check user preferences (unless it's a critical notification or explicitly skipped)
  if (!skipPreferenceCheck && !isCriticalNotification(notification.type)) {
    const isUnsubscribed = await isUserUnsubscribed(userId, notification.type);
    if (isUnsubscribed) {
      console.log(`[SendPush] User ${userId} has opted out of push notifications, skipping`);
      return { sent: 0, failed: 0, results: [], skipped: 'unsubscribed' };
    }
  }

  const devices = await getDevicesForUser(userId);
  const excludeSet = new Set((excludeDeviceIds || []).filter(Boolean));
  const filteredDevices = excludeSet.size > 0
    ? devices.filter(d => !excludeSet.has(d.deviceId))
    : devices;

  if (filteredDevices.length === 0) {
    if (devices.length === 0) {
      console.log(`[SendPush] No devices registered for user ${userId}`);
    } else {
      console.log(`[SendPush] All devices excluded for user ${userId} (excludeDeviceIds=${Array.from(excludeSet).join(',')})`);
    }
    return { sent: 0, failed: 0, results: [] };
  }

  if (dryRun) {
    const results = filteredDevices.map(device => ({
      deviceId: device.deviceId,
      platform: device.platform,
      success: true,
      dryRun: true,
    } as SendResult));
    return { sent: filteredDevices.length, failed: 0, results };
  }

  // Prepare notification data
  const notificationData = {
    ...notification.data,
    type: notification.type || 'general',
    title: notification.title,
    body: notification.body,
    timestamp: String(Date.now()),
  };

  // Send to all devices using batch function
  const batchResult = await sendFcmV1NotificationBatch(
    filteredDevices.map(d => ({ deviceToken: d.deviceToken, platform: d.platform })),
    {
      title: notification.title,
      body: notification.body,
      data: notificationData,
      imageUrl: notification.imageUrl,
      priority: 'high',
      channelId: getChannelForType(notification.type),
      badge: notification.badge,
      sound: notification.sound,
      category: notification.category,
      threadId: notification.threadId,
      dataOnly: isDataOnlyNotification(notification.type),
    }
  );

  // Map results back to include deviceId and handle invalid token cleanup
  const results: SendResult[] = [];

  for (let i = 0; i < batchResult.results.length; i++) {
    const result = batchResult.results[i];
    const device = filteredDevices[i];

    // Safety check for array bounds
    if (!device) {
      console.warn(`[SendPush] Result index ${i} has no corresponding device`);
      continue;
    }

    const sendResult: SendResult = {
      deviceId: device.deviceId,
      platform: device.platform,
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };

    // Clean up invalid tokens
    if (result.shouldRemoveToken) {
      const deleted = await deleteDeviceRecord(device.userId, device.deviceId);
      sendResult.tokenRemoved = deleted;
    }

    results.push(sendResult);
  }

  console.log(`[SendPush] Sent to user ${userId}: ${batchResult.sent} success, ${batchResult.failed} failed`);
  return { sent: batchResult.sent, failed: batchResult.failed, results };
}

/**
 * Handle sending push notification to a clinic
 */
async function handleSendToClinic(
  clinicId: string,
  notification: PushNotificationPayload,
  dryRun: boolean,
  skipPreferenceCheck: boolean = false,
  excludeDeviceIds?: string[]
): Promise<{ sent: number; failed: number; userCount: number; results: SendResult[] }> {
  // Check for duplicates
  const dedupKey = generateDeduplicationKey('clinic', clinicId, notification);
  if (await isDuplicateNotification(dedupKey)) {
    console.log(`[SendPush] Duplicate notification detected for clinic ${clinicId}, skipping`);
    return { sent: 0, failed: 0, userCount: 0, results: [] };
  }

  const devices = await getDevicesForClinic(clinicId);

  if (devices.length === 0) {
    console.log(`[SendPush] No devices registered for clinic ${clinicId}`);
    return { sent: 0, failed: 0, userCount: 0, results: [] };
  }

  // Filter out unsubscribed users (unless critical notification)
  // Uses batch preference checking to avoid N+1 problem
  let filteredDevices = devices;
  if (!skipPreferenceCheck && !isCriticalNotification(notification.type)) {
    const uniqueUsers = [...new Set(devices.map(d => d.userId))];
    const unsubscribedUsers = await getUnsubscribedUsers(uniqueUsers, notification.type);

    if (unsubscribedUsers.size > 0) {
      console.log(`[SendPush] Filtering out ${unsubscribedUsers.size} unsubscribed users for clinic ${clinicId}`);
      filteredDevices = devices.filter(d => !unsubscribedUsers.has(d.userId));
    }
  }

  // Optional: exclude deviceIds (device-aware delivery)
  const excludeSet = new Set((excludeDeviceIds || []).filter(Boolean));
  if (excludeSet.size > 0) {
    filteredDevices = filteredDevices.filter(d => !excludeSet.has(d.deviceId));
  }

  const uniqueUsers = new Set(filteredDevices.map(d => d.userId));

  if (filteredDevices.length === 0) {
    console.log(`[SendPush] All users for clinic ${clinicId} have opted out`);
    return { sent: 0, failed: 0, userCount: 0, results: [] };
  }

  if (dryRun) {
    const results = filteredDevices.map(device => ({
      userId: device.userId,
      deviceId: device.deviceId,
      platform: device.platform,
      success: true,
      dryRun: true,
    } as unknown as SendResult));
    return { sent: filteredDevices.length, failed: 0, userCount: uniqueUsers.size, results };
  }

  // Prepare notification data
  const notificationData = {
    ...notification.data,
    type: notification.type || 'general',
    title: notification.title,
    body: notification.body,
    timestamp: String(Date.now()),
  };

  // Send to all devices using batch function
  const batchResult = await sendFcmV1NotificationBatch(
    filteredDevices.map(d => ({ deviceToken: d.deviceToken, platform: d.platform })),
    {
      title: notification.title,
      body: notification.body,
      data: notificationData,
      imageUrl: notification.imageUrl,
      priority: 'high',
      channelId: getChannelForType(notification.type),
      badge: notification.badge,
      sound: notification.sound,
      category: notification.category,
      threadId: notification.threadId,
      dataOnly: isDataOnlyNotification(notification.type),
    }
  );

  // Map results back to include userId and deviceId
  const results: SendResult[] = [];

  for (let i = 0; i < batchResult.results.length; i++) {
    const result = batchResult.results[i];
    const device = filteredDevices[i];

    // Safety check for array bounds
    if (!device) {
      console.warn(`[SendPush] Result index ${i} has no corresponding device`);
      continue;
    }

    const sendResult: SendResult = {
      deviceId: device.deviceId,
      platform: device.platform,
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };

    // Clean up invalid tokens
    if (result.shouldRemoveToken) {
      const deleted = await deleteDeviceRecord(device.userId, device.deviceId);
      sendResult.tokenRemoved = deleted;
    }

    results.push(sendResult);
  }

  console.log(`[SendPush] Sent to clinic ${clinicId}: ${batchResult.sent} success, ${batchResult.failed} failed`);
  return { sent: batchResult.sent, failed: batchResult.failed, userCount: uniqueUsers.size, results };
}

// ========================================
// API GATEWAY HANDLER
// ========================================

/**
 * Handle sending push notification request (API Gateway)
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

  // Validate title and body length
  if (body.notification.title.length > 100) {
    return http(400, { error: 'notification.title must be 100 characters or less' }, event);
  }

  if (body.notification.body.length > 1000) {
    return http(400, { error: 'notification.body must be 1000 characters or less' }, event);
  }

  // Check if FCM is available
  if (!await isFcmV1Available()) {
    return http(503, { error: 'Push notification service not configured (FCM credentials missing)' }, event);
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
  const skipPreferenceCheck = body.skipPreferenceCheck ?? false;

  try {
    // Send to clinic (from path or body)
    const targetClinicId = pathClinicId || body.clinicId;
    if (targetClinicId) {
      if (!hasClinicAccess(allowedClinics, targetClinicId)) {
        return http(403, { error: 'Forbidden: no access to this clinic' }, event);
      }

      const result = await handleSendToClinic(targetClinicId, body.notification, dryRun, skipPreferenceCheck);
      return http(200, {
        success: true,
        targetType: 'clinic',
        clinicId: targetClinicId,
        dryRun,
        method: 'fcm_v1_api',
        ...result,
      }, event);
    }

    // Send to specific user
    if (body.userId) {
      const result = await handleSendToUser(body.userId, body.notification, dryRun, skipPreferenceCheck);
      return http(200, {
        success: true,
        targetType: 'user',
        userId: body.userId,
        dryRun,
        method: 'fcm_v1_api',
        ...result,
      }, event);
    }

    return http(400, { error: 'One of userId or clinicId is required' }, event);
  } catch (error: any) {
    console.error('[SendPush] Error:', error);
    return http(500, { error: `Failed to send push notification: ${error.message}` }, event);
  }
}

// ========================================
// INTERNAL INVOCATION HANDLER
// ========================================

/**
 * Internal invocation payload structure
 * Used when other Lambda functions (Comm, Chime, HR) invoke this function directly
 */
interface InternalInvocationPayload {
  _internalCall: true;
  userId?: string;
  userIds?: string[];
  clinicId?: string;
  excludeDeviceIds?: string[];
  notification: PushNotificationPayload;
  skipPreferenceCheck?: boolean;
}

/**
 * Handle internal Lambda invocation (from Comm Stack, Chime Stack, HR Stack)
 * Bypasses API Gateway auth checks since the caller is a trusted internal service
 */
async function handleInternalInvocation(
  payload: InternalInvocationPayload
): Promise<{ statusCode: number; body: string }> {
  const { userId, userIds, clinicId, excludeDeviceIds, notification, skipPreferenceCheck = false } = payload;

  // Validate notification payload
  if (!notification || !notification.title || !notification.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'notification.title and notification.body are required' }),
    };
  }

  // Check if FCM is available
  if (!await isFcmV1Available()) {
    console.warn('[SendPush] FCM not configured, skipping push notification');
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'Push notification service not configured',
        sent: 0,
        failed: 0,
        results: [],
      }),
    };
  }

  try {
    // Send to multiple users (batch)
    if (userIds && userIds.length > 0) {
      let totalSent = 0;
      let totalFailed = 0;
      const allResults: any[] = [];

      for (const uid of userIds) {
        const result = await handleSendToUser(uid, notification, false, skipPreferenceCheck, excludeDeviceIds);
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
          method: 'fcm_v1_api',
          results: allResults,
        }),
      };
    }

    // Send to specific user
    if (userId) {
      const result = await handleSendToUser(userId, notification, false, skipPreferenceCheck, excludeDeviceIds);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          targetType: 'user',
          userId,
          method: 'fcm_v1_api',
          ...result,
        }),
      };
    }

    // Send to clinic
    if (clinicId) {
      const result = await handleSendToClinic(clinicId, notification, false, skipPreferenceCheck, excludeDeviceIds);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          targetType: 'clinic',
          clinicId,
          method: 'fcm_v1_api',
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

// ========================================
// MAIN HANDLER
// ========================================

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

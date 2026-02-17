/**
 * Push Notification Service
 * 
 * Shared utility for sending push notifications to mobile devices.
 * Used by Comm Stack (messaging) and Chime Stack (call notifications).
 * 
 * DIRECT FIREBASE INTEGRATION - Uses FCM HTTP v1 API
 * 
 * Features:
 * - Send to individual users
 * - Send to multiple users (batch)
 * - Send to clinic staff
 * - Platform-specific payload formatting (iOS APNs via Firebase, Android FCM)
 * 
 * Prerequisites:
 * - PushNotificationsStack must be deployed
 * - Device tokens must be registered via /push/register API
 * - FCM service account must be configured in GlobalSecrets
 */

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// ========================================
// TYPES
// ========================================

export type PushNotificationType =
  | 'new_message'
  | 'task_assigned'
  | 'task_completed'
  | 'task_forwarded'
  | 'meeting_scheduled'
  | 'meeting_reminder'
  | 'incoming_call'
  | 'missed_call'
  | 'voicemail'
  | 'queue_update'
  | 'appointment_reminder'
  | 'staff_alert'
  // HR Module notification types
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
  | 'hr_alert'
  | 'general';

export interface PushNotificationPayload {
  title: string;
  body: string;
  type: PushNotificationType;
  data?: Record<string, any>;
  badge?: number;
  sound?: string;
  imageUrl?: string;
  // Category for iOS actionable notifications
  category?: string;
  // Thread ID for grouping notifications
  threadId?: string;
}

export interface DeviceRecord {
  userId: string;
  deviceId: string;
  clinicId: string;
  deviceToken: string;
  platform: 'ios' | 'android';
  environment?: 'sandbox' | 'production';
  enabled: boolean;
  deviceName?: string;
  appVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendPushResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deviceId?: string;
  platform?: string;
}

export interface BatchSendResult {
  sent: number;
  failed: number;
  results: SendPushResult[];
}

// ========================================
// PUSH NOTIFICATION SERVICE CLASS
// ========================================

export class PushNotificationService {
  private ddb: DynamoDBDocumentClient;
  private lambda?: LambdaClient;
  private deviceTokensTable: string;
  private sendPushFunctionName?: string;

  constructor(config: {
    ddb: DynamoDBDocumentClient;
    deviceTokensTable: string;
    lambda?: LambdaClient;
    sendPushFunctionName?: string;
  }) {
    this.ddb = config.ddb;
    this.deviceTokensTable = config.deviceTokensTable;
    this.lambda = config.lambda;
    this.sendPushFunctionName = config.sendPushFunctionName;
  }

  /**
   * Get Android notification channel based on notification type
   */
  private getChannelForType(type: PushNotificationType): string {
    switch (type) {
      case 'incoming_call':
      case 'missed_call':
        return 'call_notifications';
      case 'new_message':
      case 'task_assigned':
      case 'task_forwarded':
        return 'high_importance_channel';
      case 'meeting_reminder':
      case 'appointment_reminder':
        return 'reminder_channel';
      default:
        return 'default_channel';
    }
  }

  /**
   * Get all registered devices for a user
   */
  async getDevicesForUser(userId: string): Promise<DeviceRecord[]> {
    try {
      const result = await this.ddb.send(new QueryCommand({
        TableName: this.deviceTokensTable,
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'enabled = :enabled',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':enabled': true,
        },
      }));

      return (result.Items || []) as DeviceRecord[];
    } catch (error: any) {
      console.error(`[PushService] Failed to get devices for user ${userId}:`, error.message);
      return [];
    }
  }

  /**
   * Get all registered devices for a clinic
   */
  async getDevicesForClinic(clinicId: string): Promise<DeviceRecord[]> {
    try {
      const result = await this.ddb.send(new QueryCommand({
        TableName: this.deviceTokensTable,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        FilterExpression: 'enabled = :enabled',
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
          ':enabled': true,
        },
      }));

      return (result.Items || []) as DeviceRecord[];
    } catch (error: any) {
      console.error(`[PushService] Failed to get devices for clinic ${clinicId}:`, error.message);
      return [];
    }
  }

  /**
   * Send push notification to a user (all their registered devices)
   * Uses the centralized send-push Lambda which handles FCM delivery
   */
  async sendToUser(userId: string, notification: PushNotificationPayload): Promise<BatchSendResult> {
    return this.invokeSendPushLambda({ userId }, notification);
  }

  /**
   * Send push notification to multiple users
   */
  async sendToUsers(userIds: string[], notification: PushNotificationPayload): Promise<BatchSendResult> {
    if (userIds.length === 0) {
      return { sent: 0, failed: 0, results: [] };
    }

    return this.invokeSendPushLambda({ userIds }, notification);
  }

  /**
   * Send push notification to all staff in a clinic
   */
  async sendToClinic(clinicId: string, notification: PushNotificationPayload): Promise<BatchSendResult> {
    return this.invokeSendPushLambda({ clinicId }, notification);
  }

  /**
   * Invoke the send-push Lambda function (for cross-stack invocation)
   * This is the primary method for sending notifications
   */
  async invokeSendPushLambda(
    target: { userId?: string; clinicId?: string; userIds?: string[] },
    notification: PushNotificationPayload
  ): Promise<BatchSendResult> {
    if (!this.lambda || !this.sendPushFunctionName) {
      throw new Error('[PushService] Lambda client or function name not configured for cross-stack invocation');
    }

    const payload = {
      _internalCall: true,
      ...target,
      notification,
    };

    try {
      const response = await this.lambda.send(new InvokeCommand({
        FunctionName: this.sendPushFunctionName,
        Payload: JSON.stringify(payload),
        InvocationType: 'RequestResponse',
      }));

      if (response.Payload) {
        const result = JSON.parse(new TextDecoder().decode(response.Payload));
        if (result.statusCode === 200) {
          const body = JSON.parse(result.body);
          return {
            sent: body.sent || 0,
            failed: body.failed || 0,
            results: body.results || [],
          };
        }

        // Handle error responses
        if (result.statusCode === 503) {
          console.warn('[PushService] Push service not configured');
          return { sent: 0, failed: 0, results: [] };
        }

        throw new Error(result.body || 'Unknown error from send-push Lambda');
      }

      return { sent: 0, failed: 0, results: [] };
    } catch (error: any) {
      console.error('[PushService] Failed to invoke send-push Lambda:', error.message);
      throw error;
    }
  }

  /**
   * Invoke the send-push Lambda asynchronously (fire-and-forget)
   * Use this for non-critical notifications where you don't need the result
   */
  async invokeSendPushLambdaAsync(
    target: { userId?: string; clinicId?: string; userIds?: string[] },
    notification: PushNotificationPayload
  ): Promise<boolean> {
    if (!this.lambda || !this.sendPushFunctionName) {
      console.warn('[PushService] Lambda client or function name not configured');
      return false;
    }

    const payload = {
      _internalCall: true,
      ...target,
      notification,
    };

    try {
      const response = await this.lambda.send(new InvokeCommand({
        FunctionName: this.sendPushFunctionName,
        Payload: JSON.stringify(payload),
        InvocationType: 'Event', // Async invocation
      }));

      return response.StatusCode === 202;
    } catch (error: any) {
      console.error('[PushService] Failed to invoke send-push Lambda async:', error.message);
      return false;
    }
  }
}

// ========================================
// NOTIFICATION BUILDERS
// ========================================

/**
 * Build notification for new message
 */
export function buildNewMessageNotification(
  senderName: string,
  messagePreview: string,
  conversationId: string,
  isGroup?: boolean
): PushNotificationPayload {
  return {
    title: isGroup ? `New message in group` : `Message from ${senderName}`,
    body: messagePreview.length > 100 ? messagePreview.substring(0, 97) + '...' : messagePreview,
    type: 'new_message',
    sound: 'default',
    data: {
      conversationId,
      action: 'open_conversation',
    },
    threadId: `conversation-${conversationId}`,
  };
}

/**
 * Build notification for task assignment
 */
export function buildTaskAssignedNotification(
  taskTitle: string,
  assignerName: string,
  taskId: string,
  priority?: string
): PushNotificationPayload {
  return {
    title: `New Task: ${taskTitle}`,
    body: `Assigned by ${assignerName}${priority ? ` (${priority} priority)` : ''}`,
    type: 'task_assigned',
    sound: 'default',
    data: {
      taskId,
      action: 'open_task',
      priority,
    },
    category: 'TASK_ACTIONS',
  };
}

/**
 * Build notification for task forwarded
 */
export function buildTaskForwardedNotification(
  taskTitle: string,
  forwarderName: string,
  taskId: string,
  requiresAcceptance?: boolean
): PushNotificationPayload {
  return {
    title: requiresAcceptance ? 'Task Requires Acceptance' : 'Task Forwarded to You',
    body: `${forwarderName} forwarded: ${taskTitle}`,
    type: 'task_forwarded',
    sound: 'default',
    data: {
      taskId,
      action: requiresAcceptance ? 'accept_task' : 'open_task',
      requiresAcceptance,
    },
    category: requiresAcceptance ? 'TASK_ACCEPT_ACTIONS' : 'TASK_ACTIONS',
  };
}

/**
 * Build notification for incoming call
 */
export function buildIncomingCallNotification(
  callerInfo: string,
  clinicName: string,
  callId: string
): PushNotificationPayload {
  return {
    title: 'Incoming Call',
    body: `${callerInfo} calling ${clinicName}`,
    type: 'incoming_call',
    // Use system default sound (iOS app does not bundle ringtone.caf).
    sound: 'default',
    data: {
      callId,
      action: 'answer_call',
      caller: callerInfo,
      clinic: clinicName,
    },
    category: 'CALL_ACTIONS',
  };
}

/**
 * Build notification for missed call
 */
export function buildMissedCallNotification(
  callerInfo: string,
  clinicName: string,
  callId: string,
  timestamp: string
): PushNotificationPayload {
  return {
    title: 'Missed Call',
    body: `${callerInfo} called ${clinicName}`,
    type: 'missed_call',
    sound: 'default',
    data: {
      callId,
      action: 'view_call_history',
      caller: callerInfo,
      clinic: clinicName,
      timestamp,
    },
  };
}

/**
 * Build notification for voicemail
 */
export function buildVoicemailNotification(
  callerInfo: string,
  durationSeconds: number,
  voicemailId: string,
  clinicName: string
): PushNotificationPayload {
  const durationStr = durationSeconds > 60
    ? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}`
    : `${durationSeconds}s`;

  return {
    title: 'New Voicemail',
    body: `${callerInfo} left a ${durationStr} voicemail for ${clinicName}`,
    type: 'voicemail',
    sound: 'default',
    data: {
      voicemailId,
      action: 'play_voicemail',
      duration: durationSeconds,
      caller: callerInfo,
    },
  };
}

/**
 * Build notification for meeting scheduled
 */
export function buildMeetingScheduledNotification(
  meetingTitle: string,
  organizerName: string,
  startTime: string,
  meetingId: string
): PushNotificationPayload {
  const date = new Date(startTime);
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return {
    title: `Meeting: ${meetingTitle}`,
    body: `${organizerName} scheduled for ${dateStr} at ${timeStr}`,
    type: 'meeting_scheduled',
    sound: 'default',
    data: {
      meetingId,
      action: 'open_meeting',
      startTime,
    },
  };
}

/**
 * Build notification for queue position update
 */
export function buildQueueUpdateNotification(
  queuePosition: number,
  estimatedWaitMinutes?: number,
  clinicName?: string
): PushNotificationPayload {
  const waitText = estimatedWaitMinutes
    ? `Estimated wait: ${estimatedWaitMinutes} minutes`
    : '';

  return {
    title: 'Queue Update',
    body: `You are #${queuePosition} in queue${clinicName ? ` for ${clinicName}` : ''}. ${waitText}`,
    type: 'queue_update',
    sound: 'default',
    data: {
      queuePosition,
      estimatedWaitMinutes,
    },
  };
}

/**
 * Push Notification Utilities for Chime Call Center
 * 
 * Provides push notification integration for call events:
 * - Incoming call notifications to available agents
 * - Missed call notifications
 * - Voicemail notifications
 * - Queue position updates
 * 
 * Uses the PushNotificationsStack's send-push Lambda for cross-stack invocation.
 * 
 * Robustness Features:
 * - Synchronous invocation for critical call notifications
 * - Retry mechanism with exponential backoff
 * - Error tracking and detailed logging
 * - Idempotency keys to prevent duplicate notifications
 */

import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { CHIME_CONFIG } from '../config';

// Environment variables
const SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || '';
// Note: DEVICE_TOKENS_TABLE is handled internally by the send-push Lambda
// This utility only invokes the Lambda, so we only need the ARN
const PUSH_NOTIFICATIONS_ENABLED = !!SEND_PUSH_FUNCTION_ARN;

// Initialize clients (reused across invocations)
let lambdaClient: LambdaClient | null = null;
let cwClient: CloudWatchClient | null = null;

function getLambdaClient(): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return lambdaClient;
}

function getCloudWatchClient(): CloudWatchClient {
  if (!cwClient) {
    cwClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return cwClient;
}

// ========================================
// TYPES
// ========================================

export interface CallNotificationData {
  callId: string;
  clinicId: string;
  clinicName: string;
  callerPhoneNumber?: string;
  callerName?: string;
  timestamp: string;
}

export interface IncomingCallNotification extends CallNotificationData {
  queuePosition?: number;
  estimatedWaitMinutes?: number;
}

export interface MissedCallNotification extends CallNotificationData {
  reason?: 'no_agents' | 'timeout' | 'caller_hungup' | 'after_hours';
  callDuration?: number;
}

export interface VoicemailNotification extends CallNotificationData {
  voicemailId: string;
  durationSeconds: number;
  s3Key?: string;
}

export interface CallEndedNotification extends CallNotificationData {
  agentId: string;
  reason: string;
  message: string;
  direction?: string;
}

export interface CallAnsweredNotification extends CallNotificationData {
  agentId: string;
  direction?: string;
  meetingId?: string;
}

export interface SendPushResult {
  success: boolean;
  sent?: number;
  failed?: number;
  error?: string;
}

// ========================================
// CORE PUSH NOTIFICATION FUNCTIONS
// ========================================

/**
 * Check if push notifications are enabled
 */
export function isPushNotificationsEnabled(): boolean {
  return PUSH_NOTIFICATIONS_ENABLED;
}

/**
 * Send push notification via the send-push Lambda
 * 
 * @param payload - The notification payload
 * @param options - Configuration options
 *   - sync: If true, wait for response (default: false for non-critical)
 *   - skipPreferenceCheck: If true, bypass user preferences (for critical notifications)
 */
async function invokeSendPushLambda(
  payload: any,
  options: { sync?: boolean; skipPreferenceCheck?: boolean } = {}
): Promise<SendPushResult> {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    console.log('[ChimePush] Push notifications not configured, skipping');
    return { success: false, error: 'Push notifications not configured' };
  }

  const { sync = false, skipPreferenceCheck = false } = options;

  try {
    const invocationType: InvocationType = sync ? 'RequestResponse' : 'Event';

    const response = await getLambdaClient().send(new InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify({
        _internalCall: true,
        skipPreferenceCheck,
        ...payload,
      }),
      InvocationType: invocationType,
    }));

    // For async invocations, we only get StatusCode
    if (!sync) {
      const success = response.StatusCode === 202 || response.StatusCode === 200;
      if (!success) {
        console.error(`[ChimePush] Async Lambda invocation failed, StatusCode: ${response.StatusCode}`);
      } else {
        console.log(`[ChimePush] Async Lambda invoked, StatusCode: ${response.StatusCode}`);
      }
      return { success };
    }

    // For sync invocations, parse the response
    if (response.Payload) {
      const payloadStr = new TextDecoder().decode(response.Payload);
      const result = JSON.parse(payloadStr);

      // Handle Lambda function errors
      if (response.FunctionError) {
        console.error('[ChimePush] Lambda function error:', result);
        return {
          success: false,
          error: result.errorMessage || 'Lambda function error',
        };
      }

      // Parse the response body
      if (result.statusCode && result.body) {
        const body = JSON.parse(result.body);
        return {
          success: result.statusCode === 200,
          sent: body.sent,
          failed: body.failed,
          error: body.error,
        };
      }

      return { success: true, ...result };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[ChimePush] Failed to invoke send-push Lambda:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send push notification with retry capability
 */
async function invokeSendPushLambdaWithRetry(
  payload: any,
  options: { sync?: boolean; skipPreferenceCheck?: boolean; maxRetries?: number } = {}
): Promise<SendPushResult> {
  const { maxRetries = 2, ...invokeOptions } = options;

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await invokeSendPushLambda(payload, invokeOptions);

    if (result.success) {
      return result;
    }

    lastError = result.error;

    // Don't retry for certain errors
    if (result.error?.includes('not configured') ||
      result.error?.includes('Invalid') ||
      result.error?.includes('Unauthorized')) {
      break;
    }

    if (attempt < maxRetries) {
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      console.log(`[ChimePush] Retrying push notification (attempt ${attempt + 2})`);
    }
  }

  return { success: false, error: lastError || 'Max retries exceeded' };
}

// ========================================
// CLOUDWATCH DELIVERY METRICS
// ========================================

/**
 * Emit push notification delivery metrics to CloudWatch.
 * Best-effort — failures are logged but never propagated.
 */
async function emitPushMetric(
  metricName: 'PushDelivered' | 'PushFailed',
  dimensions: { notificationType: string },
  value: number = 1
): Promise<void> {
  if (!CHIME_CONFIG.METRICS.ENABLED) return;
  try {
    await getCloudWatchClient().send(new PutMetricDataCommand({
      Namespace: CHIME_CONFIG.METRICS.NAMESPACE,
      MetricData: [{
        MetricName: metricName,
        Dimensions: [
          { Name: 'NotificationType', Value: dimensions.notificationType },
        ],
        Value: value,
        Unit: 'Count',
        Timestamp: new Date(),
      }],
    }));
  } catch (err: any) {
    console.warn(`[ChimePush] Failed to emit ${metricName} metric:`, err.message);
  }
}

/**
 * Format phone number for display
 */
function formatPhoneNumber(phone: string): string {
  if (!phone) return 'Unknown';

  // Remove +1 prefix if present
  const cleaned = phone.replace(/^\+1/, '').replace(/\D/g, '');

  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }

  return phone;
}

/**
 * Get caller display string
 */
function getCallerDisplay(data: CallNotificationData): string {
  if (data.callerName && data.callerName !== 'Unknown') {
    return data.callerName;
  }
  return formatPhoneNumber(data.callerPhoneNumber || 'Unknown caller');
}

// ========================================
// INCOMING CALL NOTIFICATIONS
// ========================================

/**
 * Send incoming call push notification to available agents in a clinic
 * Uses SYNCHRONOUS invocation to ensure delivery confirmation
 *
 * @param ddb - DynamoDB Document Client for querying available agents
 * @param agentPresenceTableName - Name of the agent presence table
 * @param notification - Call notification data
 */
export async function sendIncomingCallNotification(
  ddb: DynamoDBDocumentClient,
  agentPresenceTableName: string,
  notification: IncomingCallNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED) return;

  try {
    // Query available agents for this clinic
    const { Items: agents } = await ddb.send(new QueryCommand({
      TableName: agentPresenceTableName,
      IndexName: 'clinicId-status-index',
      KeyConditionExpression: 'clinicId = :clinicId AND #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':clinicId': notification.clinicId,
        ':status': 'available',
      },
    }));

    if (!agents || agents.length === 0) {
      console.log(`[ChimePush] No available agents to notify for clinic ${notification.clinicId}`);
      return;
    }

    const agentUserIds = agents.map(a => a.agentId);
    const callerDisplay = getCallerDisplay(notification);

    const queueInfo = notification.queuePosition
      ? ` (Queue #${notification.queuePosition})`
      : '';

    // Use idempotency key to prevent duplicate notifications
    const idempotencyKey = `incoming_call:${notification.callId}:${notification.timestamp}`;

    const result = await invokeSendPushLambdaWithRetry({
      userIds: agentUserIds,
      notification: {
        title: 'Incoming Call',
        body: `${callerDisplay} calling ${notification.clinicName}${queueInfo}`,
        type: 'incoming_call',
        // Use system default sound across platforms (iOS app does not bundle ringtone.caf).
        sound: 'default',
        idempotencyKey,
        data: {
          callId: notification.callId,
          clinicId: notification.clinicId,
          clinicName: notification.clinicName,
          callerPhoneNumber: notification.callerPhoneNumber,
          callerName: notification.callerName,
          queuePosition: notification.queuePosition,
          action: 'answer_call',
          timestamp: notification.timestamp,
        },
        category: 'INCOMING_CALL',
      },
    }, {
      sync: true,  // Critical notification - wait for confirmation
      skipPreferenceCheck: true,  // Always deliver incoming calls
      maxRetries: 2,
    });

    if (result.success) {
      console.log(`[ChimePush] Sent incoming call notification to ${agentUserIds.length} agents (${result.sent} delivered)`);
      emitPushMetric('PushDelivered', { notificationType: 'incoming_call' }, result.sent || agentUserIds.length);
    } else {
      console.error(`[ChimePush] Failed to send incoming call notification: ${result.error}`);
      emitPushMetric('PushFailed', { notificationType: 'incoming_call' });
    }
  } catch (error: any) {
    console.error('[ChimePush] Failed to send incoming call notification:', error.message);
    emitPushMetric('PushFailed', { notificationType: 'incoming_call' });
  }
}

/**
 * Send incoming call notification to specific agent user IDs
 */
export async function sendIncomingCallToAgents(
  agentUserIds: string[],
  notification: IncomingCallNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED || agentUserIds.length === 0) {
    console.log('[ChimePush] sendIncomingCallToAgents skipped', {
      pushEnabled: PUSH_NOTIFICATIONS_ENABLED,
      agentCount: agentUserIds.length,
      callId: notification.callId,
    });
    return;
  }

  console.log('[ChimePush] 📞 Sending incoming-call push notification', {
    callId: notification.callId,
    clinicId: notification.clinicId,
    clinicName: notification.clinicName,
    callerPhoneNumber: notification.callerPhoneNumber,
    targetAgentIds: agentUserIds,
    agentCount: agentUserIds.length,
    timestamp: notification.timestamp,
    sendPushArn: process.env.SEND_PUSH_FUNCTION_ARN?.substring(0, 60) + '...',
  });

  const callerDisplay = getCallerDisplay(notification);
  const idempotencyKey = `incoming_call:${notification.callId}:agents:${notification.timestamp}`;

  const result = await invokeSendPushLambdaWithRetry({
    userIds: agentUserIds,
    notification: {
      title: 'Incoming Call',
      body: `${callerDisplay} calling ${notification.clinicName}`,
      type: 'incoming_call',
      // Use system default sound across platforms (iOS app does not bundle ringtone.caf).
      sound: 'default',
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        action: 'answer_call',
        timestamp: notification.timestamp,
      },
      category: 'INCOMING_CALL',
    },
  }, {
    sync: true,
    skipPreferenceCheck: true,
    maxRetries: 2,
  });

  if (result.success) {
    console.log(`[ChimePush] ✅ Incoming call push delivered`, {
      callId: notification.callId,
      agentCount: agentUserIds.length,
      agents: agentUserIds,
      response: `sent=${result.sent ?? '?'}, failed=${result.failed ?? '?'}`,
    });
    emitPushMetric('PushDelivered', { notificationType: 'incoming_call' }, result.sent || agentUserIds.length);
  } else {
    console.error(`[ChimePush] ❌ Failed to push incoming call notification`, {
      callId: notification.callId,
      error: result.error,
      agents: agentUserIds,
      clinicId: notification.clinicId,
    });
    emitPushMetric('PushFailed', { notificationType: 'incoming_call' });
  }
}

// ========================================
// CALL CANCELLED NOTIFICATIONS (Batch)
// ========================================

/**
 * Send call_cancelled push to all agents who were ringing for a call,
 * EXCEPT the agent who accepted it. This stops phantom ringing on
 * other agents' devices.
 *
 * Sent as data-only (silent) so background handlers fire without
 * showing a visible notification banner.
 */
export async function sendCallCancelledToAgents(
  agentUserIds: string[],
  excludeAgentId: string,
  notification: CallNotificationData
): Promise<void> {
  const targetIds = agentUserIds.filter(id => id !== excludeAgentId);
  if (!PUSH_NOTIFICATIONS_ENABLED || targetIds.length === 0) return;

  const idempotencyKey = `call_cancelled:${notification.callId}:${notification.timestamp}`;

  console.log('[ChimePush] 🔕 Sending call_cancelled push to stop ringing', {
    callId: notification.callId,
    excludedAgent: excludeAgentId,
    targetAgentCount: targetIds.length,
    targetAgents: targetIds,
  });

  const result = await invokeSendPushLambdaWithRetry({
    userIds: targetIds,
    notification: {
      // Data-only (silent push) — no title/body to avoid banner spam
      type: 'call_cancelled',
      contentAvailable: true,
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        reason: 'accepted_by_other_agent',
        acceptedBy: excludeAgentId,
        action: 'call_cancelled',
        timestamp: notification.timestamp,
      },
      category: 'CALL_CANCELLED',
    },
  }, {
    sync: false,
    skipPreferenceCheck: true,
    maxRetries: 1,
  });

  if (result.success) {
    console.log(`[ChimePush] ✅ Call cancelled push sent to ${targetIds.length} agents`);
    emitPushMetric('PushDelivered', { notificationType: 'call_cancelled' }, targetIds.length);
  } else {
    console.error(`[ChimePush] ❌ Failed to send call_cancelled push:`, result.error);
    emitPushMetric('PushFailed', { notificationType: 'call_cancelled' });
  }
}

// ========================================
// MISSED CALL NOTIFICATIONS
// ========================================

/**
 * Send missed call notification to clinic supervisors/managers
 *
 * @param notification - Missed call data
 */
export async function sendMissedCallNotification(
  notification: MissedCallNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED) return;

  const callerDisplay = getCallerDisplay(notification);

  let reasonText = '';
  switch (notification.reason) {
    case 'no_agents':
      reasonText = ' (no agents available)';
      break;
    case 'timeout':
      reasonText = ' (call timed out)';
      break;
    case 'after_hours':
      reasonText = ' (after hours)';
      break;
    default:
      reasonText = '';
  }

  const result = await invokeSendPushLambda({
    clinicId: notification.clinicId,
    notification: {
      title: 'Missed Call',
      body: `${callerDisplay} called ${notification.clinicName}${reasonText}`,
      type: 'missed_call',
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        callerName: notification.callerName,
        reason: notification.reason,
        callDuration: notification.callDuration,
        action: 'view_missed_calls',
        timestamp: notification.timestamp,
      },
    },
  });

  if (result.success) {
    console.log(`[ChimePush] Sent missed call notification for clinic ${notification.clinicId}`);
  }
}

/**
 * Send missed call notification to specific user IDs (e.g., supervisors)
 */
export async function sendMissedCallToUsers(
  userIds: string[],
  notification: MissedCallNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED || userIds.length === 0) return;

  const callerDisplay = getCallerDisplay(notification);

  const result = await invokeSendPushLambda({
    userIds,
    notification: {
      title: 'Missed Call',
      body: `${callerDisplay} called ${notification.clinicName}`,
      type: 'missed_call',
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        callerPhoneNumber: notification.callerPhoneNumber,
        action: 'view_call_history',
        timestamp: notification.timestamp,
      },
    },
  });

  if (result.success) {
    console.log(`[ChimePush] Sent missed call notification to ${userIds.length} users`);
  }
}

// ========================================
// VOICEMAIL NOTIFICATIONS
// ========================================

/**
 * Send voicemail notification to clinic staff
 */
export async function sendVoicemailNotification(
  notification: VoicemailNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED) return;

  const callerDisplay = getCallerDisplay(notification);
  const durationStr = notification.durationSeconds > 60
    ? `${Math.floor(notification.durationSeconds / 60)}:${String(notification.durationSeconds % 60).padStart(2, '0')}`
    : `${notification.durationSeconds}s`;

  const result = await invokeSendPushLambda({
    clinicId: notification.clinicId,
    notification: {
      title: 'New Voicemail',
      body: `${callerDisplay} left a ${durationStr} voicemail`,
      type: 'voicemail',
      data: {
        voicemailId: notification.voicemailId,
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        callerName: notification.callerName,
        duration: notification.durationSeconds,
        s3Key: notification.s3Key,
        action: 'play_voicemail',
        timestamp: notification.timestamp,
      },
    },
  });

  if (result.success) {
    console.log(`[ChimePush] Sent voicemail notification for clinic ${notification.clinicId}`);
  }
}

/**
 * Send voicemail notification to specific users
 */
export async function sendVoicemailToUsers(
  userIds: string[],
  notification: VoicemailNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED || userIds.length === 0) return;

  const callerDisplay = getCallerDisplay(notification);
  const durationStr = notification.durationSeconds > 60
    ? `${Math.floor(notification.durationSeconds / 60)}:${String(notification.durationSeconds % 60).padStart(2, '0')}`
    : `${notification.durationSeconds}s`;

  const result = await invokeSendPushLambda({
    userIds,
    notification: {
      title: 'New Voicemail',
      body: `${callerDisplay} left a ${durationStr} voicemail for ${notification.clinicName}`,
      type: 'voicemail',
      data: {
        voicemailId: notification.voicemailId,
        callId: notification.callId,
        clinicId: notification.clinicId,
        duration: notification.durationSeconds,
        action: 'play_voicemail',
        timestamp: notification.timestamp,
      },
    },
  });

  if (result.success) {
    console.log(`[ChimePush] Sent voicemail notification to ${userIds.length} users`);
  }
}

// ========================================
// QUEUE POSITION NOTIFICATIONS
// ========================================

/**
 * Send queue position update to caller (if registered as user)
 */
export async function sendQueuePositionUpdate(
  userId: string,
  queuePosition: number,
  estimatedWaitMinutes?: number,
  clinicName?: string
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED) return;

  const waitText = estimatedWaitMinutes
    ? `. Estimated wait: ${estimatedWaitMinutes} min`
    : '';

  const result = await invokeSendPushLambda({
    userId,
    notification: {
      title: 'Queue Update',
      body: `You are #${queuePosition} in queue${clinicName ? ` for ${clinicName}` : ''}${waitText}`,
      type: 'queue_update',
      data: {
        queuePosition,
        estimatedWaitMinutes,
        clinicName,
        action: 'view_queue_status',
        timestamp: new Date().toISOString(),
      },
    },
  });

  if (result.success) {
    console.log(`[ChimePush] Sent queue position update to user ${userId}: #${queuePosition}`);
  }
}

// ========================================
// AGENT ALERT NOTIFICATIONS
// ========================================

/**
 * Send alert to agents (e.g., queue backup, long wait times)
 */
export async function sendAgentAlert(
  agentUserIds: string[],
  title: string,
  message: string,
  alertData?: Record<string, any>
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED || agentUserIds.length === 0) return;

  const result = await invokeSendPushLambda({
    userIds: agentUserIds,
    notification: {
      title,
      body: message,
      type: 'staff_alert',
      data: {
        ...alertData,
        action: 'view_queue',
        timestamp: new Date().toISOString(),
      },
    },
  });

  if (result.success) {
    console.log(`[ChimePush] Sent agent alert to ${agentUserIds.length} agents: ${title}`);
  }
}

/**
 * Send high-priority alert to clinic (all staff)
 */
export async function sendClinicAlert(
  clinicId: string,
  title: string,
  message: string,
  alertData?: Record<string, any>
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED) return;

  const result = await invokeSendPushLambda({
    clinicId,
    notification: {
      title,
      body: message,
      type: 'staff_alert',
      sound: 'alert.caf',
      data: {
        clinicId,
        ...alertData,
        action: 'view_dashboard',
        timestamp: new Date().toISOString(),
      },
    },
  });

  if (result.success) {
    console.log(`[ChimePush] Sent clinic alert for ${clinicId}: ${title}`);
  }
}

/**
 * Send notification with full result details
 * Returns detailed information about delivery success/failure
 */
export async function sendNotificationWithDetails(
  target: { userId?: string; userIds?: string[]; clinicId?: string },
  notification: {
    title: string;
    body: string;
    type?: string;
    data?: Record<string, any>;
    sound?: string;
    idempotencyKey?: string;
  },
  options: { sync?: boolean; skipPreferenceCheck?: boolean } = {}
): Promise<SendPushResult> {
  return invokeSendPushLambda({
    ...target,
    notification,
  }, { ...options, sync: true });
}

// ========================================
// CALL ENDED NOTIFICATIONS
// ========================================

/**
 * Send call-ended push notification to the assigned agent.
 *
 * This enables a polling-free architecture: the mobile/web clients no longer
 * need to poll /admin/me/presence every N seconds. Instead, the backend pushes
 * call state transitions (incoming, ended, cancelled) via FCM.
 *
 * The notification is sent as data-only so that on Android the custom
 * `onMessageReceived()` handler fires even when the app is in the background.
 */
export async function sendCallEndedToAgent(
  notification: CallEndedNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED) return;

  const callerDisplay = getCallerDisplay(notification);
  const notificationType = notification.reason === 'cancelled' ? 'call_cancelled' : 'call_ended';
  const idempotencyKey = `${notificationType}:${notification.callId}:${notification.agentId}:${notification.timestamp}`;

  console.log(`[ChimePush] 📴 Sending ${notificationType} push to agent ${notification.agentId}`, {
    callId: notification.callId,
    reason: notification.reason,
    direction: notification.direction,
  });

  const result = await invokeSendPushLambdaWithRetry({
    userId: notification.agentId,
    notification: {
      // Data-only (silent push) for state-sync — no visible banner
      type: notificationType,
      contentAvailable: true,
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        reason: notification.reason,
        message: notification.message,
        direction: notification.direction || 'inbound',
        action: 'call_ended',
        timestamp: notification.timestamp,
      },
      category: 'CALL_ENDED',
    },
  }, {
    sync: false,            // fire-and-forget (best-effort)
    skipPreferenceCheck: true,
    maxRetries: 1,
  });

  if (result.success) {
    console.log(`[ChimePush] ✅ Call-ended push sent to agent ${notification.agentId}`);
    emitPushMetric('PushDelivered', { notificationType });
  } else {
    console.error(`[ChimePush] ❌ Failed to send call-ended push to agent ${notification.agentId}:`, result.error);
    emitPushMetric('PushFailed', { notificationType });
  }
}

// ========================================
// CALL ANSWERED NOTIFICATIONS
// ========================================

/**
 * Send call-answered push notification to the assigned agent.
 *
 * When a customer answers an outbound call, this push tells the mobile app
 * to transition from the "Dialing..." overlay to the active "In Call" UI.
 * Without this, the app stays stuck on "Dialing..." indefinitely because
 * the push-first architecture has no other signal for this state change.
 *
 * Sent as data-only so Android/iOS background handlers fire correctly.
 */
export async function sendCallAnsweredToAgent(
  notification: CallAnsweredNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED) return;

  const callerDisplay = getCallerDisplay(notification);
  const idempotencyKey = `call_answered:${notification.callId}:${notification.agentId}:${notification.timestamp}`;

  console.log(`[ChimePush] 📞 Sending call_answered push to agent ${notification.agentId}`, {
    callId: notification.callId,
    direction: notification.direction,
  });

  const result = await invokeSendPushLambdaWithRetry({
    userId: notification.agentId,
    notification: {
      // Data-only (silent push) for state-sync — no visible banner
      type: 'call_answered',
      contentAvailable: true,
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        callerName: notification.callerName,
        direction: notification.direction || 'outbound',
        meetingId: notification.meetingId || '',
        action: 'call_answered',
        timestamp: notification.timestamp,
      },
      category: 'CALL_ANSWERED',
    },
  }, {
    sync: false,
    skipPreferenceCheck: true,
    maxRetries: 1,
  });

  if (result.success) {
    console.log(`[ChimePush] ✅ Call-answered push sent to agent ${notification.agentId}`);
    emitPushMetric('PushDelivered', { notificationType: 'call_answered' });
  } else {
    console.error(`[ChimePush] ❌ Failed to send call-answered push to agent ${notification.agentId}:`, result.error);
    emitPushMetric('PushFailed', { notificationType: 'call_answered' });
  }
}

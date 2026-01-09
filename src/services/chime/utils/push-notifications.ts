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
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

// Environment variables
const SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || '';
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';
const PUSH_NOTIFICATIONS_ENABLED = !!(SEND_PUSH_FUNCTION_ARN && DEVICE_TOKENS_TABLE);

// Initialize Lambda client (reused across invocations)
let lambdaClient: LambdaClient | null = null;

function getLambdaClient(): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return lambdaClient;
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
 */
async function invokeSendPushLambda(payload: any): Promise<boolean> {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    console.log('[ChimePush] Push notifications not configured, skipping');
    return false;
  }

  try {
    const response = await getLambdaClient().send(new InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify({
        _internalCall: true,
        ...payload,
      }),
      InvocationType: 'Event', // Async - don't wait for response
    }));

    console.log(`[ChimePush] Lambda invoked, StatusCode: ${response.StatusCode}`);
    return response.StatusCode === 202 || response.StatusCode === 200;
  } catch (error: any) {
    console.error('[ChimePush] Failed to invoke send-push Lambda:', error.message);
    return false;
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

    await invokeSendPushLambda({
      userIds: agentUserIds,
      notification: {
        title: 'Incoming Call',
        body: `${callerDisplay} calling ${notification.clinicName}${queueInfo}`,
        type: 'incoming_call',
        sound: 'ringtone.caf', // Custom iOS ringtone
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
    });

    console.log(`[ChimePush] Sent incoming call notification to ${agentUserIds.length} agents`);
  } catch (error: any) {
    console.error('[ChimePush] Failed to send incoming call notification:', error.message);
  }
}

/**
 * Send incoming call notification to specific agent user IDs
 */
export async function sendIncomingCallToAgents(
  agentUserIds: string[],
  notification: IncomingCallNotification
): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED || agentUserIds.length === 0) return;

  const callerDisplay = getCallerDisplay(notification);

  await invokeSendPushLambda({
    userIds: agentUserIds,
    notification: {
      title: 'Incoming Call',
      body: `${callerDisplay} calling ${notification.clinicName}`,
      type: 'incoming_call',
      sound: 'ringtone.caf',
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
  });

  console.log(`[ChimePush] Sent incoming call notification to ${agentUserIds.length} agents`);
}

// ========================================
// MISSED CALL NOTIFICATIONS
// ========================================

/**
 * Send missed call notification to clinic supervisors/managers
 * 
 * @param clinicId - Clinic ID to notify
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

  await invokeSendPushLambda({
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

  console.log(`[ChimePush] Sent missed call notification for clinic ${notification.clinicId}`);
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

  await invokeSendPushLambda({
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

  console.log(`[ChimePush] Sent missed call notification to ${userIds.length} users`);
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

  await invokeSendPushLambda({
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

  console.log(`[ChimePush] Sent voicemail notification for clinic ${notification.clinicId}`);
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

  await invokeSendPushLambda({
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

  console.log(`[ChimePush] Sent voicemail notification to ${userIds.length} users`);
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

  await invokeSendPushLambda({
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

  console.log(`[ChimePush] Sent queue position update to user ${userId}: #${queuePosition}`);
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

  await invokeSendPushLambda({
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

  console.log(`[ChimePush] Sent agent alert to ${agentUserIds.length} agents: ${title}`);
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

  await invokeSendPushLambda({
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

  console.log(`[ChimePush] Sent clinic alert for ${clinicId}: ${title}`);
}

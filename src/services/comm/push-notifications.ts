/**
 * Push Notification Utilities for Communications Stack
 * 
 * Provides unified push notification integration via shared PushNotificationsStack.
 * Uses SNS Platform Applications for both iOS (APNs) and Android (FCM).
 * 
 * This is the UNIFIED approach - both Comm and Chime stacks use this pattern.
 * 
 * Used for:
 * - Incoming call notifications (high priority)
 * - Missed call notifications
 * - New message notifications (when user is offline)
 * - Mention notifications
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

// Environment variables (set by CommStack)
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

export interface PushNotificationPayload {
    title: string;
    body: string;
    type?: string;
    data?: Record<string, any>;
    badge?: number;
    sound?: string;
    priority?: 'high' | 'normal';
}

export interface IncomingCallPushPayload {
    callID: string;
    callerID: string;
    callerName: string;
    callType: 'voice' | 'video';
    favorRequestID: string;
    meetingId?: string;
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
 * Send push notification via the shared send-push Lambda (SNS-based)
 */
async function invokeSendPushLambda(payload: any): Promise<boolean> {
    if (!PUSH_NOTIFICATIONS_ENABLED) {
        console.log('[CommPush] Push notifications not configured, skipping');
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

        console.log(`[CommPush] Lambda invoked, StatusCode: ${response.StatusCode}`);
        return response.StatusCode === 202 || response.StatusCode === 200;
    } catch (error: any) {
        console.error('[CommPush] Failed to invoke send-push Lambda:', error.message);
        return false;
    }
}

// ========================================
// SPECIALIZED NOTIFICATIONS
// ========================================

/**
 * Send incoming call notification with high priority
 * Used when initiating a voice/video call
 */
export async function sendIncomingCallNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    callPayload: IncomingCallPushPayload
): Promise<boolean> {
    const callTypeEmoji = callPayload.callType === 'video' ? '📹' : '📞';

    return invokeSendPushLambda({
        userId: recipientUserID,
        notification: {
            title: `${callTypeEmoji} Incoming ${callPayload.callType} call`,
            body: `${callPayload.callerName} is calling you`,
            type: 'incoming_call',
            sound: 'ringtone.mp3',
            data: {
                type: 'incoming_call',
                callID: callPayload.callID,
                callerID: callPayload.callerID,
                callerName: callPayload.callerName,
                callType: callPayload.callType,
                favorRequestID: callPayload.favorRequestID,
                meetingId: callPayload.meetingId || '',
            },
        },
    });
}

/**
 * Send missed call notification
 * Used when a call is declined or goes unanswered
 */
export async function sendMissedCallNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    callerName: string,
    callType: 'voice' | 'video'
): Promise<boolean> {
    const callTypeEmoji = callType === 'video' ? '📹' : '📞';

    return invokeSendPushLambda({
        userId: recipientUserID,
        notification: {
            title: `${callTypeEmoji} Missed ${callType} call`,
            body: `You missed a call from ${callerName}`,
            type: 'missed_call',
            data: {
                type: 'missed_call',
                callerName,
                callType,
            },
        },
    });
}

/**
 * Send new message notification
 * Used when a user receives a message while offline
 */
export async function sendNewMessageNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    senderName: string,
    messagePreview: string,
    favorRequestID: string,
    conversationTitle?: string
): Promise<boolean> {
    return invokeSendPushLambda({
        userId: recipientUserID,
        notification: {
            title: conversationTitle || senderName,
            body: conversationTitle ? `${senderName}: ${messagePreview}` : messagePreview,
            type: 'new_message',
            data: {
                type: 'new_message',
                favorRequestID,
                senderName,
            },
        },
    });
}

/**
 * Send mention notification
 * Used when a user is @mentioned in a conversation
 */
export async function sendMentionNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    mentionedBy: string,
    messagePreview: string,
    favorRequestID: string
): Promise<boolean> {
    return invokeSendPushLambda({
        userId: recipientUserID,
        notification: {
            title: `@${mentionedBy} mentioned you`,
            body: messagePreview,
            type: 'mention',
            data: {
                type: 'mention',
                favorRequestID,
                mentionedBy,
            },
        },
    });
}

/**
 * Send notification to multiple users
 * Used for group notifications (e.g., broadcasting to all participants)
 */
export async function sendNotificationToUsers(
    ddb: DynamoDBDocumentClient,
    userIds: string[],
    notification: PushNotificationPayload
): Promise<boolean> {
    return invokeSendPushLambda({
        userIds,
        notification,
    });
}

/**
 * Send notification to all users in a clinic
 */
export async function sendNotificationToClinic(
    ddb: DynamoDBDocumentClient,
    clinicId: string,
    notification: PushNotificationPayload
): Promise<boolean> {
    return invokeSendPushLambda({
        clinicId,
        notification,
    });
}

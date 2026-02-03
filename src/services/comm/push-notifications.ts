/**
 * Push Notification Utilities for Communications Stack
 * 
 * Provides unified push notification integration via shared PushNotificationsStack.
 * Uses Firebase Cloud Messaging (FCM) HTTP v1 API for delivery.
 * 
 * This is the UNIFIED approach - both Comm and Chime stacks use this pattern.
 * 
 * Used for:
 * - Incoming call notifications (high priority)
 * - Missed call notifications
 * - New message notifications (when user is offline)
 * - Mention notifications
 * 
 * Robustness Features:
 * - Synchronous invocation option for critical notifications
 * - Error tracking and logging for async invocations
 * - Retry capability for failed sends
 */

import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
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
    idempotencyKey?: string;  // For deduplication
}

export interface IncomingCallPushPayload {
    callID: string;
    callerID: string;
    callerName: string;
    callType: 'voice' | 'video';
    favorRequestID: string;
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
 * Send push notification via the shared send-push Lambda
 * 
 * @param payload - The notification payload
 * @param options - Optional configuration
 *   - sync: If true, wait for response (slower but confirms delivery)
 *   - skipPreferenceCheck: If true, bypass user unsubscribe preferences
 */
async function invokeSendPushLambda(
    payload: any,
    options: { sync?: boolean; skipPreferenceCheck?: boolean } = {}
): Promise<SendPushResult> {
    if (!PUSH_NOTIFICATIONS_ENABLED) {
        console.log('[CommPush] Push notifications not configured, skipping');
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
                console.error(`[CommPush] Async Lambda invocation failed, StatusCode: ${response.StatusCode}`);
            } else {
                console.log(`[CommPush] Async Lambda invoked successfully, StatusCode: ${response.StatusCode}`);
            }
            return { success };
        }

        // For sync invocations, parse the response
        if (response.Payload) {
            const payloadStr = new TextDecoder().decode(response.Payload);
            const result = JSON.parse(payloadStr);

            // Handle Lambda function errors
            if (response.FunctionError) {
                console.error('[CommPush] Lambda function error:', result);
                return {
                    success: false,
                    error: result.errorMessage || 'Lambda function error'
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
        console.error('[CommPush] Failed to invoke send-push Lambda:', error.message);
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
            console.log(`[CommPush] Retrying push notification (attempt ${attempt + 2})`);
        }
    }

    return { success: false, error: lastError || 'Max retries exceeded' };
}

// ========================================
// SPECIALIZED NOTIFICATIONS
// ========================================

/**
 * Send incoming call notification with high priority
 * Used when initiating a voice/video call
 * 
 * Uses SYNCHRONOUS invocation for critical delivery confirmation
 */
export async function sendIncomingCallNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    callPayload: IncomingCallPushPayload
): Promise<boolean> {
    const callTypeEmoji = callPayload.callType === 'video' ? '📹' : '📞';
    const idempotencyKey = `call:${callPayload.callID}:${callPayload.callerID}`;

    const result = await invokeSendPushLambdaWithRetry({
        userId: recipientUserID,
        notification: {
            title: `${callTypeEmoji} Incoming ${callPayload.callType} call`,
            body: `${callPayload.callerName} is calling you`,
            type: 'incoming_call',
            sound: 'ringtone.mp3',
            idempotencyKey,
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
    }, {
        sync: true,  // Synchronous for critical notifications
        skipPreferenceCheck: true,  // Always deliver incoming calls
        maxRetries: 2,
    });

    if (!result.success) {
        console.error(`[CommPush] Failed to send incoming call notification: ${result.error}`);
    }

    return result.success;
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

    const result = await invokeSendPushLambda({
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

    return result.success;
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
    const result = await invokeSendPushLambda({
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

    return result.success;
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
    const result = await invokeSendPushLambda({
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

    return result.success;
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
    if (userIds.length === 0) {
        console.log('[CommPush] No users to notify');
        return true;
    }

    const result = await invokeSendPushLambda({
        userIds,
        notification,
    });

    return result.success;
}

/**
 * Send notification to all users in a clinic
 */
export async function sendNotificationToClinic(
    ddb: DynamoDBDocumentClient,
    clinicId: string,
    notification: PushNotificationPayload
): Promise<boolean> {
    const result = await invokeSendPushLambda({
        clinicId,
        notification,
    });

    return result.success;
}

/**
 * Send notification with full result details
 * Returns detailed information about delivery success/failure
 */
export async function sendNotificationWithDetails(
    target: { userId?: string; userIds?: string[]; clinicId?: string },
    notification: PushNotificationPayload,
    options: { sync?: boolean; skipPreferenceCheck?: boolean } = {}
): Promise<SendPushResult> {
    return invokeSendPushLambda({
        ...target,
        notification,
    }, { ...options, sync: true });
}

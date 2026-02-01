/**
 * FCM Push Notification Manager
 * =============================
 * Handles Firebase Cloud Messaging (FCM) for push notifications.
 * Used for:
 * - Incoming call notifications (high priority)
 * - New message notifications
 * - Mention notifications
 */

import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

// ========================================
// CONFIGURATION
// ========================================

const FCM_API_URL = 'https://fcm.googleapis.com/v1/projects';
const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID || '';
const FCM_SERVICE_ACCOUNT_KEY = process.env.FCM_SERVICE_ACCOUNT_KEY || ''; // JSON string

// Token table for storing device tokens
const FCM_TOKENS_TABLE = process.env.FCM_TOKENS_TABLE || '';

// ========================================
// TYPES
// ========================================

export interface FCMToken {
    userID: string;
    deviceToken: string;
    platform: 'android' | 'ios' | 'web';
    appVersion?: string;
    registeredAt: string;
    lastUsedAt: string;
}

export interface PushNotificationPayload {
    title: string;
    body: string;
    data?: Record<string, string>;
    priority?: 'high' | 'normal';
    sound?: string;
    badge?: number;
    channelId?: string; // Android notification channel
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
// FCM ACCESS TOKEN MANAGEMENT
// ========================================

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Get FCM access token using service account credentials
 */
async function getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
        return cachedAccessToken.token;
    }

    if (!FCM_SERVICE_ACCOUNT_KEY) {
        throw new Error('FCM_SERVICE_ACCOUNT_KEY not configured');
    }

    try {
        const serviceAccount = JSON.parse(FCM_SERVICE_ACCOUNT_KEY);

        // Create JWT for OAuth token request
        const header = Buffer.from(JSON.stringify({
            alg: 'RS256',
            typ: 'JWT',
        })).toString('base64url');

        const now = Math.floor(Date.now() / 1000);
        const claim = Buffer.from(JSON.stringify({
            iss: serviceAccount.client_email,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
        })).toString('base64url');

        // For production, use proper JWT signing with crypto
        // This is a simplified implementation - in production use google-auth-library
        const { createSign } = await import('crypto');
        const sign = createSign('RSA-SHA256');
        sign.update(`${header}.${claim}`);
        const signature = sign.sign(serviceAccount.private_key, 'base64url');

        const jwt = `${header}.${claim}.${signature}`;

        // Exchange JWT for access token
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
        });

        if (!response.ok) {
            throw new Error(`OAuth token request failed: ${response.status}`);
        }

        const data = await response.json() as { access_token: string; expires_in: number };

        cachedAccessToken = {
            token: data.access_token,
            expiresAt: Date.now() + (data.expires_in - 60) * 1000, // Refresh 1 min early
        };

        return cachedAccessToken.token;
    } catch (error) {
        console.error('[FCMManager] Error getting access token:', error);
        throw error;
    }
}

// ========================================
// TOKEN MANAGEMENT
// ========================================

/**
 * Register a device token for a user
 */
export async function registerDeviceToken(
    ddb: DynamoDBDocumentClient,
    userID: string,
    deviceToken: string,
    platform: 'android' | 'ios' | 'web',
    appVersion?: string
): Promise<void> {
    const now = new Date().toISOString();

    await ddb.send(new PutCommand({
        TableName: FCM_TOKENS_TABLE,
        Item: {
            userID,
            deviceToken,
            platform,
            appVersion,
            registeredAt: now,
            lastUsedAt: now,
        },
    }));

    console.log(`[FCMManager] Registered device token for user ${userID} (${platform})`);
}

/**
 * Get all device tokens for a user
 */
export async function getDeviceTokens(
    ddb: DynamoDBDocumentClient,
    userID: string
): Promise<FCMToken[]> {
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: FCM_TOKENS_TABLE,
            KeyConditionExpression: 'userID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
        }));

        return (result.Items || []) as FCMToken[];
    } catch (error) {
        console.error('[FCMManager] Error getting device tokens:', error);
        return [];
    }
}

/**
 * Remove a device token
 */
export async function removeDeviceToken(
    ddb: DynamoDBDocumentClient,
    userID: string,
    deviceToken: string
): Promise<void> {
    // Delete using composite key
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

    await ddb.send(new DeleteCommand({
        TableName: FCM_TOKENS_TABLE,
        Key: { userID, deviceToken },
    }));

    console.log(`[FCMManager] Removed device token for user ${userID}`);
}

// ========================================
// SEND NOTIFICATIONS
// ========================================

/**
 * Send push notification via FCM HTTP v1 API
 */
async function sendFCMMessage(
    deviceToken: string,
    platform: 'android' | 'ios' | 'web',
    payload: PushNotificationPayload
): Promise<boolean> {
    if (!FCM_PROJECT_ID) {
        console.warn('[FCMManager] FCM_PROJECT_ID not configured, skipping push');
        return false;
    }

    try {
        const accessToken = await getAccessToken();

        const message: any = {
            token: deviceToken,
            notification: {
                title: payload.title,
                body: payload.body,
            },
            data: payload.data || {},
        };

        // Platform-specific configuration
        if (platform === 'android') {
            message.android = {
                priority: payload.priority || 'high',
                notification: {
                    channelId: payload.channelId || 'default',
                    sound: payload.sound || 'default',
                    clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                },
            };
        } else if (platform === 'ios') {
            message.apns = {
                payload: {
                    aps: {
                        sound: payload.sound || 'default',
                        badge: payload.badge,
                        'mutable-content': 1,
                    },
                },
                headers: {
                    'apns-priority': payload.priority === 'high' ? '10' : '5',
                },
            };
        } else if (platform === 'web') {
            message.webpush = {
                notification: {
                    requireInteraction: payload.priority === 'high',
                },
            };
        }

        const response = await fetch(`${FCM_API_URL}/${FCM_PROJECT_ID}/messages:send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[FCMManager] FCM send failed: ${response.status}`, errorText);

            // Handle invalid token
            if (response.status === 404 || response.status === 410) {
                console.log('[FCMManager] Token is invalid, should be removed');
                return false;
            }

            return false;
        }

        console.log(`[FCMManager] Push notification sent successfully`);
        return true;

    } catch (error) {
        console.error('[FCMManager] Error sending push notification:', error);
        return false;
    }
}

/**
 * Send push notification to all devices for a user
 */
export async function sendPushToUser(
    ddb: DynamoDBDocumentClient,
    userID: string,
    payload: PushNotificationPayload
): Promise<{ sent: number; failed: number }> {
    const tokens = await getDeviceTokens(ddb, userID);

    if (tokens.length === 0) {
        console.log(`[FCMManager] No device tokens for user ${userID}`);
        return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const token of tokens) {
        const success = await sendFCMMessage(token.deviceToken, token.platform, payload);
        if (success) {
            sent++;
            // Update last used timestamp
            try {
                await ddb.send(new UpdateCommand({
                    TableName: FCM_TOKENS_TABLE,
                    Key: { userID, deviceToken: token.deviceToken },
                    UpdateExpression: 'SET lastUsedAt = :now',
                    ExpressionAttributeValues: { ':now': new Date().toISOString() },
                }));
            } catch (e) {
                // Ignore update errors
            }
        } else {
            failed++;
        }
    }

    return { sent, failed };
}

// ========================================
// SPECIALIZED NOTIFICATIONS
// ========================================

/**
 * Send incoming call notification with high priority
 */
export async function sendIncomingCallNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    callPayload: IncomingCallPushPayload
): Promise<boolean> {
    const callTypeEmoji = callPayload.callType === 'video' ? '📹' : '📞';

    const result = await sendPushToUser(ddb, recipientUserID, {
        title: `${callTypeEmoji} Incoming ${callPayload.callType} call`,
        body: `${callPayload.callerName} is calling you`,
        priority: 'high',
        sound: 'ringtone.mp3',
        channelId: 'incoming_calls', // Android high-importance channel
        data: {
            type: 'incoming_call',
            callID: callPayload.callID,
            callerID: callPayload.callerID,
            callerName: callPayload.callerName,
            callType: callPayload.callType,
            favorRequestID: callPayload.favorRequestID,
            meetingId: callPayload.meetingId || '',
        },
    });

    return result.sent > 0;
}

/**
 * Send new message notification
 */
export async function sendNewMessageNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    senderName: string,
    messagePreview: string,
    favorRequestID: string,
    conversationTitle?: string
): Promise<boolean> {
    const result = await sendPushToUser(ddb, recipientUserID, {
        title: conversationTitle || senderName,
        body: conversationTitle ? `${senderName}: ${messagePreview}` : messagePreview,
        priority: 'normal',
        channelId: 'messages',
        data: {
            type: 'new_message',
            favorRequestID,
            senderName,
        },
    });

    return result.sent > 0;
}

/**
 * Send mention notification
 */
export async function sendMentionNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    mentionedBy: string,
    messagePreview: string,
    favorRequestID: string
): Promise<boolean> {
    const result = await sendPushToUser(ddb, recipientUserID, {
        title: `@${mentionedBy} mentioned you`,
        body: messagePreview,
        priority: 'high',
        channelId: 'mentions',
        data: {
            type: 'mention',
            favorRequestID,
            mentionedBy,
        },
    });

    return result.sent > 0;
}

/**
 * Send missed call notification
 */
export async function sendMissedCallNotification(
    ddb: DynamoDBDocumentClient,
    recipientUserID: string,
    callerName: string,
    callType: 'voice' | 'video'
): Promise<boolean> {
    const callTypeEmoji = callType === 'video' ? '📹' : '📞';

    const result = await sendPushToUser(ddb, recipientUserID, {
        title: `${callTypeEmoji} Missed ${callType} call`,
        body: `You missed a call from ${callerName}`,
        priority: 'normal',
        channelId: 'missed_calls',
        data: {
            type: 'missed_call',
            callerName,
            callType,
        },
    });

    return result.sent > 0;
}

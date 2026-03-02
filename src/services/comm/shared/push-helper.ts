/**
 * Push Notification Helper
 *
 * Thin wrapper used by broadcast-service for offline user notifications.
 * Delegates to the push-notifications module.
 */

import { ddb, env } from './db-clients';
import { createLogger } from './logger';

const log = createLogger('push-helper');

/**
 * Sends push notifications to a user who has no active WebSocket connections.
 */
export async function sendPushNotificationsToOfflineUsers(
    userID: string,
    payload: object,
    senderID?: string,
): Promise<void> {
    if (!env.PUSH_NOTIFICATIONS_ENABLED) return;

    try {
        const { sendNewMessageNotification } = await import('../push-notifications');
        const msgPayload = payload as any;
        const message = msgPayload?.message;
        if (!message) return;

        const preview = message.content?.substring(0, 100) || 'New message';
        const senderName = senderID || message.senderID || 'Someone';

        await sendNewMessageNotification(
            ddb,
            userID,
            senderName,
            preview,
            message.favorRequestID || '',
        );
    } catch (e) {
        log.warn('Push notification send failed', { userID }, e as Error);
    }
}

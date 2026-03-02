/**
 * Broadcast Service
 *
 * Centralized WebSocket message sending and multi-device broadcast.
 * Extracted from ws-default.ts to eliminate duplication across handlers.
 */

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env } from './db-clients';
import { createLogger } from './logger';
import { getConnectionsByUserID, getConnectionRecordsByUserID, removeConnection } from './connection-service';

const log = createLogger('broadcast-service');

/**
 * Send a payload to a single WebSocket connection.
 * Silently handles GoneException (stale connection) by deleting the record.
 */
export async function sendToClient(
    apiGwManagement: ApiGatewayManagementApiClient,
    connectionId: string,
    payload: object,
): Promise<void> {
    try {
        await apiGwManagement.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify(payload)),
        }));
    } catch (error: any) {
        if (error.statusCode === 410 || error.$metadata?.httpStatusCode === 410) {
            log.debug('Stale connection detected, removing', { connectionId });
            await removeConnection(connectionId);
        } else {
            log.warn('Failed to send to connection', { connectionId }, error);
        }
    }
}

/**
 * Options for sendToAll.
 */
export interface SendToAllOptions {
    /** If true, trigger push notifications for offline users. Default false. */
    notifyOffline?: boolean;
    /** The senderID to exclude from push notifications (avoid self-notify). */
    senderID?: string;
}

/**
 * Broadcast a payload to all given user IDs across all their connected devices.
 * Handles stale connections, multi-device delivery, and optional push notifications.
 */
export async function sendToAll(
    apiGwManagement: ApiGatewayManagementApiClient,
    userIDs: string[],
    payload: object,
    options: SendToAllOptions = {},
): Promise<void> {
    const { notifyOffline = false, senderID } = options;
    const uniqueUsers = [...new Set(userIDs)];

    await Promise.all(uniqueUsers.map(async (userID) => {
        const connectionRecords = await getConnectionRecordsByUserID(userID);

        if (connectionRecords.length > 0) {
            await Promise.all(connectionRecords.map(conn =>
                sendToClient(apiGwManagement, conn.connectionId, payload),
            ));
        } else if (notifyOffline && userID !== senderID && env.PUSH_NOTIFICATIONS_ENABLED) {
            try {
                const { sendPushNotificationsToOfflineUsers } = await import('./push-helper');
                await sendPushNotificationsToOfflineUsers(userID, payload, senderID);
            } catch (e) {
                log.warn('Failed to send push notification', { userID }, e as Error);
            }
        }
    }));
}

/**
 * Broadcast a payload to all participants of a conversation.
 * Resolves participants from the FavorRequest record and optional team membership.
 */
export async function broadcastToConversation(
    apiGwManagement: ApiGatewayManagementApiClient,
    favorRequestID: string,
    payload: object,
    excludeUserID?: string,
): Promise<void> {
    const favorResult = await ddb.send(new GetCommand({
        TableName: env.FAVORS_TABLE,
        Key: { favorRequestID },
    }));

    const favor = favorResult.Item;
    if (!favor) return;

    const participants = new Set<string>();
    if (favor.senderID) participants.add(String(favor.senderID));
    if (favor.receiverID) participants.add(String(favor.receiverID));

    const teamID = favor.teamID as string | undefined;
    if (teamID && env.TEAMS_TABLE) {
        try {
            const teamResult = await ddb.send(new QueryCommand({
                TableName: env.TEAMS_TABLE,
                KeyConditionExpression: 'teamID = :tid',
                ExpressionAttributeValues: { ':tid': teamID },
                Limit: 1,
            }));
            const members = (teamResult.Items?.[0] as any)?.members;
            if (Array.isArray(members)) {
                for (const m of members) {
                    if (m) participants.add(String(m));
                }
            }
        } catch (e) {
            log.warn('Failed to load team members for broadcast', { teamID }, e as Error);
        }
    }

    const targets = [...participants].filter(uid => !(excludeUserID && uid === excludeUserID));
    await Promise.all(targets.map(async (userID) => {
        const connections = await getConnectionsByUserID(userID);
        await Promise.all(connections.map(conn =>
            sendToClient(apiGwManagement, conn.connectionId, payload),
        ));
    }));
}

/**
 * Messaging Features WebSocket Handlers
 * ======================================
 * Reactions, Threads, Edit/Delete, Typing, Presence,
 * Pins, Bookmarks, Search, Channels, Scheduled Messages
 */

import { GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { v4 as uuidv4 } from 'uuid';
import {
    ddb, env,
    sendToClient, broadcastToConversation, getConnectionIdForUser,
    batchGetConnectionIdForUsers,
    getSenderInfo as _getSenderInfo,
    batchGetConnectionsByUserIDs,
    createLogger,
} from './shared';
import type {
    MessageData, Mention, Reaction, PinnedMessage, Bookmark,
    UserPresence, ScheduledMessage, Channel,
} from './shared';

const log = createLogger('messaging-features');

const MESSAGES_TABLE = env.MESSAGES_TABLE;

/**
 * Look up a message by messageID using the MessageIDIndex GSI (O(1))
 * instead of scanning the entire conversation's messages.
 */
async function getMessageByID(messageID: string): Promise<MessageData | undefined> {
    const result = await ddb.send(new QueryCommand({
        TableName: MESSAGES_TABLE,
        IndexName: 'MessageIDIndex',
        KeyConditionExpression: 'messageID = :mid',
        ExpressionAttributeValues: { ':mid': messageID },
        Limit: 1,
    }));
    return result.Items?.[0] as MessageData | undefined;
}
const FAVORS_TABLE = env.FAVORS_TABLE;
const CONNECTIONS_TABLE = env.CONNECTIONS_TABLE;
const BOOKMARKS_TABLE = process.env.BOOKMARKS_TABLE || 'comm-bookmarks';
const CHANNELS_TABLE = process.env.CHANNELS_TABLE || 'comm-channels';
const SCHEDULED_MESSAGES_TABLE = process.env.SCHEDULED_MESSAGES_TABLE || 'comm-scheduled-messages';

// ========================================
// REACTIONS HANDLERS
// ========================================

export async function handleAddReaction(
    senderID: string,
    payload: { messageID: string; favorRequestID: string; emoji: string; emojiCode: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageID, favorRequestID, emoji, emojiCode } = payload;

    if (!messageID || !favorRequestID || !emoji || !emojiCode) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Missing required fields for reaction',
        });
        return;
    }

    const nowIso = new Date().toISOString();
    const reactionKey = `${messageID}#${emojiCode}`;

    try {
        const message = await getMessageByID(messageID);

        if (!message) {
            await sendToClient(apiGwManagement, connectionId, {
                type: 'error',
                message: 'Message not found',
            });
            return;
        }

        let reactions = message.reactions || [];

        const existingIndex = reactions.findIndex(r => r.emojiCode === emojiCode);

        if (existingIndex >= 0) {
            // Add user to existing reaction
            if (!reactions[existingIndex].userIDs.includes(senderID)) {
                reactions[existingIndex].userIDs.push(senderID);
                reactions[existingIndex].count++;
            }
        } else {
            // Create new reaction
            reactions.push({
                emoji,
                emojiCode,
                userIDs: [senderID],
                count: 1,
                createdAt: nowIso,
            });
        }

        // Save updated reactions
        await ddb.send(new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp: message.timestamp },
            UpdateExpression: 'SET reactions = :reactions',
            ExpressionAttributeValues: {
                ':reactions': reactions,
            },
        }));

        // Broadcast to conversation
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'reactionAdded',
            messageID,
            favorRequestID,
            reaction: reactions[existingIndex >= 0 ? existingIndex : reactions.length - 1],
            addedBy: senderID,
        });

    } catch (error) {
        console.error('Error adding reaction:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to add reaction',
        });
    }
}


export async function handleRemoveReaction(
    senderID: string,
    payload: { messageID: string; favorRequestID: string; emojiCode: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageID, favorRequestID, emojiCode } = payload;

    try {
        const message = await getMessageByID(messageID);
        if (!message) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Message not found' });
            return;
        }

        let reactions = message.reactions || [];
        const reactionIndex = reactions.findIndex(r => r.emojiCode === emojiCode);

        if (reactionIndex >= 0) {
            // Remove user from reaction
            reactions[reactionIndex].userIDs = reactions[reactionIndex].userIDs.filter(id => id !== senderID);
            reactions[reactionIndex].count--;

            // Remove reaction entirely if no users left
            if (reactions[reactionIndex].count <= 0) {
                reactions = reactions.filter((_, i) => i !== reactionIndex);
            }

            // Save updated reactions
            await ddb.send(new UpdateCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, timestamp: message.timestamp },
                UpdateExpression: 'SET reactions = :reactions',
                ExpressionAttributeValues: {
                    ':reactions': reactions,
                },
            }));

            // Broadcast
            await broadcastToConversation(apiGwManagement, favorRequestID, {
                type: 'reactionRemoved',
                messageID,
                favorRequestID,
                emojiCode,
                removedBy: senderID,
            });
        }

    } catch (error) {
        console.error('Error removing reaction:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to remove reaction',
        });
    }
}

// ========================================
// THREAD REPLY HANDLERS
// ========================================

export async function handleReplyToThread(
    senderID: string,
    payload: { parentMessageID: string; favorRequestID: string; content: string; mentions?: Mention[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { parentMessageID, favorRequestID, content, mentions } = payload;

    if (!parentMessageID || !favorRequestID || !content) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Missing required fields for thread reply',
        });
        return;
    }

    const messageID = uuidv4();
    const timestamp = Date.now();
    const nowIso = new Date().toISOString();

    try {
        // Create the thread reply message
        const threadReply: MessageData = {
            messageID,
            favorRequestID,
            senderID,
            content,
            timestamp,
            type: 'text',
            parentMessageID,
            mentions,
        };

        await ddb.send(new PutCommand({
            TableName: MESSAGES_TABLE,
            Item: threadReply,
        }));

        const parentMessage = await getMessageByID(parentMessageID);

        if (parentMessage) {
            const existingParticipants = parentMessage.threadParticipants || [];
            const newParticipants = existingParticipants.includes(senderID)
                ? existingParticipants
                : [...existingParticipants, senderID];

            await ddb.send(new UpdateCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, timestamp: parentMessage.timestamp },
                UpdateExpression: 'SET threadReplyCount = if_not_exists(threadReplyCount, :zero) + :one, threadParticipants = :participants, lastThreadReplyAt = :lastReply',
                ExpressionAttributeValues: {
                    ':zero': 0,
                    ':one': 1,
                    ':participants': newParticipants,
                    ':lastReply': timestamp,
                },
            }));
        }

        // Broadcast thread reply
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'threadReply',
            parentMessageID,
            favorRequestID,
            message: threadReply,
            threadInfo: {
                parentMessageID,
                replyCount: (parentMessage?.threadReplyCount || 0) + 1,
                participantIDs: parentMessage?.threadParticipants || [senderID],
                lastReplyAt: nowIso,
            },
        });

    } catch (error) {
        console.error('Error replying to thread:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to reply to thread',
        });
    }
}

export async function handleGetThreadReplies(
    senderID: string,
    payload: { parentMessageID: string; favorRequestID: string; limit?: number; before?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { parentMessageID, favorRequestID, limit = 50, before } = payload;

    try {
        // Query messages with parentMessageID
        const queryResult = await ddb.send(new QueryCommand({
            TableName: MESSAGES_TABLE,
            KeyConditionExpression: 'favorRequestID = :frid',
            FilterExpression: 'parentMessageID = :pmid',
            ExpressionAttributeValues: {
                ':frid': favorRequestID,
                ':pmid': parentMessageID,
            },
            ScanIndexForward: false, // Most recent first
            Limit: limit,
        }));

        const replies = (queryResult.Items || []) as MessageData[];

        await sendToClient(apiGwManagement, connectionId, {
            type: 'threadRepliesList',
            parentMessageID,
            favorRequestID,
            replies: replies.reverse(), // Oldest first for display
            hasMore: !!queryResult.LastEvaluatedKey,
        });

    } catch (error) {
        console.error('Error getting thread replies:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to get thread replies',
        });
    }
}

// ========================================
// EDIT/DELETE HANDLERS
// ========================================

export async function handleEditMessage(
    senderID: string,
    payload: { messageID: string; favorRequestID: string; newContent: string; timestamp?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageID, favorRequestID, newContent, timestamp } = payload;

    try {
        let message: MessageData | undefined;

        if (messageID) {
            message = await getMessageByID(messageID);
        }
        if (!message && timestamp) {
            const getResult = await ddb.send(new GetCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, timestamp },
            }));
            message = getResult.Item as MessageData | undefined;
        }

        if (!message) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Message not found' });
            return;
        }

        if (message.senderID !== senderID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Not authorized to edit this message' });
            return;
        }

        const editedAt = Date.now();

        // Update the message
        await ddb.send(new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp: message.timestamp },
            UpdateExpression: 'SET content = :content, isEdited = :isEdited, editedAt = :editedAt',
            ExpressionAttributeValues: {
                ':content': newContent,
                ':isEdited': true,
                ':editedAt': editedAt,
            },
        }));

        // Broadcast — include both messageID and timestamp so frontend can match either way
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'messageEdited',
            messageID: message.messageID || messageID,
            favorRequestID,
            timestamp: message.timestamp,
            newContent,
            editedAt: new Date(editedAt).toISOString(),
            editedBy: senderID,
        });

    } catch (error) {
        console.error('Error editing message:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to edit message',
        });
    }
}

export async function handleDeleteMessage(
    senderID: string,
    payload: { messageID: string; favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageID, favorRequestID } = payload;

    try {
        const message = await getMessageByID(messageID);

        if (!message) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Message not found' });
            return;
        }

        if (message.senderID !== senderID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Not authorized to delete this message' });
            return;
        }

        const deletedAt = Date.now();

        // Soft delete - mark as deleted
        await ddb.send(new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp: message.timestamp },
            UpdateExpression: 'SET isDeleted = :isDeleted, deletedAt = :deletedAt, content = :deletedContent',
            ExpressionAttributeValues: {
                ':isDeleted': true,
                ':deletedAt': deletedAt,
                ':deletedContent': '[Message deleted]',
            },
        }));

        // Broadcast
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'messageDeleted',
            messageID,
            favorRequestID,
            deletedAt: new Date(deletedAt).toISOString(),
            deletedBy: senderID,
        });

    } catch (error) {
        console.error('Error deleting message:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to delete message',
        });
    }
}

// ========================================
// TYPING INDICATOR HANDLERS
// ========================================

export async function handleTypingStart(
    senderID: string,
    payload: { favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    // Use cached getSenderInfo (60s TTL) instead of a fresh GetCommand
    const senderInfo = await _getSenderInfo(connectionId);
    const userName = (senderInfo as any)?.userName || 'Someone';

    await broadcastToConversation(apiGwManagement, favorRequestID, {
        type: 'typingStart',
        favorRequestID,
        userID: senderID,
        userName,
    }, senderID);
}

export async function handleTypingStop(
    senderID: string,
    payload: { favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    // Broadcast to conversation (exclude sender)
    await broadcastToConversation(apiGwManagement, favorRequestID, {
        type: 'typingStop',
        favorRequestID,
        userID: senderID,
    }, senderID);
}

// ========================================
// PRESENCE HANDLERS
// ========================================

export async function handleSetPresence(
    senderID: string,
    payload: { status: 'online' | 'away' | 'dnd' | 'offline'; customStatus?: { emoji: string; text: string; expiresAt?: string } },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { status, customStatus } = payload;
    const nowIso = new Date().toISOString();

    // Save presence to connections table
    await ddb.send(new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
        UpdateExpression: 'SET presenceStatus = :status, lastSeen = :lastSeen, customStatus = :customStatus',
        ExpressionAttributeValues: {
            ':status': status,
            ':lastSeen': nowIso,
            ':customStatus': customStatus || null,
        },
    }));

    // Broadcast presence update to all active connections
    // Note: In production, you'd want to limit this to only contacts/team members
    console.log(`User ${senderID} set presence to ${status}`);
}

export async function handleGetPresence(
    senderID: string,
    payload: { userIDs: string[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { userIDs } = payload;
    const uniqueIDs = [...new Set(userIDs)].slice(0, 50);

    // Use connection-service batch API (has 60s cache, avoids N individual queries)
    const connectionsMap = await batchGetConnectionsByUserIDs(uniqueIDs);

    const presences: UserPresence[] = uniqueIDs.map(userID => {
        const conns = connectionsMap.get(userID);
        if (conns && conns.length > 0) {
            const conn = conns[0] as any;
            return {
                userID,
                status: conn.presenceStatus || 'online',
                lastSeen: conn.lastSeen || conn.connectedAt || new Date().toISOString(),
                customStatus: conn.customStatus,
            };
        }
        return { userID, status: 'offline' as const, lastSeen: '' };
    });

    await sendToClient(apiGwManagement, connectionId, {
        type: 'presenceList',
        presences,
    });
}

// ========================================
// PINNED MESSAGES HANDLERS
// ========================================

export async function handlePinMessage(
    senderID: string,
    payload: { messageID: string; favorRequestID: string; timestamp?: number; expiresAt?: string; messageType?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageID, favorRequestID, timestamp, expiresAt, messageType } = payload;
    const nowIso = new Date().toISOString();
    const pinID = uuidv4();

    try {
        let message: MessageData | undefined;

        if (messageID) {
            message = await getMessageByID(messageID);
        }
        if (!message && timestamp) {
            const getResult = await ddb.send(new GetCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, timestamp },
            }));
            message = getResult.Item as MessageData | undefined;
        }

        if (!message) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Message not found' });
            return;
        }

        // Update message as pinned (including expiry)
        const updateExpr = expiresAt
            ? 'SET isPinned = :isPinned, pinnedAt = :pinnedAt, pinnedBy = :pinnedBy, pinExpiresAt = :expiresAt'
            : 'SET isPinned = :isPinned, pinnedAt = :pinnedAt, pinnedBy = :pinnedBy';
        const exprValues: Record<string, any> = {
            ':isPinned': true,
            ':pinnedAt': Date.now(),
            ':pinnedBy': senderID,
        };
        if (expiresAt) exprValues[':expiresAt'] = expiresAt;

        await ddb.send(new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp: message.timestamp },
            UpdateExpression: updateExpr,
            ExpressionAttributeValues: exprValues,
        }));

        const pinnedMessage: PinnedMessage = {
            pinID,
            messageID: message.messageID || messageID,
            favorRequestID,
            pinnedBy: senderID,
            pinnedAt: nowIso,
            expiresAt: expiresAt || undefined,
            messagePreview: message.content.slice(0, 100),
            messageType: (messageType || message.type || 'text') as any,
            senderID: message.senderID,
        };

        // Broadcast
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'messagePinned',
            pinnedMessage,
        });

    } catch (error) {
        console.error('Error pinning message:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to pin message',
        });
    }
}

export async function handleUnpinMessage(
    senderID: string,
    payload: { messageID: string; favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageID, favorRequestID } = payload;

    try {
        const message = await getMessageByID(messageID);

        if (!message) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Message not found' });
            return;
        }

        await ddb.send(new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp: message.timestamp },
            UpdateExpression: 'SET isPinned = :isPinned, pinnedAt = :pinnedAt, pinnedBy = :pinnedBy',
            ExpressionAttributeValues: {
                ':isPinned': false,
                ':pinnedAt': null,
                ':pinnedBy': null,
            },
        }));

        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'messageUnpinned',
            messageID,
            favorRequestID,
            unpinnedBy: senderID,
        });

    } catch (error) {
        console.error('Error unpinning message:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to unpin message',
        });
    }
}

export async function handleGetPinnedMessages(
    senderID: string,
    payload: { favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    try {
        const queryResult = await ddb.send(new QueryCommand({
            TableName: MESSAGES_TABLE,
            KeyConditionExpression: 'favorRequestID = :frid',
            FilterExpression: 'isPinned = :isPinned',
            ExpressionAttributeValues: {
                ':frid': favorRequestID,
                ':isPinned': true,
            },
        }));

        const pinnedMessages = (queryResult.Items || []).map((m: any) => ({
            pinID: `${m.messageID}-pin`,
            messageID: m.messageID,
            pinnedBy: m.pinnedBy,
            pinnedAt: new Date(m.pinnedAt).toISOString(),
            expiresAt: m.pinExpiresAt || undefined,
            messagePreview: m.content.slice(0, 100),
            messageType: m.type || 'text',
            senderID: m.senderID,
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'pinnedMessagesList',
            favorRequestID,
            pinnedMessages,
        });

    } catch (error) {
        console.error('Error getting pinned messages:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to get pinned messages',
        });
    }
}

// ========================================
// BOOKMARKS HANDLERS
// ========================================

export async function handleAddBookmark(
    senderID: string,
    payload: { type: 'message' | 'file' | 'task' | 'link'; referenceID: string; favorRequestID?: string; note?: string; title?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { type, referenceID, favorRequestID, note, title } = payload;
    const bookmarkID = uuidv4();
    const nowIso = new Date().toISOString();

    const bookmark: Bookmark = {
        bookmarkID,
        userID: senderID,
        type,
        referenceID,
        favorRequestID,
        title: title || referenceID,
        note,
        createdAt: nowIso,
    };

    try {
        await ddb.send(new PutCommand({
            TableName: BOOKMARKS_TABLE,
            Item: bookmark,
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'bookmarkAdded',
            bookmark,
        });

    } catch (error) {
        console.error('Error adding bookmark:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to add bookmark',
        });
    }
}

export async function handleRemoveBookmark(
    senderID: string,
    payload: { bookmarkID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { bookmarkID } = payload;

    try {
        await ddb.send(new DeleteCommand({
            TableName: BOOKMARKS_TABLE,
            Key: { bookmarkID },
            ConditionExpression: 'userID = :userID',
            ExpressionAttributeValues: {
                ':userID': senderID,
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'bookmarkRemoved',
            bookmarkID,
        });

    } catch (error) {
        console.error('Error removing bookmark:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to remove bookmark',
        });
    }
}

export async function handleGetBookmarks(
    senderID: string,
    payload: { type?: 'message' | 'file' | 'task' | 'link'; limit?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { type, limit = 50 } = payload;

    try {
        const queryResult = await ddb.send(new QueryCommand({
            TableName: BOOKMARKS_TABLE,
            IndexName: 'UserIDIndex',
            KeyConditionExpression: 'userID = :userID',
            FilterExpression: type ? '#type = :type' : undefined,
            ExpressionAttributeNames: type ? { '#type': 'type' } : undefined,
            ExpressionAttributeValues: {
                ':userID': senderID,
                ...(type && { ':type': type }),
            },
            Limit: limit,
            ScanIndexForward: false,
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'bookmarksList',
            bookmarks: queryResult.Items || [],
            total: queryResult.Count || 0,
        });

    } catch (error) {
        console.error('Error getting bookmarks:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to get bookmarks',
        });
    }
}

// ========================================
// SEARCH HANDLER
// ========================================

export async function handleSearch(
    senderID: string,
    payload: { query: string; types?: string[]; from?: string; in?: string; dateFrom?: string; dateTo?: string; limit?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { query, types = ['message'], from, in: inConversation, dateFrom, dateTo, limit = 50 } = payload;
    const startTime = Date.now();

    try {
        // Basic search implementation - in production use OpenSearch/Elasticsearch
        const results: any[] = [];

        if (types.includes('message')) {
            // Search in user's conversations
            // Use SenderIndex (senderID partition key) — matches comm-stack GSI definition
            const favorsResult = await ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'SenderIndex',
                KeyConditionExpression: 'senderID = :userID',
                ExpressionAttributeValues: { ':userID': senderID },
                ScanIndexForward: false,
                Limit: 20,
            }));

            const favors = favorsResult.Items || [];
            if (inConversation) {
                const filtered = favors.filter((f: any) => f.favorRequestID === inConversation);
                favors.length = 0;
                favors.push(...filtered);
            }

            // Parallel message search across all matching conversations
            const messageSearchResults = await Promise.all(
                favors.map(async (favor: any) => {
                    const messagesResult = await ddb.send(new QueryCommand({
                        TableName: MESSAGES_TABLE,
                        KeyConditionExpression: 'favorRequestID = :frid',
                        FilterExpression: 'contains(content, :query)',
                        ExpressionAttributeValues: {
                            ':frid': favor.favorRequestID,
                            ':query': query,
                        },
                        Limit: 10,
                    }));
                    return messagesResult.Items || [];
                })
            );

            for (const msgs of messageSearchResults) {
                for (const msg of msgs) {
                    if (from && msg.senderID !== from) continue;

                    results.push({
                        type: 'message',
                        id: msg.messageID || `${msg.favorRequestID}-${msg.timestamp}`,
                        title: (msg.content as string).slice(0, 50),
                        preview: msg.content,
                        favorRequestID: msg.favorRequestID,
                        senderName: msg.senderID,
                        timestamp: new Date(msg.timestamp as number).toISOString(),
                        highlights: [`<mark>${query}</mark>`],
                    });
                }
            }
        }

        const took = Date.now() - startTime;

        await sendToClient(apiGwManagement, connectionId, {
            type: 'searchResults',
            results: results.slice(0, limit),
            total: results.length,
            hasMore: results.length > limit,
            query,
            took,
        });

    } catch (error) {
        console.error('Error searching:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Search failed',
        });
    }
}

// ========================================
// SCHEDULED MESSAGES HANDLERS
// ========================================

export async function handleScheduleMessage(
    senderID: string,
    payload: { favorRequestID: string; content: string; scheduledFor: string; type?: 'text' | 'file'; fileKey?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, content, scheduledFor, type = 'text', fileKey } = payload;
    const scheduledMessageID = uuidv4();
    const nowIso = new Date().toISOString();

    const scheduledMessage: ScheduledMessage = {
        scheduledMessageID,
        favorRequestID,
        senderID,
        content,
        scheduledFor,
        type,
        fileKey,
        status: 'scheduled',
        createdAt: nowIso,
    };

    try {
        await ddb.send(new PutCommand({
            TableName: SCHEDULED_MESSAGES_TABLE,
            Item: scheduledMessage,
        }));

        // TODO: Create EventBridge rule to trigger at scheduledFor time

        await sendToClient(apiGwManagement, connectionId, {
            type: 'scheduledMessageCreated',
            scheduledMessage,
        });

    } catch (error) {
        console.error('Error scheduling message:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to schedule message',
        });
    }
}

export async function handleCancelScheduledMessage(
    senderID: string,
    payload: { scheduledMessageID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { scheduledMessageID } = payload;

    try {
        await ddb.send(new UpdateCommand({
            TableName: SCHEDULED_MESSAGES_TABLE,
            Key: { scheduledMessageID },
            UpdateExpression: 'SET #status = :status',
            ConditionExpression: 'senderID = :senderID AND #status = :scheduled',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'cancelled',
                ':senderID': senderID,
                ':scheduled': 'scheduled',
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'scheduledMessageCancelled',
            scheduledMessageID,
        });

    } catch (error) {
        console.error('Error cancelling scheduled message:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to cancel scheduled message',
        });
    }
}

export async function handleGetScheduledMessages(
    senderID: string,
    payload: { favorRequestID?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    try {
        const queryResult = await ddb.send(new QueryCommand({
            TableName: SCHEDULED_MESSAGES_TABLE,
            IndexName: 'SenderIDIndex',
            KeyConditionExpression: 'senderID = :senderID',
            FilterExpression: favorRequestID
                ? '#status = :scheduled AND favorRequestID = :frid'
                : '#status = :scheduled',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':senderID': senderID,
                ':scheduled': 'scheduled',
                ...(favorRequestID && { ':frid': favorRequestID }),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'scheduledMessagesList',
            scheduledMessages: queryResult.Items || [],
        });

    } catch (error) {
        console.error('Error getting scheduled messages:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to get scheduled messages',
        });
    }
}

// ========================================
// CHANNEL HANDLERS (Public/Private Channels)
// ========================================

export async function handleCreateChannel(
    senderID: string,
    payload: { name: string; description?: string; type: 'public' | 'private'; members?: string[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { name, description, type = 'public', members = [] } = payload;
    const channelID = uuidv4();
    const nowIso = new Date().toISOString();

    // Ensure creator is always a member
    const allMembers = [...new Set([senderID, ...members])];

    const channel: Channel = {
        channelID,
        name,
        description,
        type,
        createdBy: senderID,
        createdAt: nowIso,
        updatedAt: nowIso,
        memberCount: allMembers.length,
        members: allMembers,
        isArchived: false,
    };

    try {
        await ddb.send(new PutCommand({
            TableName: CHANNELS_TABLE,
            Item: channel,
        }));

        // Notify all members in parallel (batch-fetch connections then broadcast)
        const connMap = await batchGetConnectionIdForUsers(allMembers);
        await Promise.all(
            allMembers.map(memberID => {
                const connId = connMap.get(memberID);
                if (!connId) return Promise.resolve();
                return sendToClient(apiGwManagement, connId, {
                    type: 'channelCreated',
                    channel: { ...channel, isMember: true },
                });
            }),
        );

    } catch (error) {
        console.error('Error creating channel:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to create channel',
        });
    }
}

export async function handleJoinChannel(
    senderID: string,
    payload: { channelID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { channelID } = payload;

    try {
        const result = await ddb.send(new GetCommand({
            TableName: CHANNELS_TABLE,
            Key: { channelID },
        }));

        const channel = result.Item as Channel;

        if (!channel) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Channel not found' });
            return;
        }

        if (channel.type === 'private') {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Cannot join private channel without invitation' });
            return;
        }

        if (channel.members.includes(senderID)) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Already a member' });
            return;
        }

        const newMembers = [...channel.members, senderID];

        await ddb.send(new UpdateCommand({
            TableName: CHANNELS_TABLE,
            Key: { channelID },
            UpdateExpression: 'SET members = :members, memberCount = :count, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':members': newMembers,
                ':count': newMembers.length,
                ':updatedAt': new Date().toISOString(),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'channelJoined',
            channelID,
        });

    } catch (error) {
        console.error('Error joining channel:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to join channel',
        });
    }
}

export async function handleLeaveChannel(
    senderID: string,
    payload: { channelID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { channelID } = payload;

    try {
        const result = await ddb.send(new GetCommand({
            TableName: CHANNELS_TABLE,
            Key: { channelID },
        }));

        const channel = result.Item as Channel;

        if (!channel) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Channel not found' });
            return;
        }

        if (channel.createdBy === senderID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Channel creator cannot leave. Archive the channel instead.' });
            return;
        }

        const newMembers = channel.members.filter(m => m !== senderID);

        await ddb.send(new UpdateCommand({
            TableName: CHANNELS_TABLE,
            Key: { channelID },
            UpdateExpression: 'SET members = :members, memberCount = :count, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':members': newMembers,
                ':count': newMembers.length,
                ':updatedAt': new Date().toISOString(),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'channelLeft',
            channelID,
        });

    } catch (error) {
        console.error('Error leaving channel:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to leave channel',
        });
    }
}

export async function handleListChannels(
    senderID: string,
    payload: { type?: 'public' | 'private'; includeArchived?: boolean },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { type, includeArchived = false } = payload;

    try {
        // Use CreatedByIndex GSI for the user's own channels, then supplement with public channels
        // via IsArchivedTypeIndex GSI. This avoids a full table scan.
        const exprNames: Record<string, string> = { '#n': 'name', '#ct': 'type' };

        // Query 1: Channels the user created (via CreatedByIndex GSI)
        const createdByPromise = ddb.send(new QueryCommand({
            TableName: CHANNELS_TABLE,
            IndexName: 'CreatedByIndex',
            KeyConditionExpression: 'createdBy = :uid',
            ExpressionAttributeValues: { ':uid': senderID },
            ProjectionExpression: 'channelID, #n, description, #ct, memberCount, members, isArchived',
            ExpressionAttributeNames: exprNames,
        }));

        // Query 2: Public non-archived channels (via IsArchivedTypeIndex GSI)
        const publicPromise = ddb.send(new QueryCommand({
            TableName: CHANNELS_TABLE,
            IndexName: 'IsArchivedTypeIndex',
            KeyConditionExpression: 'isArchivedStr = :notArchived AND begins_with(#ct, :pub)',
            ExpressionAttributeValues: { ':notArchived': 'false', ':pub': 'public' },
            ExpressionAttributeNames: { ...exprNames, '#n': 'name' },
            ProjectionExpression: 'channelID, #n, description, #ct, memberCount, members, isArchived',
        }));

        const [createdByResult, publicResult] = await Promise.all([createdByPromise, publicPromise]);

        // Merge and deduplicate
        const channelMap = new Map<string, Channel>();
        for (const item of [...(createdByResult.Items || []), ...(publicResult.Items || [])]) {
            const ch = item as Channel;
            channelMap.set(ch.channelID, ch);
        }

        let channels = Array.from(channelMap.values());

        // Apply filters
        if (!includeArchived) channels = channels.filter(c => !c.isArchived);
        if (type) channels = channels.filter(c => c.type === type);

        // Show public channels + private channels user is a member of
        channels = channels.filter(c =>
            c.type === 'public' || c.members.includes(senderID)
        );

        await sendToClient(apiGwManagement, connectionId, {
            type: 'channelsList',
            channels: channels.map(c => ({
                channelID: c.channelID,
                name: c.name,
                description: c.description,
                type: c.type,
                memberCount: c.memberCount,
                isMember: c.members.includes(senderID),
            })),
            total: channels.length,
        });

    } catch (error) {
        console.error('Error listing channels:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to list channels',
        });
    }
}

export async function handleArchiveChannel(
    senderID: string,
    payload: { channelID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { channelID } = payload;

    try {
        const result = await ddb.send(new GetCommand({
            TableName: CHANNELS_TABLE,
            Key: { channelID },
        }));

        const channel = result.Item as Channel;

        if (!channel) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Channel not found' });
            return;
        }

        if (channel.createdBy !== senderID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Only the channel creator can archive it' });
            return;
        }

        const nowIso = new Date().toISOString();

        await ddb.send(new UpdateCommand({
            TableName: CHANNELS_TABLE,
            Key: { channelID },
            UpdateExpression: 'SET isArchived = :isArchived, archivedAt = :archivedAt, archivedBy = :archivedBy',
            ExpressionAttributeValues: {
                ':isArchived': true,
                ':archivedAt': nowIso,
                ':archivedBy': senderID,
            },
        }));

        // Notify all members in parallel
        const connMap = await batchGetConnectionIdForUsers(channel.members);
        await Promise.all(
            channel.members.map(memberID => {
                const connId = connMap.get(memberID);
                if (!connId) return Promise.resolve();
                return sendToClient(apiGwManagement, connId, {
                    type: 'channelArchived',
                    channelID,
                    archivedBy: senderID,
                });
            }),
        );

    } catch (error) {
        console.error('Error archiving channel:', error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to archive channel',
        });
    }
}

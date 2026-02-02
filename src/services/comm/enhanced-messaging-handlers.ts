/**
 * Enhanced Messaging Handlers
 * ===========================
 * This file contains all WebSocket action handlers for enhanced messaging features:
 * - Message Delivery Status (sent, delivered, read receipts)
 * - Voice Messages (recording, playback, transcription)
 * - Conversation Settings (mute, archive, notifications)
 * - Analytics & Insights
 * - GIF & Sticker Support
 * - Voice/Video Calling
 * - Link Previews
 * - File Management
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

// ========================================
// ENVIRONMENT & SDK SETUP
// ========================================

const REGION = process.env.AWS_REGION || 'us-east-1';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || '';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';
const CONVERSATION_SETTINGS_TABLE = process.env.CONVERSATION_SETTINGS_TABLE || '';
const CALLS_TABLE = process.env.CALLS_TABLE || '';
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });

// ========================================
// TYPES
// ========================================

type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
type CallType = 'voice' | 'video';
type CallStatus = 'initiating' | 'ringing' | 'connected' | 'ended' | 'missed' | 'declined' | 'busy';

interface ReadReceipt {
    userID: string;
    readAt: number;
}

interface ConversationSettings {
    favorRequestID: string;
    userID: string;
    muted: boolean;
    muteUntil?: string;
    notifyOnMentionsOnly: boolean;
    customNotificationSound?: string;
    pinned: boolean;
    archived: boolean;
    notificationPreference: 'all' | 'mentions' | 'none';
    autoDeleteAfterDays?: number;
}

interface VoiceMessage {
    duration: number;
    waveformData?: number[];
    playbackUrl?: string; // Presigned URL for audio playback
}

interface GifMedia {
    id: string;
    title: string;
    url: string;
    previewUrl: string;
    width: number;
    height: number;
    source: 'giphy' | 'tenor';
}

interface StickerPack {
    packID: string;
    name: string;
    description?: string;
    thumbnailUrl: string;
    stickerCount: number;
    category: 'emoji' | 'reactions' | 'animals' | 'food' | 'activities' | 'custom';
    isDefault: boolean;
    createdAt: string;
}

interface Sticker {
    stickerID: string;
    packID: string;
    url: string;
    thumbnailUrl?: string;
    altText: string;
    keywords: string[];
    width: number;
    height: number;
}

interface Call {
    callID: string;
    favorRequestID: string;
    callerID: string;
    callerName: string;
    callType: CallType;
    participantIDs: string[];
    status: CallStatus;
    startedAt?: string;
    endedAt?: string;
    duration?: number;
    meetingToken?: string;
    meetingId?: string;
}

interface LinkPreview {
    url: string;
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    fetchedAt: string;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

async function sendToClient(
    apiGwManagement: ApiGatewayManagementApiClient,
    connectionId: string,
    payload: object
): Promise<void> {
    try {
        await apiGwManagement.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify(payload)),
        }));
    } catch (e: any) {
        if (e.statusCode === 410) {
            console.log(`Stale connection: ${connectionId}`);
        } else {
            console.error(`Error sending to ${connectionId}:`, e);
        }
    }
}

async function getConnectionIdForUser(userID: string): Promise<string | null> {
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: CONNECTIONS_TABLE,
            IndexName: 'userID-index',
            KeyConditionExpression: 'userID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            Limit: 1,
        }));
        return result.Items?.[0]?.connectionId || null;
    } catch (e) {
        console.error('Error getting connection for user:', e);
        return null;
    }
}

async function broadcastToConversation(
    apiGwManagement: ApiGatewayManagementApiClient,
    favorRequestID: string,
    payload: object,
    excludeUserID?: string
): Promise<void> {
    // Get all participants of the conversation
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));

    if (!favorResult.Item) return;

    const participants: string[] = [];
    if (favorResult.Item.senderID) participants.push(favorResult.Item.senderID);
    if (favorResult.Item.receiverID) participants.push(favorResult.Item.receiverID);
    if (favorResult.Item.teamID) {
        // For group chats, get team members
        // This would require querying the teams table
    }

    for (const userID of participants) {
        if (userID === excludeUserID) continue;
        const connectionId = await getConnectionIdForUser(userID);
        if (connectionId) {
            await sendToClient(apiGwManagement, connectionId, payload);
        }
    }
}

// ========================================
// MESSAGE DELIVERY STATUS HANDLERS
// ========================================

/**
 * Mark messages as delivered when they reach the client
 */
export async function handleMarkDelivered(
    senderID: string,
    payload: { messageIDs: string[]; favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageIDs, favorRequestID } = payload;

    if (!messageIDs || messageIDs.length === 0) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing messageIDs' });
        return;
    }

    const now = Date.now();

    for (const messageID of messageIDs) {
        try {
            await ddb.send(new UpdateCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, timestamp: parseInt(messageID.split('-')[1]) || now },
                UpdateExpression: 'SET deliveryStatus = :status, deliveredAt = :at',
                ExpressionAttributeValues: {
                    ':status': 'delivered',
                    ':at': now,
                },
            }));
        } catch (e) {
            console.error(`Error marking message ${messageID} as delivered:`, e);
        }
    }

    // Notify the sender that messages were delivered
    await broadcastToConversation(apiGwManagement, favorRequestID, {
        type: 'deliveryStatusUpdate',
        favorRequestID,
        messageIDs,
        status: 'delivered',
        deliveredAt: now,
    }, senderID);
}

/**
 * Mark messages as read with read receipts
 */
export async function handleMarkMessagesRead(
    senderID: string,
    payload: { messageIDs: string[]; favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { messageIDs, favorRequestID } = payload;

    if (!messageIDs || messageIDs.length === 0) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing messageIDs' });
        return;
    }

    const now = Date.now();
    const readReceipt: ReadReceipt = { userID: senderID, readAt: now };

    for (const messageID of messageIDs) {
        try {
            // Update each message with the read receipt
            await ddb.send(new UpdateCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, messageID },
                UpdateExpression: 'SET deliveryStatus = :status, readBy = list_append(if_not_exists(readBy, :empty), :receipt)',
                ExpressionAttributeValues: {
                    ':status': 'read',
                    ':receipt': [readReceipt],
                    ':empty': [],
                },
            }));
        } catch (e) {
            console.error(`Error marking message ${messageID} as read:`, e);
        }
    }

    // Broadcast read receipts to conversation participants
    await broadcastToConversation(apiGwManagement, favorRequestID, {
        type: 'deliveryStatusUpdate',
        favorRequestID,
        messageIDs,
        status: 'read',
        readBy: [readReceipt],
        updatedAt: now,
    }, senderID);
}

// ========================================
// VOICE MESSAGE HANDLERS
// ========================================

/**
 * Get a presigned URL for uploading a voice message
 */
export async function handleGetVoiceUploadUrl(
    senderID: string,
    payload: { favorRequestID: string; duration: number; mimeType: string; waveformData?: number[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, duration, mimeType } = payload;

    if (!favorRequestID || !duration || !mimeType) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing required fields' });
        return;
    }

    // Determine file extension based on MIME type
    const extensions: Record<string, string> = {
        'audio/webm': 'webm',
        'audio/mp4': 'm4a',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'audio/mpeg': 'mp3',
    };
    const ext = extensions[mimeType] || 'webm';
    const voiceKey = `voice/${favorRequestID}/${uuidv4()}.${ext}`;

    try {
        const command = new PutObjectCommand({
            Bucket: FILE_BUCKET_NAME,
            Key: voiceKey,
            ContentType: mimeType,
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        await sendToClient(apiGwManagement, connectionId, {
            type: 'voiceMessageUploadUrl',
            uploadUrl,
            voiceKey,
            favorRequestID,
        });
    } catch (e) {
        console.error('Error generating voice upload URL:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to generate upload URL' });
    }
}

/**
 * Send a voice message after uploading
 * Audio is sent as-is for playback without transcription
 */
export async function handleSendVoiceMessage(
    senderID: string,
    payload: { favorRequestID: string; voiceKey: string; duration: number; waveformData?: number[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, voiceKey, duration, waveformData } = payload;

    if (!favorRequestID || !voiceKey) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing required fields' });
        return;
    }

    const messageID = `msg-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const timestamp = Date.now();

    // Generate presigned URL for playback (valid for 7 days)
    let playbackUrl = '';
    try {
        const getCommand = new GetObjectCommand({
            Bucket: FILE_BUCKET_NAME,
            Key: voiceKey,
        });
        playbackUrl = await getSignedUrl(s3, getCommand, { expiresIn: 604800 }); // 7 days
    } catch (e) {
        console.warn('Could not generate playback URL:', e);
    }

    const voiceDetails: VoiceMessage = {
        duration,
        waveformData,
        playbackUrl, // Add playback URL for immediate playback
    };

    const message = {
        messageID,
        favorRequestID,
        senderID,
        content: `🎤 Voice message (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})`,
        timestamp,
        type: 'voice',
        voiceKey,
        voiceDetails,
        deliveryStatus: 'sent',
    };

    try {
        await ddb.send(new PutCommand({
            TableName: MESSAGES_TABLE,
            Item: message,
        }));

        // Update conversation's lastMessageTime
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET updatedAt = :now, lastMessagePreview = :preview',
            ExpressionAttributeValues: {
                ':now': new Date().toISOString(),
                ':preview': '🎤 Voice message',
            },
        }));

        // Broadcast to all participants
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'newMessage',
            message,
        });

    } catch (e) {
        console.error('Error sending voice message:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to send voice message' });
    }
}

// ========================================
// CONVERSATION SETTINGS HANDLERS
// ========================================

/**
 * Update conversation settings (mute, archive, notification preferences)
 */
export async function handleUpdateConversationSettings(
    senderID: string,
    payload: { favorRequestID: string; settings: Partial<ConversationSettings> },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, settings } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID' });
        return;
    }

    const settingsKey = `${favorRequestID}#${senderID}`;

    try {
        // Build update expression dynamically
        const updateParts: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};

        Object.entries(settings).forEach(([key, value], index) => {
            if (key !== 'favorRequestID' && key !== 'userID') {
                updateParts.push(`#k${index} = :v${index}`);
                expressionAttributeNames[`#k${index}`] = key;
                expressionAttributeValues[`:v${index}`] = value;
            }
        });

        if (updateParts.length === 0) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'No settings to update' });
            return;
        }

        await ddb.send(new UpdateCommand({
            TableName: CONVERSATION_SETTINGS_TABLE || FAVORS_TABLE,
            Key: { settingsKey },
            UpdateExpression: `SET ${updateParts.join(', ')}, updatedAt = :now`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: {
                ...expressionAttributeValues,
                ':now': new Date().toISOString(),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'conversationSettingsUpdate',
            favorRequestID,
            settings: { ...settings, userID: senderID },
        });

    } catch (e) {
        console.error('Error updating conversation settings:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to update settings' });
    }
}

/**
 * Mute a conversation
 */
export async function handleMuteConversation(
    senderID: string,
    payload: { favorRequestID: string; muteUntil?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    await handleUpdateConversationSettings(senderID, {
        favorRequestID: payload.favorRequestID,
        settings: {
            muted: true,
            muteUntil: payload.muteUntil,
        },
    }, connectionId, apiGwManagement);
}

/**
 * Unmute a conversation
 */
export async function handleUnmuteConversation(
    senderID: string,
    payload: { favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    await handleUpdateConversationSettings(senderID, {
        favorRequestID: payload.favorRequestID,
        settings: {
            muted: false,
            muteUntil: undefined,
        },
    }, connectionId, apiGwManagement);
}

/**
 * Archive a conversation
 */
export async function handleArchiveConversation(
    senderID: string,
    payload: { favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    await handleUpdateConversationSettings(senderID, {
        favorRequestID: payload.favorRequestID,
        settings: { archived: true },
    }, connectionId, apiGwManagement);
}

/**
 * Pin a conversation
 */
export async function handlePinConversation(
    senderID: string,
    payload: { favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    await handleUpdateConversationSettings(senderID, {
        favorRequestID: payload.favorRequestID,
        settings: { pinned: true },
    }, connectionId, apiGwManagement);
}

// ========================================
// ANALYTICS HANDLERS
// ========================================

/**
 * Get conversation analytics and insights
 */
export async function handleGetConversationAnalytics(
    senderID: string,
    payload: { favorRequestID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID' });
        return;
    }

    try {
        // Query all messages for this conversation
        const messagesResult = await ddb.send(new QueryCommand({
            TableName: MESSAGES_TABLE,
            KeyConditionExpression: 'favorRequestID = :frid',
            ExpressionAttributeValues: { ':frid': favorRequestID },
        }));

        const messages = messagesResult.Items || [];
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

        // Calculate stats
        const contributorCounts: Record<string, number> = {};
        const hourCounts: Record<number, number> = {};
        const typeCounts = { text: 0, file: 0, voice: 0, system: 0 };
        let reactionCount = 0;
        const emojiCounts: Record<string, number> = {};
        let messagesLast24h = 0;
        let messagesLast7d = 0;
        let totalResponseTime = 0;
        let responseCount = 0;
        let lastTimestamp = 0;
        let lastSenderID = '';

        for (const msg of messages) {
            // Contributor stats
            contributorCounts[msg.senderID] = (contributorCounts[msg.senderID] || 0) + 1;

            // Hourly activity
            const hour = new Date(msg.timestamp).getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;

            // Message type breakdown
            const msgType = msg.type || 'text';
            if (msgType in typeCounts) {
                typeCounts[msgType as keyof typeof typeCounts]++;
            }

            // Reaction stats
            if (msg.reactions) {
                for (const reaction of msg.reactions) {
                    reactionCount += reaction.count || 1;
                    emojiCounts[reaction.emoji] = (emojiCounts[reaction.emoji] || 0) + (reaction.count || 1);
                }
            }

            // Time-based counts
            if (msg.timestamp > oneDayAgo) messagesLast24h++;
            if (msg.timestamp > sevenDaysAgo) messagesLast7d++;

            // Response time calculation
            if (lastTimestamp > 0 && msg.senderID !== lastSenderID) {
                totalResponseTime += msg.timestamp - lastTimestamp;
                responseCount++;
            }
            lastTimestamp = msg.timestamp;
            lastSenderID = msg.senderID;
        }

        // Build top contributors
        const topContributors = Object.entries(contributorCounts)
            .map(([userID, count]) => ({
                userID,
                messageCount: count,
                percentageOfTotal: Math.round((count / messages.length) * 100),
                lastActiveAt: new Date().toISOString(), // Would need to track this properly
            }))
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, 5);

        // Build peak activity hours
        const peakActivityHours = Object.entries(hourCounts)
            .map(([hour, count]) => ({ hour: parseInt(hour), count }))
            .sort((a, b) => b.count - a.count);

        // Build top emojis
        const topEmojis = Object.entries(emojiCounts)
            .map(([emoji, count]) => ({ emoji, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const analytics = {
            favorRequestID,
            totalMessages: messages.length,
            activeParticipants: Object.keys(contributorCounts).length,
            averageResponseTimeMs: responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0,
            messagesLast24h,
            messagesLast7d,
            peakActivityHours,
            topContributors,
            messageTypeBreakdown: typeCounts,
            reactionStats: {
                totalReactions: reactionCount,
                topEmojis,
            },
            responseHealthScore: calculateHealthScore(messages.length, responseCount, messagesLast7d),
        };

        await sendToClient(apiGwManagement, connectionId, {
            type: 'conversationAnalytics',
            analytics,
        });

    } catch (e) {
        console.error('Error getting conversation analytics:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to get analytics' });
    }
}

function calculateHealthScore(totalMessages: number, responseCount: number, recentMessages: number): number {
    // Simple health score calculation (0-100)
    let score = 50; // Base score

    // Activity bonus (up to 25 points)
    if (recentMessages > 100) score += 25;
    else if (recentMessages > 50) score += 20;
    else if (recentMessages > 20) score += 15;
    else if (recentMessages > 5) score += 10;
    else if (recentMessages > 0) score += 5;

    // Engagement bonus (up to 25 points) - based on response rate
    const responseRate = totalMessages > 0 ? responseCount / totalMessages : 0;
    score += Math.min(25, Math.round(responseRate * 50));

    return Math.min(100, score);
}

// ========================================
// GIF & STICKER HANDLERS
// ========================================

/**
 * Search for GIFs using GIPHY API
 */
export async function handleSearchGifs(
    senderID: string,
    payload: { query: string; limit?: number; offset?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { query, limit = 25, offset = 0 } = payload;

    if (!query) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing search query' });
        return;
    }

    try {
        // Call GIPHY API
        const response = await fetch(
            `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&rating=g`
        );

        if (!response.ok) {
            throw new Error('GIPHY API error');
        }

        const data = await response.json() as { data: any[]; pagination: { total_count: number } };

        const gifs: GifMedia[] = data.data.map((gif: any) => ({
            id: gif.id,
            title: gif.title,
            url: gif.images.original.url,
            previewUrl: gif.images.fixed_width_small.url,
            width: parseInt(gif.images.original.width),
            height: parseInt(gif.images.original.height),
            source: 'giphy' as const,
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'gifSearchResults',
            gifs,
            query,
            hasMore: data.pagination.total_count > offset + limit,
            offset,
        });

    } catch (e) {
        console.error('Error searching GIFs:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to search GIFs' });
    }
}

/**
 * Get trending GIFs
 */
export async function handleGetTrendingGifs(
    senderID: string,
    payload: { limit?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { limit = 25 } = payload;

    try {
        const response = await fetch(
            `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&rating=g`
        );

        if (!response.ok) {
            throw new Error('GIPHY API error');
        }

        const data = await response.json() as { data: any[] };

        const gifs: GifMedia[] = data.data.map((gif: any) => ({
            id: gif.id,
            title: gif.title,
            url: gif.images.original.url,
            previewUrl: gif.images.fixed_width_small.url,
            width: parseInt(gif.images.original.width),
            height: parseInt(gif.images.original.height),
            source: 'giphy' as const,
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'gifSearchResults',
            gifs,
            query: 'trending',
            hasMore: false,
            offset: 0,
        });

    } catch (e) {
        console.error('Error getting trending GIFs:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to get trending GIFs' });
    }
}

/**
 * Send a GIF message
 */
export async function handleSendGif(
    senderID: string,
    payload: { favorRequestID: string; gif: GifMedia },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, gif } = payload;

    if (!favorRequestID || !gif) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing required fields' });
        return;
    }

    const messageID = `msg-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const timestamp = Date.now();

    const message = {
        messageID,
        favorRequestID,
        senderID,
        content: gif.title || 'GIF',
        timestamp,
        type: 'gif',
        gifDetails: gif,
        deliveryStatus: 'sent',
    };

    try {
        await ddb.send(new PutCommand({
            TableName: MESSAGES_TABLE,
            Item: message,
        }));

        // Update conversation
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET updatedAt = :now, lastMessagePreview = :preview',
            ExpressionAttributeValues: {
                ':now': new Date().toISOString(),
                ':preview': 'GIF',
            },
        }));

        // Broadcast to participants
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'newMessage',
            message,
        });

    } catch (e) {
        console.error('Error sending GIF:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to send GIF' });
    }
}

// ========================================
// STICKER PACK HANDLERS
// ========================================

// Default sticker packs available to all users
const DEFAULT_STICKER_PACKS: StickerPack[] = [
    {
        packID: 'default-emoji',
        name: 'Classic Emoji',
        description: 'Essential emoji reactions',
        thumbnailUrl: 'https://cdn.todaysdentalinsights.com/stickers/packs/emoji-thumb.png',
        stickerCount: 48,
        category: 'emoji',
        isDefault: true,
        createdAt: '2025-01-01T00:00:00Z',
    },
    {
        packID: 'default-reactions',
        name: 'Quick Reactions',
        description: 'Express yourself with animated reactions',
        thumbnailUrl: 'https://cdn.todaysdentalinsights.com/stickers/packs/reactions-thumb.png',
        stickerCount: 24,
        category: 'reactions',
        isDefault: true,
        createdAt: '2025-01-01T00:00:00Z',
    },
    {
        packID: 'dental-cats',
        name: 'Dental Kitties',
        description: 'Cute dental-themed cats',
        thumbnailUrl: 'https://cdn.todaysdentalinsights.com/stickers/packs/dental-cats-thumb.png',
        stickerCount: 16,
        category: 'animals',
        isDefault: true,
        createdAt: '2025-06-01T00:00:00Z',
    },
];

// Default stickers for each pack
const DEFAULT_STICKERS: Record<string, Sticker[]> = {
    'default-emoji': [
        { stickerID: 'emoji-thumbsup', packID: 'default-emoji', url: 'https://cdn.todaysdentalinsights.com/stickers/emoji/thumbsup.png', altText: 'Thumbs Up', keywords: ['thumbs', 'up', 'approve', 'good'], width: 128, height: 128 },
        { stickerID: 'emoji-heart', packID: 'default-emoji', url: 'https://cdn.todaysdentalinsights.com/stickers/emoji/heart.png', altText: 'Heart', keywords: ['heart', 'love', 'like'], width: 128, height: 128 },
        { stickerID: 'emoji-laugh', packID: 'default-emoji', url: 'https://cdn.todaysdentalinsights.com/stickers/emoji/laugh.png', altText: 'Laughing', keywords: ['laugh', 'funny', 'lol'], width: 128, height: 128 },
        { stickerID: 'emoji-fire', packID: 'default-emoji', url: 'https://cdn.todaysdentalinsights.com/stickers/emoji/fire.png', altText: 'Fire', keywords: ['fire', 'hot', 'lit'], width: 128, height: 128 },
        { stickerID: 'emoji-clap', packID: 'default-emoji', url: 'https://cdn.todaysdentalinsights.com/stickers/emoji/clap.png', altText: 'Clapping', keywords: ['clap', 'applause', 'bravo'], width: 128, height: 128 },
        { stickerID: 'emoji-party', packID: 'default-emoji', url: 'https://cdn.todaysdentalinsights.com/stickers/emoji/party.png', altText: 'Party', keywords: ['party', 'celebrate', 'confetti'], width: 128, height: 128 },
    ],
    'default-reactions': [
        { stickerID: 'react-wow', packID: 'default-reactions', url: 'https://cdn.todaysdentalinsights.com/stickers/reactions/wow.gif', altText: 'Wow', keywords: ['wow', 'amazing', 'surprised'], width: 200, height: 200 },
        { stickerID: 'react-love', packID: 'default-reactions', url: 'https://cdn.todaysdentalinsights.com/stickers/reactions/love.gif', altText: 'Love It', keywords: ['love', 'heart', 'adore'], width: 200, height: 200 },
        { stickerID: 'react-haha', packID: 'default-reactions', url: 'https://cdn.todaysdentalinsights.com/stickers/reactions/haha.gif', altText: 'Haha', keywords: ['haha', 'laugh', 'funny'], width: 200, height: 200 },
        { stickerID: 'react-sad', packID: 'default-reactions', url: 'https://cdn.todaysdentalinsights.com/stickers/reactions/sad.gif', altText: 'Sad', keywords: ['sad', 'cry', 'unhappy'], width: 200, height: 200 },
    ],
    'dental-cats': [
        { stickerID: 'dcat-brush', packID: 'dental-cats', url: 'https://cdn.todaysdentalinsights.com/stickers/dental-cats/brushing.png', altText: 'Cat Brushing Teeth', keywords: ['cat', 'brush', 'teeth', 'hygiene'], width: 256, height: 256 },
        { stickerID: 'dcat-smile', packID: 'dental-cats', url: 'https://cdn.todaysdentalinsights.com/stickers/dental-cats/smile.png', altText: 'Cat Smiling', keywords: ['cat', 'smile', 'happy', 'teeth'], width: 256, height: 256 },
        { stickerID: 'dcat-floss', packID: 'dental-cats', url: 'https://cdn.todaysdentalinsights.com/stickers/dental-cats/floss.png', altText: 'Cat Flossing', keywords: ['cat', 'floss', 'dental'], width: 256, height: 256 },
        { stickerID: 'dcat-dentist', packID: 'dental-cats', url: 'https://cdn.todaysdentalinsights.com/stickers/dental-cats/dentist.png', altText: 'Cat Dentist', keywords: ['cat', 'dentist', 'doctor'], width: 256, height: 256 },
    ],
};

/**
 * Get available sticker packs
 */
export async function handleGetStickerPacks(
    senderID: string,
    payload: Record<string, never>,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    try {
        // TODO: In future, fetch custom packs from DynamoDB for the user's organization
        // For now, return default packs
        await sendToClient(apiGwManagement, connectionId, {
            type: 'stickerPacksList',
            packs: DEFAULT_STICKER_PACKS,
        });
    } catch (e) {
        console.error('Error getting sticker packs:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to get sticker packs' });
    }
}

/**
 * Get stickers in a pack
 */
export async function handleGetStickers(
    senderID: string,
    payload: { packID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { packID } = payload;

    if (!packID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing packID' });
        return;
    }

    try {
        const stickers = DEFAULT_STICKERS[packID] || [];

        await sendToClient(apiGwManagement, connectionId, {
            type: 'stickersList',
            packID,
            stickers,
        });
    } catch (e) {
        console.error('Error getting stickers:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to get stickers' });
    }
}

/**
 * Send a sticker message
 */
export async function handleSendSticker(
    senderID: string,
    payload: { favorRequestID: string; sticker: Sticker },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, sticker } = payload;

    if (!favorRequestID || !sticker) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing required fields' });
        return;
    }

    const messageID = `msg-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const timestamp = Date.now();

    const message = {
        messageID,
        favorRequestID,
        senderID,
        content: sticker.altText,
        timestamp,
        type: 'sticker',
        sticker,
        deliveryStatus: 'sent',
    };

    try {
        await ddb.send(new PutCommand({
            TableName: MESSAGES_TABLE,
            Item: message,
        }));

        // Update conversation
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET updatedAt = :now, lastMessagePreview = :preview',
            ExpressionAttributeValues: {
                ':now': new Date().toISOString(),
                ':preview': `Sticker: ${sticker.altText}`,
            },
        }));

        // Broadcast to participants
        await broadcastToConversation(apiGwManagement, favorRequestID, {
            type: 'newMessage',
            message,
        });

    } catch (e) {
        console.error('Error sending sticker:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to send sticker' });
    }
}

// ========================================
// VOICE/VIDEO CALLING HANDLERS
// ========================================

/**
 * Initiate a voice or video call with Chime SDK meeting
 */
export async function handleInitiateCall(
    senderID: string,
    payload: { favorRequestID: string; callType: CallType; participantIDs: string[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, callType, participantIDs } = payload;

    if (!favorRequestID || !callType || !participantIDs?.length) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing required fields' });
        return;
    }

    const callID = uuidv4();
    const now = new Date().toISOString();

    // Get caller's name
    let callerName = 'Unknown';
    try {
        const connectionResult = await ddb.send(new GetCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId },
        }));
        callerName = connectionResult.Item?.userName || connectionResult.Item?.userID || 'Unknown';
    } catch (e) {
        console.error('Error getting caller name:', e);
    }

    try {
        // Create Chime SDK meeting (dynamic import to avoid cold start overhead)
        let meetingInfo: { meetingId: string; attendeeId: string; joinToken: string } | null = null;
        try {
            const { createMeetingWithAttendee } = await import('./chime-meeting-manager');
            const result = await createMeetingWithAttendee(callID, callType, senderID, callerName);
            meetingInfo = {
                meetingId: result.meeting.meetingId,
                attendeeId: result.attendee.attendeeId,
                joinToken: result.attendee.joinToken,
            };
            console.log(`[Call] Created Chime meeting: ${meetingInfo.meetingId}`);
        } catch (chimeError) {
            console.error('[Call] Failed to create Chime meeting:', chimeError);
            // Continue without Chime - can still use push-based notification
        }

        const call: Call = {
            callID,
            favorRequestID,
            callerID: senderID,
            callerName,
            callType,
            participantIDs: [senderID, ...participantIDs],
            status: 'ringing',
            startedAt: now,
            meetingId: meetingInfo?.meetingId,
        };

        // Store call record
        if (CALLS_TABLE) {
            await ddb.send(new PutCommand({
                TableName: CALLS_TABLE,
                Item: call,
            }));
        }

        // Notify all participants about the incoming call
        for (const participantID of participantIDs) {
            if (participantID === senderID) continue;

            // Try WebSocket first
            const participantConnectionId = await getConnectionIdForUser(participantID);
            if (participantConnectionId) {
                await sendToClient(apiGwManagement, participantConnectionId, {
                    type: 'incomingCall',
                    call,
                    meetingId: meetingInfo?.meetingId,
                });
            }

            // Send push notification for reliability (especially when app is in background)
            try {
                const { sendIncomingCallNotification } = await import('./push-notifications');
                await sendIncomingCallNotification(ddb, participantID, {
                    callID,
                    callerID: senderID,
                    callerName,
                    callType,
                    favorRequestID,
                    meetingId: meetingInfo?.meetingId,
                });
            } catch (pushError) {
                console.warn(`[Call] Failed to send push notification to ${participantID}:`, pushError);
            }
        }

        // Send confirmation and join info to caller
        await sendToClient(apiGwManagement, connectionId, {
            type: 'callStatusUpdate',
            callID,
            status: 'ringing',
            updatedBy: senderID,
            meetingInfo: meetingInfo ? {
                meetingId: meetingInfo.meetingId,
                attendeeId: meetingInfo.attendeeId,
                joinToken: meetingInfo.joinToken,
            } : undefined,
        });

    } catch (e) {
        console.error('Error initiating call:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to initiate call' });
    }
}

/**
 * Join an ongoing call with Chime SDK
 */
export async function handleJoinCall(
    senderID: string,
    payload: { callID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { callID } = payload;

    if (!callID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing callID' });
        return;
    }

    try {
        // Get call record
        let call: Call | undefined;
        if (CALLS_TABLE) {
            const callResult = await ddb.send(new GetCommand({
                TableName: CALLS_TABLE,
                Key: { callID },
            }));
            call = callResult.Item as Call;
        }

        if (!call) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Call not found' });
            return;
        }

        // Update call status if this is the first join
        if (call.status === 'ringing') {
            if (CALLS_TABLE) {
                await ddb.send(new UpdateCommand({
                    TableName: CALLS_TABLE,
                    Key: { callID },
                    UpdateExpression: 'SET #status = :status',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: { ':status': 'connected' },
                }));
            }

            // Notify all participants that call is connected
            for (const participantID of call.participantIDs) {
                const pConnectionId = await getConnectionIdForUser(participantID);
                if (pConnectionId) {
                    await sendToClient(apiGwManagement, pConnectionId, {
                        type: 'callStatusUpdate',
                        callID,
                        status: 'connected',
                        updatedBy: senderID,
                    });
                }
            }
        }

        // Join Chime SDK meeting and get attendee credentials
        let meetingJoinInfo: { meetingId: string; attendeeId: string; joinToken: string } | null = null;
        if (call.meetingId) {
            try {
                const { joinMeeting } = await import('./chime-meeting-manager');
                const result = await joinMeeting(call.meetingId, senderID);
                meetingJoinInfo = {
                    meetingId: result.meeting.meetingId,
                    attendeeId: result.attendee.attendeeId,
                    joinToken: result.attendee.joinToken,
                };
                console.log(`[Call] User ${senderID} joined Chime meeting: ${meetingJoinInfo.meetingId}`);
            } catch (chimeError) {
                console.error('[Call] Failed to join Chime meeting:', chimeError);
            }
        }

        // Return Chime SDK meeting join info
        await sendToClient(apiGwManagement, connectionId, {
            type: 'callJoinInfo',
            callID,
            meetingId: call.meetingId || callID,
            meetingToken: meetingJoinInfo?.joinToken || '',
            attendeeId: meetingJoinInfo?.attendeeId || senderID,
            meeting: meetingJoinInfo ? {
                meetingId: meetingJoinInfo.meetingId,
                attendeeId: meetingJoinInfo.attendeeId,
                joinToken: meetingJoinInfo.joinToken,
            } : undefined,
        });

    } catch (e) {
        console.error('Error joining call:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to join call' });
    }
}

/**
 * End a call and cleanup Chime SDK meeting
 */
export async function handleEndCall(
    senderID: string,
    payload: { callID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { callID } = payload;

    if (!callID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing callID' });
        return;
    }

    try {
        const now = new Date().toISOString();
        let call: Call | undefined;

        if (CALLS_TABLE) {
            const callResult = await ddb.send(new GetCommand({
                TableName: CALLS_TABLE,
                Key: { callID },
            }));
            call = callResult.Item as Call;

            if (call) {
                // Calculate duration
                const startTime = new Date(call.startedAt || now).getTime();
                const endTime = new Date(now).getTime();
                const duration = Math.floor((endTime - startTime) / 1000);

                await ddb.send(new UpdateCommand({
                    TableName: CALLS_TABLE,
                    Key: { callID },
                    UpdateExpression: 'SET #status = :status, endedAt = :endedAt, #duration = :duration',
                    ExpressionAttributeNames: { '#status': 'status', '#duration': 'duration' },
                    ExpressionAttributeValues: {
                        ':status': 'ended',
                        ':endedAt': now,
                        ':duration': duration,
                    },
                }));

                // End Chime SDK meeting
                if (call.meetingId) {
                    try {
                        const { endMeeting } = await import('./chime-meeting-manager');
                        await endMeeting(call.meetingId);
                        console.log(`[Call] Ended Chime meeting: ${call.meetingId}`);
                    } catch (chimeError) {
                        console.warn('[Call] Failed to end Chime meeting:', chimeError);
                    }
                }
            }
        }

        // Notify all participants
        if (call) {
            for (const participantID of call.participantIDs) {
                const pConnectionId = await getConnectionIdForUser(participantID);
                if (pConnectionId) {
                    await sendToClient(apiGwManagement, pConnectionId, {
                        type: 'callStatusUpdate',
                        callID,
                        status: 'ended',
                        updatedBy: senderID,
                        endedAt: now,
                    });
                }
            }
        }

    } catch (e) {
        console.error('Error ending call:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to end call' });
    }
}

/**
 * Decline an incoming call and send missed call notification
 */
export async function handleDeclineCall(
    senderID: string,
    payload: { callID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { callID } = payload;

    if (!callID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing callID' });
        return;
    }

    try {
        // Get call info first
        let call: Call | undefined;
        if (CALLS_TABLE) {
            const callResult = await ddb.send(new GetCommand({
                TableName: CALLS_TABLE,
                Key: { callID },
            }));
            call = callResult.Item as Call;
        }

        // Update call status
        if (CALLS_TABLE) {
            await ddb.send(new UpdateCommand({
                TableName: CALLS_TABLE,
                Key: { callID },
                UpdateExpression: 'SET #status = :status, endedAt = :endedAt',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'declined',
                    ':endedAt': new Date().toISOString(),
                },
            }));
        }

        // End Chime SDK meeting if exists
        if (call?.meetingId) {
            try {
                const { endMeeting } = await import('./chime-meeting-manager');
                await endMeeting(call.meetingId);
                console.log(`[Call] Ended Chime meeting on decline: ${call.meetingId}`);
            } catch (chimeError) {
                console.warn('[Call] Failed to end Chime meeting:', chimeError);
            }
        }

        // Notify caller that call was declined
        if (call) {
            const callerConnectionId = await getConnectionIdForUser(call.callerID);
            if (callerConnectionId) {
                await sendToClient(apiGwManagement, callerConnectionId, {
                    type: 'callStatusUpdate',
                    callID,
                    status: 'declined',
                    updatedBy: senderID,
                });
            }

            // Send missed call notification to caller via push
            try {
                const { sendMissedCallNotification } = await import('./push-notifications');
                await sendMissedCallNotification(ddb, call.callerID, senderID, call.callType);
            } catch (pushError) {
                console.warn('[Call] Failed to send missed call notification:', pushError);
            }
        }

    } catch (e) {
        console.error('Error declining call:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to decline call' });
    }
}

// ========================================
// LINK PREVIEW HANDLER
// ========================================

/**
 * Fetch link preview metadata
 */
export async function handleFetchLinkPreview(
    senderID: string,
    payload: { url: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { url } = payload;

    if (!url) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing URL' });
        return;
    }

    try {
        // Fetch the URL and parse Open Graph tags
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'TodaysDentalBot/1.0 (+https://todaysdentalinsights.com/bot)',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();

        // Parse Open Graph meta tags
        const getMetaContent = (property: string): string | undefined => {
            const match = html.match(new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, 'i'))
                || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, 'i'));
            return match?.[1];
        };

        const getTitleFromHtml = (): string | undefined => {
            const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
            return match?.[1];
        };

        const getDescriptionFromMeta = (): string | undefined => {
            const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
            return match?.[1];
        };

        const preview: LinkPreview = {
            url,
            title: getMetaContent('title') || getTitleFromHtml(),
            description: getMetaContent('description') || getDescriptionFromMeta(),
            image: getMetaContent('image'),
            siteName: getMetaContent('site_name') || new URL(url).hostname,
            fetchedAt: new Date().toISOString(),
        };

        await sendToClient(apiGwManagement, connectionId, {
            type: 'linkPreviewFetched',
            url,
            preview,
        });

    } catch (e) {
        console.error('Error fetching link preview:', e);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'linkPreviewFetched',
            url,
            preview: {
                url,
                siteName: new URL(url).hostname,
                fetchedAt: new Date().toISOString(),
            },
        });
    }
}

// ========================================
// FILES LIST HANDLER
// ========================================

/**
 * Get all files shared in a conversation
 */
export async function handleGetConversationFiles(
    senderID: string,
    payload: { favorRequestID: string; limit?: number; offset?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, limit = 50, offset = 0 } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID' });
        return;
    }

    try {
        // Query messages that are files
        const result = await ddb.send(new QueryCommand({
            TableName: MESSAGES_TABLE,
            KeyConditionExpression: 'favorRequestID = :frid',
            FilterExpression: '#type = :file OR #type = :voice',
            ExpressionAttributeNames: { '#type': 'type' },
            ExpressionAttributeValues: {
                ':frid': favorRequestID,
                ':file': 'file',
                ':voice': 'voice',
            },
        }));

        const allFiles = result.Items || [];

        // Sort by timestamp descending (newest first)
        allFiles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Apply pagination
        const paginatedFiles = allFiles.slice(offset, offset + limit);

        const files = paginatedFiles.map(msg => ({
            fileID: msg.messageID,
            fileKey: msg.fileKey || msg.voiceKey,
            fileName: msg.fileDetails?.fileName || 'Voice message',
            fileType: msg.fileDetails?.fileType || 'audio',
            fileSize: msg.fileDetails?.fileSize || 0,
            uploadedBy: msg.senderID,
            uploadedAt: new Date(msg.timestamp).toISOString(),
            favorRequestID: msg.favorRequestID,
            messageID: msg.messageID,
            downloadCount: msg.downloadCount || 0,
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'filesList',
            favorRequestID,
            files,
            total: allFiles.length,
            hasMore: offset + limit < allFiles.length,
        });

    } catch (e) {
        console.error('Error getting conversation files:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to get files' });
    }
}

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
const TEAMS_TABLE = process.env.TEAMS_TABLE || '';
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

async function getConnectionIdsForUser(userID: string): Promise<string[]> {
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: CONNECTIONS_TABLE,
            // Must match CommStack `ConnectionsTableV4` GSI name
            IndexName: 'UserIDIndex',
            KeyConditionExpression: 'userID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
        }));
        return (result.Items || [])
            .map((item: any) => item?.connectionId)
            .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
    } catch (e) {
        console.error('Error getting connections for user:', e);
        return [];
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

    const participants = new Set<string>();
    if ((favorResult.Item as any).senderID) participants.add(String((favorResult.Item as any).senderID));
    if ((favorResult.Item as any).receiverID) participants.add(String((favorResult.Item as any).receiverID));

    const teamID = (favorResult.Item as any).teamID as string | undefined;
    if (teamID && TEAMS_TABLE) {
        try {
            const teamResult = await ddb.send(new QueryCommand({
                TableName: TEAMS_TABLE,
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
            console.warn('[broadcastToConversation] Failed to load team members:', e);
        }
    }

    for (const userID of participants) {
        if (excludeUserID && userID === excludeUserID) continue;
        const connectionIds = await getConnectionIdsForUser(userID);
        for (const connectionId of connectionIds) {
            await sendToClient(apiGwManagement, connectionId, payload);
        }
    }
}

// ========================================
// MESSAGE DELIVERY STATUS HANDLERS
// ========================================

function parseTimestampLike(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    // numeric string (ms or seconds)
    if (/^\d{10,}$/.test(trimmed)) return Number(trimmed);
    // e.g. msg-1700000000000-abc -> extract the first long digit run
    const match = trimmed.match(/(\d{10,})/);
    return match ? Number(match[1]) : null;
}

function normalizeMessageTimestamps(payload: { timestamps?: unknown; messageIDs?: unknown }): number[] {
    const out: number[] = [];

    if (Array.isArray(payload.timestamps)) {
        for (const t of payload.timestamps) {
            const ts = parseTimestampLike(t);
            if (ts) out.push(ts);
        }
    }

    if (out.length === 0 && Array.isArray(payload.messageIDs)) {
        for (const id of payload.messageIDs) {
            const ts = parseTimestampLike(id);
            if (ts) out.push(ts);
        }
    }

    // De-dupe and keep stable order
    return Array.from(new Set(out)).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Mark messages as delivered when they reach the client
 */
export async function handleMarkDelivered(
    senderID: string,
    payload: { favorRequestID: string; timestamps?: number[]; messageIDs?: string[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;
    const timestamps = normalizeMessageTimestamps(payload);

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID' });
        return;
    }

    if (timestamps.length === 0) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing timestamps' });
        return;
    }

    const now = Date.now();

    for (const timestamp of timestamps) {
        try {
            await ddb.send(new UpdateCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, timestamp },
                ConditionExpression: 'attribute_exists(favorRequestID) AND attribute_exists(#ts)',
                ExpressionAttributeNames: { '#ts': 'timestamp' },
                UpdateExpression: 'SET deliveryStatus = :status, deliveredAt = :at, updatedAt = :at',
                ExpressionAttributeValues: {
                    ':status': 'delivered',
                    ':at': now,
                },
            }));
        } catch (e) {
            // Avoid creating phantom items if client sent bad timestamps
            console.error(`Error marking message ${timestamp} as delivered:`, e);
        }
    }

    // Broadcast delivery status update to conversation participants (including other devices of the same user)
    await broadcastToConversation(apiGwManagement, favorRequestID, {
        type: 'deliveryStatusUpdate',
        favorRequestID,
        timestamps,
        status: 'delivered',
        deliveredAt: now,
        updatedAt: now,
    });
}

/**
 * Mark messages as read with read receipts
 */
export async function handleMarkMessagesRead(
    senderID: string,
    payload: { favorRequestID: string; timestamps?: number[]; messageIDs?: string[] },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;
    const timestamps = normalizeMessageTimestamps(payload);

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID' });
        return;
    }

    if (timestamps.length === 0) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing timestamps' });
        return;
    }

    const now = Date.now();
    const readReceipt: ReadReceipt = { userID: senderID, readAt: now };

    for (const timestamp of timestamps) {
        try {
            // Update each message with the read receipt
            await ddb.send(new UpdateCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID, timestamp },
                ConditionExpression: 'attribute_exists(favorRequestID) AND attribute_exists(#ts)',
                ExpressionAttributeNames: { '#ts': 'timestamp' },
                UpdateExpression: 'SET deliveryStatus = :status, readAt = :at, updatedAt = :at, readBy = list_append(if_not_exists(readBy, :empty), :receipt)',
                ExpressionAttributeValues: {
                    ':status': 'read',
                    ':at': now,
                    ':receipt': [readReceipt],
                    ':empty': [],
                },
            }));
        } catch (e) {
            console.error(`Error marking message ${timestamp} as read:`, e);
        }
    }

    // Broadcast read receipts to conversation participants
    await broadcastToConversation(apiGwManagement, favorRequestID, {
        type: 'deliveryStatusUpdate',
        favorRequestID,
        timestamps,
        status: 'read',
        readBy: [readReceipt],
        updatedAt: now,
    });
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
    payload: { favorRequestID: string; voiceKey: string; duration: number; waveformData?: number[]; parentMessageID?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, voiceKey, duration, waveformData, parentMessageID } = payload;

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
        ...(parentMessageID && { parentMessageID }),
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
 * Pin a conversation — saves pinnedBy array on the FavorRequest record
 */
export async function handlePinConversation(
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
        // Add senderID to the pinnedBy set on the FavorRequest record
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'ADD pinnedBy :userSet',
            ExpressionAttributeValues: {
                ':userSet': new Set([senderID]),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'conversationPinned',
            favorRequestID,
            pinned: true,
        });
    } catch (e) {
        console.error('Error pinning conversation:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to pin conversation' });
    }
}

/**
 * Unpin a conversation — removes user from pinnedBy array on the FavorRequest record
 */
export async function handleUnpinConversation(
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
        // Remove senderID from the pinnedBy set on the FavorRequest record
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'DELETE pinnedBy :userSet',
            ExpressionAttributeValues: {
                ':userSet': new Set([senderID]),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'conversationPinned',
            favorRequestID,
            pinned: false,
        });
    } catch (e) {
        console.error('Error unpinning conversation:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to unpin conversation' });
    }
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
    payload: { favorRequestID: string; gif: GifMedia; parentMessageID?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, gif, parentMessageID } = payload;

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
        ...(parentMessageID && { parentMessageID }),
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
    payload: { favorRequestID: string; sticker: Sticker; parentMessageID?: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, sticker, parentMessageID } = payload;

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
        ...(parentMessageID && { parentMessageID }),
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

    if (!CALLS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Calls table not configured.' });
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
        // Create Chime SDK meeting + first attendee (caller)
        const { createMeetingWithAttendee } = await import('./chime-meeting-manager');
        const meetingJoinInfo = await createMeetingWithAttendee(callID, callType, senderID, callerName);
        console.log(`[Call] Created Chime meeting: ${meetingJoinInfo.meeting.MeetingId}`);

        const uniqueParticipantIDs = Array.from(
            new Set([senderID, ...(participantIDs || [])].filter(Boolean))
        );

        const call: Call = {
            callID,
            favorRequestID,
            callerID: senderID,
            callerName,
            callType,
            participantIDs: uniqueParticipantIDs,
            status: 'ringing',
            startedAt: now,
            meetingId: meetingJoinInfo.meeting.MeetingId,
        };

        // Store call record
        await ddb.send(new PutCommand({
            TableName: CALLS_TABLE,
            Item: {
                ...call,
                // Auto-expire call records (24h). Keeps table small while allowing short-term history/debugging.
                ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
            },
        }));

        // Notify all participants about the incoming call
        for (const participantID of participantIDs) {
            if (participantID === senderID) continue;

            // Try WebSocket first
            const participantConnectionIds = await getConnectionIdsForUser(participantID);
            for (const participantConnectionId of participantConnectionIds) {
                await sendToClient(apiGwManagement, participantConnectionId, {
                    type: 'incomingCall',
                    call,
                    meetingId: meetingJoinInfo.meeting.MeetingId,
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
                    meetingId: meetingJoinInfo.meeting.MeetingId,
                });
            } catch (pushError) {
                console.warn(`[Call] Failed to send push notification to ${participantID}:`, pushError);
            }
        }

        // Send full call object to caller
        await sendToClient(apiGwManagement, connectionId, {
            type: 'callInitiated',
            call,
        });

        // Send Chime SDK meeting join info to caller (so the initiator can join immediately)
        await sendToClient(apiGwManagement, connectionId, {
            type: 'callJoinInfo',
            callID,
            meetingId: meetingJoinInfo.meeting.MeetingId,
            meetingToken: meetingJoinInfo.attendee.JoinToken,
            attendeeId: meetingJoinInfo.attendee.AttendeeId,
            externalMeetingId: meetingJoinInfo.meeting.ExternalMeetingId,
            meeting: meetingJoinInfo.meeting,
            attendee: meetingJoinInfo.attendee,
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

    if (!CALLS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Calls table not configured.' });
        return;
    }

    try {
        // Get call record
        let call: Call | undefined;
        const callResult = await ddb.send(new GetCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
        }));
        call = callResult.Item as Call;

        if (!call) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Call not found' });
            return;
        }

        // Join Chime SDK meeting and get attendee credentials (required for media to work)
        if (!call.meetingId) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Call is missing meeting information' });
            return;
        }

        let meetingJoinInfo: any;
        try {
            const { joinMeeting } = await import('./chime-meeting-manager');
            meetingJoinInfo = await joinMeeting(call.meetingId, senderID);
            console.log(`[Call] User ${senderID} joined Chime meeting: ${meetingJoinInfo.meeting.MeetingId}`);
        } catch (chimeError) {
            console.error('[Call] Failed to join Chime meeting:', chimeError);
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to join call media session' });
            return;
        }

        // Update call status only after a successful media join (first join transitions ringing -> connected)
        if (call.status === 'ringing') {
            await ddb.send(new UpdateCommand({
                TableName: CALLS_TABLE,
                Key: { callID },
                UpdateExpression: 'SET #status = :status',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':status': 'connected' },
            }));

            // Notify all participants that call is connected
            for (const participantID of call.participantIDs) {
                const pConnectionIds = await getConnectionIdsForUser(participantID);
                for (const pConnectionId of pConnectionIds) {
                    await sendToClient(apiGwManagement, pConnectionId, {
                        type: 'callStatusUpdate',
                        callID,
                        status: 'connected',
                        updatedBy: senderID,
                    });
                }
            }
        }

        // Return Chime SDK meeting join info (must include meeting + attendee)
        await sendToClient(apiGwManagement, connectionId, {
            type: 'callJoinInfo',
            callID,
            meetingId: meetingJoinInfo.meeting.MeetingId,
            meetingToken: meetingJoinInfo.attendee.JoinToken,
            attendeeId: meetingJoinInfo.attendee.AttendeeId,
            externalMeetingId: meetingJoinInfo.meeting.ExternalMeetingId,
            meeting: meetingJoinInfo.meeting,
            attendee: meetingJoinInfo.attendee,
        });

    } catch (e) {
        console.error('Error joining call:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to join call' });
    }
}

/**
 * Leave an ongoing call.
 * For 2-party calls this automatically ends the call for everyone.
 * For multi-party calls it removes the leaver and ends the call only when nobody is left.
 */
export async function handleLeaveCall(
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
    if (!CALLS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Calls table not configured.' });
        return;
    }

    try {
        const callResult = await ddb.send(new GetCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
        }));
        const call = callResult.Item as Call | undefined;

        if (!call) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Call not found' });
            return;
        }

        // Notify participants that this user left (UI-only; media is handled client-side by Chime SDK)
        for (const participantID of call.participantIDs || []) {
            const pConnectionIds = await getConnectionIdsForUser(participantID);
            for (const pConnectionId of pConnectionIds) {
                await sendToClient(apiGwManagement, pConnectionId, {
                    type: 'callParticipantUpdate',
                    callID,
                    action: 'left',
                    participantID: senderID,
                    participantName: senderID,
                });
            }
        }

        // Auto-end the call if this is a 2-party call or if everyone has left.
        // For a standard 2-party call, leaving = ending for both sides.
        const totalParticipants = (call.participantIDs || []).length;
        const shouldAutoEnd = totalParticipants <= 2 || call.status === 'connected';

        if (shouldAutoEnd && (call.status === 'connected' || call.status === 'ringing')) {
            console.log(`[Call] Auto-ending call ${callID} — participant ${senderID} left a ${totalParticipants}-party call`);

            const now = new Date().toISOString();
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
                    console.log(`[Call] Ended Chime meeting on leave: ${call.meetingId}`);
                } catch (chimeError) {
                    console.warn('[Call] Failed to end Chime meeting on leave:', chimeError);
                }
            }

            // Notify all participants that call has ended
            for (const participantID of call.participantIDs || []) {
                const pConnectionIds = await getConnectionIdsForUser(participantID);
                for (const pConnectionId of pConnectionIds) {
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
        console.error('Error leaving call:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to leave call' });
    }
}

/**
 * Update mute state (UI-only broadcast)
 */
export async function handleMuteCall(
    senderID: string,
    payload: { callID: string; muted: boolean },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { callID, muted } = payload;
    if (!callID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing callID' });
        return;
    }
    if (!CALLS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Calls table not configured.' });
        return;
    }

    try {
        const callResult = await ddb.send(new GetCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
        }));
        const call = callResult.Item as Call | undefined;
        if (!call) return;

        const action = muted ? 'muted' : 'unmuted';
        for (const participantID of call.participantIDs || []) {
            const pConnectionIds = await getConnectionIdsForUser(participantID);
            for (const pConnectionId of pConnectionIds) {
                await sendToClient(apiGwManagement, pConnectionId, {
                    type: 'callParticipantUpdate',
                    callID,
                    action,
                    participantID: senderID,
                    participantName: senderID,
                });
            }
        }
    } catch (e) {
        console.error('Error updating mute state:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to update mute state' });
    }
}

/**
 * Update video state (UI-only broadcast)
 */
export async function handleToggleVideo(
    senderID: string,
    payload: { callID: string; videoOn: boolean },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { callID, videoOn } = payload;
    if (!callID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing callID' });
        return;
    }
    if (!CALLS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Calls table not configured.' });
        return;
    }

    try {
        const callResult = await ddb.send(new GetCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
        }));
        const call = callResult.Item as Call | undefined;
        if (!call) return;

        const action = videoOn ? 'videoOn' : 'videoOff';
        for (const participantID of call.participantIDs || []) {
            const pConnectionIds = await getConnectionIdsForUser(participantID);
            for (const pConnectionId of pConnectionIds) {
                await sendToClient(apiGwManagement, pConnectionId, {
                    type: 'callParticipantUpdate',
                    callID,
                    action,
                    participantID: senderID,
                    participantName: senderID,
                });
            }
        }
    } catch (e) {
        console.error('Error updating video state:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to update video state' });
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
                const pConnectionIds = await getConnectionIdsForUser(participantID);
                for (const pConnectionId of pConnectionIds) {
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

        // Guard: only decline calls still in 'ringing' state.
        // If someone already answered or the call ended, don't blow away the session.
        if (call && call.status !== 'ringing') {
            console.log(`[Call] Decline ignored for call ${callID} — already in '${call.status}' state`);
            await sendToClient(apiGwManagement, connectionId, {
                type: 'callStatusUpdate',
                callID,
                status: call.status,
                updatedBy: 'system',
            });
            return;
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
            const callerConnectionIds = await getConnectionIdsForUser(call.callerID);
            for (const callerConnectionId of callerConnectionIds) {
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


/**
 * Accept an incoming call (explicit ringing → connected transition)
 * This notifies all participants that the call was accepted before media setup.
 */
export async function handleAcceptCall(
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

    if (!CALLS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Calls table not configured.' });
        return;
    }

    try {
        const callResult = await ddb.send(new GetCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
        }));
        const call = callResult.Item as Call | undefined;

        if (!call) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Call not found or expired' });
            return;
        }

        if (call.status !== 'ringing') {
            await sendToClient(apiGwManagement, connectionId, {
                type: 'error',
                message: `Cannot accept call in '${call.status}' state`,
            });
            return;
        }

        // Transition ringing → connected
        await ddb.send(new UpdateCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
            UpdateExpression: 'SET #status = :status, acceptedAt = :acceptedAt, acceptedBy = :acceptedBy',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'connected',
                ':acceptedAt': new Date().toISOString(),
                ':acceptedBy': senderID,
            },
        }));

        // Notify ALL participants about acceptance (stops ringing on other devices)
        for (const participantID of call.participantIDs) {
            const pConnectionIds = await getConnectionIdsForUser(participantID);
            for (const pConnectionId of pConnectionIds) {
                await sendToClient(apiGwManagement, pConnectionId, {
                    type: 'callStatusUpdate',
                    callID,
                    status: 'connected',
                    updatedBy: senderID,
                });
            }
        }

        console.log(`[Call] Call ${callID} accepted by ${senderID}`);
    } catch (e) {
        console.error('Error accepting call:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to accept call' });
    }
}

/**
 * Handle call timeout — auto-end a ringing call that wasn't answered.
 * The caller's frontend triggers this after the timeout elapses (default 30s).
 */
export async function handleCallTimeout(
    senderID: string,
    payload: { callID: string },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { callID } = payload;

    if (!callID || !CALLS_TABLE) return;

    try {
        const callResult = await ddb.send(new GetCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
        }));
        const call = callResult.Item as Call | undefined;

        if (!call || call.status !== 'ringing') {
            // Already answered, declined, or expired — nothing to do
            return;
        }

        const now = new Date().toISOString();

        // Mark as missed
        await ddb.send(new UpdateCommand({
            TableName: CALLS_TABLE,
            Key: { callID },
            UpdateExpression: 'SET #status = :status, endedAt = :endedAt',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'missed',
                ':endedAt': now,
            },
        }));

        // Clean up Chime meeting
        if (call.meetingId) {
            try {
                const { endMeeting } = await import('./chime-meeting-manager');
                await endMeeting(call.meetingId);
            } catch (chimeError) {
                console.warn('[Call] Failed to end Chime meeting on timeout:', chimeError);
            }
        }

        // Notify all participants that the call timed out
        for (const participantID of call.participantIDs) {
            const pConnectionIds = await getConnectionIdsForUser(participantID);
            for (const pConnectionId of pConnectionIds) {
                await sendToClient(apiGwManagement, pConnectionId, {
                    type: 'callStatusUpdate',
                    callID,
                    status: 'missed',
                    updatedBy: 'system',
                    endedAt: now,
                });
            }
        }

        // Send missed call push notifications to non-caller participants
        for (const participantID of call.participantIDs) {
            if (participantID === call.callerID) continue;
            try {
                const { sendMissedCallNotification } = await import('./push-notifications');
                await sendMissedCallNotification(ddb, participantID, call.callerName, call.callType);
            } catch (pushError) {
                console.warn(`[Call] Failed to send missed call push to ${participantID}:`, pushError);
            }
        }

        console.log(`[Call] Call ${callID} timed out after no answer`);
    } catch (e) {
        console.error('Error handling call timeout:', e);
    }
}

/**
 * Fetch call history for the current user (optionally filtered by conversation)
 */
export async function handleGetCallHistory(
    senderID: string,
    payload: { favorRequestID?: string; limit?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    if (!CALLS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Calls table not configured' });
        return;
    }

    const { favorRequestID, limit = 50 } = payload;

    try {
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        const filterExpression = favorRequestID
            ? 'favorRequestID = :frid AND contains(participantIDs, :uid)'
            : 'contains(participantIDs, :uid)';
        const expressionValues: Record<string, any> = { ':uid': senderID };
        if (favorRequestID) expressionValues[':frid'] = favorRequestID;

        const scanResult = await ddb.send(new ScanCommand({
            TableName: CALLS_TABLE,
            FilterExpression: filterExpression,
            ExpressionAttributeValues: expressionValues,
        }));

        const calls = (scanResult.Items || []) as Call[];
        // Sort by startedAt descending (newest first)
        calls.sort((a, b) => new Date(b.startedAt || '').getTime() - new Date(a.startedAt || '').getTime());

        await sendToClient(apiGwManagement, connectionId, {
            type: 'callHistory',
            calls: calls.slice(0, limit),
            favorRequestID: favorRequestID || null,
        });
    } catch (e) {
        console.error('Error fetching call history:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to fetch call history' });
    }
}



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

// ========================================
// MESSAGE FORWARDING HANDLERS
// ========================================

/**
 * Forward one or more messages to one or more conversations.
 * Creates a copy of each message in each target conversation with `forwardedFrom` metadata.
 */
export async function handleForwardMessage(
    senderID: string,
    payload: {
        sourceMessages: { favorRequestID: string; timestamp: number }[];
        targetFavorRequestIDs: string[];
    },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { sourceMessages, targetFavorRequestIDs } = payload;

    if (!sourceMessages?.length || !targetFavorRequestIDs?.length) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Missing sourceMessages or targetFavorRequestIDs',
        });
        return;
    }

    const forwardedMessages: any[] = [];

    for (const src of sourceMessages) {
        // 1. Fetch the original message
        let originalMessage: any;
        try {
            const result = await ddb.send(new GetCommand({
                TableName: MESSAGES_TABLE,
                Key: { favorRequestID: src.favorRequestID, timestamp: src.timestamp },
            }));
            originalMessage = result.Item;
        } catch (e) {
            console.error('Error fetching source message:', e);
            continue;
        }

        if (!originalMessage) continue;

        // 2. For each target conversation, create a forwarded copy
        for (const targetFavorRequestID of targetFavorRequestIDs) {
            const newTimestamp = Date.now();
            const forwardedMessage = {
                messageID: `fwd-${newTimestamp}-${uuidv4().substring(0, 8)}`,
                favorRequestID: targetFavorRequestID,
                senderID,
                content: originalMessage.content || '',
                timestamp: newTimestamp,
                type: originalMessage.type || 'text',
                // Copy ALL media-related fields
                fileKey: originalMessage.fileKey,
                fileDetails: originalMessage.fileDetails,
                voiceKey: originalMessage.voiceKey,
                voiceDetails: originalMessage.voiceDetails,
                gifDetails: originalMessage.gifDetails,
                sticker: originalMessage.sticker,
                deliveryStatus: 'sent',
                forwardedFrom: {
                    originalSenderID: originalMessage.senderID,
                    originalFavorRequestID: src.favorRequestID,
                    originalTimestamp: src.timestamp,
                    originalContent: originalMessage.content?.substring(0, 200),
                },
            };

            try {
                await ddb.send(new PutCommand({
                    TableName: MESSAGES_TABLE,
                    Item: forwardedMessage,
                }));

                // Update lastMessage on target conversation — type-aware preview
                let lastPreview: string;
                switch (originalMessage.type) {
                    case 'file':
                        lastPreview = '↪ Forwarded: 📎 Attachment';
                        break;
                    case 'voice':
                        lastPreview = '↪ Forwarded: 🎤 Voice message';
                        break;
                    case 'gif':
                        lastPreview = '↪ Forwarded: 🎬 GIF';
                        break;
                    case 'sticker':
                        lastPreview = `↪ Forwarded: Sticker`;
                        break;
                    default:
                        lastPreview = `↪ Forwarded: ${(originalMessage.content || '').substring(0, 80)}`;
                        break;
                }

                await ddb.send(new UpdateCommand({
                    TableName: FAVORS_TABLE,
                    Key: { favorRequestID: targetFavorRequestID },
                    UpdateExpression: 'SET lastMessage = :lm, lastMessageAt = :lma, lastMessageSenderID = :lms, updatedAt = :ua',
                    ExpressionAttributeValues: {
                        ':lm': lastPreview,
                        ':lma': new Date().toISOString(),
                        ':lms': senderID,
                        ':ua': new Date().toISOString(),
                    },
                }));

                // Broadcast to target conversation participants
                await broadcastToConversation(apiGwManagement, targetFavorRequestID, {
                    type: 'newMessage',
                    message: forwardedMessage,
                });

                forwardedMessages.push(forwardedMessage);
            } catch (e) {
                console.error(`Error forwarding message to ${targetFavorRequestID}:`, e);
            }
        }
    }

    // Confirm forwarding to the sender
    await sendToClient(apiGwManagement, connectionId, {
        type: 'messagesForwarded',
        count: forwardedMessages.length,
        targetFavorRequestIDs,
    });
}

// ========================================
// STAR / UNSTAR MESSAGE HANDLERS
// ========================================

/**
 * Star a message (saves a starredMessages attribute directly on the message).
 */
export async function handleStarMessage(
    senderID: string,
    payload: { favorRequestID: string; timestamp: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, timestamp } = payload;

    if (!favorRequestID || !timestamp) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Missing favorRequestID or timestamp',
        });
        return;
    }

    try {
        await ddb.send(new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp },
            ConditionExpression: 'attribute_exists(favorRequestID) AND attribute_exists(#ts)',
            ExpressionAttributeNames: { '#ts': 'timestamp' },
            UpdateExpression: 'ADD starredBy :userSet',
            ExpressionAttributeValues: {
                ':userSet': new Set([senderID]),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'messageStarred',
            favorRequestID,
            timestamp,
        });
    } catch (e) {
        console.error('Error starring message:', e);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to star message',
        });
    }
}

/**
 * Unstar a message.
 */
export async function handleUnstarMessage(
    senderID: string,
    payload: { favorRequestID: string; timestamp: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, timestamp } = payload;

    if (!favorRequestID || !timestamp) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Missing favorRequestID or timestamp',
        });
        return;
    }

    try {
        await ddb.send(new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp },
            ConditionExpression: 'attribute_exists(favorRequestID) AND attribute_exists(#ts)',
            ExpressionAttributeNames: { '#ts': 'timestamp' },
            UpdateExpression: 'DELETE starredBy :userSet',
            ExpressionAttributeValues: {
                ':userSet': new Set([senderID]),
            },
        }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'messageUnstarred',
            favorRequestID,
            timestamp,
        });
    } catch (e) {
        console.error('Error unstarring message:', e);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to unstar message',
        });
    }
}

/**
 * Get all starred messages for the current user across all conversations (or for a specific conversation).
 */
export async function handleGetStarredMessages(
    senderID: string,
    payload: { favorRequestID?: string; limit?: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, limit = 50 } = payload;

    try {
        let starredMessages: any[] = [];

        if (favorRequestID) {
            // Get starred messages for a specific conversation
            const result = await ddb.send(new QueryCommand({
                TableName: MESSAGES_TABLE,
                KeyConditionExpression: 'favorRequestID = :frid',
                FilterExpression: 'contains(starredBy, :userID)',
                ExpressionAttributeValues: {
                    ':frid': favorRequestID,
                    ':userID': senderID,
                },
            }));
            starredMessages = result.Items || [];
        } else {
            // Scan all messages for this user's stars (less efficient, but necessary for cross-conversation)
            const result = await ddb.send(new ScanCommand({
                TableName: MESSAGES_TABLE,
                FilterExpression: 'contains(starredBy, :userID)',
                ExpressionAttributeValues: {
                    ':userID': senderID,
                },
                Limit: limit * 3, // Over-fetch since Scan limit applies before filter
            }));
            starredMessages = result.Items || [];
        }

        // Sort by timestamp descending
        starredMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        starredMessages = starredMessages.slice(0, limit);

        await sendToClient(apiGwManagement, connectionId, {
            type: 'starredMessagesList',
            messages: starredMessages,
            total: starredMessages.length,
        });
    } catch (e) {
        console.error('Error getting starred messages:', e);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to get starred messages',
        });
    }
}

// ========================================
// MESSAGE INFO HANDLER
// ========================================

/**
 * Get detailed delivery info for a message (sent, delivered, read times per recipient).
 * WhatsApp-style "Message Info" screen.
 */
export async function handleGetMessageInfo(
    senderID: string,
    payload: { favorRequestID: string; timestamp: number },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, timestamp } = payload;

    if (!favorRequestID || !timestamp) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Missing favorRequestID or timestamp',
        });
        return;
    }

    try {
        // Get the message
        const msgResult = await ddb.send(new GetCommand({
            TableName: MESSAGES_TABLE,
            Key: { favorRequestID, timestamp },
        }));

        const message = msgResult.Item;
        if (!message) {
            await sendToClient(apiGwManagement, connectionId, {
                type: 'error',
                message: 'Message not found',
            });
            return;
        }

        // Get conversation participants
        const favorResult = await ddb.send(new GetCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
        }));
        const favor = favorResult.Item;
        if (!favor) {
            await sendToClient(apiGwManagement, connectionId, {
                type: 'error',
                message: 'Conversation not found',
            });
            return;
        }

        // Build participant list
        const participants = new Set<string>();
        if ((favor as any).senderID) participants.add(String((favor as any).senderID));
        if ((favor as any).receiverID) participants.add(String((favor as any).receiverID));

        const teamID = (favor as any).teamID as string | undefined;
        if (teamID && TEAMS_TABLE) {
            try {
                const teamResult = await ddb.send(new QueryCommand({
                    TableName: TEAMS_TABLE,
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
                console.warn('Failed to load team for message info:', e);
            }
        }

        // Build per-recipient delivery info
        const readByMap = new Map<string, number>();
        if (Array.isArray(message.readBy)) {
            for (const receipt of message.readBy) {
                readByMap.set(receipt.userID, receipt.readAt);
            }
        }

        const recipientInfo = Array.from(participants)
            .filter(uid => uid !== message.senderID)
            .map(uid => ({
                userID: uid,
                sentAt: message.timestamp,
                deliveredAt: message.deliveredAt || null,
                readAt: readByMap.get(uid) || null,
            }));

        await sendToClient(apiGwManagement, connectionId, {
            type: 'messageInfo',
            favorRequestID,
            timestamp,
            senderID: message.senderID,
            content: message.content,
            messageType: message.type || 'text',
            sentAt: message.timestamp,
            deliveryStatus: message.deliveryStatus || 'sent',
            recipients: recipientInfo,
            starredBy: message.starredBy ? Array.from(message.starredBy) : [],
            forwardedFrom: message.forwardedFrom || null,
        });
    } catch (e) {
        console.error('Error getting message info:', e);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to get message info',
        });
    }
}

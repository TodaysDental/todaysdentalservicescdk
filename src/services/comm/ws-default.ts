import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, DeleteCommand, GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { v4 as uuidv4 } from 'uuid';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
    handleAddReaction, handleRemoveReaction,
    handleReplyToThread, handleGetThreadReplies,
    handleEditMessage, handleDeleteMessage,
    handleTypingStart, handleTypingStop,
    handleSetPresence, handleGetPresence,
    handlePinMessage, handleUnpinMessage, handleGetPinnedMessages,
    handleAddBookmark, handleRemoveBookmark, handleGetBookmarks,
    handleSearch,
    handleScheduleMessage, handleCancelScheduledMessage, handleGetScheduledMessages,
    handleCreateChannel, handleJoinChannel, handleLeaveChannel, handleListChannels, handleArchiveChannel,
} from './messaging-features-handlers';
import {
    handleMarkDelivered, handleMarkMessagesRead,
    handleGetVoiceUploadUrl, handleSendVoiceMessage,
    handleUpdateConversationSettings, handleMuteConversation, handleUnmuteConversation,
    handleArchiveConversation, handlePinConversation,
    handleGetConversationAnalytics,
    handleSearchGifs, handleGetTrendingGifs, handleSendGif,
    handleGetStickerPacks, handleGetStickers, handleSendSticker,
    handleInitiateCall, handleJoinCall, handleLeaveCall, handleEndCall, handleDeclineCall, handleAcceptCall, handleCallTimeout, handleGetCallHistory, handleMuteCall, handleToggleVideo,
    handleFetchLinkPreview, handleGetConversationFiles,
    handleForwardMessage, handleStarMessage, handleUnstarMessage, handleGetStarredMessages, handleGetMessageInfo,
} from './enhanced-messaging-handlers';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || '';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const TEAMS_TABLE = process.env.TEAMS_TABLE || '';
const MEETINGS_TABLE = process.env.MEETINGS_TABLE || '';
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';
const NOTIFICATIONS_TOPIC_ARN = process.env.NOTICES_TOPIC_ARN || '';
const SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || 'no-reply@todaysdentalinsights.com';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

// Push Notifications Integration
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';
const SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || '';
const PUSH_NOTIFICATIONS_ENABLED = !!(DEVICE_TOKENS_TABLE && SEND_PUSH_FUNCTION_ARN);

// System Modules (from shared/types/user.ts)
const SYSTEM_MODULES = ['HR', 'Accounting', 'Operations', 'Finance', 'Marketing', 'Legal', 'IT'] as const;
type SystemModule = typeof SYSTEM_MODULES[number];

// SDK Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sns = new SNSClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const ses = new SESv2Client({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });

// ========================================
// TYPES
// ========================================

interface SenderInfo {
    connectionId: string;
    userID: string; // Cognito 'sub'
}

// NEW: Interface for Team/Group Metadata
interface Team {
    teamID: string;
    ownerID: string;
    name: string;
    description?: string;
    members: string[]; // Set of userID strings
    admins: string[];  // Users with admin privileges (owner is always admin)
    createdAt: string;
    updatedAt: string;
}

// Task status values
type TaskStatus = 'pending' | 'active' | 'in_progress' | 'completed' | 'rejected' | 'forwarded' | 'deleted';
type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

/**
 * Safely fetches a team by teamID using QueryCommand instead of GetCommand.
 * This handles both cases:
 *   1. Table has only PK (teamID) — Query works like Get
 *   2. Table has composite key (teamID + ownerID) — Query still works (only needs PK)
 * GetCommand would fail with "The provided key element does not match the schema"
 * if the table has a sort key and we don't provide it.
 */
async function getTeamByID(teamID: string): Promise<Team | undefined> {
    if (!TEAMS_TABLE) return undefined;
    const result = await ddb.send(new QueryCommand({
        TableName: TEAMS_TABLE,
        KeyConditionExpression: 'teamID = :tid',
        ExpressionAttributeValues: { ':tid': teamID },
        Limit: 1,
    }));
    return (result.Items?.[0] as Team) || undefined;
}

interface ForwardRecord {
    forwardID: string;
    fromUserID: string;
    toUserID: string;
    forwardedAt: string;
    message?: string;
    deadline?: string;
    requireAcceptance: boolean;
    status: 'pending' | 'accepted' | 'rejected';
    acceptedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
}

interface FavorRequest {
    favorRequestID: string;
    senderID: string;
    receiverID?: string;
    teamID?: string;

    // Enhanced task fields
    title?: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    category?: SystemModule;
    tags?: string[];

    // Forwarding chain
    forwardingChain?: ForwardRecord[];
    currentAssigneeID?: string;
    requiresAcceptance?: boolean;

    // Completion/Rejection
    completedAt?: string;
    completionNotes?: string;
    rejectionReason?: string;
    rejectedAt?: string;

    // Existing fields
    createdAt: string;
    updatedAt: string;
    userID: string;
    requestType: 'General' | 'Assign Task' | 'Ask a Favor' | 'Other';
    unreadCount: number;
    initialMessage: string;
    deadline?: string;
    isMainGroupChat?: boolean; // WhatsApp-style main group chat flag

    // WhatsApp sidebar preview fields
    lastMessage?: string;
    lastMessageAt?: string;
    lastMessageSenderID?: string;

    // Per-user deletion: list of userIDs who have deleted this conversation from their view
    deletedBy?: string[];

    // Task badge: true when this conversation was created via task assignment
    isTask?: boolean;

    // Forwarded badge: true when the task has been forwarded
    isForwarded?: boolean;

    // Deterministic participant key for dedup: sorted userIDs joined with '#'
    // e.g. for 1-on-1: "userA#userB" (alphabetically sorted)
    participantKey?: string;
}

interface Meeting {
    meetingID: string;
    conversationID: string;
    title?: string;
    description: string;
    startTime: string;
    endTime?: string;
    location?: string;
    meetingLink?: string;
    organizerID: string;
    participants: string[];
    status: 'scheduled' | 'completed' | 'cancelled';
    reminder?: {
        enabled: boolean;
        minutesBefore: number;
    };
    createdAt: string;
    updatedAt: string;
}

interface FileDetails {
    fileName: string;
    fileType: string;
    fileSize: number; // in bytes
}

interface MessageData {
    messageID?: string;
    favorRequestID: string;
    senderID: string;
    content: string;
    timestamp: number;
    type: 'text' | 'file' | 'system';
    fileKey?: string;
    fileDetails?: FileDetails;
}

// ========================================
// MAIN HANDLER
// ========================================

/**
 * The main handler for all non-route-specific WebSocket messages.
 * It routes the message based on the 'action' field in the payload.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId as string;
    const domainName = event.requestContext.domainName as string;
    const stage = event.requestContext.stage as string;

    const apiGwManagement = new ApiGatewayManagementApiClient({
        region: REGION,
        endpoint: `https://${domainName}/${stage}`,
    });

    try {
        const payload = JSON.parse(event.body || '{}');
        const senderInfo = await getSenderInfo(connectionId);
        if (!senderInfo) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Connection not authenticated' });
            return { statusCode: 401, body: 'Unauthorized or connection missing' };
        }
        const senderID = senderInfo.userID;

        switch (payload.action) {
            case 'ping':
                // Heartbeat ping from client. No-op to keep the connection alive.
                break;
            case 'createTeam': // Create a new team/group
                await createTeam(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'listTeams': // List all teams the user is a member of
                await listTeams(senderID, connectionId, apiGwManagement);
                break;
            case 'addUserToTeam': // Add a user to an existing team (owner only)
                await addUserToTeam(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'removeUserFromTeam': // Remove a user from a team (owner only)
                await removeUserFromTeam(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'startFavorRequest':
                await startFavorRequest(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'sendMessage':
                await sendMessage(senderID, payload, apiGwManagement);
                break;
            case 'resolveRequest':
                await resolveRequest(senderID, payload, apiGwManagement);
                break;
            case 'getPresignedUrl':
                await getPresignedUrl(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getPresignedDownloadUrl':
                await getPresignedDownloadUrl(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'fetchHistory':
                await fetchHistory(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'markRead':
                await markRead(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'fetchRequests':
                await fetchRequests(senderID, payload, connectionId, apiGwManagement);
                break;
            // Task Management Actions
            case 'forwardTask':
                await forwardTask(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'acceptForwardedTask':
                await respondToForward(senderID, payload, 'accept', connectionId, apiGwManagement);
                break;
            case 'rejectForwardedTask':
                await respondToForward(senderID, payload, 'reject', connectionId, apiGwManagement);
                break;
            case 'markTaskCompleted':
                await markTaskCompleted(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'updateTaskDeadline':
                await updateTaskDeadline(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getTaskDetails':
                await getTaskDetails(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getForwardHistory':
                await getForwardHistory(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'deleteConversation':
                await deleteConversation(senderID, payload, connectionId, apiGwManagement);
                break;
            // Meeting Actions
            case 'scheduleMeeting':
                await scheduleMeeting(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getMeetings':
                await getMeetings(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'updateMeeting':
                await updateMeeting(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'deleteMeeting':
                await deleteMeeting(senderID, payload, connectionId, apiGwManagement);
                break;

            // ======= SLACK-LIKE FEATURES =======
            // Reactions
            case 'addReaction':
                await handleAddReaction(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'removeReaction':
                await handleRemoveReaction(senderID, payload, connectionId, apiGwManagement);
                break;

            // Threads
            case 'replyToThread':
                await handleReplyToThread(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getThreadReplies':
                await handleGetThreadReplies(senderID, payload, connectionId, apiGwManagement);
                break;

            // Edit/Delete
            case 'editMessage':
                await handleEditMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'deleteMessage':
                await handleDeleteMessage(senderID, payload, connectionId, apiGwManagement);
                break;

            // Typing Indicators
            case 'typingStart':
                await handleTypingStart(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'typingStop':
                await handleTypingStop(senderID, payload, connectionId, apiGwManagement);
                break;

            // Presence
            case 'setPresence':
                await handleSetPresence(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getPresence':
                await handleGetPresence(senderID, payload, connectionId, apiGwManagement);
                break;

            // Pinned Messages
            case 'pinMessage':
                await handlePinMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'unpinMessage':
                await handleUnpinMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getPinnedMessages':
                await handleGetPinnedMessages(senderID, payload, connectionId, apiGwManagement);
                break;

            // Bookmarks
            case 'addBookmark':
                await handleAddBookmark(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'removeBookmark':
                await handleRemoveBookmark(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getBookmarks':
                await handleGetBookmarks(senderID, payload, connectionId, apiGwManagement);
                break;

            // Search
            case 'search':
                await handleSearch(senderID, payload, connectionId, apiGwManagement);
                break;

            // Scheduled Messages
            case 'scheduleMessage':
                await handleScheduleMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'cancelScheduledMessage':
                await handleCancelScheduledMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getScheduledMessages':
                await handleGetScheduledMessages(senderID, payload, connectionId, apiGwManagement);
                break;

            // Channels
            case 'createChannel':
                await handleCreateChannel(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'joinChannel':
                await handleJoinChannel(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'leaveChannel':
                await handleLeaveChannel(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'archiveChannel':
                await handleArchiveChannel(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'listChannels':
                await handleListChannels(senderID, payload, connectionId, apiGwManagement);
                break;

            // Group Chat
            case 'openGroupChat':
                await handleOpenGroupChat(senderID, payload, connectionId, apiGwManagement);
                break;

            // ======= ENHANCED MESSAGING FEATURES =======
            // Message Delivery Status
            case 'markDelivered':
                await handleMarkDelivered(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'markMessagesRead':
                await handleMarkMessagesRead(senderID, payload, connectionId, apiGwManagement);
                break;

            // Voice Messages
            case 'getVoiceUploadUrl':
                await handleGetVoiceUploadUrl(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'sendVoiceMessage':
                await handleSendVoiceMessage(senderID, payload, connectionId, apiGwManagement);
                break;

            // Conversation Settings (Mute, Archive, Pin, Notifications)
            case 'updateConversationSettings':
                await handleUpdateConversationSettings(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'muteConversation':
                await handleMuteConversation(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'unmuteConversation':
                await handleUnmuteConversation(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'archiveConversation':
                await handleArchiveConversation(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'pinConversation':
                await handlePinConversation(senderID, payload, connectionId, apiGwManagement);
                break;

            // Disappearing Messages
            case 'setDisappearingMessages':
                await handleSetDisappearingMessages(senderID, payload, connectionId, apiGwManagement);
                break;

            // Analytics & Insights
            case 'getConversationAnalytics':
                await handleGetConversationAnalytics(senderID, payload, connectionId, apiGwManagement);
                break;

            // GIF Support
            case 'searchGifs':
                await handleSearchGifs(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getTrendingGifs':
                await handleGetTrendingGifs(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'sendGif':
                await handleSendGif(senderID, payload, connectionId, apiGwManagement);
                break;

            // Stickers
            case 'getStickerPacks':
                await handleGetStickerPacks(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getStickers':
                await handleGetStickers(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'sendSticker':
                await handleSendSticker(senderID, payload, connectionId, apiGwManagement);
                break;

            // Voice/Video Calling
            case 'initiateCall':
                await handleInitiateCall(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'joinCall':
                await handleJoinCall(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'leaveCall':
                await handleLeaveCall(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'endCall':
                await handleEndCall(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'declineCall':
                await handleDeclineCall(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'acceptCall':
                await handleAcceptCall(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'callTimeout':
                await handleCallTimeout(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getCallHistory':
                await handleGetCallHistory(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'muteCall':
                await handleMuteCall(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'toggleVideo':
                await handleToggleVideo(senderID, payload, connectionId, apiGwManagement);
                break;

            // Link Previews
            case 'fetchLinkPreview':
                await handleFetchLinkPreview(senderID, payload, connectionId, apiGwManagement);
                break;

            // Files
            case 'getConversationFiles':
                await handleGetConversationFiles(senderID, payload, connectionId, apiGwManagement);
                break;

            // Heartbeat / keep-alive (sent by Android client every 30s)
            case 'heartbeat':
                await sendToClient(apiGwManagement, connectionId, { type: 'heartbeat', status: 'ok' });
                break;

            // ======= GROUP SETTINGS & PROFILE PICTURE =======
            // Group Settings (admin controls)
            case 'updateGroupSettings':
                await handleUpdateGroupSettings(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'deleteGroup':
                await handleDeleteGroup(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'leaveGroup':
                await handleLeaveGroup(senderID, payload, connectionId, apiGwManagement);
                break;

            // Profile Picture
            case 'getAvatarUploadUrl':
                await handleGetAvatarUploadUrl(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'updateAvatarUrl':
                await handleUpdateAvatarUrl(senderID, payload, connectionId, apiGwManagement);
                break;

            // ======= MESSAGE FORWARDING & STARRING =======
            case 'forwardMessage':
                await handleForwardMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'starMessage':
                await handleStarMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'unstarMessage':
                await handleUnstarMessage(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getStarredMessages':
                await handleGetStarredMessages(senderID, payload, connectionId, apiGwManagement);
                break;
            case 'getMessageInfo':
                await handleGetMessageInfo(senderID, payload, connectionId, apiGwManagement);
                break;

            default:
                await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unknown action' });
        }

        return { statusCode: 200, body: 'Data processed' };
    } catch (error) {
        console.error('Error processing WebSocket message:', error);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Internal server error' });
        return { statusCode: 500, body: 'Error' };
    }
};

// ========================================
// DISAPPEARING MESSAGES HANDLER
// ========================================

async function handleSetDisappearingMessages(
    senderID: string,
    payload: { favorRequestID: string; ttlSeconds: number | null },
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, ttlSeconds } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID' });
        return;
    }

    // Allowed TTL values: null (off), 86400 (24h), 604800 (7d), 7776000 (90d)
    const allowedTTLs = [null, 0, 86400, 604800, 7776000];
    if (!allowedTTLs.includes(ttlSeconds)) {
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Invalid TTL. Use null (off), 86400 (24h), 604800 (7d), or 7776000 (90d)',
        });
        return;
    }

    const nowIso = new Date().toISOString();

    try {
        // Update the conversation with disappearing messages TTL
        if (ttlSeconds && ttlSeconds > 0) {
            await ddb.send(new UpdateCommand({
                TableName: FAVORS_TABLE,
                Key: { favorRequestID },
                UpdateExpression: 'SET disappearingMessagesTTL = :ttl, updatedAt = :ua',
                ExpressionAttributeValues: {
                    ':ttl': ttlSeconds,
                    ':ua': nowIso,
                },
            }));
        } else {
            await ddb.send(new UpdateCommand({
                TableName: FAVORS_TABLE,
                Key: { favorRequestID },
                UpdateExpression: 'REMOVE disappearingMessagesTTL SET updatedAt = :ua',
                ExpressionAttributeValues: {
                    ':ua': nowIso,
                },
            }));
        }

        // Get participants to broadcast
        const favorResult = await ddb.send(new GetCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
        }));
        const favor = favorResult.Item as FavorRequest;

        if (favor) {
            const recipients = await getRecipientIDs(favor, senderID);
            const allParticipants = [senderID, ...recipients];

            await sendToAll(apiGwManagement, allParticipants, {
                type: 'disappearingMessagesUpdated',
                favorRequestID,
                ttlSeconds: ttlSeconds || null,
                updatedBy: senderID,
                updatedAt: nowIso,
            }, { notifyOffline: false, senderID });
        }

        // Send a system message to the conversation
        const ttlLabel = !ttlSeconds || ttlSeconds === 0 ? 'off'
            : ttlSeconds === 86400 ? '24 hours'
                : ttlSeconds === 604800 ? '7 days'
                    : '90 days';

        const systemMessage = {
            favorRequestID,
            senderID: 'system',
            content: `Disappearing messages turned ${ttlLabel === 'off' ? 'off' : `on (${ttlLabel})`}`,
            timestamp: Date.now(),
            type: 'system',
            messageID: `msg-${Date.now()}-system`,
        };

        await ddb.send(new PutCommand({
            TableName: MESSAGES_TABLE,
            Item: systemMessage,
        }));

    } catch (e) {
        console.error('Error setting disappearing messages:', e);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: 'Failed to update disappearing messages setting',
        });
    }
}

// ========================================
// NEW CORE LOGIC FUNCTIONS (Teams)
// ========================================

/**
 * Handles the creation of a new Team/Group.
 */
async function createTeam(
    ownerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { name, members } = payload;

    if (!name || !Array.isArray(members) || members.length === 0) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing team name or members list.' });
        return;
    }

    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    // Ensure the owner is always in the members list
    const uniqueMembers = Array.from(new Set([...members, ownerID]));

    const teamID = uuidv4();
    const nowIso = new Date().toISOString();

    const newTeam: Team = {
        teamID,
        ownerID,
        name: String(name),
        description: payload.description ? String(payload.description) : undefined,
        members: uniqueMembers,
        admins: [ownerID], // Creator is always the first admin
        createdAt: nowIso,
        updatedAt: nowIso,
    };

    try {
        await ddb.send(new PutCommand({
            TableName: TEAMS_TABLE,
            Item: newTeam,
        }));

        console.log(`Team created: ${teamID} by ${ownerID}`);

        // Notify all team members (including the creator) about the new team
        const notificationPayload = {
            type: 'teamCreated',
            team: newTeam,
        };
        await sendToAll(apiGwManagement, uniqueMembers, notificationPayload, { notifyOffline: false });

    } catch (e) {
        console.error('Failed to create team:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to create team.' });
    }
}

/**
 * Lists all teams the caller is a member of.
 * Note: This performs a full table scan and filters in-memory.
 * For large-scale applications, consider using a GSI with inverted index pattern.
 */
async function listTeams(
    callerID: string,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    try {
        // Scan the table and filter for teams where the caller is a member
        // Note: For production with large datasets, use a GSI or inverted index pattern
        const result = await ddb.send(new ScanCommand({
            TableName: TEAMS_TABLE,
            FilterExpression: 'contains(members, :callerID)',
            ExpressionAttributeValues: {
                ':callerID': callerID,
            },
        }));

        const teams = (result.Items || []) as Team[];

        // Sort by updatedAt descending (most recently updated first)
        teams.sort((a, b) => {
            const aTime = a.updatedAt || '';
            const bTime = b.updatedAt || '';
            if (aTime < bTime) return 1;
            if (aTime > bTime) return -1;
            return 0;
        });

        await sendToClient(apiGwManagement, connectionId, {
            type: 'teamsList',
            teams: teams.map(t => ({
                teamID: t.teamID,
                name: t.name,
                ownerID: t.ownerID,
                memberCount: t.members.length,
                members: t.members,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
            })),
        });

    } catch (e) {
        console.error('Failed to list teams:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to list teams.' });
    }
}

/**
 * Adds a user to an existing team. Only the team owner can perform this action.
 */
async function addUserToTeam(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { teamID, userID } = payload;

    if (!teamID || !userID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing teamID or userID.' });
        return;
    }

    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    try {
        // 1. Fetch the team to verify ownership
        const team = await getTeamByID(teamID);

        if (!team) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Team not found.' });
            return;
        }

        // 2. Check if caller is the owner
        if (team.ownerID !== callerID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only the team owner can add members.' });
            return;
        }

        // 3. Check if user is already a member
        if (team.members.includes(userID)) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'User is already a member of this team.' });
            return;
        }

        // 4. Add the user to the team
        const nowIso = new Date().toISOString();
        const updatedMembers = [...team.members, userID];

        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
            UpdateExpression: 'SET members = :members, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':members': updatedMembers,
                ':updatedAt': nowIso,
            },
        }));

        console.log(`User ${userID} added to team ${teamID} by ${callerID}`);

        // 5. Notify all team members (including the new member) about the update
        const updatedTeam: Team = {
            ...team,
            members: updatedMembers,
            updatedAt: nowIso,
        };

        const notificationPayload = {
            type: 'teamMemberAdded',
            team: updatedTeam,
            addedUserID: userID,
            addedBy: callerID,
        };

        await sendToAll(apiGwManagement, updatedMembers, notificationPayload, { notifyOffline: false });

    } catch (e) {
        console.error('Failed to add user to team:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to add user to team.' });
    }
}

/**
 * Removes a user from an existing team.
 * Allowed when: caller is the team owner removing another member,
 * OR caller is removing themselves (self-leave, except owner).
 * The owner cannot remove themselves — they must delete the group instead.
 */
async function removeUserFromTeam(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { teamID, userID } = payload;

    if (!teamID || !userID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing teamID or userID.' });
        return;
    }

    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    try {
        // 1. Fetch the team
        const team = await getTeamByID(teamID);

        if (!team) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Team not found.' });
            return;
        }

        // 2. Authorization: owner can remove others, any member can remove themselves (self-leave)
        const isSelfLeave = callerID === userID;
        if (!isSelfLeave && team.ownerID !== callerID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only the team owner can remove other members.' });
            return;
        }

        // 3. Prevent owner from removing themselves
        if (userID === team.ownerID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'The team owner cannot be removed from the team.' });
            return;
        }

        // 4. Check if user is a member
        if (!team.members.includes(userID)) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'User is not a member of this team.' });
            return;
        }

        // 5. Remove the user from the team
        const nowIso = new Date().toISOString();
        const updatedMembers = team.members.filter(m => m !== userID);

        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
            UpdateExpression: 'SET members = :members, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':members': updatedMembers,
                ':updatedAt': nowIso,
            },
        }));

        console.log(`User ${userID} removed from team ${teamID} by ${callerID}`);

        // 6. Notify remaining team members about the update
        const updatedTeam: Team = {
            ...team,
            members: updatedMembers,
            updatedAt: nowIso,
        };

        const notificationPayload = {
            type: 'teamMemberRemoved',
            team: updatedTeam,
            removedUserID: userID,
            removedBy: callerID,
        };

        // Notify remaining members AND the removed user
        await sendToAll(apiGwManagement, [...updatedMembers, userID], notificationPayload, { notifyOffline: false });

    } catch (e) {
        console.error('Failed to remove user from team:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to remove user from team.' });
    }
}

// ========================================
// GROUP SETTINGS HANDLERS
// ========================================

/**
 * Updates group/team settings: description, adminOnlyMessages, and admin management.
 * Only the owner or admins can update settings.
 */
async function handleUpdateGroupSettings(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { teamID, description, adminOnlyMessages, makeAdmin, dismissAdmin } = payload;

    if (!teamID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing teamID.' });
        return;
    }

    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    try {
        // 1. Fetch the team
        const team = await getTeamByID(teamID);

        if (!team) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Team not found.' });
            return;
        }

        // 2. Check if caller is owner or admin
        const isOwner = team.ownerID === callerID;
        const isAdmin = (team.admins || []).includes(callerID);
        if (!isOwner && !isAdmin) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only admins can update group settings.' });
            return;
        }

        const nowIso = new Date().toISOString();
        const updateExprParts: string[] = ['updatedAt = :updatedAt'];
        const exprValues: Record<string, any> = { ':updatedAt': nowIso };
        const systemMessages: string[] = [];

        // 3. Update description if provided
        if (description !== undefined) {
            updateExprParts.push('description = :desc');
            exprValues[':desc'] = description || null;
            systemMessages.push(`Group description updated`);
        }

        // 4. Update adminOnlyMessages if provided
        if (adminOnlyMessages !== undefined) {
            updateExprParts.push('adminOnlyMessages = :adminOnly');
            exprValues[':adminOnly'] = !!adminOnlyMessages;
            systemMessages.push(
                adminOnlyMessages
                    ? 'Only admins can send messages now'
                    : 'All members can send messages now'
            );
        }

        // 5. Make a member admin (owner-only)
        let updatedAdmins = [...(team.admins || [team.ownerID])];
        if (makeAdmin) {
            if (!isOwner) {
                await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Only the group owner can make admins.' });
                return;
            }
            if (!team.members.includes(makeAdmin)) {
                await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'User is not a member of this group.' });
                return;
            }
            if (!updatedAdmins.includes(makeAdmin)) {
                updatedAdmins.push(makeAdmin);
                updateExprParts.push('admins = :admins');
                exprValues[':admins'] = updatedAdmins;
                systemMessages.push(`A member was made admin`);
            }
        }

        // 6. Dismiss an admin (owner-only)
        if (dismissAdmin) {
            if (!isOwner) {
                await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Only the group owner can dismiss admins.' });
                return;
            }
            if (dismissAdmin === team.ownerID) {
                await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Cannot dismiss the group owner from admin.' });
                return;
            }
            updatedAdmins = updatedAdmins.filter(a => a !== dismissAdmin);
            updateExprParts.push('admins = :admins');
            exprValues[':admins'] = updatedAdmins;
            systemMessages.push(`An admin was dismissed`);
        }

        // 7. Execute DynamoDB update
        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
            UpdateExpression: `SET ${updateExprParts.join(', ')}`,
            ExpressionAttributeValues: exprValues,
        }));

        console.log(`Group settings updated for ${teamID} by ${callerID}`);

        // 8. Broadcast updated team to all members
        const updatedTeam = {
            ...team,
            ...(description !== undefined && { description }),
            ...(adminOnlyMessages !== undefined && { adminOnlyMessages }),
            admins: updatedAdmins,
            updatedAt: nowIso,
        };

        await sendToAll(apiGwManagement, team.members, {
            type: 'groupSettingsUpdated',
            team: updatedTeam,
            updatedBy: callerID,
        }, { notifyOffline: false });

        // 9. Insert system messages into the team's main group chat
        if (systemMessages.length > 0 && team.teamID) {
            // Find the main group chat favorRequestID for this team
            const favorResult = await ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'teamID-index',
                KeyConditionExpression: 'teamID = :tid',
                ExpressionAttributeValues: { ':tid': teamID },
                FilterExpression: 'isMainGroupChat = :mgc',
                Limit: 1,
            })).catch(() => ({ Items: [] }));

            const groupChat = favorResult.Items?.[0];
            if (groupChat) {
                for (const msg of systemMessages) {
                    await ddb.send(new PutCommand({
                        TableName: MESSAGES_TABLE,
                        Item: {
                            favorRequestID: groupChat.favorRequestID,
                            senderID: 'system',
                            content: msg,
                            timestamp: Date.now(),
                            type: 'system',
                            messageID: `msg-${Date.now()}-system-${uuidv4().slice(0, 8)}`,
                        },
                    }));
                }
            }
        }

    } catch (e) {
        console.error('Failed to update group settings:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to update group settings.' });
    }
}

/**
 * Deletes a group/team. Only the team owner can delete a group.
 * Removes the team record and notifies all members.
 */
async function handleDeleteGroup(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { teamID } = payload;

    if (!teamID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing teamID.' });
        return;
    }

    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    try {
        // 1. Fetch the team to verify ownership
        const team = await getTeamByID(teamID);

        if (!team) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Team not found.' });
            return;
        }

        // 2. Only owner can delete the group
        if (team.ownerID !== callerID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only the group owner can delete the group.' });
            return;
        }

        // 3. Delete the team record
        await ddb.send(new DeleteCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
        }));

        console.log(`Group ${teamID} deleted by ${callerID}`);

        // 4. Notify all members that the group was deleted
        await sendToAll(apiGwManagement, team.members, {
            type: 'groupDeleted',
            teamID,
            deletedBy: callerID,
            groupName: team.name,
        }, { notifyOffline: false });

    } catch (e) {
        console.error('Failed to delete group:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to delete group.' });
    }
}

/**
 * Handles a member leaving a group. Any non-owner member can leave.
 * The owner must delete the group instead.
 */
async function handleLeaveGroup(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { teamID } = payload;

    if (!teamID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing teamID.' });
        return;
    }

    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    try {
        // 1. Fetch the team
        const team = await getTeamByID(teamID);

        if (!team) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Team not found.' });
            return;
        }

        // 2. Owner cannot leave — they must delete the group
        if (team.ownerID === callerID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Group owner cannot leave. Delete the group instead.' });
            return;
        }

        // 3. Must be a member
        if (!team.members.includes(callerID)) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'You are not a member of this group.' });
            return;
        }

        // 4. Remove caller from members and admins
        const nowIso = new Date().toISOString();
        const updatedMembers = team.members.filter(m => m !== callerID);
        const updatedAdmins = (team.admins || []).filter(a => a !== callerID);

        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
            UpdateExpression: 'SET members = :members, admins = :admins, updatedAt = :ua',
            ExpressionAttributeValues: {
                ':members': updatedMembers,
                ':admins': updatedAdmins,
                ':ua': nowIso,
            },
        }));

        console.log(`User ${callerID} left group ${teamID}`);

        // 5. Send system message to the group
        const systemMessage = {
            favorRequestID: team.teamID, // group conversations use teamID as favorRequestID context
            senderID: 'system',
            content: 'A member left the group',
            timestamp: Date.now(),
            type: 'system',
            messageID: `msg-${Date.now()}-system`,
        };

        await ddb.send(new PutCommand({
            TableName: MESSAGES_TABLE,
            Item: systemMessage,
        }));

        // 6. Confirm to the caller
        await sendToClient(apiGwManagement, connectionId, {
            type: 'leftGroup',
            teamID,
        });

        // 7. Notify remaining members
        await sendToAll(apiGwManagement, updatedMembers, {
            type: 'teamMemberLeft',
            teamID,
            leftUserID: callerID,
            team: {
                ...team,
                members: updatedMembers,
                admins: updatedAdmins,
                updatedAt: nowIso,
            },
        }, { notifyOffline: false });

    } catch (e) {
        console.error('Failed to leave group:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to leave group.' });
    }
}

// ========================================
// PROFILE PICTURE HANDLERS
// ========================================

/**
 * Returns a presigned S3 PUT URL for uploading a profile picture (avatar).
 * Key: avatars/{userID}/{UUID}.{ext}
 */
async function handleGetAvatarUploadUrl(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { fileName, fileType } = payload;

    if (!fileName || !fileType) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing fileName or fileType.' });
        return;
    }

    if (!FILE_BUCKET_NAME) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: File bucket not configured.' });
        return;
    }

    // Validate content type is an image
    if (!fileType.startsWith('image/')) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Invalid file type. Only images are allowed.' });
        return;
    }

    const rawName = String(fileName);
    const ext = rawName.split('.').pop() || 'jpg';
    const fileKey = `avatars/${senderID}/${uuidv4()}.${ext}`;

    try {
        const command = new PutObjectCommand({
            Bucket: FILE_BUCKET_NAME,
            Key: fileKey,
            ContentType: fileType,
        });

        const url = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 min

        await sendToClient(apiGwManagement, connectionId, {
            type: 'avatarUploadUrl',
            url,
            fileKey,
            fileType,
        });

        console.log(`Avatar upload URL generated for ${senderID}: ${fileKey}`);
    } catch (e) {
        console.error('Error generating avatar upload URL:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to generate avatar upload URL.' });
    }
}

/**
 * After the client has uploaded the avatar to S3, it calls this action to persist
 * the avatar URL in the connections/user table and broadcasts the update.
 */
async function handleUpdateAvatarUrl(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { fileKey } = payload;

    if (!fileKey) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing fileKey.' });
        return;
    }

    if (!FILE_BUCKET_NAME) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: File bucket not configured.' });
        return;
    }

    // Construct the public/CDN URL for the avatar
    const avatarUrl = `https://${FILE_BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileKey}`;
    const nowIso = new Date().toISOString();

    try {
        // Update the user's connection record with the avatar URL
        // (The connections table tracks user metadata including presence)
        await ddb.send(new UpdateCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET avatarUrl = :avatarUrl, avatarUpdatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':avatarUrl': avatarUrl,
                ':updatedAt': nowIso,
            },
        }));

        // Broadcast to all connected users so they see the updated avatar
        // (Get all connections and notify)
        const allConnections = await ddb.send(new ScanCommand({
            TableName: CONNECTIONS_TABLE,
            ProjectionExpression: 'connectionId',
        }));

        if (allConnections.Items) {
            const broadcastPayload = {
                type: 'avatarUpdated',
                userID: senderID,
                avatarUrl,
                updatedAt: nowIso,
            };

            for (const conn of allConnections.Items) {
                if (conn.connectionId && conn.connectionId !== connectionId) {
                    await sendToClient(apiGwManagement, conn.connectionId as string, broadcastPayload).catch(() => { });
                }
            }
        }

        // Confirm to the sender
        await sendToClient(apiGwManagement, connectionId, {
            type: 'avatarUpdateConfirmed',
            userID: senderID,
            avatarUrl,
        });

        console.log(`Avatar updated for ${senderID}: ${avatarUrl}`);
    } catch (e) {
        console.error('Error updating avatar URL:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to update avatar URL.' });
    }
}

/**
 * WhatsApp-style Group Chat: Opens or creates the main conversation for a team.
 * This allows users to immediately start chatting with a group when they click on it.
 */
async function handleOpenGroupChat(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { teamID } = payload;

    if (!teamID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing teamID.' });
        return;
    }

    if (!TEAMS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Teams table not configured.' });
        return;
    }

    try {
        // 1. Fetch the team to verify membership
        const team = await getTeamByID(teamID);

        if (!team) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Team not found.' });
            return;
        }

        // 2. Verify caller is a member of the team
        if (!team.members.includes(callerID)) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a member of this team.' });
            return;
        }

        // 3. Check if there's an existing "main" group conversation for this team
        // Use TeamIndex GSI for efficient lookup instead of ScanCommand
        const existingConvos = await ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'TeamIndex',
            KeyConditionExpression: 'teamID = :teamID',
            ExpressionAttributeValues: {
                ':teamID': teamID,
            },
            ScanIndexForward: false, // Most recent first
        }));

        const conversations = (existingConvos.Items || []) as FavorRequest[];

        // Strict dedup: exclude only permanently deleted conversations
        const nonDeletedConvos = conversations.filter(c => c.status !== 'deleted');
        const mainConvo = nonDeletedConvos.find(c => (c as any).isMainGroupChat === true)
            || nonDeletedConvos[0];

        if (mainConvo) {
            // 4a. Return existing conversation and its history
            console.log(`Opening existing group chat: ${mainConvo.favorRequestID} for team ${teamID}`);

            // Reactivate if completed/rejected
            if (mainConvo.status === 'completed' || mainConvo.status === 'rejected') {
                console.log(`🔄 Reactivating group conversation ${mainConvo.favorRequestID} back to active`);
                await ddb.send(new UpdateCommand({
                    TableName: FAVORS_TABLE,
                    Key: { favorRequestID: mainConvo.favorRequestID },
                    UpdateExpression: 'SET #st = :active, updatedAt = :ua',
                    ExpressionAttributeNames: { '#st': 'status' },
                    ExpressionAttributeValues: { ':active': 'active', ':ua': new Date().toISOString() },
                }));
                mainConvo.status = 'active' as TaskStatus;
            }

            // Clean up deletedBy for the caller
            if (mainConvo.deletedBy && Array.isArray(mainConvo.deletedBy) && mainConvo.deletedBy.includes(callerID)) {
                const cleanedDeletedBy = mainConvo.deletedBy.filter((id: string) => id !== callerID);
                await ddb.send(new UpdateCommand({
                    TableName: FAVORS_TABLE,
                    Key: { favorRequestID: mainConvo.favorRequestID },
                    UpdateExpression: 'SET deletedBy = :cleaned',
                    ExpressionAttributeValues: { ':cleaned': cleanedDeletedBy },
                }));
            }

            // Fetch message history
            const messagesResult = await ddb.send(new QueryCommand({
                TableName: MESSAGES_TABLE,
                KeyConditionExpression: 'favorRequestID = :frid',
                ExpressionAttributeValues: {
                    ':frid': mainConvo.favorRequestID,
                },
                ScanIndexForward: true, // Oldest first
                Limit: 100,
            }));

            const messages = (messagesResult.Items || []) as MessageData[];

            await sendToClient(apiGwManagement, connectionId, {
                type: 'groupChatOpened',
                favor: mainConvo,
                favorRequestID: mainConvo.favorRequestID,
                teamID,
                team: {
                    teamID: team.teamID,
                    name: team.name,
                    members: team.members,
                    ownerID: team.ownerID,
                },
                messages,
                isExisting: true,
            });

        } else {
            // 4b. Create a new main group conversation
            console.log(`Creating new main group chat for team ${teamID}`);

            const favorRequestID = uuidv4();
            const nowIso = new Date().toISOString();

            const newFavor: FavorRequest = {
                favorRequestID,
                senderID: callerID,
                teamID,
                title: team.name, // Use team name as conversation title
                description: `Group chat for ${team.name}`,
                status: 'active',
                priority: 'Medium' as TaskPriority,
                currentAssigneeID: undefined,
                createdAt: nowIso,
                updatedAt: nowIso,
                userID: callerID,
                requestType: 'General',
                unreadCount: 0,
                initialMessage: `Welcome to ${team.name}! 👋`,
                isMainGroupChat: true, // Mark as the main group chat
            };

            await ddb.send(new PutCommand({
                TableName: FAVORS_TABLE,
                Item: newFavor,
            }));

            // Create welcome message
            const welcomeMessage: MessageData = {
                favorRequestID,
                senderID: 'system',
                content: `Welcome to ${team.name}! This is the beginning of your group chat. 🎉`,
                timestamp: Date.now(),
                type: 'system',
            };

            await ddb.send(new PutCommand({
                TableName: MESSAGES_TABLE,
                Item: {
                    ...welcomeMessage,
                    messageID: uuidv4(),
                },
            }));

            // Notify all team members about the new conversation
            const notificationPayload = {
                type: 'favorRequestUpdated',
                favor: newFavor,
            };
            await sendToAll(apiGwManagement, team.members, notificationPayload, { notifyOffline: false });

            // Return the new conversation to the caller
            await sendToClient(apiGwManagement, connectionId, {
                type: 'groupChatOpened',
                favor: newFavor,
                favorRequestID,
                teamID,
                team: {
                    teamID: team.teamID,
                    name: team.name,
                    members: team.members,
                    ownerID: team.ownerID,
                },
                messages: [welcomeMessage],
                isExisting: false,
            });
        }

    } catch (e) {
        console.error('Failed to open group chat:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to open group chat.' });
    }
}

// ========================================
// CORE LOGIC FUNCTIONS (Favors/Messaging)
// ========================================

/**
 * Helper to ensure we only store the clean S3 key (path) and not a full Presigned URL.
 * This prevents the client from trying to download using the upload URL.
 */
function sanitizeFileKey(key: string): string {
    if (!key || key.includes('?')) {
        // If the key is a full URL, attempt to strip everything after the first '?'
        try {
            const url = new URL(key);
            // The pathname should be the raw S3 Key, excluding the leading slash if present.
            // Example: /favors/UUID/file.png -> favors/UUID/file.png
            return url.pathname.replace(/^\/+/, '');
        } catch (e) {
            // If it's not a valid URL or other error, return the original key as a fallback.
            return key;
        }
    }
    // If it's already a clean path, return it.
    return key;
}

/**
 * Handles the initiation of a new favor request (1-to-1 or group).
 * Supports enhanced task fields: title, description, priority, category.
 */
async function startFavorRequest(
    senderID: string,
    payload: any,
    senderConnectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    // Enhanced: Include title, description, priority, category
    const {
        receiverID, teamID, initialMessage, requestType, deadline,
        title, description, priority = 'Medium', category, tags
    } = payload;

    if (!initialMessage || !requestType || (!receiverID && !teamID)) {
        await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Missing initialMessage, requestType, and recipient (receiverID or teamID).' });
        return;
    }

    const isGroupRequest = !!teamID;
    let recipients: string[] = [];

    if (isGroupRequest) {
        if (!TEAMS_TABLE) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Server error: Teams table not configured for group request.' });
            return;
        }
        // Fetch team members for group request
        const team = await getTeamByID(teamID);

        if (!team) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: `Team ID ${teamID} not found.` });
            return;
        }

        // AUTHORIZATION: Verify the sender is a member of the team
        if (!team.members.includes(senderID)) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Unauthorized: You are not a member of this team.' });
            return;
        }

        // Recipients are all team members except the sender
        recipients = team.members.filter(memberId => memberId !== senderID);

        if (recipients.length === 0) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'The team has no other members to assign the task to.' });
            return;
        }
    } else {
        // CRITICAL FIX: Prevent a user from starting a request with themselves (1-to-1 only)
        if (senderID === receiverID) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'A favor request cannot be started with yourself. Please select another user.' });
            return;
        }
        recipients = [receiverID as string];
    }

    // ──────────────────────────────────────────────────────────────
    // DEDUPLICATION: Check for an existing conversation before creating a new one.
    // For 1-to-1 chats: look for a conversation between senderID ↔ receiverID.
    // For group chats: look for an existing conversation for the same teamID.
    // ──────────────────────────────────────────────────────────────
    let existingFavor: FavorRequest | undefined;

    if (isGroupRequest) {
        // Query TeamIndex for existing group conversations
        const existingConvos = await ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'TeamIndex',
            KeyConditionExpression: 'teamID = :teamID',
            ExpressionAttributeValues: { ':teamID': teamID },
            ScanIndexForward: false,
        }));
        const convos = (existingConvos.Items || []) as FavorRequest[];
        // Strict dedup: find ANY conversation for this team (regardless of status)
        // Only permanently deleted conversations are excluded
        const nonDeletedConvos = convos.filter(c => c.status !== 'deleted');
        existingFavor = nonDeletedConvos.find(c => (c as any).isMainGroupChat === true)
            || nonDeletedConvos[0];
    } else {
        // ──────────────────────────────────────────────────────────────
        // STRICT 1-ON-1 DEDUP: "One conversation per unique pair of users"
        //
        // We query both directions (A→B and B→A) using server-side
        // FilterExpression to match the exact receiverID and exclude
        // group conversations. We do NOT filter by status so that
        // completed/rejected conversations are also found and reused
        // instead of creating duplicates.
        // ──────────────────────────────────────────────────────────────
        const [dirAB, dirBA] = await Promise.all([
            ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'SenderIndex',
                KeyConditionExpression: 'senderID = :sid',
                FilterExpression: 'receiverID = :rid AND attribute_not_exists(teamID)',
                ExpressionAttributeValues: { ':sid': senderID, ':rid': receiverID },
                ScanIndexForward: false,
            })),
            ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'SenderIndex',
                KeyConditionExpression: 'senderID = :sid',
                FilterExpression: 'receiverID = :rid AND attribute_not_exists(teamID)',
                ExpressionAttributeValues: { ':sid': receiverID, ':rid': senderID },
                ScanIndexForward: false,
            })),
        ]);

        const allConvos = [
            ...(dirAB.Items || []),
            ...(dirBA.Items || []),
        ] as FavorRequest[];

        // Find ANY existing 1-on-1 conversation between these two users
        // regardless of status (except permanently deleted)
        existingFavor = allConvos.find(c =>
            c.status !== 'deleted' &&
            ((c.senderID === senderID && c.receiverID === receiverID) ||
                (c.senderID === receiverID && c.receiverID === senderID))
        );
    }

    // If an existing conversation was found, send the message there instead of creating a new one
    if (existingFavor) {
        const existingID = existingFavor.favorRequestID;
        const timestamp = Date.now();
        console.log(`♻️ Reusing existing conversation ${existingID} instead of creating a new one.`);

        // Update conversation metadata (deadline, priority, title) if task fields provided
        const updateExprParts: string[] = ['updatedAt = :ua'];
        const exprValues: Record<string, any> = { ':ua': new Date().toISOString() };
        const exprNames: Record<string, string> = {};

        // REACTIVATION: If the conversation was completed/rejected, bring it back to active
        if (existingFavor.status === 'completed' || existingFavor.status === 'rejected') {
            console.log(`🔄 Reactivating ${existingFavor.status} conversation ${existingID} back to active`);
            updateExprParts.push('#st = :newStatus');
            exprValues[':newStatus'] = 'active';
            exprNames['#st'] = 'status';
        }

        // SOFT-DELETE CLEANUP: If the sender previously deleted this conversation,
        // remove them from deletedBy so it becomes visible again
        if (existingFavor.deletedBy && Array.isArray(existingFavor.deletedBy) && existingFavor.deletedBy.includes(senderID)) {
            const cleanedDeletedBy = existingFavor.deletedBy.filter((id: string) => id !== senderID);
            updateExprParts.push('deletedBy = :cleanedDeletedBy');
            exprValues[':cleanedDeletedBy'] = cleanedDeletedBy;
        }

        if (deadline) { updateExprParts.push('deadline = :dl'); exprValues[':dl'] = String(deadline); }
        if (priority && priority !== 'Medium') { updateExprParts.push('priority = :pri'); exprValues[':pri'] = priority; }

        // Increment unread count
        updateExprParts.push('unreadCount = if_not_exists(unreadCount, :zero) + :incr');
        exprValues[':incr'] = recipients.length;
        exprValues[':zero'] = 0;

        const updateResult = await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID: existingID },
            UpdateExpression: `SET ${updateExprParts.join(', ')}`,
            ExpressionAttributeValues: exprValues,
            ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
            ReturnValues: 'ALL_NEW',
        }));

        const updatedFavor = updateResult.Attributes as FavorRequest;

        // Save the task message into the existing conversation
        const messageData: MessageData = {
            messageID: uuidv4(),
            favorRequestID: existingID,
            senderID,
            content: initialMessage,
            timestamp,
            type: 'text',
        };
        await _saveAndBroadcastMessage(messageData, apiGwManagement, isGroupRequest ? recipients : undefined);

        // Broadcast the updated favor to all participants
        const allParticipants = [...recipients, senderID];
        await sendToAll(apiGwManagement, allParticipants, {
            type: 'favorRequestUpdated',
            favor: updatedFavor,
        }, { notifyOffline: false });

        // Push notification for new task in existing conversation
        const senderDetails = await getUserDetails(senderID);
        await sendTaskPushNotification(
            recipients,
            'task_assigned',
            title || initialMessage.substring(0, 50),
            senderDetails.fullName,
            existingID,
            { priority: priority as TaskPriority, category: category as SystemModule }
        );

        // Confirm to sender — use same type so frontend handles it consistently
        await sendToClient(apiGwManagement, senderConnectionId, {
            type: 'favorRequestStarted',
            favorRequestID: existingID,
            favor: updatedFavor,
            receiverID,
            teamID,
            requestType,
            deadline,
            title: updatedFavor.title,
            priority: updatedFavor.priority,
            category: updatedFavor.category,
            reusedExisting: true,
        });
        return; // ← Done, skip new-creation path below
    }

    // ──────────────────────────────────────────────────────────────
    // No existing conversation found — create a brand-new one (original path)
    // ──────────────────────────────────────────────────────────────
    const favorRequestID = uuidv4();
    const timestamp = Date.now();
    const nowIso = new Date().toISOString();

    // Compute deterministic participant key for 1-on-1 dedup
    // Sorted alphabetically so A→B and B→A produce the same key
    const participantKey = isGroupRequest
        ? undefined
        : [senderID, receiverID as string].sort().join('#');

    const newFavor: FavorRequest = {
        favorRequestID,
        senderID,
        // Include receiverID only for 1-to-1, teamID only for group
        ...(isGroupRequest ? { teamID: teamID } : { receiverID: receiverID }),
        // Participant key for strict dedup (1-on-1 only)
        ...(participantKey && { participantKey }),
        // Enhanced task fields
        title: title || initialMessage.substring(0, 100),
        description: description || initialMessage,
        status: 'pending',
        priority: priority as TaskPriority,
        ...(category && { category: category as SystemModule }),
        ...(tags && { tags }),
        currentAssigneeID: isGroupRequest ? undefined : receiverID,
        createdAt: nowIso,
        updatedAt: nowIso,
        userID: senderID,
        requestType,
        unreadCount: recipients.length,
        initialMessage: initialMessage,
        ...(deadline && { deadline: String(deadline) }),
        // Task badge: mark as task when created via task assignment
        ...(requestType === 'Assign Task' && { isTask: true }),
    };

    // 1. Create Favor Request Record
    await ddb.send(new PutCommand({
        TableName: FAVORS_TABLE,
        Item: newFavor,
    }));

    // 2. Create the initial message
    const messageData: MessageData = {
        messageID: uuidv4(),
        favorRequestID,
        senderID,
        content: initialMessage,
        timestamp,
        type: 'text',
    };

    // 3. Save message and broadcast
    await _saveAndBroadcastMessage(messageData, apiGwManagement, isGroupRequest ? recipients : undefined);

    // 4. Send email notification (for BOTH single and group tasks)
    try {
        if (isGroupRequest) {
            // Group task: fetch team details and send to all members
            const teamResult = await ddb.send(new GetCommand({
                TableName: TEAMS_TABLE,
                Key: { teamID },
            }));
            const team = teamResult.Item;
            const teamName = team?.name || 'Unknown Group';
            const teamMembers = team?.members || recipients;
            await sendTaskAssignmentEmail({
                senderID,
                recipientIDs: recipients,
                initialMessage,
                requestType,
                deadline,
                title: newFavor.title,
                priority: newFavor.priority,
                teamName,
                teamMembers,
                isGroup: true,
            });
        } else {
            // Single task: send to the receiver
            await sendTaskAssignmentEmail({
                senderID,
                recipientIDs: [receiverID as string],
                initialMessage,
                requestType,
                deadline,
                title: newFavor.title,
                priority: newFavor.priority,
                isGroup: false,
            });
        }
    } catch (e) {
        console.error("Failed to send SES notification email:", e);
    }

    // 5. Send push notifications to recipients (for offline users)
    const senderDetails = await getUserDetails(senderID);
    await sendTaskPushNotification(
        recipients,
        'task_assigned',
        newFavor.title || initialMessage.substring(0, 50),
        senderDetails.fullName,
        favorRequestID,
        { priority: newFavor.priority, category: newFavor.category }
    );

    // 6. Send confirmation back to the sender
    await sendToClient(apiGwManagement, senderConnectionId, {
        type: 'favorRequestStarted',
        favorRequestID,
        favor: newFavor,
        receiverID,
        teamID,
        requestType,
        deadline,
        title: newFavor.title,
        priority: newFavor.priority,
        category: newFavor.category,
    });
}

/**
 * Handles sending a message within an existing, active favor request.
 */
async function sendMessage(
    senderID: string,
    payload: any,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, content, fileKey, fileDetails, parentMessageID } = payload;
    const senderConnectionId = (await getSenderInfoByUserID(senderID))?.connectionId;

    if (!favorRequestID || ((!content || content.trim() === '') && !fileKey)) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Missing favorRequestID or message content/file key.' });
        }
        return;
    }

    const timestamp = Date.now();

    // 1. Validate and Update Favor Request (optimistic locking/status check)
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Favor request not found.' });
        }
        return;
    }

    // 2. Verify the sender is a participant in this request
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this request.' });
        }
        return;
    }

    // Determine the list of all non-sending recipients
    const recipientIDs = await getRecipientIDs(favor, senderID);

    // Allow messaging for active workflows (pending/active/in_progress/forwarded).
    // Only block messaging for closed tasks.
    const isClosed = favor.status === 'completed' || favor.status === 'rejected';
    if (isClosed || recipientIDs.length === 0) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Request is closed or has no recipients.' });
        }
        return;
    }

    // 2. Update the favor's last update time AND increment the unread counter 
    // Increment unread count by the number of recipients.
    const incrementAmount = recipientIDs.length;

    const updateResult = await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: 'SET updatedAt = :ua ADD unreadCount :incr',
        ExpressionAttributeValues: {
            ':ua': new Date().toISOString(),
            ':incr': incrementAmount
        },
        ReturnValues: 'ALL_NEW',
    }));

    // Broadcast the updated favor object to all participants (sender + all recipients)
    const updatedFavor = updateResult.Attributes as FavorRequest;
    const allParticipants = [...recipientIDs, senderID];

    const broadcastUpdatePayload = {
        type: 'favorRequestUpdated',
        favor: updatedFavor,
    };
    await sendToAll(apiGwManagement, allParticipants, broadcastUpdatePayload, { notifyOffline: false }); // Do not send SNS for simple updates

    const cleanFileKey = fileKey ? sanitizeFileKey(fileKey) : undefined;

    // 3. Create message data
    const messageData: MessageData = {
        messageID: uuidv4(),
        favorRequestID,
        senderID,
        content: content || '',
        timestamp,
        type: cleanFileKey ? 'file' : 'text',
        fileKey: cleanFileKey,
        fileDetails: fileDetails,
        ...(parentMessageID && { parentMessageID }),
    };

    // 4. Save message and broadcast (sends 'newMessage' payload)
    await _saveAndBroadcastMessage(messageData, apiGwManagement, recipientIDs); // PASS RECIPIENTS

}

/**
 * Helper to determine all non-sending participants for a favor request.
 * Returns an array of user IDs.
 */
async function getRecipientIDs(favor: FavorRequest, senderID: string): Promise<string[]> {
    if (favor.teamID) {
        const team = await getTeamByID(favor.teamID);
        const members = normalizeMembers(team?.members);

        // Recipients are all team members except the sender
        return members.filter(memberId => memberId !== senderID);

    } else if (favor.receiverID) {
        // 1-to-1 chat: Recipient is the person who is not the sender
        const recipientID = favor.senderID === senderID ? favor.receiverID : favor.senderID;
        // Check if the sender is actually a participant before returning the other one
        if (favor.senderID === senderID || favor.receiverID === senderID) {
            return [recipientID];
        }
    }

    return []; // Request not found, inactive, or unauthorized
}

/**
 * Helper to check if a user is a participant in a favor request.
 * For 1-to-1 requests: checks if user is sender or receiver.
 * For group requests: checks if user is a member of the team.
 */
async function isUserParticipant(favor: FavorRequest, userID: string): Promise<boolean> {
    // For 1-to-1 requests
    if (!favor.teamID) {
        return favor.senderID === userID || favor.receiverID === userID;
    }

    // For group requests, check team membership
    const team = await getTeamByID(favor.teamID);
    const members = normalizeMembers(team?.members);

    return members.includes(userID);
}

/**
 * Helper to get all participants (including sender) for a favor request.
 * Returns an array of all user IDs involved in the request.
 */
async function getAllParticipants(favor: FavorRequest): Promise<string[]> {
    if (favor.teamID) {
        const team = await getTeamByID(favor.teamID);
        const members = normalizeMembers(team?.members);
        return members.length > 0 ? members : [favor.senderID];
    }

    // For 1-to-1 requests
    const participants = [favor.senderID];
    if (favor.receiverID) {
        participants.push(favor.receiverID);
    }
    return participants;
}



/**
 * Handles marking all messages in a conversation as read.
 */
async function markRead(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID.' });
        return;
    }

    // 1. Fetch the favor request first to check authorization
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Favor request not found.' });
        return;
    }

    // 2. Verify the caller is a participant
    const isParticipant = await isUserParticipant(favor, callerID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this request.' });
        return;
    }

    // 3. Reset unreadCount to 0 for the specified request
    try {
        const updateResult = await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET unreadCount = :zero',
            ExpressionAttributeValues: {
                ':zero': 0,
            },
            ReturnValues: 'ALL_NEW',
        }));

        // 4. Send the read status update to the caller
        const updatedFavor = updateResult.Attributes as FavorRequest;
        const broadcastUpdatePayload = {
            type: 'favorRequestUpdated',
            favor: updatedFavor,
        };

        await sendToClient(apiGwManagement, connectionId, broadcastUpdatePayload);

        // Cross-device sync: clear notifications on the user’s OTHER devices
        try {
            const connResult = await ddb.send(new GetCommand({
                TableName: CONNECTIONS_TABLE,
                Key: { connectionId },
            }));
            const deviceId = (connResult.Item as any)?.deviceId;
            await sendSyncUnreadToOtherDevices(
                callerID,
                favorRequestID,
                typeof deviceId === 'string' && deviceId ? [deviceId] : undefined
            );
        } catch (syncErr) {
            console.warn('[markRead] Failed to send sync_unread push (non-fatal):', syncErr);
        }

    } catch (e: any) {
        console.error('Error marking read:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to update read status.' });
    }
}

/**
 * Handles marking a favor request as resolved.
 * Only participants can resolve a request.
 */
async function resolveRequest(
    senderID: string,
    payload: any,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;
    const senderConnectionId = (await getSenderInfoByUserID(senderID))?.connectionId;

    if (!favorRequestID) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Missing favorRequestID.' });
        }
        return;
    }

    // 1. Fetch the favor request first to check authorization
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Favor request not found.' });
        }
        return;
    }

    // 2. Verify the sender is a participant
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this request.' });
        }
        return;
    }

    if (favor.status !== 'active') {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Request is already resolved.' });
        }
        return;
    }

    const nowIso = new Date().toISOString();

    // 3. Update Favor Status
    try {
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            // Also reset unread count on resolve
            UpdateExpression: 'SET #s = :resolved, updatedAt = :ua, unreadCount = :zero',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':resolved': 'resolved',
                ':ua': nowIso,
                ':zero': 0, // Reset unread count
            },
        }));

        // Get all participants for the broadcast
        const participants = await getAllParticipants(favor);

        // 4. Broadcast status update to all parties
        const broadcastPayload = {
            type: 'requestResolved',
            favorRequestID,
            resolvedBy: senderID,
            updatedAt: nowIso
        };

        await sendToAll(apiGwManagement, participants, broadcastPayload, { notifyOffline: false });

    } catch (e: any) {
        console.error('Error resolving request:', e);
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Failed to resolve request.' });
        }
    }
}

/**
 * Handles fetching the list of favor requests a user is involved in.
 * Includes:
 * - 1-to-1 requests where the user is sender or receiver
 * - Group requests where the user is a member of the team
 */
async function fetchRequests(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    // role can be 'sent', 'received', 'group', or 'all'
    const { role = 'all', limit = 50, nextToken } = payload;

    const queryLimit = Math.min(limit, 100);

    let exclusiveStartKey: any = undefined;
    if (nextToken) {
        try {
            exclusiveStartKey = JSON.parse(nextToken);
        } catch {
            console.warn('Invalid nextToken JSON received, ignoring:', nextToken);
        }
    }

    // Helper to query a single GSI
    const queryByIndex = async (
        indexName: string,
        keyName: string,
        keyValue: string,
        startKey?: any
    ) => {
        return ddb.send(
            new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: indexName,
                KeyConditionExpression: `${keyName} = :uid`,
                ExpressionAttributeValues: {
                    ':uid': keyValue,
                },
                ScanIndexForward: false, // newest first
                Limit: queryLimit,
                ...(startKey ? { ExclusiveStartKey: startKey } : {}),
            })
        );
    };

    // Helper to get all team IDs the user is a member of
    const getUserTeamIDs = async (): Promise<string[]> => {
        if (!TEAMS_TABLE) return [];

        const result = await ddb.send(new ScanCommand({
            TableName: TEAMS_TABLE,
            FilterExpression: 'contains(members, :callerID)',
            ExpressionAttributeValues: {
                ':callerID': callerID,
            },
            ProjectionExpression: 'teamID',
        }));

        return (result.Items || []).map((item: any) => item.teamID);
    };

    // Helper to fetch group requests for given team IDs
    const fetchGroupRequests = async (teamIDs: string[]): Promise<any[]> => {
        if (teamIDs.length === 0) return [];

        const groupRequestPromises = teamIDs.map(teamID =>
            queryByIndex('TeamIndex', 'teamID', teamID)
        );

        const results = await Promise.all(groupRequestPromises);
        return results.flatMap(r => r.Items || []);
    };

    let items: any[] = [];
    let newToken: string | undefined = undefined;

    try {
        if (role === 'sent') {
            const sentResult = await queryByIndex(
                'SenderIndex',
                'senderID',
                callerID,
                exclusiveStartKey
            );
            items = sentResult.Items || [];
            newToken = sentResult.LastEvaluatedKey ? JSON.stringify(sentResult.LastEvaluatedKey) : undefined;

        } else if (role === 'received') {
            const recvResult = await queryByIndex(
                'ReceiverIndex',
                'receiverID',
                callerID,
                exclusiveStartKey
            );
            items = recvResult.Items || [];
            newToken = recvResult.LastEvaluatedKey ? JSON.stringify(recvResult.LastEvaluatedKey) : undefined;

        } else if (role === 'group') {
            // Fetch only group requests where the user is a team member
            const teamIDs = await getUserTeamIDs();
            items = await fetchGroupRequests(teamIDs);

            // Sort by updatedAt desc
            items.sort((a, b) => {
                const aTime = a.updatedAt || '';
                const bTime = b.updatedAt || '';
                if (aTime < bTime) return 1;
                if (aTime > bTime) return -1;
                return 0;
            });

            items = items.slice(0, queryLimit);
            newToken = undefined;

        } else { // role = 'all' -> merge sent, received, group, AND forwarded (currentAssignee) requests
            // Fetch 1-to-1 requests (sent, received, and forwarded-to-me)
            const [sentResult, recvResult, assigneeResult, teamIDs] = await Promise.all([
                queryByIndex('SenderIndex', 'senderID', callerID),
                queryByIndex('ReceiverIndex', 'receiverID', callerID),
                queryByIndex('CurrentAssigneeIndex', 'currentAssigneeID', callerID),
                getUserTeamIDs(),
            ]);

            // Fetch group requests
            const groupItems = await fetchGroupRequests(teamIDs);

            const allItems = [
                ...(sentResult.Items || []),
                ...(recvResult.Items || []),
                ...(assigneeResult.Items || []),
                ...groupItems
            ];

            // Deduplicate by favorRequestID
            const byId = new Map<string, any>();
            for (const item of allItems) {
                if (!item || !item.favorRequestID) continue;
                byId.set(item.favorRequestID, item);
            }

            const merged = Array.from(byId.values());

            // Sort by updatedAt desc
            merged.sort((a, b) => {
                const aTime = a.updatedAt || '';
                const bTime = b.updatedAt || '';
                if (aTime < bTime) return 1;
                if (aTime > bTime) return -1;
                return 0;
            });

            // Limit the result set in-memory
            items = merged.slice(0, queryLimit);
            newToken = undefined; // Merging makes DDB pagination token complex/irrelevant
        }

        // Filter out deleted conversations (matches REST API getConversations logic)
        // - status === 'deleted': permanently deleted for everyone
        // - deletedBy includes callerID: per-user soft delete
        items = items.filter((item: any) =>
            item.status !== 'deleted' &&
            !(item.deletedBy && Array.isArray(item.deletedBy) && item.deletedBy.includes(callerID))
        );

        // Send the results back to the client
        await sendToClient(apiGwManagement, connectionId, {
            type: 'favorRequestsList',
            role,
            items,
            nextToken: newToken,
        });

    } catch (error) {
        console.error('Error fetching favor requests via WebSocket:', error);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to fetch favor requests list.' });
    }
}


// ========================================
// MESSAGE BROADCASTING AND PERSISTENCE
// ========================================

/**
 * Saves the message to DynamoDB and attempts to broadcast it to the connected recipient(s).
 * If the recipient(s) are offline, a push notification is triggered via SNS.
 * @param recipientIDs Optional array of user IDs to send to (used for groups/initial broadcast). 
 * If undefined, logic falls back to 1-to-1 (favor.senderID/receiverID).
 */
async function _saveAndBroadcastMessage(
    messageData: MessageData,
    apiGwManagement: ApiGatewayManagementApiClient,
    recipientIDs?: string[]
): Promise<void> {
    // 1. Persist the message
    await ddb.send(new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: messageData,
    }));

    // 1b. Update FavorRequest with lastMessage preview for sidebar
    const lastMessagePreview = messageData.type === 'file'
        ? '📎 Attachment'
        : messageData.content?.substring(0, 100) || '';
    try {
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID: messageData.favorRequestID },
            UpdateExpression: 'SET lastMessage = :lm, lastMessageAt = :lma, lastMessageSenderID = :lms, updatedAt = :ua',
            ExpressionAttributeValues: {
                ':lm': lastMessagePreview,
                ':lma': new Date().toISOString(),
                ':lms': messageData.senderID,
                ':ua': new Date().toISOString(),
            },
        }));
    } catch (e) {
        console.warn('Failed to update lastMessage on FavorRequest:', e);
    }

    // 2. Find the request details to identify recipients if not explicitly provided
    let participants = [messageData.senderID];
    let recipients = recipientIDs;

    if (!recipients) {
        const favorResult = await ddb.send(new GetCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID: messageData.favorRequestID },
        }));
        const favor = favorResult.Item as FavorRequest;
        if (!favor) return;

        // Use the new helper to get all non-sending participants
        recipients = await getRecipientIDs(favor, messageData.senderID);
        participants = [...participants, ...recipients];
    } else {
        participants = [...participants, ...recipients];
    }

    // 3. Broadcast to all participants (sender gets an echo, recipients get the new message)
    const broadcastPayload = {
        type: 'newMessage',
        message: messageData,
    };

    // sendToAll will handle real-time and SNS notifications for all users in the 'participants' list
    await sendToAll(apiGwManagement, participants, broadcastPayload, { notifyOffline: true, senderID: messageData.senderID });
}


// ========================================
// HELPER FUNCTIONS 
// ========================================

/** Retrieves sender (user and connection ID) information from the Connections table. */
async function getSenderInfo(connectionId: string): Promise<SenderInfo | undefined> {
    const result = await ddb.send(new GetCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
    }));
    const item = result.Item as (SenderInfo & { ttl: number }) | undefined;

    if (!item) return undefined;
    return { connectionId: item.connectionId, userID: item.userID };
}

/** Retrieves all active connections for a User ID. */
async function getSenderInfosByUserID(userID: string): Promise<SenderInfo[]> {
    // NOTE: This assumes a Global Secondary Index (GSI) named 'UserIDIndex' exists
    // on the CONNECTIONS_TABLE with 'userID' as the Partition Key.
    const result = await ddb.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        IndexName: 'UserIDIndex',
        KeyConditionExpression: 'userID = :uid',
        ExpressionAttributeValues: { ':uid': userID },
    }));

    return (result.Items || [])
        .map((item: any) => ({
            connectionId: item?.connectionId,
            userID: item?.userID,
        }))
        .filter((x: any): x is SenderInfo => typeof x.connectionId === 'string' && typeof x.userID === 'string');
}

/** Retrieves one active connection for a User ID (legacy helper). */
async function getSenderInfoByUserID(userID: string): Promise<SenderInfo | undefined> {
    const all = await getSenderInfosByUserID(userID);
    return all[0];
}

type ConnectionRecord = SenderInfo & { deviceId?: string; client?: string };

/** Retrieves full connection records (incl. deviceId/client) for a User ID. */
async function getConnectionRecordsByUserID(userID: string): Promise<ConnectionRecord[]> {
    const senders = await getSenderInfosByUserID(userID);
    if (senders.length === 0) return [];

    // Fast path for the common case (single connection)
    if (senders.length === 1) {
        const one = senders[0];
        try {
            const result = await ddb.send(new GetCommand({
                TableName: CONNECTIONS_TABLE,
                Key: { connectionId: one.connectionId },
            }));
            const item = result.Item as any;
            if (!item?.connectionId || !item?.userID) return [one];
            return [{
                connectionId: item.connectionId,
                userID: item.userID,
                deviceId: typeof item.deviceId === 'string' ? item.deviceId : undefined,
                client: typeof item.client === 'string' ? item.client : undefined,
            }];
        } catch {
            return [one];
        }
    }

    // Batch-get the connection rows to include deviceId/client (GSI is KEYS_ONLY)
    try {
        const keys = senders.map(s => ({ connectionId: s.connectionId }));
        const batch = await ddb.send(new BatchGetCommand({
            RequestItems: {
                [CONNECTIONS_TABLE]: {
                    Keys: keys,
                },
            },
        }));

        const items = (batch.Responses?.[CONNECTIONS_TABLE] as any[]) || [];
        return items
            .map((item: any) => ({
                connectionId: item?.connectionId,
                userID: item?.userID,
                deviceId: typeof item?.deviceId === 'string' ? item.deviceId : undefined,
                client: typeof item?.client === 'string' ? item.client : undefined,
            }))
            .filter((x: any): x is ConnectionRecord => typeof x.connectionId === 'string' && typeof x.userID === 'string');
    } catch (e) {
        console.warn('[Connections] BatchGet failed, falling back to SenderInfo only:', e);
        return senders;
    }
}

/** Helper function to fetch user's first name and email from Cognito. */
async function getUserDetails(userID: string): Promise<{ email?: string; fullName: string; }> {
    if (!USER_POOL_ID) {
        console.error("USER_POOL_ID is missing for user detail lookup.");
        return { fullName: userID };
    }

    try {
        const command = new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: userID,
        });

        const response = await cognito.send(command);

        const emailAttr = response.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
        const givenNameAttr = response.UserAttributes?.find(attr => attr.Name === 'given_name')?.Value;
        const familyNameAttr = response.UserAttributes?.find(attr => attr.Name === 'family_name')?.Value;

        return {
            email: emailAttr,
            fullName: `${givenNameAttr || ''} ${familyNameAttr || ''}`.trim() || userID,
        };
    } catch (e) {
        console.error(`Error fetching Cognito user details for ${userID}:`, e);
        return { fullName: userID };
    }
}

/**
 * Sends an email notification to the receiver about a new favor request via SES.
 */
async function sendNewFavorNotificationEmail(
    senderID: string,
    receiverID: string,
    messageContent: string,
    requestType: string,
    deadline?: string
): Promise<void> {
    if (!SES_SOURCE_EMAIL) {
        console.warn('SES_SOURCE_EMAIL not configured. Skipping email notification.');
        return;
    }

    // 1. Get user details for Sender and Receiver
    const [sender, receiver] = await Promise.all([
        getUserDetails(senderID),
        getUserDetails(receiverID),
    ]);

    if (!receiver.email) {
        console.warn(`Receiver ${receiverID} has no email address. Skipping email.`);
        return;
    }

    const formattedDeadline = deadline ?
        new Date(deadline).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) :
        '';

    const deadlineText = formattedDeadline ?
        `\n\n**Deadline:** ${formattedDeadline}` :
        '';

    const emailHtmlBody = `
        <html>
            <body>
                <h1 style="color: #0070f3;">New ${requestType} Notification</h1>
                <p>Hello ${receiver.fullName},</p>
                <p>You have a new <strong>${requestType}</strong> from <strong>${sender.fullName}</strong> waiting for your attention in the app.</p>
                
                <div style="border: 1px solid #eaeaea; padding: 15px; margin: 20px 0; border-radius: 8px;">
                    <p style="font-weight: bold; margin-top: 0;">Initial Message:</p>
                    <blockquote style="border-left: 4px solid #0070f3; margin: 0; padding-left: 10px; font-style: italic; color: #555;">${messageContent}</blockquote>
                    
                    ${formattedDeadline ? `<p style="margin-top: 15px; font-weight: bold; color: #d97706;">Deadline: ${formattedDeadline}</p>` : ''}
                </div>
                
                <p>Please log in to the application to view and respond to this request.</p>
                <p>Thank you,<br>The System Team</p>
            </body>
        </html>
    `;

    const emailTextBody = `
        New ${requestType} Notification
        
        Hello ${receiver.fullName},
        
        You have a new ${requestType} from ${sender.fullName} waiting for your attention in the app.
        
        Initial Message: "${messageContent}"
        ${formattedDeadline ? `Deadline: ${formattedDeadline}` : ''}
        
        Please log in to the application to view and respond to this request.
    `;

    // 2. Send the email - UPDATED PAYLOAD FOR SES V2
    await ses.send(new SendEmailCommand({
        Destination: {
            ToAddresses: [receiver.email as string], // Cast to string as we check for null/undefined earlier
        },
        // V2 uses Content wrapper for Simple or Raw message format
        Content: {
            Simple: {
                Subject: {
                    Data: `New ${requestType}: ${sender.fullName} Needs Your Attention`,
                },
                Body: {
                    Text: { Data: emailTextBody },
                    Html: { Data: emailHtmlBody },
                },
            },
        },
        // V2 uses FromEmailAddress for the sender address
        FromEmailAddress: SES_SOURCE_EMAIL,
    }));

    console.log(`SES Notification sent to ${receiver.email} for favor request from ${sender.fullName}.`);
}

/**
 * Enhanced email notification for task assignments (both single and group).
 * Includes: task title, priority, deadline, group name, group members, description.
 */
interface TaskAssignmentEmailParams {
    senderID: string;
    recipientIDs: string[];
    initialMessage: string;
    requestType: string;
    deadline?: string;
    title?: string;
    priority?: string;
    teamName?: string;
    teamMembers?: string[];
    isGroup: boolean;
}

async function sendTaskAssignmentEmail(params: TaskAssignmentEmailParams): Promise<void> {
    const {
        senderID, recipientIDs, initialMessage, requestType,
        deadline, title, priority, teamName, teamMembers, isGroup,
    } = params;

    if (!SES_SOURCE_EMAIL) {
        console.warn('SES_SOURCE_EMAIL not configured. Skipping task assignment email.');
        return;
    }

    // 1. Get sender details
    const sender = await getUserDetails(senderID);

    // 2. Get all recipient details in parallel
    const recipientDetails = await Promise.all(
        recipientIDs.map(id => getUserDetails(id))
    );

    // 3. Get team member names (for group emails)
    let memberNames: string[] = [];
    if (isGroup && teamMembers && teamMembers.length > 0) {
        const memberDetails = await Promise.all(
            teamMembers.map(id => getUserDetails(id))
        );
        memberNames = memberDetails.map(m => m.fullName);
    }

    // 4. Format values
    const formattedDeadline = deadline
        ? new Date(deadline).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
        : 'Not set';

    const priorityColors: Record<string, string> = {
        critical: '#dc2626',
        high: '#ea580c',
        medium: '#d97706',
        low: '#16a34a',
    };
    const priorityColor = priorityColors[(priority || 'medium').toLowerCase()] || '#6b7280';
    const priorityLabel = (priority || 'Medium').charAt(0).toUpperCase() + (priority || 'Medium').slice(1);

    const taskTitle = title || initialMessage.substring(0, 100);

    // 5. Build HTML email
    const groupSection = isGroup ? `
        <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px; vertical-align: top;">Group:</td>
            <td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #1f2937;">${teamName}</td>
        </tr>
        <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; vertical-align: top;">Members:</td>
            <td style="padding: 8px 0; font-size: 14px; color: #1f2937;">${memberNames.join(', ')}</td>
        </tr>
    ` : '';

    const emailHtmlBody = `
    <html>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 32px 0;">
            <tr>
                <td align="center">
                    <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                        <!-- Header -->
                        <tr>
                            <td style="background: linear-gradient(135deg, #0070f3, #0ea5e9); padding: 24px 32px;">
                                <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700;">
                                    📋 New Task Assignment
                                </h1>
                                <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">
                                    ${isGroup ? `Group: ${teamName}` : `From: ${sender.fullName}`}
                                </p>
                            </td>
                        </tr>
                        <!-- Body -->
                        <tr>
                            <td style="padding: 32px;">
                                <!-- Task Title -->
                                <h2 style="margin: 0 0 20px; color: #1f2937; font-size: 18px; font-weight: 600;">
                                    ${taskTitle}
                                </h2>

                                <!-- Task Details Table -->
                                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                                    <tr>
                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Assigned By:</td>
                                        <td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #1f2937;">${sender.fullName}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Type:</td>
                                        <td style="padding: 8px 0; font-size: 14px; color: #1f2937;">${requestType}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Priority:</td>
                                        <td style="padding: 8px 0;">
                                            <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; color: #ffffff; background-color: ${priorityColor};">
                                                ${priorityLabel}
                                            </span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Deadline:</td>
                                        <td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: ${deadline ? '#dc2626' : '#6b7280'};">
                                            ${formattedDeadline}
                                        </td>
                                    </tr>
                                    ${groupSection}
                                </table>

                                <!-- Description -->
                                <div style="border-left: 4px solid #0070f3; padding: 12px 16px; margin: 20px 0; background-color: #eff6ff; border-radius: 0 8px 8px 0;">
                                    <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280; text-transform: uppercase; font-weight: 600;">Description</p>
                                    <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${initialMessage}</p>
                                </div>

                                <!-- CTA -->
                                <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px;">
                                    Please log in to the application to view and respond to this task.
                                </p>
                            </td>
                        </tr>
                        <!-- Footer -->
                        <tr>
                            <td style="background-color: #f9fafb; padding: 16px 32px; border-top: 1px solid #e5e7eb;">
                                <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                                    Today's Dental Insights Communication System
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>`;

    const emailTextBody = `
New Task Assignment

Title: ${taskTitle}
Assigned By: ${sender.fullName}
Type: ${requestType}
Priority: ${priorityLabel}
Deadline: ${formattedDeadline}
${isGroup ? `Group: ${teamName}\nMembers: ${memberNames.join(', ')}` : ''}

Description:
${initialMessage}

Please log in to the application to view and respond to this task.
    `.trim();

    // 6. Send emails to all recipients
    const emailSubject = isGroup
        ? `📋 New ${requestType} in ${teamName}: ${taskTitle}`
        : `📋 New ${requestType} from ${sender.fullName}: ${taskTitle}`;

    const emailPromises = recipientDetails
        .filter(r => r.email)
        .map(recipient =>
            ses.send(new SendEmailCommand({
                Destination: { ToAddresses: [recipient.email as string] },
                Content: {
                    Simple: {
                        Subject: { Data: emailSubject },
                        Body: {
                            Text: { Data: emailTextBody },
                            Html: { Data: emailHtmlBody },
                        },
                    },
                },
                FromEmailAddress: SES_SOURCE_EMAIL,
            }))
        );

    await Promise.all(emailPromises);
    console.log(`Task assignment email sent to ${emailPromises.length} recipient(s) for "${taskTitle}" from ${sender.fullName}.`);
}

async function fetchHistory(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, limit = 100, lastTimestamp } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID for history fetch.' });
        return;
    }

    try {
        // 1. Fetch the favor request to validate authorization
        const favorResult = await ddb.send(new GetCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
        }));
        const favor = favorResult.Item as FavorRequest;

        if (!favor) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Favor request not found.' });
            return;
        }

        // 2. Verify the caller is a participant (works for both 1-to-1 and group requests)
        const isParticipant = await isUserParticipant(favor, callerID);
        if (!isParticipant) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this request.' });
            return;
        }

        // 3. Query the MessagesTable (PK: favorRequestID, SK: timestamp)
        const queryInput = {
            TableName: MESSAGES_TABLE,
            KeyConditionExpression: 'favorRequestID = :id',
            ExpressionAttributeValues: { ':id': favorRequestID },
            ScanIndexForward: true, // Chronological order (oldest first)
            Limit: limit,
            // Optional: Use ExclusiveStartKey for pagination (not fully implemented here, just lastTimestamp as anchor)
        };

        const historyResult = await ddb.send(new QueryCommand(queryInput));

        // 4. Send history back to the client
        await sendToClient(apiGwManagement, connectionId, {
            type: 'favorHistory',
            favorRequestID,
            messages: historyResult.Items || [],
            // nextToken: historyResult.LastEvaluatedKey // To implement robust pagination
        });
    } catch (error: any) {
        console.error(`[fetchHistory] Error fetching history for favorRequestID=${favorRequestID}, callerID=${callerID}:`, error);
        await sendToClient(apiGwManagement, connectionId, {
            type: 'error',
            message: `Failed to fetch message history: ${error.message || 'Unknown error'}`
        });
    }
}
/** Sends a JSON payload back to a specific client. */
async function sendToClient(apiGwManagement: ApiGatewayManagementApiClient, connectionId: string, data: any): Promise<void> {
    try {
        await apiGwManagement.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(data) as any,
        }));
    } catch (e) {
        if ((e as any).statusCode === 410) {
            console.warn(`Found stale connection, deleting: ${connectionId}`);
            // Clean up stale connections so users don’t get stuck as “online”.
            if (CONNECTIONS_TABLE) {
                try {
                    await ddb.send(new DeleteCommand({
                        TableName: CONNECTIONS_TABLE,
                        Key: { connectionId },
                    }));
                } catch (deleteErr) {
                    console.warn(`Failed to delete stale connection ${connectionId}:`, deleteErr);
                }
            }
        } else {
            console.error('Failed to send data to connection:', e);
        }
    }
}

/** Sends a message to a list of user IDs by finding their active connections. */
async function sendToAll(
    apiGwManagement: ApiGatewayManagementApiClient,
    userIDs: string[],
    data: any,
    options: { notifyOffline: boolean; senderID?: string; senderName?: string }
): Promise<void> {
    const connectionPromises = userIDs.map(id => getConnectionRecordsByUserID(id));
    const connectionsByUser = await Promise.all(connectionPromises);

    // Device-aware push: exclude devices that are already connected via WS
    const excludeDeviceIds = new Set<string>();
    const pushRecipients = options.notifyOffline
        ? userIDs.filter(uid => uid && uid !== options.senderID)
        : [];

    for (let i = 0; i < userIDs.length; i++) {
        const userID = userIDs[i];
        const conns = connectionsByUser[i];

        if (conns && conns.length > 0) {
            // User is online (at least one active WS connection), send via WebSocket to ALL devices/tabs
            for (const conn of conns) {
                await sendToClient(apiGwManagement, conn.connectionId, data);
                if (pushRecipients.includes(userID) && conn.deviceId) {
                    excludeDeviceIds.add(conn.deviceId);
                }
            }
        }
    }

    // Send push notifications to recipient users' OFFLINE devices (exclude WS-connected deviceIds)
    if (pushRecipients.length > 0 && options.notifyOffline) {
        const messageData = data.message as MessageData;

        if (messageData) {
            // For message notifications, use push notifications if available
            await sendPushNotificationsToOfflineUsers(
                pushRecipients,
                messageData,
                options.senderName,
                excludeDeviceIds.size > 0 ? Array.from(excludeDeviceIds) : undefined
            );
        }
    }
}

/**
 * Send push notifications to offline users via the send-push Lambda.
 * Falls back to SNS topic if push notifications are not configured.
 */
async function sendPushNotificationsToOfflineUsers(
    offlineUserIds: string[],
    messageData: any,
    senderName?: string,
    excludeDeviceIds?: string[]
): Promise<void> {
    if (offlineUserIds.length === 0) {
        return;
    }

    // Use the actual content to create a useful preview
    const preview = messageData.content && messageData.content.length > 100
        ? messageData.content.substring(0, 97) + '...'
        : messageData.content || '';

    // If push notifications are enabled, use the send-push Lambda
    if (PUSH_NOTIFICATIONS_ENABLED && SEND_PUSH_FUNCTION_ARN) {
        console.log(`[PushNotifications] Sending to ${offlineUserIds.length} user(s) via Lambda`, {
            excludeDeviceIdsCount: excludeDeviceIds?.length || 0,
        });

        try {
            const notificationPayload = {
                _internalCall: true,
                userIds: offlineUserIds,
                ...(excludeDeviceIds && excludeDeviceIds.length > 0 ? { excludeDeviceIds } : {}),
                notification: {
                    title: senderName ? `Message from ${senderName}` : 'New Message',
                    body: preview,
                    type: 'new_message',
                    data: {
                        conversationId: messageData.favorRequestID,
                        tag: `conversation-${messageData.favorRequestID}`,
                        senderID: messageData.senderID,
                        action: 'open_conversation',
                        url: `/#/communication?favorRequestID=${encodeURIComponent(messageData.favorRequestID)}`,
                        timestamp: Date.now(),
                    },
                    threadId: `conversation-${messageData.favorRequestID}`,
                },
            };

            const response = await lambdaClient.send(new InvokeCommand({
                FunctionName: SEND_PUSH_FUNCTION_ARN,
                Payload: JSON.stringify(notificationPayload),
                InvocationType: 'Event', // Async invocation - don't wait for response
            }));

            console.log(`[PushNotifications] Lambda invoked, StatusCode: ${response.StatusCode}`);
        } catch (error: any) {
            console.error('[PushNotifications] Failed to invoke send-push Lambda:', error.message);
            // Fall back to SNS if push notification fails
            await publishSnsNotification({ ...messageData, offlineRecipients: offlineUserIds });
        }
    } else {
        // Fallback to SNS topic
        await publishSnsNotification({ ...messageData, offlineRecipients: offlineUserIds });
    }
}

/**
 * Cross-device sync for unread/notification clearing.
 * Sent to the same user’s OTHER devices when unread state changes elsewhere.
 */
async function sendSyncUnreadToOtherDevices(
    userId: string,
    favorRequestID: string,
    excludeDeviceIds?: string[]
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED || !SEND_PUSH_FUNCTION_ARN) return;

    try {
        const payload = {
            _internalCall: true,
            userId,
            skipPreferenceCheck: true,
            ...(excludeDeviceIds && excludeDeviceIds.length > 0 ? { excludeDeviceIds } : {}),
            notification: {
                title: 'Sync',
                body: 'Unread state updated',
                type: 'sync_unread',
                data: {
                    type: 'sync_unread',
                    conversationId: favorRequestID,
                    tag: `conversation-${favorRequestID}`,
                    timestamp: Date.now(),
                },
            },
        };

        await lambdaClient.send(new InvokeCommand({
            FunctionName: SEND_PUSH_FUNCTION_ARN,
            Payload: Buffer.from(JSON.stringify(payload)),
        }));
    } catch (e) {
        console.warn('[PushNotifications] Failed to send sync_unread:', e);
    }
}

/** Publishes a push notification to the SNS topic (legacy fallback). */
async function publishSnsNotification(messageData: any): Promise<void> {
    if (!NOTIFICATIONS_TOPIC_ARN) {
        console.warn('SNS Topic ARN not configured. Skipping notification.');
        return;
    }

    // Use the actual content to create a useful preview
    const preview = messageData.content && messageData.content.length > 100
        ? messageData.content.substring(0, 97) + '...'
        : messageData.content || '';

    await sns.send(new PublishCommand({
        TopicArn: NOTIFICATIONS_TOPIC_ARN,
        Message: JSON.stringify({
            // Structure payload for push notification consumption
            source: 'favor_request',
            favorRequestID: messageData.favorRequestID,
            senderID: messageData.senderID,
            messagePreview: preview,
            // Pass group context if available
            teamID: messageData.teamID,
            offlineRecipients: messageData.offlineRecipients, // List of users who should receive the notification
        }),
    }));
}

/**
 * Send push notification for task-related events
 */
async function sendTaskPushNotification(
    userIds: string[],
    type: 'task_assigned' | 'task_forwarded' | 'task_completed',
    taskTitle: string,
    senderName: string,
    taskId: string,
    additionalData?: Record<string, any>
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED || userIds.length === 0) {
        return;
    }

    let title: string;
    let body: string;

    switch (type) {
        case 'task_assigned':
            title = `New Task: ${taskTitle}`;
            body = `Assigned by ${senderName}`;
            break;
        case 'task_forwarded':
            title = 'Task Forwarded to You';
            body = `${senderName} forwarded: ${taskTitle}`;
            break;
        case 'task_completed':
            title = 'Task Completed';
            body = `${senderName} marked "${taskTitle}" as complete`;
            break;
        default:
            return;
    }

    try {
        const notificationPayload = {
            _internalCall: true,
            userIds,
            notification: {
                title,
                body,
                type,
                data: {
                    taskId,
                    action: 'open_task',
                    ...additionalData,
                },
            },
        };

        await lambdaClient.send(new InvokeCommand({
            FunctionName: SEND_PUSH_FUNCTION_ARN,
            Payload: JSON.stringify(notificationPayload),
            InvocationType: 'Event',
        }));

        console.log(`[PushNotifications] Task notification sent to ${userIds.length} users`);
    } catch (error: any) {
        console.error('[PushNotifications] Failed to send task notification:', error.message);
    }
}

/**
 * Send push notification for meeting events
 */
async function sendMeetingPushNotification(
    userIds: string[],
    type: 'meeting_scheduled' | 'meeting_updated' | 'meeting_deleted',
    meetingTitle: string,
    organizerName: string,
    meetingId: string,
    startTime?: string
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED || userIds.length === 0) {
        return;
    }

    let title: string;
    let body: string;

    const dateStr = startTime
        ? new Date(startTime).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        })
        : '';

    switch (type) {
        case 'meeting_scheduled':
            title = `Meeting: ${meetingTitle}`;
            body = `${organizerName} scheduled for ${dateStr}`;
            break;
        case 'meeting_updated':
            title = 'Meeting Updated';
            body = `${meetingTitle} has been modified`;
            break;
        case 'meeting_deleted':
            title = 'Meeting Cancelled';
            body = `${meetingTitle} has been cancelled`;
            break;
        default:
            return;
    }

    try {
        const notificationPayload = {
            _internalCall: true,
            userIds,
            notification: {
                title,
                body,
                type: 'meeting_scheduled',
                data: {
                    meetingId,
                    action: 'open_meeting',
                    startTime,
                },
            },
        };

        await lambdaClient.send(new InvokeCommand({
            FunctionName: SEND_PUSH_FUNCTION_ARN,
            Payload: JSON.stringify(notificationPayload),
            InvocationType: 'Event',
        }));

        console.log(`[PushNotifications] Meeting notification sent to ${userIds.length} users`);
    } catch (error: any) {
        console.error('[PushNotifications] Failed to send meeting notification:', error.message);
    }
}

/** * Handles the file sharing request by generating a signed S3 PUT URL.
 * Also returns the fileType for client-side upload configuration.
 */
async function getPresignedUrl(senderID: string, payload: any, connectionId: string, apiGwManagement: ApiGatewayManagementApiClient): Promise<void> {
    if (!payload.fileName || !payload.fileType || !payload.favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing file details or favorRequestID' });
        return;
    }

    if (!FILE_BUCKET_NAME) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: File bucket not configured.' });
        return;
    }

    // Verify the sender is a participant in this request before issuing an upload URL
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: payload.favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;
    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Favor request not found.' });
        return;
    }
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this request.' });
        return;
    }

    const rawName = String(payload.fileName);
    const safeFileName = rawName.split('/').pop()?.split('\\').pop() || 'file';

    // Key structure: favors/{favorRequestID}/{senderID}-{UUID}-{fileName}
    const fileKey = `favors/${payload.favorRequestID}/${senderID}-${uuidv4()}-${safeFileName}`;

    const command = new PutObjectCommand({
        Bucket: FILE_BUCKET_NAME,
        Key: fileKey,
        ContentType: payload.fileType,
    });

    try {
        const url = await getSignedUrl(s3, command, { expiresIn: 900 }); // URL valid for 15 minutes

        await sendToClient(apiGwManagement, connectionId, {
            type: 'presignedUrl',
            favorRequestID: payload.favorRequestID,
            url: url,
            fileKey: fileKey,
            fileType: payload.fileType, // Include fileType in response
        });
    } catch (e) {
        console.error('Error generating signed URL:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to generate file upload URL' });
    }
}

/**
 * Generates a signed S3 GET URL for an existing file (download/preview).
 * This is distinct from `getPresignedUrl`, which returns a PUT URL for uploads.
 */
async function getPresignedDownloadUrl(
    requesterID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, fileKey } = payload || {};

    if (!favorRequestID || !fileKey) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID or fileKey.' });
        return;
    }

    if (!FILE_BUCKET_NAME) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: File bucket not configured.' });
        return;
    }

    // Ensure the request is scoped to the conversation and not an arbitrary S3 key
    const cleanKey = sanitizeFileKey(String(fileKey));
    const expectedPrefix = `favors/${favorRequestID}/`;
    if (!cleanKey.startsWith(expectedPrefix)) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Invalid fileKey for this conversation.' });
        return;
    }

    // Validate authorization (must be a participant of the conversation)
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;
    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Favor request not found.' });
        return;
    }

    const isParticipant = await isUserParticipant(favor, requesterID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this request.' });
        return;
    }

    try {
        const command = new GetObjectCommand({
            Bucket: FILE_BUCKET_NAME,
            Key: cleanKey,
        });

        const url = await getSignedUrl(s3, command, { expiresIn: 900 }); // URL valid for 15 minutes

        await sendToClient(apiGwManagement, connectionId, {
            type: 'presignedDownloadUrl',
            favorRequestID,
            url,
            fileKey: cleanKey,
        });
    } catch (e) {
        console.error('Error generating signed download URL:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to generate file download URL' });
    }
}

/**
 * Normalizes a DynamoDB "members" attribute to a string[].
 * Some tables may store members as a List (array) or a String Set (JS Set via DocumentClient).
 */
function normalizeMembers(members: unknown): string[] {
    if (Array.isArray(members)) {
        return members.filter((m): m is string => typeof m === 'string');
    }
    if (members instanceof Set) {
        return Array.from(members).filter((m): m is string => typeof m === 'string');
    }
    return [];
}

// ========================================
// TASK MANAGEMENT FUNCTIONS
// ========================================

/**
 * Forward a task to another user with optional acceptance requirement.
 */
async function forwardTask(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, forwardTo, message, deadline, requireAcceptance = false, notifyOriginalAssignee = true } = payload;

    if (!favorRequestID || !forwardTo) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID or forwardTo.' });
        return;
    }

    // 1. Fetch the favor request
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Task not found.' });
        return;
    }

    // 2. Verify the sender is a participant
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this task.' });
        return;
    }

    // 3. Create forward record
    const forwardID = uuidv4();
    const nowIso = new Date().toISOString();
    const forwardRecord: ForwardRecord = {
        forwardID,
        fromUserID: senderID,
        toUserID: forwardTo,
        forwardedAt: nowIso,
        message: message || '',
        deadline: deadline || favor.deadline,
        requireAcceptance,
        status: requireAcceptance ? 'pending' : 'accepted',
        ...(requireAcceptance ? {} : { acceptedAt: nowIso }),
    };

    // 4. Update the favor request
    const existingChain = favor.forwardingChain || [];
    const updatedChain = [...existingChain, forwardRecord];

    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: 'SET forwardingChain = :chain, currentAssigneeID = :assignee, #s = :status, updatedAt = :ua, requiresAcceptance = :ra, isForwarded = :fw',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
            ':chain': updatedChain,
            ':assignee': forwardTo,
            ':status': requireAcceptance ? 'forwarded' : 'active',
            ':ua': nowIso,
            ':ra': requireAcceptance,
            ':fw': true,
        },
    }));

    // 5. Notify participants
    const notifyList = [forwardTo];
    if (notifyOriginalAssignee && favor.senderID !== senderID) {
        notifyList.push(favor.senderID);
    }
    notifyList.push(senderID); // Confirm back to sender

    const notificationPayload = {
        type: 'taskForwarded',
        favorRequestID,
        forwardRecord,
        forwardedBy: senderID,
    };

    await sendToAll(apiGwManagement, notifyList, notificationPayload, { notifyOffline: true, senderID });

    // Send task-specific push notification to the forwardee
    const senderDetails = await getUserDetails(senderID);
    await sendTaskPushNotification(
        [forwardTo], // Only notify the person receiving the forwarded task
        'task_forwarded',
        favor.title || 'Task',
        senderDetails.fullName,
        favorRequestID,
        { requiresAcceptance: requireAcceptance }
    );

    console.log(`Task ${favorRequestID} forwarded from ${senderID} to ${forwardTo}`);
}

/**
 * Accept or reject a forwarded task.
 */
async function respondToForward(
    senderID: string,
    payload: any,
    action: 'accept' | 'reject',
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, forwardID, rejectionReason } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID.' });
        return;
    }

    // 1. Fetch the favor request
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Task not found.' });
        return;
    }

    // 2. Find the forward record for this user
    const forwardingChain = favor.forwardingChain || [];
    const forwardIndex = forwardID
        ? forwardingChain.findIndex(f => f.forwardID === forwardID)
        : forwardingChain.findIndex(f => f.toUserID === senderID && f.status === 'pending');

    if (forwardIndex === -1) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'No pending forward found for you.' });
        return;
    }

    const forwardRecord = forwardingChain[forwardIndex];
    if (forwardRecord.toUserID !== senderID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'This forward is not assigned to you.' });
        return;
    }

    // 3. Update the forward record
    const nowIso = new Date().toISOString();
    forwardingChain[forwardIndex] = {
        ...forwardRecord,
        status: action === 'accept' ? 'accepted' : 'rejected',
        ...(action === 'accept' ? { acceptedAt: nowIso } : { rejectedAt: nowIso, rejectionReason }),
    };

    // 4. Update the favor request status
    let newStatus: TaskStatus = favor.status;
    let newAssignee = favor.currentAssigneeID;

    if (action === 'accept') {
        newStatus = 'active';
    } else {
        // On rejection, return to previous assignee
        newStatus = 'pending';
        newAssignee = forwardRecord.fromUserID;
    }

    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: 'SET forwardingChain = :chain, #s = :status, currentAssigneeID = :assignee, updatedAt = :ua' +
            (action === 'reject' ? ', rejectionReason = :reason, rejectedAt = :rejAt' : ''),
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
            ':chain': forwardingChain,
            ':status': newStatus,
            ':assignee': newAssignee,
            ':ua': nowIso,
            ...(action === 'reject' ? { ':reason': rejectionReason, ':rejAt': nowIso } : {}),
        },
    }));

    // 5. Notify participants
    const participants = await getAllParticipants(favor);
    const notificationPayload = {
        type: action === 'accept' ? 'taskForwardAccepted' : 'taskForwardRejected',
        favorRequestID,
        forwardID: forwardRecord.forwardID,
        respondedBy: senderID,
        ...(action === 'reject' ? { rejectionReason } : {}),
    };

    await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: true, senderID });

    console.log(`Task ${favorRequestID} forward ${action}ed by ${senderID}`);
}

/**
 * Mark a task as completed with optional notes.
 */
async function markTaskCompleted(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, completionNotes } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID.' });
        return;
    }

    // 1. Fetch the favor request
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Task not found.' });
        return;
    }

    // 2. Verify the sender is a participant
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this task.' });
        return;
    }

    // 3. Update the task
    const nowIso = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: 'SET #s = :status, completedAt = :completedAt, completionNotes = :notes, updatedAt = :ua, unreadCount = :zero',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
            ':status': 'completed',
            ':completedAt': nowIso,
            ':notes': completionNotes || '',
            ':ua': nowIso,
            ':zero': 0,
        },
    }));

    // 4. Notify all participants
    const participants = await getAllParticipants(favor);
    const notificationPayload = {
        type: 'taskCompleted',
        favorRequestID,
        completedBy: senderID,
        completedAt: nowIso,
        completionNotes,
    };

    await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: true, senderID });

    console.log(`Task ${favorRequestID} marked as completed by ${senderID}`);
}

/**
 * Update task deadline.
 */
async function updateTaskDeadline(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID, deadline, removeDeadline } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID.' });
        return;
    }

    // 1. Fetch the favor request
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Task not found.' });
        return;
    }

    // 2. Verify the sender is a participant
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this task.' });
        return;
    }

    // 3. Update the deadline
    const nowIso = new Date().toISOString();

    if (removeDeadline) {
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'REMOVE deadline SET updatedAt = :ua',
            ExpressionAttributeValues: { ':ua': nowIso },
        }));
    } else {
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET deadline = :deadline, updatedAt = :ua',
            ExpressionAttributeValues: { ':deadline': deadline, ':ua': nowIso },
        }));
    }

    // 4. Notify all participants
    const participants = await getAllParticipants(favor);
    const notificationPayload = {
        type: 'deadlineUpdated',
        favorRequestID,
        updatedBy: senderID,
        deadline: removeDeadline ? null : deadline,
        updatedAt: nowIso,
    };

    await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: false });

    console.log(`Task ${favorRequestID} deadline updated by ${senderID}`);
}

/**
 * Get detailed task information including forwarding history.
 */
async function getTaskDetails(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID.' });
        return;
    }

    // 1. Fetch the favor request
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Task not found.' });
        return;
    }

    // 2. Verify the sender is a participant
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this task.' });
        return;
    }

    // 3. Get participant details
    const participants = await getAllParticipants(favor);

    await sendToClient(apiGwManagement, connectionId, {
        type: 'taskDetails',
        favor,
        participants,
    });
}

/**
 * Get forward history for a task.
 */
async function getForwardHistory(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID.' });
        return;
    }

    // 1. Fetch the favor request
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Task not found.' });
        return;
    }

    // 2. Verify the sender is a participant
    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this task.' });
        return;
    }

    await sendToClient(apiGwManagement, connectionId, {
        type: 'forwardHistory',
        favorRequestID,
        forwardingChain: favor.forwardingChain || [],
        senderID: favor.senderID,
        createdAt: favor.createdAt,
    });
}

/**
 * Delete a conversation/task (soft delete or archive).
 */
async function deleteConversation(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;

    if (!favorRequestID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing favorRequestID.' });
        return;
    }

    // 1. Fetch the favor request
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Task not found.' });
        return;
    }

    // 2. Allow any participant (sender, receiver, or current assignee) to delete
    const isParticipant = favor.senderID === senderID || favor.receiverID === senderID || favor.currentAssigneeID === senderID;
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant of this conversation.' });
        return;
    }

    // 3. Delete based on type
    const deleteType = payload.deleteType || 'forMe'; // 'forMe' or 'forEveryone'
    const nowIso = new Date().toISOString();

    if (deleteType === 'forEveryone') {
        // === PERMANENT DELETE: Set status to 'deleted' — hides for ALL participants ===
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET #s = :status, updatedAt = :ua',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':status': 'deleted',
                ':ua': nowIso,
            },
        }));

        // Notify all participants about permanent deletion
        const participants = await getAllParticipants(favor);
        await sendToAll(apiGwManagement, participants, {
            type: 'conversationDeleted',
            favorRequestID,
            deletedBy: senderID,
            deleteType: 'forEveryone',
        }, { notifyOffline: false });

        console.log(`Conversation ${favorRequestID} permanently deleted by ${senderID}`);
    } else {
        // === PER-USER DELETE: Add senderID to deletedBy list ===
        const currentDeletedBy = favor.deletedBy || [];
        if (!currentDeletedBy.includes(senderID)) {
            const updatedDeletedBy = [...currentDeletedBy, senderID];
            await ddb.send(new UpdateCommand({
                TableName: FAVORS_TABLE,
                Key: { favorRequestID },
                UpdateExpression: 'SET deletedBy = :db, updatedAt = :ua',
                ExpressionAttributeValues: {
                    ':db': updatedDeletedBy,
                    ':ua': nowIso,
                },
            }));
        }

        // Notify only the deleting user (per-user delete)
        await sendToClient(apiGwManagement, connectionId, {
            type: 'conversationDeleted',
            favorRequestID,
            deletedBy: senderID,
            deleteType: 'forMe',
        });

        console.log(`Conversation ${favorRequestID} deleted from view by ${senderID}`);
    }
}

// ========================================
// MEETING FUNCTIONS
// ========================================

/**
 * Schedule a new meeting.
 */
async function scheduleMeeting(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { conversationID, title, description, startTime, endTime, location, meetingLink, participants } = payload;

    if (!conversationID || !description || !meetingLink) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing required meeting fields.' });
        return;
    }

    if (!MEETINGS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Meetings table not configured.' });
        return;
    }

    // 1. Verify the conversation exists and sender is a participant
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: conversationID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Conversation not found.' });
        return;
    }

    const isParticipant = await isUserParticipant(favor, senderID);
    if (!isParticipant) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: You are not a participant in this conversation.' });
        return;
    }

    // 2. Create the meeting
    const meetingID = uuidv4();
    const nowIso = new Date().toISOString();
    const meetingParticipants = participants || await getAllParticipants(favor);

    const meeting: Meeting = {
        meetingID,
        conversationID,
        title: title || description.substring(0, 50),
        description,
        startTime: startTime || nowIso,
        endTime,
        location,
        meetingLink,
        organizerID: senderID,
        participants: meetingParticipants,
        status: 'scheduled',
        createdAt: nowIso,
        updatedAt: nowIso,
    };

    await ddb.send(new PutCommand({
        TableName: MEETINGS_TABLE,
        Item: meeting,
    }));

    // 3. Create a system message in the conversation (type: 'meeting' for rich card rendering)
    const messageData: MessageData = {
        messageID: `mtg-${Date.now()}-${uuidv4().substring(0, 8)}`,
        favorRequestID: conversationID,
        senderID,
        content: `📅 Meeting scheduled: ${meeting.title || description}`,
        timestamp: Date.now(),
        type: 'meeting' as any,
        meetingData: meeting,
    } as any;

    await _saveAndBroadcastMessage(messageData, apiGwManagement);

    // 4. Notify participants
    const notificationPayload = {
        type: 'meetingScheduled',
        meeting,
    };

    await sendToAll(apiGwManagement, meetingParticipants, notificationPayload, { notifyOffline: true, senderID });

    // Send meeting-specific push notification
    const organizerDetails = await getUserDetails(senderID);
    const otherParticipants = meetingParticipants.filter((p: string) => p !== senderID);
    await sendMeetingPushNotification(
        otherParticipants,
        'meeting_scheduled',
        meeting.title || description.substring(0, 50),
        organizerDetails.fullName,
        meetingID,
        meeting.startTime
    );

    console.log(`Meeting ${meetingID} scheduled by ${senderID} for conversation ${conversationID}`);
}

/**
 * Get meetings for a conversation or user.
 */
async function getMeetings(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { conversationID, status, limit = 50 } = payload;

    if (!MEETINGS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Meetings table not configured.' });
        return;
    }

    let meetings: Meeting[] = [];

    if (conversationID) {
        // Get meetings for a specific conversation
        const result = await ddb.send(new QueryCommand({
            TableName: MEETINGS_TABLE,
            IndexName: 'ConversationIndex',
            KeyConditionExpression: 'conversationID = :cid',
            ExpressionAttributeValues: { ':cid': conversationID },
            ScanIndexForward: false,
            Limit: limit,
        }));
        meetings = (result.Items || []) as Meeting[];
    } else {
        // Get meetings organized by the user
        const result = await ddb.send(new QueryCommand({
            TableName: MEETINGS_TABLE,
            IndexName: 'OrganizerIndex',
            KeyConditionExpression: 'organizerID = :oid',
            ExpressionAttributeValues: { ':oid': senderID },
            ScanIndexForward: false,
            Limit: limit,
        }));
        meetings = (result.Items || []) as Meeting[];
    }

    // Filter by status if provided
    if (status) {
        meetings = meetings.filter(m => m.status === status);
    }

    await sendToClient(apiGwManagement, connectionId, {
        type: 'meetingsList',
        meetings,
        conversationID,
    });
}

/**
 * Update an existing meeting.
 */
async function updateMeeting(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { meetingID, title, description, startTime, endTime, location, meetingLink, participants, status } = payload;

    if (!meetingID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing meetingID.' });
        return;
    }

    if (!MEETINGS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Meetings table not configured.' });
        return;
    }

    // 1. Fetch the meeting
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    const meeting = meetingResult.Item as Meeting;

    if (!meeting) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Meeting not found.' });
        return;
    }

    // 2. Only organizer can update
    if (meeting.organizerID !== senderID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only the organizer can update this meeting.' });
        return;
    }

    // 3. Update the meeting
    const nowIso = new Date().toISOString();
    const updateExpressions: string[] = ['updatedAt = :ua'];
    const expressionValues: Record<string, any> = { ':ua': nowIso };

    if (title !== undefined) { updateExpressions.push('title = :title'); expressionValues[':title'] = title; }
    if (description !== undefined) { updateExpressions.push('description = :desc'); expressionValues[':desc'] = description; }
    if (startTime !== undefined) { updateExpressions.push('startTime = :start'); expressionValues[':start'] = startTime; }
    if (endTime !== undefined) { updateExpressions.push('endTime = :endT'); expressionValues[':endT'] = endTime; }
    if (location !== undefined) { updateExpressions.push('location = :loc'); expressionValues[':loc'] = location; }
    if (meetingLink !== undefined) { updateExpressions.push('meetingLink = :link'); expressionValues[':link'] = meetingLink; }
    if (participants !== undefined) { updateExpressions.push('participants = :parts'); expressionValues[':parts'] = participants; }
    if (status !== undefined) { updateExpressions.push('#s = :status'); expressionValues[':status'] = status; }

    await ddb.send(new UpdateCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
        UpdateExpression: 'SET ' + updateExpressions.join(', '),
        ExpressionAttributeNames: status !== undefined ? { '#s': 'status' } : undefined,
        ExpressionAttributeValues: expressionValues,
    }));

    // 4. Notify participants
    const notificationPayload = {
        type: 'meetingUpdated',
        meetingID,
        updatedBy: senderID,
        changes: { title, description, startTime, endTime, location, meetingLink, participants, status },
    };

    await sendToAll(apiGwManagement, meeting.participants, notificationPayload, { notifyOffline: true, senderID });

    console.log(`Meeting ${meetingID} updated by ${senderID}`);
}

/**
 * Delete/cancel a meeting.
 */
async function deleteMeeting(
    senderID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { meetingID, notifyParticipants = true } = payload;

    if (!meetingID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Missing meetingID.' });
        return;
    }

    if (!MEETINGS_TABLE) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Server error: Meetings table not configured.' });
        return;
    }

    // 1. Fetch the meeting
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    const meeting = meetingResult.Item as Meeting;

    if (!meeting) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Meeting not found.' });
        return;
    }

    // 2. Only organizer can delete
    if (meeting.organizerID !== senderID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only the organizer can delete this meeting.' });
        return;
    }

    // 3. Update status to cancelled (soft delete)
    const nowIso = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
        UpdateExpression: 'SET #s = :status, updatedAt = :ua',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'cancelled', ':ua': nowIso },
    }));

    // 4. Notify participants if requested
    if (notifyParticipants) {
        const notificationPayload = {
            type: 'meetingDeleted',
            meetingID,
            deletedBy: senderID,
        };

        await sendToAll(apiGwManagement, meeting.participants, notificationPayload, { notifyOffline: true, senderID });
    }

    console.log(`Meeting ${meetingID} cancelled by ${senderID}`);
}
import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
    members: string[]; // Set of userID strings
    createdAt: string;
    updatedAt: string;
}

// Task status values
type TaskStatus = 'pending' | 'active' | 'in_progress' | 'completed' | 'rejected' | 'forwarded';
type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

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
    favorRequestID: string;
    senderID: string;
    content: string;
    timestamp: number;
    type: 'text' | 'file';
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
        members: uniqueMembers,
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
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');

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
        const teamResult = await ddb.send(new GetCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID },
        }));
        const team = teamResult.Item as Team;

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
            Key: { teamID },
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
 * Removes a user from an existing team. Only the team owner can perform this action.
 * The owner cannot remove themselves from the team.
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
        // 1. Fetch the team to verify ownership
        const teamResult = await ddb.send(new GetCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID },
        }));
        const team = teamResult.Item as Team;

        if (!team) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Team not found.' });
            return;
        }

        // 2. Check if caller is the owner
        if (team.ownerID !== callerID) {
            await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only the team owner can remove members.' });
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
            Key: { teamID },
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
        const teamResult = await ddb.send(new GetCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID },
        }));
        const team = teamResult.Item as Team;

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

    const favorRequestID = uuidv4();
    const timestamp = Date.now();
    const nowIso = new Date().toISOString();

    const newFavor: FavorRequest = {
        favorRequestID,
        senderID,
        // Include receiverID only for 1-to-1, teamID only for group
        ...(isGroupRequest ? { teamID: teamID } : { receiverID: receiverID }),
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
    };

    // 1. Create Favor Request Record
    await ddb.send(new PutCommand({
        TableName: FAVORS_TABLE,
        Item: newFavor,
    }));

    // 2. Create the initial message
    const messageData: MessageData = {
        favorRequestID,
        senderID,
        content: initialMessage,
        timestamp,
        type: 'text',
    };

    // 3. Save message and broadcast
    await _saveAndBroadcastMessage(messageData, apiGwManagement, isGroupRequest ? recipients : undefined);

    // 4. Send email notification (Only for 1-to-1 requests for simplicity)
    if (!isGroupRequest) {
        try {
            await sendNewFavorNotificationEmail(senderID, receiverID as string, initialMessage, requestType, deadline);
        } catch (e) {
            console.error("Failed to send SES notification email for 1-to-1:", e);
        }
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
    const { favorRequestID, content, fileKey, fileDetails } = payload;
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

    if (favor.status !== 'active' || recipientIDs.length === 0) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Request is inactive, resolved, or has no recipients.' });
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
        favorRequestID,
        senderID,
        content: content || '',
        timestamp,
        type: cleanFileKey ? 'file' : 'text',
        fileKey: cleanFileKey,
        fileDetails: fileDetails,
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
        if (!TEAMS_TABLE) {
            console.error("TEAMS_TABLE not configured for group lookup.");
            return [];
        }
        const teamResult = await ddb.send(new GetCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID: favor.teamID },
        }));
        const team = teamResult.Item as Team;

        // Recipients are all team members except the sender
        return team ? team.members.filter(memberId => memberId !== senderID) : [];

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
    if (!TEAMS_TABLE) {
        console.error("TEAMS_TABLE not configured for participant check.");
        return false;
    }

    const teamResult = await ddb.send(new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamID: favor.teamID },
    }));
    const team = teamResult.Item as Team;

    return team ? team.members.includes(userID) : false;
}

/**
 * Helper to get all participants (including sender) for a favor request.
 * Returns an array of all user IDs involved in the request.
 */
async function getAllParticipants(favor: FavorRequest): Promise<string[]> {
    if (favor.teamID) {
        if (!TEAMS_TABLE) {
            console.error("TEAMS_TABLE not configured for participant lookup.");
            return [favor.senderID];
        }
        const teamResult = await ddb.send(new GetCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID: favor.teamID },
        }));
        const team = teamResult.Item as Team;
        return team ? team.members : [favor.senderID];
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

        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
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

        } else { // role = 'all' -> merge sent, received, and group requests
            // Fetch 1-to-1 requests (sent and received)
            const [sentResult, recvResult, teamIDs] = await Promise.all([
                queryByIndex('SenderIndex', 'senderID', callerID),
                queryByIndex('ReceiverIndex', 'receiverID', callerID),
                getUserTeamIDs(),
            ]);

            // Fetch group requests
            const groupItems = await fetchGroupRequests(teamIDs);

            const allItems = [
                ...(sentResult.Items || []),
                ...(recvResult.Items || []),
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

/** Retrieves connection information by User ID. */
async function getSenderInfoByUserID(userID: string): Promise<SenderInfo | undefined> {
    // NOTE: This assumes a Global Secondary Index (GSI) named 'UserIDIndex' exists
    // on the CONNECTIONS_TABLE with 'userID' as the Partition Key.

    const result = await ddb.send(new QueryCommand({
        TableName: CONNECTIONS_TABLE,
        IndexName: 'UserIDIndex',
        KeyConditionExpression: 'userID = :uid',
        ExpressionAttributeValues: { ':uid': userID },
        Limit: 1,
    }));
    const item = result.Items?.[0] as SenderInfo | undefined;

    if (!item) return undefined;
    return { connectionId: item.connectionId, userID: item.userID };
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
            // In a real implementation, you would delete the stale connection here.
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
    const connectionPromises = userIDs.map(id => getSenderInfoByUserID(id));
    const connections = await Promise.all(connectionPromises);

    const offlineRecipients: string[] = [];

    for (let i = 0; i < userIDs.length; i++) {
        const userID = userIDs[i];
        const conn = connections[i];

        if (conn) {
            // User is online, send via WebSocket
            await sendToClient(apiGwManagement, conn.connectionId, data);
        } else if (options.notifyOffline && userID !== options.senderID) {
            // User is offline AND is a recipient (not the sender)
            offlineRecipients.push(userID);
        }
    }

    // Send push notifications to all offline recipients
    if (offlineRecipients.length > 0 && options.notifyOffline) {
        const messageData = data.message as MessageData;

        if (messageData) {
            // For message notifications, use push notifications if available
            await sendPushNotificationsToOfflineUsers(
                offlineRecipients,
                messageData,
                options.senderName
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
    senderName?: string
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
        console.log(`[PushNotifications] Sending to ${offlineUserIds.length} offline users via Lambda`);

        try {
            const notificationPayload = {
                _internalCall: true,
                userIds: offlineUserIds,
                notification: {
                    title: senderName ? `Message from ${senderName}` : 'New Message',
                    body: preview,
                    type: 'new_message',
                    data: {
                        conversationId: messageData.favorRequestID,
                        senderID: messageData.senderID,
                        action: 'open_conversation',
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

    // Key structure: favors/{favorRequestID}/{senderID}-{UUID}-{fileName}
    const fileKey = `favors/${payload.favorRequestID}/${senderID}-${uuidv4()}-${payload.fileName}`;

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
        UpdateExpression: 'SET forwardingChain = :chain, currentAssigneeID = :assignee, #s = :status, updatedAt = :ua, requiresAcceptance = :ra',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
            ':chain': updatedChain,
            ':assignee': forwardTo,
            ':status': requireAcceptance ? 'forwarded' : 'active',
            ':ua': nowIso,
            ':ra': requireAcceptance,
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

    // 2. Only the sender/creator can delete
    if (favor.senderID !== senderID) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized: Only the creator can delete this task.' });
        return;
    }

    // 3. Soft delete by updating status
    const nowIso = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: 'SET #s = :status, updatedAt = :ua',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
            ':status': 'deleted' as any, // Soft delete
            ':ua': nowIso,
        },
    }));

    // 4. Notify all participants
    const participants = await getAllParticipants(favor);
    const notificationPayload = {
        type: 'conversationDeleted',
        favorRequestID,
        deletedBy: senderID,
    };

    await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: false });

    console.log(`Task ${favorRequestID} deleted by ${senderID}`);
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

    // 3. Create a system message in the conversation
    const messageData: MessageData = {
        favorRequestID: conversationID,
        senderID,
        content: `Meeting scheduled: ${description}`,
        timestamp: Date.now(),
        type: 'text',
    };

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
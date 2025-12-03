import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || ''; 
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const TEAMS_TABLE = process.env.TEAMS_TABLE || ''; // <--- NEW TEAM TABLE NAME
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';
const NOTIFICATIONS_TOPIC_ARN = process.env.NOTICES_TOPIC_ARN || '';
const SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || 'no-reply@todaysdentalinsights.com';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

// SDK Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sns = new SNSClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const ses = new SESv2Client({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

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

interface FavorRequest {
    favorRequestID: string;
    senderID: string;
    // receiverID is optional for group chats
    receiverID?: string; // <--- MADE OPTIONAL
    // teamID is present for group chats/assignments
    teamID?: string; // <--- NEW FIELD
    status: 'active' | 'resolved';
    createdAt: string;
    updatedAt: string;
    userID: string; 
    
    requestType: 'General' | 'Assign Task' | 'Ask a Favor' | 'Other';
    unreadCount: number;
    initialMessage: string; 
    deadline?: string;
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
 */
async function startFavorRequest(
    senderID: string,
    payload: any,
    senderConnectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    // UPDATED: Destructure teamID, receiverID, initialMessage, requestType AND deadline
    const { receiverID, teamID, initialMessage, requestType, deadline } = payload;
    
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
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
        // For UserIndex, use senderID for now, though it's less useful for groups
        // A dedicated TeamIndex/Participant GSI would be better for groups
        userID: senderID, 
        requestType,
        // Set initial unread count to the number of non-sending recipients
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
        } catch(e) {
            console.error("Failed to send SES notification email for 1-to-1:", e);
        }
    }
    
    // 5. Send confirmation back to the sender
    await sendToClient(apiGwManagement, senderConnectionId, { 
        type: 'favorRequestStarted', 
        favorRequestID, 
        receiverID,
        teamID,
        requestType, 
        deadline,
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
async function sendToAll(apiGwManagement: ApiGatewayManagementApiClient, userIDs: string[], data: any, options: { notifyOffline: boolean, senderID?: string }): Promise<void> {
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
    
    // Trigger a single SNS notification for all offline recipients for this message
    if (offlineRecipients.length > 0 && options.notifyOffline) {
        // Prepare the payload for SNS, which should contain context for all affected users
        const messageData = data.message as MessageData;
        
        await publishSnsNotification({ 
            ...messageData, 
            offlineRecipients, // pass the list of users who are offline
        });
    }
}

/** Publishes a push notification to the SNS topic. */
async function publishSnsNotification(messageData: any): Promise<void> {
    if (!NOTIFICATIONS_TOPIC_ARN) {
        console.warn('SNS Topic ARN not configured. Skipping notification.');
        return;
    }
    
    // Use the actual content to create a useful preview
    const preview = messageData.content.length > 100 ? 
        messageData.content.substring(0, 97) + '...' : 
        messageData.content;
        
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
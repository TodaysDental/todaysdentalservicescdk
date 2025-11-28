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
            case 'createTeam': // <--- NEW ACTION
                await createTeam(senderID, payload, connectionId, apiGwManagement);
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
    
    // Determine the list of all non-sending recipients
    const recipientIDs = await getRecipientIDs(favor, senderID);

    if (!favor || favor.status !== 'active' || recipientIDs.length === 0) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Request is inactive, resolved, or unauthorized.' });
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
 * Handles marking all messages in a conversation as read.
 */
async function markRead(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { favorRequestID } = payload;
    const callerConnectionId = (await getSenderInfoByUserID(callerID))?.connectionId;

    if (!favorRequestID) {
        if (callerConnectionId) {
            await sendToClient(apiGwManagement, callerConnectionId, { type: 'error', message: 'Missing favorRequestID.' });
        }
        return;
    }

    // 1. Reset unreadCount to 0 for the specified request
    try {
        const updateResult = await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET unreadCount = :zero',
            ExpressionAttributeValues: { 
                ':zero': 0,
                ':caller': callerID
            },
            // Condition check ensures only participants can reset the count
            // Note the addition of attribute_exists(teamID) to cover group participants
            ConditionExpression: 'senderID = :caller OR receiverID = :caller OR attribute_exists(teamID)',
            ReturnValues: 'ALL_NEW', 
        }));
        
        // 2. Broadcast the read status update to the caller
        const updatedFavor = updateResult.Attributes as FavorRequest;
        const broadcastUpdatePayload = {
            type: 'favorRequestUpdated',
            favor: updatedFavor,
        };

        if (callerConnectionId) {
            await sendToClient(apiGwManagement, callerConnectionId, broadcastUpdatePayload);
        }
    } catch (e: any) {
        if (e.name === 'ConditionalCheckFailedException') {
            console.warn(`Mark read failed: Unauthorized or request not found: ${favorRequestID}`);
        } else {
            console.error('Error marking read:', e);
            if (callerConnectionId) {
                await sendToClient(apiGwManagement, callerConnectionId, { type: 'error', message: 'Failed to update read status.' });
            }
        }
    }
}

/**
 * Handles marking a favor request as resolved.
 * Note: Logic remains largely 1-to-1 focused but works if `receiverID` is null (group chat), 
 * provided the sender is a known participant.
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
    
    const nowIso = new Date().toISOString();

    // 1. Update Favor Status
    try {
        const updateResult = await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            // Also reset unread count on resolve
            UpdateExpression: 'SET #s = :resolved, updatedAt = :ua, unreadCount = :zero', 
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':resolved': 'resolved',
                ':ua': nowIso,
                ':sender': senderID,
                ':active': 'active',
                ':zero': 0, // Reset unread count
            },
            // Condition: Only sender or receiver (or implied participant by teamID) can resolve, and it must be active.
            ConditionExpression: '#s = :active AND (senderID = :sender OR receiverID = :sender OR attribute_exists(teamID))',
            ReturnValues: 'ALL_NEW',
        }));

        const favor = updateResult.Attributes as FavorRequest;
        
        // Use the helper to determine all participants for the broadcast
        let recipients = await getRecipientIDs(favor, senderID);
        let participants = [...recipients, senderID];

        // 2. Broadcast status update to all parties
        const broadcastPayload = {
            type: 'requestResolved',
            favorRequestID,
            resolvedBy: senderID,
            updatedAt: nowIso
        };
        
        await sendToAll(apiGwManagement, participants, broadcastPayload, { notifyOffline: false });
        
    } catch (e: any) {
        if (e.name === 'ConditionalCheckFailedException') {
             if (senderConnectionId) {
                await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Request is already resolved or unauthorized.' });
             }
        } else {
            throw e; // Re-throw other errors
        }
    }
}

/**
 * Handles fetching the list of favor requests a user is involved in.
 * Note: This currently only supports lookups via SenderIndex/ReceiverIndex GSIs. 
 * Group requests where the caller is only a *member* (not sender/receiver) 
 * will not be fetched efficiently and should ideally be handled by a dedicated TeamIndex GSI 
 * or filtered manually from a broader query.
 */
async function fetchRequests(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    // role can be 'sent', 'received', or 'all'
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
        startKey?: any
    ) => {
        return ddb.send(
            new QueryCommand({
                TableName: FAVORS_TABLE, 
                IndexName: indexName,
                KeyConditionExpression: `${keyName} = :uid`,
                ExpressionAttributeValues: {
                    ':uid': callerID,
                },
                ScanIndexForward: false, // newest first
                Limit: queryLimit,
                ...(startKey ? { ExclusiveStartKey: startKey } : {}),
            })
        );
    };
    
    let items: any[] = [];
    let newToken: string | undefined = undefined;

    try {
        if (role === 'sent') {
            const sentResult = await queryByIndex(
                'SenderIndex',
                'senderID',
                exclusiveStartKey
            );
            items = sentResult.Items || [];
            newToken = sentResult.LastEvaluatedKey ? JSON.stringify(sentResult.LastEvaluatedKey) : undefined;
            
        } else if (role === 'received') {
            const recvResult = await queryByIndex(
                'ReceiverIndex',
                'receiverID',
                exclusiveStartKey
            );
            items = recvResult.Items || [];
            newToken = recvResult.LastEvaluatedKey ? JSON.stringify(recvResult.LastEvaluatedKey) : undefined;
            
        } else { // role = 'all' -> merge both (Default behavior, no robust DDB pagination)
            const [sentResult, recvResult] = await Promise.all([
                queryByIndex('SenderIndex', 'senderID'),
                queryByIndex('ReceiverIndex', 'receiverID'),
            ]);

            const allItems = [...(sentResult.Items || []), ...(recvResult.Items || [])];

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

    // 1. Validate authorization (caller must be a participant)
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    // Authorization check must consider groups: callerID must be sender or receiver, OR the request must be a group request (implying participation).
    if (!favor || (!favor.teamID && favor.senderID !== callerID && favor.receiverID !== callerID)) {
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Unauthorized access to favor request history.' });
        return;
    }

    // 2. Query the MessagesTable (PK: favorRequestID, SK: timestamp)
    const queryInput = {
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'favorRequestID = :id',
        ExpressionAttributeValues: { ':id': favorRequestID },
        ScanIndexForward: true, // Chronological order (oldest first)
        Limit: limit,
        // Optional: Use ExclusiveStartKey for pagination (not fully implemented here, just lastTimestamp as anchor)
    };

    const historyResult = await ddb.send(new QueryCommand(queryInput));
    
    // 3. Send history back to the client
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
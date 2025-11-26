import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
// UPDATED: Use SES V2 client and command
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || ''; 
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';
const NOTIFICATIONS_TOPIC_ARN = process.env.NOTICES_TOPIC_ARN || '';
// Environment Variables for SES and Cognito (from comm-stack)
const SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || 'no-reply@todaysdentalinsights.com';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

// SDK Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sns = new SNSClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
// UPDATED: Initialize SES V2 Client
const ses = new SESv2Client({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

// ========================================
// TYPES
// ========================================

interface SenderInfo {
    connectionId: string;
    userID: string; // Cognito 'sub'
}

interface FavorRequest {
    favorRequestID: string;
    senderID: string;
    receiverID: string;
    status: 'active' | 'resolved';
    createdAt: string;
    updatedAt: string;
    userID: string; // Added for GSI 'UserIndex'
    
    // NEW: Fields for Feature Request
    requestType: 'General' | 'Assign Task' | 'Ask a Favor' | 'Other';
    unreadCount: number; // Count of unread messages for the user who is NOT the last sender
    initialMessage: string; 
    deadline?: string; // NEW: Optional deadline field (ISO String or similar format)
}

// NEW: Interface for storing rich file metadata
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
    fileKey?: string; // S3 file path if type is 'file'
    fileDetails?: FileDetails; // NEW: Detailed file metadata
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
            case 'fetchRequests': // NEW: Action to list favor requests
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
// CORE LOGIC FUNCTIONS
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
 * Handles the initiation of a new favor request.
 * Creates the favor record and sends the initial message.
 */
async function startFavorRequest(
    senderID: string,
    payload: any,
    senderConnectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    // UPDATED: Destructure requestType, initialMessage, receiverID AND deadline
    const { receiverID, initialMessage, requestType, deadline } = payload;
    
    if (!receiverID || !initialMessage || !requestType) {
        await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Missing receiverID, initialMessage, or requestType.' });
        return;
    }

    // CRITICAL FIX: Prevent a user from starting a request with themselves
    if (senderID === receiverID) {
        console.error(`Attempted self-request: Sender ID ${senderID} equals Receiver ID ${receiverID}`);
        await sendToClient(apiGwManagement, senderConnectionId, { 
            type: 'error', 
            message: 'A favor request cannot be started with yourself. Please select another user.' 
        });
        return;
    }

    const favorRequestID = uuidv4();
    const timestamp = Date.now();
    const nowIso = new Date().toISOString();

    const newFavor: FavorRequest = {
        favorRequestID,
        senderID,
        receiverID,
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
        userID: senderID, 
        // NEW: Initialize Request Type and Unread Count
        requestType,
        unreadCount: 1, // The initial message is unread by the receiver
        initialMessage: initialMessage, 
        // NEW: Save deadline if provided
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
    await _saveAndBroadcastMessage(messageData, apiGwManagement);
    
    // 4. Send email notification (NEW STEP)
    try {
        // This is the core logic that triggers the email notification
        await sendNewFavorNotificationEmail(senderID, receiverID, initialMessage, requestType, deadline);
    } catch(e) {
        // Log the failure but do not throw, as chat functionality is primary
        console.error("Failed to send SES notification email:", e);
    }
    
    // 5. Send confirmation back to the sender
    await sendToClient(apiGwManagement, senderConnectionId, { 
        type: 'favorRequestStarted', 
        favorRequestID, 
        receiverID,
        initialMessage,
        requestType, // Include new field in confirmation
        deadline, // Include new deadline field in confirmation
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
    // UPDATED: Destructure fileDetails from payload
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

    if (!favor || favor.status !== 'active' || (favor.senderID !== senderID && favor.receiverID !== senderID)) {
        if (senderConnectionId) {
            await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Request is inactive, resolved, or unauthorized.' });
        }
        return;
    }

    // Determine the ID of the person who is NOT the current sender 
    const recipientID = favor.senderID === senderID ? favor.receiverID : favor.senderID;
    
    // 2. Update the favor's last update time AND increment the unread counter for the recipient
    const updateResult = await ddb.send(new UpdateCommand({ 
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        // CRITICAL FIX: Removed senderID update. The original senderID and receiverID must be immutable for GSI integrity.
        UpdateExpression: 'SET updatedAt = :ua ADD unreadCount :incr', 
        ExpressionAttributeValues: { 
            ':ua': new Date().toISOString(),
            ':incr': 1 // Increment unread count by 1
        },
        ReturnValues: 'ALL_NEW', // <-- FIX: Retrieve the updated item for broadcast
    }));
    
    // FIX: Broadcast the updated favor object to both parties
    const updatedFavor = updateResult.Attributes as FavorRequest;
    const broadcastUpdatePayload = {
        type: 'favorRequestUpdated',
        favor: updatedFavor,
    };
    await sendToAll(apiGwManagement, [senderID, recipientID], broadcastUpdatePayload);

    // CRITICAL FIX: Sanitize the fileKey before storing it in the database.
    // This ensures that if the client accidentally sends the full signed upload URL,
    // only the clean S3 path remains for later download reference.
    const cleanFileKey = fileKey ? sanitizeFileKey(fileKey) : undefined;

    // 3. Create message data
    const messageData: MessageData = {
        favorRequestID,
        senderID,
        content: content || '',
        timestamp,
        type: cleanFileKey ? 'file' : 'text',
        fileKey: cleanFileKey, // <-- USE SANITIZED KEY HERE
        fileDetails: fileDetails, // NEW: Include file metadata
    };

    // 4. Save message and broadcast (sends 'newMessage' payload)
    await _saveAndBroadcastMessage(messageData, apiGwManagement);
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
            ConditionExpression: 'senderID = :caller OR receiverID = :caller',
            ReturnValues: 'ALL_NEW', // FIX: Retrieve the updated item for broadcast
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
            // Condition: Only sender or receiver can resolve, and it must be active.
            ConditionExpression: '#s = :active AND (senderID = :sender OR receiverID = :sender)',
            ReturnValues: 'ALL_NEW',
        }));

        const favor = updateResult.Attributes as FavorRequest;
        const recipientID = favor.senderID === senderID ? favor.receiverID : favor.senderID;

        // 2. Broadcast status update to both parties
        const broadcastPayload = {
            type: 'requestResolved',
            favorRequestID,
            resolvedBy: senderID,
            updatedAt: nowIso
        };
        
        await sendToAll(apiGwManagement, [senderID, recipientID], broadcastPayload);
        
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
 */
async function fetchRequests(
    callerID: string,
    payload: any,
    connectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    // role can be 'sent', 'received', or 'all'
    const { role = 'all', limit = 50, nextToken } = payload;
    
    // NOTE: Limit is applied in the DDB Query, max 100 on client side for 'all' merge.
    const queryLimit = Math.min(limit, 100);

    let exclusiveStartKey: any = undefined;
    if (nextToken) {
        try {
            // nextToken is expected to be a JSON string of DynamoDB's LastEvaluatedKey
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
 * Saves the message to DynamoDB and attempts to broadcast it to the connected recipient.
 * If the recipient is offline, a push notification is triggered via SNS.
 */
async function _saveAndBroadcastMessage(messageData: MessageData, apiGwManagement: ApiGatewayManagementApiClient): Promise<void> {
    // 1. Persist the message
    await ddb.send(new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: messageData,
    }));
    
    // 2. Find the request details to identify the recipient
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: messageData.favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;
    if (!favor) return;

    // Identify the recipient
    const recipientID = favor.senderID === messageData.senderID ? favor.receiverID : favor.senderID;

    // 3. Attempt real-time delivery
    const recipientConnectionInfo = await getSenderInfoByUserID(recipientID);
    
    const broadcastPayload = {
        type: 'newMessage',
        message: messageData,
    };
    
    if (recipientConnectionInfo) {
        // Recipient is online, send via WebSocket
        await sendToClient(apiGwManagement, recipientConnectionInfo.connectionId, broadcastPayload);
    } else {
        // Recipient is offline, trigger push notification
        await publishSnsNotification(messageData);
    }
    
    // Also echo back to sender to confirm receipt/persistence
    const senderConnectionInfo = await getSenderInfoByUserID(messageData.senderID);
    if (senderConnectionInfo) {
         await sendToClient(apiGwManagement, senderConnectionInfo.connectionId, broadcastPayload);
    }
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

    if (!favor || (favor.senderID !== callerID && favor.receiverID !== callerID)) {
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
async function sendToAll(apiGwManagement: ApiGatewayManagementApiClient, userIDs: string[], data: any): Promise<void> {
    const connectionPromises = userIDs.map(id => getSenderInfoByUserID(id));
    const connections = await Promise.all(connectionPromises);
    
    for (const conn of connections) {
        if (conn) {
            await sendToClient(apiGwManagement, conn.connectionId, data);
        }
    }
}

/** Publishes a push notification to the SNS topic. */
async function publishSnsNotification(messageData: any): Promise<void> {
    if (!NOTIFICATIONS_TOPIC_ARN) {
        console.warn('SNS Topic ARN not configured. Skipping notification.');
        return;
    }
    await sns.send(new PublishCommand({
        TopicArn: NOTIFICATIONS_TOPIC_ARN,
        Message: JSON.stringify({
            // Structure payload for push notification consumption
            source: 'favor_request',
            favorRequestID: messageData.favorRequestID,
            senderID: messageData.senderID,
            messagePreview: messageData.content.substring(0, 100),
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
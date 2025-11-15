import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || '';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || '';
const NOTIFICATIONS_TOPIC_ARN = process.env.NOTICES_TOPIC_ARN || '';

// SDK Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sns = new SNSClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

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
}

interface MessageData {
    favorRequestID: string;
    senderID: string;
    content: string;
    timestamp: number;
    type: 'text' | 'file';
    fileKey?: string; // S3 file path if type is 'file'
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
 * Handles the initiation of a new favor request.
 * Creates the favor record and sends the initial message.
 */
async function startFavorRequest(
    senderID: string,
    payload: any,
    senderConnectionId: string,
    apiGwManagement: ApiGatewayManagementApiClient
): Promise<void> {
    const { receiverID, initialMessage } = payload;
    if (!receiverID || !initialMessage) {
        await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Missing receiverID or initialMessage.' });
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
    
    // 4. Send confirmation back to the sender
    await sendToClient(apiGwManagement, senderConnectionId, { 
        type: 'favorRequestStarted', 
        favorRequestID, 
        receiverID,
        initialMessage 
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
    const { favorRequestID, content, fileKey } = payload;
    const senderConnectionId = (await getSenderInfoByUserID(senderID))?.connectionId;

    if (!favorRequestID || (!content && !fileKey)) {
        if (senderConnectionId) {
             await sendToClient(apiGwManagement, senderConnectionId, { type: 'error', message: 'Missing favorRequestID or message content/file key.' });
        }
        return;
    }
    
    const timestamp = Date.now();

    // 1. Validate and Update Favor Request (optimistic locking/status check)
    // This fetches the request and verifies the sender is part of it.
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
    
    // 2. Update the favor's last update time to surface it in the UI list
    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: 'SET updatedAt = :ua',
        ExpressionAttributeValues: { ':ua': new Date().toISOString() },
        ReturnValues: 'NONE',
    }));
    
    // 3. Create message data
    const messageData: MessageData = {
        favorRequestID,
        senderID,
        content: content || '',
        timestamp,
        type: fileKey ? 'file' : 'text',
        fileKey: fileKey,
    };

    // 4. Save message and broadcast
    await _saveAndBroadcastMessage(messageData, apiGwManagement);
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
            UpdateExpression: 'SET #s = :resolved, updatedAt = :ua',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':resolved': 'resolved',
                ':ua': nowIso,
                ':sender': senderID,
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
 * **NEW:** Handles fetching message history for a specific favor request.
 */
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

/** Handles the file sharing request by generating a signed S3 PUT URL. */
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
        });
    } catch (e) {
        console.error('Error generating signed URL:', e);
        await sendToClient(apiGwManagement, connectionId, { type: 'error', message: 'Failed to generate file upload URL' });
    }
}
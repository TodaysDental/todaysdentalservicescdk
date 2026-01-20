import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './audit-service';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const TEAMS_TABLE = process.env.TEAMS_TABLE || '';
const MEETINGS_TABLE = process.env.MEETINGS_TABLE || '';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || '';

// Authorization Constants
const MAX_GROUP_MEMBERS = 100;

// System Modules (from shared/types/user.ts)
const SYSTEM_MODULES = ['HR', 'Accounting', 'Operations', 'Finance', 'Marketing', 'Legal', 'IT'] as const;
type SystemModule = typeof SYSTEM_MODULES[number];

// SDK Client
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// Types
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
    title?: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    category?: SystemModule;
    tags?: string[];
    forwardingChain?: ForwardRecord[];
    currentAssigneeID?: string;
    requiresAcceptance?: boolean;
    completedAt?: string;
    completionNotes?: string;
    rejectionReason?: string;
    rejectedAt?: string;
    createdAt: string;
    updatedAt: string;
    userID: string;
    requestType: 'General' | 'Assign Task' | 'Ask a Favor' | 'Other';
    unreadCount: number;
    initialMessage: string;
    deadline?: string;
}

interface Team {
    teamID: string;
    ownerID: string;
    name: string;
    description?: string;
    members: string[];
    category?: SystemModule;
    createdAt: string;
    updatedAt: string;
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
    createdAt: string;
    updatedAt: string;
}

// Helper functions
function response(statusCode: number, body: any): APIGatewayProxyResult {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        body: JSON.stringify(body),
    };
}

function getUserIdFromEvent(event: APIGatewayProxyEvent): string | null {
    // Extract user ID from JWT claims (set by authorizer)
    const claims = event.requestContext.authorizer?.claims;
    return claims?.sub || claims?.['cognito:username'] || null;
}

// ========================================
// MAIN HANDLER
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path, pathParameters, queryStringParameters, body } = event;
    const userID = getUserIdFromEvent(event);

    if (!userID) {
        return response(401, { success: false, message: 'Unauthorized' });
    }

    try {
        const parsedBody = body ? JSON.parse(body) : {};

        // Route based on path and method
        // Conversations endpoints
        if (path.match(/^\/api\/conversations\/search$/)) {
            return await searchConversations(userID, queryStringParameters);
        }
        if (path.match(/^\/api\/conversations\/profiles$/)) {
            return await getConversationProfiles(userID, queryStringParameters);
        }
        if (path.match(/^\/api\/conversations\/[^/]+\/complete$/)) {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            return await getConversationComplete(userID, favorRequestID);
        }
        if (path.match(/^\/api\/conversations\/[^/]+\/user-details$/)) {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            return await getConversationUserDetails(userID, favorRequestID);
        }
        if (path.match(/^\/api\/conversations\/[^/]+\/deadline$/) && httpMethod === 'PUT') {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            return await updateConversationDeadline(userID, favorRequestID, parsedBody);
        }
        if (path.match(/^\/api\/conversations\/[^/]+$/) && httpMethod === 'DELETE') {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            return await deleteConversation(userID, favorRequestID, queryStringParameters);
        }
        if (path.match(/^\/api\/conversations$/) && httpMethod === 'GET') {
            return await getConversations(userID, queryStringParameters);
        }

        // Tasks endpoints
        if (path.match(/^\/api\/tasks\/by-status$/) && httpMethod === 'GET') {
            return await getTasksByStatus(userID, queryStringParameters);
        }
        if (path.match(/^\/api\/tasks\/forward-history$/) && httpMethod === 'GET') {
            return await getForwardHistory(userID, queryStringParameters);
        }
        if (path.match(/^\/api\/tasks\/forwarded-to-me$/) && httpMethod === 'GET') {
            return await getForwardedToMe(userID, queryStringParameters);
        }
        if (path.match(/^\/api\/tasks\/group$/) && httpMethod === 'POST') {
            return await createGroupTask(userID, parsedBody);
        }
        if (path.match(/^\/api\/tasks\/[^/]+\/forward\/[^/]+\/respond$/) && httpMethod === 'POST') {
            const parts = path.split('/');
            const taskID = parts[3];
            const forwardID = parts[5];
            return await respondToForward(userID, taskID, forwardID, parsedBody);
        }
        if (path.match(/^\/api\/tasks\/[^/]+\/forward$/) && httpMethod === 'POST') {
            const taskID = pathParameters?.taskID || path.split('/')[3];
            return await forwardTask(userID, taskID, parsedBody);
        }
        if (path.match(/^\/api\/tasks\/[^/]+\/deadline$/) && httpMethod === 'PUT') {
            const taskID = pathParameters?.taskID || path.split('/')[3];
            return await updateTaskDeadline(userID, taskID, parsedBody);
        }
        if (path.match(/^\/api\/tasks$/) && httpMethod === 'POST') {
            return await createTask(userID, parsedBody);
        }

        // Meetings endpoints
        if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === 'PUT') {
            const meetingID = pathParameters?.meetingID || path.split('/')[3];
            return await updateMeeting(userID, meetingID, parsedBody);
        }
        if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === 'DELETE') {
            const meetingID = pathParameters?.meetingID || path.split('/')[3];
            return await deleteMeeting(userID, meetingID, queryStringParameters);
        }
        if (path.match(/^\/api\/meetings$/) && httpMethod === 'POST') {
            return await createMeeting(userID, parsedBody);
        }
        if (path.match(/^\/api\/meetings$/) && httpMethod === 'GET') {
            return await getMeetings(userID, queryStringParameters);
        }

        // Groups endpoints
        if (path.match(/^\/api\/groups\/[^/]+\/members\/[^/]+$/) && httpMethod === 'DELETE') {
            const parts = path.split('/');
            const teamID = parts[3];
            const memberUserID = parts[5];
            return await removeGroupMember(userID, teamID, memberUserID);
        }
        if (path.match(/^\/api\/groups\/[^/]+\/members$/) && httpMethod === 'POST') {
            const teamID = pathParameters?.teamID || path.split('/')[3];
            return await addGroupMember(userID, teamID, parsedBody);
        }
        if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === 'GET') {
            const teamID = pathParameters?.teamID || path.split('/')[3];
            return await getGroupDetails(userID, teamID);
        }
        if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === 'PUT') {
            const teamID = pathParameters?.teamID || path.split('/')[3];
            return await updateGroup(userID, teamID, parsedBody);
        }
        if (path.match(/^\/api\/groups$/) && httpMethod === 'POST') {
            return await createGroup(userID, parsedBody);
        }
        if (path.match(/^\/api\/groups$/) && httpMethod === 'GET') {
            return await getGroups(userID, queryStringParameters);
        }

        return response(404, { success: false, message: 'Endpoint not found' });

    } catch (error) {
        console.error('Error processing request:', error);
        return response(500, { success: false, message: 'Internal server error' });
    }
};

// ========================================
// CONVERSATIONS ENDPOINTS
// ========================================

async function searchConversations(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { query, status, type, sort = 'newest', deadline, category, priority, limit = 20, offset = 0 } = params || {};

    // Query by sender and receiver indexes, merge results
    const [sentResult, recvResult] = await Promise.all([
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'SenderIndex',
            KeyConditionExpression: 'senderID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'ReceiverIndex',
            KeyConditionExpression: 'receiverID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
    ]);

    let conversations = [...(sentResult.Items || []), ...(recvResult.Items || [])] as FavorRequest[];
    
    // Deduplicate
    const byId = new Map<string, FavorRequest>();
    for (const conv of conversations) {
        byId.set(conv.favorRequestID, conv);
    }
    conversations = Array.from(byId.values());

    // Filter
    if (query) {
        const q = query.toLowerCase();
        conversations = conversations.filter(c => 
            c.title?.toLowerCase().includes(q) || 
            c.initialMessage?.toLowerCase().includes(q) ||
            c.description?.toLowerCase().includes(q)
        );
    }
    if (status) conversations = conversations.filter(c => c.status === status);
    if (type) conversations = conversations.filter(c => c.requestType === type);
    if (category) conversations = conversations.filter(c => c.category === category);
    if (priority) conversations = conversations.filter(c => c.priority === priority);

    // Sort
    if (sort === 'newest') {
        conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } else if (sort === 'oldest') {
        conversations.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    } else if (sort === 'deadline') {
        conversations.sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));
    }

    // Paginate
    const total = conversations.length;
    const paginatedConversations = conversations.slice(Number(offset), Number(offset) + Number(limit));

    return response(200, {
        success: true,
        conversations: paginatedConversations,
        total,
        hasMore: Number(offset) + paginatedConversations.length < total,
    });
}

async function getConversationProfiles(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { tab = 'single', status, limit = 50, offset = 0 } = params || {};

    const indexName = tab === 'group' ? 'TeamIndex' : 'SenderIndex';
    
    // For single conversations, query both sender and receiver
    const [sentResult, recvResult] = await Promise.all([
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'SenderIndex',
            KeyConditionExpression: 'senderID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'ReceiverIndex',
            KeyConditionExpression: 'receiverID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
    ]);

    let items = [...(sentResult.Items || []), ...(recvResult.Items || [])] as FavorRequest[];
    
    // Deduplicate and filter by tab type
    const byId = new Map<string, FavorRequest>();
    for (const item of items) {
        if (tab === 'single' && !item.teamID) {
            byId.set(item.favorRequestID, item);
        } else if (tab === 'group' && item.teamID) {
            byId.set(item.favorRequestID, item);
        }
    }
    items = Array.from(byId.values());

    // Filter by status
    if (status) {
        items = items.filter(i => i.status === status);
    }

    // Sort by updatedAt desc
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // Paginate
    const total = items.length;
    const profiles = items.slice(Number(offset), Number(offset) + Number(limit)).map(item => ({
        favorRequestID: item.favorRequestID,
        conversationType: item.teamID ? 'group' : 'single',
        name: item.title || item.initialMessage?.substring(0, 50),
        taskCount: 1,
        lastMessageTime: item.updatedAt,
        lastMessagePreview: item.initialMessage?.substring(0, 100),
        unreadCount: item.unreadCount,
        nearestDeadline: item.deadline,
        category: item.category,
        priority: item.priority,
        status: item.status,
    }));

    return response(200, {
        success: true,
        profiles,
        total,
        hasMore: Number(offset) + profiles.length < total,
    });
}

async function getConversationComplete(userID: string, favorRequestID: string): Promise<APIGatewayProxyResult> {
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        return response(404, { success: false, message: 'Conversation not found' });
    }

    // Verify user is participant
    if (favor.senderID !== userID && favor.receiverID !== userID && favor.currentAssigneeID !== userID) {
        // Check team membership if group
        if (favor.teamID && TEAMS_TABLE) {
            const teamResult = await ddb.send(new GetCommand({
                TableName: TEAMS_TABLE,
                Key: { teamID: favor.teamID },
            }));
            const team = teamResult.Item as Team;
            if (!team?.members.includes(userID)) {
                return response(403, { success: false, message: 'Unauthorized' });
            }
        } else {
            return response(403, { success: false, message: 'Unauthorized' });
        }
    }

    // Get messages
    const messagesResult = await ddb.send(new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'favorRequestID = :id',
        ExpressionAttributeValues: { ':id': favorRequestID },
        ScanIndexForward: true,
    }));

    return response(200, {
        success: true,
        conversation: favor,
        participants: [favor.senderID, favor.receiverID, favor.currentAssigneeID].filter(Boolean),
        tasks: [favor], // Each favor is a task
        files: (messagesResult.Items || []).filter((m: any) => m.type === 'file'),
        statistics: {
            totalMessages: messagesResult.Items?.length || 0,
            totalFiles: (messagesResult.Items || []).filter((m: any) => m.type === 'file').length,
        },
    });
}

async function getConversationUserDetails(userID: string, favorRequestID: string): Promise<APIGatewayProxyResult> {
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        return response(404, { success: false, message: 'Conversation not found' });
    }

    return response(200, {
        success: true,
        conversation: {
            favorRequestID: favor.favorRequestID,
            conversationType: favor.teamID ? 'group' : 'single',
            status: favor.status,
            requestType: favor.requestType,
            category: favor.category,
            priority: favor.priority,
            createdAt: favor.createdAt,
            updatedAt: favor.updatedAt,
        },
        participants: [
            { userID: favor.senderID, role: 'creator' },
            ...(favor.receiverID ? [{ userID: favor.receiverID, role: 'receiver' }] : []),
        ],
        creator: { userID: favor.senderID },
    });
}

async function updateConversationDeadline(userID: string, favorRequestID: string, body: any): Promise<APIGatewayProxyResult> {
    const { deadline } = body;
    const nowIso = new Date().toISOString();

    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: deadline ? 'SET deadline = :d, updatedAt = :ua' : 'REMOVE deadline SET updatedAt = :ua',
        ExpressionAttributeValues: deadline ? { ':d': deadline, ':ua': nowIso } : { ':ua': nowIso },
    }));

    return response(200, {
        success: true,
        message: 'Deadline updated successfully',
        conversation: { favorRequestID, deadline, updatedAt: nowIso },
    });
}

async function deleteConversation(userID: string, favorRequestID: string, params: any): Promise<APIGatewayProxyResult> {
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor || favor.senderID !== userID) {
        return response(403, { success: false, message: 'Unauthorized: Only the creator can delete' });
    }

    // Soft delete
    const nowIso = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: 'SET #s = :status, updatedAt = :ua',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'deleted', ':ua': nowIso },
    }));

    return response(200, {
        success: true,
        message: 'Conversation deleted successfully',
        deleted: { conversationID: favorRequestID },
    });
}

async function getConversations(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { tab, status, category, limit = 20, offset = 0 } = params || {};

    const [sentResult, recvResult] = await Promise.all([
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'SenderIndex',
            KeyConditionExpression: 'senderID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'ReceiverIndex',
            KeyConditionExpression: 'receiverID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
    ]);

    let conversations = [...(sentResult.Items || []), ...(recvResult.Items || [])] as FavorRequest[];
    
    // Deduplicate
    const byId = new Map<string, FavorRequest>();
    for (const conv of conversations) {
        byId.set(conv.favorRequestID, conv);
    }
    conversations = Array.from(byId.values());

    // Filter
    if (tab === 'single') conversations = conversations.filter(c => !c.teamID);
    if (tab === 'group') conversations = conversations.filter(c => !!c.teamID);
    if (status) conversations = conversations.filter(c => c.status === status);
    if (category) conversations = conversations.filter(c => c.category === category);

    // Sort
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // Paginate
    const total = conversations.length;
    const paginatedConversations = conversations.slice(Number(offset), Number(offset) + Number(limit));

    return response(200, {
        success: true,
        conversations: paginatedConversations,
        total,
        hasMore: Number(offset) + paginatedConversations.length < total,
    });
}

// ========================================
// TASKS ENDPOINTS
// ========================================

async function getTasksByStatus(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { status, conversationID, assignedTo, category, priority, limit = 20, offset = 0 } = params || {};

    let items: FavorRequest[] = [];

    if (status) {
        const result = await ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: '#s = :status',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':status': status },
            ScanIndexForward: false,
        }));
        items = (result.Items || []) as FavorRequest[];
    } else {
        // Get all for user
        const [sentResult, recvResult] = await Promise.all([
            ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'SenderIndex',
                KeyConditionExpression: 'senderID = :uid',
                ExpressionAttributeValues: { ':uid': userID },
            })),
            ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'ReceiverIndex',
                KeyConditionExpression: 'receiverID = :uid',
                ExpressionAttributeValues: { ':uid': userID },
            })),
        ]);
        items = [...(sentResult.Items || []), ...(recvResult.Items || [])] as FavorRequest[];
    }

    // Deduplicate
    const byId = new Map<string, FavorRequest>();
    for (const item of items) {
        // Filter to only user's tasks
        if (item.senderID === userID || item.receiverID === userID || item.currentAssigneeID === userID) {
            byId.set(item.favorRequestID, item);
        }
    }
    items = Array.from(byId.values());

    // Additional filters
    if (category) items = items.filter(i => i.category === category);
    if (priority) items = items.filter(i => i.priority === priority);

    // Statistics
    const stats = {
        totalTasks: items.length,
        byPriority: {
            Low: items.filter(i => i.priority === 'Low').length,
            Medium: items.filter(i => i.priority === 'Medium').length,
            High: items.filter(i => i.priority === 'High').length,
            Urgent: items.filter(i => i.priority === 'Urgent').length,
        },
        byCategory: {} as Record<string, number>,
    };

    SYSTEM_MODULES.forEach(m => {
        stats.byCategory[m] = items.filter(i => i.category === m).length;
    });

    // Paginate
    const total = items.length;
    const tasks = items.slice(Number(offset), Number(offset) + Number(limit));

    return response(200, {
        success: true,
        tasks,
        total,
        hasMore: Number(offset) + tasks.length < total,
        statistics: stats,
    });
}

async function getForwardHistory(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { conversationID, taskID, limit = 50, offset = 0 } = params || {};

    let items: FavorRequest[] = [];

    if (taskID || conversationID) {
        const result = await ddb.send(new GetCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID: taskID || conversationID },
        }));
        if (result.Item) items = [result.Item as FavorRequest];
    } else {
        // Get all user's tasks with forwarding chains
        const [sentResult, recvResult] = await Promise.all([
            ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'SenderIndex',
                KeyConditionExpression: 'senderID = :uid',
                ExpressionAttributeValues: { ':uid': userID },
            })),
            ddb.send(new QueryCommand({
                TableName: FAVORS_TABLE,
                IndexName: 'ReceiverIndex',
                KeyConditionExpression: 'receiverID = :uid',
                ExpressionAttributeValues: { ':uid': userID },
            })),
        ]);
        const all = [...(sentResult.Items || []), ...(recvResult.Items || [])] as FavorRequest[];
        items = all.filter(i => i.forwardingChain && i.forwardingChain.length > 0);
    }

    // Extract forward history
    const forwardHistory = items.flatMap(item => 
        (item.forwardingChain || []).map(f => ({
            ...f,
            taskID: item.favorRequestID,
            taskTitle: item.title,
            conversationID: item.favorRequestID,
        }))
    );

    // Sort by forwardedAt desc
    forwardHistory.sort((a, b) => b.forwardedAt.localeCompare(a.forwardedAt));

    // Paginate
    const total = forwardHistory.length;
    const paginated = forwardHistory.slice(Number(offset), Number(offset) + Number(limit));

    return response(200, {
        success: true,
        forwardHistory: paginated,
        total,
        hasMore: Number(offset) + paginated.length < total,
    });
}

async function getForwardedToMe(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { status, limit = 20, offset = 0 } = params || {};

    // Query by current assignee
    const result = await ddb.send(new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: 'CurrentAssigneeIndex',
        KeyConditionExpression: 'currentAssigneeID = :uid',
        ExpressionAttributeValues: { ':uid': userID },
        ScanIndexForward: false,
    }));

    let items = (result.Items || []) as FavorRequest[];

    // Filter to only forwarded tasks
    items = items.filter(i => i.forwardingChain && i.forwardingChain.length > 0);

    // Filter by forward status if provided
    if (status) {
        items = items.filter(i => {
            const lastForward = i.forwardingChain?.[i.forwardingChain.length - 1];
            return lastForward?.status === status;
        });
    }

    // Map to forwarded task format
    const forwardedTasks = items.map(i => {
        const lastForward = i.forwardingChain?.[i.forwardingChain.length - 1];
        return {
            forwardID: lastForward?.forwardID,
            taskID: i.favorRequestID,
            taskTitle: i.title,
            taskDescription: i.description,
            conversationID: i.favorRequestID,
            fromUser: { userID: lastForward?.fromUserID },
            forwardedAt: lastForward?.forwardedAt,
            message: lastForward?.message,
            deadline: i.deadline,
            requireAcceptance: lastForward?.requireAcceptance,
            status: lastForward?.status,
            priority: i.priority,
            category: i.category,
        };
    });

    // Paginate
    const total = forwardedTasks.length;
    const paginated = forwardedTasks.slice(Number(offset), Number(offset) + Number(limit));

    return response(200, {
        success: true,
        forwardedTasks: paginated,
        total,
        hasMore: Number(offset) + paginated.length < total,
    });
}

async function forwardTask(userID: string, taskID: string, body: any): Promise<APIGatewayProxyResult> {
    const { forwardTo, message, deadline, requireAcceptance = false, notifyOriginalAssignee = true } = body;

    if (!forwardTo) {
        return response(400, { success: false, message: 'forwardTo is required' });
    }

    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        return response(404, { success: false, message: 'Task not found' });
    }

    const forwardID = uuidv4();
    const nowIso = new Date().toISOString();
    const forwardRecord: ForwardRecord = {
        forwardID,
        fromUserID: userID,
        toUserID: forwardTo,
        forwardedAt: nowIso,
        message,
        deadline: deadline || favor.deadline,
        requireAcceptance,
        status: requireAcceptance ? 'pending' : 'accepted',
        ...(requireAcceptance ? {} : { acceptedAt: nowIso }),
    };

    const existingChain = favor.forwardingChain || [];
    const updatedChain = [...existingChain, forwardRecord];

    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
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

    return response(200, {
        success: true,
        forwardID,
        message: 'Task forwarded successfully',
        forwardingRecord: forwardRecord,
    });
}

async function respondToForward(userID: string, taskID: string, forwardID: string, body: any): Promise<APIGatewayProxyResult> {
    const { action, rejectionReason } = body;

    if (!action || !['accept', 'reject'].includes(action)) {
        return response(400, { success: false, message: 'action must be accept or reject' });
    }

    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
    }));
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        return response(404, { success: false, message: 'Task not found' });
    }

    const forwardingChain = favor.forwardingChain || [];
    const forwardIndex = forwardingChain.findIndex(f => f.forwardID === forwardID);

    if (forwardIndex === -1) {
        return response(404, { success: false, message: 'Forward record not found' });
    }

    const forwardRecord = forwardingChain[forwardIndex];
    if (forwardRecord.toUserID !== userID) {
        return response(403, { success: false, message: 'This forward is not assigned to you' });
    }

    const nowIso = new Date().toISOString();
    forwardingChain[forwardIndex] = {
        ...forwardRecord,
        status: action === 'accept' ? 'accepted' : 'rejected',
        ...(action === 'accept' ? { acceptedAt: nowIso } : { rejectedAt: nowIso, rejectionReason }),
    };

    let newStatus: TaskStatus = favor.status;
    let newAssignee = favor.currentAssigneeID;

    if (action === 'accept') {
        newStatus = 'active';
    } else {
        newStatus = 'pending';
        newAssignee = forwardRecord.fromUserID;
    }

    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
        UpdateExpression: 'SET forwardingChain = :chain, #s = :status, currentAssigneeID = :assignee, updatedAt = :ua',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
            ':chain': forwardingChain,
            ':status': newStatus,
            ':assignee': newAssignee,
            ':ua': nowIso,
        },
    }));

    return response(200, {
        success: true,
        message: 'Task response recorded successfully',
        forwardingRecord: forwardingChain[forwardIndex],
    });
}

async function updateTaskDeadline(userID: string, taskID: string, body: any): Promise<APIGatewayProxyResult> {
    const { deadline } = body;
    const nowIso = new Date().toISOString();

    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
        UpdateExpression: deadline ? 'SET deadline = :d, updatedAt = :ua' : 'REMOVE deadline SET updatedAt = :ua',
        ExpressionAttributeValues: deadline ? { ':d': deadline, ':ua': nowIso } : { ':ua': nowIso },
    }));

    return response(200, {
        success: true,
        message: 'Task deadline updated successfully',
        task: { taskID, deadline, updatedAt: nowIso },
    });
}

async function createTask(userID: string, body: any): Promise<APIGatewayProxyResult> {
    const { conversationID, receiverID, title, description, priority = 'Medium', category, deadline, requiresAcceptance = false } = body;

    if (!receiverID || !title) {
        return response(400, { success: false, message: 'receiverID and title are required' });
    }

    const favorRequestID = conversationID || uuidv4();
    const nowIso = new Date().toISOString();

    const newTask: FavorRequest = {
        favorRequestID,
        senderID: userID,
        receiverID,
        title,
        description: description || title,
        status: 'pending',
        priority: priority as TaskPriority,
        ...(category && { category: category as SystemModule }),
        currentAssigneeID: receiverID,
        requiresAcceptance,
        createdAt: nowIso,
        updatedAt: nowIso,
        userID,
        requestType: 'Assign Task',
        unreadCount: 1,
        initialMessage: description || title,
        ...(deadline && { deadline }),
    };

    await ddb.send(new PutCommand({
        TableName: FAVORS_TABLE,
        Item: newTask,
    }));

    return response(201, {
        success: true,
        taskID: favorRequestID,
        conversationID: favorRequestID,
        message: 'Task created successfully',
        task: newTask,
    });
}

async function createGroupTask(userID: string, body: any): Promise<APIGatewayProxyResult> {
    const { conversationID, teamID, title, description, assignedTo, priority = 'Medium', category, deadline, requiresAcceptance = false } = body;

    if (!teamID || !title) {
        return response(400, { success: false, message: 'teamID and title are required' });
    }

    const favorRequestID = conversationID || uuidv4();
    const nowIso = new Date().toISOString();

    const newTask: FavorRequest = {
        favorRequestID,
        senderID: userID,
        teamID,
        title,
        description: description || title,
        status: 'pending',
        priority: priority as TaskPriority,
        ...(category && { category: category as SystemModule }),
        ...(assignedTo && { currentAssigneeID: assignedTo }),
        requiresAcceptance,
        createdAt: nowIso,
        updatedAt: nowIso,
        userID,
        requestType: 'Assign Task',
        unreadCount: 1,
        initialMessage: description || title,
        ...(deadline && { deadline }),
    };

    await ddb.send(new PutCommand({
        TableName: FAVORS_TABLE,
        Item: newTask,
    }));

    return response(201, {
        success: true,
        taskID: favorRequestID,
        conversationID: favorRequestID,
        message: 'Group task created successfully',
        task: newTask,
    });
}

// ========================================
// MEETINGS ENDPOINTS
// ========================================

async function createMeeting(userID: string, body: any): Promise<APIGatewayProxyResult> {
    const { conversationID, title, description, startTime, endTime, location, meetingLink, participants, reminder } = body;

    if (!conversationID || !description || !meetingLink) {
        return response(400, { success: false, message: 'conversationID, description, and meetingLink are required' });
    }

    const meetingID = uuidv4();
    const nowIso = new Date().toISOString();

    const meeting: Meeting = {
        meetingID,
        conversationID,
        title: title || description.substring(0, 50),
        description,
        startTime: startTime || nowIso,
        endTime,
        location,
        meetingLink,
        organizerID: userID,
        participants: participants || [],
        status: 'scheduled',
        createdAt: nowIso,
        updatedAt: nowIso,
    };

    await ddb.send(new PutCommand({
        TableName: MEETINGS_TABLE,
        Item: meeting,
    }));

    return response(201, {
        success: true,
        meetingID,
        message: 'Meeting scheduled successfully',
        meeting,
    });
}

async function getMeetings(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { conversationID, status, startDate, endDate, limit = 20, offset = 0 } = params || {};

    let meetings: Meeting[] = [];

    if (conversationID) {
        const result = await ddb.send(new QueryCommand({
            TableName: MEETINGS_TABLE,
            IndexName: 'ConversationIndex',
            KeyConditionExpression: 'conversationID = :cid',
            ExpressionAttributeValues: { ':cid': conversationID },
            ScanIndexForward: false,
        }));
        meetings = (result.Items || []) as Meeting[];
    } else {
        const result = await ddb.send(new QueryCommand({
            TableName: MEETINGS_TABLE,
            IndexName: 'OrganizerIndex',
            KeyConditionExpression: 'organizerID = :oid',
            ExpressionAttributeValues: { ':oid': userID },
            ScanIndexForward: false,
        }));
        meetings = (result.Items || []) as Meeting[];
    }

    // Filter by status
    if (status) {
        meetings = meetings.filter(m => m.status === status);
    }

    // Filter by date range
    if (startDate) {
        meetings = meetings.filter(m => m.startTime >= startDate);
    }
    if (endDate) {
        meetings = meetings.filter(m => m.startTime <= endDate);
    }

    // Paginate
    const total = meetings.length;
    const paginated = meetings.slice(Number(offset), Number(offset) + Number(limit));

    return response(200, {
        success: true,
        meetings: paginated,
        total,
        hasMore: Number(offset) + paginated.length < total,
    });
}

async function updateMeeting(userID: string, meetingID: string, body: any): Promise<APIGatewayProxyResult> {
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    const meeting = meetingResult.Item as Meeting;

    if (!meeting) {
        return response(404, { success: false, message: 'Meeting not found' });
    }

    if (meeting.organizerID !== userID) {
        return response(403, { success: false, message: 'Only the organizer can update this meeting' });
    }

    const nowIso = new Date().toISOString();
    const { title, description, startTime, endTime, location, meetingLink, participants, status } = body;

    const updateExpressions: string[] = ['updatedAt = :ua'];
    const expressionValues: Record<string, any> = { ':ua': nowIso };
    const expressionNames: Record<string, string> = {};

    if (title !== undefined) { updateExpressions.push('title = :title'); expressionValues[':title'] = title; }
    if (description !== undefined) { updateExpressions.push('description = :desc'); expressionValues[':desc'] = description; }
    if (startTime !== undefined) { updateExpressions.push('startTime = :start'); expressionValues[':start'] = startTime; }
    if (endTime !== undefined) { updateExpressions.push('endTime = :endT'); expressionValues[':endT'] = endTime; }
    if (location !== undefined) { updateExpressions.push('#loc = :loc'); expressionValues[':loc'] = location; expressionNames['#loc'] = 'location'; }
    if (meetingLink !== undefined) { updateExpressions.push('meetingLink = :link'); expressionValues[':link'] = meetingLink; }
    if (participants !== undefined) { updateExpressions.push('participants = :parts'); expressionValues[':parts'] = participants; }
    if (status !== undefined) { updateExpressions.push('#s = :status'); expressionValues[':status'] = status; expressionNames['#s'] = 'status'; }

    await ddb.send(new UpdateCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
        UpdateExpression: 'SET ' + updateExpressions.join(', '),
        ExpressionAttributeValues: expressionValues,
        ...(Object.keys(expressionNames).length > 0 ? { ExpressionAttributeNames: expressionNames } : {}),
    }));

    return response(200, {
        success: true,
        message: 'Meeting updated successfully',
        meeting: { meetingID, ...body, updatedAt: nowIso },
    });
}

async function deleteMeeting(userID: string, meetingID: string, params: any): Promise<APIGatewayProxyResult> {
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    const meeting = meetingResult.Item as Meeting;

    if (!meeting) {
        return response(404, { success: false, message: 'Meeting not found' });
    }

    if (meeting.organizerID !== userID) {
        return response(403, { success: false, message: 'Only the organizer can delete this meeting' });
    }

    // Soft delete by updating status
    const nowIso = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
        UpdateExpression: 'SET #s = :status, updatedAt = :ua',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'cancelled', ':ua': nowIso },
    }));

    return response(200, {
        success: true,
        message: 'Meeting deleted successfully',
        meetingID,
    });
}

// ========================================
// GROUPS ENDPOINTS
// ========================================

async function createGroup(userID: string, body: any): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();
    const { name, description, members, category, createConversation = true } = body;

    // ========================================
    // AUTHORIZATION: Input Validation
    // ========================================

    // Validate group name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: 'unknown',
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'failure',
            statusCode: 400,
            errorMessage: 'Group name is required and must be a non-empty string',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'Group name is required and must be a non-empty string' });
    }

    if (name.length > 255) {
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: 'unknown',
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'failure',
            statusCode: 400,
            errorMessage: 'Group name must be less than 255 characters',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'Group name must be less than 255 characters' });
    }

    // Validate members array
    if (!members || !Array.isArray(members) || members.length === 0) {
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: 'unknown',
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'failure',
            statusCode: 400,
            errorMessage: 'members must be a non-empty array of user IDs',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'members must be a non-empty array of user IDs' });
    }

    // Validate member IDs format
    for (const memberId of members) {
        if (typeof memberId !== 'string' || memberId.trim().length === 0) {
            AuditService.logAction({
                userID,
                action: 'CREATE_GROUP',
                resourceType: 'group',
                resourceID: 'unknown',
                httpMethod: 'POST',
                endpoint: '/api/groups',
                status: 'failure',
                statusCode: 400,
                errorMessage: 'All member IDs must be non-empty strings',
                durationMs: Date.now() - startTime,
            });
            return response(400, { success: false, message: 'All member IDs must be non-empty strings' });
        }
    }

    // Validate category if provided
    if (category && !SYSTEM_MODULES.includes(category)) {
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: 'unknown',
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'failure',
            statusCode: 400,
            errorMessage: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(', ')}`,
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(', ')}` });
    }

    // ========================================
    // AUTHORIZATION: Business Rules
    // ========================================

    // Ensure owner is in members and deduplicate
    const uniqueMembers = Array.from(new Set([...members, userID]));

    // Check member limit
    if (uniqueMembers.length > MAX_GROUP_MEMBERS) {
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: 'unknown',
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'failure',
            statusCode: 403,
            errorMessage: `Group cannot have more than ${MAX_GROUP_MEMBERS} members`,
            durationMs: Date.now() - startTime,
        });
        return response(403, { success: false, message: `Group cannot have more than ${MAX_GROUP_MEMBERS} members` });
    }

    // Ensure at least one other member
    if (uniqueMembers.length < 2) {
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: 'unknown',
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'failure',
            statusCode: 400,
            errorMessage: 'Group must have at least one other member',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'Group must have at least one other member' });
    }

    const teamID = uuidv4();
    const nowIso = new Date().toISOString();

    const team: Team = {
        teamID,
        ownerID: userID,
        name: name.trim(),
        description,
        members: uniqueMembers,
        ...(category && { category: category as SystemModule }),
        createdAt: nowIso,
        updatedAt: nowIso,
    };

    try {
        await ddb.send(new PutCommand({
            TableName: TEAMS_TABLE,
            Item: team,
        }));

        let conversationID: string | undefined;

        // Create initial conversation if requested
        if (createConversation) {
            conversationID = uuidv4();
            const conversation: FavorRequest = {
                favorRequestID: conversationID,
                senderID: userID,
                teamID,
                title: name.trim(),
                description: description || `Group conversation for ${name.trim()}`,
                status: 'active',
                priority: 'Medium',
                ...(category && { category: category as SystemModule }),
                createdAt: nowIso,
                updatedAt: nowIso,
                userID,
                requestType: 'General',
                unreadCount: 0,
                initialMessage: `Group ${name.trim()} created`,
            };

            await ddb.send(new PutCommand({
                TableName: FAVORS_TABLE,
                Item: conversation,
            }));
        }

        // Log successful group creation
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'success',
            statusCode: 201,
            changes: { after: { teamID, name: name.trim(), memberCount: uniqueMembers.length, category } },
            durationMs: Date.now() - startTime,
            metadata: { ownerID: userID, conversationID },
        });

        return response(201, {
            success: true,
            teamID,
            conversationID,
            message: 'Group created successfully',
            group: team,
        });
    } catch (error: any) {
        AuditService.logAction({
            userID,
            action: 'CREATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: '/api/groups',
            status: 'failure',
            statusCode: 500,
            errorMessage: error.message,
            durationMs: Date.now() - startTime,
        });
        throw error;
    }
}

async function getGroups(userID: string, params: any): Promise<APIGatewayProxyResult> {
    const { category, limit = 20, offset = 0 } = params || {};

    // Scan for teams where user is a member
    const result = await ddb.send(new ScanCommand({
        TableName: TEAMS_TABLE,
        FilterExpression: 'contains(members, :uid)',
        ExpressionAttributeValues: { ':uid': userID },
    }));

    let groups = (result.Items || []) as Team[];

    // Filter by category
    if (category) {
        groups = groups.filter(g => g.category === category);
    }

    // Sort by updatedAt desc
    groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // Paginate
    const total = groups.length;
    const paginated = groups.slice(Number(offset), Number(offset) + Number(limit));

    return response(200, {
        success: true,
        groups: paginated.map(g => ({
            teamID: g.teamID,
            name: g.name,
            description: g.description,
            ownerID: g.ownerID,
            memberCount: g.members.length,
            members: g.members,
            category: g.category,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
        })),
        total,
        hasMore: Number(offset) + paginated.length < total,
    });
}

async function getGroupDetails(userID: string, teamID: string): Promise<APIGatewayProxyResult> {
    const result = await ddb.send(new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamID },
    }));
    const team = result.Item as Team;

    if (!team) {
        return response(404, { success: false, message: 'Group not found' });
    }

    if (!team.members.includes(userID)) {
        return response(403, { success: false, message: 'Unauthorized' });
    }

    return response(200, {
        success: true,
        group: {
            teamID: team.teamID,
            name: team.name,
            description: team.description,
            ownerID: team.ownerID,
            owner: { userID: team.ownerID },
            members: team.members.map(m => ({
                userID: m,
                role: m === team.ownerID ? 'owner' : 'member',
            })),
            category: team.category,
            createdAt: team.createdAt,
            updatedAt: team.updatedAt,
        },
    });
}

async function updateGroup(userID: string, teamID: string, body: any): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();

    // ========================================
    // AUTHORIZATION: Team Existence & Ownership
    // ========================================

    const result = await ddb.send(new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamID },
    }));
    const team = result.Item as Team;

    if (!team) {
        AuditService.logAction({
            userID,
            action: 'UPDATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'PUT',
            endpoint: `/api/groups/${teamID}`,
            status: 'failure',
            statusCode: 404,
            errorMessage: 'Group not found',
            durationMs: Date.now() - startTime,
        });
        return response(404, { success: false, message: 'Group not found' });
    }

    if (team.ownerID !== userID) {
        AuditService.logAction({
            userID,
            action: 'UPDATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'PUT',
            endpoint: `/api/groups/${teamID}`,
            status: 'failure',
            statusCode: 403,
            errorMessage: 'Only the group owner can update this group',
            durationMs: Date.now() - startTime,
        });
        return response(403, { success: false, message: 'Only the group owner can update this group' });
    }

    // ========================================
    // AUTHORIZATION: Input Validation
    // ========================================

    const { name, description, category } = body;

    // Validate name if provided
    if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
            AuditService.logAction({
                userID,
                action: 'UPDATE_GROUP',
                resourceType: 'group',
                resourceID: teamID,
                httpMethod: 'PUT',
                endpoint: `/api/groups/${teamID}`,
                status: 'failure',
                statusCode: 400,
                errorMessage: 'Group name must be a non-empty string',
                durationMs: Date.now() - startTime,
            });
            return response(400, { success: false, message: 'Group name must be a non-empty string' });
        }
        if (name.length > 255) {
            AuditService.logAction({
                userID,
                action: 'UPDATE_GROUP',
                resourceType: 'group',
                resourceID: teamID,
                httpMethod: 'PUT',
                endpoint: `/api/groups/${teamID}`,
                status: 'failure',
                statusCode: 400,
                errorMessage: 'Group name must be less than 255 characters',
                durationMs: Date.now() - startTime,
            });
            return response(400, { success: false, message: 'Group name must be less than 255 characters' });
        }
    }

    // Validate description if provided
    if (description !== undefined && typeof description !== 'string') {
        AuditService.logAction({
            userID,
            action: 'UPDATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'PUT',
            endpoint: `/api/groups/${teamID}`,
            status: 'failure',
            statusCode: 400,
            errorMessage: 'Group description must be a string',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'Group description must be a string' });
    }

    // Validate category if provided
    if (category !== undefined && !SYSTEM_MODULES.includes(category)) {
        AuditService.logAction({
            userID,
            action: 'UPDATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'PUT',
            endpoint: `/api/groups/${teamID}`,
            status: 'failure',
            statusCode: 400,
            errorMessage: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(', ')}`,
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(', ')}` });
    }

    const nowIso = new Date().toISOString();

    const updateExpressions: string[] = ['updatedAt = :ua'];
    const expressionValues: Record<string, any> = { ':ua': nowIso };

    if (name !== undefined) { updateExpressions.push('#n = :name'); expressionValues[':name'] = name.trim(); }
    if (description !== undefined) { updateExpressions.push('description = :desc'); expressionValues[':desc'] = description; }
    if (category !== undefined) { updateExpressions.push('category = :cat'); expressionValues[':cat'] = category; }

    try {
        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID },
            UpdateExpression: 'SET ' + updateExpressions.join(', '),
            ExpressionAttributeNames: name !== undefined ? { '#n': 'name' } : undefined,
            ExpressionAttributeValues: expressionValues,
        }));

        AuditService.logAction({
            userID,
            action: 'UPDATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'PUT',
            endpoint: `/api/groups/${teamID}`,
            status: 'success',
            statusCode: 200,
            changes: {
                before: { name: team.name, description: team.description, category: team.category },
                after: { name: name?.trim() || team.name, description: description ?? team.description, category: category ?? team.category },
            },
            durationMs: Date.now() - startTime,
        });

        return response(200, {
            success: true,
            message: 'Group updated successfully',
            group: { teamID, name: name?.trim(), description, category, updatedAt: nowIso },
        });
    } catch (error: any) {
        AuditService.logAction({
            userID,
            action: 'UPDATE_GROUP',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'PUT',
            endpoint: `/api/groups/${teamID}`,
            status: 'failure',
            statusCode: 500,
            errorMessage: error.message,
            durationMs: Date.now() - startTime,
        });
        throw error;
    }
}

async function addGroupMember(userID: string, teamID: string, body: any): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();
    const { userID: memberUserID } = body;

    // ========================================
    // AUTHORIZATION: Input Validation
    // ========================================

    if (!memberUserID || typeof memberUserID !== 'string' || memberUserID.trim().length === 0) {
        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'failure',
            statusCode: 400,
            errorMessage: 'userID is required and must be a non-empty string',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'userID is required and must be a non-empty string' });
    }

    if (memberUserID === userID) {
        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'failure',
            statusCode: 400,
            errorMessage: 'Cannot add yourself to a group',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'Cannot add yourself to a group' });
    }

    // ========================================
    // AUTHORIZATION: Team Owner Verification
    // ========================================

    const result = await ddb.send(new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamID },
    }));
    const team = result.Item as Team;

    if (!team) {
        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'failure',
            statusCode: 404,
            errorMessage: 'Group not found',
            durationMs: Date.now() - startTime,
        });
        return response(404, { success: false, message: 'Group not found' });
    }

    if (team.ownerID !== userID) {
        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'failure',
            statusCode: 403,
            errorMessage: 'Only the group owner can add members',
            durationMs: Date.now() - startTime,
        });
        return response(403, { success: false, message: 'Only the group owner can add members' });
    }

    // ========================================
    // AUTHORIZATION: Business Rules
    // ========================================

    if (team.members.includes(memberUserID)) {
        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'failure',
            statusCode: 400,
            errorMessage: 'User is already a member of this group',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'User is already a member of this group' });
    }

    if (team.members.length >= MAX_GROUP_MEMBERS) {
        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'failure',
            statusCode: 403,
            errorMessage: `Group has reached maximum member limit of ${MAX_GROUP_MEMBERS}`,
            durationMs: Date.now() - startTime,
        });
        return response(403, { success: false, message: `Group has reached maximum member limit of ${MAX_GROUP_MEMBERS}` });
    }

    const nowIso = new Date().toISOString();
    const updatedMembers = [...team.members, memberUserID];

    try {
        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID },
            UpdateExpression: 'SET members = :members, updatedAt = :ua',
            ExpressionAttributeValues: { ':members': updatedMembers, ':ua': nowIso },
        }));

        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'success',
            statusCode: 200,
            changes: {
                before: { memberCount: team.members.length },
                after: { memberCount: updatedMembers.length, newMember: memberUserID },
            },
            durationMs: Date.now() - startTime,
        });

        return response(200, {
            success: true,
            message: 'Member added successfully',
            member: { userID: memberUserID, joinedAt: nowIso },
        });
    } catch (error: any) {
        AuditService.logAction({
            userID,
            action: 'ADD_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'POST',
            endpoint: `/api/groups/${teamID}/members`,
            status: 'failure',
            statusCode: 500,
            errorMessage: error.message,
            durationMs: Date.now() - startTime,
        });
        throw error;
    }
}

async function removeGroupMember(userID: string, teamID: string, memberUserID: string): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();

    // ========================================
    // AUTHORIZATION: Team Owner Verification
    // ========================================

    const result = await ddb.send(new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamID },
    }));
    const team = result.Item as Team;

    if (!team) {
        AuditService.logAction({
            userID,
            action: 'REMOVE_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'DELETE',
            endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
            status: 'failure',
            statusCode: 404,
            errorMessage: 'Group not found',
            durationMs: Date.now() - startTime,
        });
        return response(404, { success: false, message: 'Group not found' });
    }

    if (team.ownerID !== userID) {
        AuditService.logAction({
            userID,
            action: 'REMOVE_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'DELETE',
            endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
            status: 'failure',
            statusCode: 403,
            errorMessage: 'Only the group owner can remove members',
            durationMs: Date.now() - startTime,
        });
        return response(403, { success: false, message: 'Only the group owner can remove members' });
    }

    // ========================================
    // AUTHORIZATION: Business Rules
    // ========================================

    if (memberUserID === team.ownerID) {
        AuditService.logAction({
            userID,
            action: 'REMOVE_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'DELETE',
            endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
            status: 'failure',
            statusCode: 400,
            errorMessage: 'Cannot remove the group owner',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'Cannot remove the group owner' });
    }

    if (!team.members.includes(memberUserID)) {
        AuditService.logAction({
            userID,
            action: 'REMOVE_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'DELETE',
            endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
            status: 'failure',
            statusCode: 400,
            errorMessage: 'User is not a member of this group',
            durationMs: Date.now() - startTime,
        });
        return response(400, { success: false, message: 'User is not a member of this group' });
    }

    const nowIso = new Date().toISOString();
    const updatedMembers = team.members.filter(m => m !== memberUserID);

    try {
        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID },
            UpdateExpression: 'SET members = :members, updatedAt = :ua',
            ExpressionAttributeValues: { ':members': updatedMembers, ':ua': nowIso },
        }));

        AuditService.logAction({
            userID,
            action: 'REMOVE_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'DELETE',
            endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
            status: 'success',
            statusCode: 200,
            changes: {
                before: { memberCount: team.members.length, removedMember: memberUserID },
                after: { memberCount: updatedMembers.length },
            },
            durationMs: Date.now() - startTime,
        });

        return response(200, {
            success: true,
            message: 'Member removed successfully',
        });
    } catch (error: any) {
        AuditService.logAction({
            userID,
            action: 'REMOVE_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'DELETE',
            endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
            status: 'failure',
            statusCode: 500,
            errorMessage: error.message,
            durationMs: Date.now() - startTime,
        });
        throw error;
    }
}

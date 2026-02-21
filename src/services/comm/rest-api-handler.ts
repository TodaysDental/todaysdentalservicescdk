import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AuditService } from './audit-service';
import { createAttendee, createMeetingForScheduledMeeting, joinMeeting as joinChimeMeeting } from './chime-meeting-manager';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const TEAMS_TABLE = process.env.TEAMS_TABLE || '';
const MEETINGS_TABLE = process.env.MEETINGS_TABLE || '';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

// Public meeting link base (fixed domain default)
const PUBLIC_APP_BASE_URL = process.env.PUBLIC_APP_BASE_URL || 'https://todaysdentalinsights.com';

// Authorization Constants
const MAX_GROUP_MEMBERS = 100;

// ========================================
// STRUCTURED JSON LOGGING
// ========================================

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
    requestId?: string;
    userID?: string;
    function?: string;
    operation?: string;
    [key: string]: any;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

/**
 * Structured JSON logger for CloudWatch
 */
const log = {
    _shouldLog(level: LogLevel): boolean {
        const configuredLevel = (LOG_LEVEL.toUpperCase() as LogLevel) || 'INFO';
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
    },

    _formatLog(level: LogLevel, message: string, context?: LogContext, error?: Error): string {
        const logEntry: Record<string, any> = {
            timestamp: new Date().toISOString(),
            level,
            message,
            service: 'comm-rest-api',
            ...(context && { context }),
        };

        if (error) {
            logEntry.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }

        return JSON.stringify(logEntry);
    },

    debug(message: string, context?: LogContext): void {
        if (this._shouldLog('DEBUG')) {
            const formatted = this._formatLog('DEBUG', message, context);
            console.log(formatted);
            console.log(`[DEBUG] ${message}`, context || '');
        }
    },

    info(message: string, context?: LogContext): void {
        if (this._shouldLog('INFO')) {
            const formatted = this._formatLog('INFO', message, context);
            console.log(formatted);
            console.log(`[INFO] ${message}`, context || '');
        }
    },

    warn(message: string, context?: LogContext): void {
        if (this._shouldLog('WARN')) {
            const formatted = this._formatLog('WARN', message, context);
            console.warn(formatted);
            console.warn(`[WARN] ${message}`, context || '');
        }
    },

    error(message: string, context?: LogContext, error?: Error): void {
        if (this._shouldLog('ERROR')) {
            const formatted = this._formatLog('ERROR', message, context, error);
            console.error(formatted);
            console.error(`[ERROR] ${message}`, context || '', error || '');
        }
    },

    // Specialized logging methods
    request(event: APIGatewayProxyEvent, userID: string | null): void {
        this.info('Incoming request', {
            requestId: event.requestContext.requestId,
            userID: userID || 'unauthenticated',
            httpMethod: event.httpMethod,
            path: event.path,
            queryParams: event.queryStringParameters,
            hasBody: !!event.body,
            sourceIp: event.requestContext.identity?.sourceIp,
            userAgent: event.requestContext.identity?.userAgent,
        });
    },

    dbOperation(operation: string, table: string, details: Record<string, any>, context?: LogContext): void {
        this.debug(`DynamoDB ${operation}`, {
            ...context,
            operation,
            table,
            ...details,
        });
    },

    dbResult(operation: string, table: string, itemCount: number, durationMs: number, context?: LogContext): void {
        this.debug(`DynamoDB ${operation} completed`, {
            ...context,
            operation,
            table,
            itemCount,
            durationMs,
        });
    },

    validation(field: string, reason: string, context?: LogContext): void {
        this.warn('Validation failure', {
            ...context,
            validationField: field,
            validationReason: reason,
        });
    },

    flowCount(functionName: string, step: string, count: number, context?: LogContext): void {
        this.debug(`Flow count: ${step}`, {
            ...context,
            function: functionName,
            step,
            count,
        });
    },

    response(statusCode: number, success: boolean, durationMs: number, context?: LogContext): void {
        const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
        const method = level === 'ERROR' ? this.error.bind(this) : level === 'WARN' ? this.warn.bind(this) : this.info.bind(this);
        method('Request completed', {
            ...context,
            statusCode,
            success,
            durationMs,
        });
    },
};

// System Modules (from shared/types/user.ts)
const SYSTEM_MODULES = ['HR', 'Accounting', 'Operations', 'Finance', 'Marketing', 'Legal', 'IT'] as const;
type SystemModule = typeof SYSTEM_MODULES[number];

// SDK Client
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// Types
type TaskStatus = 'pending' | 'active' | 'in_progress' | 'completed' | 'rejected' | 'forwarded' | 'deleted';
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
    isMainGroupChat?: boolean;

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
}

interface Team {
    teamID: string;
    ownerID: string;
    name: string;
    description?: string;
    members: string[];
    admins?: string[];  // Users with admin privileges
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

interface MeetingRecord extends Meeting {
    // Used for unauthenticated guest join (do not expose the hash to clients unless needed)
    guestJoinTokenHash?: string;
    guestJoinExpiresAt?: number; // unix epoch seconds
    // Populated when the first attendee joins
    chimeMeetingId?: string;
    chimeExternalMeetingId?: string;
    chimeMediaRegion?: string;
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
    const authorizer = event.requestContext.authorizer;

    // Log the full authorizer object for debugging
    console.log('DEBUG: Authorizer object:', JSON.stringify(authorizer, null, 2));

    if (!authorizer) {
        console.error('ERROR: No authorizer in request context');
        return null;
    }

    const claims = authorizer.claims;
    console.log('DEBUG: Claims from authorizer:', JSON.stringify(claims, null, 2));

    // Try multiple ways to extract user ID
    const userID = claims?.sub || claims?.['cognito:username'] || claims?.['sub'] || authorizer?.principalId;

    if (!userID) {
        console.error('ERROR: Could not extract userID from claims or principalId');
        console.error('DEBUG: Authorizer keys:', Object.keys(authorizer));
    } else {
        console.log('DEBUG: Successfully extracted userID:', userID);
    }

    return userID || null;
}

function uniqStrings(values: Array<string | undefined | null>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}

function parseDateMaybe(value: any): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function computeGuestJoinExpiresAtSeconds(startTime?: string, endTime?: string): number {
    // Valid through endTime (or startTime) + 24h, with fallback to now+7d.
    const end = parseDateMaybe(endTime);
    const start = parseDateMaybe(startTime);
    const baseMs = (end || start || new Date()).getTime();
    const expiresMs = baseMs + 24 * 60 * 60 * 1000;
    const fallbackMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const ms = Number.isFinite(expiresMs) ? expiresMs : fallbackMs;
    return Math.floor(ms / 1000);
}

function makeGuestJoinToken(): string {
    // base64url is URL-safe and compact.
    return randomBytes(32).toString('base64url');
}

function hashGuestJoinToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    try {
        return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch {
        return false;
    }
}

async function getTeamById(teamID: string, fnCtx?: LogContext): Promise<Team | null> {
    if (!teamID || !TEAMS_TABLE) return null;
    const dbStart = Date.now();
    log.dbOperation('Query', TEAMS_TABLE, { teamID }, fnCtx);
    const result = await ddb.send(new QueryCommand({
        TableName: TEAMS_TABLE,
        KeyConditionExpression: 'teamID = :tid',
        ExpressionAttributeValues: { ':tid': teamID },
        Limit: 1,
    }));
    log.dbResult('Query', TEAMS_TABLE, result.Items?.length ? 1 : 0, Date.now() - dbStart, fnCtx);
    return (result.Items?.[0] as Team) || null;
}

function isUserDirectConversationParticipant(favor: FavorRequest, userID: string): boolean {
    return favor.senderID === userID || favor.receiverID === userID || favor.currentAssigneeID === userID;
}

// ========================================
// MAIN HANDLER
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const handlerStartTime = Date.now();
    const requestId = event.requestContext.requestId;
    const { httpMethod, path, pathParameters, queryStringParameters, body } = event;

    // Log full event for debugging
    console.log('=== INCOMING REQUEST ===');
    console.log('RequestID:', requestId);
    console.log('Method:', httpMethod);
    console.log('Path:', path);
    console.log('RequestContext:', JSON.stringify(event.requestContext, null, 2));
    console.log('========================');

    // Public endpoints (no authorizer)
    const isPublicMeetingJoin = path.match(/^\/api\/public\/meetings\/[^/]+\/join$/) && httpMethod === 'POST';

    const userID = isPublicMeetingJoin ? null : getUserIdFromEvent(event);

    // Log incoming request
    log.request(event, userID || 'public');

    if (!isPublicMeetingJoin && !userID) {
        console.error('CRITICAL: Failed to extract userID from event');
        console.error('Full event.requestContext.authorizer:', JSON.stringify(event.requestContext.authorizer, null, 2));
        log.warn('Authentication failed - no userID extracted', { requestId, path, httpMethod });
        log.response(401, false, Date.now() - handlerStartTime, { requestId });
        return response(401, { success: false, message: 'Unauthorized - Failed to extract user ID from request' });
    }

    const logCtx: LogContext = { requestId, userID: userID || 'public', httpMethod, path, isPublic: isPublicMeetingJoin };
    const authedUserID = userID || '';

    try {
        const parsedBody = body ? JSON.parse(body) : {};
        log.debug('Request body parsed', { ...logCtx, hasBody: !!body });

        let result: APIGatewayProxyResult;
        let routeMatched = false;

        // Route based on path and method
        // Conversations endpoints
        if (isPublicMeetingJoin) {
            const meetingID = pathParameters?.meetingID || path.split('/')[4];
            log.info('Routing to publicJoinMeeting', { ...logCtx, meetingID });
            routeMatched = true;
            result = await publicJoinMeeting(meetingID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/conversations\/search$/)) {
            log.info('Routing to searchConversations', logCtx);
            routeMatched = true;
            result = await searchConversations(authedUserID, queryStringParameters, logCtx);
        } else if (path.match(/^\/api\/conversations\/profiles$/)) {
            log.info('Routing to getConversationProfiles', logCtx);
            routeMatched = true;
            result = await getConversationProfiles(authedUserID, queryStringParameters, logCtx);
        } else if (path.match(/^\/api\/conversations\/[^/]+\/complete$/)) {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            log.info('Routing to getConversationComplete', { ...logCtx, favorRequestID });
            routeMatched = true;
            result = await getConversationComplete(authedUserID, favorRequestID, logCtx);
        } else if (path.match(/^\/api\/conversations\/[^/]+\/user-details$/)) {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            log.info('Routing to getConversationUserDetails', { ...logCtx, favorRequestID });
            routeMatched = true;
            result = await getConversationUserDetails(authedUserID, favorRequestID, logCtx);
        } else if (path.match(/^\/api\/conversations\/[^/]+\/deadline$/) && httpMethod === 'PUT') {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            log.info('Routing to updateConversationDeadline', { ...logCtx, favorRequestID });
            routeMatched = true;
            result = await updateConversationDeadline(authedUserID, favorRequestID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/conversations\/[^/]+$/) && httpMethod === 'DELETE') {
            const favorRequestID = pathParameters?.favorRequestID || path.split('/')[3];
            log.info('Routing to deleteConversation', { ...logCtx, favorRequestID });
            routeMatched = true;
            result = await deleteConversation(authedUserID, favorRequestID, queryStringParameters, logCtx);
        } else if (path.match(/^\/api\/conversations$/) && httpMethod === 'GET') {
            log.info('Routing to getConversations', logCtx);
            routeMatched = true;
            result = await getConversations(authedUserID, queryStringParameters, logCtx);
        }

        // Tasks endpoints
        else if (path.match(/^\/api\/tasks\/by-status$/) && httpMethod === 'GET') {
            log.info('Routing to getTasksByStatus', logCtx);
            routeMatched = true;
            result = await getTasksByStatus(authedUserID, queryStringParameters, logCtx);
        } else if (path.match(/^\/api\/tasks\/forward-history$/) && httpMethod === 'GET') {
            log.info('Routing to getForwardHistory', logCtx);
            routeMatched = true;
            result = await getForwardHistory(authedUserID, queryStringParameters, logCtx);
        } else if (path.match(/^\/api\/tasks\/forwarded-to-me$/) && httpMethod === 'GET') {
            log.info('Routing to getForwardedToMe', logCtx);
            routeMatched = true;
            result = await getForwardedToMe(authedUserID, queryStringParameters, logCtx);
        } else if (path.match(/^\/api\/tasks\/group$/) && httpMethod === 'POST') {
            log.info('Routing to createGroupTask', logCtx);
            routeMatched = true;
            result = await createGroupTask(authedUserID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/tasks\/[^/]+\/forward\/[^/]+\/respond$/) && httpMethod === 'POST') {
            const parts = path.split('/');
            const taskID = parts[3];
            const forwardID = parts[5];
            log.info('Routing to respondToForward', { ...logCtx, taskID, forwardID });
            routeMatched = true;
            result = await respondToForward(authedUserID, taskID, forwardID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/tasks\/[^/]+\/forward$/) && httpMethod === 'POST') {
            const taskID = pathParameters?.taskID || path.split('/')[3];
            log.info('Routing to forwardTask', { ...logCtx, taskID });
            routeMatched = true;
            result = await forwardTask(authedUserID, taskID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/tasks\/[^/]+\/deadline$/) && httpMethod === 'PUT') {
            const taskID = pathParameters?.taskID || path.split('/')[3];
            log.info('Routing to updateTaskDeadline', { ...logCtx, taskID });
            routeMatched = true;
            result = await updateTaskDeadline(authedUserID, taskID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/tasks$/) && httpMethod === 'POST') {
            log.info('Routing to createTask', logCtx);
            routeMatched = true;
            result = await createTask(authedUserID, parsedBody, logCtx);
        }

        // Meetings endpoints
        else if (path.match(/^\/api\/meetings\/[^/]+\/join$/) && httpMethod === 'POST') {
            const meetingID = pathParameters?.meetingID || path.split('/')[3];
            log.info('Routing to joinMeeting', { ...logCtx, meetingID });
            routeMatched = true;
            result = await joinMeeting(authedUserID, meetingID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === 'PUT') {
            const meetingID = pathParameters?.meetingID || path.split('/')[3];
            log.info('Routing to updateMeeting', { ...logCtx, meetingID });
            routeMatched = true;
            result = await updateMeeting(authedUserID, meetingID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === 'DELETE') {
            const meetingID = pathParameters?.meetingID || path.split('/')[3];
            log.info('Routing to deleteMeeting', { ...logCtx, meetingID });
            routeMatched = true;
            result = await deleteMeeting(authedUserID, meetingID, queryStringParameters, logCtx);
        } else if (path.match(/^\/api\/meetings$/) && httpMethod === 'POST') {
            log.info('Routing to createMeeting', logCtx);
            routeMatched = true;
            result = await createMeeting(authedUserID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/meetings$/) && httpMethod === 'GET') {
            log.info('Routing to getMeetings', logCtx);
            routeMatched = true;
            result = await getMeetings(authedUserID, queryStringParameters, logCtx);
        }

        // Groups endpoints
        else if (path.match(/^\/api\/groups\/[^/]+\/members\/[^/]+$/) && httpMethod === 'DELETE') {
            const parts = path.split('/');
            const teamID = parts[3];
            const memberUserID = parts[5];
            log.info('Routing to removeGroupMember', { ...logCtx, teamID, memberUserID });
            routeMatched = true;
            result = await removeGroupMember(authedUserID, teamID, memberUserID, logCtx);
        } else if (path.match(/^\/api\/groups\/[^/]+\/members$/) && httpMethod === 'POST') {
            const teamID = pathParameters?.teamID || path.split('/')[3];
            log.info('Routing to addGroupMember', { ...logCtx, teamID });
            routeMatched = true;
            result = await addGroupMember(authedUserID, teamID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === 'GET') {
            const teamID = pathParameters?.teamID || path.split('/')[3];
            log.info('Routing to getGroupDetails', { ...logCtx, teamID });
            routeMatched = true;
            result = await getGroupDetails(authedUserID, teamID, logCtx);
        } else if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === 'PUT') {
            const teamID = pathParameters?.teamID || path.split('/')[3];
            log.info('Routing to updateGroup', { ...logCtx, teamID });
            routeMatched = true;
            result = await updateGroup(authedUserID, teamID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/groups$/) && httpMethod === 'POST') {
            log.info('Routing to createGroup', logCtx);
            routeMatched = true;
            result = await createGroup(authedUserID, parsedBody, logCtx);
        } else if (path.match(/^\/api\/groups$/) && httpMethod === 'GET') {
            log.info('Routing to getGroups', logCtx);
            routeMatched = true;
            result = await getGroups(authedUserID, queryStringParameters, logCtx);
        }

        if (!routeMatched) {
            log.warn('No route matched', logCtx);
            log.response(404, false, Date.now() - handlerStartTime, logCtx);
            return response(404, { success: false, message: 'Endpoint not found' });
        }

        log.response(result!.statusCode, result!.statusCode < 400, Date.now() - handlerStartTime, logCtx);
        return result!;

    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error('Unhandled error processing request', logCtx, err);
        log.response(500, false, Date.now() - handlerStartTime, logCtx);
        return response(500, { success: false, message: 'Internal server error' });
    }
};

// ========================================
// CONVERSATIONS ENDPOINTS
// ========================================

async function searchConversations(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'searchConversations' };
    const { query, status, type, sort = 'newest', deadline, category, priority, limit = 20, offset = 0 } = params || {};

    log.debug('Search params', { ...fnCtx, query, status, type, sort, category, priority, limit, offset });

    // Query by sender, receiver, AND currentAssignee indexes to catch forwarded tasks
    const dbStart = Date.now();
    log.dbOperation('Query', FAVORS_TABLE, { indexes: ['SenderIndex', 'ReceiverIndex', 'CurrentAssigneeIndex'], userID }, fnCtx);
    const [sentResult, recvResult, assigneeResult] = await Promise.all([
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
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'CurrentAssigneeIndex',
            KeyConditionExpression: 'currentAssigneeID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
    ]);
    log.dbResult('Query', FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0) + (assigneeResult.Items?.length || 0), Date.now() - dbStart, fnCtx);

    let conversations = [...(sentResult.Items || []), ...(recvResult.Items || []), ...(assigneeResult.Items || [])] as FavorRequest[];
    log.flowCount('searchConversations', 'rawResults', conversations.length, fnCtx);

    // Deduplicate
    const byId = new Map<string, FavorRequest>();
    for (const conv of conversations) {
        byId.set(conv.favorRequestID, conv);
    }
    conversations = Array.from(byId.values());
    log.flowCount('searchConversations', 'afterDedupe', conversations.length, fnCtx);

    // Filter out conversations deleted by this user (per-user) or permanently deleted (forEveryone)
    conversations = conversations.filter(c => c.status !== 'deleted' && !(c.deletedBy && c.deletedBy.includes(userID)));
    log.flowCount('searchConversations', 'afterDeleteFilter', conversations.length, fnCtx);

    // Filter
    if (query) {
        const q = query.toLowerCase();
        conversations = conversations.filter(c =>
            c.title?.toLowerCase().includes(q) ||
            c.initialMessage?.toLowerCase().includes(q) ||
            c.description?.toLowerCase().includes(q)
        );
        log.flowCount('searchConversations', 'afterQueryFilter', conversations.length, fnCtx);
    }
    if (status) { conversations = conversations.filter(c => c.status === status); }
    if (type) { conversations = conversations.filter(c => c.requestType === type); }
    if (category) { conversations = conversations.filter(c => c.category === category); }
    if (priority) { conversations = conversations.filter(c => c.priority === priority); }
    log.flowCount('searchConversations', 'afterAllFilters', conversations.length, fnCtx);

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

    log.info('searchConversations completed', { ...fnCtx, total, returned: paginatedConversations.length, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        conversations: paginatedConversations,
        total,
        hasMore: Number(offset) + paginatedConversations.length < total,
    });
}

async function getConversationProfiles(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getConversationProfiles' };
    const { tab = 'single', status, limit = 50, offset = 0 } = params || {};

    log.debug('Profile params', { ...fnCtx, tab, status, limit, offset });

    // For single conversations, query sender, receiver, AND currentAssignee (forwarded tasks)
    const dbStart = Date.now();
    log.dbOperation('Query', FAVORS_TABLE, { indexes: ['SenderIndex', 'ReceiverIndex', 'CurrentAssigneeIndex'], userID }, fnCtx);
    const [sentResult, recvResult, assigneeResult] = await Promise.all([
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
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'CurrentAssigneeIndex',
            KeyConditionExpression: 'currentAssigneeID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
    ]);
    log.dbResult('Query', FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0) + (assigneeResult.Items?.length || 0), Date.now() - dbStart, fnCtx);

    let items = [...(sentResult.Items || []), ...(recvResult.Items || []), ...(assigneeResult.Items || [])] as FavorRequest[];
    log.flowCount('getConversationProfiles', 'rawResults', items.length, fnCtx);

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
    log.flowCount('getConversationProfiles', 'afterTabFilter', items.length, fnCtx);

    // Filter out conversations deleted by this user (per-user) or permanently deleted (forEveryone)
    items = items.filter(i => i.status !== 'deleted' && !(i.deletedBy && i.deletedBy.includes(userID)));
    log.flowCount('getConversationProfiles', 'afterDeleteFilter', items.length, fnCtx);

    // Filter by status
    if (status) {
        items = items.filter(i => i.status === status);
        log.flowCount('getConversationProfiles', 'afterStatusFilter', items.length, fnCtx);
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
        lastMessageTime: item.lastMessageAt || item.updatedAt,
        lastMessagePreview: item.lastMessage || item.initialMessage?.substring(0, 100),
        lastMessageSenderID: item.lastMessageSenderID,
        unreadCount: item.unreadCount,
        nearestDeadline: item.deadline,
        category: item.category,
        priority: item.priority,
        status: item.status,
    }));

    log.info('getConversationProfiles completed', { ...fnCtx, total, returned: profiles.length, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        profiles,
        total,
        hasMore: Number(offset) + profiles.length < total,
    });
}

async function getConversationComplete(userID: string, favorRequestID: string, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getConversationComplete', favorRequestID };

    log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID }, fnCtx);
    const dbStart = Date.now();
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    log.dbResult('GetItem', FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        log.warn('Conversation not found', fnCtx);
        return response(404, { success: false, message: 'Conversation not found' });
    }

    // Verify user is participant
    if (favor.senderID !== userID && favor.receiverID !== userID && favor.currentAssigneeID !== userID) {
        log.debug('User not direct participant, checking team membership', fnCtx);
        // Check team membership if group
        if (favor.teamID && TEAMS_TABLE) {
            const teamDbStart = Date.now();
            log.dbOperation('Query', TEAMS_TABLE, { teamID: favor.teamID }, fnCtx);
            const teamResult = await ddb.send(new QueryCommand({
                TableName: TEAMS_TABLE,
                KeyConditionExpression: 'teamID = :tid',
                ExpressionAttributeValues: { ':tid': favor.teamID },
                Limit: 1,
            }));
            log.dbResult('Query', TEAMS_TABLE, teamResult.Items?.length ? 1 : 0, Date.now() - teamDbStart, fnCtx);
            const team = teamResult.Items?.[0] as Team;
            if (!team?.members.includes(userID)) {
                log.warn('User not in team members', { ...fnCtx, teamID: favor.teamID });
                return response(403, { success: false, message: 'Unauthorized' });
            }
        } else {
            log.warn('Unauthorized access attempt', fnCtx);
            return response(403, { success: false, message: 'Unauthorized' });
        }
    }

    // Get messages
    const msgDbStart = Date.now();
    log.dbOperation('Query', MESSAGES_TABLE, { favorRequestID }, fnCtx);
    const messagesResult = await ddb.send(new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'favorRequestID = :id',
        ExpressionAttributeValues: { ':id': favorRequestID },
        ScanIndexForward: true,
    }));
    log.dbResult('Query', MESSAGES_TABLE, messagesResult.Items?.length || 0, Date.now() - msgDbStart, fnCtx);

    const files = (messagesResult.Items || []).filter((m: any) => m.type === 'file');
    log.info('getConversationComplete completed', {
        ...fnCtx,
        messageCount: messagesResult.Items?.length || 0,
        fileCount: files.length,
        durationMs: Date.now() - fnStart
    });

    return response(200, {
        success: true,
        conversation: favor,
        participants: [favor.senderID, favor.receiverID, favor.currentAssigneeID].filter(Boolean),
        tasks: [favor], // Each favor is a task
        files,
        statistics: {
            totalMessages: messagesResult.Items?.length || 0,
            totalFiles: files.length,
        },
    });
}

async function getConversationUserDetails(userID: string, favorRequestID: string, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getConversationUserDetails', favorRequestID };

    const dbStart = Date.now();
    log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID }, fnCtx);
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    log.dbResult('GetItem', FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        log.warn('Conversation not found', fnCtx);
        return response(404, { success: false, message: 'Conversation not found' });
    }

    log.info('getConversationUserDetails completed', { ...fnCtx, durationMs: Date.now() - fnStart });

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

async function updateConversationDeadline(userID: string, favorRequestID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'updateConversationDeadline', favorRequestID };
    const { deadline } = body;
    const nowIso = new Date().toISOString();

    log.debug('Updating deadline', { ...fnCtx, deadline, hasDeadline: !!deadline });

    const dbStart = Date.now();
    log.dbOperation('UpdateItem', FAVORS_TABLE, { favorRequestID, action: deadline ? 'SET' : 'REMOVE' }, fnCtx);
    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
        UpdateExpression: deadline ? 'SET deadline = :d, updatedAt = :ua' : 'REMOVE deadline SET updatedAt = :ua',
        ExpressionAttributeValues: deadline ? { ':d': deadline, ':ua': nowIso } : { ':ua': nowIso },
    }));
    log.dbResult('UpdateItem', FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);

    log.info('updateConversationDeadline completed', { ...fnCtx, deadline, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        message: 'Deadline updated successfully',
        conversation: { favorRequestID, deadline, updatedAt: nowIso },
    });
}

async function deleteConversation(userID: string, favorRequestID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'deleteConversation', favorRequestID };
    const deleteType = params?.deleteType || 'forMe'; // 'forMe' or 'forEveryone'

    const dbStart = Date.now();
    log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID }, fnCtx);
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID },
    }));
    log.dbResult('GetItem', FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        log.warn('Conversation not found for delete', fnCtx);
        return response(404, { success: false, message: 'Conversation not found' });
    }

    // Allow any participant (sender, receiver, or current assignee) to delete
    const isParticipant = favor.senderID === userID || favor.receiverID === userID || favor.currentAssigneeID === userID;
    if (!isParticipant) {
        log.warn('Unauthorized delete attempt', { ...fnCtx, isParticipant: false });
        return response(403, { success: false, message: 'Unauthorized: You are not a participant of this conversation' });
    }

    const nowIso = new Date().toISOString();

    if (deleteType === 'forEveryone') {
        // === PERMANENT DELETE: Set status to 'deleted' — hides for ALL participants ===
        const updateStart = Date.now();
        log.dbOperation('UpdateItem', FAVORS_TABLE, { favorRequestID, action: 'permanent-delete' }, fnCtx);
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET #s = :status, updatedAt = :ua',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':status': 'deleted', ':ua': nowIso },
        }));
        log.dbResult('UpdateItem', FAVORS_TABLE, 1, Date.now() - updateStart, fnCtx);

        log.info('deleteConversation completed (forEveryone)', { ...fnCtx, deletedByUser: userID, durationMs: Date.now() - fnStart });

        return response(200, {
            success: true,
            message: 'Conversation permanently deleted for everyone',
            deleted: { conversationID: favorRequestID, deleteType: 'forEveryone' },
        });
    } else {
        // === PER-USER DELETE: Add userID to deletedBy list — hides only for this user ===
        const currentDeletedBy = favor.deletedBy || [];
        if (currentDeletedBy.includes(userID)) {
            return response(200, {
                success: true,
                message: 'Conversation already deleted from your view',
                deleted: { conversationID: favorRequestID, deleteType: 'forMe' },
            });
        }
        const updatedDeletedBy = [...currentDeletedBy, userID];

        const updateStart = Date.now();
        log.dbOperation('UpdateItem', FAVORS_TABLE, { favorRequestID, action: 'per-user-delete', deletedByUser: userID }, fnCtx);
        await ddb.send(new UpdateCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID },
            UpdateExpression: 'SET deletedBy = :db, updatedAt = :ua',
            ExpressionAttributeValues: { ':db': updatedDeletedBy, ':ua': nowIso },
        }));
        log.dbResult('UpdateItem', FAVORS_TABLE, 1, Date.now() - updateStart, fnCtx);

        log.info('deleteConversation completed (forMe)', { ...fnCtx, deletedByUser: userID, totalDeletedBy: updatedDeletedBy.length, durationMs: Date.now() - fnStart });

        return response(200, {
            success: true,
            message: 'Conversation deleted from your view',
            deleted: { conversationID: favorRequestID, deleteType: 'forMe' },
        });
    }
}

async function getConversations(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getConversations' };
    const { tab, status, category, limit = 20, offset = 0 } = params || {};

    log.debug('Get conversations params', { ...fnCtx, tab, status, category, limit, offset });

    const dbStart = Date.now();
    log.dbOperation('Query', FAVORS_TABLE, { indexes: ['SenderIndex', 'ReceiverIndex', 'CurrentAssigneeIndex'], userID }, fnCtx);
    const [sentResult, recvResult, assigneeResult] = await Promise.all([
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
        ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'CurrentAssigneeIndex',
            KeyConditionExpression: 'currentAssigneeID = :uid',
            ExpressionAttributeValues: { ':uid': userID },
            ScanIndexForward: false,
        })),
    ]);
    log.dbResult('Query', FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0) + (assigneeResult.Items?.length || 0), Date.now() - dbStart, fnCtx);

    let conversations = [...(sentResult.Items || []), ...(recvResult.Items || []), ...(assigneeResult.Items || [])] as FavorRequest[];
    log.flowCount('getConversations', 'rawResults', conversations.length, fnCtx);

    // Deduplicate
    const byId = new Map<string, FavorRequest>();
    for (const conv of conversations) {
        byId.set(conv.favorRequestID, conv);
    }
    conversations = Array.from(byId.values());
    log.flowCount('getConversations', 'afterDedupe', conversations.length, fnCtx);

    // Filter out conversations deleted by this user (per-user) or permanently deleted (forEveryone)
    conversations = conversations.filter(c => c.status !== 'deleted' && !(c.deletedBy && c.deletedBy.includes(userID)));
    log.flowCount('getConversations', 'afterDeleteFilter', conversations.length, fnCtx);

    // Filter
    if (tab === 'single') { conversations = conversations.filter(c => !c.teamID); }
    if (tab === 'group') { conversations = conversations.filter(c => !!c.teamID); }
    if (status) { conversations = conversations.filter(c => c.status === status); }
    if (category) { conversations = conversations.filter(c => c.category === category); }
    log.flowCount('getConversations', 'afterFilters', conversations.length, fnCtx);

    // Sort by lastMessageAt (WhatsApp-style), falling back to updatedAt
    conversations.sort((a, b) => {
        const aTime = a.lastMessageAt || a.updatedAt;
        const bTime = b.lastMessageAt || b.updatedAt;
        return bTime.localeCompare(aTime);
    });

    // Paginate
    const total = conversations.length;
    const paginatedConversations = conversations.slice(Number(offset), Number(offset) + Number(limit));

    log.info('getConversations completed', { ...fnCtx, total, returned: paginatedConversations.length, durationMs: Date.now() - fnStart });

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

async function getTasksByStatus(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getTasksByStatus' };
    const { status, conversationID, assignedTo, category, priority, limit = 20, offset = 0 } = params || {};

    log.debug('Get tasks params', { ...fnCtx, status, category, priority, limit, offset });

    let items: FavorRequest[] = [];

    if (status) {
        const dbStart = Date.now();
        log.dbOperation('Query', FAVORS_TABLE, { index: 'StatusIndex', status }, fnCtx);
        const result = await ddb.send(new QueryCommand({
            TableName: FAVORS_TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: '#s = :status',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':status': status },
            ScanIndexForward: false,
        }));
        log.dbResult('Query', FAVORS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
        items = (result.Items || []) as FavorRequest[];
    } else {
        // Get all for user
        const dbStart = Date.now();
        log.dbOperation('Query', FAVORS_TABLE, { indexes: ['SenderIndex', 'ReceiverIndex'], userID }, fnCtx);
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
        log.dbResult('Query', FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0), Date.now() - dbStart, fnCtx);
        items = [...(sentResult.Items || []), ...(recvResult.Items || [])] as FavorRequest[];
    }
    log.flowCount('getTasksByStatus', 'rawResults', items.length, fnCtx);

    // Deduplicate
    const byId = new Map<string, FavorRequest>();
    for (const item of items) {
        // Filter to only user's tasks
        if (item.senderID === userID || item.receiverID === userID || item.currentAssigneeID === userID) {
            byId.set(item.favorRequestID, item);
        }
    }
    items = Array.from(byId.values());
    log.flowCount('getTasksByStatus', 'afterDedupe', items.length, fnCtx);

    // Additional filters
    if (category) { items = items.filter(i => i.category === category); }
    if (priority) { items = items.filter(i => i.priority === priority); }
    log.flowCount('getTasksByStatus', 'afterFilters', items.length, fnCtx);

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

    log.info('getTasksByStatus completed', { ...fnCtx, total, returned: tasks.length, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        tasks,
        total,
        hasMore: Number(offset) + tasks.length < total,
        statistics: stats,
    });
}

async function getForwardHistory(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getForwardHistory' };
    const { conversationID, taskID, limit = 50, offset = 0 } = params || {};

    log.debug('Get forward history params', { ...fnCtx, conversationID, taskID, limit, offset });

    let items: FavorRequest[] = [];

    if (taskID || conversationID) {
        const dbStart = Date.now();
        const id = taskID || conversationID;
        log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID: id }, fnCtx);
        const result = await ddb.send(new GetCommand({
            TableName: FAVORS_TABLE,
            Key: { favorRequestID: id },
        }));
        log.dbResult('GetItem', FAVORS_TABLE, result.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
        if (result.Item) items = [result.Item as FavorRequest];
    } else {
        // Get all user's tasks with forwarding chains
        const dbStart = Date.now();
        log.dbOperation('Query', FAVORS_TABLE, { indexes: ['SenderIndex', 'ReceiverIndex'], userID }, fnCtx);
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
        log.dbResult('Query', FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0), Date.now() - dbStart, fnCtx);
        const all = [...(sentResult.Items || []), ...(recvResult.Items || [])] as FavorRequest[];
        items = all.filter(i => i.forwardingChain && i.forwardingChain.length > 0);
        log.flowCount('getForwardHistory', 'tasksWithForwards', items.length, fnCtx);
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
    log.flowCount('getForwardHistory', 'totalForwards', forwardHistory.length, fnCtx);

    // Sort by forwardedAt desc
    forwardHistory.sort((a, b) => b.forwardedAt.localeCompare(a.forwardedAt));

    // Paginate
    const total = forwardHistory.length;
    const paginated = forwardHistory.slice(Number(offset), Number(offset) + Number(limit));

    log.info('getForwardHistory completed', { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        forwardHistory: paginated,
        total,
        hasMore: Number(offset) + paginated.length < total,
    });
}

async function getForwardedToMe(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getForwardedToMe' };
    const { status, limit = 20, offset = 0 } = params || {};

    log.debug('Get forwarded to me params', { ...fnCtx, status, limit, offset });

    // Query by current assignee
    const dbStart = Date.now();
    log.dbOperation('Query', FAVORS_TABLE, { index: 'CurrentAssigneeIndex', userID }, fnCtx);
    const result = await ddb.send(new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: 'CurrentAssigneeIndex',
        KeyConditionExpression: 'currentAssigneeID = :uid',
        ExpressionAttributeValues: { ':uid': userID },
        ScanIndexForward: false,
    }));
    log.dbResult('Query', FAVORS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);

    let items = (result.Items || []) as FavorRequest[];
    log.flowCount('getForwardedToMe', 'assignedItems', items.length, fnCtx);

    // Filter to only forwarded tasks
    items = items.filter(i => i.forwardingChain && i.forwardingChain.length > 0);
    log.flowCount('getForwardedToMe', 'withForwardChain', items.length, fnCtx);

    // Filter by forward status if provided
    if (status) {
        items = items.filter(i => {
            const lastForward = i.forwardingChain?.[i.forwardingChain.length - 1];
            return lastForward?.status === status;
        });
        log.flowCount('getForwardedToMe', 'afterStatusFilter', items.length, fnCtx);
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

    log.info('getForwardedToMe completed', { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        forwardedTasks: paginated,
        total,
        hasMore: Number(offset) + paginated.length < total,
    });
}

async function forwardTask(userID: string, taskID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'forwardTask', taskID };
    const { forwardTo, message, deadline, requireAcceptance = false, notifyOriginalAssignee = true } = body;

    log.debug('Forward task params', { ...fnCtx, forwardTo, requireAcceptance, hasDeadline: !!deadline });

    if (!forwardTo) {
        log.validation('forwardTo', 'required field missing', fnCtx);
        return response(400, { success: false, message: 'forwardTo is required' });
    }

    const dbStart = Date.now();
    log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID: taskID }, fnCtx);
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
    }));
    log.dbResult('GetItem', FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        log.warn('Task not found', fnCtx);
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
    log.flowCount('forwardTask', 'chainLength', updatedChain.length, fnCtx);

    const updateStart = Date.now();
    log.dbOperation('UpdateItem', FAVORS_TABLE, { favorRequestID: taskID, forwardTo }, fnCtx);
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
    log.dbResult('UpdateItem', FAVORS_TABLE, 1, Date.now() - updateStart, fnCtx);

    log.info('forwardTask completed', { ...fnCtx, forwardID, forwardTo, requireAcceptance, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        forwardID,
        message: 'Task forwarded successfully',
        forwardingRecord: forwardRecord,
    });
}

async function respondToForward(userID: string, taskID: string, forwardID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'respondToForward', taskID, forwardID };
    const { action, rejectionReason } = body;

    log.debug('Respond to forward params', { ...fnCtx, action, hasRejectionReason: !!rejectionReason });

    if (!action || !['accept', 'reject'].includes(action)) {
        log.validation('action', 'must be accept or reject', fnCtx);
        return response(400, { success: false, message: 'action must be accept or reject' });
    }

    const dbStart = Date.now();
    log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID: taskID }, fnCtx);
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
    }));
    log.dbResult('GetItem', FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        log.warn('Task not found', fnCtx);
        return response(404, { success: false, message: 'Task not found' });
    }

    const forwardingChain = favor.forwardingChain || [];
    const forwardIndex = forwardingChain.findIndex(f => f.forwardID === forwardID);

    if (forwardIndex === -1) {
        log.warn('Forward record not found', fnCtx);
        return response(404, { success: false, message: 'Forward record not found' });
    }

    const forwardRecord = forwardingChain[forwardIndex];
    if (forwardRecord.toUserID !== userID) {
        log.warn('Forward not assigned to user', { ...fnCtx, assignedTo: forwardRecord.toUserID });
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

    log.debug('Status transition', { ...fnCtx, oldStatus: favor.status, newStatus, newAssignee });

    const updateStart = Date.now();
    log.dbOperation('UpdateItem', FAVORS_TABLE, { favorRequestID: taskID, action }, fnCtx);
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
    log.dbResult('UpdateItem', FAVORS_TABLE, 1, Date.now() - updateStart, fnCtx);

    log.info('respondToForward completed', { ...fnCtx, action, newStatus, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        message: 'Task response recorded successfully',
        forwardingRecord: forwardingChain[forwardIndex],
    });
}

async function updateTaskDeadline(userID: string, taskID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'updateTaskDeadline', taskID };
    const { deadline } = body;
    const nowIso = new Date().toISOString();

    log.debug('Update task deadline', { ...fnCtx, deadline, hasDeadline: !!deadline });

    const dbStart = Date.now();
    log.dbOperation('UpdateItem', FAVORS_TABLE, { favorRequestID: taskID, action: deadline ? 'SET' : 'REMOVE' }, fnCtx);
    await ddb.send(new UpdateCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: taskID },
        UpdateExpression: deadline ? 'SET deadline = :d, updatedAt = :ua' : 'REMOVE deadline SET updatedAt = :ua',
        ExpressionAttributeValues: deadline ? { ':d': deadline, ':ua': nowIso } : { ':ua': nowIso },
    }));
    log.dbResult('UpdateItem', FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);

    log.info('updateTaskDeadline completed', { ...fnCtx, deadline, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        message: 'Task deadline updated successfully',
        task: { taskID, deadline, updatedAt: nowIso },
    });
}

async function createTask(userID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'createTask' };
    const { conversationID, receiverID, title, description, priority = 'Medium', category, deadline, requiresAcceptance = false } = body;

    log.debug('Create task params', { ...fnCtx, receiverID, priority, category, hasDeadline: !!deadline });

    if (!receiverID || !title) {
        log.validation('receiverID/title', 'required fields missing', fnCtx);
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

    const dbStart = Date.now();
    log.dbOperation('PutItem', FAVORS_TABLE, { favorRequestID, receiverID }, fnCtx);
    await ddb.send(new PutCommand({
        TableName: FAVORS_TABLE,
        Item: newTask,
    }));
    log.dbResult('PutItem', FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);

    log.info('createTask completed', { ...fnCtx, taskID: favorRequestID, receiverID, priority, durationMs: Date.now() - fnStart });

    return response(201, {
        success: true,
        taskID: favorRequestID,
        conversationID: favorRequestID,
        message: 'Task created successfully',
        task: newTask,
    });
}

async function createGroupTask(userID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'createGroupTask' };
    const { conversationID, teamID, title, description, assignedTo, priority = 'Medium', category, deadline, requiresAcceptance = false } = body;

    log.debug('Create group task params', { ...fnCtx, teamID, assignedTo, priority, category, hasDeadline: !!deadline });

    if (!teamID || !title) {
        log.validation('teamID/title', 'required fields missing', fnCtx);
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

    const dbStart = Date.now();
    log.dbOperation('PutItem', FAVORS_TABLE, { favorRequestID, teamID }, fnCtx);
    await ddb.send(new PutCommand({
        TableName: FAVORS_TABLE,
        Item: newTask,
    }));
    log.dbResult('PutItem', FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);

    log.info('createGroupTask completed', { ...fnCtx, taskID: favorRequestID, teamID, priority, durationMs: Date.now() - fnStart });

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

async function createMeeting(userID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'createMeeting' };
    const { conversationID, title, description, startTime, endTime, location, participants } = body;

    log.debug('Create meeting params', { ...fnCtx, conversationID, hasStartTime: !!startTime, participantCount: participants?.length || 0 });

    if (!MEETINGS_TABLE || !FAVORS_TABLE) {
        log.error('Meetings/Favors table not configured', { ...fnCtx, hasMeetingsTable: !!MEETINGS_TABLE, hasFavorsTable: !!FAVORS_TABLE });
        return response(500, { success: false, message: 'Server error: Meetings/Favors table not configured' });
    }

    if (!conversationID || !description) {
        log.validation('conversationID/description', 'required fields missing', fnCtx);
        return response(400, { success: false, message: 'conversationID and description are required' });
    }

    // 1) Verify the conversation exists and caller is a participant
    const favorDbStart = Date.now();
    log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID: conversationID }, fnCtx);
    const favorResult = await ddb.send(new GetCommand({
        TableName: FAVORS_TABLE,
        Key: { favorRequestID: conversationID },
    }));
    log.dbResult('GetItem', FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - favorDbStart, fnCtx);
    const favor = favorResult.Item as FavorRequest;

    if (!favor) {
        log.warn('Conversation not found for meeting creation', fnCtx);
        return response(404, { success: false, message: 'Conversation not found' });
    }

    let team: Team | null = null;
    const directParticipant = isUserDirectConversationParticipant(favor, userID);
    if (!directParticipant) {
        log.debug('User not direct participant, checking team membership', { ...fnCtx, teamID: favor.teamID });
        if (favor.teamID) {
            team = await getTeamById(favor.teamID, fnCtx);
            if (!team?.members?.includes(userID)) {
                log.warn('Unauthorized meeting creation attempt (not in team)', { ...fnCtx, teamID: favor.teamID });
                return response(403, { success: false, message: 'Unauthorized' });
            }
        } else {
            log.warn('Unauthorized meeting creation attempt', fnCtx);
            return response(403, { success: false, message: 'Unauthorized' });
        }
    } else if (favor.teamID) {
        // Load team for participant list (optional)
        team = await getTeamById(favor.teamID, fnCtx);
    }

    const conversationParticipants = uniqStrings([
        favor.senderID,
        favor.receiverID,
        favor.currentAssigneeID,
        ...(team?.members || []),
    ]);

    const meetingParticipants =
        Array.isArray(participants) && participants.length > 0
            ? uniqStrings([...(participants as any[]).map(String), userID])
            : uniqStrings([...conversationParticipants, userID]);

    const meetingID = uuidv4();
    const nowIso = new Date().toISOString();

    // 2) Generate secure guest join token + link
    const guestJoinToken = makeGuestJoinToken();
    const guestJoinTokenHash = hashGuestJoinToken(guestJoinToken);
    const guestJoinExpiresAt = computeGuestJoinExpiresAtSeconds(startTime, endTime);
    const generatedMeetingLink = `${PUBLIC_APP_BASE_URL}/#/meet/${encodeURIComponent(meetingID)}?t=${encodeURIComponent(guestJoinToken)}`;

    const meetingRecord: MeetingRecord = {
        meetingID,
        conversationID,
        title: title || description.substring(0, 50),
        description,
        startTime: startTime || nowIso,
        endTime,
        location,
        meetingLink: generatedMeetingLink,
        organizerID: userID,
        participants: meetingParticipants,
        status: 'scheduled',
        createdAt: nowIso,
        updatedAt: nowIso,
        guestJoinTokenHash,
        guestJoinExpiresAt,
    };

    const dbStart = Date.now();
    log.dbOperation('PutItem', MEETINGS_TABLE, { meetingID, conversationID }, fnCtx);
    await ddb.send(new PutCommand({
        TableName: MEETINGS_TABLE,
        Item: meetingRecord,
    }));
    log.dbResult('PutItem', MEETINGS_TABLE, 1, Date.now() - dbStart, fnCtx);

    const meeting: Meeting = {
        meetingID: meetingRecord.meetingID,
        conversationID: meetingRecord.conversationID,
        title: meetingRecord.title,
        description: meetingRecord.description,
        startTime: meetingRecord.startTime,
        endTime: meetingRecord.endTime,
        location: meetingRecord.location,
        meetingLink: meetingRecord.meetingLink,
        organizerID: meetingRecord.organizerID,
        participants: meetingRecord.participants,
        status: meetingRecord.status,
        createdAt: meetingRecord.createdAt,
        updatedAt: meetingRecord.updatedAt,
    };

    log.info('createMeeting completed', { ...fnCtx, meetingID, conversationID, participantCount: meeting.participants.length, durationMs: Date.now() - fnStart });

    return response(201, {
        success: true,
        meetingID,
        message: 'Meeting scheduled successfully',
        meeting,
    });
}

function sanitizeMeeting(meetingRecord: MeetingRecord): Meeting {
    return {
        meetingID: meetingRecord.meetingID,
        conversationID: meetingRecord.conversationID,
        title: meetingRecord.title,
        description: meetingRecord.description,
        startTime: meetingRecord.startTime,
        endTime: meetingRecord.endTime,
        location: meetingRecord.location,
        meetingLink: meetingRecord.meetingLink,
        organizerID: meetingRecord.organizerID,
        participants: Array.isArray(meetingRecord.participants) ? meetingRecord.participants : [],
        status: meetingRecord.status,
        createdAt: meetingRecord.createdAt,
        updatedAt: meetingRecord.updatedAt,
    };
}

async function joinMeeting(userID: string, meetingID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'joinMeeting', meetingID };

    if (!MEETINGS_TABLE) {
        log.error('Meetings table not configured', fnCtx);
        return response(500, { success: false, message: 'Server error: Meetings table not configured' });
    }

    if (!meetingID) {
        log.validation('meetingID', 'missing', fnCtx);
        return response(400, { success: false, message: 'meetingID is required' });
    }

    // 1) Load meeting record
    const dbStart = Date.now();
    log.dbOperation('GetItem', MEETINGS_TABLE, { meetingID }, fnCtx);
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    log.dbResult('GetItem', MEETINGS_TABLE, meetingResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);

    const meetingRecord = meetingResult.Item as MeetingRecord;
    if (!meetingRecord) {
        log.warn('Meeting not found', fnCtx);
        return response(404, { success: false, message: 'Meeting not found' });
    }

    if (meetingRecord.status === 'cancelled') {
        return response(410, { success: false, message: 'Meeting cancelled' });
    }

    // 2) Authorization: organizer or listed participant (fallback to conversation membership for older records)
    const inMeetingParticipants =
        meetingRecord.organizerID === userID ||
        (Array.isArray(meetingRecord.participants) && meetingRecord.participants.includes(userID));

    if (!inMeetingParticipants) {
        log.debug('User not in meeting participants, checking conversation membership', fnCtx);
        if (meetingRecord.conversationID && FAVORS_TABLE) {
            const favorDbStart = Date.now();
            log.dbOperation('GetItem', FAVORS_TABLE, { favorRequestID: meetingRecord.conversationID }, fnCtx);
            const favorResult = await ddb.send(new GetCommand({
                TableName: FAVORS_TABLE,
                Key: { favorRequestID: meetingRecord.conversationID },
            }));
            log.dbResult('GetItem', FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - favorDbStart, fnCtx);
            const favor = favorResult.Item as FavorRequest;

            if (favor) {
                let authorized = isUserDirectConversationParticipant(favor, userID);
                if (!authorized && favor.teamID) {
                    const team = await getTeamById(favor.teamID, fnCtx);
                    authorized = !!team?.members?.includes(userID);
                }
                if (!authorized) {
                    log.warn('Unauthorized meeting join attempt', fnCtx);
                    return response(403, { success: false, message: 'Unauthorized' });
                }
            } else {
                log.warn('Conversation missing for meeting; denying join', fnCtx);
                return response(403, { success: false, message: 'Unauthorized' });
            }
        } else {
            log.warn('Unauthorized meeting join attempt (no conversation)', fnCtx);
            return response(403, { success: false, message: 'Unauthorized' });
        }
    }

    // 3) Ensure Chime meeting exists + create attendee
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 80) : undefined;
    const nowIso = new Date().toISOString();

    let joinInfo: any;
    let createdNewMeeting = false;

    if (meetingRecord.chimeMeetingId) {
        try {
            joinInfo = await joinChimeMeeting(meetingRecord.chimeMeetingId, userID, displayName);
        } catch (err: any) {
            if (err?.name === 'NotFoundException') {
                log.warn('Stored Chime meeting not found; recreating', { ...fnCtx, chimeMeetingId: meetingRecord.chimeMeetingId });
            } else {
                log.error('Failed to join existing Chime meeting', { ...fnCtx, errorName: err?.name, errorMessage: err?.message });
                throw err;
            }
        }
    }

    if (!joinInfo) {
        const chimeMeeting = await createMeetingForScheduledMeeting(meetingID);
        const attendee = await createAttendee(chimeMeeting.MeetingId, userID, displayName);
        joinInfo = { meeting: chimeMeeting, attendee };
        createdNewMeeting = true;

        // Persist meeting mapping for future joins
        const updateStart = Date.now();
        log.dbOperation('UpdateItem', MEETINGS_TABLE, { meetingID, action: 'set-chime-meeting' }, fnCtx);
        await ddb.send(new UpdateCommand({
            TableName: MEETINGS_TABLE,
            Key: { meetingID },
            UpdateExpression: 'SET chimeMeetingId = :mid, chimeExternalMeetingId = :eid, chimeMediaRegion = :mr, updatedAt = :ua',
            ExpressionAttributeValues: {
                ':mid': chimeMeeting.MeetingId,
                ':eid': chimeMeeting.ExternalMeetingId || `meeting-${meetingID}`.slice(0, 64),
                ':mr': chimeMeeting.MediaRegion,
                ':ua': nowIso,
            },
        }));
        log.dbResult('UpdateItem', MEETINGS_TABLE, 1, Date.now() - updateStart, fnCtx);
    }

    log.info('joinMeeting completed', { ...fnCtx, createdNewMeeting, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        meetingID,
        meeting: sanitizeMeeting(meetingRecord),
        joinInfo,
    });
}

async function publicJoinMeeting(meetingID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'publicJoinMeeting', meetingID };

    if (!MEETINGS_TABLE) {
        log.error('Meetings table not configured', fnCtx);
        return response(500, { success: false, message: 'Server error: Meetings table not configured' });
    }

    if (!meetingID) {
        log.validation('meetingID', 'missing', fnCtx);
        return response(400, { success: false, message: 'meetingID is required' });
    }

    const tokenRaw =
        (typeof body?.token === 'string' && body.token) ||
        (typeof body?.t === 'string' && body.t) ||
        (typeof body?.guestJoinToken === 'string' && body.guestJoinToken) ||
        '';
    const token = tokenRaw.trim();

    const nameRaw =
        (typeof body?.name === 'string' && body.name) ||
        (typeof body?.displayName === 'string' && body.displayName) ||
        'Guest';
    const displayName = nameRaw.trim().slice(0, 80) || 'Guest';

    if (!token) {
        log.validation('token', 'missing', fnCtx);
        return response(400, { success: false, message: 'token is required' });
    }

    // 1) Load meeting record
    const dbStart = Date.now();
    log.dbOperation('GetItem', MEETINGS_TABLE, { meetingID }, fnCtx);
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    log.dbResult('GetItem', MEETINGS_TABLE, meetingResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);

    const meetingRecord = meetingResult.Item as MeetingRecord;
    if (!meetingRecord) {
        log.warn('Meeting not found', fnCtx);
        return response(404, { success: false, message: 'Meeting not found' });
    }

    if (meetingRecord.status === 'cancelled') {
        return response(410, { success: false, message: 'Meeting cancelled' });
    }

    // 2) Validate guest token
    const storedHash = typeof meetingRecord.guestJoinTokenHash === 'string' ? meetingRecord.guestJoinTokenHash : '';
    if (!storedHash) {
        log.warn('Guest join not enabled for meeting (no token hash)', fnCtx);
        return response(403, { success: false, message: 'Guest join not enabled' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof meetingRecord.guestJoinExpiresAt === 'number' && meetingRecord.guestJoinExpiresAt > 0) {
        if (nowSeconds > meetingRecord.guestJoinExpiresAt) {
            log.warn('Guest join link expired', { ...fnCtx, guestJoinExpiresAt: meetingRecord.guestJoinExpiresAt, nowSeconds });
            return response(410, { success: false, message: 'Guest link expired' });
        }
    }

    const providedHash = hashGuestJoinToken(token);
    if (!timingSafeEqualUtf8(providedHash, storedHash)) {
        log.warn('Invalid guest token', fnCtx);
        return response(403, { success: false, message: 'Invalid token' });
    }

    // 3) Ensure Chime meeting exists + create attendee
    const guestUserIDBase = `guest_${displayName}`.replace(/\s+/g, '_').slice(0, 64);
    const nowIso = new Date().toISOString();

    let joinInfo: any;
    let createdNewMeeting = false;

    if (meetingRecord.chimeMeetingId) {
        try {
            joinInfo = await joinChimeMeeting(meetingRecord.chimeMeetingId, guestUserIDBase, displayName);
        } catch (err: any) {
            if (err?.name === 'NotFoundException') {
                log.warn('Stored Chime meeting not found; recreating', { ...fnCtx, chimeMeetingId: meetingRecord.chimeMeetingId });
            } else {
                log.error('Failed to join existing Chime meeting', { ...fnCtx, errorName: err?.name, errorMessage: err?.message });
                throw err;
            }
        }
    }

    if (!joinInfo) {
        const chimeMeeting = await createMeetingForScheduledMeeting(meetingID);
        const attendee = await createAttendee(chimeMeeting.MeetingId, guestUserIDBase, displayName);
        joinInfo = { meeting: chimeMeeting, attendee };
        createdNewMeeting = true;

        const updateStart = Date.now();
        log.dbOperation('UpdateItem', MEETINGS_TABLE, { meetingID, action: 'set-chime-meeting' }, fnCtx);
        await ddb.send(new UpdateCommand({
            TableName: MEETINGS_TABLE,
            Key: { meetingID },
            UpdateExpression: 'SET chimeMeetingId = :mid, chimeExternalMeetingId = :eid, chimeMediaRegion = :mr, updatedAt = :ua',
            ExpressionAttributeValues: {
                ':mid': chimeMeeting.MeetingId,
                ':eid': chimeMeeting.ExternalMeetingId || `meeting-${meetingID}`.slice(0, 64),
                ':mr': chimeMeeting.MediaRegion,
                ':ua': nowIso,
            },
        }));
        log.dbResult('UpdateItem', MEETINGS_TABLE, 1, Date.now() - updateStart, fnCtx);
    }

    log.info('publicJoinMeeting completed', { ...fnCtx, createdNewMeeting, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        meetingID,
        guest: { displayName },
        joinInfo,
    });
}

async function getMeetings(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getMeetings' };
    const { conversationID, status, startDate, endDate, limit = 20, offset = 0 } = params || {};

    log.debug('Get meetings params', { ...fnCtx, conversationID, status, startDate, endDate, limit, offset });

    let meetings: Meeting[] = [];

    if (conversationID) {
        const dbStart = Date.now();
        log.dbOperation('Query', MEETINGS_TABLE, { index: 'ConversationIndex', conversationID }, fnCtx);
        const result = await ddb.send(new QueryCommand({
            TableName: MEETINGS_TABLE,
            IndexName: 'ConversationIndex',
            KeyConditionExpression: 'conversationID = :cid',
            ExpressionAttributeValues: { ':cid': conversationID },
            ScanIndexForward: false,
        }));
        log.dbResult('Query', MEETINGS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
        meetings = (result.Items || []) as Meeting[];
    } else {
        const dbStart = Date.now();
        log.dbOperation('Query', MEETINGS_TABLE, { index: 'OrganizerIndex', userID }, fnCtx);
        const result = await ddb.send(new QueryCommand({
            TableName: MEETINGS_TABLE,
            IndexName: 'OrganizerIndex',
            KeyConditionExpression: 'organizerID = :oid',
            ExpressionAttributeValues: { ':oid': userID },
            ScanIndexForward: false,
        }));
        log.dbResult('Query', MEETINGS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
        meetings = (result.Items || []) as Meeting[];
    }
    log.flowCount('getMeetings', 'rawResults', meetings.length, fnCtx);

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
    log.flowCount('getMeetings', 'afterFilters', meetings.length, fnCtx);

    // Paginate
    const total = meetings.length;
    const paginated = meetings.slice(Number(offset), Number(offset) + Number(limit));

    log.info('getMeetings completed', { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        meetings: paginated,
        total,
        hasMore: Number(offset) + paginated.length < total,
    });
}

async function updateMeeting(userID: string, meetingID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'updateMeeting', meetingID };

    const dbStart = Date.now();
    log.dbOperation('GetItem', MEETINGS_TABLE, { meetingID }, fnCtx);
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    log.dbResult('GetItem', MEETINGS_TABLE, meetingResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    const meeting = meetingResult.Item as Meeting;

    if (!meeting) {
        log.warn('Meeting not found', fnCtx);
        return response(404, { success: false, message: 'Meeting not found' });
    }

    if (meeting.organizerID !== userID) {
        log.warn('Unauthorized meeting update attempt', { ...fnCtx, organizerID: meeting.organizerID });
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

    log.debug('Meeting update fields', { ...fnCtx, fieldsUpdated: updateExpressions.length - 1 });

    const updateStart = Date.now();
    log.dbOperation('UpdateItem', MEETINGS_TABLE, { meetingID }, fnCtx);
    await ddb.send(new UpdateCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
        UpdateExpression: 'SET ' + updateExpressions.join(', '),
        ExpressionAttributeValues: expressionValues,
        ...(Object.keys(expressionNames).length > 0 ? { ExpressionAttributeNames: expressionNames } : {}),
    }));
    log.dbResult('UpdateItem', MEETINGS_TABLE, 1, Date.now() - updateStart, fnCtx);

    log.info('updateMeeting completed', { ...fnCtx, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        message: 'Meeting updated successfully',
        meeting: { meetingID, ...body, updatedAt: nowIso },
    });
}

async function deleteMeeting(userID: string, meetingID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'deleteMeeting', meetingID };

    const dbStart = Date.now();
    log.dbOperation('GetItem', MEETINGS_TABLE, { meetingID }, fnCtx);
    const meetingResult = await ddb.send(new GetCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
    }));
    log.dbResult('GetItem', MEETINGS_TABLE, meetingResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    const meeting = meetingResult.Item as Meeting;

    if (!meeting) {
        log.warn('Meeting not found', fnCtx);
        return response(404, { success: false, message: 'Meeting not found' });
    }

    if (meeting.organizerID !== userID) {
        log.warn('Unauthorized meeting delete attempt', { ...fnCtx, organizerID: meeting.organizerID });
        return response(403, { success: false, message: 'Only the organizer can delete this meeting' });
    }

    // Soft delete by updating status
    const nowIso = new Date().toISOString();
    const updateStart = Date.now();
    log.dbOperation('UpdateItem', MEETINGS_TABLE, { meetingID, action: 'soft-delete' }, fnCtx);
    await ddb.send(new UpdateCommand({
        TableName: MEETINGS_TABLE,
        Key: { meetingID },
        UpdateExpression: 'SET #s = :status, updatedAt = :ua',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'cancelled', ':ua': nowIso },
    }));
    log.dbResult('UpdateItem', MEETINGS_TABLE, 1, Date.now() - updateStart, fnCtx);

    log.info('deleteMeeting completed', { ...fnCtx, durationMs: Date.now() - fnStart });

    return response(200, {
        success: true,
        message: 'Meeting deleted successfully',
        meetingID,
    });
}

// ========================================
// GROUPS ENDPOINTS
// ========================================

async function createGroup(userID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();
    const fnCtx = { ...logCtx, function: 'createGroup' };
    const { name, description, members, category, createConversation = true } = body;

    log.debug('Create group params', { ...fnCtx, name, memberCount: members?.length, category, createConversation });

    // ========================================
    // AUTHORIZATION: Input Validation
    // ========================================

    // Validate group name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        log.validation('name', 'Group name is required and must be a non-empty string', fnCtx);
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
        log.validation('name', 'Group name must be less than 255 characters', fnCtx);
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
        log.validation('members', 'members must be a non-empty array of user IDs', fnCtx);
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
            log.validation('memberID', 'All member IDs must be non-empty strings', fnCtx);
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
        log.validation('category', `Invalid category. Must be one of: ${SYSTEM_MODULES.join(', ')}`, fnCtx);
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
    log.flowCount('createGroup', 'uniqueMembers', uniqueMembers.length, fnCtx);

    // Check member limit
    if (uniqueMembers.length > MAX_GROUP_MEMBERS) {
        log.warn('Member limit exceeded', { ...fnCtx, memberCount: uniqueMembers.length, maxMembers: MAX_GROUP_MEMBERS });
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
        log.validation('members', 'Group must have at least one other member', fnCtx);
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
        admins: [userID], // Creator is always the first admin
        ...(category && { category: category as SystemModule }),
        createdAt: nowIso,
        updatedAt: nowIso,
    };

    try {
        const dbStart = Date.now();
        log.dbOperation('PutItem', TEAMS_TABLE, { teamID }, fnCtx);
        await ddb.send(new PutCommand({
            TableName: TEAMS_TABLE,
            Item: team,
        }));
        log.dbResult('PutItem', TEAMS_TABLE, 1, Date.now() - dbStart, fnCtx);

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

            const convDbStart = Date.now();
            log.dbOperation('PutItem', FAVORS_TABLE, { conversationID, teamID }, fnCtx);
            await ddb.send(new PutCommand({
                TableName: FAVORS_TABLE,
                Item: conversation,
            }));
            log.dbResult('PutItem', FAVORS_TABLE, 1, Date.now() - convDbStart, fnCtx);
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

        log.info('createGroup completed', { ...fnCtx, teamID, memberCount: uniqueMembers.length, conversationID, durationMs: Date.now() - startTime });

        return response(201, {
            success: true,
            teamID,
            conversationID,
            message: 'Group created successfully',
            group: team,
        });
    } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error('createGroup failed', fnCtx, err);
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

async function getGroups(userID: string, params: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getGroups' };
    const { category, limit = 20, offset = 0 } = params || {};

    log.debug('Get groups params', { ...fnCtx, category, limit, offset });

    // Scan for teams where user is a member
    const dbStart = Date.now();
    log.dbOperation('Scan', TEAMS_TABLE, { filter: 'contains(members, userID)' }, fnCtx);
    const result = await ddb.send(new ScanCommand({
        TableName: TEAMS_TABLE,
        FilterExpression: 'contains(members, :uid)',
        ExpressionAttributeValues: { ':uid': userID },
    }));
    log.dbResult('Scan', TEAMS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);

    let groups = (result.Items || []) as Team[];
    log.flowCount('getGroups', 'rawResults', groups.length, fnCtx);

    // Filter by category
    if (category) {
        groups = groups.filter(g => g.category === category);
        log.flowCount('getGroups', 'afterCategoryFilter', groups.length, fnCtx);
    }

    // Sort by updatedAt desc
    groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // Paginate
    const total = groups.length;
    const paginated = groups.slice(Number(offset), Number(offset) + Number(limit));

    log.info('getGroups completed', { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });

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

async function getGroupDetails(userID: string, teamID: string, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const fnStart = Date.now();
    const fnCtx = { ...logCtx, function: 'getGroupDetails', teamID };

    const dbStart = Date.now();
    log.dbOperation('Query', TEAMS_TABLE, { teamID }, fnCtx);
    const result = await ddb.send(new QueryCommand({
        TableName: TEAMS_TABLE,
        KeyConditionExpression: 'teamID = :tid',
        ExpressionAttributeValues: { ':tid': teamID },
        Limit: 1,
    }));
    log.dbResult('Query', TEAMS_TABLE, result.Items?.length ? 1 : 0, Date.now() - dbStart, fnCtx);
    const team = result.Items?.[0] as Team;

    if (!team) {
        log.warn('Group not found', fnCtx);
        return response(404, { success: false, message: 'Group not found' });
    }

    if (!team.members.includes(userID)) {
        log.warn('Unauthorized group access attempt', fnCtx);
        return response(403, { success: false, message: 'Unauthorized' });
    }

    log.info('getGroupDetails completed', { ...fnCtx, memberCount: team.members.length, durationMs: Date.now() - fnStart });

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

async function updateGroup(userID: string, teamID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();
    const fnCtx = { ...logCtx, function: 'updateGroup', teamID };

    log.debug('Update group request', fnCtx);

    // ========================================
    // AUTHORIZATION: Team Existence & Ownership
    // ========================================

    const dbStart = Date.now();
    log.dbOperation('Query', TEAMS_TABLE, { teamID }, fnCtx);
    const result = await ddb.send(new QueryCommand({
        TableName: TEAMS_TABLE,
        KeyConditionExpression: 'teamID = :tid',
        ExpressionAttributeValues: { ':tid': teamID },
        Limit: 1,
    }));
    log.dbResult('Query', TEAMS_TABLE, result.Items?.length ? 1 : 0, Date.now() - dbStart, fnCtx);
    const team = result.Items?.[0] as Team;

    if (!team) {
        log.warn('Group not found', fnCtx);
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
        log.warn('Unauthorized group update attempt', { ...fnCtx, ownerID: team.ownerID });
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
            log.validation('name', 'Group name must be a non-empty string', fnCtx);
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
            log.validation('name', 'Group name must be less than 255 characters', fnCtx);
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
        log.validation('description', 'Group description must be a string', fnCtx);
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
        log.validation('category', `Invalid category. Must be one of: ${SYSTEM_MODULES.join(', ')}`, fnCtx);
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
        const updateStart = Date.now();
        log.dbOperation('UpdateItem', TEAMS_TABLE, { teamID, fieldsUpdated: updateExpressions.length - 1 }, fnCtx);
        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
            UpdateExpression: 'SET ' + updateExpressions.join(', '),
            ExpressionAttributeNames: name !== undefined ? { '#n': 'name' } : undefined,
            ExpressionAttributeValues: expressionValues,
        }));
        log.dbResult('UpdateItem', TEAMS_TABLE, 1, Date.now() - updateStart, fnCtx);

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

        log.info('updateGroup completed', { ...fnCtx, durationMs: Date.now() - startTime });

        return response(200, {
            success: true,
            message: 'Group updated successfully',
            group: { teamID, name: name?.trim(), description, category, updatedAt: nowIso },
        });
    } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error('updateGroup failed', fnCtx, err);
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

async function addGroupMember(userID: string, teamID: string, body: any, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();
    const fnCtx = { ...logCtx, function: 'addGroupMember', teamID };
    const { userID: memberUserID } = body;

    log.debug('Add group member request', { ...fnCtx, memberUserID });

    // ========================================
    // AUTHORIZATION: Input Validation
    // ========================================

    if (!memberUserID || typeof memberUserID !== 'string' || memberUserID.trim().length === 0) {
        log.validation('userID', 'userID is required and must be a non-empty string', fnCtx);
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
        log.validation('userID', 'Cannot add yourself to a group', fnCtx);
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

    const dbStart = Date.now();
    log.dbOperation('Query', TEAMS_TABLE, { teamID }, fnCtx);
    const result = await ddb.send(new QueryCommand({
        TableName: TEAMS_TABLE,
        KeyConditionExpression: 'teamID = :tid',
        ExpressionAttributeValues: { ':tid': teamID },
        Limit: 1,
    }));
    log.dbResult('Query', TEAMS_TABLE, result.Items?.length ? 1 : 0, Date.now() - dbStart, fnCtx);
    const team = result.Items?.[0] as Team;

    if (!team) {
        log.warn('Group not found', fnCtx);
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
        log.warn('Unauthorized add member attempt', { ...fnCtx, ownerID: team.ownerID });
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
        log.warn('Member already exists', { ...fnCtx, memberUserID });
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
        log.warn('Member limit reached', { ...fnCtx, currentCount: team.members.length, maxMembers: MAX_GROUP_MEMBERS });
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
        const updateStart = Date.now();
        log.dbOperation('UpdateItem', TEAMS_TABLE, { teamID, addingMember: memberUserID }, fnCtx);
        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
            UpdateExpression: 'SET members = :members, updatedAt = :ua',
            ExpressionAttributeValues: { ':members': updatedMembers, ':ua': nowIso },
        }));
        log.dbResult('UpdateItem', TEAMS_TABLE, 1, Date.now() - updateStart, fnCtx);

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

        log.info('addGroupMember completed', { ...fnCtx, memberUserID, newMemberCount: updatedMembers.length, durationMs: Date.now() - startTime });

        return response(200, {
            success: true,
            message: 'Member added successfully',
            member: { userID: memberUserID, joinedAt: nowIso },
        });
    } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error('addGroupMember failed', fnCtx, err);
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

async function removeGroupMember(userID: string, teamID: string, memberUserID: string, logCtx?: LogContext): Promise<APIGatewayProxyResult> {
    const startTime = Date.now();
    const fnCtx = { ...logCtx, function: 'removeGroupMember', teamID, memberUserID };

    log.debug('Remove group member request', fnCtx);

    // ========================================
    // AUTHORIZATION: Team Owner Verification
    // ========================================

    const dbStart = Date.now();
    log.dbOperation('Query', TEAMS_TABLE, { teamID }, fnCtx);
    const result = await ddb.send(new QueryCommand({
        TableName: TEAMS_TABLE,
        KeyConditionExpression: 'teamID = :tid',
        ExpressionAttributeValues: { ':tid': teamID },
        Limit: 1,
    }));
    log.dbResult('Query', TEAMS_TABLE, result.Items?.length ? 1 : 0, Date.now() - dbStart, fnCtx);
    const team = result.Items?.[0] as Team;

    if (!team) {
        log.warn('Group not found', fnCtx);
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

    if (team.ownerID !== userID && userID !== memberUserID) {
        log.warn('Unauthorized remove member attempt', { ...fnCtx, ownerID: team.ownerID });
        AuditService.logAction({
            userID,
            action: 'REMOVE_GROUP_MEMBER',
            resourceType: 'group',
            resourceID: teamID,
            httpMethod: 'DELETE',
            endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
            status: 'failure',
            statusCode: 403,
            errorMessage: 'Only the group owner can remove other members',
            durationMs: Date.now() - startTime,
        });
        return response(403, { success: false, message: 'Only the group owner can remove other members' });
    }

    // ========================================
    // AUTHORIZATION: Business Rules
    // ========================================

    if (memberUserID === team.ownerID) {
        log.warn('Attempted to remove group owner', fnCtx);
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
        log.warn('Member not found in group', fnCtx);
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
        const updateStart = Date.now();
        log.dbOperation('UpdateItem', TEAMS_TABLE, { teamID, removingMember: memberUserID }, fnCtx);
        await ddb.send(new UpdateCommand({
            TableName: TEAMS_TABLE,
            Key: { teamID, ownerID: team.ownerID },
            UpdateExpression: 'SET members = :members, updatedAt = :ua',
            ExpressionAttributeValues: { ':members': updatedMembers, ':ua': nowIso },
        }));
        log.dbResult('UpdateItem', TEAMS_TABLE, 1, Date.now() - updateStart, fnCtx);

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

        log.info('removeGroupMember completed', { ...fnCtx, newMemberCount: updatedMembers.length, durationMs: Date.now() - startTime });

        return response(200, {
            success: true,
            message: 'Member removed successfully',
        });
    } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error('removeGroupMember failed', fnCtx, err);
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

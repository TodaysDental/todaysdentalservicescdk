// ============================================
// IT Ticket System — Unified Lambda Handler
// ============================================
// Routes all API Gateway {proxy+} requests to the appropriate handler.
// Pattern follows existing project conventions (proxy routing, CORS, DynamoDB).

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand,
    ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import { sendResolutionEmail } from './email-notifier';
import {
    TicketType,
    TicketStatus,
    TicketPriority,
    KNOWN_MODULES,
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE_BYTES,
    MAX_FILES_PER_TICKET,
    VALID_SORT_FIELDS,
    PRIORITY_ORDER,
    STATUS_ORDER,
    type Ticket,
    type TicketComment,
    type TicketFilters,
    type CreateTicketRequest,
    type UpdateTicketRequest,
    type ResolveTicketRequest,
    type AddCommentRequest,
    type MediaUploadRequest,
    type MediaConfirmRequest,
    type UpdateModuleAssigneeRequest,
    type SortField,
    type SortOrder,
} from './types';

// ========================================
// CLIENTS & ENV VARS
// ========================================

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const TICKETS_TABLE = process.env.TICKETS_TABLE!;
const COMMENTS_TABLE = process.env.COMMENTS_TABLE!;
const MODULE_ASSIGNEES_TABLE = process.env.MODULE_ASSIGNEES_TABLE!;
const MEDIA_BUCKET = process.env.MEDIA_BUCKET!;
const PRESIGNED_URL_EXPIRY = parseInt(process.env.PRESIGNED_URL_EXPIRY || '3600', 10);

// ========================================
// HELPERS
// ========================================

function getOrigin(event: APIGatewayProxyEvent): string | undefined {
    return event.headers?.origin || event.headers?.Origin;
}

async function httpOk(event: APIGatewayProxyEvent, body: object, statusCode = 200): Promise<APIGatewayProxyResult> {
    const headers = await buildCorsHeadersAsync({}, getOrigin(event));
    return { statusCode, headers, body: JSON.stringify(body) };
}

async function httpErr(event: APIGatewayProxyEvent, statusCode: number, message: string): Promise<APIGatewayProxyResult> {
    const headers = await buildCorsHeadersAsync({}, getOrigin(event));
    return { statusCode, headers, body: JSON.stringify({ success: false, message }) };
}

function parseBody<T>(event: APIGatewayProxyEvent): T | null {
    try {
        return event.body ? JSON.parse(event.body) as T : null;
    } catch {
        return null;
    }
}

/** Extract user information from the authorizer context. */
function getUserContext(event: APIGatewayProxyEvent) {
    const auth = event.requestContext?.authorizer || {};
    return {
        staffId: auth.staffId || auth.userId || auth.sub || 'unknown',
        staffName: auth.staffName || auth.name || auth.displayName || 'Unknown User',
        email: auth.email || '',
        isSuperAdmin: auth.isSuperAdmin === 'true' || auth.isSuperAdmin === true,
    };
}

// ========================================
// FILTER HELPERS
// ========================================

function parseFilters(params: Record<string, string | undefined>): TicketFilters {
    const filters: TicketFilters = {};

    if (params.status) {
        filters.status = params.status.split(',').map(s => s.trim());
        for (const s of filters.status) {
            if (!Object.values(TicketStatus).includes(s as TicketStatus)) {
                throw new Error(`Invalid status: ${s}. Valid: ${Object.values(TicketStatus).join(', ')}`);
            }
        }
    }

    if (params.module) {
        filters.module = params.module.split(',').map(m => m.trim());
    }

    if (params.ticketType) {
        if (!Object.values(TicketType).includes(params.ticketType as TicketType)) {
            throw new Error(`Invalid ticketType: ${params.ticketType}. Valid: ${Object.values(TicketType).join(', ')}`);
        }
        filters.ticketType = params.ticketType as TicketType;
    }

    if (params.priority) {
        filters.priority = params.priority.split(',').map(p => p.trim());
        for (const p of filters.priority) {
            if (!Object.values(TicketPriority).includes(p as TicketPriority)) {
                throw new Error(`Invalid priority: ${p}. Valid: ${Object.values(TicketPriority).join(', ')}`);
            }
        }
    }

    if (params.assigneeId) filters.assigneeId = params.assigneeId;
    if (params.reporterId) filters.reporterId = params.reporterId;
    if (params.search) filters.search = params.search.trim();

    if (params.dateFrom) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom)) throw new Error('dateFrom must be ISO date (YYYY-MM-DD)');
        filters.dateFrom = params.dateFrom;
    }
    if (params.dateTo) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(params.dateTo)) throw new Error('dateTo must be ISO date (YYYY-MM-DD)');
        filters.dateTo = params.dateTo;
    }
    if (params.resolvedFrom) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(params.resolvedFrom)) throw new Error('resolvedFrom must be ISO date (YYYY-MM-DD)');
        filters.resolvedFrom = params.resolvedFrom;
    }
    if (params.resolvedTo) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(params.resolvedTo)) throw new Error('resolvedTo must be ISO date (YYYY-MM-DD)');
        filters.resolvedTo = params.resolvedTo;
    }

    if (params.hasMedia !== undefined) {
        if (params.hasMedia !== 'true' && params.hasMedia !== 'false') throw new Error('hasMedia must be true or false');
        filters.hasMedia = params.hasMedia === 'true';
    }

    if (params.sortBy) {
        if (!VALID_SORT_FIELDS.includes(params.sortBy as SortField)) {
            throw new Error(`Invalid sortBy: ${params.sortBy}. Valid: ${VALID_SORT_FIELDS.join(', ')}`);
        }
        filters.sortBy = params.sortBy as SortField;
    }

    if (params.sortOrder) {
        if (params.sortOrder !== 'asc' && params.sortOrder !== 'desc') {
            throw new Error('sortOrder must be asc or desc');
        }
        filters.sortOrder = params.sortOrder as SortOrder;
    }

    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    if (isNaN(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1–100');
    filters.limit = limit;

    if (params.lastKey) filters.lastKey = params.lastKey;

    return filters;
}

/**
 * Build a DynamoDB query/scan based on the filter combination.
 * Uses the GSI Routing Logic documented in IT-TICKET-STACK.md.
 */
function buildTicketQuery(filters: TicketFilters) {
    const expressionAttrNames: Record<string, string> = {};
    const expressionAttrValues: Record<string, any> = {};
    const filterParts: string[] = [];

    let indexName: string | undefined;
    let keyCondExpression: string | undefined;
    let useScan = false;

    // --- GSI Routing (priority order) ---
    if (filters.assigneeId) {
        indexName = 'byAssignee';
        expressionAttrNames['#pk'] = 'assigneeId';
        expressionAttrValues[':pkVal'] = filters.assigneeId;
        keyCondExpression = '#pk = :pkVal';
    } else if (filters.status && filters.status.length === 1) {
        indexName = 'byStatus';
        expressionAttrNames['#pk'] = 'status';
        expressionAttrValues[':pkVal'] = filters.status[0];
        keyCondExpression = '#pk = :pkVal';
    } else if (filters.module && filters.module.length === 1) {
        indexName = 'byModule';
        expressionAttrNames['#pk'] = 'module';
        expressionAttrValues[':pkVal'] = filters.module[0];
        keyCondExpression = '#pk = :pkVal';
    } else if (filters.reporterId) {
        indexName = 'byReporter';
        expressionAttrNames['#pk'] = 'reporterId';
        expressionAttrValues[':pkVal'] = filters.reporterId;
        keyCondExpression = '#pk = :pkVal';
    } else {
        useScan = true;
    }

    // --- Date range on sort key (createdAt) ---
    if (keyCondExpression && (filters.dateFrom || filters.dateTo)) {
        expressionAttrNames['#sk'] = 'createdAt';
        if (filters.dateFrom && filters.dateTo) {
            keyCondExpression += ' AND #sk BETWEEN :dateFrom AND :dateTo';
            expressionAttrValues[':dateFrom'] = filters.dateFrom;
            // Include the entire last day
            expressionAttrValues[':dateTo'] = filters.dateTo + 'T23:59:59.999Z';
        } else if (filters.dateFrom) {
            keyCondExpression += ' AND #sk >= :dateFrom';
            expressionAttrValues[':dateFrom'] = filters.dateFrom;
        } else if (filters.dateTo) {
            keyCondExpression += ' AND #sk <= :dateTo';
            expressionAttrValues[':dateTo'] = filters.dateTo + 'T23:59:59.999Z';
        }
    } else if (useScan && (filters.dateFrom || filters.dateTo)) {
        // For scan, date range goes into FilterExpression
        expressionAttrNames['#createdAt'] = 'createdAt';
        if (filters.dateFrom && filters.dateTo) {
            filterParts.push('#createdAt BETWEEN :dateFrom AND :dateTo');
            expressionAttrValues[':dateFrom'] = filters.dateFrom;
            expressionAttrValues[':dateTo'] = filters.dateTo + 'T23:59:59.999Z';
        } else if (filters.dateFrom) {
            filterParts.push('#createdAt >= :dateFrom');
            expressionAttrValues[':dateFrom'] = filters.dateFrom;
        } else if (filters.dateTo) {
            filterParts.push('#createdAt <= :dateTo');
            expressionAttrValues[':dateTo'] = filters.dateTo + 'T23:59:59.999Z';
        }
    }

    // --- Remaining filters as FilterExpression ---

    // Multi-value status (when not used as GSI partition key)
    if (filters.status && filters.status.length > 0 && !(indexName === 'byStatus')) {
        expressionAttrNames['#status'] = 'status';
        if (filters.status.length === 1) {
            expressionAttrValues[':statusVal'] = filters.status[0];
            filterParts.push('#status = :statusVal');
        } else {
            const placeholders = filters.status.map((s, i) => {
                expressionAttrValues[`:s${i}`] = s;
                return `:s${i}`;
            });
            filterParts.push(`#status IN (${placeholders.join(', ')})`);
        }
    }

    // Multi-value module (when not used as GSI partition key)
    if (filters.module && filters.module.length > 0 && !(indexName === 'byModule')) {
        expressionAttrNames['#module'] = 'module';
        if (filters.module.length === 1) {
            expressionAttrValues[':moduleVal'] = filters.module[0];
            filterParts.push('#module = :moduleVal');
        } else {
            const placeholders = filters.module.map((m, i) => {
                expressionAttrValues[`:m${i}`] = m;
                return `:m${i}`;
            });
            filterParts.push(`#module IN (${placeholders.join(', ')})`);
        }
    }

    if (filters.ticketType) {
        expressionAttrNames['#ticketType'] = 'ticketType';
        expressionAttrValues[':ticketType'] = filters.ticketType;
        filterParts.push('#ticketType = :ticketType');
    }

    // Multi-value priority
    if (filters.priority && filters.priority.length > 0) {
        expressionAttrNames['#priority'] = 'priority';
        if (filters.priority.length === 1) {
            expressionAttrValues[':priorityVal'] = filters.priority[0];
            filterParts.push('#priority = :priorityVal');
        } else {
            const placeholders = filters.priority.map((p, i) => {
                expressionAttrValues[`:p${i}`] = p;
                return `:p${i}`;
            });
            filterParts.push(`#priority IN (${placeholders.join(', ')})`);
        }
    }

    // assigneeId filter (when not used as GSI)
    if (filters.assigneeId && indexName !== 'byAssignee') {
        expressionAttrNames['#assigneeId'] = 'assigneeId';
        expressionAttrValues[':assigneeId'] = filters.assigneeId;
        filterParts.push('#assigneeId = :assigneeId');
    }

    // reporterId filter (when not used as GSI)
    if (filters.reporterId && indexName !== 'byReporter') {
        expressionAttrNames['#reporterId'] = 'reporterId';
        expressionAttrValues[':reporterId'] = filters.reporterId;
        filterParts.push('#reporterId = :reporterId');
    }

    // resolvedFrom / resolvedTo
    if (filters.resolvedFrom || filters.resolvedTo) {
        expressionAttrNames['#resolvedAt'] = 'resolvedAt';
        if (filters.resolvedFrom && filters.resolvedTo) {
            filterParts.push('#resolvedAt BETWEEN :resolvedFrom AND :resolvedTo');
            expressionAttrValues[':resolvedFrom'] = filters.resolvedFrom;
            expressionAttrValues[':resolvedTo'] = filters.resolvedTo + 'T23:59:59.999Z';
        } else if (filters.resolvedFrom) {
            filterParts.push('#resolvedAt >= :resolvedFrom');
            expressionAttrValues[':resolvedFrom'] = filters.resolvedFrom;
        } else if (filters.resolvedTo) {
            filterParts.push('#resolvedAt <= :resolvedTo');
            expressionAttrValues[':resolvedTo'] = filters.resolvedTo + 'T23:59:59.999Z';
        }
    }

    // hasMedia
    if (filters.hasMedia !== undefined) {
        if (filters.hasMedia) {
            filterParts.push('attribute_exists(mediaFiles) AND size(mediaFiles) > :zero');
            expressionAttrValues[':zero'] = 0;
        } else {
            filterParts.push('(attribute_not_exists(mediaFiles) OR size(mediaFiles) = :zero)');
            expressionAttrValues[':zero'] = 0;
        }
    }

    // search — handled post-query in listTickets for case-insensitive matching
    // (DynamoDB contains() is case-sensitive, so we filter in JavaScript instead)

    const filterExpression = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;

    return {
        indexName,
        keyCondExpression,
        filterExpression,
        expressionAttrNames: Object.keys(expressionAttrNames).length > 0 ? expressionAttrNames : undefined,
        expressionAttrValues: Object.keys(expressionAttrValues).length > 0 ? expressionAttrValues : undefined,
        useScan,
    };
}

/** Post-query sorting for non-createdAt sort fields. */
function sortTickets(tickets: Ticket[], sortBy: SortField = 'createdAt', order: SortOrder = 'desc'): Ticket[] {
    const sorted = [...tickets].sort((a, b) => {
        switch (sortBy) {
            case 'priority':
                return (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
            case 'status':
                return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
            case 'title':
                return a.title.localeCompare(b.title);
            case 'module':
                return a.module.localeCompare(b.module);
            case 'updatedAt':
                return a.updatedAt.localeCompare(b.updatedAt);
            case 'createdAt':
            default:
                return a.createdAt.localeCompare(b.createdAt);
        }
    });

    return order === 'desc' ? sorted.reverse() : sorted;
}

// ========================================
// ROUTE HANDLERS
// ========================================

/** POST /tickets */
async function createTicket(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const body = parseBody<CreateTicketRequest>(event);
    if (!body) return httpErr(event, 400, 'Invalid JSON body');

    const { ticketType, title, description, module, priority } = body;

    // Validation
    if (!ticketType || !Object.values(TicketType).includes(ticketType)) {
        return httpErr(event, 400, `ticketType must be BUG or FEATURE`);
    }
    if (!title || title.trim().length === 0 || title.length > 255) {
        return httpErr(event, 400, 'title is required and must be ≤ 255 characters');
    }
    if (!description || description.trim().length === 0) {
        return httpErr(event, 400, 'description is required');
    }
    if (!module) {
        return httpErr(event, 400, 'module is required');
    }
    if (priority && !Object.values(TicketPriority).includes(priority)) {
        return httpErr(event, 400, `Invalid priority. Valid: ${Object.values(TicketPriority).join(', ')}`);
    }

    // Deadline validation: mandatory for BUG, optional for FEATURE
    if (ticketType === TicketType.BUG && (!body.deadline || !/^\d{4}-\d{2}-\d{2}/.test(body.deadline))) {
        return httpErr(event, 400, 'Deadline is required for bug reports (YYYY-MM-DD format)');
    }
    if (body.deadline && !/^\d{4}-\d{2}-\d{2}/.test(body.deadline)) {
        return httpErr(event, 400, 'Deadline must be in YYYY-MM-DD format');
    }

    const user = getUserContext(event);

    // Reporter details: prefer body (from localStorage) → fall back to JWT context
    const reporterId = body.reporterId || user.staffId;
    const reporterName = body.reporterName || user.staffName;
    const reporterEmail = body.reporterEmail || user.email;

    // Auto-assignment: look up module assignee
    let assigneeId = '';
    let assigneeName = '';
    let assigneeEmail = '';

    try {
        const { Item } = await ddb.send(new GetCommand({
            TableName: MODULE_ASSIGNEES_TABLE,
            Key: { module },
        }));

        if (Item) {
            assigneeId = Item.assigneeId;
            assigneeName = Item.assigneeName;
            assigneeEmail = Item.assigneeEmail || '';
        } else {
            // Fallback to "Other" module
            const { Item: fallback } = await ddb.send(new GetCommand({
                TableName: MODULE_ASSIGNEES_TABLE,
                Key: { module: 'Other' },
            }));
            if (fallback) {
                assigneeId = fallback.assigneeId;
                assigneeName = fallback.assigneeName;
                assigneeEmail = fallback.assigneeEmail || '';
            } else {
                assigneeId = 'unassigned';
                assigneeName = 'Unassigned';
            }
        }
    } catch (error) {
        console.error('[ITTicket] Error looking up module assignee:', error);
        assigneeId = 'unassigned';
        assigneeName = 'Unassigned';
    }

    const now = new Date().toISOString();
    const ticket: Ticket = {
        ticketId: `tkt-${randomUUID()}`,
        ticketType,
        title: title.trim(),
        description: description.trim(),
        module,
        status: TicketStatus.OPEN,
        priority: priority || TicketPriority.MEDIUM,
        reporterId,
        reporterName,
        reporterEmail,
        assigneeId,
        assigneeName,
        assigneeEmail,
        clinicId: body.clinicId || '',
        ...(body.deadline && { deadline: body.deadline }),
        createdAt: now,
        updatedAt: now,
    };

    await ddb.send(new PutCommand({
        TableName: TICKETS_TABLE,
        Item: ticket,
    }));

    console.log(`[ITTicket] Ticket created: ${ticket.ticketId}, assigned to: ${assigneeName} (${assigneeId})`);
    return httpOk(event, { success: true, message: 'Ticket created and assigned successfully', data: ticket }, 201);
}

/** GET /tickets/:ticketId */
async function getTicket(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const { Item } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));

    if (!Item) return httpErr(event, 404, 'Ticket not found');
    return httpOk(event, { success: true, data: Item });
}

/** GET /tickets (with filters) */
async function listTickets(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const params = event.queryStringParameters || {};

    let filters: TicketFilters;
    try {
        filters = parseFilters(params);
    } catch (err: any) {
        return httpErr(event, 400, err.message);
    }

    const query = buildTicketQuery(filters);
    let items: Ticket[] = [];
    let lastEvaluatedKey: any;

    const exclusiveStartKey = filters.lastKey
        ? JSON.parse(Buffer.from(filters.lastKey, 'base64').toString())
        : undefined;

    if (query.useScan) {
        const result = await ddb.send(new ScanCommand({
            TableName: TICKETS_TABLE,
            FilterExpression: query.filterExpression,
            ExpressionAttributeNames: query.expressionAttrNames,
            ExpressionAttributeValues: query.expressionAttrValues,
            Limit: filters.limit,
            ExclusiveStartKey: exclusiveStartKey,
        }));
        items = (result.Items || []) as Ticket[];
        lastEvaluatedKey = result.LastEvaluatedKey;
    } else {
        const result = await ddb.send(new QueryCommand({
            TableName: TICKETS_TABLE,
            IndexName: query.indexName,
            KeyConditionExpression: query.keyCondExpression,
            FilterExpression: query.filterExpression,
            ExpressionAttributeNames: query.expressionAttrNames,
            ExpressionAttributeValues: query.expressionAttrValues,
            Limit: filters.limit,
            ScanIndexForward: (filters.sortOrder || 'desc') === 'asc',
            ExclusiveStartKey: exclusiveStartKey,
        }));
        items = (result.Items || []) as Ticket[];
        lastEvaluatedKey = result.LastEvaluatedKey;
    }

    // Post-query sort if sortBy is not createdAt (GSI sort key)
    if (filters.sortBy && filters.sortBy !== 'createdAt') {
        items = sortTickets(items, filters.sortBy, filters.sortOrder || 'desc');
    }

    // Post-query search filter (case-insensitive includes on title & description)
    if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        items = items.filter(t =>
            (t.title && t.title.toLowerCase().includes(searchLower)) ||
            (t.description && t.description.toLowerCase().includes(searchLower))
        );
    }

    const nextKey = lastEvaluatedKey
        ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64')
        : undefined;

    return httpOk(event, {
        success: true,
        data: items,
        pagination: {
            count: items.length,
            limit: filters.limit,
            lastKey: nextKey || null,
            hasMore: !!nextKey,
        },
        filters: {
            applied: params,
        },
    });
}

/** DELETE /tickets/:ticketId */
async function deleteTicket(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    // Check ticket exists
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!existing) return httpErr(event, 404, 'Ticket not found');

    // Delete the ticket
    await ddb.send(new DeleteCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));

    // Also clean up any comments for this ticket
    try {
        const commentsResult = await ddb.send(new QueryCommand({
            TableName: COMMENTS_TABLE,
            KeyConditionExpression: 'ticketId = :tid',
            ExpressionAttributeValues: { ':tid': ticketId },
        }));
        if (commentsResult.Items && commentsResult.Items.length > 0) {
            for (const comment of commentsResult.Items) {
                await ddb.send(new DeleteCommand({
                    TableName: COMMENTS_TABLE,
                    Key: { ticketId: comment.ticketId, commentId: comment.commentId },
                }));
            }
        }
    } catch (err) {
        console.warn(`[ITTicket] Failed to clean up comments for ticket ${ticketId}:`, err);
    }

    console.log(`[ITTicket] Ticket deleted: ${ticketId}`);
    return httpOk(event, { success: true, message: 'Ticket deleted successfully' });
}

/** PUT /tickets/:ticketId */
async function updateTicket(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<UpdateTicketRequest>(event);
    if (!body) return httpErr(event, 400, 'Invalid JSON body');

    // Check ticket exists
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!existing) return httpErr(event, 404, 'Ticket not found');

    const updates: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, any> = {};

    if (body.title !== undefined) {
        updates.push('#title = :title');
        names['#title'] = 'title';
        values[':title'] = body.title.trim();
    }
    if (body.description !== undefined) {
        updates.push('#desc = :desc');
        names['#desc'] = 'description';
        values[':desc'] = body.description.trim();
    }
    if (body.module !== undefined) {
        updates.push('#module = :module');
        names['#module'] = 'module';
        values[':module'] = body.module;
    }
    if (body.priority !== undefined) {
        if (!Object.values(TicketPriority).includes(body.priority)) {
            return httpErr(event, 400, `Invalid priority`);
        }
        updates.push('#priority = :priority');
        names['#priority'] = 'priority';
        values[':priority'] = body.priority;
    }
    if (body.status !== undefined) {
        if (!Object.values(TicketStatus).includes(body.status)) {
            return httpErr(event, 400, `Invalid status`);
        }
        updates.push('#status = :status');
        names['#status'] = 'status';
        values[':status'] = body.status;
    }
    if ((body as any).assigneeId !== undefined) {
        updates.push('#assigneeId = :assigneeId');
        names['#assigneeId'] = 'assigneeId';
        values[':assigneeId'] = (body as any).assigneeId;
    }
    if ((body as any).assigneeName !== undefined) {
        updates.push('#assigneeName = :assigneeName');
        names['#assigneeName'] = 'assigneeName';
        values[':assigneeName'] = (body as any).assigneeName;
    }
    if ((body as any).assigneeEmail !== undefined) {
        updates.push('#assigneeEmail = :assigneeEmail');
        names['#assigneeEmail'] = 'assigneeEmail';
        values[':assigneeEmail'] = (body as any).assigneeEmail;
    }
    if ((body as any).assignmentType !== undefined) {
        updates.push('#assignmentType = :assignmentType');
        names['#assignmentType'] = 'assignmentType';
        values[':assignmentType'] = (body as any).assignmentType;
    }
    if ((body as any).groupDetails !== undefined) {
        updates.push('#groupDetails = :groupDetails');
        names['#groupDetails'] = 'groupDetails';
        values[':groupDetails'] = (body as any).groupDetails;
    }
    if (body.deadline !== undefined) {
        updates.push('#deadline = :deadline');
        names['#deadline'] = 'deadline';
        values[':deadline'] = body.deadline;
    }

    // Auto-set status to IN_PROGRESS when assigning someone to an OPEN ticket
    if ((body as any).assigneeId && existing.status === TicketStatus.OPEN && body.status === undefined) {
        updates.push('#status = :status');
        names['#status'] = 'status';
        values[':status'] = TicketStatus.IN_PROGRESS;
    }

    if (updates.length === 0) return httpErr(event, 400, 'No fields to update');

    updates.push('#updatedAt = :updatedAt');
    names['#updatedAt'] = 'updatedAt';
    values[':updatedAt'] = new Date().toISOString();

    const result = await ddb.send(new UpdateCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
    }));

    return httpOk(event, { success: true, message: 'Ticket updated', data: result.Attributes });
}

/** PUT /tickets/:ticketId/resolve */
async function resolveTicket(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<ResolveTicketRequest>(event);
    if (!body || !body.resolution) return httpErr(event, 400, 'resolution field is required');

    const user = getUserContext(event);

    // Get existing ticket
    const { Item: existing } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!existing) return httpErr(event, 404, 'Ticket not found');

    // Only assignee or super admin can resolve
    if (existing.assigneeId !== user.staffId && !user.isSuperAdmin) {
        return httpErr(event, 403, 'Only the assigned person or a Super Admin can resolve this ticket');
    }

    const now = new Date().toISOString();

    // Build update expression with all resolver details
    let updateExpression = 'SET #status = :status, #resolution = :resolution, #resolvedAt = :resolvedAt, #resolvedBy = :resolvedBy, #resolvedByName = :resolvedByName, #resolvedByEmail = :resolvedByEmail, #updatedAt = :updatedAt';
    const exprNames: Record<string, string> = {
        '#status': 'status',
        '#resolution': 'resolution',
        '#resolvedAt': 'resolvedAt',
        '#resolvedBy': 'resolvedBy',
        '#resolvedByName': 'resolvedByName',
        '#resolvedByEmail': 'resolvedByEmail',
        '#updatedAt': 'updatedAt',
    };
    const exprValues: Record<string, any> = {
        ':status': TicketStatus.RESOLVED,
        ':resolution': body.resolution.trim(),
        ':resolvedAt': now,
        ':resolvedBy': user.staffId,
        ':resolvedByName': body.resolvedByName || user.staffName,
        ':resolvedByEmail': body.resolvedByEmail || user.staffId,
        ':updatedAt': now,
    };

    // Store assignment type (single or group)
    if (body.assignmentType) {
        updateExpression += ', #assignmentType = :assignmentType';
        exprNames['#assignmentType'] = 'assignmentType';
        exprValues[':assignmentType'] = body.assignmentType;
    }

    // Store group details if it was a group assignment
    if (body.assignmentType === 'group' && body.groupDetails) {
        updateExpression += ', #groupDetails = :groupDetails';
        exprNames['#groupDetails'] = 'groupDetails';
        exprValues[':groupDetails'] = {
            groupId: body.groupDetails.groupId,
            groupName: body.groupDetails.groupName,
            members: body.groupDetails.members || [],
        };
    }

    // Auto-assign to resolver if ticket has no assignee
    if (!existing.assigneeId || existing.assigneeId === 'unassigned') {
        updateExpression += ', #assigneeId = :assigneeId, #assigneeName = :assigneeName';
        exprNames['#assigneeId'] = 'assigneeId';
        exprNames['#assigneeName'] = 'assigneeName';
        exprValues[':assigneeId'] = user.staffId;
        exprValues[':assigneeName'] = body.resolvedByName || user.staffName;
    }

    const result = await ddb.send(new UpdateCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
    }));

    const updatedTicket = result.Attributes as Ticket;

    // Send resolution email
    let emailSent = false;
    try {
        emailSent = await sendResolutionEmail(updatedTicket);
    } catch (err) {
        console.error('[ITTicket] Failed to send resolution email:', err);
    }

    return httpOk(event, {
        success: true,
        message: 'Ticket resolved',
        data: updatedTicket,
        emailSent,
    });
}

/** POST /tickets/:ticketId/comments */
async function addComment(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<AddCommentRequest>(event);
    if (!body || !body.content || body.content.trim().length === 0) {
        return httpErr(event, 400, 'content is required');
    }

    // Verify ticket exists
    const { Item } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!Item) return httpErr(event, 404, 'Ticket not found');

    const user = getUserContext(event);
    const comment: TicketComment = {
        ticketId,
        commentId: `cmt-${randomUUID()}`,
        authorId: body.authorId || user.staffId,
        authorName: body.authorName || user.staffName,
        content: body.content.trim(),
        isInternal: body.isInternal || false,
        createdAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({
        TableName: COMMENTS_TABLE,
        Item: comment,
    }));

    return httpOk(event, { success: true, message: 'Comment added', data: comment }, 201);
}

/** GET /tickets/:ticketId/comments */
async function listComments(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const params = event.queryStringParameters || {};
    const limit = Math.min(Math.max(parseInt(params.limit || '50', 10), 1), 100);

    const result = await ddb.send(new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: '#ticketId = :ticketId',
        ExpressionAttributeNames: { '#ticketId': 'ticketId' },
        ExpressionAttributeValues: { ':ticketId': ticketId },
        ScanIndexForward: true, // oldest first
        Limit: limit,
    }));

    return httpOk(event, {
        success: true,
        data: result.Items || [],
        count: result.Count || 0,
    });
}

/** PUT /tickets/:ticketId/reopen */
async function reopenTicket(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const { Item: ticket } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!ticket) return httpErr(event, 404, 'Ticket not found');

    if (ticket.status !== TicketStatus.RESOLVED && ticket.status !== TicketStatus.CLOSED) {
        return httpErr(event, 400, 'Only resolved or closed tickets can be reopened');
    }

    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now, assigneeId = :unassigned, assigneeName = :unassignedName REMOVE resolution, resolvedAt, resolvedBy, resolvedByName, resolvedByEmail, assigneeEmail, assignmentType, groupDetails',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':status': TicketStatus.REOPENED,
            ':now': now,
            ':unassigned': 'unassigned',
            ':unassignedName': 'Unassigned',
        },
    }));

    const updated: any = { ...ticket, status: TicketStatus.REOPENED, updatedAt: now, assigneeId: 'unassigned', assigneeName: 'Unassigned' };
    delete updated.resolution;
    delete updated.resolvedAt;
    delete updated.resolvedBy;
    delete updated.resolvedByName;
    delete updated.resolvedByEmail;
    delete updated.assigneeEmail;
    delete updated.assignmentType;
    delete updated.groupDetails;

    return httpOk(event, { success: true, message: 'Ticket reopened', data: updated });
}

/** PUT /tickets/:ticketId/comments/:commentId */
async function updateComment(event: APIGatewayProxyEvent, ticketId: string, commentId: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<{ content: string }>(event);
    if (!body?.content || !body.content.trim()) {
        return httpErr(event, 400, 'content is required');
    }

    // Verify comment exists
    const { Item: comment } = await ddb.send(new GetCommand({
        TableName: COMMENTS_TABLE,
        Key: { ticketId, commentId },
    }));
    if (!comment) return httpErr(event, 404, 'Comment not found');

    const user = getUserContext(event);
    if (comment.authorId !== user.staffId && !user.isSuperAdmin) {
        return httpErr(event, 403, 'You can only edit your own comments');
    }

    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
        TableName: COMMENTS_TABLE,
        Key: { ticketId, commentId },
        UpdateExpression: 'SET content = :content, updatedAt = :now, edited = :edited',
        ExpressionAttributeValues: {
            ':content': body.content.trim(),
            ':now': now,
            ':edited': true,
        },
    }));

    return httpOk(event, {
        success: true,
        message: 'Comment updated',
        data: { ...comment, content: body.content.trim(), updatedAt: now, edited: true },
    });
}

/** DELETE /tickets/:ticketId/comments/:commentId */
async function deleteComment(event: APIGatewayProxyEvent, ticketId: string, commentId: string): Promise<APIGatewayProxyResult> {
    const { Item: comment } = await ddb.send(new GetCommand({
        TableName: COMMENTS_TABLE,
        Key: { ticketId, commentId },
    }));
    if (!comment) return httpErr(event, 404, 'Comment not found');

    const user = getUserContext(event);
    if (comment.authorId !== user.staffId && !user.isSuperAdmin) {
        return httpErr(event, 403, 'You can only delete your own comments');
    }

    await ddb.send(new DeleteCommand({
        TableName: COMMENTS_TABLE,
        Key: { ticketId, commentId },
    }));

    return httpOk(event, { success: true, message: 'Comment deleted' });
}

/** POST /tickets/:ticketId/media/upload */
async function requestMediaUpload(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<MediaUploadRequest>(event);
    if (!body) return httpErr(event, 400, 'Invalid JSON body');

    const { fileName, contentType, fileSize } = body;

    if (!fileName || !contentType) return httpErr(event, 400, 'fileName and contentType are required');
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        return httpErr(event, 400, `Invalid contentType. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }
    if (fileSize > MAX_FILE_SIZE_BYTES) {
        return httpErr(event, 400, `File too large. Max: 50 MB`);
    }

    // Check ticket exists
    const { Item: ticket } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!ticket) return httpErr(event, 404, 'Ticket not found');

    // Check file count limit
    const existingFiles = ticket.mediaFiles || [];
    if (existingFiles.length >= MAX_FILES_PER_TICKET) {
        return httpErr(event, 400, `Maximum ${MAX_FILES_PER_TICKET} files per ticket`);
    }

    const fileId = `file-${randomUUID()}`;
    const s3Key = `${ticketId}/${fileId}-${fileName}`;

    const presignedUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: MEDIA_BUCKET,
            Key: s3Key,
            ContentType: contentType,
        }),
        { expiresIn: PRESIGNED_URL_EXPIRY }
    );

    return httpOk(event, {
        success: true,
        data: {
            fileId,
            uploadUrl: presignedUrl,
            s3Key,
            expiresIn: PRESIGNED_URL_EXPIRY,
        },
    });
}

/** POST /tickets/:ticketId/media/confirm */
async function confirmMediaUpload(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<MediaConfirmRequest>(event);
    if (!body) return httpErr(event, 400, 'Invalid JSON body');

    const { fileId, fileName, s3Key, contentType, fileSize } = body;
    if (!fileId || !fileName || !s3Key || !contentType) {
        return httpErr(event, 400, 'fileId, fileName, s3Key, and contentType are required');
    }

    const now = new Date().toISOString();

    const result = await ddb.send(new UpdateCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
        UpdateExpression: 'SET #mediaFiles = list_append(if_not_exists(#mediaFiles, :emptyList), :newFile), #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#mediaFiles': 'mediaFiles',
            '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
            ':emptyList': [],
            ':newFile': [{
                fileId,
                fileName,
                s3Key,
                contentType,
                fileSize: fileSize || 0,
                uploadedAt: now,
            }],
            ':updatedAt': now,
        },
        ReturnValues: 'ALL_NEW',
    }));

    return httpOk(event, { success: true, message: 'Media file confirmed', data: result.Attributes });
}

/** GET /tickets/:ticketId/media/:fileId — presigned download URL */
async function getMediaDownloadUrl(event: APIGatewayProxyEvent, ticketId: string, fileId: string): Promise<APIGatewayProxyResult> {
    // Look up the ticket to find the file's s3Key
    const { Item: ticket } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!ticket) return httpErr(event, 404, 'Ticket not found');

    const mediaFiles = ticket.mediaFiles || [];
    const file = mediaFiles.find((f: any) => f.fileId === fileId);
    if (!file) return httpErr(event, 404, 'File not found');

    const presignedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
            Bucket: MEDIA_BUCKET,
            Key: file.s3Key,
        }),
        { expiresIn: PRESIGNED_URL_EXPIRY }
    );

    return httpOk(event, {
        success: true,
        data: {
            fileId: file.fileId,
            fileName: file.fileName,
            contentType: file.contentType,
            downloadUrl: presignedUrl,
            expiresIn: PRESIGNED_URL_EXPIRY,
        },
    });
}

/** DELETE /tickets/:ticketId/media/:fileId — remove a media file */
async function deleteMediaFile(event: APIGatewayProxyEvent, ticketId: string, fileId: string): Promise<APIGatewayProxyResult> {
    const { Item: ticket } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!ticket) return httpErr(event, 404, 'Ticket not found');

    const mediaFiles: any[] = ticket.mediaFiles || [];
    const fileIndex = mediaFiles.findIndex((f: any) => f.fileId === fileId);
    if (fileIndex === -1) return httpErr(event, 404, 'File not found');

    const file = mediaFiles[fileIndex];

    // Delete from S3
    try {
        await s3.send(new DeleteObjectCommand({
            Bucket: MEDIA_BUCKET,
            Key: file.s3Key,
        }));
    } catch (err) {
        console.warn(`[ITTicket] Failed to delete S3 object ${file.s3Key}:`, err);
        // Continue — still remove from DynamoDB
    }

    // Remove from mediaFiles array in DynamoDB
    const updatedFiles = mediaFiles.filter((_: any, i: number) => i !== fileIndex);
    await ddb.send(new UpdateCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
        UpdateExpression: 'SET mediaFiles = :files, updatedAt = :now',
        ExpressionAttributeValues: {
            ':files': updatedFiles,
            ':now': new Date().toISOString(),
        },
    }));

    return httpOk(event, {
        success: true,
        message: `File "${file.fileName}" deleted successfully`,
    });
}

/** PUT /tickets/:ticketId/media/:fileId — rename a media file */
async function renameMediaFile(event: APIGatewayProxyEvent, ticketId: string, fileId: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<{ fileName: string }>(event);
    if (!body?.fileName || !body.fileName.trim()) {
        return httpErr(event, 400, 'fileName is required');
    }

    const newName = body.fileName.trim();

    const { Item: ticket } = await ddb.send(new GetCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
    }));
    if (!ticket) return httpErr(event, 404, 'Ticket not found');

    const mediaFiles: any[] = ticket.mediaFiles || [];
    const fileIndex = mediaFiles.findIndex((f: any) => f.fileId === fileId);
    if (fileIndex === -1) return httpErr(event, 404, 'File not found');

    // Update the file name
    mediaFiles[fileIndex].fileName = newName;

    await ddb.send(new UpdateCommand({
        TableName: TICKETS_TABLE,
        Key: { ticketId },
        UpdateExpression: 'SET mediaFiles = :files, updatedAt = :now',
        ExpressionAttributeValues: {
            ':files': mediaFiles,
            ':now': new Date().toISOString(),
        },
    }));

    return httpOk(event, {
        success: true,
        message: `File renamed to "${newName}"`,
        data: mediaFiles[fileIndex],
    });
}

/** GET /dashboard (assignee dashboard) */
async function assigneeDashboard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const user = getUserContext(event);
    const params = event.queryStringParameters || {};

    const queryInput: any = {
        TableName: TICKETS_TABLE,
        IndexName: 'byAssignee',
        KeyConditionExpression: '#assigneeId = :assigneeId',
        ExpressionAttributeNames: { '#assigneeId': 'assigneeId' } as Record<string, string>,
        ExpressionAttributeValues: { ':assigneeId': user.staffId } as Record<string, any>,
        ScanIndexForward: false,
    };

    // Add date range to key condition
    if (params.dateFrom || params.dateTo) {
        queryInput.ExpressionAttributeNames['#sk'] = 'createdAt';
        if (params.dateFrom && params.dateTo) {
            queryInput.KeyConditionExpression += ' AND #sk BETWEEN :dateFrom AND :dateTo';
            queryInput.ExpressionAttributeValues[':dateFrom'] = params.dateFrom;
            queryInput.ExpressionAttributeValues[':dateTo'] = params.dateTo + 'T23:59:59.999Z';
        } else if (params.dateFrom) {
            queryInput.KeyConditionExpression += ' AND #sk >= :dateFrom';
            queryInput.ExpressionAttributeValues[':dateFrom'] = params.dateFrom;
        } else if (params.dateTo) {
            queryInput.KeyConditionExpression += ' AND #sk <= :dateTo';
            queryInput.ExpressionAttributeValues[':dateTo'] = params.dateTo + 'T23:59:59.999Z';
        }
    }

    // Additional filters as FilterExpression
    const filterParts: string[] = [];

    if (params.ticketType) {
        queryInput.ExpressionAttributeNames['#ticketType'] = 'ticketType';
        queryInput.ExpressionAttributeValues[':ticketType'] = params.ticketType;
        filterParts.push('#ticketType = :ticketType');
    }
    if (params.module) {
        const modules = params.module.split(',').map(m => m.trim());
        queryInput.ExpressionAttributeNames['#module'] = 'module';
        if (modules.length === 1) {
            queryInput.ExpressionAttributeValues[':moduleVal'] = modules[0];
            filterParts.push('#module = :moduleVal');
        } else {
            const ph = modules.map((m, i) => {
                queryInput.ExpressionAttributeValues[`:dm${i}`] = m;
                return `:dm${i}`;
            });
            filterParts.push(`#module IN (${ph.join(', ')})`);
        }
    }
    if (params.priority) {
        const priorities = params.priority.split(',').map(p => p.trim());
        queryInput.ExpressionAttributeNames['#priority'] = 'priority';
        if (priorities.length === 1) {
            queryInput.ExpressionAttributeValues[':priorityVal'] = priorities[0];
            filterParts.push('#priority = :priorityVal');
        } else {
            const ph = priorities.map((p, i) => {
                queryInput.ExpressionAttributeValues[`:dp${i}`] = p;
                return `:dp${i}`;
            });
            filterParts.push(`#priority IN (${ph.join(', ')})`);
        }
    }

    if (filterParts.length > 0) {
        queryInput.FilterExpression = filterParts.join(' AND ');
    }

    const result = await ddb.send(new QueryCommand(queryInput));
    const tickets = (result.Items || []) as Ticket[];

    // Compute summary
    const summary = {
        total: tickets.length,
        open: tickets.filter(t => t.status === TicketStatus.OPEN).length,
        inProgress: tickets.filter(t => t.status === TicketStatus.IN_PROGRESS).length,
        resolved: tickets.filter(t => t.status === TicketStatus.RESOLVED).length,
        closed: tickets.filter(t => t.status === TicketStatus.CLOSED).length,
        reopened: tickets.filter(t => t.status === TicketStatus.REOPENED).length,
    };

    // Breakdown by priority
    const byPriority: Record<string, number> = {};
    for (const t of tickets) {
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }

    // Breakdown by module
    const byModule: Record<string, number> = {};
    for (const t of tickets) {
        byModule[t.module] = (byModule[t.module] || 0) + 1;
    }

    return httpOk(event, {
        success: true,
        data: {
            assigneeId: user.staffId,
            assigneeName: user.staffName,
            summary,
            byPriority,
            byModule,
            tickets,
        },
        filters: {
            applied: params,
        },
    });
}

/** GET /dashboard/stats */
async function dashboardStats(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const params = event.queryStringParameters || {};

    // Full table scan with optional filters
    const scanInput: any = {
        TableName: TICKETS_TABLE,
        ExpressionAttributeNames: {} as Record<string, string>,
        ExpressionAttributeValues: {} as Record<string, any>,
    };

    const filterParts: string[] = [];

    if (params.ticketType) {
        scanInput.ExpressionAttributeNames['#ticketType'] = 'ticketType';
        scanInput.ExpressionAttributeValues[':ticketType'] = params.ticketType;
        filterParts.push('#ticketType = :ticketType');
    }
    if (params.assigneeId) {
        scanInput.ExpressionAttributeNames['#assigneeId'] = 'assigneeId';
        scanInput.ExpressionAttributeValues[':assigneeId'] = params.assigneeId;
        filterParts.push('#assigneeId = :assigneeId');
    }
    if (params.dateFrom || params.dateTo) {
        scanInput.ExpressionAttributeNames['#createdAt'] = 'createdAt';
        if (params.dateFrom && params.dateTo) {
            filterParts.push('#createdAt BETWEEN :dateFrom AND :dateTo');
            scanInput.ExpressionAttributeValues[':dateFrom'] = params.dateFrom;
            scanInput.ExpressionAttributeValues[':dateTo'] = params.dateTo + 'T23:59:59.999Z';
        } else if (params.dateFrom) {
            filterParts.push('#createdAt >= :dateFrom');
            scanInput.ExpressionAttributeValues[':dateFrom'] = params.dateFrom;
        } else if (params.dateTo) {
            filterParts.push('#createdAt <= :dateTo');
            scanInput.ExpressionAttributeValues[':dateTo'] = params.dateTo + 'T23:59:59.999Z';
        }
    }

    if (filterParts.length > 0) {
        scanInput.FilterExpression = filterParts.join(' AND ');
    }

    // Handle empty expression maps
    if (Object.keys(scanInput.ExpressionAttributeNames).length === 0) {
        delete scanInput.ExpressionAttributeNames;
        delete scanInput.ExpressionAttributeValues;
    }

    // Paginate through all results for stats
    let allTickets: Ticket[] = [];
    let lastKey: any;
    do {
        if (lastKey) scanInput.ExclusiveStartKey = lastKey;
        const result = await ddb.send(new ScanCommand(scanInput));
        allTickets = allTickets.concat((result.Items || []) as Ticket[]);
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Compute stats
    const byModule: Record<string, { open: number; inProgress: number; resolved: number; total: number }> = {};
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byAssignee: Record<string, { name: string; open: number; inProgress: number; resolved: number; total: number }> = {};

    let totalResolutionMs = 0;
    let resolvedCount = 0;
    const resolutionTimes: number[] = []; // collect all resolution hours for median

    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fifteenDaysAgo = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    let created7 = 0, resolved7 = 0, created15 = 0, resolved15 = 0, created30 = 0, resolved30 = 0;

    // Overdue tracking
    let overdueCount = 0;
    const overdueTickets: Array<{ ticketId: string; title: string; deadline: string; priority: string; assigneeName: string }> = [];



    // Recent activity timeline
    interface ActivityItem {
        ticketId: string;
        title: string;
        type: 'created' | 'resolved' | 'updated';
        timestamp: string;
        actor: string;
        status: string;
        priority: string;
    }
    const activities: ActivityItem[] = [];

    for (const t of allTickets) {
        // By module
        if (!byModule[t.module]) byModule[t.module] = { open: 0, inProgress: 0, resolved: 0, total: 0 };
        byModule[t.module].total++;
        if (t.status === TicketStatus.OPEN) byModule[t.module].open++;
        else if (t.status === TicketStatus.IN_PROGRESS) byModule[t.module].inProgress++;
        else if (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CLOSED) byModule[t.module].resolved++;

        // By type
        byType[t.ticketType] = (byType[t.ticketType] || 0) + 1;

        // By priority
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;

        // By status
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;

        // By assignee
        if (!byAssignee[t.assigneeId]) byAssignee[t.assigneeId] = { name: t.assigneeName, open: 0, inProgress: 0, resolved: 0, total: 0 };
        byAssignee[t.assigneeId].total++;
        if (t.status === TicketStatus.OPEN) byAssignee[t.assigneeId].open++;
        else if (t.status === TicketStatus.IN_PROGRESS) byAssignee[t.assigneeId].inProgress++;
        if (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CLOSED) byAssignee[t.assigneeId].resolved++;

        // Avg resolution time
        if (t.resolvedAt && t.createdAt) {
            const ms = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime();
            if (ms > 0) {
                totalResolutionMs += ms;
                resolvedCount++;
                resolutionTimes.push(ms / 3600000); // hours
            }
        }

        // Trends
        if (t.createdAt >= sevenDaysAgo) created7++;
        if (t.createdAt >= fifteenDaysAgo) created15++;
        if (t.createdAt >= thirtyDaysAgo) created30++;
        if (t.resolvedAt && t.resolvedAt >= sevenDaysAgo) resolved7++;
        if (t.resolvedAt && t.resolvedAt >= fifteenDaysAgo) resolved15++;
        if (t.resolvedAt && t.resolvedAt >= thirtyDaysAgo) resolved30++;

        // Overdue tracking — only check explicit deadline input
        const isActive = t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CLOSED;
        const deadlineField = (t as any).deadline;
        if (isActive && deadlineField) {
            const deadlineEnd = new Date(deadlineField + 'T23:59:59').getTime();
            if (now > deadlineEnd) {
                overdueCount++;
                overdueTickets.push({
                    ticketId: t.ticketId,
                    title: t.title,
                    deadline: deadlineField,
                    priority: t.priority,
                    assigneeName: t.assigneeName,
                });
            }
        }

        // Recent activity — collect events
        if (t.createdAt >= thirtyDaysAgo) {
            activities.push({
                ticketId: t.ticketId,
                title: t.title,
                type: 'created',
                timestamp: t.createdAt,
                actor: t.reporterName,
                status: t.status,
                priority: t.priority,
            });
        }
        if (t.resolvedAt && t.resolvedAt >= thirtyDaysAgo) {
            activities.push({
                ticketId: t.ticketId,
                title: t.title,
                type: 'resolved',
                timestamp: t.resolvedAt,
                actor: (t as any).resolvedBy || t.assigneeName,
                status: 'RESOLVED',
                priority: t.priority,
            });
        }
        if (t.updatedAt && t.updatedAt !== t.createdAt && t.updatedAt >= thirtyDaysAgo && !t.resolvedAt) {
            activities.push({
                ticketId: t.ticketId,
                title: t.title,
                type: 'updated',
                timestamp: t.updatedAt,
                actor: t.assigneeName,
                status: t.status,
                priority: t.priority,
            });
        }
    }

    const avgResolutionHours = resolvedCount > 0 ? Math.round((totalResolutionMs / resolvedCount / 3600000) * 10) / 10 : 0;

    // Compute median resolution time
    resolutionTimes.sort((a, b) => a - b);
    const medianResolutionHours = resolutionTimes.length > 0
        ? Math.round(resolutionTimes[Math.floor(resolutionTimes.length / 2)] * 10) / 10
        : 0;
    const minResolutionHours = resolutionTimes.length > 0 ? Math.round(resolutionTimes[0] * 10) / 10 : 0;
    const maxResolutionHours = resolutionTimes.length > 0 ? Math.round(resolutionTimes[resolutionTimes.length - 1] * 10) / 10 : 0;

    // Sort activities by timestamp descending and take latest 20
    activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const recentActivity = activities.slice(0, 20);

    return httpOk(event, {
        success: true,
        data: {
            byModule,
            byType,
            byPriority,
            byStatus,
            byAssignee,
            overall: {
                total: allTickets.length,
                open: allTickets.filter(t => t.status === TicketStatus.OPEN).length,
                inProgress: allTickets.filter(t => t.status === TicketStatus.IN_PROGRESS).length,
                resolved: allTickets.filter(t => t.status === TicketStatus.RESOLVED).length,
                closed: allTickets.filter(t => t.status === TicketStatus.CLOSED).length,
                avgResolutionHours,
                medianResolutionHours,
                minResolutionHours,
                maxResolutionHours,
                overdueCount,
            },
            overdue: {
                count: overdueCount,
                tickets: overdueTickets.slice(0, 10), // top 10 overdue
            },
            trend: {
                last7Days: { created: created7, resolved: resolved7 },
                last15Days: { created: created15, resolved: resolved15 },
                last30Days: { created: created30, resolved: resolved30 },
            },
            recentActivity,
            filters: {
                applied: params,
            },
        },
    });
}

/** GET /modules/assignees */
async function listModuleAssignees(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const result = await ddb.send(new ScanCommand({
        TableName: MODULE_ASSIGNEES_TABLE,
    }));

    return httpOk(event, { success: true, data: result.Items || [] });
}

/** PUT /modules/assignees/:module */
async function updateModuleAssignee(event: APIGatewayProxyEvent, module: string): Promise<APIGatewayProxyResult> {
    const body = parseBody<UpdateModuleAssigneeRequest>(event);
    if (!body) return httpErr(event, 400, 'Invalid JSON body');

    const { assigneeId, assigneeName, assigneeEmail } = body;
    if (!assigneeId || !assigneeName || !assigneeEmail) {
        return httpErr(event, 400, 'assigneeId, assigneeName, and assigneeEmail are required');
    }

    const now = new Date().toISOString();

    const updateExpression = 'SET #assigneeId = :assigneeId, #assigneeName = :assigneeName, #assigneeEmail = :assigneeEmail, #updatedAt = :updatedAt'
        + (body.backupAssigneeId ? ', #backupAssigneeId = :backupAssigneeId' : '')
        + (body.backupAssigneeName ? ', #backupAssigneeName = :backupAssigneeName' : '');

    const names: Record<string, string> = {
        '#assigneeId': 'assigneeId',
        '#assigneeName': 'assigneeName',
        '#assigneeEmail': 'assigneeEmail',
        '#updatedAt': 'updatedAt',
    };
    const values: Record<string, any> = {
        ':assigneeId': assigneeId,
        ':assigneeName': assigneeName,
        ':assigneeEmail': assigneeEmail,
        ':updatedAt': now,
    };

    if (body.backupAssigneeId) {
        names['#backupAssigneeId'] = 'backupAssigneeId';
        values[':backupAssigneeId'] = body.backupAssigneeId;
    }
    if (body.backupAssigneeName) {
        names['#backupAssigneeName'] = 'backupAssigneeName';
        values[':backupAssigneeName'] = body.backupAssigneeName;
    }

    const result = await ddb.send(new UpdateCommand({
        TableName: MODULE_ASSIGNEES_TABLE,
        Key: { module: decodeURIComponent(module) },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
    }));

    return httpOk(event, { success: true, message: 'Module assignee updated', data: result.Attributes });
}

// ========================================
// ROUTER
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const method = event.httpMethod;
    // Strip the /it-ticket base path prefix (added by API Gateway custom domain base path mapping)
    // event.path arrives as "/it-ticket/tickets/..." but our routes expect "/tickets/..."
    const rawPath = event.path?.replace(/\/+$/, '') || '';
    const path = rawPath.replace(/^\/it-ticket/, '') || '/';

    console.log(`[ITTicket] ${method} ${path} (raw: ${rawPath})`);

    try {
        // --- Ticket CRUD ---
        // POST /tickets
        if (method === 'POST' && path === '/tickets') {
            return createTicket(event);
        }

        // GET /tickets (list with filters)
        if (method === 'GET' && path === '/tickets') {
            return listTickets(event);
        }

        // GET /tickets/:ticketId
        if (method === 'GET' && /^\/tickets\/[^/]+$/.test(path)) {
            const ticketId = path.split('/')[2];
            return getTicket(event, ticketId);
        }

        // PUT /tickets/:ticketId
        if (method === 'PUT' && /^\/tickets\/[^/]+$/.test(path) && !path.endsWith('/resolve') && !path.endsWith('/reopen')) {
            const ticketId = path.split('/')[2];
            return updateTicket(event, ticketId);
        }

        // PUT /tickets/:ticketId/resolve
        if (method === 'PUT' && /^\/tickets\/[^/]+\/resolve$/.test(path)) {
            const ticketId = path.split('/')[2];
            return resolveTicket(event, ticketId);
        }

        // PUT /tickets/:ticketId/reopen
        if (method === 'PUT' && /^\/tickets\/[^/]+\/reopen$/.test(path)) {
            const ticketId = path.split('/')[2];
            return reopenTicket(event, ticketId);
        }

        // DELETE /tickets/:ticketId
        if (method === 'DELETE' && /^\/tickets\/[^/]+$/.test(path)) {
            const ticketId = path.split('/')[2];
            return deleteTicket(event, ticketId);
        }

        // --- Comments ---
        // POST /tickets/:ticketId/comments
        if (method === 'POST' && /^\/tickets\/[^/]+\/comments$/.test(path)) {
            const ticketId = path.split('/')[2];
            return addComment(event, ticketId);
        }

        // GET /tickets/:ticketId/comments
        if (method === 'GET' && /^\/tickets\/[^/]+\/comments$/.test(path)) {
            const ticketId = path.split('/')[2];
            return listComments(event, ticketId);
        }

        // PUT /tickets/:ticketId/comments/:commentId
        if (method === 'PUT' && /^\/tickets\/[^/]+\/comments\/[^/]+$/.test(path)) {
            const parts = path.split('/');
            const ticketId = parts[2];
            const commentId = parts[4];
            return updateComment(event, ticketId, commentId);
        }

        // DELETE /tickets/:ticketId/comments/:commentId
        if (method === 'DELETE' && /^\/tickets\/[^/]+\/comments\/[^/]+$/.test(path)) {
            const parts = path.split('/');
            const ticketId = parts[2];
            const commentId = parts[4];
            return deleteComment(event, ticketId, commentId);
        }

        // --- Media ---
        // POST /tickets/:ticketId/media/upload
        if (method === 'POST' && /^\/tickets\/[^/]+\/media\/upload$/.test(path)) {
            const ticketId = path.split('/')[2];
            return requestMediaUpload(event, ticketId);
        }

        // POST /tickets/:ticketId/media/confirm
        if (method === 'POST' && /^\/tickets\/[^/]+\/media\/confirm$/.test(path)) {
            const ticketId = path.split('/')[2];
            return confirmMediaUpload(event, ticketId);
        }

        // GET /tickets/:ticketId/media/:fileId (presigned download URL)
        if (method === 'GET' && /^\/tickets\/[^/]+\/media\/[^/]+$/.test(path)) {
            const parts = path.split('/');
            const ticketId = parts[2];
            const fileId = parts[4];
            return getMediaDownloadUrl(event, ticketId, fileId);
        }

        // DELETE /tickets/:ticketId/media/:fileId
        if (method === 'DELETE' && /^\/tickets\/[^/]+\/media\/[^/]+$/.test(path)) {
            const parts = path.split('/');
            const ticketId = parts[2];
            const fileId = parts[4];
            return deleteMediaFile(event, ticketId, fileId);
        }

        // PUT /tickets/:ticketId/media/:fileId (rename)
        if (method === 'PUT' && /^\/tickets\/[^/]+\/media\/[^/]+$/.test(path)) {
            const parts = path.split('/');
            const ticketId = parts[2];
            const fileId = parts[4];
            return renameMediaFile(event, ticketId, fileId);
        }

        // --- Dashboard ---
        // GET /dashboard
        if (method === 'GET' && path === '/dashboard') {
            return assigneeDashboard(event);
        }

        // GET /dashboard/stats
        if (method === 'GET' && path === '/dashboard/stats') {
            return dashboardStats(event);
        }

        // --- Module Assignees ---
        // GET /modules/assignees
        if (method === 'GET' && path === '/modules/assignees') {
            return listModuleAssignees(event);
        }

        // PUT /modules/assignees/:module
        if (method === 'PUT' && /^\/modules\/assignees\/[^/]+$/.test(path)) {
            const module = path.split('/')[3];
            return updateModuleAssignee(event, module);
        }

        // --- Fallback ---
        return httpErr(event, 404, `Route not found: ${method} ${path}`);

    } catch (error: any) {
        console.error(`[ITTicket] Unhandled error on ${method} ${path}:`, error);
        return httpErr(event, 500, error.message || 'Internal server error');
    }
};

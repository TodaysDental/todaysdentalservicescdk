/**
 * System Tasks Handler - CRUD operations for the SystemTasks table
 *
 * Provides the API for the frontend's module-specific task views.
 *
 * GET  /system-tasks                  - Query tasks by module, status, clinicId, assignedTo
 * PUT  /system-tasks                  - Update a task (and optionally create a linked FavorRequest on first assignment)
 * POST /system-tasks/{taskId}/resolve - Resolve a task
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getUserPermissions } from '../../shared/utils/permissions-helper';

const REGION = process.env.REGION || 'us-east-1';
const SYSTEM_TASKS_TABLE = process.env.SYSTEM_TASKS_TABLE || '';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// -------------------- Types --------------------

interface SystemTask {
  taskId: string;
  module: string;
  category: string;
  clinicId: string;
  title: string;
  description: string;
  source: string;
  status: string;
  priority: string;
  assignedTo?: string;
  assignedBy?: string;
  assignedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  commTaskId?: string;
  emailFrom?: string;
  emailSubject?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
}

// -------------------- Helpers --------------------

function normalizeResponse(resp: {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
}): APIGatewayProxyResult {
  const statusCode = resp && typeof resp.statusCode === 'number' ? resp.statusCode : 200;
  const headers = resp?.headers || {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  };
  const bodyObj = Object.prototype.hasOwnProperty.call(resp || {}, 'body') ? resp.body : resp;

  return {
    statusCode,
    headers,
    body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj ?? {}),
  };
}

function parseBody(event: APIGatewayProxyEvent): Record<string, any> {
  if (!event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return {};
  }
}

// -------------------- GET: Query Tasks --------------------

async function handleGetTasks(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>,
): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters || {};
  const { module, status, clinicId, assignedTo } = params;
  const limit = Math.min(Number(params.limit) || 50, 200);
  const offset = Number(params.offset) || 0;

  let queryInput: ConstructorParameters<typeof QueryCommand>[0];

  if (module) {
    queryInput = {
      TableName: SYSTEM_TASKS_TABLE,
      IndexName: 'ModuleIndex',
      KeyConditionExpression: '#mod = :mod',
      ExpressionAttributeNames: { '#mod': 'module' },
      ExpressionAttributeValues: { ':mod': module } as Record<string, any>,
    };

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (status) {
      filterParts.push('#st = :st');
      (queryInput.ExpressionAttributeNames as Record<string, string>)['#st'] = 'status';
      filterValues[':st'] = status;
    }
    if (clinicId) {
      filterParts.push('clinicId = :cid');
      filterValues[':cid'] = clinicId;
    }

    if (filterParts.length > 0) {
      queryInput.FilterExpression = filterParts.join(' AND ');
      queryInput.ExpressionAttributeValues = {
        ...queryInput.ExpressionAttributeValues,
        ...filterValues,
      };
    }
  } else if (status) {
    queryInput = {
      TableName: SYSTEM_TASKS_TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: '#st = :st',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':st': status },
    };

    if (clinicId) {
      queryInput.FilterExpression = 'clinicId = :cid';
      queryInput.ExpressionAttributeValues = {
        ...queryInput.ExpressionAttributeValues,
        ':cid': clinicId,
      };
    }
  } else if (clinicId) {
    queryInput = {
      TableName: SYSTEM_TASKS_TABLE,
      IndexName: 'ClinicIndex',
      KeyConditionExpression: 'clinicId = :cid',
      ExpressionAttributeValues: { ':cid': clinicId },
    };
  } else if (assignedTo) {
    queryInput = {
      TableName: SYSTEM_TASKS_TABLE,
      IndexName: 'AssignedToIndex',
      KeyConditionExpression: 'assignedTo = :at',
      ExpressionAttributeValues: { ':at': assignedTo },
    };
  } else {
    return normalizeResponse({
      statusCode: 400,
      headers: corsHeaders,
      body: { message: 'At least one query parameter required: module, status, clinicId, or assignedTo' },
    });
  }

  // Handle assignedTo filter when it's not the primary index
  if (assignedTo && !queryInput.IndexName?.includes('AssignedTo')) {
    const existing = queryInput.FilterExpression;
    queryInput.FilterExpression = existing ? `${existing} AND assignedTo = :at` : 'assignedTo = :at';
    queryInput.ExpressionAttributeValues = {
      ...queryInput.ExpressionAttributeValues,
      ':at': assignedTo,
    };
  }

  queryInput.ScanIndexForward = false;

  try {
    const allItems: SystemTask[] = [];
    let lastKey: Record<string, any> | undefined;

    do {
      if (lastKey) queryInput.ExclusiveStartKey = lastKey;

      const result = await docClient.send(new QueryCommand(queryInput));
      if (result.Items) {
        allItems.push(...(result.Items as SystemTask[]));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey && allItems.length < offset + limit);

    const total = allItems.length;
    const tasks = allItems.slice(offset, offset + limit);

    return normalizeResponse({
      statusCode: 200,
      headers: corsHeaders,
      body: { tasks, total },
    });
  } catch (err: any) {
    console.error('[handleGetTasks] Query error:', err);
    return normalizeResponse({
      statusCode: 500,
      headers: corsHeaders,
      body: { message: 'Failed to query tasks', error: err.message },
    });
  }
}

// -------------------- PUT: Update Task --------------------

async function handleUpdateTask(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>,
  userEmail: string,
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const { taskId, status, assignedTo, notes, resolution } = body;

  if (!taskId) {
    return normalizeResponse({
      statusCode: 400,
      headers: corsHeaders,
      body: { message: 'Missing required field: taskId' },
    });
  }

  // Fetch existing task to check current state
  let existingTask: SystemTask | undefined;
  try {
    const getResult = await docClient.send(new GetCommand({
      TableName: SYSTEM_TASKS_TABLE,
      Key: { taskId },
    }));
    existingTask = getResult.Item as SystemTask | undefined;
  } catch (err: any) {
    console.error('[handleUpdateTask] Get error:', err);
    return normalizeResponse({
      statusCode: 500,
      headers: corsHeaders,
      body: { message: 'Failed to fetch task', error: err.message },
    });
  }

  if (!existingTask) {
    return normalizeResponse({
      statusCode: 404,
      headers: corsHeaders,
      body: { message: `Task not found: ${taskId}` },
    });
  }

  const now = new Date().toISOString();
  const updateParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, any> = {};

  if (status !== undefined) {
    updateParts.push('#st = :st');
    exprNames['#st'] = 'status';
    exprValues[':st'] = status;
  }
  if (assignedTo !== undefined) {
    updateParts.push('assignedTo = :at');
    exprValues[':at'] = assignedTo;
  }
  if (notes !== undefined) {
    updateParts.push('notes = :notes');
    exprValues[':notes'] = notes;
  }
  if (resolution !== undefined) {
    updateParts.push('resolution = :res');
    exprValues[':res'] = resolution;
  }

  // First assignment: set assignedBy / assignedAt and create a linked FavorRequest
  const isFirstAssignment = assignedTo && !existingTask.assignedTo;
  if (isFirstAssignment) {
    updateParts.push('assignedBy = :aby');
    exprValues[':aby'] = userEmail;
    updateParts.push('assignedAt = :aat');
    exprValues[':aat'] = now;

    if (!status) {
      updateParts.push('#st = :st');
      exprNames['#st'] = 'status';
      exprValues[':st'] = 'assigned';
    }

    const favorRequestID = uuidv4();
    try {
      await docClient.send(new PutCommand({
        TableName: FAVORS_TABLE,
        Item: {
          favorRequestID,
          senderID: 'system-email-router',
          userID: 'system-email-router',
          receiverID: assignedTo,
          title: existingTask.title,
          description: existingTask.description,
          status: 'pending',
          priority: existingTask.priority,
          category: existingTask.module,
          requestType: 'Assign Task',
          isTask: true,
          createdAt: now,
          updatedAt: now,
          initialMessage: existingTask.description,
          unreadCount: 1,
          source: 'email-router',
          linkedSystemTaskId: taskId,
        },
      }));
      console.log(`[handleUpdateTask] Created FavorRequest ${favorRequestID} for task ${taskId}`);
    } catch (err: any) {
      console.error('[handleUpdateTask] Failed to create FavorRequest:', err);
      return normalizeResponse({
        statusCode: 500,
        headers: corsHeaders,
        body: { message: 'Failed to create linked FavorRequest', error: err.message },
      });
    }

    updateParts.push('commTaskId = :ctid');
    exprValues[':ctid'] = favorRequestID;
  }

  updateParts.push('updatedAt = :upd');
  exprValues[':upd'] = now;

  try {
    const updateResult = await docClient.send(new UpdateCommand({
      TableName: SYSTEM_TASKS_TABLE,
      Key: { taskId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }));

    return normalizeResponse({
      statusCode: 200,
      headers: corsHeaders,
      body: { task: updateResult.Attributes as SystemTask },
    });
  } catch (err: any) {
    console.error('[handleUpdateTask] Update error:', err);
    return normalizeResponse({
      statusCode: 500,
      headers: corsHeaders,
      body: { message: 'Failed to update task', error: err.message },
    });
  }
}

// -------------------- POST: Resolve Task --------------------

async function handleResolveTask(
  taskId: string,
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>,
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const { resolution, resolvedBy } = body;

  if (!resolution || !resolvedBy) {
    return normalizeResponse({
      statusCode: 400,
      headers: corsHeaders,
      body: { message: 'Missing required fields: resolution, resolvedBy' },
    });
  }

  const now = new Date().toISOString();

  try {
    const updateResult = await docClient.send(new UpdateCommand({
      TableName: SYSTEM_TASKS_TABLE,
      Key: { taskId },
      UpdateExpression: 'SET #st = :st, resolution = :res, resolvedBy = :rby, resolvedAt = :rat, updatedAt = :upd',
      ConditionExpression: 'attribute_exists(taskId)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':st': 'resolved',
        ':res': resolution,
        ':rby': resolvedBy,
        ':rat': now,
        ':upd': now,
      },
      ReturnValues: 'ALL_NEW',
    }));

    return normalizeResponse({
      statusCode: 200,
      headers: corsHeaders,
      body: { task: updateResult.Attributes as SystemTask },
    });
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return normalizeResponse({
        statusCode: 404,
        headers: corsHeaders,
        body: { message: `Task not found: ${taskId}` },
      });
    }
    console.error('[handleResolveTask] Update error:', err);
    return normalizeResponse({
      statusCode: 500,
      headers: corsHeaders,
      body: { message: 'Failed to resolve task', error: err.message },
    });
  }
}

// -------------------- Main Handler --------------------

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('System tasks handler event received');

  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const userPermissions = getUserPermissions(event);
    if (!userPermissions) {
      return normalizeResponse({
        statusCode: 401,
        headers: corsHeaders,
        body: { message: 'Unauthorized: Missing or invalid authentication' },
      });
    }

    const userEmail = userPermissions.email;
    if (!userEmail) {
      return normalizeResponse({
        statusCode: 401,
        headers: corsHeaders,
        body: { message: 'Unauthorized: Could not determine user email' },
      });
    }

    const path = event.path || '';
    const method = event.httpMethod;

    // POST /system-tasks/{taskId}/resolve
    const resolveMatch = path.match(/\/system-tasks\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolveMatch) {
      return handleResolveTask(resolveMatch[1], event, corsHeaders);
    }

    switch (method) {
      case 'GET':
        return handleGetTasks(event, corsHeaders);
      case 'PUT':
        return handleUpdateTask(event, corsHeaders, userEmail);
      default:
        return normalizeResponse({
          statusCode: 400,
          headers: corsHeaders,
          body: { message: 'Invalid method. Use GET, PUT, or POST.' },
        });
    }
  } catch (err) {
    console.error('Unhandled error:', err);
    return normalizeResponse({
      statusCode: 500,
      headers: corsHeaders,
      body: { message: 'Internal server error', error: String((err as Error)?.message || err) },
    });
  }
};

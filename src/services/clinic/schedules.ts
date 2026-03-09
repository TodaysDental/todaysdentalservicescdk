import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { SYSTEM_MODULES } from '../../shared/types/user';
import { parseClinicRoles } from '../../shared/utils/permissions-helper';
import { randomUUID } from 'crypto';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.SCHEDULER || process.env.TABLE_NAME || 'SCHEDULER';

// Dynamic CORS helper with custom headers
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({ allowHeaders: ['x-api-key'] }, event.headers?.origin);

/**
 * Get user's clinic roles and permissions from custom authorizer
 */
const getUserPermissions = (event: APIGatewayProxyEvent) => {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer) return null;

  try {
    const clinicRoles = parseClinicRoles(authorizer.clinicRolesZ ?? authorizer.clinicRoles);
    const isSuperAdmin = authorizer.isSuperAdmin === 'true';
    const isGlobalSuperAdmin = authorizer.isGlobalSuperAdmin === 'true';
    const email = authorizer.email || '';

    return {
      email,
      clinicRoles,
      isSuperAdmin,
      isGlobalSuperAdmin,
    };
  } catch (err) {
    console.error('Failed to parse user permissions:', err);
    return null;
  }
};

/**
 * Check if user has admin role (Admin, SuperAdmin, or Global Super Admin)
 */
const isAdminUser = (
  clinicRoles: any[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): boolean => {
  // Check flags first
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return true;
  }

  // Check if user has Admin or SuperAdmin role at any clinic
  for (const cr of clinicRoles) {
    if (cr.role === 'Admin' || cr.role === 'SuperAdmin' || cr.role === 'Global super admin') {
      return true;
    }
  }

  return false;
};

/**
 * Check if user has specific permission for Operations module at ANY clinic
 */
const hasModulePermission = (
  clinicRoles: any[],
  permission: 'read' | 'write' | 'put' | 'delete',
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean,
  clinicId?: string
): boolean => {
  // Admin, SuperAdmin, and Global Super Admin have all permissions for all modules
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }

  // Check if user has the permission for Operations module at any clinic (or specific clinic)
  for (const cr of clinicRoles) {
    // If clinicId is specified, check only that clinic
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }

    const moduleAccess = cr.moduleAccess?.find((ma: any) => ma.module === 'Operations');
    if (moduleAccess && moduleAccess.permissions.includes(permission)) {
      return true;
    }
  }

  return false;
};

const nowIso = (): string => new Date().toISOString();

const computeScheduleTime = (frequency?: string, time?: string): string => {
  const freq = String(frequency || '').trim();
  const t = String(time || '').trim();
  if (!freq && !t) return '';
  if (!freq) return t;
  if (!t) return freq;
  return `${freq} @ ${t}`;
};

const safeParseJson = (str: any): Record<string, any> => {
  try { return typeof str === 'string' ? JSON.parse(str) : (str ?? {}); } catch { return {}; }
};

const normalizeSchedulePayload = (payload: Record<string, any>, { isCreate = false }: { isCreate?: boolean } = {}) => {
  const input = payload || {};
  const id = isCreate ? (input.id || randomUUID()) : input.id;

  let normalizedClinicIds: string[] = [];
  if (Array.isArray(input.clinicIds)) {
    normalizedClinicIds = input.clinicIds;
  } else if (typeof input.clinicIds === 'string' && input.clinicIds.trim() !== '') {
    const s = input.clinicIds.trim();
    if (s.startsWith('[')) {
      try { normalizedClinicIds = JSON.parse(s); } catch { normalizedClinicIds = []; }
    } else {
      normalizedClinicIds = s.split(',').map((x: string) => x.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(normalizedClinicIds) || normalizedClinicIds.length === 0) {
    if (input.clinicId) normalizedClinicIds = [input.clinicId];
  }

  const schedule: any = {
    id,
    clinicId: input.clinicId ?? input.clinic_id ?? (normalizedClinicIds[0] || ''),
    clinicIds: normalizedClinicIds,
    name: input.name ?? input.scheduleName ?? '',
    date: input.date ?? '',
    startDate: input.startDate ?? input.start_date ?? '',
    endDate: input.endDate ?? input.end_date ?? '',
    frequency: input.frequency ?? 'daily',
    time: input.time ?? '',
    queryTemplate: input.queryTemplate ?? input.query_template ?? '',
    // CSV-based recipients (replaces queryTemplate for email schedules)
    csvRecipients: Array.isArray(input.csvRecipients) ? input.csvRecipients : [],
    templateMessage: input.templateMessage ?? input.template_message ?? input.template_name ?? '',
    notificationTypes: Array.isArray(input.notificationTypes) ? input.notificationTypes : [],
  };

  schedule.schedule_time = input.schedule_time || computeScheduleTime(schedule.frequency, schedule.time);
  schedule.created_at = input.created_at || (isCreate ? nowIso() : input.created_at);
  schedule.modified_at = nowIso();
  schedule.modified_by = input.modified_by || 'system';
  return schedule;
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ ok: true }) };
  }

  const path = event.resource || event.path || '';
  const method = event.httpMethod || 'GET';

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Unauthorized - Invalid token' }) };
  }

  // Check authorization based on HTTP method
  const wantsWrite = method === 'POST' || method === 'PUT' || method === 'DELETE';
  if (wantsWrite) {
    const canWrite = hasModulePermission(
      userPerms.clinicRoles,
      'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    );
    if (!canWrite) {
      return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Forbidden - Insufficient permissions' }) };
    }
  } else if (method === 'GET') {
    // For read operations, check read permission
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    );
    if (!canRead) {
      return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Forbidden - Insufficient permissions' }) };
    }
  }

  try {
    if (path === '/schedules' && method === 'GET') {
      return await handleList(event);
    }

    if (path === '/schedules/{id}') {
      const id = event.pathParameters?.id as string | undefined;
      if (method === 'GET') return await handleGet(id, event);
      if (method === 'PUT') return await handleUpdate(id, event.body || '', event);
      if (method === 'DELETE') return await handleDelete(id, event);
    }

    if (path === '/create-scheduler' && method === 'POST') {
      return await handleCreate(event.body || '', event);
    }

    if (path === '/delete-schedules' && method === 'POST') {
      return await handleBatchDelete(event.body || '', event);
    }

    if (path === '/schedules' && method === 'POST') {
      return await handleCreate(event.body || '', event);
    }

    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Not Found' }) };
  } catch (err: any) {
    const message = err?.message || 'Internal Server Error';
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ message }) };
  }
};

async function handleList(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  const items = (result.Items || []) as any[];
  items.sort((a, b) => String(b.modified_at || '').localeCompare(String(a.modified_at || '')));
  return json(200, { schedules: items }, event);
}

async function handleGet(id?: string, event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!id) return json(400, { message: 'Missing id' }, event);
  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { id } }));
  if (!result.Item) return json(404, { message: 'Not found' }, event);
  return json(200, { schedule: result.Item }, event);
}

async function handleCreate(body: string, event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = safeParseJson(body);
  const userPerms = getUserPermissions(event!);
  const schedule = normalizeSchedulePayload({
    ...payload,
    modified_by: userPerms?.email || 'system'
  }, { isCreate: true });
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: schedule }));
  return json(201, { schedule }, event);
}

async function handleUpdate(id: string | undefined, body: string, event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!id) return json(400, { message: 'Missing id' }, event);
  const payload = safeParseJson(body);
  const userPerms = getUserPermissions(event!);
  const normalized: any = normalizeSchedulePayload({
    ...payload,
    id,
    modified_by: userPerms?.email || 'system'
  }, { isCreate: false });

  const updateExpr = [
    '#clinicId = :clinicId',
    '#clinicIds = :clinicIds',
    '#name = :name',
    '#date = :date',
    '#startDate = :startDate',
    '#endDate = :endDate',
    '#frequency = :frequency',
    '#time = :time',
    '#schedule_time = :schedule_time',
    '#queryTemplate = :queryTemplate',
    '#csvRecipients = :csvRecipients',
    '#templateMessage = :templateMessage',
    '#notificationTypes = :notificationTypes',
    '#modified_at = :modified_at',
    '#modified_by = :modified_by',
  ].join(', ');

  const cmd = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { id },
    UpdateExpression: `SET ${updateExpr}`,
    ExpressionAttributeNames: {
      '#clinicId': 'clinicId',
      '#clinicIds': 'clinicIds',
      '#name': 'name',
      '#date': 'date',
      '#startDate': 'startDate',
      '#endDate': 'endDate',
      '#frequency': 'frequency',
      '#time': 'time',
      '#schedule_time': 'schedule_time',
      '#queryTemplate': 'queryTemplate',
      '#csvRecipients': 'csvRecipients',
      '#templateMessage': 'templateMessage',
      '#notificationTypes': 'notificationTypes',
      '#modified_at': 'modified_at',
      '#modified_by': 'modified_by',
    },
    ExpressionAttributeValues: {
      ':clinicId': normalized.clinicId,
      ':clinicIds': normalized.clinicIds,
      ':name': normalized.name,
      ':date': normalized.date,
      ':startDate': normalized.startDate,
      ':endDate': normalized.endDate,
      ':frequency': normalized.frequency,
      ':time': normalized.time,
      ':schedule_time': normalized.schedule_time,
      ':queryTemplate': normalized.queryTemplate,
      ':csvRecipients': normalized.csvRecipients,
      ':templateMessage': normalized.templateMessage,
      ':notificationTypes': normalized.notificationTypes,
      ':modified_at': normalized.modified_at,
      ':modified_by': normalized.modified_by,
    },
    ReturnValues: 'ALL_NEW',
  });

  const result = await docClient.send(cmd);
  return json(200, { schedule: result.Attributes }, event);
}

async function handleDelete(id?: string, event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!id) return json(400, { message: 'Missing id' }, event);
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
  return json(200, { deleted: id }, event);
}

async function handleBatchDelete(body: string, event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = safeParseJson(body);
  const ids: string[] = Array.isArray(payload.scheduleIds) ? payload.scheduleIds : [];
  if (ids.length === 0) return json(400, { message: 'No scheduleIds provided' }, event);
  for (const id of ids) {
    if (!id) continue;
    await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
  }
  return json(200, { deleted: ids }, event);
}

function json(statusCode: number, body: any, event?: APIGatewayProxyEvent): APIGatewayProxyResult {
  return { statusCode, headers: getCorsHeaders(event || {} as APIGatewayProxyEvent), body: JSON.stringify(body ?? {}) };
}



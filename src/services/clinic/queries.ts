import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { SYSTEM_MODULES } from '../../shared/types/user';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'SQL_Queries';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

/**
 * Get user's clinic roles and permissions from custom authorizer
 */
const getUserPermissions = (event: APIGatewayProxyEvent) => {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer) return null;

  try {
    const clinicRoles = JSON.parse(authorizer.clinicRoles || '[]');
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
 * Check if user has specific permission for a module at ANY clinic
 */
const hasModulePermission = (
  clinicRoles: any[],
  module: string,
  permission: 'read' | 'write' | 'put' | 'delete',
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean,
  clinicId?: string
): boolean => {
  // Admin, SuperAdmin, and Global Super Admin have all permissions for all modules
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }

  // Check if user has the permission for this module at any clinic (or specific clinic)
  for (const cr of clinicRoles) {
    // If clinicId is specified, check only that clinic
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }

    const moduleAccess = cr.moduleAccess?.find((ma: any) => ma.module === module);
    if (moduleAccess && moduleAccess.permissions.includes(permission)) {
      return true;
    }
  }

  return false;
};


export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const path = event.path || event.resource || '';

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'CORS preflight response' }) };
  }

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return {
      statusCode: 401,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized - Invalid token' }),
    };
  }

  const wantsWrite = httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'DELETE';
  if (wantsWrite && !hasModulePermission(
    userPerms.clinicRoles,
    'IT',
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have permission to modify queries in the IT module' }),
    };
  }

  // Check read permission for GET requests
  if (httpMethod === 'GET' && !hasModulePermission(
    userPerms.clinicRoles,
    'IT',
    'read',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have permission to read queries in the IT module' }),
    };
  }

  try {
    // GET all: /queries
    if ((path === '/queries' || path.endsWith('/queries')) && httpMethod === 'GET') {
      return await listQueries(event, userPerms);
    }
    // GET one: /queries/{queryName}
    if ((path.includes('/queries/') || path.endsWith('/queries/{queryName}')) && httpMethod === 'GET') {
      const queryName = event.pathParameters?.queryName || path.split('/').pop() as string;
      return await getQuery(event, userPerms, queryName);
    }
    // POST create: /queries
    if ((path === '/queries' || path.endsWith('/queries')) && httpMethod === 'POST') {
      return await createQuery(event, userPerms);
    }
    // PUT update: /queries/{queryName}
    if ((path.includes('/queries/') || path.endsWith('/queries/{queryName}')) && httpMethod === 'PUT') {
      const queryName = event.pathParameters?.queryName || path.split('/').pop() as string;
      return await updateQuery(event, userPerms, queryName);
    }
    // DELETE one: /queries/{queryName}
    if ((path.includes('/queries/') || path.endsWith('/queries/{queryName}')) && httpMethod === 'DELETE') {
      const queryName = event.pathParameters?.queryName || path.split('/').pop() as string;
      return await deleteQuery(event, userPerms, queryName);
    }

    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  } catch (error: any) {
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: error?.message || 'Internal Server Error' }) };
  }
};

async function listQueries(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const res = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Items || []) };
}

async function getQuery(event: APIGatewayProxyEvent, userPerms: any, queryName: string): Promise<APIGatewayProxyResult> {
  if (!queryName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'queryName required' }) };
  const res = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  if (!res.Item) return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Item) };
}

async function createQuery(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  const required = ['QueryName', 'QueryDescription', 'Query'];
  if (!required.every((f) => f in body)) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      QueryName: String(body.QueryName),
      QueryDescription: String(body.QueryDescription),
      Query: String(body.Query),
    },
    ConditionExpression: 'attribute_not_exists(QueryName)',
  }));
  return { statusCode: 201, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item created successfully' }) };
}

async function updateQuery(event: APIGatewayProxyEvent, userPerms: any, queryName: string): Promise<APIGatewayProxyResult> {
  if (!queryName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'queryName required' }) };
  const body = parseBody(event.body);
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { QueryName: queryName },
    UpdateExpression: 'SET QueryDescription = :desc, #q = :q',
    ExpressionAttributeNames: { '#q': 'Query' },
    ExpressionAttributeValues: {
      ':desc': body.QueryDescription,
      ':q': body.Query,
    },
  }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item updated successfully' }) };
}

async function deleteQuery(event: APIGatewayProxyEvent, userPerms: any, queryName: string): Promise<APIGatewayProxyResult> {
  if (!queryName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'queryName required' }) };
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item deleted successfully' }) };
}

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === 'string' ? JSON.parse(body) : body; } catch { return {}; }
}



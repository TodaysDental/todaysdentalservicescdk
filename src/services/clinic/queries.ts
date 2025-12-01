import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'SQL_Queries';
const MODULE_NAME = 'IT';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const path = event.path || event.resource || '';

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: getCorsHeaders(event), body: '' };
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

  const requiredPermission: PermissionType = METHOD_PERMISSIONS[httpMethod] || 'read';
  const hasAccess = hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!hasAccess) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module` }),
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

async function listQueries(event: APIGatewayProxyEvent, _userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const res = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Items || []) };
}

async function getQuery(event: APIGatewayProxyEvent, _userPerms: UserPermissions, queryName: string): Promise<APIGatewayProxyResult> {
  if (!queryName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'queryName required' }) };
  const res = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  if (!res.Item) return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Item) };
}

async function createQuery(event: APIGatewayProxyEvent, _userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
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

async function updateQuery(event: APIGatewayProxyEvent, _userPerms: UserPermissions, queryName: string): Promise<APIGatewayProxyResult> {
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

async function deleteQuery(event: APIGatewayProxyEvent, _userPerms: UserPermissions, queryName: string): Promise<APIGatewayProxyResult> {
  if (!queryName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'queryName required' }) };
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item deleted successfully' }) };
}

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === 'string' ? JSON.parse(body) : body; } catch { return {}; }
}

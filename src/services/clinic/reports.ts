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

const TABLE_NAME = process.env.TABLE_NAME || 'SQL_Reports';
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
    // GET all: /reports
    if ((path === '/reports' || path.endsWith('/reports')) && httpMethod === 'GET') {
      return await listReports(event, userPerms);
    }
    // GET one: /reports/{reportName}
    if ((path.includes('/reports/') || path.endsWith('/reports/{reportName}')) && httpMethod === 'GET') {
      const reportName = event.pathParameters?.reportName || path.split('/').pop() as string;
      return await getReport(event, userPerms, reportName);
    }
    // POST create: /reports
    if ((path === '/reports' || path.endsWith('/reports')) && httpMethod === 'POST') {
      return await createReport(event, userPerms);
    }
    // PUT update: /reports/{reportName}
    if ((path.includes('/reports/') || path.endsWith('/reports/{reportName}')) && httpMethod === 'PUT') {
      const reportName = event.pathParameters?.reportName || path.split('/').pop() as string;
      return await updateReport(event, userPerms, reportName);
    }
    // DELETE one: /reports/{reportName}
    if ((path.includes('/reports/') || path.endsWith('/reports/{reportName}')) && httpMethod === 'DELETE') {
      const reportName = event.pathParameters?.reportName || path.split('/').pop() as string;
      return await deleteReport(event, userPerms, reportName);
    }

    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  } catch (error: any) {
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: error?.message || 'Internal Server Error' }) };
  }
};

async function listReports(event: APIGatewayProxyEvent, _userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const res = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Items || []) };
}

async function getReport(event: APIGatewayProxyEvent, _userPerms: UserPermissions, reportName: string): Promise<APIGatewayProxyResult> {
  if (!reportName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'reportName required' }) };
  const res = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { ReportName: reportName } }));
  if (!res.Item) return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Item) };
}

async function createReport(event: APIGatewayProxyEvent, _userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  const required = ['ReportName', 'ReportDescription', 'Report', 'Module'];
  if (!required.every((f) => f in body)) {
    return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ReportName: String(body.ReportName),
      ReportDescription: String(body.ReportDescription),
      Report: String(body.Report),
      Module: String(body.Module),
    },
    ConditionExpression: 'attribute_not_exists(ReportName)',
  }));
  return { statusCode: 201, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item created successfully' }) };
}

async function updateReport(event: APIGatewayProxyEvent, _userPerms: UserPermissions, reportName: string): Promise<APIGatewayProxyResult> {
  if (!reportName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'reportName required' }) };
  const body = parseBody(event.body);
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { ReportName: reportName },
    UpdateExpression: 'SET ReportDescription = :desc, #r = :r, #m = :m',
    ExpressionAttributeNames: { '#r': 'Report', '#m': 'Module' },
    ExpressionAttributeValues: {
      ':desc': body.ReportDescription,
      ':r': body.Report,
      ':m': body.Module,
    },
  }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item updated successfully' }) };
}

async function deleteReport(event: APIGatewayProxyEvent, _userPerms: UserPermissions, reportName: string): Promise<APIGatewayProxyResult> {
  if (!reportName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'reportName required' }) };
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { ReportName: reportName } }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item deleted successfully' }) };
}

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === 'string' ? JSON.parse(body) : body; } catch { return {}; }
}


import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'SQL_Queries';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

const getGroupsFromClaims = (claims?: Record<string, any>): string[] => {
  if (!claims) return [];
  const raw = (claims as any)['cognito:groups'] ?? (claims as any)['cognito:groups[]'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {}
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const isWriteAuthorized = (groups: string[]): boolean => {
  if (!groups || groups.length === 0) return false;
  // Only global superadmin can write
  return groups.some((g) => g === 'GLOBAL__SUPER_ADMIN');
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const path = event.path || event.resource || '';

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'CORS preflight response' }) };
  }

  const groups = getGroupsFromClaims((event.requestContext as any)?.authorizer?.claims);
  const wantsWrite = httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'DELETE';
  if (wantsWrite && !isWriteAuthorized(groups)) {
    return { statusCode: 403, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    // GET all: /queries
    if ((path === '/queries' || path.endsWith('/queries')) && httpMethod === 'GET') {
      return await listQueries(event);
    }
    // GET one: /queries/{queryName}
    if ((path.includes('/queries/') || path.endsWith('/queries/{queryName}')) && httpMethod === 'GET') {
      const queryName = event.pathParameters?.queryName || path.split('/').pop() as string;
      return await getQuery(event, queryName);
    }
    // POST create: /queries
    if ((path === '/queries' || path.endsWith('/queries')) && httpMethod === 'POST') {
      return await createQuery(event);
    }
    // PUT update: /queries/{queryName}
    if ((path.includes('/queries/') || path.endsWith('/queries/{queryName}')) && httpMethod === 'PUT') {
      const queryName = event.pathParameters?.queryName || path.split('/').pop() as string;
      return await updateQuery(event, queryName);
    }
    // DELETE one: /queries/{queryName}
    if ((path.includes('/queries/') || path.endsWith('/queries/{queryName}')) && httpMethod === 'DELETE') {
      const queryName = event.pathParameters?.queryName || path.split('/').pop() as string;
      return await deleteQuery(event, queryName);
    }

    return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  } catch (error: any) {
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: error?.message || 'Internal Server Error' }) };
  }
};

async function listQueries(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const res = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Items || []) };
}

async function getQuery(event: APIGatewayProxyEvent, queryName: string): Promise<APIGatewayProxyResult> {
  if (!queryName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'queryName required' }) };
  const res = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  if (!res.Item) return { statusCode: 404, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'Not Found' }) };
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify(res.Item) };
}

async function createQuery(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

async function updateQuery(event: APIGatewayProxyEvent, queryName: string): Promise<APIGatewayProxyResult> {
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

async function deleteQuery(event: APIGatewayProxyEvent, queryName: string): Promise<APIGatewayProxyResult> {
  if (!queryName) return { statusCode: 400, headers: getCorsHeaders(event), body: JSON.stringify({ error: 'queryName required' }) };
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  return { statusCode: 200, headers: getCorsHeaders(event), body: JSON.stringify({ message: 'Item deleted successfully' }) };
}

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === 'string' ? JSON.parse(body) : body; } catch { return {}; }
}



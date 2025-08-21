import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.POSTCALL_TABLE || 'PostCallInsights';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({ ok: true });
  try {
    const path = event.resource || '';
    const method = event.httpMethod;
    if (path.endsWith('/postcalls') && method === 'GET') return list(event);
    if (path.endsWith('/postcalls') && method === 'POST') return create(event);
    if (path.endsWith('/postcalls/{contactId}') && method === 'GET') return get(event);
    if (path.endsWith('/postcalls/{contactId}') && method === 'PUT') return update(event);
    if (path.endsWith('/postcalls/{contactId}') && method === 'DELETE') return remove(event);
    return err(404, 'not found');
  } catch (e: any) {
    return err(500, e?.message || 'error');
  }
};

async function list(event: APIGatewayProxyEvent) {
  const limit = Math.min(500, parseInt(event.queryStringParameters?.limit || '100', 10));
  const resp = await ddb.send(new ScanCommand({ TableName: TABLE, Limit: limit }));
  return ok({ items: resp.Items || [] });
}

async function create(event: APIGatewayProxyEvent) {
  const body = parse(event.body);
  const contactId = String(body.contactId || '').trim();
  if (!contactId) return err(400, 'contactId required');
  await ddb.send(new PutCommand({ TableName: TABLE, Item: body }));
  return ok({ contactId });
}

async function get(event: APIGatewayProxyEvent) {
  const contactId = event.pathParameters?.contactId || '';
  const resp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contactId } }));
  if (!resp.Item) return err(404, 'not found');
  return ok(resp.Item);
}

async function update(event: APIGatewayProxyEvent) {
  const contactId = event.pathParameters?.contactId || '';
  const body = parse(event.body);
  const item = { ...body, contactId };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return ok({ contactId });
}

async function remove(event: APIGatewayProxyEvent) {
  const contactId = event.pathParameters?.contactId || '';
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { contactId } }));
  return ok({ contactId });
}

function parse(body: any) { try { return typeof body === 'string' ? JSON.parse(body) : (body || {}); } catch { return {}; } }

function ok(data: any): APIGatewayProxyResult { return { statusCode: 200, headers: buildCorsHeaders(), body: JSON.stringify({ success: true, ...data }) }; }
function err(code: number, message: string): APIGatewayProxyResult { return { statusCode: code, headers: buildCorsHeaders(), body: JSON.stringify({ success: false, message }) }; }



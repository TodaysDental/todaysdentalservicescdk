import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({ ok: true });
  try {
    const path = event.resource || '';
    const method = event.httpMethod;
    if (path.endsWith('/hours') && method === 'GET') return listHours(event);
    if (path.endsWith('/hours') && method === 'POST') return createHours(event);
    if (path.endsWith('/hours/{clinicId}') && method === 'GET') return getHours(event);
    if (path.endsWith('/hours/{clinicId}') && method === 'PUT') return updateHours(event);
    if (path.endsWith('/hours/{clinicId}') && method === 'DELETE') return deleteHours(event);
    return err(404, 'not found');
  } catch (e: any) {
    return err(500, e?.message || 'error');
  }
};

async function listHours(event: APIGatewayProxyEvent) {
  const resp = await ddb.send(new ScanCommand({ TableName: TABLE, Limit: 200 }));
  return ok({ items: resp.Items || [] });
}

async function createHours(event: APIGatewayProxyEvent) {
  const body = parse(event.body);
  const clinicId = String(body.clinicId || '').trim();
  if (!clinicId) return err(400, 'clinicId required');
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...body, clinicId } }));
  return ok({ clinicId });
}

async function getHours(event: APIGatewayProxyEvent) {
  const clinicId = event.pathParameters?.clinicId || '';
  const resp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { clinicId } }));
  if (!resp.Item) return err(404, 'not found');
  return ok(resp.Item);
}

async function updateHours(event: APIGatewayProxyEvent) {
  const clinicId = event.pathParameters?.clinicId || '';
  const body = parse(event.body);
  // Upsert: replace full item to keep it simple
  const item = { ...body, clinicId };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return ok({ clinicId });
}

async function deleteHours(event: APIGatewayProxyEvent) {
  const clinicId = event.pathParameters?.clinicId || '';
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { clinicId } }));
  return ok({ clinicId });
}

function parse(body: any) { try { return typeof body === 'string' ? JSON.parse(body) : (body || {}); } catch { return {}; } }

function ok(data: any): APIGatewayProxyResult { return { statusCode: 200, headers: buildCorsHeaders(), body: JSON.stringify({ success: true, ...data }) }; }
function err(code: number, message: string): APIGatewayProxyResult { return { statusCode: code, headers: buildCorsHeaders(), body: JSON.stringify({ success: false, message }) }; }



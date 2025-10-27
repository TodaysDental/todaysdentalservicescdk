import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_PRICING_TABLE || 'ClinicPricing';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({ ok: true }, event);
  try {
    const path = event.resource || '';
    const method = event.httpMethod;

    // /clinics/{clinicId}/pricing routes
    if (path.endsWith('/pricing') && method === 'GET') return getPricing(event);
    if (path.endsWith('/pricing') && method === 'POST') return createPricing(event);
    if (path.endsWith('/pricing') && method === 'PUT') return updatePricing(event);
    if (path.endsWith('/pricing') && method === 'DELETE') return deletePricing(event);

    return err(404, 'not found', event);
  } catch (e: any) {
    return err(500, e?.message || 'error', event);
  }
};

async function getPricing(event: APIGatewayProxyEvent) {
  const clinicId = event.pathParameters?.clinicId || '';
  if (!clinicId) return err(400, 'clinicId required', event);

  const resp = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'clinicId = :clinicId',
    ExpressionAttributeValues: { ':clinicId': clinicId },
    Limit: 200
  }));

  return ok({ items: resp.Items || [] }, event);
}

async function createPricing(event: APIGatewayProxyEvent) {
  const clinicId = event.pathParameters?.clinicId || '';
  const body = parse(event.body);

  if (!clinicId) return err(400, 'clinicId required', event);
  if (!body.category) return err(400, 'category required', event);

  const item = {
    clinicId,
    category: body.category,
    procedureName: body.procedureName || null,
    minPrice: typeof body.minPrice === 'number' ? body.minPrice : (typeof body.price === 'number' ? body.price : 0),
    maxPrice: typeof body.maxPrice === 'number' ? body.maxPrice : (typeof body.price === 'number' ? body.price : 0),
    description: body.description || '',
    isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return ok({ clinicId, category: item.category }, event);
}

async function updatePricing(event: APIGatewayProxyEvent) {
  const clinicId = event.pathParameters?.clinicId || '';
  const body = parse(event.body);

  if (!clinicId) return err(400, 'clinicId required', event);
  if (!body.category) return err(400, 'category required', event);

  // Check if item exists
  const existingResp = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { clinicId, category: body.category }
  }));

  if (!existingResp.Item) return err(404, 'pricing item not found', event);

  const item = {
    ...existingResp.Item,
    ...body,
    clinicId, // ensure clinicId is not overwritten
    updatedAt: new Date().toISOString()
  };

  // Handle price mapping
  if (typeof body.price === 'number') {
    item.minPrice = body.price;
    item.maxPrice = body.price;
  }

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return ok({ clinicId, category: item.category }, event);
}

async function deletePricing(event: APIGatewayProxyEvent) {
  const clinicId = event.pathParameters?.clinicId || '';
  const body = parse(event.body);

  if (!clinicId) return err(400, 'clinicId required', event);
  if (!body.category) return err(400, 'category required', event);

  await ddb.send(new DeleteCommand({
    TableName: TABLE,
    Key: { clinicId, category: body.category }
  }));

  return ok({ clinicId, category: body.category }, event);
}

function parse(body: any) { 
  try { 
    return typeof body === 'string' ? JSON.parse(body) : (body || {}); 
  } catch { 
    return {}; 
  } 
}

function ok(data: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: buildCorsHeaders({}, event.headers?.origin),
    body: JSON.stringify({ success: true, ...data })
  };
}

function err(code: number, message: string, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: code,
    headers: buildCorsHeaders({}, event.headers?.origin),
    body: JSON.stringify({ success: false, message })
  };
}

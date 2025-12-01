import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { SYSTEM_MODULES } from '../../shared/types/user';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_PRICING_TABLE || 'ClinicPricing';

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
  if (event.httpMethod === 'OPTIONS') return ok({ ok: true }, event);

  try {
    // Get user permissions from custom authorizer
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return err(401, 'Unauthorized - Invalid token', event);
    }

    const path = event.resource || '';
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;

    // Check access control for Finance module
    if (clinicId && !hasModulePermission(
      userPerms.clinicRoles,
      'Finance',
      method === 'GET' ? 'read' : 'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    )) {
      return err(403, 'You do not have permission to access pricing information for this clinic', event);
    }

    // Check general access for operations without specific clinic ID
    if (!clinicId && method !== 'GET' && !hasModulePermission(
      userPerms.clinicRoles,
      'Finance',
      'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    )) {
      return err(403, 'You do not have permission to modify pricing information', event);
    }

    // /clinics/{clinicId}/pricing routes
    if (path.endsWith('/pricing') && method === 'GET') return getPricing(event, userPerms);
    if (path.endsWith('/pricing') && method === 'POST') return createPricing(event, userPerms);
    if (path.endsWith('/pricing') && method === 'PUT') return updatePricing(event, userPerms);
    if (path.endsWith('/pricing') && method === 'DELETE') return deletePricing(event, userPerms);

    return err(404, 'not found', event);
  } catch (e: any) {
    return err(500, e?.message || 'error', event);
  }
};

async function getPricing(event: APIGatewayProxyEvent, userPerms: any) {
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

async function createPricing(event: APIGatewayProxyEvent, userPerms: any) {
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

async function updatePricing(event: APIGatewayProxyEvent, userPerms: any) {
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

async function deletePricing(event: APIGatewayProxyEvent, userPerms: any) {
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

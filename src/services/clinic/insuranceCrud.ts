import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { SYSTEM_MODULES } from '../../shared/types/user';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_INSURANCE_TABLE || 'ClinicInsurance';

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

    // Check access control for Insurance module
    if (clinicId && !hasModulePermission(
      userPerms.clinicRoles,
      'Insurance',
      method === 'GET' ? 'read' : 'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    )) {
      return err(403, 'You do not have permission to access insurance information for this clinic', event);
    }

    // Check general access for operations without specific clinic ID
    if (!clinicId && method !== 'GET' && !hasModulePermission(
      userPerms.clinicRoles,
      'Insurance',
      'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    )) {
      return err(403, 'You do not have permission to modify insurance information', event);
    }

    // /clinics/{clinicId}/insurance routes
    if (path.endsWith('/insurance') && method === 'GET') return getInsurance(event, userPerms);
    if (path.endsWith('/insurance') && method === 'POST') return createInsurance(event, userPerms);
    if (path.endsWith('/insurance') && method === 'PUT') return updateInsurance(event, userPerms);
    if (path.endsWith('/insurance') && method === 'DELETE') return deleteInsurance(event, userPerms);

    return err(404, 'not found', event);
  } catch (e: any) {
    return err(500, e?.message || 'error', event);
  }
};

async function getInsurance(event: APIGatewayProxyEvent, userPerms: any) {
  const clinicId = event.pathParameters?.clinicId || '';
  if (!clinicId) return err(400, 'clinicId required', event);
  
  const resp = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'clinicId = :clinicId',
    ExpressionAttributeValues: { ':clinicId': clinicId },
    Limit: 200
  }));
  
  // Transform the data to match frontend expectations
  const groupedByProvider = new Map<string, any>();
  
  for (const item of resp.Items || []) {
    const provider = item.insuranceProvider;
    if (!groupedByProvider.has(provider)) {
      groupedByProvider.set(provider, {
        insuranceProvider: provider,
        plans: [],
        notes: item.notes || ''
      });
    }
    
    if (item.planName) {
      groupedByProvider.get(provider)!.plans.push({
        name: item.planName,
        planName: item.planName,
        isAccepted: item.isAccepted,
        accepted: item.isAccepted,
        coverageDetails: item.coverageDetails || '',
        details: item.coverageDetails || ''
      });
    }
  }
  
  return ok({ items: Array.from(groupedByProvider.values()) }, event);
}

async function createInsurance(event: APIGatewayProxyEvent, userPerms: any) {
  const clinicId = event.pathParameters?.clinicId || '';
  const body = parse(event.body);
  
  if (!clinicId) return err(400, 'clinicId required', event);
  if (!body.insuranceProvider) return err(400, 'insuranceProvider required', event);
  
  const plans = body.plans || [];
  
  // If no plans provided but we have plan data in the root, create a single plan
  if (plans.length === 0 && (body.planName || body.isAccepted !== undefined || body.coverageDetails)) {
    plans.push({
      name: body.planName || '',
      isAccepted: typeof body.isAccepted === 'boolean' ? body.isAccepted : true,
      coverageDetails: body.coverageDetails || ''
    });
  }
  
  // Create an entry for each plan (or one entry if no plans)
  if (plans.length === 0) {
    // Create provider entry without specific plan
    const planName = '';
    const item = {
      clinicId,
      insuranceProvider_planName: `${body.insuranceProvider}#${planName}`,
      insuranceProvider: body.insuranceProvider,
      planName,
      isAccepted: true,
      coverageDetails: '',
      notes: body.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  } else {
    // Create entry for each plan
    for (const plan of plans) {
      const planName = plan.name || plan.planName || '';
      const item = {
        clinicId,
        insuranceProvider_planName: `${body.insuranceProvider}#${planName}`,
        insuranceProvider: body.insuranceProvider,
        planName,
        isAccepted: typeof plan.isAccepted === 'boolean' ? plan.isAccepted : 
                   (typeof plan.accepted === 'boolean' ? plan.accepted : true),
        coverageDetails: plan.coverageDetails || plan.details || '',
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    }
  }
  
  return ok({ clinicId, insuranceProvider: body.insuranceProvider }, event);
}

async function updateInsurance(event: APIGatewayProxyEvent, userPerms: any) {
  const clinicId = event.pathParameters?.clinicId || '';
  const body = parse(event.body);
  
  if (!clinicId) return err(400, 'clinicId required', event);
  if (!body.insuranceProvider) return err(400, 'insuranceProvider required', event);
  
  // Delete existing entries for this provider
  await deleteInsuranceProvider(clinicId, body.insuranceProvider);
  
  // Create new entries
  const plans = body.plans || [];
  
  if (plans.length === 0 && (body.planName || body.isAccepted !== undefined || body.coverageDetails)) {
    plans.push({
      name: body.planName || '',
      isAccepted: typeof body.isAccepted === 'boolean' ? body.isAccepted : true,
      coverageDetails: body.coverageDetails || ''
    });
  }
  
  if (plans.length === 0) {
    const planName = '';
    const item = {
      clinicId,
      insuranceProvider_planName: `${body.insuranceProvider}#${planName}`,
      insuranceProvider: body.insuranceProvider,
      planName,
      isAccepted: true,
      coverageDetails: '',
      notes: body.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  } else {
    for (const plan of plans) {
      const planName = plan.name || plan.planName || '';
      const item = {
        clinicId,
        insuranceProvider_planName: `${body.insuranceProvider}#${planName}`,
        insuranceProvider: body.insuranceProvider,
        planName,
        isAccepted: typeof plan.isAccepted === 'boolean' ? plan.isAccepted : 
                   (typeof plan.accepted === 'boolean' ? plan.accepted : true),
        coverageDetails: plan.coverageDetails || plan.details || '',
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    }
  }
  
  return ok({ clinicId, insuranceProvider: body.insuranceProvider }, event);
}

async function deleteInsurance(event: APIGatewayProxyEvent, userPerms: any) {
  const clinicId = event.pathParameters?.clinicId || '';
  const body = parse(event.body);
  
  if (!clinicId) return err(400, 'clinicId required', event);
  if (!body.insuranceProvider) return err(400, 'insuranceProvider required', event);
  
  await deleteInsuranceProvider(clinicId, body.insuranceProvider);
  
  return ok({ clinicId, insuranceProvider: body.insuranceProvider }, event);
}

async function deleteInsuranceProvider(clinicId: string, insuranceProvider: string) {
  // Get all entries for this provider
  const resp = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'clinicId = :clinicId',
    FilterExpression: 'insuranceProvider = :provider',
    ExpressionAttributeValues: { 
      ':clinicId': clinicId,
      ':provider': insuranceProvider
    }
  }));
  
  // Delete each entry
  for (const item of resp.Items || []) {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { 
        clinicId: item.clinicId, 
        insuranceProvider_planName: item.insuranceProvider_planName
      }
    }));
  }
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

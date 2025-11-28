import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { SYSTEM_MODULES } from '../../shared/types/user';

const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
const TABLE_PREFIX = process.env.TABLE_PREFIX || 'RequestCallBacks_';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://todaysdentalinsights.com').split(',');
const DEFAULT_TABLE = (process.env.DEFAULT_TABLE || 'todaysdentalinsights-callback-DefaultRequests').trim();

const dynamo = new DynamoDBClient({ region: REGION });

// Callback interface with module categorization
interface CallbackRequest {
  RequestID: string;
  name: string;
  phone: string;
  email?: string;
  message?: string;
  module: string; // HR, Accounting, Operations, Finance, Marketing, Insurance, IT
  clinicId: string;
  calledBack: 'YES' | 'NO';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  source: string;
}

function getCorsHeaders(origin?: string) {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : 'https://todaysdentalinsights.com';
  return buildCorsHeaders({ allowOrigin, allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT'] });
}

function getTableName(clinicId: string): string {
  return `${TABLE_PREFIX}${clinicId}`;
}

/**
 * Get user's clinic roles and permissions from custom authorizer
 */
function getUserPermissions(event: APIGatewayProxyEvent) {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer) return null;

  try {
    const clinicRoles = JSON.parse(authorizer.clinicRoles || '[]');
    const isSuperAdmin = authorizer.isSuperAdmin === 'true';
    const isGlobalSuperAdmin = authorizer.isGlobalSuperAdmin === 'true';
    const email = authorizer.email || '';
    const givenName = authorizer.givenName || '';

    return {
      email,
      givenName,
      clinicRoles,
      isSuperAdmin,
      isGlobalSuperAdmin,
    };
  } catch (err) {
    console.error('Failed to parse user permissions:', err);
    return null;
  }
}

/**
 * Check if user has admin role (Admin, SuperAdmin, or Global Super Admin)
 */
function isAdminUser(
  clinicRoles: any[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): boolean {
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
}

/**
 * Check if user has specific permission for a module at a clinic
 */
function hasModulePermission(
  clinicRoles: any[],
  clinicId: string,
  module: string,
  permission: 'read' | 'write' | 'put' | 'delete',
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): boolean {
  // Admin, SuperAdmin, and Global Super Admin have all permissions
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }

  // Check if user has the permission for this module at this clinic
  const clinicAccess = clinicRoles.find((cr: any) => cr.clinicId === clinicId);
  if (!clinicAccess) return false;

  const moduleAccess = clinicAccess.moduleAccess?.find((ma: any) => ma.module === module);
  if (!moduleAccess) return false;

  return moduleAccess.permissions.includes(permission);
}

/**
 * Get all clinic IDs user has access to
 */
function getAllowedClinicIds(
  clinicRoles: any[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): Set<string> {
  // Super admins have access to all clinics
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return new Set<string>(['*']);
  }

  // Extract clinic IDs from clinic roles
  const clinicIds = clinicRoles.map((cr: any) => cr.clinicId);
  return new Set<string>(clinicIds);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod || 'GET';
  const origin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = getCorsHeaders(origin);

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Handle admin endpoints
  const path = event.path || '';
  if (path.includes('/admin/callbacks')) {
    return await handleAdminEndpoints(event, corsHeaders);
  }

  const pathParams = event.pathParameters || {};
  const clinicIdRaw = pathParams['clinicId'] || pathParams['clinicid'];
  const clinicId = (clinicIdRaw ?? '').toString().trim();
  if (!clinicId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'clinicId is required in path' }) };
  }

  // POST (create) doesn't require authentication - public endpoint for website forms
  const requiresAuth = method !== 'POST';
  
  let userPerms: any = null;
  if (requiresAuth) {
    userPerms = getUserPermissions(event);
    if (!userPerms) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // Check if user has access to this clinic
    const allowedClinics = getAllowedClinicIds(
      userPerms.clinicRoles,
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    );

    if (!(allowedClinics.has('*') || allowedClinics.has(clinicId))) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ 
        error: 'Forbidden: no access to this clinic',
      }) };
    }

    // For GET and PUT, we'll check permissions when we know the callback's module
    // For now, just verify clinic access
  }

  const tableName = getTableName(clinicId);

  try {
    if (method === 'GET') {
      return await handleGet(tableName, corsHeaders, clinicId, userPerms);
    }
    if (method === 'POST') {
      return await handlePost(event, tableName, clinicId, corsHeaders);
    }
    if (method === 'PUT') {
      return await handlePut(event, tableName, corsHeaders, clinicId, userPerms);
    }
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ message: 'Method Not Allowed. Supported methods: GET, POST, PUT.' }) };
  } catch (err) {
    console.error('Handler error', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};



async function handleGet(tableName: string, headers: Record<string, string>, clinicId: string, userPerms: any): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamo.send(new ScanCommand({ TableName: tableName }));
    const allContacts = (result.Items || []).map((item) => unmarshall(item as any));
    
    // Filter callbacks based on user's module permissions
    const filteredContacts = filterCallbacksByModuleAccess(
      allContacts,
      userPerms.clinicRoles,
      clinicId,
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    );
    
    // Group by module
    const callbacksByModule = groupCallbacksByModule(filteredContacts);
    
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({
        callbacks: filteredContacts,
        callbacksByModule,
        totalCount: filteredContacts.length,
      })
    };
  } catch (error: any) {
    // Fallback to default table with clinic filtering if clinic-specific table doesn't exist
    if (error?.name === 'ResourceNotFoundException' && DEFAULT_TABLE) {
      try {
        const result = await dynamo.send(new ScanCommand({
          TableName: DEFAULT_TABLE,
          FilterExpression: 'clinicId = :clinicId',
          ExpressionAttributeValues: { ':clinicId': { S: clinicId } }
        }));
        const allContacts = (result.Items || []).map((item) => unmarshall(item as any));
        
        const filteredContacts = filterCallbacksByModuleAccess(
          allContacts,
          userPerms.clinicRoles,
          clinicId,
          userPerms.isSuperAdmin,
          userPerms.isGlobalSuperAdmin
        );
        
        const callbacksByModule = groupCallbacksByModule(filteredContacts);
        
        return { 
          statusCode: 200, 
          headers, 
          body: JSON.stringify({
            callbacks: filteredContacts,
            callbacksByModule,
            totalCount: filteredContacts.length,
          })
        };
      } catch (innerErr) {
        console.error('Error accessing default table:', innerErr);
        return { 
          statusCode: 200, 
          headers, 
          body: JSON.stringify({
            callbacks: [],
            callbacksByModule: {},
            totalCount: 0,
          })
        };
      }
    }
    throw error;
  }
}

async function handlePut(event: APIGatewayProxyEvent, tableName: string, headers: Record<string, string>, clinicId: string, userPerms: any): Promise<APIGatewayProxyResult> {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  const id = String(body?.RequestID || body?.id || '').trim();
  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'RequestID is required for updates.' }) };
  }
  
  // Validate module if provided in update
  const module = body?.module;
  if (module && !SYSTEM_MODULES.includes(module as any)) {
    return { statusCode: 400, headers, body: JSON.stringify({ 
      error: `Invalid module: ${module}`,
      availableModules: Array.from(SYSTEM_MODULES),
    }) };
  }
  
  const name = body?.name;
  const phone = body?.phone;
  const email = typeof body?.email === 'string' ? body.email : undefined;
  const message = typeof body?.message === 'string' ? body.message : undefined;
  const notes = typeof body?.notes === 'string' ? body.notes : undefined;
  const calledBackRaw = body?.calledBack ?? body?.called_back ?? body?.callback ?? body?.called;
  
  // Get user info from custom authorizer
  const updatedBy = userPerms?.givenName || userPerms?.email || 'system';
  
  // Check if user has permission to update callbacks in the specified module
  if (module) {
    if (!hasModulePermission(userPerms.clinicRoles, clinicId, module, 'put', userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
      return { statusCode: 403, headers, body: JSON.stringify({ 
        error: `You do not have permission to update callbacks in the ${module} module`,
      }) };
    }
  }

  function normalizeCalledBack(v: any): 'YES' | 'NO' | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'boolean') return v ? 'YES' : 'NO';
    const s = String(v).trim().toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(s)) return 'YES';
    if (['no', 'n', 'false', '0'].includes(s)) return 'NO';
    return undefined;
  }
  const calledBack = normalizeCalledBack(calledBackRaw);

  const exprParts: string[] = [];
  const exprValues: Record<string, any> = { ':updatedAt': { S: new Date().toISOString() } };
  const exprNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  if (typeof name === 'string') { exprParts.push('#name = :name'); exprValues[':name'] = { S: name }; exprNames['#name'] = 'name'; }
  if (typeof phone === 'string') { exprParts.push('#phone = :phone'); exprValues[':phone'] = { S: phone }; exprNames['#phone'] = 'phone'; }
  if (typeof email === 'string') { exprParts.push('#email = :email'); exprValues[':email'] = { S: email }; exprNames['#email'] = 'email'; }
  if (typeof message === 'string') { exprParts.push('#message = :message'); exprValues[':message'] = { S: message }; exprNames['#message'] = 'message'; }
  if (typeof notes === 'string') { exprParts.push('#notes = :notes'); exprValues[':notes'] = { S: notes }; exprNames['#notes'] = 'notes'; }
  if (typeof module === 'string') { exprParts.push('#module = :module'); exprValues[':module'] = { S: module }; exprNames['#module'] = 'module'; }
  if (calledBack) { exprParts.push('#calledBack = :calledBack'); exprValues[':calledBack'] = { S: calledBack }; exprNames['#calledBack'] = 'calledBack'; }
  if (updatedBy) { exprParts.push('#updatedBy = :updatedBy'); exprValues[':updatedBy'] = { S: updatedBy }; exprNames['#updatedBy'] = 'updatedBy'; }
  exprParts.push('#updatedAt = :updatedAt');

  if (exprParts.length === 1) { // only updatedAt present
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nothing to update. Provide calledBack, notes, name, phone, email, or message.' }) };
  }

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ RequestID: id }),
      UpdateExpression: 'SET ' + exprParts.join(', '),
      ExpressionAttributeValues: exprValues,
      ExpressionAttributeNames: exprNames,
      ReturnValues: 'ALL_NEW',
    }));
  } catch (error: any) {
    // Fallback to default table if clinic-specific table doesn't exist
    if (error?.name === 'ResourceNotFoundException' && DEFAULT_TABLE) {
      const updateExpressionWithClinicCheck = 'SET ' + exprParts.join(', ');
      const valuesWithClinicCheck = { ...exprValues, ':clinicIdCheck': { S: clinicId } };
      await dynamo.send(new UpdateItemCommand({
        TableName: DEFAULT_TABLE,
        Key: marshall({ RequestID: id }),
        UpdateExpression: updateExpressionWithClinicCheck,
        ExpressionAttributeValues: valuesWithClinicCheck,
        ExpressionAttributeNames: exprNames,
        ReturnValues: 'ALL_NEW',
        ConditionExpression: 'clinicId = :clinicIdCheck'
      }));
    } else {
      throw error;
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ message: 'Updated' }) };
}

async function handlePost(event: APIGatewayProxyEvent, tableName: string, clinicId: string, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  const name = String(body?.name || '').trim();
  const phone = String(body?.phone || '').trim();
  const email = String(body?.email || '').trim();
  const message = String(body?.message || '').trim();
  const module = String(body?.module || 'Operations').trim(); // Default to Operations

  if (!name || !phone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Both name and phone are required.' }) };
  }

  // Validate module if provided
  if (module && !SYSTEM_MODULES.includes(module as any)) {
    return { statusCode: 400, headers, body: JSON.stringify({ 
      error: `Invalid module: ${module}`,
      availableModules: Array.from(SYSTEM_MODULES),
    }) };
  }

  // Validate phone number (basic validation)
  const phoneRegex = /^[\+]?[1-9][\d]{3,14}$/;
  if (!phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''))) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid phone number format.' }) };
  }

  // Validate email format if provided
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email format.' }) };
    }
  }

  const requestId = uuidv4();
  const now = new Date().toISOString();

  const newCallback: Record<string, any> = {
    RequestID: requestId,
    name,
    phone,
    clinicId,
    module, // Module categorization
    calledBack: 'NO', // Default status
    createdAt: now,
    updatedAt: now,
    source: String(body?.source || 'website').trim(), // Track where the request came from
  };

  // Only add email and message if they are not empty
  if (email) {
    newCallback.email = email;
  }
  if (message) {
    newCallback.message = message;
  }

  try {
    await dynamo.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall(newCallback),
      ConditionExpression: 'attribute_not_exists(RequestID)',
    }));
  } catch (error: any) {
    console.error('PutItem error:', error?.name, error?.message, error);
    // Fallback to default table if clinic-specific table doesn't exist or any error related to table not found
    const notFound = error?.name === 'ResourceNotFoundException' ||
      (error?.message && error.message.includes('Requested resource not found'));
    if (notFound && DEFAULT_TABLE) {
      try {
        await dynamo.send(new PutItemCommand({
          TableName: DEFAULT_TABLE,
          Item: marshall(newCallback),
        }));
      } catch (fallbackError: any) {
        console.error('Fallback PutItem error:', fallbackError?.name, fallbackError?.message, fallbackError);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error (fallback failed)' }) };
      }
    } else if (error?.name === 'ConditionalCheckFailedException') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Callback request with this ID already exists.' }) };
    } else {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: error?.message || String(error) }) };
    }
  }

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify({
      message: 'Callback request created successfully',
      contact: newCallback
    })
  };
}

async function handleAdminEndpoints(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod || 'GET';
  const path = event.path || '';

  // Verify admin access using custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Check if user is admin
  const isAdmin = isAdminUser(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  if (!isAdmin) {
    return { statusCode: 403, headers, body: JSON.stringify({ 
      error: 'Admin access required',
    }) };
  }

  try {
    if (path.includes('/admin/callbacks/bulk') && method === 'POST') {
      return await handleBulkOperations(event, headers);
    }

    if (path.includes('/admin/callbacks') && method === 'GET') {
      return await handleAdminList(event, headers);
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Admin endpoint not found' }) };
  } catch (error) {
    console.error('Admin endpoint error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleAdminList(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters || {};
  const limit = parseInt(String(queryParams.limit || '50'), 10);
  const clinicId = String(queryParams.clinicId || '').trim();

  // If specific clinic requested, scan that table
  if (clinicId) {
    const tableName = getTableName(clinicId);
    try {
      const result = await dynamo.send(new ScanCommand({
        TableName: tableName,
        Limit: Math.min(limit, 100),
      }));
      const contacts = (result.Items || []).map((item) => unmarshall(item as any));
      return { statusCode: 200, headers, body: JSON.stringify({ contacts, clinicId, count: contacts.length }) };
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        return { statusCode: 200, headers, body: JSON.stringify({ contacts: [], clinicId, count: 0 }) };
      }
      throw error;
    }
  }

  // TODO: Implement cross-clinic aggregation if needed
  return { statusCode: 200, headers, body: JSON.stringify({
    message: 'Use ?clinicId=<id> parameter to list callbacks for a specific clinic',
    availableEndpoints: [
      'GET /admin/callbacks?clinicId=<id>',
      'POST /admin/callbacks/bulk'
    ]
  }) };
}

async function handleBulkOperations(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  const operation = String(body?.operation || '').trim();
  const clinicId = String(body?.clinicId || '').trim();
  const requestIds = Array.isArray(body?.requestIds) ? body.requestIds : [];

  if (!operation || !clinicId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'operation and clinicId are required' }) };
  }

  const tableName = getTableName(clinicId);

  try {
    if (operation === 'markCalled') {
      return await bulkMarkCalled(tableName, requestIds, headers);
    }

    if (operation === 'delete') {
      return await bulkDelete(tableName, requestIds, headers);
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported operation. Use: markCalled, delete' }) };
  } catch (error) {
    console.error('Bulk operation error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Bulk operation failed' }) };
  }
}

async function bulkMarkCalled(tableName: string, requestIds: string[], headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  // Check if table exists first, fallback to default table if needed
  let effectiveTableName = tableName;
  try {
    await dynamo.send(new ScanCommand({ TableName: tableName, Limit: 1 }));
  } catch (error: any) {
    if (error?.name === 'ResourceNotFoundException' && DEFAULT_TABLE) {
      effectiveTableName = DEFAULT_TABLE;
    } else if (error?.name === 'ResourceNotFoundException') {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Clinic callback table does not exist' }) };
    } else {
      throw error;
    }
  }

  const updatePromises = requestIds.map(async (id) => {
    try {
      await dynamo.send(new UpdateItemCommand({
        TableName: effectiveTableName,
        Key: marshall({ RequestID: id }),
        UpdateExpression: 'SET calledBack = :status, updatedAt = :updatedAt',
        ExpressionAttributeValues: marshall({
          ':status': 'YES',
          ':updatedAt': new Date().toISOString(),
        }),
      }));
      return { id, status: 'success' };
    } catch (error) {
      return { id, status: 'error', error: String(error) };
    }
  });

  const results = await Promise.all(updatePromises);
  const successful = results.filter(r => r.status === 'success').length;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      message: `Bulk update completed: ${successful}/${requestIds.length} successful`,
      results
    })
  };
}

async function bulkDelete(tableName: string, requestIds: string[], headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  // Note: Implement delete functionality if needed
  return { statusCode: 501, headers, body: JSON.stringify({ error: 'Bulk delete not implemented yet' }) };
}

/**
 * Filter callbacks based on user's module access
 */
function filterCallbacksByModuleAccess(
  callbacks: any[],
  clinicRoles: any[],
  clinicId: string,
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): any[] {
  // Admins see all callbacks
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return callbacks;
  }

  // Get clinic access
  const clinicAccess = clinicRoles.find((cr: any) => cr.clinicId === clinicId);
  if (!clinicAccess) return [];

  // Get accessible modules (those with at least read permission)
  const accessibleModules = new Set<string>();
  if (clinicAccess.moduleAccess) {
    for (const ma of clinicAccess.moduleAccess) {
      if (ma.permissions.includes('read')) {
        accessibleModules.add(ma.module);
      }
    }
  }

  // Filter callbacks to only show those in accessible modules
  return callbacks.filter((callback: any) => {
    // If callback has no module, treat as Operations (legacy)
    const callbackModule = callback.module || 'Operations';
    return accessibleModules.has(callbackModule);
  });
}

/**
 * Group callbacks by module
 */
function groupCallbacksByModule(callbacks: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};
  
  for (const callback of callbacks) {
    const module = callback.module || 'Operations'; // Default to Operations for legacy
    if (!grouped[module]) {
      grouped[module] = [];
    }
    grouped[module].push(callback);
  }
  
  return grouped;
}
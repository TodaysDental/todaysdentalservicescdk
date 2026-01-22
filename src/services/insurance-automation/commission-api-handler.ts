/**
 * Commission API Handler
 * 
 * REST API endpoints for the Insurance Automation module:
 * - GET /commissions - Get commissions for current user
 * - GET /commissions/{userId} - Get commissions for a specific user
 * - GET /commissions/clinic/{clinicId} - Get all commissions for a clinic
 * - GET /config/{clinicId} - Get feature toggle status
 * - PUT /config/{clinicId} - Update feature toggles
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  QueryCommand, 
  GetCommand, 
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders, ALLOWED_ORIGINS_LIST } from '../../shared/utils/cors';
import {
  CommissionTransaction,
  CommissionSummary,
  ClinicAutomationConfig,
  GetCommissionsResponse,
  COMMISSION_RATES,
} from './types';

// DynamoDB setup
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

// Environment variables
const COMMISSIONS_TABLE = process.env.COMMISSIONS_TABLE || '';
const CONFIG_TABLE = process.env.CONFIG_TABLE || '';
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || '';
const STAFF_CLINIC_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE || '';

// CORS helper
function getCorsHeaders(event: APIGatewayProxyEvent) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const allowOrigin = origin && ALLOWED_ORIGINS_LIST.includes(origin) ? origin : 'https://todaysdentalinsights.com';
  return buildCorsHeaders({ allowOrigin, allowMethods: ['OPTIONS', 'GET', 'PUT', 'POST'] }, origin);
}

// Roles that can view all commissions (not just their own)
const ADMIN_ROLES = ['Admin', 'SuperAdmin', 'Global Super Admin', 'GlobalSuperAdmin'];

// User info from JWT token
interface UserInfo {
  userId: string;
  userName: string;
  role: string;
  isAdmin: boolean;
  email?: string;
}

function parseBool(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

function extractBearerToken(event: APIGatewayProxyEvent): string | null {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
  return (match ? match[1] : authHeader).trim() || null;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function resolveOpenDentalUserForClinic(email: string, clinicId: string): Promise<{ userId: string; userName?: string } | null> {
  if (!STAFF_CLINIC_INFO_TABLE) return null;
  const safeEmail = email.trim().toLowerCase();
  if (!safeEmail || !clinicId) return null;

  const result = await doc.send(new GetCommand({
    TableName: STAFF_CLINIC_INFO_TABLE,
    Key: { email: safeEmail, clinicId },
  }));

  const item: any = result.Item;
  const userNum = item?.UserNum ?? item?.userNum;
  const userName = item?.UserName ?? item?.userName;
  if (userNum == null || userNum === '') return null;
  return { userId: String(userNum), userName: typeof userName === 'string' ? userName : undefined };
}

// Parse authorizer context + (fallback) JWT to get user info
function parseUserFromToken(event: APIGatewayProxyEvent): UserInfo | null {
  try {
    const authContext: any = event.requestContext?.authorizer || {};

    // Our shared authorizer provides: email, givenName, familyName, clinicRoles, isSuperAdmin, isGlobalSuperAdmin
    const token = extractBearerToken(event);
    const jwtPayload = token ? decodeJwtPayload(token) : null;

    const email =
      authContext.email ||
      authContext.principalId ||
      jwtPayload?.email ||
      jwtPayload?.sub ||
      '';

    if (!email || typeof email !== 'string') return null;

    const givenName = (authContext.givenName || jwtPayload?.givenName || '').toString();
    const familyName = (authContext.familyName || jwtPayload?.familyName || '').toString();
    const fullName = `${givenName} ${familyName}`.trim();

    const isSuperAdmin = parseBool(authContext.isSuperAdmin) || parseBool(jwtPayload?.isSuperAdmin);
    const isGlobalSuperAdmin = parseBool(authContext.isGlobalSuperAdmin) || parseBool(jwtPayload?.isGlobalSuperAdmin);

    const role =
      (isGlobalSuperAdmin ? 'Global Super Admin' : isSuperAdmin ? 'SuperAdmin' : '') ||
      (authContext.role || authContext.userRole || jwtPayload?.role || 'User');

    const isAdmin = isGlobalSuperAdmin || isSuperAdmin || ADMIN_ROLES.includes(role);

    return {
      // IMPORTANT: Insurance commissions are keyed by OpenDental UserNum.
      // We still treat email as the authenticated identity, and map to UserNum when clinicId is provided.
      userId: email,
      email,
      userName: fullName || email,
      role,
      isAdmin,
    };
  } catch {
    return null;
  }
}

function normalizeDateStart(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  // If caller already provided a time component, keep it.
  if (dateStr.includes('T')) return dateStr;
  return `${dateStr}T00:00:00.000Z`;
}

function normalizeDateEnd(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  if (dateStr.includes('T')) return dateStr;
  return `${dateStr}T23:59:59.999Z`;
}

// Check if user can view another user's commissions
function canViewOtherUserCommissions(requestingUser: UserInfo, targetUserId: string): boolean {
  // Admins can view anyone's commissions
  if (requestingUser.isAdmin) {
    return true;
  }
  // Non-admins can only view their own
  return requestingUser.userId === targetUserId;
}

// Check if user can view clinic-wide commissions
function canViewClinicCommissions(user: UserInfo): boolean {
  // Only admins can view all clinic commissions
  return user.isAdmin;
}

// Check if user can modify config (feature toggles)
function canModifyConfig(user: UserInfo): boolean {
  // Only admins can modify config
  return user.isAdmin;
}

// Get commissions for a user
async function getCommissionsForUser(
  userId: string,
  clinicId?: string,
  startDate?: string,
  endDate?: string,
  limit = 100,
  nextToken?: string
): Promise<GetCommissionsResponse> {
  const startIso = normalizeDateStart(startDate);
  const endIso = normalizeDateEnd(endDate);

  const params: any = {
    TableName: COMMISSIONS_TABLE,
    IndexName: 'userId-index',
    KeyConditionExpression: startIso && endIso
      ? 'userId = :userId AND createdAt BETWEEN :startDate AND :endDate'
      : 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  };

  // Add date range filter if provided
  if (startIso && endIso) {
    params.ExpressionAttributeValues[':startDate'] = startIso;
    params.ExpressionAttributeValues[':endDate'] = endIso;
  }

  // Add clinic filter if provided
  if (clinicId) {
    params.FilterExpression = params.FilterExpression
      ? `${params.FilterExpression} AND clinicId = :clinicId`
      : 'clinicId = :clinicId';
    params.ExpressionAttributeValues[':clinicId'] = clinicId;
  }

  if (nextToken) {
    params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
  }

  const result = await doc.send(new QueryCommand(params));
  const transactions = (result.Items || []) as CommissionTransaction[];

  // Calculate summary
  const summary = calculateSummary(transactions, userId);

  return {
    transactions,
    summary,
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

// Get commissions for a clinic
async function getCommissionsForClinic(
  clinicId: string,
  startDate?: string,
  endDate?: string,
  limit = 100,
  nextToken?: string
): Promise<GetCommissionsResponse> {
  const startIso = normalizeDateStart(startDate);
  const endIso = normalizeDateEnd(endDate);

  const params: any = {
    TableName: COMMISSIONS_TABLE,
    IndexName: 'clinicId-index',
    KeyConditionExpression: startIso && endIso
      ? 'clinicId = :clinicId AND createdAt BETWEEN :startDate AND :endDate'
      : 'clinicId = :clinicId',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
    },
    Limit: limit,
    ScanIndexForward: false,
  };

  if (startIso && endIso) {
    params.ExpressionAttributeValues[':startDate'] = startIso;
    params.ExpressionAttributeValues[':endDate'] = endIso;
  }

  if (nextToken) {
    params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
  }

  const result = await doc.send(new QueryCommand(params));
  const transactions = (result.Items || []) as CommissionTransaction[];

  return {
    transactions,
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

// Calculate commission summary
function calculateSummary(transactions: CommissionTransaction[], userId: string): CommissionSummary {
  const summary: CommissionSummary = {
    userId,
    userName: transactions[0]?.userName || 'Unknown',
    clinicId: transactions[0]?.clinicId || '',
    period: new Date().toISOString().slice(0, 7), // Current month
    createPlanCount: 0,
    verificationCount: 0,
    updatingPlanCount: 0,
    fullBenefitsCount: 0,
    createPlanEarnings: 0,
    verificationEarnings: 0,
    updatingPlanEarnings: 0,
    fullBenefitsEarnings: 0,
    totalDeductions: 0,
    deductionCount: 0,
    grossEarnings: 0,
    netEarnings: 0,
  };

  for (const tx of transactions) {
    if (tx.transactionType === 'CREDIT') {
      switch (tx.serviceType) {
        case 'CREATE_INSURANCE_PLAN':
          summary.createPlanCount++;
          summary.createPlanEarnings += tx.amount;
          break;
        case 'VERIFICATION':
          summary.verificationCount++;
          summary.verificationEarnings += tx.amount;
          break;
        case 'UPDATING_PLAN':
          summary.updatingPlanCount++;
          summary.updatingPlanEarnings += tx.amount;
          break;
        case 'FULL_BENEFITS':
          summary.fullBenefitsCount++;
          summary.fullBenefitsEarnings += tx.amount;
          break;
      }
      summary.grossEarnings += tx.amount;
    } else {
      summary.totalDeductions += Math.abs(tx.amount);
      summary.deductionCount++;
    }
  }

  summary.netEarnings = summary.grossEarnings - summary.totalDeductions;
  return summary;
}

// Get config for a clinic
async function getClinicConfig(clinicId: string): Promise<ClinicAutomationConfig | null> {
  const result = await doc.send(new GetCommand({
    TableName: CONFIG_TABLE,
    Key: { clinicId },
  }));

  if (result.Item) {
    return result.Item as ClinicAutomationConfig;
  }

  // Return default config if not found
  return {
    clinicId,
    insuranceAuditEnabled: false,  // Default OFF
    noteCopyingEnabled: false,     // Default OFF
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
}

// Update config for a clinic
async function updateClinicConfig(
  clinicId: string,
  updates: { insuranceAuditEnabled?: boolean; noteCopyingEnabled?: boolean },
  updatedBy: string
): Promise<ClinicAutomationConfig> {
  const now = new Date().toISOString();
  
  // Get existing config or create default
  const existing = await getClinicConfig(clinicId);
  
  const updatedConfig: ClinicAutomationConfig = {
    clinicId,
    insuranceAuditEnabled: updates.insuranceAuditEnabled ?? existing?.insuranceAuditEnabled ?? false,
    noteCopyingEnabled: updates.noteCopyingEnabled ?? existing?.noteCopyingEnabled ?? false,
    updatedAt: now,
    updatedBy,
  };

  await doc.send(new PutCommand({
    TableName: CONFIG_TABLE,
    Item: updatedConfig,
  }));

  // Log the config update
  await logConfigUpdate(clinicId, updatedBy, updates);

  return updatedConfig;
}

// Log config update to audit logs
async function logConfigUpdate(
  clinicId: string,
  userId: string,
  updates: Record<string, any>
): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();
  const actionId = uuidv4();

  await doc.send(new PutCommand({
    TableName: AUDIT_LOGS_TABLE,
    Item: {
      pk: `${clinicId}#${dateStr}`,
      sk: `${timestamp}#${actionId}`,
      actionId,
      clinicId,
      actionType: 'CONFIG_UPDATED',
      userId,
      userName: 'API User',
      details: updates,
      timestamp,
      ttl: Math.floor(now.getTime() / 1000) + (90 * 24 * 60 * 60), // 90 days
    },
  }));
}

// Main handler
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = getCorsHeaders(event);

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  console.log('Insurance Commission API - Request:', {
    method: event.httpMethod,
    resource: event.resource,
    path: event.path,
    requestContextPath: event.requestContext?.path,
    stage: event.requestContext?.stage,
    pathParams: event.pathParameters,
    queryParams: event.queryStringParameters,
  });

  try {
    const user = parseUserFromToken(event);
    if (!user) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    const path = event.path || '';
    const resource = event.resource || '';
    const method = event.httpMethod;
    const pathParams = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};

    // Route handling
    // GET /commissions
    // NOTE: For API Gateway REST APIs behind a custom domain/base path mapping,
    // `event.path` can include the base path and/or stage (e.g. `/insurance-automation/commissions` or `/prod/commissions`).
    // `event.resource` is the stable, canonical route (e.g. `/commissions`) and is preferred for routing.
    if (method === 'GET' && (resource === '/commissions' || (!resource && path.endsWith('/commissions')))) {
      // Map authenticated email -> OpenDental UserNum when clinicId is provided.
      // Audit sync writes commissions using OpenDental UserNum, so querying by email will return empty.
      let effectiveUserId = user.userId;
      if (queryParams.clinicId && user.email) {
        const mapped = await resolveOpenDentalUserForClinic(user.email, queryParams.clinicId);
        if (mapped?.userId) {
          effectiveUserId = mapped.userId;
        }
      }

      const result = await getCommissionsForUser(
        effectiveUserId,
        queryParams.clinicId,
        queryParams.startDate,
        queryParams.endDate,
        parseInt(queryParams.limit || '100', 10),
        queryParams.nextToken
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result),
      };
    }

    // GET /commissions/{userId}
    if (
      method === 'GET' &&
      (resource === '/commissions/{userId}' ||
        (!resource && /\/commissions\/[^/]+$/.test(path) && !/\/commissions\/clinic\/[^/]+$/.test(path)))
    ) {
      const targetUserId = pathParams.userId || path.split('/').pop();
      if (!targetUserId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'userId is required' }),
        };
      }

      // Permission check: Only admins can view other users' commissions
      if (!canViewOtherUserCommissions(user, targetUserId)) {
        console.log(`Access denied: User ${user.userId} (role: ${user.role}) tried to view commissions for ${targetUserId}`);
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Forbidden: You can only view your own commissions. Admin access required to view other users.' 
          }),
        };
      }

      const result = await getCommissionsForUser(
        targetUserId,
        queryParams.clinicId,
        queryParams.startDate,
        queryParams.endDate,
        parseInt(queryParams.limit || '100', 10),
        queryParams.nextToken
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result),
      };
    }

    // GET /commissions/clinic/{clinicId}
    if (
      method === 'GET' &&
      (resource === '/commissions/clinic/{clinicId}' || (!resource && /\/commissions\/clinic\/[^/]+$/.test(path)))
    ) {
      const clinicId = pathParams.clinicId || path.split('/').pop();
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'clinicId is required' }),
        };
      }

      // Permission check: Only admins can view clinic-wide commissions
      if (!canViewClinicCommissions(user)) {
        console.log(`Access denied: User ${user.userId} (role: ${user.role}) tried to view clinic commissions for ${clinicId}`);
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Forbidden: Admin access required to view all clinic commissions.' 
          }),
        };
      }

      const result = await getCommissionsForClinic(
        clinicId,
        queryParams.startDate,
        queryParams.endDate,
        parseInt(queryParams.limit || '100', 10),
        queryParams.nextToken
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result),
      };
    }

    // GET /config/{clinicId}
    if (method === 'GET' && (resource === '/config/{clinicId}' || (!resource && /\/config\/[^/]+$/.test(path)))) {
      const clinicId = pathParams.clinicId || path.split('/').pop();
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'clinicId is required' }),
        };
      }

      const config = await getClinicConfig(clinicId);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(config),
      };
    }

    // PUT /config/{clinicId}
    if (method === 'PUT' && (resource === '/config/{clinicId}' || (!resource && /\/config\/[^/]+$/.test(path)))) {
      const clinicId = pathParams.clinicId || path.split('/').pop();
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'clinicId is required' }),
        };
      }

      // Permission check: Only admins can modify config
      if (!canModifyConfig(user)) {
        console.log(`Access denied: User ${user.userId} (role: ${user.role}) tried to modify config for ${clinicId}`);
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Forbidden: Admin access required to modify automation settings.' 
          }),
        };
      }

      const body = event.body ? JSON.parse(event.body) : {};
      const updates: { insuranceAuditEnabled?: boolean; noteCopyingEnabled?: boolean } = {};

      if (typeof body.insuranceAuditEnabled === 'boolean') {
        updates.insuranceAuditEnabled = body.insuranceAuditEnabled;
      }
      if (typeof body.noteCopyingEnabled === 'boolean') {
        updates.noteCopyingEnabled = body.noteCopyingEnabled;
      }

      if (Object.keys(updates).length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'At least one toggle (insuranceAuditEnabled or noteCopyingEnabled) must be provided' }),
        };
      }

      const config = await updateClinicConfig(clinicId, updates, user.userId);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(config),
      };
    }

    // Route not found
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Not Found' }),
    };

  } catch (error: any) {
    console.error('Insurance Commission API Error:', error);

    return {
      statusCode: error.statusCode || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: error.message || 'Internal Server Error',
      }),
    };
  }
};

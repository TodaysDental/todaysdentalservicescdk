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

// CORS helper
function getCorsHeaders(event: APIGatewayProxyEvent) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const allowOrigin = origin && ALLOWED_ORIGINS_LIST.includes(origin) ? origin : 'https://todaysdentalinsights.com';
  return buildCorsHeaders({ allowOrigin, allowMethods: ['OPTIONS', 'GET', 'PUT', 'POST'] }, origin);
}

// Roles that can view all commissions (not just their own)
const ADMIN_ROLES = ['Admin', 'SuperAdmin', 'Global Super Admin'];

// User info from JWT token
interface UserInfo {
  userId: string;
  userName: string;
  clinicIds: string[];
  role: string;
  isAdmin: boolean;
}

// Parse JWT token to get user info including role
function parseUserFromToken(event: APIGatewayProxyEvent): UserInfo | null {
  try {
    const authContext = event.requestContext?.authorizer;
    if (authContext) {
      const role = authContext.role || authContext.userRole || '';
      return {
        userId: authContext.userId || authContext.sub,
        userName: authContext.userName || authContext.name || 'Unknown',
        clinicIds: authContext.clinicIds ? JSON.parse(authContext.clinicIds) : [],
        role,
        isAdmin: ADMIN_ROLES.includes(role),
      };
    }
    return null;
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
    path: event.path,
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

    const path = event.path;
    const method = event.httpMethod;
    const pathParams = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};

    // Route handling
    // GET /commissions
    if (method === 'GET' && path === '/commissions') {
      const result = await getCommissionsForUser(
        user.userId,
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
    if (method === 'GET' && path.startsWith('/commissions/') && !path.includes('/clinic/')) {
      const targetUserId = pathParams.userId;
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
    if (method === 'GET' && path.includes('/clinic/')) {
      const clinicId = pathParams.clinicId;
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
    if (method === 'GET' && path.startsWith('/config/')) {
      const clinicId = pathParams.clinicId;
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
    if (method === 'PUT' && path.startsWith('/config/')) {
      const clinicId = pathParams.clinicId;
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

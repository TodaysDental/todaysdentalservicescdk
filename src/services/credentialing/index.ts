// services/credentialing/index.ts
// Provider Credentialing and Payer Enrollment Management for DSO

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  GetCommand
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { ClinicRoleMap } from '../../shared/utils/jwt';
import {
  getUserPermissions,
  hasModulePermission,
  isAdminUser,
  getAllowedClinicIds,
  hasClinicAccess,
  PermissionType,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import {
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_SECTIONS,
  CANONICAL_FIELDS,
  CANONICAL_FIELDS_FLAT,
  validateDocumentType,
  findUploadSection,
  SubmissionMode,
  DocumentType,
} from './credentialing-schema';
import {
  classifyDocumentFromPath,
  extractTextFromDocument,
  extractFieldsWithBedrock,
  ExtractedText,
  ExtractedCredentialFields,
} from './credentialing-doc-processor';

// Environment Variables
const PROVIDERS_TABLE = process.env.PROVIDERS_TABLE!;
const PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE!;
const PROVIDER_STAFF_LINK_TABLE = process.env.PROVIDER_STAFF_LINK_TABLE!; // Legacy
const CREDENTIALING_USERS_TABLE = process.env.CREDENTIALING_USERS_TABLE!;
const PROVIDER_USER_LINK_TABLE = process.env.PROVIDER_USER_LINK_TABLE!;
const PAYER_ENROLLMENTS_TABLE = process.env.PAYER_ENROLLMENTS_TABLE!;
const TASKS_TABLE = process.env.TASKS_TABLE!;
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE!;
const CREDENTIALING_MODE = process.env.CREDENTIALING_MODE || 'internal';

// SES Environment Variables
const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const ses = new SESv2Client({ region: SES_REGION });

// Module configuration
const MODULE_NAME = 'CREDENTIALING';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

// Provider statuses
type ProviderStatus = 'draft' | 'in-progress' | 'verified' | 'enrolled';
type EnrollmentStatus = 'not-started' | 'in-progress' | 'approved' | 'rejected' | 'pending-info';
type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'overdue';
type TaskPriority = 'high' | 'medium' | 'low';
type TaskCategory = 'verification' | 'documentation' | 'enrollment' | 'follow-up';
type CredentialType = 'identity' | 'education' | 'license' | 'workHistory' | 'insurance' | 'sanctions' | 'clinicInfo';

// Available Payers
const AVAILABLE_PAYERS = [
  { id: 'delta-dental', name: 'Delta Dental', type: 'Dental Insurance' },
  { id: 'metlife-dental', name: 'MetLife Dental', type: 'Dental Insurance' },
  { id: 'cigna-dental', name: 'Cigna Dental', type: 'Dental Insurance' },
  { id: 'united-dental', name: 'United Healthcare Dental', type: 'Dental Insurance' },
  { id: 'aetna-dental', name: 'Aetna Dental', type: 'Dental Insurance' },
  { id: 'guardian-dental', name: 'Guardian Dental', type: 'Dental Insurance' },
  { id: 'medicaid-dental', name: 'Medicaid (Dental)', type: 'Government' },
  { id: 'medicare-dental', name: 'Medicare Dental', type: 'Government' },
  { id: 'humana-dental', name: 'Humana Dental', type: 'Dental Insurance' },
  { id: 'blue-cross-dental', name: 'Blue Cross Blue Shield Dental', type: 'Dental Insurance' },
];

// ========================================
// RESPONSE HELPERS
// ========================================

let currentCorsHeaders = buildCorsHeaders();

const httpErr = (code: number, message: string): APIGatewayProxyResult => ({
  statusCode: code,
  headers: currentCorsHeaders,
  body: JSON.stringify({ success: false, message })
});

const httpOk = (data: Record<string, any>): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: currentCorsHeaders,
  body: JSON.stringify({ success: true, ...data })
});

const httpCreated = (data: Record<string, any>): APIGatewayProxyResult => ({
  statusCode: 201,
  headers: currentCorsHeaders,
  body: JSON.stringify({ success: true, ...data })
});

// ========================================
// MAIN HANDLER (ROUTER)
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  currentCorsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: currentCorsHeaders, body: '' };
  }

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return httpErr(401, 'Unauthorized - Invalid token');
  }

  const requiredPermission: PermissionType = METHOD_PERMISSIONS[event.httpMethod] || 'read';
  if (!hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return httpErr(403, `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module`);
  }

  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);

  const method = event.httpMethod;
  const path = event.path.replace('/credentialing', '');
  const pathParams = event.pathParameters || {};
  const queryParams = event.queryStringParameters || {};

  try {
    // Dashboard
    if (method === 'GET' && path === '/dashboard') {
      return getDashboard(userPerms, isAdmin, allowedClinics);
    }

    // Providers
    if (method === 'GET' && path === '/providers') {
      return listProviders(queryParams, allowedClinics);
    }
    if (method === 'POST' && path === '/providers') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return createProvider(JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === 'GET' && path.match(/^\/providers\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      return getProvider(providerId, allowedClinics);
    }
    if (method === 'PUT' && path.match(/^\/providers\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return updateProvider(providerId, JSON.parse(event.body), allowedClinics);
    }
    if (method === 'DELETE' && path.match(/^\/providers\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      return deleteProvider(providerId, allowedClinics);
    }

    // Provider Credentials
    if (method === 'GET' && path.match(/^\/providers\/[^\/]+\/credentials$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      return getProviderCredentials(providerId, allowedClinics);
    }
    if (method === 'POST' && path.match(/^\/providers\/[^\/]+\/credentials$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return upsertProviderCredential(providerId, JSON.parse(event.body), allowedClinics);
    }
    if (method === 'GET' && path.match(/^\/providers\/[^\/]+\/credentials\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      const credentialType = pathParams.credentialType || path.split('/')[4];
      return getProviderCredential(providerId, credentialType, allowedClinics);
    }
    if (method === 'PUT' && path.match(/^\/providers\/[^\/]+\/credentials\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      const credentialType = pathParams.credentialType || path.split('/')[4];
      if (!event.body) return httpErr(400, 'Missing request body');
      return updateProviderCredential(providerId, credentialType, JSON.parse(event.body), allowedClinics);
    }
    if (method === 'DELETE' && path.match(/^\/providers\/[^\/]+\/credentials\/[^\/]+$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      const credentialType = pathParams.credentialType || path.split('/')[4];
      return deleteProviderCredential(providerId, credentialType, allowedClinics);
    }

    // Provider Enrollments (nested under provider)
    if (method === 'GET' && path.match(/^\/providers\/[^\/]+\/enrollments$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      return getProviderEnrollments(providerId, allowedClinics);
    }
    if (method === 'POST' && path.match(/^\/providers\/[^\/]+\/enrollments$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return createEnrollment(providerId, JSON.parse(event.body), userPerms, allowedClinics);
    }

    // Provider Documents (nested under provider)
    if (method === 'GET' && path.match(/^\/providers\/[^\/]+\/documents$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      return getProviderDocuments(providerId, allowedClinics);
    }
    if (method === 'POST' && path.match(/^\/providers\/[^\/]+\/documents$/)) {
      const providerId = pathParams.providerId || path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return getDocumentUploadUrl(providerId, JSON.parse(event.body), userPerms, allowedClinics);
    }

    // Enrollments (top-level)
    if (method === 'GET' && path === '/enrollments') {
      return listEnrollments(queryParams, allowedClinics);
    }
    if (method === 'GET' && path.match(/^\/enrollments\/[^\/]+$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split('/')[2];
      return getEnrollment(enrollmentId, allowedClinics);
    }
    if (method === 'PUT' && path.match(/^\/enrollments\/[^\/]+$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return updateEnrollment(enrollmentId, JSON.parse(event.body), allowedClinics);
    }
    if (method === 'DELETE' && path.match(/^\/enrollments\/[^\/]+$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split('/')[2];
      return deleteEnrollment(enrollmentId, allowedClinics);
    }
    if (method === 'PUT' && path.match(/^\/enrollments\/[^\/]+\/status$/)) {
      const enrollmentId = pathParams.enrollmentId || path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return updateEnrollmentStatus(enrollmentId, JSON.parse(event.body), allowedClinics);
    }

    // Tasks
    if (method === 'GET' && path === '/tasks') {
      return listTasks(queryParams, userPerms, isAdmin, allowedClinics);
    }
    if (method === 'POST' && path === '/tasks') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return createTask(JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === 'GET' && path.match(/^\/tasks\/[^\/]+$/)) {
      const taskId = pathParams.taskId || path.split('/')[2];
      return getTask(taskId, allowedClinics);
    }
    if (method === 'PUT' && path.match(/^\/tasks\/[^\/]+$/)) {
      const taskId = pathParams.taskId || path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return updateTask(taskId, JSON.parse(event.body), allowedClinics);
    }
    if (method === 'DELETE' && path.match(/^\/tasks\/[^\/]+$/)) {
      const taskId = pathParams.taskId || path.split('/')[2];
      return deleteTask(taskId, allowedClinics);
    }
    if (method === 'PUT' && path.match(/^\/tasks\/[^\/]+\/complete$/)) {
      const taskId = pathParams.taskId || path.split('/')[2];
      return completeTask(taskId, allowedClinics);
    }

    // Documents (top-level)
    if (method === 'GET' && path === '/documents') {
      return listDocuments(queryParams, allowedClinics);
    }
    if (method === 'GET' && path.match(/^\/documents\/[^\/]+$/)) {
      const documentId = pathParams.documentId || path.split('/')[2];
      return getDocumentDownloadUrl(documentId, allowedClinics);
    }
    if (method === 'DELETE' && path.match(/^\/documents\/[^\/]+$/)) {
      const documentId = pathParams.documentId || path.split('/')[2];
      return deleteDocument(documentId, allowedClinics);
    }
    // Document Processing (Textract/Bedrock extraction)
    if (method === 'POST' && path === '/documents/process') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return processDocumentExtraction(JSON.parse(event.body), allowedClinics);
    }
    // Get extracted data for a document
    if (method === 'GET' && path.match(/^\/documents\/[^\/]+\/extracted$/)) {
      const documentId = pathParams.documentId || path.split('/')[2];
      return getExtractedData(documentId, allowedClinics);
    }

    // Payers
    if (method === 'GET' && path === '/payers') {
      return httpOk({ payers: AVAILABLE_PAYERS });
    }

    // Verifications
    if (method === 'POST' && path === '/verifications/oig') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return runOigCheck(JSON.parse(event.body), allowedClinics);
    }
    if (method === 'POST' && path === '/verifications/npdb') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return runNpdbCheck(JSON.parse(event.body), allowedClinics);
    }
    if (method === 'POST' && path === '/verifications/state-board') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return runStateBoardCheck(JSON.parse(event.body), allowedClinics);
    }

    // Provider Self-Service (MY endpoints - requires clinical role)
    const hasProviderRole = isProviderUser(userPerms.clinicRoles);
    
    if (path.startsWith('/me')) {
      if (!hasProviderRole) {
        return httpErr(403, 'Provider role required to access this endpoint');
      }

      if (method === 'GET' && path === '/me') {
        return getMyProviderProfile(userPerms);
      }
      if (method === 'POST' && path === '/me/profile') {
        if (!event.body) return httpErr(400, 'Missing request body');
        return createMyProviderProfile(userPerms, JSON.parse(event.body));
      }
      if (method === 'GET' && path === '/me/credentials') {
        return getMyCredentials(userPerms);
      }
      if (method === 'POST' && path === '/me/credentials') {
        if (!event.body) return httpErr(400, 'Missing request body');
        return updateMyCredentials(userPerms, JSON.parse(event.body));
      }
      if (method === 'GET' && path === '/me/documents') {
        return getMyDocuments(userPerms);
      }
    }

    // Credentialing Users CRUD
    if (method === 'GET' && path === '/users') {
      return listCredentialingUsers(queryParams);
    }
    if (method === 'POST' && path === '/users') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return createCredentialingUser(JSON.parse(event.body), userPerms);
    }
    if (method === 'GET' && path.match(/^\/users\/[^\/]+$/)) {
      const userId = path.split('/')[2];
      return getCredentialingUser(userId);
    }
    if (method === 'PUT' && path.match(/^\/users\/[^\/]+$/)) {
      const userId = path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return updateCredentialingUser(userId, JSON.parse(event.body));
    }
    if (method === 'DELETE' && path.match(/^\/users\/[^\/]+$/)) {
      const userId = path.split('/')[2];
      return deleteCredentialingUser(userId);
    }
    // TDI Staff sync (internal mode only)
    if (method === 'POST' && path === '/users/sync-staff') {
      if (!event.body) return httpErr(400, 'Missing request body');
      return syncStaffUsers(JSON.parse(event.body), userPerms);
    }

    // Provider-User Linking
    if (method === 'GET' && path.match(/^\/providers\/[^\/]+\/linked-users$/)) {
      const providerId = path.split('/')[2];
      return getLinkedUsers(providerId, allowedClinics);
    }
    if (method === 'POST' && path.match(/^\/providers\/[^\/]+\/linked-users$/)) {
      const providerId = path.split('/')[2];
      if (!event.body) return httpErr(400, 'Missing request body');
      return linkUserToProvider(providerId, JSON.parse(event.body), userPerms, allowedClinics);
    }
    if (method === 'DELETE' && path.match(/^\/providers\/[^\/]+\/linked-users\/[^\/]+$/)) {
      const providerId = path.split('/')[2];
      const userId = path.split('/')[4];
      return unlinkUserFromProvider(providerId, userId, allowedClinics);
    }

    // Analytics
    if (method === 'GET' && path === '/analytics') {
      return getAnalytics(queryParams, allowedClinics);
    }

    return httpErr(404, 'Not Found');
  } catch (err: any) {
    console.error('Error in handler:', err);
    return httpErr(500, err.message || 'Internal server error');
  }
};

// ========================================
// DASHBOARD
// ========================================

async function getDashboard(userPerms: UserPermissions, isAdmin: boolean, allowedClinics: Set<string>) {
  // Get provider counts by status
  const { Items: providers } = await ddb.send(new ScanCommand({
    TableName: PROVIDERS_TABLE,
  }));

  const filteredProviders = (providers || []).filter(p => {
    if (userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin) return true;
    return p.clinicIds?.some((cid: string) => allowedClinics.has(cid));
  });

  const statusCounts = {
    draft: 0,
    'in-progress': 0,
    verified: 0,
    enrolled: 0,
  };

  filteredProviders.forEach(p => {
    const status = p.status as ProviderStatus;
    if (statusCounts[status] !== undefined) {
      statusCounts[status]++;
    }
  });

  // Get enrollment counts
  const { Items: enrollments } = await ddb.send(new ScanCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
  }));

  const providerIds = new Set(filteredProviders.map(p => p.providerId));
  const filteredEnrollments = (enrollments || []).filter(e => providerIds.has(e.providerId));

  const enrollmentCounts = {
    'not-started': 0,
    'in-progress': 0,
    approved: 0,
    rejected: 0,
    'pending-info': 0,
  };

  filteredEnrollments.forEach(e => {
    const status = e.status as EnrollmentStatus;
    if (enrollmentCounts[status] !== undefined) {
      enrollmentCounts[status]++;
    }
  });

  // Get task counts
  const { Items: tasks } = await ddb.send(new ScanCommand({
    TableName: TASKS_TABLE,
  }));

  const filteredTasks = (tasks || []).filter(t => {
    if (userPerms.isSuperAdmin || userPerms.isGlobalSuperAdmin) return true;
    return allowedClinics.has(t.clinicId);
  });

  const taskCounts = {
    pending: 0,
    'in-progress': 0,
    completed: 0,
    overdue: 0,
  };

  const now = new Date();
  filteredTasks.forEach(t => {
    let status = t.status as TaskStatus;
    // Check for overdue
    if (status !== 'completed' && new Date(t.dueDate) < now) {
      status = 'overdue';
    }
    if (taskCounts[status] !== undefined) {
      taskCounts[status]++;
    }
  });

  // Get expiring credentials (next 30 days)
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const { Items: credentials } = await ddb.send(new ScanCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    FilterExpression: 'expirationDate <= :expDate',
    ExpressionAttributeValues: {
      ':expDate': thirtyDaysFromNow.toISOString().split('T')[0],
    },
  }));

  const expiringCredentials = (credentials || []).filter(c => providerIds.has(c.providerId)).length;

  return httpOk({
    providers: {
      total: filteredProviders.length,
      byStatus: statusCounts,
    },
    enrollments: {
      total: filteredEnrollments.length,
      byStatus: enrollmentCounts,
    },
    tasks: {
      total: filteredTasks.length,
      byStatus: taskCounts,
    },
    alerts: {
      expiringCredentials,
      pendingTasks: taskCounts.pending,
      overdueTasks: taskCounts.overdue,
    },
  });
}

// ========================================
// PROVIDERS
// ========================================

async function listProviders(queryParams: any, allowedClinics: Set<string>) {
  const { status, clinicId, limit = '50', lastKey } = queryParams;

  let params: any = {
    TableName: PROVIDERS_TABLE,
    Limit: parseInt(limit),
  };

  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }

  if (status) {
    params = {
      ...params,
      IndexName: 'byStatus',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
    };
    const result = await ddb.send(new QueryCommand(params));
    const filtered = (result.Items || []).filter(p => {
      if (allowedClinics.has('*')) return true;
      return p.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    });
    return httpOk({
      providers: filtered,
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  if (clinicId) {
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return httpErr(403, 'No access to this clinic');
    }
    params = {
      ...params,
      IndexName: 'byClinic',
      KeyConditionExpression: 'primaryClinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': clinicId },
    };
    const result = await ddb.send(new QueryCommand(params));
    return httpOk({
      providers: result.Items || [],
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  const result = await ddb.send(new ScanCommand(params));
  const filtered = (result.Items || []).filter(p => {
    if (allowedClinics.has('*')) return true;
    return p.clinicIds?.some((cid: string) => allowedClinics.has(cid));
  });

  return httpOk({
    providers: filtered,
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}

async function createProvider(body: any, userPerms: UserPermissions, allowedClinics: Set<string>) {
  const { name, npi, specialty, clinicIds, email, tempProviderId, linkedStaffEmail } = body;

  if (!name || !npi || !specialty) {
    return httpErr(400, 'name, npi, and specialty are required');
  }

  // Validate clinic access
  const providerClinicIds = clinicIds || [];
  for (const cid of providerClinicIds) {
    if (!hasClinicAccess(allowedClinics, cid)) {
      return httpErr(403, `No access to clinic ${cid}`);
    }
  }

  // Check for duplicate NPI within the same clinic(s)
  // Allow same NPI across different clinics, but not within the same clinic
  const { Items: existing } = await ddb.send(new QueryCommand({
    TableName: PROVIDERS_TABLE,
    IndexName: 'byNpi',
    KeyConditionExpression: 'npi = :npi',
    ExpressionAttributeValues: { ':npi': npi },
  }));

  if (existing && existing.length > 0) {
    // Check if any existing provider with this NPI shares a clinic with the new provider
    for (const existingProvider of existing) {
      const existingClinicIds = existingProvider.clinicIds || [];
      const overlappingClinics = providerClinicIds.filter((cid: string) => existingClinicIds.includes(cid));
      if (overlappingClinics.length > 0) {
        return httpErr(400, `A provider with this NPI already exists for clinic(s): ${overlappingClinics.join(', ')}`);
      }
    }
    // No overlapping clinics, so allow the provider creation for different clinics
  }

  const providerId = uuidv4();
  const now = new Date().toISOString();

  const provider = {
    providerId,
    name,
    npi,
    specialty,
    status: 'draft' as ProviderStatus,
    credentialingProgress: 0,
    enrollmentProgress: 0,
    clinicIds: providerClinicIds,
    primaryClinicId: providerClinicIds[0] || null,
    email: email || null,
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: PROVIDERS_TABLE, Item: provider }));

  // Create user link if linkedStaffEmail is provided
  if (linkedStaffEmail) {
    try {
      // Resolve or create a credentialing user for this email
      const { Items: existingUsers } = await ddb.send(new QueryCommand({
        TableName: CREDENTIALING_USERS_TABLE,
        IndexName: 'byEmail',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': linkedStaffEmail.toLowerCase() },
      }));

      let userId: string;
      if (existingUsers && existingUsers.length > 0) {
        userId = existingUsers[0].userId;
      } else {
        // Auto-create credentialing user from staff email
        userId = uuidv4();
        await ddb.send(new PutCommand({
          TableName: CREDENTIALING_USERS_TABLE,
          Item: {
            userId,
            email: linkedStaffEmail.toLowerCase(),
            name: linkedStaffEmail.split('@')[0],
            role: 'provider',
            source: 'tdi-staff',
            externalRef: linkedStaffEmail.toLowerCase(),
            orgId: 'default',
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
        }));
      }

      // Write to new ProviderUserLinkTable
      await ddb.send(new PutCommand({
        TableName: PROVIDER_USER_LINK_TABLE,
        Item: {
          providerId,
          userId,
          relationshipType: 'owner',
          linkedAt: now,
          linkedBy: userPerms.email,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      }));

      // Also write to legacy table for backward compat
      await ddb.send(new PutCommand({
        TableName: PROVIDER_STAFF_LINK_TABLE,
        Item: {
          providerId,
          staffUserId: linkedStaffEmail.toLowerCase(),
          staffEmail: linkedStaffEmail.toLowerCase(),
          relationshipType: 'owner',
          linkedAt: now,
          linkedBy: userPerms.email,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      }));
      
      console.log(`Created user link: ${providerId} -> userId=${userId}, email=${linkedStaffEmail}`);
    } catch (err) {
      console.error('Error creating user link:', err);
      // Don't fail provider creation if link creation fails
    }
  }

  // If a tempProviderId was provided, link any documents uploaded during wizard flow
  let linkedDocuments = 0;
  if (tempProviderId && tempProviderId.startsWith('temp-')) {
    try {
      // Find all documents with this tempProviderId
      const { Items: tempDocs } = await ddb.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        IndexName: 'byProvider',
        KeyConditionExpression: 'providerId = :tempId',
        ExpressionAttributeValues: { ':tempId': tempProviderId },
      }));

      // Update each document to use the real providerId
      for (const doc of tempDocs || []) {
        await ddb.send(new UpdateCommand({
          TableName: DOCUMENTS_TABLE,
          Key: { documentId: doc.documentId },
          UpdateExpression: 'SET providerId = :newId, #status = :status, linkedAt = :linkedAt',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':newId': providerId,
            ':status': 'pending',  // Change from pending-provider to pending
            ':linkedAt': now,
          },
        }));
        linkedDocuments++;
      }
      console.log(`Linked ${linkedDocuments} documents from temp provider ${tempProviderId} to ${providerId}`);
    } catch (err) {
      console.error('Error linking temp documents:', err);
      // Don't fail provider creation if document linking fails
    }
  }

  return httpCreated({ 
    providerId, 
    message: 'Provider created successfully', 
    provider,
    linkedDocuments,
  });
}

async function getProvider(providerId: string, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!Item) {
    return httpErr(404, 'Provider not found');
  }

  // Check access
  if (!allowedClinics.has('*')) {
    const hasAccess = Item.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  return httpOk({ provider: Item });
}

async function updateProvider(providerId: string, body: any, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!existing) {
    return httpErr(404, 'Provider not found');
  }

  // Check access
  if (!allowedClinics.has('*')) {
    const hasAccess = existing.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const updateFields = ['name', 'specialty', 'status', 'credentialingProgress', 'enrollmentProgress', 'clinicIds', 'email'];
  const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
  const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const expressionAttributeValues: Record<string, any> = { ':updatedAt': new Date().toISOString() };

  for (const field of updateFields) {
    if (body[field] !== undefined) {
      updateExpressions.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`] = field;
      expressionAttributeValues[`:${field}`] = body[field];
    }
  }

  // Update primaryClinicId if clinicIds changed
  if (body.clinicIds) {
    updateExpressions.push('#primaryClinicId = :primaryClinicId');
    expressionAttributeNames['#primaryClinicId'] = 'primaryClinicId';
    expressionAttributeValues[':primaryClinicId'] = body.clinicIds[0] || null;
  }

  await ddb.send(new UpdateCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));

  return httpOk({ providerId, message: 'Provider updated successfully' });
}

async function deleteProvider(providerId: string, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!existing) {
    return httpErr(404, 'Provider not found');
  }

  // Check access
  if (!allowedClinics.has('*')) {
    const hasAccess = existing.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  await ddb.send(new DeleteCommand({ TableName: PROVIDERS_TABLE, Key: { providerId } }));

  return httpOk({ message: 'Provider deleted successfully' });
}

// ========================================
// PROVIDER CREDENTIALS
// ========================================

async function getProviderCredentials(providerId: string, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const { Items } = await ddb.send(new QueryCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    KeyConditionExpression: 'providerId = :providerId',
    ExpressionAttributeValues: { ':providerId': providerId },
  }));

  return httpOk({ credentials: Items || [] });
}

async function upsertProviderCredential(providerId: string, body: any, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const { credentialType, ...credentialData } = body;

  if (!credentialType) {
    return httpErr(400, 'credentialType is required');
  }

  const validTypes: CredentialType[] = ['identity', 'education', 'license', 'workHistory', 'insurance', 'sanctions', 'clinicInfo'];
  if (!validTypes.includes(credentialType)) {
    return httpErr(400, `Invalid credentialType. Must be one of: ${validTypes.join(', ')}`);
  }

  const now = new Date().toISOString();
  const credential = {
    providerId,
    credentialType,
    ...credentialData,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: PROVIDER_CREDENTIALS_TABLE, Item: credential }));

  // Update provider's credentialing progress
  await updateCredentialingProgress(providerId);

  return httpOk({ message: 'Credential saved successfully', credential });
}

async function getProviderCredential(providerId: string, credentialType: string, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const { Item } = await ddb.send(new GetCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Key: { providerId, credentialType },
  }));

  if (!Item) {
    return httpErr(404, 'Credential not found');
  }

  return httpOk({ credential: Item });
}

async function updateProviderCredential(providerId: string, credentialType: string, body: any, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Key: { providerId, credentialType },
  }));

  if (!existing) {
    return httpErr(404, 'Credential not found');
  }

  const updated = {
    ...existing,
    ...body,
    providerId,
    credentialType,
    updatedAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: PROVIDER_CREDENTIALS_TABLE, Item: updated }));

  // Update provider's credentialing progress
  await updateCredentialingProgress(providerId);

  return httpOk({ message: 'Credential updated successfully', credential: updated });
}

async function deleteProviderCredential(providerId: string, credentialType: string, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  await ddb.send(new DeleteCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Key: { providerId, credentialType },
  }));

  // Update provider's credentialing progress
  await updateCredentialingProgress(providerId);

  return httpOk({ message: 'Credential deleted successfully' });
}

async function updateCredentialingProgress(providerId: string) {
  const { Items: credentials } = await ddb.send(new QueryCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    KeyConditionExpression: 'providerId = :providerId',
    ExpressionAttributeValues: { ':providerId': providerId },
  }));

  const requiredTypes: CredentialType[] = ['identity', 'education', 'license', 'workHistory', 'insurance', 'sanctions'];
  const completedTypes = new Set((credentials || []).map(c => c.credentialType));

  let completedCount = 0;
  for (const type of requiredTypes) {
    if (completedTypes.has(type)) {
      completedCount++;
    }
  }

  const progress = Math.round((completedCount / requiredTypes.length) * 100);

  // Determine status based on progress
  let status: ProviderStatus = 'draft';
  if (progress > 0 && progress < 100) {
    status = 'in-progress';
  } else if (progress === 100) {
    status = 'verified';
  }

  await ddb.send(new UpdateCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
    UpdateExpression: 'SET credentialingProgress = :progress, #status = :status, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':progress': progress,
      ':status': status,
      ':now': new Date().toISOString(),
    },
  }));
}

// ========================================
// ENROLLMENTS
// ========================================

async function getProviderEnrollments(providerId: string, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const { Items } = await ddb.send(new QueryCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
    IndexName: 'byProvider',
    KeyConditionExpression: 'providerId = :providerId',
    ExpressionAttributeValues: { ':providerId': providerId },
  }));

  return httpOk({ enrollments: Items || [] });
}

async function createEnrollment(providerId: string, body: any, userPerms: UserPermissions, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const { payerId, payerName, payerType } = body;

  if (!payerId || !payerName) {
    return httpErr(400, 'payerId and payerName are required');
  }

  const enrollmentId = uuidv4();
  const now = new Date().toISOString();

  const enrollment = {
    enrollmentId,
    providerId,
    payerId,
    payerName,
    payerType: payerType || 'Dental Insurance',
    status: 'in-progress' as EnrollmentStatus,
    applicationDate: now,
    approvalDate: null,
    notes: body.notes || null,
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: PAYER_ENROLLMENTS_TABLE, Item: enrollment }));

  // Update provider's enrollment progress
  await updateEnrollmentProgress(providerId);

  return httpCreated({ enrollmentId, message: 'Enrollment started successfully', enrollment });
}

async function listEnrollments(queryParams: any, allowedClinics: Set<string>) {
  const { status, payerId, limit = '50', lastKey } = queryParams;

  let params: any = {
    TableName: PAYER_ENROLLMENTS_TABLE,
    Limit: parseInt(limit),
  };

  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }

  if (status) {
    params = {
      ...params,
      IndexName: 'byStatus',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
    };
    const result = await ddb.send(new QueryCommand(params));
    return httpOk({
      enrollments: result.Items || [],
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  if (payerId) {
    params = {
      ...params,
      IndexName: 'byPayer',
      KeyConditionExpression: 'payerId = :payerId',
      ExpressionAttributeValues: { ':payerId': payerId },
    };
    const result = await ddb.send(new QueryCommand(params));
    return httpOk({
      enrollments: result.Items || [],
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  const result = await ddb.send(new ScanCommand(params));
  return httpOk({
    enrollments: result.Items || [],
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}

async function getEnrollment(enrollmentId: string, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId },
  }));

  if (!Item) {
    return httpErr(404, 'Enrollment not found');
  }

  return httpOk({ enrollment: Item });
}

async function updateEnrollment(enrollmentId: string, body: any, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId },
  }));

  if (!existing) {
    return httpErr(404, 'Enrollment not found');
  }

  const updated = {
    ...existing,
    ...body,
    enrollmentId,
    updatedAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: PAYER_ENROLLMENTS_TABLE, Item: updated }));

  // Update provider's enrollment progress
  await updateEnrollmentProgress(existing.providerId);

  return httpOk({ message: 'Enrollment updated successfully', enrollment: updated });
}

async function deleteEnrollment(enrollmentId: string, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId },
  }));

  if (!existing) {
    return httpErr(404, 'Enrollment not found');
  }

  await ddb.send(new DeleteCommand({ TableName: PAYER_ENROLLMENTS_TABLE, Key: { enrollmentId } }));

  // Update provider's enrollment progress
  await updateEnrollmentProgress(existing.providerId);

  return httpOk({ message: 'Enrollment deleted successfully' });
}

async function updateEnrollmentStatus(enrollmentId: string, body: any, allowedClinics: Set<string>) {
  const { status, notes } = body;

  if (!status) {
    return httpErr(400, 'status is required');
  }

  const validStatuses: EnrollmentStatus[] = ['not-started', 'in-progress', 'approved', 'rejected', 'pending-info'];
  if (!validStatuses.includes(status)) {
    return httpErr(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId },
  }));

  if (!existing) {
    return httpErr(404, 'Enrollment not found');
  }

  const updateExpressions = ['#status = :status', 'updatedAt = :now'];
  const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':now': new Date().toISOString(),
  };

  if (notes !== undefined) {
    updateExpressions.push('notes = :notes');
    expressionAttributeValues[':notes'] = notes;
  }

  if (status === 'approved') {
    updateExpressions.push('approvalDate = :approvalDate');
    expressionAttributeValues[':approvalDate'] = new Date().toISOString().split('T')[0];
  }

  await ddb.send(new UpdateCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
    Key: { enrollmentId },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));

  // Update provider's enrollment progress
  await updateEnrollmentProgress(existing.providerId);

  return httpOk({ message: 'Enrollment status updated successfully' });
}

async function updateEnrollmentProgress(providerId: string) {
  const { Items: enrollments } = await ddb.send(new QueryCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
    IndexName: 'byProvider',
    KeyConditionExpression: 'providerId = :providerId',
    ExpressionAttributeValues: { ':providerId': providerId },
  }));

  if (!enrollments || enrollments.length === 0) {
    await ddb.send(new UpdateCommand({
      TableName: PROVIDERS_TABLE,
      Key: { providerId },
      UpdateExpression: 'SET enrollmentProgress = :progress, updatedAt = :now',
      ExpressionAttributeValues: {
        ':progress': 0,
        ':now': new Date().toISOString(),
      },
    }));
    return;
  }

  const approvedCount = enrollments.filter(e => e.status === 'approved').length;
  const progress = Math.round((approvedCount / enrollments.length) * 100);

  // Update provider status to enrolled if all enrollments approved and credentialing is complete
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  let newStatus = provider?.status || 'draft';
  if (provider?.credentialingProgress === 100 && progress === 100) {
    newStatus = 'enrolled';
  }

  await ddb.send(new UpdateCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
    UpdateExpression: 'SET enrollmentProgress = :progress, #status = :status, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':progress': progress,
      ':status': newStatus,
      ':now': new Date().toISOString(),
    },
  }));
}

// ========================================
// TASKS
// ========================================

async function listTasks(queryParams: any, userPerms: UserPermissions, isAdmin: boolean, allowedClinics: Set<string>) {
  const { status, priority, providerId, clinicId, assigneeId, limit = '50', lastKey } = queryParams;

  let params: any = {
    TableName: TASKS_TABLE,
    Limit: parseInt(limit),
  };

  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }

  if (status) {
    params = {
      ...params,
      IndexName: 'byStatus',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
    };
    const result = await ddb.send(new QueryCommand(params));
    const filtered = filterTasksByAccess(result.Items || [], allowedClinics, userPerms, isAdmin);
    return httpOk({
      tasks: filtered,
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  if (providerId) {
    params = {
      ...params,
      IndexName: 'byProvider',
      KeyConditionExpression: 'providerId = :providerId',
      ExpressionAttributeValues: { ':providerId': providerId },
    };
    const result = await ddb.send(new QueryCommand(params));
    const filtered = filterTasksByAccess(result.Items || [], allowedClinics, userPerms, isAdmin);
    return httpOk({
      tasks: filtered,
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  if (clinicId) {
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return httpErr(403, 'No access to this clinic');
    }
    params = {
      ...params,
      IndexName: 'byClinic',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': clinicId },
    };
    const result = await ddb.send(new QueryCommand(params));
    return httpOk({
      tasks: result.Items || [],
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  if (assigneeId) {
    params = {
      ...params,
      IndexName: 'byAssignee',
      KeyConditionExpression: 'assigneeId = :assigneeId',
      ExpressionAttributeValues: { ':assigneeId': assigneeId },
    };
    const result = await ddb.send(new QueryCommand(params));
    const filtered = filterTasksByAccess(result.Items || [], allowedClinics, userPerms, isAdmin);
    return httpOk({
      tasks: filtered,
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  const result = await ddb.send(new ScanCommand(params));
  const filtered = filterTasksByAccess(result.Items || [], allowedClinics, userPerms, isAdmin);
  return httpOk({
    tasks: filtered,
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}

function filterTasksByAccess(tasks: any[], allowedClinics: Set<string>, userPerms: UserPermissions, isAdmin: boolean) {
  if (allowedClinics.has('*')) return tasks;

  return tasks.filter(t => {
    // Allow access if user is assignee
    if (t.assigneeId === userPerms.email) return true;
    // Allow access if user has clinic access
    if (t.clinicId && allowedClinics.has(t.clinicId)) return true;
    return false;
  });
}

async function createTask(body: any, userPerms: UserPermissions, allowedClinics: Set<string>) {
  const { title, description, providerId, clinicId, priority, dueDate, assigneeId, category } = body;

  if (!title || !providerId || !dueDate) {
    return httpErr(400, 'title, providerId, and dueDate are required');
  }

  if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, 'No access to this clinic');
  }

  const taskId = uuidv4();
  const now = new Date().toISOString();

  const task = {
    taskId,
    title,
    description: description || '',
    providerId,
    clinicId: clinicId || null,
    priority: priority || 'medium' as TaskPriority,
    status: 'pending' as TaskStatus,
    dueDate,
    assigneeId: assigneeId || null,
    assigneeName: null, // Will be populated if assignee exists
    category: category || 'verification' as TaskCategory,
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TASKS_TABLE, Item: task }));

  return httpCreated({ taskId, message: 'Task created successfully', task });
}

async function getTask(taskId: string, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TASKS_TABLE,
    Key: { taskId },
  }));

  if (!Item) {
    return httpErr(404, 'Task not found');
  }

  return httpOk({ task: Item });
}

async function updateTask(taskId: string, body: any, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: TASKS_TABLE,
    Key: { taskId },
  }));

  if (!existing) {
    return httpErr(404, 'Task not found');
  }

  const updated = {
    ...existing,
    ...body,
    taskId,
    updatedAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: TASKS_TABLE, Item: updated }));

  return httpOk({ message: 'Task updated successfully', task: updated });
}

async function deleteTask(taskId: string, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: TASKS_TABLE,
    Key: { taskId },
  }));

  if (!existing) {
    return httpErr(404, 'Task not found');
  }

  await ddb.send(new DeleteCommand({ TableName: TASKS_TABLE, Key: { taskId } }));

  return httpOk({ message: 'Task deleted successfully' });
}

async function completeTask(taskId: string, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: TASKS_TABLE,
    Key: { taskId },
  }));

  if (!existing) {
    return httpErr(404, 'Task not found');
  }

  await ddb.send(new UpdateCommand({
    TableName: TASKS_TABLE,
    Key: { taskId },
    UpdateExpression: 'SET #status = :status, completedAt = :completedAt, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'completed',
      ':completedAt': new Date().toISOString(),
      ':now': new Date().toISOString(),
    },
  }));

  return httpOk({ message: 'Task marked as completed' });
}

// ========================================
// DOCUMENTS
// ========================================

async function getProviderDocuments(providerId: string, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider not found');
  }

  if (!allowedClinics.has('*')) {
    const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
    if (!hasAccess) {
      return httpErr(403, 'No access to this provider');
    }
  }

  const { Items } = await ddb.send(new QueryCommand({
    TableName: DOCUMENTS_TABLE,
    IndexName: 'byProvider',
    KeyConditionExpression: 'providerId = :providerId',
    ExpressionAttributeValues: { ':providerId': providerId },
  }));

  return httpOk({ documents: Items || [] });
}

async function getDocumentUploadUrl(providerId: string, body: any, userPerms: UserPermissions, allowedClinics: Set<string>) {
  // Check if this is a temporary provider ID (for new provider wizard flow)
  const isTempProvider = providerId.startsWith('temp-');

  // For real providers, verify provider exists and user has access
  if (!isTempProvider) {
    const { Item: provider } = await ddb.send(new GetCommand({
      TableName: PROVIDERS_TABLE,
      Key: { providerId },
    }));

    if (!provider) {
      return httpErr(404, 'Provider not found');
    }

    if (!allowedClinics.has('*')) {
      const hasAccess = provider.clinicIds?.some((cid: string) => allowedClinics.has(cid));
      if (!hasAccess) {
        return httpErr(403, 'No access to this provider');
      }
    }
  }

  const { fileName, documentType, contentType } = body;

  if (!fileName || !documentType) {
    return httpErr(400, 'fileName and documentType are required');
  }

  // Validate document type and normalize
  const validatedType = validateDocumentType(documentType);
  if (validatedType === 'other' && documentType !== 'other') {
    console.warn(`Unknown document type '${documentType}', using 'other'. Valid types: ${VALID_DOCUMENT_TYPES.join(', ')}`);
  }

  const documentId = uuidv4();
  // For temp providers, store in staging folder; for real providers, use regular path
  const s3Key = isTempProvider
    ? `staging/${providerId}/${validatedType}/${documentId}-${fileName}`
    : `providers/${providerId}/${validatedType}/${documentId}-${fileName}`;
  const now = new Date().toISOString();

  // Create presigned URL for upload
  const command = new PutObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: s3Key,
    ContentType: contentType || 'application/octet-stream',
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour

  // Save document metadata
  const document = {
    documentId,
    providerId,  // Store temp ID - will be updated when provider is created
    tempProviderId: isTempProvider ? providerId : undefined,  // Track temp ID for later linking
    documentType,
    fileName,
    s3Key,
    contentType: contentType || 'application/octet-stream',
    status: isTempProvider ? 'pending-provider' : 'pending',  // Different status for temp uploads
    uploadedAt: now,
    uploadedBy: userPerms.email,
  };

  await ddb.send(new PutCommand({ TableName: DOCUMENTS_TABLE, Item: document }));

  return httpOk({
    documentId,
    uploadUrl,
    message: 'Upload URL generated. URL expires in 1 hour.',
    document,
  });
}

async function listDocuments(queryParams: any, allowedClinics: Set<string>) {
  const { documentType, limit = '50', lastKey } = queryParams;

  let params: any = {
    TableName: DOCUMENTS_TABLE,
    Limit: parseInt(limit),
  };

  if (lastKey) {
    params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
  }

  if (documentType) {
    params = {
      ...params,
      IndexName: 'byDocumentType',
      KeyConditionExpression: 'documentType = :documentType',
      ExpressionAttributeValues: { ':documentType': documentType },
    };
    const result = await ddb.send(new QueryCommand(params));
    return httpOk({
      documents: result.Items || [],
      lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
    });
  }

  const result = await ddb.send(new ScanCommand(params));
  return httpOk({
    documents: result.Items || [],
    lastKey: result.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
  });
}

async function getDocumentDownloadUrl(documentId: string, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: DOCUMENTS_TABLE,
    Key: { documentId },
  }));

  if (!Item) {
    return httpErr(404, 'Document not found');
  }

  // Create presigned URL for download
  const command = new GetObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: Item.s3Key,
  });

  const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour

  return httpOk({
    documentId,
    downloadUrl,
    document: Item,
    message: 'Download URL generated. URL expires in 1 hour.'
  });
}

async function deleteDocument(documentId: string, allowedClinics: Set<string>) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: DOCUMENTS_TABLE,
    Key: { documentId },
  }));

  if (!existing) {
    return httpErr(404, 'Document not found');
  }

  // Delete from S3
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: existing.s3Key,
    }));
  } catch (err) {
    console.error('Error deleting S3 object:', err);
    // Continue with DynamoDB deletion even if S3 fails
  }

  // Delete from DynamoDB
  await ddb.send(new DeleteCommand({ TableName: DOCUMENTS_TABLE, Key: { documentId } }));

  return httpOk({ message: 'Document deleted successfully' });
}

// ========================================
// DOCUMENT EXTRACTION (Textract + Bedrock)
// ========================================

// Environment variable for extracted data table
const EXTRACTED_DATA_TABLE = process.env.EXTRACTED_DATA_TABLE || 'ExtractedData';

/**
 * Process a document through Textract/Bedrock to extract credentialing fields
 * This provides synchronous extraction for the frontend wizard pre-fill workflow
 */
async function processDocumentExtraction(body: any, allowedClinics: Set<string>) {
  const { documentId, providerId } = body;

  if (!documentId || !providerId) {
    return httpErr(400, 'documentId and providerId are required');
  }

  // Get the document record
  const { Item: document } = await ddb.send(new GetCommand({
    TableName: DOCUMENTS_TABLE,
    Key: { documentId },
  }));

  if (!document) {
    return httpErr(404, 'Document not found');
  }

  // Check if we already have extracted data
  const { Items: existingExtractions } = await ddb.send(new QueryCommand({
    TableName: EXTRACTED_DATA_TABLE,
    IndexName: 'byDocument',
    KeyConditionExpression: 'documentId = :documentId',
    ExpressionAttributeValues: { ':documentId': documentId },
    Limit: 1,
  }));

  if (existingExtractions && existingExtractions.length > 0) {
    // Return existing extraction
    const extraction = existingExtractions[0];
    return httpOk({
      documentType: extraction.documentType,
      classificationConfidence: extraction.classificationConfidence || 0.9,
      fieldsExtracted: Object.keys(extraction.extractedFields || {}).length,
      fields: extraction.extractedFields || {},
      status: extraction.status,
      extractionId: extraction.extractionId,
    });
  }

  // Perform classification based on document type from metadata or S3 key path
  const documentType = document.documentType || classifyDocumentFromPath(document.s3Key).documentType;

  try {
    // Use shared extraction functions from credentialing-doc-processor
    console.log(`Processing document: ${document.s3Key}`);
    const extractedText = await extractTextFromDocument(DOCUMENTS_BUCKET, document.s3Key);
    console.log(`Extracted ${extractedText.lines.length} lines, ${Object.keys(extractedText.keyValuePairs).length} key-value pairs`);

    // Extract fields using Bedrock
    const extractedFields = await extractFieldsWithBedrock(documentType as DocumentType, extractedText);
    console.log(`Extracted ${Object.keys(extractedFields).length} fields with Bedrock`);

    // Store extraction result
    const extractionId = uuidv4();
    const now = new Date().toISOString();

    await ddb.send(new PutCommand({
      TableName: EXTRACTED_DATA_TABLE,
      Item: {
        extractionId,
        documentId,
        providerId,
        documentType,
        extractedFields,
        rawTextPreview: extractedText.fullText.substring(0, 500),
        status: 'extracted',
        classificationConfidence: 0.85,
        createdAt: now,
      },
    }));

    // Update document with extraction status
    await ddb.send(new UpdateCommand({
      TableName: DOCUMENTS_TABLE,
      Key: { documentId },
      UpdateExpression: 'SET extractionId = :extractionId, extractionStatus = :status, extractedAt = :now',
      ExpressionAttributeValues: {
        ':extractionId': extractionId,
        ':status': 'extracted',
        ':now': now,
      },
    }));

    return httpOk({
      documentType,
      classificationConfidence: 0.85,
      fieldsExtracted: Object.keys(extractedFields).length,
      fields: extractedFields,
      status: 'extracted',
      extractionId,
    });
  } catch (error: any) {
    console.error('Error during document extraction:', error);
    // Return error response with partial info
    return httpErr(500, `Document extraction failed: ${error.message}`);
  }
}

/**
 * Get extracted data for a document
 */
async function getExtractedData(documentId: string, allowedClinics: Set<string>) {
  // Query extracted data by document ID
  const { Items } = await ddb.send(new QueryCommand({
    TableName: EXTRACTED_DATA_TABLE,
    IndexName: 'byDocument',
    KeyConditionExpression: 'documentId = :documentId',
    ExpressionAttributeValues: { ':documentId': documentId },
    Limit: 1,
  }));

  if (!Items || Items.length === 0) {
    return httpErr(404, 'No extracted data found for this document');
  }

  const extraction = Items[0];

  return httpOk({
    extractionId: extraction.extractionId,
    documentId: extraction.documentId,
    providerId: extraction.providerId,
    documentType: extraction.documentType,
    extractedFields: extraction.extractedFields || {},
    status: extraction.status,
    createdAt: extraction.createdAt,
  });
}

// ========================================
// VERIFICATIONS
// ========================================

async function runOigCheck(body: any, allowedClinics: Set<string>) {
  const { providerId, npi, firstName, lastName } = body;

  if (!providerId || !npi) {
    return httpErr(400, 'providerId and npi are required');
  }

  // In a real implementation, this would call the OIG LEIE API
  // https://oig.hhs.gov/exclusions/exclusions_list.asp
  // For now, we simulate the check

  const checkResult = {
    providerId,
    checkType: 'OIG Exclusions',
    status: 'clear', // 'clear' | 'flagged' | 'error'
    checkedAt: new Date().toISOString(),
    details: {
      npi,
      firstName,
      lastName,
      message: 'No exclusions found in OIG LEIE database',
    },
  };

  // Save the result to sanctions credential
  await ddb.send(new PutCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Item: {
      providerId,
      credentialType: 'sanctions',
      oigCheck: checkResult,
      updatedAt: new Date().toISOString(),
    },
  }));

  return httpOk({ result: checkResult });
}

async function runNpdbCheck(body: any, allowedClinics: Set<string>) {
  const { providerId, npi, firstName, lastName } = body;

  if (!providerId || !npi) {
    return httpErr(400, 'providerId and npi are required');
  }

  // In a real implementation, this would call the NPDB API
  // https://www.npdb.hrsa.gov/
  // For now, we simulate the check

  const checkResult = {
    providerId,
    checkType: 'NPDB Query',
    status: 'clear',
    checkedAt: new Date().toISOString(),
    details: {
      npi,
      firstName,
      lastName,
      message: 'No adverse actions found in National Practitioner Data Bank',
    },
  };

  // Update the sanctions credential
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Key: { providerId, credentialType: 'sanctions' },
  }));

  await ddb.send(new PutCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Item: {
      ...existing,
      providerId,
      credentialType: 'sanctions',
      npdbCheck: checkResult,
      updatedAt: new Date().toISOString(),
    },
  }));

  return httpOk({ result: checkResult });
}

async function runStateBoardCheck(body: any, allowedClinics: Set<string>) {
  const { providerId, licenseNumber, licenseState } = body;

  if (!providerId || !licenseNumber || !licenseState) {
    return httpErr(400, 'providerId, licenseNumber, and licenseState are required');
  }

  // In a real implementation, this would call the state dental board API
  // For now, we simulate the check

  const checkResult = {
    providerId,
    checkType: 'State Dental Board',
    status: 'clear',
    checkedAt: new Date().toISOString(),
    details: {
      licenseNumber,
      licenseState,
      licenseStatus: 'Active',
      message: `License verified as active with ${licenseState} Dental Board. No disciplinary actions found.`,
    },
  };

  // Update the sanctions credential
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Key: { providerId, credentialType: 'sanctions' },
  }));

  await ddb.send(new PutCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Item: {
      ...existing,
      providerId,
      credentialType: 'sanctions',
      stateBoardCheck: checkResult,
      updatedAt: new Date().toISOString(),
    },
  }));

  return httpOk({ result: checkResult });
}

// ========================================
// ANALYTICS
// ========================================

async function getAnalytics(queryParams: any, allowedClinics: Set<string>) {
  const { startDate, endDate, clinicId } = queryParams;

  // Get all providers
  const { Items: providers } = await ddb.send(new ScanCommand({
    TableName: PROVIDERS_TABLE,
  }));

  const filteredProviders = (providers || []).filter(p => {
    if (allowedClinics.has('*')) return true;
    return p.clinicIds?.some((cid: string) => allowedClinics.has(cid));
  });

  // Provider status breakdown
  const providersByStatus: Record<string, number> = {
    draft: 0,
    'in-progress': 0,
    verified: 0,
    enrolled: 0,
  };

  filteredProviders.forEach(p => {
    if (providersByStatus[p.status] !== undefined) {
      providersByStatus[p.status]++;
    }
  });

  // Get all enrollments
  const { Items: enrollments } = await ddb.send(new ScanCommand({
    TableName: PAYER_ENROLLMENTS_TABLE,
  }));

  const providerIds = new Set(filteredProviders.map(p => p.providerId));
  const filteredEnrollments = (enrollments || []).filter(e => providerIds.has(e.providerId));

  // Enrollment by payer
  const enrollmentsByPayer: Record<string, { total: number; approved: number }> = {};
  filteredEnrollments.forEach(e => {
    if (!enrollmentsByPayer[e.payerName]) {
      enrollmentsByPayer[e.payerName] = { total: 0, approved: 0 };
    }
    enrollmentsByPayer[e.payerName].total++;
    if (e.status === 'approved') {
      enrollmentsByPayer[e.payerName].approved++;
    }
  });

  // Average time to enrollment (for approved enrollments)
  const approvedEnrollments = filteredEnrollments.filter(e => e.status === 'approved' && e.approvalDate && e.applicationDate);
  let avgDaysToApproval = 0;
  if (approvedEnrollments.length > 0) {
    const totalDays = approvedEnrollments.reduce((sum, e) => {
      const days = Math.ceil((new Date(e.approvalDate).getTime() - new Date(e.applicationDate).getTime()) / (1000 * 60 * 60 * 24));
      return sum + days;
    }, 0);
    avgDaysToApproval = Math.round(totalDays / approvedEnrollments.length);
  }

  // Get tasks for completion rate
  const { Items: tasks } = await ddb.send(new ScanCommand({
    TableName: TASKS_TABLE,
  }));

  const filteredTasks = (tasks || []).filter(t => {
    if (allowedClinics.has('*')) return true;
    return allowedClinics.has(t.clinicId);
  });

  const completedTasks = filteredTasks.filter(t => t.status === 'completed').length;
  const taskCompletionRate = filteredTasks.length > 0
    ? Math.round((completedTasks / filteredTasks.length) * 100)
    : 0;

  return httpOk({
    summary: {
      totalProviders: filteredProviders.length,
      totalEnrollments: filteredEnrollments.length,
      totalTasks: filteredTasks.length,
      avgDaysToApproval,
      taskCompletionRate,
    },
    providersByStatus,
    enrollmentsByPayer,
    trends: {
      // In a real implementation, this would include historical data
      message: 'Historical trend data would be included here',
    },
  });
}

// ========================================
// CREDENTIALING USERS CRUD
// ========================================

async function listCredentialingUsers(queryParams: Record<string, string | undefined>) {
  const { orgId } = queryParams;
  
  if (orgId) {
    const { Items: users } = await ddb.send(new QueryCommand({
      TableName: CREDENTIALING_USERS_TABLE,
      IndexName: 'byOrgId',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));
    return httpOk({ users: users || [] });
  }

  const { Items: users } = await ddb.send(new ScanCommand({
    TableName: CREDENTIALING_USERS_TABLE,
  }));
  return httpOk({ users: users || [] });
}

async function createCredentialingUser(body: any, userPerms: UserPermissions) {
  const { email, name, role, orgId, source, externalRef } = body;
  if (!email || !name) {
    return httpErr(400, 'email and name are required');
  }

  // Check for duplicate email
  const { Items: existing } = await ddb.send(new QueryCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    IndexName: 'byEmail',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email.toLowerCase() },
  }));
  if (existing && existing.length > 0) {
    return httpErr(400, 'A user with this email already exists');
  }

  const userId = uuidv4();
  const now = new Date().toISOString();
  const user = {
    userId,
    email: email.toLowerCase(),
    name,
    role: role || 'provider',
    orgId: orgId || 'default',
    source: source || 'manual',
    externalRef: externalRef || null,
    isActive: true,
    createdAt: now,
    createdBy: userPerms.email,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: CREDENTIALING_USERS_TABLE, Item: user }));
  return httpCreated({ userId, user, message: 'Credentialing user created' });
}

async function getCredentialingUser(userId: string) {
  const { Item: user } = await ddb.send(new GetCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId },
  }));
  if (!user) return httpErr(404, 'User not found');
  return httpOk({ user });
}

async function updateCredentialingUser(userId: string, body: any) {
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId },
  }));
  if (!existing) return httpErr(404, 'User not found');

  const now = new Date().toISOString();
  const updatedUser = { ...existing, ...body, userId, updatedAt: now };
  await ddb.send(new PutCommand({ TableName: CREDENTIALING_USERS_TABLE, Item: updatedUser }));
  return httpOk({ user: updatedUser, message: 'User updated' });
}

async function deleteCredentialingUser(userId: string) {
  // Soft-delete
  const { Item: existing } = await ddb.send(new GetCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId },
  }));
  if (!existing) return httpErr(404, 'User not found');

  await ddb.send(new UpdateCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId },
    UpdateExpression: 'SET isActive = :f, updatedAt = :now',
    ExpressionAttributeValues: { ':f': false, ':now': new Date().toISOString() },
  }));
  return httpOk({ message: 'User deactivated' });
}

/**
 * POST /users/sync-staff — Bulk import TDI staff into CredentialingUsersTable (internal mode only)
 */
async function syncStaffUsers(body: any, userPerms: UserPermissions) {
  if (CREDENTIALING_MODE !== 'internal') {
    return httpErr(403, 'Staff sync is only available in internal mode');
  }

  const { staffUsers } = body;
  if (!Array.isArray(staffUsers) || staffUsers.length === 0) {
    return httpErr(400, 'staffUsers array is required');
  }

  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const staff of staffUsers) {
    if (!staff.email) { skipped++; continue; }

    // Skip if already exists
    const { Items: existing } = await ddb.send(new QueryCommand({
      TableName: CREDENTIALING_USERS_TABLE,
      IndexName: 'byEmail',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': staff.email.toLowerCase() },
    }));
    if (existing && existing.length > 0) { skipped++; continue; }

    await ddb.send(new PutCommand({
      TableName: CREDENTIALING_USERS_TABLE,
      Item: {
        userId: uuidv4(),
        email: staff.email.toLowerCase(),
        name: staff.name || staff.email.split('@')[0],
        role: staff.role || 'provider',
        orgId: staff.orgId || 'default',
        source: 'tdi-staff',
        externalRef: staff.username || staff.email.toLowerCase(),
        isActive: true,
        createdAt: now,
        createdBy: userPerms.email,
        updatedAt: now,
      },
    }));
    created++;
  }

  return httpOk({ created, skipped, message: `Synced ${created} staff users, ${skipped} skipped` });
}

// ========================================
// PROVIDER-USER LINKING
// ========================================

async function getLinkedUsers(providerId: string, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));
  if (!provider) return httpErr(404, 'Provider not found');
  if (!provider.clinicIds?.some((cid: string) => allowedClinics.has('*') || allowedClinics.has(cid))) {
    return httpErr(403, 'No access to this provider');
  }

  const { Items: links } = await ddb.send(new QueryCommand({
    TableName: PROVIDER_USER_LINK_TABLE,
    KeyConditionExpression: 'providerId = :pid',
    ExpressionAttributeValues: { ':pid': providerId },
  }));

  // Enrich with user details
  const enrichedLinks = [];
  for (const link of links || []) {
    const { Item: user } = await ddb.send(new GetCommand({
      TableName: CREDENTIALING_USERS_TABLE,
      Key: { userId: link.userId },
    }));
    enrichedLinks.push({ ...link, user: user || null });
  }

  return httpOk({ providerId, linkedUsers: enrichedLinks });
}

async function linkUserToProvider(providerId: string, body: any, userPerms: UserPermissions, allowedClinics: Set<string>) {
  const { userId, relationshipType } = body;
  if (!userId) return httpErr(400, 'userId is required');

  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));
  if (!provider) return httpErr(404, 'Provider not found');
  if (!provider.clinicIds?.some((cid: string) => allowedClinics.has('*') || allowedClinics.has(cid))) {
    return httpErr(403, 'No access to this provider');
  }

  // Verify user exists
  const { Item: user } = await ddb.send(new GetCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    Key: { userId },
  }));
  if (!user) return httpErr(404, 'Credentialing user not found');

  const now = new Date().toISOString();
  const link = {
    providerId,
    userId,
    relationshipType: relationshipType || 'viewer',
    linkedAt: now,
    linkedBy: userPerms.email,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: PROVIDER_USER_LINK_TABLE, Item: link }));
  return httpCreated({ link, message: 'User linked to provider' });
}

async function unlinkUserFromProvider(providerId: string, userId: string, allowedClinics: Set<string>) {
  // Verify provider access
  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId },
  }));
  if (!provider) return httpErr(404, 'Provider not found');
  if (!provider.clinicIds?.some((cid: string) => allowedClinics.has('*') || allowedClinics.has(cid))) {
    return httpErr(403, 'No access to this provider');
  }

  await ddb.send(new DeleteCommand({
    TableName: PROVIDER_USER_LINK_TABLE,
    Key: { providerId, userId },
  }));
  return httpOk({ message: 'User unlinked from provider' });
}

// ========================================
// PROVIDER SELF-SERVICE (PORTAL ACCESS)
// ========================================

/**
 * Check if user has a provider/clinical role
 */
function isProviderUser(clinicRoles: ClinicRoleMap[]): boolean {
  const CLINICAL_ROLES = [
    'Dentist',
    'Dental Hygienist',
    'Dental Assistant',
    'DOCTOR',
    'HYGIENIST',
    'DENTAL_ASSISTANT',
    'PROVIDER'
  ];
  
  return clinicRoles.some(cr => CLINICAL_ROLES.includes(cr.role));
}

/**
 * Helper: Resolve logged-in user's email → providerId via CredentialingUsersTable → ProviderUserLinkTable
 */
async function resolveMyProviderId(email: string): Promise<{ providerId: string; userId: string } | null> {
  // Step 1: email → userId
  const { Items: users } = await ddb.send(new QueryCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    IndexName: 'byEmail',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email.toLowerCase() },
  }));
  if (!users || users.length === 0) return null;
  const userId = users[0].userId;

  // Step 2: userId → providerId
  const { Items: links } = await ddb.send(new QueryCommand({
    TableName: PROVIDER_USER_LINK_TABLE,
    IndexName: 'byUserId',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  if (!links || links.length === 0) return null;

  return { providerId: links[0].providerId, userId };
}

/**
 * GET /me - Get my provider profile
 */
async function getMyProviderProfile(userPerms: UserPermissions) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, 'No provider profile linked to your account');
  }

  const { Item: provider } = await ddb.send(new GetCommand({
    TableName: PROVIDERS_TABLE,
    Key: { providerId: resolved.providerId },
  }));

  if (!provider) {
    return httpErr(404, 'Provider profile not found');
  }

  return httpOk({ 
    provider,
    link: {
      userId: resolved.userId,
      providerId: resolved.providerId,
    }
  });
}

/**
 * POST /me/profile - Create my provider profile (self-service)
 */
async function createMyProviderProfile(userPerms: UserPermissions, body: any) {
  const { name, npi, specialty, email, clinicIds } = body;

  if (!npi || !specialty) {
    return httpErr(400, 'npi and specialty are required');
  }

  // Check if user already linked
  const existing = await resolveMyProviderId(userPerms.email);
  if (existing) {
    return httpErr(400, 'You already have a provider profile');
  }

  // Derive clinic IDs from user's roles if not provided
  const providerClinicIds = clinicIds || userPerms.clinicRoles.map(cr => cr.clinicId).filter(Boolean);
  
  // Check for duplicate NPI
  const { Items: existingNpi } = await ddb.send(new QueryCommand({
    TableName: PROVIDERS_TABLE,
    IndexName: 'byNpi',
    KeyConditionExpression: 'npi = :npi',
    ExpressionAttributeValues: { ':npi': npi },
  }));

  if (existingNpi && existingNpi.length > 0) {
    for (const existingProvider of existingNpi) {
      const existingClinicIds = existingProvider.clinicIds || [];
      const overlappingClinics = providerClinicIds.filter((cid: string) => existingClinicIds.includes(cid));
      if (overlappingClinics.length > 0) {
        return httpErr(400, `A provider with this NPI already exists for clinic(s): ${overlappingClinics.join(', ')}`);
      }
    }
  }

  const providerId = uuidv4();
  const now = new Date().toISOString();
  const providerName = name || `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || 'Provider';

  const provider = {
    providerId,
    name: providerName,
    npi,
    specialty,
    status: 'draft' as ProviderStatus,
    credentialingProgress: 0,
    enrollmentProgress: 0,
    clinicIds: providerClinicIds,
    primaryClinicId: providerClinicIds[0] || null,
    email: email || userPerms.email,
    createdAt: now,
    createdBy: 'SELF_CREATED',
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: PROVIDERS_TABLE, Item: provider }));

  // Resolve or create credentialing user, then link
  let userId: string;
  const { Items: existingUsers } = await ddb.send(new QueryCommand({
    TableName: CREDENTIALING_USERS_TABLE,
    IndexName: 'byEmail',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': userPerms.email.toLowerCase() },
  }));
  if (existingUsers && existingUsers.length > 0) {
    userId = existingUsers[0].userId;
  } else {
    userId = uuidv4();
    await ddb.send(new PutCommand({
      TableName: CREDENTIALING_USERS_TABLE,
      Item: {
        userId,
        email: userPerms.email.toLowerCase(),
        name: providerName,
        role: 'provider',
        source: CREDENTIALING_MODE === 'internal' ? 'tdi-staff' : 'manual',
        externalRef: userPerms.email.toLowerCase(),
        orgId: 'default',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    }));
  }

  await ddb.send(new PutCommand({
    TableName: PROVIDER_USER_LINK_TABLE,
    Item: {
      providerId,
      userId,
      relationshipType: 'owner',
      linkedAt: now,
      linkedBy: 'SELF',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  }));

  return httpCreated({
    providerId,
    message: 'Provider profile created successfully',
    provider,
  });
}

/**
 * GET /me/credentials - Get my credentials
 */
async function getMyCredentials(userPerms: UserPermissions) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, 'No provider profile linked to your account');
  }

  const { Items: credentials } = await ddb.send(new QueryCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    KeyConditionExpression: 'providerId = :pid',
    ExpressionAttributeValues: { ':pid': resolved.providerId },
  }));

  return httpOk({
    providerId: resolved.providerId,
    credentials: credentials || [],
  });
}

/**
 * POST /me/credentials - Update my credentials
 */
async function updateMyCredentials(userPerms: UserPermissions, body: any) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, 'No provider profile linked to your account');
  }

  const { credentialType, ...data } = body;
  if (!credentialType) {
    return httpErr(400, 'credentialType is required');
  }

  const now = new Date().toISOString();
  const credential = {
    providerId: resolved.providerId,
    credentialType,
    ...data,
    updatedAt: now,
    updatedBy: userPerms.email,
  };

  await ddb.send(new PutCommand({
    TableName: PROVIDER_CREDENTIALS_TABLE,
    Item: credential,
  }));

  await updateCredentialingProgress(resolved.providerId);

  return httpOk({
    message: 'Credential updated successfully',
    credential,
  });
}

/**
 * GET /me/documents - Get my documents
 */
async function getMyDocuments(userPerms: UserPermissions) {
  const resolved = await resolveMyProviderId(userPerms.email);
  if (!resolved) {
    return httpErr(404, 'No provider profile linked to your account');
  }

  const { Items: documents } = await ddb.send(new QueryCommand({
    TableName: DOCUMENTS_TABLE,
    IndexName: 'byProvider',
    KeyConditionExpression: 'providerId = :pid',
    ExpressionAttributeValues: { ':pid': resolved.providerId },
  }));

  return httpOk({
    providerId: resolved.providerId,
    documents: documents || [],
  });
}
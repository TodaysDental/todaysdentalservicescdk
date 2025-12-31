// services/accounting/index.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { TextractClient, AnalyzeExpenseCommand } from '@aws-sdk/client-textract';
import { v4 as uuidv4 } from 'uuid';
import {
  Invoice,
  InvoiceSource,
  InvoiceStatus,
  BankStatement,
  PaymentMode,
  OpenDentalReport,
  Reconciliation,
  ReconciliationRow,
  ColumnConfig,
  UserPermissions,
  UploadInvoiceRequest,
  FetchPaymentsRequest,
  GenerateReconciliationRequest,
} from './types';
import { getClinicConfig } from '../../shared/utils/opendental-api';

// Environment Variables
const INVOICES_TABLE = process.env.INVOICES_TABLE!;
const BANK_STATEMENTS_TABLE = process.env.BANK_STATEMENTS_TABLE!;
const OPENDENTAL_REPORTS_TABLE = process.env.OPENDENTAL_REPORTS_TABLE!;
const RECONCILIATION_TABLE = process.env.RECONCILIATION_TABLE!;
const COLUMN_CONFIG_TABLE = process.env.COLUMN_CONFIG_TABLE!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const textract = new TextractClient({});

// ========================================
// HTTP HELPERS
// ========================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

const httpErr = (code: number, message: string) => ({
  statusCode: code,
  headers: corsHeaders,
  body: JSON.stringify({ success: false, message }),
});

const httpOk = (data: Record<string, any>) => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify({ success: true, ...data }),
});

const httpCreated = (data: Record<string, any>) => ({
  statusCode: 201,
  headers: corsHeaders,
  body: JSON.stringify({ success: true, ...data }),
});

// ========================================
// ACCESS CONTROL
// ========================================

function hasClinicAccess(allowedClinics: Set<string>, clinicId: string): boolean {
  return allowedClinics.has(clinicId);
}

function isAdmin(userPerms: UserPermissions): boolean {
  if (userPerms.isGlobalSuperAdmin) return true;
  return userPerms.clinicRoles.some(cr => cr.role === 'ADMIN' || cr.role === 'SUPER_ADMIN');
}

function getAllowedClinics(userPerms: UserPermissions): Set<string> {
  return new Set(userPerms.clinicRoles.map(cr => cr.clinicId));
}

// ========================================
// MAIN HANDLER
// ========================================

export async function handler(event: any) {
  console.log('[Accounting] Event:', JSON.stringify(event, null, 2));

  const method = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.rawPath || '';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Get user permissions from authorizer context
  const authContext = event.requestContext?.authorizer;
  if (!authContext) {
    return httpErr(401, 'Unauthorized: No authorizer context');
  }

  let userPerms: UserPermissions;
  try {
    userPerms = typeof authContext.userPermissions === 'string'
      ? JSON.parse(authContext.userPermissions)
      : authContext.userPermissions;
  } catch {
    return httpErr(401, 'Unauthorized: Invalid user permissions');
  }

  const allowedClinics = getAllowedClinics(userPerms);
  const pathParams = event.pathParameters || {};
  const queryParams = event.queryStringParameters || {};
  let body: any = {};
  
  try {
    if (event.body) {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    }
  } catch {
    return httpErr(400, 'Invalid JSON body');
  }

  try {
    // ========================================
    // INVOICES ROUTES
    // ========================================

    // GET /invoices - List invoices for clinic
    if (method === 'GET' && path.match(/^\/invoices\/?$/)) {
      const { clinicId } = queryParams;
      if (!clinicId) return httpErr(400, 'clinicId is required');
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await listInvoices(clinicId);
    }

    // POST /invoices/upload - Get presigned URL for invoice upload
    if (method === 'POST' && path.match(/^\/invoices\/upload\/?$/)) {
      const { clinicId, source, fileName, contentType } = body as UploadInvoiceRequest;
      if (!clinicId || !source || !fileName) {
        return httpErr(400, 'clinicId, source, and fileName are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await createInvoiceUploadUrl(clinicId, source, fileName, contentType || 'application/pdf');
    }

    // GET /invoices/{invoiceId} - Get single invoice
    if (method === 'GET' && pathParams.invoiceId) {
      return await getInvoice(pathParams.invoiceId, allowedClinics);
    }

    // PUT /invoices/{invoiceId} - Update invoice metadata
    if (method === 'PUT' && pathParams.invoiceId) {
      return await updateInvoice(pathParams.invoiceId, body, allowedClinics);
    }

    // DELETE /invoices/{invoiceId} - Delete invoice
    if (method === 'DELETE' && pathParams.invoiceId) {
      return await deleteInvoice(pathParams.invoiceId, allowedClinics);
    }

    // ========================================
    // BRS ROUTES
    // ========================================

    // GET /brs/open-dental - Fetch OpenDental payment data
    if (method === 'GET' && path.match(/^\/brs\/open-dental\/?$/)) {
      const { clinicId, paymentMode, dateStart, dateEnd } = queryParams;
      if (!clinicId || !paymentMode || !dateStart || !dateEnd) {
        return httpErr(400, 'clinicId, paymentMode, dateStart, dateEnd are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await fetchOpenDentalPayments(clinicId, paymentMode as PaymentMode, dateStart, dateEnd);
    }

    // GET /brs/odoo - Fetch Odoo bank transactions
    if (method === 'GET' && path.match(/^\/brs\/odoo\/?$/)) {
      const { clinicId, dateStart, dateEnd } = queryParams;
      if (!clinicId || !dateStart || !dateEnd) {
        return httpErr(400, 'clinicId, dateStart, dateEnd are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await fetchOdooBankTransactions(clinicId, dateStart, dateEnd);
    }

    // POST /brs/bank-file/upload - Upload bank statement file
    if (method === 'POST' && path.match(/^\/brs\/bank-file\/upload\/?$/)) {
      const { clinicId, paymentMode, fileName, contentType } = body;
      if (!clinicId || !paymentMode || !fileName) {
        return httpErr(400, 'clinicId, paymentMode, and fileName are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await createBankFileUploadUrl(clinicId, paymentMode, fileName, contentType || 'text/csv');
    }

    // GET /brs/bank-file - Get bank statement data
    if (method === 'GET' && path.match(/^\/brs\/bank-file\/?$/)) {
      const { clinicId, paymentMode } = queryParams;
      if (!clinicId || !paymentMode) {
        return httpErr(400, 'clinicId and paymentMode are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await getBankStatements(clinicId, paymentMode as PaymentMode);
    }

    // POST /brs/reconcile - Generate reconciliation
    if (method === 'POST' && path.match(/^\/brs\/reconcile\/?$/)) {
      const { clinicId, paymentMode, dateStart, dateEnd, bankStatementId } = body as GenerateReconciliationRequest;
      if (!clinicId || !paymentMode || !dateStart || !dateEnd) {
        return httpErr(400, 'clinicId, paymentMode, dateStart, dateEnd are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await generateReconciliation(clinicId, paymentMode, dateStart, dateEnd, bankStatementId);
    }

    // GET /brs/reconciliation/{reconciliationId} - Get reconciliation details
    if (method === 'GET' && pathParams.reconciliationId) {
      return await getReconciliation(pathParams.reconciliationId, allowedClinics);
    }

    // POST /brs/approve - Approve reconciliation
    if (method === 'POST' && path.match(/^\/brs\/approve\/?$/)) {
      const { reconciliationId } = body;
      if (!reconciliationId) {
        return httpErr(400, 'reconciliationId is required');
      }
      return await approveReconciliation(reconciliationId, userPerms, allowedClinics);
    }

    // GET /brs/column-config - Get column configuration
    if (method === 'GET' && path.match(/^\/brs\/column-config\/?$/)) {
      const { clinicId, paymentMode } = queryParams;
      if (!clinicId || !paymentMode) {
        return httpErr(400, 'clinicId and paymentMode are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await getColumnConfig(clinicId, paymentMode as PaymentMode);
    }

    // PUT /brs/column-config - Update column configuration
    if (method === 'PUT' && path.match(/^\/brs\/column-config\/?$/)) {
      const { clinicId, paymentMode, columns } = body;
      if (!clinicId || !paymentMode || !columns) {
        return httpErr(400, 'clinicId, paymentMode, and columns are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await updateColumnConfig(clinicId, paymentMode, columns, userPerms.username);
    }

    return httpErr(404, `Not found: ${method} ${path}`);
  } catch (error: any) {
    console.error('[Accounting] Error:', error);
    return httpErr(500, error.message || 'Internal server error');
  }
}

// ========================================
// INVOICES BUSINESS LOGIC
// ========================================

async function listInvoices(clinicId: string) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: INVOICES_TABLE,
    IndexName: 'byClinic',
    KeyConditionExpression: 'clinicId = :clinicId',
    ExpressionAttributeValues: { ':clinicId': clinicId },
    ScanIndexForward: false, // Most recent first
  }));
  return httpOk({ invoices: Items || [] });
}

async function createInvoiceUploadUrl(
  clinicId: string,
  source: InvoiceSource,
  fileName: string,
  contentType: string
) {
  const invoiceId = uuidv4();
  const s3Key = `invoices/${clinicId}/${invoiceId}/${fileName}`;
  const now = new Date().toISOString();

  // Create invoice record in DynamoDB
  const invoice: Invoice = {
    invoiceId,
    clinicId,
    source,
    status: 'SCANNED',
    fileUrl: `https://${DOCUMENTS_BUCKET}.s3.amazonaws.com/${s3Key}`,
    s3Key,
    createdAt: now,
  };

  await ddb.send(new PutCommand({
    TableName: INVOICES_TABLE,
    Item: invoice,
  }));

  // Generate presigned URL for upload
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      ContentType: contentType,
    }),
    { expiresIn: 3600 }
  );

  return httpCreated({ invoiceId, uploadUrl, s3Key });
}

async function getInvoice(invoiceId: string, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId },
  }));

  if (!Item) return httpErr(404, 'Invoice not found');
  if (!hasClinicAccess(allowedClinics, Item.clinicId)) {
    return httpErr(403, 'Forbidden: no access to this clinic');
  }

  return httpOk({ invoice: Item });
}

async function updateInvoice(invoiceId: string, updates: any, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId },
  }));

  if (!Item) return httpErr(404, 'Invoice not found');
  if (!hasClinicAccess(allowedClinics, Item.clinicId)) {
    return httpErr(403, 'Forbidden: no access to this clinic');
  }

  const updateExpressions: string[] = [];
  const expressionValues: Record<string, any> = {};
  const expressionNames: Record<string, string> = {};

  if (updates.vendorName !== undefined) {
    updateExpressions.push('#vendorName = :vendorName');
    expressionNames['#vendorName'] = 'vendorName';
    expressionValues[':vendorName'] = updates.vendorName;
  }
  if (updates.vendorId !== undefined) {
    updateExpressions.push('#vendorId = :vendorId');
    expressionNames['#vendorId'] = 'vendorId';
    expressionValues[':vendorId'] = updates.vendorId;
  }
  if (updates.dueDate !== undefined) {
    updateExpressions.push('#dueDate = :dueDate');
    expressionNames['#dueDate'] = 'dueDate';
    expressionValues[':dueDate'] = updates.dueDate;
  }
  if (updates.amount !== undefined) {
    updateExpressions.push('#amount = :amount');
    expressionNames['#amount'] = 'amount';
    expressionValues[':amount'] = updates.amount;
  }
  if (updates.status !== undefined) {
    updateExpressions.push('#status = :status');
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = updates.status;
  }

  updateExpressions.push('#updatedAt = :updatedAt');
  expressionNames['#updatedAt'] = 'updatedAt';
  expressionValues[':updatedAt'] = new Date().toISOString();

  await ddb.send(new UpdateCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
  }));

  return httpOk({ invoiceId, message: 'Invoice updated successfully' });
}

async function deleteInvoice(invoiceId: string, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId },
  }));

  if (!Item) return httpErr(404, 'Invoice not found');
  if (!hasClinicAccess(allowedClinics, Item.clinicId)) {
    return httpErr(403, 'Forbidden: no access to this clinic');
  }

  await ddb.send(new DeleteCommand({
    TableName: INVOICES_TABLE,
    Key: { invoiceId },
  }));

  return httpOk({ message: 'Invoice deleted successfully' });
}

// ========================================
// BRS BUSINESS LOGIC
// ========================================

async function fetchOpenDentalPayments(
  clinicId: string,
  paymentMode: PaymentMode,
  dateStart: string,
  dateEnd: string
) {
  // For now, return placeholder - will be implemented with actual OpenDental API calls
  // This will use the opendental-api utility to fetch payments
  const reportId = uuidv4();
  const now = new Date().toISOString();

  const report: OpenDentalReport = {
    reportId,
    clinicId,
    paymentMode,
    reportDate: now,
    dateStart,
    dateEnd,
    rows: [],
    createdAt: now,
  };

  // TODO: Call OpenDental API to fetch actual payments
  // const clinicConfig = getClinicConfig(clinicId);
  // const payments = await getPatientPayments(clinicId, { dateStart, dateEnd, payType });

  return httpOk({ report });
}

async function fetchOdooBankTransactions(clinicId: string, dateStart: string, dateEnd: string) {
  // Get clinic config to find Odoo company ID
  const clinicConfig = getClinicConfig(clinicId);
  if (!clinicConfig) {
    return httpErr(404, `Clinic config not found for ${clinicId}`);
  }

  const odooCompanyId = (clinicConfig as any).odooCompanyId;
  if (!odooCompanyId) {
    return httpErr(400, `Odoo company ID not configured for clinic ${clinicId}`);
  }

  // TODO: Implement actual Odoo API call using odoo-api utility
  // For now, return placeholder
  return httpOk({
    clinicId,
    odooCompanyId,
    dateStart,
    dateEnd,
    transactions: [],
  });
}

async function createBankFileUploadUrl(
  clinicId: string,
  paymentMode: PaymentMode,
  fileName: string,
  contentType: string
) {
  const bankStatementId = uuidv4();
  const s3Key = `bank-files/${clinicId}/${paymentMode}/${bankStatementId}/${fileName}`;
  const now = new Date().toISOString();

  const bankStatement: BankStatement = {
    bankStatementId,
    clinicId,
    paymentMode,
    uploadDate: now,
    s3FileKey: s3Key,
    fileName,
    parsedRows: [],
    status: 'UPLOADED',
  };

  await ddb.send(new PutCommand({
    TableName: BANK_STATEMENTS_TABLE,
    Item: bankStatement,
  }));

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      ContentType: contentType,
    }),
    { expiresIn: 3600 }
  );

  return httpCreated({ bankStatementId, uploadUrl, s3Key });
}

async function getBankStatements(clinicId: string, paymentMode: PaymentMode) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: BANK_STATEMENTS_TABLE,
    IndexName: 'byClinic',
    KeyConditionExpression: 'clinicId = :clinicId',
    FilterExpression: 'paymentMode = :paymentMode',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':paymentMode': paymentMode,
    },
    ScanIndexForward: false,
  }));
  return httpOk({ bankStatements: Items || [] });
}

async function generateReconciliation(
  clinicId: string,
  paymentMode: PaymentMode,
  dateStart: string,
  dateEnd: string,
  bankStatementId?: string
) {
  const reconciliationId = uuidv4();
  const now = new Date().toISOString();

  // TODO: Implement actual reconciliation logic
  // 1. Fetch OpenDental payments for the date range
  // 2. Fetch bank transactions (from Odoo or uploaded file)
  // 3. Match using the appropriate strategy for paymentMode
  // 4. Generate reconciliation rows

  const reconciliation: Reconciliation = {
    reconciliationId,
    clinicId,
    paymentMode,
    status: 'DRAFT',
    dateStart,
    dateEnd,
    rows: [],
    createdAt: now,
  };

  await ddb.send(new PutCommand({
    TableName: RECONCILIATION_TABLE,
    Item: reconciliation,
  }));

  return httpCreated({ reconciliation });
}

async function getReconciliation(reconciliationId: string, allowedClinics: Set<string>) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId },
  }));

  if (!Item) return httpErr(404, 'Reconciliation not found');
  if (!hasClinicAccess(allowedClinics, Item.clinicId)) {
    return httpErr(403, 'Forbidden: no access to this clinic');
  }

  return httpOk({ reconciliation: Item });
}

async function approveReconciliation(
  reconciliationId: string,
  userPerms: UserPermissions,
  allowedClinics: Set<string>
) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId },
  }));

  if (!Item) return httpErr(404, 'Reconciliation not found');
  if (!hasClinicAccess(allowedClinics, Item.clinicId)) {
    return httpErr(403, 'Forbidden: no access to this clinic');
  }
  if (Item.status === 'APPROVED') {
    return httpErr(400, 'Reconciliation is already approved');
  }

  const now = new Date().toISOString();

  await ddb.send(new UpdateCommand({
    TableName: RECONCILIATION_TABLE,
    Key: { reconciliationId },
    UpdateExpression: 'SET #status = :status, approvedAt = :approvedAt, approvedBy = :approvedBy',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'APPROVED',
      ':approvedAt': now,
      ':approvedBy': userPerms.username,
    },
  }));

  return httpOk({ status: 'APPROVED', approvedAt: now, approvedBy: userPerms.username });
}

async function getColumnConfig(clinicId: string, paymentMode: PaymentMode) {
  const configKey = `${clinicId}#${paymentMode}`;
  const { Item } = await ddb.send(new GetCommand({
    TableName: COLUMN_CONFIG_TABLE,
    Key: { configKey },
  }));

  if (!Item) {
    // Return default column configuration
    return httpOk({
      columnConfig: getDefaultColumnConfig(clinicId, paymentMode),
    });
  }

  return httpOk({ columnConfig: Item });
}

async function updateColumnConfig(
  clinicId: string,
  paymentMode: PaymentMode,
  columns: any[],
  updatedBy: string
) {
  const configKey = `${clinicId}#${paymentMode}`;
  const now = new Date().toISOString();

  const columnConfig: ColumnConfig = {
    configKey,
    clinicId,
    paymentMode,
    columns,
    updatedAt: now,
    updatedBy,
  };

  await ddb.send(new PutCommand({
    TableName: COLUMN_CONFIG_TABLE,
    Item: columnConfig,
  }));

  return httpOk({ columnConfig });
}

function getDefaultColumnConfig(clinicId: string, paymentMode: PaymentMode): ColumnConfig {
  return {
    configKey: `${clinicId}#${paymentMode}`,
    clinicId,
    paymentMode,
    columns: [
      { key: 'referenceId', label: 'Reference ID', visible: true, order: 1 },
      { key: 'patientName', label: 'Patient Name', visible: true, order: 2 },
      { key: 'expectedAmount', label: 'Expected Amount', visible: true, order: 3 },
      { key: 'receivedAmount', label: 'Received Amount', visible: true, order: 4 },
      { key: 'difference', label: 'Difference', visible: true, order: 5 },
      { key: 'status', label: 'Status', visible: true, order: 6 },
      { key: 'reason', label: 'Reason', visible: true, order: 7 },
    ],
    updatedAt: new Date().toISOString(),
  };
}

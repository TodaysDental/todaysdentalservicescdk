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
  UploadInvoiceRequest,
  FetchPaymentsRequest,
  GenerateReconciliationRequest,
} from './types';
import { getClinicConfig, getOdooConfig } from '../../shared/utils/secrets-helper';
import { OdooClient } from '../../shared/utils/odoo-api';
import {
  getUserPermissions,
  getAllowedClinicIds as getAllowedClinicIdsHelper,
  hasClinicAccess as hasClinicAccessHelper,
  isAdminUser,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

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
  return hasClinicAccessHelper(allowedClinics, clinicId);
}

function isAdmin(userPerms: UserPermissions): boolean {
  return isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
}

function getAllowedClinics(userPerms: UserPermissions): Set<string> {
  return getAllowedClinicIdsHelper(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
}

// ========================================
// MAIN HANDLER
// ========================================

export async function handler(event: any) {
  console.log('[Accounting] Event:', JSON.stringify(event, null, 2));

  const method = event.httpMethod || event.requestContext?.http?.method;
  // Strip /accounting prefix from path for route matching
  let path = event.path || event.rawPath || '';
  path = path.replace(/^\/accounting/, '');

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Get user permissions from authorizer context
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return httpErr(401, 'Unauthorized: No authorizer context or invalid permissions');
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

    // POST /invoices/sync-odoo - Fetch invoices from Odoo and sync to DynamoDB
    if (method === 'POST' && path.match(/^\/invoices\/sync-odoo\/?$/)) {
      const { clinicId } = body;
      if (!clinicId) return httpErr(400, 'clinicId is required');
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await syncOdooInvoices(clinicId);
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
      return await updateColumnConfig(clinicId, paymentMode, columns, userPerms.email);
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

/**
 * Sync invoices from Odoo into DynamoDB
 * Fetches vendor bills (account.move with move_type='in_invoice') from Odoo
 * and upserts them into the Invoices table
 */
async function syncOdooInvoices(clinicId: string) {
  // Get clinic config to find Odoo company ID
  const clinicConfig = await getClinicConfig(clinicId);
  if (!clinicConfig) {
    return httpErr(404, `Clinic config not found for ${clinicId}`);
  }

  const odooCompanyId = clinicConfig.odooCompanyId;
  if (!odooCompanyId) {
    return httpErr(400, `Odoo company ID not configured for clinic ${clinicId}`);
  }

  try {
    // Retrieve Odoo credentials
    const odooConfig = await getOdooConfig();
    if (!odooConfig) {
      return httpErr(500, 'Odoo credentials not configured.');
    }

    const odooClient = new OdooClient(odooConfig);

    console.log(`[Accounting] Syncing Odoo invoices for clinic ${clinicId}, company ${odooCompanyId}`);

    // Fetch vendor invoices from Odoo
    const odooInvoices = await odooClient.getInvoices({
      companyId: Number(odooCompanyId),
    });

    console.log(`[Accounting] Fetched ${odooInvoices.length} invoices from Odoo`);

    // Get existing Odoo-sourced invoices from DynamoDB to avoid duplicates
    const { Items: existingInvoices } = await ddb.send(new QueryCommand({
      TableName: INVOICES_TABLE,
      IndexName: 'byClinic',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': clinicId },
    }));

    const existingOdooIds = new Set(
      (existingInvoices || [])
        .filter((inv: any) => inv.odooId)
        .map((inv: any) => inv.odooId)
    );

    // Map Odoo invoice state to our InvoiceStatus
    const mapOdooStatus = (state: string, paymentState: string): InvoiceStatus => {
      if (state === 'cancel') return 'ERROR';
      if (paymentState === 'paid') return 'READY_FOR_AP';
      if (state === 'posted') return 'DUE_DATE_EXTRACTED';
      return 'VENDOR_IDENTIFIED';
    };

    let synced = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const odooInv of odooInvoices) {
      // Skip if already synced
      if (existingOdooIds.has(odooInv.id)) {
        skipped++;
        continue;
      }

      const vendorName = odooInv.partner_id ? odooInv.partner_id[1] : undefined;
      const vendorId = odooInv.partner_id ? String(odooInv.partner_id[0]) : undefined;
      const dueDate = odooInv.invoice_date_due
        ? String(odooInv.invoice_date_due)
        : undefined;

      const invoice: Invoice = {
        invoiceId: uuidv4(),
        clinicId,
        source: 'ODOO',
        vendorId,
        vendorName,
        dueDate,
        amount: odooInv.amount_total,
        status: mapOdooStatus(odooInv.state, odooInv.payment_state),
        fileUrl: '',  // No file URL for Odoo-sourced invoices
        s3Key: '',    // No S3 key for Odoo-sourced invoices
        odooId: odooInv.id,
        odooRef: odooInv.name,
        createdAt: odooInv.invoice_date
          ? new Date(String(odooInv.invoice_date)).toISOString()
          : now,
      };

      await ddb.send(new PutCommand({
        TableName: INVOICES_TABLE,
        Item: invoice,
      }));

      synced++;
    }

    console.log(`[Accounting] Odoo sync complete: ${synced} synced, ${skipped} skipped (already exist)`);

    // Return updated invoice list
    const { Items } = await ddb.send(new QueryCommand({
      TableName: INVOICES_TABLE,
      IndexName: 'byClinic',
      KeyConditionExpression: 'clinicId = :clinicId',
      ExpressionAttributeValues: { ':clinicId': clinicId },
      ScanIndexForward: false,
    }));

    return httpOk({
      invoices: Items || [],
      syncResult: {
        totalFromOdoo: odooInvoices.length,
        newlySynced: synced,
        alreadyExisted: skipped,
      },
    });
  } catch (error: any) {
    console.error('[Accounting] Error syncing Odoo invoices:', error);
    return httpErr(500, `Failed to sync Odoo invoices: ${error.message}`);
  }
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
  const reportId = uuidv4();
  const now = new Date().toISOString();

  try {
    // 1. Get OpenDental API credentials from ClinicSecrets table
    const { getClinicSecrets } = await import('../../shared/utils/secrets-helper');
    const secrets = await getClinicSecrets(clinicId);
    if (!secrets || !secrets.openDentalDeveloperKey || !secrets.openDentalCustomerKey) {
      console.error(`[Accounting] No OpenDental credentials found for clinic: ${clinicId}`);
      return httpErr(400, `No OpenDental credentials configured for clinic ${clinicId}`);
    }

    const authHeader = `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`;

    // 2. Call OpenDental API to fetch payments
    //    The API supports DateEntry (on or after date) - we'll filter by dateEnd client-side
    console.log(`[Accounting] Fetching OpenDental payments for clinic=${clinicId}, mode=${paymentMode}, range=${dateStart} to ${dateEnd}`);

    const odPayments = await callOpenDentalApi(
      'GET',
      `/payments?DateEntry=${dateStart}`,
      authHeader
    );

    if (!Array.isArray(odPayments)) {
      console.warn('[Accounting] OpenDental payments response is not an array:', typeof odPayments);
      // Return empty report if no data
      const report: OpenDentalReport = {
        reportId, clinicId, paymentMode, reportDate: now, dateStart, dateEnd, rows: [], createdAt: now,
      };
      return httpOk({ report });
    }

    console.log(`[Accounting] OpenDental returned ${odPayments.length} total payments since ${dateStart}`);

    // 3. Filter payments by end date (API only supports "on or after")
    const filteredPayments = odPayments.filter((p: any) => {
      const payDate = p.PayDate || p.payDate || '';
      // PayDate format from OD API: "yyyy-MM-dd" or ISO string
      const normalizedDate = payDate.substring(0, 10); // Take just YYYY-MM-DD
      return normalizedDate <= dateEnd;
    });

    console.log(`[Accounting] ${filteredPayments.length} payments within date range ${dateStart} to ${dateEnd}`);

    // 4. Fetch patient names for unique PatNums (in batches to avoid overwhelming the API)
    const uniquePatNums = [...new Set(filteredPayments.map((p: any) => p.PatNum || p.patNum).filter(Boolean))];
    const patientNameCache = new Map<number, string>();

    // Fetch patient names in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < uniquePatNums.length; i += BATCH_SIZE) {
      const batch = uniquePatNums.slice(i, i + BATCH_SIZE);
      const patientPromises = batch.map(async (patNum: number) => {
        try {
          const patient = await callOpenDentalApi('GET', `/patients/${patNum}`, authHeader);
          // OpenDental patient response: { PatNum, LName, FName, ... } or { patNum, lName, fName, ... }
          const fName = patient?.FName || patient?.fName || '';
          const lName = patient?.LName || patient?.lName || '';
          patientNameCache.set(patNum, `${lName}, ${fName}`.trim());
        } catch (err) {
          console.warn(`[Accounting] Failed to fetch patient ${patNum}:`, err);
          patientNameCache.set(patNum, `Patient #${patNum}`);
        }
      });
      await Promise.all(patientPromises);
    }

    // 5. Map payments to OpenDentalPaymentRow format
    const rows = filteredPayments.map((p: any) => {
      const patNum = p.PatNum || p.patNum || 0;
      const payAmt = p.PayAmt || p.payAmt || 0;
      const payDate = (p.PayDate || p.payDate || '').substring(0, 10);
      const payNum = p.PayNum || p.payNum || 0;
      const payType = p.PayType || p.payType || 0;
      const payNote = p.PayNote || p.payNote || '';

      return {
        rowId: `od-${payNum}`,
        patNum,
        patientName: patientNameCache.get(patNum) || `Patient #${patNum}`,
        paymentDate: payDate,
        expectedAmount: Number(payAmt),
        paymentMode,
        referenceId: payNote || `PAY-${payNum}`,
        sourceType: 'PATIENT' as const,
        payType,
      };
    });

    console.log(`[Accounting] Mapped ${rows.length} OpenDental payment rows`);

    const report: OpenDentalReport = {
      reportId,
      clinicId,
      paymentMode,
      reportDate: now,
      dateStart,
      dateEnd,
      rows,
      createdAt: now,
    };

    // 6. Cache the report in DynamoDB for future reference
    try {
      await ddb.send(new PutCommand({
        TableName: OPENDENTAL_REPORTS_TABLE,
        Item: report,
      }));
    } catch (cacheErr) {
      console.warn('[Accounting] Failed to cache OpenDental report:', cacheErr);
      // Non-fatal - still return the data
    }

    return httpOk({ report });
  } catch (error: any) {
    console.error('[Accounting] Error fetching OpenDental payments:', error);
    return httpErr(500, `Failed to fetch OpenDental payments: ${error.message}`);
  }
}

/**
 * Make an HTTPS request to the OpenDental API (api.opendental.com).
 * Follows the same pattern as the OpenDental proxy.
 */
async function callOpenDentalApi(
  method: string,
  apiPath: string,
  authorizationHeader: string,
  body?: string
): Promise<any> {
  const https = await import('https');
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';
  const fullPath = `${API_BASE}${apiPath}`;

  const headers: Record<string, string> = {
    'Authorization': authorizationHeader,
    'Content-Type': 'application/json',
  };
  if (body) {
    headers['Content-Length'] = Buffer.byteLength(body).toString();
  }

  return new Promise<any>((resolve, reject) => {
    const options = { hostname: API_HOST, path: fullPath, method, headers };
    const req = https.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`OpenDental API returned ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchOdooBankTransactions(clinicId: string, dateStart: string, dateEnd: string) {
  // Get clinic config to find Odoo company ID
  const clinicConfig = await getClinicConfig(clinicId);
  if (!clinicConfig) {
    return httpErr(404, `Clinic config not found for ${clinicId}`);
  }

  const odooCompanyId = clinicConfig.odooCompanyId;
  if (!odooCompanyId) {
    return httpErr(400, `Odoo company ID not configured for clinic ${clinicId}`);
  }

  try {
    // Retrieve Odoo credentials from GlobalSecrets table using convenience helper
    const odooConfig = await getOdooConfig();

    if (!odooConfig) {
      console.error('[Accounting] Missing Odoo credentials in GlobalSecrets');
      return httpErr(500, 'Odoo credentials not configured. Please set odoo/config and odoo/api_key in GlobalSecrets.');
    }

    const odooClient = new OdooClient(odooConfig);

    console.log(`[Accounting] Fetching Odoo bank transactions for clinic ${clinicId}, company ${odooCompanyId}, range ${dateStart} to ${dateEnd}`);

    const transactions = await odooClient.getBankTransactions({
      companyId: Number(odooCompanyId),
      dateStart,
      dateEnd,
    });

    console.log(`[Accounting] Fetched ${transactions.length} transactions from Odoo`);

    return httpOk({
      clinicId,
      odooCompanyId,
      dateStart,
      dateEnd,
      transactions,
    });
  } catch (error: any) {
    console.error('[Accounting] Error fetching Odoo bank transactions:', error);
    return httpErr(500, `Failed to fetch Odoo bank transactions: ${error.message}`);
  }
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
      ':approvedBy': userPerms.email,
    },
  }));

  return httpOk({ status: 'APPROVED', approvedAt: now, approvedBy: userPerms.email });
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

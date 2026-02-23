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
  InvoiceType,
  BankStatement,
  PaymentMode,
  OpenDentalReport,
  Reconciliation,
  ReconciliationRow,
  ColumnConfig,
  UploadInvoiceRequest,
  FetchPaymentsRequest,
  GenerateReconciliationRequest,
  OpenDentalPaymentRow,
  BankStatementRow,
} from './types';
import { getClinicConfig, getOdooConfig, getCherryApiKey } from '../../shared/utils/secrets-helper';
import { OdooClient } from '../../shared/utils/odoo-api';
import { CherryClient, cherryTransactionsToBankRows } from '../../shared/utils/cherry-api';
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
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
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

    // GET /brs/payment-modes - Get list of all available payment modes
    if (method === 'GET' && path.match(/^\/brs\/payment-modes\/?$/)) {
      return httpOk({
        paymentModes: [
          { id: 'CREDIT_CARD', label: 'Credit Card', description: 'Visa, MasterCard, Amex, Discover card payments', icon: '💳' },
          { id: 'ACH', label: 'ACH', description: 'ACH direct deposits, Zelle, and clearing house transfers', icon: '🏦' },
          { id: 'EFT', label: 'EFT / Wire Transfer', description: 'Electronic fund transfers, NEFT, RTGS, IMPS, wire transfers', icon: '🔄' },
          { id: 'CHEQUE', label: 'Cheque', description: 'Paper cheques and money orders', icon: '📝' },
          { id: 'CHERRY', label: 'Cherry', description: 'Cherry patient financing payments', icon: '🍒' },
          { id: 'SUNBIT', label: 'Sunbit', description: 'Sunbit patient financing payments', icon: '☀️' },
          { id: 'CARE_CREDIT', label: 'CareCredit', description: 'CareCredit / Synchrony patient financing', icon: '💚' },
          { id: 'PAYCONNECT', label: 'PayConnect', description: 'PayConnect payment gateway transactions', icon: '🔗' },
          { id: 'AUTHORIZE_NET', label: 'Authorize.Net', description: 'Authorize.Net payment gateway transactions', icon: '🌐' },
        ],
      });
    }
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

    // GET /brs/odoo - Fetch Odoo bank transactions (filtered by paymentMode if provided)
    if (method === 'GET' && path.match(/^\/brs\/odoo\/?$/)) {
      const { clinicId, dateStart, dateEnd, paymentMode } = queryParams;
      if (!clinicId || !dateStart || !dateEnd) {
        return httpErr(400, 'clinicId, dateStart, dateEnd are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await fetchOdooBankTransactions(clinicId, dateStart, dateEnd, paymentMode as PaymentMode | undefined);
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

    // GET /brs/cherry - Fetch Cherry transactions for a clinic
    if (method === 'GET' && path.match(/^\/brs\/cherry\/?$/)) {
      const { clinicId, dateStart, dateEnd } = queryParams;
      if (!clinicId || !dateStart || !dateEnd) {
        return httpErr(400, 'clinicId, dateStart, dateEnd are required');
      }
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, 'Forbidden: no access to this clinic');
      }
      return await fetchCherryTransactions(clinicId, dateStart, dateEnd);
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
 * Fetches all invoice types (vendor bills, customer invoices/insurance,
 * credit notes, journal entries) from Odoo and upserts them into the Invoices table
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

    // Build a map of existing DynamoDB invoices by their odooId for quick lookup
    const existingByOdooId = new Map<number, any>();
    for (const inv of (existingInvoices || [])) {
      if (inv.odooId) {
        existingByOdooId.set(inv.odooId, inv);
      }
    }

    // Map Odoo invoice state to our InvoiceStatus
    const mapOdooStatus = (state: string, paymentState: string): InvoiceStatus => {
      if (state === 'cancel') return 'ERROR';
      if (paymentState === 'paid') return 'READY_FOR_AP';
      if (state === 'posted') return 'DUE_DATE_EXTRACTED';
      return 'VENDOR_IDENTIFIED';
    };

    // Map Odoo move_type to our InvoiceType
    const mapMoveType = (moveType: string): InvoiceType => {
      switch (moveType) {
        case 'in_invoice': return 'VENDOR_BILL';
        case 'in_refund': return 'VENDOR_CREDIT_NOTE';
        case 'out_invoice': return 'CUSTOMER_INVOICE';
        case 'out_refund': return 'CUSTOMER_CREDIT_NOTE';
        case 'entry': return 'JOURNAL_ENTRY';
        default: return 'OTHER';
      }
    };

    let synced = 0;
    let updated = 0;
    let unchanged = 0;
    const now = new Date().toISOString();

    for (const odooInv of odooInvoices) {
      const vendorName = odooInv.partner_id ? String(odooInv.partner_id[1]) : undefined;
      const vendorId = odooInv.partner_id ? String(odooInv.partner_id[0]) : undefined;
      const dueDate = odooInv.invoice_date_due
        ? String(odooInv.invoice_date_due)
        : undefined;
      const newStatus = mapOdooStatus(odooInv.state, odooInv.payment_state);

      const existing = existingByOdooId.get(odooInv.id);

      if (existing) {
        // UPDATE existing invoice with latest data from Odoo
        // (fixes missing vendorName/vendorId, and keeps status/amount in sync)
        const needsUpdate =
          existing.vendorName !== vendorName ||
          existing.vendorId !== vendorId ||
          existing.status !== newStatus ||
          existing.amount !== odooInv.amount_total ||
          existing.dueDate !== dueDate;

        if (needsUpdate) {
          await ddb.send(new UpdateCommand({
            TableName: INVOICES_TABLE,
            Key: { invoiceId: existing.invoiceId },
            UpdateExpression: 'SET vendorName = :vn, vendorId = :vi, #st = :st, amount = :amt, dueDate = :dd, updatedAt = :ua',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: {
              ':vn': vendorName || existing.vendorName || null,
              ':vi': vendorId || existing.vendorId || null,
              ':st': newStatus,
              ':amt': odooInv.amount_total,
              ':dd': dueDate || existing.dueDate || null,
              ':ua': now,
            },
          }));
          updated++;
        } else {
          unchanged++;
        }
      } else {
        // INSERT new invoice
        const invoice: Invoice = {
          invoiceId: uuidv4(),
          clinicId,
          source: 'ODOO',
          vendorId,
          vendorName,
          dueDate,
          amount: odooInv.amount_total,
          status: newStatus,
          invoiceType: mapMoveType(odooInv.move_type),
          fileUrl: '',
          s3Key: '',
          odooId: odooInv.id,
          odooRef: odooInv.name,
          odooMoveType: odooInv.move_type,
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
    }

    console.log(`[Accounting] Odoo sync complete: ${synced} new, ${updated} updated, ${unchanged} unchanged`);

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
        updated,
        unchanged,
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

/**
 * Map our PaymentMode to OpenDental PayType IDs.
 * OpenDental uses numeric PayType IDs configured per clinic.
 * We fetch definitions (Category=12 = PaymentTypes) and match by name keywords.
 */
const PAYMENT_MODE_KEYWORDS: Record<PaymentMode, string[]> = {
  EFT: ['eft', 'electronic', 'wire', 'bank transfer', 'neft', 'rtgs', 'imps', 'e-transfer', 'etransfer'],
  ACH: ['ach', 'direct deposit', 'zelle', 'clearing house', 'autopay', 'auto pay', 'dd'],
  CHEQUE: ['check', 'cheque', 'chq', 'chk', 'money order', 'cashier'],
  CREDIT_CARD: ['credit card', 'cc', 'visa', 'master', 'amex', 'discover', 'debit card', 'card'],
  PAYCONNECT: ['payconnect', 'pay connect', 'pay-connect'],
  SUNBIT: ['sunbit', 'sun bit', 'patient finance', 'patient financing'],
  AUTHORIZE_NET: ['authorize', 'auth.net', 'authorizenet', 'authorize.net'],
  CHERRY: ['cherry', 'cherry payment', 'cherry finance'],
  CARE_CREDIT: ['care credit', 'carecredit', 'synchrony', 'care-credit'],
};

/**
 * Keywords for filtering Odoo bank statement rows by payment mode.
 * When fetching bank transactions, only rows whose payment_ref, ref, name,
 * or narration contain one of these keywords will be returned for that mode.
 * This prevents Cherry reconciliation from showing wire transfers, etc.
 */
const BANK_ROW_FILTER_KEYWORDS: Partial<Record<PaymentMode, string[]>> = {
  EFT: ['wire', 'neft', 'rtgs', 'imps', 'transfer', 'eft', 'utr'],
  ACH: ['ach', 'direct deposit', 'zelle', 'clearing house', 'autopay', 'nacha'],
  CHEQUE: ['check', 'cheque', 'chq', 'chk', 'money order', 'cashier'],
  // Credit card settlement deposits appear in banks as generic merchant deposits,
  // not as "visa" or "mastercard". Banks use terms like:
  //   "MERCHANT DEPOSIT", "POS SETTLEMENT", "BATCH SETTLEMENT", etc.
  CREDIT_CARD: [
    'visa', 'mastercard', 'amex', 'discover', 'card', 'credit card', 'debit card',
    'merchant', 'merchant deposit', 'pos', 'settlement', 'batch',
    'dda deposit', 'card services', 'worldpay', 'fiserv', 'elavon',
    'first data', 'global payments', 'heartland', 'square', 'stripe', 'clover',
  ],
  PAYCONNECT: [
    'payconnect', 'pay connect', 'dentalxchange',
    'merchant', 'merchant deposit', 'settlement', 'batch',
    'dda deposit', 'card services',
  ],
  AUTHORIZE_NET: [
    'authorize', 'auth.net', 'authorizenet', 'authorize.net',
    'merchant', 'merchant deposit', 'settlement', 'batch',
    'dda deposit', 'card services',
  ],
  CHERRY: ['cherry', 'cherry payment', 'cherry financial'],
  SUNBIT: ['sunbit', 'sunbit payment'],
  CARE_CREDIT: ['carecredit', 'care credit', 'synchrony', 'synchrony bank'],
};

/**
 * Keywords to search in OpenDental PayNote field when PayType matching fails.
 * Staff typically writes the gateway/financing name in the PayNote.
 * This is the fallback filter for non-card payment modes.
 */
const PAYNOTE_FILTER_KEYWORDS: Partial<Record<PaymentMode, string[]>> = {
  CHERRY: ['cherry'],
  SUNBIT: ['sunbit'],
  CARE_CREDIT: ['carecredit', 'care credit', 'synchrony'],
  PAYCONNECT: ['payconnect', 'pay connect'],
  AUTHORIZE_NET: ['authorize', 'auth.net', 'authorizenet'],
  EFT: ['eft', 'wire', 'transfer', 'neft', 'rtgs', 'utr'],
  ACH: ['ach', 'direct deposit', 'zelle', 'clearing house'],
  CHEQUE: [],  // Cheques use CheckNum field, not PayNote
  CREDIT_CARD: [],  // Credit cards always have PayType match
};

async function getPayTypeIdsForMode(
  authHeader: string,
  paymentMode: PaymentMode
): Promise<number[]> {
  try {
    // Category=10 is PaymentType (patient payment types like Check, Cash, CC)
    // Category=32 is InsPaymentType (insurance claim payment types)
    const definitions = await callOpenDentalApi('GET', '/definitions?Category=10', authHeader);
    if (!Array.isArray(definitions)) return [];

    const keywords = PAYMENT_MODE_KEYWORDS[paymentMode] || [];
    const matchingIds: number[] = [];

    for (const def of definitions) {
      const name = (def.ItemName || def.itemName || '').toLowerCase();
      const defNum = def.DefNum || def.defNum;
      if (defNum && keywords.some(kw => name.includes(kw))) {
        matchingIds.push(Number(defNum));
      }
    }

    console.log(`[Accounting] PayType IDs for ${paymentMode}: [${matchingIds.join(', ')}] (matched from ${definitions.length} definitions, keywords: [${keywords.join(', ')}])`);
    return matchingIds;
  } catch (err: any) {
    console.warn(`[Accounting] Failed to fetch PayType definitions: ${err.message}`);
    return [];
  }
}

/**
 * Filter OpenDental payments for a specific payment mode.
 * 
 * Uses a 3-tier approach:
 *   1. PayType ID matching (most accurate — clinic has named the PayType correctly)
 *   2. PayNote keyword matching (fallback — staff wrote the gateway name in notes)
 *   3. CheckNum-based (for cheques — if CheckNum is populated, it's likely a cheque)
 * 
 * This prevents the old problem where Cherry reconciliation would get ALL 500+ payments
 * when no "Cherry" PayType existed, causing massive mismatch.
 */
async function filterPaymentsByMode(
  payments: any[],
  paymentMode: PaymentMode,
  authHeader: string
): Promise<any[]> {
  // Step 1: Try PayType-based filtering
  const payTypeIds = await getPayTypeIdsForMode(authHeader, paymentMode);

  if (payTypeIds.length > 0) {
    const byPayType = payments.filter((p: any) => {
      const pt = Number(p.PayType || p.payType || 0);
      return payTypeIds.includes(pt);
    });
    console.log(`[Accounting] ${paymentMode}: ${byPayType.length}/${payments.length} matched by PayType IDs [${payTypeIds.join(', ')}]`);

    if (byPayType.length > 0) return byPayType;
    // If PayType matched definitions but 0 payments, fall through to PayNote
    console.warn(`[Accounting] ${paymentMode}: PayType IDs matched definitions but 0 payments found — trying PayNote fallback`);
  }

  // Step 2: PayNote keyword matching (fallback for Cherry, Sunbit, CareCredit, etc.)
  const noteKeywords = PAYNOTE_FILTER_KEYWORDS[paymentMode] || [];
  if (noteKeywords.length > 0) {
    const byPayNote = payments.filter((p: any) => {
      const payNote = (p.PayNote || p.payNote || '').toLowerCase();
      return noteKeywords.some(kw => payNote.includes(kw));
    });
    console.log(`[Accounting] ${paymentMode}: ${byPayNote.length}/${payments.length} matched by PayNote keywords [${noteKeywords.join(', ')}]`);

    if (byPayNote.length > 0) return byPayNote;
    console.warn(`[Accounting] ${paymentMode}: No PayNote matches either`);
  }

  // Step 3: Special handling for CHEQUE — filter by CheckNum field
  if (paymentMode === 'CHEQUE') {
    const byCheckNum = payments.filter((p: any) => {
      const checkNum = (p.CheckNum || p.checkNum || '').trim();
      return checkNum.length > 0;
    });
    console.log(`[Accounting] CHEQUE: ${byCheckNum.length}/${payments.length} have CheckNum populated`);
    if (byCheckNum.length > 0) return byCheckNum;
  }

  // Step 4: Final fallback — return all BUT log a strong warning
  // This means we couldn't identify which payments belong to this mode
  console.error(`[Accounting] ${paymentMode}: ⚠️  Could not filter payments by PayType or PayNote — returning ALL ${payments.length} payments. Reconciliation accuracy will be low!`);
  return payments;
}

/**
 * Batch-fetch patient names from OpenDental for a list of PatNums.
 * Fetches up to BATCH_SIZE patients concurrently to avoid Lambda timeouts.
 * Returns a Map of PatNum -> "LastName, FirstName".
 */
async function fetchPatientNames(
  authHeader: string,
  patNums: number[]
): Promise<Map<number, string>> {
  const nameMap = new Map<number, string>();
  const uniquePatNums = Array.from(new Set(patNums.filter(n => n > 0)));

  if (uniquePatNums.length === 0) return nameMap;

  console.log(`[Accounting] Fetching names for ${uniquePatNums.length} unique patients`);

  // Process in batches of 5 to limit concurrency
  const BATCH_SIZE = 5;
  for (let i = 0; i < uniquePatNums.length; i += BATCH_SIZE) {
    const batch = uniquePatNums.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (patNum) => {
        try {
          const patient = await callOpenDentalApi(
            'GET',
            `/patients/${patNum}`,
            authHeader
          );
          const fName = patient?.FName || patient?.fName || '';
          const lName = patient?.LName || patient?.lName || '';
          if (fName || lName) {
            nameMap.set(patNum, `${lName}, ${fName}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, ''));
          }
        } catch {
          // Silently skip — will fallback to "Patient #PatNum"
        }
      })
    );
  }

  console.log(`[Accounting] Resolved ${nameMap.size}/${uniquePatNums.length} patient names`);
  return nameMap;
}

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
    let filteredPayments = odPayments.filter((p: any) => {
      const payDate = p.PayDate || p.payDate || '';
      // PayDate format from OD API: "yyyy-MM-dd" or ISO string
      const normalizedDate = payDate.substring(0, 10); // Take just YYYY-MM-DD
      return normalizedDate <= dateEnd;
    });

    console.log(`[Accounting] ${filteredPayments.length} payments within date range ${dateStart} to ${dateEnd}`);

    // 3b. Filter by payment mode (PayType → PayNote → CheckNum fallback)
    filteredPayments = await filterPaymentsByMode(filteredPayments, paymentMode, authHeader);

    // 4. Batch-fetch patient names from OpenDental /patients endpoint
    const allPatNums = filteredPayments.map((p: any) => Number(p.PatNum || p.patNum || 0));
    const patientNameMap = await fetchPatientNames(authHeader, allPatNums);

    // 5. Map payments to OpenDentalPaymentRow format
    const rows = filteredPayments.map((p: any) => {
      const patNum = p.PatNum || p.patNum || 0;
      const payAmt = p.PayAmt || p.payAmt || 0;
      const payDate = (p.PayDate || p.payDate || '').substring(0, 10);
      const payNum = p.PayNum || p.payNum || 0;
      const payType = p.PayType || p.payType || 0;
      const payNote = p.PayNote || p.payNote || '';
      const checkNum = p.CheckNum || p.checkNum || '';
      const patientName = patientNameMap.get(patNum) || `Patient #${patNum}`;

      // Use mode-appropriate reference:
      // CHEQUE -> CheckNum, others -> PayNote
      let referenceId = payNote || `PAY-${payNum}`;
      if (paymentMode === 'CHEQUE' && checkNum) {
        referenceId = checkNum;
      }

      return {
        rowId: `od-${payNum}`,
        patNum,
        patientName,
        paymentDate: payDate,
        expectedAmount: Number(payAmt),
        paymentMode,
        referenceId,
        checkNum: checkNum || undefined,
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

async function fetchOdooBankTransactions(clinicId: string, dateStart: string, dateEnd: string, paymentMode?: PaymentMode) {
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

    console.log(`[Accounting] Fetching Odoo bank transactions for clinic ${clinicId}, company ${odooCompanyId}, range ${dateStart} to ${dateEnd}, mode: ${paymentMode || 'ALL'}`);

    const transactions = await odooClient.getBankTransactions({
      companyId: Number(odooCompanyId),
      dateStart,
      dateEnd,
    });

    console.log(`[Accounting] Fetched ${transactions.length} total transactions from Odoo`);

    // Filter by payment mode keywords if a specific mode is requested
    let filteredTransactions = transactions;
    if (paymentMode && BANK_ROW_FILTER_KEYWORDS[paymentMode]) {
      const keywords = BANK_ROW_FILTER_KEYWORDS[paymentMode];
      filteredTransactions = transactions.filter((txn: any) => {
        const searchText = [
          txn.payment_ref || '',
          txn.ref || '',
          txn.name || '',
          txn.narration || '',
        ].join(' ').toLowerCase();
        return keywords.some(kw => searchText.includes(kw));
      });

      console.log(`[Accounting] After ${paymentMode} keyword filtering: ${filteredTransactions.length}/${transactions.length} transactions`);

      // If no transactions match the keywords, return all as fallback
      // (clinic may not have keyword-tagged bank entries)
      if (filteredTransactions.length === 0) {
        console.warn(`[Accounting] No transactions matched ${paymentMode} keywords — returning all ${transactions.length} as fallback`);
        filteredTransactions = transactions;
      }
    }

    return httpOk({
      clinicId,
      odooCompanyId,
      paymentMode: paymentMode || 'ALL',
      dateStart,
      dateEnd,
      totalTransactions: transactions.length,
      filteredCount: filteredTransactions.length,
      transactions: filteredTransactions,
    });
  } catch (error: any) {
    console.error('[Accounting] Error fetching Odoo bank transactions:', error);
    return httpErr(500, `Failed to fetch Odoo bank transactions: ${error.message}`);
  }
}

/**
 * Fetch Cherry financing transactions for a clinic.
 * Uses the per-clinic Cherry API key from ClinicSecrets.
 */
async function fetchCherryTransactions(clinicId: string, dateStart: string, dateEnd: string) {
  try {
    const cherryApiKey = await getCherryApiKey(clinicId);
    if (!cherryApiKey) {
      return httpErr(400, `No Cherry API key configured for clinic ${clinicId}. Add cherryApiKey to ClinicSecrets.`);
    }

    const cherryClient = new CherryClient({ apiKey: cherryApiKey });

    console.log(`[Accounting] Fetching Cherry transactions for clinic ${clinicId}, range ${dateStart} to ${dateEnd}`);

    const transactions = await cherryClient.getTransactions({ dateStart, dateEnd });
    const bankRows = cherryTransactionsToBankRows(transactions);

    console.log(`[Accounting] Fetched ${transactions.length} Cherry transactions (${bankRows.length} fundable)`);

    return httpOk({
      clinicId,
      dateStart,
      dateEnd,
      transactions,       // Raw Cherry transaction data
      bankRows,            // Mapped to BankStatementRow format for reconciliation
      totalTransactions: transactions.length,
      fundedTransactions: bankRows.length,
    });
  } catch (error: any) {
    console.error('[Accounting] Error fetching Cherry transactions:', error);
    return httpErr(500, `Failed to fetch Cherry transactions: ${error.message}`);
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

// ========================================
// MODE-SPECIFIC BANK DATA PROVIDERS
// ========================================

/**
 * Shared helper: fetch bank rows from Odoo and map to BankStatementRow format.
 * Used as the default/fallback data source for most payment modes.
 */
async function fetchOdooBankRows(
  clinicId: string,
  dateStart: string,
  dateEnd: string,
  modeLabel: string
): Promise<BankStatementRow[]> {
  try {
    const clinicConfig = await getClinicConfig(clinicId);
    const odooCompanyId = clinicConfig?.odooCompanyId;
    if (!odooCompanyId) {
      console.warn(`[Reconciliation] No odooCompanyId configured for clinic ${clinicId}`);
      return [];
    }

    const odooConfig = await getOdooConfig();
    if (!odooConfig) {
      console.warn('[Reconciliation] Odoo config not available');
      return [];
    }

    const odooClient = new OdooClient(odooConfig);
    const transactions = await odooClient.getBankTransactions({
      companyId: Number(odooCompanyId),
      dateStart,
      dateEnd,
    });

    console.log(`[Reconciliation][${modeLabel}] Got ${transactions.length} Odoo bank transactions`);

    // Filter by mode-specific keywords so each gateway only sees relevant bank rows.
    // If no keywords are defined for this mode, return ALL transactions.
    // If keywords are defined but none match, DO NOT FALL BACK to all —
    //   returning all transactions pollutes the matching pool with irrelevant rows
    //   and causes false "Amount-only" partial matches everywhere.
    let filtered = transactions;
    const keywords = BANK_ROW_FILTER_KEYWORDS[modeLabel as PaymentMode];
    if (keywords && keywords.length > 0) {
      filtered = transactions.filter((txn: any) => {
        const searchText = [
          txn.payment_ref || '',
          txn.ref || '',
          txn.name || '',
          txn.narration || '',
        ].join(' ').toLowerCase();
        return keywords.some((kw: string) => searchText.includes(kw));
      });
      console.log(`[Reconciliation][${modeLabel}] After keyword filtering: ${filtered.length}/${transactions.length} transactions`);

      // If keyword filtering eliminated everything, it means the bank doesn't tag
      // transactions with recognizable keywords for this mode. For card modes,
      // this likely means deposits are generic. Use ALL credit-side rows as fallback.
      if (filtered.length === 0) {
        const cardModes: PaymentMode[] = ['CREDIT_CARD', 'PAYCONNECT', 'AUTHORIZE_NET'];
        if (cardModes.includes(modeLabel as PaymentMode)) {
          // For card modes: use ALL credit (positive amount) transactions
          // since card settlements always appear as credits/deposits
          filtered = transactions.filter((txn: any) => (txn.amount || 0) > 0);
          console.warn(`[Reconciliation][${modeLabel}] No keyword matches — using all ${filtered.length} CREDIT transactions as fallback`);
        } else {
          console.warn(`[Reconciliation][${modeLabel}] No keyword matches — returning 0 rows. Bank may not have ${modeLabel} deposits in this period.`);
          // Return empty — better to show 0 bank rows than match against irrelevant data
        }
      }
    } else {
      console.log(`[Reconciliation][${modeLabel}] No keyword filter defined — using all ${transactions.length} transactions`);
    }

    return filtered.map((txn: any, idx: number) => {
      // Odoo bank statement lines have multiple reference fields:
      //   payment_ref: payment reference (often the primary ref)
      //   ref: general reference
      //   name: bank statement line label/narration
      //   narration: additional notes/memo
      // Different payment modes may store their reference in different fields.
      // We pick the best one and combine all for description.
      const paymentRef = (txn.payment_ref || '').trim();
      const ref = (txn.ref || '').trim();
      const name = (txn.name || '').trim();
      const narration = (txn.narration || '').trim();

      // Pick the best reference: prefer payment_ref, fall back to ref, then name
      // For EFT/CHEQUE, the bank often puts the UTR/check number in `name` or `ref`
      const reference = paymentRef || ref || name || '';

      // Build a rich description combining all available fields
      const descParts = [paymentRef, ref, name, narration].filter(Boolean);
      const description = Array.from(new Set(descParts)).join(' | ') || '';

      return {
        rowId: `odoo-${txn.id || idx}`,
        date: txn.date || '',
        reference,
        description,
        amount: Math.abs(txn.amount || 0),
        type: (txn.amount || 0) >= 0 ? 'CREDIT' as const : 'DEBIT' as const,
      };
    });
  } catch (err: any) {
    console.error(`[Reconciliation][${modeLabel}] Error fetching Odoo transactions:`, err.message);
    return [];
  }
}

/**
 * Fetch bank-side rows using a mode-specific data provider.
 * 
 * Each payment mode can have its own data source:
 *   - CHERRY: Cherry API → Odoo fallback
 *   - SUNBIT: (future) Sunbit API → Odoo fallback
 *   - CARE_CREDIT: (future) CareCredit API → Odoo fallback
 *   - EFT: Odoo bank statement lines (wire transfers)
 *   - CHEQUE: Odoo bank statement lines (cleared cheques)
 *   - CREDIT_CARD: Odoo bank statement lines
 *   - PAYCONNECT: Odoo bank statement lines
 *   - AUTHORIZE_NET: Odoo bank statement lines
 * 
 * All modes gracefully fall back to Odoo when their primary API is unavailable.
 */
async function fetchBankRowsForMode(
  paymentMode: PaymentMode,
  clinicId: string,
  dateStart: string,
  dateEnd: string
): Promise<BankStatementRow[]> {

  switch (paymentMode) {

    // ─── CHERRY: Fetch from Cherry API ───────────────────────────
    case 'CHERRY': {
      try {
        const cherryApiKey = await getCherryApiKey(clinicId);
        if (cherryApiKey) {
          console.log(`[Reconciliation][CHERRY] Fetching from Cherry API for clinic ${clinicId}`);
          const cherryClient = new CherryClient({ apiKey: cherryApiKey });
          const cherryTxns = await cherryClient.getTransactions({ dateStart, dateEnd });
          const rows = cherryTransactionsToBankRows(cherryTxns);
          console.log(`[Reconciliation][CHERRY] Got ${rows.length} funded rows (from ${cherryTxns.length} total)`);
          if (rows.length > 0) return rows;
        } else {
          console.warn(`[Reconciliation][CHERRY] No Cherry API key for clinic ${clinicId}`);
        }
      } catch (err: any) {
        console.error(`[Reconciliation][CHERRY] Cherry API error: ${err.message}`);
      }
      // Fallback to Odoo
      console.log('[Reconciliation][CHERRY] Falling back to Odoo bank data');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'CHERRY');
    }

    // ─── SUNBIT: Future API integration, falls back to Odoo ─────
    case 'SUNBIT': {
      // TODO: Integrate Sunbit partner API when available
      // Sunbit settlement data would provide transaction-level detail
      // similar to Cherry, enabling accurate per-patient matching.
      console.log('[Reconciliation][SUNBIT] Using Odoo bank data (Sunbit API not yet integrated)');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'SUNBIT');
    }

    // ─── CARE_CREDIT: Future API integration, falls back to Odoo ─
    case 'CARE_CREDIT': {
      // TODO: Integrate CareCredit partner API when available
      // CareCredit settlement reports would provide individual transaction references
      // for matching against OpenDental CareCredit payments.
      console.log('[Reconciliation][CARE_CREDIT] Using Odoo bank data (CareCredit API not yet integrated)');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'CARE_CREDIT');
    }

    // ─── EFT: Odoo bank statement lines (wire transfers) ────────
    case 'EFT': {
      console.log('[Reconciliation][EFT] Fetching Odoo bank transactions');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'EFT');
    }

    // ─── CHEQUE: Odoo bank statement lines (cleared cheques) ────
    case 'CHEQUE': {
      console.log('[Reconciliation][CHEQUE] Fetching Odoo bank transactions');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'CHEQUE');
    }

    // ─── CREDIT_CARD: Odoo bank data ────────────────────────────
    case 'CREDIT_CARD': {
      console.log('[Reconciliation][CREDIT_CARD] Fetching Odoo bank transactions');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'CREDIT_CARD');
    }

    // ─── PAYCONNECT: Odoo bank data ─────────────────────────────
    case 'PAYCONNECT': {
      console.log('[Reconciliation][PAYCONNECT] Fetching Odoo bank transactions');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'PAYCONNECT');
    }

    // ─── AUTHORIZE_NET: Odoo bank data ──────────────────────────
    case 'AUTHORIZE_NET': {
      console.log('[Reconciliation][AUTHORIZE_NET] Fetching Odoo bank transactions');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'AUTHORIZE_NET');
    }

    // ─── ACH: Odoo bank data (ACH/direct deposit transactions) ──
    case 'ACH': {
      console.log('[Reconciliation][ACH] Fetching Odoo bank transactions');
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, 'ACH');
    }

    // ─── Unknown mode: Odoo fallback ────────────────────────────
    default: {
      console.warn(`[Reconciliation] Unknown payment mode "${paymentMode}", using Odoo fallback`);
      return fetchOdooBankRows(clinicId, dateStart, dateEnd, paymentMode);
    }
  }
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

  // Import matching strategy
  const { runReconciliation } = await import('./matching');

  // 1. Fetch OpenDental payments for the date range
  let openDentalRows: OpenDentalPaymentRow[] = [];
  try {
    const { getClinicSecrets } = await import('../../shared/utils/secrets-helper');
    const secrets = await getClinicSecrets(clinicId);
    if (secrets?.openDentalDeveloperKey && secrets?.openDentalCustomerKey) {
      const authHeader = `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`;

      console.log(`[Reconciliation] Fetching OpenDental payments for ${clinicId}, mode=${paymentMode}, range=${dateStart} to ${dateEnd}`);

      const odPayments = await callOpenDentalApi(
        'GET',
        `/payments?DateEntry=${dateStart}`,
        authHeader
      );

      if (Array.isArray(odPayments)) {
        // Filter by end date
        let filteredPayments = odPayments.filter((p: any) => {
          const payDate = (p.PayDate || p.payDate || '').substring(0, 10);
          return payDate <= dateEnd;
        });

        // Filter by payment mode (PayType → PayNote → CheckNum fallback)
        filteredPayments = await filterPaymentsByMode(filteredPayments, paymentMode, authHeader);

        // Batch-fetch patient names from OpenDental /patients endpoint
        const reconPatNums = filteredPayments.map((p: any) => Number(p.PatNum || p.patNum || 0));
        const reconNameMap = await fetchPatientNames(authHeader, reconPatNums);

        // Map payments to rows with resolved patient names
        openDentalRows = filteredPayments.map((p: any) => {
          const patNum = p.PatNum || p.patNum || 0;
          const payAmt = p.PayAmt || p.payAmt || 0;
          const payDate = (p.PayDate || p.payDate || '').substring(0, 10);
          const payNum = p.PayNum || p.payNum || 0;
          const payNote = p.PayNote || p.payNote || '';
          const checkNum = p.CheckNum || p.checkNum || '';
          const patientName = reconNameMap.get(patNum) || `Patient #${patNum}`;

          // Use mode-appropriate reference:
          // CHEQUE -> CheckNum as primary reference
          // All other modes -> PayNote as primary reference
          // Always include both for cross-referencing in matching strategies
          let referenceId = payNote || `PAY-${payNum}`;
          if (paymentMode === 'CHEQUE' && checkNum) {
            referenceId = checkNum;
          }
          // For EFT, try to clean up the PayNote if it contains irrelevant text
          if (paymentMode === 'EFT' && payNote) {
            // Staff often paste extra text — keep only the UTR/reference part
            referenceId = payNote;
          }

          return {
            rowId: `od-${payNum}`,
            patNum,
            patientName,
            paymentDate: payDate,
            expectedAmount: Number(payAmt),
            paymentMode,
            referenceId,
            checkNum: checkNum || undefined,
            sourceType: 'PATIENT' as const,
          };
        });

        console.log(`[Reconciliation] Got ${openDentalRows.length} OpenDental payment rows`);
      }
    } else {
      console.warn(`[Reconciliation] No OpenDental credentials for clinic ${clinicId}`);
    }
  } catch (err: any) {
    console.error('[Reconciliation] Error fetching OpenDental payments:', err.message);
  }

  // 2. Fetch bank-side transactions using mode-specific data source
  //    Each payment mode can define its own bank-side data provider:
  //      - CHERRY → Cherry API (per-clinic API key)
  //      - SUNBIT → Sunbit API (future)
  //      - CARE_CREDIT → CareCredit API (future)
  //      - EFT / CHEQUE → Odoo bank statement lines
  //      - CREDIT_CARD / PAYCONNECT / AUTHORIZE_NET → Odoo or uploaded file
  //    All modes allow an uploaded bank file override via bankStatementId.
  let bankRows: BankStatementRow[] = [];

  if (bankStatementId) {
    // Override: Use uploaded bank file (any payment mode)
    try {
      const { Item } = await ddb.send(new GetCommand({
        TableName: BANK_STATEMENTS_TABLE,
        Key: { bankStatementId },
      }));
      if (Item?.parsedRows) {
        bankRows = Item.parsedRows as BankStatementRow[];
        console.log(`[Reconciliation] Got ${bankRows.length} rows from uploaded bank file`);
      }
    } catch (err: any) {
      console.error('[Reconciliation] Error loading bank file:', err.message);
    }
  } else {
    // Mode-specific bank-side data fetching
    bankRows = await fetchBankRowsForMode(paymentMode, clinicId, dateStart, dateEnd);
  }

  // 3. Run matching strategy
  console.log(`[Reconciliation] Running ${paymentMode} matching: ${openDentalRows.length} OD rows vs ${bankRows.length} bank rows`);
  const matchResults = runReconciliation(paymentMode, openDentalRows, bankRows);
  const reconRows: ReconciliationRow[] = matchResults.map(r => r.row);

  console.log(`[Reconciliation] Matching complete: ${reconRows.length} result rows`);

  // 4. Build and store reconciliation
  const reconciliation: Reconciliation = {
    reconciliationId,
    clinicId,
    paymentMode,
    status: 'DRAFT',
    dateStart,
    dateEnd,
    rows: reconRows,
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

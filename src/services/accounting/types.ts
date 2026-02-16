// Accounting Module Types

// ========================================
// INVOICE TYPES
// ========================================

export type InvoiceSource = 'WHATSAPP' | 'EMAIL' | 'MANUAL' | 'ODOO';
export type InvoiceStatus = 'SCANNED' | 'VENDOR_IDENTIFIED' | 'DUE_DATE_EXTRACTED' | 'READY_FOR_AP' | 'ERROR';

export interface Invoice {
  invoiceId: string;
  clinicId: string;
  source: InvoiceSource;
  vendorId?: string;
  vendorName?: string;
  dueDate?: string;
  amount?: number;
  status: InvoiceStatus;
  fileUrl: string;
  s3Key: string;
  rawText?: string;
  odooId?: number;          // Odoo account.move ID (for invoices synced from Odoo)
  odooRef?: string;         // Odoo invoice number (e.g., BILL/2024/0001)
  createdAt: string;
  updatedAt?: string;
}

// ========================================
// BANK STATEMENT TYPES
// ========================================

export type PaymentMode =
  | 'EFT'
  | 'CHEQUE'
  | 'CREDIT_CARD'
  | 'PAYCONNECT'
  | 'SUNBIT'
  | 'AUTHORIZE_NET'
  | 'CHERRY'
  | 'CARE_CREDIT';

export interface BankStatement {
  bankStatementId: string;
  clinicId: string;
  paymentMode: PaymentMode;
  uploadDate: string;
  s3FileKey: string;
  fileName: string;
  parsedRows: BankStatementRow[];
  status: 'UPLOADED' | 'PARSED' | 'ERROR';
}

export interface BankStatementRow {
  rowId: string;
  date: string;
  reference: string;
  description: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
}

// ========================================
// OPENDENTAL PAYMENT TYPES
// ========================================

export interface OpenDentalReport {
  reportId: string;
  clinicId: string;
  paymentMode: PaymentMode;
  reportDate: string;
  dateStart: string;
  dateEnd: string;
  rows: OpenDentalPaymentRow[];
  createdAt: string;
}

export interface OpenDentalPaymentRow {
  rowId: string;
  patNum: number;
  patientName: string;
  paymentDate: string;
  expectedAmount: number;
  paymentMode: PaymentMode;
  referenceId: string;
  sourceType: 'PATIENT' | 'INSURANCE';
  payType?: number;
}

// ========================================
// ODOO BANK TRANSACTION TYPES
// ========================================

export interface OdooBankTransaction {
  id: number;
  date: string;
  ref: string;
  payment_ref: string;
  amount: number;
  partner_id: [number, string] | false;
  statement_id: [number, string];
  company_id: [number, string];
}

// ========================================
// RECONCILIATION TYPES
// ========================================

export type ReconciliationStatus = 'DRAFT' | 'APPROVED';
export type RowMatchStatus = 'MATCHED' | 'PARTIAL' | 'UNMATCHED';

export interface Reconciliation {
  reconciliationId: string;
  clinicId: string;
  paymentMode: PaymentMode;
  status: ReconciliationStatus;
  dateStart: string;
  dateEnd: string;
  rows: ReconciliationRow[];
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface ReconciliationRow {
  rowId: string;
  referenceId: string;
  expectedAmount: number;
  receivedAmount?: number;
  status: RowMatchStatus;
  difference: number;
  reason?: string;
  openDentalRowId?: string;
  bankRowId?: string;
  patientName?: string;
}

// ========================================
// COLUMN CONFIG TYPES
// ========================================

export interface ColumnConfig {
  configKey: string; // clinicId#paymentMode
  clinicId: string;
  paymentMode: PaymentMode;
  columns: ColumnDefinition[];
  updatedAt: string;
  updatedBy?: string;
}

export interface ColumnDefinition {
  key: string;
  label: string;
  visible: boolean;
  order: number;
}

// ========================================
// API REQUEST/RESPONSE TYPES
// ========================================

export interface UploadInvoiceRequest {
  clinicId: string;
  source: InvoiceSource;
  fileName: string;
  contentType: string;
}

export interface UploadInvoiceResponse {
  invoiceId: string;
  uploadUrl: string;
  s3Key: string;
}

export interface FetchPaymentsRequest {
  clinicId: string;
  paymentMode: PaymentMode;
  dateStart: string;
  dateEnd: string;
}

export interface GenerateReconciliationRequest {
  clinicId: string;
  paymentMode: PaymentMode;
  dateStart: string;
  dateEnd: string;
  bankStatementId?: string;
}

export interface ApproveReconciliationRequest {
  reconciliationId: string;
}

// ========================================
// USER PERMISSIONS TYPE
// ========================================

export interface UserPermissions {
  username: string;
  email: string;
  isGlobalSuperAdmin: boolean;
  clinicRoles: ClinicRole[];
}

export interface ClinicRole {
  clinicId: string;
  role: string;
}

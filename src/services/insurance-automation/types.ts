/**
 * Insurance Automation Types
 * 
 * Shared interfaces for the insurance automation module.
 */

// ========================================
// COMMISSION TYPES
// ========================================

export type ServiceType = 
  | 'CREATE_INSURANCE_PLAN'   // +50 Rs
  | 'VERIFICATION'            // +25 Rs
  | 'UPDATING_PLAN'           // +25 Rs to updater, -25 Rs to original creator
  | 'FULL_BENEFITS';          // +37.5 Rs to completer, -25 Rs to incomplete creator

export type TransactionType = 'CREDIT' | 'DEBIT';

export interface CommissionTransaction {
  // DynamoDB keys
  pk: string;                    // clinicId#userId
  sk: string;                    // date#transactionId
  
  // Transaction details
  transactionId: string;
  clinicId: string;
  userId: string;
  userName: string;
  serviceType: ServiceType;
  transactionType: TransactionType;
  amount: number;                // In Rs (positive for credit, negative for debit)
  
  // Related data
  patNum?: number;
  patName?: string;
  planNum?: number;
  insuranceName?: string;
  groupName?: string;
  groupNumber?: string;
  
  // Document reference
  docNum?: number;
  docFileName?: string;
  docUploadedAt?: string;
  docValidated?: boolean;
  
  // Deduction details (if applicable)
  deductionReason?: string;
  originalCreatorUserId?: string;
  originalCreatorUserName?: string;
  
  // Audit fields
  createdAt: string;
  processedAt?: string;
  source?: 'HOURLY_SYNC' | 'REALTIME';
}

export interface CommissionSummary {
  userId: string;
  userName: string;
  clinicId: string;
  period: string;              // e.g., '2026-01' for monthly
  
  // Service counts
  createPlanCount: number;
  verificationCount: number;
  updatingPlanCount: number;
  fullBenefitsCount: number;
  
  // Earnings
  createPlanEarnings: number;  // +50 Rs each
  verificationEarnings: number; // +25 Rs each
  updatingPlanEarnings: number; // +25 Rs each
  fullBenefitsEarnings: number; // +37.5 Rs each
  
  // Deductions
  totalDeductions: number;
  deductionCount: number;
  
  // Net total
  grossEarnings: number;
  netEarnings: number;
}

// ========================================
// CONFIG TYPES
// ========================================

export interface ClinicAutomationConfig {
  clinicId: string;
  insuranceAuditEnabled: boolean;    // Hourly audit sync toggle
  noteCopyingEnabled: boolean;       // Hourly note copying toggle
  updatedAt: string;
  updatedBy: string;
}

// ========================================
// AUDIT LOG TYPES
// ========================================

export type AuditActionType =
  | 'PLAN_CREATED'
  | 'PLAN_VERIFIED'
  | 'PLAN_UPDATED'
  | 'BENEFITS_ADDED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_PROCESSED'
  | 'DOCUMENT_VALIDATED'
  | 'DOCUMENT_FAILED'
  | 'COMMISSION_CREDITED'
  | 'COMMISSION_DEBITED'
  | 'NOTE_COPIED'
  | 'CONFIG_UPDATED';

export interface AuditLogEntry {
  // DynamoDB keys
  pk: string;                    // clinicId#date (YYYY-MM-DD)
  sk: string;                    // timestamp#actionId
  
  // Log details
  actionId: string;
  clinicId: string;
  actionType: AuditActionType;
  userId: string;
  userName: string;
  
  // Related entities
  patNum?: number;
  patName?: string;
  planNum?: number;
  docNum?: number;
  transactionId?: string;
  
  // Action details
  details: Record<string, any>;
  
  // Timestamps
  timestamp: string;
  ttl: number;                   // Auto-expire after 90 days
}

// ========================================
// OPENDENTAL TYPES
// ========================================

export interface InsEditLogEntry {
  InsEditLogNum: number;
  DateTStamp: string;
  UserNum: number;
  UserName?: string;
  LogType: number;              // 0=InsPlan, 1=Carrier, 2=Benefit
  FKey: number;                 // PlanNum, CarrierNum, or BenefitNum
  ParentKey?: number;           // Parent PlanNum for benefits
  FieldName: string;
  OldValue: string | null;
  NewValue: string | null;
  Description?: string;
}

export interface DocumentEntry {
  DocNum: number;
  Description: string;
  DateCreated: string;
  DateTStamp: string;
  PatNum: number;
  FileName: string;
  DocCategory: number;
  docCategory: string;          // Human-readable category name
  ImgType: string;
  UserNum?: number;
  UserName?: string;
}

export interface SecurityLogEntry {
  SecurityLogNum: number;
  LogDateTime: string;
  UserNum: number;
  UserName?: string;
  PermType: number;             // 89=Document Moved, 202=Document Created
  FKey: number;                 // DocNum
  PatNum?: number;
  LogText?: string;
}

export interface InsPlanDetails {
  PlanNum: number;
  CarrierName: string;
  GroupName: string | null;
  GroupNumber: string | null;
  PlanNote: string | null;
  AnnualMaxIndividual: number | null;
  CreatedByUserNum?: number;
  CreatedByUserName?: string;
  CreatedAt?: string;
}

// ========================================
// API REQUEST/RESPONSE TYPES
// ========================================

export interface GetCommissionsRequest {
  userId?: string;
  clinicId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  nextToken?: string;
}

export interface GetCommissionsResponse {
  transactions: CommissionTransaction[];
  summary?: CommissionSummary;
  nextToken?: string;
}

export interface GetConfigRequest {
  clinicId: string;
}

export interface UpdateConfigRequest {
  clinicId: string;
  insuranceAuditEnabled?: boolean;
  noteCopyingEnabled?: boolean;
}

export interface ProcessDocumentRequest {
  clinicId: string;
  patNum: number;
  docNum: number;
  userId: string;
  userName: string;
}

export interface ProcessDocumentResponse {
  success: boolean;
  extractedData?: ExtractedInsuranceData;
  validationResult?: ValidationResult;
  commissionCreated?: boolean;
  error?: string;
}

// ========================================
// TEXTRACT TYPES
// ========================================

export interface ExtractedInsuranceData {
  insuranceCompany: string | null;
  groupName: string | null;
  groupNumber: string | null;
  memberId: string | null;
  subscriberName: string | null;
  planType: string | null;
  effectiveDate: string | null;
  annualMax: number | null;
  deductible: number | null;
  coveragePercentages: {
    preventive: number | null;
    basic: number | null;
    major: number | null;
  };
  rawText: string;
  confidence: number;
}

export interface ValidationResult {
  isValid: boolean;
  matchedFields: string[];
  mismatchedFields: string[];
  missingFields: string[];
  corrections?: Record<string, { expected: any; found: any }>;
  shouldDeduct: boolean;
  deductionReason?: string;
}

// ========================================
// NOTE COPYING TYPES
// ========================================

export interface PlanNoteGroup {
  insuranceName: string;
  groupName: string;
  groupNumber: string;
  annualMax?: number;           // For Humana special handling
  note: string;
  sourcePlanNum: number;
  sourcePatNum: number;
  sourceClinicId: string;
}

export interface NoteCopyResult {
  clinicId: string;
  sourcePlanNum: number;
  targetPatNums: number[];
  copiedCount: number;
  skippedCount: number;
  errors: string[];
}

// ========================================
// PRICING CONSTANTS
// ========================================

export const COMMISSION_RATES = {
  CREATE_INSURANCE_PLAN: 50,    // +50 Rs
  VERIFICATION: 25,             // +25 Rs
  UPDATING_PLAN: 25,            // +25 Rs
  FULL_BENEFITS: 37.5,          // +37.5 Rs
  DEDUCTION_UPDATING_PLAN: -25, // -25 Rs for original creator
  DEDUCTION_INCOMPLETE: -25,    // -25 Rs for incomplete creator
} as const;

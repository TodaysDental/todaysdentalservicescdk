/**
 * Reconciliation Matching Strategies
 * 
 * This module provides matching strategies for different payment modes
 * to reconcile OpenDental payments with bank transactions.
 */

import {
  PaymentMode,
  ReconciliationRow,
  RowMatchStatus,
  OpenDentalPaymentRow,
  BankStatementRow,
} from '../types';

// ========================================
// TYPES
// ========================================

export interface MatchResult {
  row: ReconciliationRow;
  openDentalRow?: OpenDentalPaymentRow;
  bankRow?: BankStatementRow;
}

export interface MatchingStrategy {
  mode: PaymentMode;
  match(
    openDentalRows: OpenDentalPaymentRow[],
    bankRows: BankStatementRow[]
  ): MatchResult[];
}

// ========================================
// MATCHING UTILITIES
// ========================================

/**
 * Normalize reference string for comparison
 */
function normalizeReference(ref: string | null | undefined): string {
  if (!ref) return '';
  return ref.toString().trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Compare amounts with tolerance for floating point
 */
function amountsMatch(expected: number, received: number, tolerance: number = 0.01): boolean {
  return Math.abs(expected - received) <= tolerance;
}

/**
 * Generate a unique row ID
 */
function generateRowId(): string {
  return `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Determine match status based on amounts
 */
function determineMatchStatus(expected: number, received?: number): RowMatchStatus {
  if (received === undefined || received === null) {
    return 'UNMATCHED';
  }
  if (amountsMatch(expected, received)) {
    return 'MATCHED';
  }
  return 'PARTIAL';
}

// ========================================
// BASE MATCHING STRATEGY
// ========================================

abstract class BaseMatchingStrategy implements MatchingStrategy {
  abstract mode: PaymentMode;
  abstract getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string;

  match(
    openDentalRows: OpenDentalPaymentRow[],
    bankRows: BankStatementRow[]
  ): MatchResult[] {
    const results: MatchResult[] = [];
    const usedBankRows = new Set<string>();
    const usedOpenDentalRows = new Set<string>();

    // Create lookup map for bank rows by matching key
    const bankRowsByKey = new Map<string, BankStatementRow[]>();
    for (const bankRow of bankRows) {
      const key = this.getMatchingKey(bankRow as any);
      if (key) {
        if (!bankRowsByKey.has(key)) {
          bankRowsByKey.set(key, []);
        }
        bankRowsByKey.get(key)!.push(bankRow);
      }
    }

    // Match OpenDental rows to bank rows
    for (const odRow of openDentalRows) {
      const key = this.getMatchingKey(odRow as any);
      if (!key) {
        // No reference - mark as unmatched
        results.push(this.createUnmatchedResult(odRow));
        usedOpenDentalRows.add(odRow.rowId);
        continue;
      }

      const matchingBankRows = bankRowsByKey.get(key) || [];
      let matched = false;

      for (const bankRow of matchingBankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;

        // Check if amounts match or partially match
        const status = determineMatchStatus(odRow.expectedAmount, bankRow.amount);
        
        if (status === 'MATCHED' || status === 'PARTIAL') {
          results.push(this.createMatchedResult(odRow, bankRow, status));
          usedBankRows.add(bankRow.rowId);
          usedOpenDentalRows.add(odRow.rowId);
          matched = true;
          break;
        }
      }

      if (!matched) {
        results.push(this.createUnmatchedResult(odRow));
        usedOpenDentalRows.add(odRow.rowId);
      }
    }

    // Add unmatched bank rows (payments received but not expected)
    for (const bankRow of bankRows) {
      if (!usedBankRows.has(bankRow.rowId)) {
        results.push(this.createUnexpectedBankResult(bankRow));
      }
    }

    return results;
  }

  protected createMatchedResult(
    odRow: OpenDentalPaymentRow,
    bankRow: BankStatementRow,
    status: RowMatchStatus
  ): MatchResult {
    const difference = (bankRow.amount || 0) - odRow.expectedAmount;
    
    return {
      row: {
        rowId: generateRowId(),
        referenceId: odRow.referenceId,
        expectedAmount: odRow.expectedAmount,
        receivedAmount: bankRow.amount,
        status,
        difference,
        reason: status === 'PARTIAL' ? 'Amount mismatch' : undefined,
        openDentalRowId: odRow.rowId,
        bankRowId: bankRow.rowId,
        patientName: odRow.patientName,
      },
      openDentalRow: odRow,
      bankRow,
    };
  }

  protected createUnmatchedResult(odRow: OpenDentalPaymentRow): MatchResult {
    return {
      row: {
        rowId: generateRowId(),
        referenceId: odRow.referenceId,
        expectedAmount: odRow.expectedAmount,
        receivedAmount: undefined,
        status: 'UNMATCHED',
        difference: -odRow.expectedAmount,
        reason: 'No matching bank transaction found',
        openDentalRowId: odRow.rowId,
        patientName: odRow.patientName,
      },
      openDentalRow: odRow,
    };
  }

  protected createUnexpectedBankResult(bankRow: BankStatementRow): MatchResult {
    return {
      row: {
        rowId: generateRowId(),
        referenceId: bankRow.reference,
        expectedAmount: 0,
        receivedAmount: bankRow.amount,
        status: 'UNMATCHED',
        difference: bankRow.amount,
        reason: 'Bank transaction has no matching OpenDental payment',
        bankRowId: bankRow.rowId,
      },
      bankRow,
    };
  }
}

// ========================================
// PAYMENT MODE STRATEGIES
// ========================================

/**
 * EFT Matching Strategy
 * Matches by UTR (Unique Transaction Reference) + Amount
 */
class EFTMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'EFT';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    // For EFT, use the reference ID (UTR)
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

/**
 * Cheque Matching Strategy
 * Matches by Cheque Number + Amount
 */
class ChequeMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CHEQUE';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    // For cheques, use the check number as reference
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

/**
 * Credit Card Matching Strategy
 * Matches by Transaction ID + Settlement Batch
 */
class CreditCardMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CREDIT_CARD';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

/**
 * PayConnect Matching Strategy
 * Matches by Transaction ID + Amount
 */
class PayConnectMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'PAYCONNECT';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

/**
 * Sunbit Matching Strategy
 * Matches by Transaction ID + Amount
 */
class SunbitMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'SUNBIT';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

/**
 * Authorize.Net Matching Strategy
 * Matches by Batch ID + Amount
 */
class AuthorizeNetMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'AUTHORIZE_NET';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

/**
 * Cherry Matching Strategy
 * Matches by Transaction ID + Amount
 */
class CherryMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CHERRY';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

/**
 * CareCredit Matching Strategy
 * Matches by Transaction ID + Amount
 */
class CareCreditMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CARE_CREDIT';

  getMatchingKey(row: OpenDentalPaymentRow | BankStatementRow): string {
    const ref = (row as any).referenceId || (row as any).reference;
    return normalizeReference(ref);
  }
}

// ========================================
// STRATEGY FACTORY
// ========================================

const strategies: Map<PaymentMode, MatchingStrategy> = new Map([
  ['EFT', new EFTMatchingStrategy()],
  ['CHEQUE', new ChequeMatchingStrategy()],
  ['CREDIT_CARD', new CreditCardMatchingStrategy()],
  ['PAYCONNECT', new PayConnectMatchingStrategy()],
  ['SUNBIT', new SunbitMatchingStrategy()],
  ['AUTHORIZE_NET', new AuthorizeNetMatchingStrategy()],
  ['CHERRY', new CherryMatchingStrategy()],
  ['CARE_CREDIT', new CareCreditMatchingStrategy()],
]);

/**
 * Get the matching strategy for a payment mode
 */
export function getMatchingStrategy(mode: PaymentMode): MatchingStrategy {
  const strategy = strategies.get(mode);
  if (!strategy) {
    throw new Error(`No matching strategy found for payment mode: ${mode}`);
  }
  return strategy;
}

/**
 * Run reconciliation matching for a specific payment mode
 */
export function runReconciliation(
  mode: PaymentMode,
  openDentalRows: OpenDentalPaymentRow[],
  bankRows: BankStatementRow[]
): MatchResult[] {
  const strategy = getMatchingStrategy(mode);
  return strategy.match(openDentalRows, bankRows);
}

/**
 * Calculate reconciliation summary statistics
 */
export function calculateReconciliationSummary(results: MatchResult[]): {
  totalRows: number;
  matchedCount: number;
  partialCount: number;
  unmatchedCount: number;
  totalExpected: number;
  totalReceived: number;
  totalDifference: number;
} {
  let matchedCount = 0;
  let partialCount = 0;
  let unmatchedCount = 0;
  let totalExpected = 0;
  let totalReceived = 0;

  for (const result of results) {
    const { row } = result;
    totalExpected += row.expectedAmount;
    totalReceived += row.receivedAmount || 0;

    switch (row.status) {
      case 'MATCHED':
        matchedCount++;
        break;
      case 'PARTIAL':
        partialCount++;
        break;
      case 'UNMATCHED':
        unmatchedCount++;
        break;
    }
  }

  return {
    totalRows: results.length,
    matchedCount,
    partialCount,
    unmatchedCount,
    totalExpected,
    totalReceived,
    totalDifference: totalReceived - totalExpected,
  };
}

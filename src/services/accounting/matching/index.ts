/**
 * Reconciliation Matching Strategies
 * 
 * This module provides matching strategies for different payment modes
 * to reconcile OpenDental payments with bank transactions.
 * 
 * Multi-pass matching:
 *   Pass 1: Exact reference key match + amount match
 *   Pass 2: Amount + date match (within tolerance)
 *   Pass 3: Amount-only match
 *   Remaining: UNMATCHED with detailed reason
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

interface MatchingStrategy {
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

/**
 * Format currency for display in reasons
 */
function fmtAmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Check if two dates are within N days of each other
 */
function datesWithinDays(date1: string, date2: string, days: number): boolean {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  if (isNaN(d1) || isNaN(d2)) return false;
  return Math.abs(d1 - d2) <= days * 24 * 60 * 60 * 1000;
}

/**
 * Find the closest bank row by amount (for detailed "near miss" reporting)
 */
function findNearestBankRow(
  odRow: OpenDentalPaymentRow,
  bankRows: BankStatementRow[],
  usedBankRows: Set<string>
): { bankRow: BankStatementRow; diff: number } | null {
  let closest: { bankRow: BankStatementRow; diff: number } | null = null;
  for (const br of bankRows) {
    if (usedBankRows.has(br.rowId)) continue;
    const diff = Math.abs(br.amount - odRow.expectedAmount);
    if (!closest || diff < closest.diff) {
      closest = { bankRow: br, diff };
    }
  }
  return closest;
}

// ========================================
// MULTI-PASS MATCHING STRATEGY
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
    const usedODRows = new Set<string>();

    // ===== PASS 1: Exact reference key + amount match =====
    const bankRowsByKey = new Map<string, BankStatementRow[]>();
    for (const bankRow of bankRows) {
      const key = this.getMatchingKey(bankRow as any);
      if (key) {
        if (!bankRowsByKey.has(key)) bankRowsByKey.set(key, []);
        bankRowsByKey.get(key)!.push(bankRow);
      }
    }

    for (const odRow of openDentalRows) {
      const odKey = this.getMatchingKey(odRow as any);
      if (!odKey) continue;

      const matchingBankRows = bankRowsByKey.get(odKey) || [];
      for (const bankRow of matchingBankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;
        const status = determineMatchStatus(odRow.expectedAmount, bankRow.amount);
        if (status === 'MATCHED' || status === 'PARTIAL') {
          const diff = (bankRow.amount || 0) - odRow.expectedAmount;
          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: odRow.referenceId,
              expectedAmount: odRow.expectedAmount,
              receivedAmount: bankRow.amount,
              status,
              difference: diff,
              reason: status === 'MATCHED'
                ? `Exact reference match: "${odRow.referenceId}" matched bank ref "${bankRow.reference}"`
                : `Reference matched ("${odRow.referenceId}"), but amount differs: expected ${fmtAmt(odRow.expectedAmount)}, received ${fmtAmt(bankRow.amount)} (diff: ${fmtAmt(Math.abs(diff))})`,
              openDentalRowId: odRow.rowId,
              bankRowId: bankRow.rowId,
              patientName: odRow.patientName,
            },
            openDentalRow: odRow,
            bankRow,
          });
          usedBankRows.add(bankRow.rowId);
          usedODRows.add(odRow.rowId);
          break;
        }
      }
    }

    // ===== PASS 2: Amount + Date match (±3 days) =====
    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;

      for (const bankRow of bankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;

        if (amountsMatch(odRow.expectedAmount, bankRow.amount) &&
          datesWithinDays(odRow.paymentDate, bankRow.date, 3)) {
          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: odRow.referenceId,
              expectedAmount: odRow.expectedAmount,
              receivedAmount: bankRow.amount,
              status: 'MATCHED',
              difference: 0,
              reason: `Amount+Date match: ${fmtAmt(odRow.expectedAmount)} on ${odRow.paymentDate} matched bank txn "${bankRow.reference}" (${bankRow.date}). References differ: OD="${odRow.referenceId}" vs Bank="${bankRow.reference}"`,
              openDentalRowId: odRow.rowId,
              bankRowId: bankRow.rowId,
              patientName: odRow.patientName,
            },
            openDentalRow: odRow,
            bankRow,
          });
          usedBankRows.add(bankRow.rowId);
          usedODRows.add(odRow.rowId);
          break;
        }
      }
    }

    // ===== PASS 3: Amount-only match (exact amount, no date constraint) =====
    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;

      for (const bankRow of bankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;

        if (amountsMatch(odRow.expectedAmount, bankRow.amount)) {
          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: odRow.referenceId,
              expectedAmount: odRow.expectedAmount,
              receivedAmount: bankRow.amount,
              status: 'PARTIAL',
              difference: 0,
              reason: `Amount-only match: ${fmtAmt(odRow.expectedAmount)} matched bank txn "${bankRow.reference}" (${bankRow.date}). No reference or date match found. OD ref="${odRow.referenceId}" (${odRow.paymentDate}) vs Bank ref="${bankRow.reference}" (${bankRow.date})`,
              openDentalRowId: odRow.rowId,
              bankRowId: bankRow.rowId,
              patientName: odRow.patientName,
            },
            openDentalRow: odRow,
            bankRow,
          });
          usedBankRows.add(bankRow.rowId);
          usedODRows.add(odRow.rowId);
          break;
        }
      }
    }

    // ===== PASS 4: Unmatched OpenDental rows (with detailed reason) =====
    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;

      const odKey = this.getMatchingKey(odRow as any);
      const nearest = findNearestBankRow(odRow, bankRows, usedBankRows);
      const availableBankCount = bankRows.filter(br => !usedBankRows.has(br.rowId)).length;

      let reason = `UNMATCHED: OpenDental payment ${fmtAmt(odRow.expectedAmount)} (${odRow.paymentDate}) - Patient: ${odRow.patientName}, Ref: "${odRow.referenceId}". `;

      if (availableBankCount === 0) {
        reason += 'No remaining bank transactions to match against.';
      } else if (!odKey) {
        reason += `No reference/cheque number found in OpenDental payment. ${availableBankCount} unmatched bank txns exist but cannot match by reference.`;
      } else if (nearest) {
        reason += `Reference "${odKey}" not found in bank data. Closest bank amount: ${fmtAmt(nearest.bankRow.amount)} (ref: "${nearest.bankRow.reference}", date: ${nearest.bankRow.date}), diff: ${fmtAmt(nearest.diff)}. ${availableBankCount} bank txns remain unmatched.`;
      } else {
        reason += `Reference "${odKey}" not found in any bank transaction.`;
      }

      results.push({
        row: {
          rowId: generateRowId(),
          referenceId: odRow.referenceId,
          expectedAmount: odRow.expectedAmount,
          receivedAmount: undefined,
          status: 'UNMATCHED',
          difference: -odRow.expectedAmount,
          reason,
          openDentalRowId: odRow.rowId,
          patientName: odRow.patientName,
        },
        openDentalRow: odRow,
      });
    }

    // ===== PASS 5: Unmatched bank rows (with detailed reason) =====
    for (const bankRow of bankRows) {
      if (usedBankRows.has(bankRow.rowId)) continue;

      const bankKey = this.getMatchingKey(bankRow as any);
      const reason = `UNMATCHED: Bank transaction ${fmtAmt(bankRow.amount)} (${bankRow.date}) - Ref: "${bankRow.reference}". No OpenDental payment found with matching ${bankKey ? `reference "${bankKey}"` : 'reference'} or matching amount.`;

      results.push({
        row: {
          rowId: generateRowId(),
          referenceId: bankRow.reference,
          expectedAmount: 0,
          receivedAmount: bankRow.amount,
          status: 'UNMATCHED',
          difference: bankRow.amount,
          reason,
          bankRowId: bankRow.rowId,
        },
        bankRow,
      });
    }

    return results;
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
 * Calculate summary statistics from match results
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

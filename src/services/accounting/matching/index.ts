/**
 * Reconciliation Matching Strategies
 * 
 * This module provides matching strategies for different payment modes
 * to reconcile OpenDental payments with bank transactions.
 * 
 * Each payment mode has its own matching logic because:
 *   - EFT: Match by UTR/bank reference from PayNote, with partial UTR matching
 *   - CHEQUE: Match by CheckNum field (cheque number), not PayNote
 *   - CREDIT_CARD: Match by last-4 digits or transaction ID from PayNote
 *   - PAYCONNECT: Match by PayConnect transaction ID from PayNote
 *   - SUNBIT: Match by Sunbit reference from PayNote
 *   - AUTHORIZE_NET: Match by batch/transaction ID from PayNote
 *   - CHERRY: Match by Cherry transaction ID from PayNote
 *   - CARE_CREDIT: Match by CareCredit reference from PayNote
 * 
 * Multi-pass matching (shared across all modes):
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
 * Extract numeric digits only (useful for cheque numbers, UTRs)
 */
function extractDigits(ref: string | null | undefined): string {
  if (!ref) return '';
  return ref.replace(/\D/g, '');
}

/**
 * Extract last N digits from a reference (useful for card matching)
 */
function extractLastNDigits(ref: string | null | undefined, n: number): string {
  const digits = extractDigits(ref);
  return digits.length >= n ? digits.slice(-n) : digits;
}

/**
 * Try to extract a UTR/reference number from PayNote.
 * UTR numbers are typically 12-22 digit numbers or alphanumeric codes.
 * Staff often type "UTR: 123456789012" or "Ref: ABCD123456" etc.
 */
function extractUTRFromNote(payNote: string): string {
  if (!payNote) return '';

  // Common patterns: "UTR: XXXX", "Ref: XXXX", "NEFT/RTGS XXXX", ACH trace numbers, just a long number
  const patterns = [
    /UTR[:\s#-]*([A-Z0-9]{10,22})/i,
    /REF[:\s#-]*([A-Z0-9]{8,22})/i,
    /NEFT[:\s/]*([A-Z0-9]{10,22})/i,
    /RTGS[:\s/]*([A-Z0-9]{10,22})/i,
    /IMPS[:\s/]*([A-Z0-9]{10,22})/i,
    /ACH[:\s/]*([A-Z0-9]{8,22})/i,
    /TRACE[:\s#-]*([A-Z0-9]{8,22})/i,
    /TRANSFER[:\s#-]*([A-Z0-9]{8,22})/i,
    /WIRE[:\s#-]*([A-Z0-9]{8,22})/i,
    /ZELLE[:\s#-]*([A-Z0-9]{8,22})/i,
    /([A-Z]{4}\d{10,18})/i,   // Standard UTR format: 4 alpha + 10-18 digits
    /(\d{12,22})/,              // Plain long number (UTR is usually 12-22 digits)
  ];

  for (const pattern of patterns) {
    const match = payNote.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase().trim();
    }
  }

  // Fallback: if the entire note looks like a reference (alphanumeric, 8+ chars)
  const cleaned = payNote.trim().replace(/\s+/g, '');
  if (/^[A-Z0-9]{8,30}$/i.test(cleaned)) {
    return cleaned.toUpperCase();
  }

  return '';
}

/**
 * Extract transaction ID from PayNote for card processors.
 * PayConnect/Authorize.net etc. auto-populate PayNote with transaction details.
 * Common formats: "Trans ID: 12345", "Approval: ABC123", "Ref#12345"
 */
function extractTransactionIdFromNote(payNote: string): string {
  if (!payNote) return '';

  const patterns = [
    /TRANS(?:ACTION)?\s*(?:ID|#|:)[:\s#-]*([A-Z0-9]{4,20})/i,
    /APPROVAL[:\s#-]*([A-Z0-9]{4,10})/i,
    /AUTH(?:ORIZATION)?\s*(?:CODE|#|:)[:\s#-]*([A-Z0-9]{4,10})/i,
    /REF(?:ERENCE)?[:\s#-]*([A-Z0-9]{4,20})/i,
    /BATCH[:\s#-]*([A-Z0-9]{4,15})/i,
    /RECEIPT[:\s#-]*([A-Z0-9]{4,20})/i,
    /CONFIRMATION[:\s#-]*([A-Z0-9]{4,20})/i,
  ];

  for (const pattern of patterns) {
    const match = payNote.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase().trim();
    }
  }

  // Fallback: use the full normalized note
  return normalizeReference(payNote);
}

/**
 * Search for a key within a string (case-insensitive substring match).
 * Used to find reference IDs embedded in bank descriptions/narrations.
 */
function descriptionContainsKey(description: string, key: string): boolean {
  if (!description || !key || key.length < 4) return false;
  return description.toUpperCase().includes(key.toUpperCase());
}

/**
 * Compare amounts with tolerance for floating point
 */
function amountsMatch(expected: number, received: number, tolerance: number = 0.01): boolean {
  return Math.abs(expected - received) <= tolerance;
}

/**
 * Check if received amount matches expected after deducting a processing fee.
 * Processing fees are typically a percentage of the gross amount.
 * Returns the fee amount if match is within tolerance, null otherwise.
 *
 * Example: OD payment = $1000, processing fee rate = 2.9%
 *   → Expected net deposit = $1000 × (1 - 0.029) = $971.00
 *   → Bank shows $971.00 → MATCH (fee = $29.00)
 */
function netAmountMatch(
  grossExpected: number,
  bankReceived: number,
  feeRateMin: number,
  feeRateMax: number,
  flatFeeMin: number = 0,
  flatFeeMax: number = 0
): { matched: boolean; estimatedFee: number; feePercent: number } {
  // The bank should have received: gross - (gross × feeRate) - flatFee
  const actualFee = grossExpected - bankReceived;
  if (actualFee < 0) {
    // Bank received MORE than expected — not a fee deduction scenario
    return { matched: false, estimatedFee: 0, feePercent: 0 };
  }
  const feePercent = grossExpected > 0 ? (actualFee / grossExpected) * 100 : 0;

  // Check if the actual fee falls within the expected range
  const minExpectedFee = (grossExpected * feeRateMin) + flatFeeMin;
  const maxExpectedFee = (grossExpected * feeRateMax) + flatFeeMax;

  // Allow 1% tolerance on the fee range bounds
  const toleranceFactor = 0.01;
  const adjustedMin = minExpectedFee * (1 - toleranceFactor);
  const adjustedMax = maxExpectedFee * (1 + toleranceFactor);

  if (actualFee >= adjustedMin - 0.01 && actualFee <= adjustedMax + 0.01) {
    return { matched: true, estimatedFee: actualFee, feePercent };
  }
  return { matched: false, estimatedFee: actualFee, feePercent };
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
// MULTI-PASS MATCHING STRATEGY (BASE)
// ========================================

abstract class BaseMatchingStrategy implements MatchingStrategy {
  abstract mode: PaymentMode;

  /**
   * Get the primary matching key from an OpenDental row.
   * Override in subclasses for mode-specific extraction.
   */
  abstract getODMatchingKey(row: OpenDentalPaymentRow): string;

  /**
   * Get the primary matching key from a bank row.
   * Override in subclasses for mode-specific extraction.
   */
  abstract getBankMatchingKey(row: BankStatementRow): string;

  /**
   * Get a secondary/fallback matching key (for fuzzy matching).
   * Returns empty string by default; override for partial matching.
   */
  getODSecondaryKey(row: OpenDentalPaymentRow): string { return ''; }
  getBankSecondaryKey(row: BankStatementRow): string { return ''; }

  /**
   * Date tolerance for Pass 2 (amount+date). Default: 3 days.
   * EFT/cheque may need wider tolerance (bank processing time).
   */
  getDateToleranceDays(): number { return 3; }

  // ===== NEW: Processing Fee Configuration =====

  /**
   * Whether this gateway deducts processing fees before depositing.
   * If true, matching will also try net-amount comparison.
   * Override in subclasses for gateways that charge fees (PayConnect, Authorize.Net, etc.)
   */
  hasProcessingFees(): boolean { return false; }

  /**
   * Min/max processing fee rate as a decimal (e.g., 0.025 = 2.5%).
   * Used to calculate the expected net amount range.
   * Override in subclasses to set gateway-specific fee rates.
   */
  getFeeRateRange(): { min: number; max: number } { return { min: 0, max: 0 }; }

  /**
   * Min/max flat per-transaction fee (e.g., $0.10 - $0.30).
   * Added on top of the percentage-based fee.
   */
  getFlatFeeRange(): { min: number; max: number } { return { min: 0, max: 0 }; }

  /**
   * Amount tolerance for fuzzy matching (for rounding/currency differences).
   * Default: 0.01. Gateway-specific strategies can increase this.
   */
  getAmountTolerance(): number { return 0.01; }

  /**
   * Whether this gateway batches multiple transactions into a single settlement.
   * If true, the matching engine will also group OD payments by date and try
   * to match the sum against a single bank deposit.
   */
  supportsBatchSettlement(): boolean { return false; }

  /**
   * Batch settlement date tolerance in days.
   * How many days of OD payments might be grouped into one bank deposit.
   */
  getBatchDateWindowDays(): number { return 1; }

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
      const key = this.getBankMatchingKey(bankRow);
      if (key) {
        if (!bankRowsByKey.has(key)) bankRowsByKey.set(key, []);
        bankRowsByKey.get(key)!.push(bankRow);
      }
    }

    for (const odRow of openDentalRows) {
      const odKey = this.getODMatchingKey(odRow);
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
                ? `✅ Exact reference match: OD "${odRow.referenceId}" ↔ Bank "${bankRow.reference}"`
                : `⚠️ Reference matched ("${odRow.referenceId}"), but amount differs: expected ${fmtAmt(odRow.expectedAmount)}, received ${fmtAmt(bankRow.amount)} (diff: ${fmtAmt(Math.abs(diff))})`,
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

    // ===== PASS 1b: Secondary/partial key match (e.g., substring, last-4) =====
    const bankRowsBySecKey = new Map<string, BankStatementRow[]>();
    for (const bankRow of bankRows) {
      if (usedBankRows.has(bankRow.rowId)) continue;
      const secKey = this.getBankSecondaryKey(bankRow);
      if (secKey) {
        if (!bankRowsBySecKey.has(secKey)) bankRowsBySecKey.set(secKey, []);
        bankRowsBySecKey.get(secKey)!.push(bankRow);
      }
    }

    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;
      const odSecKey = this.getODSecondaryKey(odRow);
      if (!odSecKey) continue;

      const matchingBankRows = bankRowsBySecKey.get(odSecKey) || [];
      for (const bankRow of matchingBankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;
        if (amountsMatch(odRow.expectedAmount, bankRow.amount)) {
          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: odRow.referenceId,
              expectedAmount: odRow.expectedAmount,
              receivedAmount: bankRow.amount,
              status: 'MATCHED',
              difference: 0,
              reason: `✅ Partial reference match: OD "${odRow.referenceId}" ↔ Bank "${bankRow.reference}" (matched by secondary key "${odSecKey}")`,
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

    // ===== PASS 1c: Reference-in-description match =====
    // For financing modes (Cherry, Sunbit, CareCredit etc.), the bank deposit
    // often has a generic reference like "Cherry Payment" but the actual transaction
    // ID might appear in the description or narration. We search bank description
    // for the OD-side reference key.
    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;
      const odKey = this.getODMatchingKey(odRow);
      if (!odKey || odKey.length < 4) continue; // avoid false positives with short keys

      for (const bankRow of bankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;
        // Search the bank description (which includes payment_ref + ref + name + narration)
        if (descriptionContainsKey(bankRow.description, odKey) &&
          amountsMatch(odRow.expectedAmount, bankRow.amount)) {
          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: odRow.referenceId,
              expectedAmount: odRow.expectedAmount,
              receivedAmount: bankRow.amount,
              status: 'MATCHED',
              difference: 0,
              reason: `✅ Reference found in bank description: OD key "${odKey}" found in "${bankRow.description.substring(0, 80)}..." — amount matches.`,
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

    // ===== PASS 2: Amount + Date match (within tolerance) =====
    // Also tries NET amount matching for gateways with processing fees
    const dateTolerance = this.getDateToleranceDays();
    const hasFees = this.hasProcessingFees();
    const feeRange = this.getFeeRateRange();
    const flatFeeRange = this.getFlatFeeRange();
    const amtTolerance = this.getAmountTolerance();

    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;

      for (const bankRow of bankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;
        if (!datesWithinDays(odRow.paymentDate, bankRow.date, dateTolerance)) continue;

        // Try 1: Exact gross amount match
        if (amountsMatch(odRow.expectedAmount, bankRow.amount, amtTolerance)) {
          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: odRow.referenceId,
              expectedAmount: odRow.expectedAmount,
              receivedAmount: bankRow.amount,
              status: 'MATCHED',
              difference: 0,
              reason: `✅ Amount+Date match: ${fmtAmt(odRow.expectedAmount)} on ${odRow.paymentDate} ↔ Bank "${bankRow.reference}" (${bankRow.date}). No reference match.`,
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

        // Try 2: Net amount match (gross minus processing fees)
        if (hasFees) {
          const netResult = netAmountMatch(
            odRow.expectedAmount, bankRow.amount,
            feeRange.min, feeRange.max,
            flatFeeRange.min, flatFeeRange.max
          );
          if (netResult.matched) {
            const diff = bankRow.amount - odRow.expectedAmount;
            results.push({
              row: {
                rowId: generateRowId(),
                referenceId: odRow.referenceId,
                expectedAmount: odRow.expectedAmount,
                receivedAmount: bankRow.amount,
                status: 'MATCHED',
                difference: diff,
                reason: `✅ Net-amount match (after fees): OD ${fmtAmt(odRow.expectedAmount)} → Bank ${fmtAmt(bankRow.amount)} (${bankRow.date}). ` +
                  `Processing fee: ${fmtAmt(netResult.estimatedFee)} (${netResult.feePercent.toFixed(1)}%). ` +
                  `${this.mode} typical fee: ${(feeRange.min * 100).toFixed(1)}%-${(feeRange.max * 100).toFixed(1)}%.`,
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
    }

    // ===== PASS 2b: Net amount + Reference match (no date constraint) =====
    // For gateways with processing fees, try reference-based matching with net amounts
    if (hasFees) {
      for (const odRow of openDentalRows) {
        if (usedODRows.has(odRow.rowId)) continue;
        const odKey = this.getODMatchingKey(odRow);
        if (!odKey) continue;

        const matchingBankRows = bankRowsByKey.get(odKey) || [];
        for (const bankRow of matchingBankRows) {
          if (usedBankRows.has(bankRow.rowId)) continue;
          const netResult = netAmountMatch(
            odRow.expectedAmount, bankRow.amount,
            feeRange.min, feeRange.max,
            flatFeeRange.min, flatFeeRange.max
          );
          if (netResult.matched) {
            const diff = bankRow.amount - odRow.expectedAmount;
            results.push({
              row: {
                rowId: generateRowId(),
                referenceId: odRow.referenceId,
                expectedAmount: odRow.expectedAmount,
                receivedAmount: bankRow.amount,
                status: 'MATCHED',
                difference: diff,
                reason: `✅ Reference+Net match: OD "${odRow.referenceId}" ↔ Bank "${bankRow.reference}". ` +
                  `Gross: ${fmtAmt(odRow.expectedAmount)} → Net deposit: ${fmtAmt(bankRow.amount)}. ` +
                  `Fee deducted: ${fmtAmt(netResult.estimatedFee)} (${netResult.feePercent.toFixed(1)}%).`,
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
    }

    // ===== PASS 2c: Batch Settlement matching =====
    // Card processors (PayConnect, Authorize.Net, Credit Card) settle in daily batches:
    // Multiple individual OD payments → one lump-sum bank deposit.
    //
    // Strategy: For each unmatched bank deposit, find a group of OD payments
    // whose dates are within the batch window that sum to the bank amount.
    // We try:
    //   (a) Same-date exact sum (gross)
    //   (b) Same-date net sum (gross minus processing fees)
    //   (c) Multi-day rolling window gross sum
    //   (d) Multi-day rolling window net sum
    //   (e) Greedy accumulation: sort OD rows by proximity to bank date,
    //       accumulate until sum reaches bank amount
    if (this.supportsBatchSettlement()) {
      const batchWindow = this.getBatchDateWindowDays();

      // Sort bank rows by amount (largest first) - larger deposits are more likely batch settlements
      const unmatchedBankRows = bankRows
        .filter(br => !usedBankRows.has(br.rowId))
        .sort((a, b) => b.amount - a.amount);

      for (const bankRow of unmatchedBankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;

        // Find all unmatched OD rows within the batch date window of this bank row
        const candidateOD = openDentalRows.filter(od =>
          !usedODRows.has(od.rowId) &&
          datesWithinDays(od.paymentDate, bankRow.date, batchWindow)
        );
        if (candidateOD.length < 2) continue; // Need at least 2 for a batch

        // --- Attempt (a): Sum of ALL candidates matches bank amount (gross) ---
        const grossSum = candidateOD.reduce((sum, r) => sum + r.expectedAmount, 0);
        let batchMatched = false;
        let matchedRows: OpenDentalPaymentRow[] = [];
        let batchReason = '';

        if (amountsMatch(grossSum, bankRow.amount, amtTolerance + 1.00)) {
          batchMatched = true;
          matchedRows = candidateOD;
          batchReason = `✅ Batch settlement: ${candidateOD.length} OD payments ` +
            `totaling ${fmtAmt(grossSum)} ↔ Bank deposit ${fmtAmt(bankRow.amount)} (${bankRow.date}).`;
        }

        // --- Attempt (b): Sum of ALL candidates matches after fees ---
        if (!batchMatched && hasFees) {
          const netResult = netAmountMatch(
            grossSum, bankRow.amount,
            feeRange.min, feeRange.max,
            flatFeeRange.min * candidateOD.length, flatFeeRange.max * candidateOD.length
          );
          if (netResult.matched) {
            batchMatched = true;
            matchedRows = candidateOD;
            batchReason = `✅ Batch settlement (net): ${candidateOD.length} OD payments ` +
              `totaling ${fmtAmt(grossSum)} → Net deposit: ${fmtAmt(bankRow.amount)}. ` +
              `Fees: ${fmtAmt(netResult.estimatedFee)} (${netResult.feePercent.toFixed(1)}%).`;
          }
        }

        // --- Attempt (c): Greedy accumulation by date proximity ---
        // Sort candidates by date proximity, then greedily accumulate until we hit the target
        if (!batchMatched) {
          const sortedCandidates = [...candidateOD].sort((a, b) => {
            const distA = Math.abs(new Date(a.paymentDate).getTime() - new Date(bankRow.date).getTime());
            const distB = Math.abs(new Date(b.paymentDate).getTime() - new Date(bankRow.date).getTime());
            return distA - distB;
          });

          // Try to accumulate OD rows to match the bank amount
          const targetGross = bankRow.amount; // Try gross first
          let runningSum = 0;
          const accumulated: OpenDentalPaymentRow[] = [];

          for (const od of sortedCandidates) {
            if (runningSum + od.expectedAmount > targetGross + amtTolerance + 1.00) continue; // Skip if adding this would overshoot
            accumulated.push(od);
            runningSum += od.expectedAmount;

            // Check gross match
            if (amountsMatch(runningSum, targetGross, amtTolerance + 1.00)) {
              batchMatched = true;
              matchedRows = accumulated;
              batchReason = `✅ Batch settlement (accumulated): ${accumulated.length} OD payments ` +
                `totaling ${fmtAmt(runningSum)} ↔ Bank deposit ${fmtAmt(bankRow.amount)} (${bankRow.date}).`;
              break;
            }
          }

          // If gross accumulation didn't work, try net accumulation (if fees apply)
          if (!batchMatched && hasFees) {
            runningSum = 0;
            accumulated.length = 0;

            for (const od of sortedCandidates) {
              accumulated.push(od);
              runningSum += od.expectedAmount;
            }

            // Check if accumulated gross → net matches bank amount
            if (accumulated.length >= 2) {
              const netResult = netAmountMatch(
                runningSum, bankRow.amount,
                feeRange.min, feeRange.max,
                flatFeeRange.min * accumulated.length, flatFeeRange.max * accumulated.length
              );
              if (netResult.matched) {
                batchMatched = true;
                matchedRows = accumulated;
                batchReason = `✅ Batch settlement (accumulated net): ${accumulated.length} OD payments ` +
                  `totaling ${fmtAmt(runningSum)} → Net deposit: ${fmtAmt(bankRow.amount)}. ` +
                  `Fees: ${fmtAmt(netResult.estimatedFee)} (${netResult.feePercent.toFixed(1)}%).`;
              }
            }
          }
        }

        // Record batch match result
        if (batchMatched && matchedRows.length >= 2) {
          const patientNames = matchedRows.map(r => r.patientName).join(', ');
          const dateRange = matchedRows.map(r => r.paymentDate.substring(0, 10));
          const uniqueDates = Array.from(new Set(dateRange)).sort();
          const dateLabel = uniqueDates.length === 1 ? uniqueDates[0] : `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`;
          const batchGross = matchedRows.reduce((s, r) => s + r.expectedAmount, 0);

          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: `BATCH-${dateLabel} (${matchedRows.length} txns)`,
              expectedAmount: batchGross,
              receivedAmount: bankRow.amount,
              status: 'MATCHED',
              difference: bankRow.amount - batchGross,
              reason: batchReason + ` Patients: ${patientNames.substring(0, 200)}${patientNames.length > 200 ? '...' : ''}.`,
              openDentalRowId: matchedRows.map(r => r.rowId).join(','),
              bankRowId: bankRow.rowId,
              patientName: `Batch (${matchedRows.length} patients)`,
            },
            bankRow,
          });
          for (const od of matchedRows) usedODRows.add(od.rowId);
          usedBankRows.add(bankRow.rowId);
        }
      }
    }

    // ===== PASS 3: Amount-only match (exact amount, no date constraint) =====
    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;

      for (const bankRow of bankRows) {
        if (usedBankRows.has(bankRow.rowId)) continue;

        if (amountsMatch(odRow.expectedAmount, bankRow.amount, amtTolerance)) {
          results.push({
            row: {
              rowId: generateRowId(),
              referenceId: odRow.referenceId,
              expectedAmount: odRow.expectedAmount,
              receivedAmount: bankRow.amount,
              status: 'PARTIAL',
              difference: 0,
              reason: `⚠️ Amount-only match: ${fmtAmt(odRow.expectedAmount)} ↔ Bank "${bankRow.reference}" (${bankRow.date}). No reference or date match. Needs manual verification.`,
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

    // ===== PASS 3b: Net-amount-only match (no reference, no date) =====
    // Last resort for fee-deducting gateways: if the net amount matches
    if (hasFees) {
      for (const odRow of openDentalRows) {
        if (usedODRows.has(odRow.rowId)) continue;

        for (const bankRow of bankRows) {
          if (usedBankRows.has(bankRow.rowId)) continue;

          const netResult = netAmountMatch(
            odRow.expectedAmount, bankRow.amount,
            feeRange.min, feeRange.max,
            flatFeeRange.min, flatFeeRange.max
          );
          if (netResult.matched) {
            const diff = bankRow.amount - odRow.expectedAmount;
            results.push({
              row: {
                rowId: generateRowId(),
                referenceId: odRow.referenceId,
                expectedAmount: odRow.expectedAmount,
                receivedAmount: bankRow.amount,
                status: 'PARTIAL',
                difference: diff,
                reason: `⚠️ Net-amount-only match: OD ${fmtAmt(odRow.expectedAmount)} → Bank ${fmtAmt(bankRow.amount)} (${bankRow.date}). ` +
                  `Estimated fee: ${fmtAmt(netResult.estimatedFee)} (${netResult.feePercent.toFixed(1)}%). ` +
                  `No reference or date match — needs manual verification.`,
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
    }

    // ===== PASS 4: Unmatched OpenDental rows (with detailed reason) =====
    for (const odRow of openDentalRows) {
      if (usedODRows.has(odRow.rowId)) continue;

      const odKey = this.getODMatchingKey(odRow);
      const nearest = findNearestBankRow(odRow, bankRows, usedBankRows);
      const availableBankCount = bankRows.filter(br => !usedBankRows.has(br.rowId)).length;

      let reason = `❌ UNMATCHED: OD payment ${fmtAmt(odRow.expectedAmount)} (${odRow.paymentDate}) — ${odRow.patientName}, Ref: "${odRow.referenceId}". `;

      if (availableBankCount === 0) {
        reason += 'No remaining bank transactions to match against.';
      } else if (!odKey) {
        reason += `No reference found in OpenDental payment (${this.mode} mode requires ${this.getReferenceFieldName()}). ${availableBankCount} unmatched bank txns exist.`;
      } else if (nearest) {
        reason += `Key "${odKey}" not found in bank data. Closest: ${fmtAmt(nearest.bankRow.amount)} (ref: "${nearest.bankRow.reference}", ${nearest.bankRow.date}), diff: ${fmtAmt(nearest.diff)}. ${availableBankCount} bank txns remain.`;
      } else {
        reason += `Key "${odKey}" not found in any bank transaction.`;
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

      const bankKey = this.getBankMatchingKey(bankRow);
      const reason = `❌ UNMATCHED: Bank txn ${fmtAmt(bankRow.amount)} (${bankRow.date}) — Ref: "${bankRow.reference}". No OD payment found with ${bankKey ? `matching key "${bankKey}"` : 'any matching reference'} or amount.`;

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

    // ===== POST-PROCESSING: Enrich rows with paymentDate + matchPass =====
    for (const result of results) {
      // Add paymentDate from OD row or bank row
      if (result.openDentalRow) {
        result.row.paymentDate = result.openDentalRow.paymentDate;
      } else if (result.bankRow) {
        result.row.paymentDate = result.bankRow.date;
      }

      // Derive matchPass from reason text
      const reason = result.row.reason || '';
      if (reason.includes('Exact reference match')) result.row.matchPass = 'Pass 1: Exact Ref';
      else if (reason.includes('Partial reference match')) result.row.matchPass = 'Pass 1b: Partial Ref';
      else if (reason.includes('Reference found in bank description')) result.row.matchPass = 'Pass 1c: Ref-in-Desc';
      else if (reason.includes('Amount+Date match')) result.row.matchPass = 'Pass 2: Amt+Date';
      else if (reason.includes('Net-amount match (after fees)')) result.row.matchPass = 'Pass 2: Net Amt+Date';
      else if (reason.includes('Reference+Net match')) result.row.matchPass = 'Pass 2b: Ref+Net';
      else if (reason.includes('Batch settlement')) result.row.matchPass = 'Pass 2c: Batch';
      else if (reason.includes('Amount-only match')) result.row.matchPass = 'Pass 3: Amt Only';
      else if (reason.includes('Net-amount-only match')) result.row.matchPass = 'Pass 3b: Net Amt Only';
      else if (result.row.status === 'UNMATCHED') result.row.matchPass = 'Unmatched';
    }

    return results;
  }

  /** Human-readable description of the reference field for error messages */
  getReferenceFieldName(): string { return 'reference'; }
}

// ========================================
// PAYMENT MODE STRATEGIES
// ========================================

/**
 * EFT Matching Strategy
 * - OD side: Extract UTR from PayNote (staff types "UTR: XXXX" or just the number)
 * - Bank side: Use the payment_ref/reference field
 * - Secondary: Match by last 6 digits of UTR (bank may truncate)
 * - Date tolerance: 5 days (bank transfers can take 2-3 business days)
 */
class EFTMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'EFT';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    // Extract UTR from PayNote
    return extractUTRFromNote(row.referenceId);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    // Bank reference/payment_ref often contains the UTR
    // Try reference first, then search the full description
    // (Odoo description now includes payment_ref | ref | name | narration)
    const fromRef = extractUTRFromNote(row.reference);
    if (fromRef) return fromRef;
    // Fallback: search the description (which includes narration, name, etc.)
    return extractUTRFromNote(row.description);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    // Fallback: last 6 digits of UTR for partial match
    const utr = extractUTRFromNote(row.referenceId);
    return utr ? extractLastNDigits(utr, 6) : '';
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    const ref = extractUTRFromNote(row.reference) || extractUTRFromNote(row.description);
    return ref ? extractLastNDigits(ref, 6) : '';
  }

  getDateToleranceDays(): number { return 5; }

  getReferenceFieldName(): string { return 'UTR/bank transfer reference in PayNote'; }
}

/**
 * ACH Matching Strategy
 * - OD side: Extract ACH trace number or confirmation ID from PayNote
 * - Bank side: Use the payment_ref/reference field
 * - Secondary: Match by last 6 digits of trace number
 * - Date tolerance: 3 days (ACH settles in 1-2 business days)
 */
class ACHMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'ACH';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    const ref = row.referenceId || '';
    // ACH-specific patterns: "ACH Trace: XXXX", "Trace#XXXX", "Confirmation: XXXX"
    const patterns = [
      /ACH[:\s#-]*([A-Z0-9]{8,22})/i,
      /TRACE[:\s#-]*([A-Z0-9]{8,22})/i,
      /CONFIRMATION[:\s#-]*([A-Z0-9]{6,20})/i,
      /DD[:\s#-]*([A-Z0-9]{6,20})/i,
    ];
    for (const pattern of patterns) {
      const match = ref.match(pattern);
      if (match) return match[1].toUpperCase();
    }
    // Fallback to general UTR extraction
    return extractUTRFromNote(ref);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    const fromRef = extractUTRFromNote(row.reference);
    if (fromRef) return fromRef;
    return extractUTRFromNote(row.description);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    const key = this.getODMatchingKey(row);
    return key ? extractLastNDigits(key, 6) : '';
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    const ref = extractUTRFromNote(row.reference) || extractUTRFromNote(row.description);
    return ref ? extractLastNDigits(ref, 6) : '';
  }

  getDateToleranceDays(): number { return 3; }

  getReferenceFieldName(): string { return 'ACH trace number/confirmation in PayNote'; }
}

/**
 * Cheque Matching Strategy
 * - OD side: Use CheckNum field (NOT PayNote!)
 * - Bank side: Extract cheque number from reference
 * - Secondary: Match by digits-only extraction (ignore formatting)
 * - Date tolerance: 7 days (cheques take time to clear)
 */
class ChequeMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CHEQUE';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    // Cheques use the CheckNum field from OpenDental, not PayNote
    if (row.checkNum) {
      return normalizeReference(row.checkNum);
    }
    // Fallback: try extracting cheque number from referenceId (PayNote)
    const ref = row.referenceId || '';
    const match = ref.match(/(?:CHK|CHQ|CHECK|CHEQUE|CK)[:\s#-]*(\d{3,10})/i);
    if (match) return match[1];
    // Just digits if it's a short number (likely a check number)
    const digits = extractDigits(ref);
    if (digits.length >= 3 && digits.length <= 10) return digits;
    return normalizeReference(ref);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    // Bank statement reference for cheques is usually the cheque number
    const ref = row.reference || '';
    // Extract cheque number patterns from reference
    const match = ref.match(/(?:CHK|CHQ|CHECK|CHEQUE|CQ|CK)[:\s#-]*(\d{3,10})/i);
    if (match) return match[1];
    // Also search in description (bank name/narration field)
    const descMatch = (row.description || '').match(/(?:CHK|CHQ|CHECK|CHEQUE|CQ|CK)[:\s#-]*(\d{3,10})/i);
    if (descMatch) return descMatch[1];
    const digits = extractDigits(ref);
    if (digits.length >= 3 && digits.length <= 10) return digits;
    return normalizeReference(ref);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    // Digits-only for fuzzy cheque matching
    return extractDigits(this.getODMatchingKey(row));
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    return extractDigits(this.getBankMatchingKey(row));
  }

  getDateToleranceDays(): number { return 7; }

  getReferenceFieldName(): string { return 'check number (CheckNum field)'; }
}

/**
 * Credit Card Matching Strategy
 * - OD side: Extract transaction ID from PayNote (auto-populated by processor)
 * - Bank side: Use reference field
 * - Secondary: Match by last 4 digits (card numbers)
 * - Date tolerance: 3 days (settlement batches)
 */
class CreditCardMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CREDIT_CARD';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    return extractTransactionIdFromNote(row.referenceId);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    return extractTransactionIdFromNote(row.reference);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    // Last 4 digits are often how CC payments appear on statements
    return extractLastNDigits(row.referenceId, 4);
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    return extractLastNDigits(row.reference, 4);
  }

  // Credit card processors typically charge 1.5% - 3.5% + $0.10-$0.30
  hasProcessingFees(): boolean { return true; }
  getFeeRateRange() { return { min: 0.015, max: 0.035 }; }
  getFlatFeeRange() { return { min: 0.10, max: 0.30 }; }

  // CC processors batch-settle daily, but settlement can be 1-3 days delayed
  supportsBatchSettlement(): boolean { return true; }
  getBatchDateWindowDays(): number { return 3; }

  getReferenceFieldName(): string { return 'transaction ID in PayNote'; }
}

/**
 * PayConnect Matching Strategy
 * - OD side: PayConnect auto-fills PayNote with "Trans ID: XXXX - Amount: XX.XX"
 * - Bank side: Use reference field from settlement report
 */
class PayConnectMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'PAYCONNECT';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    return extractTransactionIdFromNote(row.referenceId);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    return extractTransactionIdFromNote(row.reference);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    return extractLastNDigits(row.referenceId, 6);
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    return extractLastNDigits(row.reference, 6);
  }

  // PayConnect processing fees: 2.5% - 3.5% + $0.20-$0.30 per txn
  hasProcessingFees(): boolean { return true; }
  getFeeRateRange() { return { min: 0.025, max: 0.035 }; }
  getFlatFeeRange() { return { min: 0.20, max: 0.30 }; }

  // PayConnect batch-settles daily, but settlement can be 1-3 days delayed
  supportsBatchSettlement(): boolean { return true; }
  getBatchDateWindowDays(): number { return 3; }

  getReferenceFieldName(): string { return 'PayConnect transaction ID in PayNote'; }
}

/**
 * Sunbit Matching Strategy
 * - Sunbit payments are financing — the clinic gets paid in full by Sunbit
 * - OD side: Sunbit reference in PayNote
 * - Bank side: Sunbit deposit reference
 * - Date tolerance: 5 days (financing settlement)
 */
class SunbitMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'SUNBIT';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    const ref = row.referenceId || '';
    // Sunbit references often look like "SUNBIT-12345" or "SB-12345"
    const match = ref.match(/(?:SUNBIT|SB)[:\s#-]*([A-Z0-9]{4,15})/i);
    if (match) return match[1].toUpperCase();
    return extractTransactionIdFromNote(ref);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    const ref = row.reference || '';
    const match = ref.match(/(?:SUNBIT|SB)[:\s#-]*([A-Z0-9]{4,15})/i);
    if (match) return match[1].toUpperCase();
    // Also search in description (narration) for Sunbit references
    const descMatch = (row.description || '').match(/(?:SUNBIT|SB)[:\s#-]*([A-Z0-9]{4,15})/i);
    if (descMatch) return descMatch[1].toUpperCase();
    return extractTransactionIdFromNote(ref);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    return extractLastNDigits(row.referenceId, 6);
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    return extractLastNDigits(row.reference, 6);
  }

  getDateToleranceDays(): number { return 5; }

  // Sunbit is financing — they may deduct a merchant discount rate
  hasProcessingFees(): boolean { return true; }
  // Sunbit merchant discount: typically 8% - 15% (financing company keeps a cut)
  getFeeRateRange() { return { min: 0.08, max: 0.15 }; }

  getReferenceFieldName(): string { return 'Sunbit reference in PayNote'; }
}

/**
 * Authorize.Net Matching Strategy
 * - OD side: Auth.net transaction/batch ID in PayNote
 * - Bank side: Settlement batch reference
 */
class AuthorizeNetMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'AUTHORIZE_NET';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    return extractTransactionIdFromNote(row.referenceId);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    return extractTransactionIdFromNote(row.reference);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    return extractLastNDigits(row.referenceId, 6);
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    return extractLastNDigits(row.reference, 6);
  }

  // Authorize.Net processing fees: 2.9% + $0.30 per transaction
  hasProcessingFees(): boolean { return true; }
  getFeeRateRange() { return { min: 0.025, max: 0.035 }; }
  getFlatFeeRange() { return { min: 0.25, max: 0.35 }; }

  // Authorize.Net uses daily batch settlement, can be 1-3 days delayed
  supportsBatchSettlement(): boolean { return true; }
  getBatchDateWindowDays(): number { return 3; }

  getReferenceFieldName(): string { return 'Authorize.Net transaction ID in PayNote'; }
}

/**
 * Cherry Matching Strategy
 * - Cherry is a financing company similar to Sunbit
 * - OD side: Cherry reference in PayNote (transaction ID or Cherry-specific ref)
 * - Bank side: Cherry transaction ID from Cherry API or deposit reference
 * - Secondary: Match by last 6 digits of transaction ID
 * - Date tolerance: 5 days (financing settlement delay)
 */
class CherryMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CHERRY';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    const ref = row.referenceId || '';
    // Cherry references: "CHERRY-12345", "CHR-12345", or just a transaction ID
    const match = ref.match(/(?:CHERRY|CHR)[:\s#-]*([A-Z0-9]{4,20})/i);
    if (match) return match[1].toUpperCase();
    // Cherry API transaction IDs are often alphanumeric strings
    return extractTransactionIdFromNote(ref);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    const ref = row.reference || '';
    // When bank data comes from Cherry API, reference IS the transaction ID
    const match = ref.match(/(?:CHERRY|CHR)[:\s#-]*([A-Z0-9]{4,20})/i);
    if (match) return match[1].toUpperCase();
    // Cherry API rowId format: "cherry-{txnId}" — extract the txn part
    if (row.rowId?.startsWith('cherry-')) {
      return normalizeReference(row.rowId.replace('cherry-', ''));
    }
    // Also search bank description for cherry references
    const descMatch = (row.description || '').match(/(?:CHERRY|CHR)[:\s#-]*([A-Z0-9]{4,20})/i);
    if (descMatch) return descMatch[1].toUpperCase();
    return extractTransactionIdFromNote(ref);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    // Last 6 digits for partial match (Cherry transaction IDs can be long)
    return extractLastNDigits(row.referenceId, 6);
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    return extractLastNDigits(row.reference, 6);
  }

  getDateToleranceDays(): number { return 5; }

  // Cherry is a financing company — they keep a merchant discount fee
  // Cherry merchant fee: typically 6% - 12% of the treatment amount
  hasProcessingFees(): boolean { return true; }
  getFeeRateRange() { return { min: 0.06, max: 0.12 }; }

  getReferenceFieldName(): string { return 'Cherry transaction ID in PayNote'; }
}

/**
 * CareCredit Matching Strategy
 * - CareCredit is a healthcare financing card
 * - OD side: CareCredit reference/account ID in PayNote
 * - Bank side: CareCredit settlement reference
 */
class CareCreditMatchingStrategy extends BaseMatchingStrategy {
  mode: PaymentMode = 'CARE_CREDIT';

  getODMatchingKey(row: OpenDentalPaymentRow): string {
    const ref = row.referenceId || '';
    // CareCredit refs: "CARECREDIT-12345", "CC-12345", "Synchrony-12345"
    const match = ref.match(/(?:CARECREDIT|CARE\s*CREDIT|SYNCHRONY|CC)[:\s#-]*([A-Z0-9]{4,15})/i);
    if (match) return match[1].toUpperCase();
    return extractTransactionIdFromNote(ref);
  }

  getBankMatchingKey(row: BankStatementRow): string {
    const ref = row.reference || '';
    const match = ref.match(/(?:CARECREDIT|CARE\s*CREDIT|SYNCHRONY|CC)[:\s#-]*([A-Z0-9]{4,15})/i);
    if (match) return match[1].toUpperCase();
    // Also search in description for CareCredit refs
    const descMatch = (row.description || '').match(/(?:CARECREDIT|CARE\s*CREDIT|SYNCHRONY|CC)[:\s#-]*([A-Z0-9]{4,15})/i);
    if (descMatch) return descMatch[1].toUpperCase();
    return extractTransactionIdFromNote(ref);
  }

  getODSecondaryKey(row: OpenDentalPaymentRow): string {
    return extractLastNDigits(row.referenceId, 6);
  }

  getBankSecondaryKey(row: BankStatementRow): string {
    return extractLastNDigits(row.reference, 6);
  }

  getDateToleranceDays(): number { return 5; }

  // CareCredit (Synchrony) charges a merchant discount rate
  // CareCredit merchant fee: typically 5% - 14% depending on promo plan
  hasProcessingFees(): boolean { return true; }
  getFeeRateRange() { return { min: 0.05, max: 0.14 }; }

  getReferenceFieldName(): string { return 'CareCredit/Synchrony reference in PayNote'; }
}

// ========================================
// STRATEGY FACTORY
// ========================================

const strategies: Map<PaymentMode, MatchingStrategy> = new Map([
  ['EFT', new EFTMatchingStrategy()],
  ['ACH', new ACHMatchingStrategy()],
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

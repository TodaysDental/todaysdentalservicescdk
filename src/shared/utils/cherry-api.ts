/**
 * Cherry API Client — GraphQL
 * 
 * Cherry's provider portal uses a GraphQL API at https://gql.withcherry.com/
 * with a `fetchLoans` query to retrieve financing transaction (loan) data.
 * 
 * Each clinic has its own API key from Cherry's partner portal.
 * API keys are stored per-clinic in the ClinicSecrets DynamoDB table.
 * 
 * Data flow:
 *   1. Backend calls Cherry GraphQL → fetchLoans query
 *   2. Cherry returns loans with fund transfer details
 *   3. We extract MERCHANT_CREDIT funds (actual ACH deposits to clinic bank)
 *   4. Convert to BankStatementRow format for reconciliation
 * 
 * Key fields for reconciliation:
 *   - merchantFund: Actual amount deposited to merchant's bank account
 *   - funds[].amount (MERCHANT_CREDIT): Individual ACH deposit amounts
 *   - contractId: Unique loan contract reference (e.g., "L-CPRUK6708867-2")
 *   - fundedAt: When the loan was funded (use as transaction date)
 */

import { BankStatementRow } from '../../services/accounting/types';

// ========================================
// TYPES — matching Cherry's actual GraphQL schema
// ========================================

export interface CherryConfig {
    apiKey: string;
    baseUrl?: string; // Default: https://gql.withcherry.com/
}

/** Cherry loan fund transfer (ACH deposit or debit) */
export interface CherryFund {
    id: string;
    accountNumber: string;        // e.g., "****5610"
    directionType: string;        // "MERCHANT_CREDIT" or "MERCHANT_DEBIT"
    amount: number;               // Transfer amount
    event: string | null;         // e.g., "completed"
    type: string;                 // "LEAD" or "ACH"
    status: string;               // "COMPLETED", "PENDING", etc.
    createdAt: string;            // ISO datetime
    updatedAt: string;            // ISO datetime
}

/** Cherry loan product/plan details */
export interface CherryProduct {
    id: string;
    mdf: number;                  // Merchant discount fee %
    promoMdf: number | null;      // Promo MDF %
    term: number;                 // Loan term (months)
    periodLength: string | null;  // "MONTHLY", "BIWEEKLY"
}

/** Cherry refund details */
export interface CherryRefund {
    id: string;
    loanId: string;
    fundId: string;
    amount: number;
    merchantFund: number;
    type: string;                 // "PARTIAL_REFUND", "FULL_REFUND"
    merchantRevenue: number;
    status: string;
    refundFee: number;
    createdAt: string;
}

/** Cherry loan modification */
export interface CherryModification {
    id: string;
    type: string;
    amount: number;
}

/** Cherry checkout user */
export interface CherryCheckoutUser {
    id: string;
    firstName: string;
    lastName: string;
}

/** Single Cherry loan/transaction — matches the actual GraphQL `LoanSearch` type */
export interface CherryLoan {
    id: string;                           // Loan ID (e.g., "3016993")
    contractId: string;                   // Contract reference (e.g., "L-CPRUK6708867-2")
    applicationId: number;                // Cherry application ID
    applicationBalanceAvailable: number;
    borrowerId: number;
    borrowerName: string;                 // Patient name
    borrowerPhone: string;
    amount: number;                       // Net loan amount
    grossAmount: number;                  // Gross amount before fees
    purchaseAmount: number;               // Original purchase/treatment amount
    totalAmount: number;                  // Total amount including finance charges
    merchantFund: number;                 // Amount deposited to merchant bank (KEY for reconciliation)
    merchantRevenue: number;              // Cherry's fee (grossAmount - merchantFund)
    merchantId: number;
    downPaymentAmount: number;
    financeCharge: number;
    installmentAmount: number;
    transactionType: string;              // "STANDARD"
    status: string;                       // "FUNDED", "COMPLETED", "VOIDED"
    subStatus: string;                    // "COMPLETED", "CLOSED", "VOIDED"
    contractType: string;                 // "DEPOSIT", "REFUND"
    selfCheckout: boolean;
    promoUsed: boolean;
    dispute: boolean;
    tierLabel: string;                    // "Silver", "Gold", etc.
    createdAt: string;                    // ISO datetime
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
    fundedAt: string | null;              // When funds were sent to merchant
    originalClosedAt: string;             // Expected loan close date
    refundAmount: number | null;
    demo: boolean | null;
    product: CherryProduct | null;
    funds: CherryFund[];                  // ACH transfer details
    plans: { balance: number }[];
    refunds: CherryRefund[];
    modifications: CherryModification[];
    checkoutUser: CherryCheckoutUser | null;
}

/** GraphQL fetchLoans response */
export interface CherryFetchLoansResponse {
    data: {
        fetchLoans: {
            success: boolean;
            contents: CherryLoan[];
            total: number;
        };
    };
}

export interface CherryTransactionQueryOptions {
    dateStart: string;             // YYYY-MM-DD
    dateEnd: string;               // YYYY-MM-DD
    status?: string;               // Filter by status
    limit?: number;                // Max results (default: 100)
    offset?: number;               // Pagination offset
}

// ========================================
// GRAPHQL QUERY
// ========================================

/**
 * GraphQL query for fetching Cherry loans.
 * 
 * NOTE: Cherry's fetchLoans field does NOT accept filter arguments like
 * startDate, endDate, status, sortBy, or sortDirection.
 * Filtering must be done client-side after fetching all loans.
 */
const FETCH_LOANS_QUERY = `
query FetchLoans {
  fetchLoans {
    success
    total
    contents {
      id
      contractId
      applicationId
      applicationBalanceAvailable
      borrowerId
      borrowerName
      borrowerPhone
      amount
      grossAmount
      purchaseAmount
      totalAmount
      merchantFund
      merchantRevenue
      merchantId
      downPaymentAmount
      financeCharge
      installmentAmount
      transactionType
      status
      subStatus
      contractType
      selfCheckout
      promoUsed
      dispute
      tierLabel
      createdAt
      updatedAt
      createdBy
      updatedBy
      fundedAt
      originalClosedAt
      refundAmount
      demo
      product {
        id
        mdf
        promoMdf
        term
        periodLength
      }
      funds {
        id
        accountNumber
        directionType
        amount
        event
        type
        status
        createdAt
        updatedAt
      }
      plans {
        balance
      }
      refunds {
        id
        loanId
        fundId
        amount
        merchantFund
        type
        merchantRevenue
        status
        refundFee
        createdAt
      }
      modifications {
        id
        type
        amount
      }
      checkoutUser {
        id
        firstName
        lastName
      }
    }
  }
}
`;

// ========================================
// CHERRY GRAPHQL CLIENT
// ========================================

const GQL_ENDPOINT = 'https://gql.withcherry.com/';

/**
 * Cherry API Client — uses the GraphQL endpoint at gql.withcherry.com
 * 
 * Fetches loan/transaction data from Cherry's provider portal API.
 * Each clinic has its own API key from Cherry's partner portal.
 */
export class CherryClient {
    private config: CherryConfig;

    constructor(config: CherryConfig) {
        if (!config.apiKey) {
            throw new Error('Cherry API key is required');
        }
        this.config = config;
    }

    /**
     * Execute a GraphQL query against Cherry's API.
     * Tries multiple authentication strategies since we need to determine
     * which auth header format Cherry expects for API keys.
     */
    private async executeQuery<T>(query: string, variables: Record<string, any>): Promise<T> {
        const endpoint = this.config.baseUrl || GQL_ENDPOINT;
        const apiKey = this.config.apiKey;

        // Auth strategies to try — Cherry may accept any of these
        const authAttempts: { name: string; headers: Record<string, string> }[] = [
            {
                name: 'Bearer token',
                headers: { 'Authorization': `Bearer ${apiKey}` },
            },
            {
                name: 'X-Api-Key header',
                headers: { 'X-Api-Key': apiKey },
            },
            {
                name: 'Basic auth (key as user)',
                headers: { 'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}` },
            },
            {
                name: 'Api-Key header',
                headers: { 'Api-Key': apiKey },
            },
        ];

        let lastError: Error | null = null;
        let lastStatus = 0;
        let lastBody = '';

        for (const attempt of authAttempts) {
            try {
                console.log(`[CherryGQL] Trying ${attempt.name} → POST ${endpoint}`);

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        ...attempt.headers,
                    },
                    body: JSON.stringify({ query, variables }),
                });

                lastStatus = response.status;

                if (response.ok) {
                    const data: any = await response.json();

                    // Check for GraphQL-level errors
                    if (data.errors && data.errors.length > 0) {
                        const gqlError = data.errors[0].message || JSON.stringify(data.errors[0]);
                        console.warn(`[CherryGQL] GraphQL error with ${attempt.name}: ${gqlError}`);
                        lastError = new Error(`Cherry GraphQL error: ${gqlError}`);
                        lastBody = JSON.stringify(data.errors);
                        continue;
                    }

                    console.log(`[CherryGQL] ✅ Success with ${attempt.name}`);
                    return data as T;
                }

                lastBody = await response.text().catch(() => '');
                console.warn(`[CherryGQL] ${attempt.name} → HTTP ${response.status}: ${lastBody.substring(0, 200)}`);

                // If 400/422, the auth probably worked but query was bad
                if (response.status === 400 || response.status === 422) {
                    throw new Error(`Cherry GQL bad request (${response.status}): ${lastBody.substring(0, 500)}`);
                }
            } catch (error: any) {
                if (error.message.includes('Cherry GQL bad request')) throw error;
                lastError = error;
                console.warn(`[CherryGQL] ${attempt.name} failed: ${error.message}`);
            }
        }

        // All auth attempts failed
        const errorMsg = lastStatus === 401 || lastStatus === 403
            ? `Cherry API authentication failed (${lastStatus}). Check API key. Tried: ${authAttempts.map(a => a.name).join(', ')}. Response: ${lastBody.substring(0, 300)}`
            : lastStatus === 429
                ? `Cherry API rate limited (429). Try again later.`
                : `Cherry API failed (${lastStatus}): ${lastError?.message || lastBody.substring(0, 500)}`;

        throw new Error(errorMsg);
    }

    /**
     * Fetch Cherry loans (financing transactions) for a date range.
     * 
     * Cherry's fetchLoans query does NOT accept filter arguments.
     * We fetch ALL loans, then filter client-side by date range and status.
     */
    async getLoans(options: CherryTransactionQueryOptions): Promise<CherryLoan[]> {
        const { dateStart, dateEnd, status } = options;

        console.log(`[CherryGQL] Fetching all loans, will filter client-side to ${dateStart} → ${dateEnd}`);

        const response = await this.executeQuery<CherryFetchLoansResponse>(
            FETCH_LOANS_QUERY,
            {} // No variables — fetchLoans accepts no arguments
        );

        if (!response?.data?.fetchLoans?.success) {
            console.warn('[CherryGQL] fetchLoans returned success=false');
            return [];
        }

        const allLoans = response.data.fetchLoans.contents || [];
        const total = response.data.fetchLoans.total;

        console.log(`[CherryGQL] Fetched ${allLoans.length} of ${total} total loans from Cherry`);

        // Client-side filtering by date range
        let loans = allLoans.filter(loan => {
            // Use fundedAt (when money was deposited) or createdAt as fallback
            const loanDate = (loan.fundedAt || loan.createdAt || '').substring(0, 10);
            if (!loanDate) return true; // Include loans without dates
            return loanDate >= dateStart && loanDate <= dateEnd;
        });

        console.log(`[CherryGQL] After date filtering (${dateStart} → ${dateEnd}): ${loans.length}/${allLoans.length} loans`);

        // Client-side filtering by status (if requested)
        if (status) {
            const upperStatus = status.toUpperCase();
            loans = loans.filter(loan => loan.status?.toUpperCase() === upperStatus);
            console.log(`[CherryGQL] After status filtering (${upperStatus}): ${loans.length} loans`);
        }

        return loans;
    }

    /**
     * Fetch loans and return them in the legacy CherryTransaction format
     * for backward compatibility with existing reconciliation code.
     */
    async getTransactions(options: CherryTransactionQueryOptions): Promise<CherryTransactionCompat[]> {
        const loans = await this.getLoans(options);
        return loans.map(loanToTransaction);
    }

    /**
     * Test the API connection by fetching a small batch of recent loans.
     */
    async testConnection(): Promise<{ success: boolean; message: string; total?: number }> {
        try {
            const today = new Date().toISOString().split('T')[0];
            const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            const loans = await this.getLoans({
                dateStart: lastMonth,
                dateEnd: today,
                limit: 1,
            });

            return {
                success: true,
                message: `Cherry API connection successful. Found loans.`,
                total: loans.length,
            };
        } catch (error: any) {
            return { success: false, message: `Cherry API connection failed: ${error.message}` };
        }
    }
}

// ========================================
// BACKWARD COMPATIBILITY — CherryTransaction type
// ========================================

/**
 * Backward-compatible transaction type for existing code.
 * Maps from the actual Cherry GraphQL LoanSearch type.
 */
export interface CherryTransactionCompat {
    id: string;                    // Cherry loan ID
    transactionId: string;         // contractId (unique reference)
    patientName: string;           // borrowerName
    amount: number;                // purchaseAmount (treatment cost)
    merchantAmount: number;        // merchantFund (actual bank deposit)
    status: string;                // status
    createdAt: string;
    fundedAt?: string;
    settledAt?: string;
    applicationId?: string;
    planType?: string;             // e.g., "3mo MONTHLY"
    merchantFee?: number;          // merchantRevenue (Cherry's cut)
    refundAmount?: number;
    // Extended fields from GraphQL
    contractId?: string;
    grossAmount?: number;
    downPaymentAmount?: number;
    financeCharge?: number;
    subStatus?: string;
    contractType?: string;
    borrowerPhone?: string;
    tierLabel?: string;
    funds?: CherryFund[];
}

/** Convert a Cherry GraphQL LoanSearch to the backward-compatible format */
function loanToTransaction(loan: CherryLoan): CherryTransactionCompat {
    const planDesc = loan.product
        ? `${loan.product.term}mo ${loan.product.periodLength || 'MONTHLY'}`
        : 'financing';

    return {
        id: loan.id,
        transactionId: loan.contractId,
        patientName: loan.borrowerName,
        amount: loan.purchaseAmount,
        merchantAmount: loan.merchantFund,
        status: loan.status,
        createdAt: loan.createdAt,
        fundedAt: loan.fundedAt || undefined,
        settledAt: undefined, // Cherry doesn't have a separate "settled" date
        applicationId: String(loan.applicationId),
        planType: planDesc,
        merchantFee: loan.merchantRevenue,
        refundAmount: loan.refundAmount || undefined,
        contractId: loan.contractId,
        grossAmount: loan.grossAmount,
        downPaymentAmount: loan.downPaymentAmount,
        financeCharge: loan.financeCharge,
        subStatus: loan.subStatus,
        contractType: loan.contractType,
        borrowerPhone: loan.borrowerPhone,
        tierLabel: loan.tierLabel,
        funds: loan.funds,
    };
}

// ========================================
// HELPER: Convert Cherry loans to BankStatementRow format
// ========================================

/**
 * Convert Cherry loans into BankStatementRow format
 * for use in the reconciliation matching engine.
 * 
 * For reconciliation, we use the individual fund transfers (MERCHANT_CREDIT)
 * because those represent the actual ACH deposits to the clinic's bank account.
 * 
 * Each funded loan has a `funds[]` array. Each fund entry with
 * directionType="MERCHANT_CREDIT" is an actual bank deposit.
 * 
 * The `merchantFund` on the loan itself is the total of all MERCHANT_CREDIT funds.
 */
export function cherryLoansToBankRows(loans: CherryLoan[]): BankStatementRow[] {
    const rows: BankStatementRow[] = [];

    for (const loan of loans) {
        // Skip voided/demo loans
        if (loan.status === 'VOIDED' || loan.demo) continue;

        // Extract actual bank deposits from the funds array
        const creditFunds = loan.funds.filter(
            f => f.directionType === 'MERCHANT_CREDIT' && f.status === 'COMPLETED'
        );

        if (creditFunds.length > 0) {
            // Create a bank row for each completed credit fund transfer
            for (const fund of creditFunds) {
                rows.push({
                    rowId: `cherry-${loan.id}-${fund.id}`,
                    date: (fund.createdAt || loan.fundedAt || loan.createdAt).substring(0, 10),
                    reference: loan.contractId,
                    description: `Cherry - ${loan.borrowerName} (${loan.product?.term || '?'}mo, acct ${fund.accountNumber})`,
                    amount: Math.abs(fund.amount),
                    type: 'CREDIT' as const,
                });
            }
        } else if (loan.merchantFund > 0 && (loan.status === 'FUNDED' || loan.status === 'COMPLETED')) {
            // Fallback: use loan-level merchantFund if no individual fund entries
            rows.push({
                rowId: `cherry-${loan.id}`,
                date: (loan.fundedAt || loan.createdAt).substring(0, 10),
                reference: loan.contractId,
                description: `Cherry - ${loan.borrowerName} (${loan.product?.term || '?'}mo)`,
                amount: Math.abs(loan.merchantFund),
                type: 'CREDIT' as const,
            });
        }

        // Also add MERCHANT_DEBIT entries (refund clawbacks) as debits
        const debitFunds = loan.funds.filter(
            f => f.directionType === 'MERCHANT_DEBIT' && f.status === 'COMPLETED'
        );

        for (const fund of debitFunds) {
            rows.push({
                rowId: `cherry-refund-${loan.id}-${fund.id}`,
                date: (fund.createdAt || loan.createdAt).substring(0, 10),
                reference: loan.contractId,
                description: `Cherry Refund - ${loan.borrowerName} (clawback)`,
                amount: Math.abs(fund.amount),
                type: 'DEBIT' as const,
            });
        }
    }

    return rows;
}

/**
 * Backward-compatible wrapper: converts CherryTransactionCompat[] to BankStatementRows.
 * Used by the existing accounting index.ts code.
 */
export function cherryTransactionsToBankRows(transactions: CherryTransactionCompat[]): BankStatementRow[] {
    return transactions
        .filter(txn => {
            const status = txn.status.toUpperCase();
            return status === 'FUNDED' || status === 'COMPLETED';
        })
        .filter(txn => txn.merchantAmount > 0)  // Skip voided transactions with 0 amount
        .map((txn, idx) => ({
            rowId: `cherry-${txn.transactionId || txn.id || idx}`,
            date: (txn.fundedAt || txn.createdAt || '').substring(0, 10),
            reference: txn.transactionId || txn.contractId || txn.id || '',
            description: `Cherry - ${txn.patientName || 'Unknown'} (${txn.planType || 'financing'})`,
            amount: Math.abs(txn.merchantAmount || txn.amount || 0),
            type: 'CREDIT' as const,
        }));
}

/**
 * Cherry API Client Utility
 * 
 * Provides functions for interacting with Cherry's partner API
 * to fetch financing transaction and settlement data for reconciliation.
 * 
 * Cherry is a patient financing company — each clinic has its own API key
 * from Cherry's partner portal (partner.withcherry.com).
 * 
 * API keys are stored per-clinic in the ClinicSecrets DynamoDB table.
 * 
 * Usage:
 *   import { CherryClient } from '../../shared/utils/cherry-api';
 *   
 *   const client = new CherryClient({ apiKey: 'B-xxxx...' });
 *   const transactions = await client.getTransactions({ dateStart: '2024-01-01', dateEnd: '2024-01-31' });
 */

// ========================================
// TYPES
// ========================================

export interface CherryConfig {
    apiKey: string;
    baseUrl?: string; // Default: https://partner.withcherry.com/api
}

export interface CherryTransaction {
    id: string;                    // Cherry transaction ID
    transactionId: string;         // Unique transaction reference
    patientName: string;           // Patient's full name
    amount: number;                // Total financing amount
    merchantAmount: number;        // Amount paid to merchant (after Cherry fees)
    status: string;                // approved, funded, settled, refunded, etc.
    createdAt: string;             // Transaction creation date (ISO)
    fundedAt?: string;             // Date funds were sent to merchant
    settledAt?: string;            // Date settlement was completed
    applicationId?: string;        // Cherry application ID
    planType?: string;             // Financing plan type (e.g., "12mo_0apr")
    merchantFee?: number;          // Cherry's merchant fee amount
    refundAmount?: number;         // Refund amount if applicable
}

export interface CherrySettlement {
    id: string;                    // Settlement batch ID
    settlementDate: string;        // Date of settlement
    totalAmount: number;           // Total settlement amount
    transactionCount: number;      // Number of transactions in batch
    status: string;                // pending, completed
    transactions: CherrySettlementTransaction[];
}

export interface CherrySettlementTransaction {
    transactionId: string;
    patientName: string;
    amount: number;
    merchantAmount: number;
    fee: number;
}

export interface CherryTransactionQueryOptions {
    dateStart: string;             // YYYY-MM-DD
    dateEnd: string;               // YYYY-MM-DD
    status?: string;               // Filter by status
    limit?: number;                // Max results (default: 500)
    offset?: number;               // Pagination offset
}

// ========================================
// CHERRY API CLIENT
// ========================================

const DEFAULT_BASE_URL = 'https://partner.withcherry.com/api/v1';

/**
 * Make an authenticated HTTP request to the Cherry API
 * Uses native fetch API (same pattern as odoo-api.ts)
 */
async function makeRequest<T>(
    config: CherryConfig,
    method: string,
    path: string,
    queryParams?: Record<string, string>,
    body?: any
): Promise<T> {
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;

    // Build full URL with query string
    let fullUrl = `${baseUrl}${path}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
        const params = new URLSearchParams(queryParams);
        fullUrl += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    console.log(`[CherryAPI] ${method} ${fullUrl}`);

    const fetchOptions: RequestInit = {
        method,
        headers,
    };

    if (body) {
        fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(fullUrl, fetchOptions);

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (response.status === 401) {
            throw new Error(`Cherry API authentication failed (401). Check API key.`);
        } else if (response.status === 403) {
            throw new Error(`Cherry API access denied (403). API key may lack permissions.`);
        } else if (response.status === 429) {
            throw new Error(`Cherry API rate limited (429). Try again later.`);
        } else {
            throw new Error(`Cherry API returned ${response.status}: ${errorBody.substring(0, 500)}`);
        }
    }

    const data = await response.json();
    return data as T;
}

/**
 * Cherry API Client
 * 
 * Fetches transaction and settlement data from Cherry's partner API.
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
     * Fetch transactions from Cherry for a date range.
     * Returns individual patient financing transactions.
     */
    async getTransactions(options: CherryTransactionQueryOptions): Promise<CherryTransaction[]> {
        const { dateStart, dateEnd, status, limit = 500, offset = 0 } = options;

        console.log(`[CherryAPI] Fetching transactions from ${dateStart} to ${dateEnd}`);

        const queryParams: Record<string, string> = {
            start_date: dateStart,
            end_date: dateEnd,
            limit: String(limit),
            offset: String(offset),
        };

        if (status) {
            queryParams.status = status;
        }

        try {
            const response = await makeRequest<any>(
                this.config,
                'GET',
                '/transactions',
                queryParams
            );

            // Normalize the response — Cherry API may return { data: [...] } or [...] directly
            const rawTransactions = Array.isArray(response) ? response : (response?.data || response?.transactions || []);

            if (!Array.isArray(rawTransactions)) {
                console.warn('[CherryAPI] Unexpected response format:', typeof response);
                return [];
            }

            // Map Cherry API response to our CherryTransaction type
            const transactions: CherryTransaction[] = rawTransactions.map((txn: any) => ({
                id: String(txn.id || txn.transaction_id || ''),
                transactionId: String(txn.transaction_id || txn.id || txn.reference_id || ''),
                patientName: txn.patient_name || txn.consumer_name || txn.customer_name || '',
                amount: Number(txn.amount || txn.total_amount || 0),
                merchantAmount: Number(txn.merchant_amount || txn.net_amount || txn.funded_amount || txn.amount || 0),
                status: String(txn.status || 'unknown'),
                createdAt: txn.created_at || txn.date || txn.transaction_date || '',
                fundedAt: txn.funded_at || txn.funding_date || undefined,
                settledAt: txn.settled_at || txn.settlement_date || undefined,
                applicationId: txn.application_id || txn.app_id || undefined,
                planType: txn.plan_type || txn.financing_plan || undefined,
                merchantFee: txn.merchant_fee != null ? Number(txn.merchant_fee) : undefined,
                refundAmount: txn.refund_amount != null ? Number(txn.refund_amount) : undefined,
            }));

            console.log(`[CherryAPI] Fetched ${transactions.length} transactions`);
            return transactions;
        } catch (error: any) {
            console.error(`[CherryAPI] Error fetching transactions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch settlements (funding batches) from Cherry for a date range.
     * Settlements represent batches of transactions funded to the merchant.
     */
    async getSettlements(dateStart: string, dateEnd: string): Promise<CherrySettlement[]> {
        console.log(`[CherryAPI] Fetching settlements from ${dateStart} to ${dateEnd}`);

        try {
            const response = await makeRequest<any>(
                this.config,
                'GET',
                '/settlements',
                {
                    start_date: dateStart,
                    end_date: dateEnd,
                }
            );

            const rawSettlements = Array.isArray(response) ? response : (response?.data || response?.settlements || []);

            if (!Array.isArray(rawSettlements)) {
                console.warn('[CherryAPI] Unexpected settlements response format:', typeof response);
                return [];
            }

            const settlements: CherrySettlement[] = rawSettlements.map((s: any) => ({
                id: String(s.id || s.settlement_id || ''),
                settlementDate: s.settlement_date || s.date || '',
                totalAmount: Number(s.total_amount || s.amount || 0),
                transactionCount: Number(s.transaction_count || s.count || 0),
                status: String(s.status || 'unknown'),
                transactions: Array.isArray(s.transactions) ? s.transactions.map((t: any) => ({
                    transactionId: String(t.transaction_id || t.id || ''),
                    patientName: t.patient_name || t.consumer_name || '',
                    amount: Number(t.amount || 0),
                    merchantAmount: Number(t.merchant_amount || t.net_amount || 0),
                    fee: Number(t.fee || t.merchant_fee || 0),
                })) : [],
            }));

            console.log(`[CherryAPI] Fetched ${settlements.length} settlements`);
            return settlements;
        } catch (error: any) {
            console.error(`[CherryAPI] Error fetching settlements: ${error.message}`);
            throw error;
        }
    }

    /**
     * Test the API connection by fetching a small batch of recent transactions.
     * Useful for validating API key configuration.
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            const today = new Date().toISOString().split('T')[0];
            const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            await this.getTransactions({
                dateStart: lastMonth,
                dateEnd: today,
                limit: 1,
            });

            return { success: true, message: 'Cherry API connection successful' };
        } catch (error: any) {
            return { success: false, message: `Cherry API connection failed: ${error.message}` };
        }
    }
}

// ========================================
// HELPER: Convert Cherry transactions to BankStatementRow format
// ========================================

import { BankStatementRow } from '../../services/accounting/types';

/**
 * Convert Cherry transactions into BankStatementRow format
 * for use in the reconciliation matching engine.
 * 
 * Cherry pays the merchant the `merchantAmount` (after fees),
 * so we use merchantAmount as the bank-side amount for reconciliation.
 * The reference field uses the Cherry transaction ID for matching.
 */
export function cherryTransactionsToBankRows(transactions: CherryTransaction[]): BankStatementRow[] {
    return transactions
        .filter(txn => {
            // Only include funded/settled transactions (money actually received by clinic)
            const status = txn.status.toLowerCase();
            return status === 'funded' || status === 'settled' || status === 'completed' || status === 'approved';
        })
        .map((txn, idx) => ({
            rowId: `cherry-${txn.transactionId || txn.id || idx}`,
            date: (txn.fundedAt || txn.settledAt || txn.createdAt || '').substring(0, 10),
            reference: txn.transactionId || txn.id || '',
            description: `Cherry - ${txn.patientName || 'Unknown'} (${txn.planType || 'financing'})`,
            amount: Math.abs(txn.merchantAmount || txn.amount || 0),
            type: 'CREDIT' as const,
        }));
}

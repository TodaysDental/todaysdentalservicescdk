/**
 * Odoo JSON-RPC API Utility Functions
 * Provides reusable functions for interacting with the Odoo API for bank reconciliation
 */

// ========================================
// TYPES
// ========================================

export interface OdooConfig {
  url: string;       // https://todays-dental-services.odoo.com
  database: string;  // todays-dental-services
  apiKey: string;    // API key (used in place of password)
  username?: string; // Optional username (defaults to API user)
}

export interface OdooBankTransaction {
  id: number;
  date: string;
  ref: string | false;
  payment_ref: string | false;
  amount: number;
  partner_id: [number, string] | false;
  statement_id: [number, string] | false;
  company_id: [number, string];
  name: string | false;
  narration: string | false;
}

export interface OdooCompany {
  id: number;
  name: string;
  partner_id: [number, string];
}

export interface OdooBankJournal {
  id: number;
  name: string;
  code: string;
  company_id: [number, string];
  type: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: any;
  id: number;
}

interface JsonRpcResponse<T = any> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// ========================================
// INTERNAL HELPERS
// ========================================

let requestId = 0;

function getNextRequestId(): number {
  return ++requestId;
}

async function makeJsonRpcCall<T>(
  url: string,
  method: string,
  params: any
): Promise<T> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id: getNextRequestId(),
  };

  console.log(`[Odoo] Making JSON-RPC call: ${method}`, JSON.stringify(params, null, 2));

  const response = await fetch(`${url}/jsonrpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Odoo HTTP error: ${response.status} ${response.statusText}`);
  }

  const result: JsonRpcResponse<T> = await response.json();

  if (result.error) {
    console.error('[Odoo] JSON-RPC error:', result.error);
    throw new Error(`Odoo API error: ${result.error.message}`);
  }

  return result.result as T;
}

// ========================================
// AUTHENTICATION
// ========================================

/**
 * Authenticate with Odoo using API key
 * Returns the user ID (uid) for subsequent API calls
 * 
 * @param config - Odoo configuration
 * @returns User ID for authenticated session
 */
export async function authenticateOdoo(config: OdooConfig): Promise<number> {
  console.log(`[Odoo] Authenticating with ${config.url}`);

  // Odoo uses API key in place of password for external API access
  const uid = await makeJsonRpcCall<number>(config.url, 'call', {
    service: 'common',
    method: 'authenticate',
    args: [
      config.database,
      config.username || 'api',
      config.apiKey,
      {}
    ],
  });

  if (!uid) {
    throw new Error('Odoo authentication failed: No user ID returned');
  }

  console.log(`[Odoo] Authenticated successfully as uid: ${uid}`);
  return uid;
}

/**
 * Get Odoo version information
 * Useful for verifying connectivity
 */
export async function getOdooVersion(config: OdooConfig): Promise<any> {
  return await makeJsonRpcCall(config.url, 'call', {
    service: 'common',
    method: 'version',
    args: [],
  });
}

// ========================================
// BANK TRANSACTIONS
// ========================================

/**
 * Fetch bank statement lines from Odoo filtered by company and date range
 * Uses the account.bank.statement.line model
 * 
 * @param uid - Authenticated user ID
 * @param config - Odoo configuration
 * @param options - Query options
 * @returns Array of bank transactions
 */
export async function fetchBankTransactions(
  uid: number,
  config: OdooConfig,
  options: {
    companyId: number;
    dateStart: string;
    dateEnd: string;
    limit?: number;
  }
): Promise<OdooBankTransaction[]> {
  console.log(`[Odoo] Fetching bank transactions for company ${options.companyId} from ${options.dateStart} to ${options.dateEnd}`);

  const domain = [
    ['company_id', '=', options.companyId],
    ['date', '>=', options.dateStart],
    ['date', '<=', options.dateEnd],
  ];

  const fields = [
    'id',
    'date',
    'ref',
    'payment_ref',
    'amount',
    'partner_id',
    'statement_id',
    'company_id',
    'name',
    'narration',
  ];

  const transactions = await makeJsonRpcCall<OdooBankTransaction[]>(config.url, 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [
      config.database,
      uid,
      config.apiKey,
      'account.bank.statement.line',
      'search_read',
      [domain],
      {
        fields,
        limit: options.limit || 1000,
        order: 'date desc',
      },
    ],
  });

  console.log(`[Odoo] Found ${transactions.length} bank transactions`);
  return transactions;
}

/**
 * Fetch bank journal entries (posted moves) from Odoo
 * Uses the account.move.line model - alternative to bank statement lines
 * 
 * @param uid - Authenticated user ID
 * @param config - Odoo configuration
 * @param options - Query options
 * @returns Array of journal entry lines
 */
export async function fetchBankJournalEntries(
  uid: number,
  config: OdooConfig,
  options: {
    companyId: number;
    dateStart: string;
    dateEnd: string;
    journalId?: number;
    limit?: number;
  }
): Promise<any[]> {
  console.log(`[Odoo] Fetching bank journal entries for company ${options.companyId}`);

  const domain: any[] = [
    ['company_id', '=', options.companyId],
    ['date', '>=', options.dateStart],
    ['date', '<=', options.dateEnd],
    ['journal_id.type', '=', 'bank'],
    ['parent_state', '=', 'posted'],
  ];

  if (options.journalId) {
    domain.push(['journal_id', '=', options.journalId]);
  }

  const fields = [
    'id',
    'date',
    'name',
    'ref',
    'debit',
    'credit',
    'balance',
    'partner_id',
    'move_id',
    'journal_id',
    'company_id',
  ];

  const entries = await makeJsonRpcCall<any[]>(config.url, 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [
      config.database,
      uid,
      config.apiKey,
      'account.move.line',
      'search_read',
      [domain],
      {
        fields,
        limit: options.limit || 1000,
        order: 'date desc',
      },
    ],
  });

  console.log(`[Odoo] Found ${entries.length} bank journal entries`);
  return entries;
}

// ========================================
// COMPANY & JOURNAL QUERIES
// ========================================

/**
 * Get all companies from Odoo
 * 
 * @param uid - Authenticated user ID
 * @param config - Odoo configuration
 * @returns Array of companies
 */
export async function getCompanies(
  uid: number,
  config: OdooConfig
): Promise<OdooCompany[]> {
  console.log(`[Odoo] Fetching companies`);

  const companies = await makeJsonRpcCall<OdooCompany[]>(config.url, 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [
      config.database,
      uid,
      config.apiKey,
      'res.company',
      'search_read',
      [[]],
      {
        fields: ['id', 'name', 'partner_id'],
      },
    ],
  });

  console.log(`[Odoo] Found ${companies.length} companies`);
  return companies;
}

/**
 * Get bank journals for a specific company
 * 
 * @param uid - Authenticated user ID
 * @param config - Odoo configuration
 * @param companyId - The company ID
 * @returns Array of bank journals
 */
export async function getBankJournals(
  uid: number,
  config: OdooConfig,
  companyId: number
): Promise<OdooBankJournal[]> {
  console.log(`[Odoo] Fetching bank journals for company ${companyId}`);

  const journals = await makeJsonRpcCall<OdooBankJournal[]>(config.url, 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [
      config.database,
      uid,
      config.apiKey,
      'account.journal',
      'search_read',
      [[
        ['company_id', '=', companyId],
        ['type', '=', 'bank'],
      ]],
      {
        fields: ['id', 'name', 'code', 'company_id', 'type'],
      },
    ],
  });

  console.log(`[Odoo] Found ${journals.length} bank journals`);
  return journals;
}

// ========================================
// PARTNER (CUSTOMER) QUERIES
// ========================================

/**
 * Search for a partner (customer/vendor) by name
 * 
 * @param uid - Authenticated user ID
 * @param config - Odoo configuration
 * @param name - Partner name to search
 * @param companyId - Optional company filter
 * @returns Array of matching partners
 */
export async function searchPartnerByName(
  uid: number,
  config: OdooConfig,
  name: string,
  companyId?: number
): Promise<Array<{ id: number; name: string; email: string | false }>> {
  console.log(`[Odoo] Searching partner by name: ${name}`);

  const domain: any[] = [
    ['name', 'ilike', name],
  ];

  if (companyId) {
    domain.push(['company_id', '=', companyId]);
  }

  const partners = await makeJsonRpcCall<any[]>(config.url, 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [
      config.database,
      uid,
      config.apiKey,
      'res.partner',
      'search_read',
      [domain],
      {
        fields: ['id', 'name', 'email'],
        limit: 10,
      },
    ],
  });

  return partners;
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Get Odoo configuration from environment variables
 */
export function getOdooConfigFromEnv(): OdooConfig {
  const url = process.env.ODOO_URL;
  const database = process.env.ODOO_DATABASE;
  const apiKey = process.env.ODOO_API_KEY;

  if (!url || !database || !apiKey) {
    throw new Error('Missing Odoo configuration. Required: ODOO_URL, ODOO_DATABASE, ODOO_API_KEY');
  }

  return {
    url,
    database,
    apiKey,
  };
}

/**
 * Create a full Odoo API client with cached authentication
 */
export class OdooClient {
  private config: OdooConfig;
  private uid: number | null = null;

  constructor(config: OdooConfig) {
    this.config = config;
  }

  static fromEnv(): OdooClient {
    return new OdooClient(getOdooConfigFromEnv());
  }

  async authenticate(): Promise<number> {
    if (!this.uid) {
      this.uid = await authenticateOdoo(this.config);
    }
    return this.uid;
  }

  async getBankTransactions(options: {
    companyId: number;
    dateStart: string;
    dateEnd: string;
    limit?: number;
  }): Promise<OdooBankTransaction[]> {
    const uid = await this.authenticate();
    return fetchBankTransactions(uid, this.config, options);
  }

  async getCompanies(): Promise<OdooCompany[]> {
    const uid = await this.authenticate();
    return getCompanies(uid, this.config);
  }

  async getBankJournals(companyId: number): Promise<OdooBankJournal[]> {
    const uid = await this.authenticate();
    return getBankJournals(uid, this.config, companyId);
  }
}

import https from 'https';
import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  getAllowedClinicIds,
  hasClinicAccess,
  hasModulePermission,
  isAdminUser,
} from '../../shared/utils/permissions-helper';
import {
  getClinicConfig,
  getClinicIds,
  getClinicSecrets,
  getGlobalSecret,
} from '../../shared/utils/secrets-helper';
import type { StaffUser, ClinicRoleAssignment } from '../../shared/types/user';
import type { PermissionType } from '../../shared/utils/permissions-helper';

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || '';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';

const MODULE_NAME = 'Finance';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function getCors(event: APIGatewayProxyEvent) {
  return buildCorsHeaders(
    { allowMethods: ['OPTIONS', 'GET'] },
    event.headers?.origin || event.headers?.Origin
  );
}

function httpErr(event: APIGatewayProxyEvent, code: number, message: string): APIGatewayProxyResult {
  return {
    statusCode: code,
    headers: getCors(event),
    body: JSON.stringify({ success: false, message }),
  };
}

function httpOk(event: APIGatewayProxyEvent, payload: Record<string, any>): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: getCors(event),
    body: JSON.stringify({ success: true, ...payload }),
  };
}

function parseDateYmd(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function toNumber(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSql(sql: string): string {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value: any): string {
  return String(value || '').trim().toLowerCase();
}

function isClaimsRole(role: unknown): boolean {
  return String(role || '').trim().toLowerCase() === 'claims';
}

function hasFinanceReadForClinic(userPerms: any, clinicId: string): boolean {
  return hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    'read',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    clinicId
  );
}

function canAccessClinicSalary(userPerms: any, clinicId: string): boolean {
  if (isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) return true;
  if (hasFinanceReadForClinic(userPerms, clinicId)) return true;
  return userPerms.clinicRoles?.some((cr: any) => cr?.clinicId === clinicId && isClaimsRole(cr?.role)) || false;
}

function pickOpenDentalUsernameFromClinicRole(role: any): string | null {
  const candidates = [
    role?.UserName,
    role?.openDentalUsername,
    role?.OpenDentalUsername,
    role?.userName,
    role?.username,
  ];
  for (const c of candidates) {
    const v = String(c || '').trim();
    if (v) return v;
  }
  return null;
}

function pickRatesFromClinicRole(role: any): {
  perClaimsPostedAmount: number;
  perEobsAttachedAmount: number;
  statusDeniedAmount: number;
} {
  return {
    perClaimsPostedAmount: toNumber(role?.perClaimsPostedAmount ?? role?.perClaimEntered ?? role?.perClaimEnteredAmount),
    perEobsAttachedAmount: toNumber(role?.perEobsAttachedAmount ?? role?.perEobAttachedAmount ?? role?.perEobAmount),
    statusDeniedAmount: toNumber(role?.statusDeniedAmount ?? role?.perDeniedAmount ?? role?.deniedAmount),
  };
}

type AssigneeClinicRates = {
  email: string;
  assigneeName: string;
  clinicId: string;
  openDentalUsername: string;
  perClaimsPostedAmount: number;
  perEobsAttachedAmount: number;
  statusDeniedAmount: number;
};

type SalaryRow = {
  clinicId: string;
  practice: string;
  assigneeEmail: string;
  assignee: string;
  openDentalUsername: string;
  claimsPosted: number;
  perClaimsPostedAmount: number;
  claimsPostedEarnings: number;
  eobsAttached: number;
  perEobsAttachedAmount: number;
  eobsAttachedEarnings: number;
  deniedClaims: number;
  statusDeniedAmount: number;
  deniedEarnings: number;
  totalEarnings: number;
};

function buildClaimsSalaryCountsSql(dateStart: string, dateEnd: string): string {
  return `
SET @DateStart = '${dateStart}';
SET @DateEnd   = '${dateEnd}';

SELECT
  t.EnteredBy,
  SUM(t.ClaimsPosted) AS ClaimsPosted,
  SUM(t.EobsAttached) AS EobsAttached,
  SUM(t.DeniedClaims) AS DeniedClaims
FROM (
  /* Claims posted/entered by date of entry */
  SELECT
    u.UserName AS EnteredBy,
    COUNT(*) AS ClaimsPosted,
    0 AS EobsAttached,
    0 AS DeniedClaims
  FROM claim c
  INNER JOIN userod u ON u.UserNum = c.SecUserNumEntry
  WHERE c.SecDateEntry BETWEEN @DateStart AND @DateEnd
  GROUP BY u.UserName

  UNION ALL

  /* EOB attached per claim: claims that have at least one eobattach on any attached claimpayment */
  SELECT
    u.UserName AS EnteredBy,
    0 AS ClaimsPosted,
    COUNT(DISTINCT c.ClaimNum) AS EobsAttached,
    0 AS DeniedClaims
  FROM claim c
  INNER JOIN claimproc cp2 ON cp2.ClaimNum = c.ClaimNum
  INNER JOIN claimpayment cp ON cp.ClaimPaymentNum = cp2.ClaimPaymentNum
  INNER JOIN eobattach ea ON ea.ClaimPaymentNum = cp.ClaimPaymentNum
  INNER JOIN userod u ON u.UserNum = cp.SecUserNumEntry
  WHERE c.SecDateEntry BETWEEN @DateStart AND @DateEnd
    AND ea.FileName IS NOT NULL AND ea.FileName <> ''
  GROUP BY u.UserName

  UNION ALL

  /* Denied claim status history entries */
  SELECT
    u.UserName AS EnteredBy,
    0 AS ClaimsPosted,
    0 AS EobsAttached,
    COUNT(DISTINCT ct.ClaimNum) AS DeniedClaims
  FROM claimtracking ct
  INNER JOIN definition d ON d.DefNum = ct.TrackingDefNum
  INNER JOIN userod u ON u.UserNum = ct.UserNum
  WHERE ct.TrackingType = 'StatusHistory'
    AND ct.DateTimeEntry >= CONCAT(@DateStart,' 00:00:00')
    AND ct.DateTimeEntry <  DATE_ADD(CONCAT(@DateEnd,' 00:00:00'), INTERVAL 1 DAY)
    AND LOWER(d.ItemName) LIKE '%denied%'
  GROUP BY u.UserName
) t
GROUP BY t.EnteredBy
ORDER BY t.EnteredBy;
  `.trim();
}

type DownloadCsvByNameOpts = {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string;
  fileName: string;
};

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 1000): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function downloadCsvByNameOnce(opts: DownloadCsvByNameOpts): Promise<string> {
  const { host, port, username, password, remoteDir, fileName } = opts;
  const conn = new SSH2Client();
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('SFTP connection timeout'));
    }, 30000);

    conn
      .on('ready', () => {
        conn.sftp((err: any, sftp: any) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            reject(err);
            return;
          }

          const actualPath = `${remoteDir}/${fileName}`;
          const startedAt = Date.now();
          const maxWaitMs = 20000;
          const pollMs = 750;
          let lastSize: number | null = null;
          let stableCount = 0;

          const pollForFile = () => {
            sftp.stat(actualPath, (statErr: any, stats: any) => {
              if (statErr) {
                if (Date.now() - startedAt > maxWaitMs) {
                  clearTimeout(timeout);
                  conn.end();
                  reject(new Error(`CSV file not found on SFTP after ${maxWaitMs}ms: ${fileName}`));
                  return;
                }
                setTimeout(pollForFile, pollMs);
                return;
              }

              const size = typeof stats?.size === 'number' ? (stats.size as number) : null;
              if (size !== null && lastSize !== null && size === lastSize) {
                stableCount += 1;
              } else {
                stableCount = 0;
              }
              if (size !== null) lastSize = size;

              if (stableCount >= 1) {
                const readStream = sftp.createReadStream(actualPath);
                let csvContent = '';
                readStream.on('data', (chunk: any) => {
                  csvContent += chunk.toString();
                });
                readStream.on('end', () => {
                  clearTimeout(timeout);
                  conn.end();
                  resolve(csvContent);
                });
                readStream.on('error', (e: any) => {
                  clearTimeout(timeout);
                  conn.end();
                  reject(e);
                });
                return;
              }

              setTimeout(pollForFile, pollMs);
            });
          };

          pollForFile();
        });
      })
      .on('error', (e: any) => {
        clearTimeout(timeout);
        reject(e);
      })
      .connect({ host, port, username, password, readyTimeout: 15000 });
  });
}

async function downloadCsvByName(opts: DownloadCsvByNameOpts): Promise<string> {
  return retryWithBackoff(() => downloadCsvByNameOnce(opts), 3, 1500);
}

async function makeOpenDentalRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string | null
): Promise<{ statusCode: number; headers: any; body: string }> {
  const finalHeaders = { ...headers };
  if (body) {
    finalHeaders['Content-Length'] = Buffer.byteLength(body).toString();
  }

  const options = { hostname: 'api.opendental.com', path, method, headers: finalHeaders } as any;
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function isRetryableOpenDentalQueriesFailure(statusCode: number, body: string): boolean {
  // Typical transient statuses
  if ([408, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;

  // Some OpenDental-hosted environments intermittently fail to connect to our AWS Transfer SFTP endpoint.
  // Only retry a narrow subset of 400s that clearly represent a transient SFTP handshake / connection issue.
  if (statusCode === 400) {
    const b = String(body || '').toLowerCase();
    const isSaveResult = b.includes('unable to save query result');
    const isHandshakeOrEarlyClose =
      b.includes('ssh identification string') ||
      b.includes('protocol version exchange') ||
      b.includes('connection to the remote server was closed') ||
      b.includes('connection was closed') ||
      b.includes('timed out') ||
      b.includes('timeout');
    if (isSaveResult && isHandshakeOrEarlyClose) return true;
  }

  return false;
}

async function createOpenDentalQueryWithRetry(params: {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  maxAttempts?: number;
  baseDelayMs?: number;
}): Promise<{ resp: { statusCode: number; headers: any; body: string }; attempts: number }> {
  const maxAttempts = Math.max(1, params.maxAttempts ?? 3);
  const baseDelayMs = Math.max(250, params.baseDelayMs ?? 1500);

  let lastResp: { statusCode: number; headers: any; body: string } | null = null;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await makeOpenDentalRequest(params.method, params.path, params.headers, params.body);
      lastResp = resp;
      lastErr = null;

      if (resp.statusCode === 201) {
        return { resp, attempts: attempt };
      }

      if (attempt < maxAttempts && isRetryableOpenDentalQueriesFailure(resp.statusCode, resp.body)) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return { resp, attempts: attempt };
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  if (lastResp) return { resp: lastResp, attempts: maxAttempts };
  throw lastErr || new Error('OpenDental /queries failed');
}

async function runOpenDentalSqlQuery(clinicId: string, sql: string, requestId: string): Promise<any[]> {
  const [secrets, sftpPassword] = await Promise.all([
    getClinicSecrets(clinicId),
    getGlobalSecret('consolidated_sftp', 'password'),
  ]);
  if (!secrets?.openDentalDeveloperKey || !secrets?.openDentalCustomerKey) {
    throw new Error(`Missing OpenDental API credentials for clinicId=${clinicId}`);
  }
  if (!CONSOLIDATED_SFTP_HOST) {
    throw new Error('Missing CONSOLIDATED_SFTP_HOST environment variable');
  }
  if (!sftpPassword) {
    throw new Error('Missing consolidated SFTP password (GlobalSecrets: consolidated_sftp/password)');
  }

  const clean = (s: string) => (s || '').replace(/^(https?:\/\/)?/, '').replace(/^\/+|\/+$/g, '');
  const host = clean(CONSOLIDATED_SFTP_HOST);
  const username = 'sftpuser';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeClinic = clinicId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeRid = requestId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
  const fileName = `claims_salary_${safeClinic}_${timestamp}_${safeRid}.csv`;
  const sftpAddress = `${host}/${fileName}`;

  const apiPath = `/api/v1/queries`;
  const headers = {
    Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`,
    'Content-Type': 'application/json',
  };

  const apiBody = JSON.stringify({
    SqlCommand: normalizeSql(sql),
    SftpAddress: sftpAddress,
    SftpUsername: username,
    SftpPassword: sftpPassword,
    SftpPort: 22,
    IsAsync: 'false',
  });

  const { resp: apiResp, attempts } = await createOpenDentalQueryWithRetry({
    method: 'POST',
    path: apiPath,
    headers,
    body: apiBody,
    maxAttempts: 3,
    baseDelayMs: 1500,
  });
  if (apiResp.statusCode !== 201) {
    const attemptNote = attempts > 1 ? ` (after ${attempts} attempts)` : '';
    throw new Error(`OpenDental /queries failed (${apiResp.statusCode})${attemptNote}: ${String(apiResp.body || '').slice(0, 500)}`);
  }

  // Wait briefly for OpenDental to write the file
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const csvData = await downloadCsvByName({
    host,
    port: 22,
    username,
    password: sftpPassword,
    remoteDir: '.',
    fileName,
  });

  if (String(csvData || '').trim() === 'OK') return [];
  const records = parseCsv(csvData, { columns: true, skip_empty_lines: true, trim: true });
  return Array.isArray(records) ? records : [];
}

async function scanAllStaffUsers(projectionExpression: string): Promise<any[]> {
  if (!STAFF_USER_TABLE) return [];
  const items: any[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const resp = await ddb.send(new ScanCommand({
      TableName: STAFF_USER_TABLE,
      ProjectionExpression: projectionExpression,
      ExclusiveStartKey: lastKey,
    }));
    if (Array.isArray(resp.Items)) items.push(...resp.Items);
    lastKey = resp.LastEvaluatedKey as any;
  } while (lastKey);

  return items;
}

async function getStaffUserByEmail(email: string): Promise<StaffUser | null> {
  if (!STAFF_USER_TABLE) return null;
  const safeEmail = email.trim().toLowerCase();
  if (!safeEmail) return null;
  const resp = await ddb.send(new GetCommand({ TableName: STAFF_USER_TABLE, Key: { email: safeEmail } }));
  return (resp.Item as StaffUser) || null;
}

function buildAssigneeName(user: { givenName?: string; familyName?: string; email?: string }, fallback: string): string {
  const name = [user.givenName, user.familyName].filter(Boolean).join(' ').trim();
  return name || user.givenName || user.email || fallback;
}

function buildRatesIndex(
  users: Array<Pick<StaffUser, 'email' | 'givenName' | 'familyName' | 'clinicRoles'>>
): Map<string, AssigneeClinicRates> {
  const idx = new Map<string, AssigneeClinicRates>();
  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase();
    const assigneeName = buildAssigneeName(u as any, email || 'Unknown');
    const roles = Array.isArray((u as any).clinicRoles) ? ((u as any).clinicRoles as ClinicRoleAssignment[]) : [];
    for (const cr of roles) {
      if (!isClaimsRole((cr as any).role)) continue;
      const clinicId = String((cr as any).clinicId || '').trim();
      if (!clinicId) continue;
      const openDentalUsername = pickOpenDentalUsernameFromClinicRole(cr);
      if (!openDentalUsername) continue;
      const rates = pickRatesFromClinicRole(cr);
      idx.set(`${clinicId}#${normalizeKey(openDentalUsername)}`, {
        email,
        assigneeName,
        clinicId,
        openDentalUsername,
        ...rates,
      });
    }
  }
  return idx;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      results.push(await fn(item));
    }
  });
  await Promise.all(workers);
  return results;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = getCors(event);
  const method = event.httpMethod || (event.requestContext as any)?.http?.method;
  let path = event.path || (event as any).rawPath || '';

  // Support both custom-domain paths (/claims-salary/...) and raw resource paths (/salary/...)
  path = path.replace(/^\/claims-salary/, '');
  if (!path.startsWith('/')) path = `/${path}`;

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return httpErr(event, 401, 'Unauthorized');
  }

  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const query = event.queryStringParameters || {};

  const requiredPermission = METHOD_PERMISSIONS[method] || 'read';
  // Module-level check (coarse): Admins always pass; non-admins must have Finance read for at least one clinic
  if (!isAdmin) {
    const hasFinanceSomewhere = (userPerms.clinicRoles || []).some((cr: any) => {
      const cid = String(cr?.clinicId || '').trim();
      if (!cid) return false;
      return hasModulePermission(
        userPerms.clinicRoles,
        MODULE_NAME,
        requiredPermission,
        userPerms.isSuperAdmin,
        userPerms.isGlobalSuperAdmin,
        cid
      ) || isClaimsRole(cr?.role);
    });
    if (!hasFinanceSomewhere) {
      return httpErr(event, 403, `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module`);
    }
  }

  // Route: GET /salary/users (admin: list; user: self)
  if (method === 'GET' && path.match(/^\/salary\/users\/?$/)) {
    const userEmailFilter = String(query.userEmail || '').trim().toLowerCase();
    if (!isAdmin && userEmailFilter && userEmailFilter !== userPerms.email.toLowerCase()) {
      return httpErr(event, 403, 'Forbidden: users can only view themselves');
    }

    if (!isAdmin) {
      return httpOk(event, {
        users: [
          {
            email: userPerms.email,
            name: buildAssigneeName(userPerms as any, userPerms.email),
          },
        ],
      });
    }

    if (userEmailFilter) {
      const u = await getStaffUserByEmail(userEmailFilter);
      if (!u) return httpOk(event, { users: [] });
      return httpOk(event, {
        users: [
          {
            email: u.email,
            name: buildAssigneeName(u, u.email),
          },
        ],
      });
    }

    const all = await scanAllStaffUsers('email, givenName, familyName, isActive, clinicRoles');
    const users = (all as any[])
      .filter((u) => u?.isActive !== false)
      .filter((u) => Array.isArray(u?.clinicRoles) && u.clinicRoles.some((cr: any) => isClaimsRole(cr?.role)))
      .map((u) => ({ email: String(u.email || '').toLowerCase(), name: buildAssigneeName(u, String(u.email || '')) }))
      .filter((u) => u.email)
      .sort((a, b) => a.name.localeCompare(b.name));

    return httpOk(event, { users });
  }

  // Route: GET /salary (report)
  if (method === 'GET' && path.match(/^\/salary\/?$/)) {
    const dateStart = parseDateYmd(String(query.dateStart || ''));
    const dateEnd = parseDateYmd(String(query.dateEnd || ''));
    if (!dateStart || !dateEnd) {
      return httpErr(event, 400, 'dateStart and dateEnd are required (YYYY-MM-DD)');
    }

    const clinicIdsRaw = String(query.clinicIds || '').trim();
    const requestedClinicIds = clinicIdsRaw
      ? clinicIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    let clinicIds: string[] = [];
    if (requestedClinicIds.length > 0) {
      clinicIds = Array.from(new Set(requestedClinicIds));
    } else if (allowedClinics.has('*')) {
      clinicIds = await getClinicIds();
    } else {
      clinicIds = Array.from(allowedClinics);
    }

    // Enforce access and module permissions per clinic (non-admin)
    const authorizedClinicIds = clinicIds
      .filter((cid) => {
        if (allowedClinics.has('*')) return true;
        return hasClinicAccess(allowedClinics, cid);
      })
      .filter((cid) => {
        if (isAdmin) return true;
        return canAccessClinicSalary(userPerms, cid);
      });

    if (authorizedClinicIds.length === 0) {
      return httpErr(event, 403, 'Forbidden: no accessible clinics for this report');
    }

    // Safety limit to avoid API Gateway timeouts
    const MAX_CLINICS_PER_REQUEST = 30;
    if (authorizedClinicIds.length > MAX_CLINICS_PER_REQUEST) {
      return httpErr(
        event,
        400,
        `Too many clinics requested (${authorizedClinicIds.length}). Please filter to ${MAX_CLINICS_PER_REQUEST} clinics or fewer.`
      );
    }

    const userEmailParam = String(query.userEmail || '').trim().toLowerCase();
    const effectiveUserEmail = isAdmin ? (userEmailParam || '') : userPerms.email.toLowerCase();

    // Fetch staff users/rates to map OpenDental EnteredBy -> app user + rates
    let staffUsersForRates: Array<Pick<StaffUser, 'email' | 'givenName' | 'familyName' | 'clinicRoles'>> = [];
    if (isAdmin) {
      if (effectiveUserEmail) {
        const u = await getStaffUserByEmail(effectiveUserEmail);
        staffUsersForRates = u ? [u] : [];
      } else {
        const all = await scanAllStaffUsers('email, givenName, familyName, isActive, clinicRoles');
        staffUsersForRates = (all as any[])
          .filter((u) => u?.isActive !== false)
          .filter(
            (u) =>
              Array.isArray(u?.clinicRoles) &&
              u.clinicRoles.some((cr: any) => authorizedClinicIds.includes(String(cr?.clinicId || '')))
          )
          .filter((u) => Array.isArray(u?.clinicRoles) && u.clinicRoles.some((cr: any) => isClaimsRole(cr?.role)))
          .map((u) => ({
            email: String(u.email || '').toLowerCase(),
            givenName: u.givenName,
            familyName: u.familyName,
            clinicRoles: u.clinicRoles,
          }));
      }
    } else {
      // Use authorizer-provided clinicRoles for self (contains the full clinicRoles payload from StaffUser)
      staffUsersForRates = [
        {
          email: userPerms.email.toLowerCase(),
          givenName: (userPerms as any).givenName,
          familyName: (userPerms as any).familyName,
          clinicRoles: (userPerms as any).clinicRoles as any,
        } as any,
      ];
    }

    const ratesIndex = buildRatesIndex(staffUsersForRates);

    const requestId = (event.requestContext as any)?.requestId || randomUUID();
    const sql = buildClaimsSalaryCountsSql(dateStart, dateEnd);

    const clinicConfigs = await mapWithConcurrency(authorizedClinicIds, 5, async (clinicId) => {
      const cfg = await getClinicConfig(clinicId);
      return {
        clinicId,
        practice: cfg?.clinicName || clinicId,
      };
    });
    const clinicNameMap = new Map(clinicConfigs.map((c) => [c.clinicId, c.practice]));

    const errors: Array<{ clinicId: string; message: string }> = [];
    const reportRows: SalaryRow[] = [];

    const QUERY_CONCURRENCY = 10;
    const queryResults = await mapWithConcurrency(authorizedClinicIds, QUERY_CONCURRENCY, async (clinicId) => {
      try {
        const rows = await runOpenDentalSqlQuery(clinicId, sql, `${requestId}-${clinicId}`);
        return { clinicId, rows, error: null as string | null };
      } catch (err: any) {
        return { clinicId, rows: [] as any[], error: String(err?.message || err || 'Unknown error') };
      }
    });

    for (const res of queryResults) {
      const clinicId = res.clinicId;
      if (res.error) {
        errors.push({ clinicId, message: res.error });
        continue;
      }

      const practice = clinicNameMap.get(clinicId) || clinicId;
      const rawRows = Array.isArray(res.rows) ? (res.rows as any[]) : [];
      for (const r of rawRows) {
        const enteredBy = String(r.EnteredBy || r.enteredBy || r.UserName || r.username || '').trim();
        if (!enteredBy) continue;

        const claimsPosted = toNumber(r.ClaimsPosted ?? r.claimsPosted ?? r.Claims ?? r.ClaimsCount);
        const eobsAttached = toNumber(r.EobsAttached ?? r.eobsAttached ?? r.EOBsAttached ?? r.Eobs ?? r.EobCount);
        const deniedClaims = toNumber(r.DeniedClaims ?? r.deniedClaims ?? r.Denied ?? r.DeniedCount);

        const rateKey = `${clinicId}#${normalizeKey(enteredBy)}`;
        const rate = ratesIndex.get(rateKey);

        // Enforce user visibility
        if (!isAdmin) {
          if (!rate || rate.email !== userPerms.email.toLowerCase()) {
            continue;
          }
        } else if (effectiveUserEmail) {
          if (!rate || rate.email !== effectiveUserEmail) {
            continue;
          }
        }

        const perClaimsPostedAmount = rate?.perClaimsPostedAmount ?? 0;
        const perEobsAttachedAmount = rate?.perEobsAttachedAmount ?? 0;
        const statusDeniedAmount = rate?.statusDeniedAmount ?? 0;

        const claimsPostedEarnings = claimsPosted * perClaimsPostedAmount;
        const eobsAttachedEarnings = eobsAttached * perEobsAttachedAmount;
        const deniedEarnings = deniedClaims * statusDeniedAmount;
        const totalEarnings = claimsPostedEarnings + eobsAttachedEarnings + deniedEarnings;

        reportRows.push({
          clinicId,
          practice,
          assigneeEmail: rate?.email || '',
          assignee: rate?.assigneeName || enteredBy,
          openDentalUsername: enteredBy,
          claimsPosted,
          perClaimsPostedAmount,
          claimsPostedEarnings,
          eobsAttached,
          perEobsAttachedAmount,
          eobsAttachedEarnings,
          deniedClaims,
          statusDeniedAmount,
          deniedEarnings,
          totalEarnings,
        });
      }
    }

    const totals = reportRows.reduce(
      (acc, r) => {
        acc.claimsPosted += r.claimsPosted;
        acc.eobsAttached += r.eobsAttached;
        acc.deniedClaims += r.deniedClaims;
        acc.totalEarnings += r.totalEarnings;
        return acc;
      },
      { claimsPosted: 0, eobsAttached: 0, deniedClaims: 0, totalEarnings: 0 }
    );

    // Sort like the sheet: Practice then Assignee
    reportRows.sort((a, b) => a.practice.localeCompare(b.practice) || a.assignee.localeCompare(b.assignee));

    return httpOk(event, {
      dateStart,
      dateEnd,
      clinicIds: authorizedClinicIds,
      rows: reportRows,
      totals,
      errors,
    });
  }

  return httpErr(event, 404, `Not found: ${method} ${path}`);
}


/**
 * Insurance Audit Sync Handler
 * 
 * Runs hourly via EventBridge to:
 * 1. Query OpenDental inseditlog for insurance plan changes
 * 2. Query OpenDental securitylog for document uploads
 * 3. Cross-reference documents in insurance folder
 * 4. Calculate commissions based on 4 service types
 * 5. Validate images uploaded same day
 * 6. Store results in InsuranceCommissions table
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import {
  getClinicConfig,
  getClinicSecrets,
  getAllClinicConfigs,
  getAllClinicSecrets,
  getGlobalSecret,
  ClinicConfig,
  ClinicSecrets,
} from '../../shared/utils/secrets-helper';
import {
  CommissionTransaction,
  ClinicAutomationConfig,
  AuditLogEntry,
  InsEditLogEntry,
  DocumentEntry,
  SecurityLogEntry,
  ServiceType,
  COMMISSION_RATES,
} from './types';

// DynamoDB setup
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

// Environment variables
const COMMISSIONS_TABLE = process.env.COMMISSIONS_TABLE || '';
const CONFIG_TABLE = process.env.CONFIG_TABLE || '';
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || '';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';

// SQL Queries for OpenDental
const INSURANCE_EDIT_LOG_QUERY = `
SET @StartDate = DATE_SUB(NOW(), INTERVAL 26 HOUR);
SET @EndDate = NOW();

WITH planlink AS (
  SELECT
    t.PlanNum,
    t.PatNum,
    CONCAT(p.LName, ', ', p.FName) AS PatientName,
    t.InsSubNum,
    t.InsSubSecUserNumEntry AS InsSubCreatedByUserNum,
    uo.UserName AS InsSubCreatedByUserName
  FROM (
    SELECT
      isub.PlanNum,
      pp.PatNum,
      pp.InsSubNum,
      isub.SecUserNumEntry AS InsSubSecUserNumEntry,
      ROW_NUMBER() OVER (PARTITION BY isub.PlanNum ORDER BY pp.PatNum ASC) AS rn
    FROM inssub isub
    JOIN patplan pp ON pp.InsSubNum = isub.InsSubNum
  ) t
  LEFT JOIN patient p ON p.PatNum = t.PatNum
  LEFT JOIN userod uo ON uo.UserNum = t.InsSubSecUserNumEntry
  WHERE t.rn = 1
)

SELECT 
    iel.InsEditLogNum,
    DATE_FORMAT(iel.DateTStamp, '%Y-%m-%d %H:%i:%s') AS 'DateTStamp',
    iel.UserNum,
    u.UserName,
    iel.LogType,
    iel.FKey,
    iel.ParentKey,
    iel.FieldName,
    iel.OldValue,
    iel.NewValue,
    iel.Description,
    CASE 
        WHEN iel.LogType = 0 THEN iel.FKey
        WHEN iel.LogType = 2 THEN iel.ParentKey
        ELSE NULL
    END AS 'PlanNum',
    CASE 
        WHEN iel.LogType = 0 THEN c1.CarrierName
        WHEN iel.LogType = 1 THEN c2.CarrierName
        WHEN iel.LogType = 2 THEN c3.CarrierName
        ELSE NULL
    END AS 'CarrierName',
    CASE 
        WHEN iel.LogType = 0 THEN ip1.GroupName
        WHEN iel.LogType = 2 THEN ip2.GroupName
        ELSE NULL
    END AS 'GroupName',
    CASE 
        WHEN iel.LogType = 0 THEN ip1.GroupNum
        WHEN iel.LogType = 2 THEN ip2.GroupNum
        ELSE NULL
    END AS 'GroupNum',
    pl.PatNum,
    pl.PatientName,
    pl.InsSubNum,
    pl.InsSubCreatedByUserNum,
    pl.InsSubCreatedByUserName,
    ip.SecUserNumEntry AS 'PlanCreatedByUserNum',
    planCreator.UserName AS 'PlanCreatedByUserName',
    DATE_FORMAT(ip.SecDateEntry, '%Y-%m-%d') AS 'PlanCreatedDate'
FROM inseditlog iel
LEFT JOIN userod u ON u.UserNum = iel.UserNum
LEFT JOIN insplan ip1 ON ip1.PlanNum = iel.FKey AND iel.LogType = 0
LEFT JOIN carrier c1 ON c1.CarrierNum = ip1.CarrierNum
LEFT JOIN carrier c2 ON c2.CarrierNum = iel.FKey AND iel.LogType = 1
LEFT JOIN insplan ip2 ON ip2.PlanNum = iel.ParentKey AND iel.LogType = 2
LEFT JOIN carrier c3 ON c3.CarrierNum = ip2.CarrierNum
LEFT JOIN insplan ip ON ip.PlanNum = (
    CASE 
        WHEN iel.LogType = 0 THEN iel.FKey
        WHEN iel.LogType = 2 THEN iel.ParentKey
        ELSE NULL
    END
)
LEFT JOIN userod planCreator ON planCreator.UserNum = ip.SecUserNumEntry
LEFT JOIN planlink pl ON pl.PlanNum = (
    CASE 
        WHEN iel.LogType = 0 THEN iel.FKey
        WHEN iel.LogType = 2 THEN iel.ParentKey
        ELSE NULL
    END
)
WHERE iel.DateTStamp BETWEEN @StartDate AND @EndDate
ORDER BY iel.DateTStamp DESC;
`;

const INSURANCE_DOCUMENTS_QUERY = `
SET @StartDate = DATE_SUB(NOW(), INTERVAL 26 HOUR);
SET @EndDate = NOW();
SET @InsuranceFolderDefNum = (
    SELECT DefNum 
    FROM definition 
    WHERE Category = 18 
    AND UPPER(ItemName) LIKE '%INSURANCE%'
    LIMIT 1
);

SELECT 
    d.DocNum,
    DATE_FORMAT(d.DateCreated, '%Y-%m-%d %H:%i:%s') AS 'DateCreated',
    DATE_FORMAT(d.DateTStamp, '%Y-%m-%d %H:%i:%s') AS 'DateTStamp',
    d.Description,
    d.FileName,
    d.PatNum,
    CONCAT(p.LName, ', ', p.FName) AS 'PatientName',
    def.ItemName AS 'FolderName',
    d.DocCategory,
    d.ImgType,
    COALESCE(creator.UserName, u.UserName, 'Unknown') AS 'CreatedBy',
    creator.UserNum AS 'CreatedByUserNum',
    DATE_FORMAT(create_log.LogDateTime, '%Y-%m-%d %H:%i:%s') AS 'CreatedLogTime'
FROM document d
LEFT JOIN patient p ON p.PatNum = d.PatNum
LEFT JOIN definition def ON def.DefNum = d.DocCategory
LEFT JOIN userod u ON u.UserNum = d.UserNum
LEFT JOIN (
    SELECT FKey, UserNum, LogDateTime,
           ROW_NUMBER() OVER (PARTITION BY FKey ORDER BY LogDateTime ASC) as rn
    FROM securitylog
    WHERE PermType = 202
) create_log ON create_log.FKey = d.DocNum AND create_log.rn = 1
LEFT JOIN userod creator ON creator.UserNum = create_log.UserNum
WHERE d.DocCategory = @InsuranceFolderDefNum
    AND d.DateCreated BETWEEN @StartDate AND @EndDate
ORDER BY d.DateCreated DESC;
`;

// Clinic credentials type
interface ClinicCreds {
  clinicId: string;
  clinicName: string;
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir: string;
}

// Build clinic credentials from DynamoDB
async function buildClinicCreds(): Promise<ClinicCreds[]> {
  const [configs, secrets, sftpPassword] = await Promise.all([
    getAllClinicConfigs(),
    getAllClinicSecrets(),
    getGlobalSecret('consolidated_sftp', 'password'),
  ]);

  const secretsMap = new Map(secrets.map(s => [s.clinicId, s]));

  return configs.map((config: ClinicConfig) => {
    const secret = secretsMap.get(config.clinicId);
    return {
      clinicId: config.clinicId,
      clinicName: config.clinicName || config.clinicId,
      developerKey: secret?.openDentalDeveloperKey || '',
      customerKey: secret?.openDentalCustomerKey || '',
      sftpHost: CONSOLIDATED_SFTP_HOST,
      sftpPort: 22,
      sftpUsername: 'sftpuser',
      sftpPassword: sftpPassword || '',
      // Root directory (Transfer Family sftpuser maps "/" -> s3://.../sftp-home/sftpuser)
      sftpRemoteDir: '.',
    };
  });
}

// Check if automation is enabled for a clinic
async function isAutomationEnabled(clinicId: string): Promise<boolean> {
  try {
    const result = await doc.send(new GetCommand({
      TableName: CONFIG_TABLE,
      Key: { clinicId },
    }));

    const config = result.Item as ClinicAutomationConfig | undefined;
    return config?.insuranceAuditEnabled ?? false;
  } catch (error) {
    console.error(`[${clinicId}] Error checking automation config:`, error);
    return false;
  }
}

// HTTP request helper
async function httpRequest(
  opts: { hostname: string; path: string; method: string; headers?: Record<string, string> },
  body?: string
): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...opts.headers };
    if (body) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body).toString();
    }

    const req = https.request(
      {
        hostname: opts.hostname,
        path: opts.path,
        method: opts.method,
        headers: requestHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Download CSV from SFTP
async function downloadCsv(opts: {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string;
  filename: string;
}): Promise<string> {
  const { host, port, username, password, remoteDir, filename } = opts;
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

          setTimeout(() => {
            const filePath = `${remoteDir}/${filename}`;
            const readStream = sftp.createReadStream(filePath);
            let csvContent = '';
            
            readStream.on('data', (chunk: any) => { csvContent += chunk.toString(); });
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
          }, 3000);
        });
      })
      .on('error', (e: any) => {
        clearTimeout(timeout);
        reject(e);
      })
      .connect({ host, port, username, password, readyTimeout: 15000 });
  });
}

// Run OpenDental query and get results
async function runQuery(creds: ClinicCreds, query: string, queryName: string): Promise<Record<string, string>[]> {
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const remoteDir = (creds.sftpRemoteDir || '.').replace(/^\/+|\/+$/g, '') || '.';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = uuidv4().slice(0, 8);
  const csvFilename = `${queryName}_${creds.clinicId}_${timestamp}_${uniqueId}.csv`;
  // IMPORTANT: Use root-level SftpAddress (no directories) to match consolidated Transfer Family mapping.
  // This writes to s3://<bucket>/sftp-home/sftpuser/<csvFilename> for the "sftpuser" account.
  const sftpAddress = `${creds.sftpHost}/${csvFilename}`;

  const headers = {
    Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
    'Content-Type': 'application/json',
  };

  const body = JSON.stringify({
    SqlCommand: query,
    SftpAddress: sftpAddress,
    SftpUsername: creds.sftpUsername,
    SftpPassword: creds.sftpPassword,
    SftpPort: creds.sftpPort,
    IsAsync: 'false',
  });

  console.log(`[${creds.clinicId}] Running ${queryName} query, results to: ${csvFilename}`);

  const apiResp = await httpRequest({ hostname: API_HOST, path: `${API_BASE}/queries`, method: 'POST', headers }, body);

  if (apiResp.statusCode !== 201) {
    console.error(`[${creds.clinicId}] OpenDental API failed with status ${apiResp.statusCode}: ${apiResp.body}`);
    return [];
  }

  try {
    const csvData = await downloadCsv({
      host: creds.sftpHost,
      port: creds.sftpPort,
      username: creds.sftpUsername,
      password: creds.sftpPassword,
      remoteDir: '.',
      filename: csvFilename,
    });

    if (csvData.trim() === 'OK' || csvData.trim() === '') {
      return [];
    }

    const records = parseCsv(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    return Array.isArray(records) ? records : [];
  } catch (error: any) {
    console.error(`[${creds.clinicId}] Failed to download/parse CSV: ${error.message}`);
    return [];
  }
}

// Determine service type from edit log entry
type MySqlDateTime = string; // 'YYYY-MM-DD HH:mm:ss'

interface InsuranceEditLogRow {
  InsEditLogNum: string;
  DateTStamp: MySqlDateTime;
  UserNum: string;
  UserName?: string;
  LogType: string; // numeric string from CSV
  FieldName?: string;
  OldValue?: string | null;
  NewValue?: string | null;
  PlanNum?: string;
  CarrierName?: string;
  GroupName?: string;
  GroupNum?: string;
  PatNum?: string;
  PatientName?: string;
  InsSubNum?: string;
  InsSubCreatedByUserNum?: string;
  InsSubCreatedByUserName?: string;
  PlanCreatedByUserNum?: string;
  PlanCreatedByUserName?: string;
}

interface InsuranceDocumentRow {
  DocNum: string;
  DateCreated: MySqlDateTime;
  FileName?: string;
  PatNum: string;
  PatientName?: string;
  CreatedByUserNum?: string;
  CreatedBy?: string;
}

function normalizeEmpty(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (s.toUpperCase() === 'NULL') return '';
  return s;
}

function toIsoFromMySqlDateTime(dt: MySqlDateTime): string {
  // Stored as UTC-ish ISO for consistent sorting/filtering. Input has no timezone.
  const s = normalizeEmpty(dt);
  if (!s) return new Date().toISOString();
  // Convert "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ssZ"
  return s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
}

function dateOnlyFromMySqlDateTime(dt: MySqlDateTime): string {
  return normalizeEmpty(dt).slice(0, 10);
}

function pickBestDocumentForSameDay(
  documents: InsuranceDocumentRow[],
  patNum: number,
  actionTime: MySqlDateTime
): { docNum: number; docFileName: string; uploadedAt: string } | null {
  const actionDate = dateOnlyFromMySqlDateTime(actionTime);
  if (!actionDate || !patNum) return null;

  const matches = documents.filter((d) => {
    const dPatNum = parseInt(normalizeEmpty(d.PatNum) || '0', 10);
    if (dPatNum !== patNum) return false;
    const docDate = dateOnlyFromMySqlDateTime(d.DateCreated);
    return docDate === actionDate;
  });

  if (matches.length === 0) return null;

  // Prefer the document uploaded closest AFTER the action time; otherwise closest overall.
  const actionIso = toIsoFromMySqlDateTime(actionTime);
  const actionMs = new Date(actionIso).getTime();

  const scored = matches
    .map((d) => {
      const docIso = toIsoFromMySqlDateTime(d.DateCreated);
      const docMs = new Date(docIso).getTime();
      const after = docMs >= actionMs;
      const diff = Math.abs(docMs - actionMs);
      return { d, after, diff };
    })
    .sort((a, b) => {
      if (a.after !== b.after) return a.after ? -1 : 1; // after first
      return a.diff - b.diff; // closest
    });

  const best = scored[0]?.d;
  if (!best) return null;

  return {
    docNum: parseInt(normalizeEmpty(best.DocNum) || '0', 10),
    docFileName: normalizeEmpty(best.FileName),
    uploadedAt: toIsoFromMySqlDateTime(best.DateCreated),
  };
}

// Create commission transaction
function createCommissionTransaction(
  clinicId: string,
  userId: string,
  userName: string,
  serviceType: ServiceType,
  isDeduction: boolean,
  event: InsuranceEditLogRow,
  eventTimeIso: string,
  eventId: string,
  docInfo?: { docNum: number; docFileName: string; uploadedAt: string },
  deductionReason?: string,
  originalCreator?: { userId: string; userName: string }
): CommissionTransaction {
  const transactionId = eventId;
  const amount = isDeduction
    ? (serviceType === 'UPDATING_PLAN' ? COMMISSION_RATES.DEDUCTION_UPDATING_PLAN : COMMISSION_RATES.DEDUCTION_INCOMPLETE)
    : COMMISSION_RATES[serviceType];

  return {
    pk: `${clinicId}#${userId}`,
    sk: `${eventTimeIso.slice(0, 10)}#${transactionId}`,
    transactionId,
    clinicId,
    userId,
    userName,
    serviceType,
    transactionType: isDeduction ? 'DEBIT' : 'CREDIT',
    amount,
    patNum: event.PatNum ? parseInt(event.PatNum, 10) : undefined,
    patName: event.PatientName || undefined,
    planNum: event.PlanNum ? parseInt(event.PlanNum, 10) : undefined,
    insuranceName: event.CarrierName || undefined,
    groupName: event.GroupName || undefined,
    groupNumber: event.GroupNum || undefined,
    docNum: docInfo?.docNum,
    docFileName: docInfo?.docFileName,
    docUploadedAt: docInfo?.uploadedAt,
    docValidated: !!docInfo,
    deductionReason: isDeduction ? deductionReason : undefined,
    originalCreatorUserId: originalCreator?.userId,
    originalCreatorUserName: originalCreator?.userName,
    createdAt: eventTimeIso,
    source: 'HOURLY_SYNC',
  };
}

function isEmptyValue(v: any): boolean {
  return normalizeEmpty(v) === '';
}

function isInsPlanLog(row: InsuranceEditLogRow): boolean {
  return parseInt(normalizeEmpty(row.LogType) || '-1', 10) === 0;
}

function isBenefitLog(row: InsuranceEditLogRow): boolean {
  return parseInt(normalizeEmpty(row.LogType) || '-1', 10) === 2;
}

function clusterByTime(rows: InsuranceEditLogRow[], windowMs = 2 * 60 * 1000): InsuranceEditLogRow[][] {
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(toIsoFromMySqlDateTime(a.DateTStamp)).getTime();
    const tb = new Date(toIsoFromMySqlDateTime(b.DateTStamp)).getTime();
    if (ta !== tb) return ta - tb;
    // Tie-break for deterministic clustering/idempotency
    const aId = parseInt(normalizeEmpty(a.InsEditLogNum) || '0', 10);
    const bId = parseInt(normalizeEmpty(b.InsEditLogNum) || '0', 10);
    return aId - bId;
  });

  const clusters: InsuranceEditLogRow[][] = [];
  let current: InsuranceEditLogRow[] = [];
  let lastTs = 0;

  for (const r of sorted) {
    const ts = new Date(toIsoFromMySqlDateTime(r.DateTStamp)).getTime();
    if (current.length === 0) {
      current = [r];
      lastTs = ts;
      continue;
    }
    if (ts - lastTs <= windowMs) {
      current.push(r);
      lastTs = ts;
      continue;
    }
    clusters.push(current);
    current = [r];
    lastTs = ts;
  }
  if (current.length) clusters.push(current);

  return clusters;
}

function determineServiceForCluster(cluster: InsuranceEditLogRow[]): {
  serviceType: ServiceType;
  debitUserId?: string;
  debitUserName?: string;
  debitReason?: string;
} | null {
  const first = cluster[0];
  const planCreatorUserId = normalizeEmpty(first.PlanCreatedByUserNum);
  const planCreatorUserName = normalizeEmpty(first.PlanCreatedByUserName) || 'Unknown';
  const insSubCreatorUserId = normalizeEmpty(first.InsSubCreatedByUserNum);
  const insSubCreatorUserName = normalizeEmpty(first.InsSubCreatedByUserName) || 'Unknown';
  const actorUserId = normalizeEmpty(first.UserNum);

  // 1) Create Insurance Plan (strong signal: CarrierNum inserted with empty OldValue)
  const hasCarrierNumInsert = cluster.some((r) =>
    isInsPlanLog(r) &&
    normalizeEmpty(r.FieldName).toLowerCase() === 'carriernum' &&
    isEmptyValue(r.OldValue) &&
    !isEmptyValue(r.NewValue)
  );
  if (hasCarrierNumInsert) {
    return { serviceType: 'CREATE_INSURANCE_PLAN' };
  }

  // 4) Full Benefits (completion fields set from empty -> value by a DIFFERENT user than plan creator)
  const completionFields = new Set(['groupname', 'groupnum', 'plannote', 'feesched']);
  const hasCompletionFieldInsert = cluster.some((r) =>
    isInsPlanLog(r) &&
    completionFields.has(normalizeEmpty(r.FieldName).toLowerCase()) &&
    isEmptyValue(r.OldValue) &&
    !isEmptyValue(r.NewValue)
  );
  const benefitInserts = cluster.filter((r) => isBenefitLog(r) && isEmptyValue(r.OldValue) && !isEmptyValue(r.NewValue));
  const hasManyBenefitInserts = benefitInserts.length >= 5; // heuristic: "full benefits" tends to add many benefit rows

  if ((hasCompletionFieldInsert || hasManyBenefitInserts) && planCreatorUserId && actorUserId && planCreatorUserId !== actorUserId) {
    return {
      serviceType: 'FULL_BENEFITS',
      debitUserId: planCreatorUserId,
      debitUserName: planCreatorUserName,
      debitReason: 'Incomplete plan completed by another user',
    };
  }

  // 2) Verification (signal: HideFromVerifyList toggled OR some benefit inserts but not "full benefits")
  const hasVerifyToggle = cluster.some((r) =>
    isInsPlanLog(r) &&
    normalizeEmpty(r.FieldName).toLowerCase() === 'hidefromverifylist' &&
    normalizeEmpty(r.OldValue) !== normalizeEmpty(r.NewValue)
  );
  if (hasVerifyToggle) {
    return { serviceType: 'VERIFICATION' };
  }

  // 3) Updating Plan (any insplan field change; deduction to the user who added the plan to the patient first)
  const hasInsPlanChange = cluster.some((r) =>
    isInsPlanLog(r) &&
    normalizeEmpty(r.OldValue) !== normalizeEmpty(r.NewValue) &&
    normalizeEmpty(r.FieldName).toLowerCase() !== 'hidefromverifylist'
  );

  const hasSomeBenefitInserts = benefitInserts.length > 0;

  // If we only see benefit inserts (no InsPlan field changes), treat it as Verification work.
  if (!hasInsPlanChange && hasSomeBenefitInserts) {
    return { serviceType: 'VERIFICATION' };
  }

  if (hasInsPlanChange) {
    // Deduct from the insurance-subscription creator when another user updates the plan
    if (insSubCreatorUserId && actorUserId && insSubCreatorUserId !== actorUserId) {
      return {
        serviceType: 'UPDATING_PLAN',
        debitUserId: insSubCreatorUserId,
        debitUserName: insSubCreatorUserName,
        debitReason: 'Plan updated by another user',
      };
    }
    return { serviceType: 'UPDATING_PLAN' };
  }

  return null;
}

// Process a single clinic
async function processClinic(creds: ClinicCreds): Promise<{ processed: number; credited: number; debited: number }> {
  const stats = { processed: 0, credited: 0, debited: 0 };

  try {
    // Check if automation is enabled
    const enabled = await isAutomationEnabled(creds.clinicId);
    if (!enabled) {
      console.log(`[${creds.clinicId}] Insurance automation is disabled, skipping`);
      return stats;
    }

    // Run queries
    const [editLogs, documents] = await Promise.all([
      runQuery(creds, INSURANCE_EDIT_LOG_QUERY, 'inseditlog'),
      runQuery(creds, INSURANCE_DOCUMENTS_QUERY, 'insdocs'),
    ]);

    console.log(`[${creds.clinicId}] Found ${editLogs.length} edit log entries, ${documents.length} documents`);

    if (editLogs.length === 0) {
      return stats;
    }

    const typedLogs = (editLogs as unknown as InsuranceEditLogRow[]).filter((r) => normalizeEmpty(r.PlanNum) !== '');
    const typedDocs = (documents as unknown as InsuranceDocumentRow[]);

    // Group logs by (PlanNum, UserNum) and then time-cluster to avoid paying per-field.
    const byPlanUser = new Map<string, InsuranceEditLogRow[]>();
    for (const row of typedLogs) {
      const planNum = normalizeEmpty(row.PlanNum);
      const userNum = normalizeEmpty(row.UserNum);
      if (!planNum || !userNum) continue;
      const key = `${planNum}#${userNum}`;
      const list = byPlanUser.get(key) || [];
      list.push(row);
      byPlanUser.set(key, list);
    }

    const transactions: CommissionTransaction[] = [];

    for (const [, rows] of byPlanUser) {
      const clusters = clusterByTime(rows, 2 * 60 * 1000);

      for (const cluster of clusters) {
        stats.processed++;
        const first = cluster[0];
        const service = determineServiceForCluster(cluster);
        if (!service) continue;

        const userId = normalizeEmpty(first.UserNum) || 'unknown';
        const userName = normalizeEmpty(first.UserName) || 'Unknown';
        const planNum = parseInt(normalizeEmpty(first.PlanNum) || '0', 10);
        const patNum = parseInt(normalizeEmpty(first.PatNum) || '0', 10);
        const eventTimeIso = toIsoFromMySqlDateTime(first.DateTStamp);
        const eventIdBase = `evt:${creds.clinicId}:${service.serviceType}:${planNum}:${userId}:${normalizeEmpty(first.InsEditLogNum)}`;

        // Document requirement (same day). If no patient linkage, we cannot pay.
        const docInfo = patNum ? pickBestDocumentForSameDay(typedDocs, patNum, first.DateTStamp) : null;
        if (!docInfo) {
          console.log(`[${creds.clinicId}] Missing same-day Insurance document for PatNum=${patNum} (${service.serviceType}), skipping credit`);
          continue;
        }

        // Credit
        const creditTx = createCommissionTransaction(
          creds.clinicId,
          userId,
          userName,
          service.serviceType,
          false,
          first,
          eventTimeIso,
          eventIdBase + ':CREDIT',
          docInfo
        );
        // Add original creator context on credit for transparency (who will be deducted)
        if (service.debitUserId) {
          creditTx.originalCreatorUserId = service.debitUserId;
          creditTx.originalCreatorUserName = service.debitUserName;
        }
        transactions.push(creditTx);
        stats.credited++;

        // Optional deduction
        if (service.debitUserId && service.debitUserId !== userId) {
          const debitTx = createCommissionTransaction(
            creds.clinicId,
            service.debitUserId,
            service.debitUserName || 'Unknown',
            service.serviceType,
            true,
            first,
            eventTimeIso,
            eventIdBase + `:DEBIT:${service.debitUserId}`,
            undefined,
            service.debitReason || 'Deduction applied',
            { userId, userName }
          );
          transactions.push(debitTx);
          stats.debited++;
        }
      }
    }

    // Batch write transactions
    if (transactions.length > 0) {
      const batchSize = 25;
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize);
        await doc.send(new BatchWriteCommand({
          RequestItems: {
            [COMMISSIONS_TABLE]: batch.map(tx => ({
              PutRequest: { Item: tx },
            })),
          },
        }));
      }
      console.log(`[${creds.clinicId}] Wrote ${transactions.length} commission transactions`);
    }

  } catch (error: any) {
    console.error(`[${creds.clinicId}] Error processing clinic:`, error.message);
  }

  return stats;
}

// Lambda handler
export const handler = async (event: any): Promise<any> => {
  const startTime = new Date();
  console.log('=== Starting Insurance Audit Sync ===');
  console.log(`Execution started at: ${startTime.toISOString()}`);

  const totalStats = { processed: 0, credited: 0, debited: 0, errors: 0 };
  let processedClinics = 0;

  try {
    const clinicCreds = await buildClinicCreds();
    console.log(`Found ${clinicCreds.length} clinics to process`);

    // Process clinics sequentially to avoid SFTP connection limits
    for (const creds of clinicCreds) {
      try {
        const stats = await processClinic(creds);
        totalStats.processed += stats.processed;
        totalStats.credited += stats.credited;
        totalStats.debited += stats.debited;
        processedClinics++;
      } catch (error: any) {
        console.error(`Failed to process clinic ${creds.clinicId}: ${error.message}`);
        totalStats.errors++;
      }
    }

  } catch (error: any) {
    console.error('Fatal error in audit sync:', error.message);
    throw error;
  }

  const endTime = new Date();
  const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;

  console.log('\n=== Insurance Audit Sync Summary ===');
  console.log(`Clinics processed: ${processedClinics}`);
  console.log(`Entries processed: ${totalStats.processed}`);
  console.log(`Credits created: ${totalStats.credited}`);
  console.log(`Debits created: ${totalStats.debited}`);
  console.log(`Errors: ${totalStats.errors}`);
  console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Insurance audit sync completed for ${processedClinics} clinics`,
      statistics: totalStats,
      executionTime: `${executionTime.toFixed(2)} seconds`,
      timestamp: endTime.toISOString(),
    }),
  };
};

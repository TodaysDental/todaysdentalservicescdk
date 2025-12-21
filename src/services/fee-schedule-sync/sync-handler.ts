import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import clinicsData from '../../infrastructure/configs/clinics.json';

// DynamoDB setup
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

// Environment variables
const FEE_SCHEDULES_TABLE = process.env.FEE_SCHEDULES_TABLE || 'FeeSchedules';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';
const CONSOLIDATED_SFTP_PASSWORD = process.env.CONSOLIDATED_SFTP_PASSWORD || '';

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

// Build clinic credentials from imported clinic data
const CLINIC_CREDS: ClinicCreds[] = (clinicsData as any[]).map((c: any) => ({
  clinicId: String(c.clinicId),
  clinicName: String(c.clinicName || c.clinicId),
  developerKey: c.developerKey,
  customerKey: c.customerKey,
  sftpHost: CONSOLIDATED_SFTP_HOST,
  sftpPort: 22,
  sftpUsername: 'sftpuser',
  sftpPassword: CONSOLIDATED_SFTP_PASSWORD,
  sftpRemoteDir: 'QuerytemplateCSV',
}));

// The fee schedule query - joins feesched, procedurecode, and fee tables
const FEE_SCHEDULE_QUERY = `/* OPENDENTAL – FEE SCHEDULES WITH PROCEDURE CODES AND AMOUNTS */

SELECT
  fs1.FeeSchedNum,
  fs1.Description AS FeeSchedule,
  pc.ProcCode,
  pc.AbbrDesc,
  pc.Descript,
  f.Amount
FROM (
  SELECT FeeSchedNum, Description
  FROM feesched
  WHERE IsHidden = 0
  ORDER BY ItemOrder, Description
  LIMIT 200000
) fs1
JOIN procedurecode pc
LEFT JOIN fee f
  ON f.FeeSched   = fs1.FeeSchedNum
  AND f.CodeNum   = pc.CodeNum
  AND f.ClinicNum = 0
  AND f.ProvNum   = 0
ORDER BY pc.ProcCode;`;

// Interface for fee schedule record
interface FeeScheduleRecord {
  pk: string; // clinicId#FeeSchedNum
  sk: string; // ProcCode
  clinicId: string;
  clinicName: string;
  feeSchedNum: string; // FeeSchedNum as string for GSI
  feeSchedule: string; // Description - always a string for GSI compatibility
  procCode: string; // ProcCode - always a string for GSI compatibility
  abbrDesc: string | null;
  description: string | null;
  amount: number | null;
  lastSyncAt: string;
  contentHash: string;
}

// Helper to create a content hash for change detection
function createContentHash(row: Record<string, string>): string {
  const sortedEntries = Object.entries(row).sort(([a], [b]) => a.localeCompare(b));
  const content = sortedEntries.map(([k, v]) => `${k}:${v || ''}`).join('|');
  // Simple hash using base64 encoding of a portion of the content
  return Buffer.from(content).toString('base64').slice(0, 32);
}

// Helper to parse numeric values
function parseNumber(value: string | null | undefined): number | null {
  if (!value || value.trim() === '' || value === 'NULL') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

// Helper to clean string values - also strips surrounding quotes
function cleanString(value: string | null | undefined): string | null {
  if (!value || value.trim() === '' || value === 'NULL') return null;
  let cleaned = value.trim();
  // Remove surrounding quotes if present (CSV parsing artifact)
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  // Also handle escaped quotes
  cleaned = cleaned.replace(/\\"/g, '"').replace(/\\'/g, "'");
  return cleaned.trim() || null;
}

// Convert a CSV row to a FeeScheduleRecord
function rowToRecord(row: Record<string, string>, clinicId: string, clinicName: string): FeeScheduleRecord {
  const feeSchedNum = cleanString(row['FeeSchedNum']);
  const feeSchedule = cleanString(row['FeeSchedule']);
  const procCode = cleanString(row['ProcCode']);
  
  // Create unique keys
  // pk: clinicId#FeeSchedNum - to query all procedures for a specific fee schedule in a clinic
  // sk: ProcCode - the procedure code
  const pk = `${clinicId}#${feeSchedNum || 'UNKNOWN'}`;
  const sk = procCode || 'UNKNOWN';
  
  // IMPORTANT: These fields MUST be strings for GSIs to work
  const feeScheduleForGsi = feeSchedule || 'UNKNOWN_SCHEDULE';
  const procCodeForGsi = procCode || 'UNKNOWN_CODE';
  const feeSchedNumForGsi = feeSchedNum || 'UNKNOWN';
  
  return {
    pk,
    sk,
    clinicId,
    clinicName,
    feeSchedNum: feeSchedNumForGsi,
    feeSchedule: feeScheduleForGsi,
    procCode: procCodeForGsi,
    abbrDesc: cleanString(row['AbbrDesc']),
    description: cleanString(row['Descript']),
    amount: parseNumber(row['Amount']),
    lastSyncAt: new Date().toISOString(),
    contentHash: createContentHash(row),
  };
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
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Retry helper with exponential backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number = 3, baseDelayMs: number = 1000): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Download specific CSV file from SFTP
async function downloadSpecificCsvOnce(opts: {
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
    }, 120000); // 2 minutes timeout for large fee schedule files

    conn
      .on('ready', () => {
        conn.sftp((err: any, sftp: any) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            reject(err);
            return;
          }

          // Wait for file to be available (longer wait for large fee schedule files)
          setTimeout(() => {
            const filePath = `${remoteDir}/${filename}`;
            console.log(`Downloading file: ${filePath}`);

            sftp.stat(filePath, (statErr: any) => {
              if (statErr) {
                console.warn(`File not found: ${filePath}, searching for pattern...`);
                sftp.readdir(remoteDir, (err2: any, list: any[]) => {
                  if (err2) {
                    clearTimeout(timeout);
                    conn.end();
                    reject(err2);
                    return;
                  }

                  const pattern = filename.split('_').slice(0, 2).join('_');
                  const matchingFiles = list.filter(
                    (f: any) => String(f.filename).includes(pattern) && String(f.filename).endsWith('.csv')
                  );

                  if (matchingFiles.length === 0) {
                    clearTimeout(timeout);
                    conn.end();
                    reject(new Error(`No matching CSV files found for pattern: ${pattern}`));
                    return;
                  }

                  const latest = matchingFiles.sort((a: any, b: any) => b.attrs.mtime - a.attrs.mtime)[0];
                  const actualPath = `${remoteDir}/${latest.filename}`;
                  console.log(`Using fallback file: ${latest.filename}`);
                  readCsvFile(sftp, actualPath, timeout, conn, resolve, reject);
                });
                return;
              }

              readCsvFile(sftp, filePath, timeout, conn, resolve, reject);
            });
          }, 3000);
        });
      })
      .on('error', (e: any) => {
        clearTimeout(timeout);
        reject(e);
      })
      .connect({ host, port, username, password, readyTimeout: 60000 }); // 1 minute ready timeout
  });
}

function readCsvFile(
  sftp: any,
  filePath: string,
  timeout: NodeJS.Timeout,
  conn: any,
  resolve: (value: string) => void,
  reject: (reason: any) => void
) {
  const readStream = sftp.createReadStream(filePath);
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
}

async function downloadSpecificCsv(opts: {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string;
  filename: string;
}): Promise<string> {
  return retryWithBackoff(() => downloadSpecificCsvOnce(opts), 5, 5000); // 5 retries, 5s base delay for large files
}

// Run OpenDental query for a clinic
async function runOpenDentalQuery(creds: ClinicCreds): Promise<Record<string, string>[]> {
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const remoteDir = creds.sftpRemoteDir.replace(/^\/+|\/+$/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = uuidv4().slice(0, 8);
  const csvFilename = `feesched_${creds.clinicId}_${timestamp}_${uniqueId}.csv`;
  const sftpAddress = `${creds.sftpHost}/${remoteDir}/${csvFilename}`;

  const headers = {
    Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
    'Content-Type': 'application/json',
  };

  const body = JSON.stringify({
    SqlCommand: FEE_SCHEDULE_QUERY,
    SftpAddress: sftpAddress,
    SftpUsername: creds.sftpUsername,
    SftpPassword: creds.sftpPassword,
    SftpPort: creds.sftpPort,
    IsAsync: 'false',
  });

  console.log(`[${creds.clinicId}] Running fee schedule query, results to: ${csvFilename}`);

  const apiResp = await httpRequest({ hostname: API_HOST, path: `${API_BASE}/queries`, method: 'POST', headers }, body);

  if (apiResp.statusCode !== 201) {
    console.error(`[${creds.clinicId}] OpenDental API failed with status ${apiResp.statusCode}: ${apiResp.body}`);
    return [];
  }

  // Download the CSV file
  const csvData = await downloadSpecificCsv({
    host: creds.sftpHost,
    port: creds.sftpPort,
    username: creds.sftpUsername,
    password: creds.sftpPassword,
    remoteDir: remoteDir,
    filename: csvFilename,
  });

  if (csvData.trim() === 'OK' || csvData.trim() === '') {
    console.log(`[${creds.clinicId}] No fee schedules returned`);
    return [];
  }

  try {
    const records = parseCsv(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      quote: false,
      relax_column_count: true,
    });
    return Array.isArray(records) ? records : [];
  } catch (parseError: any) {
    console.error(`[${creds.clinicId}] Failed to parse CSV: ${parseError.message}`);
    return [];
  }
}

// Batch write to DynamoDB (25 items max per batch)
async function batchWriteRecords(records: FeeScheduleRecord[]): Promise<void> {
  const BATCH_SIZE = 25;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const putRequests = batch.map((record) => ({
      PutRequest: {
        Item: record,
      },
    }));

    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [FEE_SCHEDULES_TABLE]: putRequests,
        },
      })
    );

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= records.length) {
      console.log(`Wrote batch ${Math.floor(i / BATCH_SIZE) + 1} (${Math.min(i + BATCH_SIZE, records.length)} items total)`);
    }
  }
}

// Get existing records for a clinic to detect changes
async function getExistingRecords(clinicId: string): Promise<Map<string, FeeScheduleRecord>> {
  const existingMap = new Map<string, FeeScheduleRecord>();

  let lastKey: Record<string, any> | undefined;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: FEE_SCHEDULES_TABLE,
        FilterExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of result.Items || []) {
      const record = item as FeeScheduleRecord;
      existingMap.set(`${record.pk}#${record.sk}`, record);
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return existingMap;
}

// Delete stale records that no longer exist in the source
async function deleteStaleRecords(clinicId: string, currentKeys: Set<string>, existingRecords: Map<string, FeeScheduleRecord>): Promise<number> {
  let deletedCount = 0;
  const BATCH_SIZE = 25;
  const deleteRequests: { pk: string; sk: string }[] = [];

  for (const [key, record] of existingRecords) {
    if (!currentKeys.has(key)) {
      deleteRequests.push({ pk: record.pk, sk: record.sk });
    }
  }

  // Batch delete for efficiency
  for (let i = 0; i < deleteRequests.length; i += BATCH_SIZE) {
    const batch = deleteRequests.slice(i, i + BATCH_SIZE);
    
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [FEE_SCHEDULES_TABLE]: batch.map((item) => ({
            DeleteRequest: {
              Key: {
                pk: item.pk,
                sk: item.sk,
              },
            },
          })),
        },
      })
    );
    
    deletedCount += batch.length;
  }

  return deletedCount;
}

// Process a single clinic
async function processClinic(creds: ClinicCreds): Promise<{ added: number; updated: number; deleted: number; unchanged: number }> {
  const stats = { added: 0, updated: 0, deleted: 0, unchanged: 0 };

  try {
    // Run the query
    const rows = await runOpenDentalQuery(creds);
    console.log(`[${creds.clinicId}] Retrieved ${rows.length} fee schedule entries`);

    if (rows.length === 0) {
      return stats;
    }

    // Get existing records
    const existingRecords = await getExistingRecords(creds.clinicId);
    console.log(`[${creds.clinicId}] Found ${existingRecords.size} existing records in DynamoDB`);

    // Convert rows to records and track changes
    // Use a Map to deduplicate by key (last one wins if duplicates exist)
    const recordsByKey = new Map<string, FeeScheduleRecord>();
    const currentKeys = new Set<string>();

    for (const row of rows) {
      const record = rowToRecord(row, creds.clinicId, creds.clinicName);
      const key = `${record.pk}#${record.sk}`;
      
      // Deduplicate: if we already have this key, keep the one with a defined amount
      if (recordsByKey.has(key)) {
        const existing = recordsByKey.get(key)!;
        // Prefer record with an amount if the existing has no amount
        if (existing.amount !== null && record.amount === null) {
          continue; // Skip this duplicate, keep the existing one with amount
        }
      }
      
      recordsByKey.set(key, record);
      currentKeys.add(key);
    }

    // Now process deduplicated records
    const newRecords: FeeScheduleRecord[] = [];
    for (const [key, record] of recordsByKey) {
      const existing = existingRecords.get(key);
      if (!existing) {
        // New record
        newRecords.push(record);
        stats.added++;
      } else if (existing.contentHash !== record.contentHash) {
        // Changed record
        newRecords.push(record);
        stats.updated++;
      } else {
        // Unchanged
        stats.unchanged++;
      }
    }

    // Write new/updated records
    if (newRecords.length > 0) {
      await batchWriteRecords(newRecords);
    }

    // Delete stale records
    stats.deleted = await deleteStaleRecords(creds.clinicId, currentKeys, existingRecords);

    console.log(
      `[${creds.clinicId}] Sync complete: ${stats.added} added, ${stats.updated} updated, ${stats.deleted} deleted, ${stats.unchanged} unchanged`
    );
  } catch (error: any) {
    console.error(`[${creds.clinicId}] Error processing clinic: ${error.message}`);
  }

  return stats;
}

// Lambda handler
export const handler = async (event: any): Promise<any> => {
  const startTime = new Date();
  console.log('=== Starting Fee Schedule Sync ===');
  console.log(`Execution started at: ${startTime.toISOString()}`);

  const totalStats = { added: 0, updated: 0, deleted: 0, unchanged: 0, errors: 0 };
  let processedClinics = 0;

  // Process clinics sequentially to avoid SFTP connection limits
  for (const creds of CLINIC_CREDS) {
    try {
      const stats = await processClinic(creds);
      totalStats.added += stats.added;
      totalStats.updated += stats.updated;
      totalStats.deleted += stats.deleted;
      totalStats.unchanged += stats.unchanged;
      processedClinics++;
    } catch (error: any) {
      console.error(`Failed to process clinic ${creds.clinicId}: ${error.message}`);
      totalStats.errors++;
    }
  }

  const endTime = new Date();
  const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;

  console.log('\n=== Fee Schedule Sync Summary ===');
  console.log(`Total clinics: ${CLINIC_CREDS.length}`);
  console.log(`Successfully processed: ${processedClinics}`);
  console.log(`Errors: ${totalStats.errors}`);
  console.log(`Records added: ${totalStats.added}`);
  console.log(`Records updated: ${totalStats.updated}`);
  console.log(`Records deleted: ${totalStats.deleted}`);
  console.log(`Records unchanged: ${totalStats.unchanged}`);
  console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Fee schedule sync completed for ${processedClinics} clinics`,
      statistics: totalStats,
      executionTime: `${executionTime.toFixed(2)} seconds`,
      timestamp: endTime.toISOString(),
    }),
  };
};


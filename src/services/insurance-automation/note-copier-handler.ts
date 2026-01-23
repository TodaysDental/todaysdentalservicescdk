/**
 * Insurance Note Copier Handler
 * 
 * Runs hourly via EventBridge to:
 * 1. Query unique plan notes per patient
 * 2. Find patients with matching: insurance name + group name + group no.
 * 3. Special Humana handling: also match annual max
 * 4. Copy notes only to patients with empty notes
 * 5. Never create new insurance plans, only update benefits
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import {
  getClinicSecrets,
  getAllClinicConfigs,
  getAllClinicSecrets,
  getGlobalSecret,
  ClinicConfig,
} from '../../shared/utils/secrets-helper';
import {
  ClinicAutomationConfig,
  PlanNoteGroup,
  NoteCopyResult,
} from './types';

// DynamoDB setup
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

// Environment variables
const CONFIG_TABLE = process.env.CONFIG_TABLE || '';
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || '';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';

// SQL query to get unique plan notes with patient and plan details
const PLAN_NOTES_QUERY = `
SELECT DISTINCT
    ip.PlanNum,
    ip.PlanNote,
    ip.GroupName,
    ip.GroupNum,
    c.CarrierName,
    b.MonetaryAmt AS AnnualMax,
    MIN(pp.PatNum) AS SamplePatNum
FROM insplan ip
JOIN carrier c ON ip.CarrierNum = c.CarrierNum
LEFT JOIN benefit b ON b.PlanNum = ip.PlanNum 
    AND b.BenefitType = 5 
    AND b.CovCatNum = 0
    AND b.TimePeriod IN (1,2)
    AND b.CoverageLevel = 1
JOIN inssub isub ON isub.PlanNum = ip.PlanNum
JOIN patplan pp ON pp.InsSubNum = isub.InsSubNum
WHERE ip.PlanNote IS NOT NULL 
    AND ip.PlanNote != ''
    AND ip.GroupName IS NOT NULL 
    AND ip.GroupNum IS NOT NULL
GROUP BY ip.PlanNum, ip.PlanNote, ip.GroupName, ip.GroupNum, c.CarrierName, b.MonetaryAmt
HAVING COUNT(DISTINCT pp.PatNum) = 1
ORDER BY c.CarrierName, ip.GroupName;
`;

// SQL query to find patients with matching plans but empty notes
const MATCHING_PATIENTS_QUERY = (carrierName: string, groupName: string, groupNum: string, annualMax: number | null, isHumana: boolean) => {
  // OpenDental query CSV can contain backslash-escaped apostrophes like: O\'REILLY
  // If we naively replace `'` -> `''` we can produce `\''` which breaks SQL in MySQL modes
  // where backslash escapes quotes. So we first normalize \'+ -> ' and then escape quotes.
  const sqlEq = (v: string) =>
    v
      .replace(/\0/g, '')       // safety: never send null bytes
      .replace(/\\+'/g, "'")    // normalize backslash-escaped apostrophes
      .replace(/'/g, "''");     // standard SQL string literal escaping

  let query = `
SELECT DISTINCT
    pp.PatNum,
    ip.PlanNum,
    ip.PlanNote,
    c.CarrierName,
    ip.GroupName,
    ip.GroupNum,
    b.MonetaryAmt AS AnnualMax
FROM patplan pp
JOIN inssub isub ON pp.InsSubNum = isub.InsSubNum
JOIN insplan ip ON isub.PlanNum = ip.PlanNum
JOIN carrier c ON ip.CarrierNum = c.CarrierNum
LEFT JOIN benefit b ON b.PlanNum = ip.PlanNum 
    AND b.BenefitType = 5 
    AND b.CovCatNum = 0
    AND b.TimePeriod IN (1,2)
    AND b.CoverageLevel = 1
WHERE c.CarrierName = '${sqlEq(carrierName)}'
    AND ip.GroupName = '${sqlEq(groupName)}'
    AND ip.GroupNum = '${sqlEq(groupNum)}'
    AND (ip.PlanNote IS NULL OR ip.PlanNote = '')
`;

  // For Humana, also match annual max
  if (isHumana && annualMax !== null) {
    query += `    AND b.MonetaryAmt = ${annualMax}\n`;
  }

  query += `ORDER BY pp.PatNum;`;
  return query;
};

// SQL query to update plan note
const UPDATE_PLAN_NOTE_QUERY = (planNum: number, planNote: string) => `
UPDATE insplan 
SET PlanNote = '${planNote.replace(/'/g, "''")}'
WHERE PlanNum = ${planNum}
    AND (PlanNote IS NULL OR PlanNote = '');
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

// Check if note copying is enabled for a clinic
async function isNoteCopyingEnabled(clinicId: string): Promise<boolean> {
  try {
    const result = await doc.send(new GetCommand({
      TableName: CONFIG_TABLE,
      Key: { clinicId },
    }));

    const config = result.Item as ClinicAutomationConfig | undefined;
    return config?.noteCopyingEnabled ?? false;
  } catch (error) {
    console.error(`[${clinicId}] Error checking note copying config:`, error);
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

// Run OpenDental query and get results via SFTP
async function runQueryViaSftp(creds: ClinicCreds, query: string, queryName: string): Promise<Record<string, string>[]> {
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const remoteDir = (creds.sftpRemoteDir || '.').replace(/^\/+|\/+$/g, '') || '.';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = uuidv4().slice(0, 8);
  const csvFilename = `${queryName}_${creds.clinicId}_${timestamp}_${uniqueId}.csv`;
  // Root-level SftpAddress so Transfer Family mapping works consistently.
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

  const apiResp = await httpRequest({ hostname: API_HOST, path: `${API_BASE}/queries`, method: 'POST', headers }, body);

  if (apiResp.statusCode !== 201) {
    console.error(
      `[${creds.clinicId}] OpenDental /queries failed: ${apiResp.statusCode}. Response: ${String(apiResp.body || '').slice(0, 2000)}`
    );
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

    return parseCsv(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (error: any) {
    console.error(`[${creds.clinicId}] Failed to download/parse CSV: ${error.message}`);
    return [];
  }
}

// Check if carrier is Humana
function isHumanaInsurance(carrierName: string): boolean {
  return carrierName.toLowerCase().includes('humana');
}

// Update plan note via OpenDental API
async function updatePlanNote(creds: ClinicCreds, planNum: number, planNote: string): Promise<boolean> {
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const headers = {
    Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
    'Content-Type': 'application/json',
  };

  // Use InsPlans PUT to update the plan note
  const body = JSON.stringify({
    PlanNote: planNote,
  });

  const response = await httpRequest(
    { hostname: API_HOST, path: `${API_BASE}/insplans/${planNum}`, method: 'PUT', headers },
    body
  );

  return response.statusCode === 200;
}

// Process a single clinic
async function processClinic(creds: ClinicCreds): Promise<NoteCopyResult[]> {
  const results: NoteCopyResult[] = [];

  try {
    // Check if note copying is enabled
    const enabled = await isNoteCopyingEnabled(creds.clinicId);
    if (!enabled) {
      console.log(`[${creds.clinicId}] Note copying is disabled, skipping`);
      return results;
    }

    // Get unique plan notes
    const planNotes = await runQueryViaSftp(creds, PLAN_NOTES_QUERY, 'plannotes');
    console.log(`[${creds.clinicId}] Found ${planNotes.length} unique plan notes to process`);

    if (planNotes.length === 0) {
      return results;
    }

    // Group by carrier+group for processing
    for (const note of planNotes) {
      const carrierName = note.CarrierName || '';
      const groupName = note.GroupName || '';
      const groupNum = note.GroupNum || '';
      const planNote = note.PlanNote || '';
      const annualMax = note.AnnualMax ? parseFloat(note.AnnualMax) : null;
      const sourcePlanNum = parseInt(note.PlanNum, 10);

      if (!carrierName || !groupName || !groupNum || !planNote) {
        continue;
      }

      const isHumana = isHumanaInsurance(carrierName);
      console.log(`[${creds.clinicId}] Processing: ${carrierName} - ${groupName} - ${groupNum}${isHumana ? ` (Humana, max: $${annualMax})` : ''}`);

      // Find matching patients with empty notes
      const matchingQuery = MATCHING_PATIENTS_QUERY(carrierName, groupName, groupNum, annualMax, isHumana);
      const matchingPatients = await runQueryViaSftp(creds, matchingQuery, 'matchingpatients');

      console.log(`[${creds.clinicId}] Found ${matchingPatients.length} patients needing note copy`);

      const result: NoteCopyResult = {
        clinicId: creds.clinicId,
        sourcePlanNum,
        targetPatNums: [],
        copiedCount: 0,
        skippedCount: 0,
        errors: [],
      };

      // Update each matching plan
      for (const patient of matchingPatients) {
        const targetPlanNum = parseInt(patient.PlanNum, 10);
        const patNum = parseInt(patient.PatNum, 10);

        if (targetPlanNum === sourcePlanNum) {
          result.skippedCount++;
          continue;
        }

        try {
          const updated = await updatePlanNote(creds, targetPlanNum, planNote);
          if (updated) {
            result.targetPatNums.push(patNum);
            result.copiedCount++;
            console.log(`[${creds.clinicId}] Copied note to PlanNum ${targetPlanNum} for PatNum ${patNum}`);
          } else {
            result.skippedCount++;
          }
        } catch (error: any) {
          result.errors.push(`Failed to update PlanNum ${targetPlanNum}: ${error.message}`);
        }

        // Rate limiting - small delay between updates
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (result.copiedCount > 0 || result.errors.length > 0) {
        results.push(result);
      }
    }

  } catch (error: any) {
    console.error(`[${creds.clinicId}] Error processing clinic:`, error.message);
  }

  return results;
}

// Log results to audit table
async function logNoteCopyResults(clinicId: string, results: NoteCopyResult[]): Promise<void> {
  if (results.length === 0) return;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  for (const result of results) {
    const actionId = uuidv4();

    await doc.send(new PutCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: {
        pk: `${clinicId}#${dateStr}`,
        sk: `${now.toISOString()}#${actionId}`,
        actionId,
        clinicId,
        actionType: 'NOTE_COPIED',
        userId: 'system',
        userName: 'Insurance Note Copier',
        details: {
          sourcePlanNum: result.sourcePlanNum,
          targetPatNums: result.targetPatNums,
          copiedCount: result.copiedCount,
          skippedCount: result.skippedCount,
          errors: result.errors,
        },
        timestamp: now.toISOString(),
        ttl: Math.floor(now.getTime() / 1000) + (90 * 24 * 60 * 60),
      },
    }));
  }
}

// Lambda handler
export const handler = async (event: any): Promise<any> => {
  const startTime = new Date();
  console.log('=== Starting Insurance Note Copier ===');
  console.log(`Execution started at: ${startTime.toISOString()}`);

  const allResults: NoteCopyResult[] = [];
  let processedClinics = 0;
  let totalCopied = 0;
  let totalErrors = 0;

  try {
    const clinicCreds = await buildClinicCreds();
    console.log(`Found ${clinicCreds.length} clinics to process`);

    // Process clinics sequentially
    for (const creds of clinicCreds) {
      try {
        const results = await processClinic(creds);
        
        for (const result of results) {
          totalCopied += result.copiedCount;
          totalErrors += result.errors.length;
        }

        if (results.length > 0) {
          allResults.push(...results);
          await logNoteCopyResults(creds.clinicId, results);
        }

        processedClinics++;
      } catch (error: any) {
        console.error(`Failed to process clinic ${creds.clinicId}: ${error.message}`);
        totalErrors++;
      }
    }

  } catch (error: any) {
    console.error('Fatal error in note copier:', error.message);
    throw error;
  }

  const endTime = new Date();
  const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;

  console.log('\n=== Insurance Note Copier Summary ===');
  console.log(`Clinics processed: ${processedClinics}`);
  console.log(`Total notes copied: ${totalCopied}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Insurance note copier completed for ${processedClinics} clinics`,
      statistics: {
        clinicsProcessed: processedClinics,
        notesCopied: totalCopied,
        errors: totalErrors,
      },
      executionTime: `${executionTime.toFixed(2)} seconds`,
      timestamp: endTime.toISOString(),
    }),
  };
};

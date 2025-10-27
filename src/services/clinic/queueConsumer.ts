import https from 'https';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import clinicsData from '../../infrastructure/configs/clinics.json';
// Use require to avoid type resolution issues if types aren't present
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

interface ScheduleTask {
  scheduleId: string;
  clinicId: string;
  queryTemplate: string;
  templateMessage: string;
  notificationTypes: string[];
  timeZone: string;
  enqueuedAt: string;
}

type ClinicCreds = {
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir?: string;
};

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const ses = new SESv2Client({});
const sms = new (PinpointSMSVoiceV2Client as any)({});

const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE || process.env.SCHEDULER || 'SCHEDULER';
const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || 'Templates';
const QUERIES_TABLE = process.env.QUERIES_TABLE || 'SQLQueries-V3';

// Build clinic credentials from imported clinic data to avoid large env vars
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';
const CONSOLIDATED_SFTP_PASSWORD = process.env.CONSOLIDATED_SFTP_PASSWORD || '';

const CLINIC_CREDS: Record<string, ClinicCreds> = (() => {
  const acc: Record<string, ClinicCreds> = {};
  (clinicsData as any[]).forEach((c: any) => {
    acc[String(c.clinicId)] = {
      developerKey: c.developerKey,
      customerKey: c.customerKey,
      sftpHost: CONSOLIDATED_SFTP_HOST,
      sftpPort: 22,
      sftpUsername: 'sftpuser',
      sftpPassword: CONSOLIDATED_SFTP_PASSWORD,
      sftpRemoteDir: 'QuerytemplateCSV',
    };
  });
  return acc;
})();

// Build clinic mappings from imported clinic data to avoid large env vars
const CLINIC_SES_IDENTITY_ARN_MAP: Record<string, string> = (() => {
  const acc: Record<string, string> = {};
  (clinicsData as any[]).forEach((c: any) => {
    if (c.sesIdentityArn) acc[String(c.clinicId)] = String(c.sesIdentityArn);
  });
  return acc;
})();

const CLINIC_SMS_ORIGINATION_ARN_MAP: Record<string, string> = (() => {
  const acc: Record<string, string> = {};
  (clinicsData as any[]).forEach((c: any) => {
    if (c.smsOriginationArn) acc[String(c.clinicId)] = String(c.smsOriginationArn);
  });
  return acc;
})();

async function fetchTemplateByName(templateName: string): Promise<any | null> {
  if (!templateName) return null;
  const res = await doc.send(new ScanCommand({ TableName: TEMPLATES_TABLE }));
  const items = (res.Items || []) as any[];
  return items.find((t) => String(t.template_name).toLowerCase() === String(templateName).toLowerCase()) || null;
}

async function fetchQueryByName(queryName: string): Promise<string | null> {
  if (!queryName) return null;
  const res = await doc.send(new GetCommand({ TableName: QUERIES_TABLE, Key: { QueryName: queryName } }));
  const item = res.Item as any;
  return item?.Query ? String(item.Query) : null;
}

async function runOpenDentalQuery({ clinicId, sql }: { clinicId: string; sql: string; }): Promise<any[]> {
  const creds = CLINIC_CREDS[clinicId];
  if (!creds) return [];
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const remoteDir = (creds.sftpRemoteDir || 'QuerytemplateCSV').replace(/^\/+|\/+$/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sftpAddress = `${creds.sftpHost}/${remoteDir}/query_${timestamp}.csv`;

  const headers = {
    Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
    'Content-Type': 'application/json',
  } as Record<string, string>;

  const body = JSON.stringify({
    SqlCommand: sql,
    SftpAddress: sftpAddress,
    SftpUsername: creds.sftpUsername,
    SftpPassword: creds.sftpPassword,
    SftpPort: creds.sftpPort || 22,
    IsAsync: 'false',
  });

  const apiResp = await httpRequest({ hostname: API_HOST, path: `${API_BASE}/queries`, method: 'POST', headers }, body);
  if (apiResp.statusCode !== 201) {
    return [];
  }

  const csvData: string = await downloadLatestCsv({
    host: creds.sftpHost,
    port: creds.sftpPort || 22,
    username: creds.sftpUsername,
    password: creds.sftpPassword,
    remoteDir: remoteDir,
  });

  if (csvData.trim() === 'OK') return [];
  const records = parseCsv(csvData, { columns: true, skip_empty_lines: true, trim: true });
  return Array.isArray(records) ? records : [];
}

async function httpRequest(opts: { hostname: string; path: string; method: string; headers?: Record<string, string>; }, body?: string): Promise<{ statusCode: number; headers: any; body: string; }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: opts.hostname, path: opts.path, method: opts.method, headers: opts.headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function downloadLatestCsv(opts: { host: string; port: number; username: string; password: string; remoteDir: string; }): Promise<string> {
  const { host, port, username, password, remoteDir } = opts;
  const conn = new SSH2Client();
  return new Promise<string>((resolve, reject) => {
    conn.on('ready', () => {
      conn.sftp((err: any, sftp: any) => {
        if (err) { conn.end(); reject(err); return; }
        setTimeout(() => {
          sftp.readdir(remoteDir, (err2: any, list: any[]) => {
            if (err2) { conn.end(); reject(err2); return; }
            const csvFiles = list.filter((f: any) => String(f.filename).endsWith('.csv'));
            if (csvFiles.length === 0) { conn.end(); reject(new Error('No CSV files found')); return; }
            const latest = csvFiles.sort((a: any, b: any) => b.attrs.mtime - a.attrs.mtime)[0];
            const actualPath = `${remoteDir}/${latest.filename}`;
            const readStream = sftp.createReadStream(actualPath);
            let csvContent = '';
            readStream.on('data', (chunk: any) => { csvContent += chunk.toString(); });
            readStream.on('end', () => { conn.end(); resolve(csvContent); });
            readStream.on('error', (e: any) => { conn.end(); reject(e); });
          });
        }, 3000);
      });
    }).on('error', (e: any) => { reject(e); }).connect({ host, port, username, password, readyTimeout: 10000 });
  });
}

function extractEmailAndPhone(row: any): { email?: string; phone?: string } {
  const entries = Object.entries(row || {});
  let email: string | undefined;
  let phone: string | undefined;
  for (const [k, v] of entries) {
    const key = String(k).toLowerCase();
    const val = String(v || '').trim();
    if (!email && /email/.test(key) && /@/.test(val)) email = val;
    if (!phone && /(cell|wireless|mobile|phone)/.test(key)) phone = normalizePhone(val);
  }
  return { email, phone };
}

function normalizePhone(p: string): string | undefined {
  const digits = (p || '').replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+') && digits.length > 8) return digits;
  return undefined;
}

async function sendEmail({ clinicId, to, subject, html, text }: { clinicId: string; to: string; subject: string; html: string; text?: string; }) {
  const identityArn = CLINIC_SES_IDENTITY_ARN_MAP[clinicId];
  if (!identityArn) return;
  const fromDomain = identityArn.split(':identity/')[1] || 'todaysdentalinsights.com';
  const from = `no-reply@${fromDomain}`;
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    FromEmailAddressIdentityArn: identityArn,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Html: { Data: html }, Text: { Data: text || html.replace(/<[^>]+>/g, ' ') } },
      },
    },
  });
  await ses.send(cmd);
}

async function sendSms({ clinicId, to, body }: { clinicId: string; to: string; body: string; }) {
  const originationArn = CLINIC_SMS_ORIGINATION_ARN_MAP[clinicId];
  if (!originationArn) return;
  const cmd = new SendTextMessageCommand({
    DestinationPhoneNumber: to,
    MessageBody: body,
    OriginationIdentity: originationArn,
    MessageType: 'TRANSACTIONAL',
  });
  await sms.send(cmd);
}

async function markRanForClinic(id: string, clinicId: string) {
  if (!id || !clinicId) return;
  const nowIso = new Date().toISOString();
  await doc.send(new UpdateCommand({
    TableName: SCHEDULES_TABLE,
    Key: { id },
    UpdateExpression: 'SET last_run_at = :ts, #map.#cid = :ts',
    ExpressionAttributeNames: {
      '#map': 'last_run_by_clinic',
      '#cid': clinicId,
    },
    ExpressionAttributeValues: { ':ts': nowIso },
  }));
}

async function processScheduleTask(task: ScheduleTask): Promise<void> {
  const { scheduleId, clinicId, queryTemplate, templateMessage, notificationTypes, timeZone } = task;
  
  console.log(`Processing schedule ${scheduleId} for clinic ${clinicId} (${timeZone})`);

  // Fetch the SQL query and template
  const sql = await fetchQueryByName(queryTemplate);
  const template = await fetchTemplateByName(templateMessage);
  
  if (!sql || !template) {
    console.warn(`Missing query or template for schedule ${scheduleId}: sql=${!!sql}, template=${!!template}`);
    return;
  }

  // Run the OpenDental query for this clinic
  const rows = await runOpenDentalQuery({ clinicId, sql });
  
  let emailsSent = 0;
  let smsSent = 0;

  // Process each row and send notifications
  for (const row of rows) {
    const { email, phone } = extractEmailAndPhone(row);
    
    if (notificationTypes.includes('EMAIL') && email && template.email_body) {
      try {
        await sendEmail({ 
          clinicId, 
          to: email, 
          subject: template.email_subject || 'Notification', 
          html: template.email_body,
        });
        emailsSent++;
      } catch (error) {
        console.error(`Failed to send email to ${email}:`, error);
      }
    }
    
    if (notificationTypes.includes('SMS') && phone && template.text_message) {
      try {
        await sendSms({ clinicId, to: phone, body: template.text_message });
        smsSent++;
      } catch (error) {
        console.error(`Failed to send SMS to ${phone}:`, error);
      }
    }
  }

  // Mark the schedule as run for this clinic
  await markRanForClinic(scheduleId, clinicId);
  
  console.log(`Completed schedule ${scheduleId} for clinic ${clinicId}: ${emailsSent} emails, ${smsSent} SMS sent from ${rows.length} rows`);
}

export const handler = async (event: SQSEvent) => {
  const processedRecords: string[] = [];
  const failedRecords: { itemIdentifier: string; }[] = [];

  for (const record of event.Records) {
    try {
      const task: ScheduleTask = JSON.parse(record.body);
      await processScheduleTask(task);
      processedRecords.push(record.messageId);
    } catch (error) {
      console.error(`Failed to process SQS record ${record.messageId}:`, error);
      failedRecords.push({ itemIdentifier: record.messageId });
    }
  }

  console.log(`Queue consumer completed: ${processedRecords.length} processed, ${failedRecords.length} failed`);

  // Return partial batch failure information for SQS to handle retries
  return {
    batchItemFailures: failedRecords,
  };
};

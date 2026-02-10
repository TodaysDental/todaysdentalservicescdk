import https from 'https';
import { randomBytes } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ChimeSDKVoiceClient, CreateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ConnectClient, StartOutboundVoiceContactCommand } from '@aws-sdk/client-connect';
import { v4 as uuidv4 } from 'uuid';
import { SQSEvent } from 'aws-lambda';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
import { buildTemplateContext, renderTemplate } from '../../shared/utils/clinic-placeholders';
import {
  getClinicConfig,
  getClinicSecrets,
  getGlobalSecret,
  ClinicConfig,
  ClinicSecrets
} from '../../shared/utils/secrets-helper';
// Use require to avoid type resolution issues if types aren't present
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

// RCS API base URL (from environment or default)
const RCS_API_BASE_URL = process.env.RCS_API_BASE_URL || 'https://apig.todaysdentalinsights.com/rcs';
// Preferred: invoke RCS send Lambda directly (configured in SchedulesStack)
const RCS_SEND_MESSAGE_FUNCTION_ARN = process.env.RCS_SEND_MESSAGE_FUNCTION_ARN || '';
// RCS templates DynamoDB table (from RcsStack)
const RCS_TEMPLATES_TABLE = process.env.RCS_TEMPLATES_TABLE || '';

interface ScheduleTask {
  scheduleId: string;
  clinicId: string;
  queryTemplate: string;
  templateMessage: string;
  notificationTypes: string[];
  timeZone: string;
  enqueuedAt: string;
}

interface ClinicCreds {
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir?: string;
  sesIdentityArn?: string;
  smsOriginationArn?: string;
  clinicEmail?: string;
}

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const sqsClient = new SQSClient({});
const lambdaClient = new LambdaClient({});
const sms = new (PinpointSMSVoiceV2Client as any)({});

// Chime SDK clients (for outbound marketing calls)
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const SMA_ID_MAP_PARAMETER_NAME = process.env.SMA_ID_MAP_PARAMETER_NAME || '';
const chimeMeetingsClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE || process.env.SCHEDULER || 'SCHEDULER';
const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || 'Templates';
const QUERIES_TABLE = process.env.QUERIES_TABLE || 'SQLQueries-V3';
const EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE || '';
const EMAIL_QUEUE_URL = process.env.EMAIL_QUEUE_URL || '';
const VOICE_CALL_ANALYTICS_TABLE = process.env.VOICE_CALL_ANALYTICS_TABLE || '';

// Amazon Connect (for AI outbound calls via Connect + Bedrock)
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || '';
const OUTBOUND_CONTACT_FLOW_ID = process.env.OUTBOUND_CONTACT_FLOW_ID || '';
const connectClient = CONNECT_INSTANCE_ID ? new ConnectClient({}) : null;

// Consent Forms scheduling (requires access to ConsentFormData stack tables)
const CONSENT_FORM_TEMPLATES_TABLE_NAME = process.env.CONSENT_FORM_TEMPLATES_TABLE_NAME || '';
const CONSENT_FORM_INSTANCES_TABLE_NAME = process.env.CONSENT_FORM_INSTANCES_TABLE_NAME || '';
const CONSENT_FORM_DEFAULT_TOKEN_TTL_DAYS = (() => {
  const n = Number(process.env.CONSENT_FORM_DEFAULT_TOKEN_TTL_DAYS || '7');
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.min(Math.max(Math.floor(n), 1), 365);
})();

// Batch size for SQS SendMessageBatch (max 10)
const SQS_BATCH_SIZE = 10;

// SFTP connection info from environment (host is dynamic, password from GlobalSecrets)
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';

// Cache for clinic credentials (populated on demand from DynamoDB)
const clinicCredsCache: Record<string, ClinicCreds> = {};

// SMA ID Map cache (loaded from SSM once per warm Lambda)
let cachedSmaIdMap: Record<string, string> | null = null;

async function getSmaIdMap(): Promise<Record<string, string>> {
  if (cachedSmaIdMap) return cachedSmaIdMap;

  if (!SMA_ID_MAP_PARAMETER_NAME) {
    console.warn('[QueueConsumer/CALL] No SMA_ID_MAP_PARAMETER_NAME configured; CALL notifications will be skipped');
    cachedSmaIdMap = {};
    return cachedSmaIdMap;
  }

  try {
    const response = await ssmClient.send(new GetParameterCommand({ Name: SMA_ID_MAP_PARAMETER_NAME }));
    if (response.Parameter?.Value) {
      cachedSmaIdMap = JSON.parse(response.Parameter.Value);
      console.log('[QueueConsumer/CALL] Loaded SMA ID Map from SSM:', Object.keys(cachedSmaIdMap || {}).length, 'entries');
      return cachedSmaIdMap || {};
    }
  } catch (error) {
    console.error('[QueueConsumer/CALL] Failed to load SMA ID Map from SSM:', error);
  }

  cachedSmaIdMap = {};
  return cachedSmaIdMap;
}

async function getSmaIdForClinic(clinicId: string): Promise<string | undefined> {
  const map = await getSmaIdMap();
  if (map[clinicId]) return map[clinicId];
  return map['default'] || Object.values(map)[0];
}

/**
 * Get clinic credentials from DynamoDB (cached)
 */
async function getClinicCreds(clinicId: string): Promise<ClinicCreds | null> {
  if (clinicCredsCache[clinicId]) {
    return clinicCredsCache[clinicId];
  }

  const [config, secrets, sftpPassword] = await Promise.all([
    getClinicConfig(clinicId),
    getClinicSecrets(clinicId),
    getGlobalSecret('consolidated_sftp', 'password'),
  ]);

  if (!config || !secrets) {
    console.error(`[QueueConsumer] No credentials found for clinic: ${clinicId}`);
    return null;
  }

  const creds: ClinicCreds = {
    developerKey: secrets.openDentalDeveloperKey,
    customerKey: secrets.openDentalCustomerKey,
    sftpHost: CONSOLIDATED_SFTP_HOST,
    sftpPort: 22,
    sftpUsername: 'sftpuser',
    sftpPassword: sftpPassword || '',
    sftpRemoteDir: 'QuerytemplateCSV',
    sesIdentityArn: config.sesIdentityArn,
    smsOriginationArn: config.smsOriginationArn,
    clinicEmail: config.clinicEmail,
  };

  clinicCredsCache[clinicId] = creds;
  return creds;
}

async function fetchTemplateByName(templateName: string): Promise<any | null> {
  if (!templateName) return null;
  const res = await doc.send(new ScanCommand({ TableName: TEMPLATES_TABLE }));
  const items = (res.Items || []) as any[];
  return items.find((t) => String(t.template_name).toLowerCase() === String(templateName).toLowerCase()) || null;
}

function parseConsentFormIdFromTemplateMessage(templateMessage: string): string | null {
  const raw = String(templateMessage || '').trim();
  const m =
    /^consentform\s*:\s*(.+)$/i.exec(raw) ||
    /^consent-form\s*:\s*(.+)$/i.exec(raw) ||
    /^consent_forms\s*:\s*(.+)$/i.exec(raw);
  const id = String(m?.[1] || '').trim();
  return id || null;
}

async function fetchConsentFormTemplateById(consentFormId: string): Promise<any | null> {
  if (!CONSENT_FORM_TEMPLATES_TABLE_NAME) return null;
  if (!consentFormId) return null;
  const res = await doc.send(new GetCommand({
    TableName: CONSENT_FORM_TEMPLATES_TABLE_NAME,
    Key: { consent_form_id: consentFormId },
  }));
  return (res.Item as any) || null;
}

function generateConsentFormToken(): string {
  // URL-safe token for patient-facing links
  return randomBytes(32).toString('base64url');
}

function buildConsentFormSigningUrl(websiteLink: string | undefined, token: string): string {
  const base = String(websiteLink || '').trim().replace(/\/+$/g, '');
  if (!base) return `https://dentistinconcord.com/consent-form/${token}`;
  return `${base}/consent-form/${token}`;
}

async function createConsentFormInstanceForSchedule(args: {
  clinicId: string;
  patNum: number;
  consentFormId: string;
  template: any;
  scheduleId?: string;
}): Promise<{ instanceId: string; token: string; signingUrl: string; expiresAtSeconds: number }> {
  if (!CONSENT_FORM_INSTANCES_TABLE_NAME) {
    throw new Error('Missing CONSENT_FORM_INSTANCES_TABLE_NAME');
  }

  const instanceId = uuidv4();
  const token = generateConsentFormToken();
  const nowIso = new Date().toISOString();
  const expiresAtSeconds =
    Math.floor(Date.now() / 1000) + CONSENT_FORM_DEFAULT_TOKEN_TTL_DAYS * 24 * 60 * 60;

  const clinicConfig = await getClinicConfig(args.clinicId);
  const signingUrl = buildConsentFormSigningUrl(clinicConfig?.websiteLink, token);

  const item: any = {
    instance_id: instanceId,
    token,
    clinicId: args.clinicId,
    patNum: args.patNum,
    consent_form_id: args.consentFormId,
    templateName: String(args.template?.templateName || args.template?.template_name || ''),
    language: String(args.template?.language || 'en'),
    elements: Array.isArray(args.template?.elements) ? args.template.elements : [],
    status: 'sent',
    created_at: nowIso,
    sent_at: nowIso,
    expires_at: expiresAtSeconds,
    created_by: 'schedule',
    signing_url: signingUrl,
  };
  if (args.scheduleId) item.scheduleId = args.scheduleId;

  await doc.send(new PutCommand({
    TableName: CONSENT_FORM_INSTANCES_TABLE_NAME,
    Item: item,
  }));

  return { instanceId, token, signingUrl, expiresAtSeconds };
}

async function fetchRcsTemplateById(clinicId: string, templateId: string): Promise<any | null> {
  if (!RCS_TEMPLATES_TABLE) return null;
  if (!clinicId || !templateId) return null;
  const res = await doc.send(new GetCommand({
    TableName: RCS_TEMPLATES_TABLE,
    Key: {
      pk: `CLINIC#${clinicId}`,
      sk: `TEMPLATE#${templateId}`,
    },
  }));
  return (res.Item as any) || null;
}

async function fetchQueryByName(queryName: string): Promise<string | null> {
  if (!queryName) return null;
  const res = await doc.send(new GetCommand({ TableName: QUERIES_TABLE, Key: { QueryName: queryName } }));
  const item = res.Item as any;
  return item?.Query ? String(item.Query) : null;
}

async function runOpenDentalQuery({ clinicId, sql }: { clinicId: string; sql: string; }): Promise<any[]> {
  const creds = await getClinicCreds(clinicId);
  if (!creds) return [];
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const remoteDir = (creds.sftpRemoteDir || 'QuerytemplateCSV').replace(/^\/+|\/+$/g, '');
  // Include clinicId in filename to prevent race conditions between concurrent Lambda executions
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = uuidv4().slice(0, 8); // Add random suffix for extra uniqueness
  const csvFilename = `query_${clinicId}_${timestamp}_${uniqueId}.csv`;
  const sftpAddress = `${creds.sftpHost}/${remoteDir}/${csvFilename}`;

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

  console.log(`Uploading query results to: ${csvFilename}`);
  const apiResp = await httpRequest({ hostname: API_HOST, path: `${API_BASE}/queries`, method: 'POST', headers }, body);
  if (apiResp.statusCode !== 201) {
    console.error(`OpenDental API failed with status ${apiResp.statusCode}: ${apiResp.body}`);
    return [];
  }

  // Download the SPECIFIC file we just uploaded (not just "latest") to avoid race conditions
  const csvData: string = await downloadSpecificCsv({
    host: creds.sftpHost,
    port: creds.sftpPort || 22,
    username: creds.sftpUsername,
    password: creds.sftpPassword,
    remoteDir: remoteDir,
    filename: csvFilename,
  });

  if (csvData.trim() === 'OK') return [];
  const records = parseCsv(csvData, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    quote: false,  // Disable quote parsing - OpenDental CSV has malformed quotes in patient names
    relax_column_count: true,  // Handle rows with missing/extra columns
  });
  return Array.isArray(records) ? records : [];
}

async function httpRequest(opts: { hostname: string; path: string; method: string; headers?: Record<string, string>; }, body?: string): Promise<{ statusCode: number; headers: any; body: string; }> {
  return new Promise((resolve, reject) => {
    // Add Content-Length header for POST requests with body (required by OpenDental API)
    const requestHeaders = { ...opts.headers };
    if (body) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body).toString();
    }

    const req = https.request({
      hostname: opts.hostname,
      path: opts.path,
      method: opts.method,
      headers: requestHeaders
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`SFTP attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Download a SPECIFIC file by name (prevents race conditions with concurrent Lambda executions)
async function downloadSpecificCsvOnce(opts: { host: string; port: number; username: string; password: string; remoteDir: string; filename: string; }): Promise<string> {
  const { host, port, username, password, remoteDir, filename } = opts;
  const conn = new SSH2Client();
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('SFTP connection timeout'));
    }, 30000);

    conn.on('ready', () => {
      conn.sftp((err: any, sftp: any) => {
        if (err) { clearTimeout(timeout); conn.end(); reject(err); return; }
        // Wait for file to be available (OpenDental may still be writing)
        setTimeout(() => {
          const filePath = `${remoteDir}/${filename}`;
          console.log(`Downloading specific file: ${filePath}`);

          // First check if the file exists
          sftp.stat(filePath, (statErr: any) => {
            if (statErr) {
              // File doesn't exist yet, fall back to finding by pattern
              console.warn(`Specific file not found, searching for pattern: ${filename.split('_').slice(0, 2).join('_')}`);
              sftp.readdir(remoteDir, (err2: any, list: any[]) => {
                if (err2) { clearTimeout(timeout); conn.end(); reject(err2); return; }
                // Look for files matching our clinic pattern
                const pattern = filename.split('_').slice(0, 2).join('_'); // e.g., "query_clinicId"
                const matchingFiles = list.filter((f: any) => String(f.filename).includes(pattern) && String(f.filename).endsWith('.csv'));
                if (matchingFiles.length === 0) {
                  clearTimeout(timeout); conn.end();
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

            // File exists, download it
            readCsvFile(sftp, filePath, timeout, conn, resolve, reject);
          });
        }, 3000); // Wait 3 seconds for file to be written
      });
    }).on('error', (e: any) => { clearTimeout(timeout); reject(e); }).connect({ host, port, username, password, readyTimeout: 15000 });
  });
}

function readCsvFile(sftp: any, filePath: string, timeout: NodeJS.Timeout, conn: any, resolve: (value: string) => void, reject: (reason: any) => void) {
  const readStream = sftp.createReadStream(filePath);
  let csvContent = '';
  readStream.on('data', (chunk: any) => { csvContent += chunk.toString(); });
  readStream.on('end', () => { clearTimeout(timeout); conn.end(); resolve(csvContent); });
  readStream.on('error', (e: any) => { clearTimeout(timeout); conn.end(); reject(e); });
}

async function downloadSpecificCsv(opts: { host: string; port: number; username: string; password: string; remoteDir: string; filename: string; }): Promise<string> {
  return retryWithBackoff(() => downloadSpecificCsvOnce(opts), 3, 2000);
}

function extractEmailAndPhone(row: any): { email?: string; phone?: string } {
  const entries = Object.entries(row || {});
  let email: string | undefined;
  let phone: string | undefined;
  for (const [k, v] of entries) {
    const key = String(k).toLowerCase();
    let val = String(v || '').trim();
    // Strip surrounding quotes (CSV parsing with quote:false keeps them)
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).trim();
    }
    if (!email && /email/.test(key) && /@/.test(val)) email = val;
    if (!phone && /(cell|wireless|mobile|phone)/.test(key)) phone = normalizePhone(val);
  }
  return { email, phone };
}

function extractPatNum(row: any): number | undefined {
  const tryParse = (value: any): number | undefined => {
    let s = String(value ?? '').trim();
    if (!s) return undefined;
    // Strip surrounding quotes (CSV parsing with quote:false keeps them)
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n);
  };

  // Common field names
  const directCandidates = [
    (row as any)?.PatNum,
    (row as any)?.patNum,
    (row as any)?.PATNUM,
    (row as any)?.PatientId,
    (row as any)?.patientId,
    (row as any)?.patient_id,
    (row as any)?.pat_num,
    (row as any)?.ChartNumber,
    (row as any)?.chartNumber,
    (row as any)?.ChartNum,
    (row as any)?.chartnum,
  ];
  for (const c of directCandidates) {
    const n = tryParse(c);
    if (n) return n;
  }

  // Fallback: scan keys
  for (const [k, v] of Object.entries(row || {})) {
    const key = String(k).toLowerCase();
    if (
      key === 'patnum' ||
      key.includes('patnum') ||
      key === 'patientid' ||
      key.includes('patientid') ||
      key.includes('chartnumber') ||
      key.includes('chartnum')
    ) {
      const n = tryParse(v);
      if (n) return n;
    }
  }

  return undefined;
}

function normalizePhone(p: string): string | undefined {
  const digits = (p || '').replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // NOTE: `digits` never includes '+'. Keep this for backward compatibility, but it won't be hit.
  if ((p || '').startsWith('+') && digits.length > 8) return `+${digits}`;
  return undefined;
}

// Email sending is now handled by the emailSender Lambda via the email queue
// This consumer only enqueues emails, doesn't send them directly

async function sendSms({ clinicId, to, body }: { clinicId: string; to: string; body: string; }) {
  const creds = await getClinicCreds(clinicId);
  if (!creds?.smsOriginationArn) return;
  const cmd = new SendTextMessageCommand({
    DestinationPhoneNumber: to,
    MessageBody: body,
    OriginationIdentity: creds.smsOriginationArn,
    MessageType: 'TRANSACTIONAL',
  });
  await sms.send(cmd);
}

type SendMarketingCallArgs = {
  clinicId: string;
  fromPhoneNumber: string;
  toPhoneNumber: string;
  message: string;
  voiceId?: string;
  engine?: 'standard' | 'neural';
  languageCode?: string;
  scheduleId?: string;
  templateName?: string;
  patNum?: string;
  patientName?: string;
};

async function sendMarketingCall(args: SendMarketingCallArgs): Promise<void> {
  const smaId = await getSmaIdForClinic(args.clinicId);
  if (!smaId) {
    throw new Error(`[QueueConsumer/CALL] No SMA ID found for clinic "${args.clinicId}" (and no default SMA configured)`);
  }

  // Create an ephemeral meeting for this call (required by marketing outbound call flow)
  const externalMeetingIdBase = `mkt-${args.clinicId}-${Date.now()}`;
  const externalMeetingId = externalMeetingIdBase.slice(0, 64);

  const meetingRes = await chimeMeetingsClient.send(new CreateMeetingCommand({
    ClientRequestToken: uuidv4(),
    MediaRegion: CHIME_MEDIA_REGION,
    ExternalMeetingId: externalMeetingId,
  }));

  const meetingId = meetingRes.Meeting?.MeetingId;
  if (!meetingId) {
    throw new Error('[QueueConsumer/CALL] Failed to create Chime meeting (missing MeetingId)');
  }

  try {
    const callRes = await chimeVoiceClient.send(new CreateSipMediaApplicationCallCommand({
      FromPhoneNumber: args.fromPhoneNumber,
      ToPhoneNumber: args.toPhoneNumber,
      SipMediaApplicationId: smaId,
      ArgumentsMap: {
        callType: 'MarketingOutbound',
        clinicId: String(args.clinicId),
        fromClinicId: String(args.clinicId),
        scheduleId: String(args.scheduleId || ''),
        templateName: String(args.templateName || ''),
        meetingId: String(meetingId),
        patNum: String(args.patNum || ''),
        patientName: String(args.patientName || ''),
        voice_message: String(args.message || ''),
        voice_voiceId: String(args.voiceId || ''),
        voice_engine: String(args.engine || 'neural'),
        voice_languageCode: String(args.languageCode || 'en-US'),
        toPhoneNumber: String(args.toPhoneNumber),
        fromPhoneNumber: String(args.fromPhoneNumber),
      },
    }));

    const transactionId = callRes?.SipMediaApplicationCall?.TransactionId;
    console.log('[QueueConsumer/CALL] Started marketing outbound call', {
      clinicId: args.clinicId,
      to: args.toPhoneNumber,
      from: args.fromPhoneNumber,
      meetingId,
      transactionId,
    });

    // Best-effort: store voice call analytics record for Sent/Analytics tabs
    if (VOICE_CALL_ANALYTICS_TABLE && transactionId) {
      try {
        const now = new Date();
        const ttl = Math.floor(now.getTime() / 1000) + (365 * 24 * 60 * 60);
        await doc.send(new PutCommand({
          TableName: VOICE_CALL_ANALYTICS_TABLE,
          Item: {
            callId: transactionId,
            clinicId: args.clinicId,
            scheduleId: args.scheduleId || '',
            templateName: args.templateName || '',
            patNum: args.patNum || '',
            patientName: args.patientName || '',
            recipientPhone: args.toPhoneNumber,
            fromPhoneNumber: args.fromPhoneNumber,
            meetingId,
            status: 'INITIATED',
            startedAt: now.toISOString(),
            voiceId: args.voiceId || '',
            voiceEngine: args.engine || 'neural',
            voiceLanguageCode: args.languageCode || 'en-US',
            source: 'schedule',
            ttl,
          }
        }));
      } catch (analyticsErr) {
        console.warn('[QueueConsumer/CALL] Failed to store voice call analytics (non-fatal):', analyticsErr);
      }
    }
  } catch (err) {
    // If call initiation fails, cleanup meeting here since inbound-router won't receive events
    try {
      await chimeMeetingsClient.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
    } catch (cleanupErr) {
      console.warn('[QueueConsumer/CALL] Failed to cleanup meeting after call initiation failure:', cleanupErr);
    }
    throw err;
  }
}

/**
 * Send RCS message.
 *
 * Preferred: invoke the RCS Send Message Lambda directly (no API Gateway / custom authorizer required).
 * Fallback: call the public RCS API endpoint if the Lambda ARN isn't configured.
 */
type SendRcsArgs = {
  clinicId: string;
  to: string;
  body?: string;
  richCard?: any;
  carousel?: any;
  templateId?: string;
  templateName?: string;
  patientData?: Record<string, string>;
  scheduleId?: string;
};

async function sendRcs(args: SendRcsArgs): Promise<{ success: boolean; messageSid?: string; error?: string }> {
  if (RCS_SEND_MESSAGE_FUNCTION_ARN) {
    try {
      return await sendRcsViaLambda(args);
    } catch (err: any) {
      console.error('sendRcsViaLambda failed, falling back to HTTP:', err);
      // fall through
    }
  }
  return await sendRcsViaHttp(args);
}

async function sendRcsViaLambda({
  clinicId,
  to,
  body,
  richCard,
  carousel,
  templateId,
  templateName,
  patientData,
  scheduleId,
}: SendRcsArgs): Promise<{ success: boolean; messageSid?: string; error?: string }> {
  const requestBody: Record<string, any> = {
    clinicId,
    to,
    ...(body !== undefined ? { body } : {}),
    ...(richCard ? { richCard } : {}),
    ...(carousel ? { carousel } : {}),
    ...(templateId ? { templateId } : {}),
    ...(templateName ? { templateName } : {}),
    ...(patientData ? { patientData } : {}),
    ...(scheduleId ? { campaignId: scheduleId, campaignName: `Schedule: ${scheduleId}` } : {}),
  };

  const invokeEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(requestBody),
  };

  const resp = await lambdaClient.send(new InvokeCommand({
    FunctionName: RCS_SEND_MESSAGE_FUNCTION_ARN,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(invokeEvent)),
  }));

  if (resp.FunctionError) {
    const rawErr = resp.Payload ? Buffer.from(resp.Payload as Uint8Array).toString('utf-8') : '';
    return { success: false, error: rawErr || resp.FunctionError };
  }

  const raw = resp.Payload ? Buffer.from(resp.Payload as Uint8Array).toString('utf-8') : '';
  let apiResult: any = {};
  try { apiResult = raw ? JSON.parse(raw) : {}; } catch { apiResult = { raw }; }

  const statusCode = Number(apiResult?.statusCode || 0);
  const bodyStr = apiResult?.body;
  let bodyObj: any = {};
  try { bodyObj = bodyStr ? JSON.parse(bodyStr) : {}; } catch { bodyObj = { raw: bodyStr }; }

  if (statusCode >= 200 && statusCode < 300 && bodyObj?.success) {
    return { success: true, messageSid: bodyObj.messageSid };
  }

  return {
    success: false,
    error: bodyObj?.error || bodyObj?.message || bodyObj?.reason || (typeof bodyStr === 'string' ? bodyStr : raw) || 'RCS send failed',
  };
}

async function sendRcsViaHttp({
  clinicId,
  to,
  body,
  richCard,
  carousel,
  templateId,
  templateName,
  patientData,
  scheduleId,
}: SendRcsArgs): Promise<{ success: boolean; messageSid?: string; error?: string }> {
  return new Promise((resolve) => {
    const requestBody: Record<string, any> = {
      clinicId,
      to,
      ...(body !== undefined ? { body } : {}),
      ...(richCard ? { richCard } : {}),
      ...(carousel ? { carousel } : {}),
      ...(templateId ? { templateId } : {}),
      ...(templateName ? { templateName } : {}),
      ...(patientData ? { patientData } : {}),
      ...(scheduleId ? { campaignId: scheduleId, campaignName: `Schedule: ${scheduleId}` } : {}),
    };

    const payload = JSON.stringify(requestBody);

    // Default to prod domain; allow override via RCS_API_BASE_URL for non-prod environments.
    let hostname = 'apig.todaysdentalinsights.com';
    let port = 443;
    let path = `/rcs/${encodeURIComponent(clinicId)}/send`;
    try {
      const base = new URL(RCS_API_BASE_URL);
      hostname = base.hostname || hostname;
      port = base.port ? Number(base.port) : port;
      const basePath = (base.pathname || '/rcs').replace(/\/+$/g, '');
      path = `${basePath}/${encodeURIComponent(clinicId)}/send`;
    } catch {
      // ignore URL parse errors, keep defaults
    }

    const options = {
      hostname,
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(responseBody);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300 && response.success) {
            resolve({ success: true, messageSid: response.messageSid });
          } else {
            console.error(`RCS API error for ${to}: ${responseBody}`);
            resolve({ success: false, error: response.error || responseBody });
          }
        } catch (e) {
          console.error(`Failed to parse RCS response for ${to}: ${responseBody}`);
          resolve({ success: false, error: responseBody });
        }
      });
    });

    req.on('error', (e) => {
      console.error(`RCS request error for ${to}:`, e);
      resolve({ success: false, error: e.message });
    });

    req.write(payload);
    req.end();
  });
}

// Track email in analytics table with status
async function trackEmailStatus(params: {
  clinicId: string;
  recipientEmail: string;
  scheduleId: string;
  templateName: string;
  status: 'SCHEDULED' | 'SENT' | 'FAILED';
  messageId?: string;
  errorMessage?: string;
}): Promise<string> {
  if (!EMAIL_ANALYTICS_TABLE) return '';

  const trackingId = params.messageId || uuidv4();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1 year TTL

  try {
    await doc.send(new PutCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Item: {
        messageId: trackingId,
        clinicId: params.clinicId,
        recipientEmail: params.recipientEmail,
        scheduleId: params.scheduleId,
        templateName: params.templateName,
        status: params.status,
        sentAt: now,
        scheduledAt: now,
        ...(params.errorMessage && { errorMessage: params.errorMessage }),
        source: 'scheduled-queue',
        ttl,
      },
    }));
  } catch (err) {
    console.warn(`Failed to track email status for ${params.recipientEmail}:`, err);
  }
  return trackingId;
}

async function markRanForClinic(id: string, clinicId: string) {
  if (!id || !clinicId) return;
  const nowIso = new Date().toISOString();

  // First, ensure the map exists (creates empty map if it doesn't exist)
  await doc.send(new UpdateCommand({
    TableName: SCHEDULES_TABLE,
    Key: { id },
    UpdateExpression: 'SET last_run_at = :ts, #map = if_not_exists(#map, :emptyMap)',
    ExpressionAttributeNames: {
      '#map': 'last_run_by_clinic',
    },
    ExpressionAttributeValues: { ':ts': nowIso, ':emptyMap': {} },
  }));

  // Then, set the nested clinic value
  await doc.send(new UpdateCommand({
    TableName: SCHEDULES_TABLE,
    Key: { id },
    UpdateExpression: 'SET #map.#cid = :ts',
    ExpressionAttributeNames: {
      '#map': 'last_run_by_clinic',
      '#cid': clinicId,
    },
    ExpressionAttributeValues: { ':ts': nowIso },
  }));
}

// Interface for email task that goes to the email queue
interface EmailQueueTask {
  trackingId: string;
  clinicId: string;
  recipientEmail: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  templateName?: string;
  scheduleId: string;
}

// Send batch of email tasks to SQS (max 10 per batch)
async function enqueueEmailBatch(tasks: EmailQueueTask[]): Promise<void> {
  if (!EMAIL_QUEUE_URL || tasks.length === 0) return;

  const entries = tasks.map((task, index) => ({
    Id: `${index}`,
    MessageBody: JSON.stringify(task),
    // Group by clinic to help with ordering if needed
    MessageGroupId: undefined, // Standard queue, not FIFO
  }));

  await sqsClient.send(new SendMessageBatchCommand({
    QueueUrl: EMAIL_QUEUE_URL,
    Entries: entries,
  }));
}

async function processConsentFormScheduleTask(args: {
  scheduleId: string;
  clinicId: string;
  consentFormId: string;
  sql: string;
  hasEmailType: boolean;
  hasSmsType: boolean;
}): Promise<void> {
  const { scheduleId, clinicId, consentFormId, sql, hasEmailType, hasSmsType } = args;

  if (!CONSENT_FORM_TEMPLATES_TABLE_NAME || !CONSENT_FORM_INSTANCES_TABLE_NAME) {
    console.warn(
      `[ConsentForms/Schedule] Missing env vars (CONSENT_FORM_TEMPLATES_TABLE_NAME / CONSENT_FORM_INSTANCES_TABLE_NAME). Skipping schedule ${scheduleId}.`
    );
    return;
  }

  if (!hasEmailType && !hasSmsType) {
    console.warn(
      `[ConsentForms/Schedule] No supported notificationTypes (EMAIL/SMS) for schedule ${scheduleId}. Skipping.`
    );
    return;
  }

  const cfTemplate = await fetchConsentFormTemplateById(consentFormId);
  if (!cfTemplate) {
    console.warn(
      `[ConsentForms/Schedule] Consent form template not found: consentFormId=${consentFormId} (schedule ${scheduleId}).`
    );
    return;
  }

  const tmplName =
    String(cfTemplate.templateName || cfTemplate.template_name || 'Consent Form').trim() || 'Consent Form';
  const lang = String(cfTemplate.language || 'en').trim();

  const rows = await runOpenDentalQuery({ clinicId, sql });

  let instancesCreated = 0;
  let emailsEnqueued = 0;
  let smsSent = 0;
  let skippedNoPatNum = 0;
  let skippedNoContact = 0;
  let errors = 0;

  const emailTasksToEnqueue: EmailQueueTask[] = [];
  const seenPatNums = new Set<number>();

  for (const row of rows) {
    const patNum = extractPatNum(row);
    if (!patNum) {
      skippedNoPatNum++;
      continue;
    }
    if (seenPatNums.has(patNum)) continue;
    seenPatNums.add(patNum);

    const { email, phone } = extractEmailAndPhone(row);
    const recipientEmail = hasEmailType ? email : undefined;
    const recipientPhone = hasSmsType ? phone : undefined;

    if (!recipientEmail && !recipientPhone) {
      skippedNoContact++;
      continue;
    }

    try {
      const instance = await createConsentFormInstanceForSchedule({
        clinicId,
        patNum,
        consentFormId,
        template: cfTemplate,
        scheduleId,
      });
      instancesCreated++;

      const signingUrl = instance.signingUrl;
      const langBadge = lang ? ` (${lang})` : '';

      const smsText = `Please sign your ${tmplName}${langBadge} consent form: ${signingUrl}`;
      const emailSubject = `Consent Form: ${tmplName}`;
      const emailText = `Please review and sign your consent form: ${signingUrl}`;
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <p>Please review and sign your consent form:</p>
          <p><a href="${signingUrl}" target="_blank" rel="noopener noreferrer">${signingUrl}</a></p>
          <p>If you have any questions, please contact the office.</p>
        </div>
      `.trim();

      if (recipientEmail) {
        emailTasksToEnqueue.push({
          trackingId: '',
          clinicId,
          recipientEmail,
          subject: emailSubject,
          htmlBody: emailHtml,
          textBody: emailText,
          templateName: `ConsentForm:${consentFormId}`,
          scheduleId,
        });

        if (emailTasksToEnqueue.length >= SQS_BATCH_SIZE) {
          await enqueueEmailBatch(emailTasksToEnqueue);
          emailsEnqueued += emailTasksToEnqueue.length;
          emailTasksToEnqueue.length = 0;
        }
      }

      if (recipientPhone) {
        try {
          await sendSms({ clinicId, to: recipientPhone, body: smsText });
          smsSent++;
        } catch (smsError) {
          errors++;
          console.error(
            `[ConsentForms/Schedule] Failed to send SMS to ${recipientPhone} (patNum=${patNum}, schedule=${scheduleId}):`,
            smsError
          );
        }
      }
    } catch (err) {
      errors++;
      console.error(
        `[ConsentForms/Schedule] Failed to create/send for patNum=${patNum} (schedule=${scheduleId}):`,
        err
      );
    }
  }

  if (emailTasksToEnqueue.length > 0) {
    await enqueueEmailBatch(emailTasksToEnqueue);
    emailsEnqueued += emailTasksToEnqueue.length;
  }

  await markRanForClinic(scheduleId, clinicId);

  console.log(
    `[ConsentForms/Schedule] Completed schedule ${scheduleId} for clinic ${clinicId}: ` +
    `${instancesCreated} instances, ${emailsEnqueued} emails enqueued, ${smsSent} SMS sent, ` +
    `${skippedNoPatNum} skipped(no PatNum), ${skippedNoContact} skipped(no contact), ${errors} errors ` +
    `from ${rows.length} rows`
  );
}

async function processScheduleTask(task: ScheduleTask): Promise<void> {
  const { scheduleId, clinicId, queryTemplate, templateMessage, notificationTypes, timeZone } = task;

  console.log(`Processing schedule ${scheduleId} for clinic ${clinicId} (${timeZone})`);

  // Determine types once (used for both fetching and sending)
  const normalizedTypes = (notificationTypes || []).map((t) => String(t).toUpperCase());
  const hasEmailType = normalizedTypes.includes('EMAIL');
  const hasSmsType = normalizedTypes.includes('SMS');
  const hasRcsType = normalizedTypes.includes('RCS');
  const hasCallType =
    normalizedTypes.includes('CALL') ||
    normalizedTypes.includes('VOICE') ||
    normalizedTypes.includes('VOICE_CALL') ||
    normalizedTypes.includes('PHONE_CALL');
  const hasAiCallType =
    normalizedTypes.includes('AI_CALL') ||
    normalizedTypes.includes('AI_VOICE');

  // Fetch the SQL query
  const sql = await fetchQueryByName(queryTemplate);
  if (!sql) {
    console.warn(`Missing query for schedule ${scheduleId}: queryTemplate=${queryTemplate}`);
    return;
  }

  // Consent Form schedules are encoded via templateMessage prefix:
  //   templateMessage = "consentForm:<consent_form_id>"
  const consentFormId = parseConsentFormIdFromTemplateMessage(templateMessage);
  if (consentFormId) {
    await processConsentFormScheduleTask({
      scheduleId,
      clinicId,
      consentFormId,
      sql,
      hasEmailType,
      hasSmsType,
    });
    return;
  }

  // Fetch templates:
  // - Email/SMS schedules use TemplatesStack (templateMessage = template_name)
  // - RCS schedules prefer RcsStack templates table (templateMessage = templateId)
  let template: any | null = null;
  if (hasEmailType || hasSmsType || hasCallType || hasAiCallType) {
    template = await fetchTemplateByName(templateMessage);
  }

  let rcsTemplate: any | null = null;
  if (hasRcsType) {
    rcsTemplate = await fetchRcsTemplateById(clinicId, templateMessage);
    // Back-compat: if schedule stored a TemplatesStack template name for RCS, fall back to TemplatesStack lookup
    if (!rcsTemplate && !template) {
      template = await fetchTemplateByName(templateMessage);
    }
  }

  // Validate template availability per notification type
  if ((hasEmailType || hasSmsType || hasCallType || hasAiCallType) && !template) {
    console.warn(`Missing TemplatesStack template for schedule ${scheduleId}: templateMessage=${templateMessage}`);
    return;
  }

  if (hasRcsType) {
    const hasRcsContent =
      !!rcsTemplate ||
      !!(template && (template.rcs_message || template.rcs_rich_card || template.rcs_carousel || template.text_message));
    if (!hasRcsContent) {
      console.warn(`Missing RCS template content for schedule ${scheduleId}: templateMessage=${templateMessage}`);
      return;
    }
  }

  // Validate voice template content if CALL notifications are enabled
  const voiceTemplateText: string | undefined = template?.voice_message || template?.text_message;
  if (hasCallType && !voiceTemplateText) {
    console.warn(`Missing voice_message/text_message for CALL schedule ${scheduleId}: templateMessage=${templateMessage}`);
    // If CALL is the only notification type, abort the schedule; otherwise keep processing other channels
    if (!hasEmailType && !hasSmsType && !hasRcsType && !hasAiCallType) {
      return;
    }
  }

  // Validate AI voice prompt if AI_CALL notifications are enabled
  const aiVoicePromptTemplate: string | undefined = template?.ai_voice_prompt;
  if (hasAiCallType && !aiVoicePromptTemplate) {
    console.warn(`Missing ai_voice_prompt for AI_CALL schedule ${scheduleId}: templateMessage=${templateMessage}`);
    if (!hasEmailType && !hasSmsType && !hasRcsType && !hasCallType) {
      return;
    }
  }
  if (hasAiCallType && (!CONNECT_INSTANCE_ID || !OUTBOUND_CONTACT_FLOW_ID || !connectClient)) {
    console.warn(`[QueueConsumer/AI_CALL] CONNECT_INSTANCE_ID or OUTBOUND_CONTACT_FLOW_ID not configured; skipping AI_CALL`);
  }

  // Run the OpenDental query for this clinic
  const rows = await runOpenDentalQuery({ clinicId, sql });

  let emailsEnqueued = 0;
  let smsSent = 0;
  let rcsSent = 0;
  let callsStarted = 0;
  let callsFailed = 0;
  let aiCallsStarted = 0;
  let aiCallsFailed = 0;

  // Collect email tasks to enqueue in batches
  const emailTasksToEnqueue: EmailQueueTask[] = [];

  // Debug: Log why emails might not be processed
  const hasEmailBody = !!template?.email_body;
  console.log(`Email processing check: notificationTypes=${JSON.stringify(notificationTypes)}, hasEmailType=${hasEmailType}, hasEmailBody=${hasEmailBody}`);

  if (hasEmailType && hasEmailBody) {
    // Debug: Log first row to check CSV parsing
    if (rows.length > 0) {
      console.log(`Sample row keys: ${Object.keys(rows[0]).join(', ')}`);
      const sampleEmail = extractEmailAndPhone(rows[0]);
      console.log(`Sample email extraction: ${JSON.stringify(sampleEmail)}`);
    }

    for (const row of rows) {
      const { email } = extractEmailAndPhone(row);
      if (email) {
        const templateContext = await buildTemplateContext(clinicId, row);

        // Track as SCHEDULED in analytics table
        const trackingId = await trackEmailStatus({
          clinicId,
          recipientEmail: email,
          scheduleId,
          templateName: templateMessage,
          status: 'SCHEDULED',
        });

        // Render template
        const renderedSubject = renderTemplate(template.email_subject || 'Notification', templateContext);
        const renderedHtml = renderTemplate(template.email_body, templateContext);
        const renderedText = template.text_body ? renderTemplate(template.text_body, templateContext) : undefined;

        // Add to batch
        emailTasksToEnqueue.push({
          trackingId,
          clinicId,
          recipientEmail: email,
          subject: renderedSubject,
          htmlBody: renderedHtml,
          textBody: renderedText,
          templateName: templateMessage,
          scheduleId,
        });

        // Send batch when we reach SQS limit
        if (emailTasksToEnqueue.length >= SQS_BATCH_SIZE) {
          await enqueueEmailBatch(emailTasksToEnqueue);
          emailsEnqueued += emailTasksToEnqueue.length;
          emailTasksToEnqueue.length = 0; // Clear array
        }
      }
    }

    // Send remaining emails
    if (emailTasksToEnqueue.length > 0) {
      await enqueueEmailBatch(emailTasksToEnqueue);
      emailsEnqueued += emailTasksToEnqueue.length;
    }
  }

  console.log(`Enqueued ${emailsEnqueued} emails to email queue for ${clinicId}`);

  // Resolve clinic caller ID for outbound CALL/AI_CALL notifications (best-effort)
  let fromPhoneNumber: string | undefined;
  if ((hasCallType && voiceTemplateText) || (hasAiCallType && aiVoicePromptTemplate)) {
    try {
      const clinicConfig = await getClinicConfig(clinicId);
      if (clinicConfig?.phoneNumber) {
        fromPhoneNumber = normalizePhone(String(clinicConfig.phoneNumber)) || String(clinicConfig.phoneNumber);
      }
      if (!fromPhoneNumber) {
        console.warn(`[QueueConsumer/CALL] Missing clinic phoneNumber for clinic ${clinicId}; skipping CALL/AI_CALL notifications`);
      }
    } catch (err) {
      console.warn(`[QueueConsumer/CALL] Failed to load clinic config for caller ID; skipping CALL/AI_CALL notifications`, err);
    }
  }

  // Process SMS and RCS directly (usually lower volume, keep simple)
  const resolvedRcs = hasRcsType
    ? (rcsTemplate
      ? {
        body: rcsTemplate.body,
        richCard: rcsTemplate.richCard,
        carousel: rcsTemplate.carousel,
        templateId: rcsTemplate.templateId,
        templateName: rcsTemplate.name,
      }
      : template
        ? {
          body: template.rcs_message || template.text_message,
          richCard: template.rcs_rich_card,
          carousel: template.rcs_carousel,
          templateId: template.template_id || template.id,
          templateName: template.template_name || templateMessage,
        }
        : null)
    : null;

  const hasRcsPayload = !!(
    resolvedRcs && (resolvedRcs.body || resolvedRcs.richCard || resolvedRcs.carousel)
  );

  console.log(`Notification types check: SMS=${hasSmsType}, RCS=${hasRcsType}, types=${JSON.stringify(notificationTypes)}`);

  for (const row of rows) {
    const { phone } = extractEmailAndPhone(row);
    if (!phone) continue;

    // Build patient data for placeholder replacement
    const patientData: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const val = String(v || '').trim();
      // Map common field names
      const lowerKey = String(k).toLowerCase();
      if (lowerKey.includes('fname') || lowerKey === 'firstname') {
        patientData.FName = val;
        patientData.firstName = val;
      } else if (lowerKey.includes('lname') || lowerKey === 'lastname') {
        patientData.LName = val;
        patientData.lastName = val;
      } else {
        patientData[k] = val;
      }
    }

    // Send RCS if enabled (prioritize RCS over SMS when both are enabled)
    if (hasRcsType && resolvedRcs && hasRcsPayload) {
      try {
        const rcsResult = await sendRcs({
          clinicId,
          to: phone,
          body: resolvedRcs.body,
          richCard: resolvedRcs.richCard,
          carousel: resolvedRcs.carousel,
          templateId: resolvedRcs.templateId,
          templateName: resolvedRcs.templateName,
          patientData,
          scheduleId,
        });

        if (rcsResult.success) {
          rcsSent++;
        } else {
          console.warn(`RCS failed for ${phone}, falling back to SMS if enabled: ${rcsResult.error}`);
          // Fallback to SMS if RCS fails and SMS is also enabled
          if (hasSmsType && template?.text_message) {
            try {
              const templateContext = await buildTemplateContext(clinicId, row);
              const renderedSms = renderTemplate(template.text_message, templateContext);
              await sendSms({ clinicId, to: phone, body: renderedSms });
              smsSent++;
            } catch (smsError) {
              console.error(`SMS fallback also failed for ${phone}:`, smsError);
            }
          }
        }
      } catch (error) {
        console.error(`Failed to send RCS to ${phone}:`, error);
      }
    } else if (hasSmsType && template?.text_message) {
      // SMS only (no RCS)
      try {
        const templateContext = await buildTemplateContext(clinicId, row);
        const renderedSms = renderTemplate(template.text_message, templateContext);
        await sendSms({ clinicId, to: phone, body: renderedSms });
        smsSent++;
      } catch (error) {
        console.error(`Failed to send SMS to ${phone}:`, error);
      }
    }

    // Voice marketing calls (CALL/VOICE)
    if (hasCallType && voiceTemplateText && fromPhoneNumber) {
      try {
        const templateContext = await buildTemplateContext(clinicId, row);
        const patNum =
          String(
            (row as any)?.PatNum ??
            (row as any)?.patNum ??
            (row as any)?.PATNUM ??
            (row as any)?.patientId ??
            (row as any)?.PatientId ??
            ''
          ).trim() || undefined;
        const patientName =
          (templateContext['patient_name'] || '').trim() ||
          [templateContext['first_name'], templateContext['last_name']].filter(Boolean).join(' ').trim() ||
          undefined;
        const renderedVoice = renderTemplate(voiceTemplateText, templateContext).trim();
        if (!renderedVoice) {
          console.warn(`[QueueConsumer/CALL] Rendered voice message is empty; skipping call to ${phone}`);
        } else {
          await sendMarketingCall({
            clinicId,
            fromPhoneNumber,
            toPhoneNumber: phone,
            message: renderedVoice,
            voiceId: template?.voice_voiceId || 'Joanna',
            engine: (template?.voice_engine as 'standard' | 'neural') || 'neural',
            languageCode: template?.voice_languageCode || 'en-US',
            scheduleId,
            templateName: templateMessage,
            patNum,
            patientName,
          });
          callsStarted++;
        }
      } catch (error) {
        callsFailed++;
        console.error(`Failed to start CALL to ${phone}:`, error);
      }
    }

    // AI Voice calls via Connect + Bedrock (AI_CALL)
    if (hasAiCallType && aiVoicePromptTemplate && fromPhoneNumber && connectClient && CONNECT_INSTANCE_ID && OUTBOUND_CONTACT_FLOW_ID) {
      try {
        const templateContext = await buildTemplateContext(clinicId, row);
        const patNum =
          String(
            (row as any)?.PatNum ??
            (row as any)?.patNum ??
            (row as any)?.PATNUM ??
            (row as any)?.patientId ??
            (row as any)?.PatientId ??
            ''
          ).trim() || undefined;
        const patientName =
          (templateContext['patient_name'] || '').trim() ||
          [templateContext['first_name'], templateContext['last_name']].filter(Boolean).join(' ').trim() ||
          undefined;
        const renderedPrompt = renderTemplate(aiVoicePromptTemplate, templateContext).trim();
        if (!renderedPrompt) {
          console.warn(`[QueueConsumer/AI_CALL] Rendered AI voice prompt is empty; skipping call to ${phone}`);
        } else {
          const contactResponse = await connectClient.send(
            new StartOutboundVoiceContactCommand({
              InstanceId: CONNECT_INSTANCE_ID,
              ContactFlowId: OUTBOUND_CONTACT_FLOW_ID,
              DestinationPhoneNumber: phone,
              SourcePhoneNumber: fromPhoneNumber,
              Attributes: {
                ai_voice_prompt: renderedPrompt,
                patientName: patientName || '',
                clinicId,
                scheduleId,
                callDirection: 'outbound',
              },
            })
          );
          console.log('[QueueConsumer/AI_CALL] Started AI outbound call', {
            clinicId,
            to: phone,
            from: fromPhoneNumber,
            contactId: contactResponse.ContactId,
          });
          // Best-effort analytics
          if (VOICE_CALL_ANALYTICS_TABLE && contactResponse.ContactId) {
            try {
              const now = new Date();
              const ttl = Math.floor(now.getTime() / 1000) + (365 * 24 * 60 * 60);
              await doc.send(new PutCommand({
                TableName: VOICE_CALL_ANALYTICS_TABLE,
                Item: {
                  callId: contactResponse.ContactId,
                  clinicId,
                  scheduleId,
                  templateName: templateMessage,
                  patNum: patNum || '',
                  patientName: patientName || '',
                  recipientPhone: phone,
                  fromPhoneNumber,
                  status: 'INITIATED',
                  startedAt: now.toISOString(),
                  source: 'ai_call_schedule',
                  callType: 'AI_CALL',
                  ttl,
                },
              }));
            } catch (analyticsErr) {
              console.warn('[QueueConsumer/AI_CALL] Failed to store analytics (non-fatal):', analyticsErr);
            }
          }
          aiCallsStarted++;
        }
      } catch (error) {
        aiCallsFailed++;
        console.error(`Failed to start AI_CALL to ${phone}:`, error);
      }
    }
  }

  // Mark the schedule as run for this clinic
  await markRanForClinic(scheduleId, clinicId);

  console.log(
    `Completed schedule ${scheduleId} for clinic ${clinicId}: ` +
    `${emailsEnqueued} emails enqueued, ${smsSent} SMS sent, ${rcsSent} RCS sent, ` +
    `${callsStarted} calls started (${callsFailed} failed), ` +
    `${aiCallsStarted} AI calls started (${aiCallsFailed} failed) from ${rows.length} rows`
  );
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

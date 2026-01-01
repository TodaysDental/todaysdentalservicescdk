import https from 'https';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
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
const sms = new (PinpointSMSVoiceV2Client as any)({});

const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE || process.env.SCHEDULER || 'SCHEDULER';
const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || 'Templates';
const QUERIES_TABLE = process.env.QUERIES_TABLE || 'SQLQueries-V3';
const EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE || '';
const EMAIL_QUEUE_URL = process.env.EMAIL_QUEUE_URL || '';

// Batch size for SQS SendMessageBatch (max 10)
const SQS_BATCH_SIZE = 10;

// SFTP connection info from environment (host is dynamic, password from GlobalSecrets)
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';

// Cache for clinic credentials (populated on demand from DynamoDB)
const clinicCredsCache: Record<string, ClinicCreds> = {};

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

function normalizePhone(p: string): string | undefined {
  const digits = (p || '').replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+') && digits.length > 8) return digits;
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
  
  let emailsEnqueued = 0;
  let smsSent = 0;

  // Collect email tasks to enqueue in batches
  const emailTasksToEnqueue: EmailQueueTask[] = [];
  
  // Debug: Log why emails might not be processed
  const hasEmailType = notificationTypes.includes('EMAIL');
  const hasEmailBody = !!template.email_body;
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

  // Process SMS directly (usually lower volume, keep simple)
  for (const row of rows) {
    const { phone } = extractEmailAndPhone(row);
    
    if (notificationTypes.includes('SMS') && phone && template.text_message) {
      try {
        const templateContext = await buildTemplateContext(clinicId, row);
        const renderedSms = renderTemplate(template.text_message, templateContext);
        await sendSms({ clinicId, to: phone, body: renderedSms });
        smsSent++;
      } catch (error) {
        console.error(`Failed to send SMS to ${phone}:`, error);
      }
    }
  }

  // Mark the schedule as run for this clinic
  await markRanForClinic(scheduleId, clinicId);
  
  console.log(`Completed schedule ${scheduleId} for clinic ${clinicId}: ${emailsEnqueued} emails enqueued, ${smsSent} SMS sent from ${rows.length} rows`);
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

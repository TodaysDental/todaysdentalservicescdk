/**
 * Email Router Lambda
 * 
 * Scheduled by EventBridge to poll clinic email inboxes, classify content
 * using Bedrock Claude, and route emails to the appropriate system:
 * - Callback requests → Callbacks DynamoDB table
 * - Tasks (accounting, IT, operations, HR) → Comm FavorRequests table
 * - Autoclave test results → Comm FavorRequests (Operations)
 * - Azure alerts → Comm FavorRequests (IT or Accounting)
 * - Attachments → S3 with download links in task descriptions
 */

import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { OAuth2Client } from 'google-auth-library';
import * as imaps from 'imap-simple';
import { simpleParser, Attachment } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllClinicConfigs,
  getClinicSecrets,
  getGmailOAuthCredentials,
  ClinicConfig,
} from '../../shared/utils/secrets-helper';

// ========================================
// CONFIGURATION
// ========================================

const PROCESSED_EMAILS_TABLE = process.env.PROCESSED_EMAILS_TABLE || '';
const CALLBACK_TABLE_PREFIX = process.env.CALLBACK_TABLE_PREFIX || 'todaysdentalinsights-callback-';
const DEFAULT_CALLBACK_TABLE = process.env.DEFAULT_CALLBACK_TABLE || '';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const FILES_BUCKET = process.env.FILES_BUCKET || '';
const REGION = process.env.AWS_REGION || 'us-east-1';
const MAX_EMAILS_PER_CLINIC = parseInt(process.env.MAX_EMAILS_PER_CLINIC || '20', 10);
const POLL_DAYS = parseInt(process.env.POLL_DAYS || '1', 10);
const PROCESSED_TTL_DAYS = 30;

const BEDROCK_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';
const BEDROCK_FALLBACK_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

// ========================================
// CLIENTS
// ========================================

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
const bedrockClient = new BedrockRuntimeClient({ maxAttempts: 3 });

// ========================================
// TYPES
// ========================================

type EmailCategory =
  | 'callback_request'
  | 'accounting_task'
  | 'appointment_request'
  | 'hr_task'
  | 'azure_backup_failure'
  | 'azure_payment_pending'
  | 'autoclave_test_failed'
  | 'autoclave_test_passed'
  | 'general_inquiry'
  | 'spam_or_marketing';

type TaskPriority = 'high' | 'medium' | 'low';

interface ClassificationResult {
  category: EmailCategory;
  confidence: number;
  priority: TaskPriority;
  summary: string;
  extractedData: {
    name?: string;
    phone?: string;
    email?: string;
    autoclaveDetails?: {
      autoclaveName?: string;
      serialNumber?: string;
      testOperator?: string;
      resultDate?: string;
      clinicName?: string;
    };
    azureDetails?: {
      service?: string;
      errorMessage?: string;
      amount?: string;
    };
  };
}

interface ParsedEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  html?: string;
  attachments: Attachment[];
}

interface RoutingResult {
  clinicId: string;
  emailId: string;
  category: EmailCategory;
  action: 'callback_created' | 'task_created' | 'skipped';
  targetId?: string;
}

interface GmailEmailConfig {
  gmail?: { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; smtpUser: string; fromEmail: string; fromName: string };
  domain?: { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; smtpUser: string; fromEmail: string; fromName: string };
  gmailUserId?: string;
  gmailRefreshToken?: string;
}

// ========================================
// AI CLASSIFICATION
// ========================================

const CLASSIFICATION_SYSTEM_PROMPT = `You are an email classifier for a dental practice management system. Classify the given email into exactly one category and extract relevant structured data.

CATEGORIES:
1. callback_request - Patient provides name and phone number, or explicitly asks to be called back
2. accounting_task - Billing questions, payment issues, insurance queries, account balances from patients
3. appointment_request - Patient wants to schedule, reschedule, or cancel an appointment
4. hr_task - Employment inquiries, job applications, staff-related matters
5. azure_backup_failure - Microsoft Azure backup failure/error notifications (from Microsoft/Azure)
6. azure_payment_pending - Microsoft Azure billing alerts, payment due, subscription expiring, invoices (from Microsoft/Azure)
7. autoclave_test_failed - HealthFirst/OnTraq autoclave spore test result where the test FAILED (growth observed)
8. autoclave_test_passed - HealthFirst/OnTraq autoclave spore test result where the test PASSED (no growth observed)
9. general_inquiry - Other patient or business questions that don't fit above categories
10. spam_or_marketing - Junk mail, promotional newsletters, unsolicited marketing, automated notifications with no action needed

CLASSIFICATION RULES:
- Azure emails: Look for senders like azure-noreply@microsoft.com, microsoft.com domains, subjects mentioning Azure, backup, or billing
- Autoclave emails: Look for HealthFirst, OnTraq, spore test, autoclave keywords. Check if result says "Passed" or "Failed"
- Callback requests: Must contain a phone number AND a name, or explicitly ask for a callback
- If unsure between categories, prefer the more specific one over general_inquiry

RESPOND WITH ONLY a JSON object:
{
  "category": "one of the 10 categories above",
  "confidence": 0.0 to 1.0,
  "priority": "high" | "medium" | "low",
  "summary": "1-2 sentence summary of the email content",
  "extractedData": {
    "name": "sender/patient name if found",
    "phone": "phone number if found",
    "email": "sender email address",
    "autoclaveDetails": {
      "autoclaveName": "name if found",
      "serialNumber": "serial if found",
      "testOperator": "operator name if found",
      "resultDate": "date if found",
      "clinicName": "clinic name from the test if found"
    },
    "azureDetails": {
      "service": "Azure service name if found",
      "errorMessage": "error details if found",
      "amount": "payment amount if found"
    }
  }
}`;

async function classifyEmail(subject: string, body: string, from: string): Promise<ClassificationResult> {
  const truncatedBody = body.length > 3000 ? body.slice(0, 3000) + '...' : body;

  const userPrompt = `Classify this email:

FROM: ${from}
SUBJECT: ${subject}

BODY:
${truncatedBody}`;

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    temperature: 0.1,
    system: CLASSIFICATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };

  let modelId = BEDROCK_MODEL_ID;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const textContent = responseBody.content?.find((c: any) => c.type === 'text')?.text;

      if (!textContent) throw new Error('No text content in Claude response');

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      return JSON.parse(jsonMatch[0]) as ClassificationResult;
    } catch (err: any) {
      if (attempt === 0 && modelId === BEDROCK_MODEL_ID) {
        console.warn(`[EmailRouter] Sonnet failed, falling back to Haiku: ${err.message}`);
        modelId = BEDROCK_FALLBACK_MODEL_ID;
        continue;
      }
      throw err;
    }
  }

  throw new Error('Classification failed after all attempts');
}

// ========================================
// GMAIL POLLING
// ========================================

let gmailOAuthCreds: { clientId: string; clientSecret: string } | null = null;

async function getGmailCreds(): Promise<{ clientId: string; clientSecret: string }> {
  if (gmailOAuthCreds) return gmailOAuthCreds;
  const creds = await getGmailOAuthCredentials();
  if (!creds) throw new Error('Gmail OAuth credentials not found in GlobalSecrets');
  gmailOAuthCreds = creds;
  return creds;
}

async function gmailRequest(
  method: string,
  path: string,
  refreshToken: string,
  body?: unknown,
): Promise<any> {
  const { clientId, clientSecret } = await getGmailCreds();
  const oauth = new OAuth2Client(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth.getAccessToken();
  if (!token) throw new Error('Failed to get Gmail access token');

  const url = `https://gmail.googleapis.com/gmail/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    const parsed = text ? JSON.parse(text) : {};
    throw new Error(`Gmail API ${res.status}: ${parsed?.error?.message || text}`);
  }
  return text ? JSON.parse(text) : null;
}

function base64UrlDecode(b64url: string): Buffer {
  const s = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64');
}

async function fetchUnreadGmail(clinicConfig: ClinicConfig): Promise<ParsedEmail[]> {
  const emailConfig = clinicConfig.email as GmailEmailConfig | undefined;
  if (!emailConfig?.gmailRefreshToken) return [];

  const userId = emailConfig.gmailUserId || 'me';
  const refreshToken = emailConfig.gmailRefreshToken;

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - POLL_DAYS);
  const afterDate = `${daysAgo.getFullYear()}/${String(daysAgo.getMonth() + 1).padStart(2, '0')}/${String(daysAgo.getDate()).padStart(2, '0')}`;
  const query = encodeURIComponent(`is:unread in:inbox after:${afterDate}`);

  const list = await gmailRequest(
    'GET',
    `users/${encodeURIComponent(userId)}/messages?q=${query}&maxResults=${MAX_EMAILS_PER_CLINIC}`,
    refreshToken,
  ) as { messages?: { id: string }[] };

  if (!list?.messages?.length) return [];

  const emails: ParsedEmail[] = [];

  for (const { id } of list.messages.slice(0, MAX_EMAILS_PER_CLINIC)) {
    try {
      const msg = await gmailRequest(
        'GET',
        `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}?format=raw`,
        refreshToken,
      ) as { id: string; raw: string };

      const buf = base64UrlDecode(msg.raw || '');
      const parsed = await simpleParser(buf);

      const toAddr = Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(', ') : (parsed.to?.text || '');
      const text = (parsed.text || '').trim();

      emails.push({
        id: msg.id,
        from: parsed.from?.text || '',
        to: toAddr,
        subject: parsed.subject || '',
        date: parsed.date?.toISOString() || '',
        text,
        html: parsed.html || undefined,
        attachments: parsed.attachments || [],
      });
    } catch (err) {
      console.error(`[EmailRouter] Error fetching Gmail message ${id}:`, err);
    }
  }

  return emails;
}

async function markGmailAsRead(clinicConfig: ClinicConfig, messageId: string): Promise<void> {
  const emailConfig = clinicConfig.email as GmailEmailConfig | undefined;
  if (!emailConfig?.gmailRefreshToken) return;

  const userId = emailConfig.gmailUserId || 'me';
  await gmailRequest(
    'POST',
    `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/modify`,
    emailConfig.gmailRefreshToken,
    { removeLabelIds: ['UNREAD'] },
  );
}

// ========================================
// IMAP POLLING
// ========================================

async function fetchUnreadImap(clinicConfig: ClinicConfig): Promise<ParsedEmail[]> {
  const emailConfig = clinicConfig.email as GmailEmailConfig | undefined;
  const domainConfig = emailConfig?.domain;
  if (!domainConfig) return [];

  const clinicSecrets = await getClinicSecrets(clinicConfig.clinicId);
  if (!clinicSecrets?.domainSmtpPassword) {
    console.warn(`[EmailRouter] No domain SMTP password for clinic ${clinicConfig.clinicId}`);
    return [];
  }

  const imapConfig = {
    imap: {
      user: domainConfig.smtpUser,
      password: clinicSecrets.domainSmtpPassword,
      host: domainConfig.imapHost,
      port: domainConfig.imapPort,
      tls: true,
      authTimeout: 30000,
      connTimeout: 30000,
      tlsOptions: { servername: domainConfig.imapHost },
    },
  };

  let connection: imaps.ImapSimple | null = null;
  try {
    connection = await imaps.connect(imapConfig);
    await connection.openBox('INBOX');

    const searchResults = await connection.search(['UNSEEN'], {
      bodies: [''],
      struct: true,
    });

    if (!searchResults.length) {
      connection.end();
      return [];
    }

    const limited = searchResults.slice(0, MAX_EMAILS_PER_CLINIC);
    const emails: ParsedEmail[] = [];

    for (const message of limited) {
      try {
        const bodyPart = message.parts?.find((p: { which: string }) => p.which === '');
        const raw = bodyPart?.body || '';
        if (!raw) continue;

        const parsed = await simpleParser(raw);
        const toAddr = Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(', ') : (parsed.to?.text || '');
        const uid = message.attributes?.uid;

        emails.push({
          id: String(uid || uuidv4()),
          from: parsed.from?.text || '',
          to: toAddr,
          subject: parsed.subject || '',
          date: parsed.date?.toISOString() || '',
          text: (parsed.text || '').trim(),
          html: parsed.html || undefined,
          attachments: parsed.attachments || [],
        });
      } catch (err) {
        console.error(`[EmailRouter] Error parsing IMAP message:`, err);
      }
    }

    connection.end();
    return emails;
  } catch (err) {
    console.error(`[EmailRouter] IMAP connection error for ${clinicConfig.clinicId}:`, err);
    try { if (connection) connection.end(); } catch { /* ignore */ }
    return [];
  }
}

async function markImapAsRead(clinicConfig: ClinicConfig, uid: string): Promise<void> {
  const emailConfig = clinicConfig.email as GmailEmailConfig | undefined;
  const domainConfig = emailConfig?.domain;
  if (!domainConfig) return;

  const clinicSecrets = await getClinicSecrets(clinicConfig.clinicId);
  if (!clinicSecrets?.domainSmtpPassword) return;

  let connection: imaps.ImapSimple | null = null;
  try {
    connection = await imaps.connect({
      imap: {
        user: domainConfig.smtpUser,
        password: clinicSecrets.domainSmtpPassword,
        host: domainConfig.imapHost,
        port: domainConfig.imapPort,
        tls: true,
        authTimeout: 15000,
        connTimeout: 15000,
        tlsOptions: { servername: domainConfig.imapHost },
      },
    });
    await connection.openBox('INBOX');
    await connection.addFlags(parseInt(uid, 10), ['\\Seen']);
    connection.end();
  } catch (err) {
    console.error(`[EmailRouter] Failed to mark IMAP message ${uid} as read:`, err);
    try { if (connection) connection.end(); } catch { /* ignore */ }
  }
}

// ========================================
// PROCESSED EMAILS TRACKING
// ========================================

async function isAlreadyProcessed(clinicId: string, emailId: string): Promise<boolean> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: PROCESSED_EMAILS_TABLE,
      Key: { messageId: `${clinicId}#${emailId}` },
    }));
    return !!result.Item;
  } catch {
    return false;
  }
}

async function markAsProcessed(clinicId: string, emailId: string, category: EmailCategory): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + (PROCESSED_TTL_DAYS * 24 * 60 * 60);
  await docClient.send(new PutCommand({
    TableName: PROCESSED_EMAILS_TABLE,
    Item: {
      messageId: `${clinicId}#${emailId}`,
      clinicId,
      emailId,
      category,
      processedAt: new Date().toISOString(),
      ttl,
    },
  }));
}

// ========================================
// ATTACHMENT HANDLING
// ========================================

async function uploadAttachments(
  clinicId: string,
  messageId: string,
  attachments: Attachment[],
): Promise<string[]> {
  if (!attachments.length || !FILES_BUCKET) return [];

  const urls: string[] = [];

  for (const attachment of attachments) {
    if (!attachment.content || !attachment.filename) continue;
    if (attachment.size && attachment.size > 10 * 1024 * 1024) {
      console.warn(`[EmailRouter] Skipping attachment ${attachment.filename} (${attachment.size} bytes) - too large`);
      continue;
    }

    const key = `email-router/${clinicId}/${messageId}/${attachment.filename}`;
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: FILES_BUCKET,
        Key: key,
        Body: attachment.content,
        ContentType: attachment.contentType || 'application/octet-stream',
      }));

      const url = `https://${FILES_BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
      urls.push(`[${attachment.filename}](${url})`);
    } catch (err) {
      console.error(`[EmailRouter] Failed to upload attachment ${attachment.filename}:`, err);
    }
  }

  return urls;
}

// ========================================
// ROUTING: CALLBACK CREATION
// ========================================

const CATEGORY_TO_MODULE: Record<string, string> = {
  callback_request: 'Operations',
  accounting_task: 'Accounting',
  appointment_request: 'Operations',
  hr_task: 'HR',
  azure_backup_failure: 'IT',
  azure_payment_pending: 'Accounting',
  autoclave_test_failed: 'Operations',
  autoclave_test_passed: 'Operations',
  general_inquiry: 'Operations',
};

async function createCallback(
  clinicId: string,
  classification: ClassificationResult,
  email: ParsedEmail,
  attachmentLinks: string[],
): Promise<string> {
  const requestId = uuidv4();
  const now = new Date().toISOString();
  const { name, phone, email: extractedEmail } = classification.extractedData;

  let message = classification.summary;
  if (attachmentLinks.length) {
    message += `\n\nAttachments:\n${attachmentLinks.join('\n')}`;
  }

  const item: Record<string, any> = {
    RequestID: requestId,
    name: name || email.from || 'Unknown',
    phone: phone || 'Not provided',
    email: extractedEmail || email.from || undefined,
    message,
    module: CATEGORY_TO_MODULE[classification.category] || 'Operations',
    clinicId,
    calledBack: 'NO',
    createdAt: now,
    updatedAt: now,
    source: 'email-router',
    emailSubject: email.subject,
    emailFrom: email.from,
  };

  const tableName = `${CALLBACK_TABLE_PREFIX}${clinicId}`;

  try {
    await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
    console.log(`[EmailRouter] Callback ${requestId} created in ${tableName}`);
  } catch (err: any) {
    if (err?.name === 'ResourceNotFoundException' && DEFAULT_CALLBACK_TABLE) {
      await docClient.send(new PutCommand({ TableName: DEFAULT_CALLBACK_TABLE, Item: item }));
      console.log(`[EmailRouter] Callback ${requestId} created in fallback table ${DEFAULT_CALLBACK_TABLE}`);
    } else {
      throw err;
    }
  }

  return requestId;
}

// ========================================
// ROUTING: COMM TASK CREATION
// ========================================

const CATEGORY_TO_COMM: Record<string, { category: string; requestType: string }> = {
  accounting_task: { category: 'Accounting', requestType: 'Assign Task' },
  appointment_request: { category: 'Operations', requestType: 'Assign Task' },
  hr_task: { category: 'HR', requestType: 'Assign Task' },
  azure_backup_failure: { category: 'IT', requestType: 'Assign Task' },
  azure_payment_pending: { category: 'Accounting', requestType: 'Assign Task' },
  autoclave_test_failed: { category: 'Operations', requestType: 'Assign Task' },
  autoclave_test_passed: { category: 'Operations', requestType: 'Assign Task' },
  general_inquiry: { category: 'Operations', requestType: 'Assign Task' },
};

function buildTaskDescription(classification: ClassificationResult, email: ParsedEmail, attachmentLinks: string[]): string {
  const parts: string[] = [];

  parts.push(`From: ${email.from}`);
  parts.push(`Date: ${email.date}`);
  parts.push('');
  parts.push(classification.summary);

  const { autoclaveDetails, azureDetails } = classification.extractedData;

  if (autoclaveDetails?.autoclaveName) {
    parts.push('');
    parts.push('--- Autoclave Test Details ---');
    if (autoclaveDetails.clinicName) parts.push(`Location: ${autoclaveDetails.clinicName}`);
    parts.push(`Autoclave: ${autoclaveDetails.autoclaveName}`);
    if (autoclaveDetails.serialNumber) parts.push(`Serial: ${autoclaveDetails.serialNumber}`);
    if (autoclaveDetails.testOperator) parts.push(`Operator: ${autoclaveDetails.testOperator}`);
    if (autoclaveDetails.resultDate) parts.push(`Result Date: ${autoclaveDetails.resultDate}`);
  }

  if (azureDetails?.service) {
    parts.push('');
    parts.push('--- Azure Alert Details ---');
    parts.push(`Service: ${azureDetails.service}`);
    if (azureDetails.errorMessage) parts.push(`Details: ${azureDetails.errorMessage}`);
    if (azureDetails.amount) parts.push(`Amount: ${azureDetails.amount}`);
  }

  if (attachmentLinks.length) {
    parts.push('');
    parts.push('--- Attachments ---');
    parts.push(...attachmentLinks);
  }

  return parts.join('\n');
}

async function createCommTask(
  clinicId: string,
  classification: ClassificationResult,
  email: ParsedEmail,
  attachmentLinks: string[],
): Promise<string> {
  const favorRequestID = uuidv4();
  const now = new Date().toISOString();
  const mapping = CATEGORY_TO_COMM[classification.category] || CATEGORY_TO_COMM.general_inquiry;

  const titlePrefix: Record<string, string> = {
    azure_backup_failure: '[AZURE BACKUP FAILURE]',
    azure_payment_pending: '[AZURE PAYMENT]',
    autoclave_test_failed: '[AUTOCLAVE TEST FAILED]',
    autoclave_test_passed: '[Autoclave Test Passed]',
    accounting_task: '[Patient Billing]',
    appointment_request: '[Appointment Request]',
    hr_task: '[HR Inquiry]',
    general_inquiry: '[Email Inquiry]',
  };

  const prefix = titlePrefix[classification.category] || '[Email]';
  const title = `${prefix} ${email.subject}`.slice(0, 200);
  const description = buildTaskDescription(classification, email, attachmentLinks);

  const task: Record<string, any> = {
    favorRequestID,
    senderID: 'system-email-router',
    userID: 'system-email-router',
    title,
    description,
    status: 'pending',
    priority: classification.priority.charAt(0).toUpperCase() + classification.priority.slice(1),
    category: mapping.category,
    requestType: mapping.requestType,
    createdAt: now,
    updatedAt: now,
    initialMessage: description,
    unreadCount: 1,
    source: 'email-router',
    sourceClinicId: clinicId,
    emailFrom: email.from,
    emailSubject: email.subject,
  };

  await docClient.send(new PutCommand({ TableName: FAVORS_TABLE, Item: task }));
  console.log(`[EmailRouter] Task ${favorRequestID} created (${mapping.category}/${classification.priority})`);

  return favorRequestID;
}

// ========================================
// EMAIL PROCESSING PIPELINE
// ========================================

async function processEmail(
  clinicId: string,
  email: ParsedEmail,
  clinicConfig: ClinicConfig,
  emailSource: 'gmail' | 'imap',
): Promise<RoutingResult> {
  if (await isAlreadyProcessed(clinicId, email.id)) {
    return { clinicId, emailId: email.id, category: 'spam_or_marketing', action: 'skipped' };
  }

  const classification = await classifyEmail(email.subject, email.text || '', email.from);
  console.log(`[EmailRouter] ${clinicId}/${email.id}: ${classification.category} (${classification.confidence})`);

  if (classification.category === 'spam_or_marketing') {
    await markAsProcessed(clinicId, email.id, classification.category);
    return { clinicId, emailId: email.id, category: classification.category, action: 'skipped' };
  }

  const attachmentLinks = await uploadAttachments(clinicId, email.id, email.attachments);

  let targetId: string;
  let action: 'callback_created' | 'task_created';

  if (classification.category === 'callback_request') {
    targetId = await createCallback(clinicId, classification, email, attachmentLinks);
    action = 'callback_created';
  } else {
    targetId = await createCommTask(clinicId, classification, email, attachmentLinks);
    action = 'task_created';
  }

  await markAsProcessed(clinicId, email.id, classification.category);

  try {
    if (emailSource === 'gmail') {
      await markGmailAsRead(clinicConfig, email.id);
    } else {
      await markImapAsRead(clinicConfig, email.id);
    }
  } catch (err) {
    console.warn(`[EmailRouter] Failed to mark ${email.id} as read (non-fatal):`, err);
  }

  return { clinicId, emailId: email.id, category: classification.category, action, targetId };
}

// ========================================
// CLINIC PROCESSING
// ========================================

async function processClinic(clinicConfig: ClinicConfig): Promise<RoutingResult[]> {
  const clinicId = clinicConfig.clinicId;
  const results: RoutingResult[] = [];
  const emailConfig = clinicConfig.email as GmailEmailConfig | undefined;

  if (!emailConfig) {
    return results;
  }

  // Prefer Gmail REST API if refresh token is available, otherwise try IMAP
  let emails: ParsedEmail[] = [];
  let source: 'gmail' | 'imap' = 'gmail';

  if (emailConfig.gmailRefreshToken) {
    try {
      emails = await fetchUnreadGmail(clinicConfig);
      source = 'gmail';
      console.log(`[EmailRouter] ${clinicId}: Fetched ${emails.length} unread emails via Gmail`);
    } catch (err) {
      console.error(`[EmailRouter] Gmail fetch failed for ${clinicId}, trying IMAP:`, err);
      emails = [];
    }
  }

  if (!emails.length && emailConfig.domain) {
    try {
      emails = await fetchUnreadImap(clinicConfig);
      source = 'imap';
      console.log(`[EmailRouter] ${clinicId}: Fetched ${emails.length} unread emails via IMAP`);
    } catch (err) {
      console.error(`[EmailRouter] IMAP fetch failed for ${clinicId}:`, err);
      return results;
    }
  }

  for (const email of emails) {
    try {
      const result = await processEmail(clinicId, email, clinicConfig, source);
      results.push(result);
    } catch (err) {
      console.error(`[EmailRouter] Error processing email ${email.id} for ${clinicId}:`, err);
    }
  }

  return results;
}

// ========================================
// MAIN HANDLER
// ========================================

export const handler = async (event: ScheduledEvent): Promise<void> => {
  const startTime = Date.now();
  console.log(`[EmailRouter] Starting email router at ${new Date().toISOString()}`);

  let allResults: RoutingResult[] = [];

  try {
    const clinicConfigs = await getAllClinicConfigs();
    const clinicsWithEmail = clinicConfigs.filter(c => {
      const email = c.email as GmailEmailConfig | undefined;
      return email && (email.gmailRefreshToken || email.domain);
    });

    console.log(`[EmailRouter] Processing ${clinicsWithEmail.length} clinics with email configured`);

    for (const config of clinicsWithEmail) {
      try {
        const results = await processClinic(config);
        allResults = allResults.concat(results);
      } catch (err) {
        console.error(`[EmailRouter] Error processing clinic ${config.clinicId}:`, err);
      }

      // Timeout guard: stop if we've used 80% of the 5-minute timeout
      if (Date.now() - startTime > 240_000) {
        console.warn('[EmailRouter] Approaching timeout, stopping early');
        break;
      }
    }
  } catch (err) {
    console.error('[EmailRouter] Fatal error:', err);
  }

  const processed = allResults.filter(r => r.action !== 'skipped');
  const skipped = allResults.filter(r => r.action === 'skipped');

  console.log(`[EmailRouter] Complete. Processed: ${processed.length}, Skipped: ${skipped.length}, Duration: ${Date.now() - startTime}ms`);

  if (processed.length > 0) {
    const summary = processed.reduce((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('[EmailRouter] Summary by category:', JSON.stringify(summary));
  }
};

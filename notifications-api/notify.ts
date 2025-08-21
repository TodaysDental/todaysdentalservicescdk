import https from 'https';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../utils/cors';
import clinicsData from '../clinic-config/clinics.json';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});
const sms = new (PinpointSMSVoiceV2Client as any)({});

const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || 'Templates';

type ClinicCreds = {
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir?: string;
};

const CLINIC_CREDS: Record<string, ClinicCreds> = (() => {
  const raw = process.env.OPEN_DENTAL_CLINIC_CREDS || '{}';
  try { return JSON.parse(raw); } catch { return {}; }
})();

const CLINIC_SES_IDENTITY_ARN_MAP: Record<string, string> = (() => {
  const raw = process.env.CLINIC_SES_IDENTITY_ARN_MAP || '{}';
  try { return JSON.parse(raw); } catch { return {}; }
})();

const CLINIC_SMS_ORIGINATION_ARN_MAP: Record<string, string> = (() => {
  const raw = process.env.CLINIC_SMS_ORIGINATION_ARN_MAP || '{}';
  try { return JSON.parse(raw); } catch { return {}; }
})();

const corsHeaders = buildCorsHeaders();

function http(code: number, body: any): APIGatewayProxyResult {
  return { statusCode: code, headers: corsHeaders, body: JSON.stringify(body) };
}

function parseBody(body: any): Record<string, any> { try { return typeof body === 'string' ? JSON.parse(body) : (body || {}); } catch { return {}; } }

function getGroupsFromClaims(claims?: Record<string, any>): string[] {
  if (!claims) return [];
  const raw = (claims as any)['cognito:groups'] ?? (claims as any)['cognito:groups[]'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    try { const parsed = JSON.parse(trimmed); if (Array.isArray(parsed)) return parsed as string[]; } catch {}
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function isGlobalSuperAdmin(groups: string[]): boolean { return groups.includes('GLOBAL__SUPER_ADMIN'); }

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return http(200, { ok: true });
  if (event.httpMethod !== 'POST') return http(405, { error: 'Method Not Allowed' });

  const pathClinicId = event.pathParameters?.clinicId || '';
  if (!pathClinicId) return http(400, { error: 'Missing clinicId in path' });

  const groups = getGroupsFromClaims((event.requestContext as any)?.authorizer?.claims);
  const isMemberOfClinic = groups.some((g) => g.startsWith(`clinic_${pathClinicId}__`));
  if (!isGlobalSuperAdmin(groups) && !isMemberOfClinic) return http(403, { error: 'Forbidden' });

  const body = parseBody(event.body);
  const query = event.queryStringParameters || {};
  const clinicId = pathClinicId;
  const patNum = String(body.PatNum || (event.queryStringParameters || {}).PatNum || '').trim();
  const templateName = String(body.templateMessage || body.template_name || '').trim();
  const notificationTypes: string[] = Array.isArray(body.notificationTypes) ? body.notificationTypes : [];
  const fname = String(body.FName || '').trim();
  const lname = String(body.LName || '').trim();
  const sentBy = String(body.sent_by || 'system');

  // Custom content (optional). If provided, overrides template.
  const customEmailSubjectRaw = String(body.customEmailSubject || body.emailSubject || '').trim();
  const customEmailHtmlRaw = String(body.customEmailHtml || body.emailBodyHtml || body.email_body || '').trim();
  const customEmailTextRaw = String(body.customEmailText || body.emailBodyText || '').trim();
  const customSmsTextRaw = String(body.customSmsText || body.textMessage || '').trim();

  const overrideEmailRaw = String(body.toEmail || body.email || body.to || query.email || '').trim();
  const overridePhoneRaw = String(
    body.toPhone || body.phone || body.phoneNumber || body.sms || body.SMS ||
    query.phone || query.sms || ''
  ).trim();

  if (!patNum || notificationTypes.length === 0) {
    return http(400, { error: 'PatNum and notificationTypes are required' });
  }

  // Load template
  let template: any = null;
  if (templateName) {
    template = await fetchTemplateByName(templateName);
    if (!template && !customEmailHtmlRaw && !customSmsTextRaw && !customEmailSubjectRaw && !customEmailTextRaw) {
      return http(400, { error: `Template not found: ${templateName}` });
    }
  }

  // Resolve recipient email/phone from Open Dental patients (unless overridden)
  const contact = await fetchPatientContact(clinicId, patNum);
  if (!contact.email && !contact.phone) {
    return http(400, { error: 'No email or phone found for patient' });
  }

  const results: any = { email: null, sms: null };
  const clinicCtx = buildClinicContext(clinicId);
  const mergedCtx = { ...clinicCtx, FName: fname, LName: lname } as Record<string, string>;

  if (notificationTypes.includes('EMAIL')) {
    const toEmail = (overrideEmailRaw || contact.email || '').trim();
    if (!toEmail || !toEmail.includes('@')) return http(400, { error: 'No email found for patient' });
    const subjectStr = renderTemplateString(customEmailSubjectRaw || String(template?.email_subject || 'Notification'), mergedCtx);
    const htmlStr = renderTemplateString(customEmailHtmlRaw || String(template?.email_body || ''), mergedCtx);
    const textAltStr = renderTemplateString(customEmailTextRaw || (htmlStr ? htmlStr.replace(/<[^>]+>/g, ' ') : ''), mergedCtx);
    if (!htmlStr && !textAltStr) return http(400, { error: 'No email content provided (template or custom)' });
    await sendEmail({ clinicId, to: toEmail, subject: subjectStr, html: htmlStr, text: textAltStr });
    results.email = toEmail;
  }
  if (notificationTypes.includes('SMS')) {
    const toPhoneRaw = (overridePhoneRaw || contact.phone || '').trim();
    const toPhone = normalizePhone(toPhoneRaw);
    if (!toPhone) return http(400, { error: 'No phone found for patient' });
    const smsBody = renderTemplateString(customSmsTextRaw || String(template?.text_message || ''), mergedCtx);
    if (!smsBody) return http(400, { error: 'No SMS content provided (template or custom)' });
    await sendSms({ clinicId, to: toPhone, body: smsBody });
    results.sms = toPhone;
  }

  return http(200, { success: true, sent: results, clinicId, patNum, template: templateName, sent_by: sentBy });
};

async function fetchTemplateByName(templateName: string): Promise<any | null> {
  const res = await ddb.send(new ScanCommand({ TableName: TEMPLATES_TABLE }));
  const items = (res.Items || []) as any[];
  return items.find((t) => String(t.template_name).toLowerCase() === String(templateName).toLowerCase()) || null;
}

function renderEmailHtml(template: any, ctx: Record<string, string>): string {
  const html = String(template.email_body || '');
  return renderTemplateString(html, ctx);
}

function renderText(text: string, ctx: Record<string, string>): string {
  return renderTemplateString(String(text || ''), ctx);
}

function buildClinicContext(clinicId: string): Record<string, string> {
  const clinic = (clinicsData as any[]).find((c) => String(c.clinicId) === String(clinicId)) || {};
  const ctx: Record<string, string> = {};
  for (const [k, v] of Object.entries(clinic)) {
    if (v === undefined || v === null) continue;
    ctx[String(k)] = String(v);
  }
  return ctx;
}

function renderTemplateString(tpl: string, ctx: Record<string, string>): string {
  let out = tpl;
  // Support both {{Key}} and {Key}
  for (const [key, value] of Object.entries(ctx)) {
    const safe = String(value);
    const re1 = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, 'g');
    const re2 = new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g');
    out = out.replace(re1, safe).replace(re2, safe);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

async function fetchPatientContact(clinicId: string, patNum: string): Promise<{ email?: string; phone?: string }> {
  const creds = CLINIC_CREDS[clinicId];
  if (!creds) return {};
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';
  const path = `${API_BASE}/patients/Simple?PatNum=${encodeURIComponent(patNum)}`;
  const headers = { Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`, 'Content-Type': 'application/json' };
  const resp = await httpRequest({ hostname: API_HOST, path, method: 'GET', headers });
  let body: any;
  try { body = JSON.parse(resp.body); } catch { body = resp.body; }
  let row: any;
  if (Array.isArray(body)) {
    row = body.find((r: any) => String(r?.PatNum ?? r?.patNum ?? '') === String(patNum)) || body[0] || {};
  } else {
    row = body || {};
  }
  return extractEmailAndPhone(row);
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

function extractEmailAndPhone(row: any): { email?: string; phone?: string } {
  // Prefer explicit patient fields first (based on Open Dental Simple patient fields)
  const preferredEmailFields = [
    'Email', 'email', 'EmailAddress', 'emailAddress', 'PatientEmail', 'patientEmail'
  ];
  const preferredPhoneFields = [
    'WirelessPhone', 'CellPhone', 'MobilePhone', 'Mobile', 'Cell', 'HmPhone', 'HomePhone', 'WkPhone', 'WorkPhone', 'Phone'
  ];

  let email: string | undefined;
  for (const field of preferredEmailFields) {
    const value = row?.[field];
    const str = String(value || '').trim();
    if (str && /@/.test(str)) { email = str; break; }
  }

  let phone: string | undefined;
  for (const field of preferredPhoneFields) {
    const value = row?.[field];
    const normalized = normalizePhone(String(value || ''));
    if (normalized) { phone = normalized; break; }
  }

  // Fallback: cautious scan across keys, but avoid clinic/practice email fields
  if (!email) {
    for (const [k, v] of Object.entries(row || {})) {
      const key = String(k).toLowerCase();
      if (key.includes('clinic') || key.includes('practice')) continue;
      if (!/email/.test(key)) continue;
      const val = String(v || '').trim();
      if (/@/.test(val)) { email = val; break; }
    }
  }

  if (!phone) {
    for (const [k, v] of Object.entries(row || {})) {
      const key = String(k).toLowerCase();
      if (!/(wireless|mobile|cell|phone|hmphone|wkphone|home|work)/.test(key)) continue;
      const normalized = normalizePhone(String(v || ''));
      if (normalized) { phone = normalized; break; }
    }
  }

  return { email, phone };
}

function normalizePhone(p: string): string | undefined {
  const digits = (p || '').replace(/[^\d\+]/g, '');
  if (digits.startsWith('+')) return digits;
  const only = digits.replace(/\D/g, '');
  if (only.length === 10) return `+1${only}`;
  if (only.length === 11 && only.startsWith('1')) return `+${only}`;
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
    Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html }, Text: { Data: text || html.replace(/<[^>]+>/g, ' ') } } } },
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



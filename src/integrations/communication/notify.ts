import https from 'https';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { SYSTEM_MODULES } from '../../shared/types/user';
import clinicsData from '../../infrastructure/configs/clinics.json';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

// Validate required environment variables
const REQUIRED_ENV_VARS = ['TEMPLATES_TABLE', 'NOTIFICATIONS_TABLE'] as const;
const ENV_VARS = REQUIRED_ENV_VARS.reduce((acc, key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return { ...acc, [key]: value };
}, {} as Record<typeof REQUIRED_ENV_VARS[number], string>);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});
const sms = new (PinpointSMSVoiceV2Client as any)({});

type ClinicCreds = {
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir?: string;
};

// Build clinic credentials from imported clinic data to avoid large env vars
const CLINIC_CREDS: Record<string, ClinicCreds> = (() => {
  const acc: Record<string, ClinicCreds> = {};
  (clinicsData as any[]).forEach((c: any) => {
    acc[String(c.clinicId)] = {
      developerKey: c.developerKey,
      customerKey: c.customerKey,
      sftpHost: '', // Not used in notification function
      sftpPort: 22,
      sftpUsername: '',
      sftpPassword: '',
    };
  });
  return acc;
})();

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

const CLINIC_EMAIL_MAP: Record<string, string> = (() => {
  const acc: Record<string, string> = {};
  (clinicsData as any[]).forEach((c: any) => {
    if (c.clinicEmail) acc[String(c.clinicId)] = String(c.clinicEmail);
  });
  return acc;
})();

/**
 * Get user's clinic roles and permissions from custom authorizer
 */
const getUserPermissions = (event: APIGatewayProxyEvent) => {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer) return null;

  try {
    const clinicRoles = JSON.parse(authorizer.clinicRoles || '[]');
    const isSuperAdmin = authorizer.isSuperAdmin === 'true';
    const isGlobalSuperAdmin = authorizer.isGlobalSuperAdmin === 'true';
    const email = authorizer.email || '';

    return {
      email,
      clinicRoles,
      isSuperAdmin,
      isGlobalSuperAdmin,
    };
  } catch (err) {
    console.error('Failed to parse user permissions:', err);
    return null;
  }
};

/**
 * Check if user has admin role (Admin, SuperAdmin, or Global Super Admin)
 */
const isAdminUser = (
  clinicRoles: any[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): boolean => {
  // Check flags first
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return true;
  }

  // Check if user has Admin or SuperAdmin role at any clinic
  for (const cr of clinicRoles) {
    if (cr.role === 'Admin' || cr.role === 'SuperAdmin' || cr.role === 'Global super admin') {
      return true;
    }
  }

  return false;
};

/**
 * Check if user has specific permission for a module at ANY clinic
 */
const hasModulePermission = (
  clinicRoles: any[],
  module: string,
  permission: 'read' | 'write' | 'put' | 'delete',
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean,
  clinicId?: string
): boolean => {
  // Admin, SuperAdmin, and Global Super Admin have all permissions for all modules
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }

  // Check if user has the permission for this module at any clinic (or specific clinic)
  for (const cr of clinicRoles) {
    // If clinicId is specified, check only that clinic
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }

    const moduleAccess = cr.moduleAccess?.find((ma: any) => ma.module === module);
    if (moduleAccess && moduleAccess.permissions.includes(permission)) {
      return true;
    }
  }

  return false;
};

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

function http(code: number, body: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return { statusCode: code, headers: getCorsHeaders(event), body: JSON.stringify(body) };
}

function parseBody(body: any): Record<string, any> { try { return typeof body === 'string' ? JSON.parse(body) : (body || {}); } catch { return {}; } }




async function processNotification(event: APIGatewayProxyEvent, body: any, clinicId: string, sentBy: string): Promise<APIGatewayProxyResult> {
  // Normalize and validate input fields
  const input = {
    patNum: String(body.PatNum || '').trim(),
    templateName: String(body.templateMessage || body.template_name || '').trim(),
    notificationTypes: Array.isArray(body.notificationTypes) ? body.notificationTypes : [],
    firstName: String(body.firstName || body.FName || '').trim(),
    lastName: String(body.lastName || body.LName || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    phone: String(body.phone || '').trim().replace(/[^0-9+]/g, '')
  };

  // Validation errors array
  const errors: string[] = [];

  // Required field validation
  if (!input.patNum) errors.push('PatNum is required');
  if (input.notificationTypes.length === 0) errors.push('At least one notification type is required');
  if (!input.templateName) errors.push('templateMessage is required');

  // Format validation
  if (input.notificationTypes.includes('EMAIL') && input.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input.email)) errors.push('Invalid email format');
  }
  
  if (input.notificationTypes.includes('SMS') && input.phone) {
    if (input.phone.length < 10) errors.push('Invalid phone number format');
  }

  // Return all validation errors at once
  if (errors.length > 0) {
    return http(400, { errors }, event);
  }

  // Add your notification sending logic here
  // This is where you would call your notification service

  return http(200, {
    message: 'Notification sent successfully',
    clinicId: clinicId,
    patNum: input.patNum,
    sentBy: sentBy,
    notificationTypes: input.notificationTypes,
    templateName: input.templateName,
    recipient: { 
      firstName: input.firstName, 
      lastName: input.lastName,
      email: input.email,
      phone: input.phone
    }
  }, event);
}

async function handleSendNotification(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  const pathClinicId = event.pathParameters?.clinicId;
  if (!pathClinicId) return http(400, { error: 'Missing clinicId in path' }, event);

  // Check if user has write permission for Marketing module at this clinic
  if (!hasModulePermission(
    userPerms.clinicRoles,
    'Marketing',
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    pathClinicId
  )) {
    return http(403, { error: 'You do not have permission to send notifications for this clinic' }, event);
  }

  // Use the user's email as the sender identifier
  const sentBy = userPerms.email || 'authenticated_user';

  const body = parseBody(event.body);
  const clinicId = pathClinicId;
  const patNum = String(body.PatNum || '').trim();
  const templateMessage = String(body.templateMessage || '').trim();
  const notificationTypes = Array.isArray(body.notificationTypes) ? body.notificationTypes : ['EMAIL'];
  const fname = String(body.FName || '').trim();
  const lname = String(body.LName || '').trim();
  const email = String(body.email || body.toEmail || body.Email || '').trim();

  // Validate required fields
  if (!patNum) return http(400, { error: 'PatNum is required' }, event);

  if (notificationTypes.includes('EMAIL') && (!email || !email.includes('@'))) {
    return http(400, { error: 'Valid email is required for EMAIL notification type' }, event);
  }

  // Load template if provided
  let template: any = null;
  if (templateMessage) {
    template = await fetchTemplateByName(templateMessage);
    if (!template) {
      return http(400, { error: `Template not found: ${templateMessage}` }, event);
    }
  }

  const results: any = { email: null, sms: null };
  const clinicCtx = buildClinicContext(clinicId);
  const mergedCtx = { ...clinicCtx, FName: fname, LName: lname } as Record<string, string>;

  if (notificationTypes.includes('EMAIL')) {
    try {
      const subjectStr = template ? renderTemplateString(String(template.email_subject || 'Notification'), mergedCtx) : 'Notification';
      const htmlStr = template ? renderTemplateString(String(template.email_body || ''), mergedCtx) : '';
      const textAltStr = htmlStr ? htmlStr.replace(/<[^>]+>/g, ' ') : '';

      await sendEmail({ clinicId, to: email, subject: subjectStr, html: htmlStr || textAltStr, text: textAltStr || htmlStr });

      results.email = email;

      // Store notification in DynamoDB
      await storeNotification({
        patNum,
        clinicId,
        type: 'EMAIL',
        email: email,
        subject: subjectStr,
        message: htmlStr || textAltStr,
        templateName: templateMessage,
        sentBy,
        status: 'SENT'
      });
    } catch (error) {
      console.error('Failed to send email:', error);
      await storeNotification({
        patNum,
        clinicId,
        type: 'EMAIL',
        email: email,
        templateName: templateMessage,
        sentBy,
        status: 'FAILED'
      });
      return http(500, { error: 'Failed to send email notification' }, event);
    }
  }

  if (notificationTypes.includes('SMS')) {
    const phoneRaw = String(body.toPhone || body.phone || body.phoneNumber || body.SMS || '').trim();
    const normalizedPhone = normalizePhone(phoneRaw);
    if (!normalizedPhone) return http(400, { error: 'No phone provided for SMS' }, event);
    const smsBody = template ? renderTemplateString(String(template.text_message || ''), mergedCtx) : (body.textMessage || body.customSmsText || '');
    if (!smsBody) return http(400, { error: 'No SMS content provided (template or custom)' }, event);

    try {
      await sendSms({ clinicId, to: normalizedPhone, body: smsBody });
      results.sms = normalizedPhone;
      await storeNotification({
        patNum,
        clinicId,
        type: 'SMS',
        phone: normalizedPhone,
        message: smsBody,
        templateName: templateMessage,
        sentBy,
        status: 'SENT'
      });
    } catch (error) {
      console.error('Failed to send SMS:', error);
      await storeNotification({
        patNum,
        clinicId,
        type: 'SMS',
        phone: normalizedPhone,
        message: smsBody,
        templateName: templateMessage,
        sentBy,
        status: 'FAILED'
      });
      return http(500, { error: 'Failed to send SMS notification' }, event);
    }
  }

  return http(200, { success: true, sent: results, clinicId, patNum, template: templateMessage, sent_by: sentBy }, event);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Debug: log authorizer context at the handler entry to diagnose missing authorizer on some requests
  try {
    // eslint-disable-next-line no-console
    console.log('[NotifyHandler] requestContext.authorizer:', JSON.stringify((event.requestContext as any)?.authorizer || {}));
  } catch (err) { /* ignore logging errors */ }

  if (event.httpMethod === 'OPTIONS') return http(200, { ok: true }, event);

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return http(401, { error: 'Unauthorized - Invalid token' }, event);
  }

  // Check if user has access to Marketing module for read operations
  if (!hasModulePermission(
    userPerms.clinicRoles,
    'Marketing',
    'read',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return http(403, { error: 'You do not have permission to access notifications in the Marketing module' }, event);
  }

  const path = event.path || '';
  const isGetNotifications = path.endsWith('/notifications/notifications');

  if (event.httpMethod === 'GET' && isGetNotifications) {
    return await handleGetNotifications(event, userPerms);
  }

  const isClinicNotification = path.match(/\/clinic\/([^\/]+)\/notification$/);
  if (event.httpMethod === 'POST' && isClinicNotification) {
    return await handleSendNotification(event, userPerms);
  }

  return http(405, { error: 'Method Not Allowed' }, event);
}

async function handleGetNotifications(event: APIGatewayProxyEvent, userPerms: any): Promise<APIGatewayProxyResult> {
  // Debug: log whether authorizer claims are present for GET
  try {
    // eslint-disable-next-line no-console
    console.log('[handleGetNotifications] userPerms:', JSON.stringify(userPerms || {}));
  } catch (err) { /* ignore logging errors */ }

  const query = event.queryStringParameters || {};
  const patNum = String(query.PatNum || '').trim();
  const email = String(query.email || '').trim();
  const clinicId = String(query.clinicId || '').trim();

  if (!patNum) {
    return http(400, { error: 'PatNum query parameter is required' }, event);
  }

  // Check if user has any clinic access or is admin
  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const authorizedClinics = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
  const hasClinicAccess = authorizedClinics.length > 0 || isAdmin;

  if (!hasClinicAccess) {
    return http(403, { error: 'Forbidden: no clinic access' }, event);
  }

  // Validate clinic access if specific clinicId is specified
  if (clinicId && !isAdmin) {
    if (!authorizedClinics.includes(clinicId)) {
      return http(403, { error: 'Forbidden: not authorized for this clinic' }, event);
    }
  }

  let notifications: any[] = [];

  if (clinicId) {
    // Query specific clinic notifications
    notifications = await getNotificationsForPatient(patNum, email, clinicId);
  } else if (isAdmin) {
    // Admin: query all clinics
    notifications = await getNotificationsForPatient(patNum, email);
  } else {
    // Regular user: query only clinics they have access to
    // Query notifications for all authorized clinics
    const clinicPromises = authorizedClinics.map((clinic: string) =>
      getNotificationsForPatient(patNum, email, clinic)
    );
    const clinicResults = await Promise.all(clinicPromises);
    notifications = clinicResults.flat();
  }

  return http(200, {
    success: true,
    patNum,
    email,
    clinicId: clinicId || null,
    notifications,
    total: notifications.length
  }, event);
}

async function fetchTemplateByName(templateName: string): Promise<any | null> {
  const res = await ddb.send(new ScanCommand({ TableName: ENV_VARS.TEMPLATES_TABLE }));
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

function normalizePhone(p: string): string | undefined {
  const s = String(p || '').trim();
  if (!s) return undefined;
  // keep leading + if present, but strip other non-digits
  const cleaned = s.replace(/[^0-9+]/g, '');

  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    if (digits.length < 7) return undefined;
    return `+${digits}`;
  }

  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 7) return `+${digits}`; // best-effort
  return undefined;
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

async function sendEmail({ clinicId, to, subject, html, text }: { clinicId: string; to: string; subject: string; html: string; text?: string; }) {
  const identityArn = CLINIC_SES_IDENTITY_ARN_MAP[clinicId];
  if (!identityArn) return;
  
  // Use the clinic's verified email address instead of no-reply
  const clinicEmail = CLINIC_EMAIL_MAP[clinicId];
  let from: string;
  
  if (!clinicEmail) {
    // Fallback to no-reply if clinic email is not found
    const fromDomain = identityArn.split(':identity/')[1] || 'todaysdentalinsights.com';
    from = `no-reply@${fromDomain}`;
  } else {
    from = clinicEmail;
  }
  
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

async function storeNotification(notification: {
  patNum: string;
  clinicId: string;
  type: 'EMAIL' | 'SMS';
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  templateName?: string;
  sentBy: string;
  status: 'SENT' | 'FAILED';
}): Promise<void> {
  const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE;
  if (!NOTIFICATIONS_TABLE) return;

  const notificationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const item = {
    PatNum: notification.patNum,
    notificationId,
    clinicId: notification.clinicId,
    type: notification.type,
    email: notification.email,
    phone: notification.phone,
    subject: notification.subject,
    message: notification.message,
    templateName: notification.templateName,
    sentBy: notification.sentBy,
    sentAt: new Date().toISOString(),
    status: notification.status
  };

  try {
    await ddb.send(new PutCommand({
      TableName: ENV_VARS.NOTIFICATIONS_TABLE,
      Item: item
    }));
  } catch (err) {
    console.error('Error storing notification:', err);
    throw new Error(`Failed to store notification: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function getNotificationsForPatient(patNum: string, email?: string, clinicId?: string): Promise<any[]> {
  try {
    let items: any[] = [];

    if (clinicId) {
      // Query specific clinic notifications using QueryCommand for better performance
      const queryParams: any = {
        TableName: ENV_VARS.NOTIFICATIONS_TABLE,
        KeyConditionExpression: 'PatNum = :patNum',
        ExpressionAttributeValues: {
          ':patNum': patNum
        }
      };

      // Add clinic filter if provided
      queryParams.FilterExpression = 'clinicId = :clinicId';
      queryParams.ExpressionAttributeValues[':clinicId'] = clinicId;

      const res = await ddb.send(new QueryCommand(queryParams));
      items = res.Items || [];
      items = res.Items || [];
    } else {
      // For super admins or when querying all clinics, use ScanCommand
      const res = await ddb.send(new ScanCommand({
        TableName: ENV_VARS.NOTIFICATIONS_TABLE,
        FilterExpression: 'PatNum = :patNum',
        ExpressionAttributeValues: { ':patNum': patNum }
      }));
      items = res.Items || [];
    }

    // Optionally filter by email if provided
    if (email) {
      items = items.filter((n: any) => String(n.email || '').toLowerCase() === email.toLowerCase());
    }

    return items;
  } catch (err) {
    console.error('Error querying notifications:', err);
    return [];
  }
}



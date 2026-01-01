import https from 'https';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  isAdminUser,
  getAllowedClinicIds,
  hasClinicAccess,
  PermissionType,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { 
  getClinicConfig, 
  getAllClinicConfigs, 
  ClinicConfig 
} from '../../shared/utils/secrets-helper';
import { renderTemplate, buildTemplateContext } from '../../shared/utils/clinic-placeholders';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import {
  isUnsubscribed,
  generateUnsubscribeLink,
  generateEmailUnsubscribeFooter,
  generateSmsUnsubscribeText,
  generateListUnsubscribeHeader,
  CommunicationChannel,
} from '../../services/shared/unsubscribe';

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

// Clinic lookup helpers - fetch from DynamoDB via secrets-helper
async function getClinicSesIdentityArn(clinicId: string): Promise<string | undefined> {
  const config = await getClinicConfig(clinicId);
  return config?.sesIdentityArn;
}

async function getClinicSmsOriginationArn(clinicId: string): Promise<string | undefined> {
  const config = await getClinicConfig(clinicId);
  return config?.smsOriginationArn;
}

async function getClinicEmail(clinicId: string): Promise<string | undefined> {
  const config = await getClinicConfig(clinicId);
  return config?.clinicEmail;
}

async function getClinicName(clinicId: string): Promise<string> {
  const config = await getClinicConfig(clinicId);
  return config?.clinicName || 'Dental Clinic';
}

// Unsubscribe configuration
const UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE || '';
const UNSUBSCRIBE_BASE_URL = process.env.UNSUBSCRIBE_BASE_URL || 'https://apig.todaysdentalinsights.com/notifications';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);
const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

function http(code: number, body: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return { statusCode: code, headers: getCorsHeaders(event), body: payload };
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
    phone: String(body.phone || '').trim().replace(/[^0-9+]/g, ''),
    // Custom content fields
    customEmailSubject: String(body.customEmailSubject || '').trim(),
    customEmailHtml: String(body.customEmailHtml || body.customEmailBody || '').trim(),
    customSmsText: String(body.customSmsText || body.textMessage || '').trim()
  };

  // Determine if using custom content
  const hasCustomEmail = !!input.customEmailSubject || !!input.customEmailHtml;
  const hasCustomSms = !!input.customSmsText;
  const hasTemplateOrCustom = !!input.templateName || hasCustomEmail || hasCustomSms;

  // Validation errors array
  const errors: string[] = [];

  // Required field validation
  if (!input.patNum) errors.push('PatNum is required');
  if (input.notificationTypes.length === 0) errors.push('At least one notification type is required');
  
  // Validate content - either template or custom content is required
  if (!hasTemplateOrCustom) {
    errors.push('Either templateMessage or custom content (customEmailSubject/customEmailHtml/customSmsText) is required');
  }

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
    templateName: input.templateName || 'custom',
    recipient: { 
      firstName: input.firstName, 
      lastName: input.lastName,
      email: input.email,
      phone: input.phone
    }
  }, event);
}

async function handleSendNotification(event: APIGatewayProxyEvent, userPerms: UserPermissions, allowedClinics: Set<string>): Promise<APIGatewayProxyResult> {
  const pathClinicId = event.pathParameters?.clinicId;
  if (!pathClinicId) return http(400, { error: 'Missing clinicId in path' }, event);

  if (!hasClinicAccess(allowedClinics, pathClinicId)) {
    return http(403, { error: 'Forbidden: no access to this clinic' }, event);
  }

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

  // Custom content fields (when not using a template)
  const customEmailSubject = String(body.customEmailSubject || '').trim();
  const customEmailHtml = String(body.customEmailHtml || body.customEmailBody || '').trim();
  const customSmsText = String(body.customSmsText || body.textMessage || '').trim();

  // Validate required fields
  if (!patNum) return http(400, { error: 'PatNum is required' }, event);

  if (notificationTypes.includes('EMAIL') && (!email || !email.includes('@'))) {
    return http(400, { error: 'Valid email is required for EMAIL notification type' }, event);
  }

  // Determine if we're using template or custom content
  const isCustomEmail = !templateMessage && (!!customEmailSubject || !!customEmailHtml);
  const isCustomSms = !templateMessage && !!customSmsText;

  // Load template if provided (only when not using custom content)
  let template: any = null;
  if (templateMessage) {
    template = await fetchTemplateByName(templateMessage);
    if (!template) {
      return http(400, { error: `Template not found: ${templateMessage}` }, event);
    }
  }

  // Validate that we have content for the requested notification types
  if (notificationTypes.includes('EMAIL') && !template && !isCustomEmail) {
    return http(400, { error: 'Either templateMessage or custom email content (customEmailSubject/customEmailHtml) is required for EMAIL' }, event);
  }
  if (notificationTypes.includes('SMS') && !template && !isCustomSms) {
    return http(400, { error: 'Either templateMessage or customSmsText is required for SMS' }, event);
  }

  const results: any = { email: null, sms: null, skipped: [] };
  // Build template context with patient data - supports {patient_name}, {first_name}, {last_name}, {FName}, {LName}
  const mergedCtx = await buildTemplateContext(clinicId, { FName: fname, LName: lname });

  if (notificationTypes.includes('EMAIL')) {
    // Check if recipient has unsubscribed from email
    const emailUnsubscribed = UNSUBSCRIBE_TABLE ? await isUnsubscribed(
      ddb,
      UNSUBSCRIBE_TABLE,
      { patientId: patNum, email },
      clinicId,
      'EMAIL'
    ) : false;

    if (emailUnsubscribed) {
      console.log(`Skipping EMAIL for patient ${patNum} - unsubscribed`);
      results.skipped.push({ channel: 'EMAIL', reason: 'unsubscribed' });
      await storeNotification({
        patNum,
        clinicId,
        type: 'EMAIL',
        email: email,
        templateName: templateMessage || 'custom',
        sentBy,
        status: 'SKIPPED_UNSUBSCRIBED'
      });
    } else {
      try {
        // Use custom content if provided, otherwise use template
        let subjectStr: string;
        let htmlStr: string;

        if (isCustomEmail) {
          // Use custom email content - apply template rendering for placeholders
          subjectStr = renderTemplateString(customEmailSubject || 'Notification', mergedCtx);
          htmlStr = renderTemplateString(customEmailHtml, mergedCtx);
        } else {
          // Use template content
          subjectStr = template ? renderTemplateString(String(template.email_subject || 'Notification'), mergedCtx) : 'Notification';
          htmlStr = template ? renderTemplateString(String(template.email_body || ''), mergedCtx) : '';
        }

        const textAltStr = htmlStr ? htmlStr.replace(/<[^>]+>/g, ' ') : '';

        // Generate unsubscribe link and add footer to email
        const unsubscribeLink = generateUnsubscribeLink(UNSUBSCRIBE_BASE_URL, {
          patientId: patNum,
          email,
          clinicId,
          channel: 'EMAIL',
        });
        const clinicName = await getClinicName(clinicId);
        const unsubscribeFooter = generateEmailUnsubscribeFooter(unsubscribeLink, clinicName);
        htmlStr = htmlStr + unsubscribeFooter;

        await sendEmail({ 
          clinicId, 
          to: email, 
          subject: subjectStr, 
          html: htmlStr || textAltStr, 
          text: textAltStr || htmlStr,
          patNum,
          templateName: templateMessage || 'custom',
          sentBy,
          unsubscribeLink,
        });

        results.email = email;

        // Store notification in DynamoDB
        await storeNotification({
          patNum,
          clinicId,
          type: 'EMAIL',
          email: email,
          subject: subjectStr,
          message: htmlStr || textAltStr,
          templateName: templateMessage || 'custom',
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
          templateName: templateMessage || 'custom',
          sentBy,
          status: 'FAILED'
        });
        return http(500, { error: 'Failed to send email notification' }, event);
      }
    }
  }

  if (notificationTypes.includes('SMS')) {
    const phoneRaw = String(body.toPhone || body.phone || body.phoneNumber || body.SMS || '').trim();
    const normalizedPhone = normalizePhone(phoneRaw);
    if (!normalizedPhone) return http(400, { error: 'No phone provided for SMS' }, event);

    // Check if recipient has unsubscribed from SMS
    const smsUnsubscribed = UNSUBSCRIBE_TABLE ? await isUnsubscribed(
      ddb,
      UNSUBSCRIBE_TABLE,
      { patientId: patNum, phone: normalizedPhone },
      clinicId,
      'SMS'
    ) : false;

    if (smsUnsubscribed) {
      console.log(`Skipping SMS for patient ${patNum} - unsubscribed`);
      results.skipped.push({ channel: 'SMS', reason: 'unsubscribed' });
      await storeNotification({
        patNum,
        clinicId,
        type: 'SMS',
        phone: normalizedPhone,
        templateName: templateMessage || 'custom',
        sentBy,
        status: 'SKIPPED_UNSUBSCRIBED'
      });
    } else {
      // Use custom SMS content if provided, otherwise use template
      let smsBody: string;
      if (isCustomSms) {
        // Use custom SMS content - apply template rendering for placeholders
        smsBody = renderTemplateString(customSmsText, mergedCtx);
      } else {
        // Use template content
        smsBody = template ? renderTemplateString(String(template.text_message || ''), mergedCtx) : '';
      }

      if (!smsBody) return http(400, { error: 'No SMS content provided (template or custom)' }, event);

      // Add unsubscribe text to SMS (Reply STOP to unsubscribe)
      smsBody = smsBody + generateSmsUnsubscribeText();

      try {
        await sendSms({ clinicId, to: normalizedPhone, body: smsBody });
        results.sms = normalizedPhone;
        await storeNotification({
          patNum,
          clinicId,
          type: 'SMS',
          phone: normalizedPhone,
          message: smsBody,
          templateName: templateMessage || 'custom',
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
          templateName: templateMessage || 'custom',
          sentBy,
          status: 'FAILED'
        });
        return http(500, { error: 'Failed to send SMS notification' }, event);
      }
    }
  }

  return http(200, { success: true, sent: results, clinicId, patNum, template: templateMessage || 'custom', sent_by: sentBy }, event);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Debug: log authorizer context at the handler entry to diagnose missing authorizer on some requests
  try {
    // eslint-disable-next-line no-console
    console.log('[NotifyHandler] requestContext.authorizer:', JSON.stringify((event.requestContext as any)?.authorizer || {}));
  } catch (err) { /* ignore logging errors */ }

  if (event.httpMethod === 'OPTIONS') return http(204, '', event);

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return http(401, { error: 'Unauthorized - Invalid token' }, event);
  }

  const requiredPermission: PermissionType = METHOD_PERMISSIONS[event.httpMethod] || 'read';
  if (!hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return http(403, { error: `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module` }, event);
  }

  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin) || allowedClinics.has('*');

  const path = event.path || '';
  const isGetNotifications = path.endsWith('/notifications/notifications');

  if (event.httpMethod === 'GET' && isGetNotifications) {
    return await handleGetNotifications(event, userPerms, allowedClinics, isAdmin);
  }

  const isClinicNotification = path.match(/\/clinic\/([^\/]+)\/notification$/);
  if (event.httpMethod === 'POST' && isClinicNotification) {
    return await handleSendNotification(event, userPerms, allowedClinics);
  }

  return http(405, { error: 'Method Not Allowed' }, event);
}

async function handleGetNotifications(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  allowedClinics: Set<string>,
  isAdmin: boolean
): Promise<APIGatewayProxyResult> {
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

  const hasAccess = allowedClinics.size > 0 || isAdmin;
  if (!hasAccess) return http(403, { error: 'Forbidden: no clinic access' }, event);
  if (clinicId && !isAdmin && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'Forbidden: not authorized for this clinic' }, event);
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
    const clinicList = Array.from(allowedClinics);
    const clinicPromises = clinicList.map((clinic: string) => getNotificationsForPatient(patNum, email, clinic));
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

/**
 * Render a template string by replacing placeholders with values.
 * Supports both {{placeholder}} and {placeholder} syntax.
 */
function renderTemplateString(tpl: string, ctx: Record<string, string>): string {
  return renderTemplate(tpl, ctx);
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
  const { getClinicSecrets } = await import('../../shared/utils/secrets-helper');
  const secrets = await getClinicSecrets(clinicId);
  if (!secrets) return {};
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';
  const path = `${API_BASE}/patients/Simple?PatNum=${encodeURIComponent(patNum)}`;
  const headers = { Authorization: `ODFHIR ${secrets.openDentalDeveloperKey}/${secrets.openDentalCustomerKey}`, 'Content-Type': 'application/json' };
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

interface SendEmailOptions {
  clinicId: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  patNum?: string;
  templateName?: string;
  sentBy?: string;
  unsubscribeLink?: string;
}

interface SendEmailResult {
  messageId?: string;
  success: boolean;
}

async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { clinicId, to, subject, html, text, patNum, templateName, sentBy, unsubscribeLink } = options;
  const identityArn = await getClinicSesIdentityArn(clinicId);
  if (!identityArn) return { success: false };
  
  // Use the clinic's verified email address instead of no-reply
  const clinicEmail = await getClinicEmail(clinicId);
  let from: string;
  
  if (!clinicEmail) {
    // Fallback to no-reply if clinic email is not found
    const fromDomain = identityArn.split(':identity/')[1] || 'todaysdentalinsights.com';
    from = `no-reply@${fromDomain}`;
  } else {
    from = clinicEmail;
  }
  
  const configurationSetName = process.env.SES_CONFIGURATION_SET_NAME;

  // Generate List-Unsubscribe headers if unsubscribe link is provided
  const listUnsubscribeHeaders: Record<string, string> = {};
  if (unsubscribeLink && clinicEmail) {
    const { listUnsubscribe, listUnsubscribePost } = generateListUnsubscribeHeader(unsubscribeLink, clinicEmail);
    listUnsubscribeHeaders['List-Unsubscribe'] = listUnsubscribe;
    listUnsubscribeHeaders['List-Unsubscribe-Post'] = listUnsubscribePost;
  }
  
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    FromEmailAddressIdentityArn: identityArn,
    Destination: { ToAddresses: [to] },
    Content: { 
      Simple: { 
        Subject: { Data: subject }, 
        Body: { 
          Html: { Data: html }, 
          Text: { Data: text || html.replace(/<[^>]+>/g, ' ') } 
        },
        // Add List-Unsubscribe headers for RFC 8058 compliance
        Headers: Object.entries(listUnsubscribeHeaders).map(([name, value]) => ({
          Name: name,
          Value: value,
        })),
      } 
    },
    // Add configuration set for event tracking
    ConfigurationSetName: configurationSetName,
    // Add tags for tracking context
    EmailTags: [
      { Name: 'clinicId', Value: clinicId },
      ...(patNum ? [{ Name: 'patNum', Value: patNum }] : []),
      ...(templateName ? [{ Name: 'templateName', Value: templateName }] : []),
    ],
  });
  
  const response = await ses.send(cmd);
  const messageId = response.MessageId;
  
  // Create initial tracking record in email analytics table
  if (messageId) {
    await createEmailTrackingRecord({
      messageId,
      clinicId,
      recipientEmail: to,
      patNum,
      subject,
      templateName,
      sentBy,
    });
  }
  
  return { messageId, success: true };
}

async function createEmailTrackingRecord(record: {
  messageId: string;
  clinicId: string;
  recipientEmail: string;
  patNum?: string;
  subject?: string;
  templateName?: string;
  sentBy?: string;
}): Promise<void> {
  const EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE;
  if (!EMAIL_ANALYTICS_TABLE) return;
  
  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + (365 * 24 * 60 * 60); // 1 year TTL
  
  try {
    await ddb.send(new PutCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Item: {
        messageId: record.messageId,
        clinicId: record.clinicId,
        recipientEmail: record.recipientEmail,
        patNum: record.patNum,
        subject: record.subject,
        templateName: record.templateName,
        sentBy: record.sentBy,
        sentAt: now.toISOString(),
        status: 'QUEUED',
        ttl,
      },
    }));
  } catch (error) {
    console.error('Error creating email tracking record:', error);
    // Don't throw - tracking is secondary to sending
  }
}

async function sendSms({ clinicId, to, body }: { clinicId: string; to: string; body: string; }) {
  const originationArn = await getClinicSmsOriginationArn(clinicId);
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
  status: 'SENT' | 'FAILED' | 'SKIPPED_UNSUBSCRIBED';
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



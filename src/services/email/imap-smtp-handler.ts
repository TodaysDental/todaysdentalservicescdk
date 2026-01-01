/**
 * IMAP/SMTP Email Handler - Fetches emails via IMAP and sends via SMTP
 * 
 * Each clinic has its own:
 * - SMTP user/password (stored in clinics.json)
 * - IMAP host/port settings
 * 
 * Also supports domain-level email (todaysdentalinsights.com) via environment variables:
 * - DOMAIN_SMTP_USER
 * - DOMAIN_SMTP_PASSWORD
 * - DOMAIN_IMAP_HOST
 * - DOMAIN_IMAP_PORT
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as nodemailer from 'nodemailer';
import * as imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { 
  getClinicConfig, 
  getClinicSecrets, 
  getAllClinicConfigs,
  getGlobalSecret,
  ClinicConfig, 
  ClinicSecrets 
} from '../../shared/utils/secrets-helper';
import { getUserPermissions, getAllowedClinicIds, hasClinicAccess } from '../../shared/utils/permissions-helper';

// -------------------- Types --------------------

// Email provider config (used for both gmail and domain)
interface EmailProviderConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
}

// Email type parameter: 'gmail' or 'domain'
type EmailType = 'gmail' | 'domain';

interface EmailResponse {
  uid?: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  text: string;
  error?: string;
  detail?: string;
}

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

interface EmailActionPayload {
  action: 'delete' | 'star' | 'unstar' | 'spam' | 'unspam' | 'archive';
  uid: number;
}

// Standard IMAP folder names (may vary by provider)
type ImapFolder = 'inbox' | 'sent' | 'spam' | 'trash' | 'drafts' | 'starred';

// Mapping to common IMAP mailbox names (provider-specific)
const FOLDER_MAPPINGS: Record<ImapFolder, string[]> = {
  inbox: ['INBOX'],
  sent: ['Sent', '[Gmail]/Sent Mail', 'Sent Items', 'Sent Messages', 'INBOX.Sent'],
  spam: ['Spam', '[Gmail]/Spam', 'Junk', 'Junk E-mail', 'INBOX.Spam', 'INBOX.Junk'],
  trash: ['Trash', '[Gmail]/Trash', 'Deleted Items', 'Deleted Messages', 'INBOX.Trash'],
  drafts: ['Drafts', '[Gmail]/Drafts', 'INBOX.Drafts'],
  starred: ['[Gmail]/Starred', 'Flagged', 'INBOX.Flagged'], // IMAP uses flags for starred
};

// -------------------- Helpers --------------------

// Domain-level email credentials (for todaysdentalinsights.com)
const DOMAIN_SMTP_USER = process.env.DOMAIN_SMTP_USER || '';
const DOMAIN_SMTP_PASSWORD = process.env.DOMAIN_SMTP_PASSWORD || '';
const DOMAIN_IMAP_HOST = process.env.DOMAIN_IMAP_HOST || 'imap.gmail.com';
const DOMAIN_IMAP_PORT = parseInt(process.env.DOMAIN_IMAP_PORT || '993', 10);

// Use getClinicConfig from secrets-helper (imported above)

function normalizeResponse(resp: { statusCode?: number; headers?: Record<string, string>; body?: unknown }): APIGatewayProxyResult {
  const statusCode = resp && typeof resp.statusCode === 'number' ? resp.statusCode : 200;

  const headers = resp?.headers || {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };

  const bodyObj = Object.prototype.hasOwnProperty.call(resp || {}, 'body') ? resp.body : resp;

  return {
    statusCode,
    headers,
    body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj ?? {}),
  };
}

function getLimitFromEvent(event: APIGatewayProxyEvent, def = 50): number {
  const raw = event?.queryStringParameters?.limit;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(500, Math.floor(n)); // Max 500 emails
}

function getDaysFromEvent(event: APIGatewayProxyEvent, def = 7): number {
  const raw = event?.queryStringParameters?.days;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(90, Math.floor(n)); // Max 90 days
}

function getImapDateString(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  // IMAP uses DD-MMM-YYYY format (e.g., "12-Dec-2024")
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function getPostPayload(event: APIGatewayProxyEvent): SendEmailPayload {
  if (typeof event.body === 'string') {
    const trimmed = event.body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }
    return { to: '', subject: '', body: event.body };
  }
  if (event.body && typeof event.body === 'object') {
    return event.body as SendEmailPayload;
  }
  return { to: '', subject: '', body: '' };
}

function getFolderFromEvent(event: APIGatewayProxyEvent): ImapFolder {
  const raw = event?.queryStringParameters?.folder?.toLowerCase();
  if (raw && raw in FOLDER_MAPPINGS) {
    return raw as ImapFolder;
  }
  return 'inbox'; // Default to inbox
}

/**
 * Find the actual mailbox name on the server for a given folder type
 */
async function findMailboxName(connection: imaps.ImapSimple, folder: ImapFolder): Promise<string | null> {
  const possibleNames = FOLDER_MAPPINGS[folder];
  
  try {
    const boxes = await connection.getBoxes();
    const flattenBoxes = (boxes: any, prefix = ''): string[] => {
      const result: string[] = [];
      for (const name of Object.keys(boxes)) {
        const fullName = prefix ? `${prefix}${boxes[name].delimiter || '/'}${name}` : name;
        result.push(fullName);
        if (boxes[name].children) {
          result.push(...flattenBoxes(boxes[name].children, fullName));
        }
      }
      return result;
    };
    
    const allBoxes = flattenBoxes(boxes);
    console.log(`Available mailboxes: ${allBoxes.join(', ')}`);
    
    // Try to find a matching mailbox
    for (const possibleName of possibleNames) {
      const found = allBoxes.find(b => b.toLowerCase() === possibleName.toLowerCase());
      if (found) {
        return found;
      }
    }
    
    // If looking for starred, we'll use INBOX with FLAGGED search
    if (folder === 'starred') {
      return 'INBOX'; // Will use FLAGGED search instead
    }
    
    return null;
  } catch (err) {
    console.error('Error getting mailboxes:', err);
    return null;
  }
}

// -------------------- SMTP: Send Email --------------------

interface SmtpConfig {
  smtpHost: string;      // SMTP server (e.g., smtp.gmail.com)
  smtpPort: number;      // SMTP port (e.g., 587 for TLS, 465 for SSL)
  smtpUser: string;      // Gmail account for authentication
  smtpPassword: string;  // App Password
  fromEmail?: string;    // Display "From" address (defaults to smtpUser)
  fromName?: string;     // Display name
}

async function handleSendEmail(
  config: SmtpConfig,
  payload: SendEmailPayload
): Promise<{ statusCode: number; body: { message: string; info?: string } }> {
  const { smtpHost, smtpPort, smtpUser, smtpPassword, fromEmail, fromName } = config;

  if (!smtpUser || !smtpPassword) {
    return {
      statusCode: 500,
      body: { message: 'Missing SMTP credentials' },
    };
  }

  const { to, subject, body } = payload || {};

  if (!to || !subject || !body) {
    return {
      statusCode: 400,
      body: { message: 'Missing to/subject/body in request' },
    };
  }

  // Use explicit SMTP configuration instead of 'service: gmail'
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465 (SSL), false for 587 (TLS/STARTTLS)
    auth: { user: smtpUser, pass: smtpPassword },
  });

  // Build the "From" field
  // Note: Gmail may rewrite this unless the fromEmail is configured as an alias in Gmail settings
  const displayEmail = fromEmail || smtpUser;
  const fromField = fromName ? `"${fromName}" <${displayEmail}>` : displayEmail;

  try {
    const info = await transporter.sendMail({
      from: fromField,
      replyTo: displayEmail, // Replies go to the clinic email
      to,
      subject,
      text: body,
    });

    return {
      statusCode: 200,
      body: { message: 'Email sent successfully!', info: info.response },
    };
  } catch (err) {
    console.error('SMTP send error:', err);
    return {
      statusCode: 500,
      body: { message: 'Failed to send email.', info: (err as Error).message },
    };
  }
}

// -------------------- IMAP: Fetch Emails by Folder and Date Range --------------------

async function handleFetchEmails(
  user: string,
  password: string,
  host: string,
  port: number,
  days: number,
  limit: number,
  folder: ImapFolder = 'inbox'
): Promise<{ statusCode: number; body: { message: string; count: number; emails: EmailResponse[]; searchCriteria?: string; folder?: string } }> {
  if (!user || !password || !host) {
    return {
      statusCode: 500,
      body: { message: 'Missing IMAP credentials', count: 0, emails: [] },
    };
  }

  const config = {
    imap: {
      user,
      password,
      host,
      port,
      tls: true,
      authTimeout: 30000,
      connTimeout: 30000,
      tlsOptions: { servername: host },
    },
  };

  let connection: imaps.ImapSimple | null = null;
  const sinceDate = getImapDateString(days);
  
  try {
    console.log('IMAP: connecting...');
    connection = await imaps.connect(config);

    // Find the actual mailbox name for the requested folder
    const mailboxName = await findMailboxName(connection, folder);
    if (!mailboxName) {
      connection.end();
      return {
        statusCode: 404,
        body: { message: `Folder '${folder}' not found on this mail server`, count: 0, emails: [], folder },
      };
    }

    console.log(`IMAP: opening box '${mailboxName}' for folder '${folder}'`);
    await connection.openBox(mailboxName);

    // Build search criteria - for starred, we need to search by FLAGGED
    const searchCriteria: any[] = [['SINCE', sinceDate]];
    if (folder === 'starred') {
      searchCriteria.push('FLAGGED');
    }
    const searchCriteriaStr = `SINCE ${sinceDate}${folder === 'starred' ? ' FLAGGED' : ''}`;

    console.log(`IMAP: searching with criteria: ${searchCriteriaStr}`);
    const searchResults = await connection.search(searchCriteria, {
      bodies: ['HEADER', 'TEXT', ''],
      struct: true,
    });

    console.log(`IMAP: found ${searchResults.length} messages in ${folder} since ${sinceDate}`);

    if (searchResults.length === 0) {
      connection.end();
      return {
        statusCode: 200,
        body: { message: `No ${folder} emails found in the last ${days} days`, count: 0, emails: [], searchCriteria: searchCriteriaStr, folder },
      };
    }

    // Sort by UID descending (newest first) and limit
    searchResults.sort((a, b) => (b.attributes?.uid || 0) - (a.attributes?.uid || 0));
    const limitedResults = searchResults.slice(0, limit);

    const emails: EmailResponse[] = [];
    
    for (const message of limitedResults) {
      try {
        // Get the full raw email from the parts
        const allParts = message.parts || [];
        const bodyPart = allParts.find((p: { which: string }) => p.which === '');
        const raw = bodyPart?.body || '';

        if (!raw) {
          // Try to get header and text separately
          const headerPart = allParts.find((p: { which: string }) => p.which === 'HEADER');
          const textPart = allParts.find((p: { which: string }) => p.which === 'TEXT');
          const combined = (headerPart?.body || '') + '\r\n\r\n' + (textPart?.body || '');
          
          if (combined.trim()) {
            const parsed = await simpleParser(combined);
            const text = (parsed.text || '').trim();
            const snippet = text.replace(/\s+/g, ' ').slice(0, 300);
            const toAddress = Array.isArray(parsed.to)
              ? parsed.to.map(a => a.text).join(', ')
              : (parsed.to?.text || '');

            emails.push({
              uid: message.attributes?.uid,
              from: parsed.from?.text || '',
              to: toAddress,
              subject: parsed.subject || '',
              date: parsed.date ? parsed.date.toISOString() : '',
              snippet,
              text,
            });
          }
          continue;
        }

        const parsed = await simpleParser(raw);
        const text = (parsed.text || '').trim();
        const snippet = text.replace(/\s+/g, ' ').slice(0, 300);

        const toAddress = Array.isArray(parsed.to)
          ? parsed.to.map(a => a.text).join(', ')
          : (parsed.to?.text || '');

        emails.push({
          uid: message.attributes?.uid,
          from: parsed.from?.text || '',
          to: toAddress,
          subject: parsed.subject || '',
          date: parsed.date ? parsed.date.toISOString() : '',
          snippet,
          text,
        });
      } catch (e) {
        console.error('Error parsing message:', e);
        emails.push({
          uid: message.attributes?.uid,
          from: '',
          to: '',
          subject: '',
          date: '',
          snippet: '',
          text: '',
          error: 'Parse failed',
          detail: String((e as Error)?.message || e),
        });
      }
    }

    connection.end();

    // Sort by date (newest first)
    emails.sort((a, b) => {
      const ta = Date.parse(a.date || '') || 0;
      const tb = Date.parse(b.date || '') || 0;
      return tb - ta;
    });

    return {
      statusCode: 200,
      body: { 
        message: `${folder.charAt(0).toUpperCase() + folder.slice(1)} emails from the last ${days} days fetched successfully`, 
        count: emails.length, 
        emails,
        searchCriteria: searchCriteriaStr,
        folder,
      },
    };
  } catch (err) {
    console.error('IMAP fetch error:', err);
    try { if (connection) connection.end(); } catch { /* ignore */ }
    return {
      statusCode: 500,
      body: { message: 'Error fetching emails via IMAP', count: 0, emails: [], folder },
    };
  }
}

// -------------------- IMAP: Email Actions --------------------

async function handleEmailAction(
  user: string,
  password: string,
  host: string,
  port: number,
  payload: EmailActionPayload
): Promise<{ statusCode: number; body: { message: string; success: boolean } }> {
  if (!user || !password || !host) {
    return { statusCode: 500, body: { message: 'Missing IMAP credentials', success: false } };
  }

  const { action, uid } = payload;
  if (!uid) {
    return { statusCode: 400, body: { message: 'Missing uid', success: false } };
  }

  const config = {
    imap: {
      user,
      password,
      host,
      port,
      tls: true,
      authTimeout: 30000,
      connTimeout: 30000,
      tlsOptions: { servername: host },
    },
  };

  let connection: imaps.ImapSimple | null = null;

  try {
    console.log('IMAP: connecting for action...');
    connection = await imaps.connect(config);

    switch (action) {
      case 'delete': {
        // Open INBOX to find and delete the message
        await connection.openBox('INBOX');
        await connection.addFlags(uid, ['\\Deleted']);
        // Expunge to permanently delete
        await (connection as any).imap.expunge();
        connection.end();
        return { statusCode: 200, body: { message: 'Email deleted successfully', success: true } };
      }

      case 'star': {
        await connection.openBox('INBOX');
        await connection.addFlags(uid, ['\\Flagged']);
        connection.end();
        return { statusCode: 200, body: { message: 'Email starred', success: true } };
      }

      case 'unstar': {
        await connection.openBox('INBOX');
        await connection.delFlags(uid, ['\\Flagged']);
        connection.end();
        return { statusCode: 200, body: { message: 'Email unstarred', success: true } };
      }

      case 'spam': {
        // Move to spam folder (if supported)
        const spamBox = await findMailboxName(connection, 'spam');
        if (!spamBox || spamBox === 'INBOX') {
          connection.end();
          return { statusCode: 400, body: { message: 'Spam folder not found on this server', success: false } };
        }
        await connection.openBox('INBOX');
        await connection.moveMessage(String(uid), spamBox);
        connection.end();
        return { statusCode: 200, body: { message: 'Email moved to spam', success: true } };
      }

      case 'unspam': {
        // Move from spam to inbox
        const spamBox = await findMailboxName(connection, 'spam');
        if (!spamBox || spamBox === 'INBOX') {
          connection.end();
          return { statusCode: 400, body: { message: 'Spam folder not found', success: false } };
        }
        await connection.openBox(spamBox);
        await connection.moveMessage(String(uid), 'INBOX');
        connection.end();
        return { statusCode: 200, body: { message: 'Email moved to inbox', success: true } };
      }

      case 'archive': {
        // Archive = move to All Mail or remove from INBOX (Gmail-style)
        await connection.openBox('INBOX');
        // Try to find an archive folder, otherwise just mark as read and remove from inbox
        const trashBox = await findMailboxName(connection, 'trash');
        if (trashBox && trashBox !== 'INBOX') {
          // For now, we can't truly archive in IMAP without Gmail labels
          // Instead, mark as seen (which is close to archiving for some clients)
          await connection.addFlags(uid, ['\\Seen']);
        }
        connection.end();
        return { statusCode: 200, body: { message: 'Email archived (marked as read)', success: true } };
      }

      default:
        connection.end();
        return { statusCode: 400, body: { message: `Unknown action: ${action}`, success: false } };
    }
  } catch (err) {
    console.error(`IMAP action error (${action}):`, err);
    try { if (connection) connection.end(); } catch { /* ignore */ }
    return { statusCode: 500, body: { message: `Failed to ${action}: ${(err as Error).message}`, success: false } };
  }
}

// -------------------- Main Handler --------------------

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // ========================================
    // AUTHORIZATION CHECK
    // ========================================
    const userPermissions = getUserPermissions(event);
    if (!userPermissions) {
      return normalizeResponse({
        statusCode: 401,
        headers: corsHeaders,
        body: { message: 'Unauthorized: Missing or invalid authentication' },
      });
    }

    // Get clinicId from path parameters or query string
    // If clinicId is "domain", use domain-level credentials
    const clinicId = event.pathParameters?.clinicId || event.queryStringParameters?.clinicId;
    
    if (!clinicId) {
      return normalizeResponse({
        statusCode: 400,
        headers: corsHeaders,
        body: { message: 'Missing clinicId parameter. Use "domain" for domain-level email.' },
      });
    }

    // ========================================
    // CLINIC-LEVEL ACCESS CHECK
    // ========================================
    // For 'domain', require super admin access
    // For clinic-specific, user must have access to that clinic
    if (clinicId === 'domain') {
      // Domain-level email requires super admin access
      if (!userPermissions.isSuperAdmin && !userPermissions.isGlobalSuperAdmin) {
        console.warn(`Access denied for user ${userPermissions.email} to domain email: not a super admin`);
        return normalizeResponse({
          statusCode: 403,
          headers: corsHeaders,
          body: { message: 'Forbidden: Domain-level email requires super admin access' },
        });
      }
    } else {
      // Clinic-level access check
      const allowedClinics = getAllowedClinicIds(
        userPermissions.clinicRoles,
        userPermissions.isSuperAdmin,
        userPermissions.isGlobalSuperAdmin
      );
      const hasAccess = hasClinicAccess(allowedClinics, clinicId);
      if (!hasAccess) {
        console.warn(`Access denied for user ${userPermissions.email} to clinic ${clinicId}`);
        return normalizeResponse({
          statusCode: 403,
          headers: corsHeaders,
          body: { message: 'Forbidden: You do not have access to this clinic' },
        });
      }
    }

    let smtpHost: string;
    let smtpPort: number;
    let smtpUser: string;
    let smtpPassword: string;
    let imapHost: string;
    let imapPort: number;
    let fromEmail: string | undefined;
    let fromName: string | undefined;

    if (clinicId === 'domain') {
      // Use domain-level credentials (todaysdentalinsights.com)
      smtpHost = 'smtp.gmail.com';
      smtpPort = 587;
      smtpUser = DOMAIN_SMTP_USER;
      smtpPassword = DOMAIN_SMTP_PASSWORD;
      imapHost = DOMAIN_IMAP_HOST;
      imapPort = DOMAIN_IMAP_PORT;
      fromEmail = undefined; // Use smtpUser as From
      fromName = 'Todays Dental Insights';
      console.log(`Super admin ${userPermissions.email} accessing domain email`);
    } else {
      // Use clinic-specific credentials
      const clinicConfig = await getClinicConfig(clinicId);
      if (!clinicConfig) {
        return normalizeResponse({
          statusCode: 404,
          headers: corsHeaders,
          body: { message: `Clinic not found: ${clinicId}` },
        });
      }

      // Get emailType from query parameter: 'gmail' or 'domain' (defaults to 'gmail')
      const emailType = (event.queryStringParameters?.emailType || 'gmail') as EmailType;
      const email = clinicConfig.email;

      if (!email) {
        return normalizeResponse({
          statusCode: 400,
          headers: corsHeaders,
          body: { message: `Clinic ${clinicId} does not have email configured` },
        });
      }

      // Check for new structure (gmail/domain sub-configs)
      const providerConfig = email[emailType];
      
      if (providerConfig) {
        // Use the new gmail/domain structure
        smtpHost = providerConfig.smtpHost;
        smtpPort = providerConfig.smtpPort;
        smtpUser = providerConfig.smtpUser;
        // smtpPassword should come from secrets in production
        smtpPassword = (providerConfig as any).smtpPassword || '';
        imapHost = providerConfig.imapHost;
        imapPort = providerConfig.imapPort;
        fromEmail = providerConfig.fromEmail;
        fromName = providerConfig.fromName;
      } else {
        return normalizeResponse({
          statusCode: 400,
          headers: corsHeaders,
          body: { message: `Clinic ${clinicId} does not have ${emailType} email configured` },
        });
      }

      console.log(`User ${userPermissions.email} accessing ${emailType} email for clinic ${clinicId}`);
    }

    if (event.httpMethod === 'GET') {
      const days = getDaysFromEvent(event, 7);
      const limit = getLimitFromEvent(event, 50);
      const folder = getFolderFromEvent(event);
      const result = await handleFetchEmails(smtpUser, smtpPassword, imapHost, imapPort, days, limit, folder);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    if (event.httpMethod === 'POST') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      
      // Check if this is an email action (delete, star, spam, archive)
      if (body.action && body.uid) {
        const result = await handleEmailAction(smtpUser, smtpPassword, imapHost, imapPort, body as EmailActionPayload);
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      // Regular send email
      const payload = getPostPayload(event);
      const result = await handleSendEmail({ smtpHost, smtpPort, smtpUser, smtpPassword, fromEmail, fromName }, payload);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    if (event.httpMethod === 'DELETE') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      
      if (body.uid) {
        const result = await handleEmailAction(smtpUser, smtpPassword, imapHost, imapPort, { action: 'delete', uid: body.uid });
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      return normalizeResponse({
        statusCode: 400,
        headers: corsHeaders,
        body: { message: 'Missing uid for DELETE' },
      });
    }

    return normalizeResponse({
      statusCode: 400,
      headers: corsHeaders,
      body: { message: 'Invalid method. Use GET, POST, or DELETE.' },
    });
  } catch (err) {
    console.error('Unhandled error:', err);
    return normalizeResponse({
      statusCode: 500,
      headers: corsHeaders,
      body: { message: 'Internal server error', error: String((err as Error)?.message || err) },
    });
  }
};

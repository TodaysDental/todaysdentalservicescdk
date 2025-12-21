/**
 * User Email Handler - Allows users to GET and POST emails for their own todaysdentalservices.com email
 * 
 * Users can only access their own email - credentials are stored in StaffUser.userEmail
 * 
 * GET: Fetches inbox emails for the authenticated user
 * POST: Sends an email from the authenticated user's todaysdentalservices.com email
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as nodemailer from 'nodemailer';
import * as imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getUserPermissions } from '../../shared/utils/permissions-helper';
import { StaffUser, UserEmailCredentials } from '../../shared/types/user';

// DynamoDB client
const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';

// -------------------- Types --------------------

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
  cc?: string;
  bcc?: string;
}

interface EmailActionPayload {
  action: 'delete' | 'star' | 'unstar' | 'spam' | 'unspam' | 'archive';
  uid: number;
}

// Standard IMAP folder names
type ImapFolder = 'inbox' | 'sent' | 'spam' | 'trash' | 'drafts' | 'starred';

// Mapping to common IMAP mailbox names
const FOLDER_MAPPINGS: Record<ImapFolder, string[]> = {
  inbox: ['INBOX'],
  sent: ['Sent', '[Gmail]/Sent Mail', 'Sent Items', 'Sent Messages', 'INBOX.Sent'],
  spam: ['Spam', '[Gmail]/Spam', 'Junk', 'Junk E-mail', 'INBOX.Spam', 'INBOX.Junk'],
  trash: ['Trash', '[Gmail]/Trash', 'Deleted Items', 'Deleted Messages', 'INBOX.Trash'],
  drafts: ['Drafts', '[Gmail]/Drafts', 'INBOX.Drafts'],
  starred: ['[Gmail]/Starred', 'Flagged', 'INBOX.Flagged'],
};

// -------------------- Helpers --------------------

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
  return Math.min(100, Math.floor(n)); // Max 100 emails
}

function getDaysFromEvent(event: APIGatewayProxyEvent, def = 7): number {
  const raw = event?.queryStringParameters?.days;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(30, Math.floor(n)); // Max 30 days
}

function getImapDateString(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
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
  return 'inbox';
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
    
    for (const possibleName of possibleNames) {
      const found = allBoxes.find(b => b.toLowerCase() === possibleName.toLowerCase());
      if (found) {
        return found;
      }
    }
    
    if (folder === 'starred') {
      return 'INBOX';
    }
    
    return null;
  } catch (err) {
    console.error('Error getting mailboxes:', err);
    return null;
  }
}

/**
 * Get user's email credentials from StaffUser table
 */
async function getUserEmailCredentials(userEmail: string): Promise<UserEmailCredentials | null> {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: userEmail },
    }));

    if (!result.Item) {
      console.warn(`[getUserEmailCredentials] User not found: ${userEmail}`);
      return null;
    }

    const user = result.Item as StaffUser;
    
    if (!user.userEmail) {
      console.warn(`[getUserEmailCredentials] User ${userEmail} does not have a todaysdentalservices.com email configured`);
      return null;
    }

    return user.userEmail;
  } catch (error: any) {
    console.error(`[getUserEmailCredentials] Error fetching user credentials:`, error.message);
    return null;
  }
}

// -------------------- SMTP: Send Email --------------------

async function handleSendEmail(
  creds: UserEmailCredentials,
  payload: SendEmailPayload,
  senderName?: string
): Promise<{ statusCode: number; body: { message: string; info?: string } }> {
  const { email, password, smtpHost, smtpPort } = creds;

  if (!email || !password || !smtpHost) {
    return {
      statusCode: 500,
      body: { message: 'Missing email credentials' },
    };
  }

  const { to, subject, body, cc, bcc } = payload || {};

  if (!to || !subject || !body) {
    return {
      statusCode: 400,
      body: { message: 'Missing to/subject/body in request' },
    };
  }

  // Create SMTP transporter
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465 (SSL), false for 587 (TLS)
    auth: { user: email, pass: password },
  });

  // Build the "From" field
  const fromField = senderName ? `"${senderName}" <${email}>` : email;

  try {
    const info = await transporter.sendMail({
      from: fromField,
      replyTo: email,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
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

// -------------------- IMAP: Fetch Emails by Folder --------------------

async function handleFetchEmails(
  creds: UserEmailCredentials,
  days: number,
  limit: number,
  folder: ImapFolder = 'inbox'
): Promise<{ statusCode: number; body: { message: string; count: number; emails: EmailResponse[]; userEmail?: string; folder?: string } }> {
  const { email, password, imapHost, imapPort } = creds;

  if (!email || !password || !imapHost) {
    return {
      statusCode: 500,
      body: { message: 'Missing IMAP credentials', count: 0, emails: [] },
    };
  }

  const config = {
    imap: {
      user: email,
      password: password,
      host: imapHost,
      port: imapPort,
      tls: true,
      authTimeout: 30000,
      connTimeout: 30000,
      tlsOptions: { servername: imapHost },
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
        body: { message: `Folder '${folder}' not found`, count: 0, emails: [], userEmail: email, folder },
      };
    }

    console.log(`IMAP: opening box '${mailboxName}' for folder '${folder}'`);
    await connection.openBox(mailboxName);

    // Build search criteria
    const searchCriteria: any[] = [['SINCE', sinceDate]];
    if (folder === 'starred') {
      searchCriteria.push('FLAGGED');
    }

    console.log(`IMAP: searching since ${sinceDate}${folder === 'starred' ? ' (flagged)' : ''}`);
    const searchResults = await connection.search(searchCriteria, {
      bodies: ['HEADER', 'TEXT', ''],
      struct: true,
    });

    console.log(`IMAP: found ${searchResults.length} messages`);

    if (searchResults.length === 0) {
      connection.end();
      return {
        statusCode: 200,
        body: { message: `No ${folder} emails found in the last ${days} days`, count: 0, emails: [], userEmail: email, folder },
      };
    }

    // Sort by UID descending (newest first) and limit
    searchResults.sort((a, b) => (b.attributes?.uid || 0) - (a.attributes?.uid || 0));
    const limitedResults = searchResults.slice(0, limit);

    const emails: EmailResponse[] = [];
    
    for (const message of limitedResults) {
      try {
        const allParts = message.parts || [];
        const bodyPart = allParts.find((p: { which: string }) => p.which === '');
        const raw = bodyPart?.body || '';

        if (!raw) {
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
        userEmail: email,
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
  creds: UserEmailCredentials,
  payload: EmailActionPayload
): Promise<{ statusCode: number; body: { message: string; success: boolean } }> {
  const { email, password, imapHost, imapPort } = creds;

  if (!email || !password || !imapHost) {
    return { statusCode: 500, body: { message: 'Missing IMAP credentials', success: false } };
  }

  const { action, uid } = payload;
  if (!uid) {
    return { statusCode: 400, body: { message: 'Missing uid', success: false } };
  }

  const config = {
    imap: {
      user: email,
      password: password,
      host: imapHost,
      port: imapPort,
      tls: true,
      authTimeout: 30000,
      connTimeout: 30000,
      tlsOptions: { servername: imapHost },
    },
  };

  let connection: imaps.ImapSimple | null = null;

  try {
    console.log('IMAP: connecting for action...');
    connection = await imaps.connect(config);

    switch (action) {
      case 'delete': {
        await connection.openBox('INBOX');
        await connection.addFlags(uid, ['\\Deleted']);
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
        const spamBox = await findMailboxName(connection, 'spam');
        if (!spamBox || spamBox === 'INBOX') {
          connection.end();
          return { statusCode: 400, body: { message: 'Spam folder not found', success: false } };
        }
        await connection.openBox('INBOX');
        await connection.moveMessage(String(uid), spamBox);
        connection.end();
        return { statusCode: 200, body: { message: 'Email moved to spam', success: true } };
      }

      case 'unspam': {
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
        await connection.openBox('INBOX');
        await connection.addFlags(uid, ['\\Seen']);
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
  console.log('User email handler event received');

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

    const userPrimaryEmail = userPermissions.email;
    if (!userPrimaryEmail) {
      return normalizeResponse({
        statusCode: 401,
        headers: corsHeaders,
        body: { message: 'Unauthorized: Could not determine user email' },
      });
    }

    // ========================================
    // GET USER'S EMAIL CREDENTIALS
    // ========================================
    const emailCreds = await getUserEmailCredentials(userPrimaryEmail);
    
    if (!emailCreds) {
      return normalizeResponse({
        statusCode: 404,
        headers: corsHeaders,
        body: { 
          message: 'No todaysdentalservices.com email configured for this user. Please contact an administrator.',
          primaryEmail: userPrimaryEmail,
        },
      });
    }

    // Build sender name from user permissions if available
    const senderName = userPermissions.email ? userPrimaryEmail.split('@')[0].replace(/[._]/g, ' ') : undefined;

    // ========================================
    // HANDLE REQUEST
    // ========================================
    if (event.httpMethod === 'GET') {
      const days = getDaysFromEvent(event, 7);
      const limit = getLimitFromEvent(event, 50);
      const folder = getFolderFromEvent(event);
      const result = await handleFetchEmails(emailCreds, days, limit, folder);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    if (event.httpMethod === 'POST') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      
      // Check if this is an email action (delete, star, spam, archive)
      if (body.action && body.uid) {
        const result = await handleEmailAction(emailCreds, body as EmailActionPayload);
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      // Regular send email
      const payload = getPostPayload(event);
      const result = await handleSendEmail(emailCreds, payload, senderName);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    if (event.httpMethod === 'DELETE') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      
      if (body.uid) {
        const result = await handleEmailAction(emailCreds, { action: 'delete', uid: body.uid });
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


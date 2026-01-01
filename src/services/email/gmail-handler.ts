/**
 * Gmail REST API Handler - Fetches and sends emails using Gmail OAuth2 REST API
 * 
 * Each clinic has its own:
 * - Gmail refresh token (stored in clinics.json)
 * - Gmail user ID (email address)
 * 
 * Domain-level secrets (environment variables):
 * - GMAIL_CLIENT_ID
 * - GMAIL_CLIENT_SECRET
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { OAuth2Client } from 'google-auth-library';
import { simpleParser } from 'mailparser';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { 
  getClinicConfig, 
  getClinicSecrets, 
  getAllClinicConfigs,
  getGmailOAuthCredentials,
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

interface EmailResponse {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  internalDate: string;
  snippet: string;
  text: string;
}

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

interface EmailActionPayload {
  action: 'archive' | 'delete' | 'star' | 'unstar' | 'spam' | 'unspam' | 'trash' | 'untrash';
  messageId: string;
}

interface DraftPayload {
  to: string;
  subject: string;
  body: string;
  draftId?: string; // If provided, updates existing draft
}

interface ScheduledEmailPayload {
  to: string;
  subject: string;
  body: string;
  scheduledTime: string; // ISO timestamp
}

// Gmail label/folder types
type GmailFolder = 'inbox' | 'sent' | 'spam' | 'trash' | 'starred' | 'drafts' | 'all';

const FOLDER_TO_LABEL: Record<GmailFolder, string> = {
  inbox: 'INBOX',
  sent: 'SENT',
  spam: 'SPAM',
  trash: 'TRASH',
  starred: 'STARRED',
  drafts: 'DRAFT',
  all: '',
};

// Extended email config with Gmail OAuth fields (legacy support)
interface GmailEmailConfig {
  gmail?: EmailProviderConfig;
  domain?: EmailProviderConfig;
  // Legacy Gmail OAuth fields (may not exist in all clinics)
  gmailUserId?: string;
  gmailRefreshToken?: string;
}

// Helper to get Gmail OAuth config from clinic
function getGmailOAuthConfig(clinicConfig: ClinicConfig): { userId: string; refreshToken: string } | null {
  const email = clinicConfig.email as GmailEmailConfig | undefined;
  if (!email) return null;
  
  // Check for legacy OAuth fields
  if (email.gmailRefreshToken) {
    return {
      userId: email.gmailUserId || 'me',
      refreshToken: email.gmailRefreshToken,
    };
  }
  
  return null;
}

// -------------------- Helpers --------------------

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';

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
  return Math.min(500, Math.floor(n)); // Increased max to 500 for date-based queries
}

function getDaysFromEvent(event: APIGatewayProxyEvent, def = 7): number {
  const raw = event?.queryStringParameters?.days;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(90, Math.floor(n)); // Max 90 days
}

function getFolderFromEvent(event: APIGatewayProxyEvent): GmailFolder {
  const raw = event?.queryStringParameters?.folder?.toLowerCase();
  if (raw && raw in FOLDER_TO_LABEL) {
    return raw as GmailFolder;
  }
  return 'inbox'; // Default to inbox
}

function getDateNDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  // Gmail uses YYYY/MM/DD format
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
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

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(str: string, max = 8000): string {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Gmail uses base64url encoding
function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToBuffer(b64url: string): Buffer {
  const s = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64');
}

function encodeHeaderIfNeeded(value: string): string {
  const v = String(value || '');
  if (/^[\x00-\x7F]*$/.test(v)) return v;
  const b64 = Buffer.from(v, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

// -------------------- OAuth + Gmail REST --------------------

function getOAuthClient(refreshToken: string): OAuth2Client {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    throw new Error('Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET env vars');
  }
  if (!refreshToken) {
    throw new Error('Missing Gmail refresh token for clinic');
  }
  const client = new OAuth2Client(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function gmailRequest(
  method: string,
  path: string,
  refreshToken: string,
  body?: unknown
): Promise<unknown> {
  const oauth = getOAuthClient(refreshToken);
  const { token } = await oauth.getAccessToken();
  if (!token) throw new Error('Failed to get access token');

  const url = `https://gmail.googleapis.com/gmail/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON
  }

  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message || text || `HTTP ${res.status}`;
    throw new Error(`Gmail API error: ${msg}`);
  }
  return json;
}

// -------------------- GET: Fetch Emails by Folder and Date Range --------------------

async function handleFetchEmails(
  clinicConfig: ClinicConfig,
  limit = 50,
  days = 7,
  folder: GmailFolder = 'inbox'
): Promise<{ statusCode: number; body: { message: string; count: number; emails: EmailResponse[]; query?: string; folder?: string } }> {
  const oauthConfig = getGmailOAuthConfig(clinicConfig);
  if (!oauthConfig) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const { userId, refreshToken } = oauthConfig;

  // Build query to filter emails by folder and date
  const afterDate = getDateNDaysAgo(days);
  const labelQuery = folder === 'all' ? '' : `in:${folder}`;
  const query = labelQuery ? `${labelQuery} after:${afterDate}` : `after:${afterDate}`;
  const encodedQuery = encodeURIComponent(query);

  console.log(`Fetching emails with query: ${query}, limit: ${limit}`);

  // Fetch message IDs matching the query
  let allMessageIds: { id: string }[] = [];
  let pageToken: string | undefined;
  
  do {
    const pageUrl = `users/${encodeURIComponent(userId)}/messages?q=${encodedQuery}&maxResults=${Math.min(limit - allMessageIds.length, 100)}&includeSpamTrash=false${pageToken ? `&pageToken=${pageToken}` : ''}`;
    
    const list = (await gmailRequest('GET', pageUrl, refreshToken)) as { 
      messages?: { id: string }[]; 
      nextPageToken?: string 
    };

    const msgs = list?.messages || [];
    allMessageIds = allMessageIds.concat(msgs);
    pageToken = list?.nextPageToken;

    // Stop if we've reached the limit or no more pages
    if (allMessageIds.length >= limit || !pageToken) break;
  } while (pageToken);

  // Trim to limit
  allMessageIds = allMessageIds.slice(0, limit);

  if (!allMessageIds.length) {
    return { statusCode: 200, body: { message: `No ${folder.toUpperCase()} messages found in the last ${days} days`, count: 0, emails: [], query, folder } };
  }

  console.log(`Found ${allMessageIds.length} messages in the last ${days} days`);

  // Fetch full message details in batches to avoid overwhelming the API
  const batchSize = 10;
  const emails: EmailResponse[] = [];
  
  for (let i = 0; i < allMessageIds.length; i += batchSize) {
    const batch = allMessageIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async ({ id }) => {
        try {
          const msg = (await gmailRequest(
            'GET',
            `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}?format=raw`,
            refreshToken
          )) as { id: string; threadId: string; raw: string; internalDate: string };

          const buf = base64UrlDecodeToBuffer(msg.raw || '');
          const parsed = await simpleParser(buf);

          const text = (parsed.text && parsed.text.trim())
            ? parsed.text.trim()
            : stripHtml(parsed.html || '');
          const cleanText = truncate(text, 8000);

          const internalDateMs = Number(msg.internalDate || 0);

          // Handle 'to' which can be AddressObject or AddressObject[]
          const toAddress = Array.isArray(parsed.to) 
            ? parsed.to.map(a => a.text).join(', ') 
            : (parsed.to?.text || '');

          return {
            id: msg.id || id,
            threadId: msg.threadId || '',
            from: parsed.from?.text || '',
            to: toAddress,
            subject: parsed.subject || '',
            date: parsed.date ? parsed.date.toISOString() : '',
            internalDate: internalDateMs ? new Date(internalDateMs).toISOString() : '',
            snippet: truncate(cleanText.replace(/\s+/g, ' ').trim(), 200),
            text: cleanText,
          };
        } catch (err) {
          console.error(`Error fetching message ${id}:`, err);
          return null;
        }
      })
    );
    emails.push(...batchResults.filter((e): e is EmailResponse => e !== null));
  }

  // Sort by date (newest first)
  emails.sort((a, b) => {
    const ta = Date.parse(a.internalDate || a.date || '') || 0;
    const tb = Date.parse(b.internalDate || b.date || '') || 0;
    return tb - ta;
  });

  return {
    statusCode: 200,
    body: { 
      message: `${folder.toUpperCase()} emails from the last ${days} days fetched successfully (Gmail REST)`, 
      count: emails.length, 
      emails,
      query,
      folder,
    },
  };
}

// -------------------- POST: Send Email --------------------

async function handleSendEmail(
  clinicConfig: ClinicConfig,
  payload: SendEmailPayload
): Promise<{ statusCode: number; body: { message: string; id?: string; threadId?: string } }> {
  const oauthConfig = getGmailOAuthConfig(clinicConfig);
  if (!oauthConfig) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const { userId, refreshToken } = oauthConfig;
  const { to, subject, body } = payload || {};

  if (!to || !subject || !body) {
    return { statusCode: 400, body: { message: 'Missing to/subject/body in request' } };
  }

  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeaderIfNeeded(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    String(body),
  ].join('\r\n');

  const raw = base64UrlEncode(Buffer.from(mime, 'utf8'));

  const sent = (await gmailRequest(
    'POST',
    `users/${encodeURIComponent(userId)}/messages/send`,
    refreshToken,
    { raw }
  )) as { id?: string; threadId?: string };

  return {
    statusCode: 200,
    body: { message: 'Email sent successfully (Gmail REST)', id: sent?.id || '', threadId: sent?.threadId || '' },
  };
}

// -------------------- Email Actions (Archive, Delete, Star, Spam, Trash) --------------------

async function handleEmailAction(
  clinicConfig: ClinicConfig,
  payload: EmailActionPayload
): Promise<{ statusCode: number; body: { message: string; success: boolean } }> {
  const oauthConfig = getGmailOAuthConfig(clinicConfig);
  if (!oauthConfig) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const { userId, refreshToken } = oauthConfig;
  const { action, messageId } = payload;

  if (!messageId) {
    return { statusCode: 400, body: { message: 'Missing messageId', success: false } };
  }

  try {
    switch (action) {
      case 'archive':
        // Archive = remove INBOX label
        await gmailRequest('POST', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/modify`, refreshToken, {
          removeLabelIds: ['INBOX'],
        });
        return { statusCode: 200, body: { message: 'Email archived successfully', success: true } };

      case 'delete':
        // Permanently delete (not trash)
        await gmailRequest('DELETE', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`, refreshToken);
        return { statusCode: 200, body: { message: 'Email permanently deleted', success: true } };

      case 'star':
        await gmailRequest('POST', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/modify`, refreshToken, {
          addLabelIds: ['STARRED'],
        });
        return { statusCode: 200, body: { message: 'Email starred', success: true } };

      case 'unstar':
        await gmailRequest('POST', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/modify`, refreshToken, {
          removeLabelIds: ['STARRED'],
        });
        return { statusCode: 200, body: { message: 'Email unstarred', success: true } };

      case 'spam':
        await gmailRequest('POST', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/modify`, refreshToken, {
          addLabelIds: ['SPAM'],
          removeLabelIds: ['INBOX'],
        });
        return { statusCode: 200, body: { message: 'Email marked as spam', success: true } };

      case 'unspam':
        await gmailRequest('POST', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/modify`, refreshToken, {
          removeLabelIds: ['SPAM'],
          addLabelIds: ['INBOX'],
        });
        return { statusCode: 200, body: { message: 'Email removed from spam', success: true } };

      case 'trash':
        await gmailRequest('POST', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/trash`, refreshToken);
        return { statusCode: 200, body: { message: 'Email moved to trash', success: true } };

      case 'untrash':
        await gmailRequest('POST', `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/untrash`, refreshToken);
        return { statusCode: 200, body: { message: 'Email restored from trash', success: true } };

      default:
        return { statusCode: 400, body: { message: `Unknown action: ${action}`, success: false } };
    }
  } catch (err) {
    console.error(`Error performing action ${action}:`, err);
    return { statusCode: 500, body: { message: `Failed to ${action} email: ${(err as Error).message}`, success: false } };
  }
}

// -------------------- Drafts --------------------

async function handleCreateOrUpdateDraft(
  clinicConfig: ClinicConfig,
  payload: DraftPayload
): Promise<{ statusCode: number; body: { message: string; draftId?: string; success: boolean } }> {
  const oauthConfig = getGmailOAuthConfig(clinicConfig);
  if (!oauthConfig) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const { userId, refreshToken } = oauthConfig;
  const { to, subject, body, draftId } = payload;

  if (!to || !subject) {
    return { statusCode: 400, body: { message: 'Missing to/subject in request', success: false } };
  }

  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeaderIfNeeded(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    String(body || ''),
  ].join('\r\n');

  const raw = base64UrlEncode(Buffer.from(mime, 'utf8'));

  try {
    if (draftId) {
      // Update existing draft
      const updated = (await gmailRequest(
        'PUT',
        `users/${encodeURIComponent(userId)}/drafts/${encodeURIComponent(draftId)}`,
        refreshToken,
        { message: { raw } }
      )) as { id?: string };

      return {
        statusCode: 200,
        body: { message: 'Draft updated successfully', draftId: updated?.id || draftId, success: true },
      };
    } else {
      // Create new draft
      const created = (await gmailRequest(
        'POST',
        `users/${encodeURIComponent(userId)}/drafts`,
        refreshToken,
        { message: { raw } }
      )) as { id?: string };

      return {
        statusCode: 200,
        body: { message: 'Draft created successfully', draftId: created?.id || '', success: true },
      };
    }
  } catch (err) {
    console.error('Error creating/updating draft:', err);
    return { statusCode: 500, body: { message: `Failed to save draft: ${(err as Error).message}`, success: false } };
  }
}

async function handleDeleteDraft(
  clinicConfig: ClinicConfig,
  draftId: string
): Promise<{ statusCode: number; body: { message: string; success: boolean } }> {
  const oauthConfig = getGmailOAuthConfig(clinicConfig);
  if (!oauthConfig) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const { userId, refreshToken } = oauthConfig;

  if (!draftId) {
    return { statusCode: 400, body: { message: 'Missing draftId', success: false } };
  }

  try {
    await gmailRequest('DELETE', `users/${encodeURIComponent(userId)}/drafts/${encodeURIComponent(draftId)}`, refreshToken);
    return { statusCode: 200, body: { message: 'Draft deleted successfully', success: true } };
  } catch (err) {
    console.error('Error deleting draft:', err);
    return { statusCode: 500, body: { message: `Failed to delete draft: ${(err as Error).message}`, success: false } };
  }
}

async function handleSendDraft(
  clinicConfig: ClinicConfig,
  draftId: string
): Promise<{ statusCode: number; body: { message: string; messageId?: string; success: boolean } }> {
  const oauthConfig = getGmailOAuthConfig(clinicConfig);
  if (!oauthConfig) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const { userId, refreshToken } = oauthConfig;

  if (!draftId) {
    return { statusCode: 400, body: { message: 'Missing draftId', success: false } };
  }

  try {
    const sent = (await gmailRequest(
      'POST',
      `users/${encodeURIComponent(userId)}/drafts/send`,
      refreshToken,
      { id: draftId }
    )) as { id?: string };

    return { statusCode: 200, body: { message: 'Draft sent successfully', messageId: sent?.id, success: true } };
  } catch (err) {
    console.error('Error sending draft:', err);
    return { statusCode: 500, body: { message: `Failed to send draft: ${(err as Error).message}`, success: false } };
  }
}

// -------------------- Fetch Drafts --------------------

async function handleFetchDrafts(
  clinicConfig: ClinicConfig,
  limit = 50
): Promise<{ statusCode: number; body: { message: string; count: number; drafts: Array<{ draftId: string; to: string; subject: string; snippet: string }> } }> {
  const oauthConfig = getGmailOAuthConfig(clinicConfig);
  if (!oauthConfig) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const { userId, refreshToken } = oauthConfig;

  try {
    // List drafts
    const list = (await gmailRequest(
      'GET',
      `users/${encodeURIComponent(userId)}/drafts?maxResults=${limit}`,
      refreshToken
    )) as { drafts?: Array<{ id: string; message: { id: string } }> };

    const draftsList = list?.drafts || [];
    
    if (!draftsList.length) {
      return { statusCode: 200, body: { message: 'No drafts found', count: 0, drafts: [] } };
    }

    // Fetch details for each draft
    const drafts = await Promise.all(
      draftsList.slice(0, limit).map(async (draft) => {
        try {
          const draftDetail = (await gmailRequest(
            'GET',
            `users/${encodeURIComponent(userId)}/drafts/${encodeURIComponent(draft.id)}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`,
            refreshToken
          )) as { id: string; message: { id: string; snippet: string; payload?: { headers?: Array<{ name: string; value: string }> } } };

          const headers = draftDetail?.message?.payload?.headers || [];
          const toHeader = headers.find(h => h.name.toLowerCase() === 'to');
          const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');

          return {
            draftId: draft.id,
            to: toHeader?.value || '',
            subject: subjectHeader?.value || '',
            snippet: draftDetail?.message?.snippet || '',
          };
        } catch {
          return { draftId: draft.id, to: '', subject: '', snippet: '' };
        }
      })
    );

    return {
      statusCode: 200,
      body: { message: 'Drafts fetched successfully', count: drafts.length, drafts },
    };
  } catch (err) {
    console.error('Error fetching drafts:', err);
    return { statusCode: 500, body: { message: `Failed to fetch drafts: ${(err as Error).message}`, count: 0, drafts: [] } };
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
    const clinicId = event.pathParameters?.clinicId || event.queryStringParameters?.clinicId;
    
    if (!clinicId) {
      return normalizeResponse({
        statusCode: 400,
        headers: corsHeaders,
        body: { message: 'Missing clinicId parameter' },
      });
    }

    // ========================================
    // CLINIC-LEVEL ACCESS CHECK
    // ========================================
    // User must have access to the requested clinic (or be a super admin)
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

    const clinicConfig = await getClinicConfig(clinicId);
    if (!clinicConfig) {
      return normalizeResponse({
        statusCode: 404,
        headers: corsHeaders,
        body: { message: `Clinic not found: ${clinicId}` },
      });
    }

    console.log(`User ${userPermissions.email} accessing email for clinic ${clinicId}`);

    // Get action from path or query parameter
    const actionPath = event.pathParameters?.action;
    const actionQuery = event.queryStringParameters?.action;

    if (event.httpMethod === 'GET') {
      const limit = getLimitFromEvent(event, 50);
      const days = getDaysFromEvent(event, 7);
      const folder = getFolderFromEvent(event);
      
      // Special handling for drafts folder
      if (folder === 'drafts') {
        const result = await handleFetchDrafts(clinicConfig, limit);
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      const result = await handleFetchEmails(clinicConfig, limit, days, folder);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    if (event.httpMethod === 'POST') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      
      // Check if this is an email action (archive, delete, star, spam, trash)
      if (body.action && body.messageId) {
        const result = await handleEmailAction(clinicConfig, body as EmailActionPayload);
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      // Check if this is a draft operation
      if (actionPath === 'drafts' || actionQuery === 'drafts' || body.isDraft) {
        // If sending a draft
        if (body.sendDraftId) {
          const result = await handleSendDraft(clinicConfig, body.sendDraftId);
          return normalizeResponse({ ...result, headers: corsHeaders });
        }
        // Create or update draft
        const result = await handleCreateOrUpdateDraft(clinicConfig, body as DraftPayload);
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      // Regular send email
      const payload = getPostPayload(event);
      const result = await handleSendEmail(clinicConfig, payload);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    if (event.httpMethod === 'DELETE') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      
      // Delete draft
      if (body.draftId) {
        const result = await handleDeleteDraft(clinicConfig, body.draftId);
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      // Delete message permanently
      if (body.messageId) {
        const result = await handleEmailAction(clinicConfig, { action: 'delete', messageId: body.messageId });
        return normalizeResponse({ ...result, headers: corsHeaders });
      }
      
      return normalizeResponse({
        statusCode: 400,
        headers: corsHeaders,
        body: { message: 'Missing draftId or messageId for DELETE' },
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

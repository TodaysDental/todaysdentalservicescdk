'use strict';

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
import clinicsData from '../../infrastructure/configs/clinics.json';
import { buildCorsHeaders } from '../../shared/utils/cors';
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

interface ClinicConfig {
  clinicId: string;
  clinicEmail: string;
  clinicName: string;
  email?: {
    // New structure: separate gmail and domain configs
    gmail?: EmailProviderConfig;
    domain?: EmailProviderConfig;
    // Legacy OAuth fields (for Gmail REST API)
    gmailUserId?: string;
    gmailRefreshToken?: string;
  };
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

// -------------------- Helpers --------------------

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';

function getClinicConfig(clinicId: string): ClinicConfig | undefined {
  return (clinicsData as ClinicConfig[]).find(c => c.clinicId === clinicId);
}

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

function getLimitFromEvent(event: APIGatewayProxyEvent, def = 5): number {
  const raw = event?.queryStringParameters?.limit;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(20, Math.floor(n));
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

// -------------------- GET: Fetch Latest INBOX Emails --------------------

async function handleFetchLatestInboxEmails(
  clinicConfig: ClinicConfig,
  limit = 5
): Promise<{ statusCode: number; body: { message: string; count: number; emails: EmailResponse[] } }> {
  const email = clinicConfig.email;
  if (!email?.gmailRefreshToken) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const userId = email.gmailUserId || 'me';
  const refreshToken = email.gmailRefreshToken;

  const list = (await gmailRequest(
    'GET',
    `users/${encodeURIComponent(userId)}/messages?labelIds=INBOX&maxResults=${limit}&includeSpamTrash=false`,
    refreshToken
  )) as { messages?: { id: string }[] };

  const msgs = list?.messages || [];
  if (!msgs.length) {
    return { statusCode: 200, body: { message: 'No INBOX messages found', count: 0, emails: [] } };
  }

  const emails: EmailResponse[] = await Promise.all(
    msgs.map(async ({ id }) => {
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
    })
  );

  emails.sort((a, b) => {
    const ta = Date.parse(a.internalDate || a.date || '') || 0;
    const tb = Date.parse(b.internalDate || b.date || '') || 0;
    return tb - ta;
  });

  return {
    statusCode: 200,
    body: { message: 'Most recent INBOX emails fetched successfully (Gmail REST)', count: emails.length, emails },
  };
}

// -------------------- POST: Send Email --------------------

async function handleSendEmail(
  clinicConfig: ClinicConfig,
  payload: SendEmailPayload
): Promise<{ statusCode: number; body: { message: string; id?: string; threadId?: string } }> {
  const email = clinicConfig.email;
  if (!email?.gmailRefreshToken) {
    throw new Error(`Clinic ${clinicConfig.clinicId} does not have Gmail OAuth configured`);
  }

  const userId = email.gmailUserId || 'me';
  const refreshToken = email.gmailRefreshToken;
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

    const clinicConfig = getClinicConfig(clinicId);
    if (!clinicConfig) {
      return normalizeResponse({
        statusCode: 404,
        headers: corsHeaders,
        body: { message: `Clinic not found: ${clinicId}` },
      });
    }

    console.log(`User ${userPermissions.email} accessing email for clinic ${clinicId}`);

    if (event.httpMethod === 'GET') {
      const limit = getLimitFromEvent(event, 5);
      const result = await handleFetchLatestInboxEmails(clinicConfig, limit);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    if (event.httpMethod === 'POST') {
      const payload = getPostPayload(event);
      const result = await handleSendEmail(clinicConfig, payload);
      return normalizeResponse({ ...result, headers: corsHeaders });
    }

    return normalizeResponse({
      statusCode: 400,
      headers: corsHeaders,
      body: { message: 'Invalid action. Use GET or POST.' },
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

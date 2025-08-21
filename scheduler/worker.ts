import https from 'https';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';
// Use require to avoid type resolution issues if types aren't present
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

type ClinicCreds = {
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir?: string;
};

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const ses = new SESv2Client({});
const sms = new (PinpointSMSVoiceV2Client as any)({});

const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE || process.env.SCHEDULER || 'SCHEDULER';
const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || 'Templates';
const QUERIES_TABLE = process.env.QUERIES_TABLE || 'SQL_Queries';
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';

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

function nowUtc(): Date { return new Date(); }

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; week: number };

function getLocalParts(d: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = fmt.formatToParts(d).reduce((acc: any, p) => { acc[p.type] = p.value; return acc; }, {} as any);
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const week = weekNumberLocal(year, month, day, timeZone);
  return { year, month, day, hour, minute, week };
}

function weekNumberLocal(year: number, month: number, day: number, timeZone: string): number {
  // Compute ISO-like week number based on local date components
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function isDueLocal(schedule: any, now: Date, timeZone: string, lastRunAtIso?: string): boolean {
  const freq = String(schedule.frequency || 'daily').toLowerCase();
  const time = String(schedule.time || '').trim();
  const lastRunAt = lastRunAtIso ? new Date(lastRunAtIso) : undefined;

  // Only run once per minute per clinic
  if (lastRunAt && Math.abs(now.getTime() - lastRunAt.getTime()) < 55_000) return false;

  const nowL = getLocalParts(now, timeZone);
  const lastL = lastRunAt ? getLocalParts(lastRunAt, timeZone) : undefined;

  // Date window filtering (inclusive), based on local date
  const startDate = String(schedule.startDate || schedule.start_date || '').trim(); // YYYY-MM-DD
  const endDate = String(schedule.endDate || schedule.end_date || '').trim(); // YYYY-MM-DD
  if (startDate) {
    const sParts = startDate.split('-').map((x: string) => parseInt(x, 10));
    if (sParts.length === 3) {
      const sKey = sParts[0] * 10000 + sParts[1] * 100 + sParts[2];
      const todayKey = nowL.year * 10000 + nowL.month * 100 + nowL.day;
      if (todayKey < sKey) return false;
    }
  }
  if (endDate) {
    const eParts = endDate.split('-').map((x: string) => parseInt(x, 10));
    if (eParts.length === 3) {
      const eKey = eParts[0] * 10000 + eParts[1] * 100 + eParts[2];
      const todayKey = nowL.year * 10000 + nowL.month * 100 + nowL.day;
      if (todayKey > eKey) return false;
    }
  }

  if (!time) {
    return shouldRunByFrequencyLocal(freq, nowL, lastL, startDate);
  }
  const [hh, mm] = time.split(':').map((s: string) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return false;
  const isNow = nowL.hour === hh && nowL.minute === mm;
  if (!isNow) return false;
  return shouldRunByFrequencyLocal(freq, nowL, lastL, startDate);
}

function shouldRunByFrequencyLocal(freq: string, nowL: LocalParts, lastL?: LocalParts, startDate?: string): boolean {
  if (!lastL) return true;
  switch (freq) {
    case 'hourly': return nowL.hour !== lastL.hour || nowL.day !== lastL.day || nowL.month !== lastL.month || nowL.year !== lastL.year;
    case 'daily': return nowL.day !== lastL.day || nowL.month !== lastL.month || nowL.year !== lastL.year;
    case 'weekly': {
      const anchorDow = startDate ? dayOfWeekFromYmd(startDate, 'UTC') : undefined; // 0=Sun..6=Sat, use UTC day-of-week for anchor
      if (anchorDow !== undefined) {
        const nowDow = dayOfWeekLocal(nowL);
        const lastDow = lastL ? dayOfWeekLocal(lastL) : -1;
        const isAnchorToday = nowDow === anchorDow;
        const crossedWeek = nowL.week !== (lastL?.week ?? -1) || nowL.year !== (lastL?.year ?? -1);
        return isAnchorToday && crossedWeek;
      }
      return nowL.week !== lastL.week || nowL.year !== lastL.year;
    }
    case 'monthly': {
      const anchorDom = startDate ? parseInt(startDate.split('-')[2], 10) : undefined;
      const isAnchorToday = anchorDom ? nowL.day === anchorDom : false;
      const crossedMonth = nowL.month !== lastL.month || nowL.year !== lastL.year;
      return isAnchorToday && crossedMonth;
    }
    default: return true;
  }
}

function dayOfWeekFromYmd(ymd: string, tz: string): number | undefined {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(ymd);
  if (!m) return undefined;
  const date = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  return date.getUTCDay();
}

function dayOfWeekLocal(parts: LocalParts): number {
  // Compute day-of-week from date parts via Date UTC; DST boundaries won’t affect DOW
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.getUTCDay();
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
  const creds = CLINIC_CREDS[clinicId];
  if (!creds) return [];
  const API_HOST = 'api.opendental.com';
  const API_BASE = '/api/v1';

  const remoteDir = (creds.sftpRemoteDir || 'QuerytemplateCSV').replace(/^\/+|\/+$/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sftpAddress = `${creds.sftpHost}/${remoteDir}/query_${timestamp}.csv`;

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

  const apiResp = await httpRequest({ hostname: API_HOST, path: `${API_BASE}/queries`, method: 'POST', headers }, body);
  if (apiResp.statusCode !== 201) {
    return [];
  }

  const csvData: string = await downloadLatestCsv({
    host: creds.sftpHost,
    port: creds.sftpPort || 22,
    username: creds.sftpUsername,
    password: creds.sftpPassword,
    remoteDir: remoteDir,
  });

  if (csvData.trim() === 'OK') return [];
  const records = parseCsv(csvData, { columns: true, skip_empty_lines: true, trim: true });
  return Array.isArray(records) ? records : [];
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

async function downloadLatestCsv(opts: { host: string; port: number; username: string; password: string; remoteDir: string; }): Promise<string> {
  const { host, port, username, password, remoteDir } = opts;
  const conn = new SSH2Client();
  return new Promise<string>((resolve, reject) => {
    conn.on('ready', () => {
      conn.sftp((err: any, sftp: any) => {
        if (err) { conn.end(); reject(err); return; }
        setTimeout(() => {
          sftp.readdir(remoteDir, (err2: any, list: any[]) => {
            if (err2) { conn.end(); reject(err2); return; }
            const csvFiles = list.filter((f: any) => String(f.filename).endsWith('.csv'));
            if (csvFiles.length === 0) { conn.end(); reject(new Error('No CSV files found')); return; }
            const latest = csvFiles.sort((a: any, b: any) => b.attrs.mtime - a.attrs.mtime)[0];
            const actualPath = `${remoteDir}/${latest.filename}`;
            const readStream = sftp.createReadStream(actualPath);
            let csvContent = '';
            readStream.on('data', (chunk: any) => { csvContent += chunk.toString(); });
            readStream.on('end', () => { conn.end(); resolve(csvContent); });
            readStream.on('error', (e: any) => { conn.end(); reject(e); });
          });
        }, 3000);
      });
    }).on('error', (e: any) => { reject(e); }).connect({ host, port, username, password, readyTimeout: 10000 });
  });
}

function extractEmailAndPhone(row: any): { email?: string; phone?: string } {
  const entries = Object.entries(row || {});
  let email: string | undefined;
  let phone: string | undefined;
  for (const [k, v] of entries) {
    const key = String(k).toLowerCase();
    const val = String(v || '').trim();
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

async function sendEmail({ clinicId, to, subject, html, text }: { clinicId: string; to: string; subject: string; html: string; text?: string; }) {
  const identityArn = CLINIC_SES_IDENTITY_ARN_MAP[clinicId];
  if (!identityArn) return;
  const fromDomain = identityArn.split(':identity/')[1] || 'todaysdentalinsights.com';
  const from = `no-reply@${fromDomain}`;
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    FromEmailAddressIdentityArn: identityArn,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Html: { Data: html }, Text: { Data: text || html.replace(/<[^>]+>/g, ' ') } },
      },
    },
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

export const handler = async () => {
  const now = nowUtc();
  const scan = await doc.send(new ScanCommand({ TableName: SCHEDULES_TABLE }));
  const schedules = (scan.Items || []) as any[];

  for (const sched of schedules) {
    try {
      const clinicIds: string[] = Array.isArray(sched.clinicIds) && sched.clinicIds.length > 0 ? sched.clinicIds : (sched.clinicId ? [sched.clinicId] : []);
      if (clinicIds.length === 0) continue;

      const queryName = String(sched.queryTemplate || '').trim();
      const templateName = String(sched.templateMessage || '').trim();
      if (!queryName || !templateName) {
        await markRan(sched.id);
        continue;
      }

      const sql = await fetchQueryByName(queryName);
      const template = await fetchTemplateByName(templateName);
      if (!sql || !template) {
        await markRan(sched.id);
        continue;
      }

      for (const clinicId of clinicIds) {
        const timeZone = await getClinicTimeZone(clinicId);
        const lastRunByClinic: Record<string, string> = sched.last_run_by_clinic || {};
        const lastRunForThisClinic = lastRunByClinic[clinicId] || sched.last_run_at;
        if (!isDueLocal(sched, now, timeZone, lastRunForThisClinic)) {
          continue;
        }
        const rows = await runOpenDentalQuery({ clinicId, sql });
        for (const row of rows) {
          const { email, phone } = extractEmailAndPhone(row);
          if (Array.isArray(sched.notificationTypes) && sched.notificationTypes.includes('EMAIL') && email) {
            await sendEmail({ clinicId, to: email, subject: template.email_subject || 'Notification', html: template.email_body || '' });
          }
          if (Array.isArray(sched.notificationTypes) && sched.notificationTypes.includes('SMS') && phone && template.text_message) {
            await sendSms({ clinicId, to: phone, body: template.text_message });
          }
        }
        await markRanForClinic(sched.id, clinicId);
      }
    } catch (e) {
      // Best-effort; continue to next schedule
      await markRan(sched.id);
    }
  }
};

async function markRan(id: string) {
  if (!id) return;
  await doc.send(new UpdateCommand({
    TableName: SCHEDULES_TABLE,
    Key: { id },
    UpdateExpression: 'SET last_run_at = :ts',
    ExpressionAttributeValues: { ':ts': new Date().toISOString() },
  }));
}

async function markRanForClinic(id: string, clinicId: string) {
  if (!id || !clinicId) return;
  const nowIso = new Date().toISOString();
  await doc.send(new UpdateCommand({
    TableName: SCHEDULES_TABLE,
    Key: { id },
    UpdateExpression: 'SET last_run_at = :ts, #map.#cid = :ts',
    ExpressionAttributeNames: {
      '#map': 'last_run_by_clinic',
      '#cid': clinicId,
    },
    ExpressionAttributeValues: { ':ts': nowIso },
  }));
}

const tzCache: Record<string, string> = {};
async function getClinicTimeZone(clinicId: string): Promise<string> {
  if (!clinicId) return 'America/New_York';
  if (tzCache[clinicId]) return tzCache[clinicId];
  try {
    const resp = await doc.send(new GetCommand({ TableName: CLINIC_HOURS_TABLE, Key: { clinicId } }));
    const item: any = resp.Item || {};
    const tz = String(item.timeZone || item.timezone || 'America/New_York');
    tzCache[clinicId] = tz;
    return tz;
  } catch {
    return 'America/New_York';
  }
}



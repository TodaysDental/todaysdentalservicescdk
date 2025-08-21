import https from 'https';
import { buildCorsHeaders } from '../utils/cors';
import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyEventQueryStringParameters } from 'aws-lambda';
import { parse as parseCsv } from 'csv-parse/sync';
import { Client as SSH2Client } from 'ssh2';

type ClinicCreds = {
  developerKey: string;
  customerKey: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  sftpRemoteDir?: string; // default QuerytemplateCSV
};

const corsHeaders = buildCorsHeaders({ allowMethods: ['GET', 'POST', 'OPTIONS'] });

const getGroupsFromClaims = (claims?: Record<string, any>): string[] => {
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
};

const isGlobalSuperAdmin = (groups: string[]): boolean => groups.includes('GLOBAL__SUPER_ADMIN');

const API_HOST = 'api.opendental.com';
const API_BASE = '/api/v1';

// ENV: JSON string mapping clinicId to creds
// Example: {"dentistingreenville":{"developerKey":"...","customerKey":"...","sftpHost":"...","sftpPort":22,"sftpUsername":"...","sftpPassword":"..."}}
const CLINIC_CREDS: Record<string, ClinicCreds> = (() => {
  const raw = process.env.OPEN_DENTAL_CLINIC_CREDS || '{}';
  try { return JSON.parse(raw); } catch { return {}; }
})();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const proxy = event.pathParameters?.proxy || '';
    const clinicId = event.pathParameters?.clinicId || '';
    const queryParams = event.queryStringParameters || {};
    const body = event.body ? safeParse(event.body) : null;

    if (method === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    if (!clinicId || !proxy) {
      return httpErr(400, 'Missing clinicId or proxy');
    }

    const creds = CLINIC_CREDS[clinicId];
    if (!creds) {
      return httpErr(400, `No Open Dental credentials configured for clinicId=${clinicId}`);
    }

    const groups = getGroupsFromClaims((event.requestContext as any)?.authorizer?.claims);
    // Anyone authenticated can POST /{clinicId}/queries; enforce clinic membership for all other clinic routes
    const isQueriesPost = method === 'POST' && proxy === 'queries';
    const isMemberOfClinic = groups.some((g) => g.startsWith(`clinic_${clinicId}__`));
    if (!isQueriesPost && !isGlobalSuperAdmin(groups) && !isMemberOfClinic) {
      return httpErr(403, 'Forbidden: not authorized for this clinic');
    }

    if (method === 'GET' && /^(patients|appointments|queries|operatories|providers|appointmenttypes|schedules)(\/|$)/.test(proxy)) {
      let fullPath: string;
      const m = /^patients\/(\d+)$/.exec(proxy);
      if (m) {
        const patNum = m[1];
        fullPath = `${API_BASE}/patients/Simple?PatNum=${patNum}`;
      } else {
        const qp = buildQueryString(queryParams);
        fullPath = `${API_BASE}/${proxy}${qp}`;
      }
      const headers = {
        Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
        'Content-Type': 'application/json',
      };
      const odRes = await makeOpenDentalRequest('GET', fullPath, headers, null);
      return formatResponse(odRes);
    }

    if (proxy === 'queries' && method === 'POST') {
      if (!body || !body.SqlCommand) return httpErr(400, 'Missing SqlCommand');
      const remoteDir = (creds.sftpRemoteDir || 'QuerytemplateCSV').replace(/^\/+|\/+$/g, '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const relativePath = `${remoteDir}/query_${timestamp}.csv`;
      const sftpAddress = `${creds.sftpHost}/${relativePath}`;

      const qp = buildQueryString(queryParams);
      const fullPath = `${API_BASE}/${proxy}${qp}`;

      const headers = {
        Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
        'Content-Type': 'application/json',
      };
      const apiBody = {
        SqlCommand: body.SqlCommand,
        SftpAddress: sftpAddress,
        SftpUsername: creds.sftpUsername,
        SftpPassword: creds.sftpPassword,
        SftpPort: creds.sftpPort || 22,
        IsAsync: 'false',
      };

      const apiResponse = await makeOpenDentalRequest('POST', fullPath, headers, JSON.stringify(apiBody));
      if (apiResponse.statusCode !== 201) return formatResponse(apiResponse);

      // Fetch CSV over SFTP using ssh2
      const csvData: string = await downloadLatestCsv({
        host: creds.sftpHost,
        port: creds.sftpPort || 22,
        username: creds.sftpUsername,
        password: creds.sftpPassword,
        remoteDir: remoteDir,
      });

      let jsonResult: any;
      if (csvData.trim() === 'OK') {
        jsonResult = { message: 'No results returned from query' };
      } else {
        jsonResult = parseCsv(csvData, { columns: true, skip_empty_lines: true, trim: true });
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(jsonResult) };
    }

    return httpErr(400, 'Unsupported request');
  } catch (err: any) {
    return httpErr(500, err?.message || 'Internal error');
  }
};

async function makeOpenDentalRequest(method: string, path: string, headers: Record<string, string>, body: string | null) {
  const options = { hostname: API_HOST, path, method, headers } as any;
  return new Promise<{ statusCode: number; headers: any; body: string }>((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function formatResponse(response: { statusCode: number; headers: any; body: string }) {
  let responseBody: any;
  try { responseBody = JSON.parse(response.body); } catch { responseBody = response.body; }
  return { statusCode: response.statusCode, headers: corsHeaders, body: JSON.stringify(responseBody) };
}

function safeParse(str: string): any {
  try { return JSON.parse(str); } catch { return {}; }
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

function httpErr(code: number, message: string): APIGatewayProxyResult {
  return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: message }) };
}

function buildQueryString(q: APIGatewayProxyEventQueryStringParameters): string {
  if (!q || Object.keys(q).length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (typeof v === 'string') params.append(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}



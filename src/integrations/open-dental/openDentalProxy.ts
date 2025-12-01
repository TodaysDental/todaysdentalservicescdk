import https from 'https';
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
import clinicsData from '../../infrastructure/configs/clinics.json';
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
  // Optional base path to honor preference of not including host in body
  // e.g., "dentistinnewbritain/QuerytemplateCSV"
  sftpAddress?: string;
};

const MODULE_NAME = 'Operations';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

const getCorsHeaders = (event: APIGatewayProxyEvent) =>
  buildCorsHeaders({ allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'] }, event.headers?.origin);


const API_HOST = 'api.opendental.com';
const API_BASE = '/api/v1';

// Build clinic credentials from imported clinic data to avoid large env vars
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';
const CONSOLIDATED_SFTP_PASSWORD = process.env.CONSOLIDATED_SFTP_PASSWORD || '';

const CLINIC_CREDS: Record<string, ClinicCreds> = (() => {
  const acc: Record<string, ClinicCreds> = {};
  (clinicsData as any[]).forEach((c: any) => {
    acc[String(c.clinicId)] = {
      developerKey: c.developerKey,
      customerKey: c.customerKey,
      sftpHost: CONSOLIDATED_SFTP_HOST,
      sftpPort: 22,
      sftpUsername: 'sftpuser',
      sftpPassword: CONSOLIDATED_SFTP_PASSWORD,
      sftpRemoteDir: 'QuerytemplateCSV',
    };
  });
  return acc;
})();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = getCorsHeaders(event);
  try {
    // Get user permissions from custom authorizer
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return httpErr(event, 401, 'Unauthorized - Invalid token');
    }

    const method = event.httpMethod;
    const proxy = event.pathParameters?.proxy || '';
    const clinicId = event.pathParameters?.clinicId || '';
    const queryParams = event.queryStringParameters || {};
    const body = event.body ? safeParse(event.body) : null;

    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (!clinicId || !proxy) {
      return httpErr(event, 400, 'Missing clinicId or proxy');
    }

    const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return httpErr(event, 403, 'Forbidden: no access to this clinic');
    }

    // Check access control for Operations module
    const isQueriesPost = method === 'POST' && proxy === 'queries';
    const permissionToCheck = isQueriesPost ? 'write' : requiredPermission;
    if (!hasModulePermission(
      userPerms.clinicRoles,
      MODULE_NAME,
      permissionToCheck,
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    )) {
      const permLabel = permissionToCheck;
      return httpErr(event, 403, `You do not have ${permLabel} permission for the ${MODULE_NAME} module`);
    }

    const creds = CLINIC_CREDS[clinicId];
    if (!creds) {
      return httpErr(event, 400, `No Open Dental credentials configured for clinicId=${clinicId}`);
    }

  // Handle Open Dental SQL queries with SFTP delivery FIRST
  if (proxy === 'queries' && method === 'POST') {
    if (!body || !body.SqlCommand) return httpErr(event, 400, 'Missing SqlCommand');

    // Validate SFTP credentials are available
    if (!creds.sftpHost) {
      console.error('CONSOLIDATED_SFTP_HOST is not configured or empty');
      return httpErr(event, 500, 'SFTP configuration error: Host not available');
    }
    if (!creds.sftpPassword) {
      console.error('CONSOLIDATED_SFTP_PASSWORD is not configured or empty');
      return httpErr(event, 500, 'SFTP configuration error: Password not available');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `query_${timestamp}.csv`;

    // Clean hostname - remove any protocol or trailing slashes
    const clean = (s: string) => (s || '').replace(/^(https?:\/\/)?/, '').replace(/^\/+|\/+$/g, '');
    const host = clean(creds.sftpHost);
    const username = clean(creds.sftpUsername);

    // Validate components
    if (!host) {
      console.error('SFTP Host is empty after cleaning:', creds.sftpHost);
      return httpErr(event, 500, 'SFTP configuration error: Invalid host');
    }
    if (!username) {
      console.error('SFTP Username is empty after cleaning:', creds.sftpUsername);
      return httpErr(event, 500, 'SFTP configuration error: Invalid username');
    }

    // CRITICAL FIX: Open Dental expects SftpAddress in format "hostname/path/to/file"
    // The Transfer Family auth lambda maps "/" to "/bucket/sftp-home/sftpuser"
    // So we need to provide just "hostname/filename.csv" which will write to the root
    // of the sftpuser's home directory
    const sftpAddress = `${host}/${fileName}`;

    console.log('=== Open Dental Query Debug ===');
    console.log('SFTP Host:', host);
    console.log('SFTP Username:', username);
    console.log('SFTP Address:', sftpAddress);
    console.log('Expected S3 Path: s3://bucket/sftp-home/sftpuser/' + fileName);
    console.log('CONSOLIDATED_SFTP_HOST env:', process.env.CONSOLIDATED_SFTP_HOST);
    console.log('CONSOLIDATED_SFTP_PASSWORD available:', !!process.env.CONSOLIDATED_SFTP_PASSWORD);

    const qp = buildQueryString(queryParams);
    const fullPath = `${API_BASE}/${proxy}${qp}`;

    const headers = {
      Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
      'Content-Type': 'application/json',
    };

    // Construct API body for Open Dental
    const apiBody = {
      SqlCommand: body.SqlCommand,
      SftpAddress: sftpAddress,
      SftpUsername: username,
      SftpPassword: creds.sftpPassword,
      SftpPort: creds.sftpPort || 22,
      IsAsync: 'false',
    };

    console.log('Open Dental API Request Body:', JSON.stringify({
      ...apiBody,
      SqlCommand: apiBody.SqlCommand.substring(0, 100) + '...',
      SftpPassword: '[REDACTED]'
    }, null, 2));

    // Send query to Open Dental API
    const apiResponse = await makeOpenDentalRequest('POST', fullPath, headers, JSON.stringify(apiBody));

    console.log('Open Dental API Response Status:', apiResponse.statusCode);
    console.log('Open Dental API Response Body:', apiResponse.body.substring(0, 500));

    if (apiResponse.statusCode !== 201) {
      console.error('Open Dental API returned non-201 status');
      return formatResponse(event, apiResponse);
    }

    // Wait a bit for Open Dental to write the file
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Fetch CSV over SFTP using ssh2
    // Look in the root directory (.) since that's where sftpuser's logical mapping points
    const csvData: string = await downloadLatestCsv({
      host: creds.sftpHost,
      port: creds.sftpPort || 22,
      username: username,
      password: creds.sftpPassword,
      remoteDir: '.', // Root directory for sftpuser
    });

    let jsonResult: any;
    if (csvData.trim() === 'OK') {
      jsonResult = { message: 'No results returned from query' };
    } else {
      jsonResult = parseCsv(csvData, { columns: true, skip_empty_lines: true, trim: true });
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(jsonResult) };
  }

  if (['GET', 'POST', 'PUT'].includes(method) && /^(patients|appointments|queries|operatories|providers|appointmenttypes|schedules|clockevents|userods|employees)(\/|$)/.test(proxy)) {
    let fullPath: string;
    // This special path logic is likely only for GET, but we'll keep it for compatibility.
    // POST/PUT requests will fall through to the else block.
    const m = /^patients\/(\d+)$/.exec(proxy);
    if (method === 'GET' && m) {
        const patNum = m[1];
        fullPath = `${API_BASE}/patients/Simple?PatNum=${patNum}`;
    } else {
        const qp = buildQueryString(queryParams);
        fullPath = `${API_BASE}/${proxy}${qp}`;
    }

    const headers = {
        'Authorization': `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
        'Content-Type': 'application/json',
    };

    // Conditionally include the body for POST and PUT requests
    const requestBody = (method === 'POST' || method === 'PUT') ? JSON.stringify(body) : null;

    const odRes = await makeOpenDentalRequest(method, fullPath, headers, requestBody);
    return formatResponse(event, odRes);
  }

  return httpErr(event, 400, 'Unsupported request');
  } catch (err: any) {
    return httpErr(event, 500, err?.message || 'Internal error');
  }
};

async function makeOpenDentalRequest(method: string, path: string, headers: Record<string, string>, body: string | null) {
  // Add Content-Length header when sending a body (required for proper HTTP POST)
  const finalHeaders = { ...headers };
  if (body) {
    finalHeaders['Content-Length'] = Buffer.byteLength(body).toString();
  }
  
  const options = { hostname: API_HOST, path, method, headers: finalHeaders } as any;
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

function formatResponse(event: APIGatewayProxyEvent, response: { statusCode: number; headers: any; body: string }) {
  let responseBody: any;
  try { responseBody = JSON.parse(response.body); } catch { responseBody = response.body; }
  return { statusCode: response.statusCode, headers: getCorsHeaders(event), body: JSON.stringify(responseBody) };
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

function httpErr(event: APIGatewayProxyEvent, code: number, message: string): APIGatewayProxyResult {
  return { statusCode: code, headers: getCorsHeaders(event), body: JSON.stringify({ error: message }) };
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

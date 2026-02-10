import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { makeOpenDentalRequest } from '../../shared/utils/opendental-api';
import { getGlobalSecret } from '../../shared/utils/secrets-helper';
import { renderConsentFormElements } from '../../shared/utils/consent-form-renderer';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

const INSTANCES_TABLE_NAME = process.env.INSTANCES_TABLE_NAME || '';
const TOKEN_INDEX_NAME = process.env.TOKEN_INDEX_NAME || 'TokenIndex';
const CONSOLIDATED_SFTP_HOST = process.env.CONSOLIDATED_SFTP_HOST || '';
const CONSOLIDATED_SFTP_BUCKET = process.env.CONSOLIDATED_SFTP_BUCKET || '';
const CONSOLIDATED_SFTP_USERNAME = process.env.CONSOLIDATED_SFTP_USERNAME || 'sftpuser';
const CONSENT_FORMS_SFTP_DIR = process.env.CONSENT_FORMS_SFTP_DIR || 'ConsentForms';
const MAX_PDF_SIZE_MB = (() => {
  const n = Number(process.env.MAX_PDF_SIZE_MB || '10');
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.min(Math.max(Math.floor(n), 1), 25);
})();

const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);
const getJsonHeaders = (event: APIGatewayProxyEvent) => ({
  ...getCorsHeaders(event),
  'Content-Type': 'application/json',
});

function json(event: APIGatewayProxyEvent, statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: getJsonHeaders(event),
    body: JSON.stringify(body),
  };
}

function err(event: APIGatewayProxyEvent, statusCode: number, message: string): APIGatewayProxyResult {
  return json(event, statusCode, { error: message });
}

function safeParseJson(s: string | null): any {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function stripDataUrlPrefix(b64: string): string {
  const s = String(b64 || '').trim();
  const idx = s.indexOf('base64,');
  if (idx >= 0) return s.slice(idx + 'base64,'.length).trim();
  return s;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isExpired(instance: any): boolean {
  const exp = Number(instance?.expires_at);
  return Number.isFinite(exp) && exp > 0 && nowSeconds() > exp;
}

function extractDocNum(uploadResponse: any): number | string | undefined {
  if (uploadResponse == null) return undefined;
  if (typeof uploadResponse === 'number') return uploadResponse;
  if (typeof uploadResponse === 'string') return uploadResponse;
  if (typeof uploadResponse === 'object') {
    const candidates = [
      (uploadResponse as any).DocNum,
      (uploadResponse as any).docNum,
      (uploadResponse as any).DocumentNum,
      (uploadResponse as any).documentNum,
      (uploadResponse as any).ImageNum,
      (uploadResponse as any).imageNum,
    ];
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c)) return c;
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
  }
  return undefined;
}

function safePathPart(s: string): string {
  return String(s || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function normalizeRemoteDir(dir: string): string {
  return String(dir || '').trim().replace(/^\/+|\/+$/g, '') || 'ConsentForms';
}

function buildRemotePath(filename: string): string {
  const dir = normalizeRemoteDir(CONSENT_FORMS_SFTP_DIR);
  const name = safePathPart(filename) || `consent-form-${Date.now()}.pdf`;
  return `${dir}/${name}`;
}

function buildS3KeyForSftpUser(remotePath: string): string {
  const user = String(CONSOLIDATED_SFTP_USERNAME || 'sftpuser').trim() || 'sftpuser';
  const rp = String(remotePath || '').replace(/^\/+/g, '');
  // Transfer Family logical root "/" maps to s3://<bucket>/sftp-home/<user> (see consolidatedTransferAuth.ts)
  return `sftp-home/${user}/${rp}`;
}

function buildSftpAddress(remotePath: string): string {
  const host = String(CONSOLIDATED_SFTP_HOST || '').trim().replace(/\/+$/g, '');
  const rp = String(remotePath || '').replace(/^\/+/g, '');
  return `${host}/${rp}`;
}

async function getInstanceByToken(token: string): Promise<any | null> {
  const resp = await docClient.send(new QueryCommand({
    TableName: INSTANCES_TABLE_NAME,
    IndexName: TOKEN_INDEX_NAME,
    // "token" is a DynamoDB reserved word; alias it in expressions.
    KeyConditionExpression: '#token = :t',
    ExpressionAttributeNames: { '#token': 'token' },
    ExpressionAttributeValues: { ':t': token },
    Limit: 1,
  }));
  return resp.Items && resp.Items.length > 0 ? resp.Items[0] : null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: getJsonHeaders(event), body: '' };
  }

  if (!INSTANCES_TABLE_NAME) {
    return err(event, 500, 'Server misconfiguration: missing INSTANCES_TABLE_NAME');
  }

  const httpMethod = event.httpMethod;
  const token = String(event.pathParameters?.token || '').trim();
  if (!token) return err(event, 400, 'token path param is required');

  const path = event.path || event.resource || '';
  const isSubmit = /\/submit\/?$/.test(path);

  try {
    // GET /consent-forms/instances/{token}
    if (httpMethod === 'GET' && !isSubmit) {
      const instance = await getInstanceByToken(token);
      if (!instance) return err(event, 404, 'Consent form link not found');
      if (isExpired(instance)) return err(event, 410, 'Consent form link expired');

      const hasRendered =
        !!instance?.rendered_at &&
        !!instance?.clinic_snapshot &&
        !!instance?.patient_snapshot;

      // If already rendered + snapped at creation, return without extra OpenDental calls.
      if (hasRendered) {
        return json(event, 200, {
          instance,
          patient: instance.patient_snapshot,
          clinic: instance.clinic_snapshot,
        });
      }

      // Fallback: render on-the-fly for older/scheduled instances.
      const clinicId = String(instance.clinicId || '').trim();
      const patNum = Number(instance.patNum);

      try {
        const render = await renderConsentFormElements({
          clinicId,
          patNum,
          elements: Array.isArray(instance.elements) ? instance.elements : [],
        });

        const renderedInstance = {
          ...instance,
          elements: render.renderedElements,
          rendered_at: instance.rendered_at || new Date().toISOString(),
          render_version: instance.render_version || 'v1',
          clinic_snapshot: instance.clinic_snapshot || render.snapshots.clinic,
          patient_snapshot: instance.patient_snapshot || render.snapshots.patient,
        };

        return json(event, 200, {
          instance: renderedInstance,
          patient: renderedInstance.patient_snapshot,
          clinic: renderedInstance.clinic_snapshot,
        });
      } catch (renderErr) {
        console.warn('[ConsentFormPublic] Render failed; returning instance as-is');
        return json(event, 200, {
          instance,
          patient: instance.patient_snapshot || { PatNum: instance.patNum },
          clinic: instance.clinic_snapshot || { clinicId: instance.clinicId },
        });
      }
    }

    // POST /consent-forms/instances/{token}/submit
    if (httpMethod === 'POST' && isSubmit) {
      const body = safeParseJson(event.body || null);
      const signedPdfBase64 = stripDataUrlPrefix(String(body?.signedPdfBase64 || body?.rawBase64 || '').trim());
      if (!signedPdfBase64) return err(event, 400, 'signedPdfBase64 (base64) is required');

      // Validate size (decode)
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = Buffer.from(signedPdfBase64, 'base64');
      } catch {
        return err(event, 400, 'Invalid base64 PDF payload');
      }

      const maxBytes = MAX_PDF_SIZE_MB * 1024 * 1024;
      if (pdfBuffer.length > maxBytes) {
        return err(event, 400, `PDF exceeds ${MAX_PDF_SIZE_MB}MB limit`);
      }

      const instance = await getInstanceByToken(token);
      if (!instance) return err(event, 404, 'Consent form link not found');
      if (isExpired(instance)) return err(event, 410, 'Consent form link expired');
      if (String(instance.status || '').toLowerCase() === 'signed') {
        return err(event, 409, 'Consent form already signed');
      }

      const clinicId = String(instance.clinicId || '').trim();
      const patNum = Number(instance.patNum);
      if (!clinicId || !Number.isFinite(patNum) || patNum <= 0) {
        return err(event, 500, 'Invalid instance data (missing clinicId/patNum)');
      }

      const description = String(body?.description || `Signed Consent Form - ${instance.templateName || 'Consent Form'}`).trim();
      const docCategory = (() => {
        const n = Number(body?.docCategory);
        // DocCategory is optional in OpenDental. If omitted, OpenDental defaults to the first
        // definition in category 18. Many clinics do not have DefNum=1 as a valid DocCategory.
        if (!Number.isFinite(n) || n <= 0) return undefined;
        return Math.floor(n);
      })();

      // Upload via AWS Transfer Family SFTP (OpenDental pulls the file securely)
      if (!CONSOLIDATED_SFTP_HOST || !CONSOLIDATED_SFTP_BUCKET) {
        return err(event, 500, 'Server misconfiguration: missing consolidated SFTP configuration');
      }

      const sftpPassword = await getGlobalSecret('consolidated_sftp', 'password');
      if (!sftpPassword) {
        return err(event, 500, 'Server misconfiguration: missing consolidated SFTP password');
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const rand = randomBytes(6).toString('hex');
      const filename = `consent-form_${safePathPart(clinicId)}_${patNum}_${ts}_${rand}.pdf`;
      const remotePath = buildRemotePath(filename); // e.g., ConsentForms/<filename>.pdf
      const s3Key = buildS3KeyForSftpUser(remotePath); // s3://bucket/sftp-home/sftpuser/<remotePath>
      const sftpAddress = buildSftpAddress(remotePath); // <host>/<remotePath>

      // 1) Upload PDF to the Transfer Family backing bucket (becomes available over SFTP immediately)
      await s3.send(new PutObjectCommand({
        Bucket: CONSOLIDATED_SFTP_BUCKET,
        Key: s3Key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }));

      // 2) Ask OpenDental to pull it in via Documents/UploadSftp
      const uploadPayload = {
        PatNum: patNum,
        SftpAddress: sftpAddress,
        SftpUsername: CONSOLIDATED_SFTP_USERNAME,
        SftpPassword: sftpPassword,
        Description: description,
        ImgType: 'Document',
        ...(docCategory ? { DocCategory: docCategory } : {}),
        DateCreated: new Date().toISOString().replace('T', ' ').substring(0, 19),
      };

      let uploadResponse: any;
      try {
        uploadResponse = await makeOpenDentalRequest(
          'POST',
          '/api/v1/documents/UploadSftp',
          clinicId,
          uploadPayload
        );
      } finally {
        // Best-effort cleanup of the temporary file in our SFTP bucket
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: CONSOLIDATED_SFTP_BUCKET, Key: s3Key }));
        } catch (cleanupErr) {
          console.warn('Failed to cleanup uploaded consent form PDF from S3:', cleanupErr);
        }
      }

      const docNum = extractDocNum(uploadResponse);
      const signedAt = new Date().toISOString();

      // Mark instance signed (best-effort idempotency)
      await docClient.send(new UpdateCommand({
        TableName: INSTANCES_TABLE_NAME,
        Key: { instance_id: instance.instance_id },
        ConditionExpression: 'attribute_not_exists(#status) OR #status <> :signed',
        UpdateExpression: 'SET #status = :signed, signed_at = :signedAt, opendental_doc_num = :docNum',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':signed': 'signed',
          ':signedAt': signedAt,
          ':docNum': docNum ?? null,
        },
      }));

      return json(event, 200, {
        success: true,
        opendental_doc_num: docNum,
      });
    }

    return err(event, 404, 'Not Found');
  } catch (e: any) {
    // ConditionExpression failure means it was already signed.
    if (String(e?.name || '').includes('ConditionalCheckFailed')) {
      return err(event, 409, 'Consent form already signed');
    }
    console.error('ConsentFormPublic error:', e);
    return err(event, 500, e?.message || 'Internal Server Error');
  }
};


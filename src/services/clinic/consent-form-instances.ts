import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getAllowedClinicIds,
  getUserDisplayName,
  getUserPermissions,
  hasClinicAccess,
  hasModulePermission,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { getClinicConfig } from '../../shared/utils/secrets-helper';
import { renderConsentFormElements } from '../../shared/utils/consent-form-renderer';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TEMPLATES_TABLE_NAME = process.env.TEMPLATES_TABLE_NAME || '';
const INSTANCES_TABLE_NAME = process.env.INSTANCES_TABLE_NAME || '';
const INSTANCES_BY_CLINIC_INDEX = process.env.INSTANCES_BY_CLINIC_INDEX || 'ClinicCreatedAtIndex';
const DEFAULT_TOKEN_TTL_DAYS = (() => {
  const n = Number(process.env.DEFAULT_TOKEN_TTL_DAYS || '7');
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.min(Math.max(Math.floor(n), 1), 365);
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

function generateToken(): string {
  // URL-safe token for patient-facing links
  return randomBytes(32).toString('base64url');
}

function buildSigningUrl(websiteLink: string | undefined, token: string): string {
  const base = String(websiteLink || '').trim().replace(/\/+$/g, '');
  if (!base) return `https://dentistinconcord.com/consent-form/${token}`;
  return `${base}/consent-form/${token}`;
}

function requireModulePermission(
  event: APIGatewayProxyEvent,
  userPerms: UserPermissions,
  permission: 'read' | 'write',
  clinicId?: string
): APIGatewayProxyResult | null {
  if (!hasModulePermission(
    userPerms.clinicRoles,
    'Operations',
    permission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    clinicId
  )) {
    return err(event, 403, `You do not have permission to ${permission} consent forms in the Operations module`);
  }
  return null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: getJsonHeaders(event), body: '' };
  }

  if (!TEMPLATES_TABLE_NAME || !INSTANCES_TABLE_NAME) {
    return err(event, 500, 'Server misconfiguration: missing table environment variables');
  }

  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return err(event, 401, 'Unauthorized - Invalid token');
  }

  const httpMethod = event.httpMethod;
  const consentFormId = event.pathParameters?.consentFormId;

  try {
    // POST /consent-forms/{consentFormId}/instances
    if (httpMethod === 'POST' && consentFormId) {
      const body = safeParseJson(event.body || null);
      const clinicId = String(body?.clinicId || '').trim();
      const patNum = Number(body?.patNum ?? body?.PatNum);
      const ttlDaysRaw = body?.expiresInDays ?? body?.ttlDays;
      const ttlDays = (() => {
        const n = Number(ttlDaysRaw);
        if (!Number.isFinite(n) || n <= 0) return DEFAULT_TOKEN_TTL_DAYS;
        return Math.min(Math.max(Math.floor(n), 1), 365);
      })();

      if (!clinicId) return err(event, 400, 'clinicId is required');
      if (!Number.isFinite(patNum) || patNum <= 0) return err(event, 400, 'patNum must be a positive number');

      // Ensure user has access to this clinic
      const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return err(event, 403, 'Forbidden: no access to this clinic');
      }

      // Permissions: write for this clinic
      const permErr = requireModulePermission(event, userPerms, 'write', clinicId);
      if (permErr) return permErr;

      // Load template and snapshot it into the instance
      const tmplResp = await docClient.send(new GetCommand({
        TableName: TEMPLATES_TABLE_NAME,
        Key: { consent_form_id: consentFormId },
      }));
      const template = tmplResp.Item as any;
      if (!template) return err(event, 404, 'Consent form template not found');

      const instanceId = uuidv4();
      const token = generateToken();
      const nowIso = new Date().toISOString();
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;

      // Best-effort clinic website lookup (for link generation)
      const clinicConfig = await getClinicConfig(clinicId);
      const signingUrl = buildSigningUrl(clinicConfig?.websiteLink, token);

      const templateElements = Array.isArray(template.elements) ? template.elements : [];

      // Render placeholders into a patient-specific snapshot (best-effort; do not block send on render failures)
      let renderedElements: any[] = templateElements;
      let clinicSnapshot: any | undefined;
      let patientSnapshot: any | undefined;
      let renderedAtIso: string | undefined;
      let renderVersion: string | undefined;
      try {
        const render = await renderConsentFormElements({
          clinicId,
          patNum,
          elements: templateElements,
          clinicConfig,
        });
        renderedElements = render.renderedElements;
        clinicSnapshot = render.snapshots?.clinic;
        patientSnapshot = render.snapshots?.patient;
        renderedAtIso = nowIso;
        renderVersion = 'v1';
      } catch (renderErr) {
        // Intentionally do not log patient-identifying info (PHI). Keep fallback behavior.
        console.warn('[ConsentFormInstances] Render failed; storing template elements as-is');
      }

      const item = {
        instance_id: instanceId,
        token,
        clinicId,
        patNum,
        consent_form_id: consentFormId,
        templateName: String(template.templateName || ''),
        language: String(template.language || 'en'),
        elements: renderedElements,
        status: 'sent',
        created_at: nowIso,
        sent_at: nowIso,
        expires_at: expiresAtSeconds, // DynamoDB TTL (epoch seconds)
        created_by: getUserDisplayName(userPerms),
        signing_url: signingUrl,
        ...(renderedAtIso ? { rendered_at: renderedAtIso } : {}),
        ...(renderVersion ? { render_version: renderVersion } : {}),
        ...(clinicSnapshot ? { clinic_snapshot: clinicSnapshot } : {}),
        ...(patientSnapshot ? { patient_snapshot: patientSnapshot } : {}),
      };

      await docClient.send(new PutCommand({
        TableName: INSTANCES_TABLE_NAME,
        Item: item,
      }));

      return json(event, 201, {
        instance_id: instanceId,
        token,
        clinicId,
        patNum,
        consent_form_id: consentFormId,
        templateName: item.templateName,
        language: item.language,
        status: item.status,
        expires_at: expiresAtSeconds,
        signing_url: signingUrl,
      });
    }

    // GET /consent-forms/instances?clinicId=...
    if (httpMethod === 'GET' && !consentFormId) {
      const clinicId = String(event.queryStringParameters?.clinicId || '').trim();
      if (!clinicId) return err(event, 400, 'clinicId query param is required');

      // Ensure user has access to this clinic
      const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return err(event, 403, 'Forbidden: no access to this clinic');
      }

      // Permissions: read for this clinic
      const permErr = requireModulePermission(event, userPerms, 'read', clinicId);
      if (permErr) return permErr;

      const limitRaw = event.queryStringParameters?.limit;
      const limit = (() => {
        const n = Number(limitRaw);
        if (!Number.isFinite(n) || n <= 0) return 100;
        return Math.min(Math.max(Math.floor(n), 1), 250);
      })();

      const resp = await docClient.send(new QueryCommand({
        TableName: INSTANCES_TABLE_NAME,
        IndexName: INSTANCES_BY_CLINIC_INDEX,
        KeyConditionExpression: 'clinicId = :cid',
        ExpressionAttributeValues: { ':cid': clinicId },
        ScanIndexForward: false, // newest first (created_at desc)
        Limit: limit,
      }));

      // Return lightweight entries for history listing (omit full elements)
      const instances = (resp.Items || []).map((i: any) => {
        const { elements, patient_snapshot, clinic_snapshot, ...rest } = i || {};
        return rest;
      });

      return json(event, 200, { instances });
    }

    // PATCH /consent-forms/{consentFormId}/instances — update instance status
    // Route: consentFormId is actually the instance_id in this context
    if (httpMethod === 'PATCH' && consentFormId) {
      const body = safeParseJson(event.body || null);
      const instanceId = consentFormId;
      const newStatus = String(body?.status || '').trim().toLowerCase();

      const VALID_STATUSES = ['sent', 'voided', 'resent'];
      if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
        return err(event, 400, `status is required and must be one of: ${VALID_STATUSES.join(', ')}`);
      }

      // Load instance to verify ownership
      const getResp = await docClient.send(new GetCommand({
        TableName: INSTANCES_TABLE_NAME,
        Key: { instance_id: instanceId },
      }));
      const existing = getResp.Item as any;
      if (!existing) return err(event, 404, 'Instance not found');

      const clinicId = String(existing.clinicId || '').trim();
      if (!clinicId) return err(event, 500, 'Instance is missing clinicId');

      // Permissions: write for this clinic
      const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
      if (!hasClinicAccess(allowedClinics, clinicId)) {
        return err(event, 403, 'Forbidden: no access to this clinic');
      }
      const permErr = requireModulePermission(event, userPerms, 'write', clinicId);
      if (permErr) return permErr;

      // Cannot change status of already-signed forms
      if (String(existing.status || '').toLowerCase() === 'signed') {
        return err(event, 409, 'Cannot update status of a signed consent form');
      }

      const updateExprParts = ['#status = :newStatus', 'updated_at = :now', 'updated_by = :user'];
      const exprValues: Record<string, any> = {
        ':newStatus': newStatus,
        ':now': new Date().toISOString(),
        ':user': getUserDisplayName(userPerms),
      };

      // If voiding, also remove the TTL so the record is preserved for analytics
      let removeExpr = '';
      if (newStatus === 'voided') {
        removeExpr = ' REMOVE expires_at';
      }

      await docClient.send(new UpdateCommand({
        TableName: INSTANCES_TABLE_NAME,
        Key: { instance_id: instanceId },
        UpdateExpression: `SET ${updateExprParts.join(', ')}${removeExpr}`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: exprValues,
      }));

      return json(event, 200, {
        instance_id: instanceId,
        status: newStatus,
        updated_at: exprValues[':now'],
      });
    }

    return err(event, 404, 'Not Found');
  } catch (e: any) {
    console.error('ConsentFormInstances error:', e);
    return err(event, 500, e?.message || 'Internal Server Error');
  }
};


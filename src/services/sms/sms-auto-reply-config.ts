/**
 * SMS AI Auto-Reply Configuration API
 *
 * Stores per-clinic configuration for AI auto-replies in the unified SMS messages table.
 *
 * Endpoints (protected by API Gateway authorizer):
 * - GET  /sms/{clinicId}/ai/auto-reply   -> returns config
 * - PUT  /sms/{clinicId}/ai/auto-reply   -> updates config (enabled + agentId)
 *
 * Storage (in SMS_MESSAGES_TABLE):
 * - pk: CLINIC#<clinicId>
 * - sk: CONFIG#AUTO_REPLY
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getUserDisplayName,
  type PermissionType,
} from '../../shared/utils/permissions-helper';

// ======================================================================================
// ENV
// ======================================================================================

const SMS_MESSAGES_TABLE = process.env.SMS_MESSAGES_TABLE || '';
const AI_AGENTS_TABLE = process.env.AI_AGENTS_TABLE || '';

// ======================================================================================
// CONFIG
// ======================================================================================

const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  PUT: 'put',
};

const CONFIG_SK = 'CONFIG#AUTO_REPLY';

// ======================================================================================
// CLIENTS
// ======================================================================================

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// ======================================================================================
// TYPES
// ======================================================================================

export interface SmsAutoReplyConfig {
  clinicId: string;
  enabled: boolean;
  agentId?: string;
  agentName?: string;
  updatedAt?: string;
  updatedBy?: string;
}

type UpdateRequestBody = {
  enabled: boolean;
  agentId?: string | null;
};

type AiAgentRecord = {
  agentId: string;
  name?: string;
  clinicId: string;
  isPublic?: boolean;
  isActive?: boolean;
  bedrockAgentStatus?: string;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
};

// ======================================================================================
// HELPERS
// ======================================================================================

function cors(event: APIGatewayProxyEvent) {
  return buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
}

function badRequest(headers: Record<string, string>, message: string) {
  return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: message }) };
}

async function getStoredConfig(clinicId: string): Promise<SmsAutoReplyConfig> {
  const resp = await ddb.send(new GetCommand({
    TableName: SMS_MESSAGES_TABLE,
    Key: {
      pk: `CLINIC#${clinicId}`,
      sk: CONFIG_SK,
    },
  }));

  const item = (resp.Item as any) || null;
  if (!item) {
    return {
      clinicId,
      enabled: false,
    };
  }

  return {
    clinicId,
    enabled: item.enabled === true,
    agentId: typeof item.agentId === 'string' ? item.agentId : undefined,
    agentName: typeof item.agentName === 'string' ? item.agentName : undefined,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    updatedBy: typeof item.updatedBy === 'string' ? item.updatedBy : undefined,
  };
}

async function validateAgentForClinic(clinicId: string, agentId: string): Promise<{ ok: boolean; agent?: AiAgentRecord; error?: string }> {
  if (!AI_AGENTS_TABLE) {
    return { ok: false, error: 'AI agents table not configured' };
  }

  const resp = await ddb.send(new GetCommand({
    TableName: AI_AGENTS_TABLE,
    Key: { agentId },
  }));

  const agent = resp.Item as AiAgentRecord | undefined;
  if (!agent) return { ok: false, error: 'Agent not found' };

  // Ensure agent belongs to clinic (or is public)
  if (agent.clinicId !== clinicId && agent.isPublic !== true) {
    return { ok: false, error: 'Agent does not belong to this clinic' };
  }

  if (agent.isActive !== true) {
    return { ok: false, error: 'Agent is not active' };
  }

  if (agent.bedrockAgentStatus !== 'PREPARED' || !agent.bedrockAgentId || !agent.bedrockAgentAliasId) {
    return { ok: false, error: 'Agent is not prepared. Please prepare the agent before enabling auto-replies.' };
  }

  return { ok: true, agent };
}

// ======================================================================================
// HANDLER
// ======================================================================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const headers = cors(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const clinicId = event.pathParameters?.clinicId;
  if (!clinicId) return badRequest(headers, 'clinicId is required');

  // Auth + permission check
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }

  const requiredPermission: PermissionType = METHOD_PERMISSIONS[event.httpMethod] || 'read';
  const allowed = hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    clinicId
  );
  if (!allowed) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Access denied' }) };
  }

  if (!SMS_MESSAGES_TABLE) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'SMS_MESSAGES_TABLE not configured' }) };
  }

  try {
    // GET current config
    if (event.httpMethod === 'GET') {
      const config = await getStoredConfig(clinicId);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, config }) };
    }

    // PUT update config
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}') as UpdateRequestBody;

      if (typeof body.enabled !== 'boolean') {
        return badRequest(headers, 'enabled (boolean) is required');
      }

      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';

      // UX: require explicit agent selection when enabled.
      if (body.enabled && !agentId) {
        return badRequest(headers, 'agentId is required when enabled=true');
      }

      let agentName: string | undefined = undefined;
      if (agentId) {
        const validation = await validateAgentForClinic(clinicId, agentId);
        if (!validation.ok) {
          return badRequest(headers, validation.error || 'Invalid agent');
        }
        agentName = validation.agent?.name;
      }

      const now = new Date().toISOString();
      const updatedBy = getUserDisplayName(userPerms);

      await ddb.send(new PutCommand({
        TableName: SMS_MESSAGES_TABLE,
        Item: {
          pk: `CLINIC#${clinicId}`,
          sk: CONFIG_SK,
          clinicId,
          enabled: body.enabled,
          agentId: agentId || undefined,
          agentName: agentName || undefined,
          updatedAt: now,
          updatedBy,
        },
      }));

      const config: SmsAutoReplyConfig = {
        clinicId,
        enabled: body.enabled,
        agentId: agentId || undefined,
        agentName,
        updatedAt: now,
        updatedBy,
      };

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, config }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  } catch (err: any) {
    console.error('[SmsAutoReplyConfig] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err?.message || 'Internal server error' }) };
  }
}


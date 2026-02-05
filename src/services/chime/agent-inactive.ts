import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt } from '../../shared/utils/permissions-helper';

const ddb = getDynamoDBClient();

const AGENT_ACTIVE_TABLE_NAME = process.env.AGENT_ACTIVE_TABLE_NAME;

function http(statusCode: number, body: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || undefined;
  const headers = buildCorsHeaders({ allowMethods: ['POST', 'OPTIONS'] }, origin);
  return { statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

function parseBody(event: APIGatewayProxyEvent): any {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

async function deleteAgentClinicRow(agentId: string, clinicId: string): Promise<void> {
  if (!AGENT_ACTIVE_TABLE_NAME) return;
  await ddb.send(new DeleteCommand({
    TableName: AGENT_ACTIVE_TABLE_NAME,
    Key: { clinicId, agentId },
  }));
}

async function listClinicsForAgent(agentId: string): Promise<string[]> {
  if (!AGENT_ACTIVE_TABLE_NAME) return [];

  const { Items } = await ddb.send(new QueryCommand({
    TableName: AGENT_ACTIVE_TABLE_NAME,
    IndexName: 'agentId-index',
    KeyConditionExpression: 'agentId = :agentId',
    ExpressionAttributeValues: { ':agentId': agentId },
    ProjectionExpression: 'clinicId',
  }));

  const clinicIds = (Items || [])
    .map((i: any) => i?.clinicId)
    .filter((v: any): v is string => typeof v === 'string' && v.length > 0);

  return Array.from(new Set(clinicIds));
}

/**
 * POST /admin/chime/agent/inactive
 * Body: { clinicIds?: string[] }
 * - If clinicIds provided: deactivate only those clinics
 * - Else: deactivate ALL clinics for the agent
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return http(200, { ok: true }, event);
  }

  if (!AGENT_ACTIVE_TABLE_NAME) {
    return http(500, { message: 'Server misconfiguration: AGENT_ACTIVE_TABLE_NAME not set' }, event);
  }

  const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
  const verifyResult = await verifyIdToken(authz);
  if (!verifyResult.ok) {
    return http(verifyResult.code || 401, { message: verifyResult.message }, event);
  }

  const agentId = getUserIdFromJwt(verifyResult.payload!);
  if (!agentId) {
    return http(400, { message: 'Invalid token: missing subject claim' }, event);
  }

  const body = parseBody(event);
  const clinicIds = Array.isArray(body?.clinicIds) ? body.clinicIds : null;
  const cleanedClinicIds = Array.isArray(clinicIds)
    ? clinicIds.map((c: any) => String(c || '').trim()).filter((c: string) => c.length > 0)
    : null;

  const clinicsToRemove = cleanedClinicIds && cleanedClinicIds.length > 0
    ? cleanedClinicIds
    : await listClinicsForAgent(agentId);

  if (clinicsToRemove.length === 0) {
    return http(200, { message: 'Agent already inactive', agentId, removed: 0 }, event);
  }

  const results = await Promise.allSettled(
    clinicsToRemove.map((clinicId: string) => deleteAgentClinicRow(agentId, clinicId))
  );

  const removed = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  return http(200, {
    message: 'Agent marked inactive',
    agentId,
    removed,
    failed,
    clinicIds: clinicsToRemove,
  }, event);
};


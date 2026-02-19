import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { DistributedLock } from './utils/distributed-lock';
import { isPushNotificationsEnabled, sendIncomingCallToAgents } from './utils/push-notifications';
import { TTL_POLICY } from './config/ttl-policy';

const ddb = getDynamoDBClient();

const AGENT_ACTIVE_TABLE_NAME = process.env.AGENT_ACTIVE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;

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

async function listActiveAgentsForClinic(clinicId: string): Promise<string[]> {
  if (!AGENT_ACTIVE_TABLE_NAME) return [];

  const { Items } = await ddb.send(new QueryCommand({
    TableName: AGENT_ACTIVE_TABLE_NAME,
    KeyConditionExpression: 'clinicId = :clinicId',
    FilterExpression: '#state = :active',
    ExpressionAttributeNames: { '#state': 'state' },
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':active': 'active',
    },
    ProjectionExpression: 'agentId',
  }));

  const agentIds = (Items || [])
    .map((i: any) => i?.agentId)
    .filter((v: any): v is string => typeof v === 'string' && v.length > 0);

  // De-dupe
  return Array.from(new Set(agentIds));
}

async function findNextQueuedCallForClinic(clinicId: string): Promise<any | null> {
  if (!CALL_QUEUE_TABLE_NAME) return null;

  // We don't have a status GSI; best-effort query a page and pick the oldest by queueEntryTime.
  const { Items } = await ddb.send(new QueryCommand({
    TableName: CALL_QUEUE_TABLE_NAME,
    KeyConditionExpression: 'clinicId = :clinicId',
    FilterExpression: '#status = :queued',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':queued': 'queued',
    },
    Limit: 50,
    ScanIndexForward: true,
  }));

  const queued = (Items || []).filter((i: any) => i && i.callId);
  if (queued.length === 0) return null;

  queued.sort((a: any, b: any) => {
    const aTs = typeof a.queueEntryTime === 'number' ? a.queueEntryTime : Number.MAX_SAFE_INTEGER;
    const bTs = typeof b.queueEntryTime === 'number' ? b.queueEntryTime : Number.MAX_SAFE_INTEGER;
    if (aTs !== bTs) return aTs - bTs;
    const aPos = typeof a.queuePosition === 'number' ? a.queuePosition : Number.MAX_SAFE_INTEGER;
    const bPos = typeof b.queuePosition === 'number' ? b.queuePosition : Number.MAX_SAFE_INTEGER;
    return aPos - bPos;
  });

  return queued[0];
}

async function ringQueuedCallForClinic(clinicId: string): Promise<{ ringedCallId?: string; notifiedAgents?: number; skipped?: string }> {
  if (!LOCKS_TABLE_NAME) {
    return { skipped: 'LOCKS_TABLE_NAME_not_configured' };
  }
  if (!CALL_QUEUE_TABLE_NAME) {
    return { skipped: 'CALL_QUEUE_TABLE_NAME_not_configured' };
  }

  // Fast-path: avoid acquiring a distributed lock (and querying AgentActive)
  // when there is no queued work for this clinic.
  const preCheckQueuedCall = await findNextQueuedCallForClinic(clinicId);
  if (!preCheckQueuedCall) {
    return { skipped: 'no_queued_calls' };
  }

  const lock = new DistributedLock(ddb, {
    tableName: LOCKS_TABLE_NAME,
    lockKey: `clinic-dispatch-${clinicId}`,
    ttlSeconds: 10,
    // Best-effort: if another dispatcher holds the lock, skip quickly.
    maxRetries: 1,
    retryDelayMs: 100,
  });

  const acquired = await lock.acquire();
  if (!acquired) {
    return { skipped: 'dispatch_lock_not_acquired' };
  }

  try {
    const call = await findNextQueuedCallForClinic(clinicId);
    if (!call) return { skipped: 'no_queued_calls' };

    const agentIds = await listActiveAgentsForClinic(clinicId);
    if (agentIds.length === 0) {
      return { skipped: 'no_active_agents' };
    }

    const ringAttemptTimestamp = new Date().toISOString();
    const nowMs = Date.now();
    const uniqueAgentIds = Array.from(new Set(agentIds)).slice(0, 25);

    try {
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId, queuePosition: call.queuePosition },
        UpdateExpression:
          'SET #status = :ringing, agentIds = :agentIds, ringStartTimeIso = :ts, ringStartTime = :now, lastStateChange = :ts, updatedAt = :ts',
        ConditionExpression: '#status = :queued',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':ringing': 'ringing',
          ':queued': 'queued',
          ':agentIds': uniqueAgentIds,
          ':ts': ringAttemptTimestamp,
          ':now': nowMs,
        },
      }));
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') {
        return { skipped: 'call_not_queued_anymore' };
      }
      throw err;
    }

    // Push offer (best-effort)
    if (isPushNotificationsEnabled()) {
      try {
        const callerPhoneNumber = typeof call.phoneNumber === 'string' ? call.phoneNumber : undefined;
        await sendIncomingCallToAgents(uniqueAgentIds, {
          callId: String(call.callId),
          clinicId,
          clinicName: clinicId,
          callerPhoneNumber,
          timestamp: ringAttemptTimestamp,
        });
      } catch (pushErr) {
        console.warn('[agent-active] Failed to send incoming call push (non-fatal):', pushErr);
      }
    }

    return { ringedCallId: String(call.callId), notifiedAgents: uniqueAgentIds.length };
  } finally {
    await lock.release().catch(() => {});
  }
}

/**
 * POST /admin/chime/agent/active
 * Body: { clinicIds: string[] }
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
  const clinicIds = Array.isArray(body?.clinicIds) ? body.clinicIds : [];
  const cleanedClinicIds = clinicIds
    .map((c: any) => String(c || '').trim())
    .filter((c: string) => c.length > 0);

  if (cleanedClinicIds.length === 0) {
    return http(400, { message: 'clinicIds array is required' }, event);
  }

  // Authorization: ensure agent can activate for these clinics
  for (const clinicId of cleanedClinicIds) {
    const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
    if (!authzCheck.authorized) {
      return http(403, { message: authzCheck.reason || `Forbidden for clinic ${clinicId}`, clinicId }, event);
    }
  }

  const updatedAt = new Date().toISOString();
  // Add TTL so stale entries auto-expire if the agent never calls agent/inactive
  // (e.g. app killed, network loss, phone turned off). Uses SESSION_MAX_SECONDS
  // so the entry lives as long as the maximum shift duration.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttl = nowSeconds + TTL_POLICY.SESSION_MAX_SECONDS;

  await Promise.allSettled(cleanedClinicIds.map(async (clinicId: string) => {
    await ddb.send(new PutCommand({
      TableName: AGENT_ACTIVE_TABLE_NAME,
      Item: {
        clinicId,
        agentId,
        state: 'active',
        updatedAt,
        ttl,
      },
    }));
  }));

  // Best-effort: if there are queued calls, ring one immediately for each clinic activated.
  const ringResults = await Promise.allSettled(
    cleanedClinicIds.map((clinicId: string) => ringQueuedCallForClinic(clinicId))
  );

  return http(200, {
    message: 'Agent marked active',
    agentId,
    clinicIds: cleanedClinicIds,
    dispatch: ringResults.map((r, idx) => ({
      clinicId: cleanedClinicIds[idx],
      ...(r.status === 'fulfilled' ? r.value : { error: String((r as any).reason?.message || (r as any).reason || 'dispatch_failed') }),
    })),
  }, event);
};


import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { checkClinicAuthorization, getUserIdFromJwt } from '../../shared/utils/permissions-helper';
import { DistributedLock } from './utils/distributed-lock';
import { isPushNotificationsEnabled, sendIncomingCallToAgents } from './utils/push-notifications';

const ddb = getDynamoDBClient();

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
const AGENT_ACTIVE_TABLE_NAME = process.env.AGENT_ACTIVE_TABLE_NAME;

const MAX_RING_AGENTS = Math.max(1, Number(process.env.MAX_RING_AGENTS || 25) || 25);

function http(statusCode: number, body: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || undefined;
  const headers = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, origin);
  return { statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

function parseBody(event: APIGatewayProxyEvent): any {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

function uniqStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
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

  return uniqStrings((Items || []).map((i: any) => i?.agentId)).slice(0, MAX_RING_AGENTS);
}

/**
 * POST /admin/chime/call-rejected-v2
 * Body: { callId: string }
 *
 * Push-first meeting-per-call flow:
 * - Remove this agent from the current ring list
 * - Track rejectedAgentIds to prevent immediate re-offers
 * - If no remaining ringing agents, re-offer to other active agents (AgentActive) if available
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return http(200, { ok: true }, event);
  }

  if (!CALL_QUEUE_TABLE_NAME) return http(500, { message: 'Server misconfiguration: CALL_QUEUE_TABLE_NAME not set' }, event);
  if (!LOCKS_TABLE_NAME) return http(500, { message: 'Server misconfiguration: LOCKS_TABLE_NAME not set' }, event);
  if (!AGENT_ACTIVE_TABLE_NAME) return http(500, { message: 'Server misconfiguration: AGENT_ACTIVE_TABLE_NAME not set' }, event);

  // 1) Authenticate
  const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
  const verifyResult = await verifyIdToken(authz);
  if (!verifyResult.ok) {
    return http(verifyResult.code || 401, { message: verifyResult.message }, event);
  }

  const agentId = getUserIdFromJwt(verifyResult.payload!);
  if (!agentId) return http(400, { message: 'Invalid token: missing subject claim' }, event);

  // 2) Parse request
  const body = parseBody(event);
  const callId = String(body?.callId || '').trim();
  if (!callId) return http(400, { message: 'callId is required' }, event);

  // 3) Acquire lock to avoid racing with acceptance/other rejections
  const lock = new DistributedLock(ddb, {
    tableName: LOCKS_TABLE_NAME,
    lockKey: `call-assignment-${callId}`,
    ttlSeconds: 30,
    maxRetries: 10,
    retryDelayMs: 150,
  });

  const acquired = await lock.acquire();
  if (!acquired) return http(409, { message: 'Call is being handled by another agent. Please try again.', callId }, event);

  try {
    // 4) Lookup call (GSI)
    const { Items: callRecords } = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1,
    }));

    if (!callRecords || callRecords.length === 0) {
      return http(404, { message: 'Call not found', callId }, event);
    }

    const callRecord = callRecords[0] as any;
    const clinicId: string = String(callRecord.clinicId || '').trim();
    const queuePosition: number = Number(callRecord.queuePosition);
    if (!clinicId || !Number.isFinite(queuePosition)) {
      return http(500, { message: 'Corrupt call record (missing clinicId/queuePosition)', callId }, event);
    }

    // 5) Authorization
    const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
    if (!authzCheck.authorized) {
      return http(403, { message: authzCheck.reason || 'Forbidden', callId, clinicId }, event);
    }

    // 6) Re-fetch authoritative state (consistent read)
    const { Item: freshCall } = await ddb.send(new GetCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, queuePosition },
      ConsistentRead: true,
    }));
    if (!freshCall) return http(404, { message: 'Call not found', callId }, event);

    const status = String((freshCall as any).status || '');
    if (status !== 'ringing') {
      return http(409, { message: 'Call is no longer ringing', callId, status }, event);
    }

    const ringList = uniqStrings(Array.isArray((freshCall as any).agentIds) ? (freshCall as any).agentIds : []);
    const existingRejected = uniqStrings(Array.isArray((freshCall as any).rejectedAgentIds) ? (freshCall as any).rejectedAgentIds : []);

    if (!ringList.includes(agentId)) {
      // Idempotent: call already re-offered or removed from this agent's ring list.
      return http(200, { message: 'Agent is not in ring list (noop)', callId, agentId, status }, event);
    }

    const rejectedAgentIds = uniqStrings([...existingRejected, agentId]);
    const remainingRingAgents = ringList.filter((id) => id !== agentId);
    const nowIso = new Date().toISOString();

    if (remainingRingAgents.length > 0) {
      // Keep call ringing for remaining agents (no new push needed).
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId, queuePosition },
        UpdateExpression: 'SET agentIds = :agentIds, rejectedAgentIds = :rejected, updatedAt = :ts, lastStateChange = :ts',
        ConditionExpression: '#status = :ringing AND contains(agentIds, :agentId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':ringing': 'ringing',
          ':agentId': agentId,
          ':agentIds': remainingRingAgents,
          ':rejected': rejectedAgentIds,
          ':ts': nowIso,
        },
      }));

      return http(200, {
        message: 'Call rejected; still ringing for other agents',
        callId,
        clinicId,
        agentId,
        status: 'ringing',
        remainingAgents: remainingRingAgents.length,
      }, event);
    }

    // No remaining ringing agents. Re-offer to other active agents (excluding rejected).
    const activeAgentIds = await listActiveAgentsForClinic(clinicId);
    const nextRingAgents = activeAgentIds.filter((id) => !rejectedAgentIds.includes(id)).slice(0, MAX_RING_AGENTS);

    if (nextRingAgents.length === 0) {
      // Nothing else to do; return to queued state.
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId, queuePosition },
        UpdateExpression:
          'SET #status = :queued, rejectedAgentIds = :rejected, updatedAt = :ts, lastStateChange = :ts REMOVE agentIds, ringStartTimeIso, ringStartTime',
        ConditionExpression: '#status = :ringing AND contains(agentIds, :agentId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':ringing': 'ringing',
          ':queued': 'queued',
          ':agentId': agentId,
          ':rejected': rejectedAgentIds,
          ':ts': nowIso,
        },
      }));

      return http(200, {
        message: 'Call rejected; no other active agents available. Call re-queued.',
        callId,
        clinicId,
        agentId,
        status: 'queued',
      }, event);
    }

    // Re-ring to new active agents and send push
    const ringAttemptTimestamp = new Date().toISOString();
    const callerPhoneNumber = typeof (freshCall as any).phoneNumber === 'string' ? (freshCall as any).phoneNumber : undefined;

    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, queuePosition },
      UpdateExpression:
        'SET #status = :ringing, agentIds = :agentIds, rejectedAgentIds = :rejected, ringStartTimeIso = :ts, ringStartTime = :now, lastStateChange = :ts, updatedAt = :ts',
      ConditionExpression: '#status = :ringing AND contains(agentIds, :agentId)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':ringing': 'ringing',
        ':agentId': agentId,
        ':agentIds': nextRingAgents,
        ':rejected': rejectedAgentIds,
        ':ts': ringAttemptTimestamp,
        ':now': Date.now(),
      },
    }));

    if (isPushNotificationsEnabled()) {
      try {
        await sendIncomingCallToAgents(nextRingAgents, {
          callId,
          clinicId,
          clinicName: clinicId,
          callerPhoneNumber,
          timestamp: ringAttemptTimestamp,
        });
      } catch (pushErr) {
        console.warn('[call-rejected-v2] Failed to send push offer (non-fatal):', pushErr);
      }
    }

    return http(200, {
      message: 'Call rejected; re-offered to other active agents',
      callId,
      clinicId,
      agentId,
      status: 'ringing',
      reofferedAgents: nextRingAgents.length,
    }, event);
  } catch (error: any) {
    console.error('[call-rejected-v2] Error:', {
      message: error?.message,
      name: error?.name,
      callId,
      agentId,
    });
    return http(500, { message: 'Internal server error', error: error?.message }, event);
  } finally {
    await lock.release().catch(() => { });
  }
};


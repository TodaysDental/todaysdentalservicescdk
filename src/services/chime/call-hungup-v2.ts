import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { checkClinicAuthorization, getUserIdFromJwt } from '../../shared/utils/permissions-helper';
import { getSmaIdForClinic } from './utils/sma-map';
import { DistributedLock } from './utils/distributed-lock';

const ddb = getDynamoDBClient();

const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
const AGENT_ACTIVE_TABLE_NAME = process.env.AGENT_ACTIVE_TABLE_NAME;

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

/**
 * POST /admin/chime/call-hungup-v2
 * Body: { callId: string }
 *
 * Minimal push-first lifecycle endpoint:
 * - Requests SMA to hang up the call legs (CALL_UPDATE_REQUESTED -> Hangup)
 * - Best-effort resets AgentActive state (busy -> active) for the assigned agent
 *
 * NOTE: CallQueue final status + meeting cleanup are handled by the SMA handler (inbound-router.ts)
 * when it receives HANGUP/CALL_ENDED events.
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

  // 3) Lock (serialize with accept/reject)
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
    // 4) Lookup call record by callId (GSI)
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

    // 5) Authorization: agent must have access to clinic
    const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
    if (!authzCheck.authorized) {
      return http(403, { message: authzCheck.reason || 'Forbidden', callId, clinicId }, event);
    }

    // 6) Re-fetch consistent state and enforce caller is the assigned agent (if assigned)
    const { Item: freshCall } = await ddb.send(new GetCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, queuePosition },
      ConsistentRead: true,
    }));
    if (!freshCall) return http(404, { message: 'Call not found', callId }, event);

    const status = String((freshCall as any).status || '');
    const assignedAgentId = typeof (freshCall as any).assignedAgentId === 'string' ? String((freshCall as any).assignedAgentId).trim() : '';

    if (assignedAgentId && assignedAgentId !== agentId) {
      return http(403, { message: 'Forbidden: you are not the assigned agent for this call', callId, clinicId }, event);
    }

    // 7) Request hangup via SMA (best-effort)
    const smaId = getSmaIdForClinic(clinicId);
    if (smaId) {
      try {
        await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
          SipMediaApplicationId: smaId,
          TransactionId: callId,
          Arguments: {
            Action: 'Hangup',
          },
        }));
      } catch (smaErr) {
        console.warn('[call-hungup-v2] SMA hangup request failed (non-fatal):', smaErr);
      }
    } else {
      console.warn('[call-hungup-v2] Missing SMA mapping for clinic (cannot request hangup)', { callId, clinicId });
    }

    // 8) Best-effort: reset AgentActive busy -> active
    if (assignedAgentId) {
      try {
        const nowIso = new Date().toISOString();
        await ddb.send(new UpdateCommand({
          TableName: AGENT_ACTIVE_TABLE_NAME,
          Key: { clinicId, agentId: assignedAgentId },
          UpdateExpression: 'SET #state = :active, updatedAt = :ts REMOVE currentCallId',
          ConditionExpression: 'attribute_exists(clinicId) AND attribute_exists(agentId) AND #state = :busy AND currentCallId = :callId',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':active': 'active',
            ':busy': 'busy',
            ':callId': callId,
            ':ts': nowIso,
          },
        }));
      } catch (agentErr: any) {
        if (agentErr?.name !== 'ConditionalCheckFailedException') {
          console.warn('[call-hungup-v2] Failed to reset AgentActive state (non-fatal):', agentErr);
        }
      }
    }

    return http(200, { message: 'Hangup requested', callId, clinicId, status }, event);
  } catch (error: any) {
    console.error('[call-hungup-v2] Error:', {
      message: error?.message,
      name: error?.name,
      callId,
    });
    return http(500, { message: 'Internal server error', error: error?.message }, event);
  } finally {
    await lock.release().catch(() => { });
  }
};


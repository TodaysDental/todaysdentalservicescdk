import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import {
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingCommand,
  DeleteAttendeeCommand,
  Attendee,
} from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { getSmaIdForClinic } from './utils/sma-map';
import { DistributedLock } from './utils/distributed-lock';
import { TTL_POLICY } from './config/ttl-policy';

const ddb = getDynamoDBClient();

const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
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
 * POST /admin/chime/call-accepted-v2
 *
 * Push-first meeting-per-call flow:
 * - Claim a ringing call (first answer wins)
 * - Ensure per-call meeting + customer attendee exist
 * - Create agent attendee and return meeting credentials
 * - Notify SMA to bridge the PSTN leg into the meeting (BRIDGE_CUSTOMER_INBOUND)
 * - Mark AgentActive row busy
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

  // 3) Acquire lock to prevent race conditions
  const lock = new DistributedLock(ddb, {
    tableName: LOCKS_TABLE_NAME,
    lockKey: `call-assignment-${callId}`,
    ttlSeconds: 30,
    maxRetries: 10,
    retryDelayMs: 150,
  });

  const acquired = await lock.acquire();
  if (!acquired) {
    return http(409, { message: 'Call is being assigned to another agent', callId }, event);
  }

  try {
    // 4) Find call record by callId (GSI)
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

    // 5) Authorization: agent must be allowed for this clinic
    const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
    if (!authzCheck.authorized) {
      return http(403, { message: authzCheck.reason || 'Forbidden', callId, clinicId }, event);
    }

    // 6) Re-fetch authoritative call state (consistent read on primary key)
    const { Item: freshCall } = await ddb.send(new GetCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, queuePosition },
      ConsistentRead: true,
    }));

    if (!freshCall) return http(404, { message: 'Call not found', callId }, event);

    const status = String((freshCall as any).status || '');
    const ringList: string[] = Array.isArray((freshCall as any).agentIds)
      ? ((freshCall as any).agentIds as any[]).filter((v) => typeof v === 'string')
      : [];

    if (status !== 'ringing') {
      return http(409, { message: 'Call is no longer available', callId, status }, event);
    }
    if (!ringList.includes(agentId)) {
      return http(403, { message: 'You are not authorized to accept this call offer', callId }, event);
    }

    // 7) Claim call and mark agent busy (atomic)
    const timestamp = new Date().toISOString();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const extendedTTL = nowSeconds + TTL_POLICY.ACTIVE_CALL_SECONDS;

    try {
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId, queuePosition },
              UpdateExpression:
                'SET #status = :accepting, assignedAgentId = :agentId, acceptedAt = :timestamp, #ttl = :ttl, #version = if_not_exists(#version, :zero) + :one',
              ConditionExpression:
                '#status = :ringing AND (attribute_not_exists(assignedAgentId) OR assignedAgentId = :agentId) AND contains(agentIds, :agentId)',
              ExpressionAttributeNames: {
                '#status': 'status',
                '#ttl': 'ttl',
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':accepting': 'accepting',
                ':ringing': 'ringing',
                ':agentId': agentId,
                ':timestamp': timestamp,
                ':ttl': extendedTTL,
                ':zero': 0,
                ':one': 1,
              },
            },
          },
          {
            Update: {
              TableName: AGENT_ACTIVE_TABLE_NAME,
              Key: { clinicId, agentId },
              UpdateExpression: 'SET #state = :busy, currentCallId = :callId, updatedAt = :ts',
              ConditionExpression:
                'attribute_exists(clinicId) AND attribute_exists(agentId) AND #state = :active',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':busy': 'busy',
                ':active': 'active',
                ':callId': callId,
                ':ts': timestamp,
              },
            },
          },
        ],
      }));
    } catch (err: any) {
      if (err?.name === 'TransactionCanceledException') {
        return http(409, {
          message: 'Call is no longer available. It may have been accepted by another agent.',
          callId,
          agentId,
          reasons: err.CancellationReasons,
        }, event);
      }
      throw err;
    }

    // 8) Ensure per-call meeting + customer attendee exist (create if missing)
    let meetingInfo: any = (freshCall as any).meetingInfo;
    let meetingId: string | undefined =
      (freshCall as any).meetingId ||
      (freshCall as any).meetingInfo?.MeetingId;
    let customerAttendee: any = (freshCall as any).customerAttendeeInfo;

    if (!meetingId || !customerAttendee?.AttendeeId || !customerAttendee?.JoinToken) {
      const meetingResponse = await chime.send(new CreateMeetingCommand({
        ClientRequestToken: randomUUID(),
        MediaRegion: CHIME_MEDIA_REGION,
        ExternalMeetingId: callId,
      }));
      meetingInfo = meetingResponse.Meeting;
      meetingId = meetingInfo?.MeetingId;
      if (!meetingId) {
        throw new Error('Failed to create meeting (missing MeetingId)');
      }

      const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: `customer-${callId}`.slice(0, 64),
      }));
      customerAttendee = customerAttendeeResponse.Attendee;
      if (!customerAttendee?.AttendeeId || !customerAttendee?.JoinToken) {
        throw new Error('Failed to create customer attendee (missing AttendeeId/JoinToken)');
      }

      // Persist meeting + customer attendee for router + cleanup
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId, queuePosition },
        UpdateExpression: 'SET meetingId = :meetingId, meetingInfo = :meetingInfo, customerAttendeeInfo = :customerAttendee, updatedAt = :ts',
        ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':accepting': 'accepting',
          ':agentId': agentId,
          ':meetingId': meetingId,
          ':meetingInfo': meetingInfo,
          ':customerAttendee': customerAttendee,
          ':ts': new Date().toISOString(),
        },
      }));
    }

    // 9) Create agent attendee and persist to call record
    let agentAttendee: Attendee;
    try {
      const agentAttendeeResponse = await chime.send(new CreateAttendeeCommand({
        MeetingId: meetingId!,
        ExternalUserId: `agent-${agentId}-${Date.now()}`.slice(0, 64),
      }));
      if (!agentAttendeeResponse.Attendee?.AttendeeId || !agentAttendeeResponse.Attendee?.JoinToken) {
        throw new Error('Invalid attendee data returned from Chime');
      }
      agentAttendee = agentAttendeeResponse.Attendee;
    } catch (attendeeErr) {
      // Roll back call + agent state so the call can be retried by another agent.
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId, queuePosition },
              UpdateExpression: 'SET #status = :ringing REMOVE assignedAgentId, acceptedAt',
              ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':ringing': 'ringing',
                ':accepting': 'accepting',
                ':agentId': agentId,
              },
            },
          },
          {
            Update: {
              TableName: AGENT_ACTIVE_TABLE_NAME,
              Key: { clinicId, agentId },
              UpdateExpression: 'SET #state = :active, updatedAt = :ts REMOVE currentCallId',
              ConditionExpression: '#state = :busy AND currentCallId = :callId',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':active': 'active',
                ':busy': 'busy',
                ':callId': callId,
                ':ts': new Date().toISOString(),
              },
            },
          },
        ],
      })).catch(() => {});

      return http(500, { message: 'Failed to create agent meeting credentials', error: (attendeeErr as any)?.message || 'attendee_create_failed' }, event);
    }

    // Store agent attendee info for diagnostics / cleanup
    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, queuePosition },
      UpdateExpression: 'SET agentAttendeeInfo = :agentAttendee, updatedAt = :ts',
      ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':accepting': 'accepting',
        ':agentId': agentId,
        ':agentAttendee': agentAttendee,
        ':ts': new Date().toISOString(),
      },
    })).catch(() => {});

    // 10) Notify SMA to bridge the waiting customer PSTN leg into the meeting
    const smaId = getSmaIdForClinic(clinicId);
    if (!smaId) {
      // Cleanup orphaned agent attendee
      await chime.send(new DeleteAttendeeCommand({
        MeetingId: meetingId!,
        AttendeeId: agentAttendee.AttendeeId!,
      })).catch(() => {});

      // Roll back state
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId, queuePosition },
              UpdateExpression: 'SET #status = :ringing REMOVE assignedAgentId, acceptedAt, agentAttendeeInfo',
              ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':ringing': 'ringing',
                ':accepting': 'accepting',
                ':agentId': agentId,
              },
            },
          },
          {
            Update: {
              TableName: AGENT_ACTIVE_TABLE_NAME,
              Key: { clinicId, agentId },
              UpdateExpression: 'SET #state = :active, updatedAt = :ts REMOVE currentCallId',
              ConditionExpression: '#state = :busy AND currentCallId = :callId',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':active': 'active',
                ':busy': 'busy',
                ':callId': callId,
                ':ts': new Date().toISOString(),
              },
            },
          },
        ],
      })).catch(() => {});

      return http(500, { message: 'SIP configuration not found for this clinic' }, event);
    }

    try {
      await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: callId,
        Arguments: {
          action: 'BRIDGE_CUSTOMER_INBOUND',
          meetingId: meetingId!,
          customerAttendeeId: customerAttendee.AttendeeId!,
          customerAttendeeJoinToken: customerAttendee.JoinToken!,
        },
      }));
    } catch (smaErr) {
      // Cleanup orphaned agent attendee
      await chime.send(new DeleteAttendeeCommand({
        MeetingId: meetingId!,
        AttendeeId: agentAttendee.AttendeeId!,
      })).catch(() => {});

      // Roll back call + agent state (so call can be retried)
      await ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId, queuePosition },
              UpdateExpression: 'SET #status = :ringing REMOVE assignedAgentId, acceptedAt, agentAttendeeInfo',
              ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':ringing': 'ringing',
                ':accepting': 'accepting',
                ':agentId': agentId,
              },
            },
          },
          {
            Update: {
              TableName: AGENT_ACTIVE_TABLE_NAME,
              Key: { clinicId, agentId },
              UpdateExpression: 'SET #state = :active, updatedAt = :ts REMOVE currentCallId',
              ConditionExpression: '#state = :busy AND currentCallId = :callId',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: {
                ':active': 'active',
                ':busy': 'busy',
                ':callId': callId,
                ':ts': new Date().toISOString(),
              },
            },
          },
        ],
      })).catch(() => {});

      return http(500, { message: 'Failed to bridge call. Please try again.', error: 'SMA_BRIDGE_FAILED' }, event);
    }

    // 11) Mark call connected and remove ring list
    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, queuePosition },
      UpdateExpression: 'SET #status = :connected, connectedAt = :ts, updatedAt = :ts REMOVE agentIds',
      ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':connected': 'connected',
        ':accepting': 'accepting',
        ':agentId': agentId,
        ':ts': new Date().toISOString(),
      },
    })).catch(() => {});

    // 12) Return meeting credentials to agent client
    return http(200, {
      message: 'Call accepted',
      callId,
      agentId,
      clinicId,
      status: 'connected',
      meeting: meetingInfo,
      attendee: agentAttendee,
    }, event);
  } catch (error: any) {
    console.error('[call-accepted-v2] Error:', {
      message: error?.message,
      name: error?.name,
      callId: (event as any)?.body ? (() => { try { return JSON.parse((event as any).body).callId; } catch { return undefined; } })() : undefined,
    });
    return http(500, { message: 'Internal server error', error: error?.message }, event);
  } finally {
    await lock.release().catch(() => {});
  }
};


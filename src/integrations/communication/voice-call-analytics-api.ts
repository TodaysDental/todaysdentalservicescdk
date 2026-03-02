/**
 * Voice Call Analytics API Handler
 *
 * Provides API endpoints for querying outbound voice call analytics:
 * - GET /call-analytics/dashboard?clinicId=...&periodDays=30
 * - GET /call-analytics/calls?clinicId=...&status=...&limit=...&nextToken=...
 * - GET /call-analytics/calls/{callId}
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getAllowedClinicIds,
  hasClinicAccess,
} from '../../shared/utils/permissions-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const VOICE_CALL_ANALYTICS_TABLE = process.env.VOICE_CALL_ANALYTICS_TABLE!;
const MODULE_NAME = 'Marketing';

const getCors = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

function http(code: number, body: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: code,
    headers: getCors(event),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function encodeToken(key: any): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64');
}

function decodeToken(token?: string | null): any | undefined {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return http(204, '', event);

  const userPerms = getUserPermissions(event);
  if (!userPerms) return http(401, { error: 'Unauthorized - Invalid token' }, event);

  if (
    !hasModulePermission(
      userPerms.clinicRoles,
      MODULE_NAME,
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    )
  ) {
    return http(403, { error: 'You do not have permission to view voice call analytics' }, event);
  }

  const allowedClinics = getAllowedClinicIds(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  const path = event.path || '';
  try {
    if (path.includes('/call-analytics/dashboard')) {
      return await handleDashboard(event, allowedClinics);
    }

    if (path.match(/\/call-analytics\/calls\/[^/]+$/)) {
      return await handleGetCall(event, allowedClinics);
    }

    if (path.includes('/call-analytics/calls')) {
      return await handleListCalls(event, allowedClinics);
    }

    return http(404, { error: 'Not Found' }, event);
  } catch (err: any) {
    console.error('Voice call analytics error:', err);
    return http(500, { error: 'Internal Server Error' }, event);
  }
};

async function handleDashboard(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const q = event.queryStringParameters || {};
  const clinicId = String(q.clinicId || '').trim();
  const periodDays = Math.min(Math.max(parseInt(String(q.periodDays || '30'), 10) || 30, 1), 365);

  if (!clinicId) return http(400, { error: 'clinicId is required' }, event);
  if (!allowedClinics.has('*') && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'No access to this clinic' }, event);
  }

  const startIso = isoDaysAgo(periodDays);
  const nowIso = new Date().toISOString();

  const totals = {
    total: 0,
    initiated: 0,
    answered: 0,
    completed: 0,
    failed: 0,
  };

  const recentCalls: any[] = [];
  let lastKey: any = undefined;

  // Paginate to get accurate totals; collect only the first 10 items for the recent list
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: VOICE_CALL_ANALYTICS_TABLE,
        IndexName: 'clinicId-startedAt-index',
        KeyConditionExpression: 'clinicId = :cid AND startedAt BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':cid': clinicId,
          ':start': startIso,
          ':end': nowIso,
        },
        ScanIndexForward: false,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      })
    );

    for (const it of (result.Items || []) as any[]) {
      totals.total++;
      const status = String(it.status || '').toUpperCase();
      if (status === 'INITIATED') totals.initiated++;
      if (status === 'ANSWERED') totals.answered++;
      if (status === 'COMPLETED') totals.completed++;
      if (status === 'FAILED') totals.failed++;

      if (recentCalls.length < 10) {
        recentCalls.push({
          callId: it.callId,
          clinicId: it.clinicId,
          patNum: it.patNum,
          patientName: it.patientName,
          recipientPhone: it.recipientPhone,
          templateName: it.templateName,
          scheduleId: it.scheduleId,
          status: it.status,
          startedAt: it.startedAt,
          answeredAt: it.answeredAt,
          endedAt: it.endedAt,
          endReason: it.endReason,
          sipResponseCode: it.sipResponseCode,
          voiceId: it.voiceId,
        });
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  const answerRate = totals.total > 0 ? Math.round((totals.answered / totals.total) * 10000) / 100 : 0;
  const completionRate = totals.total > 0 ? Math.round((totals.completed / totals.total) * 10000) / 100 : 0;
  const failureRate = totals.total > 0 ? Math.round((totals.failed / totals.total) * 10000) / 100 : 0;

  return http(
    200,
    {
      success: true,
      clinicId,
      periodDays,
      window: { start: startIso, end: nowIso },
      totals: { ...totals, answerRate, completionRate, failureRate },
      recentCalls,
    },
    event
  );
}

async function handleListCalls(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const q = event.queryStringParameters || {};
  const clinicId = String(q.clinicId || '').trim();
  const status = q.status ? String(q.status).trim().toUpperCase() : undefined;
  const limit = Math.min(Math.max(parseInt(String(q.limit || '50'), 10) || 50, 1), 100);
  const nextToken = decodeToken(q.nextToken);

  if (!clinicId) return http(400, { error: 'clinicId is required' }, event);
  if (!allowedClinics.has('*') && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'No access to this clinic' }, event);
  }

  const res = await ddb.send(
    new QueryCommand({
      TableName: VOICE_CALL_ANALYTICS_TABLE,
      IndexName: 'clinicId-startedAt-index',
      KeyConditionExpression: 'clinicId = :cid',
      ExpressionAttributeValues: {
        ':cid': clinicId,
        ...(status ? { ':status': status } : {}),
      },
      ...(status
        ? {
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
          }
        : {}),
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: nextToken,
    })
  );

  const items = (res.Items || []) as any[];
  const token = res.LastEvaluatedKey ? encodeToken(res.LastEvaluatedKey) : undefined;

  return http(
    200,
    {
      success: true,
      clinicId,
      calls: items,
      hasMore: !!token,
      nextToken: token,
    },
    event
  );
}

async function handleGetCall(
  event: APIGatewayProxyEvent,
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const callId = event.pathParameters?.callId || (event.path || '').split('/').pop() || '';
  const id = String(callId).trim();
  if (!id) return http(400, { error: 'callId is required' }, event);

  const res = await ddb.send(
    new GetCommand({
      TableName: VOICE_CALL_ANALYTICS_TABLE,
      Key: { callId: id },
    })
  );

  if (!res.Item) return http(404, { error: 'Not Found' }, event);

  const item: any = res.Item;
  const clinicId = String(item.clinicId || '');
  if (clinicId && !allowedClinics.has('*') && !hasClinicAccess(allowedClinics, clinicId)) {
    return http(403, { error: 'No access to this clinic' }, event);
  }

  return http(200, { success: true, call: item }, event);
}


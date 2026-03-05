import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { PriorityQueueManager } from './utils/priority-queue';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const priorityManager = new PriorityQueueManager(ddb, process.env.CALL_QUEUE_TABLE_NAME!);

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;

interface QueuedCall {
  callId: string;
  clinicId: string;
  phoneNumber: string;
  status: string;
  priority: string;
  priorityScore: number;
  isVip: boolean;
  isCallback: boolean;
  queuedAt: number;
  queuePosition: string;
  waitTime: number;
  customerName?: string;
  reason?: string;
}

interface ActiveCall {
  callId: string;
  clinicId: string;
  phoneNumber: string;
  status: string;
  assignedAgentId: string;
  agentName?: string;
  connectedAt?: number;
  duration: number;
  isOnHold: boolean;
  supervisors?: Array<{
    supervisorId: string;
    mode: string;
    joinedAt: number;
  }>;
}

/**
 * GET JOINABLE CALLS
 * 
 * Returns all calls that can be joined by the requesting user:
 * - Queued calls (for agents/supervisors to pick up)
 * - Active calls (for supervisors to monitor/join)
 * 
 * Filtered by:
 * - User's clinic access
 * - User's role permissions
 * 
 * GET /call-center/get-joinable-calls?clinicId=xxx
 * Optional query params:
 * - clinicId: Filter by specific clinic (if omitted, returns all accessible clinics)
 * - includeQueued: Include queued calls (default: true)
 * - includeActive: Include active calls (default: true for supervisors, false for agents)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin;
  const corsHeaders = buildCorsHeaders({}, requestOrigin);

  try {
    // JWT authorizer places claims as flat properties on event.requestContext.authorizer
    const authorizer = event.requestContext.authorizer || {};
    const userId = authorizer.email || authorizer.sub || '';
    const rolesRaw = authorizer.roles || authorizer.clinicRoles || '';
    const roles = typeof rolesRaw === 'string' ? (rolesRaw ? rolesRaw.split(',') : []) : (Array.isArray(rolesRaw) ? rolesRaw : []);
    const isSuperAdmin = authorizer.isSuperAdmin === 'true' || authorizer.isGlobalSuperAdmin === 'true';
    const activeClinicIdsRaw = authorizer.activeClinicIds || '';
    const activeClinicIds = typeof activeClinicIdsRaw === 'string' ? (activeClinicIdsRaw ? activeClinicIdsRaw.split(',') : []) : (Array.isArray(activeClinicIdsRaw) ? activeClinicIdsRaw : []);

    if (!userId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized: No user ID' })
      };
    }

    const queryParams = event.queryStringParameters || {};
    const requestedClinicId = queryParams.clinicId;
    const includeQueued = queryParams.includeQueued !== 'false'; // Default true
    const isSupervisor = isSuperAdmin || roles.includes('supervisor') || roles.includes('admin');
    const includeActive = queryParams.includeActive === 'true' || isSupervisor; // Default true for supervisors

    console.log('[get-joinable-calls] Request from user:', {
      userId,
      isSupervisor,
      requestedClinicId,
      includeQueued,
      includeActive
    });

    // Get user's accessible clinics
    const agentClinicIds = activeClinicIds;
    const clinicIdsToQuery = requestedClinicId ? [requestedClinicId] : agentClinicIds;

    if (clinicIdsToQuery.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          queuedCalls: [],
          activeCalls: [],
          summary: {
            totalQueued: 0,
            totalActive: 0,
            clinics: []
          }
        })
      };
    }

    // Verify access to requested clinic
    if (requestedClinicId && !isSupervisor && !agentClinicIds.includes(requestedClinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'You do not have access to this clinic' })
      };
    }

    const queuedCalls: QueuedCall[] = [];
    const activeCalls: ActiveCall[] = [];
    const now = Date.now();

    // Fetch calls for each clinic
    const settled = await Promise.allSettled(
      clinicIdsToQuery.map(async (clinicId) => {
        const { Items: calls } = await ddb.send(new QueryCommand({
          TableName: CALL_QUEUE_TABLE_NAME,
          KeyConditionExpression: 'clinicId = :clinicId',
          ExpressionAttributeValues: { ':clinicId': clinicId }
        }));
        return { clinicId, calls: calls || [] };
      })
    );

    for (const [idx, s] of settled.entries()) {
      if (s.status === 'rejected') {
        console.error(`[get-joinable-calls] Error fetching calls for clinic ${clinicIdsToQuery[idx]}:`, s.reason);
        continue;
      }

      for (const call of s.value.calls) {
        if (includeQueued && call.status === 'queued') {
          const waitTime = call.queuedAt ? Math.floor((now - call.queuedAt) / 1000) : 0;

          const PRIORITY_WEIGHTS: Record<string, number> = { high: 1000, normal: 100, low: 10 };
          let priorityScore = PRIORITY_WEIGHTS[call.priority || 'normal'] || 100;
          if (call.isVip) priorityScore += 500;
          if (call.isCallback) priorityScore += 300;
          priorityScore += Math.min(waitTime, 600) * 2;
          if (waitTime > 900) priorityScore += 1000;

          queuedCalls.push({
            callId: call.callId,
            clinicId: call.clinicId,
            phoneNumber: call.phoneNumber || 'Unknown',
            status: call.status,
            priority: call.priority || 'normal',
            priorityScore,
            isVip: call.isVip || false,
            isCallback: call.isCallback || false,
            queuedAt: call.queuedAt,
            queuePosition: call.queuePosition,
            waitTime,
            customerName: call.customerName,
            reason: call.reason
          });
        }

        if (includeActive && ['connected', 'on-hold', 'ringing'].includes(call.status)) {
          const duration = call.connectedAt ? Math.floor((now - call.connectedAt) / 1000) : 0;

          let agentName;
          if (call.assignedAgentId) {
            try {
              const { Item: agent } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: call.assignedAgentId }
              }));
              agentName = agent?.name || agent?.agentId;
            } catch (err) {
              console.warn(`[get-joinable-calls] Could not fetch agent name for ${call.assignedAgentId}`);
            }
          }

          activeCalls.push({
            callId: call.callId,
            clinicId: call.clinicId,
            phoneNumber: call.phoneNumber || 'Unknown',
            status: call.status,
            assignedAgentId: call.assignedAgentId,
            agentName,
            connectedAt: call.connectedAt,
            duration,
            isOnHold: call.status === 'on-hold',
            supervisors: call.supervisors || []
          });
        }
      }
    }

    // Sort queued calls by composite priority score (highest first — most urgent on top)
    queuedCalls.sort((a, b) => b.priorityScore - a.priorityScore);

    // Sort active calls by duration (longest first)
    activeCalls.sort((a, b) => b.duration - a.duration);

    const response = {
      queuedCalls,
      activeCalls,
      summary: {
        totalQueued: queuedCalls.length,
        totalActive: activeCalls.length,
        clinics: clinicIdsToQuery,
        longestQueueWait: queuedCalls.length > 0 ? Math.max(...queuedCalls.map(c => c.waitTime)) : 0,
        longestCallDuration: activeCalls.length > 0 ? Math.max(...activeCalls.map(c => c.duration)) : 0,
        vipInQueue: queuedCalls.filter(c => c.isVip).length,
        callbacksInQueue: queuedCalls.filter(c => c.isCallback).length,
        callsOnHold: activeCalls.filter(c => c.isOnHold).length
      },
      capabilities: {
        canJoinQueued: includeQueued,
        canJoinActive: isSupervisor,
        canMonitor: isSupervisor,
        canBarge: isSupervisor
      }
    };

    console.log('[get-joinable-calls] Response summary:', {
      userId,
      queuedCount: queuedCalls.length,
      activeCount: activeCalls.length,
      clinics: clinicIdsToQuery.length
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('[get-joinable-calls] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Failed to fetch joinable calls',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};


import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;

export type MonitorMode = 'silent' | 'barge' | 'whisper';

/**
 * JOIN ACTIVE CALL
 * 
 * Allows supervisors to join active calls for monitoring, coaching, or assistance.
 * 
 * Modes:
 * - silent: Listen only (muted, can hear both parties)
 * - barge: Join and speak (all parties can hear)
 * - whisper: Coach agent only (customer can't hear) - FUTURE ENHANCEMENT
 * 
 * POST /call-center/join-active-call
 * Body: { 
 *   callId: string, 
 *   clinicId: string,
 *   mode: 'silent' | 'barge' | 'whisper'
 * }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin;
  const corsHeaders = buildCorsHeaders({}, requestOrigin);

  try {
    const authContext = JSON.parse(event.requestContext.authorizer?.context || '{}');
    const supervisorId = authContext.email;
    const roles = authContext.roles || [];

    if (!supervisorId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized: No supervisor ID' })
      };
    }

    // Only supervisors and admins can join active calls
    const isSupervisor = roles.includes('supervisor') || roles.includes('admin');
    if (!isSupervisor) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Forbidden: Only supervisors can join active calls',
          requiredRole: 'supervisor'
        })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { callId, clinicId, mode = 'silent' } = body;

    if (!callId || !clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'callId and clinicId are required' })
      };
    }

    if (!['silent', 'barge', 'whisper'].includes(mode)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Invalid mode. Must be: silent, barge, or whisper',
          validModes: ['silent', 'barge', 'whisper']
        })
      };
    }

    console.log(`[join-active-call] Supervisor ${supervisorId} joining call ${callId} in ${mode} mode`);

    // 1. Get the active call
    const { Item: callRecord } = await ddb.send(new GetCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, callId }
    }));

    if (!callRecord) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Call not found' })
      };
    }

    // Only allow joining calls that are actually active
    const joinableStatuses = ['connected', 'on-hold', 'ringing'];
    if (!joinableStatuses.includes(callRecord.status)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: `Cannot join call with status: ${callRecord.status}`,
          currentStatus: callRecord.status,
          joinableStatuses
        })
      };
    }

    if (!callRecord.meetingId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Call does not have an active meeting' })
      };
    }

    // 2. Check if supervisor is already on this call
    const existingSupervisors = callRecord.supervisors || [];
    const alreadyJoined = existingSupervisors.some((s: any) => s.supervisorId === supervisorId);
    
    if (alreadyJoined) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'You are already on this call',
          existingMode: existingSupervisors.find((s: any) => s.supervisorId === supervisorId)?.mode
        })
      };
    }

    // 3. Create attendee for supervisor
    const supervisorAttendeeResponse = await chime.send(new CreateAttendeeCommand({
      MeetingId: callRecord.meetingId,
      ExternalUserId: `supervisor-${supervisorId}-${mode}-${Date.now()}`
    }));

    const supervisorAttendeeInfo = supervisorAttendeeResponse.Attendee;

    // 4. Update call record to track supervisor joining
    const now = Date.now();
    const supervisorInfo = {
      supervisorId,
      mode,
      attendeeInfo: supervisorAttendeeInfo,
      joinedAt: now
    };

    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, callId },
      UpdateExpression: `
        SET supervisors = list_append(if_not_exists(supervisors, :emptyList), :supervisor),
            supervisorJoinHistory = list_append(if_not_exists(supervisorJoinHistory, :emptyList), :joinEvent),
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':supervisor': [supervisorInfo],
        ':joinEvent': [{
          supervisorId,
          mode,
          joinedAt: now,
          action: 'joined'
        }],
        ':emptyList': [],
        ':now': now
      }
    }));

    // 5. Log supervisor activity
    console.log('[join-active-call] Supervisor joined call', {
      callId,
      supervisorId,
      mode,
      agentId: callRecord.assignedAgentId,
      meetingId: callRecord.meetingId
    });

    // 6. Optionally update agent presence to notify them of monitoring
    if (callRecord.assignedAgentId && mode === 'barge') {
      try {
        await ddb.send(new UpdateCommand({
          TableName: AGENT_PRESENCE_TABLE_NAME,
          Key: { agentId: callRecord.assignedAgentId },
          UpdateExpression: 'SET supervisorMonitoring = :true, updatedAt = :now',
          ExpressionAttributeValues: {
            ':true': true,
            ':now': now
          }
        }));
      } catch (agentUpdateErr) {
        console.warn('[join-active-call] Could not notify agent of monitoring:', agentUpdateErr);
        // Non-fatal - continue
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: `Successfully joined call in ${mode} mode`,
        callId,
        meetingId: callRecord.meetingId,
        supervisorAttendee: supervisorAttendeeInfo,
        meetingInfo: callRecord.meetingInfo,
        mode,
        callDetails: {
          agentId: callRecord.assignedAgentId,
          customerPhone: callRecord.phoneNumber,
          status: callRecord.status,
          connectedAt: callRecord.connectedAt,
          duration: callRecord.connectedAt ? Math.floor((now - callRecord.connectedAt) / 1000) : 0
        },
        instructions: {
          silent: mode === 'silent' ? 'You are in listen-only mode. Mute your microphone.' : undefined,
          barge: mode === 'barge' ? 'You can speak. All parties will hear you.' : undefined,
          whisper: mode === 'whisper' ? 'Coach mode - only agent will hear you (coming soon)' : undefined
        }
      })
    };

  } catch (error) {
    console.error('[join-active-call] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Failed to join active call',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};


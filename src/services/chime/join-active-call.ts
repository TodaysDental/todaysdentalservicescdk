import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { DistributedLock } from './utils/distributed-lock';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';

const ddb = getDynamoDBClient();
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;

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
    // CRITICAL FIX: Use JWT verification instead of relying on authorizer context
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      console.warn('[join-active-call] Auth verification failed', { 
        code: verifyResult.code, 
        message: verifyResult.message 
      });
      return { 
        statusCode: verifyResult.code || 401, 
        headers: corsHeaders, 
        body: JSON.stringify({ message: verifyResult.message }) 
      };
    }

    const supervisorId = getUserIdFromJwt(verifyResult.payload!);
    if (!supervisorId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Unauthorized: No supervisor ID' })
      };
    }

    // Only supervisors and admins can join active calls
    const payload = verifyResult.payload as any;
    const roles = payload.roles || payload['custom:roles'] || [];
    const isSupervisor = roles.includes('supervisor') || roles.includes('admin') || 
                         payload.isSuperAdmin || payload.isGlobalSuperAdmin;
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

    // 1. Get the active call - use callId-index GSI since we don't have queuePosition
    const { Items: callRecords } = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId }
    }));
    
    const callRecord = callRecords && callRecords.length > 0 ? callRecords[0] : null;

    if (!callRecord) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Call not found' })
      };
    }

    // CRITICAL FIX: Verify supervisor is authorized for the clinic
    const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
    if (!authzCheck.authorized) {
      console.warn('[join-active-call] Supervisor not authorized for clinic', {
        supervisorId,
        clinicId,
        reason: authzCheck.reason
      });
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'You are not authorized to monitor calls for this clinic',
          reason: authzCheck.reason
        })
      };
    }

    // Only allow joining calls that are actually active
    // FIX: Use 'on_hold' (underscore) to match other handlers
    const joinableStatuses = ['connected', 'on_hold', 'ringing'];
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

    // CRITICAL FIX: Use correct field name - meetingInfo.MeetingId (not meetingId)
    const meetingId = callRecord.meetingInfo?.MeetingId;
    if (!meetingId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Call does not have an active meeting' })
      };
    }

    // CRITICAL FIX: Use distributed lock to prevent race conditions
    // FIX: Use callId-only lock to serialize ALL supervisor joins to this call
    // Previous bug: per-supervisor lock allowed concurrent joins from different supervisors
    if (!LOCKS_TABLE_NAME) {
      console.error('[join-active-call] LOCKS_TABLE_NAME not configured');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'System configuration error' })
      };
    }

    const lock = new DistributedLock(ddb, {
      tableName: LOCKS_TABLE_NAME,
      lockKey: `supervisor-join-call-${callId}`, // FIX: Lock on callId only, not callId+supervisorId
      ttlSeconds: 10,
      maxRetries: 3,
      retryDelayMs: 100
    });

    const lockAcquired = await lock.acquire();
    if (!lockAcquired) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Join operation already in progress. Please try again.' })
      };
    }

    try {
      // Re-fetch call record with consistent read after acquiring lock
      const { Items: freshCallRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId },
        ConsistentRead: false // GSI doesn't support consistent read, but lock prevents races
      }));
      
      const freshCallRecord = freshCallRecords && freshCallRecords.length > 0 ? freshCallRecords[0] : null;
      if (!freshCallRecord) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Call no longer exists' })
        };
      }

      // 2. Check if supervisor is already on this call (with fresh data)
      const existingSupervisors = freshCallRecord.supervisors || [];
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

      // FIX #8: Validate meeting exists before creating attendee
      // GSI eventual consistency can show stale data - meeting may have been deleted
      const freshMeetingId = freshCallRecord.meetingInfo?.MeetingId;
      if (!freshMeetingId) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Call no longer has an active meeting' })
        };
      }
      
      try {
        await chime.send(new GetMeetingCommand({ MeetingId: freshMeetingId }));
        console.log(`[join-active-call] Meeting ${freshMeetingId} validated - exists`);
      } catch (meetingErr: any) {
        if (meetingErr.name === 'NotFoundException') {
          console.error(`[join-active-call] Meeting ${freshMeetingId} no longer exists`);
          return {
            statusCode: 409,
            headers: corsHeaders,
            body: JSON.stringify({
              message: 'Cannot join call - meeting no longer exists',
              error: 'MEETING_NOT_FOUND'
            })
          };
        }
        throw meetingErr; // Re-throw other errors
      }

      // 3. Create attendee for supervisor using validated meetingId
      const supervisorAttendeeResponse = await chime.send(new CreateAttendeeCommand({
        MeetingId: freshMeetingId,
        ExternalUserId: `supervisor-${supervisorId}-${mode}-${Date.now()}`
      }));

      const supervisorAttendeeInfo = supervisorAttendeeResponse.Attendee;

      // 4. Update call record to track supervisor joining
      // FIX: Use correct key structure { clinicId, queuePosition }
      const { queuePosition } = freshCallRecord;
      const now = Date.now();
      const supervisorInfo = {
        supervisorId,
        mode,
        attendeeInfo: supervisorAttendeeInfo,
        joinedAt: now
      };

      // FIX: Add ConditionExpression to verify call is still in joinable state
      // This prevents race condition where call ends between status check and update
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId, queuePosition },
        UpdateExpression: `
          SET supervisors = list_append(if_not_exists(supervisors, :emptyList), :supervisor),
              supervisorJoinHistory = list_append(if_not_exists(supervisorJoinHistory, :emptyList), :joinEvent),
              updatedAt = :now
        `,
        ConditionExpression: '#status IN (:connected, :onHold, :ringing)',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':supervisor': [supervisorInfo],
          ':joinEvent': [{
            supervisorId,
            mode,
            joinedAt: now,
            action: 'joined'
          }],
          ':emptyList': [],
          ':now': now,
          ':connected': 'connected',
          ':onHold': 'on_hold',
          ':ringing': 'ringing'
        }
      }));

      // 5. Log supervisor activity
      console.log('[join-active-call] Supervisor joined call', {
        callId,
        supervisorId,
        mode,
        agentId: freshCallRecord.assignedAgentId,
        meetingId
      });

      // 6. FIX #5: Update agent presence to notify them of monitoring for ALL modes
      // Previously only barge mode was flagged - this is inconsistent and may violate
      // call monitoring disclosure requirements in some jurisdictions
      if (freshCallRecord.assignedAgentId) {
        try {
          await ddb.send(new UpdateCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId: freshCallRecord.assignedAgentId },
            UpdateExpression: 'SET supervisorMonitoring = :true, supervisorMonitoringMode = :mode, supervisorId = :supervisorId, updatedAt = :now',
            ExpressionAttributeValues: {
              ':true': true,
              ':mode': mode,
              ':supervisorId': supervisorId,
              ':now': now
            }
          }));
          console.log('[join-active-call] Agent notified of monitoring', { 
            agentId: freshCallRecord.assignedAgentId, 
            mode,
            supervisorId 
          });
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
          meetingId,
          supervisorAttendee: supervisorAttendeeInfo,
          meetingInfo: freshCallRecord.meetingInfo,
          mode,
          callDetails: {
            agentId: freshCallRecord.assignedAgentId,
            customerPhone: freshCallRecord.phoneNumber,
            status: freshCallRecord.status,
            connectedAt: freshCallRecord.connectedAt,
            duration: freshCallRecord.connectedAt ? Math.floor((now - freshCallRecord.connectedAt) / 1000) : 0
          },
          instructions: {
            silent: mode === 'silent' ? 'You are in listen-only mode. Mute your microphone.' : undefined,
            barge: mode === 'barge' ? 'You can speak. All parties will hear you.' : undefined,
            whisper: mode === 'whisper' ? 'Coach mode - only agent will hear you (coming soon)' : undefined
          }
        })
      };
    } finally {
      // CRITICAL FIX: Always release the lock
      await lock.release();
    }

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


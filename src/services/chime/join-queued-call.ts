import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand, DeleteAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { getSmaIdForClinic } from './utils/sma-map';
import { DistributedLock } from './utils/distributed-lock';

const ddb = getDynamoDBClient();
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;

/**
 * JOIN QUEUED CALL
 * 
 * Allows an agent or supervisor to manually pick up a call waiting in queue.
 * 
 * Features:
 * - Manual call assignment to specific agent
 * - Priority override for supervisors
 * - Automatic meeting creation and bridging
 * - Distributed locking to prevent race conditions
 * - Atomic database updates
 * 
 * POST /call-center/join-queued-call
 * Body: { callId: string, clinicId: string }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin;
  const corsHeaders = buildCorsHeaders({}, requestOrigin);

  try {
    // CRITICAL FIX #4: Add proper JWT verification like all other handlers
    const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      console.warn('[join-queued-call] Auth verification failed', { 
        code: verifyResult.code, 
        message: verifyResult.message 
      });
      return { 
        statusCode: verifyResult.code || 401, 
        headers: corsHeaders, 
        body: JSON.stringify({ message: verifyResult.message }) 
      };
    }
    
    const agentId = getUserIdFromJwt(verifyResult.payload!);
    if (!agentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Invalid token: missing subject claim' })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { callId, clinicId } = body;

    if (!callId || !clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'callId and clinicId are required' })
      };
    }

    console.log(`[join-queued-call] Agent ${agentId} attempting to join queued call ${callId} for clinic ${clinicId}`);

    // 1. Verify agent has access to this clinic using proper authorization check
    const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
    if (!authzCheck.authorized) {
      console.warn('[join-queued-call] Authorization failed', {
        agentId,
        clinicId,
        reason: authzCheck.reason
      });
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: authzCheck.reason || 'You do not have access to this clinic' })
      };
    }

    // FIX: Validate LOCKS_TABLE_NAME is configured
    if (!LOCKS_TABLE_NAME) {
      console.error('[join-queued-call] LOCKS_TABLE_NAME not configured');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'System configuration error' })
      };
    }

    // FIX: Acquire distributed lock BEFORE any state checks to prevent race conditions
    // Use same lock key pattern as call-accepted.ts for consistency
    const lock = new DistributedLock(ddb, {
      tableName: LOCKS_TABLE_NAME,
      lockKey: `call-assignment-${callId}`,
      ttlSeconds: 30,
      maxRetries: 10,
      retryDelayMs: 150
    });

    const lockAcquired = await lock.acquire();
    if (!lockAcquired) {
      console.warn('[join-queued-call] Failed to acquire lock - call being processed', { callId, agentId });
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Call is being assigned to another agent. Please try again.' })
      };
    }

    try {
      // 2. Get the queued call - CRITICAL FIX #1: Use QueryCommand on callId-index GSI
      // The CallQueueTable uses { clinicId, queuePosition } as primary key, not { clinicId, callId }
      const { Items: callRecords } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId }
      }));

      if (!callRecords || callRecords.length === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Call not found' })
        };
      }

      const callRecord = callRecords[0];
      const { queuePosition } = callRecord;

      // Verify clinicId matches
      if (callRecord.clinicId !== clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Call does not belong to specified clinic' })
        };
      }

      if (callRecord.status !== 'queued') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: `Call is not in queue. Current status: ${callRecord.status}` 
          })
        };
      }

      // 3. Check agent availability
      const { Item: agentPresence } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId }
      }));

      if (!agentPresence) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Agent session not found. Please start your session first.' })
        };
      }

      // CRITICAL FIX #3: Use 'Online' status (not 'idle') - consistent with rest of codebase
      if (agentPresence.status !== 'Online') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: `You must be available to pick up a call. Current status: ${agentPresence.status}`,
            currentStatus: agentPresence.status
          })
        };
      }

      // FIX: Check if agent already has a call
      if (agentPresence.currentCallId || agentPresence.ringingCallId) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'You are already on a call or have a call ringing',
            currentCallId: agentPresence.currentCallId,
            ringingCallId: agentPresence.ringingCallId
          })
        };
      }

      // CRITICAL FIX #2: Use getSmaIdForClinic() - Clinics table doesn't have sipMediaApplicationId field
      const smaId = getSmaIdForClinic(clinicId);
      if (!smaId) {
        console.error('[join-queued-call] Missing SMA mapping for clinic', { clinicId });
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'SIP configuration not found for this clinic' })
        };
      }

      // 5. Create or reuse meeting for this call
      let meetingId = callRecord.meetingId;
      let meetingInfo = callRecord.meetingInfo;

      // FIX: Validate existing meeting exists before reusing
      if (meetingId) {
        try {
          await chime.send(new GetMeetingCommand({ MeetingId: meetingId }));
          console.log(`[join-queued-call] Existing meeting ${meetingId} validated`);
        } catch (meetingErr: any) {
          if (meetingErr.name === 'NotFoundException') {
            console.warn(`[join-queued-call] Meeting ${meetingId} not found, creating new one`);
            meetingId = null;
            meetingInfo = null;
          } else {
            throw meetingErr;
          }
        }
      }

      if (!meetingId) {
        console.log('[join-queued-call] Creating new meeting for queued call');
        const meetingResponse = await chime.send(new CreateMeetingCommand({
          ExternalMeetingId: `queue-${clinicId}-${callId}`,
          MediaRegion: CHIME_MEDIA_REGION
        }));
        meetingId = meetingResponse.Meeting!.MeetingId!;
        meetingInfo = meetingResponse.Meeting;
      }

      // 6. Create attendee for agent
      const agentAttendeeResponse = await chime.send(new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: `agent-${agentId}-${Date.now()}`
      }));

      const agentAttendeeInfo = agentAttendeeResponse.Attendee;

      // 7. FIX: Use TransactWriteCommand for atomic updates to both tables
      // This prevents race conditions where one update succeeds but the other fails
      const now = Date.now();
      const timestamp = new Date().toISOString();
      
      try {
        await ddb.send(new TransactWriteCommand({
          TransactItems: [
            // Item 1: Update call record - mark as ringing to this agent
            {
              Update: {
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                UpdateExpression: `
                  SET #status = :ringing,
                      assignedAgentId = :agentId,
                      agentAttendeeInfo = :agentAttendee,
                      meetingId = :meetingId,
                      meetingInfo = :meetingInfo,
                      ringStartTime = :now,
                      manualPickup = :manualPickup,
                      updatedAt = :timestamp
                `,
                ConditionExpression: '#status = :queued',
                ExpressionAttributeNames: {
                  '#status': 'status'
                },
                ExpressionAttributeValues: {
                  ':ringing': 'ringing',
                  ':queued': 'queued',
                  ':agentId': agentId,
                  ':agentAttendee': agentAttendeeInfo,
                  ':meetingId': meetingId,
                  ':meetingInfo': meetingInfo,
                  ':now': now,
                  ':manualPickup': true,
                  ':timestamp': timestamp
                }
              }
            },
            // Item 2: Update agent presence - mark as ringing
            {
              Update: {
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: `
                  SET #status = :ringing,
                      ringingCallId = :callId,
                      ringingCallClinicId = :clinicId,
                      ringingCallTime = :timestamp,
                      lastActivityAt = :timestamp,
                      inboundMeetingInfo = :meetingInfo,
                      inboundAttendeeInfo = :attendeeInfo
                `,
                ConditionExpression: '#status = :online AND attribute_not_exists(ringingCallId) AND attribute_not_exists(currentCallId)',
                ExpressionAttributeNames: {
                  '#status': 'status'
                },
                ExpressionAttributeValues: {
                  ':ringing': 'Ringing',
                  ':online': 'Online',
                  ':callId': callId,
                  ':clinicId': clinicId,
                  ':timestamp': timestamp,
                  ':meetingInfo': meetingInfo,
                  ':attendeeInfo': agentAttendeeInfo
                }
              }
            }
          ]
        }));
        
        console.log('[join-queued-call] Transaction completed - call and agent updated atomically');
      } catch (txnErr: any) {
        if (txnErr.name === 'TransactionCanceledException') {
          const reasons = txnErr.CancellationReasons || [];
          console.warn('[join-queued-call] Transaction failed', { reasons });
          
          // Cleanup orphaned attendee
          try {
            await chime.send(new DeleteAttendeeCommand({
              MeetingId: meetingId,
              AttendeeId: agentAttendeeInfo!.AttendeeId!
            }));
          } catch (deleteErr) {
            console.warn('[join-queued-call] Failed to cleanup attendee:', deleteErr);
          }
          
          // Determine which condition failed
          if (reasons[0]?.Code === 'ConditionalCheckFailed') {
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Call is no longer in queue. It may have been picked up by another agent.' })
            };
          } else if (reasons[1]?.Code === 'ConditionalCheckFailed') {
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Your status changed during the operation. You may already be on a call.' })
            };
          }
          
          return {
            statusCode: 409,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Failed to join call due to conflicting state changes' })
          };
        }
        throw txnErr;
      }

      // 9. Bridge the customer into the meeting (trigger SIP Media Application)
      console.log('[join-queued-call] Bridging customer to meeting', {
        transactionId: callRecord.transactionId || callId,
        meetingId,
        smaId
      });

      try {
        await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
          SipMediaApplicationId: smaId,
          TransactionId: callRecord.transactionId || callId,
          Arguments: {
            action: 'BRIDGE_CUSTOMER_INBOUND',
            callId,
            clinicId,
            meetingId,
            agentId,
            fromQueue: 'true'
          }
        }));
      } catch (bridgeError) {
        console.error('[join-queued-call] Failed to bridge customer:', bridgeError);
        
        // Cleanup orphaned attendee
        try {
          await chime.send(new DeleteAttendeeCommand({
            MeetingId: meetingId,
            AttendeeId: agentAttendeeInfo!.AttendeeId!
          }));
        } catch (deleteErr) {
          console.warn('[join-queued-call] Failed to cleanup attendee:', deleteErr);
        }
        
        // FIX: Roll back using TransactWriteCommand for atomicity
        try {
          await ddb.send(new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId, queuePosition },
                  UpdateExpression: 'SET #status = :queued REMOVE assignedAgentId, ringStartTime, manualPickup, agentAttendeeInfo',
                  ConditionExpression: '#status = :ringing AND assignedAgentId = :agentId',
                  ExpressionAttributeNames: { '#status': 'status' },
                  ExpressionAttributeValues: { 
                    ':queued': 'queued',
                    ':ringing': 'ringing',
                    ':agentId': agentId
                  }
                }
              },
              {
                Update: {
                  TableName: AGENT_PRESENCE_TABLE_NAME,
                  Key: { agentId },
                  UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallClinicId, ringingCallTime, inboundMeetingInfo, inboundAttendeeInfo',
                  ConditionExpression: 'ringingCallId = :callId',
                  ExpressionAttributeNames: { '#status': 'status' },
                  ExpressionAttributeValues: { 
                    ':online': 'Online',
                    ':callId': callId
                  }
                }
              }
            ]
          }));
          console.log('[join-queued-call] Rollback transaction completed');
        } catch (rollbackErr) {
          console.error('[join-queued-call] Rollback failed:', rollbackErr);
        }

        throw bridgeError;
      }

      console.log('[join-queued-call] Successfully initiated call pickup', {
        callId,
        agentId,
        meetingId
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: 'Call pickup initiated',
          callId,
          meetingId,
          agentAttendee: agentAttendeeInfo,
          meetingInfo,
          status: 'ringing'
        })
      };

    } finally {
      // FIX: Always release lock in finally block
      await lock.release();
    }

  } catch (error) {
    console.error('[join-queued-call] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Failed to join queued call',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand, DeleteAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { scheduleCompensatingAction } from './compensating-action-processor';
import { TTL_POLICY, calculateTTL } from './config/ttl-policy';
import { DistributedLock } from './utils/distributed-lock';
import { isPushNotificationsEnabled, sendCallResumedToAgent } from './utils/push-notifications';
import { CHIME_CONFIG } from './config';

const ddb = getDynamoDBClient();
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
// FIX: Use CHIME_MEDIA_REGION for Voice client to match Meetings client
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

// Note: CHIME_MEDIA_REGION is defined above with chimeVoice client
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

/**
 * Lambda handler for resuming a call from hold
 * This is triggered by the frontend when an agent wants to resume a call that was on hold
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Resume call event:', JSON.stringify(event, null, 2));

    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        // CRITICAL FIX: Add JWT verification for security
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[resume-call] Auth verification failed', {
                code: verifyResult.code,
                message: verifyResult.message
            });
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const requestingAgentId = getUserIdFromJwt(verifyResult.payload!);
        console.log('[resume-call] Auth verification successful', { requestingAgentId });

        if (!event.body) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing request body' })
            };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId } = body;

        if (!callId || !agentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' })
            };
        }

        // CRITICAL FIX: Verify requesting agent is the agent resuming
        if (requestingAgentId !== agentId) {
            console.warn('[resume-call] Authorization failed - agent attempting to resume call they are not on', {
                requestingAgentId,
                agentId
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden: You can only resume your own calls' })
            };
        }

        // FIX #1: Acquire lock BEFORE any state checks to prevent TOCTOU race condition
        // This ensures no other operation can modify the call state between our checks and actions
        if (!LOCKS_TABLE_NAME) {
            console.error('[resume-call] LOCKS_TABLE_NAME not configured');
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'System configuration error' })
            };
        }

        // FIX: Use unified lock key for all call state operations to prevent concurrent hold/resume
        const lock = new DistributedLock(ddb, {
            tableName: LOCKS_TABLE_NAME,
            lockKey: `call-state-${callId}`,
            ttlSeconds: 30,
            maxRetries: 5,
            retryDelayMs: 100
        });

        const lockResult = await lock.acquireWithFencingToken();
        if (!lockResult.acquired) {
            console.warn('[resume-call] Failed to acquire lock - another resume in progress', { callId, agentId });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Resume operation already in progress. Please wait.' })
            };
        }

        const fencingToken = lockResult.fencingToken;
        console.log('[resume-call] Lock acquired with fencing token', { callId, agentId, fencingToken });

        try {
            // 1. Find the call record in the queue table (now inside lock to prevent TOCTOU)
            const { Items: callRecords } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: {
                    ':callId': callId
                }
            }));

            if (!callRecords || callRecords.length === 0) {
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call not found' })
                };
            }

            const callRecord = callRecords[0];
            const { clinicId, queuePosition } = callRecord;

            // Check clinic authorization
            const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
            if (!authzCheck.authorized) {
                console.warn('[resume-call] Authorization failed', {
                    agentId: requestingAgentId,
                    clinicId,
                    reason: authzCheck.reason
                });
                return {
                    statusCode: 403,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: authzCheck.reason })
                };
            }

            const smaId = getSmaIdForClinic(clinicId);
            if (!smaId) {
                console.error('[resume-call] Missing SMA mapping for clinic', { clinicId });
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Resume call is not configured for this clinic' })
                };
            }

            // CRITICAL FIX: Verify agent is actually on this call
            if (callRecord.assignedAgentId !== agentId) {
                console.warn('[resume-call] Agent not on this call', {
                    agentId,
                    assignedAgentId: callRecord.assignedAgentId
                });
                return {
                    statusCode: 403,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'You are not currently on this call' })
                };
            }

            const callState = callRecord.status || callRecord.callStatus;
            // CRITICAL FIX: Verify call is actually on hold
            if (callState !== 'on_hold') {
                console.warn('[resume-call] Call is not on hold', {
                    callId,
                    currentStatus: callState
                });
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call is not on hold' })
                };
            }

            if (callRecord.heldByAgentId && callRecord.heldByAgentId !== agentId) {
                console.warn('[resume-call] Call held by different agent', {
                    callId,
                    heldBy: callRecord.heldByAgentId,
                    agentId
                });
                return {
                    statusCode: 403,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Another agent placed this call on hold' })
                };
            }

            // Calculate hold duration if applicable
            let holdDuration = 0;
            if (callRecord.holdStartTime) {
                const holdStart = new Date(callRecord.holdStartTime).getTime();
                const now = new Date().getTime();
                holdDuration = Math.floor((now - holdStart) / 1000); // seconds
            }

            // FIX #3: Validate fencing token is still valid before critical operations
            const tokenValid = await lock.validateFencingToken();
            if (!tokenValid) {
                console.warn('[resume-call] Fencing token invalidated - another process took over', { callId, agentId, fencingToken });
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Operation was superseded. Please try again.' })
                };
            }

            // CRITICAL FIX: Check if this agent has meeting info stored for the held call
            const { Item: agentRecord } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId }
            }));

            // Get meeting ID from agent record or call record
            let meetingId = null;
            if (agentRecord?.heldCallMeetingId) {
                meetingId = agentRecord.heldCallMeetingId;
                console.log(`[resume-call] Found stored meeting ID ${meetingId} for agent ${agentId}`);
            } else if (callRecord.meetingInfo?.MeetingId) {
                meetingId = callRecord.meetingInfo.MeetingId;
                console.log(`[resume-call] Using call record meeting ID ${meetingId}`);
            } else {
                console.log(`[resume-call] No meeting ID found for call ${callId}`);
            }

            // CRITICAL FIX: Validate meeting exists before attempting resume
            let meetingInfo: any = null;
            if (meetingId) {
                try {
                    const getMeetingResp = await chimeClient.send(new GetMeetingCommand({ MeetingId: meetingId }));
                    meetingInfo = getMeetingResp.Meeting;
                    console.log(`[resume-call] Meeting ${meetingId} validated - exists`);
                } catch (meetingErr: any) {
                    if (meetingErr.name === 'NotFoundException') {
                        console.error(`[resume-call] Meeting ${meetingId} no longer exists`);

                        // Clean up stale meeting reference
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo SET meetingError = :error',
                            ExpressionAttributeValues: {
                                ':error': 'Meeting not found in Chime SDK during resume'
                            }
                        })).catch(cleanupErr => console.warn('[resume-call] Failed to cleanup stale meeting ref:', cleanupErr));

                        return {
                            statusCode: 409,
                            headers: corsHeaders,
                            body: JSON.stringify({
                                message: 'Cannot resume call - meeting no longer exists',
                                error: 'MEETING_NOT_FOUND'
                            })
                        };
                    }
                    throw meetingErr; // Re-throw other errors
                }
            }

            try {
                let agentAttendeeId: string | null = null;
                let agentJoinToken: string = '';

                // CRITICAL FIX #2: Delete OLD attendee BEFORE creating new one
                // This prevents "Attendee already exists" errors
                const storedAttendeeId = agentRecord?.heldCallAttendeeId;

                if (storedAttendeeId && meetingId) {
                    try {
                        await chimeClient.send(new DeleteAttendeeCommand({
                            MeetingId: meetingId,
                            AttendeeId: storedAttendeeId
                        }));
                        console.log(`[resume-call] Cleaned up old attendee ${storedAttendeeId} before resume`);
                    } catch (deleteErr: any) {
                        if (deleteErr.name === 'NotFoundException') {
                            console.log(`[resume-call] Old attendee ${storedAttendeeId} already removed`);
                        } else {
                            console.warn('[resume-call] Could not delete old attendee:', deleteErr);
                            // Continue anyway - might still be able to create new attendee
                        }
                    }
                }

                // CRITICAL FIX: Create a new attendee for the agent to resume the call
                // The old attendee was already cleaned up above
                if (meetingId) {
                    try {
                        // CreateAttendeeCommand will validate meeting exists
                        const attendeeResponse = await chimeClient.send(new CreateAttendeeCommand({
                            MeetingId: meetingId,
                            ExternalUserId: agentId
                        }));

                        if (attendeeResponse.Attendee?.AttendeeId) {
                            agentAttendeeId = attendeeResponse.Attendee.AttendeeId;
                            agentJoinToken = attendeeResponse.Attendee.JoinToken || '';
                            console.log(`[resume-call] Created new attendee ${agentAttendeeId} for agent ${agentId}`);

                            // Update the call record with attendee info here to ensure we have the join token
                            try {
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId, queuePosition },
                                    UpdateExpression: 'SET agentAttendeeInfo = :attendeeInfo',
                                    ExpressionAttributeValues: {
                                        ':attendeeInfo': {
                                            AttendeeId: agentAttendeeId,
                                            JoinToken: agentJoinToken,
                                            ExternalUserId: agentId
                                        }
                                    }
                                }));
                                console.log(`[resume-call] Stored attendee info in call record`);
                            } catch (updateErr) {
                                console.warn('[resume-call] Failed to store attendee info in call record:', updateErr);
                            }
                        }
                    } catch (attendeeErr) {
                        console.error(`[resume-call] Failed to create attendee:`, attendeeErr);
                    }
                }

                // Send command to SMA with enhanced information for rejoining
                await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: smaId,
                    TransactionId: callId,
                    Arguments: {
                        action: 'RESUME_CALL',
                        agentId,
                        meetingId: meetingId || '',
                        agentAttendeeId: agentAttendeeId || '',
                        reconnectAgent: 'true' // Convert to string as API expects string values
                    }
                }));

                console.log(`[resume-call] SMA resume command successful for call ${callId}`);

                // FIX #5: Use TransactWriteCommand for atomic updates to prevent inconsistent state
                const extendedTTL = calculateTTL(TTL_POLICY.ACTIVE_CALL_SECONDS);
                const timestamp = new Date().toISOString();

                try {
                    await ddb.send(new TransactWriteCommand({
                        TransactItems: [
                            {
                                Update: {
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId, queuePosition },
                                    UpdateExpression: 'SET #status = :status, callStatus = :status, holdEndTime = :endTime, ' +
                                        'holdDuration = :duration, #ttl = :ttl, resumeTime = :timestamp, lastUpdated = :timestamp ' +
                                        'REMOVE holdStartTime, heldByAgentId',
                                    ConditionExpression: '#status = :holdStatus AND heldByAgentId = :agentId',
                                    ExpressionAttributeNames: {
                                        '#status': 'status',
                                        '#ttl': 'ttl'
                                    },
                                    ExpressionAttributeValues: {
                                        ':status': 'connected',
                                        ':endTime': timestamp,
                                        ':duration': holdDuration,
                                        ':holdStatus': 'on_hold',
                                        ':agentId': agentId,
                                        ':ttl': extendedTTL,
                                        ':timestamp': timestamp
                                    }
                                }
                            },
                            {
                                Update: {
                                    TableName: AGENT_PRESENCE_TABLE_NAME,
                                    Key: { agentId },
                                    UpdateExpression: 'SET callStatus = :status, lastActivityAt = :timestamp, ' +
                                        'currentMeetingAttendeeId = :attendeeId, currentCallId = :callId, #agentStatus = :onCall ' +
                                        'REMOVE heldCallMeetingId, heldCallId, heldCallAttendeeId',
                                    ConditionExpression: 'heldCallId = :callId',
                                    ExpressionAttributeNames: {
                                        '#agentStatus': 'status'
                                    },
                                    ExpressionAttributeValues: {
                                        ':status': 'connected',
                                        ':timestamp': timestamp,
                                        ':attendeeId': agentAttendeeId,
                                        ':callId': callId,
                                        ':onCall': 'OnCall'
                                    }
                                }
                            }
                        ]
                    }));
                    console.log(`[resume-call] Transaction completed - both tables updated atomically for call ${callId}`);

                    if (isPushNotificationsEnabled() && CHIME_CONFIG.PUSH.ENABLE_HOLD_RESUME_PUSH) {
                        sendCallResumedToAgent({
                            callId,
                            clinicId,
                            clinicName: callRecord.clinicName || clinicId,
                            agentId,
                            direction: callRecord.direction || 'inbound',
                            timestamp: new Date().toISOString(),
                        }).catch(err => console.warn('[resume-call] Push notification failed (non-fatal):', err.message));
                    }
                } catch (txnErr: any) {
                    if (txnErr.name === 'TransactionCanceledException') {
                        const reasons = txnErr.CancellationReasons || [];
                        console.error('[resume-call] Transaction failed:', { reasons });

                        // Schedule compensating action to reconcile state
                        await scheduleCompensatingAction({
                            action: 'RECONCILE_AGENT_STATE',
                            callId,
                            agentId,
                            meetingId: meetingId || undefined,
                            attendeeId: agentAttendeeId || undefined,
                            reason: `Resume transaction failed: ${JSON.stringify(reasons)}`
                        });

                        return {
                            statusCode: 409,
                            headers: corsHeaders,
                            body: JSON.stringify({ message: 'Call state changed during resume. Please try again.' })
                        };
                    }
                    throw txnErr;
                }

                const attendeeInfo = agentAttendeeId ? {
                    AttendeeId: agentAttendeeId,
                    JoinToken: agentJoinToken,
                    ExternalUserId: agentId,
                } : undefined;

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Call resumed',
                        callId,
                        status: 'connected',
                        holdDuration,
                        meeting: meetingInfo || callRecord.meetingInfo || { MeetingId: meetingId },
                        attendee: attendeeInfo || { AttendeeId: agentAttendeeId },
                    })
                };
            } catch (smaError: any) {
                console.error('[resume-call] Error resuming call:', smaError);

                // Provide more specific error message
                if (smaError.name === 'ConditionalCheckFailedException') {
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ message: 'Call is not in a valid state to be resumed' })
                    };
                }

                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Failed to resume call',
                        error: smaError.message
                    })
                };
            }
        } finally {
            // FIX: Single finally block to release lock - covers all code paths including early returns
            if (lock.isAcquired()) {
                await lock.release();
            }
        }

    } catch (error) {
        console.error('Error processing resume call request:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

/**
 * FIX #2: Hold/Resume State Mismatch with Compensating Transactions
 * 
 * Enhanced with:
 * - Pre-flight state checks
 * - Atomic state reservation
 * - Compensating actions via SQS on failure
 * - State machine enforcement
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isPushNotificationsEnabled, sendClinicAlert, sendCallHoldToAgent } from './utils/push-notifications';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
// TransactWriteCommand is used for atomic updates in attemptDirectStateRecovery
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, DeleteAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { validateStateTransition, CALL_STATE_MACHINE } from '../shared/utils/state-machine';
import { randomUUID } from 'crypto';
// FIX #11: Static import to avoid latency in error handling path
import { CompensatingIntent } from './compensating-action-processor';
import { DistributedLock } from './utils/distributed-lock';

const sqs = new SQSClient({});

const ddb = getDynamoDBClient();
// FIX: Use CHIME_MEDIA_REGION for Voice client to match Meetings client
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

// Note: CHIME_MEDIA_REGION is defined above with chimeVoice client
const chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const COMPENSATING_ACTIONS_QUEUE_URL = process.env.COMPENSATING_ACTIONS_QUEUE_URL;
/**
 * Lambda handler for placing a call on hold
 * This is triggered by the frontend when an agent wants to put a customer on hold
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Hold call event:', JSON.stringify(event, null, 2));

    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        // Authenticate request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[hold-call] Auth verification failed', verifyResult);
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }

        const requestingAgentId = getUserIdFromJwt(verifyResult.payload!);

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

        if (!requestingAgentId || requestingAgentId !== agentId) {
            console.warn('[hold-call] Agent token mismatch', { requestingAgentId, agentId });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Forbidden' })
            };
        }

        // FIX #1: Acquire lock BEFORE any state checks to prevent TOCTOU race condition
        const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
        if (!LOCKS_TABLE_NAME) {
            console.error('[hold-call] LOCKS_TABLE_NAME not configured');
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
            console.warn('[hold-call] Failed to acquire lock - another hold operation in progress', { callId, agentId });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Hold operation already in progress. Please wait.' })
            };
        }

        const fencingToken = lockResult.fencingToken;
        console.log('[hold-call] Lock acquired with fencing token', { callId, agentId, fencingToken });

        try {
            // Update the call status in the database
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

            // FIX #2: Validate state transition before attempting hold
            try {
                validateStateTransition(callRecord.status, 'on_hold', CALL_STATE_MACHINE, 'call');
            } catch (err: any) {
                console.warn('[hold-call] Invalid state transition:', err.message);
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: err.message,
                        currentStatus: callRecord.status
                    })
                };
            }

            // Check clinic authorization
            const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
            if (!authzCheck.authorized) {
                console.warn('[hold-call] Authorization failed', {
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

            if (callRecord.assignedAgentId && callRecord.assignedAgentId !== agentId) {
                console.warn('[hold-call] Agent attempting to hold call they are not assigned to', { agentId, assignedAgentId: callRecord.assignedAgentId });
                return {
                    statusCode: 403,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'You are not assigned to this call' })
                };
            }

            const smaId = getSmaIdForClinic(clinicId);
            if (!smaId) {
                console.error('[hold-call] Missing SMA mapping for clinic', { clinicId });
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Hold is not configured for this clinic' })
                };
            }

            // Fetch agent presence record and ensure they are on this call
            const { Item: agentRecord } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId }
            }));

            if (!agentRecord) {
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Agent presence not found' })
                };
            }

            const isOnCall = agentRecord.currentCallId === callId || agentRecord.ringingCallId === callId;
            if (!isOnCall) {
                console.warn('[hold-call] Agent not actively on this call', { agentId, callId });
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'You are not actively connected to this call' })
                };
            }

            // FIX #15: CRITICAL - Validate meeting exists before hold operations
            let meetingId = null;
            let agentAttendeeId = null;

            if (!callRecord.meetingInfo?.MeetingId) {
                console.error(`[hold-call] No active meeting for call ${callId}`);
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Cannot hold call - no active meeting',
                        error: 'NO_ACTIVE_MEETING'
                    })
                };
            }

            meetingId = callRecord.meetingInfo.MeetingId;
            console.log(`[hold-call] Found active meeting ${meetingId} for call ${callId}`);

            // FIX #15: Validate meeting actually exists in Chime
            const meetingExists = await validateMeetingExists(meetingId);
            if (!meetingExists) {
                console.error(`[hold-call] Meeting ${meetingId} not found in Chime`);

                // Clean up stale meeting reference
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId, queuePosition },
                    UpdateExpression: 'REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo ' +
                        'SET meetingError = :error',
                    ExpressionAttributeValues: {
                        ':error': 'Meeting not found in Chime SDK'
                    }
                }));

                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Cannot hold call - meeting no longer exists',
                        error: 'MEETING_NOT_FOUND'
                    })
                };
            }

            // Check for attendee ID in various fields
            if (agentRecord?.currentMeetingAttendeeId) {
                agentAttendeeId = agentRecord.currentMeetingAttendeeId;
                console.log(`[hold-call] Found agent attendee ID in currentMeetingAttendeeId: ${agentAttendeeId}`);
            } else if (agentRecord?.inboundAttendeeInfo?.AttendeeId) {
                agentAttendeeId = agentRecord.inboundAttendeeInfo.AttendeeId;
                console.log(`[hold-call] Found agent attendee ID in inboundAttendeeInfo: ${agentAttendeeId}`);
            } else if (agentRecord?.attendeeInfo?.AttendeeId) {
                agentAttendeeId = agentRecord.attendeeInfo.AttendeeId;
                console.log(`[hold-call] Found agent attendee ID in attendeeInfo: ${agentAttendeeId}`);
            }

            // FIX #15: Validate agent is in the meeting
            if (!agentAttendeeId) {
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Cannot hold call - agent not in meeting',
                        error: 'AGENT_NOT_IN_MEETING'
                    })
                };
            }

            // CRITICAL FIX #5: Make hold operation as atomic as possible
            // CRITICAL FIX #4: Comprehensive error handling for each step
            // Log operation ID for debugging and potential retry
            const holdOperationId = randomUUID();
            console.log('[hold-call] Starting hold operation', { holdOperationId, callId, agentId, fencingToken });

            // FIX #3: Validate fencing token is still valid before critical SMA operation
            const tokenValid = await lock.validateFencingToken();
            if (!tokenValid) {
                console.warn('[hold-call] Fencing token invalidated - another process took over', { callId, agentId, fencingToken });
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Operation was superseded. Please try again.' })
                };
            }

            // Step 1: Send the hold command to the SMA
            try {
                await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: smaId,
                    TransactionId: callId,
                    Arguments: {
                        action: 'HOLD_CALL',
                        agentId,
                        meetingId,
                        agentAttendeeId: agentAttendeeId || '',
                        removeAgent: 'true',
                        holdOperationId // Include for idempotency
                    }
                }));
                console.log(`[hold-call] SMA hold command successful (${holdOperationId})`);
            } catch (smaErr: any) {
                console.error(`[hold-call] STEP 1 FAILED - SMA hold command failed (${holdOperationId}):`, smaErr);
                return {
                    statusCode: 503,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'SMA service unavailable. Please try again.',
                        error: 'SMA_COMMAND_FAILED',
                        holdOperationId
                    })
                };
            }

            // Step 2: Verify attendee removal (if applicable)
            if (agentAttendeeId && meetingId) {
                try {
                    await chimeClient.send(new DeleteAttendeeCommand({
                        MeetingId: meetingId,
                        AttendeeId: agentAttendeeId
                    }));
                    console.log(`[hold-call] Agent attendee removed from meeting (${holdOperationId})`);
                } catch (deleteErr: any) {
                    if (deleteErr.name === 'NotFoundException') {
                        console.log(`[hold-call] Agent attendee already removed (${holdOperationId})`);
                    } else {
                        console.warn(`[hold-call] STEP 2 WARNING - Could not verify attendee removal (${holdOperationId}):`, deleteErr);
                        // Non-fatal - continue with hold operation (SMA already on hold)
                    }
                }
            }

            // Step 3: Update both records atomically in a transaction
            const timestamp = new Date().toISOString();
            try {
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition },
                                UpdateExpression: 'SET #status = :status, callStatus = :status, holdStartTime = :time, heldByAgentId = :agentId, holdOperationId = :operationId',
                                ConditionExpression: '#status = :connectedStatus AND assignedAgentId = :agentId',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':status': 'on_hold',
                                    ':time': timestamp,
                                    ':connectedStatus': 'connected',
                                    ':agentId': agentId,
                                    ':operationId': holdOperationId
                                }
                            }
                        },
                        {
                            Update: {
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                // CRITICAL FIX #9: Don't store heldCallAttendeeId - always create new attendee on resume
                                // FIX #7: REMOVE currentCallId to indicate agent is not actively on a call
                                // FIX #5: Use 'OnHold' status instead of 'Online' to prevent new call assignment
                                // Agent with held call should NOT receive new calls from queue
                                UpdateExpression: 'SET #agentStatus = :onHoldStatus, callStatus = :status, lastActivityAt = :timestamp, ' +
                                    'heldCallMeetingId = :meetingId, heldCallId = :callId ' +
                                    'REMOVE currentCallId',
                                ConditionExpression: 'currentCallId = :callId',
                                ExpressionAttributeNames: {
                                    '#agentStatus': 'status'
                                },
                                ExpressionAttributeValues: {
                                    ':onHoldStatus': 'OnHold',
                                    ':status': 'on_hold',
                                    ':timestamp': timestamp,
                                    ':meetingId': meetingId || null,
                                    ':callId': callId
                                }
                            }
                        }
                    ]
                }));

                console.log(`[hold-call] Database updated successfully (${holdOperationId})`);

                if (isPushNotificationsEnabled()) {
                    // State-sync push to the agent so all their devices reflect "On Hold"
                    sendCallHoldToAgent({
                        callId,
                        clinicId,
                        clinicName: clinicId,
                        agentId,
                        timestamp: new Date().toISOString(),
                    }).catch(err => console.warn('[hold-call] Hold state-sync push failed (non-fatal):', err.message));

                    // Notify clinic supervisors (best-effort)
                    sendClinicAlert(
                        clinicId,
                        'Call On Hold',
                        `Agent placed a call on hold`,
                        { callId, agentId, holdOperationId, alertType: 'call_on_hold' },
                    ).catch(err => console.warn('[hold-call] Clinic alert push failed (non-fatal):', err.message));
                }

                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Call placed on hold',
                        callId,
                        status: 'on_hold',
                        holdOperationId
                    })
                };
            } catch (dbErr: any) {
                console.error(`[hold-call] STEP 3 FAILED - Database transaction failed (${holdOperationId}):`, dbErr);

                // FIX #2: CRITICAL - SMA is on hold but DB not updated - schedule compensating action
                // CRITICAL FIX: Use explicit intent field instead of relying on reason string parsing
                // FIX #11: CompensatingIntent is now statically imported at top of file
                await scheduleCompensatingAction({
                    action: 'RESUME_HELD_CALL',
                    callId,
                    agentId,
                    clinicId,
                    queuePosition,
                    smaId,
                    holdOperationId,
                    meetingId: meetingId || undefined,
                    reason: 'DB_UPDATE_FAILED',
                    intent: CompensatingIntent.INTENDED_HOLD, // Explicit intent: the hold was intended
                    timestamp: new Date().toISOString()
                });

                if (dbErr.name === 'TransactionCanceledException') {
                    console.error(`[hold-call] INCONSISTENT STATE - SMA on hold but DB update failed due to condition check (${holdOperationId})`);
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({
                            message: 'Call state changed during hold operation. Call may be on hold - please check status.',
                            error: 'STATE_CHANGED',
                            holdOperationId
                        })
                    };
                }

                console.error(`[hold-call] INCONSISTENT STATE - SMA on hold but DB update failed (${holdOperationId})`);
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        message: 'Database update failed. Call may be on hold - please check status.',
                        error: 'DB_UPDATE_FAILED',
                        holdOperationId
                    })
                };
            }
        } finally {
            // FIX #1: Always release lock after all operations complete
            await lock.release();
        }

    } catch (error) {
        console.error('Error processing hold call request:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
};

/**
 * FIX #2: Schedule compensating action to fix inconsistent state
 * Sends message to SQS for async processing
 * 
 * FIX: Enhanced error handling - if SQS fails, log structured error for CloudWatch alerting
 * and attempt to directly update DB to on_hold state as a fallback
 */
async function scheduleCompensatingAction(action: any): Promise<void> {
    if (!COMPENSATING_ACTIONS_QUEUE_URL) {
        console.error('[hold-call] CRITICAL: No compensating actions queue configured - attempting direct DB fix');
        // FIX: Attempt direct DB update as fallback when queue isn't configured
        await attemptDirectStateRecovery(action);
        return;
    }

    try {
        await sqs.send(new SendMessageCommand({
            QueueUrl: COMPENSATING_ACTIONS_QUEUE_URL,
            MessageBody: JSON.stringify(action),
            MessageAttributes: {
                actionType: {
                    DataType: 'String',
                    StringValue: action.action
                },
                priority: {
                    DataType: 'String',
                    StringValue: 'HIGH'
                }
            },
            DelaySeconds: 5 // Small delay to allow potential race conditions to settle
        }));

        console.log('[hold-call] Compensating action scheduled:', action.action, action.holdOperationId);
    } catch (err: any) {
        // FIX: Log structured error for CloudWatch alerting and attempt direct recovery
        console.error('[hold-call] CRITICAL: Failed to schedule compensating action - attempting direct DB fix', {
            error: err.message,
            errorName: err.name,
            action: action.action,
            callId: action.callId,
            agentId: action.agentId,
            holdOperationId: action.holdOperationId,
            // Structured fields for CloudWatch metric filter
            _metric: 'CompensatingActionFailed',
            _severity: 'CRITICAL'
        });

        // Attempt direct recovery as fallback
        await attemptDirectStateRecovery(action);
    }
}

/**
 * FIX: Fallback recovery when SQS queue is unavailable
 * Attempts to directly update DB to match the intended state
 * FIX: Now updates BOTH call record AND agent presence table for consistency
 */
async function attemptDirectStateRecovery(action: any): Promise<void> {
    const { callId, agentId, clinicId, queuePosition, intent, meetingId } = action;

    if (!clinicId || queuePosition === undefined) {
        console.error('[hold-call] Cannot attempt direct recovery - missing clinicId or queuePosition', { action });
        return;
    }

    try {
        const timestamp = new Date().toISOString();

        // If the intent was to hold, update DB to on_hold
        if (intent === CompensatingIntent.INTENDED_HOLD) {
            // FIX: Use TransactWriteCommand to update BOTH tables atomically
            // This prevents the inconsistent state where call is on_hold but agent doesn't have heldCallId
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    // Update call record
                    {
                        Update: {
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'SET #status = :onhold, callStatus = :onhold, holdStartTime = :now, heldByAgentId = :agentId, directRecoveryApplied = :true',
                            ConditionExpression: '#status = :connected',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':onhold': 'on_hold',
                                ':connected': 'connected',
                                ':now': timestamp,
                                ':agentId': agentId,
                                ':true': true
                            }
                        }
                    },
                    // FIX: Also update agent presence table to match
                    {
                        Update: {
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId },
                            UpdateExpression: 'SET #agentStatus = :onHoldStatus, callStatus = :onhold, lastActivityAt = :timestamp, ' +
                                'heldCallMeetingId = :meetingId, heldCallId = :callId, directRecoveryApplied = :true ' +
                                'REMOVE currentCallId',
                            ExpressionAttributeNames: {
                                '#agentStatus': 'status'
                            },
                            ExpressionAttributeValues: {
                                ':onHoldStatus': 'OnHold',
                                ':onhold': 'on_hold',
                                ':timestamp': timestamp,
                                ':meetingId': meetingId || null,
                                ':callId': callId,
                                ':true': true
                            }
                        }
                    }
                ]
            }));

            console.log('[hold-call] Direct recovery successful - both tables updated to on_hold', { callId, agentId });
        }
    } catch (recoveryErr: any) {
        // Log but don't throw - this is last-resort recovery
        console.error('[hold-call] Direct recovery failed - MANUAL INTERVENTION REQUIRED', {
            error: recoveryErr.message,
            callId,
            agentId,
            action: action.action,
            _metric: 'DirectRecoveryFailed',
            _severity: 'CRITICAL'
        });
    }
}

/**
 * FIX #15: Validate meeting exists in Chime SDK
 * FIX #8: Moved import to module level to avoid dynamic import latency on every call
 */
async function validateMeetingExists(meetingId: string): Promise<boolean> {
    try {
        await chimeClient.send(new GetMeetingCommand({ MeetingId: meetingId }));
        return true;
    } catch (err: any) {
        if (err.name === 'NotFoundException') {
            return false;
        }
        throw err; // Re-throw other errors
    }
}

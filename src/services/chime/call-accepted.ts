import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { 
    ChimeSDKMeetingsClient, 
    CreateAttendeeCommand,
    DeleteAttendeeCommand,
    Attendee
} from '@aws-sdk/client-chime-sdk-meetings';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { verifyIdToken } from '../../shared/utils/auth-helper';
import { getUserIdFromJwt, checkClinicAuthorization } from '../../shared/utils/permissions-helper';
import { cleanupOrphanedCallResources } from './utils/resource-cleanup';
import { randomUUID } from 'crypto';
import { TTL_POLICY } from './config/ttl-policy';
import { DistributedLock } from './utils/distributed-lock';

const ddb = getDynamoDBClient();
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
// FIX #8: Use CHIME_MEDIA_REGION for Voice client to match Meetings client
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[call-accepted] Function invoked', {
      httpMethod: event.httpMethod,
      path: event.path,
      requestId: event.requestContext?.requestId,
    });
    
    const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

    try {
        if (!event.body) {
            console.error('[call-accepted] Missing request body');
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing request body' }) 
            };
        }

        // 1. Authenticate the request
        const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
        const verifyResult = await verifyIdToken(authz);
        if (!verifyResult.ok) {
            console.warn('[call-accepted] Auth verification failed', { code: verifyResult.code, message: verifyResult.message });
            return { statusCode: verifyResult.code || 401, headers: corsHeaders, body: JSON.stringify({ message: verifyResult.message }) };
        }
        
        const requestingAgentId = getUserIdFromJwt(verifyResult.payload!);
        if (!requestingAgentId) {
             return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid token: missing subject claim' }) };
        }

        const body = JSON.parse(event.body);
        const { callId, agentId } = body;
        
        console.log('[call-accepted] Parsed request body', { callId, agentId, requestingAgentId });

        if (!callId || !agentId) {
            console.error('[call-accepted] Missing required parameters');
            return { 
                statusCode: 400, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Missing required parameters: callId, agentId' }) 
            };
        }

        // Security check: Ensure the authenticated agent is the one accepting the call
        if (requestingAgentId !== agentId) {
            console.warn('[call-accepted] Auth mismatch', { requestingAgentId, agentId });
            return { 
                statusCode: 403, 
                headers: corsHeaders, 
                body: JSON.stringify({ message: 'Forbidden' }) 
            };
        }

        // 2. Get the agent's existing session meeting
        const { Item: agentPresence } = await ddb.send(new GetCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            Key: { agentId }
        }));

        if (!agentPresence?.meetingInfo?.MeetingId) {
            console.error('[call-accepted] Agent has no valid session meeting. Please start-session.', { agentId });
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Agent session not found or is invalid. Please log in again.' })
            };
        }
        const agentMeeting = agentPresence.meetingInfo;
        console.log(`[call-accepted] Found agent session meeting: ${agentMeeting.MeetingId}`);

        // 3. Find the call record to verify it's still ringing
        console.log('[call-accepted] Finding call record', { callId });
        const { Items: callRecords } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));

        if (!callRecords || callRecords.length === 0) {
            console.error('[call-accepted] Call not found', { callId });
            // This can happen if the customer hung up. Clean up agent status.
             await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                ConditionExpression: 'ringingCallId = :callId',
                ExpressionAttributeNames: {'#status': 'status'},
                ExpressionAttributeValues: { ':online': 'Online', ':callId': callId }
            })).catch(err => console.warn(`[call-accepted] Agent cleanup failed for missing call: ${err.message}`));
            
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call not found. It may have been disconnected.' })
            };
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition } = callRecord;

        // FIX #8: Verify agent is authorized for this clinic before proceeding
        const authzCheck = checkClinicAuthorization(verifyResult.payload! as any, clinicId);
        if (!authzCheck.authorized) {
            console.warn('[call-accepted] Agent not authorized for call clinic', {
                agentId,
                callId,
                clinicId,
                reason: authzCheck.reason
            });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'You are not authorized to accept calls for this clinic',
                    reason: authzCheck.reason
                })
            };
        }
        console.log('[call-accepted] Clinic authorization verified', { agentId, clinicId });

        const smaId = getSmaIdForClinic(clinicId);

        // 4. CRITICAL FIX #1: Acquire distributed lock BEFORE status check to prevent TOCTOU race condition
        // FIX: Moved lock acquisition before status check to eliminate race window
        console.log('[call-accepted] Acquiring distributed lock for call', { callId });
        
        if (!LOCKS_TABLE_NAME) {
            console.error('[call-accepted] LOCKS_TABLE_NAME not configured');
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'System configuration error' })
            };
        }

        // FIX #2: Increased TTL to 30s to handle Lambda cold starts + Chime API latency + SMA bridging
        // FIX #6: Lock must cover the entire operation including SMA bridging to prevent race conditions
        // Trade-off: If Lambda fails, call is blocked for 30s, but prevents race conditions during bridging
        // Note: Lambda timeout should be configured to < 30s for this function
        const lock = new DistributedLock(ddb, {
            tableName: LOCKS_TABLE_NAME,
            lockKey: `call-assignment-${callId}`,
            ttlSeconds: 30, // Increased to cover transaction + attendee creation + SMA bridging
            maxRetries: 10, // More retries with exponential backoff
            retryDelayMs: 150 // Slightly longer initial delay
        });

        const acquired = await lock.acquire();
        if (!acquired) {
            console.warn('[call-accepted] Failed to acquire lock - call being processed by another agent', { callId, agentId });
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call is being assigned to another agent' })
            };
        }

        try {
            // RACE CONDITION CHECK: Ensure call is still ringing (now inside lock to prevent TOCTOU)
            // FIX: Re-fetch call record inside lock to get authoritative state
            const { Items: freshCallRecords } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: { ':callId': callId }
            }));

            const freshCallRecord = freshCallRecords?.[0];
            if (!freshCallRecord || freshCallRecord.status !== 'ringing') {
                console.warn('[call-accepted] Race condition - call already accepted or handled', { callId, status: freshCallRecord?.status });
                
                // Clean up this agent's ringing status, as they lost the race
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                    ConditionExpression: 'ringingCallId = :callId',
                    ExpressionAttributeNames: {'#status': 'status'},
                    ExpressionAttributeValues: { ':online': 'Online', ':callId': callId }
                })).catch(err => console.warn(`[call-accepted] Agent cleanup failed for race condition: ${err.message}`));
                
                return {
                    statusCode: 409, // Conflict
                    headers: corsHeaders,
                    body: JSON.stringify({ message: 'Call was already handled by another agent.' })
                };
            }

            // 5. Use transaction to atomically claim the call with version number
            // CRITICAL FIX #1: Win transaction FIRST before creating attendee to prevent resource leak
            console.log('[call-accepted] Attempting to claim call with transaction (lock acquired)', { callId, agentId });
            
            const timestamp = new Date().toISOString();
            const nowSeconds = Math.floor(Date.now() / 1000);
            // CRITICAL FIX #5: Use centralized TTL policy
            const extendedTTL = nowSeconds + TTL_POLICY.ACTIVE_CALL_SECONDS;

            const transactionItems: any[] = [
                // Item 1: Update call status to 'accepting' with version check
                // CRITICAL: Verify call is still ringing AND hasn't been claimed by a DIFFERENT agent
                {
                    Update: {
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId, queuePosition },
                        UpdateExpression: 'SET #status = :accepting, assignedAgentId = :agentId, acceptedAt = :timestamp, ' +
                                         '#ttl = :ttl, #version = if_not_exists(#version, :zero) + :one',
                        ConditionExpression: '#status = :ringing AND ' +
                                            '(attribute_not_exists(assignedAgentId) OR assignedAgentId = :agentId) AND ' +
                                            'contains(agentIds, :agentId)',
                        ExpressionAttributeNames: { 
                            '#status': 'status', 
                            '#ttl': 'ttl',
                            '#version': 'version'
                        },
                        ExpressionAttributeValues: {
                            ':accepting': 'accepting',
                            ':agentId': agentId,
                            ':timestamp': timestamp,
                            ':ringing': 'ringing',
                            ':ttl': extendedTTL,
                            ':zero': 0,
                            ':one': 1
                        }
                    }
                },
                // Item 2: Update the accepting agent's status to 'OnCall'
                {
                    Update: {
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId },
                        UpdateExpression: 'SET #status = :onCall, currentCallId = :callId, callStatus = :connected, ' +
                                         'lastActivityAt = :timestamp ' +
                                         'REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ' +
                                         'ringingCallTransferAgentId, ringingCallTransferMode',
                        ConditionExpression: 'ringingCallId = :callId', // Ensure agent was ringing for this call
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':onCall': 'OnCall',
                            ':connected': 'connected',
                            ':callId': callId,
                            ':timestamp': timestamp
                        }
                    }
                }
            ];
            
            // NOTE: We no longer update other ringing agents in this transaction.
            // Reason: If any of 25 agents' states changed, the entire transaction fails.
            // The cleanup-monitor will handle stale ringing states via heartbeat monitoring.
            
            try {
                await ddb.send(new TransactWriteCommand({ TransactItems: transactionItems }));
                console.log('[call-accepted] Transaction completed successfully - call reserved', { callId, agentId });
            } catch (err: any) {
                if (err.name === 'TransactionCanceledException') {
                    // Analyze which condition failed for better diagnostics
                    const reasons = err.CancellationReasons || [];
                    const callQueueFailed = reasons[0]?.Code === 'ConditionalCheckFailed';
                    const agentPresenceFailed = reasons[1]?.Code === 'ConditionalCheckFailed';
                    
                    let failureReason = 'unknown';
                    if (callQueueFailed && agentPresenceFailed) {
                        failureReason = 'both_call_and_agent_state_changed';
                    } else if (callQueueFailed) {
                        // Fetch current call state to understand why it failed
                        try {
                            const { Items: currentCallState } = await ddb.send(new QueryCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                IndexName: 'callId-index',
                                KeyConditionExpression: 'callId = :callId',
                                ExpressionAttributeValues: { ':callId': callId }
                            }));
                            if (currentCallState && currentCallState[0]) {
                                const call = currentCallState[0];
                                failureReason = `call_status_is_${call.status}_expected_ringing`;
                                
                                // Log full call state for debugging
                                console.warn('[call-accepted] Call state details:', {
                                    status: call.status,
                                    assignedAgentId: call.assignedAgentId,
                                    agentIds: call.agentIds,
                                    attemptingAgentId: agentId,
                                    agentIdsType: typeof call.agentIds,
                                    agentIdsLength: call.agentIds?.length,
                                    isAgentInList: call.agentIds?.includes(agentId)
                                });
                                
                                if (call.assignedAgentId && call.assignedAgentId !== agentId) {
                                    failureReason += `_already_assigned_to_different_agent_${call.assignedAgentId}`;
                                }
                                if (!call.agentIds || call.agentIds.length === 0) {
                                    failureReason += '_agentIds_missing_or_empty';
                                } else if (!call.agentIds.includes(agentId)) {
                                    failureReason += '_agent_not_in_ring_list';
                                }
                                // Check for double-click scenario (same agent, status changed from ringing)
                                if (call.status !== 'ringing' && call.assignedAgentId === agentId) {
                                    failureReason += '_possible_double_click';
                                }
                            }
                        } catch (diagErr) {
                            console.error('[call-accepted] Failed to diagnose failure', diagErr);
                        }
                    } else if (agentPresenceFailed) {
                        failureReason = 'agent_not_ringing_for_this_call';
                    }
                    
                    console.warn('[call-accepted] Transaction failed. Call not available.', { 
                        callId, 
                        agentId, 
                        failureReason,
                        reasons 
                    });
                    return {
                        statusCode: 409, // Conflict
                        headers: corsHeaders,
                        body: JSON.stringify({ 
                            message: 'Call is no longer available. It may have been accepted by another agent or the caller hung up.',
                            callId, 
                            agentId,
                            reason: failureReason
                        })
                    };
                }
                // Other transaction error
                throw err;
            }

            // EARLY RING STOP: clear ringing state for other agents ASAP.
            // This makes "first answer wins" feel immediate (others stop ringing as soon as someone accepts),
            // without putting the updates into the transaction (which would be brittle for large agent sets).
            try {
                const ringList: string[] = Array.isArray(freshCallRecord.agentIds) ? freshCallRecord.agentIds : [];
                const otherAgentIds = ringList.filter((id: string) => id !== agentId);
                if (otherAgentIds.length > 0) {
                    console.log('[call-accepted] Early cleanup of other ringing agents', { count: otherAgentIds.length, callId });
                    
                    // Best-effort: run in parallel; ignore conditional failures.
                    Promise.allSettled(otherAgentIds.map(async (otherId: string) => {
                        await ddb.send(new UpdateCommand({
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId: otherId },
                            UpdateExpression: 'SET #status = :online, lastActivityAt = :now REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                            ConditionExpression: 'ringingCallId = :callId',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: { 
                                ':online': 'Online', 
                                ':callId': callId,
                                ':now': new Date().toISOString()
                            }
                        }));
                    })).catch(() => {});
                }
            } catch (cleanupErr) {
                // Non-fatal; later cleanup + monitors will reconcile.
                console.warn('[call-accepted] Early cleanup failed (non-fatal):', cleanupErr);
            }

            // FIX #6: Move attendee creation and SMA bridging INSIDE the lock scope
            // This prevents race conditions during the critical bridging operation

            // 5. Create attendee AFTER winning the transaction (prevents resource leak)
            let customerAttendee: Attendee;
        try {
            console.log(`[call-accepted] Creating customer attendee for agent's meeting ${agentMeeting.MeetingId}`);
            const attendeeResponse = await chime.send(new CreateAttendeeCommand({
                MeetingId: agentMeeting.MeetingId,
                ExternalUserId: `customer-${callId}` // Link attendee to the callId
            }));
            
            if (!attendeeResponse.Attendee?.AttendeeId || !attendeeResponse.Attendee?.JoinToken) {
                throw new Error('Invalid attendee data returned from Chime');
            }
            customerAttendee = attendeeResponse.Attendee;
            console.log(`[call-accepted] Created customer attendee: ${customerAttendee.AttendeeId}`);
        } catch (attendeeErr) {
            console.error('[call-accepted] Failed to create customer attendee:', attendeeErr);
            // ROLLBACK: Release the call reservation
            // CRITICAL FIX: Preserve agentIds during rollback so the call can be retried
            await ddb.send(new UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                UpdateExpression: 'SET #status = :ringing REMOVE assignedAgentId, acceptedAt',
                ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':ringing': 'ringing',
                    ':accepting': 'accepting',
                    ':agentId': agentId
                }
            })).catch(rollbackErr => console.error('[call-accepted] Rollback failed:', rollbackErr));
            
            // Also reset agent status
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: 'SET #status = :online REMOVE currentCallId, callStatus',
                ConditionExpression: 'currentCallId = :callId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { 
                    ':online': 'Online',
                    ':callId': callId
                }
            })).catch(rollbackErr => console.error('[call-accepted] Agent rollback failed:', rollbackErr));
            
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Failed to create meeting credentials for customer' })
            };
        }

        // 6. Notify the SMA to bridge the customer PSTN leg into the agent's meeting
        // CRITICAL FIX #2: Implement rollback if SMA fails
        if (smaId) {
            try {
                console.log('[call-accepted] Notifying SMA to bridge customer', { callId, agentId, meetingId: agentMeeting.MeetingId });
                await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: smaId,
                    TransactionId: callId, // This is the PSTN call leg
                    Arguments: {
                        action: 'BRIDGE_CUSTOMER_INBOUND',
                        meetingId: agentMeeting.MeetingId,
                        customerAttendeeId: customerAttendee.AttendeeId!,
                        customerAttendeeJoinToken: customerAttendee.JoinToken!
                    }
                }));
                console.log('[call-accepted] SMA notified successfully');
                
                // 7. Update call to 'connected' status now that SMA bridge is complete
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId, queuePosition },
                    UpdateExpression: 'SET #status = :connected, customerAttendeeInfo = :customerAttendee, connectedAt = :timestamp REMOVE agentIds',
                    ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':connected': 'connected',
                        ':accepting': 'accepting',
                        ':agentId': agentId,
                        ':customerAttendee': customerAttendee,
                        ':timestamp': new Date().toISOString()
                    }
                }));
                
                // CRITICAL FIX #7: Cleanup other ringing agents with retry logic
                // FIX: Changed from fire-and-forget to more reliable cleanup with retries
                const otherAgentIds = (callRecord.agentIds || []).filter((id: string) => id !== agentId);
                if (otherAgentIds.length > 0) {
                    console.log('[call-accepted] Cleaning up other ringing agents', { count: otherAgentIds.length });
                    
                    // Process cleanups with retry logic (but don't block the response)
                    const cleanupWithRetry = async (otherId: string, retries = 2): Promise<void> => {
                        for (let attempt = 1; attempt <= retries; attempt++) {
                            try {
                                await ddb.send(new UpdateCommand({
                                    TableName: AGENT_PRESENCE_TABLE_NAME,
                                    Key: { agentId: otherId },
                                    UpdateExpression: 'SET #status = :online, lastActivityAt = :now REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                                    ConditionExpression: 'ringingCallId = :callId',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: { 
                                        ':online': 'Online', 
                                        ':callId': callId,
                                        ':now': new Date().toISOString()
                                    }
                                }));
                                return; // Success
                            } catch (err: any) {
                                if (err.name === 'ConditionalCheckFailedException') {
                                    // Agent is no longer ringing for this call - that's fine
                                    return;
                                }
                                if (attempt === retries) {
                                    console.error('[call-accepted] Failed to cleanup agent after retries', { 
                                        otherId, 
                                        error: err.message,
                                        callId 
                                    });
                                    // Log for monitoring - cleanup-monitor will catch stale states
                                } else {
                                    // Exponential backoff before retry
                                    await new Promise(r => setTimeout(r, 50 * Math.pow(2, attempt - 1)));
                                }
                            }
                        }
                    };
                    
                    // Run cleanups in parallel (but with retry logic)
                    Promise.all(otherAgentIds.map((otherId: string) => cleanupWithRetry(otherId)))
                        .then(() => console.log('[call-accepted] Finished cleaning up other agents'))
                        .catch(() => {}); // Don't let cleanup errors affect response
                }
                
            } catch (smaErr) {
                console.error('[call-accepted] CRITICAL: Failed to notify SMA of agent acceptance:', smaErr);
                // CRITICAL FIX #2: Rollback the acceptance since we can't bridge the call
                
                // FIX #5: Delete the orphaned attendee with retry logic
                const MAX_DELETE_RETRIES = 3;
                for (let attempt = 1; attempt <= MAX_DELETE_RETRIES; attempt++) {
                    try {
                        await chime.send(new DeleteAttendeeCommand({
                            MeetingId: agentMeeting.MeetingId,
                            AttendeeId: customerAttendee.AttendeeId!
                        }));
                        console.log('[call-accepted] Successfully deleted orphaned attendee on attempt', attempt);
                        break;
                    } catch (deleteErr: any) {
                        if (deleteErr.name === 'NotFoundException') {
                            // Attendee already deleted or never existed - no action needed
                            console.log('[call-accepted] Attendee already deleted or not found');
                            break;
                        }
                        console.error(`[call-accepted] Failed to delete orphaned attendee (attempt ${attempt}/${MAX_DELETE_RETRIES}):`, deleteErr);
                        if (attempt < MAX_DELETE_RETRIES) {
                            // Exponential backoff: 100ms, 200ms, 400ms
                            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
                        } else {
                            // Final attempt failed - log for manual cleanup
                            console.error('[call-accepted] ORPHANED ATTENDEE REQUIRES MANUAL CLEANUP:', {
                                meetingId: agentMeeting.MeetingId,
                                attendeeId: customerAttendee.AttendeeId,
                                callId
                            });
                        }
                    }
                }
                
                // Rollback database state
                // CRITICAL FIX: Preserve agentIds during rollback so the call can be retried
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition },
                                UpdateExpression: 'SET #status = :ringing REMOVE assignedAgentId, acceptedAt, customerAttendeeInfo',
                                ConditionExpression: '#status = :accepting AND assignedAgentId = :agentId',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':ringing': 'ringing',
                                    ':accepting': 'accepting',
                                    ':agentId': agentId
                                }
                            }
                        },
                        {
                            Update: {
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                UpdateExpression: 'SET #status = :online REMOVE currentCallId, callStatus',
                                ConditionExpression: 'currentCallId = :callId',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: { 
                                    ':online': 'Online',
                                    ':callId': callId
                                }
                            }
                        }
                    ]
                })).catch(rollbackErr => {
                    console.error('[call-accepted] CRITICAL: Rollback failed after SMA failure:', rollbackErr);
                    // Log for manual intervention
                });
                
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        message: 'Failed to bridge call. Please try again.',
                        error: 'SMA_BRIDGE_FAILED'
                    })
                };
            }
        } else {
            console.error('[call-accepted] SMA mapping not configured for clinic. Cannot bridge call.', { clinicId });
            // Rollback if no SMA configured
            await chime.send(new DeleteAttendeeCommand({
                MeetingId: agentMeeting.MeetingId,
                AttendeeId: customerAttendee.AttendeeId!
            })).catch(() => {});
            
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Call bridging not configured for this clinic' })
            };
        }

            // 7. Return success to the agent's frontend.
            // The frontend is already in the agent's meeting, so it just needs confirmation.
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Call acceptance recorded and bridge initiated',
                    callId,
                    agentId,
                    status: 'connected',
                })
            };
        } finally {
            // FIX #6: Release lock after ALL operations complete (transaction + attendee + SMA bridging)
            await lock.release();
        }

    } catch (error: any) {
        console.error('[call-accepted] Error processing call acceptance:', {
          message: error?.message,
          code: error?.name,
          requestId: event.requestContext?.requestId
        });
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
              message: 'Internal server error',
              error: error?.message
            })
        };
    }
};
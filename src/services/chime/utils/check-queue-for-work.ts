import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand, DeleteAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { getSmaIdForClinic } from './sma-map';

interface CheckQueueForWorkDeps {
    ddb: DynamoDBDocumentClient;
    callQueueTableName?: string;
    agentPresenceTableName?: string;
    chime: ChimeSDKMeetingsClient;
    chimeVoiceClient: ChimeSDKVoiceClient;
}

interface AgentCapabilities {
    skills?: string[];
    languages?: string[];
    canHandleVip?: boolean;
}

interface QueuedCall {
    clinicId: string;
    callId: string;
    queuePosition: number;
    queueEntryTime?: number;
    status?: string;
    priority?: 'high' | 'normal' | 'low';
    priorityScore?: number;
    isVip?: boolean;
    requiredSkills?: string[];
    preferredSkills?: string[];
    language?: string;
    phoneNumber?: string;
    isCallback?: boolean;
    previousCallCount?: number;
    [key: string]: any;
}

interface AgentInfo extends Record<string, any> {
    activeClinicIds?: string[];
    meetingInfo?: any;
    skills?: string[];
    languages?: string[];
    canHandleVip?: boolean;
}

/**
 * Calculate priority score for a queued call
 * 
 * FIX #7: Adjusted algorithm to prevent starvation of normal-priority calls:
 * - Priority bonuses are now smaller relative to wait time
 * - Wait time bonus uses 2x multiplier for first 30 minutes (urgent escalation)
 * - This ensures normal calls waiting 30+ minutes beat freshly-arrived high-priority calls
 * 
 * Priority breakdown:
 * - High priority base: 60 points
 * - Normal priority base: 30 points  
 * - Low priority base: 15 points
 * - VIP bonus: 30 points
 * - Wait time: 2 points/minute for first 30 min, 1 point/minute thereafter (max 180 total)
 * - Callback bonus: 20 points
 * 
 * Examples:
 * - Fresh high+VIP call: 60 + 30 = 90 points
 * - Normal call waiting 30 min: 30 + (30*2) = 90 points (ties!)
 * - Normal call waiting 45 min: 30 + 60 + 15 = 105 points (beats high+VIP)
 */
function calculatePriorityScore(entry: QueuedCall, nowSeconds: number): number {
    let score = 0;

    // Reduced priority base scores to give wait time more relative weight
    const priority = entry.priority || 'normal';
    switch (priority) {
        case 'high':
            score += 60;
            break;
        case 'normal':
            score += 30;
            break;
        case 'low':
            score += 15;
            break;
    }

    if (entry.isVip) {
        score += 30;
    }

    // FIX #7: Wait time bonus with early escalation to prevent starvation
    // First 30 minutes: 2 points per minute (aggressive)
    // After 30 minutes: 1 point per minute (steady)
    // Max total wait bonus: 180 points (60 + 120)
    const queueEntryTime = entry.queueEntryTime ?? nowSeconds;
    const waitMinutes = Math.max(0, (nowSeconds - queueEntryTime) / 60);
    
    if (waitMinutes <= 30) {
        // First 30 minutes: 2x multiplier for urgent escalation
        score += waitMinutes * 2;
    } else {
        // After 30 minutes: 60 points base + 1 per additional minute
        const additionalMinutes = Math.min(waitMinutes - 30, 120); // Cap at 2 more hours
        score += 60 + additionalMinutes;
    }

    if (entry.isCallback) {
        score += 20;
    }

    const previousCallCount = typeof entry.previousCallCount === 'number' ? entry.previousCallCount : 0;
    if (previousCallCount > 0) {
        score += Math.min(previousCallCount * 2, 10);
    }

    return score;
}

export function createCheckQueueForWork(deps: CheckQueueForWorkDeps) {
    const { ddb, callQueueTableName, agentPresenceTableName, chime, chimeVoiceClient } = deps;

    if (!callQueueTableName || !agentPresenceTableName) {
        throw new Error('[checkQueueForWork] Table names are required to process the queue.');
    }

    async function getNextCallFromQueue(
        clinicId: string,
        agentId: string,
        agentCapabilities: AgentCapabilities
    ): Promise<QueuedCall | null> {
        const { Items: queuedCalls } = await ddb.send(new QueryCommand({
            TableName: callQueueTableName,
            KeyConditionExpression: 'clinicId = :clinicId',
            FilterExpression: '#status = :status AND (attribute_not_exists(rejectedAgentIds) OR NOT contains(rejectedAgentIds, :agentId))',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':clinicId': clinicId,
                ':status': 'queued',
                ':agentId': agentId
            },
            ScanIndexForward: true
        }));

        if (!queuedCalls || queuedCalls.length === 0) {
            return null;
        }

        const nowSeconds = Math.floor(Date.now() / 1000);

        const matchingCalls = queuedCalls.filter((call: any) => {
            // CRITICAL FIX #7: Validate skills array contents before type cast
            const requiredSkills = Array.isArray(call.requiredSkills) && 
                                  call.requiredSkills.every((s: any) => typeof s === 'string')
                ? call.requiredSkills as string[] 
                : undefined;
            if (requiredSkills && requiredSkills.length > 0) {
                const agentSkills = agentCapabilities.skills || [];
                const hasAllSkills = requiredSkills.every((skill) => agentSkills.includes(skill));
                if (!hasAllSkills) {
                    return false;
                }
            }

            const language = typeof call.language === 'string' ? call.language : undefined;
            if (language) {
                const agentLanguages = agentCapabilities.languages && agentCapabilities.languages.length > 0
                    ? agentCapabilities.languages
                    : ['en'];
                if (!agentLanguages.includes(language)) {
                    return false;
                }
            }

            const isVip = call.isVip === true;
            if (isVip && !agentCapabilities.canHandleVip) {
                return false;
            }

            return true;
        }) as QueuedCall[];

        if (matchingCalls.length === 0) {
            return null;
        }

        const scoredCalls = matchingCalls.map((call) => {
            let priorityScore: number;
            
            if (typeof call.priorityScore === 'number') {
                // FIX #13: Validate priorityScore is within reasonable bounds
                // Clamp to [0, 1000] to prevent malformed records from breaking sorting
                priorityScore = Math.max(0, Math.min(call.priorityScore, 1000));
                if (call.priorityScore !== priorityScore) {
                    console.warn(`[checkQueueForWork] Clamped out-of-bounds priorityScore for call ${call.callId}`, {
                        original: call.priorityScore,
                        clamped: priorityScore
                    });
                }
            } else {
                priorityScore = calculatePriorityScore(call, nowSeconds);
            }

            return { ...call, priorityScore };
        });

        scoredCalls.sort((a, b) => {
            const scoreDiff = (b.priorityScore || 0) - (a.priorityScore || 0);
            if (scoreDiff !== 0) {
                return scoreDiff;
            }

            const aQueueTime = a.queueEntryTime ?? nowSeconds;
            const bQueueTime = b.queueEntryTime ?? nowSeconds;
            return aQueueTime - bQueueTime;
        });

        console.log('[checkQueueForWork] Top queued calls for clinic', clinicId, scoredCalls.slice(0, 3).map((c) => ({
            callId: c.callId,
            priority: c.priority || 'normal',
            score: c.priorityScore,
            waitMinutes: c.queueEntryTime ? Math.floor((nowSeconds - c.queueEntryTime) / 60) : 0
        })));

        return scoredCalls[0];
    }

    return async function checkQueueForWork(agentId: string, agentInfo: AgentInfo): Promise<void> {
        if (!agentInfo?.activeClinicIds || agentInfo.activeClinicIds.length === 0) {
            console.log(`[checkQueueForWork] Agent ${agentId} has no active clinics. Skipping.`);
            return;
        }

        const agentMeeting = agentInfo.meetingInfo;
        if (!agentMeeting?.MeetingId) {
            console.warn(`[checkQueueForWork] Agent ${agentId} has no session meeting. Cannot accept queued calls.`);
            return;
        }

        const activeClinicIds: string[] = agentInfo.activeClinicIds;

        const agentCapabilities: AgentCapabilities = {
            skills: Array.isArray(agentInfo.skills) ? agentInfo.skills : undefined,
            languages: Array.isArray(agentInfo.languages) && agentInfo.languages.length > 0 ? agentInfo.languages : ['en'],
            canHandleVip: agentInfo.canHandleVip === true
        };

        console.log(`[checkQueueForWork] Agent ${agentId} checking for queued calls in:`, activeClinicIds, 'capabilities:', agentCapabilities);

        for (const clinicId of activeClinicIds) {
            let callToAssign: QueuedCall | null = null;
            try {
                callToAssign = await getNextCallFromQueue(clinicId, agentId, agentCapabilities);

                if (!callToAssign) {
                    continue;
                }

                console.log(`[checkQueueForWork] Selected queued call ${callToAssign.callId} for clinic ${clinicId} (priority=${callToAssign.priority || 'normal'}, score=${callToAssign.priorityScore})`);

                const smaId = getSmaIdForClinic(clinicId);
                if (!smaId) {
                    console.error(`[checkQueueForWork] No SMA mapping for clinic ${clinicId}. Skipping call.`);
                    continue;
                }

                const assignmentTimestamp = new Date().toISOString();

                // CRITICAL FIX #1: Win transaction FIRST, THEN create attendee to prevent resource leak
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: callQueueTableName,
                                Key: { clinicId: callToAssign.clinicId, queuePosition: callToAssign.queuePosition },
                                UpdateExpression: 'SET #status = :ringing, agentIds = :agentIds, assignedAgentId = :agentId, meetingInfo = :meeting, assignedAt = :timestamp',
                                ConditionExpression: '#status = :queued AND (attribute_not_exists(rejectedAgentIds) OR NOT contains(rejectedAgentIds, :agentId))',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':ringing': 'ringing',
                                    ':agentIds': [agentId],
                                    ':agentId': agentId,
                                    ':meeting': agentMeeting,
                                    ':queued': 'queued',
                                    ':timestamp': assignmentTimestamp
                                }
                            }
                        },
                        {
                            Update: {
                                TableName: agentPresenceTableName,
                                Key: { agentId },
                                // FIX #2: Use 'Ringing' (capitalized) consistent with agent state machine
                                UpdateExpression: 'SET #status = :ringing, ringingCallId = :callId, ringingCallTime = :time, ringingCallFrom = :from, ringingCallPriority = :priority, lastActivityAt = :time',
                                ConditionExpression: '#status = :online',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':ringing': 'Ringing',
                                    ':callId': callToAssign.callId,
                                    ':time': assignmentTimestamp,
                                    ':from': callToAssign.phoneNumber || 'Unknown',
                                    ':priority': callToAssign.priority || 'normal',
                                    ':online': 'Online'
                                }
                            }
                        }
                    ]
                }));

                console.log(`[checkQueueForWork] Transaction succeeded - call ${callToAssign.callId} reserved`);

                // CRITICAL FIX #1: Create attendee AFTER winning the transaction
                let customerAttendee;
                try {
                    const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                        MeetingId: agentMeeting.MeetingId,
                        ExternalUserId: `customer-${callToAssign.callId}`
                    }));

                    customerAttendee = customerAttendeeResponse.Attendee;
                    if (!customerAttendee?.AttendeeId || !customerAttendee.JoinToken) {
                        throw new Error('Failed to create customer attendee');
                    }

                    // Update call record with attendee info
                    // FIX #6: Wrap in try-catch to cleanup attendee if update fails
                    try {
                        await ddb.send(new UpdateCommand({
                            TableName: callQueueTableName,
                            Key: { clinicId: callToAssign.clinicId, queuePosition: callToAssign.queuePosition },
                            UpdateExpression: 'SET customerAttendeeInfo = :attendee',
                            ConditionExpression: '#status = :ringing AND assignedAgentId = :agentId',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':attendee': customerAttendee,
                                ':ringing': 'ringing',
                                ':agentId': agentId
                            }
                        }));
                    } catch (updateErr: any) {
                        // FIX #6: Cleanup the orphaned attendee if update fails
                        console.error(`[checkQueueForWork] Failed to update call record with attendee, cleaning up:`, updateErr);
                        try {
                            // FIX: Use static import instead of dynamic import for better latency
                            await chime.send(new DeleteAttendeeCommand({
                                MeetingId: agentMeeting.MeetingId,
                                AttendeeId: customerAttendee.AttendeeId!
                            }));
                            console.log(`[checkQueueForWork] Cleaned up orphaned attendee ${customerAttendee.AttendeeId}`);
                        } catch (cleanupErr) {
                            console.error(`[checkQueueForWork] Failed to cleanup orphaned attendee:`, cleanupErr);
                        }
                        throw updateErr; // Re-throw to trigger rollback
                    }

                    console.log(`[checkQueueForWork] Created customer attendee ${customerAttendee.AttendeeId}`);
                } catch (attendeeErr) {
                    console.error(`[checkQueueForWork] Failed to create attendee, rolling back:`, attendeeErr);
                    // Rollback: reset call to queued
                    await ddb.send(new TransactWriteCommand({
                        TransactItems: [
                            {
                                Update: {
                                    TableName: callQueueTableName,
                                    Key: { clinicId: callToAssign.clinicId, queuePosition: callToAssign.queuePosition },
                                    UpdateExpression: 'SET #status = :queued REMOVE agentIds, assignedAgentId, meetingInfo, assignedAt, customerAttendeeInfo',
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
                                    TableName: agentPresenceTableName,
                                    Key: { agentId },
                                    UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallPriority',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':online': 'Online'
                                    }
                                }
                            }
                        ]
                    })).catch(rollbackErr => console.error('[checkQueueForWork] Rollback failed:', rollbackErr));
                    
                    continue; // Skip to next clinic
                }

                // FIX: Add error handling for SMA bridge failure
                try {
                    await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
                        SipMediaApplicationId: smaId,
                        TransactionId: callToAssign.callId,
                        Arguments: {
                            action: 'BRIDGE_CUSTOMER_INBOUND',
                            meetingId: agentMeeting.MeetingId,
                            customerAttendeeId: customerAttendee.AttendeeId!,
                            customerAttendeeJoinToken: customerAttendee.JoinToken!
                        }
                    }));

                    console.log(`[checkQueueForWork] Successfully assigned call ${callToAssign.callId} to agent ${agentId} and triggered bridge.`);
                } catch (smaBridgeErr: any) {
                    console.error(`[checkQueueForWork] SMA bridge failed for call ${callToAssign.callId}:`, smaBridgeErr);
                    
                    // Rollback: Delete orphaned attendee and reset states
                    try {
                        // Delete the orphaned customer attendee
                        // FIX: Use static import instead of dynamic import for better latency
                        await chime.send(new DeleteAttendeeCommand({
                            MeetingId: agentMeeting.MeetingId,
                            AttendeeId: customerAttendee.AttendeeId!
                        }));
                        console.log(`[checkQueueForWork] Cleaned up orphaned attendee ${customerAttendee.AttendeeId}`);
                    } catch (cleanupErr) {
                        console.error(`[checkQueueForWork] Failed to cleanup orphaned attendee:`, cleanupErr);
                    }
                    
                    // Rollback database state
                    await ddb.send(new TransactWriteCommand({
                        TransactItems: [
                            {
                                Update: {
                                    TableName: callQueueTableName,
                                    Key: { clinicId: callToAssign.clinicId, queuePosition: callToAssign.queuePosition },
                                    UpdateExpression: 'SET #status = :queued, smaBridgeError = :error REMOVE agentIds, assignedAgentId, meetingInfo, assignedAt, customerAttendeeInfo',
                                    ConditionExpression: '#status = :ringing AND assignedAgentId = :agentId',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':queued': 'queued',
                                        ':ringing': 'ringing',
                                        ':agentId': agentId,
                                        ':error': smaBridgeErr.message || 'SMA bridge failed'
                                    }
                                }
                            },
                            {
                                Update: {
                                    TableName: agentPresenceTableName,
                                    Key: { agentId },
                                    UpdateExpression: 'SET #status = :online REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallPriority',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':online': 'Online'
                                    }
                                }
                            }
                        ]
                    })).catch(rollbackErr => console.error('[checkQueueForWork] SMA bridge rollback failed:', rollbackErr));
                    
                    continue; // Try next clinic
                }
                return;
            } catch (err: any) {
                if (err?.name === 'TransactionCanceledException') {
                    console.warn(`[checkQueueForWork] Race condition assigning call for clinic ${clinicId}. Agent or call state changed.`);
                    // CRITICAL FIX #1: No orphaned attendees possible - created after transaction
                } else {
                    console.error(`[checkQueueForWork] Error processing queue for clinic ${clinicId}:`, err);
                }
            }
        }

        console.log(`[checkQueueForWork] No queued calls found for agent ${agentId}.`);
    };
}

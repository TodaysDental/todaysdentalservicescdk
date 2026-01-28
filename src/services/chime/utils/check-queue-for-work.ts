import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient } from '@aws-sdk/client-chime-sdk-voice';
import { selectBestAgents, type AgentInfo as SelectionAgentInfo, type CallContext } from './agent-selection';
import { isPushNotificationsEnabled, sendIncomingCallToAgents } from './push-notifications';
import { defaultRejectionTracker } from './rejection-tracker';
import { DistributedLock } from './distributed-lock';

interface CheckQueueForWorkDeps {
    ddb: DynamoDBDocumentClient;
    callQueueTableName?: string;
    agentPresenceTableName?: string;
    chime?: ChimeSDKMeetingsClient;
    chimeVoiceClient?: ChimeSDKVoiceClient;
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

const MAX_RING_AGENTS = Math.max(1, Number.parseInt(process.env.MAX_RING_AGENTS || '25', 10));
const MAX_SIMUL_RING_CALLS = Math.max(1, Number.parseInt(process.env.MAX_SIMUL_RING_CALLS || '10', 10));
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;

/**
 * Determine if an agent is eligible for a call (skills/language/VIP).
 * This is used to pre-filter agent pools before scoring.
 */
function agentEligibleForCall(agent: SelectionAgentInfo, call: QueuedCall): boolean {
    const requiredSkills = Array.isArray(call.requiredSkills) ? call.requiredSkills.filter((s) => typeof s === 'string') : [];
    if (requiredSkills.length > 0) {
        const agentSkills = Array.isArray(agent.skills) ? agent.skills : [];
        const hasAllRequired = requiredSkills.every((skill) => agentSkills.includes(skill));
        if (!hasAllRequired) {
            return false;
        }
    }

    const language = typeof call.language === 'string' ? call.language : undefined;
    if (language) {
        const agentLanguages = Array.isArray(agent.languages) && agent.languages.length > 0 ? agent.languages : ['en'];
        if (!agentLanguages.includes(language)) {
            return false;
        }
    }

    const isVip = call.isVip === true;
    if (isVip && agent.canHandleVip !== true) {
        return false;
    }

    return true;
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
    const { ddb, callQueueTableName, agentPresenceTableName } = deps;

    if (!callQueueTableName || !agentPresenceTableName) {
        throw new Error('[checkQueueForWork] Table names are required to process the queue.');
    }

    async function getRankedQueuedCalls(clinicId: string): Promise<QueuedCall[]> {
        const { Items: queuedCalls } = await ddb.send(new QueryCommand({
            TableName: callQueueTableName,
            KeyConditionExpression: 'clinicId = :clinicId',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':clinicId': clinicId,
                ':status': 'queued',
            },
            ScanIndexForward: true
        }));

        if (!queuedCalls || queuedCalls.length === 0) {
            return [];
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const scoredCalls = (queuedCalls as any[]).map((call) => {
            let priorityScore: number;

            if (typeof call.priorityScore === 'number') {
                // Validate priorityScore is within reasonable bounds
                priorityScore = Math.max(0, Math.min(call.priorityScore, 1000));
                if (call.priorityScore !== priorityScore) {
                    console.warn(`[checkQueueForWork] Clamped out-of-bounds priorityScore for call ${call.callId}`, {
                        original: call.priorityScore,
                        clamped: priorityScore
                    });
                }
            } else {
                priorityScore = calculatePriorityScore(call as QueuedCall, nowSeconds);
            }

            return { ...(call as QueuedCall), priorityScore };
        }) as QueuedCall[];

        scoredCalls.sort((a, b) => {
            const scoreDiff = (b.priorityScore || 0) - (a.priorityScore || 0);
            if (scoreDiff !== 0) return scoreDiff;

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

        return scoredCalls;
    }

    async function fetchIdleAgentsForClinic(clinicId: string, maxAgentsToFetch: number): Promise<SelectionAgentInfo[]> {
        const collected: SelectionAgentInfo[] = [];
        let lastEvaluatedKey: Record<string, any> | undefined = undefined;

        // NOTE: This uses status-index + FilterExpression because agent presence records store activeClinicIds as a list.
        // If this becomes a hotspot at scale, consider adding a composite index keyed by clinicId+status.
        do {
            const result: any = await ddb.send(new QueryCommand({
                TableName: agentPresenceTableName,
                IndexName: 'status-index',
                KeyConditionExpression: '#status = :status',
                FilterExpression: 'contains(activeClinicIds, :clinicId) AND attribute_exists(meetingInfo) AND attribute_not_exists(currentCallId) AND attribute_not_exists(ringingCallId)',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': 'Online',
                    ':clinicId': clinicId
                },
                ProjectionExpression: 'agentId, skills, languages, canHandleVip, lastActivityAt, recentCallCount, completedCallsToday, lastCallCustomerPhone',
                Limit: 100,
                ExclusiveStartKey: lastEvaluatedKey
            }));

            if (result.Items && result.Items.length > 0) {
                collected.push(...(result.Items as SelectionAgentInfo[]));
            }

            lastEvaluatedKey = result.LastEvaluatedKey;
            if (collected.length >= maxAgentsToFetch) {
                break;
            }
        } while (lastEvaluatedKey);

        return collected.slice(0, maxAgentsToFetch);
    }

    async function ringCallToAgents(call: QueuedCall, agentIds: string[]): Promise<void> {
        const ringAttemptTimestamp = new Date().toISOString();
        const uniqueAgentIds = Array.from(new Set(agentIds)).slice(0, MAX_RING_AGENTS);

        if (uniqueAgentIds.length === 0) return;

        // 1) Transition call queued -> ringing (first answer wins; do NOT set assignedAgentId)
        try {
            await ddb.send(new UpdateCommand({
                TableName: callQueueTableName,
                Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
                UpdateExpression: 'SET #status = :ringing, agentIds = :agentIds, ringStartTimeIso = :ts, ringStartTime = :now, lastStateChange = :ts, updatedAt = :ts',
                ConditionExpression: '#status = :queued',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':ringing': 'ringing',
                    ':queued': 'queued',
                    ':agentIds': uniqueAgentIds,
                    ':ts': ringAttemptTimestamp,
                    ':now': Date.now(),
                }
            }));
        } catch (err: any) {
            if (err?.name === 'ConditionalCheckFailedException') {
                return; // Call already transitioned by another process
            }
            throw err;
        }

        // 2) Mark agents as Ringing (best-effort)
        const callPhone = typeof call.phoneNumber === 'string' && call.phoneNumber.length > 0 ? call.phoneNumber : 'Unknown';
        const ringPriority = call.priority || 'normal';

        const ringResults = await Promise.allSettled(
            uniqueAgentIds.map(async (agentId) => {
                await ddb.send(new UpdateCommand({
                    TableName: agentPresenceTableName,
                    Key: { agentId },
                    UpdateExpression:
                        'SET #status = :ringing, ringingCallId = :callId, ringingCallTime = :time, ringingCallFrom = :from, ringingCallPriority = :priority, ringingCallClinicId = :clinicId, lastActivityAt = :time',
                    ConditionExpression: '#status = :online AND attribute_exists(meetingInfo) AND attribute_not_exists(currentCallId) AND attribute_not_exists(ringingCallId)',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':ringing': 'Ringing',
                        ':online': 'Online',
                        ':callId': call.callId,
                        ':time': ringAttemptTimestamp,
                        ':from': callPhone,
                        ':priority': ringPriority,
                        ':clinicId': call.clinicId,
                    }
                }));
                return agentId;
            })
        );

        const ringingAgentIds: string[] = [];
        for (const r of ringResults) {
            if (r.status === 'fulfilled') {
                ringingAgentIds.push(r.value);
            }
        }

        if (ringingAgentIds.length === 0) {
            // Nobody actually rang; revert the call back to queued.
            try {
                await ddb.send(new UpdateCommand({
                    TableName: callQueueTableName,
                    Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
                    UpdateExpression: 'SET #status = :queued, updatedAt = :ts REMOVE agentIds, ringStartTimeIso, ringStartTime, lastStateChange',
                    ConditionExpression: '#status = :ringing',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':queued': 'queued',
                        ':ringing': 'ringing',
                        ':ts': new Date().toISOString(),
                    }
                }));
            } catch (revertErr: any) {
                if (revertErr?.name !== 'ConditionalCheckFailedException') {
                    console.warn('[checkQueueForWork] Failed to revert call after no agents rang:', revertErr);
                }
            }
            return;
        }

        // Narrow the call's ring list to only agents actually ringing
        try {
            await ddb.send(new UpdateCommand({
                TableName: callQueueTableName,
                Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
                UpdateExpression: 'SET agentIds = :agentIds, updatedAt = :ts',
                ConditionExpression: '#status = :ringing',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':agentIds': ringingAgentIds,
                    ':ringing': 'ringing',
                    ':ts': new Date().toISOString(),
                }
            }));
        } catch (narrowErr: any) {
            if (narrowErr?.name !== 'ConditionalCheckFailedException') {
                console.warn('[checkQueueForWork] Failed to narrow ring list (non-fatal):', narrowErr);
            }
        }

        if (isPushNotificationsEnabled()) {
            try {
                await sendIncomingCallToAgents(ringingAgentIds, {
                    callId: call.callId,
                    clinicId: call.clinicId,
                    clinicName: call.clinicId,
                    callerPhoneNumber: callPhone,
                    timestamp: new Date().toISOString(),
                });
            } catch (pushErr) {
                console.warn('[checkQueueForWork] Failed to send push notification (non-fatal):', pushErr);
            }
        }

        console.log(`[checkQueueForWork] Ringing started for queued call ${call.callId}`, {
            clinicId: call.clinicId,
            ringingAgents: ringingAgentIds.length,
        });
    }

    /**
     * FAIR-SHARE DISPATCHER:
     * Split available idle agents across multiple queued calls so multiple calls can ring simultaneously.
     * This prevents one call from monopolizing all agents when several calls are waiting.
     */
    async function dispatchForClinic(clinicId: string): Promise<void> {
        if (!LOCKS_TABLE_NAME) {
            console.warn('[checkQueueForWork] LOCKS_TABLE_NAME not configured - dispatch will run without a lock (may race)');
        }

        const lock = LOCKS_TABLE_NAME ? new DistributedLock(ddb, {
            tableName: LOCKS_TABLE_NAME,
            lockKey: `clinic-dispatch-${clinicId}`,
            ttlSeconds: 10,
            maxRetries: 3,
            retryDelayMs: 100
        }) : null;

        const lockAcquired = lock ? await lock.acquire() : true;
        if (!lockAcquired) {
            return;
        }

        try {
            const rankedCalls = await getRankedQueuedCalls(clinicId);
            if (rankedCalls.length === 0) {
                return;
            }

            // Fetch idle agents for this clinic (Online, has meetingInfo, not ringing, not on call)
            const targetAgentCount = Math.min(MAX_RING_AGENTS * MAX_SIMUL_RING_CALLS, 250);
            const idleAgents = await fetchIdleAgentsForClinic(clinicId, targetAgentCount);
            if (idleAgents.length === 0) {
                return;
            }

            // Sort agents by idle time (oldest activity first) for fairness
            const sortedAgents = idleAgents.slice().sort((a, b) => {
                const aTs = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
                const bTs = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
                return aTs - bTs;
            });

            const callsToRingCount = Math.min(rankedCalls.length, sortedAgents.length, MAX_SIMUL_RING_CALLS);
            const callsToRing = rankedCalls.slice(0, callsToRingCount);

            // Compute fair per-call target counts (at least 1 agent/call when possible)
            const totalAgents = sortedAgents.length;
            const basePerCall = Math.max(1, Math.floor(totalAgents / callsToRing.length));
            let remainder = totalAgents % callsToRing.length;

            const allocations: Map<string, { call: QueuedCall; agentIds: string[] }> = new Map();
            let remainingPool: SelectionAgentInfo[] = sortedAgents;

            for (let i = 0; i < callsToRing.length; i++) {
                const call = callsToRing[i];
                let desired = basePerCall + (remainder > 0 ? 1 : 0);
                if (remainder > 0) remainder--;
                desired = Math.min(MAX_RING_AGENTS, desired);

                const callPhone = typeof call.phoneNumber === 'string' && call.phoneNumber.length > 0 ? call.phoneNumber : 'Unknown';
                const callContext: CallContext = {
                    callId: call.callId,
                    clinicId: call.clinicId,
                    phoneNumber: callPhone,
                    priority: call.priority || 'normal',
                    isVip: !!call.isVip,
                    requiredSkills: Array.isArray(call.requiredSkills) ? call.requiredSkills : undefined,
                    preferredSkills: Array.isArray(call.preferredSkills) ? call.preferredSkills : undefined,
                    language: typeof call.language === 'string' ? call.language : undefined,
                    isCallback: !!call.isCallback,
                    previousCallCount: typeof call.previousCallCount === 'number' ? call.previousCallCount : 0,
                    previousAgentId: typeof (call as any).previousAgentId === 'string' ? (call as any).previousAgentId : undefined,
                };

                // Pre-filter remaining agents for eligibility + recent rejection
                const eligiblePool = remainingPool.filter((agent) =>
                    agentEligibleForCall(agent, call) &&
                    !defaultRejectionTracker.hasRecentlyRejected(call, agent.agentId)
                );

                if (eligiblePool.length === 0) {
                    allocations.set(call.callId, { call, agentIds: [] });
                    continue;
                }

                const rankedAgentsForCall = selectBestAgents(
                    eligiblePool,
                    callContext,
                    {
                        maxAgents: desired,
                        considerIdleTime: true,
                        considerWorkload: true,
                        prioritizeContinuity: !!callContext.isCallback,
                    }
                );

                const chosen = rankedAgentsForCall.slice(0, desired);
                const chosenIds = chosen.map((a) => a.agentId);
                allocations.set(call.callId, { call, agentIds: chosenIds });

                const chosenSet = new Set(chosenIds);
                remainingPool = remainingPool.filter((a) => !chosenSet.has(a.agentId));
            }

            // Distribute any leftover agents to calls that still have capacity (best-effort)
            if (remainingPool.length > 0) {
                const callList = callsToRing.slice();
                for (const agent of remainingPool) {
                    // Find the call with the fewest assigned agents that this agent can handle
                    let bestCall: QueuedCall | null = null;
                    let bestCount = Number.MAX_SAFE_INTEGER;

                    for (const call of callList) {
                        const allocation = allocations.get(call.callId);
                        const currentCount = allocation?.agentIds.length || 0;
                        if (currentCount >= MAX_RING_AGENTS) continue;
                        if (!agentEligibleForCall(agent, call)) continue;
                        if (defaultRejectionTracker.hasRecentlyRejected(call, agent.agentId)) continue;

                        if (currentCount < bestCount) {
                            bestCount = currentCount;
                            bestCall = call;
                        }
                    }

                    if (!bestCall) {
                        continue;
                    }

                    const allocation = allocations.get(bestCall.callId);
                    if (allocation) {
                        allocation.agentIds.push(agent.agentId);
                    } else {
                        allocations.set(bestCall.callId, { call: bestCall, agentIds: [agent.agentId] });
                    }
                }
            }

            // Ring each call with its allocated agent set (sequential to avoid bursty write spikes)
            for (const { call, agentIds } of allocations.values()) {
                if (agentIds.length === 0) continue;
                await ringCallToAgents(call, agentIds);
            }
        } finally {
            if (lock) {
                await lock.release();
            }
        }
    }

    return async function checkQueueForWork(agentId: string, agentInfo: AgentInfo): Promise<void> {
        if (!agentInfo?.activeClinicIds || agentInfo.activeClinicIds.length === 0) {
            console.log(`[checkQueueForWork] Agent ${agentId} has no active clinics. Skipping.`);
            return;
        }

        const activeClinicIds: string[] = agentInfo.activeClinicIds;
        console.log(`[checkQueueForWork] Agent ${agentId} triggering fair-share dispatch for:`, activeClinicIds);

        for (const clinicId of activeClinicIds) {
            try {
                await dispatchForClinic(clinicId);
            } catch (err: any) {
                console.error(`[checkQueueForWork] Error dispatching for clinic ${clinicId}:`, err);
            }
        }
    };
}

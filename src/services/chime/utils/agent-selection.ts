/**
 * Enhanced Agent Selection Module
 * Implements intelligent skill-based routing with workload balancing
 */

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface CallContext {
    callId: string;
    clinicId: string;
    phoneNumber: string;
    priority?: 'high' | 'normal' | 'low';
    isVip?: boolean;
    requiredSkills?: string[];
    preferredSkills?: string[];
    language?: string;
    isCallback?: boolean;
    previousCallCount?: number;
    previousAgentId?: string;
}

export interface AgentInfo {
    agentId: string;
    status: string;
    skills?: string[];
    languages?: string[];
    canHandleVip?: boolean;
    lastActivityAt?: string;
    recentCallCount?: number;
    completedCallsToday?: number;
    averageCallDuration?: number;
    activeClinicIds?: string[];
    lastCallCustomerPhone?: string;
}

interface AgentScore {
    agentId: string;
    agent: AgentInfo;
    score: number;
    reasons: string[];
    breakdown: {
        skillMatch: number;
        languageMatch: number;
        idleTime: number;
        workloadBalance: number;
        continuity: number;
        other: number;
    };
}

interface SelectionConfig {
    maxAgents: number;
    considerIdleTime: boolean;
    considerWorkload: boolean;
    prioritizeContinuity: boolean;
    parallelRing: boolean;
}

const DEFAULT_CONFIG: SelectionConfig = {
    maxAgents: 25,
    considerIdleTime: true,
    considerWorkload: true,
    prioritizeContinuity: true,
    parallelRing: false
};

/**
 * Enriches call context with historical data and priority calculation
 */
export async function enrichCallContext(
    ddb: DynamoDBDocumentClient,
    callId: string,
    clinicId: string,
    phoneNumber: string,
    callQueueTableName: string,
    vipPhoneNumbers: Set<string> = new Set()
): Promise<CallContext> {

    const context: CallContext = {
        callId,
        clinicId,
        phoneNumber,
        priority: 'normal',
        isVip: false,
        isCallback: false,
        previousCallCount: 0
    };

    try {
        // Check call history for this number
        const { Items: previousCalls } = await ddb.send(new QueryCommand({
            TableName: callQueueTableName,
            IndexName: 'phoneNumber-clinicId-index',
            KeyConditionExpression: 'phoneNumber = :phone AND clinicId = :clinic',
            ExpressionAttributeValues: {
                ':phone': phoneNumber,
                ':clinic': clinicId
            },
            Limit: 10,
            ScanIndexForward: false, // Most recent first
            ProjectionExpression: 'callId, #status, assignedAgentId, queueEntryTime',
            ExpressionAttributeNames: {
                '#status': 'status'
            }
        }));

        if (previousCalls && previousCalls.length > 0) {
            context.previousCallCount = previousCalls.length;

            // Check if most recent call was abandoned (callback scenario)
            const lastCall = previousCalls[0] as any;
            if (lastCall.status === 'abandoned') {
                context.isCallback = true;
                context.previousAgentId = lastCall.assignedAgentId;
                console.log(`[enrichCallContext] Detected callback for ${phoneNumber}, previous agent: ${context.previousAgentId}`);
            }
        }

        // Check VIP status
        context.isVip = vipPhoneNumbers.has(phoneNumber);

        // Determine priority
        if (context.isVip) {
            context.priority = 'high';
        } else if (context.isCallback) {
            context.priority = 'high'; // Callbacks get priority
        } else if (context.previousCallCount && context.previousCallCount > 3) {
            context.priority = 'high'; // Frequent callers
        }

        console.log('[enrichCallContext] Context enriched:', {
            callId,
            phoneNumber,
            priority: context.priority,
            isVip: context.isVip,
            isCallback: context.isCallback,
            previousCallCount: context.previousCallCount
        });

    } catch (err) {
        console.error('[enrichCallContext] Error enriching context:', err);
        // Continue with default context
    }

    return context;
}

/**
 * Scores an individual agent for a specific call
 */
function scoreAgentForCall(
    agent: AgentInfo,
    call: CallContext,
    nowSeconds: number,
    config: SelectionConfig
): AgentScore {

    const breakdown = {
        skillMatch: 0,
        languageMatch: 0,
        idleTime: 0,
        workloadBalance: 0,
        continuity: 0,
        other: 0
    };

    let score = 0;
    const reasons: string[] = [];

    // 1. REQUIRED SKILLS - Must have all (disqualifying if missing)
    if (call.requiredSkills && call.requiredSkills.length > 0) {
        const agentSkills = agent.skills || [];
        const hasAllRequired = call.requiredSkills.every(skill =>
            agentSkills.includes(skill)
        );

        if (!hasAllRequired) {
            return {
                agentId: agent.agentId,
                agent,
                score: -1000,
                reasons: ['missing_required_skills'],
                breakdown
            };
        }

        breakdown.skillMatch += 50;
        score += 50;
        reasons.push('has_required_skills');
    }

    // 2. PREFERRED SKILLS - Bonus points
    if (call.preferredSkills && call.preferredSkills.length > 0) {
        const agentSkills = agent.skills || [];
        const matchedPreferred = call.preferredSkills.filter(skill =>
            agentSkills.includes(skill)
        );

        const preferredBonus = matchedPreferred.length * 10;
        breakdown.skillMatch += preferredBonus;
        score += preferredBonus;

        if (matchedPreferred.length > 0) {
            reasons.push(`matched_${matchedPreferred.length}_preferred_skills`);
        }
    }

    // 3. LANGUAGE MATCHING - Required if specified
    if (call.language) {
        const agentLanguages = agent.languages || ['en'];

        if (agentLanguages.includes(call.language)) {
            breakdown.languageMatch += 30;
            score += 30;
            reasons.push('language_match');
        } else {
            return {
                agentId: agent.agentId,
                agent,
                score: -1000,
                reasons: ['language_mismatch'],
                breakdown
            };
        }
    }

    // 4. VIP HANDLING CAPABILITY
    if (call.isVip) {
        if (!agent.canHandleVip) {
            return {
                agentId: agent.agentId,
                agent,
                score: -1000,
                reasons: ['cannot_handle_vip'],
                breakdown
            };
        }

        breakdown.other += 40;
        score += 40;
        reasons.push('vip_capable');
    }

    // 5. IDLE TIME CONSIDERATION (longer idle = higher score)
    // CRITICAL FIX #6: Cap idle time to prevent overwhelming other factors
    if (config.considerIdleTime && agent.lastActivityAt) {
        const lastActivitySeconds = Math.floor(
            new Date(agent.lastActivityAt).getTime() / 1000
        );
        const idleMinutes = Math.min(30, (nowSeconds - lastActivitySeconds) / 60); // Already capped at 30
        const idleBonus = Math.floor(idleMinutes * 2); // Max 60 points for 30+ minutes

        breakdown.idleTime += idleBonus;
        score += idleBonus;
        reasons.push(`idle_${Math.floor(idleMinutes)}min`);
    }

    // 6. WORKLOAD BALANCING (avoid overwhelming recently busy agents)
    if (config.considerWorkload) {
        const recentCallCount = agent.recentCallCount || 0;
        const workloadPenalty = recentCallCount * 5;

        breakdown.workloadBalance -= workloadPenalty;
        score -= workloadPenalty;

        if (recentCallCount > 0) {
            reasons.push(`recent_calls_${recentCallCount}`);
        }

        // Bonus for agents with fewer completed calls today (balance distribution)
        const completedToday = agent.completedCallsToday || 0;
        if (completedToday < 10) { // Agents with <10 calls get bonus
            const balanceBonus = (10 - completedToday) * 2;
            breakdown.workloadBalance += balanceBonus;
            score += balanceBonus;
            reasons.push(`low_daily_count_${completedToday}`);
        }
    }

    // 7. CONTINUITY BONUS (callback to same agent)
    if (config.prioritizeContinuity && call.isCallback && call.previousAgentId) {
        if (agent.agentId === call.previousAgentId) {
            breakdown.continuity += 100;
            score += 100; // Strong preference for continuity
            reasons.push('previous_handler');
        }
    }

    // 8. CUSTOMER RELATIONSHIP BONUS
    if (agent.lastCallCustomerPhone === call.phoneNumber) {
        const relationshipBonus = 50;
        breakdown.continuity += relationshipBonus;
        score += relationshipBonus;
        reasons.push('customer_relationship');
    }

    return {
        agentId: agent.agentId,
        agent,
        score,
        reasons,
        breakdown
    };
}

/**
 * Selects the best agents for a call using intelligent scoring
 */
export function selectBestAgents(
    agents: AgentInfo[],
    callContext: CallContext,
    config: Partial<SelectionConfig> = {}
): AgentInfo[] {

    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const nowSeconds = Math.floor(Date.now() / 1000);

    console.log('[selectBestAgents] Evaluating agents', {
        totalAgents: agents.length,
        callId: callContext.callId,
        priority: callContext.priority,
        isCallback: callContext.isCallback
    });

    // Score all agents
    const scoredAgents = agents
        .map(agent => scoreAgentForCall(agent, callContext, nowSeconds, fullConfig))
        .filter(scored => scored.score > -1000); // Remove disqualified agents

    if (scoredAgents.length === 0) {
        console.warn('[selectBestAgents] No qualified agents found for call', {
            callId: callContext.callId,
            requiredSkills: callContext.requiredSkills,
            language: callContext.language,
            isVip: callContext.isVip
        });
        return [];
    }

    // Sort by score (descending)
    scoredAgents.sort((a, b) => b.score - a.score);

    // Log top candidates for observability
    const topCandidates = scoredAgents.slice(0, Math.min(5, scoredAgents.length));
    console.log('[selectBestAgents] Top candidates:',
        topCandidates.map(s => ({
            agentId: s.agentId,
            score: s.score,
            breakdown: s.breakdown,
            reasons: s.reasons
        }))
    );

    // Return top N agents
    const selectedCount = Math.min(fullConfig.maxAgents, scoredAgents.length);
    const selected = scoredAgents.slice(0, selectedCount).map(s => s.agent);

    console.log(`[selectBestAgents] Selected ${selected.length} agents for call ${callContext.callId}`);

    return selected;
}

/**
 * Fetches online agents for a clinic with optimized query
 * CRITICAL FIX #5: Handle pagination to evaluate all available agents
 */
export async function fetchOnlineAgents(
    ddb: DynamoDBDocumentClient,
    clinicId: string,
    agentPresenceTableName: string,
    maxAgents: number = 25
): Promise<AgentInfo[]> {

    try {
        const allAgents: AgentInfo[] = [];
        let lastEvaluatedKey: Record<string, any> | undefined = undefined;
        const targetCount = maxAgents * 4; // Fetch 4x to ensure good selection after filtering
        
        // CRITICAL FIX #5: Implement pagination loop
        do {
            const queryResult = await ddb.send(new QueryCommand({
                TableName: agentPresenceTableName,
                IndexName: 'status-index',
                KeyConditionExpression: '#status = :status',
                FilterExpression: 'contains(activeClinicIds, :clinicId)',
                ProjectionExpression: 'agentId, skills, languages, canHandleVip, lastActivityAt, recentCallCount, completedCallsToday, lastCallCustomerPhone',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': 'Online',
                    ':clinicId': clinicId
                },
                Limit: 100, // Reasonable batch size
                ExclusiveStartKey: lastEvaluatedKey
            }));

            if (queryResult.Items && queryResult.Items.length > 0) {
                allAgents.push(...(queryResult.Items as AgentInfo[]));
            }

            lastEvaluatedKey = queryResult.LastEvaluatedKey;
            
            // Stop if we have enough agents or no more pages
            if (allAgents.length >= targetCount || !lastEvaluatedKey) {
                break;
            }
        } while (lastEvaluatedKey);

        if (allAgents.length === 0) {
            console.log(`[fetchOnlineAgents] No online agents found for clinic ${clinicId}`);
            return [];
        }

        console.log(`[fetchOnlineAgents] Found ${allAgents.length} online agents for clinic ${clinicId} (target: ${targetCount})`);
        return allAgents;

    } catch (err) {
        console.error('[fetchOnlineAgents] Error fetching agents:', err);
        return [];
    }
}

/**
 * Complete agent selection workflow
 */
export async function selectAgentsForCall(
    ddb: DynamoDBDocumentClient,
    callContext: CallContext,
    agentPresenceTableName: string,
    config: Partial<SelectionConfig> = {}
): Promise<AgentInfo[]> {

    // 1. Fetch online agents
    const onlineAgents = await fetchOnlineAgents(
        ddb,
        callContext.clinicId,
        agentPresenceTableName,
        config.maxAgents
    );

    if (onlineAgents.length === 0) {
        return [];
    }

    // 2. Score and select best agents
    const selectedAgents = selectBestAgents(onlineAgents, callContext, config);

    return selectedAgents;
}


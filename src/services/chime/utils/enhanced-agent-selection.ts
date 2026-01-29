/**
 * Enhanced Agent Selection Module
 * 
 * Extends the base agent selection with advanced scoring algorithms:
 * - Time-of-day performance weighting
 * - Historical performance scores
 * - Fair distribution / round-robin mode
 * - Caller profile matching
 * 
 * @module enhanced-agent-selection
 */

import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { AgentInfo, CallContext } from './agent-selection';

export interface EnhancedConfig {
    /** Enable time-of-day weighting */
    useTimeOfDayWeighting: boolean;
    /** Enable historical performance scoring */
    useHistoricalPerformance: boolean;
    /** Enable fair distribution mode */
    fairDistributionMode: boolean;
    /** Weight for performance vs availability (0-1) */
    performanceWeight: number;
    /** Maximum calls per agent before deprioritization */
    maxCallsBeforeDeprioritize: number;
    /** Time window for performance calculation (hours) */
    performanceWindowHours: number;
}

export const DEFAULT_ENHANCED_CONFIG: EnhancedConfig = {
    useTimeOfDayWeighting: process.env.CHIME_USE_TIME_OF_DAY_WEIGHTING === 'true',
    useHistoricalPerformance: process.env.CHIME_USE_HISTORICAL_PERFORMANCE !== 'false',
    fairDistributionMode: process.env.CHIME_FAIR_DISTRIBUTION_MODE === 'true',
    performanceWeight: parseFloat(process.env.CHIME_PERFORMANCE_WEIGHT || '0.3'),
    maxCallsBeforeDeprioritize: parseInt(process.env.CHIME_MAX_CALLS_BEFORE_DEPRIORITIZE || '15', 10),
    performanceWindowHours: parseInt(process.env.CHIME_PERFORMANCE_WINDOW_HOURS || '24', 10),
};

export interface AgentPerformanceData {
    agentId: string;
    // Performance metrics
    firstCallResolutionRate: number;      // 0-100
    averageHandleTime: number;            // seconds
    customerSatisfactionScore: number;    // 0-100
    callsHandled: number;
    abandonmentRate: number;              // 0-100 (lower is better)
    // Time-of-day performance
    hourlyPerformance: Record<number, {
        callCount: number;
        avgHandleTime: number;
        satisfactionScore: number;
    }>;
    // Shift data
    preferredHours: number[];
    peakPerformanceHours: number[];
}

export interface EnhancedAgentScore {
    agentId: string;
    baseScore: number;
    timeOfDayBonus: number;
    performanceBonus: number;
    fairnessAdjustment: number;
    callerMatchBonus: number;
    totalScore: number;
    reasons: string[];
}

/**
 * Calculates time-of-day performance bonus
 * Agents who perform better at certain hours get priority during those hours
 */
export function calculateTimeOfDayBonus(
    performanceData: AgentPerformanceData | null,
    currentHour: number,
    config: Partial<EnhancedConfig> = {}
): number {
    const fullConfig = { ...DEFAULT_ENHANCED_CONFIG, ...config };

    if (!fullConfig.useTimeOfDayWeighting || !performanceData) {
        return 0;
    }

    // Check if current hour is in peak performance hours
    if (performanceData.peakPerformanceHours.includes(currentHour)) {
        return 25; // Significant bonus for peak hours
    }

    // Check hourly performance data
    const hourlyData = performanceData.hourlyPerformance[currentHour];
    if (hourlyData && hourlyData.callCount >= 5) {
        // Normalize satisfaction score to bonus (0-20 points)
        const satBonus = (hourlyData.satisfactionScore / 100) * 20;
        return Math.round(satBonus);
    }

    // Check if current hour is in preferred hours
    if (performanceData.preferredHours.includes(currentHour)) {
        return 10;
    }

    return 0;
}

/**
 * Calculates historical performance bonus
 * Higher performing agents get priority, but not overwhelming priority
 */
export function calculatePerformanceBonus(
    performanceData: AgentPerformanceData | null,
    config: Partial<EnhancedConfig> = {}
): number {
    const fullConfig = { ...DEFAULT_ENHANCED_CONFIG, ...config };

    if (!fullConfig.useHistoricalPerformance || !performanceData) {
        return 0;
    }

    let bonus = 0;
    const reasons: string[] = [];

    // First call resolution (0-30 points)
    if (performanceData.firstCallResolutionRate >= 80) {
        bonus += 30;
        reasons.push('high_fcr');
    } else if (performanceData.firstCallResolutionRate >= 60) {
        bonus += 15;
        reasons.push('moderate_fcr');
    }

    // Customer satisfaction (0-25 points)
    if (performanceData.customerSatisfactionScore >= 90) {
        bonus += 25;
        reasons.push('high_csat');
    } else if (performanceData.customerSatisfactionScore >= 75) {
        bonus += 10;
        reasons.push('moderate_csat');
    }

    // Low abandonment rate (0-15 points)
    if (performanceData.abandonmentRate <= 5) {
        bonus += 15;
        reasons.push('low_abandonment');
    } else if (performanceData.abandonmentRate <= 10) {
        bonus += 5;
    }

    // Efficient handle time (rewarding efficiency without rushing)
    // This is complex - too fast might mean poor quality, too slow costs money
    // We'll reward being within 20% of average
    // (This would need more context, simplified for now)

    // Apply performance weight
    return Math.round(bonus * fullConfig.performanceWeight);
}

/**
 * Calculates fairness adjustment for round-robin style distribution
 * Agents with fewer calls today get priority
 */
export function calculateFairnessAdjustment(
    agent: AgentInfo,
    allAgents: AgentInfo[],
    config: Partial<EnhancedConfig> = {}
): number {
    const fullConfig = { ...DEFAULT_ENHANCED_CONFIG, ...config };

    if (!fullConfig.fairDistributionMode) {
        return 0;
    }

    const agentCallsToday = agent.completedCallsToday || 0;

    // Calculate average calls across all agents
    const totalCalls = allAgents.reduce((sum, a) => sum + (a.completedCallsToday || 0), 0);
    const avgCalls = allAgents.length > 0 ? totalCalls / allAgents.length : 0;

    // Agents with fewer than average calls get a bonus
    // Agents with more than average calls get a penalty
    const deviation = avgCalls - agentCallsToday;

    // Each call below average = +5 points, each above = -5 points
    // Capped at +/- 30 points
    const adjustment = Math.max(-30, Math.min(30, deviation * 5));

    // Strong penalty for agents significantly over the max threshold
    if (agentCallsToday > fullConfig.maxCallsBeforeDeprioritize) {
        const overMax = agentCallsToday - fullConfig.maxCallsBeforeDeprioritize;
        return adjustment - (overMax * 10); // -10 per call over max
    }

    return Math.round(adjustment);
}

/**
 * Calculates caller profile match bonus
 * Matches callers with agents who have successfully handled similar profiles
 */
export async function calculateCallerMatchBonus(
    ddb: DynamoDBDocumentClient,
    agent: AgentInfo,
    callContext: CallContext,
    callAnalyticsTableName: string
): Promise<number> {
    try {
        // Query for previous successful calls with this caller handled by this agent
        const { Items: previousCalls } = await ddb.send(new QueryCommand({
            TableName: callAnalyticsTableName,
            IndexName: 'agentId-timestamp-index',
            KeyConditionExpression: 'agentId = :agentId',
            FilterExpression: 'callerPhoneNumber = :phone AND callStatus = :completed',
            ExpressionAttributeValues: {
                ':agentId': agent.agentId,
                ':phone': callContext.phoneNumber,
                ':completed': 'completed',
            },
            Limit: 10,
            ScanIndexForward: false,
        }));

        if (!previousCalls || previousCalls.length === 0) {
            return 0;
        }

        // Agent has handled this caller before - significant bonus
        let bonus = 50;

        // Check if previous calls had good outcomes
        const recentCalls = previousCalls.slice(0, 5);
        const positiveOutcomes = recentCalls.filter((c: any) =>
            c.overallSentiment === 'POSITIVE' || c.customerSatisfaction >= 4
        );

        if (positiveOutcomes.length >= 3) {
            bonus += 25; // Extra bonus for history of positive interactions
        }

        return bonus;

    } catch (error: any) {
        console.error('[calculateCallerMatchBonus] Error:', error.message);
        return 0;
    }
}

/**
 * Fetches performance data for an agent
 */
export async function fetchAgentPerformanceData(
    ddb: DynamoDBDocumentClient,
    agentId: string,
    agentPerformanceTableName: string
): Promise<AgentPerformanceData | null> {
    try {
        const { Item } = await ddb.send(new GetCommand({
            TableName: agentPerformanceTableName,
            Key: { agentId },
        }));

        if (!Item) {
            return null;
        }

        return {
            agentId: Item.agentId,
            firstCallResolutionRate: Item.firstCallResolutionRate || 0,
            averageHandleTime: Item.averageHandleTime || 0,
            customerSatisfactionScore: Item.customerSatisfactionScore || 50,
            callsHandled: Item.callsHandled || 0,
            abandonmentRate: Item.abandonmentRate || 0,
            hourlyPerformance: Item.hourlyPerformance || {},
            preferredHours: Item.preferredHours || [],
            peakPerformanceHours: Item.peakPerformanceHours || [],
        };

    } catch (error: any) {
        console.error(`[fetchAgentPerformanceData] Error for ${agentId}:`, error.message);
        return null;
    }
}

/**
 * Enhanced agent scoring with all additional factors
 */
export async function scoreAgentEnhanced(
    ddb: DynamoDBDocumentClient,
    agent: AgentInfo,
    baseScore: number,
    callContext: CallContext,
    allAgents: AgentInfo[],
    agentPerformanceTableName: string,
    callAnalyticsTableName: string,
    config: Partial<EnhancedConfig> = {}
): Promise<EnhancedAgentScore> {
    const fullConfig = { ...DEFAULT_ENHANCED_CONFIG, ...config };
    const reasons: string[] = [];
    const currentHour = new Date().getHours();

    // Fetch performance data
    const performanceData = await fetchAgentPerformanceData(
        ddb,
        agent.agentId,
        agentPerformanceTableName
    );

    // Calculate each bonus
    const timeOfDayBonus = calculateTimeOfDayBonus(performanceData, currentHour, config);
    const performanceBonus = calculatePerformanceBonus(performanceData, config);
    const fairnessAdjustment = calculateFairnessAdjustment(agent, allAgents, config);
    const callerMatchBonus = await calculateCallerMatchBonus(
        ddb,
        agent,
        callContext,
        callAnalyticsTableName
    );

    // Build reasons
    if (timeOfDayBonus > 0) reasons.push(`tod_bonus_${timeOfDayBonus}`);
    if (performanceBonus > 0) reasons.push(`perf_bonus_${performanceBonus}`);
    if (fairnessAdjustment !== 0) reasons.push(`fairness_${fairnessAdjustment}`);
    if (callerMatchBonus > 0) reasons.push(`caller_match_${callerMatchBonus}`);

    const totalScore = baseScore + timeOfDayBonus + performanceBonus +
        fairnessAdjustment + callerMatchBonus;

    return {
        agentId: agent.agentId,
        baseScore,
        timeOfDayBonus,
        performanceBonus,
        fairnessAdjustment,
        callerMatchBonus,
        totalScore,
        reasons,
    };
}

/**
 * Ranks agents with enhanced scoring
 */
export async function rankAgentsEnhanced(
    ddb: DynamoDBDocumentClient,
    agents: AgentInfo[],
    baseScores: Map<string, number>,
    callContext: CallContext,
    agentPerformanceTableName: string,
    callAnalyticsTableName: string,
    config: Partial<EnhancedConfig> = {}
): Promise<EnhancedAgentScore[]> {
    console.log('[rankAgentsEnhanced] Scoring agents with enhanced algorithm', {
        agentCount: agents.length,
        callId: callContext.callId,
        config: {
            useTimeOfDayWeighting: config.useTimeOfDayWeighting,
            fairDistributionMode: config.fairDistributionMode,
        },
    });

    // Score all agents in parallel
    const scoringPromises = agents.map(agent =>
        scoreAgentEnhanced(
            ddb,
            agent,
            baseScores.get(agent.agentId) || 0,
            callContext,
            agents,
            agentPerformanceTableName,
            callAnalyticsTableName,
            config
        )
    );

    const scores = await Promise.all(scoringPromises);

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    // Log top 5 for observability
    console.log('[rankAgentsEnhanced] Top scored agents:',
        scores.slice(0, 5).map(s => ({
            agentId: s.agentId,
            total: s.totalScore,
            base: s.baseScore,
            bonuses: {
                tod: s.timeOfDayBonus,
                perf: s.performanceBonus,
                fair: s.fairnessAdjustment,
                match: s.callerMatchBonus,
            },
        }))
    );

    return scores;
}

/**
 * Gets fair distribution statistics for monitoring
 */
export function getFairDistributionStats(agents: AgentInfo[]): {
    minCalls: number;
    maxCalls: number;
    avgCalls: number;
    stdDev: number;
    fairnessScore: number;
} {
    const callCounts = agents.map(a => a.completedCallsToday || 0);

    if (callCounts.length === 0) {
        return { minCalls: 0, maxCalls: 0, avgCalls: 0, stdDev: 0, fairnessScore: 100 };
    }

    const minCalls = Math.min(...callCounts);
    const maxCalls = Math.max(...callCounts);
    const avgCalls = callCounts.reduce((a, b) => a + b, 0) / callCounts.length;

    // Calculate standard deviation
    const squaredDiffs = callCounts.map(c => Math.pow(c - avgCalls, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / callCounts.length;
    const stdDev = Math.sqrt(variance);

    // Fairness score: 100 = perfect distribution, lower = more uneven
    // Based on coefficient of variation (stdDev / mean)
    const cv = avgCalls > 0 ? stdDev / avgCalls : 0;
    const fairnessScore = Math.max(0, Math.round(100 - cv * 100));

    return { minCalls, maxCalls, avgCalls: Math.round(avgCalls), stdDev: Math.round(stdDev), fairnessScore };
}

/**
 * Overflow Routing Module
 * 
 * Enables intelligent cross-clinic call routing when primary clinic agents
 * are unavailable. Supports skill-based matching and configurable overflow groups.
 * 
 * Features:
 * - Tiered overflow: Primary -> Secondary -> All clinics
 * - Skill-based matching across clinics
 * - Configurable wait thresholds before overflow
 * - AI/voicemail fallback options
 * 
 * @module overflow-routing
 */

import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { AgentInfo, CallContext } from './agent-selection';
import { publishMetric, MetricName } from './cloudwatch-metrics';

export interface OverflowConfig {
    /** Enable overflow routing */
    enabled: boolean;
    /** Seconds to wait before triggering overflow */
    waitThresholdSeconds: number;
    /** Maximum clinics to include in overflow */
    maxOverflowClinics: number;
    /** Require skill match for overflow agents */
    requireSkillMatch: boolean;
    /** Fallback action if no overflow agents available */
    fallbackAction: 'queue' | 'ai' | 'voicemail';
}

export const DEFAULT_OVERFLOW_CONFIG: OverflowConfig = {
    enabled: process.env.CHIME_ENABLE_OVERFLOW === 'true',
    waitThresholdSeconds: parseInt(process.env.CHIME_OVERFLOW_WAIT_THRESHOLD || '60', 10),
    maxOverflowClinics: parseInt(process.env.CHIME_MAX_OVERFLOW_CLINICS || '5', 10),
    requireSkillMatch: process.env.CHIME_OVERFLOW_REQUIRE_SKILL_MATCH !== 'false',
    fallbackAction: (process.env.CHIME_OVERFLOW_FALLBACK || 'queue') as 'queue' | 'ai' | 'voicemail',
};

export interface OverflowGroup {
    primaryClinicId: string;
    overflowClinicIds: string[];
    priority: number;
    skillRequirements?: string[];
}

export interface OverflowResult {
    triggered: boolean;
    agents: AgentInfo[];
    sourceClinicIds: string[];
    reason: string;
    fallbackAction?: string;
}

/**
 * Checks if overflow should be triggered based on queue wait time
 */
export function shouldTriggerOverflow(
    queueWaitSeconds: number,
    primaryAgentCount: number,
    config: Partial<OverflowConfig> = {}
): boolean {
    const fullConfig = { ...DEFAULT_OVERFLOW_CONFIG, ...config };

    if (!fullConfig.enabled) {
        return false;
    }

    // Trigger if wait exceeds threshold and no primary agents available
    if (queueWaitSeconds >= fullConfig.waitThresholdSeconds && primaryAgentCount === 0) {
        return true;
    }

    // Also trigger if wait is 2x threshold even with some agents
    if (queueWaitSeconds >= fullConfig.waitThresholdSeconds * 2) {
        return true;
    }

    return false;
}

/**
 * Gets overflow clinic IDs for a primary clinic
 * Reads from DynamoDB configuration or falls back to environment variable
 */
export async function getOverflowClinics(
    ddb: DynamoDBDocumentClient,
    primaryClinicId: string,
    clinicsTableName: string
): Promise<string[]> {
    try {
        // First, try to get explicit overflow configuration from clinics table
        const { Item: clinic } = await ddb.send(new GetCommand({
            TableName: clinicsTableName,
            Key: { clinicId: primaryClinicId },
            ProjectionExpression: 'overflowClinicIds, overflowGroup',
        }));

        if (clinic?.overflowClinicIds && Array.isArray(clinic.overflowClinicIds)) {
            return clinic.overflowClinicIds;
        }

        // Fallback to environment variable (comma-separated)
        const envOverflow = process.env.CHIME_DEFAULT_OVERFLOW_CLINICS;
        if (envOverflow) {
            return envOverflow.split(',').map(s => s.trim()).filter(s => s && s !== primaryClinicId);
        }

        // Last resort: Query all clinics and use any with matching skills
        const { Items: allClinics } = await ddb.send(new QueryCommand({
            TableName: clinicsTableName,
            Limit: 20,
        }));

        if (allClinics) {
            return allClinics
                .map((c: any) => c.clinicId)
                .filter((id: string) => id !== primaryClinicId);
        }

        return [];

    } catch (error: any) {
        console.error('[getOverflowClinics] Error:', error.message);
        return [];
    }
}

/**
 * Fetches agents from overflow clinics
 */
export async function fetchOverflowAgents(
    ddb: DynamoDBDocumentClient,
    primaryClinicId: string,
    overflowClinicIds: string[],
    agentPresenceTableName: string,
    callContext: CallContext,
    config: Partial<OverflowConfig> = {}
): Promise<OverflowResult> {
    const fullConfig = { ...DEFAULT_OVERFLOW_CONFIG, ...config };

    if (!fullConfig.enabled || overflowClinicIds.length === 0) {
        return {
            triggered: false,
            agents: [],
            sourceClinicIds: [],
            reason: 'Overflow not enabled or no overflow clinics configured',
        };
    }

    console.log('[fetchOverflowAgents] Searching overflow clinics', {
        primaryClinicId,
        overflowClinicIds,
        callId: callContext.callId,
    });

    const allOverflowAgents: AgentInfo[] = [];
    const sourceClinicIds: string[] = [];

    // Query each overflow clinic for online agents
    const limitedOverflowClinics = overflowClinicIds.slice(0, fullConfig.maxOverflowClinics);

    for (const clinicId of limitedOverflowClinics) {
        try {
            const { Items: agents } = await ddb.send(new QueryCommand({
                TableName: agentPresenceTableName,
                IndexName: 'status-index',
                KeyConditionExpression: '#status = :status',
                FilterExpression: 'contains(activeClinicIds, :clinicId)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'Online',
                    ':clinicId': clinicId,
                },
                Limit: 50,
            }));

            if (agents && agents.length > 0) {
                // Filter by skill if required
                let qualifiedAgents = agents as AgentInfo[];

                if (fullConfig.requireSkillMatch && callContext.requiredSkills?.length) {
                    qualifiedAgents = agents.filter((agent: any) => {
                        const agentSkills = agent.skills || [];
                        return callContext.requiredSkills!.every(skill =>
                            agentSkills.includes(skill)
                        );
                    }) as AgentInfo[];
                }

                if (qualifiedAgents.length > 0) {
                    allOverflowAgents.push(...qualifiedAgents);
                    sourceClinicIds.push(clinicId);
                }
            }
        } catch (error: any) {
            console.error(`[fetchOverflowAgents] Error querying clinic ${clinicId}:`, error.message);
        }
    }

    // Publish metric
    if (allOverflowAgents.length > 0) {
        await publishMetric(MetricName.OVERFLOW_TRIGGERED, 1, {
            clinicId: primaryClinicId,
            overflowClinicCount: String(sourceClinicIds.length),
        });
    }

    console.log('[fetchOverflowAgents] Overflow search complete', {
        totalAgentsFound: allOverflowAgents.length,
        clinicsWithAgents: sourceClinicIds.length,
    });

    return {
        triggered: allOverflowAgents.length > 0,
        agents: allOverflowAgents,
        sourceClinicIds,
        reason: allOverflowAgents.length > 0
            ? `Found ${allOverflowAgents.length} agents from ${sourceClinicIds.length} overflow clinics`
            : 'No agents available in overflow clinics',
        fallbackAction: allOverflowAgents.length === 0 ? fullConfig.fallbackAction : undefined,
    };
}

/**
 * Complete overflow routing workflow
 * Call this when primary clinic agents are unavailable
 */
export async function attemptOverflowRouting(
    ddb: DynamoDBDocumentClient,
    callContext: CallContext,
    queueWaitSeconds: number,
    primaryAgentCount: number,
    agentPresenceTableName: string,
    clinicsTableName: string,
    config: Partial<OverflowConfig> = {}
): Promise<OverflowResult> {
    const fullConfig = { ...DEFAULT_OVERFLOW_CONFIG, ...config };

    // Check if overflow should be triggered
    if (!shouldTriggerOverflow(queueWaitSeconds, primaryAgentCount, config)) {
        return {
            triggered: false,
            agents: [],
            sourceClinicIds: [],
            reason: `Wait time ${queueWaitSeconds}s below threshold ${fullConfig.waitThresholdSeconds}s or agents available`,
        };
    }

    console.log('[attemptOverflowRouting] Triggering overflow routing', {
        callId: callContext.callId,
        clinicId: callContext.clinicId,
        queueWaitSeconds,
        primaryAgentCount,
    });

    // Get overflow clinic configuration
    const overflowClinicIds = await getOverflowClinics(
        ddb,
        callContext.clinicId,
        clinicsTableName
    );

    if (overflowClinicIds.length === 0) {
        return {
            triggered: false,
            agents: [],
            sourceClinicIds: [],
            reason: 'No overflow clinics configured for this clinic',
            fallbackAction: fullConfig.fallbackAction,
        };
    }

    // Fetch agents from overflow clinics
    return fetchOverflowAgents(
        ddb,
        callContext.clinicId,
        overflowClinicIds,
        agentPresenceTableName,
        callContext,
        config
    );
}

/**
 * Checks if an agent is in an overflow clinic for the given primary clinic
 */
export function isOverflowAgent(
    agentClinicIds: string[],
    primaryClinicId: string
): boolean {
    return agentClinicIds.some(id => id !== primaryClinicId);
}

/**
 * Gets overflow routing statistics for a clinic
 */
export async function getOverflowStats(
    ddb: DynamoDBDocumentClient,
    clinicId: string,
    callAnalyticsTableName: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    totalOverflowCalls: number;
    successfulOverflows: number;
    averageWaitBeforeOverflow: number;
}> {
    try {
        const { Items: calls } = await ddb.send(new QueryCommand({
            TableName: callAnalyticsTableName,
            IndexName: 'clinicId-timestamp-index',
            KeyConditionExpression: 'clinicId = :clinicId AND #ts BETWEEN :start AND :end',
            FilterExpression: 'attribute_exists(overflowTriggered) AND overflowTriggered = :true',
            ExpressionAttributeNames: { '#ts': 'timestamp' },
            ExpressionAttributeValues: {
                ':clinicId': clinicId,
                ':start': startTimestamp,
                ':end': endTimestamp,
                ':true': true,
            },
        }));

        if (!calls || calls.length === 0) {
            return {
                totalOverflowCalls: 0,
                successfulOverflows: 0,
                averageWaitBeforeOverflow: 0,
            };
        }

        const successful = calls.filter((c: any) => c.callStatus === 'completed');
        const totalWait = calls.reduce((sum: number, c: any) => sum + (c.waitBeforeOverflow || 0), 0);

        return {
            totalOverflowCalls: calls.length,
            successfulOverflows: successful.length,
            averageWaitBeforeOverflow: calls.length > 0 ? Math.round(totalWait / calls.length) : 0,
        };

    } catch (error: any) {
        console.error('[getOverflowStats] Error:', error.message);
        return {
            totalOverflowCalls: 0,
            successfulOverflows: 0,
            averageWaitBeforeOverflow: 0,
        };
    }
}

/**
 * Broadcast Ring Assignment Module
 * 
 * Implements "Ring All" strategy where every online agent rings simultaneously.
 * This reduces wait times when multiple agents are idle and ensures the first
 * available agent can claim the call using optimistic locking.
 * 
 * Benefits over parallel assignment:
 * - If 10 agents are idle, 10 agents ring (not just 3)
 * - Reduced queue wait times
 * - Simpler logic with race-to-accept pattern
 * 
 * @module broadcast-assignment
 */

import {
    DynamoDBDocumentClient,
    UpdateCommand,
    QueryCommand,
    BatchWriteCommand,
    GetCommand
} from '@aws-sdk/lib-dynamodb';
import { AgentInfo, CallContext } from './agent-selection';
import { publishMetric, MetricName } from './cloudwatch-metrics';

export interface BroadcastConfig {
    /** Maximum agents to ring (safety limit) */
    maxBroadcastAgents: number;
    /** Ring timeout in seconds before fallback */
    ringTimeoutSeconds: number;
    /** Whether to send push notifications */
    enablePushNotifications: boolean;
    /** Minimum agents required to broadcast (falls back to sequential if fewer) */
    minAgentsForBroadcast: number;
}

export const DEFAULT_BROADCAST_CONFIG: BroadcastConfig = {
    maxBroadcastAgents: parseInt(process.env.CHIME_MAX_BROADCAST_AGENTS || '100', 10),
    ringTimeoutSeconds: parseInt(process.env.CHIME_RING_TIMEOUT_SECONDS || '30', 10),
    enablePushNotifications: process.env.CHIME_ENABLE_PUSH_NOTIFICATIONS !== 'false',
    minAgentsForBroadcast: parseInt(process.env.CHIME_MIN_AGENTS_FOR_BROADCAST || '3', 10),
};

export interface BroadcastResult {
    success: boolean;
    strategy: 'broadcast' | 'sequential';
    ringingAgentIds: string[];
    claimedByAgentId: string | null;
    duration: number;
    metadata: {
        totalOnlineAgents: number;
        agentsNotified: number;
        failedNotifications: number;
    };
    error?: {
        code: string;
        message: string;
        retryable: boolean;
    };
}

export interface ClaimResult {
    success: boolean;
    claimedByAgentId: string | null;
    alreadyClaimed: boolean;
    error?: string;
}

/**
 * Broadcasts a call to all online agents and updates their status to 'ringing'
 * Uses batch operations for efficiency.
 */
export async function broadcastRingToAllAgents(
    ddb: DynamoDBDocumentClient,
    onlineAgents: AgentInfo[],
    callContext: CallContext,
    agentPresenceTableName: string,
    callQueueTableName: string,
    config: Partial<BroadcastConfig> = {}
): Promise<BroadcastResult> {
    const fullConfig = { ...DEFAULT_BROADCAST_CONFIG, ...config };
    const startTime = Date.now();

    // Limit to max broadcast agents
    const agentsToRing = onlineAgents.slice(0, fullConfig.maxBroadcastAgents);
    const ringingAgentIds = agentsToRing.map(a => a.agentId);

    console.log('[broadcastRingToAllAgents] Broadcasting to agents', {
        callId: callContext.callId,
        clinicId: callContext.clinicId,
        totalOnlineAgents: onlineAgents.length,
        agentsToRing: agentsToRing.length,
    });

    // Check minimum agents threshold
    if (agentsToRing.length < fullConfig.minAgentsForBroadcast) {
        console.log('[broadcastRingToAllAgents] Below minimum threshold, using sequential');
        return {
            success: false,
            strategy: 'sequential',
            ringingAgentIds: [],
            claimedByAgentId: null,
            duration: Date.now() - startTime,
            metadata: {
                totalOnlineAgents: onlineAgents.length,
                agentsNotified: 0,
                failedNotifications: 0,
            },
            error: {
                code: 'BELOW_THRESHOLD',
                message: `Only ${agentsToRing.length} agents available, minimum is ${fullConfig.minAgentsForBroadcast}`,
                retryable: false,
            },
        };
    }

    const assignmentTimestamp = new Date().toISOString();
    let successfulUpdates = 0;
    let failedUpdates = 0;

    // Update all agents to 'ringing' status using individual conditional updates
    // We use conditional updates to ensure agents are still 'Online'
    const updatePromises = agentsToRing.map(async (agent) => {
        try {
            await ddb.send(new UpdateCommand({
                TableName: agentPresenceTableName,
                Key: { agentId: agent.agentId },
                UpdateExpression: `
          SET #status = :ringing, 
              ringingCallId = :callId, 
              ringingCallTime = :time, 
              ringingCallFrom = :from, 
              ringingCallPriority = :priority, 
              ringingCallClinicId = :clinicId,
              lastActivityAt = :time,
              broadcastRingId = :broadcastId
        `,
                ConditionExpression: '#status = :online',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':ringing': 'ringing',
                    ':online': 'Online',
                    ':callId': callContext.callId,
                    ':time': assignmentTimestamp,
                    ':from': callContext.phoneNumber,
                    ':priority': callContext.priority || 'normal',
                    ':clinicId': callContext.clinicId,
                    ':broadcastId': `broadcast-${callContext.callId}`,
                },
            }));
            return { success: true, agentId: agent.agentId };
        } catch (error: any) {
            // Agent became unavailable - this is expected in race conditions
            if (error.name === 'ConditionalCheckFailedException') {
                console.log(`[broadcastRingToAllAgents] Agent ${agent.agentId} no longer online`);
                return { success: false, agentId: agent.agentId, reason: 'not_online' };
            }
            console.error(`[broadcastRingToAllAgents] Failed to update agent ${agent.agentId}:`, error.message);
            return { success: false, agentId: agent.agentId, reason: error.message };
        }
    });

    const updateResults = await Promise.all(updatePromises);

    const successfulAgentIds: string[] = [];
    for (const result of updateResults) {
        if (result.success) {
            successfulUpdates++;
            successfulAgentIds.push(result.agentId);
        } else {
            failedUpdates++;
        }
    }

    // Publish metrics
    await publishMetric(MetricName.AGENTS_RINGING, successfulUpdates, {
        clinicId: callContext.clinicId,
        strategy: 'broadcast',
    });

    const duration = Date.now() - startTime;

    if (successfulUpdates === 0) {
        console.error('[broadcastRingToAllAgents] Failed to ring any agents', {
            callId: callContext.callId,
            totalAttempted: agentsToRing.length,
        });

        return {
            success: false,
            strategy: 'broadcast',
            ringingAgentIds: [],
            claimedByAgentId: null,
            duration,
            metadata: {
                totalOnlineAgents: onlineAgents.length,
                agentsNotified: 0,
                failedNotifications: failedUpdates,
            },
            error: {
                code: 'NO_AGENTS_RINGED',
                message: 'Failed to notify any agents',
                retryable: true,
            },
        };
    }

    console.log('[broadcastRingToAllAgents] Successfully broadcast to agents', {
        callId: callContext.callId,
        successfulUpdates,
        failedUpdates,
        duration,
    });

    return {
        success: true,
        strategy: 'broadcast',
        ringingAgentIds: successfulAgentIds,
        claimedByAgentId: null, // Will be set when an agent claims
        duration,
        metadata: {
            totalOnlineAgents: onlineAgents.length,
            agentsNotified: successfulUpdates,
            failedNotifications: failedUpdates,
        },
    };
}

/**
 * Attempts to claim a broadcast call using optimistic locking.
 * Only the first agent to successfully update wins the claim.
 * 
 * Condition: callId must exist AND assignedAgentId must be null/not exist
 */
export async function claimBroadcastCall(
    ddb: DynamoDBDocumentClient,
    callId: string,
    clinicId: string,
    queuePosition: number,
    agentId: string,
    callQueueTableName: string,
    agentPresenceTableName: string
): Promise<ClaimResult> {
    const claimTimestamp = new Date().toISOString();

    try {
        // Step 1: Attempt to claim the call with optimistic lock
        await ddb.send(new UpdateCommand({
            TableName: callQueueTableName,
            Key: { clinicId, queuePosition },
            UpdateExpression: `
        SET assignedAgentId = :agentId, 
            claimedAt = :time,
            #status = :connected
      `,
            ConditionExpression: 'callId = :callId AND (attribute_not_exists(assignedAgentId) OR assignedAgentId = :null)',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':callId': callId,
                ':agentId': agentId,
                ':time': claimTimestamp,
                ':connected': 'connected',
                ':null': null,
            },
        }));

        console.log('[claimBroadcastCall] Agent successfully claimed call', {
            callId,
            agentId,
        });

        // Step 2: Update the winning agent's status
        await ddb.send(new UpdateCommand({
            TableName: agentPresenceTableName,
            Key: { agentId },
            UpdateExpression: `
        SET #status = :onCall, 
            activeCallId = :callId,
            callConnectedAt = :time,
            ringingCallId = :null,
            broadcastRingId = :null
      `,
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':onCall': 'on_call',
                ':callId': callId,
                ':time': claimTimestamp,
                ':null': null,
            },
        }));

        // Step 3: Clear ringing state from other agents (async, don't wait)
        clearOtherRingingAgents(ddb, agentPresenceTableName, callId, agentId).catch(err => {
            console.warn('[claimBroadcastCall] Failed to clear other ringing agents:', err.message);
        });

        // Publish metric
        await publishMetric(MetricName.CALL_CLAIMED, 1, {
            clinicId,
            strategy: 'broadcast',
        });

        return {
            success: true,
            claimedByAgentId: agentId,
            alreadyClaimed: false,
        };

    } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
            console.log('[claimBroadcastCall] Call already claimed by another agent', {
                callId,
                attemptedByAgentId: agentId,
            });

            // Clear this agent's ringing state since they didn't win
            await ddb.send(new UpdateCommand({
                TableName: agentPresenceTableName,
                Key: { agentId },
                UpdateExpression: `
          SET #status = :online, 
              ringingCallId = :null,
              broadcastRingId = :null
        `,
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':online': 'Online',
                    ':null': null,
                },
            })).catch(() => { }); // Ignore errors on cleanup

            return {
                success: false,
                claimedByAgentId: null,
                alreadyClaimed: true,
            };
        }

        console.error('[claimBroadcastCall] Error claiming call:', error.message);
        return {
            success: false,
            claimedByAgentId: null,
            alreadyClaimed: false,
            error: error.message,
        };
    }
}

/**
 * Clears the ringing state from all agents who were ringing for a call
 * except for the agent who claimed it.
 */
async function clearOtherRingingAgents(
    ddb: DynamoDBDocumentClient,
    agentPresenceTableName: string,
    callId: string,
    excludeAgentId: string
): Promise<void> {
    try {
        // Find all agents still ringing for this call
        const { Items: ringingAgents } = await ddb.send(new QueryCommand({
            TableName: agentPresenceTableName,
            IndexName: 'status-index',
            KeyConditionExpression: '#status = :ringing',
            FilterExpression: 'ringingCallId = :callId AND agentId <> :excludeAgent',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':ringing': 'ringing',
                ':callId': callId,
                ':excludeAgent': excludeAgentId,
            },
        }));

        if (!ringingAgents || ringingAgents.length === 0) {
            return;
        }

        console.log(`[clearOtherRingingAgents] Clearing ${ringingAgents.length} agents for call ${callId}`);

        // Update each agent back to Online
        const clearPromises = ringingAgents.map(agent =>
            ddb.send(new UpdateCommand({
                TableName: agentPresenceTableName,
                Key: { agentId: agent.agentId },
                UpdateExpression: `
          SET #status = :online, 
              ringingCallId = :null,
              broadcastRingId = :null,
              lastActivityAt = :time
        `,
                ConditionExpression: 'ringingCallId = :callId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':online': 'Online',
                    ':callId': callId,
                    ':null': null,
                    ':time': new Date().toISOString(),
                },
            })).catch(() => { }) // Ignore individual failures
        );

        await Promise.all(clearPromises);

    } catch (error: any) {
        console.error('[clearOtherRingingAgents] Error:', error.message);
    }
}

/**
 * Handles ring timeout - clears all ringing agents and marks call as abandoned/queued
 */
export async function handleBroadcastTimeout(
    ddb: DynamoDBDocumentClient,
    callId: string,
    clinicId: string,
    queuePosition: number,
    callQueueTableName: string,
    agentPresenceTableName: string,
    fallbackAction: 'queue' | 'voicemail' | 'ai' = 'queue'
): Promise<{ success: boolean; action: string }> {
    console.log('[handleBroadcastTimeout] Handling ring timeout', {
        callId,
        clinicId,
        fallbackAction,
    });

    try {
        // Update call status based on fallback action
        const newStatus = fallbackAction === 'queue' ? 'queued' :
            fallbackAction === 'voicemail' ? 'voicemail' :
                'ai_handling';

        await ddb.send(new UpdateCommand({
            TableName: callQueueTableName,
            Key: { clinicId, queuePosition },
            UpdateExpression: `
        SET #status = :status, 
            lastTimeoutAt = :time,
            timeoutCount = if_not_exists(timeoutCount, :zero) + :one
      `,
            ConditionExpression: 'callId = :callId AND #status = :ringing',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': newStatus,
                ':ringing': 'ringing',
                ':callId': callId,
                ':time': new Date().toISOString(),
                ':zero': 0,
                ':one': 1,
            },
        }));

        // Clear all agents ringing for this call
        await clearOtherRingingAgents(ddb, agentPresenceTableName, callId, '');

        // Publish metric
        await publishMetric(MetricName.CALL_TIMEOUT, 1, {
            clinicId,
            action: fallbackAction,
        });

        return { success: true, action: fallbackAction };

    } catch (error: any) {
        console.error('[handleBroadcastTimeout] Error:', error.message);
        return { success: false, action: 'error' };
    }
}

/**
 * Gets the current ring strategy from configuration
 */
export function getRingStrategy(): 'broadcast' | 'parallel' | 'sequential' {
    return (process.env.CHIME_RING_STRATEGY || 'parallel') as 'broadcast' | 'parallel' | 'sequential';
}

/**
 * Checks if broadcast ring is enabled
 */
export function isBroadcastEnabled(): boolean {
    return getRingStrategy() === 'broadcast';
}

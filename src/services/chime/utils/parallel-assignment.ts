/**
 * Parallel Agent Assignment Module
 * Implements optimistic parallel assignment to reduce latency
 */

import { DynamoDBDocumentClient, TransactWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AgentInfo, CallContext } from './agent-selection';
import { DistributedLock } from './distributed-lock';

interface AssignmentResult {
    success: boolean;
    agentId: string | null;
    attemptedAgents: string[];
    duration: number;
    error?: {
        code: string;
        message: string;
        retryable: boolean;
    };
}

interface BaseQueueItem {
    clinicId: string;
    callId: string;
    queuePosition: number;
    queueEntryTime: number;
    queueEntryTimeIso: string;
    phoneNumber: string;
    status: string;
    direction: string;
    ttl: number;
    priority?: string;
    isVip?: boolean;
    requiredSkills?: string[];
    preferredSkills?: string[];
    language?: string;
}

interface ParallelAssignmentConfig {
    parallelCount: number; // How many agents to try simultaneously
    retryOnThrottle: boolean;
    maxRetries: number;
    backoffMs: number;
}

const DEFAULT_CONFIG: ParallelAssignmentConfig = {
    parallelCount: 3,
    retryOnThrottle: true,
    maxRetries: 2,
    backoffMs: 100
};

/**
 * Custom error class for assignment failures
 */
export class CallAssignmentError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly retryable: boolean,
        public readonly metadata?: any
    ) {
        super(message);
        this.name = 'CallAssignmentError';
    }
}

/**
 * Attempts to assign a call to a single agent using atomic transaction
 */
async function attemptSingleAssignment(
    ddb: DynamoDBDocumentClient,
    agentId: string,
    callContext: CallContext,
    baseQueueItem: BaseQueueItem,
    agentPresenceTableName: string,
    callQueueTableName: string,
    locksTableName: string,
    assignmentTimestamp: string
): Promise<{ success: boolean; error?: CallAssignmentError }> {

    // CRITICAL FIX: Reduced lock TTL to minimize orphaned lock impact
    // FIX: Use consistent lock key format (dash not colon) to match join-queued-call.ts and call-accepted.ts
    const lock = new DistributedLock(ddb, {
        tableName: locksTableName,
        lockKey: `call-assignment-${callContext.callId}`,
        ttlSeconds: 3 // Reduced from 10s to 3s
    });

    const result = await lock.withLock(async () => {
        // Check if call is already assigned
        const { Items: existingCalls } = await ddb.send(new QueryCommand({
            TableName: callQueueTableName,
            KeyConditionExpression: 'clinicId = :clinicId AND queuePosition = :pos',
            ExpressionAttributeValues: {
                ':clinicId': baseQueueItem.clinicId,
                ':pos': baseQueueItem.queuePosition
            }
        }));

        if (existingCalls && existingCalls.length > 0) {
            return {
                success: false,
                error: new CallAssignmentError(
                    'Call already assigned',
                    'CALL_ALREADY_ASSIGNED',
                    false,
                    { callId: callContext.callId }
                )
            };
        }

        // Original transaction logic
        try {
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Put: {
                            TableName: callQueueTableName,
                            Item: {
                                ...baseQueueItem,
                                agentIds: [agentId],
                                assignedAgentId: agentId,
                                priority: callContext.priority,
                                isVip: callContext.isVip,
                                requiredSkills: callContext.requiredSkills,
                                preferredSkills: callContext.preferredSkills,
                                language: callContext.language,
                                isCallback: callContext.isCallback
                            },
                            ConditionExpression: 'attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)'
                        }
                    },
                    {
                        Update: {
                            TableName: agentPresenceTableName,
                            Key: { agentId },
                            UpdateExpression: 'SET #status = :ringing, ringingCallId = :callId, ringingCallTime = :time, ringingCallFrom = :from, ringingCallPriority = :priority, ringingCallClinicId = :clinicId, lastActivityAt = :time',
                            ConditionExpression: '#status = :online',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':ringing': 'ringing',
                                ':callId': callContext.callId,
                                ':time': assignmentTimestamp,
                                ':from': callContext.phoneNumber,
                                ':priority': callContext.priority || 'normal',
                                ':clinicId': callContext.clinicId,
                                ':online': 'Online'
                            }
                        }
                    }
                ]
            }));

            return { success: true };

        } catch (err: any) {
            // Transaction cancelled - agent taken or call already assigned
            if (err.name === 'TransactionCanceledException') {
                return {
                    success: false,
                    error: new CallAssignmentError(
                        `Agent ${agentId} became unavailable during assignment`,
                        'AGENT_UNAVAILABLE',
                        false,
                        { agentId, callId: callContext.callId }
                    )
                };
            }

            // Throttling error - may be retryable
            if (err.name === 'ProvisionedThroughputExceededException') {
                return {
                    success: false,
                    error: new CallAssignmentError(
                        'DynamoDB throttled',
                        'THROTTLED',
                        true,
                        { agentId, callId: callContext.callId }
                    )
                };
            }

            // Other errors
            return {
                success: false,
                error: new CallAssignmentError(
                    `Assignment failed: ${err.message}`,
                    'UNKNOWN_ERROR',
                    false,
                    { agentId, callId: callContext.callId, errorName: err.name }
                )
            };
        }
    });

    if (result === null) {
        return {
            success: false,
            error: new CallAssignmentError(
                'Failed to acquire lock',
                'LOCK_TIMEOUT',
                true,
                { callId: callContext.callId }
            )
        };
    }

    return result;
}

/**
 * Attempts to assign call to multiple agents in parallel
 * Returns as soon as first assignment succeeds
 */
export async function tryParallelAssignment(
    ddb: DynamoDBDocumentClient,
    selectedAgents: AgentInfo[],
    callContext: CallContext,
    baseQueueItem: BaseQueueItem,
    agentPresenceTableName: string,
    callQueueTableName: string,
    locksTableName: string,
    config: Partial<ParallelAssignmentConfig> = {}
): Promise<AssignmentResult> {

    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    const assignmentTimestamp = new Date().toISOString();

    // Take top N agents for parallel attempt
    const agentsToTry = selectedAgents.slice(0, fullConfig.parallelCount);
    const attemptedAgents: string[] = agentsToTry.map(a => a.agentId);

    console.log(`[tryParallelAssignment] Attempting parallel assignment to ${agentsToTry.length} agents for call ${callContext.callId}`);

    // Create promises for parallel execution
    const assignmentPromises = agentsToTry.map(agent =>
        attemptSingleAssignment(
            ddb,
            agent.agentId,
            callContext,
            baseQueueItem,
            agentPresenceTableName,
            callQueueTableName,
            locksTableName,
            assignmentTimestamp
        )
    );

    // Wait for all to complete or first to succeed
    const results = await Promise.allSettled(assignmentPromises);

    // Find first successful assignment
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled' && result.value.success) {
            const duration = Date.now() - startTime;
            const successfulAgent = agentsToTry[i].agentId;

            console.log(`[tryParallelAssignment] Successfully assigned call ${callContext.callId} to agent ${successfulAgent} in ${duration}ms`);

            return {
                success: true,
                agentId: successfulAgent,
                attemptedAgents,
                duration
            };
        }
    }

    // All attempts failed - collect errors
    const errors: CallAssignmentError[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled' && result.value.error) {
            errors.push(result.value.error);
        }
    }

    const duration = Date.now() - startTime;
    const hasThrottleError = errors.some(e => e.code === 'THROTTLED');

    console.warn(`[tryParallelAssignment] All ${agentsToTry.length} parallel attempts failed for call ${callContext.callId}`, {
        errors: errors.map(e => ({ code: e.code, message: e.message })),
        duration
    });

    return {
        success: false,
        agentId: null,
        attemptedAgents,
        duration,
        error: {
            code: hasThrottleError ? 'THROTTLED' : 'ALL_AGENTS_UNAVAILABLE',
            message: `Failed to assign call after ${agentsToTry.length} parallel attempts`,
            retryable: hasThrottleError
        }
    };
}

/**
 * Sequential assignment with retry logic (fallback for when parallel fails)
 */
export async function trySequentialAssignment(
    ddb: DynamoDBDocumentClient,
    selectedAgents: AgentInfo[],
    callContext: CallContext,
    baseQueueItem: BaseQueueItem,
    agentPresenceTableName: string,
    callQueueTableName: string,
    locksTableName: string,
    config: Partial<ParallelAssignmentConfig> = {}
): Promise<AssignmentResult> {

    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    const attemptedAgents: string[] = [];
    const assignmentTimestamp = new Date().toISOString();

    console.log(`[trySequentialAssignment] Attempting sequential assignment for ${selectedAgents.length} agents`);

    for (const agent of selectedAgents) {
        attemptedAgents.push(agent.agentId);
        let retryCount = 0;

        while (retryCount <= fullConfig.maxRetries) {
            const result = await attemptSingleAssignment(
                ddb,
                agent.agentId,
                callContext,
                baseQueueItem,
                agentPresenceTableName,
                callQueueTableName,
                locksTableName,
                assignmentTimestamp
            );

            if (result.success) {
                const duration = Date.now() - startTime;
                console.log(`[trySequentialAssignment] Successfully assigned to ${agent.agentId} after ${retryCount} retries in ${duration}ms`);

                return {
                    success: true,
                    agentId: agent.agentId,
                    attemptedAgents,
                    duration
                };
            }

            // Handle error
            const error = result.error!;

            // If agent unavailable, move to next agent
            if (error.code === 'AGENT_UNAVAILABLE') {
                console.log(`[trySequentialAssignment] Agent ${agent.agentId} unavailable, trying next`);
                break; // Try next agent
            }

            // If throttled and retry enabled, wait and retry
            if (error.code === 'THROTTLED' && fullConfig.retryOnThrottle && retryCount < fullConfig.maxRetries) {
                const backoff = fullConfig.backoffMs * Math.pow(2, retryCount);
                console.log(`[trySequentialAssignment] Throttled, retrying after ${backoff}ms`);
                await new Promise(resolve => setTimeout(resolve, backoff));
                retryCount++;
                continue;
            }

            // Other errors or max retries - move to next agent
            console.warn(`[trySequentialAssignment] Failed to assign to ${agent.agentId}: ${error.message}`);
            break;
        }
    }

    // All agents tried, all failed
    const duration = Date.now() - startTime;
    console.error(`[trySequentialAssignment] Failed to assign call ${callContext.callId} after trying ${attemptedAgents.length} agents`);

    return {
        success: false,
        agentId: null,
        attemptedAgents,
        duration,
        error: {
            code: 'ALL_AGENTS_UNAVAILABLE',
            message: `Failed to assign call after trying ${attemptedAgents.length} agents`,
            retryable: false
        }
    };
}

/**
 * Smart assignment strategy - tries parallel first, falls back to sequential
 */
export async function smartAssignCall(
    ddb: DynamoDBDocumentClient,
    selectedAgents: AgentInfo[],
    callContext: CallContext,
    baseQueueItem: BaseQueueItem,
    agentPresenceTableName: string,
    callQueueTableName: string,
    locksTableName: string,
    useParallel: boolean = true,
    config: Partial<ParallelAssignmentConfig> = {}
): Promise<AssignmentResult> {

    if (selectedAgents.length === 0) {
        return {
            success: false,
            agentId: null,
            attemptedAgents: [],
            duration: 0,
            error: {
                code: 'NO_AGENTS_AVAILABLE',
                message: 'No agents available for assignment',
                retryable: true
            }
        };
    }

    // If only 1-2 agents, use sequential (parallel has no benefit)
    if (selectedAgents.length <= 2 || !useParallel) {
        return trySequentialAssignment(
            ddb,
            selectedAgents,
            callContext,
            baseQueueItem,
            agentPresenceTableName,
            callQueueTableName,
            locksTableName,
            config
        );
    }

    // Try parallel assignment first
    const parallelResult = await tryParallelAssignment(
        ddb,
        selectedAgents,
        callContext,
        baseQueueItem,
        agentPresenceTableName,
        callQueueTableName,
        locksTableName,
        config
    );

    if (parallelResult.success) {
        return parallelResult;
    }

    // If parallel failed due to throttling, don't retry with sequential
    if (parallelResult.error?.code === 'THROTTLED') {
        console.warn('[smartAssignCall] Parallel assignment throttled, not retrying with sequential');
        return parallelResult;
    }

    // If parallel failed because all agents unavailable and we have more agents, try remaining ones sequentially
    const remainingAgents = selectedAgents.slice(config.parallelCount || DEFAULT_CONFIG.parallelCount);
    if (remainingAgents.length > 0) {
        console.log(`[smartAssignCall] Parallel failed, trying ${remainingAgents.length} remaining agents sequentially`);

        const sequentialResult = await trySequentialAssignment(
            ddb,
            remainingAgents,
            callContext,
            baseQueueItem,
            agentPresenceTableName,
            callQueueTableName,
            locksTableName,
            config
        );

        // Combine attempted agents from both strategies
        return {
            ...sequentialResult,
            attemptedAgents: [
                ...parallelResult.attemptedAgents,
                ...sequentialResult.attemptedAgents
            ]
        };
    }

    return parallelResult;
}

/**
 * FIX #4: Helper to build base queue item from call context
 * Uses unique queue position generation to prevent collisions
 */
export function buildBaseQueueItem(
    clinicId: string,
    callId: string,
    phoneNumber: string,
    queueTimeoutSeconds: number = 86400
): BaseQueueItem {
    const now = Date.now();
    const queueEntryTime = Math.floor(now / 1000);
    
    // FIX #4: Use unique position generation
    const { generateUniqueQueuePosition } = require('../../shared/utils/unique-id');
    const queuePosition = generateUniqueQueuePosition();

    return {
        clinicId,
        callId,
        queuePosition,
        queueEntryTime,
        queueEntryTimeIso: new Date(now).toISOString(),
        phoneNumber,
        status: 'ringing',
        direction: 'inbound',
        ttl: queueEntryTime + queueTimeoutSeconds
    };
}

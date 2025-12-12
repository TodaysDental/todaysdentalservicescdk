/**
 * Analytics Reconciliation Job
 * 
 * Fixes orphaned calls where deduplication records exist but analytics don't.
 * Should be run periodically (hourly or daily) to catch processing failures.
 * 
 * Process:
 * 1. Scan CallQueue for completed/abandoned calls from last 24 hours
 * 2. Check if analytics record exists
 * 3. If not, directly create the analytics record (stream trigger is unreliable)
 * 
 * CRITICAL FIX: Changed from stream-based reprocessing to direct analytics creation.
 * The stream processor only triggers on status field changes, not arbitrary field updates.
 */

import { DynamoDBDocumentClient, ScanCommand, GetCommand, DeleteCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getDedupTableName } from '../shared/utils/analytics-deduplication';

const ddb = getDynamoDBClient();

const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME;
const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
// CRITICAL FIX: Use direct environment variable if provided, otherwise derive from analytics table
const DEDUP_TABLE_ENV = process.env.ANALYTICS_DEDUP_TABLE_NAME;

// CRITICAL FIX #4.3: Agent performance tracking requires these tables
const AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;
const AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME;
const TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME;

if (!CALL_QUEUE_TABLE || !ANALYTICS_TABLE) {
    throw new Error('Required environment variables not set: CALL_QUEUE_TABLE_NAME, CALL_ANALYTICS_TABLE_NAME');
}

// Use direct env var if available, otherwise use derived name
const DEDUP_TABLE = DEDUP_TABLE_ENV || getDedupTableName(ANALYTICS_TABLE);

// CRITICAL FIX #4.3: Warn if agent performance tracking will be skipped
if (!AGENT_PERFORMANCE_TABLE) {
    console.warn('[Reconciliation] AGENT_PERFORMANCE_TABLE_NAME not configured - agent metrics will NOT be tracked for reconciled calls');
}

interface ReconciliationResult {
    scanned: number;
    missing: number;
    fixed: number;
    errors: number;
    orphanedCalls: string[];
}

/**
 * Main handler for reconciliation job
 */
export const handler = async (): Promise<ReconciliationResult> => {
    console.log('[Reconciliation] Starting analytics reconciliation job');
    
    const result: ReconciliationResult = {
        scanned: 0,
        missing: 0,
        fixed: 0,
        errors: 0,
        orphanedCalls: []
    };

    // Get calls from last 24 hours that are completed or abandoned
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    
    let lastEvaluatedKey: any = undefined;
    let pageCount = 0;
    const MAX_PAGES = 100; // Safety limit

    do {
        try {
            const scanResult = await ddb.send(new ScanCommand({
                TableName: CALL_QUEUE_TABLE,
                FilterExpression: '(#status = :completed OR #status = :abandoned) AND endedAt > :oneDayAgo',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':completed': 'completed',
                    ':abandoned': 'abandoned',
                    ':oneDayAgo': oneDayAgo
                },
                ExclusiveStartKey: lastEvaluatedKey,
                Limit: 100
            }));

            const calls = scanResult.Items || [];
            result.scanned += calls.length;

            // Check each call for analytics
            for (const call of calls) {
                if (!call.callId) continue;

                const hasMissingAnalytics = await checkAndFixOrphanedCall(call, result);
                
                if (hasMissingAnalytics) {
                    result.orphanedCalls.push(call.callId);
                }
            }

            lastEvaluatedKey = scanResult.LastEvaluatedKey;
            pageCount++;

            if (pageCount >= MAX_PAGES) {
                console.warn('[Reconciliation] Hit max pages limit, stopping scan');
                break;
            }

        } catch (err: any) {
            console.error('[Reconciliation] Error during scan:', {
                error: err.message,
                page: pageCount
            });
            result.errors++;
            break;
        }

    } while (lastEvaluatedKey);

    console.log('[Reconciliation] Job complete:', {
        ...result,
        orphanedCallsCount: result.orphanedCalls.length
    });

    return result;
};

/**
 * Check if a call has analytics, and fix if missing by directly creating analytics record
 * 
 * CRITICAL FIX: Changed from stream-based reprocessing to direct analytics creation.
 * The previous approach of updating `reconciledAt` field did not trigger stream reprocessing
 * because the stream processor only responds to status field changes (completed/abandoned).
 */
async function checkAndFixOrphanedCall(
    call: any,
    result: ReconciliationResult
): Promise<boolean> {
    try {
        // CRITICAL FIX #12 & #4.1: Normalize timestamp to consistent format (epoch seconds)
        // queueEntryTime can be in seconds or milliseconds - detect and normalize
        let timestamp = call.queueEntryTime || Math.floor(Date.now() / 1000);
        
        // CRITICAL FIX #4.1: Improved timestamp detection with better bounds
        // Year 2001 in seconds: 978307200
        // Year 2100 in seconds: 4102444800
        // Reasonable oldest timestamp: Year 2015 (when call centers went digital)
        const YEAR_2015_SECONDS = 1420070400;
        const YEAR_2100_SECONDS = 4102444800;
        
        if (timestamp > YEAR_2100_SECONDS) {
            // Definitely milliseconds, convert to seconds
            timestamp = Math.floor(timestamp / 1000);
            console.log('[Reconciliation] Converted timestamp from ms to seconds:', {
                callId: call.callId,
                original: call.queueEntryTime,
                normalized: timestamp
            });
        } else if (timestamp < YEAR_2015_SECONDS && timestamp > 0) {
            // CRITICAL FIX #4.1: Old timestamp - could be legacy/migrated data
            // Keep it but log a warning instead of overwriting with current time
            console.warn('[Reconciliation] Old timestamp detected (pre-2015), keeping original:', {
                callId: call.callId,
                originalTimestamp: timestamp,
                date: new Date(timestamp * 1000).toISOString(),
                note: 'May be migrated data. Review if this causes issues.'
            });
            // Only override if timestamp is clearly invalid (negative or zero)
        } else if (timestamp <= 0) {
            console.error('[Reconciliation] Invalid timestamp (<=0), using current time:', {
                callId: call.callId,
                originalTimestamp: timestamp
            });
            timestamp = Math.floor(Date.now() / 1000);
        }
        
        const analyticsResult = await ddb.send(new GetCommand({
            TableName: ANALYTICS_TABLE,
            Key: {
                callId: call.callId,
                timestamp: timestamp
            }
        }));

        if (analyticsResult.Item) {
            // Analytics exist - all good
            return false;
        }

        // Analytics missing - this is an orphaned call
        console.log('[Reconciliation] Found orphaned call:', {
            callId: call.callId,
            status: call.status,
            endedAt: call.endedAtIso
        });
        
        result.missing++;

        // Delete dedup records to ensure clean state
        const stateTransition = call.status === 'completed' ? 'completed' : 'abandoned';
        const dedupKeys = [
            `${call.callId}#post-call-${stateTransition}`,
            `${call.callId}#post-call`
        ];

        for (const dedupKey of dedupKeys) {
            try {
                await ddb.send(new DeleteCommand({
                    TableName: DEDUP_TABLE,
                    Key: { eventId: dedupKey }
                }));
                console.log('[Reconciliation] Deleted dedup record:', dedupKey);
            } catch (deleteErr: any) {
                // Record might not exist - that's OK
                if (deleteErr.name !== 'ResourceNotFoundException') {
                    console.warn('[Reconciliation] Error deleting dedup record:', {
                        dedupKey,
                        error: deleteErr.message
                    });
                }
            }
        }

        // CRITICAL FIX: Directly create the analytics record instead of relying on stream trigger
        // The stream processor only responds to status changes, not arbitrary field updates
        try {
            const now = Date.now();
            const queueEntryTime = parseTimestamp(call.queueEntryTime || call.queueEntryTimeIso);
            const connectedAt = parseTimestamp(call.connectedAt);
            const completedAt = parseTimestamp(call.completedAt || call.endedAtIso);
            
            const totalDuration = queueEntryTime && completedAt
                ? Math.floor((completedAt - queueEntryTime) / 1000)
                : 0;
            const queueDuration = queueEntryTime && connectedAt
                ? Math.floor((connectedAt - queueEntryTime) / 1000)
                : 0;
            const callDuration = connectedAt && completedAt
                ? Math.floor((completedAt - connectedAt) / 1000)
                : 0;
            const holdDuration = call.holdDuration || 0;
            const talkDuration = Math.max(0, callDuration - holdDuration);

            const analyticsRecord = {
                callId: call.callId,
                timestamp: timestamp,
                timestampIso: call.queueEntryTimeIso || new Date(timestamp * 1000).toISOString(),
                clinicId: call.clinicId,
                agentId: call.assignedAgentId,
                status: call.status,
                callStatus: call.status,
                
                // Durations
                totalDuration,
                queueDuration,
                ringDuration: call.ringDuration || 0,
                holdDuration,
                talkDuration,
                
                // Characteristics
                wasTransferred: !!call.transferredToAgentId || !!call.transferToAgentId,
                wasAbandoned: call.status === 'abandoned',
                wasCallback: !!call.isCallback,
                wasVip: !!call.isVip,
                
                // Metadata
                rejectionCount: call.rejectionCount || 0,
                transferCount: call.transferCount || 0,
                holdCount: call.holdCount || 0,
                
                // Source
                phoneNumber: call.phoneNumber,
                direction: call.direction || 'inbound',
                
                // Processing metadata
                processedAt: new Date().toISOString(),
                sourceEvent: 'RECONCILIATION_JOB',
                reconciledAt: new Date().toISOString(),
                ttl: Math.floor(now / 1000) + (90 * 24 * 60 * 60), // 90 days
                
                // Analytics state
                analyticsState: 'FINALIZED',
                finalized: true,
                _note: 'Created by reconciliation job - original stream processing failed'
            };

            await ddb.send(new PutCommand({
                TableName: ANALYTICS_TABLE,
                Item: analyticsRecord,
                ConditionExpression: 'attribute_not_exists(callId)'
            }));

            console.log('[Reconciliation] Created analytics record for call:', call.callId);
            result.fixed++;

            // CRITICAL FIX #4.3: Track agent metrics for reconciled calls
            if (AGENT_PERFORMANCE_TABLE && call.assignedAgentId) {
                try {
                    const { trackEnhancedCallMetrics } = await import('../shared/utils/enhanced-agent-metrics');
                    
                    await trackEnhancedCallMetrics(ddb, AGENT_PERFORMANCE_TABLE, {
                        agentId: call.assignedAgentId,
                        clinicId: call.clinicId,
                        callId: call.callId,
                        direction: call.direction || 'inbound',
                        duration: totalDuration,
                        talkTime: talkDuration,
                        holdTime: holdDuration,
                        sentiment: 'NEUTRAL', // Default for reconciled calls without live analytics
                        sentimentScore: 50,
                        transferred: !!call.transferredToAgentId || !!call.transferToAgentId,
                        escalated: false,
                        issues: [],
                        speakerMetrics: undefined,
                        timestamp: completedAt || Date.now()
                    });
                    
                    console.log('[Reconciliation] Tracked agent metrics for reconciled call:', {
                        callId: call.callId,
                        agentId: call.assignedAgentId
                    });
                } catch (metricsErr: any) {
                    console.error('[Reconciliation] Failed to track agent metrics:', {
                        callId: call.callId,
                        agentId: call.assignedAgentId,
                        error: metricsErr.message
                    });
                    // Non-fatal - continue with reconciliation
                }
            }

            // CRITICAL FIX #4.2 & #11: Mark the original CallQueue record as reconciled
            // Use a more robust approach: query the item first to determine schema
            try {
                // First, try with clinicId + callId (most common schema)
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE,
                    Key: {
                        clinicId: call.clinicId,
                        callId: call.callId
                    },
                    UpdateExpression: 'SET reconciledAt = :now, reconciledBy = :source',
                    ExpressionAttributeValues: {
                        ':now': new Date().toISOString(),
                        ':source': 'reconciliation-job'
                    },
                    // CRITICAL FIX #4.2: Add condition to verify item exists
                    ConditionExpression: 'attribute_exists(callId)'
                }));
                console.log('[Reconciliation] Marked call as reconciled:', call.callId);
            } catch (updateErr: any) {
                // CRITICAL FIX #4.2: Handle case where table schema might be different
                if (updateErr.name === 'ConditionalCheckFailedException') {
                    // Item doesn't exist with this key - try alternative schema
                    console.warn('[Reconciliation] Call not found with clinicId+callId, trying callId-only:', {
                        callId: call.callId
                    });
                } else if (updateErr.name === 'ValidationException' && updateErr.message.includes('key')) {
                    console.warn('[Reconciliation] clinicId+callId key failed, trying callId-only key:', {
                        callId: call.callId,
                        error: updateErr.message
                    });
                } else {
                    console.warn('[Reconciliation] Failed to mark call as reconciled:', {
                        callId: call.callId,
                        error: updateErr.message
                    });
                    // Don't try fallback for unexpected errors
                    return true;
                }
                
                // Try with callId only as partition key (alternative schema)
                try {
                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE,
                        Key: {
                            callId: call.callId
                        },
                        UpdateExpression: 'SET reconciledAt = :now, reconciledBy = :source',
                        ExpressionAttributeValues: {
                            ':now': new Date().toISOString(),
                            ':source': 'reconciliation-job'
                        }
                    }));
                    console.log('[Reconciliation] Marked call as reconciled (callId-only schema):', call.callId);
                } catch (fallbackErr: any) {
                    console.error('[Reconciliation] CRITICAL: Failed to mark call as reconciled with both schemas:', {
                        callId: call.callId,
                        primaryError: updateErr.message,
                        fallbackError: fallbackErr.message,
                        impact: 'Call may be reconciled again on next run'
                    });
                }
            }

        } catch (createErr: any) {
            if (createErr.name === 'ConditionalCheckFailedException') {
                console.log('[Reconciliation] Analytics already exist (race condition):', call.callId);
                // Not an error - another process created the record
            } else {
                console.error('[Reconciliation] Failed to create analytics record:', {
                    callId: call.callId,
                    error: createErr.message
                });
                result.errors++;
            }
        }

        return true;

    } catch (err: any) {
        console.error('[Reconciliation] Error checking call:', {
            callId: call.callId,
            error: err.message
        });
        result.errors++;
        return false;
    }
}

/**
 * Parse timestamp from various formats
 */
function parseTimestamp(value: any): number | null {
    if (!value) return null;
    
    if (typeof value === 'number') {
        // Detect if milliseconds or seconds based on magnitude
        const YEAR_2010_SECONDS = 1262304000;
        return value > YEAR_2010_SECONDS * 1000 ? value : value * 1000;
    }
    
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return isNaN(parsed) ? null : parsed;
    }
    
    return null;
}

/**
 * Manual reconciliation for a specific call (for debugging)
 */
export async function reconcileSpecificCall(callId: string): Promise<boolean> {
    console.log('[Reconciliation] Manually reconciling call:', callId);

    // Delete all possible dedup records
    const dedupKeys = [
        `${callId}#post-call-completed`,
        `${callId}#post-call-abandoned`,
        `${callId}#post-call`,
        `${callId}#live-init`,
        `${callId}#live-update`
    ];

    for (const dedupKey of dedupKeys) {
        try {
            await ddb.send(new DeleteCommand({
                TableName: DEDUP_TABLE,
                Key: { eventId: dedupKey }
            }));
            console.log('[Reconciliation] Deleted dedup record:', dedupKey);
        } catch (err: any) {
            if (err.name !== 'ResourceNotFoundException') {
                console.warn('[Reconciliation] Error deleting dedup:', err.message);
            }
        }
    }

    console.log('[Reconciliation] Dedup records cleared for call:', callId);
    return true;
}






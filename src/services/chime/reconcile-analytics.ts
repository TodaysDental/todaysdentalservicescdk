/**
 * Analytics Reconciliation Job
 * 
 * Fixes orphaned calls where deduplication records exist but analytics don't.
 * Should be run periodically (hourly or daily) to catch processing failures.
 * 
 * Process:
 * 1. Scan CallQueue for completed/abandoned calls from last 24 hours
 * 2. Check if analytics record exists
 * 3. If not, delete dedup records and trigger reprocessing
 */

import { DynamoDBDocumentClient, ScanCommand, GetCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getDedupTableName } from '../shared/utils/analytics-deduplication';

const ddb = getDynamoDBClient();

const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME;
const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;

if (!CALL_QUEUE_TABLE || !ANALYTICS_TABLE) {
    throw new Error('Required environment variables not set');
}

const DEDUP_TABLE = getDedupTableName(ANALYTICS_TABLE);

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
 * Check if a call has analytics, and fix if missing
 */
async function checkAndFixOrphanedCall(
    call: any,
    result: ReconciliationResult
): Promise<boolean> {
    try {
        // Check if analytics exist
        const timestamp = call.queueEntryTime || Math.floor(Date.now() / 1000);
        
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

        // Delete dedup records to allow reprocessing
        const stateTransition = call.status === 'completed' ? 'completed' : 'abandoned';
        const dedupKeys = [
            `${call.callId}#post-call-${stateTransition}`,
            `${call.callId}#post-call`
        ];

        let deleted = false;
        for (const dedupKey of dedupKeys) {
            try {
                await ddb.send(new DeleteCommand({
                    TableName: DEDUP_TABLE,
                    Key: { eventId: dedupKey }
                }));
                
                console.log('[Reconciliation] Deleted dedup record:', dedupKey);
                deleted = true;
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

        if (deleted) {
            // Trigger reprocessing by updating the CallQueue record
            // This will generate a DynamoDB Stream event
            try {
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE,
                    Key: {
                        clinicId: call.clinicId,
                        queuePosition: call.queuePosition
                    },
                    UpdateExpression: 'SET reconciledAt = :now',
                    ExpressionAttributeValues: {
                        ':now': new Date().toISOString()
                    }
                }));

                console.log('[Reconciliation] Triggered reprocessing for call:', call.callId);
                result.fixed++;
            } catch (updateErr: any) {
                console.error('[Reconciliation] Failed to trigger reprocessing:', {
                    callId: call.callId,
                    error: updateErr.message
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



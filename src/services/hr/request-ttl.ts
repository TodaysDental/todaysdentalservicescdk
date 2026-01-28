/**
 * Request TTL Service
 * 
 * Provides automatic cleanup of stale requests including:
 * - Expired advance pay requests
 * - Expired leave requests
 * - Expired shift swap requests
 * - Audit log archival
 * 
 * @module request-ttl
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    QueryCommand,
    UpdateCommand,
    BatchWriteCommand
} from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB client
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const ADVANCE_PAY_TABLE = process.env.ADVANCE_PAY_TABLE || 'HrAdvancePay';
const LEAVE_TABLE = process.env.LEAVE_TABLE || 'HrLeave';
const SHIFT_SWAP_TABLE = process.env.SHIFT_SWAP_TABLE || 'HrShiftSwap';
const AUDIT_TABLE = process.env.AUDIT_TABLE || 'HrAuditLog';
const AUDIT_ARCHIVE_TABLE = process.env.AUDIT_ARCHIVE_TABLE || 'HrAuditLogArchive';

// TTL Configuration (in days)
const TTL_CONFIG = {
    ADVANCE_PAY_PENDING: parseInt(process.env.TTL_ADVANCE_PAY_PENDING || '30', 10),
    LEAVE_PENDING: parseInt(process.env.TTL_LEAVE_PENDING || '60', 10),
    SHIFT_SWAP_PENDING: parseInt(process.env.TTL_SHIFT_SWAP || '7', 10),
    AUDIT_LOG_RETENTION: parseInt(process.env.TTL_AUDIT_RETENTION || '365', 10),
};

export interface CleanupResult {
    table: string;
    processed: number;
    expired: number;
    archived: number;
    errors: string[];
}

/**
 * Calculate expiration date based on days
 */
function getExpirationDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
}

/**
 * Expire stale advance pay requests
 */
export async function expireAdvancePayRequests(): Promise<CleanupResult> {
    const result: CleanupResult = {
        table: ADVANCE_PAY_TABLE,
        processed: 0,
        expired: 0,
        archived: 0,
        errors: [],
    };

    const expirationDate = getExpirationDate(TTL_CONFIG.ADVANCE_PAY_PENDING);

    try {
        // Query pending requests older than TTL
        const { Items } = await ddb.send(new QueryCommand({
            TableName: ADVANCE_PAY_TABLE,
            IndexName: 'byStatus',
            KeyConditionExpression: '#status = :status',
            FilterExpression: 'createdAt < :expDate',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'pending',
                ':expDate': expirationDate,
            },
        }));

        result.processed = Items?.length || 0;

        // Expire each request
        for (const item of Items || []) {
            try {
                await ddb.send(new UpdateCommand({
                    TableName: ADVANCE_PAY_TABLE,
                    Key: {
                        pk: item.pk,
                        sk: item.sk,
                    },
                    UpdateExpression: 'SET #status = :expired, expiredAt = :now, expiredReason = :reason',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':expired': 'expired',
                        ':now': new Date().toISOString(),
                        ':reason': 'Automatic expiration - exceeded pending time limit',
                    },
                }));
                result.expired++;
            } catch (err) {
                result.errors.push(`Failed to expire ${item.advanceId}: ${err}`);
            }
        }
    } catch (err) {
        result.errors.push(`Query failed: ${err}`);
    }

    console.log(`[TTL] Advance Pay: Processed ${result.processed}, Expired ${result.expired}`);
    return result;
}

/**
 * Expire stale leave requests
 */
export async function expireLeaveRequests(): Promise<CleanupResult> {
    const result: CleanupResult = {
        table: LEAVE_TABLE,
        processed: 0,
        expired: 0,
        archived: 0,
        errors: [],
    };

    const expirationDate = getExpirationDate(TTL_CONFIG.LEAVE_PENDING);

    try {
        // Query pending requests older than TTL
        const { Items } = await ddb.send(new QueryCommand({
            TableName: LEAVE_TABLE,
            IndexName: 'byStatus',
            KeyConditionExpression: '#status = :status',
            FilterExpression: 'createdAt < :expDate',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'pending',
                ':expDate': expirationDate,
            },
        }));

        result.processed = Items?.length || 0;

        for (const item of Items || []) {
            try {
                await ddb.send(new UpdateCommand({
                    TableName: LEAVE_TABLE,
                    Key: {
                        pk: item.pk,
                        sk: item.sk,
                    },
                    UpdateExpression: 'SET #status = :expired, expiredAt = :now',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':expired': 'expired',
                        ':now': new Date().toISOString(),
                    },
                }));
                result.expired++;
            } catch (err) {
                result.errors.push(`Failed to expire ${item.leaveId}: ${err}`);
            }
        }
    } catch (err) {
        result.errors.push(`Query failed: ${err}`);
    }

    console.log(`[TTL] Leave: Processed ${result.processed}, Expired ${result.expired}`);
    return result;
}

/**
 * Expire stale shift swap requests
 */
export async function expireShiftSwapRequests(): Promise<CleanupResult> {
    const result: CleanupResult = {
        table: SHIFT_SWAP_TABLE,
        processed: 0,
        expired: 0,
        archived: 0,
        errors: [],
    };

    const expirationDate = getExpirationDate(TTL_CONFIG.SHIFT_SWAP_PENDING);

    try {
        // Query pending requests older than TTL
        const { Items } = await ddb.send(new QueryCommand({
            TableName: SHIFT_SWAP_TABLE,
            IndexName: 'byStatus',
            KeyConditionExpression: '#status = :status',
            FilterExpression: 'createdAt < :expDate',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'PENDING_PEER',
                ':expDate': expirationDate,
            },
        }));

        // Also query PENDING_MANAGER
        const { Items: managerPending } = await ddb.send(new QueryCommand({
            TableName: SHIFT_SWAP_TABLE,
            IndexName: 'byStatus',
            KeyConditionExpression: '#status = :status',
            FilterExpression: 'createdAt < :expDate',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'PENDING_MANAGER',
                ':expDate': expirationDate,
            },
        }));

        const allItems = [...(Items || []), ...(managerPending || [])];
        result.processed = allItems.length;

        for (const item of allItems) {
            try {
                await ddb.send(new UpdateCommand({
                    TableName: SHIFT_SWAP_TABLE,
                    Key: {
                        pk: item.pk,
                        sk: item.sk,
                    },
                    UpdateExpression: 'SET #status = :expired, expiredAt = :now',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':expired': 'EXPIRED',
                        ':now': new Date().toISOString(),
                    },
                }));
                result.expired++;
            } catch (err) {
                result.errors.push(`Failed to expire ${item.swapId}: ${err}`);
            }
        }
    } catch (err) {
        result.errors.push(`Query failed: ${err}`);
    }

    console.log(`[TTL] Shift Swap: Processed ${result.processed}, Expired ${result.expired}`);
    return result;
}

/**
 * Archive old audit logs
 */
export async function archiveAuditLogs(): Promise<CleanupResult> {
    const result: CleanupResult = {
        table: AUDIT_TABLE,
        processed: 0,
        expired: 0,
        archived: 0,
        errors: [],
    };

    const archiveDate = getExpirationDate(TTL_CONFIG.AUDIT_LOG_RETENTION);

    try {
        // Query old audit logs (simplified - in production, use pagination)
        const { Items } = await ddb.send(new QueryCommand({
            TableName: AUDIT_TABLE,
            IndexName: 'byTimestamp',
            KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk < :archiveDate',
            ExpressionAttributeValues: {
                ':pk': 'AUDIT',
                ':archiveDate': archiveDate,
            },
            Limit: 100, // Process in batches
        }));

        result.processed = Items?.length || 0;

        if (Items && Items.length > 0) {
            // Move to archive table in batches of 25
            const batches = [];
            for (let i = 0; i < Items.length; i += 25) {
                batches.push(Items.slice(i, i + 25));
            }

            for (const batch of batches) {
                try {
                    // Write to archive
                    await ddb.send(new BatchWriteCommand({
                        RequestItems: {
                            [AUDIT_ARCHIVE_TABLE]: batch.map(item => ({
                                PutRequest: {
                                    Item: {
                                        ...item,
                                        archivedAt: new Date().toISOString(),
                                    },
                                },
                            })),
                        },
                    }));

                    // Delete from main table
                    await ddb.send(new BatchWriteCommand({
                        RequestItems: {
                            [AUDIT_TABLE]: batch.map(item => ({
                                DeleteRequest: {
                                    Key: {
                                        pk: item.pk,
                                        sk: item.sk,
                                    },
                                },
                            })),
                        },
                    }));

                    result.archived += batch.length;
                } catch (err) {
                    result.errors.push(`Batch archive failed: ${err}`);
                }
            }
        }
    } catch (err) {
        result.errors.push(`Query failed: ${err}`);
    }

    console.log(`[TTL] Audit Logs: Processed ${result.processed}, Archived ${result.archived}`);
    return result;
}

/**
 * Run all TTL cleanup tasks
 * This should be called by a scheduled Lambda (e.g., daily)
 */
export async function runAllCleanupTasks(): Promise<{
    success: boolean;
    results: CleanupResult[];
    totalProcessed: number;
    totalExpired: number;
    totalArchived: number;
    totalErrors: number;
}> {
    console.log('[TTL] Starting cleanup tasks...');

    const results = await Promise.all([
        expireAdvancePayRequests(),
        expireLeaveRequests(),
        expireShiftSwapRequests(),
        archiveAuditLogs(),
    ]);

    const summary = {
        success: results.every(r => r.errors.length === 0),
        results,
        totalProcessed: results.reduce((sum, r) => sum + r.processed, 0),
        totalExpired: results.reduce((sum, r) => sum + r.expired, 0),
        totalArchived: results.reduce((sum, r) => sum + r.archived, 0),
        totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
    };

    console.log('[TTL] Cleanup complete:', {
        success: summary.success,
        totalProcessed: summary.totalProcessed,
        totalExpired: summary.totalExpired,
        totalArchived: summary.totalArchived,
        totalErrors: summary.totalErrors,
    });

    return summary;
}

/**
 * Lambda handler for scheduled cleanup
 */
export async function handler(): Promise<void> {
    try {
        const result = await runAllCleanupTasks();

        if (!result.success) {
            console.error('[TTL] Cleanup completed with errors:',
                result.results.flatMap(r => r.errors)
            );
        }
    } catch (err) {
        console.error('[TTL] Cleanup failed:', err);
        throw err;
    }
}

export default {
    expireAdvancePayRequests,
    expireLeaveRequests,
    expireShiftSwapRequests,
    archiveAuditLogs,
    runAllCleanupTasks,
    handler,
};

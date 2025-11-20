/**
 * Analytics Stream Processor
 * Fix 16 & 17: Process call analytics from DynamoDB Streams with deduplication
 * 
 * Uses DynamoDB Streams instead of Kinesis for guaranteed, ordered processing
 * Implements idempotency to prevent duplicate analytics events
 * 
 * Handles:
 * - Call completion analytics
 * - Call abandonment analytics
 * - Deduplication using conditional writes
 * - Graceful handling of deleted call records
 */

import { DynamoDBStreamEvent, DynamoDBRecord, AttributeValue } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';

const ddb = getDynamoDBClient();
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME || process.env.ANALYTICS_TABLE;
const DEDUP_TABLE = process.env.ANALYTICS_DEDUP_TABLE || `${ANALYTICS_TABLE}-dedup`;

interface CallAnalytics {
    callId: string;
    timestamp: number; // epoch seconds
    timestampIso: string;
    clinicId: string;
    agentId?: string;
    status: string;
    
    // Duration metrics (in seconds)
    totalDuration: number;
    queueDuration: number;
    ringDuration: number;
    holdDuration: number;
    talkDuration: number;
    
    // Call characteristics
    wasTransferred: boolean;
    wasAbandoned: boolean;
    wasCallback: boolean;
    wasVip: boolean;
    
    // Metadata
    rejectionCount: number;
    transferCount: number;
    holdCount: number;
    
    // Source info
    phoneNumber?: string;
    direction: 'inbound' | 'outbound';
    
    // Processing info
    processedAt: string;
    sourceEvent: string;
    ttl: number; // 90 days retention
}

/**
 * Main handler for DynamoDB Stream events
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
    console.log('[AnalyticsStream] Processing batch', {
        recordCount: event.Records.length,
        timestamp: new Date().toISOString()
    });

    const results = {
        processed: 0,
        skipped: 0,
        duplicates: 0,
        errors: 0
    };

    for (const record of event.Records) {
        try {
            const processed = await processStreamRecord(record);
            if (processed === 'PROCESSED') {
                results.processed++;
            } else if (processed === 'SKIPPED') {
                results.skipped++;
            } else if (processed === 'DUPLICATE') {
                results.duplicates++;
            }
        } catch (err: any) {
            console.error('[AnalyticsStream] Error processing record:', {
                error: err.message,
                eventID: record.eventID
            });
            results.errors++;
            // Don't throw - let other records process
        }
    }

    console.log('[AnalyticsStream] Batch complete:', results);
};

/**
 * Process a single DynamoDB Stream record
 */
async function processStreamRecord(
    record: DynamoDBRecord
): Promise<'PROCESSED' | 'SKIPPED' | 'DUPLICATE'> {
    // Only process MODIFY and REMOVE events
    if (record.eventName !== 'MODIFY' && record.eventName !== 'REMOVE') {
        return 'SKIPPED';
    }

    const newImage = record.dynamodb?.NewImage 
        ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>)
        : null;
    const oldImage = record.dynamodb?.OldImage
        ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>)
        : null;

    // Determine if this is a call completion event
    const wasCompleted = 
        oldImage?.status !== 'completed' && 
        newImage?.status === 'completed';

    const wasAbandoned = 
        oldImage?.status !== 'abandoned' && 
        newImage?.status === 'abandoned';

    const wasRemoved = record.eventName === 'REMOVE' && oldImage;

    // Only process completion/abandonment events
    if (!wasCompleted && !wasAbandoned && !wasRemoved) {
        return 'SKIPPED';
    }

    // Get call data (prefer new image, fall back to old for REMOVE events)
    const callData = newImage || oldImage;

    if (!callData?.callId) {
        console.warn('[AnalyticsStream] Record missing callId, skipping');
        return 'SKIPPED';
    }

    console.log('[AnalyticsStream] Processing call:', {
        callId: callData.callId,
        status: callData.status,
        eventName: record.eventName,
        wasCompleted,
        wasAbandoned,
        wasRemoved
    });

    // Generate analytics
    const analytics = await generateCallAnalytics(callData, record);

    // Store with deduplication
    const stored = await storeAnalyticsWithDedup(analytics, record.eventID!);

    return stored ? 'PROCESSED' : 'DUPLICATE';
}

/**
 * Generate analytics from call data
 */
async function generateCallAnalytics(
    callData: any, 
    record: DynamoDBRecord
): Promise<CallAnalytics> {
    const now = Date.now();
    const queueEntryTime = parseTimestamp(callData.queueEntryTime || callData.queueEntryTimeIso);
    const connectedAt = parseTimestamp(callData.connectedAt);
    const completedAt = parseTimestamp(callData.completedAt || callData.endedAtIso);
    const ringingStartedAt = parseTimestamp(callData.ringingStartedAt || callData.assignedAt);

    // Calculate durations
    const totalDuration = connectedAt && completedAt
        ? Math.floor((completedAt - connectedAt) / 1000)
        : 0;

    const queueDuration = queueEntryTime && connectedAt
        ? Math.floor((connectedAt - queueEntryTime) / 1000)
        : 0;

    const ringDuration = ringingStartedAt && connectedAt
        ? Math.floor((connectedAt - ringingStartedAt) / 1000)
        : callData.ringDuration || 0;

    const holdDuration = callData.holdDuration || 0;

    // Talk duration = total - hold time
    const talkDuration = Math.max(0, totalDuration - holdDuration);

    // Create analytics record
    const analytics: CallAnalytics = {
        callId: callData.callId,
        timestamp: Math.floor((queueEntryTime || now) / 1000),
        timestampIso: callData.queueEntryTimeIso || new Date().toISOString(),
        clinicId: callData.clinicId,
        agentId: callData.assignedAgentId,
        status: callData.status,

        // Durations
        totalDuration,
        queueDuration,
        ringDuration,
        holdDuration,
        talkDuration,

        // Characteristics
        wasTransferred: !!callData.transferredToAgentId || !!callData.transferToAgentId,
        wasAbandoned: callData.status === 'abandoned',
        wasCallback: !!callData.isCallback,
        wasVip: !!callData.isVip,

        // Metadata
        rejectionCount: callData.rejectionCount || 0,
        transferCount: callData.transferCount || 0,
        holdCount: callData.holdCount || 0,

        // Source
        phoneNumber: callData.phoneNumber,
        direction: callData.direction || 'inbound',

        // Processing metadata
        processedAt: new Date().toISOString(),
        sourceEvent: record.eventName!,
        ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days
    };

    return analytics;
}

/**
 * Store analytics with deduplication
 * Uses conditional write to prevent duplicate processing
 */
async function storeAnalyticsWithDedup(
    analytics: CallAnalytics,
    eventId: string
): Promise<boolean> {
    // First, check deduplication
    const dedupId = `${analytics.callId}-${analytics.timestamp}`;

    try {
        // Atomic deduplication check
        await ddb.send(new PutCommand({
            TableName: DEDUP_TABLE,
            Item: {
                eventId: dedupId,
                callId: analytics.callId,
                processedAt: new Date().toISOString(),
                streamEventId: eventId,
                ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
            },
            ConditionExpression: 'attribute_not_exists(eventId)'
        }));

        // If we get here, this is the first time seeing this event
        // Now store the actual analytics
        await ddb.send(new PutCommand({
            TableName: ANALYTICS_TABLE,
            Item: analytics
        }));

        console.log('[AnalyticsStream] Stored analytics for call:', analytics.callId);
        return true;

    } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
            console.log('[AnalyticsStream] Duplicate event detected:', dedupId);
            return false;
        }
        throw err;
    }
}

/**
 * Parse timestamp from various formats
 */
function parseTimestamp(value: any): number | null {
    if (!value) return null;

    // Already a number (epoch ms)
    if (typeof value === 'number') {
        return value > 1e12 ? value : value * 1000;
    }

    // ISO string
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return isNaN(parsed) ? null : parsed;
    }

    return null;
}

/**
 * Helper to calculate average for aggregations
 */
export function calculateAverages(records: CallAnalytics[]): {
    avgQueueTime: number;
    avgTalkTime: number;
    avgHoldTime: number;
    abandonRate: number;
    transferRate: number;
} {
    if (records.length === 0) {
        return {
            avgQueueTime: 0,
            avgTalkTime: 0,
            avgHoldTime: 0,
            abandonRate: 0,
            transferRate: 0
        };
    }

    const totals = records.reduce((acc, record) => ({
        queueTime: acc.queueTime + record.queueDuration,
        talkTime: acc.talkTime + record.talkDuration,
        holdTime: acc.holdTime + record.holdDuration,
        abandoned: acc.abandoned + (record.wasAbandoned ? 1 : 0),
        transferred: acc.transferred + (record.wasTransferred ? 1 : 0)
    }), {
        queueTime: 0,
        talkTime: 0,
        holdTime: 0,
        abandoned: 0,
        transferred: 0
    });

    return {
        avgQueueTime: Math.round(totals.queueTime / records.length),
        avgTalkTime: Math.round(totals.talkTime / records.length),
        avgHoldTime: Math.round(totals.holdTime / records.length),
        abandonRate: (totals.abandoned / records.length) * 100,
        transferRate: (totals.transferred / records.length) * 100
    };
}


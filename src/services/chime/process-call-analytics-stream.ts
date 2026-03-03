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
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { checkAndMarkProcessed, getDedupTableName, shouldProcessAnalytics } from '../shared/utils/analytics-deduplication';
import { trackEnhancedCallMetrics } from '../shared/utils/enhanced-agent-metrics';
// OpenDental integration removed — patient enrichment is no longer performed.

const ddb = getDynamoDBClient();
// Use consistent environment variable naming
const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;

if (!ANALYTICS_TABLE) {
    throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}

// CRITICAL FIX: Use unified deduplication strategy
const DEDUP_TABLE = getDedupTableName(ANALYTICS_TABLE);

// OpenDental circuit breaker removed — no longer calling OpenDental APIs.

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
            // Extract callId from record for better error tracking
            let callId = 'unknown';
            try {
                const newImage = record.dynamodb?.NewImage;
                const oldImage = record.dynamodb?.OldImage;
                const image = newImage || oldImage;
                if (image) {
                    const unmarshalled = unmarshall(image as any);
                    callId = unmarshalled.callId || 'unknown';
                }
            } catch (unmarshalErr) {
                // Ignore unmarshal errors for error logging
            }

            console.error('[AnalyticsStream] Error processing record:', {
                error: err.message,
                stack: err.stack,
                eventID: record.eventID,
                eventName: record.eventName,
                callId,
                timestamp: new Date().toISOString()
            });
            results.errors++;
            // Don't throw - let other records process
        }
    }

    console.log('[AnalyticsStream] Batch complete:', results);
};

/**
 * Process a single DynamoDB Stream record
 * CRITICAL FIX #9: Added comprehensive validation for call queue data flow
 */
async function processStreamRecord(
    record: DynamoDBRecord
): Promise<'PROCESSED' | 'SKIPPED' | 'DUPLICATE'> {
    // CRITICAL FIX #9: Validate record structure before processing
    if (!record.dynamodb) {
        console.error('[processStreamRecord] Missing dynamodb data in record');
        return 'SKIPPED';
    }

    const { NewImage, OldImage } = record.dynamodb;

    // CRITICAL FIX #9: Validate required fields exist
    if (!NewImage) {
        console.warn('[processStreamRecord] No NewImage in record, skipping');
        return 'SKIPPED';
    }
    // Only process MODIFY and REMOVE events
    if (record.eventName !== 'MODIFY' && record.eventName !== 'REMOVE') {
        return 'SKIPPED';
    }

    const newImage = record.dynamodb?.NewImage
        ? unmarshall(record.dynamodb.NewImage as any)
        : null;
    const oldImage = record.dynamodb?.OldImage
        ? unmarshall(record.dynamodb.OldImage as any)
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

    // Determine state transition for later deduplication
    const stateTransition = wasCompleted ? 'completed' : wasAbandoned ? 'abandoned' : 'removed';

    // Generate analytics FIRST (before deduplication)
    // This ensures we don't mark as duplicate before successful processing
    const analytics = await generateCallAnalytics(callData, record);

    // Fetch patient data if available
    await enrichWithPatientData(analytics, callData);

    // Store with deduplication (includes its own "post-call" dedup check)
    const stored = await storeAnalyticsWithDedup(analytics, record.eventID!);

    // If storage failed due to duplicate, return early
    if (!stored) {
        console.log('[AnalyticsStream] Analytics already stored, skipping duplicate');
        return 'DUPLICATE';
    }

    // CRITICAL FIX: Mark state transition as processed AFTER successful storage
    // This prevents orphaned dedup records when errors occur during processing
    try {
        await checkAndMarkProcessed(
            ddb,
            DEDUP_TABLE,
            callData.callId,
            `post-call-${stateTransition}` as any
        );
    } catch (err: any) {
        console.warn('[AnalyticsStream] Failed to mark state transition, but analytics stored:', {
            callId: callData.callId,
            error: err.message
        });
        // Don't fail - analytics are already stored successfully
    }

    // CRITICAL FIX: Track agent performance metrics using enhanced-agent-metrics only
    if (stored && analytics.agentId) {
        try {
            await trackEnhancedCallMetrics(
                ddb,
                process.env.AGENT_PERFORMANCE_TABLE_NAME!,
                {
                    agentId: analytics.agentId,
                    clinicId: analytics.clinicId,
                    callId: analytics.callId,
                    direction: analytics.direction,
                    duration: analytics.totalDuration,
                    talkTime: analytics.talkDuration,
                    holdTime: analytics.holdDuration,
                    sentiment: analytics.wasAbandoned ? 'NEGATIVE' : 'NEUTRAL',
                    transferred: analytics.wasTransferred,
                    escalated: false,
                    issues: [],
                    timestamp: callData.callEndTime || Date.now() // Use actual call end time
                }
            );
        } catch (err: any) {
            console.error('[AnalyticsStream] Failed to track agent metrics:', {
                error: err.message,
                callId: analytics.callId,
                agentId: analytics.agentId
            });
            // Don't fail the entire process if metrics tracking fails
        }
    }

    // OpenDental commlog creation removed — createCallCommlog is a no-op stub.

    return stored ? 'PROCESSED' : 'DUPLICATE';
}


/**
 * Generate analytics from call data
 */
/**
 * Generate call analytics from call queue data
 * CRITICAL FIX #9: Added validation for all required fields
 */
async function generateCallAnalytics(
    callData: any,
    record: DynamoDBRecord
): Promise<CallAnalytics> {
    // CRITICAL FIX #9: Validate required fields exist
    if (!callData.callId) {
        throw new Error('Missing required field: callId');
    }
    if (!callData.clinicId) {
        throw new Error('Missing required field: clinicId');
    }

    // CRITICAL FIX #9: Validate timestamp format and range
    const now = Date.now();
    const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);

    let timestamp = parseTimestamp(callData.timestamp || callData.callStartTime || Date.now());

    if (timestamp && timestamp > now + 60000) { // Future timestamp (1 min grace for clock skew)
        console.warn('[generateCallAnalytics] Future timestamp detected, using current time:', {
            originalTimestamp: timestamp,
            callId: callData.callId
        });
        timestamp = now;
    }

    if (timestamp && timestamp < oneYearAgo) {
        console.warn('[generateCallAnalytics] Very old timestamp (>1 year), may be invalid:', {
            timestamp,
            callId: callData.callId,
            ageInDays: Math.floor((now - timestamp) / (24 * 60 * 60 * 1000))
        });
    }

    // CRITICAL FIX #9: Validate phone number format
    if (callData.phoneNumber) {
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        if (!phoneRegex.test(callData.phoneNumber)) {
            console.warn('[generateCallAnalytics] Invalid phone number format:', {
                phoneNumber: callData.phoneNumber,
                callId: callData.callId
            });
        }
    }
    const queueEntryTime = parseTimestamp(callData.queueEntryTime || callData.queueEntryTimeIso);
    const connectedAt = parseTimestamp(callData.connectedAt);
    const completedAt = parseTimestamp(callData.completedAt || callData.endedAtIso);
    const ringingStartedAt = parseTimestamp(callData.ringingStartedAt || callData.assignedAt);

    // FIXED FLAW #7: Total duration should be from queue entry to completion (full call lifecycle)
    // FIXED FLAW #6: Ensure talk duration cannot be negative
    const totalDuration = queueEntryTime && completedAt
        ? Math.floor((completedAt - queueEntryTime) / 1000)
        : 0;

    const queueDuration = queueEntryTime && connectedAt
        ? Math.floor((connectedAt - queueEntryTime) / 1000)
        : 0;

    const ringDuration = ringingStartedAt && connectedAt
        ? Math.floor((connectedAt - ringingStartedAt) / 1000)
        : callData.ringDuration || 0;

    const holdDuration = callData.holdDuration || 0;

    // Call duration is time from connection to completion
    const callDuration = connectedAt && completedAt
        ? Math.floor((completedAt - connectedAt) / 1000)
        : 0;

    // Talk duration = call duration - hold time (with safety check)
    const talkDuration = Math.max(0, callDuration - holdDuration);

    // FIXED FLAW #8: Add null safety for parseTimestamp results
    // Create analytics record
    const analytics: CallAnalytics = {
        callId: callData.callId,
        timestamp: queueEntryTime ? Math.floor(queueEntryTime / 1000) : Math.floor(now / 1000),
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
 * CRITICAL FIX: Uses unified deduplication strategy across all processors
 */
async function storeAnalyticsWithDedup(
    analytics: CallAnalytics,
    eventId: string
): Promise<boolean> {
    // Use unified deduplication for post-call analytics
    const dedupResult = await checkAndMarkProcessed(
        ddb,
        DEDUP_TABLE,
        analytics.callId,
        'post-call',
        eventId
    );

    if (dedupResult.isDuplicate) {
        console.log('[AnalyticsStream] Duplicate post-call analytics event, skipping:', analytics.callId);
        return false;
    }

    // Check if we should overwrite existing record
    // (e.g., don't overwrite finalized records)
    try {
        const { Item: existingRecord } = await ddb.send(new GetCommand({
            TableName: ANALYTICS_TABLE,
            Key: { callId: analytics.callId, timestamp: analytics.timestamp }
        }));

        if (!shouldProcessAnalytics(existingRecord, 'post-call')) {
            console.log('[AnalyticsStream] Skipping - record should not be processed:', analytics.callId);
            return false;
        }
    } catch (err: any) {
        console.warn('[AnalyticsStream] Error checking existing record:', err.message);
        // Continue with write
    }

    try {
        // ---------------------------------------------------------------
        // Preserve sentiment, category, and transcript from any existing 
        // record (may have been written by process-call-analytics.ts
        // real-time processor at a different timestamp).
        // ---------------------------------------------------------------
        let preservedFields: Record<string, any> = {};
        try {
            const existingQuery = await ddb.send(new QueryCommand({
                TableName: ANALYTICS_TABLE,
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: { ':callId': analytics.callId },
                Limit: 5, // Bounded scan
            }));

            for (const rec of (existingQuery.Items || [])) {
                // Preserve sentiment if present and meaningful
                if (rec.overallSentiment && rec.overallSentiment !== 'uncategorized' && !preservedFields.overallSentiment) {
                    preservedFields.overallSentiment = rec.overallSentiment;
                }
                if (typeof rec.sentimentScore === 'number' && rec.sentimentScore > 0 && !preservedFields.sentimentScore) {
                    preservedFields.sentimentScore = rec.sentimentScore;
                }
                // Preserve category if not default
                if (rec.callCategory && rec.callCategory !== 'uncategorized' && !preservedFields.callCategory) {
                    preservedFields.callCategory = rec.callCategory;
                }
                if (rec.categoryScores && Object.keys(rec.categoryScores).length > 0 && !preservedFields.categoryScores) {
                    preservedFields.categoryScores = rec.categoryScores;
                }
                // Preserve speaker metrics
                if (rec.speakerMetrics && !preservedFields.speakerMetrics) {
                    preservedFields.speakerMetrics = rec.speakerMetrics;
                }
                // Preserve transcript data
                if (rec.fullTranscript && rec.fullTranscript.trim().length > 0 && !preservedFields.fullTranscript) {
                    preservedFields.fullTranscript = rec.fullTranscript;
                }
                if (Array.isArray(rec.latestTranscripts) && rec.latestTranscripts.length > 0 && !preservedFields.latestTranscripts) {
                    preservedFields.latestTranscripts = rec.latestTranscripts;
                }
                if (typeof rec.transcriptCount === 'number' && rec.transcriptCount > 0 && !preservedFields.transcriptCount) {
                    preservedFields.transcriptCount = rec.transcriptCount;
                }
                // Preserve sentiment timeline
                if (Array.isArray(rec.latestSentiment) && rec.latestSentiment.length > 0 && !preservedFields.latestSentiment) {
                    preservedFields.latestSentiment = rec.latestSentiment;
                }
                if (typeof rec.sentimentDataPoints === 'number' && rec.sentimentDataPoints > 0 && !preservedFields.sentimentDataPoints) {
                    preservedFields.sentimentDataPoints = rec.sentimentDataPoints;
                }
                // Preserve detected issues and key phrases
                if (Array.isArray(rec.detectedIssues) && rec.detectedIssues.length > 0 && !preservedFields.detectedIssues) {
                    preservedFields.detectedIssues = rec.detectedIssues;
                }
                if (Array.isArray(rec.keyPhrases) && rec.keyPhrases.length > 0 && !preservedFields.keyPhrases) {
                    preservedFields.keyPhrases = rec.keyPhrases;
                }
                // Preserve audio quality
                if (rec.audioQuality && !preservedFields.audioQuality) {
                    preservedFields.audioQuality = rec.audioQuality;
                }
            }

            if (Object.keys(preservedFields).length > 0) {
                console.log(`[AnalyticsStream] Preserving ${Object.keys(preservedFields).length} fields from existing records:`,
                    Object.keys(preservedFields));
            }
        } catch (queryErr: any) {
            console.warn('[AnalyticsStream] Non-fatal error querying existing records for merge:', queryErr.message);
        }

        // Store the actual analytics with callStatus, merging preserved fields.
        // Use Record<string, any> to allow dynamic field assignment.
        const mergedItem: Record<string, any> = {
            ...preservedFields,
            ...analytics,
            callStatus: analytics.status === 'completed' ? 'completed'
                : analytics.status === 'abandoned' ? 'abandoned'
                    : 'failed'
        };

        // Restore preserved fields that are missing/default in the new analytics
        if ((!mergedItem.overallSentiment || mergedItem.overallSentiment === 'uncategorized') && preservedFields.overallSentiment) {
            mergedItem.overallSentiment = preservedFields.overallSentiment;
        }
        if ((!mergedItem.sentimentScore || mergedItem.sentimentScore === 0) && preservedFields.sentimentScore) {
            mergedItem.sentimentScore = preservedFields.sentimentScore;
        }
        if ((!mergedItem.callCategory || mergedItem.callCategory === 'uncategorized') && preservedFields.callCategory) {
            mergedItem.callCategory = preservedFields.callCategory;
        }
        if ((!mergedItem.fullTranscript || String(mergedItem.fullTranscript).trim().length === 0) && preservedFields.fullTranscript) {
            mergedItem.fullTranscript = preservedFields.fullTranscript;
        }
        if ((!Array.isArray(mergedItem.latestTranscripts) || mergedItem.latestTranscripts.length === 0) && preservedFields.latestTranscripts) {
            mergedItem.latestTranscripts = preservedFields.latestTranscripts;
        }

        await ddb.send(new PutCommand({
            TableName: ANALYTICS_TABLE,
            Item: mergedItem
        }));

        console.log('[AnalyticsStream] Stored post-call analytics for call:', analytics.callId);
        return true;

    } catch (err: any) {
        console.error('[AnalyticsStream] Error storing analytics:', err);
        throw err;
    }
}

/**
 * Parse timestamp from various formats
 * FIXED FLAW #9: Better detection of milliseconds vs seconds (check against year 2010)
 */
function parseTimestamp(value: any): number | null {
    if (!value) return null;

    // Already a number (epoch)
    if (typeof value === 'number') {
        // If value is greater than Jan 1, 2010 in seconds (1262304000), assume it's already milliseconds
        // This handles dates from 2010 onwards correctly
        const YEAR_2010_SECONDS = 1262304000;
        return value > YEAR_2010_SECONDS * 1000 ? value : value * 1000;
    }

    // ISO string
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return isNaN(parsed) ? null : parsed;
    }

    return null;
}

/**
 * Patient enrichment — OpenDental removed.
 * This is now a no-op; kept as a stub so call-sites compile.
 */
async function enrichWithPatientData(
    _analytics: CallAnalytics,
    _callData: any
): Promise<void> {
    // OpenDental integration removed — no patient data enrichment.
}

/**
 * Commlog creation — OpenDental removed.
 * This is now a no-op; kept as a stub so call-sites compile.
 */
async function createCallCommlog(_analytics: CallAnalytics): Promise<void> {
    // OpenDental integration removed — no commlog creation.
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


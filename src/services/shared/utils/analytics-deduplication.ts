/**
 * CRITICAL FIX: Unified Deduplication for Analytics Processing
 * 
 * Ensures both Kinesis (live analytics) and DynamoDB Streams (post-call analytics)
 * use the same deduplication strategy to prevent duplicate records.
 * 
 * Strategy:
 * - Use callId + processingStage as dedup key
 * - Processing stages: 'live-init', 'live-update', 'post-call'
 * - TTL of 7 days on dedup records
 */

import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

export type ProcessingStage = 'live-init' | 'live-update' | 'post-call' | 'call-end-finalization' | 'post-call-completed' | 'post-call-abandoned';

// CRITICAL FIX #7.1: TTL should match or exceed Kinesis retention period
// Default Kinesis retention is 24 hours, but can be extended to 365 days
// Use 14 days by default to handle replay scenarios safely
const DEDUP_TTL_DAYS = parseInt(process.env.DEDUP_TTL_DAYS || '14', 10);

// Validate TTL is reasonable
if (DEDUP_TTL_DAYS < 1 || DEDUP_TTL_DAYS > 365) {
  console.warn('[Deduplication] DEDUP_TTL_DAYS outside recommended range (1-365):', {
    configured: DEDUP_TTL_DAYS,
    recommendation: 'Use 7-14 for standard retention, up to 365 for extended retention'
  });
}

export interface DedupCheckResult {
  isDuplicate: boolean;
  existingRecord?: any;
  dedupKey: string;
}

/**
 * Check if an analytics event is a duplicate and atomically mark as processed
 * 
 * @param ddb - DynamoDB Document Client
 * @param dedupTableName - Name of deduplication table
 * @param callId - Call identifier
 * @param stage - Processing stage
 * @param eventId - Unique event identifier (optional)
 * @returns DedupCheckResult indicating if this is a duplicate
 */
export async function checkAndMarkProcessed(
  ddb: DynamoDBDocumentClient,
  dedupTableName: string,
  callId: string,
  stage: ProcessingStage,
  eventId?: string
): Promise<DedupCheckResult> {
  // Generate consistent dedup key across processors
  const dedupKey = generateDedupKey(callId, stage);
  
  try {
    // CRITICAL FIX: Use `eventId` as partition key (matches table schema in analytics-stack.ts)
    // The dedupKey becomes the value of eventId to ensure uniqueness per call+stage
    // Atomic conditional write - only succeeds if key doesn't exist
    
    // CRITICAL FIX #7.1: Use configurable TTL that matches Kinesis retention
    const ttlSeconds = DEDUP_TTL_DAYS * 24 * 60 * 60;
    
    await ddb.send(new PutCommand({
      TableName: dedupTableName,
      Item: {
        eventId: dedupKey, // FIXED: Use dedupKey as the partition key value
        callId,
        stage,
        originalEventId: eventId || 'unknown', // Keep original eventId for debugging
        processedAt: new Date().toISOString(),
        processorVersion: '2.2', // Bumped version to track TTL fix
        ttl: Math.floor(Date.now() / 1000) + ttlSeconds, // CRITICAL FIX #7.1: Configurable TTL
        ttlDays: DEDUP_TTL_DAYS // Store for debugging
      },
      ConditionExpression: 'attribute_not_exists(eventId)' // FIXED: Check partition key
    }));
    
    // If we get here, this is the first time processing this event
    return {
      isDuplicate: false,
      dedupKey
    };
    
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      // This event was already processed
      console.log('[Deduplication] Duplicate event detected:', {
        dedupKey,
        callId,
        stage
      });
      
      return {
        isDuplicate: true,
        dedupKey
      };
    }
    
    // Other errors should be thrown
    throw err;
  }
}

/**
 * Generate consistent deduplication key
 * Format: {callId}#{stage}#{timestamp-bucket}
 * 
 * We include a timestamp bucket (5-minute window) to allow for:
 * - Multiple live updates for same call
 * - Separate live vs post-call processing
 * 
 * CRITICAL FIX #16: Handle late-arriving events from Kinesis shard lag
 * - Include event timestamp in dedup key to prevent collisions
 * - Use eventTimestamp if provided instead of wall-clock time
 */
export function generateDedupKey(
  callId: string, 
  stage: ProcessingStage,
  timestampBucket?: number,
  eventTimestamp?: number
): string {
  // For post-call and finalization stages, we don't need timestamp bucket (only process once)
  if (stage === 'post-call' || stage === 'call-end-finalization' || 
      stage === 'post-call-completed' || stage === 'post-call-abandoned') {
    return `${callId}#${stage}`;
  }
  
  // For live-init, only one per call (no bucket needed)
  if (stage === 'live-init') {
    return `${callId}#${stage}`;
  }
  
  // CRITICAL FIX #16: For live updates, use event timestamp if provided
  // This prevents collisions when Kinesis shards are lagging and events arrive late
  // Bucket by 5-minute windows based on event time, not current time
  const referenceTime = eventTimestamp || Date.now();
  const bucket = timestampBucket || Math.floor(referenceTime / (5 * 60 * 1000));
  return `${callId}#${stage}#${bucket}`;
}

/**
 * CRITICAL FIX #16: Generate dedup key with event-based timestamp
 * Use this version when you have the original event timestamp from Kinesis
 * to prevent bucket collisions from shard lag
 */
export function generateDedupKeyFromEvent(
  callId: string,
  stage: ProcessingStage,
  eventTimestamp: number
): string {
  return generateDedupKey(callId, stage, undefined, eventTimestamp);
}

/**
 * Check if analytics record should be created or updated
 * 
 * @param existingRecord - Existing analytics record (if any)
 * @param stage - Current processing stage
 * @returns true if should process, false if should skip
 */
export function shouldProcessAnalytics(
  existingRecord: any | null,
  stage: ProcessingStage
): boolean {
  // No existing record - always process
  if (!existingRecord) {
    return true;
  }
  
  // If record is already finalized, never overwrite
  if (existingRecord.finalized) {
    console.log('[Deduplication] Skipping - record already finalized');
    return false;
  }
  
  // If record has callEndTime and we're trying to init, skip
  if (stage === 'live-init' && existingRecord.callEndTime) {
    console.log('[Deduplication] Skipping - call already ended');
    return false;
  }
  
  // If stage is post-call and record exists without finalization, process it
  if (stage === 'post-call') {
    return true;
  }
  
  // For live updates, always allow (these are incremental)
  return true;
}

/**
 * Get the deduplication table name
 * Uses environment variable or derives from analytics table name
 * CRITICAL FIX #7.2: Throw error instead of using potentially non-existent fallback table
 */
export function getDedupTableName(analyticsTableName?: string): string {
  const explicitTable = process.env.ANALYTICS_DEDUP_TABLE || process.env.ANALYTICS_DEDUP_TABLE_NAME;
  
  if (explicitTable) {
    return explicitTable;
  }
  
  // Try to derive from analytics table name
  if (analyticsTableName) {
    const derivedName = `${analyticsTableName}-Dedup`;
    console.warn('[Deduplication] Using derived dedup table name:', {
      analyticsTable: analyticsTableName,
      derivedDedupTable: derivedName,
      recommendation: 'Set ANALYTICS_DEDUP_TABLE_NAME explicitly to avoid fragile derivation'
    });
    return derivedName;
  }
  
  // CRITICAL FIX #7.2: Throw error instead of using hardcoded fallback
  // A hardcoded fallback like 'CallAnalytics-Dedup' would silently fail at runtime
  throw new Error(
    '[Deduplication] CRITICAL: Cannot determine dedup table name. ' +
    'Set ANALYTICS_DEDUP_TABLE_NAME environment variable or provide analyticsTableName parameter.'
  );
}


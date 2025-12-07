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
    // Atomic conditional write - only succeeds if key doesn't exist
    await ddb.send(new PutCommand({
      TableName: dedupTableName,
      Item: {
        dedupKey,
        callId,
        stage,
        eventId: eventId || 'unknown',
        processedAt: new Date().toISOString(),
        processorVersion: '2.0', // Version for tracking
        ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
      },
      ConditionExpression: 'attribute_not_exists(dedupKey)'
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
 */
export function generateDedupKey(
  callId: string, 
  stage: ProcessingStage,
  timestampBucket?: number
): string {
  // For post-call and finalization stages, we don't need timestamp bucket (only process once)
  if (stage === 'post-call' || stage === 'call-end-finalization' || 
      stage === 'post-call-completed' || stage === 'post-call-abandoned') {
    return `${callId}#${stage}`;
  }
  
  // For live updates, bucket by 5-minute windows to allow multiple updates
  const bucket = timestampBucket || Math.floor(Date.now() / (5 * 60 * 1000));
  return `${callId}#${stage}#${bucket}`;
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
 * CRITICAL FIX: Check both possible environment variable names
 */
export function getDedupTableName(analyticsTableName?: string): string {
  return process.env.ANALYTICS_DEDUP_TABLE 
    || process.env.ANALYTICS_DEDUP_TABLE_NAME
    || (analyticsTableName ? `${analyticsTableName}-Dedup` : 'CallAnalytics-Dedup');
}


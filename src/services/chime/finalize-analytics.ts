/**
 * Analytics Finalization Lambda
 * 
 * Runs periodically to finalize analytics records that have been scheduled for finalization.
 * This provides a buffer window for out-of-order events to arrive before marking records as complete.
 * 
 * Triggered by: EventBridge scheduled rule (every 1 minute)
 */

import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';

const ddb = getDynamoDBClient();
const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;

if (!ANALYTICS_TABLE) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}

interface AnalyticsRecord {
  callId: string;
  timestamp: number;
  finalizationScheduledAt?: number;
  finalized?: boolean;
  callEndTime?: string;
}

/**
 * Main handler - runs every minute to finalize analytics records
 */
export const handler = async (): Promise<void> => {
  console.log('[finalize-analytics] Starting finalization sweep');
  
  const now = Date.now();
  let finalizedCount = 0;
  let errorCount = 0;
  
  try {
    // Scan for records that are scheduled for finalization but not yet finalized
    // In production, consider using a GSI on finalizationScheduledAt for better performance
    const { Items: records } = await ddb.send(new ScanCommand({
      TableName: ANALYTICS_TABLE,
      FilterExpression: 'attribute_exists(finalizationScheduledAt) AND attribute_not_exists(finalized)',
      ProjectionExpression: 'callId, #ts, finalizationScheduledAt, callEndTime',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      }
    }));
    
    if (!records || records.length === 0) {
      console.log('[finalize-analytics] No records pending finalization');
      return;
    }
    
    console.log(`[finalize-analytics] Found ${records.length} records pending finalization`);
    
    // Process records that are ready for finalization
    for (const record of records as AnalyticsRecord[]) {
      // Check if finalization time has passed
      if (record.finalizationScheduledAt && record.finalizationScheduledAt <= now) {
        try {
          await finalizeRecord(record.callId, record.timestamp);
          finalizedCount++;
        } catch (err: any) {
          console.error('[finalize-analytics] Error finalizing record:', {
            callId: record.callId,
            error: err.message
          });
          errorCount++;
        }
      }
    }
    
    console.log('[finalize-analytics] Finalization sweep complete:', {
      finalized: finalizedCount,
      errors: errorCount,
      pending: records.length - finalizedCount - errorCount
    });
    
  } catch (err: any) {
    console.error('[finalize-analytics] Fatal error during finalization sweep:', err);
    throw err;
  }
};

/**
 * Finalize a single analytics record
 */
async function finalizeRecord(callId: string, timestamp: number): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: ANALYTICS_TABLE,
    Key: { callId, timestamp },
    UpdateExpression: `
      SET finalized = :true,
          finalizedAt = :now
      REMOVE finalizationScheduledAt
    `,
    ExpressionAttributeValues: {
      ':true': true,
      ':now': new Date().toISOString()
    },
    ConditionExpression: 'attribute_exists(callId) AND attribute_not_exists(finalized)'
  }));
  
  console.log(`[finalize-analytics] Finalized analytics for call ${callId}`);
}


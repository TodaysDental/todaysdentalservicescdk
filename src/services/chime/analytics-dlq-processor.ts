/**
 * FIX #33: Dead Letter Queue Processor for Analytics
 * 
 * Processes failed analytics events from DLQ and attempts reprocessing.
 * Stores permanently failed events for manual review.
 */

import { SQSEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { generateCallAnalytics, analyzeSentiment } from './utils/call-analytics-generator';
import { ErrorTracker } from '../shared/utils/error-tracker';
import { randomUUID } from 'crypto';

const ddb = getDynamoDBClient();
const errorTracker = new ErrorTracker();

// FIX: Use CALL_ANALYTICS_TABLE_NAME for consistency with other analytics processors
const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME || process.env.ANALYTICS_TABLE_NAME;
const PERMANENT_FAILURES_TABLE = process.env.PERMANENT_FAILURES_TABLE;

// Validate required environment variables
if (!ANALYTICS_TABLE) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}
if (!PERMANENT_FAILURES_TABLE) {
  console.warn('[DLQ] PERMANENT_FAILURES_TABLE not configured - permanently failed events will only be logged');
}

// FIX: Add retry constants
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 500;

/**
 * Process analytics events from DLQ
 * FIX: Added retry logic with exponential backoff before permanent failure
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log(`[DLQ] Processing ${event.Records.length} failed analytics events`);

  for (const record of event.Records) {
    try {
      // Parse the failed event
      const failedEvent = JSON.parse(record.body);
      const receiveCount = parseInt(record.attributes?.ApproximateReceiveCount || '1', 10);

      console.log('[DLQ] Reprocessing failed analytics event:', {
        callId: failedEvent.callId,
        receiveCount
      });

      // FIX: Implement retry with exponential backoff
      let lastError: any = null;
      let succeeded = false;
      
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await processAnalyticsEvent(failedEvent);
          succeeded = true;
          console.log('[DLQ] Successfully reprocessed on attempt', attempt + 1);
          break;
        } catch (retryErr: any) {
          lastError = retryErr;
          console.warn(`[DLQ] Retry attempt ${attempt + 1} failed:`, {
            error: retryErr.message,
            callId: failedEvent.callId
          });
          
          if (attempt < MAX_RETRIES - 1) {
            // Exponential backoff: 500ms, 1000ms, 2000ms
            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (!succeeded && lastError) {
        throw lastError;
      }

    } catch (err: any) {
      // Still failing after all retries - alert and store for manual review
      await errorTracker.trackError(
        'analytics_dlq_reprocess',
        err as Error,
        'HIGH',
        { record }
      );

      // Store in permanent failure table for manual review
      await storePermanentFailure(record, err);
    }
  }
};

/**
 * Process a single analytics event
 */
async function processAnalyticsEvent(event: any): Promise<void> {
  const callData = event.dynamodb?.NewImage || event.dynamodb?.OldImage;
  
  if (!callData) {
    throw new Error('No call data in event');
  }

  // Generate comprehensive analytics
  const analytics = await generateCallAnalytics(callData);

  // Analyze sentiment if recording exists
  if (callData.recordingId) {
    const sentiment = await analyzeSentiment(callData);
    Object.assign(analytics, { sentiment });
  }

  // Store analytics
  await ddb.send(new PutCommand({
    TableName: ANALYTICS_TABLE,
    Item: {
      ...analytics,
      processedAt: new Date().toISOString(),
      reprocessed: true
    }
  }));

  console.log(`[DLQ] Successfully reprocessed analytics for call ${analytics.callId}`);
}

/**
 * Store permanently failed event for manual review
 */
async function storePermanentFailure(record: any, error: any): Promise<void> {
  if (!PERMANENT_FAILURES_TABLE) {
    console.error('[DLQ] No permanent failures table configured');
    return;
  }

  await ddb.send(new PutCommand({
    TableName: PERMANENT_FAILURES_TABLE,
    Item: {
      failureId: randomUUID(),
      timestamp: Date.now(),
      source: 'analytics-dlq',
      record: record,
      error: error.message,
      stack: error.stack,
      ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
    }
  }));

  console.error('[DLQ] Stored permanent failure for manual review');
}


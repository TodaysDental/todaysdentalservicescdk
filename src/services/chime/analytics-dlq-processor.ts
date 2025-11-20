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

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME;
const PERMANENT_FAILURES_TABLE = process.env.PERMANENT_FAILURES_TABLE;

/**
 * Process analytics events from DLQ
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log(`[DLQ] Processing ${event.Records.length} failed analytics events`);

  for (const record of event.Records) {
    try {
      // Parse the failed event
      const failedEvent = JSON.parse(record.body);

      console.log('[DLQ] Reprocessing failed analytics event:', {
        callId: failedEvent.callId,
        attempt: record.attributes?.ApproximateReceiveCount
      });

      // Attempt to reprocess
      await processAnalyticsEvent(failedEvent);

    } catch (err: any) {
      // Still failing - alert and store for manual review
      await errorTracker.trackError(
        'analytics_dlq_reprocess',
        err as Error,
        'HIGH',
        { record }
      );

      // Store in permanent failure table for manual review
      await storePermamentFailure(record, err);
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
async function storePermamentFailure(record: any, error: any): Promise<void> {
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


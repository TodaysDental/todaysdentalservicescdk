/**
 * Analytics Finalization Lambda
 * 
 * Runs periodically to finalize analytics records that have been scheduled for finalization.
 * This provides a buffer window for out-of-order events to arrive before marking records as complete.
 * 
 * Triggered by: EventBridge scheduled rule (every 1 minute)
 */

import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { trackEnhancedCallMetrics } from '../shared/utils/enhanced-agent-metrics';
import { generateCallCoachingSummary } from './real-time-coaching';

const ddb = getDynamoDBClient();
const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
const AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;

if (!ANALYTICS_TABLE) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}
if (!AGENT_PERFORMANCE_TABLE) {
  throw new Error('AGENT_PERFORMANCE_TABLE_NAME environment variable is required');
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
  // Get full analytics record
  const { Item: analytics } = await ddb.send(new GetCommand({
    TableName: ANALYTICS_TABLE,
    Key: { callId, timestamp }
  }));

  if (!analytics) {
    console.warn(`[finalize-analytics] Record not found: ${callId}`);
    return;
  }

  // Generate coaching summary
  let coachingSummary;
  try {
    coachingSummary = await generateCallCoachingSummary(analytics);
  } catch (err) {
    console.error('[finalize-analytics] Error generating coaching summary:', err);
    coachingSummary = { score: 50, strengths: [], improvements: [] };
  }

  // Mark as finalized
  await ddb.send(new UpdateCommand({
    TableName: ANALYTICS_TABLE,
    Key: { callId, timestamp },
    UpdateExpression: `
      SET finalized = :true,
          finalizedAt = :now,
          coachingSummary = :coaching
      REMOVE finalizationScheduledAt
    `,
    ExpressionAttributeValues: {
      ':true': true,
      ':now': new Date().toISOString(),
      ':coaching': coachingSummary
    },
    ConditionExpression: 'attribute_exists(callId) AND attribute_not_exists(finalized)'
  }));

  // Track enhanced agent metrics if agent is assigned
  if (analytics.agentId && AGENT_PERFORMANCE_TABLE) {
    try {
      await trackEnhancedCallMetrics(ddb, AGENT_PERFORMANCE_TABLE, {
        agentId: analytics.agentId,
        clinicId: analytics.clinicId,
        callId,
        direction: analytics.direction || 'inbound',
        duration: analytics.totalDuration || 0,
        talkTime: analytics.totalDuration || 0,
        holdTime: analytics.holdTime || 0,
        sentiment: analytics.overallSentiment,
        sentimentScore: analytics.averageSentiment,
        transferred: analytics.detectedIssues?.includes('call-transferred'),
        escalated: analytics.detectedIssues?.includes('escalation-request'),
        issues: analytics.detectedIssues || [],
        speakerMetrics: analytics.speakerMetrics
      });
    } catch (err) {
      console.error('[finalize-analytics] Error tracking enhanced metrics:', err);
    }
  }
  
  console.log(`[finalize-analytics] Finalized analytics for call ${callId}`, {
    coachingScore: coachingSummary?.score,
    sentiment: analytics.overallSentiment
  });
}


/**
 * Agent Performance Tracker
 * 
 * Utilities for tracking and updating agent performance metrics in real-time
 * Called from various call-handling Lambdas to maintain accurate agent statistics
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

export interface CallMetrics {
  callId: string;
  agentId: string;
  clinicId: string;
  direction: 'inbound' | 'outbound';
  
  // Duration in seconds
  totalDuration?: number;
  talkTime?: number;
  holdTime?: number;
  
  // Call outcome
  wasCompleted: boolean;
  wasTransferred: boolean;
  wasRejected: boolean;
  wasMissed: boolean;
  
  // Timestamps
  startTime: string;
  endTime?: string;
}

/**
 * Update agent performance metrics when a call is completed
 * FIXED: Now uses atomic DynamoDB ADD operations to prevent race conditions
 */
/**
 * CRITICAL FIX: Get date in clinic timezone to avoid boundary issues
 */
function getDateInTimezone(timestamp: Date | string, timezone: string = 'UTC'): string {
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch (err) {
    // Fallback to UTC if timezone is invalid
    console.warn('[getDateInTimezone] Invalid timezone, falling back to UTC:', timezone);
    return new Date(timestamp).toISOString().split('T')[0];
  }
}

export async function trackCallCompletion(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  metrics: CallMetrics,
  sentiment?: { sentiment: string; score: number }
): Promise<void> {
  try {
    // CRITICAL FIX: Use clinic timezone if available, otherwise UTC
    const timezone = (metrics as any).timezone || 'UTC';
    const periodDate = getDateInTimezone(metrics.startTime, timezone);
    
    console.log('[AgentPerformanceTracker] Tracking call completion:', {
      agentId: metrics.agentId,
      callId: metrics.callId,
      direction: metrics.direction,
      wasCompleted: metrics.wasCompleted,
    });

    // Calculate increments (all atomic counters)
    const totalCallsIncrement = 1;
    const inboundIncrement = metrics.direction === 'inbound' ? 1 : 0;
    const outboundIncrement = metrics.direction === 'outbound' ? 1 : 0;
    const missedIncrement = metrics.wasMissed ? 1 : 0;
    const rejectedIncrement = metrics.wasRejected ? 1 : 0;
    const transferredIncrement = metrics.wasTransferred ? 1 : 0;
    const completedIncrement = metrics.wasCompleted ? 1 : 0;

    const talkTimeIncrement = metrics.talkTime || 0;
    const holdTimeIncrement = metrics.holdTime || 0;
    const handleTimeIncrement = metrics.totalDuration || 0;

    // Build sentiment score increments if provided
    const sentimentIncrements: any = {};
    if (sentiment) {
      switch (sentiment.sentiment.toUpperCase()) {
        case 'POSITIVE':
          sentimentIncrements[':sentimentPositiveInc'] = 1;
          sentimentIncrements[':sentimentNeutralInc'] = 0;
          sentimentIncrements[':sentimentNegativeInc'] = 0;
          sentimentIncrements[':sentimentMixedInc'] = 0;
          break;
        case 'NEUTRAL':
          sentimentIncrements[':sentimentPositiveInc'] = 0;
          sentimentIncrements[':sentimentNeutralInc'] = 1;
          sentimentIncrements[':sentimentNegativeInc'] = 0;
          sentimentIncrements[':sentimentMixedInc'] = 0;
          break;
        case 'NEGATIVE':
          sentimentIncrements[':sentimentPositiveInc'] = 0;
          sentimentIncrements[':sentimentNeutralInc'] = 0;
          sentimentIncrements[':sentimentNegativeInc'] = 1;
          sentimentIncrements[':sentimentMixedInc'] = 0;
          break;
        case 'MIXED':
          sentimentIncrements[':sentimentPositiveInc'] = 0;
          sentimentIncrements[':sentimentNeutralInc'] = 0;
          sentimentIncrements[':sentimentNegativeInc'] = 0;
          sentimentIncrements[':sentimentMixedInc'] = 1;
          break;
        default:
          sentimentIncrements[':sentimentPositiveInc'] = 0;
          sentimentIncrements[':sentimentNeutralInc'] = 1;
          sentimentIncrements[':sentimentNegativeInc'] = 0;
          sentimentIncrements[':sentimentMixedInc'] = 0;
      }
    } else {
      // Default to neutral if no sentiment provided
      sentimentIncrements[':sentimentPositiveInc'] = 0;
      sentimentIncrements[':sentimentNeutralInc'] = 1;
      sentimentIncrements[':sentimentNegativeInc'] = 0;
      sentimentIncrements[':sentimentMixedInc'] = 0;
    }

    // CRITICAL FIX #2: Enhanced atomic operations with conditional check to prevent duplicate call tracking
    // This ensures concurrent updates don't lose data AND prevents same call from being counted twice
    try {
      await ddb.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          agentId: metrics.agentId,
          periodDate,
        },
        UpdateExpression: `
          SET clinicId = if_not_exists(clinicId, :clinicId),
              lastUpdated = :now,
              callIds = list_append(if_not_exists(callIds, :emptyList), :callId)
          ADD totalCalls :totalInc,
              inboundCalls :inboundInc,
              outboundCalls :outboundInc,
              missedCalls :missedInc,
              rejectedCalls :rejectedInc,
              callsTransferred :transferredInc,
              callsCompleted :completedInc,
              totalTalkTime :talkTimeInc,
              totalHoldTime :holdTimeInc,
              totalHandleTime :handleTimeInc,
              sentimentScores.positive :sentimentPositiveInc,
              sentimentScores.neutral :sentimentNeutralInc,
              sentimentScores.negative :sentimentNegativeInc,
              sentimentScores.mixed :sentimentMixedInc
        `,
        // CRITICAL FIX #2: Add condition to prevent duplicate call tracking
        ConditionExpression: 'NOT contains(callIds, :callIdStr)',
        ExpressionAttributeValues: {
          ':clinicId': metrics.clinicId,
          ':totalInc': totalCallsIncrement,
          ':inboundInc': inboundIncrement,
          ':outboundInc': outboundIncrement,
          ':missedInc': missedIncrement,
          ':rejectedInc': rejectedIncrement,
          ':transferredInc': transferredIncrement,
          ':completedInc': completedIncrement,
          ':talkTimeInc': talkTimeIncrement,
          ':holdTimeInc': holdTimeIncrement,
          ':handleTimeInc': handleTimeIncrement,
          ...sentimentIncrements,
          ':now': new Date().toISOString(),
          ':emptyList': [],
          ':callId': [metrics.callId],
          ':callIdStr': metrics.callId, // For condition check
        },
      }));
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        // Call already tracked - this is a duplicate, skip silently
        console.log('[AgentPerformanceTracker] Duplicate call detected, skipping:', {
          callId: metrics.callId,
          agentId: metrics.agentId,
          periodDate
        });
        return; // Exit early, don't recalculate metrics
      }
      // Other errors should be thrown
      throw err;
    }

    // After atomic update, recalculate derived metrics (averages, scores)
    // This requires a separate read, but primary counters are now safe from race conditions
    await recalculateDerivedMetrics(ddb, tableName, metrics.agentId, periodDate);

    console.log('[AgentPerformanceTracker] Updated performance metrics for agent:', metrics.agentId);

  } catch (error) {
    console.error('[AgentPerformanceTracker] Error tracking call completion:', error);
    throw error; // FIXED: Throw error so it can be caught and sent to DLQ
  }
}

/**
 * Recalculate derived metrics (averages and scores) after atomic updates
 * This is done in a separate operation to keep atomic updates fast
 */
async function recalculateDerivedMetrics(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  periodDate: string
): Promise<void> {
  try {
    // Get current state after atomic updates
    const result = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { agentId, periodDate },
    }));

    if (!result.Item) {
      console.warn('[AgentPerformanceTracker] No record found for derived metrics calculation');
      return;
    }

    const data = result.Item;
    
    // Calculate averages with zero-division protection
    const totalCalls = data.totalCalls || 0;
    const averageHandleTime = totalCalls > 0 
      ? Math.round((data.totalHandleTime || 0) / totalCalls) 
      : 0;
    const averageTalkTime = totalCalls > 0 
      ? Math.round((data.totalTalkTime || 0) / totalCalls) 
      : 0;

    // Calculate rates
    const callsCompleted = data.callsCompleted || 0;
    const callsRejected = data.rejectedCalls || 0;
    const callsTransferred = data.callsTransferred || 0;
    
    const completionRate = totalCalls > 0 
      ? (callsCompleted / totalCalls) * 100 
      : 0;
    const rejectionRate = totalCalls > 0 
      ? (callsRejected / totalCalls) * 100 
      : 0;

    // FCR calculation: Calls completed without transfer
    const fcrRate = callsCompleted > 0
      ? ((callsCompleted - callsTransferred) / callsCompleted) * 100
      : 0;

    // Calculate sentiment score
    const sentimentScores = data.sentimentScores || { positive: 0, neutral: 0, negative: 0, mixed: 0 };
    const totalSentimentCalls = 
      sentimentScores.positive + 
      sentimentScores.neutral + 
      sentimentScores.negative + 
      sentimentScores.mixed;
    
    const averageSentiment = totalSentimentCalls > 0
      ? ((sentimentScores.positive * 100 + sentimentScores.neutral * 50 + sentimentScores.mixed * 50) / totalSentimentCalls)
      : 50;

    // ENHANCED: Performance score now includes efficiency (AHT) and quality metrics
    // - Completion rate (30%)
    // - Low rejection rate (15%)
    // - Sentiment (30%)
    // - Efficiency (AHT, lower is better, capped at 600s = 10min target) (15%)
    // - Low transfer rate (10%)
    const ahtScore = Math.max(0, Math.min(100, 100 - ((averageHandleTime - 600) / 10)));
    const transferRate = callsCompleted > 0 ? (callsTransferred / callsCompleted) * 100 : 0;
    const transferScore = Math.max(0, 100 - transferRate);
    
    const performanceScore = Math.round(
      (completionRate * 0.30) +
      ((100 - rejectionRate) * 0.15) +
      (averageSentiment * 0.30) +
      (ahtScore * 0.15) +
      (transferScore * 0.10)
    );

    // Update derived metrics
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { agentId, periodDate },
      UpdateExpression: `
        SET averageHandleTime = :avgHandleTime,
            averageTalkTime = :avgTalkTime,
            averageSentiment = :avgSentiment,
            firstCallResolutionRate = :fcrRate,
            performanceScore = :perfScore,
            completionRate = :completionRate,
            rejectionRate = :rejectionRate,
            transferRate = :transferRate
      `,
      ExpressionAttributeValues: {
        ':avgHandleTime': averageHandleTime,
        ':avgTalkTime': averageTalkTime,
        ':avgSentiment': averageSentiment,
        ':fcrRate': fcrRate,
        ':perfScore': performanceScore,
        ':completionRate': completionRate,
        ':rejectionRate': rejectionRate,
        ':transferRate': transferRate,
      },
    }));

  } catch (error) {
    console.error('[AgentPerformanceTracker] Error recalculating derived metrics:', error);
    // Don't throw - derived metrics can be recalculated later
  }
}

/**
 * Track when an agent rejects a call
 */
export async function trackCallRejection(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  clinicId: string,
  callId: string
): Promise<void> {
  await trackCallCompletion(ddb, tableName, {
    callId,
    agentId,
    clinicId,
    direction: 'inbound',
    wasCompleted: false,
    wasTransferred: false,
    wasRejected: true,
    wasMissed: false,
    startTime: new Date().toISOString(),
  });
}

/**
 * Track when a call is missed (no agent available)
 */
export async function trackCallMissed(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  clinicId: string,
  callId: string
): Promise<void> {
  await trackCallCompletion(ddb, tableName, {
    callId,
    agentId,
    clinicId,
    direction: 'inbound',
    wasCompleted: false,
    wasTransferred: false,
    wasRejected: false,
    wasMissed: true,
    startTime: new Date().toISOString(),
  });
}

/**
 * Extract call metrics from a call record
 * FIXED FLAW #12 & #13: Handle mixed timestamp formats and null values properly
 */
export function extractCallMetrics(callRecord: any): CallMetrics | null {
  if (!callRecord.assignedAgentId) {
    return null; // No agent assigned, can't track performance
  }

  // Handle various timestamp formats (ISO string or epoch seconds)
  let startTime: string;
  if (callRecord.queueEntryTimeIso) {
    startTime = callRecord.queueEntryTimeIso;
  } else if (callRecord.queueEntryTime) {
    // Could be epoch seconds or milliseconds
    const timestamp = typeof callRecord.queueEntryTime === 'number'
      ? callRecord.queueEntryTime
      : parseInt(callRecord.queueEntryTime, 10);
    // If less than year 2010 in milliseconds, it's in seconds
    startTime = new Date(timestamp < 1262304000000 ? timestamp * 1000 : timestamp).toISOString();
  } else {
    startTime = new Date().toISOString();
  }

  let endTime: string;
  if (callRecord.endedAtIso) {
    endTime = callRecord.endedAtIso;
  } else if (callRecord.endTime) {
    const timestamp = typeof callRecord.endTime === 'number'
      ? callRecord.endTime
      : parseInt(callRecord.endTime, 10);
    endTime = new Date(timestamp < 1262304000000 ? timestamp * 1000 : timestamp).toISOString();
  } else {
    endTime = new Date().toISOString();
  }

  // Calculate durations from call record with null safety
  let totalDuration = 0;
  if (callRecord.endTime && callRecord.queueEntryTime) {
    const end = typeof callRecord.endTime === 'number' ? callRecord.endTime : parseInt(callRecord.endTime, 10);
    const start = typeof callRecord.queueEntryTime === 'number' ? callRecord.queueEntryTime : parseInt(callRecord.queueEntryTime, 10);
    totalDuration = Math.max(0, end - start); // Ensure non-negative
  }

  const talkTime = callRecord.talkDuration || 0;
  const holdTime = callRecord.holdDuration || 0;

  return {
    callId: callRecord.callId,
    agentId: callRecord.assignedAgentId,
    clinicId: callRecord.clinicId,
    direction: callRecord.direction || 'inbound',
    totalDuration,
    talkTime,
    holdTime,
    wasCompleted: callRecord.status === 'completed',
    wasTransferred: callRecord.wasTransferred || !!callRecord.transferredToAgentId || false,
    wasRejected: callRecord.status === 'rejected',
    wasMissed: callRecord.status === 'abandoned' || callRecord.status === 'missed',
    startTime,
    endTime,
  };
}

/**
 * Get agent performance summary for a specific date
 */
export async function getAgentDailyPerformance(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  date?: string,
  timezone?: string
): Promise<any> {
  // CRITICAL FIX: Use clinic timezone for consistent date aggregation
  const periodDate = date || getDateInTimezone(new Date(), timezone || 'UTC');

  try {
    const result = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: {
        agentId,
        periodDate,
      },
    }));

    return result.Item || null;
  } catch (error) {
    console.error('[AgentPerformanceTracker] Error getting daily performance:', error);
    return null;
  }
}


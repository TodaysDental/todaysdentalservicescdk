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
 */
export async function trackCallCompletion(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  metrics: CallMetrics
): Promise<void> {
  try {
    const periodDate = new Date(metrics.startTime).toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log('[AgentPerformanceTracker] Tracking call completion:', {
      agentId: metrics.agentId,
      callId: metrics.callId,
      direction: metrics.direction,
      wasCompleted: metrics.wasCompleted,
    });

    // Get existing record to calculate new averages
    const existing = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: {
        agentId: metrics.agentId,
        periodDate,
      },
    }));

    const existingData = existing.Item || {};

    // Calculate increments
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

    // Calculate new totals
    const newTotalCalls = (existingData.totalCalls || 0) + totalCallsIncrement;
    const newTotalTalkTime = (existingData.totalTalkTime || 0) + talkTimeIncrement;
    const newTotalHoldTime = (existingData.totalHoldTime || 0) + holdTimeIncrement;
    const newTotalHandleTime = (existingData.totalHandleTime || 0) + handleTimeIncrement;

    // Calculate averages
    const averageHandleTime = newTotalCalls > 0 ? Math.round(newTotalHandleTime / newTotalCalls) : 0;
    const averageTalkTime = newTotalCalls > 0 ? Math.round(newTotalTalkTime / newTotalCalls) : 0;

    // Calculate performance metrics
    const callsCompleted = (existingData.callsCompleted || 0) + completedIncrement;
    const callsRejected = (existingData.rejectedCalls || 0) + rejectedIncrement;
    const callsTransferredTotal = (existingData.callsTransferred || 0) + transferredIncrement;
    const completionRate = newTotalCalls > 0 ? (callsCompleted / newTotalCalls) * 100 : 0;
    const rejectionRate = newTotalCalls > 0 ? (callsRejected / newTotalCalls) * 100 : 0;

    // FIXED FLAW #10: FCR should be (completed - transferred) / completed, not just completion rate
    const fcrRate = callsCompleted > 0
      ? ((callsCompleted - callsTransferredTotal) / callsCompleted) * 100
      : 0;

    // FIXED FLAW #11: Recalculate sentiment based on updated totals, not reuse old value
    const totalSentimentCalls =
      (existingData.sentimentScores?.positive || 0) +
      (existingData.sentimentScores?.neutral || 0) +
      (existingData.sentimentScores?.negative || 0) +
      (existingData.sentimentScores?.mixed || 0);

    const recalculatedSentiment = totalSentimentCalls > 0
      ? ((existingData.sentimentScores.positive * 100 + existingData.sentimentScores.neutral * 50) / totalSentimentCalls)
      : 50;

    // Performance score: weighted combination of metrics
    // - Completion rate (40%)
    // - Low rejection rate (20%)
    // - Sentiment (40%)
    const performanceScore = Math.round(
      (completionRate * 0.4) +
      ((100 - rejectionRate) * 0.2) +
      (recalculatedSentiment * 0.4)
    );

    // Update or create performance record
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: {
        agentId: metrics.agentId,
        periodDate,
      },
      UpdateExpression: `
        SET clinicId = if_not_exists(clinicId, :clinicId),
            totalCalls = if_not_exists(totalCalls, :zero) + :totalInc,
            inboundCalls = if_not_exists(inboundCalls, :zero) + :inboundInc,
            outboundCalls = if_not_exists(outboundCalls, :zero) + :outboundInc,
            missedCalls = if_not_exists(missedCalls, :zero) + :missedInc,
            rejectedCalls = if_not_exists(rejectedCalls, :zero) + :rejectedInc,
            callsTransferred = if_not_exists(callsTransferred, :zero) + :transferredInc,
            callsCompleted = if_not_exists(callsCompleted, :zero) + :completedInc,
            totalTalkTime = if_not_exists(totalTalkTime, :zero) + :talkTimeInc,
            totalHoldTime = if_not_exists(totalHoldTime, :zero) + :holdTimeInc,
            totalHandleTime = if_not_exists(totalHandleTime, :zero) + :handleTimeInc,
            averageHandleTime = :avgHandleTime,
            averageTalkTime = :avgTalkTime,
            averageSentiment = :avgSentiment,
            firstCallResolutionRate = :fcrRate,
            performanceScore = :perfScore,
            lastUpdated = :now,
            callIds = list_append(if_not_exists(callIds, :emptyList), :callId),
            sentimentScores = if_not_exists(sentimentScores, :initialSentiment)
      `,
      ExpressionAttributeValues: {
        ':clinicId': metrics.clinicId,
        ':zero': 0,
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
        ':avgHandleTime': averageHandleTime,
        ':avgTalkTime': averageTalkTime,
        ':avgSentiment': recalculatedSentiment,
        ':fcrRate': fcrRate,
        ':perfScore': performanceScore,
        ':now': new Date().toISOString(),
        ':emptyList': [],
        ':callId': [metrics.callId],
        ':initialSentiment': {
          positive: 0,
          neutral: 0,
          negative: 0,
          mixed: 0,
        },
      },
    }));

    console.log('[AgentPerformanceTracker] Updated performance metrics for agent:', metrics.agentId, {
      totalCalls: newTotalCalls,
      averageHandleTime,
      performanceScore,
    });

  } catch (error) {
    console.error('[AgentPerformanceTracker] Error tracking call completion:', error);
    // Don't throw - performance tracking should not fail the main operation
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
  date?: string
): Promise<any> {
  const periodDate = date || new Date().toISOString().split('T')[0];

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


/**
 * Enhanced Agent Performance Metrics
 * 
 * Comprehensive metrics tracking for agent performance including:
 * - Call handling metrics (AHT, FCR, transfer rate)
 * - Quality metrics (sentiment, CSAT proxy)
 * - Productivity metrics (calls per hour, utilization)
 * - Coaching scores
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface EnhancedAgentMetrics {
  agentId: string;
  periodDate: string; // YYYY-MM-DD
  clinicId: string;

  // Call Volume Metrics
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  answeredCalls: number;
  missedCalls: number;

  // Time Metrics (in seconds)
  totalTalkTime: number;
  totalHoldTime: number;
  totalAfterCallWorkTime: number;
  averageHandleTime: number; // AHT = (talk + hold + ACW) / answered calls
  
  // Quality Metrics
  sentimentScores: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  averageSentiment: number; // 0-100 scale
  csatProxy: number; // Customer satisfaction proxy based on sentiment
  
  // First Call Resolution (FCR)
  resolvedCalls: number; // Calls not followed by another within 24h
  fcrRate: number; // Percentage
  
  // Transfer & Escalation
  transferredCalls: number;
  escalatedCalls: number;
  transferRate: number; // Percentage
  
  // Efficiency Metrics
  callsPerHour: number;
  utilizationRate: number; // (Talk + Hold + ACW) / Total logged time
  
  // Coaching Metrics
  coachingScore: number; // 0-100 from real-time coaching analysis
  interruptionRate: number; // Interruptions per call
  talkTimeBalance: number; // Ideal is 40-60%, score 0-100
  
  // Issue Tracking
  customerFrustrationCount: number;
  escalationRequestCount: number;
  audioQualityIssues: number;
  
  // Metadata
  callIds: string[];
  lastUpdated: string;
}

/**
 * Track comprehensive call completion metrics
 */
export async function trackEnhancedCallMetrics(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  metrics: {
    agentId: string;
    clinicId: string;
    callId: string;
    direction: 'inbound' | 'outbound';
    duration: number; // seconds
    talkTime?: number;
    holdTime?: number;
    sentiment?: string;
    sentimentScore?: number;
    transferred?: boolean;
    escalated?: boolean;
    issues?: string[];
    speakerMetrics?: {
      agentTalkPercentage: number;
      interruptionCount: number;
    };
  }
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Get existing metrics
  const existing = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: {
      agentId: metrics.agentId,
      periodDate: today,
    },
  }));

  const current = existing.Item as EnhancedAgentMetrics | undefined;

  // Calculate new values
  const newTotalCalls = (current?.totalCalls || 0) + 1;
  const newAnsweredCalls = (current?.answeredCalls || 0) + 1;
  const newInboundCalls = metrics.direction === 'inbound' 
    ? (current?.inboundCalls || 0) + 1 
    : (current?.inboundCalls || 0);
  const newOutboundCalls = metrics.direction === 'outbound'
    ? (current?.outboundCalls || 0) + 1
    : (current?.outboundCalls || 0);

  const newTotalTalkTime = (current?.totalTalkTime || 0) + (metrics.talkTime || metrics.duration);
  const newTotalHoldTime = (current?.totalHoldTime || 0) + (metrics.holdTime || 0);

  // Calculate AHT (Average Handle Time)
  const newAverageHandleTime = Math.round(
    (newTotalTalkTime + newTotalHoldTime) / newAnsweredCalls
  );

  // Update sentiment counts
  const sentimentScores = current?.sentimentScores || { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  if (metrics.sentiment) {
    const sentimentKey = metrics.sentiment.toLowerCase();
    if (sentimentKey in sentimentScores) {
      sentimentScores[sentimentKey as keyof typeof sentimentScores]++;
    }
  }

  // Calculate average sentiment score
  const currentAvgSentiment = current?.averageSentiment || 50;
  const totalSentimentCalls = Object.values(sentimentScores).reduce((sum, count) => sum + count, 0);
  const newAverageSentiment = metrics.sentimentScore
    ? Math.round(
        (currentAvgSentiment * (totalSentimentCalls - 1) + metrics.sentimentScore) / totalSentimentCalls
      )
    : currentAvgSentiment;

  // Calculate CSAT proxy (Customer Satisfaction based on sentiment)
  const csatProxy = Math.round(
    ((sentimentScores.positive + sentimentScores.neutral * 0.5) / totalSentimentCalls) * 100
  );

  // Track transfers and escalations
  const newTransferredCalls = (current?.transferredCalls || 0) + (metrics.transferred ? 1 : 0);
  const newEscalatedCalls = (current?.escalatedCalls || 0) + (metrics.escalated ? 1 : 0);
  const transferRate = Math.round((newTransferredCalls / newAnsweredCalls) * 100);

  // Track issues
  const newCustomerFrustrationCount = (current?.customerFrustrationCount || 0) +
    (metrics.issues?.includes('customer-frustration') ? 1 : 0);
  const newEscalationRequestCount = (current?.escalationRequestCount || 0) +
    (metrics.issues?.includes('escalation-request') ? 1 : 0);
  const newAudioQualityIssues = (current?.audioQualityIssues || 0) +
    (metrics.issues?.includes('poor-audio-quality') ? 1 : 0);

  // Calculate efficiency metrics
  const callsPerHour = current?.callsPerHour || 0; // Requires session tracking
  const utilizationRate = current?.utilizationRate || 0; // Requires session tracking

  // Calculate coaching metrics
  const interruptionRate = metrics.speakerMetrics
    ? metrics.speakerMetrics.interruptionCount
    : (current?.interruptionRate || 0);

  const talkTimeBalance = metrics.speakerMetrics
    ? calculateTalkTimeBalanceScore(metrics.speakerMetrics.agentTalkPercentage)
    : (current?.talkTimeBalance || 100);

  // Update DynamoDB
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      agentId: metrics.agentId,
      periodDate: today,
    },
    UpdateExpression: `
      SET clinicId = if_not_exists(clinicId, :clinicId),
          totalCalls = :totalCalls,
          inboundCalls = :inboundCalls,
          outboundCalls = :outboundCalls,
          answeredCalls = :answeredCalls,
          totalTalkTime = :totalTalkTime,
          totalHoldTime = :totalHoldTime,
          averageHandleTime = :aht,
          sentimentScores = :sentimentScores,
          averageSentiment = :avgSentiment,
          csatProxy = :csatProxy,
          transferredCalls = :transferredCalls,
          escalatedCalls = :escalatedCalls,
          transferRate = :transferRate,
          customerFrustrationCount = :frustrationCount,
          escalationRequestCount = :escalationCount,
          audioQualityIssues = :audioIssues,
          interruptionRate = :interruptionRate,
          talkTimeBalance = :talkTimeBalance,
          callIds = list_append(if_not_exists(callIds, :emptyList), :callId),
          lastUpdated = :now
    `,
    ExpressionAttributeValues: {
      ':clinicId': metrics.clinicId,
      ':totalCalls': newTotalCalls,
      ':inboundCalls': newInboundCalls,
      ':outboundCalls': newOutboundCalls,
      ':answeredCalls': newAnsweredCalls,
      ':totalTalkTime': newTotalTalkTime,
      ':totalHoldTime': newTotalHoldTime,
      ':aht': newAverageHandleTime,
      ':sentimentScores': sentimentScores,
      ':avgSentiment': newAverageSentiment,
      ':csatProxy': csatProxy,
      ':transferredCalls': newTransferredCalls,
      ':escalatedCalls': newEscalatedCalls,
      ':transferRate': transferRate,
      ':frustrationCount': newCustomerFrustrationCount,
      ':escalationCount': newEscalationRequestCount,
      ':audioIssues': newAudioQualityIssues,
      ':interruptionRate': interruptionRate,
      ':talkTimeBalance': talkTimeBalance,
      ':emptyList': [],
      ':callId': [metrics.callId],
      ':now': new Date().toISOString(),
    },
  }));

  console.log('[EnhancedMetrics] Updated metrics for agent:', metrics.agentId, {
    totalCalls: newTotalCalls,
    aht: newAverageHandleTime,
    avgSentiment: newAverageSentiment,
  });
}

/**
 * Calculate talk time balance score (0-100)
 * Ideal range is 40-60%, with 50% being perfect
 */
function calculateTalkTimeBalanceScore(agentTalkPercentage: number): number {
  // Perfect score at 50%
  if (agentTalkPercentage === 50) return 100;
  
  // Good range: 40-60%
  if (agentTalkPercentage >= 40 && agentTalkPercentage <= 60) {
    const deviation = Math.abs(agentTalkPercentage - 50);
    return 100 - (deviation * 2); // -2 points per % deviation
  }
  
  // Acceptable range: 30-70%
  if (agentTalkPercentage >= 30 && agentTalkPercentage <= 70) {
    const deviation = Math.abs(agentTalkPercentage - 50);
    return 80 - ((deviation - 10) * 3); // Steeper penalty outside good range
  }
  
  // Poor: < 30% or > 70%
  if (agentTalkPercentage < 30) {
    return Math.max(0, 50 - (30 - agentTalkPercentage) * 2);
  } else {
    return Math.max(0, 50 - (agentTalkPercentage - 70) * 2);
  }
}

/**
 * Calculate First Call Resolution (FCR) rate
 * Checks if customer called back within 24 hours
 */
export async function calculateFCR(
  ddb: DynamoDBDocumentClient,
  callQueueTable: string,
  callId: string,
  customerPhone: string,
  clinicId: string
): Promise<boolean> {
  // Query for calls from same customer within 24 hours
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const result = await ddb.send(new QueryCommand({
    TableName: callQueueTable,
    IndexName: 'clinicId-timestamp-index', // Assuming this exists
    KeyConditionExpression: 'clinicId = :clinicId AND queuePosition > :timestamp',
    FilterExpression: 'customerPhone = :phone AND callId <> :currentCallId',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':timestamp': oneDayAgo,
      ':phone': customerPhone,
      ':currentCallId': callId,
    },
  }));

  // If no follow-up calls, it's resolved on first call
  return (result.Items?.length || 0) === 0;
}

/**
 * Get agent performance summary for a date range
 */
export async function getAgentPerformanceSummary(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  startDate: string,
  endDate: string
): Promise<any> {
  // Query metrics for date range
  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'agentId = :agentId AND periodDate BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':agentId': agentId,
      ':start': startDate,
      ':end': endDate,
    },
  }));

  const metrics = result.Items || [];

  if (metrics.length === 0) {
    return null;
  }

  // Aggregate metrics
  const totals = metrics.reduce((acc, day: any) => ({
    totalCalls: acc.totalCalls + (day.totalCalls || 0),
    answeredCalls: acc.answeredCalls + (day.answeredCalls || 0),
    totalTalkTime: acc.totalTalkTime + (day.totalTalkTime || 0),
    totalHoldTime: acc.totalHoldTime + (day.totalHoldTime || 0),
    sentimentScores: {
      positive: acc.sentimentScores.positive + (day.sentimentScores?.positive || 0),
      neutral: acc.sentimentScores.neutral + (day.sentimentScores?.neutral || 0),
      negative: acc.sentimentScores.negative + (day.sentimentScores?.negative || 0),
      mixed: acc.sentimentScores.mixed + (day.sentimentScores?.mixed || 0),
    },
    transferredCalls: acc.transferredCalls + (day.transferredCalls || 0),
    escalatedCalls: acc.escalatedCalls + (day.escalatedCalls || 0),
  }), {
    totalCalls: 0,
    answeredCalls: 0,
    totalTalkTime: 0,
    totalHoldTime: 0,
    sentimentScores: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
    transferredCalls: 0,
    escalatedCalls: 0,
  });

  // Calculate averages
  const averageHandleTime = Math.round(
    (totals.totalTalkTime + totals.totalHoldTime) / totals.answeredCalls
  );

  const totalSentimentCalls = Object.values(totals.sentimentScores).reduce((sum, count) => sum + count, 0);
  const csatProxy = Math.round(
    ((totals.sentimentScores.positive + totals.sentimentScores.neutral * 0.5) / totalSentimentCalls) * 100
  );

  const transferRate = Math.round((totals.transferredCalls / totals.answeredCalls) * 100);

  return {
    agentId,
    dateRange: { start: startDate, end: endDate },
    totalCalls: totals.totalCalls,
    answeredCalls: totals.answeredCalls,
    averageHandleTime,
    csatProxy,
    transferRate,
    sentimentScores: totals.sentimentScores,
    transferredCalls: totals.transferredCalls,
    escalatedCalls: totals.escalatedCalls,
  };
}


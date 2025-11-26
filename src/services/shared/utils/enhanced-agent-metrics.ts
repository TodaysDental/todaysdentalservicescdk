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
import { validateAgentMetrics, validateAggregatedMetrics, validateCallCountIntegrity } from './metrics-validator';

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
    timestamp?: number; // ADDED: Call end timestamp for accurate date bucketing
  }
): Promise<void> {
  // CRITICAL FIX: Validate metrics before processing
  const validationResult = validateAgentMetrics(metrics);
  
  if (!validationResult.valid) {
    console.error('[EnhancedMetrics] Validation failed:', {
      agentId: metrics.agentId,
      callId: metrics.callId,
      errors: validationResult.errors
    });
    throw new Error(`Metrics validation failed: ${validationResult.errors.join(', ')}`);
  }
  
  // Log warnings but continue processing
  if (validationResult.warnings.length > 0) {
    console.warn('[EnhancedMetrics] Validation warnings:', {
      agentId: metrics.agentId,
      callId: metrics.callId,
      warnings: validationResult.warnings
    });
  }
  
  // Use sanitized metrics
  const sanitizedMetrics = validationResult.sanitizedMetrics!;
  
  // CRITICAL FIX: Get clinic timezone for accurate date aggregation
  // Use call's actual timestamp (not current time) to handle calls near midnight correctly
  const clinicTimezone = await getClinicTimezone(sanitizedMetrics.clinicId);
  const callTimestamp = sanitizedMetrics.timestamp 
    ? new Date(sanitizedMetrics.timestamp) 
    : new Date();
  const today = getDateInTimezone(callTimestamp, clinicTimezone);
  
  const MAX_RETRIES = 3;
  let attempt = 0;

  // CRITICAL FIX: Implement optimistic locking with retry logic to prevent race conditions
  while (attempt < MAX_RETRIES) {
    try {
      // Get existing metrics with version info
      const existing = await ddb.send(new GetCommand({
        TableName: tableName,
        Key: {
          agentId: metrics.agentId,
          periodDate: today,
        },
      }));

      const current = existing.Item as EnhancedAgentMetrics | undefined;
      const currentVersion = (current as any)?.version || 0;

  // Validate call count integrity
  const currentCallCount = current?.totalCalls || 0;
  const newCallCount = currentCallCount + 1;
  
  const integrityCheck = validateCallCountIntegrity(currentCallCount, newCallCount, sanitizedMetrics.callId);
  if (!integrityCheck.valid) {
    console.error('[EnhancedMetrics] Call count integrity check failed:', integrityCheck.errors);
    throw new Error(`Call count integrity violation: ${integrityCheck.errors.join(', ')}`);
  }

  // Calculate new values
  const newTotalCalls = newCallCount;
  const newAnsweredCalls = (current?.answeredCalls || 0) + 1;
  const newInboundCalls = sanitizedMetrics.direction === 'inbound' 
    ? (current?.inboundCalls || 0) + 1 
    : (current?.inboundCalls || 0);
  const newOutboundCalls = sanitizedMetrics.direction === 'outbound'
    ? (current?.outboundCalls || 0) + 1
    : (current?.outboundCalls || 0);

  const newTotalTalkTime = (current?.totalTalkTime || 0) + (sanitizedMetrics.talkTime || sanitizedMetrics.duration);
  const newTotalHoldTime = (current?.totalHoldTime || 0) + (sanitizedMetrics.holdTime || 0);

  // Calculate AHT (Average Handle Time)
  const newAverageHandleTime = Math.round(
    (newTotalTalkTime + newTotalHoldTime) / newAnsweredCalls
  );

  // Update sentiment counts
  const sentimentScores = current?.sentimentScores || { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  if (sanitizedMetrics.sentiment) {
    const sentimentKey = sanitizedMetrics.sentiment.toLowerCase();
    if (sentimentKey in sentimentScores) {
      sentimentScores[sentimentKey as keyof typeof sentimentScores]++;
    }
  }

  // Calculate average sentiment score
  const currentAvgSentiment = current?.averageSentiment || 50;
  const totalSentimentCalls = Object.values(sentimentScores).reduce((sum, count) => sum + count, 0);
  const newAverageSentiment = sanitizedMetrics.sentimentScore
    ? Math.round(
        (currentAvgSentiment * (totalSentimentCalls - 1) + sanitizedMetrics.sentimentScore) / totalSentimentCalls
      )
    : currentAvgSentiment;

  // Calculate CSAT proxy (Customer Satisfaction based on sentiment)
  const csatProxy = Math.round(
    ((sentimentScores.positive + sentimentScores.neutral * 0.5) / totalSentimentCalls) * 100
  );

  // Track transfers and escalations
  const newTransferredCalls = (current?.transferredCalls || 0) + (sanitizedMetrics.transferred ? 1 : 0);
  const newEscalatedCalls = (current?.escalatedCalls || 0) + (sanitizedMetrics.escalated ? 1 : 0);
  const transferRate = Math.round((newTransferredCalls / newAnsweredCalls) * 100);

  // Track issues
  const newCustomerFrustrationCount = (current?.customerFrustrationCount || 0) +
    (sanitizedMetrics.issues?.includes('customer-frustration') ? 1 : 0);
  const newEscalationRequestCount = (current?.escalationRequestCount || 0) +
    (sanitizedMetrics.issues?.includes('escalation-request') ? 1 : 0);
  const newAudioQualityIssues = (current?.audioQualityIssues || 0) +
    (sanitizedMetrics.issues?.includes('poor-audio-quality') ? 1 : 0);

  // Calculate efficiency metrics
  const callsPerHour = current?.callsPerHour || 0; // Requires session tracking
  const utilizationRate = current?.utilizationRate || 0; // Requires session tracking

  // Calculate coaching metrics
  const interruptionRate = sanitizedMetrics.speakerMetrics
    ? sanitizedMetrics.speakerMetrics.interruptionCount
    : (current?.interruptionRate || 0);

  const talkTimeBalance = sanitizedMetrics.speakerMetrics
    ? calculateTalkTimeBalanceScore(sanitizedMetrics.speakerMetrics.agentTalkPercentage)
    : (current?.talkTimeBalance || 100);

      // CRITICAL FIX: Cap callIds array to prevent unbounded growth
      // Keep only the last 50 call IDs to stay well under DynamoDB's 400KB item limit
      // ALSO: Deduplicate to prevent the same callId appearing multiple times due to retries
      const existingCallIds = current?.callIds || [];
      const MAX_CALL_IDS = 50;
      
      // Check if callId already exists (prevents duplicate during retries)
      const callIdExists = existingCallIds.includes(sanitizedMetrics.callId);
      const updatedCallIds = callIdExists 
        ? existingCallIds // Don't add duplicate
        : [...existingCallIds, sanitizedMetrics.callId].slice(-MAX_CALL_IDS);
      
      // Validate aggregated metrics before storing
      const aggregatedValidation = validateAggregatedMetrics({
        totalCalls: newTotalCalls,
        averageHandleTime: newAverageHandleTime,
        averageSentiment: newAverageSentiment,
        sentimentScores,
        transferRate
      });
      
      if (!aggregatedValidation.valid) {
        console.error('[EnhancedMetrics] Aggregated metrics validation failed:', {
          agentId: sanitizedMetrics.agentId,
          errors: aggregatedValidation.errors
        });
        throw new Error(`Aggregated metrics validation failed: ${aggregatedValidation.errors.join(', ')}`);
      }
      
      if (aggregatedValidation.warnings.length > 0) {
        console.warn('[EnhancedMetrics] Aggregated metrics warnings:', {
          agentId: sanitizedMetrics.agentId,
          warnings: aggregatedValidation.warnings
        });
      }
      
      const newVersion = currentVersion + 1;
      
      // Update DynamoDB with optimistic locking (version check)
      const updateParams: any = {
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
              callIds = :callIds,
              version = :newVersion,
              lastUpdated = :now
        `,
        ExpressionAttributeValues: {
          ':clinicId': sanitizedMetrics.clinicId,
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
          ':callIds': updatedCallIds,
          ':newVersion': newVersion,
          ':now': new Date().toISOString(),
        },
      };

      // Add version check if record exists (optimistic locking)
      if (current) {
        updateParams.ConditionExpression = 'version = :currentVersion OR attribute_not_exists(version)';
        updateParams.ExpressionAttributeValues[':currentVersion'] = currentVersion;
      }

      await ddb.send(new UpdateCommand(updateParams));

      console.log('[EnhancedMetrics] Updated metrics for agent:', sanitizedMetrics.agentId, {
        totalCalls: newTotalCalls,
        aht: newAverageHandleTime,
        avgSentiment: newAverageSentiment,
        attempt: attempt + 1,
      });
      
      return; // Success - exit retry loop
      
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        // Version conflict - retry with exponential backoff
        attempt++;
        if (attempt >= MAX_RETRIES) {
          console.error('[EnhancedMetrics] Max retries exceeded for agent:', sanitizedMetrics.agentId);
          throw new Error(`Failed to update metrics after ${MAX_RETRIES} attempts due to concurrent updates`);
        }
        
        console.warn('[EnhancedMetrics] Version conflict, retrying...', {
          agentId: sanitizedMetrics.agentId,
          attempt,
        });
        
        // Exponential backoff: 100ms, 200ms, 400ms
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        continue; // Retry
      } else {
        // Other error - throw immediately
        throw err;
      }
    }
  }
}

/**
 * Get clinic timezone from clinicId
 * Returns clinic's configured timezone or UTC as fallback
 */
async function getClinicTimezone(clinicId: string): Promise<string> {
  // TODO: Implement clinic timezone lookup from DynamoDB
  // For now, return UTC as default
  // This should query a Clinics table that stores timezone per clinic
  return 'America/New_York'; // Placeholder - should be dynamic
}

/**
 * Get date in specific timezone as YYYY-MM-DD
 * Handles DST transitions correctly
 */
function getDateInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch (err) {
    console.warn('[EnhancedMetrics] Invalid timezone, falling back to UTC:', {
      timezone,
      error: err
    });
    // Fallback to UTC if timezone is invalid
    return date.toISOString().split('T')[0];
  }
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

  // Calculate averages with division-by-zero protection
  const averageHandleTime = totals.answeredCalls > 0
    ? Math.round((totals.totalTalkTime + totals.totalHoldTime) / totals.answeredCalls)
    : 0;

  const totalSentimentCalls = (Object.values(totals.sentimentScores) as number[]).reduce((sum: number, count: number) => sum + count, 0);
  const csatProxy = totalSentimentCalls > 0
    ? Math.round(((totals.sentimentScores.positive + totals.sentimentScores.neutral * 0.5) / totalSentimentCalls) * 100)
    : 50; // Default to 50 (neutral) if no sentiment data

  const transferRate = totals.answeredCalls > 0
    ? Math.round((totals.transferredCalls / totals.answeredCalls) * 100)
    : 0;

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


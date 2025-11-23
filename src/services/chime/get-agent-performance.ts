/**
 * GET /chime/agent-performance - Retrieve agent performance metrics
 * 
 * Provides comprehensive agent performance reports including:
 * - Call volume (inbound/outbound)
 * - Average handle time
 * - Sentiment scores
 * - Performance rating
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = getDynamoDBClient();

const AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;

interface AgentPerformanceRecord {
  agentId: string;
  periodDate: string; // YYYY-MM-DD
  clinicId: string;
  
  // Call volume metrics
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  missedCalls: number;
  rejectedCalls: number;
  
  // Duration metrics (in seconds)
  totalTalkTime: number;
  totalHandleTime: number;
  totalHoldTime: number;
  averageHandleTime: number;
  averageTalkTime: number;
  
  // Quality metrics
  sentimentScores: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  averageSentiment: number; // 0-100 score
  
  // Performance score (0-100)
  performanceScore: number;
  
  // Additional metrics
  callsTransferred: number;
  callsCompleted: number;
  firstCallResolutionRate: number; // percentage
  
  // Metadata
  lastUpdated: string;
  callIds: string[]; // List of call IDs for this period
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    console.log('[GetAgentPerformance] Request:', JSON.stringify(event, null, 2));

    const agentId = event.queryStringParameters?.agentId;
    const clinicId = event.queryStringParameters?.clinicId;
    const startDate = event.queryStringParameters?.startDate; // YYYY-MM-DD
    const endDate = event.queryStringParameters?.endDate; // YYYY-MM-DD
    const includeCallDetails = event.queryStringParameters?.includeCallDetails === 'true';

    if (!agentId && !clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Either agentId or clinicId is required' 
        }),
      };
    }

    let performanceRecords: AgentPerformanceRecord[] = [];

    if (agentId) {
      // Query by agent ID
      performanceRecords = await getAgentPerformance(agentId, startDate, endDate);
    } else if (clinicId) {
      // Query by clinic ID
      performanceRecords = await getClinicAgentPerformance(clinicId, startDate, endDate);
    }

    // Aggregate data if multiple periods
    const aggregatedData = aggregatePerformanceData(performanceRecords);

    // Include detailed call information if requested
    let callDetails = undefined;
    if (includeCallDetails && agentId) {
      callDetails = await getAgentCallDetails(agentId, startDate, endDate);
    }

    const response = {
      success: true,
      data: {
        summary: aggregatedData,
        dailyBreakdown: performanceRecords,
        callDetails,
      },
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };

  } catch (error: any) {
    console.error('[GetAgentPerformance] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to retrieve agent performance',
        message: error.message 
      }),
    };
  }
};

/**
 * Get performance records for a specific agent
 */
async function getAgentPerformance(
  agentId: string,
  startDate?: string,
  endDate?: string
): Promise<AgentPerformanceRecord[]> {
  const params: any = {
    TableName: AGENT_PERFORMANCE_TABLE_NAME,
    KeyConditionExpression: 'agentId = :agentId',
    ExpressionAttributeValues: {
      ':agentId': agentId,
    },
  };

  // Add date range filter if provided
  if (startDate && endDate) {
    params.KeyConditionExpression += ' AND periodDate BETWEEN :startDate AND :endDate';
    params.ExpressionAttributeValues[':startDate'] = startDate;
    params.ExpressionAttributeValues[':endDate'] = endDate;
  } else if (startDate) {
    params.KeyConditionExpression += ' AND periodDate >= :startDate';
    params.ExpressionAttributeValues[':startDate'] = startDate;
  } else if (endDate) {
    params.KeyConditionExpression += ' AND periodDate <= :endDate';
    params.ExpressionAttributeValues[':endDate'] = endDate;
  }

  const result = await ddb.send(new QueryCommand(params));
  return (result.Items || []) as AgentPerformanceRecord[];
}

/**
 * Get performance records for all agents in a clinic
 */
async function getClinicAgentPerformance(
  clinicId: string,
  startDate?: string,
  endDate?: string
): Promise<AgentPerformanceRecord[]> {
  const params: any = {
    TableName: AGENT_PERFORMANCE_TABLE_NAME,
    IndexName: 'clinicId-periodDate-index',
    KeyConditionExpression: 'clinicId = :clinicId',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
    },
  };

  // Add date range filter if provided
  if (startDate && endDate) {
    params.KeyConditionExpression += ' AND periodDate BETWEEN :startDate AND :endDate';
    params.ExpressionAttributeValues[':startDate'] = startDate;
    params.ExpressionAttributeValues[':endDate'] = endDate;
  } else if (startDate) {
    params.KeyConditionExpression += ' AND periodDate >= :startDate';
    params.ExpressionAttributeValues[':startDate'] = startDate;
  } else if (endDate) {
    params.KeyConditionExpression += ' AND periodDate <= :endDate';
    params.ExpressionAttributeValues[':endDate'] = endDate;
  }

  const result = await ddb.send(new QueryCommand(params));
  return (result.Items || []) as AgentPerformanceRecord[];
}

/**
 * Get detailed call information for an agent
 */
async function getAgentCallDetails(
  agentId: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  // This would query the CallQueue table for calls handled by this agent
  // Implementation depends on having an agentId-index on the CallQueue table
  // For now, returning empty array - can be enhanced later
  console.log('[GetAgentPerformance] Call details requested for agent:', agentId);
  return [];
}

/**
 * Aggregate performance data across multiple periods
 */
function aggregatePerformanceData(records: AgentPerformanceRecord[]): any {
  if (records.length === 0) {
    return {
      totalCalls: 0,
      inboundCalls: 0,
      outboundCalls: 0,
      averageHandleTime: 0,
      averageSentiment: 0,
      performanceScore: 0,
    };
  }

  const totals = records.reduce((acc, record) => {
    return {
      totalCalls: acc.totalCalls + record.totalCalls,
      inboundCalls: acc.inboundCalls + record.inboundCalls,
      outboundCalls: acc.outboundCalls + record.outboundCalls,
      missedCalls: acc.missedCalls + record.missedCalls,
      rejectedCalls: acc.rejectedCalls + record.rejectedCalls,
      totalTalkTime: acc.totalTalkTime + record.totalTalkTime,
      totalHandleTime: acc.totalHandleTime + record.totalHandleTime,
      totalHoldTime: acc.totalHoldTime + record.totalHoldTime,
      callsTransferred: acc.callsTransferred + record.callsTransferred,
      callsCompleted: acc.callsCompleted + record.callsCompleted,
      sentimentScores: {
        positive: acc.sentimentScores.positive + record.sentimentScores.positive,
        neutral: acc.sentimentScores.neutral + record.sentimentScores.neutral,
        negative: acc.sentimentScores.negative + record.sentimentScores.negative,
        mixed: acc.sentimentScores.mixed + record.sentimentScores.mixed,
      },
    };
  }, {
    totalCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    missedCalls: 0,
    rejectedCalls: 0,
    totalTalkTime: 0,
    totalHandleTime: 0,
    totalHoldTime: 0,
    callsTransferred: 0,
    callsCompleted: 0,
    sentimentScores: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
  });

  // Calculate averages
  const averageHandleTime = totals.totalCalls > 0 
    ? totals.totalHandleTime / totals.totalCalls 
    : 0;

  const averageTalkTime = totals.totalCalls > 0 
    ? totals.totalTalkTime / totals.totalCalls 
    : 0;

  // FIXED FLAW #17: Sentiment calculation should account for negative sentiment properly
  // positive = 100, neutral = 50, negative = 0, mixed = 50
  const totalSentimentCalls =
    totals.sentimentScores.positive +
    totals.sentimentScores.neutral +
    totals.sentimentScores.negative +
    totals.sentimentScores.mixed;

  const averageSentiment = totalSentimentCalls > 0
    ? ((totals.sentimentScores.positive * 100 +
        totals.sentimentScores.neutral * 50 +
        totals.sentimentScores.negative * 0 +
        totals.sentimentScores.mixed * 50) / totalSentimentCalls)
    : 50;

  // Calculate performance score (0-100)
  // Factors: call completion rate, sentiment, rejection rate
  const completionRate = totals.totalCalls > 0
    ? (totals.callsCompleted / totals.totalCalls) * 100
    : 0;

  // FIXED FLAW #19: Check totalCalls > 0 before calculating rejection rate
  const rejectionRate = totals.totalCalls > 0
    ? (totals.rejectedCalls / totals.totalCalls) * 100
    : 0;

  // FIXED FLAW #18: Simplify Math.min/max nesting
  const performanceScore = Math.max(0, Math.min(100,
    (completionRate * 0.4) +
    (averageSentiment * 0.4) +
    ((100 - rejectionRate) * 0.2)
  ));

  return {
    period: {
      from: records[0]?.periodDate,
      to: records[records.length - 1]?.periodDate,
      days: records.length,
    },
    totalCalls: totals.totalCalls,
    inboundCalls: totals.inboundCalls,
    outboundCalls: totals.outboundCalls,
    missedCalls: totals.missedCalls,
    rejectedCalls: totals.rejectedCalls,
    callsTransferred: totals.callsTransferred,
    callsCompleted: totals.callsCompleted,
    // FIXED FLAW #20: Keep as numbers, round to 2 decimals but don't convert to string
    completionRate: Math.round(completionRate * 100) / 100,
    averageHandleTime: Math.round(averageHandleTime),
    averageTalkTime: Math.round(averageTalkTime),
    averageHoldTime: totals.totalCalls > 0
      ? Math.round(totals.totalHoldTime / totals.totalCalls)
      : 0,
    sentimentBreakdown: {
      positive: totals.sentimentScores.positive,
      neutral: totals.sentimentScores.neutral,
      negative: totals.sentimentScores.negative,
      mixed: totals.sentimentScores.mixed,
    },
    averageSentiment: Math.round(averageSentiment * 100) / 100,
    performanceScore: Math.round(performanceScore * 100) / 100,
    rating: getRatingFromScore(performanceScore),
  };
}

/**
 * Convert performance score to rating
 */
function getRatingFromScore(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Average';
  if (score >= 40) return 'Below Average';
  return 'Needs Improvement';
}


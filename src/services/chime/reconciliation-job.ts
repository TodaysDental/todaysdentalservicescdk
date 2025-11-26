/**
 * Reconciliation Job Lambda
 * 
 * Daily job to reconcile call analytics with agent performance metrics
 * Identifies and reports discrepancies between:
 * - Sum of call analytics records
 * - Aggregated agent performance metrics
 * 
 * Triggered by: EventBridge scheduled rule (daily at 2 AM UTC)
 */

import { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const ddb = getDynamoDBClient();
const sns = new SNSClient({});

const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME!;
const AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME!;
const ALERT_TOPIC_ARN = process.env.RECONCILIATION_ALERT_TOPIC_ARN;

interface ReconciliationDiscrepancy {
  agentId: string;
  date: string;
  callsInAnalytics: number;
  callsInPerformance: number;
  difference: number;
  percentageDiff: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  analyticsCallIds: string[];
  performanceCallIds: string[];
  missingInPerformance: string[];
  missingInAnalytics: string[];
}

interface ReconciliationReport {
  runDate: string;
  dateReconciled: string;
  totalAgentsChecked: number;
  discrepanciesFound: number;
  criticalIssues: number;
  discrepancies: ReconciliationDiscrepancy[];
  summary: {
    totalCallsInAnalytics: number;
    totalCallsInPerformance: number;
    totalDiscrepancy: number;
  };
}

/**
 * Main handler - runs daily reconciliation
 */
export const handler = async (event: any = {}): Promise<ReconciliationReport> => {
  console.log('[ReconciliationJob] Starting daily reconciliation');
  
  // Reconcile previous day (to ensure all data has been processed)
  const targetDate = event.targetDate || getPreviousDate();
  
  console.log('[ReconciliationJob] Reconciling date:', targetDate);
  
  // Get all agents who had calls on target date
  const agents = await getAgentsWithCallsOnDate(targetDate);
  
  console.log('[ReconciliationJob] Found agents with calls:', agents.length);
  
  const discrepancies: ReconciliationDiscrepancy[] = [];
  let totalAnalyticsCalls = 0;
  let totalPerformanceCalls = 0;
  
  // Check each agent
  for (const agentId of agents) {
    try {
      const discrepancy = await reconcileAgentMetrics(agentId, targetDate);
      
      if (discrepancy) {
        discrepancies.push(discrepancy);
        totalAnalyticsCalls += discrepancy.callsInAnalytics;
        totalPerformanceCalls += discrepancy.callsInPerformance;
        
        console.log('[ReconciliationJob] Discrepancy found for agent:', {
          agentId,
          difference: discrepancy.difference,
          severity: discrepancy.severity
        });
      }
    } catch (err: any) {
      console.error('[ReconciliationJob] Error reconciling agent:', {
        agentId,
        error: err.message
      });
    }
  }
  
  const criticalIssues = discrepancies.filter(d => d.severity === 'CRITICAL').length;
  
  const report: ReconciliationReport = {
    runDate: new Date().toISOString(),
    dateReconciled: targetDate,
    totalAgentsChecked: agents.length,
    discrepanciesFound: discrepancies.length,
    criticalIssues,
    discrepancies: discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)),
    summary: {
      totalCallsInAnalytics: totalAnalyticsCalls,
      totalCallsInPerformance: totalPerformanceCalls,
      totalDiscrepancy: totalAnalyticsCalls - totalPerformanceCalls
    }
  };
  
  // Store report
  await storeReconciliationReport(report);
  
  // Send alerts if critical issues found
  if (criticalIssues > 0 && ALERT_TOPIC_ARN) {
    await sendAlert(report);
  }
  
  console.log('[ReconciliationJob] Reconciliation complete:', {
    discrepancies: discrepancies.length,
    critical: criticalIssues
  });
  
  return report;
};

/**
 * Get previous date in YYYY-MM-DD format (UTC)
 */
function getPreviousDate(): string {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Get all agents who had calls on a specific date
 */
async function getAgentsWithCallsOnDate(date: string): Promise<string[]> {
  const startTimestamp = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
  const endTimestamp = Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000);
  
  const agents = new Set<string>();
  let lastEvaluatedKey: any = undefined;
  
  do {
    const scanResult = await ddb.send(new ScanCommand({
      TableName: ANALYTICS_TABLE,
      FilterExpression: '#ts BETWEEN :start AND :end AND attribute_exists(agentId)',
      ProjectionExpression: 'agentId',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: {
        ':start': startTimestamp,
        ':end': endTimestamp
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));
    
    scanResult.Items?.forEach(item => {
      if (item.agentId) {
        agents.add(item.agentId);
      }
    });
    
    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  
  return Array.from(agents);
}

/**
 * Reconcile metrics for a specific agent on a specific date
 */
async function reconcileAgentMetrics(
  agentId: string,
  date: string
): Promise<ReconciliationDiscrepancy | null> {
  // Get call analytics for agent on date
  const analyticsCallIds = await getAnalyticsCallsForAgent(agentId, date);
  
  // Get agent performance record for date
  const performanceRecord = await getAgentPerformanceForDate(agentId, date);
  const performanceCallIds = performanceRecord?.callIds || [];
  
  const callsInAnalytics = analyticsCallIds.length;
  const callsInPerformance = performanceRecord?.totalCalls || 0;
  const difference = callsInAnalytics - callsInPerformance;
  
  // No discrepancy if counts match
  if (difference === 0 && callsInAnalytics === callsInPerformance) {
    return null;
  }
  
  // Find missing calls
  const analyticsSet = new Set(analyticsCallIds);
  const performanceSet = new Set(performanceCallIds);
  
  const missingInPerformance = analyticsCallIds.filter(id => !performanceSet.has(id));
  const missingInAnalytics = performanceCallIds.filter((id: string) => !analyticsSet.has(id));
  
  // Calculate severity
  const percentageDiff = callsInAnalytics > 0 
    ? Math.abs((difference / callsInAnalytics) * 100)
    : 100;
  
  let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  if (percentageDiff < 5) {
    severity = 'LOW';
  } else if (percentageDiff < 15) {
    severity = 'MEDIUM';
  } else if (percentageDiff < 30) {
    severity = 'HIGH';
  } else {
    severity = 'CRITICAL';
  }
  
  return {
    agentId,
    date,
    callsInAnalytics,
    callsInPerformance,
    difference,
    percentageDiff,
    severity,
    analyticsCallIds,
    performanceCallIds,
    missingInPerformance,
    missingInAnalytics
  };
}

/**
 * Get all call IDs for an agent on a specific date from analytics table
 */
async function getAnalyticsCallsForAgent(agentId: string, date: string): Promise<string[]> {
  const startTimestamp = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
  const endTimestamp = Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000);
  
  const callIds: string[] = [];
  let lastEvaluatedKey: any = undefined;
  
  do {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: ANALYTICS_TABLE,
      IndexName: 'agentId-timestamp-index',
      KeyConditionExpression: 'agentId = :agentId AND #ts BETWEEN :start AND :end',
      ProjectionExpression: 'callId',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: {
        ':agentId': agentId,
        ':start': startTimestamp,
        ':end': endTimestamp
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));
    
    queryResult.Items?.forEach(item => {
      if (item.callId) {
        callIds.push(item.callId);
      }
    });
    
    lastEvaluatedKey = queryResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  
  return callIds;
}

/**
 * Get agent performance record for a specific date
 */
async function getAgentPerformanceForDate(agentId: string, date: string): Promise<any | null> {
  const result = await ddb.send(new GetCommand({
    TableName: AGENT_PERFORMANCE_TABLE,
    Key: {
      agentId,
      periodDate: date
    }
  }));
  
  return result.Item || null;
}

/**
 * Store reconciliation report in DynamoDB
 */
async function storeReconciliationReport(report: ReconciliationReport): Promise<void> {
  const RECONCILIATION_TABLE = process.env.RECONCILIATION_TABLE_NAME || `${ANALYTICS_TABLE}-reconciliation`;
  
  try {
    await ddb.send(new UpdateCommand({
      TableName: RECONCILIATION_TABLE,
      Key: {
        reportDate: report.dateReconciled,
        reportType: 'daily'
      },
      UpdateExpression: `
        SET runDate = :runDate,
            totalAgentsChecked = :totalAgents,
            discrepanciesFound = :discrepancies,
            criticalIssues = :critical,
            discrepancyDetails = :details,
            summary = :summary,
            ttl = :ttl
      `,
      ExpressionAttributeValues: {
        ':runDate': report.runDate,
        ':totalAgents': report.totalAgentsChecked,
        ':discrepancies': report.discrepanciesFound,
        ':critical': report.criticalIssues,
        ':details': report.discrepancies,
        ':summary': report.summary,
        ':ttl': Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days retention
      }
    }));
  } catch (err: any) {
    console.error('[ReconciliationJob] Failed to store report:', err.message);
  }
}

/**
 * Send alert for critical discrepancies
 */
async function sendAlert(report: ReconciliationReport): Promise<void> {
  const criticalDiscrepancies = report.discrepancies.filter(d => d.severity === 'CRITICAL');
  
  const message = {
    subject: `[CRITICAL] Call Analytics Reconciliation Issues - ${report.dateReconciled}`,
    summary: {
      date: report.dateReconciled,
      criticalIssues: report.criticalIssues,
      totalDiscrepancies: report.discrepanciesFound,
      totalAgentsAffected: criticalDiscrepancies.length
    },
    criticalIssues: criticalDiscrepancies.map(d => ({
      agentId: d.agentId,
      callsInAnalytics: d.callsInAnalytics,
      callsInPerformance: d.callsInPerformance,
      difference: d.difference,
      percentageDiff: `${d.percentageDiff.toFixed(1)}%`,
      missingInPerformance: d.missingInPerformance.length,
      missingInAnalytics: d.missingInAnalytics.length
    })),
    action: 'Please investigate and run data recovery process if needed'
  };
  
  try {
    await sns.send(new PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: message.subject,
      Message: JSON.stringify(message, null, 2)
    }));
    
    console.log('[ReconciliationJob] Alert sent successfully');
  } catch (err: any) {
    console.error('[ReconciliationJob] Failed to send alert:', err.message);
  }
}


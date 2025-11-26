/**
 * Agent Performance DLQ Handler
 * 
 * Handles failures in agent performance metric tracking
 * Sends failed events to DLQ for retry or manual review
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

const sqs = new SQSClient({});
const sns = new SNSClient({});

export interface AgentPerformanceFailure {
  callId: string;
  agentId: string;
  clinicId: string;
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  metrics: any; // The metrics that failed to track
  timestamp: string;
  attemptCount: number;
}

/**
 * Send failed agent performance update to DLQ
 */
export async function sendToPerformanceDLQ(
  failure: AgentPerformanceFailure,
  dlqUrl?: string
): Promise<void> {
  const queueUrl = dlqUrl || process.env.AGENT_PERFORMANCE_DLQ_URL;
  
  if (!queueUrl) {
    console.error('[PerformanceDLQ] No DLQ URL configured, cannot send failure');
    return;
  }

  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(failure),
      MessageAttributes: {
        callId: {
          DataType: 'String',
          StringValue: failure.callId
        },
        agentId: {
          DataType: 'String',
          StringValue: failure.agentId
        },
        errorCode: {
          DataType: 'String',
          StringValue: failure.error.code || 'UNKNOWN'
        },
        attemptCount: {
          DataType: 'Number',
          StringValue: failure.attemptCount.toString()
        }
      }
    }));

    console.log('[PerformanceDLQ] Sent failure to DLQ:', {
      callId: failure.callId,
      agentId: failure.agentId,
      error: failure.error.message
    });
  } catch (err) {
    console.error('[PerformanceDLQ] Error sending to DLQ:', err);
    // Last resort - send to CloudWatch
    console.error('[PerformanceDLQ] CRITICAL FAILURE:', JSON.stringify(failure));
  }
}

/**
 * Send alert for critical agent performance failures
 */
export async function sendPerformanceAlert(
  failure: AgentPerformanceFailure,
  snsTopicArn?: string
): Promise<void> {
  const topicArn = snsTopicArn || process.env.AGENT_PERFORMANCE_ALERT_TOPIC_ARN;
  
  if (!topicArn) {
    console.warn('[PerformanceAlert] No alert topic configured');
    return;
  }

  try {
    await sns.send(new PublishCommand({
      TopicArn: topicArn,
      Subject: `Agent Performance Tracking Failure - ${failure.agentId}`,
      Message: JSON.stringify({
        severity: 'HIGH',
        component: 'AgentPerformanceTracker',
        callId: failure.callId,
        agentId: failure.agentId,
        clinicId: failure.clinicId,
        error: failure.error.message,
        timestamp: failure.timestamp,
        attemptCount: failure.attemptCount
      }, null, 2),
      MessageAttributes: {
        severity: {
          DataType: 'String',
          StringValue: 'HIGH'
        },
        component: {
          DataType: 'String',
          StringValue: 'AgentPerformanceTracker'
        }
      }
    }));

    console.log('[PerformanceAlert] Sent alert for failure:', failure.callId);
  } catch (err) {
    console.error('[PerformanceAlert] Error sending alert:', err);
  }
}

/**
 * Process a batch of failures from DLQ
 * Used by DLQ processor Lambda
 */
export async function processPerformanceDLQBatch(
  failures: AgentPerformanceFailure[],
  retryHandler: (failure: AgentPerformanceFailure) => Promise<boolean>
): Promise<{
  successful: number;
  failed: number;
  permanent: AgentPerformanceFailure[];
}> {
  const results = {
    successful: 0,
    failed: 0,
    permanent: [] as AgentPerformanceFailure[]
  };

  for (const failure of failures) {
    try {
      // Attempt retry
      const success = await retryHandler(failure);
      
      if (success) {
        results.successful++;
      } else {
        results.failed++;
        
        // After 3 attempts, mark as permanent failure
        if (failure.attemptCount >= 3) {
          results.permanent.push(failure);
          console.error('[PerformanceDLQ] Permanent failure after 3 attempts:', {
            callId: failure.callId,
            agentId: failure.agentId
          });
        }
      }
    } catch (err) {
      console.error('[PerformanceDLQ] Error processing failure:', err);
      results.failed++;
    }
  }

  return results;
}

/**
 * Store permanent failures for manual review
 */
export async function storePermanentFailure(
  failure: AgentPerformanceFailure,
  tableName: string,
  ddb: any
): Promise<void> {
  try {
    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: {
        failureId: `${failure.callId}-${failure.agentId}-${Date.now()}`,
        callId: failure.callId,
        agentId: failure.agentId,
        clinicId: failure.clinicId,
        error: failure.error,
        metrics: failure.metrics,
        timestamp: failure.timestamp,
        attemptCount: failure.attemptCount,
        storedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days
      }
    }));

    console.log('[PerformanceDLQ] Stored permanent failure:', failure.callId);
  } catch (err) {
    console.error('[PerformanceDLQ] Error storing permanent failure:', err);
  }
}


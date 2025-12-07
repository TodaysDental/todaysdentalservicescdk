/**
 * Agent Performance DLQ Processor
 * 
 * Processes failed agent performance tracking messages from the DLQ.
 * Attempts to retry the failed operations and logs permanent failures
 * to the failures table for manual review.
 * 
 * Triggered by: SQS event source from agent-performance-dlq
 */

import { SQSEvent, SQSRecord, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { trackEnhancedCallMetrics } from '../shared/utils/enhanced-agent-metrics';

const ddb = getDynamoDBClient();
const sns = new SNSClient({});

const AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;
const FAILURES_TABLE = process.env.AGENT_PERFORMANCE_FAILURES_TABLE_NAME;
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN;

// Maximum retry attempts before marking as permanent failure
const MAX_RETRY_ATTEMPTS = 3;

interface AgentPerformanceFailure {
  callId: string;
  agentId: string;
  clinicId: string;
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  metrics: {
    direction: string;
    duration: number;
    sentiment?: string;
    sentimentScore?: number;
  };
  timestamp: string;
  attemptCount: number;
}

/**
 * Main handler for DLQ processing
 * Uses partial batch response to handle individual message failures
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log('[DLQProcessor] Processing batch', {
    recordCount: event.Records.length,
    timestamp: new Date().toISOString()
  });

  const batchItemFailures: SQSBatchItemFailure[] = [];
  const results = {
    retried: 0,
    permanentFailures: 0,
    errors: 0
  };

  for (const record of event.Records) {
    try {
      const processed = await processRecord(record);
      
      if (processed === 'RETRIED') {
        results.retried++;
      } else if (processed === 'PERMANENT_FAILURE') {
        results.permanentFailures++;
      }
    } catch (err: any) {
      console.error('[DLQProcessor] Error processing record:', {
        messageId: record.messageId,
        error: err.message,
        stack: err.stack
      });
      
      // Add to batch failures for retry
      batchItemFailures.push({
        itemIdentifier: record.messageId
      });
      results.errors++;
    }
  }

  console.log('[DLQProcessor] Batch complete:', results);

  return {
    batchItemFailures
  };
};

/**
 * Process a single DLQ record
 */
async function processRecord(record: SQSRecord): Promise<'RETRIED' | 'PERMANENT_FAILURE' | 'SKIPPED'> {
  let failure: AgentPerformanceFailure;
  
  try {
    failure = JSON.parse(record.body);
  } catch (parseErr) {
    console.error('[DLQProcessor] Failed to parse message body:', {
      messageId: record.messageId,
      body: record.body
    });
    // Store as permanent failure with parse error
    await storePermanentFailure({
      callId: 'unknown',
      agentId: 'unknown',
      clinicId: 'unknown',
      error: {
        message: 'Failed to parse DLQ message',
        code: 'PARSE_ERROR'
      },
      metrics: {
        direction: 'unknown',
        duration: 0
      },
      timestamp: new Date().toISOString(),
      attemptCount: 999
    }, 'PARSE_ERROR', record.body);
    return 'PERMANENT_FAILURE';
  }

  const receiveCount = parseInt(record.attributes?.ApproximateReceiveCount || '1', 10);
  const totalAttempts = (failure.attemptCount || 0) + receiveCount;

  console.log('[DLQProcessor] Processing failure:', {
    callId: failure.callId,
    agentId: failure.agentId,
    originalAttempts: failure.attemptCount,
    dlqReceiveCount: receiveCount,
    totalAttempts
  });

  // Check if we should retry or mark as permanent failure
  if (totalAttempts >= MAX_RETRY_ATTEMPTS) {
    console.log('[DLQProcessor] Max retries exceeded, storing permanent failure:', failure.callId);
    await storePermanentFailure(failure, 'MAX_RETRIES_EXCEEDED');
    await sendAlert(failure, 'MAX_RETRIES_EXCEEDED');
    return 'PERMANENT_FAILURE';
  }

  // Validate required data
  if (!failure.agentId || !failure.clinicId || !AGENT_PERFORMANCE_TABLE) {
    console.error('[DLQProcessor] Missing required data:', {
      hasAgentId: !!failure.agentId,
      hasClinicId: !!failure.clinicId,
      hasTable: !!AGENT_PERFORMANCE_TABLE
    });
    await storePermanentFailure(failure, 'MISSING_DATA');
    return 'PERMANENT_FAILURE';
  }

  // Attempt to retry the metrics tracking
  try {
    await trackEnhancedCallMetrics(ddb, AGENT_PERFORMANCE_TABLE, {
      agentId: failure.agentId,
      clinicId: failure.clinicId,
      callId: failure.callId,
      direction: failure.metrics.direction as 'inbound' | 'outbound',
      duration: failure.metrics.duration || 0,
      talkTime: failure.metrics.duration || 0,
      holdTime: 0,
      sentiment: failure.metrics.sentiment,
      sentimentScore: failure.metrics.sentimentScore,
      transferred: false,
      escalated: false,
      issues: [],
      timestamp: new Date(failure.timestamp).getTime()
    });

    console.log('[DLQProcessor] Successfully retried metrics tracking:', {
      callId: failure.callId,
      agentId: failure.agentId,
      attempt: totalAttempts
    });

    return 'RETRIED';

  } catch (retryErr: any) {
    console.error('[DLQProcessor] Retry failed:', {
      callId: failure.callId,
      error: retryErr.message
    });

    // Update failure with new error and re-throw to trigger SQS retry
    failure.error = {
      message: retryErr.message,
      stack: retryErr.stack,
      code: retryErr.code || retryErr.name
    };
    failure.attemptCount = totalAttempts;

    throw retryErr;
  }
}

/**
 * Store a permanent failure record for manual review
 */
async function storePermanentFailure(
  failure: AgentPerformanceFailure,
  reason: string,
  rawBody?: string
): Promise<void> {
  if (!FAILURES_TABLE) {
    console.error('[DLQProcessor] FAILURES_TABLE not configured, logging to CloudWatch');
    console.error('PERMANENT_FAILURE', JSON.stringify({
      ...failure,
      permanentFailureReason: reason,
      rawBody
    }));
    return;
  }

  const failureId = `${failure.callId}-${Date.now()}`;
  const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days

  try {
    await ddb.send(new PutCommand({
      TableName: FAILURES_TABLE,
      Item: {
        failureId,
        callId: failure.callId,
        agentId: failure.agentId,
        clinicId: failure.clinicId,
        error: failure.error,
        metrics: failure.metrics,
        originalTimestamp: failure.timestamp,
        permanentFailureReason: reason,
        attemptCount: failure.attemptCount,
        storedAt: new Date().toISOString(),
        rawBody: rawBody,
        ttl
      }
    }));

    console.log('[DLQProcessor] Stored permanent failure:', {
      failureId,
      callId: failure.callId,
      reason
    });

  } catch (err: any) {
    console.error('[DLQProcessor] Failed to store permanent failure:', {
      error: err.message,
      callId: failure.callId
    });
    
    // Last resort: log to CloudWatch
    console.error('PERMANENT_FAILURE_UNRECOVERABLE', JSON.stringify({
      ...failure,
      permanentFailureReason: reason,
      storeError: err.message
    }));
  }
}

/**
 * Send alert for permanent failures
 */
async function sendAlert(failure: AgentPerformanceFailure, reason: string): Promise<void> {
  if (!ALERT_TOPIC_ARN) {
    console.warn('[DLQProcessor] ALERT_TOPIC_ARN not configured, skipping alert');
    return;
  }

  try {
    await sns.send(new PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: `[ALERT] Agent Performance Tracking Failure - ${failure.agentId}`,
      Message: JSON.stringify({
        alertType: 'AGENT_PERFORMANCE_TRACKING_FAILURE',
        severity: 'HIGH',
        callId: failure.callId,
        agentId: failure.agentId,
        clinicId: failure.clinicId,
        reason,
        error: failure.error.message,
        attemptCount: failure.attemptCount,
        timestamp: new Date().toISOString(),
        action: 'Manual review required. Check AgentPerformanceFailures table for details.'
      }, null, 2),
      MessageAttributes: {
        alertType: {
          DataType: 'String',
          StringValue: 'AGENT_PERFORMANCE_TRACKING_FAILURE'
        },
        severity: {
          DataType: 'String',
          StringValue: 'HIGH'
        }
      }
    }));

    console.log('[DLQProcessor] Alert sent for failure:', failure.callId);

  } catch (err: any) {
    console.error('[DLQProcessor] Failed to send alert:', {
      error: err.message,
      callId: failure.callId
    });
  }
}

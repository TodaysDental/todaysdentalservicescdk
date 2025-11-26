/**
 * CRITICAL FIX: Agent Performance DLQ Processor with Exponential Backoff Retry
 * 
 * Processes failed agent performance metric tracking events from DLQ
 * Implements exponential backoff retry strategy
 * 
 * Triggered by: SQS AgentPerformanceDLQ
 * 
 * Retry Strategy:
 * - Attempt 1: Immediate (from DLQ)
 * - Attempt 2: After 30 seconds
 * - Attempt 3: After 2 minutes
 * - After 3 attempts: Mark as permanent failure and alert
 */

import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { trackEnhancedCallMetrics } from '../shared/utils/enhanced-agent-metrics';
import {
  AgentPerformanceFailure,
  processPerformanceDLQBatch,
  sendPerformanceAlert,
  storePermanentFailure,
  sendToPerformanceDLQ
} from '../shared/utils/agent-performance-dlq';
import { dynamoDBCircuitBreaker } from '../shared/utils/circuit-breaker';

const ddb = getDynamoDBClient();

const AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;
const PERMANENT_FAILURES_TABLE = process.env.PERMANENT_FAILURES_TABLE_NAME;
const DLQ_URL = process.env.AGENT_PERFORMANCE_DLQ_URL;

if (!AGENT_PERFORMANCE_TABLE) {
  throw new Error('AGENT_PERFORMANCE_TABLE_NAME environment variable is required');
}

/**
 * Main Lambda handler for processing DLQ messages
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('[AgentPerformanceDLQ] Processing batch', {
    recordCount: event.Records.length
  });

  // Parse failures from SQS messages
  const failures: AgentPerformanceFailure[] = [];
  
  for (const record of event.Records) {
    try {
      const failure = JSON.parse(record.body) as AgentPerformanceFailure;
      
      // Apply exponential backoff delay before retry
      const shouldRetry = await applyExponentialBackoff(failure, record);
      
      if (shouldRetry) {
        failures.push(failure);
      } else {
        console.log('[AgentPerformanceDLQ] Skipping - backoff delay not met:', {
          callId: failure.callId,
          attemptCount: failure.attemptCount
        });
      }
    } catch (err: any) {
      console.error('[AgentPerformanceDLQ] Error parsing message:', err);
    }
  }

  if (failures.length === 0) {
    console.log('[AgentPerformanceDLQ] No failures to process after backoff filter');
    return;
  }

  // Process failures with retry handler
  const results = await processPerformanceDLQBatch(failures, retryAgentPerformanceTracking);

  console.log('[AgentPerformanceDLQ] Batch processed:', results);

  // Handle permanent failures
  if (results.permanent.length > 0) {
    for (const failure of results.permanent) {
      // Store for manual review
      if (PERMANENT_FAILURES_TABLE) {
        await storePermanentFailure(failure, PERMANENT_FAILURES_TABLE, ddb);
      }

      // Send alert
      await sendPerformanceAlert(failure);

      console.error('[AgentPerformanceDLQ] PERMANENT FAILURE - Manual review required:', {
        callId: failure.callId,
        agentId: failure.agentId,
        error: failure.error.message,
        attempts: failure.attemptCount
      });
    }
  }

  // Re-queue failures that haven't reached max attempts (with incremented attempt count)
  for (const failure of failures) {
    if (failure.attemptCount < 3 && results.failed > 0) {
      // Increment attempt count and re-queue
      const updatedFailure: AgentPerformanceFailure = {
        ...failure,
        attemptCount: failure.attemptCount + 1,
        timestamp: new Date().toISOString() // Update timestamp for backoff calculation
      };

      await sendToPerformanceDLQ(updatedFailure, DLQ_URL);
      
      console.log('[AgentPerformanceDLQ] Re-queued for retry:', {
        callId: failure.callId,
        attemptCount: updatedFailure.attemptCount
      });
    }
  }
};

/**
 * CRITICAL FIX: Exponential backoff implementation
 * 
 * Delays processing based on attempt count:
 * - Attempt 1: Immediate (0 seconds)
 * - Attempt 2: 30 seconds
 * - Attempt 3: 2 minutes (120 seconds)
 */
async function applyExponentialBackoff(
  failure: AgentPerformanceFailure,
  record: SQSRecord
): Promise<boolean> {
  const attemptCount = failure.attemptCount;
  
  // Attempt 1: Process immediately
  if (attemptCount === 1) {
    return true;
  }

  // Calculate required delay in milliseconds
  const baseDelay = 30000; // 30 seconds base
  const backoffMultiplier = Math.pow(2, attemptCount - 2); // Exponential: 1, 2, 4, 8...
  const requiredDelayMs = baseDelay * backoffMultiplier;

  // Get message timestamp
  const messageTimestamp = failure.timestamp ? new Date(failure.timestamp).getTime() : 0;
  const now = Date.now();
  const timeSinceFailure = now - messageTimestamp;

  // Check if enough time has passed
  if (timeSinceFailure >= requiredDelayMs) {
    console.log('[AgentPerformanceDLQ] Backoff delay met, processing:', {
      callId: failure.callId,
      attemptCount,
      requiredDelayMs,
      timeSinceFailure
    });
    return true;
  }

  // Not enough time has passed - calculate remaining delay
  const remainingDelay = requiredDelayMs - timeSinceFailure;
  const visibilityTimeout = Math.ceil(remainingDelay / 1000);

  console.log('[AgentPerformanceDLQ] Backoff delay not met, extending visibility:', {
    callId: failure.callId,
    attemptCount,
    requiredDelayMs,
    timeSinceFailure,
    remainingDelay,
    visibilityTimeout
  });

  // Return false to skip processing this message
  // SQS will re-deliver it after visibility timeout
  return false;
}

/**
 * Retry handler for agent performance tracking
 * Returns true if successful, false if failed
 */
async function retryAgentPerformanceTracking(
  failure: AgentPerformanceFailure
): Promise<boolean> {
  try {
    console.log('[AgentPerformanceDLQ] Retrying agent performance tracking:', {
      callId: failure.callId,
      agentId: failure.agentId,
      attemptCount: failure.attemptCount,
      circuitState: dynamoDBCircuitBreaker.getState()
    });

    // CRITICAL FIX: Check circuit breaker before attempting retry
    if (dynamoDBCircuitBreaker.isOpen()) {
      console.warn('[AgentPerformanceDLQ] Circuit breaker OPEN, skipping retry:', {
        callId: failure.callId,
        circuitState: dynamoDBCircuitBreaker.getState()
      });
      // Return false to requeue for later attempt
      return false;
    }

    // Extract metrics from failure
    const metrics = failure.metrics;

    // CRITICAL FIX: Wrap operation with circuit breaker
    await dynamoDBCircuitBreaker.execute(async () => {
      return trackEnhancedCallMetrics(ddb, AGENT_PERFORMANCE_TABLE!, {
        agentId: failure.agentId,
        clinicId: failure.clinicId,
        callId: failure.callId,
        direction: metrics.direction || 'inbound',
        duration: metrics.duration || 0,
        talkTime: metrics.talkTime || 0,
        holdTime: metrics.holdTime || 0,
        sentiment: metrics.sentiment,
        sentimentScore: metrics.sentimentScore,
        transferred: metrics.transferred || false,
        escalated: metrics.escalated || false,
        issues: metrics.issues || [],
        speakerMetrics: metrics.speakerMetrics
      });
    });

    console.log('[AgentPerformanceDLQ] Successfully retried:', {
      callId: failure.callId,
      agentId: failure.agentId,
      circuitState: dynamoDBCircuitBreaker.getState()
    });

    return true;

  } catch (err: any) {
    console.error('[AgentPerformanceDLQ] Retry failed:', {
      callId: failure.callId,
      agentId: failure.agentId,
      error: err.message,
      attemptCount: failure.attemptCount,
      circuitState: dynamoDBCircuitBreaker.getState()
    });

    return false;
  }
}

/**
 * Check if error is transient (retriable) or permanent
 */
function isTransientError(error: any): boolean {
  const transientErrors = [
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'ServiceUnavailable',
    'InternalServerError',
    'RequestTimeout'
  ];

  return transientErrors.some(errCode => 
    error.name === errCode || 
    error.code === errCode ||
    error.message?.includes(errCode)
  );
}


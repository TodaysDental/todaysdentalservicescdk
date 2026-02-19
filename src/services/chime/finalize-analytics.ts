/**
 * Analytics Finalization Lambda
 * 
 * Runs periodically to finalize analytics records that have been scheduled for finalization.
 * This provides a buffer window for out-of-order events to arrive before marking records as complete.
 * 
 * Triggered by: EventBridge scheduled rule (every 1 minute)
 */

import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand, TransactWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { trackEnhancedCallMetrics } from '../shared/utils/enhanced-agent-metrics';

import { sendToPerformanceDLQ, AgentPerformanceFailure } from '../shared/utils/agent-performance-dlq';
import { AnalyticsState } from '../../types/analytics-state-machine';
import { transitionAnalyticsState, acquireAnalyticsLock, releaseAnalyticsLock, cleanupExpiredLock } from '../shared/utils/analytics-state-manager';
import { getTranscriptBufferManager } from '../shared/utils/transcript-buffer-manager';

// CRITICAL FIX #8: Persistent circuit breaker state using dedicated DynamoDB table
// In-memory circuit breaker state is lost on Lambda cold starts, defeating its purpose.
// IMPORTANT: Use a dedicated table or the dedup table to avoid polluting analytics data
// Using analytics table with magic keys breaks GSI queries and is an anti-pattern.

const CIRCUIT_BREAKER_THRESHOLD = 5; // Open after 5 consecutive failures
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute cooldown
// CRITICAL FIX #8 & #3.2: Use dedup table with explicit validation
// The dedup table is designed for operational state with TTL cleanup
const CIRCUIT_BREAKER_TABLE = process.env.ANALYTICS_DEDUP_TABLE_NAME || process.env.ANALYTICS_DEDUP_TABLE;

// CRITICAL FIX #3.2: Validate circuit breaker table is configured
if (!CIRCUIT_BREAKER_TABLE) {
  console.warn('[finalize-analytics] CIRCUIT_BREAKER_TABLE not configured - circuit breaker will be disabled');
}

// CRITICAL FIX #3.1: Maximum continuation depth to prevent infinite loop
const MAX_CONTINUATION_DEPTH = parseInt(process.env.MAX_CONTINUATION_DEPTH || '10', 10);

// CRITICAL FIX #3.4: Lock retry configuration
const LOCK_RETRY_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 1000;

interface PersistentCircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  lastUpdated: number;
}

/**
 * Get circuit breaker state from DynamoDB
 * CRITICAL FIX #8: Uses dedup table with eventId as partition key (no sort key)
 * This avoids polluting the analytics table and its GSIs
 */
async function getCircuitBreakerState(breakerKey: string): Promise<PersistentCircuitBreakerState> {
  const defaultState: PersistentCircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    lastUpdated: Date.now()
  };

  if (!CIRCUIT_BREAKER_TABLE) {
    console.warn('[CircuitBreaker] No table configured, using default state');
    return defaultState;
  }

  try {
    // CRITICAL FIX #8: Use eventId as partition key (matches dedup table schema)
    const result = await ddb.send(new GetCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: {
        eventId: `__circuit_breaker__${breakerKey}` // Uses dedup table's partition key
      }
    }));

    if (result.Item) {
      return {
        failures: result.Item.failures || 0,
        lastFailure: result.Item.lastFailure || 0,
        isOpen: result.Item.isOpen || false,
        lastUpdated: result.Item.lastUpdated || Date.now()
      };
    }
  } catch (err: any) {
    console.warn('[CircuitBreaker] Failed to read state:', err.message);
  }

  return defaultState;
}

/**
 * Update circuit breaker state in DynamoDB
 * CRITICAL FIX #8: Uses dedup table with eventId as partition key
 */
async function updateCircuitBreakerState(
  breakerKey: string,
  state: PersistentCircuitBreakerState
): Promise<void> {
  if (!CIRCUIT_BREAKER_TABLE) {
    return;
  }

  try {
    // CRITICAL FIX #8: Use PutCommand for dedup table (simpler schema)
    await ddb.send(new UpdateCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: {
        eventId: `__circuit_breaker__${breakerKey}` // Uses dedup table's partition key
      },
      UpdateExpression: 'SET failures = :failures, lastFailure = :lastFailure, isOpen = :isOpen, lastUpdated = :lastUpdated, #ttl = :ttl, #type = :type',
      ExpressionAttributeNames: {
        '#ttl': 'ttl',
        '#type': 'recordType' // Mark as circuit breaker for debugging
      },
      ExpressionAttributeValues: {
        ':failures': state.failures,
        ':lastFailure': state.lastFailure,
        ':isOpen': state.isOpen,
        ':lastUpdated': Date.now(),
        ':ttl': Math.floor(Date.now() / 1000) + (24 * 60 * 60), // Expire after 24 hours
        ':type': 'circuit_breaker'
      }
    }));
  } catch (err: any) {
    console.warn('[CircuitBreaker] Failed to update state:', err.message);
    // Non-fatal - continue with operation
  }
}

async function sendToPerformanceDLQWithCircuitBreaker(
  failure: AgentPerformanceFailure,
  callId: string,
  agentId: string,
  clinicId: string
): Promise<void> {
  const breakerKey = `dlq-${agentId}`;

  // CRITICAL FIX: Load state from DynamoDB instead of in-memory map
  let breaker = await getCircuitBreakerState(breakerKey);

  // Check if circuit is open
  if (breaker.isOpen) {
    const timeSinceLastFailure = Date.now() - breaker.lastFailure;

    if (timeSinceLastFailure < CIRCUIT_BREAKER_TIMEOUT) {
      console.error('[finalize-analytics] Circuit breaker OPEN - skipping DLQ send', {
        callId,
        agentId,
        failureCount: breaker.failures,
        cooldownRemaining: CIRCUIT_BREAKER_TIMEOUT - timeSinceLastFailure
      });

      // Log to CloudWatch for recovery
      console.error('PERFORMANCE_METRICS_LOSS', JSON.stringify({
        type: 'METRICS_TRACKING_FAILURE',
        severity: 'CRITICAL',
        reason: 'CIRCUIT_BREAKER_OPEN',
        callId,
        agentId,
        clinicId,
        metrics: failure.metrics,
        error: failure.error,
        timestamp: failure.timestamp,
        canRecover: true,
        recoveryQuery: `fields @timestamp, callId, agentId, metrics | filter type = "METRICS_TRACKING_FAILURE" and callId = "${callId}"`
      }));
      return;
    }

    // Timeout expired - move to half-open
    console.log('[finalize-analytics] Circuit breaker entering HALF-OPEN state:', { agentId });
    breaker.isOpen = false;
    await updateCircuitBreakerState(breakerKey, breaker);
  }

  // Attempt to send to DLQ
  try {
    await sendToPerformanceDLQ(failure);

    // Success - reset circuit breaker
    breaker.failures = 0;
    breaker.lastFailure = 0;
    breaker.isOpen = false;
    await updateCircuitBreakerState(breakerKey, breaker);
    console.log('[finalize-analytics] DLQ send successful, circuit breaker reset:', { agentId });

  } catch (dlqErr: any) {
    breaker.failures++;
    breaker.lastFailure = Date.now();

    console.error('[finalize-analytics] DLQ send failed', {
      callId,
      agentId,
      failureCount: breaker.failures,
      error: dlqErr.message
    });

    // Check if we should open the circuit
    if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      breaker.isOpen = true;
      console.error('[finalize-analytics] Circuit breaker OPENED after repeated failures', {
        agentId,
        failures: breaker.failures,
        threshold: CIRCUIT_BREAKER_THRESHOLD
      });
    }

    // Persist the updated state
    await updateCircuitBreakerState(breakerKey, breaker);

    // Last resort: Log to CloudWatch for recovery
    console.error('PERFORMANCE_METRICS_LOSS', JSON.stringify({
      type: 'METRICS_TRACKING_FAILURE',
      severity: 'CRITICAL',
      callId,
      agentId,
      clinicId,
      metrics: failure.metrics,
      error: failure.error,
      timestamp: failure.timestamp,
      canRecover: true,
      circuitBreakerState: {
        failures: breaker.failures,
        isOpen: breaker.isOpen
      },
      recoveryQuery: `fields @timestamp, callId, agentId, metrics | filter type = "METRICS_TRACKING_FAILURE" and callId = "${callId}"`
    }));
  }
}

const ddb = getDynamoDBClient();
const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
const AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;

// CRITICAL FIX #3.3 & #7: Require explicit TRANSCRIPT_BUFFER_TABLE_NAME - remove fragile derivation
// The AnalyticsStack should always pass this env var explicitly
const TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME;

// CRITICAL FIX #3.3: Warn loudly if not configured, but don't use fragile derivation
if (!TRANSCRIPT_BUFFER_TABLE) {
  console.error(
    '[finalize-analytics] CRITICAL: TRANSCRIPT_BUFFER_TABLE_NAME not configured. ' +
    'Transcript cleanup will be SKIPPED. Update AnalyticsStack to pass this env var explicitly.'
  );
}

// Initialize transcript buffer manager for cleanup (only if table is configured)
const transcriptManager = TRANSCRIPT_BUFFER_TABLE
  ? getTranscriptBufferManager(ddb, TRANSCRIPT_BUFFER_TABLE)
  : null;

if (!ANALYTICS_TABLE) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}
// AGENT_PERFORMANCE_TABLE is optional - enhanced metrics won't be tracked if not configured
if (!AGENT_PERFORMANCE_TABLE) {
  console.warn('[finalize-analytics] AGENT_PERFORMANCE_TABLE_NAME not configured - enhanced agent metrics will not be tracked');
}
if (!TRANSCRIPT_BUFFER_TABLE) {
  console.warn('[finalize-analytics] TRANSCRIPT_BUFFER_TABLE_NAME not configured - transcript cleanup will be skipped');
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
 * CRITICAL FIXES:
 * - Added pagination to handle large result sets
 * - Process in batches to avoid Lambda timeout
 * - Invoke continuation if more records remain
 */
export const handler = async (event: any = {}): Promise<void> => {
  // CRITICAL FIX #3.1: Track continuation depth to prevent infinite loops
  const continuationDepth = event.continuationDepth || 0;
  const continuationToken = event.continuationToken;

  console.log('[finalize-analytics] Starting finalization sweep', {
    continuationDepth,
    maxDepth: MAX_CONTINUATION_DEPTH,
    hasContinuationToken: !!continuationToken
  });

  // CRITICAL FIX #3.1: Prevent infinite continuation loops
  if (continuationDepth >= MAX_CONTINUATION_DEPTH) {
    console.error('[finalize-analytics] CRITICAL: Max continuation depth reached - stopping to prevent infinite loop', {
      continuationDepth,
      maxDepth: MAX_CONTINUATION_DEPTH,
      message: 'Large backlog detected. Consider increasing Lambda concurrency or reducing batch size.'
    });
    return;
  }

  const now = Date.now();
  let finalizedCount = 0;
  let errorCount = 0;
  const BATCH_SIZE = 50; // Process 50 records per invocation

  try {
    // Validate required environment variables
    if (!ANALYTICS_TABLE) {
      console.error('[finalize-analytics] ANALYTICS_TABLE not configured');
      return;
    }

    // FIX #1: Use GSI query instead of table scan for efficient finalization
    const queryParams: any = {
      TableName: ANALYTICS_TABLE,
      IndexName: 'analyticsState-finalizationScheduledAt-index',
      KeyConditionExpression: 'analyticsState = :finalizingState AND finalizationScheduledAt <= :now',
      ExpressionAttributeValues: {
        ':finalizingState': AnalyticsState.FINALIZING,
        ':now': now
      },
      Limit: BATCH_SIZE
    };

    if (continuationToken) {
      queryParams.ExclusiveStartKey = JSON.parse(
        Buffer.from(continuationToken, 'base64').toString('utf-8')
      );
    }

    const scanResult = await ddb.send(new QueryCommand(queryParams));
    const records = scanResult.Items || [];

    if (records.length === 0) {
      console.log('[finalize-analytics] No records pending finalization');
      return;
    }

    console.log(`[finalize-analytics] Found ${records.length} records to process`);

    // CRITICAL FIX: Process only BATCH_SIZE records to avoid timeout
    const recordsToProcess = records.slice(0, BATCH_SIZE);

    // Process records that are ready for finalization
    for (const record of recordsToProcess as AnalyticsRecord[]) {
      try {
        await finalizeRecord(record.callId, record.timestamp);
        finalizedCount++;
      } catch (err: any) {
        console.error('[finalize-analytics] Error finalizing record:', {
          callId: record.callId,
          error: err.message,
          stack: err.stack
        });
        errorCount++;
        // Continue processing other records even if one fails
      }
    }

    console.log('[finalize-analytics] Finalization sweep complete:', {
      finalized: finalizedCount,
      errors: errorCount,
      hasMore: !!scanResult.LastEvaluatedKey || records.length > BATCH_SIZE
    });

    // CRITICAL FIX #3.1: If more records remain, invoke self for continuation WITH depth tracking
    if (scanResult.LastEvaluatedKey) {
      const nextToken = Buffer.from(
        JSON.stringify(scanResult.LastEvaluatedKey)
      ).toString('base64');

      const nextDepth = continuationDepth + 1;

      // CRITICAL FIX #3.1: Check if we should continue
      if (nextDepth >= MAX_CONTINUATION_DEPTH) {
        console.warn('[finalize-analytics] Approaching max depth, stopping continuation chain', {
          nextDepth,
          maxDepth: MAX_CONTINUATION_DEPTH,
          remainingRecords: 'unknown - pagination key exists'
        });
        return;
      }

      console.log('[finalize-analytics] More records remain, scheduling continuation', {
        currentDepth: continuationDepth,
        nextDepth,
        maxDepth: MAX_CONTINUATION_DEPTH
      });

      // Import Lambda client for self-invocation
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambda = new LambdaClient({});

      try {
        await lambda.send(new InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
          InvocationType: 'Event', // Async invocation
          Payload: JSON.stringify({
            continuationToken: nextToken,
            continuationDepth: nextDepth  // CRITICAL FIX #3.1: Pass depth for tracking
          })
        }));

        console.log('[finalize-analytics] Continuation scheduled successfully', { nextDepth });
      } catch (invokeErr: any) {
        console.error('[finalize-analytics] Failed to invoke continuation:', invokeErr.message);
        // Non-fatal - next scheduled run will pick up remaining records
      }
    }

  } catch (err: any) {
    console.error('[finalize-analytics] Fatal error during finalization sweep:', {
      error: err.message,
      stack: err.stack
    });
    // Don't throw - allow Lambda to complete gracefully
    // This prevents repeated failures on the same batch
  }
};

/**
 * Finalize a single analytics record
 */
async function finalizeRecord(callId: string, timestamp: number): Promise<void> {
  const requestId = `finalize-${callId}-${Date.now()}`;

  try {
    // FIX #13: Try to cleanup expired locks first
    await cleanupExpiredLock(ddb, ANALYTICS_TABLE!, callId, timestamp);

    // CRITICAL FIX #3.4: Acquire lock with retry and exponential backoff
    let lockAcquired = false;
    let lockAttempt = 0;

    while (!lockAcquired && lockAttempt < LOCK_RETRY_ATTEMPTS) {
      lockAcquired = await acquireAnalyticsLock(ddb, ANALYTICS_TABLE!, callId, timestamp, requestId);

      if (!lockAcquired) {
        lockAttempt++;
        if (lockAttempt < LOCK_RETRY_ATTEMPTS) {
          const delay = LOCK_RETRY_DELAY_MS * Math.pow(2, lockAttempt - 1);
          console.log('[finalize-analytics] Lock acquisition failed, retrying...', {
            callId,
            attempt: lockAttempt,
            maxAttempts: LOCK_RETRY_ATTEMPTS,
            delayMs: delay
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!lockAcquired) {
      console.warn('[finalize-analytics] Failed to acquire lock after retries - will retry on next sweep:', {
        callId,
        attempts: LOCK_RETRY_ATTEMPTS
      });
      return;
    }

    try {
      // CRITICAL FIX: Validate timestamp is reasonable before processing
      const now = Math.floor(Date.now() / 1000); // Current time in epoch seconds
      const ninetyDaysAgo = now - (90 * 24 * 60 * 60);

      // Reject future timestamps (with 1 minute grace for clock skew)
      if (timestamp > now + 60) {
        console.error('[finalize-analytics] Future timestamp detected, skipping:', {
          callId,
          timestamp,
          timestampDate: new Date(timestamp * 1000).toISOString(),
          now,
          nowDate: new Date(now * 1000).toISOString()
        });
        return;
      }

      // Warn about very old timestamps (>90 days)
      if (timestamp < ninetyDaysAgo) {
        console.warn('[finalize-analytics] Very old timestamp (>90 days):', {
          callId,
          timestamp,
          timestampDate: new Date(timestamp * 1000).toISOString(),
          ageInDays: Math.floor((now - timestamp) / (24 * 60 * 60))
        });
        // Continue processing but log warning
      }

      // Get full analytics record
      const { Item: analytics } = await ddb.send(new GetCommand({
        TableName: ANALYTICS_TABLE,
        Key: { callId, timestamp }
      }));

      if (!analytics) {
        console.warn(`[finalize-analytics] Record not found: ${callId}`);
        return;
      }

      // Check state machine - should be in FINALIZING state
      const currentState = analytics.analyticsState || AnalyticsState.FINALIZING;

      if (currentState !== AnalyticsState.FINALIZING) {
        console.warn(`[finalize-analytics] Record not in FINALIZING state: ${callId}`, {
          currentState
        });
        return;
      }

      // Additional validation: Check if call has actually ended
      if (!analytics.callEndTime && !analytics.callEndTimestamp) {
        console.error('[finalize-analytics] Attempting to finalize active call:', {
          callId,
          timestamp,
          callStatus: analytics.callStatus,
          callStartTime: analytics.callStartTime
        });
        // Don't finalize active calls
        return;
      }


      // Transition to FINALIZED state
      const stateTransition = await transitionAnalyticsState(
        ddb,
        ANALYTICS_TABLE!,
        callId,
        timestamp,
        AnalyticsState.FINALIZED,
        'Finalization complete',
        requestId
      );

      if (!stateTransition.success) {
        console.warn(`[finalize-analytics] Failed to transition to FINALIZED: ${stateTransition.error}`, {
          callId
        });
        if (stateTransition.currentState === AnalyticsState.FINALIZED) {
          console.log(`[finalize-analytics] Already finalized: ${callId}`);
          return;
        }
        throw new Error(`Failed to finalize: ${stateTransition.error}`);
      }

      // CRITICAL FIX #9 & #10: Use atomic conditional update to prevent duplicate agent metrics
      // The previous approach had two issues:
      // 1. transactionItems array was built but never used in a TransactWriteCommand
      // 2. Check-then-update pattern allowed race conditions between Get and Update
      // 
      // New approach: Use conditional update that atomically checks and sets the marker

      let metricsAlreadyTracked = false;

      if (analytics.agentId && AGENT_PERFORMANCE_TABLE) {
        try {
          // CRITICAL FIX #10: Atomic check-and-set using conditional update
          // This eliminates the race condition between check and mark
          await ddb.send(new UpdateCommand({
            TableName: ANALYTICS_TABLE,
            Key: { callId, timestamp },
            UpdateExpression: 'SET agentMetricsTracking = :tracking, agentMetricsTrackingStartedAt = :now',
            ConditionExpression: 'attribute_not_exists(agentMetricsTracking) AND attribute_not_exists(agentMetricsTracked)',
            ExpressionAttributeValues: {
              ':tracking': true,
              ':now': Date.now()
            }
          }));

          console.log('[finalize-analytics] Acquired metrics tracking lock for:', callId);

        } catch (err: any) {
          if (err.name === 'ConditionalCheckFailedException') {
            console.log('[finalize-analytics] Agent metrics already being tracked or tracked, skipping:', callId);
            metricsAlreadyTracked = true;
          } else {
            console.warn('[finalize-analytics] Error acquiring metrics tracking lock:', err.message);
            // Continue anyway - worst case is duplicate metrics which is better than missing
          }
        }
      }

      // CRITICAL FIX #7: Validate agent exists before tracking metrics
      let agentExists = false;
      if (analytics.agentId && AGENT_PERFORMANCE_TABLE && !metricsAlreadyTracked) {
        // Validate agent exists by checking if they have any presence or historical data
        try {
          const AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME;
          if (AGENT_PRESENCE_TABLE) {
            const presenceCheck = await ddb.send(new GetCommand({
              TableName: AGENT_PRESENCE_TABLE,
              Key: { agentId: analytics.agentId }
            }));
            agentExists = !!presenceCheck.Item;
          } else {
            // No presence table - assume agent exists (backward compatibility)
            agentExists = true;
          }

          if (!agentExists) {
            console.error('[finalize-analytics] Agent not found in presence table:', {
              callId,
              agentId: analytics.agentId,
              clinicId: analytics.clinicId
            });
            // Don't track metrics for non-existent agents
          }
        } catch (validateErr: any) {
          console.warn('[finalize-analytics] Could not validate agent existence:', validateErr.message);
          // If validation fails, assume agent exists (fail open)
          agentExists = true;
        }
      }

      // Update coaching summary and conditionally track agent metrics
      if (analytics.agentId && AGENT_PERFORMANCE_TABLE && !metricsAlreadyTracked && agentExists) {
        const MAX_RETRIES = 3;
        let lastError: any = null;
        let metricsTracked = false;

        // CRITICAL FIX: Implement retry logic with exponential backoff and circuit breaker
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            // Track agent metrics with idempotency
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
              speakerMetrics: analytics.speakerMetrics,
              timestamp: analytics.callEndTimestamp || Date.now()
            });

            metricsTracked = true;
            console.log('[finalize-analytics] Successfully tracked agent metrics for', callId);
            break;
          } catch (err: any) {
            lastError = err;
            console.error('[finalize-analytics] Error tracking enhanced metrics:', {
              error: err.message,
              callId,
              agentId: analytics.agentId,
              attempt: attempt + 1
            });

            // If this was the last attempt, send to DLQ with circuit breaker
            if (attempt === MAX_RETRIES - 1) {
              const failure: AgentPerformanceFailure = {
                callId,
                agentId: analytics.agentId,
                clinicId: analytics.clinicId,
                error: {
                  message: err.message,
                  stack: err.stack,
                  code: err.code || err.name
                },
                metrics: {
                  direction: analytics.direction || 'inbound',
                  duration: analytics.totalDuration || 0,
                  sentiment: analytics.overallSentiment,
                  sentimentScore: analytics.averageSentiment
                },
                timestamp: new Date().toISOString(),
                attemptCount: MAX_RETRIES
              };

              // FIX #8: Add circuit breaker for DLQ failures
              await sendToPerformanceDLQWithCircuitBreaker(failure, callId, analytics.agentId, analytics.clinicId);
            } else {
              // Wait before retry with exponential backoff: 500ms, 1000ms, 2000ms
              await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)));
            }
          }
        }

        // CRITICAL FIX #10: Atomically mark metrics as tracked and remove tracking lock
        if (metricsTracked) {
          try {
            await ddb.send(new UpdateCommand({
              TableName: ANALYTICS_TABLE,
              Key: { callId, timestamp },
              UpdateExpression: 'SET agentMetricsTracked = :true, agentMetricsTrackedAt = :now REMOVE agentMetricsTracking',
              ExpressionAttributeValues: {
                ':true': true,
                ':now': Date.now()
              }
            }));
          } catch (updateErr: any) {
            console.error('[finalize-analytics] Error updating coaching summary:', {
              error: updateErr.message,
              callId
            });
            // Still try to release the tracking lock even if update failed
            try {
              await ddb.send(new UpdateCommand({
                TableName: ANALYTICS_TABLE,
                Key: { callId, timestamp },
                UpdateExpression: 'REMOVE agentMetricsTracking'
              }));
            } catch (releaseErr: any) {
              console.warn('[finalize-analytics] Could not release tracking lock:', releaseErr.message);
            }
          }
        } else {
          // Metrics tracking failed - release the lock
          try {
            await ddb.send(new UpdateCommand({
              TableName: ANALYTICS_TABLE,
              Key: { callId, timestamp },
              UpdateExpression: 'REMOVE agentMetricsTracking'
            }));
          } catch (releaseErr: any) {
            console.warn('[finalize-analytics] Could not release tracking lock after failure:', releaseErr.message);
          }
        }
      } else {
        // No agent metrics to track or already tracked
        console.log('[finalize-analytics] No agent metrics to track or already tracked:', callId);
      }

      // CRITICAL FIX #3: Cleanup transcript buffer after successful finalization
      // This prevents DynamoDB from accumulating old transcript data
      if (transcriptManager) {
        try {
          await transcriptManager.delete(callId);
          console.log(`[finalize-analytics] Cleaned up transcript buffer for ${callId}`);
        } catch (cleanupErr: any) {
          console.error('[finalize-analytics] Error cleaning up transcript buffer:', {
            callId,
            error: cleanupErr.message
          });
          // Non-fatal error - buffer will be cleaned up by TTL
        }
      } else {
        console.log(`[finalize-analytics] Skipping transcript cleanup - manager not configured`);
      }

      console.log(`[finalize-analytics] Finalized analytics for call ${callId}`, {
        sentiment: analytics.overallSentiment
      });
    } finally {
      // Always release the lock
      await releaseAnalyticsLock(ddb, ANALYTICS_TABLE!, callId, timestamp, requestId);
    }
  } catch (err: any) {
    console.error(`[finalize-analytics] Error finalizing record ${callId}:`, {
      error: err.message,
      stack: err.stack
    });

    // Try to transition to FAILED state
    try {
      await transitionAnalyticsState(
        ddb,
        ANALYTICS_TABLE!,
        callId,
        timestamp,
        AnalyticsState.FAILED,
        `Finalization failed: ${err.message}`,
        requestId
      );
    } catch (stateErr) {
      console.error('[finalize-analytics] Failed to transition to FAILED state:', stateErr);
    }

    throw err; // Re-throw to be caught by the main handler
  }
}


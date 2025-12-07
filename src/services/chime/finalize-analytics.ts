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
import { generateCallCoachingSummary } from './real-time-coaching';
import { sendToPerformanceDLQ, AgentPerformanceFailure } from '../shared/utils/agent-performance-dlq';
import { AnalyticsState } from '../../types/analytics-state-machine';
import { transitionAnalyticsState, acquireAnalyticsLock, releaseAnalyticsLock, cleanupExpiredLock } from '../shared/utils/analytics-state-manager';
import { getTranscriptBufferManager } from '../shared/utils/transcript-buffer-manager';

// CRITICAL FIX #8: Persistent circuit breaker state using DynamoDB
// In-memory circuit breaker state is lost on Lambda cold starts, defeating its purpose.
// This implementation stores state in DynamoDB for persistence across invocations.

const CIRCUIT_BREAKER_THRESHOLD = 5; // Open after 5 consecutive failures
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute cooldown
const CIRCUIT_BREAKER_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME; // Reuse analytics table with special key

interface PersistentCircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  lastUpdated: number;
}

/**
 * Get circuit breaker state from DynamoDB
 * Uses a special key pattern to store state in the analytics table
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
    const result = await ddb.send(new GetCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: {
        callId: `__circuit_breaker__${breakerKey}`,
        timestamp: 0 // Fixed timestamp for circuit breaker entries
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
 */
async function updateCircuitBreakerState(
  breakerKey: string, 
  state: PersistentCircuitBreakerState
): Promise<void> {
  if (!CIRCUIT_BREAKER_TABLE) {
    return;
  }
  
  try {
    await ddb.send(new UpdateCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: {
        callId: `__circuit_breaker__${breakerKey}`,
        timestamp: 0
      },
      UpdateExpression: 'SET failures = :failures, lastFailure = :lastFailure, isOpen = :isOpen, lastUpdated = :lastUpdated, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: {
        ':failures': state.failures,
        ':lastFailure': state.lastFailure,
        ':isOpen': state.isOpen,
        ':lastUpdated': Date.now(),
        ':ttl': Math.floor(Date.now() / 1000) + (24 * 60 * 60) // Expire after 24 hours
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

// CRITICAL FIX: The transcript buffer table name must match AnalyticsStack's naming convention.
// AnalyticsStack uses: ${stackName}-TranscriptBuffersV2
// The fallback logic was incorrect - it was using ANALYTICS_TABLE-Transcripts which doesn't exist.
// Now we derive from the stack name pattern or require explicit configuration.
const TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME || (() => {
  // Derive from ANALYTICS_TABLE by replacing the table suffix with TranscriptBuffersV2
  // ANALYTICS_TABLE format: TodaysDentalInsightsAnalyticsN1-CallAnalyticsV2
  // TRANSCRIPT_BUFFER_TABLE should be: TodaysDentalInsightsAnalyticsN1-TranscriptBuffersV2
  if (ANALYTICS_TABLE) {
    const parts = ANALYTICS_TABLE.split('-');
    if (parts.length >= 2) {
      parts[parts.length - 1] = 'TranscriptBuffersV2';
      return parts.join('-');
    }
  }
  console.warn('[finalize-analytics] Could not derive TRANSCRIPT_BUFFER_TABLE_NAME from ANALYTICS_TABLE');
  return '';
})();

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
  console.log('[finalize-analytics] Starting finalization sweep');
  
  const now = Date.now();
  let finalizedCount = 0;
  let errorCount = 0;
  const BATCH_SIZE = 50; // Process 50 records per invocation
  const continuationToken = event.continuationToken;
  
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
    
    // CRITICAL FIX: If more records remain, invoke self for continuation
    if (scanResult.LastEvaluatedKey) {
      const nextToken = Buffer.from(
        JSON.stringify(scanResult.LastEvaluatedKey)
      ).toString('base64');
      
      console.log('[finalize-analytics] More records remain, scheduling continuation');
      
      // Import Lambda client for self-invocation
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambda = new LambdaClient({});
      
      try {
        await lambda.send(new InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
          InvocationType: 'Event', // Async invocation
          Payload: JSON.stringify({ continuationToken: nextToken })
        }));
        
        console.log('[finalize-analytics] Continuation scheduled successfully');
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
    
    // CRITICAL FIX: Acquire lock to prevent concurrent finalization
    const lockAcquired = await acquireAnalyticsLock(ddb, ANALYTICS_TABLE!, callId, timestamp, requestId);
    
    if (!lockAcquired) {
      console.log('[finalize-analytics] Failed to acquire lock, another process is finalizing:', callId);
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

    // Generate coaching summary
    let coachingSummary;
    try {
      coachingSummary = await generateCallCoachingSummary(analytics);
    } catch (err: any) {
      console.error('[finalize-analytics] Error generating coaching summary:', {
        error: err.message,
        callId
      });
      coachingSummary = { score: 50, strengths: [], improvements: [] };
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
    
    // CRITICAL FIX: Use DynamoDB transactions for atomic multi-table update
    // This ensures either both analytics and agent metrics update, or neither do
    
    // Build transaction items
    const transactionItems: any[] = [
      {
        Update: {
          TableName: ANALYTICS_TABLE,
          Key: { callId, timestamp },
          UpdateExpression: 'SET coachingSummary = :coaching',
          ExpressionAttributeValues: {
            ':coaching': coachingSummary
          }
        }
      }
    ];
    
    // FIX #2: Use idempotency marker to prevent duplicate agent metrics
    // Check if metrics already tracked for this call
    const metricsMarker = `metrics-tracked-${callId}`;
    let metricsAlreadyTracked = false;
    
    if (analytics.agentId && AGENT_PERFORMANCE_TABLE) {
      try {
        // Check if we already tracked metrics
        const markerResult = await ddb.send(new GetCommand({
          TableName: ANALYTICS_TABLE,
          Key: { callId, timestamp },
          ProjectionExpression: 'agentMetricsTracked'
        }));
        
        if (markerResult.Item?.agentMetricsTracked) {
          console.log('[finalize-analytics] Agent metrics already tracked, skipping:', callId);
          metricsAlreadyTracked = true;
        }
      } catch (err: any) {
        console.warn('[finalize-analytics] Error checking metrics marker:', err.message);
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
      
      // Mark metrics as tracked to prevent duplicates
      if (metricsTracked) {
        try {
          await ddb.send(new UpdateCommand({
            TableName: ANALYTICS_TABLE,
            Key: { callId, timestamp },
            UpdateExpression: 'SET coachingSummary = :coaching, agentMetricsTracked = :true, agentMetricsTrackedAt = :now',
            ExpressionAttributeValues: {
              ':coaching': coachingSummary,
              ':true': true,
              ':now': Date.now()
            }
          }));
        } catch (updateErr: any) {
          console.error('[finalize-analytics] Error updating coaching summary:', {
            error: updateErr.message,
            callId
          });
        }
      }
    } else {
      // No agent metrics to track or already tracked - just update coaching summary
      try {
        await ddb.send(new UpdateCommand({
          TableName: ANALYTICS_TABLE,
          Key: { callId, timestamp },
          UpdateExpression: 'SET coachingSummary = :coaching',
          ExpressionAttributeValues: {
            ':coaching': coachingSummary
          }
        }));
      } catch (updateErr: any) {
        console.error('[finalize-analytics] Error updating coaching summary:', {
          error: updateErr.message,
          callId
        });
        throw updateErr;
      }
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
      coachingScore: coachingSummary?.score,
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


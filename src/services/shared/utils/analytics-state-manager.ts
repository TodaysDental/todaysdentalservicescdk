/**
 * Analytics State Manager
 * 
 * Manages state transitions for call analytics lifecycle
 * Provides locking and validation to prevent race conditions
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { 
  AnalyticsState, 
  AnalyticsStateMetadata, 
  AnalyticsStateTransition,
  isValidTransition,
  canUpdateAnalytics,
  isLiveState,
  isTerminalState
} from '../../../types/analytics-state-machine';

const LOCK_DURATION_MS = 30000; // 30 seconds

export interface StateTransitionResult {
  success: boolean;
  currentState: AnalyticsState;
  error?: string;
  isLocked?: boolean;
  lockedBy?: string;
}

/**
 * Attempt to transition analytics to a new state
 */
export async function transitionAnalyticsState(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  callId: string,
  timestamp: number,
  toState: AnalyticsState,
  reason?: string,
  requestId?: string
): Promise<StateTransitionResult> {
  try {
    // Get current state
    const { Item: analytics } = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { callId, timestamp }
    }));

    if (!analytics) {
      return {
        success: false,
        currentState: AnalyticsState.FAILED,
        error: 'Analytics record not found'
      };
    }

    const currentState = analytics.analyticsState || AnalyticsState.INITIALIZING;
    
    // Check if transition is valid
    if (!isValidTransition(currentState, toState)) {
      return {
        success: false,
        currentState,
        error: `Invalid transition from ${currentState} to ${toState}`
      };
    }

    // Check if locked by another process
    if (analytics.lockedBy && analytics.lockedUntil > Date.now()) {
      if (analytics.lockedBy !== requestId) {
        return {
          success: false,
          currentState,
          isLocked: true,
          lockedBy: analytics.lockedBy,
          error: 'Record is locked by another process'
        };
      }
    }

    // Build state transition
    const transition: AnalyticsStateTransition = {
      from: currentState,
      to: toState,
      timestamp: Date.now(),
      reason,
      processedBy: requestId
    };

    const stateHistory = analytics.stateHistory || [];
    stateHistory.push(transition);

    // Apply state transition with conditional check
    const updateExpression = `
      SET analyticsState = :newState,
          stateHistory = :history,
          stateLastUpdated = :now
    `;

    const expressionValues: any = {
      ':newState': toState,
      ':history': stateHistory,
      ':now': Date.now(),
      ':currentState': currentState
    };

    // Add finalization metadata if transitioning to FINALIZING
    let finalUpdateExpression = updateExpression;
    if (toState === AnalyticsState.FINALIZING) {
      finalUpdateExpression += `, finalizationScheduledAt = :scheduleTime`;
      expressionValues[':scheduleTime'] = Date.now() + 30000; // 30 seconds
    }

    // Add finalized timestamp if transitioning to FINALIZED
    if (toState === AnalyticsState.FINALIZED) {
      finalUpdateExpression += `, finalizedAt = :finalizedTime, finalized = :true`;
      expressionValues[':finalizedTime'] = Date.now();
      expressionValues[':true'] = true;
    }

    // Remove lock if moving to terminal state
    if (isTerminalState(toState)) {
      finalUpdateExpression += ` REMOVE lockedBy, lockedUntil`;
    }

    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { callId, timestamp },
      UpdateExpression: finalUpdateExpression,
      ConditionExpression: 'analyticsState = :currentState OR attribute_not_exists(analyticsState)',
      ExpressionAttributeValues: expressionValues
    }));

    console.log('[StateManager] Transitioned analytics state:', {
      callId,
      from: currentState,
      to: toState,
      reason
    });

    return {
      success: true,
      currentState: toState
    };

  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return {
        success: false,
        currentState: AnalyticsState.FAILED,
        error: 'State changed during transition attempt'
      };
    }
    throw err;
  }
}

/**
 * Acquire lock on analytics record
 */
export async function acquireAnalyticsLock(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  callId: string,
  timestamp: number,
  requestId: string,
  duration: number = LOCK_DURATION_MS
): Promise<boolean> {
  try {
    const lockUntil = Date.now() + duration;

    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { callId, timestamp },
      UpdateExpression: 'SET lockedBy = :requestId, lockedUntil = :until',
      ConditionExpression: 'attribute_not_exists(lockedBy) OR lockedUntil < :now OR lockedBy = :requestId',
      ExpressionAttributeValues: {
        ':requestId': requestId,
        ':until': lockUntil,
        ':now': Date.now()
      }
    }));

    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false; // Lock already held
    }
    throw err;
  }
}

/**
 * Release lock on analytics record
 */
export async function releaseAnalyticsLock(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  callId: string,
  timestamp: number,
  requestId: string
): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { callId, timestamp },
      UpdateExpression: 'REMOVE lockedBy, lockedUntil',
      ConditionExpression: 'lockedBy = :requestId',
      ExpressionAttributeValues: {
        ':requestId': requestId
      }
    }));
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn('[StateManager] Lock already released or owned by another process');
    } else {
      throw err;
    }
  }
}

/**
 * Check if analytics can be updated
 */
export async function canUpdateAnalyticsRecord(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  callId: string,
  timestamp: number
): Promise<{ allowed: boolean; reason?: string; currentState?: AnalyticsState }> {
  const { Item: analytics } = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { callId, timestamp }
  }));

  if (!analytics) {
    return { allowed: false, reason: 'Record not found' };
  }

  const currentState = analytics.analyticsState || AnalyticsState.INITIALIZING;

  if (!canUpdateAnalytics(currentState)) {
    return {
      allowed: false,
      reason: `Cannot update in ${currentState} state`,
      currentState
    };
  }

  // Check if locked
  if (analytics.lockedBy && analytics.lockedUntil > Date.now()) {
    return {
      allowed: false,
      reason: 'Record is locked',
      currentState
    };
  }

  return { allowed: true, currentState };
}

/**
 * FIX #13: Monitor and cleanup expired locks to prevent stuck finalizations
 */
export async function cleanupExpiredLock(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  callId: string,
  timestamp: number
): Promise<boolean> {
  try {
    const { Item: analytics } = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { callId, timestamp }
    }));
    
    if (!analytics) {
      return false;
    }
    
    // Check if lock is expired
    if (analytics.lockedBy && analytics.lockedUntil < Date.now()) {
      const lockAge = Date.now() - analytics.lockedUntil;
      console.warn('[StateManager] Cleaning up expired lock:', {
        callId,
        lockedBy: analytics.lockedBy,
        expiredMs: lockAge
      });
      
      // Remove expired lock
      await ddb.send(new UpdateCommand({
        TableName: tableName,
        Key: { callId, timestamp },
        UpdateExpression: 'REMOVE lockedBy, lockedUntil',
        ConditionExpression: 'lockedUntil < :now',
        ExpressionAttributeValues: {
          ':now': Date.now()
        }
      }));
      
      return true;
    }
    
    return false;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false; // Lock already cleaned or extended
    }
    console.error('[StateManager] Error cleaning expired lock:', err);
    return false;
  }
}

/**
 * Get current analytics state
 */
export async function getAnalyticsState(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  callId: string,
  timestamp: number
): Promise<AnalyticsStateMetadata | null> {
  const { Item: analytics } = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { callId, timestamp },
    ProjectionExpression: 'analyticsState, stateHistory, lockedBy, lockedUntil, finalizationScheduledAt, finalizedAt'
  }));

  if (!analytics) {
    return null;
  }

  return {
    currentState: analytics.analyticsState || AnalyticsState.INITIALIZING,
    stateHistory: analytics.stateHistory || [],
    lockedBy: analytics.lockedBy,
    lockedUntil: analytics.lockedUntil,
    finalizationScheduledAt: analytics.finalizationScheduledAt,
    finalizedAt: analytics.finalizedAt
  };
}


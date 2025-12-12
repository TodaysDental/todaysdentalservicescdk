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

// CRITICAL FIX #6.2: Make lock duration configurable via environment variable
// Default to 60 seconds (was 30s) to account for slower finalization on complex calls
const LOCK_DURATION_MS = parseInt(process.env.ANALYTICS_LOCK_DURATION_MS || '60000', 10);

// CRITICAL FIX #6.2: Validate lock duration is reasonable
if (LOCK_DURATION_MS < 10000 || LOCK_DURATION_MS > 300000) {
  console.warn('[StateManager] ANALYTICS_LOCK_DURATION_MS outside recommended range (10s-300s):', {
    configuredMs: LOCK_DURATION_MS,
    recommendation: 'Use 30000-60000 for most workloads'
  });
}

export interface StateTransitionResult {
  success: boolean;
  currentState: AnalyticsState;
  error?: string;
  isLocked?: boolean;
  lockedBy?: string;
}

/**
 * Attempt to transition analytics to a new state
 * CRITICAL FIX #6.1: Use single atomic operation with validation in condition expression
 * This eliminates the race window between GET and UPDATE
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
    // CRITICAL FIX #6.1: Define valid source states for each target state upfront
    // This allows us to do the transition validation in a single atomic operation
    const validSourceStates = getValidSourceStates(toState);
    
    if (validSourceStates.length === 0) {
      return {
        success: false,
        currentState: AnalyticsState.FAILED,
        error: `No valid source states for transition to ${toState}`
      };
    }

    // Build state transition
    const now = Date.now();
    const transition: AnalyticsStateTransition = {
      from: AnalyticsState.INITIALIZING, // Placeholder - will be overwritten by actual state
      to: toState,
      timestamp: now,
      reason,
      processedBy: requestId
    };

    // Build the atomic update expression
    let updateExpression = `
      SET analyticsState = :newState,
          stateHistory = list_append(if_not_exists(stateHistory, :emptyList), :newTransition),
          stateLastUpdated = :now
    `;

    const expressionValues: any = {
      ':newState': toState,
      ':newTransition': [transition],
      ':emptyList': [],
      ':now': now
    };

    // Add finalization metadata if transitioning to FINALIZING
    if (toState === AnalyticsState.FINALIZING) {
      updateExpression += `, finalizationScheduledAt = :scheduleTime`;
      expressionValues[':scheduleTime'] = now + 30000; // 30 seconds
    }

    // Add finalized timestamp if transitioning to FINALIZED
    if (toState === AnalyticsState.FINALIZED) {
      updateExpression += `, finalizedAt = :finalizedTime, finalized = :true`;
      expressionValues[':finalizedTime'] = now;
      expressionValues[':true'] = true;
    }

    // Remove lock if moving to terminal state
    if (isTerminalState(toState)) {
      updateExpression += ` REMOVE lockedBy, lockedUntil`;
    }

    // CRITICAL FIX #6.1: Build condition expression that validates state AND checks lock atomically
    // This is the key change - we validate everything in one atomic operation
    const conditionParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    
    // Check current state is one of the valid source states
    validSourceStates.forEach((state, idx) => {
      expressionValues[`:validState${idx}`] = state;
    });
    
    const stateConditions = validSourceStates.map((_, idx) => `analyticsState = :validState${idx}`);
    stateConditions.push('attribute_not_exists(analyticsState)'); // Allow for new records
    conditionParts.push(`(${stateConditions.join(' OR ')})`);
    
    // Check lock if requestId provided
    if (requestId) {
      expressionValues[':requestId'] = requestId;
      expressionValues[':currentTime'] = now;
      conditionParts.push('(attribute_not_exists(lockedBy) OR lockedUntil < :currentTime OR lockedBy = :requestId)');
    }

    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { callId, timestamp },
      UpdateExpression: updateExpression,
      ConditionExpression: conditionParts.join(' AND '),
      ExpressionAttributeValues: expressionValues,
      ExpressionAttributeNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined
    }));

    console.log('[StateManager] Transitioned analytics state:', {
      callId,
      to: toState,
      reason,
      validSourceStates
    });

    return {
      success: true,
      currentState: toState
    };

  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      // CRITICAL FIX #6.1: On condition failure, fetch current state for better error reporting
      try {
        const { Item: analytics } = await ddb.send(new GetCommand({
          TableName: tableName,
          Key: { callId, timestamp },
          ProjectionExpression: 'analyticsState, lockedBy, lockedUntil'
        }));
        
        const currentState = analytics?.analyticsState || AnalyticsState.INITIALIZING;
        const isLocked = analytics?.lockedBy && analytics?.lockedUntil > Date.now();
        
        return {
          success: false,
          currentState,
          isLocked,
          lockedBy: isLocked ? analytics?.lockedBy : undefined,
          error: isLocked 
            ? 'Record is locked by another process'
            : `Invalid transition: current state is ${currentState}`
        };
      } catch {
        return {
          success: false,
          currentState: AnalyticsState.FAILED,
          error: 'State changed during transition attempt'
        };
      }
    }
    throw err;
  }
}

/**
 * CRITICAL FIX #6.1: Helper to get valid source states for a target state
 */
function getValidSourceStates(toState: AnalyticsState): AnalyticsState[] {
  switch (toState) {
    case AnalyticsState.ACTIVE:
      return [AnalyticsState.INITIALIZING];
    case AnalyticsState.FINALIZING:
      return [AnalyticsState.ACTIVE, AnalyticsState.INITIALIZING];
    case AnalyticsState.FINALIZED:
      return [AnalyticsState.FINALIZING];
    case AnalyticsState.FAILED:
      return [AnalyticsState.INITIALIZING, AnalyticsState.ACTIVE, AnalyticsState.FINALIZING];
    default:
      return [];
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


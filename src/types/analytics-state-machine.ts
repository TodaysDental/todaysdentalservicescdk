/**
 * Analytics State Machine Types
 * 
 * Defines the lifecycle states for call analytics processing
 * to prevent race conditions and ensure data consistency
 */

export enum AnalyticsState {
  INITIALIZING = 'initializing',  // Record created, waiting for first data
  ACTIVE = 'active',              // Call in progress, live updates allowed
  FINALIZING = 'finalizing',      // Call ended, computing final metrics
  FINALIZED = 'finalized',        // Processing complete, read-only
  FAILED = 'failed'               // Processing failed, needs intervention
}

export interface AnalyticsStateTransition {
  from: AnalyticsState;
  to: AnalyticsState;
  timestamp: number;
  reason?: string;
  processedBy?: string;
}

export interface AnalyticsStateMetadata {
  currentState: AnalyticsState;
  stateHistory: AnalyticsStateTransition[];
  lockedBy?: string;           // Lambda request ID that owns the lock
  lockedUntil?: number;         // Epoch milliseconds when lock expires
  finalizationScheduledAt?: number;
  finalizedAt?: number;
}

/**
 * Valid state transitions
 */
export const VALID_TRANSITIONS: Record<AnalyticsState, AnalyticsState[]> = {
  [AnalyticsState.INITIALIZING]: [AnalyticsState.ACTIVE, AnalyticsState.FAILED],
  [AnalyticsState.ACTIVE]: [AnalyticsState.FINALIZING, AnalyticsState.FAILED],
  [AnalyticsState.FINALIZING]: [AnalyticsState.FINALIZED, AnalyticsState.FAILED],
  [AnalyticsState.FINALIZED]: [], // Terminal state
  [AnalyticsState.FAILED]: [AnalyticsState.ACTIVE, AnalyticsState.FINALIZING] // Allow retry
};

/**
 * Validate if a state transition is allowed
 */
export function isValidTransition(from: AnalyticsState, to: AnalyticsState): boolean {
  const allowedTransitions = VALID_TRANSITIONS[from];
  return allowedTransitions.includes(to);
}

/**
 * Check if analytics can be updated in current state
 */
export function canUpdateAnalytics(state: AnalyticsState): boolean {
  return state === AnalyticsState.ACTIVE;
}

/**
 * Check if call is considered "live" for client purposes
 */
export function isLiveState(state: AnalyticsState): boolean {
  return state === AnalyticsState.INITIALIZING || state === AnalyticsState.ACTIVE;
}

/**
 * Check if state is terminal (no more transitions allowed)
 */
export function isTerminalState(state: AnalyticsState): boolean {
  return state === AnalyticsState.FINALIZED || state === AnalyticsState.FAILED;
}

/**
 * Get estimated time remaining for finalization
 */
export function getFinalizationEstimate(metadata: AnalyticsStateMetadata): number | null {
  if (metadata.currentState !== AnalyticsState.FINALIZING) {
    return null;
  }
  
  if (!metadata.finalizationScheduledAt) {
    return 30000; // Default 30 seconds
  }
  
  const remaining = metadata.finalizationScheduledAt - Date.now();
  return Math.max(0, remaining);
}


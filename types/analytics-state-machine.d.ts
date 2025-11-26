/**
 * Analytics State Machine Types
 *
 * Defines the lifecycle states for call analytics processing
 * to prevent race conditions and ensure data consistency
 */
export declare enum AnalyticsState {
    INITIALIZING = "initializing",// Record created, waiting for first data
    ACTIVE = "active",// Call in progress, live updates allowed
    FINALIZING = "finalizing",// Call ended, computing final metrics
    FINALIZED = "finalized",// Processing complete, read-only
    FAILED = "failed"
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
    lockedBy?: string;
    lockedUntil?: number;
    finalizationScheduledAt?: number;
    finalizedAt?: number;
}
/**
 * Valid state transitions
 */
export declare const VALID_TRANSITIONS: Record<AnalyticsState, AnalyticsState[]>;
/**
 * Validate if a state transition is allowed
 */
export declare function isValidTransition(from: AnalyticsState, to: AnalyticsState): boolean;
/**
 * Check if analytics can be updated in current state
 */
export declare function canUpdateAnalytics(state: AnalyticsState): boolean;
/**
 * Check if call is considered "live" for client purposes
 */
export declare function isLiveState(state: AnalyticsState): boolean;
/**
 * Check if state is terminal (no more transitions allowed)
 */
export declare function isTerminalState(state: AnalyticsState): boolean;
/**
 * Get estimated time remaining for finalization
 */
export declare function getFinalizationEstimate(metadata: AnalyticsStateMetadata): number | null;

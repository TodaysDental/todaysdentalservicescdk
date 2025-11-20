/**
 * CRITICAL FIX #5: Centralized TTL configuration
 * Ensures consistent TTL values across all call states and services
 * 
 * This fixes the issue where agent sessions expire before calls end,
 * causing orphaned records and failures on hold/resume operations.
 */

export const TTL_POLICY = {
    /**
     * Agent session TTL: How long an agent session stays alive after creation
     * Must be at least as long as the longest possible call duration
     * Default: 24 hours (matches call TTL)
     */
    AGENT_SESSION_SECONDS: parseInt(process.env.CHIME_TTL_AGENT_SESSION || String(24 * 60 * 60), 10),

    /**
     * Active call TTL: How long a call record stays in DynamoDB
     * Includes duration for on-hold, transfer, and completion
     * Default: 24 hours
     */
    ACTIVE_CALL_SECONDS: parseInt(process.env.CHIME_TTL_ACTIVE_CALL || String(24 * 60 * 60), 10),

    /**
     * Queued call TTL: How long a call waits in queue before expiry
     * Default: 24 hours (same as active call)
     */
    QUEUED_CALL_SECONDS: parseInt(process.env.CHIME_TTL_QUEUED_CALL || String(24 * 60 * 60), 10),

    /**
     * Held call TTL: How long a call can remain on hold
     * Typically same as active call, but can be shortened if desired
     * Default: 24 hours
     */
    HELD_CALL_SECONDS: parseInt(process.env.CHIME_TTL_HELD_CALL || String(24 * 60 * 60), 10),

    /**
     * Heartbeat grace period: After this duration without heartbeat, agent is considered stale
     * This should be LESS than AGENT_SESSION to catch stale agents before TTL cleanup
     * Default: 15 minutes
     */
    HEARTBEAT_GRACE_SECONDS: parseInt(process.env.CHIME_TTL_HEARTBEAT_GRACE || String(15 * 60), 10),

    /**
     * Session expiry: Maximum duration an agent can stay logged in
     * Independent from heartbeat - agents stay online even if idle
     * Default: 8 hours (typical work shift)
     */
    SESSION_MAX_SECONDS: parseInt(process.env.CHIME_SESSION_MAX_SECONDS || String(8 * 60 * 60), 10),
};

/**
 * Helper to calculate TTL timestamp (epoch seconds)
 * Usage: const ttl = calculateTTL(TTL_POLICY.ACTIVE_CALL_SECONDS);
 */
export function calculateTTL(durationSeconds: number): number {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return nowSeconds + durationSeconds;
}

/**
 * Helper to calculate session expiry based on TTL policy
 * Returns: { ttl: epoch_seconds, sessionExpiresAt: iso_string, duration: seconds }
 * CRITICAL FIX #13: TTL should match session expiry, not extend beyond it
 */
export function calculateSessionExpiry(): {
    ttl: number;
    sessionExpiresAtEpoch: number;
    sessionExpiresAt: string;
    durationSeconds: number;
} {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionExpiresAtEpoch = nowSeconds + TTL_POLICY.SESSION_MAX_SECONDS;
    
    // CRITICAL FIX #13: TTL should match session expiry to prevent stale records
    // Adding heartbeat grace allows record to persist briefly after expiry for cleanup
    const ttl = sessionExpiresAtEpoch + TTL_POLICY.HEARTBEAT_GRACE_SECONDS;

    return {
        ttl,
        sessionExpiresAtEpoch,
        sessionExpiresAt: new Date(sessionExpiresAtEpoch * 1000).toISOString(),
        durationSeconds: TTL_POLICY.SESSION_MAX_SECONDS,
    };
}

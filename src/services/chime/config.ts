/**
 * Centralized Chime Service Configuration
 * 
 * All configurable values are defined here with environment variable overrides.
 * This eliminates magic values scattered throughout the codebase and makes
 * tuning system behavior easier without code changes.
 * 
 * Environment variables (all optional, defaults provided):
 * - CHIME_MAX_RING_AGENTS: Max agents to ring for incoming calls (default: 25)
 * - CHIME_QUEUE_TIMEOUT: Seconds for queued call timeout (default: 86400 = 24 hours)
 * - CHIME_AVG_CALL_DURATION: Seconds for average call duration estimation (default: 300)
 * - CHIME_STALE_HEARTBEAT_MINUTES: Minutes before agent marked offline (default: 15)
 * - CHIME_SESSION_MAX_SECONDS: Max agent session duration (default: 28800 = 8 hours)
 * - CHIME_HEARTBEAT_GRACE_SECONDS: Grace period after last heartbeat (default: 900 = 15 min)
 * - CHIME_TRANSFER_NOTE_MAX: Max transfer notes length (default: 500)
 * - CHIME_RETRY_MAX_ATTEMPTS: Max Lambda retry attempts (default: 3)
 * - CHIME_RETRY_BASE_DELAY_MS: Base retry delay milliseconds (default: 1000)
 * - CHIME_MAX_CONNECTED_CALL_MINUTES: Max connected call duration minutes (default: 60)
 */

export const CHIME_CONFIG = {
  /**
   * Call Queue Configuration
   */
  QUEUE: {
    /** Maximum number of agents to ring simultaneously for incoming calls */
    MAX_RING_AGENTS: parseInt(process.env.CHIME_MAX_RING_AGENTS || '25', 10),
    
    /** Timeout for calls stuck in queue (seconds) */
    TIMEOUT_SECONDS: parseInt(process.env.CHIME_QUEUE_TIMEOUT || String(24 * 60 * 60), 10),
    
    /** Average call duration for capacity planning (seconds) */
    AVG_CALL_DURATION_SECONDS: parseInt(process.env.CHIME_AVG_CALL_DURATION || '300', 10),
  },

  /**
   * Agent Management Configuration
   */
  AGENT: {
    /** Minutes of inactivity before agent marked offline */
    STALE_HEARTBEAT_MINUTES: parseInt(process.env.CHIME_STALE_HEARTBEAT_MINUTES || '15', 10),
    
    /** Maximum agent session duration (seconds) */
    SESSION_MAX_SECONDS: parseInt(process.env.CHIME_SESSION_MAX_SECONDS || String(8 * 60 * 60), 10),
    
    /** Grace period after last heartbeat before cleanup (seconds) */
    HEARTBEAT_GRACE_SECONDS: parseInt(process.env.CHIME_HEARTBEAT_GRACE_SECONDS || String(15 * 60), 10),
    
    /** Maximum connected call duration before auto-hangup (minutes) */
    MAX_CONNECTED_CALL_MINUTES: parseInt(process.env.CHIME_MAX_CONNECTED_CALL_MINUTES || '60', 10),
  },

  /**
   * Transfer Configuration
   */
  TRANSFER: {
    /** Maximum length of transfer notes field */
    MAX_NOTE_LENGTH: parseInt(process.env.CHIME_TRANSFER_NOTE_MAX || '500', 10),
  },

  /**
   * Retry Configuration
   */
  RETRY: {
    /** Maximum number of retry attempts for Lambda invocations */
    MAX_ATTEMPTS: parseInt(process.env.CHIME_RETRY_MAX_ATTEMPTS || '3', 10),
    
    /** Base delay between retries (milliseconds) */
    BASE_DELAY_MS: parseInt(process.env.CHIME_RETRY_BASE_DELAY_MS || '1000', 10),
  },

  /**
   * Cleanup Configuration
   */
  CLEANUP: {
    /** Minutes of inactivity for ringing/dialing status before cleanup */
    STALE_RINGING_DIALING_MINUTES: parseInt(process.env.CHIME_STALE_RINGING_DIALING_MINUTES || '5', 10),
    
    /** Minutes for queued calls with meeting to be marked as orphaned */
    STALE_QUEUED_CALL_MINUTES: parseInt(process.env.CHIME_STALE_QUEUED_CALL_MINUTES || '30', 10),
    
    /** Minutes for ringing calls to be marked as abandoned */
    ABANDONED_RINGING_CALL_MINUTES: parseInt(process.env.CHIME_ABANDONED_RINGING_CALL_MINUTES || '10', 10),
  },
};

/**
 * Helper function to validate configuration at startup
 * Call this in Lambda handler initialization to catch config errors early
 */
export function validateChimeConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (CHIME_CONFIG.QUEUE.MAX_RING_AGENTS < 1 || CHIME_CONFIG.QUEUE.MAX_RING_AGENTS > 100) {
    errors.push('CHIME_MAX_RING_AGENTS must be between 1 and 100');
  }

  if (CHIME_CONFIG.QUEUE.TIMEOUT_SECONDS < 60) {
    errors.push('CHIME_QUEUE_TIMEOUT must be at least 60 seconds');
  }

  if (CHIME_CONFIG.AGENT.STALE_HEARTBEAT_MINUTES < 1) {
    errors.push('CHIME_STALE_HEARTBEAT_MINUTES must be at least 1');
  }

  if (CHIME_CONFIG.TRANSFER.MAX_NOTE_LENGTH < 100 || CHIME_CONFIG.TRANSFER.MAX_NOTE_LENGTH > 2000) {
    errors.push('CHIME_TRANSFER_NOTE_MAX must be between 100 and 2000');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Helper to log configuration at startup for debugging
 */
export function logChimeConfig(): void {
  console.log('[CHIME_CONFIG] Configuration loaded:', {
    queue: {
      maxRingAgents: CHIME_CONFIG.QUEUE.MAX_RING_AGENTS,
      timeoutSeconds: CHIME_CONFIG.QUEUE.TIMEOUT_SECONDS,
      avgCallDurationSeconds: CHIME_CONFIG.QUEUE.AVG_CALL_DURATION_SECONDS,
    },
    agent: {
      staleHeartbeatMinutes: CHIME_CONFIG.AGENT.STALE_HEARTBEAT_MINUTES,
      sessionMaxSeconds: CHIME_CONFIG.AGENT.SESSION_MAX_SECONDS,
      heartbeatGraceSeconds: CHIME_CONFIG.AGENT.HEARTBEAT_GRACE_SECONDS,
      maxConnectedCallMinutes: CHIME_CONFIG.AGENT.MAX_CONNECTED_CALL_MINUTES,
    },
    transfer: {
      maxNoteLength: CHIME_CONFIG.TRANSFER.MAX_NOTE_LENGTH,
    },
    retry: {
      maxAttempts: CHIME_CONFIG.RETRY.MAX_ATTEMPTS,
      baseDelayMs: CHIME_CONFIG.RETRY.BASE_DELAY_MS,
    },
    cleanup: {
      staleRingingDialingMinutes: CHIME_CONFIG.CLEANUP.STALE_RINGING_DIALING_MINUTES,
      stalQueuedCallMinutes: CHIME_CONFIG.CLEANUP.STALE_QUEUED_CALL_MINUTES,
      abandonedRingingCallMinutes: CHIME_CONFIG.CLEANUP.ABANDONED_RINGING_CALL_MINUTES,
    }
  });
}

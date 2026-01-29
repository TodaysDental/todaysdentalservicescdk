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
   * Hold Configuration
   * CRITICAL FIX: Moved from hardcoded values to configurable settings
   */
  HOLD: {
    /** Maximum hold duration in minutes before allowing stale hold override (default: 30 minutes) */
    MAX_HOLD_DURATION_MINUTES: parseInt(process.env.CHIME_MAX_HOLD_DURATION_MINUTES || '30', 10),

    /** Whether to allow supervisor override of active holds */
    ALLOW_SUPERVISOR_OVERRIDE: process.env.CHIME_HOLD_SUPERVISOR_OVERRIDE !== 'false',
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

  /**
   * Broadcast Ring Configuration
   * Ring strategy: 'broadcast' (ring all), 'parallel' (limited parallel), 'sequential'
   */
  BROADCAST: {
    /** Ring strategy: 'broadcast' | 'parallel' | 'sequential' */
    STRATEGY: (process.env.CHIME_RING_STRATEGY || 'parallel') as 'broadcast' | 'parallel' | 'sequential',

    /** Maximum agents to ring in broadcast mode (safety limit) */
    MAX_BROADCAST_AGENTS: parseInt(process.env.CHIME_MAX_BROADCAST_AGENTS || '100', 10),

    /** Ring timeout in seconds before fallback */
    RING_TIMEOUT_SECONDS: parseInt(process.env.CHIME_RING_TIMEOUT_SECONDS || '30', 10),

    /** Enable push notifications for ringing */
    ENABLE_PUSH_NOTIFICATIONS: process.env.CHIME_ENABLE_PUSH_NOTIFICATIONS !== 'false',

    /** Minimum agents to use broadcast (falls back to sequential if fewer) */
    MIN_AGENTS_FOR_BROADCAST: parseInt(process.env.CHIME_MIN_AGENTS_FOR_BROADCAST || '3', 10),
  },

  /**
   * Overflow Routing Configuration
   * Routes calls to sister clinics when primary clinic agents unavailable
   */
  OVERFLOW: {
    /** Enable overflow routing */
    ENABLED: process.env.CHIME_ENABLE_OVERFLOW === 'true',

    /** Seconds to wait before triggering overflow */
    WAIT_THRESHOLD_SECONDS: parseInt(process.env.CHIME_OVERFLOW_WAIT_THRESHOLD || '60', 10),

    /** Maximum clinics to include in overflow */
    MAX_OVERFLOW_CLINICS: parseInt(process.env.CHIME_MAX_OVERFLOW_CLINICS || '5', 10),

    /** Require skill match for overflow agents */
    REQUIRE_SKILL_MATCH: process.env.CHIME_OVERFLOW_REQUIRE_SKILL_MATCH !== 'false',

    /** Fallback action if no overflow agents: 'queue' | 'ai' | 'voicemail' */
    FALLBACK_ACTION: (process.env.CHIME_OVERFLOW_FALLBACK || 'queue') as 'queue' | 'ai' | 'voicemail',

    /** Default overflow clinic IDs (comma-separated) */
    DEFAULT_OVERFLOW_CLINICS: process.env.CHIME_DEFAULT_OVERFLOW_CLINICS || '',
  },

  /**
   * CloudWatch Metrics Configuration
   */
  METRICS: {
    /** Enable CloudWatch custom metrics */
    ENABLED: process.env.CHIME_METRICS_ENABLED !== 'false',

    /** CloudWatch namespace */
    NAMESPACE: process.env.CHIME_METRICS_NAMESPACE || 'TodaysDental/Chime',
  },

  /**
   * Enhanced Agent Selection Configuration
   */
  AGENT_SELECTION: {
    /** Enable time-of-day weighting */
    USE_TIME_OF_DAY_WEIGHTING: process.env.CHIME_USE_TIME_OF_DAY_WEIGHTING === 'true',

    /** Enable historical performance scoring */
    USE_HISTORICAL_PERFORMANCE: process.env.CHIME_USE_HISTORICAL_PERFORMANCE !== 'false',

    /** Enable fair distribution mode (round-robin style) */
    FAIR_DISTRIBUTION_MODE: process.env.CHIME_FAIR_DISTRIBUTION_MODE === 'true',

    /** Weight for performance vs availability (0-1) */
    PERFORMANCE_WEIGHT: parseFloat(process.env.CHIME_PERFORMANCE_WEIGHT || '0.3'),

    /** Max calls per agent before deprioritization */
    MAX_CALLS_BEFORE_DEPRIORITIZE: parseInt(process.env.CHIME_MAX_CALLS_BEFORE_DEPRIORITIZE || '15', 10),

    /** Time window for performance calculation (hours) */
    PERFORMANCE_WINDOW_HOURS: parseInt(process.env.CHIME_PERFORMANCE_WINDOW_HOURS || '24', 10),
  },

  /**
   * Sentiment Analysis Configuration
   */
  SENTIMENT: {
    /** Enable real-time sentiment analysis */
    ENABLE_REALTIME: process.env.CHIME_ENABLE_REALTIME_SENTIMENT !== 'false',

    /** Negative sentiment threshold for alerts (0-1) */
    NEGATIVE_ALERT_THRESHOLD: parseFloat(process.env.CHIME_NEGATIVE_SENTIMENT_THRESHOLD || '0.7'),

    /** Minimum text length to analyze */
    MIN_TEXT_LENGTH: parseInt(process.env.CHIME_MIN_SENTIMENT_TEXT_LENGTH || '20', 10),

    /** Enable supervisor sentiment alerts */
    ENABLE_SUPERVISOR_ALERTS: process.env.CHIME_ENABLE_SENTIMENT_ALERTS === 'true',
  },

  /**
   * Call Summarization Configuration
   */
  SUMMARIZATION: {
    /** Enable AI call summarization */
    ENABLED: process.env.CHIME_ENABLE_CALL_SUMMARY !== 'false',

    /** Bedrock model ID for summarization */
    MODEL_ID: process.env.BEDROCK_SUMMARY_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0',

    /** Maximum tokens for summary */
    MAX_TOKENS: parseInt(process.env.CHIME_SUMMARY_MAX_TOKENS || '1024', 10),

    /** Include sentiment in summary */
    INCLUDE_SENTIMENT: process.env.CHIME_SUMMARY_INCLUDE_SENTIMENT !== 'false',
  },

  /**
   * Quality Scoring Configuration
   */
  QUALITY: {
    /** Enable quality scoring */
    ENABLED: process.env.CHIME_ENABLE_QUALITY_SCORING !== 'false',

    /** Weight for audio quality (0-1) */
    WEIGHT_AUDIO: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AUDIO || '0.15'),

    /** Weight for agent performance (0-1) */
    WEIGHT_AGENT: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AGENT || '0.35'),

    /** Weight for customer experience (0-1) */
    WEIGHT_CUSTOMER: parseFloat(process.env.CHIME_QUALITY_WEIGHT_CUSTOMER || '0.35'),

    /** Weight for compliance (0-1) */
    WEIGHT_COMPLIANCE: parseFloat(process.env.CHIME_QUALITY_WEIGHT_COMPLIANCE || '0.15'),

    /** Minimum overall score before alert */
    ALERT_THRESHOLD_OVERALL: parseInt(process.env.CHIME_QUALITY_ALERT_THRESHOLD || '60', 10),
  },

  /**
   * Supervisor Tools Configuration
   */
  SUPERVISOR: {
    /** Enable supervisor monitoring tools */
    ENABLED: process.env.CHIME_ENABLE_SUPERVISOR_TOOLS !== 'false',

    /** Enable whisper mode */
    ENABLE_WHISPER: process.env.CHIME_ENABLE_WHISPER !== 'false',

    /** Enable barge-in mode */
    ENABLE_BARGE: process.env.CHIME_ENABLE_BARGE !== 'false',

    /** Maximum concurrent supervisions per supervisor */
    MAX_CONCURRENT_SUPERVISIONS: parseInt(process.env.CHIME_MAX_CONCURRENT_SUPERVISIONS || '5', 10),
  },

  /**
   * PII Redaction Configuration (HIPAA Compliance)
   */
  PII: {
    /** Enable PII detection and redaction */
    ENABLED: process.env.CHIME_ENABLE_PII_REDACTION !== 'false',

    /** Use AWS Comprehend for PII detection */
    USE_COMPREHEND: process.env.CHIME_USE_COMPREHEND_PII !== 'false',

    /** Enable audit logging for PII access */
    AUDIT_LOG: process.env.CHIME_PII_AUDIT_LOG === 'true',

    /** Replacement template for redacted text */
    REPLACEMENT_TEMPLATE: process.env.CHIME_PII_REPLACEMENT_TEMPLATE || '[REDACTED-{TYPE}]',
  },

  /**
   * Audit Logging Configuration (HIPAA Compliance)
   */
  AUDIT: {
    /** Enable audit logging */
    ENABLED: process.env.CHIME_ENABLE_AUDIT_LOGGING !== 'false',

    /** Log PII access events */
    LOG_PII_ACCESS: process.env.CHIME_LOG_PII_ACCESS === 'true',

    /** Retention period in days (HIPAA requires 6 years minimum) */
    RETENTION_DAYS: parseInt(process.env.CHIME_AUDIT_RETENTION_DAYS || '2555', 10),

    /** Enable CloudWatch audit logging */
    CLOUDWATCH_ENABLED: process.env.CHIME_AUDIT_CLOUDWATCH !== 'false',

    /** Redact sensitive data in audit logs */
    REDACT_SENSITIVE_DATA: process.env.CHIME_AUDIT_REDACT !== 'false',
  },

  /**
   * Circuit Breaker Configuration
   */
  CIRCUIT_BREAKER: {
    /** Failures before circuit opens */
    FAILURE_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_FAILURE_THRESHOLD || '5', 10),

    /** Time before attempting to close circuit (ms) */
    RESET_TIMEOUT_MS: parseInt(process.env.CHIME_CIRCUIT_RESET_TIMEOUT_MS || '30000', 10),

    /** Successes needed to fully close circuit */
    SUCCESS_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_SUCCESS_THRESHOLD || '3', 10),
  },

  /**
   * Performance Thresholds (ms)
   */
  PERFORMANCE: {
    THRESHOLD_AGENT_SELECTION: parseInt(process.env.PERF_THRESHOLD_AGENT_SELECTION || '200', 10),
    THRESHOLD_BROADCAST_RING: parseInt(process.env.PERF_THRESHOLD_BROADCAST_RING || '500', 10),
    THRESHOLD_DDB_QUERY: parseInt(process.env.PERF_THRESHOLD_DDB_QUERY || '100', 10),
    THRESHOLD_AI_RESPONSE: parseInt(process.env.PERF_THRESHOLD_AI_RESPONSE || '5000', 10),
    THRESHOLD_TOTAL_ROUTING: parseInt(process.env.PERF_THRESHOLD_TOTAL_ROUTING || '2000', 10),
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
    broadcast: {
      strategy: CHIME_CONFIG.BROADCAST.STRATEGY,
      maxBroadcastAgents: CHIME_CONFIG.BROADCAST.MAX_BROADCAST_AGENTS,
      ringTimeoutSeconds: CHIME_CONFIG.BROADCAST.RING_TIMEOUT_SECONDS,
      minAgentsForBroadcast: CHIME_CONFIG.BROADCAST.MIN_AGENTS_FOR_BROADCAST,
    },
    overflow: {
      enabled: CHIME_CONFIG.OVERFLOW.ENABLED,
      waitThresholdSeconds: CHIME_CONFIG.OVERFLOW.WAIT_THRESHOLD_SECONDS,
      maxOverflowClinics: CHIME_CONFIG.OVERFLOW.MAX_OVERFLOW_CLINICS,
      fallbackAction: CHIME_CONFIG.OVERFLOW.FALLBACK_ACTION,
    },
    agentSelection: {
      useTimeOfDayWeighting: CHIME_CONFIG.AGENT_SELECTION.USE_TIME_OF_DAY_WEIGHTING,
      fairDistributionMode: CHIME_CONFIG.AGENT_SELECTION.FAIR_DISTRIBUTION_MODE,
      performanceWeight: CHIME_CONFIG.AGENT_SELECTION.PERFORMANCE_WEIGHT,
    },
    sentiment: {
      enableRealtime: CHIME_CONFIG.SENTIMENT.ENABLE_REALTIME,
      negativeAlertThreshold: CHIME_CONFIG.SENTIMENT.NEGATIVE_ALERT_THRESHOLD,
      enableSupervisorAlerts: CHIME_CONFIG.SENTIMENT.ENABLE_SUPERVISOR_ALERTS,
    },
    summarization: {
      enabled: CHIME_CONFIG.SUMMARIZATION.ENABLED,
      modelId: CHIME_CONFIG.SUMMARIZATION.MODEL_ID,
    },
    quality: {
      enabled: CHIME_CONFIG.QUALITY.ENABLED,
      alertThreshold: CHIME_CONFIG.QUALITY.ALERT_THRESHOLD_OVERALL,
    },
    supervisor: {
      enabled: CHIME_CONFIG.SUPERVISOR.ENABLED,
      enableWhisper: CHIME_CONFIG.SUPERVISOR.ENABLE_WHISPER,
      enableBarge: CHIME_CONFIG.SUPERVISOR.ENABLE_BARGE,
    },
    pii: {
      enabled: CHIME_CONFIG.PII.ENABLED,
      useComprehend: CHIME_CONFIG.PII.USE_COMPREHEND,
    },
    audit: {
      enabled: CHIME_CONFIG.AUDIT.ENABLED,
      retentionDays: CHIME_CONFIG.AUDIT.RETENTION_DAYS,
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


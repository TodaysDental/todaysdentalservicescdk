"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/chime/queue-poller.ts
var queue_poller_exports = {};
__export(queue_poller_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(queue_poller_exports);

// src/services/shared/utils/dynamodb-manager.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_https = require("https");
var DynamoDBManager = class _DynamoDBManager {
  constructor(config = {}) {
    this.requestCount = 0;
    this.lastResetTime = Date.now();
    this.warmed = false;
    const httpsAgent = new import_https.Agent({
      maxSockets: config.maxSockets || 50,
      keepAlive: true,
      keepAliveMsecs: 1e3,
      maxFreeSockets: 10,
      // Keep some connections ready
      timeout: 6e4,
      scheduling: "lifo"
      // Reuse recent connections first
    });
    const clientConfig = {
      maxAttempts: config.maxRetries || 3,
      requestHandler: {
        requestTimeout: config.requestTimeout || 3e3,
        connectionTimeout: config.connectionTimeout || 1e3,
        httpsAgent
      }
    };
    this.client = new import_client_dynamodb.DynamoDBClient(clientConfig);
    this.documentClient = import_lib_dynamodb.DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
      },
      unmarshallOptions: {
        wrapNumbers: false
      }
    });
    console.log("[DynamoDBManager] Initialized with optimized connection pooling");
    this.warmConnections();
  }
  /**
   * Warm DynamoDB connections on Lambda cold start
   * Makes a lightweight query to establish connection pool
   */
  async warmConnections() {
    if (this.warmed)
      return;
    try {
      await this.documentClient.send(new import_lib_dynamodb.GetCommand({
        TableName: process.env.AGENT_PRESENCE_TABLE_NAME || "warmup-dummy",
        Key: { agentId: "__warmup__" }
      })).catch(() => {
      });
      this.warmed = true;
      console.log("[DynamoDBManager] Connections warmed successfully");
    } catch (err) {
      console.warn("[DynamoDBManager] Connection warming failed (non-fatal):", err);
    }
  }
  static getInstance(config) {
    if (!_DynamoDBManager.instance) {
      _DynamoDBManager.instance = new _DynamoDBManager(config);
    }
    return _DynamoDBManager.instance;
  }
  getDocumentClient() {
    this.requestCount++;
    if (this.requestCount % 1e3 === 0) {
      const elapsed = Date.now() - this.lastResetTime;
      const rps = 1e3 / elapsed * 1e3;
      console.log(`[DynamoDBManager] Metrics: ${this.requestCount} requests, ~${rps.toFixed(2)} req/sec`);
    }
    return this.documentClient;
  }
  getMetrics() {
    const elapsed = Date.now() - this.lastResetTime;
    return {
      requestCount: this.requestCount,
      elapsedMs: elapsed,
      requestsPerSecond: this.requestCount / elapsed * 1e3
    };
  }
  resetMetrics() {
    this.requestCount = 0;
    this.lastResetTime = Date.now();
  }
};
function getDynamoDBClient(config) {
  return DynamoDBManager.getInstance(config).getDocumentClient();
}

// src/services/chime/queue-poller.ts
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var import_lib_dynamodb6 = require("@aws-sdk/lib-dynamodb");

// src/services/chime/utils/check-queue-for-work.ts
var import_lib_dynamodb5 = require("@aws-sdk/lib-dynamodb");

// src/services/chime/utils/agent-selection.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var DEFAULT_CONFIG = {
  maxAgents: 25,
  considerIdleTime: true,
  considerWorkload: true,
  prioritizeContinuity: true,
  parallelRing: false
};
function scoreAgentForCall(agent, call, nowSeconds, config) {
  const breakdown = {
    skillMatch: 0,
    languageMatch: 0,
    idleTime: 0,
    workloadBalance: 0,
    continuity: 0,
    other: 0
  };
  let score = 0;
  const reasons = [];
  if (call.requiredSkills && call.requiredSkills.length > 0) {
    const agentSkills = agent.skills || [];
    const hasAllRequired = call.requiredSkills.every(
      (skill) => agentSkills.includes(skill)
    );
    if (!hasAllRequired) {
      return {
        agentId: agent.agentId,
        agent,
        score: -1e3,
        reasons: ["missing_required_skills"],
        breakdown
      };
    }
    breakdown.skillMatch += 50;
    score += 50;
    reasons.push("has_required_skills");
  }
  if (call.preferredSkills && call.preferredSkills.length > 0) {
    const agentSkills = agent.skills || [];
    const matchedPreferred = call.preferredSkills.filter(
      (skill) => agentSkills.includes(skill)
    );
    const preferredBonus = matchedPreferred.length * 10;
    breakdown.skillMatch += preferredBonus;
    score += preferredBonus;
    if (matchedPreferred.length > 0) {
      reasons.push(`matched_${matchedPreferred.length}_preferred_skills`);
    }
  }
  if (call.language) {
    const agentLanguages = agent.languages || ["en"];
    if (agentLanguages.includes(call.language)) {
      breakdown.languageMatch += 30;
      score += 30;
      reasons.push("language_match");
    } else {
      return {
        agentId: agent.agentId,
        agent,
        score: -1e3,
        reasons: ["language_mismatch"],
        breakdown
      };
    }
  }
  if (call.isVip) {
    if (!agent.canHandleVip) {
      return {
        agentId: agent.agentId,
        agent,
        score: -1e3,
        reasons: ["cannot_handle_vip"],
        breakdown
      };
    }
    breakdown.other += 40;
    score += 40;
    reasons.push("vip_capable");
  }
  if (config.considerIdleTime && agent.lastActivityAt) {
    const lastActivitySeconds = Math.floor(
      new Date(agent.lastActivityAt).getTime() / 1e3
    );
    const idleSeconds = nowSeconds - lastActivitySeconds;
    const idleMinutes = Math.floor(idleSeconds / 60);
    let idleBonus;
    if (idleMinutes <= 5) {
      idleBonus = idleMinutes * 10;
    } else if (idleMinutes <= 30) {
      idleBonus = 50 + Math.log2(idleMinutes - 4) * 10;
    } else {
      idleBonus = 100;
    }
    idleBonus = Math.min(Math.floor(idleBonus), 100);
    breakdown.idleTime += idleBonus;
    score += idleBonus;
    reasons.push(`idle_${idleMinutes}min_bonus_${idleBonus}`);
  }
  if (config.considerWorkload) {
    const recentCallCount = agent.recentCallCount || 0;
    const workloadPenalty = recentCallCount * 5;
    breakdown.workloadBalance -= workloadPenalty;
    score -= workloadPenalty;
    if (recentCallCount > 0) {
      reasons.push(`recent_calls_${recentCallCount}`);
    }
    const completedToday = agent.completedCallsToday || 0;
    if (completedToday < 10) {
      const balanceBonus = (10 - completedToday) * 2;
      breakdown.workloadBalance += balanceBonus;
      score += balanceBonus;
      reasons.push(`low_daily_count_${completedToday}`);
    }
  }
  if (config.prioritizeContinuity && call.isCallback && call.previousAgentId) {
    if (agent.agentId === call.previousAgentId) {
      breakdown.continuity += 100;
      score += 100;
      reasons.push("previous_handler");
    }
  }
  if (agent.lastCallCustomerPhone === call.phoneNumber) {
    const relationshipBonus = 50;
    breakdown.continuity += relationshipBonus;
    score += relationshipBonus;
    reasons.push("customer_relationship");
  }
  return {
    agentId: agent.agentId,
    agent,
    score,
    reasons,
    breakdown
  };
}
function selectBestAgents(agents, callContext, config = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const nowSeconds = Math.floor(Date.now() / 1e3);
  console.log("[selectBestAgents] Evaluating agents", {
    totalAgents: agents.length,
    callId: callContext.callId,
    priority: callContext.priority,
    isCallback: callContext.isCallback
  });
  let scoredAgents = agents.map((agent) => scoreAgentForCall(agent, callContext, nowSeconds, fullConfig)).filter((scored) => scored.score > -1e3);
  if (scoredAgents.length === 0 && callContext.requiredSkills) {
    console.warn("[selectBestAgents] No agents with required skills, trying flexible match");
    const relaxedContext = {
      ...callContext,
      preferredSkills: [...callContext.preferredSkills || [], ...callContext.requiredSkills],
      requiredSkills: []
    };
    scoredAgents = agents.map((agent) => scoreAgentForCall(agent, relaxedContext, nowSeconds, fullConfig)).filter((scored) => scored.score > -1e3);
    if (scoredAgents.length > 0) {
      console.log(`[selectBestAgents] Found ${scoredAgents.length} agents with flexible matching`);
    }
  }
  if (scoredAgents.length === 0) {
    console.warn("[selectBestAgents] No qualified agents found, using any available agent");
    const desperateContext = {
      ...callContext,
      requiredSkills: [],
      preferredSkills: [],
      language: void 0,
      // Relax language requirement too
      isVip: false
      // Don't require VIP capability
    };
    scoredAgents = agents.map((agent) => scoreAgentForCall(agent, desperateContext, nowSeconds, fullConfig)).filter((scored) => scored.score > -1e3);
  }
  if (scoredAgents.length === 0) {
    console.error("[selectBestAgents] No agents available at all");
    return [];
  }
  scoredAgents.sort((a, b) => b.score - a.score);
  const topCandidates = scoredAgents.slice(0, Math.min(5, scoredAgents.length));
  console.log(
    "[selectBestAgents] Top candidates:",
    topCandidates.map((s) => ({
      agentId: s.agentId,
      score: s.score,
      breakdown: s.breakdown,
      reasons: s.reasons
    }))
  );
  const selectedCount = Math.min(fullConfig.maxAgents, scoredAgents.length);
  const selected = scoredAgents.slice(0, selectedCount).map((s) => s.agent);
  console.log(`[selectBestAgents] Selected ${selected.length} agents for call ${callContext.callId}`);
  return selected;
}

// src/services/chime/utils/push-notifications.ts
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");

// src/services/chime/config.ts
var CHIME_CONFIG = {
  /**
   * Call Queue Configuration
   */
  QUEUE: {
    /** Maximum number of agents to ring simultaneously for incoming calls */
    MAX_RING_AGENTS: parseInt(process.env.CHIME_MAX_RING_AGENTS || "25", 10),
    /** Timeout for calls stuck in queue (seconds) */
    TIMEOUT_SECONDS: parseInt(process.env.CHIME_QUEUE_TIMEOUT || String(24 * 60 * 60), 10),
    /** Average call duration for capacity planning (seconds) */
    AVG_CALL_DURATION_SECONDS: parseInt(process.env.CHIME_AVG_CALL_DURATION || "300", 10)
  },
  /**
   * Agent Management Configuration
   */
  AGENT: {
    /** Minutes of inactivity before agent marked offline */
    STALE_HEARTBEAT_MINUTES: parseInt(process.env.CHIME_STALE_HEARTBEAT_MINUTES || "15", 10),
    /** Maximum agent session duration (seconds) */
    SESSION_MAX_SECONDS: parseInt(process.env.CHIME_SESSION_MAX_SECONDS || String(8 * 60 * 60), 10),
    /** Grace period after last heartbeat before cleanup (seconds) */
    HEARTBEAT_GRACE_SECONDS: parseInt(process.env.CHIME_HEARTBEAT_GRACE_SECONDS || String(15 * 60), 10),
    /** Maximum connected call duration before auto-hangup (minutes) */
    MAX_CONNECTED_CALL_MINUTES: parseInt(process.env.CHIME_MAX_CONNECTED_CALL_MINUTES || "60", 10),
    /**
     * Wrap-up period after a call ends (seconds).
     * Delays the next queue check to give agents time for note-taking.
     * Set to 0 to disable (immediate re-dispatch).
     * @default 0
     */
    WRAP_UP_SECONDS: parseInt(process.env.CHIME_WRAP_UP_SECONDS || "0", 10)
  },
  /**
   * Dispatch Configuration
   * Controls how the fair-share dispatcher allocates agents to queued calls.
   */
  DISPATCH: {
    /** Maximum calls that can ring simultaneously per clinic (static limit) */
    MAX_SIMUL_RING_CALLS: parseInt(process.env.CHIME_MAX_SIMUL_RING_CALLS || "10", 10),
    /**
     * Enable dynamic scaling of MAX_SIMUL_RING_CALLS based on available agents.
     * Formula: min(max(10, ceil(idleAgents / 2)), DYNAMIC_SIMUL_RING_MAX)
     * @default true
     */
    DYNAMIC_SIMUL_RING: process.env.CHIME_DYNAMIC_SIMUL_RING !== "false",
    /** Upper bound for dynamic simultaneous ring calls */
    DYNAMIC_SIMUL_RING_MAX: parseInt(process.env.CHIME_DYNAMIC_SIMUL_RING_MAX || "50", 10),
    /**
     * Enable priority-weighted agent allocation.
     * Higher-priority calls get proportionally more agents instead of even distribution.
     * @default true
     */
    PRIORITY_WEIGHTED_ALLOCATION: process.env.CHIME_PRIORITY_WEIGHTED_ALLOCATION !== "false",
    /**
     * Enable parallel clinic dispatch.
     * Dispatches to all clinics concurrently instead of sequentially.
     * Safe because each clinic uses its own distributed lock.
     * @default true
     */
    PARALLEL_CLINIC_DISPATCH: process.env.CHIME_PARALLEL_CLINIC_DISPATCH !== "false",
    /**
     * Enable ring timeout escalation.
     * After each ring timeout, escalate the routing strategy:
     * Attempt 1: re-ring with different agents
     * Attempt 2: trigger overflow routing
     * Attempt 3+: offer voicemail/AI fallback
     * @default true
     */
    RING_TIMEOUT_ESCALATION: process.env.CHIME_RING_TIMEOUT_ESCALATION !== "false",
    /** Maximum ring attempts before final fallback */
    RING_ESCALATION_MAX_ATTEMPTS: parseInt(process.env.CHIME_RING_ESCALATION_MAX_ATTEMPTS || "3", 10)
  },
  /**
   * Hold Configuration
   * CRITICAL FIX: Moved from hardcoded values to configurable settings
   */
  HOLD: {
    /** Maximum hold duration in minutes before allowing stale hold override (default: 30 minutes) */
    MAX_HOLD_DURATION_MINUTES: parseInt(process.env.CHIME_MAX_HOLD_DURATION_MINUTES || "30", 10),
    /** Whether to allow supervisor override of active holds */
    ALLOW_SUPERVISOR_OVERRIDE: process.env.CHIME_HOLD_SUPERVISOR_OVERRIDE !== "false"
  },
  /**
   * Transfer Configuration
   */
  TRANSFER: {
    /** Maximum length of transfer notes field */
    MAX_NOTE_LENGTH: parseInt(process.env.CHIME_TRANSFER_NOTE_MAX || "500", 10)
  },
  /**
   * Retry Configuration
   */
  RETRY: {
    /** Maximum number of retry attempts for Lambda invocations */
    MAX_ATTEMPTS: parseInt(process.env.CHIME_RETRY_MAX_ATTEMPTS || "3", 10),
    /** Base delay between retries (milliseconds) */
    BASE_DELAY_MS: parseInt(process.env.CHIME_RETRY_BASE_DELAY_MS || "1000", 10)
  },
  /**
   * Cleanup Configuration
   */
  CLEANUP: {
    /** Minutes of inactivity for ringing/dialing status before cleanup */
    STALE_RINGING_DIALING_MINUTES: parseInt(process.env.CHIME_STALE_RINGING_DIALING_MINUTES || "5", 10),
    /** Minutes for queued calls with meeting to be marked as orphaned */
    STALE_QUEUED_CALL_MINUTES: parseInt(process.env.CHIME_STALE_QUEUED_CALL_MINUTES || "30", 10),
    /** Minutes for ringing calls to be marked as abandoned */
    ABANDONED_RINGING_CALL_MINUTES: parseInt(process.env.CHIME_ABANDONED_RINGING_CALL_MINUTES || "10", 10)
  },
  /**
   * Broadcast Ring Configuration
   * Ring strategy: 'broadcast' (ring all), 'parallel' (limited parallel), 'sequential'
   */
  BROADCAST: {
    /** Ring strategy: 'broadcast' | 'parallel' | 'sequential' */
    STRATEGY: process.env.CHIME_RING_STRATEGY || "parallel",
    /** Maximum agents to ring in broadcast mode (safety limit) */
    MAX_BROADCAST_AGENTS: parseInt(process.env.CHIME_MAX_BROADCAST_AGENTS || "100", 10),
    /** Ring timeout in seconds before fallback */
    RING_TIMEOUT_SECONDS: parseInt(process.env.CHIME_RING_TIMEOUT_SECONDS || "30", 10),
    /** Enable push notifications for ringing */
    ENABLE_PUSH_NOTIFICATIONS: process.env.CHIME_ENABLE_PUSH_NOTIFICATIONS !== "false",
    /** Minimum agents to use broadcast (falls back to sequential if fewer) */
    MIN_AGENTS_FOR_BROADCAST: parseInt(process.env.CHIME_MIN_AGENTS_FOR_BROADCAST || "3", 10)
  },
  /**
   * Push Notification Configuration
   * Controls when push notifications are sent for call-lifecycle events
   */
  PUSH: {
    /** Number of queued calls before sending a backup alert to all active agents */
    QUEUE_BACKUP_ALERT_THRESHOLD: parseInt(process.env.CHIME_QUEUE_BACKUP_ALERT_THRESHOLD || "3", 10),
    /** Enable push notifications when a call is transferred to an agent */
    ENABLE_TRANSFER_PUSH: process.env.CHIME_ENABLE_TRANSFER_PUSH !== "false",
    /** Enable push notification when an outbound call is initiated (mobile state sync) */
    ENABLE_OUTBOUND_CALL_PUSH: process.env.CHIME_ENABLE_OUTBOUND_CALL_PUSH !== "false",
    /** Enable push notification when an agent is added to a conference */
    ENABLE_CONFERENCE_JOIN_PUSH: process.env.CHIME_ENABLE_CONFERENCE_JOIN_PUSH !== "false",
    /** Enable push notification on hold/resume (mobile state sync) */
    ENABLE_HOLD_RESUME_PUSH: process.env.CHIME_ENABLE_HOLD_RESUME_PUSH !== "false",
    /** Enable push alert to supervisors when an agent goes offline (opt-in, can be noisy) */
    ENABLE_SESSION_OFFLINE_ALERT: process.env.CHIME_ENABLE_SESSION_OFFLINE_ALERT === "true",
    /** Enable call_cancelled push when a queued call is manually picked up (stops phantom ringing) */
    ENABLE_QUEUE_PICKUP_CANCEL_PUSH: process.env.CHIME_ENABLE_QUEUE_PICKUP_CANCEL_PUSH !== "false",
    /** Enable push notification when agent leaves a call (mobile state sync) */
    ENABLE_LEAVE_CALL_PUSH: process.env.CHIME_ENABLE_LEAVE_CALL_PUSH !== "false"
  },
  /**
   * Overflow Routing Configuration
   * Routes calls to sister clinics when primary clinic agents unavailable
   */
  OVERFLOW: {
    /** Enable overflow routing */
    ENABLED: process.env.CHIME_ENABLE_OVERFLOW === "true",
    /** Seconds to wait before triggering overflow */
    WAIT_THRESHOLD_SECONDS: parseInt(process.env.CHIME_OVERFLOW_WAIT_THRESHOLD || "60", 10),
    /** Maximum clinics to include in overflow */
    MAX_OVERFLOW_CLINICS: parseInt(process.env.CHIME_MAX_OVERFLOW_CLINICS || "5", 10),
    /** Require skill match for overflow agents */
    REQUIRE_SKILL_MATCH: process.env.CHIME_OVERFLOW_REQUIRE_SKILL_MATCH !== "false",
    /** Fallback action if no overflow agents: 'queue' | 'ai' | 'voicemail' */
    FALLBACK_ACTION: process.env.CHIME_OVERFLOW_FALLBACK || "queue",
    /** Default overflow clinic IDs (comma-separated) */
    DEFAULT_OVERFLOW_CLINICS: process.env.CHIME_DEFAULT_OVERFLOW_CLINICS || ""
  },
  /**
   * CloudWatch Metrics Configuration
   */
  METRICS: {
    /** Enable CloudWatch custom metrics */
    ENABLED: process.env.CHIME_METRICS_ENABLED !== "false",
    /** CloudWatch namespace */
    NAMESPACE: process.env.CHIME_METRICS_NAMESPACE || "TodaysDental/Chime"
  },
  /**
   * Enhanced Agent Selection Configuration
   */
  AGENT_SELECTION: {
    /** Enable time-of-day weighting */
    USE_TIME_OF_DAY_WEIGHTING: process.env.CHIME_USE_TIME_OF_DAY_WEIGHTING === "true",
    /** Enable historical performance scoring */
    USE_HISTORICAL_PERFORMANCE: process.env.CHIME_USE_HISTORICAL_PERFORMANCE !== "false",
    /** Enable fair distribution mode (round-robin style) */
    FAIR_DISTRIBUTION_MODE: process.env.CHIME_FAIR_DISTRIBUTION_MODE === "true",
    /** Weight for performance vs availability (0-1) */
    PERFORMANCE_WEIGHT: parseFloat(process.env.CHIME_PERFORMANCE_WEIGHT || "0.3"),
    /** Max calls per agent before deprioritization */
    MAX_CALLS_BEFORE_DEPRIORITIZE: parseInt(process.env.CHIME_MAX_CALLS_BEFORE_DEPRIORITIZE || "15", 10),
    /** Time window for performance calculation (hours) */
    PERFORMANCE_WINDOW_HOURS: parseInt(process.env.CHIME_PERFORMANCE_WINDOW_HOURS || "24", 10)
  },
  /**
   * Sentiment Analysis Configuration
   */
  SENTIMENT: {
    /** Enable real-time sentiment analysis */
    ENABLE_REALTIME: process.env.CHIME_ENABLE_REALTIME_SENTIMENT !== "false",
    /** Negative sentiment threshold for alerts (0-1) */
    NEGATIVE_ALERT_THRESHOLD: parseFloat(process.env.CHIME_NEGATIVE_SENTIMENT_THRESHOLD || "0.7"),
    /** Minimum text length to analyze */
    MIN_TEXT_LENGTH: parseInt(process.env.CHIME_MIN_SENTIMENT_TEXT_LENGTH || "20", 10),
    /** Enable supervisor sentiment alerts */
    ENABLE_SUPERVISOR_ALERTS: process.env.CHIME_ENABLE_SENTIMENT_ALERTS === "true"
  },
  /**
   * Call Summarization Configuration
   */
  SUMMARIZATION: {
    /** Enable AI call summarization */
    ENABLED: process.env.CHIME_ENABLE_CALL_SUMMARY !== "false",
    /** Bedrock model ID for summarization */
    MODEL_ID: process.env.BEDROCK_SUMMARY_MODEL_ID || "anthropic.claude-3-sonnet-20240229-v1:0",
    /** Maximum tokens for summary */
    MAX_TOKENS: parseInt(process.env.CHIME_SUMMARY_MAX_TOKENS || "1024", 10),
    /** Include sentiment in summary */
    INCLUDE_SENTIMENT: process.env.CHIME_SUMMARY_INCLUDE_SENTIMENT !== "false"
  },
  /**
   * Quality Scoring Configuration
   */
  QUALITY: {
    /** Enable quality scoring */
    ENABLED: process.env.CHIME_ENABLE_QUALITY_SCORING !== "false",
    /** Weight for audio quality (0-1) */
    WEIGHT_AUDIO: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AUDIO || "0.15"),
    /** Weight for agent performance (0-1) */
    WEIGHT_AGENT: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AGENT || "0.35"),
    /** Weight for customer experience (0-1) */
    WEIGHT_CUSTOMER: parseFloat(process.env.CHIME_QUALITY_WEIGHT_CUSTOMER || "0.35"),
    /** Weight for compliance (0-1) */
    WEIGHT_COMPLIANCE: parseFloat(process.env.CHIME_QUALITY_WEIGHT_COMPLIANCE || "0.15"),
    /** Minimum overall score before alert */
    ALERT_THRESHOLD_OVERALL: parseInt(process.env.CHIME_QUALITY_ALERT_THRESHOLD || "60", 10)
  },
  /**
   * Supervisor Tools Configuration
   */
  SUPERVISOR: {
    /** Enable supervisor monitoring tools */
    ENABLED: process.env.CHIME_ENABLE_SUPERVISOR_TOOLS !== "false",
    /** Enable whisper mode */
    ENABLE_WHISPER: process.env.CHIME_ENABLE_WHISPER !== "false",
    /** Enable barge-in mode */
    ENABLE_BARGE: process.env.CHIME_ENABLE_BARGE !== "false",
    /** Maximum concurrent supervisions per supervisor */
    MAX_CONCURRENT_SUPERVISIONS: parseInt(process.env.CHIME_MAX_CONCURRENT_SUPERVISIONS || "5", 10)
  },
  /**
   * PII Redaction Configuration (HIPAA Compliance)
   */
  PII: {
    /** Enable PII detection and redaction */
    ENABLED: process.env.CHIME_ENABLE_PII_REDACTION !== "false",
    /** Use AWS Comprehend for PII detection */
    USE_COMPREHEND: process.env.CHIME_USE_COMPREHEND_PII !== "false",
    /** Enable audit logging for PII access */
    AUDIT_LOG: process.env.CHIME_PII_AUDIT_LOG === "true",
    /** Replacement template for redacted text */
    REPLACEMENT_TEMPLATE: process.env.CHIME_PII_REPLACEMENT_TEMPLATE || "[REDACTED-{TYPE}]"
  },
  /**
   * Audit Logging Configuration (HIPAA Compliance)
   */
  AUDIT: {
    /** Enable audit logging */
    ENABLED: process.env.CHIME_ENABLE_AUDIT_LOGGING !== "false",
    /** Log PII access events */
    LOG_PII_ACCESS: process.env.CHIME_LOG_PII_ACCESS === "true",
    /** Retention period in days (HIPAA requires 6 years minimum) */
    RETENTION_DAYS: parseInt(process.env.CHIME_AUDIT_RETENTION_DAYS || "2555", 10),
    /** Enable CloudWatch audit logging */
    CLOUDWATCH_ENABLED: process.env.CHIME_AUDIT_CLOUDWATCH !== "false",
    /** Redact sensitive data in audit logs */
    REDACT_SENSITIVE_DATA: process.env.CHIME_AUDIT_REDACT !== "false"
  },
  /**
   * Circuit Breaker Configuration
   */
  CIRCUIT_BREAKER: {
    /** Failures before circuit opens */
    FAILURE_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_FAILURE_THRESHOLD || "5", 10),
    /** Time before attempting to close circuit (ms) */
    RESET_TIMEOUT_MS: parseInt(process.env.CHIME_CIRCUIT_RESET_TIMEOUT_MS || "30000", 10),
    /** Successes needed to fully close circuit */
    SUCCESS_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_SUCCESS_THRESHOLD || "3", 10)
  },
  /**
   * Performance Thresholds (ms)
   */
  PERFORMANCE: {
    THRESHOLD_AGENT_SELECTION: parseInt(process.env.PERF_THRESHOLD_AGENT_SELECTION || "200", 10),
    THRESHOLD_BROADCAST_RING: parseInt(process.env.PERF_THRESHOLD_BROADCAST_RING || "500", 10),
    THRESHOLD_DDB_QUERY: parseInt(process.env.PERF_THRESHOLD_DDB_QUERY || "100", 10),
    THRESHOLD_AI_RESPONSE: parseInt(process.env.PERF_THRESHOLD_AI_RESPONSE || "5000", 10),
    THRESHOLD_TOTAL_ROUTING: parseInt(process.env.PERF_THRESHOLD_TOTAL_ROUTING || "2000", 10)
  }
};

// src/services/chime/utils/push-notifications.ts
var SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || "";
var PUSH_NOTIFICATIONS_ENABLED = !!SEND_PUSH_FUNCTION_ARN;
var lambdaClient = null;
var cwClient = null;
function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new import_client_lambda.LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return lambdaClient;
}
function getCloudWatchClient() {
  if (!cwClient) {
    cwClient = new import_client_cloudwatch.CloudWatchClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return cwClient;
}
function isPushNotificationsEnabled() {
  return PUSH_NOTIFICATIONS_ENABLED;
}
async function invokeSendPushLambda(payload, options = {}) {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    console.log("[ChimePush] Push notifications not configured, skipping");
    return { success: false, error: "Push notifications not configured" };
  }
  const { sync = false, skipPreferenceCheck = false } = options;
  try {
    const invocationType = sync ? "RequestResponse" : "Event";
    const response = await getLambdaClient().send(new import_client_lambda.InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify({
        _internalCall: true,
        skipPreferenceCheck,
        ...payload
      }),
      InvocationType: invocationType
    }));
    if (!sync) {
      const success = response.StatusCode === 202 || response.StatusCode === 200;
      if (!success) {
        console.error(`[ChimePush] Async Lambda invocation failed, StatusCode: ${response.StatusCode}`);
      } else {
        console.log(`[ChimePush] Async Lambda invoked, StatusCode: ${response.StatusCode}`);
      }
      return { success };
    }
    if (response.Payload) {
      const payloadStr = new TextDecoder().decode(response.Payload);
      const result = JSON.parse(payloadStr);
      if (response.FunctionError) {
        console.error("[ChimePush] Lambda function error:", result);
        return {
          success: false,
          error: result.errorMessage || "Lambda function error"
        };
      }
      if (result.statusCode && result.body) {
        const body = JSON.parse(result.body);
        return {
          success: result.statusCode === 200,
          sent: body.sent,
          failed: body.failed,
          error: body.error
        };
      }
      return { success: true, ...result };
    }
    return { success: true };
  } catch (error) {
    console.error("[ChimePush] Failed to invoke send-push Lambda:", error.message);
    return { success: false, error: error.message };
  }
}
async function invokeSendPushLambdaWithRetry(payload, options = {}) {
  const { maxRetries = 2, ...invokeOptions } = options;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await invokeSendPushLambda(payload, invokeOptions);
    if (result.success) {
      return result;
    }
    lastError = result.error;
    if (result.error?.includes("not configured") || result.error?.includes("Invalid") || result.error?.includes("Unauthorized")) {
      break;
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100));
      console.log(`[ChimePush] Retrying push notification (attempt ${attempt + 2})`);
    }
  }
  return { success: false, error: lastError || "Max retries exceeded" };
}
async function emitPushMetric(metricName, dimensions, value = 1) {
  if (!CHIME_CONFIG.METRICS.ENABLED)
    return;
  try {
    await getCloudWatchClient().send(new import_client_cloudwatch.PutMetricDataCommand({
      Namespace: CHIME_CONFIG.METRICS.NAMESPACE,
      MetricData: [{
        MetricName: metricName,
        Dimensions: [
          { Name: "NotificationType", Value: dimensions.notificationType }
        ],
        Value: value,
        Unit: "Count",
        Timestamp: /* @__PURE__ */ new Date()
      }]
    }));
  } catch (err) {
    console.warn(`[ChimePush] Failed to emit ${metricName} metric:`, err.message);
  }
}
function formatPhoneNumber(phone) {
  if (!phone)
    return "Unknown";
  const cleaned = phone.replace(/^\+1/, "").replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}
function getCallerDisplay(data) {
  if (data.callerName && data.callerName !== "Unknown") {
    return data.callerName;
  }
  return formatPhoneNumber(data.callerPhoneNumber || "Unknown caller");
}
async function sendIncomingCallToAgents(agentUserIds, notification) {
  if (!PUSH_NOTIFICATIONS_ENABLED || agentUserIds.length === 0) {
    console.log("[ChimePush] sendIncomingCallToAgents skipped", {
      pushEnabled: PUSH_NOTIFICATIONS_ENABLED,
      agentCount: agentUserIds.length,
      callId: notification.callId
    });
    return;
  }
  console.log("[ChimePush] \u{1F4DE} Sending incoming-call push notification", {
    callId: notification.callId,
    clinicId: notification.clinicId,
    clinicName: notification.clinicName,
    callerPhoneNumber: notification.callerPhoneNumber,
    targetAgentIds: agentUserIds,
    agentCount: agentUserIds.length,
    timestamp: notification.timestamp,
    sendPushArn: process.env.SEND_PUSH_FUNCTION_ARN?.substring(0, 60) + "..."
  });
  const callerDisplay = getCallerDisplay(notification);
  const idempotencyKey = `incoming_call:${notification.callId}:agents:${notification.timestamp}`;
  const result = await invokeSendPushLambdaWithRetry({
    userIds: agentUserIds,
    notification: {
      title: "Incoming Call",
      body: `${callerDisplay} calling ${notification.clinicName}`,
      type: "incoming_call",
      // Use system default sound across platforms (iOS app does not bundle ringtone.caf).
      sound: "default",
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        action: "answer_call",
        timestamp: notification.timestamp
      },
      category: "INCOMING_CALL"
    }
  }, {
    sync: true,
    skipPreferenceCheck: true,
    maxRetries: 2
  });
  if (result.success) {
    console.log(`[ChimePush] \u2705 Incoming call push delivered`, {
      callId: notification.callId,
      agentCount: agentUserIds.length,
      agents: agentUserIds,
      response: `sent=${result.sent ?? "?"}, failed=${result.failed ?? "?"}`
    });
    emitPushMetric("PushDelivered", { notificationType: "incoming_call" }, result.sent || agentUserIds.length);
  } else {
    console.error(`[ChimePush] \u274C Failed to push incoming call notification`, {
      callId: notification.callId,
      error: result.error,
      agents: agentUserIds,
      clinicId: notification.clinicId
    });
    emitPushMetric("PushFailed", { notificationType: "incoming_call" });
  }
}
async function sendClinicAlert(clinicId, title, message, alertData) {
  if (!PUSH_NOTIFICATIONS_ENABLED)
    return;
  const result = await invokeSendPushLambda({
    clinicId,
    notification: {
      title,
      body: message,
      type: "staff_alert",
      sound: "alert.caf",
      data: {
        clinicId,
        ...alertData,
        action: "view_dashboard",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    }
  });
  if (result.success) {
    console.log(`[ChimePush] Sent clinic alert for ${clinicId}: ${title}`);
  }
}

// src/services/chime/utils/rejection-tracker.ts
var DEFAULT_CONFIG2 = {
  rejectionWindowMinutes: 5,
  maxRejections: 50
};
var RejectionTracker = class {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG2, ...config };
  }
  /**
   * Check if agent recently rejected this call
   * Uses time-window approach instead of checking against a list
   */
  hasRecentlyRejected(callRecord, agentId) {
    const rejections = callRecord.rejections || {};
    const rejectedAt = rejections[agentId];
    if (!rejectedAt) {
      return false;
    }
    const rejectionAge = Date.now() - new Date(rejectedAt).getTime();
    const windowMs = this.config.rejectionWindowMinutes * 60 * 1e3;
    const hasRejected = rejectionAge < windowMs;
    if (hasRejected) {
      const minutesAgo = Math.floor(rejectionAge / (60 * 1e3));
      console.log(`[RejectionTracker] Agent ${agentId} rejected call ${callRecord.callId} ${minutesAgo} min ago (within ${this.config.rejectionWindowMinutes} min window)`);
    }
    return hasRejected;
  }
  /**
   * Record a rejection with timestamp
   * Returns DynamoDB update expression
   */
  recordRejection(callId, agentId) {
    return {
      UpdateExpression: "SET rejections.#agentId = :timestamp, rejectionCount = if_not_exists(rejectionCount, :zero) + :one, lastRejectionAt = :timestamp",
      ExpressionAttributeNames: {
        "#agentId": agentId
      },
      ExpressionAttributeValues: {
        ":timestamp": (/* @__PURE__ */ new Date()).toISOString(),
        ":zero": 0,
        ":one": 1
      }
    };
  }
  /**
   * Get agents who haven't rejected this call recently
   * Filters out agents within the rejection window
   */
  filterEligibleAgents(callRecord, agents) {
    const eligible = agents.filter(
      (agentId) => !this.hasRecentlyRejected(callRecord, agentId)
    );
    const filtered = agents.length - eligible.length;
    if (filtered > 0) {
      console.log(`[RejectionTracker] Filtered ${filtered} agents who recently rejected call ${callRecord.callId}`);
    }
    return eligible;
  }
  /**
   * Check if call has exceeded rejection limit
   */
  hasExceededRejectionLimit(callRecord) {
    const count = callRecord.rejectionCount || 0;
    return count >= this.config.maxRejections;
  }
  /**
   * Get rejection statistics for a call
   */
  getStatistics(callRecord) {
    const rejections = callRecord.rejections || {};
    const rejectionCount = callRecord.rejectionCount || 0;
    const now = Date.now();
    const windowMs = this.config.rejectionWindowMinutes * 60 * 1e3;
    let recentCount = 0;
    let oldestTimestamp = null;
    let newestTimestamp = null;
    for (const [agentId, timestamp] of Object.entries(rejections)) {
      if (typeof timestamp !== "string")
        continue;
      const rejectionTime = new Date(timestamp).getTime();
      const age = now - rejectionTime;
      if (age < windowMs) {
        recentCount++;
      }
      if (!oldestTimestamp || timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
      }
      if (!newestTimestamp || timestamp > newestTimestamp) {
        newestTimestamp = timestamp;
      }
    }
    return {
      totalRejections: rejectionCount,
      recentRejections: recentCount,
      oldestRejection: oldestTimestamp,
      newestRejection: newestTimestamp,
      exceededLimit: this.hasExceededRejectionLimit(callRecord)
    };
  }
  /**
   * Generate cleanup update expression for old rejections
   * This is used by cleanup-monitor to prune old timestamps
   */
  getCleanupExpression() {
    const cutoffTime = new Date(
      Date.now() - this.config.rejectionWindowMinutes * 60 * 1e3
    ).toISOString();
    return {
      UpdateExpression: "SET lastRejectionCleanup = :now",
      ConditionExpression: "attribute_exists(rejections) AND (attribute_not_exists(lastRejectionCleanup) OR lastRejectionCleanup < :cutoff)",
      ExpressionAttributeNames: {},
      ExpressionAttributeValues: {
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":cutoff": cutoffTime
      }
    };
  }
  /**
   * Clean up old rejection timestamps for a specific call
   * More aggressive cleanup that removes expired individual entries
   */
  cleanupOldRejections(callRecord) {
    const rejections = callRecord.rejections || {};
    const now = Date.now();
    const windowMs = this.config.rejectionWindowMinutes * 60 * 1e3;
    const cleanedAgents = [];
    const remainingAgents = [];
    for (const [agentId, timestamp] of Object.entries(rejections)) {
      if (typeof timestamp !== "string")
        continue;
      const rejectionTime = new Date(timestamp).getTime();
      const age = now - rejectionTime;
      if (age >= windowMs) {
        cleanedAgents.push(agentId);
      } else {
        remainingAgents.push(agentId);
      }
    }
    if (cleanedAgents.length > 0) {
      console.log(`[RejectionTracker] Cleaned ${cleanedAgents.length} expired rejections for call ${callRecord.callId}`);
    }
    return { cleanedAgents, remainingAgents };
  }
  /**
   * Build update expression to remove specific expired rejections
   */
  buildRemoveExpiredExpression(agentIds) {
    if (agentIds.length === 0) {
      return {
        UpdateExpression: "",
        ExpressionAttributeNames: {}
      };
    }
    const removeFields = agentIds.map((_, index) => `rejections.#agent${index}`);
    const names = {};
    agentIds.forEach((agentId, index) => {
      names[`#agent${index}`] = agentId;
    });
    return {
      UpdateExpression: "REMOVE " + removeFields.join(", "),
      ExpressionAttributeNames: names
    };
  }
  /**
   * Helper to check rejection count and suggest action
   */
  suggestAction(callRecord) {
    const stats = this.getStatistics(callRecord);
    if (stats.exceededLimit) {
      return {
        action: "ESCALATE",
        reason: `Call exceeded ${this.config.maxRejections} rejections (total: ${stats.totalRejections})`
      };
    }
    if (stats.recentRejections > 10) {
      return {
        action: "RETRY_WITH_DIFFERENT_AGENTS",
        reason: `${stats.recentRejections} agents rejected call recently - try different agents`
      };
    }
    return {
      action: "CONTINUE",
      reason: `Rejection count acceptable (${stats.totalRejections} total, ${stats.recentRejections} recent)`
    };
  }
  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.config };
  }
};
var defaultRejectionTracker = new RejectionTracker();

// src/services/chime/utils/distributed-lock.ts
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var import_crypto = require("crypto");
var RETRYABLE_ERRORS = [
  "ConditionalCheckFailedException",
  // Lock is held by another process
  "ProvisionedThroughputExceededException",
  // Throttling
  "ThrottlingException",
  // General throttling
  "RequestLimitExceeded",
  // Request rate limit
  "InternalServerError",
  // Transient internal error
  "ServiceUnavailable"
  // Service temporarily unavailable
];
var DistributedLock = class {
  constructor(ddb2, config) {
    this.ddb = ddb2;
    this.config = config;
    this.acquired = false;
    this.fencingToken = 0;
    this.lockId = (0, import_crypto.randomUUID)();
  }
  /**
   * Acquire the lock
   * @returns boolean for backwards compatibility
   */
  async acquire() {
    const result = await this.acquireWithFencingToken();
    return result.acquired;
  }
  /**
   * Acquire the lock with a fencing token
   * The fencing token is a monotonically increasing value that can be used
   * to detect stale lock holders in downstream operations.
   * 
   * FIX: Addresses the distributed systems problem where:
   * 1. Process A acquires lock
   * 2. Process A freezes (GC pause, throttling)
   * 3. Lock expires via TTL
   * 4. Process B acquires lock and makes progress
   * 5. Process A resumes - both think they have the lock
   * 
   * Solution: Downstream operations should verify fencing token hasn't been superseded
   */
  async acquireWithFencingToken() {
    const { tableName, lockKey, ttlSeconds = 30, maxRetries = 3, retryDelayMs = 100 } = this.config;
    const now = Math.floor(Date.now() / 1e3);
    const expiresAt = now + ttlSeconds;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        let nextFencingToken = 1;
        try {
          const { Item } = await this.ddb.send(new import_lib_dynamodb4.GetCommand({
            TableName: tableName,
            Key: { lockKey },
            ProjectionExpression: "fencingToken"
          }));
          if (Item?.fencingToken && typeof Item.fencingToken === "number") {
            nextFencingToken = Item.fencingToken + 1;
          }
        } catch (readErr) {
          console.warn(`[DistributedLock] Could not read current fencing token for ${lockKey}:`, readErr);
        }
        await this.ddb.send(new import_lib_dynamodb4.PutCommand({
          TableName: tableName,
          Item: {
            lockKey,
            lockId: this.lockId,
            acquiredAt: now,
            expiresAt,
            fencingToken: nextFencingToken,
            ttl: expiresAt + 300
            // Clean up 5 minutes after expiry
          },
          ConditionExpression: "attribute_not_exists(lockKey) OR expiresAt < :now",
          ExpressionAttributeValues: {
            ":now": now
          }
        }));
        this.acquired = true;
        this.fencingToken = nextFencingToken;
        console.log(`[DistributedLock] Acquired lock: ${lockKey} (fencingToken: ${nextFencingToken})`);
        return { acquired: true, fencingToken: nextFencingToken };
      } catch (err) {
        const errorName = err.name || err.code || "";
        const isRetryable = RETRYABLE_ERRORS.includes(errorName);
        if (isRetryable) {
          if (attempt < maxRetries - 1) {
            const baseBackoff = retryDelayMs * Math.pow(2, attempt);
            const jitter = Math.random() * baseBackoff * 0.1;
            const backoff = Math.floor(baseBackoff + jitter);
            if (errorName !== "ConditionalCheckFailedException") {
              console.warn(`[DistributedLock] Retryable error (${errorName}), attempt ${attempt + 1}/${maxRetries}, backoff ${backoff}ms: ${lockKey}`);
            }
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          console.warn(`[DistributedLock] Exhausted retries for ${lockKey} after ${errorName}`);
        } else {
          console.error(`[DistributedLock] Non-retryable error acquiring lock ${lockKey}:`, errorName, err.message);
          throw err;
        }
      }
    }
    console.warn(`[DistributedLock] Failed to acquire lock after ${maxRetries} attempts: ${lockKey}`);
    return { acquired: false };
  }
  async release() {
    if (!this.acquired)
      return;
    const { tableName, lockKey } = this.config;
    const maxReleaseRetries = 3;
    for (let attempt = 0; attempt < maxReleaseRetries; attempt++) {
      try {
        await this.ddb.send(new import_lib_dynamodb4.DeleteCommand({
          TableName: tableName,
          Key: { lockKey },
          ConditionExpression: "lockId = :lockId",
          ExpressionAttributeValues: {
            ":lockId": this.lockId
          }
        }));
        this.acquired = false;
        console.log(`[DistributedLock] Released lock: ${lockKey}`);
        return;
      } catch (err) {
        const errorName = err.name || err.code || "";
        if (errorName === "ConditionalCheckFailedException") {
          this.acquired = false;
          console.log(`[DistributedLock] Lock already released or expired: ${lockKey}`);
          return;
        }
        const isThrottling = ["ProvisionedThroughputExceededException", "ThrottlingException", "RequestLimitExceeded"].includes(errorName);
        if (isThrottling && attempt < maxReleaseRetries - 1) {
          const backoff = 100 * Math.pow(2, attempt);
          console.warn(`[DistributedLock] Throttled releasing lock, retrying in ${backoff}ms: ${lockKey}`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        console.error(`[DistributedLock] Error releasing lock: ${lockKey}`, errorName, err.message);
        this.acquired = false;
        return;
      }
    }
  }
  async withLock(fn) {
    const acquired = await this.acquire();
    if (!acquired)
      return null;
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
  /**
   * Check if this lock instance currently holds the lock
   */
  isAcquired() {
    return this.acquired;
  }
  /**
   * Get the fencing token for this lock acquisition
   * Returns 0 if lock was not acquired
   */
  getFencingToken() {
    return this.fencingToken;
  }
  /**
   * Validate that the current fencing token is still valid
   * This should be called before performing critical operations
   * to detect if another process has acquired the lock
   * 
   * @returns true if the fencing token is still the highest for this lock
   */
  async validateFencingToken() {
    if (!this.acquired || this.fencingToken === 0) {
      return false;
    }
    const { tableName, lockKey } = this.config;
    try {
      const { Item } = await this.ddb.send(new import_lib_dynamodb4.GetCommand({
        TableName: tableName,
        Key: { lockKey },
        ConsistentRead: true
      }));
      if (!Item) {
        console.warn(`[DistributedLock] Lock record not found for ${lockKey} - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      if (Item.lockId !== this.lockId) {
        console.warn(`[DistributedLock] Lock ${lockKey} owned by different process - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      if (Item.fencingToken !== this.fencingToken) {
        console.warn(`[DistributedLock] Fencing token mismatch for ${lockKey}: expected ${this.fencingToken}, got ${Item.fencingToken}`);
        this.acquired = false;
        return false;
      }
      const now = Math.floor(Date.now() / 1e3);
      if (Item.expiresAt < now) {
        console.warn(`[DistributedLock] Lock ${lockKey} has expired - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[DistributedLock] Error validating fencing token for ${lockKey}:`, err);
      return false;
    }
  }
};

// src/services/chime/utils/check-queue-for-work.ts
var MAX_RING_AGENTS = Math.max(1, Number.parseInt(process.env.MAX_RING_AGENTS || "25", 10));
var LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
function agentEligibleForCall(agent, call) {
  const requiredSkills = Array.isArray(call.requiredSkills) ? call.requiredSkills.filter((s) => typeof s === "string") : [];
  if (requiredSkills.length > 0) {
    const agentSkills = Array.isArray(agent.skills) ? agent.skills : [];
    const hasAllRequired = requiredSkills.every((skill) => agentSkills.includes(skill));
    if (!hasAllRequired) {
      return false;
    }
  }
  const language = typeof call.language === "string" ? call.language : void 0;
  if (language) {
    const agentLanguages = Array.isArray(agent.languages) && agent.languages.length > 0 ? agent.languages : ["en"];
    if (!agentLanguages.includes(language)) {
      return false;
    }
  }
  const isVip = call.isVip === true;
  if (isVip && agent.canHandleVip !== true) {
    return false;
  }
  return true;
}
function calculatePriorityScore(entry, nowSeconds) {
  let score = 0;
  const priority = entry.priority || "normal";
  switch (priority) {
    case "high":
      score += 60;
      break;
    case "normal":
      score += 30;
      break;
    case "low":
      score += 15;
      break;
  }
  if (entry.isVip) {
    score += 30;
  }
  const queueEntryTime = entry.queueEntryTime ?? nowSeconds;
  const waitMinutes = Math.max(0, (nowSeconds - queueEntryTime) / 60);
  if (waitMinutes <= 30) {
    score += waitMinutes * 2;
  } else {
    const additionalMinutes = Math.min(waitMinutes - 30, 120);
    score += 60 + additionalMinutes;
  }
  if (entry.isCallback) {
    score += 20;
  }
  const previousCallCount = typeof entry.previousCallCount === "number" ? entry.previousCallCount : 0;
  if (previousCallCount > 0) {
    score += Math.min(previousCallCount * 2, 10);
  }
  return score;
}
function createCheckQueueForWork(deps) {
  const { ddb: ddb2, callQueueTableName, agentPresenceTableName } = deps;
  if (!callQueueTableName || !agentPresenceTableName) {
    throw new Error("[checkQueueForWork] Table names are required to process the queue.");
  }
  async function getRankedQueuedCalls(clinicId) {
    const { Items: queuedCalls } = await ddb2.send(new import_lib_dynamodb5.QueryCommand({
      TableName: callQueueTableName,
      KeyConditionExpression: "clinicId = :clinicId",
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":clinicId": clinicId,
        ":status": "queued"
      },
      ScanIndexForward: true
    }));
    if (!queuedCalls || queuedCalls.length === 0) {
      return [];
    }
    const nowSeconds = Math.floor(Date.now() / 1e3);
    const scoredCalls = queuedCalls.map((call) => {
      let priorityScore;
      if (typeof call.priorityScore === "number") {
        priorityScore = Math.max(0, Math.min(call.priorityScore, 1e3));
        if (call.priorityScore !== priorityScore) {
          console.warn(`[checkQueueForWork] Clamped out-of-bounds priorityScore for call ${call.callId}`, {
            original: call.priorityScore,
            clamped: priorityScore
          });
        }
      } else {
        priorityScore = calculatePriorityScore(call, nowSeconds);
      }
      return { ...call, priorityScore };
    });
    scoredCalls.sort((a, b) => {
      const scoreDiff = (b.priorityScore || 0) - (a.priorityScore || 0);
      if (scoreDiff !== 0)
        return scoreDiff;
      const aQueueTime = a.queueEntryTime ?? nowSeconds;
      const bQueueTime = b.queueEntryTime ?? nowSeconds;
      return aQueueTime - bQueueTime;
    });
    console.log("[checkQueueForWork] Top queued calls for clinic", clinicId, scoredCalls.slice(0, 3).map((c) => ({
      callId: c.callId,
      priority: c.priority || "normal",
      score: c.priorityScore,
      waitMinutes: c.queueEntryTime ? Math.floor((nowSeconds - c.queueEntryTime) / 60) : 0
    })));
    return scoredCalls;
  }
  async function fetchIdleAgentsForClinic(clinicId, maxAgentsToFetch) {
    const collected = [];
    let lastEvaluatedKey = void 0;
    do {
      const result = await ddb2.send(new import_lib_dynamodb5.QueryCommand({
        TableName: agentPresenceTableName,
        IndexName: "status-index",
        KeyConditionExpression: "#status = :status",
        FilterExpression: "contains(activeClinicIds, :clinicId) AND attribute_exists(meetingInfo) AND attribute_not_exists(currentCallId) AND attribute_not_exists(ringingCallId)",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "Online",
          ":clinicId": clinicId
        },
        ProjectionExpression: "agentId, skills, languages, canHandleVip, lastActivityAt, recentCallCount, completedCallsToday, lastCallCustomerPhone",
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      if (result.Items && result.Items.length > 0) {
        collected.push(...result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
      if (collected.length >= maxAgentsToFetch) {
        break;
      }
    } while (lastEvaluatedKey);
    return collected.slice(0, maxAgentsToFetch);
  }
  async function ringCallToAgents(call, agentIds) {
    const ringAttemptTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    const uniqueAgentIds = Array.from(new Set(agentIds)).slice(0, MAX_RING_AGENTS);
    if (uniqueAgentIds.length === 0)
      return;
    const currentAttempt = (call.ringAttemptCount || 0) + 1;
    try {
      await ddb2.send(new import_lib_dynamodb5.UpdateCommand({
        TableName: callQueueTableName,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: "SET #status = :ringing, agentIds = :agentIds, ringStartTimeIso = :ts, ringStartTime = :now, lastStateChange = :ts, updatedAt = :ts, ringAttemptCount = :attemptCount",
        ConditionExpression: "#status = :queued",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":ringing": "ringing",
          ":queued": "queued",
          ":agentIds": uniqueAgentIds,
          ":ts": ringAttemptTimestamp,
          ":now": Date.now(),
          ":attemptCount": currentAttempt
        }
      }));
    } catch (err) {
      if (err?.name === "ConditionalCheckFailedException") {
        return;
      }
      throw err;
    }
    const callPhone = typeof call.phoneNumber === "string" && call.phoneNumber.length > 0 ? call.phoneNumber : "Unknown";
    const ringPriority = call.priority || "normal";
    const ringResults = await Promise.allSettled(
      uniqueAgentIds.map(async (agentId) => {
        await ddb2.send(new import_lib_dynamodb5.UpdateCommand({
          TableName: agentPresenceTableName,
          Key: { agentId },
          UpdateExpression: "SET #status = :ringing, ringingCallId = :callId, ringingCallTime = :time, ringingCallFrom = :from, ringingCallPriority = :priority, ringingCallClinicId = :clinicId, lastActivityAt = :time",
          ConditionExpression: "#status = :online AND attribute_exists(meetingInfo) AND attribute_not_exists(currentCallId) AND attribute_not_exists(ringingCallId)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":ringing": "Ringing",
            ":online": "Online",
            ":callId": call.callId,
            ":time": ringAttemptTimestamp,
            ":from": callPhone,
            ":priority": ringPriority,
            ":clinicId": call.clinicId
          }
        }));
        return agentId;
      })
    );
    const ringingAgentIds = [];
    for (const r of ringResults) {
      if (r.status === "fulfilled") {
        ringingAgentIds.push(r.value);
      }
    }
    if (ringingAgentIds.length === 0) {
      try {
        await ddb2.send(new import_lib_dynamodb5.UpdateCommand({
          TableName: callQueueTableName,
          Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
          UpdateExpression: "SET #status = :queued, updatedAt = :ts REMOVE agentIds, ringStartTimeIso, ringStartTime, lastStateChange",
          ConditionExpression: "#status = :ringing",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":queued": "queued",
            ":ringing": "ringing",
            ":ts": (/* @__PURE__ */ new Date()).toISOString()
          }
        }));
      } catch (revertErr) {
        if (revertErr?.name !== "ConditionalCheckFailedException") {
          console.warn("[checkQueueForWork] Failed to revert call after no agents rang:", revertErr);
        }
      }
      return;
    }
    try {
      await ddb2.send(new import_lib_dynamodb5.UpdateCommand({
        TableName: callQueueTableName,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: "SET agentIds = :agentIds, updatedAt = :ts",
        ConditionExpression: "#status = :ringing",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":agentIds": ringingAgentIds,
          ":ringing": "ringing",
          ":ts": (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
    } catch (narrowErr) {
      if (narrowErr?.name !== "ConditionalCheckFailedException") {
        console.warn("[checkQueueForWork] Failed to narrow ring list (non-fatal):", narrowErr);
      }
    }
    if (isPushNotificationsEnabled()) {
      try {
        await sendIncomingCallToAgents(ringingAgentIds, {
          callId: call.callId,
          clinicId: call.clinicId,
          clinicName: call.clinicId,
          callerPhoneNumber: callPhone,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (pushErr) {
        console.warn("[checkQueueForWork] Failed to send push notification (non-fatal):", pushErr);
      }
    }
    console.log(`[checkQueueForWork] Ringing started for queued call ${call.callId}`, {
      clinicId: call.clinicId,
      ringingAgents: ringingAgentIds.length,
      ringAttempt: currentAttempt
    });
  }
  async function dispatchForClinic(clinicId) {
    if (!LOCKS_TABLE_NAME) {
      console.warn("[checkQueueForWork] LOCKS_TABLE_NAME not configured - dispatch will run without a lock (may race)");
    }
    const lock = LOCKS_TABLE_NAME ? new DistributedLock(ddb2, {
      tableName: LOCKS_TABLE_NAME,
      lockKey: `clinic-dispatch-${clinicId}`,
      ttlSeconds: 10,
      maxRetries: 3,
      retryDelayMs: 100
    }) : null;
    const lockAcquired = lock ? await lock.acquire() : true;
    if (!lockAcquired) {
      return;
    }
    try {
      const rankedCalls = await getRankedQueuedCalls(clinicId);
      if (rankedCalls.length === 0) {
        return;
      }
      const staticMax = CHIME_CONFIG.DISPATCH.MAX_SIMUL_RING_CALLS;
      const targetAgentCount = Math.min(MAX_RING_AGENTS * staticMax, 250);
      const idleAgents = await fetchIdleAgentsForClinic(clinicId, targetAgentCount);
      if (idleAgents.length === 0) {
        if (isPushNotificationsEnabled() && rankedCalls.length >= CHIME_CONFIG.PUSH.QUEUE_BACKUP_ALERT_THRESHOLD) {
          try {
            await sendClinicAlert(
              clinicId,
              "Queue Backup",
              `${rankedCalls.length} calls waiting \u2014 no agents available`,
              {
                queueDepth: rankedCalls.length,
                clinicId,
                alertType: "queue_backup"
              }
            );
          } catch (alertErr) {
            console.warn("[checkQueueForWork] Queue backup alert failed (non-fatal):", alertErr);
          }
        }
        return;
      }
      const sortedAgents = idleAgents.slice().sort((a, b) => {
        const aTs = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
        const bTs = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
        return aTs - bTs;
      });
      let effectiveMaxSimulRing = staticMax;
      if (CHIME_CONFIG.DISPATCH.DYNAMIC_SIMUL_RING) {
        effectiveMaxSimulRing = Math.min(
          Math.max(staticMax, Math.ceil(sortedAgents.length / 2)),
          CHIME_CONFIG.DISPATCH.DYNAMIC_SIMUL_RING_MAX
        );
        if (effectiveMaxSimulRing !== staticMax) {
          console.log(`[checkQueueForWork] Dynamic ring: ${staticMax} \u2192 ${effectiveMaxSimulRing} (${sortedAgents.length} agents)`);
        }
      }
      const callsToRingCount = Math.min(rankedCalls.length, sortedAgents.length, effectiveMaxSimulRing);
      const callsToRing = rankedCalls.slice(0, callsToRingCount);
      const totalAgents = sortedAgents.length;
      const allocations = /* @__PURE__ */ new Map();
      let remainingPool = sortedAgents;
      let perCallTargets;
      if (CHIME_CONFIG.DISPATCH.PRIORITY_WEIGHTED_ALLOCATION && callsToRing.length > 1) {
        const totalScore = callsToRing.reduce((sum, c) => sum + Math.max(1, c.priorityScore || 1), 0);
        const rawTargets = callsToRing.map((c) => {
          const share = Math.max(1, c.priorityScore || 1) / totalScore;
          return Math.max(1, Math.round(totalAgents * share));
        });
        const clamped = rawTargets.map((t) => Math.min(t, MAX_RING_AGENTS));
        const overallTotal = clamped.reduce((a, b) => a + b, 0);
        if (overallTotal > totalAgents) {
          const scaleFactor = totalAgents / overallTotal;
          perCallTargets = clamped.map((t) => Math.max(1, Math.floor(t * scaleFactor)));
        } else {
          perCallTargets = clamped;
        }
        console.log("[checkQueueForWork] Priority-weighted allocation:", callsToRing.map((c, i) => ({
          callId: c.callId,
          score: c.priorityScore,
          agents: perCallTargets[i]
        })));
      } else {
        const basePerCall = Math.max(1, Math.floor(totalAgents / callsToRing.length));
        let remainder = totalAgents % callsToRing.length;
        perCallTargets = callsToRing.map(() => {
          const target = basePerCall + (remainder > 0 ? 1 : 0);
          if (remainder > 0)
            remainder--;
          return Math.min(MAX_RING_AGENTS, target);
        });
      }
      for (let i = 0; i < callsToRing.length; i++) {
        const call = callsToRing[i];
        let desired = perCallTargets[i];
        const callPhone = typeof call.phoneNumber === "string" && call.phoneNumber.length > 0 ? call.phoneNumber : "Unknown";
        const callContext = {
          callId: call.callId,
          clinicId: call.clinicId,
          phoneNumber: callPhone,
          priority: call.priority || "normal",
          isVip: !!call.isVip,
          requiredSkills: Array.isArray(call.requiredSkills) ? call.requiredSkills : void 0,
          preferredSkills: Array.isArray(call.preferredSkills) ? call.preferredSkills : void 0,
          language: typeof call.language === "string" ? call.language : void 0,
          isCallback: !!call.isCallback,
          previousCallCount: typeof call.previousCallCount === "number" ? call.previousCallCount : 0,
          previousAgentId: typeof call.previousAgentId === "string" ? call.previousAgentId : void 0
        };
        const eligiblePool = remainingPool.filter(
          (agent) => agentEligibleForCall(agent, call) && !defaultRejectionTracker.hasRecentlyRejected(call, agent.agentId)
        );
        if (eligiblePool.length === 0) {
          allocations.set(call.callId, { call, agentIds: [] });
          continue;
        }
        const rankedAgentsForCall = selectBestAgents(
          eligiblePool,
          callContext,
          {
            maxAgents: desired,
            considerIdleTime: true,
            considerWorkload: true,
            prioritizeContinuity: !!callContext.isCallback
          }
        );
        const chosen = rankedAgentsForCall.slice(0, desired);
        const chosenIds = chosen.map((a) => a.agentId);
        allocations.set(call.callId, { call, agentIds: chosenIds });
        const chosenSet = new Set(chosenIds);
        remainingPool = remainingPool.filter((a) => !chosenSet.has(a.agentId));
      }
      if (remainingPool.length > 0) {
        const callList = callsToRing.slice();
        for (const agent of remainingPool) {
          let bestCall = null;
          let bestCount = Number.MAX_SAFE_INTEGER;
          for (const call of callList) {
            const allocation2 = allocations.get(call.callId);
            const currentCount = allocation2?.agentIds.length || 0;
            if (currentCount >= MAX_RING_AGENTS)
              continue;
            if (!agentEligibleForCall(agent, call))
              continue;
            if (defaultRejectionTracker.hasRecentlyRejected(call, agent.agentId))
              continue;
            if (currentCount < bestCount) {
              bestCount = currentCount;
              bestCall = call;
            }
          }
          if (!bestCall) {
            continue;
          }
          const allocation = allocations.get(bestCall.callId);
          if (allocation) {
            allocation.agentIds.push(agent.agentId);
          } else {
            allocations.set(bestCall.callId, { call: bestCall, agentIds: [agent.agentId] });
          }
        }
      }
      for (const { call, agentIds } of allocations.values()) {
        if (agentIds.length === 0)
          continue;
        await ringCallToAgents(call, agentIds);
      }
    } finally {
      if (lock) {
        await lock.release();
      }
    }
  }
  return async function checkQueueForWork(agentId, agentInfo) {
    if (!agentInfo?.activeClinicIds || agentInfo.activeClinicIds.length === 0) {
      console.log(`[checkQueueForWork] Agent ${agentId} has no active clinics. Skipping.`);
      return;
    }
    const activeClinicIds = agentInfo.activeClinicIds;
    console.log(`[checkQueueForWork] Agent ${agentId} triggering fair-share dispatch for:`, activeClinicIds);
    if (CHIME_CONFIG.DISPATCH.PARALLEL_CLINIC_DISPATCH && activeClinicIds.length > 1) {
      const results = await Promise.allSettled(
        activeClinicIds.map((clinicId) => dispatchForClinic(clinicId))
      );
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === "rejected") {
          console.error(`[checkQueueForWork] Error dispatching for clinic ${activeClinicIds[i]}:`, results[i].reason);
        }
      }
    } else {
      for (const clinicId of activeClinicIds) {
        try {
          await dispatchForClinic(clinicId);
        } catch (err) {
          console.error(`[checkQueueForWork] Error dispatching for clinic ${clinicId}:`, err);
        }
      }
    }
  };
}

// src/services/chime/queue-poller.ts
var ddb = getDynamoDBClient();
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chime = new import_client_chime_sdk_meetings.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
var chimeVoiceClient = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
var checkQueueForWorkFn = createCheckQueueForWork({
  ddb,
  callQueueTableName: CALL_QUEUE_TABLE_NAME,
  agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
  chime,
  chimeVoiceClient
});
var handler = async (_event) => {
  console.log("[queue-poller] Starting periodic queue poll");
  try {
    const clinicIds = await getClinicsWithQueuedCalls();
    if (clinicIds.length === 0) {
      console.log("[queue-poller] No clinics with queued calls");
      return;
    }
    console.log(`[queue-poller] Found ${clinicIds.length} clinics with queued calls:`, clinicIds);
    const results = await Promise.allSettled(
      clinicIds.map(async (clinicId) => {
        const { Items: onlineAgents } = await ddb.send(new import_lib_dynamodb6.QueryCommand({
          TableName: AGENT_PRESENCE_TABLE_NAME,
          IndexName: "status-index",
          KeyConditionExpression: "#status = :status",
          FilterExpression: "contains(activeClinicIds, :clinicId)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": "Online",
            ":clinicId": clinicId
          },
          ProjectionExpression: "agentId, activeClinicIds",
          Limit: 1
        }));
        if (!onlineAgents || onlineAgents.length === 0) {
          console.log(`[queue-poller] No online agents for clinic ${clinicId}, skipping`);
          return;
        }
        const agent = onlineAgents[0];
        console.log(`[queue-poller] Dispatching for clinic ${clinicId} via agent ${agent.agentId}`);
        await checkQueueForWorkFn(agent.agentId, agent);
      })
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`[queue-poller] Complete: ${succeeded} succeeded, ${failed} failed out of ${clinicIds.length} clinics`);
  } catch (error) {
    console.error("[queue-poller] Fatal error:", error);
    throw error;
  }
};
async function getClinicsWithQueuedCalls() {
  const clinicIdSet = /* @__PURE__ */ new Set();
  let lastKey;
  do {
    const result = await ddb.send(new import_lib_dynamodb6.ScanCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      FilterExpression: "#status = :queued",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":queued": "queued" },
      ProjectionExpression: "clinicId",
      ExclusiveStartKey: lastKey
    }));
    if (result.Items) {
      for (const item of result.Items) {
        if (item.clinicId)
          clinicIdSet.add(item.clinicId);
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return Array.from(clinicIdSet);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

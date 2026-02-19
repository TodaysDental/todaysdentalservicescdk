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

// src/services/chime/queue-monitor.ts
var queue_monitor_exports = {};
__export(queue_monitor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(queue_monitor_exports);

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

// src/services/chime/queue-monitor.ts
var import_client_chime_sdk_voice2 = require("@aws-sdk/client-chime-sdk-voice");
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");

// src/services/chime/utils/customer-notifications.ts
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

// src/services/chime/utils/sma-map.ts
var cachedMap;
function parseSmaMap() {
  if (cachedMap) {
    return cachedMap;
  }
  const raw = process.env.SMA_ID_MAP;
  if (!raw) {
    console.warn("[sma-map] SMA_ID_MAP environment variable is not defined");
    cachedMap = {};
    return cachedMap;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      cachedMap = parsed;
    } else {
      console.error("[sma-map] SMA_ID_MAP did not parse to an object");
      cachedMap = {};
    }
  } catch (err) {
    console.error("[sma-map] Failed to parse SMA_ID_MAP", err);
    cachedMap = {};
  }
  return cachedMap;
}
function getSmaIdForClinic(clinicId) {
  if (!clinicId) {
    return void 0;
  }
  const map = parseSmaMap();
  return map[clinicId];
}

// src/services/chime/utils/customer-notifications.ts
var CustomerNotificationService = class {
  constructor(chimeVoice2, ddb2, callQueueTable) {
    this.chimeVoice = chimeVoice2;
    this.ddb = ddb2;
    this.callQueueTable = callQueueTable;
  }
  /**
   * Notify customer that queue timeout has been reached
   */
  async notifyQueueTimeout(call) {
    const smaId = getSmaIdForClinic(call.clinicId);
    if (!smaId) {
      console.error("[Notifications] No SMA configured for clinic:", call.clinicId);
      return;
    }
    try {
      await this.chimeVoice.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: call.callId,
        Arguments: {
          action: "PLAY_TIMEOUT_MESSAGE",
          message: "We apologize, but all of our agents are currently assisting other customers. Please call back later or leave a message after the tone.",
          enableVoicemail: "true",
          voicemailBucket: process.env.VOICEMAIL_BUCKET || "",
          voicemailKey: `voicemails/${call.clinicId}/${call.callId}.wav`
        }
      }));
      await this.ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: this.callQueueTable,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: "SET timeoutNotificationSent = :true, timeoutNotificationAt = :now",
        ExpressionAttributeValues: {
          ":true": true,
          ":now": (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
      console.log(`[Notifications] Sent timeout notification for call ${call.callId}`);
    } catch (err) {
      console.error("[Notifications] Failed to send timeout message:", err);
    }
  }
  /**
   * Notify customer of estimated wait time
   */
  async notifyEstimatedWaitTime(call, waitMinutes) {
    const smaId = getSmaIdForClinic(call.clinicId);
    if (!smaId)
      return;
    try {
      await this.chimeVoice.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: call.callId,
        Arguments: {
          action: "PLAY_WAIT_TIME",
          minutes: String(waitMinutes),
          message: `Your estimated wait time is ${waitMinutes} minutes. Thank you for your patience.`
        }
      }));
    } catch (err) {
      console.error("[Notifications] Failed to send wait time:", err);
    }
  }
  /**
   * Offer callback to customer
   */
  async offerCallback(call, estimatedCallbackTime) {
    const smaId = getSmaIdForClinic(call.clinicId);
    if (!smaId)
      return;
    try {
      await this.chimeVoice.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: call.callId,
        Arguments: {
          action: "OFFER_CALLBACK",
          estimatedTime: estimatedCallbackTime,
          message: "Press 1 to receive a callback when an agent is available, or press 2 to continue waiting."
        }
      }));
      await this.ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: this.callQueueTable,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: "SET callbackOffered = :true, callbackOfferedAt = :now",
        ExpressionAttributeValues: {
          ":true": true,
          ":now": (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
    } catch (err) {
      console.error("[Notifications] Failed to offer callback:", err);
    }
  }
  /**
   * Monitor queue and send proactive notifications
   */
  async monitorQueueTimeouts(clinicId, callQueueTable) {
    const now = Date.now();
    const warningThreshold = 10 * 60 * 1e3;
    const timeoutThreshold = 20 * 60 * 1e3;
    const { Items: queuedCalls } = await this.ddb.send(new import_lib_dynamodb2.QueryCommand({
      TableName: callQueueTable,
      IndexName: "status-queueEntryTime-index",
      KeyConditionExpression: "#status = :queued",
      FilterExpression: "queueEntryTime < :warningCutoff AND clinicId = :clinicId",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":queued": "queued",
        ":warningCutoff": new Date(now - warningThreshold).toISOString(),
        ":clinicId": clinicId
      }
    }));
    for (const call of queuedCalls || []) {
      const queueTime = now - new Date(call.queueEntryTime).getTime();
      if (queueTime > timeoutThreshold) {
        if (!call.timeoutNotificationSent) {
          await this.notifyQueueTimeout(call);
        }
      } else if (queueTime > warningThreshold) {
        if (!call.callbackOffered) {
          const waitMinutes = Math.ceil((timeoutThreshold - queueTime) / 6e4);
          await this.offerCallback(call, `${waitMinutes} minutes`);
        }
      }
    }
  }
};

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
function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new import_client_lambda.LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return lambdaClient;
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

// src/services/chime/queue-monitor.ts
var ddb = getDynamoDBClient();
var chimeVoice = new import_client_chime_sdk_voice2.ChimeSDKVoiceClient({ region: process.env.CHIME_MEDIA_REGION || "us-east-1" });
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
var handler = async (_event) => {
  console.log("[queue-monitor] Starting queue scan");
  const notificationService = new CustomerNotificationService(chimeVoice, ddb, CALL_QUEUE_TABLE_NAME);
  try {
    const { Items: clinics } = await ddb.send(new import_lib_dynamodb4.ScanCommand({
      TableName: CLINICS_TABLE_NAME,
      ProjectionExpression: "clinicId, clinicName"
    }));
    if (!clinics || clinics.length === 0) {
      console.log("[queue-monitor] No clinics found");
      return;
    }
    const results = await Promise.allSettled(
      clinics.map(async (clinic) => {
        try {
          await notificationService.monitorQueueTimeouts(clinic.clinicId, CALL_QUEUE_TABLE_NAME);
          if (isPushNotificationsEnabled()) {
            await checkQueueBackup(clinic.clinicId, clinic.clinicName || clinic.clinicId);
          }
          return { clinicId: clinic.clinicId, status: "ok" };
        } catch (err) {
          console.error(`[queue-monitor] Error for clinic ${clinic.clinicId}:`, err);
          return { clinicId: clinic.clinicId, status: "error", error: err };
        }
      })
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`[queue-monitor] Scan complete: ${succeeded} succeeded, ${failed} failed out of ${clinics.length} clinics`);
  } catch (error) {
    console.error("[queue-monitor] Fatal error:", error);
    throw error;
  }
};
async function checkQueueBackup(clinicId, clinicName) {
  const threshold = CHIME_CONFIG.PUSH.QUEUE_BACKUP_ALERT_THRESHOLD;
  try {
    const { Items: queuedCalls } = await ddb.send(new import_lib_dynamodb4.QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      KeyConditionExpression: "clinicId = :clinicId",
      FilterExpression: "#status IN (:ringing, :queued, :waiting)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":clinicId": clinicId,
        ":ringing": "ringing",
        ":queued": "queued",
        ":waiting": "waiting"
      },
      Select: "COUNT"
    }));
    const queueDepth = queuedCalls?.length ?? 0;
    if (queueDepth >= threshold) {
      console.log(`[queue-monitor] Queue backup detected for ${clinicId}: ${queueDepth} calls (threshold: ${threshold})`);
      await sendClinicAlert(
        clinicId,
        "Queue Backup Alert",
        `${queueDepth} calls waiting \u2014 queue exceeds threshold of ${threshold}`,
        {
          alertType: "queue_backup",
          queueDepth,
          threshold,
          clinicName
        }
      );
    }
  } catch (err) {
    console.warn(`[queue-monitor] Failed to check queue backup for ${clinicId}:`, err);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

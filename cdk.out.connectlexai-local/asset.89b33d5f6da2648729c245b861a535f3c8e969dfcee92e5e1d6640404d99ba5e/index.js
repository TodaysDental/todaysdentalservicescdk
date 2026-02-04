"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/chime/process-call-analytics-stream.ts
var process_call_analytics_stream_exports = {};
__export(process_call_analytics_stream_exports, {
  calculateAverages: () => calculateAverages,
  handler: () => handler
});
module.exports = __toCommonJS(process_call_analytics_stream_exports);
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var import_util_dynamodb2 = require("@aws-sdk/util-dynamodb");

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

// src/services/shared/utils/analytics-deduplication.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var DEDUP_TTL_DAYS = parseInt(process.env.DEDUP_TTL_DAYS || "14", 10);
if (DEDUP_TTL_DAYS < 1 || DEDUP_TTL_DAYS > 365) {
  console.warn("[Deduplication] DEDUP_TTL_DAYS outside recommended range (1-365):", {
    configured: DEDUP_TTL_DAYS,
    recommendation: "Use 7-14 for standard retention, up to 365 for extended retention"
  });
}
async function checkAndMarkProcessed(ddb2, dedupTableName, callId, stage, eventId) {
  const dedupKey = generateDedupKey(callId, stage);
  try {
    const ttlSeconds = DEDUP_TTL_DAYS * 24 * 60 * 60;
    await ddb2.send(new import_lib_dynamodb2.PutCommand({
      TableName: dedupTableName,
      Item: {
        eventId: dedupKey,
        // FIXED: Use dedupKey as the partition key value
        callId,
        stage,
        originalEventId: eventId || "unknown",
        // Keep original eventId for debugging
        processedAt: (/* @__PURE__ */ new Date()).toISOString(),
        processorVersion: "2.2",
        // Bumped version to track TTL fix
        ttl: Math.floor(Date.now() / 1e3) + ttlSeconds,
        // CRITICAL FIX #7.1: Configurable TTL
        ttlDays: DEDUP_TTL_DAYS
        // Store for debugging
      },
      ConditionExpression: "attribute_not_exists(eventId)"
      // FIXED: Check partition key
    }));
    return {
      isDuplicate: false,
      dedupKey
    };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      console.log("[Deduplication] Duplicate event detected:", {
        dedupKey,
        callId,
        stage
      });
      return {
        isDuplicate: true,
        dedupKey
      };
    }
    throw err;
  }
}
function generateDedupKey(callId, stage, timestampBucket, eventTimestamp) {
  if (stage === "post-call" || stage === "call-end-finalization" || stage === "post-call-completed" || stage === "post-call-abandoned") {
    return `${callId}#${stage}`;
  }
  if (stage === "live-init") {
    return `${callId}#${stage}`;
  }
  const referenceTime = eventTimestamp || Date.now();
  const bucket = timestampBucket || Math.floor(referenceTime / (5 * 60 * 1e3));
  return `${callId}#${stage}#${bucket}`;
}
function shouldProcessAnalytics(existingRecord, stage) {
  if (!existingRecord) {
    return true;
  }
  if (existingRecord.finalized) {
    console.log("[Deduplication] Skipping - record already finalized");
    return false;
  }
  if (stage === "live-init" && existingRecord.callEndTime) {
    console.log("[Deduplication] Skipping - call already ended");
    return false;
  }
  if (stage === "post-call") {
    return true;
  }
  return true;
}
function getDedupTableName(analyticsTableName) {
  const explicitTable = process.env.ANALYTICS_DEDUP_TABLE || process.env.ANALYTICS_DEDUP_TABLE_NAME;
  if (explicitTable) {
    return explicitTable;
  }
  if (analyticsTableName) {
    const derivedName = `${analyticsTableName}-Dedup`;
    console.warn("[Deduplication] Using derived dedup table name:", {
      analyticsTable: analyticsTableName,
      derivedDedupTable: derivedName,
      recommendation: "Set ANALYTICS_DEDUP_TABLE_NAME explicitly to avoid fragile derivation"
    });
    return derivedName;
  }
  throw new Error(
    "[Deduplication] CRITICAL: Cannot determine dedup table name. Set ANALYTICS_DEDUP_TABLE_NAME environment variable or provide analyticsTableName parameter."
  );
}

// src/services/shared/utils/circuit-breaker.ts
var CircuitBreaker = class {
  constructor(config) {
    this.state = "CLOSED" /* CLOSED */;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.config = config;
  }
  /**
   * Execute function with circuit breaker protection
   */
  async execute(fn) {
    if (this.state === "OPEN" /* OPEN */) {
      if (Date.now() < this.nextAttempt) {
        throw new Error(`Circuit breaker [${this.config.name}] is OPEN. Service unavailable.`);
      }
      this.state = "HALF_OPEN" /* HALF_OPEN */;
      console.log(`[CircuitBreaker] ${this.config.name} transitioning to HALF_OPEN`);
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  /**
   * Check if circuit allows requests
   */
  isOpen() {
    return this.state === "OPEN" /* OPEN */ && Date.now() < this.nextAttempt;
  }
  /**
   * Get current state for monitoring
   */
  getState() {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount
    };
  }
  onSuccess() {
    this.failureCount = 0;
    if (this.state === "HALF_OPEN" /* HALF_OPEN */) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = "CLOSED" /* CLOSED */;
        this.successCount = 0;
        console.log(`[CircuitBreaker] ${this.config.name} CLOSED (service recovered)`);
      }
    }
  }
  onFailure() {
    this.failureCount++;
    this.successCount = 0;
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = "OPEN" /* OPEN */;
      this.nextAttempt = Date.now() + this.config.timeout;
      console.error(`[CircuitBreaker] ${this.config.name} OPEN (threshold ${this.config.failureThreshold} failures reached)`);
    }
  }
  /**
   * Manually reset circuit (for testing or manual intervention)
   */
  reset() {
    this.state = "CLOSED" /* CLOSED */;
    this.failureCount = 0;
    this.successCount = 0;
    console.log(`[CircuitBreaker] ${this.config.name} manually reset to CLOSED`);
  }
};
var dynamoDBCircuitBreaker = new CircuitBreaker({
  name: "DynamoDB-AgentPerformance",
  failureThreshold: 5,
  // Open after 5 failures
  successThreshold: 2,
  // Close after 2 successes
  timeout: 6e4
  // Wait 1 minute before retry
});
var snsCircuitBreaker = new CircuitBreaker({
  name: "SNS-Alerts",
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 3e4
});
var circuitBreakerRegistry = /* @__PURE__ */ new Map();
function getCircuitBreaker(name, config) {
  if (!circuitBreakerRegistry.has(name)) {
    const defaultConfig = {
      name,
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 6e4,
      ...config
    };
    circuitBreakerRegistry.set(name, new CircuitBreaker(defaultConfig));
  }
  return circuitBreakerRegistry.get(name);
}

// src/services/shared/utils/enhanced-agent-metrics.ts
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");

// src/services/shared/utils/metrics-validator.ts
var VALIDATION_RULES = {
  duration: {
    min: 1,
    // 1 second minimum
    max: 14400,
    // 4 hours maximum
    warningMax: 3600
    // Warn if > 1 hour
  },
  talkTime: {
    min: 0,
    max: 14400
  },
  holdTime: {
    min: 0,
    max: 7200
    // 2 hours max hold time
  },
  sentimentScore: {
    min: 0,
    max: 100
  },
  agentTalkPercentage: {
    min: 0,
    max: 100
  },
  interruptionCount: {
    min: 0,
    max: 200
    // Unlikely to have >200 interruptions
  }
};
var VALID_SENTIMENTS = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"];
var VALID_DIRECTIONS = ["inbound", "outbound"];
function validateAgentMetrics(metrics) {
  const errors = [];
  const warnings = [];
  if (!metrics.agentId || typeof metrics.agentId !== "string") {
    errors.push("agentId is required and must be a string");
  }
  if (!metrics.clinicId || typeof metrics.clinicId !== "string") {
    errors.push("clinicId is required and must be a string");
  }
  if (!metrics.callId || typeof metrics.callId !== "string") {
    errors.push("callId is required and must be a string");
  }
  if (!VALID_DIRECTIONS.includes(metrics.direction)) {
    errors.push(`direction must be one of: ${VALID_DIRECTIONS.join(", ")}`);
  }
  if (typeof metrics.duration !== "number" || isNaN(metrics.duration)) {
    errors.push("duration must be a valid number");
  } else {
    if (metrics.duration < VALIDATION_RULES.duration.min) {
      errors.push(`duration must be at least ${VALIDATION_RULES.duration.min} second`);
    }
    if (metrics.duration > VALIDATION_RULES.duration.max) {
      errors.push(`duration cannot exceed ${VALIDATION_RULES.duration.max} seconds (4 hours)`);
    }
    if (metrics.duration > VALIDATION_RULES.duration.warningMax) {
      warnings.push(`duration ${metrics.duration}s is unusually long (>${VALIDATION_RULES.duration.warningMax}s)`);
    }
  }
  if (metrics.talkTime !== void 0) {
    if (typeof metrics.talkTime !== "number" || isNaN(metrics.talkTime)) {
      errors.push("talkTime must be a valid number");
    } else {
      if (metrics.talkTime < VALIDATION_RULES.talkTime.min) {
        errors.push("talkTime cannot be negative");
      }
      if (metrics.talkTime > VALIDATION_RULES.talkTime.max) {
        errors.push(`talkTime cannot exceed ${VALIDATION_RULES.talkTime.max} seconds`);
      }
      if (metrics.talkTime > metrics.duration) {
        errors.push("talkTime cannot exceed total duration");
      }
    }
  }
  if (metrics.holdTime !== void 0) {
    if (typeof metrics.holdTime !== "number" || isNaN(metrics.holdTime)) {
      errors.push("holdTime must be a valid number");
    } else {
      if (metrics.holdTime < VALIDATION_RULES.holdTime.min) {
        errors.push("holdTime cannot be negative");
      }
      if (metrics.holdTime > VALIDATION_RULES.holdTime.max) {
        errors.push(`holdTime cannot exceed ${VALIDATION_RULES.holdTime.max} seconds`);
      }
      if (metrics.holdTime > metrics.duration) {
        warnings.push("holdTime exceeds total duration, will be capped");
      }
    }
  }
  if (metrics.talkTime !== void 0 && metrics.holdTime !== void 0) {
    if (metrics.talkTime + metrics.holdTime > metrics.duration) {
      warnings.push("talkTime + holdTime exceeds duration, values will be adjusted proportionally");
    }
  }
  if (metrics.sentiment !== void 0) {
    const sentimentUpper = metrics.sentiment.toUpperCase();
    if (!VALID_SENTIMENTS.includes(sentimentUpper)) {
      errors.push(`sentiment must be one of: ${VALID_SENTIMENTS.join(", ")}`);
    }
  }
  if (metrics.sentimentScore !== void 0) {
    if (typeof metrics.sentimentScore !== "number" || isNaN(metrics.sentimentScore)) {
      errors.push("sentimentScore must be a valid number");
    } else {
      if (metrics.sentimentScore < VALIDATION_RULES.sentimentScore.min || metrics.sentimentScore > VALIDATION_RULES.sentimentScore.max) {
        errors.push(`sentimentScore must be between ${VALIDATION_RULES.sentimentScore.min} and ${VALIDATION_RULES.sentimentScore.max}`);
      }
    }
  }
  if (metrics.speakerMetrics) {
    const { agentTalkPercentage, interruptionCount } = metrics.speakerMetrics;
    if (typeof agentTalkPercentage !== "number" || isNaN(agentTalkPercentage)) {
      errors.push("agentTalkPercentage must be a valid number");
    } else {
      if (agentTalkPercentage < VALIDATION_RULES.agentTalkPercentage.min || agentTalkPercentage > VALIDATION_RULES.agentTalkPercentage.max) {
        errors.push(`agentTalkPercentage must be between 0 and 100`);
      }
      if (agentTalkPercentage < 10) {
        warnings.push("Agent talk percentage is very low (<10%)");
      } else if (agentTalkPercentage > 90) {
        warnings.push("Agent talk percentage is very high (>90%)");
      }
    }
    if (typeof interruptionCount !== "number" || isNaN(interruptionCount)) {
      errors.push("interruptionCount must be a valid number");
    } else {
      if (interruptionCount < VALIDATION_RULES.interruptionCount.min) {
        errors.push("interruptionCount cannot be negative");
      }
      if (interruptionCount > VALIDATION_RULES.interruptionCount.max) {
        warnings.push(`interruptionCount ${interruptionCount} is unusually high`);
      }
    }
  }
  if (metrics.issues !== void 0) {
    if (!Array.isArray(metrics.issues)) {
      errors.push("issues must be an array");
    } else if (metrics.issues.length > 50) {
      warnings.push("Unusually high number of issues detected");
    }
  }
  let sanitizedMetrics;
  if (errors.length === 0) {
    sanitizedMetrics = sanitizeMetrics(metrics);
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedMetrics
  };
}
function sanitizeMetrics(metrics) {
  const sanitized = { ...metrics };
  if (sanitized.sentiment) {
    sanitized.sentiment = sanitized.sentiment.toUpperCase();
  }
  if (sanitized.holdTime && sanitized.holdTime > sanitized.duration) {
    sanitized.holdTime = sanitized.duration;
  }
  if (sanitized.talkTime !== void 0 && sanitized.holdTime !== void 0) {
    const total = sanitized.talkTime + sanitized.holdTime;
    if (total > sanitized.duration) {
      const ratio = sanitized.duration / total;
      sanitized.talkTime = Math.round(sanitized.talkTime * ratio);
      sanitized.holdTime = Math.round(sanitized.holdTime * ratio);
    }
  }
  if (sanitized.talkTime === void 0) {
    sanitized.talkTime = sanitized.duration - (sanitized.holdTime || 0);
  }
  if (sanitized.talkTime < 0)
    sanitized.talkTime = 0;
  if (sanitized.holdTime !== void 0 && sanitized.holdTime < 0)
    sanitized.holdTime = 0;
  if (sanitized.transferred === void 0)
    sanitized.transferred = false;
  if (sanitized.escalated === void 0)
    sanitized.escalated = false;
  if (sanitized.issues === void 0)
    sanitized.issues = [];
  return sanitized;
}
function validateAggregatedMetrics(metrics) {
  const errors = [];
  const warnings = [];
  if (metrics.totalCalls < 0) {
    errors.push("totalCalls cannot be negative");
  }
  if (metrics.averageHandleTime < 0) {
    errors.push("averageHandleTime cannot be negative");
  } else if (metrics.averageHandleTime > 14400) {
    errors.push("averageHandleTime cannot exceed 4 hours");
  }
  if (metrics.averageHandleTime > 0 && metrics.totalCalls > 0) {
    if (metrics.averageHandleTime < 30) {
      warnings.push("averageHandleTime is very low (<30s), may indicate data quality issue");
    } else if (metrics.averageHandleTime > 3600) {
      warnings.push("averageHandleTime is very high (>1h), may indicate data quality issue");
    }
  }
  if (metrics.averageSentiment < 0 || metrics.averageSentiment > 100) {
    errors.push("averageSentiment must be between 0 and 100");
  }
  const { positive, neutral, negative, mixed } = metrics.sentimentScores;
  if (positive < 0 || neutral < 0 || negative < 0 || mixed < 0) {
    errors.push("sentiment scores cannot be negative");
  }
  const totalSentiment = positive + neutral + negative + mixed;
  if (totalSentiment > metrics.totalCalls) {
    errors.push("total sentiment scores cannot exceed total calls");
  }
  if (metrics.transferRate < 0 || metrics.transferRate > 100) {
    errors.push("transferRate must be between 0 and 100");
  }
  if (metrics.transferRate > 50) {
    warnings.push("transferRate is very high (>50%), may indicate training issue");
  }
  if (metrics.completionRate !== void 0) {
    if (metrics.completionRate < 0 || metrics.completionRate > 100) {
      errors.push("completionRate must be between 0 and 100");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedMetrics: metrics
  };
}
function validateCallCountIntegrity(previousCount, newCount, callId) {
  const errors = [];
  const warnings = [];
  if (newCount < previousCount) {
    errors.push(`Call count decreased from ${previousCount} to ${newCount} for call ${callId} - data integrity violation`);
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// src/services/shared/utils/enhanced-agent-metrics.ts
async function trackEnhancedCallMetrics(ddb2, tableName, metrics) {
  const validationResult = validateAgentMetrics(metrics);
  if (!validationResult.valid) {
    console.error("[EnhancedMetrics] Validation failed:", {
      agentId: metrics.agentId,
      callId: metrics.callId,
      errors: validationResult.errors
    });
    throw new Error(`Metrics validation failed: ${validationResult.errors.join(", ")}`);
  }
  if (validationResult.warnings.length > 0) {
    console.warn("[EnhancedMetrics] Validation warnings:", {
      agentId: metrics.agentId,
      callId: metrics.callId,
      warnings: validationResult.warnings
    });
  }
  const sanitizedMetrics = validationResult.sanitizedMetrics;
  const clinicTimezone = await getClinicTimezone(sanitizedMetrics.clinicId);
  const callTimestamp = sanitizedMetrics.timestamp ? new Date(sanitizedMetrics.timestamp) : /* @__PURE__ */ new Date();
  const today = getDateInTimezone(callTimestamp, clinicTimezone);
  const MAX_RETRIES = 3;
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const existing = await ddb2.send(new import_lib_dynamodb3.GetCommand({
        TableName: tableName,
        Key: {
          agentId: metrics.agentId,
          periodDate: today
        }
      }));
      const current = existing.Item;
      const currentVersion = current?.version || 0;
      const currentCallCount = current?.totalCalls || 0;
      const newCallCount = currentCallCount + 1;
      const integrityCheck = validateCallCountIntegrity(currentCallCount, newCallCount, sanitizedMetrics.callId);
      if (!integrityCheck.valid) {
        console.error("[EnhancedMetrics] Call count integrity check failed:", integrityCheck.errors);
        throw new Error(`Call count integrity violation: ${integrityCheck.errors.join(", ")}`);
      }
      const newTotalCalls = newCallCount;
      const newAnsweredCalls = (current?.answeredCalls || 0) + 1;
      const newInboundCalls = sanitizedMetrics.direction === "inbound" ? (current?.inboundCalls || 0) + 1 : current?.inboundCalls || 0;
      const newOutboundCalls = sanitizedMetrics.direction === "outbound" ? (current?.outboundCalls || 0) + 1 : current?.outboundCalls || 0;
      const newTotalTalkTime = (current?.totalTalkTime || 0) + (sanitizedMetrics.talkTime || sanitizedMetrics.duration);
      const newTotalHoldTime = (current?.totalHoldTime || 0) + (sanitizedMetrics.holdTime || 0);
      const newAverageHandleTime = Math.round(
        (newTotalTalkTime + newTotalHoldTime) / newAnsweredCalls
      );
      const sentimentScores = current?.sentimentScores || { positive: 0, neutral: 0, negative: 0, mixed: 0 };
      if (sanitizedMetrics.sentiment) {
        const sentimentKey = sanitizedMetrics.sentiment.toLowerCase();
        if (sentimentKey in sentimentScores) {
          sentimentScores[sentimentKey]++;
        }
      }
      const currentAvgSentiment = current?.averageSentiment || 50;
      const totalSentimentCalls = Object.values(sentimentScores).reduce((sum, count) => sum + count, 0);
      const newAverageSentiment = sanitizedMetrics.sentimentScore ? Math.round(
        (currentAvgSentiment * (totalSentimentCalls - 1) + sanitizedMetrics.sentimentScore) / totalSentimentCalls
      ) : currentAvgSentiment;
      const csatProxy = Math.round(
        (sentimentScores.positive + sentimentScores.neutral * 0.5) / totalSentimentCalls * 100
      );
      const newTransferredCalls = (current?.transferredCalls || 0) + (sanitizedMetrics.transferred ? 1 : 0);
      const newEscalatedCalls = (current?.escalatedCalls || 0) + (sanitizedMetrics.escalated ? 1 : 0);
      const transferRate = Math.round(newTransferredCalls / newAnsweredCalls * 100);
      const newCustomerFrustrationCount = (current?.customerFrustrationCount || 0) + (sanitizedMetrics.issues?.includes("customer-frustration") ? 1 : 0);
      const newEscalationRequestCount = (current?.escalationRequestCount || 0) + (sanitizedMetrics.issues?.includes("escalation-request") ? 1 : 0);
      const newAudioQualityIssues = (current?.audioQualityIssues || 0) + (sanitizedMetrics.issues?.includes("poor-audio-quality") ? 1 : 0);
      const callsPerHour = current?.callsPerHour || 0;
      const utilizationRate = current?.utilizationRate || 0;
      const interruptionRate = sanitizedMetrics.speakerMetrics ? sanitizedMetrics.speakerMetrics.interruptionCount : current?.interruptionRate || 0;
      const talkTimeBalance = sanitizedMetrics.speakerMetrics ? calculateTalkTimeBalanceScore(sanitizedMetrics.speakerMetrics.agentTalkPercentage) : current?.talkTimeBalance || 100;
      const existingCallIds = current?.callIds || [];
      const MAX_CALL_IDS = 50;
      const callIdExists = existingCallIds.includes(sanitizedMetrics.callId);
      const updatedCallIds = callIdExists ? existingCallIds : [...existingCallIds, sanitizedMetrics.callId].slice(-MAX_CALL_IDS);
      const aggregatedValidation = validateAggregatedMetrics({
        totalCalls: newTotalCalls,
        averageHandleTime: newAverageHandleTime,
        averageSentiment: newAverageSentiment,
        sentimentScores,
        transferRate
      });
      if (!aggregatedValidation.valid) {
        console.error("[EnhancedMetrics] Aggregated metrics validation failed:", {
          agentId: sanitizedMetrics.agentId,
          errors: aggregatedValidation.errors
        });
        throw new Error(`Aggregated metrics validation failed: ${aggregatedValidation.errors.join(", ")}`);
      }
      if (aggregatedValidation.warnings.length > 0) {
        console.warn("[EnhancedMetrics] Aggregated metrics warnings:", {
          agentId: sanitizedMetrics.agentId,
          warnings: aggregatedValidation.warnings
        });
      }
      const newVersion = currentVersion + 1;
      const updateParams = {
        TableName: tableName,
        Key: {
          agentId: metrics.agentId,
          periodDate: today
        },
        UpdateExpression: `
          SET clinicId = if_not_exists(clinicId, :clinicId),
              totalCalls = :totalCalls,
              inboundCalls = :inboundCalls,
              outboundCalls = :outboundCalls,
              answeredCalls = :answeredCalls,
              totalTalkTime = :totalTalkTime,
              totalHoldTime = :totalHoldTime,
              averageHandleTime = :aht,
              sentimentScores = :sentimentScores,
              averageSentiment = :avgSentiment,
              csatProxy = :csatProxy,
              transferredCalls = :transferredCalls,
              escalatedCalls = :escalatedCalls,
              transferRate = :transferRate,
              customerFrustrationCount = :frustrationCount,
              escalationRequestCount = :escalationCount,
              audioQualityIssues = :audioIssues,
              interruptionRate = :interruptionRate,
              talkTimeBalance = :talkTimeBalance,
              callIds = :callIds,
              version = :newVersion,
              lastUpdated = :now
        `,
        ExpressionAttributeValues: {
          ":clinicId": sanitizedMetrics.clinicId,
          ":totalCalls": newTotalCalls,
          ":inboundCalls": newInboundCalls,
          ":outboundCalls": newOutboundCalls,
          ":answeredCalls": newAnsweredCalls,
          ":totalTalkTime": newTotalTalkTime,
          ":totalHoldTime": newTotalHoldTime,
          ":aht": newAverageHandleTime,
          ":sentimentScores": sentimentScores,
          ":avgSentiment": newAverageSentiment,
          ":csatProxy": csatProxy,
          ":transferredCalls": newTransferredCalls,
          ":escalatedCalls": newEscalatedCalls,
          ":transferRate": transferRate,
          ":frustrationCount": newCustomerFrustrationCount,
          ":escalationCount": newEscalationRequestCount,
          ":audioIssues": newAudioQualityIssues,
          ":interruptionRate": interruptionRate,
          ":talkTimeBalance": talkTimeBalance,
          ":callIds": updatedCallIds,
          ":newVersion": newVersion,
          ":now": (/* @__PURE__ */ new Date()).toISOString()
        }
      };
      if (current) {
        updateParams.ConditionExpression = "version = :currentVersion OR attribute_not_exists(version)";
        updateParams.ExpressionAttributeValues[":currentVersion"] = currentVersion;
      }
      await ddb2.send(new import_lib_dynamodb3.UpdateCommand(updateParams));
      console.log("[EnhancedMetrics] Updated metrics for agent:", sanitizedMetrics.agentId, {
        totalCalls: newTotalCalls,
        aht: newAverageHandleTime,
        avgSentiment: newAverageSentiment,
        attempt: attempt + 1
      });
      return;
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          console.error("[EnhancedMetrics] Max retries exceeded for agent:", sanitizedMetrics.agentId);
          throw new Error(`Failed to update metrics after ${MAX_RETRIES} attempts due to concurrent updates`);
        }
        console.warn("[EnhancedMetrics] Version conflict, retrying...", {
          agentId: sanitizedMetrics.agentId,
          attempt
        });
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        continue;
      } else {
        throw err;
      }
    }
  }
}
async function getClinicTimezone(clinicId) {
  return "America/New_York";
}
function getDateInTimezone(date, timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch (err) {
    console.warn("[EnhancedMetrics] Invalid timezone, falling back to UTC:", {
      timezone,
      error: err
    });
    return date.toISOString().split("T")[0];
  }
}
function calculateTalkTimeBalanceScore(agentTalkPercentage) {
  if (agentTalkPercentage === 50)
    return 100;
  if (agentTalkPercentage >= 40 && agentTalkPercentage <= 60) {
    const deviation = Math.abs(agentTalkPercentage - 50);
    return 100 - deviation * 2;
  }
  if (agentTalkPercentage >= 30 && agentTalkPercentage <= 70) {
    const deviation = Math.abs(agentTalkPercentage - 50);
    return 80 - (deviation - 10) * 3;
  }
  if (agentTalkPercentage < 30) {
    return Math.max(0, 50 - (30 - agentTalkPercentage) * 2);
  } else {
    return Math.max(0, 50 - (agentTalkPercentage - 70) * 2);
  }
}

// src/shared/utils/opendental-api.ts
var import_https2 = __toESM(require("https"));

// src/shared/utils/secrets-helper.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamoClient = null;
function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = new import_client_dynamodb2.DynamoDB({});
  }
  return dynamoClient;
}
var CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
var GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || "TodaysDentalInsights-GlobalSecrets";
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
var CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || "300000", 10);
var clinicSecretsCache = /* @__PURE__ */ new Map();
var clinicConfigCache = /* @__PURE__ */ new Map();
function isCacheValid(entry) {
  return entry !== void 0 && entry.expiresAt > Date.now();
}
function setCacheEntry(cache, key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}
async function getClinicSecrets(clinicId) {
  const cached = clinicSecretsCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_SECRETS_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    });
    if (!response.Item) {
      console.warn(`[SecretsHelper] No secrets found for clinic: ${clinicId}`);
      return null;
    }
    const secrets = (0, import_util_dynamodb.unmarshall)(response.Item);
    setCacheEntry(clinicSecretsCache, clinicId, secrets);
    return secrets;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic secrets for ${clinicId}:`, error);
    throw error;
  }
}
async function getClinicConfig(clinicId) {
  const cached = clinicConfigCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_CONFIG_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    });
    if (!response.Item) {
      console.warn(`[SecretsHelper] No config found for clinic: ${clinicId}`);
      return null;
    }
    const config = (0, import_util_dynamodb.unmarshall)(response.Item);
    setCacheEntry(clinicConfigCache, clinicId, config);
    return config;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic config for ${clinicId}:`, error);
    throw error;
  }
}

// src/shared/utils/opendental-api.ts
var API_HOST = "api.opendental.com";
var API_BASE = "/api/v1";
var clinicConfigCache2 = /* @__PURE__ */ new Map();
async function getOpenDentalClinicConfig(clinicId) {
  if (clinicConfigCache2.has(clinicId)) {
    return clinicConfigCache2.get(clinicId);
  }
  const [config, secrets] = await Promise.all([
    getClinicConfig(clinicId),
    getClinicSecrets(clinicId)
  ]);
  if (!config || !secrets) {
    console.error(`Clinic configuration not found for clinicId: ${clinicId}`);
    return null;
  }
  const result = {
    clinicId,
    developerKey: secrets.openDentalDeveloperKey,
    customerKey: secrets.openDentalCustomerKey,
    config
  };
  clinicConfigCache2.set(clinicId, result);
  return result;
}
async function makeOpenDentalRequest(method, path, clinicId, body) {
  const clinic = await getOpenDentalClinicConfig(clinicId);
  if (!clinic) {
    throw new Error(`Clinic configuration not found for ${clinicId}`);
  }
  const headers = {
    "Authorization": `ODFHIR ${clinic.developerKey}/${clinic.customerKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      path,
      method,
      headers
    };
    const req = import_https2.default.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject({
              statusCode: res.statusCode,
              message: parsed.message || data || "OpenDental API error",
              data: parsed
            });
          }
        } catch (err) {
          reject({
            statusCode: res.statusCode,
            message: "Failed to parse OpenDental API response",
            data
          });
        }
      });
    });
    req.on("error", (err) => {
      reject({
        statusCode: 500,
        message: err.message || "Network error calling OpenDental API"
      });
    });
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}
async function searchPatientByPhone(phoneNumber, clinicId) {
  try {
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    const phoneFormats = [
      cleanPhone,
      cleanPhone.slice(-10),
      // Last 10 digits
      cleanPhone.slice(-7)
      // Last 7 digits (local number)
    ];
    console.log(`[OpenDental] Searching for patient with phone: ${phoneNumber} (cleaned: ${cleanPhone})`);
    for (const phone of phoneFormats) {
      if (!phone || phone.length < 7)
        continue;
      const path = `${API_BASE}/patients?Phone=${encodeURIComponent(phone)}`;
      try {
        const response = await makeOpenDentalRequest("GET", path, clinicId);
        if (Array.isArray(response) && response.length > 0) {
          console.log(`[OpenDental] Found ${response.length} patient(s) for phone ${phone}`);
          return response[0];
        }
      } catch (err) {
        if (err.statusCode === 404) {
          continue;
        }
        throw err;
      }
    }
    console.log(`[OpenDental] No patients found for phone: ${phoneNumber}`);
    return null;
  } catch (error) {
    console.error("[OpenDental] Error searching patient by phone:", error);
    throw error;
  }
}
async function getPatientByPatNum(patNum, clinicId) {
  try {
    console.log(`[OpenDental] Fetching patient PatNum: ${patNum}`);
    const path = `${API_BASE}/patients/${patNum}`;
    const patient = await makeOpenDentalRequest("GET", path, clinicId);
    console.log(`[OpenDental] Successfully retrieved patient: ${patient.FName} ${patient.LName}`);
    return patient;
  } catch (error) {
    console.error(`[OpenDental] Error fetching patient ${patNum}:`, error);
    throw error;
  }
}
async function createCommlog(patNum, note, clinicId, options) {
  try {
    console.log(`[OpenDental] Creating commlog for PatNum: ${patNum}`);
    const body = {
      PatNum: patNum,
      Note: note,
      Mode_: options?.mode || "Phone",
      SentOrReceived: options?.sentOrReceived || "Received"
    };
    if (options?.commType) {
      body.commType = options.commType;
    }
    if (options?.commDateTime) {
      body.CommDateTime = options.commDateTime;
    }
    const path = `${API_BASE}/commlogs`;
    const commlog = await makeOpenDentalRequest("POST", path, clinicId, body);
    console.log(`[OpenDental] Successfully created commlog: ${commlog.CommlogNum}`);
    return commlog;
  } catch (error) {
    console.error(`[OpenDental] Error creating commlog for patient ${patNum}:`, error);
    throw error;
  }
}
function extractPatNumFromCallData(callData) {
  const patNum = callData.patNum || callData.PatNum || callData.metadata?.PatNum || callData.metadata?.patNum || callData.attributes?.PatNum || callData.attributes?.patNum;
  if (patNum) {
    const parsed = parseInt(patNum, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}
function generateCallSummary(analytics, patientData) {
  const lines = [];
  lines.push("=== Call Summary (Automated) ===");
  lines.push(`Call ID: ${analytics.callId}`);
  lines.push(`Date: ${analytics.timestampIso}`);
  lines.push(`Duration: ${formatDuration(analytics.totalDuration)}`);
  lines.push(`Status: ${analytics.status}`);
  if (analytics.agentId) {
    lines.push(`Agent: ${analytics.agentId}`);
  }
  if (analytics.queueDuration > 0) {
    lines.push(`Queue Time: ${formatDuration(analytics.queueDuration)}`);
  }
  if (analytics.talkDuration > 0) {
    lines.push(`Talk Time: ${formatDuration(analytics.talkDuration)}`);
  }
  if (analytics.holdDuration > 0) {
    lines.push(`Hold Time: ${formatDuration(analytics.holdDuration)}`);
  }
  const characteristics = [];
  if (analytics.wasTransferred)
    characteristics.push("Transferred");
  if (analytics.wasAbandoned)
    characteristics.push("Abandoned");
  if (analytics.wasCallback)
    characteristics.push("Callback");
  if (analytics.wasVip)
    characteristics.push("VIP");
  if (characteristics.length > 0) {
    lines.push(`Characteristics: ${characteristics.join(", ")}`);
  }
  if (patientData) {
    lines.push("");
    lines.push("=== Patient Information ===");
    lines.push(`Name: ${patientData.FName} ${patientData.LName}`);
    if (patientData.Birthdate && patientData.Birthdate !== "0001-01-01") {
      lines.push(`DOB: ${patientData.Birthdate}`);
    }
    if (patientData.PreferContactMethod && patientData.PreferContactMethod !== "None") {
      lines.push(`Preferred Contact: ${patientData.PreferContactMethod}`);
    }
  }
  lines.push("");
  lines.push("This call summary was automatically generated by the analytics system.");
  return lines.join("\n");
}
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

// src/services/chime/process-call-analytics-stream.ts
var ddb = getDynamoDBClient();
var ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
if (!ANALYTICS_TABLE) {
  throw new Error("CALL_ANALYTICS_TABLE_NAME environment variable is required");
}
var DEDUP_TABLE = getDedupTableName(ANALYTICS_TABLE);
var openDentalCircuitBreaker = getCircuitBreaker("OpenDentalAPI", {
  failureThreshold: 5,
  // Open circuit after 5 failures
  successThreshold: 3,
  // Need 3 successes to close
  timeout: 12e4,
  // Wait 2 minutes before retry
  monitoringPeriod: 3e5
  // Track failures over 5 minutes
});
var handler = async (event) => {
  console.log("[AnalyticsStream] Processing batch", {
    recordCount: event.Records.length,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  const results = {
    processed: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0
  };
  for (const record of event.Records) {
    try {
      const processed = await processStreamRecord(record);
      if (processed === "PROCESSED") {
        results.processed++;
      } else if (processed === "SKIPPED") {
        results.skipped++;
      } else if (processed === "DUPLICATE") {
        results.duplicates++;
      }
    } catch (err) {
      let callId = "unknown";
      try {
        const newImage = record.dynamodb?.NewImage;
        const oldImage = record.dynamodb?.OldImage;
        const image = newImage || oldImage;
        if (image) {
          const unmarshalled = (0, import_util_dynamodb2.unmarshall)(image);
          callId = unmarshalled.callId || "unknown";
        }
      } catch (unmarshalErr) {
      }
      console.error("[AnalyticsStream] Error processing record:", {
        error: err.message,
        stack: err.stack,
        eventID: record.eventID,
        eventName: record.eventName,
        callId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      results.errors++;
    }
  }
  console.log("[AnalyticsStream] Batch complete:", results);
};
async function processStreamRecord(record) {
  if (!record.dynamodb) {
    console.error("[processStreamRecord] Missing dynamodb data in record");
    return "SKIPPED";
  }
  const { NewImage, OldImage } = record.dynamodb;
  if (!NewImage) {
    console.warn("[processStreamRecord] No NewImage in record, skipping");
    return "SKIPPED";
  }
  if (record.eventName !== "MODIFY" && record.eventName !== "REMOVE") {
    return "SKIPPED";
  }
  const newImage = record.dynamodb?.NewImage ? (0, import_util_dynamodb2.unmarshall)(record.dynamodb.NewImage) : null;
  const oldImage = record.dynamodb?.OldImage ? (0, import_util_dynamodb2.unmarshall)(record.dynamodb.OldImage) : null;
  const wasCompleted = oldImage?.status !== "completed" && newImage?.status === "completed";
  const wasAbandoned = oldImage?.status !== "abandoned" && newImage?.status === "abandoned";
  const wasRemoved = record.eventName === "REMOVE" && oldImage;
  const wasActivated = oldImage?.status !== "active" && newImage?.status === "active";
  if (!wasCompleted && !wasAbandoned && !wasRemoved && !wasActivated) {
    return "SKIPPED";
  }
  const callData = newImage || oldImage;
  if (!callData?.callId) {
    console.warn("[AnalyticsStream] Record missing callId, skipping");
    return "SKIPPED";
  }
  console.log("[AnalyticsStream] Processing call:", {
    callId: callData.callId,
    status: callData.status,
    eventName: record.eventName,
    wasCompleted,
    wasAbandoned,
    wasRemoved,
    wasActivated
  });
  if (wasActivated) {
    return await handleCallActivation(callData, record);
  }
  const stateTransition = wasCompleted ? "completed" : wasAbandoned ? "abandoned" : "removed";
  const analytics = await generateCallAnalytics(callData, record);
  await enrichWithPatientData(analytics, callData);
  const stored = await storeAnalyticsWithDedup(analytics, record.eventID);
  if (!stored) {
    console.log("[AnalyticsStream] Analytics already stored, skipping duplicate");
    return "DUPLICATE";
  }
  try {
    await checkAndMarkProcessed(
      ddb,
      DEDUP_TABLE,
      callData.callId,
      `post-call-${stateTransition}`
    );
  } catch (err) {
    console.warn("[AnalyticsStream] Failed to mark state transition, but analytics stored:", {
      callId: callData.callId,
      error: err.message
    });
  }
  if (stored && analytics.agentId) {
    try {
      await trackEnhancedCallMetrics(
        ddb,
        process.env.AGENT_PERFORMANCE_TABLE_NAME,
        {
          agentId: analytics.agentId,
          clinicId: analytics.clinicId,
          callId: analytics.callId,
          direction: analytics.direction,
          duration: analytics.totalDuration,
          talkTime: analytics.talkDuration,
          holdTime: analytics.holdDuration,
          sentiment: analytics.wasAbandoned ? "NEGATIVE" : "NEUTRAL",
          transferred: analytics.wasTransferred,
          escalated: false,
          issues: [],
          timestamp: callData.callEndTime || Date.now()
          // Use actual call end time
        }
      );
    } catch (err) {
      console.error("[AnalyticsStream] Failed to track agent metrics:", {
        error: err.message,
        callId: analytics.callId,
        agentId: analytics.agentId
      });
    }
  }
  if (stored && analytics.patientData) {
    await createCallCommlog(analytics);
  }
  return stored ? "PROCESSED" : "DUPLICATE";
}
async function handleCallActivation(callData, record) {
  const callId = callData.callId;
  const rawCallStartTime = callData.callStartTime || callData.queueEntryTime;
  let timestamp;
  if (rawCallStartTime) {
    const parsed = parseTimestamp(rawCallStartTime);
    timestamp = parsed ? Math.floor(parsed / 1e3) : Math.floor(Date.now() / 1e3);
  } else {
    timestamp = Math.floor(Date.now() / 1e3);
  }
  const ttl = timestamp + 90 * 24 * 60 * 60;
  const existingCheck = await ddb.send(new import_lib_dynamodb4.GetCommand({
    TableName: ANALYTICS_TABLE,
    Key: {
      callId,
      timestamp
      // Use the consistent timestamp calculated above
    }
  }));
  if (existingCheck.Item) {
    console.log("[handleCallActivation] Analytics already exist for active call:", {
      callId,
      existingTimestamp: existingCheck.Item.timestamp,
      queriedTimestamp: timestamp
    });
    return "DUPLICATE";
  }
  const initialAnalytics = {
    // Primary keys - CRITICAL: Use same timestamp as the existence check
    callId,
    timestamp,
    // Call status
    callStatus: "active",
    analyticsState: "INITIALIZING",
    // Will transition to ACTIVE when Kinesis events arrive
    // Core metadata
    clinicId: callData.clinicId || "unknown",
    agentId: callData.agentId || null,
    direction: callData.direction || "inbound",
    customerPhone: callData.from || callData.to || "unknown",
    // Timestamps - use the consistent timestamp
    callStartTime: new Date(timestamp * 1e3).toISOString(),
    callStartTimestamp: timestamp * 1e3,
    // Convert back to milliseconds for consistency
    // Initial counts (will be updated by real-time analytics)
    transcriptCount: 0,
    latestTranscripts: [],
    sentimentDataPoints: 0,
    latestSentiment: [],
    detectedIssues: [],
    keywords: [],
    keyPhrases: [],
    entities: [],
    // Categorization
    callCategory: "uncategorized",
    categoryScores: {},
    // Processing metadata
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    processedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceEvent: "call-activation",
    ttl,
    // Flags
    isLiveCall: true,
    _note: "Initial record for live analytics. Will be enriched with transcripts and sentiment in real-time."
  };
  try {
    await ddb.send(new import_lib_dynamodb4.PutCommand({
      TableName: ANALYTICS_TABLE,
      Item: initialAnalytics,
      ConditionExpression: "attribute_not_exists(callId) AND attribute_not_exists(#ts)",
      ExpressionAttributeNames: {
        "#ts": "timestamp"
      }
    }));
    console.log("[handleCallActivation] Created initial analytics for live call:", {
      callId,
      clinicId: initialAnalytics.clinicId,
      agentId: initialAnalytics.agentId,
      timestamp
    });
    return "PROCESSED";
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      console.log("[handleCallActivation] Analytics already exist (race condition):", callId);
      return "DUPLICATE";
    }
    throw err;
  }
}
async function generateCallAnalytics(callData, record) {
  if (!callData.callId) {
    throw new Error("Missing required field: callId");
  }
  if (!callData.clinicId) {
    throw new Error("Missing required field: clinicId");
  }
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1e3;
  let timestamp = parseTimestamp(callData.timestamp || callData.callStartTime || Date.now());
  if (timestamp && timestamp > now + 6e4) {
    console.warn("[generateCallAnalytics] Future timestamp detected, using current time:", {
      originalTimestamp: timestamp,
      callId: callData.callId
    });
    timestamp = now;
  }
  if (timestamp && timestamp < oneYearAgo) {
    console.warn("[generateCallAnalytics] Very old timestamp (>1 year), may be invalid:", {
      timestamp,
      callId: callData.callId,
      ageInDays: Math.floor((now - timestamp) / (24 * 60 * 60 * 1e3))
    });
  }
  if (callData.phoneNumber) {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(callData.phoneNumber)) {
      console.warn("[generateCallAnalytics] Invalid phone number format:", {
        phoneNumber: callData.phoneNumber,
        callId: callData.callId
      });
    }
  }
  const queueEntryTime = parseTimestamp(callData.queueEntryTime || callData.queueEntryTimeIso);
  const connectedAt = parseTimestamp(callData.connectedAt);
  const completedAt = parseTimestamp(callData.completedAt || callData.endedAtIso);
  const ringingStartedAt = parseTimestamp(callData.ringingStartedAt || callData.assignedAt);
  const totalDuration = queueEntryTime && completedAt ? Math.floor((completedAt - queueEntryTime) / 1e3) : 0;
  const queueDuration = queueEntryTime && connectedAt ? Math.floor((connectedAt - queueEntryTime) / 1e3) : 0;
  const ringDuration = ringingStartedAt && connectedAt ? Math.floor((connectedAt - ringingStartedAt) / 1e3) : callData.ringDuration || 0;
  const holdDuration = callData.holdDuration || 0;
  const callDuration = connectedAt && completedAt ? Math.floor((completedAt - connectedAt) / 1e3) : 0;
  const talkDuration = Math.max(0, callDuration - holdDuration);
  const analytics = {
    callId: callData.callId,
    timestamp: queueEntryTime ? Math.floor(queueEntryTime / 1e3) : Math.floor(now / 1e3),
    timestampIso: callData.queueEntryTimeIso || (/* @__PURE__ */ new Date()).toISOString(),
    clinicId: callData.clinicId,
    agentId: callData.assignedAgentId,
    status: callData.status,
    // Durations
    totalDuration,
    queueDuration,
    ringDuration,
    holdDuration,
    talkDuration,
    // Characteristics
    wasTransferred: !!callData.transferredToAgentId || !!callData.transferToAgentId,
    wasAbandoned: callData.status === "abandoned",
    wasCallback: !!callData.isCallback,
    wasVip: !!callData.isVip,
    // Metadata
    rejectionCount: callData.rejectionCount || 0,
    transferCount: callData.transferCount || 0,
    holdCount: callData.holdCount || 0,
    // Source
    phoneNumber: callData.phoneNumber,
    direction: callData.direction || "inbound",
    // Processing metadata
    processedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceEvent: record.eventName,
    ttl: Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60
    // 90 days
  };
  return analytics;
}
async function storeAnalyticsWithDedup(analytics, eventId) {
  const dedupResult = await checkAndMarkProcessed(
    ddb,
    DEDUP_TABLE,
    analytics.callId,
    "post-call",
    eventId
  );
  if (dedupResult.isDuplicate) {
    console.log("[AnalyticsStream] Duplicate post-call analytics event, skipping:", analytics.callId);
    return false;
  }
  try {
    const { Item: existingRecord } = await ddb.send(new import_lib_dynamodb4.GetCommand({
      TableName: ANALYTICS_TABLE,
      Key: { callId: analytics.callId, timestamp: analytics.timestamp }
    }));
    if (!shouldProcessAnalytics(existingRecord, "post-call")) {
      console.log("[AnalyticsStream] Skipping - record should not be processed:", analytics.callId);
      return false;
    }
  } catch (err) {
    console.warn("[AnalyticsStream] Error checking existing record:", err.message);
  }
  try {
    await ddb.send(new import_lib_dynamodb4.PutCommand({
      TableName: ANALYTICS_TABLE,
      Item: {
        ...analytics,
        callStatus: analytics.status === "completed" ? "completed" : analytics.status === "abandoned" ? "abandoned" : "failed"
      }
    }));
    console.log("[AnalyticsStream] Stored post-call analytics for call:", analytics.callId);
    return true;
  } catch (err) {
    console.error("[AnalyticsStream] Error storing analytics:", err);
    throw err;
  }
}
function parseTimestamp(value) {
  if (!value)
    return null;
  if (typeof value === "number") {
    const YEAR_2010_SECONDS = 1262304e3;
    return value > YEAR_2010_SECONDS * 1e3 ? value : value * 1e3;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}
async function enrichWithPatientData(analytics, callData) {
  try {
    if (!analytics.clinicId) {
      console.log("[AnalyticsStream] No clinicId, skipping patient data enrichment");
      return;
    }
    const circuitState = openDentalCircuitBreaker.getState();
    if (circuitState.state === "OPEN") {
      console.warn("[AnalyticsStream] OpenDental circuit breaker is OPEN, skipping patient enrichment");
      return;
    }
    let patNum = extractPatNumFromCallData(callData);
    if (!patNum && analytics.phoneNumber) {
      console.log(`[AnalyticsStream] Searching for patient by phone: ${analytics.phoneNumber}`);
      try {
        const patient = await openDentalCircuitBreaker.execute(
          () => searchPatientByPhone(analytics.phoneNumber, analytics.clinicId)
        );
        if (patient?.PatNum) {
          patNum = patient.PatNum;
          console.log(`[AnalyticsStream] Found patient PatNum: ${patNum}`);
        }
      } catch (err) {
        console.warn("[AnalyticsStream] Error searching patient by phone:", err.message);
      }
    }
    if (patNum) {
      console.log(`[AnalyticsStream] Fetching patient details for PatNum: ${patNum}`);
      try {
        const patientDetails = await openDentalCircuitBreaker.execute(
          () => getPatientByPatNum(patNum, analytics.clinicId)
        );
        analytics.patientData = {
          PatNum: patientDetails.PatNum,
          LName: patientDetails.LName,
          FName: patientDetails.FName,
          Birthdate: patientDetails.Birthdate,
          Email: patientDetails.Email,
          WirelessPhone: patientDetails.WirelessPhone,
          HmPhone: patientDetails.HmPhone,
          WkPhone: patientDetails.WkPhone,
          Address: patientDetails.Address,
          City: patientDetails.City,
          State: patientDetails.State,
          Zip: patientDetails.Zip,
          PreferContactMethod: patientDetails.PreferContactMethod,
          EstBalance: patientDetails.EstBalance,
          BalTotal: patientDetails.BalTotal
        };
        console.log(`[AnalyticsStream] Patient data enriched: ${patientDetails.FName} ${patientDetails.LName}`);
      } catch (err) {
        console.error(`[AnalyticsStream] Error fetching patient details:`, err.message);
      }
    } else {
      console.log("[AnalyticsStream] No PatNum available, skipping patient data enrichment");
    }
  } catch (error) {
    console.error("[AnalyticsStream] Error in enrichWithPatientData:", error);
  }
}
async function createCallCommlog(analytics) {
  try {
    if (!analytics.patientData?.PatNum || !analytics.clinicId) {
      console.log("[AnalyticsStream] Missing PatNum or clinicId, skipping commlog creation");
      return;
    }
    const circuitState = openDentalCircuitBreaker.getState();
    if (circuitState.state === "OPEN") {
      console.warn("[AnalyticsStream] OpenDental circuit breaker is OPEN, skipping commlog creation");
      return;
    }
    const note = generateCallSummary(analytics, analytics.patientData);
    let commType = "Misc";
    if (analytics.wasCallback) {
      commType = "ApptRelated";
    }
    const commlog = await openDentalCircuitBreaker.execute(
      () => createCommlog(
        analytics.patientData.PatNum,
        note,
        analytics.clinicId,
        {
          commType,
          mode: "Phone",
          sentOrReceived: analytics.direction === "inbound" ? "Received" : "Sent",
          commDateTime: analytics.timestampIso
        }
      )
    );
    analytics.commlogNum = commlog.CommlogNum;
    console.log(`[AnalyticsStream] Commlog created: ${commlog.CommlogNum} for patient ${analytics.patientData.PatNum}`);
    if (ANALYTICS_TABLE) {
      await ddb.send(new import_lib_dynamodb4.UpdateCommand({
        TableName: ANALYTICS_TABLE,
        Key: {
          callId: analytics.callId,
          timestamp: analytics.timestamp
        },
        UpdateExpression: "SET commlogNum = :commlogNum",
        ExpressionAttributeValues: {
          ":commlogNum": commlog.CommlogNum
        }
      }));
    }
  } catch (error) {
    console.error("[AnalyticsStream] Error creating commlog:", error);
  }
}
function calculateAverages(records) {
  if (records.length === 0) {
    return {
      avgQueueTime: 0,
      avgTalkTime: 0,
      avgHoldTime: 0,
      abandonRate: 0,
      transferRate: 0
    };
  }
  const totals = records.reduce((acc, record) => ({
    queueTime: acc.queueTime + record.queueDuration,
    talkTime: acc.talkTime + record.talkDuration,
    holdTime: acc.holdTime + record.holdDuration,
    abandoned: acc.abandoned + (record.wasAbandoned ? 1 : 0),
    transferred: acc.transferred + (record.wasTransferred ? 1 : 0)
  }), {
    queueTime: 0,
    talkTime: 0,
    holdTime: 0,
    abandoned: 0,
    transferred: 0
  });
  return {
    avgQueueTime: Math.round(totals.queueTime / records.length),
    avgTalkTime: Math.round(totals.talkTime / records.length),
    avgHoldTime: Math.round(totals.holdTime / records.length),
    abandonRate: totals.abandoned / records.length * 100,
    transferRate: totals.transferred / records.length * 100
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  calculateAverages,
  handler
});

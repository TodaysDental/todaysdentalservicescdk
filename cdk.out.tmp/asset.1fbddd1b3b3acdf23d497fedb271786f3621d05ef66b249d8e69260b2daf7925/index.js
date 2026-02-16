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

// src/services/chime/process-agent-performance-dlq.ts
var process_agent_performance_dlq_exports = {};
__export(process_agent_performance_dlq_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(process_agent_performance_dlq_exports);
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_sns = require("@aws-sdk/client-sns");

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

// src/services/shared/utils/enhanced-agent-metrics.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

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
      const existing = await ddb2.send(new import_lib_dynamodb2.GetCommand({
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
      await ddb2.send(new import_lib_dynamodb2.UpdateCommand(updateParams));
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

// src/services/chime/process-agent-performance-dlq.ts
var ddb = getDynamoDBClient();
var sns = new import_client_sns.SNSClient({});
var AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var FAILURES_TABLE = process.env.AGENT_PERFORMANCE_FAILURES_TABLE_NAME;
var ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN;
var MAX_RETRY_ATTEMPTS = 3;
var handler = async (event) => {
  console.log("[DLQProcessor] Processing batch", {
    recordCount: event.Records.length,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  const batchItemFailures = [];
  const results = {
    retried: 0,
    permanentFailures: 0,
    errors: 0
  };
  for (const record of event.Records) {
    try {
      const processed = await processRecord(record);
      if (processed === "RETRIED") {
        results.retried++;
      } else if (processed === "PERMANENT_FAILURE") {
        results.permanentFailures++;
      }
    } catch (err) {
      console.error("[DLQProcessor] Error processing record:", {
        messageId: record.messageId,
        error: err.message,
        stack: err.stack
      });
      batchItemFailures.push({
        itemIdentifier: record.messageId
      });
      results.errors++;
    }
  }
  console.log("[DLQProcessor] Batch complete:", results);
  return {
    batchItemFailures
  };
};
async function processRecord(record) {
  let failure;
  try {
    failure = JSON.parse(record.body);
  } catch (parseErr) {
    console.error("[DLQProcessor] Failed to parse message body:", {
      messageId: record.messageId,
      body: record.body
    });
    await storePermanentFailure({
      callId: "unknown",
      agentId: "unknown",
      clinicId: "unknown",
      error: {
        message: "Failed to parse DLQ message",
        code: "PARSE_ERROR"
      },
      metrics: {
        direction: "unknown",
        duration: 0
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      attemptCount: 999
    }, "PARSE_ERROR", record.body);
    return "PERMANENT_FAILURE";
  }
  const receiveCount = parseInt(record.attributes?.ApproximateReceiveCount || "1", 10);
  const totalAttempts = (failure.attemptCount || 0) + receiveCount;
  console.log("[DLQProcessor] Processing failure:", {
    callId: failure.callId,
    agentId: failure.agentId,
    originalAttempts: failure.attemptCount,
    dlqReceiveCount: receiveCount,
    totalAttempts
  });
  if (totalAttempts >= MAX_RETRY_ATTEMPTS) {
    console.log("[DLQProcessor] Max retries exceeded, storing permanent failure:", failure.callId);
    await storePermanentFailure(failure, "MAX_RETRIES_EXCEEDED");
    await sendAlert(failure, "MAX_RETRIES_EXCEEDED");
    return "PERMANENT_FAILURE";
  }
  if (!failure.agentId || !failure.clinicId || !AGENT_PERFORMANCE_TABLE) {
    console.error("[DLQProcessor] Missing required data:", {
      hasAgentId: !!failure.agentId,
      hasClinicId: !!failure.clinicId,
      hasTable: !!AGENT_PERFORMANCE_TABLE
    });
    await storePermanentFailure(failure, "MISSING_DATA");
    return "PERMANENT_FAILURE";
  }
  try {
    await trackEnhancedCallMetrics(ddb, AGENT_PERFORMANCE_TABLE, {
      agentId: failure.agentId,
      clinicId: failure.clinicId,
      callId: failure.callId,
      direction: failure.metrics.direction,
      duration: failure.metrics.duration || 0,
      talkTime: failure.metrics.duration || 0,
      holdTime: 0,
      sentiment: failure.metrics.sentiment,
      sentimentScore: failure.metrics.sentimentScore,
      transferred: false,
      escalated: false,
      issues: [],
      timestamp: new Date(failure.timestamp).getTime()
    });
    console.log("[DLQProcessor] Successfully retried metrics tracking:", {
      callId: failure.callId,
      agentId: failure.agentId,
      attempt: totalAttempts
    });
    return "RETRIED";
  } catch (retryErr) {
    console.error("[DLQProcessor] Retry failed:", {
      callId: failure.callId,
      error: retryErr.message
    });
    failure.error = {
      message: retryErr.message,
      stack: retryErr.stack,
      code: retryErr.code || retryErr.name
    };
    failure.attemptCount = totalAttempts;
    throw retryErr;
  }
}
async function storePermanentFailure(failure, reason, rawBody) {
  if (!FAILURES_TABLE) {
    console.error("[DLQProcessor] FAILURES_TABLE not configured, logging to CloudWatch");
    console.error("PERMANENT_FAILURE", JSON.stringify({
      ...failure,
      permanentFailureReason: reason,
      rawBody
    }));
    return;
  }
  const failureId = `${failure.callId}-${Date.now()}`;
  const ttl = Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60;
  try {
    await ddb.send(new import_lib_dynamodb3.PutCommand({
      TableName: FAILURES_TABLE,
      Item: {
        failureId,
        callId: failure.callId,
        agentId: failure.agentId,
        clinicId: failure.clinicId,
        error: failure.error,
        metrics: failure.metrics,
        originalTimestamp: failure.timestamp,
        permanentFailureReason: reason,
        attemptCount: failure.attemptCount,
        storedAt: (/* @__PURE__ */ new Date()).toISOString(),
        rawBody,
        ttl
      }
    }));
    console.log("[DLQProcessor] Stored permanent failure:", {
      failureId,
      callId: failure.callId,
      reason
    });
  } catch (err) {
    console.error("[DLQProcessor] Failed to store permanent failure:", {
      error: err.message,
      callId: failure.callId
    });
    console.error("PERMANENT_FAILURE_UNRECOVERABLE", JSON.stringify({
      ...failure,
      permanentFailureReason: reason,
      storeError: err.message
    }));
  }
}
async function sendAlert(failure, reason) {
  if (!ALERT_TOPIC_ARN) {
    console.warn("[DLQProcessor] ALERT_TOPIC_ARN not configured, skipping alert");
    return;
  }
  try {
    await sns.send(new import_client_sns.PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: `[ALERT] Agent Performance Tracking Failure - ${failure.agentId}`,
      Message: JSON.stringify({
        alertType: "AGENT_PERFORMANCE_TRACKING_FAILURE",
        severity: "HIGH",
        callId: failure.callId,
        agentId: failure.agentId,
        clinicId: failure.clinicId,
        reason,
        error: failure.error.message,
        attemptCount: failure.attemptCount,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        action: "Manual review required. Check AgentPerformanceFailures table for details."
      }, null, 2),
      MessageAttributes: {
        alertType: {
          DataType: "String",
          StringValue: "AGENT_PERFORMANCE_TRACKING_FAILURE"
        },
        severity: {
          DataType: "String",
          StringValue: "HIGH"
        }
      }
    }));
    console.log("[DLQProcessor] Alert sent for failure:", failure.callId);
  } catch (err) {
    console.error("[DLQProcessor] Failed to send alert:", {
      error: err.message,
      callId: failure.callId
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

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

// src/services/chime/finalize-analytics.ts
var finalize_analytics_exports = {};
__export(finalize_analytics_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(finalize_analytics_exports);
var import_lib_dynamodb7 = require("@aws-sdk/lib-dynamodb");

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
async function trackEnhancedCallMetrics(ddb3, tableName, metrics) {
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
      const existing = await ddb3.send(new import_lib_dynamodb2.GetCommand({
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
      await ddb3.send(new import_lib_dynamodb2.UpdateCommand(updateParams));
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

// src/services/chime/real-time-coaching.ts
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_client_iot_data_plane = require("@aws-sdk/client-iot-data-plane");
var ddb = import_lib_dynamodb3.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var iot = new import_client_iot_data_plane.IoTDataPlaneClient({});
var AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME;
if (!AGENT_PRESENCE_TABLE) {
  throw new Error("AGENT_PRESENCE_TABLE_NAME environment variable is required");
}
async function generateCallCoachingSummary(callAnalytics) {
  if (!callAnalytics || typeof callAnalytics !== "object") {
    console.error("[generateCallCoachingSummary] Invalid analytics data:", callAnalytics);
    return {
      score: 50,
      strengths: [],
      improvements: ["Unable to generate coaching summary - missing call data"],
      error: "INVALID_INPUT"
    };
  }
  try {
    const strengths = [];
    const improvements = [];
    let score = 100;
    const speakerMetrics = callAnalytics.speakerMetrics || {};
    const agentTalkPercentage = typeof speakerMetrics.agentTalkPercentage === "number" ? speakerMetrics.agentTalkPercentage : 0;
    const interruptionCount = typeof speakerMetrics.interruptionCount === "number" ? speakerMetrics.interruptionCount : 0;
    const silencePercentage = typeof speakerMetrics.silencePercentage === "number" ? speakerMetrics.silencePercentage : 0;
    const overallSentiment = callAnalytics.overallSentiment;
    const detectedIssues = Array.isArray(callAnalytics.detectedIssues) ? callAnalytics.detectedIssues : [];
    if (agentTalkPercentage >= 40 && agentTalkPercentage <= 60) {
      strengths.push("Good balance of listening and speaking");
    } else if (agentTalkPercentage > 70) {
      improvements.push("Listen more and allow customer to speak");
      score -= 10;
    } else if (agentTalkPercentage < 30) {
      improvements.push("Provide more guidance and information");
      score -= 5;
    }
    if (interruptionCount === 0) {
      strengths.push("Excellent active listening - no interruptions");
    } else if (interruptionCount <= 2) {
      strengths.push("Good listening skills");
    } else {
      improvements.push("Reduce interruptions - let customer finish speaking");
      score -= interruptionCount * 3;
    }
    if (overallSentiment === "POSITIVE") {
      strengths.push("Maintained positive customer sentiment");
      score += 10;
    } else if (overallSentiment === "NEGATIVE") {
      improvements.push("Work on improving customer sentiment");
      score -= 15;
    }
    if (detectedIssues.includes("customer-frustration")) {
      improvements.push("Customer became frustrated - use more empathetic language");
      score -= 10;
    }
    if (detectedIssues.includes("escalation-request")) {
      improvements.push("Customer requested escalation - try to resolve issues earlier");
      score -= 5;
    }
    if (detectedIssues.includes("poor-audio-quality")) {
      improvements.push("Audio quality issues affected call - check equipment");
      score -= 5;
    }
    if (silencePercentage < 10) {
      strengths.push("Kept conversation engaging with minimal silence");
    } else if (silencePercentage > 25) {
      improvements.push("Reduce awkward silences - ask more questions");
      score -= 5;
    }
    score = Math.max(0, Math.min(100, score));
    if (strengths.length === 0 && improvements.length === 0) {
      improvements.push("Insufficient data to generate detailed coaching feedback");
      score = 50;
    }
    return {
      score,
      strengths,
      improvements
    };
  } catch (err) {
    console.error("[generateCallCoachingSummary] Error generating coaching summary:", {
      error: err.message,
      stack: err.stack,
      callId: callAnalytics?.callId
    });
    return {
      score: 50,
      strengths: [],
      improvements: ["Error generating coaching summary - data may be incomplete"],
      error: err.message
    };
  }
}

// src/services/shared/utils/agent-performance-dlq.ts
var import_client_sqs = require("@aws-sdk/client-sqs");
var import_client_sns = require("@aws-sdk/client-sns");
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var sqs = new import_client_sqs.SQSClient({});
var sns = new import_client_sns.SNSClient({});
async function sendToPerformanceDLQ(failure, dlqUrl) {
  const queueUrl = dlqUrl || process.env.AGENT_PERFORMANCE_DLQ_URL;
  if (!queueUrl) {
    console.error("[PerformanceDLQ] No DLQ URL configured, cannot send failure");
    return;
  }
  try {
    await sqs.send(new import_client_sqs.SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(failure),
      MessageAttributes: {
        callId: {
          DataType: "String",
          StringValue: failure.callId
        },
        agentId: {
          DataType: "String",
          StringValue: failure.agentId
        },
        errorCode: {
          DataType: "String",
          StringValue: failure.error.code || "UNKNOWN"
        },
        attemptCount: {
          DataType: "Number",
          StringValue: failure.attemptCount.toString()
        }
      }
    }));
    console.log("[PerformanceDLQ] Sent failure to DLQ:", {
      callId: failure.callId,
      agentId: failure.agentId,
      error: failure.error.message
    });
  } catch (err) {
    console.error("[PerformanceDLQ] Error sending to DLQ:", err);
    console.error("[PerformanceDLQ] CRITICAL FAILURE:", JSON.stringify(failure));
  }
}

// src/types/analytics-state-machine.ts
function isTerminalState(state) {
  return state === "finalized" /* FINALIZED */ || state === "failed" /* FAILED */;
}

// src/services/shared/utils/analytics-state-manager.ts
var import_lib_dynamodb5 = require("@aws-sdk/lib-dynamodb");
var LOCK_DURATION_MS = parseInt(process.env.ANALYTICS_LOCK_DURATION_MS || "60000", 10);
if (LOCK_DURATION_MS < 1e4 || LOCK_DURATION_MS > 3e5) {
  console.warn("[StateManager] ANALYTICS_LOCK_DURATION_MS outside recommended range (10s-300s):", {
    configuredMs: LOCK_DURATION_MS,
    recommendation: "Use 30000-60000 for most workloads"
  });
}
async function transitionAnalyticsState(ddb3, tableName, callId, timestamp, toState, reason, requestId) {
  try {
    const validSourceStates = getValidSourceStates(toState);
    if (validSourceStates.length === 0) {
      return {
        success: false,
        currentState: "failed" /* FAILED */,
        error: `No valid source states for transition to ${toState}`
      };
    }
    const now = Date.now();
    const transition = {
      from: "initializing" /* INITIALIZING */,
      // Placeholder - will be overwritten by actual state
      to: toState,
      timestamp: now,
      reason,
      processedBy: requestId
    };
    let updateExpression = `
      SET analyticsState = :newState,
          stateHistory = list_append(if_not_exists(stateHistory, :emptyList), :newTransition),
          stateLastUpdated = :now
    `;
    const expressionValues = {
      ":newState": toState,
      ":newTransition": [transition],
      ":emptyList": [],
      ":now": now
    };
    if (toState === "finalizing" /* FINALIZING */) {
      updateExpression += `, finalizationScheduledAt = :scheduleTime`;
      expressionValues[":scheduleTime"] = now + 3e4;
    }
    if (toState === "finalized" /* FINALIZED */) {
      updateExpression += `, finalizedAt = :finalizedTime, finalized = :true`;
      expressionValues[":finalizedTime"] = now;
      expressionValues[":true"] = true;
    }
    if (isTerminalState(toState)) {
      updateExpression += ` REMOVE lockedBy, lockedUntil`;
    }
    const conditionParts = [];
    const expressionNames = {};
    validSourceStates.forEach((state, idx) => {
      expressionValues[`:validState${idx}`] = state;
    });
    const stateConditions = validSourceStates.map((_, idx) => `analyticsState = :validState${idx}`);
    stateConditions.push("attribute_not_exists(analyticsState)");
    conditionParts.push(`(${stateConditions.join(" OR ")})`);
    if (requestId) {
      expressionValues[":requestId"] = requestId;
      expressionValues[":currentTime"] = now;
      conditionParts.push("(attribute_not_exists(lockedBy) OR lockedUntil < :currentTime OR lockedBy = :requestId)");
    }
    await ddb3.send(new import_lib_dynamodb5.UpdateCommand({
      TableName: tableName,
      Key: { callId, timestamp },
      UpdateExpression: updateExpression,
      ConditionExpression: conditionParts.join(" AND "),
      ExpressionAttributeValues: expressionValues,
      ExpressionAttributeNames: Object.keys(expressionNames).length > 0 ? expressionNames : void 0
    }));
    console.log("[StateManager] Transitioned analytics state:", {
      callId,
      to: toState,
      reason,
      validSourceStates
    });
    return {
      success: true,
      currentState: toState
    };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      try {
        const { Item: analytics } = await ddb3.send(new import_lib_dynamodb5.GetCommand({
          TableName: tableName,
          Key: { callId, timestamp },
          ProjectionExpression: "analyticsState, lockedBy, lockedUntil"
        }));
        const currentState = analytics?.analyticsState || "initializing" /* INITIALIZING */;
        const isLocked = analytics?.lockedBy && analytics?.lockedUntil > Date.now();
        return {
          success: false,
          currentState,
          isLocked,
          lockedBy: isLocked ? analytics?.lockedBy : void 0,
          error: isLocked ? "Record is locked by another process" : `Invalid transition: current state is ${currentState}`
        };
      } catch {
        return {
          success: false,
          currentState: "failed" /* FAILED */,
          error: "State changed during transition attempt"
        };
      }
    }
    throw err;
  }
}
function getValidSourceStates(toState) {
  switch (toState) {
    case "active" /* ACTIVE */:
      return ["initializing" /* INITIALIZING */];
    case "finalizing" /* FINALIZING */:
      return ["active" /* ACTIVE */, "initializing" /* INITIALIZING */];
    case "finalized" /* FINALIZED */:
      return ["finalizing" /* FINALIZING */];
    case "failed" /* FAILED */:
      return ["initializing" /* INITIALIZING */, "active" /* ACTIVE */, "finalizing" /* FINALIZING */];
    default:
      return [];
  }
}
async function acquireAnalyticsLock(ddb3, tableName, callId, timestamp, requestId, duration = LOCK_DURATION_MS) {
  try {
    const lockUntil = Date.now() + duration;
    await ddb3.send(new import_lib_dynamodb5.UpdateCommand({
      TableName: tableName,
      Key: { callId, timestamp },
      UpdateExpression: "SET lockedBy = :requestId, lockedUntil = :until",
      ConditionExpression: "attribute_not_exists(lockedBy) OR lockedUntil < :now OR lockedBy = :requestId",
      ExpressionAttributeValues: {
        ":requestId": requestId,
        ":until": lockUntil,
        ":now": Date.now()
      }
    }));
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}
async function releaseAnalyticsLock(ddb3, tableName, callId, timestamp, requestId) {
  try {
    await ddb3.send(new import_lib_dynamodb5.UpdateCommand({
      TableName: tableName,
      Key: { callId, timestamp },
      UpdateExpression: "REMOVE lockedBy, lockedUntil",
      ConditionExpression: "lockedBy = :requestId",
      ExpressionAttributeValues: {
        ":requestId": requestId
      }
    }));
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      console.warn("[StateManager] Lock already released or owned by another process");
    } else {
      throw err;
    }
  }
}
async function cleanupExpiredLock(ddb3, tableName, callId, timestamp) {
  try {
    const { Item: analytics } = await ddb3.send(new import_lib_dynamodb5.GetCommand({
      TableName: tableName,
      Key: { callId, timestamp }
    }));
    if (!analytics) {
      return false;
    }
    if (analytics.lockedBy && analytics.lockedUntil < Date.now()) {
      const lockAge = Date.now() - analytics.lockedUntil;
      console.warn("[StateManager] Cleaning up expired lock:", {
        callId,
        lockedBy: analytics.lockedBy,
        expiredMs: lockAge
      });
      await ddb3.send(new import_lib_dynamodb5.UpdateCommand({
        TableName: tableName,
        Key: { callId, timestamp },
        UpdateExpression: "REMOVE lockedBy, lockedUntil",
        ConditionExpression: "lockedUntil < :now",
        ExpressionAttributeValues: {
          ":now": Date.now()
        }
      }));
      return true;
    }
    return false;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return false;
    }
    console.error("[StateManager] Error cleaning expired lock:", err);
    return false;
  }
}

// src/services/shared/utils/transcript-buffer-manager.ts
var import_lib_dynamodb6 = require("@aws-sdk/lib-dynamodb");

// src/shared/utils/timestamp-utils.ts
function toUnixSeconds(value) {
  if (!value) {
    return Math.floor(Date.now() / 1e3);
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1e3);
  }
  if (typeof value === "number") {
    if (value > 1262304e6) {
      return Math.floor(value / 1e3);
    }
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      console.warn("[TimestampUtils] Invalid date string:", value);
      return Math.floor(Date.now() / 1e3);
    }
    return Math.floor(parsed.getTime() / 1e3);
  }
  console.warn("[TimestampUtils] Unknown timestamp type:", typeof value);
  return Math.floor(Date.now() / 1e3);
}
function nowPlusSeconds(seconds) {
  return Math.floor(Date.now() / 1e3) + seconds;
}

// src/services/shared/utils/transcript-buffer-manager.ts
var TranscriptBufferManager = class {
  constructor(ddb3, tableName) {
    this.ddb = ddb3;
    this.tableName = tableName;
  }
  /**
   * Initialize a new transcript buffer for a call
   */
  async initialize(callId) {
    const now = toUnixSeconds(Date.now());
    const ttl = nowPlusSeconds(3600);
    try {
      await this.ddb.send(new import_lib_dynamodb6.PutCommand({
        TableName: this.tableName,
        Item: {
          callId,
          segments: [],
          lastUpdate: now,
          segmentCount: 0,
          ttl,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        ConditionExpression: "attribute_not_exists(callId)"
        // Only create if doesn't exist
      }));
      console.log("[TranscriptBuffer] Initialized buffer for call:", callId);
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        console.log("[TranscriptBuffer] Buffer already exists for call:", callId);
      } else {
        throw err;
      }
    }
  }
  /**
   * Add a segment to the transcript buffer
   * CRITICAL FIX: Handles out-of-order segments by sorting after insertion
   */
  async addSegment(callId, segment) {
    const now = toUnixSeconds(Date.now());
    const ttl = nowPlusSeconds(3600);
    try {
      const existingBuffer = await this.get(callId);
      if (existingBuffer && existingBuffer.segments && existingBuffer.segments.length > 0) {
        const lastSegmentTime = existingBuffer.segments[existingBuffer.segments.length - 1].endTime;
        if (segment.startTime < lastSegmentTime) {
          console.warn("[TranscriptBuffer] Out-of-order segment detected, will sort after insertion:", {
            callId,
            newSegmentStart: segment.startTime,
            lastSegmentEnd: lastSegmentTime,
            timeDiff: lastSegmentTime - segment.startTime
          });
          const updatedSegments = [...existingBuffer.segments, segment].sort((a, b) => a.startTime - b.startTime);
          await this.ddb.send(new import_lib_dynamodb6.UpdateCommand({
            TableName: this.tableName,
            Key: { callId },
            UpdateExpression: `
              SET #seg = :sortedSegments,
                  segmentCount = :count,
                  lastUpdate = :now,
                  #ttl = :ttl,
                  hasOutOfOrderSegments = :true
            `,
            ExpressionAttributeNames: {
              "#seg": "segments",
              "#ttl": "ttl"
            },
            ExpressionAttributeValues: {
              ":sortedSegments": updatedSegments,
              ":count": updatedSegments.length,
              ":now": now,
              ":ttl": ttl,
              ":true": true
            }
          }));
          console.log("[TranscriptBuffer] Sorted segments after out-of-order insertion:", callId);
          return;
        }
      }
      await this.ddb.send(new import_lib_dynamodb6.UpdateCommand({
        TableName: this.tableName,
        Key: { callId },
        UpdateExpression: `
          SET #seg = list_append(if_not_exists(#seg, :empty), :segment),
              segmentCount = if_not_exists(segmentCount, :zero) + :one,
              lastUpdate = :now,
              #ttl = :ttl
        `,
        ExpressionAttributeNames: {
          "#seg": "segments",
          "#ttl": "ttl"
        },
        ExpressionAttributeValues: {
          ":segment": [segment],
          ":empty": [],
          ":zero": 0,
          ":one": 1,
          ":now": now,
          ":ttl": ttl
        }
      }));
      console.log("[TranscriptBuffer] Added segment to buffer:", callId);
    } catch (err) {
      console.error("[TranscriptBuffer] Error adding segment:", err);
      throw err;
    }
  }
  /**
   * Get the current transcript buffer for a call
   */
  async get(callId) {
    try {
      const result = await this.ddb.send(new import_lib_dynamodb6.GetCommand({
        TableName: this.tableName,
        Key: { callId }
      }));
      if (!result.Item) {
        return null;
      }
      return result.Item;
    } catch (err) {
      console.error("[TranscriptBuffer] Error getting buffer:", err);
      return null;
    }
  }
  /**
   * Get only the latest N segments (for efficient retrieval)
   */
  async getLatestSegments(callId, count = 10) {
    const buffer = await this.get(callId);
    if (!buffer || !buffer.segments) {
      return [];
    }
    return buffer.segments.slice(-count);
  }
  /**
   * Get segment count without retrieving all segments
   */
  async getSegmentCount(callId) {
    try {
      const result = await this.ddb.send(new import_lib_dynamodb6.GetCommand({
        TableName: this.tableName,
        Key: { callId },
        ProjectionExpression: "segmentCount"
      }));
      return result.Item?.segmentCount || 0;
    } catch (err) {
      console.error("[TranscriptBuffer] Error getting segment count:", err);
      return 0;
    }
  }
  /**
   * Update TTL to keep buffer alive for active calls
   */
  async extendTTL(callId, additionalSeconds = 3600) {
    const newTTL = nowPlusSeconds(additionalSeconds);
    try {
      await this.ddb.send(new import_lib_dynamodb6.UpdateCommand({
        TableName: this.tableName,
        Key: { callId },
        UpdateExpression: "SET ttl = :ttl",
        ExpressionAttributeValues: {
          ":ttl": newTTL
        }
      }));
    } catch (err) {
      console.error("[TranscriptBuffer] Error extending TTL:", err);
    }
  }
  /**
   * Delete buffer (called when call completes)
   */
  async delete(callId) {
    try {
      await this.ddb.send(new import_lib_dynamodb6.DeleteCommand({
        TableName: this.tableName,
        Key: { callId }
      }));
      console.log("[TranscriptBuffer] Deleted buffer for call:", callId);
    } catch (err) {
      console.error("[TranscriptBuffer] Error deleting buffer:", err);
    }
  }
  /**
   * Batch add segments (for bulk operations)
   */
  async addSegments(callId, segments) {
    if (segments.length === 0)
      return;
    for (const segment of segments) {
      await this.addSegment(callId, segment);
    }
  }
  /**
   * Cleanup old segments to prevent exceeding size limits
   * Keeps only last N segments in DynamoDB
   */
  async pruneSegments(callId, keepLast = 100) {
    const buffer = await this.get(callId);
    if (!buffer || buffer.segments.length <= keepLast) {
      return;
    }
    const prunedSegments = buffer.segments.slice(-keepLast);
    try {
      await this.ddb.send(new import_lib_dynamodb6.UpdateCommand({
        TableName: this.tableName,
        Key: { callId },
        UpdateExpression: "SET #seg = :segments, segmentCount = :count",
        ExpressionAttributeNames: {
          "#seg": "segments"
        },
        ExpressionAttributeValues: {
          ":segments": prunedSegments,
          ":count": prunedSegments.length
        }
      }));
      console.log("[TranscriptBuffer] Pruned segments for call:", {
        callId,
        originalCount: buffer.segments.length,
        newCount: prunedSegments.length
      });
    } catch (err) {
      console.error("[TranscriptBuffer] Error pruning segments:", err);
    }
  }
};
var bufferManagerInstance = null;
function getTranscriptBufferManager(ddb3, tableName) {
  if (!bufferManagerInstance) {
    bufferManagerInstance = new TranscriptBufferManager(ddb3, tableName);
  }
  return bufferManagerInstance;
}

// src/services/chime/finalize-analytics.ts
var CIRCUIT_BREAKER_THRESHOLD = 5;
var CIRCUIT_BREAKER_TIMEOUT = 6e4;
var CIRCUIT_BREAKER_TABLE = process.env.ANALYTICS_DEDUP_TABLE_NAME || process.env.ANALYTICS_DEDUP_TABLE;
if (!CIRCUIT_BREAKER_TABLE) {
  console.warn("[finalize-analytics] CIRCUIT_BREAKER_TABLE not configured - circuit breaker will be disabled");
}
var MAX_CONTINUATION_DEPTH = parseInt(process.env.MAX_CONTINUATION_DEPTH || "10", 10);
var LOCK_RETRY_ATTEMPTS = 3;
var LOCK_RETRY_DELAY_MS = 1e3;
async function getCircuitBreakerState(breakerKey) {
  const defaultState = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    lastUpdated: Date.now()
  };
  if (!CIRCUIT_BREAKER_TABLE) {
    console.warn("[CircuitBreaker] No table configured, using default state");
    return defaultState;
  }
  try {
    const result = await ddb2.send(new import_lib_dynamodb7.GetCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: {
        eventId: `__circuit_breaker__${breakerKey}`
        // Uses dedup table's partition key
      }
    }));
    if (result.Item) {
      return {
        failures: result.Item.failures || 0,
        lastFailure: result.Item.lastFailure || 0,
        isOpen: result.Item.isOpen || false,
        lastUpdated: result.Item.lastUpdated || Date.now()
      };
    }
  } catch (err) {
    console.warn("[CircuitBreaker] Failed to read state:", err.message);
  }
  return defaultState;
}
async function updateCircuitBreakerState(breakerKey, state) {
  if (!CIRCUIT_BREAKER_TABLE) {
    return;
  }
  try {
    await ddb2.send(new import_lib_dynamodb7.UpdateCommand({
      TableName: CIRCUIT_BREAKER_TABLE,
      Key: {
        eventId: `__circuit_breaker__${breakerKey}`
        // Uses dedup table's partition key
      },
      UpdateExpression: "SET failures = :failures, lastFailure = :lastFailure, isOpen = :isOpen, lastUpdated = :lastUpdated, #ttl = :ttl, #type = :type",
      ExpressionAttributeNames: {
        "#ttl": "ttl",
        "#type": "recordType"
        // Mark as circuit breaker for debugging
      },
      ExpressionAttributeValues: {
        ":failures": state.failures,
        ":lastFailure": state.lastFailure,
        ":isOpen": state.isOpen,
        ":lastUpdated": Date.now(),
        ":ttl": Math.floor(Date.now() / 1e3) + 24 * 60 * 60,
        // Expire after 24 hours
        ":type": "circuit_breaker"
      }
    }));
  } catch (err) {
    console.warn("[CircuitBreaker] Failed to update state:", err.message);
  }
}
async function sendToPerformanceDLQWithCircuitBreaker(failure, callId, agentId, clinicId) {
  const breakerKey = `dlq-${agentId}`;
  let breaker = await getCircuitBreakerState(breakerKey);
  if (breaker.isOpen) {
    const timeSinceLastFailure = Date.now() - breaker.lastFailure;
    if (timeSinceLastFailure < CIRCUIT_BREAKER_TIMEOUT) {
      console.error("[finalize-analytics] Circuit breaker OPEN - skipping DLQ send", {
        callId,
        agentId,
        failureCount: breaker.failures,
        cooldownRemaining: CIRCUIT_BREAKER_TIMEOUT - timeSinceLastFailure
      });
      console.error("PERFORMANCE_METRICS_LOSS", JSON.stringify({
        type: "METRICS_TRACKING_FAILURE",
        severity: "CRITICAL",
        reason: "CIRCUIT_BREAKER_OPEN",
        callId,
        agentId,
        clinicId,
        metrics: failure.metrics,
        error: failure.error,
        timestamp: failure.timestamp,
        canRecover: true,
        recoveryQuery: `fields @timestamp, callId, agentId, metrics | filter type = "METRICS_TRACKING_FAILURE" and callId = "${callId}"`
      }));
      return;
    }
    console.log("[finalize-analytics] Circuit breaker entering HALF-OPEN state:", { agentId });
    breaker.isOpen = false;
    await updateCircuitBreakerState(breakerKey, breaker);
  }
  try {
    await sendToPerformanceDLQ(failure);
    breaker.failures = 0;
    breaker.lastFailure = 0;
    breaker.isOpen = false;
    await updateCircuitBreakerState(breakerKey, breaker);
    console.log("[finalize-analytics] DLQ send successful, circuit breaker reset:", { agentId });
  } catch (dlqErr) {
    breaker.failures++;
    breaker.lastFailure = Date.now();
    console.error("[finalize-analytics] DLQ send failed", {
      callId,
      agentId,
      failureCount: breaker.failures,
      error: dlqErr.message
    });
    if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      breaker.isOpen = true;
      console.error("[finalize-analytics] Circuit breaker OPENED after repeated failures", {
        agentId,
        failures: breaker.failures,
        threshold: CIRCUIT_BREAKER_THRESHOLD
      });
    }
    await updateCircuitBreakerState(breakerKey, breaker);
    console.error("PERFORMANCE_METRICS_LOSS", JSON.stringify({
      type: "METRICS_TRACKING_FAILURE",
      severity: "CRITICAL",
      callId,
      agentId,
      clinicId,
      metrics: failure.metrics,
      error: failure.error,
      timestamp: failure.timestamp,
      canRecover: true,
      circuitBreakerState: {
        failures: breaker.failures,
        isOpen: breaker.isOpen
      },
      recoveryQuery: `fields @timestamp, callId, agentId, metrics | filter type = "METRICS_TRACKING_FAILURE" and callId = "${callId}"`
    }));
  }
}
var ddb2 = getDynamoDBClient();
var ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
var AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME;
if (!TRANSCRIPT_BUFFER_TABLE) {
  console.error(
    "[finalize-analytics] CRITICAL: TRANSCRIPT_BUFFER_TABLE_NAME not configured. Transcript cleanup will be SKIPPED. Update AnalyticsStack to pass this env var explicitly."
  );
}
var transcriptManager = TRANSCRIPT_BUFFER_TABLE ? getTranscriptBufferManager(ddb2, TRANSCRIPT_BUFFER_TABLE) : null;
if (!ANALYTICS_TABLE) {
  throw new Error("CALL_ANALYTICS_TABLE_NAME environment variable is required");
}
if (!AGENT_PERFORMANCE_TABLE) {
  console.warn("[finalize-analytics] AGENT_PERFORMANCE_TABLE_NAME not configured - enhanced agent metrics will not be tracked");
}
if (!TRANSCRIPT_BUFFER_TABLE) {
  console.warn("[finalize-analytics] TRANSCRIPT_BUFFER_TABLE_NAME not configured - transcript cleanup will be skipped");
}
var handler = async (event = {}) => {
  const continuationDepth = event.continuationDepth || 0;
  const continuationToken = event.continuationToken;
  console.log("[finalize-analytics] Starting finalization sweep", {
    continuationDepth,
    maxDepth: MAX_CONTINUATION_DEPTH,
    hasContinuationToken: !!continuationToken
  });
  if (continuationDepth >= MAX_CONTINUATION_DEPTH) {
    console.error("[finalize-analytics] CRITICAL: Max continuation depth reached - stopping to prevent infinite loop", {
      continuationDepth,
      maxDepth: MAX_CONTINUATION_DEPTH,
      message: "Large backlog detected. Consider increasing Lambda concurrency or reducing batch size."
    });
    return;
  }
  const now = Date.now();
  let finalizedCount = 0;
  let errorCount = 0;
  const BATCH_SIZE = 50;
  try {
    if (!ANALYTICS_TABLE) {
      console.error("[finalize-analytics] ANALYTICS_TABLE not configured");
      return;
    }
    const queryParams = {
      TableName: ANALYTICS_TABLE,
      IndexName: "analyticsState-finalizationScheduledAt-index",
      KeyConditionExpression: "analyticsState = :finalizingState AND finalizationScheduledAt <= :now",
      ExpressionAttributeValues: {
        ":finalizingState": "finalizing" /* FINALIZING */,
        ":now": now
      },
      Limit: BATCH_SIZE
    };
    if (continuationToken) {
      queryParams.ExclusiveStartKey = JSON.parse(
        Buffer.from(continuationToken, "base64").toString("utf-8")
      );
    }
    const scanResult = await ddb2.send(new import_lib_dynamodb7.QueryCommand(queryParams));
    const records = scanResult.Items || [];
    if (records.length === 0) {
      console.log("[finalize-analytics] No records pending finalization");
      return;
    }
    console.log(`[finalize-analytics] Found ${records.length} records to process`);
    const recordsToProcess = records.slice(0, BATCH_SIZE);
    for (const record of recordsToProcess) {
      try {
        await finalizeRecord(record.callId, record.timestamp);
        finalizedCount++;
      } catch (err) {
        console.error("[finalize-analytics] Error finalizing record:", {
          callId: record.callId,
          error: err.message,
          stack: err.stack
        });
        errorCount++;
      }
    }
    console.log("[finalize-analytics] Finalization sweep complete:", {
      finalized: finalizedCount,
      errors: errorCount,
      hasMore: !!scanResult.LastEvaluatedKey || records.length > BATCH_SIZE
    });
    if (scanResult.LastEvaluatedKey) {
      const nextToken = Buffer.from(
        JSON.stringify(scanResult.LastEvaluatedKey)
      ).toString("base64");
      const nextDepth = continuationDepth + 1;
      if (nextDepth >= MAX_CONTINUATION_DEPTH) {
        console.warn("[finalize-analytics] Approaching max depth, stopping continuation chain", {
          nextDepth,
          maxDepth: MAX_CONTINUATION_DEPTH,
          remainingRecords: "unknown - pagination key exists"
        });
        return;
      }
      console.log("[finalize-analytics] More records remain, scheduling continuation", {
        currentDepth: continuationDepth,
        nextDepth,
        maxDepth: MAX_CONTINUATION_DEPTH
      });
      const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
      const lambda = new LambdaClient({});
      try {
        await lambda.send(new InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
          InvocationType: "Event",
          // Async invocation
          Payload: JSON.stringify({
            continuationToken: nextToken,
            continuationDepth: nextDepth
            // CRITICAL FIX #3.1: Pass depth for tracking
          })
        }));
        console.log("[finalize-analytics] Continuation scheduled successfully", { nextDepth });
      } catch (invokeErr) {
        console.error("[finalize-analytics] Failed to invoke continuation:", invokeErr.message);
      }
    }
  } catch (err) {
    console.error("[finalize-analytics] Fatal error during finalization sweep:", {
      error: err.message,
      stack: err.stack
    });
  }
};
async function finalizeRecord(callId, timestamp) {
  const requestId = `finalize-${callId}-${Date.now()}`;
  try {
    await cleanupExpiredLock(ddb2, ANALYTICS_TABLE, callId, timestamp);
    let lockAcquired = false;
    let lockAttempt = 0;
    while (!lockAcquired && lockAttempt < LOCK_RETRY_ATTEMPTS) {
      lockAcquired = await acquireAnalyticsLock(ddb2, ANALYTICS_TABLE, callId, timestamp, requestId);
      if (!lockAcquired) {
        lockAttempt++;
        if (lockAttempt < LOCK_RETRY_ATTEMPTS) {
          const delay = LOCK_RETRY_DELAY_MS * Math.pow(2, lockAttempt - 1);
          console.log("[finalize-analytics] Lock acquisition failed, retrying...", {
            callId,
            attempt: lockAttempt,
            maxAttempts: LOCK_RETRY_ATTEMPTS,
            delayMs: delay
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    if (!lockAcquired) {
      console.warn("[finalize-analytics] Failed to acquire lock after retries - will retry on next sweep:", {
        callId,
        attempts: LOCK_RETRY_ATTEMPTS
      });
      return;
    }
    try {
      const now = Math.floor(Date.now() / 1e3);
      const ninetyDaysAgo = now - 90 * 24 * 60 * 60;
      if (timestamp > now + 60) {
        console.error("[finalize-analytics] Future timestamp detected, skipping:", {
          callId,
          timestamp,
          timestampDate: new Date(timestamp * 1e3).toISOString(),
          now,
          nowDate: new Date(now * 1e3).toISOString()
        });
        return;
      }
      if (timestamp < ninetyDaysAgo) {
        console.warn("[finalize-analytics] Very old timestamp (>90 days):", {
          callId,
          timestamp,
          timestampDate: new Date(timestamp * 1e3).toISOString(),
          ageInDays: Math.floor((now - timestamp) / (24 * 60 * 60))
        });
      }
      const { Item: analytics } = await ddb2.send(new import_lib_dynamodb7.GetCommand({
        TableName: ANALYTICS_TABLE,
        Key: { callId, timestamp }
      }));
      if (!analytics) {
        console.warn(`[finalize-analytics] Record not found: ${callId}`);
        return;
      }
      const currentState = analytics.analyticsState || "finalizing" /* FINALIZING */;
      if (currentState !== "finalizing" /* FINALIZING */) {
        console.warn(`[finalize-analytics] Record not in FINALIZING state: ${callId}`, {
          currentState
        });
        return;
      }
      if (!analytics.callEndTime && !analytics.callEndTimestamp) {
        console.error("[finalize-analytics] Attempting to finalize active call:", {
          callId,
          timestamp,
          callStatus: analytics.callStatus,
          callStartTime: analytics.callStartTime
        });
        return;
      }
      let coachingSummary;
      try {
        coachingSummary = await generateCallCoachingSummary(analytics);
      } catch (err) {
        console.error("[finalize-analytics] Error generating coaching summary:", {
          error: err.message,
          callId
        });
        coachingSummary = { score: 50, strengths: [], improvements: [] };
      }
      const stateTransition = await transitionAnalyticsState(
        ddb2,
        ANALYTICS_TABLE,
        callId,
        timestamp,
        "finalized" /* FINALIZED */,
        "Finalization complete",
        requestId
      );
      if (!stateTransition.success) {
        console.warn(`[finalize-analytics] Failed to transition to FINALIZED: ${stateTransition.error}`, {
          callId
        });
        if (stateTransition.currentState === "finalized" /* FINALIZED */) {
          console.log(`[finalize-analytics] Already finalized: ${callId}`);
          return;
        }
        throw new Error(`Failed to finalize: ${stateTransition.error}`);
      }
      let metricsAlreadyTracked = false;
      if (analytics.agentId && AGENT_PERFORMANCE_TABLE) {
        try {
          await ddb2.send(new import_lib_dynamodb7.UpdateCommand({
            TableName: ANALYTICS_TABLE,
            Key: { callId, timestamp },
            UpdateExpression: "SET agentMetricsTracking = :tracking, agentMetricsTrackingStartedAt = :now",
            ConditionExpression: "attribute_not_exists(agentMetricsTracking) AND attribute_not_exists(agentMetricsTracked)",
            ExpressionAttributeValues: {
              ":tracking": true,
              ":now": Date.now()
            }
          }));
          console.log("[finalize-analytics] Acquired metrics tracking lock for:", callId);
        } catch (err) {
          if (err.name === "ConditionalCheckFailedException") {
            console.log("[finalize-analytics] Agent metrics already being tracked or tracked, skipping:", callId);
            metricsAlreadyTracked = true;
          } else {
            console.warn("[finalize-analytics] Error acquiring metrics tracking lock:", err.message);
          }
        }
      }
      let agentExists = false;
      if (analytics.agentId && AGENT_PERFORMANCE_TABLE && !metricsAlreadyTracked) {
        try {
          const AGENT_PRESENCE_TABLE2 = process.env.AGENT_PRESENCE_TABLE_NAME;
          if (AGENT_PRESENCE_TABLE2) {
            const presenceCheck = await ddb2.send(new import_lib_dynamodb7.GetCommand({
              TableName: AGENT_PRESENCE_TABLE2,
              Key: { agentId: analytics.agentId }
            }));
            agentExists = !!presenceCheck.Item;
          } else {
            agentExists = true;
          }
          if (!agentExists) {
            console.error("[finalize-analytics] Agent not found in presence table:", {
              callId,
              agentId: analytics.agentId,
              clinicId: analytics.clinicId
            });
          }
        } catch (validateErr) {
          console.warn("[finalize-analytics] Could not validate agent existence:", validateErr.message);
          agentExists = true;
        }
      }
      if (analytics.agentId && AGENT_PERFORMANCE_TABLE && !metricsAlreadyTracked && agentExists) {
        const MAX_RETRIES = 3;
        let lastError = null;
        let metricsTracked = false;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            await trackEnhancedCallMetrics(ddb2, AGENT_PERFORMANCE_TABLE, {
              agentId: analytics.agentId,
              clinicId: analytics.clinicId,
              callId,
              direction: analytics.direction || "inbound",
              duration: analytics.totalDuration || 0,
              talkTime: analytics.totalDuration || 0,
              holdTime: analytics.holdTime || 0,
              sentiment: analytics.overallSentiment,
              sentimentScore: analytics.averageSentiment,
              transferred: analytics.detectedIssues?.includes("call-transferred"),
              escalated: analytics.detectedIssues?.includes("escalation-request"),
              issues: analytics.detectedIssues || [],
              speakerMetrics: analytics.speakerMetrics,
              timestamp: analytics.callEndTimestamp || Date.now()
            });
            metricsTracked = true;
            console.log("[finalize-analytics] Successfully tracked agent metrics for", callId);
            break;
          } catch (err) {
            lastError = err;
            console.error("[finalize-analytics] Error tracking enhanced metrics:", {
              error: err.message,
              callId,
              agentId: analytics.agentId,
              attempt: attempt + 1
            });
            if (attempt === MAX_RETRIES - 1) {
              const failure = {
                callId,
                agentId: analytics.agentId,
                clinicId: analytics.clinicId,
                error: {
                  message: err.message,
                  stack: err.stack,
                  code: err.code || err.name
                },
                metrics: {
                  direction: analytics.direction || "inbound",
                  duration: analytics.totalDuration || 0,
                  sentiment: analytics.overallSentiment,
                  sentimentScore: analytics.averageSentiment
                },
                timestamp: (/* @__PURE__ */ new Date()).toISOString(),
                attemptCount: MAX_RETRIES
              };
              await sendToPerformanceDLQWithCircuitBreaker(failure, callId, analytics.agentId, analytics.clinicId);
            } else {
              await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
            }
          }
        }
        if (metricsTracked) {
          try {
            await ddb2.send(new import_lib_dynamodb7.UpdateCommand({
              TableName: ANALYTICS_TABLE,
              Key: { callId, timestamp },
              UpdateExpression: "SET coachingSummary = :coaching, agentMetricsTracked = :true, agentMetricsTrackedAt = :now REMOVE agentMetricsTracking",
              ExpressionAttributeValues: {
                ":coaching": coachingSummary,
                ":true": true,
                ":now": Date.now()
              }
            }));
          } catch (updateErr) {
            console.error("[finalize-analytics] Error updating coaching summary:", {
              error: updateErr.message,
              callId
            });
            try {
              await ddb2.send(new import_lib_dynamodb7.UpdateCommand({
                TableName: ANALYTICS_TABLE,
                Key: { callId, timestamp },
                UpdateExpression: "REMOVE agentMetricsTracking"
              }));
            } catch (releaseErr) {
              console.warn("[finalize-analytics] Could not release tracking lock:", releaseErr.message);
            }
          }
        } else {
          try {
            await ddb2.send(new import_lib_dynamodb7.UpdateCommand({
              TableName: ANALYTICS_TABLE,
              Key: { callId, timestamp },
              UpdateExpression: "REMOVE agentMetricsTracking"
            }));
          } catch (releaseErr) {
            console.warn("[finalize-analytics] Could not release tracking lock after failure:", releaseErr.message);
          }
        }
      } else {
        try {
          await ddb2.send(new import_lib_dynamodb7.UpdateCommand({
            TableName: ANALYTICS_TABLE,
            Key: { callId, timestamp },
            UpdateExpression: "SET coachingSummary = :coaching",
            ExpressionAttributeValues: {
              ":coaching": coachingSummary
            }
          }));
        } catch (updateErr) {
          console.error("[finalize-analytics] Error updating coaching summary:", {
            error: updateErr.message,
            callId
          });
          throw updateErr;
        }
      }
      if (transcriptManager) {
        try {
          await transcriptManager.delete(callId);
          console.log(`[finalize-analytics] Cleaned up transcript buffer for ${callId}`);
        } catch (cleanupErr) {
          console.error("[finalize-analytics] Error cleaning up transcript buffer:", {
            callId,
            error: cleanupErr.message
          });
        }
      } else {
        console.log(`[finalize-analytics] Skipping transcript cleanup - manager not configured`);
      }
      console.log(`[finalize-analytics] Finalized analytics for call ${callId}`, {
        coachingScore: coachingSummary?.score,
        sentiment: analytics.overallSentiment
      });
    } finally {
      await releaseAnalyticsLock(ddb2, ANALYTICS_TABLE, callId, timestamp, requestId);
    }
  } catch (err) {
    console.error(`[finalize-analytics] Error finalizing record ${callId}:`, {
      error: err.message,
      stack: err.stack
    });
    try {
      await transitionAnalyticsState(
        ddb2,
        ANALYTICS_TABLE,
        callId,
        timestamp,
        "failed" /* FAILED */,
        `Finalization failed: ${err.message}`,
        requestId
      );
    } catch (stateErr) {
      console.error("[finalize-analytics] Failed to transition to FAILED state:", stateErr);
    }
    throw err;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

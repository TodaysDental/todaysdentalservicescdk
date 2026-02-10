"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// src/services/shared/utils/metrics-validator.ts
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
var VALIDATION_RULES, VALID_SENTIMENTS, VALID_DIRECTIONS;
var init_metrics_validator = __esm({
  "src/services/shared/utils/metrics-validator.ts"() {
    "use strict";
    VALIDATION_RULES = {
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
    VALID_SENTIMENTS = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"];
    VALID_DIRECTIONS = ["inbound", "outbound"];
  }
});

// src/services/shared/utils/enhanced-agent-metrics.ts
var enhanced_agent_metrics_exports = {};
__export(enhanced_agent_metrics_exports, {
  calculateFCR: () => calculateFCR,
  getAgentPerformanceSummary: () => getAgentPerformanceSummary,
  trackEnhancedCallMetrics: () => trackEnhancedCallMetrics
});
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
async function calculateFCR(ddb2, callQueueTable, callId, customerPhone, clinicId) {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1e3;
  const result = await ddb2.send(new import_lib_dynamodb3.QueryCommand({
    TableName: callQueueTable,
    IndexName: "clinicId-timestamp-index",
    // Assuming this exists
    KeyConditionExpression: "clinicId = :clinicId AND queuePosition > :timestamp",
    FilterExpression: "customerPhone = :phone AND callId <> :currentCallId",
    ExpressionAttributeValues: {
      ":clinicId": clinicId,
      ":timestamp": oneDayAgo,
      ":phone": customerPhone,
      ":currentCallId": callId
    }
  }));
  return (result.Items?.length || 0) === 0;
}
async function getAgentPerformanceSummary(ddb2, tableName, agentId, startDate, endDate) {
  const result = await ddb2.send(new import_lib_dynamodb3.QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "agentId = :agentId AND periodDate BETWEEN :start AND :end",
    ExpressionAttributeValues: {
      ":agentId": agentId,
      ":start": startDate,
      ":end": endDate
    }
  }));
  const metrics = result.Items || [];
  if (metrics.length === 0) {
    return null;
  }
  const totals = metrics.reduce((acc, day) => ({
    totalCalls: acc.totalCalls + (day.totalCalls || 0),
    answeredCalls: acc.answeredCalls + (day.answeredCalls || 0),
    totalTalkTime: acc.totalTalkTime + (day.totalTalkTime || 0),
    totalHoldTime: acc.totalHoldTime + (day.totalHoldTime || 0),
    sentimentScores: {
      positive: acc.sentimentScores.positive + (day.sentimentScores?.positive || 0),
      neutral: acc.sentimentScores.neutral + (day.sentimentScores?.neutral || 0),
      negative: acc.sentimentScores.negative + (day.sentimentScores?.negative || 0),
      mixed: acc.sentimentScores.mixed + (day.sentimentScores?.mixed || 0)
    },
    transferredCalls: acc.transferredCalls + (day.transferredCalls || 0),
    escalatedCalls: acc.escalatedCalls + (day.escalatedCalls || 0)
  }), {
    totalCalls: 0,
    answeredCalls: 0,
    totalTalkTime: 0,
    totalHoldTime: 0,
    sentimentScores: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
    transferredCalls: 0,
    escalatedCalls: 0
  });
  const averageHandleTime = totals.answeredCalls > 0 ? Math.round((totals.totalTalkTime + totals.totalHoldTime) / totals.answeredCalls) : 0;
  const totalSentimentCalls = Object.values(totals.sentimentScores).reduce((sum, count) => sum + count, 0);
  const csatProxy = totalSentimentCalls > 0 ? Math.round((totals.sentimentScores.positive + totals.sentimentScores.neutral * 0.5) / totalSentimentCalls * 100) : 50;
  const transferRate = totals.answeredCalls > 0 ? Math.round(totals.transferredCalls / totals.answeredCalls * 100) : 0;
  return {
    agentId,
    dateRange: { start: startDate, end: endDate },
    totalCalls: totals.totalCalls,
    answeredCalls: totals.answeredCalls,
    averageHandleTime,
    csatProxy,
    transferRate,
    sentimentScores: totals.sentimentScores,
    transferredCalls: totals.transferredCalls,
    escalatedCalls: totals.escalatedCalls
  };
}
var import_lib_dynamodb3;
var init_enhanced_agent_metrics = __esm({
  "src/services/shared/utils/enhanced-agent-metrics.ts"() {
    "use strict";
    import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
    init_metrics_validator();
  }
});

// src/services/chime/reconcile-analytics.ts
var reconcile_analytics_exports = {};
__export(reconcile_analytics_exports, {
  handler: () => handler,
  reconcileSpecificCall: () => reconcileSpecificCall
});
module.exports = __toCommonJS(reconcile_analytics_exports);
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");

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

// src/services/chime/reconcile-analytics.ts
var ddb = getDynamoDBClient();
var CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME;
var ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
var DEDUP_TABLE_ENV = process.env.ANALYTICS_DEDUP_TABLE_NAME;
var AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME;
var TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME;
if (!CALL_QUEUE_TABLE || !ANALYTICS_TABLE) {
  throw new Error("Required environment variables not set: CALL_QUEUE_TABLE_NAME, CALL_ANALYTICS_TABLE_NAME");
}
var DEDUP_TABLE = DEDUP_TABLE_ENV || getDedupTableName(ANALYTICS_TABLE);
if (!AGENT_PERFORMANCE_TABLE) {
  console.warn("[Reconciliation] AGENT_PERFORMANCE_TABLE_NAME not configured - agent metrics will NOT be tracked for reconciled calls");
}
var handler = async () => {
  console.log("[Reconciliation] Starting analytics reconciliation job");
  const result = {
    scanned: 0,
    missing: 0,
    fixed: 0,
    errors: 0,
    orphanedCalls: []
  };
  const oneDayAgo = Math.floor(Date.now() / 1e3) - 24 * 60 * 60;
  let lastEvaluatedKey = void 0;
  let pageCount = 0;
  const MAX_PAGES = 100;
  do {
    try {
      const scanResult = await ddb.send(new import_lib_dynamodb4.ScanCommand({
        TableName: CALL_QUEUE_TABLE,
        FilterExpression: "(#status = :completed OR #status = :abandoned) AND endedAt > :oneDayAgo",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":completed": "completed",
          ":abandoned": "abandoned",
          ":oneDayAgo": oneDayAgo
        },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 100
      }));
      const calls = scanResult.Items || [];
      result.scanned += calls.length;
      for (const call of calls) {
        if (!call.callId)
          continue;
        const hasMissingAnalytics = await checkAndFixOrphanedCall(call, result);
        if (hasMissingAnalytics) {
          result.orphanedCalls.push(call.callId);
        }
      }
      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        console.warn("[Reconciliation] Hit max pages limit, stopping scan");
        break;
      }
    } catch (err) {
      console.error("[Reconciliation] Error during scan:", {
        error: err.message,
        page: pageCount
      });
      result.errors++;
      break;
    }
  } while (lastEvaluatedKey);
  console.log("[Reconciliation] Job complete:", {
    ...result,
    orphanedCallsCount: result.orphanedCalls.length
  });
  return result;
};
async function checkAndFixOrphanedCall(call, result) {
  try {
    let timestamp = call.queueEntryTime || Math.floor(Date.now() / 1e3);
    const YEAR_2015_SECONDS = 1420070400;
    const YEAR_2100_SECONDS = 4102444800;
    if (timestamp > YEAR_2100_SECONDS) {
      timestamp = Math.floor(timestamp / 1e3);
      console.log("[Reconciliation] Converted timestamp from ms to seconds:", {
        callId: call.callId,
        original: call.queueEntryTime,
        normalized: timestamp
      });
    } else if (timestamp < YEAR_2015_SECONDS && timestamp > 0) {
      console.warn("[Reconciliation] Old timestamp detected (pre-2015), keeping original:", {
        callId: call.callId,
        originalTimestamp: timestamp,
        date: new Date(timestamp * 1e3).toISOString(),
        note: "May be migrated data. Review if this causes issues."
      });
    } else if (timestamp <= 0) {
      console.error("[Reconciliation] Invalid timestamp (<=0), using current time:", {
        callId: call.callId,
        originalTimestamp: timestamp
      });
      timestamp = Math.floor(Date.now() / 1e3);
    }
    const analyticsResult = await ddb.send(new import_lib_dynamodb4.GetCommand({
      TableName: ANALYTICS_TABLE,
      Key: {
        callId: call.callId,
        timestamp
      }
    }));
    if (analyticsResult.Item) {
      return false;
    }
    console.log("[Reconciliation] Found orphaned call:", {
      callId: call.callId,
      status: call.status,
      endedAt: call.endedAtIso
    });
    result.missing++;
    const stateTransition = call.status === "completed" ? "completed" : "abandoned";
    const dedupKeys = [
      `${call.callId}#post-call-${stateTransition}`,
      `${call.callId}#post-call`
    ];
    for (const dedupKey of dedupKeys) {
      try {
        await ddb.send(new import_lib_dynamodb4.DeleteCommand({
          TableName: DEDUP_TABLE,
          Key: { eventId: dedupKey }
        }));
        console.log("[Reconciliation] Deleted dedup record:", dedupKey);
      } catch (deleteErr) {
        if (deleteErr.name !== "ResourceNotFoundException") {
          console.warn("[Reconciliation] Error deleting dedup record:", {
            dedupKey,
            error: deleteErr.message
          });
        }
      }
    }
    try {
      const now = Date.now();
      const queueEntryTime = parseTimestamp(call.queueEntryTime || call.queueEntryTimeIso);
      const connectedAt = parseTimestamp(call.connectedAt);
      const completedAt = parseTimestamp(call.completedAt || call.endedAtIso);
      const totalDuration = queueEntryTime && completedAt ? Math.floor((completedAt - queueEntryTime) / 1e3) : 0;
      const queueDuration = queueEntryTime && connectedAt ? Math.floor((connectedAt - queueEntryTime) / 1e3) : 0;
      const callDuration = connectedAt && completedAt ? Math.floor((completedAt - connectedAt) / 1e3) : 0;
      const holdDuration = call.holdDuration || 0;
      const talkDuration = Math.max(0, callDuration - holdDuration);
      const analyticsRecord = {
        callId: call.callId,
        timestamp,
        timestampIso: call.queueEntryTimeIso || new Date(timestamp * 1e3).toISOString(),
        clinicId: call.clinicId,
        agentId: call.assignedAgentId,
        status: call.status,
        callStatus: call.status,
        // Durations
        totalDuration,
        queueDuration,
        ringDuration: call.ringDuration || 0,
        holdDuration,
        talkDuration,
        // Characteristics
        wasTransferred: !!call.transferredToAgentId || !!call.transferToAgentId,
        wasAbandoned: call.status === "abandoned",
        wasCallback: !!call.isCallback,
        wasVip: !!call.isVip,
        // Metadata
        rejectionCount: call.rejectionCount || 0,
        transferCount: call.transferCount || 0,
        holdCount: call.holdCount || 0,
        // Source
        phoneNumber: call.phoneNumber,
        direction: call.direction || "inbound",
        // Processing metadata
        processedAt: (/* @__PURE__ */ new Date()).toISOString(),
        sourceEvent: "RECONCILIATION_JOB",
        reconciledAt: (/* @__PURE__ */ new Date()).toISOString(),
        ttl: Math.floor(now / 1e3) + 90 * 24 * 60 * 60,
        // 90 days
        // Analytics state
        analyticsState: "FINALIZED",
        finalized: true,
        _note: "Created by reconciliation job - original stream processing failed"
      };
      await ddb.send(new import_lib_dynamodb4.PutCommand({
        TableName: ANALYTICS_TABLE,
        Item: analyticsRecord,
        ConditionExpression: "attribute_not_exists(callId)"
      }));
      console.log("[Reconciliation] Created analytics record for call:", call.callId);
      result.fixed++;
      if (AGENT_PERFORMANCE_TABLE && call.assignedAgentId) {
        try {
          const { trackEnhancedCallMetrics: trackEnhancedCallMetrics2 } = await Promise.resolve().then(() => (init_enhanced_agent_metrics(), enhanced_agent_metrics_exports));
          await trackEnhancedCallMetrics2(ddb, AGENT_PERFORMANCE_TABLE, {
            agentId: call.assignedAgentId,
            clinicId: call.clinicId,
            callId: call.callId,
            direction: call.direction || "inbound",
            duration: totalDuration,
            talkTime: talkDuration,
            holdTime: holdDuration,
            sentiment: "NEUTRAL",
            // Default for reconciled calls without live analytics
            sentimentScore: 50,
            transferred: !!call.transferredToAgentId || !!call.transferToAgentId,
            escalated: false,
            issues: [],
            speakerMetrics: void 0,
            timestamp: completedAt || Date.now()
          });
          console.log("[Reconciliation] Tracked agent metrics for reconciled call:", {
            callId: call.callId,
            agentId: call.assignedAgentId
          });
        } catch (metricsErr) {
          console.error("[Reconciliation] Failed to track agent metrics:", {
            callId: call.callId,
            agentId: call.assignedAgentId,
            error: metricsErr.message
          });
        }
      }
      try {
        await ddb.send(new import_lib_dynamodb4.UpdateCommand({
          TableName: CALL_QUEUE_TABLE,
          Key: {
            clinicId: call.clinicId,
            callId: call.callId
          },
          UpdateExpression: "SET reconciledAt = :now, reconciledBy = :source",
          ExpressionAttributeValues: {
            ":now": (/* @__PURE__ */ new Date()).toISOString(),
            ":source": "reconciliation-job"
          },
          // CRITICAL FIX #4.2: Add condition to verify item exists
          ConditionExpression: "attribute_exists(callId)"
        }));
        console.log("[Reconciliation] Marked call as reconciled:", call.callId);
      } catch (updateErr) {
        if (updateErr.name === "ConditionalCheckFailedException") {
          console.warn("[Reconciliation] Call not found with clinicId+callId, trying callId-only:", {
            callId: call.callId
          });
        } else if (updateErr.name === "ValidationException" && updateErr.message.includes("key")) {
          console.warn("[Reconciliation] clinicId+callId key failed, trying callId-only key:", {
            callId: call.callId,
            error: updateErr.message
          });
        } else {
          console.warn("[Reconciliation] Failed to mark call as reconciled:", {
            callId: call.callId,
            error: updateErr.message
          });
          return true;
        }
        try {
          await ddb.send(new import_lib_dynamodb4.UpdateCommand({
            TableName: CALL_QUEUE_TABLE,
            Key: {
              callId: call.callId
            },
            UpdateExpression: "SET reconciledAt = :now, reconciledBy = :source",
            ExpressionAttributeValues: {
              ":now": (/* @__PURE__ */ new Date()).toISOString(),
              ":source": "reconciliation-job"
            }
          }));
          console.log("[Reconciliation] Marked call as reconciled (callId-only schema):", call.callId);
        } catch (fallbackErr) {
          console.error("[Reconciliation] CRITICAL: Failed to mark call as reconciled with both schemas:", {
            callId: call.callId,
            primaryError: updateErr.message,
            fallbackError: fallbackErr.message,
            impact: "Call may be reconciled again on next run"
          });
        }
      }
    } catch (createErr) {
      if (createErr.name === "ConditionalCheckFailedException") {
        console.log("[Reconciliation] Analytics already exist (race condition):", call.callId);
      } else {
        console.error("[Reconciliation] Failed to create analytics record:", {
          callId: call.callId,
          error: createErr.message
        });
        result.errors++;
      }
    }
    return true;
  } catch (err) {
    console.error("[Reconciliation] Error checking call:", {
      callId: call.callId,
      error: err.message
    });
    result.errors++;
    return false;
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
async function reconcileSpecificCall(callId) {
  console.log("[Reconciliation] Manually reconciling call:", callId);
  const dedupKeys = [
    `${callId}#post-call-completed`,
    `${callId}#post-call-abandoned`,
    `${callId}#post-call`,
    `${callId}#live-init`,
    `${callId}#live-update`
  ];
  for (const dedupKey of dedupKeys) {
    try {
      await ddb.send(new import_lib_dynamodb4.DeleteCommand({
        TableName: DEDUP_TABLE,
        Key: { eventId: dedupKey }
      }));
      console.log("[Reconciliation] Deleted dedup record:", dedupKey);
    } catch (err) {
      if (err.name !== "ResourceNotFoundException") {
        console.warn("[Reconciliation] Error deleting dedup:", err.message);
      }
    }
  }
  console.log("[Reconciliation] Dedup records cleared for call:", callId);
  return true;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler,
  reconcileSpecificCall
});

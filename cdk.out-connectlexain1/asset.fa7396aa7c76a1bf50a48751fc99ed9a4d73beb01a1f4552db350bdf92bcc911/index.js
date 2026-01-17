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

// src/services/chime/get-agent-performance.ts
var get_agent_performance_exports = {};
__export(get_agent_performance_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(get_agent_performance_exports);

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

// src/services/chime/get-agent-performance.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var ddb = getDynamoDBClient();
var AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  try {
    console.log("[GetAgentPerformance] Request:", JSON.stringify(event, null, 2));
    const agentId = event.queryStringParameters?.agentId;
    const clinicId = event.queryStringParameters?.clinicId;
    const startDate = event.queryStringParameters?.startDate;
    const endDate = event.queryStringParameters?.endDate;
    const includeCallDetails = event.queryStringParameters?.includeCallDetails === "true";
    if (!agentId && !clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Either agentId or clinicId is required"
        })
      };
    }
    let performanceRecords = [];
    if (agentId) {
      performanceRecords = await getAgentPerformance(agentId, startDate, endDate);
    } else if (clinicId) {
      performanceRecords = await getClinicAgentPerformance(clinicId, startDate, endDate);
    }
    const aggregatedData = aggregatePerformanceData(performanceRecords);
    let callDetails = void 0;
    if (includeCallDetails && agentId) {
      callDetails = await getAgentCallDetails(agentId, startDate, endDate);
    }
    const response = {
      success: true,
      data: {
        summary: aggregatedData,
        dailyBreakdown: performanceRecords,
        callDetails
      }
    };
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("[GetAgentPerformance] Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to retrieve agent performance",
        message: error.message
      })
    };
  }
};
async function getAgentPerformance(agentId, startDate, endDate) {
  const params = {
    TableName: AGENT_PERFORMANCE_TABLE_NAME,
    KeyConditionExpression: "agentId = :agentId",
    ExpressionAttributeValues: {
      ":agentId": agentId
    }
  };
  if (startDate && endDate) {
    params.KeyConditionExpression += " AND periodDate BETWEEN :startDate AND :endDate";
    params.ExpressionAttributeValues[":startDate"] = startDate;
    params.ExpressionAttributeValues[":endDate"] = endDate;
  } else if (startDate) {
    params.KeyConditionExpression += " AND periodDate >= :startDate";
    params.ExpressionAttributeValues[":startDate"] = startDate;
  } else if (endDate) {
    params.KeyConditionExpression += " AND periodDate <= :endDate";
    params.ExpressionAttributeValues[":endDate"] = endDate;
  }
  const result = await ddb.send(new import_lib_dynamodb2.QueryCommand(params));
  return result.Items || [];
}
async function getClinicAgentPerformance(clinicId, startDate, endDate) {
  const params = {
    TableName: AGENT_PERFORMANCE_TABLE_NAME,
    IndexName: "clinicId-periodDate-index",
    KeyConditionExpression: "clinicId = :clinicId",
    ExpressionAttributeValues: {
      ":clinicId": clinicId
    }
  };
  if (startDate && endDate) {
    params.KeyConditionExpression += " AND periodDate BETWEEN :startDate AND :endDate";
    params.ExpressionAttributeValues[":startDate"] = startDate;
    params.ExpressionAttributeValues[":endDate"] = endDate;
  } else if (startDate) {
    params.KeyConditionExpression += " AND periodDate >= :startDate";
    params.ExpressionAttributeValues[":startDate"] = startDate;
  } else if (endDate) {
    params.KeyConditionExpression += " AND periodDate <= :endDate";
    params.ExpressionAttributeValues[":endDate"] = endDate;
  }
  const result = await ddb.send(new import_lib_dynamodb2.QueryCommand(params));
  return result.Items || [];
}
async function getAgentCallDetails(agentId, startDate, endDate) {
  console.log("[GetAgentPerformance] Fetching call details for agent:", agentId);
  const ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
  if (!ANALYTICS_TABLE) {
    console.error("[GetAgentPerformance] CALL_ANALYTICS_TABLE_NAME not configured");
    return [];
  }
  try {
    const startTimestamp = startDate ? Math.floor(new Date(startDate).getTime() / 1e3) : Math.floor(Date.now() / 1e3) - 7 * 24 * 60 * 60;
    const endTimestamp = endDate ? Math.floor(new Date(endDate).getTime() / 1e3) : Math.floor(Date.now() / 1e3);
    const params = {
      TableName: ANALYTICS_TABLE,
      IndexName: "agentId-timestamp-index",
      KeyConditionExpression: "agentId = :agentId AND #ts BETWEEN :start AND :end",
      ExpressionAttributeNames: { "#ts": "timestamp" },
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":start": startTimestamp,
        ":end": endTimestamp
      },
      Limit: 100
      // Limit to 100 most recent calls for performance
    };
    const result = await ddb.send(new import_lib_dynamodb2.QueryCommand(params));
    if (!result.Items || result.Items.length === 0) {
      return [];
    }
    const callDetails = result.Items.map((item) => ({
      callId: item.callId,
      timestamp: item.timestamp,
      callStartTime: item.callStartTime,
      callEndTime: item.callEndTime,
      duration: item.totalDuration,
      direction: item.direction,
      customerPhone: item.customerPhone,
      sentiment: item.overallSentiment,
      category: item.callCategory,
      issues: item.detectedIssues || [],
      talkPercentage: item.speakerMetrics?.agentTalkPercentage,
      holdTime: item.holdTime,
      qualityScore: item.audioQuality?.qualityScore,
      callStatus: item.callStatus || (item.callEndTime ? "completed" : "active")
    }));
    console.log(`[GetAgentPerformance] Retrieved ${callDetails.length} call details for agent ${agentId}`);
    return callDetails;
  } catch (error) {
    console.error("[GetAgentPerformance] Error fetching call details:", {
      agentId,
      error: error.message
    });
    return [];
  }
}
function aggregatePerformanceData(records) {
  if (records.length === 0) {
    return {
      totalCalls: 0,
      inboundCalls: 0,
      outboundCalls: 0,
      averageHandleTime: 0,
      averageSentiment: 0,
      performanceScore: 0
    };
  }
  const totals = records.reduce((acc, record) => {
    return {
      totalCalls: acc.totalCalls + record.totalCalls,
      inboundCalls: acc.inboundCalls + record.inboundCalls,
      outboundCalls: acc.outboundCalls + record.outboundCalls,
      missedCalls: acc.missedCalls + record.missedCalls,
      rejectedCalls: acc.rejectedCalls + record.rejectedCalls,
      totalTalkTime: acc.totalTalkTime + record.totalTalkTime,
      totalHandleTime: acc.totalHandleTime + record.totalHandleTime,
      totalHoldTime: acc.totalHoldTime + record.totalHoldTime,
      callsTransferred: acc.callsTransferred + record.callsTransferred,
      callsCompleted: acc.callsCompleted + record.callsCompleted,
      sentimentScores: {
        positive: acc.sentimentScores.positive + record.sentimentScores.positive,
        neutral: acc.sentimentScores.neutral + record.sentimentScores.neutral,
        negative: acc.sentimentScores.negative + record.sentimentScores.negative,
        mixed: acc.sentimentScores.mixed + record.sentimentScores.mixed
      }
    };
  }, {
    totalCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    missedCalls: 0,
    rejectedCalls: 0,
    totalTalkTime: 0,
    totalHandleTime: 0,
    totalHoldTime: 0,
    callsTransferred: 0,
    callsCompleted: 0,
    sentimentScores: { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  });
  const averageHandleTime = totals.totalCalls > 0 ? totals.totalHandleTime / totals.totalCalls : 0;
  const averageTalkTime = totals.totalCalls > 0 ? totals.totalTalkTime / totals.totalCalls : 0;
  const totalSentimentCalls = totals.sentimentScores.positive + totals.sentimentScores.neutral + totals.sentimentScores.negative + totals.sentimentScores.mixed;
  const averageSentiment = totalSentimentCalls > 0 ? (totals.sentimentScores.positive * 100 + totals.sentimentScores.neutral * 50 + totals.sentimentScores.negative * 0 + totals.sentimentScores.mixed * 50) / totalSentimentCalls : 50;
  const completionRate = totals.totalCalls > 0 ? totals.callsCompleted / totals.totalCalls * 100 : 0;
  const rejectionRate = totals.totalCalls > 0 ? totals.rejectedCalls / totals.totalCalls * 100 : 0;
  const performanceScore = Math.max(0, Math.min(
    100,
    completionRate * 0.4 + averageSentiment * 0.4 + (100 - rejectionRate) * 0.2
  ));
  return {
    period: {
      from: records[0]?.periodDate,
      to: records[records.length - 1]?.periodDate,
      days: records.length
    },
    totalCalls: totals.totalCalls,
    inboundCalls: totals.inboundCalls,
    outboundCalls: totals.outboundCalls,
    missedCalls: totals.missedCalls,
    rejectedCalls: totals.rejectedCalls,
    callsTransferred: totals.callsTransferred,
    callsCompleted: totals.callsCompleted,
    // FIXED FLAW #20: Keep as numbers, round to 2 decimals but don't convert to string
    completionRate: Math.round(completionRate * 100) / 100,
    averageHandleTime: Math.round(averageHandleTime),
    averageTalkTime: Math.round(averageTalkTime),
    averageHoldTime: totals.totalCalls > 0 ? Math.round(totals.totalHoldTime / totals.totalCalls) : 0,
    sentimentBreakdown: {
      positive: totals.sentimentScores.positive,
      neutral: totals.sentimentScores.neutral,
      negative: totals.sentimentScores.negative,
      mixed: totals.sentimentScores.mixed
    },
    averageSentiment: Math.round(averageSentiment * 100) / 100,
    performanceScore: Math.round(performanceScore * 100) / 100,
    rating: getRatingFromScore(performanceScore)
  };
}
function getRatingFromScore(score) {
  if (score >= 90)
    return "Excellent";
  if (score >= 75)
    return "Good";
  if (score >= 60)
    return "Average";
  if (score >= 40)
    return "Below Average";
  return "Needs Improvement";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

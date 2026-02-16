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

// src/services/chime/reconciliation-job.ts
var reconciliation_job_exports = {};
__export(reconciliation_job_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(reconciliation_job_exports);
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

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

// src/services/chime/reconciliation-job.ts
var import_client_sns = require("@aws-sdk/client-sns");
var ddb = getDynamoDBClient();
var sns = new import_client_sns.SNSClient({});
var ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE_NAME;
var AGENT_PERFORMANCE_TABLE = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var ALERT_TOPIC_ARN = process.env.RECONCILIATION_ALERT_TOPIC_ARN;
var handler = async (event = {}) => {
  console.log("[ReconciliationJob] Starting daily reconciliation");
  const targetDate = event.targetDate || getPreviousDate();
  console.log("[ReconciliationJob] Reconciling date:", targetDate);
  const agents = await getAgentsWithCallsOnDate(targetDate);
  console.log("[ReconciliationJob] Found agents with calls:", agents.length);
  const discrepancies = [];
  let totalAnalyticsCalls = 0;
  let totalPerformanceCalls = 0;
  for (const agentId of agents) {
    try {
      const discrepancy = await reconcileAgentMetrics(agentId, targetDate);
      if (discrepancy) {
        discrepancies.push(discrepancy);
        totalAnalyticsCalls += discrepancy.callsInAnalytics;
        totalPerformanceCalls += discrepancy.callsInPerformance;
        console.log("[ReconciliationJob] Discrepancy found for agent:", {
          agentId,
          difference: discrepancy.difference,
          severity: discrepancy.severity
        });
      }
    } catch (err) {
      console.error("[ReconciliationJob] Error reconciling agent:", {
        agentId,
        error: err.message
      });
    }
  }
  const criticalIssues = discrepancies.filter((d) => d.severity === "CRITICAL").length;
  const report = {
    runDate: (/* @__PURE__ */ new Date()).toISOString(),
    dateReconciled: targetDate,
    totalAgentsChecked: agents.length,
    discrepanciesFound: discrepancies.length,
    criticalIssues,
    discrepancies: discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)),
    summary: {
      totalCallsInAnalytics: totalAnalyticsCalls,
      totalCallsInPerformance: totalPerformanceCalls,
      totalDiscrepancy: totalAnalyticsCalls - totalPerformanceCalls
    }
  };
  await storeReconciliationReport(report);
  if (criticalIssues > 0 && ALERT_TOPIC_ARN) {
    await sendAlert(report);
  }
  console.log("[ReconciliationJob] Reconciliation complete:", {
    discrepancies: discrepancies.length,
    critical: criticalIssues
  });
  return report;
};
function getPreviousDate() {
  const yesterday = /* @__PURE__ */ new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().split("T")[0];
}
async function getAgentsWithCallsOnDate(date) {
  const startTimestamp = Math.floor((/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).getTime() / 1e3);
  const endTimestamp = Math.floor((/* @__PURE__ */ new Date(`${date}T23:59:59Z`)).getTime() / 1e3);
  const agents = /* @__PURE__ */ new Set();
  let lastEvaluatedKey = void 0;
  do {
    const scanResult = await ddb.send(new import_lib_dynamodb2.ScanCommand({
      TableName: ANALYTICS_TABLE,
      FilterExpression: "#ts BETWEEN :start AND :end AND attribute_exists(agentId)",
      ProjectionExpression: "agentId",
      ExpressionAttributeNames: {
        "#ts": "timestamp"
      },
      ExpressionAttributeValues: {
        ":start": startTimestamp,
        ":end": endTimestamp
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));
    scanResult.Items?.forEach((item) => {
      if (item.agentId) {
        agents.add(item.agentId);
      }
    });
    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return Array.from(agents);
}
async function reconcileAgentMetrics(agentId, date) {
  const analyticsCallIds = await getAnalyticsCallsForAgent(agentId, date);
  const performanceRecord = await getAgentPerformanceForDate(agentId, date);
  const performanceCallIds = performanceRecord?.callIds || [];
  const callsInAnalytics = analyticsCallIds.length;
  const callsInPerformance = performanceRecord?.totalCalls || 0;
  const difference = callsInAnalytics - callsInPerformance;
  if (difference === 0 && callsInAnalytics === callsInPerformance) {
    return null;
  }
  const analyticsSet = new Set(analyticsCallIds);
  const performanceSet = new Set(performanceCallIds);
  const missingInPerformance = analyticsCallIds.filter((id) => !performanceSet.has(id));
  const missingInAnalytics = performanceCallIds.filter((id) => !analyticsSet.has(id));
  const percentageDiff = callsInAnalytics > 0 ? Math.abs(difference / callsInAnalytics * 100) : 100;
  let severity;
  if (percentageDiff < 5) {
    severity = "LOW";
  } else if (percentageDiff < 15) {
    severity = "MEDIUM";
  } else if (percentageDiff < 30) {
    severity = "HIGH";
  } else {
    severity = "CRITICAL";
  }
  return {
    agentId,
    date,
    callsInAnalytics,
    callsInPerformance,
    difference,
    percentageDiff,
    severity,
    analyticsCallIds,
    performanceCallIds,
    missingInPerformance,
    missingInAnalytics
  };
}
async function getAnalyticsCallsForAgent(agentId, date) {
  const startTimestamp = Math.floor((/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).getTime() / 1e3);
  const endTimestamp = Math.floor((/* @__PURE__ */ new Date(`${date}T23:59:59Z`)).getTime() / 1e3);
  const callIds = [];
  let lastEvaluatedKey = void 0;
  do {
    const queryResult = await ddb.send(new import_lib_dynamodb2.QueryCommand({
      TableName: ANALYTICS_TABLE,
      IndexName: "agentId-timestamp-index",
      KeyConditionExpression: "agentId = :agentId AND #ts BETWEEN :start AND :end",
      ProjectionExpression: "callId",
      ExpressionAttributeNames: {
        "#ts": "timestamp"
      },
      ExpressionAttributeValues: {
        ":agentId": agentId,
        ":start": startTimestamp,
        ":end": endTimestamp
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));
    queryResult.Items?.forEach((item) => {
      if (item.callId) {
        callIds.push(item.callId);
      }
    });
    lastEvaluatedKey = queryResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return callIds;
}
async function getAgentPerformanceForDate(agentId, date) {
  const result = await ddb.send(new import_lib_dynamodb2.GetCommand({
    TableName: AGENT_PERFORMANCE_TABLE,
    Key: {
      agentId,
      periodDate: date
    }
  }));
  return result.Item || null;
}
async function storeReconciliationReport(report) {
  const RECONCILIATION_TABLE = process.env.RECONCILIATION_TABLE_NAME || `${ANALYTICS_TABLE}-reconciliation`;
  try {
    await ddb.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: RECONCILIATION_TABLE,
      Key: {
        reportDate: report.dateReconciled,
        reportType: "daily"
      },
      UpdateExpression: `
        SET runDate = :runDate,
            totalAgentsChecked = :totalAgents,
            discrepanciesFound = :discrepancies,
            criticalIssues = :critical,
            discrepancyDetails = :details,
            summary = :summary,
            ttl = :ttl
      `,
      ExpressionAttributeValues: {
        ":runDate": report.runDate,
        ":totalAgents": report.totalAgentsChecked,
        ":discrepancies": report.discrepanciesFound,
        ":critical": report.criticalIssues,
        ":details": report.discrepancies,
        ":summary": report.summary,
        ":ttl": Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60
        // 90 days retention
      }
    }));
  } catch (err) {
    console.error("[ReconciliationJob] Failed to store report:", err.message);
  }
}
async function sendAlert(report) {
  const criticalDiscrepancies = report.discrepancies.filter((d) => d.severity === "CRITICAL");
  const message = {
    subject: `[CRITICAL] Call Analytics Reconciliation Issues - ${report.dateReconciled}`,
    summary: {
      date: report.dateReconciled,
      criticalIssues: report.criticalIssues,
      totalDiscrepancies: report.discrepanciesFound,
      totalAgentsAffected: criticalDiscrepancies.length
    },
    criticalIssues: criticalDiscrepancies.map((d) => ({
      agentId: d.agentId,
      callsInAnalytics: d.callsInAnalytics,
      callsInPerformance: d.callsInPerformance,
      difference: d.difference,
      percentageDiff: `${d.percentageDiff.toFixed(1)}%`,
      missingInPerformance: d.missingInPerformance.length,
      missingInAnalytics: d.missingInAnalytics.length
    })),
    action: "Please investigate and run data recovery process if needed"
  };
  try {
    await sns.send(new import_client_sns.PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: message.subject,
      Message: JSON.stringify(message, null, 2)
    }));
    console.log("[ReconciliationJob] Alert sent successfully");
  } catch (err) {
    console.error("[ReconciliationJob] Failed to send alert:", err.message);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

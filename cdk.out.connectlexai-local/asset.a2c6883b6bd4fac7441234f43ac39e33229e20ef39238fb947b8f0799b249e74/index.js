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

// src/services/rcs/analytics-aggregator.ts
var analytics_aggregator_exports = {};
__export(analytics_aggregator_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(analytics_aggregator_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var cloudwatch = new import_client_cloudwatch.CloudWatchClient({});
var RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE;
var RCS_ANALYTICS_TABLE = process.env.RCS_ANALYTICS_TABLE;
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE;
var handler = async (event, context) => {
  console.log("RCS Analytics Aggregator Event:", JSON.stringify(event, null, 2));
  const now = /* @__PURE__ */ new Date();
  const currentHour = now.getUTCHours();
  try {
    const clinicIds = await getActiveClinicIds();
    console.log(`Processing ${clinicIds.length} clinics`);
    const results = await Promise.allSettled(
      clinicIds.map((clinicId) => aggregateClinicMetrics(clinicId, now))
    );
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`Aggregation complete: ${successful} succeeded, ${failed} failed`);
    await pushAggregateCloudWatchMetrics(clinicIds.length, successful, failed);
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`Failed to aggregate clinic ${clinicIds[index]}:`, result.reason);
      }
    });
  } catch (error) {
    console.error("Analytics aggregation failed:", error);
    throw error;
  }
};
async function aggregateClinicMetrics(clinicId, now) {
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
  await aggregateHourlyMetrics(clinicId, today, now);
  await aggregateDailyMetrics(clinicId, yesterday);
  await aggregateTemplatePerformance(clinicId, today);
  console.log(`Completed aggregation for clinic ${clinicId}`);
}
async function aggregateHourlyMetrics(clinicId, date, now) {
  const currentHour = now.getUTCHours();
  const startOfDay = new Date(date).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1e3;
  const messages = await fetchMessages(clinicId, startOfDay, endOfDay);
  const hourlyBuckets = /* @__PURE__ */ new Map();
  for (const msg of messages) {
    const msgHour = new Date(msg.timestamp).getUTCHours();
    if (!hourlyBuckets.has(msgHour)) {
      hourlyBuckets.set(msgHour, []);
    }
    hourlyBuckets.get(msgHour).push(msg);
  }
  const writeRequests = [];
  for (const [hour, hourMsgs] of hourlyBuckets) {
    if (hour > currentHour)
      continue;
    const metrics = calculateMetrics(hourMsgs, clinicId, date, hour);
    writeRequests.push({
      PutRequest: {
        Item: metrics
      }
    });
  }
  if (writeRequests.length > 0) {
    await batchWriteItems(RCS_ANALYTICS_TABLE, writeRequests);
  }
}
async function aggregateDailyMetrics(clinicId, date) {
  const existing = await ddb.send(new import_lib_dynamodb.QueryCommand({
    TableName: RCS_ANALYTICS_TABLE,
    KeyConditionExpression: "pk = :pk AND sk = :sk",
    ExpressionAttributeValues: {
      ":pk": `CLINIC#${clinicId}`,
      ":sk": `DAILY#${date}`
    },
    Limit: 1
  }));
  if (existing.Items && existing.Items.length > 0) {
    console.log(`Daily metrics for ${clinicId} ${date} already exist`);
    return;
  }
  const startOfDay = new Date(date).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1e3;
  const messages = await fetchMessages(clinicId, startOfDay, endOfDay);
  if (messages.length === 0) {
    console.log(`No messages for ${clinicId} on ${date}`);
    return;
  }
  const metrics = calculateMetrics(messages, clinicId, date);
  metrics.sk = `DAILY#${date}`;
  metrics.granularity = "daily";
  delete metrics.hour;
  await ddb.send(new import_lib_dynamodb.PutCommand({
    TableName: RCS_ANALYTICS_TABLE,
    Item: metrics
  }));
  console.log(`Saved daily metrics for ${clinicId} on ${date}`);
}
async function aggregateTemplatePerformance(clinicId, date) {
  const startOfDay = new Date(date).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1e3;
  const messages = await fetchMessages(clinicId, startOfDay, endOfDay);
  const templateStats = /* @__PURE__ */ new Map();
  for (const msg of messages) {
    if (msg.direction !== "outbound")
      continue;
    const templateId = msg.templateId || msg.contentSid;
    if (!templateId)
      continue;
    if (!templateStats.has(templateId)) {
      templateStats.set(templateId, {
        templateId,
        templateName: msg.templateName || templateId,
        sent: 0,
        delivered: 0,
        read: 0
      });
    }
    const stats = templateStats.get(templateId);
    stats.sent++;
    if (msg.status === "delivered" || msg.status === "read") {
      stats.delivered++;
    }
    if (msg.status === "read") {
      stats.read++;
    }
  }
  const writeRequests = [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ttl = Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60;
  for (const [templateId, stats] of templateStats) {
    const metrics = {
      pk: `CLINIC#${clinicId}`,
      sk: `TEMPLATE_PERF#${templateId}#${date}`,
      clinicId,
      templateId,
      templateName: stats.templateName,
      date,
      sendCount: stats.sent,
      deliveredCount: stats.delivered,
      readCount: stats.read,
      deliveryRate: stats.sent > 0 ? Math.round(stats.delivered / stats.sent * 100) / 100 : 0,
      readRate: stats.sent > 0 ? Math.round(stats.read / stats.sent * 100) / 100 : 0,
      aggregatedAt: now,
      ttl
    };
    writeRequests.push({
      PutRequest: {
        Item: metrics
      }
    });
  }
  if (writeRequests.length > 0) {
    await batchWriteItems(RCS_ANALYTICS_TABLE, writeRequests);
  }
}
function calculateMetrics(messages, clinicId, date, hour) {
  const outbound = messages.filter((m) => m.direction === "outbound");
  const inbound = messages.filter((m) => m.direction === "inbound");
  const smsFallback = messages.filter((m) => m.messageType === "sms_fallback");
  let sent = 0, delivered = 0, read = 0, failed = 0;
  for (const msg of outbound) {
    const status = (msg.status || "").toLowerCase();
    if (["queued", "sending", "sent", "delivered", "read"].includes(status)) {
      sent++;
    }
    if (status === "delivered" || status === "read") {
      delivered++;
    }
    if (status === "read") {
      read++;
    }
    if (status === "failed" || status === "undelivered") {
      failed++;
    }
  }
  let textCount = 0, richCardCount = 0, carouselCount = 0, mediaCount = 0, templateCount = 0;
  for (const msg of outbound) {
    const type = msg.messageType || "text";
    switch (type) {
      case "text":
        textCount++;
        break;
      case "richCard":
        richCardCount++;
        break;
      case "carousel":
        carouselCount++;
        break;
      case "media":
        mediaCount++;
        break;
      case "template":
        templateCount++;
        break;
    }
  }
  let avgResponseTime = 0;
  const responseTimes = [];
  const sortedMsgs = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < sortedMsgs.length; i++) {
    const prev = sortedMsgs[i - 1];
    const curr = sortedMsgs[i];
    if (prev.direction === "inbound" && curr.direction === "outbound") {
      const responseTime = curr.timestamp - prev.timestamp;
      if (responseTime > 0 && responseTime < 24 * 60 * 60 * 1e3) {
        responseTimes.push(responseTime);
      }
    }
  }
  if (responseTimes.length > 0) {
    avgResponseTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
  }
  const smsFallbackSuccess = smsFallback.filter((m) => m.status === "sent").length;
  return {
    pk: `CLINIC#${clinicId}`,
    sk: hour !== void 0 ? `HOURLY#${date}#${hour.toString().padStart(2, "0")}` : `DAILY#${date}`,
    clinicId,
    date,
    hour,
    granularity: hour !== void 0 ? "hourly" : "daily",
    totalSent: sent,
    totalDelivered: delivered,
    totalRead: read,
    totalFailed: failed,
    deliveryRate: sent > 0 ? Math.round(delivered / sent * 100) / 100 : 0,
    readRate: delivered > 0 ? Math.round(read / delivered * 100) / 100 : 0,
    textCount,
    richCardCount,
    carouselCount,
    mediaCount,
    templateCount,
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    repliesCount: inbound.length,
    avgResponseTimeMs: avgResponseTime,
    smsFallbackCount: smsFallback.length,
    smsFallbackSuccessRate: smsFallback.length > 0 ? Math.round(smsFallbackSuccess / smsFallback.length * 100) / 100 : 0,
    aggregatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ttl: Math.floor(Date.now() / 1e3) + 365 * 24 * 60 * 60
    // 1 year TTL
  };
}
async function fetchMessages(clinicId, startTs, endTs) {
  const messages = [];
  let lastKey = void 0;
  do {
    const result = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: RCS_MESSAGES_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": `CLINIC#${clinicId}`,
        ":start": startTs,
        ":end": endTs
      },
      FilterExpression: "#ts >= :start AND #ts <= :end AND attribute_exists(direction)",
      ExpressionAttributeNames: {
        "#ts": "timestamp"
      },
      ExclusiveStartKey: lastKey
    }));
    messages.push(...result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return messages;
}
async function getActiveClinicIds() {
  try {
    const result = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: CLINIC_CONFIG_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": "CLINICS"
      }
    }));
    return (result.Items || []).filter((item) => item.isActive !== false).map((item) => item.clinicId || item.sk?.replace("CLINIC#", "")).filter(Boolean);
  } catch (error) {
    console.error("Failed to fetch clinic IDs, defaulting to empty:", error);
    const result = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: RCS_MESSAGES_TABLE,
      IndexName: "MessageSidIndex",
      // This doesn't work, but we'll scan
      ProjectionExpression: "pk",
      Limit: 1e3
    }));
    const clinicIds = /* @__PURE__ */ new Set();
    for (const item of result.Items || []) {
      if (item.pk?.startsWith("CLINIC#")) {
        clinicIds.add(item.pk.replace("CLINIC#", ""));
      }
    }
    return Array.from(clinicIds);
  }
}
async function batchWriteItems(tableName, writeRequests) {
  const chunks = [];
  for (let i = 0; i < writeRequests.length; i += 25) {
    chunks.push(writeRequests.slice(i, i + 25));
  }
  for (const chunk of chunks) {
    await ddb.send(new import_lib_dynamodb.BatchWriteCommand({
      RequestItems: {
        [tableName]: chunk
      }
    }));
  }
}
async function pushAggregateCloudWatchMetrics(totalClinics, successful, failed) {
  try {
    await cloudwatch.send(new import_client_cloudwatch.PutMetricDataCommand({
      Namespace: "TodaysDental/RCS",
      MetricData: [
        {
          MetricName: "AggregationRuns",
          Value: 1,
          Unit: "Count"
        },
        {
          MetricName: "ClinicsProcessed",
          Value: successful,
          Unit: "Count"
        },
        {
          MetricName: "ClinicsFailedAggregation",
          Value: failed,
          Unit: "Count"
        }
      ]
    }));
  } catch (e) {
    console.error("Failed to push aggregate CloudWatch metrics:", e);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

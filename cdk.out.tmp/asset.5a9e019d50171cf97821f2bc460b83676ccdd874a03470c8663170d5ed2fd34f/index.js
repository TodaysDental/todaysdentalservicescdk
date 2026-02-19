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

// src/services/connect/connect-call-finalizer.ts
var connect_call_finalizer_exports = {};
__export(connect_call_finalizer_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(connect_call_finalizer_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE || "";
var TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME || "";
var SESSIONS_TABLE = process.env.SESSIONS_TABLE || "AiAgentSessions";
var SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE || "";
async function findAnalyticsRecord(callId) {
  if (!CALL_ANALYTICS_TABLE) {
    console.warn("[ConnectFinalizer] CALL_ANALYTICS_TABLE not configured");
    return null;
  }
  try {
    const result = await docClient.send(new import_lib_dynamodb.QueryCommand({
      TableName: CALL_ANALYTICS_TABLE,
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    if (result.Items && result.Items.length > 0) {
      const record = result.Items[0];
      return {
        callId,
        timestamp: record.timestamp,
        record
      };
    }
    return null;
  } catch (error) {
    console.error("[ConnectFinalizer] Error finding analytics record:", error);
    return null;
  }
}
async function finalizeAnalytics(params) {
  if (!CALL_ANALYTICS_TABLE)
    return;
  const { callId, timestamp, callStartMs, disconnectReason } = params;
  const now = Date.now();
  const durationSec = Math.round((now - callStartMs) / 1e3);
  try {
    await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Key: { callId, timestamp },
      UpdateExpression: `
        SET callStatus = :completed,
            outcome = :outcome,
            callEndTime = :endTime,
            duration = :duration,
            disconnectReason = :reason,
            lastActivityTime = :now
      `,
      ExpressionAttributeValues: {
        ":completed": "completed",
        ":outcome": "completed",
        ":endTime": new Date(now).toISOString(),
        ":duration": durationSec,
        ":reason": disconnectReason || "customer_disconnect",
        ":now": new Date(now).toISOString()
      }
    }));
    console.log("[ConnectFinalizer] Analytics finalized:", { callId, durationSec, disconnectReason });
  } catch (error) {
    console.error("[ConnectFinalizer] Error finalizing analytics:", error);
    throw error;
  }
}
async function shortenTranscriptTTL(callId) {
  if (!TRANSCRIPT_BUFFER_TABLE)
    return;
  const shortTTL = Math.floor(Date.now() / 1e3) + 60 * 60;
  try {
    await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: TRANSCRIPT_BUFFER_TABLE,
      Key: { callId },
      UpdateExpression: "SET ttl = :ttl",
      ExpressionAttributeValues: { ":ttl": shortTTL },
      ConditionExpression: "attribute_exists(callId)"
    }));
    console.log("[ConnectFinalizer] Shortened transcript TTL:", { callId });
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") {
      console.warn("[ConnectFinalizer] Error shortening transcript TTL:", error);
    }
  }
}
function mapDisconnectReasonToScheduledCall(disconnectReasonRaw) {
  const reason = String(disconnectReasonRaw || "").trim().toUpperCase();
  if (reason.includes("BUSY")) {
    return { status: "completed", outcome: "busy" };
  }
  if (reason.includes("NO_ANSWER") || reason.includes("NOANSWER") || reason.includes("TIMEOUT")) {
    return { status: "completed", outcome: "no_answer" };
  }
  if (reason.includes("VOICEMAIL") || reason.includes("ANSWERING_MACHINE")) {
    return { status: "completed", outcome: "voicemail" };
  }
  if (reason.includes("ERROR") || reason.includes("FAILED")) {
    return { status: "failed", outcome: "failed" };
  }
  return { status: "completed", outcome: "answered" };
}
async function finalizeScheduledCall(params) {
  if (!SCHEDULED_CALLS_TABLE)
    return;
  const { scheduledCallId, connectContactId, analyticsCallId, durationSec, disconnectReason } = params;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const mapped = mapDisconnectReasonToScheduledCall(disconnectReason);
  try {
    await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Key: { callId: scheduledCallId },
      UpdateExpression: `
        SET #status = :status,
            outcome = :outcome,
            endedAt = :endedAt,
            durationSec = :duration,
            disconnectReason = :reason,
            connectContactId = :contactId,
            analyticsCallId = :analyticsCallId,
            updatedAt = :now
      `,
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": mapped.status,
        ":outcome": mapped.outcome,
        ":endedAt": nowIso,
        ":duration": durationSec,
        ":reason": disconnectReason || "unknown",
        ":contactId": connectContactId,
        ":analyticsCallId": analyticsCallId,
        ":now": nowIso,
        ":in_progress": "in_progress",
        ":scheduled": "scheduled"
      },
      // Avoid overwriting terminal statuses (idempotency + safety)
      ConditionExpression: "attribute_exists(callId) AND (#status = :in_progress OR #status = :scheduled)"
    }));
    console.log("[ConnectFinalizer] ScheduledCalls updated:", {
      scheduledCallId,
      status: mapped.status,
      outcome: mapped.outcome,
      durationSec,
      disconnectReason
    });
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      console.log("[ConnectFinalizer] ScheduledCalls not updated (already final or missing):", {
        scheduledCallId
      });
      return;
    }
    console.warn("[ConnectFinalizer] Failed to update ScheduledCalls:", {
      scheduledCallId,
      error: error?.message || String(error)
    });
  }
}
async function getSession(contactId) {
  const sessionKey = `lex-${contactId}`;
  try {
    const result = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: sessionKey }
    }));
    if (result.Item) {
      return { callStartMs: result.Item.callStartMs || Date.now() };
    }
    return null;
  } catch (error) {
    console.warn("[ConnectFinalizer] Error getting session:", error);
    return null;
  }
}
var handler = async (event) => {
  console.log("[ConnectFinalizer] Received event:", JSON.stringify(event, null, 2));
  const contactData = event.Details?.ContactData;
  if (!contactData) {
    console.error("[ConnectFinalizer] Missing ContactData");
    return { status: "error", reason: "Missing ContactData" };
  }
  const contactId = contactData.ContactId;
  const callId = `connect-${contactId}`;
  const disconnectReason = event.Details?.Parameters?.disconnectReason || "unknown";
  const contactAttributes = contactData.Attributes || {};
  const scheduledCallId = typeof contactAttributes.scheduledCallId === "string" ? contactAttributes.scheduledCallId.trim() : "";
  const session = await getSession(contactId);
  const initiationMs = contactData.InitiationTimestamp ? new Date(contactData.InitiationTimestamp).getTime() : NaN;
  const disconnectMs = contactData.DisconnectTimestamp ? new Date(contactData.DisconnectTimestamp).getTime() : NaN;
  const startMs = session?.callStartMs || (Number.isFinite(initiationMs) ? initiationMs : Date.now());
  const endMs = Number.isFinite(disconnectMs) ? disconnectMs : Date.now();
  const durationSec = Math.max(0, Math.round((endMs - startMs) / 1e3));
  const analyticsInfo = await findAnalyticsRecord(callId);
  if (analyticsInfo) {
    if (analyticsInfo.record.callStatus === "completed") {
      console.log("[ConnectFinalizer] Call already finalized:", callId);
    } else {
      await finalizeAnalytics({
        callId,
        timestamp: analyticsInfo.timestamp,
        callStartMs: startMs,
        disconnectReason
      });
      await shortenTranscriptTTL(callId);
    }
  } else {
    console.warn("[ConnectFinalizer] No analytics record found for call (non-fatal):", callId);
  }
  if (scheduledCallId) {
    await finalizeScheduledCall({
      scheduledCallId,
      connectContactId: contactId,
      analyticsCallId: callId,
      durationSec,
      disconnectReason
    });
  }
  console.log("[ConnectFinalizer] Call finalized successfully:", {
    callId,
    durationSec,
    disconnectReason,
    scheduledCallId: scheduledCallId || void 0,
    hadAnalyticsRecord: !!analyticsInfo
  });
  return {
    status: "success",
    callId,
    duration: String(durationSec)
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

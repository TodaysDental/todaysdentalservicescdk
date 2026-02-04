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

// src/services/chime/compensating-action-processor.ts
var compensating_action_processor_exports = {};
__export(compensating_action_processor_exports, {
  CompensatingIntent: () => CompensatingIntent,
  handler: () => handler,
  scheduleCompensatingAction: () => scheduleCompensatingAction
});
module.exports = __toCommonJS(compensating_action_processor_exports);
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");
var import_client_sqs = require("@aws-sdk/client-sqs");
var import_client_ssm = require("@aws-sdk/client-ssm");

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

// src/services/chime/compensating-action-processor.ts
var ddb = getDynamoDBClient();
var sqsClient = new import_client_sqs.SQSClient({});
var ssmClient = new import_client_ssm.SSMClient({});
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chimeVoice = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
var chime = new import_client_chime_sdk_meetings.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var cachedQueueUrl = null;
var CompensatingIntent = /* @__PURE__ */ ((CompensatingIntent2) => {
  CompensatingIntent2["INTENDED_HOLD"] = "INTENDED_HOLD";
  CompensatingIntent2["INTENDED_RESUME"] = "INTENDED_RESUME";
  CompensatingIntent2["UNKNOWN"] = "UNKNOWN";
  return CompensatingIntent2;
})(CompensatingIntent || {});
var handler = async (event) => {
  console.log("[CompensatingAction] Processing batch", {
    recordCount: event.Records.length,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  for (const record of event.Records) {
    try {
      await processCompensatingAction(record);
    } catch (err) {
      console.error("[CompensatingAction] Error processing record:", {
        messageId: record.messageId,
        error: err.message,
        stack: err.stack
      });
      throw err;
    }
  }
  console.log("[CompensatingAction] Batch processing complete");
};
async function processCompensatingAction(record) {
  const action = JSON.parse(record.body);
  console.log("[CompensatingAction] Processing action:", {
    action: action.action,
    callId: action.callId,
    agentId: action.agentId,
    reason: action.reason
  });
  switch (action.action) {
    case "RESUME_HELD_CALL":
      await resumeInconsistentHold(action);
      break;
    case "RELEASE_ORPHANED_MEETING_ATTENDEE":
      await releaseOrphanedAttendee(action);
      break;
    case "RECONCILE_AGENT_STATE":
      await reconcileAgentState(action);
      break;
    case "CLEANUP_FAILED_TRANSFER":
      await cleanupFailedTransfer(action);
      break;
    default:
      console.warn("[CompensatingAction] Unknown action type:", action.action);
  }
}
async function resumeInconsistentHold(action) {
  console.log(`[CompensatingAction] Resuming inconsistent hold for call ${action.callId}`, {
    holdOperationId: action.holdOperationId,
    clinicId: action.clinicId,
    hasQueuePosition: action.queuePosition !== void 0
  });
  const { Items: calls } = await ddb.send(new import_lib_dynamodb2.QueryCommand({
    TableName: CALL_QUEUE_TABLE_NAME,
    IndexName: "callId-index",
    KeyConditionExpression: "callId = :callId",
    ExpressionAttributeValues: { ":callId": action.callId }
  }));
  if (!calls || calls.length === 0) {
    console.warn("[CompensatingAction] Call not found, skipping:", action.callId);
    return;
  }
  const call = calls[0];
  const clinicId = action.clinicId || call.clinicId;
  const { Item: agent } = await ddb.send(new import_lib_dynamodb2.GetCommand({
    TableName: AGENT_PRESENCE_TABLE_NAME,
    Key: { agentId: action.agentId }
  }));
  if (!agent) {
    console.warn("[CompensatingAction] Agent not found, skipping:", action.agentId);
    return;
  }
  let wasIntendedHold = false;
  if (action.intent) {
    wasIntendedHold = action.intent === "INTENDED_HOLD" /* INTENDED_HOLD */;
    console.log("[CompensatingAction] Using explicit intent:", action.intent);
  } else {
    const isHoldActionType = action.action === "RESUME_HELD_CALL";
    const hasDbUpdateFailure = action.reason?.includes("DB_UPDATE_FAILED") || action.reason?.startsWith("DB_UPDATE_FAILED");
    wasIntendedHold = isHoldActionType && hasDbUpdateFailure;
    console.warn("[CompensatingAction] Using legacy heuristics for intent detection", {
      action: action.action,
      reason: action.reason,
      wasIntendedHold,
      recommendation: "Update caller to use explicit intent field for reliable recovery"
    });
  }
  if (call.status === "connected" && agent.currentCallId === action.callId && !wasIntendedHold) {
    console.log("[CompensatingAction] DB shows connected (not from failed hold), resuming SMA");
    const smaId = action.smaId || getSmaIdForClinic(clinicId);
    if (!smaId) {
      console.error("[CompensatingAction] No SMA mapping for clinic", clinicId);
      return;
    }
    try {
      await chimeVoice.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: action.callId,
        Arguments: {
          action: "RESUME_CALL",
          compensating: "true",
          reason: action.reason,
          holdOperationId: action.holdOperationId || ""
        }
      }));
      console.log("[CompensatingAction] Successfully resumed SMA call");
    } catch (smaErr) {
      console.error("[CompensatingAction] Failed to resume SMA:", smaErr);
    }
  } else if (call.status === "connected" && wasIntendedHold) {
    console.log("[CompensatingAction] DB shows connected but intended hold, updating DB to on_hold");
    try {
      await ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: "SET #status = :onhold, callStatus = :onhold, holdStartTime = :now, heldByAgentId = :agentId, compensatingActionApplied = :true",
        ConditionExpression: "#status = :connected",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":onhold": "on_hold",
          ":connected": "connected",
          ":now": (/* @__PURE__ */ new Date()).toISOString(),
          ":agentId": action.agentId,
          ":true": true
        }
      }));
      await ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: action.agentId },
        UpdateExpression: "SET callStatus = :onhold, heldCallId = :callId, heldCallMeetingId = :meetingId, compensatingActionApplied = :true",
        ExpressionAttributeValues: {
          ":onhold": "on_hold",
          ":callId": action.callId,
          ":meetingId": action.meetingId || null,
          ":true": true
        }
      }));
      console.log("[CompensatingAction] Successfully updated DB to on_hold state");
    } catch (dbErr) {
      if (dbErr.name !== "ConditionalCheckFailedException") {
        throw dbErr;
      }
      console.log("[CompensatingAction] Call state already changed");
    }
  } else if (call.status === "on_hold") {
    console.log("[CompensatingAction] DB shows on_hold, updating agent");
    try {
      await ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: action.agentId },
        UpdateExpression: "SET callStatus = :onhold, heldCallId = :callId, compensatingActionApplied = :true, compensatingActionTime = :now",
        ConditionExpression: "currentCallId = :callId",
        ExpressionAttributeValues: {
          ":onhold": "on_hold",
          ":callId": action.callId,
          ":true": true,
          ":now": (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
      console.log("[CompensatingAction] Successfully updated agent state");
    } catch (dbErr) {
      if (dbErr.name !== "ConditionalCheckFailedException") {
        throw dbErr;
      }
      console.log("[CompensatingAction] Agent state already updated");
    }
  } else {
    console.log("[CompensatingAction] States already consistent, no action needed", {
      callStatus: call.status,
      agentCurrentCallId: agent.currentCallId,
      actionCallId: action.callId
    });
  }
}
async function releaseOrphanedAttendee(action) {
  console.log(`[CompensatingAction] Releasing orphaned attendee ${action.attendeeId} from meeting ${action.meetingId}`);
  if (!action.meetingId || !action.attendeeId) {
    console.warn("[CompensatingAction] Missing meetingId or attendeeId, skipping");
    return;
  }
  try {
    await chime.send(new import_client_chime_sdk_meetings.DeleteAttendeeCommand({
      MeetingId: action.meetingId,
      AttendeeId: action.attendeeId
    }));
    console.log("[CompensatingAction] Successfully deleted orphaned attendee");
  } catch (err) {
    if (err.name === "NotFoundException") {
      console.log("[CompensatingAction] Attendee already deleted");
    } else {
      console.error("[CompensatingAction] Failed to delete attendee:", err);
    }
  }
}
async function reconcileAgentState(action) {
  console.log(`[CompensatingAction] Reconciling agent state for ${action.agentId}`);
  const { Item: agent } = await ddb.send(new import_lib_dynamodb2.GetCommand({
    TableName: AGENT_PRESENCE_TABLE_NAME,
    Key: { agentId: action.agentId }
  }));
  if (!agent) {
    console.warn("[CompensatingAction] Agent not found:", action.agentId);
    return;
  }
  const hasActiveCall = agent.currentCallId || agent.ringingCallId || agent.heldCallId;
  if (!hasActiveCall) {
    console.log("[CompensatingAction] Agent has no active calls, marking online");
    try {
      await ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: action.agentId },
        UpdateExpression: "SET #status = :online, lastActivityAt = :now, compensatingActionApplied = :true REMOVE currentCallId, callStatus, ringingCallId, ringingCallTime, heldCallId, heldCallMeetingId, transferringCallId, transferStatus",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":online": "Online",
          ":now": (/* @__PURE__ */ new Date()).toISOString(),
          ":true": true
        }
      }));
      console.log("[CompensatingAction] Successfully reconciled agent state");
    } catch (err) {
      console.error("[CompensatingAction] Failed to reconcile agent:", err);
      throw err;
    }
  } else {
    console.log("[CompensatingAction] Agent has active call, validating consistency");
  }
}
async function cleanupFailedTransfer(action) {
  console.log(`[CompensatingAction] Cleaning up failed transfer ${action.transferId}`);
  if (!action.transferId) {
    console.warn("[CompensatingAction] Missing transferId, skipping");
    return;
  }
  const { Items: calls } = await ddb.send(new import_lib_dynamodb2.QueryCommand({
    TableName: CALL_QUEUE_TABLE_NAME,
    IndexName: "callId-index",
    KeyConditionExpression: "callId = :callId",
    ExpressionAttributeValues: { ":callId": action.callId }
  }));
  if (!calls || calls.length === 0) {
    console.warn("[CompensatingAction] Call not found:", action.callId);
    return;
  }
  const call = calls[0];
  const { clinicId, queuePosition } = call;
  try {
    await ddb.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId, queuePosition },
      UpdateExpression: "SET transferStatus = :failed, compensatingActionApplied = :true REMOVE transferId, transferToAgentId, transferFromAgentId, transferNotes",
      ConditionExpression: "transferId = :transferId",
      ExpressionAttributeValues: {
        ":failed": "FAILED",
        ":transferId": action.transferId,
        ":true": true
      }
    }));
    console.log("[CompensatingAction] Cleaned up call transfer state");
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") {
      throw err;
    }
    console.log("[CompensatingAction] Call transfer already cleaned up");
  }
  if (action.agentId) {
    try {
      const { Item: agent } = await ddb.send(new import_lib_dynamodb2.GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: action.agentId }
      }));
      if (!agent) {
        console.warn("[CompensatingAction] Agent not found:", action.agentId);
        return;
      }
      const hasOtherActiveCall = agent.currentCallId && agent.currentCallId !== action.callId;
      if (hasOtherActiveCall) {
        console.log("[CompensatingAction] Agent has another active call, only removing transfer fields", {
          agentId: action.agentId,
          currentCallId: agent.currentCallId
        });
        await ddb.send(new import_lib_dynamodb2.UpdateCommand({
          TableName: AGENT_PRESENCE_TABLE_NAME,
          Key: { agentId: action.agentId },
          UpdateExpression: "SET compensatingActionApplied = :true REMOVE transferringCallId, transferStatus, incomingTransferId",
          ExpressionAttributeValues: {
            ":true": true
          }
        }));
      } else {
        await ddb.send(new import_lib_dynamodb2.UpdateCommand({
          TableName: AGENT_PRESENCE_TABLE_NAME,
          Key: { agentId: action.agentId },
          UpdateExpression: "SET #status = :online, compensatingActionApplied = :true REMOVE transferringCallId, transferStatus, incomingTransferId",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":online": "Online",
            ":true": true
          }
        }));
      }
      console.log("[CompensatingAction] Cleaned up agent transfer state");
    } catch (err) {
      console.error("[CompensatingAction] Failed to clean up agent:", err);
    }
  }
}
async function getQueueUrl() {
  if (cachedQueueUrl) {
    return cachedQueueUrl;
  }
  const directQueueUrl = process.env.COMPENSATING_ACTIONS_QUEUE_URL;
  if (directQueueUrl) {
    cachedQueueUrl = directQueueUrl;
    return cachedQueueUrl;
  }
  const stackName = process.env.STACK_NAME;
  if (!stackName) {
    console.error("[CompensatingAction] STACK_NAME env var not set and no COMPENSATING_ACTIONS_QUEUE_URL");
    return null;
  }
  const parameterName = `/${stackName}/CompensatingActionsQueueUrl`;
  try {
    const response = await ssmClient.send(new import_client_ssm.GetParameterCommand({
      Name: parameterName
    }));
    cachedQueueUrl = response.Parameter?.Value || null;
    return cachedQueueUrl;
  } catch (err) {
    console.error("[CompensatingAction] Failed to get queue URL from SSM:", err);
    return null;
  }
}
async function scheduleCompensatingAction(action, queueUrl) {
  const url = queueUrl || await getQueueUrl();
  if (!url) {
    console.error("[CompensatingAction] Cannot schedule - no queue URL available");
    console.error("[CompensatingAction] UNSCHEDULED ACTION:", JSON.stringify(action));
    return;
  }
  const messageBody = {
    ...action,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    await sqsClient.send(new import_client_sqs.SendMessageCommand({
      QueueUrl: url,
      MessageBody: JSON.stringify(messageBody)
      // Use callId for message deduplication in FIFO queues (if using FIFO)
      // MessageGroupId: action.callId,
    }));
    console.log("[CompensatingAction] Scheduled compensating action:", {
      action: action.action,
      callId: action.callId,
      agentId: action.agentId
    });
  } catch (err) {
    console.error("[CompensatingAction] Failed to send to SQS:", err);
    console.error("[CompensatingAction] FAILED ACTION:", JSON.stringify(messageBody));
    throw err;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CompensatingIntent,
  handler,
  scheduleCompensatingAction
});

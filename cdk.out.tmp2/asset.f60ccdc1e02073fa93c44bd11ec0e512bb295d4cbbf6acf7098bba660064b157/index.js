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

// src/services/chime/cleanup-monitor.ts
var cleanup_monitor_exports = {};
__export(cleanup_monitor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(cleanup_monitor_exports);
var import_lib_dynamodb5 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_meetings3 = require("@aws-sdk/client-chime-sdk-meetings");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");

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

// src/services/chime/utils/meeting-lifecycle.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");
var MeetingLifecycleManager = class {
  constructor(ddb2, chime2, callQueueTable) {
    this.ddb = ddb2;
    this.chime = chime2;
    this.callQueueTable = callQueueTable;
  }
  /**
   * Clean up meetings for calls in specific states
   * ONLY cleans up temporary meetings created for queued calls
   * Does NOT touch agent session meetings
   */
  async cleanupOrphanedMeetings() {
    const result = {
      cleanedCount: 0,
      errors: [],
      skipped: 0
    };
    try {
      const { Items: calls } = await this.ddb.send(new import_lib_dynamodb2.ScanCommand({
        TableName: this.callQueueTable,
        FilterExpression: "(#status IN (:queued, :abandoned, :failed)) AND attribute_exists(meetingInfo) AND queueEntryTime < :cutoffTime",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":queued": "queued",
          ":abandoned": "abandoned",
          ":failed": "failed",
          // Clean up meetings older than 30 minutes
          ":cutoffTime": Math.floor(Date.now() / 1e3) - 30 * 60
        }
      }));
      if (!calls || calls.length === 0) {
        console.log("[MeetingLifecycle] No orphaned meetings found");
        return result;
      }
      console.log(`[MeetingLifecycle] Found ${calls.length} potential orphaned meetings`);
      for (const call of calls) {
        try {
          await this.cleanupMeeting(call, result);
        } catch (err) {
          const errorMsg = `Failed to cleanup meeting for call ${call.callId}: ${err.message}`;
          console.error(`[MeetingLifecycle] ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }
      console.log("[MeetingLifecycle] Cleanup complete:", result);
    } catch (err) {
      const errorMsg = `Error during orphaned meeting scan: ${err.message}`;
      console.error(`[MeetingLifecycle] ${errorMsg}`);
      result.errors.push(errorMsg);
    }
    return result;
  }
  /**
   * Clean up a single meeting
   */
  async cleanupMeeting(call, result) {
    const meetingId = call.meetingInfo?.MeetingId;
    if (!meetingId) {
      result.skipped++;
      return;
    }
    const callAge = Date.now() - call.queueEntryTime * 1e3;
    const callAgeMinutes = Math.floor(callAge / (60 * 1e3));
    if (callAgeMinutes < 30) {
      console.log(`[MeetingLifecycle] Skipping recent call ${call.callId} (${callAgeMinutes} min old)`);
      result.skipped++;
      return;
    }
    console.log(`[MeetingLifecycle] Cleaning up meeting ${meetingId} for call ${call.callId} (status: ${call.status}, age: ${callAgeMinutes} min)`);
    try {
      await this.chime.send(new import_client_chime_sdk_meetings.DeleteMeetingCommand({ MeetingId: meetingId }));
      console.log(`[MeetingLifecycle] Deleted orphaned meeting ${meetingId}`);
      await this.ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: this.callQueueTable,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: "REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo SET meetingCleanedUpAt = :now, meetingCleanupReason = :reason",
        ExpressionAttributeValues: {
          ":now": (/* @__PURE__ */ new Date()).toISOString(),
          ":reason": "orphaned_meeting_cleanup"
        }
      }));
      result.cleanedCount++;
    } catch (err) {
      if (err.name === "NotFoundException") {
        console.log(`[MeetingLifecycle] Meeting ${meetingId} already deleted`);
        await this.ddb.send(new import_lib_dynamodb2.UpdateCommand({
          TableName: this.callQueueTable,
          Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
          UpdateExpression: "REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo SET meetingCleanedUpAt = :now, meetingCleanupReason = :reason",
          ExpressionAttributeValues: {
            ":now": (/* @__PURE__ */ new Date()).toISOString(),
            ":reason": "meeting_not_found"
          }
        }));
        result.cleanedCount++;
      } else {
        throw err;
      }
    }
  }
  /**
   * Validate that a meeting still exists
   */
  async validateMeeting(meetingId) {
    try {
      await this.chime.send(new import_client_chime_sdk_meetings.GetMeetingCommand({ MeetingId: meetingId }));
      return true;
    } catch (err) {
      if (err.name === "NotFoundException") {
        return false;
      }
      throw err;
    }
  }
  /**
   * Clean up meeting by ID with verification
   */
  async deleteMeetingIfExists(meetingId) {
    try {
      await this.chime.send(new import_client_chime_sdk_meetings.DeleteMeetingCommand({ MeetingId: meetingId }));
      console.log(`[MeetingLifecycle] Deleted meeting ${meetingId}`);
      return true;
    } catch (err) {
      if (err.name === "NotFoundException") {
        console.log(`[MeetingLifecycle] Meeting ${meetingId} not found (already deleted)`);
        return false;
      }
      console.error(`[MeetingLifecycle] Error deleting meeting ${meetingId}:`, err);
      throw err;
    }
  }
  /**
   * Get all active meetings for a call (for debugging)
   */
  async getCallMeetingInfo(callId) {
    const { Items: calls } = await this.ddb.send(new import_lib_dynamodb2.QueryCommand({
      TableName: this.callQueueTable,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId }
    }));
    if (!calls || calls.length === 0) {
      return null;
    }
    const call = calls[0];
    if (!call.meetingInfo?.MeetingId) {
      return null;
    }
    const isValid = await this.validateMeeting(call.meetingInfo.MeetingId);
    return {
      callId: call.callId,
      meetingId: call.meetingInfo.MeetingId,
      status: call.status,
      isValid,
      queueEntryTime: call.queueEntryTime,
      assignedAgentId: call.assignedAgentId
    };
  }
};

// src/services/chime/utils/consistency-checker.ts
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var ConsistencyChecker = class {
  constructor(ddb2, agentTable, callTable) {
    this.ddb = ddb2;
    this.agentTable = agentTable;
    this.callTable = callTable;
  }
  /**
   * Main entry point: Check and reconcile all inconsistencies
   */
  async checkAndReconcile() {
    const report = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      totalChecked: 0,
      inconsistenciesFound: 0,
      reconciled: 0,
      manualReviewNeeded: [],
      errors: []
    };
    console.log("[ConsistencyChecker] Starting consistency check");
    try {
      const { Items: agents } = await this.ddb.send(new import_lib_dynamodb3.ScanCommand({
        TableName: this.agentTable,
        FilterExpression: "attribute_exists(currentCallId) OR attribute_exists(heldCallId)",
        ProjectionExpression: "agentId, currentCallId, heldCallId, callStatus, #status",
        ExpressionAttributeNames: { "#status": "status" }
      }));
      if (!agents || agents.length === 0) {
        console.log("[ConsistencyChecker] No agents with active calls found");
        return report;
      }
      report.totalChecked = agents.length;
      console.log(`[ConsistencyChecker] Checking ${agents.length} agents with active calls`);
      for (const agent of agents) {
        try {
          await this.checkAgent(agent, report);
        } catch (err) {
          const errorMsg = `Error checking agent ${agent.agentId}: ${err.message}`;
          console.error(`[ConsistencyChecker] ${errorMsg}`);
          report.errors.push(errorMsg);
        }
      }
      console.log("[ConsistencyChecker] Check complete:", {
        checked: report.totalChecked,
        found: report.inconsistenciesFound,
        reconciled: report.reconciled,
        manual: report.manualReviewNeeded.length,
        errors: report.errors.length
      });
    } catch (err) {
      const errorMsg = `Fatal error during consistency check: ${err.message}`;
      console.error(`[ConsistencyChecker] ${errorMsg}`);
      report.errors.push(errorMsg);
    }
    return report;
  }
  /**
   * Check a single agent for inconsistencies
   */
  async checkAgent(agent, report) {
    const agentId = agent.agentId;
    const currentCallId = agent.currentCallId || agent.heldCallId;
    if (!currentCallId) {
      return;
    }
    const { Items: calls } = await this.ddb.send(new import_lib_dynamodb3.QueryCommand({
      TableName: this.callTable,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": currentCallId }
    }));
    if (!calls || calls.length === 0) {
      report.inconsistenciesFound++;
      console.warn(`[ConsistencyChecker] Agent ${agentId} references non-existent call ${currentCallId}`);
      const inconsistency = {
        type: "MISSING_CALL",
        agentId,
        callId: currentCallId,
        agentStatus: agent.status,
        description: `Agent references call ${currentCallId} which doesn't exist`
      };
      await this.reconcileMissingCall(agent, inconsistency, report);
      return;
    }
    const call = calls[0];
    if (call.assignedAgentId && call.assignedAgentId !== agentId) {
      report.inconsistenciesFound++;
      console.warn(`[ConsistencyChecker] Mismatch: agent ${agentId} has call ${currentCallId} but call assigned to ${call.assignedAgentId}`);
      const inconsistency = {
        type: "AGENT_MISMATCH",
        agentId,
        callId: currentCallId,
        assignedAgentId: call.assignedAgentId,
        callStatus: call.status,
        description: `Agent has call but call assigned to ${call.assignedAgentId}`
      };
      await this.reconcileAgentMismatch(agent, call, inconsistency, report);
      return;
    }
    if (agent.callStatus && call.status && agent.callStatus !== call.status) {
      report.inconsistenciesFound++;
      console.log(`[ConsistencyChecker] Status mismatch: agent ${agentId} shows ${agent.callStatus} but call is ${call.status}`);
      const inconsistency = {
        type: "STATUS_MISMATCH",
        agentId,
        callId: currentCallId,
        agentStatus: agent.callStatus,
        callStatus: call.status,
        description: `Agent status ${agent.callStatus} doesn't match call status ${call.status}`
      };
      await this.reconcileStatusMismatch(agent, call, inconsistency, report);
    }
  }
  /**
   * Reconcile: Agent references a call that doesn't exist
   */
  async reconcileMissingCall(agent, inconsistency, report) {
    try {
      await this.ddb.send(new import_lib_dynamodb3.UpdateCommand({
        TableName: this.agentTable,
        Key: { agentId: agent.agentId },
        UpdateExpression: "SET #status = :online, inconsistencyFixedAt = :now REMOVE currentCallId, callStatus, heldCallId, heldCallMeetingId",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":online": "Online",
          ":now": (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
      console.log(`[ConsistencyChecker] Reconciled: Cleaned up agent ${agent.agentId}`);
      report.reconciled++;
    } catch (err) {
      console.error(`[ConsistencyChecker] Failed to reconcile missing call for ${agent.agentId}:`, err);
      report.errors.push(`Failed to clean up agent ${agent.agentId}: ${err.message}`);
    }
  }
  /**
   * Reconcile: Agent has call but call is assigned to different agent
   */
  async reconcileAgentMismatch(agent, call, inconsistency, report) {
    if (call.status === "connected" && call.assignedAgentId) {
      try {
        await this.ddb.send(new import_lib_dynamodb3.UpdateCommand({
          TableName: this.agentTable,
          Key: { agentId: agent.agentId },
          UpdateExpression: "SET #status = :online, inconsistencyFixedAt = :now REMOVE currentCallId, callStatus, heldCallId, heldCallMeetingId",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":online": "Online",
            ":now": (/* @__PURE__ */ new Date()).toISOString()
          }
        }));
        console.log(`[ConsistencyChecker] Reconciled: Freed agent ${agent.agentId} (call assigned to ${call.assignedAgentId})`);
        report.reconciled++;
      } catch (err) {
        console.error(`[ConsistencyChecker] Failed to reconcile agent mismatch:`, err);
        report.errors.push(`Failed to fix agent mismatch for ${agent.agentId}: ${err.message}`);
      }
    } else if (call.status === "completed" || call.status === "abandoned") {
      try {
        await this.ddb.send(new import_lib_dynamodb3.UpdateCommand({
          TableName: this.agentTable,
          Key: { agentId: agent.agentId },
          UpdateExpression: "SET #status = :online, inconsistencyFixedAt = :now REMOVE currentCallId, callStatus, heldCallId, heldCallMeetingId",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":online": "Online",
            ":now": (/* @__PURE__ */ new Date()).toISOString()
          }
        }));
        console.log(`[ConsistencyChecker] Reconciled: Freed agent ${agent.agentId} (call ${call.status})`);
        report.reconciled++;
      } catch (err) {
        console.error(`[ConsistencyChecker] Failed to clean up finished call:`, err);
        report.errors.push(`Failed to clean up agent ${agent.agentId}: ${err.message}`);
      }
    } else {
      const issue = `Cannot auto-reconcile agent ${agent.agentId} / call ${call.callId} (call status: ${call.status}, assigned: ${call.assignedAgentId})`;
      console.warn(`[ConsistencyChecker] ${issue}`);
      report.manualReviewNeeded.push(issue);
    }
  }
  /**
   * Reconcile: Agent and call have different status
   */
  async reconcileStatusMismatch(agent, call, inconsistency, report) {
    try {
      await this.ddb.send(new import_lib_dynamodb3.UpdateCommand({
        TableName: this.agentTable,
        Key: { agentId: agent.agentId },
        UpdateExpression: "SET callStatus = :status, statusSyncedAt = :now",
        ExpressionAttributeValues: {
          ":status": call.status,
          ":now": (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
      console.log(`[ConsistencyChecker] Reconciled: Updated agent ${agent.agentId} status from ${agent.callStatus} to ${call.status}`);
      report.reconciled++;
    } catch (err) {
      console.error(`[ConsistencyChecker] Failed to sync status:`, err);
      report.errors.push(`Failed to sync status for ${agent.agentId}: ${err.message}`);
    }
  }
  /**
   * Check a specific agent on demand
   */
  async checkSpecificAgent(agentId) {
    const { Item: agent } = await this.ddb.send(new import_lib_dynamodb3.GetCommand({
      TableName: this.agentTable,
      Key: { agentId }
    }));
    if (!agent || !agent.currentCallId && !agent.heldCallId) {
      return null;
    }
    const report = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      totalChecked: 1,
      inconsistenciesFound: 0,
      reconciled: 0,
      manualReviewNeeded: [],
      errors: []
    };
    await this.checkAgent(agent, report);
    return report.inconsistenciesFound > 0 ? {
      type: "ORPHANED_AGENT",
      agentId,
      description: `Found ${report.inconsistenciesFound} inconsistencies`
    } : null;
  }
};

// src/services/chime/utils/state-timeouts.ts
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_meetings2 = require("@aws-sdk/client-chime-sdk-meetings");
var STATE_TIMEOUTS = {
  ringing: 2 * 60,
  // 2 minutes max ringing
  dialing: 1 * 60,
  // 1 minute max dialing
  queued: 24 * 60 * 60,
  // 24 hours in queue
  transferring: 30,
  // 30 seconds for transfer
  on_hold: 60 * 60
  // 1 hour max hold
};
var StateTimeoutManager = class {
  constructor(ddb2, chime2, callQueueTable, agentPresenceTable) {
    this.ddb = ddb2;
    this.chime = chime2;
    this.callQueueTable = callQueueTable;
    this.agentPresenceTable = agentPresenceTable;
  }
  /**
   * Check all timeout-prone states and transition expired calls
   */
  async checkAndTransitionTimedOutStates() {
    const result = { transitioned: 0, errors: [] };
    const now = Date.now();
    for (const [state, timeoutSeconds] of Object.entries(STATE_TIMEOUTS)) {
      try {
        const count = await this.transitionTimedOutCalls(state, timeoutSeconds, now);
        result.transitioned += count;
      } catch (err) {
        result.errors.push(`Failed to transition ${state}: ${err.message}`);
      }
    }
    return result;
  }
  /**
   * Find and transition calls in a specific state that have timed out
   */
  async transitionTimedOutCalls(state, timeoutSeconds, now) {
    const cutoffTime = new Date(now - timeoutSeconds * 1e3).toISOString();
    const { Items: calls } = await this.ddb.send(new import_lib_dynamodb4.QueryCommand({
      TableName: this.callQueueTable,
      IndexName: "status-lastStateChange-index",
      KeyConditionExpression: "#status = :state AND lastStateChange < :cutoff",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":state": state,
        ":cutoff": cutoffTime
      }
    }));
    if (!calls || calls.length === 0)
      return 0;
    let transitionCount = 0;
    for (const call of calls) {
      try {
        await this.transitionCall(call, state);
        transitionCount++;
      } catch (err) {
        console.error(`[StateTimeout] Failed to transition call ${call.callId}:`, err);
      }
    }
    return transitionCount;
  }
  /**
   * Transition a single call based on its current state
   */
  async transitionCall(call, fromState) {
    let newState;
    let reason;
    switch (fromState) {
      case "ringing":
        newState = "abandoned";
        reason = "no_answer_timeout";
        await this.cleanupRingingAgents(call);
        break;
      case "dialing":
        newState = "failed";
        reason = "dial_timeout";
        break;
      case "queued":
        newState = "abandoned";
        reason = "queue_timeout";
        await this.cleanupQueuedMeeting(call);
        break;
      case "transferring":
        newState = "connected";
        reason = "transfer_timeout";
        await this.rollbackFailedTransfer(call);
        break;
      case "on_hold":
        newState = "abandoned";
        reason = "hold_timeout";
        await this.cleanupHeldCall(call);
        break;
      default:
        console.warn(`[StateTimeout] Unknown state: ${fromState}`);
        return;
    }
    await this.ddb.send(new import_lib_dynamodb4.UpdateCommand({
      TableName: this.callQueueTable,
      Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
      UpdateExpression: "SET #status = :newStatus, previousStatus = :oldStatus, statusTransitionReason = :reason, statusTransitionedAt = :now, autoTransitioned = :true",
      ConditionExpression: "#status = :oldStatus",
      // Prevent race with manual transition
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":newStatus": newState,
        ":oldStatus": fromState,
        ":reason": reason,
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":true": true
      }
    }));
    console.log(`[StateTimeout] Transitioned call ${call.callId}: ${fromState} -> ${newState} (${reason})`);
  }
  /**
   * Clean up agents stuck in ringing state for this call
   */
  async cleanupRingingAgents(call) {
    if (!call.agentIds || call.agentIds.length === 0)
      return;
    const cleanupPromises = call.agentIds.map(async (agentId) => {
      try {
        await this.ddb.send(new import_lib_dynamodb4.UpdateCommand({
          TableName: this.agentPresenceTable,
          Key: { agentId },
          UpdateExpression: "SET #status = :online, lastActivityAt = :now REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId",
          ConditionExpression: "ringingCallId = :callId",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":online": "Online",
            ":now": (/* @__PURE__ */ new Date()).toISOString(),
            ":callId": call.callId
          }
        }));
      } catch (err) {
        if (err.name !== "ConditionalCheckFailedException") {
          console.error(`[StateTimeout] Error cleaning agent ${agentId}:`, err);
        }
      }
    });
    await Promise.allSettled(cleanupPromises);
  }
  /**
   * Clean up meeting for queued call that timed out
   */
  async cleanupQueuedMeeting(call) {
    if (!call.meetingInfo?.MeetingId)
      return;
    try {
      await this.chime.send(new import_client_chime_sdk_meetings2.DeleteMeetingCommand({
        MeetingId: call.meetingInfo.MeetingId
      }));
    } catch (err) {
      if (err.name !== "NotFoundException") {
        console.error(`[StateTimeout] Error deleting meeting:`, err);
      }
    }
  }
  /**
   * Rollback failed transfer - return call to original agent
   */
  async rollbackFailedTransfer(call) {
    if (!call.assignedAgentId || !call.transferToAgentId)
      return;
    await this.ddb.send(new import_lib_dynamodb4.UpdateCommand({
      TableName: this.agentPresenceTable,
      Key: { agentId: call.transferToAgentId },
      UpdateExpression: "REMOVE incomingTransferId, incomingTransferFrom, incomingTransferCallId",
      ConditionExpression: "incomingTransferId = :transferId",
      ExpressionAttributeValues: {
        ":transferId": call.transferId
      }
    })).catch(() => {
    });
    await this.ddb.send(new import_lib_dynamodb4.UpdateCommand({
      TableName: this.agentPresenceTable,
      Key: { agentId: call.assignedAgentId },
      UpdateExpression: "REMOVE transferringCallId, transferStatus"
    })).catch(() => {
    });
  }
  /**
   * Clean up held call that was abandoned
   */
  async cleanupHeldCall(call) {
    if (call.heldByAgentId) {
      await this.ddb.send(new import_lib_dynamodb4.UpdateCommand({
        TableName: this.agentPresenceTable,
        Key: { agentId: call.heldByAgentId },
        UpdateExpression: "SET #status = :online REMOVE heldCallId, heldCallMeetingId, callStatus",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":online": "Online" }
      })).catch(() => {
      });
    }
  }
};

// src/services/chime/cleanup-monitor.ts
var ddb = getDynamoDBClient();
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chime = new import_client_chime_sdk_meetings3.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
var chimeVoice = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var meetingLifecycle = new MeetingLifecycleManager(ddb, chime, CALL_QUEUE_TABLE_NAME);
var consistencyChecker = new ConsistencyChecker(ddb, AGENT_PRESENCE_TABLE_NAME, CALL_QUEUE_TABLE_NAME);
var stateTimeoutManager = new StateTimeoutManager(ddb, chime, CALL_QUEUE_TABLE_NAME, AGENT_PRESENCE_TABLE_NAME);
var STALE_HEARTBEAT_MINUTES = 15;
var STALE_RINGING_DIALING_MINUTES = 5;
var ABANDONED_RINGING_CALL_MINUTES = 10;
var MAX_CONNECTED_CALL_MINUTES = 60;
var AUTO_HANGUP_COOLDOWN_MS = 5 * 60 * 1e3;
var handler = async (event) => {
  console.log("[cleanup-monitor] Starting cleanup monitor run", {
    time: (/* @__PURE__ */ new Date()).toISOString(),
    eventSource: event.source
  });
  let cleanupStats = {
    staleAgents: 0,
    orphanedMeetings: 0,
    abandonedCalls: 0,
    longRunningHangups: 0,
    stateTimeouts: 0,
    errors: 0
  };
  try {
    await cleanupStaleAgentPresence(cleanupStats);
    try {
      const meetingResult = await meetingLifecycle.cleanupOrphanedMeetings();
      cleanupStats.orphanedMeetings = meetingResult.cleanedCount;
      console.log("[cleanup-monitor] Meeting lifecycle cleanup:", meetingResult);
    } catch (meetingErr) {
      console.error("[cleanup-monitor] Meeting lifecycle error:", meetingErr);
      cleanupStats.errors++;
    }
    await cleanupAbandonedCalls(cleanupStats);
    await cleanupLongRunningCalls(cleanupStats);
    try {
      const consistencyReport = await consistencyChecker.checkAndReconcile();
      console.log("[cleanup-monitor] Consistency check:", {
        checked: consistencyReport.totalChecked,
        found: consistencyReport.inconsistenciesFound,
        reconciled: consistencyReport.reconciled,
        manualReview: consistencyReport.manualReviewNeeded.length
      });
      if (consistencyReport.inconsistenciesFound > 10) {
        console.warn(
          "[cleanup-monitor] HIGH INCONSISTENCY COUNT detected:",
          consistencyReport.inconsistenciesFound
        );
      }
    } catch (consistencyErr) {
      console.error("[cleanup-monitor] Consistency check error:", consistencyErr);
      cleanupStats.errors++;
    }
    try {
      const stateTimeoutResult = await stateTimeoutManager.checkAndTransitionTimedOutStates();
      cleanupStats.stateTimeouts = stateTimeoutResult.transitioned;
      console.log("[cleanup-monitor] State timeout check:", {
        transitioned: stateTimeoutResult.transitioned,
        errors: stateTimeoutResult.errors.length
      });
      if (stateTimeoutResult.errors.length > 0) {
        console.error("[cleanup-monitor] State timeout errors:", stateTimeoutResult.errors);
      }
    } catch (stateTimeoutErr) {
      console.error("[cleanup-monitor] State timeout check error:", stateTimeoutErr);
      cleanupStats.errors++;
    }
    console.log("[cleanup-monitor] Cleanup completed", cleanupStats);
  } catch (error) {
    console.error("[cleanup-monitor] Error during cleanup:", error);
    cleanupStats.errors++;
  }
};
async function cleanupStaleAgentPresence(stats) {
  console.log("[cleanup-monitor] Checking for stale agent presence records");
  if (!AGENT_PRESENCE_TABLE_NAME) {
    console.warn("[cleanup-monitor] AGENT_PRESENCE_TABLE_NAME not configured");
    return;
  }
  try {
    const now = /* @__PURE__ */ new Date();
    const staleHeartbeatCutoff = new Date(now.getTime() - STALE_HEARTBEAT_MINUTES * 60 * 1e3).toISOString();
    const staleRingDialCutoff = new Date(now.getTime() - STALE_RINGING_DIALING_MINUTES * 60 * 1e3).toISOString();
    console.log(`[cleanup-monitor] Using cutoffs: Heartbeat < ${staleHeartbeatCutoff}, Ring/Dial < ${staleRingDialCutoff}`);
    const { Items: staleAgents } = await ddb.send(new import_lib_dynamodb5.ScanCommand({
      TableName: AGENT_PRESENCE_TABLE_NAME,
      FilterExpression: "(#s = :online AND lastHeartbeatAt < :heartbeatCutoff) OR (#s = :ringing AND ringingCallTime < :ringDialCutoff) OR (#s = :dialing AND lastActivityAt < :ringDialCutoff)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":online": "Online",
        ":ringing": "ringing",
        ":dialing": "dialing",
        ":heartbeatCutoff": staleHeartbeatCutoff,
        ":ringDialCutoff": staleRingDialCutoff
      }
    }));
    if (staleAgents && staleAgents.length > 0) {
      console.log(`[cleanup-monitor] Found ${staleAgents.length} stale agent presence records`);
      await batchCleanupStaleAgents(staleAgents, stats);
    } else {
      console.log("[cleanup-monitor] No stale agent presence records found");
    }
  } catch (error) {
    console.error("[cleanup-monitor] Error during stale agent cleanup:", error);
    stats.errors++;
  }
}
async function cleanupLongRunningCalls(stats) {
  console.log(`[cleanup-monitor] Checking for active calls exceeding ${MAX_CONNECTED_CALL_MINUTES} minutes`);
  if (!CALL_QUEUE_TABLE_NAME) {
    console.warn("[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured");
    return;
  }
  try {
    const { Items: activeCalls } = await ddb.send(new import_lib_dynamodb5.ScanCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      FilterExpression: "#s = :connected OR #s = :onHold",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":connected": "connected",
        ":onHold": "on_hold"
      }
    }));
    if (!activeCalls || activeCalls.length === 0) {
      console.log("[cleanup-monitor] No connected/on-hold calls found");
      return;
    }
    const nowMs = Date.now();
    const thresholdMs = MAX_CONNECTED_CALL_MINUTES * 60 * 1e3;
    let forcedCalls = 0;
    for (const call of activeCalls) {
      const acceptedTimestamp = parseTimestampMs(call.acceptedAt ?? call.acceptedAtIso);
      if (!acceptedTimestamp) {
        continue;
      }
      const callAgeMs = nowMs - acceptedTimestamp;
      if (callAgeMs < thresholdMs) {
        continue;
      }
      if (hasRecentAutoHangupRequest(call, nowMs)) {
        continue;
      }
      await requestHangupForCall(call, callAgeMs, stats);
      forcedCalls++;
    }
    if (forcedCalls === 0) {
      console.log("[cleanup-monitor] No calls exceeded the max duration threshold");
    }
  } catch (error) {
    console.error("[cleanup-monitor] Error while checking for long running calls:", error);
    stats.errors++;
  }
}
async function requestHangupForCall(callRecord, callAgeMs, stats) {
  if (!CALL_QUEUE_TABLE_NAME) {
    console.warn("[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured");
    return;
  }
  const callId = callRecord.callId;
  const clinicId = callRecord.clinicId;
  const queuePosition = callRecord.queuePosition;
  if (!callId || !clinicId || typeof queuePosition === "undefined") {
    console.warn("[cleanup-monitor] Incomplete call record. Unable to request hangup.", {
      callId,
      clinicId,
      queuePosition
    });
    return;
  }
  const smaId = getSmaIdForClinic(clinicId);
  if (!smaId) {
    console.warn(`[cleanup-monitor] No SMA mapping for clinic ${clinicId}. Cannot hang up call ${callId}`);
    return;
  }
  const minutes = (callAgeMs / 6e4).toFixed(1);
  console.log(`[cleanup-monitor] Auto hanging call ${callId} for clinic ${clinicId} after ${minutes} minutes`, {
    assignedAgentId: callRecord.assignedAgentId,
    status: callRecord.status
  });
  try {
    await chimeVoice.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
      SipMediaApplicationId: smaId,
      TransactionId: callId,
      Arguments: {
        Action: "Hangup"
      }
    }));
  } catch (error) {
    console.error(`[cleanup-monitor] Failed to submit hangup for call ${callId}:`, error);
    stats.errors++;
    return;
  }
  try {
    await ddb.send(new import_lib_dynamodb5.UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: {
        clinicId,
        queuePosition
      },
      UpdateExpression: "SET cleanupReason = :reason, autoHangupRequestedAt = :now, autoHangupDurationSeconds = :duration",
      ExpressionAttributeValues: {
        ":reason": "auto_hangup_max_duration",
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":duration": Math.floor(callAgeMs / 1e3)
      }
    }));
  } catch (annotationErr) {
    console.warn(`[cleanup-monitor] Unable to annotate call ${callId} after auto hangup:`, annotationErr);
  }
  stats.longRunningHangups++;
}
function parseTimestampMs(value) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  if (typeof value === "number") {
    return value > 1e12 ? value : value * 1e3;
  }
  return void 0;
}
function hasRecentAutoHangupRequest(callRecord, nowMs) {
  const requestedAt = parseTimestampMs(callRecord.autoHangupRequestedAt);
  if (requestedAt === void 0) {
    return false;
  }
  return nowMs - requestedAt < AUTO_HANGUP_COOLDOWN_MS;
}
async function cleanupAbandonedCalls(stats) {
  console.log("[cleanup-monitor] Checking for abandoned ringing/dialing calls");
  if (!CALL_QUEUE_TABLE_NAME) {
    console.warn("[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured");
    return;
  }
  try {
    const cutoffISOString = new Date(Date.now() - ABANDONED_RINGING_CALL_MINUTES * 60 * 1e3).toISOString();
    console.log(`[cleanup-monitor] Using abandoned call cutoff: ${cutoffISOString}`);
    const { Items: abandonedCalls } = await ddb.send(new import_lib_dynamodb5.ScanCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      FilterExpression: "(#s = :ringing OR #s = :dialing) AND queueEntryTimeIso < :cutoff",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":ringing": "ringing",
        ":dialing": "dialing",
        ":cutoff": cutoffISOString
      }
    }));
    if (abandonedCalls && abandonedCalls.length > 0) {
      console.log(`[cleanup-monitor] Found ${abandonedCalls.length} abandoned calls`);
      for (const call of abandonedCalls) {
        try {
          await ddb.send(new import_lib_dynamodb5.UpdateCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: {
              clinicId: call.clinicId,
              queuePosition: call.queuePosition
            },
            UpdateExpression: "SET #s = :abandoned, endedAtIso = :now, cleanupReason = :reason",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
              ":abandoned": "abandoned",
              ":now": (/* @__PURE__ */ new Date()).toISOString(),
              ":reason": `abandoned_${call.status}_cleanup`
            }
          }));
          const agentIdsToClear = [];
          if (call.status === "dialing" && call.assignedAgentId) {
            agentIdsToClear.push(call.assignedAgentId);
          } else if (call.status === "ringing" && Array.isArray(call.agentIds)) {
            agentIdsToClear.push(...call.agentIds);
          }
          for (const agentId of agentIdsToClear) {
            try {
              const updateExpr = call.status === "dialing" ? "SET #s = :online, lastActivityAt = :now REMOVE currentCallId, callStatus" : "SET #s = :online, lastActivityAt = :now REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode";
              await ddb.send(new import_lib_dynamodb5.UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: updateExpr,
                ConditionExpression: call.status === "dialing" ? "currentCallId = :callId" : "ringingCallId = :callId",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: {
                  ":callId": call.callId,
                  ":online": "Online",
                  ":now": (/* @__PURE__ */ new Date()).toISOString()
                }
              }));
              console.log(`[cleanup-monitor] Reset agent ${agentId} from stuck call ${call.callId}`);
            } catch (agentErr) {
              if (agentErr.name !== "ConditionalCheckFailedException") {
                console.warn(`[cleanup-monitor] Error clearing ringing/dialing agent ${agentId}:`, agentErr);
              }
            }
          }
          stats.abandonedCalls++;
          console.log(`[cleanup-monitor] Cleaned up abandoned call: ${call.callId} (was ${call.status})`);
        } catch (callErr) {
          console.error(`[cleanup-monitor] Error cleaning up abandoned call ${call.callId}:`, callErr);
          stats.errors++;
        }
      }
    } else {
      console.log("[cleanup-monitor] No abandoned calls found");
    }
  } catch (error) {
    console.error("[cleanup-monitor] Error during abandoned call cleanup:", error);
    stats.errors++;
  }
}
async function batchCleanupStaleAgents(staleAgents, stats) {
  if (!AGENT_PRESENCE_TABLE_NAME) {
    console.warn("[cleanup-monitor] AGENT_PRESENCE_TABLE_NAME not configured");
    return;
  }
  const BATCH_SIZE = 25;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (let i = 0; i < staleAgents.length; i += BATCH_SIZE) {
    const batch = staleAgents.slice(i, i + BATCH_SIZE);
    try {
      const updatePromises = batch.map(
        (agent) => ddb.send(new import_lib_dynamodb5.UpdateCommand({
          TableName: AGENT_PRESENCE_TABLE_NAME,
          Key: { agentId: agent.agentId },
          UpdateExpression: "SET #s = :offline, lastActivityAt = :now, cleanupReason = :reason REMOVE ringingCallId, currentCallId, callStatus, inboundMeetingInfo, inboundAttendeeInfo, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode, currentMeetingAttendeeId, heldCallMeetingId, heldCallId, heldCallAttendeeId",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":offline": "Offline",
            ":now": now,
            ":reason": `stale_${agent.status}_cleanup`
          }
        })).then(() => ({ success: true, agentId: agent.agentId })).catch((err) => ({ success: false, agentId: agent.agentId, error: err.message }))
      );
      const results = await Promise.all(updatePromises);
      const successCount = results.filter((r) => r.success).length;
      const failedResults = results.filter((r) => !r.success);
      stats.staleAgents += successCount;
      if (failedResults.length > 0) {
        console.warn(
          `[cleanup-monitor] ${failedResults.length} agent updates failed in batch:`,
          failedResults.map((r) => ({ agentId: r.agentId, error: r.error }))
        );
        stats.errors += failedResults.length;
      }
      console.log(`[cleanup-monitor] Batch cleaned ${successCount}/${batch.length} stale agents (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
    } catch (batchErr) {
      console.error(`[cleanup-monitor] Error cleaning batch of agents starting at index ${i}:`, batchErr);
      stats.errors += batch.length;
    }
  }
  console.log(`[cleanup-monitor] Completed cleanup of ${stats.staleAgents} stale agents in ${Math.ceil(staleAgents.length / BATCH_SIZE)} batches`);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

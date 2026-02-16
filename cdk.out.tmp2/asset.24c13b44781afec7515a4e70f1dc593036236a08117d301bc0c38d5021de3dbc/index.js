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

// src/services/connect/lex-bedrock-hook.ts
var lex_bedrock_hook_exports = {};
__export(lex_bedrock_hook_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(lex_bedrock_hook_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");

// node_modules/uuid/dist/esm-node/rng.js
var import_crypto = __toESM(require("crypto"));
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    import_crypto.default.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

// node_modules/uuid/dist/esm-node/native.js
var import_crypto2 = __toESM(require("crypto"));
var native_default = {
  randomUUID: import_crypto2.default.randomUUID
};

// node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// src/services/shared/utils/transcript-buffer-manager.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

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
  constructor(ddb, tableName) {
    this.ddb = ddb;
    this.tableName = tableName;
  }
  /**
   * Initialize a new transcript buffer for a call
   */
  async initialize(callId) {
    const now = toUnixSeconds(Date.now());
    const ttl = nowPlusSeconds(3600);
    try {
      await this.ddb.send(new import_lib_dynamodb.PutCommand({
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
          await this.ddb.send(new import_lib_dynamodb.UpdateCommand({
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
      await this.ddb.send(new import_lib_dynamodb.UpdateCommand({
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
      const result = await this.ddb.send(new import_lib_dynamodb.GetCommand({
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
      const result = await this.ddb.send(new import_lib_dynamodb.GetCommand({
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
      await this.ddb.send(new import_lib_dynamodb.UpdateCommand({
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
      await this.ddb.send(new import_lib_dynamodb.DeleteCommand({
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
      await this.ddb.send(new import_lib_dynamodb.UpdateCommand({
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

// src/services/connect/lex-bedrock-hook.ts
var CONFIG = {
  // Analytics retention (90 days TTL, aligned with Chime analytics)
  ANALYTICS_TTL_DAYS: 90,
  // Bedrock timeout
  BEDROCK_TIMEOUT_MS: 25e3,
  // 25 seconds (leaves buffer for Lambda timeout)
  // Max retries for analytics writes
  ANALYTICS_MAX_RETRIES: 2,
  ANALYTICS_RETRY_DELAY_MS: 50
};
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb2.DynamoDBDocumentClient.from(dynamoClient);
var bedrockAgentClient = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var CALL_ANALYTICS_TABLE = process.env.CALL_ANALYTICS_TABLE || "";
var TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME || "";
var SESSIONS_TABLE = process.env.SESSIONS_TABLE || "AiAgentSessions";
var TRANSCRIPTION_CONFIDENCE_THRESHOLD = Number(process.env.TRANSCRIPTION_CONFIDENCE_THRESHOLD || "0.6");
var CONNECT_LAMBDA_HARD_LIMIT_MS = 8e3;
var CONNECT_SAFE_MAX_BEDROCK_TIMEOUT_MS = CONNECT_LAMBDA_HARD_LIMIT_MS - 800;
var CONNECT_BEDROCK_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CONNECT_BEDROCK_TIMEOUT_MS || "7200");
  const n = Number.isFinite(raw) ? raw : 7200;
  return Math.max(1e3, Math.min(n, CONNECT_SAFE_MAX_BEDROCK_TIMEOUT_MS));
})();
var CONNECT_SAFE_MAX_STREAMING_LOOP_MS = CONNECT_LAMBDA_HARD_LIMIT_MS - 500;
var AI_PHONE_NUMBERS_JSON = process.env.AI_PHONE_NUMBERS_JSON || "{}";
var aiPhoneNumberMap = {};
try {
  aiPhoneNumberMap = JSON.parse(AI_PHONE_NUMBERS_JSON);
} catch (e) {
  console.warn("[LexBedrockHook] Failed to parse AI_PHONE_NUMBERS_JSON:", e);
}
var DEFAULT_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || "dentistingreenville";
var transcriptManager = null;
if (TRANSCRIPT_BUFFER_TABLE) {
  transcriptManager = new TranscriptBufferManager(docClient, TRANSCRIPT_BUFFER_TABLE);
}
var agentCache = /* @__PURE__ */ new Map();
var AGENT_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getAgentForClinic(clinicId) {
  const cached = agentCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }
  try {
    const allAgents = await docClient.send(new import_lib_dynamodb2.QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: "ClinicIndex",
      KeyConditionExpression: "clinicId = :clinicId",
      ExpressionAttributeValues: {
        ":clinicId": clinicId
      },
      Limit: 20,
      ScanIndexForward: false
      // Most recent first
    }));
    if (!allAgents.Items || allAgents.Items.length === 0) {
      agentCache.set(clinicId, { agent: null, timestamp: Date.now() });
      return null;
    }
    let selectedAgent = null;
    const defaultVoice = allAgents.Items.find(
      (a) => a.isDefaultVoiceAgent === true && a.isVoiceEnabled === true
    );
    if (defaultVoice) {
      selectedAgent = defaultVoice;
      console.log("[LexBedrockHook] Selected default voice agent:", {
        clinicId,
        agentId: selectedAgent.agentId,
        agentName: selectedAgent.agentName || selectedAgent.name
      });
    }
    if (!selectedAgent) {
      const voiceEnabled = allAgents.Items.find((a) => a.isVoiceEnabled === true);
      if (voiceEnabled) {
        selectedAgent = voiceEnabled;
        console.log("[LexBedrockHook] Selected voice-enabled agent:", {
          clinicId,
          agentId: selectedAgent.agentId,
          agentName: selectedAgent.agentName || selectedAgent.name
        });
      }
    }
    if (!selectedAgent) {
      selectedAgent = allAgents.Items[0];
      console.log("[LexBedrockHook] Using fallback agent (any type):", selectedAgent.agentId || selectedAgent.agentName);
    }
    const agentInfo = {
      agentId: selectedAgent.bedrockAgentId,
      aliasId: selectedAgent.bedrockAliasId || "TSTALIASID",
      agentName: selectedAgent.agentName || selectedAgent.name
    };
    agentCache.set(clinicId, { agent: agentInfo, timestamp: Date.now() });
    return agentInfo;
  } catch (error) {
    console.error("[LexBedrockHook] Error looking up agent:", error);
    return null;
  }
}
async function ensureAnalyticsRecord(params) {
  if (!CALL_ANALYTICS_TABLE) {
    console.warn("[LexBedrockHook] CALL_ANALYTICS_TABLE not configured, skipping analytics");
    return { callId: params.callId, timestamp: Date.now() };
  }
  const { callId, contactId, clinicId, callerNumber, aiAgentId, aiAgentName } = params;
  const now = Date.now();
  const ttl = Math.floor(now / 1e3) + CONFIG.ANALYTICS_TTL_DAYS * 24 * 60 * 60;
  try {
    const existing = await docClient.send(new import_lib_dynamodb2.QueryCommand({
      TableName: CALL_ANALYTICS_TABLE,
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    if (existing.Items && existing.Items.length > 0) {
      return { callId, timestamp: existing.Items[0].timestamp };
    }
  } catch (error) {
    console.warn("[LexBedrockHook] Error checking existing analytics:", error);
  }
  const analytics = {
    callId,
    timestamp: now,
    clinicId,
    callCategory: "ai_voice",
    callType: "inbound",
    callStatus: "active",
    outcome: "answered",
    callerNumber,
    aiAgentId,
    agentId: aiAgentId,
    // Alias for existing dashboards
    aiAgentName,
    analyticsSource: "connect_lex",
    contactId,
    turnCount: 0,
    transcriptCount: 0,
    lastActivityTime: new Date(now).toISOString(),
    toolsUsed: [],
    ttl
  };
  try {
    await docClient.send(new import_lib_dynamodb2.PutCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Item: analytics,
      ConditionExpression: "attribute_not_exists(callId)"
    }));
    console.log("[LexBedrockHook] Created analytics record:", { callId, clinicId });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      const result = await docClient.send(new import_lib_dynamodb2.QueryCommand({
        TableName: CALL_ANALYTICS_TABLE,
        KeyConditionExpression: "callId = :callId",
        ExpressionAttributeValues: { ":callId": callId },
        Limit: 1
      }));
      if (result.Items && result.Items.length > 0) {
        return { callId, timestamp: result.Items[0].timestamp };
      }
    }
    console.error("[LexBedrockHook] Error creating analytics record:", error);
  }
  return { callId, timestamp: now };
}
async function updateAnalyticsTurn(params) {
  if (!CALL_ANALYTICS_TABLE)
    return;
  const { callId, timestamp, callerUtterance, aiResponse, toolsUsed } = params;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const setItems = [
      "lastActivityTime = :now",
      "lastCallerUtterance = :caller",
      "lastAiResponse = :ai"
    ];
    const exprValues = {
      ":now": now,
      ":caller": callerUtterance.substring(0, 500),
      // Truncate for storage
      ":ai": aiResponse.substring(0, 1e3),
      ":one": 1,
      ":two": 2
      // One for caller, one for AI
    };
    if (toolsUsed && toolsUsed.length > 0) {
      setItems.push("toolsUsed = list_append(if_not_exists(toolsUsed, :emptyList), :tools)");
      exprValues[":emptyList"] = [];
      exprValues[":tools"] = toolsUsed.slice(0, 10);
    }
    const updateExpr = `SET ${setItems.join(", ")} ADD turnCount :one, transcriptCount :two`;
    await docClient.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE,
      Key: { callId, timestamp },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues
    }));
  } catch (error) {
    console.error("[LexBedrockHook] Error updating analytics turn:", error);
  }
}
async function addTranscriptTurn(params) {
  if (!transcriptManager) {
    console.warn("[LexBedrockHook] TranscriptBufferManager not configured");
    return;
  }
  const { callId, callerUtterance, aiResponse, callStartMs, confidence } = params;
  const nowMs = Date.now();
  const callerStartTime = (nowMs - callStartMs) / 1e3;
  const callerEndTime = callerStartTime + 0.5;
  const aiStartTime = callerEndTime + 0.1;
  const aiEndTime = aiStartTime + aiResponse.length / 15;
  try {
    await transcriptManager.initialize(callId);
    const customerSegment = {
      content: callerUtterance,
      startTime: callerStartTime,
      endTime: callerEndTime,
      speaker: "CUSTOMER",
      confidence: confidence || 0.9
    };
    await transcriptManager.addSegment(callId, customerSegment);
    const agentSegment = {
      content: aiResponse,
      startTime: aiStartTime,
      endTime: aiEndTime,
      speaker: "AGENT",
      confidence: 1
      // AI response is always 100% confidence
    };
    await transcriptManager.addSegment(callId, agentSegment);
    console.log("[LexBedrockHook] Added transcript segments:", { callId, callerLen: callerUtterance.length, aiLen: aiResponse.length });
  } catch (error) {
    console.error("[LexBedrockHook] Error adding transcript segments:", error);
  }
}
async function getOrCreateSession(lexSessionId, clinicId, callerNumber) {
  const sessionKey = `lex-${lexSessionId}`;
  try {
    const existing = await docClient.send(new import_lib_dynamodb2.GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: sessionKey }
    }));
    if (existing.Item) {
      const updated = await docClient.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId: sessionKey },
        UpdateExpression: "SET lastActivity = :now, turnCount = if_not_exists(turnCount, :zero) + :one",
        ExpressionAttributeValues: {
          ":now": (/* @__PURE__ */ new Date()).toISOString(),
          ":zero": 0,
          ":one": 1
        },
        ReturnValues: "ALL_NEW"
      }));
      return updated.Attributes || existing.Item;
    }
  } catch (error) {
    console.warn("[LexBedrockHook] Error getting session:", error);
  }
  const agent = await getAgentForClinic(clinicId);
  if (!agent) {
    throw new Error(`No Bedrock agent configured for clinic: ${clinicId}`);
  }
  const now = Date.now();
  const ttl = Math.floor(now / 1e3) + 60 * 60;
  const session = {
    sessionId: sessionKey,
    callId: `connect-${lexSessionId}`,
    clinicId,
    aiAgentId: agent.agentId,
    aiAgentName: agent.agentName,
    bedrockSessionId: v4_default(),
    callStartMs: now,
    turnCount: 1,
    createdAt: new Date(now).toISOString(),
    lastActivity: new Date(now).toISOString(),
    callerNumber,
    ttl
  };
  try {
    await docClient.send(new import_lib_dynamodb2.PutCommand({
      TableName: SESSIONS_TABLE,
      Item: session
    }));
    console.log("[LexBedrockHook] Created new session:", { sessionId: sessionKey, clinicId, agentId: agent.agentId });
  } catch (error) {
    console.error("[LexBedrockHook] Error creating session:", error);
  }
  return session;
}
async function invokeBedrock(params) {
  const { agentId, aliasId, sessionId, inputText, clinicId, inputMode, channel, timeoutMs } = params;
  const isVoiceCall = channel === "voice";
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : CONFIG.BEDROCK_TIMEOUT_MS;
  const controller = new AbortController();
  const bedrockTimeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  const invocationStartMs = Date.now();
  const streamingLoopMaxMs = isVoiceCall ? Math.min(effectiveTimeoutMs + 250, CONNECT_SAFE_MAX_STREAMING_LOOP_MS) : effectiveTimeoutMs + 2e3;
  try {
    const command = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
      agentId,
      agentAliasId: aliasId,
      sessionId,
      inputText,
      sessionState: {
        sessionAttributes: {
          clinicId,
          // Pass input mode so agent knows to use voice-optimized responses
          inputMode: inputMode || "Text",
          channel: channel || (inputMode === "Speech" ? "voice" : "chat")
        }
      }
    });
    const response = await bedrockAgentClient.send(command, { abortSignal: controller.signal });
    let fullResponse = "";
    const toolsUsed = [];
    let streamingTimedOut = false;
    if (response.completion) {
      for await (const event of response.completion) {
        const elapsedMs = Date.now() - invocationStartMs;
        if (elapsedMs > streamingLoopMaxMs || controller.signal.aborted) {
          console.warn("[LexBedrockHook] Streaming loop timeout, returning partial response", {
            elapsedMs,
            maxMs: streamingLoopMaxMs,
            aborted: controller.signal.aborted,
            partialResponseLength: fullResponse.length
          });
          streamingTimedOut = true;
          break;
        }
        if (event.chunk?.bytes) {
          fullResponse += new TextDecoder().decode(event.chunk.bytes);
        }
        if (event.trace?.trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const actionGroup = event.trace.trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          if (actionGroup.function) {
            toolsUsed.push(actionGroup.function);
          }
        }
      }
    }
    if (streamingTimedOut && !fullResponse.trim()) {
      return {
        response: isVoiceCall ? "I'm sorry \u2014 I'm still working on that. Could you ask again in a moment?" : "I apologize, the request is taking longer than expected. Please try again.",
        toolsUsed: [...new Set(toolsUsed)]
      };
    }
    return {
      response: fullResponse.trim() || "I'm sorry, I couldn't generate a response. How else can I help you?",
      toolsUsed: [...new Set(toolsUsed)]
      // Dedupe
    };
  } catch (error) {
    const isAbort = controller.signal.aborted || error?.name === "AbortError" || error?.code === "ABORT_ERR";
    if (isAbort) {
      console.warn("[LexBedrockHook] Bedrock invocation timed out", {
        clinicId,
        timeoutMs: effectiveTimeoutMs,
        inputTextPreview: inputText.substring(0, 50)
      });
      return {
        response: isVoiceCall ? "I'm still looking that up. Could you please repeat what you just said?" : "I apologize, but I'm having trouble processing your request right now. Please try again.",
        toolsUsed: []
      };
    }
    console.error("[LexBedrockHook] Bedrock invocation error:", error);
    return {
      response: isVoiceCall ? "I'm sorry \u2014 I'm having trouble right now. Could you please try again?" : "I apologize, but I'm having trouble processing your request right now. Please try again or call back during office hours.",
      toolsUsed: []
    };
  } finally {
    clearTimeout(bedrockTimeout);
  }
}
function isConnectDirectEvent(event) {
  return event?.Details?.ContactData?.ContactId !== void 0;
}
var handler = async (event) => {
  console.log("[LexBedrockHook] Received event:", JSON.stringify(event, null, 2));
  if (isConnectDirectEvent(event)) {
    return handleConnectDirectEvent(event);
  }
  return handleLexEvent(event);
};
async function handleConnectDirectEvent(event) {
  const contactData = event.Details?.ContactData;
  const params = event.Details?.Parameters || {};
  const contactId = contactData?.ContactId || "";
  const inputTranscript = params["inputTranscript"] || "";
  const confidenceRaw = params["confidence"];
  const transcriptionConfidence = confidenceRaw !== void 0 && confidenceRaw !== "" ? Number(confidenceRaw) : 0.9;
  const safeConfidence = Number.isFinite(transcriptionConfidence) ? transcriptionConfidence : 0.9;
  const callerNumber = contactData?.CustomerEndpoint?.Address || "";
  const dialedNumber = contactData?.SystemEndpoint?.Address || "";
  const contactAttributes = contactData?.Attributes || {};
  let clinicId = contactAttributes["clinicId"] || "";
  if (!clinicId && dialedNumber) {
    const normalizedDialed = dialedNumber.replace(/\D/g, "");
    for (const [phone, clinic] of Object.entries(aiPhoneNumberMap)) {
      if (phone.replace(/\D/g, "") === normalizedDialed) {
        clinicId = clinic;
        break;
      }
    }
  }
  if (!clinicId) {
    clinicId = DEFAULT_CLINIC_ID;
    console.warn("[LexBedrockHook] Connect direct: No clinicId found, using default:", clinicId);
  }
  let session;
  try {
    session = await getOrCreateSession(contactId, clinicId, callerNumber);
  } catch (error) {
    console.error("[LexBedrockHook] Connect direct: Session creation failed:", error);
    return {
      aiResponse: "I'm sorry, I'm having trouble setting up our conversation. Please try again."
    };
  }
  await ensureAnalyticsRecord({
    callId: session.callId,
    contactId,
    clinicId: session.clinicId,
    callerNumber: session.callerNumber,
    aiAgentId: session.aiAgentId,
    aiAgentName: session.aiAgentName
  });
  const agent = await getAgentForClinic(clinicId);
  if (!agent) {
    console.error("[LexBedrockHook] Connect direct: No agent found for clinic:", clinicId);
    return {
      aiResponse: "I'm sorry, the AI assistant is not available right now. Please call back during office hours."
    };
  }
  const trimmedInput = inputTranscript.trim();
  const normalizedInput = trimmedInput.toLowerCase();
  const isTimeoutInput = normalizedInput === "timeout" || normalizedInput === "noinput" || normalizedInput === "no input" || normalizedInput === "inputtimelimitexceeded";
  if (!trimmedInput || isTimeoutInput) {
    return {
      aiResponse: "I'm sorry, I didn't catch that. Could you please repeat what you said?"
    };
  }
  if (safeConfidence < TRANSCRIPTION_CONFIDENCE_THRESHOLD) {
    console.warn("[LexBedrockHook] Connect direct: Low transcription confidence; prompting caller to repeat", {
      transcriptionConfidence: safeConfidence,
      threshold: TRANSCRIPTION_CONFIDENCE_THRESHOLD,
      inputTranscript
    });
    return {
      aiResponse: "I'm sorry, I didn't catch that clearly. Could you please repeat what you said?"
    };
  }
  const { response: aiResponse, toolsUsed } = await invokeBedrock({
    agentId: agent.agentId,
    aliasId: agent.aliasId,
    sessionId: session.bedrockSessionId,
    inputText: trimmedInput,
    clinicId,
    inputMode: "Speech",
    channel: "voice",
    timeoutMs: CONNECT_BEDROCK_TIMEOUT_MS
  });
  updateAnalyticsTurn({
    callId: session.callId,
    timestamp: session.callStartMs,
    callerUtterance: trimmedInput,
    aiResponse,
    toolsUsed
  }).catch((err) => console.error("[LexBedrockHook] Analytics update failed (non-blocking):", err));
  addTranscriptTurn({
    callId: session.callId,
    callerUtterance: trimmedInput,
    aiResponse,
    callStartMs: session.callStartMs,
    confidence: safeConfidence
  }).catch((err) => console.error("[LexBedrockHook] Transcript buffer update failed (non-blocking):", err));
  console.log("[LexBedrockHook] Connect direct: Returning response:", {
    clinicId,
    turnCount: session.turnCount,
    responseLength: aiResponse.length
  });
  return {
    aiResponse,
    ssmlResponse: `<speak>${escapeSSML(aiResponse)}</speak>`,
    clinicId,
    turnCount: String(session.turnCount)
  };
}
async function handleLexEvent(event) {
  const lexSessionId = event.sessionId;
  const inputTranscript = event.inputTranscript || "";
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const requestAttributes = event.requestAttributes || {};
  const transcriptionConfidence = event.transcriptions?.[0]?.transcriptionConfidence || 0.9;
  const isVoiceCall = event.inputMode === "Speech";
  let clinicId = sessionAttributes["clinicId"] || "";
  let callerNumber = requestAttributes["x-amz-lex:caller-number"] || sessionAttributes["callerNumber"] || "";
  const dialedNumber = requestAttributes["x-amz-lex:dialed-number"] || sessionAttributes["dialedNumber"] || "";
  if (!clinicId && dialedNumber) {
    const normalizedDialed = dialedNumber.replace(/\D/g, "");
    for (const [phone, clinic] of Object.entries(aiPhoneNumberMap)) {
      if (phone.replace(/\D/g, "") === normalizedDialed) {
        clinicId = clinic;
        break;
      }
    }
  }
  if (!clinicId) {
    clinicId = DEFAULT_CLINIC_ID;
    console.warn("[LexBedrockHook] No clinicId found, using default:", clinicId);
  }
  let session;
  try {
    session = await getOrCreateSession(lexSessionId, clinicId, callerNumber);
  } catch (error) {
    console.error("[LexBedrockHook] Session creation failed:", error);
    return buildErrorResponse(event, "I'm sorry, I'm having trouble setting up our conversation. Please try again.");
  }
  const analyticsInfo = await ensureAnalyticsRecord({
    callId: session.callId,
    contactId: lexSessionId,
    clinicId: session.clinicId,
    callerNumber: session.callerNumber,
    aiAgentId: session.aiAgentId,
    aiAgentName: session.aiAgentName
  });
  const agent = await getAgentForClinic(clinicId);
  if (!agent) {
    console.error("[LexBedrockHook] No agent found for clinic:", clinicId, {
      dialedNumber,
      defaultClinicId: DEFAULT_CLINIC_ID,
      hasPhoneMap: Object.keys(aiPhoneNumberMap || {}).length > 0
    });
    return buildErrorResponse(event, "I'm sorry, the AI assistant is not available right now. Please call back during office hours.");
  }
  const trimmedInput = inputTranscript.trim();
  if (!trimmedInput) {
    console.log("[LexBedrockHook] Empty input transcript, prompting user to repeat");
    return {
      sessionState: {
        sessionAttributes: {
          ...sessionAttributes,
          clinicId,
          callerNumber,
          callId: session.callId,
          turnCount: String(session.turnCount)
        },
        dialogAction: {
          type: "ElicitIntent"
        }
      },
      messages: [
        {
          contentType: "PlainText",
          content: "I'm sorry, I didn't catch that. Could you please repeat what you said?"
        }
      ]
    };
  }
  if (isVoiceCall && transcriptionConfidence < TRANSCRIPTION_CONFIDENCE_THRESHOLD) {
    console.warn("[LexBedrockHook] Low transcription confidence; prompting caller to repeat", {
      transcriptionConfidence,
      threshold: TRANSCRIPTION_CONFIDENCE_THRESHOLD,
      inputTranscript
    });
    return {
      sessionState: {
        sessionAttributes: {
          ...sessionAttributes,
          clinicId,
          callerNumber,
          callId: session.callId,
          turnCount: String(session.turnCount)
        },
        dialogAction: {
          type: "ElicitIntent"
        }
      },
      messages: [
        {
          contentType: "PlainText",
          content: "I'm sorry, I didn't catch that clearly. Could you please repeat what you said?"
        }
      ]
    };
  }
  const { response: aiResponse, toolsUsed } = await invokeBedrock({
    agentId: agent.agentId,
    aliasId: agent.aliasId,
    sessionId: session.bedrockSessionId,
    inputText: trimmedInput,
    clinicId,
    inputMode: event.inputMode,
    // 'Speech' for voice calls, 'Text' for chat
    channel: event.inputMode === "Speech" ? "voice" : "chat",
    timeoutMs: event.inputMode === "Speech" ? CONNECT_BEDROCK_TIMEOUT_MS : CONFIG.BEDROCK_TIMEOUT_MS
  });
  updateAnalyticsTurn({
    callId: session.callId,
    timestamp: analyticsInfo.timestamp,
    callerUtterance: trimmedInput,
    aiResponse,
    toolsUsed
  }).catch((err) => console.error("[LexBedrockHook] Lex analytics update failed (non-blocking):", err));
  addTranscriptTurn({
    callId: session.callId,
    callerUtterance: trimmedInput,
    aiResponse,
    callStartMs: session.callStartMs,
    confidence: transcriptionConfidence
  }).catch((err) => console.error("[LexBedrockHook] Lex transcript buffer update failed (non-blocking):", err));
  const nextSessionAttributes = {
    ...sessionAttributes,
    clinicId,
    callerNumber,
    callId: session.callId,
    turnCount: String(session.turnCount),
    // CRITICAL: Pass transcript to Connect via Lex session attributes
    // Connect reads this as $.Lex.SessionAttributes.lastUtterance
    lastUtterance: trimmedInput.substring(0, 1e3),
    lastUtteranceConfidence: String(transcriptionConfidence)
  };
  const response = {
    sessionState: {
      sessionAttributes: nextSessionAttributes,
      dialogAction: {
        type: "ElicitIntent"
        // Keep conversation going
      }
    },
    messages: [
      {
        contentType: "PlainText",
        content: aiResponse
      }
    ]
  };
  console.log("[LexBedrockHook] Returning response:", {
    clinicId,
    turnCount: session.turnCount,
    responseLength: aiResponse.length,
    lastUtteranceSet: !!nextSessionAttributes.lastUtterance
  });
  return response;
}
function escapeSSML(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function buildErrorResponse(event, message) {
  return {
    sessionState: {
      sessionAttributes: event.sessionState?.sessionAttributes || {},
      dialogAction: {
        // Keep the Lex session open so Connect doesn't immediately hang up.
        // This makes transient infra/config issues non-fatal to the phone call.
        type: "ElicitIntent"
      }
    },
    messages: [
      {
        contentType: "PlainText",
        content: message
      }
    ]
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

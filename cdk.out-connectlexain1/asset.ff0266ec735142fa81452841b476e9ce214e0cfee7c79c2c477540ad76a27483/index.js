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

// src/services/chime/ai-transcript-bridge.ts
var ai_transcript_bridge_exports = {};
__export(ai_transcript_bridge_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(ai_transcript_bridge_exports);
var import_client_dynamodb3 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_client_chime_sdk_voice2 = require("@aws-sdk/client-chime-sdk-voice");

// src/services/chime/utils/sma-map-ssm.ts
var import_client_ssm = require("@aws-sdk/client-ssm");
var ssm = new import_client_ssm.SSMClient({});
var cachedMap;
var cacheExpiry = 0;
var CACHE_TTL = 5 * 60 * 1e3;
async function fetchSmaMapFromSSM() {
  const now = Date.now();
  if (cachedMap && now < cacheExpiry) {
    return cachedMap;
  }
  const env = process.env.ENVIRONMENT || "dev";
  const stackName = process.env.CHIME_STACK_NAME || "ChimeStack";
  const paramPaths = [
    process.env.SMA_ID_MAP_PARAMETER,
    // Set by ChimeStack for AI Transcript Bridge
    `/${stackName}/SmaIdMap`,
    // ChimeStack CDK-created parameter
    `/contactcenter/${env}/sma-map`
    // Legacy/alternative configuration
  ].filter(Boolean);
  for (const paramName of paramPaths) {
    try {
      const result = await ssm.send(new import_client_ssm.GetParameterCommand({
        Name: paramName,
        WithDecryption: true
      }));
      if (result.Parameter?.Value) {
        cachedMap = JSON.parse(result.Parameter.Value);
        cacheExpiry = now + CACHE_TTL;
        console.log(`[sma-map] Loaded SMA map from SSM: ${paramName}`);
        return cachedMap || {};
      }
    } catch (err) {
      if (err.name === "ParameterNotFound") {
        console.log(`[sma-map] Parameter ${paramName} not found, trying next...`);
        continue;
      }
      console.warn(`[sma-map] Error loading ${paramName}:`, err.message);
    }
  }
  const envMap = process.env.SMA_ID_MAP;
  if (envMap) {
    try {
      cachedMap = JSON.parse(envMap);
      cacheExpiry = now + CACHE_TTL;
      console.warn("[sma-map] Using SMA_ID_MAP from environment variable (consider moving to SSM)");
      return cachedMap;
    } catch (err) {
      console.error("[sma-map] Failed to parse SMA_ID_MAP:", err);
    }
  }
  console.error("[sma-map] No SMA map configuration found. Tried SSM paths:", paramPaths.join(", "));
  return void 0;
}
async function getSmaIdForClinicSSM(clinicId) {
  if (!clinicId)
    return void 0;
  const map = await fetchSmaMapFromSSM();
  return map ? map[clinicId] : void 0;
}

// src/services/chime/utils/barge-in-detector.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chimeClient = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
var CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME || "";
var BARGE_IN_MIN_TRANSCRIPT_LENGTH = 5;
var BARGE_IN_COOLDOWN_MS = 2e3;
var AI_SPEAKING_MAX_DURATION_MS = 60 * 1e3;
var callSpeakingStates = /* @__PURE__ */ new Map();
function createBargeInDetector() {
  return {
    isAiSpeaking(callId) {
      const state = callSpeakingStates.get(callId);
      if (!state?.isAiSpeaking)
        return false;
      const now = Date.now();
      const speakingDuration = now - state.aiSpeakingStartTime;
      const maxDuration = state.expectedSpeechDurationMs || AI_SPEAKING_MAX_DURATION_MS;
      if (speakingDuration > maxDuration) {
        console.log("[BargeInDetector] AI speaking state auto-expired:", {
          callId,
          speakingDuration,
          maxDuration
        });
        state.isAiSpeaking = false;
        return false;
      }
      return true;
    },
    setAiSpeaking(callId, isSpeaking, expectedDurationMs) {
      let state = callSpeakingStates.get(callId);
      if (!state) {
        state = {
          isAiSpeaking: false,
          aiSpeakingStartTime: 0,
          lastBargeInTime: 0,
          pendingInterrupt: false
        };
        callSpeakingStates.set(callId, state);
      }
      state.isAiSpeaking = isSpeaking;
      if (isSpeaking) {
        state.aiSpeakingStartTime = Date.now();
        state.expectedSpeechDurationMs = expectedDurationMs;
      } else {
        state.expectedSpeechDurationMs = void 0;
      }
      console.log("[BargeInDetector] AI speaking state updated:", {
        callId,
        isAiSpeaking: isSpeaking,
        expectedDurationMs
      });
    },
    // FIX: Explicit method to clear speaking state after TTS completes
    clearSpeakingState(callId) {
      const state = callSpeakingStates.get(callId);
      if (state) {
        state.isAiSpeaking = false;
        state.expectedSpeechDurationMs = void 0;
        console.log("[BargeInDetector] Cleared speaking state for call:", callId);
      }
    },
    async onCallerSpeech(callId, clinicId, transcript) {
      const state = callSpeakingStates.get(callId);
      if (!this.isAiSpeaking(callId)) {
        return { shouldInterrupt: false, reason: "ai_not_speaking" };
      }
      if (transcript.trim().length < BARGE_IN_MIN_TRANSCRIPT_LENGTH) {
        return { shouldInterrupt: false, reason: "transcript_too_short" };
      }
      const now = Date.now();
      if (state && now - state.lastBargeInTime < BARGE_IN_COOLDOWN_MS) {
        return { shouldInterrupt: false, reason: "cooldown" };
      }
      console.log("[BargeInDetector] Barge-in detected:", {
        callId,
        transcript: transcript.substring(0, 50),
        aiSpeakingDuration: state ? now - state.aiSpeakingStartTime : 0
      });
      const success = await this.interruptCurrentAction(callId, clinicId, transcript);
      if (success && state) {
        state.lastBargeInTime = now;
        state.isAiSpeaking = false;
        state.pendingInterrupt = true;
        return { shouldInterrupt: true, reason: "interrupt_triggered" };
      }
      return { shouldInterrupt: false, reason: "interrupt_failed" };
    },
    async interruptCurrentAction(callId, clinicId, newTranscript) {
      try {
        const smaId = await getSmaIdForClinicSSM(clinicId);
        if (!smaId) {
          console.error("[BargeInDetector] No SMA ID found for clinic:", clinicId);
          return false;
        }
        const interruptActions = [
          {
            Type: "Pause",
            Parameters: {
              DurationInMilliseconds: "200"
            }
          }
        ];
        await chimeClient.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
          SipMediaApplicationId: smaId,
          TransactionId: callId,
          Arguments: {
            interruptAction: "true",
            bargeInTranscript: newTranscript,
            bargeInTime: (/* @__PURE__ */ new Date()).toISOString(),
            pendingAiActions: JSON.stringify(interruptActions)
          }
        }));
        console.log("[BargeInDetector] Interrupt action sent:", {
          callId,
          clinicId,
          transcriptLength: newTranscript.length
        });
        if (CALL_QUEUE_TABLE) {
          try {
            const callRecord = await getCallRecordByCallId(callId);
            if (callRecord) {
              await ddb.send(new import_lib_dynamodb.UpdateCommand({
                TableName: CALL_QUEUE_TABLE,
                Key: {
                  clinicId: callRecord.clinicId,
                  queuePosition: callRecord.queuePosition
                },
                UpdateExpression: "SET pendingBargeIn = :bargeIn, bargeInTranscript = :transcript, bargeInTime = :time",
                ExpressionAttributeValues: {
                  ":bargeIn": true,
                  ":transcript": newTranscript,
                  ":time": (/* @__PURE__ */ new Date()).toISOString()
                }
              }));
            }
          } catch (dbError) {
            console.warn("[BargeInDetector] Failed to update call record:", dbError.message);
          }
        }
        return true;
      } catch (error) {
        console.error("[BargeInDetector] Error sending interrupt:", {
          callId,
          error: error.message
        });
        return false;
      }
    },
    cleanup(callId) {
      callSpeakingStates.delete(callId);
      console.log("[BargeInDetector] Cleaned up state for call:", callId);
    }
  };
}
async function getCallRecordByCallId(callId) {
  if (!CALL_QUEUE_TABLE)
    return null;
  try {
    const result = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: {
        ":callId": callId
      },
      Limit: 1
    }));
    return result.Items?.[0] || null;
  } catch (error) {
    console.warn("[BargeInDetector] Error querying call record:", error.message);
    return null;
  }
}
var bargeInDetector = createBargeInDetector();
function emitBargeInMetrics(callId, result) {
  console.log("[METRIC] BargeIn.Detection", {
    callId,
    shouldInterrupt: result.shouldInterrupt,
    reason: result.reason,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}

// src/services/chime/utils/call-state-machine.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var ddb2 = import_lib_dynamodb2.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var CALL_QUEUE_TABLE2 = process.env.CALL_QUEUE_TABLE_NAME || "";
var CallState = /* @__PURE__ */ ((CallState2) => {
  CallState2["LISTENING"] = "LISTENING";
  CallState2["PROCESSING"] = "PROCESSING";
  CallState2["SPEAKING"] = "SPEAKING";
  CallState2["INTERRUPTED"] = "INTERRUPTED";
  CallState2["ENDED"] = "ENDED";
  return CallState2;
})(CallState || {});
var STATE_TRANSITIONS = {
  ["LISTENING" /* LISTENING */]: {
    ["TRANSCRIPT_RECEIVED" /* TRANSCRIPT_RECEIVED */]: "PROCESSING" /* PROCESSING */,
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["PROCESSING" /* PROCESSING */]: {
    ["AI_RESPONSE_READY" /* AI_RESPONSE_READY */]: "SPEAKING" /* SPEAKING */,
    ["BARGE_IN" /* BARGE_IN */]: "INTERRUPTED" /* INTERRUPTED */,
    // Can interrupt during processing too
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["SPEAKING" /* SPEAKING */]: {
    ["TTS_COMPLETED" /* TTS_COMPLETED */]: "LISTENING" /* LISTENING */,
    ["BARGE_IN" /* BARGE_IN */]: "INTERRUPTED" /* INTERRUPTED */,
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["INTERRUPTED" /* INTERRUPTED */]: {
    ["TRANSCRIPT_RECEIVED" /* TRANSCRIPT_RECEIVED */]: "PROCESSING" /* PROCESSING */,
    // Process the interrupting utterance
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["ENDED" /* ENDED */]: {
    // Terminal state - no transitions
  }
};
var stateCache = /* @__PURE__ */ new Map();
var STATE_CACHE_TTL_MS = 5 * 60 * 1e3;
function createCallStateMachine() {
  return {
    getState(callId) {
      const entry = stateCache.get(callId);
      if (entry && Date.now() - entry.lastUpdate < STATE_CACHE_TTL_MS) {
        return entry.state;
      }
      return "LISTENING" /* LISTENING */;
    },
    transition(callId, event) {
      const currentState = this.getState(callId);
      const transitions = STATE_TRANSITIONS[currentState];
      const newState = transitions?.[event];
      if (newState) {
        const entry = stateCache.get(callId) || {
          state: currentState,
          lastUpdate: Date.now()
        };
        entry.state = newState;
        entry.lastUpdate = Date.now();
        if (newState === "PROCESSING" /* PROCESSING */) {
          entry.processingStartTime = Date.now();
        }
        if (newState === "LISTENING" /* LISTENING */) {
          entry.processingStartTime = void 0;
        }
        stateCache.set(callId, entry);
        console.log("[CallStateMachine] State transition:", {
          callId,
          from: currentState,
          event,
          to: newState
        });
        return newState;
      }
      console.warn("[CallStateMachine] Invalid transition:", {
        callId,
        currentState,
        event
      });
      return currentState;
    },
    canTransition(callId, event) {
      const currentState = this.getState(callId);
      const transitions = STATE_TRANSITIONS[currentState];
      return transitions?.[event] !== void 0;
    },
    canInterrupt(callId) {
      const state = this.getState(callId);
      return state === "SPEAKING" /* SPEAKING */ || state === "PROCESSING" /* PROCESSING */;
    },
    setMetadata(callId, metadata) {
      const entry = stateCache.get(callId) || {
        state: "LISTENING" /* LISTENING */,
        lastUpdate: Date.now()
      };
      Object.assign(entry, metadata);
      entry.lastUpdate = Date.now();
      stateCache.set(callId, entry);
    },
    getStateWithMetadata(callId) {
      return stateCache.get(callId) || {
        state: "LISTENING" /* LISTENING */,
        lastUpdate: Date.now()
      };
    },
    initializeCall(callId) {
      stateCache.set(callId, {
        state: "LISTENING" /* LISTENING */,
        lastUpdate: Date.now()
      });
      console.log("[CallStateMachine] Initialized call:", callId);
    },
    cleanup(callId) {
      stateCache.delete(callId);
      console.log("[CallStateMachine] Cleaned up call:", callId);
    },
    async persistState(callId, clinicId, queuePosition) {
      if (!CALL_QUEUE_TABLE2) {
        console.warn("[CallStateMachine] CALL_QUEUE_TABLE not configured");
        return;
      }
      const entry = stateCache.get(callId);
      if (!entry)
        return;
      try {
        await ddb2.send(new import_lib_dynamodb2.UpdateCommand({
          TableName: CALL_QUEUE_TABLE2,
          Key: { clinicId, queuePosition },
          UpdateExpression: "SET conversationState = :state, conversationStateTime = :time",
          ExpressionAttributeValues: {
            ":state": entry.state,
            ":time": (/* @__PURE__ */ new Date()).toISOString()
          }
        }));
        console.log("[CallStateMachine] Persisted state:", {
          callId,
          state: entry.state
        });
      } catch (error) {
        console.error("[CallStateMachine] Failed to persist state:", error.message);
      }
    },
    async loadState(callId, clinicId, queuePosition) {
      if (!CALL_QUEUE_TABLE2) {
        return "LISTENING" /* LISTENING */;
      }
      try {
        const result = await ddb2.send(new import_lib_dynamodb2.GetCommand({
          TableName: CALL_QUEUE_TABLE2,
          Key: { clinicId, queuePosition },
          ProjectionExpression: "conversationState"
        }));
        const state = result.Item?.conversationState;
        if (state && Object.values(CallState).includes(state)) {
          stateCache.set(callId, {
            state,
            lastUpdate: Date.now()
          });
          return state;
        }
      } catch (error) {
        console.error("[CallStateMachine] Failed to load state:", error.message);
      }
      return "LISTENING" /* LISTENING */;
    }
  };
}
var callStateMachine = createCallStateMachine();

// src/services/chime/ai-transcript-bridge.ts
var ddb3 = import_lib_dynamodb3.DynamoDBDocumentClient.from(new import_client_dynamodb3.DynamoDBClient({}));
var lambdaClient = new import_client_lambda.LambdaClient({});
var CHIME_MEDIA_REGION2 = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chimeClient2 = new import_client_chime_sdk_voice2.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION2 });
var VOICE_AI_LAMBDA_ARN = process.env.VOICE_AI_LAMBDA_ARN;
var CALL_QUEUE_TABLE3 = process.env.CALL_QUEUE_TABLE_NAME;
var VOICE_SESSIONS_TABLE = process.env.VOICE_SESSIONS_TABLE;
var VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE || "";
var HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET || "";
var MIN_TRANSCRIPT_LENGTH = 3;
var THINKING_AUDIO_KEY = "Computer-keyboard sound.wav";
var DEFAULT_VOICE_SETTINGS = {
  voiceId: "Joanna",
  engine: "neural"
};
var voiceSettingsCache = /* @__PURE__ */ new Map();
var VOICE_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getVoiceSettingsForClinic(clinicId) {
  if (!clinicId || !VOICE_CONFIG_TABLE) {
    return DEFAULT_VOICE_SETTINGS;
  }
  const cached = voiceSettingsCache.get(clinicId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }
  try {
    const response = await ddb3.send(new import_lib_dynamodb3.GetCommand({
      TableName: VOICE_CONFIG_TABLE,
      Key: { clinicId },
      ProjectionExpression: "voiceSettings"
    }));
    const config = response.Item;
    const settings = {
      voiceId: config?.voiceSettings?.voiceId || DEFAULT_VOICE_SETTINGS.voiceId,
      engine: config?.voiceSettings?.engine || DEFAULT_VOICE_SETTINGS.engine
    };
    voiceSettingsCache.set(clinicId, {
      settings,
      expiresAt: Date.now() + VOICE_SETTINGS_CACHE_TTL_MS
    });
    return settings;
  } catch (error) {
    console.warn("[AITranscriptBridge] Failed to get voice settings for clinic:", clinicId, error);
    return DEFAULT_VOICE_SETTINGS;
  }
}
var CALL_RECORD_CACHE_TTL_MS = 15e3;
var callRecordCache = /* @__PURE__ */ new Map();
var MAX_CALL_RECORD_CACHE_SIZE = 500;
var MAX_PENDING_UTTERANCES_SIZE = 200;
var UTTERANCE_COMPLETE_TIMEOUT_MS = 800;
var PENDING_UTTERANCE_MAX_AGE_MS = 5 * 60 * 1e3;
var pendingUtterances = /* @__PURE__ */ new Map();
function cleanupStaleEntries() {
  const now = Date.now();
  for (const [callId, entry] of pendingUtterances.entries()) {
    if (now - entry.createdAt > PENDING_UTTERANCE_MAX_AGE_MS) {
      console.warn(`[AITranscriptBridge] Cleaning up stale pending utterance for callId ${callId} (age: ${Math.floor((now - entry.createdAt) / 1e3)}s)`);
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      pendingUtterances.delete(callId);
    }
  }
  for (const [callId, entry] of callRecordCache.entries()) {
    if (now > entry.expiresAt) {
      callRecordCache.delete(callId);
    }
  }
  if (callRecordCache.size > MAX_CALL_RECORD_CACHE_SIZE) {
    const entriesToRemove = callRecordCache.size - MAX_CALL_RECORD_CACHE_SIZE + 50;
    const entries = Array.from(callRecordCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, entriesToRemove);
    for (const [key] of entries) {
      callRecordCache.delete(key);
    }
    console.log(`[AITranscriptBridge] Evicted ${entries.length} call record cache entries`);
  }
  if (pendingUtterances.size > MAX_PENDING_UTTERANCES_SIZE) {
    const entriesToRemove = pendingUtterances.size - MAX_PENDING_UTTERANCES_SIZE + 20;
    const entries = Array.from(pendingUtterances.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, entriesToRemove);
    for (const [key, entry] of entries) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      pendingUtterances.delete(key);
    }
    console.log(`[AITranscriptBridge] Evicted ${entries.length} stale pending utterances`);
  }
}
var handler = async (event) => {
  console.log("[AITranscriptBridge] Processing batch", {
    recordCount: event.Records.length,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  cleanupStaleEntries();
  const results = {
    processed: 0,
    skipped: 0,
    errors: 0
  };
  for (const record of event.Records) {
    try {
      const processed = await processKinesisRecord(record);
      if (processed) {
        results.processed++;
      } else {
        results.skipped++;
      }
    } catch (error) {
      console.error("[AITranscriptBridge] Error processing record:", {
        error: error.message,
        sequenceNumber: record.kinesis.sequenceNumber
      });
      results.errors++;
    }
  }
  console.log("[AITranscriptBridge] Batch complete", results);
};
async function processKinesisRecord(record) {
  const payload = Buffer.from(record.kinesis.data, "base64").toString("utf-8");
  let transcriptEvent;
  try {
    transcriptEvent = JSON.parse(payload);
  } catch (e) {
    console.warn("[AITranscriptBridge] Failed to parse transcript event:", payload.substring(0, 200));
    return false;
  }
  const metadata = transcriptEvent.MediaInsightsRuntimeMetadata;
  const callId = metadata?.transactionId || metadata?.TransactionId || metadata?.callId || metadata?.CallId || transcriptEvent?.TransactionId || transcriptEvent?.transactionId || transcriptEvent?.CallId || transcriptEvent?.callId;
  if (!callId || typeof callId !== "string") {
    console.warn("[AITranscriptBridge] No callId/transactionId found in transcript event");
    return false;
  }
  const callRecord = await getCallRecord(callId);
  if (!callRecord) {
    console.warn("[AITranscriptBridge] Call record not found for transcript event (skipping):", callId);
    return false;
  }
  if (!callRecord.isAiCall) {
    return false;
  }
  const { transcript, isPartial, channelId } = extractTranscript(transcriptEvent);
  if (!transcript || transcript.length < MIN_TRANSCRIPT_LENGTH) {
    return false;
  }
  const kvsRole = metadata?.kvsParticipantRole;
  if (channelId === "AGENT" || kvsRole === "AGENT") {
    console.log("[AITranscriptBridge] Skipping agent/AI transcript", { channelId, kvsRole });
    return false;
  }
  const clinicId = metadata?.clinicId || callRecord.clinicId;
  const sessionId = metadata?.aiSessionId || metadata?.sessionId || callRecord.aiSessionId;
  console.log("[AITranscriptBridge] Transcript received:", {
    callId,
    clinicId,
    isPartial,
    transcriptLength: transcript.length,
    transcript: transcript.substring(0, 100)
  });
  if (isPartial) {
    accumulateUtterance(callId, clinicId || "", sessionId || "", transcript);
    return true;
  }
  return await processCompleteUtterance(callId, clinicId || "", sessionId || "", transcript, callRecord);
}
function extractTranscript(event) {
  if (event.CallAnalyticsTranscriptResultStream?.UtteranceEvent) {
    const utterance = event.CallAnalyticsTranscriptResultStream.UtteranceEvent;
    return {
      transcript: utterance.Transcript || "",
      isPartial: utterance.IsPartial,
      channelId: utterance.ParticipantRole
    };
  }
  if (event.Transcript?.Results?.[0]) {
    const result = event.Transcript.Results[0];
    const transcript = result.Alternatives?.[0]?.Transcript || "";
    return {
      transcript,
      isPartial: result.IsPartial,
      channelId: result.ChannelId || "ch_1"
      // Default to customer
    };
  }
  return { transcript: "", isPartial: true, channelId: "" };
}
async function accumulateUtterance(callId, clinicId, sessionId, transcript) {
  const existing = pendingUtterances.get(callId);
  const now = Date.now();
  if (bargeInDetector.isAiSpeaking(callId)) {
    const bargeInResult = await bargeInDetector.onCallerSpeech(callId, clinicId, transcript);
    emitBargeInMetrics(callId, bargeInResult);
    if (bargeInResult.shouldInterrupt) {
      console.log("[AITranscriptBridge] Barge-in triggered - interrupting AI speech:", {
        callId,
        transcript: transcript.substring(0, 50)
      });
      if (existing?.timeoutId) {
        clearTimeout(existing.timeoutId);
      }
      pendingUtterances.delete(callId);
      return;
    }
  }
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }
  pendingUtterances.set(callId, {
    text: transcript,
    // Partials typically include full text so far
    lastUpdate: now,
    createdAt: existing?.createdAt ?? now,
    // FIX: Preserve original creation time
    timeoutId: setTimeout(async () => {
      const pending = pendingUtterances.get(callId);
      if (pending && pending.text) {
        console.log("[AITranscriptBridge] Utterance timeout - processing accumulated:", {
          callId,
          transcriptLength: pending.text.length,
          ageMs: Date.now() - pending.createdAt
        });
        try {
          await processCompleteUtterance(callId, clinicId, sessionId, pending.text);
        } catch (error) {
          console.error("[AITranscriptBridge] Error processing timeout utterance:", error);
        }
        pendingUtterances.delete(callId);
      }
    }, UTTERANCE_COMPLETE_TIMEOUT_MS)
  });
}
async function processCompleteUtterance(callId, clinicId, sessionId, transcript, callRecordOverride) {
  const pending = pendingUtterances.get(callId);
  if (pending?.timeoutId) {
    clearTimeout(pending.timeoutId);
    pendingUtterances.delete(callId);
  }
  const callRecord = callRecordOverride || await getCallRecord(callId);
  if (!callRecord) {
    console.warn("[AITranscriptBridge] Call record not found:", callId);
    return false;
  }
  if (!callRecord.isAiCall) {
    console.log("[AITranscriptBridge] Not an AI call, skipping:", callId);
    return false;
  }
  const finalClinicId = clinicId || callRecord.clinicId;
  const finalSessionId = sessionId || callRecord.aiSessionId;
  const aiAgentId = callRecord.aiAgentId;
  const transactionId = callRecord.transactionId || callId;
  const currentState = callStateMachine.getState(callId);
  if (currentState === "PROCESSING" /* PROCESSING */) {
    console.log("[AITranscriptBridge] Already processing, queuing transcript for later:", {
      callId,
      currentState,
      transcript: transcript.substring(0, 30)
    });
    callStateMachine.setMetadata(callId, { lastSpeakText: transcript });
    return false;
  }
  callStateMachine.transition(callId, "TRANSCRIPT_RECEIVED" /* TRANSCRIPT_RECEIVED */);
  console.log("[AITranscriptBridge] Processing complete utterance:", {
    callId,
    clinicId: finalClinicId,
    sessionId: finalSessionId,
    transcript: transcript.substring(0, 50) + "...",
    state: callStateMachine.getState(callId)
  });
  if (callRecord.pipelineMode === "meeting-kvs" && HOLD_MUSIC_BUCKET) {
    await playThinkingAudio(transactionId, finalClinicId);
  }
  const voiceAiResponse = await invokeVoiceAiHandler({
    eventType: "TRANSCRIPT",
    callId,
    clinicId: finalClinicId,
    transcript,
    sessionId: finalSessionId,
    aiAgentId
  });
  if (!voiceAiResponse || voiceAiResponse.length === 0) {
    console.warn("[AITranscriptBridge] No response from Voice AI handler");
    callStateMachine.transition(callId, "TTS_COMPLETED" /* TTS_COMPLETED */);
    return false;
  }
  callStateMachine.transition(callId, "AI_RESPONSE_READY" /* AI_RESPONSE_READY */);
  await sendResponseToCall(callRecord, transactionId, voiceAiResponse);
  try {
    await callStateMachine.persistState(callId, finalClinicId, callRecord.queuePosition);
  } catch (err) {
    console.warn("[AITranscriptBridge] Failed to persist state:", err);
  }
  return true;
}
async function getCallRecord(callId) {
  const cached = callRecordCache.get(callId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.record;
  }
  try {
    const result = await ddb3.send(new import_lib_dynamodb3.QueryCommand({
      TableName: CALL_QUEUE_TABLE3,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    const record = result.Items?.[0] || null;
    callRecordCache.set(callId, { record, expiresAt: now + CALL_RECORD_CACHE_TTL_MS });
    return record;
  } catch (error) {
    console.error("[AITranscriptBridge] Error getting call record:", error);
    return null;
  }
}
async function invokeVoiceAiHandler(event) {
  if (!VOICE_AI_LAMBDA_ARN) {
    console.error("[AITranscriptBridge] VOICE_AI_LAMBDA_ARN not configured");
    return [];
  }
  try {
    const response = await lambdaClient.send(new import_client_lambda.InvokeCommand({
      FunctionName: VOICE_AI_LAMBDA_ARN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(event))
    }));
    if (response.Payload) {
      const result = JSON.parse(Buffer.from(response.Payload).toString());
      console.log("[AITranscriptBridge] Voice AI response:", result);
      return Array.isArray(result) ? result : [result];
    }
    return [];
  } catch (error) {
    console.error("[AITranscriptBridge] Error invoking Voice AI:", error);
    return [];
  }
}
async function playThinkingAudio(transactionId, clinicId) {
  if (!HOLD_MUSIC_BUCKET) {
    console.warn("[AITranscriptBridge] HOLD_MUSIC_BUCKET not configured for thinking audio");
    return;
  }
  const smaId = await getSmaIdForClinicSSM(clinicId);
  if (!smaId) {
    console.warn("[AITranscriptBridge] No SMA ID found for thinking audio, clinicId:", clinicId);
    return;
  }
  const thinkingAction = {
    Type: "PlayAudio",
    Parameters: {
      AudioSource: {
        Type: "S3",
        BucketName: HOLD_MUSIC_BUCKET,
        Key: THINKING_AUDIO_KEY
      },
      Repeat: 5
      // Will be interrupted by AI response
    }
  };
  try {
    await chimeClient2.send(new import_client_chime_sdk_voice2.UpdateSipMediaApplicationCallCommand({
      SipMediaApplicationId: smaId,
      TransactionId: transactionId,
      Arguments: {
        pendingAiActions: JSON.stringify([thinkingAction]),
        aiProcessingStarted: (/* @__PURE__ */ new Date()).toISOString(),
        isThinkingAudio: "true"
      }
    }));
    console.log("[AITranscriptBridge] Playing thinking audio for call:", transactionId);
  } catch (error) {
    console.warn("[AITranscriptBridge] Failed to play thinking audio:", error.message);
  }
}
async function sendResponseToCall(callRecord, transactionId, responses) {
  const clinicId = callRecord?.clinicId;
  await storePendingResponseForCallRecord(callRecord, responses);
  const smaId = await getSmaIdForClinicSSM(clinicId);
  if (!smaId) {
    console.error("[AITranscriptBridge] No SMA ID found for clinic:", clinicId);
    return;
  }
  const voiceSettings = await getVoiceSettingsForClinic(clinicId);
  const actions = [];
  for (const response of responses) {
    switch (response.action) {
      case "SPEAK":
        if (response.text) {
          actions.push({
            Type: "Speak",
            Parameters: {
              Text: response.text,
              Engine: voiceSettings.engine,
              LanguageCode: "en-US",
              TextType: "text",
              VoiceId: voiceSettings.voiceId
            }
          });
        }
        break;
      case "HANG_UP":
        actions.push({
          Type: "Hangup",
          Parameters: {
            SipResponseCode: "0"
          }
        });
        break;
      case "TRANSFER":
        actions.push({
          Type: "Speak",
          Parameters: {
            Text: "I will transfer you to an available agent.",
            Engine: voiceSettings.engine,
            LanguageCode: "en-US",
            TextType: "text",
            VoiceId: voiceSettings.voiceId
          }
        });
        break;
      case "CONTINUE":
        actions.push({
          Type: "Pause",
          Parameters: {
            DurationInMilliseconds: "500"
          }
        });
        break;
    }
  }
  if (actions.length === 0) {
    console.log("[AITranscriptBridge] No actions to send for call:", transactionId);
    return;
  }
  try {
    console.log("[AITranscriptBridge] Sending actions to call:", {
      transactionId,
      smaId,
      actionCount: actions.length,
      firstAction: actions[0].Type
    });
    await chimeClient2.send(new import_client_chime_sdk_voice2.UpdateSipMediaApplicationCallCommand({
      SipMediaApplicationId: smaId,
      TransactionId: transactionId,
      Arguments: {
        // These arguments are passed to the SMA Lambda on next invocation
        pendingAiActions: JSON.stringify(actions),
        aiResponseTime: (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    console.log("[AITranscriptBridge] Successfully sent update to SMA");
    const hasSpeakAction = actions.some((a) => a.Type === "Speak" || a.Type === "PlayAudio");
    if (hasSpeakAction) {
      bargeInDetector.setAiSpeaking(transactionId, true);
    }
  } catch (error) {
    console.error("[AITranscriptBridge] Error sending response to call:", {
      transactionId,
      smaId,
      error: error.message,
      code: error.code
    });
  }
}
async function storePendingResponseForCallRecord(callRecord, responses) {
  try {
    if (!callRecord?.clinicId || callRecord?.queuePosition === void 0) {
      console.warn("[AITranscriptBridge] Cannot store pending response - call record missing keys");
      return;
    }
    await ddb3.send(new import_lib_dynamodb3.UpdateCommand({
      TableName: CALL_QUEUE_TABLE3,
      Key: {
        clinicId: callRecord.clinicId,
        queuePosition: callRecord.queuePosition
      },
      UpdateExpression: "SET pendingAiResponse = :response, pendingAiResponseTime = :time",
      ExpressionAttributeValues: {
        ":response": JSON.stringify(responses),
        ":time": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    console.log("[AITranscriptBridge] Stored pending AI response in DynamoDB:", callRecord.callId || callRecord.transactionId);
  } catch (error) {
    console.error("[AITranscriptBridge] Failed to store pending response:", error);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

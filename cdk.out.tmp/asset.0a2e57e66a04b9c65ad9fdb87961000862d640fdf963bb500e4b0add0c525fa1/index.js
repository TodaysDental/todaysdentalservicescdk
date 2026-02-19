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

// src/services/connect/async-bedrock-handler.ts
var async_bedrock_handler_exports = {};
__export(async_bedrock_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(async_bedrock_handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");
var import_client_lambda = require("@aws-sdk/client-lambda");

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

// src/services/connect/async-bedrock-handler.ts
var ASYNC_RESULTS_TABLE = process.env.ASYNC_RESULTS_TABLE || "ConnectAsyncResults";
var SESSIONS_TABLE = process.env.SESSIONS_TABLE || "AiAgentSessions";
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var RESULT_TTL_SECONDS = 300;
var DEFAULT_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || "dentistingreenville";
var DEFAULT_PROSODY = {
  speakingRate: "medium",
  pitch: "medium",
  volume: "medium"
};
var ALLOWED_SPEAKING_RATES = /* @__PURE__ */ new Set(["x-slow", "slow", "medium", "fast", "x-fast"]);
var ALLOWED_PITCH = /* @__PURE__ */ new Set(["x-low", "low", "medium", "high", "x-high"]);
var ALLOWED_VOLUME = /* @__PURE__ */ new Set(["silent", "x-soft", "soft", "medium", "loud", "x-loud"]);
function normalizeProsody(value, allowed, fallback) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && allowed.has(raw) ? raw : fallback;
}
function getProsodyFromContactAttributes(attrs) {
  return {
    speakingRate: normalizeProsody(attrs.ttsSpeakingRate, ALLOWED_SPEAKING_RATES, DEFAULT_PROSODY.speakingRate),
    pitch: normalizeProsody(attrs.ttsPitch, ALLOWED_PITCH, DEFAULT_PROSODY.pitch),
    volume: normalizeProsody(attrs.ttsVolume, ALLOWED_VOLUME, DEFAULT_PROSODY.volume)
  };
}
var AI_PHONE_NUMBERS_JSON = process.env.AI_PHONE_NUMBERS_JSON || "{}";
var aiPhoneNumberMap = {};
try {
  aiPhoneNumberMap = JSON.parse(AI_PHONE_NUMBERS_JSON);
} catch (e) {
  console.warn("[AsyncBedrock] Failed to parse AI_PHONE_NUMBERS_JSON:", e);
}
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var lambdaClient = new import_client_lambda.LambdaClient({});
var bedrockAgentClient = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var ASYNC_WORKER_FUNCTION_NAME = process.env.ASYNC_WORKER_FUNCTION_NAME || process.env.AWS_LAMBDA_FUNCTION_NAME || "";
var agentCache = /* @__PURE__ */ new Map();
var AGENT_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getAgentForClinic(clinicId) {
  const cached = agentCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < AGENT_CACHE_TTL_MS) {
    return cached.agent;
  }
  try {
    const allAgents = await docClient.send(new import_lib_dynamodb.QueryCommand({
      TableName: AGENTS_TABLE,
      IndexName: "ClinicIndex",
      KeyConditionExpression: "clinicId = :clinicId",
      ExpressionAttributeValues: {
        ":clinicId": clinicId
      },
      Limit: 20,
      ScanIndexForward: false
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
      console.log("[AsyncBedrock] Selected default voice agent:", selectedAgent.agentId);
    }
    if (!selectedAgent) {
      const voiceEnabled = allAgents.Items.find((a) => a.isVoiceEnabled === true);
      if (voiceEnabled) {
        selectedAgent = voiceEnabled;
        console.log("[AsyncBedrock] Selected voice-enabled agent:", selectedAgent.agentId);
      }
    }
    if (!selectedAgent) {
      selectedAgent = allAgents.Items[0];
      console.log("[AsyncBedrock] Using fallback agent:", selectedAgent.agentId);
    }
    const agentInfo = {
      agentId: selectedAgent.bedrockAgentId,
      aliasId: selectedAgent.bedrockAliasId || "TSTALIASID",
      agentName: selectedAgent.agentName || selectedAgent.name
    };
    agentCache.set(clinicId, { agent: agentInfo, timestamp: Date.now() });
    return agentInfo;
  } catch (error) {
    console.error("[AsyncBedrock] Error looking up agent:", error);
    return null;
  }
}
async function getOrCreateSession(contactId, clinicId) {
  const sessionKey = `lex-${contactId}`;
  try {
    const existing = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: sessionKey }
    }));
    if (existing.Item) {
      return {
        bedrockSessionId: existing.Item.bedrockSessionId,
        clinicId: existing.Item.clinicId || clinicId
      };
    }
  } catch (error) {
    console.warn("[AsyncBedrock] Error getting session:", error);
  }
  const bedrockSessionId = v4_default();
  const now = Date.now();
  const ttl = Math.floor(now / 1e3) + 60 * 60;
  try {
    await docClient.send(new import_lib_dynamodb.PutCommand({
      TableName: SESSIONS_TABLE,
      Item: {
        sessionId: sessionKey,
        callId: `connect-${contactId}`,
        clinicId,
        bedrockSessionId,
        callStartMs: now,
        turnCount: 1,
        createdAt: new Date(now).toISOString(),
        lastActivity: new Date(now).toISOString(),
        ttl
      }
    }));
  } catch (error) {
    console.error("[AsyncBedrock] Error creating session:", error);
  }
  return { bedrockSessionId, clinicId };
}
async function startAsync(event) {
  const contactData = event.Details?.ContactData;
  const params = event.Details?.Parameters || {};
  const contactId = contactData?.ContactId || "";
  const inputTranscript = params.inputTranscript || "";
  const callerNumber = contactData?.CustomerEndpoint?.Address || "";
  const dialedNumber = contactData?.SystemEndpoint?.Address || "";
  const contactAttributes = contactData?.Attributes || {};
  const requestId = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  console.log("[AsyncBedrock] Starting async invocation:", {
    requestId,
    contactId,
    inputText: inputTranscript.substring(0, 50)
  });
  let clinicId = contactAttributes.clinicId || "";
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
  }
  const prosody = getProsodyFromContactAttributes(contactAttributes);
  const pendingResult = {
    requestId,
    contactId,
    status: "pending",
    startedAt: now,
    pollCount: 0,
    ttl: Math.floor(Date.now() / 1e3) + RESULT_TTL_SECONDS
  };
  await docClient.send(new import_lib_dynamodb.PutCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Item: pendingResult
  }));
  if (!ASYNC_WORKER_FUNCTION_NAME) {
    console.error("[AsyncBedrock] Missing ASYNC_WORKER_FUNCTION_NAME/AWS_LAMBDA_FUNCTION_NAME");
    const response = "I'm sorry, the AI assistant is not available right now. Please try again.";
    await updateResult(requestId, {
      status: "error",
      response,
      ssmlResponse: buildProsodySsml(response, prosody),
      errorMessage: "Missing ASYNC_WORKER_FUNCTION_NAME"
    });
    throw new Error("Missing ASYNC_WORKER_FUNCTION_NAME");
  }
  try {
    const payload = {
      Details: {
        Parameters: {
          functionType: "process",
          requestId,
          contactId,
          inputText: inputTranscript.trim(),
          clinicId,
          ttsSpeakingRate: prosody.speakingRate,
          ttsPitch: prosody.pitch,
          ttsVolume: prosody.volume
        }
      }
    };
    await lambdaClient.send(new import_client_lambda.InvokeCommand({
      FunctionName: ASYNC_WORKER_FUNCTION_NAME,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload))
    }));
  } catch (err) {
    console.error("[AsyncBedrock] Failed to invoke async worker:", err);
    const response = "I'm sorry, I'm having trouble right now. Please try again.";
    await updateResult(requestId, {
      status: "error",
      response,
      ssmlResponse: buildProsodySsml(response, prosody),
      errorMessage: err?.message || "Failed to invoke async worker"
    });
    throw err;
  }
  return {
    requestId,
    status: "started"
  };
}
async function processBedrockInvocation(params) {
  const { requestId, contactId, inputText, clinicId } = params;
  const prosody = {
    speakingRate: normalizeProsody(params.ttsSpeakingRate, ALLOWED_SPEAKING_RATES, DEFAULT_PROSODY.speakingRate),
    pitch: normalizeProsody(params.ttsPitch, ALLOWED_PITCH, DEFAULT_PROSODY.pitch),
    volume: normalizeProsody(params.ttsVolume, ALLOWED_VOLUME, DEFAULT_PROSODY.volume)
  };
  try {
    if (!inputText) {
      const response2 = "I'm sorry, I didn't catch that. Could you please repeat what you said?";
      await updateResult(requestId, {
        status: "completed",
        response: response2,
        ssmlResponse: buildProsodySsml(response2, prosody)
      });
      return;
    }
    const session = await getOrCreateSession(contactId, clinicId);
    const agent = await getAgentForClinic(session.clinicId);
    if (!agent) {
      const response2 = "I'm sorry, the AI assistant is not available right now. Please call back during office hours.";
      await updateResult(requestId, {
        status: "error",
        errorMessage: `No Bedrock agent configured for clinic: ${clinicId}`,
        response: response2,
        ssmlResponse: buildProsodySsml(response2, prosody)
      });
      return;
    }
    console.log("[AsyncBedrock] Invoking Bedrock agent:", {
      requestId,
      agentId: agent.agentId,
      sessionId: session.bedrockSessionId
    });
    const command = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
      agentId: agent.agentId,
      agentAliasId: agent.aliasId,
      sessionId: session.bedrockSessionId,
      inputText,
      sessionState: {
        sessionAttributes: {
          clinicId: session.clinicId,
          inputMode: "Speech",
          channel: "voice"
        }
      }
    });
    const response = await bedrockAgentClient.send(command);
    let fullResponse = "";
    const toolsUsed = [];
    if (response.completion) {
      for await (const chunk of response.completion) {
        if (chunk.chunk?.bytes) {
          fullResponse += new TextDecoder().decode(chunk.chunk.bytes);
        }
        if (chunk.trace?.trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
          const actionGroup = chunk.trace.trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
          if (actionGroup.function) {
            toolsUsed.push(actionGroup.function);
          }
        }
      }
    }
    console.log("[AsyncBedrock] Bedrock completed:", {
      requestId,
      responseLength: fullResponse.length,
      toolsUsed
    });
    await updateResult(requestId, {
      status: "completed",
      response: fullResponse.trim() || "I'm sorry, I couldn't process that. How else can I help you?",
      ssmlResponse: buildProsodySsml(
        fullResponse.trim() || "I'm sorry, I couldn't process that. How else can I help you?",
        prosody
      ),
      toolsUsed: [...new Set(toolsUsed)]
    });
  } catch (error) {
    console.error("[AsyncBedrock] Bedrock invocation error:", error);
    const response = "I'm sorry, I had trouble processing that. Could you please try again?";
    await updateResult(requestId, {
      status: "error",
      errorMessage: error.message || "Unknown error",
      response,
      ssmlResponse: buildProsodySsml(response, prosody)
    });
  }
}
async function updateResult(requestId, result) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ttl = Math.floor(Date.now() / 1e3) + RESULT_TTL_SECONDS;
  await docClient.send(new import_lib_dynamodb.UpdateCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Key: { requestId },
    UpdateExpression: [
      "SET #status = :status",
      "#response = :response",
      "#ssmlResponse = :ssmlResponse",
      "#completedAt = :completedAt",
      "#ttl = :ttl",
      "#errorMessage = :errorMessage",
      "#toolsUsed = :toolsUsed"
    ].join(", "),
    ExpressionAttributeNames: {
      "#status": "status",
      "#response": "response",
      "#ssmlResponse": "ssmlResponse",
      "#completedAt": "completedAt",
      "#ttl": "ttl",
      "#errorMessage": "errorMessage",
      "#toolsUsed": "toolsUsed"
    },
    ExpressionAttributeValues: {
      ":status": result.status,
      ":response": result.response || "",
      ":ssmlResponse": result.ssmlResponse || "",
      ":completedAt": now,
      ":ttl": ttl,
      ":errorMessage": result.errorMessage || "",
      ":toolsUsed": result.toolsUsed || []
    }
  }));
}
async function checkResult(event) {
  const params = event.Details?.Parameters || {};
  const requestId = params.requestId || "";
  const contactAttributes = event.Details?.ContactData?.Attributes || {};
  const prosody = getProsodyFromContactAttributes(contactAttributes);
  if (!requestId) {
    console.warn("[AsyncBedrock] checkResult called without requestId");
    const aiResponse = "I'm sorry, there was an error. Please try again.";
    return {
      status: "error",
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody)
    };
  }
  try {
    const result = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId }
    }));
    if (!result.Item) {
      return { status: "pending" };
    }
    const item = result.Item;
    if (item.status === "completed") {
      console.log("[AsyncBedrock] Result ready:", { requestId, responseLength: item.response?.length });
      docClient.send(new import_lib_dynamodb.DeleteCommand({
        TableName: ASYNC_RESULTS_TABLE,
        Key: { requestId }
      })).catch(() => {
      });
      return {
        status: "completed",
        aiResponse: item.response || "",
        ssmlResponse: item.ssmlResponse || buildProsodySsml(item.response || "", prosody)
      };
    }
    if (item.status === "error") {
      console.warn("[AsyncBedrock] Result has error:", { requestId, error: item.errorMessage });
      const aiResponse = item.response || "I'm sorry, I had trouble processing that. Could you please try again?";
      return {
        status: "completed",
        // Still "completed" so Connect plays the message
        aiResponse,
        ssmlResponse: item.ssmlResponse || buildProsodySsml(aiResponse, prosody)
      };
    }
    return { status: "pending" };
  } catch (error) {
    console.error("[AsyncBedrock] checkResult error:", error);
    const aiResponse = "I'm sorry, something went wrong. Please try again.";
    return {
      status: "error",
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody)
    };
  }
}
async function pollResult(event) {
  const params = event.Details?.Parameters || {};
  const requestId = params.requestId || "";
  const maxPollLoopsRaw = params.maxPollLoops || "";
  const contactAttributes = event.Details?.ContactData?.Attributes || {};
  const prosody = getProsodyFromContactAttributes(contactAttributes);
  const maxPollLoops = (() => {
    const n = parseInt(String(maxPollLoopsRaw || "20"), 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
  })();
  if (!requestId) {
    console.warn("[AsyncBedrock] pollResult called without requestId");
    const aiResponse = "I'm sorry, there was an error. Please try again.";
    return {
      status: "error",
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody)
    };
  }
  const result = await docClient.send(new import_lib_dynamodb.GetCommand({
    TableName: ASYNC_RESULTS_TABLE,
    Key: { requestId }
  }));
  if (!result.Item) {
    return { status: "pending" };
  }
  const item = result.Item;
  if (item.status === "completed") {
    docClient.send(new import_lib_dynamodb.DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId }
    })).catch(() => {
    });
    const aiResponse = item.response || "";
    return {
      status: "completed",
      aiResponse,
      ssmlResponse: item.ssmlResponse || buildProsodySsml(aiResponse, prosody)
    };
  }
  if (item.status === "error") {
    docClient.send(new import_lib_dynamodb.DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId }
    })).catch(() => {
    });
    const aiResponse = item.response || "I'm sorry, I had trouble processing that. Could you please try again?";
    return {
      status: "completed",
      aiResponse,
      ssmlResponse: item.ssmlResponse || buildProsodySsml(aiResponse, prosody)
    };
  }
  let nextPollCount = (item.pollCount ?? 0) + 1;
  try {
    const updated = await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId },
      UpdateExpression: "SET lastPolledAt = :now, pollCount = if_not_exists(pollCount, :zero) + :one",
      ConditionExpression: "#status = :pending",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":zero": 0,
        ":one": 1,
        ":pending": "pending"
      },
      ReturnValues: "UPDATED_NEW"
    }));
    if (updated.Attributes && typeof updated.Attributes.pollCount === "number") {
      nextPollCount = updated.Attributes.pollCount;
    }
  } catch {
  }
  if (nextPollCount >= maxPollLoops) {
    try {
      const reread = await docClient.send(new import_lib_dynamodb.GetCommand({
        TableName: ASYNC_RESULTS_TABLE,
        Key: { requestId }
      }));
      const current = reread.Item;
      if (current && current.status === "completed") {
        const aiResponse2 = current.response || "";
        docClient.send(new import_lib_dynamodb.DeleteCommand({
          TableName: ASYNC_RESULTS_TABLE,
          Key: { requestId }
        })).catch(() => {
        });
        return {
          status: "completed",
          aiResponse: aiResponse2,
          ssmlResponse: current.ssmlResponse || buildProsodySsml(aiResponse2, prosody)
        };
      }
      if (current && current.status === "error") {
        const aiResponse2 = current.response || "I'm sorry, I had trouble processing that. Could you please try again?";
        docClient.send(new import_lib_dynamodb.DeleteCommand({
          TableName: ASYNC_RESULTS_TABLE,
          Key: { requestId }
        })).catch(() => {
        });
        return {
          status: "completed",
          aiResponse: aiResponse2,
          ssmlResponse: current.ssmlResponse || buildProsodySsml(aiResponse2, prosody)
        };
      }
    } catch {
    }
    const aiResponse = "I'm sorry \u2014 this is taking longer than expected. Could you please repeat your question?";
    await updateResult(requestId, {
      status: "completed",
      response: aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody),
      errorMessage: "Polling timeout"
    });
    docClient.send(new import_lib_dynamodb.DeleteCommand({
      TableName: ASYNC_RESULTS_TABLE,
      Key: { requestId }
    })).catch(() => {
    });
    return {
      status: "completed",
      aiResponse,
      ssmlResponse: buildProsodySsml(aiResponse, prosody)
    };
  }
  return { status: "pending" };
}
function escapeSSML(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function buildProsodySsml(text, prosody) {
  const escaped = escapeSSML(text || "");
  return `<speak><prosody rate="${prosody.speakingRate}" pitch="${prosody.pitch}" volume="${prosody.volume}">${escaped}</prosody></speak>`;
}
var handler = async (event) => {
  console.log("[AsyncBedrock] Received event:", JSON.stringify(event, null, 2));
  const functionType = event.Details?.Parameters?.functionType || "start";
  switch (functionType) {
    case "check":
      return checkResult(event);
    case "poll":
      return pollResult(event);
    case "process": {
      const params = event.Details?.Parameters || {};
      const requestId = params.requestId || "";
      const contactId = params.contactId || "";
      const inputText = (params.inputText || "").toString();
      const clinicId = params.clinicId || DEFAULT_CLINIC_ID;
      const ttsSpeakingRate = params.ttsSpeakingRate;
      const ttsPitch = params.ttsPitch;
      const ttsVolume = params.ttsVolume;
      if (!requestId) {
        console.error("[AsyncBedrock] process called without requestId");
        return { status: "error" };
      }
      await processBedrockInvocation({
        requestId,
        contactId,
        inputText: inputText.trim(),
        clinicId,
        ttsSpeakingRate,
        ttsPitch,
        ttsVolume
      });
      return { status: "processing_complete" };
    }
    case "start":
    default:
      return startAsync(event);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

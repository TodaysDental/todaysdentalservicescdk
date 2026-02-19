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

// src/services/rcs/rcs-auto-reply.ts
var rcs_auto_reply_exports = {};
__export(rcs_auto_reply_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(rcs_auto_reply_exports);
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE || "";
var RCS_SEND_MESSAGE_FUNCTION_ARN = process.env.RCS_SEND_MESSAGE_FUNCTION_ARN || "";
var AI_AGENTS_TABLE = process.env.AI_AGENTS_TABLE || "";
var AI_AGENT_CONVERSATIONS_TABLE = process.env.AI_AGENT_CONVERSATIONS_TABLE || "";
var RCS_REPLY_ENABLED = (process.env.RCS_REPLY_ENABLED || "true").toLowerCase() !== "false";
var RCS_REPLY_AGENT_ID = (process.env.RCS_REPLY_AGENT_ID || "").trim();
var RCS_REPLY_AGENT_TAG = (process.env.RCS_REPLY_AGENT_TAG || "rcs").trim().toLowerCase();
var RCS_REPLY_AGENT_ID_MAP_JSON = (process.env.RCS_REPLY_AGENT_ID_MAP_JSON || "").trim();
var CONFIG_SK = "CONFIG#AUTO_REPLY";
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
var bedrockAgentRuntime = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || "us-east-1",
  maxAttempts: 3
});
var lambdaClient = new import_client_lambda.LambdaClient({});
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function parseAgentIdMap(raw) {
  if (!raw)
    return {};
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object")
    return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    const key = String(k || "").trim();
    const val = typeof v === "string" ? v.trim() : String(v || "").trim();
    if (key && val)
      out[key] = val;
  }
  return out;
}
var agentIdMap = parseAgentIdMap(RCS_REPLY_AGENT_ID_MAP_JSON);
function normalizeRcsAddress(addr) {
  const raw = String(addr || "").trim();
  if (!raw)
    return "";
  const last = raw.includes(":") ? raw.split(":").pop() || raw : raw;
  const cleaned = last.replace(/[^\d+]/g, "");
  if (!cleaned)
    return "";
  if (cleaned.startsWith("+"))
    return cleaned;
  return cleaned;
}
function sanitizeBedrockSessionIdPart(input) {
  return String(input || "").trim().replace(/[^0-9a-zA-Z._:-]/g, "-");
}
function buildSessionId(clinicId, from) {
  const rawPhone = normalizeRcsAddress(from) || "unknown";
  const digits = rawPhone.replace(/\D/g, "");
  const phonePart = digits || sanitizeBedrockSessionIdPart(rawPhone) || "unknown";
  const clinicPart = sanitizeBedrockSessionIdPart(clinicId) || "unknown";
  return `rcs:${clinicPart}:${phonePart}`.slice(0, 96);
}
async function getClinicAutoReplyConfig(clinicId) {
  if (!RCS_MESSAGES_TABLE)
    return null;
  try {
    const resp = await ddb.send(new import_lib_dynamodb.GetCommand({
      TableName: RCS_MESSAGES_TABLE,
      Key: {
        pk: `CLINIC#${clinicId}`,
        sk: CONFIG_SK
      }
    }));
    const item = resp.Item;
    if (!item)
      return null;
    return {
      enabled: item.enabled === true,
      agentId: typeof item.agentId === "string" ? item.agentId : void 0,
      agentName: typeof item.agentName === "string" ? item.agentName : void 0
    };
  } catch (err) {
    console.error("[RcsAutoReply] Failed to read clinic auto-reply config:", err);
    return null;
  }
}
function looksLikeOptOut(body) {
  const t = (body || "").trim().toLowerCase();
  if (!t)
    return false;
  return t === "stop" || t === "unsubscribe" || t === "cancel" || t === "end" || t === "quit";
}
function pickPreferredAgent(candidates) {
  if (candidates.length === 0)
    return null;
  const prepared = candidates.filter(
    (a) => a.isActive === true && a.bedrockAgentStatus === "PREPARED" && !!a.bedrockAgentId && !!a.bedrockAgentAliasId
  );
  if (prepared.length === 0)
    return null;
  const tagged = prepared.filter(
    (a) => Array.isArray(a.tags) && a.tags.some((t) => String(t).trim().toLowerCase() === RCS_REPLY_AGENT_TAG)
  );
  if (tagged.length > 0)
    return tagged[0];
  const website = prepared.filter((a) => a.isWebsiteEnabled === true);
  if (website.length > 0)
    return website[0];
  return prepared[0];
}
async function getAgentById(agentId) {
  const resp = await ddb.send(
    new import_lib_dynamodb.GetCommand({
      TableName: AI_AGENTS_TABLE,
      Key: { agentId }
    })
  );
  return resp.Item || null;
}
async function getClinicAgents(clinicId) {
  const params = {
    TableName: AI_AGENTS_TABLE,
    IndexName: "ClinicIndex",
    KeyConditionExpression: "clinicId = :clinicId",
    ExpressionAttributeValues: { ":clinicId": clinicId },
    ScanIndexForward: false,
    Limit: 50
  };
  const resp = await ddb.send(new import_lib_dynamodb.QueryCommand(params));
  return resp.Items || [];
}
async function resolveAgentForClinic(clinicId) {
  const mapped = agentIdMap[clinicId];
  if (mapped)
    return await getAgentById(mapped);
  if (RCS_REPLY_AGENT_ID)
    return await getAgentById(RCS_REPLY_AGENT_ID);
  const agents = await getClinicAgents(clinicId);
  return pickPreferredAgent(agents);
}
async function logConversation(item) {
  if (!AI_AGENT_CONVERSATIONS_TABLE)
    return;
  const ttl = Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60;
  try {
    await ddb.send(
      new import_lib_dynamodb.PutCommand({
        TableName: AI_AGENT_CONVERSATIONS_TABLE,
        Item: { ...item, ttl }
      })
    );
  } catch (err) {
    console.error("[RcsAutoReply] Failed to log conversation message:", err);
  }
}
async function markReplyIdempotency(clinicId, messageSid) {
  if (!RCS_MESSAGES_TABLE)
    return true;
  try {
    await ddb.send(
      new import_lib_dynamodb.PutCommand({
        TableName: RCS_MESSAGES_TABLE,
        Item: {
          pk: `CLINIC#${clinicId}`,
          sk: `AI_REPLY_SID#${messageSid}`,
          clinicId,
          messageSid,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          ttl: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
          // 7 days (enough for retries)
        },
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}
async function releaseReplyIdempotency(clinicId, messageSid) {
  if (!RCS_MESSAGES_TABLE)
    return;
  try {
    await ddb.send(new import_lib_dynamodb.DeleteCommand({
      TableName: RCS_MESSAGES_TABLE,
      Key: {
        pk: `CLINIC#${clinicId}`,
        sk: `AI_REPLY_SID#${messageSid}`
      }
    }));
  } catch (err) {
    console.error("[RcsAutoReply] Failed to release idempotency record:", err);
  }
}
async function invokeSendRcsMessage(args) {
  if (!RCS_SEND_MESSAGE_FUNCTION_ARN) {
    return { ok: false, error: "RCS_SEND_MESSAGE_FUNCTION_ARN not set" };
  }
  const invokeEvent = {
    httpMethod: "POST",
    body: JSON.stringify({
      clinicId: args.clinicId,
      to: args.to,
      body: args.body,
      ...args.campaignId ? { campaignId: args.campaignId } : {},
      ...args.campaignName ? { campaignName: args.campaignName } : {},
      ...args.aiAgentId ? { aiAgentId: args.aiAgentId } : {},
      ...args.aiAgentName ? { aiAgentName: args.aiAgentName } : {},
      ...args.aiSessionId ? { aiSessionId: args.aiSessionId } : {},
      ...args.inReplyToSid ? { inReplyToSid: args.inReplyToSid } : {}
    })
  };
  const resp = await lambdaClient.send(
    new import_client_lambda.InvokeCommand({
      FunctionName: RCS_SEND_MESSAGE_FUNCTION_ARN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(invokeEvent))
    })
  );
  if (resp.FunctionError) {
    const rawErr = resp.Payload ? Buffer.from(resp.Payload).toString("utf-8") : "";
    return { ok: false, error: rawErr || resp.FunctionError };
  }
  const raw = resp.Payload ? Buffer.from(resp.Payload).toString("utf-8") : "";
  const apiResult = raw ? safeJsonParse(raw) : null;
  const statusCode = Number(apiResult?.statusCode || 0);
  const bodyStr = apiResult?.body;
  const bodyObj = typeof bodyStr === "string" ? safeJsonParse(bodyStr) : null;
  if (statusCode >= 200 && statusCode < 300 && bodyObj?.success) {
    return { ok: true, messageSid: bodyObj.messageSid, statusCode };
  }
  if (statusCode >= 200 && statusCode < 300 && bodyObj?.skipped) {
    return {
      ok: true,
      skipped: true,
      reason: bodyObj?.reason,
      error: bodyObj?.message || bodyObj?.error || bodyObj?.reason,
      statusCode
    };
  }
  return {
    ok: false,
    statusCode,
    error: bodyObj?.error || bodyObj?.message || bodyObj?.reason || (typeof bodyStr === "string" ? bodyStr : raw) || "RCS send failed"
  };
}
async function invokeBedrockAgent(args) {
  const invokeCmd = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
    agentId: args.bedrockAgentId,
    agentAliasId: args.bedrockAgentAliasId,
    sessionId: args.sessionId,
    inputText: args.inputText,
    enableTrace: false,
    endSession: false,
    sessionState: {
      sessionAttributes: args.sessionAttributes,
      promptSessionAttributes: args.promptSessionAttributes
    }
  });
  const bedrockResp = await bedrockAgentRuntime.send(invokeCmd);
  let responseText = "";
  if (bedrockResp.completion) {
    for await (const evt of bedrockResp.completion) {
      if (evt.chunk?.bytes) {
        responseText += new TextDecoder().decode(evt.chunk.bytes);
      }
    }
  }
  return (responseText || "").trim();
}
var handler = async (event) => {
  if (!RCS_REPLY_ENABLED) {
    console.log("[RcsAutoReply] Disabled via RCS_REPLY_ENABLED=false");
    return;
  }
  const clinicId = String(event?.clinicId || "").trim();
  const messageSid = String(event?.messageSid || "").trim();
  const fromRaw = String(event?.from || "").trim();
  const bodyRaw = String(event?.body || "").trim();
  if (!clinicId || !messageSid || !fromRaw) {
    console.warn("[RcsAutoReply] Missing required fields", { clinicId, messageSid, from: fromRaw });
    return;
  }
  if (!bodyRaw) {
    console.log("[RcsAutoReply] Empty body - skipping");
    return;
  }
  if (looksLikeOptOut(bodyRaw)) {
    console.log("[RcsAutoReply] Opt-out keyword detected - skipping AI reply", { clinicId, messageSid });
    return;
  }
  if (!AI_AGENTS_TABLE) {
    console.error("[RcsAutoReply] AI_AGENTS_TABLE not set - cannot resolve agent");
    return;
  }
  const config = await getClinicAutoReplyConfig(clinicId);
  if (!config || config.enabled !== true) {
    console.log("[RcsAutoReply] Auto-reply disabled (or not configured) - skipping", { clinicId, messageSid });
    return;
  }
  let agent = null;
  const configuredAgentId = (config.agentId || "").trim();
  if (configuredAgentId) {
    agent = await getAgentById(configuredAgentId);
    const belongsToClinic = agent?.clinicId === clinicId || agent?.isPublic === true;
    const isPrepared = agent?.isActive === true && agent?.bedrockAgentStatus === "PREPARED" && !!agent?.bedrockAgentId && !!agent?.bedrockAgentAliasId;
    if (!agent || !belongsToClinic || !isPrepared) {
      console.warn("[RcsAutoReply] Configured agent invalid/not ready - skipping", {
        clinicId,
        configuredAgentId,
        found: !!agent,
        belongsToClinic,
        status: agent?.bedrockAgentStatus,
        isActive: agent?.isActive
      });
      return;
    }
  } else {
    agent = await resolveAgentForClinic(clinicId);
  }
  if (!agent?.bedrockAgentId || !agent?.bedrockAgentAliasId || agent.bedrockAgentStatus !== "PREPARED" || agent.isActive !== true) {
    console.warn("[RcsAutoReply] No prepared/active agent found for clinic - skipping", {
      clinicId,
      resolvedAgentId: agent?.agentId,
      status: agent?.bedrockAgentStatus
    });
    return;
  }
  const canProceed = await markReplyIdempotency(clinicId, messageSid);
  if (!canProceed) {
    console.log("[RcsAutoReply] Duplicate messageSid - already replied", { clinicId, messageSid });
    return;
  }
  const sessionId = buildSessionId(clinicId, fromRaw);
  const patientAddress = normalizeRcsAddress(fromRaw) || fromRaw;
  const start = Date.now();
  try {
    await logConversation({
      sessionId,
      timestamp: event.timestamp || Date.now(),
      messageType: "user",
      content: bodyRaw,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId: patientAddress,
      channel: "rcs",
      isPublicChat: true
    });
    const sessionAttributes = {
      clinicId,
      channel: "rcs",
      userId: patientAddress,
      userName: event.profileName ? String(event.profileName).slice(0, 80) : "Patient",
      from: patientAddress
    };
    const promptSessionAttributes = {
      channel: "rcs",
      clinicId
    };
    let replyText = "";
    try {
      replyText = await invokeBedrockAgent({
        bedrockAgentId: agent.bedrockAgentId,
        bedrockAgentAliasId: agent.bedrockAgentAliasId,
        sessionId,
        inputText: bodyRaw,
        sessionAttributes,
        promptSessionAttributes
      });
    } catch (err) {
      console.error("[RcsAutoReply] Bedrock InvokeAgent failed", err);
      await logConversation({
        sessionId,
        timestamp: Date.now(),
        messageType: "error",
        content: `InvokeAgent failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        clinicId,
        agentId: agent.agentId,
        agentName: agent.name,
        visitorId: patientAddress,
        channel: "rcs",
        isPublicChat: true
      });
      throw err;
    }
    if (!replyText) {
      replyText = "Thanks for reaching out \u2014 how can I help you today?";
    }
    if (replyText.length > 1200) {
      replyText = replyText.slice(0, 1190).trimEnd() + "\u2026";
    }
    const sendResult = await invokeSendRcsMessage({
      clinicId,
      to: patientAddress,
      body: replyText,
      campaignId: "ai-auto-reply",
      campaignName: "AI Auto Reply",
      aiAgentId: agent.agentId,
      aiAgentName: agent.name || config.agentName,
      aiSessionId: sessionId,
      inReplyToSid: messageSid
    });
    const latencyMs = Date.now() - start;
    await logConversation({
      sessionId,
      timestamp: Date.now(),
      messageType: "assistant",
      content: replyText,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId: patientAddress,
      channel: "rcs",
      isPublicChat: true,
      responseTimeMs: latencyMs
    });
    if (!sendResult.ok) {
      console.warn("[RcsAutoReply] Failed to send RCS reply", {
        clinicId,
        messageSid,
        to: patientAddress,
        error: sendResult.error,
        statusCode: sendResult.statusCode
      });
      throw new Error(sendResult.error || "Failed to send RCS reply");
    }
    if (sendResult.skipped) {
      console.log("[RcsAutoReply] RCS reply skipped", {
        clinicId,
        inboundMessageSid: messageSid,
        agentId: agent.agentId,
        sessionId,
        reason: sendResult.reason,
        message: sendResult.error
      });
      return;
    }
    console.log("[RcsAutoReply] Sent RCS AI reply", {
      clinicId,
      inboundMessageSid: messageSid,
      outboundMessageSid: sendResult.messageSid,
      agentId: agent.agentId,
      sessionId,
      durationMs: latencyMs
    });
  } catch (err) {
    await releaseReplyIdempotency(clinicId, messageSid);
    throw err;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

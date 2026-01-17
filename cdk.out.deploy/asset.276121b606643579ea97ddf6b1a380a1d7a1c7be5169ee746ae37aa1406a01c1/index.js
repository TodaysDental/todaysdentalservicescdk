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

// src/services/ai-agents/websocket-message.ts
var websocket_message_exports = {};
__export(websocket_message_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(websocket_message_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");
var import_client_apigatewaymanagementapi = require("@aws-sdk/client-apigatewaymanagementapi");

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

// src/services/ai-agents/websocket-message.ts
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var bedrockAgentClient = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "AiAgentConnections";
var CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "AiAgentConversations";
async function logMessage(message) {
  const ttl = Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60;
  try {
    await docClient.send(new import_lib_dynamodb.PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        ...message,
        ttl
      }
    }));
  } catch (error) {
    console.error("[LogMessage] Failed to log conversation message:", error);
  }
}
var RATE_LIMIT = {
  MAX_MESSAGES_PER_MINUTE: 20,
  // Max messages per connection per minute
  MESSAGE_WINDOW_MS: 60 * 1e3,
  // 1 minute window
  MAX_MESSAGE_LENGTH: 4e3,
  // Max characters per message
  MAX_SESSION_MESSAGES: 100
  // Max messages per session (aligned with REST API)
};
var RATE_LIMIT_TTL_SECONDS = 300;
async function checkRateLimit(connectionId) {
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_LIMIT.MESSAGE_WINDOW_MS) * RATE_LIMIT.MESSAGE_WINDOW_MS;
  const ttl = Math.floor(now / 1e3) + RATE_LIMIT_TTL_SECONDS;
  try {
    const response = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    const connection = response.Item;
    if (!connection) {
      return { allowed: false, reason: "Connection not found. Please reconnect." };
    }
    const storedWindowStart = connection.rateLimitWindowStart || 0;
    const isNewWindow = windowStart > storedWindowStart;
    const currentCount = isNewWindow ? 0 : connection.rateLimitCount || 0;
    if (currentCount >= RATE_LIMIT.MAX_MESSAGES_PER_MINUTE) {
      const timeLeft = Math.ceil((storedWindowStart + RATE_LIMIT.MESSAGE_WINDOW_MS - now) / 1e3);
      return {
        allowed: false,
        reason: `Rate limit exceeded. Please wait ${Math.max(1, timeLeft)} seconds before sending more messages.`
      };
    }
    const sessionMessageCount = connection.sessionMessageCount || 0;
    if (sessionMessageCount >= RATE_LIMIT.MAX_SESSION_MESSAGES) {
      return {
        allowed: false,
        reason: "Session message limit reached. Please start a new session by reconnecting."
      };
    }
    const expressionAttributeValues = {
      ":one": 1,
      ":zero": 0,
      ":ttl": ttl
    };
    if (isNewWindow) {
      expressionAttributeValues[":windowStart"] = windowStart;
    }
    await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: isNewWindow ? "SET rateLimitCount = :one, rateLimitWindowStart = :windowStart, sessionMessageCount = if_not_exists(sessionMessageCount, :zero) + :one, #ttl = :ttl" : "SET rateLimitCount = rateLimitCount + :one, sessionMessageCount = if_not_exists(sessionMessageCount, :zero) + :one, #ttl = :ttl",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: expressionAttributeValues
    }));
    return { allowed: true };
  } catch (error) {
    console.error("[RateLimit] Error checking rate limit:", error);
    return { allowed: true };
  }
}
function createApiGatewayClient(event) {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const apiId = event.requestContext.apiId;
  const region = process.env.AWS_REGION || "us-east-1";
  let endpoint;
  if (domain.includes("execute-api.amazonaws.com")) {
    endpoint = `https://${domain}/${stage}`;
  } else {
    endpoint = `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`;
    console.log(`[WsMessage] Using execute-api endpoint for @connections: ${endpoint}`);
  }
  return new import_client_apigatewaymanagementapi.ApiGatewayManagementApiClient({ endpoint });
}
async function sendToClient(apiClient, connectionId, data) {
  try {
    await apiClient.send(new import_client_apigatewaymanagementapi.PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data))
    }));
    return true;
  } catch (error) {
    if (error.statusCode === 410) {
      console.log("Stale connection, removing:", connectionId);
      return false;
    }
    console.error("Error sending to client:", error);
    return false;
  }
}
var handler = async (event) => {
  console.log("WebSocket Message:", JSON.stringify(event, null, 2));
  const connectionId = event.requestContext.connectionId;
  const apiClient = createApiGatewayClient(event);
  try {
    const body = JSON.parse(event.body || "{}");
    if (!body.message) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "message is required"
      });
      return { statusCode: 400 };
    }
    if (body.message.length > RATE_LIMIT.MAX_MESSAGE_LENGTH) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: `Message too long. Maximum ${RATE_LIMIT.MAX_MESSAGE_LENGTH} characters allowed.`
      });
      return { statusCode: 400 };
    }
    const rateLimitCheck = await checkRateLimit(connectionId);
    if (!rateLimitCheck.allowed) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: rateLimitCheck.reason || "Rate limit exceeded."
      });
      return { statusCode: 429 };
    }
    const connectionResponse = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    const connectionInfo = connectionResponse.Item;
    if (!connectionInfo) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Connection not found. Please reconnect."
      });
      return { statusCode: 400 };
    }
    const { clinicId, agentId } = connectionInfo;
    const agentResponse = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId }
    }));
    const agent = agentResponse.Item;
    if (!agent) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent not found"
      });
      return { statusCode: 404 };
    }
    if (!agent.isActive || !agent.isWebsiteEnabled) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent is not available for website chat"
      });
      return { statusCode: 403 };
    }
    if (agent.clinicId !== clinicId && !agent.isPublic) {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent does not belong to this clinic"
      });
      return { statusCode: 403 };
    }
    if (!agent.bedrockAgentId || !agent.bedrockAgentAliasId || agent.bedrockAgentStatus !== "PREPARED") {
      await sendToClient(apiClient, connectionId, {
        type: "error",
        content: "Agent is not ready. Please try again later."
      });
      return { statusCode: 400 };
    }
    let sessionId;
    if (connectionInfo.sessionId) {
      sessionId = connectionInfo.sessionId;
      if (body.sessionId && body.sessionId !== connectionInfo.sessionId) {
        console.warn(`[WebSocket] Client ${connectionId} attempted to use sessionId ${body.sessionId} but is bound to ${connectionInfo.sessionId}`);
      }
    } else {
      sessionId = `ws-${connectionId.slice(0, 8)}-${v4_default()}`;
      try {
        await docClient.send(new import_lib_dynamodb.UpdateCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId },
          UpdateExpression: "SET sessionId = :sid",
          ExpressionAttributeValues: { ":sid": sessionId },
          // Only set if not already set (prevents race condition)
          ConditionExpression: "attribute_not_exists(sessionId)"
        }));
      } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
          const refreshedConn = await docClient.send(new import_lib_dynamodb.GetCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId }
          }));
          sessionId = refreshedConn.Item?.sessionId || sessionId;
        } else {
          throw error;
        }
      }
    }
    const sessionAttributes = {
      clinicId,
      userId: body.visitorId || `visitor-${v4_default().slice(0, 8)}`,
      userName: body.visitorName || "Website Visitor",
      isPublicRequest: "true",
      connectionId
      // Track which connection owns this session
    };
    const userMessageTimestamp = Date.now();
    const visitorId = sessionAttributes.userId;
    const visitorName = sessionAttributes.userName;
    logMessage({
      sessionId,
      timestamp: userMessageTimestamp,
      messageType: "user",
      content: body.message,
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId,
      channel: "websocket",
      isPublicChat: true
    });
    await sendToClient(apiClient, connectionId, {
      type: "thinking",
      content: "Processing your request...",
      sessionId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const invokeStartTime = Date.now();
    const invokeCommand = new import_client_bedrock_agent_runtime.InvokeAgentCommand({
      agentId: agent.bedrockAgentId,
      agentAliasId: agent.bedrockAgentAliasId,
      sessionId,
      inputText: body.message,
      enableTrace: true,
      // Enable thinking/trace
      sessionState: {
        sessionAttributes
      }
    });
    const bedrockResponse = await bedrockAgentClient.send(invokeCommand);
    let fullResponse = "";
    if (bedrockResponse.completion) {
      for await (const event2 of bedrockResponse.completion) {
        if (event2.trace?.trace) {
          const trace = event2.trace.trace;
          if (trace.preProcessingTrace) {
            const preProc = trace.preProcessingTrace;
            if (preProc.modelInvocationOutput?.parsedResponse?.rationale) {
              await sendToClient(apiClient, connectionId, {
                type: "thinking",
                content: `Understanding: ${preProc.modelInvocationOutput.parsedResponse.rationale}`,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          }
          if (trace.orchestrationTrace) {
            const orch = trace.orchestrationTrace;
            if (orch.modelInvocationOutput?.rawResponse?.content) {
              const content = orch.modelInvocationOutput.rawResponse.content;
              if (typeof content === "string") {
                const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
                if (thinkingMatch) {
                  await sendToClient(apiClient, connectionId, {
                    type: "thinking",
                    content: thinkingMatch[1].trim(),
                    timestamp: (/* @__PURE__ */ new Date()).toISOString()
                  });
                }
              }
            }
            if (orch.invocationInput?.actionGroupInvocationInput) {
              const action = orch.invocationInput.actionGroupInvocationInput;
              await sendToClient(apiClient, connectionId, {
                type: "tool_use",
                toolName: action.apiPath?.replace("/", "") || "unknown",
                toolInput: action.parameters || action.requestBody,
                content: `Calling: ${action.apiPath}`,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
            if (orch.observation?.actionGroupInvocationOutput) {
              const result = orch.observation.actionGroupInvocationOutput;
              let resultContent = "Tool completed";
              try {
                const parsed = JSON.parse(result.text || "{}");
                if (parsed.status === "SUCCESS") {
                  resultContent = parsed.message || "Operation successful";
                } else if (parsed.status === "FAILURE") {
                  resultContent = parsed.message || "Operation failed";
                }
              } catch {
              }
              await sendToClient(apiClient, connectionId, {
                type: "tool_result",
                content: resultContent,
                toolResult: result.text,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
            if (orch.rationale?.text) {
              await sendToClient(apiClient, connectionId, {
                type: "thinking",
                content: orch.rationale.text,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          }
          if (trace.postProcessingTrace?.modelInvocationOutput?.parsedResponse) {
            const postProc = trace.postProcessingTrace.modelInvocationOutput.parsedResponse;
            if (postProc.text) {
              await sendToClient(apiClient, connectionId, {
                type: "thinking",
                content: `Finalizing: ${postProc.text}`,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          }
        }
        if (event2.chunk?.bytes) {
          const chunk = new TextDecoder().decode(event2.chunk.bytes);
          fullResponse += chunk;
          await sendToClient(apiClient, connectionId, {
            type: "chunk",
            content: chunk,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
    }
    await sendToClient(apiClient, connectionId, {
      type: "complete",
      content: fullResponse || "No response from agent",
      sessionId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const responseTimeMs = Date.now() - invokeStartTime;
    logMessage({
      sessionId,
      timestamp: Date.now(),
      messageType: "assistant",
      content: fullResponse || "No response from agent",
      clinicId,
      agentId: agent.agentId,
      agentName: agent.name,
      visitorId,
      channel: "websocket",
      isPublicChat: true,
      responseTimeMs
    });
    await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: AGENTS_TABLE,
      Key: { agentId },
      UpdateExpression: "SET usageCount = if_not_exists(usageCount, :zero) + :one",
      ExpressionAttributeValues: { ":zero": 0, ":one": 1 }
    }));
    return { statusCode: 200 };
  } catch (error) {
    console.error("WebSocket message error:", error);
    await sendToClient(apiClient, connectionId, {
      type: "error",
      content: error.message || "An error occurred processing your request",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { statusCode: 500 };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

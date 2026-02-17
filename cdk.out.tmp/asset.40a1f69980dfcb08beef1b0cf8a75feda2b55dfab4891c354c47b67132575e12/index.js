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

// src/services/ai-agents/websocket-disconnect.ts
var websocket_disconnect_exports = {};
__export(websocket_disconnect_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(websocket_disconnect_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "AiAgentConnections";
var CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "AiAgentConversations";
var handler = async (event) => {
  console.log("WebSocket Disconnect:", JSON.stringify(event, null, 2));
  const connectionId = event.requestContext.connectionId;
  try {
    const connectionResponse = await docClient.send(new import_lib_dynamodb.GetCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    const connection = connectionResponse.Item;
    const sessionId = connection?.sessionId;
    if (sessionId && CONVERSATIONS_TABLE) {
      try {
        await docClient.send(new import_lib_dynamodb.UpdateCommand({
          TableName: CONVERSATIONS_TABLE,
          Key: {
            sessionId,
            timestamp: Date.now()
            // New message marking session end
          },
          UpdateExpression: "SET messageType = :type, content = :content, sessionExpiredAt = :now, expiredByConnectionId = :connId",
          ExpressionAttributeValues: {
            ":type": "system",
            ":content": "Session ended - connection closed",
            ":now": (/* @__PURE__ */ new Date()).toISOString(),
            ":connId": connectionId
          }
        }));
        console.log("[Disconnect] Session marked as expired:", { sessionId, connectionId });
      } catch (sessionErr) {
        console.warn("[Disconnect] Failed to mark session as expired (non-fatal):", sessionErr);
      }
    }
    await docClient.send(new import_lib_dynamodb.DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    console.log("Connection removed:", connectionId);
  } catch (error) {
    console.error("Error removing connection:", error);
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Disconnected" })
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

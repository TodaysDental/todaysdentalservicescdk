// src/services/comm/rest-api-handler.ts
import { DynamoDBClient as DynamoDBClient2 } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient as DynamoDBDocumentClient2, GetCommand, PutCommand as PutCommand2, UpdateCommand, QueryCommand as QueryCommand2, ScanCommand } from "@aws-sdk/lib-dynamodb";

// node_modules/uuid/dist/esm-node/rng.js
import crypto from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto.randomFillSync(rnds8Pool);
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
import crypto2 from "crypto";
var native_default = {
  randomUUID: crypto2.randomUUID
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

// src/services/comm/audit-service.ts
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
var AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || "";
var REGION = process.env.AWS_REGION || "us-east-1";
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
var TTL_DAYS = 90;
var TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;
var AuditService = class {
  /**
   * Log an action asynchronously (non-blocking, fire and forget)
   * This does not await the DynamoDB write to avoid impacting API latency
   */
  static logAction(params) {
    if (!AUDIT_LOGS_TABLE) {
      console.warn("[AUDIT] Table not configured, skipping audit log");
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const expiryDate = Math.floor(now.getTime() / 1e3) + TTL_SECONDS;
    const auditLog = {
      auditID: v4_default(),
      timestamp: now.toISOString(),
      userID: params.userID,
      action: params.action,
      resourceType: params.resourceType,
      resourceID: params.resourceID,
      httpMethod: params.httpMethod,
      endpoint: params.endpoint,
      status: params.status,
      statusCode: params.statusCode,
      expiryDate,
      ...params.errorMessage && { errorMessage: params.errorMessage },
      ...params.changes && { changes: params.changes },
      ...params.ipAddress && { ipAddress: params.ipAddress },
      ...params.userAgent && { userAgent: params.userAgent },
      ...params.durationMs && { durationMs: params.durationMs },
      ...params.metadata && { metadata: params.metadata }
    };
    ddb.send(new PutCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: auditLog
    })).catch((err) => {
      console.error("[AUDIT] Failed to write audit log:", err);
    });
  }
  /**
   * Log an action and await the write (blocking)
   * Use this when you need confirmation that the audit was recorded
   */
  static async logActionAsync(params) {
    if (!AUDIT_LOGS_TABLE) {
      console.warn("[AUDIT] Table not configured, skipping audit log");
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const expiryDate = Math.floor(now.getTime() / 1e3) + TTL_SECONDS;
    const auditLog = {
      auditID: v4_default(),
      timestamp: now.toISOString(),
      userID: params.userID,
      action: params.action,
      resourceType: params.resourceType,
      resourceID: params.resourceID,
      httpMethod: params.httpMethod,
      endpoint: params.endpoint,
      status: params.status,
      statusCode: params.statusCode,
      expiryDate,
      ...params.errorMessage && { errorMessage: params.errorMessage },
      ...params.changes && { changes: params.changes },
      ...params.ipAddress && { ipAddress: params.ipAddress },
      ...params.userAgent && { userAgent: params.userAgent },
      ...params.durationMs && { durationMs: params.durationMs },
      ...params.metadata && { metadata: params.metadata }
    };
    try {
      await ddb.send(new PutCommand({
        TableName: AUDIT_LOGS_TABLE,
        Item: auditLog
      }));
    } catch (err) {
      console.error("[AUDIT] Failed to write audit log:", err);
    }
  }
  /**
   * Get audit logs for a specific user
   */
  static async getUserAuditLogs(userID, limit = 50) {
    if (!AUDIT_LOGS_TABLE)
      return [];
    try {
      const result = await ddb.send(new QueryCommand({
        TableName: AUDIT_LOGS_TABLE,
        IndexName: "UserIDIndex",
        KeyConditionExpression: "userID = :uid",
        ExpressionAttributeValues: { ":uid": userID },
        ScanIndexForward: false,
        // Most recent first
        Limit: limit
      }));
      return result.Items || [];
    } catch (err) {
      console.error("[AUDIT] Failed to query user audit logs:", err);
      return [];
    }
  }
  /**
   * Get audit logs for a specific resource (change history)
   */
  static async getResourceAuditLogs(resourceID, limit = 50) {
    if (!AUDIT_LOGS_TABLE)
      return [];
    try {
      const result = await ddb.send(new QueryCommand({
        TableName: AUDIT_LOGS_TABLE,
        IndexName: "ResourceIndex",
        KeyConditionExpression: "resourceID = :id",
        ExpressionAttributeValues: { ":id": resourceID },
        ScanIndexForward: false,
        // Most recent first
        Limit: limit
      }));
      return result.Items || [];
    } catch (err) {
      console.error("[AUDIT] Failed to query resource audit logs:", err);
      return [];
    }
  }
  /**
   * Get audit logs for a specific action type
   */
  static async getActionAuditLogs(action, limit = 50) {
    if (!AUDIT_LOGS_TABLE)
      return [];
    try {
      const result = await ddb.send(new QueryCommand({
        TableName: AUDIT_LOGS_TABLE,
        IndexName: "ActionIndex",
        KeyConditionExpression: "action = :act",
        ExpressionAttributeValues: { ":act": action },
        ScanIndexForward: false,
        // Most recent first
        Limit: limit
      }));
      return result.Items || [];
    } catch (err) {
      console.error("[AUDIT] Failed to query action audit logs:", err);
      return [];
    }
  }
};

// src/services/comm/rest-api-handler.ts
var REGION2 = process.env.AWS_REGION || "us-east-1";
var FAVORS_TABLE = process.env.FAVORS_TABLE || "";
var TEAMS_TABLE = process.env.TEAMS_TABLE || "";
var MEETINGS_TABLE = process.env.MEETINGS_TABLE || "";
var MESSAGES_TABLE = process.env.MESSAGES_TABLE || "";
var LOG_LEVEL = process.env.LOG_LEVEL || "INFO";
var MAX_GROUP_MEMBERS = 100;
var LOG_LEVEL_PRIORITY = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
var log = {
  _shouldLog(level) {
    const configuredLevel = LOG_LEVEL.toUpperCase() || "INFO";
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
  },
  _formatLog(level, message, context, error) {
    const logEntry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      service: "comm-rest-api",
      ...context && { context }
    };
    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    return JSON.stringify(logEntry);
  },
  debug(message, context) {
    if (this._shouldLog("DEBUG")) {
      const formatted = this._formatLog("DEBUG", message, context);
      console.log(formatted);
      console.log(`[DEBUG] ${message}`, context || "");
    }
  },
  info(message, context) {
    if (this._shouldLog("INFO")) {
      const formatted = this._formatLog("INFO", message, context);
      console.log(formatted);
      console.log(`[INFO] ${message}`, context || "");
    }
  },
  warn(message, context) {
    if (this._shouldLog("WARN")) {
      const formatted = this._formatLog("WARN", message, context);
      console.warn(formatted);
      console.warn(`[WARN] ${message}`, context || "");
    }
  },
  error(message, context, error) {
    if (this._shouldLog("ERROR")) {
      const formatted = this._formatLog("ERROR", message, context, error);
      console.error(formatted);
      console.error(`[ERROR] ${message}`, context || "", error || "");
    }
  },
  // Specialized logging methods
  request(event, userID) {
    this.info("Incoming request", {
      requestId: event.requestContext.requestId,
      userID: userID || "unauthenticated",
      httpMethod: event.httpMethod,
      path: event.path,
      queryParams: event.queryStringParameters,
      hasBody: !!event.body,
      sourceIp: event.requestContext.identity?.sourceIp,
      userAgent: event.requestContext.identity?.userAgent
    });
  },
  dbOperation(operation, table, details, context) {
    this.debug(`DynamoDB ${operation}`, {
      ...context,
      operation,
      table,
      ...details
    });
  },
  dbResult(operation, table, itemCount, durationMs, context) {
    this.debug(`DynamoDB ${operation} completed`, {
      ...context,
      operation,
      table,
      itemCount,
      durationMs
    });
  },
  validation(field, reason, context) {
    this.warn("Validation failure", {
      ...context,
      validationField: field,
      validationReason: reason
    });
  },
  flowCount(functionName, step, count, context) {
    this.debug(`Flow count: ${step}`, {
      ...context,
      function: functionName,
      step,
      count
    });
  },
  response(statusCode, success, durationMs, context) {
    const level = statusCode >= 500 ? "ERROR" : statusCode >= 400 ? "WARN" : "INFO";
    const method = level === "ERROR" ? this.error.bind(this) : level === "WARN" ? this.warn.bind(this) : this.info.bind(this);
    method("Request completed", {
      ...context,
      statusCode,
      success,
      durationMs
    });
  }
};
var SYSTEM_MODULES = ["HR", "Accounting", "Operations", "Finance", "Marketing", "Legal", "IT"];
var ddb2 = DynamoDBDocumentClient2.from(new DynamoDBClient2({ region: REGION2 }));
function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}
function getUserIdFromEvent(event) {
  const authorizer = event.requestContext.authorizer;
  console.log("DEBUG: Authorizer object:", JSON.stringify(authorizer, null, 2));
  if (!authorizer) {
    console.error("ERROR: No authorizer in request context");
    return null;
  }
  const claims = authorizer.claims;
  console.log("DEBUG: Claims from authorizer:", JSON.stringify(claims, null, 2));
  const userID = claims?.sub || claims?.["cognito:username"] || claims?.["sub"] || authorizer?.principalId;
  if (!userID) {
    console.error("ERROR: Could not extract userID from claims or principalId");
    console.error("DEBUG: Authorizer keys:", Object.keys(authorizer));
  } else {
    console.log("DEBUG: Successfully extracted userID:", userID);
  }
  return userID || null;
}
var handler = async (event) => {
  const handlerStartTime = Date.now();
  const requestId = event.requestContext.requestId;
  const { httpMethod, path, pathParameters, queryStringParameters, body } = event;
  console.log("=== INCOMING REQUEST ===");
  console.log("RequestID:", requestId);
  console.log("Method:", httpMethod);
  console.log("Path:", path);
  console.log("RequestContext:", JSON.stringify(event.requestContext, null, 2));
  console.log("========================");
  const userID = getUserIdFromEvent(event);
  log.request(event, userID);
  if (!userID) {
    console.error("CRITICAL: Failed to extract userID from event");
    console.error("Full event.requestContext.authorizer:", JSON.stringify(event.requestContext.authorizer, null, 2));
    log.warn("Authentication failed - no userID extracted", { requestId, path, httpMethod });
    log.response(401, false, Date.now() - handlerStartTime, { requestId });
    return response(401, { success: false, message: "Unauthorized - Failed to extract user ID from request" });
  }
  const logCtx = { requestId, userID, httpMethod, path };
  try {
    const parsedBody = body ? JSON.parse(body) : {};
    log.debug("Request body parsed", { ...logCtx, hasBody: !!body });
    let result;
    let routeMatched = false;
    if (path.match(/^\/api\/conversations\/search$/)) {
      log.info("Routing to searchConversations", logCtx);
      routeMatched = true;
      result = await searchConversations(userID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/conversations\/profiles$/)) {
      log.info("Routing to getConversationProfiles", logCtx);
      routeMatched = true;
      result = await getConversationProfiles(userID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/conversations\/[^/]+\/complete$/)) {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      log.info("Routing to getConversationComplete", { ...logCtx, favorRequestID });
      routeMatched = true;
      result = await getConversationComplete(userID, favorRequestID, logCtx);
    } else if (path.match(/^\/api\/conversations\/[^/]+\/user-details$/)) {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      log.info("Routing to getConversationUserDetails", { ...logCtx, favorRequestID });
      routeMatched = true;
      result = await getConversationUserDetails(userID, favorRequestID, logCtx);
    } else if (path.match(/^\/api\/conversations\/[^/]+\/deadline$/) && httpMethod === "PUT") {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      log.info("Routing to updateConversationDeadline", { ...logCtx, favorRequestID });
      routeMatched = true;
      result = await updateConversationDeadline(userID, favorRequestID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/conversations\/[^/]+$/) && httpMethod === "DELETE") {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      log.info("Routing to deleteConversation", { ...logCtx, favorRequestID });
      routeMatched = true;
      result = await deleteConversation(userID, favorRequestID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/conversations$/) && httpMethod === "GET") {
      log.info("Routing to getConversations", logCtx);
      routeMatched = true;
      result = await getConversations(userID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/tasks\/by-status$/) && httpMethod === "GET") {
      log.info("Routing to getTasksByStatus", logCtx);
      routeMatched = true;
      result = await getTasksByStatus(userID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/tasks\/forward-history$/) && httpMethod === "GET") {
      log.info("Routing to getForwardHistory", logCtx);
      routeMatched = true;
      result = await getForwardHistory(userID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/tasks\/forwarded-to-me$/) && httpMethod === "GET") {
      log.info("Routing to getForwardedToMe", logCtx);
      routeMatched = true;
      result = await getForwardedToMe(userID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/tasks\/group$/) && httpMethod === "POST") {
      log.info("Routing to createGroupTask", logCtx);
      routeMatched = true;
      result = await createGroupTask(userID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/tasks\/[^/]+\/forward\/[^/]+\/respond$/) && httpMethod === "POST") {
      const parts = path.split("/");
      const taskID = parts[3];
      const forwardID = parts[5];
      log.info("Routing to respondToForward", { ...logCtx, taskID, forwardID });
      routeMatched = true;
      result = await respondToForward(userID, taskID, forwardID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/tasks\/[^/]+\/forward$/) && httpMethod === "POST") {
      const taskID = pathParameters?.taskID || path.split("/")[3];
      log.info("Routing to forwardTask", { ...logCtx, taskID });
      routeMatched = true;
      result = await forwardTask(userID, taskID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/tasks\/[^/]+\/deadline$/) && httpMethod === "PUT") {
      const taskID = pathParameters?.taskID || path.split("/")[3];
      log.info("Routing to updateTaskDeadline", { ...logCtx, taskID });
      routeMatched = true;
      result = await updateTaskDeadline(userID, taskID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/tasks$/) && httpMethod === "POST") {
      log.info("Routing to createTask", logCtx);
      routeMatched = true;
      result = await createTask(userID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === "PUT") {
      const meetingID = pathParameters?.meetingID || path.split("/")[3];
      log.info("Routing to updateMeeting", { ...logCtx, meetingID });
      routeMatched = true;
      result = await updateMeeting(userID, meetingID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === "DELETE") {
      const meetingID = pathParameters?.meetingID || path.split("/")[3];
      log.info("Routing to deleteMeeting", { ...logCtx, meetingID });
      routeMatched = true;
      result = await deleteMeeting(userID, meetingID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/meetings$/) && httpMethod === "POST") {
      log.info("Routing to createMeeting", logCtx);
      routeMatched = true;
      result = await createMeeting(userID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/meetings$/) && httpMethod === "GET") {
      log.info("Routing to getMeetings", logCtx);
      routeMatched = true;
      result = await getMeetings(userID, queryStringParameters, logCtx);
    } else if (path.match(/^\/api\/groups\/[^/]+\/members\/[^/]+$/) && httpMethod === "DELETE") {
      const parts = path.split("/");
      const teamID = parts[3];
      const memberUserID = parts[5];
      log.info("Routing to removeGroupMember", { ...logCtx, teamID, memberUserID });
      routeMatched = true;
      result = await removeGroupMember(userID, teamID, memberUserID, logCtx);
    } else if (path.match(/^\/api\/groups\/[^/]+\/members$/) && httpMethod === "POST") {
      const teamID = pathParameters?.teamID || path.split("/")[3];
      log.info("Routing to addGroupMember", { ...logCtx, teamID });
      routeMatched = true;
      result = await addGroupMember(userID, teamID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === "GET") {
      const teamID = pathParameters?.teamID || path.split("/")[3];
      log.info("Routing to getGroupDetails", { ...logCtx, teamID });
      routeMatched = true;
      result = await getGroupDetails(userID, teamID, logCtx);
    } else if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === "PUT") {
      const teamID = pathParameters?.teamID || path.split("/")[3];
      log.info("Routing to updateGroup", { ...logCtx, teamID });
      routeMatched = true;
      result = await updateGroup(userID, teamID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/groups$/) && httpMethod === "POST") {
      log.info("Routing to createGroup", logCtx);
      routeMatched = true;
      result = await createGroup(userID, parsedBody, logCtx);
    } else if (path.match(/^\/api\/groups$/) && httpMethod === "GET") {
      log.info("Routing to getGroups", logCtx);
      routeMatched = true;
      result = await getGroups(userID, queryStringParameters, logCtx);
    }
    if (!routeMatched) {
      log.warn("No route matched", logCtx);
      log.response(404, false, Date.now() - handlerStartTime, logCtx);
      return response(404, { success: false, message: "Endpoint not found" });
    }
    log.response(result.statusCode, result.statusCode < 400, Date.now() - handlerStartTime, logCtx);
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error("Unhandled error processing request", logCtx, err);
    log.response(500, false, Date.now() - handlerStartTime, logCtx);
    return response(500, { success: false, message: "Internal server error" });
  }
};
async function searchConversations(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "searchConversations" };
  const { query, status, type, sort = "newest", deadline, category, priority, limit = 20, offset = 0 } = params || {};
  log.debug("Search params", { ...fnCtx, query, status, type, sort, category, priority, limit, offset });
  const dbStart = Date.now();
  log.dbOperation("Query", FAVORS_TABLE, { indexes: ["SenderIndex", "ReceiverIndex"], userID }, fnCtx);
  const [sentResult, recvResult] = await Promise.all([
    ddb2.send(new QueryCommand2({
      TableName: FAVORS_TABLE,
      IndexName: "SenderIndex",
      KeyConditionExpression: "senderID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    })),
    ddb2.send(new QueryCommand2({
      TableName: FAVORS_TABLE,
      IndexName: "ReceiverIndex",
      KeyConditionExpression: "receiverID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    }))
  ]);
  log.dbResult("Query", FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0), Date.now() - dbStart, fnCtx);
  let conversations = [...sentResult.Items || [], ...recvResult.Items || []];
  log.flowCount("searchConversations", "rawResults", conversations.length, fnCtx);
  const byId = /* @__PURE__ */ new Map();
  for (const conv of conversations) {
    byId.set(conv.favorRequestID, conv);
  }
  conversations = Array.from(byId.values());
  log.flowCount("searchConversations", "afterDedupe", conversations.length, fnCtx);
  if (query) {
    const q = query.toLowerCase();
    conversations = conversations.filter(
      (c) => c.title?.toLowerCase().includes(q) || c.initialMessage?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
    );
    log.flowCount("searchConversations", "afterQueryFilter", conversations.length, fnCtx);
  }
  if (status) {
    conversations = conversations.filter((c) => c.status === status);
  }
  if (type) {
    conversations = conversations.filter((c) => c.requestType === type);
  }
  if (category) {
    conversations = conversations.filter((c) => c.category === category);
  }
  if (priority) {
    conversations = conversations.filter((c) => c.priority === priority);
  }
  log.flowCount("searchConversations", "afterAllFilters", conversations.length, fnCtx);
  if (sort === "newest") {
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else if (sort === "oldest") {
    conversations.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  } else if (sort === "deadline") {
    conversations.sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
  }
  const total = conversations.length;
  const paginatedConversations = conversations.slice(Number(offset), Number(offset) + Number(limit));
  log.info("searchConversations completed", { ...fnCtx, total, returned: paginatedConversations.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    conversations: paginatedConversations,
    total,
    hasMore: Number(offset) + paginatedConversations.length < total
  });
}
async function getConversationProfiles(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getConversationProfiles" };
  const { tab = "single", status, limit = 50, offset = 0 } = params || {};
  log.debug("Profile params", { ...fnCtx, tab, status, limit, offset });
  const dbStart = Date.now();
  log.dbOperation("Query", FAVORS_TABLE, { indexes: ["SenderIndex", "ReceiverIndex"], userID }, fnCtx);
  const [sentResult, recvResult] = await Promise.all([
    ddb2.send(new QueryCommand2({
      TableName: FAVORS_TABLE,
      IndexName: "SenderIndex",
      KeyConditionExpression: "senderID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    })),
    ddb2.send(new QueryCommand2({
      TableName: FAVORS_TABLE,
      IndexName: "ReceiverIndex",
      KeyConditionExpression: "receiverID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    }))
  ]);
  log.dbResult("Query", FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0), Date.now() - dbStart, fnCtx);
  let items = [...sentResult.Items || [], ...recvResult.Items || []];
  log.flowCount("getConversationProfiles", "rawResults", items.length, fnCtx);
  const byId = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (tab === "single" && !item.teamID) {
      byId.set(item.favorRequestID, item);
    } else if (tab === "group" && item.teamID) {
      byId.set(item.favorRequestID, item);
    }
  }
  items = Array.from(byId.values());
  log.flowCount("getConversationProfiles", "afterTabFilter", items.length, fnCtx);
  if (status) {
    items = items.filter((i) => i.status === status);
    log.flowCount("getConversationProfiles", "afterStatusFilter", items.length, fnCtx);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = items.length;
  const profiles = items.slice(Number(offset), Number(offset) + Number(limit)).map((item) => ({
    favorRequestID: item.favorRequestID,
    conversationType: item.teamID ? "group" : "single",
    name: item.title || item.initialMessage?.substring(0, 50),
    taskCount: 1,
    lastMessageTime: item.updatedAt,
    lastMessagePreview: item.initialMessage?.substring(0, 100),
    unreadCount: item.unreadCount,
    nearestDeadline: item.deadline,
    category: item.category,
    priority: item.priority,
    status: item.status
  }));
  log.info("getConversationProfiles completed", { ...fnCtx, total, returned: profiles.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    profiles,
    total,
    hasMore: Number(offset) + profiles.length < total
  });
}
async function getConversationComplete(userID, favorRequestID, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getConversationComplete", favorRequestID };
  log.dbOperation("GetItem", FAVORS_TABLE, { favorRequestID }, fnCtx);
  const dbStart = Date.now();
  const favorResult = await ddb2.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  log.dbResult("GetItem", FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const favor = favorResult.Item;
  if (!favor) {
    log.warn("Conversation not found", fnCtx);
    return response(404, { success: false, message: "Conversation not found" });
  }
  if (favor.senderID !== userID && favor.receiverID !== userID && favor.currentAssigneeID !== userID) {
    log.debug("User not direct participant, checking team membership", fnCtx);
    if (favor.teamID && TEAMS_TABLE) {
      const teamDbStart = Date.now();
      log.dbOperation("GetItem", TEAMS_TABLE, { teamID: favor.teamID }, fnCtx);
      const teamResult = await ddb2.send(new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamID: favor.teamID }
      }));
      log.dbResult("GetItem", TEAMS_TABLE, teamResult.Item ? 1 : 0, Date.now() - teamDbStart, fnCtx);
      const team = teamResult.Item;
      if (!team?.members.includes(userID)) {
        log.warn("User not in team members", { ...fnCtx, teamID: favor.teamID });
        return response(403, { success: false, message: "Unauthorized" });
      }
    } else {
      log.warn("Unauthorized access attempt", fnCtx);
      return response(403, { success: false, message: "Unauthorized" });
    }
  }
  const msgDbStart = Date.now();
  log.dbOperation("Query", MESSAGES_TABLE, { favorRequestID }, fnCtx);
  const messagesResult = await ddb2.send(new QueryCommand2({
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: "favorRequestID = :id",
    ExpressionAttributeValues: { ":id": favorRequestID },
    ScanIndexForward: true
  }));
  log.dbResult("Query", MESSAGES_TABLE, messagesResult.Items?.length || 0, Date.now() - msgDbStart, fnCtx);
  const files = (messagesResult.Items || []).filter((m) => m.type === "file");
  log.info("getConversationComplete completed", {
    ...fnCtx,
    messageCount: messagesResult.Items?.length || 0,
    fileCount: files.length,
    durationMs: Date.now() - fnStart
  });
  return response(200, {
    success: true,
    conversation: favor,
    participants: [favor.senderID, favor.receiverID, favor.currentAssigneeID].filter(Boolean),
    tasks: [favor],
    // Each favor is a task
    files,
    statistics: {
      totalMessages: messagesResult.Items?.length || 0,
      totalFiles: files.length
    }
  });
}
async function getConversationUserDetails(userID, favorRequestID, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getConversationUserDetails", favorRequestID };
  const dbStart = Date.now();
  log.dbOperation("GetItem", FAVORS_TABLE, { favorRequestID }, fnCtx);
  const favorResult = await ddb2.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  log.dbResult("GetItem", FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const favor = favorResult.Item;
  if (!favor) {
    log.warn("Conversation not found", fnCtx);
    return response(404, { success: false, message: "Conversation not found" });
  }
  log.info("getConversationUserDetails completed", { ...fnCtx, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    conversation: {
      favorRequestID: favor.favorRequestID,
      conversationType: favor.teamID ? "group" : "single",
      status: favor.status,
      requestType: favor.requestType,
      category: favor.category,
      priority: favor.priority,
      createdAt: favor.createdAt,
      updatedAt: favor.updatedAt
    },
    participants: [
      { userID: favor.senderID, role: "creator" },
      ...favor.receiverID ? [{ userID: favor.receiverID, role: "receiver" }] : []
    ],
    creator: { userID: favor.senderID }
  });
}
async function updateConversationDeadline(userID, favorRequestID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "updateConversationDeadline", favorRequestID };
  const { deadline } = body;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  log.debug("Updating deadline", { ...fnCtx, deadline, hasDeadline: !!deadline });
  const dbStart = Date.now();
  log.dbOperation("UpdateItem", FAVORS_TABLE, { favorRequestID, action: deadline ? "SET" : "REMOVE" }, fnCtx);
  await ddb2.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: deadline ? "SET deadline = :d, updatedAt = :ua" : "REMOVE deadline SET updatedAt = :ua",
    ExpressionAttributeValues: deadline ? { ":d": deadline, ":ua": nowIso } : { ":ua": nowIso }
  }));
  log.dbResult("UpdateItem", FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);
  log.info("updateConversationDeadline completed", { ...fnCtx, deadline, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    message: "Deadline updated successfully",
    conversation: { favorRequestID, deadline, updatedAt: nowIso }
  });
}
async function deleteConversation(userID, favorRequestID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "deleteConversation", favorRequestID };
  const dbStart = Date.now();
  log.dbOperation("GetItem", FAVORS_TABLE, { favorRequestID }, fnCtx);
  const favorResult = await ddb2.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  log.dbResult("GetItem", FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const favor = favorResult.Item;
  if (!favor || favor.senderID !== userID) {
    log.warn("Unauthorized delete attempt", { ...fnCtx, favorExists: !!favor, isCreator: favor?.senderID === userID });
    return response(403, { success: false, message: "Unauthorized: Only the creator can delete" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updateStart = Date.now();
  log.dbOperation("UpdateItem", FAVORS_TABLE, { favorRequestID, action: "soft-delete" }, fnCtx);
  await ddb2.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: "SET #s = :status, updatedAt = :ua",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":status": "deleted", ":ua": nowIso }
  }));
  log.dbResult("UpdateItem", FAVORS_TABLE, 1, Date.now() - updateStart, fnCtx);
  log.info("deleteConversation completed", { ...fnCtx, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    message: "Conversation deleted successfully",
    deleted: { conversationID: favorRequestID }
  });
}
async function getConversations(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getConversations" };
  const { tab, status, category, limit = 20, offset = 0 } = params || {};
  log.debug("Get conversations params", { ...fnCtx, tab, status, category, limit, offset });
  const dbStart = Date.now();
  log.dbOperation("Query", FAVORS_TABLE, { indexes: ["SenderIndex", "ReceiverIndex"], userID }, fnCtx);
  const [sentResult, recvResult] = await Promise.all([
    ddb2.send(new QueryCommand2({
      TableName: FAVORS_TABLE,
      IndexName: "SenderIndex",
      KeyConditionExpression: "senderID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    })),
    ddb2.send(new QueryCommand2({
      TableName: FAVORS_TABLE,
      IndexName: "ReceiverIndex",
      KeyConditionExpression: "receiverID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    }))
  ]);
  log.dbResult("Query", FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0), Date.now() - dbStart, fnCtx);
  let conversations = [...sentResult.Items || [], ...recvResult.Items || []];
  log.flowCount("getConversations", "rawResults", conversations.length, fnCtx);
  const byId = /* @__PURE__ */ new Map();
  for (const conv of conversations) {
    byId.set(conv.favorRequestID, conv);
  }
  conversations = Array.from(byId.values());
  log.flowCount("getConversations", "afterDedupe", conversations.length, fnCtx);
  if (tab === "single") {
    conversations = conversations.filter((c) => !c.teamID);
  }
  if (tab === "group") {
    conversations = conversations.filter((c) => !!c.teamID);
  }
  if (status) {
    conversations = conversations.filter((c) => c.status === status);
  }
  if (category) {
    conversations = conversations.filter((c) => c.category === category);
  }
  log.flowCount("getConversations", "afterFilters", conversations.length, fnCtx);
  conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = conversations.length;
  const paginatedConversations = conversations.slice(Number(offset), Number(offset) + Number(limit));
  log.info("getConversations completed", { ...fnCtx, total, returned: paginatedConversations.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    conversations: paginatedConversations,
    total,
    hasMore: Number(offset) + paginatedConversations.length < total
  });
}
async function getTasksByStatus(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getTasksByStatus" };
  const { status, conversationID, assignedTo, category, priority, limit = 20, offset = 0 } = params || {};
  log.debug("Get tasks params", { ...fnCtx, status, category, priority, limit, offset });
  let items = [];
  if (status) {
    const dbStart = Date.now();
    log.dbOperation("Query", FAVORS_TABLE, { index: "StatusIndex", status }, fnCtx);
    const result = await ddb2.send(new QueryCommand2({
      TableName: FAVORS_TABLE,
      IndexName: "StatusIndex",
      KeyConditionExpression: "#s = :status",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":status": status },
      ScanIndexForward: false
    }));
    log.dbResult("Query", FAVORS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
    items = result.Items || [];
  } else {
    const dbStart = Date.now();
    log.dbOperation("Query", FAVORS_TABLE, { indexes: ["SenderIndex", "ReceiverIndex"], userID }, fnCtx);
    const [sentResult, recvResult] = await Promise.all([
      ddb2.send(new QueryCommand2({
        TableName: FAVORS_TABLE,
        IndexName: "SenderIndex",
        KeyConditionExpression: "senderID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      })),
      ddb2.send(new QueryCommand2({
        TableName: FAVORS_TABLE,
        IndexName: "ReceiverIndex",
        KeyConditionExpression: "receiverID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      }))
    ]);
    log.dbResult("Query", FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0), Date.now() - dbStart, fnCtx);
    items = [...sentResult.Items || [], ...recvResult.Items || []];
  }
  log.flowCount("getTasksByStatus", "rawResults", items.length, fnCtx);
  const byId = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (item.senderID === userID || item.receiverID === userID || item.currentAssigneeID === userID) {
      byId.set(item.favorRequestID, item);
    }
  }
  items = Array.from(byId.values());
  log.flowCount("getTasksByStatus", "afterDedupe", items.length, fnCtx);
  if (category) {
    items = items.filter((i) => i.category === category);
  }
  if (priority) {
    items = items.filter((i) => i.priority === priority);
  }
  log.flowCount("getTasksByStatus", "afterFilters", items.length, fnCtx);
  const stats = {
    totalTasks: items.length,
    byPriority: {
      Low: items.filter((i) => i.priority === "Low").length,
      Medium: items.filter((i) => i.priority === "Medium").length,
      High: items.filter((i) => i.priority === "High").length,
      Urgent: items.filter((i) => i.priority === "Urgent").length
    },
    byCategory: {}
  };
  SYSTEM_MODULES.forEach((m) => {
    stats.byCategory[m] = items.filter((i) => i.category === m).length;
  });
  const total = items.length;
  const tasks = items.slice(Number(offset), Number(offset) + Number(limit));
  log.info("getTasksByStatus completed", { ...fnCtx, total, returned: tasks.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    tasks,
    total,
    hasMore: Number(offset) + tasks.length < total,
    statistics: stats
  });
}
async function getForwardHistory(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getForwardHistory" };
  const { conversationID, taskID, limit = 50, offset = 0 } = params || {};
  log.debug("Get forward history params", { ...fnCtx, conversationID, taskID, limit, offset });
  let items = [];
  if (taskID || conversationID) {
    const dbStart = Date.now();
    const id = taskID || conversationID;
    log.dbOperation("GetItem", FAVORS_TABLE, { favorRequestID: id }, fnCtx);
    const result = await ddb2.send(new GetCommand({
      TableName: FAVORS_TABLE,
      Key: { favorRequestID: id }
    }));
    log.dbResult("GetItem", FAVORS_TABLE, result.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
    if (result.Item)
      items = [result.Item];
  } else {
    const dbStart = Date.now();
    log.dbOperation("Query", FAVORS_TABLE, { indexes: ["SenderIndex", "ReceiverIndex"], userID }, fnCtx);
    const [sentResult, recvResult] = await Promise.all([
      ddb2.send(new QueryCommand2({
        TableName: FAVORS_TABLE,
        IndexName: "SenderIndex",
        KeyConditionExpression: "senderID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      })),
      ddb2.send(new QueryCommand2({
        TableName: FAVORS_TABLE,
        IndexName: "ReceiverIndex",
        KeyConditionExpression: "receiverID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      }))
    ]);
    log.dbResult("Query", FAVORS_TABLE, (sentResult.Items?.length || 0) + (recvResult.Items?.length || 0), Date.now() - dbStart, fnCtx);
    const all = [...sentResult.Items || [], ...recvResult.Items || []];
    items = all.filter((i) => i.forwardingChain && i.forwardingChain.length > 0);
    log.flowCount("getForwardHistory", "tasksWithForwards", items.length, fnCtx);
  }
  const forwardHistory = items.flatMap(
    (item) => (item.forwardingChain || []).map((f) => ({
      ...f,
      taskID: item.favorRequestID,
      taskTitle: item.title,
      conversationID: item.favorRequestID
    }))
  );
  log.flowCount("getForwardHistory", "totalForwards", forwardHistory.length, fnCtx);
  forwardHistory.sort((a, b) => b.forwardedAt.localeCompare(a.forwardedAt));
  const total = forwardHistory.length;
  const paginated = forwardHistory.slice(Number(offset), Number(offset) + Number(limit));
  log.info("getForwardHistory completed", { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    forwardHistory: paginated,
    total,
    hasMore: Number(offset) + paginated.length < total
  });
}
async function getForwardedToMe(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getForwardedToMe" };
  const { status, limit = 20, offset = 0 } = params || {};
  log.debug("Get forwarded to me params", { ...fnCtx, status, limit, offset });
  const dbStart = Date.now();
  log.dbOperation("Query", FAVORS_TABLE, { index: "CurrentAssigneeIndex", userID }, fnCtx);
  const result = await ddb2.send(new QueryCommand2({
    TableName: FAVORS_TABLE,
    IndexName: "CurrentAssigneeIndex",
    KeyConditionExpression: "currentAssigneeID = :uid",
    ExpressionAttributeValues: { ":uid": userID },
    ScanIndexForward: false
  }));
  log.dbResult("Query", FAVORS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
  let items = result.Items || [];
  log.flowCount("getForwardedToMe", "assignedItems", items.length, fnCtx);
  items = items.filter((i) => i.forwardingChain && i.forwardingChain.length > 0);
  log.flowCount("getForwardedToMe", "withForwardChain", items.length, fnCtx);
  if (status) {
    items = items.filter((i) => {
      const lastForward = i.forwardingChain?.[i.forwardingChain.length - 1];
      return lastForward?.status === status;
    });
    log.flowCount("getForwardedToMe", "afterStatusFilter", items.length, fnCtx);
  }
  const forwardedTasks = items.map((i) => {
    const lastForward = i.forwardingChain?.[i.forwardingChain.length - 1];
    return {
      forwardID: lastForward?.forwardID,
      taskID: i.favorRequestID,
      taskTitle: i.title,
      taskDescription: i.description,
      conversationID: i.favorRequestID,
      fromUser: { userID: lastForward?.fromUserID },
      forwardedAt: lastForward?.forwardedAt,
      message: lastForward?.message,
      deadline: i.deadline,
      requireAcceptance: lastForward?.requireAcceptance,
      status: lastForward?.status,
      priority: i.priority,
      category: i.category
    };
  });
  const total = forwardedTasks.length;
  const paginated = forwardedTasks.slice(Number(offset), Number(offset) + Number(limit));
  log.info("getForwardedToMe completed", { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    forwardedTasks: paginated,
    total,
    hasMore: Number(offset) + paginated.length < total
  });
}
async function forwardTask(userID, taskID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "forwardTask", taskID };
  const { forwardTo, message, deadline, requireAcceptance = false, notifyOriginalAssignee = true } = body;
  log.debug("Forward task params", { ...fnCtx, forwardTo, requireAcceptance, hasDeadline: !!deadline });
  if (!forwardTo) {
    log.validation("forwardTo", "required field missing", fnCtx);
    return response(400, { success: false, message: "forwardTo is required" });
  }
  const dbStart = Date.now();
  log.dbOperation("GetItem", FAVORS_TABLE, { favorRequestID: taskID }, fnCtx);
  const favorResult = await ddb2.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID }
  }));
  log.dbResult("GetItem", FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const favor = favorResult.Item;
  if (!favor) {
    log.warn("Task not found", fnCtx);
    return response(404, { success: false, message: "Task not found" });
  }
  const forwardID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const forwardRecord = {
    forwardID,
    fromUserID: userID,
    toUserID: forwardTo,
    forwardedAt: nowIso,
    message,
    deadline: deadline || favor.deadline,
    requireAcceptance,
    status: requireAcceptance ? "pending" : "accepted",
    ...requireAcceptance ? {} : { acceptedAt: nowIso }
  };
  const existingChain = favor.forwardingChain || [];
  const updatedChain = [...existingChain, forwardRecord];
  log.flowCount("forwardTask", "chainLength", updatedChain.length, fnCtx);
  const updateStart = Date.now();
  log.dbOperation("UpdateItem", FAVORS_TABLE, { favorRequestID: taskID, forwardTo }, fnCtx);
  await ddb2.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID },
    UpdateExpression: "SET forwardingChain = :chain, currentAssigneeID = :assignee, #s = :status, updatedAt = :ua, requiresAcceptance = :ra",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":chain": updatedChain,
      ":assignee": forwardTo,
      ":status": requireAcceptance ? "forwarded" : "active",
      ":ua": nowIso,
      ":ra": requireAcceptance
    }
  }));
  log.dbResult("UpdateItem", FAVORS_TABLE, 1, Date.now() - updateStart, fnCtx);
  log.info("forwardTask completed", { ...fnCtx, forwardID, forwardTo, requireAcceptance, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    forwardID,
    message: "Task forwarded successfully",
    forwardingRecord: forwardRecord
  });
}
async function respondToForward(userID, taskID, forwardID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "respondToForward", taskID, forwardID };
  const { action, rejectionReason } = body;
  log.debug("Respond to forward params", { ...fnCtx, action, hasRejectionReason: !!rejectionReason });
  if (!action || !["accept", "reject"].includes(action)) {
    log.validation("action", "must be accept or reject", fnCtx);
    return response(400, { success: false, message: "action must be accept or reject" });
  }
  const dbStart = Date.now();
  log.dbOperation("GetItem", FAVORS_TABLE, { favorRequestID: taskID }, fnCtx);
  const favorResult = await ddb2.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID }
  }));
  log.dbResult("GetItem", FAVORS_TABLE, favorResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const favor = favorResult.Item;
  if (!favor) {
    log.warn("Task not found", fnCtx);
    return response(404, { success: false, message: "Task not found" });
  }
  const forwardingChain = favor.forwardingChain || [];
  const forwardIndex = forwardingChain.findIndex((f) => f.forwardID === forwardID);
  if (forwardIndex === -1) {
    log.warn("Forward record not found", fnCtx);
    return response(404, { success: false, message: "Forward record not found" });
  }
  const forwardRecord = forwardingChain[forwardIndex];
  if (forwardRecord.toUserID !== userID) {
    log.warn("Forward not assigned to user", { ...fnCtx, assignedTo: forwardRecord.toUserID });
    return response(403, { success: false, message: "This forward is not assigned to you" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  forwardingChain[forwardIndex] = {
    ...forwardRecord,
    status: action === "accept" ? "accepted" : "rejected",
    ...action === "accept" ? { acceptedAt: nowIso } : { rejectedAt: nowIso, rejectionReason }
  };
  let newStatus = favor.status;
  let newAssignee = favor.currentAssigneeID;
  if (action === "accept") {
    newStatus = "active";
  } else {
    newStatus = "pending";
    newAssignee = forwardRecord.fromUserID;
  }
  log.debug("Status transition", { ...fnCtx, oldStatus: favor.status, newStatus, newAssignee });
  const updateStart = Date.now();
  log.dbOperation("UpdateItem", FAVORS_TABLE, { favorRequestID: taskID, action }, fnCtx);
  await ddb2.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID },
    UpdateExpression: "SET forwardingChain = :chain, #s = :status, currentAssigneeID = :assignee, updatedAt = :ua",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":chain": forwardingChain,
      ":status": newStatus,
      ":assignee": newAssignee,
      ":ua": nowIso
    }
  }));
  log.dbResult("UpdateItem", FAVORS_TABLE, 1, Date.now() - updateStart, fnCtx);
  log.info("respondToForward completed", { ...fnCtx, action, newStatus, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    message: "Task response recorded successfully",
    forwardingRecord: forwardingChain[forwardIndex]
  });
}
async function updateTaskDeadline(userID, taskID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "updateTaskDeadline", taskID };
  const { deadline } = body;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  log.debug("Update task deadline", { ...fnCtx, deadline, hasDeadline: !!deadline });
  const dbStart = Date.now();
  log.dbOperation("UpdateItem", FAVORS_TABLE, { favorRequestID: taskID, action: deadline ? "SET" : "REMOVE" }, fnCtx);
  await ddb2.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID },
    UpdateExpression: deadline ? "SET deadline = :d, updatedAt = :ua" : "REMOVE deadline SET updatedAt = :ua",
    ExpressionAttributeValues: deadline ? { ":d": deadline, ":ua": nowIso } : { ":ua": nowIso }
  }));
  log.dbResult("UpdateItem", FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);
  log.info("updateTaskDeadline completed", { ...fnCtx, deadline, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    message: "Task deadline updated successfully",
    task: { taskID, deadline, updatedAt: nowIso }
  });
}
async function createTask(userID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "createTask" };
  const { conversationID, receiverID, title, description, priority = "Medium", category, deadline, requiresAcceptance = false } = body;
  log.debug("Create task params", { ...fnCtx, receiverID, priority, category, hasDeadline: !!deadline });
  if (!receiverID || !title) {
    log.validation("receiverID/title", "required fields missing", fnCtx);
    return response(400, { success: false, message: "receiverID and title are required" });
  }
  const favorRequestID = conversationID || v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const newTask = {
    favorRequestID,
    senderID: userID,
    receiverID,
    title,
    description: description || title,
    status: "pending",
    priority,
    ...category && { category },
    currentAssigneeID: receiverID,
    requiresAcceptance,
    createdAt: nowIso,
    updatedAt: nowIso,
    userID,
    requestType: "Assign Task",
    unreadCount: 1,
    initialMessage: description || title,
    ...deadline && { deadline }
  };
  const dbStart = Date.now();
  log.dbOperation("PutItem", FAVORS_TABLE, { favorRequestID, receiverID }, fnCtx);
  await ddb2.send(new PutCommand2({
    TableName: FAVORS_TABLE,
    Item: newTask
  }));
  log.dbResult("PutItem", FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);
  log.info("createTask completed", { ...fnCtx, taskID: favorRequestID, receiverID, priority, durationMs: Date.now() - fnStart });
  return response(201, {
    success: true,
    taskID: favorRequestID,
    conversationID: favorRequestID,
    message: "Task created successfully",
    task: newTask
  });
}
async function createGroupTask(userID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "createGroupTask" };
  const { conversationID, teamID, title, description, assignedTo, priority = "Medium", category, deadline, requiresAcceptance = false } = body;
  log.debug("Create group task params", { ...fnCtx, teamID, assignedTo, priority, category, hasDeadline: !!deadline });
  if (!teamID || !title) {
    log.validation("teamID/title", "required fields missing", fnCtx);
    return response(400, { success: false, message: "teamID and title are required" });
  }
  const favorRequestID = conversationID || v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const newTask = {
    favorRequestID,
    senderID: userID,
    teamID,
    title,
    description: description || title,
    status: "pending",
    priority,
    ...category && { category },
    ...assignedTo && { currentAssigneeID: assignedTo },
    requiresAcceptance,
    createdAt: nowIso,
    updatedAt: nowIso,
    userID,
    requestType: "Assign Task",
    unreadCount: 1,
    initialMessage: description || title,
    ...deadline && { deadline }
  };
  const dbStart = Date.now();
  log.dbOperation("PutItem", FAVORS_TABLE, { favorRequestID, teamID }, fnCtx);
  await ddb2.send(new PutCommand2({
    TableName: FAVORS_TABLE,
    Item: newTask
  }));
  log.dbResult("PutItem", FAVORS_TABLE, 1, Date.now() - dbStart, fnCtx);
  log.info("createGroupTask completed", { ...fnCtx, taskID: favorRequestID, teamID, priority, durationMs: Date.now() - fnStart });
  return response(201, {
    success: true,
    taskID: favorRequestID,
    conversationID: favorRequestID,
    message: "Group task created successfully",
    task: newTask
  });
}
async function createMeeting(userID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "createMeeting" };
  const { conversationID, title, description, startTime, endTime, location, meetingLink, participants, reminder } = body;
  log.debug("Create meeting params", { ...fnCtx, conversationID, hasStartTime: !!startTime, participantCount: participants?.length || 0 });
  if (!conversationID || !description || !meetingLink) {
    log.validation("conversationID/description/meetingLink", "required fields missing", fnCtx);
    return response(400, { success: false, message: "conversationID, description, and meetingLink are required" });
  }
  const meetingID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const meeting = {
    meetingID,
    conversationID,
    title: title || description.substring(0, 50),
    description,
    startTime: startTime || nowIso,
    endTime,
    location,
    meetingLink,
    organizerID: userID,
    participants: participants || [],
    status: "scheduled",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  const dbStart = Date.now();
  log.dbOperation("PutItem", MEETINGS_TABLE, { meetingID, conversationID }, fnCtx);
  await ddb2.send(new PutCommand2({
    TableName: MEETINGS_TABLE,
    Item: meeting
  }));
  log.dbResult("PutItem", MEETINGS_TABLE, 1, Date.now() - dbStart, fnCtx);
  log.info("createMeeting completed", { ...fnCtx, meetingID, conversationID, participantCount: meeting.participants.length, durationMs: Date.now() - fnStart });
  return response(201, {
    success: true,
    meetingID,
    message: "Meeting scheduled successfully",
    meeting
  });
}
async function getMeetings(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getMeetings" };
  const { conversationID, status, startDate, endDate, limit = 20, offset = 0 } = params || {};
  log.debug("Get meetings params", { ...fnCtx, conversationID, status, startDate, endDate, limit, offset });
  let meetings = [];
  if (conversationID) {
    const dbStart = Date.now();
    log.dbOperation("Query", MEETINGS_TABLE, { index: "ConversationIndex", conversationID }, fnCtx);
    const result = await ddb2.send(new QueryCommand2({
      TableName: MEETINGS_TABLE,
      IndexName: "ConversationIndex",
      KeyConditionExpression: "conversationID = :cid",
      ExpressionAttributeValues: { ":cid": conversationID },
      ScanIndexForward: false
    }));
    log.dbResult("Query", MEETINGS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
    meetings = result.Items || [];
  } else {
    const dbStart = Date.now();
    log.dbOperation("Query", MEETINGS_TABLE, { index: "OrganizerIndex", userID }, fnCtx);
    const result = await ddb2.send(new QueryCommand2({
      TableName: MEETINGS_TABLE,
      IndexName: "OrganizerIndex",
      KeyConditionExpression: "organizerID = :oid",
      ExpressionAttributeValues: { ":oid": userID },
      ScanIndexForward: false
    }));
    log.dbResult("Query", MEETINGS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
    meetings = result.Items || [];
  }
  log.flowCount("getMeetings", "rawResults", meetings.length, fnCtx);
  if (status) {
    meetings = meetings.filter((m) => m.status === status);
  }
  if (startDate) {
    meetings = meetings.filter((m) => m.startTime >= startDate);
  }
  if (endDate) {
    meetings = meetings.filter((m) => m.startTime <= endDate);
  }
  log.flowCount("getMeetings", "afterFilters", meetings.length, fnCtx);
  const total = meetings.length;
  const paginated = meetings.slice(Number(offset), Number(offset) + Number(limit));
  log.info("getMeetings completed", { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    meetings: paginated,
    total,
    hasMore: Number(offset) + paginated.length < total
  });
}
async function updateMeeting(userID, meetingID, body, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "updateMeeting", meetingID };
  const dbStart = Date.now();
  log.dbOperation("GetItem", MEETINGS_TABLE, { meetingID }, fnCtx);
  const meetingResult = await ddb2.send(new GetCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  log.dbResult("GetItem", MEETINGS_TABLE, meetingResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const meeting = meetingResult.Item;
  if (!meeting) {
    log.warn("Meeting not found", fnCtx);
    return response(404, { success: false, message: "Meeting not found" });
  }
  if (meeting.organizerID !== userID) {
    log.warn("Unauthorized meeting update attempt", { ...fnCtx, organizerID: meeting.organizerID });
    return response(403, { success: false, message: "Only the organizer can update this meeting" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const { title, description, startTime, endTime, location, meetingLink, participants, status } = body;
  const updateExpressions = ["updatedAt = :ua"];
  const expressionValues = { ":ua": nowIso };
  const expressionNames = {};
  if (title !== void 0) {
    updateExpressions.push("title = :title");
    expressionValues[":title"] = title;
  }
  if (description !== void 0) {
    updateExpressions.push("description = :desc");
    expressionValues[":desc"] = description;
  }
  if (startTime !== void 0) {
    updateExpressions.push("startTime = :start");
    expressionValues[":start"] = startTime;
  }
  if (endTime !== void 0) {
    updateExpressions.push("endTime = :endT");
    expressionValues[":endT"] = endTime;
  }
  if (location !== void 0) {
    updateExpressions.push("#loc = :loc");
    expressionValues[":loc"] = location;
    expressionNames["#loc"] = "location";
  }
  if (meetingLink !== void 0) {
    updateExpressions.push("meetingLink = :link");
    expressionValues[":link"] = meetingLink;
  }
  if (participants !== void 0) {
    updateExpressions.push("participants = :parts");
    expressionValues[":parts"] = participants;
  }
  if (status !== void 0) {
    updateExpressions.push("#s = :status");
    expressionValues[":status"] = status;
    expressionNames["#s"] = "status";
  }
  log.debug("Meeting update fields", { ...fnCtx, fieldsUpdated: updateExpressions.length - 1 });
  const updateStart = Date.now();
  log.dbOperation("UpdateItem", MEETINGS_TABLE, { meetingID }, fnCtx);
  await ddb2.send(new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID },
    UpdateExpression: "SET " + updateExpressions.join(", "),
    ExpressionAttributeValues: expressionValues,
    ...Object.keys(expressionNames).length > 0 ? { ExpressionAttributeNames: expressionNames } : {}
  }));
  log.dbResult("UpdateItem", MEETINGS_TABLE, 1, Date.now() - updateStart, fnCtx);
  log.info("updateMeeting completed", { ...fnCtx, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    message: "Meeting updated successfully",
    meeting: { meetingID, ...body, updatedAt: nowIso }
  });
}
async function deleteMeeting(userID, meetingID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "deleteMeeting", meetingID };
  const dbStart = Date.now();
  log.dbOperation("GetItem", MEETINGS_TABLE, { meetingID }, fnCtx);
  const meetingResult = await ddb2.send(new GetCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  log.dbResult("GetItem", MEETINGS_TABLE, meetingResult.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const meeting = meetingResult.Item;
  if (!meeting) {
    log.warn("Meeting not found", fnCtx);
    return response(404, { success: false, message: "Meeting not found" });
  }
  if (meeting.organizerID !== userID) {
    log.warn("Unauthorized meeting delete attempt", { ...fnCtx, organizerID: meeting.organizerID });
    return response(403, { success: false, message: "Only the organizer can delete this meeting" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updateStart = Date.now();
  log.dbOperation("UpdateItem", MEETINGS_TABLE, { meetingID, action: "soft-delete" }, fnCtx);
  await ddb2.send(new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID },
    UpdateExpression: "SET #s = :status, updatedAt = :ua",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":status": "cancelled", ":ua": nowIso }
  }));
  log.dbResult("UpdateItem", MEETINGS_TABLE, 1, Date.now() - updateStart, fnCtx);
  log.info("deleteMeeting completed", { ...fnCtx, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    message: "Meeting deleted successfully",
    meetingID
  });
}
async function createGroup(userID, body, logCtx) {
  const startTime = Date.now();
  const fnCtx = { ...logCtx, function: "createGroup" };
  const { name, description, members, category, createConversation = true } = body;
  log.debug("Create group params", { ...fnCtx, name, memberCount: members?.length, category, createConversation });
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    log.validation("name", "Group name is required and must be a non-empty string", fnCtx);
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: "unknown",
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "failure",
      statusCode: 400,
      errorMessage: "Group name is required and must be a non-empty string",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "Group name is required and must be a non-empty string" });
  }
  if (name.length > 255) {
    log.validation("name", "Group name must be less than 255 characters", fnCtx);
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: "unknown",
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "failure",
      statusCode: 400,
      errorMessage: "Group name must be less than 255 characters",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "Group name must be less than 255 characters" });
  }
  if (!members || !Array.isArray(members) || members.length === 0) {
    log.validation("members", "members must be a non-empty array of user IDs", fnCtx);
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: "unknown",
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "failure",
      statusCode: 400,
      errorMessage: "members must be a non-empty array of user IDs",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "members must be a non-empty array of user IDs" });
  }
  for (const memberId of members) {
    if (typeof memberId !== "string" || memberId.trim().length === 0) {
      log.validation("memberID", "All member IDs must be non-empty strings", fnCtx);
      AuditService.logAction({
        userID,
        action: "CREATE_GROUP",
        resourceType: "group",
        resourceID: "unknown",
        httpMethod: "POST",
        endpoint: "/api/groups",
        status: "failure",
        statusCode: 400,
        errorMessage: "All member IDs must be non-empty strings",
        durationMs: Date.now() - startTime
      });
      return response(400, { success: false, message: "All member IDs must be non-empty strings" });
    }
  }
  if (category && !SYSTEM_MODULES.includes(category)) {
    log.validation("category", `Invalid category. Must be one of: ${SYSTEM_MODULES.join(", ")}`, fnCtx);
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: "unknown",
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "failure",
      statusCode: 400,
      errorMessage: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(", ")}`,
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(", ")}` });
  }
  const uniqueMembers = Array.from(/* @__PURE__ */ new Set([...members, userID]));
  log.flowCount("createGroup", "uniqueMembers", uniqueMembers.length, fnCtx);
  if (uniqueMembers.length > MAX_GROUP_MEMBERS) {
    log.warn("Member limit exceeded", { ...fnCtx, memberCount: uniqueMembers.length, maxMembers: MAX_GROUP_MEMBERS });
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: "unknown",
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "failure",
      statusCode: 403,
      errorMessage: `Group cannot have more than ${MAX_GROUP_MEMBERS} members`,
      durationMs: Date.now() - startTime
    });
    return response(403, { success: false, message: `Group cannot have more than ${MAX_GROUP_MEMBERS} members` });
  }
  if (uniqueMembers.length < 2) {
    log.validation("members", "Group must have at least one other member", fnCtx);
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: "unknown",
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "failure",
      statusCode: 400,
      errorMessage: "Group must have at least one other member",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "Group must have at least one other member" });
  }
  const teamID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const team = {
    teamID,
    ownerID: userID,
    name: name.trim(),
    description,
    members: uniqueMembers,
    ...category && { category },
    createdAt: nowIso,
    updatedAt: nowIso
  };
  try {
    const dbStart = Date.now();
    log.dbOperation("PutItem", TEAMS_TABLE, { teamID }, fnCtx);
    await ddb2.send(new PutCommand2({
      TableName: TEAMS_TABLE,
      Item: team
    }));
    log.dbResult("PutItem", TEAMS_TABLE, 1, Date.now() - dbStart, fnCtx);
    let conversationID;
    if (createConversation) {
      conversationID = v4_default();
      const conversation = {
        favorRequestID: conversationID,
        senderID: userID,
        teamID,
        title: name.trim(),
        description: description || `Group conversation for ${name.trim()}`,
        status: "active",
        priority: "Medium",
        ...category && { category },
        createdAt: nowIso,
        updatedAt: nowIso,
        userID,
        requestType: "General",
        unreadCount: 0,
        initialMessage: `Group ${name.trim()} created`
      };
      const convDbStart = Date.now();
      log.dbOperation("PutItem", FAVORS_TABLE, { conversationID, teamID }, fnCtx);
      await ddb2.send(new PutCommand2({
        TableName: FAVORS_TABLE,
        Item: conversation
      }));
      log.dbResult("PutItem", FAVORS_TABLE, 1, Date.now() - convDbStart, fnCtx);
    }
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "success",
      statusCode: 201,
      changes: { after: { teamID, name: name.trim(), memberCount: uniqueMembers.length, category } },
      durationMs: Date.now() - startTime,
      metadata: { ownerID: userID, conversationID }
    });
    log.info("createGroup completed", { ...fnCtx, teamID, memberCount: uniqueMembers.length, conversationID, durationMs: Date.now() - startTime });
    return response(201, {
      success: true,
      teamID,
      conversationID,
      message: "Group created successfully",
      group: team
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error("createGroup failed", fnCtx, err);
    AuditService.logAction({
      userID,
      action: "CREATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: "/api/groups",
      status: "failure",
      statusCode: 500,
      errorMessage: error.message,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}
async function getGroups(userID, params, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getGroups" };
  const { category, limit = 20, offset = 0 } = params || {};
  log.debug("Get groups params", { ...fnCtx, category, limit, offset });
  const dbStart = Date.now();
  log.dbOperation("Scan", TEAMS_TABLE, { filter: "contains(members, userID)" }, fnCtx);
  const result = await ddb2.send(new ScanCommand({
    TableName: TEAMS_TABLE,
    FilterExpression: "contains(members, :uid)",
    ExpressionAttributeValues: { ":uid": userID }
  }));
  log.dbResult("Scan", TEAMS_TABLE, result.Items?.length || 0, Date.now() - dbStart, fnCtx);
  let groups = result.Items || [];
  log.flowCount("getGroups", "rawResults", groups.length, fnCtx);
  if (category) {
    groups = groups.filter((g) => g.category === category);
    log.flowCount("getGroups", "afterCategoryFilter", groups.length, fnCtx);
  }
  groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = groups.length;
  const paginated = groups.slice(Number(offset), Number(offset) + Number(limit));
  log.info("getGroups completed", { ...fnCtx, total, returned: paginated.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    groups: paginated.map((g) => ({
      teamID: g.teamID,
      name: g.name,
      description: g.description,
      ownerID: g.ownerID,
      memberCount: g.members.length,
      members: g.members,
      category: g.category,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt
    })),
    total,
    hasMore: Number(offset) + paginated.length < total
  });
}
async function getGroupDetails(userID, teamID, logCtx) {
  const fnStart = Date.now();
  const fnCtx = { ...logCtx, function: "getGroupDetails", teamID };
  const dbStart = Date.now();
  log.dbOperation("GetItem", TEAMS_TABLE, { teamID }, fnCtx);
  const result = await ddb2.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  log.dbResult("GetItem", TEAMS_TABLE, result.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const team = result.Item;
  if (!team) {
    log.warn("Group not found", fnCtx);
    return response(404, { success: false, message: "Group not found" });
  }
  if (!team.members.includes(userID)) {
    log.warn("Unauthorized group access attempt", fnCtx);
    return response(403, { success: false, message: "Unauthorized" });
  }
  log.info("getGroupDetails completed", { ...fnCtx, memberCount: team.members.length, durationMs: Date.now() - fnStart });
  return response(200, {
    success: true,
    group: {
      teamID: team.teamID,
      name: team.name,
      description: team.description,
      ownerID: team.ownerID,
      owner: { userID: team.ownerID },
      members: team.members.map((m) => ({
        userID: m,
        role: m === team.ownerID ? "owner" : "member"
      })),
      category: team.category,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt
    }
  });
}
async function updateGroup(userID, teamID, body, logCtx) {
  const startTime = Date.now();
  const fnCtx = { ...logCtx, function: "updateGroup", teamID };
  log.debug("Update group request", fnCtx);
  const dbStart = Date.now();
  log.dbOperation("GetItem", TEAMS_TABLE, { teamID }, fnCtx);
  const result = await ddb2.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  log.dbResult("GetItem", TEAMS_TABLE, result.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const team = result.Item;
  if (!team) {
    log.warn("Group not found", fnCtx);
    AuditService.logAction({
      userID,
      action: "UPDATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "PUT",
      endpoint: `/api/groups/${teamID}`,
      status: "failure",
      statusCode: 404,
      errorMessage: "Group not found",
      durationMs: Date.now() - startTime
    });
    return response(404, { success: false, message: "Group not found" });
  }
  if (team.ownerID !== userID) {
    log.warn("Unauthorized group update attempt", { ...fnCtx, ownerID: team.ownerID });
    AuditService.logAction({
      userID,
      action: "UPDATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "PUT",
      endpoint: `/api/groups/${teamID}`,
      status: "failure",
      statusCode: 403,
      errorMessage: "Only the group owner can update this group",
      durationMs: Date.now() - startTime
    });
    return response(403, { success: false, message: "Only the group owner can update this group" });
  }
  const { name, description, category } = body;
  if (name !== void 0) {
    if (typeof name !== "string" || name.trim().length === 0) {
      log.validation("name", "Group name must be a non-empty string", fnCtx);
      AuditService.logAction({
        userID,
        action: "UPDATE_GROUP",
        resourceType: "group",
        resourceID: teamID,
        httpMethod: "PUT",
        endpoint: `/api/groups/${teamID}`,
        status: "failure",
        statusCode: 400,
        errorMessage: "Group name must be a non-empty string",
        durationMs: Date.now() - startTime
      });
      return response(400, { success: false, message: "Group name must be a non-empty string" });
    }
    if (name.length > 255) {
      log.validation("name", "Group name must be less than 255 characters", fnCtx);
      AuditService.logAction({
        userID,
        action: "UPDATE_GROUP",
        resourceType: "group",
        resourceID: teamID,
        httpMethod: "PUT",
        endpoint: `/api/groups/${teamID}`,
        status: "failure",
        statusCode: 400,
        errorMessage: "Group name must be less than 255 characters",
        durationMs: Date.now() - startTime
      });
      return response(400, { success: false, message: "Group name must be less than 255 characters" });
    }
  }
  if (description !== void 0 && typeof description !== "string") {
    log.validation("description", "Group description must be a string", fnCtx);
    AuditService.logAction({
      userID,
      action: "UPDATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "PUT",
      endpoint: `/api/groups/${teamID}`,
      status: "failure",
      statusCode: 400,
      errorMessage: "Group description must be a string",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "Group description must be a string" });
  }
  if (category !== void 0 && !SYSTEM_MODULES.includes(category)) {
    log.validation("category", `Invalid category. Must be one of: ${SYSTEM_MODULES.join(", ")}`, fnCtx);
    AuditService.logAction({
      userID,
      action: "UPDATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "PUT",
      endpoint: `/api/groups/${teamID}`,
      status: "failure",
      statusCode: 400,
      errorMessage: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(", ")}`,
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: `Invalid category. Must be one of: ${SYSTEM_MODULES.join(", ")}` });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updateExpressions = ["updatedAt = :ua"];
  const expressionValues = { ":ua": nowIso };
  if (name !== void 0) {
    updateExpressions.push("#n = :name");
    expressionValues[":name"] = name.trim();
  }
  if (description !== void 0) {
    updateExpressions.push("description = :desc");
    expressionValues[":desc"] = description;
  }
  if (category !== void 0) {
    updateExpressions.push("category = :cat");
    expressionValues[":cat"] = category;
  }
  try {
    const updateStart = Date.now();
    log.dbOperation("UpdateItem", TEAMS_TABLE, { teamID, fieldsUpdated: updateExpressions.length - 1 }, fnCtx);
    await ddb2.send(new UpdateCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID },
      UpdateExpression: "SET " + updateExpressions.join(", "),
      ExpressionAttributeNames: name !== void 0 ? { "#n": "name" } : void 0,
      ExpressionAttributeValues: expressionValues
    }));
    log.dbResult("UpdateItem", TEAMS_TABLE, 1, Date.now() - updateStart, fnCtx);
    AuditService.logAction({
      userID,
      action: "UPDATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "PUT",
      endpoint: `/api/groups/${teamID}`,
      status: "success",
      statusCode: 200,
      changes: {
        before: { name: team.name, description: team.description, category: team.category },
        after: { name: name?.trim() || team.name, description: description ?? team.description, category: category ?? team.category }
      },
      durationMs: Date.now() - startTime
    });
    log.info("updateGroup completed", { ...fnCtx, durationMs: Date.now() - startTime });
    return response(200, {
      success: true,
      message: "Group updated successfully",
      group: { teamID, name: name?.trim(), description, category, updatedAt: nowIso }
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error("updateGroup failed", fnCtx, err);
    AuditService.logAction({
      userID,
      action: "UPDATE_GROUP",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "PUT",
      endpoint: `/api/groups/${teamID}`,
      status: "failure",
      statusCode: 500,
      errorMessage: error.message,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}
async function addGroupMember(userID, teamID, body, logCtx) {
  const startTime = Date.now();
  const fnCtx = { ...logCtx, function: "addGroupMember", teamID };
  const { userID: memberUserID } = body;
  log.debug("Add group member request", { ...fnCtx, memberUserID });
  if (!memberUserID || typeof memberUserID !== "string" || memberUserID.trim().length === 0) {
    log.validation("userID", "userID is required and must be a non-empty string", fnCtx);
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "failure",
      statusCode: 400,
      errorMessage: "userID is required and must be a non-empty string",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "userID is required and must be a non-empty string" });
  }
  if (memberUserID === userID) {
    log.validation("userID", "Cannot add yourself to a group", fnCtx);
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "failure",
      statusCode: 400,
      errorMessage: "Cannot add yourself to a group",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "Cannot add yourself to a group" });
  }
  const dbStart = Date.now();
  log.dbOperation("GetItem", TEAMS_TABLE, { teamID }, fnCtx);
  const result = await ddb2.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  log.dbResult("GetItem", TEAMS_TABLE, result.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const team = result.Item;
  if (!team) {
    log.warn("Group not found", fnCtx);
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "failure",
      statusCode: 404,
      errorMessage: "Group not found",
      durationMs: Date.now() - startTime
    });
    return response(404, { success: false, message: "Group not found" });
  }
  if (team.ownerID !== userID) {
    log.warn("Unauthorized add member attempt", { ...fnCtx, ownerID: team.ownerID });
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "failure",
      statusCode: 403,
      errorMessage: "Only the group owner can add members",
      durationMs: Date.now() - startTime
    });
    return response(403, { success: false, message: "Only the group owner can add members" });
  }
  if (team.members.includes(memberUserID)) {
    log.warn("Member already exists", { ...fnCtx, memberUserID });
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "failure",
      statusCode: 400,
      errorMessage: "User is already a member of this group",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "User is already a member of this group" });
  }
  if (team.members.length >= MAX_GROUP_MEMBERS) {
    log.warn("Member limit reached", { ...fnCtx, currentCount: team.members.length, maxMembers: MAX_GROUP_MEMBERS });
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "failure",
      statusCode: 403,
      errorMessage: `Group has reached maximum member limit of ${MAX_GROUP_MEMBERS}`,
      durationMs: Date.now() - startTime
    });
    return response(403, { success: false, message: `Group has reached maximum member limit of ${MAX_GROUP_MEMBERS}` });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updatedMembers = [...team.members, memberUserID];
  try {
    const updateStart = Date.now();
    log.dbOperation("UpdateItem", TEAMS_TABLE, { teamID, addingMember: memberUserID }, fnCtx);
    await ddb2.send(new UpdateCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID },
      UpdateExpression: "SET members = :members, updatedAt = :ua",
      ExpressionAttributeValues: { ":members": updatedMembers, ":ua": nowIso }
    }));
    log.dbResult("UpdateItem", TEAMS_TABLE, 1, Date.now() - updateStart, fnCtx);
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "success",
      statusCode: 200,
      changes: {
        before: { memberCount: team.members.length },
        after: { memberCount: updatedMembers.length, newMember: memberUserID }
      },
      durationMs: Date.now() - startTime
    });
    log.info("addGroupMember completed", { ...fnCtx, memberUserID, newMemberCount: updatedMembers.length, durationMs: Date.now() - startTime });
    return response(200, {
      success: true,
      message: "Member added successfully",
      member: { userID: memberUserID, joinedAt: nowIso }
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error("addGroupMember failed", fnCtx, err);
    AuditService.logAction({
      userID,
      action: "ADD_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "POST",
      endpoint: `/api/groups/${teamID}/members`,
      status: "failure",
      statusCode: 500,
      errorMessage: error.message,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}
async function removeGroupMember(userID, teamID, memberUserID, logCtx) {
  const startTime = Date.now();
  const fnCtx = { ...logCtx, function: "removeGroupMember", teamID, memberUserID };
  log.debug("Remove group member request", fnCtx);
  const dbStart = Date.now();
  log.dbOperation("GetItem", TEAMS_TABLE, { teamID }, fnCtx);
  const result = await ddb2.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  log.dbResult("GetItem", TEAMS_TABLE, result.Item ? 1 : 0, Date.now() - dbStart, fnCtx);
  const team = result.Item;
  if (!team) {
    log.warn("Group not found", fnCtx);
    AuditService.logAction({
      userID,
      action: "REMOVE_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "DELETE",
      endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
      status: "failure",
      statusCode: 404,
      errorMessage: "Group not found",
      durationMs: Date.now() - startTime
    });
    return response(404, { success: false, message: "Group not found" });
  }
  if (team.ownerID !== userID) {
    log.warn("Unauthorized remove member attempt", { ...fnCtx, ownerID: team.ownerID });
    AuditService.logAction({
      userID,
      action: "REMOVE_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "DELETE",
      endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
      status: "failure",
      statusCode: 403,
      errorMessage: "Only the group owner can remove members",
      durationMs: Date.now() - startTime
    });
    return response(403, { success: false, message: "Only the group owner can remove members" });
  }
  if (memberUserID === team.ownerID) {
    log.warn("Attempted to remove group owner", fnCtx);
    AuditService.logAction({
      userID,
      action: "REMOVE_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "DELETE",
      endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
      status: "failure",
      statusCode: 400,
      errorMessage: "Cannot remove the group owner",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "Cannot remove the group owner" });
  }
  if (!team.members.includes(memberUserID)) {
    log.warn("Member not found in group", fnCtx);
    AuditService.logAction({
      userID,
      action: "REMOVE_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "DELETE",
      endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
      status: "failure",
      statusCode: 400,
      errorMessage: "User is not a member of this group",
      durationMs: Date.now() - startTime
    });
    return response(400, { success: false, message: "User is not a member of this group" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updatedMembers = team.members.filter((m) => m !== memberUserID);
  try {
    const updateStart = Date.now();
    log.dbOperation("UpdateItem", TEAMS_TABLE, { teamID, removingMember: memberUserID }, fnCtx);
    await ddb2.send(new UpdateCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID },
      UpdateExpression: "SET members = :members, updatedAt = :ua",
      ExpressionAttributeValues: { ":members": updatedMembers, ":ua": nowIso }
    }));
    log.dbResult("UpdateItem", TEAMS_TABLE, 1, Date.now() - updateStart, fnCtx);
    AuditService.logAction({
      userID,
      action: "REMOVE_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "DELETE",
      endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
      status: "success",
      statusCode: 200,
      changes: {
        before: { memberCount: team.members.length, removedMember: memberUserID },
        after: { memberCount: updatedMembers.length }
      },
      durationMs: Date.now() - startTime
    });
    log.info("removeGroupMember completed", { ...fnCtx, newMemberCount: updatedMembers.length, durationMs: Date.now() - startTime });
    return response(200, {
      success: true,
      message: "Member removed successfully"
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error("removeGroupMember failed", fnCtx, err);
    AuditService.logAction({
      userID,
      action: "REMOVE_GROUP_MEMBER",
      resourceType: "group",
      resourceID: teamID,
      httpMethod: "DELETE",
      endpoint: `/api/groups/${teamID}/members/${memberUserID}`,
      status: "failure",
      statusCode: 500,
      errorMessage: error.message,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}
export {
  handler
};

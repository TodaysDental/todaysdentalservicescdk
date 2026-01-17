// src/services/comm/rest-api-handler.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

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

// src/services/comm/rest-api-handler.ts
var REGION = process.env.AWS_REGION || "us-east-1";
var FAVORS_TABLE = process.env.FAVORS_TABLE || "";
var TEAMS_TABLE = process.env.TEAMS_TABLE || "";
var MEETINGS_TABLE = process.env.MEETINGS_TABLE || "";
var MESSAGES_TABLE = process.env.MESSAGES_TABLE || "";
var SYSTEM_MODULES = ["HR", "Accounting", "Operations", "Finance", "Marketing", "Legal", "IT"];
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
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
  const claims = event.requestContext.authorizer?.claims;
  return claims?.sub || claims?.["cognito:username"] || null;
}
var handler = async (event) => {
  const { httpMethod, path, pathParameters, queryStringParameters, body } = event;
  const userID = getUserIdFromEvent(event);
  if (!userID) {
    return response(401, { success: false, message: "Unauthorized" });
  }
  try {
    const parsedBody = body ? JSON.parse(body) : {};
    if (path.match(/^\/api\/conversations\/search$/)) {
      return await searchConversations(userID, queryStringParameters);
    }
    if (path.match(/^\/api\/conversations\/profiles$/)) {
      return await getConversationProfiles(userID, queryStringParameters);
    }
    if (path.match(/^\/api\/conversations\/[^/]+\/complete$/)) {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      return await getConversationComplete(userID, favorRequestID);
    }
    if (path.match(/^\/api\/conversations\/[^/]+\/user-details$/)) {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      return await getConversationUserDetails(userID, favorRequestID);
    }
    if (path.match(/^\/api\/conversations\/[^/]+\/deadline$/) && httpMethod === "PUT") {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      return await updateConversationDeadline(userID, favorRequestID, parsedBody);
    }
    if (path.match(/^\/api\/conversations\/[^/]+$/) && httpMethod === "DELETE") {
      const favorRequestID = pathParameters?.favorRequestID || path.split("/")[3];
      return await deleteConversation(userID, favorRequestID, queryStringParameters);
    }
    if (path.match(/^\/api\/conversations$/) && httpMethod === "GET") {
      return await getConversations(userID, queryStringParameters);
    }
    if (path.match(/^\/api\/tasks\/by-status$/) && httpMethod === "GET") {
      return await getTasksByStatus(userID, queryStringParameters);
    }
    if (path.match(/^\/api\/tasks\/forward-history$/) && httpMethod === "GET") {
      return await getForwardHistory(userID, queryStringParameters);
    }
    if (path.match(/^\/api\/tasks\/forwarded-to-me$/) && httpMethod === "GET") {
      return await getForwardedToMe(userID, queryStringParameters);
    }
    if (path.match(/^\/api\/tasks\/group$/) && httpMethod === "POST") {
      return await createGroupTask(userID, parsedBody);
    }
    if (path.match(/^\/api\/tasks\/[^/]+\/forward\/[^/]+\/respond$/) && httpMethod === "POST") {
      const parts = path.split("/");
      const taskID = parts[3];
      const forwardID = parts[5];
      return await respondToForward(userID, taskID, forwardID, parsedBody);
    }
    if (path.match(/^\/api\/tasks\/[^/]+\/forward$/) && httpMethod === "POST") {
      const taskID = pathParameters?.taskID || path.split("/")[3];
      return await forwardTask(userID, taskID, parsedBody);
    }
    if (path.match(/^\/api\/tasks\/[^/]+\/deadline$/) && httpMethod === "PUT") {
      const taskID = pathParameters?.taskID || path.split("/")[3];
      return await updateTaskDeadline(userID, taskID, parsedBody);
    }
    if (path.match(/^\/api\/tasks$/) && httpMethod === "POST") {
      return await createTask(userID, parsedBody);
    }
    if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === "PUT") {
      const meetingID = pathParameters?.meetingID || path.split("/")[3];
      return await updateMeeting(userID, meetingID, parsedBody);
    }
    if (path.match(/^\/api\/meetings\/[^/]+$/) && httpMethod === "DELETE") {
      const meetingID = pathParameters?.meetingID || path.split("/")[3];
      return await deleteMeeting(userID, meetingID, queryStringParameters);
    }
    if (path.match(/^\/api\/meetings$/) && httpMethod === "POST") {
      return await createMeeting(userID, parsedBody);
    }
    if (path.match(/^\/api\/meetings$/) && httpMethod === "GET") {
      return await getMeetings(userID, queryStringParameters);
    }
    if (path.match(/^\/api\/groups\/[^/]+\/members\/[^/]+$/) && httpMethod === "DELETE") {
      const parts = path.split("/");
      const teamID = parts[3];
      const memberUserID = parts[5];
      return await removeGroupMember(userID, teamID, memberUserID);
    }
    if (path.match(/^\/api\/groups\/[^/]+\/members$/) && httpMethod === "POST") {
      const teamID = pathParameters?.teamID || path.split("/")[3];
      return await addGroupMember(userID, teamID, parsedBody);
    }
    if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === "GET") {
      const teamID = pathParameters?.teamID || path.split("/")[3];
      return await getGroupDetails(userID, teamID);
    }
    if (path.match(/^\/api\/groups\/[^/]+$/) && httpMethod === "PUT") {
      const teamID = pathParameters?.teamID || path.split("/")[3];
      return await updateGroup(userID, teamID, parsedBody);
    }
    if (path.match(/^\/api\/groups$/) && httpMethod === "POST") {
      return await createGroup(userID, parsedBody);
    }
    if (path.match(/^\/api\/groups$/) && httpMethod === "GET") {
      return await getGroups(userID, queryStringParameters);
    }
    return response(404, { success: false, message: "Endpoint not found" });
  } catch (error) {
    console.error("Error processing request:", error);
    return response(500, { success: false, message: "Internal server error" });
  }
};
async function searchConversations(userID, params) {
  const { query, status, type, sort = "newest", deadline, category, priority, limit = 20, offset = 0 } = params || {};
  const [sentResult, recvResult] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: FAVORS_TABLE,
      IndexName: "SenderIndex",
      KeyConditionExpression: "senderID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    })),
    ddb.send(new QueryCommand({
      TableName: FAVORS_TABLE,
      IndexName: "ReceiverIndex",
      KeyConditionExpression: "receiverID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    }))
  ]);
  let conversations = [...sentResult.Items || [], ...recvResult.Items || []];
  const byId = /* @__PURE__ */ new Map();
  for (const conv of conversations) {
    byId.set(conv.favorRequestID, conv);
  }
  conversations = Array.from(byId.values());
  if (query) {
    const q = query.toLowerCase();
    conversations = conversations.filter(
      (c) => c.title?.toLowerCase().includes(q) || c.initialMessage?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
    );
  }
  if (status)
    conversations = conversations.filter((c) => c.status === status);
  if (type)
    conversations = conversations.filter((c) => c.requestType === type);
  if (category)
    conversations = conversations.filter((c) => c.category === category);
  if (priority)
    conversations = conversations.filter((c) => c.priority === priority);
  if (sort === "newest") {
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else if (sort === "oldest") {
    conversations.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  } else if (sort === "deadline") {
    conversations.sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
  }
  const total = conversations.length;
  const paginatedConversations = conversations.slice(Number(offset), Number(offset) + Number(limit));
  return response(200, {
    success: true,
    conversations: paginatedConversations,
    total,
    hasMore: Number(offset) + paginatedConversations.length < total
  });
}
async function getConversationProfiles(userID, params) {
  const { tab = "single", status, limit = 50, offset = 0 } = params || {};
  const indexName = tab === "group" ? "TeamIndex" : "SenderIndex";
  const [sentResult, recvResult] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: FAVORS_TABLE,
      IndexName: "SenderIndex",
      KeyConditionExpression: "senderID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    })),
    ddb.send(new QueryCommand({
      TableName: FAVORS_TABLE,
      IndexName: "ReceiverIndex",
      KeyConditionExpression: "receiverID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    }))
  ]);
  let items = [...sentResult.Items || [], ...recvResult.Items || []];
  const byId = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (tab === "single" && !item.teamID) {
      byId.set(item.favorRequestID, item);
    } else if (tab === "group" && item.teamID) {
      byId.set(item.favorRequestID, item);
    }
  }
  items = Array.from(byId.values());
  if (status) {
    items = items.filter((i) => i.status === status);
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
  return response(200, {
    success: true,
    profiles,
    total,
    hasMore: Number(offset) + profiles.length < total
  });
}
async function getConversationComplete(userID, favorRequestID) {
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    return response(404, { success: false, message: "Conversation not found" });
  }
  if (favor.senderID !== userID && favor.receiverID !== userID && favor.currentAssigneeID !== userID) {
    if (favor.teamID && TEAMS_TABLE) {
      const teamResult = await ddb.send(new GetCommand({
        TableName: TEAMS_TABLE,
        Key: { teamID: favor.teamID }
      }));
      const team = teamResult.Item;
      if (!team?.members.includes(userID)) {
        return response(403, { success: false, message: "Unauthorized" });
      }
    } else {
      return response(403, { success: false, message: "Unauthorized" });
    }
  }
  const messagesResult = await ddb.send(new QueryCommand({
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: "favorRequestID = :id",
    ExpressionAttributeValues: { ":id": favorRequestID },
    ScanIndexForward: true
  }));
  return response(200, {
    success: true,
    conversation: favor,
    participants: [favor.senderID, favor.receiverID, favor.currentAssigneeID].filter(Boolean),
    tasks: [favor],
    // Each favor is a task
    files: (messagesResult.Items || []).filter((m) => m.type === "file"),
    statistics: {
      totalMessages: messagesResult.Items?.length || 0,
      totalFiles: (messagesResult.Items || []).filter((m) => m.type === "file").length
    }
  });
}
async function getConversationUserDetails(userID, favorRequestID) {
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    return response(404, { success: false, message: "Conversation not found" });
  }
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
async function updateConversationDeadline(userID, favorRequestID, body) {
  const { deadline } = body;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: deadline ? "SET deadline = :d, updatedAt = :ua" : "REMOVE deadline SET updatedAt = :ua",
    ExpressionAttributeValues: deadline ? { ":d": deadline, ":ua": nowIso } : { ":ua": nowIso }
  }));
  return response(200, {
    success: true,
    message: "Deadline updated successfully",
    conversation: { favorRequestID, deadline, updatedAt: nowIso }
  });
}
async function deleteConversation(userID, favorRequestID, params) {
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor || favor.senderID !== userID) {
    return response(403, { success: false, message: "Unauthorized: Only the creator can delete" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: "SET #s = :status, updatedAt = :ua",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":status": "deleted", ":ua": nowIso }
  }));
  return response(200, {
    success: true,
    message: "Conversation deleted successfully",
    deleted: { conversationID: favorRequestID }
  });
}
async function getConversations(userID, params) {
  const { tab, status, category, limit = 20, offset = 0 } = params || {};
  const [sentResult, recvResult] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: FAVORS_TABLE,
      IndexName: "SenderIndex",
      KeyConditionExpression: "senderID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    })),
    ddb.send(new QueryCommand({
      TableName: FAVORS_TABLE,
      IndexName: "ReceiverIndex",
      KeyConditionExpression: "receiverID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      ScanIndexForward: false
    }))
  ]);
  let conversations = [...sentResult.Items || [], ...recvResult.Items || []];
  const byId = /* @__PURE__ */ new Map();
  for (const conv of conversations) {
    byId.set(conv.favorRequestID, conv);
  }
  conversations = Array.from(byId.values());
  if (tab === "single")
    conversations = conversations.filter((c) => !c.teamID);
  if (tab === "group")
    conversations = conversations.filter((c) => !!c.teamID);
  if (status)
    conversations = conversations.filter((c) => c.status === status);
  if (category)
    conversations = conversations.filter((c) => c.category === category);
  conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = conversations.length;
  const paginatedConversations = conversations.slice(Number(offset), Number(offset) + Number(limit));
  return response(200, {
    success: true,
    conversations: paginatedConversations,
    total,
    hasMore: Number(offset) + paginatedConversations.length < total
  });
}
async function getTasksByStatus(userID, params) {
  const { status, conversationID, assignedTo, category, priority, limit = 20, offset = 0 } = params || {};
  let items = [];
  if (status) {
    const result = await ddb.send(new QueryCommand({
      TableName: FAVORS_TABLE,
      IndexName: "StatusIndex",
      KeyConditionExpression: "#s = :status",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":status": status },
      ScanIndexForward: false
    }));
    items = result.Items || [];
  } else {
    const [sentResult, recvResult] = await Promise.all([
      ddb.send(new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: "SenderIndex",
        KeyConditionExpression: "senderID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      })),
      ddb.send(new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: "ReceiverIndex",
        KeyConditionExpression: "receiverID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      }))
    ]);
    items = [...sentResult.Items || [], ...recvResult.Items || []];
  }
  const byId = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (item.senderID === userID || item.receiverID === userID || item.currentAssigneeID === userID) {
      byId.set(item.favorRequestID, item);
    }
  }
  items = Array.from(byId.values());
  if (category)
    items = items.filter((i) => i.category === category);
  if (priority)
    items = items.filter((i) => i.priority === priority);
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
  return response(200, {
    success: true,
    tasks,
    total,
    hasMore: Number(offset) + tasks.length < total,
    statistics: stats
  });
}
async function getForwardHistory(userID, params) {
  const { conversationID, taskID, limit = 50, offset = 0 } = params || {};
  let items = [];
  if (taskID || conversationID) {
    const result = await ddb.send(new GetCommand({
      TableName: FAVORS_TABLE,
      Key: { favorRequestID: taskID || conversationID }
    }));
    if (result.Item)
      items = [result.Item];
  } else {
    const [sentResult, recvResult] = await Promise.all([
      ddb.send(new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: "SenderIndex",
        KeyConditionExpression: "senderID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      })),
      ddb.send(new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: "ReceiverIndex",
        KeyConditionExpression: "receiverID = :uid",
        ExpressionAttributeValues: { ":uid": userID }
      }))
    ]);
    const all = [...sentResult.Items || [], ...recvResult.Items || []];
    items = all.filter((i) => i.forwardingChain && i.forwardingChain.length > 0);
  }
  const forwardHistory = items.flatMap(
    (item) => (item.forwardingChain || []).map((f) => ({
      ...f,
      taskID: item.favorRequestID,
      taskTitle: item.title,
      conversationID: item.favorRequestID
    }))
  );
  forwardHistory.sort((a, b) => b.forwardedAt.localeCompare(a.forwardedAt));
  const total = forwardHistory.length;
  const paginated = forwardHistory.slice(Number(offset), Number(offset) + Number(limit));
  return response(200, {
    success: true,
    forwardHistory: paginated,
    total,
    hasMore: Number(offset) + paginated.length < total
  });
}
async function getForwardedToMe(userID, params) {
  const { status, limit = 20, offset = 0 } = params || {};
  const result = await ddb.send(new QueryCommand({
    TableName: FAVORS_TABLE,
    IndexName: "CurrentAssigneeIndex",
    KeyConditionExpression: "currentAssigneeID = :uid",
    ExpressionAttributeValues: { ":uid": userID },
    ScanIndexForward: false
  }));
  let items = result.Items || [];
  items = items.filter((i) => i.forwardingChain && i.forwardingChain.length > 0);
  if (status) {
    items = items.filter((i) => {
      const lastForward = i.forwardingChain?.[i.forwardingChain.length - 1];
      return lastForward?.status === status;
    });
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
  return response(200, {
    success: true,
    forwardedTasks: paginated,
    total,
    hasMore: Number(offset) + paginated.length < total
  });
}
async function forwardTask(userID, taskID, body) {
  const { forwardTo, message, deadline, requireAcceptance = false, notifyOriginalAssignee = true } = body;
  if (!forwardTo) {
    return response(400, { success: false, message: "forwardTo is required" });
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
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
  await ddb.send(new UpdateCommand({
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
  return response(200, {
    success: true,
    forwardID,
    message: "Task forwarded successfully",
    forwardingRecord: forwardRecord
  });
}
async function respondToForward(userID, taskID, forwardID, body) {
  const { action, rejectionReason } = body;
  if (!action || !["accept", "reject"].includes(action)) {
    return response(400, { success: false, message: "action must be accept or reject" });
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    return response(404, { success: false, message: "Task not found" });
  }
  const forwardingChain = favor.forwardingChain || [];
  const forwardIndex = forwardingChain.findIndex((f) => f.forwardID === forwardID);
  if (forwardIndex === -1) {
    return response(404, { success: false, message: "Forward record not found" });
  }
  const forwardRecord = forwardingChain[forwardIndex];
  if (forwardRecord.toUserID !== userID) {
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
  await ddb.send(new UpdateCommand({
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
  return response(200, {
    success: true,
    message: "Task response recorded successfully",
    forwardingRecord: forwardingChain[forwardIndex]
  });
}
async function updateTaskDeadline(userID, taskID, body) {
  const { deadline } = body;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: taskID },
    UpdateExpression: deadline ? "SET deadline = :d, updatedAt = :ua" : "REMOVE deadline SET updatedAt = :ua",
    ExpressionAttributeValues: deadline ? { ":d": deadline, ":ua": nowIso } : { ":ua": nowIso }
  }));
  return response(200, {
    success: true,
    message: "Task deadline updated successfully",
    task: { taskID, deadline, updatedAt: nowIso }
  });
}
async function createTask(userID, body) {
  const { conversationID, receiverID, title, description, priority = "Medium", category, deadline, requiresAcceptance = false } = body;
  if (!receiverID || !title) {
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
  await ddb.send(new PutCommand({
    TableName: FAVORS_TABLE,
    Item: newTask
  }));
  return response(201, {
    success: true,
    taskID: favorRequestID,
    conversationID: favorRequestID,
    message: "Task created successfully",
    task: newTask
  });
}
async function createGroupTask(userID, body) {
  const { conversationID, teamID, title, description, assignedTo, priority = "Medium", category, deadline, requiresAcceptance = false } = body;
  if (!teamID || !title) {
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
  await ddb.send(new PutCommand({
    TableName: FAVORS_TABLE,
    Item: newTask
  }));
  return response(201, {
    success: true,
    taskID: favorRequestID,
    conversationID: favorRequestID,
    message: "Group task created successfully",
    task: newTask
  });
}
async function createMeeting(userID, body) {
  const { conversationID, title, description, startTime, endTime, location, meetingLink, participants, reminder } = body;
  if (!conversationID || !description || !meetingLink) {
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
  await ddb.send(new PutCommand({
    TableName: MEETINGS_TABLE,
    Item: meeting
  }));
  return response(201, {
    success: true,
    meetingID,
    message: "Meeting scheduled successfully",
    meeting
  });
}
async function getMeetings(userID, params) {
  const { conversationID, status, startDate, endDate, limit = 20, offset = 0 } = params || {};
  let meetings = [];
  if (conversationID) {
    const result = await ddb.send(new QueryCommand({
      TableName: MEETINGS_TABLE,
      IndexName: "ConversationIndex",
      KeyConditionExpression: "conversationID = :cid",
      ExpressionAttributeValues: { ":cid": conversationID },
      ScanIndexForward: false
    }));
    meetings = result.Items || [];
  } else {
    const result = await ddb.send(new QueryCommand({
      TableName: MEETINGS_TABLE,
      IndexName: "OrganizerIndex",
      KeyConditionExpression: "organizerID = :oid",
      ExpressionAttributeValues: { ":oid": userID },
      ScanIndexForward: false
    }));
    meetings = result.Items || [];
  }
  if (status) {
    meetings = meetings.filter((m) => m.status === status);
  }
  if (startDate) {
    meetings = meetings.filter((m) => m.startTime >= startDate);
  }
  if (endDate) {
    meetings = meetings.filter((m) => m.startTime <= endDate);
  }
  const total = meetings.length;
  const paginated = meetings.slice(Number(offset), Number(offset) + Number(limit));
  return response(200, {
    success: true,
    meetings: paginated,
    total,
    hasMore: Number(offset) + paginated.length < total
  });
}
async function updateMeeting(userID, meetingID, body) {
  const meetingResult = await ddb.send(new GetCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  const meeting = meetingResult.Item;
  if (!meeting) {
    return response(404, { success: false, message: "Meeting not found" });
  }
  if (meeting.organizerID !== userID) {
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
  await ddb.send(new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID },
    UpdateExpression: "SET " + updateExpressions.join(", "),
    ExpressionAttributeValues: expressionValues,
    ...Object.keys(expressionNames).length > 0 ? { ExpressionAttributeNames: expressionNames } : {}
  }));
  return response(200, {
    success: true,
    message: "Meeting updated successfully",
    meeting: { meetingID, ...body, updatedAt: nowIso }
  });
}
async function deleteMeeting(userID, meetingID, params) {
  const meetingResult = await ddb.send(new GetCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  const meeting = meetingResult.Item;
  if (!meeting) {
    return response(404, { success: false, message: "Meeting not found" });
  }
  if (meeting.organizerID !== userID) {
    return response(403, { success: false, message: "Only the organizer can delete this meeting" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID },
    UpdateExpression: "SET #s = :status, updatedAt = :ua",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":status": "cancelled", ":ua": nowIso }
  }));
  return response(200, {
    success: true,
    message: "Meeting deleted successfully",
    meetingID
  });
}
async function createGroup(userID, body) {
  const { name, description, members, category, createConversation = true } = body;
  if (!name || !members || members.length === 0) {
    return response(400, { success: false, message: "name and members are required" });
  }
  const teamID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const uniqueMembers = Array.from(/* @__PURE__ */ new Set([...members, userID]));
  const team = {
    teamID,
    ownerID: userID,
    name,
    description,
    members: uniqueMembers,
    ...category && { category },
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await ddb.send(new PutCommand({
    TableName: TEAMS_TABLE,
    Item: team
  }));
  let conversationID;
  if (createConversation) {
    conversationID = v4_default();
    const conversation = {
      favorRequestID: conversationID,
      senderID: userID,
      teamID,
      title: name,
      description: description || `Group conversation for ${name}`,
      status: "active",
      priority: "Medium",
      ...category && { category },
      createdAt: nowIso,
      updatedAt: nowIso,
      userID,
      requestType: "General",
      unreadCount: 0,
      initialMessage: `Group ${name} created`
    };
    await ddb.send(new PutCommand({
      TableName: FAVORS_TABLE,
      Item: conversation
    }));
  }
  return response(201, {
    success: true,
    teamID,
    conversationID,
    message: "Group created successfully",
    group: team
  });
}
async function getGroups(userID, params) {
  const { category, limit = 20, offset = 0 } = params || {};
  const result = await ddb.send(new ScanCommand({
    TableName: TEAMS_TABLE,
    FilterExpression: "contains(members, :uid)",
    ExpressionAttributeValues: { ":uid": userID }
  }));
  let groups = result.Items || [];
  if (category) {
    groups = groups.filter((g) => g.category === category);
  }
  groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = groups.length;
  const paginated = groups.slice(Number(offset), Number(offset) + Number(limit));
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
async function getGroupDetails(userID, teamID) {
  const result = await ddb.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  const team = result.Item;
  if (!team) {
    return response(404, { success: false, message: "Group not found" });
  }
  if (!team.members.includes(userID)) {
    return response(403, { success: false, message: "Unauthorized" });
  }
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
async function updateGroup(userID, teamID, body) {
  const result = await ddb.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  const team = result.Item;
  if (!team) {
    return response(404, { success: false, message: "Group not found" });
  }
  if (team.ownerID !== userID) {
    return response(403, { success: false, message: "Only the owner can update this group" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const { name, description, category } = body;
  const updateExpressions = ["updatedAt = :ua"];
  const expressionValues = { ":ua": nowIso };
  if (name !== void 0) {
    updateExpressions.push("#n = :name");
    expressionValues[":name"] = name;
  }
  if (description !== void 0) {
    updateExpressions.push("description = :desc");
    expressionValues[":desc"] = description;
  }
  if (category !== void 0) {
    updateExpressions.push("category = :cat");
    expressionValues[":cat"] = category;
  }
  await ddb.send(new UpdateCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID },
    UpdateExpression: "SET " + updateExpressions.join(", "),
    ExpressionAttributeNames: name !== void 0 ? { "#n": "name" } : void 0,
    ExpressionAttributeValues: expressionValues
  }));
  return response(200, {
    success: true,
    message: "Group updated successfully",
    group: { teamID, name, description, category, updatedAt: nowIso }
  });
}
async function addGroupMember(userID, teamID, body) {
  const { userID: memberUserID } = body;
  if (!memberUserID) {
    return response(400, { success: false, message: "userID is required" });
  }
  const result = await ddb.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  const team = result.Item;
  if (!team) {
    return response(404, { success: false, message: "Group not found" });
  }
  if (team.ownerID !== userID) {
    return response(403, { success: false, message: "Only the owner can add members" });
  }
  if (team.members.includes(memberUserID)) {
    return response(400, { success: false, message: "User is already a member" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updatedMembers = [...team.members, memberUserID];
  await ddb.send(new UpdateCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID },
    UpdateExpression: "SET members = :members, updatedAt = :ua",
    ExpressionAttributeValues: { ":members": updatedMembers, ":ua": nowIso }
  }));
  return response(200, {
    success: true,
    message: "Member added successfully",
    member: { userID: memberUserID, joinedAt: nowIso }
  });
}
async function removeGroupMember(userID, teamID, memberUserID) {
  const result = await ddb.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID }
  }));
  const team = result.Item;
  if (!team) {
    return response(404, { success: false, message: "Group not found" });
  }
  if (team.ownerID !== userID) {
    return response(403, { success: false, message: "Only the owner can remove members" });
  }
  if (memberUserID === team.ownerID) {
    return response(400, { success: false, message: "Cannot remove the owner" });
  }
  if (!team.members.includes(memberUserID)) {
    return response(400, { success: false, message: "User is not a member" });
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updatedMembers = team.members.filter((m) => m !== memberUserID);
  await ddb.send(new UpdateCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID },
    UpdateExpression: "SET members = :members, updatedAt = :ua",
    ExpressionAttributeValues: { ":members": updatedMembers, ":ua": nowIso }
  }));
  return response(200, {
    success: true,
    message: "Member removed successfully"
  });
}
export {
  handler
};

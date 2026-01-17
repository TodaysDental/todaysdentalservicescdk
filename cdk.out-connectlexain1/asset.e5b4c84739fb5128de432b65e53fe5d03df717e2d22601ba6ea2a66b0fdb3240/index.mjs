// src/services/comm/ws-default.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

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

// src/services/comm/ws-default.ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
var REGION = process.env.AWS_REGION || "us-east-1";
var CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "";
var MESSAGES_TABLE = process.env.MESSAGES_TABLE || "";
var FAVORS_TABLE = process.env.FAVORS_TABLE || "";
var TEAMS_TABLE = process.env.TEAMS_TABLE || "";
var MEETINGS_TABLE = process.env.MEETINGS_TABLE || "";
var FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || "";
var NOTIFICATIONS_TOPIC_ARN = process.env.NOTICES_TOPIC_ARN || "";
var SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || "no-reply@todaysdentalinsights.com";
var USER_POOL_ID = process.env.USER_POOL_ID || "";
var DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || "";
var SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || "";
var PUSH_NOTIFICATIONS_ENABLED = !!(DEVICE_TOKENS_TABLE && SEND_PUSH_FUNCTION_ARN);
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
var sns = new SNSClient({ region: REGION });
var s3 = new S3Client({ region: REGION });
var ses = new SESv2Client({ region: REGION });
var cognito = new CognitoIdentityProviderClient({ region: REGION });
var lambdaClient = new LambdaClient({ region: REGION });
var handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const domainName = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const apiGwManagement = new ApiGatewayManagementApiClient({
    region: REGION,
    endpoint: `https://${domainName}/${stage}`
  });
  try {
    const payload = JSON.parse(event.body || "{}");
    const senderInfo = await getSenderInfo(connectionId);
    if (!senderInfo) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Connection not authenticated" });
      return { statusCode: 401, body: "Unauthorized or connection missing" };
    }
    const senderID = senderInfo.userID;
    switch (payload.action) {
      case "createTeam":
        await createTeam(senderID, payload, connectionId, apiGwManagement);
        break;
      case "listTeams":
        await listTeams(senderID, connectionId, apiGwManagement);
        break;
      case "addUserToTeam":
        await addUserToTeam(senderID, payload, connectionId, apiGwManagement);
        break;
      case "removeUserFromTeam":
        await removeUserFromTeam(senderID, payload, connectionId, apiGwManagement);
        break;
      case "startFavorRequest":
        await startFavorRequest(senderID, payload, connectionId, apiGwManagement);
        break;
      case "sendMessage":
        await sendMessage(senderID, payload, apiGwManagement);
        break;
      case "resolveRequest":
        await resolveRequest(senderID, payload, apiGwManagement);
        break;
      case "getPresignedUrl":
        await getPresignedUrl(senderID, payload, connectionId, apiGwManagement);
        break;
      case "fetchHistory":
        await fetchHistory(senderID, payload, connectionId, apiGwManagement);
        break;
      case "markRead":
        await markRead(senderID, payload, connectionId, apiGwManagement);
        break;
      case "fetchRequests":
        await fetchRequests(senderID, payload, connectionId, apiGwManagement);
        break;
      case "forwardTask":
        await forwardTask(senderID, payload, connectionId, apiGwManagement);
        break;
      case "acceptForwardedTask":
        await respondToForward(senderID, payload, "accept", connectionId, apiGwManagement);
        break;
      case "rejectForwardedTask":
        await respondToForward(senderID, payload, "reject", connectionId, apiGwManagement);
        break;
      case "markTaskCompleted":
        await markTaskCompleted(senderID, payload, connectionId, apiGwManagement);
        break;
      case "updateTaskDeadline":
        await updateTaskDeadline(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getTaskDetails":
        await getTaskDetails(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getForwardHistory":
        await getForwardHistory(senderID, payload, connectionId, apiGwManagement);
        break;
      case "deleteConversation":
        await deleteConversation(senderID, payload, connectionId, apiGwManagement);
        break;
      case "scheduleMeeting":
        await scheduleMeeting(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getMeetings":
        await getMeetings(senderID, payload, connectionId, apiGwManagement);
        break;
      case "updateMeeting":
        await updateMeeting(senderID, payload, connectionId, apiGwManagement);
        break;
      case "deleteMeeting":
        await deleteMeeting(senderID, payload, connectionId, apiGwManagement);
        break;
      default:
        await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unknown action" });
    }
    return { statusCode: 200, body: "Data processed" };
  } catch (error) {
    console.error("Error processing WebSocket message:", error);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Internal server error" });
    return { statusCode: 500, body: "Error" };
  }
};
async function createTeam(ownerID, payload, connectionId, apiGwManagement) {
  const { name, members } = payload;
  if (!name || !Array.isArray(members) || members.length === 0) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing team name or members list." });
    return;
  }
  if (!TEAMS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  const uniqueMembers = Array.from(/* @__PURE__ */ new Set([...members, ownerID]));
  const teamID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const newTeam = {
    teamID,
    ownerID,
    name: String(name),
    members: uniqueMembers,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  try {
    await ddb.send(new PutCommand({
      TableName: TEAMS_TABLE,
      Item: newTeam
    }));
    console.log(`Team created: ${teamID} by ${ownerID}`);
    const notificationPayload = {
      type: "teamCreated",
      team: newTeam
    };
    await sendToAll(apiGwManagement, uniqueMembers, notificationPayload, { notifyOffline: false });
  } catch (e) {
    console.error("Failed to create team:", e);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Failed to create team." });
  }
}
async function listTeams(callerID, connectionId, apiGwManagement) {
  if (!TEAMS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  try {
    const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
    const result = await ddb.send(new ScanCommand({
      TableName: TEAMS_TABLE,
      FilterExpression: "contains(members, :callerID)",
      ExpressionAttributeValues: {
        ":callerID": callerID
      }
    }));
    const teams = result.Items || [];
    teams.sort((a, b) => {
      const aTime = a.updatedAt || "";
      const bTime = b.updatedAt || "";
      if (aTime < bTime)
        return 1;
      if (aTime > bTime)
        return -1;
      return 0;
    });
    await sendToClient(apiGwManagement, connectionId, {
      type: "teamsList",
      teams: teams.map((t) => ({
        teamID: t.teamID,
        name: t.name,
        ownerID: t.ownerID,
        memberCount: t.members.length,
        members: t.members,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
      }))
    });
  } catch (e) {
    console.error("Failed to list teams:", e);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Failed to list teams." });
  }
}
async function addUserToTeam(callerID, payload, connectionId, apiGwManagement) {
  const { teamID, userID } = payload;
  if (!teamID || !userID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing teamID or userID." });
    return;
  }
  if (!TEAMS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  try {
    const teamResult = await ddb.send(new GetCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID }
    }));
    const team = teamResult.Item;
    if (!team) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Team not found." });
      return;
    }
    if (team.ownerID !== callerID) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the team owner can add members." });
      return;
    }
    if (team.members.includes(userID)) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "User is already a member of this team." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const updatedMembers = [...team.members, userID];
    await ddb.send(new UpdateCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID },
      UpdateExpression: "SET members = :members, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":members": updatedMembers,
        ":updatedAt": nowIso
      }
    }));
    console.log(`User ${userID} added to team ${teamID} by ${callerID}`);
    const updatedTeam = {
      ...team,
      members: updatedMembers,
      updatedAt: nowIso
    };
    const notificationPayload = {
      type: "teamMemberAdded",
      team: updatedTeam,
      addedUserID: userID,
      addedBy: callerID
    };
    await sendToAll(apiGwManagement, updatedMembers, notificationPayload, { notifyOffline: false });
  } catch (e) {
    console.error("Failed to add user to team:", e);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Failed to add user to team." });
  }
}
async function removeUserFromTeam(callerID, payload, connectionId, apiGwManagement) {
  const { teamID, userID } = payload;
  if (!teamID || !userID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing teamID or userID." });
    return;
  }
  if (!TEAMS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  try {
    const teamResult = await ddb.send(new GetCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID }
    }));
    const team = teamResult.Item;
    if (!team) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Team not found." });
      return;
    }
    if (team.ownerID !== callerID) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the team owner can remove members." });
      return;
    }
    if (userID === team.ownerID) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "The team owner cannot be removed from the team." });
      return;
    }
    if (!team.members.includes(userID)) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "User is not a member of this team." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const updatedMembers = team.members.filter((m) => m !== userID);
    await ddb.send(new UpdateCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID },
      UpdateExpression: "SET members = :members, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":members": updatedMembers,
        ":updatedAt": nowIso
      }
    }));
    console.log(`User ${userID} removed from team ${teamID} by ${callerID}`);
    const updatedTeam = {
      ...team,
      members: updatedMembers,
      updatedAt: nowIso
    };
    const notificationPayload = {
      type: "teamMemberRemoved",
      team: updatedTeam,
      removedUserID: userID,
      removedBy: callerID
    };
    await sendToAll(apiGwManagement, [...updatedMembers, userID], notificationPayload, { notifyOffline: false });
  } catch (e) {
    console.error("Failed to remove user from team:", e);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Failed to remove user from team." });
  }
}
function sanitizeFileKey(key) {
  if (!key || key.includes("?")) {
    try {
      const url = new URL(key);
      return url.pathname.replace(/^\/+/, "");
    } catch (e) {
      return key;
    }
  }
  return key;
}
async function startFavorRequest(senderID, payload, senderConnectionId, apiGwManagement) {
  const {
    receiverID,
    teamID,
    initialMessage,
    requestType,
    deadline,
    title,
    description,
    priority = "Medium",
    category,
    tags
  } = payload;
  if (!initialMessage || !requestType || !receiverID && !teamID) {
    await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Missing initialMessage, requestType, and recipient (receiverID or teamID)." });
    return;
  }
  const isGroupRequest = !!teamID;
  let recipients = [];
  if (isGroupRequest) {
    if (!TEAMS_TABLE) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Server error: Teams table not configured for group request." });
      return;
    }
    const teamResult = await ddb.send(new GetCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID }
    }));
    const team = teamResult.Item;
    if (!team) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: `Team ID ${teamID} not found.` });
      return;
    }
    if (!team.members.includes(senderID)) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Unauthorized: You are not a member of this team." });
      return;
    }
    recipients = team.members.filter((memberId) => memberId !== senderID);
    if (recipients.length === 0) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "The team has no other members to assign the task to." });
      return;
    }
  } else {
    if (senderID === receiverID) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "A favor request cannot be started with yourself. Please select another user." });
      return;
    }
    recipients = [receiverID];
  }
  const favorRequestID = v4_default();
  const timestamp = Date.now();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const newFavor = {
    favorRequestID,
    senderID,
    // Include receiverID only for 1-to-1, teamID only for group
    ...isGroupRequest ? { teamID } : { receiverID },
    // Enhanced task fields
    title: title || initialMessage.substring(0, 100),
    description: description || initialMessage,
    status: "pending",
    priority,
    ...category && { category },
    ...tags && { tags },
    currentAssigneeID: isGroupRequest ? void 0 : receiverID,
    createdAt: nowIso,
    updatedAt: nowIso,
    userID: senderID,
    requestType,
    unreadCount: recipients.length,
    initialMessage,
    ...deadline && { deadline: String(deadline) }
  };
  await ddb.send(new PutCommand({
    TableName: FAVORS_TABLE,
    Item: newFavor
  }));
  const messageData = {
    favorRequestID,
    senderID,
    content: initialMessage,
    timestamp,
    type: "text"
  };
  await _saveAndBroadcastMessage(messageData, apiGwManagement, isGroupRequest ? recipients : void 0);
  if (!isGroupRequest) {
    try {
      await sendNewFavorNotificationEmail(senderID, receiverID, initialMessage, requestType, deadline);
    } catch (e) {
      console.error("Failed to send SES notification email for 1-to-1:", e);
    }
  }
  const senderDetails = await getUserDetails(senderID);
  await sendTaskPushNotification(
    recipients,
    "task_assigned",
    newFavor.title || initialMessage.substring(0, 50),
    senderDetails.fullName,
    favorRequestID,
    { priority: newFavor.priority, category: newFavor.category }
  );
  await sendToClient(apiGwManagement, senderConnectionId, {
    type: "favorRequestStarted",
    favorRequestID,
    favor: newFavor,
    receiverID,
    teamID,
    requestType,
    deadline,
    title: newFavor.title,
    priority: newFavor.priority,
    category: newFavor.category
  });
}
async function sendMessage(senderID, payload, apiGwManagement) {
  const { favorRequestID, content, fileKey, fileDetails } = payload;
  const senderConnectionId = (await getSenderInfoByUserID(senderID))?.connectionId;
  if (!favorRequestID || (!content || content.trim() === "") && !fileKey) {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Missing favorRequestID or message content/file key." });
    }
    return;
  }
  const timestamp = Date.now();
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Favor request not found." });
    }
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    }
    return;
  }
  const recipientIDs = await getRecipientIDs(favor, senderID);
  if (favor.status !== "active" || recipientIDs.length === 0) {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Request is inactive, resolved, or has no recipients." });
    }
    return;
  }
  const incrementAmount = recipientIDs.length;
  const updateResult = await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: "SET updatedAt = :ua ADD unreadCount :incr",
    ExpressionAttributeValues: {
      ":ua": (/* @__PURE__ */ new Date()).toISOString(),
      ":incr": incrementAmount
    },
    ReturnValues: "ALL_NEW"
  }));
  const updatedFavor = updateResult.Attributes;
  const allParticipants = [...recipientIDs, senderID];
  const broadcastUpdatePayload = {
    type: "favorRequestUpdated",
    favor: updatedFavor
  };
  await sendToAll(apiGwManagement, allParticipants, broadcastUpdatePayload, { notifyOffline: false });
  const cleanFileKey = fileKey ? sanitizeFileKey(fileKey) : void 0;
  const messageData = {
    favorRequestID,
    senderID,
    content: content || "",
    timestamp,
    type: cleanFileKey ? "file" : "text",
    fileKey: cleanFileKey,
    fileDetails
  };
  await _saveAndBroadcastMessage(messageData, apiGwManagement, recipientIDs);
}
async function getRecipientIDs(favor, senderID) {
  if (favor.teamID) {
    if (!TEAMS_TABLE) {
      console.error("TEAMS_TABLE not configured for group lookup.");
      return [];
    }
    const teamResult = await ddb.send(new GetCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID: favor.teamID }
    }));
    const team = teamResult.Item;
    return team ? team.members.filter((memberId) => memberId !== senderID) : [];
  } else if (favor.receiverID) {
    const recipientID = favor.senderID === senderID ? favor.receiverID : favor.senderID;
    if (favor.senderID === senderID || favor.receiverID === senderID) {
      return [recipientID];
    }
  }
  return [];
}
async function isUserParticipant(favor, userID) {
  if (!favor.teamID) {
    return favor.senderID === userID || favor.receiverID === userID;
  }
  if (!TEAMS_TABLE) {
    console.error("TEAMS_TABLE not configured for participant check.");
    return false;
  }
  const teamResult = await ddb.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { teamID: favor.teamID }
  }));
  const team = teamResult.Item;
  return team ? team.members.includes(userID) : false;
}
async function getAllParticipants(favor) {
  if (favor.teamID) {
    if (!TEAMS_TABLE) {
      console.error("TEAMS_TABLE not configured for participant lookup.");
      return [favor.senderID];
    }
    const teamResult = await ddb.send(new GetCommand({
      TableName: TEAMS_TABLE,
      Key: { teamID: favor.teamID }
    }));
    const team = teamResult.Item;
    return team ? team.members : [favor.senderID];
  }
  const participants = [favor.senderID];
  if (favor.receiverID) {
    participants.push(favor.receiverID);
  }
  return participants;
}
async function markRead(callerID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Favor request not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, callerID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    return;
  }
  try {
    const updateResult = await ddb.send(new UpdateCommand({
      TableName: FAVORS_TABLE,
      Key: { favorRequestID },
      UpdateExpression: "SET unreadCount = :zero",
      ExpressionAttributeValues: {
        ":zero": 0
      },
      ReturnValues: "ALL_NEW"
    }));
    const updatedFavor = updateResult.Attributes;
    const broadcastUpdatePayload = {
      type: "favorRequestUpdated",
      favor: updatedFavor
    };
    await sendToClient(apiGwManagement, connectionId, broadcastUpdatePayload);
  } catch (e) {
    console.error("Error marking read:", e);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Failed to update read status." });
  }
}
async function resolveRequest(senderID, payload, apiGwManagement) {
  const { favorRequestID } = payload;
  const senderConnectionId = (await getSenderInfoByUserID(senderID))?.connectionId;
  if (!favorRequestID) {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Missing favorRequestID." });
    }
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Favor request not found." });
    }
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    }
    return;
  }
  if (favor.status !== "active") {
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Request is already resolved." });
    }
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await ddb.send(new UpdateCommand({
      TableName: FAVORS_TABLE,
      Key: { favorRequestID },
      // Also reset unread count on resolve
      UpdateExpression: "SET #s = :resolved, updatedAt = :ua, unreadCount = :zero",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":resolved": "resolved",
        ":ua": nowIso,
        ":zero": 0
        // Reset unread count
      }
    }));
    const participants = await getAllParticipants(favor);
    const broadcastPayload = {
      type: "requestResolved",
      favorRequestID,
      resolvedBy: senderID,
      updatedAt: nowIso
    };
    await sendToAll(apiGwManagement, participants, broadcastPayload, { notifyOffline: false });
  } catch (e) {
    console.error("Error resolving request:", e);
    if (senderConnectionId) {
      await sendToClient(apiGwManagement, senderConnectionId, { type: "error", message: "Failed to resolve request." });
    }
  }
}
async function fetchRequests(callerID, payload, connectionId, apiGwManagement) {
  const { role = "all", limit = 50, nextToken } = payload;
  const queryLimit = Math.min(limit, 100);
  let exclusiveStartKey = void 0;
  if (nextToken) {
    try {
      exclusiveStartKey = JSON.parse(nextToken);
    } catch {
      console.warn("Invalid nextToken JSON received, ignoring:", nextToken);
    }
  }
  const queryByIndex = async (indexName, keyName, keyValue, startKey) => {
    return ddb.send(
      new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: indexName,
        KeyConditionExpression: `${keyName} = :uid`,
        ExpressionAttributeValues: {
          ":uid": keyValue
        },
        ScanIndexForward: false,
        // newest first
        Limit: queryLimit,
        ...startKey ? { ExclusiveStartKey: startKey } : {}
      })
    );
  };
  const getUserTeamIDs = async () => {
    if (!TEAMS_TABLE)
      return [];
    const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
    const result = await ddb.send(new ScanCommand({
      TableName: TEAMS_TABLE,
      FilterExpression: "contains(members, :callerID)",
      ExpressionAttributeValues: {
        ":callerID": callerID
      },
      ProjectionExpression: "teamID"
    }));
    return (result.Items || []).map((item) => item.teamID);
  };
  const fetchGroupRequests = async (teamIDs) => {
    if (teamIDs.length === 0)
      return [];
    const groupRequestPromises = teamIDs.map(
      (teamID) => queryByIndex("TeamIndex", "teamID", teamID)
    );
    const results = await Promise.all(groupRequestPromises);
    return results.flatMap((r) => r.Items || []);
  };
  let items = [];
  let newToken = void 0;
  try {
    if (role === "sent") {
      const sentResult = await queryByIndex(
        "SenderIndex",
        "senderID",
        callerID,
        exclusiveStartKey
      );
      items = sentResult.Items || [];
      newToken = sentResult.LastEvaluatedKey ? JSON.stringify(sentResult.LastEvaluatedKey) : void 0;
    } else if (role === "received") {
      const recvResult = await queryByIndex(
        "ReceiverIndex",
        "receiverID",
        callerID,
        exclusiveStartKey
      );
      items = recvResult.Items || [];
      newToken = recvResult.LastEvaluatedKey ? JSON.stringify(recvResult.LastEvaluatedKey) : void 0;
    } else if (role === "group") {
      const teamIDs = await getUserTeamIDs();
      items = await fetchGroupRequests(teamIDs);
      items.sort((a, b) => {
        const aTime = a.updatedAt || "";
        const bTime = b.updatedAt || "";
        if (aTime < bTime)
          return 1;
        if (aTime > bTime)
          return -1;
        return 0;
      });
      items = items.slice(0, queryLimit);
      newToken = void 0;
    } else {
      const [sentResult, recvResult, teamIDs] = await Promise.all([
        queryByIndex("SenderIndex", "senderID", callerID),
        queryByIndex("ReceiverIndex", "receiverID", callerID),
        getUserTeamIDs()
      ]);
      const groupItems = await fetchGroupRequests(teamIDs);
      const allItems = [
        ...sentResult.Items || [],
        ...recvResult.Items || [],
        ...groupItems
      ];
      const byId = /* @__PURE__ */ new Map();
      for (const item of allItems) {
        if (!item || !item.favorRequestID)
          continue;
        byId.set(item.favorRequestID, item);
      }
      const merged = Array.from(byId.values());
      merged.sort((a, b) => {
        const aTime = a.updatedAt || "";
        const bTime = b.updatedAt || "";
        if (aTime < bTime)
          return 1;
        if (aTime > bTime)
          return -1;
        return 0;
      });
      items = merged.slice(0, queryLimit);
      newToken = void 0;
    }
    await sendToClient(apiGwManagement, connectionId, {
      type: "favorRequestsList",
      role,
      items,
      nextToken: newToken
    });
  } catch (error) {
    console.error("Error fetching favor requests via WebSocket:", error);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Failed to fetch favor requests list." });
  }
}
async function _saveAndBroadcastMessage(messageData, apiGwManagement, recipientIDs) {
  await ddb.send(new PutCommand({
    TableName: MESSAGES_TABLE,
    Item: messageData
  }));
  let participants = [messageData.senderID];
  let recipients = recipientIDs;
  if (!recipients) {
    const favorResult = await ddb.send(new GetCommand({
      TableName: FAVORS_TABLE,
      Key: { favorRequestID: messageData.favorRequestID }
    }));
    const favor = favorResult.Item;
    if (!favor)
      return;
    recipients = await getRecipientIDs(favor, messageData.senderID);
    participants = [...participants, ...recipients];
  } else {
    participants = [...participants, ...recipients];
  }
  const broadcastPayload = {
    type: "newMessage",
    message: messageData
  };
  await sendToAll(apiGwManagement, participants, broadcastPayload, { notifyOffline: true, senderID: messageData.senderID });
}
async function getSenderInfo(connectionId) {
  const result = await ddb.send(new GetCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId }
  }));
  const item = result.Item;
  if (!item)
    return void 0;
  return { connectionId: item.connectionId, userID: item.userID };
}
async function getSenderInfoByUserID(userID) {
  const result = await ddb.send(new QueryCommand({
    TableName: CONNECTIONS_TABLE,
    IndexName: "UserIDIndex",
    KeyConditionExpression: "userID = :uid",
    ExpressionAttributeValues: { ":uid": userID },
    Limit: 1
  }));
  const item = result.Items?.[0];
  if (!item)
    return void 0;
  return { connectionId: item.connectionId, userID: item.userID };
}
async function getUserDetails(userID) {
  if (!USER_POOL_ID) {
    console.error("USER_POOL_ID is missing for user detail lookup.");
    return { fullName: userID };
  }
  try {
    const command = new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userID
    });
    const response = await cognito.send(command);
    const emailAttr = response.UserAttributes?.find((attr) => attr.Name === "email")?.Value;
    const givenNameAttr = response.UserAttributes?.find((attr) => attr.Name === "given_name")?.Value;
    const familyNameAttr = response.UserAttributes?.find((attr) => attr.Name === "family_name")?.Value;
    return {
      email: emailAttr,
      fullName: `${givenNameAttr || ""} ${familyNameAttr || ""}`.trim() || userID
    };
  } catch (e) {
    console.error(`Error fetching Cognito user details for ${userID}:`, e);
    return { fullName: userID };
  }
}
async function sendNewFavorNotificationEmail(senderID, receiverID, messageContent, requestType, deadline) {
  if (!SES_SOURCE_EMAIL) {
    console.warn("SES_SOURCE_EMAIL not configured. Skipping email notification.");
    return;
  }
  const [sender, receiver] = await Promise.all([
    getUserDetails(senderID),
    getUserDetails(receiverID)
  ]);
  if (!receiver.email) {
    console.warn(`Receiver ${receiverID} has no email address. Skipping email.`);
    return;
  }
  const formattedDeadline = deadline ? new Date(deadline).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }) : "";
  const deadlineText = formattedDeadline ? `

**Deadline:** ${formattedDeadline}` : "";
  const emailHtmlBody = `
        <html>
            <body>
                <h1 style="color: #0070f3;">New ${requestType} Notification</h1>
                <p>Hello ${receiver.fullName},</p>
                <p>You have a new <strong>${requestType}</strong> from <strong>${sender.fullName}</strong> waiting for your attention in the app.</p>
                
                <div style="border: 1px solid #eaeaea; padding: 15px; margin: 20px 0; border-radius: 8px;">
                    <p style="font-weight: bold; margin-top: 0;">Initial Message:</p>
                    <blockquote style="border-left: 4px solid #0070f3; margin: 0; padding-left: 10px; font-style: italic; color: #555;">${messageContent}</blockquote>
                    
                    ${formattedDeadline ? `<p style="margin-top: 15px; font-weight: bold; color: #d97706;">Deadline: ${formattedDeadline}</p>` : ""}
                </div>
                
                <p>Please log in to the application to view and respond to this request.</p>
                <p>Thank you,<br>The System Team</p>
            </body>
        </html>
    `;
  const emailTextBody = `
        New ${requestType} Notification
        
        Hello ${receiver.fullName},
        
        You have a new ${requestType} from ${sender.fullName} waiting for your attention in the app.
        
        Initial Message: "${messageContent}"
        ${formattedDeadline ? `Deadline: ${formattedDeadline}` : ""}
        
        Please log in to the application to view and respond to this request.
    `;
  await ses.send(new SendEmailCommand({
    Destination: {
      ToAddresses: [receiver.email]
      // Cast to string as we check for null/undefined earlier
    },
    // V2 uses Content wrapper for Simple or Raw message format
    Content: {
      Simple: {
        Subject: {
          Data: `New ${requestType}: ${sender.fullName} Needs Your Attention`
        },
        Body: {
          Text: { Data: emailTextBody },
          Html: { Data: emailHtmlBody }
        }
      }
    },
    // V2 uses FromEmailAddress for the sender address
    FromEmailAddress: SES_SOURCE_EMAIL
  }));
  console.log(`SES Notification sent to ${receiver.email} for favor request from ${sender.fullName}.`);
}
async function fetchHistory(callerID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, limit = 100, lastTimestamp } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID for history fetch." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Favor request not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, callerID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    return;
  }
  const queryInput = {
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: "favorRequestID = :id",
    ExpressionAttributeValues: { ":id": favorRequestID },
    ScanIndexForward: true,
    // Chronological order (oldest first)
    Limit: limit
    // Optional: Use ExclusiveStartKey for pagination (not fully implemented here, just lastTimestamp as anchor)
  };
  const historyResult = await ddb.send(new QueryCommand(queryInput));
  await sendToClient(apiGwManagement, connectionId, {
    type: "favorHistory",
    favorRequestID,
    messages: historyResult.Items || []
    // nextToken: historyResult.LastEvaluatedKey // To implement robust pagination
  });
}
async function sendToClient(apiGwManagement, connectionId, data) {
  try {
    await apiGwManagement.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data)
    }));
  } catch (e) {
    if (e.statusCode === 410) {
      console.warn(`Found stale connection, deleting: ${connectionId}`);
    } else {
      console.error("Failed to send data to connection:", e);
    }
  }
}
async function sendToAll(apiGwManagement, userIDs, data, options) {
  const connectionPromises = userIDs.map((id) => getSenderInfoByUserID(id));
  const connections = await Promise.all(connectionPromises);
  const offlineRecipients = [];
  for (let i = 0; i < userIDs.length; i++) {
    const userID = userIDs[i];
    const conn = connections[i];
    if (conn) {
      await sendToClient(apiGwManagement, conn.connectionId, data);
    } else if (options.notifyOffline && userID !== options.senderID) {
      offlineRecipients.push(userID);
    }
  }
  if (offlineRecipients.length > 0 && options.notifyOffline) {
    const messageData = data.message;
    if (messageData) {
      await sendPushNotificationsToOfflineUsers(
        offlineRecipients,
        messageData,
        options.senderName
      );
    }
  }
}
async function sendPushNotificationsToOfflineUsers(offlineUserIds, messageData, senderName) {
  if (offlineUserIds.length === 0) {
    return;
  }
  const preview = messageData.content && messageData.content.length > 100 ? messageData.content.substring(0, 97) + "..." : messageData.content || "";
  if (PUSH_NOTIFICATIONS_ENABLED && SEND_PUSH_FUNCTION_ARN) {
    console.log(`[PushNotifications] Sending to ${offlineUserIds.length} offline users via Lambda`);
    try {
      const notificationPayload = {
        _internalCall: true,
        userIds: offlineUserIds,
        notification: {
          title: senderName ? `Message from ${senderName}` : "New Message",
          body: preview,
          type: "new_message",
          data: {
            conversationId: messageData.favorRequestID,
            senderID: messageData.senderID,
            action: "open_conversation",
            timestamp: Date.now()
          },
          threadId: `conversation-${messageData.favorRequestID}`
        }
      };
      const response = await lambdaClient.send(new InvokeCommand({
        FunctionName: SEND_PUSH_FUNCTION_ARN,
        Payload: JSON.stringify(notificationPayload),
        InvocationType: "Event"
        // Async invocation - don't wait for response
      }));
      console.log(`[PushNotifications] Lambda invoked, StatusCode: ${response.StatusCode}`);
    } catch (error) {
      console.error("[PushNotifications] Failed to invoke send-push Lambda:", error.message);
      await publishSnsNotification({ ...messageData, offlineRecipients: offlineUserIds });
    }
  } else {
    await publishSnsNotification({ ...messageData, offlineRecipients: offlineUserIds });
  }
}
async function publishSnsNotification(messageData) {
  if (!NOTIFICATIONS_TOPIC_ARN) {
    console.warn("SNS Topic ARN not configured. Skipping notification.");
    return;
  }
  const preview = messageData.content && messageData.content.length > 100 ? messageData.content.substring(0, 97) + "..." : messageData.content || "";
  await sns.send(new PublishCommand({
    TopicArn: NOTIFICATIONS_TOPIC_ARN,
    Message: JSON.stringify({
      // Structure payload for push notification consumption
      source: "favor_request",
      favorRequestID: messageData.favorRequestID,
      senderID: messageData.senderID,
      messagePreview: preview,
      // Pass group context if available
      teamID: messageData.teamID,
      offlineRecipients: messageData.offlineRecipients
      // List of users who should receive the notification
    })
  }));
}
async function sendTaskPushNotification(userIds, type, taskTitle, senderName, taskId, additionalData) {
  if (!PUSH_NOTIFICATIONS_ENABLED || userIds.length === 0) {
    return;
  }
  let title;
  let body;
  switch (type) {
    case "task_assigned":
      title = `New Task: ${taskTitle}`;
      body = `Assigned by ${senderName}`;
      break;
    case "task_forwarded":
      title = "Task Forwarded to You";
      body = `${senderName} forwarded: ${taskTitle}`;
      break;
    case "task_completed":
      title = "Task Completed";
      body = `${senderName} marked "${taskTitle}" as complete`;
      break;
    default:
      return;
  }
  try {
    const notificationPayload = {
      _internalCall: true,
      userIds,
      notification: {
        title,
        body,
        type,
        data: {
          taskId,
          action: "open_task",
          ...additionalData
        }
      }
    };
    await lambdaClient.send(new InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify(notificationPayload),
      InvocationType: "Event"
    }));
    console.log(`[PushNotifications] Task notification sent to ${userIds.length} users`);
  } catch (error) {
    console.error("[PushNotifications] Failed to send task notification:", error.message);
  }
}
async function sendMeetingPushNotification(userIds, type, meetingTitle, organizerName, meetingId, startTime) {
  if (!PUSH_NOTIFICATIONS_ENABLED || userIds.length === 0) {
    return;
  }
  let title;
  let body;
  const dateStr = startTime ? new Date(startTime).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }) : "";
  switch (type) {
    case "meeting_scheduled":
      title = `Meeting: ${meetingTitle}`;
      body = `${organizerName} scheduled for ${dateStr}`;
      break;
    case "meeting_updated":
      title = "Meeting Updated";
      body = `${meetingTitle} has been modified`;
      break;
    case "meeting_deleted":
      title = "Meeting Cancelled";
      body = `${meetingTitle} has been cancelled`;
      break;
    default:
      return;
  }
  try {
    const notificationPayload = {
      _internalCall: true,
      userIds,
      notification: {
        title,
        body,
        type: "meeting_scheduled",
        data: {
          meetingId,
          action: "open_meeting",
          startTime
        }
      }
    };
    await lambdaClient.send(new InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify(notificationPayload),
      InvocationType: "Event"
    }));
    console.log(`[PushNotifications] Meeting notification sent to ${userIds.length} users`);
  } catch (error) {
    console.error("[PushNotifications] Failed to send meeting notification:", error.message);
  }
}
async function getPresignedUrl(senderID, payload, connectionId, apiGwManagement) {
  if (!payload.fileName || !payload.fileType || !payload.favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing file details or favorRequestID" });
    return;
  }
  const fileKey = `favors/${payload.favorRequestID}/${senderID}-${v4_default()}-${payload.fileName}`;
  const command = new PutObjectCommand({
    Bucket: FILE_BUCKET_NAME,
    Key: fileKey,
    ContentType: payload.fileType
  });
  try {
    const url = await getSignedUrl(s3, command, { expiresIn: 900 });
    await sendToClient(apiGwManagement, connectionId, {
      type: "presignedUrl",
      favorRequestID: payload.favorRequestID,
      url,
      fileKey,
      fileType: payload.fileType
      // Include fileType in response
    });
  } catch (e) {
    console.error("Error generating signed URL:", e);
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Failed to generate file upload URL" });
  }
}
async function forwardTask(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, forwardTo, message, deadline, requireAcceptance = false, notifyOriginalAssignee = true } = payload;
  if (!favorRequestID || !forwardTo) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID or forwardTo." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  const forwardID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const forwardRecord = {
    forwardID,
    fromUserID: senderID,
    toUserID: forwardTo,
    forwardedAt: nowIso,
    message: message || "",
    deadline: deadline || favor.deadline,
    requireAcceptance,
    status: requireAcceptance ? "pending" : "accepted",
    ...requireAcceptance ? {} : { acceptedAt: nowIso }
  };
  const existingChain = favor.forwardingChain || [];
  const updatedChain = [...existingChain, forwardRecord];
  await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
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
  const notifyList = [forwardTo];
  if (notifyOriginalAssignee && favor.senderID !== senderID) {
    notifyList.push(favor.senderID);
  }
  notifyList.push(senderID);
  const notificationPayload = {
    type: "taskForwarded",
    favorRequestID,
    forwardRecord,
    forwardedBy: senderID
  };
  await sendToAll(apiGwManagement, notifyList, notificationPayload, { notifyOffline: true, senderID });
  const senderDetails = await getUserDetails(senderID);
  await sendTaskPushNotification(
    [forwardTo],
    // Only notify the person receiving the forwarded task
    "task_forwarded",
    favor.title || "Task",
    senderDetails.fullName,
    favorRequestID,
    { requiresAcceptance: requireAcceptance }
  );
  console.log(`Task ${favorRequestID} forwarded from ${senderID} to ${forwardTo}`);
}
async function respondToForward(senderID, payload, action, connectionId, apiGwManagement) {
  const { favorRequestID, forwardID, rejectionReason } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const forwardingChain = favor.forwardingChain || [];
  const forwardIndex = forwardID ? forwardingChain.findIndex((f) => f.forwardID === forwardID) : forwardingChain.findIndex((f) => f.toUserID === senderID && f.status === "pending");
  if (forwardIndex === -1) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "No pending forward found for you." });
    return;
  }
  const forwardRecord = forwardingChain[forwardIndex];
  if (forwardRecord.toUserID !== senderID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "This forward is not assigned to you." });
    return;
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
    Key: { favorRequestID },
    UpdateExpression: "SET forwardingChain = :chain, #s = :status, currentAssigneeID = :assignee, updatedAt = :ua" + (action === "reject" ? ", rejectionReason = :reason, rejectedAt = :rejAt" : ""),
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":chain": forwardingChain,
      ":status": newStatus,
      ":assignee": newAssignee,
      ":ua": nowIso,
      ...action === "reject" ? { ":reason": rejectionReason, ":rejAt": nowIso } : {}
    }
  }));
  const participants = await getAllParticipants(favor);
  const notificationPayload = {
    type: action === "accept" ? "taskForwardAccepted" : "taskForwardRejected",
    favorRequestID,
    forwardID: forwardRecord.forwardID,
    respondedBy: senderID,
    ...action === "reject" ? { rejectionReason } : {}
  };
  await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: true, senderID });
  console.log(`Task ${favorRequestID} forward ${action}ed by ${senderID}`);
}
async function markTaskCompleted(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, completionNotes } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: "SET #s = :status, completedAt = :completedAt, completionNotes = :notes, updatedAt = :ua, unreadCount = :zero",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":status": "completed",
      ":completedAt": nowIso,
      ":notes": completionNotes || "",
      ":ua": nowIso,
      ":zero": 0
    }
  }));
  const participants = await getAllParticipants(favor);
  const notificationPayload = {
    type: "taskCompleted",
    favorRequestID,
    completedBy: senderID,
    completedAt: nowIso,
    completionNotes
  };
  await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: true, senderID });
  console.log(`Task ${favorRequestID} marked as completed by ${senderID}`);
}
async function updateTaskDeadline(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, deadline, removeDeadline } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (removeDeadline) {
    await ddb.send(new UpdateCommand({
      TableName: FAVORS_TABLE,
      Key: { favorRequestID },
      UpdateExpression: "REMOVE deadline SET updatedAt = :ua",
      ExpressionAttributeValues: { ":ua": nowIso }
    }));
  } else {
    await ddb.send(new UpdateCommand({
      TableName: FAVORS_TABLE,
      Key: { favorRequestID },
      UpdateExpression: "SET deadline = :deadline, updatedAt = :ua",
      ExpressionAttributeValues: { ":deadline": deadline, ":ua": nowIso }
    }));
  }
  const participants = await getAllParticipants(favor);
  const notificationPayload = {
    type: "deadlineUpdated",
    favorRequestID,
    updatedBy: senderID,
    deadline: removeDeadline ? null : deadline,
    updatedAt: nowIso
  };
  await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: false });
  console.log(`Task ${favorRequestID} deadline updated by ${senderID}`);
}
async function getTaskDetails(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  const participants = await getAllParticipants(favor);
  await sendToClient(apiGwManagement, connectionId, {
    type: "taskDetails",
    favor,
    participants
  });
}
async function getForwardHistory(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  await sendToClient(apiGwManagement, connectionId, {
    type: "forwardHistory",
    favorRequestID,
    forwardingChain: favor.forwardingChain || [],
    senderID: favor.senderID,
    createdAt: favor.createdAt
  });
}
async function deleteConversation(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  if (!favorRequestID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  if (favor.senderID !== senderID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the creator can delete this task." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: "SET #s = :status, updatedAt = :ua",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":status": "deleted",
      // Soft delete
      ":ua": nowIso
    }
  }));
  const participants = await getAllParticipants(favor);
  const notificationPayload = {
    type: "conversationDeleted",
    favorRequestID,
    deletedBy: senderID
  };
  await sendToAll(apiGwManagement, participants, notificationPayload, { notifyOffline: false });
  console.log(`Task ${favorRequestID} deleted by ${senderID}`);
}
async function scheduleMeeting(senderID, payload, connectionId, apiGwManagement) {
  const { conversationID, title, description, startTime, endTime, location, meetingLink, participants } = payload;
  if (!conversationID || !description || !meetingLink) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing required meeting fields." });
    return;
  }
  if (!MEETINGS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID: conversationID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Conversation not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this conversation." });
    return;
  }
  const meetingID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const meetingParticipants = participants || await getAllParticipants(favor);
  const meeting = {
    meetingID,
    conversationID,
    title: title || description.substring(0, 50),
    description,
    startTime: startTime || nowIso,
    endTime,
    location,
    meetingLink,
    organizerID: senderID,
    participants: meetingParticipants,
    status: "scheduled",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await ddb.send(new PutCommand({
    TableName: MEETINGS_TABLE,
    Item: meeting
  }));
  const messageData = {
    favorRequestID: conversationID,
    senderID,
    content: `Meeting scheduled: ${description}`,
    timestamp: Date.now(),
    type: "text"
  };
  await _saveAndBroadcastMessage(messageData, apiGwManagement);
  const notificationPayload = {
    type: "meetingScheduled",
    meeting
  };
  await sendToAll(apiGwManagement, meetingParticipants, notificationPayload, { notifyOffline: true, senderID });
  const organizerDetails = await getUserDetails(senderID);
  const otherParticipants = meetingParticipants.filter((p) => p !== senderID);
  await sendMeetingPushNotification(
    otherParticipants,
    "meeting_scheduled",
    meeting.title || description.substring(0, 50),
    organizerDetails.fullName,
    meetingID,
    meeting.startTime
  );
  console.log(`Meeting ${meetingID} scheduled by ${senderID} for conversation ${conversationID}`);
}
async function getMeetings(senderID, payload, connectionId, apiGwManagement) {
  const { conversationID, status, limit = 50 } = payload;
  if (!MEETINGS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  let meetings = [];
  if (conversationID) {
    const result = await ddb.send(new QueryCommand({
      TableName: MEETINGS_TABLE,
      IndexName: "ConversationIndex",
      KeyConditionExpression: "conversationID = :cid",
      ExpressionAttributeValues: { ":cid": conversationID },
      ScanIndexForward: false,
      Limit: limit
    }));
    meetings = result.Items || [];
  } else {
    const result = await ddb.send(new QueryCommand({
      TableName: MEETINGS_TABLE,
      IndexName: "OrganizerIndex",
      KeyConditionExpression: "organizerID = :oid",
      ExpressionAttributeValues: { ":oid": senderID },
      ScanIndexForward: false,
      Limit: limit
    }));
    meetings = result.Items || [];
  }
  if (status) {
    meetings = meetings.filter((m) => m.status === status);
  }
  await sendToClient(apiGwManagement, connectionId, {
    type: "meetingsList",
    meetings,
    conversationID
  });
}
async function updateMeeting(senderID, payload, connectionId, apiGwManagement) {
  const { meetingID, title, description, startTime, endTime, location, meetingLink, participants, status } = payload;
  if (!meetingID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing meetingID." });
    return;
  }
  if (!MEETINGS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  const meetingResult = await ddb.send(new GetCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  const meeting = meetingResult.Item;
  if (!meeting) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Meeting not found." });
    return;
  }
  if (meeting.organizerID !== senderID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the organizer can update this meeting." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const updateExpressions = ["updatedAt = :ua"];
  const expressionValues = { ":ua": nowIso };
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
    updateExpressions.push("location = :loc");
    expressionValues[":loc"] = location;
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
  }
  await ddb.send(new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID },
    UpdateExpression: "SET " + updateExpressions.join(", "),
    ExpressionAttributeNames: status !== void 0 ? { "#s": "status" } : void 0,
    ExpressionAttributeValues: expressionValues
  }));
  const notificationPayload = {
    type: "meetingUpdated",
    meetingID,
    updatedBy: senderID,
    changes: { title, description, startTime, endTime, location, meetingLink, participants, status }
  };
  await sendToAll(apiGwManagement, meeting.participants, notificationPayload, { notifyOffline: true, senderID });
  console.log(`Meeting ${meetingID} updated by ${senderID}`);
}
async function deleteMeeting(senderID, payload, connectionId, apiGwManagement) {
  const { meetingID, notifyParticipants = true } = payload;
  if (!meetingID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Missing meetingID." });
    return;
  }
  if (!MEETINGS_TABLE) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  const meetingResult = await ddb.send(new GetCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  const meeting = meetingResult.Item;
  if (!meeting) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Meeting not found." });
    return;
  }
  if (meeting.organizerID !== senderID) {
    await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the organizer can delete this meeting." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: MEETINGS_TABLE,
    Key: { meetingID },
    UpdateExpression: "SET #s = :status, updatedAt = :ua",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":status": "cancelled", ":ua": nowIso }
  }));
  if (notifyParticipants) {
    const notificationPayload = {
      type: "meetingDeleted",
      meetingID,
      deletedBy: senderID
    };
    await sendToAll(apiGwManagement, meeting.participants, notificationPayload, { notifyOffline: true, senderID });
  }
  console.log(`Meeting ${meetingID} cancelled by ${senderID}`);
}
export {
  handler
};

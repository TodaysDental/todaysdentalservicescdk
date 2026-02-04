var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/uuid/dist/esm-node/rng.js
import crypto from "crypto";
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}
var rnds8Pool, poolPtr;
var init_rng = __esm({
  "node_modules/uuid/dist/esm-node/rng.js"() {
    rnds8Pool = new Uint8Array(256);
    poolPtr = rnds8Pool.length;
  }
});

// node_modules/uuid/dist/esm-node/stringify.js
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}
var byteToHex;
var init_stringify = __esm({
  "node_modules/uuid/dist/esm-node/stringify.js"() {
    byteToHex = [];
    for (let i = 0; i < 256; ++i) {
      byteToHex.push((i + 256).toString(16).slice(1));
    }
  }
});

// node_modules/uuid/dist/esm-node/native.js
import crypto2 from "crypto";
var native_default;
var init_native = __esm({
  "node_modules/uuid/dist/esm-node/native.js"() {
    native_default = {
      randomUUID: crypto2.randomUUID
    };
  }
});

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
var v4_default;
var init_v4 = __esm({
  "node_modules/uuid/dist/esm-node/v4.js"() {
    init_native();
    init_rng();
    init_stringify();
    v4_default = v4;
  }
});

// node_modules/uuid/dist/esm-node/index.js
var init_esm_node = __esm({
  "node_modules/uuid/dist/esm-node/index.js"() {
    init_v4();
  }
});

// src/services/comm/chime-meeting-manager.ts
var chime_meeting_manager_exports = {};
__export(chime_meeting_manager_exports, {
  createAttendee: () => createAttendee,
  createMeeting: () => createMeeting,
  createMeetingWithAttendee: () => createMeetingWithAttendee,
  endMeeting: () => endMeeting,
  joinMeeting: () => joinMeeting,
  listAttendees: () => listAttendees
});
import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
  ListAttendeesCommand
} from "@aws-sdk/client-chime-sdk-meetings";
function makeExternalUserId(userID) {
  const safe = (userID || "user").toString().trim().replace(/[^a-zA-Z0-9+\-_.@]/g, "_");
  const suffix = v4_default().replace(/-/g, "").slice(0, 8);
  const maxBaseLen = 64 - (1 + suffix.length);
  const base = (safe.length >= 2 ? safe : "user").slice(0, Math.max(2, maxBaseLen));
  return `${base}-${suffix}`.slice(0, 64);
}
async function createMeeting(callID, callType) {
  const externalMeetingId = `call-${callID}`;
  try {
    const response = await chimeClient.send(new CreateMeetingCommand({
      ClientRequestToken: v4_default(),
      ExternalMeetingId: externalMeetingId,
      MediaRegion: CHIME_MEDIA_REGION,
      MeetingFeatures: {
        Audio: { EchoReduction: "AVAILABLE" },
        Video: callType === "video" ? { MaxResolution: "HD" } : void 0
      }
    }));
    if (!response.Meeting?.MeetingId || !response.Meeting?.MediaPlacement || !response.Meeting?.MediaRegion) {
      throw new Error("Failed to create meeting - no meeting data returned");
    }
    return response.Meeting;
  } catch (error) {
    console.error("[ChimeMeetingManager] Error creating meeting:", error);
    throw error;
  }
}
async function createAttendee(meetingId, userID, userName) {
  try {
    const response = await chimeClient.send(new CreateAttendeeCommand({
      MeetingId: meetingId,
      // Use a safe, <=64-char external user id (email can be too long)
      ExternalUserId: makeExternalUserId(userID),
      Capabilities: {
        Audio: "SendReceive",
        Video: "SendReceive",
        Content: "SendReceive"
      }
    }));
    if (!response.Attendee?.AttendeeId || !response.Attendee?.ExternalUserId || !response.Attendee?.JoinToken) {
      throw new Error("Failed to create attendee - no attendee data returned");
    }
    return response.Attendee;
  } catch (error) {
    console.error("[ChimeMeetingManager] Error creating attendee:", error);
    throw error;
  }
}
async function createMeetingWithAttendee(callID, callType, callerID, callerName) {
  console.log(`[ChimeMeetingManager] Creating meeting for call ${callID}`);
  const meeting = await createMeeting(callID, callType);
  const attendee = await createAttendee(meeting.MeetingId, callerID, callerName);
  console.log(`[ChimeMeetingManager] Meeting created: ${meeting.MeetingId}, Attendee: ${attendee.AttendeeId}`);
  return { meeting, attendee };
}
async function joinMeeting(meetingId, userID, userName) {
  console.log(`[ChimeMeetingManager] User ${userID} joining meeting ${meetingId}`);
  const meetingResponse = await chimeClient.send(new GetMeetingCommand({
    MeetingId: meetingId
  }));
  if (!meetingResponse.Meeting?.MeetingId || !meetingResponse.Meeting?.MediaPlacement || !meetingResponse.Meeting?.MediaRegion) {
    throw new Error("Meeting not found");
  }
  const attendee = await createAttendee(meetingId, userID, userName);
  return {
    meeting: meetingResponse.Meeting,
    attendee
  };
}
async function endMeeting(meetingId) {
  console.log(`[ChimeMeetingManager] Ending meeting ${meetingId}`);
  try {
    await chimeClient.send(new DeleteMeetingCommand({
      MeetingId: meetingId
    }));
    console.log(`[ChimeMeetingManager] Meeting ${meetingId} ended successfully`);
  } catch (error) {
    if (error.name === "NotFoundException") {
      console.log(`[ChimeMeetingManager] Meeting ${meetingId} already ended`);
    } else {
      console.error("[ChimeMeetingManager] Error ending meeting:", error);
      throw error;
    }
  }
}
async function listAttendees(meetingId) {
  try {
    const response = await chimeClient.send(new ListAttendeesCommand({
      MeetingId: meetingId
    }));
    return (response.Attendees || []).map((attendee) => ({
      AttendeeId: attendee.AttendeeId,
      ExternalUserId: attendee.ExternalUserId,
      JoinToken: ""
      // Not returned in list
    }));
  } catch (error) {
    console.error("[ChimeMeetingManager] Error listing attendees:", error);
    throw error;
  }
}
var CHIME_MEDIA_REGION, chimeClient;
var init_chime_meeting_manager = __esm({
  "src/services/comm/chime-meeting-manager.ts"() {
    "use strict";
    init_esm_node();
    CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || process.env.CHIME_REGION || process.env.AWS_REGION || "us-east-1";
    chimeClient = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
  }
});

// src/services/comm/push-notifications.ts
var push_notifications_exports = {};
__export(push_notifications_exports, {
  isPushNotificationsEnabled: () => isPushNotificationsEnabled,
  sendIncomingCallNotification: () => sendIncomingCallNotification,
  sendMentionNotification: () => sendMentionNotification,
  sendMissedCallNotification: () => sendMissedCallNotification,
  sendNewMessageNotification: () => sendNewMessageNotification,
  sendNotificationToClinic: () => sendNotificationToClinic,
  sendNotificationToUsers: () => sendNotificationToUsers,
  sendNotificationWithDetails: () => sendNotificationWithDetails
});
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return lambdaClient;
}
function isPushNotificationsEnabled() {
  return PUSH_NOTIFICATIONS_ENABLED;
}
async function invokeSendPushLambda(payload, options = {}) {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    console.log("[CommPush] Push notifications not configured, skipping");
    return { success: false, error: "Push notifications not configured" };
  }
  const { sync = false, skipPreferenceCheck = false } = options;
  try {
    const invocationType = sync ? "RequestResponse" : "Event";
    const response = await getLambdaClient().send(new InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify({
        _internalCall: true,
        skipPreferenceCheck,
        ...payload
      }),
      InvocationType: invocationType
    }));
    if (!sync) {
      const success = response.StatusCode === 202 || response.StatusCode === 200;
      if (!success) {
        console.error(`[CommPush] Async Lambda invocation failed, StatusCode: ${response.StatusCode}`);
      } else {
        console.log(`[CommPush] Async Lambda invoked successfully, StatusCode: ${response.StatusCode}`);
      }
      return { success };
    }
    if (response.Payload) {
      const payloadStr = new TextDecoder().decode(response.Payload);
      const result = JSON.parse(payloadStr);
      if (response.FunctionError) {
        console.error("[CommPush] Lambda function error:", result);
        return {
          success: false,
          error: result.errorMessage || "Lambda function error"
        };
      }
      if (result.statusCode && result.body) {
        const body = JSON.parse(result.body);
        return {
          success: result.statusCode === 200,
          sent: body.sent,
          failed: body.failed,
          error: body.error
        };
      }
      return { success: true, ...result };
    }
    return { success: true };
  } catch (error) {
    console.error("[CommPush] Failed to invoke send-push Lambda:", error.message);
    return { success: false, error: error.message };
  }
}
async function invokeSendPushLambdaWithRetry(payload, options = {}) {
  const { maxRetries = 2, ...invokeOptions } = options;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await invokeSendPushLambda(payload, invokeOptions);
    if (result.success) {
      return result;
    }
    lastError = result.error;
    if (result.error?.includes("not configured") || result.error?.includes("Invalid") || result.error?.includes("Unauthorized")) {
      break;
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100));
      console.log(`[CommPush] Retrying push notification (attempt ${attempt + 2})`);
    }
  }
  return { success: false, error: lastError || "Max retries exceeded" };
}
async function sendIncomingCallNotification(ddb4, recipientUserID, callPayload) {
  const callTypeEmoji = callPayload.callType === "video" ? "\u{1F4F9}" : "\u{1F4DE}";
  const idempotencyKey = `call:${callPayload.callID}:${callPayload.callerID}`;
  const result = await invokeSendPushLambdaWithRetry({
    userId: recipientUserID,
    notification: {
      title: `${callTypeEmoji} Incoming ${callPayload.callType} call`,
      body: `${callPayload.callerName} is calling you`,
      type: "incoming_call",
      sound: "ringtone.mp3",
      idempotencyKey,
      data: {
        type: "incoming_call",
        callID: callPayload.callID,
        callerID: callPayload.callerID,
        callerName: callPayload.callerName,
        callType: callPayload.callType,
        favorRequestID: callPayload.favorRequestID,
        meetingId: callPayload.meetingId || ""
      }
    }
  }, {
    sync: true,
    // Synchronous for critical notifications
    skipPreferenceCheck: true,
    // Always deliver incoming calls
    maxRetries: 2
  });
  if (!result.success) {
    console.error(`[CommPush] Failed to send incoming call notification: ${result.error}`);
  }
  return result.success;
}
async function sendMissedCallNotification(ddb4, recipientUserID, callerName, callType) {
  const callTypeEmoji = callType === "video" ? "\u{1F4F9}" : "\u{1F4DE}";
  const result = await invokeSendPushLambda({
    userId: recipientUserID,
    notification: {
      title: `${callTypeEmoji} Missed ${callType} call`,
      body: `You missed a call from ${callerName}`,
      type: "missed_call",
      data: {
        type: "missed_call",
        callerName,
        callType
      }
    }
  });
  return result.success;
}
async function sendNewMessageNotification(ddb4, recipientUserID, senderName, messagePreview, favorRequestID, conversationTitle) {
  const result = await invokeSendPushLambda({
    userId: recipientUserID,
    notification: {
      title: conversationTitle || senderName,
      body: conversationTitle ? `${senderName}: ${messagePreview}` : messagePreview,
      type: "new_message",
      data: {
        type: "new_message",
        favorRequestID,
        senderName
      }
    }
  });
  return result.success;
}
async function sendMentionNotification(ddb4, recipientUserID, mentionedBy, messagePreview, favorRequestID) {
  const result = await invokeSendPushLambda({
    userId: recipientUserID,
    notification: {
      title: `@${mentionedBy} mentioned you`,
      body: messagePreview,
      type: "mention",
      data: {
        type: "mention",
        favorRequestID,
        mentionedBy
      }
    }
  });
  return result.success;
}
async function sendNotificationToUsers(ddb4, userIds, notification) {
  if (userIds.length === 0) {
    console.log("[CommPush] No users to notify");
    return true;
  }
  const result = await invokeSendPushLambda({
    userIds,
    notification
  });
  return result.success;
}
async function sendNotificationToClinic(ddb4, clinicId, notification) {
  const result = await invokeSendPushLambda({
    clinicId,
    notification
  });
  return result.success;
}
async function sendNotificationWithDetails(target, notification, options = {}) {
  return invokeSendPushLambda({
    ...target,
    notification
  }, { ...options, sync: true });
}
var SEND_PUSH_FUNCTION_ARN, DEVICE_TOKENS_TABLE, PUSH_NOTIFICATIONS_ENABLED, lambdaClient;
var init_push_notifications = __esm({
  "src/services/comm/push-notifications.ts"() {
    "use strict";
    SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || "";
    DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || "";
    PUSH_NOTIFICATIONS_ENABLED = !!(SEND_PUSH_FUNCTION_ARN && DEVICE_TOKENS_TABLE);
    lambdaClient = null;
  }
});

// src/services/comm/ws-default.ts
init_esm_node();
import { DynamoDBClient as DynamoDBClient3 } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient as DynamoDBDocumentClient3, GetCommand as GetCommand3, PutCommand as PutCommand3, UpdateCommand as UpdateCommand3, QueryCommand as QueryCommand3, ScanCommand as ScanCommand3 } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient as ApiGatewayManagementApiClient3, PostToConnectionCommand as PostToConnectionCommand3 } from "@aws-sdk/client-apigatewaymanagementapi";
import { S3Client as S3Client2, PutObjectCommand as PutObjectCommand2, GetObjectCommand as GetObjectCommand2 } from "@aws-sdk/client-s3";
import { getSignedUrl as getSignedUrl2 } from "@aws-sdk/s3-request-presigner";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { LambdaClient as LambdaClient2, InvokeCommand as InvokeCommand2 } from "@aws-sdk/client-lambda";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

// src/services/comm/messaging-features-handlers.ts
init_esm_node();
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
var REGION = process.env.AWS_REGION || "us-east-1";
var MESSAGES_TABLE = process.env.MESSAGES_TABLE || "";
var FAVORS_TABLE = process.env.FAVORS_TABLE || "";
var CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "";
var REACTIONS_TABLE = process.env.REACTIONS_TABLE || `${MESSAGES_TABLE}-reactions`;
var PINS_TABLE = process.env.PINS_TABLE || `${FAVORS_TABLE}-pins`;
var BOOKMARKS_TABLE = process.env.BOOKMARKS_TABLE || "comm-bookmarks";
var PRESENCE_TABLE = process.env.PRESENCE_TABLE || `${CONNECTIONS_TABLE}-presence`;
var CHANNELS_TABLE = process.env.CHANNELS_TABLE || "comm-channels";
var SCHEDULED_MESSAGES_TABLE = process.env.SCHEDULED_MESSAGES_TABLE || "comm-scheduled-messages";
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
async function sendToClient(apiGwManagement, connectionId, payload) {
  try {
    await apiGwManagement.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload))
    }));
  } catch (error) {
    if (error.statusCode === 410) {
      console.log(`Stale connection detected: ${connectionId}`);
    } else {
      console.error(`Failed to send to ${connectionId}:`, error);
    }
  }
}
async function getConnectionIdForUser(userID) {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: "UserIDIndex",
      KeyConditionExpression: "userID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      Limit: 1
    }));
    return result.Items?.[0]?.connectionId;
  } catch {
    return null;
  }
}
async function broadcastToConversation(apiGwManagement, favorRequestID, payload, excludeUserID) {
  const favorResult = await ddb.send(new GetCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor)
    return;
  const participants = [];
  if (favor.senderID)
    participants.push(favor.senderID);
  if (favor.receiverID)
    participants.push(favor.receiverID);
  if (favor.teamID && favor.members) {
    participants.push(...favor.members);
  }
  const uniqueParticipants = [...new Set(participants)].filter((p) => p !== excludeUserID);
  for (const userID of uniqueParticipants) {
    const connectionId = await getConnectionIdForUser(userID);
    if (connectionId) {
      await sendToClient(apiGwManagement, connectionId, payload);
    }
  }
}
async function handleAddReaction(senderID, payload, connectionId, apiGwManagement) {
  const { messageID, favorRequestID, emoji, emojiCode } = payload;
  if (!messageID || !favorRequestID || !emoji || !emojiCode) {
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Missing required fields for reaction"
    });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const reactionKey = `${messageID}#${emojiCode}`;
  try {
    const updateResult = await ddb.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { favorRequestID, timestamp: parseInt(messageID.split("-")[0]) || Date.now() },
      UpdateExpression: `
        SET reactions = if_not_exists(reactions, :emptyList)
      `,
      ExpressionAttributeValues: {
        ":emptyList": []
      },
      ReturnValues: "ALL_NEW"
    }));
    const message = updateResult.Attributes;
    let reactions = message.reactions || [];
    const existingIndex = reactions.findIndex((r) => r.emojiCode === emojiCode);
    if (existingIndex >= 0) {
      if (!reactions[existingIndex].userIDs.includes(senderID)) {
        reactions[existingIndex].userIDs.push(senderID);
        reactions[existingIndex].count++;
      }
    } else {
      reactions.push({
        emoji,
        emojiCode,
        userIDs: [senderID],
        count: 1,
        createdAt: nowIso
      });
    }
    await ddb.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { favorRequestID, timestamp: message.timestamp },
      UpdateExpression: "SET reactions = :reactions",
      ExpressionAttributeValues: {
        ":reactions": reactions
      }
    }));
    await broadcastToConversation(apiGwManagement, favorRequestID, {
      type: "reactionAdded",
      messageID,
      favorRequestID,
      reaction: reactions[existingIndex >= 0 ? existingIndex : reactions.length - 1],
      addedBy: senderID
    });
  } catch (error) {
    console.error("Error adding reaction:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to add reaction"
    });
  }
}
async function handleRemoveReaction(senderID, payload, connectionId, apiGwManagement) {
  const { messageID, favorRequestID, emojiCode } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      ExpressionAttributeValues: { ":frid": favorRequestID }
    }));
    const message = queryResult.Items?.find((m) => m.messageID === messageID);
    if (!message) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Message not found" });
      return;
    }
    let reactions = message.reactions || [];
    const reactionIndex = reactions.findIndex((r) => r.emojiCode === emojiCode);
    if (reactionIndex >= 0) {
      reactions[reactionIndex].userIDs = reactions[reactionIndex].userIDs.filter((id) => id !== senderID);
      reactions[reactionIndex].count--;
      if (reactions[reactionIndex].count <= 0) {
        reactions = reactions.filter((_, i) => i !== reactionIndex);
      }
      await ddb.send(new UpdateCommand({
        TableName: MESSAGES_TABLE,
        Key: { favorRequestID, timestamp: message.timestamp },
        UpdateExpression: "SET reactions = :reactions",
        ExpressionAttributeValues: {
          ":reactions": reactions
        }
      }));
      await broadcastToConversation(apiGwManagement, favorRequestID, {
        type: "reactionRemoved",
        messageID,
        favorRequestID,
        emojiCode,
        removedBy: senderID
      });
    }
  } catch (error) {
    console.error("Error removing reaction:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to remove reaction"
    });
  }
}
async function handleReplyToThread(senderID, payload, connectionId, apiGwManagement) {
  const { parentMessageID, favorRequestID, content, mentions } = payload;
  if (!parentMessageID || !favorRequestID || !content) {
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Missing required fields for thread reply"
    });
    return;
  }
  const messageID = v4_default();
  const timestamp = Date.now();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const threadReply = {
      messageID,
      favorRequestID,
      senderID,
      content,
      timestamp,
      type: "text",
      parentMessageID,
      mentions
    };
    await ddb.send(new PutCommand({
      TableName: MESSAGES_TABLE,
      Item: threadReply
    }));
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      ExpressionAttributeValues: { ":frid": favorRequestID }
    }));
    const parentMessage = queryResult.Items?.find((m) => m.messageID === parentMessageID);
    if (parentMessage) {
      const existingParticipants = parentMessage.threadParticipants || [];
      const newParticipants = existingParticipants.includes(senderID) ? existingParticipants : [...existingParticipants, senderID];
      await ddb.send(new UpdateCommand({
        TableName: MESSAGES_TABLE,
        Key: { favorRequestID, timestamp: parentMessage.timestamp },
        UpdateExpression: "SET threadReplyCount = if_not_exists(threadReplyCount, :zero) + :one, threadParticipants = :participants, lastThreadReplyAt = :lastReply",
        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          ":participants": newParticipants,
          ":lastReply": timestamp
        }
      }));
    }
    await broadcastToConversation(apiGwManagement, favorRequestID, {
      type: "threadReply",
      parentMessageID,
      favorRequestID,
      message: threadReply,
      threadInfo: {
        parentMessageID,
        replyCount: (parentMessage?.threadReplyCount || 0) + 1,
        participantIDs: parentMessage?.threadParticipants || [senderID],
        lastReplyAt: nowIso
      }
    });
  } catch (error) {
    console.error("Error replying to thread:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to reply to thread"
    });
  }
}
async function handleGetThreadReplies(senderID, payload, connectionId, apiGwManagement) {
  const { parentMessageID, favorRequestID, limit = 50, before } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      FilterExpression: "parentMessageID = :pmid",
      ExpressionAttributeValues: {
        ":frid": favorRequestID,
        ":pmid": parentMessageID
      },
      ScanIndexForward: false,
      // Most recent first
      Limit: limit
    }));
    const replies = queryResult.Items || [];
    await sendToClient(apiGwManagement, connectionId, {
      type: "threadRepliesList",
      parentMessageID,
      favorRequestID,
      replies: replies.reverse(),
      // Oldest first for display
      hasMore: !!queryResult.LastEvaluatedKey
    });
  } catch (error) {
    console.error("Error getting thread replies:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to get thread replies"
    });
  }
}
async function handleEditMessage(senderID, payload, connectionId, apiGwManagement) {
  const { messageID, favorRequestID, newContent } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      ExpressionAttributeValues: { ":frid": favorRequestID }
    }));
    const message = queryResult.Items?.find((m) => m.messageID === messageID);
    if (!message) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Message not found" });
      return;
    }
    if (message.senderID !== senderID) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Not authorized to edit this message" });
      return;
    }
    const editedAt = Date.now();
    await ddb.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { favorRequestID, timestamp: message.timestamp },
      UpdateExpression: "SET content = :content, isEdited = :isEdited, editedAt = :editedAt",
      ExpressionAttributeValues: {
        ":content": newContent,
        ":isEdited": true,
        ":editedAt": editedAt
      }
    }));
    await broadcastToConversation(apiGwManagement, favorRequestID, {
      type: "messageEdited",
      messageID,
      favorRequestID,
      newContent,
      editedAt: new Date(editedAt).toISOString(),
      editedBy: senderID
    });
  } catch (error) {
    console.error("Error editing message:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to edit message"
    });
  }
}
async function handleDeleteMessage(senderID, payload, connectionId, apiGwManagement) {
  const { messageID, favorRequestID } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      ExpressionAttributeValues: { ":frid": favorRequestID }
    }));
    const message = queryResult.Items?.find((m) => m.messageID === messageID);
    if (!message) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Message not found" });
      return;
    }
    if (message.senderID !== senderID) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Not authorized to delete this message" });
      return;
    }
    const deletedAt = Date.now();
    await ddb.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { favorRequestID, timestamp: message.timestamp },
      UpdateExpression: "SET isDeleted = :isDeleted, deletedAt = :deletedAt, content = :deletedContent",
      ExpressionAttributeValues: {
        ":isDeleted": true,
        ":deletedAt": deletedAt,
        ":deletedContent": "[Message deleted]"
      }
    }));
    await broadcastToConversation(apiGwManagement, favorRequestID, {
      type: "messageDeleted",
      messageID,
      favorRequestID,
      deletedAt: new Date(deletedAt).toISOString(),
      deletedBy: senderID
    });
  } catch (error) {
    console.error("Error deleting message:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to delete message"
    });
  }
}
async function handleTypingStart(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  const connResult = await ddb.send(new GetCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId }
  }));
  const userName = connResult.Item?.userName || "Someone";
  await broadcastToConversation(apiGwManagement, favorRequestID, {
    type: "typingStart",
    favorRequestID,
    userID: senderID,
    userName
  }, senderID);
}
async function handleTypingStop(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  await broadcastToConversation(apiGwManagement, favorRequestID, {
    type: "typingStop",
    favorRequestID,
    userID: senderID
  }, senderID);
}
async function handleSetPresence(senderID, payload, connectionId, apiGwManagement) {
  const { status, customStatus } = payload;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb.send(new UpdateCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId },
    UpdateExpression: "SET presenceStatus = :status, lastSeen = :lastSeen, customStatus = :customStatus",
    ExpressionAttributeValues: {
      ":status": status,
      ":lastSeen": nowIso,
      ":customStatus": customStatus || null
    }
  }));
  console.log(`User ${senderID} set presence to ${status}`);
}
async function handleGetPresence(senderID, payload, connectionId, apiGwManagement) {
  const { userIDs } = payload;
  const presences = [];
  for (const userID of userIDs.slice(0, 50)) {
    const connId = await getConnectionIdForUser(userID);
    if (connId) {
      const result = await ddb.send(new GetCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId: connId }
      }));
      if (result.Item) {
        presences.push({
          userID,
          status: result.Item.presenceStatus || "online",
          lastSeen: result.Item.lastSeen || result.Item.connectedAt || (/* @__PURE__ */ new Date()).toISOString(),
          customStatus: result.Item.customStatus
        });
      }
    } else {
      presences.push({
        userID,
        status: "offline",
        lastSeen: ""
      });
    }
  }
  await sendToClient(apiGwManagement, connectionId, {
    type: "presenceList",
    presences
  });
}
async function handlePinMessage(senderID, payload, connectionId, apiGwManagement) {
  const { messageID, favorRequestID } = payload;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const pinID = v4_default();
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      ExpressionAttributeValues: { ":frid": favorRequestID }
    }));
    const message = queryResult.Items?.find((m) => m.messageID === messageID);
    if (!message) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Message not found" });
      return;
    }
    await ddb.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { favorRequestID, timestamp: message.timestamp },
      UpdateExpression: "SET isPinned = :isPinned, pinnedAt = :pinnedAt, pinnedBy = :pinnedBy",
      ExpressionAttributeValues: {
        ":isPinned": true,
        ":pinnedAt": Date.now(),
        ":pinnedBy": senderID
      }
    }));
    const pinnedMessage = {
      pinID,
      messageID,
      favorRequestID,
      pinnedBy: senderID,
      pinnedAt: nowIso,
      messagePreview: message.content.slice(0, 100),
      senderID: message.senderID
    };
    await broadcastToConversation(apiGwManagement, favorRequestID, {
      type: "messagePinned",
      pinnedMessage
    });
  } catch (error) {
    console.error("Error pinning message:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to pin message"
    });
  }
}
async function handleUnpinMessage(senderID, payload, connectionId, apiGwManagement) {
  const { messageID, favorRequestID } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      ExpressionAttributeValues: { ":frid": favorRequestID }
    }));
    const message = queryResult.Items?.find((m) => m.messageID === messageID);
    if (!message) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Message not found" });
      return;
    }
    await ddb.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { favorRequestID, timestamp: message.timestamp },
      UpdateExpression: "SET isPinned = :isPinned, pinnedAt = :pinnedAt, pinnedBy = :pinnedBy",
      ExpressionAttributeValues: {
        ":isPinned": false,
        ":pinnedAt": null,
        ":pinnedBy": null
      }
    }));
    await broadcastToConversation(apiGwManagement, favorRequestID, {
      type: "messageUnpinned",
      messageID,
      favorRequestID,
      unpinnedBy: senderID
    });
  } catch (error) {
    console.error("Error unpinning message:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to unpin message"
    });
  }
}
async function handleGetPinnedMessages(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: "favorRequestID = :frid",
      FilterExpression: "isPinned = :isPinned",
      ExpressionAttributeValues: {
        ":frid": favorRequestID,
        ":isPinned": true
      }
    }));
    const pinnedMessages = (queryResult.Items || []).map((m) => ({
      pinID: `${m.messageID}-pin`,
      messageID: m.messageID,
      pinnedBy: m.pinnedBy,
      pinnedAt: new Date(m.pinnedAt).toISOString(),
      messagePreview: m.content.slice(0, 100),
      senderID: m.senderID
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "pinnedMessagesList",
      favorRequestID,
      pinnedMessages
    });
  } catch (error) {
    console.error("Error getting pinned messages:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to get pinned messages"
    });
  }
}
async function handleAddBookmark(senderID, payload, connectionId, apiGwManagement) {
  const { type, referenceID, favorRequestID, note, title } = payload;
  const bookmarkID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const bookmark = {
    bookmarkID,
    userID: senderID,
    type,
    referenceID,
    favorRequestID,
    title: title || referenceID,
    note,
    createdAt: nowIso
  };
  try {
    await ddb.send(new PutCommand({
      TableName: BOOKMARKS_TABLE,
      Item: bookmark
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "bookmarkAdded",
      bookmark
    });
  } catch (error) {
    console.error("Error adding bookmark:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to add bookmark"
    });
  }
}
async function handleRemoveBookmark(senderID, payload, connectionId, apiGwManagement) {
  const { bookmarkID } = payload;
  try {
    await ddb.send(new DeleteCommand({
      TableName: BOOKMARKS_TABLE,
      Key: { bookmarkID },
      ConditionExpression: "userID = :userID",
      ExpressionAttributeValues: {
        ":userID": senderID
      }
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "bookmarkRemoved",
      bookmarkID
    });
  } catch (error) {
    console.error("Error removing bookmark:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to remove bookmark"
    });
  }
}
async function handleGetBookmarks(senderID, payload, connectionId, apiGwManagement) {
  const { type, limit = 50 } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: BOOKMARKS_TABLE,
      IndexName: "UserIDIndex",
      KeyConditionExpression: "userID = :userID",
      FilterExpression: type ? "#type = :type" : void 0,
      ExpressionAttributeNames: type ? { "#type": "type" } : void 0,
      ExpressionAttributeValues: {
        ":userID": senderID,
        ...type && { ":type": type }
      },
      Limit: limit,
      ScanIndexForward: false
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "bookmarksList",
      bookmarks: queryResult.Items || [],
      total: queryResult.Count || 0
    });
  } catch (error) {
    console.error("Error getting bookmarks:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to get bookmarks"
    });
  }
}
async function handleSearch(senderID, payload, connectionId, apiGwManagement) {
  const { query, types = ["message"], from, in: inConversation, dateFrom, dateTo, limit = 50 } = payload;
  const startTime = Date.now();
  try {
    const results = [];
    if (types.includes("message")) {
      const favorsResult = await ddb.send(new QueryCommand({
        TableName: FAVORS_TABLE,
        IndexName: "UserIDIndex",
        KeyConditionExpression: "userID = :userID",
        ExpressionAttributeValues: { ":userID": senderID },
        Limit: 20
      }));
      for (const favor of favorsResult.Items || []) {
        if (inConversation && favor.favorRequestID !== inConversation)
          continue;
        const messagesResult = await ddb.send(new QueryCommand({
          TableName: MESSAGES_TABLE,
          KeyConditionExpression: "favorRequestID = :frid",
          FilterExpression: "contains(content, :query)",
          ExpressionAttributeValues: {
            ":frid": favor.favorRequestID,
            ":query": query
          },
          Limit: 10
        }));
        for (const msg of messagesResult.Items || []) {
          if (from && msg.senderID !== from)
            continue;
          results.push({
            type: "message",
            id: msg.messageID || `${msg.favorRequestID}-${msg.timestamp}`,
            title: msg.content.slice(0, 50),
            preview: msg.content,
            favorRequestID: msg.favorRequestID,
            senderName: msg.senderID,
            timestamp: new Date(msg.timestamp).toISOString(),
            highlights: [`<mark>${query}</mark>`]
          });
        }
      }
    }
    const took = Date.now() - startTime;
    await sendToClient(apiGwManagement, connectionId, {
      type: "searchResults",
      results: results.slice(0, limit),
      total: results.length,
      hasMore: results.length > limit,
      query,
      took
    });
  } catch (error) {
    console.error("Error searching:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Search failed"
    });
  }
}
async function handleScheduleMessage(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, content, scheduledFor, type = "text", fileKey } = payload;
  const scheduledMessageID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const scheduledMessage = {
    scheduledMessageID,
    favorRequestID,
    senderID,
    content,
    scheduledFor,
    type,
    fileKey,
    status: "scheduled",
    createdAt: nowIso
  };
  try {
    await ddb.send(new PutCommand({
      TableName: SCHEDULED_MESSAGES_TABLE,
      Item: scheduledMessage
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "scheduledMessageCreated",
      scheduledMessage
    });
  } catch (error) {
    console.error("Error scheduling message:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to schedule message"
    });
  }
}
async function handleCancelScheduledMessage(senderID, payload, connectionId, apiGwManagement) {
  const { scheduledMessageID } = payload;
  try {
    await ddb.send(new UpdateCommand({
      TableName: SCHEDULED_MESSAGES_TABLE,
      Key: { scheduledMessageID },
      UpdateExpression: "SET #status = :status",
      ConditionExpression: "senderID = :senderID AND #status = :scheduled",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "cancelled",
        ":senderID": senderID,
        ":scheduled": "scheduled"
      }
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "scheduledMessageCancelled",
      scheduledMessageID
    });
  } catch (error) {
    console.error("Error cancelling scheduled message:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to cancel scheduled message"
    });
  }
}
async function handleGetScheduledMessages(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: SCHEDULED_MESSAGES_TABLE,
      IndexName: "SenderIDIndex",
      KeyConditionExpression: "senderID = :senderID",
      FilterExpression: favorRequestID ? "#status = :scheduled AND favorRequestID = :frid" : "#status = :scheduled",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":senderID": senderID,
        ":scheduled": "scheduled",
        ...favorRequestID && { ":frid": favorRequestID }
      }
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "scheduledMessagesList",
      scheduledMessages: queryResult.Items || []
    });
  } catch (error) {
    console.error("Error getting scheduled messages:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to get scheduled messages"
    });
  }
}
async function handleCreateChannel(senderID, payload, connectionId, apiGwManagement) {
  const { name, description, type = "public", members = [] } = payload;
  const channelID = v4_default();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const allMembers = [.../* @__PURE__ */ new Set([senderID, ...members])];
  const channel = {
    channelID,
    name,
    description,
    type,
    createdBy: senderID,
    createdAt: nowIso,
    updatedAt: nowIso,
    memberCount: allMembers.length,
    members: allMembers,
    isArchived: false
  };
  try {
    await ddb.send(new PutCommand({
      TableName: CHANNELS_TABLE,
      Item: channel
    }));
    for (const memberID of allMembers) {
      const connId = await getConnectionIdForUser(memberID);
      if (connId) {
        await sendToClient(apiGwManagement, connId, {
          type: "channelCreated",
          channel: {
            ...channel,
            isMember: true
          }
        });
      }
    }
  } catch (error) {
    console.error("Error creating channel:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to create channel"
    });
  }
}
async function handleJoinChannel(senderID, payload, connectionId, apiGwManagement) {
  const { channelID } = payload;
  try {
    const result = await ddb.send(new GetCommand({
      TableName: CHANNELS_TABLE,
      Key: { channelID }
    }));
    const channel = result.Item;
    if (!channel) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Channel not found" });
      return;
    }
    if (channel.type === "private") {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Cannot join private channel without invitation" });
      return;
    }
    if (channel.members.includes(senderID)) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Already a member" });
      return;
    }
    const newMembers = [...channel.members, senderID];
    await ddb.send(new UpdateCommand({
      TableName: CHANNELS_TABLE,
      Key: { channelID },
      UpdateExpression: "SET members = :members, memberCount = :count, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":members": newMembers,
        ":count": newMembers.length,
        ":updatedAt": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "channelJoined",
      channelID
    });
  } catch (error) {
    console.error("Error joining channel:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to join channel"
    });
  }
}
async function handleLeaveChannel(senderID, payload, connectionId, apiGwManagement) {
  const { channelID } = payload;
  try {
    const result = await ddb.send(new GetCommand({
      TableName: CHANNELS_TABLE,
      Key: { channelID }
    }));
    const channel = result.Item;
    if (!channel) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Channel not found" });
      return;
    }
    if (channel.createdBy === senderID) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Channel creator cannot leave. Archive the channel instead." });
      return;
    }
    const newMembers = channel.members.filter((m) => m !== senderID);
    await ddb.send(new UpdateCommand({
      TableName: CHANNELS_TABLE,
      Key: { channelID },
      UpdateExpression: "SET members = :members, memberCount = :count, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":members": newMembers,
        ":count": newMembers.length,
        ":updatedAt": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    await sendToClient(apiGwManagement, connectionId, {
      type: "channelLeft",
      channelID
    });
  } catch (error) {
    console.error("Error leaving channel:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to leave channel"
    });
  }
}
async function handleListChannels(senderID, payload, connectionId, apiGwManagement) {
  const { type, includeArchived = false } = payload;
  try {
    const { ScanCommand: DDBScanCommand } = await import("@aws-sdk/lib-dynamodb");
    const result = await ddb.send(new DDBScanCommand({
      TableName: CHANNELS_TABLE,
      FilterExpression: includeArchived ? void 0 : "isArchived = :notArchived",
      ExpressionAttributeValues: includeArchived ? void 0 : {
        ":notArchived": false
      }
    }));
    let channels = result.Items || [];
    if (type) {
      channels = channels.filter((c) => c.type === type);
    }
    channels = channels.filter(
      (c) => c.type === "public" || c.members.includes(senderID)
    );
    await sendToClient(apiGwManagement, connectionId, {
      type: "channelsList",
      channels: channels.map((c) => ({
        channelID: c.channelID,
        name: c.name,
        description: c.description,
        type: c.type,
        memberCount: c.memberCount,
        isMember: c.members.includes(senderID)
      })),
      total: channels.length
    });
  } catch (error) {
    console.error("Error listing channels:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to list channels"
    });
  }
}
async function handleArchiveChannel(senderID, payload, connectionId, apiGwManagement) {
  const { channelID } = payload;
  try {
    const result = await ddb.send(new GetCommand({
      TableName: CHANNELS_TABLE,
      Key: { channelID }
    }));
    const channel = result.Item;
    if (!channel) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Channel not found" });
      return;
    }
    if (channel.createdBy !== senderID) {
      await sendToClient(apiGwManagement, connectionId, { type: "error", message: "Only the channel creator can archive it" });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    await ddb.send(new UpdateCommand({
      TableName: CHANNELS_TABLE,
      Key: { channelID },
      UpdateExpression: "SET isArchived = :isArchived, archivedAt = :archivedAt, archivedBy = :archivedBy",
      ExpressionAttributeValues: {
        ":isArchived": true,
        ":archivedAt": nowIso,
        ":archivedBy": senderID
      }
    }));
    for (const memberID of channel.members) {
      const connId = await getConnectionIdForUser(memberID);
      if (connId) {
        await sendToClient(apiGwManagement, connId, {
          type: "channelArchived",
          channelID,
          archivedBy: senderID
        });
      }
    }
  } catch (error) {
    console.error("Error archiving channel:", error);
    await sendToClient(apiGwManagement, connectionId, {
      type: "error",
      message: "Failed to archive channel"
    });
  }
}

// src/services/comm/enhanced-messaging-handlers.ts
init_esm_node();
import { DynamoDBClient as DynamoDBClient2 } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient as DynamoDBDocumentClient2, GetCommand as GetCommand2, PutCommand as PutCommand2, UpdateCommand as UpdateCommand2, QueryCommand as QueryCommand2 } from "@aws-sdk/lib-dynamodb";
import { PostToConnectionCommand as PostToConnectionCommand2 } from "@aws-sdk/client-apigatewaymanagementapi";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
var REGION2 = process.env.AWS_REGION || "us-east-1";
var MESSAGES_TABLE2 = process.env.MESSAGES_TABLE || "";
var FAVORS_TABLE2 = process.env.FAVORS_TABLE || "";
var CONNECTIONS_TABLE2 = process.env.CONNECTIONS_TABLE || "";
var FILE_BUCKET_NAME = process.env.FILE_BUCKET_NAME || "";
var CONVERSATION_SETTINGS_TABLE = process.env.CONVERSATION_SETTINGS_TABLE || "";
var CALLS_TABLE = process.env.CALLS_TABLE || "";
var GIPHY_API_KEY = process.env.GIPHY_API_KEY || "";
var ddb2 = DynamoDBDocumentClient2.from(new DynamoDBClient2({ region: REGION2 }));
var s3 = new S3Client({ region: REGION2 });
async function sendToClient2(apiGwManagement, connectionId, payload) {
  try {
    await apiGwManagement.send(new PostToConnectionCommand2({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload))
    }));
  } catch (e) {
    if (e.statusCode === 410) {
      console.log(`Stale connection: ${connectionId}`);
    } else {
      console.error(`Error sending to ${connectionId}:`, e);
    }
  }
}
async function getConnectionIdForUser2(userID) {
  try {
    const result = await ddb2.send(new QueryCommand2({
      TableName: CONNECTIONS_TABLE2,
      // Must match CommStack `ConnectionsTableV4` GSI name
      IndexName: "UserIDIndex",
      KeyConditionExpression: "userID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      Limit: 1
    }));
    return result.Items?.[0]?.connectionId || null;
  } catch (e) {
    console.error("Error getting connection for user:", e);
    return null;
  }
}
async function broadcastToConversation2(apiGwManagement, favorRequestID, payload, excludeUserID) {
  const favorResult = await ddb2.send(new GetCommand2({
    TableName: FAVORS_TABLE2,
    Key: { favorRequestID }
  }));
  if (!favorResult.Item)
    return;
  const participants = [];
  if (favorResult.Item.senderID)
    participants.push(favorResult.Item.senderID);
  if (favorResult.Item.receiverID)
    participants.push(favorResult.Item.receiverID);
  if (favorResult.Item.teamID) {
  }
  for (const userID of participants) {
    if (userID === excludeUserID)
      continue;
    const connectionId = await getConnectionIdForUser2(userID);
    if (connectionId) {
      await sendToClient2(apiGwManagement, connectionId, payload);
    }
  }
}
async function handleMarkDelivered(senderID, payload, connectionId, apiGwManagement) {
  const { messageIDs, favorRequestID } = payload;
  if (!messageIDs || messageIDs.length === 0) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing messageIDs" });
    return;
  }
  const now = Date.now();
  for (const messageID of messageIDs) {
    try {
      await ddb2.send(new UpdateCommand2({
        TableName: MESSAGES_TABLE2,
        Key: { favorRequestID, timestamp: parseInt(messageID.split("-")[1]) || now },
        UpdateExpression: "SET deliveryStatus = :status, deliveredAt = :at",
        ExpressionAttributeValues: {
          ":status": "delivered",
          ":at": now
        }
      }));
    } catch (e) {
      console.error(`Error marking message ${messageID} as delivered:`, e);
    }
  }
  await broadcastToConversation2(apiGwManagement, favorRequestID, {
    type: "deliveryStatusUpdate",
    favorRequestID,
    messageIDs,
    status: "delivered",
    deliveredAt: now
  }, senderID);
}
async function handleMarkMessagesRead(senderID, payload, connectionId, apiGwManagement) {
  const { messageIDs, favorRequestID } = payload;
  if (!messageIDs || messageIDs.length === 0) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing messageIDs" });
    return;
  }
  const now = Date.now();
  const readReceipt = { userID: senderID, readAt: now };
  for (const messageID of messageIDs) {
    try {
      await ddb2.send(new UpdateCommand2({
        TableName: MESSAGES_TABLE2,
        Key: { favorRequestID, messageID },
        UpdateExpression: "SET deliveryStatus = :status, readBy = list_append(if_not_exists(readBy, :empty), :receipt)",
        ExpressionAttributeValues: {
          ":status": "read",
          ":receipt": [readReceipt],
          ":empty": []
        }
      }));
    } catch (e) {
      console.error(`Error marking message ${messageID} as read:`, e);
    }
  }
  await broadcastToConversation2(apiGwManagement, favorRequestID, {
    type: "deliveryStatusUpdate",
    favorRequestID,
    messageIDs,
    status: "read",
    readBy: [readReceipt],
    updatedAt: now
  }, senderID);
}
async function handleGetVoiceUploadUrl(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, duration, mimeType } = payload;
  if (!favorRequestID || !duration || !mimeType) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing required fields" });
    return;
  }
  const extensions = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/mpeg": "mp3"
  };
  const ext = extensions[mimeType] || "webm";
  const voiceKey = `voice/${favorRequestID}/${v4_default()}.${ext}`;
  try {
    const command = new PutObjectCommand({
      Bucket: FILE_BUCKET_NAME,
      Key: voiceKey,
      ContentType: mimeType
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    await sendToClient2(apiGwManagement, connectionId, {
      type: "voiceMessageUploadUrl",
      uploadUrl,
      voiceKey,
      favorRequestID
    });
  } catch (e) {
    console.error("Error generating voice upload URL:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to generate upload URL" });
  }
}
async function handleSendVoiceMessage(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, voiceKey, duration, waveformData } = payload;
  if (!favorRequestID || !voiceKey) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing required fields" });
    return;
  }
  const messageID = `msg-${Date.now()}-${v4_default().substring(0, 8)}`;
  const timestamp = Date.now();
  let playbackUrl = "";
  try {
    const getCommand = new GetObjectCommand({
      Bucket: FILE_BUCKET_NAME,
      Key: voiceKey
    });
    playbackUrl = await getSignedUrl(s3, getCommand, { expiresIn: 604800 });
  } catch (e) {
    console.warn("Could not generate playback URL:", e);
  }
  const voiceDetails = {
    duration,
    waveformData,
    playbackUrl
    // Add playback URL for immediate playback
  };
  const message = {
    messageID,
    favorRequestID,
    senderID,
    content: `\u{1F3A4} Voice message (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")})`,
    timestamp,
    type: "voice",
    voiceKey,
    voiceDetails,
    deliveryStatus: "sent"
  };
  try {
    await ddb2.send(new PutCommand2({
      TableName: MESSAGES_TABLE2,
      Item: message
    }));
    await ddb2.send(new UpdateCommand2({
      TableName: FAVORS_TABLE2,
      Key: { favorRequestID },
      UpdateExpression: "SET updatedAt = :now, lastMessagePreview = :preview",
      ExpressionAttributeValues: {
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":preview": "\u{1F3A4} Voice message"
      }
    }));
    await broadcastToConversation2(apiGwManagement, favorRequestID, {
      type: "newMessage",
      message
    });
  } catch (e) {
    console.error("Error sending voice message:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to send voice message" });
  }
}
async function handleUpdateConversationSettings(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, settings } = payload;
  if (!favorRequestID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID" });
    return;
  }
  const settingsKey = `${favorRequestID}#${senderID}`;
  try {
    const updateParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    Object.entries(settings).forEach(([key, value], index) => {
      if (key !== "favorRequestID" && key !== "userID") {
        updateParts.push(`#k${index} = :v${index}`);
        expressionAttributeNames[`#k${index}`] = key;
        expressionAttributeValues[`:v${index}`] = value;
      }
    });
    if (updateParts.length === 0) {
      await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "No settings to update" });
      return;
    }
    await ddb2.send(new UpdateCommand2({
      TableName: CONVERSATION_SETTINGS_TABLE || FAVORS_TABLE2,
      Key: { settingsKey },
      UpdateExpression: `SET ${updateParts.join(", ")}, updatedAt = :now`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ":now": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    await sendToClient2(apiGwManagement, connectionId, {
      type: "conversationSettingsUpdate",
      favorRequestID,
      settings: { ...settings, userID: senderID }
    });
  } catch (e) {
    console.error("Error updating conversation settings:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to update settings" });
  }
}
async function handleMuteConversation(senderID, payload, connectionId, apiGwManagement) {
  await handleUpdateConversationSettings(senderID, {
    favorRequestID: payload.favorRequestID,
    settings: {
      muted: true,
      muteUntil: payload.muteUntil
    }
  }, connectionId, apiGwManagement);
}
async function handleUnmuteConversation(senderID, payload, connectionId, apiGwManagement) {
  await handleUpdateConversationSettings(senderID, {
    favorRequestID: payload.favorRequestID,
    settings: {
      muted: false,
      muteUntil: void 0
    }
  }, connectionId, apiGwManagement);
}
async function handleArchiveConversation(senderID, payload, connectionId, apiGwManagement) {
  await handleUpdateConversationSettings(senderID, {
    favorRequestID: payload.favorRequestID,
    settings: { archived: true }
  }, connectionId, apiGwManagement);
}
async function handlePinConversation(senderID, payload, connectionId, apiGwManagement) {
  await handleUpdateConversationSettings(senderID, {
    favorRequestID: payload.favorRequestID,
    settings: { pinned: true }
  }, connectionId, apiGwManagement);
}
async function handleGetConversationAnalytics(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  if (!favorRequestID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID" });
    return;
  }
  try {
    const messagesResult = await ddb2.send(new QueryCommand2({
      TableName: MESSAGES_TABLE2,
      KeyConditionExpression: "favorRequestID = :frid",
      ExpressionAttributeValues: { ":frid": favorRequestID }
    }));
    const messages = messagesResult.Items || [];
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1e3;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1e3;
    const contributorCounts = {};
    const hourCounts = {};
    const typeCounts = { text: 0, file: 0, voice: 0, system: 0 };
    let reactionCount = 0;
    const emojiCounts = {};
    let messagesLast24h = 0;
    let messagesLast7d = 0;
    let totalResponseTime = 0;
    let responseCount = 0;
    let lastTimestamp = 0;
    let lastSenderID = "";
    for (const msg of messages) {
      contributorCounts[msg.senderID] = (contributorCounts[msg.senderID] || 0) + 1;
      const hour = new Date(msg.timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      const msgType = msg.type || "text";
      if (msgType in typeCounts) {
        typeCounts[msgType]++;
      }
      if (msg.reactions) {
        for (const reaction of msg.reactions) {
          reactionCount += reaction.count || 1;
          emojiCounts[reaction.emoji] = (emojiCounts[reaction.emoji] || 0) + (reaction.count || 1);
        }
      }
      if (msg.timestamp > oneDayAgo)
        messagesLast24h++;
      if (msg.timestamp > sevenDaysAgo)
        messagesLast7d++;
      if (lastTimestamp > 0 && msg.senderID !== lastSenderID) {
        totalResponseTime += msg.timestamp - lastTimestamp;
        responseCount++;
      }
      lastTimestamp = msg.timestamp;
      lastSenderID = msg.senderID;
    }
    const topContributors = Object.entries(contributorCounts).map(([userID, count]) => ({
      userID,
      messageCount: count,
      percentageOfTotal: Math.round(count / messages.length * 100),
      lastActiveAt: (/* @__PURE__ */ new Date()).toISOString()
      // Would need to track this properly
    })).sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
    const peakActivityHours = Object.entries(hourCounts).map(([hour, count]) => ({ hour: parseInt(hour), count })).sort((a, b) => b.count - a.count);
    const topEmojis = Object.entries(emojiCounts).map(([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count).slice(0, 5);
    const analytics = {
      favorRequestID,
      totalMessages: messages.length,
      activeParticipants: Object.keys(contributorCounts).length,
      averageResponseTimeMs: responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0,
      messagesLast24h,
      messagesLast7d,
      peakActivityHours,
      topContributors,
      messageTypeBreakdown: typeCounts,
      reactionStats: {
        totalReactions: reactionCount,
        topEmojis
      },
      responseHealthScore: calculateHealthScore(messages.length, responseCount, messagesLast7d)
    };
    await sendToClient2(apiGwManagement, connectionId, {
      type: "conversationAnalytics",
      analytics
    });
  } catch (e) {
    console.error("Error getting conversation analytics:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to get analytics" });
  }
}
function calculateHealthScore(totalMessages, responseCount, recentMessages) {
  let score = 50;
  if (recentMessages > 100)
    score += 25;
  else if (recentMessages > 50)
    score += 20;
  else if (recentMessages > 20)
    score += 15;
  else if (recentMessages > 5)
    score += 10;
  else if (recentMessages > 0)
    score += 5;
  const responseRate = totalMessages > 0 ? responseCount / totalMessages : 0;
  score += Math.min(25, Math.round(responseRate * 50));
  return Math.min(100, score);
}
async function handleSearchGifs(senderID, payload, connectionId, apiGwManagement) {
  const { query, limit = 25, offset = 0 } = payload;
  if (!query) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing search query" });
    return;
  }
  try {
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&rating=g`
    );
    if (!response.ok) {
      throw new Error("GIPHY API error");
    }
    const data = await response.json();
    const gifs = data.data.map((gif) => ({
      id: gif.id,
      title: gif.title,
      url: gif.images.original.url,
      previewUrl: gif.images.fixed_width_small.url,
      width: parseInt(gif.images.original.width),
      height: parseInt(gif.images.original.height),
      source: "giphy"
    }));
    await sendToClient2(apiGwManagement, connectionId, {
      type: "gifSearchResults",
      gifs,
      query,
      hasMore: data.pagination.total_count > offset + limit,
      offset
    });
  } catch (e) {
    console.error("Error searching GIFs:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to search GIFs" });
  }
}
async function handleGetTrendingGifs(senderID, payload, connectionId, apiGwManagement) {
  const { limit = 25 } = payload;
  try {
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&rating=g`
    );
    if (!response.ok) {
      throw new Error("GIPHY API error");
    }
    const data = await response.json();
    const gifs = data.data.map((gif) => ({
      id: gif.id,
      title: gif.title,
      url: gif.images.original.url,
      previewUrl: gif.images.fixed_width_small.url,
      width: parseInt(gif.images.original.width),
      height: parseInt(gif.images.original.height),
      source: "giphy"
    }));
    await sendToClient2(apiGwManagement, connectionId, {
      type: "gifSearchResults",
      gifs,
      query: "trending",
      hasMore: false,
      offset: 0
    });
  } catch (e) {
    console.error("Error getting trending GIFs:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to get trending GIFs" });
  }
}
async function handleSendGif(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, gif } = payload;
  if (!favorRequestID || !gif) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing required fields" });
    return;
  }
  const messageID = `msg-${Date.now()}-${v4_default().substring(0, 8)}`;
  const timestamp = Date.now();
  const message = {
    messageID,
    favorRequestID,
    senderID,
    content: gif.title || "GIF",
    timestamp,
    type: "gif",
    gifDetails: gif,
    deliveryStatus: "sent"
  };
  try {
    await ddb2.send(new PutCommand2({
      TableName: MESSAGES_TABLE2,
      Item: message
    }));
    await ddb2.send(new UpdateCommand2({
      TableName: FAVORS_TABLE2,
      Key: { favorRequestID },
      UpdateExpression: "SET updatedAt = :now, lastMessagePreview = :preview",
      ExpressionAttributeValues: {
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":preview": "GIF"
      }
    }));
    await broadcastToConversation2(apiGwManagement, favorRequestID, {
      type: "newMessage",
      message
    });
  } catch (e) {
    console.error("Error sending GIF:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to send GIF" });
  }
}
var DEFAULT_STICKER_PACKS = [
  {
    packID: "default-emoji",
    name: "Classic Emoji",
    description: "Essential emoji reactions",
    thumbnailUrl: "https://cdn.todaysdentalinsights.com/stickers/packs/emoji-thumb.png",
    stickerCount: 48,
    category: "emoji",
    isDefault: true,
    createdAt: "2025-01-01T00:00:00Z"
  },
  {
    packID: "default-reactions",
    name: "Quick Reactions",
    description: "Express yourself with animated reactions",
    thumbnailUrl: "https://cdn.todaysdentalinsights.com/stickers/packs/reactions-thumb.png",
    stickerCount: 24,
    category: "reactions",
    isDefault: true,
    createdAt: "2025-01-01T00:00:00Z"
  },
  {
    packID: "dental-cats",
    name: "Dental Kitties",
    description: "Cute dental-themed cats",
    thumbnailUrl: "https://cdn.todaysdentalinsights.com/stickers/packs/dental-cats-thumb.png",
    stickerCount: 16,
    category: "animals",
    isDefault: true,
    createdAt: "2025-06-01T00:00:00Z"
  }
];
var DEFAULT_STICKERS = {
  "default-emoji": [
    { stickerID: "emoji-thumbsup", packID: "default-emoji", url: "https://cdn.todaysdentalinsights.com/stickers/emoji/thumbsup.png", altText: "Thumbs Up", keywords: ["thumbs", "up", "approve", "good"], width: 128, height: 128 },
    { stickerID: "emoji-heart", packID: "default-emoji", url: "https://cdn.todaysdentalinsights.com/stickers/emoji/heart.png", altText: "Heart", keywords: ["heart", "love", "like"], width: 128, height: 128 },
    { stickerID: "emoji-laugh", packID: "default-emoji", url: "https://cdn.todaysdentalinsights.com/stickers/emoji/laugh.png", altText: "Laughing", keywords: ["laugh", "funny", "lol"], width: 128, height: 128 },
    { stickerID: "emoji-fire", packID: "default-emoji", url: "https://cdn.todaysdentalinsights.com/stickers/emoji/fire.png", altText: "Fire", keywords: ["fire", "hot", "lit"], width: 128, height: 128 },
    { stickerID: "emoji-clap", packID: "default-emoji", url: "https://cdn.todaysdentalinsights.com/stickers/emoji/clap.png", altText: "Clapping", keywords: ["clap", "applause", "bravo"], width: 128, height: 128 },
    { stickerID: "emoji-party", packID: "default-emoji", url: "https://cdn.todaysdentalinsights.com/stickers/emoji/party.png", altText: "Party", keywords: ["party", "celebrate", "confetti"], width: 128, height: 128 }
  ],
  "default-reactions": [
    { stickerID: "react-wow", packID: "default-reactions", url: "https://cdn.todaysdentalinsights.com/stickers/reactions/wow.gif", altText: "Wow", keywords: ["wow", "amazing", "surprised"], width: 200, height: 200 },
    { stickerID: "react-love", packID: "default-reactions", url: "https://cdn.todaysdentalinsights.com/stickers/reactions/love.gif", altText: "Love It", keywords: ["love", "heart", "adore"], width: 200, height: 200 },
    { stickerID: "react-haha", packID: "default-reactions", url: "https://cdn.todaysdentalinsights.com/stickers/reactions/haha.gif", altText: "Haha", keywords: ["haha", "laugh", "funny"], width: 200, height: 200 },
    { stickerID: "react-sad", packID: "default-reactions", url: "https://cdn.todaysdentalinsights.com/stickers/reactions/sad.gif", altText: "Sad", keywords: ["sad", "cry", "unhappy"], width: 200, height: 200 }
  ],
  "dental-cats": [
    { stickerID: "dcat-brush", packID: "dental-cats", url: "https://cdn.todaysdentalinsights.com/stickers/dental-cats/brushing.png", altText: "Cat Brushing Teeth", keywords: ["cat", "brush", "teeth", "hygiene"], width: 256, height: 256 },
    { stickerID: "dcat-smile", packID: "dental-cats", url: "https://cdn.todaysdentalinsights.com/stickers/dental-cats/smile.png", altText: "Cat Smiling", keywords: ["cat", "smile", "happy", "teeth"], width: 256, height: 256 },
    { stickerID: "dcat-floss", packID: "dental-cats", url: "https://cdn.todaysdentalinsights.com/stickers/dental-cats/floss.png", altText: "Cat Flossing", keywords: ["cat", "floss", "dental"], width: 256, height: 256 },
    { stickerID: "dcat-dentist", packID: "dental-cats", url: "https://cdn.todaysdentalinsights.com/stickers/dental-cats/dentist.png", altText: "Cat Dentist", keywords: ["cat", "dentist", "doctor"], width: 256, height: 256 }
  ]
};
async function handleGetStickerPacks(senderID, payload, connectionId, apiGwManagement) {
  try {
    await sendToClient2(apiGwManagement, connectionId, {
      type: "stickerPacksList",
      packs: DEFAULT_STICKER_PACKS
    });
  } catch (e) {
    console.error("Error getting sticker packs:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to get sticker packs" });
  }
}
async function handleGetStickers(senderID, payload, connectionId, apiGwManagement) {
  const { packID } = payload;
  if (!packID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing packID" });
    return;
  }
  try {
    const stickers = DEFAULT_STICKERS[packID] || [];
    await sendToClient2(apiGwManagement, connectionId, {
      type: "stickersList",
      packID,
      stickers
    });
  } catch (e) {
    console.error("Error getting stickers:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to get stickers" });
  }
}
async function handleSendSticker(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, sticker } = payload;
  if (!favorRequestID || !sticker) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing required fields" });
    return;
  }
  const messageID = `msg-${Date.now()}-${v4_default().substring(0, 8)}`;
  const timestamp = Date.now();
  const message = {
    messageID,
    favorRequestID,
    senderID,
    content: sticker.altText,
    timestamp,
    type: "sticker",
    sticker,
    deliveryStatus: "sent"
  };
  try {
    await ddb2.send(new PutCommand2({
      TableName: MESSAGES_TABLE2,
      Item: message
    }));
    await ddb2.send(new UpdateCommand2({
      TableName: FAVORS_TABLE2,
      Key: { favorRequestID },
      UpdateExpression: "SET updatedAt = :now, lastMessagePreview = :preview",
      ExpressionAttributeValues: {
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":preview": `Sticker: ${sticker.altText}`
      }
    }));
    await broadcastToConversation2(apiGwManagement, favorRequestID, {
      type: "newMessage",
      message
    });
  } catch (e) {
    console.error("Error sending sticker:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to send sticker" });
  }
}
async function handleInitiateCall(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, callType, participantIDs } = payload;
  if (!favorRequestID || !callType || !participantIDs?.length) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing required fields" });
    return;
  }
  if (!CALLS_TABLE) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Server error: Calls table not configured." });
    return;
  }
  const callID = v4_default();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let callerName = "Unknown";
  try {
    const connectionResult = await ddb2.send(new GetCommand2({
      TableName: CONNECTIONS_TABLE2,
      Key: { connectionId }
    }));
    callerName = connectionResult.Item?.userName || connectionResult.Item?.userID || "Unknown";
  } catch (e) {
    console.error("Error getting caller name:", e);
  }
  try {
    const { createMeetingWithAttendee: createMeetingWithAttendee2 } = await Promise.resolve().then(() => (init_chime_meeting_manager(), chime_meeting_manager_exports));
    const meetingJoinInfo = await createMeetingWithAttendee2(callID, callType, senderID, callerName);
    console.log(`[Call] Created Chime meeting: ${meetingJoinInfo.meeting.MeetingId}`);
    const uniqueParticipantIDs = Array.from(
      new Set([senderID, ...participantIDs || []].filter(Boolean))
    );
    const call = {
      callID,
      favorRequestID,
      callerID: senderID,
      callerName,
      callType,
      participantIDs: uniqueParticipantIDs,
      status: "ringing",
      startedAt: now,
      meetingId: meetingJoinInfo.meeting.MeetingId
    };
    await ddb2.send(new PutCommand2({
      TableName: CALLS_TABLE,
      Item: {
        ...call,
        // Auto-expire call records (24h). Keeps table small while allowing short-term history/debugging.
        ttl: Math.floor(Date.now() / 1e3) + 24 * 60 * 60
      }
    }));
    for (const participantID of participantIDs) {
      if (participantID === senderID)
        continue;
      const participantConnectionId = await getConnectionIdForUser2(participantID);
      if (participantConnectionId) {
        await sendToClient2(apiGwManagement, participantConnectionId, {
          type: "incomingCall",
          call,
          meetingId: meetingJoinInfo.meeting.MeetingId
        });
      }
      try {
        const { sendIncomingCallNotification: sendIncomingCallNotification2 } = await Promise.resolve().then(() => (init_push_notifications(), push_notifications_exports));
        await sendIncomingCallNotification2(ddb2, participantID, {
          callID,
          callerID: senderID,
          callerName,
          callType,
          favorRequestID,
          meetingId: meetingJoinInfo.meeting.MeetingId
        });
      } catch (pushError) {
        console.warn(`[Call] Failed to send push notification to ${participantID}:`, pushError);
      }
    }
    await sendToClient2(apiGwManagement, connectionId, {
      type: "callInitiated",
      call
    });
    await sendToClient2(apiGwManagement, connectionId, {
      type: "callJoinInfo",
      callID,
      meetingId: meetingJoinInfo.meeting.MeetingId,
      meetingToken: meetingJoinInfo.attendee.JoinToken,
      attendeeId: meetingJoinInfo.attendee.AttendeeId,
      externalMeetingId: meetingJoinInfo.meeting.ExternalMeetingId,
      meeting: meetingJoinInfo.meeting,
      attendee: meetingJoinInfo.attendee
    });
  } catch (e) {
    console.error("Error initiating call:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to initiate call" });
  }
}
async function handleJoinCall(senderID, payload, connectionId, apiGwManagement) {
  const { callID } = payload;
  if (!callID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing callID" });
    return;
  }
  if (!CALLS_TABLE) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Server error: Calls table not configured." });
    return;
  }
  try {
    let call;
    const callResult = await ddb2.send(new GetCommand2({
      TableName: CALLS_TABLE,
      Key: { callID }
    }));
    call = callResult.Item;
    if (!call) {
      await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Call not found" });
      return;
    }
    if (call.status === "ringing") {
      if (CALLS_TABLE) {
        await ddb2.send(new UpdateCommand2({
          TableName: CALLS_TABLE,
          Key: { callID },
          UpdateExpression: "SET #status = :status",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": "connected" }
        }));
      }
      for (const participantID of call.participantIDs) {
        const pConnectionId = await getConnectionIdForUser2(participantID);
        if (pConnectionId) {
          await sendToClient2(apiGwManagement, pConnectionId, {
            type: "callStatusUpdate",
            callID,
            status: "connected",
            updatedBy: senderID
          });
        }
      }
    }
    let meetingJoinInfo = null;
    if (call.meetingId) {
      try {
        const { joinMeeting: joinMeeting2 } = await Promise.resolve().then(() => (init_chime_meeting_manager(), chime_meeting_manager_exports));
        const result = await joinMeeting2(call.meetingId, senderID);
        meetingJoinInfo = result;
        console.log(`[Call] User ${senderID} joined Chime meeting: ${meetingJoinInfo.meeting.MeetingId}`);
      } catch (chimeError) {
        console.error("[Call] Failed to join Chime meeting:", chimeError);
      }
    }
    await sendToClient2(apiGwManagement, connectionId, {
      type: "callJoinInfo",
      callID,
      meetingId: meetingJoinInfo?.meeting?.MeetingId || call.meetingId || callID,
      meetingToken: meetingJoinInfo?.attendee?.JoinToken || "",
      attendeeId: meetingJoinInfo?.attendee?.AttendeeId || senderID,
      externalMeetingId: meetingJoinInfo?.meeting?.ExternalMeetingId,
      meeting: meetingJoinInfo?.meeting,
      attendee: meetingJoinInfo?.attendee
    });
  } catch (e) {
    console.error("Error joining call:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to join call" });
  }
}
async function handleLeaveCall(senderID, payload, connectionId, apiGwManagement) {
  const { callID } = payload;
  if (!callID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing callID" });
    return;
  }
  if (!CALLS_TABLE) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Server error: Calls table not configured." });
    return;
  }
  try {
    const callResult = await ddb2.send(new GetCommand2({
      TableName: CALLS_TABLE,
      Key: { callID }
    }));
    const call = callResult.Item;
    if (!call) {
      await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Call not found" });
      return;
    }
    for (const participantID of call.participantIDs || []) {
      const pConnectionId = await getConnectionIdForUser2(participantID);
      if (pConnectionId) {
        await sendToClient2(apiGwManagement, pConnectionId, {
          type: "callParticipantUpdate",
          callID,
          action: "left",
          participantID: senderID,
          participantName: senderID
        });
      }
    }
  } catch (e) {
    console.error("Error leaving call:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to leave call" });
  }
}
async function handleMuteCall(senderID, payload, connectionId, apiGwManagement) {
  const { callID, muted } = payload;
  if (!callID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing callID" });
    return;
  }
  if (!CALLS_TABLE) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Server error: Calls table not configured." });
    return;
  }
  try {
    const callResult = await ddb2.send(new GetCommand2({
      TableName: CALLS_TABLE,
      Key: { callID }
    }));
    const call = callResult.Item;
    if (!call)
      return;
    const action = muted ? "muted" : "unmuted";
    for (const participantID of call.participantIDs || []) {
      const pConnectionId = await getConnectionIdForUser2(participantID);
      if (pConnectionId) {
        await sendToClient2(apiGwManagement, pConnectionId, {
          type: "callParticipantUpdate",
          callID,
          action,
          participantID: senderID,
          participantName: senderID
        });
      }
    }
  } catch (e) {
    console.error("Error updating mute state:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to update mute state" });
  }
}
async function handleToggleVideo(senderID, payload, connectionId, apiGwManagement) {
  const { callID, videoOn } = payload;
  if (!callID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing callID" });
    return;
  }
  if (!CALLS_TABLE) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Server error: Calls table not configured." });
    return;
  }
  try {
    const callResult = await ddb2.send(new GetCommand2({
      TableName: CALLS_TABLE,
      Key: { callID }
    }));
    const call = callResult.Item;
    if (!call)
      return;
    const action = videoOn ? "videoOn" : "videoOff";
    for (const participantID of call.participantIDs || []) {
      const pConnectionId = await getConnectionIdForUser2(participantID);
      if (pConnectionId) {
        await sendToClient2(apiGwManagement, pConnectionId, {
          type: "callParticipantUpdate",
          callID,
          action,
          participantID: senderID,
          participantName: senderID
        });
      }
    }
  } catch (e) {
    console.error("Error updating video state:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to update video state" });
  }
}
async function handleEndCall(senderID, payload, connectionId, apiGwManagement) {
  const { callID } = payload;
  if (!callID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing callID" });
    return;
  }
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let call;
    if (CALLS_TABLE) {
      const callResult = await ddb2.send(new GetCommand2({
        TableName: CALLS_TABLE,
        Key: { callID }
      }));
      call = callResult.Item;
      if (call) {
        const startTime = new Date(call.startedAt || now).getTime();
        const endTime = new Date(now).getTime();
        const duration = Math.floor((endTime - startTime) / 1e3);
        await ddb2.send(new UpdateCommand2({
          TableName: CALLS_TABLE,
          Key: { callID },
          UpdateExpression: "SET #status = :status, endedAt = :endedAt, #duration = :duration",
          ExpressionAttributeNames: { "#status": "status", "#duration": "duration" },
          ExpressionAttributeValues: {
            ":status": "ended",
            ":endedAt": now,
            ":duration": duration
          }
        }));
        if (call.meetingId) {
          try {
            const { endMeeting: endMeeting2 } = await Promise.resolve().then(() => (init_chime_meeting_manager(), chime_meeting_manager_exports));
            await endMeeting2(call.meetingId);
            console.log(`[Call] Ended Chime meeting: ${call.meetingId}`);
          } catch (chimeError) {
            console.warn("[Call] Failed to end Chime meeting:", chimeError);
          }
        }
      }
    }
    if (call) {
      for (const participantID of call.participantIDs) {
        const pConnectionId = await getConnectionIdForUser2(participantID);
        if (pConnectionId) {
          await sendToClient2(apiGwManagement, pConnectionId, {
            type: "callStatusUpdate",
            callID,
            status: "ended",
            updatedBy: senderID,
            endedAt: now
          });
        }
      }
    }
  } catch (e) {
    console.error("Error ending call:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to end call" });
  }
}
async function handleDeclineCall(senderID, payload, connectionId, apiGwManagement) {
  const { callID } = payload;
  if (!callID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing callID" });
    return;
  }
  try {
    let call;
    if (CALLS_TABLE) {
      const callResult = await ddb2.send(new GetCommand2({
        TableName: CALLS_TABLE,
        Key: { callID }
      }));
      call = callResult.Item;
    }
    if (CALLS_TABLE) {
      await ddb2.send(new UpdateCommand2({
        TableName: CALLS_TABLE,
        Key: { callID },
        UpdateExpression: "SET #status = :status, endedAt = :endedAt",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "declined",
          ":endedAt": (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
    }
    if (call?.meetingId) {
      try {
        const { endMeeting: endMeeting2 } = await Promise.resolve().then(() => (init_chime_meeting_manager(), chime_meeting_manager_exports));
        await endMeeting2(call.meetingId);
        console.log(`[Call] Ended Chime meeting on decline: ${call.meetingId}`);
      } catch (chimeError) {
        console.warn("[Call] Failed to end Chime meeting:", chimeError);
      }
    }
    if (call) {
      const callerConnectionId = await getConnectionIdForUser2(call.callerID);
      if (callerConnectionId) {
        await sendToClient2(apiGwManagement, callerConnectionId, {
          type: "callStatusUpdate",
          callID,
          status: "declined",
          updatedBy: senderID
        });
      }
      try {
        const { sendMissedCallNotification: sendMissedCallNotification2 } = await Promise.resolve().then(() => (init_push_notifications(), push_notifications_exports));
        await sendMissedCallNotification2(ddb2, call.callerID, senderID, call.callType);
      } catch (pushError) {
        console.warn("[Call] Failed to send missed call notification:", pushError);
      }
    }
  } catch (e) {
    console.error("Error declining call:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to decline call" });
  }
}
async function handleFetchLinkPreview(senderID, payload, connectionId, apiGwManagement) {
  const { url } = payload;
  if (!url) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing URL" });
    return;
  }
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "TodaysDentalBot/1.0 (+https://todaysdentalinsights.com/bot)"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    const getMetaContent = (property) => {
      const match = html.match(new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, "i"));
      return match?.[1];
    };
    const getTitleFromHtml = () => {
      const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      return match?.[1];
    };
    const getDescriptionFromMeta = () => {
      const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
      return match?.[1];
    };
    const preview = {
      url,
      title: getMetaContent("title") || getTitleFromHtml(),
      description: getMetaContent("description") || getDescriptionFromMeta(),
      image: getMetaContent("image"),
      siteName: getMetaContent("site_name") || new URL(url).hostname,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await sendToClient2(apiGwManagement, connectionId, {
      type: "linkPreviewFetched",
      url,
      preview
    });
  } catch (e) {
    console.error("Error fetching link preview:", e);
    await sendToClient2(apiGwManagement, connectionId, {
      type: "linkPreviewFetched",
      url,
      preview: {
        url,
        siteName: new URL(url).hostname,
        fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  }
}
async function handleGetConversationFiles(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, limit = 50, offset = 0 } = payload;
  if (!favorRequestID) {
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID" });
    return;
  }
  try {
    const result = await ddb2.send(new QueryCommand2({
      TableName: MESSAGES_TABLE2,
      KeyConditionExpression: "favorRequestID = :frid",
      FilterExpression: "#type = :file OR #type = :voice",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: {
        ":frid": favorRequestID,
        ":file": "file",
        ":voice": "voice"
      }
    }));
    const allFiles = result.Items || [];
    allFiles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const paginatedFiles = allFiles.slice(offset, offset + limit);
    const files = paginatedFiles.map((msg) => ({
      fileID: msg.messageID,
      fileKey: msg.fileKey || msg.voiceKey,
      fileName: msg.fileDetails?.fileName || "Voice message",
      fileType: msg.fileDetails?.fileType || "audio",
      fileSize: msg.fileDetails?.fileSize || 0,
      uploadedBy: msg.senderID,
      uploadedAt: new Date(msg.timestamp).toISOString(),
      favorRequestID: msg.favorRequestID,
      messageID: msg.messageID,
      downloadCount: msg.downloadCount || 0
    }));
    await sendToClient2(apiGwManagement, connectionId, {
      type: "filesList",
      favorRequestID,
      files,
      total: allFiles.length,
      hasMore: offset + limit < allFiles.length
    });
  } catch (e) {
    console.error("Error getting conversation files:", e);
    await sendToClient2(apiGwManagement, connectionId, { type: "error", message: "Failed to get files" });
  }
}

// src/services/comm/ws-default.ts
var REGION3 = process.env.AWS_REGION || "us-east-1";
var CONNECTIONS_TABLE3 = process.env.CONNECTIONS_TABLE || "";
var MESSAGES_TABLE3 = process.env.MESSAGES_TABLE || "";
var FAVORS_TABLE3 = process.env.FAVORS_TABLE || "";
var TEAMS_TABLE = process.env.TEAMS_TABLE || "";
var MEETINGS_TABLE = process.env.MEETINGS_TABLE || "";
var FILE_BUCKET_NAME2 = process.env.FILE_BUCKET_NAME || "";
var NOTIFICATIONS_TOPIC_ARN = process.env.NOTICES_TOPIC_ARN || "";
var SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || "no-reply@todaysdentalinsights.com";
var USER_POOL_ID = process.env.USER_POOL_ID || "";
var DEVICE_TOKENS_TABLE2 = process.env.DEVICE_TOKENS_TABLE || "";
var SEND_PUSH_FUNCTION_ARN2 = process.env.SEND_PUSH_FUNCTION_ARN || "";
var PUSH_NOTIFICATIONS_ENABLED2 = !!(DEVICE_TOKENS_TABLE2 && SEND_PUSH_FUNCTION_ARN2);
var ddb3 = DynamoDBDocumentClient3.from(new DynamoDBClient3({ region: REGION3 }));
var sns = new SNSClient({ region: REGION3 });
var s32 = new S3Client2({ region: REGION3 });
var ses = new SESv2Client({ region: REGION3 });
var cognito = new CognitoIdentityProviderClient({ region: REGION3 });
var lambdaClient2 = new LambdaClient2({ region: REGION3 });
var handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const domainName = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const apiGwManagement = new ApiGatewayManagementApiClient3({
    region: REGION3,
    endpoint: `https://${domainName}/${stage}`
  });
  try {
    const payload = JSON.parse(event.body || "{}");
    const senderInfo = await getSenderInfo(connectionId);
    if (!senderInfo) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Connection not authenticated" });
      return { statusCode: 401, body: "Unauthorized or connection missing" };
    }
    const senderID = senderInfo.userID;
    switch (payload.action) {
      case "ping":
        break;
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
      case "getPresignedDownloadUrl":
        await getPresignedDownloadUrl(senderID, payload, connectionId, apiGwManagement);
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
      case "addReaction":
        await handleAddReaction(senderID, payload, connectionId, apiGwManagement);
        break;
      case "removeReaction":
        await handleRemoveReaction(senderID, payload, connectionId, apiGwManagement);
        break;
      case "replyToThread":
        await handleReplyToThread(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getThreadReplies":
        await handleGetThreadReplies(senderID, payload, connectionId, apiGwManagement);
        break;
      case "editMessage":
        await handleEditMessage(senderID, payload, connectionId, apiGwManagement);
        break;
      case "deleteMessage":
        await handleDeleteMessage(senderID, payload, connectionId, apiGwManagement);
        break;
      case "typingStart":
        await handleTypingStart(senderID, payload, connectionId, apiGwManagement);
        break;
      case "typingStop":
        await handleTypingStop(senderID, payload, connectionId, apiGwManagement);
        break;
      case "setPresence":
        await handleSetPresence(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getPresence":
        await handleGetPresence(senderID, payload, connectionId, apiGwManagement);
        break;
      case "pinMessage":
        await handlePinMessage(senderID, payload, connectionId, apiGwManagement);
        break;
      case "unpinMessage":
        await handleUnpinMessage(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getPinnedMessages":
        await handleGetPinnedMessages(senderID, payload, connectionId, apiGwManagement);
        break;
      case "addBookmark":
        await handleAddBookmark(senderID, payload, connectionId, apiGwManagement);
        break;
      case "removeBookmark":
        await handleRemoveBookmark(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getBookmarks":
        await handleGetBookmarks(senderID, payload, connectionId, apiGwManagement);
        break;
      case "search":
        await handleSearch(senderID, payload, connectionId, apiGwManagement);
        break;
      case "scheduleMessage":
        await handleScheduleMessage(senderID, payload, connectionId, apiGwManagement);
        break;
      case "cancelScheduledMessage":
        await handleCancelScheduledMessage(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getScheduledMessages":
        await handleGetScheduledMessages(senderID, payload, connectionId, apiGwManagement);
        break;
      case "createChannel":
        await handleCreateChannel(senderID, payload, connectionId, apiGwManagement);
        break;
      case "joinChannel":
        await handleJoinChannel(senderID, payload, connectionId, apiGwManagement);
        break;
      case "leaveChannel":
        await handleLeaveChannel(senderID, payload, connectionId, apiGwManagement);
        break;
      case "archiveChannel":
        await handleArchiveChannel(senderID, payload, connectionId, apiGwManagement);
        break;
      case "listChannels":
        await handleListChannels(senderID, payload, connectionId, apiGwManagement);
        break;
      case "openGroupChat":
        await handleOpenGroupChat(senderID, payload, connectionId, apiGwManagement);
        break;
      case "markDelivered":
        await handleMarkDelivered(senderID, payload, connectionId, apiGwManagement);
        break;
      case "markMessagesRead":
        await handleMarkMessagesRead(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getVoiceUploadUrl":
        await handleGetVoiceUploadUrl(senderID, payload, connectionId, apiGwManagement);
        break;
      case "sendVoiceMessage":
        await handleSendVoiceMessage(senderID, payload, connectionId, apiGwManagement);
        break;
      case "updateConversationSettings":
        await handleUpdateConversationSettings(senderID, payload, connectionId, apiGwManagement);
        break;
      case "muteConversation":
        await handleMuteConversation(senderID, payload, connectionId, apiGwManagement);
        break;
      case "unmuteConversation":
        await handleUnmuteConversation(senderID, payload, connectionId, apiGwManagement);
        break;
      case "archiveConversation":
        await handleArchiveConversation(senderID, payload, connectionId, apiGwManagement);
        break;
      case "pinConversation":
        await handlePinConversation(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getConversationAnalytics":
        await handleGetConversationAnalytics(senderID, payload, connectionId, apiGwManagement);
        break;
      case "searchGifs":
        await handleSearchGifs(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getTrendingGifs":
        await handleGetTrendingGifs(senderID, payload, connectionId, apiGwManagement);
        break;
      case "sendGif":
        await handleSendGif(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getStickerPacks":
        await handleGetStickerPacks(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getStickers":
        await handleGetStickers(senderID, payload, connectionId, apiGwManagement);
        break;
      case "sendSticker":
        await handleSendSticker(senderID, payload, connectionId, apiGwManagement);
        break;
      case "initiateCall":
        await handleInitiateCall(senderID, payload, connectionId, apiGwManagement);
        break;
      case "joinCall":
        await handleJoinCall(senderID, payload, connectionId, apiGwManagement);
        break;
      case "leaveCall":
        await handleLeaveCall(senderID, payload, connectionId, apiGwManagement);
        break;
      case "endCall":
        await handleEndCall(senderID, payload, connectionId, apiGwManagement);
        break;
      case "declineCall":
        await handleDeclineCall(senderID, payload, connectionId, apiGwManagement);
        break;
      case "muteCall":
        await handleMuteCall(senderID, payload, connectionId, apiGwManagement);
        break;
      case "toggleVideo":
        await handleToggleVideo(senderID, payload, connectionId, apiGwManagement);
        break;
      case "fetchLinkPreview":
        await handleFetchLinkPreview(senderID, payload, connectionId, apiGwManagement);
        break;
      case "getConversationFiles":
        await handleGetConversationFiles(senderID, payload, connectionId, apiGwManagement);
        break;
      default:
        await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unknown action" });
    }
    return { statusCode: 200, body: "Data processed" };
  } catch (error) {
    console.error("Error processing WebSocket message:", error);
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Internal server error" });
    return { statusCode: 500, body: "Error" };
  }
};
async function createTeam(ownerID, payload, connectionId, apiGwManagement) {
  const { name, members } = payload;
  if (!name || !Array.isArray(members) || members.length === 0) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing team name or members list." });
    return;
  }
  if (!TEAMS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
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
    await ddb3.send(new PutCommand3({
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to create team." });
  }
}
async function listTeams(callerID, connectionId, apiGwManagement) {
  if (!TEAMS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  try {
    const result = await ddb3.send(new ScanCommand3({
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
    await sendToClient3(apiGwManagement, connectionId, {
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to list teams." });
  }
}
async function addUserToTeam(callerID, payload, connectionId, apiGwManagement) {
  const { teamID, userID } = payload;
  if (!teamID || !userID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing teamID or userID." });
    return;
  }
  if (!TEAMS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  try {
    const teamResult = await ddb3.send(new GetCommand3({
      TableName: TEAMS_TABLE,
      Key: { teamID }
    }));
    const team = teamResult.Item;
    if (!team) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Team not found." });
      return;
    }
    if (team.ownerID !== callerID) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the team owner can add members." });
      return;
    }
    if (team.members.includes(userID)) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "User is already a member of this team." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const updatedMembers = [...team.members, userID];
    await ddb3.send(new UpdateCommand3({
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to add user to team." });
  }
}
async function removeUserFromTeam(callerID, payload, connectionId, apiGwManagement) {
  const { teamID, userID } = payload;
  if (!teamID || !userID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing teamID or userID." });
    return;
  }
  if (!TEAMS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  try {
    const teamResult = await ddb3.send(new GetCommand3({
      TableName: TEAMS_TABLE,
      Key: { teamID }
    }));
    const team = teamResult.Item;
    if (!team) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Team not found." });
      return;
    }
    if (team.ownerID !== callerID) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the team owner can remove members." });
      return;
    }
    if (userID === team.ownerID) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "The team owner cannot be removed from the team." });
      return;
    }
    if (!team.members.includes(userID)) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "User is not a member of this team." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const updatedMembers = team.members.filter((m) => m !== userID);
    await ddb3.send(new UpdateCommand3({
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to remove user from team." });
  }
}
async function handleOpenGroupChat(callerID, payload, connectionId, apiGwManagement) {
  const { teamID } = payload;
  if (!teamID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing teamID." });
    return;
  }
  if (!TEAMS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Teams table not configured." });
    return;
  }
  try {
    const teamResult = await ddb3.send(new GetCommand3({
      TableName: TEAMS_TABLE,
      Key: { teamID }
    }));
    const team = teamResult.Item;
    if (!team) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Team not found." });
      return;
    }
    if (!team.members.includes(callerID)) {
      await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a member of this team." });
      return;
    }
    const existingConvos = await ddb3.send(new QueryCommand3({
      TableName: FAVORS_TABLE3,
      IndexName: "TeamIndex",
      KeyConditionExpression: "teamID = :teamID",
      ExpressionAttributeValues: {
        ":teamID": teamID
      },
      ScanIndexForward: false
      // Most recent first
    }));
    const conversations = existingConvos.Items || [];
    const mainConvo = conversations.find((c) => c.isMainGroupChat === true) || conversations[0];
    if (mainConvo) {
      console.log(`Opening existing group chat: ${mainConvo.favorRequestID} for team ${teamID}`);
      const messagesResult = await ddb3.send(new QueryCommand3({
        TableName: MESSAGES_TABLE3,
        KeyConditionExpression: "favorRequestID = :frid",
        ExpressionAttributeValues: {
          ":frid": mainConvo.favorRequestID
        },
        ScanIndexForward: true,
        // Oldest first
        Limit: 100
      }));
      const messages = messagesResult.Items || [];
      await sendToClient3(apiGwManagement, connectionId, {
        type: "groupChatOpened",
        favor: mainConvo,
        favorRequestID: mainConvo.favorRequestID,
        teamID,
        team: {
          teamID: team.teamID,
          name: team.name,
          members: team.members,
          ownerID: team.ownerID
        },
        messages,
        isExisting: true
      });
    } else {
      console.log(`Creating new main group chat for team ${teamID}`);
      const favorRequestID = v4_default();
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const newFavor = {
        favorRequestID,
        senderID: callerID,
        teamID,
        title: team.name,
        // Use team name as conversation title
        description: `Group chat for ${team.name}`,
        status: "active",
        priority: "Medium",
        currentAssigneeID: void 0,
        createdAt: nowIso,
        updatedAt: nowIso,
        userID: callerID,
        requestType: "General",
        unreadCount: 0,
        initialMessage: `Welcome to ${team.name}! \u{1F44B}`,
        isMainGroupChat: true
        // Mark as the main group chat
      };
      await ddb3.send(new PutCommand3({
        TableName: FAVORS_TABLE3,
        Item: newFavor
      }));
      const welcomeMessage = {
        favorRequestID,
        senderID: "system",
        content: `Welcome to ${team.name}! This is the beginning of your group chat. \u{1F389}`,
        timestamp: Date.now(),
        type: "system"
      };
      await ddb3.send(new PutCommand3({
        TableName: MESSAGES_TABLE3,
        Item: {
          ...welcomeMessage,
          messageID: v4_default()
        }
      }));
      const notificationPayload = {
        type: "favorRequestUpdated",
        favor: newFavor
      };
      await sendToAll(apiGwManagement, team.members, notificationPayload, { notifyOffline: false });
      await sendToClient3(apiGwManagement, connectionId, {
        type: "groupChatOpened",
        favor: newFavor,
        favorRequestID,
        teamID,
        team: {
          teamID: team.teamID,
          name: team.name,
          members: team.members,
          ownerID: team.ownerID
        },
        messages: [welcomeMessage],
        isExisting: false
      });
    }
  } catch (e) {
    console.error("Failed to open group chat:", e);
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to open group chat." });
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
    await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Missing initialMessage, requestType, and recipient (receiverID or teamID)." });
    return;
  }
  const isGroupRequest = !!teamID;
  let recipients = [];
  if (isGroupRequest) {
    if (!TEAMS_TABLE) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Server error: Teams table not configured for group request." });
      return;
    }
    const teamResult = await ddb3.send(new GetCommand3({
      TableName: TEAMS_TABLE,
      Key: { teamID }
    }));
    const team = teamResult.Item;
    if (!team) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: `Team ID ${teamID} not found.` });
      return;
    }
    if (!team.members.includes(senderID)) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Unauthorized: You are not a member of this team." });
      return;
    }
    recipients = team.members.filter((memberId) => memberId !== senderID);
    if (recipients.length === 0) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "The team has no other members to assign the task to." });
      return;
    }
  } else {
    if (senderID === receiverID) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "A favor request cannot be started with yourself. Please select another user." });
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
  await ddb3.send(new PutCommand3({
    TableName: FAVORS_TABLE3,
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
  await sendToClient3(apiGwManagement, senderConnectionId, {
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
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Missing favorRequestID or message content/file key." });
    }
    return;
  }
  const timestamp = Date.now();
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    if (senderConnectionId) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Favor request not found." });
    }
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    if (senderConnectionId) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    }
    return;
  }
  const recipientIDs = await getRecipientIDs(favor, senderID);
  const isClosed = favor.status === "completed" || favor.status === "rejected";
  if (isClosed || recipientIDs.length === 0) {
    if (senderConnectionId) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Request is closed or has no recipients." });
    }
    return;
  }
  const incrementAmount = recipientIDs.length;
  const updateResult = await ddb3.send(new UpdateCommand3({
    TableName: FAVORS_TABLE3,
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
    const teamResult = await ddb3.send(new GetCommand3({
      TableName: TEAMS_TABLE,
      Key: { teamID: favor.teamID }
    }));
    const team = teamResult.Item;
    const members = normalizeMembers(team?.members);
    return members.filter((memberId) => memberId !== senderID);
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
  const teamResult = await ddb3.send(new GetCommand3({
    TableName: TEAMS_TABLE,
    Key: { teamID: favor.teamID }
  }));
  const team = teamResult.Item;
  const members = normalizeMembers(team?.members);
  return members.includes(userID);
}
async function getAllParticipants(favor) {
  if (favor.teamID) {
    if (!TEAMS_TABLE) {
      console.error("TEAMS_TABLE not configured for participant lookup.");
      return [favor.senderID];
    }
    const teamResult = await ddb3.send(new GetCommand3({
      TableName: TEAMS_TABLE,
      Key: { teamID: favor.teamID }
    }));
    const team = teamResult.Item;
    const members = normalizeMembers(team?.members);
    return members.length > 0 ? members : [favor.senderID];
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Favor request not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, callerID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    return;
  }
  try {
    const updateResult = await ddb3.send(new UpdateCommand3({
      TableName: FAVORS_TABLE3,
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
    await sendToClient3(apiGwManagement, connectionId, broadcastUpdatePayload);
  } catch (e) {
    console.error("Error marking read:", e);
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to update read status." });
  }
}
async function resolveRequest(senderID, payload, apiGwManagement) {
  const { favorRequestID } = payload;
  const senderConnectionId = (await getSenderInfoByUserID(senderID))?.connectionId;
  if (!favorRequestID) {
    if (senderConnectionId) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Missing favorRequestID." });
    }
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    if (senderConnectionId) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Favor request not found." });
    }
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    if (senderConnectionId) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    }
    return;
  }
  if (favor.status !== "active") {
    if (senderConnectionId) {
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Request is already resolved." });
    }
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await ddb3.send(new UpdateCommand3({
      TableName: FAVORS_TABLE3,
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
      await sendToClient3(apiGwManagement, senderConnectionId, { type: "error", message: "Failed to resolve request." });
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
    return ddb3.send(
      new QueryCommand3({
        TableName: FAVORS_TABLE3,
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
    const result = await ddb3.send(new ScanCommand3({
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
    await sendToClient3(apiGwManagement, connectionId, {
      type: "favorRequestsList",
      role,
      items,
      nextToken: newToken
    });
  } catch (error) {
    console.error("Error fetching favor requests via WebSocket:", error);
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to fetch favor requests list." });
  }
}
async function _saveAndBroadcastMessage(messageData, apiGwManagement, recipientIDs) {
  await ddb3.send(new PutCommand3({
    TableName: MESSAGES_TABLE3,
    Item: messageData
  }));
  let participants = [messageData.senderID];
  let recipients = recipientIDs;
  if (!recipients) {
    const favorResult = await ddb3.send(new GetCommand3({
      TableName: FAVORS_TABLE3,
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
  const result = await ddb3.send(new GetCommand3({
    TableName: CONNECTIONS_TABLE3,
    Key: { connectionId }
  }));
  const item = result.Item;
  if (!item)
    return void 0;
  return { connectionId: item.connectionId, userID: item.userID };
}
async function getSenderInfoByUserID(userID) {
  const result = await ddb3.send(new QueryCommand3({
    TableName: CONNECTIONS_TABLE3,
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID for history fetch." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Favor request not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, callerID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    return;
  }
  const queryInput = {
    TableName: MESSAGES_TABLE3,
    KeyConditionExpression: "favorRequestID = :id",
    ExpressionAttributeValues: { ":id": favorRequestID },
    ScanIndexForward: true,
    // Chronological order (oldest first)
    Limit: limit
    // Optional: Use ExclusiveStartKey for pagination (not fully implemented here, just lastTimestamp as anchor)
  };
  const historyResult = await ddb3.send(new QueryCommand3(queryInput));
  await sendToClient3(apiGwManagement, connectionId, {
    type: "favorHistory",
    favorRequestID,
    messages: historyResult.Items || []
    // nextToken: historyResult.LastEvaluatedKey // To implement robust pagination
  });
}
async function sendToClient3(apiGwManagement, connectionId, data) {
  try {
    await apiGwManagement.send(new PostToConnectionCommand3({
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
      await sendToClient3(apiGwManagement, conn.connectionId, data);
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
  if (PUSH_NOTIFICATIONS_ENABLED2 && SEND_PUSH_FUNCTION_ARN2) {
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
      const response = await lambdaClient2.send(new InvokeCommand2({
        FunctionName: SEND_PUSH_FUNCTION_ARN2,
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
  if (!PUSH_NOTIFICATIONS_ENABLED2 || userIds.length === 0) {
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
    await lambdaClient2.send(new InvokeCommand2({
      FunctionName: SEND_PUSH_FUNCTION_ARN2,
      Payload: JSON.stringify(notificationPayload),
      InvocationType: "Event"
    }));
    console.log(`[PushNotifications] Task notification sent to ${userIds.length} users`);
  } catch (error) {
    console.error("[PushNotifications] Failed to send task notification:", error.message);
  }
}
async function sendMeetingPushNotification(userIds, type, meetingTitle, organizerName, meetingId, startTime) {
  if (!PUSH_NOTIFICATIONS_ENABLED2 || userIds.length === 0) {
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
    await lambdaClient2.send(new InvokeCommand2({
      FunctionName: SEND_PUSH_FUNCTION_ARN2,
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing file details or favorRequestID" });
    return;
  }
  if (!FILE_BUCKET_NAME2) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: File bucket not configured." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID: payload.favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Favor request not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    return;
  }
  const rawName = String(payload.fileName);
  const safeFileName = rawName.split("/").pop()?.split("\\").pop() || "file";
  const fileKey = `favors/${payload.favorRequestID}/${senderID}-${v4_default()}-${safeFileName}`;
  const command = new PutObjectCommand2({
    Bucket: FILE_BUCKET_NAME2,
    Key: fileKey,
    ContentType: payload.fileType
  });
  try {
    const url = await getSignedUrl2(s32, command, { expiresIn: 900 });
    await sendToClient3(apiGwManagement, connectionId, {
      type: "presignedUrl",
      favorRequestID: payload.favorRequestID,
      url,
      fileKey,
      fileType: payload.fileType
      // Include fileType in response
    });
  } catch (e) {
    console.error("Error generating signed URL:", e);
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to generate file upload URL" });
  }
}
async function getPresignedDownloadUrl(requesterID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, fileKey } = payload || {};
  if (!favorRequestID || !fileKey) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID or fileKey." });
    return;
  }
  if (!FILE_BUCKET_NAME2) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: File bucket not configured." });
    return;
  }
  const cleanKey = sanitizeFileKey(String(fileKey));
  const expectedPrefix = `favors/${favorRequestID}/`;
  if (!cleanKey.startsWith(expectedPrefix)) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Invalid fileKey for this conversation." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Favor request not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, requesterID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this request." });
    return;
  }
  try {
    const command = new GetObjectCommand2({
      Bucket: FILE_BUCKET_NAME2,
      Key: cleanKey
    });
    const url = await getSignedUrl2(s32, command, { expiresIn: 900 });
    await sendToClient3(apiGwManagement, connectionId, {
      type: "presignedDownloadUrl",
      favorRequestID,
      url,
      fileKey: cleanKey
    });
  } catch (e) {
    console.error("Error generating signed download URL:", e);
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Failed to generate file download URL" });
  }
}
function normalizeMembers(members) {
  if (Array.isArray(members)) {
    return members.filter((m) => typeof m === "string");
  }
  if (members instanceof Set) {
    return Array.from(members).filter((m) => typeof m === "string");
  }
  return [];
}
async function forwardTask(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID, forwardTo, message, deadline, requireAcceptance = false, notifyOriginalAssignee = true } = payload;
  if (!favorRequestID || !forwardTo) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID or forwardTo." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
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
  await ddb3.send(new UpdateCommand3({
    TableName: FAVORS_TABLE3,
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const forwardingChain = favor.forwardingChain || [];
  const forwardIndex = forwardID ? forwardingChain.findIndex((f) => f.forwardID === forwardID) : forwardingChain.findIndex((f) => f.toUserID === senderID && f.status === "pending");
  if (forwardIndex === -1) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "No pending forward found for you." });
    return;
  }
  const forwardRecord = forwardingChain[forwardIndex];
  if (forwardRecord.toUserID !== senderID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "This forward is not assigned to you." });
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
  await ddb3.send(new UpdateCommand3({
    TableName: FAVORS_TABLE3,
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb3.send(new UpdateCommand3({
    TableName: FAVORS_TABLE3,
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (removeDeadline) {
    await ddb3.send(new UpdateCommand3({
      TableName: FAVORS_TABLE3,
      Key: { favorRequestID },
      UpdateExpression: "REMOVE deadline SET updatedAt = :ua",
      ExpressionAttributeValues: { ":ua": nowIso }
    }));
  } else {
    await ddb3.send(new UpdateCommand3({
      TableName: FAVORS_TABLE3,
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  const participants = await getAllParticipants(favor);
  await sendToClient3(apiGwManagement, connectionId, {
    type: "taskDetails",
    favor,
    participants
  });
}
async function getForwardHistory(senderID, payload, connectionId, apiGwManagement) {
  const { favorRequestID } = payload;
  if (!favorRequestID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this task." });
    return;
  }
  await sendToClient3(apiGwManagement, connectionId, {
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing favorRequestID." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Task not found." });
    return;
  }
  if (favor.senderID !== senderID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the creator can delete this task." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb3.send(new UpdateCommand3({
    TableName: FAVORS_TABLE3,
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing required meeting fields." });
    return;
  }
  if (!MEETINGS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  const favorResult = await ddb3.send(new GetCommand3({
    TableName: FAVORS_TABLE3,
    Key: { favorRequestID: conversationID }
  }));
  const favor = favorResult.Item;
  if (!favor) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Conversation not found." });
    return;
  }
  const isParticipant = await isUserParticipant(favor, senderID);
  if (!isParticipant) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: You are not a participant in this conversation." });
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
  await ddb3.send(new PutCommand3({
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  let meetings = [];
  if (conversationID) {
    const result = await ddb3.send(new QueryCommand3({
      TableName: MEETINGS_TABLE,
      IndexName: "ConversationIndex",
      KeyConditionExpression: "conversationID = :cid",
      ExpressionAttributeValues: { ":cid": conversationID },
      ScanIndexForward: false,
      Limit: limit
    }));
    meetings = result.Items || [];
  } else {
    const result = await ddb3.send(new QueryCommand3({
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
  await sendToClient3(apiGwManagement, connectionId, {
    type: "meetingsList",
    meetings,
    conversationID
  });
}
async function updateMeeting(senderID, payload, connectionId, apiGwManagement) {
  const { meetingID, title, description, startTime, endTime, location, meetingLink, participants, status } = payload;
  if (!meetingID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing meetingID." });
    return;
  }
  if (!MEETINGS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  const meetingResult = await ddb3.send(new GetCommand3({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  const meeting = meetingResult.Item;
  if (!meeting) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Meeting not found." });
    return;
  }
  if (meeting.organizerID !== senderID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the organizer can update this meeting." });
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
  await ddb3.send(new UpdateCommand3({
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
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Missing meetingID." });
    return;
  }
  if (!MEETINGS_TABLE) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Server error: Meetings table not configured." });
    return;
  }
  const meetingResult = await ddb3.send(new GetCommand3({
    TableName: MEETINGS_TABLE,
    Key: { meetingID }
  }));
  const meeting = meetingResult.Item;
  if (!meeting) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Meeting not found." });
    return;
  }
  if (meeting.organizerID !== senderID) {
    await sendToClient3(apiGwManagement, connectionId, { type: "error", message: "Unauthorized: Only the organizer can delete this meeting." });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await ddb3.send(new UpdateCommand3({
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

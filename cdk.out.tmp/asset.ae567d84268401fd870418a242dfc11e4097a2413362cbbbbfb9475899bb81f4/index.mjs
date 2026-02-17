// src/services/comm/ws-disconnect.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from "@aws-sdk/client-chime-sdk-meetings";
var REGION = process.env.AWS_REGION || "us-east-1";
var CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "";
var CALLS_TABLE = process.env.CALLS_TABLE || "";
var ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
var chimeClient = new ChimeSDKMeetingsClient({ region: REGION });
var handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  let userID;
  try {
    if (CONNECTIONS_TABLE) {
      try {
        const connResult = await ddb.send(new GetCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId }
        }));
        userID = connResult.Item?.userID;
      } catch (lookupErr) {
        console.warn(`[Disconnect] Failed to look up connection ${connectionId}:`, lookupErr);
      }
    }
    await ddb.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    console.log(`Connection removed: ${connectionId}${userID ? ` (user: ${userID})` : ""}`);
  } catch (error) {
    console.error("Error handling disconnect:", error);
    return { statusCode: 500, body: "Failed to disconnect" };
  }
  if (userID && CALLS_TABLE) {
    try {
      await cleanupActiveCallsForUser(userID);
    } catch (callCleanupErr) {
      console.error("[Disconnect] Error during call cleanup:", callCleanupErr);
    }
  }
  return { statusCode: 200, body: "Disconnected" };
};
async function cleanupActiveCallsForUser(userID) {
  try {
    const remainingConnections = await ddb.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: "UserIDIndex",
      KeyConditionExpression: "userID = :uid",
      ExpressionAttributeValues: { ":uid": userID },
      Limit: 1
      // We only need to know if at least 1 remains
    }));
    const remaining = (remainingConnections.Items || []).length;
    if (remaining > 0) {
      console.log(`[Disconnect] User ${userID} still has ${remaining}+ active connection(s) \u2014 skipping call cleanup`);
      return;
    }
  } catch (connCheckErr) {
    console.warn(`[Disconnect] Failed to check remaining connections for ${userID}, proceeding with cleanup:`, connCheckErr);
  }
  let lastKey;
  const activeCalls = [];
  do {
    const scanResult = await ddb.send(new ScanCommand({
      TableName: CALLS_TABLE,
      FilterExpression: "(#status = :connected OR #status = :ringing) AND contains(participantIDs, :userID)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":connected": "connected",
        ":ringing": "ringing",
        ":userID": userID
      },
      ExclusiveStartKey: lastKey,
      Limit: 50
      // Reasonable limit — a user shouldn't be in 50 calls at once
    }));
    activeCalls.push(...scanResult.Items || []);
    lastKey = scanResult.LastEvaluatedKey;
  } while (lastKey);
  if (activeCalls.length === 0) {
    return;
  }
  console.log(`[Disconnect] Found ${activeCalls.length} active call(s) for user ${userID}. Cleaning up\u2026`);
  for (const call of activeCalls) {
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const startTime = new Date(call.startedAt || now).getTime();
      const endTime = new Date(now).getTime();
      const duration = Math.floor((endTime - startTime) / 1e3);
      await ddb.send(new UpdateCommand({
        TableName: CALLS_TABLE,
        Key: { callID: call.callID },
        UpdateExpression: "SET #status = :status, endedAt = :endedAt, #duration = :duration",
        ExpressionAttributeNames: { "#status": "status", "#duration": "duration" },
        ExpressionAttributeValues: {
          ":status": "ended",
          ":endedAt": now,
          ":duration": duration
        },
        // Only update if still active (avoid race with normal endCall)
        ConditionExpression: "#status = :connected OR #status = :ringing"
      }));
      if (call.meetingId) {
        try {
          await chimeClient.send(new DeleteMeetingCommand({
            MeetingId: call.meetingId
          }));
          console.log(`[Disconnect] Ended Chime meeting ${call.meetingId} for call ${call.callID}`);
        } catch (chimeErr) {
          if (chimeErr.name === "NotFoundException") {
            console.log(`[Disconnect] Chime meeting ${call.meetingId} already ended`);
          } else {
            console.warn(`[Disconnect] Failed to end Chime meeting ${call.meetingId}:`, chimeErr);
          }
        }
      }
      console.log(`[Disconnect] Auto-ended call ${call.callID} (user ${userID} disconnected)`);
    } catch (callErr) {
      if (callErr.name === "ConditionalCheckFailedException") {
        console.log(`[Disconnect] Call ${call.callID} already ended (race condition)`);
      } else {
        console.warn(`[Disconnect] Failed to cleanup call ${call.callID}:`, callErr);
      }
    }
  }
}
export {
  handler
};

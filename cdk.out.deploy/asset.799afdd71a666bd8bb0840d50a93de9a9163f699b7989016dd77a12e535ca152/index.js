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

// src/services/chime/meeting-manager.ts
var meeting_manager_exports = {};
__export(meeting_manager_exports, {
  addAgentToMeeting: () => addAgentToMeeting,
  createMeetingForCall: () => createMeetingForCall,
  endMeeting: () => endMeeting,
  getChimeMeeting: () => getChimeMeeting,
  getMeetingByCallId: () => getMeetingByCallId,
  getMeetingInfo: () => getMeetingInfo,
  handler: () => handler
});
module.exports = __toCommonJS(meeting_manager_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chime = new import_client_chime_sdk_meetings.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
var ACTIVE_MEETINGS_TABLE = process.env.ACTIVE_MEETINGS_TABLE;
var TRANSCRIPTION_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || "en-US";
var MEDICAL_VOCABULARY_NAME = process.env.MEDICAL_VOCABULARY_NAME;
var ENABLE_MEETING_TRANSCRIPTION = process.env.ENABLE_MEETING_TRANSCRIPTION !== "false";
async function startMeetingTranscription(meetingId, callId) {
  if (!ENABLE_MEETING_TRANSCRIPTION) {
    console.log(`[MeetingManager] Meeting transcription disabled via environment variable`);
    return false;
  }
  console.log(`[MeetingManager] Starting real-time transcription for meeting ${meetingId} (call ${callId})`);
  try {
    const transcriptionConfig = {
      EngineTranscribeSettings: {
        LanguageCode: TRANSCRIPTION_LANGUAGE,
        // Enable partial results for faster response time
        EnablePartialResultsStabilization: true,
        PartialResultsStability: "high",
        // Optional: Use medical vocabulary if configured
        VocabularyName: MEDICAL_VOCABULARY_NAME || void 0
        // Content identification for PII redaction (optional)
        // ContentIdentificationType: 'PII',
        // ContentRedactionType: 'PII',
      }
    };
    await chime.send(new import_client_chime_sdk_meetings.StartMeetingTranscriptionCommand({
      MeetingId: meetingId,
      TranscriptionConfiguration: transcriptionConfig
    }));
    console.log(`[MeetingManager] Successfully started transcription for meeting ${meetingId}`);
    console.log(`[MeetingManager] Transcription config:`, {
      language: TRANSCRIPTION_LANGUAGE,
      vocabulary: MEDICAL_VOCABULARY_NAME || "default",
      partialResults: true,
      stability: "high"
    });
    return true;
  } catch (error) {
    if (error.name === "ConflictException") {
      console.warn(`[MeetingManager] Transcription already active for meeting ${meetingId}`);
      return true;
    }
    if (error.name === "ServiceUnavailableException") {
      console.error(`[MeetingManager] Transcription service unavailable, will retry later`);
      return false;
    }
    console.error(`[MeetingManager] Failed to start transcription for meeting ${meetingId}:`, error);
    return false;
  }
}
async function stopMeetingTranscription(meetingId) {
  try {
    await chime.send(new import_client_chime_sdk_meetings.StopMeetingTranscriptionCommand({
      MeetingId: meetingId
    }));
    console.log(`[MeetingManager] Stopped transcription for meeting ${meetingId}`);
  } catch (error) {
    if (error.name !== "NotFoundException") {
      console.warn(`[MeetingManager] Error stopping transcription for meeting ${meetingId}:`, error);
    }
  }
}
async function createMeetingForCall(clinicId, callId, callType, patientPhone) {
  console.log(`[MeetingManager] Creating meeting for call ${callId}`);
  try {
    const meetingResult = await chime.send(new import_client_chime_sdk_meetings.CreateMeetingCommand({
      ExternalMeetingId: `call-${callId}`,
      MediaRegion: CHIME_MEDIA_REGION,
      MeetingFeatures: {
        Audio: {
          EchoReduction: "AVAILABLE"
        }
      },
      // IMPORTANT: For SipMediaApplicationDialIn product type limitations:
      // - We cannot use Voice Connector streaming (VC streaming requires direct SIP routing)
      // - Instead, we use Media Insights Pipeline attached to the meeting
      // - The pipeline will create KVS streams automatically
      Tags: [
        { Key: "CallId", Value: callId },
        { Key: "ClinicId", Value: clinicId },
        { Key: "CallType", Value: callType }
      ]
    }));
    if (!meetingResult.Meeting?.MeetingId) {
      throw new Error("Failed to create meeting - no meeting ID returned");
    }
    const meetingId = meetingResult.Meeting.MeetingId;
    console.log(`[MeetingManager] Created meeting ${meetingId} for call ${callId}`);
    const attendeeResult = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
      MeetingId: meetingId,
      ExternalUserId: `patient-${callId}`
    }));
    if (!attendeeResult.Attendee?.AttendeeId) {
      throw new Error("Failed to create attendee - no attendee ID returned");
    }
    const attendeeInfo = {
      attendeeId: attendeeResult.Attendee.AttendeeId,
      joinToken: attendeeResult.Attendee.JoinToken || "",
      externalUserId: `patient-${callId}`
    };
    const transcriptionEnabled = await startMeetingTranscription(meetingId, callId);
    const meetingInfo = {
      meetingId,
      callId,
      clinicId,
      callType,
      patientPhone,
      status: "active",
      startTime: Date.now(),
      participants: [attendeeInfo.attendeeId],
      attendeeInfo,
      transcriptionEnabled,
      transcriptionStatus: transcriptionEnabled ? "starting" : void 0
    };
    await ddb.send(new import_lib_dynamodb.PutCommand({
      TableName: ACTIVE_MEETINGS_TABLE,
      Item: meetingInfo
    }));
    console.log(`[MeetingManager] Stored meeting info for ${meetingId}${transcriptionEnabled ? " with transcription enabled" : " (transcription disabled)"}`);
    return meetingInfo;
  } catch (error) {
    console.error(`[MeetingManager] Error creating meeting for call ${callId}:`, error);
    throw error;
  }
}
async function addAgentToMeeting(meetingId, agentUserId) {
  console.log(`[MeetingManager] Adding agent ${agentUserId} to meeting ${meetingId}`);
  try {
    const attendeeResult = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
      MeetingId: meetingId,
      ExternalUserId: `agent-${agentUserId}`
    }));
    if (!attendeeResult.Attendee?.AttendeeId) {
      throw new Error("Failed to create attendee for agent - no attendee ID returned");
    }
    const attendeeInfo = {
      attendeeId: attendeeResult.Attendee.AttendeeId,
      joinToken: attendeeResult.Attendee.JoinToken || "",
      externalUserId: `agent-${agentUserId}`
    };
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: ACTIVE_MEETINGS_TABLE,
      Key: { meetingId },
      UpdateExpression: "SET participants = list_append(if_not_exists(participants, :empty_list), :agent)",
      ExpressionAttributeValues: {
        ":agent": [attendeeInfo.attendeeId],
        ":empty_list": []
      }
    }));
    console.log(`[MeetingManager] Added agent ${agentUserId} to meeting ${meetingId}`);
    return attendeeInfo;
  } catch (error) {
    console.error(`[MeetingManager] Error adding agent to meeting ${meetingId}:`, error);
    throw error;
  }
}
async function getMeetingInfo(meetingId) {
  try {
    const result = await ddb.send(new import_lib_dynamodb.GetCommand({
      TableName: ACTIVE_MEETINGS_TABLE,
      Key: { meetingId }
    }));
    return result.Item;
  } catch (error) {
    console.error(`[MeetingManager] Error getting meeting info for ${meetingId}:`, error);
    throw error;
  }
}
async function getMeetingByCallId(callId) {
  try {
    const result = await ddb.send(new import_lib_dynamodb.GetCommand({
      TableName: ACTIVE_MEETINGS_TABLE,
      Key: { callId }
    }));
    return result.Item;
  } catch (error) {
    console.error(`[MeetingManager] Error getting meeting by call ID ${callId}:`, error);
    return null;
  }
}
async function endMeeting(meetingId) {
  console.log(`[MeetingManager] Ending meeting ${meetingId}`);
  try {
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: ACTIVE_MEETINGS_TABLE,
      Key: { meetingId },
      UpdateExpression: "SET #status = :ended, endTime = :endTime, transcriptionStatus = :transcriptionStatus",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":ended": "ended",
        ":endTime": Date.now(),
        ":transcriptionStatus": "stopped"
      }
    }));
    await stopMeetingTranscription(meetingId);
    try {
      await chime.send(new import_client_chime_sdk_meetings.DeleteMeetingCommand({
        MeetingId: meetingId
      }));
      console.log(`[MeetingManager] Deleted Chime meeting ${meetingId}`);
    } catch (deleteError) {
      console.warn(`[MeetingManager] Error deleting Chime meeting ${meetingId}:`, deleteError);
    }
    console.log(`[MeetingManager] Ended meeting ${meetingId}`);
  } catch (error) {
    console.error(`[MeetingManager] Error ending meeting ${meetingId}:`, error);
    throw error;
  }
}
async function getChimeMeeting(meetingId) {
  try {
    const result = await chime.send(new import_client_chime_sdk_meetings.GetMeetingCommand({
      MeetingId: meetingId
    }));
    return result.Meeting;
  } catch (error) {
    console.error(`[MeetingManager] Error getting Chime meeting ${meetingId}:`, error);
    throw error;
  }
}
async function handler(event) {
  console.log("[MeetingManager] Event:", JSON.stringify(event, null, 2));
  const operation = event.operation;
  try {
    switch (operation) {
      case "createMeeting":
        const { clinicId, callId, callType, patientPhone } = event;
        const meetingInfo = await createMeetingForCall(clinicId, callId, callType, patientPhone);
        return {
          statusCode: 200,
          body: JSON.stringify(meetingInfo)
        };
      case "addAgent":
        const { meetingId, agentUserId } = event;
        const attendeeInfo = await addAgentToMeeting(meetingId, agentUserId);
        return {
          statusCode: 200,
          body: JSON.stringify(attendeeInfo)
        };
      case "getMeeting":
        const meetingData = await getMeetingInfo(event.meetingId);
        return {
          statusCode: 200,
          body: JSON.stringify(meetingData)
        };
      case "endMeeting":
        await endMeeting(event.meetingId);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Meeting ended successfully" })
        };
      case "startTranscription": {
        const transcriptionStarted = await startMeetingTranscription(event.meetingId, event.callId || "unknown");
        if (transcriptionStarted) {
          await ddb.send(new import_lib_dynamodb.UpdateCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { meetingId: event.meetingId },
            UpdateExpression: "SET transcriptionEnabled = :enabled, transcriptionStatus = :status",
            ExpressionAttributeValues: {
              ":enabled": true,
              ":status": "active"
            }
          }));
        }
        return {
          statusCode: 200,
          body: JSON.stringify({
            transcriptionEnabled: transcriptionStarted,
            message: transcriptionStarted ? "Transcription started" : "Failed to start transcription"
          })
        };
      }
      case "stopTranscription":
        await stopMeetingTranscription(event.meetingId);
        await ddb.send(new import_lib_dynamodb.UpdateCommand({
          TableName: ACTIVE_MEETINGS_TABLE,
          Key: { meetingId: event.meetingId },
          UpdateExpression: "SET transcriptionStatus = :status",
          ExpressionAttributeValues: {
            ":status": "stopped"
          }
        }));
        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Transcription stopped" })
        };
      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Invalid operation" })
        };
    }
  } catch (error) {
    console.error("[MeetingManager] Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      })
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  addAgentToMeeting,
  createMeetingForCall,
  endMeeting,
  getChimeMeeting,
  getMeetingByCallId,
  getMeetingInfo,
  handler
});

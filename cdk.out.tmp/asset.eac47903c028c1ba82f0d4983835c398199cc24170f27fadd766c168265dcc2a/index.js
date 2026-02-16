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

// src/services/chime/meeting-transcription-handler.ts
var meeting_transcription_handler_exports = {};
__export(meeting_transcription_handler_exports, {
  handleTranscript: () => handleTranscript,
  handler: () => handler,
  invokeBedrockAgent: () => invokeBedrockAgent,
  playAiResponseToMeeting: () => playAiResponseToMeeting
});
module.exports = __toCommonJS(meeting_transcription_handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");
var import_client_polly = require("@aws-sdk/client-polly");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");
var import_crypto = require("crypto");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var bedrock = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });
var polly = new import_client_polly.PollyClient({ region: process.env.AWS_REGION || "us-east-1" });
var s3 = new import_client_s3.S3Client({ region: process.env.AWS_REGION || "us-east-1" });
var chimeVoice = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: process.env.CHIME_MEDIA_REGION || "us-east-1" });
var ACTIVE_MEETINGS_TABLE = process.env.ACTIVE_MEETINGS_TABLE;
var CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE;
var VOICE_SESSIONS_TABLE = process.env.VOICE_SESSIONS_TABLE;
var BEDROCK_AGENT_ID = process.env.BEDROCK_AGENT_ID;
var BEDROCK_AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID || "TSTALIASID";
var TTS_BUCKET = process.env.TTS_BUCKET;
var AI_TRANSCRIPT_STREAM = process.env.AI_TRANSCRIPT_STREAM;
var POLLY_VOICE_ID = process.env.POLLY_VOICE_ID || "Joanna";
var TRANSCRIPT_DEBOUNCE_MS = parseInt(process.env.TRANSCRIPT_DEBOUNCE_MS || "500", 10);
var pendingTranscripts = /* @__PURE__ */ new Map();
var conversationStates = /* @__PURE__ */ new Map();
async function handler(event) {
  console.log("[TranscriptionHandler] Received event:", JSON.stringify(event, null, 2));
  const detail = event.detail || event;
  const eventType = event["detail-type"] || detail.eventType || "unknown";
  try {
    switch (eventType) {
      case "Chime Meeting State Change":
        await handleMeetingStateChange(detail);
        break;
      case "Chime Meeting Transcription":
      case "Transcript":
        await handleTranscript(detail);
        break;
      case "TranscriptionStarted":
        await handleTranscriptionStarted(detail);
        break;
      case "TranscriptionStopped":
        await handleTranscriptionStopped(detail);
        break;
      case "TranscriptionFailed":
        await handleTranscriptionFailed(detail);
        break;
      default:
        console.log(`[TranscriptionHandler] Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    console.error("[TranscriptionHandler] Error processing event:", error);
  }
}
async function handleMeetingStateChange(detail) {
  const meetingId = detail.meetingId || detail.MeetingId;
  const state = detail.state || detail.State;
  console.log(`[TranscriptionHandler] Meeting ${meetingId} state change: ${state}`);
  if (state === "ENDED") {
    conversationStates.delete(meetingId);
    pendingTranscripts.delete(meetingId);
  }
}
async function handleTranscriptionStarted(detail) {
  const meetingId = detail.meetingId || detail.MeetingId;
  console.log(`[TranscriptionHandler] Transcription started for meeting ${meetingId}`);
  try {
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: ACTIVE_MEETINGS_TABLE,
      Key: { meetingId },
      UpdateExpression: "SET transcriptionStatus = :status",
      ExpressionAttributeValues: {
        ":status": "active"
      }
    }));
  } catch (error) {
    console.warn(`[TranscriptionHandler] Failed to update meeting status:`, error);
  }
}
async function handleTranscriptionStopped(detail) {
  const meetingId = detail.meetingId || detail.MeetingId;
  console.log(`[TranscriptionHandler] Transcription stopped for meeting ${meetingId}`);
  conversationStates.delete(meetingId);
  pendingTranscripts.delete(meetingId);
}
async function handleTranscriptionFailed(detail) {
  const meetingId = detail.meetingId || detail.MeetingId;
  const reason = detail.reason || detail.Reason || "Unknown";
  console.error(`[TranscriptionHandler] Transcription failed for meeting ${meetingId}: ${reason}`);
  try {
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: ACTIVE_MEETINGS_TABLE,
      Key: { meetingId },
      UpdateExpression: "SET transcriptionStatus = :status, transcriptionError = :error",
      ExpressionAttributeValues: {
        ":status": "failed",
        ":error": reason
      }
    }));
  } catch (error) {
    console.warn(`[TranscriptionHandler] Failed to update meeting status:`, error);
  }
}
async function handleTranscript(detail) {
  const meetingId = detail.meetingId || detail.MeetingId;
  const attendeeId = detail.attendeeId || detail.AttendeeId;
  const transcript = detail.transcript || detail.Transcript || detail.results;
  const isPartial = detail.isPartial || detail.IsPartial || false;
  let text = "";
  if (typeof transcript === "string") {
    text = transcript;
  } else if (transcript?.alternatives?.[0]?.transcript) {
    text = transcript.alternatives[0].transcript;
  } else if (transcript?.text) {
    text = transcript.text;
  } else if (Array.isArray(transcript)) {
    text = transcript.filter((r) => !r.isPartial).map((r) => r.alternatives?.[0]?.transcript || r.transcript || "").join(" ");
  }
  if (!text || text.trim().length === 0) {
    return;
  }
  console.log(`[TranscriptionHandler] Received transcript for meeting ${meetingId}:`, {
    attendeeId,
    text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
    isPartial
  });
  if (isPartial) {
    const existing = pendingTranscripts.get(meetingId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    pendingTranscripts.set(meetingId, {
      text,
      timestamp: Date.now()
    });
    return;
  }
  let state = conversationStates.get(meetingId);
  if (!state) {
    const meetingInfo = await getMeetingInfo(meetingId);
    if (!meetingInfo) {
      console.warn(`[TranscriptionHandler] No meeting info found for ${meetingId}`);
      return;
    }
    state = {
      meetingId,
      callId: meetingInfo.callId,
      clinicId: meetingInfo.clinicId,
      sessionId: (0, import_crypto.randomUUID)(),
      lastProcessedText: "",
      lastResponseTime: 0,
      isProcessing: false,
      conversationHistory: []
    };
    conversationStates.set(meetingId, state);
  }
  if (text === state.lastProcessedText) {
    console.log(`[TranscriptionHandler] Skipping duplicate text`);
    return;
  }
  if (state.isProcessing) {
    console.log(`[TranscriptionHandler] Already processing, queuing transcript`);
    return;
  }
  state.isProcessing = true;
  state.lastProcessedText = text;
  try {
    state.conversationHistory.push({
      role: "user",
      content: text,
      timestamp: Date.now()
    });
    await storeTranscriptForAnalytics(state.callId, meetingId, text, "user");
    const aiResponse = await invokeBedrockAgent(
      text,
      state.sessionId,
      state.clinicId,
      state.callId
    );
    if (aiResponse) {
      state.conversationHistory.push({
        role: "assistant",
        content: aiResponse,
        timestamp: Date.now()
      });
      await storeTranscriptForAnalytics(state.callId, meetingId, aiResponse, "assistant");
      await playAiResponseToMeeting(meetingId, state.callId, aiResponse);
      state.lastResponseTime = Date.now();
    }
  } catch (error) {
    console.error(`[TranscriptionHandler] Error processing transcript:`, error);
  } finally {
    state.isProcessing = false;
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
    console.error(`[TranscriptionHandler] Error getting meeting info:`, error);
    return null;
  }
}
async function invokeBedrockAgent(userText, sessionId, clinicId, callId) {
  console.log(`[TranscriptionHandler] Invoking Bedrock Agent for session ${sessionId}`);
  try {
    const response = await bedrock.send(new import_client_bedrock_agent_runtime.InvokeAgentCommand({
      agentId: BEDROCK_AGENT_ID,
      agentAliasId: BEDROCK_AGENT_ALIAS_ID,
      sessionId,
      inputText: userText,
      sessionState: {
        sessionAttributes: {
          clinicId,
          callId,
          source: "meeting-transcription"
        }
      }
    }));
    let responseText = "";
    if (response.completion) {
      for await (const chunk of response.completion) {
        if (chunk.chunk?.bytes) {
          responseText += new TextDecoder().decode(chunk.chunk.bytes);
        }
      }
    }
    console.log(`[TranscriptionHandler] Bedrock response:`, {
      sessionId,
      responseLength: responseText.length,
      preview: responseText.substring(0, 100) + (responseText.length > 100 ? "..." : "")
    });
    return responseText.trim() || null;
  } catch (error) {
    console.error(`[TranscriptionHandler] Error invoking Bedrock Agent:`, error);
    return null;
  }
}
async function playAiResponseToMeeting(meetingId, callId, responseText) {
  console.log(`[TranscriptionHandler] Playing AI response to meeting ${meetingId}`);
  try {
    const audioKey = `tts/${callId}/${Date.now()}.wav`;
    const pollyResponse = await polly.send(new import_client_polly.SynthesizeSpeechCommand({
      Engine: "neural",
      OutputFormat: "pcm",
      Text: responseText,
      VoiceId: POLLY_VOICE_ID,
      SampleRate: "8000"
      // 8kHz for telephony
    }));
    if (!pollyResponse.AudioStream) {
      throw new Error("No audio stream from Polly");
    }
    const audioData = await streamToBuffer(pollyResponse.AudioStream);
    const wavData = pcmToWav(audioData, 8e3, 16, 1);
    await s3.send(new import_client_s3.PutObjectCommand({
      Bucket: TTS_BUCKET,
      Key: audioKey,
      Body: wavData,
      ContentType: "audio/wav"
    }));
    const audioUrl = `s3://${TTS_BUCKET}/${audioKey}`;
    console.log(`[TranscriptionHandler] Uploaded TTS audio: ${audioUrl}`);
    await chimeVoice.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
      SipMediaApplicationId: process.env.SIP_MEDIA_APPLICATION_ID,
      TransactionId: callId,
      Arguments: {
        action: "playAudio",
        audioUrl,
        meetingId
      }
    }));
    console.log(`[TranscriptionHandler] Sent PlayAudio command for call ${callId}`);
  } catch (error) {
    console.error(`[TranscriptionHandler] Error playing AI response:`, error);
  }
}
async function storeTranscriptForAnalytics(callId, meetingId, text, speaker) {
  console.log("[TRANSCRIPT]", JSON.stringify({
    callId,
    meetingId,
    speaker,
    text,
    timestamp: Date.now(),
    source: "meeting-transcription"
  }));
  try {
    await ddb.send(new import_lib_dynamodb.PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        callId,
        timestamp: Date.now(),
        meetingId,
        speaker,
        text,
        source: "meeting-transcription"
      }
    }));
  } catch (error) {
    console.warn(`[TranscriptionHandler] Failed to store transcript in DynamoDB:`, error);
  }
}
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function pcmToWav(pcmData, sampleRate, bitsPerSample, numChannels) {
  const dataSize = pcmData.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const wavBuffer = Buffer.alloc(totalSize);
  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(totalSize - 8, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(dataSize, 40);
  pcmData.copy(wavBuffer, 44);
  return wavBuffer;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handleTranscript,
  handler,
  invokeBedrockAgent,
  playAiResponseToMeeting
});

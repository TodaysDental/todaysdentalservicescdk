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

// src/services/chime/vc-streaming-event.ts
var vc_streaming_event_exports = {};
__export(vc_streaming_event_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(vc_streaming_event_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// src/services/chime/utils/media-pipeline-manager.ts
var import_client_chime_sdk_media_pipelines = require("@aws-sdk/client-chime-sdk-media-pipelines");
var import_client_ssm = require("@aws-sdk/client-ssm");
var import_client_kinesis_video = require("@aws-sdk/client-kinesis-video");
var CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || "us-east-1";
var mediaPipelinesClient = new import_client_chime_sdk_media_pipelines.ChimeSDKMediaPipelinesClient({ region: CHIME_MEDIA_REGION });
var ssmClient = new import_client_ssm.SSMClient({ region: CHIME_MEDIA_REGION });
var kinesisVideoClient = new import_client_kinesis_video.KinesisVideoClient({ region: CHIME_MEDIA_REGION });
var ENABLE_REAL_TIME_TRANSCRIPTION = process.env.ENABLE_REAL_TIME_TRANSCRIPTION === "true";
var MEDIA_INSIGHTS_PIPELINE_PARAMETER = process.env.MEDIA_INSIGHTS_PIPELINE_PARAMETER;
var cachedPipelineArn = null;
var pipelineArnCacheTime = 0;
var PIPELINE_ARN_CACHE_TTL_MS = 5 * 60 * 1e3;
var KVS_CACHE_TTL_MS = 60 * 1e3;
async function getMediaInsightsPipelineArn() {
  if (!MEDIA_INSIGHTS_PIPELINE_PARAMETER) {
    console.warn("[MediaPipeline] MEDIA_INSIGHTS_PIPELINE_PARAMETER not configured");
    return null;
  }
  const now = Date.now();
  if (cachedPipelineArn && now - pipelineArnCacheTime < PIPELINE_ARN_CACHE_TTL_MS) {
    return cachedPipelineArn;
  }
  try {
    const response = await ssmClient.send(new import_client_ssm.GetParameterCommand({
      Name: MEDIA_INSIGHTS_PIPELINE_PARAMETER
    }));
    cachedPipelineArn = response.Parameter?.Value || null;
    pipelineArnCacheTime = now;
    console.log("[MediaPipeline] Retrieved pipeline ARN from SSM");
    return cachedPipelineArn;
  } catch (error) {
    console.error("[MediaPipeline] Failed to get pipeline ARN from SSM:", {
      parameter: MEDIA_INSIGHTS_PIPELINE_PARAMETER,
      error: error.message
    });
    return null;
  }
}
async function startMediaPipelineFromKvsStream(params) {
  if (!ENABLE_REAL_TIME_TRANSCRIPTION) {
    console.log("[MediaPipeline] Real-time transcription is disabled");
    return null;
  }
  const { callId, meetingId, clinicId } = params;
  try {
    const pipelineConfigArn = await getMediaInsightsPipelineArn();
    if (!pipelineConfigArn) {
      console.warn("[MediaPipeline] Pipeline configuration ARN not available");
      return null;
    }
    const kvsStreamArn = params.kvsStreamArn;
    const fragmentNumber = params.startFragmentNumber;
    const participantRole = params.participantRole || "CUSTOMER";
    const mediaSampleRate = params.mediaSampleRate ?? parseInt(process.env.VC_MEDIA_SAMPLE_RATE || "8000", 10);
    console.log("[MediaPipeline] Starting Media Insights Pipeline from KVS stream:", {
      callId,
      clinicId,
      kvsStreamArn,
      fragmentNumber,
      participantRole,
      mediaSampleRate
    });
    const command = new import_client_chime_sdk_media_pipelines.CreateMediaInsightsPipelineCommand({
      MediaInsightsPipelineConfigurationArn: pipelineConfigArn,
      KinesisVideoStreamSourceRuntimeConfiguration: {
        MediaEncoding: "pcm",
        MediaSampleRate: mediaSampleRate,
        Streams: [
          {
            StreamArn: kvsStreamArn,
            FragmentNumber: fragmentNumber,
            StreamChannelDefinition: {
              NumberOfChannels: 1,
              ChannelDefinitions: [
                { ChannelId: 0, ParticipantRole: participantRole }
              ]
            }
          }
        ]
      },
      MediaInsightsRuntimeMetadata: {
        callId,
        clinicId,
        meetingId,
        agentId: params.agentId || "",
        customerPhone: params.customerPhone || "",
        direction: params.direction || "inbound",
        isAiCall: params.isAiCall ? "true" : "false",
        aiSessionId: params.aiSessionId || "",
        transactionId: callId,
        // Helpful for debugging voice connector streams
        kvsFragmentNumber: fragmentNumber || "",
        kvsParticipantRole: participantRole
      },
      Tags: [
        { Key: "CallId", Value: callId },
        { Key: "ClinicId", Value: clinicId },
        { Key: "MeetingId", Value: meetingId },
        { Key: "Type", Value: params.isAiCall ? "AiVoiceCall" : "RealTimeAnalytics" },
        { Key: "KvsRole", Value: participantRole },
        ...params.isAiCall ? [{ Key: "AiSessionId", Value: params.aiSessionId || "" }] : []
      ]
    });
    const response = await mediaPipelinesClient.send(command);
    const pipelineId = response.MediaInsightsPipeline?.MediaPipelineId;
    if (pipelineId) {
      console.log("[MediaPipeline] Media Insights Pipeline started successfully (KVS source):", {
        callId,
        pipelineId
      });
    } else {
      console.warn("[MediaPipeline] Pipeline created but no ID returned (KVS source)");
    }
    return pipelineId || null;
  } catch (error) {
    console.error("[MediaPipeline] Failed to start Media Insights Pipeline (KVS source):", {
      callId,
      meetingId,
      error: error.message,
      code: error.code
    });
    return null;
  }
}

// src/services/chime/vc-streaming-event.ts
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var START_MEDIA_PIPELINE_FROM_STREAMING_EVENT = process.env.START_MEDIA_PIPELINE_FROM_STREAMING_EVENT === "true";
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function findCallRecord(transactionId, vcCallId) {
  try {
    const result = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :id",
      ExpressionAttributeValues: { ":id": transactionId },
      Limit: 1
    }));
    if (result.Items?.[0])
      return result.Items[0];
  } catch (err) {
    console.warn("[VcStreamingEvent] Query by callId-index failed:", err?.message || err);
  }
  if (vcCallId) {
    try {
      const result = await ddb.send(new import_lib_dynamodb.QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: "pstnCallId-index",
        KeyConditionExpression: "pstnCallId = :pid",
        ExpressionAttributeValues: { ":pid": vcCallId },
        Limit: 1
      }));
      if (result.Items?.[0])
        return result.Items[0];
    } catch (err) {
      console.warn("[VcStreamingEvent] Query by pstnCallId-index failed:", err?.message || err);
    }
  }
  return null;
}
var handler = async (event) => {
  const detail = event.detail || {};
  const streamingStatus = detail.streamingStatus;
  console.log("[VcStreamingEvent] Event received", {
    streamingStatus,
    transactionId: detail.transactionId,
    vcCallId: detail.callId,
    voiceConnectorId: detail.voiceConnectorId,
    isCaller: detail.isCaller,
    direction: detail.direction,
    fromNumber: detail.fromNumber,
    toNumber: detail.toNumber,
    startFragmentNumber: detail.startFragmentNumber,
    streamArn: detail.streamArn,
    region: event.region,
    time: event.time
  });
  const transactionId = detail.transactionId;
  const streamArn = detail.streamArn;
  const startFragmentNumber = detail.startFragmentNumber;
  const vcCallId = detail.callId;
  if (streamingStatus !== "STARTED" && streamingStatus !== "FAILED") {
    return;
  }
  if (!transactionId) {
    console.warn("[VcStreamingEvent] Missing transactionId in streaming event", { streamingStatus, vcCallId, streamArn });
    return;
  }
  if (streamingStatus === "STARTED" && detail.isCaller === false) {
    console.log("[VcStreamingEvent] Ignoring non-caller stream for STARTED event", {
      transactionId,
      vcCallId,
      streamArn
    });
    return;
  }
  let callRecord = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    callRecord = await findCallRecord(transactionId, vcCallId);
    if (callRecord)
      break;
    await sleep(250);
  }
  if (!callRecord) {
    console.warn("[VcStreamingEvent] Call record not found for streaming STARTED event (skipping)", {
      transactionId,
      vcCallId,
      streamArn
    });
    return;
  }
  if (!callRecord.isAiCall) {
    return;
  }
  if (streamingStatus === "STARTED" && (callRecord.useDtmfFallback || callRecord.pipelineStatus === "fallback")) {
    console.log("[VcStreamingEvent] Call is in DTMF fallback; skipping pipeline start", {
      transactionId,
      vcCallId,
      pipelineStatus: callRecord.pipelineStatus,
      useDtmfFallback: callRecord.useDtmfFallback
    });
    return;
  }
  if (streamingStatus === "FAILED") {
    try {
      await ddb.send(new import_lib_dynamodb.UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: "SET pipelineStatus = :status, transcriptionEnabled = :f, useDtmfFallback = :t, pipelineError = :err",
        ExpressionAttributeValues: {
          ":status": "failed",
          ":f": false,
          ":t": true,
          ":err": JSON.stringify({ streamingStatus, detail })
        }
      }));
    } catch (err) {
      console.warn("[VcStreamingEvent] Failed to mark call for DTMF fallback after streaming FAILED:", err?.message || err);
    }
    return;
  }
  if (!streamArn) {
    console.warn("[VcStreamingEvent] Missing streamArn for STARTED event", { transactionId, vcCallId });
    return;
  }
  try {
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
      UpdateExpression: "SET kvsStreamArn = :kvsArn, kvsStartFragmentNumber = :frag, vcCallId = :vcCallId, vcStreamingStartTime = :vcStart",
      ExpressionAttributeValues: {
        ":kvsArn": streamArn,
        ":frag": startFragmentNumber || "",
        ":vcCallId": vcCallId || "",
        ":vcStart": detail.startTime || (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
  } catch (err) {
    console.warn("[VcStreamingEvent] Failed to persist stream details (non-fatal):", err?.message || err);
  }
  if (!START_MEDIA_PIPELINE_FROM_STREAMING_EVENT) {
    return;
  }
  if (callRecord.mediaPipelineId || callRecord.pipelineStatus === "active") {
    console.log("[VcStreamingEvent] Pipeline already active for call, skipping", {
      transactionId,
      mediaPipelineId: callRecord.mediaPipelineId,
      pipelineStatus: callRecord.pipelineStatus
    });
    return;
  }
  const participantRole = "CUSTOMER";
  const pipelineId = await startMediaPipelineFromKvsStream({
    callId: transactionId,
    meetingId: transactionId,
    // not a meeting; used for tags/metadata consistency
    clinicId: callRecord.clinicId,
    agentId: callRecord.aiAgentId || callRecord.assignedAgentId || "",
    customerPhone: callRecord.phoneNumber || callRecord.from || detail.fromNumber || "",
    direction: callRecord.direction || "inbound",
    isAiCall: true,
    aiSessionId: callRecord.aiSessionId,
    kvsStreamArn: streamArn,
    startFragmentNumber,
    participantRole,
    mediaSampleRate: 8e3
  });
  const update = async (status, extra) => {
    await ddb.send(new import_lib_dynamodb.UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: {
        clinicId: callRecord.clinicId,
        queuePosition: callRecord.queuePosition
      },
      UpdateExpression: [
        "SET pipelineStatus = :status",
        "kvsStreamArn = :kvsArn",
        "kvsStartFragmentNumber = :frag",
        "vcCallId = :vcCallId",
        "vcStreamingStartTime = :vcStart",
        ...status === "active" ? ["mediaPipelineId = :pid", "transcriptionEnabled = :t", "useDtmfFallback = :f"] : ["transcriptionEnabled = :f2", "useDtmfFallback = :t2"],
        ...extra?.pipelineError ? ["pipelineError = :perr"] : []
      ].join(", "),
      ExpressionAttributeValues: {
        ":status": status,
        ":kvsArn": streamArn,
        ":frag": startFragmentNumber || "",
        ":vcCallId": vcCallId || "",
        ":vcStart": detail.startTime || (/* @__PURE__ */ new Date()).toISOString(),
        ...status === "active" ? { ":pid": pipelineId, ":t": true, ":f": false } : { ":f2": false, ":t2": true },
        ...extra?.pipelineError ? { ":perr": extra.pipelineError } : {}
      }
    }));
  };
  if (pipelineId) {
    console.log("[VcStreamingEvent] Started Media Insights Pipeline for AI call", {
      transactionId,
      pipelineId,
      streamArn,
      startFragmentNumber,
      vcCallId
    });
    await update("active");
  } else {
    console.warn("[VcStreamingEvent] Failed to start Media Insights Pipeline for AI call; enabling DTMF fallback", {
      transactionId,
      streamArn,
      startFragmentNumber,
      vcCallId
    });
    await update("failed", { pipelineError: "CreateMediaInsightsPipeline returned null" });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

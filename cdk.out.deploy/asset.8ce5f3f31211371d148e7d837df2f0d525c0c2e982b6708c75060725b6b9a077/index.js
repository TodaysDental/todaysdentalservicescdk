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

// src/services/chime/transcribe-audio-segment.ts
var transcribe_audio_segment_exports = {};
__export(transcribe_audio_segment_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(transcribe_audio_segment_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client_polly = require("@aws-sdk/client-polly");
var import_client_transcribe_streaming = require("@aws-sdk/client-transcribe-streaming");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");

// src/services/chime/utils/sma-map-ssm.ts
var import_client_ssm = require("@aws-sdk/client-ssm");
var ssm = new import_client_ssm.SSMClient({});
var cachedMap;
var cacheExpiry = 0;
var CACHE_TTL = 5 * 60 * 1e3;
async function fetchSmaMapFromSSM() {
  const now = Date.now();
  if (cachedMap && now < cacheExpiry) {
    return cachedMap;
  }
  const env = process.env.ENVIRONMENT || "dev";
  const stackName = process.env.CHIME_STACK_NAME || "ChimeStack";
  const paramPaths = [
    process.env.SMA_ID_MAP_PARAMETER,
    // Set by ChimeStack for AI Transcript Bridge
    `/${stackName}/SmaIdMap`,
    // ChimeStack CDK-created parameter
    `/contactcenter/${env}/sma-map`
    // Legacy/alternative configuration
  ].filter(Boolean);
  for (const paramName of paramPaths) {
    try {
      const result = await ssm.send(new import_client_ssm.GetParameterCommand({
        Name: paramName,
        WithDecryption: true
      }));
      if (result.Parameter?.Value) {
        cachedMap = JSON.parse(result.Parameter.Value);
        cacheExpiry = now + CACHE_TTL;
        console.log(`[sma-map] Loaded SMA map from SSM: ${paramName}`);
        return cachedMap || {};
      }
    } catch (err) {
      if (err.name === "ParameterNotFound") {
        console.log(`[sma-map] Parameter ${paramName} not found, trying next...`);
        continue;
      }
      console.warn(`[sma-map] Error loading ${paramName}:`, err.message);
    }
  }
  const envMap = process.env.SMA_ID_MAP;
  if (envMap) {
    try {
      cachedMap = JSON.parse(envMap);
      cacheExpiry = now + CACHE_TTL;
      console.warn("[sma-map] Using SMA_ID_MAP from environment variable (consider moving to SSM)");
      return cachedMap;
    } catch (err) {
      console.error("[sma-map] Failed to parse SMA_ID_MAP:", err);
    }
  }
  console.error("[sma-map] No SMA map configuration found. Tried SSM paths:", paramPaths.join(", "));
  return void 0;
}
async function getSmaIdForClinicSSM(clinicId) {
  if (!clinicId)
    return void 0;
  const map = await fetchSmaMapFromSSM();
  return map ? map[clinicId] : void 0;
}

// src/services/chime/transcribe-audio-segment.ts
var s3Client = new import_client_s3.S3Client({});
var polly = new import_client_polly.PollyClient({ region: process.env.AWS_REGION || "us-east-1" });
var transcribeStreamingClient = new import_client_transcribe_streaming.TranscribeStreamingClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var lambdaClient = new import_client_lambda.LambdaClient({});
var chimeClient = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({
  region: process.env.CHIME_MEDIA_REGION || "us-east-1"
});
var CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME;
var VOICE_AI_LAMBDA_ARN = process.env.VOICE_AI_LAMBDA_ARN;
var HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET;
var POLLY_VOICE_ID = process.env.POLLY_VOICE_ID || "Joanna";
var POLLY_ENGINE = process.env.POLLY_ENGINE || "standard";
var VOICE_AI_TIMEOUT_MS = Number.parseInt(process.env.VOICE_AI_TIMEOUT_MS || "12000", 10);
var SAMPLE_RATE = 8e3;
var TTS_SAMPLE_RATE = 8e3;
var CHUNK_SIZE = 4096;
function parseRecordingKey(key) {
  const match = key.match(/ai-recordings\/([^/]+)\/([^/]+)\/([^/]+)\.(wav|mp3|ogg)/i);
  if (!match) {
    console.warn("[TranscribeStreaming] Could not parse recording key:", key);
    return null;
  }
  return {
    clinicId: match[1],
    callId: match[2],
    timestamp: match[3]
  };
}
async function getCallRecord(callId) {
  try {
    const result = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    return result.Items?.[0] || null;
  } catch (error) {
    console.error("[TranscribeStreaming] Error getting call record:", error);
    return null;
  }
}
async function downloadAudio(bucket, key) {
  const startTime = Date.now();
  const response = await s3Client.send(new import_client_s3.GetObjectCommand({
    Bucket: bucket,
    Key: key
  }));
  const chunks = [];
  const stream = response.Body;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  console.log(`[TranscribeStreaming] Downloaded audio in ${Date.now() - startTime}ms, size: ${buffer.length} bytes`);
  return buffer;
}
function extractPcmFromWav(wavBuffer) {
  let dataOffset = 44;
  for (let i = 0; i < Math.min(wavBuffer.length - 4, 100); i++) {
    if (wavBuffer.slice(i, i + 4).toString() === "data") {
      dataOffset = i + 8;
      break;
    }
  }
  return wavBuffer.slice(dataOffset);
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
async function synthesizeSpeechToS3(text, callId) {
  if (!HOLD_MUSIC_BUCKET) {
    throw new Error("HOLD_MUSIC_BUCKET is not configured");
  }
  const audioKey = `tts/${callId}/${Date.now()}.wav`;
  const pollyResponse = await polly.send(new import_client_polly.SynthesizeSpeechCommand({
    Engine: POLLY_ENGINE,
    OutputFormat: "pcm",
    Text: text,
    VoiceId: POLLY_VOICE_ID,
    SampleRate: `${TTS_SAMPLE_RATE}`
  }));
  if (!pollyResponse.AudioStream) {
    throw new Error("No audio stream returned from Polly");
  }
  const audioData = await streamToBuffer(pollyResponse.AudioStream);
  const wavData = pcmToWav(audioData, TTS_SAMPLE_RATE, 16, 1);
  await s3Client.send(new import_client_s3.PutObjectCommand({
    Bucket: HOLD_MUSIC_BUCKET,
    Key: audioKey,
    Body: wavData,
    ContentType: "audio/wav"
  }));
  return audioKey;
}
async function* createAudioStream(pcmData) {
  let offset = 0;
  while (offset < pcmData.length) {
    const chunk = pcmData.slice(offset, offset + CHUNK_SIZE);
    offset += CHUNK_SIZE;
    yield { AudioEvent: { AudioChunk: chunk } };
    const delayMs = Math.floor(chunk.length / SAMPLE_RATE / 2 * 1e3 * 0.5);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
async function transcribeWithStreaming(pcmData) {
  const startTime = Date.now();
  console.log(`[TranscribeStreaming] Starting streaming transcription, audio size: ${pcmData.length} bytes`);
  try {
    const response = await transcribeStreamingClient.send(
      new import_client_transcribe_streaming.StartStreamTranscriptionCommand({
        LanguageCode: import_client_transcribe_streaming.LanguageCode.EN_US,
        MediaEncoding: import_client_transcribe_streaming.MediaEncoding.PCM,
        MediaSampleRateHertz: SAMPLE_RATE,
        AudioStream: createAudioStream(pcmData)
      })
    );
    let fullTranscript = "";
    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent?.Transcript?.Results) {
          for (const result of event.TranscriptEvent.Transcript.Results) {
            if (!result.IsPartial && result.Alternatives?.[0]?.Transcript) {
              fullTranscript += result.Alternatives[0].Transcript + " ";
            }
          }
        }
      }
    }
    const transcript = fullTranscript.trim();
    console.log(`[TranscribeStreaming] Transcription completed in ${Date.now() - startTime}ms: "${transcript.substring(0, 100)}..."`);
    return transcript;
  } catch (error) {
    console.error("[TranscribeStreaming] Streaming transcription error:", error);
    throw error;
  }
}
async function invokeVoiceAiHandler(params) {
  if (!VOICE_AI_LAMBDA_ARN) {
    console.error("[TranscribeStreaming] VOICE_AI_LAMBDA_ARN not configured");
    return [];
  }
  const startTime = Date.now();
  try {
    const invokePromise = lambdaClient.send(new import_client_lambda.InvokeCommand({
      FunctionName: VOICE_AI_LAMBDA_ARN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({
        eventType: "TRANSCRIPT",
        callId: params.callId,
        clinicId: params.clinicId,
        transcript: params.transcript,
        sessionId: params.sessionId,
        aiAgentId: params.aiAgentId
      }))
    }));
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("VoiceAiTimeout")), VOICE_AI_TIMEOUT_MS);
    });
    const response = await Promise.race([invokePromise, timeoutPromise]);
    if (response.Payload) {
      const result = JSON.parse(Buffer.from(response.Payload).toString());
      console.log(`[TranscribeStreaming] Voice AI response in ${Date.now() - startTime}ms:`, result);
      return Array.isArray(result) ? result : [result];
    }
    return [];
  } catch (error) {
    if (error?.message === "VoiceAiTimeout") {
      console.warn("[TranscribeStreaming] Voice AI timed out, returning fallback response", {
        timeoutMs: VOICE_AI_TIMEOUT_MS
      });
      return [
        { action: "SPEAK", text: "One moment please while I check that." },
        { action: "CONTINUE" }
      ];
    }
    console.error("[TranscribeStreaming] Error invoking Voice AI:", error);
    return [];
  }
}
async function sendResponseToCall(callRecord, responses) {
  const clinicId = callRecord?.clinicId;
  const transactionId = callRecord?.transactionId || callRecord?.callId;
  const smaId = await getSmaIdForClinicSSM(clinicId);
  if (!smaId) {
    console.error("[TranscribeStreaming] No SMA ID found for clinic:", clinicId);
    return;
  }
  const callerCallId = callRecord?.pstnCallId || callRecord?.pstnLegCallId;
  console.log("[TranscribeStreaming] Building actions from Voice AI response", {
    responseCount: responses.length,
    actions: responses.map((r) => r.action),
    callerCallId
  });
  const actions = [];
  for (const response of responses) {
    switch (response.action) {
      case "SPEAK":
        if (response.text) {
          console.log("[TranscribeStreaming] Adding SPEAK action", {
            textLength: response.text.length,
            textPreview: response.text.substring(0, 50)
          });
          let ttsAction = null;
          if (HOLD_MUSIC_BUCKET) {
            try {
              const ttsKeyCallId = callRecord?.callId || transactionId || "unknown";
              const audioKey = await synthesizeSpeechToS3(response.text, ttsKeyCallId);
              ttsAction = {
                Type: "PlayAudio",
                Parameters: {
                  AudioSource: {
                    Type: "S3",
                    BucketName: HOLD_MUSIC_BUCKET,
                    Key: audioKey
                  },
                  PlaybackTerminators: ["#", "*"],
                  Repeat: 1,
                  ...callerCallId && { CallId: callerCallId }
                }
              };
            } catch (err) {
              console.error("[TranscribeStreaming] TTS synthesis failed, falling back to Speak", {
                error: err?.message || err
              });
            }
          }
          if (ttsAction) {
            actions.push(ttsAction);
          } else {
            actions.push({
              Type: "Speak",
              Parameters: {
                Text: response.text,
                Engine: POLLY_ENGINE,
                LanguageCode: "en-US",
                TextType: "text",
                VoiceId: POLLY_VOICE_ID
              }
            });
          }
        }
        break;
      case "HANG_UP":
        actions.push({
          Type: "Hangup",
          Parameters: {
            SipResponseCode: "0",
            ...callerCallId && { CallId: callerCallId }
          }
        });
        break;
      case "CONTINUE":
        const AI_RECORDINGS_BUCKET = process.env.AI_RECORDINGS_BUCKET;
        if (AI_RECORDINGS_BUCKET) {
          actions.push({
            Type: "RecordAudio",
            Parameters: {
              DurationInSeconds: 30,
              // Longer to capture full utterances
              SilenceDurationInSeconds: 3,
              // More time for user to think/respond
              SilenceThreshold: 100,
              // Lower = more sensitive to quiet speech (0-1000 range)
              RecordingTerminators: ["#"],
              RecordingDestination: {
                Type: "S3",
                BucketName: AI_RECORDINGS_BUCKET,
                Prefix: `ai-recordings/${clinicId}/${callRecord.callId}/`
              },
              ...callerCallId && { CallId: callerCallId }
            }
          });
        }
        break;
    }
  }
  if (actions.length === 0) {
    console.log("[TranscribeStreaming] No actions to send to call");
    return;
  }
  console.log(`[TranscribeStreaming] Sending ${actions.length} actions to call ${transactionId}`);
  try {
    await chimeClient.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
      SipMediaApplicationId: smaId,
      TransactionId: transactionId,
      Arguments: {
        // CRITICAL: pendingAiActions must contain CHIME SMA format actions
        // NOT the Voice AI response format. The inbound-router passes these
        // directly to Chime SDK which expects {Type: 'Speak', Parameters: {...}}
        pendingAiActions: JSON.stringify(actions),
        aiResponseTime: (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    console.log("[TranscribeStreaming] Successfully sent response to call");
  } catch (error) {
    if (error.name === "NotFoundException") {
      console.log("[TranscribeStreaming] Call has ended, skipping response (transaction no longer exists)");
      return;
    }
    console.error("[TranscribeStreaming] Error sending response to call:", error);
    throw error;
  }
}
async function processRecord(record) {
  const totalStartTime = Date.now();
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  console.log("[TranscribeStreaming] Processing recording:", { bucket, key });
  const metadata = parseRecordingKey(key);
  if (!metadata) {
    console.error("[TranscribeStreaming] Could not parse recording key, skipping");
    return;
  }
  const { clinicId, callId, timestamp } = metadata;
  const callRecord = await getCallRecord(callId);
  if (!callRecord) {
    console.error("[TranscribeStreaming] Call record not found:", callId);
    return;
  }
  try {
    const wavBuffer = await downloadAudio(bucket, key);
    const MIN_AUDIO_BYTES = 8e3;
    if (wavBuffer.length < MIN_AUDIO_BYTES) {
      console.log(`[TranscribeStreaming] Audio too short (${wavBuffer.length} bytes < ${MIN_AUDIO_BYTES}), sending continue action`);
      await sendResponseToCall(callRecord, [{ action: "CONTINUE" }]);
      return;
    }
    const pcmData = extractPcmFromWav(wavBuffer);
    const transcript = await transcribeWithStreaming(pcmData);
    if (!transcript || transcript.length < 2) {
      const emptyTranscriptCount = (callRecord.emptyTranscriptCount || 0) + 1;
      console.log("[TranscribeStreaming] Empty or too short transcript", {
        callId,
        emptyTranscriptCount,
        transcriptLength: transcript?.length || 0
      });
      try {
        await ddb.send(new import_lib_dynamodb.UpdateCommand({
          TableName: CALL_QUEUE_TABLE,
          Key: { clinicId, queuePosition: callRecord.queuePosition },
          UpdateExpression: "SET emptyTranscriptCount = :count",
          ExpressionAttributeValues: { ":count": emptyTranscriptCount }
        }));
      } catch (err) {
        console.warn("[TranscribeStreaming] Failed to update empty transcript count:", err);
      }
      const lastTimeoutFallback = callRecord.lastTimeoutFallbackTime || 0;
      const timeSinceTimeout = Date.now() - lastTimeoutFallback;
      const inTimeoutGracePeriod = lastTimeoutFallback > 0 && timeSinceTimeout < 3e4;
      if (emptyTranscriptCount >= 3 && emptyTranscriptCount % 3 === 0) {
        if (inTimeoutGracePeriod) {
          console.log("[TranscribeStreaming] Skipping silence prompt - within timeout grace period", {
            callId,
            timeSinceTimeout,
            emptyTranscriptCount
          });
          await sendResponseToCall(callRecord, [{ action: "CONTINUE" }]);
          return;
        }
        console.log("[TranscribeStreaming] Prompting caller after multiple silent recordings");
        await sendResponseToCall(callRecord, [
          { action: "SPEAK", text: "I'm sorry, I didn't hear anything. How may I help you today?" },
          { action: "CONTINUE" }
        ]);
        return;
      }
      await sendResponseToCall(callRecord, [{ action: "CONTINUE" }]);
      return;
    }
    try {
      await ddb.send(new import_lib_dynamodb.UpdateCommand({
        TableName: CALL_QUEUE_TABLE,
        Key: { clinicId, queuePosition: callRecord.queuePosition },
        UpdateExpression: "SET emptyTranscriptCount = :zero",
        ExpressionAttributeValues: { ":zero": 0 }
      }));
    } catch (err) {
    }
    console.log("[TranscribeStreaming] Got transcript:", {
      callId,
      transcriptLength: transcript.length,
      preview: transcript.substring(0, 100)
    });
    const aiResponses = await invokeVoiceAiHandler({
      callId,
      clinicId,
      transcript,
      sessionId: callRecord.aiSessionId || "",
      aiAgentId: callRecord.aiAgentId || ""
    });
    const isTimeoutFallback = aiResponses.length > 0 && aiResponses[0]?.action === "SPEAK" && aiResponses[0]?.text?.includes("One moment please");
    if (isTimeoutFallback) {
      console.log("[TranscribeStreaming] Voice AI timed out - setting fallback timestamp");
      try {
        await ddb.send(new import_lib_dynamodb.UpdateCommand({
          TableName: CALL_QUEUE_TABLE,
          Key: { clinicId, queuePosition: callRecord.queuePosition },
          UpdateExpression: "SET lastTimeoutFallbackTime = :time",
          ExpressionAttributeValues: { ":time": Date.now() }
        }));
      } catch (err) {
        console.warn("[TranscribeStreaming] Failed to update timeout fallback time:", err);
      }
    }
    if (aiResponses.length > 0) {
      await sendResponseToCall(callRecord, aiResponses);
    } else {
      await sendResponseToCall(callRecord, [{ action: "CONTINUE" }]);
    }
    console.log(`[TranscribeStreaming] Total processing time: ${Date.now() - totalStartTime}ms`);
  } catch (error) {
    if (error.name === "NotFoundException") {
      console.log("[TranscribeStreaming] Call ended before processing completed:", callId);
      return;
    }
    console.error("[TranscribeStreaming] Error processing recording:", {
      callId,
      error: error.message
    });
    try {
      await sendResponseToCall(callRecord, [
        { action: "SPEAK", text: "I apologize, I had trouble understanding. Could you please repeat that?" },
        { action: "CONTINUE" }
      ]);
    } catch (e) {
      if (e.name === "NotFoundException") {
        console.log("[TranscribeStreaming] Call ended during error recovery:", callId);
      } else {
        console.error("[TranscribeStreaming] Failed to send error recovery response:", e);
      }
    }
  }
}
var handler = async (event) => {
  console.log("[TranscribeStreaming] Received S3 event:", JSON.stringify(event, null, 2));
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error("[TranscribeStreaming] Error processing record:", error);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

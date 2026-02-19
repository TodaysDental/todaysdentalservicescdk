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

// src/services/chime/process-transcription.ts
var process_transcription_exports = {};
__export(process_transcription_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(process_transcription_exports);

// src/services/shared/utils/dynamodb-manager.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_https = require("https");
var DynamoDBManager = class _DynamoDBManager {
  constructor(config = {}) {
    this.requestCount = 0;
    this.lastResetTime = Date.now();
    this.warmed = false;
    const httpsAgent = new import_https.Agent({
      maxSockets: config.maxSockets || 50,
      keepAlive: true,
      keepAliveMsecs: 1e3,
      maxFreeSockets: 10,
      // Keep some connections ready
      timeout: 6e4,
      scheduling: "lifo"
      // Reuse recent connections first
    });
    const clientConfig = {
      maxAttempts: config.maxRetries || 3,
      requestHandler: {
        requestTimeout: config.requestTimeout || 3e3,
        connectionTimeout: config.connectionTimeout || 1e3,
        httpsAgent
      }
    };
    this.client = new import_client_dynamodb.DynamoDBClient(clientConfig);
    this.documentClient = import_lib_dynamodb.DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
      },
      unmarshallOptions: {
        wrapNumbers: false
      }
    });
    console.log("[DynamoDBManager] Initialized with optimized connection pooling");
    this.warmConnections();
  }
  /**
   * Warm DynamoDB connections on Lambda cold start
   * Makes a lightweight query to establish connection pool
   */
  async warmConnections() {
    if (this.warmed)
      return;
    try {
      await this.documentClient.send(new import_lib_dynamodb.GetCommand({
        TableName: process.env.AGENT_PRESENCE_TABLE_NAME || "warmup-dummy",
        Key: { agentId: "__warmup__" }
      })).catch(() => {
      });
      this.warmed = true;
      console.log("[DynamoDBManager] Connections warmed successfully");
    } catch (err) {
      console.warn("[DynamoDBManager] Connection warming failed (non-fatal):", err);
    }
  }
  static getInstance(config) {
    if (!_DynamoDBManager.instance) {
      _DynamoDBManager.instance = new _DynamoDBManager(config);
    }
    return _DynamoDBManager.instance;
  }
  getDocumentClient() {
    this.requestCount++;
    if (this.requestCount % 1e3 === 0) {
      const elapsed = Date.now() - this.lastResetTime;
      const rps = 1e3 / elapsed * 1e3;
      console.log(`[DynamoDBManager] Metrics: ${this.requestCount} requests, ~${rps.toFixed(2)} req/sec`);
    }
    return this.documentClient;
  }
  getMetrics() {
    const elapsed = Date.now() - this.lastResetTime;
    return {
      requestCount: this.requestCount,
      elapsedMs: elapsed,
      requestsPerSecond: this.requestCount / elapsed * 1e3
    };
  }
  resetMetrics() {
    this.requestCount = 0;
    this.lastResetTime = Date.now();
  }
};
function getDynamoDBClient(config) {
  return DynamoDBManager.getInstance(config).getDocumentClient();
}

// src/services/chime/process-transcription.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client_comprehend = require("@aws-sdk/client-comprehend");
var import_client_transcribe = require("@aws-sdk/client-transcribe");
var ddb = getDynamoDBClient();
var s3 = new import_client_s3.S3Client({});
var comprehend = new import_client_comprehend.ComprehendClient({});
var transcribe = new import_client_transcribe.TranscribeClient({});
var RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET_NAME;
var CALL_ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME || "";
var handler = async (event) => {
  console.log("[TranscriptionComplete] ===== START PROCESSING =====");
  console.log("[TranscriptionComplete] Event:", JSON.stringify(event, null, 2));
  const detail = event.detail;
  if (detail.TranscriptionJobStatus === "FAILED") {
    console.error("[TranscriptionComplete] Transcription job failed:", detail.TranscriptionJobName);
    return;
  }
  try {
    const jobName = detail.TranscriptionJobName;
    console.log("[TranscriptionComplete] Job name:", jobName);
    console.log("[TranscriptionComplete] Fetching transcription job details...");
    const getJobCommand = new import_client_transcribe.GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    });
    const jobResponse = await transcribe.send(getJobCommand);
    const transcriptUri = jobResponse.TranscriptionJob?.Transcript?.TranscriptFileUri;
    console.log("[TranscriptionComplete] Transcript URI:", transcriptUri);
    if (!transcriptUri) {
      console.error("[TranscriptionComplete] No transcript URI found in transcription job");
      return;
    }
    const recordingMetadata = await findRecordingByJobName(jobName);
    if (!recordingMetadata) {
      console.error("[TranscriptionComplete] \u274C CRITICAL: Recording metadata not found for job:", jobName);
      console.error("[TranscriptionComplete] This means post-call analytics cannot proceed");
      console.error("[TranscriptionComplete] Check if transcriptionJobName is being saved correctly in RecordingMetadata table");
      return;
    }
    console.log("[TranscriptionComplete] \u2705 Found recording metadata");
    console.log("[TranscriptionComplete] Processing transcription for call:", recordingMetadata.callId);
    console.log("[TranscriptionComplete] Agent ID:", recordingMetadata.agentId || "none");
    console.log("[TranscriptionComplete] Clinic ID:", recordingMetadata.clinicId);
    const transcript = await downloadTranscript(transcriptUri);
    if (!transcript) {
      console.error("[TranscriptionComplete] Failed to download transcript from:", transcriptUri);
      return;
    }
    console.log("[TranscriptionComplete] \u2705 Downloaded transcript, length:", transcript.length);
    await saveTranscriptText(recordingMetadata, transcript);
    console.log("[TranscriptionComplete] Starting sentiment analysis...");
    const sentimentResult = await analyzeSentiment(transcript);
    console.log("[TranscriptionComplete] \u2705 Sentiment analysis complete:", sentimentResult.sentiment);
    console.log("[TranscriptionComplete] Updating recording metadata...");
    await updateRecordingMetadata(recordingMetadata, sentimentResult);
    console.log("[TranscriptionComplete] \u2705 Recording metadata updated");
    console.log("[TranscriptionComplete] Updating call record...");
    await updateCallRecord(recordingMetadata.callId, sentimentResult);
    console.log("[TranscriptionComplete] \u2705 Call record updated");
    if (CALL_ANALYTICS_TABLE_NAME) {
      console.log("[TranscriptionComplete] Updating CallAnalytics table...");
      await updateCallAnalytics(recordingMetadata.callId, transcript, sentimentResult);
      console.log("[TranscriptionComplete] \u2705 CallAnalytics table updated");
    }
    if (recordingMetadata.agentId) {
      console.log("[TranscriptionComplete] Updating agent performance...");
      await updateAgentPerformance(
        recordingMetadata.agentId,
        recordingMetadata.clinicId,
        recordingMetadata.callId,
        sentimentResult
      );
      console.log("[TranscriptionComplete] \u2705 Agent performance updated");
    } else {
      console.warn("[TranscriptionComplete] No agent ID found, skipping agent performance update");
    }
    console.log("[TranscriptionComplete] \u2705 Successfully processed transcription for call:", recordingMetadata.callId);
    console.log("[TranscriptionComplete] ===== END PROCESSING =====");
  } catch (error) {
    console.error("[TranscriptionComplete] \u274C ERROR processing transcription:", error);
    console.error("[TranscriptionComplete] Error details:", JSON.stringify(error, null, 2));
    throw error;
  }
};
async function findRecordingByJobName(jobName) {
  try {
    console.log("[TranscriptionComplete] Querying by job name:", jobName);
    const result = await ddb.send(new import_lib_dynamodb2.QueryCommand({
      TableName: RECORDING_METADATA_TABLE,
      IndexName: "transcriptionJobName-index",
      KeyConditionExpression: "transcriptionJobName = :jobName",
      ExpressionAttributeValues: {
        ":jobName": jobName
      },
      Limit: 1
    }));
    if (result.Items?.[0]) {
      console.log("[TranscriptionComplete] Found recording via GSI");
      return result.Items[0];
    }
    const match = jobName.match(/^transcription-(.+?)-[a-f0-9]{8}$/);
    if (match) {
      const callId = match[1];
      console.log("[TranscriptionComplete] GSI returned no results, trying callId fallback:", callId);
      const callIdResult = await ddb.send(new import_lib_dynamodb2.QueryCommand({
        TableName: RECORDING_METADATA_TABLE,
        IndexName: "callId-index",
        KeyConditionExpression: "callId = :callId",
        ExpressionAttributeValues: {
          ":callId": callId
        },
        Limit: 1
      }));
      if (callIdResult.Items?.[0]) {
        console.log("[TranscriptionComplete] Found recording via callId fallback");
        return callIdResult.Items[0];
      }
    }
    console.error("[TranscriptionComplete] Recording not found via GSI or callId fallback");
    return null;
  } catch (error) {
    console.error("[TranscriptionComplete] Error finding recording by job name:", error);
    return null;
  }
}
async function downloadTranscript(transcriptUri) {
  try {
    let bucket;
    let key;
    const s3Match = transcriptUri.match(/s3:\/\/([^\/]+)\/(.+)/);
    if (s3Match) {
      [, bucket, key] = s3Match;
    } else {
      const httpsMatch = transcriptUri.match(/https:\/\/s3[.-]([^.]+)\.amazonaws\.com\/([^\/]+)\/(.+)/);
      if (httpsMatch) {
        [, , bucket, key] = httpsMatch;
      } else {
        console.error("[TranscriptionComplete] Invalid transcript URI format:", transcriptUri);
        console.error("[TranscriptionComplete] Expected s3:// or https://s3.*.amazonaws.com/ format");
        return null;
      }
    }
    console.log("[TranscriptionComplete] Downloading transcript from S3:", { bucket, key: key.substring(0, 50) + "..." });
    const response = await s3.send(new import_client_s3.GetObjectCommand({
      Bucket: bucket,
      Key: key
    }));
    const transcriptData = await response.Body?.transformToString();
    if (!transcriptData) {
      console.error("[TranscriptionComplete] Empty transcript data received");
      return null;
    }
    const parsed = JSON.parse(transcriptData);
    const transcript = parsed.results?.transcripts?.[0]?.transcript || "";
    console.log("[TranscriptionComplete] Extracted transcript, length:", transcript.length);
    return transcript;
  } catch (error) {
    console.error("[TranscriptionComplete] Error downloading transcript:", error);
    return null;
  }
}
async function analyzeSentiment(transcript) {
  try {
    const maxLength = 5e3;
    const chunks = [];
    if (transcript.length <= maxLength) {
      chunks.push(transcript);
    } else {
      const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [transcript];
      let currentChunk = "";
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxLength) {
          if (currentChunk)
            chunks.push(currentChunk);
          currentChunk = sentence;
        } else {
          currentChunk += sentence;
        }
      }
      if (currentChunk)
        chunks.push(currentChunk);
    }
    const results = await Promise.all(
      chunks.map(
        (chunk) => comprehend.send(new import_client_comprehend.DetectSentimentCommand({
          Text: chunk,
          LanguageCode: "en"
        }))
      )
    );
    const aggregateScores = results.reduce(
      (acc, result) => ({
        Positive: acc.Positive + (result.SentimentScore?.Positive || 0),
        Negative: acc.Negative + (result.SentimentScore?.Negative || 0),
        Neutral: acc.Neutral + (result.SentimentScore?.Neutral || 0),
        Mixed: acc.Mixed + (result.SentimentScore?.Mixed || 0)
      }),
      { Positive: 0, Negative: 0, Neutral: 0, Mixed: 0 }
    );
    const count = results.length;
    const scores = {
      Positive: aggregateScores.Positive / count,
      Negative: aggregateScores.Negative / count,
      Neutral: aggregateScores.Neutral / count,
      Mixed: aggregateScores.Mixed / count
    };
    const sentiment = Object.entries(scores).reduce(
      (a, b) => scores[a[0]] > scores[b[0]] ? a : b
    )[0].toUpperCase();
    const sentimentScore = Math.round(
      scores.Positive * 100 + scores.Neutral * 50 + scores.Mixed * 50
    );
    return { sentiment, sentimentScore, scores };
  } catch (error) {
    console.error("[TranscriptionComplete] Error analyzing sentiment:", error);
    return {
      sentiment: "NEUTRAL",
      sentimentScore: 50,
      scores: { Positive: 0, Negative: 0, Neutral: 1, Mixed: 0 }
    };
  }
}
async function saveTranscriptText(metadata, transcript) {
  try {
    await ddb.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: RECORDING_METADATA_TABLE,
      Key: {
        recordingId: metadata.recordingId,
        timestamp: metadata.timestamp
      },
      UpdateExpression: `
        SET transcriptText = :text,
            transcriptionCompletedAt = :now,
            transcriptionStatus = :status
      `,
      ExpressionAttributeValues: {
        ":text": transcript.substring(0, 1e4),
        // Limit to 10KB for DynamoDB
        ":now": (/* @__PURE__ */ new Date()).toISOString(),
        ":status": "COMPLETED"
      }
    }));
  } catch (error) {
    console.error("[TranscriptionComplete] Error saving transcript text:", error);
  }
}
async function updateRecordingMetadata(metadata, sentimentResult) {
  await ddb.send(new import_lib_dynamodb2.UpdateCommand({
    TableName: RECORDING_METADATA_TABLE,
    Key: {
      recordingId: metadata.recordingId,
      timestamp: metadata.timestamp
    },
    UpdateExpression: `
      SET sentiment = :sentiment,
          sentimentScore = :score,
          sentimentScores = :scores,
          sentimentAnalyzedAt = :now
    `,
    ExpressionAttributeValues: {
      ":sentiment": sentimentResult.sentiment,
      ":score": sentimentResult.sentimentScore,
      ":scores": sentimentResult.scores,
      ":now": (/* @__PURE__ */ new Date()).toISOString()
    }
  }));
}
async function updateCallRecord(callId, sentimentResult) {
  try {
    const result = await ddb.send(new import_lib_dynamodb2.QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: "pstnCallId-index",
      KeyConditionExpression: "pstnCallId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      Limit: 1
    }));
    const callRecord = result.Items?.[0];
    if (!callRecord) {
      console.warn("[TranscriptionComplete] Call record not found:", callId);
      return;
    }
    await ddb.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: {
        clinicId: callRecord.clinicId,
        queuePosition: callRecord.queuePosition
      },
      UpdateExpression: `
        SET sentiment = :sentiment,
            sentimentScore = :score,
            sentimentScores = :scores
      `,
      ExpressionAttributeValues: {
        ":sentiment": sentimentResult.sentiment,
        ":score": sentimentResult.sentimentScore,
        ":scores": sentimentResult.scores
      }
    }));
  } catch (error) {
    console.error("[TranscriptionComplete] Error updating call record:", error);
  }
}
async function updateCallAnalytics(callId, transcript, sentimentResult) {
  if (!CALL_ANALYTICS_TABLE_NAME)
    return;
  try {
    const queryResult = await ddb.send(new import_lib_dynamodb2.QueryCommand({
      TableName: CALL_ANALYTICS_TABLE_NAME,
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId },
      ScanIndexForward: false,
      Limit: 1
    }));
    const record = queryResult.Items?.[0];
    if (!record) {
      console.warn("[TranscriptionComplete] No CallAnalytics record found for callId:", callId);
      return;
    }
    const category = categorizeFromTranscript(transcript);
    await ddb.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE_NAME,
      Key: { callId: record.callId, timestamp: record.timestamp },
      UpdateExpression: `
        SET overallSentiment = :sentiment,
            sentimentScore = :sentimentScore,
            callCategory = if_not_exists(callCategory, :category),
            fullTranscript = :transcript,
            transcriptCount = if_not_exists(transcriptCount, :one),
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ":sentiment": sentimentResult.sentiment,
        ":sentimentScore": sentimentResult.sentimentScore,
        ":category": category,
        ":transcript": transcript.substring(0, 2e4),
        // Limit to 20KB
        ":one": 1,
        ":now": (/* @__PURE__ */ new Date()).toISOString()
      },
      // Only update sentiment/category if they are missing or default
      ConditionExpression: "attribute_exists(callId)"
    }));
    console.log(`[TranscriptionComplete] Updated CallAnalytics for ${callId}: sentiment=${sentimentResult.sentiment}, category=${category}`);
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      console.warn("[TranscriptionComplete] CallAnalytics record not found (condition failed):", callId);
      return;
    }
    console.error("[TranscriptionComplete] Error updating CallAnalytics:", error);
  }
}
function categorizeFromTranscript(transcript) {
  const lower = transcript.toLowerCase();
  const categories = [
    { keywords: ["appointment", "schedule", "book", "reschedule", "cancel appointment", "available time"], category: "scheduling" },
    { keywords: ["insurance", "coverage", "copay", "deductible", "claim", "in-network", "out-of-network"], category: "insurance" },
    { keywords: ["bill", "payment", "charge", "balance", "invoice", "pay", "cost", "price", "fee"], category: "billing" },
    { keywords: ["emergency", "pain", "urgent", "swelling", "bleeding", "broken tooth", "toothache"], category: "emergency" },
    { keywords: ["cleaning", "checkup", "exam", "x-ray", "filling", "crown", "root canal", "extraction"], category: "treatment" },
    { keywords: ["new patient", "first visit", "registration", "new here"], category: "new-patient" },
    { keywords: ["prescription", "medication", "antibiotic", "pain medication"], category: "prescription" },
    { keywords: ["referral", "specialist", "orthodontist", "oral surgeon", "periodontist"], category: "referral" }
  ];
  let bestCategory = "general-inquiry";
  let bestScore = 0;
  for (const { keywords, category } of categories) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw))
        score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestCategory;
}
async function updateAgentPerformance(agentId, clinicId, callId, sentimentResult) {
  try {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const existingRecord = await ddb.send(new import_lib_dynamodb2.GetCommand({
      TableName: AGENT_PERFORMANCE_TABLE_NAME,
      Key: {
        agentId,
        periodDate: today
      }
    }));
    const existing = existingRecord.Item;
    const sentimentIncrement = {
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0
    };
    sentimentIncrement[sentimentResult.sentiment.toLowerCase()] = 1;
    if (existing) {
      await ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: AGENT_PERFORMANCE_TABLE_NAME,
        Key: {
          agentId,
          periodDate: today
        },
        UpdateExpression: `
          SET sentimentScores.positive = sentimentScores.positive + :posInc,
              sentimentScores.neutral = sentimentScores.neutral + :neuInc,
              sentimentScores.negative = sentimentScores.negative + :negInc,
              sentimentScores.mixed = sentimentScores.mixed + :mixInc,
              averageSentiment = :newAvgSentiment,
              lastUpdated = :now,
              callIds = list_append(if_not_exists(callIds, :emptyList), :callId)
        `,
        ExpressionAttributeValues: {
          ":posInc": sentimentIncrement.positive,
          ":neuInc": sentimentIncrement.neutral,
          ":negInc": sentimentIncrement.negative,
          ":mixInc": sentimentIncrement.mixed,
          ":newAvgSentiment": calculateNewAverage(existing, sentimentResult.sentimentScore),
          ":now": (/* @__PURE__ */ new Date()).toISOString(),
          ":emptyList": [],
          ":callId": [callId]
        }
      }));
    } else {
      console.log("[TranscriptionComplete] Creating new performance record for agent:", agentId);
      await ddb.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: AGENT_PERFORMANCE_TABLE_NAME,
        Key: {
          agentId,
          periodDate: today
        },
        UpdateExpression: `
          SET clinicId = if_not_exists(clinicId, :clinicId),
              totalCalls = if_not_exists(totalCalls, :zero),
              inboundCalls = if_not_exists(inboundCalls, :zero),
              outboundCalls = if_not_exists(outboundCalls, :zero),
              sentimentScores = if_not_exists(sentimentScores, :initialSentiment),
              averageSentiment = :sentimentScore,
              lastUpdated = :now,
              callIds = if_not_exists(callIds, :emptyList)
        `,
        ExpressionAttributeValues: {
          ":clinicId": clinicId,
          ":zero": 0,
          ":initialSentiment": {
            positive: sentimentIncrement.positive,
            neutral: sentimentIncrement.neutral,
            negative: sentimentIncrement.negative,
            mixed: sentimentIncrement.mixed
          },
          ":sentimentScore": sentimentResult.sentimentScore,
          ":now": (/* @__PURE__ */ new Date()).toISOString(),
          ":emptyList": [callId]
        }
      }));
    }
    console.log("[TranscriptionComplete] Updated agent performance for:", agentId, "sentiment:", sentimentResult.sentiment);
  } catch (error) {
    console.error("[TranscriptionComplete] Error updating agent performance:", error);
  }
}
function calculateNewAverage(existing, newScore) {
  const totalCallsWithSentiment = (existing.sentimentScores?.positive || 0) + (existing.sentimentScores?.neutral || 0) + (existing.sentimentScores?.negative || 0) + (existing.sentimentScores?.mixed || 0);
  const currentTotal = (existing.averageSentiment || 50) * totalCallsWithSentiment;
  return Math.round((currentTotal + newScore) / (totalCallsWithSentiment + 1));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

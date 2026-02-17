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

// src/services/chime/process-recording.ts
var process_recording_exports = {};
__export(process_recording_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(process_recording_exports);

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

// src/services/shared/utils/recording-manager.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_transcribe = require("@aws-sdk/client-transcribe");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_crypto = require("crypto");
var import_crypto2 = require("crypto");
var transcribe = new import_client_transcribe.TranscribeClient({});
var s3 = new import_client_s3.S3Client({});
function generateRecordingId(callId, s3Key) {
  const hash = (0, import_crypto2.createHash)("sha256").update(`${callId}:${s3Key}`).digest("hex").substring(0, 16);
  return `rec-${callId}-${hash}`;
}
function extractCallIdFromKey(key) {
  const match = key.match(/recordings\/[^/]+\/([^/]+)\//);
  if (!match) {
    const filenameMatch = key.match(/([a-f0-9-]+)\.wav$/);
    if (filenameMatch) {
      console.log("[RecordingManager] Extracted callId from filename:", filenameMatch[1]);
      return filenameMatch[1];
    }
    console.error("[RecordingManager] Could not extract callId from key:", key);
    return null;
  }
  console.log("[RecordingManager] Extracted callId from path:", match[1]);
  return match[1];
}
function extractTransactionIdFromKey(key) {
  const filename = (key.split("/").pop() || "").trim();
  if (!filename)
    return null;
  const base = filename.toLowerCase().endsWith(".wav") ? filename.slice(0, -4) : filename;
  const parts = base.split("_");
  if (parts.length < 3)
    return null;
  const tx = (parts[parts.length - 2] || "").trim();
  if (!tx)
    return null;
  if (!/^[0-9a-fA-F-]{16,}$/.test(tx))
    return null;
  return tx;
}
async function processRecordingIdempotent(ddb2, metadataTableName, callQueueTableName, bucket, key) {
  const pstnCallId = extractCallIdFromKey(key);
  const transactionIdFromKey = extractTransactionIdFromKey(key);
  if (!pstnCallId) {
    console.error("[RecordingManager] Cannot extract callId from key:", key);
    return null;
  }
  const recordingId = generateRecordingId(pstnCallId, key);
  try {
    const { Item } = await ddb2.send(new import_lib_dynamodb2.GetCommand({
      TableName: metadataTableName,
      Key: { recordingId }
    }));
    if (Item) {
      console.log("[RecordingManager] Recording already processed:", recordingId);
      return Item;
    }
  } catch (err) {
  }
  const headResult = await s3.send(new import_client_s3.HeadObjectCommand({ Bucket: bucket, Key: key }));
  const fileSize = headResult.ContentLength || 0;
  const callRecord = await findCallByCallId(ddb2, callQueueTableName, pstnCallId);
  if (!callRecord) {
    console.warn("[RecordingManager] Call record not found for pstnCallId:", pstnCallId);
    console.warn("[RecordingManager] S3 key:", key);
    console.warn('[RecordingManager] This will cause clinicId to be set as "unknown"');
    console.warn("[RecordingManager] Possible causes: 1) Call record not created yet, 2) pstnCallId not stored in record, 3) Timing issue");
  } else {
    console.log("[RecordingManager] Found call record:", {
      callId: callRecord.callId,
      pstnCallId: callRecord.pstnCallId,
      clinicId: callRecord.clinicId,
      phoneNumber: callRecord.phoneNumber
    });
  }
  const queueEntryTime = callRecord?.queueEntryTime;
  const timestamp = typeof queueEntryTime === "number" ? queueEntryTime > 2e12 ? Math.floor(queueEntryTime / 1e3) : queueEntryTime : Math.floor(Date.now() / 1e3);
  const segmentMatch = key.match(/(\d+)_([^_]+)_[^/]+\.wav$/);
  const segmentTimestamp = segmentMatch ? parseInt(segmentMatch[1], 10) : timestamp;
  const segmentId = transactionIdFromKey || (segmentMatch ? segmentMatch[2] : "unknown");
  const resolvedAnalyticsCallId = typeof callRecord?.callId === "string" && callRecord.callId.trim() ? callRecord.callId.trim() : segmentId !== "unknown" ? segmentId : pstnCallId;
  const metadata = {
    recordingId,
    timestamp,
    // Store analytics callId (SMA TransactionId) for primary lookups from the UI.
    callId: resolvedAnalyticsCallId,
    // Store PSTN leg callId separately for debugging and backward compatibility.
    pstnCallId,
    clinicId: callRecord?.clinicId || "unknown",
    s3Bucket: bucket,
    s3Key: key,
    fileSize,
    format: headResult.ContentType || "audio/wav",
    uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
    agentId: callRecord?.assignedAgentId,
    ttl: Math.floor(Date.now() / 1e3) + 2555 * 24 * 60 * 60,
    // 7 years retention
    // Additional metadata for multi-segment tracking
    segmentTimestamp,
    segmentId,
    isMultiSegment: (callRecord?.recordingIds?.size || 0) > 0
  };
  try {
    await ddb2.send(new import_lib_dynamodb2.PutCommand({
      TableName: metadataTableName,
      Item: metadata,
      ConditionExpression: "attribute_not_exists(recordingId)"
    }));
    console.log("[RecordingManager] Stored recording metadata:", recordingId);
    if (callRecord) {
      await ddb2.send(new import_lib_dynamodb2.UpdateCommand({
        TableName: callQueueTableName,
        Key: {
          clinicId: callRecord.clinicId,
          queuePosition: callRecord.queuePosition
        },
        UpdateExpression: "ADD recordingIds :recordingId SET recordingCompleted = :true",
        ExpressionAttributeValues: {
          ":recordingId": /* @__PURE__ */ new Set([recordingId]),
          ":true": true
        }
      }));
    }
    return metadata;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      console.log("[RecordingManager] Duplicate prevented:", recordingId);
      const { Item } = await ddb2.send(new import_lib_dynamodb2.GetCommand({
        TableName: metadataTableName,
        Key: { recordingId }
      }));
      return Item;
    }
    throw err;
  }
}
async function findCallByCallId(ddb2, tableName, pstnCallId) {
  try {
    console.log("[RecordingManager] Querying for pstnCallId:", pstnCallId);
    console.log("[RecordingManager] Table:", tableName);
    const result = await ddb2.send(new import_lib_dynamodb2.QueryCommand({
      TableName: tableName,
      IndexName: "pstnCallId-index",
      KeyConditionExpression: "pstnCallId = :pstnCallId",
      ExpressionAttributeValues: { ":pstnCallId": pstnCallId },
      Limit: 1
    }));
    console.log("[RecordingManager] Query returned", result.Items?.length || 0, "items");
    if (result.Items && result.Items.length > 0) {
      console.log("[RecordingManager] Found call record with clinicId:", result.Items[0].clinicId);
    } else {
      console.warn("[RecordingManager] No call record found for pstnCallId:", pstnCallId);
      console.warn("[RecordingManager] This may indicate the call record was not created yet or pstnCallId was not stored");
    }
    return result.Items?.[0] || null;
  } catch (err) {
    console.error("[RecordingManager] Error finding call by pstnCallId:", pstnCallId, "Error:", err);
    return null;
  }
}
async function startTranscription(ddb2, metadataTableName, metadata, outputBucket, options) {
  const jobName = `transcription-${metadata.callId}-${(0, import_crypto.randomUUID)().substring(0, 8)}`;
  console.log("[RecordingManager] Starting transcription:", jobName);
  const languageCode = options?.languageCode || process.env.DEFAULT_LANGUAGE_CODE || "en-US";
  const identifyLanguage = options?.identifyLanguage || false;
  const languageOptions = options?.languageOptions || ["en-US", "es-US", "fr-CA"];
  const settings = {
    ShowSpeakerLabels: true,
    MaxSpeakerLabels: 2,
    ChannelIdentification: true
  };
  if (options?.vocabularyName && !identifyLanguage) {
    settings.VocabularyName = options.vocabularyName;
  }
  const baseCommand = {
    TranscriptionJobName: jobName,
    MediaFormat: "wav",
    Media: {
      MediaFileUri: `s3://${metadata.s3Bucket}/${metadata.s3Key}`
    },
    OutputBucketName: outputBucket,
    OutputKey: `transcriptions/${metadata.callId}/${jobName}/`,
    // Add tags for tracking
    Tags: [
      { Key: "callId", Value: metadata.callId },
      { Key: "recordingId", Value: metadata.recordingId },
      { Key: "clinicId", Value: metadata.clinicId },
      { Key: "languageCode", Value: languageCode }
    ]
  };
  if (identifyLanguage) {
    baseCommand.IdentifyLanguage = true;
    baseCommand.LanguageOptions = languageOptions;
  } else {
    baseCommand.LanguageCode = languageCode;
  }
  const startJob = async (settingsOverride) => {
    const command = {
      ...baseCommand,
      Settings: settingsOverride
    };
    await transcribe.send(new import_client_transcribe.StartTranscriptionJobCommand(command));
    await ddb2.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: metadataTableName,
      Key: {
        recordingId: metadata.recordingId,
        timestamp: metadata.timestamp
        // Required - table has composite key
      },
      UpdateExpression: `
        SET transcriptionJobName = :jobName, 
            transcriptionStatus = :status, 
            transcriptionStartedAt = :now
      `,
      ExpressionAttributeValues: {
        ":jobName": jobName,
        ":status": "IN_PROGRESS",
        ":now": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    console.log("[RecordingManager] \u2705 Transcription job started successfully");
    console.log("[RecordingManager] Job name:", jobName);
    console.log("[RecordingManager] Recording ID:", metadata.recordingId);
    console.log("[RecordingManager] Call ID:", metadata.callId);
    console.log("[RecordingManager] Saved transcriptionJobName to DynamoDB for EventBridge lookup");
  };
  try {
    await startJob({ ...settings });
  } catch (err) {
    const message = err?.message || "";
    const isVocabularyNotReady = err?.name === "BadRequestException" && settings?.VocabularyName && /vocabulary/i.test(message) && /ready/i.test(message);
    if (isVocabularyNotReady) {
      console.warn("[RecordingManager] Vocabulary not READY - retrying without custom vocabulary", {
        vocabularyName: settings.VocabularyName,
        jobName
      });
      const fallbackSettings = { ...settings };
      delete fallbackSettings.VocabularyName;
      try {
        await startJob(fallbackSettings);
        return;
      } catch (retryErr) {
        console.error("[RecordingManager] Retry without vocabulary failed:", retryErr?.message || retryErr);
        err = retryErr;
      }
    }
    if (err.name === "ConflictException") {
      console.warn("[RecordingManager] Transcription job already exists:", jobName);
      return;
    }
    console.error("[RecordingManager] Transcription failed:", err);
    await ddb2.send(new import_lib_dynamodb2.UpdateCommand({
      TableName: metadataTableName,
      Key: {
        recordingId: metadata.recordingId,
        timestamp: metadata.timestamp
        // Required - table has composite key
      },
      UpdateExpression: "SET transcriptionStatus = :status, transcriptionError = :error",
      ExpressionAttributeValues: {
        ":status": "FAILED",
        ":error": err.message
      }
    }));
    throw err;
  }
}

// src/services/shared/utils/error-tracker.ts
var import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");
var import_client_sns = require("@aws-sdk/client-sns");
var ErrorTracker = class {
  constructor(options = {}) {
    this.errorBuffer = [];
    this.cloudwatch = new import_client_cloudwatch.CloudWatchClient({});
    this.sns = new import_client_sns.SNSClient({});
    this.alertTopicArn = options.alertTopicArn || process.env.ERROR_ALERT_TOPIC_ARN;
    this.namespace = options.namespace || "ContactCenter/Errors";
  }
  /**
   * Track an error with specified severity
   * Automatically publishes metrics and sends alerts for HIGH/CRITICAL errors
   */
  async trackError(operation, error, severity = "MEDIUM", metadata) {
    const errorEntry = {
      operation,
      error: error.message,
      severity,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      metadata,
      stack: error.stack
    };
    this.errorBuffer.push(errorEntry);
    console.error(`[ErrorTracker] ${severity}: ${operation}`, {
      message: error.message,
      metadata,
      stack: error.stack
    });
    this.publishMetric(operation, severity).catch((err) => {
      console.error("[ErrorTracker] Failed to publish metric:", err);
    });
    if ((severity === "HIGH" || severity === "CRITICAL") && this.alertTopicArn) {
      await this.sendAlert(errorEntry).catch((err) => {
        console.error("[ErrorTracker] Failed to send alert:", err);
      });
    }
  }
  /**
   * Publish error metric to CloudWatch
   */
  async publishMetric(operation, severity) {
    try {
      await this.cloudwatch.send(new import_client_cloudwatch.PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: "ErrorCount",
            Value: 1,
            Unit: "Count",
            Timestamp: /* @__PURE__ */ new Date(),
            Dimensions: [
              { Name: "Operation", Value: operation },
              { Name: "Severity", Value: severity }
            ]
          }
        ]
      }));
    } catch (err) {
      console.error("[ErrorTracker] Metric publish failed:", err);
    }
  }
  /**
   * Send alert via SNS for critical errors
   */
  async sendAlert(errorEntry) {
    if (!this.alertTopicArn) {
      console.warn("[ErrorTracker] No alert topic ARN configured, skipping alert");
      return;
    }
    try {
      await this.sns.send(new import_client_sns.PublishCommand({
        TopicArn: this.alertTopicArn,
        Subject: `[${errorEntry.severity}] Call Center Error: ${errorEntry.operation}`,
        Message: JSON.stringify({
          severity: errorEntry.severity,
          operation: errorEntry.operation,
          error: errorEntry.error,
          timestamp: errorEntry.timestamp,
          metadata: errorEntry.metadata,
          stack: errorEntry.stack
        }, null, 2)
      }));
    } catch (err) {
      console.error("[ErrorTracker] Failed to send SNS alert:", err);
    }
  }
  /**
   * Track a successful operation (for monitoring success rate)
   */
  async trackSuccess(operation, metadata) {
    console.log(`[ErrorTracker] SUCCESS: ${operation}`, metadata);
    try {
      await this.cloudwatch.send(new import_client_cloudwatch.PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: "SuccessCount",
            Value: 1,
            Unit: "Count",
            Timestamp: /* @__PURE__ */ new Date(),
            Dimensions: [
              { Name: "Operation", Value: operation }
            ]
          }
        ]
      }));
    } catch (err) {
      console.error("[ErrorTracker] Success metric publish failed:", err);
    }
  }
  /**
   * Get buffered errors (useful for debugging)
   */
  getBufferedErrors() {
    return [...this.errorBuffer];
  }
  /**
   * Clear error buffer
   */
  clearBuffer() {
    this.errorBuffer = [];
  }
  /**
   * Flush buffered errors to logs
   */
  async flush() {
    if (this.errorBuffer.length > 0) {
      console.log(`[ErrorTracker] Flushing ${this.errorBuffer.length} buffered errors`);
      const bySeverity = this.errorBuffer.reduce((acc, err) => {
        acc[err.severity] = (acc[err.severity] || 0) + 1;
        return acc;
      }, {});
      console.log("[ErrorTracker] Error summary:", bySeverity);
      this.clearBuffer();
    }
  }
};
var globalErrorTracker = null;
function getErrorTracker() {
  if (!globalErrorTracker) {
    globalErrorTracker = new ErrorTracker();
  }
  return globalErrorTracker;
}

// src/services/shared/utils/agent-performance-tracker.ts
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
function getDateInTimezone(timestamp, timezone = "UTC") {
  try {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch (err) {
    console.warn("[getDateInTimezone] Invalid timezone, falling back to UTC:", timezone);
    return new Date(timestamp).toISOString().split("T")[0];
  }
}
async function trackCallCompletion(ddb2, tableName, metrics, sentiment) {
  try {
    const timezone = metrics.timezone || "UTC";
    const periodDate = getDateInTimezone(metrics.startTime, timezone);
    console.log("[AgentPerformanceTracker] Tracking call completion:", {
      agentId: metrics.agentId,
      callId: metrics.callId,
      direction: metrics.direction,
      wasCompleted: metrics.wasCompleted
    });
    const totalCallsIncrement = 1;
    const inboundIncrement = metrics.direction === "inbound" ? 1 : 0;
    const outboundIncrement = metrics.direction === "outbound" ? 1 : 0;
    const missedIncrement = metrics.wasMissed ? 1 : 0;
    const rejectedIncrement = metrics.wasRejected ? 1 : 0;
    const transferredIncrement = metrics.wasTransferred ? 1 : 0;
    const completedIncrement = metrics.wasCompleted ? 1 : 0;
    const talkTimeIncrement = metrics.talkTime || 0;
    const holdTimeIncrement = metrics.holdTime || 0;
    const handleTimeIncrement = metrics.totalDuration || 0;
    const sentimentIncrements = {};
    if (sentiment) {
      switch (sentiment.sentiment.toUpperCase()) {
        case "POSITIVE":
          sentimentIncrements[":sentimentPositiveInc"] = 1;
          sentimentIncrements[":sentimentNeutralInc"] = 0;
          sentimentIncrements[":sentimentNegativeInc"] = 0;
          sentimentIncrements[":sentimentMixedInc"] = 0;
          break;
        case "NEUTRAL":
          sentimentIncrements[":sentimentPositiveInc"] = 0;
          sentimentIncrements[":sentimentNeutralInc"] = 1;
          sentimentIncrements[":sentimentNegativeInc"] = 0;
          sentimentIncrements[":sentimentMixedInc"] = 0;
          break;
        case "NEGATIVE":
          sentimentIncrements[":sentimentPositiveInc"] = 0;
          sentimentIncrements[":sentimentNeutralInc"] = 0;
          sentimentIncrements[":sentimentNegativeInc"] = 1;
          sentimentIncrements[":sentimentMixedInc"] = 0;
          break;
        case "MIXED":
          sentimentIncrements[":sentimentPositiveInc"] = 0;
          sentimentIncrements[":sentimentNeutralInc"] = 0;
          sentimentIncrements[":sentimentNegativeInc"] = 0;
          sentimentIncrements[":sentimentMixedInc"] = 1;
          break;
        default:
          sentimentIncrements[":sentimentPositiveInc"] = 0;
          sentimentIncrements[":sentimentNeutralInc"] = 1;
          sentimentIncrements[":sentimentNegativeInc"] = 0;
          sentimentIncrements[":sentimentMixedInc"] = 0;
      }
    } else {
      sentimentIncrements[":sentimentPositiveInc"] = 0;
      sentimentIncrements[":sentimentNeutralInc"] = 1;
      sentimentIncrements[":sentimentNegativeInc"] = 0;
      sentimentIncrements[":sentimentMixedInc"] = 0;
    }
    try {
      await ddb2.send(new import_lib_dynamodb3.UpdateCommand({
        TableName: tableName,
        Key: {
          agentId: metrics.agentId,
          periodDate
        },
        UpdateExpression: `
          SET clinicId = if_not_exists(clinicId, :clinicId),
              lastUpdated = :now,
              callIds = list_append(if_not_exists(callIds, :emptyList), :callId)
          ADD totalCalls :totalInc,
              inboundCalls :inboundInc,
              outboundCalls :outboundInc,
              missedCalls :missedInc,
              rejectedCalls :rejectedInc,
              callsTransferred :transferredInc,
              callsCompleted :completedInc,
              totalTalkTime :talkTimeInc,
              totalHoldTime :holdTimeInc,
              totalHandleTime :handleTimeInc,
              sentimentScores.positive :sentimentPositiveInc,
              sentimentScores.neutral :sentimentNeutralInc,
              sentimentScores.negative :sentimentNegativeInc,
              sentimentScores.mixed :sentimentMixedInc
        `,
        // CRITICAL FIX #2: Add condition to prevent duplicate call tracking
        ConditionExpression: "NOT contains(callIds, :callIdStr)",
        ExpressionAttributeValues: {
          ":clinicId": metrics.clinicId,
          ":totalInc": totalCallsIncrement,
          ":inboundInc": inboundIncrement,
          ":outboundInc": outboundIncrement,
          ":missedInc": missedIncrement,
          ":rejectedInc": rejectedIncrement,
          ":transferredInc": transferredIncrement,
          ":completedInc": completedIncrement,
          ":talkTimeInc": talkTimeIncrement,
          ":holdTimeInc": holdTimeIncrement,
          ":handleTimeInc": handleTimeIncrement,
          ...sentimentIncrements,
          ":now": (/* @__PURE__ */ new Date()).toISOString(),
          ":emptyList": [],
          ":callId": [metrics.callId],
          ":callIdStr": metrics.callId
          // For condition check
        }
      }));
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        console.log("[AgentPerformanceTracker] Duplicate call detected, skipping:", {
          callId: metrics.callId,
          agentId: metrics.agentId,
          periodDate
        });
        return;
      }
      throw err;
    }
    await recalculateDerivedMetrics(ddb2, tableName, metrics.agentId, periodDate);
    console.log("[AgentPerformanceTracker] Updated performance metrics for agent:", metrics.agentId);
  } catch (error) {
    console.error("[AgentPerformanceTracker] Error tracking call completion:", error);
    throw error;
  }
}
async function recalculateDerivedMetrics(ddb2, tableName, agentId, periodDate) {
  try {
    const result = await ddb2.send(new import_lib_dynamodb3.GetCommand({
      TableName: tableName,
      Key: { agentId, periodDate }
    }));
    if (!result.Item) {
      console.warn("[AgentPerformanceTracker] No record found for derived metrics calculation");
      return;
    }
    const data = result.Item;
    const totalCalls = data.totalCalls || 0;
    const averageHandleTime = totalCalls > 0 ? Math.round((data.totalHandleTime || 0) / totalCalls) : 0;
    const averageTalkTime = totalCalls > 0 ? Math.round((data.totalTalkTime || 0) / totalCalls) : 0;
    const callsCompleted = data.callsCompleted || 0;
    const callsRejected = data.rejectedCalls || 0;
    const callsTransferred = data.callsTransferred || 0;
    const completionRate = totalCalls > 0 ? callsCompleted / totalCalls * 100 : 0;
    const rejectionRate = totalCalls > 0 ? callsRejected / totalCalls * 100 : 0;
    const fcrRate = callsCompleted > 0 ? (callsCompleted - callsTransferred) / callsCompleted * 100 : 0;
    const sentimentScores = data.sentimentScores || { positive: 0, neutral: 0, negative: 0, mixed: 0 };
    const totalSentimentCalls = sentimentScores.positive + sentimentScores.neutral + sentimentScores.negative + sentimentScores.mixed;
    const averageSentiment = totalSentimentCalls > 0 ? (sentimentScores.positive * 100 + sentimentScores.neutral * 50 + sentimentScores.mixed * 50) / totalSentimentCalls : 50;
    const ahtScore = Math.max(0, Math.min(100, 100 - (averageHandleTime - 600) / 10));
    const transferRate = callsCompleted > 0 ? callsTransferred / callsCompleted * 100 : 0;
    const transferScore = Math.max(0, 100 - transferRate);
    const performanceScore = Math.round(
      completionRate * 0.3 + (100 - rejectionRate) * 0.15 + averageSentiment * 0.3 + ahtScore * 0.15 + transferScore * 0.1
    );
    await ddb2.send(new import_lib_dynamodb3.UpdateCommand({
      TableName: tableName,
      Key: { agentId, periodDate },
      UpdateExpression: `
        SET averageHandleTime = :avgHandleTime,
            averageTalkTime = :avgTalkTime,
            averageSentiment = :avgSentiment,
            firstCallResolutionRate = :fcrRate,
            performanceScore = :perfScore,
            completionRate = :completionRate,
            rejectionRate = :rejectionRate,
            transferRate = :transferRate
      `,
      ExpressionAttributeValues: {
        ":avgHandleTime": averageHandleTime,
        ":avgTalkTime": averageTalkTime,
        ":avgSentiment": averageSentiment,
        ":fcrRate": fcrRate,
        ":perfScore": performanceScore,
        ":completionRate": completionRate,
        ":rejectionRate": rejectionRate,
        ":transferRate": transferRate
      }
    }));
  } catch (error) {
    console.error("[AgentPerformanceTracker] Error recalculating derived metrics:", error);
  }
}
function extractCallMetrics(callRecord) {
  if (!callRecord.assignedAgentId) {
    return null;
  }
  let startTime;
  if (callRecord.queueEntryTimeIso) {
    startTime = callRecord.queueEntryTimeIso;
  } else if (callRecord.queueEntryTime) {
    const timestamp = typeof callRecord.queueEntryTime === "number" ? callRecord.queueEntryTime : parseInt(callRecord.queueEntryTime, 10);
    startTime = new Date(timestamp < 1262304e6 ? timestamp * 1e3 : timestamp).toISOString();
  } else {
    startTime = (/* @__PURE__ */ new Date()).toISOString();
  }
  let endTime;
  if (callRecord.endedAtIso) {
    endTime = callRecord.endedAtIso;
  } else if (callRecord.endTime) {
    const timestamp = typeof callRecord.endTime === "number" ? callRecord.endTime : parseInt(callRecord.endTime, 10);
    endTime = new Date(timestamp < 1262304e6 ? timestamp * 1e3 : timestamp).toISOString();
  } else {
    endTime = (/* @__PURE__ */ new Date()).toISOString();
  }
  let totalDuration = 0;
  if (callRecord.endTime && callRecord.queueEntryTime) {
    const end = typeof callRecord.endTime === "number" ? callRecord.endTime : parseInt(callRecord.endTime, 10);
    const start = typeof callRecord.queueEntryTime === "number" ? callRecord.queueEntryTime : parseInt(callRecord.queueEntryTime, 10);
    totalDuration = Math.max(0, end - start);
  }
  const talkTime = callRecord.talkDuration || 0;
  const holdTime = callRecord.holdDuration || 0;
  return {
    callId: callRecord.callId,
    agentId: callRecord.assignedAgentId,
    clinicId: callRecord.clinicId,
    direction: callRecord.direction || "inbound",
    totalDuration,
    talkTime,
    holdTime,
    wasCompleted: callRecord.status === "completed",
    wasTransferred: callRecord.wasTransferred || !!callRecord.transferredToAgentId || false,
    wasRejected: callRecord.status === "rejected",
    wasMissed: callRecord.status === "abandoned" || callRecord.status === "missed",
    startTime,
    endTime
  };
}

// src/services/chime/process-recording.ts
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var ddb = getDynamoDBClient();
var errorTracker = getErrorTracker();
var RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME;
var RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET_NAME;
var AUTO_TRANSCRIBE = process.env.AUTO_TRANSCRIBE_RECORDINGS === "true";
var handler = async (event) => {
  console.log(`[RecordingProcessor] Processing ${event.Records.length} S3 events`);
  for (const record of event.Records) {
    try {
      await processRecordingEvent(record);
    } catch (err) {
      console.error("[RecordingProcessor] Error processing recording:", err);
      await errorTracker.trackError(
        "process_recording",
        err,
        "HIGH",
        {
          bucket: record.s3.bucket.name,
          key: record.s3.object.key
        }
      );
    }
  }
  await errorTracker.flush();
};
async function processRecordingEvent(record) {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  console.log(`[RecordingProcessor] Processing recording: s3://${bucket}/${key}`);
  if (!key.startsWith("recordings/")) {
    console.log("[RecordingProcessor] Skipping non-recording file:", key);
    return;
  }
  if (key.includes("/transcriptions/")) {
    console.log("[RecordingProcessor] Skipping transcription output:", key);
    return;
  }
  const metadata = await processRecordingIdempotent(
    ddb,
    RECORDING_METADATA_TABLE,
    CALL_QUEUE_TABLE_NAME,
    bucket,
    key
  );
  if (!metadata) {
    console.warn("[RecordingProcessor] Could not process recording metadata");
    return;
  }
  if (AUTO_TRANSCRIBE && metadata.fileSize && metadata.fileSize > 0) {
    try {
      const vocabularyName = process.env.MEDICAL_VOCABULARY_NAME;
      const enableLanguageId = process.env.ENABLE_LANGUAGE_IDENTIFICATION === "true";
      await startTranscription(
        ddb,
        RECORDING_METADATA_TABLE,
        metadata,
        RECORDINGS_BUCKET,
        {
          vocabularyName,
          identifyLanguage: enableLanguageId,
          languageOptions: ["en-US", "es-US", "fr-CA"]
          // English, Spanish, French
        }
      );
    } catch (err) {
      console.error("[RecordingProcessor] Transcription failed:", err);
      await errorTracker.trackError(
        "start_transcription",
        err,
        "MEDIUM",
        { recordingId: metadata.recordingId }
      );
    }
  }
  if (metadata.agentId) {
    try {
      const callRecord = await getCallRecord(metadata.pstnCallId || metadata.callId);
      if (callRecord) {
        const callMetrics = extractCallMetrics(callRecord);
        if (callMetrics) {
          const sentiment = callRecord.overallSentiment && callRecord.averageSentiment ? {
            sentiment: callRecord.overallSentiment,
            score: callRecord.averageSentiment
          } : void 0;
          await trackCallCompletion(
            ddb,
            AGENT_PERFORMANCE_TABLE_NAME,
            callMetrics,
            sentiment
            // Pass sentiment data
          );
          console.log("[RecordingProcessor] Updated agent performance for:", {
            agentId: metadata.agentId,
            hasSentiment: !!sentiment
          });
        }
      }
    } catch (err) {
      console.error("[RecordingProcessor] Failed to track agent performance:", err);
    }
  }
  console.log("[RecordingProcessor] Recording processed successfully:", metadata.recordingId);
}
async function getCallRecord(pstnCallId) {
  try {
    const result = await ddb.send(new import_lib_dynamodb4.QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: "pstnCallId-index",
      KeyConditionExpression: "pstnCallId = :pstnCallId",
      ExpressionAttributeValues: {
        ":pstnCallId": pstnCallId
      },
      Limit: 1
    }));
    return result.Items?.[0] || null;
  } catch (err) {
    console.error("[RecordingProcessor] Error getting call record:", err);
    return null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

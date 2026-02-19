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

// src/services/chime/inbound-router.ts
var inbound_router_exports = {};
__export(inbound_router_exports, {
  __test: () => __test,
  handler: () => handler
});
module.exports = __toCommonJS(inbound_router_exports);
var import_client_dynamodb3 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb12 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_meetings2 = require("@aws-sdk/client-chime-sdk-meetings");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client_polly2 = require("@aws-sdk/client-polly");

// src/services/chime/utils/agent-selection.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
async function enrichCallContext(ddb2, callId, clinicId, phoneNumber, callQueueTableName, vipPhoneNumbers = /* @__PURE__ */ new Set()) {
  const context = {
    callId,
    clinicId,
    phoneNumber,
    priority: "normal",
    isVip: false,
    isCallback: false,
    previousCallCount: 0
  };
  try {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1e3;
    const cutoffTimestamp = Math.floor(oneDayAgo / 1e3);
    const { Items: previousCalls } = await ddb2.send(new import_lib_dynamodb.QueryCommand({
      TableName: callQueueTableName,
      IndexName: "phoneNumber-queueEntryTime-index",
      KeyConditionExpression: "phoneNumber = :phone AND queueEntryTime > :cutoff",
      FilterExpression: "clinicId = :clinic",
      ExpressionAttributeValues: {
        ":phone": phoneNumber,
        ":clinic": clinicId,
        ":cutoff": cutoffTimestamp
        // Use numeric timestamp for NUMBER-type GSI
      },
      Limit: 10,
      ScanIndexForward: false
      // Most recent first
    }));
    if (previousCalls && previousCalls.length > 0) {
      context.previousCallCount = previousCalls.length;
      const lastCall = previousCalls[0];
      const lastCallTime = lastCall.queueEntryTime * 1e3;
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1e3;
      if (lastCall.status === "abandoned" && lastCallTime > twoHoursAgo) {
        context.isCallback = true;
        context.previousAgentId = lastCall.assignedAgentId;
        const minutesAgo = Math.floor((Date.now() - lastCallTime) / 6e4);
        console.log(`[enrichCallContext] Detected callback for ${phoneNumber}, abandoned ${minutesAgo} minutes ago, previous agent: ${context.previousAgentId}`);
      }
    }
    context.isVip = vipPhoneNumbers.has(phoneNumber);
    if (context.isVip) {
      context.priority = "high";
    } else if (context.isCallback) {
      context.priority = "high";
    } else if (context.previousCallCount && context.previousCallCount > 3) {
      context.priority = "high";
    }
    console.log("[enrichCallContext] Context enriched:", {
      callId,
      phoneNumber,
      priority: context.priority,
      isVip: context.isVip,
      isCallback: context.isCallback,
      previousCallCount: context.previousCallCount
    });
  } catch (err) {
    console.error("[enrichCallContext] Error enriching context:", err);
  }
  return context;
}

// src/services/shared/utils/unique-id.ts
var import_crypto = require("crypto");
function generateNanoid(size = 10) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = (0, import_crypto.randomBytes)(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}
function generateUniqueCallPosition() {
  const timestamp = Date.now();
  const nanoid = generateNanoid(12);
  return {
    queuePosition: timestamp,
    uniquePositionId: nanoid
  };
}

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
var kvsStreamArnCache = /* @__PURE__ */ new Map();
var KVS_CACHE_TTL_MS = 60 * 1e3;
var pipelineHealth = {
  pipelinesStarted: 0,
  pipelinesFailed: 0,
  kvsResolutionSuccesses: 0,
  kvsResolutionFailures: 0,
  avgStartupTimeMs: 0,
  startupTimeSamples: []
};
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function emitPipelineHealthMetric() {
  console.log("[METRIC] MediaPipeline.Health", {
    ...pipelineHealth,
    startupTimeSamples: void 0,
    // Don't log the array
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function recordStartupTime(durationMs) {
  pipelineHealth.startupTimeSamples.push(durationMs);
  if (pipelineHealth.startupTimeSamples.length > 100) {
    pipelineHealth.startupTimeSamples.shift();
  }
  const sum = pipelineHealth.startupTimeSamples.reduce((a, b) => a + b, 0);
  pipelineHealth.avgStartupTimeMs = Math.round(sum / pipelineHealth.startupTimeSamples.length);
}
async function resolveKinesisVideoStreamArn(streamName) {
  const now = Date.now();
  const cached = kvsStreamArnCache.get(streamName);
  if (cached && now - cached.timestamp < KVS_CACHE_TTL_MS) {
    return cached.arn;
  }
  const maxAttempts = parseInt(process.env.KVS_DESCRIBE_RETRY_ATTEMPTS || "12", 10);
  const baseDelayMs = parseInt(process.env.KVS_DESCRIBE_RETRY_DELAY_MS || "500", 10);
  const startTime = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const out = await kinesisVideoClient.send(new import_client_kinesis_video.DescribeStreamCommand({
        StreamName: streamName
      }));
      const arn = out.StreamInfo?.StreamARN || null;
      if (arn) {
        kvsStreamArnCache.set(streamName, { arn, timestamp: Date.now() });
        pipelineHealth.kvsResolutionSuccesses++;
        console.log("[MediaPipeline] KVS stream resolved", {
          streamName,
          attempt,
          durationMs: Date.now() - startTime
        });
        return arn;
      }
    } catch (error) {
      const name = error?.name || "UnknownError";
      if (name === "ResourceNotFoundException" || name === "NotFoundException") {
        if (attempt < maxAttempts) {
          const delayMs = Math.min(baseDelayMs * attempt, 1e3);
          console.log("[MediaPipeline] KVS stream not found yet, retrying...", {
            streamName,
            attempt,
            maxAttempts,
            delayMs
          });
          await sleep(delayMs);
          continue;
        }
        console.warn("[MediaPipeline] KVS stream not found after retries", {
          streamName,
          maxAttempts,
          durationMs: Date.now() - startTime
        });
        pipelineHealth.kvsResolutionFailures++;
        return null;
      }
      console.error("[MediaPipeline] Error describing KVS stream:", {
        streamName,
        error: error?.message || String(error),
        code: error?.code,
        name
      });
      pipelineHealth.kvsResolutionFailures++;
      return null;
    }
  }
  pipelineHealth.kvsResolutionFailures++;
  return null;
}
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
async function startMediaPipeline(params) {
  const startTime = Date.now();
  if (!ENABLE_REAL_TIME_TRANSCRIPTION) {
    console.log("[MediaPipeline] Real-time transcription is disabled");
    return null;
  }
  const { callId, meetingId, clinicId, agentId, customerPhone, direction } = params;
  try {
    const pipelineConfigArn = await getMediaInsightsPipelineArn();
    if (!pipelineConfigArn) {
      console.warn("[MediaPipeline] Pipeline configuration ARN not available");
      return null;
    }
    console.log("[MediaPipeline] Starting Media Insights Pipeline:", {
      callId,
      meetingId,
      clinicId
    });
    const kvsEnabled = process.env.ENABLE_KVS_STREAMING === "true";
    if (!kvsEnabled) {
      console.log("[MediaPipeline] KVS streaming not enabled, skipping pipeline start");
      return null;
    }
    const kvsPrefix = process.env.KVS_STREAM_PREFIX || "call-";
    const candidateStreamNames = Array.from(/* @__PURE__ */ new Set([
      `${kvsPrefix}${meetingId}`,
      `${kvsPrefix}${callId}`,
      // Also try without the full prefix (Voice Connector might use shorter names)
      `call-${meetingId}`,
      `chime-${meetingId}`,
      // Try the meeting ID alone (some configurations use this)
      meetingId
    ]));
    let kvsStreamName;
    let kvsStreamArn = null;
    for (const name of candidateStreamNames) {
      const arn = await resolveKinesisVideoStreamArn(name);
      if (arn) {
        kvsStreamName = name;
        kvsStreamArn = arn;
        console.log("[MediaPipeline] Found KVS stream:", {
          streamName: name,
          triedPatterns: candidateStreamNames.length
        });
        break;
      }
    }
    if (!kvsStreamArn || !kvsStreamName) {
      console.warn("[MediaPipeline] KVS stream ARN not available after trying all patterns", {
        candidates: candidateStreamNames,
        meetingId,
        callId,
        note: "Voice Connector streaming may not be enabled or stream not created yet"
      });
      return null;
    }
    console.log("[MediaPipeline] Resolved KVS stream ARN:", {
      kvsStreamName,
      kvsStreamArn
    });
    const command = new import_client_chime_sdk_media_pipelines.CreateMediaInsightsPipelineCommand({
      MediaInsightsPipelineConfigurationArn: pipelineConfigArn,
      // Chime SDK Meeting source - Chime will automatically stream to KVS
      KinesisVideoStreamSourceRuntimeConfiguration: {
        MediaEncoding: "pcm",
        MediaSampleRate: 48e3,
        Streams: [
          {
            // KVS stream for this specific meeting
            StreamArn: kvsStreamArn,
            StreamChannelDefinition: {
              NumberOfChannels: 2,
              // Stereo: ch0=agent, ch1=customer
              ChannelDefinitions: [
                { ChannelId: 0, ParticipantRole: "AGENT" },
                { ChannelId: 1, ParticipantRole: "CUSTOMER" }
              ]
            }
          }
        ]
      },
      // Runtime metadata for analytics correlation
      // This metadata is passed through to the Kinesis stream and available to consumers
      MediaInsightsRuntimeMetadata: {
        callId,
        clinicId,
        meetingId,
        agentId: agentId || "",
        customerPhone: customerPhone || "",
        direction: direction || "inbound",
        // AI call metadata for transcript-bridge Lambda
        isAiCall: params.isAiCall ? "true" : "false",
        aiSessionId: params.aiSessionId || "",
        transactionId: callId
        // For UpdateSipMediaApplicationCall
      },
      // Tags for resource management and cost tracking
      Tags: [
        { Key: "CallId", Value: callId },
        { Key: "ClinicId", Value: clinicId },
        { Key: "MeetingId", Value: meetingId },
        { Key: "Type", Value: params.isAiCall ? "AiVoiceCall" : "RealTimeAnalytics" },
        ...params.isAiCall ? [{ Key: "AiSessionId", Value: params.aiSessionId || "" }] : []
      ]
    });
    const response = await mediaPipelinesClient.send(command);
    const pipelineId = response.MediaInsightsPipeline?.MediaPipelineId;
    const startupDuration = Date.now() - startTime;
    if (pipelineId) {
      pipelineHealth.pipelinesStarted++;
      recordStartupTime(startupDuration);
      console.log("[MediaPipeline] Media Insights Pipeline started successfully:", {
        callId,
        pipelineId,
        meetingId,
        kvsStreamName,
        startupDurationMs: startupDuration
      });
      if (pipelineHealth.pipelinesStarted % 10 === 0) {
        emitPipelineHealthMetric();
      }
    } else {
      pipelineHealth.pipelinesFailed++;
      console.warn("[MediaPipeline] Pipeline created but no ID returned");
    }
    return pipelineId || null;
  } catch (error) {
    pipelineHealth.pipelinesFailed++;
    console.error("[MediaPipeline] Failed to start Media Insights Pipeline:", {
      callId,
      meetingId,
      error: error.message,
      code: error.code,
      startupDurationMs: Date.now() - startTime
    });
    return null;
  }
}
async function stopMediaPipeline(pipelineId, callId) {
  if (!ENABLE_REAL_TIME_TRANSCRIPTION || !pipelineId) {
    return;
  }
  try {
    console.log("[MediaPipeline] Stopping Media Insights Pipeline:", {
      callId,
      pipelineId
    });
    await mediaPipelinesClient.send(new import_client_chime_sdk_media_pipelines.DeleteMediaPipelineCommand({
      MediaPipelineId: pipelineId
    }));
    console.log("[MediaPipeline] Media Insights Pipeline stopped:", pipelineId);
  } catch (error) {
    if (error.code === "NotFoundException") {
      console.log("[MediaPipeline] Pipeline already stopped:", pipelineId);
    } else {
      console.error("[MediaPipeline] Failed to stop Media Insights Pipeline:", {
        pipelineId,
        callId,
        error: error.message
      });
    }
  }
}
function isRealTimeTranscriptionEnabled() {
  return ENABLE_REAL_TIME_TRANSCRIPTION;
}

// src/services/chime/utils/push-notifications.ts
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");

// src/services/chime/config.ts
var CHIME_CONFIG = {
  /**
   * Call Queue Configuration
   */
  QUEUE: {
    /** Maximum number of agents to ring simultaneously for incoming calls */
    MAX_RING_AGENTS: parseInt(process.env.CHIME_MAX_RING_AGENTS || "25", 10),
    /** Timeout for calls stuck in queue (seconds) */
    TIMEOUT_SECONDS: parseInt(process.env.CHIME_QUEUE_TIMEOUT || String(24 * 60 * 60), 10),
    /** Average call duration for capacity planning (seconds) */
    AVG_CALL_DURATION_SECONDS: parseInt(process.env.CHIME_AVG_CALL_DURATION || "300", 10)
  },
  /**
   * Agent Management Configuration
   */
  AGENT: {
    /** Minutes of inactivity before agent marked offline */
    STALE_HEARTBEAT_MINUTES: parseInt(process.env.CHIME_STALE_HEARTBEAT_MINUTES || "15", 10),
    /** Maximum agent session duration (seconds) */
    SESSION_MAX_SECONDS: parseInt(process.env.CHIME_SESSION_MAX_SECONDS || String(8 * 60 * 60), 10),
    /** Grace period after last heartbeat before cleanup (seconds) */
    HEARTBEAT_GRACE_SECONDS: parseInt(process.env.CHIME_HEARTBEAT_GRACE_SECONDS || String(15 * 60), 10),
    /** Maximum connected call duration before auto-hangup (minutes) */
    MAX_CONNECTED_CALL_MINUTES: parseInt(process.env.CHIME_MAX_CONNECTED_CALL_MINUTES || "60", 10),
    /**
     * Wrap-up period after a call ends (seconds).
     * Delays the next queue check to give agents time for note-taking.
     * Set to 0 to disable (immediate re-dispatch).
     * @default 0
     */
    WRAP_UP_SECONDS: parseInt(process.env.CHIME_WRAP_UP_SECONDS || "0", 10)
  },
  /**
   * Dispatch Configuration
   * Controls how the fair-share dispatcher allocates agents to queued calls.
   */
  DISPATCH: {
    /** Maximum calls that can ring simultaneously per clinic (static limit) */
    MAX_SIMUL_RING_CALLS: parseInt(process.env.CHIME_MAX_SIMUL_RING_CALLS || "10", 10),
    /**
     * Enable dynamic scaling of MAX_SIMUL_RING_CALLS based on available agents.
     * Formula: min(max(10, ceil(idleAgents / 2)), DYNAMIC_SIMUL_RING_MAX)
     * @default true
     */
    DYNAMIC_SIMUL_RING: process.env.CHIME_DYNAMIC_SIMUL_RING !== "false",
    /** Upper bound for dynamic simultaneous ring calls */
    DYNAMIC_SIMUL_RING_MAX: parseInt(process.env.CHIME_DYNAMIC_SIMUL_RING_MAX || "50", 10),
    /**
     * Enable priority-weighted agent allocation.
     * Higher-priority calls get proportionally more agents instead of even distribution.
     * @default true
     */
    PRIORITY_WEIGHTED_ALLOCATION: process.env.CHIME_PRIORITY_WEIGHTED_ALLOCATION !== "false",
    /**
     * Enable parallel clinic dispatch.
     * Dispatches to all clinics concurrently instead of sequentially.
     * Safe because each clinic uses its own distributed lock.
     * @default true
     */
    PARALLEL_CLINIC_DISPATCH: process.env.CHIME_PARALLEL_CLINIC_DISPATCH !== "false",
    /**
     * Enable ring timeout escalation.
     * After each ring timeout, escalate the routing strategy:
     * Attempt 1: re-ring with different agents
     * Attempt 2: trigger overflow routing
     * Attempt 3+: offer voicemail/AI fallback
     * @default true
     */
    RING_TIMEOUT_ESCALATION: process.env.CHIME_RING_TIMEOUT_ESCALATION !== "false",
    /** Maximum ring attempts before final fallback */
    RING_ESCALATION_MAX_ATTEMPTS: parseInt(process.env.CHIME_RING_ESCALATION_MAX_ATTEMPTS || "3", 10)
  },
  /**
   * Hold Configuration
   * CRITICAL FIX: Moved from hardcoded values to configurable settings
   */
  HOLD: {
    /** Maximum hold duration in minutes before allowing stale hold override (default: 30 minutes) */
    MAX_HOLD_DURATION_MINUTES: parseInt(process.env.CHIME_MAX_HOLD_DURATION_MINUTES || "30", 10),
    /** Whether to allow supervisor override of active holds */
    ALLOW_SUPERVISOR_OVERRIDE: process.env.CHIME_HOLD_SUPERVISOR_OVERRIDE !== "false"
  },
  /**
   * Transfer Configuration
   */
  TRANSFER: {
    /** Maximum length of transfer notes field */
    MAX_NOTE_LENGTH: parseInt(process.env.CHIME_TRANSFER_NOTE_MAX || "500", 10)
  },
  /**
   * Retry Configuration
   */
  RETRY: {
    /** Maximum number of retry attempts for Lambda invocations */
    MAX_ATTEMPTS: parseInt(process.env.CHIME_RETRY_MAX_ATTEMPTS || "3", 10),
    /** Base delay between retries (milliseconds) */
    BASE_DELAY_MS: parseInt(process.env.CHIME_RETRY_BASE_DELAY_MS || "1000", 10)
  },
  /**
   * Cleanup Configuration
   */
  CLEANUP: {
    /** Minutes of inactivity for ringing/dialing status before cleanup */
    STALE_RINGING_DIALING_MINUTES: parseInt(process.env.CHIME_STALE_RINGING_DIALING_MINUTES || "5", 10),
    /** Minutes for queued calls with meeting to be marked as orphaned */
    STALE_QUEUED_CALL_MINUTES: parseInt(process.env.CHIME_STALE_QUEUED_CALL_MINUTES || "30", 10),
    /** Minutes for ringing calls to be marked as abandoned */
    ABANDONED_RINGING_CALL_MINUTES: parseInt(process.env.CHIME_ABANDONED_RINGING_CALL_MINUTES || "10", 10)
  },
  /**
   * Broadcast Ring Configuration
   * Ring strategy: 'broadcast' (ring all), 'parallel' (limited parallel), 'sequential'
   */
  BROADCAST: {
    /** Ring strategy: 'broadcast' | 'parallel' | 'sequential' */
    STRATEGY: process.env.CHIME_RING_STRATEGY || "parallel",
    /** Maximum agents to ring in broadcast mode (safety limit) */
    MAX_BROADCAST_AGENTS: parseInt(process.env.CHIME_MAX_BROADCAST_AGENTS || "100", 10),
    /** Ring timeout in seconds before fallback */
    RING_TIMEOUT_SECONDS: parseInt(process.env.CHIME_RING_TIMEOUT_SECONDS || "30", 10),
    /** Enable push notifications for ringing */
    ENABLE_PUSH_NOTIFICATIONS: process.env.CHIME_ENABLE_PUSH_NOTIFICATIONS !== "false",
    /** Minimum agents to use broadcast (falls back to sequential if fewer) */
    MIN_AGENTS_FOR_BROADCAST: parseInt(process.env.CHIME_MIN_AGENTS_FOR_BROADCAST || "3", 10)
  },
  /**
   * Push Notification Configuration
   * Controls when push notifications are sent for call-lifecycle events
   */
  PUSH: {
    /** Number of queued calls before sending a backup alert to all active agents */
    QUEUE_BACKUP_ALERT_THRESHOLD: parseInt(process.env.CHIME_QUEUE_BACKUP_ALERT_THRESHOLD || "3", 10),
    /** Enable push notifications when a call is transferred to an agent */
    ENABLE_TRANSFER_PUSH: process.env.CHIME_ENABLE_TRANSFER_PUSH !== "false",
    /** Enable push notification when an outbound call is initiated (mobile state sync) */
    ENABLE_OUTBOUND_CALL_PUSH: process.env.CHIME_ENABLE_OUTBOUND_CALL_PUSH !== "false",
    /** Enable push notification when an agent is added to a conference */
    ENABLE_CONFERENCE_JOIN_PUSH: process.env.CHIME_ENABLE_CONFERENCE_JOIN_PUSH !== "false",
    /** Enable push notification on hold/resume (mobile state sync) */
    ENABLE_HOLD_RESUME_PUSH: process.env.CHIME_ENABLE_HOLD_RESUME_PUSH !== "false",
    /** Enable push alert to supervisors when an agent goes offline (opt-in, can be noisy) */
    ENABLE_SESSION_OFFLINE_ALERT: process.env.CHIME_ENABLE_SESSION_OFFLINE_ALERT === "true",
    /** Enable call_cancelled push when a queued call is manually picked up (stops phantom ringing) */
    ENABLE_QUEUE_PICKUP_CANCEL_PUSH: process.env.CHIME_ENABLE_QUEUE_PICKUP_CANCEL_PUSH !== "false",
    /** Enable push notification when agent leaves a call (mobile state sync) */
    ENABLE_LEAVE_CALL_PUSH: process.env.CHIME_ENABLE_LEAVE_CALL_PUSH !== "false"
  },
  /**
   * Overflow Routing Configuration
   * Routes calls to sister clinics when primary clinic agents unavailable
   */
  OVERFLOW: {
    /** Enable overflow routing */
    ENABLED: process.env.CHIME_ENABLE_OVERFLOW === "true",
    /** Seconds to wait before triggering overflow */
    WAIT_THRESHOLD_SECONDS: parseInt(process.env.CHIME_OVERFLOW_WAIT_THRESHOLD || "60", 10),
    /** Maximum clinics to include in overflow */
    MAX_OVERFLOW_CLINICS: parseInt(process.env.CHIME_MAX_OVERFLOW_CLINICS || "5", 10),
    /** Require skill match for overflow agents */
    REQUIRE_SKILL_MATCH: process.env.CHIME_OVERFLOW_REQUIRE_SKILL_MATCH !== "false",
    /** Fallback action if no overflow agents: 'queue' | 'ai' | 'voicemail' */
    FALLBACK_ACTION: process.env.CHIME_OVERFLOW_FALLBACK || "queue",
    /** Default overflow clinic IDs (comma-separated) */
    DEFAULT_OVERFLOW_CLINICS: process.env.CHIME_DEFAULT_OVERFLOW_CLINICS || ""
  },
  /**
   * CloudWatch Metrics Configuration
   */
  METRICS: {
    /** Enable CloudWatch custom metrics */
    ENABLED: process.env.CHIME_METRICS_ENABLED !== "false",
    /** CloudWatch namespace */
    NAMESPACE: process.env.CHIME_METRICS_NAMESPACE || "TodaysDental/Chime"
  },
  /**
   * Enhanced Agent Selection Configuration
   */
  AGENT_SELECTION: {
    /** Enable time-of-day weighting */
    USE_TIME_OF_DAY_WEIGHTING: process.env.CHIME_USE_TIME_OF_DAY_WEIGHTING === "true",
    /** Enable historical performance scoring */
    USE_HISTORICAL_PERFORMANCE: process.env.CHIME_USE_HISTORICAL_PERFORMANCE !== "false",
    /** Enable fair distribution mode (round-robin style) */
    FAIR_DISTRIBUTION_MODE: process.env.CHIME_FAIR_DISTRIBUTION_MODE === "true",
    /** Weight for performance vs availability (0-1) */
    PERFORMANCE_WEIGHT: parseFloat(process.env.CHIME_PERFORMANCE_WEIGHT || "0.3"),
    /** Max calls per agent before deprioritization */
    MAX_CALLS_BEFORE_DEPRIORITIZE: parseInt(process.env.CHIME_MAX_CALLS_BEFORE_DEPRIORITIZE || "15", 10),
    /** Time window for performance calculation (hours) */
    PERFORMANCE_WINDOW_HOURS: parseInt(process.env.CHIME_PERFORMANCE_WINDOW_HOURS || "24", 10)
  },
  /**
   * Sentiment Analysis Configuration
   */
  SENTIMENT: {
    /** Enable real-time sentiment analysis */
    ENABLE_REALTIME: process.env.CHIME_ENABLE_REALTIME_SENTIMENT !== "false",
    /** Negative sentiment threshold for alerts (0-1) */
    NEGATIVE_ALERT_THRESHOLD: parseFloat(process.env.CHIME_NEGATIVE_SENTIMENT_THRESHOLD || "0.7"),
    /** Minimum text length to analyze */
    MIN_TEXT_LENGTH: parseInt(process.env.CHIME_MIN_SENTIMENT_TEXT_LENGTH || "20", 10),
    /** Enable supervisor sentiment alerts */
    ENABLE_SUPERVISOR_ALERTS: process.env.CHIME_ENABLE_SENTIMENT_ALERTS === "true"
  },
  /**
   * Call Summarization Configuration
   */
  SUMMARIZATION: {
    /** Enable AI call summarization */
    ENABLED: process.env.CHIME_ENABLE_CALL_SUMMARY !== "false",
    /** Bedrock model ID for summarization */
    MODEL_ID: process.env.BEDROCK_SUMMARY_MODEL_ID || "anthropic.claude-3-sonnet-20240229-v1:0",
    /** Maximum tokens for summary */
    MAX_TOKENS: parseInt(process.env.CHIME_SUMMARY_MAX_TOKENS || "1024", 10),
    /** Include sentiment in summary */
    INCLUDE_SENTIMENT: process.env.CHIME_SUMMARY_INCLUDE_SENTIMENT !== "false"
  },
  /**
   * Quality Scoring Configuration
   */
  QUALITY: {
    /** Enable quality scoring */
    ENABLED: process.env.CHIME_ENABLE_QUALITY_SCORING !== "false",
    /** Weight for audio quality (0-1) */
    WEIGHT_AUDIO: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AUDIO || "0.15"),
    /** Weight for agent performance (0-1) */
    WEIGHT_AGENT: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AGENT || "0.35"),
    /** Weight for customer experience (0-1) */
    WEIGHT_CUSTOMER: parseFloat(process.env.CHIME_QUALITY_WEIGHT_CUSTOMER || "0.35"),
    /** Weight for compliance (0-1) */
    WEIGHT_COMPLIANCE: parseFloat(process.env.CHIME_QUALITY_WEIGHT_COMPLIANCE || "0.15"),
    /** Minimum overall score before alert */
    ALERT_THRESHOLD_OVERALL: parseInt(process.env.CHIME_QUALITY_ALERT_THRESHOLD || "60", 10)
  },
  /**
   * Supervisor Tools Configuration
   */
  SUPERVISOR: {
    /** Enable supervisor monitoring tools */
    ENABLED: process.env.CHIME_ENABLE_SUPERVISOR_TOOLS !== "false",
    /** Enable whisper mode */
    ENABLE_WHISPER: process.env.CHIME_ENABLE_WHISPER !== "false",
    /** Enable barge-in mode */
    ENABLE_BARGE: process.env.CHIME_ENABLE_BARGE !== "false",
    /** Maximum concurrent supervisions per supervisor */
    MAX_CONCURRENT_SUPERVISIONS: parseInt(process.env.CHIME_MAX_CONCURRENT_SUPERVISIONS || "5", 10)
  },
  /**
   * PII Redaction Configuration (HIPAA Compliance)
   */
  PII: {
    /** Enable PII detection and redaction */
    ENABLED: process.env.CHIME_ENABLE_PII_REDACTION !== "false",
    /** Use AWS Comprehend for PII detection */
    USE_COMPREHEND: process.env.CHIME_USE_COMPREHEND_PII !== "false",
    /** Enable audit logging for PII access */
    AUDIT_LOG: process.env.CHIME_PII_AUDIT_LOG === "true",
    /** Replacement template for redacted text */
    REPLACEMENT_TEMPLATE: process.env.CHIME_PII_REPLACEMENT_TEMPLATE || "[REDACTED-{TYPE}]"
  },
  /**
   * Audit Logging Configuration (HIPAA Compliance)
   */
  AUDIT: {
    /** Enable audit logging */
    ENABLED: process.env.CHIME_ENABLE_AUDIT_LOGGING !== "false",
    /** Log PII access events */
    LOG_PII_ACCESS: process.env.CHIME_LOG_PII_ACCESS === "true",
    /** Retention period in days (HIPAA requires 6 years minimum) */
    RETENTION_DAYS: parseInt(process.env.CHIME_AUDIT_RETENTION_DAYS || "2555", 10),
    /** Enable CloudWatch audit logging */
    CLOUDWATCH_ENABLED: process.env.CHIME_AUDIT_CLOUDWATCH !== "false",
    /** Redact sensitive data in audit logs */
    REDACT_SENSITIVE_DATA: process.env.CHIME_AUDIT_REDACT !== "false"
  },
  /**
   * Circuit Breaker Configuration
   */
  CIRCUIT_BREAKER: {
    /** Failures before circuit opens */
    FAILURE_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_FAILURE_THRESHOLD || "5", 10),
    /** Time before attempting to close circuit (ms) */
    RESET_TIMEOUT_MS: parseInt(process.env.CHIME_CIRCUIT_RESET_TIMEOUT_MS || "30000", 10),
    /** Successes needed to fully close circuit */
    SUCCESS_THRESHOLD: parseInt(process.env.CHIME_CIRCUIT_SUCCESS_THRESHOLD || "3", 10)
  },
  /**
   * Performance Thresholds (ms)
   */
  PERFORMANCE: {
    THRESHOLD_AGENT_SELECTION: parseInt(process.env.PERF_THRESHOLD_AGENT_SELECTION || "200", 10),
    THRESHOLD_BROADCAST_RING: parseInt(process.env.PERF_THRESHOLD_BROADCAST_RING || "500", 10),
    THRESHOLD_DDB_QUERY: parseInt(process.env.PERF_THRESHOLD_DDB_QUERY || "100", 10),
    THRESHOLD_AI_RESPONSE: parseInt(process.env.PERF_THRESHOLD_AI_RESPONSE || "5000", 10),
    THRESHOLD_TOTAL_ROUTING: parseInt(process.env.PERF_THRESHOLD_TOTAL_ROUTING || "2000", 10)
  }
};

// src/services/chime/utils/push-notifications.ts
var SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || "";
var PUSH_NOTIFICATIONS_ENABLED = !!SEND_PUSH_FUNCTION_ARN;
var lambdaClient = null;
var cwClient = null;
function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new import_client_lambda.LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return lambdaClient;
}
function getCloudWatchClient() {
  if (!cwClient) {
    cwClient = new import_client_cloudwatch.CloudWatchClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return cwClient;
}
function isPushNotificationsEnabled() {
  return PUSH_NOTIFICATIONS_ENABLED;
}
async function invokeSendPushLambda(payload, options = {}) {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    console.log("[ChimePush] Push notifications not configured, skipping");
    return { success: false, error: "Push notifications not configured" };
  }
  const { sync = false, skipPreferenceCheck = false } = options;
  try {
    const invocationType = sync ? "RequestResponse" : "Event";
    const response = await getLambdaClient().send(new import_client_lambda.InvokeCommand({
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
        console.error(`[ChimePush] Async Lambda invocation failed, StatusCode: ${response.StatusCode}`);
      } else {
        console.log(`[ChimePush] Async Lambda invoked, StatusCode: ${response.StatusCode}`);
      }
      return { success };
    }
    if (response.Payload) {
      const payloadStr = new TextDecoder().decode(response.Payload);
      const result = JSON.parse(payloadStr);
      if (response.FunctionError) {
        console.error("[ChimePush] Lambda function error:", result);
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
    console.error("[ChimePush] Failed to invoke send-push Lambda:", error.message);
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
      console.log(`[ChimePush] Retrying push notification (attempt ${attempt + 2})`);
    }
  }
  return { success: false, error: lastError || "Max retries exceeded" };
}
async function emitPushMetric(metricName, dimensions, value = 1) {
  if (!CHIME_CONFIG.METRICS.ENABLED)
    return;
  try {
    await getCloudWatchClient().send(new import_client_cloudwatch.PutMetricDataCommand({
      Namespace: CHIME_CONFIG.METRICS.NAMESPACE,
      MetricData: [{
        MetricName: metricName,
        Dimensions: [
          { Name: "NotificationType", Value: dimensions.notificationType }
        ],
        Value: value,
        Unit: "Count",
        Timestamp: /* @__PURE__ */ new Date()
      }]
    }));
  } catch (err) {
    console.warn(`[ChimePush] Failed to emit ${metricName} metric:`, err.message);
  }
}
function formatPhoneNumber(phone) {
  if (!phone)
    return "Unknown";
  const cleaned = phone.replace(/^\+1/, "").replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}
function getCallerDisplay(data) {
  if (data.callerName && data.callerName !== "Unknown") {
    return data.callerName;
  }
  return formatPhoneNumber(data.callerPhoneNumber || "Unknown caller");
}
async function sendIncomingCallToAgents(agentUserIds, notification) {
  if (!PUSH_NOTIFICATIONS_ENABLED || agentUserIds.length === 0) {
    console.log("[ChimePush] sendIncomingCallToAgents skipped", {
      pushEnabled: PUSH_NOTIFICATIONS_ENABLED,
      agentCount: agentUserIds.length,
      callId: notification.callId
    });
    return;
  }
  console.log("[ChimePush] \u{1F4DE} Sending incoming-call push notification", {
    callId: notification.callId,
    clinicId: notification.clinicId,
    clinicName: notification.clinicName,
    callerPhoneNumber: notification.callerPhoneNumber,
    targetAgentIds: agentUserIds,
    agentCount: agentUserIds.length,
    timestamp: notification.timestamp,
    sendPushArn: process.env.SEND_PUSH_FUNCTION_ARN?.substring(0, 60) + "..."
  });
  const callerDisplay = getCallerDisplay(notification);
  const idempotencyKey = `incoming_call:${notification.callId}:agents:${notification.timestamp}`;
  const result = await invokeSendPushLambdaWithRetry({
    userIds: agentUserIds,
    notification: {
      title: "Incoming Call",
      body: `${callerDisplay} calling ${notification.clinicName}`,
      type: "incoming_call",
      // Use system default sound across platforms (iOS app does not bundle ringtone.caf).
      sound: "default",
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        action: "answer_call",
        timestamp: notification.timestamp
      },
      category: "INCOMING_CALL"
    }
  }, {
    sync: true,
    skipPreferenceCheck: true,
    maxRetries: 2
  });
  if (result.success) {
    console.log(`[ChimePush] \u2705 Incoming call push delivered`, {
      callId: notification.callId,
      agentCount: agentUserIds.length,
      agents: agentUserIds,
      response: `sent=${result.sent ?? "?"}, failed=${result.failed ?? "?"}`
    });
    emitPushMetric("PushDelivered", { notificationType: "incoming_call" }, result.sent || agentUserIds.length);
  } else {
    console.error(`[ChimePush] \u274C Failed to push incoming call notification`, {
      callId: notification.callId,
      error: result.error,
      agents: agentUserIds,
      clinicId: notification.clinicId
    });
    emitPushMetric("PushFailed", { notificationType: "incoming_call" });
  }
}
async function sendCallEndedToAgent(notification) {
  if (!PUSH_NOTIFICATIONS_ENABLED)
    return;
  const callerDisplay = getCallerDisplay(notification);
  const notificationType = notification.reason === "cancelled" ? "call_cancelled" : "call_ended";
  const idempotencyKey = `${notificationType}:${notification.callId}:${notification.agentId}:${notification.timestamp}`;
  console.log(`[ChimePush] \u{1F4F4} Sending ${notificationType} push to agent ${notification.agentId}`, {
    callId: notification.callId,
    reason: notification.reason,
    direction: notification.direction
  });
  const result = await invokeSendPushLambdaWithRetry({
    userId: notification.agentId,
    notification: {
      // Data-only (silent push) for state-sync — no visible banner
      type: notificationType,
      contentAvailable: true,
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        reason: notification.reason,
        message: notification.message,
        direction: notification.direction || "inbound",
        action: "call_ended",
        timestamp: notification.timestamp
      },
      category: "CALL_ENDED"
    }
  }, {
    sync: false,
    // fire-and-forget (best-effort)
    skipPreferenceCheck: true,
    maxRetries: 1
  });
  if (result.success) {
    console.log(`[ChimePush] \u2705 Call-ended push sent to agent ${notification.agentId}`);
    emitPushMetric("PushDelivered", { notificationType });
  } else {
    console.error(`[ChimePush] \u274C Failed to send call-ended push to agent ${notification.agentId}:`, result.error);
    emitPushMetric("PushFailed", { notificationType });
  }
}
async function sendCallAnsweredToAgent(notification) {
  if (!PUSH_NOTIFICATIONS_ENABLED)
    return;
  const callerDisplay = getCallerDisplay(notification);
  const idempotencyKey = `call_answered:${notification.callId}:${notification.agentId}:${notification.timestamp}`;
  console.log(`[ChimePush] \u{1F4DE} Sending call_answered push to agent ${notification.agentId}`, {
    callId: notification.callId,
    direction: notification.direction
  });
  const result = await invokeSendPushLambdaWithRetry({
    userId: notification.agentId,
    notification: {
      // Data-only (silent push) for state-sync — no visible banner
      type: "call_answered",
      contentAvailable: true,
      idempotencyKey,
      data: {
        callId: notification.callId,
        clinicId: notification.clinicId,
        clinicName: notification.clinicName,
        callerPhoneNumber: notification.callerPhoneNumber,
        callerName: notification.callerName,
        direction: notification.direction || "outbound",
        meetingId: notification.meetingId || "",
        action: "call_answered",
        timestamp: notification.timestamp
      },
      category: "CALL_ANSWERED"
    }
  }, {
    sync: false,
    skipPreferenceCheck: true,
    maxRetries: 1
  });
  if (result.success) {
    console.log(`[ChimePush] \u2705 Call-answered push sent to agent ${notification.agentId}`);
    emitPushMetric("PushDelivered", { notificationType: "call_answered" });
  } else {
    console.error(`[ChimePush] \u274C Failed to send call-answered push to agent ${notification.agentId}:`, result.error);
    emitPushMetric("PushFailed", { notificationType: "call_answered" });
  }
}

// src/services/ai-agents/voice-agent-config.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_polly = require("@aws-sdk/client-polly");

// src/infrastructure/configs/clinic-config.json
var clinic_config_default = [
  {
    clinicId: "dentistinnewbritain",
    microsoftClarityProjectId: "prdkd0ahi0",
    ga4PropertyId: "460776013",
    odooCompanyId: 22,
    clinicAddress: "446 S Main St, New Britain CT 06051-3516, USA",
    clinicCity: "New Britain",
    clinicEmail: "dentalcare@dentistinnewbritain.com",
    clinicFax: "(860) 770-6774",
    clinicName: "Dentist in New Britain",
    clinicZipCode: "29607",
    clinicPhone: "860-259-4141",
    clinicState: "Connecticut",
    timezone: "America/New_York",
    logoUrl: "https://dentistinnewbritain.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/1wKzE8B2jbxQJaHB8",
    scheduleUrl: "https://dentistinnewbritain.com/patient-portal",
    websiteLink: "https://dentistinnewbritain.com",
    wwwUrl: "https://www.dentistinnewbritain.com",
    phoneNumber: "+18602612866",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinnewbritain.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinnewbritain",
    hostedZoneId: "Z01685649197DPKW71B2",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinnewbritain@gmail.com",
        fromEmail: "dentistinnewbritain@gmail.com",
        fromName: "Dentist in New Britain"
      },
      domain: {
        imapHost: "mail.dentistinnewbritain.com",
        imapPort: 993,
        smtpHost: "mail.dentistinnewbritain.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinnewbritain.com",
        fromEmail: "dentalcare@dentistinnewbritain.com",
        fromName: "Dentist in New Britain"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "749712698232047",
        pageName: "Dentist in New Britain"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6882337378"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistingreenville",
    microsoftClarityProjectId: "prcd3zvx6c",
    ga4PropertyId: "437418111",
    odooCompanyId: 14,
    clinicAddress: "4 Market Point Drive Suite E, Greenville SC 29607",
    clinicCity: "Greenville",
    clinicEmail: "dentalcare@dentistingreenville.com",
    clinicFax: "864-284-0066",
    clinicName: "Dentist in Greenville",
    clinicPhone: "864-284-0066",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "06051-3516",
    logoUrl: "https://dentistingreenville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/TP79MgS1EcycndPy8",
    scheduleUrl: "https://dentistingreenville.com/patient-portal",
    websiteLink: "https://dentistingreenville.com",
    wwwUrl: "https://www.dentistingreenville.com",
    phoneNumber: "+18643192704",
    aiPhoneNumber: "+14439272295",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistingreenville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistingreenville",
    hostedZoneId: "Z02737791R5YBM2QQE4CP",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistingreenville@gmail.com",
        fromEmail: "dentistingreenville@gmail.com",
        fromName: "Dentist in Greenville"
      },
      domain: {
        imapHost: "mail.dentistingreenville.com",
        imapPort: 993,
        smtpHost: "mail.dentistingreenville.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistingreenville.com",
        fromEmail: "dentalcare@dentistingreenville.com",
        fromName: "Dentist in Greenville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "749186571616901",
        pageName: "Dentist in Greenville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "2978902821"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalcayce",
    microsoftClarityProjectId: "pqbgmaxpjv",
    ga4PropertyId: "397796880",
    odooCompanyId: 4,
    clinicAddress: "1305 Knox Abbott Dr suite 101, Cayce, SC 29033, United States",
    clinicCity: "Cayce",
    clinicEmail: "Dentist@TodaysDentalCayce.com",
    clinicFax: "(803) 753-1442",
    clinicName: "Todays Dental Cayce",
    clinicPhone: "803-233-6141",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29033",
    logoUrl: "https://todaysdentalcayce.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/eU4TuxoySfuqfwib7",
    scheduleUrl: "https://todaysdentalcayce.com/patient-portal",
    websiteLink: "https://todaysdentalcayce.com",
    wwwUrl: "https://www.todaysdentalcayce.com",
    phoneNumber: "+18033027525",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalcayce.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalcayce",
    hostedZoneId: "Z0652651QLHSQU2T54IO",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalcayce@gmail.com",
        fromEmail: "todaysdentalcayce@gmail.com",
        fromName: "Todays Dental Cayce"
      },
      domain: {
        imapHost: "mail.todaysdentalcayce.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalcayce.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalCayce.com",
        fromEmail: "Dentist@TodaysDentalCayce.com",
        fromName: "Todays Dental Cayce"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "860746843779381",
        pageName: "Todays Dental Cayce"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "1505658809"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "creekcrossingdentalcare",
    microsoftClarityProjectId: "q5nwcwxs47",
    ga4PropertyId: "473416830",
    odooCompanyId: 33,
    clinicAddress: "1927 FAITHON P LUCAS SR BLVD Ste 120 MESQUITE TX 75181-1698",
    clinicCity: "Mesquite",
    clinicEmail: "dentist@creekcrossingdentalcare.com",
    clinicFax: "469-333-6159",
    clinicName: "Creek Crossing Dental Care",
    clinicPhone: "469-333-6158",
    clinicState: "Texas",
    timezone: "America/Chicago",
    clinicZipCode: "75181",
    logoUrl: "https://creekcrossingdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/k9Be93nCmmcaE3CG7",
    scheduleUrl: "https://creekcrossingdentalcare.com/patient-portal",
    websiteLink: "https://creekcrossingdentalcare.com",
    wwwUrl: "https://www.creekcrossingdentalcare.com",
    phoneNumber: "+14692250064",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/creekcrossingdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "creekcrossingdentalcare",
    hostedZoneId: "Z04673793CNYTEEDV0F48",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "creekcrossingdentalcare@gmail.com",
        fromEmail: "creekcrossingdentalcare@gmail.com",
        fromName: "Creek Crossing Dental Care"
      },
      domain: {
        imapHost: "mail.creekcrossingdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.creekcrossingdentalcare.com",
        smtpPort: 465,
        smtpUser: "dentist@creekcrossingdentalcare.com",
        fromEmail: "dentist@creekcrossingdentalcare.com",
        fromName: "Creek Crossing Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "802545442940105",
        pageName: "Creek Crossing Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6327290560"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinwinston-salem",
    microsoftClarityProjectId: "pvgkbe95f9",
    ga4PropertyId: "476844030",
    odooCompanyId: 35,
    clinicAddress: "3210 Silas Creek Pkwy, Suite-4 Winston salem, NC, 27103",
    clinicCity: "Winston-Salem",
    clinicEmail: "dentalcare@dentistinwinston-salem.com",
    clinicFax: "336-802-1898",
    clinicName: "Dentist in Winston-Salem",
    clinicPhone: "336-802-1894",
    clinicState: "North Carolina",
    timezone: "America/New_York",
    clinicZipCode: "27103",
    logoUrl: "https://dentistinwinston-salem.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/fAV5H59kFt1dfuMW9",
    scheduleUrl: "https://dentistinwinston-salem.com/patient-portal",
    websiteLink: "https://dentistinwinston-salem.com",
    wwwUrl: "https://www.dentistinwinston-salem.com",
    phoneNumber: "+13362836627",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinwinston-salem.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinwinston-salem",
    hostedZoneId: "Z0684688QGCIEZOQLTOQ",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinwinstonsalem@gmail.com",
        fromEmail: "dentistinwinstonsalem@gmail.com",
        fromName: "Dentist in Winston-Salem"
      },
      domain: {
        imapHost: "mail.dentistinwinston-salem.com",
        imapPort: 993,
        smtpHost: "mail.dentistinwinston-salem.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinwinston-salem.com",
        fromEmail: "dentalcare@dentistinwinston-salem.com",
        fromName: "Dentist in Winston-Salem"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "798270746700728",
        pageName: "Dentist in Winston-Salem"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8916450096"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistincentennial",
    microsoftClarityProjectId: "qxtfof6tvo",
    ga4PropertyId: "479242236",
    odooCompanyId: 37,
    clinicAddress: "20269 E Smoky Hill Rd, Centennial, CO 80015, USA",
    clinicCity: "Centennial",
    clinicEmail: "dentalcare@dentistincentennial.com",
    clinicFax: "",
    clinicName: "Dentist in centennial",
    clinicPhone: "303-923-9068",
    clinicState: "Colorado",
    timezone: "America/Denver",
    clinicZipCode: "80015",
    logoUrl: "https://dentistincentennial.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/HjGoQovp8s1QbsC66",
    scheduleUrl: "https://dentistincentennial.com/patient-portal",
    websiteLink: "https://dentistincentennial.com",
    wwwUrl: "https://www.dentistincentennial.com",
    phoneNumber: "+17207020009",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistincentennial.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistincentennial",
    hostedZoneId: "Z01521441Y3EX4DY9YZAZ",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistincentennial@gmail.com",
        fromEmail: "dentistincentennial@gmail.com",
        fromName: "Dentist in centennial"
      },
      domain: {
        imapHost: "mail.dentistincentennial.com",
        imapPort: 993,
        smtpHost: "mail.dentistincentennial.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistincentennial.com",
        fromEmail: "dentalcare@dentistincentennial.com",
        fromName: "Dentist in centennial"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "804637432728253",
        pageName: "Dentist in centennial"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8705012352"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "renodentalcareandorthodontics",
    microsoftClarityProjectId: "tetwfq1mjm",
    ga4PropertyId: "479275245",
    odooCompanyId: 38,
    clinicAddress: "8040 S VIRGINIA ST STE 1 RENO NV 89511-8939",
    clinicCity: "Reno",
    clinicEmail: "dentalcare@renodentalcareandorthodontics.com",
    clinicFax: "775-339-9894",
    clinicName: "Reno Dental Care and Orthodontics",
    clinicPhone: "775-339-9893",
    clinicState: "Nevada",
    timezone: "America/Los_Angeles",
    clinicZipCode: "89511",
    logoUrl: "https://renodentalcareandorthodontics.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/yqVa3N8mNwCgwBGv6",
    scheduleUrl: "https://renodentalcareandorthodontics.com/patient-portal",
    websiteLink: "https://renodentalcareandorthodontics.com",
    wwwUrl: "https://www.renodentalcareandorthodontics.com",
    phoneNumber: "+17752538664",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/renodentalcareandorthodontics.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "renodentalcareandorthodontics",
    hostedZoneId: "Z06718466K032QAKNVB6",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinrenonv@gmail.com",
        fromEmail: "dentistinrenonv@gmail.com",
        fromName: "Reno Dental Care and Orthodontics"
      },
      domain: {
        imapHost: "mail.renodentalcareandorthodontics.com",
        imapPort: 993,
        smtpHost: "mail.renodentalcareandorthodontics.com",
        smtpPort: 465,
        smtpUser: "dentalcare@renodentalcareandorthodontics.com",
        fromEmail: "dentalcare@renodentalcareandorthodontics.com",
        fromName: "Reno Dental Care and Orthodontics"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "780646868466800",
        pageName: "Reno Dental Care and orthodontics"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8844529656"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalalexandria",
    microsoftClarityProjectId: "prcjdqxsau",
    ga4PropertyId: "323970788",
    odooCompanyId: 8,
    clinicAddress: "4601 Pinecrest Office Park Dr D, Alexandria, VA 22312, United States",
    clinicCity: "Alexandria",
    clinicEmail: "Dentist@TodaysDentalAlexandria.com",
    clinicFax: "(703) 256-5076",
    clinicName: "Todays Dental Alexandria",
    clinicPhone: "(703) 256-2085",
    clinicState: "Virginia",
    timezone: "America/New_York",
    clinicZipCode: "22312",
    logoUrl: "https://todaysdentalalexandria.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/vqABURPKCfMrFuuX9",
    scheduleUrl: "https://todaysdentalalexandria.com/patient-portal",
    websiteLink: "https://todaysdentalalexandria.com",
    wwwUrl: "https://www.todaysdentalalexandria.com",
    phoneNumber: "+17036728308",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalalexandria.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalalexandria",
    hostedZoneId: "Z03912831F1RMPO1B73A1",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalalexandria@gmail.com",
        fromEmail: "todaysdentalalexandria@gmail.com",
        fromName: "Todays Dental Alexandria"
      },
      domain: {
        imapHost: "mail.todaysdentalalexandria.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalalexandria.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalAlexandria.com",
        fromEmail: "Dentist@TodaysDentalAlexandria.com",
        fromName: "Todays Dental Alexandria"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "854025807784463",
        pageName: "Todays Dental Alexandria"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5285406194"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalgreenville",
    microsoftClarityProjectId: "prc4w966rh",
    ga4PropertyId: "329785564",
    odooCompanyId: 5,
    clinicAddress: "1530 Poinsett Hwy Greenville, SC 29609, USA",
    clinicCity: "Greenville",
    clinicEmail: "Dentist@TodaysDentalGreenville.com",
    clinicFax: "(864) 274-0708",
    clinicName: "Todays Dental Greenville",
    clinicPhone: "(864) 999-9899",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29609",
    logoUrl: "https://todaysdentalgreenville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/ksQRNsjQsjH7VNUa9",
    scheduleUrl: "https://todaysdentalgreenville.com/patient-portal",
    websiteLink: "https://todaysdentalgreenville.com",
    wwwUrl: "https://www.todaysdentalgreenville.com",
    phoneNumber: "+18643192662",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalgreenville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalgreenville",
    hostedZoneId: "Z04077501PVREEA4QQROH",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalgreenville@gmail.com",
        fromEmail: "todaysdentalgreenville@gmail.com",
        fromName: "Todays Dental Greenville"
      },
      domain: {
        imapHost: "mail.todaysdentalgreenville.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalgreenville.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalGreenville.com",
        fromEmail: "Dentist@TodaysDentalGreenville.com",
        fromName: "Todays Dental Greenville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "785393261324026",
        pageName: "Todays Dental Greenville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "3865885156"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentalwestcolumbia",
    microsoftClarityProjectId: "prcle83ice",
    ga4PropertyId: "256860978",
    odooCompanyId: 6,
    clinicAddress: "115 Medical Cir West Columbia, SC 29169, USA",
    clinicCity: "West Columbia",
    clinicEmail: "Dentist@TodaysDentalWestColumbia.com",
    clinicFax: "(803) 233-8178",
    clinicName: "Todays Dental West Columbia",
    clinicPhone: "(803) 233-8177",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29169",
    logoUrl: "https://todaysdentalwestcolumbia.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/NfpA3W9nsMdxC2gy5",
    scheduleUrl: "https://todaysdentalwestcolumbia.com/patient-portal",
    websiteLink: "https://todaysdentalwestcolumbia.com",
    wwwUrl: "https://www.todaysdentalwestcolumbia.com",
    phoneNumber: "+18032988480",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalwestcolumbia.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "todaysdentalwestcolumbia",
    hostedZoneId: "Z04061862KUE9GXTYR3B8",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalwestcolumbia@gmail.com",
        fromEmail: "todaysdentalwestcolumbia@gmail.com",
        fromName: "Todays Dental West Columbia"
      },
      domain: {
        imapHost: "mail.todaysdentalwestcolumbia.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalwestcolumbia.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalWestColumbia.com",
        fromEmail: "Dentist@TodaysDentalWestColumbia.com",
        fromName: "Todays Dental West Columbia"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "780972621763947",
        pageName: "Todays Dental West Columbia"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6830227762"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinconcord",
    microsoftClarityProjectId: "prd9vboz9f",
    ga4PropertyId: "436453348",
    odooCompanyId: 20,
    clinicAddress: "2460 Wonder DR STE C, Kannapolis, NC 28083",
    clinicCity: "Concord",
    clinicEmail: "DentalCare@DentistinConcord.com",
    clinicFax: "(704) 707-3621",
    clinicName: "Dentist in Concord",
    clinicPhone: "(704) 707-3620",
    clinicState: "North Carolina",
    timezone: "America/New_York",
    clinicZipCode: "28083",
    logoUrl: "https://dentistinconcord.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/PRVNRH5U7tnv4erA8",
    scheduleUrl: "https://dentistinconcord.com/patient-portal",
    websiteLink: "https://dentistinconcord.com",
    wwwUrl: "https://www.dentistinconcord.com",
    phoneNumber: "+17043682506",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinconcord.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinconcord",
    hostedZoneId: "Z0424286J6ADTB4LRPD5",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinconcord@gmail.com",
        fromEmail: "dentistinconcord@gmail.com",
        fromName: "Dentist in Concord"
      },
      domain: {
        imapHost: "mail.dentistinconcord.com",
        imapPort: 993,
        smtpHost: "mail.dentistinconcord.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinConcord.com",
        fromEmail: "DentalCare@DentistinConcord.com",
        fromName: "Dentist in Concord"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "818707804648788",
        pageName: "Dentist in Concord"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "1771094795"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinedgewater",
    microsoftClarityProjectId: "prd2n502ae",
    ga4PropertyId: "454102815",
    odooCompanyId: 15,
    clinicAddress: "15 Lee Airpark Dr, Suite 100, Edgewater MD 21037",
    clinicCity: "Edgewater",
    clinicEmail: "DentalCare@DentistinEdgewater.com",
    clinicFax: "(443) 334-6689",
    clinicName: "Dentist in EdgeWater",
    clinicPhone: "(443) 334-6689",
    clinicState: "Maryland",
    timezone: "America/New_York",
    clinicZipCode: "21037",
    logoUrl: "https://dentistinedgewatermd.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/x97PmcG9KJH5Rdu16",
    scheduleUrl: "https://dentistinedgewatermd.com/patient-portal",
    websiteLink: "https://dentistinedgewatermd.com",
    wwwUrl: "https://www.dentistinedgewatermd.com",
    phoneNumber: "+14432038433",
    aiPhoneNumber: "+14439272295",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinedgewatermd.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinedgewater",
    hostedZoneId: "Z0681492267AQBV6TNPKG",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinedgewatermd@gmail.com",
        fromEmail: "dentistinedgewatermd@gmail.com",
        fromName: "Dentist in EdgeWater"
      },
      domain: {
        imapHost: "mail.dentistinedgewater.com",
        imapPort: 993,
        smtpHost: "mail.dentistinedgewater.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinEdgewater.com",
        fromEmail: "DentalCare@DentistinEdgewater.com",
        fromName: "Dentist in EdgeWater"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "815231321665315",
        pageName: "Dentist in EdgeWater"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6571919715"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "lawrencevilledentistry",
    microsoftClarityProjectId: "prcvlw68k2",
    ga4PropertyId: "320151183",
    odooCompanyId: 11,
    clinicAddress: "1455 Pleasant Hill Road, Lawrenceville, Suite 807A, georgia 30044, USA",
    clinicCity: "Lawrenceville",
    clinicEmail: "Dentist@LawrencevilleDentistry.com",
    clinicFax: "(770) 415-4995",
    clinicName: "Lawrenceville Dentistry",
    clinicZipCode: "30044",
    clinicPhone: "(770)-415-0077",
    clinicState: "Georgia",
    timezone: "America/New_York",
    logoUrl: "https://lawrencevilledentistry.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/MFnMPmHSsdyHaGZe9",
    scheduleUrl: "https://lawrencevilledentistry.com/book-appointment",
    websiteLink: "https://lawrencevilledentistry.com",
    wwwUrl: "https://www.lawrencevilledentistry.com",
    phoneNumber: "+17702840555",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/lawrencevilledentistry.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "lawrencevilledentistry",
    hostedZoneId: "Z065164017R8THSISNPT8",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "lawrencevilledentistry@gmail.com",
        fromEmail: "lawrencevilledentistry@gmail.com",
        fromName: "Lawrenceville Dentistry"
      },
      domain: {
        imapHost: "mail.lawrencevilledentistry.com",
        imapPort: 993,
        smtpHost: "mail.lawrencevilledentistry.com",
        smtpPort: 465,
        smtpUser: "Dentist@LawrencevilleDentistry.com",
        fromEmail: "Dentist@LawrencevilleDentistry.com",
        fromName: "Lawrenceville Dentistry"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "764215823445811",
        pageName: "Lawrenceville Dentistry"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9954954552"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinlouisville",
    microsoftClarityProjectId: "prdfvmoubk",
    ga4PropertyId: "457162663",
    odooCompanyId: 21,
    clinicAddress: "6826 Bardstown Road, Louisville Kentucky 40291, USA",
    clinicCity: "Louisville",
    clinicEmail: "dentalcare@dentistinlouisville.com",
    clinicFax: "(502) 212-9629",
    clinicName: "Dentist In Louisville",
    clinicZipCode: "40291",
    clinicPhone: "(502)-239-9751",
    clinicState: "Kentucky",
    timezone: "America/New_York",
    logoUrl: "https://dentistinlouisville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/m76QtysK96poeUWy7",
    scheduleUrl: "https://dentistinlouisville.com/book-appointment",
    websiteLink: "https://dentistinlouisville.com",
    wwwUrl: "https://www.dentistinlouisville.com",
    phoneNumber: "+15022158254",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinlouisville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinlouisville",
    hostedZoneId: "Z01681663I51Z0MKKI4RU",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinlouisvillekentucky@gmail.com",
        fromEmail: "dentistinlouisvillekentucky@gmail.com",
        fromName: "Dentist In Louisville"
      },
      domain: {
        imapHost: "mail.dentistinlouisville.com",
        imapPort: 993,
        smtpHost: "mail.dentistinlouisville.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinlouisville.com",
        fromEmail: "dentalcare@dentistinlouisville.com",
        fromName: "Dentist In Louisville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "830585603464796",
        pageName: "Dentist In Louisville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9277361743"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistatsaludapointe",
    microsoftClarityProjectId: "prcqs5tiew",
    ga4PropertyId: "308606507",
    odooCompanyId: 7,
    clinicAddress: "105 Saluda Pointe Ct Suite C, Lexington, SC 29072, USA",
    clinicCity: "SaludaPointe",
    clinicEmail: "DentalCare@DentistatSaludaPointe.com",
    clinicFax: "",
    clinicName: "Todays Dental Saluda Pointe",
    clinicZipCode: "29072",
    clinicPhone: "(803) 399-8236",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    logoUrl: "https://dentistatsaludapointe.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/ybcArAkBw4JLHqmY7",
    scheduleUrl: "https://dentistatsaludapointe.com/book-appointment",
    websiteLink: "https://dentistatsaludapointe.com",
    wwwUrl: "https://www.dentistatsaludapointe.com",
    phoneNumber: "+18032919970",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistatsaludapointe.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistatsaludapointe",
    hostedZoneId: "Z065149151EMKCBPQEVL",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistatsaludapointe@gmail.com",
        fromEmail: "dentistatsaludapointe@gmail.com",
        fromName: "Todays Dental Saluda Pointe"
      },
      domain: {
        imapHost: "mail.dentistatsaludapointe.com",
        imapPort: 993,
        smtpHost: "mail.dentistatsaludapointe.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistatSaludaPointe.com",
        fromEmail: "DentalCare@DentistatSaludaPointe.com",
        fromName: "Todays Dental Saluda Pointe"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "830923773419024",
        pageName: "Dentist At Saluda Pointe"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9490955129"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinoregonoh",
    microsoftClarityProjectId: "prdbm63nqu",
    ga4PropertyId: "435942957",
    odooCompanyId: 25,
    clinicAddress: "3555 Navarre Ave Stre 12, Oregon OH 43616",
    clinicCity: "Oregon",
    clinicEmail: "dentalcare@dentistinoregonoh.com",
    clinicFax: "(419) 391-9906",
    clinicName: "Dentist in Oregon",
    clinicPhone: "(419) 690-0320",
    clinicState: "Ohio",
    timezone: "America/New_York",
    clinicZipCode: "43616",
    logoUrl: "https://dentistinoregonoh.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/dHUuSUYSeot1YxBw5",
    scheduleUrl: "https://dentistinOregonoh.com/patient-portal",
    websiteLink: "https://dentistinoregonoh.com",
    wwwUrl: "https://www.dentistinoregonoh.com",
    phoneNumber: "+14193183371",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinoregonoh.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinoregonoh",
    hostedZoneId: "Z0424621RYEA9FEBS0JY",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinoregonoh@gmail.com",
        fromEmail: "dentistinoregonoh@gmail.com",
        fromName: "Dentist in Oregon"
      },
      domain: {
        imapHost: "mail.dentistinoregonoh.com",
        imapPort: 993,
        smtpHost: "mail.dentistinoregonoh.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinoregonoh.com",
        fromEmail: "dentalcare@dentistinoregonoh.com",
        fromName: "Dentist in Oregon"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "761336133733464",
        pageName: "Dentist in Oregon"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "2121863652"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "todaysdentallexington",
    microsoftClarityProjectId: "prcooafwqn",
    ga4PropertyId: "322576361",
    odooCompanyId: 2,
    clinicAddress: "458 Old Cherokee Rd Suite 100, Lexington, SC 29072, USA",
    clinicCity: "Lexington",
    clinicEmail: "Dentist@TodaysDentalLexington.com",
    clinicFax: "",
    clinicName: "Todays Dental Lexington",
    clinicPhone: "(803) 756-4353",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "43616",
    logoUrl: "https://todaysdentallexington.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/nBnxjeHrWU8mxDgV7",
    scheduleUrl: "https://todaysdentallexington.com/patient-portal",
    websiteLink: "https://todaysdentallexington.com",
    wwwUrl: "https://www.todaysdentallexington.com",
    phoneNumber: "+18032210987",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentallexington.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "daysdentallexington",
    hostedZoneId: "Z040331235NMZIX4ZLLGE",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentallexington@gmail.com",
        fromEmail: "todaysdentallexington@gmail.com",
        fromName: "Todays Dental Lexington"
      },
      domain: {
        imapHost: "mail.todaysdentallexington.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentallexington.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalLexington.com",
        fromEmail: "Dentist@TodaysDentalLexington.com",
        fromName: "Todays Dental Lexington"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "739288799274944",
        pageName: "Todays Dental Lexington"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9085359447"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinbowie",
    microsoftClarityProjectId: "prctr500z6",
    ga4PropertyId: "317138480",
    odooCompanyId: 9,
    clinicAddress: "14999 Health Center Dr #110 Bowie, MD 20716, USA",
    clinicCity: "Bowie",
    clinicEmail: "DentalCare@DentistinBowie.com",
    clinicFax: "(301) 880-0940",
    clinicName: "Dentist in Bowie",
    clinicZipCode: "20716",
    clinicPhone: "(301) 880-0504",
    clinicState: "Maryland",
    timezone: "America/New_York",
    logoUrl: "https://dentistinbowie.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Tb2ZSscmYFCkdEsLA",
    scheduleUrl: "https://dentistinbowie.com/patient-portal",
    websiteLink: "https://dentistinbowie.com",
    wwwUrl: "https://www.dentistinbowie.com",
    phoneNumber: "+13012416572",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinbowie.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinbowie",
    hostedZoneId: "Z06428572342W1A3EK5HA",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinbowie@gmail.com",
        fromEmail: "dentistinbowie@gmail.com",
        fromName: "Dentist in Bowie"
      },
      domain: {
        imapHost: "mail.dentistinbowie.com",
        imapPort: 993,
        smtpHost: "mail.dentistinbowie.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinBowie.com",
        fromEmail: "DentalCare@DentistinBowie.com",
        fromName: "Dentist in Bowie"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "786812141180019",
        pageName: "Dentist in Bowie"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4551655949"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinpowellohio",
    microsoftClarityProjectId: "prdd94j7x5",
    ga4PropertyId: "441589993",
    odooCompanyId: 16,
    clinicAddress: "4091 W Powell Rd#1, Powell, OH 43065",
    clinicCity: "Powell",
    clinicEmail: "DentalCare@DentistinPowellOhio.com",
    clinicFax: "(614) 664-9667",
    clinicName: "Dentist in Powell",
    clinicZipCode: "43065",
    clinicPhone: "(614) 659-0018",
    clinicState: "Ohio",
    timezone: "America/New_York",
    logoUrl: "https://dentistinpowellohio.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/eR4MznoQ3gj897NX8",
    scheduleUrl: "https://dentistinpowellohio.com/patient-portal",
    websiteLink: "https://dentistinpowellohio.com",
    wwwUrl: "https://www.dentistinpowellohio.com",
    phoneNumber: "+16144898815",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinpowellohio.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinpowellohio",
    hostedZoneId: "Z06449472H2KB1S9FS2K5",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinpowellohio@gmail.com",
        fromEmail: "dentistinpowellohio@gmail.com",
        fromName: "Dentist in Powell"
      },
      domain: {
        imapHost: "mail.dentistinpowellohio.com",
        imapPort: 993,
        smtpHost: "mail.dentistinpowellohio.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinPowellOhio.com",
        fromEmail: "DentalCare@DentistinPowellOhio.com",
        fromName: "Dentist in Powell"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "779484698582071",
        pageName: "Dentist in Powell"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4638071933"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinperrysburg",
    microsoftClarityProjectId: "prcxhz2cnj",
    ga4PropertyId: "375431202",
    odooCompanyId: 10,
    clinicAddress: "110 E South Boundary St, Perrysburg, OH 43551, USA",
    clinicCity: "Perrysburg",
    clinicEmail: "Dentalcare@dentistinperrysburg.com",
    clinicFax: "(419) 792-1263",
    clinicName: "Dentist in PerrysBurg",
    clinicZipCode: "43551",
    clinicPhone: "(419) 792-1264",
    clinicState: "Ohio",
    timezone: "America/New_York",
    logoUrl: "https://dentistinperrysburg.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/aVCiTAY9UvGYXQaR8",
    scheduleUrl: "https://dentistinperrysburg.com/patient-portal",
    websiteLink: "https://dentistinperrysburg.com",
    wwwUrl: "https://www.dentistinperrysburg.com",
    phoneNumber: "+14193183386",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinperrysburg.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinperrysburg",
    hostedZoneId: "Z0190676238ABL9C3TV32",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinperrysburg@gmail.com",
        fromEmail: "dentistinperrysburg@gmail.com",
        fromName: "Dentist in PerrysBurg"
      },
      domain: {
        imapHost: "mail.dentistinperrysburg.com",
        imapPort: 993,
        smtpHost: "mail.dentistinperrysburg.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinperrysburg.com",
        fromEmail: "Dentalcare@dentistinperrysburg.com",
        fromName: "Dentist in PerrysBurg"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "743300888873794",
        pageName: "Dentist in PerrysBurg"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "7421865491"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinaustin",
    microsoftClarityProjectId: "q5ntnauzgw",
    ga4PropertyId: "473412339",
    odooCompanyId: 34,
    clinicAddress: "2110 W Slaughter Ln Ste 190 Austin, TX 78748",
    clinicCity: "Austin",
    clinicEmail: "Dentalcare@dentistinaustintx.com",
    clinicFax: "(512) 430-4563",
    clinicName: "Dentist in Austin",
    clinicZipCode: "78748",
    clinicPhone: "512-430-4472",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinaustintx.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/BbvkUzQb14p6YhH77",
    scheduleUrl: "https://dentistinaustintx.com/patient-portal",
    websiteLink: "https://dentistinaustintx.com",
    wwwUrl: "https://www.dentistinaustintx.com",
    phoneNumber: "+15123095624",
    aiPhoneNumber: "+17377074552",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinaustintx.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinaustin",
    hostedZoneId: "Z039585419DY53TZXW8SA",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinaustin@gmail.com",
        fromEmail: "dentistinaustin@gmail.com",
        fromName: "Dentist in Austin"
      },
      domain: {
        imapHost: "mail.dentistinaustintx.com",
        imapPort: 993,
        smtpHost: "mail.dentistinaustintx.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinaustintx.com",
        fromEmail: "Dentalcare@dentistinaustintx.com",
        fromName: "Dentist in Austin"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "787337507798286",
        pageName: "Dentist in Austin"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5770542490"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "therimdentalcare",
    microsoftClarityProjectId: "prdn6xu3rx",
    ga4PropertyId: "475875370",
    odooCompanyId: 29,
    clinicAddress: "6028 WORTH PKWY STE 101, SAN ANTONIO, TX 78257-5071",
    clinicCity: "SAN ANTONIO",
    clinicEmail: "Dentist@therimdentalcare.com",
    clinicFax: "(726) 215-9920",
    clinicName: "The Rim Dental Care",
    clinicPhone: "(726) 215-9920",
    clinicState: "Texas",
    timezone: "America/Chicago",
    clinicZipCode: "78257-5071",
    logoUrl: "https://therimdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/cabosKW6nqkmPCQs8",
    scheduleUrl: "https://therimdentalcare.com/patient-portal",
    websiteLink: "https://therimdentalcare.com",
    wwwUrl: "https://www.therimdentalcare.com",
    phoneNumber: "+17262023123",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/therimdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "therimdentalcare",
    hostedZoneId: "Z062554333J0IQ9RHN2OP",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "therimdentalcare@gmail.com",
        fromEmail: "therimdentalcare@gmail.com",
        fromName: "The Rim Dental Care"
      },
      domain: {
        imapHost: "mail.therimdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.therimdentalcare.com",
        smtpPort: 465,
        smtpUser: "Dentist@therimdentalcare.com",
        fromEmail: "Dentist@therimdentalcare.com",
        fromName: "The Rim Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "737273779478519",
        pageName: "The Rim Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5001733364"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinbloomingdale",
    microsoftClarityProjectId: "prdid5gc91",
    ga4PropertyId: "470493714",
    odooCompanyId: 27,
    clinicAddress: "366 W Army Trail Rd #310a, Bloomingdale, IL 60108, USA",
    clinicCity: "Bloomingdale",
    clinicEmail: "Dentalcare@dentistinbloomingdaleil.com",
    clinicFax: "(630) 686-1327",
    clinicName: "Dentist in Bloomingdale",
    clinicZipCode: "60108",
    clinicPhone: "(630) 686-1328",
    clinicState: "Illinois",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinbloomingdaleil.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/e7WeCV2FKXuTbyMA6",
    scheduleUrl: "https://dentistinbloomingdaleil.com/patient-portal",
    websiteLink: "https://dentistinbloomingdaleil.com",
    wwwUrl: "https://www.dentistinbloomingdaleil.com",
    phoneNumber: "+16302969003",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinbloomingdaleil.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinbloomingdale",
    hostedZoneId: "Z0168184178UA6OJU34E4",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinbloomingdale@gmail.com",
        fromEmail: "dentistinbloomingdale@gmail.com",
        fromName: "Dentist in Bloomingdale"
      },
      domain: {
        imapHost: "mail.dentistinbloomingdaleil.com",
        imapPort: 993,
        smtpHost: "mail.dentistinbloomingdaleil.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinbloomingdaleil.com",
        fromEmail: "Dentalcare@dentistinbloomingdaleil.com",
        fromName: "Dentist in Bloomingdale"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "795753343619807",
        pageName: "Dentist in Bloomingdale"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5553837131"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinvernonhills",
    microsoftClarityProjectId: "prdmxxnpab",
    ga4PropertyId: "470562527",
    odooCompanyId: 32,
    clinicAddress: "6826 Bardstown Road, VernonHills, Illinois, 40291, USA",
    clinicCity: "VernonHills",
    clinicEmail: "DentalCare@DentistinVernonHills.com",
    clinicFax: "",
    clinicName: "Dentist in Vernon Hills",
    clinicZipCode: "40291",
    clinicPhone: "(847) 978-4077",
    clinicState: "Illinois",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinvernonhills.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/3EJBccxEGW41P8Rh7",
    scheduleUrl: "https://dentistinvernonhills.com/patient-portal",
    websiteLink: "https://dentistinvernonhills.com",
    wwwUrl: "https://www.dentistinvernonhills.com",
    phoneNumber: "+18472608875",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinvernonhills.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinvernonhills",
    hostedZoneId: "Z01676602Q7T5NJOJ0NZU",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinvernonhills@gmail.com",
        fromEmail: "dentistinvernonhills@gmail.com",
        fromName: "Dentist in Vernon Hills"
      },
      domain: {
        imapHost: "mail.dentistinvernonhills.com",
        imapPort: 993,
        smtpHost: "mail.dentistinvernonhills.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinVernonHills.com",
        fromEmail: "DentalCare@DentistinVernonHills.com",
        fromName: "Dentist in Vernon Hills"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "817804011415991",
        pageName: "Dentist in Vernon Hills"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4656582027"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "meadowsdentalcare",
    microsoftClarityProjectId: "q5nl2vx1uk",
    ga4PropertyId: "472533442",
    odooCompanyId: 36,
    clinicAddress: "9600 S I-35 Frontage Rd Bldg S #275, Austin, TX 78748, United States",
    clinicCity: "Austin",
    clinicEmail: "dentist@themeadowsdentalcare.com",
    clinicFax: "(737) 263-1592",
    clinicName: "Meadows Dental Care",
    clinicZipCode: "78748",
    clinicPhone: "(737) 263-1581",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://themeadowsdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Hz4S86nieDoEJyZi6",
    scheduleUrl: "https://themeadowsdentalcare.com/patient-portal",
    websiteLink: "https://themeadowsdentalcare.com",
    wwwUrl: "https://www.themeadowsdentalcare.com",
    phoneNumber: "+17372273831",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/themeadowsdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "meadowsdentalcare",
    hostedZoneId: "Z0228748YTYJQTBTCWH1",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "meadowsdentalcare@gmail.com",
        fromEmail: "meadowsdentalcare@gmail.com",
        fromName: "Meadows Dental Care"
      },
      domain: {
        imapHost: "mail.themeadowsdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.themeadowsdentalcare.com",
        smtpPort: 465,
        smtpUser: "dentist@themeadowsdentalcare.com",
        fromEmail: "dentist@themeadowsdentalcare.com",
        fromName: "Meadows Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "761234307081671",
        pageName: "Meadows Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "7115897921"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "dentistinstillwater",
    microsoftClarityProjectId: "qxvqxbsvlr",
    ga4PropertyId: "489087064",
    odooCompanyId: 39,
    clinicAddress: "5619 W. Loop, 1604 N Ste 112, San Antonio, TX 78253-5795",
    clinicCity: "San Antonio",
    clinicEmail: "dentalcare@stillwaterdentalcareandortho.com",
    clinicFax: "",
    clinicName: "Dentist in Still Water",
    clinicZipCode: "78253-5795",
    clinicPhone: "254-492-3224",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://stillwaterdentalcareandortho.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Gc14g4dakEXrwbTi7",
    scheduleUrl: "https://stillwaterdentalcareandortho.com/patient-portal",
    websiteLink: "https://stillwaterdentalcareandortho.com",
    wwwUrl: "https://www.stillwaterdentalcareandortho.com",
    phoneNumber: "+12542250133",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/stillwaterdentalcareandortho.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "dentistinstillwater",
    hostedZoneId: "Z029178313VFV0GYWY3NS",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinstillwater@gmail.com",
        fromEmail: "dentistinstillwater@gmail.com",
        fromName: "Dentist in Still Water"
      },
      domain: {
        imapHost: "mail.stillwaterdentalcareandortho.com",
        imapPort: 993,
        smtpHost: "mail.stillwaterdentalcareandortho.com",
        smtpPort: 465,
        smtpUser: "dentalcare@stillwaterdentalcareandortho.com",
        fromEmail: "dentalcare@stillwaterdentalcareandortho.com",
        fromName: "Dentist in Still Water"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "717972378076257",
        pageName: "Dentist in Still Water"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9116392960"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  },
  {
    clinicId: "pearlanddentalcare",
    microsoftClarityProjectId: "sff0eb093t",
    ga4PropertyId: "501638627",
    odooCompanyId: 40,
    clinicAddress: "1921 N Main St Ste 115, Pearland TX 77581",
    clinicCity: "Pearland",
    clinicEmail: "dentalcare@pearlanddentalcare.com",
    clinicFax: "",
    clinicName: "Pearland Dental Care",
    clinicZipCode: "77581",
    clinicPhone: "832-955-1682",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://pearlanddentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/9ZFsgFAnRKyJmj5s6",
    scheduleUrl: "https://pearlanddentalcare.com/patient-portal",
    websiteLink: "https://pearlanddentalcare.com",
    wwwUrl: "https://www.pearlanddentalcare.com",
    phoneNumber: "+18322806867",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/pearlanddentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd4a4366965c409097eba6c48614b6e2",
    sftpFolderPath: "pearlanddentalcare",
    hostedZoneId: "Z02753391M42GQCRXDDCE",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "pearlanddentalcare@gmail.com",
        fromEmail: "pearlanddentalcare@gmail.com",
        fromName: "Pearland Dental Care"
      },
      domain: {
        imapHost: "mail.pearlanddentalcare.com",
        imapPort: 993,
        smtpHost: "mail.pearlanddentalcare.com",
        smtpPort: 465,
        smtpUser: "dentalcare@pearlanddentalcare.com",
        fromEmail: "dentalcare@pearlanddentalcare.com",
        fromName: "Pearland Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: [
        "facebook"
      ],
      facebook: {
        connected: true,
        pageId: "764480776752152",
        pageName: "Pearland Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8278105993"
    },
    geofence: {
      enabled: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      wifiSSIDs: [],
      lateThresholdMinutes: 10
    }
  }
];

// src/shared/utils/secrets-helper.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
var GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || "TodaysDentalInsights-GlobalSecrets";
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
var CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || "300000", 10);

// src/shared/utils/cors.ts
var clinicsData = clinic_config_default;
function toOrigin(maybeUrl) {
  try {
    const s = String(maybeUrl || "").trim();
    if (!s)
      return null;
    return new URL(s).origin;
  } catch {
    return null;
  }
}
var STATIC_ALLOWED_ORIGIN_INPUTS = [
  "https://todaysdentalinsights.com",
  "https://www.todaysdentalinsights.com",
  // Local development origins (frontend runs on port 3000 via Vite)
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...clinicsData.map((c) => c.websiteLink).filter(Boolean),
  ...clinicsData.map((c) => c.wwwUrl).filter(Boolean)
];
var ALLOWED_ORIGINS_LIST = Array.from(
  new Set(STATIC_ALLOWED_ORIGIN_INPUTS.map(toOrigin).filter(Boolean))
);

// src/services/ai-agents/voice-agent-config.ts
var dynamoClient = new import_client_dynamodb2.DynamoDBClient({});
var docClient = import_lib_dynamodb3.DynamoDBDocumentClient.from(dynamoClient);
var pollyClient = new import_client_polly.PollyClient({});
var VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE || "VoiceAgentConfig";
var AGENTS_TABLE = process.env.AGENTS_TABLE || "AiAgents";
var CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE || "ClinicHours";
function normalizeAfterHoursCallingMode(value) {
  if (value === "OFF" || value === "FORWARD_TO_AI" || value === "PLAY_CLOSED_MESSAGE")
    return value;
  return void 0;
}
var VOICES_CACHE_TTL_MS = 60 * 60 * 1e3;
async function getAfterHoursCallingMode(clinicId) {
  const response = await docClient.send(new import_lib_dynamodb3.GetCommand({
    TableName: VOICE_CONFIG_TABLE,
    Key: { clinicId }
  }));
  const config = response.Item;
  const explicit = normalizeAfterHoursCallingMode(config?.afterHoursCallingMode);
  if (explicit)
    return explicit;
  if (!config)
    return "FORWARD_TO_AI";
  if (config.aiInboundEnabled === false)
    return "OFF";
  if (config.aiInboundEnabled === true || !!config.inboundAgentId)
    return "FORWARD_TO_AI";
  return "OFF";
}

// src/services/chime/utils/broadcast-assignment.ts
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");

// src/services/chime/utils/cloudwatch-metrics.ts
var import_client_cloudwatch2 = require("@aws-sdk/client-cloudwatch");
var cloudwatch = new import_client_cloudwatch2.CloudWatchClient({});
var NAMESPACE = process.env.CHIME_METRICS_NAMESPACE || "TodaysDental/Chime";
var METRICS_ENABLED = process.env.CHIME_METRICS_ENABLED !== "false";
var metricBatch = {
  metrics: [],
  lastFlush: Date.now()
};
var BATCH_SIZE = 20;
var FLUSH_INTERVAL_MS = 1e4;
async function publishMetric(name, value, dimensions = {}, unit = import_client_cloudwatch2.StandardUnit.Count) {
  if (!METRICS_ENABLED) {
    return;
  }
  try {
    const metric = {
      name,
      value,
      unit,
      dimensions,
      timestamp: /* @__PURE__ */ new Date()
    };
    metricBatch.metrics.push(metric);
    if (metricBatch.metrics.length >= BATCH_SIZE || Date.now() - metricBatch.lastFlush >= FLUSH_INTERVAL_MS) {
      await flushMetrics();
    }
  } catch (error) {
    console.error("[CloudWatchMetrics] Error queueing metric:", error.message);
  }
}
async function publishMetrics(metrics) {
  if (!METRICS_ENABLED) {
    return;
  }
  for (const metric of metrics) {
    await publishMetric(
      metric.name,
      metric.value,
      metric.dimensions || {},
      metric.unit || import_client_cloudwatch2.StandardUnit.Count
    );
  }
}
async function flushMetrics() {
  if (metricBatch.metrics.length === 0) {
    return;
  }
  const metricsToFlush = [...metricBatch.metrics];
  metricBatch.metrics = [];
  metricBatch.lastFlush = Date.now();
  try {
    for (let i = 0; i < metricsToFlush.length; i += BATCH_SIZE) {
      const batch = metricsToFlush.slice(i, i + BATCH_SIZE);
      await cloudwatch.send(new import_client_cloudwatch2.PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: batch.map((m) => ({
          MetricName: m.name,
          Value: m.value,
          Unit: m.unit,
          Timestamp: m.timestamp,
          Dimensions: Object.entries(m.dimensions).map(([Name, Value]) => ({
            Name,
            Value
          }))
        }))
      }));
    }
    console.log(`[CloudWatchMetrics] Flushed ${metricsToFlush.length} metrics`);
  } catch (error) {
    console.error("[CloudWatchMetrics] Error flushing metrics:", error.message);
    if (metricBatch.metrics.length < BATCH_SIZE * 5) {
      metricBatch.metrics.push(...metricsToFlush);
    }
  }
}
async function publishCallMetrics(clinicId, callType, duration = 0, waitTime = 0) {
  const metricName = callType === "answered" ? "CallsAnswered" /* CALLS_ANSWERED */ : callType === "abandoned" ? "CallsAbandoned" /* CALLS_ABANDONED */ : "CallsMissed" /* CALLS_MISSED */;
  await publishMetrics([
    {
      name: metricName,
      value: 1,
      dimensions: { ClinicId: clinicId }
    },
    {
      name: "CallVolume" /* CALL_VOLUME */,
      value: 1,
      dimensions: { ClinicId: clinicId, CallType: callType }
    },
    ...callType === "answered" ? [
      {
        name: "CallDuration" /* CALL_DURATION */,
        value: duration,
        dimensions: { ClinicId: clinicId },
        unit: import_client_cloudwatch2.StandardUnit.Seconds
      },
      {
        name: "TimeToAnswer" /* TIME_TO_ANSWER */,
        value: waitTime,
        dimensions: { ClinicId: clinicId },
        unit: import_client_cloudwatch2.StandardUnit.Seconds
      }
    ] : []
  ]);
}

// src/services/chime/utils/broadcast-assignment.ts
var DEFAULT_BROADCAST_CONFIG = {
  maxBroadcastAgents: parseInt(process.env.CHIME_MAX_BROADCAST_AGENTS || "100", 10),
  ringTimeoutSeconds: parseInt(process.env.CHIME_RING_TIMEOUT_SECONDS || "30", 10),
  enablePushNotifications: process.env.CHIME_ENABLE_PUSH_NOTIFICATIONS !== "false",
  minAgentsForBroadcast: parseInt(process.env.CHIME_MIN_AGENTS_FOR_BROADCAST || "3", 10)
};

// src/services/chime/utils/overflow-routing.ts
var import_lib_dynamodb5 = require("@aws-sdk/lib-dynamodb");
var DEFAULT_OVERFLOW_CONFIG = {
  enabled: process.env.CHIME_ENABLE_OVERFLOW === "true",
  waitThresholdSeconds: parseInt(process.env.CHIME_OVERFLOW_WAIT_THRESHOLD || "60", 10),
  maxOverflowClinics: parseInt(process.env.CHIME_MAX_OVERFLOW_CLINICS || "5", 10),
  requireSkillMatch: process.env.CHIME_OVERFLOW_REQUIRE_SKILL_MATCH !== "false",
  fallbackAction: process.env.CHIME_OVERFLOW_FALLBACK || "queue"
};
function shouldTriggerOverflow(queueWaitSeconds, primaryAgentCount, config = {}) {
  const fullConfig = { ...DEFAULT_OVERFLOW_CONFIG, ...config };
  if (!fullConfig.enabled) {
    return false;
  }
  if (queueWaitSeconds >= fullConfig.waitThresholdSeconds && primaryAgentCount === 0) {
    return true;
  }
  if (queueWaitSeconds >= fullConfig.waitThresholdSeconds * 2) {
    return true;
  }
  return false;
}
async function getOverflowClinics(ddb2, primaryClinicId, clinicsTableName) {
  try {
    const { Item: clinic } = await ddb2.send(new import_lib_dynamodb5.GetCommand({
      TableName: clinicsTableName,
      Key: { clinicId: primaryClinicId },
      ProjectionExpression: "overflowClinicIds, overflowGroup"
    }));
    if (clinic?.overflowClinicIds && Array.isArray(clinic.overflowClinicIds)) {
      return clinic.overflowClinicIds;
    }
    const envOverflow = process.env.CHIME_DEFAULT_OVERFLOW_CLINICS;
    if (envOverflow) {
      return envOverflow.split(",").map((s) => s.trim()).filter((s) => s && s !== primaryClinicId);
    }
    const { Items: allClinics } = await ddb2.send(new import_lib_dynamodb5.QueryCommand({
      TableName: clinicsTableName,
      Limit: 20
    }));
    if (allClinics) {
      return allClinics.map((c) => c.clinicId).filter((id) => id !== primaryClinicId);
    }
    return [];
  } catch (error) {
    console.error("[getOverflowClinics] Error:", error.message);
    return [];
  }
}
async function fetchOverflowAgents(ddb2, primaryClinicId, overflowClinicIds, agentPresenceTableName, callContext, config = {}) {
  const fullConfig = { ...DEFAULT_OVERFLOW_CONFIG, ...config };
  if (!fullConfig.enabled || overflowClinicIds.length === 0) {
    return {
      triggered: false,
      agents: [],
      sourceClinicIds: [],
      reason: "Overflow not enabled or no overflow clinics configured"
    };
  }
  console.log("[fetchOverflowAgents] Searching overflow clinics", {
    primaryClinicId,
    overflowClinicIds,
    callId: callContext.callId
  });
  const allOverflowAgents = [];
  const sourceClinicIds = [];
  const limitedOverflowClinics = overflowClinicIds.slice(0, fullConfig.maxOverflowClinics);
  for (const clinicId of limitedOverflowClinics) {
    try {
      const { Items: agents } = await ddb2.send(new import_lib_dynamodb5.QueryCommand({
        TableName: agentPresenceTableName,
        IndexName: "status-index",
        KeyConditionExpression: "#status = :status",
        FilterExpression: "contains(activeClinicIds, :clinicId)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "Online",
          ":clinicId": clinicId
        },
        Limit: 50
      }));
      if (agents && agents.length > 0) {
        let qualifiedAgents = agents;
        if (fullConfig.requireSkillMatch && callContext.requiredSkills?.length) {
          qualifiedAgents = agents.filter((agent) => {
            const agentSkills = agent.skills || [];
            return callContext.requiredSkills.every(
              (skill) => agentSkills.includes(skill)
            );
          });
        }
        if (qualifiedAgents.length > 0) {
          allOverflowAgents.push(...qualifiedAgents);
          sourceClinicIds.push(clinicId);
        }
      }
    } catch (error) {
      console.error(`[fetchOverflowAgents] Error querying clinic ${clinicId}:`, error.message);
    }
  }
  if (allOverflowAgents.length > 0) {
    await publishMetric("OverflowTriggered" /* OVERFLOW_TRIGGERED */, 1, {
      clinicId: primaryClinicId,
      overflowClinicCount: String(sourceClinicIds.length)
    });
  }
  console.log("[fetchOverflowAgents] Overflow search complete", {
    totalAgentsFound: allOverflowAgents.length,
    clinicsWithAgents: sourceClinicIds.length
  });
  return {
    triggered: allOverflowAgents.length > 0,
    agents: allOverflowAgents,
    sourceClinicIds,
    reason: allOverflowAgents.length > 0 ? `Found ${allOverflowAgents.length} agents from ${sourceClinicIds.length} overflow clinics` : "No agents available in overflow clinics",
    fallbackAction: allOverflowAgents.length === 0 ? fullConfig.fallbackAction : void 0
  };
}
async function attemptOverflowRouting(ddb2, callContext, queueWaitSeconds, primaryAgentCount, agentPresenceTableName, clinicsTableName, config = {}) {
  const fullConfig = { ...DEFAULT_OVERFLOW_CONFIG, ...config };
  if (!shouldTriggerOverflow(queueWaitSeconds, primaryAgentCount, config)) {
    return {
      triggered: false,
      agents: [],
      sourceClinicIds: [],
      reason: `Wait time ${queueWaitSeconds}s below threshold ${fullConfig.waitThresholdSeconds}s or agents available`
    };
  }
  console.log("[attemptOverflowRouting] Triggering overflow routing", {
    callId: callContext.callId,
    clinicId: callContext.clinicId,
    queueWaitSeconds,
    primaryAgentCount
  });
  const overflowClinicIds = await getOverflowClinics(
    ddb2,
    callContext.clinicId,
    clinicsTableName
  );
  if (overflowClinicIds.length === 0) {
    return {
      triggered: false,
      agents: [],
      sourceClinicIds: [],
      reason: "No overflow clinics configured for this clinic",
      fallbackAction: fullConfig.fallbackAction
    };
  }
  return fetchOverflowAgents(
    ddb2,
    callContext.clinicId,
    overflowClinicIds,
    agentPresenceTableName,
    callContext,
    config
  );
}

// src/services/chime/utils/smart-retry.ts
var DEFAULT_RETRY_CONFIG = {
  maxRetries: parseInt(process.env.CHIME_RETRY_MAX_ATTEMPTS || "3", 10),
  baseDelayMs: parseInt(process.env.CHIME_RETRY_BASE_DELAY_MS || "200", 10),
  maxDelayMs: parseInt(process.env.CHIME_RETRY_MAX_DELAY_MS || "5000", 10),
  jitterFactor: 0.3,
  exponentialBackoff: true
};
var DEFAULT_CIRCUIT_CONFIG = {
  failureThreshold: parseInt(process.env.CHIME_CIRCUIT_FAILURE_THRESHOLD || "5", 10),
  resetTimeoutMs: parseInt(process.env.CHIME_CIRCUIT_RESET_TIMEOUT_MS || "30000", 10),
  successThreshold: parseInt(process.env.CHIME_CIRCUIT_SUCCESS_THRESHOLD || "3", 10)
};

// src/services/chime/utils/enhanced-agent-selection.ts
var import_lib_dynamodb6 = require("@aws-sdk/lib-dynamodb");
var DEFAULT_ENHANCED_CONFIG = {
  useTimeOfDayWeighting: process.env.CHIME_USE_TIME_OF_DAY_WEIGHTING === "true",
  useHistoricalPerformance: process.env.CHIME_USE_HISTORICAL_PERFORMANCE !== "false",
  fairDistributionMode: process.env.CHIME_FAIR_DISTRIBUTION_MODE === "true",
  performanceWeight: parseFloat(process.env.CHIME_PERFORMANCE_WEIGHT || "0.3"),
  maxCallsBeforeDeprioritize: parseInt(process.env.CHIME_MAX_CALLS_BEFORE_DEPRIORITIZE || "15", 10),
  performanceWindowHours: parseInt(process.env.CHIME_PERFORMANCE_WINDOW_HOURS || "24", 10)
};

// src/services/chime/utils/supervisor-tools.ts
var import_lib_dynamodb7 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");
var chimeClient = new import_client_chime_sdk_meetings.ChimeSDKMeetingsClient({});

// src/services/chime/utils/sentiment-analyzer.ts
var import_client_comprehend = require("@aws-sdk/client-comprehend");
var import_lib_dynamodb8 = require("@aws-sdk/lib-dynamodb");
var comprehend = new import_client_comprehend.ComprehendClient({});
var DEFAULT_SENTIMENT_CONFIG = {
  enableRealTime: process.env.CHIME_ENABLE_REALTIME_SENTIMENT !== "false",
  negativeAlertThreshold: parseFloat(process.env.CHIME_NEGATIVE_SENTIMENT_THRESHOLD || "0.7"),
  minTextLength: parseInt(process.env.CHIME_MIN_SENTIMENT_TEXT_LENGTH || "20", 10),
  language: "en",
  enableSupervisorAlerts: process.env.CHIME_ENABLE_SENTIMENT_ALERTS === "true"
};

// src/services/chime/utils/call-summarizer.ts
var import_client_bedrock_runtime = require("@aws-sdk/client-bedrock-runtime");
var import_lib_dynamodb9 = require("@aws-sdk/lib-dynamodb");
var bedrock = new import_client_bedrock_runtime.BedrockRuntimeClient({});
var BEDROCK_MODEL_ID = process.env.BEDROCK_SUMMARY_MODEL_ID || "anthropic.claude-3-sonnet-20240229-v1:0";
var DEFAULT_SUMMARY_CONFIG = {
  enabled: process.env.CHIME_ENABLE_CALL_SUMMARY !== "false",
  modelId: BEDROCK_MODEL_ID,
  maxTokens: parseInt(process.env.CHIME_SUMMARY_MAX_TOKENS || "1024", 10),
  includeSentiment: true,
  generateFollowUps: true
};

// src/services/chime/utils/quality-scoring.ts
var import_lib_dynamodb10 = require("@aws-sdk/lib-dynamodb");
var DEFAULT_QUALITY_CONFIG = {
  enabled: process.env.CHIME_ENABLE_QUALITY_SCORING !== "false",
  weights: {
    audio: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AUDIO || "0.15"),
    agent: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AGENT || "0.35"),
    customer: parseFloat(process.env.CHIME_QUALITY_WEIGHT_CUSTOMER || "0.35"),
    compliance: parseFloat(process.env.CHIME_QUALITY_WEIGHT_COMPLIANCE || "0.15")
  },
  alertThresholds: {
    audioMinScore: 50,
    agentMinScore: 60,
    overallMinScore: 60
  }
};
function calculateAudioQualityScore(metrics) {
  if (metrics.mos && metrics.mos > 0) {
    return Math.round((metrics.mos - 1) * 25);
  }
  let score = 100;
  score -= metrics.packetLoss * 10;
  score -= Math.min(30, metrics.jitter / 10 * 5);
  if (metrics.latency > 100) {
    score -= Math.min(30, (metrics.latency - 100) / 50 * 5);
  }
  return Math.max(0, Math.round(score));
}
function calculateAgentPerformanceScore(metrics) {
  let score = 100;
  if (metrics.responseTime > 10) {
    score -= Math.min(20, (metrics.responseTime - 10) * 2);
  }
  score -= metrics.holdCount * 5;
  if (metrics.holdCount > 0) {
    const avgHold = metrics.totalHoldTime / metrics.holdCount;
    if (avgHold > 120) {
      score -= 10;
    }
  }
  score -= Math.min(20, metrics.transferCount * 10);
  if (metrics.scriptAdherence !== void 0) {
    score += metrics.scriptAdherence / 100 * 10 - 5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
function calculateCustomerExperienceScore(metrics) {
  if (metrics.abandonedBeforeConnect) {
    return 0;
  }
  let score = 50;
  score -= Math.min(30, metrics.waitTime / 10);
  switch (metrics.sentiment.toUpperCase()) {
    case "POSITIVE":
      score += 30;
      break;
    case "NEUTRAL":
      score += 10;
      break;
    case "MIXED":
      break;
    case "NEGATIVE":
      score -= 20;
      break;
  }
  if (metrics.resolved) {
    score += 20;
  } else {
    score -= 10;
  }
  if (metrics.escalated) {
    score -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
function calculateComplianceScore(metrics) {
  let score = 100;
  if (!metrics.hipaaCompliant) {
    score -= 50;
  }
  if (metrics.piiMentioned) {
    if (metrics.recordingEnabled) {
      score -= 10;
    }
  }
  if (metrics.consentObtained === true) {
    score += 5;
  } else if (metrics.consentObtained === false) {
    score -= 15;
  }
  if (metrics.disclosuresMade === true) {
    score += 5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
function calculateQualityMetrics(callData, config = {}) {
  const fullConfig = { ...DEFAULT_QUALITY_CONFIG, ...config };
  const audioScore = calculateAudioQualityScore({
    packetLoss: callData.packetLoss || 0,
    jitter: callData.jitter || 0,
    latency: callData.latency || 0,
    mos: callData.mos
  });
  const agentScore = calculateAgentPerformanceScore({
    responseTime: callData.responseTime || 0,
    holdCount: callData.holdCount || 0,
    totalHoldTime: callData.totalHoldTime || 0,
    transferCount: callData.transferCount || 0,
    callDuration: callData.callDuration,
    scriptAdherence: callData.scriptAdherence
  });
  const customerScore = calculateCustomerExperienceScore({
    waitTime: callData.waitTime,
    sentiment: callData.sentiment,
    resolved: callData.resolved,
    escalated: callData.escalated,
    abandonedBeforeConnect: callData.abandoned
  });
  const complianceScore = calculateComplianceScore({
    piiMentioned: callData.piiMentioned || false,
    hipaaCompliant: callData.hipaaCompliant !== false,
    consentObtained: callData.consentObtained,
    disclosuresMade: callData.disclosuresMade,
    recordingEnabled: callData.recordingEnabled || false
  });
  const overallScore = Math.round(
    audioScore * fullConfig.weights.audio + agentScore * fullConfig.weights.agent + customerScore * fullConfig.weights.customer + complianceScore * fullConfig.weights.compliance
  );
  return {
    audioQuality: {
      score: audioScore,
      packetLoss: callData.packetLoss || 0,
      jitter: callData.jitter || 0,
      latency: callData.latency || 0,
      mos: callData.mos || 0
    },
    agentPerformance: {
      score: agentScore,
      responseTime: callData.responseTime || 0,
      holdCount: callData.holdCount || 0,
      totalHoldTime: callData.totalHoldTime || 0,
      transferCount: callData.transferCount || 0,
      scriptAdherence: callData.scriptAdherence
    },
    customerExperience: {
      score: customerScore,
      waitTime: callData.waitTime,
      sentiment: callData.sentiment,
      resolved: callData.resolved,
      escalated: callData.escalated
    },
    compliance: {
      score: complianceScore,
      piiMentioned: callData.piiMentioned || false,
      hipaaCompliant: callData.hipaaCompliant !== false,
      consentObtained: callData.consentObtained,
      disclosuresMade: callData.disclosuresMade
    },
    overallScore,
    weights: fullConfig.weights
  };
}
async function saveQualityMetrics(ddb2, callId, clinicId, timestamp, metrics, callAnalyticsTableName) {
  try {
    await ddb2.send(new import_lib_dynamodb10.UpdateCommand({
      TableName: callAnalyticsTableName,
      Key: { callId, timestamp },
      UpdateExpression: `
        SET qualityScore = :overall,
            audioQualityScore = :audio,
            agentPerformanceScore = :agent,
            customerExperienceScore = :customer,
            complianceScore = :compliance,
            qualityMetrics = :metrics,
            qualityScoreCalculatedAt = :time
      `,
      ExpressionAttributeValues: {
        ":overall": metrics.overallScore,
        ":audio": metrics.audioQuality.score,
        ":agent": metrics.agentPerformance.score,
        ":customer": metrics.customerExperience.score,
        ":compliance": metrics.compliance.score,
        ":metrics": metrics,
        ":time": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
    await publishMetric("CallQualityScore" /* CALL_QUALITY_SCORE */, metrics.overallScore, {
      clinicId
    });
    console.log("[saveQualityMetrics] Saved", { callId, overallScore: metrics.overallScore });
  } catch (error) {
    console.error("[saveQualityMetrics] Error:", error.message);
  }
}
function shouldAlertOnQuality(metrics, config = {}) {
  const fullConfig = { ...DEFAULT_QUALITY_CONFIG, ...config };
  const reasons = [];
  if (metrics.audioQuality.score < fullConfig.alertThresholds.audioMinScore) {
    reasons.push(`Low audio quality: ${metrics.audioQuality.score}`);
  }
  if (metrics.agentPerformance.score < fullConfig.alertThresholds.agentMinScore) {
    reasons.push(`Low agent performance: ${metrics.agentPerformance.score}`);
  }
  if (metrics.overallScore < fullConfig.alertThresholds.overallMinScore) {
    reasons.push(`Low overall quality: ${metrics.overallScore}`);
  }
  if (!metrics.compliance.hipaaCompliant) {
    reasons.push("HIPAA compliance issue detected");
  }
  return {
    alert: reasons.length > 0,
    reasons
  };
}

// src/services/chime/utils/pii-redactor.ts
var import_client_comprehend2 = require("@aws-sdk/client-comprehend");
var comprehend2 = new import_client_comprehend2.ComprehendClient({});
var DEFAULT_REDACTION_CONFIG = {
  enabled: process.env.CHIME_ENABLE_PII_REDACTION !== "false",
  typesToRedact: [
    "SSN",
    "CREDIT_DEBIT_NUMBER",
    "CREDIT_DEBIT_CVV",
    "CREDIT_DEBIT_EXPIRY",
    "PHONE",
    "EMAIL",
    "ADDRESS",
    "DATE_TIME",
    "NAME",
    "DRIVER_ID",
    "PASSPORT_NUMBER",
    "BANK_ACCOUNT_NUMBER",
    "BANK_ROUTING"
  ],
  replacementTemplate: "[REDACTED-{TYPE}]",
  useComprehend: process.env.CHIME_USE_COMPREHEND_PII !== "false",
  language: "en",
  auditLog: process.env.CHIME_PII_AUDIT_LOG === "true"
};
function maskPhoneNumber(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4)
    return "****";
  return `***-***-${digits.slice(-4)}`;
}
function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain)
    return "***@***";
  return `${local.charAt(0)}***@${domain}`;
}
function getSafeLogData(data, sensitiveKeys = ["phoneNumber", "callerPhoneNumber", "email", "name"]) {
  const safe = { ...data };
  for (const key of sensitiveKeys) {
    if (safe[key]) {
      if (key.toLowerCase().includes("phone")) {
        safe[key] = maskPhoneNumber(String(safe[key]));
      } else if (key.toLowerCase().includes("email")) {
        safe[key] = maskEmail(String(safe[key]));
      } else {
        safe[key] = "[REDACTED]";
      }
    }
  }
  return safe;
}

// src/services/chime/utils/call-audit-logger.ts
var import_lib_dynamodb11 = require("@aws-sdk/lib-dynamodb");
var DEFAULT_AUDIT_CONFIG = {
  enabled: process.env.CHIME_ENABLE_AUDIT_LOGGING !== "false",
  logPiiAccess: process.env.CHIME_LOG_PII_ACCESS === "true",
  retentionDays: parseInt(process.env.CHIME_AUDIT_RETENTION_DAYS || "2555", 10),
  // 7 years for HIPAA
  cloudWatchEnabled: process.env.CHIME_AUDIT_CLOUDWATCH !== "false",
  redactSensitiveData: process.env.CHIME_AUDIT_REDACT !== "false"
};
function generateAuditId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `audit-${timestamp}-${random}`;
}
function createAuditEvent(eventType, actor, target, clinicId, details = {}, options = {}) {
  let severity = options.severity || "INFO" /* INFO */;
  if ([
    "AUTH_FAILURE" /* AUTH_FAILURE */,
    "UNAUTHORIZED_ACCESS" /* UNAUTHORIZED_ACCESS */,
    "PII_DISCLOSED" /* PII_DISCLOSED */
  ].includes(eventType)) {
    severity = "CRITICAL" /* CRITICAL */;
  } else if ([
    "PII_ACCESSED" /* PII_ACCESSED */,
    "PATIENT_DATA_MODIFIED" /* PATIENT_DATA_MODIFIED */,
    "RECORDING_DELETED" /* RECORDING_DELETED */,
    "CONFIG_CHANGED" /* CONFIG_CHANGED */
  ].includes(eventType)) {
    severity = "WARNING" /* WARNING */;
  }
  return {
    eventId: generateAuditId(),
    eventType,
    severity,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    targetType: target.type,
    targetId: target.id,
    clinicId,
    callId: options.callId,
    details,
    piiAccessed: options.piiAccessed || false,
    hipaaRelevant: options.hipaaRelevant || false,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    requestId: options.requestId
  };
}
async function logAuditEvent(ddb2, event, auditTableName, config = {}) {
  const fullConfig = { ...DEFAULT_AUDIT_CONFIG, ...config };
  if (!fullConfig.enabled) {
    return { success: false, eventId: event.eventId };
  }
  try {
    const safeDetails = fullConfig.redactSensitiveData ? getSafeLogData(event.details) : event.details;
    const ttl = Math.floor(Date.now() / 1e3) + fullConfig.retentionDays * 24 * 60 * 60;
    await ddb2.send(new import_lib_dynamodb11.PutCommand({
      TableName: auditTableName,
      Item: {
        ...event,
        details: safeDetails,
        ttl,
        // Partition key for efficient querying
        pk: `CLINIC#${event.clinicId}`,
        sk: `${event.timestamp}#${event.eventId}`,
        // GSI keys
        gsi1pk: `EVENT#${event.eventType}`,
        gsi1sk: event.timestamp,
        gsi2pk: event.callId ? `CALL#${event.callId}` : `NOCALL#${event.clinicId}`,
        gsi2sk: event.timestamp
      }
    }));
    if (fullConfig.cloudWatchEnabled) {
      console.log(JSON.stringify({
        logType: "AUDIT",
        ...event,
        details: safeDetails
      }));
    }
    return { success: true, eventId: event.eventId };
  } catch (error) {
    console.error("[logAuditEvent] Error:", error.message);
    return { success: false, eventId: event.eventId };
  }
}

// src/services/chime/utils/performance-tracker.ts
var PERFORMANCE_THRESHOLDS = {
  AGENT_SELECTION: parseInt(process.env.PERF_THRESHOLD_AGENT_SELECTION || "200", 10),
  BROADCAST_RING: parseInt(process.env.PERF_THRESHOLD_BROADCAST_RING || "500", 10),
  DDB_QUERY: parseInt(process.env.PERF_THRESHOLD_DDB_QUERY || "100", 10),
  AI_RESPONSE: parseInt(process.env.PERF_THRESHOLD_AI_RESPONSE || "5000", 10),
  TOTAL_ROUTING: parseInt(process.env.PERF_THRESHOLD_TOTAL_ROUTING || "2000", 10)
};

// src/services/chime/inbound-router.ts
var ddb = import_lib_dynamodb12.DynamoDBDocumentClient.from(new import_client_dynamodb3.DynamoDBClient({}));
var ttsS3 = new import_client_s3.S3Client({ region: process.env.AWS_REGION || "us-east-1" });
var polly = new import_client_polly2.PollyClient({ region: process.env.AWS_REGION || "us-east-1" });
var CHIME_MEDIA_REGION2 = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chime = new import_client_chime_sdk_meetings2.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION2 });
var CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var AGENT_ACTIVE_TABLE_NAME = process.env.AGENT_ACTIVE_TABLE_NAME || "";
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var CALL_AUDIT_TABLE_NAME = process.env.CALL_AUDIT_TABLE_NAME || "";
var LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
var VOICE_CALL_ANALYTICS_TABLE = process.env.VOICE_CALL_ANALYTICS_TABLE;
var HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET;
var POLLY_VOICE_ID = process.env.POLLY_VOICE_ID || "Joanna";
var POLLY_ENGINE = process.env.POLLY_ENGINE || "standard";
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var CLINIC_HOURS_TABLE2 = process.env.CLINIC_HOURS_TABLE;
var ENABLE_AFTER_HOURS_AI = process.env.ENABLE_AFTER_HOURS_AI === "true";
function isValidTransactionId(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}
var QUEUE_TIMEOUT = 24 * 60 * 60;
var AVG_CALL_DURATION = 300;
var MAX_RING_AGENTS = Math.max(1, Number.parseInt(process.env.MAX_RING_AGENTS || "25", 10));
var didWarnMissingAuditTable = false;
async function addToQueue(clinicId, callId, phoneNumber) {
  const now = Math.floor(Date.now() / 1e3);
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { Items: existingCalls } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId }
    }));
    if (existingCalls && existingCalls.length > 0) {
      const existingEntry = existingCalls[0];
      console.warn("[addToQueue] Call already exists in queue - returning existing entry", {
        clinicId,
        callId,
        existingStatus: existingEntry.status,
        existingPosition: existingEntry.queuePosition,
        attempt
      });
      return existingEntry;
    }
    const { queuePosition, uniquePositionId } = generateUniqueCallPosition();
    const entry = {
      clinicId,
      callId,
      phoneNumber,
      queuePosition,
      queueEntryTime: now,
      queueEntryTimeIso: (/* @__PURE__ */ new Date()).toISOString(),
      uniquePositionId,
      status: "queued",
      ttl: now + QUEUE_TIMEOUT,
      priority: "normal",
      direction: "inbound"
    };
    try {
      await ddb.send(new import_lib_dynamodb12.PutCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Item: entry,
        // FIX #10: Added callId uniqueness condition to prevent duplicates due to GSI eventual consistency
        ConditionExpression: "attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)"
      }));
      console.log("[addToQueue] Successfully queued call", { clinicId, callId, queuePosition, attempt });
      return entry;
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        console.warn("[addToQueue] Position collision - will retry", { clinicId, callId, queuePosition, attempt });
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
        }
      } else {
        throw err;
      }
    }
  }
  const { Items: finalCheck } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
    TableName: CALL_QUEUE_TABLE_NAME,
    IndexName: "callId-index",
    KeyConditionExpression: "callId = :callId",
    ExpressionAttributeValues: { ":callId": callId }
  }));
  if (finalCheck && finalCheck.length > 0) {
    console.warn("[addToQueue] Found call after retries exhausted - likely added by parallel request", { callId });
    return finalCheck[0];
  }
  throw new Error(`[addToQueue] Failed to queue call after ${MAX_RETRIES} attempts: ${callId}`);
}
var vipPhoneNumbersCache = null;
function getVipPhoneNumbers() {
  if (vipPhoneNumbersCache !== null) {
    return vipPhoneNumbersCache;
  }
  try {
    const raw = process.env.VIP_PHONE_NUMBERS;
    if (!raw) {
      vipPhoneNumbersCache = /* @__PURE__ */ new Set();
      return vipPhoneNumbersCache;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      vipPhoneNumbersCache = new Set(parsed.map((v) => String(v)));
      console.log("[inbound-router] VIP phone numbers loaded", {
        count: vipPhoneNumbersCache.size
      });
    } else {
      console.warn("[inbound-router] VIP_PHONE_NUMBERS is not an array");
      vipPhoneNumbersCache = /* @__PURE__ */ new Set();
    }
  } catch (err) {
    console.warn("[inbound-router] Failed to parse VIP_PHONE_NUMBERS:", err);
    vipPhoneNumbersCache = /* @__PURE__ */ new Set();
  }
  return vipPhoneNumbersCache;
}
async function getQueuePosition(clinicId, callId) {
  try {
    const { Items: thisCallItems } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: { ":callId": callId }
    }));
    if (!thisCallItems?.[0])
      return null;
    const thisCall = thisCallItems[0];
    const { queueEntryTime, status } = thisCall;
    if (status !== "queued" || !queueEntryTime)
      return null;
    const { Items: allQueuedCalls } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      KeyConditionExpression: "clinicId = :cid",
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":cid": clinicId,
        ":status": "queued"
      },
      ConsistentRead: true
    }));
    if (!allQueuedCalls)
      return null;
    const sortedCalls = allQueuedCalls.sort((a, b) => a.queueEntryTime - b.queueEntryTime);
    const index = sortedCalls.findIndex((call) => call.callId === callId);
    if (index === -1)
      return null;
    const position = index + 1;
    const { Items: onlineAgents } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
      TableName: AGENT_PRESENCE_TABLE_NAME,
      IndexName: "status-index",
      KeyConditionExpression: "#status = :status",
      FilterExpression: "contains(activeClinicIds, :clinicId)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "Online",
        ":clinicId": clinicId
      }
    }));
    const numAgents = onlineAgents?.length || 1;
    const estimatedWaitTime = Math.ceil(position / numAgents * AVG_CALL_DURATION);
    return { position, estimatedWaitTime };
  } catch (err) {
    console.error("[getQueuePosition] Error calculating queue position:", err);
    return null;
  }
}
var buildActions = (actions) => ({
  SchemaVersion: "1.0",
  Actions: actions
});
var buildJoinChimeMeetingAction = (callLegId, meetingInfo, attendeeInfo) => ({
  Type: "JoinChimeMeeting",
  Parameters: {
    CallId: callLegId,
    JoinToken: attendeeInfo.JoinToken,
    MeetingId: meetingInfo.MeetingId,
    AttendeeId: attendeeInfo.AttendeeId
  }
});
var buildCallAndBridgeAction = (callerIdNumber, targetPhoneNumber, sipHeaders) => ({
  Type: "CallAndBridge",
  Parameters: {
    CallTimeoutSeconds: 30,
    CallerIdNumber: callerIdNumber,
    Endpoints: [{
      Uri: targetPhoneNumber,
      BridgeEndpointType: "PSTN"
    }],
    SipHeaders: sipHeaders || {}
  }
});
var buildSpeakAction = (text, voiceId = "Joanna", engine = "neural", callId, languageCode = "en-US", textType = "text") => ({
  Type: "Speak",
  Parameters: {
    Text: text,
    Engine: engine,
    LanguageCode: languageCode,
    TextType: textType,
    VoiceId: voiceId,
    ...callId && { CallId: callId }
  }
});
var buildSpeakAndBridgeAction = (text, voiceId = "Joanna", engine = "neural") => ({
  Type: "SpeakAndBridge",
  Parameters: {
    Text: text,
    Engine: engine,
    LanguageCode: "en-US",
    TextType: "text",
    VoiceId: voiceId
  }
});
var buildPauseAction = (durationInMilliseconds, callId) => ({
  Type: "Pause",
  Parameters: {
    DurationInMilliseconds: durationInMilliseconds,
    ...callId && { CallId: callId }
  }
});
var buildPlayAudioAction = (audioSource, repeat = 1, callId) => ({
  Type: "PlayAudio",
  Parameters: {
    AudioSource: {
      Type: "S3",
      BucketName: HOLD_MUSIC_BUCKET,
      Key: audioSource
    },
    PlaybackTerminators: ["#", "*"],
    Repeat: repeat,
    ...callId && { CallId: callId }
  }
});
var buildHangupAction = (message) => {
  if (message) {
    return {
      Type: "Speak",
      Parameters: {
        Text: message,
        Engine: "neural",
        LanguageCode: "en-US",
        TextType: "text",
        VoiceId: "Joanna"
      }
    };
  }
  return { Type: "Hangup" };
};
var buildStartCallRecordingAction = (callId, recordingBucketName) => ({
  Type: "StartCallRecording",
  Parameters: {
    CallId: callId,
    Track: "BOTH",
    // Valid values: INCOMING, OUTGOING, or BOTH
    Destination: {
      Type: "S3",
      // Location is a single string: bucketname/prefix/path
      // AWS automatically appends: year/month/date/timestamp_transactionId_callId.wav
      Location: `${recordingBucketName}/recordings/${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}/${callId}/`
    }
  }
});
async function cleanupMeeting(meetingId) {
  try {
    await chime.send(new import_client_chime_sdk_meetings2.DeleteMeetingCommand({ MeetingId: meetingId }));
  } catch (err) {
    if (err.name !== "NotFoundException") {
      console.warn("Error cleaning up meeting:", err);
    }
  }
}
async function upsertVoiceCallAnalytics(callId, data) {
  if (!VOICE_CALL_ANALYTICS_TABLE)
    return;
  try {
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const ttl = Math.floor(Date.now() / 1e3) + 365 * 24 * 60 * 60;
    const exprNames = { "#status": "status" };
    const exprValues = {
      ":now": nowIso,
      ":ttl": ttl,
      ":status": String(data.status || "UNKNOWN")
    };
    let updateExpr = "SET updatedAt = :now, ttl = if_not_exists(ttl, :ttl), #status = :status";
    const setIfNotExists = (attr, value, token) => {
      if (value === void 0 || value === null || String(value).length === 0)
        return;
      exprValues[token] = value;
      updateExpr += `, ${attr} = if_not_exists(${attr}, ${token})`;
    };
    setIfNotExists("clinicId", data.clinicId, ":clinicId");
    setIfNotExists("scheduleId", data.scheduleId, ":scheduleId");
    setIfNotExists("templateName", data.templateName, ":templateName");
    setIfNotExists("patNum", data.patNum, ":patNum");
    setIfNotExists("patientName", data.patientName, ":patientName");
    setIfNotExists("recipientPhone", data.recipientPhone, ":recipientPhone");
    setIfNotExists("fromPhoneNumber", data.fromPhoneNumber, ":fromPhoneNumber");
    setIfNotExists("meetingId", data.meetingId, ":meetingId");
    setIfNotExists("voiceId", data.voiceId, ":voiceId");
    setIfNotExists("voiceEngine", data.voiceEngine, ":voiceEngine");
    setIfNotExists("voiceLanguageCode", data.voiceLanguageCode, ":voiceLanguageCode");
    setIfNotExists("source", data.source, ":source");
    if (data.startedAt) {
      exprValues[":startedAt"] = data.startedAt;
      updateExpr += ", startedAt = if_not_exists(startedAt, :startedAt)";
    }
    if (data.answeredAt) {
      exprValues[":answeredAt"] = data.answeredAt;
      updateExpr += ", answeredAt = :answeredAt";
    }
    if (data.endedAt) {
      exprValues[":endedAt"] = data.endedAt;
      updateExpr += ", endedAt = :endedAt";
    }
    if (data.sipResponseCode !== void 0) {
      exprValues[":sip"] = String(data.sipResponseCode);
      updateExpr += ", sipResponseCode = :sip";
    }
    if (data.endReason !== void 0) {
      exprValues[":reason"] = String(data.endReason);
      updateExpr += ", endReason = :reason";
    }
    await ddb.send(new import_lib_dynamodb12.UpdateCommand({
      TableName: VOICE_CALL_ANALYTICS_TABLE,
      Key: { callId },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues
    }));
  } catch (err) {
    console.warn("[VoiceCallAnalytics] Failed to upsert (non-fatal):", err?.message || err);
  }
}
async function isClinicOpen(clinicId) {
  if (!CLINIC_HOURS_TABLE2) {
    console.warn("[isClinicOpen] CLINIC_HOURS_TABLE not configured - assuming open");
    return true;
  }
  try {
    const { Item } = await ddb.send(new import_lib_dynamodb12.GetCommand({
      TableName: CLINIC_HOURS_TABLE2,
      Key: { clinicId }
    }));
    if (!Item) {
      console.log("[isClinicOpen] No hours configured for clinic - defaulting to closed");
      return false;
    }
    const now = /* @__PURE__ */ new Date();
    const timezone = Item.timeZone || Item.timezone || "America/New_York";
    const options = {
      timeZone: timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    };
    const formatter = new Intl.DateTimeFormat("en-US", options);
    const parts = formatter.formatToParts(now);
    const dayOfWeek = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
    const currentTime = hour * 60 + minute;
    const todayHours = Item[dayOfWeek] || Item.hours?.[dayOfWeek];
    if (!todayHours) {
      console.log("[isClinicOpen] No hours for today - clinic closed", { clinicId, dayOfWeek });
      return false;
    }
    if (todayHours.closed) {
      console.log("[isClinicOpen] Clinic is marked closed today", { clinicId, dayOfWeek });
      return false;
    }
    if (!todayHours.open || !todayHours.close) {
      console.log("[isClinicOpen] Missing open/close times - assuming closed", { clinicId, dayOfWeek, todayHours });
      return false;
    }
    const [openHour, openMin] = todayHours.open.split(":").map(Number);
    const [closeHour, closeMin] = todayHours.close.split(":").map(Number);
    const openTime = openHour * 60 + openMin;
    const closeTime = closeHour * 60 + closeMin;
    const isOpen = currentTime >= openTime && currentTime < closeTime;
    console.log("[isClinicOpen] Clinic hours check", {
      clinicId,
      dayOfWeek,
      timezone,
      currentTime: `${hour}:${minute}`,
      openTime: todayHours.open,
      closeTime: todayHours.close,
      isOpen
    });
    return isOpen;
  } catch (error) {
    console.error("[isClinicOpen] Error checking clinic hours:", error);
    return false;
  }
}
var E164_REGEX = /^\+[1-9]\d{1,14}$/;
function parsePhoneNumber(sipUri) {
  try {
    const match = sipUri.match(/sip:(\+\d+)@/);
    if (!match)
      return null;
    const phoneNumber = match[1];
    if (!E164_REGEX.test(phoneNumber)) {
      console.warn("[parsePhoneNumber] Invalid E.164 format detected", {
        raw: phoneNumber,
        reason: phoneNumber.length > 16 ? "too long" : phoneNumber.length < 2 ? "too short" : "invalid format"
      });
      return null;
    }
    return phoneNumber;
  } catch {
    return null;
  }
}
function getPstnLegCallId(event) {
  const participants = event?.CallDetails?.Participants;
  if (!Array.isArray(participants) || participants.length === 0) {
    return void 0;
  }
  const legAParticipant = participants.find((participant) => participant.ParticipantTag === "LEG-A");
  if (legAParticipant?.CallId) {
    return legAParticipant.CallId;
  }
  const pstnParticipant = participants.find(
    (participant) => participant.ParticipantTag === "LEG-B" || // Outbound PSTN is typically LEG-B
    participant.Direction === "Outbound" || participant.CallLegType === "PSTN"
  );
  if (pstnParticipant?.CallId) {
    return pstnParticipant.CallId;
  }
  console.warn("[getPstnLegCallId] No PSTN leg found in participants", {
    participantCount: participants.length,
    tags: participants.map((p) => p.ParticipantTag),
    types: participants.map((p) => p.CallLegType)
  });
  return void 0;
}
var handler = async (event) => {
  console.log("SMA Event:", JSON.stringify(event, null, 2));
  const eventType = event?.InvocationEventType;
  const callId = event?.CallDetails?.TransactionId;
  if (!isValidTransactionId(callId)) {
    console.error("[inbound-router] Invalid or missing TransactionId", {
      rawTransactionId: callId,
      eventType: event?.InvocationEventType
    });
    return buildActions([buildHangupAction("There was an error connecting your call. Please try again later.")]);
  }
  const args = event?.ActionData?.Parameters?.Arguments || event?.ActionData?.ArgumentsMap || event?.CallDetails?.ArgumentsMap || {};
  const pstnLegCallId = getPstnLegCallId(event);
  try {
    switch (eventType) {
      case "NEW_INBOUND_CALL": {
        const sipHeaders = event?.CallDetails?.SipHeaders || {};
        const getPhoneFromValue = (value) => {
          if (!value)
            return null;
          if (value.startsWith("+"))
            return value;
          return parsePhoneNumber(value);
        };
        const participants = event?.CallDetails?.Participants || [];
        const participantTo = participants[0]?.To;
        const participantFrom = participants[0]?.From;
        const toPhoneNumber = getPhoneFromValue(typeof sipHeaders.To === "string" ? sipHeaders.To : null) || getPhoneFromValue(typeof participantTo === "string" ? participantTo : null);
        const fromPhoneNumber = getPhoneFromValue(typeof sipHeaders.From === "string" ? sipHeaders.From : null) || getPhoneFromValue(typeof participantFrom === "string" ? participantFrom : null) || "Unknown";
        console.log("[NEW_INBOUND_CALL] Received inbound call", { callId, to: toPhoneNumber, from: fromPhoneNumber });
        if (!toPhoneNumber) {
          console.error("Could not parse 'To' phone number from event", {
            rawSipTo: event.CallDetails?.SipHeaders?.To,
            rawParticipantTo: participantTo
          });
          return buildActions([buildHangupAction("There was an error connecting your call.")]);
        }
        const { Items: clinics } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
          TableName: CLINICS_TABLE_NAME,
          IndexName: "phoneNumber-index",
          // Make sure this GSI exists
          KeyConditionExpression: "phoneNumber = :num",
          ExpressionAttributeValues: { ":num": toPhoneNumber }
        }));
        if (!clinics || clinics.length === 0) {
          console.warn(`No clinic found for number ${toPhoneNumber}`);
          return buildActions([buildHangupAction("The number you dialed is not in service.")]);
        }
        const clinic = clinics[0];
        const clinicId = clinic.clinicId;
        const aiPhoneNumber = typeof clinic.aiPhoneNumber === "string" ? clinic.aiPhoneNumber.trim() : "";
        console.log(`[NEW_INBOUND_CALL] Call is for clinic ${clinicId}`);
        if (ENABLE_AFTER_HOURS_AI) {
          const afterHoursMode = await getAfterHoursCallingMode(clinicId);
          if (afterHoursMode === "OFF") {
            console.log(`[NEW_INBOUND_CALL] After-hours calling is OFF - routing to human agents regardless of clinic hours`, {
              callId,
              clinicId,
              callerNumber: fromPhoneNumber
            });
          } else {
            const clinicOpen = await isClinicOpen(clinicId);
            if (!clinicOpen) {
              const clinicName = clinic.clinicName || "our dental office";
              if (afterHoursMode === "PLAY_CLOSED_MESSAGE") {
                console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED - playing closed message (after-hours mode)`, {
                  callId,
                  clinicId,
                  callerNumber: fromPhoneNumber
                });
                return buildActions([
                  buildSpeakAction(
                    `Thank you for calling ${clinicName}. We are currently closed. Please call back during business hours.`
                  ),
                  { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
                ]);
              }
              if (aiPhoneNumber) {
                console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED - forwarding to AI phone number`, {
                  callId,
                  clinicId,
                  callerNumber: fromPhoneNumber,
                  aiPhoneNumber
                });
                return buildActions([
                  buildSpeakAction("Please hold while we connect you to our after-hours assistant."),
                  buildCallAndBridgeAction(
                    toPhoneNumber,
                    // Caller ID shows the clinic's main number
                    aiPhoneNumber,
                    // Forward to the AI phone number
                    {
                      "X-Clinic-Id": clinicId,
                      "X-Forward-Reason": "after-hours",
                      "X-Original-Caller": fromPhoneNumber
                    }
                  )
                ]);
              }
              console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED - after-hours mode is FORWARD_TO_AI but no aiPhoneNumber configured; ending call`, {
                callId,
                clinicId,
                callerNumber: fromPhoneNumber
              });
              return buildActions([
                buildSpeakAction(
                  `Thank you for calling ${clinicName}. We are currently closed. Please call back during business hours.`
                ),
                { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
              ]);
            } else {
              console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is OPEN - proceeding with human agent routing`);
            }
          }
        }
        const callContext = await enrichCallContext(
          ddb,
          callId,
          clinicId,
          fromPhoneNumber,
          CALL_QUEUE_TABLE_NAME,
          getVipPhoneNumbers()
        );
        const queueEntry = await addToQueue(clinicId, callId, fromPhoneNumber);
        try {
          const routingUpdateParts = [
            "priority = :priority",
            "isVip = :isVip",
            "isCallback = :isCallback",
            "previousCallCount = :previousCallCount",
            "updatedAt = :updatedAt"
          ];
          const routingValues = {
            ":priority": callContext.priority || "normal",
            ":isVip": !!callContext.isVip,
            ":isCallback": !!callContext.isCallback,
            ":previousCallCount": typeof callContext.previousCallCount === "number" ? callContext.previousCallCount : 0,
            ":updatedAt": (/* @__PURE__ */ new Date()).toISOString()
          };
          if (typeof callContext.previousAgentId === "string" && callContext.previousAgentId.length > 0) {
            routingUpdateParts.push("previousAgentId = :previousAgentId");
            routingValues[":previousAgentId"] = callContext.previousAgentId;
          }
          if (Array.isArray(callContext.requiredSkills) && callContext.requiredSkills.length > 0) {
            routingUpdateParts.push("requiredSkills = :requiredSkills");
            routingValues[":requiredSkills"] = callContext.requiredSkills;
          }
          if (Array.isArray(callContext.preferredSkills) && callContext.preferredSkills.length > 0) {
            routingUpdateParts.push("preferredSkills = :preferredSkills");
            routingValues[":preferredSkills"] = callContext.preferredSkills;
          }
          if (typeof callContext.language === "string" && callContext.language.length > 0) {
            routingUpdateParts.push("#language = :language");
            routingValues[":language"] = callContext.language;
          }
          await ddb.send(new import_lib_dynamodb12.UpdateCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: { clinicId, queuePosition: queueEntry.queuePosition },
            UpdateExpression: `SET ${routingUpdateParts.join(", ")}`,
            ...typeof callContext.language === "string" && callContext.language.length > 0 ? { ExpressionAttributeNames: { "#language": "language" } } : {},
            ExpressionAttributeValues: routingValues
          }));
        } catch (metaErr) {
          console.warn("[NEW_INBOUND_CALL] Failed to persist routing metadata (non-fatal):", metaErr);
        }
        try {
          const { Item: existingCall } = await ddb.send(new import_lib_dynamodb12.GetCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: { clinicId, queuePosition: queueEntry.queuePosition },
            ConsistentRead: true
          }));
          const existingMeetingId = existingCall?.meetingId || existingCall?.meetingInfo?.MeetingId;
          const hasCustomerAttendee = !!existingCall?.customerAttendeeInfo?.AttendeeId && !!existingCall?.customerAttendeeInfo?.JoinToken;
          if (!existingMeetingId || !hasCustomerAttendee) {
            const meetingResponse = await chime.send(new import_client_chime_sdk_meetings2.CreateMeetingCommand({
              ClientRequestToken: callId,
              MediaRegion: CHIME_MEDIA_REGION2,
              ExternalMeetingId: callId
            }));
            const meetingInfo = meetingResponse.Meeting;
            const meetingId = meetingInfo?.MeetingId;
            if (meetingId) {
              const customerAttendeeResponse = await chime.send(new import_client_chime_sdk_meetings2.CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `customer-${callId}`.slice(0, 64)
              }));
              const customerAttendeeInfo = customerAttendeeResponse.Attendee;
              if (customerAttendeeInfo?.AttendeeId && customerAttendeeInfo?.JoinToken) {
                await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId, queuePosition: queueEntry.queuePosition },
                  UpdateExpression: "SET meetingId = :meetingId, meetingInfo = :meetingInfo, customerAttendeeInfo = :customerAttendee, updatedAt = :ts",
                  ExpressionAttributeValues: {
                    ":meetingId": meetingId,
                    ":meetingInfo": meetingInfo,
                    ":customerAttendee": customerAttendeeInfo,
                    ":ts": (/* @__PURE__ */ new Date()).toISOString()
                  }
                }));
              } else {
                console.warn("[NEW_INBOUND_CALL] Customer attendee created but missing required fields (non-fatal)", {
                  callId,
                  clinicId,
                  hasAttendeeId: !!customerAttendeeInfo?.AttendeeId,
                  hasJoinToken: !!customerAttendeeInfo?.JoinToken
                });
              }
            } else {
              console.warn("[NEW_INBOUND_CALL] Meeting created but missing MeetingId (non-fatal)", { callId, clinicId });
            }
          }
        } catch (meetingErr) {
          console.warn("[NEW_INBOUND_CALL] Failed to create/persist per-call meeting (non-fatal):", meetingErr);
        }
        let activeAgentIds = [];
        if (AGENT_ACTIVE_TABLE_NAME) {
          try {
            const { Items: activeRows } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
              TableName: AGENT_ACTIVE_TABLE_NAME,
              KeyConditionExpression: "clinicId = :clinicId",
              FilterExpression: "#state = :active",
              ExpressionAttributeNames: { "#state": "state" },
              ExpressionAttributeValues: {
                ":clinicId": clinicId,
                ":active": "active"
              },
              ProjectionExpression: "agentId"
            }));
            activeAgentIds = (activeRows || []).map((r) => r?.agentId).filter((v) => typeof v === "string" && v.length > 0);
            console.log("[NEW_INBOUND_CALL] AgentActive lookup result", {
              callId,
              clinicId,
              tableName: AGENT_ACTIVE_TABLE_NAME,
              rawRowCount: (activeRows || []).length,
              activeAgentIds,
              agentCount: activeAgentIds.length
            });
          } catch (activeErr) {
            console.warn("[NEW_INBOUND_CALL] Failed querying AgentActive (non-fatal):", activeErr);
          }
        } else {
          console.warn("[NEW_INBOUND_CALL] AGENT_ACTIVE_TABLE_NAME not configured; call will remain queued", { callId, clinicId });
        }
        const uniqueAgentIds = Array.from(new Set(activeAgentIds)).slice(0, MAX_RING_AGENTS);
        if (uniqueAgentIds.length > 0) {
          const ringAttemptTimestamp = (/* @__PURE__ */ new Date()).toISOString();
          let ringingStarted = false;
          try {
            await ddb.send(new import_lib_dynamodb12.UpdateCommand({
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId, queuePosition: queueEntry.queuePosition },
              UpdateExpression: "SET #status = :ringing, agentIds = :agentIds, ringStartTimeIso = :ts, ringStartTime = :now, lastStateChange = :ts, updatedAt = :ts",
              ConditionExpression: "#status = :queued",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":ringing": "ringing",
                ":queued": "queued",
                ":agentIds": uniqueAgentIds,
                ":ts": ringAttemptTimestamp,
                ":now": Date.now()
              }
            }));
            ringingStarted = true;
          } catch (err) {
            if (err?.name === "ConditionalCheckFailedException") {
              console.warn("[NEW_INBOUND_CALL] Call not in queued state when attempting to ring (non-fatal)", { callId, clinicId });
            } else {
              console.warn("[NEW_INBOUND_CALL] Failed to set call to ringing (non-fatal):", err);
            }
          }
          if (ringingStarted && isPushNotificationsEnabled()) {
            try {
              await sendIncomingCallToAgents(uniqueAgentIds, {
                callId,
                clinicId,
                clinicName: String(clinic.clinicName || clinicId),
                callerPhoneNumber: fromPhoneNumber,
                timestamp: ringAttemptTimestamp
              });
            } catch (pushErr) {
              console.warn("[NEW_INBOUND_CALL] Failed to send push offer (non-fatal):", pushErr);
            }
          }
          console.log(`[NEW_INBOUND_CALL] Placing customer ${callId} on hold while notifying agent(s) via push.`, {
            clinicId,
            agentsNotified: uniqueAgentIds.length,
            ringingStarted
          });
          const enableRecording = process.env.ENABLE_CALL_RECORDING === "true";
          const recordingsBucket = process.env.RECORDINGS_BUCKET;
          const actions = [];
          if (enableRecording && recordingsBucket && pstnLegCallId) {
            console.log(`[NEW_INBOUND_CALL] Starting recording for call ${callId}`);
            actions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));
            try {
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition: queueEntry.queuePosition },
                UpdateExpression: "SET recordingStarted = :true, recordingStartTime = :now, pstnCallId = :pstnCallId",
                ExpressionAttributeValues: {
                  ":true": true,
                  ":now": (/* @__PURE__ */ new Date()).toISOString(),
                  ":pstnCallId": pstnLegCallId
                }
              }));
              console.log("[NEW_INBOUND_CALL] Updated call record with pstnCallId:", pstnLegCallId);
            } catch (recordErr) {
              console.error("[NEW_INBOUND_CALL] Error updating recording metadata:", recordErr);
            }
          }
          actions.push(
            buildSpeakAction(
              callContext.isVip ? "Thank you for calling. This call may be recorded for quality assurance. As a valued customer, we are connecting you with a specialist." : "Thank you for calling. This call may be recorded for quality and training purposes. Please hold while we connect you with an available agent."
            ),
            buildPauseAction(500),
            buildPlayAudioAction("hold-music.wav", 999)
          );
          return buildActions(actions);
        }
        if (CHIME_CONFIG.OVERFLOW.ENABLED) {
          console.log(`[NEW_INBOUND_CALL] No active agents for clinic ${clinicId}. Attempting overflow routing.`);
          try {
            const overflowResult = await attemptOverflowRouting(
              ddb,
              callContext,
              0,
              // queueWaitSeconds — just entered queue
              0,
              // primaryAgentCount is 0
              AGENT_ACTIVE_TABLE_NAME || AGENT_PRESENCE_TABLE_NAME,
              CLINICS_TABLE_NAME
            );
            if (overflowResult.triggered && overflowResult.agents && overflowResult.agents.length > 0) {
              const overflowAgentIds = overflowResult.agents.map((a) => a.agentId || a);
              console.log(`[NEW_INBOUND_CALL] Overflow routing found ${overflowAgentIds.length} agents`, {
                callId,
                clinicId,
                overflowAgentIds,
                sourceClinicIds: overflowResult.sourceClinicIds
              });
              try {
                const ringTs = (/* @__PURE__ */ new Date()).toISOString();
                await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId, queuePosition: queueEntry.queuePosition },
                  UpdateExpression: "SET #status = :ringing, agentIds = :agentIds, ringStartTimeIso = :ts, ringStartTime = :now, lastStateChange = :ts, updatedAt = :ts, overflowRouted = :true",
                  ConditionExpression: "#status = :queued",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":ringing": "ringing",
                    ":queued": "queued",
                    ":agentIds": overflowAgentIds,
                    ":ts": ringTs,
                    ":now": Date.now(),
                    ":true": true
                  }
                }));
                if (isPushNotificationsEnabled()) {
                  await sendIncomingCallToAgents(overflowAgentIds, {
                    callId,
                    clinicId,
                    clinicName: String(clinic.clinicName || clinicId) + " (overflow)",
                    callerPhoneNumber: fromPhoneNumber,
                    timestamp: ringTs
                  }).catch((pushErr) => console.warn("[NEW_INBOUND_CALL] Overflow push failed (non-fatal):", pushErr));
                }
                return buildActions([
                  buildSpeakAction(
                    callContext.isVip ? "Thank you for calling. This call may be recorded for quality assurance. We are connecting you with the next available specialist." : "Thank you for calling. This call may be recorded for quality and training purposes. All local agents are busy. We are connecting you with another team member. Please hold."
                  ),
                  buildPauseAction(500),
                  buildPlayAudioAction("hold-music.wav", 999)
                ]);
              } catch (overflowRingErr) {
                console.warn("[NEW_INBOUND_CALL] Overflow ring failed (non-fatal). Falling back to queue.", overflowRingErr);
              }
            } else {
              console.log(`[NEW_INBOUND_CALL] Overflow routing returned no agents`, {
                callId,
                clinicId,
                overflowResult
              });
            }
          } catch (overflowErr) {
            console.warn("[NEW_INBOUND_CALL] Overflow routing error (non-fatal):", overflowErr);
          }
        }
        const voicemailBucket = process.env.VOICEMAIL_BUCKET;
        if (CHIME_CONFIG.OVERFLOW.FALLBACK_ACTION === "voicemail" && voicemailBucket && pstnLegCallId) {
          console.log(`[NEW_INBOUND_CALL] No agents available and overflow fallback is voicemail. Offering voicemail.`, { callId, clinicId });
          return buildActions([
            buildSpeakAction(
              "All agents are currently unavailable. Please leave a message after the tone and we will return your call as soon as possible."
            ),
            buildPauseAction(500),
            {
              Type: "RecordAudio",
              Parameters: {
                CallId: pstnLegCallId,
                DurationInSeconds: 120,
                SilenceDurationInSeconds: 5,
                SilenceThreshold: 100,
                RecordingTerminators: ["#"],
                RecordingDestination: {
                  Type: "S3",
                  BucketName: voicemailBucket,
                  Prefix: `voicemails/${clinicId}/${callId}`
                }
              }
            },
            buildSpeakAction("Thank you for your message. Goodbye."),
            buildHangupAction()
          ]);
        }
        console.log(`[NEW_INBOUND_CALL] No active agents for clinic ${clinicId}. Keeping caller in queue.`);
        console.log(`[NEW_INBOUND_CALL] Adding call to queue.`);
        try {
          console.log("[NEW_INBOUND_CALL] Call is queued", { clinicId, callId, queueEntry });
          const queueInfo = await getQueuePosition(clinicId, callId);
          const waitMinutes = Math.ceil((queueInfo?.estimatedWaitTime || 120) / 60);
          const position = queueInfo?.position || 1;
          let message;
          if (callContext.isVip) {
            message = `All agents are currently assisting other customers. As a valued customer, you will be connected as soon as possible. Your estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? "minute" : "minutes"}. This call may be recorded for quality assurance.`;
          } else if (callContext.isCallback) {
            message = `Thank you for calling back. All agents are currently busy. You are number ${position} in line. The estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? "minute" : "minutes"}. This call may be recorded for quality and training purposes.`;
          } else {
            message = `All agents are currently busy. You are number ${position} in line. The estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? "minute" : "minutes"}. This call may be recorded for quality and training purposes. Please stay on the line.`;
          }
          const enableRecording = process.env.ENABLE_CALL_RECORDING === "true";
          const recordingsBucket = process.env.RECORDINGS_BUCKET;
          const actions = [];
          if (enableRecording && recordingsBucket && pstnLegCallId) {
            console.log(`[NEW_INBOUND_CALL] Starting recording for queued call ${callId}`);
            actions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));
            try {
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition: queueEntry.queuePosition },
                UpdateExpression: "SET recordingStarted = :true, recordingStartTime = :now, pstnCallId = :pstnCallId",
                ExpressionAttributeValues: {
                  ":true": true,
                  ":now": (/* @__PURE__ */ new Date()).toISOString(),
                  ":pstnCallId": pstnLegCallId
                }
              }));
              console.log("[NEW_INBOUND_CALL] Updated queued call record with pstnCallId:", pstnLegCallId);
            } catch (recordErr) {
              console.error("[NEW_INBOUND_CALL] Error updating recording metadata:", recordErr);
            }
          }
          actions.push(
            buildSpeakAction(message),
            buildPauseAction(500),
            buildPlayAudioAction("hold-music.wav", 999)
          );
          return buildActions(actions);
        } catch (queueErr) {
          console.error("Error queuing call:", queueErr);
          return buildActions([buildHangupAction("All agents are currently busy. Please try again later.")]);
        }
      }
      case "NEW_OUTBOUND_CALL": {
        console.log(`[NEW_OUTBOUND_CALL] Initiated for call ${callId}`, args);
        const callType = args.callType;
        const clinicId = args.fromClinicId || args.clinicId;
        const outboundAgentId = args.agentId;
        const meetingId = args.meetingId;
        if (outboundAgentId) {
          try {
            await ddb.send(new import_lib_dynamodb12.UpdateCommand({
              TableName: AGENT_PRESENCE_TABLE_NAME,
              Key: { agentId: outboundAgentId },
              UpdateExpression: "SET dialingState = :initiated, dialingStartedAt = :now, outboundCallId = :callId, outboundToNumber = :toNumber",
              ConditionExpression: "#status = :dialing",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":initiated": "initiated",
                ":dialing": "dialing",
                ":now": (/* @__PURE__ */ new Date()).toISOString(),
                ":callId": callId,
                ":toNumber": args.toPhoneNumber || ""
              }
            }));
            console.log(`[NEW_OUTBOUND_CALL] Updated agent ${outboundAgentId} with outbound call details`);
          } catch (updateErr) {
            console.warn(`[NEW_OUTBOUND_CALL] Failed to update agent state:`, updateErr.message);
          }
        }
        if (clinicId) {
          try {
            const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
              TableName: CALL_QUEUE_TABLE_NAME,
              IndexName: "callId-index",
              KeyConditionExpression: "callId = :callId",
              ExpressionAttributeValues: { ":callId": callId }
            }));
            if (callRecords && callRecords[0]) {
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId: callRecords[0].clinicId, queuePosition: callRecords[0].queuePosition },
                UpdateExpression: "SET smaInitiatedAt = :now, pstnCallId = :pstnCallId",
                ExpressionAttributeValues: {
                  ":now": (/* @__PURE__ */ new Date()).toISOString(),
                  ":pstnCallId": pstnLegCallId || callId
                }
              }));
            }
          } catch (err) {
            console.warn("[NEW_OUTBOUND_CALL] Failed to update call record:", err);
          }
        }
        return buildActions([]);
      }
      case "RINGING": {
        console.log(`[RINGING] Call ${callId} is ringing at far end`, args);
        const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
          TableName: CALL_QUEUE_TABLE_NAME,
          IndexName: "callId-index",
          KeyConditionExpression: "callId = :callId",
          ExpressionAttributeValues: { ":callId": callId }
        }));
        if (callRecords && callRecords[0]) {
          const callRecord = callRecords[0];
          const { clinicId, queuePosition, assignedAgentId, direction, status } = callRecord;
          if (direction === "outbound" && status === "dialing" && assignedAgentId) {
            console.log(`[RINGING] Outbound call ${callId} is now ringing - updating agent ${assignedAgentId}`);
            try {
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: assignedAgentId },
                UpdateExpression: "SET dialingState = :ringing, ringingStartedAt = :now",
                ExpressionAttributeValues: {
                  ":ringing": "ringing",
                  ":now": (/* @__PURE__ */ new Date()).toISOString()
                }
              }));
              console.log(`[RINGING] Agent ${assignedAgentId} dialingState updated to 'ringing'`);
            } catch (updateErr) {
              console.warn(`[RINGING] Failed to update agent:`, updateErr.message);
            }
            try {
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition },
                UpdateExpression: "SET dialStatus = :ringing, ringingStartedAt = :now",
                ExpressionAttributeValues: {
                  ":ringing": "ringing",
                  ":now": (/* @__PURE__ */ new Date()).toISOString()
                }
              }));
            } catch (err) {
              console.warn("[RINGING] Failed to update call record:", err);
            }
          }
        }
        return buildActions([]);
      }
      case "CALL_ANSWERED": {
        console.log(`[CALL_ANSWERED] Received for call ${callId}.`, args);
        if (args?.callType === "MarketingOutbound") {
          const meetingId = typeof args?.meetingId === "string" ? args.meetingId : void 0;
          const voiceMessageRaw = args?.voice_message || args?.voiceMessage || args?.message;
          const voiceMessage = typeof voiceMessageRaw === "string" ? voiceMessageRaw.trim() : String(voiceMessageRaw || "").trim();
          const voiceId = String(args?.voice_voiceId || args?.voiceId || process.env.POLLY_VOICE_ID || "Joanna");
          const engineRaw = String(args?.voice_engine || args?.voiceEngine || process.env.POLLY_ENGINE || "neural").toLowerCase();
          const engine = engineRaw === "standard" ? "standard" : "neural";
          const languageCode = String(args?.voice_languageCode || args?.voiceLanguageCode || "en-US");
          const nowIso = (/* @__PURE__ */ new Date()).toISOString();
          await upsertVoiceCallAnalytics(callId, {
            clinicId: String(args?.fromClinicId || args?.clinicId || "").trim() || void 0,
            scheduleId: String(args?.scheduleId || "").trim() || void 0,
            templateName: String(args?.templateName || "").trim() || void 0,
            patNum: String(args?.patNum || "").trim() || void 0,
            patientName: String(args?.patientName || "").trim() || void 0,
            recipientPhone: String(args?.toPhoneNumber || "").trim() || void 0,
            fromPhoneNumber: String(args?.fromPhoneNumber || "").trim() || void 0,
            meetingId,
            status: "ANSWERED",
            startedAt: nowIso,
            // only applied if the record doesn't exist yet
            answeredAt: nowIso,
            voiceId,
            voiceEngine: engine,
            voiceLanguageCode: languageCode,
            source: String(args?.source || "").trim() || void 0
          });
          const actions = [];
          if (meetingId && pstnLegCallId) {
            try {
              const attendeeRes = await chime.send(new import_client_chime_sdk_meetings2.CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `marketing-${callId}`.slice(0, 64)
              }));
              const attendee = attendeeRes.Attendee;
              if (attendee?.AttendeeId && attendee?.JoinToken) {
                actions.push(buildJoinChimeMeetingAction(pstnLegCallId, { MeetingId: meetingId }, attendee));
              } else {
                console.warn("[CALL_ANSWERED/MarketingOutbound] Failed to create attendee (missing JoinToken/AttendeeId)", { callId, meetingId });
              }
            } catch (err) {
              console.warn("[CALL_ANSWERED/MarketingOutbound] Failed to join meeting (non-fatal); continuing with Speak", {
                callId,
                meetingId,
                error: err?.message || err
              });
            }
          } else {
            console.warn("[CALL_ANSWERED/MarketingOutbound] Missing meetingId or PSTN CallId; skipping JoinChimeMeeting", {
              callId,
              hasMeetingId: !!meetingId,
              hasPstnLegCallId: !!pstnLegCallId
            });
          }
          if (voiceMessage) {
            actions.push(buildSpeakAction(voiceMessage, voiceId, engine, pstnLegCallId, languageCode));
            actions.push(buildPauseAction(250, pstnLegCallId));
          } else {
            console.warn("[CALL_ANSWERED/MarketingOutbound] Missing voice message; hanging up", { callId });
          }
          actions.push({ Type: "Hangup" });
          return buildActions(actions);
        }
        const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
          TableName: CALL_QUEUE_TABLE_NAME,
          IndexName: "callId-index",
          KeyConditionExpression: "callId = :id",
          ExpressionAttributeValues: { ":id": callId }
        }));
        if (!callRecords || callRecords.length === 0) {
          console.error(`[CALL_ANSWERED] No call record found for callId ${callId}`);
          return buildActions([buildHangupAction()]);
        }
        const callRecord = callRecords[0];
        const { meetingInfo, assignedAgentId, status } = callRecord;
        if (status === "dialing" && meetingInfo?.MeetingId && assignedAgentId) {
          const meetingId = meetingInfo.MeetingId;
          console.log(`[CALL_ANSWERED] Customer answered outbound call ${callId}. Bridging to meeting ${meetingId}.`);
          const enableRecording = process.env.ENABLE_CALL_RECORDING === "true";
          const recordingsBucket = process.env.RECORDINGS_BUCKET;
          const preBridgeActions = [];
          if (enableRecording && recordingsBucket && pstnLegCallId && !callRecord.recordingStarted) {
            console.log(`[CALL_ANSWERED] Starting recording for outbound call ${callId}`);
            preBridgeActions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));
            try {
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                UpdateExpression: "SET recordingStarted = :true, recordingStartTime = :now, pstnCallId = :pstnCallId",
                ExpressionAttributeValues: {
                  ":true": true,
                  ":now": (/* @__PURE__ */ new Date()).toISOString(),
                  ":pstnCallId": pstnLegCallId
                }
              }));
              console.log("[CALL_ANSWERED] Updated outbound call record with pstnCallId:", pstnLegCallId);
            } catch (recordErr) {
              console.warn("[CALL_ANSWERED] Error updating outbound recording metadata (non-fatal):", recordErr);
            }
          }
          try {
            const customerAttendeeResponse = await chime.send(new import_client_chime_sdk_meetings2.CreateAttendeeCommand({
              MeetingId: meetingId,
              ExternalUserId: `customer-pstn-${callId}`
            }));
            if (!customerAttendeeResponse.Attendee?.AttendeeId) {
              throw new Error("Failed to create customer attendee for outbound call");
            }
            const customerAttendee = customerAttendeeResponse.Attendee;
            console.log(`[CALL_ANSWERED] Created customer attendee ${customerAttendee.AttendeeId}`);
            try {
              const { Items: callRecords2 } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: "callId-index",
                KeyConditionExpression: "callId = :id",
                ExpressionAttributeValues: { ":id": callId }
              }));
              if (callRecords2 && callRecords2[0]) {
                const { clinicId, queuePosition } = callRecords2[0];
                await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId, queuePosition },
                  UpdateExpression: "SET #status = :status, acceptedAt = :timestamp, customerAttendeeInfo = :customerAttendee",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":status": "connected",
                    ":timestamp": (/* @__PURE__ */ new Date()).toISOString(),
                    ":customerAttendee": customerAttendee
                  }
                }));
                console.log(`[CALL_ANSWERED] Call queue updated for ${callId}`);
                await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                  TableName: AGENT_PRESENCE_TABLE_NAME,
                  Key: { agentId: assignedAgentId },
                  UpdateExpression: "SET #status = :onCall, currentCallId = :callId, lastActivityAt = :now",
                  ConditionExpression: "#status = :dialing",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":onCall": "OnCall",
                    // Or 'In Call', matching your other logic
                    ":callId": callId,
                    ":now": (/* @__PURE__ */ new Date()).toISOString(),
                    ":dialing": "dialing"
                  }
                }));
                console.log(`[CALL_ANSWERED] Agent ${assignedAgentId} status updated to OnCall`);
                if (isPushNotificationsEnabled()) {
                  try {
                    await sendCallAnsweredToAgent({
                      callId,
                      clinicId: callRecords2[0].clinicId || clinicId || "",
                      clinicName: callRecords2[0].clinicName || callRecords2[0].clinicId || "",
                      callerPhoneNumber: callRecords2[0].phoneNumber || callRecords2[0].toPhoneNumber || "",
                      agentId: assignedAgentId,
                      direction: "outbound",
                      meetingId,
                      timestamp: (/* @__PURE__ */ new Date()).toISOString()
                    });
                  } catch (pushErr) {
                    console.warn("[CALL_ANSWERED] Failed to send call_answered push (non-fatal):", pushErr);
                  }
                }
                if (isRealTimeTranscriptionEnabled()) {
                  const callRecord2 = callRecords2[0];
                  startMediaPipeline({
                    callId,
                    meetingId,
                    clinicId,
                    agentId: assignedAgentId,
                    customerPhone: callRecord2.from || callRecord2.phoneNumber,
                    direction: callRecord2.direction || "inbound"
                  }).then(async (pipelineId) => {
                    if (pipelineId) {
                      await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId, queuePosition },
                        UpdateExpression: "SET mediaPipelineId = :pipelineId",
                        ExpressionAttributeValues: {
                          ":pipelineId": pipelineId
                        }
                      })).catch((err) => {
                        console.warn("[CALL_ANSWERED] Failed to store pipeline ID:", err.message);
                      });
                      console.log("[CALL_ANSWERED] Media Pipeline started:", pipelineId);
                    }
                  }).catch((err) => {
                    console.warn("[CALL_ANSWERED] Failed to start Media Pipeline (non-fatal):", err.message);
                  });
                }
              }
            } catch (queueErr) {
              console.warn(`[CALL_ANSWERED] Failed to update call queue:`, queueErr);
            }
            if (!pstnLegCallId) {
              console.error("[CALL_ANSWERED] Missing PSTN CallId for JoinChimeMeeting");
              return buildActions([
                buildHangupAction("Unable to connect your call. Please try again.")
              ]);
            }
            return buildActions([
              ...preBridgeActions,
              buildJoinChimeMeetingAction(pstnLegCallId, { MeetingId: meetingId }, customerAttendee)
            ]);
          } catch (err) {
            console.error(`[CALL_ANSWERED] Error bridging customer to meeting:`, err);
            return buildActions([
              buildHangupAction("Unable to connect your call. Please try again.")
            ]);
          }
        }
        console.log(`[CALL_ANSWERED] Informational event for call ${callId}. No action needed.`);
        return buildActions([]);
      }
      case "HOLD_CALL": {
        if (args.action === "HOLD_CALL" && args.agentId) {
          const { agentId, meetingId, agentAttendeeId, removeAgent } = args;
          console.log(`Processing hold request for call ${callId} from agent ${agentId}`, { meetingId, agentAttendeeId, removeAgent });
          const actions = [];
          if (meetingId && agentAttendeeId && (removeAgent === "true" || removeAgent === true)) {
            console.log(`[HOLD_CALL] Removing agent ${agentId} (attendee ${agentAttendeeId}) from meeting ${meetingId}`);
            actions.push({
              Type: "ModifyChimeMeetingAttendees",
              Parameters: {
                Operation: "Remove",
                MeetingId: meetingId,
                AttendeeList: [agentAttendeeId]
              }
            });
          } else {
            console.warn(`[HOLD_CALL] Cannot remove agent from meeting - missing required info`, {
              hasMeetingId: !!meetingId,
              hasAttendeeId: !!agentAttendeeId,
              removeAgent
            });
          }
          actions.push(buildSpeakAction("You have been placed on hold. Please wait."));
          actions.push(buildPauseAction(500));
          actions.push(buildPlayAudioAction("hold-music.wav", 999));
          return buildActions(actions);
        }
        console.warn("HOLD_CALL event without proper action");
        return buildActions([]);
      }
      case "RESUME_CALL": {
        if (args.action === "RESUME_CALL" && args.agentId) {
          const { agentId, meetingId, agentAttendeeId, reconnectAgent } = args;
          console.log(`Processing resume request for call ${callId} from agent ${agentId}`, { meetingId, agentAttendeeId, reconnectAgent });
          const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: "callId-index",
            KeyConditionExpression: "callId = :callId",
            ExpressionAttributeValues: { ":callId": callId }
          }));
          if (!callRecords || callRecords.length === 0) {
            return buildActions([buildSpeakAction("Unable to resume your call.")]);
          }
          const callRecord = callRecords[0];
          if (!callRecord.customerAttendeeInfo?.AttendeeId) {
            console.error("No customer attendee info found for call", callId);
            return buildActions([buildSpeakAction("Unable to reconnect your call.")]);
          }
          const actions = [];
          if (meetingId && agentAttendeeId && (reconnectAgent === "true" || reconnectAgent === true)) {
            console.log(`[RESUME_CALL] Adding agent ${agentId} (attendee ${agentAttendeeId}) to meeting ${meetingId}`);
            actions.push({
              Type: "ModifyChimeMeetingAttendees",
              Parameters: {
                Operation: "Add",
                MeetingId: meetingId,
                AttendeeList: [agentAttendeeId]
              }
            });
          }
          actions.push(buildSpeakAction("Thank you for holding. Reconnecting now."));
          if (!pstnLegCallId) {
            console.error("[RESUME_CALL] Missing PSTN CallId for JoinChimeMeeting");
            return buildActions([buildSpeakAction("Unable to reconnect your call.")]);
          }
          actions.push(buildJoinChimeMeetingAction(pstnLegCallId, callRecord.meetingInfo, callRecord.customerAttendeeInfo));
          return buildActions(actions);
        }
        console.warn("RESUME_CALL event without proper action");
        return buildActions([]);
      }
      case "RING_NEW_AGENTS": {
        if (args.action === "RING_NEW_AGENTS" && args.agentIds) {
          console.log(`[RING_NEW_AGENTS] Rerouting call ${callId} to new agents: ${args.agentIds}`);
          const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: "callId-index",
            KeyConditionExpression: "callId = :callId",
            ExpressionAttributeValues: { ":callId": callId }
          }));
          if (!callRecords || callRecords.length === 0) {
            console.error("No call record found for ringing new agents");
            return buildActions([buildSpeakAndBridgeAction("All agents are busy. Please stay on the line.")]);
          }
          const callRecord = callRecords[0];
          const agentIds = args.agentIds.split(",");
          await Promise.all(agentIds.map(async (agentId) => {
            try {
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: "SET ringingCallId = :callId, #status = :ringingStatus, ringingCallTime = :time, ringingCallFrom = :from, ringingCallClinicId = :clinicId",
                ConditionExpression: "attribute_exists(agentId) AND #status = :onlineStatus AND attribute_not_exists(ringingCallId)",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: {
                  ":callId": callId,
                  ":ringingStatus": "ringing",
                  ":time": (/* @__PURE__ */ new Date()).toISOString(),
                  ":from": callRecord.phoneNumber || "Unknown",
                  ":clinicId": callRecord.clinicId,
                  ":onlineStatus": "Online"
                }
              }));
              console.log(`[RING_NEW_AGENTS] Notified new agent ${agentId}`);
            } catch (err) {
              if (err.name === "ConditionalCheckFailedException") {
                console.warn(`[RING_NEW_AGENTS] Agent ${agentId} not available - skipping`);
              } else {
                console.error(`[RING_NEW_AGENTS] Error notifying agent ${agentId}:`, err);
              }
            }
          }));
          return buildActions([
            buildSpeakAndBridgeAction("We are connecting you with the next available agent. Please hold.")
          ]);
        }
        return buildActions([]);
      }
      case "CALL_UPDATE_REQUESTED": {
        console.log(`[CALL_UPDATE_REQUESTED] Received for call ${callId}`, args);
        if (args.action === "BRIDGE_CUSTOMER_INBOUND" && args.meetingId && args.customerAttendeeId && args.customerAttendeeJoinToken) {
          const { meetingId, customerAttendeeId, customerAttendeeJoinToken } = args;
          console.log(`[BRIDGE_CUSTOMER_INBOUND] Bridging customer PSTN leg into meeting ${meetingId}`);
          if (!pstnLegCallId) {
            console.error("[BRIDGE_CUSTOMER_INBOUND] Missing PSTN CallId for JoinChimeMeeting");
            return buildActions([buildHangupAction("Unable to connect your call. Please try again.")]);
          }
          return buildActions([
            buildSpeakAction("An agent will assist you now."),
            buildJoinChimeMeetingAction(
              pstnLegCallId,
              { MeetingId: meetingId },
              { AttendeeId: customerAttendeeId, JoinToken: customerAttendeeJoinToken }
            )
          ]);
        }
        const updateRequestedActionRaw = args?.Action ?? args?.action;
        const updateRequestedAction = typeof updateRequestedActionRaw === "string" ? updateRequestedActionRaw.toLowerCase() : "";
        if (updateRequestedAction === "hangup") {
          console.log(`[CALL_UPDATE_REQUESTED] Acknowledging Hangup request for call ${callId}`, {
            hasParticipants: Array.isArray(event?.CallDetails?.Participants),
            participantCount: Array.isArray(event?.CallDetails?.Participants) ? event.CallDetails.Participants.length : 0
          });
          const participants = Array.isArray(event?.CallDetails?.Participants) ? event.CallDetails.Participants : [];
          const participantCallIds = participants.map((p) => p?.CallId).filter((id) => typeof id === "string" && id.length > 0);
          const uniqueCallIds = Array.from(new Set(participantCallIds));
          const hangupActions = uniqueCallIds.map((id) => ({
            Type: "Hangup",
            Parameters: {
              CallId: id,
              SipResponseCode: "0"
            }
          }));
          if (hangupActions.length === 0) {
            console.warn("[CALL_UPDATE_REQUESTED] No participant CallIds found; issuing generic Hangup", {
              callId,
              args
            });
            hangupActions.push({ Type: "Hangup", Parameters: { SipResponseCode: "0" } });
          }
          return buildActions(hangupActions);
        }
        console.log(`[CALL_UPDATE_REQUESTED] Acknowledging unknown action:`, args);
        return buildActions([]);
      }
      case "HANGUP":
      case "CALL_ENDED": {
        console.log(`[${eventType}] Call ${callId} ended. Cleaning up resources.`);
        if (args?.callType === "MarketingOutbound") {
          const meetingId = typeof args?.meetingId === "string" ? args.meetingId : void 0;
          const sipResponseCode2 = event?.CallDetails?.SipResponseCode || event?.ActionData?.Parameters?.SipResponseCode || "0";
          let endReason = "unknown";
          switch (sipResponseCode2?.toString()) {
            case "486":
              endReason = "busy";
              break;
            case "480":
              endReason = "no_answer";
              break;
            case "603":
              endReason = "declined";
              break;
            case "487":
              endReason = "cancelled";
              break;
            case "404":
              endReason = "invalid_number";
              break;
            case "408":
              endReason = "timeout";
              break;
            case "484":
              endReason = "incomplete_number";
              break;
            case "503":
              endReason = "service_unavailable";
              break;
            case "502":
            case "504":
              endReason = "network_error";
              break;
            case "0":
            case "200":
              endReason = "normal";
              break;
            default:
              endReason = `sip_${sipResponseCode2}`;
          }
          const finalStatus = sipResponseCode2?.toString() === "0" || sipResponseCode2?.toString() === "200" ? "COMPLETED" : "FAILED";
          const nowIso = (/* @__PURE__ */ new Date()).toISOString();
          await upsertVoiceCallAnalytics(callId, {
            clinicId: String(args?.fromClinicId || args?.clinicId || "").trim() || void 0,
            scheduleId: String(args?.scheduleId || "").trim() || void 0,
            templateName: String(args?.templateName || "").trim() || void 0,
            patNum: String(args?.patNum || "").trim() || void 0,
            patientName: String(args?.patientName || "").trim() || void 0,
            recipientPhone: String(args?.toPhoneNumber || "").trim() || void 0,
            fromPhoneNumber: String(args?.fromPhoneNumber || "").trim() || void 0,
            meetingId,
            status: finalStatus,
            startedAt: nowIso,
            // only applied if the record doesn't exist yet
            endedAt: nowIso,
            sipResponseCode: String(sipResponseCode2 || ""),
            endReason,
            voiceId: String(args?.voice_voiceId || args?.voiceId || "").trim() || void 0,
            voiceEngine: String(args?.voice_engine || args?.voiceEngine || "").trim() || void 0,
            voiceLanguageCode: String(args?.voice_languageCode || args?.voiceLanguageCode || "").trim() || void 0,
            source: String(args?.source || "").trim() || void 0
          });
          if (meetingId) {
            try {
              await cleanupMeeting(meetingId);
              console.log(`[${eventType}/MarketingOutbound] Cleaned up meeting ${meetingId}`);
            } catch (err) {
              console.warn(`[${eventType}/MarketingOutbound] Failed to cleanup meeting ${meetingId}:`, err?.message || err);
            }
          } else {
            console.warn(`[${eventType}/MarketingOutbound] No meetingId found in ArgumentsMap; nothing to cleanup`, { callId });
          }
          return buildActions([]);
        }
        const sipResponseCode = event?.CallDetails?.SipResponseCode || event?.ActionData?.Parameters?.SipResponseCode || "0";
        const hangupSource = event?.ActionData?.Parameters?.Source || "unknown";
        const participants = event?.CallDetails?.Participants || [];
        const sipHeaders = event?.CallDetails?.SipHeaders || {};
        const isVoicemailLikely = sipHeaders["X-Voicemail"] === "true" || sipHeaders["X-Answer-Machine"] === "true" || sipResponseCode === "200" && participants.some(
          (p) => p.CallLegType === "PSTN" && (p.Duration && p.Duration < 3e3)
          // Call answered but very short
        );
        console.log(`[${eventType}] SIP Response Code: ${sipResponseCode}, Source: ${hangupSource}, VoicemailLikely: ${isVoicemailLikely}`);
        let callEndReason = "unknown";
        let callEndUserFriendly = "";
        switch (sipResponseCode?.toString()) {
          case "486":
            callEndReason = "busy";
            callEndUserFriendly = "Line is busy";
            break;
          case "480":
            callEndReason = "no_answer";
            callEndUserFriendly = "No answer - call timed out";
            break;
          case "603":
            callEndReason = "declined";
            callEndUserFriendly = "Call was declined";
            break;
          case "487":
            callEndReason = "cancelled";
            callEndUserFriendly = "Call was cancelled";
            break;
          case "404":
            callEndReason = "invalid_number";
            callEndUserFriendly = "Number not found or invalid";
            break;
          case "408":
            callEndReason = "timeout";
            callEndUserFriendly = "Call timed out";
            break;
          case "484":
            callEndReason = "incomplete_number";
            callEndUserFriendly = "Incomplete phone number";
            break;
          case "503":
            callEndReason = "service_unavailable";
            callEndUserFriendly = "Service temporarily unavailable";
            break;
          case "502":
          case "504":
            callEndReason = "network_error";
            callEndUserFriendly = "Network error - please try again";
            break;
          case "606":
            callEndReason = "not_acceptable";
            callEndUserFriendly = "Call could not be completed";
            break;
          case "0":
            callEndReason = isVoicemailLikely ? "voicemail" : "normal";
            callEndUserFriendly = isVoicemailLikely ? "Went to voicemail" : "Call ended normally";
            break;
          case "200":
            if (isVoicemailLikely) {
              callEndReason = "voicemail";
              callEndUserFriendly = "Went to voicemail";
            } else {
              callEndReason = "normal";
              callEndUserFriendly = "Call ended normally";
            }
            break;
          default:
            callEndReason = `sip_${sipResponseCode}`;
            callEndUserFriendly = `Call ended (code: ${sipResponseCode})`;
        }
        const recordingsBucket = process.env.RECORDINGS_BUCKET;
        if (recordingsBucket && pstnLegCallId) {
          try {
            console.log(`[${eventType}] Ensuring recording stopped for call ${callId}`);
          } catch (recordErr) {
            console.warn(`[${eventType}] Error stopping recording:`, recordErr);
          }
        }
        const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
          TableName: CALL_QUEUE_TABLE_NAME,
          IndexName: "callId-index",
          KeyConditionExpression: "callId = :id",
          ExpressionAttributeValues: { ":id": callId }
        }));
        if (callRecords && callRecords[0]) {
          const callRecord = callRecords[0];
          const { clinicId, queuePosition, meetingInfo, assignedAgentId, agentIds, status, direction } = callRecord;
          console.log(`[${eventType}] Found call record`, {
            callId,
            status,
            direction,
            assignedAgent: assignedAgentId,
            hasMeeting: !!meetingInfo?.MeetingId,
            callEndReason
          });
          if (callRecord.mediaPipelineId) {
            try {
              await stopMediaPipeline(callRecord.mediaPipelineId, callId);
              console.log(`[${eventType}] Successfully stopped Media Pipeline: ${callRecord.mediaPipelineId}`);
            } catch (pipelineErr) {
              console.warn(`[${eventType}] Failed to stop Media Pipeline:`, pipelineErr);
            }
          }
          const isOutboundCall = direction === "outbound" || status === "dialing";
          const meetingModel = typeof callRecord.meetingModel === "string" ? String(callRecord.meetingModel).trim().toLowerCase() : "";
          const isPerCallMeeting = !isOutboundCall || meetingModel === "per_call";
          const meetingIdForCleanup = meetingInfo && typeof meetingInfo.MeetingId === "string" && meetingInfo.MeetingId.length > 0 ? meetingInfo.MeetingId : typeof callRecord.meetingId === "string" ? callRecord.meetingId : void 0;
          const shouldCleanupMeeting = isPerCallMeeting && !!meetingIdForCleanup;
          if (shouldCleanupMeeting && meetingIdForCleanup) {
            try {
              await cleanupMeeting(meetingIdForCleanup);
              console.log(`[${eventType}] Cleaned up per-call meeting ${meetingIdForCleanup}`, {
                callId,
                status,
                direction
              });
            } catch (meetingErr) {
              console.warn(`[${eventType}] Failed to cleanup meeting:`, meetingErr);
            }
          } else if (isOutboundCall && meetingIdForCleanup) {
            console.log(`[${eventType}] Outbound call ended. Legacy outbound meeting ${meetingIdForCleanup} will NOT be deleted.`);
          } else if (meetingIdForCleanup) {
            console.log(`[${eventType}] Call ended. Meeting ${meetingIdForCleanup} will NOT be deleted.`);
          }
          let finalStatus;
          if (status === "connected" || status === "on_hold") {
            finalStatus = "completed";
          } else if (status === "dialing") {
            finalStatus = callEndReason === "normal" ? "completed" : "failed";
          } else {
            finalStatus = "abandoned";
          }
          const callDuration = callRecord.acceptedAt ? Math.floor(Date.now() / 1e3) - Math.floor(new Date(callRecord.acceptedAt).getTime() / 1e3) : 0;
          try {
            await ddb.send(new import_lib_dynamodb12.UpdateCommand({
              TableName: CALL_QUEUE_TABLE_NAME,
              Key: { clinicId, queuePosition },
              UpdateExpression: "SET #status = :status, endedAt = :timestamp, endedAtIso = :timestampIso, callDuration = :duration, callEndReason = :reason, callEndMessage = :message, sipResponseCode = :sipCode REMOVE customerAttendeeInfo, agentAttendeeInfo",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":status": finalStatus,
                ":timestamp": Math.floor(Date.now() / 1e3),
                ":timestampIso": (/* @__PURE__ */ new Date()).toISOString(),
                ":duration": callDuration,
                ":reason": callEndReason,
                ":message": callEndUserFriendly,
                ":sipCode": sipResponseCode?.toString() || "unknown"
              }
            }));
            console.log(`[${eventType}] Call ${callId} record updated with end reason: ${callEndReason} - ${callEndUserFriendly}`);
            if (CHIME_CONFIG.AUDIT.ENABLED) {
              try {
                if (!CALL_AUDIT_TABLE_NAME) {
                  if (!didWarnMissingAuditTable) {
                    console.warn("[AUDIT] Audit logging enabled but CALL_AUDIT_TABLE_NAME not set; skipping DynamoDB audit writes.");
                    didWarnMissingAuditTable = true;
                  }
                } else {
                  const auditEvent = createAuditEvent(
                    "CALL_ENDED" /* CALL_ENDED */,
                    { type: "agent", id: assignedAgentId || "system", name: void 0 },
                    { type: "call", id: callId },
                    clinicId,
                    {
                      finalStatus,
                      callDuration,
                      callEndReason,
                      sipResponseCode,
                      direction: direction || "inbound"
                    },
                    { callId }
                  );
                  await logAuditEvent(ddb, auditEvent, CALL_AUDIT_TABLE_NAME).catch(() => {
                  });
                }
              } catch (auditErr) {
                console.warn(`[${eventType}] Audit logging failed (non-fatal):`, auditErr);
              }
            }
            const callType = finalStatus === "completed" ? "answered" : finalStatus === "abandoned" ? "abandoned" : "missed";
            await publishCallMetrics(clinicId, callType, callDuration, 0).catch(() => {
            });
            if (CHIME_CONFIG.QUALITY.ENABLED && callDuration > 0) {
              try {
                const waitTime = callRecord.queuedAt && callRecord.acceptedAt ? Math.floor((new Date(callRecord.acceptedAt).getTime() - new Date(callRecord.queuedAt).getTime()) / 1e3) : 0;
                const callSentiment = callRecord.overallSentiment || callRecord.sentiment || "NEUTRAL";
                const qualityMetrics = calculateQualityMetrics({
                  // Audio metrics (from call record if available)
                  packetLoss: callRecord.packetLoss || 0,
                  jitter: callRecord.jitter || 0,
                  latency: callRecord.latency || 0,
                  mos: callRecord.mos,
                  // Agent metrics
                  responseTime: callRecord.agentResponseTime || 0,
                  holdCount: callRecord.holdCount || 0,
                  totalHoldTime: callRecord.totalHoldTime || 0,
                  transferCount: callRecord.transferCount || 0,
                  callDuration,
                  // Customer experience
                  waitTime,
                  sentiment: callSentiment,
                  resolved: finalStatus === "completed",
                  escalated: !!callRecord.escalated,
                  abandoned: finalStatus === "abandoned",
                  // Compliance
                  piiMentioned: callRecord.piiMentioned || false,
                  hipaaCompliant: callRecord.hipaaCompliant !== false,
                  recordingEnabled: !!callRecord.recordingPath
                });
                await saveQualityMetrics(
                  ddb,
                  callId,
                  clinicId,
                  Math.floor(Date.now() / 1e3),
                  qualityMetrics,
                  CALL_QUEUE_TABLE_NAME
                );
                console.log(`[${eventType}] Call quality scored: ${qualityMetrics.overallScore}/100`, {
                  callId,
                  audio: qualityMetrics.audioQuality.score,
                  agent: qualityMetrics.agentPerformance.score,
                  customer: qualityMetrics.customerExperience.score,
                  compliance: qualityMetrics.compliance.score
                });
                const qualityAlert = shouldAlertOnQuality(qualityMetrics);
                if (qualityAlert.alert) {
                  console.warn(`[${eventType}] Quality alert triggered:`, qualityAlert.reasons);
                }
              } catch (qualityErr) {
                console.warn(`[${eventType}] Quality scoring failed (non-fatal):`, qualityErr);
              }
            }
          } catch (updateErr) {
            console.error(`[${eventType}] Failed to update call record:`, updateErr);
          }
          if (AGENT_ACTIVE_TABLE_NAME && assignedAgentId) {
            try {
              const { Items: agentActiveRows } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
                TableName: AGENT_ACTIVE_TABLE_NAME,
                IndexName: "agentId-index",
                KeyConditionExpression: "agentId = :agentId",
                ExpressionAttributeValues: { ":agentId": assignedAgentId },
                ProjectionExpression: "clinicId, agentId, #state, currentCallId, tempBusy",
                ExpressionAttributeNames: { "#state": "state" }
              }));
              const callReference = typeof callRecord?.callReference === "string" ? String(callRecord.callReference).trim() : "";
              const callIdsToMatch = /* @__PURE__ */ new Set([String(callId)]);
              if (callReference && callReference !== String(callId)) {
                callIdsToMatch.add(callReference);
              }
              const busyRowsForThisCall = (agentActiveRows || []).filter(
                (r) => typeof r?.clinicId === "string" && String(r?.clinicId || "").length > 0 && String(r?.state || "").toLowerCase() === "busy" && callIdsToMatch.has(String(r?.currentCallId || ""))
              );
              if (busyRowsForThisCall.length > 0) {
                const ts = (/* @__PURE__ */ new Date()).toISOString();
                let deletedTempBusy = 0;
                let resetActive = 0;
                await Promise.allSettled(busyRowsForThisCall.map(async (row) => {
                  const cId = String(row.clinicId);
                  const rowCallId = String(row.currentCallId || "");
                  const isTempBusy = row?.tempBusy === true;
                  if (isTempBusy) {
                    await ddb.send(new import_lib_dynamodb12.DeleteCommand({
                      TableName: AGENT_ACTIVE_TABLE_NAME,
                      Key: { clinicId: cId, agentId: assignedAgentId },
                      ConditionExpression: "tempBusy = :true AND #state = :busy AND currentCallId = :callId",
                      ExpressionAttributeNames: { "#state": "state" },
                      ExpressionAttributeValues: {
                        ":true": true,
                        ":busy": "busy",
                        ":callId": rowCallId
                      }
                    }));
                    deletedTempBusy += 1;
                    return;
                  }
                  await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                    TableName: AGENT_ACTIVE_TABLE_NAME,
                    Key: { clinicId: cId, agentId: assignedAgentId },
                    UpdateExpression: "SET #state = :active, updatedAt = :ts REMOVE currentCallId",
                    ConditionExpression: "#state = :busy AND currentCallId = :callId",
                    ExpressionAttributeNames: { "#state": "state" },
                    ExpressionAttributeValues: {
                      ":active": "active",
                      ":busy": "busy",
                      ":callId": rowCallId,
                      ":ts": ts
                    }
                  }));
                  resetActive += 1;
                }));
                console.log(`[${eventType}] AgentActive ${assignedAgentId} updated after call end`, {
                  callId,
                  matchedIds: Array.from(callIdsToMatch),
                  resetActive,
                  deletedTempBusy
                });
              }
            } catch (agentActiveErr) {
              if (agentActiveErr.name !== "ConditionalCheckFailedException") {
                console.warn(`[${eventType}] Failed to update AgentActive for agent ${assignedAgentId} (non-fatal):`, agentActiveErr);
              }
            }
          }
          if (assignedAgentId) {
            try {
              const wasDialingOutbound = status === "dialing" && isOutboundCall;
              const dialingFailed = wasDialingOutbound && callEndReason !== "normal" && callEndReason !== "completed";
              await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: assignedAgentId },
                UpdateExpression: `SET #status = :status, lastActivityAt = :timestamp, lastCallEndedAt = :timestamp, lastCallEndTime = :timestamp, 
                                    lastCallEndReason = :reason, lastCallEndMessage = :message, lastCallId = :callId,
                                    lastCallWasOutbound = :wasOutbound, lastDialingFailed = :dialFailed
                                    REMOVE currentCallId, callStatus, currentMeetingAttendeeId, dialingState, dialingStartedAt, 
                                    ringingStartedAt, outboundCallId, outboundToNumber`,
                ConditionExpression: "attribute_exists(agentId) AND (currentCallId = :callId OR outboundCallId = :callId OR attribute_not_exists(currentCallId))",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: {
                  ":status": "Online",
                  ":timestamp": (/* @__PURE__ */ new Date()).toISOString(),
                  ":callId": callId,
                  ":reason": wasDialingOutbound ? callEndReason : "completed",
                  ":message": wasDialingOutbound ? callEndUserFriendly : "Call completed",
                  ":wasOutbound": isOutboundCall,
                  ":dialFailed": dialingFailed
                }
              }));
              if (dialingFailed) {
                console.log(`[${eventType}] Agent ${assignedAgentId} outbound call FAILED. Reason: ${callEndReason} - ${callEndUserFriendly}`);
              } else {
                console.log(`[${eventType}] Agent ${assignedAgentId} marked as available. Call end reason: ${callEndReason}`);
              }
            } catch (agentErr) {
              if (agentErr.name === "ConditionalCheckFailedException") {
                console.log(`[${eventType}] Agent ${assignedAgentId} was not on this call. Skipping cleanup.`);
              } else {
                console.warn(`[${eventType}] Failed to update agent ${assignedAgentId}:`, agentErr);
              }
            }
          }
          if (status === "ringing" && agentIds && Array.isArray(agentIds) && agentIds.length > 0) {
            console.log(`[${eventType}] Clearing ringing status for ${agentIds.length} agents`);
            await Promise.all(agentIds.map(
              (agentId) => ddb.send(new import_lib_dynamodb12.UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId },
                UpdateExpression: "SET #status = :online, lastActivityAt = :timestamp REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode",
                ConditionExpression: "attribute_exists(agentId) AND ringingCallId = :callId",
                ExpressionAttributeNames: {
                  "#status": "status"
                },
                ExpressionAttributeValues: {
                  ":online": "Online",
                  ":timestamp": (/* @__PURE__ */ new Date()).toISOString(),
                  ":callId": callId
                }
              })).catch((err) => {
                if (err.name !== "ConditionalCheckFailedException") {
                  console.warn(`[${eventType}] Failed to clear ringing for agent ${agentId}:`, err.message);
                }
              })
            ));
            if (isPushNotificationsEnabled()) {
              const nowIso = (/* @__PURE__ */ new Date()).toISOString();
              await Promise.allSettled(agentIds.map(
                (rAgentId) => sendCallEndedToAgent({
                  callId,
                  clinicId,
                  clinicName: clinicId,
                  agentId: rAgentId,
                  reason: callEndReason,
                  message: callEndUserFriendly,
                  direction: direction || "inbound",
                  timestamp: nowIso
                })
              ));
            }
          }
          if (assignedAgentId && isPushNotificationsEnabled()) {
            try {
              await sendCallEndedToAgent({
                callId,
                clinicId,
                clinicName: clinicId,
                agentId: assignedAgentId,
                reason: callEndReason,
                message: callEndUserFriendly,
                direction: direction || "inbound",
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
            } catch (pushErr) {
              console.warn(`[${eventType}] Failed to send call-ended push to agent ${assignedAgentId} (non-fatal):`, pushErr);
            }
          }
        }
        console.log(`[${eventType}] Call ${callId} cleanup completed.`);
        return buildActions([]);
      }
      case "DIGITS_RECEIVED":
      case "ACTION_SUCCESSFUL": {
        const receivedDigits = event?.ActionData?.ReceivedDigits;
        const actionType = event?.ActionData?.Type;
        if ((actionType === "PlayAudioAndGetDigits" || actionType === "SpeakAndGetDigits") && receivedDigits) {
          console.log(`[DIGITS_RECEIVED] Customer entered digits: ${receivedDigits} for call ${callId}`, { actionType });
        }
        return buildActions([]);
      }
      case "SEND_DTMF": {
        if (args.action === "SEND_DTMF" && args.digits) {
          const { digits, durationMs, gapMs, agentId } = args;
          console.log(`[SEND_DTMF] Sending DTMF digits for call ${callId}`, {
            digitsLength: digits?.length,
            durationMs,
            gapMs,
            agentId
          });
          const sendDigitsAction = {
            Type: "SendDigits",
            Parameters: {
              CallId: pstnLegCallId || callId,
              Digits: digits,
              ToneDurationInMilliseconds: parseInt(durationMs || "250", 10),
              ToneGapInMilliseconds: parseInt(gapMs || "50", 10)
            }
          };
          return buildActions([sendDigitsAction]);
        }
        console.warn("[SEND_DTMF] Event without proper action");
        return buildActions([]);
      }
      case "ADD_CALL_CONNECTED": {
        if (args.callType === "AddCall" && args.primaryCallId) {
          const { primaryCallId, agentId, meetingId, holdPrimaryCall } = args;
          console.log(`[ADD_CALL_CONNECTED] Secondary call ${callId} connected for agent ${agentId}`, {
            primaryCallId,
            meetingId,
            holdPrimaryCall
          });
          if (meetingId && pstnLegCallId) {
            try {
              const attendeeResponse = await chime.send(new import_client_chime_sdk_meetings2.CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `secondary-${callId}`
              }));
              if (attendeeResponse.Attendee) {
                const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  IndexName: "callId-index",
                  KeyConditionExpression: "callId = :callId",
                  ExpressionAttributeValues: { ":callId": callId }
                }));
                if (callRecords && callRecords[0]) {
                  const callRecord = callRecords[0];
                  await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                    UpdateExpression: "SET #status = :connected, customerAttendeeInfo = :attendee, connectedAt = :now",
                    ExpressionAttributeNames: { "#status": "status" },
                    ExpressionAttributeValues: {
                      ":connected": "connected",
                      ":attendee": attendeeResponse.Attendee,
                      ":now": (/* @__PURE__ */ new Date()).toISOString()
                    }
                  }));
                }
                return buildActions([
                  buildSpeakAction("Connecting your second call."),
                  buildJoinChimeMeetingAction(
                    pstnLegCallId,
                    { MeetingId: meetingId },
                    attendeeResponse.Attendee
                  )
                ]);
              }
            } catch (err) {
              console.error("[ADD_CALL_CONNECTED] Failed to create attendee:", err);
              return buildActions([buildSpeakAction("Failed to connect the call.")]);
            }
          }
        }
        return buildActions([]);
      }
      case "CONFERENCE_MERGE": {
        if (args.action === "CONFERENCE_MERGE" && args.conferenceId && args.meetingId) {
          const { conferenceId, meetingId, agentId, role, otherCallId } = args;
          console.log(`[CONFERENCE_MERGE] Merging call ${callId} into conference ${conferenceId}`, {
            role,
            meetingId,
            otherCallId
          });
          if (pstnLegCallId) {
            try {
              const attendeeResponse = await chime.send(new import_client_chime_sdk_meetings2.CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `conference-${conferenceId}-${callId}`
              }));
              if (attendeeResponse.Attendee) {
                const { Items: callRecords } = await ddb.send(new import_lib_dynamodb12.QueryCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  IndexName: "callId-index",
                  KeyConditionExpression: "callId = :callId",
                  ExpressionAttributeValues: { ":callId": callId }
                }));
                if (callRecords && callRecords[0]) {
                  const callRecord = callRecords[0];
                  await ddb.send(new import_lib_dynamodb12.UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                    UpdateExpression: "SET conferenceAttendeeInfo = :attendee, conferenceJoinedAt = :now",
                    ExpressionAttributeValues: {
                      ":attendee": attendeeResponse.Attendee,
                      ":now": (/* @__PURE__ */ new Date()).toISOString()
                    }
                  }));
                }
                return buildActions([
                  buildSpeakAction("You are now in a conference call."),
                  buildJoinChimeMeetingAction(
                    pstnLegCallId,
                    { MeetingId: meetingId },
                    attendeeResponse.Attendee
                  )
                ]);
              }
            } catch (err) {
              console.error("[CONFERENCE_MERGE] Failed to join conference:", err);
              return buildActions([buildSpeakAction("Failed to join the conference.")]);
            }
          }
        }
        return buildActions([]);
      }
      case "CONFERENCE_ADD": {
        if (args.action === "CONFERENCE_ADD" && args.conferenceId && args.meetingId) {
          const { conferenceId, meetingId, agentId } = args;
          console.log(`[CONFERENCE_ADD] Adding call ${callId} to conference ${conferenceId}`);
          if (pstnLegCallId) {
            try {
              const attendeeResponse = await chime.send(new import_client_chime_sdk_meetings2.CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `conference-add-${conferenceId}-${callId}`
              }));
              if (attendeeResponse.Attendee) {
                return buildActions([
                  buildSpeakAction("Adding you to the conference."),
                  buildJoinChimeMeetingAction(
                    pstnLegCallId,
                    { MeetingId: meetingId },
                    attendeeResponse.Attendee
                  )
                ]);
              }
            } catch (err) {
              console.error("[CONFERENCE_ADD] Failed to add to conference:", err);
              return buildActions([buildSpeakAction("Failed to join the conference.")]);
            }
          }
        }
        return buildActions([]);
      }
      case "CONFERENCE_REMOVE": {
        if (args.action === "CONFERENCE_REMOVE" && args.conferenceId) {
          const { conferenceId, agentId } = args;
          console.log(`[CONFERENCE_REMOVE] Removing call ${callId} from conference ${conferenceId}`);
          return buildActions([
            buildSpeakAction("You have been removed from the conference. Goodbye."),
            buildPauseAction(500),
            { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
          ]);
        }
        return buildActions([]);
      }
      case "CONFERENCE_END": {
        if (args.action === "CONFERENCE_END" && args.conferenceId) {
          const { conferenceId, agentId } = args;
          console.log(`[CONFERENCE_END] Ending conference ${conferenceId} for call ${callId}`);
          return buildActions([
            buildSpeakAction("The conference has ended. Goodbye."),
            buildPauseAction(500),
            { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
          ]);
        }
        return buildActions([]);
      }
      case "ACTION_SUCCESSFUL":
      case "ACTION_INTERRUPTED":
      case "INVALID_LAMBDA_RESPONSE": {
        console.log(`Received informational event type: ${eventType}, returning empty actions.`);
        return buildActions([]);
      }
      case "ACTION_FAILED": {
        const failedActionType = event?.ActionData?.Type;
        const errorType = event?.ActionData?.ErrorType;
        const errorMessage = event?.ActionData?.ErrorMessage;
        console.warn(`[ACTION_FAILED] ${failedActionType ?? "Unknown"} failed`, { errorType, errorMessage });
        if (failedActionType === "PlayAudio") {
          const audioKey = event?.ActionData?.Parameters?.AudioSource?.Key;
          console.warn(`[ACTION_FAILED] PlayAudio for ${audioKey ?? "unknown asset"} failed. Falling back to spoken hold prompt.`);
          return buildActions([
            buildSpeakAction("Please stay on the line while we connect you to the next available agent."),
            buildPauseAction(1e3)
          ]);
        }
        if (failedActionType === "StartCallRecording") {
          console.warn(`[ACTION_FAILED] StartCallRecording failed - continuing call without recording`, { errorType, errorMessage });
          return buildActions([buildPauseAction(100)]);
        }
        if (failedActionType === "CallAndBridge") {
          const sipHeaders = event?.ActionData?.Parameters?.SipHeaders || {};
          const clinicIdFromHeader = sipHeaders["X-Clinic-Id"];
          const forwardReason = sipHeaders["X-Forward-Reason"];
          const originalCaller = sipHeaders["X-Original-Caller"] || "unknown";
          console.warn(`[ACTION_FAILED] CallAndBridge failed`, {
            errorType,
            errorMessage,
            clinicId: clinicIdFromHeader,
            forwardReason,
            originalCaller
          });
          if (forwardReason === "after-hours" && clinicIdFromHeader) {
            console.log(`[ACTION_FAILED] After-hours forward failed for clinic ${clinicIdFromHeader}; ending call`, {
              callId,
              clinicId: clinicIdFromHeader,
              originalCaller
            });
            return buildActions([
              buildSpeakAction(
                "Thank you for calling. We are currently closed and unable to connect you to our after-hours assistant. Please call back during regular business hours. Goodbye."
              ),
              { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
            ]);
          }
          return buildActions([
            buildSpeakAction("I'm sorry, we couldn't complete your call transfer. Please try again later."),
            { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
          ]);
        }
        console.warn(`[ACTION_FAILED] Returning pause action for failed ${failedActionType}`);
        return buildActions([buildPauseAction(100)]);
      }
      default:
        console.warn("Unknown event type:", eventType);
        return buildActions([buildHangupAction()]);
    }
  } catch (err) {
    console.error("Error in SMA handler:", err);
    return buildActions([buildHangupAction("An internal error occurred. Please try again.")]);
  }
};
var __test = {
  ddb,
  chime,
  isClinicOpen
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  __test,
  handler
});

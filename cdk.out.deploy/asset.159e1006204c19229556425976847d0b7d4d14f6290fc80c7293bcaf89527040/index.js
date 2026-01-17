"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// src/services/shared/utils/unique-id.ts
var unique_id_exports = {};
__export(unique_id_exports, {
  extractTimestampFromPosition: () => extractTimestampFromPosition,
  generateUniqueCallPosition: () => generateUniqueCallPosition,
  generateUniquePositionString: () => generateUniquePositionString,
  generateUniqueQueuePosition: () => generateUniqueQueuePosition,
  isValidQueuePosition: () => isValidQueuePosition
});
function generateNanoid(size = 10) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = (0, import_crypto2.randomBytes)(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}
function generateUniqueQueuePosition() {
  const timestamp = Date.now();
  const randomComponent = Math.floor(Math.random() * 1e3);
  return timestamp * 1e3 + randomComponent;
}
function generateUniquePositionString() {
  const timestamp = Date.now();
  const nanoid = generateNanoid(8);
  return `${timestamp}-${nanoid}`;
}
function generateUniqueCallPosition() {
  const timestamp = Date.now();
  const nanoid = generateNanoid(12);
  return {
    queuePosition: timestamp,
    uniquePositionId: nanoid
  };
}
function extractTimestampFromPosition(position) {
  if (position > Date.now() * 100) {
    return Math.floor(position / 1e3);
  }
  return position;
}
function isValidQueuePosition(position) {
  if (typeof position !== "number" || !isFinite(position)) {
    return false;
  }
  const minTimestamp = (/* @__PURE__ */ new Date("2020-01-01")).getTime();
  const maxTimestamp = Date.now() * 1e3 + 1e3;
  const extractedTimestamp = extractTimestampFromPosition(position);
  return extractedTimestamp >= minTimestamp && extractedTimestamp <= maxTimestamp;
}
var import_crypto2;
var init_unique_id = __esm({
  "src/services/shared/utils/unique-id.ts"() {
    "use strict";
    import_crypto2 = require("crypto");
  }
});

// src/services/chime/inbound-router.ts
var inbound_router_exports = {};
__export(inbound_router_exports, {
  __test: () => __test,
  handler: () => handler
});
module.exports = __toCommonJS(inbound_router_exports);
var import_client_dynamodb3 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb7 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_meetings = require("@aws-sdk/client-chime-sdk-meetings");
var import_client_lambda2 = require("@aws-sdk/client-lambda");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client_polly = require("@aws-sdk/client-polly");
var import_crypto3 = require("crypto");

// src/services/chime/utils/agent-selection.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var DEFAULT_CONFIG = {
  maxAgents: 25,
  considerIdleTime: true,
  considerWorkload: true,
  prioritizeContinuity: true,
  parallelRing: false
};
async function enrichCallContext(ddb4, callId, clinicId, phoneNumber, callQueueTableName, vipPhoneNumbers = /* @__PURE__ */ new Set()) {
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
    const { Items: previousCalls } = await ddb4.send(new import_lib_dynamodb.QueryCommand({
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
function scoreAgentForCall(agent, call, nowSeconds, config) {
  const breakdown = {
    skillMatch: 0,
    languageMatch: 0,
    idleTime: 0,
    workloadBalance: 0,
    continuity: 0,
    other: 0
  };
  let score = 0;
  const reasons = [];
  if (call.requiredSkills && call.requiredSkills.length > 0) {
    const agentSkills = agent.skills || [];
    const hasAllRequired = call.requiredSkills.every(
      (skill) => agentSkills.includes(skill)
    );
    if (!hasAllRequired) {
      return {
        agentId: agent.agentId,
        agent,
        score: -1e3,
        reasons: ["missing_required_skills"],
        breakdown
      };
    }
    breakdown.skillMatch += 50;
    score += 50;
    reasons.push("has_required_skills");
  }
  if (call.preferredSkills && call.preferredSkills.length > 0) {
    const agentSkills = agent.skills || [];
    const matchedPreferred = call.preferredSkills.filter(
      (skill) => agentSkills.includes(skill)
    );
    const preferredBonus = matchedPreferred.length * 10;
    breakdown.skillMatch += preferredBonus;
    score += preferredBonus;
    if (matchedPreferred.length > 0) {
      reasons.push(`matched_${matchedPreferred.length}_preferred_skills`);
    }
  }
  if (call.language) {
    const agentLanguages = agent.languages || ["en"];
    if (agentLanguages.includes(call.language)) {
      breakdown.languageMatch += 30;
      score += 30;
      reasons.push("language_match");
    } else {
      return {
        agentId: agent.agentId,
        agent,
        score: -1e3,
        reasons: ["language_mismatch"],
        breakdown
      };
    }
  }
  if (call.isVip) {
    if (!agent.canHandleVip) {
      return {
        agentId: agent.agentId,
        agent,
        score: -1e3,
        reasons: ["cannot_handle_vip"],
        breakdown
      };
    }
    breakdown.other += 40;
    score += 40;
    reasons.push("vip_capable");
  }
  if (config.considerIdleTime && agent.lastActivityAt) {
    const lastActivitySeconds = Math.floor(
      new Date(agent.lastActivityAt).getTime() / 1e3
    );
    const idleSeconds = nowSeconds - lastActivitySeconds;
    const idleMinutes = Math.floor(idleSeconds / 60);
    let idleBonus;
    if (idleMinutes <= 5) {
      idleBonus = idleMinutes * 10;
    } else if (idleMinutes <= 30) {
      idleBonus = 50 + Math.log2(idleMinutes - 4) * 10;
    } else {
      idleBonus = 100;
    }
    idleBonus = Math.min(Math.floor(idleBonus), 100);
    breakdown.idleTime += idleBonus;
    score += idleBonus;
    reasons.push(`idle_${idleMinutes}min_bonus_${idleBonus}`);
  }
  if (config.considerWorkload) {
    const recentCallCount = agent.recentCallCount || 0;
    const workloadPenalty = recentCallCount * 5;
    breakdown.workloadBalance -= workloadPenalty;
    score -= workloadPenalty;
    if (recentCallCount > 0) {
      reasons.push(`recent_calls_${recentCallCount}`);
    }
    const completedToday = agent.completedCallsToday || 0;
    if (completedToday < 10) {
      const balanceBonus = (10 - completedToday) * 2;
      breakdown.workloadBalance += balanceBonus;
      score += balanceBonus;
      reasons.push(`low_daily_count_${completedToday}`);
    }
  }
  if (config.prioritizeContinuity && call.isCallback && call.previousAgentId) {
    if (agent.agentId === call.previousAgentId) {
      breakdown.continuity += 100;
      score += 100;
      reasons.push("previous_handler");
    }
  }
  if (agent.lastCallCustomerPhone === call.phoneNumber) {
    const relationshipBonus = 50;
    breakdown.continuity += relationshipBonus;
    score += relationshipBonus;
    reasons.push("customer_relationship");
  }
  return {
    agentId: agent.agentId,
    agent,
    score,
    reasons,
    breakdown
  };
}
function selectBestAgents(agents, callContext, config = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const nowSeconds = Math.floor(Date.now() / 1e3);
  console.log("[selectBestAgents] Evaluating agents", {
    totalAgents: agents.length,
    callId: callContext.callId,
    priority: callContext.priority,
    isCallback: callContext.isCallback
  });
  let scoredAgents = agents.map((agent) => scoreAgentForCall(agent, callContext, nowSeconds, fullConfig)).filter((scored) => scored.score > -1e3);
  if (scoredAgents.length === 0 && callContext.requiredSkills) {
    console.warn("[selectBestAgents] No agents with required skills, trying flexible match");
    const relaxedContext = {
      ...callContext,
      preferredSkills: [...callContext.preferredSkills || [], ...callContext.requiredSkills],
      requiredSkills: []
    };
    scoredAgents = agents.map((agent) => scoreAgentForCall(agent, relaxedContext, nowSeconds, fullConfig)).filter((scored) => scored.score > -1e3);
    if (scoredAgents.length > 0) {
      console.log(`[selectBestAgents] Found ${scoredAgents.length} agents with flexible matching`);
    }
  }
  if (scoredAgents.length === 0) {
    console.warn("[selectBestAgents] No qualified agents found, using any available agent");
    const desperateContext = {
      ...callContext,
      requiredSkills: [],
      preferredSkills: [],
      language: void 0,
      // Relax language requirement too
      isVip: false
      // Don't require VIP capability
    };
    scoredAgents = agents.map((agent) => scoreAgentForCall(agent, desperateContext, nowSeconds, fullConfig)).filter((scored) => scored.score > -1e3);
  }
  if (scoredAgents.length === 0) {
    console.error("[selectBestAgents] No agents available at all");
    return [];
  }
  scoredAgents.sort((a, b) => b.score - a.score);
  const topCandidates = scoredAgents.slice(0, Math.min(5, scoredAgents.length));
  console.log(
    "[selectBestAgents] Top candidates:",
    topCandidates.map((s) => ({
      agentId: s.agentId,
      score: s.score,
      breakdown: s.breakdown,
      reasons: s.reasons
    }))
  );
  const selectedCount = Math.min(fullConfig.maxAgents, scoredAgents.length);
  const selected = scoredAgents.slice(0, selectedCount).map((s) => s.agent);
  console.log(`[selectBestAgents] Selected ${selected.length} agents for call ${callContext.callId}`);
  return selected;
}
async function fetchOnlineAgents(ddb4, clinicId, agentPresenceTableName, maxAgents = 25) {
  try {
    const allAgents = [];
    let lastEvaluatedKey = void 0;
    const targetCount = maxAgents * 4;
    do {
      const queryResult = await ddb4.send(new import_lib_dynamodb.QueryCommand({
        TableName: agentPresenceTableName,
        IndexName: "status-index",
        KeyConditionExpression: "#status = :status",
        FilterExpression: "contains(activeClinicIds, :clinicId)",
        ProjectionExpression: "agentId, skills, languages, canHandleVip, lastActivityAt, recentCallCount, completedCallsToday, lastCallCustomerPhone",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "Online",
          ":clinicId": clinicId
        },
        Limit: 100,
        // Reasonable batch size
        ExclusiveStartKey: lastEvaluatedKey
      }));
      if (queryResult.Items && queryResult.Items.length > 0) {
        allAgents.push(...queryResult.Items);
      }
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
      if (allAgents.length >= targetCount || !lastEvaluatedKey) {
        break;
      }
    } while (lastEvaluatedKey);
    if (allAgents.length === 0) {
      console.log(`[fetchOnlineAgents] No online agents found for clinic ${clinicId}`);
      return [];
    }
    console.log(`[fetchOnlineAgents] Found ${allAgents.length} online agents for clinic ${clinicId} (target: ${targetCount})`);
    return allAgents;
  } catch (err) {
    console.error("[fetchOnlineAgents] Error fetching agents:", err);
    return [];
  }
}
async function selectAgentsForCall(ddb4, callContext, agentPresenceTableName, config = {}) {
  const onlineAgents = await fetchOnlineAgents(
    ddb4,
    callContext.clinicId,
    agentPresenceTableName,
    config.maxAgents
  );
  if (onlineAgents.length === 0) {
    return [];
  }
  const selectedAgents = selectBestAgents(onlineAgents, callContext, config);
  return selectedAgents;
}

// src/services/chime/utils/parallel-assignment.ts
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");

// src/services/chime/utils/distributed-lock.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_crypto = require("crypto");
var RETRYABLE_ERRORS = [
  "ConditionalCheckFailedException",
  // Lock is held by another process
  "ProvisionedThroughputExceededException",
  // Throttling
  "ThrottlingException",
  // General throttling
  "RequestLimitExceeded",
  // Request rate limit
  "InternalServerError",
  // Transient internal error
  "ServiceUnavailable"
  // Service temporarily unavailable
];
var DistributedLock = class {
  constructor(ddb4, config) {
    this.ddb = ddb4;
    this.config = config;
    this.acquired = false;
    this.fencingToken = 0;
    this.lockId = (0, import_crypto.randomUUID)();
  }
  /**
   * Acquire the lock
   * @returns boolean for backwards compatibility
   */
  async acquire() {
    const result = await this.acquireWithFencingToken();
    return result.acquired;
  }
  /**
   * Acquire the lock with a fencing token
   * The fencing token is a monotonically increasing value that can be used
   * to detect stale lock holders in downstream operations.
   * 
   * FIX: Addresses the distributed systems problem where:
   * 1. Process A acquires lock
   * 2. Process A freezes (GC pause, throttling)
   * 3. Lock expires via TTL
   * 4. Process B acquires lock and makes progress
   * 5. Process A resumes - both think they have the lock
   * 
   * Solution: Downstream operations should verify fencing token hasn't been superseded
   */
  async acquireWithFencingToken() {
    const { tableName, lockKey, ttlSeconds = 30, maxRetries = 3, retryDelayMs = 100 } = this.config;
    const now = Math.floor(Date.now() / 1e3);
    const expiresAt = now + ttlSeconds;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        let nextFencingToken = 1;
        try {
          const { Item } = await this.ddb.send(new import_lib_dynamodb2.GetCommand({
            TableName: tableName,
            Key: { lockKey },
            ProjectionExpression: "fencingToken"
          }));
          if (Item?.fencingToken && typeof Item.fencingToken === "number") {
            nextFencingToken = Item.fencingToken + 1;
          }
        } catch (readErr) {
          console.warn(`[DistributedLock] Could not read current fencing token for ${lockKey}:`, readErr);
        }
        await this.ddb.send(new import_lib_dynamodb2.PutCommand({
          TableName: tableName,
          Item: {
            lockKey,
            lockId: this.lockId,
            acquiredAt: now,
            expiresAt,
            fencingToken: nextFencingToken,
            ttl: expiresAt + 300
            // Clean up 5 minutes after expiry
          },
          ConditionExpression: "attribute_not_exists(lockKey) OR expiresAt < :now",
          ExpressionAttributeValues: {
            ":now": now
          }
        }));
        this.acquired = true;
        this.fencingToken = nextFencingToken;
        console.log(`[DistributedLock] Acquired lock: ${lockKey} (fencingToken: ${nextFencingToken})`);
        return { acquired: true, fencingToken: nextFencingToken };
      } catch (err) {
        const errorName = err.name || err.code || "";
        const isRetryable = RETRYABLE_ERRORS.includes(errorName);
        if (isRetryable) {
          if (attempt < maxRetries - 1) {
            const baseBackoff = retryDelayMs * Math.pow(2, attempt);
            const jitter = Math.random() * baseBackoff * 0.1;
            const backoff = Math.floor(baseBackoff + jitter);
            if (errorName !== "ConditionalCheckFailedException") {
              console.warn(`[DistributedLock] Retryable error (${errorName}), attempt ${attempt + 1}/${maxRetries}, backoff ${backoff}ms: ${lockKey}`);
            }
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          console.warn(`[DistributedLock] Exhausted retries for ${lockKey} after ${errorName}`);
        } else {
          console.error(`[DistributedLock] Non-retryable error acquiring lock ${lockKey}:`, errorName, err.message);
          throw err;
        }
      }
    }
    console.warn(`[DistributedLock] Failed to acquire lock after ${maxRetries} attempts: ${lockKey}`);
    return { acquired: false };
  }
  async release() {
    if (!this.acquired)
      return;
    const { tableName, lockKey } = this.config;
    const maxReleaseRetries = 3;
    for (let attempt = 0; attempt < maxReleaseRetries; attempt++) {
      try {
        await this.ddb.send(new import_lib_dynamodb2.DeleteCommand({
          TableName: tableName,
          Key: { lockKey },
          ConditionExpression: "lockId = :lockId",
          ExpressionAttributeValues: {
            ":lockId": this.lockId
          }
        }));
        this.acquired = false;
        console.log(`[DistributedLock] Released lock: ${lockKey}`);
        return;
      } catch (err) {
        const errorName = err.name || err.code || "";
        if (errorName === "ConditionalCheckFailedException") {
          this.acquired = false;
          console.log(`[DistributedLock] Lock already released or expired: ${lockKey}`);
          return;
        }
        const isThrottling = ["ProvisionedThroughputExceededException", "ThrottlingException", "RequestLimitExceeded"].includes(errorName);
        if (isThrottling && attempt < maxReleaseRetries - 1) {
          const backoff = 100 * Math.pow(2, attempt);
          console.warn(`[DistributedLock] Throttled releasing lock, retrying in ${backoff}ms: ${lockKey}`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        console.error(`[DistributedLock] Error releasing lock: ${lockKey}`, errorName, err.message);
        this.acquired = false;
        return;
      }
    }
  }
  async withLock(fn) {
    const acquired = await this.acquire();
    if (!acquired)
      return null;
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
  /**
   * Check if this lock instance currently holds the lock
   */
  isAcquired() {
    return this.acquired;
  }
  /**
   * Get the fencing token for this lock acquisition
   * Returns 0 if lock was not acquired
   */
  getFencingToken() {
    return this.fencingToken;
  }
  /**
   * Validate that the current fencing token is still valid
   * This should be called before performing critical operations
   * to detect if another process has acquired the lock
   * 
   * @returns true if the fencing token is still the highest for this lock
   */
  async validateFencingToken() {
    if (!this.acquired || this.fencingToken === 0) {
      return false;
    }
    const { tableName, lockKey } = this.config;
    try {
      const { Item } = await this.ddb.send(new import_lib_dynamodb2.GetCommand({
        TableName: tableName,
        Key: { lockKey },
        ConsistentRead: true
      }));
      if (!Item) {
        console.warn(`[DistributedLock] Lock record not found for ${lockKey} - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      if (Item.lockId !== this.lockId) {
        console.warn(`[DistributedLock] Lock ${lockKey} owned by different process - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      if (Item.fencingToken !== this.fencingToken) {
        console.warn(`[DistributedLock] Fencing token mismatch for ${lockKey}: expected ${this.fencingToken}, got ${Item.fencingToken}`);
        this.acquired = false;
        return false;
      }
      const now = Math.floor(Date.now() / 1e3);
      if (Item.expiresAt < now) {
        console.warn(`[DistributedLock] Lock ${lockKey} has expired - fencing token invalid`);
        this.acquired = false;
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[DistributedLock] Error validating fencing token for ${lockKey}:`, err);
      return false;
    }
  }
};

// src/services/chime/utils/parallel-assignment.ts
var DEFAULT_CONFIG2 = {
  parallelCount: 3,
  retryOnThrottle: true,
  maxRetries: 2,
  backoffMs: 100
};
var CallAssignmentError = class extends Error {
  constructor(message, code, retryable, metadata) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.metadata = metadata;
    this.name = "CallAssignmentError";
  }
};
async function attemptSingleAssignment(ddb4, agentId, callContext, baseQueueItem, agentPresenceTableName, callQueueTableName, locksTableName, assignmentTimestamp) {
  const lock = new DistributedLock(ddb4, {
    tableName: locksTableName,
    lockKey: `call-assignment-${callContext.callId}`,
    ttlSeconds: 3
    // Reduced from 10s to 3s
  });
  const result = await lock.withLock(async () => {
    const { Items: existingCalls } = await ddb4.send(new import_lib_dynamodb3.QueryCommand({
      TableName: callQueueTableName,
      KeyConditionExpression: "clinicId = :clinicId AND queuePosition = :pos",
      ExpressionAttributeValues: {
        ":clinicId": baseQueueItem.clinicId,
        ":pos": baseQueueItem.queuePosition
      }
    }));
    if (existingCalls && existingCalls.length > 0) {
      return {
        success: false,
        error: new CallAssignmentError(
          "Call already assigned",
          "CALL_ALREADY_ASSIGNED",
          false,
          { callId: callContext.callId }
        )
      };
    }
    try {
      await ddb4.send(new import_lib_dynamodb3.TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: callQueueTableName,
              Item: {
                ...baseQueueItem,
                agentIds: [agentId],
                assignedAgentId: agentId,
                priority: callContext.priority,
                isVip: callContext.isVip,
                requiredSkills: callContext.requiredSkills,
                preferredSkills: callContext.preferredSkills,
                language: callContext.language,
                isCallback: callContext.isCallback
              },
              ConditionExpression: "attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)"
            }
          },
          {
            Update: {
              TableName: agentPresenceTableName,
              Key: { agentId },
              UpdateExpression: "SET #status = :ringing, ringingCallId = :callId, ringingCallTime = :time, ringingCallFrom = :from, ringingCallPriority = :priority, ringingCallClinicId = :clinicId, lastActivityAt = :time",
              ConditionExpression: "#status = :online",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":ringing": "ringing",
                ":callId": callContext.callId,
                ":time": assignmentTimestamp,
                ":from": callContext.phoneNumber,
                ":priority": callContext.priority || "normal",
                ":clinicId": callContext.clinicId,
                ":online": "Online"
              }
            }
          }
        ]
      }));
      return { success: true };
    } catch (err) {
      if (err.name === "TransactionCanceledException") {
        return {
          success: false,
          error: new CallAssignmentError(
            `Agent ${agentId} became unavailable during assignment`,
            "AGENT_UNAVAILABLE",
            false,
            { agentId, callId: callContext.callId }
          )
        };
      }
      if (err.name === "ProvisionedThroughputExceededException") {
        return {
          success: false,
          error: new CallAssignmentError(
            "DynamoDB throttled",
            "THROTTLED",
            true,
            { agentId, callId: callContext.callId }
          )
        };
      }
      return {
        success: false,
        error: new CallAssignmentError(
          `Assignment failed: ${err.message}`,
          "UNKNOWN_ERROR",
          false,
          { agentId, callId: callContext.callId, errorName: err.name }
        )
      };
    }
  });
  if (result === null) {
    return {
      success: false,
      error: new CallAssignmentError(
        "Failed to acquire lock",
        "LOCK_TIMEOUT",
        true,
        { callId: callContext.callId }
      )
    };
  }
  return result;
}
async function tryParallelAssignment(ddb4, selectedAgents, callContext, baseQueueItem, agentPresenceTableName, callQueueTableName, locksTableName, config = {}) {
  const fullConfig = { ...DEFAULT_CONFIG2, ...config };
  const startTime = Date.now();
  const assignmentTimestamp = (/* @__PURE__ */ new Date()).toISOString();
  const agentsToTry = selectedAgents.slice(0, fullConfig.parallelCount);
  const attemptedAgents = agentsToTry.map((a) => a.agentId);
  console.log(`[tryParallelAssignment] Attempting parallel assignment to ${agentsToTry.length} agents for call ${callContext.callId}`);
  const assignmentPromises = agentsToTry.map(
    (agent) => attemptSingleAssignment(
      ddb4,
      agent.agentId,
      callContext,
      baseQueueItem,
      agentPresenceTableName,
      callQueueTableName,
      locksTableName,
      assignmentTimestamp
    )
  );
  const results = await Promise.allSettled(assignmentPromises);
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value.success) {
      const duration2 = Date.now() - startTime;
      const successfulAgent = agentsToTry[i].agentId;
      console.log(`[tryParallelAssignment] Successfully assigned call ${callContext.callId} to agent ${successfulAgent} in ${duration2}ms`);
      return {
        success: true,
        agentId: successfulAgent,
        attemptedAgents,
        duration: duration2
      };
    }
  }
  const errors = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.error) {
      errors.push(result.value.error);
    }
  }
  const duration = Date.now() - startTime;
  const hasThrottleError = errors.some((e) => e.code === "THROTTLED");
  console.warn(`[tryParallelAssignment] All ${agentsToTry.length} parallel attempts failed for call ${callContext.callId}`, {
    errors: errors.map((e) => ({ code: e.code, message: e.message })),
    duration
  });
  return {
    success: false,
    agentId: null,
    attemptedAgents,
    duration,
    error: {
      code: hasThrottleError ? "THROTTLED" : "ALL_AGENTS_UNAVAILABLE",
      message: `Failed to assign call after ${agentsToTry.length} parallel attempts`,
      retryable: hasThrottleError
    }
  };
}
async function trySequentialAssignment(ddb4, selectedAgents, callContext, baseQueueItem, agentPresenceTableName, callQueueTableName, locksTableName, config = {}) {
  const fullConfig = { ...DEFAULT_CONFIG2, ...config };
  const startTime = Date.now();
  const attemptedAgents = [];
  const assignmentTimestamp = (/* @__PURE__ */ new Date()).toISOString();
  console.log(`[trySequentialAssignment] Attempting sequential assignment for ${selectedAgents.length} agents`);
  for (const agent of selectedAgents) {
    attemptedAgents.push(agent.agentId);
    let retryCount = 0;
    while (retryCount <= fullConfig.maxRetries) {
      const result = await attemptSingleAssignment(
        ddb4,
        agent.agentId,
        callContext,
        baseQueueItem,
        agentPresenceTableName,
        callQueueTableName,
        locksTableName,
        assignmentTimestamp
      );
      if (result.success) {
        const duration2 = Date.now() - startTime;
        console.log(`[trySequentialAssignment] Successfully assigned to ${agent.agentId} after ${retryCount} retries in ${duration2}ms`);
        return {
          success: true,
          agentId: agent.agentId,
          attemptedAgents,
          duration: duration2
        };
      }
      const error = result.error;
      if (error.code === "AGENT_UNAVAILABLE") {
        console.log(`[trySequentialAssignment] Agent ${agent.agentId} unavailable, trying next`);
        break;
      }
      if (error.code === "THROTTLED" && fullConfig.retryOnThrottle && retryCount < fullConfig.maxRetries) {
        const backoff = fullConfig.backoffMs * Math.pow(2, retryCount);
        console.log(`[trySequentialAssignment] Throttled, retrying after ${backoff}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        retryCount++;
        continue;
      }
      console.warn(`[trySequentialAssignment] Failed to assign to ${agent.agentId}: ${error.message}`);
      break;
    }
  }
  const duration = Date.now() - startTime;
  console.error(`[trySequentialAssignment] Failed to assign call ${callContext.callId} after trying ${attemptedAgents.length} agents`);
  return {
    success: false,
    agentId: null,
    attemptedAgents,
    duration,
    error: {
      code: "ALL_AGENTS_UNAVAILABLE",
      message: `Failed to assign call after trying ${attemptedAgents.length} agents`,
      retryable: false
    }
  };
}
async function smartAssignCall(ddb4, selectedAgents, callContext, baseQueueItem, agentPresenceTableName, callQueueTableName, locksTableName, useParallel = true, config = {}) {
  if (selectedAgents.length === 0) {
    return {
      success: false,
      agentId: null,
      attemptedAgents: [],
      duration: 0,
      error: {
        code: "NO_AGENTS_AVAILABLE",
        message: "No agents available for assignment",
        retryable: true
      }
    };
  }
  if (selectedAgents.length <= 2 || !useParallel) {
    return trySequentialAssignment(
      ddb4,
      selectedAgents,
      callContext,
      baseQueueItem,
      agentPresenceTableName,
      callQueueTableName,
      locksTableName,
      config
    );
  }
  const parallelResult = await tryParallelAssignment(
    ddb4,
    selectedAgents,
    callContext,
    baseQueueItem,
    agentPresenceTableName,
    callQueueTableName,
    locksTableName,
    config
  );
  if (parallelResult.success) {
    return parallelResult;
  }
  if (parallelResult.error?.code === "THROTTLED") {
    console.warn("[smartAssignCall] Parallel assignment throttled, not retrying with sequential");
    return parallelResult;
  }
  const remainingAgents = selectedAgents.slice(config.parallelCount || DEFAULT_CONFIG2.parallelCount);
  if (remainingAgents.length > 0) {
    console.log(`[smartAssignCall] Parallel failed, trying ${remainingAgents.length} remaining agents sequentially`);
    const sequentialResult = await trySequentialAssignment(
      ddb4,
      remainingAgents,
      callContext,
      baseQueueItem,
      agentPresenceTableName,
      callQueueTableName,
      locksTableName,
      config
    );
    return {
      ...sequentialResult,
      attemptedAgents: [
        ...parallelResult.attemptedAgents,
        ...sequentialResult.attemptedAgents
      ]
    };
  }
  return parallelResult;
}
function buildBaseQueueItem(clinicId, callId, phoneNumber, queueTimeoutSeconds = 86400) {
  const now = Date.now();
  const queueEntryTime = Math.floor(now / 1e3);
  const { generateUniqueQueuePosition: generateUniqueQueuePosition2 } = (init_unique_id(), __toCommonJS(unique_id_exports));
  const queuePosition = generateUniqueQueuePosition2();
  return {
    clinicId,
    callId,
    queuePosition,
    queueEntryTime,
    queueEntryTimeIso: new Date(now).toISOString(),
    phoneNumber,
    status: "ringing",
    direction: "inbound",
    ttl: queueEntryTime + queueTimeoutSeconds
  };
}

// src/services/chime/inbound-router.ts
init_unique_id();

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
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || "";
var DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || "";
var PUSH_NOTIFICATIONS_ENABLED = !!(SEND_PUSH_FUNCTION_ARN && DEVICE_TOKENS_TABLE);
var lambdaClient = null;
function getLambdaClient() {
  if (!lambdaClient) {
    lambdaClient = new import_client_lambda.LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return lambdaClient;
}
function isPushNotificationsEnabled() {
  return PUSH_NOTIFICATIONS_ENABLED;
}
async function invokeSendPushLambda(payload) {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    console.log("[ChimePush] Push notifications not configured, skipping");
    return false;
  }
  try {
    const response = await getLambdaClient().send(new import_client_lambda.InvokeCommand({
      FunctionName: SEND_PUSH_FUNCTION_ARN,
      Payload: JSON.stringify({
        _internalCall: true,
        ...payload
      }),
      InvocationType: "Event"
      // Async - don't wait for response
    }));
    console.log(`[ChimePush] Lambda invoked, StatusCode: ${response.StatusCode}`);
    return response.StatusCode === 202 || response.StatusCode === 200;
  } catch (error) {
    console.error("[ChimePush] Failed to invoke send-push Lambda:", error.message);
    return false;
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
  if (!PUSH_NOTIFICATIONS_ENABLED || agentUserIds.length === 0)
    return;
  const callerDisplay = getCallerDisplay(notification);
  await invokeSendPushLambda({
    userIds: agentUserIds,
    notification: {
      title: "Incoming Call",
      body: `${callerDisplay} calling ${notification.clinicName}`,
      type: "incoming_call",
      sound: "ringtone.caf",
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
  });
  console.log(`[ChimePush] Sent incoming call notification to ${agentUserIds.length} agents`);
}

// src/services/chime/utils/barge-in-detector.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb5 = require("@aws-sdk/lib-dynamodb");
var import_client_chime_sdk_voice = require("@aws-sdk/client-chime-sdk-voice");

// src/services/chime/utils/sma-map-ssm.ts
var import_client_ssm2 = require("@aws-sdk/client-ssm");
var ssm = new import_client_ssm2.SSMClient({});
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
      const result = await ssm.send(new import_client_ssm2.GetParameterCommand({
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

// src/services/chime/utils/barge-in-detector.ts
var ddb = import_lib_dynamodb5.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var CHIME_MEDIA_REGION2 = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chimeClient = new import_client_chime_sdk_voice.ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION2 });
var CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME || "";
var BARGE_IN_MIN_TRANSCRIPT_LENGTH = 5;
var BARGE_IN_COOLDOWN_MS = 2e3;
var AI_SPEAKING_MAX_DURATION_MS = 60 * 1e3;
var callSpeakingStates = /* @__PURE__ */ new Map();
function createBargeInDetector() {
  return {
    isAiSpeaking(callId) {
      const state = callSpeakingStates.get(callId);
      if (!state?.isAiSpeaking)
        return false;
      const now = Date.now();
      const speakingDuration = now - state.aiSpeakingStartTime;
      const maxDuration = state.expectedSpeechDurationMs || AI_SPEAKING_MAX_DURATION_MS;
      if (speakingDuration > maxDuration) {
        console.log("[BargeInDetector] AI speaking state auto-expired:", {
          callId,
          speakingDuration,
          maxDuration
        });
        state.isAiSpeaking = false;
        return false;
      }
      return true;
    },
    setAiSpeaking(callId, isSpeaking, expectedDurationMs) {
      let state = callSpeakingStates.get(callId);
      if (!state) {
        state = {
          isAiSpeaking: false,
          aiSpeakingStartTime: 0,
          lastBargeInTime: 0,
          pendingInterrupt: false
        };
        callSpeakingStates.set(callId, state);
      }
      state.isAiSpeaking = isSpeaking;
      if (isSpeaking) {
        state.aiSpeakingStartTime = Date.now();
        state.expectedSpeechDurationMs = expectedDurationMs;
      } else {
        state.expectedSpeechDurationMs = void 0;
      }
      console.log("[BargeInDetector] AI speaking state updated:", {
        callId,
        isAiSpeaking: isSpeaking,
        expectedDurationMs
      });
    },
    // FIX: Explicit method to clear speaking state after TTS completes
    clearSpeakingState(callId) {
      const state = callSpeakingStates.get(callId);
      if (state) {
        state.isAiSpeaking = false;
        state.expectedSpeechDurationMs = void 0;
        console.log("[BargeInDetector] Cleared speaking state for call:", callId);
      }
    },
    async onCallerSpeech(callId, clinicId, transcript) {
      const state = callSpeakingStates.get(callId);
      if (!this.isAiSpeaking(callId)) {
        return { shouldInterrupt: false, reason: "ai_not_speaking" };
      }
      if (transcript.trim().length < BARGE_IN_MIN_TRANSCRIPT_LENGTH) {
        return { shouldInterrupt: false, reason: "transcript_too_short" };
      }
      const now = Date.now();
      if (state && now - state.lastBargeInTime < BARGE_IN_COOLDOWN_MS) {
        return { shouldInterrupt: false, reason: "cooldown" };
      }
      console.log("[BargeInDetector] Barge-in detected:", {
        callId,
        transcript: transcript.substring(0, 50),
        aiSpeakingDuration: state ? now - state.aiSpeakingStartTime : 0
      });
      const success = await this.interruptCurrentAction(callId, clinicId, transcript);
      if (success && state) {
        state.lastBargeInTime = now;
        state.isAiSpeaking = false;
        state.pendingInterrupt = true;
        return { shouldInterrupt: true, reason: "interrupt_triggered" };
      }
      return { shouldInterrupt: false, reason: "interrupt_failed" };
    },
    async interruptCurrentAction(callId, clinicId, newTranscript) {
      try {
        const smaId = await getSmaIdForClinicSSM(clinicId);
        if (!smaId) {
          console.error("[BargeInDetector] No SMA ID found for clinic:", clinicId);
          return false;
        }
        const interruptActions = [
          {
            Type: "Pause",
            Parameters: {
              DurationInMilliseconds: "200"
            }
          }
        ];
        await chimeClient.send(new import_client_chime_sdk_voice.UpdateSipMediaApplicationCallCommand({
          SipMediaApplicationId: smaId,
          TransactionId: callId,
          Arguments: {
            interruptAction: "true",
            bargeInTranscript: newTranscript,
            bargeInTime: (/* @__PURE__ */ new Date()).toISOString(),
            pendingAiActions: JSON.stringify(interruptActions)
          }
        }));
        console.log("[BargeInDetector] Interrupt action sent:", {
          callId,
          clinicId,
          transcriptLength: newTranscript.length
        });
        if (CALL_QUEUE_TABLE) {
          try {
            const callRecord = await getCallRecordByCallId(callId);
            if (callRecord) {
              await ddb.send(new import_lib_dynamodb5.UpdateCommand({
                TableName: CALL_QUEUE_TABLE,
                Key: {
                  clinicId: callRecord.clinicId,
                  queuePosition: callRecord.queuePosition
                },
                UpdateExpression: "SET pendingBargeIn = :bargeIn, bargeInTranscript = :transcript, bargeInTime = :time",
                ExpressionAttributeValues: {
                  ":bargeIn": true,
                  ":transcript": newTranscript,
                  ":time": (/* @__PURE__ */ new Date()).toISOString()
                }
              }));
            }
          } catch (dbError) {
            console.warn("[BargeInDetector] Failed to update call record:", dbError.message);
          }
        }
        return true;
      } catch (error) {
        console.error("[BargeInDetector] Error sending interrupt:", {
          callId,
          error: error.message
        });
        return false;
      }
    },
    cleanup(callId) {
      callSpeakingStates.delete(callId);
      console.log("[BargeInDetector] Cleaned up state for call:", callId);
    }
  };
}
async function getCallRecordByCallId(callId) {
  if (!CALL_QUEUE_TABLE)
    return null;
  try {
    const result = await ddb.send(new import_lib_dynamodb5.QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: "callId-index",
      KeyConditionExpression: "callId = :callId",
      ExpressionAttributeValues: {
        ":callId": callId
      },
      Limit: 1
    }));
    return result.Items?.[0] || null;
  } catch (error) {
    console.warn("[BargeInDetector] Error querying call record:", error.message);
    return null;
  }
}
var bargeInDetector = createBargeInDetector();

// src/services/chime/utils/call-state-machine.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb6 = require("@aws-sdk/lib-dynamodb");
var ddb2 = import_lib_dynamodb6.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var CALL_QUEUE_TABLE2 = process.env.CALL_QUEUE_TABLE_NAME || "";
var CallState = /* @__PURE__ */ ((CallState2) => {
  CallState2["LISTENING"] = "LISTENING";
  CallState2["PROCESSING"] = "PROCESSING";
  CallState2["SPEAKING"] = "SPEAKING";
  CallState2["INTERRUPTED"] = "INTERRUPTED";
  CallState2["ENDED"] = "ENDED";
  return CallState2;
})(CallState || {});
var STATE_TRANSITIONS = {
  ["LISTENING" /* LISTENING */]: {
    ["TRANSCRIPT_RECEIVED" /* TRANSCRIPT_RECEIVED */]: "PROCESSING" /* PROCESSING */,
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["PROCESSING" /* PROCESSING */]: {
    ["AI_RESPONSE_READY" /* AI_RESPONSE_READY */]: "SPEAKING" /* SPEAKING */,
    ["BARGE_IN" /* BARGE_IN */]: "INTERRUPTED" /* INTERRUPTED */,
    // Can interrupt during processing too
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["SPEAKING" /* SPEAKING */]: {
    ["TTS_COMPLETED" /* TTS_COMPLETED */]: "LISTENING" /* LISTENING */,
    ["BARGE_IN" /* BARGE_IN */]: "INTERRUPTED" /* INTERRUPTED */,
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["INTERRUPTED" /* INTERRUPTED */]: {
    ["TRANSCRIPT_RECEIVED" /* TRANSCRIPT_RECEIVED */]: "PROCESSING" /* PROCESSING */,
    // Process the interrupting utterance
    ["CALL_ENDED" /* CALL_ENDED */]: "ENDED" /* ENDED */
  },
  ["ENDED" /* ENDED */]: {
    // Terminal state - no transitions
  }
};
var stateCache = /* @__PURE__ */ new Map();
var STATE_CACHE_TTL_MS = 5 * 60 * 1e3;
function createCallStateMachine() {
  return {
    getState(callId) {
      const entry = stateCache.get(callId);
      if (entry && Date.now() - entry.lastUpdate < STATE_CACHE_TTL_MS) {
        return entry.state;
      }
      return "LISTENING" /* LISTENING */;
    },
    transition(callId, event) {
      const currentState = this.getState(callId);
      const transitions = STATE_TRANSITIONS[currentState];
      const newState = transitions?.[event];
      if (newState) {
        const entry = stateCache.get(callId) || {
          state: currentState,
          lastUpdate: Date.now()
        };
        entry.state = newState;
        entry.lastUpdate = Date.now();
        if (newState === "PROCESSING" /* PROCESSING */) {
          entry.processingStartTime = Date.now();
        }
        if (newState === "LISTENING" /* LISTENING */) {
          entry.processingStartTime = void 0;
        }
        stateCache.set(callId, entry);
        console.log("[CallStateMachine] State transition:", {
          callId,
          from: currentState,
          event,
          to: newState
        });
        return newState;
      }
      console.warn("[CallStateMachine] Invalid transition:", {
        callId,
        currentState,
        event
      });
      return currentState;
    },
    canTransition(callId, event) {
      const currentState = this.getState(callId);
      const transitions = STATE_TRANSITIONS[currentState];
      return transitions?.[event] !== void 0;
    },
    canInterrupt(callId) {
      const state = this.getState(callId);
      return state === "SPEAKING" /* SPEAKING */ || state === "PROCESSING" /* PROCESSING */;
    },
    setMetadata(callId, metadata) {
      const entry = stateCache.get(callId) || {
        state: "LISTENING" /* LISTENING */,
        lastUpdate: Date.now()
      };
      Object.assign(entry, metadata);
      entry.lastUpdate = Date.now();
      stateCache.set(callId, entry);
    },
    getStateWithMetadata(callId) {
      return stateCache.get(callId) || {
        state: "LISTENING" /* LISTENING */,
        lastUpdate: Date.now()
      };
    },
    initializeCall(callId) {
      stateCache.set(callId, {
        state: "LISTENING" /* LISTENING */,
        lastUpdate: Date.now()
      });
      console.log("[CallStateMachine] Initialized call:", callId);
    },
    cleanup(callId) {
      stateCache.delete(callId);
      console.log("[CallStateMachine] Cleaned up call:", callId);
    },
    async persistState(callId, clinicId, queuePosition) {
      if (!CALL_QUEUE_TABLE2) {
        console.warn("[CallStateMachine] CALL_QUEUE_TABLE not configured");
        return;
      }
      const entry = stateCache.get(callId);
      if (!entry)
        return;
      try {
        await ddb2.send(new import_lib_dynamodb6.UpdateCommand({
          TableName: CALL_QUEUE_TABLE2,
          Key: { clinicId, queuePosition },
          UpdateExpression: "SET conversationState = :state, conversationStateTime = :time",
          ExpressionAttributeValues: {
            ":state": entry.state,
            ":time": (/* @__PURE__ */ new Date()).toISOString()
          }
        }));
        console.log("[CallStateMachine] Persisted state:", {
          callId,
          state: entry.state
        });
      } catch (error) {
        console.error("[CallStateMachine] Failed to persist state:", error.message);
      }
    },
    async loadState(callId, clinicId, queuePosition) {
      if (!CALL_QUEUE_TABLE2) {
        return "LISTENING" /* LISTENING */;
      }
      try {
        const result = await ddb2.send(new import_lib_dynamodb6.GetCommand({
          TableName: CALL_QUEUE_TABLE2,
          Key: { clinicId, queuePosition },
          ProjectionExpression: "conversationState"
        }));
        const state = result.Item?.conversationState;
        if (state && Object.values(CallState).includes(state)) {
          stateCache.set(callId, {
            state,
            lastUpdate: Date.now()
          });
          return state;
        }
      } catch (error) {
        console.error("[CallStateMachine] Failed to load state:", error.message);
      }
      return "LISTENING" /* LISTENING */;
    }
  };
}
var callStateMachine = createCallStateMachine();

// src/services/chime/inbound-router.ts
var ddb3 = import_lib_dynamodb7.DynamoDBDocumentClient.from(new import_client_dynamodb3.DynamoDBClient({}));
var lambdaClient2 = new import_client_lambda2.LambdaClient({});
var ttsS3 = new import_client_s3.S3Client({ region: process.env.AWS_REGION || "us-east-1" });
var polly = new import_client_polly.PollyClient({ region: process.env.AWS_REGION || "us-east-1" });
var CHIME_MEDIA_REGION3 = process.env.CHIME_MEDIA_REGION || "us-east-1";
var chime = new import_client_chime_sdk_meetings.ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION3 });
var CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
var AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
var CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
var LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME;
var HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET;
var POLLY_VOICE_ID = process.env.POLLY_VOICE_ID || "Joanna";
var POLLY_ENGINE = process.env.POLLY_ENGINE || "standard";
var TTS_SAMPLE_RATE = 8e3;
var MAX_RING_AGENTS = Math.max(1, Number.parseInt(process.env.MAX_RING_AGENTS || "25", 10));
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var ENABLE_PARALLEL_ASSIGNMENT = process.env.ENABLE_PARALLEL_ASSIGNMENT !== "false";
var PARALLEL_AGENT_COUNT = Math.max(1, Number.parseInt(process.env.PARALLEL_AGENT_COUNT || "3", 10));
var VOICE_AI_LAMBDA_ARN = process.env.VOICE_AI_LAMBDA_ARN;
var CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE;
var AI_AGENTS_TABLE = process.env.AI_AGENTS_TABLE;
var VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE;
var ENABLE_AFTER_HOURS_AI = process.env.ENABLE_AFTER_HOURS_AI === "true";
var ENABLE_MEETING_TRANSCRIPTION = process.env.ENABLE_MEETING_TRANSCRIPTION !== "false";
var TRANSCRIPTION_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || "en-US";
var MEDICAL_VOCABULARY_NAME = process.env.MEDICAL_VOCABULARY_NAME;
async function startMeetingTranscription(meetingId, callId) {
  if (!ENABLE_MEETING_TRANSCRIPTION) {
    console.log(`[Transcription] Meeting transcription disabled via environment`);
    return false;
  }
  console.log(`[Transcription] Starting real-time transcription for meeting ${meetingId} (call ${callId})`);
  try {
    await chime.send(new import_client_chime_sdk_meetings.StartMeetingTranscriptionCommand({
      MeetingId: meetingId,
      TranscriptionConfiguration: {
        EngineTranscribeSettings: {
          LanguageCode: TRANSCRIPTION_LANGUAGE,
          EnablePartialResultsStabilization: true,
          PartialResultsStability: "high",
          VocabularyName: MEDICAL_VOCABULARY_NAME || void 0
        }
      }
    }));
    console.log(`[Transcription] Successfully started for meeting ${meetingId}`, {
      language: TRANSCRIPTION_LANGUAGE,
      vocabulary: MEDICAL_VOCABULARY_NAME || "default"
    });
    return true;
  } catch (error) {
    if (error.name === "ConflictException") {
      console.log(`[Transcription] Already active for meeting ${meetingId}`);
      return true;
    }
    console.error(`[Transcription] Failed to start for meeting ${meetingId}:`, error.message || error);
    return false;
  }
}
var ENABLE_AI_PHONE_NUMBERS = process.env.ENABLE_AI_PHONE_NUMBERS === "true";
var AI_PHONE_NUMBERS = (() => {
  try {
    return JSON.parse(process.env.AI_PHONE_NUMBERS_JSON || "{}");
  } catch {
    console.warn("[AI_PHONE_NUMBERS] Failed to parse AI_PHONE_NUMBERS_JSON, defaulting to empty");
    return {};
  }
})();
function isAiPhoneNumber(phoneNumber) {
  if (!phoneNumber || !ENABLE_AI_PHONE_NUMBERS)
    return false;
  return phoneNumber in AI_PHONE_NUMBERS;
}
function getClinicIdForAiNumber(phoneNumber) {
  return AI_PHONE_NUMBERS[phoneNumber];
}
function isValidTransactionId(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}
var QUEUE_TIMEOUT = 24 * 60 * 60;
var AVG_CALL_DURATION = 300;
async function addToQueue(clinicId, callId, phoneNumber) {
  const now = Math.floor(Date.now() / 1e3);
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { Items: existingCalls } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
      await ddb3.send(new import_lib_dynamodb7.PutCommand({
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
  const { Items: finalCheck } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
    const { Items: thisCallItems } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
    const { Items: allQueuedCalls } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
    const { Items: onlineAgents } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
var sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
var pcmToWav = (pcmData, sampleRate, bitsPerSample, numChannels) => {
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
};
var synthesizeSpeechToS3 = async (text, callId) => {
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
  await ttsS3.send(new import_client_s3.PutObjectCommand({
    Bucket: HOLD_MUSIC_BUCKET,
    Key: audioKey,
    Body: wavData,
    ContentType: "audio/wav"
  }));
  return audioKey;
};
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
var buildSpeakAction = (text, voiceId = "Joanna", engine = "neural", callId) => ({
  Type: "Speak",
  Parameters: {
    Text: text,
    Engine: engine,
    LanguageCode: "en-US",
    TextType: "text",
    VoiceId: voiceId,
    ...callId && { CallId: callId }
  }
});
var buildTtsPlayAudioAction = async (text, targetCallId, callId) => {
  if (!HOLD_MUSIC_BUCKET) {
    console.warn("[TTS] HOLD_MUSIC_BUCKET not configured; falling back to Speak");
    return buildSpeakAction(text, POLLY_VOICE_ID, POLLY_ENGINE, targetCallId);
  }
  try {
    const audioKey = await synthesizeSpeechToS3(text, callId);
    return buildPlayAudioAction(audioKey, 1, targetCallId);
  } catch (err) {
    console.error("[TTS] Failed to synthesize speech, falling back to Speak", {
      error: err?.message || err
    });
    return buildSpeakAction(text, POLLY_VOICE_ID, POLLY_ENGINE, targetCallId);
  }
};
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
var AI_RECORDINGS_BUCKET = process.env.AI_RECORDINGS_BUCKET || process.env.RECORDINGS_BUCKET;
var ENABLE_RECORD_AUDIO_FALLBACK = process.env.ENABLE_RECORD_AUDIO_FALLBACK === "true";
var buildRecordAudioAction = (callId, clinicId, params) => ({
  Type: "RecordAudio",
  Parameters: {
    // CallId is REQUIRED when in a meeting context to target the correct leg
    // Use pstnLegCallId (LEG-A) to record the CALLER's audio, not the meeting/AI
    ...params?.pstnLegCallId && { CallId: params.pstnLegCallId },
    // Track INCOMING = caller's voice, OUTGOING = AI's voice, BOTH = mixed
    // We want INCOMING to capture what the caller says for transcription
    Track: "INCOMING",
    // Max recording duration - shorter = faster transcription (default 15 seconds)
    DurationInSeconds: Math.floor(params?.durationSeconds || 15),
    // End recording after silence - must be integer (default 2 seconds)
    SilenceDurationInSeconds: Math.floor(params?.silenceDurationSeconds || 2),
    // Silence threshold (0-1000, lower = more sensitive to quiet sounds)
    // Using 200 for better speech detection (Chime range is 0-1000)
    SilenceThreshold: Math.floor(params?.silenceThreshold || 200),
    // Allow caller to end recording with #
    RecordingTerminators: ["#"],
    // Save to S3 for transcription processing
    RecordingDestination: {
      Type: "S3",
      BucketName: AI_RECORDINGS_BUCKET,
      // Key pattern: ai-recordings/{clinicId}/{callId}/{timestamp}.wav
      Prefix: `ai-recordings/${clinicId}/${callId}/`
    }
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
var THINKING_AUDIO_KEY = "Computer-keyboard sound.wav";
var buildPlayThinkingAudioAction = (repeat = 1, callId) => ({
  Type: "PlayAudio",
  Parameters: {
    AudioSource: {
      Type: "S3",
      BucketName: HOLD_MUSIC_BUCKET,
      Key: THINKING_AUDIO_KEY
    },
    Repeat: repeat,
    PlaybackTerminators: ["#", "*"],
    ...callId && { CallId: callId }
  }
});
var buildSpeakAndGetDigitsAction = (text, maxDigits = 1, timeoutInSeconds = 10) => ({
  Type: "SpeakAndGetDigits",
  Parameters: {
    InputDigitsRegex: `^\\d{1,${maxDigits}}$`,
    SpeechParameters: {
      Text: text,
      Engine: "neural",
      LanguageCode: "en-US",
      TextType: "text",
      VoiceId: "Joanna"
    },
    FailureSpeechParameters: {
      Text: "I didn't catch that. Please try again.",
      Engine: "neural",
      LanguageCode: "en-US",
      TextType: "text",
      VoiceId: "Joanna"
    },
    MinNumberOfDigits: 1,
    MaxNumberOfDigits: maxDigits,
    TerminatorDigits: ["#"],
    InBetweenDigitsDurationInMilliseconds: 5e3,
    Repeat: 3,
    RepeatDurationInMilliseconds: timeoutInSeconds * 1e3
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
    await chime.send(new import_client_chime_sdk_meetings.DeleteMeetingCommand({ MeetingId: meetingId }));
  } catch (err) {
    if (err.name !== "NotFoundException") {
      console.warn("Error cleaning up meeting:", err);
    }
  }
}
var MEETING_CREATION_MAX_RETRIES = 3;
var MEETING_CREATION_RETRY_DELAY_MS = 500;
async function createAiMeetingWithPipeline(params) {
  const { callId, clinicId, aiAgentId, aiSessionId, callerNumber } = params;
  const startTime = Date.now();
  for (let attempt = 1; attempt <= MEETING_CREATION_MAX_RETRIES; attempt++) {
    try {
      console.log("[createAiMeetingWithPipeline] Creating AI meeting for real-time transcription", {
        callId,
        clinicId,
        aiAgentId,
        attempt,
        maxRetries: MEETING_CREATION_MAX_RETRIES
      });
      const shortClinicId = clinicId.substring(0, 20);
      const meetingResponse = await chime.send(new import_client_chime_sdk_meetings.CreateMeetingCommand({
        ClientRequestToken: `ai-${callId}-${attempt}`,
        // Include attempt in token for retries
        ExternalMeetingId: `ai-${shortClinicId}-${callId.substring(0, 8)}`,
        // ~35 chars max
        MediaRegion: CHIME_MEDIA_REGION3,
        // Meeting features for transcription
        MeetingFeatures: {
          Audio: {
            EchoReduction: "AVAILABLE"
            // Enable echo reduction for better transcription
          }
        }
      }));
      if (!meetingResponse.Meeting?.MeetingId) {
        console.error("[createAiMeetingWithPipeline] Failed to create meeting - no MeetingId returned", { attempt });
        if (attempt < MEETING_CREATION_MAX_RETRIES) {
          await sleep2(MEETING_CREATION_RETRY_DELAY_MS * attempt);
          continue;
        }
        console.error("[createAiMeetingWithPipeline] All meeting creation attempts failed");
        emitModeSelectionMetric("meeting-kvs", false, Date.now() - startTime);
        return null;
      }
      const meetingId = meetingResponse.Meeting.MeetingId;
      console.log("[createAiMeetingWithPipeline] Meeting created:", { meetingId, attempt });
      const attendeeResponse = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: `caller-${callerNumber.replace(/[^0-9]/g, "")}`,
        Capabilities: {
          Audio: "SendReceive",
          Video: "None",
          Content: "None"
        }
      }));
      if (!attendeeResponse.Attendee) {
        console.error("[createAiMeetingWithPipeline] Failed to create attendee", { meetingId, attempt });
        await cleanupMeeting(meetingId);
        if (attempt < MEETING_CREATION_MAX_RETRIES) {
          await sleep2(MEETING_CREATION_RETRY_DELAY_MS * attempt);
          continue;
        }
        emitModeSelectionMetric("meeting-kvs", false, Date.now() - startTime);
        return null;
      }
      console.log("[createAiMeetingWithPipeline] Attendee created:", attendeeResponse.Attendee.AttendeeId);
      console.log("[createAiMeetingWithPipeline] Meeting ready for caller to join", {
        meetingId,
        duration: Date.now() - startTime,
        attempt
      });
      emitModeSelectionMetric("meeting-kvs", true, Date.now() - startTime);
      return {
        meetingInfo: meetingResponse.Meeting,
        attendeeInfo: attendeeResponse.Attendee,
        pipelineId: null
        // Pipeline started after JoinChimeMeeting succeeds
      };
    } catch (error) {
      const isRetryable = error?.name === "ServiceUnavailableException" || error?.name === "ThrottlingException" || error?.$retryable?.throttling === true;
      console.error("[createAiMeetingWithPipeline] Error:", {
        error: error?.message || error,
        errorName: error?.name,
        attempt,
        isRetryable
      });
      if (isRetryable && attempt < MEETING_CREATION_MAX_RETRIES) {
        await sleep2(MEETING_CREATION_RETRY_DELAY_MS * attempt);
        continue;
      }
      emitModeSelectionMetric("meeting-kvs", false, Date.now() - startTime);
      return null;
    }
  }
  console.error("[createAiMeetingWithPipeline] Exhausted all retries");
  emitModeSelectionMetric("meeting-kvs", false, Date.now() - startTime);
  return null;
}
function emitModeSelectionMetric(mode, success, durationMs) {
  console.log("[METRIC] VoiceAI.ModeSelection", {
    mode,
    success,
    durationMs,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function isClinicOpen(clinicId) {
  if (!CLINIC_HOURS_TABLE) {
    console.warn("[isClinicOpen] CLINIC_HOURS_TABLE not configured - assuming open");
    return true;
  }
  try {
    const { Item } = await ddb3.send(new import_lib_dynamodb7.GetCommand({
      TableName: CLINIC_HOURS_TABLE,
      Key: { clinicId }
    }));
    if (!Item) {
      console.log("[isClinicOpen] No hours configured for clinic - defaulting to AI");
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
async function getVoiceAiAgentForClinic(clinicId) {
  if (!VOICE_CONFIG_TABLE || !AI_AGENTS_TABLE) {
    console.warn("[getVoiceAiAgentForClinic] Voice config tables not configured");
    return null;
  }
  try {
    const { Item: config } = await ddb3.send(new import_lib_dynamodb7.GetCommand({
      TableName: VOICE_CONFIG_TABLE,
      Key: { clinicId }
    }));
    if (config && config.aiInboundEnabled === false) {
      console.log("[getVoiceAiAgentForClinic] AI inbound is disabled for clinic", { clinicId });
      return null;
    }
    if (config && config.aiInboundEnabled !== true) {
      console.log("[getVoiceAiAgentForClinic] AI inbound not explicitly enabled", { clinicId, aiInboundEnabled: config.aiInboundEnabled });
    }
    let agentId = config?.inboundAgentId;
    if (!agentId) {
      const { Items: agents } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
        TableName: AI_AGENTS_TABLE,
        IndexName: "ClinicIndex",
        KeyConditionExpression: "clinicId = :cid",
        FilterExpression: "isActive = :active AND isVoiceEnabled = :voice AND bedrockAgentStatus = :status",
        ExpressionAttributeValues: {
          ":cid": clinicId,
          ":active": true,
          ":voice": true,
          ":status": "PREPARED"
        },
        Limit: 1
      }));
      if (agents && agents.length > 0) {
        agentId = agents[0].agentId;
      }
    }
    if (!agentId) {
      console.log("[getVoiceAiAgentForClinic] No voice AI agent found for clinic", { clinicId });
      return null;
    }
    const { Item: agent } = await ddb3.send(new import_lib_dynamodb7.GetCommand({
      TableName: AI_AGENTS_TABLE,
      Key: { agentId }
    }));
    if (!agent || !agent.bedrockAgentId || !agent.bedrockAgentAliasId || agent.bedrockAgentStatus !== "PREPARED") {
      console.warn("[getVoiceAiAgentForClinic] Agent not ready", { agentId, status: agent?.bedrockAgentStatus });
      return null;
    }
    console.log("[getVoiceAiAgentForClinic] Found voice AI agent", {
      clinicId,
      agentId,
      agentName: agent.name
    });
    return {
      agentId: agent.agentId,
      bedrockAgentId: agent.bedrockAgentId,
      bedrockAgentAliasId: agent.bedrockAgentAliasId
    };
  } catch (error) {
    console.error("[getVoiceAiAgentForClinic] Error getting voice agent:", error);
    return null;
  }
}
async function invokeVoiceAiHandler(event) {
  if (!VOICE_AI_LAMBDA_ARN) {
    console.error("[invokeVoiceAiHandler] VOICE_AI_LAMBDA_ARN not configured");
    return [{ action: "SPEAK", text: "Voice AI is not configured. Please try again during business hours." }];
  }
  try {
    const response = await lambdaClient2.send(new import_client_lambda2.InvokeCommand({
      FunctionName: VOICE_AI_LAMBDA_ARN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(event))
    }));
    if (response.Payload) {
      const result = JSON.parse(Buffer.from(response.Payload).toString());
      console.log("[invokeVoiceAiHandler] Voice AI response:", result);
      return Array.isArray(result) ? result : [result];
    }
    return [{ action: "CONTINUE" }];
  } catch (error) {
    console.error("[invokeVoiceAiHandler] Error invoking Voice AI:", error);
    return [{ action: "SPEAK", text: "I apologize, but I am having trouble processing your request. Please try calling back during office hours." }];
  }
}
async function routeInboundCallToVoiceAi(params) {
  const { clinicId, callId, fromPhoneNumber, pstnLegCallId, isAiPhoneNumber: isAiPhoneNumber2, source } = params;
  const voiceAiAgent = await getVoiceAiAgentForClinic(clinicId);
  if (!voiceAiAgent) {
    console.error(`[routeInboundCallToVoiceAi] No Voice AI agent configured`, { callId, clinicId, source });
    let clinicInfo = null;
    try {
      const clinicResult = await ddb3.send(new import_lib_dynamodb7.GetCommand({
        TableName: CLINICS_TABLE_NAME,
        Key: { clinicId }
      }));
      clinicInfo = clinicResult.Item;
    } catch (clinicErr) {
      console.warn("[routeInboundCallToVoiceAi] Could not fetch clinic info:", clinicErr);
    }
    const clinicName = clinicInfo?.clinicName || clinicInfo?.name || "our dental office";
    const { Items: onlineAgents } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
      TableName: AGENT_PRESENCE_TABLE_NAME,
      IndexName: "status-index",
      KeyConditionExpression: "#status = :status",
      FilterExpression: "contains(activeClinicIds, :clinicId)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "Online",
        ":clinicId": clinicId
      },
      Limit: 1
    }));
    if (onlineAgents && onlineAgents.length > 0) {
      console.log(`[routeInboundCallToVoiceAi] AI unavailable but human agents online - routing to queue`, { callId, clinicId, source });
      await addToQueue(clinicId, callId, fromPhoneNumber);
      return buildActions([
        buildSpeakAction(
          `Thank you for calling ${clinicName}. Our AI assistant is currently being updated. I'm connecting you with one of our team members. Please hold.`
        ),
        buildPauseAction(500),
        buildPlayAudioAction("hold-music.wav", 999)
      ]);
    }
    console.log(`[routeInboundCallToVoiceAi] No AI or agents available - offering voicemail`, { callId, clinicId, source });
    return buildActions([
      buildSpeakAction(
        `Thank you for calling ${clinicName}. Our AI assistant is currently unavailable and all of our team members are away. Please leave a message after the tone, and we'll return your call as soon as possible. To leave a message, please state your name, phone number, and the reason for your call.`
      ),
      buildPauseAction(1e3),
      // TODO: Add dedicated voicemail recording action when available.
      // For now, use RecordAudio to capture the message (if an S3 bucket is configured).
      AI_RECORDINGS_BUCKET ? buildRecordAudioAction(callId, clinicId, {
        durationSeconds: 120,
        // 2 minutes for voicemail
        silenceDurationSeconds: 5,
        silenceThreshold: 200,
        pstnLegCallId
        // Target the caller's leg
      }) : { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
    ]);
  }
  const voiceAiResponse = await invokeVoiceAiHandler({
    eventType: "NEW_CALL",
    callId,
    clinicId,
    callerNumber: fromPhoneNumber,
    aiAgentId: voiceAiAgent.agentId,
    isAiPhoneNumber: isAiPhoneNumber2
  });
  const actions = [];
  for (const response of voiceAiResponse) {
    switch (response.action) {
      case "SPEAK":
        if (response.text) {
          actions.push(buildSpeakAction(response.text));
        }
        break;
      case "HANG_UP":
        actions.push({ Type: "Hangup", Parameters: { SipResponseCode: "0" } });
        break;
      case "TRANSFER":
        actions.push(buildSpeakAction("Please hold while I transfer your call."));
        break;
      case "CONTINUE":
        break;
    }
  }
  const realTimeEnabled = isRealTimeTranscriptionEnabled();
  let pipelineMode = "dtmf-dialogue";
  let meetingInfo = null;
  let attendeeInfo = null;
  const aiSessionId = voiceAiResponse[0]?.sessionId || (0, import_crypto3.randomUUID)();
  const initialGreeting = voiceAiResponse.find((r) => r.action === "SPEAK")?.text || "Hello! Thank you for calling. I'm your AI assistant. How may I help you today?";
  if (realTimeEnabled && pstnLegCallId) {
    console.log("[routeInboundCallToVoiceAi] Attempting meeting-kvs mode", { callId, clinicId, source });
    const meetingResult = await createAiMeetingWithPipeline({
      callId,
      clinicId,
      aiAgentId: voiceAiAgent.agentId,
      aiSessionId,
      callerNumber: fromPhoneNumber
    });
    if (meetingResult) {
      pipelineMode = "meeting-kvs";
      meetingInfo = meetingResult.meetingInfo;
      attendeeInfo = meetingResult.attendeeInfo;
      console.log("[routeInboundCallToVoiceAi] Using meeting-kvs mode", {
        callId,
        clinicId,
        meetingId: meetingInfo?.MeetingId,
        attendeeId: attendeeInfo?.AttendeeId,
        source
      });
    } else {
      console.warn("[routeInboundCallToVoiceAi] Failed to create AI meeting, falling back", { callId, clinicId, source });
    }
  }
  if (pipelineMode !== "meeting-kvs" && AI_RECORDINGS_BUCKET) {
    pipelineMode = "record-transcribe";
    console.log("[routeInboundCallToVoiceAi] Using record-transcribe mode", { callId, clinicId, source });
  }
  const transcriptionEnabled = pipelineMode !== "dtmf-dialogue";
  const useDtmfFallback = pipelineMode === "dtmf-dialogue";
  const pipelineStatus = pipelineMode === "meeting-kvs" ? "starting" : transcriptionEnabled ? "active" : "disabled";
  if (pipelineMode === "meeting-kvs") {
    const beforeCount = actions.length;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i]?.Type === "Speak") {
        actions.splice(i, 1);
      }
    }
    const removed = beforeCount - actions.length;
    if (removed > 0) {
      console.log("[routeInboundCallToVoiceAi] Deferred initial greeting until after JoinChimeMeeting", {
        callId,
        removedSpeakActions: removed
      });
    }
  }
  const { queuePosition, uniquePositionId } = generateUniqueCallPosition();
  const now = Math.floor(Date.now() / 1e3);
  try {
    await ddb3.send(new import_lib_dynamodb7.PutCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Item: {
        clinicId,
        callId,
        queuePosition,
        uniquePositionId,
        queueEntryTime: now,
        queueEntryTimeIso: (/* @__PURE__ */ new Date()).toISOString(),
        phoneNumber: fromPhoneNumber,
        status: "connected",
        ttl: now + QUEUE_TIMEOUT,
        direction: "inbound",
        callType: "ai_direct",
        isAiPhoneNumber: isAiPhoneNumber2,
        isAiCall: true,
        // CRITICAL: Required for ai-transcript-bridge to process transcripts
        aiAgentId: voiceAiAgent.agentId,
        aiSessionId,
        transactionId: callId,
        transcriptionEnabled,
        pipelineMode,
        pipelineStatus,
        useDtmfFallback,
        ...pstnLegCallId ? { pstnCallId: pstnLegCallId } : {},
        ...meetingInfo ? {
          meetingId: meetingInfo.MeetingId,
          meetingInfo,
          customerAttendeeInfo: attendeeInfo
        } : {},
        // Store initial greeting to play after meeting join
        initialGreeting
      }
    }));
  } catch (err) {
    console.warn("[routeInboundCallToVoiceAi] Failed to create AI call record:", err);
  }
  if (pipelineMode === "meeting-kvs" && pstnLegCallId && meetingInfo && attendeeInfo) {
    actions.push(buildJoinChimeMeetingAction(pstnLegCallId, meetingInfo, attendeeInfo));
  } else if (pipelineMode === "record-transcribe" && pstnLegCallId) {
    actions.push(buildRecordAudioAction(callId, clinicId, {
      durationSeconds: 30,
      // Allow caller time to speak
      silenceDurationSeconds: 3,
      // End recording after 3s silence
      silenceThreshold: 100,
      // More sensitive to quiet speech (0-1000 range)
      pstnLegCallId
      // Target the caller's leg
    }));
  } else {
    actions.push(buildSpeakAndGetDigitsAction(
      "I am listening. You can speak or press a key on your phone.",
      1,
      30
    ));
  }
  console.log("[routeInboundCallToVoiceAi] AI call setup complete", {
    callId,
    clinicId,
    aiAgentId: voiceAiAgent.agentId,
    aiSessionId,
    actionsCount: actions.length,
    pipelineMode,
    transcriptionEnabled,
    useDtmfFallback,
    pipelineStatus,
    hasMeeting: !!meetingInfo,
    source
  });
  return buildActions(actions);
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
        if (isAiPhoneNumber(toPhoneNumber)) {
          const aiClinicId = getClinicIdForAiNumber(toPhoneNumber);
          console.log(`[NEW_INBOUND_CALL] AI PHONE NUMBER detected - routing directly to Voice AI`, {
            callId,
            toPhoneNumber,
            clinicId: aiClinicId,
            callerNumber: fromPhoneNumber
          });
          if (!aiClinicId) {
            console.error("[NEW_INBOUND_CALL] AI phone number has no clinic mapping");
            return buildActions([buildHangupAction("There was an error connecting your call.")]);
          }
          return await routeInboundCallToVoiceAi({
            clinicId: aiClinicId,
            callId,
            fromPhoneNumber,
            pstnLegCallId,
            isAiPhoneNumber: true,
            // Direct AI routing (no hours check needed)
            source: "ai_phone_number"
          });
        }
        const { Items: clinics } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
          const clinicOpen = await isClinicOpen(clinicId);
          if (!clinicOpen) {
            console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED - routing to AI via Chime SDK Meetings`, {
              callId,
              clinicId,
              callerNumber: fromPhoneNumber
            });
            return routeInboundCallToVoiceAi({
              callId,
              pstnLegCallId: pstnLegCallId || callId,
              fromPhoneNumber,
              clinicId,
              isAiPhoneNumber: false,
              source: "after_hours_forward"
            });
          }
          console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is OPEN - proceeding with human agent routing`);
        }
        const callContext = await enrichCallContext(
          ddb3,
          callId,
          clinicId,
          fromPhoneNumber,
          CALL_QUEUE_TABLE_NAME,
          getVipPhoneNumbers()
        );
        const selectedAgents = await selectAgentsForCall(
          ddb3,
          callContext,
          AGENT_PRESENCE_TABLE_NAME,
          {
            maxAgents: MAX_RING_AGENTS,
            considerIdleTime: true,
            considerWorkload: true,
            prioritizeContinuity: callContext.isCallback || false
          }
        );
        let assignmentSucceeded = false;
        if (selectedAgents.length > 0) {
          const baseQueueItem = buildBaseQueueItem(
            clinicId,
            callId,
            fromPhoneNumber,
            QUEUE_TIMEOUT
          );
          const assignmentResult = await smartAssignCall(
            ddb3,
            selectedAgents,
            callContext,
            baseQueueItem,
            AGENT_PRESENCE_TABLE_NAME,
            CALL_QUEUE_TABLE_NAME,
            LOCKS_TABLE_NAME,
            ENABLE_PARALLEL_ASSIGNMENT,
            {
              parallelCount: PARALLEL_AGENT_COUNT
            }
          );
          if (assignmentResult.success && assignmentResult.agentId) {
            assignmentSucceeded = true;
            console.log("[NEW_INBOUND_CALL] Call assigned to agent", {
              callId,
              agentId: assignmentResult.agentId,
              durationMs: assignmentResult.duration,
              attemptedAgents: assignmentResult.attemptedAgents.length
            });
            if (isPushNotificationsEnabled()) {
              try {
                await sendIncomingCallToAgents(assignmentResult.attemptedAgents, {
                  callId,
                  clinicId,
                  clinicName: clinicId,
                  // Use clinicId as clinicName fallback
                  callerPhoneNumber: fromPhoneNumber,
                  timestamp: (/* @__PURE__ */ new Date()).toISOString()
                });
              } catch (pushErr) {
                console.warn("[NEW_INBOUND_CALL] Failed to send push notification:", pushErr);
              }
            }
          } else {
            console.log("[NEW_INBOUND_CALL] Assignment failed, will queue call", {
              callId,
              error: assignmentResult.error
            });
          }
        }
        if (assignmentSucceeded) {
          console.log(`[NEW_INBOUND_CALL] Placing customer ${callId} on hold while ringing agent(s).`);
          const enableRecording = process.env.ENABLE_CALL_RECORDING === "true";
          const recordingsBucket = process.env.RECORDINGS_BUCKET;
          const actions = [];
          if (enableRecording && recordingsBucket && pstnLegCallId) {
            console.log(`[NEW_INBOUND_CALL] Starting recording for call ${callId}`);
            actions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));
            try {
              const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: "callId-index",
                KeyConditionExpression: "callId = :callId",
                ExpressionAttributeValues: { ":callId": callId }
              }));
              if (callRecords && callRecords[0]) {
                const { clinicId: clinicId2, queuePosition } = callRecords[0];
                await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId: clinicId2, queuePosition },
                  UpdateExpression: "SET recordingStarted = :true, recordingStartTime = :now, pstnCallId = :pstnCallId",
                  ExpressionAttributeValues: {
                    ":true": true,
                    ":now": (/* @__PURE__ */ new Date()).toISOString(),
                    ":pstnCallId": pstnLegCallId
                  }
                }));
                console.log("[NEW_INBOUND_CALL] Updated call record with pstnCallId:", pstnLegCallId);
              }
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
        console.log(`[NEW_INBOUND_CALL] No available Online agents for clinic ${clinicId} or assignment failed.`);
        if (ENABLE_AFTER_HOURS_AI) {
          const voiceAiAgent = await getVoiceAiAgentForClinic(clinicId);
          if (voiceAiAgent) {
            console.log(`[NEW_INBOUND_CALL] Offering AI assistance while no agents available`, {
              callId,
              clinicId,
              aiAgentId: voiceAiAgent.agentId
            });
            try {
              const queueEntry = await addToQueue(clinicId, callId, fromPhoneNumber);
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId, queuePosition: queueEntry.queuePosition },
                UpdateExpression: "SET aiAssistAvailable = :true, aiAgentId = :agentId",
                ExpressionAttributeValues: {
                  ":true": true,
                  ":agentId": voiceAiAgent.agentId
                }
              }));
              const queueInfo = await getQueuePosition(clinicId, callId);
              const waitMinutes = Math.ceil((queueInfo?.estimatedWaitTime || 120) / 60);
              return buildActions([
                buildSpeakAction(
                  `All of our agents are currently assisting other customers. Your estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? "minute" : "minutes"}. While you wait, I can connect you with ToothFairy, our AI assistant, who can help with scheduling or answer common questions. Press 1 to speak with the AI assistant, or stay on the line to wait for a human agent.`
                ),
                buildSpeakAndGetDigitsAction("Press 1 to speak with the AI assistant, or continue holding for a human agent.", 1, 15)
              ]);
            } catch (err) {
              console.warn("[NEW_INBOUND_CALL] Error setting up AI fallback:", err);
            }
          }
        }
        console.log(`[NEW_INBOUND_CALL] Adding call to queue.`);
        try {
          const queueEntry = await addToQueue(clinicId, callId, fromPhoneNumber);
          console.log("[NEW_INBOUND_CALL] Call added to queue", { clinicId, callId, queueEntry });
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
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
        if (callType === "AiOutbound") {
          const { scheduledCallId, aiAgentId, patientName, purpose, customMessage } = args;
          console.log(`[NEW_OUTBOUND_CALL] AI Outbound call initiated`, {
            callId,
            scheduledCallId,
            aiAgentId,
            clinicId,
            purpose
          });
          if (scheduledCallId) {
            try {
              const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE;
              if (SCHEDULED_CALLS_TABLE) {
                await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                  TableName: SCHEDULED_CALLS_TABLE,
                  Key: { callId: scheduledCallId },
                  UpdateExpression: "SET chimeTransactionId = :txId, smaInitiatedAt = :now",
                  ExpressionAttributeValues: {
                    ":txId": callId,
                    ":now": (/* @__PURE__ */ new Date()).toISOString()
                  }
                }));
              }
            } catch (err) {
              console.warn("[NEW_OUTBOUND_CALL] Failed to update scheduled call record:", err);
            }
          }
          return buildActions([]);
        }
        const outboundAgentId = args.agentId;
        const meetingId = args.meetingId;
        if (outboundAgentId) {
          try {
            await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
            const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
              TableName: CALL_QUEUE_TABLE_NAME,
              IndexName: "callId-index",
              KeyConditionExpression: "callId = :callId",
              ExpressionAttributeValues: { ":callId": callId }
            }));
            if (callRecords && callRecords[0]) {
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
        const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
        if (args.callType === "AiOutbound") {
          const { scheduledCallId, aiAgentId, clinicId, patientName, purpose, customMessage } = args;
          console.log(`[CALL_ANSWERED] AI Outbound call answered`, {
            callId,
            scheduledCallId,
            aiAgentId,
            clinicId,
            patientName,
            purpose
          });
          let greeting = "Hello";
          if (patientName)
            greeting = `Hello ${patientName}`;
          switch (purpose) {
            case "appointment_reminder":
              greeting += ". This is ToothFairy, your AI dental assistant, calling with a reminder about your upcoming appointment.";
              break;
            case "follow_up":
              greeting += ". This is ToothFairy from your dental office. I'm calling to check in on you after your recent visit.";
              break;
            case "payment_reminder":
              greeting += ". This is ToothFairy from your dental office calling about your account.";
              break;
            case "reengagement":
              greeting += ". This is ToothFairy from your dental office. It's been a while since your last visit, and we wanted to help you schedule an appointment.";
              break;
            default:
              if (customMessage) {
                greeting += `. ${customMessage}`;
              } else {
                greeting += ". This is ToothFairy, your AI dental assistant. How can I help you today?";
              }
          }
          const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE;
          if (SCHEDULED_CALLS_TABLE && scheduledCallId) {
            try {
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                TableName: SCHEDULED_CALLS_TABLE,
                Key: { callId: scheduledCallId },
                UpdateExpression: "SET #status = :status, answeredAt = :now, outcome = :outcome",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: {
                  ":status": "in_progress",
                  ":now": (/* @__PURE__ */ new Date()).toISOString(),
                  ":outcome": "answered"
                }
              }));
            } catch (err) {
              console.warn("[CALL_ANSWERED] Failed to update scheduled call:", err);
            }
          }
          return buildActions([
            buildSpeakAction(greeting),
            buildPauseAction(500),
            // Continue listening for response - will trigger DIGITS_RECEIVED or we need speech recognition
            // For now, add a prompt for user response
            buildSpeakAction("How can I assist you today? Press 1 to confirm your appointment, 2 to reschedule, or stay on the line to speak with me.")
          ]);
        }
        const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
          try {
            const customerAttendeeResponse = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
              MeetingId: meetingId,
              ExternalUserId: `customer-pstn-${callId}`
            }));
            if (!customerAttendeeResponse.Attendee?.AttendeeId) {
              throw new Error("Failed to create customer attendee for outbound call");
            }
            const customerAttendee = customerAttendeeResponse.Attendee;
            console.log(`[CALL_ANSWERED] Created customer attendee ${customerAttendee.AttendeeId}`);
            try {
              const { Items: callRecords2 } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: "callId-index",
                KeyConditionExpression: "callId = :id",
                ExpressionAttributeValues: { ":id": callId }
              }));
              if (callRecords2 && callRecords2[0]) {
                const { clinicId, queuePosition } = callRecords2[0];
                await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
                await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
                      await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
          const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
          const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
        if (args?.interruptAction === "true") {
          console.log("[CALL_UPDATE_REQUESTED] Barge-in interrupt received:", {
            callId,
            bargeInTime: args.bargeInTime,
            transcriptLength: args.bargeInTranscript?.length || 0
          });
          const interruptActions = args.pendingAiActions ? JSON.parse(args.pendingAiActions) : [buildPauseAction(200)];
          console.log("[CALL_UPDATE_REQUESTED] Executing interrupt actions:", {
            count: interruptActions.length,
            firstAction: interruptActions[0]?.Type
          });
          return buildActions(interruptActions);
        }
        if (args?.pendingAiActions) {
          try {
            const pending = typeof args.pendingAiActions === "string" ? JSON.parse(args.pendingAiActions) : args.pendingAiActions;
            const pendingActions = Array.isArray(pending) ? pending : [];
            if (args.isStreamingChunk === "true") {
              console.log("[CALL_UPDATE_REQUESTED] Streaming TTS chunk:", {
                callId,
                sequence: args.ttsSequence,
                isFinal: args.isFinalChunk
              });
            }
            try {
              const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: "callId-index",
                KeyConditionExpression: "callId = :callId",
                ExpressionAttributeValues: { ":callId": callId },
                Limit: 1
              }));
              if (callRecords && callRecords[0]) {
                await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId: callRecords[0].clinicId, queuePosition: callRecords[0].queuePosition },
                  UpdateExpression: "SET lastAiResponseAt = :now REMOVE pendingAiResponse, pendingAiResponseTime",
                  ExpressionAttributeValues: {
                    ":now": (/* @__PURE__ */ new Date()).toISOString()
                  }
                })).catch(() => void 0);
              }
            } catch (clearErr) {
              console.warn("[CALL_UPDATE_REQUESTED] Failed to clear pending AI response backup:", clearErr?.message || clearErr);
            }
            if (pendingActions.length > 0) {
              console.log("[CALL_UPDATE_REQUESTED] Returning pending AI actions:", { count: pendingActions.length });
              return buildActions(pendingActions);
            }
          } catch (err) {
            console.error("[CALL_UPDATE_REQUESTED] Failed to parse pendingAiActions:", err?.message || err);
          }
          return buildActions([]);
        }
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
        if (args.Action === "Hangup") {
          console.log(`[CALL_UPDATE_REQUESTED] Acknowledging Hangup request for call ${callId}`);
          const participants = event?.CallDetails?.Participants || [];
          const hangupActions = participants.filter((p) => p.Status === "Connected").map((p) => ({
            Type: "Hangup",
            Parameters: {
              CallId: p.CallId,
              SipResponseCode: "0"
            }
          }));
          if (hangupActions.length === 0) {
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
        const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
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
          const isAiMeetingKvs = callRecord.isAiCall && callRecord.pipelineMode === "meeting-kvs";
          const shouldCleanupMeeting = ((status === "queued" || status === "ringing") && !isOutboundCall || isAiMeetingKvs) && meetingInfo?.MeetingId;
          if (shouldCleanupMeeting) {
            try {
              await cleanupMeeting(meetingInfo.MeetingId);
              console.log(`[${eventType}] Cleaned up ${isAiMeetingKvs ? "AI meeting-kvs" : status.toUpperCase()} meeting ${meetingInfo.MeetingId}`);
            } catch (meetingErr) {
              console.warn(`[${eventType}] Failed to cleanup meeting:`, meetingErr);
            }
          } else if (isOutboundCall && meetingInfo?.MeetingId) {
            console.log(`[${eventType}] Outbound call ended. Agent session meeting ${meetingInfo.MeetingId} will NOT be deleted.`);
          } else if (meetingInfo?.MeetingId) {
            console.log(`[${eventType}] Call ended for agent session meeting ${meetingInfo.MeetingId}. Meeting will NOT be deleted.`);
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
            await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
          } catch (updateErr) {
            console.error(`[${eventType}] Failed to update call record:`, updateErr);
          }
          if (assignedAgentId) {
            try {
              const wasDialingOutbound = status === "dialing" && isOutboundCall;
              const dialingFailed = wasDialingOutbound && callEndReason !== "normal" && callEndReason !== "completed";
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: assignedAgentId },
                UpdateExpression: `SET #status = :status, lastActivityAt = :timestamp, lastCallEndedAt = :timestamp, 
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
              (agentId) => ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
          const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: "callId-index",
            KeyConditionExpression: "callId = :callId",
            ExpressionAttributeValues: { ":callId": callId }
          }));
          if (callRecords && callRecords[0]) {
            const callRecord = callRecords[0];
            const { clinicId, aiAgentId, aiAssistAvailable, isAiCall } = callRecord;
            if (receivedDigits === "1" && (aiAssistAvailable || isAiCall) && aiAgentId) {
              console.log(`[DIGITS_RECEIVED] Connecting customer to AI assistant`, { callId, aiAgentId });
              const voiceAiResponse = await invokeVoiceAiHandler({
                eventType: "NEW_CALL",
                callId,
                clinicId,
                callerNumber: callRecord.phoneNumber,
                aiAgentId
              });
              await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                UpdateExpression: "SET isAiCall = :true, aiConnectedAt = :now",
                ExpressionAttributeValues: {
                  ":true": true,
                  ":now": (/* @__PURE__ */ new Date()).toISOString()
                }
              }));
              const actions = [];
              for (const response of voiceAiResponse) {
                if (response.action === "SPEAK" && response.text) {
                  actions.push(buildSpeakAction(response.text));
                }
              }
              if (actions.length === 0) {
                actions.push(buildSpeakAction(
                  "Hi! I'm ToothFairy, your AI dental assistant. How can I help you today?"
                ));
              }
              actions.push(buildPauseAction(500));
              return buildActions(actions);
            }
            if (receivedDigits === "2" || !aiAssistAvailable) {
              console.log(`[DIGITS_RECEIVED] Customer chose to wait for human agent`, { callId });
              return buildActions([
                buildSpeakAction("No problem. Please stay on the line and an agent will be with you shortly."),
                buildPauseAction(500),
                buildPlayAudioAction("hold-music.wav", 999)
              ]);
            }
            if (isAiCall && aiAgentId) {
              const voiceAiResponse = await invokeVoiceAiHandler({
                eventType: "DTMF",
                callId,
                clinicId,
                dtmfDigits: receivedDigits,
                sessionId: callRecord.aiSessionId,
                aiAgentId
              });
              const actions = [];
              for (const response of voiceAiResponse) {
                if (response.action === "SPEAK" && response.text) {
                  actions.push(buildSpeakAction(response.text));
                } else if (response.action === "HANG_UP") {
                  actions.push(buildSpeakAction("Thank you for calling. Goodbye!"));
                  actions.push({ Type: "Hangup", Parameters: { SipResponseCode: "0" } });
                }
              }
              if (actions.length === 0) {
                actions.push(buildPauseAction(100));
              }
              return buildActions(actions);
            }
          }
        }
        if (eventType === "ACTION_SUCCESSFUL" && actionType === "JoinChimeMeeting") {
          console.log(`[ACTION_SUCCESSFUL] JoinChimeMeeting completed for call ${callId}`);
          try {
            const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
              TableName: CALL_QUEUE_TABLE_NAME,
              IndexName: "callId-index",
              KeyConditionExpression: "callId = :callId",
              ExpressionAttributeValues: { ":callId": callId }
            }));
            if (callRecords && callRecords[0]) {
              const callRecord = callRecords[0];
              if (callRecord.isAiCall && callRecord.pipelineMode === "meeting-kvs" && callRecord.pipelineStatus === "starting" && callRecord.meetingId) {
                console.log("[ACTION_SUCCESSFUL] AI call JoinChimeMeeting success - starting transcription", {
                  callId,
                  meetingId: callRecord.meetingId,
                  clinicId: callRecord.clinicId,
                  aiAgentId: callRecord.aiAgentId
                });
                startMeetingTranscription(callRecord.meetingId, callId).then(async (transcriptionStarted) => {
                  if (transcriptionStarted) {
                    console.log("[ACTION_SUCCESSFUL] Meeting transcription started for AI call:", {
                      callId,
                      meetingId: callRecord.meetingId
                    });
                    try {
                      await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                        UpdateExpression: "SET transcriptionEnabled = :enabled, transcriptionStatus = :status, transcriptionStartedAt = :now, pipelineStatus = :pipelineStatus",
                        ExpressionAttributeValues: {
                          ":enabled": true,
                          ":status": "active",
                          ":now": (/* @__PURE__ */ new Date()).toISOString(),
                          ":pipelineStatus": "transcription-active"
                        }
                      }));
                    } catch (updateErr) {
                      console.warn("[ACTION_SUCCESSFUL] Failed to update transcription status:", updateErr);
                    }
                  } else {
                    console.warn("[ACTION_SUCCESSFUL] Meeting transcription failed to start, trying Media Pipeline fallback");
                    return startMediaPipeline({
                      callId,
                      meetingId: callRecord.meetingId,
                      clinicId: callRecord.clinicId,
                      agentId: callRecord.aiAgentId,
                      customerPhone: callRecord.phoneNumber,
                      direction: "inbound",
                      isAiCall: true,
                      aiSessionId: callRecord.aiSessionId
                    }).then(async (pipelineId) => {
                      if (pipelineId) {
                        console.log("[ACTION_SUCCESSFUL] Media Pipeline started as fallback:", { callId, pipelineId });
                        await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                          TableName: CALL_QUEUE_TABLE_NAME,
                          Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                          UpdateExpression: "SET mediaPipelineId = :pipelineId, pipelineStatus = :status",
                          ExpressionAttributeValues: {
                            ":pipelineId": pipelineId,
                            ":status": "active"
                          }
                        }));
                      } else {
                        console.warn("[ACTION_SUCCESSFUL] Both transcription and Media Pipeline failed, using DTMF fallback");
                        await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                          TableName: CALL_QUEUE_TABLE_NAME,
                          Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                          UpdateExpression: "SET pipelineStatus = :status",
                          ExpressionAttributeValues: {
                            ":status": "dtmf-fallback"
                          }
                        }));
                      }
                    });
                  }
                }).catch((err) => {
                  console.error("[ACTION_SUCCESSFUL] Error in transcription/pipeline setup:", err);
                });
                const initialGreeting = callRecord.initialGreeting || "Hello! Thank you for calling. I'm your AI assistant. How may I help you today?";
                const callerLeg = event?.CallDetails?.Participants?.find(
                  (p) => p.ParticipantTag === "LEG-A"
                );
                const callerCallId = callerLeg?.CallId;
                console.log("[ACTION_SUCCESSFUL] Playing initial AI greeting to caller", {
                  callId,
                  callerCallId,
                  greeting: initialGreeting.substring(0, 50) + "..."
                });
                try {
                  await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                    UpdateExpression: "SET initialGreetingDeferredAt = :now",
                    ExpressionAttributeValues: { ":now": (/* @__PURE__ */ new Date()).toISOString() }
                  }));
                } catch (deferErr) {
                  console.warn("[ACTION_SUCCESSFUL] Failed to mark greeting deferred:", deferErr?.message || deferErr);
                }
                const waitActions = [];
                for (let i = 0; i < 4; i++) {
                  waitActions.push(buildPauseAction(3e3, callerCallId));
                }
                console.log("[ACTION_SUCCESSFUL] AI call meeting joined - greeting deferred; waiting for real-time transcripts");
                console.log("[ACTION_SUCCESSFUL] DEBUG: Returning actions:", JSON.stringify(waitActions.map((a) => ({ Type: a.Type, hasCallId: !!a.Parameters?.CallId }))));
                return buildActions(waitActions);
              }
            }
          } catch (err) {
            console.error("[ACTION_SUCCESSFUL] Error handling AI meeting join:", err);
          }
        }
        if (eventType === "ACTION_SUCCESSFUL" && actionType === "RecordAudio") {
          console.log(`[ACTION_SUCCESSFUL] RecordAudio completed for call ${callId}`, {
            recordingDestination: event?.ActionData?.Parameters?.RecordingDestination
          });
          console.log(`[ACTION_SUCCESSFUL] Waiting for AI response after RecordAudio`);
          return buildActions([
            buildPlayThinkingAudioAction(1, pstnLegCallId)
          ]);
        }
        if (eventType === "ACTION_SUCCESSFUL") {
          console.log(`[ACTION_SUCCESSFUL] Action completed for call ${callId}`, { actionType });
          if (actionType === "Speak" || actionType === "PlayAudio") {
            bargeInDetector.clearSpeakingState(callId);
            callStateMachine.transition(callId, "TTS_COMPLETED" /* TTS_COMPLETED */);
            console.log(`[ACTION_SUCCESSFUL] Cleared AI speaking state for call ${callId}, transitioned to LISTENING`);
          }
          try {
            const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
              TableName: CALL_QUEUE_TABLE_NAME,
              IndexName: "callId-index",
              KeyConditionExpression: "callId = :callId",
              ExpressionAttributeValues: { ":callId": callId }
            }));
            if (callRecords && callRecords[0]) {
              const callRecord = callRecords[0];
              if (actionType === "Pause" && callRecord.isAiCall && callRecord.initialGreeting && !callRecord.initialGreetingPlayedAt) {
                const targetCallId = callRecord.pstnCallId || pstnLegCallId || callId;
                console.log("[ACTION_SUCCESSFUL] Playing deferred initial greeting", {
                  callId,
                  targetCallId
                });
                const greetingAction = await buildTtsPlayAudioAction(
                  callRecord.initialGreeting,
                  targetCallId,
                  callId
                );
                try {
                  await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                    UpdateExpression: "SET initialGreetingPlayedAt = :now REMOVE initialGreetingDeferredAt",
                    ExpressionAttributeValues: { ":now": (/* @__PURE__ */ new Date()).toISOString() }
                  }));
                } catch (greetErr) {
                  console.warn("[ACTION_SUCCESSFUL] Failed to mark greeting played:", greetErr?.message || greetErr);
                }
                return buildActions([greetingAction]);
              }
              if (callRecord.isAiCall && callRecord.pendingAiResponse) {
                console.log("[ACTION_SUCCESSFUL] Found pending AI response, processing...");
                const pendingResponses = JSON.parse(callRecord.pendingAiResponse);
                const actions = [];
                for (const response of pendingResponses) {
                  switch (response.action) {
                    case "SPEAK":
                      if (response.text) {
                        const targetCallId = callRecord.pstnCallId || pstnLegCallId || callId;
                        actions.push(await buildTtsPlayAudioAction(response.text, targetCallId, callId));
                      }
                      break;
                    case "HANG_UP":
                      actions.push({ Type: "Hangup", Parameters: { SipResponseCode: "0" } });
                      break;
                    case "CONTINUE":
                      if (callRecord.pipelineMode === "meeting-kvs" && callRecord.mediaPipelineId) {
                        actions.push(buildPauseAction(2e3));
                      } else if (callRecord.pipelineMode === "meeting-kvs" && callRecord.useRecordAudioFallback && AI_RECORDINGS_BUCKET) {
                        actions.push(buildRecordAudioAction(callId, callRecord.clinicId, {
                          durationSeconds: 20,
                          silenceDurationSeconds: 2,
                          silenceThreshold: 120,
                          pstnLegCallId: callRecord.pstnCallId
                          // Target the caller's leg
                        }));
                      } else if (callRecord.pipelineMode === "record-transcribe" && AI_RECORDINGS_BUCKET) {
                        actions.push(buildRecordAudioAction(callId, callRecord.clinicId, {
                          durationSeconds: 30,
                          silenceDurationSeconds: 3,
                          silenceThreshold: 100,
                          pstnLegCallId: callRecord.pstnCallId
                          // Target the caller's leg
                        }));
                      } else if (callRecord.useDtmfFallback) {
                        actions.push(buildSpeakAndGetDigitsAction("I am listening. Please speak or press a key.", 1, 30));
                      } else {
                        actions.push(buildPauseAction(500));
                      }
                      break;
                  }
                }
                await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                  UpdateExpression: "SET lastAiResponseAt = :now REMOVE pendingAiResponse, pendingAiResponseTime",
                  ExpressionAttributeValues: {
                    ":now": (/* @__PURE__ */ new Date()).toISOString()
                  }
                }));
                if (actions.length > 0) {
                  console.log("[ACTION_SUCCESSFUL] Returning pending AI actions:", { count: actions.length });
                  return buildActions(actions);
                }
              }
              if (callRecord.isAiCall && !callRecord.pendingAiResponse) {
                const transcriptionIsActive = callRecord.pipelineStatus === "transcription-active" || callRecord.transcriptionStatus === "active" || callRecord.mediaPipelineId;
                const recordAudioFallbackAvailable = ENABLE_RECORD_AUDIO_FALLBACK && Boolean(AI_RECORDINGS_BUCKET);
                const nowSec = Math.floor(Date.now() / 1e3);
                const transcriptionStartedAtSec = callRecord.transcriptionStartedAt ? Math.floor(new Date(callRecord.transcriptionStartedAt).getTime() / 1e3) : void 0;
                const lastAiResponseAt = callRecord.lastAiResponseAt || callRecord.pendingAiResponseTime;
                const lastAiResponseSec = lastAiResponseAt ? Math.floor(new Date(lastAiResponseAt).getTime() / 1e3) : void 0;
                const baseStartSec = transcriptionStartedAtSec || (typeof callRecord.queueEntryTime === "number" ? callRecord.queueEntryTime : nowSec);
                const silenceSec = lastAiResponseSec ? nowSec - lastAiResponseSec : nowSec - baseStartSec;
                if (!transcriptionIsActive && callRecord.pipelineStatus === "starting") {
                  const startedAt = typeof callRecord.queueEntryTime === "number" ? callRecord.queueEntryTime : nowSec;
                  const waitingSec = nowSec - startedAt;
                  const alreadyPrompted = Boolean(callRecord.aiFallbackPromptedAt);
                  if (waitingSec >= 15 && !alreadyPrompted) {
                    const fallbackMode = recordAudioFallbackAvailable ? "record-audio" : "dtmf";
                    console.warn("[ACTION_SUCCESSFUL] Transcription not active after timeout; switching to fallback", {
                      callId,
                      waitingSec,
                      pipelineStatus: callRecord.pipelineStatus,
                      transcriptionStatus: callRecord.transcriptionStatus,
                      fallbackMode
                    });
                    try {
                      const pipelineStatus = recordAudioFallbackAvailable ? "record-audio-fallback" : "dtmf-fallback";
                      await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                        UpdateExpression: "SET useRecordAudioFallback = :raf, useDtmfFallback = :dtmf, transcriptionEnabled = :t, pipelineStatus = :s, aiFallbackPromptedAt = :now",
                        ExpressionAttributeValues: {
                          ":raf": recordAudioFallbackAvailable,
                          ":dtmf": !recordAudioFallbackAvailable,
                          ":t": recordAudioFallbackAvailable,
                          ":s": pipelineStatus,
                          ":now": (/* @__PURE__ */ new Date()).toISOString()
                        }
                      }));
                    } catch (fallbackErr) {
                      console.warn("[ACTION_SUCCESSFUL] Failed to persist fallback flag:", fallbackErr?.message || fallbackErr);
                    }
                    if (recordAudioFallbackAvailable) {
                      return buildActions([
                        buildRecordAudioAction(callId, callRecord.clinicId, {
                          durationSeconds: 20,
                          silenceDurationSeconds: 2,
                          silenceThreshold: 120,
                          pstnLegCallId: callRecord.pstnCallId
                          // Target the caller's leg
                        })
                      ]);
                    }
                    return buildActions([
                      buildSpeakAndGetDigitsAction("I am having trouble hearing you. Please press any number key (0 to 9) to continue.", 1, 30)
                    ]);
                  }
                }
                if (transcriptionIsActive && recordAudioFallbackAvailable && silenceSec >= 15 && !callRecord.useRecordAudioFallback) {
                  const alreadyPrompted = Boolean(callRecord.aiFallbackPromptedAt);
                  if (!alreadyPrompted) {
                    console.warn("[ACTION_SUCCESSFUL] No AI responses after transcription start; switching to RecordAudio fallback", {
                      callId,
                      silenceSec,
                      transcriptionStatus: callRecord.transcriptionStatus,
                      pipelineStatus: callRecord.pipelineStatus
                    });
                    try {
                      await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                        UpdateExpression: "SET useRecordAudioFallback = :raf, transcriptionEnabled = :t, pipelineStatus = :s, aiFallbackPromptedAt = :now",
                        ExpressionAttributeValues: {
                          ":raf": true,
                          ":t": true,
                          ":s": "record-audio-fallback",
                          ":now": (/* @__PURE__ */ new Date()).toISOString()
                        }
                      }));
                    } catch (fallbackErr) {
                      console.warn("[ACTION_SUCCESSFUL] Failed to persist fallback flag:", fallbackErr?.message || fallbackErr);
                    }
                    return buildActions([
                      buildRecordAudioAction(callId, callRecord.clinicId, {
                        durationSeconds: 20,
                        silenceDurationSeconds: 2,
                        silenceThreshold: 120,
                        pstnLegCallId: callRecord.pstnCallId
                        // Target the caller's leg
                      })
                    ]);
                  }
                }
                if (callRecord.useRecordAudioFallback && AI_RECORDINGS_BUCKET) {
                  return buildActions([
                    buildRecordAudioAction(callId, callRecord.clinicId, {
                      durationSeconds: 20,
                      silenceDurationSeconds: 2,
                      silenceThreshold: 120,
                      pstnLegCallId: callRecord.pstnCallId
                      // Target the caller's leg
                    })
                  ]);
                }
                if (callRecord.useDtmfFallback || !callRecord.transcriptionEnabled) {
                  return buildActions([
                    buildSpeakAndGetDigitsAction("I am listening. Please speak or press a key.", 1, 30)
                  ]);
                }
                return buildActions([buildPauseAction(2e3)]);
              }
            }
          } catch (err) {
            console.error("[ACTION_SUCCESSFUL] Error checking for pending AI response:", err);
          }
          return buildActions([]);
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
              const attendeeResponse = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `secondary-${callId}`
              }));
              if (attendeeResponse.Attendee) {
                const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  IndexName: "callId-index",
                  KeyConditionExpression: "callId = :callId",
                  ExpressionAttributeValues: { ":callId": callId }
                }));
                if (callRecords && callRecords[0]) {
                  const callRecord = callRecords[0];
                  await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
              const attendeeResponse = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `conference-${conferenceId}-${callId}`
              }));
              if (attendeeResponse.Attendee) {
                const { Items: callRecords } = await ddb3.send(new import_lib_dynamodb7.QueryCommand({
                  TableName: CALL_QUEUE_TABLE_NAME,
                  IndexName: "callId-index",
                  KeyConditionExpression: "callId = :callId",
                  ExpressionAttributeValues: { ":callId": callId }
                }));
                if (callRecords && callRecords[0]) {
                  const callRecord = callRecords[0];
                  await ddb3.send(new import_lib_dynamodb7.UpdateCommand({
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
              const attendeeResponse = await chime.send(new import_client_chime_sdk_meetings.CreateAttendeeCommand({
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
            console.log(`[ACTION_FAILED] Falling back to direct AI handling for clinic ${clinicIdFromHeader}`);
            try {
              return await routeInboundCallToVoiceAi({
                callId,
                clinicId: clinicIdFromHeader,
                fromPhoneNumber: originalCaller,
                pstnLegCallId,
                isAiPhoneNumber: false,
                // Not an AI phone number, this is fallback
                source: "after_hours_forward"
                // Use existing source type
              });
            } catch (fallbackErr) {
              console.error(`[ACTION_FAILED] Direct AI fallback failed:`, fallbackErr.message);
              return buildActions([
                buildSpeakAction(
                  "I'm sorry, we're experiencing technical difficulties with our after-hours assistant. Please try calling back in a few minutes, or call during regular business hours. Goodbye."
                ),
                { Type: "Hangup", Parameters: { SipResponseCode: "0" } }
              ]);
            }
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
  ddb: ddb3,
  lambdaClient: lambdaClient2,
  chime,
  isClinicOpen,
  isAiPhoneNumber,
  getClinicIdForAiNumber,
  routeInboundCallToVoiceAi
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  __test,
  handler
});

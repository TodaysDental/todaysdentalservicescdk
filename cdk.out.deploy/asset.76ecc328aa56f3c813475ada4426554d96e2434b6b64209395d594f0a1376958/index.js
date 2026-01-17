"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/ai-agents/outbound-queue-processor.ts
var outbound_queue_processor_exports = {};
__export(outbound_queue_processor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(outbound_queue_processor_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_scheduler = require("@aws-sdk/client-scheduler");

// node_modules/uuid/dist/esm-node/rng.js
var import_crypto = __toESM(require("crypto"));
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    import_crypto.default.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

// node_modules/uuid/dist/esm-node/native.js
var import_crypto2 = __toESM(require("crypto"));
var native_default = {
  randomUUID: import_crypto2.default.randomUUID
};

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
var v4_default = v4;

// src/services/ai-agents/outbound-queue-processor.ts
var dynamoClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var schedulerClient = new import_client_scheduler.SchedulerClient({
  region: process.env.AWS_REGION || "us-east-1"
});
var SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE || "ScheduledCalls";
var BULK_OUTBOUND_JOBS_TABLE = process.env.BULK_OUTBOUND_JOBS_TABLE || "BulkOutboundJobs";
var OUTBOUND_CALL_LAMBDA_ARN = process.env.OUTBOUND_CALL_LAMBDA_ARN || "";
var SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || "";
var handler = async (event) => {
  console.log("[OutboundQueueProcessor] Processing batch", {
    recordCount: event.Records.length
  });
  const batchItemFailures = [];
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      console.log("[OutboundQueueProcessor] Processing batch message", {
        jobId: message.jobId,
        batchIndex: message.batchIndex,
        totalBatches: message.totalBatches,
        callCount: message.calls.length
      });
      const results = await processBatch(message);
      await updateJobProgress(message.jobId, {
        processedCalls: results.processed,
        successfulCalls: results.successful,
        failedCalls: results.failed,
        isFinalBatch: message.batchIndex === message.totalBatches - 1
      });
      console.log("[OutboundQueueProcessor] Batch processed", {
        jobId: message.jobId,
        batchIndex: message.batchIndex,
        processed: results.processed,
        successful: results.successful,
        failed: results.failed
      });
    } catch (error) {
      console.error("[OutboundQueueProcessor] Failed to process batch", {
        messageId: record.messageId,
        error: error.message
      });
      batchItemFailures.push({
        itemIdentifier: record.messageId
      });
    }
  }
  return { batchItemFailures };
};
async function processBatch(message) {
  let successful = 0;
  let failed = 0;
  const PARALLEL_SIZE = 10;
  for (let i = 0; i < message.calls.length; i += PARALLEL_SIZE) {
    const batch = message.calls.slice(i, i + PARALLEL_SIZE);
    const results = await Promise.allSettled(
      batch.map((call) => createScheduledCall({
        ...call,
        clinicId: message.clinicId,
        agentId: message.agentId,
        timezone: message.timezone,
        maxAttempts: message.maxAttempts,
        jobId: message.jobId,
        createdBy: message.createdBy
      }))
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success) {
        successful++;
      } else {
        failed++;
        console.warn("[OutboundQueueProcessor] Call scheduling failed", {
          error: result.status === "rejected" ? result.reason.message : result.value.error
        });
      }
    }
  }
  return {
    processed: message.calls.length,
    successful,
    failed
  };
}
async function createScheduledCall(params) {
  const callId = v4_default();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const schedulerName = `outbound-call-${callId}`;
  const scheduledDate = new Date(params.scheduledTime);
  if (scheduledDate <= /* @__PURE__ */ new Date()) {
    return { success: false, error: "scheduledTime must be in the future" };
  }
  const normalizedPhone = params.phoneNumber.replace(/\D/g, "");
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return { success: false, error: "Invalid phone number" };
  }
  const scheduledCall = {
    callId,
    clinicId: params.clinicId,
    agentId: params.agentId,
    phoneNumber: params.phoneNumber,
    patientName: params.patientName,
    patientId: params.patientId,
    scheduledTime: params.scheduledTime,
    timezone: params.timezone || "America/New_York",
    purpose: params.purpose,
    customMessage: params.customMessage,
    appointmentId: params.appointmentId,
    status: "scheduled",
    attempts: 0,
    maxAttempts: params.maxAttempts || 3,
    schedulerName,
    jobId: params.jobId,
    createdAt: timestamp,
    createdBy: params.createdBy,
    updatedAt: timestamp,
    ttl: Math.floor(scheduledDate.getTime() / 1e3) + 7 * 24 * 60 * 60
    // 7 days after scheduled time
  };
  try {
    const scheduleResponse = await schedulerClient.send(new import_client_scheduler.CreateScheduleCommand({
      Name: schedulerName,
      ScheduleExpression: `at(${scheduledDate.toISOString().replace(/\.\d{3}Z$/, "")})`,
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
      // Auto-cleanup after execution
      Target: {
        Arn: OUTBOUND_CALL_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          callId,
          clinicId: params.clinicId,
          agentId: params.agentId,
          phoneNumber: params.phoneNumber,
          patientName: params.patientName,
          purpose: params.purpose,
          customMessage: params.customMessage
        })
      }
    }));
    scheduledCall.schedulerArn = scheduleResponse.ScheduleArn;
    await docClient.send(new import_lib_dynamodb.PutCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Item: scheduledCall
    }));
    return { success: true, callId };
  } catch (error) {
    console.error("[OutboundQueueProcessor] Failed to create schedule", {
      callId,
      error: error.message
    });
    return { success: false, error: error.message };
  }
}
async function updateJobProgress(jobId, progress) {
  try {
    const updateExpression = progress.isFinalBatch ? "SET processedCalls = processedCalls + :processed, successfulCalls = successfulCalls + :successful, failedCalls = failedCalls + :failed, #status = :completed, completedAt = :now, updatedAt = :now" : "SET processedCalls = processedCalls + :processed, successfulCalls = successfulCalls + :successful, failedCalls = failedCalls + :failed, #status = :processing, updatedAt = :now";
    await docClient.send(new import_lib_dynamodb.UpdateCommand({
      TableName: BULK_OUTBOUND_JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":processed": progress.processedCalls,
        ":successful": progress.successfulCalls,
        ":failed": progress.failedCalls,
        ":completed": "completed",
        ":processing": "processing",
        ":now": (/* @__PURE__ */ new Date()).toISOString()
      }
    }));
  } catch (error) {
    console.error("[OutboundQueueProcessor] Failed to update job progress", {
      jobId,
      error: error.message
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

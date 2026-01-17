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

// src/services/rcs/sms-fallback-processor.ts
var sms_fallback_processor_exports = {};
__export(sms_fallback_processor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(sms_fallback_processor_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// src/shared/utils/secrets-helper.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamoClient = null;
function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = new import_client_dynamodb.DynamoDBClient({});
  }
  return dynamoClient;
}
var CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
var GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || "TodaysDentalInsights-GlobalSecrets";
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
var CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || "300000", 10);
var clinicConfigCache = /* @__PURE__ */ new Map();
function isCacheValid(entry) {
  return entry !== void 0 && entry.expiresAt > Date.now();
}
function setCacheEntry(cache, key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}
async function getClinicConfig(clinicId) {
  const cached = clinicConfigCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().send(new import_client_dynamodb.GetItemCommand({
      TableName: CLINIC_CONFIG_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    }));
    if (!response.Item) {
      console.warn(`[SecretsHelper] No config found for clinic: ${clinicId}`);
      return null;
    }
    const config = (0, import_util_dynamodb.unmarshall)(response.Item);
    setCacheEntry(clinicConfigCache, clinicId, config);
    return config;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching clinic config for ${clinicId}:`, error);
    throw error;
  }
}

// src/services/rcs/sms-fallback-processor.ts
var { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require("@aws-sdk/client-pinpoint-sms-voice-v2");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var smsClient = new PinpointSMSVoiceV2Client({});
var RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE;
var CLINIC_CONFIG_TABLE2 = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
function normalizePhone(phone) {
  if (!phone)
    return void 0;
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+")) {
    const digits2 = cleaned.slice(1).replace(/\D/g, "");
    if (digits2.length < 7)
      return void 0;
    return `+${digits2}`;
  }
  const digits = cleaned.replace(/\D/g, "");
  if (!digits)
    return void 0;
  if (digits.length === 10)
    return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1"))
    return `+${digits}`;
  if (digits.length >= 7)
    return `+${digits}`;
  return void 0;
}
async function getClinicSmsOriginationArn(clinicId) {
  const config = await getClinicConfig(clinicId);
  return config?.smsOriginationArn;
}
async function sendSms(clinicId, to, body) {
  try {
    const originationArn = await getClinicSmsOriginationArn(clinicId);
    if (!originationArn) {
      console.error(`No SMS origination ARN configured for clinic ${clinicId}`);
      return { success: false, error: "No SMS origination ARN configured" };
    }
    const normalizedPhone = normalizePhone(to);
    if (!normalizedPhone) {
      console.error(`Invalid phone number: ${to}`);
      return { success: false, error: "Invalid phone number format" };
    }
    const cmd = new SendTextMessageCommand({
      DestinationPhoneNumber: normalizedPhone,
      MessageBody: body,
      OriginationIdentity: originationArn,
      MessageType: "TRANSACTIONAL"
    });
    const response = await smsClient.send(cmd);
    console.log(`SMS sent successfully to ${normalizedPhone}:`, response.MessageId);
    return { success: true, messageId: response.MessageId };
  } catch (error) {
    console.error("Failed to send SMS:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
async function storeFallbackSmsRecord(clinicId, originalMessageSid, to, body, smsResult) {
  const timestamp = Date.now();
  await ddb.send(new import_lib_dynamodb.PutCommand({
    TableName: RCS_MESSAGES_TABLE,
    Item: {
      pk: `CLINIC#${clinicId}`,
      sk: `SMS_FALLBACK#${timestamp}#${originalMessageSid}`,
      clinicId,
      direction: "outbound",
      messageType: "sms_fallback",
      originalRcsMessageSid: originalMessageSid,
      to,
      body,
      smsMessageId: smsResult.messageId,
      status: smsResult.success ? "sent" : "failed",
      error: smsResult.error,
      timestamp,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ttl: Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60
      // 90 days TTL
    }
  }));
}
async function processFallbackMessage(record) {
  console.log("Processing fallback message:", record.Sns.MessageId);
  let message;
  try {
    message = JSON.parse(record.Sns.Message);
  } catch (error) {
    console.error("Failed to parse SNS message:", error);
    return;
  }
  if (message.eventType !== "RCS_FALLBACK_RECEIVED") {
    console.log(`Ignoring event type: ${message.eventType}`);
    return;
  }
  const { clinicId, messageSid, from, body, errorCode, errorMessage } = message;
  console.log(`Processing RCS fallback for clinic ${clinicId}:`, {
    messageSid,
    from,
    errorCode,
    errorMessage
  });
  if (!from) {
    console.log("No sender phone number - skipping SMS fallback");
    return;
  }
  const smsBody = body ? `We received your message: "${body.substring(0, 100)}${body.length > 100 ? "..." : ""}". We'll respond shortly.` : "We received your message and will respond shortly.";
  const smsResult = await sendSms(clinicId, from, smsBody);
  await storeFallbackSmsRecord(clinicId, messageSid, from, smsBody, smsResult);
  if (smsResult.success) {
    console.log(`SMS fallback sent successfully for message ${messageSid}`);
  } else {
    console.error(`SMS fallback failed for message ${messageSid}:`, smsResult.error);
  }
}
var handler = async (event, context) => {
  console.log("SMS Fallback Processor Event:", JSON.stringify(event, null, 2));
  const results = await Promise.allSettled(
    event.Records.map((record) => processFallbackMessage(record))
  );
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.error(
      `${failures.length} message(s) failed to process:`,
      failures.map((f) => f.reason)
    );
  }
  console.log(`Processed ${event.Records.length} messages, ${failures.length} failures`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

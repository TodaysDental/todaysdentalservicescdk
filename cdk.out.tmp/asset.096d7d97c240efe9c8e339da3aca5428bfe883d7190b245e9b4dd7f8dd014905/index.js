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

// src/services/rcs/incoming-message.ts
var incoming_message_exports = {};
__export(incoming_message_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(incoming_message_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_crypto = __toESM(require("crypto"));

// src/shared/utils/secrets-helper.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamoClient = null;
function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = new import_client_dynamodb.DynamoDB({});
  }
  return dynamoClient;
}
var CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
var GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || "TodaysDentalInsights-GlobalSecrets";
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || "TodaysDentalInsights-ClinicConfig";
var CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || "300000", 10);
var globalSecretsCache = /* @__PURE__ */ new Map();
function isCacheValid(entry) {
  return entry !== void 0 && entry.expiresAt > Date.now();
}
function setCacheEntry(cache, key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}
async function getGlobalSecret(secretId, secretType) {
  const cacheKey = `${secretId}#${secretType}`;
  const cached = globalSecretsCache.get(cacheKey);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: GLOBAL_SECRETS_TABLE,
      Key: {
        secretId: { S: secretId },
        secretType: { S: secretType }
      }
    });
    if (!response.Item) {
      console.warn(`[SecretsHelper] No global secret found: ${secretId}/${secretType}`);
      return null;
    }
    const entry = (0, import_util_dynamodb.unmarshall)(response.Item);
    setCacheEntry(globalSecretsCache, cacheKey, entry.value);
    return entry.value;
  } catch (error) {
    console.error(`[SecretsHelper] Error fetching global secret ${secretId}/${secretType}:`, error);
    throw error;
  }
}
async function getTwilioCredentials() {
  const [accountSid, authToken] = await Promise.all([
    getGlobalSecret("twilio", "account_sid"),
    getGlobalSecret("twilio", "auth_token")
  ]);
  if (!accountSid || !authToken) {
    return null;
  }
  return { accountSid, authToken };
}

// src/services/rcs/incoming-message.ts
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var lambdaClient = new import_client_lambda.LambdaClient({});
var RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE;
var RCS_AUTO_REPLY_FUNCTION_ARN = process.env.RCS_AUTO_REPLY_FUNCTION_ARN || "";
var ENABLE_RCS_AUTO_REPLY = (process.env.ENABLE_RCS_AUTO_REPLY || "true").toLowerCase() !== "false";
var twilioAuthTokenCache = null;
var twilioAuthTokenCacheExpiry = 0;
var TWILIO_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getCachedTwilioAuthToken() {
  if (twilioAuthTokenCache && Date.now() < twilioAuthTokenCacheExpiry) {
    return twilioAuthTokenCache;
  }
  const creds = await getTwilioCredentials();
  if (!creds) {
    console.warn("Twilio credentials not found in GlobalSecrets table");
    return null;
  }
  twilioAuthTokenCache = creds.authToken;
  twilioAuthTokenCacheExpiry = Date.now() + TWILIO_CACHE_TTL_MS;
  return creds.authToken;
}
function validateTwilioSignature(authToken, signature, url, params) {
  if (process.env.SKIP_TWILIO_VALIDATION === "true") {
    return true;
  }
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  const computedSignature = import_crypto.default.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  return computedSignature === signature;
}
function parseFormBody(body) {
  const params = {};
  if (!body || body.trim() === "")
    return params;
  const pairs = body.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (key && value !== void 0) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, " "));
    }
  }
  return params;
}
function parseJsonBody(body) {
  try {
    const parsed = JSON.parse(body);
    const params = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== void 0 && value !== null) {
        params[key] = String(value);
      }
    }
    return params;
  } catch {
    return {};
  }
}
function generateTestMessageSid() {
  return `TEST_${Date.now()}_${import_crypto.default.randomBytes(8).toString("hex")}`;
}
async function markInboundIdempotency(clinicId, messageSid) {
  try {
    await ddb.send(new import_lib_dynamodb.PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `INBOUND_SID#${messageSid}`,
        clinicId,
        messageSid,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        ttl: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
        // 7 days
      },
      ConditionExpression: "attribute_not_exists(pk)"
    }));
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}
async function releaseInboundIdempotency(clinicId, messageSid) {
  try {
    await ddb.send(new import_lib_dynamodb.DeleteCommand({
      TableName: RCS_MESSAGES_TABLE,
      Key: {
        pk: `CLINIC#${clinicId}`,
        sk: `INBOUND_SID#${messageSid}`
      }
    }));
  } catch (err) {
    console.error("Failed to release inbound idempotency record (non-fatal):", err);
  }
}
var handler = async (event) => {
  console.log("RCS Incoming Message Event:", JSON.stringify(event, null, 2));
  const clinicId = event.pathParameters?.clinicId;
  if (!clinicId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing clinicId" })
    };
  }
  try {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    const contentType = event.headers["Content-Type"] || event.headers["content-type"] || "";
    let params;
    if (contentType.includes("application/json")) {
      params = parseJsonBody(rawBody);
    } else {
      params = parseFormBody(rawBody);
    }
    const twilioSignature = event.headers["X-Twilio-Signature"] || event.headers["x-twilio-signature"];
    const webhookUrl = `https://${event.headers.Host || event.headers.host}${event.path}`;
    if (twilioSignature && !contentType.includes("application/json")) {
      const twilioAuthToken = await getCachedTwilioAuthToken();
      if (twilioAuthToken) {
        const isValid = validateTwilioSignature(twilioAuthToken, twilioSignature, webhookUrl, params);
        if (!isValid) {
          console.error("Invalid Twilio signature");
          return {
            statusCode: 403,
            body: JSON.stringify({ error: "Invalid signature" })
          };
        }
      }
    }
    const messageSid = params.MessageSid || params.messageSid || generateTestMessageSid();
    const firstTime = await markInboundIdempotency(clinicId, messageSid);
    if (!firstTime) {
      console.log(`Duplicate Twilio inbound messageSid ${messageSid} for clinic ${clinicId} - ignoring`);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/xml"
        },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
      };
    }
    const message = {
      MessageSid: messageSid,
      AccountSid: params.AccountSid || params.accountSid || "TEST_ACCOUNT",
      From: params.From || params.from || "+10000000000",
      To: params.To || params.to || "+10000000001",
      Body: params.Body || params.body || "",
      NumMedia: params.NumMedia || params.numMedia,
      MediaUrl0: params.MediaUrl0 || params.mediaUrl,
      MediaContentType0: params.MediaContentType0 || params.mediaContentType,
      RcsSenderId: params.RcsSenderId || params.rcsSenderId,
      ProfileName: params.ProfileName || params.profileName,
      ApiVersion: params.ApiVersion || params.apiVersion
    };
    const timestamp = Date.now();
    const messageId = `${clinicId}#${message.MessageSid}`;
    const item = {
      pk: `CLINIC#${clinicId}`,
      sk: `MSG#${timestamp}#${message.MessageSid}`,
      messageId,
      clinicId,
      direction: "inbound",
      messageSid: message.MessageSid,
      // Always has a value now
      timestamp,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ttl: Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60,
      // 90 days TTL
      status: "received"
    };
    if (message.AccountSid)
      item.accountSid = message.AccountSid;
    if (message.From)
      item.from = message.From;
    if (message.To)
      item.to = message.To;
    if (message.Body)
      item.body = message.Body;
    if (message.NumMedia)
      item.numMedia = parseInt(message.NumMedia);
    if (message.MediaUrl0)
      item.mediaUrl = message.MediaUrl0;
    if (message.MediaContentType0)
      item.mediaContentType = message.MediaContentType0;
    if (message.RcsSenderId)
      item.rcsSenderId = message.RcsSenderId;
    if (message.ProfileName)
      item.profileName = message.ProfileName;
    try {
      await ddb.send(new import_lib_dynamodb.PutCommand({
        TableName: RCS_MESSAGES_TABLE,
        Item: item
      }));
    } catch (storeErr) {
      await releaseInboundIdempotency(clinicId, messageSid);
      throw storeErr;
    }
    console.log(`RCS message stored for clinic ${clinicId}:`, message.MessageSid);
    if (ENABLE_RCS_AUTO_REPLY && RCS_AUTO_REPLY_FUNCTION_ARN && message.Body?.trim()) {
      try {
        const payload = {
          clinicId,
          messageSid: message.MessageSid,
          from: message.From,
          to: message.To,
          body: message.Body,
          timestamp,
          profileName: message.ProfileName,
          rcsSenderId: message.RcsSenderId
        };
        await lambdaClient.send(new import_client_lambda.InvokeCommand({
          FunctionName: RCS_AUTO_REPLY_FUNCTION_ARN,
          InvocationType: "Event",
          // async
          Payload: Buffer.from(JSON.stringify(payload))
        }));
      } catch (invokeErr) {
        console.error("Failed to invoke RCS auto-reply function (non-fatal):", invokeErr);
      }
    }
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/xml"
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    };
  } catch (error) {
    console.error("Error processing RCS incoming message:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

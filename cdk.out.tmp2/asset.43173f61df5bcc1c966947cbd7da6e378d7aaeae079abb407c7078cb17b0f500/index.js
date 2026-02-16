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

// src/services/rcs/fallback-message.ts
var fallback_message_exports = {};
__export(fallback_message_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(fallback_message_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_sns = require("@aws-sdk/client-sns");
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

// src/services/rcs/fallback-message.ts
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var snsClient = new import_client_sns.SNSClient({});
var RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE;
var RCS_FALLBACK_TOPIC_ARN = process.env.RCS_FALLBACK_TOPIC_ARN;
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
  const pairs = body.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (key && value !== void 0) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, " "));
    }
  }
  return params;
}
var handler = async (event) => {
  console.log("RCS Fallback Message Event:", JSON.stringify(event, null, 2));
  const clinicId = event.pathParameters?.clinicId;
  if (!clinicId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing clinicId" })
    };
  }
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    const params = parseFormBody(body);
    const twilioSignature = event.headers["X-Twilio-Signature"] || event.headers["x-twilio-signature"];
    const webhookUrl = `https://${event.headers.Host || event.headers.host}${event.path}`;
    if (twilioSignature) {
      const twilioAuthToken = await getCachedTwilioAuthToken();
      if (twilioAuthToken) {
        const isValid = validateTwilioSignature(twilioAuthToken, twilioSignature, webhookUrl, params);
        if (!isValid) {
          console.error("Invalid Twilio signature on fallback");
          return {
            statusCode: 403,
            body: JSON.stringify({ error: "Invalid signature" })
          };
        }
      }
    }
    const message = {
      MessageSid: params.MessageSid || "",
      AccountSid: params.AccountSid || "",
      From: params.From || "",
      To: params.To || "",
      Body: params.Body || "",
      NumMedia: params.NumMedia,
      MediaUrl0: params.MediaUrl0,
      MediaContentType0: params.MediaContentType0,
      RcsSenderId: params.RcsSenderId,
      ProfileName: params.ProfileName,
      ApiVersion: params.ApiVersion,
      ErrorCode: params.ErrorCode,
      ErrorMessage: params.ErrorMessage
    };
    const timestamp = Date.now();
    const messageId = `${clinicId}#FALLBACK#${message.MessageSid}`;
    await ddb.send(new import_lib_dynamodb.PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `FALLBACK#${timestamp}#${message.MessageSid}`,
        messageId,
        clinicId,
        direction: "inbound",
        isFallback: true,
        messageSid: message.MessageSid,
        accountSid: message.AccountSid,
        from: message.From,
        to: message.To,
        body: message.Body,
        numMedia: message.NumMedia ? parseInt(message.NumMedia) : 0,
        mediaUrl: message.MediaUrl0,
        mediaContentType: message.MediaContentType0,
        rcsSenderId: message.RcsSenderId,
        profileName: message.ProfileName,
        errorCode: message.ErrorCode,
        errorMessage: message.ErrorMessage,
        status: "received_fallback",
        timestamp,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        ttl: Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60
        // 90 days TTL
      }
    }));
    console.log(`RCS fallback message stored for clinic ${clinicId}:`, message.MessageSid);
    if (message.ErrorCode || message.ErrorMessage) {
      console.error(`Primary webhook failed - Error Code: ${message.ErrorCode}, Message: ${message.ErrorMessage}`);
    }
    if (RCS_FALLBACK_TOPIC_ARN) {
      try {
        await snsClient.send(new import_client_sns.PublishCommand({
          TopicArn: RCS_FALLBACK_TOPIC_ARN,
          Message: JSON.stringify({
            eventType: "RCS_FALLBACK_RECEIVED",
            clinicId,
            messageSid: message.MessageSid,
            from: message.From,
            to: message.To,
            body: message.Body,
            errorCode: message.ErrorCode,
            errorMessage: message.ErrorMessage,
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            // Include full message for downstream processing
            rawMessage: message
          }),
          MessageAttributes: {
            eventType: {
              DataType: "String",
              StringValue: "RCS_FALLBACK_RECEIVED"
            },
            clinicId: {
              DataType: "String",
              StringValue: clinicId
            }
          }
        }));
        console.log(`Published fallback message to SNS for clinic ${clinicId}`);
      } catch (snsError) {
        console.error("Failed to publish to SNS fallback topic:", snsError);
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
    console.error("Error processing RCS fallback message:", error);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/xml"
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

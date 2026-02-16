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

// src/services/rcs/status-callback.ts
var status_callback_exports = {};
__export(status_callback_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(status_callback_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_sns = require("@aws-sdk/client-sns");
var import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");
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

// src/services/rcs/status-callback.ts
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}));
var snsClient = new import_client_sns.SNSClient({});
var cloudwatch = new import_client_cloudwatch.CloudWatchClient({});
var RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE;
var RCS_ANALYTICS_TOPIC_ARN = process.env.RCS_ANALYTICS_TOPIC_ARN || "";
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
var STATUS_PRIORITY = {
  "queued": 1,
  "sending": 2,
  "sent": 3,
  "delivered": 4,
  "read": 5,
  "failed": 10,
  "undelivered": 10
};
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
  console.log("RCS Status Callback Event:", JSON.stringify(event, null, 2));
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
          console.error("Invalid Twilio signature on status callback");
          return {
            statusCode: 403,
            body: JSON.stringify({ error: "Invalid signature" })
          };
        }
      }
    }
    const statusUpdate = {
      MessageSid: params.MessageSid || "",
      AccountSid: params.AccountSid || "",
      From: params.From || "",
      To: params.To || "",
      MessageStatus: params.MessageStatus || params.SmsStatus || "",
      ErrorCode: params.ErrorCode,
      ErrorMessage: params.ErrorMessage,
      RcsSenderId: params.RcsSenderId,
      ApiVersion: params.ApiVersion,
      SmsStatus: params.SmsStatus,
      SmsSid: params.SmsSid
    };
    const timestamp = Date.now();
    const newStatus = statusUpdate.MessageStatus.toLowerCase();
    await ddb.send(new import_lib_dynamodb.PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `STATUS#${statusUpdate.MessageSid}#${timestamp}`,
        clinicId,
        messageSid: statusUpdate.MessageSid,
        accountSid: statusUpdate.AccountSid,
        from: statusUpdate.From,
        to: statusUpdate.To,
        status: newStatus,
        errorCode: statusUpdate.ErrorCode,
        errorMessage: statusUpdate.ErrorMessage,
        rcsSenderId: statusUpdate.RcsSenderId,
        timestamp,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        ttl: Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60
        // 90 days TTL
      }
    }));
    const queryResult = await ddb.send(new import_lib_dynamodb.QueryCommand({
      TableName: RCS_MESSAGES_TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": `CLINIC#${clinicId}`,
        ":sk": `OUTBOUND#`
      },
      FilterExpression: "messageSid = :msgSid",
      ExpressionAttributeNames: void 0
    }));
    for (const item of queryResult.Items || []) {
      if (item.messageSid === statusUpdate.MessageSid) {
        const currentPriority = STATUS_PRIORITY[item.status] || 0;
        const newPriority = STATUS_PRIORITY[newStatus] || 0;
        if (newPriority > currentPriority || newPriority === 10) {
          await ddb.send(new import_lib_dynamodb.UpdateCommand({
            TableName: RCS_MESSAGES_TABLE,
            Key: {
              pk: item.pk,
              sk: item.sk
            },
            UpdateExpression: "SET #status = :status, lastStatusUpdate = :timestamp, errorCode = :errorCode, errorMessage = :errorMessage",
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: {
              ":status": newStatus,
              ":timestamp": timestamp,
              ":errorCode": statusUpdate.ErrorCode || null,
              ":errorMessage": statusUpdate.ErrorMessage || null
            }
          }));
        }
        break;
      }
    }
    console.log(`RCS status update for clinic ${clinicId}: ${statusUpdate.MessageSid} -> ${newStatus}`);
    if (newStatus === "failed" || newStatus === "undelivered") {
      console.error(`RCS message failed for clinic ${clinicId}:`, {
        messageSid: statusUpdate.MessageSid,
        errorCode: statusUpdate.ErrorCode,
        errorMessage: statusUpdate.ErrorMessage
      });
    }
    if (RCS_ANALYTICS_TOPIC_ARN) {
      try {
        await snsClient.send(new import_client_sns.PublishCommand({
          TopicArn: RCS_ANALYTICS_TOPIC_ARN,
          Message: JSON.stringify({
            eventType: "RCS_STATUS_UPDATE",
            clinicId,
            messageSid: statusUpdate.MessageSid,
            status: newStatus,
            previousStatus: null,
            // Could be enhanced to track status progression
            from: statusUpdate.From,
            to: statusUpdate.To,
            errorCode: statusUpdate.ErrorCode,
            errorMessage: statusUpdate.ErrorMessage,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          }),
          MessageAttributes: {
            eventType: {
              DataType: "String",
              StringValue: "RCS_STATUS_UPDATE"
            },
            clinicId: {
              DataType: "String",
              StringValue: clinicId
            },
            status: {
              DataType: "String",
              StringValue: newStatus
            }
          }
        }));
      } catch (snsError) {
        console.error("Failed to publish analytics event to SNS:", snsError);
      }
    }
    try {
      const dimensions = [{ Name: "ClinicId", Value: clinicId }];
      const metricData = [];
      switch (newStatus) {
        case "sent":
          metricData.push({ MetricName: "MessagesSent", Value: 1, Unit: "Count" });
          break;
        case "delivered":
          metricData.push({ MetricName: "MessagesDelivered", Value: 1, Unit: "Count" });
          break;
        case "read":
          metricData.push(
            { MetricName: "MessagesDelivered", Value: 1, Unit: "Count" },
            { MetricName: "MessagesRead", Value: 1, Unit: "Count" }
          );
          break;
        case "failed":
        case "undelivered":
          metricData.push({ MetricName: "MessagesFailed", Value: 1, Unit: "Count" });
          break;
      }
      if (metricData.length > 0) {
        await cloudwatch.send(new import_client_cloudwatch.PutMetricDataCommand({
          Namespace: "TodaysDental/RCS",
          MetricData: metricData.map((m) => ({
            MetricName: m.MetricName,
            Dimensions: dimensions,
            Value: m.Value,
            Unit: m.Unit,
            Timestamp: /* @__PURE__ */ new Date()
          }))
        }));
      }
    } catch (cwError) {
      console.error("Failed to push CloudWatch metrics:", cwError);
    }
    console.log(`RCS status update for clinic ${clinicId}: ${statusUpdate.MessageSid} -> ${newStatus}`);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error("Error processing RCS status callback:", error);
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

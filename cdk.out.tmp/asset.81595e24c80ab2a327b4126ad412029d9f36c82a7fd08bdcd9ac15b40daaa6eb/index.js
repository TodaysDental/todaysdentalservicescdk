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

// src/services/rcs/send-message.ts
var send_message_exports = {};
__export(send_message_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(send_message_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_https = __toESM(require("https"));

// src/services/shared/unsubscribe.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "todays-dental-unsubscribe-secret-key-2024";
async function isUnsubscribed(ddb2, tableName, identifier, clinicId, channel) {
  try {
    let pk;
    if (identifier.patientId) {
      pk = `PREF#${identifier.patientId}`;
    } else if (identifier.email) {
      pk = `EMAIL#${identifier.email.toLowerCase()}`;
    } else if (identifier.phone) {
      pk = `PHONE#${normalizePhone(identifier.phone)}`;
    } else {
      return false;
    }
    const clinicPref = await ddb2.send(new import_lib_dynamodb.GetCommand({
      TableName: tableName,
      Key: { pk, sk: `CLINIC#${clinicId}` }
    }));
    if (clinicPref.Item) {
      const pref = clinicPref.Item;
      if (pref.unsubscribedChannels?.includes(channel)) {
        return true;
      }
    }
    const globalPref = await ddb2.send(new import_lib_dynamodb.GetCommand({
      TableName: tableName,
      Key: { pk, sk: "GLOBAL" }
    }));
    if (globalPref.Item) {
      const pref = globalPref.Item;
      if (pref.unsubscribedChannels?.includes(channel)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error("Error checking unsubscribe status:", error);
    return false;
  }
}
function normalizePhone(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+"))
    return cleaned;
  if (cleaned.length === 10)
    return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1"))
    return `+${cleaned}`;
  return `+${cleaned}`;
}

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
async function getClinicConfig(clinicId) {
  const cached = clinicConfigCache.get(clinicId);
  if (isCacheValid(cached)) {
    return cached.value;
  }
  try {
    const response = await getDynamoClient().getItem({
      TableName: CLINIC_CONFIG_TABLE,
      Key: {
        clinicId: { S: clinicId }
      }
    });
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

// src/shared/utils/clinic-placeholders.ts
async function buildClinicPlaceholders(clinicId) {
  const clinic = await getClinicConfig(clinicId);
  if (!clinic) {
    console.warn(`[ClinicPlaceholders] No config found for clinic: ${clinicId}`);
    return {
      clinic_name: "",
      phone_number: "",
      clinic_address: "",
      clinic_url: "",
      clinic_email: "",
      maps_url: "",
      schedule_url: "",
      logo_url: "",
      fax_number: "",
      clinic_city: "",
      clinic_state: "",
      clinic_zip: ""
    };
  }
  const addressParts = [
    clinic.clinicAddress || ""
  ].filter(Boolean);
  const fullAddress = addressParts.join(", ");
  const placeholders = {
    // Primary placeholders (as requested)
    clinic_name: String(clinic.clinicName || ""),
    phone_number: String(clinic.clinicPhone || clinic.phoneNumber || ""),
    clinic_phone: String(clinic.clinicPhone || clinic.phoneNumber || ""),
    // Alias for phone_number
    clinic_address: fullAddress,
    clinic_url: String(clinic.websiteLink || ""),
    clinic_email: String(clinic.clinicEmail || ""),
    maps_url: String(clinic.mapsUrl || ""),
    // Additional useful placeholders
    schedule_url: String(clinic.scheduleUrl || ""),
    logo_url: String(clinic.logoUrl || ""),
    fax_number: String(clinic.clinicFax || ""),
    clinic_city: String(clinic.clinicCity || ""),
    clinic_state: String(clinic.clinicState || ""),
    clinic_zip: String(clinic.clinicZipCode || ""),
    // Also include original field names for backwards compatibility
    clinicName: String(clinic.clinicName || ""),
    clinicPhone: String(clinic.clinicPhone || ""),
    clinicAddress: String(clinic.clinicAddress || ""),
    clinicEmail: String(clinic.clinicEmail || ""),
    clinicCity: String(clinic.clinicCity || ""),
    clinicState: String(clinic.clinicState || ""),
    CliniczipCode: String(clinic.clinicZipCode || ""),
    clinicFax: String(clinic.clinicFax || ""),
    websiteLink: String(clinic.websiteLink || ""),
    mapsUrl: String(clinic.mapsUrl || ""),
    scheduleUrl: String(clinic.scheduleUrl || ""),
    logoUrl: String(clinic.logoUrl || ""),
    phoneNumber: String(clinic.phoneNumber || "")
  };
  return placeholders;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function renderTemplate(template, context) {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    const safeValue = String(value);
    const doubleBraceRegex = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
    const singleBraceRegex = new RegExp(`\\{${escapeRegExp(key)}\\}`, "g");
    result = result.replace(doubleBraceRegex, safeValue).replace(singleBraceRegex, safeValue);
  }
  return result;
}
async function buildTemplateContext(clinicId, additionalData) {
  const clinicContext = await buildClinicPlaceholders(clinicId);
  if (!additionalData) {
    return clinicContext;
  }
  const mergedContext = { ...clinicContext };
  for (const [key, value] of Object.entries(additionalData)) {
    if (value !== void 0 && value !== null) {
      mergedContext[key] = String(value);
    }
  }
  const fname = String(additionalData.FName || additionalData.fname || additionalData.FirstName || additionalData.firstName || additionalData.first_name || "").trim();
  const lname = String(additionalData.LName || additionalData.lname || additionalData.LastName || additionalData.lastName || additionalData.last_name || "").trim();
  if (fname || lname) {
    const fullName = [fname, lname].filter(Boolean).join(" ");
    mergedContext["patient_name"] = fullName;
    mergedContext["first_name"] = fname;
    mergedContext["last_name"] = lname;
    if (fname && !mergedContext["FName"])
      mergedContext["FName"] = fname;
    if (lname && !mergedContext["LName"])
      mergedContext["LName"] = lname;
  }
  return mergedContext;
}

// src/services/rcs/send-message.ts
var ddb = import_lib_dynamodb2.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
var RCS_MESSAGES_TABLE = process.env.RCS_MESSAGES_TABLE;
var UNSUBSCRIBE_TABLE = process.env.UNSUBSCRIBE_TABLE || "";
var CLINIC_SECRETS_TABLE2 = process.env.CLINIC_SECRETS_TABLE || "TodaysDentalInsights-ClinicSecrets";
var twilioCredentialsCache = null;
var twilioCredentialsCacheExpiry = 0;
var TWILIO_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getCachedTwilioCredentials() {
  if (twilioCredentialsCache && Date.now() < twilioCredentialsCacheExpiry) {
    return twilioCredentialsCache;
  }
  const creds = await getTwilioCredentials();
  if (!creds) {
    throw new Error("Twilio credentials not found in GlobalSecrets table");
  }
  twilioCredentialsCache = creds;
  twilioCredentialsCacheExpiry = Date.now() + TWILIO_CACHE_TTL_MS;
  return creds;
}
var rcsConfigCache = /* @__PURE__ */ new Map();
var RCS_CONFIG_CACHE_TTL_MS = 5 * 60 * 1e3;
async function getClinicRcsConfig(clinicId) {
  const cached = rcsConfigCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < RCS_CONFIG_CACHE_TTL_MS) {
    return { rcsSenderId: cached.rcsSenderId, messagingServiceSid: cached.messagingServiceSid };
  }
  try {
    const result = await ddb.send(new import_lib_dynamodb2.GetCommand({
      TableName: CLINIC_SECRETS_TABLE2,
      Key: { clinicId },
      ProjectionExpression: "rcsSenderId, messagingServiceSid"
    }));
    const config = {
      rcsSenderId: result.Item?.rcsSenderId,
      messagingServiceSid: result.Item?.messagingServiceSid
    };
    rcsConfigCache.set(clinicId, { ...config, timestamp: Date.now() });
    return config;
  } catch (error) {
    console.error(`Failed to get RCS config for clinic ${clinicId}:`, error);
    return {};
  }
}
async function renderPlaceholders(text, clinicId, patientData) {
  if (!text)
    return "";
  const context = await buildTemplateContext(clinicId, patientData);
  return renderTemplate(text, context);
}
async function renderRichCardPlaceholders(card, clinicId, patientData) {
  const [title, description] = await Promise.all([
    renderPlaceholders(card.title, clinicId, patientData),
    renderPlaceholders(card.description, clinicId, patientData)
  ]);
  let buttons = card.buttons;
  if (card.buttons) {
    buttons = await Promise.all(card.buttons.map(async (btn) => ({
      ...btn,
      label: await renderPlaceholders(btn.label, clinicId, patientData),
      value: btn.type === "url" ? await renderPlaceholders(btn.value, clinicId, patientData) : btn.value
    })));
  }
  return {
    ...card,
    title,
    description,
    buttons
  };
}
function buildRichCardPayload(card) {
  const cardPayload = {
    richCard: {
      standaloneCard: {
        cardContent: {}
      }
    }
  };
  const content = cardPayload.richCard.standaloneCard.cardContent;
  if (card.title) {
    content.title = card.title.substring(0, 200);
  }
  if (card.description) {
    content.description = card.description.substring(0, 2e3);
  }
  if (card.mediaUrl) {
    content.media = {
      height: card.mediaHeight?.toUpperCase() || "MEDIUM",
      contentInfo: {
        fileUrl: card.mediaUrl,
        forceRefresh: false
      }
    };
  }
  if (card.buttons && card.buttons.length > 0) {
    content.suggestions = card.buttons.slice(0, 4).map((btn) => {
      if (btn.type === "url") {
        return {
          action: {
            openUrlAction: {
              url: btn.value
            },
            text: btn.label.substring(0, 25)
          }
        };
      } else if (btn.type === "reply") {
        return {
          reply: {
            text: btn.label.substring(0, 25),
            postbackData: btn.value
          }
        };
      } else if (btn.type === "call") {
        return {
          action: {
            dialAction: {
              phoneNumber: btn.value
            },
            text: btn.label.substring(0, 25)
          }
        };
      } else if (btn.type === "location") {
        return {
          action: {
            viewLocationAction: {
              latLong: { latitude: 0, longitude: 0 },
              label: btn.value
            },
            text: btn.label.substring(0, 25)
          }
        };
      }
      return null;
    }).filter(Boolean);
  }
  return cardPayload;
}
function buildCarouselPayload(carousel) {
  const carouselPayload = {
    richCard: {
      carouselCard: {
        cardWidth: carousel.cardWidth?.toUpperCase() || "MEDIUM",
        cardContents: carousel.cards.slice(0, 10).map((card) => {
          const content = {};
          if (card.title) {
            content.title = card.title.substring(0, 200);
          }
          if (card.description) {
            content.description = card.description.substring(0, 2e3);
          }
          if (card.mediaUrl) {
            content.media = {
              height: card.mediaHeight?.toUpperCase() || "MEDIUM",
              contentInfo: {
                fileUrl: card.mediaUrl,
                forceRefresh: false
              }
            };
          }
          if (card.buttons && card.buttons.length > 0) {
            content.suggestions = card.buttons.slice(0, 4).map((btn) => {
              if (btn.type === "url") {
                return {
                  action: {
                    openUrlAction: { url: btn.value },
                    text: btn.label.substring(0, 25)
                  }
                };
              } else if (btn.type === "reply") {
                return {
                  reply: {
                    text: btn.label.substring(0, 25),
                    postbackData: btn.value
                  }
                };
              }
              return null;
            }).filter(Boolean);
          }
          return content;
        })
      }
    }
  };
  return carouselPayload;
}
async function sendTwilioRcsMessage(to, body, rcsSenderId, statusCallbackUrl, messagingServiceSid, mediaUrl, richCard, carousel, contentSid, contentVariables) {
  const twilioCreds = await getCachedTwilioCredentials();
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams();
    const rcsTo = to.startsWith("rcs:") ? to : `rcs:${to}`;
    data.append("To", rcsTo);
    if (messagingServiceSid) {
      data.append("MessagingServiceSid", messagingServiceSid);
    } else if (rcsSenderId) {
      const rcsFrom = rcsSenderId.startsWith("rcs:") ? rcsSenderId : `rcs:${rcsSenderId}`;
      data.append("From", rcsFrom);
    }
    if (statusCallbackUrl) {
      data.append("StatusCallback", statusCallbackUrl);
    }
    if (contentSid) {
      data.append("ContentSid", contentSid);
      if (contentVariables) {
        data.append("ContentVariables", JSON.stringify(contentVariables));
      }
    } else if (richCard) {
      const payload = buildRichCardPayload(richCard);
      data.append("Body", body || richCard.title || richCard.description || "");
      if (richCard.mediaUrl) {
        data.append("MediaUrl", richCard.mediaUrl);
      }
      data.append("Attributes", JSON.stringify({ richCard: payload }));
    } else if (carousel) {
      const payload = buildCarouselPayload(carousel);
      data.append("Body", body || "View options");
      data.append("Attributes", JSON.stringify({ carousel: payload }));
    } else {
      data.append("Body", body);
      if (mediaUrl) {
        data.append("MediaUrl", mediaUrl);
      }
    }
    const postData = data.toString();
    const options = {
      hostname: "api.twilio.com",
      port: 443,
      path: `/2010-04-01/Accounts/${twilioCreds.accountSid}/Messages.json`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "Authorization": "Basic " + Buffer.from(`${twilioCreds.accountSid}:${twilioCreds.authToken}`).toString("base64")
      }
    };
    const req = import_https.default.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        try {
          const response = JSON.parse(responseBody);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
          } else {
            reject(new Error(`Twilio API error: ${response.message || responseBody}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Twilio response: ${responseBody}`));
        }
      });
    });
    req.on("error", (e) => {
      reject(e);
    });
    req.write(postData);
    req.end();
  });
}
var handler = async (event) => {
  console.log("RCS Send Message Event:", JSON.stringify(event, null, 2));
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  try {
    const requestBody = JSON.parse(event.body || "{}");
    const {
      clinicId,
      to,
      body: messageBody,
      mediaUrl,
      rcsSenderId,
      messagingServiceSid,
      patientId,
      skipUnsubscribeCheck,
      richCard,
      carousel,
      contentSid,
      contentVariables,
      patientData,
      templateId,
      templateName,
      campaignId,
      campaignName,
      aiAgentId,
      aiAgentName,
      aiSessionId,
      inReplyToSid
    } = requestBody;
    const hasContent = messageBody || richCard || carousel || contentSid;
    if (!clinicId || !to || !hasContent) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Missing required fields: clinicId, to, and (body OR richCard OR carousel OR contentSid)"
        })
      };
    }
    if (!skipUnsubscribeCheck && UNSUBSCRIBE_TABLE) {
      const rcsUnsubscribed = await isUnsubscribed(
        ddb,
        UNSUBSCRIBE_TABLE,
        { patientId, phone: to },
        clinicId,
        "RCS"
      );
      if (rcsUnsubscribed) {
        console.log(`Skipping RCS message for ${to} - unsubscribed`);
        const timestamp2 = Date.now();
        await ddb.send(new import_lib_dynamodb2.PutCommand({
          TableName: RCS_MESSAGES_TABLE,
          Item: {
            pk: `CLINIC#${clinicId}`,
            sk: `OUTBOUND#${timestamp2}#SKIPPED`,
            clinicId,
            direction: "outbound",
            to,
            body: messageBody,
            richCard,
            carousel,
            status: "SKIPPED_UNSUBSCRIBED",
            timestamp: timestamp2,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            ttl: Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60
          }
        }));
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            skipped: true,
            reason: "unsubscribed",
            message: "Recipient has unsubscribed from RCS messages"
          })
        };
      }
    }
    const statusCallbackUrl = `https://apig.todaysdentalinsights.com/rcs/${clinicId}/status`;
    let effectiveRcsSenderId = rcsSenderId || process.env[`RCS_SENDER_${clinicId.toUpperCase()}`] || "";
    let effectiveMessagingServiceSid = messagingServiceSid || "";
    if (!effectiveRcsSenderId && !effectiveMessagingServiceSid) {
      const clinicRcsConfig = await getClinicRcsConfig(clinicId);
      effectiveRcsSenderId = clinicRcsConfig.rcsSenderId || "";
      effectiveMessagingServiceSid = clinicRcsConfig.messagingServiceSid || "";
    }
    if (!effectiveRcsSenderId && !effectiveMessagingServiceSid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "No RCS sender ID or Messaging Service SID configured for this clinic"
        })
      };
    }
    const renderedBody = await renderPlaceholders(messageBody, clinicId, patientData);
    let renderedRichCard;
    if (richCard) {
      renderedRichCard = await renderRichCardPlaceholders(richCard, clinicId, patientData);
    }
    let renderedCarousel;
    if (carousel) {
      const renderedCards = await Promise.all(
        carousel.cards.map((card) => renderRichCardPlaceholders(card, clinicId, patientData))
      );
      renderedCarousel = {
        ...carousel,
        cards: renderedCards
      };
    }
    const twilioResponse = await sendTwilioRcsMessage(
      to,
      renderedBody,
      effectiveRcsSenderId,
      statusCallbackUrl,
      effectiveMessagingServiceSid || void 0,
      mediaUrl,
      renderedRichCard,
      renderedCarousel,
      contentSid,
      contentVariables
    );
    const timestamp = Date.now();
    let messageType = "text";
    if (contentSid)
      messageType = "template";
    else if (renderedCarousel)
      messageType = "carousel";
    else if (renderedRichCard)
      messageType = "richCard";
    else if (mediaUrl)
      messageType = "media";
    await ddb.send(new import_lib_dynamodb2.PutCommand({
      TableName: RCS_MESSAGES_TABLE,
      Item: {
        pk: `CLINIC#${clinicId}`,
        sk: `OUTBOUND#${timestamp}#${twilioResponse.sid}`,
        messageId: `${clinicId}#${twilioResponse.sid}`,
        clinicId,
        direction: "outbound",
        messageSid: twilioResponse.sid,
        to,
        body: renderedBody,
        mediaUrl,
        richCard: renderedRichCard,
        carousel: renderedCarousel,
        contentSid,
        messageType,
        rcsSenderId: effectiveRcsSenderId,
        messagingServiceSid,
        status: twilioResponse.status || "queued",
        timestamp,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        ttl: Math.floor(Date.now() / 1e3) + 90 * 24 * 60 * 60,
        // 90 days TTL
        // Analytics tracking fields
        templateId: templateId || contentSid || void 0,
        templateName: templateName || void 0,
        campaignId: campaignId || void 0,
        campaignName: campaignName || void 0,
        // AI metadata (optional)
        aiAgentId: aiAgentId || void 0,
        aiAgentName: aiAgentName || void 0,
        aiSessionId: aiSessionId || void 0,
        inReplyToSid: inReplyToSid || void 0,
        // Date fields for efficient analytics queries
        dateKey: new Date(timestamp).toISOString().split("T")[0],
        // YYYY-MM-DD for daily aggregation
        hourKey: new Date(timestamp).getUTCHours()
        // 0-23 for hourly distribution
      }
    }));
    console.log(`RCS ${messageType} message sent for clinic ${clinicId}:`, twilioResponse.sid);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        messageSid: twilioResponse.sid,
        status: twilioResponse.status,
        messageType
      })
    };
  } catch (error) {
    console.error("Error sending RCS message:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to send RCS message",
        message: error instanceof Error ? error.message : "Unknown error"
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

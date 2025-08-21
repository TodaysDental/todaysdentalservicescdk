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

// analytics/postCallClassifier.ts
var postCallClassifier_exports = {};
__export(postCallClassifier_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(postCallClassifier_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// analytics/keywords.json
var keywords_default = {
  opportunity: ["book", "schedule", "appointment", "new patient", "proceed", "accept", "start treatment", "consult"],
  not_opportunity: ["no", "not interested", "decline", "cancel", "wrong number", "spam", "do not call", "remove me"],
  neutral: ["information", "hours", "location", "address", "email", "website", "general question"],
  marketing: ["ad", "promotion", "offer", "seo", "campaign", "google", "facebook", "lead"],
  insurance: ["insurance", "coverage", "benefits", "deductible", "claim", "copay", "payer", "policy"],
  billing: ["bill", "invoice", "payment", "refund", "balance", "statement", "charge"],
  appointment: ["appointment", "schedule", "reschedule", "cancel", "time", "date", "slot", "availability"]
};

// analytics/postCallClassifier.ts
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var TABLE = process.env.POSTCALL_TABLE || "PostCallInsights";
var CONNECT_INSTANCE_ARN = process.env.CONNECT_INSTANCE_ARN || "";
var connectClient = new import_client_connect.ConnectClient({});
var s3 = new import_client_s3.S3Client({});
var RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET || "";
var RECORDINGS_PREFIX = process.env.RECORDINGS_PREFIX || "";
var RECORDING_URL_TTL_SECONDS = parseInt(process.env.RECORDING_URL_TTL_SECONDS || "86400", 10);
var CLINIC_QUEUE_ARN_MAP_JSON = process.env.CLINIC_QUEUE_ARN_MAP || "{}";
var CLINIC_QUEUE_ARN_MAP = safeParseJson(CLINIC_QUEUE_ARN_MAP_JSON) || {};
var handler = async (event) => {
  const detail = event.detail;
  const contactId = detail.ContactId;
  const transcript = (detail.Transcripts || []).map((t) => t.Content).join(" ").toLowerCase();
  const sentiment = (detail.Sentiment?.OverallSentiment || "").toLowerCase();
  const attrs = detail.Attributes || {};
  const { agentId, agentUsername, customerNumber } = await resolveAgentAndNumber(detail).catch(() => ({ agentId: void 0, agentUsername: void 0, customerNumber: void 0 }));
  const category = classifyCategory(transcript);
  const callType = classifyType(transcript);
  const score = scoreOpportunity(transcript, sentiment);
  const recording = await tryResolveRecording(detail).catch(() => void 0);
  const clinicId = resolveClinicId(detail);
  await ddb.send(new import_lib_dynamodb.PutCommand({
    TableName: TABLE,
    Item: {
      contactId,
      ts: Date.now(),
      category,
      callType,
      score,
      sentiment,
      queueArn: detail.QueueInfo?.QueueArn || null,
      attributes: attrs,
      agentId: agentId || null,
      agentUsername: agentUsername || null,
      customerNumber: customerNumber || null,
      clinicId: clinicId || null,
      recording: recording || null
    }
  }));
  return { ok: true };
};
function classifyCategory(text) {
  if (hasAny(text, keywords_default.opportunity)) return "opportunity";
  if (hasAny(text, keywords_default.not_opportunity)) return "not_opportunity";
  if (hasAny(text, keywords_default.neutral)) return "neutral";
  return "scored";
}
async function resolveAgentAndNumber(detail) {
  const fromDetail = {
    agentId: detail?.AgentInfo?.AgentId || void 0,
    agentUsername: detail?.AgentInfo?.Username || detail?.AgentInfo?.UserName || void 0,
    customerNumber: detail?.CustomerEndpoint?.Address || detail?.Attributes?.DestinationPhoneNumber || detail?.Attributes?.CustomerNumber || void 0
  };
  if (fromDetail.agentId && fromDetail.customerNumber) return fromDetail;
  if (!CONNECT_INSTANCE_ARN) return fromDetail;
  const instanceId = arnTail(CONNECT_INSTANCE_ARN);
  try {
    const resp = await connectClient.send(new import_client_connect.DescribeContactCommand({ InstanceId: instanceId, ContactId: detail.ContactId }));
    const contact = resp?.Contact;
    const agentInfo = contact?.AgentInfo || {};
    const customerEndpoint = contact?.CustomerEndpoint || {};
    fromDetail.agentId = fromDetail.agentId || agentInfo.AgentId || agentInfo.Id;
    fromDetail.agentUsername = fromDetail.agentUsername || agentInfo.Username || agentInfo.UserName;
    fromDetail.customerNumber = fromDetail.customerNumber || customerEndpoint.Address;
  } catch {
  }
  try {
    const attrsResp = await connectClient.send(new import_client_connect.GetContactAttributesCommand({ InstanceId: instanceId, InitialContactId: detail.ContactId }));
    const a = attrsResp?.Attributes || {};
    fromDetail.customerNumber = fromDetail.customerNumber || a.DestinationPhoneNumber || a.CustomerNumber || a.CustomerPhone;
    fromDetail.agentUsername = fromDetail.agentUsername || a.AgentUsername || a.AgentEmail;
  } catch {
  }
  return fromDetail;
}
function arnTail(arn) {
  const parts = String(arn).split("/");
  return parts[parts.length - 1] || arn;
}
async function tryResolveRecording(detail) {
  if (!RECORDINGS_BUCKET) return void 0;
  const contactId = detail?.ContactId;
  if (!contactId) return void 0;
  const instanceId = CONNECT_INSTANCE_ARN ? arnTail(CONNECT_INSTANCE_ARN) : void 0;
  const candidateKeys = /* @__PURE__ */ new Set();
  if (RECORDINGS_PREFIX) {
    const base = RECORDINGS_PREFIX.replaceAll("{contactId}", contactId).replaceAll("{instanceId}", String(instanceId || "")).replaceAll("{CONTACT_ID}", contactId).replaceAll("{INSTANCE_ID}", String(instanceId || ""));
    candidateKeys.add(base);
    candidateKeys.add(base.endsWith(".wav") || base.endsWith(".mp3") ? base : `${base}.wav`);
    candidateKeys.add(base.endsWith(".wav") || base.endsWith(".mp3") ? base : `${base}.mp3`);
  }
  candidateKeys.add(`connect/${contactId}.wav`);
  candidateKeys.add(`connect/${contactId}.mp3`);
  candidateKeys.add(`recordings/${contactId}.wav`);
  candidateKeys.add(`recordings/${contactId}.mp3`);
  candidateKeys.add(`${contactId}.wav`);
  candidateKeys.add(`${contactId}.mp3`);
  for (const key of candidateKeys) {
    try {
      await s3.send(new import_client_s3.HeadObjectCommand({ Bucket: RECORDINGS_BUCKET, Key: key }));
      const url = await (0, import_s3_request_presigner.getSignedUrl)(s3, new import_client_s3.GetObjectCommand({ Bucket: RECORDINGS_BUCKET, Key: key }), { expiresIn: RECORDING_URL_TTL_SECONDS });
      return { bucket: RECORDINGS_BUCKET, key, url };
    } catch {
    }
  }
  return void 0;
}
function resolveClinicId(detail) {
  const attrClinic = detail?.Attributes?.clinicId || detail?.Attributes?.ClinicId || detail?.Attributes?.CLINIC_ID;
  if (attrClinic) return String(attrClinic);
  const queueArn = detail?.QueueInfo?.QueueArn;
  if (!queueArn) return void 0;
  for (const [cid, arn] of Object.entries(CLINIC_QUEUE_ARN_MAP)) {
    if (String(arn) === String(queueArn)) return cid;
  }
  return void 0;
}
function safeParseJson(s) {
  if (!s) return void 0;
  try {
    return JSON.parse(s);
  } catch {
    return void 0;
  }
}
function classifyType(text) {
  if (hasAny(text, keywords_default.marketing)) return "marketing";
  if (hasAny(text, keywords_default.insurance)) return "insurance";
  if (hasAny(text, keywords_default.billing)) return "billing";
  if (hasAny(text, keywords_default.appointment)) return "appointment";
  return "unknown";
}
function hasAny(text, arr = []) {
  return arr.some((k) => text.includes(String(k).toLowerCase()));
}
function scoreOpportunity(text, sentiment) {
  let score = 0;
  if (sentiment === "positive") score += 2;
  if (sentiment === "negative") score -= 2;
  if (hasAny(text, keywords_default.opportunity)) score += 3;
  if (hasAny(text, keywords_default.not_opportunity)) score -= 3;
  if (hasAny(text, keywords_default.appointment)) score += 2;
  return Math.max(0, Math.min(10, score + 5));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

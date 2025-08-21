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

// notifications-api/notify.ts
var notify_exports = {};
__export(notify_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(notify_exports);
var import_https = __toESM(require("https"));
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// utils/cors.ts
var DEFAULT_ORIGIN = process.env.CORS_ORIGIN || "https://todaysdentalinsights.com";
var DEFAULT_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
var DEFAULT_HEADERS = ["Content-Type", "Authorization"];
function buildCorsHeaders(options = {}) {
  const allowOrigin = options.allowOrigin || DEFAULT_ORIGIN;
  const allowMethods = (options.allowMethods || DEFAULT_METHODS).join(", ");
  const uniqueHeaders = Array.from(/* @__PURE__ */ new Set([...options.allowHeaders || [], ...DEFAULT_HEADERS]));
  const allowHeaders = uniqueHeaders.join(", ");
  const headers = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": allowMethods,
    "Access-Control-Allow-Headers": allowHeaders
  };
  const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
  if (maxAgeSeconds > 0) headers["Access-Control-Max-Age"] = String(maxAgeSeconds);
  return headers;
}

// clinic-config/clinics.json
var clinics_default = [
  {
    clinicId: "dentistinnewbritain",
    clinicAddress: "446 S Main St, New Britain CT 06051-3516, USA",
    clinicCity: "New Britain",
    clinicEmail: "dentalcare@dentistinnewbritain.com",
    clinicFax: "(860) 770-6774",
    clinicName: "Dentist in New Britain",
    CliniczipCode: "29607",
    clinicPhone: "860-259-4141",
    clinicState: "Connecticut",
    logoUrl: "https://dentistinnewbritain.com/src/images/logo.png",
    mapsUrl: "https://maps.app.goo.gl/1wKzE8B2jbxQJaHB8",
    scheduleUrl: "https://dentistinnewbritain.com/patient-portal",
    websiteLink: "https://dentistinnewbritain.com",
    developerKey: "OkDBoT0iEb6O80Cy",
    customerKey: "rBcAexBfyBuvwpP7",
    connectPhoneNumberArn: "arn:aws:connect:us-east-1:851620242036:phone-number/2f2d6d39-5d13-4bde-9b6e-2f8f4b29363f",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinnewbritain.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-883b1b0750ee43e694c93e0a7f52340a"
  },
  {
    clinicId: "dentistingreenville",
    clinicAddress: "4 Market Point Drive Suite E, Greenville SC 29607",
    clinicCity: "Greenville",
    clinicEmail: "dentalcare@dentistingreenville.com",
    clinicFax: "864-284-0066",
    clinicName: "Dentist in Greenville",
    clinicPhone: "864-284-0066",
    clinicState: "South Carolina",
    CliniczipCode: "06051-3516",
    logoUrl: "https://dentistingreenville.com/src/images/logo.png",
    mapsUrl: "https://maps.app.goo.gl/TP79MgS1EcycndPy8",
    scheduleUrl: "https://dentistinnewbritain.com/patient-portal",
    websiteLink: "https://dentistingreenville.com",
    developerKey: "OkDBoT0iEb6O80Cy",
    customerKey: "6NSvxIK5kBLODZzt",
    connectPhoneNumberArn: "arn:aws:connect:us-east-1:851620242036:phone-number/3d570f0b-ea2f-4f1e-a451-a3afcde5516b",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistingreenville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b7576e8cf26a4fd49b8a221fea062922"
  }
];

// notifications-api/notify.ts
var import_client_sesv2 = require("@aws-sdk/client-sesv2");
var { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require("@aws-sdk/client-pinpoint-sms-voice-v2");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var ses = new import_client_sesv2.SESv2Client({});
var sms = new PinpointSMSVoiceV2Client({});
var TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || "Templates";
var CLINIC_CREDS = (() => {
  const raw = process.env.OPEN_DENTAL_CLINIC_CREDS || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
})();
var CLINIC_SES_IDENTITY_ARN_MAP = (() => {
  const raw = process.env.CLINIC_SES_IDENTITY_ARN_MAP || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
})();
var CLINIC_SMS_ORIGINATION_ARN_MAP = (() => {
  const raw = process.env.CLINIC_SMS_ORIGINATION_ARN_MAP || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
})();
var corsHeaders = buildCorsHeaders();
function http(code, body) {
  return { statusCode: code, headers: corsHeaders, body: JSON.stringify(body) };
}
function parseBody(body) {
  try {
    return typeof body === "string" ? JSON.parse(body) : body || {};
  } catch {
    return {};
  }
}
function getGroupsFromClaims(claims) {
  if (!claims) return [];
  const raw = claims["cognito:groups"] ?? claims["cognito:groups[]"];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function isGlobalSuperAdmin(groups) {
  return groups.includes("GLOBAL__SUPER_ADMIN");
}
var handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return http(200, { ok: true });
  if (event.httpMethod !== "POST") return http(405, { error: "Method Not Allowed" });
  const pathClinicId = event.pathParameters?.clinicId || "";
  if (!pathClinicId) return http(400, { error: "Missing clinicId in path" });
  const groups = getGroupsFromClaims(event.requestContext?.authorizer?.claims);
  const isMemberOfClinic = groups.some((g) => g.startsWith(`clinic_${pathClinicId}__`));
  if (!isGlobalSuperAdmin(groups) && !isMemberOfClinic) return http(403, { error: "Forbidden" });
  const body = parseBody(event.body);
  const query = event.queryStringParameters || {};
  const clinicId = pathClinicId;
  const patNum = String(body.PatNum || (event.queryStringParameters || {}).PatNum || "").trim();
  const templateName = String(body.templateMessage || body.template_name || "").trim();
  const notificationTypes = Array.isArray(body.notificationTypes) ? body.notificationTypes : [];
  const fname = String(body.FName || "").trim();
  const lname = String(body.LName || "").trim();
  const sentBy = String(body.sent_by || "system");
  const customEmailSubjectRaw = String(body.customEmailSubject || body.emailSubject || "").trim();
  const customEmailHtmlRaw = String(body.customEmailHtml || body.emailBodyHtml || body.email_body || "").trim();
  const customEmailTextRaw = String(body.customEmailText || body.emailBodyText || "").trim();
  const customSmsTextRaw = String(body.customSmsText || body.textMessage || "").trim();
  const overrideEmailRaw = String(body.toEmail || body.email || body.to || query.email || "").trim();
  const overridePhoneRaw = String(
    body.toPhone || body.phone || body.phoneNumber || body.sms || body.SMS || query.phone || query.sms || ""
  ).trim();
  if (!patNum || notificationTypes.length === 0) {
    return http(400, { error: "PatNum and notificationTypes are required" });
  }
  let template = null;
  if (templateName) {
    template = await fetchTemplateByName(templateName);
    if (!template && !customEmailHtmlRaw && !customSmsTextRaw && !customEmailSubjectRaw && !customEmailTextRaw) {
      return http(400, { error: `Template not found: ${templateName}` });
    }
  }
  const contact = await fetchPatientContact(clinicId, patNum);
  if (!contact.email && !contact.phone) {
    return http(400, { error: "No email or phone found for patient" });
  }
  const results = { email: null, sms: null };
  const clinicCtx = buildClinicContext(clinicId);
  const mergedCtx = { ...clinicCtx, FName: fname, LName: lname };
  if (notificationTypes.includes("EMAIL")) {
    const toEmail = (overrideEmailRaw || contact.email || "").trim();
    if (!toEmail || !toEmail.includes("@")) return http(400, { error: "No email found for patient" });
    const subjectStr = renderTemplateString(customEmailSubjectRaw || String(template?.email_subject || "Notification"), mergedCtx);
    const htmlStr = renderTemplateString(customEmailHtmlRaw || String(template?.email_body || ""), mergedCtx);
    const textAltStr = renderTemplateString(customEmailTextRaw || (htmlStr ? htmlStr.replace(/<[^>]+>/g, " ") : ""), mergedCtx);
    if (!htmlStr && !textAltStr) return http(400, { error: "No email content provided (template or custom)" });
    await sendEmail({ clinicId, to: toEmail, subject: subjectStr, html: htmlStr, text: textAltStr });
    results.email = toEmail;
  }
  if (notificationTypes.includes("SMS")) {
    const toPhoneRaw = (overridePhoneRaw || contact.phone || "").trim();
    const toPhone = normalizePhone(toPhoneRaw);
    if (!toPhone) return http(400, { error: "No phone found for patient" });
    const smsBody = renderTemplateString(customSmsTextRaw || String(template?.text_message || ""), mergedCtx);
    if (!smsBody) return http(400, { error: "No SMS content provided (template or custom)" });
    await sendSms({ clinicId, to: toPhone, body: smsBody });
    results.sms = toPhone;
  }
  return http(200, { success: true, sent: results, clinicId, patNum, template: templateName, sent_by: sentBy });
};
async function fetchTemplateByName(templateName) {
  const res = await ddb.send(new import_lib_dynamodb.ScanCommand({ TableName: TEMPLATES_TABLE }));
  const items = res.Items || [];
  return items.find((t) => String(t.template_name).toLowerCase() === String(templateName).toLowerCase()) || null;
}
function buildClinicContext(clinicId) {
  const clinic = clinics_default.find((c) => String(c.clinicId) === String(clinicId)) || {};
  const ctx = {};
  for (const [k, v] of Object.entries(clinic)) {
    if (v === void 0 || v === null) continue;
    ctx[String(k)] = String(v);
  }
  return ctx;
}
function renderTemplateString(tpl, ctx) {
  let out = tpl;
  for (const [key, value] of Object.entries(ctx)) {
    const safe = String(value);
    const re1 = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
    const re2 = new RegExp(`\\{${escapeRegExp(key)}\\}`, "g");
    out = out.replace(re1, safe).replace(re2, safe);
  }
  return out;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}
async function fetchPatientContact(clinicId, patNum) {
  const creds = CLINIC_CREDS[clinicId];
  if (!creds) return {};
  const API_HOST = "api.opendental.com";
  const API_BASE = "/api/v1";
  const path = `${API_BASE}/patients/Simple?PatNum=${encodeURIComponent(patNum)}`;
  const headers = { Authorization: `ODFHIR ${creds.developerKey}/${creds.customerKey}`, "Content-Type": "application/json" };
  const resp = await httpRequest({ hostname: API_HOST, path, method: "GET", headers });
  let body;
  try {
    body = JSON.parse(resp.body);
  } catch {
    body = resp.body;
  }
  let row;
  if (Array.isArray(body)) {
    row = body.find((r) => String(r?.PatNum ?? r?.patNum ?? "") === String(patNum)) || body[0] || {};
  } else {
    row = body || {};
  }
  return extractEmailAndPhone(row);
}
async function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = import_https.default.request({ hostname: opts.hostname, path: opts.path, method: opts.method, headers: opts.headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function extractEmailAndPhone(row) {
  const preferredEmailFields = [
    "Email",
    "email",
    "EmailAddress",
    "emailAddress",
    "PatientEmail",
    "patientEmail"
  ];
  const preferredPhoneFields = [
    "WirelessPhone",
    "CellPhone",
    "MobilePhone",
    "Mobile",
    "Cell",
    "HmPhone",
    "HomePhone",
    "WkPhone",
    "WorkPhone",
    "Phone"
  ];
  let email;
  for (const field of preferredEmailFields) {
    const value = row?.[field];
    const str = String(value || "").trim();
    if (str && /@/.test(str)) {
      email = str;
      break;
    }
  }
  let phone;
  for (const field of preferredPhoneFields) {
    const value = row?.[field];
    const normalized = normalizePhone(String(value || ""));
    if (normalized) {
      phone = normalized;
      break;
    }
  }
  if (!email) {
    for (const [k, v] of Object.entries(row || {})) {
      const key = String(k).toLowerCase();
      if (key.includes("clinic") || key.includes("practice")) continue;
      if (!/email/.test(key)) continue;
      const val = String(v || "").trim();
      if (/@/.test(val)) {
        email = val;
        break;
      }
    }
  }
  if (!phone) {
    for (const [k, v] of Object.entries(row || {})) {
      const key = String(k).toLowerCase();
      if (!/(wireless|mobile|cell|phone|hmphone|wkphone|home|work)/.test(key)) continue;
      const normalized = normalizePhone(String(v || ""));
      if (normalized) {
        phone = normalized;
        break;
      }
    }
  }
  return { email, phone };
}
function normalizePhone(p) {
  const digits = (p || "").replace(/[^\d\+]/g, "");
  if (digits.startsWith("+")) return digits;
  const only = digits.replace(/\D/g, "");
  if (only.length === 10) return `+1${only}`;
  if (only.length === 11 && only.startsWith("1")) return `+${only}`;
  return void 0;
}
async function sendEmail({ clinicId, to, subject, html, text }) {
  const identityArn = CLINIC_SES_IDENTITY_ARN_MAP[clinicId];
  if (!identityArn) return;
  const fromDomain = identityArn.split(":identity/")[1] || "todaysdentalinsights.com";
  const from = `no-reply@${fromDomain}`;
  const cmd = new import_client_sesv2.SendEmailCommand({
    FromEmailAddress: from,
    FromEmailAddressIdentityArn: identityArn,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html }, Text: { Data: text || html.replace(/<[^>]+>/g, " ") } } } }
  });
  await ses.send(cmd);
}
async function sendSms({ clinicId, to, body }) {
  const originationArn = CLINIC_SMS_ORIGINATION_ARN_MAP[clinicId];
  if (!originationArn) return;
  const cmd = new SendTextMessageCommand({
    DestinationPhoneNumber: to,
    MessageBody: body,
    OriginationIdentity: originationArn,
    MessageType: "TRANSACTIONAL"
  });
  await sms.send(cmd);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

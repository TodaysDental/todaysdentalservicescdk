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

// schedules-api/schedules.ts
var schedules_exports = {};
__export(schedules_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(schedules_exports);
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

// schedules-api/schedules.ts
var import_crypto = require("crypto");
var ddbClient = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(ddbClient);
var TABLE_NAME = process.env.SCHEDULER || process.env.TABLE_NAME || "SCHEDULER";
var corsHeaders = buildCorsHeaders({ allowHeaders: ["x-api-key"] });
var getGroupsFromClaims = (claims) => {
  if (!claims) return [];
  const raw = claims["cognito:groups"] ?? claims["cognito:groups[]"];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]") || trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
      }
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
};
var isWriteAuthorized = (groups) => {
  if (!groups || groups.length === 0) return false;
  return groups.some((g) => g === "GLOBAL__SUPER_ADMIN");
};
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var computeScheduleTime = (frequency, time) => {
  const freq = String(frequency || "").trim();
  const t = String(time || "").trim();
  if (!freq && !t) return "";
  if (!freq) return t;
  if (!t) return freq;
  return `${freq} @ ${t}`;
};
var safeParseJson = (str) => {
  try {
    return typeof str === "string" ? JSON.parse(str) : str ?? {};
  } catch {
    return {};
  }
};
var normalizeSchedulePayload = (payload, { isCreate = false } = {}) => {
  const input = payload || {};
  const id = isCreate ? input.id || (0, import_crypto.randomUUID)() : input.id;
  let normalizedClinicIds = [];
  if (Array.isArray(input.clinicIds)) {
    normalizedClinicIds = input.clinicIds;
  } else if (typeof input.clinicIds === "string" && input.clinicIds.trim() !== "") {
    const s = input.clinicIds.trim();
    if (s.startsWith("[")) {
      try {
        normalizedClinicIds = JSON.parse(s);
      } catch {
        normalizedClinicIds = [];
      }
    } else {
      normalizedClinicIds = s.split(",").map((x) => x.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(normalizedClinicIds) || normalizedClinicIds.length === 0) {
    if (input.clinicId) normalizedClinicIds = [input.clinicId];
  }
  const schedule = {
    id,
    clinicId: input.clinicId ?? input.clinic_id ?? (normalizedClinicIds[0] || ""),
    clinicIds: normalizedClinicIds,
    name: input.name ?? input.scheduleName ?? "",
    date: input.date ?? "",
    startDate: input.startDate ?? input.start_date ?? "",
    endDate: input.endDate ?? input.end_date ?? "",
    frequency: input.frequency ?? "daily",
    time: input.time ?? "",
    queryTemplate: input.queryTemplate ?? input.query_template ?? "",
    templateMessage: input.templateMessage ?? input.template_message ?? input.template_name ?? "",
    notificationTypes: Array.isArray(input.notificationTypes) ? input.notificationTypes : []
  };
  schedule.schedule_time = input.schedule_time || computeScheduleTime(schedule.frequency, schedule.time);
  schedule.created_at = input.created_at || (isCreate ? nowIso() : input.created_at);
  schedule.modified_at = nowIso();
  schedule.modified_by = input.modified_by || "system";
  return schedule;
};
var handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }
  const path = event.resource || event.path || "";
  const method = event.httpMethod || "GET";
  const groups = getGroupsFromClaims(event.requestContext?.authorizer?.claims);
  const wantsWrite = method === "POST" || method === "PUT" || method === "DELETE";
  if (wantsWrite && !isWriteAuthorized(groups)) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "Forbidden" }) };
  }
  try {
    if (path === "/schedules" && method === "GET") {
      return await handleList();
    }
    if (path === "/schedules/{id}") {
      const id = event.pathParameters?.id;
      if (method === "GET") return await handleGet(id);
      if (method === "PUT") return await handleUpdate(id, event.body || "");
      if (method === "DELETE") return await handleDelete(id);
    }
    if (path === "/create-scheduler" && method === "POST") {
      return await handleCreate(event.body || "");
    }
    if (path === "/delete-schedules" && method === "POST") {
      return await handleBatchDelete(event.body || "");
    }
    if (path === "/schedules" && method === "POST") {
      return await handleCreate(event.body || "");
    }
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: "Not Found" }) };
  } catch (err) {
    const message = err?.message || "Internal Server Error";
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message }) };
  }
};
async function handleList() {
  const result = await docClient.send(new import_lib_dynamodb.ScanCommand({ TableName: TABLE_NAME }));
  const items = result.Items || [];
  items.sort((a, b) => String(b.modified_at || "").localeCompare(String(a.modified_at || "")));
  return json(200, { schedules: items });
}
async function handleGet(id) {
  if (!id) return json(400, { message: "Missing id" });
  const result = await docClient.send(new import_lib_dynamodb.GetCommand({ TableName: TABLE_NAME, Key: { id } }));
  if (!result.Item) return json(404, { message: "Not found" });
  return json(200, { schedule: result.Item });
}
async function handleCreate(body) {
  const payload = safeParseJson(body);
  const schedule = normalizeSchedulePayload(payload, { isCreate: true });
  await docClient.send(new import_lib_dynamodb.PutCommand({ TableName: TABLE_NAME, Item: schedule }));
  return json(201, { schedule });
}
async function handleUpdate(id, body) {
  if (!id) return json(400, { message: "Missing id" });
  const payload = safeParseJson(body);
  const normalized = normalizeSchedulePayload({ ...payload, id }, { isCreate: false });
  const updateExpr = [
    "#clinicId = :clinicId",
    "#clinicIds = :clinicIds",
    "#name = :name",
    "#date = :date",
    "#startDate = :startDate",
    "#endDate = :endDate",
    "#frequency = :frequency",
    "#time = :time",
    "#schedule_time = :schedule_time",
    "#queryTemplate = :queryTemplate",
    "#templateMessage = :templateMessage",
    "#notificationTypes = :notificationTypes",
    "#modified_at = :modified_at",
    "#modified_by = :modified_by"
  ].join(", ");
  const cmd = new import_lib_dynamodb.UpdateCommand({
    TableName: TABLE_NAME,
    Key: { id },
    UpdateExpression: `SET ${updateExpr}`,
    ExpressionAttributeNames: {
      "#clinicId": "clinicId",
      "#clinicIds": "clinicIds",
      "#name": "name",
      "#date": "date",
      "#startDate": "startDate",
      "#endDate": "endDate",
      "#frequency": "frequency",
      "#time": "time",
      "#schedule_time": "schedule_time",
      "#queryTemplate": "queryTemplate",
      "#templateMessage": "templateMessage",
      "#notificationTypes": "notificationTypes",
      "#modified_at": "modified_at",
      "#modified_by": "modified_by"
    },
    ExpressionAttributeValues: {
      ":clinicId": normalized.clinicId,
      ":clinicIds": normalized.clinicIds,
      ":name": normalized.name,
      ":date": normalized.date,
      ":startDate": normalized.startDate,
      ":endDate": normalized.endDate,
      ":frequency": normalized.frequency,
      ":time": normalized.time,
      ":schedule_time": normalized.schedule_time,
      ":queryTemplate": normalized.queryTemplate,
      ":templateMessage": normalized.templateMessage,
      ":notificationTypes": normalized.notificationTypes,
      ":modified_at": normalized.modified_at,
      ":modified_by": normalized.modified_by
    },
    ReturnValues: "ALL_NEW"
  });
  const result = await docClient.send(cmd);
  return json(200, { schedule: result.Attributes });
}
async function handleDelete(id) {
  if (!id) return json(400, { message: "Missing id" });
  await docClient.send(new import_lib_dynamodb.DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
  return json(200, { deleted: id });
}
async function handleBatchDelete(body) {
  const payload = safeParseJson(body);
  const ids = Array.isArray(payload.scheduleIds) ? payload.scheduleIds : [];
  if (ids.length === 0) return json(400, { message: "No scheduleIds provided" });
  for (const id of ids) {
    if (!id) continue;
    await docClient.send(new import_lib_dynamodb.DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
  }
  return json(200, { deleted: ids });
}
function json(statusCode, body) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(body ?? {}) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

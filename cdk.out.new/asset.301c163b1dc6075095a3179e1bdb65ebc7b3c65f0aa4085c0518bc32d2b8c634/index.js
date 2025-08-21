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

// hours-api/hoursCrud.ts
var hoursCrud_exports = {};
__export(hoursCrud_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(hoursCrud_exports);
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

// hours-api/hoursCrud.ts
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var TABLE = process.env.CLINIC_HOURS_TABLE || "ClinicHours";
var handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({ ok: true });
  try {
    const path = event.resource || "";
    const method = event.httpMethod;
    if (path.endsWith("/hours") && method === "GET") return listHours(event);
    if (path.endsWith("/hours") && method === "POST") return createHours(event);
    if (path.endsWith("/hours/{clinicId}") && method === "GET") return getHours(event);
    if (path.endsWith("/hours/{clinicId}") && method === "PUT") return updateHours(event);
    if (path.endsWith("/hours/{clinicId}") && method === "DELETE") return deleteHours(event);
    return err(404, "not found");
  } catch (e) {
    return err(500, e?.message || "error");
  }
};
async function listHours(event) {
  const resp = await ddb.send(new import_lib_dynamodb.ScanCommand({ TableName: TABLE, Limit: 200 }));
  return ok({ items: resp.Items || [] });
}
async function createHours(event) {
  const body = parse(event.body);
  const clinicId = String(body.clinicId || "").trim();
  if (!clinicId) return err(400, "clinicId required");
  await ddb.send(new import_lib_dynamodb.PutCommand({ TableName: TABLE, Item: { ...body, clinicId } }));
  return ok({ clinicId });
}
async function getHours(event) {
  const clinicId = event.pathParameters?.clinicId || "";
  const resp = await ddb.send(new import_lib_dynamodb.GetCommand({ TableName: TABLE, Key: { clinicId } }));
  if (!resp.Item) return err(404, "not found");
  return ok(resp.Item);
}
async function updateHours(event) {
  const clinicId = event.pathParameters?.clinicId || "";
  const body = parse(event.body);
  const item = { ...body, clinicId };
  await ddb.send(new import_lib_dynamodb.PutCommand({ TableName: TABLE, Item: item }));
  return ok({ clinicId });
}
async function deleteHours(event) {
  const clinicId = event.pathParameters?.clinicId || "";
  await ddb.send(new import_lib_dynamodb.DeleteCommand({ TableName: TABLE, Key: { clinicId } }));
  return ok({ clinicId });
}
function parse(body) {
  try {
    return typeof body === "string" ? JSON.parse(body) : body || {};
  } catch {
    return {};
  }
}
function ok(data) {
  return { statusCode: 200, headers: buildCorsHeaders(), body: JSON.stringify({ success: true, ...data }) };
}
function err(code, message) {
  return { statusCode: code, headers: buildCorsHeaders(), body: JSON.stringify({ success: false, message }) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

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

// analytics/postCallCrud.ts
var postCallCrud_exports = {};
__export(postCallCrud_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(postCallCrud_exports);
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

// analytics/postCallCrud.ts
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var TABLE = process.env.POSTCALL_TABLE || "PostCallInsights";
var handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({ ok: true });
  try {
    const path = event.resource || "";
    const method = event.httpMethod;
    if (path.endsWith("/postcalls") && method === "GET") return list(event);
    if (path.endsWith("/postcalls") && method === "POST") return create(event);
    if (path.endsWith("/postcalls/{contactId}") && method === "GET") return get(event);
    if (path.endsWith("/postcalls/{contactId}") && method === "PUT") return update(event);
    if (path.endsWith("/postcalls/{contactId}") && method === "DELETE") return remove(event);
    return err(404, "not found");
  } catch (e) {
    return err(500, e?.message || "error");
  }
};
async function list(event) {
  const limit = Math.min(500, parseInt(event.queryStringParameters?.limit || "100", 10));
  const resp = await ddb.send(new import_lib_dynamodb.ScanCommand({ TableName: TABLE, Limit: limit }));
  return ok({ items: resp.Items || [] });
}
async function create(event) {
  const body = parse(event.body);
  const contactId = String(body.contactId || "").trim();
  if (!contactId) return err(400, "contactId required");
  await ddb.send(new import_lib_dynamodb.PutCommand({ TableName: TABLE, Item: body }));
  return ok({ contactId });
}
async function get(event) {
  const contactId = event.pathParameters?.contactId || "";
  const resp = await ddb.send(new import_lib_dynamodb.GetCommand({ TableName: TABLE, Key: { contactId } }));
  if (!resp.Item) return err(404, "not found");
  return ok(resp.Item);
}
async function update(event) {
  const contactId = event.pathParameters?.contactId || "";
  const body = parse(event.body);
  const item = { ...body, contactId };
  await ddb.send(new import_lib_dynamodb.PutCommand({ TableName: TABLE, Item: item }));
  return ok({ contactId });
}
async function remove(event) {
  const contactId = event.pathParameters?.contactId || "";
  await ddb.send(new import_lib_dynamodb.DeleteCommand({ TableName: TABLE, Key: { contactId } }));
  return ok({ contactId });
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

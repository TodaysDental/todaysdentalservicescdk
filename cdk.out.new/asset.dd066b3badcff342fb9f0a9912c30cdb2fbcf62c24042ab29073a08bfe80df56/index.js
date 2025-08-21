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

// queries-api/queries.ts
var queries_exports = {};
__export(queries_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(queries_exports);
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

// queries-api/queries.ts
var client = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(client);
var TABLE_NAME = process.env.TABLE_NAME || "SQL_Queries";
var corsHeaders = buildCorsHeaders();
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
var handler = async (event) => {
  const httpMethod = event.httpMethod;
  const path = event.path || event.resource || "";
  if (httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "CORS preflight response" }) };
  }
  const groups = getGroupsFromClaims(event.requestContext?.authorizer?.claims);
  const wantsWrite = httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "DELETE";
  if (wantsWrite && !isWriteAuthorized(groups)) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "Forbidden" }) };
  }
  try {
    if ((path === "/queries" || path.endsWith("/queries")) && httpMethod === "GET") {
      return await listQueries();
    }
    if ((path.includes("/queries/") || path.endsWith("/queries/{queryName}")) && httpMethod === "GET") {
      const queryName = event.pathParameters?.queryName || path.split("/").pop();
      return await getQuery(queryName);
    }
    if ((path === "/queries" || path.endsWith("/queries")) && httpMethod === "POST") {
      return await createQuery(event);
    }
    if ((path.includes("/queries/") || path.endsWith("/queries/{queryName}")) && httpMethod === "PUT") {
      const queryName = event.pathParameters?.queryName || path.split("/").pop();
      return await updateQuery(event, queryName);
    }
    if ((path.includes("/queries/") || path.endsWith("/queries/{queryName}")) && httpMethod === "DELETE") {
      const queryName = event.pathParameters?.queryName || path.split("/").pop();
      return await deleteQuery(queryName);
    }
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: "Not Found" }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error?.message || "Internal Server Error" }) };
  }
};
async function listQueries() {
  const res = await docClient.send(new import_lib_dynamodb.ScanCommand({ TableName: TABLE_NAME }));
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(res.Items || []) };
}
async function getQuery(queryName) {
  if (!queryName) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "queryName required" }) };
  const res = await docClient.send(new import_lib_dynamodb.GetCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  if (!res.Item) return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: "Not Found" }) };
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(res.Item) };
}
async function createQuery(event) {
  const body = parseBody(event.body);
  const required = ["QueryName", "QueryDescription", "Query"];
  if (!required.every((f) => f in body)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing required fields" }) };
  }
  await docClient.send(new import_lib_dynamodb.PutCommand({
    TableName: TABLE_NAME,
    Item: {
      QueryName: String(body.QueryName),
      QueryDescription: String(body.QueryDescription),
      Query: String(body.Query)
    },
    ConditionExpression: "attribute_not_exists(QueryName)"
  }));
  return { statusCode: 201, headers: corsHeaders, body: JSON.stringify({ message: "Item created successfully" }) };
}
async function updateQuery(event, queryName) {
  if (!queryName) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "queryName required" }) };
  const body = parseBody(event.body);
  await docClient.send(new import_lib_dynamodb.UpdateCommand({
    TableName: TABLE_NAME,
    Key: { QueryName: queryName },
    UpdateExpression: "SET QueryDescription = :desc, #q = :q",
    ExpressionAttributeNames: { "#q": "Query" },
    ExpressionAttributeValues: {
      ":desc": body.QueryDescription,
      ":q": body.Query
    }
  }));
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Item updated successfully" }) };
}
async function deleteQuery(queryName) {
  if (!queryName) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "queryName required" }) };
  await docClient.send(new import_lib_dynamodb.DeleteCommand({ TableName: TABLE_NAME, Key: { QueryName: queryName } }));
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Item deleted successfully" }) };
}
function parseBody(body) {
  if (!body) return {};
  try {
    return typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return {};
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

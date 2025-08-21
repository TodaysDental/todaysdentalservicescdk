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

// templates-api/templates.ts
var templates_exports = {};
__export(templates_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(templates_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// node_modules/uuid/dist/esm-node/rng.js
var import_crypto = __toESM(require("crypto"));
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    import_crypto.default.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

// node_modules/uuid/dist/esm-node/native.js
var import_crypto2 = __toESM(require("crypto"));
var native_default = {
  randomUUID: import_crypto2.default.randomUUID
};

// node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

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

// templates-api/templates.ts
var client = new import_client_dynamodb.DynamoDBClient({});
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(client);
var TABLE_NAME = process.env.TABLE_NAME || "Templates";
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
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: "CORS preflight response" })
    };
  }
  const groups = getGroupsFromClaims(event.requestContext?.authorizer?.claims);
  const wantsWrite = httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "DELETE";
  if (wantsWrite && !isWriteAuthorized(groups)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Forbidden" })
    };
  }
  try {
    if ((path === "/templates" || path.endsWith("/templates")) && httpMethod === "GET") {
      return await listTemplates();
    } else if ((path === "/templates" || path.endsWith("/templates")) && httpMethod === "POST") {
      return await createTemplate(event);
    } else if ((path.startsWith("/templates/") || path.includes("/templates/")) && httpMethod === "DELETE") {
      const templateId = event.pathParameters?.templateId || path.split("/").pop();
      return await deleteTemplate(templateId);
    } else if ((path.startsWith("/templates/") || path.includes("/templates/")) && httpMethod === "PUT") {
      const templateId = event.pathParameters?.templateId || path.split("/").pop();
      return await updateTemplate(event, templateId);
    } else {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Not Found" })
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message ?? "Internal Server Error" })
    };
  }
};
async function listTemplates() {
  const command = new import_lib_dynamodb.ScanCommand({
    TableName: TABLE_NAME
  });
  const response = await docClient.send(command);
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      templates: response.Items || []
    })
  };
}
async function createTemplate(event) {
  const body = JSON.parse(event.body || "{}");
  if (!body.template_name || !body.email_body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Template name and email body are required" })
    };
  }
  const templateId = v4_default();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const item = {
    template_id: templateId,
    template_name: body.template_name,
    email_subject: body.email_subject || "",
    email_body: body.email_body,
    text_message: body.text_message || "",
    modified_at: timestamp,
    modified_by: body.modified_by || "system"
  };
  const command = new import_lib_dynamodb.PutCommand({
    TableName: TABLE_NAME,
    Item: item
  });
  await docClient.send(command);
  return {
    statusCode: 201,
    headers: corsHeaders,
    body: JSON.stringify({
      template_id: templateId,
      message: "Template created successfully"
    })
  };
}
async function updateTemplate(event, templateId) {
  const body = JSON.parse(event.body || "{}");
  if (!body.template_name || !body.email_body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Template name and email body are required" })
    };
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const item = {
    template_id: templateId,
    template_name: body.template_name,
    email_subject: body.email_subject || "",
    email_body: body.email_body,
    text_message: body.text_message || "",
    modified_at: timestamp,
    modified_by: body.modified_by || "system"
  };
  const command = new import_lib_dynamodb.PutCommand({
    TableName: TABLE_NAME,
    Item: item
  });
  await docClient.send(command);
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      template_id: templateId,
      message: "Template updated successfully"
    })
  };
}
async function deleteTemplate(templateId) {
  const command = new import_lib_dynamodb.DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      template_id: templateId
    }
  });
  await docClient.send(command);
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ message: "Template deleted successfully" })
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

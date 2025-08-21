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

// auth-api/initiate.ts
var initiate_exports = {};
__export(initiate_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(initiate_exports);
var import_client_cognito_identity_provider = require("@aws-sdk/client-cognito-identity-provider");

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

// auth-api/initiate.ts
var REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
var USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID || "";
var idp = new import_client_cognito_identity_provider.CognitoIdentityProviderClient({ region: REGION });
var handler = async (event) => {
  try {
    const body = parseBody(event.body);
    if (!body.email) {
      return httpErr(400, "email is required");
    }
    if (!USER_POOL_CLIENT_ID) {
      return httpErr(500, "USER_POOL_CLIENT_ID not configured");
    }
    const resp = await idp.send(new import_client_cognito_identity_provider.InitiateAuthCommand({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: USER_POOL_CLIENT_ID,
      AuthParameters: { USERNAME: body.email }
    }));
    return httpOk({
      delivery: "email",
      session: resp.Session,
      challengeName: resp.ChallengeName,
      challengeParameters: resp.ChallengeParameters
    });
  } catch (err) {
    return httpErr(500, err?.message || "failed to start auth");
  }
};
function parseBody(body) {
  if (!body) return {};
  try {
    return typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return {};
  }
}
function httpOk(data) {
  return { statusCode: 200, headers: buildCorsHeaders({ allowMethods: ["OPTIONS", "POST"] }), body: JSON.stringify({ success: true, ...data }) };
}
function httpErr(code, message) {
  return { statusCode: code, headers: buildCorsHeaders({ allowMethods: ["OPTIONS", "POST"] }), body: JSON.stringify({ success: false, message }) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

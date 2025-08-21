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

// me-api/me.ts
var me_exports = {};
__export(me_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(me_exports);

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

// clinic-config/clinics.ts
var clinics = clinics_default;

// me-api/me.ts
var corsHeaders = buildCorsHeaders();
function getGroupsFromClaims(claims) {
  if (!claims) return [];
  const raw = claims["cognito:groups"] ?? claims["cognito:groups[]"];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    try {
      const maybeArray = JSON.parse(trimmed);
      if (Array.isArray(maybeArray)) return maybeArray;
    } catch {
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
var handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }
  try {
    if (event.resource?.endsWith("/me/connect") && event.httpMethod === "GET") {
      const accessUrl = process.env.CONNECT_ACCESS_URL || "";
      const ccpUrl = process.env.CONNECT_CCP_URL || (accessUrl ? accessUrl.replace(/\/+$/, "") + "/ccp-v2" : "");
      const claims2 = event.requestContext?.authorizer?.claims || {};
      const userEmail = claims2.email || "";
      const baseUrl = process.env.FRONTEND_DOMAIN || "https://todaysdentalinsights.com";
      const cognitoSsoUrl = process.env.CONNECT_SSO_URL || `${baseUrl}/connect-sso?email=${encodeURIComponent(userEmail)}`;
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
        accessUrl,
        ccpUrl,
        ssoUrl: cognitoSsoUrl,
        // Include additional Cognito info for frontend
        cognitoAuthenticated: true,
        userEmail
      }) };
    }
    const claims = event.requestContext?.authorizer?.claims || {};
    const xIsSuperAdmin = String(claims["x_is_super_admin"] || "").toLowerCase() === "true";
    const xClinics = String(claims["x_clinics"] || "").trim();
    const xRbc = String(claims["x_rbc"] || "").trim();
    const groups = getGroupsFromClaims(claims);
    const groupsContainSuperAdmin = groups.some((g) => g === "GLOBAL__SUPER_ADMIN");
    const isSuperAdmin = xIsSuperAdmin || groupsContainSuperAdmin;
    let clinicIds = [];
    if (isSuperAdmin || xClinics === "ALL") {
      clinicIds = clinics.map((c) => c.clinicId);
    } else if (xClinics) {
      clinicIds = xClinics.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (xRbc) {
      clinicIds = xRbc.split(",").map((pair) => pair.split(":")[0]).filter(Boolean);
    } else if (groups.length > 0) {
      clinicIds = groups.map((name) => {
        const match = /^clinic_([^_][^\s]*)__[A-Z_]+$/.exec(String(name));
        return match ? match[1] : "";
      }).filter(Boolean);
    }
    const clinicIdSet = new Set(clinicIds);
    const clinics2 = clinics.filter((c) => clinicIdSet.has(c.clinicId)).map((c) => ({ clinicId: c.clinicId, clinicName: c.clinicName }));
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ clinics: clinics2 })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err?.message || "Internal Server Error" })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

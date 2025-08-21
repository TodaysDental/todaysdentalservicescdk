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

// cognito-triggers/index.ts
var cognito_triggers_exports = {};
__export(cognito_triggers_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(cognito_triggers_exports);
var import_client_cognito_identity_provider = require("@aws-sdk/client-cognito-identity-provider");
var import_client_sesv2 = require("@aws-sdk/client-sesv2");
var cognitoClient = new import_client_cognito_identity_provider.CognitoIdentityProviderClient({});
var sesClient = new import_client_sesv2.SESv2Client({ region: process.env.SES_REGION || process.env.AWS_REGION });
var OTP_LENGTH = parseInt(process.env.OTP_LENGTH || "6", 10);
var CODE_TTL_SECONDS = parseInt(process.env.CODE_TTL_SECONDS || "300", 10);
var MAX_CHALLENGE_ATTEMPTS = parseInt(process.env.MAX_CHALLENGE_ATTEMPTS || "3", 10);
var handler = async (event, _context) => {
  const trigger = event?.triggerSource || "";
  switch (true) {
    case trigger.startsWith("PreAuthentication"):
      return handlePreAuthentication(event);
    case trigger.startsWith("PostAuthentication"):
      return handlePostAuthentication(event);
    case trigger.startsWith("PreTokenGeneration"):
      return handlePreTokenGeneration(event);
    case trigger.startsWith("DefineAuthChallenge"):
      return handleDefineAuthChallenge(event);
    case trigger.startsWith("CreateAuthChallenge"):
      return handleCreateAuthChallenge(event);
    case trigger.startsWith("VerifyAuthChallengeResponse"):
      return handleVerifyAuthChallengeResponse(event);
    case trigger.startsWith("CustomMessage"):
      return handleCustomMessage(event);
    default:
      return event;
  }
};
async function handlePreAuthentication(event) {
  const userAttrs = event?.request?.userAttributes || {};
  const email = userAttrs.email || "";
  const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS?.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean) || [];
  if (allowedDomains.length > 0) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || !allowedDomains.includes(domain)) {
      const err = new Error("Email domain is not allowed");
      err.name = "PreAuthenticationDomainBlocked";
      throw err;
    }
  }
  return event;
}
async function handlePostAuthentication(event) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  event.response = event.response || {};
  event.response.privateChallengeParameters = {
    ...event.response.privateChallengeParameters || {},
    lastLogin: nowIso
  };
  return event;
}
async function handlePreTokenGeneration(event) {
  const userAttrs = event?.request?.userAttributes || {};
  let groups = event?.request?.groupConfiguration?.groupsToOverride || event?.request?.groupConfiguration?.preferredRole || [];
  event.response = event.response || { claimsOverrideDetails: {} };
  event.response.claimsOverrideDetails = event.response.claimsOverrideDetails || {};
  const claimsToAddOrOverride = {
    email_verified: userAttrs.email_verified === true || userAttrs.email_verified === "true" ? "true" : "false",
    preferred_username: String(userAttrs.preferred_username || userAttrs.email || event.userName || "")
  };
  if (!Array.isArray(groups) || groups.length === 0) {
    try {
      const listed = await cognitoClient.send(new import_client_cognito_identity_provider.AdminListGroupsForUserCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName
      }));
      groups = (listed.Groups || []).map((g) => g.GroupName).filter(Boolean);
    } catch (_) {
      groups = [];
    }
  }
  if (Array.isArray(groups) && groups.length > 0) {
    const clinicAccess = deriveClinicAccessFromGroups(groups);
    if (clinicAccess.isSuperAdmin) {
      claimsToAddOrOverride["x_is_super_admin"] = "true";
      claimsToAddOrOverride["x_clinics"] = "ALL";
    } else {
      if (clinicAccess.clinics.length > 0) {
        claimsToAddOrOverride["x_clinics"] = clinicAccess.clinics.join(",");
      }
      const compact = compactRolesByClinic(clinicAccess.rolesByClinic);
      if (compact) {
        claimsToAddOrOverride["x_rbc"] = compact;
      }
    }
  }
  event.response.claimsOverrideDetails.claimsToSuppress = [
    ...event.response.claimsOverrideDetails.claimsToSuppress || [],
    "cognito:groups"
  ];
  event.response.claimsOverrideDetails.claimsToAddOrOverride = {
    ...event.response.claimsOverrideDetails.claimsToAddOrOverride || {},
    ...claimsToAddOrOverride
  };
  return event;
}
async function handleDefineAuthChallenge(event) {
  const session = event.request.session || [];
  const lastChallenge = session[session.length - 1];
  if (lastChallenge && lastChallenge.challengeResult === true) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }
  const attempts = session.filter((s) => s.challengeName === "CUSTOM_CHALLENGE").length;
  if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  }
  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  event.response.challengeName = "CUSTOM_CHALLENGE";
  return event;
}
async function handleCreateAuthChallenge(event) {
  const now = Date.now();
  const session = event.request.session || [];
  const userEmail = event.request.userAttributes?.email || event.userName;
  const lastChallenge = session[session.length - 1];
  const lastChallengeMetadata = lastChallenge?.challengeMetadata || "";
  let otpCode;
  let expiresAtEpochMs;
  if (lastChallenge && lastChallenge.challengeName === "CUSTOM_CHALLENGE" && lastChallengeMetadata?.startsWith("CODE-")) {
    const parts = lastChallengeMetadata.split("|");
    otpCode = parts[0]?.replace("CODE-", "");
    expiresAtEpochMs = parseInt(parts[1] || "0", 10);
  }
  const isExpired = typeof expiresAtEpochMs === "number" && expiresAtEpochMs > 0 ? now > expiresAtEpochMs : true;
  if (!otpCode || isExpired) {
    otpCode = generateNumericOtp(OTP_LENGTH);
    expiresAtEpochMs = now + CODE_TTL_SECONDS * 1e3;
  }
  event.response.privateChallengeParameters = {
    answer: otpCode,
    expiresAtEpochMs: String(expiresAtEpochMs)
  };
  event.response.publicChallengeParameters = {
    delivery: "email",
    emailMasked: maskEmail(userEmail),
    ttlSeconds: String(CODE_TTL_SECONDS)
  };
  event.response.challengeMetadata = `CODE-${otpCode}|${expiresAtEpochMs}`;
  if (process.env.FROM_EMAIL) {
    await sendEmailOtp({ toEmail: userEmail, code: otpCode });
  }
  return event;
}
async function handleVerifyAuthChallengeResponse(event) {
  const provided = String((event.request.challengeAnswer || "").trim());
  const expected = String(event.request.privateChallengeParameters?.answer || "");
  const expiresAtEpochMs = parseInt(event.request.privateChallengeParameters?.expiresAtEpochMs || "0", 10);
  const now = Date.now();
  const valid = safeEqual(provided, expected) && now <= expiresAtEpochMs;
  event.response.answerCorrect = valid;
  return event;
}
async function handleCustomMessage(event) {
  const trigger = event.triggerSource;
  event.response = event.response || {};
  if (trigger === "CustomMessage_UpdateUserAttribute") {
    event.response.emailSubject = "Verify your email";
    event.response.emailMessage = `Your verification code is ${event.request.codeParameter}`;
  }
  if (trigger === "CustomMessage_ResendCode") {
    event.response.emailSubject = "Your code";
    event.response.emailMessage = `Use this code to continue: ${event.request.codeParameter}`;
  }
  return event;
}
function deriveClinicAccessFromGroups(groupNames) {
  const rolesByClinic = {};
  const clinics = /* @__PURE__ */ new Set();
  const isSuperAdmin = groupNames.some((n) => String(n) === "GLOBAL__SUPER_ADMIN");
  for (const name of groupNames) {
    const match = /^clinic_([^_][^\s]*)__([A-Z_]+)$/.exec(String(name));
    if (!match) continue;
    const clinicId = match[1];
    const roleKey = match[2];
    clinics.add(clinicId);
    rolesByClinic[clinicId] = roleKey;
  }
  return { rolesByClinic, clinics: Array.from(clinics), isSuperAdmin };
}
function compactRolesByClinic(rolesByClinic) {
  if (!rolesByClinic || Object.keys(rolesByClinic).length === 0) return "";
  const pairs = [];
  for (const [clinicId, roleKey] of Object.entries(rolesByClinic)) {
    const code = roleKeyToCode(String(roleKey).toUpperCase());
    if (!code) continue;
    pairs.push(`${clinicId}:${code}`);
  }
  return pairs.join(",");
}
function roleKeyToCode(roleKey) {
  switch (roleKey) {
    case "SUPER_ADMIN":
      return "S";
    case "ADMIN":
      return "A";
    case "PROVIDER":
      return "P";
    case "MARKETING":
      return "M";
    case "USER":
      return "U";
    default:
      return "";
  }
}
function generateNumericOtp(length) {
  const min = Math.pow(10, Math.max(1, length) - 1);
  const max = Math.pow(10, Math.max(1, length)) - 1;
  const num = Math.floor(min + Math.random() * (max - min + 1));
  return String(num).padStart(length, "0");
}
function maskEmail(email) {
  if (!email || !email.includes("@")) return "***@***";
  const [user, domain] = email.split("@");
  const u = user.length <= 2 ? user[0] + "*" : user[0] + "*".repeat(user.length - 2) + user[user.length - 1];
  return `${u}@${domain}`;
}
function safeEqual(a, b) {
  const aStr = String(a || "");
  const bStr = String(b || "");
  if (aStr.length !== bStr.length) return false;
  let result = 0;
  for (let i = 0; i < aStr.length; i += 1) {
    result |= aStr.charCodeAt(i) ^ bStr.charCodeAt(i);
  }
  return result === 0;
}
async function sendEmailOtp({ toEmail, code }) {
  const from = process.env.FROM_EMAIL;
  if (!from) return;
  const appName = process.env.APP_NAME || "Your App";
  const subject = `${appName}: Your sign-in code`;
  const bodyText = `Your ${appName} sign-in code is ${code}. It expires in ${Math.floor(CODE_TTL_SECONDS / 60)} minutes.`;
  const bodyHtml = `<p>Your <strong>${appName}</strong> sign-in code is <strong>${code}</strong>.</p><p>It expires in ${Math.floor(CODE_TTL_SECONDS / 60)} minutes.</p>`;
  const cmd = new import_client_sesv2.SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [toEmail] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: bodyText }, Html: { Data: bodyHtml } } } }
  });
  await sesClient.send(cmd);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

// Multi-trigger Cognito Lambda handler (TypeScript)
import { CognitoIdentityProviderClient, AdminListGroupsForUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient = new SESv2Client({ region: process.env.SES_REGION || process.env.AWS_REGION });

const OTP_LENGTH = parseInt(process.env.OTP_LENGTH || "6", 10);
const CODE_TTL_SECONDS = parseInt(process.env.CODE_TTL_SECONDS || "300", 10);
const MAX_CHALLENGE_ATTEMPTS = parseInt(process.env.MAX_CHALLENGE_ATTEMPTS || "3", 10);

export const handler = async (event: any, _context: any) => {
  const trigger = event?.triggerSource || "";
  switch (true) {
    case trigger.startsWith("PreAuthentication"): return handlePreAuthentication(event);
    case trigger.startsWith("PostAuthentication"): return handlePostAuthentication(event);
    case trigger.startsWith("PreTokenGeneration"): return handlePreTokenGeneration(event);
    case trigger.startsWith("DefineAuthChallenge"): return handleDefineAuthChallenge(event);
    case trigger.startsWith("CreateAuthChallenge"): return handleCreateAuthChallenge(event);
    case trigger.startsWith("VerifyAuthChallengeResponse"): return handleVerifyAuthChallengeResponse(event);
    case trigger.startsWith("CustomMessage"): return handleCustomMessage(event);
    default: return event;
  }
};

async function handlePreAuthentication(event: any) {
  const userAttrs = event?.request?.userAttributes || {};
  const email = userAttrs.email || "";
  const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS?.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean) || [];
  if (allowedDomains.length > 0) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || !allowedDomains.includes(domain)) {
      const err = new Error("Email domain is not allowed");
      (err as any).name = "PreAuthenticationDomainBlocked";
      throw err;
    }
  }
  return event;
}

async function handlePostAuthentication(event: any) {
  const nowIso = new Date().toISOString();
  event.response = event.response || {};
  event.response.privateChallengeParameters = {
    ...(event.response.privateChallengeParameters || {}),
    lastLogin: nowIso,
  };

  return event;
}

async function handlePreTokenGeneration(event: any) {
  const userAttrs = event?.request?.userAttributes || {};
  let groups: string[] = (event?.request?.groupConfiguration?.groupsToOverride || event?.request?.groupConfiguration?.preferredRole || []) as string[];
  event.response = event.response || { claimsOverrideDetails: {} };
  event.response.claimsOverrideDetails = event.response.claimsOverrideDetails || {};

  const claimsToAddOrOverride: Record<string, string> = {
    email_verified: (userAttrs.email_verified === true || userAttrs.email_verified === "true") ? "true" : "false",
    preferred_username: String(userAttrs.preferred_username || userAttrs.email || event.userName || ""),
  };

  // Add custom attributes for dental staff
  if (userAttrs["custom:hourly_pay"]) {
    claimsToAddOrOverride["x_hourly_pay"] = String(userAttrs["custom:hourly_pay"]);
  }
  if (userAttrs["custom:opendental_usernum"]) {
    claimsToAddOrOverride["x_od_usernum"] = String(userAttrs["custom:opendental_usernum"]);
  }
  if (userAttrs["custom:opendental_username"]) {
    claimsToAddOrOverride["x_od_username"] = String(userAttrs["custom:opendental_username"]);
  }

  // Add Connect-native architecture metadata
  claimsToAddOrOverride["x_connect_architecture"] = "native";
  claimsToAddOrOverride["x_connect_naming_convention"] = `connect-${String(userAttrs.preferred_username || userAttrs.email || event.userName || "")}`;
  claimsToAddOrOverride["x_connect_user_lookup"] = "hierarchy_based";

  if (!Array.isArray(groups) || groups.length === 0) {
    try {
      const listed = await cognitoClient.send(new AdminListGroupsForUserCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
      }));
      groups = (listed.Groups || []).map((g) => g.GroupName!).filter(Boolean) as string[];
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
    ...(event.response.claimsOverrideDetails.claimsToSuppress || []),
    "cognito:groups",
  ];
  event.response.claimsOverrideDetails.claimsToAddOrOverride = {
    ...(event.response.claimsOverrideDetails.claimsToAddOrOverride || {}),
    ...claimsToAddOrOverride,
  };
  return event;
}

async function handleDefineAuthChallenge(event: any) {
  const session = event.request.session || [];
  const lastChallenge = session[session.length - 1];
  if (lastChallenge && lastChallenge.challengeResult === true) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }
  const attempts = session.filter((s: any) => s.challengeName === "CUSTOM_CHALLENGE").length;
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

async function handleCreateAuthChallenge(event: any) {
  const now = Date.now();
  const session = event.request.session || [];
  const userEmail = event.request.userAttributes?.email || event.userName;
  const lastChallenge = session[session.length - 1];
  const lastChallengeMetadata: string = lastChallenge?.challengeMetadata || "";

  let otpCode: string | undefined;
  let expiresAtEpochMs: number | undefined;
  if (lastChallenge && lastChallenge.challengeName === "CUSTOM_CHALLENGE" && lastChallengeMetadata?.startsWith("CODE-")) {
    const parts = lastChallengeMetadata.split("|");
    otpCode = parts[0]?.replace("CODE-", "");
    expiresAtEpochMs = parseInt(parts[1] || "0", 10);
  }
  const isExpired = typeof expiresAtEpochMs === "number" && expiresAtEpochMs > 0 ? now > expiresAtEpochMs : true;
  if (!otpCode || isExpired) {
    otpCode = generateNumericOtp(OTP_LENGTH);
    expiresAtEpochMs = now + CODE_TTL_SECONDS * 1000;
  }

  event.response.privateChallengeParameters = {
    answer: otpCode,
    expiresAtEpochMs: String(expiresAtEpochMs),
  };
  event.response.publicChallengeParameters = {
    delivery: "email",
    emailMasked: maskEmail(userEmail),
    ttlSeconds: String(CODE_TTL_SECONDS),
  };
  event.response.challengeMetadata = `CODE-${otpCode}|${expiresAtEpochMs}`;

  if (process.env.FROM_EMAIL) {
    await sendEmailOtp({ toEmail: userEmail, code: otpCode });
  }
  return event;
}

async function handleVerifyAuthChallengeResponse(event: any) {
  const provided = String((event.request.challengeAnswer || "").trim());
  const expected = String(event.request.privateChallengeParameters?.answer || "");
  const expiresAtEpochMs = parseInt(event.request.privateChallengeParameters?.expiresAtEpochMs || "0", 10);
  const now = Date.now();
  const valid = safeEqual(provided, expected) && now <= expiresAtEpochMs;
  event.response.answerCorrect = valid;
  return event;
}

async function handleCustomMessage(event: any) {
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

function deriveClinicAccessFromGroups(groupNames: string[]) {
  const rolesByClinic: Record<string, string> = {};
  const clinics = new Set<string>();
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

function compactRolesByClinic(rolesByClinic: Record<string, string>) {
  if (!rolesByClinic || Object.keys(rolesByClinic).length === 0) return "";
  const pairs: string[] = [];
  for (const [clinicId, roleKey] of Object.entries(rolesByClinic)) {
    const code = roleKeyToCode(String(roleKey).toUpperCase());
    if (!code) continue;
    pairs.push(`${clinicId}:${code}`);
  }
  return pairs.join(",");
}

function roleKeyToCode(roleKey: string) {
  switch (roleKey) {
    case "SUPER_ADMIN": return "S";
    case "ADMIN": return "A";
    case "PROVIDER": return "P";
    case "MARKETING": return "M";
    case "USER": return "U";
    // New dental roles
    case "DOCTOR": return "D";
    case "HYGIENIST": return "H";
    case "DENTAL_ASSISTANT": return "DA";
    case "TRAINEE": return "TC";
    case "PATIENT_COORDINATOR": return "PC";
    default: return "";
  }
}

function generateNumericOtp(length: number) {
  const min = Math.pow(10, Math.max(1, length) - 1);
  const max = Math.pow(10, Math.max(1, length)) - 1;
  const num = Math.floor(min + Math.random() * (max - min + 1));
  return String(num).padStart(length, "0");
}

function maskEmail(email: string) {
  if (!email || !email.includes("@")) return "***@***";
  const [user, domain] = email.split("@");
  const u = user.length <= 2 ? user[0] + "*" : user[0] + "*".repeat(user.length - 2) + user[user.length - 1];
  return `${u}@${domain}`;
}

function safeEqual(a: string, b: string) {
  const aStr = String(a || "");
  const bStr = String(b || "");
  if (aStr.length !== bStr.length) return false;
  let result = 0;
  for (let i = 0; i < aStr.length; i += 1) {
    result |= aStr.charCodeAt(i) ^ bStr.charCodeAt(i);
  }
  return result === 0;
}

async function sendEmailOtp({ toEmail, code }: { toEmail: string; code: string }) {
  const from = process.env.FROM_EMAIL as string | undefined;
  if (!from) return;
  const appName = process.env.APP_NAME || "Your App";
  const subject = `${appName}: Your sign-in code`;
  const bodyText = `Your ${appName} sign-in code is ${code}. It expires in ${Math.floor(CODE_TTL_SECONDS / 60)} minutes.`;
  const bodyHtml = `<p>Your <strong>${appName}</strong> sign-in code is <strong>${code}</strong>.</p><p>It expires in ${Math.floor(CODE_TTL_SECONDS / 60)} minutes.</p>`;
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [toEmail] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: bodyText }, Html: { Data: bodyHtml } } } },
  });
  await sesClient.send(cmd);
}



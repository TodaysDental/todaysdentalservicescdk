// Admin API: register user and assign clinic-role groups (TypeScript)
// Runtime: Node.js 22.x

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
// DynamoDB SDK for VoiceAgents table management
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from "../utils/cors";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

type RegisterClinic = { clinicId: string | number; role: string };
type RegisterBody = {
  email: string;
  givenName?: string;
  familyName?: string;
  clinics: RegisterClinic[];
  makeGlobalSuperAdmin?: boolean;
};

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
  const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
  const verifyResult = await verifyIdToken(authz);
  if (!verifyResult.ok) {
    return httpErr(verifyResult.code, verifyResult.message);
  }
  const caller = callerAuthContextFromClaims(verifyResult.payload);
  if (!caller.isSuperAdmin && !hasAnyAdmin(caller.rolesByClinic)) {
    return httpErr(403, "forbidden: admin or super admin required");
  }

  const body = parseBody(event.body) as RegisterBody;
  try {
    validateBody(body);
  } catch (e: any) {
    return httpErr(400, e?.message || "invalid body");
  }

  // Only an existing global super admin can grant global super admin
  if (body.makeGlobalSuperAdmin && !caller.isSuperAdmin) {
    return httpErr(403, "only super admin can grant GLOBAL__SUPER_ADMIN");
  }

  // If not creating a global super admin, enforce per-clinic assignment rules
  if (!body.makeGlobalSuperAdmin) {
    const authValidation = canAssignAll(Array.isArray(body.clinics) ? body.clinics : [], caller);
    if (!authValidation.ok) {
      return httpErr(403, authValidation.message || 'forbidden');
    }
  }

  const userPoolId = process.env.USER_POOL_ID ?? "";
  if (!userPoolId) {
    return httpErr(500, "USER_POOL_ID not configured");
  }

  try {
    const username = body.email.toLowerCase();
    await ensureUserExists({ userPoolId, username, body });

    const groupNames = body.makeGlobalSuperAdmin ? ['GLOBAL__SUPER_ADMIN'] : buildGroupNames(body.clinics);
    for (const group of groupNames) {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: group,
      }));
    }

    // Create Voice Agent entry for each clinic (if applicable)
    const voiceAgentResults = await createVoiceAgentsForUser({
      email: username,
      givenName: body.givenName,
      familyName: body.familyName,
      clinics: body.clinics,
      makeGlobalSuperAdmin: !!body.makeGlobalSuperAdmin,
    });

    return httpOk({ username, groupsAssigned: groupNames, voiceAgents: voiceAgentResults });
  } catch (err: any) {
    return httpErr(500, err?.message || "registration failed");
  }
};

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === "string" ? JSON.parse(body) : body; } catch { return {}; }
}

function validateBody(body: RegisterBody) {
  const allowedRoles = new Set(["SUPER_ADMIN", "ADMIN", "PROVIDER", "MARKETING", "USER"]);
  if (!body.email) throw new Error("email is required");
  const isGlobal = !!body.makeGlobalSuperAdmin;
  if (!isGlobal) {
    if (!Array.isArray(body.clinics) || body.clinics.length === 0) throw new Error("clinics array is required");
    for (const c of body.clinics) {
      if (!c.clinicId) throw new Error("clinicId is required for each clinic mapping");
      if (!allowedRoles.has(String(c.role || "").toUpperCase())) throw new Error("invalid role in clinics");
    }
  }
}

function buildGroupNames(clinics: RegisterClinic[]): string[] {
  return clinics.map((c) => `clinic_${String(c.clinicId)}__${String(c.role).toUpperCase()}`);
}

async function ensureUserExists({ userPoolId, username, body }: { userPoolId: string; username: string; body: RegisterBody; }) {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
    return; // exists
  } catch (_) {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          { Name: "email", Value: username },
          { Name: "email_verified", Value: "true" },
          ...(body.givenName ? [{ Name: "given_name", Value: body.givenName }] : []),
          ...(body.familyName ? [{ Name: "family_name", Value: body.familyName }] : []),
        ],
        MessageAction: "SUPPRESS",
      })
    );
  }
}

function httpOk(data: Record<string, any>) {
  return { statusCode: 200, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: true, ...data }) };
}

function httpErr(code: number, message: string) {
  return { statusCode: code, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: false, message }) };
}

// Auth helpers
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
const USER_POOL_ID = process.env.USER_POOL_ID;
const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, code: 401, message: "missing bearer token" };
  }
  if (!ISSUER) {
    return { ok: false, code: 500, message: "issuer not configured" };
  }
  const token = authorizationHeader.slice(7).trim();
  try {
    JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
    if ((payload as any).token_use !== "id") {
      return { ok: false, code: 401, message: "id token required" };
    }
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, code: 401, message: "invalid token" };
  }
}

function callerAuthContextFromClaims(payload: JWTPayload): { isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } {
  const ctx: { isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } = { isSuperAdmin: false, rolesByClinic: {} };
  if (String((payload as any)["x_is_super_admin"]).toLowerCase() === "true" || String((payload as any)["x_clinics"]).toUpperCase() === "ALL") {
    ctx.isSuperAdmin = true;
    return ctx;
  }
  const rbc = String((payload as any)["x_rbc"] || "").trim();
  if (rbc) {
    for (const pair of rbc.split(",")) {
      const [clinicId, code] = pair.split(":");
      if (!clinicId || !code) continue;
      ctx.rolesByClinic[String(clinicId)] = String(code).toUpperCase();
    }
    return ctx;
  }
  const groups = Array.isArray((payload as any)["cognito:groups"]) ? ((payload as any)["cognito:groups"] as string[]) : [];
  for (const g of groups) {
    if (String(g) === "GLOBAL__SUPER_ADMIN") {
      ctx.isSuperAdmin = true;
      continue;
    }
    const m = /^clinic_([^_][^\s]*)__([A-Z_]+)$/.exec(String(g));
    if (!m) continue;
    const clinicId = m[1];
    const roleKey = m[2];
    const code = roleKeyToCode(roleKey);
    if (!code) continue;
    ctx.rolesByClinic[String(clinicId)] = code;
  }
  return ctx;
}

function hasAnyAdmin(rolesByClinic: Record<string, string>): boolean {
  return Object.values(rolesByClinic).some((code) => code === "S" || code === "A");
}

function canAssignAll(requestedClinics: RegisterClinic[], caller: { isSuperAdmin: boolean; rolesByClinic: Record<string, string> }): { ok: boolean; message?: string } {
  const errors: string[] = [];
  for (const c of requestedClinics) {
    const clinicId = String(c.clinicId);
    const requestedRoleCode = roleKeyToCode(String(c.role).toUpperCase());
    if (requestedRoleCode === "S" && !caller.isSuperAdmin) {
      errors.push(`only super admin can assign SUPER_ADMIN role`);
      continue;
    }
    if (caller.isSuperAdmin) {
      continue;
    }
    const callerRole = caller.rolesByClinic[clinicId];
    if (!callerRole) {
      errors.push(`no admin access for clinic ${clinicId}`);
      continue;
    }
    if (callerRole === "S") {
      continue;
    }
    if (callerRole === "A") {
      if (!["A", "P", "M", "U"].includes(requestedRoleCode)) {
        errors.push(`admin cannot assign role ${c.role} for clinic ${clinicId}`);
      }
      continue;
    }
    errors.push(`insufficient role at clinic ${clinicId}`);
  }
  return errors.length ? { ok: false, message: errors.join("; ") } : { ok: true };
}

function roleKeyToCode(roleKey: string): string {
  switch (String(roleKey).toUpperCase()) {
    case "SUPER_ADMIN": return "S";
    case "ADMIN": return "A";
    case "PROVIDER": return "P";
    case "MARKETING": return "M";
    case "USER": return "U";
    default: return "";
  }
}

// Voice Agent provisioning helpers
const VOICE_AGENTS_TABLE = process.env.VOICE_AGENTS_TABLE || "VoiceAgents";

type VoiceAgentArgs = {
  email: string;
  givenName?: string;
  familyName?: string;
  clinics: RegisterClinic[];
  makeGlobalSuperAdmin: boolean;
};

async function createVoiceAgentsForUser(args: VoiceAgentArgs): Promise<Record<string, any>> {
  if (!VOICE_AGENTS_TABLE) {
    return { enabled: false, reason: "VOICE_AGENTS_TABLE not configured" };
  }

  const results: any[] = [];
  
  // For global super admin, create agent entries for all clinics they might manage
  if (args.makeGlobalSuperAdmin) {
    // Global super admins can use voice for any clinic, but don't auto-create entries
    // They can login to voice widget with any clinic they choose
    return { 
      enabled: true, 
      globalSuperAdmin: true,
      reason: "Global super admin can use voice for any clinic via login widget" 
    };
  }

  // Create voice agent entries for specific clinics where user has any role
  for (const clinic of args.clinics) {
    const role = String(clinic.role).toUpperCase();
    
    // All roles get voice agent entries for call handling
    if (!['ADMIN', 'SUPER_ADMIN', 'PROVIDER', 'MARKETING', 'USER'].includes(role)) {
      continue;
    }

    const agentId = `${args.email}-${clinic.clinicId}`;
    const clinicId = String(clinic.clinicId);
    
    try {
      await ddb.send(new PutCommand({
        TableName: VOICE_AGENTS_TABLE,
        Item: {
          agentId,
          clinicId,
          email: args.email,
          agentName: `${args.givenName || ''} ${args.familyName || ''}`.trim() || args.email.split('@')[0],
          state: 'OFFLINE',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          role: role,
          provisionedBy: 'admin-api'
        }
      }));

      results.push({
        agentId,
        clinicId,
        action: 'created',
        role
      });
    } catch (error) {
      console.error(`Failed to create voice agent for ${agentId}:`, error);
      results.push({
        agentId,
        clinicId,
        action: 'failed',
        error: (error as any)?.message || 'Unknown error'
      });
    }
  }

  return { 
    enabled: true, 
    agentsCreated: results.length,
    results 
  };
}

function safeParseJson(s: string | undefined): any {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}



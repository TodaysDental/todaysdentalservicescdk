// Admin Users API: GET, PUT, DELETE user and manage clinic-role groups
// Runtime: Node.js 22.x

import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// DynamoDB SDK for VoiceAgents table management
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { buildCorsHeaders } from "../utils/cors";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

type ClinicRole = { clinicId: string | number; role: string };
type PutUserBody = {
  givenName?: string;
  familyName?: string;
  clinics?: ClinicRole[];
  makeGlobalSuperAdmin?: boolean;
};

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const VOICE_AGENTS_TABLE = process.env.VOICE_AGENTS_TABLE || "VoiceAgents";

export const handler = async (event: any) => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ["OPTIONS", "GET", "PUT", "DELETE"] });
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
  const verifyResult = await verifyIdToken(authz);
  if (!verifyResult.ok) {
    return httpErr(verifyResult.code, verifyResult.message);
  }
  const caller = callerAuthContextFromClaims(verifyResult.payload);
  if (!caller.isSuperAdmin && !hasAnyAdmin(caller.rolesByClinic)) {
    return httpErr(403, "forbidden: admin or super admin required");
  }

  const userPoolId = process.env.USER_POOL_ID ?? "";
  if (!userPoolId) {
    return httpErr(500, "USER_POOL_ID not configured");
  }

  const pathUsernameRaw = String(event?.pathParameters?.username || "");
  const pathUsername = pathUsernameRaw ? decodeURIComponent(pathUsernameRaw).trim().toLowerCase() : "";

  try {
    // Collection: GET /users
    const isUsersCollectionGet = event.httpMethod === 'GET' && (!pathUsername) && (String(event.resource || '').endsWith('/users') || String(event.path || '').endsWith('/users'));
    if (isUsersCollectionGet) {
      if (!caller.isSuperAdmin && !hasAnyAdmin(caller.rolesByClinic)) {
        return httpErr(403, "forbidden: admin or super admin required");
      }
      const limit = Math.max(1, Math.min(50, Number(event.queryStringParameters?.limit || 25)));
      const paginationToken = event.queryStringParameters?.nextToken || event.queryStringParameters?.paginationToken;
      const listResp = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId, Limit: limit, PaginationToken: paginationToken } as any));
      const users = listResp.Users || [];

      const allowedClinics = caller.isSuperAdmin ? undefined : new Set(Object.entries(caller.rolesByClinic).filter(([, code]) => code === 'S' || code === 'A').map(([cid]) => cid));

      const items: Array<Record<string, any>> = [];
      for (const u of users) {
        const username = String(u.Username || '').toLowerCase();
        const attrs: Record<string, string> = Object.fromEntries((u.Attributes || []).map((a: any) => [a.Name, a.Value]));
        const groupsResp = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }));
        let groupNames = (groupsResp.Groups || []).map((g) => g.GroupName!).filter(Boolean) as string[];

        // Restrict visibility for clinic admins to only their clinics
        if (allowedClinics) {
          groupNames = groupNames.filter((g) => {
            if (g === 'GLOBAL__SUPER_ADMIN') return false;
            const m = /^clinic_([^_][^\s]*)__[A-Z_]+$/.exec(String(g));
            if (!m) return false;
            return allowedClinics.has(m[1]);
          });
          if (groupNames.length === 0) continue; // no visible clinics for this user
        }

        const { clinics, rolesByClinic, isSuperAdmin } = deriveClinicsFromGroups(groupNames);
        items.push({
          username,
          email: String(attrs['email'] || username),
          givenName: String(attrs['given_name'] || ''),
          familyName: String(attrs['family_name'] || ''),
          groups: groupNames,
          clinics,
          rolesByClinic,
          isSuperAdmin,
        });
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ items, nextToken: (listResp as any)?.PaginationToken || undefined }) };
    }

    if (event.httpMethod === "GET") {
      if (!pathUsername) return httpErr(400, "username path parameter is required");
      const info = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const attrs = Object.fromEntries((info.UserAttributes || []).map((a) => [a.Name, a.Value]));
      const groupsResp = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const groupNames = (groupsResp.Groups || []).map((g) => g.GroupName!).filter(Boolean) as string[];
      const { clinics, rolesByClinic, isSuperAdmin } = deriveClinicsFromGroups(groupNames);
      return httpOk({
        username: info.Username || pathUsername,
        email: String(attrs["email"] || pathUsername),
        givenName: String(attrs["given_name"] || ""),
        familyName: String(attrs["family_name"] || ""),
        groups: groupNames,
        clinics,
        rolesByClinic,
        isSuperAdmin,
      });
    }

    if (event.httpMethod === "PUT") {
      const body = parseBody(event.body) as PutUserBody;
      validatePutBody(body);

      // Authorization: Only super admin can grant GLOBAL__SUPER_ADMIN
      if (body.makeGlobalSuperAdmin && !caller.isSuperAdmin) {
        return httpErr(403, "only super admin can grant GLOBAL__SUPER_ADMIN");
      }

      // Enforce per-clinic assignment rules for non-super admin callers
      if (!body.makeGlobalSuperAdmin) {
        const clinics = Array.isArray(body.clinics) ? body.clinics : [];
        const authValidation = canAssignAll(clinics, caller);
        if (!authValidation.ok) {
          return httpErr(403, authValidation.message || "forbidden");
        }
      }

      // Update attributes
      const attribs: Array<{ Name: string; Value: string }> = [];
      if (body.givenName) attribs.push({ Name: "given_name", Value: String(body.givenName) });
      if (body.familyName) attribs.push({ Name: "family_name", Value: String(body.familyName) });
      if (attribs.length > 0) {
        await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId: userPoolId, Username: pathUsername, UserAttributes: attribs }));
      }

      // Sync groups
      const desiredGroups = body.makeGlobalSuperAdmin ? ["GLOBAL__SUPER_ADMIN"] : buildGroupNames(Array.isArray(body.clinics) ? body.clinics : []);
      const currentGroupsResp = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const currentGroups = (currentGroupsResp.Groups || []).map((g) => g.GroupName!).filter(Boolean) as string[];

      const managed = new Set<string>(["GLOBAL__SUPER_ADMIN", ...currentGroups.filter((g) => g.startsWith("clinic_"))]);
      const toRemove = Array.from(managed).filter((g) => !desiredGroups.includes(g));
      const toAdd = desiredGroups.filter((g) => !currentGroups.includes(g));

      for (const g of toRemove) {
        await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: pathUsername, GroupName: g }));
      }
      for (const g of toAdd) {
        await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: pathUsername, GroupName: g }));
      }

      // Update Voice Agent entries for user
      const voiceAgentResults = await updateVoiceAgentsForUser({
        email: pathUsername,
        givenName: body.givenName,
        familyName: body.familyName,
        clinics: Array.isArray(body.clinics) ? body.clinics : [],
        makeGlobalSuperAdmin: !!body.makeGlobalSuperAdmin,
      });

      return httpOk({ username: pathUsername, groupsAssigned: desiredGroups, voiceAgents: voiceAgentResults });
    }

    if (event.httpMethod === "DELETE") {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const deletedVoiceAgents = await deleteVoiceAgentsForUser(pathUsername);
      return httpOk({ username: pathUsername, deleted: true, voiceAgents: deletedVoiceAgents });
    }

    return httpErr(405, "method not allowed");
  } catch (err: any) {
    return httpErr(500, err?.message || "internal error");
  }
};

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === "string" ? JSON.parse(body) : body; } catch { return {}; }
}

function validatePutBody(body: PutUserBody) {
  if (body.makeGlobalSuperAdmin) return;
  const allowedRoles = new Set(["SUPER_ADMIN", "ADMIN", "PROVIDER", "MARKETING", "USER"]);
  const clinics = Array.isArray(body.clinics) ? body.clinics : [];
  for (const c of clinics) {
    if (!c.clinicId) throw new Error("clinicId is required for each clinic mapping");
    if (!allowedRoles.has(String(c.role || "").toUpperCase())) throw new Error("invalid role in clinics");
  }
}

function buildGroupNames(clinics: ClinicRole[]): string[] {
  return clinics.map((c) => `clinic_${String(c.clinicId)}__${String(c.role).toUpperCase()}`);
}

function httpOk(data: Record<string, any>) {
  return { statusCode: 200, headers: buildCorsHeaders({ allowMethods: ["OPTIONS", "GET", "PUT", "DELETE"] }), body: JSON.stringify({ success: true, ...data }) };
}

function httpErr(code: number, message: string) {
  return { statusCode: code, headers: buildCorsHeaders({ allowMethods: ["OPTIONS", "GET", "PUT", "DELETE"] }), body: JSON.stringify({ success: false, message }) };
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
  } catch (_err) {
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

function canAssignAll(requestedClinics: ClinicRole[], caller: { isSuperAdmin: boolean; rolesByClinic: Record<string, string> }): { ok: boolean; message?: string } {
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

function deriveClinicsFromGroups(groupNames: string[]): { clinics: string[]; rolesByClinic: Record<string, string>; isSuperAdmin: boolean } {
  const rolesByClinic: Record<string, string> = {};
  let isSuperAdmin = false;
  for (const g of groupNames || []) {
    if (String(g) === 'GLOBAL__SUPER_ADMIN') {
      isSuperAdmin = true;
      continue;
    }
    const m = /^clinic_([^_][^\s]*)__([A-Z_]+)$/.exec(String(g));
    if (!m) continue;
    const clinicId = m[1];
    const roleKey = m[2];
    const code = roleKeyToCode(roleKey);
    if (!code) continue;
    // Prefer highest privilege if multiple roles present
    const existing = rolesByClinic[clinicId];
    const order: Record<string, number> = { S: 4, A: 3, P: 2, M: 1, U: 0 };
    if (existing === undefined || order[code] > (order[existing] ?? -1)) {
      rolesByClinic[clinicId] = code;
    }
  }
  return { clinics: Object.keys(rolesByClinic), rolesByClinic, isSuperAdmin };
}

// Voice Agent management helpers
type VoiceAgentUpdateArgs = {
  email: string;
  givenName?: string;
  familyName?: string;
  clinics: ClinicRole[];
  makeGlobalSuperAdmin: boolean;
};

async function updateVoiceAgentsForUser(args: VoiceAgentUpdateArgs): Promise<Record<string, any>> {
  if (!VOICE_AGENTS_TABLE) {
    return { enabled: false, reason: "VOICE_AGENTS_TABLE not configured" };
  }

  const results: any[] = [];
  
  // For global super admin, don't create specific agent entries
  if (args.makeGlobalSuperAdmin) {
    return { 
      enabled: true, 
      globalSuperAdmin: true,
      reason: "Global super admin can use voice for any clinic via login widget" 
    };
  }

  // Get existing voice agent entries for this user
  const existingAgents = await getVoiceAgentsForUser(args.email);
  
  // Determine which agents should exist based on current clinic roles
  const requiredAgents = new Set<string>();
  for (const clinic of args.clinics) {
    const role = String(clinic.role).toUpperCase();
    if (['ADMIN', 'SUPER_ADMIN', 'PROVIDER', 'MARKETING', 'USER'].includes(role)) {
      requiredAgents.add(`${args.email}-${clinic.clinicId}`);
    }
  }

  // Update existing agents and create new ones
  for (const clinic of args.clinics) {
    const role = String(clinic.role).toUpperCase();
    if (!['ADMIN', 'SUPER_ADMIN', 'PROVIDER', 'MARKETING', 'USER'].includes(role)) {
      continue;
    }

    const agentId = `${args.email}-${clinic.clinicId}`;
    const clinicId = String(clinic.clinicId);
    const agentName = `${args.givenName || ''} ${args.familyName || ''}`.trim() || args.email.split('@')[0];
    
    try {
      await ddb.send(new UpdateCommand({
        TableName: VOICE_AGENTS_TABLE,
        Key: { agentId },
        UpdateExpression: 'SET clinicId = :cid, email = :email, agentName = :name, #role = :role, updatedAt = :updated, updatedBy = :updatedBy',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: {
          ':cid': clinicId,
          ':email': args.email,
          ':name': agentName,
          ':role': role,
          ':updated': Date.now(),
          ':updatedBy': 'admin-users-api'
        }
      }));

      results.push({
        agentId,
        clinicId,
        action: 'updated',
        role
      });
    } catch (error) {
      console.error(`Failed to update voice agent for ${agentId}:`, error);
      results.push({
        agentId,
        clinicId,
        action: 'failed',
        error: (error as any)?.message || 'Unknown error'
      });
    }
  }

  // Delete agents that are no longer needed
  for (const existingAgent of existingAgents) {
    if (!requiredAgents.has(existingAgent.agentId)) {
      try {
        await ddb.send(new DeleteCommand({
          TableName: VOICE_AGENTS_TABLE,
          Key: { agentId: existingAgent.agentId }
        }));

        results.push({
          agentId: existingAgent.agentId,
          clinicId: existingAgent.clinicId,
          action: 'deleted'
        });
      } catch (error) {
        console.error(`Failed to delete voice agent ${existingAgent.agentId}:`, error);
      }
    }
  }

  return { 
    enabled: true, 
    agentsProcessed: results.length,
    results 
  };
}

async function deleteVoiceAgentsForUser(email: string): Promise<Record<string, any>> {
  if (!VOICE_AGENTS_TABLE) {
    return { enabled: false, reason: "VOICE_AGENTS_TABLE not configured" };
  }

  try {
    const existingAgents = await getVoiceAgentsForUser(email);
    const results: any[] = [];

    for (const agent of existingAgents) {
      try {
        await ddb.send(new DeleteCommand({
          TableName: VOICE_AGENTS_TABLE,
          Key: { agentId: agent.agentId }
        }));

        results.push({
          agentId: agent.agentId,
          clinicId: agent.clinicId,
          action: 'deleted'
        });
      } catch (error) {
        console.error(`Failed to delete voice agent ${agent.agentId}:`, error);
        results.push({
          agentId: agent.agentId,
          action: 'failed',
          error: (error as any)?.message || 'Unknown error'
        });
      }
    }

    return {
      enabled: true,
      agentsDeleted: results.filter(r => r.action === 'deleted').length,
      results
    };
  } catch (error) {
    return {
      enabled: false,
      error: (error as any)?.message || 'Failed to delete voice agents'
    };
  }
}

async function getVoiceAgentsForUser(email: string): Promise<any[]> {
  if (!VOICE_AGENTS_TABLE) {
    return [];
  }

  try {
    // Use a GSI to query by email if available, otherwise scan
    const result = await ddb.send(new QueryCommand({
      TableName: VOICE_AGENTS_TABLE,
      IndexName: 'EmailIndex', // Assuming there's a GSI on email
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    }));

    return result.Items || [];
  } catch (error) {
    // If GSI doesn't exist, this will fail - that's okay for now
    console.warn('Could not query voice agents by email, GSI may not exist:', error);
    return [];
  }
}

function safeParseJson(s: string | undefined): any {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}



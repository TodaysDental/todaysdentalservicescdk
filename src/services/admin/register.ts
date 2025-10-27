// Admin API: register user and assign clinic-role groups (TypeScript)
// Runtime: Node.js 22.x

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  ListGroupsCommand,
  ListGroupsCommandOutput,
  GroupType,
} from "@aws-sdk/client-cognito-identity-provider";
// DynamoDB SDK for StaffClinicInfo and VoiceAgents table management
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
// Connect SDK for Connect user management
import {
  ConnectClient,
  CreateUserCommand,
  UpdateUserProficienciesCommand
} from '@aws-sdk/client-connect';
import { buildCorsHeaders } from "../../shared/utils/cors";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { buildProficiencies } from '../../infrastructure/utils/clinicCombinations';
import { CONNECT_CONFIG } from '../../infrastructure/configs/connect-config';

type RegisterClinic = { clinicId: string | number; role: string };

// Defines the detailed staff info structure for a single clinic
type StaffClinicDetail = {
  clinicId: string;
  UserNum?: number;
  UserName?: string;
  EmployeeNum?: number;
  employeeName?: string;
  ProviderNum?: string;
  providerName?: string;
  ClinicNum?: string;
  hourlyPay?: string | number; // This is now per-clinic
};

// RegisterBody - Connect user creation is automatic for non-super-admin users
type RegisterBody = {
  email: string;
  givenName?: string;
  familyName?: string;
  clinics: RegisterClinic[]; // For Cognito Group role assignments
  makeGlobalSuperAdmin?: boolean;
  staffDetails?: StaffClinicDetail[]; // Array for detailed staff info
  connectSecurityProfileIds?: string[]; // Security profiles for Connect user (optional, has defaults)
  connectPhoneType?: 'SOFT_PHONE' | 'DESK_PHONE'; // Phone type for Connect user (optional, defaults to SOFT_PHONE)
};

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Get table names from environment variables (Connect-native architecture)
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE;
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1';
const CONNECT_MASTER_ROUTING_PROFILE_ID = process.env.CONNECT_MASTER_ROUTING_PROFILE_ID || 'arn:aws:connect:us-east-1:851620242036:routing-profile/master-routing-profile-id';


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

    // Save detailed staff info to DynamoDB
    if (STAFF_INFO_TABLE && Array.isArray(body.staffDetails) && body.staffDetails.length > 0) {
      await saveStaffInfoToDynamoDB(username, body.staffDetails);
    }

    // Connect-native architecture - voice agents created in Amazon Connect
    const voiceAgentResults = await createVoiceAgentInConnect({
      username,
      email: body.email,
      givenName: body.givenName,
      familyName: body.familyName,
      clinics: body.clinics || [],
      makeGlobalSuperAdmin: !!body.makeGlobalSuperAdmin,
    });

    // Create Connect user automatically for all non-super-admin users (Connect-native approach)
    let connectUserResult = null;
    if (!body.makeGlobalSuperAdmin) {
      connectUserResult = await createConnectUserForRegisteredUser({
        username,
        email: body.email,
        givenName: body.givenName,
        familyName: body.familyName,
        clinics: body.clinics || [],
        securityProfileIds: body.connectSecurityProfileIds || getDefaultSecurityProfiles(),
        phoneType: body.connectPhoneType || 'SOFT_PHONE',
        makeGlobalSuperAdmin: false,
      });
    }

    return httpOk({
      username,
      groupsAssigned: groupNames,
      voiceAgents: voiceAgentResults,
      connectUser: connectUserResult
    });
  } catch (err: any) {
    return httpErr(500, err?.message || "registration failed");
  }
};

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === "string" ? JSON.parse(body) : body; } catch { return {}; }
}

function validateBody(body: RegisterBody) {
  const allowedRoles = new Set([
    "SUPER_ADMIN", "ADMIN", "PROVIDER", "MARKETING", "USER",
    "DOCTOR", "HYGIENIST", "DENTAL_ASSISTANT", "TRAINEE", "PATIENT_COORDINATOR"
  ]);
  if (!body.email) throw new Error("email is required");
  const isGlobal = !!body.makeGlobalSuperAdmin;
  if (!isGlobal) {
    if (!Array.isArray(body.clinics) || body.clinics.length === 0) throw new Error("clinics array is required");
    for (const c of body.clinics) {
      if (!c.clinicId) throw new Error("clinicId is required for each clinic mapping");
      if (!allowedRoles.has(String(c.role || "").toUpperCase())) throw new Error("invalid role in clinics");
    }
  }

  // Validate Connect user creation parameters (optional parameters for automatic Connect user creation)
  if (body.connectSecurityProfileIds && (!Array.isArray(body.connectSecurityProfileIds) || body.connectSecurityProfileIds.length === 0)) {
    throw new Error("connectSecurityProfileIds must be a non-empty array if provided");
  }
  if (body.connectPhoneType && !['SOFT_PHONE', 'DESK_PHONE'].includes(body.connectPhoneType)) {
    throw new Error("connectPhoneType must be either 'SOFT_PHONE' or 'DESK_PHONE'");
  }
}

function buildGroupNames(clinics: RegisterClinic[]): string[] {
  return clinics.map((c) => `clinic_${String(c.clinicId)}__${String(c.role).toUpperCase()}`);
}

async function ensureUserExists({ userPoolId, username, body }: { userPoolId: string; username: string; body: RegisterBody; }) {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
    return; // user exists
  } catch (_) {
    // Note: Per-user attributes like hourlyPay are no longer set here,
    // as that data is now stored per-clinic in DynamoDB.
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

// Function to save staff info to the StaffClinicInfo DynamoDB table
async function saveStaffInfoToDynamoDB(email: string, details: StaffClinicDetail[]) {
  if (!STAFF_INFO_TABLE) {
    console.warn('STAFF_CLINIC_INFO_TABLE is not configured. Skipping save.');
    return;
  }

  // Process each clinic-specific detail object
  for (const detail of details) {
    if (!detail.clinicId) {
        console.warn('Skipping staff detail item without a clinicId for user:', email);
        continue;
    }
    
    // ** FIX APPLIED HERE **
    // Spread the detail object first, then explicitly define/overwrite the keys
    // to ensure type correctness and avoid the TypeScript compiler error.
    const item = {
      ...detail,
      email: email.toLowerCase(), // Partition Key
      clinicId: String(detail.clinicId), // Sort Key
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await ddb.send(new PutCommand({
        TableName: STAFF_INFO_TABLE,
        Item: item,
      }));
    } catch (err) {
      console.error(`Failed to save staff info for ${email} at clinic ${detail.clinicId}`, err);
      // Depending on requirements, you might want to throw an error here to fail the request
    }
  }
}


function httpOk(data: Record<string, any>) {
  return { statusCode: 200, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: true, ...data }) };
}

function httpErr(code: number, message: string) {
  return { statusCode: code, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: false, message }) };
}

// ========================================
// VOICE AGENT MANAGEMENT HELPERS
// ========================================

// Voice Agent management helpers
type VoiceAgentUpdateArgs = {
  email: string;
  givenName?: string;
  familyName?: string;
  clinics: RegisterClinic[];
  makeGlobalSuperAdmin: boolean;
};

// Connect-native architecture - voice agents created in Amazon Connect
async function createVoiceAgentInConnect({
  username,
  email,
  givenName,
  familyName,
  clinics,
  makeGlobalSuperAdmin,
}: {
  username: string;
  email: string;
  givenName?: string;
  familyName?: string;
  clinics: RegisterClinic[];
  makeGlobalSuperAdmin: boolean;
}): Promise<any> {
  try {
    // Only create voice agents if the user is not a global super admin
    // (super admins don't need voice agent access)
    if (makeGlobalSuperAdmin) {
      return {
        enabled: false,
        reason: "Global super admins don't need voice agent access",
        agentsProcessed: 0,
        results: []
      };
    }

    // Import Connect functionality directly
    const {
      ConnectClient,
      CreateUserCommand,
    } = await import('@aws-sdk/client-connect');

    const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1';

    const results: any[] = [];
    let agentsProcessed = 0;

    // Create voice agent for each clinic the user has access to
    for (const clinic of clinics) {
      if (clinic.role === 'USER') {
        try {
          const createUserCommand = new CreateUserCommand({
            InstanceId: CONNECT_INSTANCE_ID,
            Username: `voice-${username.toLowerCase()}-${clinic.clinicId}`,
            IdentityInfo: {
              FirstName: givenName || '',
              LastName: familyName || '',
              Email: email,
            },
            PhoneConfig: {
              PhoneType: 'SOFT_PHONE',
              AutoAccept: true,
              AfterContactWorkTimeLimit: 0,
              DeskPhoneNumber: '',
            },
            SecurityProfileIds: [CONNECT_CONFIG.SECURITY_PROFILES.AGENT],
            RoutingProfileId: CONNECT_CONFIG.ROUTING_PROFILES.BASIC,
            Password: generateRandomPassword(),
          });

          const connectResult = await connect.send(createUserCommand);

          results.push({
            agentId: `${email}-${clinic.clinicId}`,
            clinicId: clinic.clinicId,
            action: 'created',
            error: null,
            connectUserId: connectResult.UserId,
            connectUsername: `voice-${username.toLowerCase()}-${clinic.clinicId}`,
          });

          agentsProcessed++;

        } catch (error: any) {
          results.push({
            agentId: `${email}-${clinic.clinicId}`,
            clinicId: clinic.clinicId,
            action: 'failed',
            error: error.message,
          });
        }
      }
    }

    return {
      enabled: true,
      agentsProcessed,
      results,
    };
  } catch (error: any) {
    console.error('Error creating voice agents in Connect:', error);
    return {
      enabled: false,
      reason: error.message,
      agentsProcessed: 0,
      results: [{
        action: 'failed',
        error: error.message,
      }],
    };
  }
}

function generateRandomPassword(): string {
  const length = 12;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

function getDefaultSecurityProfiles(): string[] {
  // Default security profile for Connect users - basic agent permissions
  return [process.env.CONNECT_SECURITY_PROFILE_ID || 'arn:aws:connect:us-east-1:851620242036:security-profile/basic-agent-security-profile'];
}

// ========================================
// CONNECT USER CREATION FOR REGISTRATION
// ========================================

export async function createConnectUserForRegisteredUser({
  username,
  email,
  givenName,
  familyName,
  clinics,
  securityProfileIds,
  phoneType,
  makeGlobalSuperAdmin,
}: {
  username: string;
  email: string;
  givenName?: string;
  familyName?: string;
  clinics: RegisterClinic[];
  securityProfileIds: string[];
  phoneType: 'SOFT_PHONE' | 'DESK_PHONE';
  makeGlobalSuperAdmin: boolean;
}): Promise<any> {
  try {
    // Check if Connect user already exists (Connect-native approach)
    const { findConnectUserByUsername } = await import('../connect/connectUser');
    const existingConnectUser = await findConnectUserByUsername(username);

    if (existingConnectUser) {
      return {
        success: false,
        message: 'Connect user already exists',
        existing: true,
        connectUserId: existingConnectUser.Id,
        connectUserArn: existingConnectUser.Arn,
      };
    }

    // Create Connect user
    const connectUserId = `connect-${username}`;
    const userEmail = email || `${username}@todaysdentalinsights.com`;

    const createUserCommand = new CreateUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      Username: connectUserId,
      IdentityInfo: {
        FirstName: givenName || 'Unknown',
        LastName: familyName || 'User',
        Email: userEmail,
      },
      PhoneConfig: {
        PhoneType: phoneType,
        AutoAccept: false,
        AfterContactWorkTimeLimit: 0,
        DeskPhoneNumber: '',
      },
      SecurityProfileIds: securityProfileIds || getDefaultSecurityProfiles(),
      RoutingProfileId: CONNECT_MASTER_ROUTING_PROFILE_ID,
    });

    const connectResult = await connect.send(createUserCommand);

    // Update proficiencies based on clinics (for Attribute-Based Routing)
    const clinicIds = clinics.map(c => String(c.clinicId));
    if (clinicIds.length > 0) {
      await updateConnectUserProficiencies(connectResult.UserId!, clinicIds);
    }

    // Connect-native architecture - no additional storage needed
    // User hierarchy groups and proficiencies are managed directly in Connect

    return {
      success: true,
      message: 'Connect user created successfully (Connect-native)',
      connectUserId: connectResult.UserId,
      connectUserArn: connectResult.UserArn,
      clinics: clinicIds,
      hierarchyGroups: clinicIds.map(clinicId => `clinic-${clinicId}`),
    };
  } catch (error: any) {
    console.error('Failed to create Connect user during registration:', error);
    return {
      success: false,
      message: `Failed to create Connect user: ${error.message}`,
      error: error.message,
    };
  }
}


// Connect-native architecture - user lookup handled by Connect APIs
// No additional user record storage needed

async function updateConnectUserProficiencies(connectUserId: string, clinics: string[]): Promise<void> {
  try {
    const proficiencies = buildProficiencies(clinics);

    await connect.send(new UpdateUserProficienciesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: connectUserId,
      UserProficiencies: proficiencies,
    }));

    console.log(`Updated proficiencies for user ${connectUserId} with clinics: ${clinics.join(', ')}`);
  } catch (err: any) {
    console.error('Error updating Connect user proficiencies:', err);
    throw new Error(`Failed to update Connect user proficiencies: ${err.message}`);
  }
}


// Auth helpers (no changes needed here)
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
      if (!["A", "P", "M", "U", "D", "H", "DA", "TC", "PC"].includes(requestedRoleCode)) {
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
    // New dental roles
    case "DOCTOR": return "D";
    case "HYGIENIST": return "H";
    case "DENTAL_ASSISTANT": return "DA";
    case "TRAINEE": return "TC";
    case "PATIENT_COORDINATOR": return "PC";
    default: return "";
  }
}

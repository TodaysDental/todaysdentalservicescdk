// // Admin API: register user and assign clinic-role groups (TypeScript)
// // Runtime: Node.js 22.x

// import {
//   CognitoIdentityProviderClient,
//   AdminCreateUserCommand,
//   AdminAddUserToGroupCommand,
//   AdminGetUserCommand,
// } from "@aws-sdk/client-cognito-identity-provider";
// import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// import { buildCorsHeaders } from "../../shared/utils/cors";
// import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

// // This type now mirrors StaffClinicDetail but allows clinicId to be a number
// type RegisterClinic = {
//   clinicId: string | number;
//   role: string;
//   UserNum?: number;
//   UserName?: string;
//   EmployeeNum?: number;
//   employeeName?: string;
//   ProviderNum?: string;
//   providerName?: string;
//   ClinicNum?: string;
//   hourlyPay?: string | number;
// };

// type StaffClinicDetail = {
//   clinicId: string;
//   UserNum?: number;
//   UserName?: string;
//   EmployeeNum?: number;
//   employeeName?: string;
//   ProviderNum?: string;
//   providerName?: string;
//   ClinicNum?: string;
//   hourlyPay?: string | number;
// };

// // RegisterBody - user registration with clinic role assignments
// type RegisterBody = {
//   email: string;
//   givenName?: string;
//   familyName?: string;
//   clinics: RegisterClinic[]; // For Cognito Group role assignments
//   makeGlobalSuperAdmin?: boolean;
//   staffDetails?: StaffClinicDetail[]; // Array for detailed staff info
// };

// const cognito = new CognitoIdentityProviderClient({});
// const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// // Get table name from environment variables
// const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE;


// export const handler = async (event: any) => {
//   const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
//   const verifyResult = await verifyIdToken(authz);
//   if (!verifyResult.ok) {
//     return httpErr(verifyResult.code, verifyResult.message);
//   }
//   const caller = callerAuthContextFromClaims(verifyResult.payload);
//   if (!caller.isSuperAdmin && !hasAnyAdmin(caller.rolesByClinic)) {
//     return httpErr(403, "forbidden: admin or super admin required");
//   }

//   const body = parseBody(event.body) as RegisterBody;
//   try {
//     validateBody(body);
//   } catch (e: any) {
//     return httpErr(400, e?.message || "invalid body");
//   }

//   // Only an existing global super admin can grant global super admin
//   if (body.makeGlobalSuperAdmin && !caller.isSuperAdmin) {
//     return httpErr(403, "only super admin can grant GLOBAL__SUPER_ADMIN");
//   }

//   // If not creating a global super admin, enforce per-clinic assignment rules
//   if (!body.makeGlobalSuperAdmin) {
//     const authValidation = canAssignAll(Array.isArray(body.clinics) ? body.clinics : [], caller);
//     if (!authValidation.ok) {
//       return httpErr(403, authValidation.message || 'forbidden');
//     }
//   }

//   const userPoolId = process.env.USER_POOL_ID ?? "";
//   if (!userPoolId) {
//     return httpErr(500, "USER_POOL_ID not configured");
//   }

//   try {
//     const username = body.email.toLowerCase();
//     await ensureUserExists({ userPoolId, username, body });

//     const groupNames = body.makeGlobalSuperAdmin ? ['GLOBAL__SUPER_ADMIN'] : buildGroupNames(body.clinics);
//     for (const group of groupNames) {
//       await cognito.send(new AdminAddUserToGroupCommand({
//         UserPoolId: userPoolId,
//         Username: username,
//         GroupName: group,
//       }));
//     }

//     // **FIX: Save staffDetails to DynamoDB - use body.clinics directly if staffDetails not provided**
//     // This ensures that hourlyPay and other per-clinic data gets saved
//     if (STAFF_INFO_TABLE && Array.isArray(body.clinics) && body.clinics.length > 0) {
//       // If staffDetails explicitly provided, use that; otherwise derive from clinics array
//       const detailsToSave = body.staffDetails && body.staffDetails.length > 0 
//         ? body.staffDetails 
//         : body.clinics;
      
//       await saveStaffInfoToDynamoDB(username, detailsToSave);
//     }

//     return httpOk({
//       username,
//       groupsAssigned: groupNames
//     });
//   } catch (err: any) {
//     return httpErr(500, err?.message || "registration failed");
//   }
// };

// function parseBody(body: any): Record<string, any> {
//   if (!body) return {};
//   try { return typeof body === "string" ? JSON.parse(body) : body; } catch { return {}; }
// }

// function validateBody(body: RegisterBody) {
//   const allowedRoles = new Set([
//     "SUPER_ADMIN", "ADMIN", "PROVIDER", "MARKETING", "USER",
//     "DOCTOR", "HYGIENIST", "DENTAL_ASSISTANT", "TRAINEE", "PATIENT_COORDINATOR"
//   ]);
//   if (!body.email) throw new Error("email is required");
//   const isGlobal = !!body.makeGlobalSuperAdmin;
//   if (!isGlobal) {
//     if (!Array.isArray(body.clinics) || body.clinics.length === 0) throw new Error("clinics array is required");
//     for (const c of body.clinics) {
//       if (!c.clinicId) throw new Error("clinicId is required for each clinic mapping");
//       if (!allowedRoles.has(String(c.role || "").toUpperCase())) throw new Error("invalid role in clinics");
//     }
//   }
// }

// function buildGroupNames(clinics: RegisterClinic[]): string[] {
//   return clinics.map((c) => `clinic_${String(c.clinicId)}__${String(c.role).toUpperCase()}`);
// }

// async function ensureUserExists({ userPoolId, username, body }: { userPoolId: string; username: string; body: RegisterBody; }) {
//   try {
//     await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
//     return; // user exists
//   } catch (_) {
//     await cognito.send(
//       new AdminCreateUserCommand({
//         UserPoolId: userPoolId,
//         Username: username,
//         UserAttributes: [
//           { Name: "email", Value: username },
//           { Name: "email_verified", Value: "true" },
//           ...(body.givenName ? [{ Name: "given_name", Value: body.givenName }] : []),
//           ...(body.familyName ? [{ Name: "family_name", Value: body.familyName }] : []),
//         ],
//         MessageAction: "SUPPRESS",
//       })
//     );
//   }
// }

// // **FIX: Updated to accept RegisterClinic[] which includes all fields**
// async function saveStaffInfoToDynamoDB(email: string, details: (StaffClinicDetail | RegisterClinic)[]) {
//   if (!STAFF_INFO_TABLE) {
//     console.warn('STAFF_CLINIC_INFO_TABLE is not configured. Skipping save.');
//     return;
//   }

//   // Process each clinic-specific detail object
//   for (const detail of details) {
//     if (!detail.clinicId) {
//         console.warn('Skipping staff detail item without a clinicId for user:', email);
//         continue;
//     }
    
//     // Build the item for DynamoDB - spread all fields except 'role' which is not stored in DDB
//     const { role, ...restOfDetail } = detail as any; // Remove 'role' as it's for Cognito groups only
    
//     const item = {
//       ...restOfDetail,
//       email: email.toLowerCase(), // Partition Key
//       clinicId: String(detail.clinicId), // Sort Key
//       createdAt: new Date().toISOString(),
//       updatedAt: new Date().toISOString(),
//     };

//     try {
//       await ddb.send(new PutCommand({
//         TableName: STAFF_INFO_TABLE,
//         Item: item,
//       }));
//     } catch (err) {
//       console.error(`Failed to save staff info for ${email} at clinic ${detail.clinicId}`, err);
//       // Depending on requirements, you might want to throw an error here to fail the request
//     }
//   }
// }


// function httpOk(data: Record<string, any>) {
//   return { statusCode: 200, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: true, ...data }) };
// }

// function httpErr(code: number, message: string) {
//   return { statusCode: code, headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }), body: JSON.stringify({ success: false, message }) };
// }

// // Auth helpers
// const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;
// const USER_POOL_ID = process.env.USER_POOL_ID;
// const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
// let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

// async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
//   if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
//     return { ok: false, code: 401, message: "missing bearer token" };
//   }
//   if (!ISSUER) {
//     return { ok: false, code: 500, message: "issuer not configured" };
//   }
//   const token = authorizationHeader.slice(7).trim();
//   try {
//     JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
//     const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
//     if ((payload as any).token_use !== "id") {
//       return { ok: false, code: 401, message: "id token required" };
//     }
//     return { ok: true, payload };
//   } catch (err) {
//     return { ok: false, code: 401, message: "invalid token" };
//   }
// }

// function callerAuthContextFromClaims(payload: JWTPayload): { isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } {
//   const ctx: { isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } = { isSuperAdmin: false, rolesByClinic: {} };
//   if (String((payload as any)["x_is_super_admin"]).toLowerCase() === "true" || String((payload as any)["x_clinics"]).toUpperCase() === "ALL") {
//     ctx.isSuperAdmin = true;
//     return ctx;
//   }
//   const rbc = String((payload as any)["x_rbc"] || "").trim();
//   if (rbc) {
//     for (const pair of rbc.split(",")) {
//       const [clinicId, code] = pair.split(":");
//       if (!clinicId || !code) continue;
//       ctx.rolesByClinic[String(clinicId)] = String(code).toUpperCase();
//     }
//     return ctx;
//   }
//   const groups = Array.isArray((payload as any)["cognito:groups"]) ? ((payload as any)["cognito:groups"] as string[]) : [];
//   for (const g of groups) {
//     if (String(g) === "GLOBAL__SUPER_ADMIN") {
//       ctx.isSuperAdmin = true;
//       continue;
//     }
//     const m = /^clinic_([^_][^\s]*)__([A-Z_]+)$/.exec(String(g));
//     if (!m) continue;
//     const clinicId = m[1];
//     const roleKey = m[2];
//     const code = roleKeyToCode(roleKey);
//     if (!code) continue;
//     ctx.rolesByClinic[String(clinicId)] = code;
//   }
//   return ctx;
// }

// function hasAnyAdmin(rolesByClinic: Record<string, string>): boolean {
//   return Object.values(rolesByClinic).some((code) => code === "S" || code === "A");
// }

// function canAssignAll(requestedClinics: RegisterClinic[], caller: { isSuperAdmin: boolean; rolesByClinic: Record<string, string> }): { ok: boolean; message?: string } {
//   const errors: string[] = [];
//   for (const c of requestedClinics) {
//     const clinicId = String(c.clinicId);
//     const requestedRoleCode = roleKeyToCode(String(c.role).toUpperCase());
//     if (requestedRoleCode === "S" && !caller.isSuperAdmin) {
//       errors.push(`only super admin can assign SUPER_ADMIN role`);
//       continue;
//     }
//     if (caller.isSuperAdmin) {
//       continue;
//     }
//     const callerRole = caller.rolesByClinic[clinicId];
//     if (!callerRole) {
//       errors.push(`no admin access for clinic ${clinicId}`);
//       continue;
//     }
//     if (callerRole === "S") {
//       continue;
//     }
//     if (callerRole === "A") {
//       if (!["A", "P", "M", "U", "D", "H", "DA", "TC", "PC"].includes(requestedRoleCode)) {
//         errors.push(`admin cannot assign role ${c.role} for clinic ${clinicId}`);
//       }
//       continue;
//     }
//     errors.push(`insufficient role at clinic ${clinicId}`);
//   }
//   return errors.length ? { ok: false, message: errors.join("; ") } : { ok: true };
// }

// function roleKeyToCode(roleKey: string): string {
//   switch (String(roleKey).toUpperCase()) {
//     case "SUPER_ADMIN": return "S";
//     case "ADMIN": return "A";
//     case "PROVIDER": return "P";
//     case "MARKETING": return "M";
//     case "USER": return "U";
//     // New dental roles
//     case "DOCTOR": return "D";
//     case "HYGIENIST": return "H";
//     case "DENTAL_ASSISTANT": return "DA";
//     case "TRAINEE": return "TC";
//     case "PATIENT_COORDINATOR": return "PC";
//     default: return "";
//   }
// }

// Admin API: register user and assign clinic-role groups (TypeScript)
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
  ListUsersCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from "../../shared/utils/cors";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

type ClinicRole = { clinicId: string | number; role: string };

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
  hourlyPay?: string | number;
};

// Updated PutUserBody to use the new detailed array for DynamoDB
type PutUserBody = {
  givenName?: string;
  familyName?: string;
  clinics?: ClinicRole[];
  makeGlobalSuperAdmin?: boolean;
  staffDetails?: StaffClinicDetail[];
  openDentalPerClinic?: StaffClinicDetail[];
};

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Get table names from environment variables
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE;

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
      
      // FIXED: Fetch ALL users with proper typing
      const allUsers: any[] = [];
      let paginationToken: string | undefined = undefined;
      
      do {
        const listResp: ListUsersCommandOutput = await cognito.send(new ListUsersCommand({ 
          UserPoolId: userPoolId, 
          Limit: 60, // Max allowed by AWS
          PaginationToken: paginationToken 
        }));
        
        allUsers.push(...(listResp.Users || []));
        paginationToken = listResp.PaginationToken;
      } while (paginationToken);

      // Build set of clinic IDs the caller can administer
      const allowedClinics = caller.isSuperAdmin ? undefined : new Set(Object.entries(caller.rolesByClinic).filter(([, code]) => code === 'S' || code === 'A').map(([cid]) => cid));

      const items: Array<Record<string, any>> = [];
      for (const u of allUsers) {
        const username = String(u.Username || '').toLowerCase();
        const attrs: Record<string, string> = Object.fromEntries((u.Attributes || []).map((a: any) => [a.Name, a.Value]));
        const email = attrs['email']?.toLowerCase() || '';

        // Get Cognito groups
        const groupsResp = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }));
        let groupNames = (groupsResp.Groups || []).map((g) => g.GroupName!).filter(Boolean) as string[];
        
        // Get staff details from DynamoDB
        const staffDetails = STAFF_INFO_TABLE && email ? await getStaffInfoFromDynamoDB(email) : [];

        // Check visibility based on BOTH Cognito groups AND DynamoDB staffDetails
        if (allowedClinics) {
          // Filter Cognito groups to only show groups in allowed clinics
          const visibleGroups = groupNames.filter((g) => {
            if (g === 'GLOBAL__SUPER_ADMIN') return false;
            const m = /^clinic_([^_][^\s]*)__[A-Z_]+$/.exec(String(g));
            if (!m) return false;
            return allowedClinics.has(m[1]);
          });

          // Check if user has any staffDetails in allowed clinics
          const hasStaffDetailsInAllowedClinics = staffDetails.some(detail => 
            allowedClinics.has(String(detail.clinicId))
          );

          // Skip user only if they have NO visibility in ANY allowed clinic
          if (visibleGroups.length === 0 && !hasStaffDetailsInAllowedClinics) {
            continue;
          }

          // Use visible groups for response
          groupNames = visibleGroups;
        }

        const { clinics, rolesByClinic, isSuperAdmin } = deriveClinicsFromGroups(groupNames);
        
        // Merge clinics from both Cognito groups and DynamoDB staffDetails
        const allClinicsSet = new Set<string>(clinics);
        staffDetails.forEach(detail => allClinicsSet.add(String(detail.clinicId)));
        const allClinics = Array.from(allClinicsSet);

        // Filter staffDetails to only show clinics the caller can see
        const visibleStaffDetails = allowedClinics 
          ? staffDetails.filter(detail => allowedClinics.has(String(detail.clinicId)))
          : staffDetails;

        items.push({
          username,
          email,
          givenName: String(attrs['given_name'] || ''),
          familyName: String(attrs['family_name'] || ''),
          groups: groupNames,
          clinics: allClinics,
          rolesByClinic,
          isSuperAdmin,
          staffDetails: visibleStaffDetails,
        });
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ items }) };
    }

    // GET /users/{username}
    if (event.httpMethod === "GET") {
      if (!pathUsername) return httpErr(400, "username required");
      
      const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const attrs: Record<string, string> = Object.fromEntries((user.UserAttributes || []).map((a: any) => [a.Name, a.Value]));
      const email = attrs['email']?.toLowerCase() || '';
      
      const groupsResp = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const groupNames = (groupsResp.Groups || []).map((g) => g.GroupName!).filter(Boolean) as string[];
      const { clinics, rolesByClinic, isSuperAdmin } = deriveClinicsFromGroups(groupNames);
      
      const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(email) : [];

      // Merge clinics from both sources
      const allClinicsSet = new Set<string>(clinics);
      staffDetails.forEach(detail => allClinicsSet.add(String(detail.clinicId)));
      const allClinics = Array.from(allClinicsSet);

      return httpOk({
        username: pathUsername,
        email,
        givenName: String(attrs['given_name'] || ''),
        familyName: String(attrs['family_name'] || ''),
        groups: groupNames,
        clinics: allClinics,
        rolesByClinic,
        isSuperAdmin,
        staffDetails,
      });
    }

    // PUT /users/{username}
    if (event.httpMethod === "PUT") {
      const body = parseBody(event.body) as PutUserBody;
      validatePutBody(body);

      // Authorization logic...
      if (body.makeGlobalSuperAdmin && !caller.isSuperAdmin) {
        return httpErr(403, "only super admin can grant GLOBAL__SUPER_ADMIN");
      }
      if (!body.makeGlobalSuperAdmin) {
        const clinics = Array.isArray(body.clinics) ? body.clinics : [];
        const authValidation = canAssignAll(clinics, caller);
        if (!authValidation.ok) {
          return httpErr(403, authValidation.message || "forbidden");
        }
      }

      // Update basic Cognito attributes
      const attribs: Array<{ Name: string; Value: string }> = [];
      if (body.givenName) attribs.push({ Name: "given_name", Value: String(body.givenName) });
      if (body.familyName) attribs.push({ Name: "family_name", Value: String(body.familyName) });
      if (attribs.length > 0) {
        await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId: userPoolId, Username: pathUsername, UserAttributes: attribs }));
      }

      // Get user email
      const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();

      if (!email) {
          return httpErr(404, "User email not found, cannot sync staff details");
      }
      
      // FIX: Use body.openDentalPerClinic if available, falling back to staffDetails
      const staffDetailsToSync = body.openDentalPerClinic ?? body.staffDetails;

      if (STAFF_INFO_TABLE && staffDetailsToSync) { 
          await syncStaffInfoInDynamoDB(email, staffDetailsToSync);
      }

      // Sync Cognito groups
      const desiredGroups = body.makeGlobalSuperAdmin ? ["GLOBAL__SUPER_ADMIN"] : buildGroupNames(Array.isArray(body.clinics) ? body.clinics : []);
      const currentGroupsResp = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      const currentGroups = (currentGroupsResp.Groups || []).map((g) => g.GroupName!).filter(Boolean) as string[];

      const managed = new Set<string>(["GLOBAL__SUPER_ADMIN", ...currentGroups.filter((g) => g.startsWith("clinic_"))]);
      const toRemove = Array.from(managed).filter((g) => !desiredGroups.includes(g));
      const toAdd = desiredGroups.filter((g) => !currentGroups.includes(g));

      for (const g of toRemove) await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: pathUsername, GroupName: g }));
      for (const g of toAdd) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: pathUsername, GroupName: g }));

      return httpOk({
        username: pathUsername,
        groupsAssigned: desiredGroups
      });
    }

    // DELETE /users/{username}
    if (event.httpMethod === "DELETE") {
      
      // Get user email before deleting from Cognito
      let email: string | undefined;
      try {
        const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
        email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();
      } catch (e) {
        console.warn(`Could not find user ${pathUsername} to get email, may not be able to clean up DDB`, e);
      }

      // Delete from Cognito
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: pathUsername }));
      
      // Delete from DynamoDB using the email
      const deletedStaffInfo = (STAFF_INFO_TABLE && email) 
        ? await deleteStaffInfoFromDynamoDB(email)
        : { deleted: 0, enabled: false };

      return httpOk({ username: pathUsername, deleted: true, staffInfo: deletedStaffInfo });
    }

    return httpErr(405, "method not allowed");
  } catch (err: any) {
    return httpErr(500, err?.message || "internal error");
  }
};


// ========================================
// DYNAMODB HELPER FUNCTIONS
// ========================================

async function getStaffInfoFromDynamoDB(email: string): Promise<StaffClinicDetail[]> {
    if (!STAFF_INFO_TABLE) return [];
    if (!email) return [];
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: STAFF_INFO_TABLE,
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': email.toLowerCase() }
        }));
        return (result.Items || []) as StaffClinicDetail[];
    } catch (error) {
        console.error(`Failed to get staff info for ${email}:`, error);
        return [];
    }
}

async function syncStaffInfoInDynamoDB(email: string, details: StaffClinicDetail[]) {
    if (!STAFF_INFO_TABLE) return;
    const existingItems = await getStaffInfoFromDynamoDB(email);
    const desiredClinicIds = new Set(details.map(item => String(item.clinicId)));

    const writeRequests: { PutRequest?: any; DeleteRequest?: any; }[] = [];

    // Add PutRequests for all details in the request body (creates or updates)
    for (const detail of details) {
        if (!detail.clinicId) continue;
        writeRequests.push({
            PutRequest: {
                Item: {
                    ...detail,
                    email,
                    clinicId: String(detail.clinicId),
                    updatedAt: new Date().toISOString()
                }
            }
        });
    }

    // Add DeleteRequests for clinics no longer present in the request body
    for (const item of existingItems) {
        if (!desiredClinicIds.has(item.clinicId)) {
            writeRequests.push({
                DeleteRequest: { Key: { email, clinicId: item.clinicId } }
            });
        }
    }

    if (writeRequests.length === 0) return;

    // Execute in batches
    for (let i = 0; i < writeRequests.length; i += 25) {
        const batch = writeRequests.slice(i, i + 25);
        await ddb.send(new BatchWriteCommand({
            RequestItems: { [STAFF_INFO_TABLE]: batch }
        }));
    }
}

async function deleteStaffInfoFromDynamoDB(email: string): Promise<Record<string, any>> {
    if (!STAFF_INFO_TABLE) return { deleted: 0, enabled: false };
    const itemsToDelete = await getStaffInfoFromDynamoDB(email);
    if (itemsToDelete.length === 0) return { deleted: 0 };

    const deleteRequests = itemsToDelete.map(item => ({
        DeleteRequest: { Key: { email, clinicId: item.clinicId } }
    }));

    for (let i = 0; i < deleteRequests.length; i += 25) {
        const batch = deleteRequests.slice(i, i + 25);
        await ddb.send(new BatchWriteCommand({
            RequestItems: { [STAFF_INFO_TABLE]: batch }
        }));
    }
    return { deleted: itemsToDelete.length };
}


// ========================================
// HELPER FUNCTIONS
// ========================================

function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try { return typeof body === "string" ? JSON.parse(body) : body; } catch { return {}; }
}

function validatePutBody(body: PutUserBody) {
  if (body.makeGlobalSuperAdmin) return;
  const allowedRoles = new Set([
    "SUPER_ADMIN", "ADMIN", "PROVIDER", "MARKETING", "USER",
    "DOCTOR", "HYGIENIST", "DENTAL_ASSISTANT", "TRAINEE", "PATIENT_COORDINATOR"
  ]);
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
    case "DOCTOR": return "D";
    case "HYGIENIST": return "H";
    case "DENTAL_ASSISTANT": return "DA";
    case "TRAINEE": return "TC";
    case "PATIENT_COORDINATOR": return "PC";
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
    const existing = rolesByClinic[clinicId];
    const order: Record<string, number> = { S: 5, A: 4, P: 3, D: 3, H: 2, DA: 2, TC: 2, PC: 2, M: 1, U: 0 };
    if (existing === undefined || order[code] > (order[existing] ?? -1)) {
      rolesByClinic[clinicId] = code;
    }
  }
  return { clinics: Object.keys(rolesByClinic), rolesByClinic, isSuperAdmin };
}
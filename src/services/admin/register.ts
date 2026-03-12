/**
 * Admin API: Register user endpoint
 * Creates users in DynamoDB StaffUser table with role assignments
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { hashPassword } from '../../shared/utils/jwt';
import { StaffUser, UserRole, USER_ROLES, ModuleAccess, SYSTEM_MODULES, MODULE_PERMISSIONS, WorkLocation, UserEmailCredentials } from '../../shared/types/user';
import { createEmailAccount, getEmailCredentials } from '../../shared/utils/cpanel-email';
import {
  getUserPermissions,
  isAdminUser,
  getAllowedClinicIds,
  hasClinicAccess,
} from '../../shared/utils/permissions-helper';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true, // Remove undefined values from objects
  },
});

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';

// Type definitions
type RegisterModuleAccess = {
  module: string;
  permissions: string[]; // ['read', 'write', 'put', 'delete']
};

type RegisterClinic = {
  clinicId: string | number;
  role: string; // REQUIRED - per-clinic role assignment
  basePay?: number; // Annual base pay in dollars
  workLocation?: WorkLocation; // Remote/on-premise configuration
  hourlyPay?: number; // Hourly pay rate in dollars
  moduleAccess?: RegisterModuleAccess[]; // Optional - module-level permissions

  // Claims role fee fields
  perClaimFeeOpenDental?: number;
  perClaimFeePortal?: number;
  perPreAuthFee?: number;

  // Payment Posting role fee fields
  perClaimsPostedAmount?: number; // Per Claims Posted Amount
  perEobsAttachedAmount?: number; // Per EOB's Attached Amount
  statusDeniedAmount?: number; // Status Denied Amount
};

type RegisterBody = {
  email: string;
  password?: string; // Optional - for backward compatibility with password-based auth
  givenName?: string;
  familyName?: string;
  clinics: RegisterClinic[]; // Per-clinic role assignments
  makeGlobalSuperAdmin?: boolean;
};

/**
 * Main handler for user registration
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Get caller context from custom authorizer using shared permissions-helper
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return httpErr(401, 'Unauthorized', corsHeaders);
    }

    // Check if caller has admin privileges using shared helper
    if (!isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
      return httpErr(403, 'forbidden: admin or super admin required', corsHeaders);
    }

    // For backward compatibility, extract these values
    const callerIsGlobalSuperAdmin = userPerms.isGlobalSuperAdmin;
    const callerIsSuperAdmin = userPerms.isSuperAdmin;
    const callerClinicRoles = userPerms.clinicRoles;
    const allowedClinics = getAllowedClinicIds(callerClinicRoles, callerIsSuperAdmin, callerIsGlobalSuperAdmin);

    // Parse request body
    const body = parseBody(event.body) as RegisterBody;

    try {
      validateBody(body);
    } catch (e: any) {
      return httpErr(400, e?.message || 'invalid body', corsHeaders);
    }

    // Only global super admin can create other global super admins
    if (body.makeGlobalSuperAdmin && !callerIsGlobalSuperAdmin) {
      return httpErr(403, 'only global super admin can grant Global super admin role', corsHeaders);
    }

    // Admins (without SuperAdmin role) cannot assign SuperAdmin role to any clinic
    const callerHasSuperAdminRole = callerIsGlobalSuperAdmin || callerIsSuperAdmin ||
      callerClinicRoles.some((cr: any) => cr.role === 'SuperAdmin');
    if (!callerHasSuperAdminRole && body.clinics?.some(c => c.role === 'SuperAdmin')) {
      return httpErr(403, 'only super admin or above can assign the SuperAdmin role', corsHeaders);
    }

    // Validate clinic assignments
    if (!body.makeGlobalSuperAdmin) {
      const clinicIds = body.clinics.map(c => String(c.clinicId));

      // Non-global admins can only assign users to clinics they have access to
      if (!callerIsGlobalSuperAdmin && !callerIsSuperAdmin) {
        const unauthorizedClinics = clinicIds.filter(cid => !hasClinicAccess(allowedClinics, cid));
        if (unauthorizedClinics.length > 0) {
          return httpErr(403, `no admin access for clinics: ${unauthorizedClinics.join(', ')}`, corsHeaders);
        }
      }
    }

    // Sanitize inputs
    const username = body.email.trim().toLowerCase();
    const givenName = body.givenName?.trim();
    const familyName = body.familyName?.trim();

    // Check if user already exists
    const existingUser = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: username },
    }));

    if (existingUser.Item) {
      return httpErr(409, `User with email '${username}' already exists. Use the update endpoint to modify existing users.`, corsHeaders);
    }

    // Generate password hash only if password is provided (optional for OTP-only users)
    const passwordHash = body.password ? hashPassword(body.password) : undefined;

    // Create user email account on todaysdentalservices.com
    let userEmailCredentials: UserEmailCredentials | undefined;
    try {
      console.log(`[register] Creating email account for user: ${username}`);
      const emailResult = await createEmailAccount(username, givenName, familyName);

      if (emailResult.success && emailResult.email) {
        const creds = getEmailCredentials(emailResult.email);
        userEmailCredentials = {
          email: creds.email,
          password: creds.password,
          imapHost: creds.imapHost,
          imapPort: creds.imapPort,
          smtpHost: creds.smtpHost,
          smtpPort: creds.smtpPort,
          createdAt: new Date().toISOString(),
        };
        console.log(`[register] Successfully created email: ${emailResult.email}`);
      } else {
        console.warn(`[register] Failed to create email for ${username}: ${emailResult.error}`);
        // Continue with registration even if email creation fails
      }
    } catch (emailError: any) {
      console.error(`[register] Error creating email for ${username}:`, emailError?.message || emailError);
      // Continue with registration even if email creation fails
    }

    // Build per-clinic role assignments with module permissions
    const clinicRoles = body.makeGlobalSuperAdmin
      ? []
      : body.clinics.map(c => ({
        clinicId: String(c.clinicId),
        role: c.role as UserRole,
        basePay: c.basePay,
        workLocation: c.workLocation,
        hourlyPay: c.hourlyPay,
        moduleAccess: c.moduleAccess?.map(ma => ({
          module: ma.module,
          permissions: ma.permissions,
        })) as ModuleAccess[] | undefined,

        // Claims role fee fields
        perClaimFeeOpenDental: c.perClaimFeeOpenDental,
        perClaimFeePortal: c.perClaimFeePortal,
        perPreAuthFee: c.perPreAuthFee,

        // Payment Posting role fee fields
        perClaimsPostedAmount: c.perClaimsPostedAmount,
        perEobsAttachedAmount: c.perEobsAttachedAmount,
        statusDeniedAmount: c.statusDeniedAmount,
      }));

    // Check if user has SuperAdmin role at any clinic
    const hasSuperAdminRole = clinicRoles.some(cr => cr.role === 'SuperAdmin');

    // Create user in StaffUser table
    const newUser: StaffUser = {
      email: username,
      passwordHash,
      givenName: givenName || '',
      familyName: familyName || '',
      clinicRoles,
      isSuperAdmin: body.makeGlobalSuperAdmin || hasSuperAdminRole,
      isGlobalSuperAdmin: body.makeGlobalSuperAdmin || false,
      isActive: true,
      emailVerified: true, // Auto-verify for admin-created users
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Only include userEmail if it was successfully created (DynamoDB doesn't accept undefined)
      ...(userEmailCredentials ? { userEmail: userEmailCredentials } : {}),
    };

    await ddb.send(new PutCommand({
      TableName: STAFF_USER_TABLE,
      Item: newUser,
    }));

    return httpOk({
      username,
      email: username,
      clinicRoles,
      userEmail: userEmailCredentials?.email || null,
      message: userEmailCredentials
        ? `User created successfully with email ${userEmailCredentials.email}. They can now log in using OTP sent to their email.`
        : 'User created successfully. They can now log in using OTP sent to their email.',
    }, corsHeaders);
  } catch (err: any) {
    console.error('Registration error:', err);
    return httpErr(500, err?.message || 'registration failed', corsHeaders);
  }
};

/**
 * Parse request body
 */
function parseBody(body: any): Record<string, any> {
  if (!body) return {};
  try {
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return {};
  }
}

/**
 * Validate request body
 */
function validateBody(body: RegisterBody) {
  if (!body.email) {
    throw new Error('email is required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    throw new Error('invalid email format');
  }

  // Validate password complexity if password is provided
  if (body.password) {
    if (body.password.length < 8) {
      throw new Error('password must be at least 8 characters long');
    }
    if (!/[A-Z]/.test(body.password)) {
      throw new Error('password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(body.password)) {
      throw new Error('password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(body.password)) {
      throw new Error('password must contain at least one number');
    }
    if (!/[^A-Za-z0-9]/.test(body.password)) {
      throw new Error('password must contain at least one special character');
    }
    // Check for common weak passwords
    const weakPasswords = ['password', 'password123', '12345678', 'qwerty', 'abc123'];
    if (weakPasswords.includes(body.password.toLowerCase())) {
      throw new Error('password is too common, please choose a stronger password');
    }
  }

  const isGlobal = !!body.makeGlobalSuperAdmin;

  if (!isGlobal) {
    if (!Array.isArray(body.clinics) || body.clinics.length === 0) {
      throw new Error('clinics array is required for non-global users');
    }

    for (const c of body.clinics) {
      if (!c.clinicId) {
        throw new Error('clinicId is required for each clinic mapping');
      }
      if (!c.role) {
        throw new Error('role is required for each clinic mapping');
      }
      if (!USER_ROLES.includes(c.role as any)) {
        throw new Error(`invalid role: ${c.role}`);
      }

      // Validate module access if provided
      if (c.moduleAccess && Array.isArray(c.moduleAccess)) {
        for (const ma of c.moduleAccess) {
          if (!SYSTEM_MODULES.includes(ma.module as any)) {
            throw new Error(`invalid module: ${ma.module}. Valid modules: ${SYSTEM_MODULES.join(', ')}`);
          }
          if (!Array.isArray(ma.permissions)) {
            throw new Error(`permissions must be an array for module: ${ma.module}`);
          }
          for (const perm of ma.permissions) {
            if (!MODULE_PERMISSIONS.includes(perm as any)) {
              throw new Error(`invalid permission: ${perm}. Valid permissions: ${MODULE_PERMISSIONS.join(', ')}`);
            }
          }
        }
      }
    }
  }
}

/**
 * HTTP success response
 */
function httpOk(data: Record<string, any>, headers?: Record<string, string>) {
  return {
    statusCode: 200,
    headers: headers ?? buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }),
    body: JSON.stringify({ success: true, ...data }),
  };
}

/**
 * HTTP error response
 */
function httpErr(code: number, message: string, headers?: Record<string, string>) {
  return {
    statusCode: code,
    headers: headers ?? buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST'] }),
    body: JSON.stringify({ success: false, message }),
  };
}

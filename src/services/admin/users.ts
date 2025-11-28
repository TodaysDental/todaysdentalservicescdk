/**
 * Admin API: User management endpoints
 * Manages users in DynamoDB StaffUser table
 * 
 * Routes:
 * - GET /users - List all users (admin only)
 * - GET /users/self - Get current user info (authenticated users)
 * - GET /users/{username} - Get specific user (admin only)
 * - PUT /users/{username} - Update user (admin only)
 * - DELETE /users/{username} - Delete user (admin only)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, DeleteCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { StaffUser, UserRole, USER_ROLES, PublicStaffUser, ModuleAccess, SYSTEM_MODULES, MODULE_PERMISSIONS } from '../../shared/types/user';
import { hashPassword } from '../../shared/utils/jwt';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE;

type ModuleAccessInput = {
  module: string;
  permissions: string[];
};

type ClinicRoleAssignment = { 
  clinicId: string; 
  role: UserRole;
  moduleAccess?: ModuleAccessInput[];
};

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

type PutUserBody = {
  givenName?: string;
  familyName?: string;
  clinicRoles?: ClinicRoleAssignment[]; // Per-clinic role assignments
  makeGlobalSuperAdmin?: boolean;
  isActive?: boolean;
  password?: string;
  staffDetails?: StaffClinicDetail[];
  openDentalPerClinic?: StaffClinicDetail[];
};

/**
 * Main handler for user management
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'PUT', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Get caller context from custom authorizer
    const callerEmail = event.requestContext.authorizer?.email || '';
    const callerClinicRoles = JSON.parse(event.requestContext.authorizer?.clinicRoles || '[]');
    const callerIsSuperAdmin = event.requestContext.authorizer?.isSuperAdmin === 'true';
    const callerIsGlobalSuperAdmin = event.requestContext.authorizer?.isGlobalSuperAdmin === 'true';
    
    // Extract caller's clinics for authorization checks
    const callerClinics = callerClinicRoles.map((cr: any) => cr.clinicId);

    const pathUsernameRaw = String(event?.pathParameters?.username || '');
    const pathUsername = pathUsernameRaw ? decodeURIComponent(pathUsernameRaw).trim().toLowerCase() : '';

    // ==================================================================
    // 1. GET /users/self - Get current user info (any authenticated user)
    // ==================================================================
    const isSelfRequest = (
      String(event.path || '').endsWith('/users/self') || 
      String(event.resource || '').endsWith('/users/self') ||
      pathUsername === 'self' 
    );

    if (event.httpMethod === 'GET' && isSelfRequest) {
      return await handleGetSelf(callerEmail);
    }

    // ==================================================================
    // 2. Admin gatekeeper - All other routes require admin privileges
    // ==================================================================
    const callerHasAdminRole = callerClinicRoles.some((cr: any) => 
      ['Admin', 'SuperAdmin'].includes(cr.role)
    );
    const isAdmin = callerIsGlobalSuperAdmin || callerIsSuperAdmin || callerHasAdminRole;

    if (!isAdmin) {
      return httpErr(403, 'forbidden: admin or super admin required');
    }

    // ==================================================================
    // 3. GET /users - List all users (admin only)
    // ==================================================================
    if (event.httpMethod === 'GET' && !pathUsername) {
      return await handleListUsers(callerIsGlobalSuperAdmin, callerIsSuperAdmin, callerClinics);
    }

    // ==================================================================
    // 4. GET /users/{username} - Get specific user (admin only)
    // ==================================================================
    if (event.httpMethod === 'GET' && pathUsername) {
      return await handleGetUser(pathUsername, callerIsGlobalSuperAdmin, callerIsSuperAdmin, callerClinics);
    }

    // ==================================================================
    // 5. PUT /users/{username} - Update user (admin only)
    // ==================================================================
    if (event.httpMethod === 'PUT' && pathUsername) {
      const body = parseBody(event.body) as PutUserBody;
      return await handleUpdateUser(pathUsername, body, callerIsGlobalSuperAdmin, callerIsSuperAdmin, callerClinics);
    }

    // ==================================================================
    // 6. DELETE /users/{username} - Delete user (admin only)
    // ==================================================================
    if (event.httpMethod === 'DELETE' && pathUsername) {
      return await handleDeleteUser(pathUsername, callerIsGlobalSuperAdmin, callerIsSuperAdmin, callerClinics);
    }

    return httpErr(404, 'route not found');
  } catch (err: any) {
    console.error('Error in users handler:', err);
    return httpErr(500, err?.message || 'internal server error');
  }
};

/**
 * Handle GET /users/self
 */
async function handleGetSelf(email: string): Promise<APIGatewayProxyResult> {
  const result = await ddb.send(new GetCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email },
  }));

  const user = result.Item as StaffUser | undefined;

  if (!user) {
    return httpErr(404, 'user not found');
  }

  // Get staff clinic info
  const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(email) : [];

  const publicUser = toPublicUser(user);

  return httpOk({
    ...publicUser,
    staffDetails,
    rolesByClinic: buildRolesByClinic(staffDetails),
  });
}

/**
 * Handle GET /users - List all users
 */
async function handleListUsers(
  isGlobalSuperAdmin: boolean,
  isSuperAdmin: boolean,
  callerClinics: string[]
): Promise<APIGatewayProxyResult> {
  // Scan all users
  const result = await ddb.send(new ScanCommand({
    TableName: STAFF_USER_TABLE,
  }));

  const users = (result.Items || []) as StaffUser[];

  // Filter users based on caller's permissions
  const allowedClinics = isGlobalSuperAdmin || isSuperAdmin 
    ? undefined 
    : new Set(callerClinics);

  const items: Array<Record<string, any>> = [];

  for (const user of users) {
    // Get staff clinic info
    const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(user.email) : [];

    // Filter based on clinic access
    if (allowedClinics) {
      // Non-global admins can only see users in their clinics
      const userClinicIds = user.clinicRoles.map(cr => cr.clinicId);
      const hasAccessToUserClinics = userClinicIds.some(c => allowedClinics.has(c));
      const hasAccessToStaffDetails = staffDetails.some(d => allowedClinics.has(String(d.clinicId)));

      if (!hasAccessToUserClinics && !hasAccessToStaffDetails) {
        continue; // Skip this user
      }

      // Filter staff details to only show allowed clinics
      const filteredStaffDetails = staffDetails.filter(d => allowedClinics.has(String(d.clinicId)));

      items.push({
        ...toPublicUser(user),
        staffDetails: filteredStaffDetails,
        rolesByClinic: buildRolesByClinic(filteredStaffDetails),
      });
    } else {
      // Super admins see everything
      items.push({
        ...toPublicUser(user),
        staffDetails,
        rolesByClinic: buildRolesByClinic(staffDetails),
      });
    }
  }

  return httpOk({ users: items });
}

/**
 * Handle GET /users/{username}
 */
async function handleGetUser(
  username: string,
  isGlobalSuperAdmin: boolean,
  isSuperAdmin: boolean,
  callerClinics: string[]
): Promise<APIGatewayProxyResult> {
  const result = await ddb.send(new GetCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email: username },
  }));

  const user = result.Item as StaffUser | undefined;

  if (!user) {
    return httpErr(404, 'user not found');
  }

  // Check if caller has permission to view this user
  if (!isGlobalSuperAdmin && !isSuperAdmin) {
    const userClinicIds = user.clinicRoles.map(cr => cr.clinicId);
    const hasAccessToUserClinics = userClinicIds.some(c => callerClinics.includes(c));
    if (!hasAccessToUserClinics) {
      return httpErr(403, 'no access to this user');
    }
  }

  // Get staff clinic info
  const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(user.email) : [];

  // Filter staff details based on caller's clinic access
  const allowedClinics = isGlobalSuperAdmin || isSuperAdmin
    ? undefined
    : new Set(callerClinics);

  const filteredStaffDetails = allowedClinics
    ? staffDetails.filter(d => allowedClinics.has(String(d.clinicId)))
    : staffDetails;

  return httpOk({
    ...toPublicUser(user),
    staffDetails: filteredStaffDetails,
    rolesByClinic: buildRolesByClinic(filteredStaffDetails),
  });
}

/**
 * Handle PUT /users/{username}
 */
async function handleUpdateUser(
  username: string,
  body: PutUserBody,
  isGlobalSuperAdmin: boolean,
  isSuperAdmin: boolean,
  callerClinics: string[]
): Promise<APIGatewayProxyResult> {
  // Get existing user
  const result = await ddb.send(new GetCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email: username },
  }));

  const existingUser = result.Item as StaffUser | undefined;

  if (!existingUser) {
    return httpErr(404, 'user not found');
  }

  // Check permissions
  if (body.makeGlobalSuperAdmin && !isGlobalSuperAdmin) {
    return httpErr(403, 'only global super admin can grant Global super admin role');
  }

  // Non-global admins can only update users in their clinics
  if (!isGlobalSuperAdmin && !isSuperAdmin) {
    const existingUserClinicIds = existingUser.clinicRoles.map(cr => cr.clinicId);
    const hasAccessToUserClinics = existingUserClinicIds.some(c => callerClinics.includes(c));
    if (!hasAccessToUserClinics) {
      return httpErr(403, 'no access to update this user');
    }

    // Check if trying to assign to clinics they don't have access to
    if (body.clinicRoles) {
      const newClinicIds = body.clinicRoles.map(cr => cr.clinicId);
      const unauthorizedClinics = newClinicIds.filter(c => !callerClinics.includes(c));
      if (unauthorizedClinics.length > 0) {
        return httpErr(403, `no admin access for clinics: ${unauthorizedClinics.join(', ')}`);
      }
    }
  }

  // Build updated user object
  const updatedUser: StaffUser = {
    ...existingUser,
    ...(body.givenName !== undefined && { givenName: body.givenName }),
    ...(body.familyName !== undefined && { familyName: body.familyName }),
    ...(body.clinicRoles !== undefined && { clinicRoles: body.clinicRoles }),
    ...(body.isActive !== undefined && { isActive: body.isActive }),
    ...(body.makeGlobalSuperAdmin !== undefined && { 
      isGlobalSuperAdmin: body.makeGlobalSuperAdmin,
      isSuperAdmin: body.makeGlobalSuperAdmin || existingUser.isSuperAdmin,
    }),
    ...(body.password && { passwordHash: hashPassword(body.password) }),
    updatedAt: new Date().toISOString(),
  };

  // Save updated user
  await ddb.send(new PutCommand({
    TableName: STAFF_USER_TABLE,
    Item: updatedUser,
  }));

  // Update staff clinic info if provided
  if (STAFF_INFO_TABLE && (body.staffDetails || body.openDentalPerClinic)) {
    const detailsToSave = body.openDentalPerClinic || body.staffDetails || [];
    
    // First, delete existing staff info
    await deleteStaffInfoFromDynamoDB(username);
    
    // Then save new staff info
    await saveStaffInfoToDynamoDB(username, detailsToSave);
  }

  // Get updated staff details
  const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(username) : [];

  return httpOk({
    ...toPublicUser(updatedUser),
    staffDetails,
    rolesByClinic: buildRolesByClinic(staffDetails),
  });
}

/**
 * Handle DELETE /users/{username}
 */
async function handleDeleteUser(
  username: string,
  isGlobalSuperAdmin: boolean,
  isSuperAdmin: boolean,
  callerClinics: string[]
): Promise<APIGatewayProxyResult> {
  // Get existing user
  const result = await ddb.send(new GetCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email: username },
  }));

  const existingUser = result.Item as StaffUser | undefined;

  if (!existingUser) {
    return httpErr(404, 'user not found');
  }

  // Check permissions
  if (existingUser.isGlobalSuperAdmin && !isGlobalSuperAdmin) {
    return httpErr(403, 'only global super admin can delete global super admin users');
  }

  // Non-global admins can only delete users in their clinics
  if (!isGlobalSuperAdmin && !isSuperAdmin) {
    const existingUserClinicIds = existingUser.clinicRoles.map(cr => cr.clinicId);
    const hasAccessToUserClinics = existingUserClinicIds.some(c => callerClinics.includes(c));
    if (!hasAccessToUserClinics) {
      return httpErr(403, 'no access to delete this user');
    }
  }

  // Delete user from StaffUser table
  await ddb.send(new DeleteCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email: username },
  }));

  // Delete associated staff info
  if (STAFF_INFO_TABLE) {
    await deleteStaffInfoFromDynamoDB(username);
  }

  return httpOk({ message: 'user deleted successfully', email: username });
}

/**
 * Get staff clinic information from DynamoDB
 */
async function getStaffInfoFromDynamoDB(email: string): Promise<StaffClinicDetail[]> {
  if (!STAFF_INFO_TABLE) return [];

  try {
    const result = await ddb.send(new QueryCommand({
      TableName: STAFF_INFO_TABLE,
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email.toLowerCase(),
      },
    }));

    return (result.Items || []) as StaffClinicDetail[];
  } catch (err) {
    console.error(`Failed to get staff info for ${email}:`, err);
    return [];
  }
}

/**
 * Save staff clinic information to DynamoDB
 */
async function saveStaffInfoToDynamoDB(
  email: string,
  details: StaffClinicDetail[]
): Promise<void> {
  if (!STAFF_INFO_TABLE || !details.length) return;

  for (const detail of details) {
    if (!detail.clinicId) continue;

    const item = {
      ...detail,
      email: email.toLowerCase(),
      clinicId: String(detail.clinicId),
      updatedAt: new Date().toISOString(),
    };

    try {
      await ddb.send(new PutCommand({
        TableName: STAFF_INFO_TABLE,
        Item: item,
      }));
    } catch (err) {
      console.error(`Failed to save staff info for ${email} at clinic ${detail.clinicId}:`, err);
    }
  }
}

/**
 * Delete staff clinic information from DynamoDB
 */
async function deleteStaffInfoFromDynamoDB(email: string): Promise<void> {
  if (!STAFF_INFO_TABLE) return;

  try {
    // First, query all items for this email
    const result = await ddb.send(new QueryCommand({
      TableName: STAFF_INFO_TABLE,
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email.toLowerCase(),
      },
    }));

    const items = result.Items || [];

    if (items.length === 0) return;

    // Delete in batches of 25 (DynamoDB limit)
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);

      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [STAFF_INFO_TABLE]: batch.map(item => ({
            DeleteRequest: {
              Key: {
                email: item.email,
                clinicId: item.clinicId,
              },
            },
          })),
        },
      }));
    }
  } catch (err) {
    console.error(`Failed to delete staff info for ${email}:`, err);
  }
}

/**
 * Convert StaffUser to PublicStaffUser (remove sensitive fields)
 */
function toPublicUser(user: StaffUser): PublicStaffUser {
  return {
    email: user.email,
    givenName: user.givenName,
    familyName: user.familyName,
    roles: user.roles,
    clinics: user.clinics,
    isSuperAdmin: user.isSuperAdmin,
    isGlobalSuperAdmin: user.isGlobalSuperAdmin,
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * Build rolesByClinic map from staff details
 */
function buildRolesByClinic(staffDetails: StaffClinicDetail[]): Record<string, string> {
  const rolesByClinic: Record<string, string> = {};

  for (const detail of staffDetails) {
    if (detail.clinicId) {
      // You can add role logic here based on staff details
      // For now, we just mark that they have access to this clinic
      rolesByClinic[String(detail.clinicId)] = 'USER';
    }
  }

  return rolesByClinic;
}

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
 * HTTP success response
 */
function httpOk(data: Record<string, any>) {
  return {
    statusCode: 200,
    headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'PUT', 'DELETE'] }),
    body: JSON.stringify({ success: true, ...data }),
  };
}

/**
 * HTTP error response
 */
function httpErr(code: number, message: string) {
  return {
    statusCode: code,
    headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'PUT', 'DELETE'] }),
    body: JSON.stringify({ success: false, message }),
  };
}

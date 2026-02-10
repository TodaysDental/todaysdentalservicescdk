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
import { StaffUser, UserRole, USER_ROLES, PublicStaffUser, ModuleAccess, SYSTEM_MODULES, MODULE_PERMISSIONS, ClinicRoleAssignment as ClinicRoleAssignmentType, WorkLocation } from '../../shared/types/user';
import { hashPassword } from '../../shared/utils/jwt';
import {
  getUserPermissions,
  isAdminUser,
  getAllowedClinicIds,
  hasClinicAccess,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE;

type StaffClinicDetail = {
  clinicId: string;
  UserNum?: number;
  UserName?: string;
  userGroupNums?: number[];
  EmployeeNum?: number;
  employeeName?: string;
  ProviderNum?: number;
  providerName?: string;
  ClinicNum?: number;
  emailAddress?: string;
  IsHidden?: boolean;
  UserNumCEMT?: number;
  hourlyPay?: string | number;
};

type PutUserBody = {
  givenName?: string;
  familyName?: string;
  clinicRoles?: ClinicRoleAssignmentType[]; // Per-clinic role assignments
  makeGlobalSuperAdmin?: boolean;
  isActive?: boolean;
  password?: string;
  staffDetails?: StaffClinicDetail[];
  openDentalPerClinic?: StaffClinicDetail[];
};

// Module-level variable to hold request origin for response helpers
let requestOrigin: string | undefined;

/**
 * Main handler for user management
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Capture the request origin for use in response helpers
  requestOrigin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'PUT', 'DELETE'] }, requestOrigin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Get caller context from custom authorizer using shared permissions-helper
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return httpErr(401, 'Unauthorized');
    }

    const callerEmail = userPerms.email;
    const callerClinicRoles = userPerms.clinicRoles;
    const callerIsSuperAdmin = userPerms.isSuperAdmin;
    const callerIsGlobalSuperAdmin = userPerms.isGlobalSuperAdmin;

    // Get allowed clinics using shared helper
    const allowedClinics = getAllowedClinicIds(callerClinicRoles, callerIsSuperAdmin, callerIsGlobalSuperAdmin);

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
    // 2. GET /users - List all users (any authenticated user)
    // Supports optional:
    // - ?clinicId=X   (single clinic minimal response)
    // - ?clinicIds=a,b,c (multi-clinic minimal response; scan once)
    // ==================================================================
    if (event.httpMethod === 'GET' && !pathUsername) {
      const filterClinicId = event.queryStringParameters?.clinicId;
      const filterClinicIdsRaw = event.queryStringParameters?.clinicIds;
      const filterClinicIds = filterClinicIdsRaw
        ? filterClinicIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
        : undefined;

      return await handleListUsers(
        callerIsGlobalSuperAdmin,
        callerIsSuperAdmin,
        allowedClinics,
        filterClinicId,
        filterClinicIds
      );
    }

    // ==================================================================
    // 3. Admin gatekeeper - All other routes require admin privileges
    // ==================================================================
    const isAdmin = isAdminUser(callerClinicRoles, callerIsSuperAdmin, callerIsGlobalSuperAdmin);

    if (!isAdmin) {
      return httpErr(403, 'forbidden: admin or super admin required');
    }

    // ==================================================================
    // 4. GET /users/{username} - Get specific user (admin only)
    // ==================================================================
    if (event.httpMethod === 'GET' && pathUsername) {
      return await handleGetUser(pathUsername, callerIsGlobalSuperAdmin, callerIsSuperAdmin, allowedClinics);
    }

    // ==================================================================
    // 5. PUT /users/{username} - Update user (admin only)
    // ==================================================================
    if (event.httpMethod === 'PUT' && pathUsername) {
      const body = parseBody(event.body) as PutUserBody;
      return await handleUpdateUser(pathUsername, body, callerIsGlobalSuperAdmin, callerIsSuperAdmin, allowedClinics);
    }

    // ==================================================================
    // 6. DELETE /users/{username} - Delete user (admin only)
    // ==================================================================
    if (event.httpMethod === 'DELETE' && pathUsername) {
      return await handleDeleteUser(pathUsername, callerIsGlobalSuperAdmin, callerIsSuperAdmin, allowedClinics);
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
    rolesByClinic: buildRolesByClinicFromUser(user, staffDetails),
  });
}

/**
 * Handle GET /users - List all users
 * Supports optional query param ?clinicId=X to filter and return minimal payload
 */
async function handleListUsers(
  isGlobalSuperAdmin: boolean,
  isSuperAdmin: boolean,
  allowedClinics: Set<string>,
  filterClinicId?: string,
  filterClinicIds?: string[]
): Promise<APIGatewayProxyResult> {
  const hasAllAccess = allowedClinics.has('*');

  const normalizedClinicIds = (filterClinicIds || [])
    .map((id) => String(id).trim())
    .filter(Boolean);

  // If both clinicId and clinicIds are provided, prefer clinicIds
  const useClinicIds = normalizedClinicIds.length > 0;
  const isFilteredRequest = Boolean(filterClinicId) || useClinicIds;

  // Scan all users (projection to reduce payload)
  const projectionExpression = isFilteredRequest
    ? 'email, givenName, familyName, isActive, clinicRoles, isSuperAdmin, isGlobalSuperAdmin'
    : 'email, givenName, familyName, clinicRoles, isSuperAdmin, isGlobalSuperAdmin, isActive, emailVerified, lastLoginAt, createdAt';

  const result = await ddb.send(new ScanCommand({
    TableName: STAFF_USER_TABLE,
    ProjectionExpression: projectionExpression,
  }));

  const users = (result.Items || []) as StaffUser[];

  // ==========================================
  // FILTERED PATH: ?clinicIds=a,b,c (minimal)
  // ==========================================
  if (useClinicIds) {
    const requestedClinicIds = Array.from(new Set(normalizedClinicIds));

    // Verify caller has access to every requested clinic
    if (!hasAllAccess) {
      const unauthorized = requestedClinicIds.filter((id) => !hasClinicAccess(allowedClinics, id));
      if (unauthorized.length > 0) {
        return httpErr(403, `no access to clinics: ${unauthorized.join(', ')}`);
      }
    }

    const requestedSet = new Set(requestedClinicIds);
    const items: Array<Record<string, any>> = [];

    for (const user of users) {
      const matchingClinicRoles = (user.clinicRoles || []).filter((cr: any) =>
        requestedSet.has(String(cr?.clinicId))
      );

      if (matchingClinicRoles.length === 0) {
        continue; // User doesn't belong to any requested clinic
      }

      items.push({
        email: user.email,
        givenName: user.givenName,
        familyName: user.familyName,
        isActive: user.isActive,
        // Return only clinic roles relevant to requested clinics
        clinicRoles: matchingClinicRoles.map((cr: any) => ({
          clinicId: String(cr.clinicId),
          role: cr.role,
          hourlyPay: cr.hourlyPay,
          basePay: cr.basePay,
          workLocation: cr.workLocation,
          UserNum: cr.UserNum,
          UserName: cr.UserName,
          EmployeeNum: cr.EmployeeNum,
          employeeName: cr.employeeName,
          ProviderNum: cr.ProviderNum,
          providerName: cr.providerName,
        })),
      });
    }

    return httpOk({ users: items, filtered: true, clinicIds: requestedClinicIds });
  }

  // If filtering by clinic, we return a minimal payload (no staffDetails fetch needed for list view)
  if (filterClinicId) {
    // Verify caller has access to this clinic
    if (!hasAllAccess && !hasClinicAccess(allowedClinics, filterClinicId)) {
      return httpErr(403, 'no access to this clinic');
    }

    const items: Array<Record<string, any>> = [];

    for (const user of users) {
      // Find if user has assignment for this clinic
      const clinicRole = user.clinicRoles?.find(cr => cr.clinicId === filterClinicId);
      if (!clinicRole) {
        continue; // User doesn't belong to this clinic
      }

      // Return minimal payload for list view - no staffDetails needed
      items.push({
        email: user.email,
        givenName: user.givenName,
        familyName: user.familyName,
        isActive: user.isActive,
        // Include only the relevant clinic role info
        clinicRole: {
          clinicId: clinicRole.clinicId,
          role: clinicRole.role,
          hourlyPay: clinicRole.hourlyPay,
          basePay: clinicRole.basePay,
          workLocation: clinicRole.workLocation,
          UserNum: clinicRole.UserNum,
          UserName: clinicRole.UserName,
          EmployeeNum: clinicRole.EmployeeNum,
          employeeName: clinicRole.employeeName,
          ProviderNum: clinicRole.ProviderNum,
          providerName: clinicRole.providerName,
        },
      });
    }

    return httpOk({ users: items, filtered: true, clinicId: filterClinicId });
  }

  // FULL PAYLOAD PATH: When no clinicId filter, return full details (for user edit modal, etc.)
  // PERFORMANCE FIX: Fetch all staff details in parallel instead of sequentially
  const staffDetailsMap = new Map<string, StaffClinicDetail[]>();

  if (STAFF_INFO_TABLE && users.length > 0) {
    const staffDetailPromises = users.map(async (user) => {
      const details = await getStaffInfoFromDynamoDB(user.email);
      return { email: user.email, details };
    });

    const allStaffDetails = await Promise.all(staffDetailPromises);
    for (const { email, details } of allStaffDetails) {
      staffDetailsMap.set(email, details);
    }
  }

  const items: Array<Record<string, any>> = [];

  for (const user of users) {
    // Get staff clinic info from pre-fetched map
    const staffDetails = staffDetailsMap.get(user.email) || [];

    // Filter based on clinic access
    if (hasAllAccess) {
      // Super admins see everything
      items.push({
        ...toPublicUser(user),
        staffDetails,
        rolesByClinic: buildRolesByClinicFromUser(user, staffDetails),
      });
    } else {
      // Non-global admins can only see users in their clinics
      const userClinicIds = user.clinicRoles.map(cr => cr.clinicId);
      const hasAccessToUserClinics = userClinicIds.some(c => hasClinicAccess(allowedClinics, c));
      const hasAccessToStaffDetails = staffDetails.some(d => hasClinicAccess(allowedClinics, String(d.clinicId)));

      if (!hasAccessToUserClinics && !hasAccessToStaffDetails) {
        continue; // Skip this user
      }

      // Filter staff details to only show allowed clinics
      const filteredStaffDetails = staffDetails.filter(d => hasClinicAccess(allowedClinics, String(d.clinicId)));

      items.push({
        ...toPublicUser(user),
        staffDetails: filteredStaffDetails,
        rolesByClinic: buildRolesByClinicFromUser(user, filteredStaffDetails),
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
  allowedClinics: Set<string>
): Promise<APIGatewayProxyResult> {
  const result = await ddb.send(new GetCommand({
    TableName: STAFF_USER_TABLE,
    Key: { email: username },
  }));

  const user = result.Item as StaffUser | undefined;

  if (!user) {
    return httpErr(404, 'user not found');
  }

  const hasAllAccess = allowedClinics.has('*');

  // Check if caller has permission to view this user
  if (!hasAllAccess) {
    const userClinicIds = user.clinicRoles.map(cr => cr.clinicId);
    const hasAccessToUserClinics = userClinicIds.some(c => hasClinicAccess(allowedClinics, c));
    if (!hasAccessToUserClinics) {
      return httpErr(403, 'no access to this user');
    }
  }

  // Get staff clinic info
  const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(user.email) : [];

  // Filter staff details based on caller's clinic access
  const filteredStaffDetails = hasAllAccess
    ? staffDetails
    : staffDetails.filter(d => hasClinicAccess(allowedClinics, String(d.clinicId)));

  return httpOk({
    ...toPublicUser(user),
    staffDetails: filteredStaffDetails,
    rolesByClinic: buildRolesByClinicFromUser(user, filteredStaffDetails),
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
  allowedClinics: Set<string>
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

  const hasAllAccess = allowedClinics.has('*');

  // Check permissions
  if (body.makeGlobalSuperAdmin && !isGlobalSuperAdmin) {
    return httpErr(403, 'only global super admin can grant Global super admin role');
  }

  // Non-global admins can only update users in their clinics
  if (!hasAllAccess) {
    const existingUserClinicIds = existingUser.clinicRoles.map(cr => cr.clinicId);
    const hasAccessToUserClinics = existingUserClinicIds.some(c => hasClinicAccess(allowedClinics, c));
    if (!hasAccessToUserClinics) {
      return httpErr(403, 'no access to update this user');
    }

    // Check if trying to assign to clinics they don't have access to
    if (body.clinicRoles) {
      const newClinicIds = body.clinicRoles.map(cr => cr.clinicId);
      const unauthorizedClinics = newClinicIds.filter(c => !hasClinicAccess(allowedClinics, c));
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

  // Update staff clinic info if staffDetails or openDentalPerClinic provided explicitly
  if (STAFF_INFO_TABLE && (body.staffDetails || body.openDentalPerClinic)) {
    const detailsToSave = body.openDentalPerClinic || body.staffDetails || [];

    // First, delete existing staff info
    await deleteStaffInfoFromDynamoDB(username);

    // Then save new staff info
    await saveStaffInfoToDynamoDB(username, detailsToSave);
  }

  // ALWAYS sync clinicRoles shared fields to StaffClinicInfo table.
  // This ensures hourlyPay, role, workLocation etc. stay in sync between
  // StaffUser.clinicRoles and StaffClinicInfo records.
  if (STAFF_INFO_TABLE && body.clinicRoles && Array.isArray(body.clinicRoles)) {
    const SHARED_FIELDS = [
      'hourlyPay', 'role', 'workLocation',
      'UserNum', 'UserName', 'EmployeeNum', 'employeeName',
      'ProviderNum', 'providerName', 'ClinicNum', 'emailAddress',
      'IsHidden', 'UserNumCEMT', 'userGroupNums', 'moduleAccess',
      'openDentalUserNum', 'openDentalUsername', 'employeeNum',
    ];

    for (const clinicRole of body.clinicRoles) {
      if (!clinicRole.clinicId) continue;

      // Build partial update with only the shared fields that are present
      const updateFields: Record<string, any> = {};
      for (const field of SHARED_FIELDS) {
        if ((clinicRole as any)[field] !== undefined) {
          updateFields[field] = (clinicRole as any)[field];
        }
      }

      // Skip if no shared fields to sync
      if (Object.keys(updateFields).length === 0) continue;

      try {
        // Get existing StaffClinicInfo record (if any)
        const existingResult = await ddb.send(new GetCommand({
          TableName: STAFF_INFO_TABLE!,
          Key: { email: username.toLowerCase(), clinicId: String(clinicRole.clinicId) },
        }));

        // Merge: existing record + updated shared fields
        const mergedItem = {
          ...(existingResult.Item || {}),
          ...updateFields,
          email: username.toLowerCase(),
          clinicId: String(clinicRole.clinicId),
          updatedAt: new Date().toISOString(),
        };

        await ddb.send(new PutCommand({
          TableName: STAFF_INFO_TABLE!,
          Item: mergedItem,
        }));

        console.log(`Synced clinicRole → StaffClinicInfo for ${username} at ${clinicRole.clinicId}, hourlyPay=${updateFields.hourlyPay}`);
      } catch (err) {
        console.error(`Failed to sync clinicRole to StaffClinicInfo for ${username} at ${clinicRole.clinicId}:`, err);
      }
    }
  }

  // Get updated staff details
  const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(username) : [];

  return httpOk({
    ...toPublicUser(updatedUser),
    staffDetails,
    rolesByClinic: buildRolesByClinicFromUser(updatedUser, staffDetails),
  });
}

/**
 * Handle DELETE /users/{username}
 */
async function handleDeleteUser(
  username: string,
  isGlobalSuperAdmin: boolean,
  isSuperAdmin: boolean,
  allowedClinics: Set<string>
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

  const hasAllAccess = allowedClinics.has('*');

  // Check permissions
  if (existingUser.isGlobalSuperAdmin && !isGlobalSuperAdmin) {
    return httpErr(403, 'only global super admin can delete global super admin users');
  }

  // Non-global admins can only delete users in their clinics
  if (!hasAllAccess) {
    const existingUserClinicIds = existingUser.clinicRoles.map(cr => cr.clinicId);
    const hasAccessToUserClinics = existingUserClinicIds.some(c => hasClinicAccess(allowedClinics, c));
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
    clinicRoles: user.clinicRoles,
    isSuperAdmin: user.isSuperAdmin,
    isGlobalSuperAdmin: user.isGlobalSuperAdmin,
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * Build rolesByClinic map from user clinicRoles and staff details
 */
function buildRolesByClinicFromUser(user: StaffUser, staffDetails: StaffClinicDetail[]): Record<string, string> {
  const rolesByClinic: Record<string, string> = {};

  // First, add roles from user's clinicRoles (primary source)
  if (user.clinicRoles && Array.isArray(user.clinicRoles)) {
    for (const cr of user.clinicRoles) {
      if (cr.clinicId && cr.role) {
        rolesByClinic[String(cr.clinicId)] = cr.role;
      }
    }
  }

  // Then, add any clinics from staffDetails that aren't already covered
  for (const detail of staffDetails) {
    if (detail.clinicId && !rolesByClinic[String(detail.clinicId)]) {
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
    headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'PUT', 'DELETE'] }, requestOrigin),
    body: JSON.stringify({ success: true, ...data }),
  };
}

/**
 * HTTP error response
 */
function httpErr(code: number, message: string) {
  return {
    statusCode: code,
    headers: buildCorsHeaders({ allowMethods: ['OPTIONS', 'GET', 'PUT', 'DELETE'] }, requestOrigin),
    body: JSON.stringify({ success: false, message }),
  };
}

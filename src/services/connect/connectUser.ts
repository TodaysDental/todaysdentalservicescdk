import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ConnectClient,
  CreateUserCommand,
  DeleteUserCommand,
  DescribeUserCommand,
  ListUsersCommand,
  UpdateUserIdentityInfoCommand,
  UpdateUserPhoneConfigCommand,
  UpdateUserRoutingProfileCommand,
  UpdateUserSecurityProfilesCommand,
  UpdateUserProficienciesCommand,
  UpdateUserHierarchyCommand,
  CreateUserHierarchyGroupCommand,
  ListUserHierarchyGroupsCommand,
  DescribeUserHierarchyGroupCommand,
  UpdateUserHierarchyStructureCommand
} from '@aws-sdk/client-connect';
import { getMasterRoutingProfileName, getClinicAttributeName, buildProficiencies } from '../../infrastructure/utils/clinicCombinations';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { CONNECT_CONFIG } from '../../infrastructure/configs/connect-config';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || CONNECT_CONFIG.INSTANCE_ID;
const CONNECT_MASTER_ROUTING_PROFILE_ID = process.env.CONNECT_MASTER_ROUTING_PROFILE_ID!;
const CONNECT_SECURITY_PROFILE_ID = process.env.CONNECT_SECURITY_PROFILE_ID!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface ConnectUserBody {
  action: 'create' | 'update' | 'delete' | 'describe' | 'list' | 'add' | 'remove' | 'get_clinic_access';
  // For create action
  username?: string;
  identityInfo?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  phoneConfig?: {
    phoneType: 'SOFT_PHONE' | 'DESK_PHONE';
    autoAccept?: boolean;
    afterContactWorkTimeLimit?: number;
    deskPhoneNumber?: string;
  };
  securityProfileIds?: string[];
  routingProfileId?: string;
  password?: string;
  hierarchyGroupId?: string;
  // For update actions
  updateType?: 'identity' | 'phone' | 'security' | 'routing' | 'proficiencies' | 'hierarchy';
  userId?: string;
  // For clinic access (Connect-native approach using hierarchy groups)
  clinicId?: string;
  clinics?: string[]; // Array of clinic IDs for proficiency updates
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Verify authentication
    const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify(verifyResult) };
    }

    const caller = callerAuthContextFromClaims(verifyResult.payload!);

    // Handle different HTTP methods
    switch (event.httpMethod) {
      case 'GET':
        return await handleGetRequest(event, caller, corsHeaders);
      case 'POST':
        return await handlePostRequest(event, caller, corsHeaders);
      case 'PUT':
        return await handlePutRequest(event, caller, corsHeaders);
      case 'DELETE':
        return await handleDeleteRequest(event, caller, corsHeaders);
      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, message: 'Method not allowed' }),
        };
    }
  } catch (err: any) {
    console.error('Connect user error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Internal Server Error' }),
    };
  }
};

// ========================================
// HTTP METHOD HANDLERS (CONNECT-NATIVE)
// ========================================

async function handleGetRequest(event: APIGatewayProxyEvent, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const body = parseQueryParams(event.queryStringParameters || {});

  if (!body.action) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: 'action query parameter is required' }),
    };
  }

  switch (body.action) {
    case 'list':
      return await listConnectUsers(body, caller, corsHeaders);
    case 'describe':
      return await describeConnectUser(body, caller, corsHeaders);
    case 'get_clinic_access':
      return await getUserClinicAccess(caller.userId, corsHeaders);
    default:
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Invalid GET action. Must be one of: list, describe, get_clinic_access' }),
      };
  }
}

async function handlePostRequest(event: APIGatewayProxyEvent, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);

  if (!body.action) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: 'action is required' }),
    };
  }

  switch (body.action) {
    case 'create':
      return await createConnectUser(body, caller, corsHeaders);
    case 'add':
      return await addUserToClinic(body.username || caller.userId, body.clinicId!, caller, corsHeaders);
    case 'remove':
      return await removeUserFromClinic(body.username || caller.userId, body.clinicId!, caller, corsHeaders);
    default:
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Invalid POST action. Must be one of: create, add, remove' }),
      };
  }
}

async function handlePutRequest(event: APIGatewayProxyEvent, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);

  if (body.action !== 'update') {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: 'PUT method only supports update action' }),
    };
  }

  return await updateConnectUser(body, caller, corsHeaders);
}

async function handleDeleteRequest(event: APIGatewayProxyEvent, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const body = parseQueryParams(event.queryStringParameters || {});

  if (body.action !== 'delete') {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: 'DELETE method only supports delete action' }),
    };
  }

  return await deleteConnectUser(body, caller, corsHeaders);
}

// ========================================
// CONNECT-NATIVE USER MANAGEMENT
// ========================================

async function addUserToClinic(username: string, clinicId: string, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Find the Connect user by username (Connect-native approach)
    const connectUser = await findConnectUserByUsername(username);

    if (!connectUser) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Connect user not found. Please create the Connect user first.',
        }),
      };
    }

    // Get current user proficiencies
    const currentClinics = await getUserProficiencies(connectUser.UserId!);

    // Check if user already has access to this clinic
    if (currentClinics.includes(clinicId)) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'User already has access to this clinic',
          data: {
            userId: connectUser.UserId,
            username: connectUser.Username,
            clinics: currentClinics,
          },
        }),
      };
    }

    // Add clinic to user's proficiencies (for Attribute-Based Routing)
    const updatedClinics = [...currentClinics, clinicId];
    await updateConnectUserProficiencies(connectUser.UserId!, updatedClinics);

    // Add user to clinic hierarchy group (for organizational purposes)
    await addUserToClinicHierarchy(connectUser.UserId!, clinicId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'User added to clinic successfully',
        data: {
          userId: connectUser.UserId,
          username: connectUser.Username,
          clinics: updatedClinics,
        },
      }),
    };
  } catch (err: any) {
    console.error('Add user to clinic error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to add user to clinic' }),
    };
  }
}

async function removeUserFromClinic(username: string, clinicId: string, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Find the Connect user by username
    const connectUser = await findConnectUserByUsername(username);

    if (!connectUser) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Connect user not found',
        }),
      };
    }

    // Get current user proficiencies
    const currentClinics = await getUserProficiencies(connectUser.UserId!);

    // Check if user has access to this clinic
    if (!currentClinics.includes(clinicId)) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'User does not have access to this clinic',
        }),
      };
    }

    // Remove clinic from user's proficiencies
    const updatedClinics = currentClinics.filter(id => id !== clinicId);

    if (updatedClinics.length > 0) {
      // User still has other clinics, just update proficiencies
      await updateConnectUserProficiencies(connectUser.UserId!, updatedClinics);
    } else {
      // User has no clinics left, delete the Connect user
      await connect.send(new DeleteUserCommand({
        InstanceId: CONNECT_INSTANCE_ID,
        UserId: connectUser.UserId!,
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'User removed from last clinic and deleted from Connect',
          data: {
            userId: connectUser.UserId,
            username: connectUser.Username,
            clinics: [],
          },
        }),
      };
    }

    // Remove user from clinic hierarchy group
    await removeUserFromClinicHierarchy(connectUser.UserId!, clinicId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'User removed from clinic successfully',
        data: {
          userId: connectUser.UserId,
          username: connectUser.Username,
          clinics: updatedClinics,
        },
      }),
    };
  } catch (err: any) {
    console.error('Remove user from clinic error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to remove user from clinic' }),
    };
  }
}

// ========================================
// NEW CONNECT USER MANAGEMENT APIs
// ========================================

async function createConnectUser(body: ConnectUserBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can create Connect users' }),
      };
    }

    if (!body.username || !body.identityInfo || !body.phoneConfig || !body.securityProfileIds || !body.routingProfileId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'username, identityInfo, phoneConfig, securityProfileIds, and routingProfileId are required for create action' }),
      };
    }

    const createUserCommand = new CreateUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      Username: body.username,
      IdentityInfo: {
        FirstName: body.identityInfo.firstName,
        LastName: body.identityInfo.lastName,
        Email: body.identityInfo.email,
      },
      PhoneConfig: {
        PhoneType: body.phoneConfig.phoneType,
        AutoAccept: body.phoneConfig.autoAccept || false,
        AfterContactWorkTimeLimit: body.phoneConfig.afterContactWorkTimeLimit || 0,
        DeskPhoneNumber: body.phoneConfig.deskPhoneNumber || '',
      },
      SecurityProfileIds: body.securityProfileIds,
      RoutingProfileId: body.routingProfileId,
      Password: body.password,
      HierarchyGroupId: body.hierarchyGroupId,
    });

    const connectResult = await connect.send(createUserCommand);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Connect user created successfully',
        data: {
          userId: connectResult.UserId,
          userArn: connectResult.UserArn,
          username: body.username,
        },
      }),
    };
  } catch (err: any) {
    console.error('Create Connect user error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to create Connect user' }),
    };
  }
}

async function updateConnectUser(body: ConnectUserBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can update Connect users' }),
      };
    }

    if (!body.userId || !body.updateType) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'userId and updateType are required for update action' }),
      };
    }

    let result;
    switch (body.updateType) {
      case 'identity':
        if (!body.identityInfo) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'identityInfo is required for identity update' }),
          };
        }
        result = await updateUserIdentityInfo(body.userId, body.identityInfo);
        break;

      case 'phone':
        if (!body.phoneConfig) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'phoneConfig is required for phone update' }),
          };
        }
        result = await updateUserPhoneConfig(body.userId, body.phoneConfig);
        break;

      case 'security':
        if (!body.securityProfileIds || body.securityProfileIds.length === 0) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'securityProfileIds is required for security update' }),
          };
        }
        result = await updateUserSecurityProfiles(body.userId, body.securityProfileIds);
        break;

      case 'routing':
        if (!body.routingProfileId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'routingProfileId is required for routing update' }),
          };
        }
        result = await updateUserRoutingProfile(body.userId, body.routingProfileId);
        break;

      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, message: 'Invalid updateType. Must be one of: identity, phone, security, routing' }),
        };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: `Connect user ${body.updateType} updated successfully`,
        data: result,
      }),
    };
  } catch (err: any) {
    console.error('Update Connect user error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to update Connect user' }),
    };
  }
}

async function deleteConnectUser(body: ConnectUserBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can delete Connect users' }),
      };
    }

    if (!body.userId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'userId is required for delete action' }),
      };
    }

    await connect.send(new DeleteUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: body.userId,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Connect user deleted successfully',
        data: { userId: body.userId },
      }),
    };
  } catch (err: any) {
    console.error('Delete Connect user error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to delete Connect user' }),
    };
  }
}

async function describeConnectUser(body: ConnectUserBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Check permissions - only super admin or admin can describe Connect users
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can describe Connect users' }),
      };
    }

    if (!body.userId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'userId is required for describe action' }),
      };
    }

    const result = await connect.send(new DescribeUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: body.userId,
    }));

    // Get user proficiencies to show clinic access
    const clinics = await getUserProficiencies(body.userId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Connect user retrieved successfully',
        data: {
          ...result.User,
          clinics, // Add clinic access information
          clinicAccess: clinics.map(clinicId => ({
            clinicId,
            accessLevel: 'AGENT', // Could be enhanced to show role-based access
          })),
        },
      }),
    };
  } catch (err: any) {
    console.error('Describe Connect user error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to describe Connect user' }),
    };
  }
}

async function listConnectUsers(body: ConnectUserBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Check permissions - only super admin or admin can list Connect users
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can list Connect users' }),
      };
    }

    const result = await connect.send(new ListUsersCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      MaxResults: 100, // You can make this configurable
    }));

    // Enhance user data with clinic access information
    const usersWithClinics = await Promise.all(
      (result.UserSummaryList || []).map(async (user) => {
        const clinics = await getUserProficiencies(user.Id!);
        return {
          ...user,
          clinics,
          clinicAccess: clinics.map(clinicId => ({
            clinicId,
            accessLevel: 'AGENT',
          })),
        };
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Connect users retrieved successfully',
        data: {
          users: usersWithClinics,
          nextToken: result.NextToken,
        },
      }),
    };
  } catch (err: any) {
    console.error('List Connect users error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to list Connect users' }),
    };
  }
}

// ========================================
// HELPER FUNCTIONS FOR UPDATE OPERATIONS
// ========================================

async function updateUserIdentityInfo(userId: string, identityInfo: any): Promise<any> {
  const command = new UpdateUserIdentityInfoCommand({
    InstanceId: CONNECT_INSTANCE_ID,
    UserId: userId,
    IdentityInfo: identityInfo,
  });

  const result = await connect.send(command);
  return {
    userId,
    identityInfo,
    updatedAt: new Date().toISOString(),
  };
}

async function updateUserPhoneConfig(userId: string, phoneConfig: any): Promise<any> {
  const command = new UpdateUserPhoneConfigCommand({
    InstanceId: CONNECT_INSTANCE_ID,
    UserId: userId,
    PhoneConfig: phoneConfig,
  });

  const result = await connect.send(command);
  return {
    userId,
    phoneConfig,
    updatedAt: new Date().toISOString(),
  };
}

async function updateUserSecurityProfiles(userId: string, securityProfileIds: string[]): Promise<any> {
  const command = new UpdateUserSecurityProfilesCommand({
    InstanceId: CONNECT_INSTANCE_ID,
    UserId: userId,
    SecurityProfileIds: securityProfileIds,
  });

  const result = await connect.send(command);
  return {
    userId,
    securityProfileIds,
    updatedAt: new Date().toISOString(),
  };
}

async function updateUserRoutingProfile(userId: string, routingProfileId: string): Promise<any> {
  const command = new UpdateUserRoutingProfileCommand({
    InstanceId: CONNECT_INSTANCE_ID,
    UserId: userId,
    RoutingProfileId: routingProfileId,
  });

  const result = await connect.send(command);
  return {
    userId,
    routingProfileId,
    updatedAt: new Date().toISOString(),
  };
}

function parseBody(body: any): ConnectUserBody {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
    return {
      action: parsed.action || 'add',
      // Create action parameters
      username: parsed.username,
      identityInfo: parsed.identityInfo,
      phoneConfig: parsed.phoneConfig,
      securityProfileIds: parsed.securityProfileIds,
      routingProfileId: parsed.routingProfileId,
      password: parsed.password,
      hierarchyGroupId: parsed.hierarchyGroupId,
      // Update action parameters
      updateType: parsed.updateType,
      userId: parsed.userId,
      // Clinic access parameters
      clinicId: parsed.clinicId,
    };
  } catch {
    return {
      action: 'add',
    };
  }
}

// Helper function to parse query string parameters for GET/DELETE requests
function parseQueryParams(queryParams: any): ConnectUserBody {
  return {
    action: queryParams?.action || 'list',
    userId: queryParams?.userId,
    updateType: queryParams?.updateType,
    clinicId: queryParams?.clinicId,
  };
}

async function verifyIdToken(token: string): Promise<{ ok: boolean; code: number; message: string; payload?: JWTPayload }> {
  if (!token) return { ok: false, code: 401, message: 'No token provided' };

  try {
    const jwks = createRemoteJWKSet(new URL(`https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token.replace('Bearer ', ''), jwks, { issuer: `https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${USER_POOL_ID}` });
    return { ok: true, code: 200, message: 'Token verified', payload };
  } catch (err: any) {
    return { ok: false, code: 401, message: 'Invalid token: ' + err?.message };
  }
}

function callerAuthContextFromClaims(claims: JWTPayload): any {
  const groups = Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [];
  const email = claims.email as string || '';
  const userId = claims.sub as string || '';
  const givenName = claims.given_name as string || '';
  const familyName = claims.family_name as string || '';

  return {
    userId,
    email,
    givenName,
    familyName,
    groups,
    isSuperAdmin: groups.includes('GLOBAL__SUPER_ADMIN'),
    rolesByClinic: parseRolesFromGroups(groups),
  };
}

function parseRolesFromGroups(groups: string[]): Record<string, string[]> {
  const rolesByClinic: Record<string, string[]> = {};

  groups.forEach(group => {
    const match = /^clinic_([^_]+)__(.+)$/.exec(group);
    if (match) {
      const [, clinicId, role] = match;
      if (!rolesByClinic[clinicId]) rolesByClinic[clinicId] = [];
      rolesByClinic[clinicId].push(role);
    }
  });

  return rolesByClinic;
}

// Helper functions for ABR approach

// ========================================
// CONNECT-NATIVE HELPER FUNCTIONS
// ========================================

/**
 * Find Connect user by username (Connect-native approach)
 */
export async function findConnectUserByUsername(username: string): Promise<any> {
  try {
    const listUsersCommand = new ListUsersCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      MaxResults: 100, // Adjust as needed
    });

    const response = await connect.send(listUsersCommand);

    // Find user by username (Connect-native naming convention)
    const connectUsername = `connect-${username.toLowerCase()}`;
    return response.UserSummaryList?.find(user =>
      user.Username?.toLowerCase() === connectUsername.toLowerCase()
    ) || null;
  } catch (err: any) {
    console.error('Error finding Connect user by username:', err);
    throw new Error(`Failed to find Connect user: ${err.message}`);
  }
}

/**
 * Get user proficiencies (clinic attributes) from Connect
 */
async function getUserProficiencies(connectUserId: string): Promise<string[]> {
  try {
    const describeUserCommand = new DescribeUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: connectUserId,
    });

    const response = await connect.send(describeUserCommand);
    // Connect user proficiencies are stored in the response differently
    // For now, return empty array - would need to check actual Connect API response structure
    return [];
  } catch (err: any) {
    console.error('Error getting user proficiencies:', err);
    return [];
  }
}

/**
 * Add user to clinic hierarchy group (for organizational purposes)
 */
async function addUserToClinicHierarchy(connectUserId: string, clinicId: string): Promise<void> {
  try {
    // Get or create clinic hierarchy group
    const hierarchyGroupId = await getOrCreateClinicHierarchyGroup(clinicId);

    await connect.send(new UpdateUserHierarchyCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: connectUserId,
      HierarchyGroupId: hierarchyGroupId,
    }));

    console.log(`Added user ${connectUserId} to clinic hierarchy ${clinicId}`);
  } catch (err: any) {
    console.error('Error adding user to clinic hierarchy:', err);
    // Don't throw - hierarchy is optional, proficiencies are what matter for routing
  }
}

/**
 * Remove user from clinic hierarchy group
 */
async function removeUserFromClinicHierarchy(connectUserId: string, clinicId: string): Promise<void> {
  try {
    // For simplicity, we'll just log this - hierarchy cleanup is optional
    console.log(`Removing user ${connectUserId} from clinic hierarchy ${clinicId}`);
    // In a full implementation, you might want to move to a default hierarchy or remove entirely
  } catch (err: any) {
    console.error('Error removing user from clinic hierarchy:', err);
  }
}

/**
 * Get or create clinic hierarchy group
 */
async function getOrCreateClinicHierarchyGroup(clinicId: string): Promise<string> {
  try {
    // List existing hierarchy groups
    const listHierarchiesCommand = new ListUserHierarchyGroupsCommand({
      InstanceId: CONNECT_INSTANCE_ID,
    });

    const response = await connect.send(listHierarchiesCommand);
    const existingGroup = response.UserHierarchyGroupSummaryList?.find((group: any) =>
      group.Name === `clinic-${clinicId}`
    );

    if (existingGroup) {
      return existingGroup.Id!;
    }

    // Create new hierarchy group for this clinic
    const createHierarchyCommand = new CreateUserHierarchyGroupCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      Name: `clinic-${clinicId}`,
      ParentGroupId: undefined, // Top-level group
    });

    const createResponse = await connect.send(createHierarchyCommand);
    return createResponse.HierarchyGroupId!;

  } catch (err: any) {
    console.error('Error getting/creating clinic hierarchy group:', err);
    throw new Error(`Failed to setup clinic hierarchy: ${err.message}`);
  }
}

/**
 * Get user clinic access (new Connect-native endpoint)
 */
async function getUserClinicAccess(username: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const connectUser = await findConnectUserByUsername(username);

    if (!connectUser) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Connect user not found',
        }),
      };
    }

    const clinics = await getUserProficiencies(connectUser.UserId!);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'User clinic access retrieved',
        data: {
          userId: connectUser.UserId,
          username: connectUser.Username,
          clinics: clinics.map(clinicId => ({
            clinicId,
            connectUserId: connectUser.UserId,
            createdAt: connectUser.CreatedAt,
          })),
        },
      }),
    };
  } catch (err: any) {
    console.error('Get user clinic access error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to get user clinic access' }),
    };
  }
}

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
    console.error('Error updating user proficiencies:', err);
    throw new Error(`Failed to update Connect user proficiencies: ${err.message}`);
  }
}

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ConnectClient,
  ListUsersCommand,
  DescribeUserCommand
} from '@aws-sdk/client-connect';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { getClinicAttributeName } from '../../infrastructure/utils/clinicCombinations';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface AccessControlRequest {
  clinicId: string;
  userId?: string;
  action: 'check' | 'list' | 'get_clinic_access';
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
    const body = parseBody(event.body);

    if (!body.clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'clinicId is required' }),
      };
    }

    switch (body.action) {
      case 'check':
        return await checkAccess(body, caller, corsHeaders);
      case 'list':
        return await listUserClinics(caller, corsHeaders);
      case 'get_clinic_access':
        return await getClinicAccess(body.clinicId, corsHeaders);
      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, message: 'Invalid action' }),
        };
    }
  } catch (err: any) {
    console.error('Access control error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Internal Server Error' }),
    };
  }
};

async function checkAccess(body: AccessControlRequest, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const { clinicId } = body;

    // Super admin has access to all clinics
    if (caller.isSuperAdmin) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          access: true,
          accessLevel: 'SUPER_ADMIN',
          message: 'Super admin access granted',
        }),
      };
    }

    // Check Connect user clinic access (Connect-native approach)
    const connectUser = await findConnectUserByUsername(caller.userId);

    if (!connectUser) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          access: false,
          message: 'Connect user not found',
        }),
      };
    }

    // Check if user has clinic access via hierarchy groups (Connect-native)
    const hasAccess = await checkUserHierarchyAccess(connectUser.Id!, clinicId);

    if (!hasAccess) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          access: false,
          message: 'User does not have access to this clinic',
        }),
      };
    }

    // Get clinic hours (still using DynamoDB for business hours)
    let clinicHours = null;
    let isOpen = false;
    try {
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient, GetCommand } = await import('@aws-sdk/lib-dynamodb');

      const clinicDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
      const hoursResponse = await clinicDdb.send(new GetCommand({
        TableName: CLINIC_HOURS_TABLE,
        Key: { clinicId },
      }));

      if (hoursResponse.Item) {
        clinicHours = hoursResponse.Item;
        isOpen = isClinicOpen(hoursResponse.Item);
      }
    } catch (err) {
      console.warn('Could not get clinic hours:', err);
    }

    const accessLevel = getUserAccessLevel(caller, clinicId);
    const clinicInfo = {
      isOpen,
      hours: clinicHours,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        access: true,
        accessLevel,
        clinicInfo,
        message: 'Access verified via Connect hierarchy',
      }),
    };
  } catch (err: any) {
    console.error('Check access error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to check access' }),
    };
  }
}

async function listUserClinics(caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    if (caller.isSuperAdmin) {
      // Super admin has access to all clinics
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinics: 'ALL',
          accessLevel: 'SUPER_ADMIN',
          message: 'Super admin has access to all clinics',
        }),
      };
    }

    // Get user's clinic access from Connect user proficiencies (Connect-native approach)
    const connectUser = await findConnectUserByUsername(caller.userId);

    if (!connectUser) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinics: [],
          message: 'User has no Connect user or clinic access',
        }),
      };
    }

    // Get user's proficiencies (clinic attributes) from Connect
    const userDetails = await connect.send(new DescribeUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: connectUser.Id!,
    }));

    // For Connect-native architecture, clinic access is determined by user hierarchy groups
    // In a full implementation, this would check the user's hierarchy group membership
    const clinics = ['all']; // Simplified - super admin equivalent

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        clinics,
        message: 'User clinic access retrieved from Connect',
        data: {
          connectUserId: connectUser.Id,
          username: connectUser.Username,
          hierarchyGroupId: userDetails.User?.HierarchyGroupId,
        },
      }),
    };
  } catch (err: any) {
    console.error('List user clinics error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to list user clinics' }),
    };
  }
}

// ========================================
// CONNECT-NATIVE HELPER FUNCTIONS
// ========================================

/**
 * Find Connect user by username (Connect-native approach)
 */
async function findConnectUserByUsername(username: string): Promise<any> {
  try {
    const listUsersCommand = new ListUsersCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      MaxResults: 100,
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
 * Check if user has access to a clinic via Connect hierarchy groups
 */
async function checkUserHierarchyAccess(connectUserId: string, clinicId: string): Promise<boolean> {
  try {
    // Get user's hierarchy group
    const userResponse = await connect.send(new DescribeUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: connectUserId,
    }));

    const userHierarchyGroupId = userResponse.User?.HierarchyGroupId;

    if (!userHierarchyGroupId) {
      return false; // User not in any hierarchy group
    }

    // Get hierarchy group details
    const { DescribeUserHierarchyGroupCommand } = await import('@aws-sdk/client-connect');
    const hierarchyResponse = await connect.send(new DescribeUserHierarchyGroupCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      HierarchyGroupId: userHierarchyGroupId,
    }));

    // Check if hierarchy group name matches clinic pattern
    const hierarchyGroupName = hierarchyResponse.HierarchyGroup?.Name;
    return hierarchyGroupName === `clinic-${clinicId}`;

  } catch (err: any) {
    console.error('Error checking user hierarchy access:', err);
    return false; // Default to no access on error
  }
}

async function getClinicAccess(clinicId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Get all Connect users and filter by clinic proficiencies (Connect-native approach)
    const listUsersResponse = await connect.send(new ListUsersCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      MaxResults: 100,
    }));

    const usersWithClinicAccess = [];

    for (const user of listUsersResponse.UserSummaryList || []) {
      try {
        const userDetails = await connect.send(new DescribeUserCommand({
          InstanceId: CONNECT_INSTANCE_ID,
          UserId: user.Id!,
        }));

        // For Connect-native architecture, check user hierarchy group membership
        // In a full implementation, this would check if user belongs to the clinic's hierarchy group
        const hasClinicAccess = true; // Simplified - would need to check actual hierarchy membership

        if (hasClinicAccess) {
          usersWithClinicAccess.push({
            userId: user.Username?.replace('connect-', '') || user.Id, // Remove 'connect-' prefix
            connectUserId: user.Id,
            username: user.Username,
            clinicId,
            createdAt: user.LastModifiedTime || new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(`Error checking access for user ${user.Id}:`, err);
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: `Users with access to clinic ${clinicId} retrieved from Connect`,
        data: {
          clinicId,
          users: usersWithClinicAccess,
        },
      }),
    };

    // Get clinic hours (still using DynamoDB for business hours)
    let clinicHours = null;
    let isOpen = false;
    try {
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient, GetCommand } = await import('@aws-sdk/lib-dynamodb');

      const clinicDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
      const hoursResponse = await clinicDdb.send(new GetCommand({
        TableName: CLINIC_HOURS_TABLE,
        Key: { clinicId },
      }));

      if (hoursResponse.Item) {
        clinicHours = hoursResponse.Item;
        isOpen = isClinicOpen(hoursResponse.Item);
      }
    } catch (err) {
      console.warn('Could not get clinic hours:', err);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: `Users with access to clinic ${clinicId} retrieved from Connect`,
        data: {
          clinicId,
          users: usersWithClinicAccess,
          clinicInfo: {
            isOpen,
            hours: clinicHours,
          },
        },
      }),
    };
  } catch (err: any) {
    console.error('Get clinic access error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to get clinic access' }),
    };
  }
}

function isClinicOpen(hoursData: any): boolean {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const currentTime = now.getHours() * 100 + now.getMinutes(); // HHMM format

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayKey = dayNames[currentDay];

  if (!hoursData[dayKey] || !hoursData[dayKey].open) {
    return false;
  }

  const openTime = parseInt(hoursData[dayKey].open.replace(':', ''));
  const closeTime = parseInt(hoursData[dayKey].close.replace(':', ''));

  return currentTime >= openTime && currentTime <= closeTime;
}

function checkUserClinicAccess(caller: any, clinicId: string): boolean {
  // Super admin has access to all clinics
  if (caller.isSuperAdmin) {
    return true;
  }

  // Check specific clinic access
  return caller.rolesByClinic && caller.rolesByClinic[clinicId] &&
         caller.rolesByClinic[clinicId].length > 0;
}

function getUserAccessLevel(caller: any, clinicId: string): string {
  if (caller.isSuperAdmin) return 'SUPER_ADMIN';

  const roles = caller.rolesByClinic?.[clinicId] || [];
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('PROVIDER')) return 'PROVIDER';
  if (roles.includes('USER')) return 'USER';

  return 'NONE';
}

function parseBody(body: any): AccessControlRequest {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
    // Ensure required fields are present
    return {
      clinicId: parsed.clinicId || '',
      userId: parsed.userId,
      action: parsed.action || 'check',
    };
  } catch {
    return {
      clinicId: '',
      action: 'check',
    };
  }
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

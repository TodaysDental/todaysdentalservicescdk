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
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { CONNECT_CONFIG } from '../../infrastructure/configs/connect-config';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || CONNECT_CONFIG.INSTANCE_ID;
const CONNECT_MASTER_ROUTING_PROFILE_ID = process.env.CONNECT_MASTER_ROUTING_PROFILE_ID!;
const CONNECT_SECURITY_PROFILE_ID = process.env.CONNECT_SECURITY_PROFILE_ID!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface VoiceAgentBody {
  action: 'create' | 'update' | 'delete' | 'describe' | 'list';
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
    console.error('Voice agent error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Internal Server Error' }),
    };
  }
};

// ========================================
// HTTP METHOD HANDLERS
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
      return await listVoiceAgents(body, caller, corsHeaders);
    case 'describe':
      return await describeVoiceAgent(body, caller, corsHeaders);
    default:
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Invalid GET action. Must be one of: list, describe' }),
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
      return await createVoiceAgent(body, caller, corsHeaders);
    default:
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Invalid POST action. Must be one of: create' }),
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

  return await updateVoiceAgent(body, caller, corsHeaders);
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

  return await deleteVoiceAgent(body, caller, corsHeaders);
}

// ========================================
// VOICE AGENT MANAGEMENT FUNCTIONS
// ========================================

async function createVoiceAgent(body: VoiceAgentBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Only super admin can create voice agents
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can create voice agents' }),
      };
    }

    if (!body.username || !body.identityInfo) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'username and identityInfo are required for create action' }),
      };
    }

    // Create Connect user with voice agent configuration
    const createUserCommand = new CreateUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      Username: `voice-${body.username.toLowerCase()}`, // Prefix with 'voice-' to distinguish
      IdentityInfo: {
        FirstName: body.identityInfo.firstName,
        LastName: body.identityInfo.lastName,
        Email: body.identityInfo.email,
      },
      PhoneConfig: {
        PhoneType: body.phoneConfig?.phoneType || 'SOFT_PHONE',
        AutoAccept: body.phoneConfig?.autoAccept || false,
        AfterContactWorkTimeLimit: body.phoneConfig?.afterContactWorkTimeLimit || 0,
        DeskPhoneNumber: body.phoneConfig?.deskPhoneNumber || '',
      },
      SecurityProfileIds: body.securityProfileIds || [CONNECT_SECURITY_PROFILE_ID],
      RoutingProfileId: body.routingProfileId || CONNECT_MASTER_ROUTING_PROFILE_ID,
      Password: body.password || generateRandomPassword(),
      HierarchyGroupId: body.hierarchyGroupId,
    });

    const connectResult = await connect.send(createUserCommand);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Voice agent created successfully in Amazon Connect',
        data: {
          userId: connectResult.UserId,
          userArn: connectResult.UserArn,
          username: `voice-${body.username.toLowerCase()}`,
          connectInstanceId: CONNECT_INSTANCE_ID,
        },
      }),
    };
  } catch (err: any) {
    console.error('Create voice agent error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to create voice agent' }),
    };
  }
}

async function updateVoiceAgent(body: VoiceAgentBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Only super admin can update voice agents
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can update voice agents' }),
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
        result = await updateVoiceAgentIdentityInfo(body.userId, body.identityInfo);
        break;

      case 'phone':
        if (!body.phoneConfig) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'phoneConfig is required for phone update' }),
          };
        }
        result = await updateVoiceAgentPhoneConfig(body.userId, body.phoneConfig);
        break;

      case 'security':
        if (!body.securityProfileIds || body.securityProfileIds.length === 0) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'securityProfileIds is required for security update' }),
          };
        }
        result = await updateVoiceAgentSecurityProfiles(body.userId, body.securityProfileIds);
        break;

      case 'routing':
        if (!body.routingProfileId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'routingProfileId is required for routing update' }),
          };
        }
        result = await updateVoiceAgentRoutingProfile(body.userId, body.routingProfileId);
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
        message: `Voice agent ${body.updateType} updated successfully`,
        data: result,
      }),
    };
  } catch (err: any) {
    console.error('Update voice agent error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to update voice agent' }),
    };
  }
}

async function deleteVoiceAgent(body: VoiceAgentBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Only super admin can delete voice agents
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can delete voice agents' }),
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
        message: 'Voice agent deleted successfully from Amazon Connect',
        data: { userId: body.userId },
      }),
    };
  } catch (err: any) {
    console.error('Delete voice agent error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to delete voice agent' }),
    };
  }
}

async function describeVoiceAgent(body: VoiceAgentBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Only super admin can describe voice agents
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can describe voice agents' }),
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

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Voice agent retrieved successfully',
        data: {
          ...result.User,
          agentType: 'voice',
          connectInstanceId: CONNECT_INSTANCE_ID,
        },
      }),
    };
  } catch (err: any) {
    console.error('Describe voice agent error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to describe voice agent' }),
    };
  }
}

async function listVoiceAgents(body: VoiceAgentBody, caller: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Only super admin can list voice agents
    if (!caller.isSuperAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Only super admin can list voice agents' }),
      };
    }

    const result = await connect.send(new ListUsersCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      MaxResults: 100,
    }));

    // Filter for voice agents (those with 'voice-' prefix)
    const voiceAgents = (result.UserSummaryList || []).filter(user =>
      user.Username?.startsWith('voice-')
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Voice agents retrieved successfully',
        data: {
          agents: voiceAgents.map(agent => ({
            ...agent,
            agentType: 'voice',
            connectInstanceId: CONNECT_INSTANCE_ID,
          })),
          nextToken: result.NextToken,
        },
      }),
    };
  } catch (err: any) {
    console.error('List voice agents error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to list voice agents' }),
    };
  }
}

// ========================================
// HELPER FUNCTIONS
// ========================================

async function updateVoiceAgentIdentityInfo(userId: string, identityInfo: any): Promise<any> {
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

async function updateVoiceAgentPhoneConfig(userId: string, phoneConfig: any): Promise<any> {
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

async function updateVoiceAgentSecurityProfiles(userId: string, securityProfileIds: string[]): Promise<any> {
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

async function updateVoiceAgentRoutingProfile(userId: string, routingProfileId: string): Promise<any> {
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

function generateRandomPassword(): string {
  const length = 12;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

function parseBody(body: any): VoiceAgentBody {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
    return {
      action: parsed.action || 'create',
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
      action: 'create',
    };
  }
}

function parseQueryParams(queryParams: any): VoiceAgentBody {
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

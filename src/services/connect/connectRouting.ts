import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ConnectClient,
  DescribeContactCommand,
  UpdateContactAttributesCommand,
  ListPhoneNumbersCommand,
  CreateContactCommand,
  StartOutboundVoiceContactCommand,
  StopContactCommand,
  UpdateAgentStatusCommand,
  ListQueuesCommand,
  DescribeQueueCommand,
  ListContactFlowsCommand
} from '@aws-sdk/client-connect';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import clinicsData from '../../infrastructure/configs/clinics.json';
import { Clinic } from '../../infrastructure/configs/clinics';
import { getQueueName } from '../../infrastructure/utils/clinicCombinations';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE!;
const CHATBOT_API_URL = process.env.CHATBOT_API_URL!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface RoutingRequest {
  contactId?: string;
  clinicId: string;
  callerNumber?: string;
  destinationNumber?: string;
  userId?: string;
  action: 'route' | 'transfer' | 'check_access' | 'outbound_call' | 'get_clinic_phone';
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Verify authentication for API calls
    const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      return { statusCode: verifyResult.code, headers: corsHeaders, body: JSON.stringify(verifyResult) };
    }

    const body = parseBody(event.body);

    if (!body.clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'clinicId is required' }),
      };
    }

    switch (body.action) {
      case 'route':
        return await routeCall(body, corsHeaders);
      case 'transfer':
        return await transferCall(body, corsHeaders);
      case 'check_access':
        return await checkAccess(body, verifyResult.payload!, corsHeaders);
      case 'outbound_call':
        return await initiateOutboundCall(body, verifyResult.payload!, corsHeaders);
      case 'get_clinic_phone':
        return await getClinicPhoneNumber(body, verifyResult.payload!, corsHeaders);
      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, message: 'Invalid action' }),
        };
    }
  } catch (err: any) {
    console.error('Connect routing error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Internal Server Error' }),
    };
  }
};

async function routeCall(body: RoutingRequest, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const { contactId, clinicId } = body;

    if (!contactId || !clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'contactId and clinicId are required for routing' }),
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

    if (!clinicHours || !isOpen) {
      // No hours configured or clinic closed, route to chatbot
      return await routeToChatbot(contactId, clinicId, corsHeaders);
    }

    // Get available agents using Connect APIs (Connect-native approach)
    const availableAgents = await findAvailableAgentsForClinic(clinicId);

    if (availableAgents.length === 0) {
      return await routeToChatbot(contactId, clinicId, corsHeaders);
    }

    // Update contact attributes with routing info (Connect-native)
    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: {
        clinicId,
        routingType: 'live_agent',
        availableAgents: availableAgents.length.toString(),
        routedAt: new Date().toISOString(),
        clinicHours: JSON.stringify(clinicHours),
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Call routed to live agent (Connect-native)',
        data: {
          contactId,
          clinicId,
          routingType: 'live_agent',
          availableAgents: availableAgents.length,
          agents: availableAgents,
          clinicHours,
          isOpen,
        },
      }),
    };
  } catch (err: any) {
    console.error('Route call error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to route call' }),
    };
  }
}

async function routeToChatbot(contactId: string, clinicId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Update contact attributes
    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: {
        clinicId,
        routingType: 'chatbot',
        routedToChatbot: 'true',
        routedAt: new Date().toISOString(),
      },
    }));

    // Connect-native: routing decision stored in contact attributes
    // Build a clinic-specific chatbot URL so callers are directed to the right clinic context.
    // Use the base CHATBOT_API_URL environment variable and append a clinicId query parameter.
    const baseUrl = CHATBOT_API_URL.endsWith('/') ? CHATBOT_API_URL.slice(0, -1) : CHATBOT_API_URL;
    const clinicSpecificChatbotUrl = `${baseUrl}?clinicId=${encodeURIComponent(clinicId)}`;

    // Also include clinic website link if present for richer UI messages
    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    const clinicWebsite = clinic?.websiteLink;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Call routed to chatbot (Connect-native)',
        data: {
          contactId,
          clinicId,
          routingType: 'chatbot',
          chatbotUrl: clinicSpecificChatbotUrl,
          clinicWebsite: clinicWebsite || null,
          reason: 'after_hours_or_no_agents',
        },
      }),
    };
  } catch (err: any) {
    console.error('Route to chatbot error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to route to chatbot' }),
    };
  }
}

async function transferCall(body: RoutingRequest, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const { contactId, clinicId } = body;

    // Get transfer target (could be another clinic or specific user)
    const transferTarget = await determineTransferTarget(clinicId);

    // Update contact attributes
    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: {
        clinicId,
        transferTarget,
        transferReason: body.callerNumber || 'user_request',
        transferredAt: new Date().toISOString(),
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        transferTarget,
        message: 'Call transfer initiated',
      }),
    };
  } catch (err: any) {
    console.error('Transfer call error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to transfer call' }),
    };
  }
}

async function checkAccess(body: RoutingRequest, claims: JWTPayload, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const caller = callerAuthContextFromClaims(claims);
    const { clinicId } = body;

    // Check if user has access to this clinic
    const hasAccess = checkUserClinicAccess(caller, clinicId);

    if (!hasAccess) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
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

    const clinicInfo = {
      isOpen,
      hours: clinicHours,
      accessLevel: getUserAccessLevel(caller, clinicId),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        access: true,
        message: 'Access verified (Connect-native)',
        data: {
          clinicId,
          clinicInfo,
          hasAccess: true,
        },
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

async function determineTransferTarget(clinicId: string): Promise<string> {
  // This would implement logic to determine where to transfer the call
  // Could be another clinic, escalation, or specific user
  return 'escalation_queue';
}

function parseBody(body: any): RoutingRequest {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
    // Ensure required fields are present
    return {
      contactId: parsed.contactId || '',
      clinicId: parsed.clinicId || '',
      callerNumber: parsed.callerNumber || '',
      action: parsed.action || 'route',
    };
  } catch {
    return {
      contactId: '',
      clinicId: '',
      callerNumber: '',
      action: 'route',
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

async function initiateOutboundCall(body: RoutingRequest, claims: JWTPayload, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const caller = callerAuthContextFromClaims(claims);
    const { clinicId, destinationNumber, userId } = body;

    // Check if user has access to this clinic
    if (!hasClinicAccess(caller, clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'User does not have access to this clinic',
        }),
      };
    }

    // Get clinic configuration
    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    if (!clinic || !clinic.phoneNumber) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Clinic phone number not configured' }),
      };
    }

    // Get clinic hours to check if outbound calls are allowed (still using DynamoDB for business hours)
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

    if (!clinicHours || !isOpen) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'Outbound calls not allowed outside clinic hours',
        }),
      };
    }

    // Find the Connect phone number ID and contact flow for this clinic
    const [phoneNumbersResponse, contactFlowsResponse] = await Promise.all([
      connect.send(new ListPhoneNumbersCommand({ InstanceId: CONNECT_INSTANCE_ID })),
      connect.send(new ListContactFlowsCommand({ InstanceId: CONNECT_INSTANCE_ID })),
    ]);

    const clinicPhone = phoneNumbersResponse.PhoneNumberSummaryList?.find(p =>
      p.PhoneNumber && p.PhoneNumber.replace('+', '') === clinic.phoneNumber.replace('+', '')
    );

    if (!clinicPhone) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Clinic phone number not found in Connect' }),
      };
    }

    // Find clinic-specific contact flow
    const clinicFlow = contactFlowsResponse.ContactFlowSummaryList?.find(f =>
      f.Name === `${clinic.clinicName} Flow`
    );

    // Create outbound contact in Connect
    const contactAttributes = {
      clinicId,
      callerId: userId || caller.userId,
      callType: 'outbound',
      destinationNumber: destinationNumber || '',
      initiatedAt: new Date().toISOString(),
      source: 'clinic_phone',
    };

    // Connect-native: use Connect's StartOutboundVoiceContact API
    const outboundCallCommand = new StartOutboundVoiceContactCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      ContactFlowId: clinicFlow?.Id, // Use clinic-specific contact flow if available
      DestinationPhoneNumber: destinationNumber,
      SourcePhoneNumber: clinicPhone.PhoneNumber!, // Use the actual phone number string
      Attributes: {
        ...contactAttributes,
        clinicId,
        callerId: userId || caller.userId,
        callType: 'outbound',
        initiatedAt: new Date().toISOString(),
      },
      AnswerMachineDetectionConfig: {
        EnableAnswerMachineDetection: true,
        AwaitAnswerMachinePrompt: true,
      },
    });

    const outboundCallResult = await connect.send(outboundCallCommand);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Outbound call initiated successfully (Connect-native)',
        data: {
          contactId: outboundCallResult.ContactId,
          clinicPhone: clinic.phoneNumber,
          connectPhoneNumberId: clinicPhone.Id,
          contactAttributes,
          clinicHours,
          isOpen,
        },
      }),
    };
  } catch (err: any) {
    console.error('Initiate outbound call error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to initiate outbound call' }),
    };
  }
}

async function getClinicPhoneNumber(body: RoutingRequest, claims: JWTPayload, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const caller = callerAuthContextFromClaims(claims);
    const { clinicId } = body;

    // Check if user has access to this clinic
    if (!hasClinicAccess(caller, clinicId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          message: 'User does not have access to this clinic',
        }),
      };
    }

    // Get clinic configuration
    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    if (!clinic || !clinic.phoneNumber) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Clinic phone number not configured' }),
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

    const clinicInfo = {
      clinicId,
      phoneNumber: clinic.phoneNumber,
      clinicName: clinic.clinicName,
      timeZone: clinic.timeZone || 'America/New_York',
      isOpen,
      hours: clinicHours,
      connectPhoneNumberId: clinic.connectPhoneNumberId,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        clinicInfo,
        message: 'Clinic phone number retrieved successfully',
      }),
    };
  } catch (err: any) {
    console.error('Get clinic phone error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to get clinic phone number' }),
    };
  }
}

// ========================================
// CONNECT-NATIVE HELPER FUNCTIONS
// ========================================

/**
 * Find available agents for a clinic using Connect APIs (Connect-native approach)
 */
async function findAvailableAgentsForClinic(clinicId: string): Promise<any[]> {
  try {
    // Get all users from Connect
    const { ListUsersCommand, DescribeUserCommand } = await import('@aws-sdk/client-connect');
    const listUsersResponse = await connect.send(new ListUsersCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      MaxResults: 100,
    }));

    const availableAgents = [];

    // Check each user for clinic access and availability
    for (const user of listUsersResponse.UserSummaryList || []) {
      try {
        const userDetails = await connect.send(new DescribeUserCommand({
          InstanceId: CONNECT_INSTANCE_ID,
          UserId: user.Id!,
        }));

        // Check if user has access to this clinic via hierarchy groups
        const hierarchyGroupId = userDetails.User?.HierarchyGroupId;
        if (hierarchyGroupId) {
          // Get hierarchy group details
          const { DescribeUserHierarchyGroupCommand } = await import('@aws-sdk/client-connect');
          const hierarchyResponse = await connect.send(new DescribeUserHierarchyGroupCommand({
            InstanceId: CONNECT_INSTANCE_ID,
            HierarchyGroupId: hierarchyGroupId,
          }));

          const hierarchyGroupName = hierarchyResponse.HierarchyGroup?.Name;
          if (hierarchyGroupName === `clinic-${clinicId}`) {
            // Check agent status
            const { ListAgentStatusesCommand } = await import('@aws-sdk/client-connect');
            const statusResponse = await connect.send(new ListAgentStatusesCommand({
              InstanceId: CONNECT_INSTANCE_ID,
            }));

            // Find this agent's status
            const agentStatus = statusResponse.AgentStatusSummaryList?.find((status: any) =>
              (status as any).AgentStatus?.AgentId === user.Id
            );

            // Consider agent available if not in a call (simplified)
            const agentStatusData = (agentStatus as any)?.AgentStatus;
            if (agentStatusData?.State !== 'Busy') {
              availableAgents.push({
                userId: user.Id,
                username: user.Username,
                hierarchyGroup: hierarchyGroupName,
                status: agentStatusData?.State || 'Unknown',
              });
            }
          }
        }
      } catch (err) {
        console.error(`Error checking agent ${user.Id}:`, err);
      }
    }

    return availableAgents;
  } catch (err: any) {
    console.error('Error finding available agents:', err);
    return [];
  }
}


function hasClinicAccess(caller: any, clinicId: string): boolean {
  if (caller.isSuperAdmin) return true;
  return Object.keys(caller.rolesByClinic).includes(clinicId);
}


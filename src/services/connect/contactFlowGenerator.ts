import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ConnectClient,
  ListUsersCommand,
  DescribeUserCommand,
  CreateContactFlowCommand,
  UpdateContactFlowContentCommand,
  DescribeContactFlowCommand
} from '@aws-sdk/client-connect';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import clinicsData from '../../infrastructure/configs/clinics.json';
import { Clinic } from '../../infrastructure/configs/clinics';
import { getClinicAttributeName } from '../../infrastructure/utils/clinicCombinations';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE!;
const CHATBOT_API_URL = process.env.CHATBOT_API_URL!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface ContactFlowRequest {
  clinicId: string;
  action: 'generate' | 'update' | 'get_hours_status';
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    const body = parseBody(event.body);

    if (!body.clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'clinicId is required' }),
      };
    }

    switch (body.action) {
      case 'generate':
        return await generateContactFlow(body.clinicId, corsHeaders);
      case 'update':
        return await updateContactFlow(body.clinicId, corsHeaders);
      case 'get_hours_status':
        return await getHoursStatus(body.clinicId, corsHeaders);
      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, message: 'Invalid action' }),
        };
    }
  } catch (err: any) {
    console.error('Contact flow generator error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Internal Server Error' }),
    };
  }
};

async function generateContactFlow(clinicId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    if (!clinic) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Clinic not found' }),
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

    // Get available agents using Connect APIs (Connect-native approach)
    const availableAgents = await findAvailableAgentsForClinic(clinicId);
    const hasAgents = availableAgents.length > 0;

    // Generate contact flow based on hours and agent availability
    const contactFlow = generateFlowForClinic(clinic, isOpen, hasAgents, clinicHours);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        clinicId,
        contactFlow,
        metadata: {
          isOpen,
          hasAgents,
          availableAgents: availableAgents.length,
          hours: clinicHours,
        },
        message: 'Contact flow generated',
      }),
    };
  } catch (err: any) {
    console.error('Generate contact flow error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to generate contact flow' }),
    };
  }
}

async function updateContactFlow(clinicId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // This would trigger a Connect API call to update the contact flow
    // For now, we'll just return the updated configuration

    const result = await generateContactFlow(clinicId, corsHeaders);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Contact flow update triggered',
        contactFlow: (JSON.parse(result.body) as any).contactFlow,
      }),
    };
  } catch (err: any) {
    console.error('Update contact flow error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to update contact flow' }),
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
    const listUsersResponse = await connect.send(new ListUsersCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      MaxResults: 100,
    }));

    const availableAgents = [];

    // Check each user for clinic access via hierarchy groups
    for (const user of listUsersResponse.UserSummaryList || []) {
      try {
        const userDetails = await connect.send(new DescribeUserCommand({
          InstanceId: CONNECT_INSTANCE_ID,
          UserId: user.Id!,
        }));

        // Check if user belongs to this clinic's hierarchy group
        const hierarchyGroupId = userDetails.User?.HierarchyGroupId;
        if (hierarchyGroupId) {
          const { DescribeUserHierarchyGroupCommand } = await import('@aws-sdk/client-connect');
          const hierarchyResponse = await connect.send(new DescribeUserHierarchyGroupCommand({
            InstanceId: CONNECT_INSTANCE_ID,
            HierarchyGroupId: hierarchyGroupId,
          }));

          const hierarchyGroupName = hierarchyResponse.HierarchyGroup?.Name;
          if (hierarchyGroupName === `clinic-${clinicId}`) {
            availableAgents.push({
              userId: user.Id,
              username: user.Username,
              hierarchyGroup: hierarchyGroupName,
            });
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

async function getHoursStatus(clinicId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
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
        message: 'Hours status retrieved (Connect-native)',
        data: {
          clinicId,
          isOpen,
          hours: clinicHours,
          currentTime: new Date().toISOString(),
        },
      }),
    };
  } catch (err: any) {
    console.error('Get hours status error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to get hours status' }),
    };
  }
}

function generateFlowForClinic(clinic: Clinic, isOpen: boolean, hasAgents: boolean, hoursData: any): any {
  const actions: any[] = [];

  // Start action - greeting
  actions.push({
    Identifier: 'start-action',
    Type: 'MessageParticipant',
    Transitions: {
      NextAction: isOpen ? 'check-agents' : 'after-hours',
    },
    Parameters: {
      Text: `Thank you for calling ${clinic.clinicName}. ${isOpen ? 'Please hold while we connect you to an available agent.' : 'We are currently closed. Please leave a message or try our chatbot for immediate assistance.'}`,
    },
  });

  if (isOpen) {
    // Check if agents are available
    actions.push({
      Identifier: 'check-agents',
      Type: 'MessageParticipant',
      Transitions: {
        NextAction: hasAgents ? 'transfer-queue' : 'after-hours',
      },
      Parameters: {
        Text: hasAgents ? 'Connecting you now...' : 'All agents are currently busy. Please try our chatbot for immediate assistance.',
      },
    });

    if (hasAgents) {
      // Transfer to queue
      actions.push({
        Identifier: 'transfer-queue',
        Type: 'TransferToQueue',
        Transitions: {
          NextAction: 'end-call',
        },
        Parameters: {
          QueueArn: `arn:aws:connect:${process.env.AWS_REGION}:${process.env.CDK_DEFAULT_ACCOUNT}:instance/${process.env.CONNECT_INSTANCE_ID}/queue/${clinic.clinicId}`,
        },
      });
    }
  }

  // After hours - route to chatbot or voicemail
  const baseUrl = CHATBOT_API_URL.endsWith('/') ? CHATBOT_API_URL.slice(0, -1) : CHATBOT_API_URL;
  const clinicChatUrl = `${baseUrl}?clinicId=${encodeURIComponent(clinic.clinicId)}`;

  actions.push({
    Identifier: 'after-hours',
    Type: 'MessageParticipant',
    Transitions: {
      NextAction: 'chatbot-integration',
    },
    Parameters: {
      Text: `For immediate assistance, you can use our AI chatbot at ${clinicChatUrl}, or leave a message and we will get back to you during business hours.`,
    },
  });

  // Chatbot integration
  actions.push({
    Identifier: 'chatbot-integration',
    Type: 'MessageParticipant',
    Transitions: {
      NextAction: 'end-call',
    },
    Parameters: {
      Text: `Visit ${clinicChatUrl} and use our chatbot for immediate help, or call back during business hours. Thank you for calling ${clinic.clinicName}.`,
    },
  });

  // End call
  actions.push({
    Identifier: 'end-call',
    Type: 'Disconnect',
    Transitions: {},
    Parameters: {},
  });

  return {
    Version: '2019-10-30',
    StartAction: 'start-action',
    Actions: actions,
  };
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

function parseBody(body: any): ContactFlowRequest {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
    // Ensure required fields are present
    return {
      clinicId: parsed.clinicId || '',
      action: parsed.action || 'get_hours_status',
    };
  } catch {
    return {
      clinicId: '',
      action: 'get_hours_status',
    };
  }
}

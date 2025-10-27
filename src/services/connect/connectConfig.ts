import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ConnectClient,
  ListPhoneNumbersCommand,
  DescribeQueueCommand,
  DescribeRoutingProfileCommand,
  ListQueuesCommand,
  ListRoutingProfilesCommand,
  DescribeContactFlowCommand,
  ListContactFlowsCommand
} from '@aws-sdk/client-connect';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import clinicsData from '../../infrastructure/configs/clinics.json';
import { Clinic } from '../../infrastructure/configs/clinics';
import { getQueueName } from '../../infrastructure/utils/clinicCombinations';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface ConnectConfigRequest {
  action: 'get_config' | 'sync_phones' | 'update_routing';
  clinicId?: string;
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

    const body = parseBody(event.body);

    switch (body.action) {
      case 'get_config':
        return await getConnectConfig(body.clinicId, corsHeaders);
      case 'sync_phones':
        return await syncPhoneNumbers(corsHeaders);
      case 'update_routing':
        return await updateClinicRouting(body.clinicId, corsHeaders);
      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, message: 'Invalid action' }),
        };
    }
  } catch (err: any) {
    console.error('Connect config error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Internal Server Error' }),
    };
  }
};

async function getConnectConfig(clinicId: string | undefined, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    let clinics = clinicsData as Clinic[];

    if (clinicId) {
      clinics = clinics.filter(c => c.clinicId === clinicId);
    }

    const config = {
      instanceId: CONNECT_INSTANCE_ID,
      region: process.env.AWS_REGION || 'us-east-1',
      clinics: clinics.map(clinic => ({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        phoneNumber: clinic.phoneNumber,
        timeZone: clinic.timeZone || 'America/New_York',
        connectPhoneNumberId: clinic.connectPhoneNumberId,
        connectQueueId: clinic.connectQueueId,
        connectRoutingProfileId: clinic.connectRoutingProfileId,
      })),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        config,
        message: 'Connect configuration retrieved',
      }),
    };
  } catch (err: any) {
    console.error('Get Connect config error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to get Connect config' }),
    };
  }
}

async function syncPhoneNumbers(corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    console.log('Getting Connect configuration...');

    // Get all Connect resources (Connect-native approach)
    const [phoneNumbersResponse, queuesResponse, routingProfilesResponse, contactFlowsResponse] = await Promise.all([
      connect.send(new ListPhoneNumbersCommand({ InstanceId: CONNECT_INSTANCE_ID })),
      connect.send(new ListQueuesCommand({ InstanceId: CONNECT_INSTANCE_ID })),
      connect.send(new ListRoutingProfilesCommand({ InstanceId: CONNECT_INSTANCE_ID })),
      connect.send(new ListContactFlowsCommand({ InstanceId: CONNECT_INSTANCE_ID })),
    ]);

    const phoneNumbers = phoneNumbersResponse.PhoneNumberSummaryList || [];

    // Update clinic configuration with Connect phone number IDs
    const clinics = clinicsData as Clinic[];
    const updates: any[] = [];

    for (const clinic of clinics) {
      if (clinic.phoneNumber) {
        const connectPhone = phoneNumbers.find(p =>
          p.PhoneNumber && p.PhoneNumber.replace('+', '') === clinic.phoneNumber!.replace('+', '')
        );

        if (connectPhone) {
          // Get additional Connect resources for this clinic (Connect-native approach)
          const clinicQueue = queuesResponse.QueueSummaryList?.find(q => q.Name === getQueueName(clinic.clinicId));
          const clinicFlow = contactFlowsResponse.ContactFlowSummaryList?.find(f =>
            f.Name === `${clinic.clinicName} Flow`
          );

          updates.push({
            clinicId: clinic.clinicId,
            phoneNumber: clinic.phoneNumber,
            connectPhoneNumberId: connectPhone.Id,
            connectPhoneNumberArn: connectPhone.Arn,
            queueId: clinicQueue?.Id,
            queueArn: clinicQueue?.Arn,
            contactFlowId: clinicFlow?.Id,
            contactFlowArn: clinicFlow?.Arn,
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        updates,
        message: 'Connect configuration retrieved successfully',
        data: {
          phoneNumbers,
          queues: queuesResponse.QueueSummaryList,
          routingProfiles: routingProfilesResponse.RoutingProfileSummaryList,
          contactFlows: contactFlowsResponse.ContactFlowSummaryList,
        },
      }),
    };
  } catch (err: any) {
    console.error('Sync phone numbers error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to sync phone numbers' }),
    };
  }
}

async function updateClinicRouting(clinicId: string | undefined, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    if (!clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'clinicId is required' }),
      };
    }

    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    if (!clinic) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, message: 'Clinic not found' }),
      };
    }

    // Update routing configuration for the clinic
    const routingConfig = {
      clinicId,
      phoneNumber: clinic.phoneNumber,
      timeZone: clinic.timeZone || 'America/New_York',
      operatingHours: {
        monday: { open: '08:00', close: '17:00' },
        tuesday: { open: '08:00', close: '17:00' },
        wednesday: { open: '08:00', close: '17:00' },
        thursday: { open: '08:00', close: '17:00' },
        friday: { open: '08:00', close: '17:00' },
        saturday: { open: '08:00', close: '12:00' },
        sunday: { open: false },
      },
      afterHoursAction: 'chatbot',
      maxWaitTime: 30, // seconds
      updatedAt: Date.now(),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Clinic routing configuration retrieved successfully (Connect-native)',
        data: routingConfig,
      }),
    };
  } catch (err: any) {
    console.error('Update clinic routing error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, message: err?.message || 'Failed to update clinic routing' }),
    };
  }
}

function parseBody(body: any): ConnectConfigRequest {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
    // Ensure required fields are present
    return {
      action: parsed.action || 'get_config',
      clinicId: parsed.clinicId,
    };
  } catch {
    return {
      action: 'get_config',
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

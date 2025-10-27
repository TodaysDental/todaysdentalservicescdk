import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConnectClient, CreateHoursOfOperationCommand, UpdateHoursOfOperationCommand, DescribeHoursOfOperationCommand, DeleteHoursOfOperationCommand } from '@aws-sdk/client-connect';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import clinicsData from '../../infrastructure/configs/clinics.json';
import { Clinic } from '../../infrastructure/configs/clinics';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface ClinicHoursData {
  clinicId: string;
  monday?: { open: string; close: string; closed?: boolean };
  tuesday?: { open: string; close: string; closed?: boolean };
  wednesday?: { open: string; close: string; closed?: boolean };
  thursday?: { open: string; close: string; closed?: boolean };
  friday?: { open: string; close: string; closed?: boolean };
  saturday?: { open: string; close: string; closed?: boolean };
  sunday?: { open: string; close: string; closed?: boolean };
  timeZone?: string;
  connectHoursOfOperationId?: string;
  updatedAt: number;
  updatedBy: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({ ok: true }, event);

  try {
    // Verify authentication
    const authz = event?.headers?.authorization || event?.headers?.Authorization || '';
    const verifyResult = await verifyIdToken(authz);
    if (!verifyResult.ok) {
      return err(401, verifyResult.message, event);
    }

    const caller = callerAuthContextFromClaims(verifyResult.payload!);
    const path = event.resource || '';
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;

    // Check access control
    if (clinicId && !hasClinicAccess(caller, clinicId)) {
      return err(403, 'Access denied to this clinic', event);
    }

    // Legacy routes: /hours and /hours/{clinicId}
    if (path.endsWith('/hours') && method === 'GET') return listHours(event, caller);
    if (path.endsWith('/hours') && method === 'POST') return createHours(event, caller);
    if (path.endsWith('/hours/{clinicId}') && method === 'GET') return getHours(event, caller, clinicId!);
    if (path.endsWith('/hours/{clinicId}') && method === 'PUT') return updateHours(event, caller, clinicId!);
    if (path.endsWith('/hours/{clinicId}') && method === 'DELETE') return deleteHours(event, caller, clinicId!);

    // New routes: /clinics/{clinicId}/hours
    if (path.includes('/clinics/') && path.endsWith('/hours') && method === 'GET') return getHours(event, caller, clinicId!);
    if (path.includes('/clinics/') && path.endsWith('/hours') && method === 'PUT') return updateHours(event, caller, clinicId!);

    return err(404, 'not found', event);
  } catch (e: any) {
    console.error('Hours API error:', e);
    return err(500, e?.message || 'error', event);
  }
};

async function listHours(event: APIGatewayProxyEvent, caller: any): Promise<APIGatewayProxyResult> {
  try {
    let resp;
    if (caller.isSuperAdmin) {
      // Super admin can see all clinic hours
      resp = await ddb.send(new ScanCommand({ TableName: TABLE, Limit: 200 }));
    } else {
      // Regular users only see hours for clinics they have access to
      const accessibleClinics = Object.keys(caller.rolesByClinic);
      if (accessibleClinics.length === 0) {
        return ok({ items: [] }, event);
      }

      const items: any[] = [];
      for (const clinicId of accessibleClinics) {
        const clinicResp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { clinicId } }));
        if (clinicResp.Item) {
          items.push(clinicResp.Item);
        }
      }
      resp = { Items: items };
    }

    return ok({ items: resp.Items || [] }, event);
  } catch (error: any) {
    console.error('Error listing hours:', error);
    return err(500, 'Failed to list clinic hours', event);
  }
}

async function createHours(event: APIGatewayProxyEvent, caller: any): Promise<APIGatewayProxyResult> {
  try {
    const body = parse(event.body);
    const clinicId = String(body.clinicId || '').trim();
    if (!clinicId) return err(400, 'clinicId required', event);

    // Check if user has access to this clinic
    if (!hasClinicAccess(caller, clinicId)) {
      return err(403, 'Access denied to this clinic', event);
    }

    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    if (!clinic) {
      return err(404, 'Clinic not found', event);
    }

    // Validate hours data
    const hoursData = validateHoursData(body);
    if (!hoursData.valid) {
      return err(400, hoursData.message, event);
    }

    // Create Connect Hours of Operation first
    const connectHoursResult = await createConnectHoursOfOperation(clinicId, body, clinic.timeZone || 'America/New_York');
    if (!connectHoursResult.success) {
      return err(500, 'Failed to create Connect hours: ' + connectHoursResult.message, event);
    }

    // Save to DynamoDB
    const item: ClinicHoursData = {
      clinicId,
      ...body,
      timeZone: clinic.timeZone || 'America/New_York',
      connectHoursOfOperationId: connectHoursResult.hoursOfOperationId,
      updatedAt: Date.now(),
      updatedBy: caller.userId,
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return ok({
      clinicId,
      connectHoursOfOperationId: connectHoursResult.hoursOfOperationId,
      message: 'Clinic hours created successfully'
    }, event);
  } catch (error: any) {
    console.error('Error creating hours:', error);
    return err(500, 'Failed to create clinic hours', event);
  }
}

async function getHours(event: APIGatewayProxyEvent, caller: any, clinicId: string): Promise<APIGatewayProxyResult> {
  try {
    const resp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { clinicId } }));
    if (!resp.Item) return err(404, 'not found', event);
    return ok(resp.Item, event);
  } catch (error: any) {
    console.error('Error getting hours:', error);
    return err(500, 'Failed to get clinic hours', event);
  }
}

async function updateHours(event: APIGatewayProxyEvent, caller: any, clinicId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = parse(event.body);

    // Validate hours data
    const hoursData = validateHoursData(body);
    if (!hoursData.valid) {
      return err(400, hoursData.message, event);
    }

    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    if (!clinic) {
      return err(404, 'Clinic not found', event);
    }

    // Get existing hours
    const existingResp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { clinicId } }));
    const existingItem = existingResp.Item as ClinicHoursData;

    let connectHoursResult;
    if (existingItem?.connectHoursOfOperationId) {
      // Update existing Connect Hours of Operation
      connectHoursResult = await updateConnectHoursOfOperation(
        existingItem.connectHoursOfOperationId,
        body,
        clinic.timeZone || 'America/New_York'
      );
    } else {
      // Create new Connect Hours of Operation
      connectHoursResult = await createConnectHoursOfOperation(clinicId, body, clinic.timeZone || 'America/New_York');
    }

    if (!connectHoursResult.success) {
      return err(500, 'Failed to update Connect hours: ' + connectHoursResult.message, event);
    }

    // Update DynamoDB
    const item: ClinicHoursData = {
      clinicId,
      ...body,
      timeZone: clinic.timeZone || 'America/New_York',
      connectHoursOfOperationId: connectHoursResult.hoursOfOperationId,
      updatedAt: Date.now(),
      updatedBy: caller.userId,
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return ok({
      clinicId,
      connectHoursOfOperationId: connectHoursResult.hoursOfOperationId,
      message: 'Clinic hours updated successfully'
    }, event);
  } catch (error: any) {
    console.error('Error updating hours:', error);
    return err(500, 'Failed to update clinic hours', event);
  }
}

async function deleteHours(event: APIGatewayProxyEvent, caller: any, clinicId: string): Promise<APIGatewayProxyResult> {
  try {
    // Get existing hours to find Connect Hours of Operation ID
    const existingResp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { clinicId } }));
    const existingItem = existingResp.Item as ClinicHoursData;

    if (existingItem?.connectHoursOfOperationId) {
      // Delete from Connect
      const deleteResult = await deleteConnectHoursOfOperation(existingItem.connectHoursOfOperationId);
      if (!deleteResult.success) {
        console.warn('Failed to delete Connect hours:', deleteResult.message);
        // Continue with DynamoDB deletion even if Connect deletion fails
      }
    }

    // Delete from DynamoDB
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { clinicId } }));

    return ok({ clinicId, message: 'Clinic hours deleted successfully' }, event);
  } catch (error: any) {
    console.error('Error deleting hours:', error);
    return err(500, 'Failed to delete clinic hours', event);
  }
}

async function createConnectHoursOfOperation(clinicId: string, hoursData: any, timeZone: string): Promise<{ success: boolean; hoursOfOperationId?: string; message: string }> {
  try {
    const connectHours = convertToConnectOperatingHours(hoursData);

    const command = new CreateHoursOfOperationCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      Name: `Clinic Hours - ${clinicId}`,
      Description: `Operating hours for clinic ${clinicId}`,
      TimeZone: timeZone,
      Config: connectHours,
    });

    const result = await connect.send(command);

    return {
      success: true,
      hoursOfOperationId: result.HoursOfOperationId,
      message: 'Connect hours of operation created successfully'
    };
  } catch (error: any) {
    console.error('Error creating Connect hours:', error);
    return {
      success: false,
      message: error.message || 'Failed to create Connect hours of operation'
    };
  }
}

async function updateConnectHoursOfOperation(hoursOfOperationId: string, hoursData: any, timeZone: string): Promise<{ success: boolean; hoursOfOperationId?: string; message: string }> {
  try {
    const connectHours = convertToConnectOperatingHours(hoursData);

    const command = new UpdateHoursOfOperationCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      HoursOfOperationId: hoursOfOperationId,
      Name: `Clinic Hours - Updated ${Date.now()}`,
      Description: `Updated operating hours`,
      TimeZone: timeZone,
      Config: connectHours,
    });

    await connect.send(command);

    return {
      success: true,
      hoursOfOperationId: hoursOfOperationId,
      message: 'Connect hours of operation updated successfully'
    };
  } catch (error: any) {
    console.error('Error updating Connect hours:', error);
    return {
      success: false,
      message: error.message || 'Failed to update Connect hours of operation'
    };
  }
}

async function deleteConnectHoursOfOperation(hoursOfOperationId: string): Promise<{ success: boolean; message: string }> {
  try {
    const command = new DeleteHoursOfOperationCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      HoursOfOperationId: hoursOfOperationId,
    });

    await connect.send(command);

    return {
      success: true,
      message: 'Connect hours of operation deleted successfully'
    };
  } catch (error: any) {
    console.error('Error deleting Connect hours:', error);
    return {
      success: false,
      message: error.message || 'Failed to delete Connect hours of operation'
    };
  }
}

function convertToConnectOperatingHours(hoursData: any): any[] {
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const connectDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  const operatingHours: any[] = [];

  dayNames.forEach((day, index) => {
    const dayData = hoursData[day];
    if (dayData && !dayData.closed && dayData.open && dayData.close) {
      operatingHours.push({
        Day: connectDays[index],
        StartTime: dayData.open,
        EndTime: dayData.close,
      });
    }
  });

  return operatingHours;
}

function validateHoursData(body: any): { valid: boolean; message: string } {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (const day of days) {
    const dayData = body[day];
    if (dayData && !dayData.closed) {
      if (!dayData.open || !dayData.close) {
        return { valid: false, message: `${day} requires both open and close times when not closed` };
      }

      // Validate time format (HH:MM)
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(dayData.open) || !timeRegex.test(dayData.close)) {
        return { valid: false, message: `${day} times must be in HH:MM format` };
      }

      // Validate that close time is after open time
      if (dayData.open >= dayData.close) {
        return { valid: false, message: `${day} close time must be after open time` };
      }
    }
  }

  return { valid: true, message: 'Valid hours data' };
}

function hasClinicAccess(caller: any, clinicId: string): boolean {
  if (caller.isSuperAdmin) return true;
  return Object.keys(caller.rolesByClinic).includes(clinicId);
}

function parse(body: any): any {
  try {
    return typeof body === 'string' ? JSON.parse(body) : (body || {});
  } catch {
    return {};
  }
}

async function verifyIdToken(token: string): Promise<{ ok: boolean; code: number; message: string; payload?: JWTPayload }> {
  if (!token) return { ok: false, code: 401, message: 'No token provided' };

  try {
    const jwks = createRemoteJWKSet(new URL(`https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token.replace('Bearer ', ''), jwks, {
      issuer: `https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${USER_POOL_ID}`
    });
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

function ok(data: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: buildCorsHeaders({}, event.headers?.origin),
    body: JSON.stringify({ success: true, ...data })
  };
}

function err(code: number, message: string, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: code,
    headers: buildCorsHeaders({}, event.headers?.origin),
    body: JSON.stringify({ success: false, message })
  };
}



import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import axios from 'axios';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  isAdminUser,
  hasModulePermission,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import clinicsData from '../../infrastructure/configs/clinics.json';
import { Clinic } from '../../infrastructure/configs/clinics';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';
const SCHEDULES_API_URL = process.env.SCHEDULES_API_URL;
const DEFAULT_TIME_ZONE = 'America/New_York';
const SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const CLOSED_HOURS = { open: '', close: '', closed: true };

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
  updatedAt: number;
  updatedBy: string;
}

interface ScheduleBlock {
  ScheduleNum: string;
  SchedDate: string; // e.g., "2025-11-29"
  StartTime: string; // e.g., "07:00:00"
  StopTime: string;  // e.g., "15:00:00"
  [key: string]: any;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({ ok: true }, event);

  try {
    // Get user permissions from custom authorizer
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return err(401, 'Unauthorized - Invalid token', event);
    }

    const path = event.resource || '';
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;

    // Check access control for Operations module
    if (clinicId && !hasModulePermission(
      userPerms.clinicRoles,
      'Operations',
      method === 'GET' ? 'read' : 'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    )) {
      return err(403, 'You do not have permission to access clinic hours for this clinic', event);
    }

    // Check general access for list/create operations
    if (!clinicId && method !== 'GET' && !hasModulePermission(
      userPerms.clinicRoles,
      'Operations',
      'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    )) {
      return err(403, 'You do not have permission to modify clinic hours', event);
    }

    // Legacy routes: /hours and /hours/{clinicId}
    if (path.endsWith('/hours') && method === 'GET') return listHours(event, userPerms);
    if (path.endsWith('/hours') && method === 'POST') return createHours(event, userPerms);
    if (path.endsWith('/hours/{clinicId}') && method === 'GET') return getHours(event, userPerms, clinicId!);
    if (path.endsWith('/hours/{clinicId}') && method === 'PUT') return updateHours(event, userPerms, clinicId!);
    if (path.endsWith('/hours/{clinicId}') && method === 'DELETE') return deleteHours(event, userPerms, clinicId!);

    // New routes: /clinics/{clinicId}/hours
    if (path.includes('/clinics/') && path.endsWith('/hours') && method === 'GET') return getHours(event, userPerms, clinicId!);
    if (path.includes('/clinics/') && path.endsWith('/hours') && method === 'PUT') return updateHours(event, userPerms, clinicId!);

    return err(404, 'not found', event);
  } catch (e: any) {
    console.error('Hours API error:', e);
    return err(500, e?.message || 'error', event);
  }
};

async function listHours(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  try {
    let resp;
    if (isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
      // Admin users can see all clinic hours
      resp = await ddb.send(new ScanCommand({ TableName: TABLE, Limit: 200 }));
    } else {
      // Regular users only see hours for clinics they have access to
      const accessibleClinics = userPerms.clinicRoles.map((cr) => cr.clinicId);
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

async function createHours(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  try {
    const body = parse(event.body);
    const clinicId = String(body.clinicId || '').trim();
    if (!clinicId) return err(400, 'clinicId required', event);

    // Check if user has write permission for Operations module at this clinic
    if (!hasModulePermission(
      userPerms.clinicRoles,
      'Operations',
      'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    )) {
      return err(403, 'You do not have permission to create clinic hours for this clinic', event);
    }

    const clinic = (clinicsData as Clinic[]).find(c => c.clinicId === clinicId);
    if (!clinic) {
      return err(404, 'Clinic not found', event);
    }

    const shouldPopulate = wantsSchedulePopulate(body, event);
    let populatedBody = body;

    if (shouldPopulate) {
      try {
        populatedBody = await populateClinicHoursFromSchedules(clinicId, body);
      } catch (populateErr: any) {
        console.error('Failed to populate hours from schedules API:', populateErr?.message || populateErr);
        return err(502, 'Failed to populate clinic hours from schedules', event);
      }
    }

    // Validate hours data
    const hoursData = validateHoursData(populatedBody);
    if (!hoursData.valid) {
      return err(400, hoursData.message, event);
    }

    // Save to DynamoDB
    const item: ClinicHoursData = {
      clinicId,
      ...stripControlFields(populatedBody),
      timeZone: clinic.timeZone || DEFAULT_TIME_ZONE,
      updatedAt: Date.now(),
      updatedBy: userPerms.email,
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return ok({
      clinicId,
      message: 'Clinic hours created successfully'
    }, event);
  } catch (error: any) {
    console.error('Error creating hours:', error);
    return err(500, 'Failed to create clinic hours', event);
  }
}

async function getHours(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicId: string): Promise<APIGatewayProxyResult> {
  try {
    const resp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { clinicId } }));
    if (!resp.Item) return err(404, 'not found', event);
    return ok(resp.Item, event);
  } catch (error: any) {
    console.error('Error getting hours:', error);
    return err(500, 'Failed to get clinic hours', event);
  }
}

async function updateHours(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = parse(event.body);

    const shouldPopulate = wantsSchedulePopulate(body, event);
    let populatedBody = body;

    if (shouldPopulate) {
      try {
        populatedBody = await populateClinicHoursFromSchedules(clinicId, body);
      } catch (populateErr: any) {
        console.error('Failed to populate hours from schedules API:', populateErr?.message || populateErr);
        return err(502, 'Failed to populate clinic hours from schedules', event);
      }
    }

    // Validate hours data
    const hoursData = validateHoursData(populatedBody);
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

    // Update DynamoDB
    const item: ClinicHoursData = {
      clinicId,
      ...stripControlFields(populatedBody),
      timeZone: clinic.timeZone || DEFAULT_TIME_ZONE,
      updatedAt: Date.now(),
      updatedBy: userPerms.email,
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return ok({
      clinicId,
      message: 'Clinic hours updated successfully'
    }, event);
  } catch (error: any) {
    console.error('Error updating hours:', error);
    return err(500, 'Failed to update clinic hours', event);
  }
}

async function deleteHours(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicId: string): Promise<APIGatewayProxyResult> {
  try {
    // Delete from DynamoDB
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { clinicId } }));

    return ok({ clinicId, message: 'Clinic hours deleted successfully' }, event);
  } catch (error: any) {
    console.error('Error deleting hours:', error);
    return err(500, 'Failed to delete clinic hours', event);
  }
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

function wantsSchedulePopulate(body: any, event: APIGatewayProxyEvent): boolean {
  const qs = event.queryStringParameters || {};
  return Boolean(
    body?.populateFromSchedules ||
    body?.autoPopulate ||
    qs.populateFromSchedules === 'true' ||
    qs.autoPopulate === 'true'
  );
}

async function populateClinicHoursFromSchedules(
  clinicId: string,
  body: any
): Promise<any> {
  if (!SCHEDULES_API_URL) {
    throw new Error('SCHEDULES_API_URL is not configured');
  }

  try {
    const { dateStart, dateEnd } = getCurrentWeekBounds();
    const schedulesUrl = `${SCHEDULES_API_URL}/${clinicId}?dateStart=${dateStart}&dateEnd=${dateEnd}`;

    const response = await axios.get(schedulesUrl);
    const scheduleBlocks: ScheduleBlock[] = response.data.items || response.data || [];

    const finalHours: Record<string, any> = {};
    SCHEDULE_DAYS.forEach(day => {
      finalHours[day] = { ...CLOSED_HOURS };
    });

    if (scheduleBlocks.length > 0) {
      const grouped = scheduleBlocks.reduce((acc, block) => {
        const dateKey = block.SchedDate;
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(block);
        return acc;
      }, {} as Record<string, ScheduleBlock[]>);

      for (const date of Object.keys(grouped)) {
        const dailyBlocks = grouped[date];
        const { dayName, hours } = deriveDailyHours(dailyBlocks, date);
        if (hours) {
          finalHours[dayName] = hours;
        }
      }
    }

    // Merge derived hours over the inbound body so manual overrides are still possible
    return { ...body, ...finalHours };
  } catch (error: any) {
    console.error('Failed to populate hours from schedules API:', error?.message || error);
    throw new Error('Failed to fetch schedules to populate clinic hours');
  }
}

function deriveDailyHours(
  dailyScheduleBlocks: ScheduleBlock[],
  date: string
): { dayName: string; hours?: { open: string; close: string; closed?: boolean } } {
  let minOpenTime: string | null = null;
  let maxCloseTime: string | null = null;

  const dayName = new Date(date).toLocaleString('en-us', { weekday: 'long' }).toLowerCase();

  for (const block of dailyScheduleBlocks) {
    const startTime = block.StartTime;
    const stopTime = block.StopTime;
    if (!startTime || !stopTime) continue;

    if (minOpenTime === null || startTime < minOpenTime) {
      minOpenTime = startTime;
    }

    if (maxCloseTime === null || stopTime > maxCloseTime) {
      maxCloseTime = stopTime;
    }
  }

  if (minOpenTime && maxCloseTime) {
    return {
      dayName,
      hours: {
        open: minOpenTime.substring(0, 5),
        close: maxCloseTime.substring(0, 5),
        closed: false,
      },
    };
  }

  return { dayName, hours: { ...CLOSED_HOURS } };
}

function getCurrentWeekBounds() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);

  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);

  const formatDate = (date: Date) => date.toISOString().split('T')[0];

  return {
    dateStart: formatDate(monday),
    dateEnd: formatDate(saturday),
  };
}

function stripControlFields(body: any) {
  const { populateFromSchedules, autoPopulate, ...rest } = body || {};
  return rest;
}

function parse(body: any): any {
  try {
    return typeof body === 'string' ? JSON.parse(body) : (body || {});
  } catch {
    return {};
  }
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



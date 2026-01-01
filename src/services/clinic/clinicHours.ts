import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import axios from 'axios';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  isAdminUser,
  hasModulePermission,
  UserPermissions,
} from '../../shared/utils/permissions-helper';
import { 
  getClinicConfig, 
  getClinicSecrets, 
  getAllClinicConfigs,
  ClinicConfig, 
  ClinicSecrets 
} from '../../shared/utils/secrets-helper';

// --- CONFIGURATION & CLIENTS ---
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.CLINIC_HOURS_TABLE || 'ClinicHours';

// OpenDental API configuration - call directly instead of through the authenticated proxy
const OPEN_DENTAL_API_HOST = 'https://api.opendental.com';
const OPEN_DENTAL_API_BASE = '/api/v1';
const ALL_CLINIC_IDS = process.env.ALL_CLINIC_IDS?.split(',').map(id => id.trim()).filter(id => id.length > 0) || [];

// Cache for clinic credentials (populated on demand from DynamoDB)
interface ClinicCredentials {
  developerKey: string;
  customerKey: string;
  timeZone: string;
}
const clinicCredsCache: Record<string, ClinicCredentials> = {};

/**
 * Get clinic credentials from DynamoDB (cached)
 */
async function getClinicCredentials(clinicId: string): Promise<ClinicCredentials | null> {
  if (clinicCredsCache[clinicId]) {
    return clinicCredsCache[clinicId];
  }

  const [config, secrets] = await Promise.all([
    getClinicConfig(clinicId),
    getClinicSecrets(clinicId),
  ]);

  if (!config || !secrets) {
    console.warn(`No credentials found for clinic: ${clinicId}`);
    return null;
  }

  const creds: ClinicCredentials = {
    developerKey: secrets.openDentalDeveloperKey,
    customerKey: secrets.openDentalCustomerKey,
    timeZone: config.timezone || 'America/New_York',
  };

  clinicCredsCache[clinicId] = creds;
  return creds;
}

// --- INTERFACES ---

interface ClinicHoursItem {
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

// ==========================================
// HANDLER 1: SCHEDULER (Background Cron Job)
// ==========================================
export const schedulerHandler = async (): Promise<APIGatewayProxyResult> => {
    console.log(`Starting hourly clinic hours update for ${ALL_CLINIC_IDS.length} clinics.`);
    const { dateStart, dateEnd } = getCurrentWeekBounds();
    console.log(`Fetching schedules from ${dateStart} (Monday) to ${dateEnd} (Saturday)`);

    if (ALL_CLINIC_IDS.length === 0) {
        console.warn("No clinic IDs configured. Exiting.");
        return { statusCode: 200, body: JSON.stringify({ message: "No clinics to process." }) };
    }
    
    const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const closedHoursDefault = { open: '', close: '', closed: true };

    let successCount = 0;
    let errorCount = 0;

    for (const clinicId of ALL_CLINIC_IDS) {
        if (!clinicId) continue;
        
        try {
            console.log(`Processing clinic: ${clinicId}`);

            // Get clinic credentials from DynamoDB
            const creds = await getClinicCredentials(clinicId);
            if (!creds || !creds.developerKey || !creds.customerKey) {
                console.warn(`No OpenDental credentials found for clinic: ${clinicId}. Skipping.`);
                errorCount++;
                continue;
            }

            // Call OpenDental API directly with ODFHIR authentication
            const schedulesPath = `${OPEN_DENTAL_API_BASE}/schedules?dateStart=${dateStart}&dateEnd=${dateEnd}`;
            const response = await axios.get(`${OPEN_DENTAL_API_HOST}${schedulesPath}`, {
                headers: {
                    'Authorization': `ODFHIR ${creds.developerKey}/${creds.customerKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 30000, // 30 second timeout
            });
            
            const fullWeekScheduleData: ScheduleBlock[] = response.data || []; 

            // Initialize DynamoDB item with defaults
            let finalHoursItem: ClinicHoursItem = {
                clinicId,
                updatedAt: Date.now(),
                updatedBy: 'AutomatedScheduler',
                timeZone: creds.timeZone || 'America/New_York', 
            };
            
            // Set all days to closed by default
            daysOfWeek.forEach(day => {
                (finalHoursItem as any)[day] = closedHoursDefault;
            });
            
            if (fullWeekScheduleData.length > 0) {
                // Group blocks by date
                const dailyGroupedData = fullWeekScheduleData.reduce((acc, block) => {
                    const dateKey = block.SchedDate;
                    if (!acc[dateKey]) acc[dateKey] = [];
                    acc[dateKey].push(block);
                    return acc;
                }, {} as Record<string, ScheduleBlock[]>);

                // Derive hours for days that have data
                for (const date of Object.keys(dailyGroupedData)) {
                    const dailyBlocks = dailyGroupedData[date];
                    const { dayName, hours } = deriveDailyHours(dailyBlocks, date);
                    
                    if (hours) {
                        (finalHoursItem as any)[dayName] = hours;
                    }
                }
            }
            
            // Save to DB
            await ddb.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: finalHoursItem,
            }));

            console.log(`Successfully updated clinic hours for ${clinicId}`);
            successCount++;

        } catch (error: any) {
            errorCount++;
            const errorDetails = error.response?.data || error.message;
            console.error(`Failed to update clinic hours for ${clinicId}. Error:`, JSON.stringify(errorDetails));
        }
    }

    console.log(`Clinic hours update finished. Success: ${successCount}, Errors: ${errorCount}`);
    return {
        statusCode: 200,
        body: JSON.stringify({ 
            message: `Clinic hours update finished.`,
            successCount,
            errorCount,
            totalClinics: ALL_CLINIC_IDS.length 
        }),
    };
};

// ==========================================
// HANDLER 2: API (Frontend CRUD)
// ==========================================
export const apiHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({ ok: true }, event);

  try {
    const userPerms = getUserPermissions(event);
    if (!userPerms) return err(401, 'Unauthorized', event);

    const path = event.resource || '';
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;

    // Permissions Checks
    if (clinicId && !hasModulePermission(
      userPerms.clinicRoles, 'Operations', method === 'GET' ? 'read' : 'write',
      userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin, clinicId
    )) {
      return err(403, 'Permission denied', event);
    }

    if (!clinicId && method !== 'GET' && !hasModulePermission(
      userPerms.clinicRoles, 'Operations', 'write',
      userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin
    )) {
      return err(403, 'Permission denied', event);
    }

    // Routing Logic
    // Support both legacy (/hours) and new (/clinics/.../hours) paths
    if (path.endsWith('/hours')) {
        if (method === 'GET' && !path.includes('/clinics/')) return listHours(event, userPerms); // List all
        if (method === 'GET' && path.includes('/clinics/')) return getHours(event, userPerms, clinicId!); // Get one
        if (method === 'POST') return createHours(event, userPerms);
        if (method === 'PUT') return updateHours(event, userPerms, clinicId!);
    }
    
    if (path.endsWith('/hours/{clinicId}')) {
        if (method === 'GET') return getHours(event, userPerms, clinicId!);
        if (method === 'PUT') return updateHours(event, userPerms, clinicId!);
        if (method === 'DELETE') return deleteHours(event, userPerms, clinicId!);
    }

    return err(404, 'not found', event);
  } catch (e: any) {
    console.error('Hours API error:', e);
    return err(500, e?.message || 'error', event);
  }
};

// --- CRUD HELPER FUNCTIONS ---

async function listHours(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
  // Logic to scan table or get specific items based on permissions
  let items: any[] = [];
  if (isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
      const resp = await ddb.send(new ScanCommand({ TableName: TABLE_NAME, Limit: 200 }));
      items = resp.Items || [];
  } else {
      const accessibleClinics = userPerms.clinicRoles.map((cr) => cr.clinicId);
      for (const clinicId of accessibleClinics) {
        const clinicResp = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { clinicId } }));
        if (clinicResp.Item) items.push(clinicResp.Item);
      }
  }
  return ok({ items }, event);
}

async function createHours(event: APIGatewayProxyEvent, userPerms: UserPermissions): Promise<APIGatewayProxyResult> {
    const body = parse(event.body);
    const clinicId = String(body.clinicId || '').trim();
    if (!clinicId) return err(400, 'clinicId required', event);
    return saveHours(clinicId, body, userPerms, event, true);
}

async function updateHours(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicId: string): Promise<APIGatewayProxyResult> {
    const body = parse(event.body);
    return saveHours(clinicId, body, userPerms, event, false);
}

async function saveHours(clinicId: string, body: any, userPerms: UserPermissions, event: APIGatewayProxyEvent, isCreate: boolean) {
    const config = await getClinicConfig(clinicId);
    if (!config) return err(404, 'Clinic not found', event);

    const hoursData = validateHoursData(body);
    if (!hoursData.valid) return err(400, hoursData.message, event);

    const item: ClinicHoursItem = {
      clinicId,
      ...body,
      timeZone: config.timezone || 'America/New_York',
      updatedAt: Date.now(),
      updatedBy: userPerms.email,
    };

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return ok({ clinicId, message: isCreate ? 'Created' : 'Updated' }, event);
}

async function getHours(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicId: string): Promise<APIGatewayProxyResult> {
  const resp = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { clinicId } }));
  if (!resp.Item) return err(404, 'not found', event);
  return ok(resp.Item, event);
}

async function deleteHours(event: APIGatewayProxyEvent, userPerms: UserPermissions, clinicId: string): Promise<APIGatewayProxyResult> {
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { clinicId } }));
  return ok({ clinicId, message: 'Deleted' }, event);
}

// --- SHARED UTILS ---

const getCurrentWeekBounds = () => {
    const today = new Date();
    const dayOfWeek = today.getDay(); 
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; 
    
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5); 

    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    return { dateStart: formatDate(monday), dateEnd: formatDate(saturday) };
};

function deriveDailyHours(dailyScheduleBlocks: ScheduleBlock[], date: string): { dayName: string; hours?: { open: string; close: string; closed?: boolean } } {
    let minOpenTime: string | null = null;
    let maxCloseTime: string | null = null;
    const dayName = new Date(date).toLocaleString('en-us', { weekday: 'long' }).toLowerCase();

    for (const block of dailyScheduleBlocks) {
        if (!block.StartTime || !block.StopTime) continue;
        if (minOpenTime === null || block.StartTime < minOpenTime) minOpenTime = block.StartTime;
        if (maxCloseTime === null || block.StopTime > maxCloseTime) maxCloseTime = block.StopTime;
    }

    if (minOpenTime && maxCloseTime) {
        return {
            dayName,
            hours: { open: minOpenTime.substring(0, 5), close: maxCloseTime.substring(0, 5), closed: false },
        };
    } 
    return { dayName, hours: { open: '', close: '', closed: true } };
}

function validateHoursData(body: any): { valid: boolean; message: string } {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const day of days) {
    const dayData = body[day];
    if (dayData && !dayData.closed) {
      if (!dayData.open || !dayData.close) return { valid: false, message: `${day} requires times` };
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(dayData.open)) return { valid: false, message: 'Invalid time format' };
      if (dayData.open >= dayData.close) return { valid: false, message: 'Close time must be after open' };
    }
  }
  return { valid: true, message: 'Valid' };
}

function parse(body: any): any { try { return typeof body === 'string' ? JSON.parse(body) : (body || {}); } catch { return {}; } }
function ok(data: any, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return { statusCode: 200, headers: buildCorsHeaders({}, event.headers?.origin), body: JSON.stringify({ success: true, ...data }) };
}
function err(code: number, message: string, event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return { statusCode: code, headers: buildCorsHeaders({}, event.headers?.origin), body: JSON.stringify({ success: false, message }) };
}

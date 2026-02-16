// services/hr/attendance.ts
// Staff Check-In / Check-Out with Geofence + WiFi + GPS validation
// Endpoints:
//   POST /checkin        — automated or manual check-in
//   POST /checkout       — automated or manual check-out
//   GET  /config         — geofence + clinic hours for mobile apps
//   GET  /history        — attendance history (staff or admin)
//   GET  /daily          — admin daily roster for a clinic
//   POST /admin/override — admin manual attendance override
//   GET  /payroll        — actual vs scheduled hours comparison

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
    getUserPermissions,
    hasModulePermission,
    isAdminUser,
    getAllowedClinicIds,
    hasClinicAccess,
    type PermissionType,
    type UserPermissions,
} from '../../shared/utils/permissions-helper';

// ========================================
// ENVIRONMENT
// ========================================
const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE!;
const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';
const SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || '';
const GEOFENCE_CONFIG_PARAM = process.env.GEOFENCE_CONFIG_PARAM || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});
const ssmClient = new SSMClient({});
const MODULE_NAME = 'HR'; // Attendance is part of the HR module
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
    GET: 'read',
    POST: 'write',
    PUT: 'write',
    DELETE: 'write',
};

// ========================================
// GEOFENCE CONFIG (loaded from SSM at cold start)
// ========================================
interface GeofenceConfigEntry {
    enabled: boolean;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    wifiSSIDs: string[];
    lateThresholdMinutes: number;
    timezone: string;
}

let _geofenceConfigCache: Record<string, GeofenceConfigEntry> | null = null;

async function getGeofenceConfig(): Promise<Record<string, GeofenceConfigEntry>> {
    if (_geofenceConfigCache) return _geofenceConfigCache;
    if (!GEOFENCE_CONFIG_PARAM) {
        _geofenceConfigCache = {};
        return _geofenceConfigCache;
    }
    try {
        const result = await ssmClient.send(new GetParameterCommand({
            Name: GEOFENCE_CONFIG_PARAM,
        }));
        _geofenceConfigCache = JSON.parse(result.Parameter?.Value || '{}');
    } catch (err) {
        console.error('Failed to load geofence config from SSM:', err);
        _geofenceConfigCache = {};
    }
    return _geofenceConfigCache!;
}

// ========================================
// HELPERS
// ========================================
const corsHeaders = buildCorsHeaders();
const httpOk = (body: any): APIGatewayProxyResult => ({
    statusCode: 200, headers: corsHeaders, body: JSON.stringify(body),
});
const httpCreated = (body: any): APIGatewayProxyResult => ({
    statusCode: 201, headers: corsHeaders, body: JSON.stringify(body),
});
const httpBad = (msg: string): APIGatewayProxyResult => ({
    statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: msg }),
});
const httpForbidden = (msg: string): APIGatewayProxyResult => ({
    statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: msg }),
});
const httpNotFound = (msg?: string): APIGatewayProxyResult => ({
    statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: msg || 'Not found' }),
});
const httpError = (msg: string): APIGatewayProxyResult => ({
    statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: msg }),
});

/** Shorthand: is this UserPermissions an admin? */
function isAdmin(p: UserPermissions): boolean {
    return isAdminUser(p.clinicRoles, p.isSuperAdmin, p.isGlobalSuperAdmin);
}

/** Shorthand: does this user have access to a clinic? */
function userHasClinicAccess(p: UserPermissions, clinicId: string): boolean {
    const allowed = getAllowedClinicIds(p.clinicRoles, p.isSuperAdmin, p.isGlobalSuperAdmin);
    return hasClinicAccess(allowed, clinicId);
}

/** Haversine distance in meters between two lat/lng points */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Get today's date string (YYYY-MM-DD) in the clinic's timezone */
function todayInTimezone(tz: string): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz }); // en-CA gives YYYY-MM-DD
}

/** Day of week (0=Sun..6=Sat) in clinic timezone */
function dayOfWeekInTz(tz: string): number {
    const dayStr = new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[dayStr] ?? 0;
}

// ========================================
// VALIDATION CHAIN
// ========================================

/** Check if staff member is on-premises (not remote) */
async function isOnPremiseStaff(userId: string, clinicId: string): Promise<{ ok: boolean; reason?: string }> {
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: STAFF_INFO_TABLE,
            KeyConditionExpression: 'email = :email',
            FilterExpression: 'clinicId = :cid',
            ExpressionAttributeValues: { ':email': userId, ':cid': clinicId },
            Limit: 1,
        }));
        if (!result.Items || result.Items.length === 0) {
            return { ok: false, reason: 'Staff not assigned to this clinic' };
        }
        const info = result.Items[0];
        const workLocation = info.workLocation || {};
        if (workLocation.isRemote && !workLocation.isOnPremise) {
            return { ok: false, reason: 'Remote staff cannot check in at clinic' };
        }
        return { ok: true };
    } catch (err) {
        console.error('isOnPremiseStaff error:', err);
        return { ok: true }; // fail-open — don't block checkins if StaffClinicInfo is unavailable
    }
}

/** Check if clinic is currently open (within operating hours) */
async function isWithinClinicHours(clinicId: string, tz: string): Promise<{ ok: boolean; reason?: string }> {
    try {
        const dow = dayOfWeekInTz(tz);
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dow];

        const result = await ddb.send(new GetCommand({
            TableName: CLINIC_HOURS_TABLE,
            Key: { clinicId },
        }));
        if (!result.Item) {
            return { ok: true }; // no hours record → allow (fail-open)
        }
        const hours = result.Item;
        const dayHours = hours[dayName] || hours[dayName.charAt(0).toUpperCase() + dayName.slice(1)];
        if (!dayHours) {
            return { ok: false, reason: 'Clinic is closed today' };
        }
        if (dayHours.isClosed || dayHours.closed) {
            return { ok: false, reason: 'Clinic is closed today' };
        }
        return { ok: true };
    } catch (err) {
        console.error('isWithinClinicHours error:', err);
        return { ok: true }; // fail-open
    }
}

/** Check if staff has a shift today at this clinic */
async function hasShiftToday(userId: string, clinicId: string, tz: string): Promise<{
    ok: boolean;
    shift?: any;
    reason?: string;
}> {
    try {
        const today = todayInTimezone(tz);
        const startOfDay = `${today}T00:00:00`;
        const endOfDay = `${today}T23:59:59`;

        const result = await ddb.send(new QueryCommand({
            TableName: SHIFTS_TABLE,
            IndexName: 'byClinicAndDate',
            KeyConditionExpression: 'clinicId = :cid AND startTime BETWEEN :start AND :end',
            FilterExpression: 'staffId = :sid',
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':start': startOfDay,
                ':end': endOfDay,
                ':sid': userId,
            },
        }));
        if (!result.Items || result.Items.length === 0) {
            return { ok: false, reason: 'No shift scheduled for today at this clinic' };
        }
        return { ok: true, shift: result.Items[0] };
    } catch (err) {
        console.error('hasShiftToday error:', err);
        return { ok: true }; // fail-open
    }
}

function validateGeofence(clinicId: string, latitude: number, longitude: number, gcfg: Record<string, GeofenceConfigEntry>): {
    ok: boolean;
    distanceMeters: number | undefined;
    anomalies: string[];
} {
    const config = gcfg[clinicId];
    if (!config || !config.enabled) return { ok: true, distanceMeters: undefined, anomalies: [] };
    if (config.latitude === 0 && config.longitude === 0) return { ok: true, distanceMeters: undefined, anomalies: [] };

    const distance = haversineMeters(latitude, longitude, config.latitude, config.longitude);
    const anomalies: string[] = [];

    // Boundary check: within radius but barely (>80%)
    if (distance > config.radiusMeters * 0.8 && distance <= config.radiusMeters) {
        anomalies.push('boundary');
    }

    if (distance > config.radiusMeters) {
        return { ok: false, distanceMeters: Math.round(distance), anomalies: ['outside_geofence'] };
    }

    return { ok: true, distanceMeters: Math.round(distance), anomalies };
}

function classifyDetection(body: any, clinicId: string, gcfg: Record<string, GeofenceConfigEntry>): {
    method: 'wifi' | 'geofence' | 'gps' | 'manual';
    anomalies: string[];
} {
    const anomalies: string[] = [];
    const config = gcfg[clinicId];

    // Manual override (admin)
    if (body.manual) return { method: 'manual', anomalies: [] };

    // WiFi match
    if (body.wifiSSID && config?.wifiSSIDs?.length) {
        if (config.wifiSSIDs.includes(body.wifiSSID)) {
            return { method: 'wifi', anomalies };
        }
    }

    // Geofence transition (OS-level)
    if (body.geofenceTransition) {
        if (!body.wifiSSID) anomalies.push('gps_only'); // no WiFi confirmation
        return { method: 'geofence', anomalies };
    }

    // GPS-only (no WiFi, no geofence event)
    anomalies.push('gps_only');
    return { method: 'gps', anomalies };
}

function checkLateStatus(shift: any, clinicId: string, checkinTimestamp: string, gcfg: Record<string, GeofenceConfigEntry>): {
    isLate: boolean;
    lateMinutes: number;
} {
    const config = gcfg[clinicId];
    const threshold = config?.lateThresholdMinutes || 10;
    if (!shift?.startTime) return { isLate: false, lateMinutes: 0 };

    const shiftStart = new Date(shift.startTime).getTime();
    const checkinTime = new Date(checkinTimestamp).getTime();
    const diffMinutes = Math.floor((checkinTime - shiftStart) / 60000);

    if (diffMinutes > threshold) {
        return { isLate: true, lateMinutes: diffMinutes };
    }
    return { isLate: false, lateMinutes: Math.max(0, diffMinutes) };
}

/** Send FCM push notification for late arrival */
async function sendLateAlert(userId: string, clinicId: string, lateMinutes: number): Promise<void> {
    if (!SEND_PUSH_FUNCTION_ARN || !DEVICE_TOKENS_TABLE) return;
    try {
        await lambdaClient.send(new InvokeCommand({
            FunctionName: SEND_PUSH_FUNCTION_ARN,
            InvocationType: 'Event', // async — don't block check-in
            Payload: Buffer.from(JSON.stringify({
                type: 'ATTENDANCE_LATE',
                clinicId,
                title: 'Late Arrival Alert',
                body: `${userId} checked in ${lateMinutes} minutes late`,
                data: { userId, clinicId, lateMinutes, type: 'attendance_late' },
                targetRole: 'admin',
                targetClinicId: clinicId,
            })),
        }));
    } catch (err) {
        console.warn('Late alert push failed (non-critical):', err);
    }
}

// ========================================
// ROUTE HANDLERS
// ========================================

/** POST /checkin — Automated or manual check-in */
async function handleCheckin(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { clinicId, latitude, longitude, wifiSSID, geofenceTransition } = body;
    const userId = perms.email;

    if (!clinicId) return httpBad('clinicId is required');

    const gcfg = await getGeofenceConfig();
    const geoConfig = gcfg[clinicId];
    const tz = geoConfig?.timezone || 'America/New_York';
    const now = new Date().toISOString();
    const today = todayInTimezone(tz);

    // ---- Validation chain ----

    // 1. On-premises check
    const premisesCheck = await isOnPremiseStaff(userId, clinicId);
    if (!premisesCheck.ok) return httpForbidden(premisesCheck.reason!);

    // 2. Clinic hours check
    const hoursCheck = await isWithinClinicHours(clinicId, tz);
    if (!hoursCheck.ok) return httpForbidden(hoursCheck.reason!);

    // 3. Shift check
    const shiftCheck = await hasShiftToday(userId, clinicId, tz);
    if (!shiftCheck.ok) return httpForbidden(shiftCheck.reason!);

    // 4. Geofence validation (if lat/lng provided)
    let geoResult: { ok: boolean; distanceMeters: number | undefined; anomalies: string[] } = {
        ok: true, distanceMeters: undefined, anomalies: [],
    };
    if (latitude !== undefined && longitude !== undefined) {
        geoResult = validateGeofence(clinicId, latitude, longitude, gcfg);
        if (!geoResult.ok) {
            return httpForbidden(`Outside clinic geofence (${geoResult.distanceMeters}m away)`);
        }
    }

    // 5. Classify detection method and collect anomalies
    const detection = classifyDetection(body, clinicId, gcfg);
    const allAnomalies = [...new Set([...geoResult.anomalies, ...detection.anomalies])];

    // No shift → anomaly
    if (!shiftCheck.shift) allAnomalies.push('no_shift');

    // 6. Late check
    const lateStatus = checkLateStatus(shiftCheck.shift, clinicId, now, gcfg);

    // ---- Write attendance record ----
    const recordId = uuidv4();
    const record = {
        clinicId,
        'userId#timestamp': `${userId}#${now}`,
        recordId,
        userId,
        date: today,
        timestamp: now,
        type: 'checkin',
        method: detection.method,
        latitude: latitude || null,
        longitude: longitude || null,
        wifiSSID: wifiSSID || null,
        distanceMeters: geoResult.distanceMeters ?? null,
        geofenceTransition: geofenceTransition || null,
        shiftId: shiftCheck.shift?.shiftId || null,
        shiftStartTime: shiftCheck.shift?.startTime || null,
        shiftEndTime: shiftCheck.shift?.endTime || null,
        isLate: lateStatus.isLate,
        lateMinutes: lateStatus.lateMinutes,
        anomalies: allAnomalies,
        createdAt: now,
    };

    await ddb.send(new PutCommand({
        TableName: ATTENDANCE_TABLE,
        Item: record,
        ConditionExpression: 'attribute_not_exists(clinicId)', // prevent duplicate key
    }));

    // 7. Async late alert (non-blocking)
    if (lateStatus.isLate) {
        sendLateAlert(userId, clinicId, lateStatus.lateMinutes).catch(() => { });
    }

    return httpCreated({
        success: true,
        recordId,
        type: 'checkin',
        method: detection.method,
        isLate: lateStatus.isLate,
        lateMinutes: lateStatus.lateMinutes,
        anomalies: allAnomalies,
        distanceMeters: geoResult.distanceMeters,
    });
}

/** POST /checkout — Automated or manual check-out */
async function handleCheckout(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { clinicId, latitude, longitude, wifiSSID } = body;
    const userId = perms.email;

    if (!clinicId) return httpBad('clinicId is required');

    const gcfg = await getGeofenceConfig();
    const geoConfig = gcfg[clinicId];
    const tz = geoConfig?.timezone || 'America/New_York';
    const now = new Date().toISOString();
    const today = todayInTimezone(tz);

    // Find today's check-in to compute duration
    const checkinResult = await ddb.send(new QueryCommand({
        TableName: ATTENDANCE_TABLE,
        KeyConditionExpression: 'clinicId = :cid AND begins_with(#sk, :prefix)',
        FilterExpression: '#d = :today AND #t = :checkin',
        ExpressionAttributeNames: { '#sk': 'userId#timestamp', '#d': 'date', '#t': 'type' },
        ExpressionAttributeValues: {
            ':cid': clinicId,
            ':prefix': `${userId}#`,
            ':today': today,
            ':checkin': 'checkin',
        },
        ScanIndexForward: false, // latest first
        Limit: 1,
    }));

    const lastCheckin = checkinResult.Items?.[0];
    let durationMinutes: number | null = null;
    if (lastCheckin) {
        const checkinTime = new Date(lastCheckin.timestamp).getTime();
        const checkoutTime = new Date(now).getTime();
        durationMinutes = Math.round((checkoutTime - checkinTime) / 60000);
    }

    const recordId = uuidv4();
    const record = {
        clinicId,
        'userId#timestamp': `${userId}#${now}`,
        recordId,
        userId,
        date: today,
        timestamp: now,
        type: 'checkout',
        method: 'geofence' as const,
        latitude: latitude || null,
        longitude: longitude || null,
        wifiSSID: wifiSSID || null,
        durationMinutes,
        checkinRecordId: lastCheckin?.recordId || null,
        anomalies: [] as string[],
        createdAt: now,
    };

    await ddb.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: record }));

    return httpCreated({
        success: true,
        recordId,
        type: 'checkout',
        durationMinutes,
    });
}

/** GET /config — Geofence + clinic hours for mobile apps */
async function handleGetConfig(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    const userId = perms.email;

    // Get all clinics the user is assigned to
    const staffResult = await ddb.send(new QueryCommand({
        TableName: STAFF_INFO_TABLE,
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': userId },
    }));

    if (!staffResult.Items || staffResult.Items.length === 0) {
        return httpOk({ clinics: [] });
    }

    const gcfg = await getGeofenceConfig();

    const clinicConfigs = [];
    for (const assignment of staffResult.Items) {
        const cid = assignment.clinicId;
        const geoConfig = gcfg[cid];
        if (!geoConfig || !geoConfig.enabled) continue;

        // Only include if staff is on-premises
        const wl = assignment.workLocation || {};
        if (wl.isRemote && !wl.isOnPremise) continue;

        // Fetch clinic hours
        let clinicHours: any = null;
        try {
            const hoursResult = await ddb.send(new GetCommand({
                TableName: CLINIC_HOURS_TABLE,
                Key: { clinicId: cid },
            }));
            clinicHours = hoursResult.Item || null;
        } catch (err) {
            console.warn('Failed to fetch clinic hours for', cid, err);
        }

        // Fetch today's shifts
        const tz = geoConfig.timezone;
        const today = todayInTimezone(tz);
        let todayShifts: any[] = [];
        try {
            const shiftsResult = await ddb.send(new QueryCommand({
                TableName: SHIFTS_TABLE,
                IndexName: 'byClinicAndDate',
                KeyConditionExpression: 'clinicId = :cid AND startTime BETWEEN :start AND :end',
                FilterExpression: 'staffId = :sid',
                ExpressionAttributeValues: {
                    ':cid': cid,
                    ':start': `${today}T00:00:00`,
                    ':end': `${today}T23:59:59`,
                    ':sid': userId,
                },
            }));
            todayShifts = shiftsResult.Items || [];
        } catch (err) {
            console.warn('Failed to fetch shifts for', cid, err);
        }

        clinicConfigs.push({
            clinicId: cid,
            geofence: {
                latitude: geoConfig.latitude,
                longitude: geoConfig.longitude,
                radiusMeters: geoConfig.radiusMeters,
                wifiSSIDs: geoConfig.wifiSSIDs,
                lateThresholdMinutes: geoConfig.lateThresholdMinutes,
            },
            timezone: tz,
            clinicHours,
            todayShifts: todayShifts.map(s => ({
                shiftId: s.shiftId,
                startTime: s.startTime,
                endTime: s.endTime,
                role: s.role,
            })),
            hasShiftToday: todayShifts.length > 0,
        });
    }

    return httpOk({ clinics: clinicConfigs });
}

/** GET /history — Staff attendance history */
async function handleHistory(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    const qs = event.queryStringParameters || {};
    const targetUserId = qs.userId || perms.email;
    const startDate = qs.startDate; // YYYY-MM-DD
    const endDate = qs.endDate;     // YYYY-MM-DD
    const limit = parseInt(qs.limit || '50', 10);

    // Non-admins can only view their own history
    if (targetUserId !== perms.email && !isAdmin(perms)) {
        return httpForbidden('Only admins can view other staff attendance');
    }

    const params: any = {
        TableName: ATTENDANCE_TABLE,
        IndexName: 'byUser',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': targetUserId } as any,
        ScanIndexForward: false, // newest first
        Limit: limit,
    };

    if (startDate && endDate) {
        params.KeyConditionExpression += ' AND #ts BETWEEN :start AND :end';
        params.ExpressionAttributeNames = { '#ts': 'timestamp' };
        params.ExpressionAttributeValues[':start'] = `${startDate}T00:00:00`;
        params.ExpressionAttributeValues[':end'] = `${endDate}T23:59:59`;
    }

    const result = await ddb.send(new QueryCommand(params));

    return httpOk({
        records: result.Items || [],
        count: result.Count || 0,
        userId: targetUserId,
    });
}

/** GET /daily — Admin daily attendance roster */
async function handleDaily(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    if (!isAdmin(perms)) return httpForbidden('Admin access required');

    const qs = event.queryStringParameters || {};
    const clinicId = qs.clinicId;
    const date = qs.date; // YYYY-MM-DD

    if (!clinicId) return httpBad('clinicId is required');
    if (!userHasClinicAccess(perms, clinicId)) return httpForbidden('No access to this clinic');

    const gcfg = await getGeofenceConfig();
    const targetDate = date || todayInTimezone(gcfg[clinicId]?.timezone || 'America/New_York');

    const result = await ddb.send(new QueryCommand({
        TableName: ATTENDANCE_TABLE,
        IndexName: 'byDate',
        KeyConditionExpression: 'clinicId = :cid AND #d = :date',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':cid': clinicId, ':date': targetDate },
    }));

    // Group by user
    const byUser: Record<string, any[]> = {};
    for (const item of result.Items || []) {
        if (!byUser[item.userId]) byUser[item.userId] = [];
        byUser[item.userId].push(item);
    }

    // Build roster
    const roster = Object.entries(byUser).map(([uid, records]) => {
        const checkin = records.find(r => r.type === 'checkin');
        const checkout = records.find(r => r.type === 'checkout');
        return {
            userId: uid,
            checkinTime: checkin?.timestamp || null,
            checkoutTime: checkout?.timestamp || null,
            method: checkin?.method || null,
            isLate: checkin?.isLate || false,
            lateMinutes: checkin?.lateMinutes || 0,
            durationMinutes: checkout?.durationMinutes || null,
            anomalies: checkin?.anomalies || [],
            records,
        };
    });

    return httpOk({
        clinicId,
        date: targetDate,
        roster,
        totalPresent: roster.length,
        totalLate: roster.filter(r => r.isLate).length,
    });
}

/** POST /admin/override — Admin manual attendance override */
async function handleAdminOverride(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    if (!isAdmin(perms)) return httpForbidden('Admin access required');

    const body = JSON.parse(event.body || '{}');
    const { clinicId, userId, type, timestamp, reason } = body;

    if (!clinicId || !userId || !type || !reason) {
        return httpBad('clinicId, userId, type, and reason are required');
    }
    if (!userHasClinicAccess(perms, clinicId)) return httpForbidden('No access to this clinic');
    if (!['checkin', 'checkout'].includes(type)) return httpBad('type must be checkin or checkout');

    const gcfg = await getGeofenceConfig();
    const tz = gcfg[clinicId]?.timezone || 'America/New_York';
    const now = timestamp || new Date().toISOString();
    const today = todayInTimezone(tz);
    const recordId = uuidv4();

    const record = {
        clinicId,
        'userId#timestamp': `${userId}#${now}`,
        recordId,
        userId,
        date: today,
        timestamp: now,
        type,
        method: 'manual' as const,
        latitude: null,
        longitude: null,
        wifiSSID: null,
        distanceMeters: null,
        anomalies: [] as string[],
        isLate: false,
        lateMinutes: 0,
        overrideBy: perms.email,
        overrideReason: reason,
        createdAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: record }));

    return httpCreated({
        success: true,
        recordId,
        type,
        method: 'manual',
        overrideBy: perms.email,
    });
}

/** GET /payroll — Actual vs scheduled hours comparison */
async function handlePayroll(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    if (!isAdmin(perms)) return httpForbidden('Admin access required');

    const qs = event.queryStringParameters || {};
    const clinicId = qs.clinicId;
    const startDate = qs.startDate || todayInTimezone('America/New_York');
    const endDate = qs.endDate || startDate;

    if (!clinicId) return httpBad('clinicId is required');
    if (!userHasClinicAccess(perms, clinicId)) return httpForbidden('No access to this clinic');

    // Get attendance records for date range
    const attendanceResult = await ddb.send(new QueryCommand({
        TableName: ATTENDANCE_TABLE,
        IndexName: 'byDate',
        KeyConditionExpression: 'clinicId = :cid AND #d BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':cid': clinicId, ':start': startDate, ':end': endDate },
    }));

    // Get scheduled shifts for date range
    const shiftsResult = await ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byClinicAndDate',
        KeyConditionExpression: 'clinicId = :cid AND startTime BETWEEN :start AND :end',
        ExpressionAttributeValues: {
            ':cid': clinicId,
            ':start': `${startDate}T00:00:00`,
            ':end': `${endDate}T23:59:59`,
        },
    }));

    // Compute per-user discrepancies
    const userMap: Record<string, { scheduledMinutes: number; actualMinutes: number; lateDays: number; presentDays: number }> = {};

    // Sum scheduled hours
    for (const shift of shiftsResult.Items || []) {
        const uid = shift.staffId;
        if (!userMap[uid]) userMap[uid] = { scheduledMinutes: 0, actualMinutes: 0, lateDays: 0, presentDays: 0 };
        if (shift.startTime && shift.endTime) {
            const scheduled = (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / 60000;
            userMap[uid].scheduledMinutes += Math.max(0, scheduled);
        }
    }

    // Sum actual hours (from checkout records)
    for (const rec of attendanceResult.Items || []) {
        const uid = rec.userId;
        if (!userMap[uid]) userMap[uid] = { scheduledMinutes: 0, actualMinutes: 0, lateDays: 0, presentDays: 0 };
        if (rec.type === 'checkout' && rec.durationMinutes) {
            userMap[uid].actualMinutes += rec.durationMinutes;
        }
        if (rec.type === 'checkin') {
            userMap[uid].presentDays += 1;
            if (rec.isLate) userMap[uid].lateDays += 1;
        }
    }

    const payrollData = Object.entries(userMap).map(([uid, data]) => ({
        userId: uid,
        scheduledHours: Math.round(data.scheduledMinutes / 60 * 100) / 100,
        actualHours: Math.round(data.actualMinutes / 60 * 100) / 100,
        discrepancyHours: Math.round((data.actualMinutes - data.scheduledMinutes) / 60 * 100) / 100,
        presentDays: data.presentDays,
        lateDays: data.lateDays,
    }));

    return httpOk({
        clinicId,
        startDate,
        endDate,
        staffPayroll: payrollData,
        totalStaff: payrollData.length,
    });
}

// ========================================
// MAIN HANDLER
// ========================================
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        // Parse path (strip leading /attendance/ if present via base path mapping)
        const rawPath = event.path || '';
        const routePath = rawPath.replace(/^\/attendance/, '').replace(/^\//, '');
        const method = event.httpMethod;

        // Get user permissions
        const perms = getUserPermissions(event);
        if (!perms) {
            return httpForbidden('Not authenticated');
        }
        const requiredPerm = METHOD_PERMISSIONS[method] || 'read';
        if (!hasModulePermission(perms.clinicRoles, MODULE_NAME, requiredPerm, perms.isSuperAdmin, perms.isGlobalSuperAdmin)) {
            return httpForbidden('Insufficient permissions for HR module');
        }

        // Route
        if (method === 'POST' && routePath === 'checkin') return handleCheckin(event, perms);
        if (method === 'POST' && routePath === 'checkout') return handleCheckout(event, perms);
        if (method === 'GET' && routePath === 'config') return handleGetConfig(event, perms);
        if (method === 'GET' && routePath === 'history') return handleHistory(event, perms);
        if (method === 'GET' && routePath === 'daily') return handleDaily(event, perms);
        if (method === 'POST' && routePath === 'admin/override') return handleAdminOverride(event, perms);
        if (method === 'GET' && routePath === 'payroll') return handlePayroll(event, perms);

        return httpNotFound(`Unknown route: ${method} /${routePath}`);
    } catch (err: any) {
        console.error('Attendance handler error:', err);
        return httpError(err.message || 'Internal server error');
    }
}

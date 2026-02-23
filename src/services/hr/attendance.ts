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
import { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { sanitizeString } from './validation';
import { checkDistributedRateLimit } from './rate-limiter';
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
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || ATTENDANCE_TABLE; // reuse attendance table for rate limit counters

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Rate limit constants for attendance endpoints
const CHECKIN_RATE_LIMIT = 10;   // max checkins per hour per user
const CHECKIN_RATE_WINDOW = 3600; // 1 hour
const CHECKOUT_RATE_LIMIT = 10;
const CHECKOUT_RATE_WINDOW = 3600;
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
let _geofenceConfigCacheTime = 0;
const GEOFENCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getGeofenceConfig(): Promise<Record<string, GeofenceConfigEntry>> {
    const now = Date.now();
    if (_geofenceConfigCache && (now - _geofenceConfigCacheTime) < GEOFENCE_CACHE_TTL_MS) {
        return _geofenceConfigCache;
    }
    if (!GEOFENCE_CONFIG_PARAM) {
        _geofenceConfigCache = {};
        _geofenceConfigCacheTime = now;
        return _geofenceConfigCache;
    }
    try {
        const result = await ssmClient.send(new GetParameterCommand({
            Name: GEOFENCE_CONFIG_PARAM,
        }));
        _geofenceConfigCache = JSON.parse(result.Parameter?.Value || '{}');
        _geofenceConfigCacheTime = now;
    } catch (err) {
        console.error('Failed to load geofence config from SSM:', err);
        // On error, keep stale cache if available; otherwise set empty
        if (!_geofenceConfigCache) _geofenceConfigCache = {};
        _geofenceConfigCacheTime = now;
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

/** FIX 8: Validate latitude/longitude bounds */
function isValidLatLng(lat: number, lng: number): boolean {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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

// Track consecutive fail-open events per validation step to detect outages
const _failOpenCounters: Record<string, number> = {};
const FAIL_OPEN_WARN_THRESHOLD = 3;

function recordFailOpen(step: string, err: unknown): void {
    _failOpenCounters[step] = (_failOpenCounters[step] || 0) + 1;
    const count = _failOpenCounters[step];
    if (count >= FAIL_OPEN_WARN_THRESHOLD) {
        console.error(`CIRCUIT-BREAKER WARNING: ${step} has failed open ${count} consecutive times. Validation is effectively disabled.`, err);
    } else {
        console.warn(`${step} failed open (${count}/${FAIL_OPEN_WARN_THRESHOLD} before warning):`, err);
    }
}

function resetFailOpen(step: string): void {
    _failOpenCounters[step] = 0;
}

/** Check if staff member is on-premises (not remote) */
async function isOnPremiseStaff(userId: string, clinicId: string): Promise<{ ok: boolean; reason?: string; failedOpen?: boolean }> {
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: STAFF_INFO_TABLE,
            KeyConditionExpression: 'email = :email',
            FilterExpression: 'clinicId = :cid',
            ExpressionAttributeValues: { ':email': userId, ':cid': clinicId },
        }));
        resetFailOpen('isOnPremiseStaff');
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
        recordFailOpen('isOnPremiseStaff', err);
        return { ok: true, failedOpen: true };
    }
}

/** Parse an HH:mm or H:mm time string to minutes since midnight */
function timeToMinutes(timeStr: string): number | null {
    if (!timeStr) return null;
    // Handle formats: "08:00", "8:00", "08:00 AM", "8:00 PM"
    const normalized = timeStr.trim().toUpperCase();
    const ampmMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (ampmMatch) {
        let h = parseInt(ampmMatch[1], 10);
        const m = parseInt(ampmMatch[2], 10);
        if (ampmMatch[3] === 'PM' && h !== 12) h += 12;
        if (ampmMatch[3] === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    }
    const match24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
    }
    return null;
}

/** Get current time in clinic timezone as minutes since midnight */
function currentTimeMinutesInTz(tz: string): number {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(now);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    return h * 60 + m;
}

/** Check if clinic is currently open (within operating hours) */
async function isWithinClinicHours(clinicId: string, tz: string): Promise<{ ok: boolean; reason?: string; failedOpen?: boolean }> {
    try {
        const dow = dayOfWeekInTz(tz);
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dow];

        const result = await ddb.send(new GetCommand({
            TableName: CLINIC_HOURS_TABLE,
            Key: { clinicId },
        }));
        resetFailOpen('isWithinClinicHours');
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

        // Check current time against opening/closing hours
        const openTime = timeToMinutes(dayHours.open || dayHours.openTime || dayHours.start);
        const closeTime = timeToMinutes(dayHours.close || dayHours.closeTime || dayHours.end);
        if (openTime !== null && closeTime !== null) {
            const currentMinutes = currentTimeMinutesInTz(tz);
            // Allow 60-minute buffer before opening for early arrivals
            if (currentMinutes < openTime - 60) {
                return { ok: false, reason: `Clinic does not open until ${Math.floor(openTime / 60)}:${String(openTime % 60).padStart(2, '0')}` };
            }
            // Allow 60-minute buffer after closing for late checkouts
            if (currentMinutes > closeTime + 60) {
                return { ok: false, reason: `Clinic closed at ${Math.floor(closeTime / 60)}:${String(closeTime % 60).padStart(2, '0')}` };
            }
        }

        return { ok: true };
    } catch (err) {
        recordFailOpen('isWithinClinicHours', err);
        return { ok: true, failedOpen: true };
    }
}

/** Convert a local date + time (HH:mm:ss) in a timezone to a UTC ISO string.
 *  Uses two-pass offset correction to handle DST transitions correctly. */
function localToUtcIso(dateStr: string, timeStr: string, tz: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm, ss] = timeStr.split(':').map(Number);

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });

    const getOffsetMs = (instant: Date): number => {
        const parts = formatter.formatToParts(instant);
        const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
        const localAtInstant = new Date(Date.UTC(getPart('year'), getPart('month') - 1, getPart('day'), getPart('hour'), getPart('minute'), getPart('second')));
        return localAtInstant.getTime() - instant.getTime();
    };

    // First pass: treat the local wall time as UTC to get a rough guess
    const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss || 0));
    const offset1 = getOffsetMs(guess);
    let utc = new Date(guess.getTime() - offset1);

    // Second pass: recalculate offset at the corrected instant to handle DST boundaries
    const offset2 = getOffsetMs(utc);
    if (offset2 !== offset1) {
        utc = new Date(guess.getTime() - offset2);
    }

    return utc.toISOString();
}

/** Check if staff has a shift today at this clinic */
async function hasShiftToday(userId: string, clinicId: string, tz: string): Promise<{
    ok: boolean;
    shift?: any;
    reason?: string;
    failedOpen?: boolean;
}> {
    try {
        const today = todayInTimezone(tz);
        // Convert local day boundaries to UTC so we match UTC-stored shift times
        const startOfDayUtc = localToUtcIso(today, '00:00:00', tz);
        const endOfDayUtc = localToUtcIso(today, '23:59:59', tz);

        const result = await ddb.send(new QueryCommand({
            TableName: SHIFTS_TABLE,
            IndexName: 'byClinicAndDate',
            KeyConditionExpression: 'clinicId = :cid AND startTime BETWEEN :start AND :end',
            FilterExpression: 'staffId = :sid',
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':start': startOfDayUtc,
                ':end': endOfDayUtc,
                ':sid': userId,
            },
        }));
        resetFailOpen('hasShiftToday');
        if (!result.Items || result.Items.length === 0) {
            return { ok: false, reason: 'No shift scheduled for today at this clinic' };
        }
        return { ok: true, shift: result.Items[0] };
    } catch (err) {
        recordFailOpen('hasShiftToday', err);
        return { ok: true, failedOpen: true };
    }
}

function validateGeofence(clinicId: string, latitude: number, longitude: number, gcfg: Record<string, GeofenceConfigEntry>): {
    ok: boolean;
    distanceMeters: number | undefined;
    anomalies: string[];
} {
    const config = gcfg[clinicId];
    if (!config || !config.enabled) return { ok: true, distanceMeters: undefined, anomalies: [] };
    if (config.latitude === 0 && config.longitude === 0) {
        console.warn(`Geofence config for clinic ${clinicId} has (0,0) coordinates — likely misconfigured. Skipping geofence validation.`);
        return { ok: true, distanceMeters: undefined, anomalies: ['geofence_misconfigured_origin'] };
    }

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

    // Rate limiting (Fix #6)
    const rateCheck = await checkDistributedRateLimit(ddb, RATE_LIMIT_TABLE, `checkin:${userId}`, CHECKIN_RATE_LIMIT, CHECKIN_RATE_WINDOW);
    if (!rateCheck.allowed) return httpBad(rateCheck.message || 'Rate limit exceeded for check-in');

    // Validate lat/lng bounds
    if (latitude !== undefined && longitude !== undefined && !isValidLatLng(latitude, longitude)) {
        return httpBad('Invalid coordinates: latitude must be -90..90, longitude must be -180..180');
    }

    const gcfg = await getGeofenceConfig();
    const geoConfig = gcfg[clinicId];
    const tz = geoConfig?.timezone || 'America/New_York';
    const now = new Date().toISOString();
    const today = todayInTimezone(tz);

    // ---- Validation chain ----

    // 0. Atomic duplicate check-in guard using a sentinel record (Fix #1)
    // Write a sentinel key clinicId=<clinicId>, userId#timestamp=ACTIVE_CHECKIN#<userId>#<date>
    // with a condition that it must not already exist. This is atomic across concurrent requests.
    const sentinelSk = `ACTIVE_CHECKIN#${userId}#${today}`;
    try {
        await ddb.send(new PutCommand({
            TableName: ATTENDANCE_TABLE,
            Item: {
                clinicId,
                'userId#timestamp': sentinelSk,
                userId,
                date: today,
                type: 'checkin_sentinel',
                timestamp: now,
            },
            ConditionExpression: 'attribute_not_exists(clinicId)',
        }));
    } catch (condErr: any) {
        if (condErr.name === 'ConditionalCheckFailedException') {
            return httpBad('Already checked in today. Please check out first.');
        }
        throw condErr;
    }

    // 1. On-premises check
    const premisesCheck = await isOnPremiseStaff(userId, clinicId);
    if (!premisesCheck.ok) {
        // Roll back the sentinel on validation failure
        await deleteSentinel(clinicId, sentinelSk);
        return httpForbidden(premisesCheck.reason!);
    }

    // 2. Clinic hours check
    const hoursCheck = await isWithinClinicHours(clinicId, tz);
    if (!hoursCheck.ok) {
        await deleteSentinel(clinicId, sentinelSk);
        return httpForbidden(hoursCheck.reason!);
    }

    // 3. Shift check
    const shiftCheck = await hasShiftToday(userId, clinicId, tz);
    if (!shiftCheck.ok) {
        await deleteSentinel(clinicId, sentinelSk);
        return httpForbidden(shiftCheck.reason!);
    }

    // 4. Geofence validation (if lat/lng provided)
    let geoResult: { ok: boolean; distanceMeters: number | undefined; anomalies: string[] } = {
        ok: true, distanceMeters: undefined, anomalies: [],
    };
    if (latitude !== undefined && longitude !== undefined) {
        geoResult = validateGeofence(clinicId, latitude, longitude, gcfg);
        if (!geoResult.ok) {
            await deleteSentinel(clinicId, sentinelSk);
            return httpForbidden(`Outside clinic geofence (${geoResult.distanceMeters}m away)`);
        }
    }

    // 5. Classify detection method and collect anomalies
    const detection = classifyDetection(body, clinicId, gcfg);
    const allAnomalies = [...new Set([...geoResult.anomalies, ...detection.anomalies])];

    // No shift → anomaly
    if (!shiftCheck.shift) allAnomalies.push('no_shift');

    // Track fail-open anomalies (Fix #10)
    if (premisesCheck.failedOpen) allAnomalies.push('premises_check_failed_open');
    if (hoursCheck.failedOpen) allAnomalies.push('hours_check_failed_open');
    if (shiftCheck.failedOpen) allAnomalies.push('shift_check_failed_open');

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

    await ddb.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: record }));

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

/** Delete sentinel record (used when checkin validation fails after acquiring lock) */
async function deleteSentinel(clinicId: string, sentinelSk: string): Promise<void> {
    try {
        await ddb.send(new DeleteCommand({
            TableName: ATTENDANCE_TABLE,
            Key: { clinicId, 'userId#timestamp': sentinelSk },
        }));
    } catch (err) {
        console.error('Failed to clean up checkin sentinel:', err);
    }
}

/** POST /checkout — Automated or manual check-out */
async function handleCheckout(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { clinicId, latitude, longitude, wifiSSID } = body;
    const userId = perms.email;

    if (!clinicId) return httpBad('clinicId is required');

    // Rate limiting (Fix #6)
    const rateCheck = await checkDistributedRateLimit(ddb, RATE_LIMIT_TABLE, `checkout:${userId}`, CHECKOUT_RATE_LIMIT, CHECKOUT_RATE_WINDOW);
    if (!rateCheck.allowed) return httpBad(rateCheck.message || 'Rate limit exceeded for check-out');

    // Validate lat/lng bounds
    if (latitude !== undefined && longitude !== undefined && !isValidLatLng(latitude, longitude)) {
        return httpBad('Invalid coordinates: latitude must be -90..90, longitude must be -180..180');
    }

    const gcfg = await getGeofenceConfig();
    const geoConfig = gcfg[clinicId];
    const tz = geoConfig?.timezone || 'America/New_York';
    const now = new Date().toISOString();
    const today = todayInTimezone(tz);

    // Atomically delete the checkin sentinel — if it doesn't exist, the user is not checked in (Fix #2)
    const sentinelSk = `ACTIVE_CHECKIN#${userId}#${today}`;
    try {
        await ddb.send(new DeleteCommand({
            TableName: ATTENDANCE_TABLE,
            Key: { clinicId, 'userId#timestamp': sentinelSk },
            ConditionExpression: 'attribute_exists(clinicId)',
        }));
    } catch (condErr: any) {
        if (condErr.name === 'ConditionalCheckFailedException') {
            return httpBad('No active check-in found for today. Cannot check out without checking in first.');
        }
        throw condErr;
    }

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
    if (!lastCheckin) {
        // Sentinel existed but no checkin record — shouldn't happen, but handle gracefully
        console.error(`Checkout: sentinel existed but no checkin record found for ${userId} at ${clinicId} on ${today}`);
        return httpBad('No check-in record found for today.');
    }

    const checkinTime = new Date(lastCheckin.timestamp).getTime();
    const checkoutTime = new Date(now).getTime();
    const rawDurationMinutes = Math.round((checkoutTime - checkinTime) / 60000);

    // Validate duration bounds: reject negative or >24h durations
    if (rawDurationMinutes < 0) {
        return httpBad('Checkout time is before check-in time');
    }
    const MAX_DURATION_MINUTES = 1440; // 24 hours
    const durationMinutes = Math.min(rawDurationMinutes, MAX_DURATION_MINUTES);

    const detection = classifyDetection(body, clinicId, gcfg);
    const allAnomalies = [...detection.anomalies];

    // Flag abnormally long sessions
    if (rawDurationMinutes > MAX_DURATION_MINUTES) {
        allAnomalies.push('duration_capped_24h');
    }

    // Geofence validation on checkout (anomaly flag only, non-blocking)
    if (latitude !== undefined && longitude !== undefined) {
        const geoResult = validateGeofence(clinicId, latitude, longitude, gcfg);
        if (!geoResult.ok) {
            allAnomalies.push('checkout_outside_geofence');
        }
        allAnomalies.push(...geoResult.anomalies);
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
        method: detection.method,
        latitude: latitude || null,
        longitude: longitude || null,
        wifiSSID: wifiSSID || null,
        durationMinutes,
        checkinRecordId: lastCheckin.recordId || null,
        anomalies: [...new Set(allAnomalies)],
        createdAt: now,
    };

    await ddb.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: record }));

    return httpCreated({
        success: true,
        recordId,
        type: 'checkout',
        method: detection.method,
        durationMinutes,
        anomalies: record.anomalies,
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

        // Fetch today's shifts (Fix #3: use UTC boundaries consistent with hasShiftToday)
        const tz = geoConfig.timezone;
        const today = todayInTimezone(tz);
        const startOfDayUtc = localToUtcIso(today, '00:00:00', tz);
        const endOfDayUtc = localToUtcIso(today, '23:59:59', tz);
        let todayShifts: any[] = [];
        try {
            const shiftsResult = await ddb.send(new QueryCommand({
                TableName: SHIFTS_TABLE,
                IndexName: 'byClinicAndDate',
                KeyConditionExpression: 'clinicId = :cid AND startTime BETWEEN :start AND :end',
                FilterExpression: 'staffId = :sid',
                ExpressionAttributeValues: {
                    ':cid': cid,
                    ':start': startOfDayUtc,
                    ':end': endOfDayUtc,
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

    // Determine if post-query clinic filtering is needed (Fix #13)
    const needsClinicFilter = targetUserId !== perms.email && isAdmin(perms)
        && !perms.isSuperAdmin && !perms.isGlobalSuperAdmin;
    let allowedClinics: Set<string> | null = null;
    if (needsClinicFilter) {
        allowedClinics = getAllowedClinicIds(perms.clinicRoles, perms.isSuperAdmin, perms.isGlobalSuperAdmin);
    }

    const baseParams: any = {
        TableName: ATTENDANCE_TABLE,
        IndexName: 'byUser',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': targetUserId } as any,
        ScanIndexForward: false, // newest first
    };

    if (startDate && endDate) {
        baseParams.KeyConditionExpression += ' AND #ts BETWEEN :start AND :end';
        baseParams.ExpressionAttributeNames = { '#ts': 'timestamp' };
        baseParams.ExpressionAttributeValues[':start'] = `${startDate}T00:00:00`;
        baseParams.ExpressionAttributeValues[':end'] = `${endDate}T23:59:59`;
    }

    // When clinic filtering is needed, paginate to collect enough post-filter records
    const records: any[] = [];
    let lastKey: any = undefined;
    const MAX_PAGES = 10; // safety cap to prevent runaway pagination
    let pages = 0;

    do {
        const result = await ddb.send(new QueryCommand({
            ...baseParams,
            // Fetch more per page when filtering to compensate for discarded records
            Limit: needsClinicFilter ? limit * 3 : limit,
            ...(lastKey && { ExclusiveStartKey: lastKey }),
        }));
        const items = result.Items || [];

        if (needsClinicFilter && allowedClinics) {
            for (const r of items) {
                if (allowedClinics.has(r.clinicId)) {
                    records.push(r);
                }
                if (records.length >= limit) break;
            }
        } else {
            records.push(...items);
        }

        lastKey = result.LastEvaluatedKey;
        pages++;
    } while (lastKey && records.length < limit && pages < MAX_PAGES);

    return httpOk({
        records: records.slice(0, limit),
        count: Math.min(records.length, limit),
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

    // Group by user (filter out sentinel records)
    const byUser: Record<string, any[]> = {};
    for (const item of result.Items || []) {
        if (item.type === 'checkin_sentinel') continue;
        if (!byUser[item.userId]) byUser[item.userId] = [];
        byUser[item.userId].push(item);
    }

    // FIX 3: Build roster handling multiple check-in/out cycles per user
    const roster = Object.entries(byUser).map(([uid, records]) => {
        const checkins = records.filter(r => r.type === 'checkin').sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const checkouts = records.filter(r => r.type === 'checkout').sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        const firstCheckin = checkins[0] || null;
        const lastCheckout = checkouts[checkouts.length - 1] || null;

        // Total duration across all checkout records
        const totalDurationMinutes = checkouts.reduce((sum, r) => sum + (r.durationMinutes || 0), 0) || null;

        // Collect all anomalies from all records
        const allAnomalies = [...new Set(records.flatMap(r => r.anomalies || []))];

        return {
            userId: uid,
            checkinTime: firstCheckin?.timestamp || null,
            checkoutTime: lastCheckout?.timestamp || null,
            method: firstCheckin?.method || null,
            isLate: firstCheckin?.isLate || false,
            lateMinutes: firstCheckin?.lateMinutes || 0,
            totalDurationMinutes,
            cycles: checkins.length,
            anomalies: allAnomalies,
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
    const { clinicId, userId, type, timestamp } = body;
    // Fix #14: Sanitize reason to prevent XSS
    const reason = sanitizeString(body.reason, 500);

    if (!clinicId || !userId || !type || !reason) {
        return httpBad('clinicId, userId, type, and reason are required');
    }
    if (!userHasClinicAccess(perms, clinicId)) return httpForbidden('No access to this clinic');
    if (!['checkin', 'checkout'].includes(type)) return httpBad('type must be checkin or checkout');

    // Validate that the target user exists and is assigned to this clinic
    const staffCheck = await ddb.send(new QueryCommand({
        TableName: STAFF_INFO_TABLE,
        KeyConditionExpression: 'email = :email',
        FilterExpression: 'clinicId = :cid',
        ExpressionAttributeValues: { ':email': userId, ':cid': clinicId },
    }));
    if (!staffCheck.Items || staffCheck.Items.length === 0) {
        return httpBad('User is not assigned to this clinic');
    }

    const gcfg = await getGeofenceConfig();
    const tz = gcfg[clinicId]?.timezone || 'America/New_York';
    const overrideTs = timestamp || new Date().toISOString();
    // Derive the date from the provided timestamp, not from "today"
    const overrideDate = new Date(overrideTs).toLocaleDateString('en-CA', { timeZone: tz });

    // Fix #7: Check ALL existing records (not just manual overrides) to prevent pairing conflicts
    const existingRecords = await ddb.send(new QueryCommand({
        TableName: ATTENDANCE_TABLE,
        KeyConditionExpression: 'clinicId = :cid AND begins_with(#sk, :prefix)',
        FilterExpression: '#d = :targetDate AND #t = :type',
        ExpressionAttributeNames: { '#sk': 'userId#timestamp', '#d': 'date', '#t': 'type' },
        ExpressionAttributeValues: {
            ':cid': clinicId,
            ':prefix': `${userId}#`,
            ':targetDate': overrideDate,
            ':type': type,
        },
    }));
    const existingOfType = existingRecords.Items || [];

    if (type === 'checkin') {
        // Check if there's already an unpaired checkin (no checkout after it)
        if (existingOfType.length > 0) {
            const latestCheckin = existingOfType.sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp))[0];
            const checkoutsAfter = await ddb.send(new QueryCommand({
                TableName: ATTENDANCE_TABLE,
                KeyConditionExpression: 'clinicId = :cid AND begins_with(#sk, :prefix)',
                FilterExpression: '#d = :targetDate AND #t = :checkout AND #ts > :afterTs',
                ExpressionAttributeNames: { '#sk': 'userId#timestamp', '#d': 'date', '#t': 'type', '#ts': 'timestamp' },
                ExpressionAttributeValues: {
                    ':cid': clinicId,
                    ':prefix': `${userId}#`,
                    ':targetDate': overrideDate,
                    ':checkout': 'checkout',
                    ':afterTs': latestCheckin.timestamp,
                },
                Limit: 1,
            }));
            if (!checkoutsAfter.Items || checkoutsAfter.Items.length === 0) {
                return httpBad(`User already has an active check-in on ${overrideDate} with no checkout. Add a checkout override first.`);
            }
        }
        // Also manage the sentinel for the checkin override
        const sentinelSk = `ACTIVE_CHECKIN#${userId}#${overrideDate}`;
        try {
            await ddb.send(new PutCommand({
                TableName: ATTENDANCE_TABLE,
                Item: {
                    clinicId,
                    'userId#timestamp': sentinelSk,
                    userId,
                    date: overrideDate,
                    type: 'checkin_sentinel',
                    timestamp: overrideTs,
                },
                ConditionExpression: 'attribute_not_exists(clinicId)',
            }));
        } catch (condErr: any) {
            if (condErr.name === 'ConditionalCheckFailedException') {
                return httpBad(`User already has an active check-in on ${overrideDate}. Add a checkout override first.`);
            }
            throw condErr;
        }
    }

    if (type === 'checkout') {
        // Ensure there's actually a checkin to pair with
        const allCheckins = await ddb.send(new QueryCommand({
            TableName: ATTENDANCE_TABLE,
            KeyConditionExpression: 'clinicId = :cid AND begins_with(#sk, :prefix)',
            FilterExpression: '#d = :targetDate AND #t = :checkin',
            ExpressionAttributeNames: { '#sk': 'userId#timestamp', '#d': 'date', '#t': 'type' },
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':prefix': `${userId}#`,
                ':targetDate': overrideDate,
                ':checkin': 'checkin',
            },
            ScanIndexForward: false,
            Limit: 1,
        }));
        if (!allCheckins.Items || allCheckins.Items.length === 0) {
            return httpBad(`No check-in exists for this user on ${overrideDate}. Add a check-in override first.`);
        }
        // Check if the latest checkin already has a checkout
        const allCheckouts = await ddb.send(new QueryCommand({
            TableName: ATTENDANCE_TABLE,
            KeyConditionExpression: 'clinicId = :cid AND begins_with(#sk, :prefix)',
            FilterExpression: '#d = :targetDate AND #t = :checkout AND #ts > :afterTs',
            ExpressionAttributeNames: { '#sk': 'userId#timestamp', '#d': 'date', '#t': 'type', '#ts': 'timestamp' },
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':prefix': `${userId}#`,
                ':targetDate': overrideDate,
                ':checkout': 'checkout',
                ':afterTs': allCheckins.Items[0].timestamp,
            },
            Limit: 1,
        }));
        if (allCheckouts.Items && allCheckouts.Items.length > 0) {
            return httpBad(`User already has a checkout paired to the latest check-in on ${overrideDate}.`);
        }
    }

    // For checkout overrides, calculate durationMinutes from the matching check-in
    let durationMinutes: number | null = null;
    let checkinRecordId: string | null = null;
    if (type === 'checkout') {
        const checkinResult = await ddb.send(new QueryCommand({
            TableName: ATTENDANCE_TABLE,
            KeyConditionExpression: 'clinicId = :cid AND begins_with(#sk, :prefix)',
            FilterExpression: '#d = :targetDate AND #t = :checkin',
            ExpressionAttributeNames: { '#sk': 'userId#timestamp', '#d': 'date', '#t': 'type' },
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':prefix': `${userId}#`,
                ':targetDate': overrideDate,
                ':checkin': 'checkin',
            },
            ScanIndexForward: false,
            Limit: 1,
        }));
        const lastCheckin = checkinResult.Items?.[0];
        if (lastCheckin) {
            const checkinTime = new Date(lastCheckin.timestamp).getTime();
            const checkoutTime = new Date(overrideTs).getTime();
            const rawDuration = Math.round((checkoutTime - checkinTime) / 60000);
            durationMinutes = Math.max(0, Math.min(rawDuration, 1440)); // clamp 0-24h
            checkinRecordId = lastCheckin.recordId || null;
        }
        // Delete the checkin sentinel since we're checking out
        const sentinelSk = `ACTIVE_CHECKIN#${userId}#${overrideDate}`;
        await deleteSentinel(clinicId, sentinelSk);
    }

    const recordId = uuidv4();
    const record: Record<string, any> = {
        clinicId,
        'userId#timestamp': `${userId}#${overrideTs}`,
        recordId,
        userId,
        date: overrideDate,
        timestamp: overrideTs,
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

    if (type === 'checkout') {
        record.durationMinutes = durationMinutes;
        record.checkinRecordId = checkinRecordId;
    }

    await ddb.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: record }));

    return httpCreated({
        success: true,
        recordId,
        type,
        method: 'manual',
        overrideBy: perms.email,
        ...(type === 'checkout' && { durationMinutes }),
    });
}

/** GET /payroll — Actual vs scheduled hours comparison */
async function handlePayroll(event: APIGatewayProxyEvent, perms: UserPermissions): Promise<APIGatewayProxyResult> {
    if (!isAdmin(perms)) return httpForbidden('Admin access required');

    const qs = event.queryStringParameters || {};
    const clinicId = qs.clinicId;

    if (!clinicId) return httpBad('clinicId is required');
    if (!userHasClinicAccess(perms, clinicId)) return httpForbidden('No access to this clinic');

    // FIX 6: Use clinic's configured timezone instead of hardcoded 'America/New_York'
    const gcfg = await getGeofenceConfig();
    const tz = gcfg[clinicId]?.timezone || 'America/New_York';
    const startDate = qs.startDate || todayInTimezone(tz);
    const endDate = qs.endDate || startDate;

    // Paginated query helper — fetches all pages
    const queryAllPages = async (params: any): Promise<any[]> => {
        const allItems: any[] = [];
        let lastKey: any = undefined;
        do {
            const result = await ddb.send(new QueryCommand({
                ...params,
                ...(lastKey && { ExclusiveStartKey: lastKey }),
            }));
            allItems.push(...(result.Items || []));
            lastKey = result.LastEvaluatedKey;
        } while (lastKey);
        return allItems;
    };

    // Get attendance records for date range (paginated), excluding sentinel records
    const rawAttendanceItems = await queryAllPages({
        TableName: ATTENDANCE_TABLE,
        IndexName: 'byDate',
        KeyConditionExpression: 'clinicId = :cid AND #d BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':cid': clinicId, ':start': startDate, ':end': endDate },
    });
    const attendanceItems = rawAttendanceItems.filter(r => r.type !== 'checkin_sentinel');

    // Get scheduled shifts for date range (paginated)
    const shiftItems = await queryAllPages({
        TableName: SHIFTS_TABLE,
        IndexName: 'byClinicAndDate',
        KeyConditionExpression: 'clinicId = :cid AND startTime BETWEEN :start AND :end',
        ExpressionAttributeValues: {
            ':cid': clinicId,
            ':start': `${startDate}T00:00:00`,
            ':end': `${endDate}T23:59:59`,
        },
    });

    // FIX 9: Track unique dates for presentDays and lateDays using Sets
    const userMap: Record<string, {
        scheduledMinutes: number;
        actualMinutes: number;
        lateDates: Set<string>;
        presentDates: Set<string>;
    }> = {};

    const ensureUser = (uid: string) => {
        if (!userMap[uid]) userMap[uid] = { scheduledMinutes: 0, actualMinutes: 0, lateDates: new Set(), presentDates: new Set() };
    };

    // Sum scheduled hours
    for (const shift of shiftItems) {
        const uid = shift.staffId;
        ensureUser(uid);
        if (shift.startTime && shift.endTime) {
            const scheduled = (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / 60000;
            userMap[uid].scheduledMinutes += Math.max(0, scheduled);
        }
    }

    // Sum actual hours (from checkout records)
    for (const rec of attendanceItems) {
        const uid = rec.userId;
        ensureUser(uid);
        if (rec.type === 'checkout' && rec.durationMinutes) {
            userMap[uid].actualMinutes += rec.durationMinutes;
        }
        if (rec.type === 'checkin') {
            userMap[uid].presentDates.add(rec.date);
            if (rec.isLate) userMap[uid].lateDates.add(rec.date);
        }
    }

    const payrollData = Object.entries(userMap).map(([uid, data]) => ({
        userId: uid,
        scheduledHours: Math.round(data.scheduledMinutes / 60 * 100) / 100,
        actualHours: Math.round(data.actualMinutes / 60 * 100) / 100,
        discrepancyHours: Math.round((data.actualMinutes - data.scheduledMinutes) / 60 * 100) / 100,
        presentDays: data.presentDates.size,
        lateDays: data.lateDates.size,
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

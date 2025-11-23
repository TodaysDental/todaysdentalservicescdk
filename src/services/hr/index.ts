// services/hr/index.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { v4 as uuidv4 } from 'uuid';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Environment Variables
const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
const LEAVE_TABLE = process.env.LEAVE_TABLE!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

// ========================================
// AUTH & ROUTING
// ========================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

const httpErr = (code: number, message: string) => ({
    statusCode: code, headers: corsHeaders, body: JSON.stringify({ success: false, message })
});
const httpOk = (data: Record<string, any>) => ({
    statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, ...data })
});

const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, code: 401, message: "missing bearer token" };
  }
  if (!ISSUER) return { ok: false, code: 500, message: "issuer not configured" };
  const token = authorizationHeader.slice(7).trim();
  try {
    JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
    if ((payload as any).token_use !== "id") {
      return { ok: false, code: 401, message: "id token required" };
    }
    return { ok: true, payload };
  } catch (_err) {
    return { ok: false, code: 401, message: "invalid token" };
  }
}

function callerAuthContextFromClaims(payload: JWTPayload): { staffId: string; email: string; isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } {
  const staffId = String(payload.sub || payload.username || '');
  const email = String(payload.email || '').toLowerCase();
  
  const ctx: { staffId: string, email: string, isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } = { 
    staffId, 
    email, 
    isSuperAdmin: false, 
    rolesByClinic: {} 
  };
  
  const groups = Array.isArray((payload as any)["cognito:groups"]) ? ((payload as any)["cognito:groups"] as string[]) : [];
  for (const g of groups) {
    if (String(g) === "GLOBAL__SUPER_ADMIN") {
      ctx.isSuperAdmin = true;
      continue;
    }
    const m = /^clinic_([^_][^\s]*)__([A-Z_]+)$/.exec(String(g));
    if (!m) continue;
    const clinicId = m[1];
    const roleKey = m[2];
    const code = roleKeyToCode(roleKey);
    if (!code) continue;
    ctx.rolesByClinic[clinicId] = code;
  }
  
  ctx.isSuperAdmin = ctx.isSuperAdmin || Object.values(ctx.rolesByClinic).includes("S");
  return ctx;
}

function isRoleAdmin(caller: { isSuperAdmin: boolean; rolesByClinic: Record<string, string>; }): boolean {
    if (caller.isSuperAdmin) return true;
    return Object.values(caller.rolesByClinic).some(role => role === 'A' || role === 'S');
}

function roleKeyToCode(roleKey: string): string {
  switch (String(roleKey).toUpperCase()) {
    case "SUPER_ADMIN": return "S";
    case "ADMIN": return "A";
    case "PROVIDER": return "P";
    case "MARKETING": return "M";
    case "USER": return "U";
    case "DOCTOR": return "D";
    case "HYGIENIST": return "H";
    case "DENTAL_ASSISTANT": return "DA";
    case "TRAINEE": return "TC";
    case "PATIENT_COORDINATOR": return "PC";
    default: return "";
  }
}

// ========================================
// HELPER FUNCTIONS
// ========================================

// Check if a date is blocked by approved leave
async function isDateBlocked(staffId: string, date: Date): Promise<boolean> {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: LEAVE_TABLE,
    IndexName: 'byStaff',
    KeyConditionExpression: 'staffId = :staffId',
    FilterExpression: '#status = :approved',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':staffId': staffId,
      ':approved': 'approved'
    }
  }));

  if (!Items || Items.length === 0) return false;

  const dateTime = date.getTime();
  return Items.some(leave => {
    const startTime = new Date(leave.startDate).getTime();
    const endTime = new Date(leave.endDate).getTime() + (24 * 60 * 60 * 1000 - 1); // End of day
    return dateTime >= startTime && dateTime <= endTime;
  });
}

// Get all shifts that overlap with a date range
async function getOverlappingShifts(staffId: string, startDate: string, endDate: string): Promise<any[]> {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: SHIFTS_TABLE,
    IndexName: 'byStaff',
    KeyConditionExpression: 'staffId = :staffId',
    FilterExpression: '#status = :scheduled AND startTime <= :endDate AND endTime >= :startDate',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':staffId': staffId,
      ':scheduled': 'scheduled',
      ':startDate': startDate,
      ':endDate': endDate
    }
  }));

  return Items || [];
}

// ========================================
// MAIN HANDLER (ROUTER)
// ========================================

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "OK" };
  }

  const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
  const verifyResult = await verifyIdToken(authz);
  if (!verifyResult.ok) {
    return httpErr(verifyResult.code, verifyResult.message);
  }

  const caller = callerAuthContextFromClaims(verifyResult.payload);
  const isAdmin = isRoleAdmin(caller);

  const method = event.httpMethod;
  const path = event.path.replace('/hr', '');

  try {
    if (method === 'GET' && path === '/dashboard') {
      return getDashboard(caller, isAdmin);
    }
    
    if (method === 'GET' && path === '/clinics') {
      const clinicIds = Object.keys(caller.rolesByClinic);
      return httpOk({ clinics: clinicIds.map(id => ({ clinicId: id, clinicName: `Clinic ${id}` })) });
    }

    // --- SHIFTS ---
    if (method === 'GET' && path === '/shifts') {
      return getShifts(caller, isAdmin, event.queryStringParameters);
    }
    if (method === 'POST' && path === '/shifts') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      return createShift(JSON.parse(event.body));
    }
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      return updateShift(shiftId, JSON.parse(event.body));
    }
    if (method === 'DELETE' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      return deleteShift(shiftId);
    }
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/reject$/)) {
      const shiftId = path.split('/')[2];
      return rejectShift(shiftId, caller.staffId);
    }

    // --- LEAVE ---
    if (method === 'GET' && path === '/leave') {
      return getLeave(caller, isAdmin);
    }
    if (method === 'POST' && path === '/leave') {
      return createLeave(caller.staffId, JSON.parse(event.body));
    }
    if (method === 'DELETE' && path.match(/^\/leave\/[^\/]+$/)) {
      const leaveId = path.split('/')[2];
      return deleteLeave(leaveId, caller, isAdmin);
    }
    if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/approve$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const leaveId = path.split('/')[2];
      return approveLeave(leaveId);
    }
    if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/deny$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const leaveId = path.split('/')[2];
      return updateLeaveStatus(leaveId, 'denied');
    }

    return httpErr(404, "Not Found");
  } catch (err: any) {
    console.error(err);
    return httpErr(500, err.message || "Internal server error");
  }
};

// ========================================
// BUSINESS LOGIC
// ========================================

type CallerContext = { staffId: string; email: string; isSuperAdmin: boolean; rolesByClinic: Record<string, string>; };

async function getDashboard(caller: CallerContext, isAdmin: boolean) {
  if (isAdmin) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(today.setDate(diff)).toISOString();
    const weekEnd = new Date(today.setDate(diff + 6)).toISOString();

    const staffCountPromise = cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 0
    }));
    
    const adminClinics = Object.keys(caller.rolesByClinic);
    const shiftQueryPromises = adminClinics.map(clinicId =>
      ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byClinicAndDate',
        KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
          ':start': weekStart,
          ':end': weekEnd,
        }
      }))
    );

    const [staffResponse, ...shiftResponses] = await Promise.all([
      staffCountPromise,
      ...shiftQueryPromises
    ]);
    
    const totalStaff = staffResponse.Users?.length || 0;
    const allShifts = shiftResponses.flatMap(res => res.Items || []);
    
    let estimatedHours = 0;
    let estimatedCost = 0;
    allShifts.forEach(shift => {
      estimatedHours += shift.totalHours || 0;
      estimatedCost += shift.pay || 0;
    });

    return httpOk({
      totalOffices: adminClinics.length,
      totalStaff: totalStaff,
      thisWeeksShifts: allShifts.length,
      budgetStatus: "On Track",
      currentWeekOverview: {
        totalShifts: allShifts.length,
        estimatedHours: parseFloat(estimatedHours.toFixed(2)),
        estimatedCost: parseFloat(estimatedCost.toFixed(2)),
      }
    });

  } else {
    const { Items: shifts } = await ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byStaff',
        KeyConditionExpression: 'staffId = :staffId',
        FilterExpression: '#status = :completed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':staffId': caller.staffId,
          ':completed': 'completed'
        }
    }));
    
    let completedHours = 0;
    let totalEarnings = 0;
    const completedShifts = (shifts || []);

    for (const shift of completedShifts) {
        completedHours += shift.totalHours || 0;
        totalEarnings += shift.pay || 0;
    }

    return httpOk({
      completedShifts: completedShifts.length,
      completedHours: parseFloat(completedHours.toFixed(2)),
      totalEarnings: parseFloat(totalEarnings.toFixed(2)),
    });
  }
}

async function getShifts(caller: CallerContext, isAdmin: boolean, queryParams: any) {
  const { clinicId, startDate, endDate, status } = queryParams || {};

  if (isAdmin) {
    if (!clinicId || !startDate || !endDate) {
      return httpErr(400, "clinicId, startDate, and endDate are required for admin");
    }
    const { Items } = await ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byClinicAndDate',
        KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :startDate AND :endDate',
        ExpressionAttributeValues: {
            ':clinicId': clinicId,
            ':startDate': startDate,
            ':endDate': endDate,
        }
    }));
    return httpOk({ shifts: Items || [] });

  } else {
    let KeyConditionExpression = 'staffId = :staffId';
    const ExpressionAttributeValues: Record<string, any> = { ':staffId': caller.staffId };

    if (startDate && endDate) {
        KeyConditionExpression += ' AND startTime BETWEEN :startDate AND :endDate';
        ExpressionAttributeValues[':startDate'] = startDate;
        ExpressionAttributeValues[':endDate'] = endDate;
    }
    
    let FilterExpression;
    if (status) {
        FilterExpression = '#status = :status';
        ExpressionAttributeValues[':status'] = status;
    }

    const { Items } = await ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byStaff',
        KeyConditionExpression,
        FilterExpression,
        ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
        ExpressionAttributeValues
    }));
    return httpOk({ shifts: Items || [] });
  }
}

async function createShift(body: any) {
  const { staffId, clinicId, startTime, endTime } = body;
  if (!staffId || !clinicId || !startTime || !endTime) {
    return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
  }

  // ** NEW: Check if the date is blocked **
  const shiftDate = new Date(startTime);
  const isBlocked = await isDateBlocked(staffId, shiftDate);
  if (isBlocked) {
    return httpErr(400, "Cannot schedule shift: Staff has approved leave on this date");
  }

  let email: string | undefined;
  try {
    const user = await cognito.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: staffId 
    }));
    email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();
  } catch (err) {
    console.error("Cognito user lookup failed:", err);
    return httpErr(404, "Staff user not found in Cognito");
  }

  if (!email) {
    return httpErr(404, "Staff email not found, cannot determine pay");
  }

  const { Item: staffInfo } = await ddb.send(new GetCommand({
      TableName: STAFF_INFO_TABLE,
      Key: { email: email, clinicId: clinicId }
  }));

  const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
  const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
  
  if (totalHours <= 0) {
      return httpErr(400, "End time must be after start time");
  }

  const pay = totalHours * hourlyRate;

  const shiftId = uuidv4();
  const shift = {
    shiftId,
    staffId,
    email: email,
    clinicId,
    startTime,
    endTime,
    totalHours: parseFloat(totalHours.toFixed(2)),
    hourlyRate: hourlyRate,
    pay: parseFloat(pay.toFixed(2)),
    status: 'scheduled',
    ...body
  };

  await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));
  return httpOk({ shiftId, message: "Shift created successfully" });
}

async function updateShift(shiftId: string, body: any) {
    const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!oldShift) return httpErr(404, "Shift not found");

    const staffId = body.staffId || oldShift.staffId;
    const clinicId = body.clinicId || oldShift.clinicId;
    const startTime = body.startTime || oldShift.startTime;

    // ** NEW: Check if the date is blocked **
    const shiftDate = new Date(startTime);
    const isBlocked = await isDateBlocked(staffId, shiftDate);
    if (isBlocked) {
      return httpErr(400, "Cannot update shift: Staff has approved leave on this date");
    }

    let email: string | undefined;
    try {
        const user = await cognito.send(new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: staffId
        }));
        email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();
    } catch (err) {
        console.error("Cognito user lookup failed:", err);
        return httpErr(404, "Staff user not found in Cognito");
    }

    if (!email) {
        return httpErr(404, "Staff email not found, cannot determine pay");
    }

    const { Item: staffInfo } = await ddb.send(new GetCommand({
      TableName: STAFF_INFO_TABLE,
      Key: { email: email, clinicId: clinicId }
    }));
    
    const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
    const endTime = body.endTime || oldShift.endTime;
    const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
    
    if (totalHours <= 0) {
        return httpErr(400, "End time must be after start time");
    }

    const pay = totalHours * hourlyRate;

    const updatedShift = {
        ...oldShift,
        ...body,
        shiftId,
        staffId,
        email: email,
        clinicId,
        totalHours: parseFloat(totalHours.toFixed(2)),
        hourlyRate: hourlyRate,
        pay: parseFloat(pay.toFixed(2))
    };
    
    await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: updatedShift }));
    return httpOk({ shiftId, message: "Shift updated successfully" });
}

async function deleteShift(shiftId: string) {
    await ddb.send(new DeleteCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
    return httpOk({ message: "Shift deleted successfully" });
}

async function rejectShift(shiftId: string, staffId: string) {
    const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!Item) return httpErr(404, "Shift not found");
    
    if (Item.staffId !== staffId) return httpErr(403, "Forbidden: You do not own this shift");
    if (Item.status !== 'scheduled') return httpErr(400, "Shift cannot be rejected");

    await ddb.send(new UpdateCommand({
        TableName: SHIFTS_TABLE,
        Key: { shiftId },
        UpdateExpression: 'set #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'rejected' }
    }));
    return httpOk({ shiftId, status: 'rejected' });
}

// --- LEAVE ---
async function getLeave(caller: CallerContext, isAdmin: boolean) {
    if (isAdmin) {
        const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
        return httpOk({ leaveRequests: Items || [] });
    } else {
        const { Items } = await ddb.send(new QueryCommand({
            TableName: LEAVE_TABLE,
            IndexName: 'byStaff',
            KeyConditionExpression: 'staffId = :staffId',
            ExpressionAttributeValues: { ':staffId': caller.staffId }
        }));
        return httpOk({ leaveRequests: Items || [] });
    }
}

async function createLeave(staffId: string, body: any) {
  const { startDate, endDate } = body;
  if (!startDate || !endDate) {
    return httpErr(400, "startDate and endDate are required");
  }
  const leaveId = uuidv4();
  const leaveRequest = {
    leaveId,
    staffId,
    startDate,
    endDate,
    status: 'pending'
  };
  await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));
  return httpOk({ leaveId, message: "Leave request submitted" });
}

async function deleteLeave(leaveId: string, caller: CallerContext, isAdmin:boolean) {
    const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
    if (!Item) return httpErr(404, "Leave request not found");
    
    if (!isAdmin && Item.staffId !== caller.staffId) {
        return httpErr(403, "Forbidden");
    }

    await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
    return httpOk({ message: "Leave request deleted" });
}

// ** UPDATED: Auto-cancel overlapping shifts when approving leave **
async function approveLeave(leaveId: string) {
    // Get the leave request
    const { Item: leave } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
    if (!leave) return httpErr(404, "Leave request not found");

    // Update leave status to approved
    await ddb.send(new UpdateCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
        UpdateExpression: 'set #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'approved' }
    }));

    // Find and cancel overlapping shifts
    const overlappingShifts = await getOverlappingShifts(leave.staffId, leave.startDate, leave.endDate);
    
    const cancelPromises = overlappingShifts.map(shift =>
      ddb.send(new UpdateCommand({
        TableName: SHIFTS_TABLE,
        Key: { shiftId: shift.shiftId },
        UpdateExpression: 'set #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'rejected' }
      }))
    );

    await Promise.all(cancelPromises);

    return httpOk({ 
      leaveId, 
      status: 'approved',
      cancelledShifts: overlappingShifts.length,
      message: `Leave approved. ${overlappingShifts.length} overlapping shift(s) have been automatically cancelled.`
    });
}

async function updateLeaveStatus(leaveId: string, status: 'approved' | 'denied') {
    await ddb.send(new UpdateCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
        UpdateExpression: 'set #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status }
    }));
    return httpOk({ leaveId, status });
}
// services/hr/index.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { v4 as uuidv4 } from 'uuid';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
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
// AUTH & ROUTING (Similar to your users.ts)
// ========================================

// Simple CORS header utility
const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // More specific in production
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

// ** FIX **: This function now correctly returns staffId (UUID) and email separately.
function callerAuthContextFromClaims(payload: JWTPayload): { staffId: string; email: string; isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } {
  // 'sub' or 'username' claim is the UUID (staffId)
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

// Check for SUPER_ADMIN or ADMIN role
function isRoleAdmin(caller: { isSuperAdmin: boolean; rolesByClinic: Record<string, string>; }): boolean {
    if (caller.isSuperAdmin) return true;
    return Object.values(caller.rolesByClinic).some(role => role === 'A' || role === 'S');
}

// Role code mapping from your users.ts
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

  // ** FIX **: 'caller' now contains staffId (UUID) and email
  const caller = callerAuthContextFromClaims(verifyResult.payload);
  const isAdmin = isRoleAdmin(caller);

  const method = event.httpMethod;
  const path = event.path.replace('/hr', ''); // Normalize path, remove base /hr

  try {
    // GET /dashboard
    if (method === 'GET' && path === '/dashboard') {
      // ** FIX **: Pass the full caller object
      return getDashboard(caller, isAdmin);
    }
    
    // GET /clinics
    if (method === 'GET' && path === '/clinics') {
      // This is a placeholder. You already have a clinics.json file.
      // Ideally, you'd read this from a shared location (like an S3 bucket or another table)
      // For now, we return the clinics the user is part of.
      const clinicIds = Object.keys(caller.rolesByClinic);
      return httpOk({ clinics: clinicIds.map(id => ({ clinicId: id, clinicName: `Clinic ${id}` })) });
    }

    // --- SHIFTS ---
    // GET /shifts
    if (method === 'GET' && path === '/shifts') {
      // ** FIX **: Pass the full caller object
      return getShifts(caller, isAdmin, event.queryStringParameters);
    }
    // POST /shifts
    if (method === 'POST' && path === '/shifts') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      return createShift(JSON.parse(event.body));
    }
    // PUT /shifts/{shiftId}
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      return updateShift(shiftId, JSON.parse(event.body));
    }
    // DELETE /shifts/{shiftId}
    if (method === 'DELETE' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      return deleteShift(shiftId);
    }
    // PUT /shifts/{shiftId}/reject
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/reject$/)) {
      const shiftId = path.split('/')[2];
      // ** FIX **: Pass staffId (UUID) for comparison
      return rejectShift(shiftId, caller.staffId);
    }

    // --- LEAVE ---
    // GET /leave
    if (method === 'GET' && path === '/leave') {
      // ** FIX **: Pass the full caller object
      return getLeave(caller, isAdmin);
    }
    // POST /leave
    if (method === 'POST' && path === '/leave') {
      // ** FIX **: Pass staffId (UUID)
      return createLeave(caller.staffId, JSON.parse(event.body));
    }
    // DELETE /leave/{leaveId}
    if (method === 'DELETE' && path.match(/^\/leave\/[^\/]+$/)) {
      const leaveId = path.split('/')[2];
      // ** FIX **: Pass the full caller object for comparison
      return deleteLeave(leaveId, caller, isAdmin);
    }
    // PUT /leave/{leaveId}/approve
    if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/approve$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const leaveId = path.split('/')[2];
      return updateLeaveStatus(leaveId, 'approved');
    }
    // PUT /leave/{leaveId}/deny
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

// ** FIX **: Updated function signature
type CallerContext = { staffId: string; email: string; isSuperAdmin: boolean; rolesByClinic: Record<string, string>; };

// --- DASHBOARD ---
// ** FIX **: Use correct caller type
async function getDashboard(caller: CallerContext, isAdmin: boolean) {
  if (isAdmin) {
    // Admin Dashboard: Fetch aggregate stats (Total Staff, Budget, etc.)
    // This requires querying the StaffClinicInfo table and Shifts table
    // For simplicity, we'll return mock data based on the UI.
    // A real implementation would query and aggregate data.
    return httpOk({
      totalOffices: Object.keys(caller.rolesByClinic).length,
      totalStaff: 1, // Mock: would be a count from StaffClinicInfo
      thisWeeksShifts: 2, // Mock: would be a query on Shifts table
      budgetStatus: "On Track",
      currentWeekOverview: {
        totalShifts: 2,
        estimatedHours: 15,
        estimatedCost: 375.00,
      }
    });
  } else {
    // Staff Dashboard: Fetch personal stats
    // We need to query *shifts* for this user
    const { Items: shifts } = await ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byStaff',
        KeyConditionExpression: 'staffId = :staffId AND startTime < :now',
        ExpressionAttributeValues: {
            // ** FIX **: Use caller.staffId (UUID)
            ':staffId': caller.staffId,
            ':now': new Date().toISOString()
        }
    }));
    
    let completedHours = 0;
    let totalEarnings = 0;
    const completedShifts = (shifts || []).filter(s => s.status === 'completed');

    for (const shift of completedShifts) {
        completedHours += shift.totalHours || 0;
        totalEarnings += shift.pay || 0;
    }

    return httpOk({
      completedShifts: completedShifts.length,
      completedHours,
      totalEarnings,
    });
  }
}

// --- SHIFTS ---
// ** FIX **: Use correct caller type
async function getShifts(caller: CallerContext, isAdmin: boolean, queryParams: any) {
  const { clinicId, startDate, endDate, status } = queryParams || {};

  if (isAdmin) {
    // Admin: Get shifts for a specific clinic and date range
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
    // Staff: Get their own shifts, optionally filtered by status
    let KeyConditionExpression = 'staffId = :staffId';
    // ** FIX **: Use caller.staffId (UUID)
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

// ** CORRECTED **: This function logic is correct as per our last fix.
async function createShift(body: any) {
  const { staffId, clinicId, startTime, endTime } = body;
  if (!staffId || !clinicId || !startTime || !endTime) {
    return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
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
  // Get staff's hourly rate from the StaffClinicInfo table
  const { Item: staffInfo } = await ddb.send(new GetCommand({
      TableName: STAFF_INFO_TABLE,
      Key: { email: email, clinicId: clinicId } // Use the email we just found
  }));

  const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
  const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
  
  // Handle invalid times
  if (totalHours <= 0) {
      return httpErr(400, "End time must be after start time");
  }

  const pay = totalHours * hourlyRate;

  const shiftId = uuidv4();
  const shift = {
    shiftId,
    staffId, // This is the UUID, which is fine
    email: email, // Store the email for reference
    clinicId,
    startTime,
    endTime,
    totalHours: parseFloat(totalHours.toFixed(2)),
    hourlyRate: hourlyRate, // Store the rate used
    pay: parseFloat(pay.toFixed(2)),
    status: 'scheduled', // (scheduled, completed, rejected)
    ...body // Include other details like role
  };

  await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));
  return httpOk({ shiftId, message: "Shift created successfully" });
}

// ** FIX **: This function is now corrected with the same logic as createShift
async function updateShift(shiftId: string, body: any) {
    const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!oldShift) return httpErr(404, "Shift not found");

    // Determine the final staffId and clinicId
    const staffId = body.staffId || oldShift.staffId; // UUID
    const clinicId = body.clinicId || oldShift.clinicId;

    // ** ADDED **: We must re-fetch the user's email to get the hourly rate
    let email: string | undefined;
    try {
        const user = await cognito.send(new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: staffId // Use the final staffId (UUID)
        }));
        email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();
    } catch (err) {
        console.error("Cognito user lookup failed:", err);
        return httpErr(404, "Staff user not found in Cognito");
    }

    if (!email) {
        return httpErr(404, "Staff email not found, cannot determine pay");
    }

    // Get staff's hourly rate from the StaffClinicInfo table
    const { Item: staffInfo } = await ddb.send(new GetCommand({
      TableName: STAFF_INFO_TABLE,
      Key: { email: email, clinicId: clinicId } // Use email and clinicId
    }));
    
    const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
    const startTime = body.startTime || oldShift.startTime;
    const endTime = body.endTime || oldShift.endTime;
    const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
    
    // Handle invalid times
    if (totalHours <= 0) {
        return httpErr(400, "End time must be after start time");
    }

    const pay = totalHours * hourlyRate;

    const updatedShift = {
        ...oldShift,
        ...body,
        shiftId,
        staffId, // Ensure staffId is the UUID
        email: email, // Update the email
        clinicId,
        totalHours: parseFloat(totalHours.toFixed(2)),
        hourlyRate: hourlyRate,
        pay: parseFloat(pay.toFixed(2))
    };
    
    await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: updatedShift }));
    return httpOk({ shiftId, message: "Shift updated successfully" });
}

// ** CORRECTED **: This function was already correct. No changes needed.
async function deleteShift(shiftId: string) {
    await ddb.send(new DeleteCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
    return httpOk({ message: "Shift deleted successfully" });
}

// ** FIX **: Use staffId (UUID) for comparison
async function rejectShift(shiftId: string, staffId: string) {
    const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!Item) return httpErr(404, "Shift not found");
    
    // ** FIX **: This now correctly compares UUID (Item.staffId) to UUID (staffId)
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
// ** FIX **: Use correct caller type
async function getLeave(caller: CallerContext, isAdmin: boolean) {
    if (isAdmin) {
        // Admin: Get all leave requests
        const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
        return httpOk({ leaveRequests: Items || [] });
    } else {
        // Staff: Get their own leave requests
        const { Items } = await ddb.send(new QueryCommand({
            TableName: LEAVE_TABLE,
            IndexName: 'byStaff',
            KeyConditionExpression: 'staffId = :staffId',
            // ** FIX **: Use caller.staffId (UUID)
            ExpressionAttributeValues: { ':staffId': caller.staffId }
        }));
        return httpOk({ leaveRequests: Items || [] });
    }
}

// ** FIX **: staffId is the UUID
async function createLeave(staffId: string, body: any) {
  const { startDate, endDate } = body;
  if (!startDate || !endDate) {
    return httpErr(400, "startDate and endDate are required");
  }
  const leaveId = uuidv4();
  const leaveRequest = {
    leaveId,
    staffId, // This is the UUID
    startDate,
    endDate,
    status: 'pending' // (pending, approved, denied)
  };
  await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));
  return httpOk({ leaveId, message: "Leave request submitted" });
}

// ** FIX **: Use correct caller type and compare staffId
async function deleteLeave(leaveId: string, caller: CallerContext, isAdmin:boolean) {
    const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
    if (!Item) return httpErr(404, "Leave request not found");
    
    // ** FIX **: Compare Item.staffId (UUID) with caller.staffId (UUID)
    if (!isAdmin && Item.staffId !== caller.staffId) {
        return httpErr(403, "Forbidden");
    }

    await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
    return httpOk({ message: "Leave request deleted" });
}

// ** CORRECTED **: This function was already correct.
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
// // services/hr/index.ts

// import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
// import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
// import { v4 as uuidv4 } from 'uuid';
// import {
//   CognitoIdentityProviderClient,
//   AdminGetUserCommand,
//   ListUsersCommand,
// } from "@aws-sdk/client-cognito-identity-provider";

// // Environment Variables
// const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
// const LEAVE_TABLE = process.env.LEAVE_TABLE!;
// const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
// const USER_POOL_ID = process.env.USER_POOL_ID;
// const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;

// const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// const cognito = new CognitoIdentityProviderClient({});

// // ========================================
// // AUTH & ROUTING
// // ========================================

// const corsHeaders = {
//     'Access-Control-Allow-Origin': '*',
//     'Access-Control-Allow-Headers': 'Content-Type,Authorization',
//     'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
// };

// const httpErr = (code: number, message: string) => ({
//     statusCode: code, headers: corsHeaders, body: JSON.stringify({ success: false, message })
// });
// const httpOk = (data: Record<string, any>) => ({
//     statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, ...data })
// });

// const ISSUER = REGION && USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : undefined;
// let JWKS: ReturnType<typeof createRemoteJWKSet> | undefined;

// async function verifyIdToken(authorizationHeader: string): Promise<{ ok: true; payload: JWTPayload } | { ok: false; code: number; message: string }> {
//   if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
//     return { ok: false, code: 401, message: "missing bearer token" };
//   }
//   if (!ISSUER) return { ok: false, code: 500, message: "issuer not configured" };
//   const token = authorizationHeader.slice(7).trim();
//   try {
//     JWKS = JWKS || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
//     const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
//     if ((payload as any).token_use !== "id") {
//       return { ok: false, code: 401, message: "id token required" };
//     }
//     return { ok: true, payload };
//   } catch (_err) {
//     return { ok: false, code: 401, message: "invalid token" };
//   }
// }

// function callerAuthContextFromClaims(payload: JWTPayload): { staffId: string; email: string; isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } {
//   const staffId = String(payload.sub || payload.username || '');
//   const email = String(payload.email || '').toLowerCase();
  
//   const ctx: { staffId: string, email: string, isSuperAdmin: boolean; rolesByClinic: Record<string, string>; } = { 
//     staffId, 
//     email, 
//     isSuperAdmin: false, 
//     rolesByClinic: {} 
//   };
  
//   const groups = Array.isArray((payload as any)["cognito:groups"]) ? ((payload as any)["cognito:groups"] as string[]) : [];
//   for (const g of groups) {
//     if (String(g) === "GLOBAL__SUPER_ADMIN") {
//       ctx.isSuperAdmin = true;
//       continue;
//     }
//     const m = /^clinic_([^_][^\s]*)__([A-Z_]+)$/.exec(String(g));
//     if (!m) continue;
//     const clinicId = m[1];
//     const roleKey = m[2];
//     const code = roleKeyToCode(roleKey);
//     if (!code) continue;
//     ctx.rolesByClinic[clinicId] = code;
//   }
  
//   ctx.isSuperAdmin = ctx.isSuperAdmin || Object.values(ctx.rolesByClinic).includes("S");
//   return ctx;
// }

// function isRoleAdmin(caller: { isSuperAdmin: boolean; rolesByClinic: Record<string, string>; }): boolean {
//     if (caller.isSuperAdmin) return true;
//     return Object.values(caller.rolesByClinic).some(role => role === 'A' || role === 'S');
// }

// function roleKeyToCode(roleKey: string): string {
//   switch (String(roleKey).toUpperCase()) {
//     case "SUPER_ADMIN": return "S";
//     case "ADMIN": return "A";
//     case "PROVIDER": return "P";
//     case "MARKETING": return "M";
//     case "USER": return "U";
//     case "DOCTOR": return "D";
//     case "HYGIENIST": return "H";
//     case "DENTAL_ASSISTANT": return "DA";
//     case "TRAINEE": return "TC";
//     case "PATIENT_COORDINATOR": return "PC";
//     default: return "";
//   }
// }

// // ========================================
// // HELPER FUNCTIONS
// // ========================================

// // Check if a date is blocked by approved leave
// async function isDateBlocked(staffId: string, date: Date): Promise<boolean> {
//   const { Items } = await ddb.send(new QueryCommand({
//     TableName: LEAVE_TABLE,
//     IndexName: 'byStaff',
//     KeyConditionExpression: 'staffId = :staffId',
//     FilterExpression: '#status = :approved',
//     ExpressionAttributeNames: { '#status': 'status' },
//     ExpressionAttributeValues: {
//       ':staffId': staffId,
//       ':approved': 'approved'
//     }
//   }));

//   if (!Items || Items.length === 0) return false;

//   const dateTime = date.getTime();
//   return Items.some(leave => {
//     const startTime = new Date(leave.startDate).getTime();
//     const endTime = new Date(leave.endDate).getTime() + (24 * 60 * 60 * 1000 - 1);
//     return dateTime >= startTime && dateTime <= endTime;
//   });
// }

// // Get all shifts that overlap with a date range
// async function getOverlappingShifts(staffId: string, startDate: string, endDate: string): Promise<any[]> {
//   const { Items } = await ddb.send(new QueryCommand({
//     TableName: SHIFTS_TABLE,
//     IndexName: 'byStaff',
//     KeyConditionExpression: 'staffId = :staffId',
//     FilterExpression: '#status = :scheduled AND startTime <= :endDate AND endTime >= :startDate',
//     ExpressionAttributeNames: { '#status': 'status' },
//     ExpressionAttributeValues: {
//       ':staffId': staffId,
//       ':scheduled': 'scheduled',
//       ':startDate': startDate,
//       ':endDate': endDate
//     }
//   }));

//   return Items || [];
// }

// // ========================================
// // MAIN HANDLER (ROUTER)
// // ========================================

// export const handler = async (event: any) => {
//   if (event.httpMethod === "OPTIONS") {
//     return { statusCode: 200, headers: corsHeaders, body: "OK" };
//   }

//   const authz = event?.headers?.authorization || event?.headers?.Authorization || "";
//   const verifyResult = await verifyIdToken(authz);
//   if (!verifyResult.ok) {
//     return httpErr(verifyResult.code, verifyResult.message);
//   }

//   const caller = callerAuthContextFromClaims(verifyResult.payload);
//   const isAdmin = isRoleAdmin(caller);

//   const method = event.httpMethod;
//   const path = event.path.replace('/hr', '');

//   try {
//     if (method === 'GET' && path === '/dashboard') {
//       return getDashboard(caller, isAdmin);
//     }
    
//     if (method === 'GET' && path === '/clinics') {
//       const clinicIds = Object.keys(caller.rolesByClinic);
//       return httpOk({ clinics: clinicIds.map(id => ({ clinicId: id, clinicName: `Clinic ${id}` })) });
//     }

//     // --- SHIFTS ---
//     if (method === 'GET' && path === '/shifts') {
//       return getShifts(caller, isAdmin, event.queryStringParameters);
//     }
//     if (method === 'POST' && path === '/shifts') {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       return createShift(JSON.parse(event.body));
//     }
//     if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const shiftId = path.split('/')[2];
//       return updateShift(shiftId, JSON.parse(event.body));
//     }
//     if (method === 'DELETE' && path.match(/^\/shifts\/[^\/]+$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const shiftId = path.split('/')[2];
//       return deleteShift(shiftId);
//     }
//     if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/reject$/)) {
//       const shiftId = path.split('/')[2];
//       return rejectShift(shiftId, caller.staffId);
//     }

//     // --- LEAVE ---
//     if (method === 'GET' && path === '/leave') {
//       return getLeave(caller, isAdmin);
//     }
//     if (method === 'POST' && path === '/leave') {
//       return createLeave(caller.staffId, JSON.parse(event.body));
//     }
//     if (method === 'DELETE' && path.match(/^\/leave\/[^\/]+$/)) {
//       const leaveId = path.split('/')[2];
//       return deleteLeave(leaveId, caller, isAdmin);
//     }
//     if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/approve$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const leaveId = path.split('/')[2];
//       return approveLeave(leaveId);
//     }
//     if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/deny$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const leaveId = path.split('/')[2];
//       return updateLeaveStatus(leaveId, 'denied');
//     }

//     return httpErr(404, "Not Found");
//   } catch (err: any) {
//     console.error('Error in handler:', err);
//     return httpErr(500, err.message || "Internal server error");
//   }
// };

// // ========================================
// // BUSINESS LOGIC
// // ========================================

// type CallerContext = { staffId: string; email: string; isSuperAdmin: boolean; rolesByClinic: Record<string, string>; };

// async function getDashboard(caller: CallerContext, isAdmin: boolean) {
//   if (isAdmin) {
//     const now = new Date();
//     const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
//     const dayOfWeek = today.getDay();
//     const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
//     const weekStart = new Date(today.setDate(diff)).toISOString();
//     const weekEnd = new Date(today.setDate(diff + 6)).toISOString();

//     const staffCountPromise = cognito.send(new ListUsersCommand({
//       UserPoolId: USER_POOL_ID,
//       Limit: 0
//     }));
    
//     const adminClinics = Object.keys(caller.rolesByClinic);
//     const shiftQueryPromises = adminClinics.map(clinicId =>
//       ddb.send(new QueryCommand({
//         TableName: SHIFTS_TABLE,
//         IndexName: 'byClinicAndDate',
//         KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :start AND :end',
//         ExpressionAttributeValues: {
//           ':clinicId': clinicId,
//           ':start': weekStart,
//           ':end': weekEnd,
//         }
//       }))
//     );

//     const [staffResponse, ...shiftResponses] = await Promise.all([
//       staffCountPromise,
//       ...shiftQueryPromises
//     ]);
    
//     const totalStaff = staffResponse.Users?.length || 0;
//     const allShifts = shiftResponses.flatMap(res => res.Items || []);
    
//     let estimatedHours = 0;
//     let estimatedCost = 0;
//     allShifts.forEach(shift => {
//       estimatedHours += shift.totalHours || 0;
//       estimatedCost += shift.pay || 0;
//     });

//     return httpOk({
//       totalOffices: adminClinics.length,
//       totalStaff: totalStaff,
//       thisWeeksShifts: allShifts.length,
//       budgetStatus: "On Track",
//       currentWeekOverview: {
//         totalShifts: allShifts.length,
//         estimatedHours: parseFloat(estimatedHours.toFixed(2)),
//         estimatedCost: parseFloat(estimatedCost.toFixed(2)),
//       }
//     });

//   } else {
//     const { Items: shifts } = await ddb.send(new QueryCommand({
//         TableName: SHIFTS_TABLE,
//         IndexName: 'byStaff',
//         KeyConditionExpression: 'staffId = :staffId',
//         FilterExpression: '#status = :completed',
//         ExpressionAttributeNames: { '#status': 'status' },
//         ExpressionAttributeValues: {
//           ':staffId': caller.staffId,
//           ':completed': 'completed'
//         }
//     }));
    
//     let completedHours = 0;
//     let totalEarnings = 0;
//     const completedShifts = (shifts || []);

//     for (const shift of completedShifts) {
//         completedHours += shift.totalHours || 0;
//         totalEarnings += shift.pay || 0;
//     }

//     return httpOk({
//       completedShifts: completedShifts.length,
//       completedHours: parseFloat(completedHours.toFixed(2)),
//       totalEarnings: parseFloat(totalEarnings.toFixed(2)),
//     });
//   }
// }

// async function getShifts(caller: CallerContext, isAdmin: boolean, queryParams: any) {
//   const { clinicId, startDate, endDate, status } = queryParams || {};

//   if (isAdmin) {
//     if (!clinicId || !startDate || !endDate) {
//       return httpErr(400, "clinicId, startDate, and endDate are required for admin");
//     }
//     const { Items } = await ddb.send(new QueryCommand({
//         TableName: SHIFTS_TABLE,
//         IndexName: 'byClinicAndDate',
//         KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :startDate AND :endDate',
//         ExpressionAttributeValues: {
//             ':clinicId': clinicId,
//             ':startDate': startDate,
//             ':endDate': endDate,
//         }
//     }));
//     return httpOk({ shifts: Items || [] });

//   } else {
//     let KeyConditionExpression = 'staffId = :staffId';
//     const ExpressionAttributeValues: Record<string, any> = { ':staffId': caller.staffId };

//     if (startDate && endDate) {
//         KeyConditionExpression += ' AND startTime BETWEEN :startDate AND :endDate';
//         ExpressionAttributeValues[':startDate'] = startDate;
//         ExpressionAttributeValues[':endDate'] = endDate;
//     }
    
//     let FilterExpression;
//     if (status) {
//         FilterExpression = '#status = :status';
//         ExpressionAttributeValues[':status'] = status;
//     }

//     const { Items } = await ddb.send(new QueryCommand({
//         TableName: SHIFTS_TABLE,
//         IndexName: 'byStaff',
//         KeyConditionExpression,
//         FilterExpression,
//         ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
//         ExpressionAttributeValues
//     }));
//     return httpOk({ shifts: Items || [] });
//   }
// }

// async function createShift(body: any) {
//   const { staffId, clinicId, startTime, endTime } = body;
//   if (!staffId || !clinicId || !startTime || !endTime) {
//     return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
//   }

//   const shiftDate = new Date(startTime);
//   const isBlocked = await isDateBlocked(staffId, shiftDate);
//   if (isBlocked) {
//     return httpErr(400, "Cannot schedule shift: Staff has approved leave on this date");
//   }

//   let email: string | undefined;
//   try {
//     const user = await cognito.send(new AdminGetUserCommand({
//         UserPoolId: USER_POOL_ID,
//         Username: staffId 
//     }));
//     email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();
//   } catch (err) {
//     console.error("Cognito user lookup failed:", err);
//     return httpErr(404, "Staff user not found in Cognito");
//   }

//   if (!email) {
//     return httpErr(404, "Staff email not found, cannot determine pay");
//   }

//   const { Item: staffInfo } = await ddb.send(new GetCommand({
//       TableName: STAFF_INFO_TABLE,
//       Key: { email: email, clinicId: clinicId }
//   }));

//   const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
//   const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
  
//   if (totalHours <= 0) {
//       return httpErr(400, "End time must be after start time");
//   }

//   const pay = totalHours * hourlyRate;

//   const shiftId = uuidv4();
//   const shift = {
//     shiftId,
//     staffId,
//     email: email,
//     clinicId,
//     startTime,
//     endTime,
//     totalHours: parseFloat(totalHours.toFixed(2)),
//     hourlyRate: hourlyRate,
//     pay: parseFloat(pay.toFixed(2)),
//     status: 'scheduled',
//     ...body
//   };

//   await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));
//   return httpOk({ shiftId, message: "Shift created successfully" });
// }

// async function updateShift(shiftId: string, body: any) {
//     const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
//     if (!oldShift) return httpErr(404, "Shift not found");

//     const staffId = body.staffId || oldShift.staffId;
//     const clinicId = body.clinicId || oldShift.clinicId;
//     const startTime = body.startTime || oldShift.startTime;

//     const shiftDate = new Date(startTime);
//     const isBlocked = await isDateBlocked(staffId, shiftDate);
//     if (isBlocked) {
//       return httpErr(400, "Cannot update shift: Staff has approved leave on this date");
//     }

//     let email: string | undefined;
//     try {
//         const user = await cognito.send(new AdminGetUserCommand({
//             UserPoolId: USER_POOL_ID,
//             Username: staffId
//         }));
//         email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();
//     } catch (err) {
//         console.error("Cognito user lookup failed:", err);
//         return httpErr(404, "Staff user not found in Cognito");
//     }

//     if (!email) {
//         return httpErr(404, "Staff email not found, cannot determine pay");
//     }

//     const { Item: staffInfo } = await ddb.send(new GetCommand({
//       TableName: STAFF_INFO_TABLE,
//       Key: { email: email, clinicId: clinicId }
//     }));
    
//     const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
//     const endTime = body.endTime || oldShift.endTime;
//     const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
    
//     if (totalHours <= 0) {
//         return httpErr(400, "End time must be after start time");
//     }

//     const pay = totalHours * hourlyRate;

//     const updatedShift = {
//         ...oldShift,
//         ...body,
//         shiftId,
//         staffId,
//         email: email,
//         clinicId,
//         totalHours: parseFloat(totalHours.toFixed(2)),
//         hourlyRate: hourlyRate,
//         pay: parseFloat(pay.toFixed(2))
//     };
    
//     await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: updatedShift }));
//     return httpOk({ shiftId, message: "Shift updated successfully" });
// }

// async function deleteShift(shiftId: string) {
//     await ddb.send(new DeleteCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
//     return httpOk({ message: "Shift deleted successfully" });
// }

// async function rejectShift(shiftId: string, staffId: string) {
//     const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
//     if (!Item) return httpErr(404, "Shift not found");
    
//     if (Item.staffId !== staffId) return httpErr(403, "Forbidden: You do not own this shift");
//     if (Item.status !== 'scheduled') return httpErr(400, "Shift cannot be rejected");

//     await ddb.send(new UpdateCommand({
//         TableName: SHIFTS_TABLE,
//         Key: { shiftId },
//         UpdateExpression: 'set #status = :status',
//         ExpressionAttributeNames: { '#status': 'status' },
//         ExpressionAttributeValues: { ':status': 'rejected' }
//     }));
//     return httpOk({ shiftId, status: 'rejected' });
// }

// // --- LEAVE ---
// async function getLeave(caller: CallerContext, isAdmin: boolean) {
//     if (isAdmin) {
//         const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
//         return httpOk({ leaveRequests: Items || [] });
//     } else {
//         const { Items } = await ddb.send(new QueryCommand({
//             TableName: LEAVE_TABLE,
//             IndexName: 'byStaff',
//             KeyConditionExpression: 'staffId = :staffId',
//             ExpressionAttributeValues: { ':staffId': caller.staffId }
//         }));
//         return httpOk({ leaveRequests: Items || [] });
//     }
// }

// async function createLeave(staffId: string, body: any) {
//   const { startDate, endDate } = body;
//   if (!startDate || !endDate) {
//     return httpErr(400, "startDate and endDate are required");
//   }
//   const leaveId = uuidv4();
//   const leaveRequest = {
//     leaveId,
//     staffId,
//     startDate,
//     endDate,
//     status: 'pending'
//   };
//   await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));
//   return httpOk({ leaveId, message: "Leave request submitted" });
// }

// async function deleteLeave(leaveId: string, caller: CallerContext, isAdmin:boolean) {
//     const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
//     if (!Item) return httpErr(404, "Leave request not found");
    
//     if (!isAdmin && Item.staffId !== caller.staffId) {
//         return httpErr(403, "Forbidden");
//     }

//     await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
//     return httpOk({ message: "Leave request deleted" });
// }

// async function approveLeave(leaveId: string) {
//     console.log('🔄 Starting approveLeave for leaveId:', leaveId);
    
//     try {
//         // Get the leave request
//         const { Item: leave } = await ddb.send(new GetCommand({ 
//             TableName: LEAVE_TABLE, 
//             Key: { leaveId }
//         }));
        
//         if (!leave) {
//             console.error('❌ Leave request not found:', leaveId);
//             return httpErr(404, "Leave request not found");
//         }

//         console.log('✅ Found leave request:', JSON.stringify(leave, null, 2));

//         // Update leave status to approved
//         await ddb.send(new UpdateCommand({
//             TableName: LEAVE_TABLE,
//             Key: { leaveId },
//             UpdateExpression: 'set #status = :status',
//             ExpressionAttributeNames: { '#status': 'status' },
//             ExpressionAttributeValues: { ':status': 'approved' }
//         }));

//         console.log('✅ Leave status updated to approved');

//         // Find overlapping shifts
//         const overlappingShifts = await getOverlappingShifts(
//             leave.staffId, 
//             leave.startDate, 
//             leave.endDate
//         );
        
//         console.log(`📊 Found ${overlappingShifts.length} overlapping shifts:`, 
//             overlappingShifts.map(s => ({ shiftId: s.shiftId, startTime: s.startTime }))
//         );

//         // Cancel overlapping shifts
//         if (overlappingShifts.length > 0) {
//             const cancelPromises = overlappingShifts.map(shift => {
//                 console.log('🔄 Cancelling shift:', shift.shiftId);
//                 return ddb.send(new UpdateCommand({
//                     TableName: SHIFTS_TABLE,
//                     Key: { shiftId: shift.shiftId },
//                     UpdateExpression: 'set #status = :status',
//                     ExpressionAttributeNames: { '#status': 'status' },
//                     ExpressionAttributeValues: { ':status': 'rejected' }
//                 }));
//             });

//             await Promise.all(cancelPromises);
//             console.log('✅ All overlapping shifts cancelled');
//         }

//         const response = {
//             leaveId, 
//             status: 'approved',
//             cancelledShifts: overlappingShifts.length,
//             message: overlappingShifts.length > 0 
//                 ? `Leave approved. ${overlappingShifts.length} overlapping shift(s) have been automatically cancelled.`
//                 : 'Leave approved successfully. No shifts were affected.'
//         };

//         console.log('✅ Returning response:', response);
//         return httpOk(response);

//     } catch (error) {
//         console.error('❌ Error in approveLeave:', error);
//         throw error;
//     }
// }

// async function updateLeaveStatus(leaveId: string, status: 'approved' | 'denied') {
//     await ddb.send(new UpdateCommand({
//         TableName: LEAVE_TABLE,
//         Key: { leaveId },
//         UpdateExpression: 'set #status = :status',
//         ExpressionAttributeNames: { '#status': 'status' },
//         ExpressionAttributeValues: { ':status': status }
//     }));
//     return httpOk({ leaveId, status });
// }
// services/hr/index.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'; // <-- UPDATED: SESv2Client
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  isAdminUser,
  getAllowedClinicIds,
  hasClinicAccess,
  PermissionType,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

// Environment Variables
const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
const LEAVE_TABLE = process.env.LEAVE_TABLE!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID;
const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION;

// --- NEW SES Environment Variables (must be added to hr-stack.ts) ---
const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1'; // Defaulting to us-east-1 as per core-stack.ts
// --- END NEW ---

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const ses = new SESv2Client({ region: SES_REGION }); // <-- UPDATED: Initialize SESv2Client
const MODULE_NAME = 'HR';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

// ========================================
// AUTH & ROUTING
// ========================================

const corsHeaders = buildCorsHeaders(); // default fallback
let currentCorsHeaders = corsHeaders;

const httpErr = (code: number, message: string) => ({
    statusCode: code, headers: currentCorsHeaders, body: JSON.stringify({ success: false, message })
});
const httpOk = (data: Record<string, any>) => ({
    statusCode: 200, headers: currentCorsHeaders, body: JSON.stringify({ success: true, ...data })
});


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
    // Add one full day (24 hours in milliseconds) to the end date to cover the entire day
    const endTime = new Date(leave.endDate).getTime() + (24 * 60 * 60 * 1000 - 1); 
    // We check if the shift date falls within the leave period (inclusive)
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

// --- NEW: SES Email Function ---
async function sendShiftNotificationEmail(recipientEmail: string, shiftDetails: any, staffName: string) {
    if (!FROM_EMAIL || !recipientEmail) {
        console.warn('Skipping shift notification: Missing FROM_EMAIL or recipientEmail.');
        return;
    }
    
    const startTimeLocal = new Date(shiftDetails.startTime).toLocaleString('en-US', { timeZone: 'America/New_York' });
    const endTimeLocal = new Date(shiftDetails.endTime).toLocaleString('en-US', { timeZone: 'America/New_York' });
    const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    const subject = `New Shift Scheduled at ${shiftDetails.clinicId} for ${shiftDate}`;
    
    const bodyHtml = `
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 20px auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
                .header { background-color: #f4f4f4; padding: 10px; text-align: center; border-radius: 6px 6px 0 0; }
                .details { margin-top: 20px; border-top: 2px solid #333; padding-top: 15px; }
                .detail-row { margin-bottom: 10px; }
                .label { font-weight: bold; display: inline-block; width: 150px; }
                .footer { margin-top: 30px; text-align: center; font-size: 0.8em; color: #777; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Shift Schedule Notification</h2>
                </div>
                <p>Dear ${staffName || shiftDetails.staffId},</p>
                <p>A new shift has been scheduled for you. Please check the details below:</p>
                
                <div class="details">
                    <div class="detail-row"><span class="label">Office:</span> ${shiftDetails.clinicId}</div>
                    <div class="detail-row"><span class="label">Date:</span> ${shiftDate}</div>
                    <div class="detail-row"><span class="label">Start Time:</span> ${startTimeLocal}</div>
                    <div class="detail-row"><span class="label">End Time:</span> ${endTimeLocal}</div>
                    <div class="detail-row"><span class="label">Role:</span> ${shiftDetails.role || 'N/A'}</div>
                    <div class="detail-row"><span class="label">Hours:</span> ${shiftDetails.totalHours}</div>
                    <div class="detail-row"><span class="label">Hourly Rate:</span> $${shiftDetails.hourlyRate.toFixed(2)}</div>
                    <div class="detail-row"><span class="label">Estimated Pay:</span> $${shiftDetails.pay.toFixed(2)}</div>
                </div>

                <p>You can view and manage your shifts in the ${APP_NAME} portal.</p>

                <div class="footer">
                    This is an automated notification. Please do not reply.
                </div>
            </div>
        </body>
        </html>
    `;

    // Note: The structure for SESv2 SendEmailCommand is slightly different from v1 SendEmailCommand
    const command = new SendEmailCommand({
        Destination: { ToAddresses: [recipientEmail] },
        Content: { // Content replaces Message in v1
            Simple: {
                Subject: { Data: subject },
                Body: {
                    Html: { Data: bodyHtml },
                    Text: { 
                        Data: `A new shift has been scheduled for you on ${shiftDate} at ${shiftDetails.clinicId} from ${startTimeLocal} to ${endTimeLocal}. Estimated Pay: $${shiftDetails.pay.toFixed(2)}.`
                    }
                }
            }
        },
        FromEmailAddress: FROM_EMAIL, // FromEmailAddress replaces Source in v1
    });

    try {
        await ses.send(command);
        console.log(`Email sent successfully to ${recipientEmail} using SESv2`);
    } catch (e) {
        console.error(`Failed to send email to ${recipientEmail} using SESv2:`, e);
    }
}
// --- END NEW: SES Email Function ---

// ========================================
// MAIN HANDLER (ROUTER)
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  currentCorsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: currentCorsHeaders, body: "" };
  }

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return httpErr(401, 'Unauthorized - Invalid token');
  }

  const requiredPermission: PermissionType = METHOD_PERMISSIONS[event.httpMethod] || 'read';
  if (!hasModulePermission(
    userPerms.clinicRoles,
    MODULE_NAME,
    requiredPermission,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return httpErr(403, `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module`);
  }

  const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
  const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);

  const method = event.httpMethod;
  const path = event.path.replace('/hr', '');

  try {
    if (method === 'GET' && path === '/dashboard') {
      return getDashboard(userPerms, isAdmin);
    }

    if (method === 'GET' && path === '/clinics') {
      const clinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
      return httpOk({ clinics: clinicIds.map((id: string) => ({ clinicId: id, clinicName: `Clinic ${id}` })) });
    }

    // --- SHIFTS ---
    if (method === 'GET' && path === '/shifts') {
      return getShifts(userPerms, isAdmin, event.queryStringParameters, allowedClinics);
    }
    if (method === 'POST' && path === '/shifts') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      if (!event.body) return httpErr(400, "Missing request body");
      const parsedBody = JSON.parse(event.body);
      return createShift(parsedBody, allowedClinics); // <-- Will now send email
    }
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      if (!event.body) return httpErr(400, "Missing request body");
      const parsedBody = JSON.parse(event.body);
      return updateShift(shiftId, parsedBody, allowedClinics);
    }
    if (method === 'DELETE' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      return deleteShift(shiftId, allowedClinics);
    }
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/reject$/)) {
      const shiftId = path.split('/')[2];
      return rejectShift(shiftId, userPerms.email); // Use email instead of staffId
    }

    // --- LEAVE ---
    if (method === 'GET' && path === '/leave') {
      return getLeave(userPerms, isAdmin);
    }
    if (method === 'POST' && path === '/leave') {
      if (!event.body) return httpErr(400, "Missing request body");
      const parsedBody = JSON.parse(event.body);
      return createLeave(userPerms.email, parsedBody); // Use email instead of staffId
    }
    if (method === 'DELETE' && path.match(/^\/leave\/[^\/]+$/)) {
      const leaveId = path.split('/')[2];
      return deleteLeave(leaveId, userPerms, isAdmin);
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
    console.error('Error in handler:', err);
    return httpErr(500, err.message || "Internal server error");
  }
};

// ========================================
// BUSINESS LOGIC
// ========================================

type CallerContext = { staffId: string; email: string; isSuperAdmin: boolean; rolesByClinic: Record<string, string>; };

async function getDashboard(userPerms: any, isAdmin: boolean) {
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

    const adminClinics = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
    const shiftQueryPromises = adminClinics.map((clinicId: string) =>
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
          ':staffId': userPerms.email, // Use email instead of staffId
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

async function getShifts(userPerms: UserPermissions, isAdmin: boolean, queryParams: any, allowedClinics: Set<string>) {
  const { clinicId, startDate, endDate, status } = queryParams || {};

  if (isAdmin) {
    if (!clinicId || !startDate || !endDate) {
      return httpErr(400, "clinicId, startDate, and endDate are required for admin");
    }
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic");
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
    const ExpressionAttributeValues: Record<string, any> = { ':staffId': userPerms.email }; // Use email instead of staffId

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

async function createShift(body: any, allowedClinics: Set<string>) {
  const { staffId, clinicId, startTime, endTime } = body;
  if (!staffId || !clinicId || !startTime || !endTime) {
    return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
  }
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  const shiftDate = new Date(startTime);
  const isBlocked = await isDateBlocked(staffId, shiftDate);
  if (isBlocked) {
    return httpErr(400, "Cannot schedule shift: Staff has approved leave on this date");
  }

  let email: string | undefined;
  let staffName: string | undefined; // NEW
  try {
    const user = await cognito.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: staffId 
    }));
    email = (user.UserAttributes || []).find(a => a.Name === 'email')?.Value?.toLowerCase();
    const givenName = (user.UserAttributes || []).find(a => a.Name === 'given_name')?.Value;
    const familyName = (user.UserAttributes || []).find(a => a.Name === 'family_name')?.Value;
    staffName = `${givenName || ''} ${familyName || ''}`.trim(); // NEW
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

  // --- NEW: Send Email Notification ---
  await sendShiftNotificationEmail(email, shift, staffName || staffId);
  // --- END NEW ---

  return httpOk({ shiftId, message: "Shift created successfully" });
}

async function updateShift(shiftId: string, body: any, allowedClinics: Set<string>) {
    const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!oldShift) return httpErr(404, "Shift not found");

    const staffId = body.staffId || oldShift.staffId;
    const clinicId = body.clinicId || oldShift.clinicId;
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic");
    }
    const startTime = body.startTime || oldShift.startTime;

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

async function deleteShift(shiftId: string, allowedClinics: Set<string>) {
    const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!Item) return httpErr(404, "Shift not found");
    const clinicId = Item.clinicId;
    if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic");
    }
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
async function getLeave(userPerms: any, isAdmin: boolean) {
    if (isAdmin) {
        const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
        return httpOk({ leaveRequests: Items || [] });
    } else {
        const { Items } = await ddb.send(new QueryCommand({
            TableName: LEAVE_TABLE,
            IndexName: 'byStaff',
            KeyConditionExpression: 'staffId = :staffId',
            ExpressionAttributeValues: { ':staffId': userPerms.email } // Use email instead of staffId
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

async function deleteLeave(leaveId: string, userPerms: any, isAdmin:boolean) {
    const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
    if (!Item) return httpErr(404, "Leave request not found");

    if (!isAdmin && Item.staffId !== userPerms.email) { // Use email instead of staffId
        return httpErr(403, "Forbidden");
    }

    await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
    return httpOk({ message: "Leave request deleted" });
}

async function approveLeave(leaveId: string) {
    console.log('🔄 Starting approveLeave for leaveId:', leaveId);
    
    try {
        // Get the leave request
        const { Item: leave } = await ddb.send(new GetCommand({ 
            TableName: LEAVE_TABLE, 
            Key: { leaveId }
        }));
        
        if (!leave) {
            console.error('❌ Leave request not found:', leaveId);
            return httpErr(404, "Leave request not found");
        }

        console.log('✅ Found leave request:', JSON.stringify(leave, null, 2));

        // Update leave status to approved
        await ddb.send(new UpdateCommand({
            TableName: LEAVE_TABLE,
            Key: { leaveId },
            UpdateExpression: 'set #status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': 'approved' }
        }));

        console.log('✅ Leave status updated to approved');

        // Find overlapping shifts
        const overlappingShifts = await getOverlappingShifts(
            leave.staffId, 
            leave.startDate, 
            leave.endDate
        );
        
        console.log(`📊 Found ${overlappingShifts.length} overlapping shifts:`, 
            overlappingShifts.map(s => ({ shiftId: s.shiftId, startTime: s.startTime }))
        );

        // Cancel overlapping shifts
        if (overlappingShifts.length > 0) {
            const cancelPromises = overlappingShifts.map(shift => {
                console.log('🔄 Cancelling shift:', shift.shiftId);
                return ddb.send(new UpdateCommand({
                    TableName: SHIFTS_TABLE,
                    Key: { shiftId: shift.shiftId },
                    UpdateExpression: 'set #status = :status',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: { ':status': 'rejected' }
                }));
            });

            await Promise.all(cancelPromises);
            console.log('✅ All overlapping shifts cancelled');
        }

        const response = {
            leaveId, 
            status: 'approved',
            cancelledShifts: overlappingShifts.length,
            message: overlappingShifts.length > 0 
                ? `Leave approved. ${overlappingShifts.length} overlapping shift(s) have been automatically cancelled.`
                : 'Leave approved successfully. No shifts were affected.'
        };

        console.log('✅ Returning response:', response);
        return httpOk(response);

    } catch (error) {
        console.error('❌ Error in approveLeave:', error);
        throw error;
    }
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

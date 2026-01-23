// import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
// import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
// import { v4 as uuidv4 } from 'uuid';
// import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
// import { buildCorsHeaders } from '../../shared/utils/cors';
// import {
//   getUserPermissions,
//   hasModulePermission,
//   isAdminUser,
//   getAllowedClinicIds,
//   hasClinicAccess,
//   PermissionType,
//   UserPermissions,
// } from '../../shared/utils/permissions-helper';
// import { AuditLogger, AuditResource } from '../shared/audit-logger';
// import { makeOpenDentalRequest } from '../../shared/utils/opendental-api';

// // Environment Variables
// const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
// const LEAVE_TABLE = process.env.LEAVE_TABLE!;
// const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
// const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE!; // DynamoDB table for user lookups (replaces Cognito)
// const CLINICS_TABLE = process.env.CLINICS_TABLE || 'Clinics'; // For timezone lookup

// // SES Environment Variables
// const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';
// const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';
// const SES_REGION = process.env.SES_REGION || 'us-east-1';

// // Timezone cache to avoid repeated DynamoDB lookups
// const timezoneCache: Map<string, { timezone: string; timestamp: number }> = new Map();
// const TIMEZONE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// const ses = new SESv2Client({ region: SES_REGION });
// const auditLogger = new AuditLogger(ddb);
// const MODULE_NAME = 'HR';
// const METHOD_PERMISSIONS: Record<string, PermissionType> = {
//   GET: 'read',
//   POST: 'write',
//   PUT: 'put',
//   DELETE: 'delete',
// };

// // ========================================
// // AUTH & ROUTING
// // ========================================

// const corsHeaders = buildCorsHeaders(); // default fallback
// let currentCorsHeaders = corsHeaders;

// const httpErr = (code: number, message: string) => ({
//   statusCode: code, headers: currentCorsHeaders, body: JSON.stringify({ success: false, message })
// });
// const httpOk = (data: Record<string, any>) => ({
//   statusCode: 200, headers: currentCorsHeaders, body: JSON.stringify({ success: true, ...data })
// });

// // ========================================
// // JWT TOKEN EXTRACTION HELPER
// // ========================================

// /**
//  * Safely extracts the JWT token from request headers.
//  * Handles case-insensitive header names and 'Bearer ' prefix.
//  * 
//  * @param headers - Request headers object (may have various casing)
//  * @returns The extracted JWT token string, or null if not found/invalid
//  */
// function extractJwtToken(headers: Record<string, string | undefined> | null | undefined): string | null {
//   if (!headers) {
//     return null;
//   }

//   // Find the Authorization header with case-insensitive lookup
//   const authHeaderKey = Object.keys(headers).find(
//     (key) => key.toLowerCase() === 'authorization'
//   );

//   if (!authHeaderKey) {
//     return null;
//   }

//   const authHeaderValue = headers[authHeaderKey];
//   if (!authHeaderValue || typeof authHeaderValue !== 'string') {
//     return null;
//   }

//   const trimmedValue = authHeaderValue.trim();

//   // Check for 'Bearer ' prefix (case-insensitive)
//   const bearerPrefix = 'bearer ';
//   if (trimmedValue.toLowerCase().startsWith(bearerPrefix)) {
//     const token = trimmedValue.slice(bearerPrefix.length).trim();
//     // Return null if the token is empty after stripping the prefix
//     return token.length > 0 ? token : null;
//   }

//   // If no Bearer prefix, return null (we expect Bearer tokens)
//   return null;
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
//     // Add one full day (24 hours in milliseconds) to the end date to cover the entire day
//     const endTime = new Date(leave.endDate).getTime() + (24 * 60 * 60 * 1000 - 1);
//     // We check if the shift date falls within the leave period (inclusive)
//     return dateTime >= startTime && dateTime <= endTime;
//   });
// }

// // Get all shifts that overlap with a date range
// // Leave dates are in YYYY-MM-DD format, shift times are in ISO format
// async function getOverlappingShifts(staffId: string, startDate: string, endDate: string): Promise<any[]> {
//   console.log(`🔍 getOverlappingShifts: Looking for shifts for staffId=${staffId} between ${startDate} and ${endDate}`);

//   // Convert leave dates to ISO strings that cover the entire day range
//   // startDate should start at 00:00:00 of that day
//   // endDate should end at 23:59:59 of that day
//   const leaveStartISO = new Date(startDate + 'T00:00:00Z').toISOString();
//   const leaveEndISO = new Date(endDate + 'T23:59:59.999Z').toISOString();

//   console.log(`🔍 Converted dates: leaveStart=${leaveStartISO}, leaveEnd=${leaveEndISO}`);

//   // Query shifts for this staff member
//   // We need to find shifts where the shift's time range overlaps with the leave date range
//   // A shift overlaps if: shiftStart <= leaveEnd AND shiftEnd >= leaveStart
//   const { Items } = await ddb.send(new QueryCommand({
//     TableName: SHIFTS_TABLE,
//     IndexName: 'byStaff',
//     KeyConditionExpression: 'staffId = :staffId',
//     FilterExpression: '#status = :scheduled AND startTime <= :leaveEnd AND endTime >= :leaveStart',
//     ExpressionAttributeNames: { '#status': 'status' },
//     ExpressionAttributeValues: {
//       ':staffId': staffId,
//       ':scheduled': 'scheduled',
//       ':leaveStart': leaveStartISO,
//       ':leaveEnd': leaveEndISO
//     }
//   }));

//   console.log(`🔍 Found ${Items?.length || 0} overlapping shifts:`, Items?.map((s: any) => ({
//     shiftId: s.shiftId,
//     startTime: s.startTime,
//     endTime: s.endTime,
//     status: s.status
//   })));

//   return Items || [];
// }

// // Get clinic timezone from Clinics table (with caching)
// async function getClinicTimezone(clinicId: string): Promise<string> {
//   const DEFAULT_TIMEZONE = 'America/New_York';

//   // Check cache first
//   const cached = timezoneCache.get(clinicId);
//   if (cached && Date.now() - cached.timestamp < TIMEZONE_CACHE_TTL_MS) {
//     return cached.timezone;
//   }

//   try {
//     const { Item } = await ddb.send(new GetCommand({
//       TableName: CLINICS_TABLE,
//       Key: { clinicId },
//     }));

//     // Support both field names: timeZone and timezone
//     const timezone = Item?.timeZone || Item?.timezone || DEFAULT_TIMEZONE;

//     // Cache the result
//     timezoneCache.set(clinicId, { timezone, timestamp: Date.now() });

//     return timezone;
//   } catch (error) {
//     console.error(`Error fetching timezone for clinic ${clinicId}:`, error);
//     return DEFAULT_TIMEZONE;
//   }
// }

// function normalizeTimeZoneOrUtc(timeZone: string): string {
//   try {
//     // Throws RangeError for invalid IANA zones
//     new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
//     return timeZone;
//   } catch {
//     return 'UTC';
//   }
// }

// function hasExplicitTimeZone(dateTime: string): boolean {
//   // Examples: 2026-01-20T14:00:00.000Z, 2026-01-20T14:00:00Z, 2026-01-20T14:00:00-05:00
//   return /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(dateTime);
// }

// type NaiveDateTimeParts = {
//   year: number;
//   month: number; // 1-12
//   day: number;   // 1-31
//   hour: number;  // 0-23
//   minute: number;// 0-59
//   second: number;// 0-59
// };

// function parseNaiveDateTime(dateTime: string): NaiveDateTimeParts | null {
//   const normalized = dateTime.trim().replace(' ', 'T');
//   const m = normalized.match(
//     /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
//   );
//   if (!m) return null;
//   return {
//     year: Number(m[1]),
//     month: Number(m[2]),
//     day: Number(m[3]),
//     hour: Number(m[4]),
//     minute: Number(m[5]),
//     second: m[6] ? Number(m[6]) : 0,
//   };
// }

// function getTimeZoneOffsetMs(timeZone: string, utcInstant: Date): number {
//   // This returns the offset (in ms) between the provided timeZone and UTC at the given instant.
//   const dtf = new Intl.DateTimeFormat('en-US', {
//     timeZone,
//     hour12: false,
//     year: 'numeric',
//     month: '2-digit',
//     day: '2-digit',
//     hour: '2-digit',
//     minute: '2-digit',
//     second: '2-digit',
//   });
//   const parts = dtf.formatToParts(utcInstant);
//   const map: Record<string, string> = {};
//   for (const p of parts) {
//     if (p.type !== 'literal') map[p.type] = p.value;
//   }
//   const asUtc = Date.UTC(
//     Number(map.year),
//     Number(map.month) - 1,
//     Number(map.day),
//     Number(map.hour),
//     Number(map.minute),
//     Number(map.second)
//   );
//   return asUtc - utcInstant.getTime();
// }

// function clinicLocalPartsToUtcDate(parts: NaiveDateTimeParts, timeZone: string): Date {
//   // Create an initial UTC guess by treating the clinic-local wall time as if it were UTC.
//   const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));

//   // First-pass offset at the guess instant.
//   const offset1 = getTimeZoneOffsetMs(timeZone, utcGuess);
//   let utcDate = new Date(utcGuess.getTime() - offset1);

//   // DST transitions can change the offset; do a second pass to stabilize.
//   const offset2 = getTimeZoneOffsetMs(timeZone, utcDate);
//   if (offset2 !== offset1) {
//     utcDate = new Date(utcGuess.getTime() - offset2);
//   }

//   return utcDate;
// }

// function normalizeToUtcIso(dateTime: string, clinicTimeZone: string): string {
//   const tz = normalizeTimeZoneOrUtc(clinicTimeZone);
//   const input = String(dateTime || '').trim();
//   if (!input) throw new Error('Missing date/time');

//   if (hasExplicitTimeZone(input)) {
//     const d = new Date(input);
//     if (isNaN(d.getTime())) throw new Error(`Invalid date/time: ${input}`);
//     return d.toISOString();
//   }

//   const parts = parseNaiveDateTime(input);
//   if (!parts) throw new Error(`Invalid date/time format (expected YYYY-MM-DDTHH:mm[:ss]): ${input}`);
//   const utc = clinicLocalPartsToUtcDate(parts, tz);
//   if (isNaN(utc.getTime())) throw new Error(`Invalid date/time after timezone conversion: ${input}`);
//   return utc.toISOString();
// }

// // --- NEW: SES Email Function ---
// async function sendShiftNotificationEmail(recipientEmail: string, shiftDetails: any, staffName: string, clinicTimezone: string) {
//   if (!FROM_EMAIL || !recipientEmail) {
//     console.warn('Skipping shift notification: Missing FROM_EMAIL or recipientEmail.');
//     return;
//   }

//   const tz = normalizeTimeZoneOrUtc(clinicTimezone);

//   // Format time only (not full date-time) for Start Time and End Time fields
//   const startTimeLocal = new Date(shiftDetails.startTime).toLocaleTimeString('en-US', {
//     timeZone: tz,
//     hour: 'numeric',
//     minute: '2-digit',
//     hour12: true
//   });
//   const endTimeLocal = new Date(shiftDetails.endTime).toLocaleTimeString('en-US', {
//     timeZone: tz,
//     hour: 'numeric',
//     minute: '2-digit',
//     hour12: true
//   });
//   const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

//   const subject = `New Shift Scheduled at ${shiftDetails.clinicId} for ${shiftDate}`;

//   const bodyHtml = `
//         <html>
//         <head>
//             <style>
//                 body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//                 .container { max-width: 600px; margin: 20px auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
//                 .header { background-color: #f4f4f4; padding: 10px; text-align: center; border-radius: 6px 6px 0 0; }
//                 .details { margin-top: 20px; border-top: 2px solid #333; padding-top: 15px; }
//                 .detail-row { margin-bottom: 10px; }
//                 .label { font-weight: bold; display: inline-block; width: 150px; }
//                 .footer { margin-top: 30px; text-align: center; font-size: 0.8em; color: #777; }
//             </style>
//         </head>
//         <body>
//             <div class="container">
//                 <div class="header">
//                     <h2>Shift Schedule Notification</h2>
//                 </div>
//                 <p>Dear ${staffName || shiftDetails.staffId},</p>
//                 <p>A new shift has been scheduled for you. Please check the details below:</p>
                
//                 <div class="details">
//                     <div class="detail-row"><span class="label">Office:</span> ${shiftDetails.clinicId}</div>
//                     <div class="detail-row"><span class="label">Date:</span> ${shiftDate}</div>
//                     <div class="detail-row"><span class="label">Start Time:</span> ${startTimeLocal}</div>
//                     <div class="detail-row"><span class="label">End Time:</span> ${endTimeLocal}</div>
//                     <div class="detail-row"><span class="label">Role:</span> ${shiftDetails.role || 'N/A'}</div>
//                     <div class="detail-row"><span class="label">Hours:</span> ${shiftDetails.totalHours}</div>
//                     <div class="detail-row"><span class="label">Hourly Rate:</span> $${shiftDetails.hourlyRate.toFixed(2)}</div>
//                     <div class="detail-row"><span class="label">Estimated Pay:</span> $${shiftDetails.pay.toFixed(2)}</div>
//                 </div>

//                 <p>You can view and manage your shifts in the ${APP_NAME} portal.</p>

//                 <div class="footer">
//                     This is an automated notification. Please do not reply.
//                 </div>
//             </div>
//         </body>
//         </html>
//     `;

//   // Note: The structure for SESv2 SendEmailCommand is slightly different from v1 SendEmailCommand
//   const command = new SendEmailCommand({
//     Destination: { ToAddresses: [recipientEmail] },
//     Content: { // Content replaces Message in v1
//       Simple: {
//         Subject: { Data: subject },
//         Body: {
//           Html: { Data: bodyHtml },
//           Text: {
//             Data: `A new shift has been scheduled for you on ${shiftDate} at ${shiftDetails.clinicId} from ${startTimeLocal} to ${endTimeLocal}. Estimated Pay: $${shiftDetails.pay.toFixed(2)}.`
//           }
//         }
//       }
//     },
//     FromEmailAddress: FROM_EMAIL, // FromEmailAddress replaces Source in v1
//   });

//   try {
//     await ses.send(command);
//     console.log(`Email sent successfully to ${recipientEmail} using SESv2`);
//   } catch (e) {
//     console.error(`Failed to send email to ${recipientEmail} using SESv2:`, e);
//   }
// }
// // --- END NEW: SES Email Function ---

// // ========================================
// // MAIN HANDLER (ROUTER)
// // ========================================

// export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
//   currentCorsHeaders = buildCorsHeaders({}, event.headers?.origin);

//   if (event.httpMethod === "OPTIONS") {
//     return { statusCode: 204, headers: currentCorsHeaders, body: "" };
//   }

//   // Get user permissions from custom authorizer
//   const userPerms = getUserPermissions(event);
//   if (!userPerms) {
//     return httpErr(401, 'Unauthorized - Invalid token');
//   }

//   const requiredPermission: PermissionType = METHOD_PERMISSIONS[event.httpMethod] || 'read';
//   if (!hasModulePermission(
//     userPerms.clinicRoles,
//     MODULE_NAME,
//     requiredPermission,
//     userPerms.isSuperAdmin,
//     userPerms.isGlobalSuperAdmin
//   )) {
//     return httpErr(403, `You do not have ${requiredPermission} permission for the ${MODULE_NAME} module`);
//   }

//   const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
//   const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);

//   const method = event.httpMethod;
//   const path = event.path.replace('/hr', '');

//   try {
//     if (method === 'GET' && path === '/dashboard') {
//       return getDashboard(userPerms, isAdmin);
//     }

//     if (method === 'GET' && path === '/clinics') {
//       const clinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
//       return httpOk({ clinics: clinicIds.map((id: string) => ({ clinicId: id, clinicName: `Clinic ${id}` })) });
//     }

//     // --- SHIFTS ---
//     if (method === 'GET' && path === '/shifts') {
//       return getShifts(userPerms, isAdmin, event.queryStringParameters, allowedClinics);
//     }
//     if (method === 'POST' && path === '/shifts') {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       if (!event.body) return httpErr(400, "Missing request body");
//       const parsedBody = JSON.parse(event.body);
//       return createShift(parsedBody, allowedClinics, userPerms, event); // <-- Will now send email + audit log
//     }
//     if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const shiftId = path.split('/')[2];
//       if (!event.body) return httpErr(400, "Missing request body");
//       const parsedBody = JSON.parse(event.body);
//       return updateShift(shiftId, parsedBody, allowedClinics, userPerms, event);
//     }
//     if (method === 'DELETE' && path.match(/^\/shifts\/[^\/]+$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const shiftId = path.split('/')[2];
//       return deleteShift(shiftId, allowedClinics, userPerms, event);
//     }
//     if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/reject$/)) {
//       const shiftId = path.split('/')[2];
//       const reason = event.body ? JSON.parse(event.body)?.reason : undefined;
//       return rejectShift(shiftId, userPerms.email, userPerms, event, reason);
//     }
//     if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/complete$/)) {
//       const shiftId = path.split('/')[2];
//       return completeShift(shiftId, allowedClinics, userPerms, event);
//     }

//     // --- SHIFT STATUS SYNC (from clock events) ---
//     if (method === 'POST' && path === '/shifts/sync') {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const parsedBody = event.body ? JSON.parse(event.body) : {};
//       return syncShiftStatusFromClockEvents(parsedBody, allowedClinics, userPerms, event);
//     }

//     // --- LEAVE ---
//     if (method === 'GET' && path === '/leave') {
//       return getLeave(userPerms, isAdmin);
//     }
//     if (method === 'POST' && path === '/leave') {
//       if (!event.body) return httpErr(400, "Missing request body");
//       const parsedBody = JSON.parse(event.body);
//       return createLeave(userPerms.email, parsedBody, userPerms, event);
//     }
//     if (method === 'DELETE' && path.match(/^\/leave\/[^\/]+$/)) {
//       const leaveId = path.split('/')[2];
//       return deleteLeave(leaveId, userPerms, isAdmin, event);
//     }
//     if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/approve$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const leaveId = path.split('/')[2];
//       const approvalNotes = event.body ? JSON.parse(event.body)?.notes : undefined;
//       return approveLeave(leaveId, userPerms, event, approvalNotes);
//     }
//     if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/deny$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const leaveId = path.split('/')[2];
//       const denyReason = event.body ? JSON.parse(event.body)?.reason : undefined;
//       return updateLeaveStatus(leaveId, 'denied', userPerms, event, denyReason);
//     }

//     // --- AUDIT TRAIL ROUTES (Admin only) ---
//     if (method === 'GET' && path === '/audit') {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       return queryAuditLogs(event.queryStringParameters);
//     }
//     if (method === 'GET' && path.match(/^\/audit\/[^\/]+\/[^\/]+$/)) {
//       if (!isAdmin) return httpErr(403, "Forbidden");
//       const parts = path.split('/');
//       const resourceType = parts[2].toUpperCase() as AuditResource;
//       const resourceId = parts[3];
//       return getResourceAuditTrail(resourceType, resourceId, event.queryStringParameters);
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

// async function getDashboard(userPerms: any, isAdmin: boolean) {
//   if (isAdmin) {
//     const now = new Date();
//     const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
//     const dayOfWeek = today.getDay();
//     const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
//     const weekStart = new Date(today.setDate(diff)).toISOString();
//     const weekEnd = new Date(today.setDate(diff + 6)).toISOString();

//     // Count active staff from DynamoDB StaffUser table instead of Cognito
//     const staffCountPromise = ddb.send(new ScanCommand({
//       TableName: STAFF_USER_TABLE,
//       FilterExpression: 'isActive = :active',
//       ExpressionAttributeValues: { ':active': true },
//       Select: 'COUNT',
//     }));

//     const adminClinics = userPerms.clinicRoles.map((cr: any) => cr.clinicId);
//     const shiftQueryPromises = adminClinics.map((clinicId: string) =>
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

//     const totalStaff = staffResponse.Count || 0;
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
//       TableName: SHIFTS_TABLE,
//       IndexName: 'byStaff',
//       KeyConditionExpression: 'staffId = :staffId',
//       FilterExpression: '#status = :completed',
//       ExpressionAttributeNames: { '#status': 'status' },
//       ExpressionAttributeValues: {
//         ':staffId': userPerms.email, // Use email instead of staffId
//         ':completed': 'completed'
//       }
//     }));

//     let completedHours = 0;
//     let totalEarnings = 0;
//     const completedShifts = (shifts || []);

//     for (const shift of completedShifts) {
//       completedHours += shift.totalHours || 0;
//       totalEarnings += shift.pay || 0;
//     }

//     return httpOk({
//       completedShifts: completedShifts.length,
//       completedHours: parseFloat(completedHours.toFixed(2)),
//       totalEarnings: parseFloat(totalEarnings.toFixed(2)),
//     });
//   }
// }

// async function getShifts(userPerms: UserPermissions, isAdmin: boolean, queryParams: any, allowedClinics: Set<string>) {
//   const { clinicId, startDate, endDate, status } = queryParams || {};

//   // Admin querying shifts for a specific clinic (requires all params)
//   if (isAdmin && clinicId) {
//     if (!startDate || !endDate) {
//       return httpErr(400, "startDate and endDate are required when querying by clinicId");
//     }
//     if (!hasClinicAccess(allowedClinics, clinicId)) {
//       return httpErr(403, "Forbidden: no access to this clinic");
//     }
//     const { Items } = await ddb.send(new QueryCommand({
//       TableName: SHIFTS_TABLE,
//       IndexName: 'byClinicAndDate',
//       KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :startDate AND :endDate',
//       ExpressionAttributeValues: {
//         ':clinicId': clinicId,
//         ':startDate': startDate,
//         ':endDate': endDate,
//       }
//     }));

//     const tz = await getClinicTimezone(clinicId);
//     const shifts = Items || [];
//     const normalized = shifts.map((s: any) => ({
//       ...s,
//       startTime: normalizeToUtcIso(s.startTime, tz),
//       endTime: normalizeToUtcIso(s.endTime, tz),
//     }));
//     return httpOk({ shifts: normalized });
//   }

//   // Query own shifts (for both staff and admins when no clinicId specified)
//   let KeyConditionExpression = 'staffId = :staffId';
//   const ExpressionAttributeValues: Record<string, any> = { ':staffId': userPerms.email };

//   if (startDate && endDate) {
//     KeyConditionExpression += ' AND startTime BETWEEN :startDate AND :endDate';
//     ExpressionAttributeValues[':startDate'] = startDate;
//     ExpressionAttributeValues[':endDate'] = endDate;
//   }

//   let FilterExpression;
//   if (status) {
//     FilterExpression = '#status = :status';
//     ExpressionAttributeValues[':status'] = status;
//   }

//   const { Items } = await ddb.send(new QueryCommand({
//     TableName: SHIFTS_TABLE,
//     IndexName: 'byStaff',
//     KeyConditionExpression,
//     FilterExpression,
//     ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
//     ExpressionAttributeValues
//   }));

//   const shifts = Items || [];
//   const normalized = await Promise.all(
//     shifts.map(async (s: any) => {
//       const tz = await getClinicTimezone(s.clinicId);
//       return {
//         ...s,
//         startTime: normalizeToUtcIso(s.startTime, tz),
//         endTime: normalizeToUtcIso(s.endTime, tz),
//       };
//     })
//   );
//   return httpOk({ shifts: normalized });
// }

// async function createShift(body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
//   const { staffId, clinicId, startTime: rawStartTime, endTime: rawEndTime, ...restBody } = body;
//   if (!staffId || !clinicId || !rawStartTime || !rawEndTime) {
//     return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
//   }
//   if (!hasClinicAccess(allowedClinics, clinicId)) {
//     return httpErr(403, "Forbidden: no access to this clinic");
//   }

//   // Always interpret any timezone-less timestamps as clinic-local time, then normalize to UTC ISO.
//   const clinicTimezone = await getClinicTimezone(clinicId);
//   const startTime = normalizeToUtcIso(rawStartTime, clinicTimezone);
//   const endTime = normalizeToUtcIso(rawEndTime, clinicTimezone);

//   const shiftDate = new Date(startTime);
//   const isBlocked = await isDateBlocked(staffId, shiftDate);
//   if (isBlocked) {
//     return httpErr(400, "Cannot schedule shift: Staff has approved leave on this date");
//   }

//   // Look up user from DynamoDB StaffUser table (staffId is the email)
//   let email: string;
//   let staffName: string | undefined;
//   try {
//     const { Item: staffUser } = await ddb.send(new GetCommand({
//       TableName: STAFF_USER_TABLE,
//       Key: { email: staffId.toLowerCase() },
//     }));

//     if (!staffUser) {
//       console.error("Staff user not found in StaffUser table:", staffId);
//       return httpErr(404, "Staff user not found");
//     }

//     email = staffUser.email?.toLowerCase();
//     const givenName = staffUser.givenName;
//     const familyName = staffUser.familyName;
//     staffName = `${givenName || ''} ${familyName || ''}`.trim();
//   } catch (err) {
//     console.error("StaffUser table lookup failed:", err);
//     return httpErr(500, "Error looking up staff user");
//   }

//   if (!email) {
//     return httpErr(404, "Staff email not found, cannot determine pay");
//   }

//   const { Item: staffInfo } = await ddb.send(new GetCommand({
//     TableName: STAFF_INFO_TABLE,
//     Key: { email: email, clinicId: clinicId }
//   }));

//   const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
//   const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);

//   if (totalHours <= 0) {
//     return httpErr(400, "End time must be after start time");
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
//     ...restBody
//   };

//   await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));

//   // --- Audit Log ---
//   if (userPerms) {
//     await auditLogger.log({
//       userId: userPerms.email,
//       userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//       userRole: AuditLogger.getUserRole(userPerms),
//       action: 'CREATE',
//       resource: 'SHIFT',
//       resourceId: shiftId,
//       clinicId: clinicId,
//       after: AuditLogger.sanitizeForAudit(shift),
//       metadata: AuditLogger.createShiftMetadata(shift),
//       ...AuditLogger.extractRequestContext(event),
//     });
//   }

//   // --- Send Email Notification ---
//   await sendShiftNotificationEmail(email, shift, staffName || staffId, clinicTimezone);

//   return httpOk({ shiftId, message: "Shift created successfully" });
// }

// async function updateShift(shiftId: string, body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
//   const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
//   if (!oldShift) return httpErr(404, "Shift not found");

//   const staffId = body.staffId || oldShift.staffId;
//   const clinicId = body.clinicId || oldShift.clinicId;
//   if (!hasClinicAccess(allowedClinics, clinicId)) {
//     return httpErr(403, "Forbidden: no access to this clinic");
//   }

//   const clinicTimezone = await getClinicTimezone(clinicId);
//   const startTime = normalizeToUtcIso(body.startTime || oldShift.startTime, clinicTimezone);

//   const shiftDate = new Date(startTime);
//   const isBlocked = await isDateBlocked(staffId, shiftDate);
//   if (isBlocked) {
//     return httpErr(400, "Cannot update shift: Staff has approved leave on this date");
//   }

//   // Look up user from DynamoDB StaffUser table (staffId is the email)
//   let email: string | undefined;
//   try {
//     const { Item: staffUser } = await ddb.send(new GetCommand({
//       TableName: STAFF_USER_TABLE,
//       Key: { email: staffId.toLowerCase() },
//     }));

//     if (!staffUser) {
//       console.error("Staff user not found in StaffUser table:", staffId);
//       return httpErr(404, "Staff user not found");
//     }

//     email = staffUser.email?.toLowerCase();
//   } catch (err) {
//     console.error("StaffUser table lookup failed:", err);
//     return httpErr(500, "Error looking up staff user");
//   }

//   if (!email) {
//     return httpErr(404, "Staff email not found, cannot determine pay");
//   }

//   const { Item: staffInfo } = await ddb.send(new GetCommand({
//     TableName: STAFF_INFO_TABLE,
//     Key: { email: email, clinicId: clinicId }
//   }));

//   const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
//   const endTime = normalizeToUtcIso(body.endTime || oldShift.endTime, clinicTimezone);
//   const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);

//   if (totalHours <= 0) {
//     return httpErr(400, "End time must be after start time");
//   }

//   const pay = totalHours * hourlyRate;

//   const { startTime: _bodyStartTime, endTime: _bodyEndTime, ...restBody } = body || {};
//   const updatedShift = {
//     ...oldShift,
//     ...restBody,
//     shiftId,
//     staffId,
//     email: email,
//     clinicId,
//     startTime,
//     endTime,
//     totalHours: parseFloat(totalHours.toFixed(2)),
//     hourlyRate: hourlyRate,
//     pay: parseFloat(pay.toFixed(2))
//   };

//   await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: updatedShift }));

//   // --- Audit Log ---
//   if (userPerms) {
//     await auditLogger.log({
//       userId: userPerms.email,
//       userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//       userRole: AuditLogger.getUserRole(userPerms),
//       action: 'UPDATE',
//       resource: 'SHIFT',
//       resourceId: shiftId,
//       clinicId: clinicId,
//       before: AuditLogger.sanitizeForAudit(oldShift),
//       after: AuditLogger.sanitizeForAudit(updatedShift),
//       metadata: AuditLogger.createShiftMetadata(updatedShift),
//       ...AuditLogger.extractRequestContext(event),
//     });
//   }

//   return httpOk({ shiftId, message: "Shift updated successfully" });
// }

// async function deleteShift(shiftId: string, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
//   const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
//   if (!Item) return httpErr(404, "Shift not found");
//   const clinicId = Item.clinicId;
//   if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
//     return httpErr(403, "Forbidden: no access to this clinic");
//   }
//   await ddb.send(new DeleteCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));

//   // --- Audit Log ---
//   if (userPerms) {
//     await auditLogger.log({
//       userId: userPerms.email,
//       userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//       userRole: AuditLogger.getUserRole(userPerms),
//       action: 'DELETE',
//       resource: 'SHIFT',
//       resourceId: shiftId,
//       clinicId: clinicId,
//       before: AuditLogger.sanitizeForAudit(Item),
//       metadata: AuditLogger.createShiftMetadata(Item),
//       ...AuditLogger.extractRequestContext(event),
//     });
//   }

//   return httpOk({ message: "Shift deleted successfully" });
// }

// async function rejectShift(shiftId: string, staffId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, reason?: string) {
//   const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
//   if (!Item) return httpErr(404, "Shift not found");

//   if (Item.staffId !== staffId) return httpErr(403, "Forbidden: You do not own this shift");
//   if (Item.status !== 'scheduled') return httpErr(400, "Shift cannot be rejected");

//   await ddb.send(new UpdateCommand({
//     TableName: SHIFTS_TABLE,
//     Key: { shiftId },
//     UpdateExpression: 'set #status = :status',
//     ExpressionAttributeNames: { '#status': 'status' },
//     ExpressionAttributeValues: { ':status': 'rejected' }
//   }));

//   // --- Audit Log ---
//   if (userPerms) {
//     await auditLogger.log({
//       userId: userPerms.email,
//       userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//       userRole: AuditLogger.getUserRole(userPerms),
//       action: 'REJECT',
//       resource: 'SHIFT',
//       resourceId: shiftId,
//       clinicId: Item.clinicId,
//       before: { status: Item.status },
//       after: { status: 'rejected' },
//       reason: reason,
//       metadata: AuditLogger.createShiftMetadata(Item),
//       ...AuditLogger.extractRequestContext(event),
//     });
//   }

//   return httpOk({ shiftId, status: 'rejected' });
// }

// async function completeShift(shiftId: string, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
//     const { Item: shift } = await ddb.send(new GetCommand({ 
//       TableName: SHIFTS_TABLE, 
//       Key: { shiftId } 
//     }));
    
//     if (!shift) {
//       return httpErr(404, "Shift not found");
//     }
    
//     if (!hasClinicAccess(allowedClinics, shift.clinicId)) {
//       return httpErr(403, "Forbidden: no access to this clinic");
//     }
    
//     // Only scheduled shifts can be completed
//     if (shift.status !== 'scheduled') {
//       return httpErr(400, `Cannot complete shift with status: ${shift.status}`);
//     }

//     const completedAt = new Date().toISOString();
//     const updatedShift = {
//       ...shift,
//       status: 'completed',
//       completedAt: completedAt,
//     };

//     await ddb.send(new UpdateCommand({
//         TableName: SHIFTS_TABLE,
//         Key: { shiftId },
//         UpdateExpression: 'set #status = :status, completedAt = :completedAt',
//         ExpressionAttributeNames: { '#status': 'status' },
//         ExpressionAttributeValues: { 
//           ':status': 'completed',
//           ':completedAt': completedAt,
//         }
//     }));

//     // --- Audit Log ---
//     if (userPerms) {
//       await auditLogger.log({
//         userId: userPerms.email,
//         userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//         userRole: AuditLogger.getUserRole(userPerms),
//         action: 'COMPLETE',
//         resource: 'SHIFT',
//         resourceId: shiftId,
//         clinicId: shift.clinicId,
//         before: { status: shift.status },
//         after: { status: 'completed', completedAt: completedAt },
//         metadata: {
//           ...AuditLogger.createShiftMetadata(updatedShift),
//           actionType: 'Shift Marked as Completed',
//           completedBy: userPerms.email,
//           completedAt: completedAt,
//         },
//         ...AuditLogger.extractRequestContext(event),
//       });
//     }

//     return httpOk({ shiftId, status: 'completed', message: "Shift marked as completed" });
// }

// // ========================================
// // SHIFT STATUS SYNC FROM CLOCK EVENTS
// // ========================================

// /**
//  * Clock event interface from Open Dental API
//  */
// interface OpenDentalClockEvent {
//   ClockEventNum: number;
//   EmployeeNum: number;
//   TimeDisplayed1: string; // Clock-in time (can be null/0001-01-01)
//   TimeDisplayed2: string; // Clock-out time (can be null/0001-01-01)
//   ClockStatus: number; // 0=Home, 1=Lunch, 2=Break
//   Note?: string;
//   ClinicNum?: number;
// }

// /**
//  * Employee interface from Open Dental API
//  */
// interface OpenDentalEmployee {
//   EmployeeNum: number;
//   FName: string;
//   LName: string;
//   IsHidden: boolean;
//   ClinicNum?: number;
//   EmailWork?: string;
//   EmailPersonal?: string;
// }

// /**
//  * Sync shift statuses from Open Dental clock events
//  * This function:
//  * 1. Fetches scheduled shifts for the given date range
//  * 2. For each clinic, fetches clock events and employees from Open Dental
//  * 3. Matches shifts to clock events based on employee name and time overlap
//  * 4. Updates shift status to 'completed' if a matching clock event is found
//  * 
//  * POST /hr/shifts/sync
//  * Body: { startDate?: string, endDate?: string } - defaults to past 7 days
//  */
// async function syncShiftStatusFromClockEvents(
//   body: any,
//   allowedClinics: Set<string>,
//   userPerms: UserPermissions,
//   event: APIGatewayProxyEvent
// ): Promise<APIGatewayProxyResult> {
//   console.log('🔄 Starting shift status sync from clock events');

//   // Parse date range from body or default to past 7 days
//   const now = new Date();
//   const defaultStartDate = new Date(now);
//   defaultStartDate.setDate(defaultStartDate.getDate() - 7);

//   const startDate = body?.startDate || defaultStartDate.toISOString().split('T')[0];
//   const endDate = body?.endDate || now.toISOString().split('T')[0];

//   console.log(`📅 Syncing shifts from ${startDate} to ${endDate}`);

//   // Get list of clinics to sync
//   const clinicsToSync = body?.clinicId
//     ? [body.clinicId]
//     : Array.from(allowedClinics);

//   if (clinicsToSync.length === 0) {
//     return httpErr(400, 'No clinics available to sync');
//   }

//   const syncResults: {
//     clinicId: string;
//     shiftsChecked: number;
//     shiftsCompleted: number;
//     errors: string[];
//   }[] = [];

//   for (const clinicId of clinicsToSync) {
//     // Check access
//     if (!hasClinicAccess(allowedClinics, clinicId)) {
//       console.warn(`⚠️ Skipping clinic ${clinicId} - no access`);
//       continue;
//     }

//     const clinicResult = {
//       clinicId,
//       shiftsChecked: 0,
//       shiftsCompleted: 0,
//       errors: [] as string[],
//     };

//     try {
//       // Fetch scheduled shifts for this clinic in the date range
//       const { Items: shifts } = await ddb.send(new QueryCommand({
//         TableName: SHIFTS_TABLE,
//         IndexName: 'byClinicAndDate',
//         KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :startDate AND :endDate',
//         FilterExpression: '#status = :scheduled',
//         ExpressionAttributeNames: { '#status': 'status' },
//         ExpressionAttributeValues: {
//           ':clinicId': clinicId,
//           ':startDate': startDate + 'T00:00:00.000Z',
//           ':endDate': endDate + 'T23:59:59.999Z',
//           ':scheduled': 'scheduled',
//         },
//       }));

//       const scheduledShifts = shifts || [];
//       clinicResult.shiftsChecked = scheduledShifts.length;

//       if (scheduledShifts.length === 0) {
//         console.log(`📋 No scheduled shifts found for clinic ${clinicId}`);
//         syncResults.push(clinicResult);
//         continue;
//       }

//       console.log(`📋 Found ${scheduledShifts.length} scheduled shifts for clinic ${clinicId}`);

//       // Fetch employees from Open Dental
//       let employees: OpenDentalEmployee[] = [];
//       try {
//         const employeesResponse = await makeOpenDentalRequest(
//           'GET',
//           `/api/v1/employees`,
//           clinicId
//         );
//         employees = Array.isArray(employeesResponse) ? employeesResponse : [];
//         console.log(`👥 Fetched ${employees.length} employees from Open Dental for clinic ${clinicId}`);
//       } catch (err: any) {
//         console.error(`❌ Failed to fetch employees from Open Dental:`, err);
//         clinicResult.errors.push(`Failed to fetch employees: ${err.message}`);
//         syncResults.push(clinicResult);
//         continue;
//       }

//       // Fetch clock events from Open Dental for the date range
//       let clockEvents: OpenDentalClockEvent[] = [];
//       try {
//         const clockEventsResponse = await makeOpenDentalRequest(
//           'GET',
//           `/api/v1/clockevents?DateStart=${startDate}&DateEnd=${endDate}`,
//           clinicId
//         );
//         clockEvents = Array.isArray(clockEventsResponse) ? clockEventsResponse : [];
//         console.log(`⏰ Fetched ${clockEvents.length} clock events from Open Dental for clinic ${clinicId}`);
//       } catch (err: any) {
//         console.error(`❌ Failed to fetch clock events from Open Dental:`, err);
//         clinicResult.errors.push(`Failed to fetch clock events: ${err.message}`);
//         syncResults.push(clinicResult);
//         continue;
//       }

//       // Filter clock events: only complete events (has both clock in and out, status 0=Home or 1=Lunch)
//       const completedClockEvents = clockEvents.filter(ce => {
//         const hasClockIn = ce.TimeDisplayed1 && !ce.TimeDisplayed1.startsWith('0001-01-01');
//         const hasClockOut = ce.TimeDisplayed2 && !ce.TimeDisplayed2.startsWith('0001-01-01');
//         const isWorkEvent = ce.ClockStatus === 0 || ce.ClockStatus === 1; // Home or Lunch (not Break)
//         return hasClockIn && hasClockOut && isWorkEvent;
//       });

//       console.log(`✅ ${completedClockEvents.length} completed clock events (with clock-out)`);

//       // Create employee lookup map: EmployeeNum -> Employee
//       const employeeMap = new Map<number, OpenDentalEmployee>();
//       for (const emp of employees) {
//         employeeMap.set(emp.EmployeeNum, emp);
//       }

//       // Process each scheduled shift
//       for (const shift of scheduledShifts) {
//         try {
//           // Find matching clock event
//           const matchingClockEvent = findMatchingClockEvent(
//             shift,
//             completedClockEvents,
//             employeeMap
//           );

//           if (matchingClockEvent) {
//             // Update shift status to completed
//             await ddb.send(new UpdateCommand({
//               TableName: SHIFTS_TABLE,
//               Key: { shiftId: shift.shiftId },
//               UpdateExpression: 'SET #status = :status, completedAt = :completedAt, clockEventId = :clockEventId',
//               ExpressionAttributeNames: { '#status': 'status' },
//               ExpressionAttributeValues: {
//                 ':status': 'completed',
//                 ':completedAt': new Date().toISOString(),
//                 ':clockEventId': matchingClockEvent.ClockEventNum,
//               },
//             }));

//             clinicResult.shiftsCompleted++;
//             console.log(`✅ Updated shift ${shift.shiftId} to completed (clockEventId: ${matchingClockEvent.ClockEventNum})`);

//             // Create audit log
//             await auditLogger.log({
//               userId: userPerms.email,
//               userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//               userRole: AuditLogger.getUserRole(userPerms),
//               action: 'SYNC_COMPLETE',
//               resource: 'SHIFT',
//               resourceId: shift.shiftId,
//               clinicId: clinicId,
//               before: { status: 'scheduled' },
//               after: { status: 'completed', clockEventId: matchingClockEvent.ClockEventNum },
//               metadata: {
//                 actionType: 'Shift Status Synced',
//                 syncSource: 'OpenDental ClockEvents',
//                 clockEventNum: matchingClockEvent.ClockEventNum,
//                 clockIn: matchingClockEvent.TimeDisplayed1,
//                 clockOut: matchingClockEvent.TimeDisplayed2,
//               },
//               ...AuditLogger.extractRequestContext(event),
//             });
//           }
//         } catch (err: any) {
//           console.error(`❌ Error processing shift ${shift.shiftId}:`, err);
//           clinicResult.errors.push(`Failed to process shift ${shift.shiftId}: ${err.message}`);
//         }
//       }
//     } catch (err: any) {
//       console.error(`❌ Error syncing clinic ${clinicId}:`, err);
//       clinicResult.errors.push(`Clinic sync error: ${err.message}`);
//     }

//     syncResults.push(clinicResult);
//   }

//   // Calculate totals
//   const totalShiftsChecked = syncResults.reduce((sum, r) => sum + r.shiftsChecked, 0);
//   const totalShiftsCompleted = syncResults.reduce((sum, r) => sum + r.shiftsCompleted, 0);
//   const totalErrors = syncResults.reduce((sum, r) => sum + r.errors.length, 0);

//   console.log(`🏁 Sync complete: ${totalShiftsCompleted}/${totalShiftsChecked} shifts marked as completed`);

//   return httpOk({
//     message: 'Shift status sync completed',
//     dateRange: { startDate, endDate },
//     summary: {
//       totalShiftsChecked,
//       totalShiftsCompleted,
//       totalErrors,
//     },
//     details: syncResults,
//   });
// }

// /**
//  * Find a matching clock event for a shift
//  * Matches based on:
//  * 1. Employee email matching shift's staff email
//  * 2. Clock event date matching shift date
//  * 3. Clock event time window overlapping with shift time window (at least 50% coverage)
//  */
// function findMatchingClockEvent(
//   shift: any,
//   clockEvents: OpenDentalClockEvent[],
//   employeeMap: Map<number, OpenDentalEmployee>
// ): OpenDentalClockEvent | null {
//   const shiftStart = new Date(shift.startTime);
//   const shiftEnd = new Date(shift.endTime);
//   const shiftDate = shiftStart.toISOString().split('T')[0];

//   // Get staff email from shift (primary identifier)
//   const staffEmail = (shift.staffId || shift.email || '').toLowerCase().trim();

//   if (!staffEmail) {
//     console.warn(`⚠️ Shift ${shift.shiftId} has no staffId or email, cannot match`);
//     return null;
//   }

//   for (const clockEvent of clockEvents) {
//     const employee = employeeMap.get(clockEvent.EmployeeNum);
//     if (!employee) continue;

//     // First, try to match by email (most reliable)
//     const empEmailWork = (employee.EmailWork || '').toLowerCase().trim();
//     const empEmailPersonal = (employee.EmailPersonal || '').toLowerCase().trim();

//     const emailMatches = staffEmail === empEmailWork || staffEmail === empEmailPersonal;

//     if (!emailMatches) {
//       // If no email match, try name matching as fallback
//       const empFirstName = (employee.FName || '').toLowerCase().trim();
//       const empLastName = (employee.LName || '').toLowerCase().trim();

//       // Extract name components from email (e.g., "john.doe@example.com" -> "john" "doe")
//       const emailPrefix = staffEmail.split('@')[0].replace(/[._-]/g, ' ');
//       const nameMatch = (emailPrefix.includes(empFirstName) && empFirstName.length > 2) ||
//                        (emailPrefix.includes(empLastName) && empLastName.length > 2);

//       if (!nameMatch) continue;
//     }

//     // Check if clock event is on the same date as the shift
//     const clockInTime = new Date(clockEvent.TimeDisplayed1);
//     const clockOutTime = new Date(clockEvent.TimeDisplayed2);
//     const clockDate = clockInTime.toISOString().split('T')[0];

//     if (clockDate !== shiftDate) continue;

//     // Check time overlap
//     // Clock out should be after shift start (staff worked during shift time)
//     if (clockOutTime <= shiftStart) continue;

//     // Clock in should be before shift end (staff started before shift ended)
//     if (clockInTime >= shiftEnd) continue;

//     // Calculate overlap duration
//     const overlapStart = Math.max(clockInTime.getTime(), shiftStart.getTime());
//     const overlapEnd = Math.min(clockOutTime.getTime(), shiftEnd.getTime());
//     const overlapDurationMs = overlapEnd - overlapStart;

//     const shiftDurationMs = shiftEnd.getTime() - shiftStart.getTime();

//     // Require at least 50% overlap
//     const overlapPercentage = (overlapDurationMs / shiftDurationMs) * 100;
//     if (overlapPercentage < 50) continue;

//     console.log(`✅ Matched shift ${shift.shiftId} to employee ${employee.FName} ${employee.LName} (${overlapPercentage.toFixed(1)}% overlap)`);
//     return clockEvent;
//   }

//   return null;
// }

// // --- LEAVE ---
// async function getLeave(userPerms: any, isAdmin: boolean) {
//   if (isAdmin) {
//     // Admin can view leaves from multiple clinics
//     const adminClinics = userPerms.clinicRoles?.map((cr: any) => cr.clinicId) || [];

//     if (adminClinics.length === 0) {
//       // Super admin - scan all leaves
//       const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
//       return httpOk({ leaveRequests: Items || [] });
//     }

//     // Query leaves for each clinic admin has access to
//     const allLeaves: any[] = [];
//     const queryPromises = adminClinics.map((clinicId: string) =>
//       ddb.send(new QueryCommand({
//         TableName: LEAVE_TABLE,
//         IndexName: 'byClinicAndStatus',
//         KeyConditionExpression: 'clinicId = :clinicId',
//         ExpressionAttributeValues: { ':clinicId': clinicId },
//       }))
//     );

//     try {
//       const results = await Promise.all(queryPromises);
//       results.forEach(result => {
//         if (result.Items) allLeaves.push(...result.Items);
//       });
//     } catch (err) {
//       console.warn('⚠️ Error querying leaves by clinic, falling back to scan:', err);
//       // Fallback: scan all and filter by clinic
//       const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
//       return httpOk({
//         leaveRequests: (Items || []).filter((item: any) =>
//           adminClinics.includes(item.clinicId) ||
//           (item.clinicIds && item.clinicIds.some((cid: string) => adminClinics.includes(cid)))
//         )
//       });
//     }

//     return httpOk({ leaveRequests: allLeaves });
//   } else {
//     // Staff member views their own leaves
//     const { Items } = await ddb.send(new QueryCommand({
//       TableName: LEAVE_TABLE,
//       IndexName: 'byStaff',
//       KeyConditionExpression: 'staffId = :staffId',
//       ExpressionAttributeValues: { ':staffId': userPerms.email }
//     }));
//     return httpOk({ leaveRequests: Items || [] });
//   }
// }

// async function createLeave(staffId: string, body: any, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
//   const { startDate, endDate, reason } = body;
//   if (!startDate || !endDate) {
//     return httpErr(400, "startDate and endDate are required");
//   }

//   // Lookup all clinics where this staff member works
//   let staffClinicIds: string[] = [];
//   try {
//     const { Items: staffInfoItems } = await ddb.send(new QueryCommand({
//       TableName: STAFF_INFO_TABLE,
//       KeyConditionExpression: 'email = :email',
//       ExpressionAttributeValues: { ':email': staffId.toLowerCase() },
//     }));
//     staffClinicIds = (staffInfoItems || []).map((item: any) => item.clinicId).filter(Boolean);
//     console.log(`📋 Staff ${staffId} works at ${staffClinicIds.length} clinic(s):`, staffClinicIds);
//   } catch (lookupError) {
//     console.warn('⚠️ Could not look up staff clinics:', lookupError);
//     // Fallback to admin's clinic if lookup fails
//     const adminClinicId = userPerms?.clinicRoles?.[0]?.clinicId;
//     staffClinicIds = adminClinicId ? [adminClinicId] : [];
//   }

//   const leaveId = uuidv4();
//   const createdAt = new Date().toISOString();
//   const leaveRequest = {
//     leaveId,
//     staffId,
//     startDate,
//     endDate,
//     reason,
//     status: 'pending',
//     clinicIds: staffClinicIds, // Store all clinics where this staff member works
//     createdAt: createdAt, // Timestamp for audit trail
//   };

//   // Store the main leave record
//   await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));

//   // Also store clinic-specific entries for GSI (denormalization for clinic filtering)
//   // This allows efficient queries by clinic via the byClinicAndStatus GSI
//   const clinicLeavePromises = staffClinicIds.map((clinicId: string) =>
//     ddb.send(new PutCommand({
//       TableName: LEAVE_TABLE,
//       Item: {
//         leaveId: `${leaveId}#${clinicId}`, // Compound key for GSI
//         clinicId, // GSI partition key
//         startDate, // GSI sort key
//         staffId,
//         endDate,
//         reason,
//         status: 'pending',
//         clinicIds: staffClinicIds,
//         isClinicIndexEntry: true, // Marker to identify GSI entries
//         primaryLeaveId: leaveId, // Link back to primary record
//       },
//     }))
//   );

//   if (clinicLeavePromises.length > 0) {
//     try {
//       await Promise.all(clinicLeavePromises);
//       console.log(`✅ Created ${clinicLeavePromises.length} clinic index entries`);
//     } catch (err) {
//       console.warn('⚠️ Failed to create clinic index entries (primary record saved):', err);
//     }
//   }

//   // --- Audit Logs (one per clinic for visibility when filtering by clinic) ---
//   if (userPerms && staffClinicIds.length > 0) {
//     const auditPromises = staffClinicIds.map((clinicId: string) =>
//       auditLogger.log({
//         userId: userPerms.email,
//         userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//         userRole: AuditLogger.getUserRole(userPerms),
//         action: 'CREATE',
//         resource: 'LEAVE',
//         resourceId: leaveId,
//         clinicId: clinicId, // Include each clinic for filtering
//         after: AuditLogger.sanitizeForAudit(leaveRequest),
//         metadata: {
//           ...AuditLogger.createLeaveMetadata(leaveRequest),
//           actionType: 'Leave Request Created',
//           staffClinicIds: staffClinicIds,
//           createdBy: userPerms.email,
//         },
//         ...AuditLogger.extractRequestContext(event),
//       })
//     );
//     await Promise.all(auditPromises);
//     console.log(`✅ Audit logs created for leave ${leaveId} across ${staffClinicIds.length} clinic(s)`);
//   }

//   return httpOk({ leaveId, message: "Leave request submitted" });
// }

// async function deleteLeave(leaveId: string, userPerms: UserPermissions, isAdmin: boolean, event?: APIGatewayProxyEvent) {
//   const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
//   if (!Item) return httpErr(404, "Leave request not found");

//   if (!isAdmin && Item.staffId !== userPerms.email) {
//     return httpErr(403, "Forbidden");
//   }

//   await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));

//   // --- Audit Logs (one per clinic for visibility) ---
//   // Use stored clinic IDs or lookup staff's clinics
//   let clinicsToLog = Item.clinicIds || [];
//   if (clinicsToLog.length === 0) {
//     // Fallback: lookup staff's clinics
//     try {
//       const { Items: staffInfoItems } = await ddb.send(new QueryCommand({
//         TableName: STAFF_INFO_TABLE,
//         KeyConditionExpression: 'email = :email',
//         ExpressionAttributeValues: { ':email': Item.staffId.toLowerCase() },
//       }));
//       clinicsToLog = (staffInfoItems || []).map((item: any) => item.clinicId).filter(Boolean);
//     } catch (err) {
//       console.warn('Could not look up staff clinics for audit:', err);
//       clinicsToLog = [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);
//     }
//   }

//   // Log deletion to all relevant clinics
//   const auditPromises = clinicsToLog.map((clinicId: string) =>
//     auditLogger.log({
//       userId: userPerms.email,
//       userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//       userRole: AuditLogger.getUserRole(userPerms),
//       action: 'DELETE',
//       resource: 'LEAVE',
//       resourceId: leaveId,
//       clinicId: clinicId,
//       before: AuditLogger.sanitizeForAudit(Item),
//       metadata: {
//         ...AuditLogger.createLeaveMetadata(Item),
//         actionType: 'Leave Request Deleted',
//         staffClinicIds: clinicsToLog,
//         deletedBy: userPerms.email,
//       },
//       ...AuditLogger.extractRequestContext(event),
//     })
//   );

//   if (auditPromises.length > 0) {
//     await Promise.all(auditPromises);
//     console.log(`✅ Audit logs created for leave deletion across ${clinicsToLog.length} clinic(s)`);
//   }

//   return httpOk({ message: "Leave request deleted" });
// }

// async function approveLeave(leaveId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, approvalNotes?: string) {
//   console.log('🔄 Starting approveLeave for leaveId:', leaveId);
//   console.log('🔄 LEAVE_TABLE:', LEAVE_TABLE);
//   console.log('🔄 SHIFTS_TABLE:', SHIFTS_TABLE);

//   try {
//     // Validate input
//     if (!leaveId || leaveId === 'undefined') {
//       console.error('❌ Invalid leaveId:', leaveId);
//       return httpErr(400, "Invalid leave ID");
//     }

//     // Get the leave request
//     console.log('🔄 Getting leave request from DynamoDB...');
//     const { Item: leave } = await ddb.send(new GetCommand({
//       TableName: LEAVE_TABLE,
//       Key: { leaveId }
//     }));

//     if (!leave) {
//       console.error('❌ Leave request not found:', leaveId);
//       return httpErr(404, "Leave request not found");
//     }

//     console.log('✅ Found leave request:', JSON.stringify(leave, null, 2));

//     // Validate leave object has required fields
//     if (!leave.staffId) {
//       console.error('❌ Leave request missing staffId:', leave);
//       return httpErr(400, "Leave request is missing staffId");
//     }

//     // Update leave status to approved
//     console.log('🔄 Updating leave status to approved...');
//     await ddb.send(new UpdateCommand({
//       TableName: LEAVE_TABLE,
//       Key: { leaveId },
//       UpdateExpression: 'set #status = :status',
//       ExpressionAttributeNames: { '#status': 'status' },
//       ExpressionAttributeValues: { ':status': 'approved' }
//     }));

//     console.log('✅ Leave status updated to approved');

//     // Find overlapping shifts (only if we have valid date range)
//     let overlappingShifts: any[] = [];
//     if (leave.startDate && leave.endDate) {
//       try {
//         overlappingShifts = await getOverlappingShifts(
//           leave.staffId,
//           leave.startDate,
//           leave.endDate
//         );

//         console.log(`📊 Found ${overlappingShifts.length} overlapping shifts:`,
//           overlappingShifts.map(s => ({ shiftId: s.shiftId, startTime: s.startTime }))
//         );
//       } catch (shiftError) {
//         console.error('⚠️ Error finding overlapping shifts (continuing anyway):', shiftError);
//         // Don't fail the approval if shift lookup fails
//       }
//     } else {
//       console.warn('⚠️ Leave request missing dates, skipping shift cancellation');
//     }

//     // DELETE overlapping shifts (not just cancel - actually remove from table)
//     if (overlappingShifts.length > 0) {
//       try {
//         console.log(`🔄 DELETING ${overlappingShifts.length} overlapping shift(s) from table...`);

//         const deletePromises = overlappingShifts.map(async (shift) => {
//           console.log('🗑️ Deleting shift:', shift.shiftId, 'for date:', shift.startTime);

//           // ACTUALLY DELETE the shift from the table
//           await ddb.send(new DeleteCommand({
//             TableName: SHIFTS_TABLE,
//             Key: { shiftId: shift.shiftId }
//           }));

//           console.log('✅ Shift deleted from table:', shift.shiftId);

//           // Audit log for each deleted shift
//           if (userPerms) {
//             await auditLogger.log({
//               userId: userPerms.email,
//               userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//               userRole: AuditLogger.getUserRole(userPerms),
//               action: 'DELETE',
//               resource: 'SHIFT',
//               resourceId: shift.shiftId,
//               clinicId: shift.clinicId, // Use shift's actual clinicId
//               before: AuditLogger.sanitizeForAudit(shift),
//               reason: `Shift deleted due to approved leave request (${leaveId})`,
//               metadata: {
//                 ...AuditLogger.createShiftMetadata(shift),
//                 leaveId: leaveId,
//                 leaveStartDate: leave.startDate,
//                 leaveEndDate: leave.endDate,
//                 actionType: 'Shift Deleted (Leave Approved)',
//                 staffId: shift.staffId,
//                 shiftDate: shift.startTime,
//               },
//               ...AuditLogger.extractRequestContext(event),
//             });
//           }
//         });

//         await Promise.all(deletePromises);
//         console.log('✅ All overlapping shifts DELETED from table and logged');
//       } catch (deleteError) {
//         console.error('⚠️ Error deleting shifts (leave still approved):', deleteError);
//         // Don't fail the approval if shift deletion fails
//       }
//     }

//     // --- Audit Log ---
//     if (userPerms) {
//       // Get clinicIds from stored leave request (created when leave was submitted)
//       // This ensures proper clinic filtering in audit logs
//       let clinicsToLog = leave.clinicIds || [];

//       // If clinicIds not stored, derive from affected shifts
//       if (clinicsToLog.length === 0 && overlappingShifts.length > 0) {
//         clinicsToLog = [...new Set(overlappingShifts.map(s => s.clinicId).filter(Boolean))];
//       }

//       // Fallback to approver's first clinic
//       if (clinicsToLog.length === 0) {
//         clinicsToLog = [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);
//       }

//       // Create audit log for each clinic to ensure visibility when filtering by clinic
//       for (const clinicIdForAudit of clinicsToLog) {
//         await auditLogger.log({
//           userId: userPerms.email,
//           userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//           userRole: AuditLogger.getUserRole(userPerms),
//           action: 'APPROVE',
//           resource: 'LEAVE',
//           resourceId: leaveId,
//           clinicId: clinicIdForAudit, // Use clinic(s) for proper filtering
//           before: { status: leave.status, staffId: leave.staffId },
//           after: { status: 'approved' },
//           reason: approvalNotes,
//           metadata: {
//             ...AuditLogger.createLeaveMetadata(leave, { cancelledShifts: overlappingShifts.length }),
//             actionBy: userPerms.email,
//             actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
//             actionType: 'Leave Approved',
//             requestedBy: leave.staffId, // Include the staff who requested leave
//             staffClinicIds: leave.clinicIds || clinicsToLog,
//             affectedClinics: [...new Set(overlappingShifts.map(s => s.clinicId).filter(Boolean))],
//             deletedShiftCount: overlappingShifts.length,
//           },
//           ...AuditLogger.extractRequestContext(event),
//         });
//       }

//       console.log(`✅ Audit log(s) created: APPROVE LEAVE ${leaveId} by ${userPerms.email} for clinics: ${clinicsToLog.join(', ')}`);
//     }

//     const response = {
//       leaveId,
//       status: 'approved',
//       cancelledShifts: overlappingShifts.length,
//       message: overlappingShifts.length > 0
//         ? `Leave approved. ${overlappingShifts.length} overlapping shift(s) have been automatically cancelled.`
//         : 'Leave approved successfully. No shifts were affected.'
//     };

//     console.log('✅ Returning response:', response);
//     return httpOk(response);

//   } catch (error: any) {
//     console.error('❌ Error in approveLeave:', error);
//     console.error('❌ Error message:', error?.message);
//     console.error('❌ Error stack:', error?.stack);
//     // Return a proper error response instead of throwing
//     return httpErr(500, `Failed to approve leave: ${error?.message || 'Unknown error'}`);
//   }
// }

// async function updateLeaveStatus(leaveId: string, status: 'approved' | 'denied', userPerms?: UserPermissions, event?: APIGatewayProxyEvent, reason?: string) {
//   // Get the leave request before updating for audit purposes
//   const { Item: leave } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
//   if (!leave) {
//     return httpErr(404, "Leave request not found");
//   }

//   const previousStatus = leave?.status;

//   await ddb.send(new UpdateCommand({
//     TableName: LEAVE_TABLE,
//     Key: { leaveId },
//     UpdateExpression: 'set #status = :status',
//     ExpressionAttributeNames: { '#status': 'status' },
//     ExpressionAttributeValues: { ':status': status }
//   }));

//   // --- Audit Log ---
//   if (userPerms) {
//     // Look up the staff's clinics from StaffClinicInfo table for proper clinic filtering
//     // Table has partition key 'email' and sort key 'clinicId', so we can query directly
//     let staffClinicIds: string[] = [];
//     try {
//       const { Items: staffInfoItems } = await ddb.send(new QueryCommand({
//         TableName: STAFF_INFO_TABLE,
//         KeyConditionExpression: 'email = :email',
//         ExpressionAttributeValues: { ':email': leave.staffId.toLowerCase() },
//       }));
//       staffClinicIds = (staffInfoItems || []).map((item: any) => item.clinicId).filter(Boolean);
//       console.log(`📋 Found ${staffClinicIds.length} clinic(s) for staff ${leave.staffId}:`, staffClinicIds);
//     } catch (lookupError) {
//       console.warn('Could not look up staff clinics for audit:', lookupError);
//     }

//     // Fallback to admin's clinic if we couldn't find staff's clinics
//     const clinicsToLog = staffClinicIds.length > 0 ? staffClinicIds : [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);

//     // Log to all relevant clinics for visibility
//     for (const clinicIdForAudit of clinicsToLog) {
//       await auditLogger.log({
//         userId: userPerms.email,
//         userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//         userRole: AuditLogger.getUserRole(userPerms),
//         action: status === 'approved' ? 'APPROVE' : 'DENY',
//         resource: 'LEAVE',
//         resourceId: leaveId,
//         clinicId: clinicIdForAudit, // Use staff's clinic(s) for proper filtering
//         before: { status: previousStatus, staffId: leave.staffId },
//         after: { status },
//         reason: reason,
//         metadata: {
//           ...AuditLogger.createLeaveMetadata(leave),
//           actionBy: userPerms.email,
//           actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
//           actionType: status === 'approved' ? 'Leave Approved' : 'Leave Denied',
//           requestedBy: leave.staffId,
//           denyReason: status === 'denied' ? reason : undefined,
//         },
//         ...AuditLogger.extractRequestContext(event),
//       });
//     }

//     console.log(`✅ Audit log created: ${status.toUpperCase()} LEAVE ${leaveId} by ${userPerms.email} for clinics: ${clinicsToLog.join(', ')}`);
//   }

//   return httpOk({ leaveId, status });
// }

// // ========================================
// // AUDIT TRAIL FUNCTIONS
// // ========================================

// /**
//  * Query audit logs with filters
//  * GET /hr/audit?userId=...&clinicId=...&startDate=...&endDate=...&limit=...
//  */
// async function queryAuditLogs(queryParams: any) {
//   const { userId, clinicId, startDate, endDate, limit: limitStr } = queryParams || {};
//   const limit = parseInt(limitStr) || 100;

//   // If userId is provided, query by user
//   if (userId) {
//     const result = await auditLogger.queryByUser(userId, { startDate, endDate, limit });
//     return httpOk({
//       auditLogs: result.auditLogs,
//       count: result.count,
//       lastEvaluatedKey: result.lastEvaluatedKey,
//     });
//   }

//   // If clinicId is provided, query by clinic
//   if (clinicId) {
//     const result = await auditLogger.queryByClinic(clinicId, { startDate, endDate, limit });
//     return httpOk({
//       auditLogs: result.auditLogs,
//       count: result.count,
//       lastEvaluatedKey: result.lastEvaluatedKey,
//     });
//   }

//   // Default: scan recent audit logs (not recommended for large datasets)
//   // For production, require at least one filter
//   return httpErr(400, "Please provide at least one filter: userId or clinicId");
// }

// /**
//  * Get audit trail for a specific resource
//  * GET /hr/audit/{resourceType}/{resourceId}
//  */
// async function getResourceAuditTrail(resourceType: AuditResource, resourceId: string, queryParams: any) {
//   const { limit: limitStr } = queryParams || {};
//   const limit = parseInt(limitStr) || 100;

//   // Validate resource type
//   const validResourceTypes = ['STAFF', 'SHIFT', 'LEAVE', 'CLINIC_ROLE'];
//   if (!validResourceTypes.includes(resourceType)) {
//     return httpErr(400, `Invalid resource type. Must be one of: ${validResourceTypes.join(', ')}`);
//   }

//   const result = await auditLogger.queryByResource(resourceType, resourceId, { limit });

//   return httpOk({
//     resource: resourceType.toLowerCase(),
//     resourceId,
//     auditTrail: result.auditLogs,
//     count: result.count,
//     lastEvaluatedKey: result.lastEvaluatedKey,
//   });
// }
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
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
import { AuditLogger, AuditResource } from '../shared/audit-logger';
import { makeOpenDentalRequest } from '../../shared/utils/opendental-api';

// Environment Variables
const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
const LEAVE_TABLE = process.env.LEAVE_TABLE!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE!; // DynamoDB table for user lookups (replaces Cognito)
const CLINICS_TABLE = process.env.CLINICS_TABLE || 'Clinics'; // For timezone lookup

// SES Environment Variables
const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

// Timezone cache to avoid repeated DynamoDB lookups
const timezoneCache: Map<string, { timezone: string; timestamp: number }> = new Map();
const TIMEZONE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({ region: SES_REGION });
const auditLogger = new AuditLogger(ddb);
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
// Leave dates are in YYYY-MM-DD format, shift times are in ISO format
async function getOverlappingShifts(staffId: string, startDate: string, endDate: string): Promise<any[]> {
  console.log(`🔍 getOverlappingShifts: Looking for shifts for staffId=${staffId} between ${startDate} and ${endDate}`);

  // Convert leave dates to ISO strings that cover the entire day range
  // startDate should start at 00:00:00 of that day
  // endDate should end at 23:59:59 of that day
  const leaveStartISO = new Date(startDate + 'T00:00:00Z').toISOString();
  const leaveEndISO = new Date(endDate + 'T23:59:59.999Z').toISOString();

  console.log(`🔍 Converted dates: leaveStart=${leaveStartISO}, leaveEnd=${leaveEndISO}`);

  // Query shifts for this staff member
  // We need to find shifts where the shift's time range overlaps with the leave date range
  // A shift overlaps if: shiftStart <= leaveEnd AND shiftEnd >= leaveStart
  const { Items } = await ddb.send(new QueryCommand({
    TableName: SHIFTS_TABLE,
    IndexName: 'byStaff',
    KeyConditionExpression: 'staffId = :staffId',
    FilterExpression: '#status = :scheduled AND startTime <= :leaveEnd AND endTime >= :leaveStart',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':staffId': staffId,
      ':scheduled': 'scheduled',
      ':leaveStart': leaveStartISO,
      ':leaveEnd': leaveEndISO
    }
  }));

  console.log(`🔍 Found ${Items?.length || 0} overlapping shifts:`, Items?.map((s: any) => ({
    shiftId: s.shiftId,
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status
  })));

  return Items || [];
}

// Get clinic timezone from Clinics table (with caching)
async function getClinicTimezone(clinicId: string): Promise<string> {
  const DEFAULT_TIMEZONE = 'America/New_York';

  // Check cache first
  const cached = timezoneCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < TIMEZONE_CACHE_TTL_MS) {
    return cached.timezone;
  }

  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: CLINICS_TABLE,
      Key: { clinicId },
    }));

    // Support both field names: timeZone and timezone
    const timezone = Item?.timeZone || Item?.timezone || DEFAULT_TIMEZONE;

    // Cache the result
    timezoneCache.set(clinicId, { timezone, timestamp: Date.now() });

    return timezone;
  } catch (error) {
    console.error(`Error fetching timezone for clinic ${clinicId}:`, error);
    return DEFAULT_TIMEZONE;
  }
}

// ========================================
// TIMEZONE NORMALIZATION HELPERS
// ========================================

function normalizeTimeZoneOrUtc(timeZone: string): string {
  try {
    // Throws RangeError for invalid IANA zones
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function hasExplicitTimeZone(dateTime: string): boolean {
  // Examples: 2026-01-20T14:00:00.000Z, 2026-01-20T14:00:00Z, 2026-01-20T14:00:00-05:00
  return /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(dateTime);
}

type NaiveDateTimeParts = {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;  // 0-23
  minute: number;// 0-59
  second: number;// 0-59
};

function parseNaiveDateTime(dateTime: string): NaiveDateTimeParts | null {
  const normalized = dateTime.trim().replace(' ', 'T');
  const m = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
}

function getTimeZoneOffsetMs(timeZone: string, utcInstant: Date): number {
  // This returns the offset (in ms) between the provided timeZone and UTC at the given instant.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(utcInstant);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - utcInstant.getTime();
}

function clinicLocalPartsToUtcDate(parts: NaiveDateTimeParts, timeZone: string): Date {
  // Create an initial UTC guess by treating the clinic-local wall time as if it were UTC.
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));

  // First-pass offset at the guess instant.
  const offset1 = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utcDate = new Date(utcGuess.getTime() - offset1);

  // DST transitions can change the offset; do a second pass to stabilize.
  const offset2 = getTimeZoneOffsetMs(timeZone, utcDate);
  if (offset2 !== offset1) {
    utcDate = new Date(utcGuess.getTime() - offset2);
  }

  return utcDate;
}

function normalizeToUtcIso(dateTime: string, clinicTimeZone: string): string {
  const tz = normalizeTimeZoneOrUtc(clinicTimeZone);
  const input = String(dateTime || '').trim();
  if (!input) throw new Error('Missing date/time');

  if (hasExplicitTimeZone(input)) {
    const d = new Date(input);
    if (isNaN(d.getTime())) throw new Error(`Invalid date/time: ${input}`);
    return d.toISOString();
  }

  const parts = parseNaiveDateTime(input);
  if (!parts) throw new Error(`Invalid date/time format (expected YYYY-MM-DDTHH:mm[:ss]): ${input}`);
  const utc = clinicLocalPartsToUtcDate(parts, tz);
  if (isNaN(utc.getTime())) throw new Error(`Invalid date/time after timezone conversion: ${input}`);
  return utc.toISOString();
}

// ========================================
// MAIN HANDLER
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('HR Lambda invoked:', JSON.stringify(event, null, 2));

  // Set up CORS
  currentCorsHeaders = buildCorsHeaders({}, event.headers?.origin);

  // Handle OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: currentCorsHeaders, body: '' };
  }

  try {
    // Get user permissions from custom authorizer context
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      console.log('❌ No user permissions found in authorizer context');
      return httpErr(401, "Unauthorized: Invalid token");
    }

    console.log('✅ User permissions retrieved:', {
      email: userPerms.email,
      clinicRoles: userPerms.clinicRoles?.length || 0,
    });

    // Extract HTTP method and path
    const method = event.httpMethod;
    const path = event.path.replace(/^\/hr/, ''); // Remove /hr prefix if present

    // Check module permission for HR
    const isAdmin = isAdminUser(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    const allowedClinics = getAllowedClinicIds(userPerms.clinicRoles, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin);
    const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
    const hasPermission = hasModulePermission(
      userPerms.clinicRoles,
      MODULE_NAME,
      requiredPermission,
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin
    );
    
    // Admins bypass this check
    if (!isAdmin && !hasPermission) {
      console.log(`❌ User ${userPerms.email} lacks ${requiredPermission} permission for ${MODULE_NAME}`);
      return httpErr(403, `Forbidden: You need ${requiredPermission} permission for the ${MODULE_NAME} module`);
    }

    // --- DASHBOARD ---
    if (method === 'GET' && path === '/dashboard') {
      return getDashboard(userPerms, isAdmin, allowedClinics);
    }

    // --- CLINICS ---
    if (method === 'GET' && path === '/clinics') {
      return getClinics(allowedClinics);
    }

    // --- SHIFTS ---
    if (method === 'GET' && path === '/shifts') {
      return getShifts(userPerms, isAdmin, event.queryStringParameters, allowedClinics);
    }
    if (method === 'POST' && path === '/shifts') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      if (!event.body) return httpErr(400, "Missing request body");
      const parsedBody = JSON.parse(event.body);
      return createShift(parsedBody, allowedClinics, userPerms, event); // <-- Will now send email + audit log
    }
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      if (!event.body) return httpErr(400, "Missing request body");
      const parsedBody = JSON.parse(event.body);
      return updateShift(shiftId, parsedBody, allowedClinics, userPerms, event);
    }
    if (method === 'DELETE' && path.match(/^\/shifts\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const shiftId = path.split('/')[2];
      return deleteShift(shiftId, allowedClinics, userPerms, event);
    }
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/reject$/)) {
      const shiftId = path.split('/')[2];
      const reason = event.body ? JSON.parse(event.body)?.reason : undefined;
      return rejectShift(shiftId, userPerms.email, userPerms, event, reason);
    }
    if (method === 'PUT' && path.match(/^\/shifts\/[^\/]+\/complete$/)) {
      const shiftId = path.split('/')[2];
      return completeShift(shiftId, allowedClinics, userPerms, event);
    }

    // --- SHIFT STATUS SYNC (from clock events) ---
    if (method === 'POST' && path === '/shifts/sync') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const parsedBody = event.body ? JSON.parse(event.body) : {};
      return syncShiftStatusFromClockEvents(parsedBody, allowedClinics, userPerms, event);
    }

    // --- LEAVE ---
    if (method === 'GET' && path === '/leave') {
      return getLeave(userPerms, isAdmin);
    }
    if (method === 'POST' && path === '/leave') {
      if (!event.body) return httpErr(400, "Missing request body");
      const parsedBody = JSON.parse(event.body);
      return createLeave(userPerms.email, parsedBody, userPerms, event);
    }
    if (method === 'DELETE' && path.match(/^\/leave\/[^\/]+$/)) {
      const leaveId = path.split('/')[2];
      return deleteLeave(leaveId, userPerms, isAdmin, event);
    }
    if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/approve$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const leaveId = path.split('/')[2];
      const approvalNotes = event.body ? JSON.parse(event.body)?.notes : undefined;
      return approveLeave(leaveId, userPerms, event, approvalNotes);
    }
    if (method === 'PUT' && path.match(/^\/leave\/[^\/]+\/deny$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const leaveId = path.split('/')[2];
      const denyReason = event.body ? JSON.parse(event.body)?.reason : undefined;
      return denyLeave(leaveId, userPerms, event, denyReason);
    }

    // --- AUDIT TRAIL ROUTES (Admin only) ---
    if (method === 'GET' && path === '/audit') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      return queryAuditLogs(event.queryStringParameters);
    }
    if (method === 'GET' && path.match(/^\/audit\/[^\/]+\/[^\/]+$/)) {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const parts = path.split('/');
      const resourceType = parts[2].toUpperCase() as AuditResource;
      const resourceId = parts[3];
      return getResourceAuditTrail(resourceType, resourceId, event.queryStringParameters);
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

/**
 * FIXED: Dashboard stats with onPremise/remote staff counts
 * Now fetches all staff data in a single scan to avoid lazy loading
 */
async function getDashboard(userPerms: any, isAdmin: boolean, allowedClinics: Set<string>) {
  if (isAdmin) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(today.setDate(diff)).toISOString();
    const weekEnd = new Date(today.setDate(diff + 6)).toISOString();

    // FIXED: Count active staff and work locations from StaffClinicInfo table in a single scan
    // This avoids lazy loading and gets all data at once
    const staffDataPromise = (async () => {
      try {
        const adminClinics = Array.from(allowedClinics);
        
        // Scan the entire StaffClinicInfo table to get all staff work locations
        const scanResponse = await ddb.send(new ScanCommand({
          TableName: STAFF_INFO_TABLE,
        }));

        const allStaffInfo = scanResponse.Items || [];
        
        // Filter staff by admin's clinics and count unique staff
        const staffInAdminClinics = allStaffInfo.filter(info => 
          adminClinics.includes(info.clinicId)
        );

        // Get unique staff emails
        const uniqueStaffEmails = new Set(staffInAdminClinics.map(info => info.email));
        const totalStaff = uniqueStaffEmails.size;

        // Count remote vs onPremise staff
        // A staff member is counted as remote if ANY of their clinic assignments has isRemote=true
        // A staff member is counted as onPremise if ANY of their clinic assignments has isOnPremise=true
        let remoteStaffSet = new Set<string>();
        let onPremiseStaffSet = new Set<string>();

        staffInAdminClinics.forEach(info => {
          const email = info.email;
          const workLocation = info.workLocation;
          
          if (workLocation?.isRemote === true) {
            remoteStaffSet.add(email);
          }
          if (workLocation?.isOnPremise === true) {
            onPremiseStaffSet.add(email);
          }
        });

        return {
          totalStaff,
          remoteStaff: remoteStaffSet.size,
          onPremiseStaff: onPremiseStaffSet.size,
        };
      } catch (error) {
        console.error('Error fetching staff data:', error);
        return {
          totalStaff: 0,
          remoteStaff: 0,
          onPremiseStaff: 0,
        };
      }
    })();

    const adminClinics = Array.from(allowedClinics);
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

    const [staffData, ...shiftResponses] = await Promise.all([
      staffDataPromise,
      ...shiftQueryPromises
    ]);

    const allShifts = shiftResponses.flatMap(res => res.Items || []);

    let estimatedHours = 0;
    let estimatedCost = 0;
    allShifts.forEach(shift => {
      estimatedHours += shift.totalHours || 0;
      estimatedCost += shift.pay || 0;
    });

    return httpOk({
      totalOffices: adminClinics.length,
      totalStaff: staffData.totalStaff,
      thisWeeksShifts: allShifts.length,
      budgetStatus: "On Track",
      onPremiseStaff: staffData.onPremiseStaff,
      remoteStaff: staffData.remoteStaff,
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

async function getClinics(allowedClinics: Set<string>) {
  const clinicIds = Array.from(allowedClinics);
  const promises = clinicIds.map(id => ddb.send(new GetCommand({ TableName: CLINICS_TABLE, Key: { clinicId: id } })));
  const results = await Promise.all(promises);
  const clinics = results.map(r => r.Item).filter(Boolean);
  return httpOk({ clinics });
}

async function getShifts(userPerms: UserPermissions, isAdmin: boolean, queryParams: any, allowedClinics: Set<string>) {
  const { clinicId, startDate, endDate, status } = queryParams || {};

  // Admin querying shifts for a specific clinic (requires all params)
  if (isAdmin && clinicId) {
    if (!startDate || !endDate) {
      return httpErr(400, "startDate and endDate are required when querying by clinicId");
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

    const tz = await getClinicTimezone(clinicId);
    const shifts = Items || [];
    const normalized = shifts.map((s: any) => ({
      ...s,
      startTime: normalizeToUtcIso(s.startTime, tz),
      endTime: normalizeToUtcIso(s.endTime, tz),
    }));
    return httpOk({ shifts: normalized });
  }

  // Query own shifts (for both staff and admins when no clinicId specified)
  let KeyConditionExpression = 'staffId = :staffId';
  const ExpressionAttributeValues: Record<string, any> = { ':staffId': userPerms.email };

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

  const shifts = Items || [];
  const normalized = await Promise.all(
    shifts.map(async (s: any) => {
      const tz = await getClinicTimezone(s.clinicId);
      return {
        ...s,
        startTime: normalizeToUtcIso(s.startTime, tz),
        endTime: normalizeToUtcIso(s.endTime, tz),
      };
    })
  );
  return httpOk({ shifts: normalized });
}

async function createShift(body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { staffId, clinicId, startTime: rawStartTime, endTime: rawEndTime, ...restBody } = body;
  if (!staffId || !clinicId || !rawStartTime || !rawEndTime) {
    return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
  }
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  // Always interpret any timezone-less timestamps as clinic-local time, then normalize to UTC ISO.
  const clinicTimezone = await getClinicTimezone(clinicId);
  const startTime = normalizeToUtcIso(rawStartTime, clinicTimezone);
  const endTime = normalizeToUtcIso(rawEndTime, clinicTimezone);

  const shiftDate = new Date(startTime);
  const isBlocked = await isDateBlocked(staffId, shiftDate);
  if (isBlocked) {
    return httpErr(400, "Cannot schedule shift: Staff has approved leave on this date");
  }

  // Look up user from DynamoDB StaffUser table (staffId is the email)
  let email: string;
  let staffName: string | undefined;
  try {
    const { Item: staffUser } = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: staffId.toLowerCase() },
    }));

    if (!staffUser) {
      console.error("Staff user not found in StaffUser table:", staffId);
      return httpErr(404, "Staff user not found");
    }

    email = staffUser.email?.toLowerCase();
    const givenName = staffUser.givenName;
    const familyName = staffUser.familyName;
    staffName = `${givenName || ''} ${familyName || ''}`.trim();
  } catch (err) {
    console.error("StaffUser table lookup failed:", err);
    return httpErr(500, "Error looking up staff user");
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
    ...restBody
  };

  await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));

  // --- Audit Log ---
  if (userPerms) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'CREATE',
      resource: 'SHIFT',
      resourceId: shiftId,
      clinicId: clinicId,
      after: AuditLogger.sanitizeForAudit(shift),
      metadata: AuditLogger.createShiftMetadata(shift),
      ...AuditLogger.extractRequestContext(event),
    });
  }

  // --- Send Email Notification ---
  await sendShiftNotificationEmail(email, shift, staffName || staffId, clinicTimezone);

  return httpOk({ shiftId, message: "Shift created successfully" });
}

async function updateShift(shiftId: string, body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
  if (!oldShift) return httpErr(404, "Shift not found");

  const staffId = body.staffId || oldShift.staffId;
  const clinicId = body.clinicId || oldShift.clinicId;
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  const clinicTimezone = await getClinicTimezone(clinicId);
  const startTime = normalizeToUtcIso(body.startTime || oldShift.startTime, clinicTimezone);

  const shiftDate = new Date(startTime);
  const isBlocked = await isDateBlocked(staffId, shiftDate);
  if (isBlocked) {
    return httpErr(400, "Cannot update shift: Staff has approved leave on this date");
  }

  // Look up user from DynamoDB StaffUser table (staffId is the email)
  let email: string | undefined;
  try {
    const { Item: staffUser } = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: staffId.toLowerCase() },
    }));

    if (!staffUser) {
      console.error("Staff user not found in StaffUser table:", staffId);
      return httpErr(404, "Staff user not found");
    }

    email = staffUser.email?.toLowerCase();
  } catch (err) {
    console.error("StaffUser table lookup failed:", err);
    return httpErr(500, "Error looking up staff user");
  }

  if (!email) {
    return httpErr(404, "Staff email not found, cannot determine pay");
  }

  const { Item: staffInfo } = await ddb.send(new GetCommand({
    TableName: STAFF_INFO_TABLE,
    Key: { email: email, clinicId: clinicId }
  }));

  const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
  const endTime = normalizeToUtcIso(body.endTime || oldShift.endTime, clinicTimezone);
  const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);

  if (totalHours <= 0) {
    return httpErr(400, "End time must be after start time");
  }

  const pay = totalHours * hourlyRate;

  const { startTime: _bodyStartTime, endTime: _bodyEndTime, ...restBody } = body || {};
  const updatedShift = {
    ...oldShift,
    ...restBody,
    shiftId,
    staffId,
    email: email,
    clinicId,
    startTime,
    endTime,
    totalHours: parseFloat(totalHours.toFixed(2)),
    hourlyRate: hourlyRate,
    pay: parseFloat(pay.toFixed(2))
  };

  await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: updatedShift }));

  // --- Audit Log ---
  if (userPerms) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'UPDATE',
      resource: 'SHIFT',
      resourceId: shiftId,
      clinicId: clinicId,
      before: AuditLogger.sanitizeForAudit(oldShift),
      after: AuditLogger.sanitizeForAudit(updatedShift),
      metadata: AuditLogger.createShiftMetadata(updatedShift),
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ shiftId, message: "Shift updated successfully" });
}

async function deleteShift(shiftId: string, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { Item: shift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
  if (!shift) return httpErr(404, "Shift not found");
  if (!hasClinicAccess(allowedClinics, shift.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  await ddb.send(new DeleteCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));

  // --- Audit Log ---
  if (userPerms) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'DELETE',
      resource: 'SHIFT',
      resourceId: shiftId,
      clinicId: shift.clinicId,
      before: shift,
      metadata: AuditLogger.createShiftMetadata(shift),
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ shiftId });
}

async function rejectShift(shiftId: string, staffId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, reason?: string) {
  const { Item: shift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
  if (!shift) return httpErr(404, "Shift not found");
  if (shift.staffId !== staffId) {
    return httpErr(403, "Forbidden: you can only reject your own shifts");
  }
  if (shift.status !== 'scheduled') {
    return httpErr(400, "Only scheduled shifts can be rejected");
  }

  await ddb.send(new UpdateCommand({
    TableName: SHIFTS_TABLE,
    Key: { shiftId },
    UpdateExpression: 'set #status = :rejected, cancelReason = :reason, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':rejected': 'rejected',
      ':reason': reason || 'Rejected by staff',
      ':updatedAt': new Date().toISOString(),
    }
  }));

  // --- Audit Log ---
  if (userPerms) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'REJECT',
      resource: 'SHIFT',
      resourceId: shiftId,
      clinicId: shift.clinicId,
      before: { status: shift.status },
      after: { status: 'rejected', cancelReason: reason || 'Rejected by staff' },
      reason: reason,
      metadata: AuditLogger.createShiftMetadata(shift),
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ shiftId, status: 'rejected' });
}

async function completeShift(shiftId: string, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { Item: shift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
  if (!shift) return httpErr(404, "Shift not found");
  if (!hasClinicAccess(allowedClinics, shift.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  await ddb.send(new UpdateCommand({
    TableName: SHIFTS_TABLE,
    Key: { shiftId },
    UpdateExpression: 'set #status = :completed, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':completed': 'completed',
      ':updatedAt': new Date().toISOString(),
    }
  }));

  // --- Audit Log ---
  if (userPerms) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'UPDATE',
      resource: 'SHIFT',
      resourceId: shiftId,
      clinicId: shift.clinicId,
      before: { status: shift.status },
      after: { status: 'completed' },
      metadata: { ...AuditLogger.createShiftMetadata(shift), actionType: 'Shift Completed' },
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ shiftId, status: 'completed' });
}

// ========================================
// SHIFT STATUS SYNC FROM CLOCK EVENTS
// ========================================

/**
 * Clock event interface from Open Dental API
 */
interface OpenDentalClockEvent {
  ClockEventNum: number;
  EmployeeNum: number;
  TimeDisplayed1: string; // Clock-in time (can be null/0001-01-01)
  TimeDisplayed2: string; // Clock-out time (can be null/0001-01-01)
  ClockStatus: number; // 0=Home, 1=Lunch, 2=Break
  Note?: string;
  ClinicNum?: number;
}

/**
 * Employee interface from Open Dental API
 */
interface OpenDentalEmployee {
  EmployeeNum: number;
  FName: string;
  LName: string;
  IsHidden: boolean;
  ClinicNum?: number;
  EmailWork?: string;
  EmailPersonal?: string;
}

/**
 * Sync shift statuses from Open Dental clock events
 * This function:
 * 1. Fetches scheduled shifts for the given date range
 * 2. For each clinic, fetches clock events and employees from Open Dental
 * 3. Matches shifts to clock events based on employee name and time overlap
 * 4. Updates shift status to 'completed' if a matching clock event is found
 * 
 * POST /hr/shifts/sync
 * Body: { startDate?: string, endDate?: string } - defaults to past 7 days
 */
async function syncShiftStatusFromClockEvents(
  body: any,
  allowedClinics: Set<string>,
  userPerms: UserPermissions,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('🔄 Starting shift status sync from clock events');

  // Parse date range from body or default to past 7 days
  const now = new Date();
  const defaultStartDate = new Date(now);
  defaultStartDate.setDate(defaultStartDate.getDate() - 7);

  const startDate = body?.startDate || defaultStartDate.toISOString().split('T')[0];
  const endDate = body?.endDate || now.toISOString().split('T')[0];

  console.log(`📅 Syncing shifts from ${startDate} to ${endDate}`);

  // Get list of clinics to sync
  const clinicsToSync = body?.clinicId
    ? [body.clinicId]
    : Array.from(allowedClinics);

  if (clinicsToSync.length === 0) {
    return httpErr(400, 'No clinics available to sync');
  }

  const syncResults: {
    clinicId: string;
    shiftsChecked: number;
    shiftsCompleted: number;
    errors: string[];
  }[] = [];

  for (const clinicId of clinicsToSync) {
    // Check access
    if (!hasClinicAccess(allowedClinics, clinicId)) {
      console.warn(`⚠️ Skipping clinic ${clinicId} - no access`);
      continue;
    }

    const clinicResult = {
      clinicId,
      shiftsChecked: 0,
      shiftsCompleted: 0,
      errors: [] as string[],
    };

    try {
      // Fetch scheduled shifts for this clinic in the date range
      const { Items: shifts } = await ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byClinicAndDate',
        KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :startDate AND :endDate',
        FilterExpression: '#status = :scheduled',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
          ':startDate': startDate + 'T00:00:00.000Z',
          ':endDate': endDate + 'T23:59:59.999Z',
          ':scheduled': 'scheduled',
        },
      }));

      const scheduledShifts = shifts || [];
      clinicResult.shiftsChecked = scheduledShifts.length;

      if (scheduledShifts.length === 0) {
        console.log(`📋 No scheduled shifts found for clinic ${clinicId}`);
        syncResults.push(clinicResult);
        continue;
      }

      console.log(`📋 Found ${scheduledShifts.length} scheduled shifts for clinic ${clinicId}`);

      // Fetch employees from Open Dental
      let employees: OpenDentalEmployee[] = [];
      try {
        const employeesResponse = await makeOpenDentalRequest(
          'GET',
          `/api/v1/employees`,
          clinicId
        );
        employees = Array.isArray(employeesResponse) ? employeesResponse : [];
        console.log(`👥 Fetched ${employees.length} employees from Open Dental for clinic ${clinicId}`);
      } catch (err: any) {
        console.error(`❌ Failed to fetch employees from Open Dental:`, err);
        clinicResult.errors.push(`Failed to fetch employees: ${err.message}`);
        syncResults.push(clinicResult);
        continue;
      }

      // Fetch clock events from Open Dental for the date range
      let clockEvents: OpenDentalClockEvent[] = [];
      try {
        const clockEventsResponse = await makeOpenDentalRequest(
          'GET',
          `/api/v1/clockevents?DateStart=${startDate}&DateEnd=${endDate}`,
          clinicId
        );
        clockEvents = Array.isArray(clockEventsResponse) ? clockEventsResponse : [];
        console.log(`⏰ Fetched ${clockEvents.length} clock events from Open Dental for clinic ${clinicId}`);
      } catch (err: any) {
        console.error(`❌ Failed to fetch clock events from Open Dental:`, err);
        clinicResult.errors.push(`Failed to fetch clock events: ${err.message}`);
        syncResults.push(clinicResult);
        continue;
      }

      // Filter clock events: only complete events (has both clock in and out, status 0=Home or 1=Lunch)
      const completedClockEvents = clockEvents.filter(ce => {
        const hasClockIn = ce.TimeDisplayed1 && !ce.TimeDisplayed1.startsWith('0001-01-01');
        const hasClockOut = ce.TimeDisplayed2 && !ce.TimeDisplayed2.startsWith('0001-01-01');
        const isWorkEvent = ce.ClockStatus === 0 || ce.ClockStatus === 1; // Home or Lunch (not Break)
        return hasClockIn && hasClockOut && isWorkEvent;
      });

      console.log(`✅ ${completedClockEvents.length} completed clock events (with clock-out)`);

      // Create employee lookup map: EmployeeNum -> Employee
      const employeeMap = new Map<number, OpenDentalEmployee>();
      for (const emp of employees) {
        employeeMap.set(emp.EmployeeNum, emp);
      }

      // Process each scheduled shift
      for (const shift of scheduledShifts) {
        try {
          // Find matching clock event
          const matchingClockEvent = findMatchingClockEvent(
            shift,
            completedClockEvents,
            employeeMap
          );

          if (matchingClockEvent) {
            // Update shift status to completed
            await ddb.send(new UpdateCommand({
              TableName: SHIFTS_TABLE,
              Key: { shiftId: shift.shiftId },
              UpdateExpression: 'SET #status = :status, completedAt = :completedAt, clockEventId = :clockEventId',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':status': 'completed',
                ':completedAt': new Date().toISOString(),
                ':clockEventId': matchingClockEvent.ClockEventNum,
              },
            }));

            clinicResult.shiftsCompleted++;
            console.log(`✅ Updated shift ${shift.shiftId} to completed (clockEventId: ${matchingClockEvent.ClockEventNum})`);

            // Create audit log
            await auditLogger.log({
              userId: userPerms.email,
              userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
              userRole: AuditLogger.getUserRole(userPerms),
              action: 'SYNC_COMPLETE',
              resource: 'SHIFT',
              resourceId: shift.shiftId,
              clinicId: clinicId,
              before: { status: 'scheduled' },
              after: { status: 'completed', clockEventId: matchingClockEvent.ClockEventNum },
              metadata: {
                actionType: 'Shift Status Synced',
                syncSource: 'OpenDental ClockEvents',
                clockEventNum: matchingClockEvent.ClockEventNum,
                clockIn: matchingClockEvent.TimeDisplayed1,
                clockOut: matchingClockEvent.TimeDisplayed2,
              },
              ...AuditLogger.extractRequestContext(event),
            });
          }
        } catch (err: any) {
          console.error(`❌ Error processing shift ${shift.shiftId}:`, err);
          clinicResult.errors.push(`Failed to process shift ${shift.shiftId}: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`❌ Error syncing clinic ${clinicId}:`, err);
      clinicResult.errors.push(`Clinic sync error: ${err.message}`);
    }

    syncResults.push(clinicResult);
  }

  // Calculate totals
  const totalShiftsChecked = syncResults.reduce((sum, r) => sum + r.shiftsChecked, 0);
  const totalShiftsCompleted = syncResults.reduce((sum, r) => sum + r.shiftsCompleted, 0);
  const totalErrors = syncResults.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(`🏁 Sync complete: ${totalShiftsCompleted}/${totalShiftsChecked} shifts marked as completed`);

  return httpOk({
    message: 'Shift status sync completed',
    dateRange: { startDate, endDate },
    summary: {
      totalShiftsChecked,
      totalShiftsCompleted,
      totalErrors,
    },
    details: syncResults,
  });
}

/**
 * Find a matching clock event for a shift
 * Matches based on:
 * 1. Employee email matching shift's staff email
 * 2. Clock event date matching shift date
 * 3. Clock event time window overlapping with shift time window (at least 50% coverage)
 */
function findMatchingClockEvent(
  shift: any,
  clockEvents: OpenDentalClockEvent[],
  employeeMap: Map<number, OpenDentalEmployee>
): OpenDentalClockEvent | null {
  const shiftStart = new Date(shift.startTime);
  const shiftEnd = new Date(shift.endTime);
  const shiftDate = shiftStart.toISOString().split('T')[0];

  // Get staff email from shift (primary identifier)
  const staffEmail = (shift.staffId || shift.email || '').toLowerCase().trim();

  if (!staffEmail) {
    console.warn(`⚠️ Shift ${shift.shiftId} has no staffId or email, cannot match`);
    return null;
  }

  for (const clockEvent of clockEvents) {
    const employee = employeeMap.get(clockEvent.EmployeeNum);
    if (!employee) continue;

    // First, try to match by email (most reliable)
    const empEmailWork = (employee.EmailWork || '').toLowerCase().trim();
    const empEmailPersonal = (employee.EmailPersonal || '').toLowerCase().trim();

    const emailMatches = staffEmail === empEmailWork || staffEmail === empEmailPersonal;

    if (!emailMatches) {
      // If no email match, try name matching as fallback
      const empFirstName = (employee.FName || '').toLowerCase().trim();
      const empLastName = (employee.LName || '').toLowerCase().trim();

      // Extract name components from email (e.g., "john.doe@example.com" -> "john" "doe")
      const emailPrefix = staffEmail.split('@')[0].replace(/[._-]/g, ' ');
      const nameMatch = (emailPrefix.includes(empFirstName) && empFirstName.length > 2) ||
                       (emailPrefix.includes(empLastName) && empLastName.length > 2);

      if (!nameMatch) continue;
    }

    // Check if clock event is on the same date as the shift
    const clockInTime = new Date(clockEvent.TimeDisplayed1);
    const clockOutTime = new Date(clockEvent.TimeDisplayed2);
    const clockDate = clockInTime.toISOString().split('T')[0];

    if (clockDate !== shiftDate) continue;

    // Check time overlap
    // Clock out should be after shift start (staff worked during shift time)
    if (clockOutTime <= shiftStart) continue;

    // Clock in should be before shift end (staff started before shift ended)
    if (clockInTime >= shiftEnd) continue;

    // Calculate overlap duration
    const overlapStart = Math.max(clockInTime.getTime(), shiftStart.getTime());
    const overlapEnd = Math.min(clockOutTime.getTime(), shiftEnd.getTime());
    const overlapDurationMs = overlapEnd - overlapStart;

    const shiftDurationMs = shiftEnd.getTime() - shiftStart.getTime();

    // Require at least 50% overlap
    const overlapPercentage = (overlapDurationMs / shiftDurationMs) * 100;
    if (overlapPercentage < 50) continue;

    console.log(`✅ Matched shift ${shift.shiftId} to employee ${employee.FName} ${employee.LName} (${overlapPercentage.toFixed(1)}% overlap)`);
    return clockEvent;
  }

  return null;
}

// --- LEAVE ---

async function getLeave(userPerms: UserPermissions, isAdmin: boolean) {
  if (isAdmin) {
    const adminClinics = userPerms.clinicRoles?.map((cr: any) => cr.clinicId) || [];

    if (adminClinics.length === 0) {
      const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
      return httpOk({ leaveRequests: Items || [] });
    }

    const allLeaves: any[] = [];
    const queryPromises = adminClinics.map((clinicId: string) =>
      ddb.send(new QueryCommand({
        TableName: LEAVE_TABLE,
        IndexName: 'byClinicAndStatus',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': clinicId },
      }))
    );

    try {
      const results = await Promise.all(queryPromises);
      results.forEach(result => {
        if (result.Items) allLeaves.push(...result.Items);
      });
    } catch (err) {
      console.warn('⚠️ Error querying leaves by clinic, falling back to scan:', err);
      const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
      return httpOk({
        leaveRequests: (Items || []).filter((item: any) =>
          adminClinics.includes(item.clinicId) ||
          (item.clinicIds && item.clinicIds.some((cid: string) => adminClinics.includes(cid)))
        )
      });
    }

    return httpOk({ leaveRequests: allLeaves });
  } else {
    const { Items } = await ddb.send(new QueryCommand({
      TableName: LEAVE_TABLE,
      IndexName: 'byStaff',
      KeyConditionExpression: 'staffId = :staffId',
      ExpressionAttributeValues: { ':staffId': userPerms.email }
    }));
    return httpOk({ leaveRequests: Items || [] });
  }
}

async function createLeave(staffId: string, body: any, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { startDate, endDate, reason } = body;
  if (!startDate || !endDate) {
    return httpErr(400, "startDate and endDate are required");
  }

  let staffClinicIds: string[] = [];
  try {
    const { Items: staffInfoItems } = await ddb.send(new QueryCommand({
      TableName: STAFF_INFO_TABLE,
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': staffId.toLowerCase() },
    }));
    staffClinicIds = (staffInfoItems || []).map((item: any) => item.clinicId).filter(Boolean);
    console.log(`📋 Staff ${staffId} works at ${staffClinicIds.length} clinic(s):`, staffClinicIds);
  } catch (lookupError) {
    console.warn('⚠️ Could not look up staff clinics:', lookupError);
    const adminClinicId = userPerms?.clinicRoles?.[0]?.clinicId;
    staffClinicIds = adminClinicId ? [adminClinicId] : [];
  }

  const leaveId = uuidv4();
  const createdAt = new Date().toISOString();
  const leaveRequest = {
    leaveId,
    staffId,
    startDate,
    endDate,
    reason,
    status: 'pending',
    clinicIds: staffClinicIds,
    createdAt: createdAt,
  };

  await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));

  // Store clinic-specific entries for GSI
  const clinicLeavePromises = staffClinicIds.map((clinicId: string) =>
    ddb.send(new PutCommand({
      TableName: LEAVE_TABLE,
      Item: {
        leaveId: `${leaveId}#${clinicId}`,
        clinicId,
        startDate,
        staffId,
        endDate,
        reason,
        status: 'pending',
        clinicIds: staffClinicIds,
        isClinicIndexEntry: true,
        primaryLeaveId: leaveId,
      },
    }))
  );

  if (clinicLeavePromises.length > 0) {
    try {
      await Promise.all(clinicLeavePromises);
      console.log(`✅ Created ${clinicLeavePromises.length} clinic index entries`);
    } catch (err) {
      console.warn('⚠️ Failed to create clinic index entries (primary record saved):', err);
    }
  }

  // Audit Logs
  if (userPerms && staffClinicIds.length > 0) {
    const auditPromises = staffClinicIds.map((clinicId: string) =>
      auditLogger.log({
        userId: userPerms.email,
        userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
        userRole: AuditLogger.getUserRole(userPerms),
        action: 'CREATE',
        resource: 'LEAVE',
        resourceId: leaveId,
        clinicId: clinicId,
        after: AuditLogger.sanitizeForAudit(leaveRequest),
        metadata: {
          ...AuditLogger.createLeaveMetadata(leaveRequest),
          actionType: 'Leave Request Created',
          staffClinicIds: staffClinicIds,
          createdBy: userPerms.email,
        },
        ...AuditLogger.extractRequestContext(event),
      })
    );
    await Promise.all(auditPromises);
    console.log(`✅ Audit logs created for leave ${leaveId} across ${staffClinicIds.length} clinic(s)`);
  }

  return httpOk({ leaveId, message: "Leave request submitted" });
}

async function deleteLeave(leaveId: string, userPerms: UserPermissions, isAdmin: boolean, event?: APIGatewayProxyEvent) {
  const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
  if (!Item) return httpErr(404, "Leave request not found");

  if (!isAdmin && Item.staffId !== userPerms.email) {
    return httpErr(403, "Forbidden");
  }

  await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));

  let clinicsToLog = Item.clinicIds || [];
  if (clinicsToLog.length === 0) {
    try {
      const { Items: staffInfoItems } = await ddb.send(new QueryCommand({
        TableName: STAFF_INFO_TABLE,
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': Item.staffId.toLowerCase() },
      }));
      clinicsToLog = (staffInfoItems || []).map((item: any) => item.clinicId).filter(Boolean);
    } catch (err) {
      console.warn('Could not look up staff clinics for audit:', err);
      clinicsToLog = [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);
    }
  }

  const auditPromises = clinicsToLog.map((clinicId: string) =>
    auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'DELETE',
      resource: 'LEAVE',
      resourceId: leaveId,
      clinicId: clinicId,
      before: AuditLogger.sanitizeForAudit(Item),
      metadata: {
        ...AuditLogger.createLeaveMetadata(Item),
        actionType: 'Leave Request Deleted',
        staffClinicIds: clinicsToLog,
        deletedBy: userPerms.email,
      },
      ...AuditLogger.extractRequestContext(event),
    })
  );

  if (auditPromises.length > 0) {
    await Promise.all(auditPromises);
    console.log(`✅ Audit logs created for leave deletion across ${clinicsToLog.length} clinic(s)`);
  }

  return httpOk({ message: "Leave request deleted" });
}

async function approveLeave(leaveId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, approvalNotes?: string) {
  console.log('🔄 Starting approveLeave for leaveId:', leaveId);

  try {
    if (!leaveId || leaveId === 'undefined') {
      console.error('❌ Invalid leaveId:', leaveId);
      return httpErr(400, "Invalid leave ID");
    }

    console.log('🔄 Getting leave request from DynamoDB...');
    const { Item: leave } = await ddb.send(new GetCommand({
      TableName: LEAVE_TABLE,
      Key: { leaveId }
    }));

    if (!leave) {
      console.error('❌ Leave request not found:', leaveId);
      return httpErr(404, "Leave request not found");
    }

    console.log('✅ Found leave request:', JSON.stringify(leave, null, 2));

    if (!leave.staffId) {
      console.error('❌ Leave request missing staffId:', leave);
      return httpErr(400, "Leave request is missing staffId");
    }

    console.log('🔄 Updating leave status to approved...');
    await ddb.send(new UpdateCommand({
      TableName: LEAVE_TABLE,
      Key: { leaveId },
      UpdateExpression: 'set #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'approved' }
    }));

    console.log('✅ Leave status updated to approved');

    // Update leave status to approved
    await ddb.send(new UpdateCommand({
      TableName: LEAVE_TABLE,
      Key: { leaveId },
      UpdateExpression: 'set #status = :approved, approvedAt = :approvedAt, approvedBy = :approvedBy, approvalNotes = :notes',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':approved': 'approved',
        ':approvedAt': new Date().toISOString(),
        ':approvedBy': userPerms?.email || 'system',
        ':notes': approvalNotes || '',
      }
    }));

    console.log(`✅ Leave status updated to approved`);

    // Find and cancel overlapping shifts
    const overlappingShifts = await getOverlappingShifts(leave.staffId, leave.startDate, leave.endDate);
    console.log(`✅ Found ${overlappingShifts.length} overlapping shifts to cancel`);

    // Delete overlapping shifts and create audit logs for each
    if (overlappingShifts.length > 0) {
      try {
        for (const shift of overlappingShifts) {
          console.log(`🗑️ Deleting shift ${shift.shiftId}`);
          
          // Delete the shift
          await ddb.send(new DeleteCommand({
            TableName: SHIFTS_TABLE,
            Key: { shiftId: shift.shiftId }
          }));

          // Create audit log for the deleted shift
          if (userPerms) {
            await auditLogger.log({
              userId: userPerms.email,
              userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
              userRole: AuditLogger.getUserRole(userPerms),
              action: 'DELETE',
              resource: 'SHIFT',
              resourceId: shift.shiftId,
              clinicId: shift.clinicId,
              before: shift,
              metadata: {
                ...AuditLogger.createShiftMetadata(shift),
                actionType: 'Shift Cancelled Due to Approved Leave',
                leaveId: leaveId,
                staffId: shift.staffId,
                cancelledBy: userPerms.email,
                cancelReason: `Shift cancelled automatically due to approved leave (${leave.startDate} to ${leave.endDate})`,
              },
              reason: `Automatically cancelled due to approved leave request ${leaveId}`,
              ...AuditLogger.extractRequestContext(event),
            });
          }

          console.log(`✅ Shift ${shift.shiftId} deleted and audit log created`);
        }
      } catch (deleteError) {
        console.error('⚠️ Error deleting shifts (leave still approved):', deleteError);
        // Don't fail the approval if shift deletion fails
      }
    }

    // --- Audit Log for Leave Approval ---
    if (userPerms) {
      // Get clinicIds from stored leave request (created when leave was submitted)
      // This ensures proper clinic filtering in audit logs
      let clinicsToLog = leave.clinicIds || [];

      // If clinicIds not stored, derive from affected shifts
      if (clinicsToLog.length === 0 && overlappingShifts.length > 0) {
        clinicsToLog = [...new Set(overlappingShifts.map(s => s.clinicId).filter(Boolean))];
      }

      // Fallback to approver's first clinic
      if (clinicsToLog.length === 0) {
        clinicsToLog = [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);
      }

      // Create audit log for each clinic to ensure visibility when filtering by clinic
      for (const clinicIdForAudit of clinicsToLog) {
        await auditLogger.log({
          userId: userPerms.email,
          userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
          userRole: AuditLogger.getUserRole(userPerms),
          action: 'APPROVE',
          resource: 'LEAVE',
          resourceId: leaveId,
          clinicId: clinicIdForAudit, // Use clinic(s) for proper filtering
          before: { status: leave.status, staffId: leave.staffId },
          after: { status: 'approved' },
          reason: approvalNotes,
          metadata: {
            ...AuditLogger.createLeaveMetadata(leave, { cancelledShifts: overlappingShifts.length }),
            actionBy: userPerms.email,
            actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
            actionType: 'Leave Approved',
            requestedBy: leave.staffId, // Include the staff who requested leave
            staffClinicIds: leave.clinicIds || clinicsToLog,
            affectedClinics: [...new Set(overlappingShifts.map(s => s.clinicId).filter(Boolean))],
            deletedShiftCount: overlappingShifts.length,
          },
          ...AuditLogger.extractRequestContext(event),
        });
      }

      console.log(`✅ Audit log(s) created: APPROVE LEAVE ${leaveId} by ${userPerms.email} for clinics: ${clinicsToLog.join(', ')}`);
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

  } catch (error: any) {
    console.error('❌ Error in approveLeave:', error);
    console.error('❌ Error message:', error?.message);
    console.error('❌ Error stack:', error?.stack);
    // Return a proper error response instead of throwing
    return httpErr(500, `Failed to approve leave: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * FIXED: Deny leave with proper audit logging
 */
async function denyLeave(leaveId: string, userPerms: UserPermissions, event?: APIGatewayProxyEvent, denyReason?: string) {
  try {
    console.log(`✅ Starting denyLeave for leaveId=${leaveId}`);

    // Get the leave request before updating for audit purposes
    const { Item: leave } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
    if (!leave) {
      console.log(`❌ Leave request ${leaveId} not found`);
      return httpErr(404, "Leave request not found");
    }

    const previousStatus = leave?.status;

    // Update leave status to denied
    await ddb.send(new UpdateCommand({
      TableName: LEAVE_TABLE,
      Key: { leaveId },
      UpdateExpression: 'set #status = :denied, deniedAt = :deniedAt, deniedBy = :deniedBy, denyReason = :reason',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':denied': 'denied',
        ':deniedAt': new Date().toISOString(),
        ':deniedBy': userPerms.email,
        ':reason': denyReason || 'No reason provided',
      }
    }));

    console.log(`✅ Leave status updated to denied`);

    // --- Audit Log for Leave Denial ---
    if (userPerms) {
      // Look up the staff's clinics from StaffClinicInfo table for proper clinic filtering
      let staffClinicIds: string[] = leave.clinicIds || [];
      
      // If not stored in leave record, fetch from StaffClinicInfo
      if (staffClinicIds.length === 0) {
        try {
          const { Items: staffInfoItems } = await ddb.send(new QueryCommand({
            TableName: STAFF_INFO_TABLE,
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': leave.staffId.toLowerCase() },
          }));
          staffClinicIds = (staffInfoItems || []).map((item: any) => item.clinicId).filter(Boolean);
          console.log(`📋 Found ${staffClinicIds.length} clinic(s) for staff ${leave.staffId}:`, staffClinicIds);
        } catch (lookupError) {
          console.warn('Could not look up staff clinics for audit:', lookupError);
        }
      }

      // Fallback to admin's clinic if we couldn't find staff's clinics
      const clinicsToLog = staffClinicIds.length > 0 ? staffClinicIds : [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);

      // Log to all relevant clinics for visibility
      for (const clinicIdForAudit of clinicsToLog) {
        await auditLogger.log({
          userId: userPerms.email,
          userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
          userRole: AuditLogger.getUserRole(userPerms),
          action: 'DENY',
          resource: 'LEAVE',
          resourceId: leaveId,
          clinicId: clinicIdForAudit, // Use staff's clinic(s) for proper filtering
          before: { status: previousStatus, staffId: leave.staffId },
          after: { status: 'denied' },
          reason: denyReason,
          metadata: {
            ...AuditLogger.createLeaveMetadata(leave),
            actionBy: userPerms.email,
            actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
            actionType: 'Leave Denied',
            requestedBy: leave.staffId,
            denyReason: denyReason || 'No reason provided',
            staffClinicIds: clinicsToLog,
          },
          ...AuditLogger.extractRequestContext(event),
        });
      }

      console.log(`✅ Audit log(s) created: DENY LEAVE ${leaveId} by ${userPerms.email} for clinics: ${clinicsToLog.join(', ')}`);
    }

    return httpOk({ leaveId, status: 'denied', message: 'Leave request has been denied.' });
  } catch (error: any) {
    console.error('❌ Error in denyLeave:', error);
    return httpErr(500, `Failed to deny leave: ${error?.message || 'Unknown error'}`);
  }
}

// ========================================
// AUDIT TRAIL FUNCTIONS
// ========================================

/**
 * Query audit logs with filters
 * GET /hr/audit?userId=...&clinicId=...&startDate=...&endDate=...&limit=...
 */
async function queryAuditLogs(queryParams: any) {
  const { userId, clinicId, startDate, endDate, limit: limitStr } = queryParams || {};
  const limit = parseInt(limitStr) || 100;

  // If userId is provided, query by user
  if (userId) {
    const result = await auditLogger.queryByUser(userId, { startDate, endDate, limit });
    return httpOk({
      auditLogs: result.auditLogs,
      count: result.count,
      lastEvaluatedKey: result.lastEvaluatedKey,
    });
  }

  // If clinicId is provided, query by clinic
  if (clinicId) {
    const result = await auditLogger.queryByClinic(clinicId, { startDate, endDate, limit });
    return httpOk({
      auditLogs: result.auditLogs,
      count: result.count,
      lastEvaluatedKey: result.lastEvaluatedKey,
    });
  }

  // Default: scan recent audit logs (not recommended for large datasets)
  // For production, require at least one filter
  return httpErr(400, "Please provide at least one filter: userId or clinicId");
}

/**
 * Get audit trail for a specific resource
 * GET /hr/audit/{resourceType}/{resourceId}
 */
async function getResourceAuditTrail(resourceType: AuditResource, resourceId: string, queryParams: any) {
  const { limit: limitStr } = queryParams || {};
  const limit = parseInt(limitStr) || 100;

  // Validate resource type
  const validResourceTypes = ['STAFF', 'SHIFT', 'LEAVE', 'CLINIC_ROLE'];
  if (!validResourceTypes.includes(resourceType)) {
    return httpErr(400, `Invalid resource type. Must be one of: ${validResourceTypes.join(', ')}`);
  }

  const result = await auditLogger.queryByResource(resourceType, resourceId, { limit });

  return httpOk({
    resource: resourceType.toLowerCase(),
    resourceId,
    auditTrail: result.auditLogs,
    count: result.count,
    lastEvaluatedKey: result.lastEvaluatedKey,
  });
}

// ========================================
// EMAIL NOTIFICATION
// ========================================

async function sendShiftNotificationEmail(recipientEmail: string, shiftDetails: any, staffName: string, clinicTimezone: string) {
  if (!FROM_EMAIL || !recipientEmail) {
    console.warn('Skipping shift notification: Missing FROM_EMAIL or recipientEmail.');
    return;
  }

  const tz = normalizeTimeZoneOrUtc(clinicTimezone);

  // Format time only (not full date-time) for Start Time and End Time fields
  const startTimeLocal = new Date(shiftDetails.startTime).toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  const endTimeLocal = new Date(shiftDetails.endTime).toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', { 
    timeZone: tz, 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

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

  const command = new SendEmailCommand({
    Destination: { ToAddresses: [recipientEmail] },
    Content: {
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
    FromEmailAddress: FROM_EMAIL,
  });

  try {
    await ses.send(command);
    console.log(`Email sent successfully to ${recipientEmail} using SESv2`);
  } catch (e) {
    console.error(`Failed to send email to ${recipientEmail} using SESv2:`, e);
  }
}

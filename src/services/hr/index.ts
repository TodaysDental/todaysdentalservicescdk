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
//     statusCode: code, headers: currentCorsHeaders, body: JSON.stringify({ success: false, message })
// });
// const httpOk = (data: Record<string, any>) => ({
//     statusCode: 200, headers: currentCorsHeaders, body: JSON.stringify({ success: true, ...data })
// });


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
//     if (!FROM_EMAIL || !recipientEmail) {
//         console.warn('Skipping shift notification: Missing FROM_EMAIL or recipientEmail.');
//         return;
//     }

//     const tz = normalizeTimeZoneOrUtc(clinicTimezone);

//     // Format time only (not full date-time) for Start Time and End Time fields
//     const startTimeLocal = new Date(shiftDetails.startTime).toLocaleTimeString('en-US', { 
//         timeZone: tz, 
//         hour: 'numeric', 
//         minute: '2-digit',
//         hour12: true 
//     });
//     const endTimeLocal = new Date(shiftDetails.endTime).toLocaleTimeString('en-US', { 
//         timeZone: tz, 
//         hour: 'numeric', 
//         minute: '2-digit',
//         hour12: true 
//     });
//     const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

//     const subject = `New Shift Scheduled at ${shiftDetails.clinicId} for ${shiftDate}`;

//     const bodyHtml = `
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

//     // Note: The structure for SESv2 SendEmailCommand is slightly different from v1 SendEmailCommand
//     const command = new SendEmailCommand({
//         Destination: { ToAddresses: [recipientEmail] },
//         Content: { // Content replaces Message in v1
//             Simple: {
//                 Subject: { Data: subject },
//                 Body: {
//                     Html: { Data: bodyHtml },
//                     Text: { 
//                         Data: `A new shift has been scheduled for you on ${shiftDate} at ${shiftDetails.clinicId} from ${startTimeLocal} to ${endTimeLocal}. Estimated Pay: $${shiftDetails.pay.toFixed(2)}.`
//                     }
//                 }
//             }
//         },
//         FromEmailAddress: FROM_EMAIL, // FromEmailAddress replaces Source in v1
//     });

//     try {
//         await ses.send(command);
//         console.log(`Email sent successfully to ${recipientEmail} using SESv2`);
//     } catch (e) {
//         console.error(`Failed to send email to ${recipientEmail} using SESv2:`, e);
//     }
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
//         TableName: SHIFTS_TABLE,
//         IndexName: 'byStaff',
//         KeyConditionExpression: 'staffId = :staffId',
//         FilterExpression: '#status = :completed',
//         ExpressionAttributeNames: { '#status': 'status' },
//         ExpressionAttributeValues: {
//           ':staffId': userPerms.email, // Use email instead of staffId
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
//         TableName: SHIFTS_TABLE,
//         IndexName: 'byClinicAndDate',
//         KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :startDate AND :endDate',
//         ExpressionAttributeValues: {
//             ':clinicId': clinicId,
//             ':startDate': startDate,
//             ':endDate': endDate,
//         }
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
//       KeyConditionExpression += ' AND startTime BETWEEN :startDate AND :endDate';
//       ExpressionAttributeValues[':startDate'] = startDate;
//       ExpressionAttributeValues[':endDate'] = endDate;
//   }

//   let FilterExpression;
//   if (status) {
//       FilterExpression = '#status = :status';
//       ExpressionAttributeValues[':status'] = status;
//   }

//   const { Items } = await ddb.send(new QueryCommand({
//       TableName: SHIFTS_TABLE,
//       IndexName: 'byStaff',
//       KeyConditionExpression,
//       FilterExpression,
//       ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
//       ExpressionAttributeValues
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
//     const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
//     if (!oldShift) return httpErr(404, "Shift not found");

//     const staffId = body.staffId || oldShift.staffId;
//     const clinicId = body.clinicId || oldShift.clinicId;
//     if (!hasClinicAccess(allowedClinics, clinicId)) {
//       return httpErr(403, "Forbidden: no access to this clinic");
//     }

//     const clinicTimezone = await getClinicTimezone(clinicId);
//     const startTime = normalizeToUtcIso(body.startTime || oldShift.startTime, clinicTimezone);

//     const shiftDate = new Date(startTime);
//     const isBlocked = await isDateBlocked(staffId, shiftDate);
//     if (isBlocked) {
//       return httpErr(400, "Cannot update shift: Staff has approved leave on this date");
//     }

//     // Look up user from DynamoDB StaffUser table (staffId is the email)
//     let email: string | undefined;
//     try {
//         const { Item: staffUser } = await ddb.send(new GetCommand({
//             TableName: STAFF_USER_TABLE,
//             Key: { email: staffId.toLowerCase() },
//         }));

//         if (!staffUser) {
//             console.error("Staff user not found in StaffUser table:", staffId);
//             return httpErr(404, "Staff user not found");
//         }

//         email = staffUser.email?.toLowerCase();
//     } catch (err) {
//         console.error("StaffUser table lookup failed:", err);
//         return httpErr(500, "Error looking up staff user");
//     }

//     if (!email) {
//         return httpErr(404, "Staff email not found, cannot determine pay");
//     }

//     const { Item: staffInfo } = await ddb.send(new GetCommand({
//       TableName: STAFF_INFO_TABLE,
//       Key: { email: email, clinicId: clinicId }
//     }));

//     const hourlyRate = staffInfo?.hourlyPay ? parseFloat(String(staffInfo.hourlyPay)) : 0;
//     const endTime = normalizeToUtcIso(body.endTime || oldShift.endTime, clinicTimezone);
//     const totalHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);

//     if (totalHours <= 0) {
//         return httpErr(400, "End time must be after start time");
//     }

//     const pay = totalHours * hourlyRate;

//     const { startTime: _bodyStartTime, endTime: _bodyEndTime, ...restBody } = body || {};
//     const updatedShift = {
//         ...oldShift,
//         ...restBody,
//         shiftId,
//         staffId,
//         email: email,
//         clinicId,
//         startTime,
//         endTime,
//         totalHours: parseFloat(totalHours.toFixed(2)),
//         hourlyRate: hourlyRate,
//         pay: parseFloat(pay.toFixed(2))
//     };

//     await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: updatedShift }));

//     // --- Audit Log ---
//     if (userPerms) {
//       await auditLogger.log({
//         userId: userPerms.email,
//         userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//         userRole: AuditLogger.getUserRole(userPerms),
//         action: 'UPDATE',
//         resource: 'SHIFT',
//         resourceId: shiftId,
//         clinicId: clinicId,
//         before: AuditLogger.sanitizeForAudit(oldShift),
//         after: AuditLogger.sanitizeForAudit(updatedShift),
//         metadata: AuditLogger.createShiftMetadata(updatedShift),
//         ...AuditLogger.extractRequestContext(event),
//       });
//     }

//     return httpOk({ shiftId, message: "Shift updated successfully" });
// }

// async function deleteShift(shiftId: string, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
//     const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
//     if (!Item) return httpErr(404, "Shift not found");
//     const clinicId = Item.clinicId;
//     if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
//         return httpErr(403, "Forbidden: no access to this clinic");
//     }
//     await ddb.send(new DeleteCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));

//     // --- Audit Log ---
//     if (userPerms) {
//       await auditLogger.log({
//         userId: userPerms.email,
//         userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//         userRole: AuditLogger.getUserRole(userPerms),
//         action: 'DELETE',
//         resource: 'SHIFT',
//         resourceId: shiftId,
//         clinicId: clinicId,
//         before: AuditLogger.sanitizeForAudit(Item),
//         metadata: AuditLogger.createShiftMetadata(Item),
//         ...AuditLogger.extractRequestContext(event),
//       });
//     }

//     return httpOk({ message: "Shift deleted successfully" });
// }

// async function rejectShift(shiftId: string, staffId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, reason?: string) {
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

//     // --- Audit Log ---
//     if (userPerms) {
//       await auditLogger.log({
//         userId: userPerms.email,
//         userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//         userRole: AuditLogger.getUserRole(userPerms),
//         action: 'REJECT',
//         resource: 'SHIFT',
//         resourceId: shiftId,
//         clinicId: Item.clinicId,
//         before: { status: Item.status },
//         after: { status: 'rejected' },
//         reason: reason,
//         metadata: AuditLogger.createShiftMetadata(Item),
//         ...AuditLogger.extractRequestContext(event),
//       });
//     }

//     return httpOk({ shiftId, status: 'rejected' });
// }

// // --- LEAVE ---
// async function getLeave(userPerms: any, isAdmin: boolean) {
//     if (isAdmin) {
//         const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
//         return httpOk({ leaveRequests: Items || [] });
//     } else {
//         const { Items } = await ddb.send(new QueryCommand({
//             TableName: LEAVE_TABLE,
//             IndexName: 'byStaff',
//             KeyConditionExpression: 'staffId = :staffId',
//             ExpressionAttributeValues: { ':staffId': userPerms.email } // Use email instead of staffId
//         }));
//         return httpOk({ leaveRequests: Items || [] });
//     }
// }

// async function createLeave(staffId: string, body: any, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
//   const { startDate, endDate, reason } = body;
//   if (!startDate || !endDate) {
//     return httpErr(400, "startDate and endDate are required");
//   }
//   const leaveId = uuidv4();
//   const leaveRequest = {
//     leaveId,
//     staffId,
//     startDate,
//     endDate,
//     reason,
//     status: 'pending'
//   };
//   await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));

//   // --- Audit Log ---
//   if (userPerms) {
//     // Get the first clinicId from user's clinic roles for audit purposes
//     const userClinicId = userPerms.clinicRoles?.[0]?.clinicId;

//     await auditLogger.log({
//       userId: userPerms.email,
//       userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//       userRole: AuditLogger.getUserRole(userPerms),
//       action: 'CREATE',
//       resource: 'LEAVE',
//       resourceId: leaveId,
//       clinicId: userClinicId, // Include clinic for filtering
//       after: AuditLogger.sanitizeForAudit(leaveRequest),
//       metadata: {
//         ...AuditLogger.createLeaveMetadata(leaveRequest),
//         actionType: 'Leave Request Created',
//       },
//       ...AuditLogger.extractRequestContext(event),
//     });
//   }

//   return httpOk({ leaveId, message: "Leave request submitted" });
// }

// async function deleteLeave(leaveId: string, userPerms: UserPermissions, isAdmin:boolean, event?: APIGatewayProxyEvent) {
//     const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
//     if (!Item) return httpErr(404, "Leave request not found");

//     if (!isAdmin && Item.staffId !== userPerms.email) {
//         return httpErr(403, "Forbidden");
//     }

//     await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));

//     // --- Audit Log ---
//     // Get the first clinicId from user's clinic roles for audit purposes
//     const userClinicId = userPerms.clinicRoles?.[0]?.clinicId;

//     await auditLogger.log({
//       userId: userPerms.email,
//       userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//       userRole: AuditLogger.getUserRole(userPerms),
//       action: 'DELETE',
//       resource: 'LEAVE',
//       resourceId: leaveId,
//       clinicId: userClinicId, // Include clinic for filtering
//       before: AuditLogger.sanitizeForAudit(Item),
//       metadata: {
//         ...AuditLogger.createLeaveMetadata(Item),
//         actionType: 'Leave Request Deleted',
//       },
//       ...AuditLogger.extractRequestContext(event),
//     });

//     return httpOk({ message: "Leave request deleted" });
// }

// async function approveLeave(leaveId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, approvalNotes?: string) {
//     console.log('🔄 Starting approveLeave for leaveId:', leaveId);
//     console.log('🔄 LEAVE_TABLE:', LEAVE_TABLE);
//     console.log('🔄 SHIFTS_TABLE:', SHIFTS_TABLE);

//     try {
//         // Validate input
//         if (!leaveId || leaveId === 'undefined') {
//             console.error('❌ Invalid leaveId:', leaveId);
//             return httpErr(400, "Invalid leave ID");
//         }

//         // Get the leave request
//         console.log('🔄 Getting leave request from DynamoDB...');
//         const { Item: leave } = await ddb.send(new GetCommand({ 
//             TableName: LEAVE_TABLE, 
//             Key: { leaveId }
//         }));

//         if (!leave) {
//             console.error('❌ Leave request not found:', leaveId);
//             return httpErr(404, "Leave request not found");
//         }

//         console.log('✅ Found leave request:', JSON.stringify(leave, null, 2));

//         // Validate leave object has required fields
//         if (!leave.staffId) {
//             console.error('❌ Leave request missing staffId:', leave);
//             return httpErr(400, "Leave request is missing staffId");
//         }

//         // Update leave status to approved
//         console.log('🔄 Updating leave status to approved...');
//         await ddb.send(new UpdateCommand({
//             TableName: LEAVE_TABLE,
//             Key: { leaveId },
//             UpdateExpression: 'set #status = :status',
//             ExpressionAttributeNames: { '#status': 'status' },
//             ExpressionAttributeValues: { ':status': 'approved' }
//         }));

//         console.log('✅ Leave status updated to approved');

//         // Find overlapping shifts (only if we have valid date range)
//         let overlappingShifts: any[] = [];
//         if (leave.startDate && leave.endDate) {
//             try {
//                 overlappingShifts = await getOverlappingShifts(
//                     leave.staffId, 
//                     leave.startDate, 
//                     leave.endDate
//                 );

//                 console.log(`📊 Found ${overlappingShifts.length} overlapping shifts:`, 
//                     overlappingShifts.map(s => ({ shiftId: s.shiftId, startTime: s.startTime }))
//                 );
//             } catch (shiftError) {
//                 console.error('⚠️ Error finding overlapping shifts (continuing anyway):', shiftError);
//                 // Don't fail the approval if shift lookup fails
//             }
//         } else {
//             console.warn('⚠️ Leave request missing dates, skipping shift cancellation');
//         }

//         // DELETE overlapping shifts (not just cancel - actually remove from table)
//         if (overlappingShifts.length > 0) {
//             try {
//                 console.log(`🔄 DELETING ${overlappingShifts.length} overlapping shift(s) from table...`);

//                 const deletePromises = overlappingShifts.map(async (shift) => {
//                     console.log('🗑️ Deleting shift:', shift.shiftId, 'for date:', shift.startTime);

//                     // ACTUALLY DELETE the shift from the table
//                     await ddb.send(new DeleteCommand({
//                         TableName: SHIFTS_TABLE,
//                         Key: { shiftId: shift.shiftId }
//                     }));

//                     console.log('✅ Shift deleted from table:', shift.shiftId);

//                     // Audit log for each deleted shift
//                     if (userPerms) {
//                       await auditLogger.log({
//                         userId: userPerms.email,
//                         userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//                         userRole: AuditLogger.getUserRole(userPerms),
//                         action: 'DELETE',
//                         resource: 'SHIFT',
//                         resourceId: shift.shiftId,
//                         clinicId: shift.clinicId, // Use shift's actual clinicId
//                         before: AuditLogger.sanitizeForAudit(shift),
//                         reason: `Shift deleted due to approved leave request (${leaveId})`,
//                         metadata: {
//                           ...AuditLogger.createShiftMetadata(shift),
//                           leaveId: leaveId,
//                           leaveStartDate: leave.startDate,
//                           leaveEndDate: leave.endDate,
//                           actionType: 'Shift Deleted (Leave Approved)',
//                           staffId: shift.staffId,
//                           shiftDate: shift.startTime,
//                         },
//                         ...AuditLogger.extractRequestContext(event),
//                       });
//                     }
//                 });

//                 await Promise.all(deletePromises);
//                 console.log('✅ All overlapping shifts DELETED from table and logged');
//             } catch (deleteError) {
//                 console.error('⚠️ Error deleting shifts (leave still approved):', deleteError);
//                 // Don't fail the approval if shift deletion fails
//             }
//         }

//         // --- Audit Log ---
//         if (userPerms) {
//           // Get clinicId from deleted shifts (best match for filtering), or fallback to approver's clinic
//           // This ensures the leave audit shows up when filtering by the clinic where shifts were affected
//           const affectedClinicIds = [...new Set(overlappingShifts.map(s => s.clinicId).filter(Boolean))];
//           const primaryClinicId = affectedClinicIds[0] || userPerms.clinicRoles?.[0]?.clinicId;

//           // Create audit log for each affected clinic to ensure visibility when filtering by clinic
//           const clinicsToLog = affectedClinicIds.length > 0 ? affectedClinicIds : [primaryClinicId];

//           for (const clinicIdForAudit of clinicsToLog) {
//             await auditLogger.log({
//               userId: userPerms.email,
//               userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//               userRole: AuditLogger.getUserRole(userPerms),
//               action: 'APPROVE',
//               resource: 'LEAVE',
//               resourceId: leaveId,
//               clinicId: clinicIdForAudit, // Use affected clinic(s) for proper filtering
//               before: { status: leave.status, staffId: leave.staffId },
//               after: { status: 'approved' },
//               reason: approvalNotes,
//               metadata: {
//                 ...AuditLogger.createLeaveMetadata(leave, { cancelledShifts: overlappingShifts.length }),
//                 actionBy: userPerms.email,
//                 actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
//                 actionType: 'Leave Approved',
//                 requestedBy: leave.staffId, // Include the staff who requested leave
//                 affectedClinics: affectedClinicIds,
//                 deletedShiftCount: overlappingShifts.length,
//               },
//               ...AuditLogger.extractRequestContext(event),
//             });
//           }

//           console.log(`✅ Audit log(s) created: APPROVE LEAVE ${leaveId} by ${userPerms.email} for clinics: ${clinicsToLog.join(', ')}`);
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

//     } catch (error: any) {
//         console.error('❌ Error in approveLeave:', error);
//         console.error('❌ Error message:', error?.message);
//         console.error('❌ Error stack:', error?.stack);
//         // Return a proper error response instead of throwing
//         return httpErr(500, `Failed to approve leave: ${error?.message || 'Unknown error'}`);
//     }
// }

// async function updateLeaveStatus(leaveId: string, status: 'approved' | 'denied', userPerms?: UserPermissions, event?: APIGatewayProxyEvent, reason?: string) {
//     // Get the leave request before updating for audit purposes
//     const { Item: leave } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
//     if (!leave) {
//       return httpErr(404, "Leave request not found");
//     }

//     const previousStatus = leave?.status;

//     await ddb.send(new UpdateCommand({
//         TableName: LEAVE_TABLE,
//         Key: { leaveId },
//         UpdateExpression: 'set #status = :status',
//         ExpressionAttributeNames: { '#status': 'status' },
//         ExpressionAttributeValues: { ':status': status }
//     }));

//     // --- Audit Log ---
//     if (userPerms) {
//       // Look up the staff's clinics from StaffClinicInfo table for proper clinic filtering
//       // Table has partition key 'email' and sort key 'clinicId', so we can query directly
//       let staffClinicIds: string[] = [];
//       try {
//         const { Items: staffInfoItems } = await ddb.send(new QueryCommand({
//           TableName: STAFF_INFO_TABLE,
//           KeyConditionExpression: 'email = :email',
//           ExpressionAttributeValues: { ':email': leave.staffId.toLowerCase() },
//         }));
//         staffClinicIds = (staffInfoItems || []).map((item: any) => item.clinicId).filter(Boolean);
//         console.log(`📋 Found ${staffClinicIds.length} clinic(s) for staff ${leave.staffId}:`, staffClinicIds);
//       } catch (lookupError) {
//         console.warn('Could not look up staff clinics for audit:', lookupError);
//       }

//       // Fallback to admin's clinic if we couldn't find staff's clinics
//       const clinicsToLog = staffClinicIds.length > 0 ? staffClinicIds : [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);

//       // Log to all relevant clinics for visibility
//       for (const clinicIdForAudit of clinicsToLog) {
//         await auditLogger.log({
//           userId: userPerms.email,
//           userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
//           userRole: AuditLogger.getUserRole(userPerms),
//           action: status === 'approved' ? 'APPROVE' : 'DENY',
//           resource: 'LEAVE',
//           resourceId: leaveId,
//           clinicId: clinicIdForAudit, // Use staff's clinic(s) for proper filtering
//           before: { status: previousStatus, staffId: leave.staffId },
//           after: { status },
//           reason: reason,
//           metadata: {
//             ...AuditLogger.createLeaveMetadata(leave),
//             actionBy: userPerms.email,
//             actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
//             actionType: status === 'approved' ? 'Leave Approved' : 'Leave Denied',
//             requestedBy: leave.staffId,
//             denyReason: status === 'denied' ? reason : undefined,
//           },
//           ...AuditLogger.extractRequestContext(event),
//         });
//       }

//       console.log(`✅ Audit log created: ${status.toUpperCase()} LEAVE ${leaveId} by ${userPerms.email} for clinics: ${clinicsToLog.join(', ')}`);
//     }

//     return httpOk({ leaveId, status });
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
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand, BatchWriteCommand, BatchGetCommand, type BatchGetCommandOutput } from '@aws-sdk/lib-dynamodb';
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

// Environment Variables
const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
const LEAVE_TABLE = process.env.LEAVE_TABLE!;
const ADVANCE_PAY_TABLE = process.env.ADVANCE_PAY_TABLE!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE!;
const CLINICS_TABLE = process.env.CLINICS_TABLE || 'Clinics';
const ADMIN_CALENDAR_TABLE = process.env.ADMIN_CALENDAR_TABLE || 'AdminCalendarEvents';

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

const corsHeaders = buildCorsHeaders();
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
    const endTime = new Date(leave.endDate).getTime() + (24 * 60 * 60 * 1000 - 1);
    return dateTime >= startTime && dateTime <= endTime;
  });
}

// Get all shifts that overlap with a date range
// FIXED: Uses clinic-timezone-aware date comparison to avoid off-by-one errors
async function getOverlappingShifts(staffId: string, startDate: string, endDate: string, clinicIdForTz?: string): Promise<any[]> {
  console.log(`🔍 getOverlappingShifts: Looking for shifts for staffId=${staffId} between ${startDate} and ${endDate}`);

  // Get ALL scheduled shifts for this staff member (no date filter in query)
  const { Items } = await ddb.send(new QueryCommand({
    TableName: SHIFTS_TABLE,
    IndexName: 'byStaff',
    KeyConditionExpression: 'staffId = :staffId',
    FilterExpression: '#status = :scheduled',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':staffId': staffId,
      ':scheduled': 'scheduled'
    }
  }));

  if (!Items || Items.length === 0) {
    console.log('🔍 No scheduled shifts found for this staff member');
    return [];
  }

  // Leave dates are in YYYY-MM-DD format (wall-clock dates, not UTC)
  // Parse as integers for safe comparison
  const [leaveStartYear, leaveStartMonth, leaveStartDay] = startDate.split('-').map(Number);
  const [leaveEndYear, leaveEndMonth, leaveEndDay] = endDate.split('-').map(Number);

  // Helper to convert YYYY-MM-DD to a comparable integer (YYYYMMDD)
  const toDateInt = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;
  const leaveStartInt = toDateInt(leaveStartYear, leaveStartMonth, leaveStartDay);
  const leaveEndInt = toDateInt(leaveEndYear, leaveEndMonth, leaveEndDay);

  console.log(`🔍 Leave date range (as integers): ${leaveStartInt} to ${leaveEndInt}`);

  // Filter shifts that fall within the leave period using proper timezone conversion
  const overlappingShifts: any[] = [];

  for (const shift of Items) {
    // Get the clinic's timezone for this specific shift
    const shiftClinicTz = await getClinicTimezone(shift.clinicId || clinicIdForTz || '');
    const safeTz = normalizeTimeZoneOrUtc(shiftClinicTz);

    // Convert the shift's UTC start time to clinic-local wall clock date
    const shiftStartUtc = new Date(shift.startTime);
    const dtf = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD format
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const shiftLocalDateStr = dtf.format(shiftStartUtc); // e.g., "2026-01-28"
    const [shiftYear, shiftMonth, shiftDay] = shiftLocalDateStr.split('-').map(Number);
    const shiftDateInt = toDateInt(shiftYear, shiftMonth, shiftDay);

    // Check if shift date (in clinic local time) is within leave date range (inclusive)
    const overlaps = shiftDateInt >= leaveStartInt && shiftDateInt <= leaveEndInt;

    if (overlaps) {
      console.log(`✅ OVERLAP FOUND: Shift ${shift.shiftId} on ${shift.startTime} (local: ${shiftLocalDateStr}) falls within leave ${startDate} to ${endDate}`);
      overlappingShifts.push(shift);
    }
  }

  console.log(`🔍 Found ${overlappingShifts.length} overlapping shifts out of ${Items.length} total scheduled shifts`);
  console.log(`📋 Overlapping shifts:`, overlappingShifts.map((s: any) => ({
    shiftId: s.shiftId,
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status
  })));

  return overlappingShifts;
}

// Get clinic timezone from Clinics table (with caching)
async function getClinicTimezone(clinicId: string): Promise<string> {
  const DEFAULT_TIMEZONE = 'America/New_York';

  const cached = timezoneCache.get(clinicId);
  if (cached && Date.now() - cached.timestamp < TIMEZONE_CACHE_TTL_MS) {
    return cached.timezone;
  }

  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: CLINICS_TABLE,
      Key: { clinicId },
    }));

    const timezone = Item?.timeZone || Item?.timezone || DEFAULT_TIMEZONE;
    timezoneCache.set(clinicId, { timezone, timestamp: Date.now() });
    return timezone;
  } catch (error) {
    console.error(`Error fetching timezone for clinic ${clinicId}:`, error);
    return DEFAULT_TIMEZONE;
  }
}

function normalizeTimeZoneOrUtc(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function hasExplicitTimeZone(dateTime: string): boolean {
  return /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(dateTime);
}

type NaiveDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseNaiveDateTime(dateTime: string): NaiveDateTimeParts | null {
  const normalized = dateTime.trim().replace(' ', 'T');
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
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
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const offset1 = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utcDate = new Date(utcGuess.getTime() - offset1);
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

// SES Email Function — Apple-inspired black & white theme
async function sendShiftNotificationEmail(recipientEmail: string, shiftDetails: any, staffName: string, clinicTimezone: string) {
  if (!FROM_EMAIL || !recipientEmail) {
    console.warn('Skipping shift notification: Missing FROM_EMAIL or recipientEmail.');
    return;
  }

  const tz = normalizeTimeZoneOrUtc(clinicTimezone);

  const startTimeLocal = new Date(shiftDetails.startTime).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  });
  const endTimeLocal = new Date(shiftDetails.endTime).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  });
  const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const hourlyRate = typeof shiftDetails.hourlyRate === 'number' ? shiftDetails.hourlyRate : 0;
  const estimatedPay = typeof shiftDetails.pay === 'number' ? shiftDetails.pay : 0;
  const totalHours = typeof shiftDetails.totalHours === 'number' ? shiftDetails.totalHours : 0;

  const subject = `Shift Scheduled — ${shiftDate}`;

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f5f5f7; font-family:-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7; padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1d1d1f; padding:32px 40px; text-align:center;">
            <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:600; letter-spacing:-0.3px;">Shift Scheduled</h1>
            <p style="margin:6px 0 0; color:rgba(255,255,255,0.6); font-size:13px; font-weight:400;">Today's Dental Insights</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px; color:#1d1d1f; font-size:16px; line-height:1.5;">Hello <strong>${staffName || shiftDetails.staffId}</strong>,</p>
            <p style="margin:0 0 24px; color:#1d1d1f; font-size:16px; line-height:1.5;">A new shift has been scheduled for you. Here are the details:</p>

            <!-- Details Card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7; border-radius:12px; margin:0 0 24px;">
              <tr><td style="padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px; width:140px;">Office</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${shiftDetails.clinicId}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Date</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${shiftDate}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Time</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${startTimeLocal} – ${endTimeLocal}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Role</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${shiftDetails.role || 'N/A'}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Hours</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${totalHours.toFixed(2)}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Hourly Rate</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">$${hourlyRate.toFixed(2)}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Estimated Pay</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:22px; font-weight:600;">$${estimatedPay.toFixed(2)}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 0;">
                <a href="https://todaysdentalinsights.com/" style="display:inline-block; background:#1d1d1f; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:980px; font-size:15px; font-weight:500; letter-spacing:-0.2px;">View Your Schedule</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 28px; border-top:1px solid #e5e5e7; text-align:center;">
            <p style="margin:0; color:#86868b; font-size:12px; line-height:1.6;">This is an automated notification from ${APP_NAME}.<br>Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const command = new SendEmailCommand({
    Destination: { ToAddresses: [recipientEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: bodyHtml },
          Text: {
            Data: `Shift Scheduled\n\nHello ${staffName || shiftDetails.staffId},\n\nA new shift has been scheduled for you.\n\nOffice: ${shiftDetails.clinicId}\nDate: ${shiftDate}\nTime: ${startTimeLocal} – ${endTimeLocal}\nRole: ${shiftDetails.role || 'N/A'}\nHours: ${totalHours.toFixed(2)}\nHourly Rate: $${hourlyRate.toFixed(2)}\nEstimated Pay: $${estimatedPay.toFixed(2)}\n\nView your schedule: https://todaysdentalinsights.com/\n\nThis is an automated notification from ${APP_NAME}.`
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

// ========================================
// LEAVE STATUS NOTIFICATION EMAIL
// ========================================

async function sendLeaveStatusNotificationEmail(
  recipientEmail: string,
  staffName: string,
  status: 'approved' | 'denied',
  leaveStartDate: string,
  leaveEndDate: string,
  reason?: string,
  cancelledShiftCount?: number
) {
  if (!FROM_EMAIL || !recipientEmail) {
    console.warn('Skipping leave status email: Missing FROM_EMAIL or recipientEmail.');
    return;
  }

  const statusLabel = status === 'approved' ? 'Approved' : 'Denied';
  const statusColor = status === 'approved' ? '#34C759' : '#FF3B30';
  const subject = `Leave Request ${statusLabel} — ${leaveStartDate} to ${leaveEndDate}`;

  const reasonBlock = reason
    ? `<tr>
        <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px; width:140px;">Reason</td>
        <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${reason}</td>
       </tr>
       <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>`
    : '';

  const cancelledBlock = (cancelledShiftCount && cancelledShiftCount > 0)
    ? `<p style="margin:16px 0 0; color:#86868b; font-size:14px; line-height:1.5;">
        <strong>${cancelledShiftCount}</strong> overlapping shift(s) have been automatically cancelled.
       </p>`
    : '';

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f5f5f7; font-family:-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7; padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1d1d1f; padding:32px 40px; text-align:center;">
            <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:600; letter-spacing:-0.3px;">Leave Request ${statusLabel}</h1>
            <p style="margin:6px 0 0; color:rgba(255,255,255,0.6); font-size:13px; font-weight:400;">Today's Dental Insights</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px; color:#1d1d1f; font-size:16px; line-height:1.5;">Hello <strong>${staffName}</strong>,</p>
            <p style="margin:0 0 24px; color:#1d1d1f; font-size:16px; line-height:1.5;">Your leave request has been <strong style="color:${statusColor};">${statusLabel.toLowerCase()}</strong>.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7; border-radius:12px; margin:0 0 24px;">
              <tr><td style="padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px; width:140px;">Status</td>
                    <td style="padding:6px 0; font-size:15px; font-weight:600; color:${statusColor};">${statusLabel}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">From</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${leaveStartDate}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">To</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${leaveEndDate}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  ${reasonBlock}
                </table>
              </td></tr>
            </table>
            ${cancelledBlock}

            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:28px 0 8px;">
                <a href="https://todaysdentalinsights.com/" style="display:inline-block; background:#1d1d1f; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:980px; font-size:15px; font-weight:500; letter-spacing:-0.2px;">View Dashboard</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 28px; border-top:1px solid #e5e5e7; text-align:center;">
            <p style="margin:0; color:#86868b; font-size:12px; line-height:1.6;">This is an automated notification from ${APP_NAME}.<br>Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textBody = `Leave Request ${statusLabel}\n\nHello ${staffName},\n\nYour leave request from ${leaveStartDate} to ${leaveEndDate} has been ${statusLabel.toLowerCase()}.${reason ? `\n\nReason: ${reason}` : ''}${cancelledShiftCount ? `\n\n${cancelledShiftCount} overlapping shift(s) have been automatically cancelled.` : ''}\n\nThis is an automated notification from ${APP_NAME}.`;

  const command = new SendEmailCommand({
    Destination: { ToAddresses: [recipientEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: bodyHtml },
          Text: { Data: textBody },
        },
      },
    },
    FromEmailAddress: FROM_EMAIL,
  });

  try {
    await ses.send(command);
    console.log(`Leave ${status} email sent to ${recipientEmail}`);
  } catch (e) {
    console.error(`Failed to send leave ${status} email to ${recipientEmail}:`, e);
  }
}

// ========================================
// SHIFT CANCELLED NOTIFICATION EMAIL
// ========================================

async function sendShiftCancelledEmail(
  recipientEmail: string,
  staffName: string,
  shiftDetails: any,
  clinicTimezone: string,
  cancellationReason?: string
) {
  if (!FROM_EMAIL || !recipientEmail) {
    console.warn('Skipping shift cancellation email: Missing FROM_EMAIL or recipientEmail.');
    return;
  }

  const tz = normalizeTimeZoneOrUtc(clinicTimezone);
  const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const startTimeLocal = new Date(shiftDetails.startTime).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  });
  const endTimeLocal = new Date(shiftDetails.endTime).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  });

  const reasonText = cancellationReason || 'Cancelled by administrator';
  const subject = `Shift Cancelled — ${shiftDate}`;

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f5f5f7; font-family:-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7; padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1d1d1f; padding:32px 40px; text-align:center;">
            <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:600; letter-spacing:-0.3px;">Shift Cancelled</h1>
            <p style="margin:6px 0 0; color:rgba(255,255,255,0.6); font-size:13px; font-weight:400;">Today's Dental Insights</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px; color:#1d1d1f; font-size:16px; line-height:1.5;">Hello <strong>${staffName}</strong>,</p>
            <p style="margin:0 0 24px; color:#1d1d1f; font-size:16px; line-height:1.5;">A previously scheduled shift has been <strong style="color:#FF3B30;">cancelled</strong>.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7; border-radius:12px; margin:0 0 24px;">
              <tr><td style="padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px; width:140px;">Office</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${shiftDetails.clinicId}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Date</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${shiftDate}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Time</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${startTimeLocal} – ${endTimeLocal}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Reason</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${reasonText}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:28px 0 8px;">
                <a href="https://todaysdentalinsights.com/" style="display:inline-block; background:#1d1d1f; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:980px; font-size:15px; font-weight:500; letter-spacing:-0.2px;">View Your Schedule</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 28px; border-top:1px solid #e5e5e7; text-align:center;">
            <p style="margin:0; color:#86868b; font-size:12px; line-height:1.6;">This is an automated notification from ${APP_NAME}.<br>Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textBody = `Shift Cancelled\n\nHello ${staffName},\n\nYour shift on ${shiftDate} (${startTimeLocal} – ${endTimeLocal}) at ${shiftDetails.clinicId} has been cancelled.\n\nReason: ${reasonText}\n\nView your schedule: https://todaysdentalinsights.com/\n\nThis is an automated notification from ${APP_NAME}.`;

  const command = new SendEmailCommand({
    Destination: { ToAddresses: [recipientEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: bodyHtml },
          Text: { Data: textBody },
        },
      },
    },
    FromEmailAddress: FROM_EMAIL,
  });

  try {
    await ses.send(command);
    console.log(`Shift cancellation email sent to ${recipientEmail}`);
  } catch (e) {
    console.error(`Failed to send shift cancellation email to ${recipientEmail}:`, e);
  }
}

// ========================================
// SHIFT REJECTED → ADMIN NOTIFICATION EMAIL
// ========================================

async function sendShiftRejectedToAdminEmail(
  adminEmail: string,
  adminName: string,
  staffName: string,
  shiftDetails: any,
  clinicTimezone: string
) {
  if (!FROM_EMAIL || !adminEmail) {
    console.warn('Skipping shift rejection admin email: Missing FROM_EMAIL or adminEmail.');
    return;
  }

  const tz = normalizeTimeZoneOrUtc(clinicTimezone);
  const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const startTimeLocal = new Date(shiftDetails.startTime).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  });
  const endTimeLocal = new Date(shiftDetails.endTime).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  });

  const subject = `Shift Rejected by ${staffName} — ${shiftDate}`;

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f5f5f7; font-family:-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7; padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1d1d1f; padding:32px 40px; text-align:center;">
            <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:600; letter-spacing:-0.3px;">Shift Rejected</h1>
            <p style="margin:6px 0 0; color:rgba(255,255,255,0.6); font-size:13px; font-weight:400;">Today's Dental Insights</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px; color:#1d1d1f; font-size:16px; line-height:1.5;">Hello <strong>${adminName || 'Admin'}</strong>,</p>
            <p style="margin:0 0 24px; color:#1d1d1f; font-size:16px; line-height:1.5;"><strong>${staffName}</strong> has <strong style="color:#FF3B30;">rejected</strong> a shift you scheduled.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7; border-radius:12px; margin:0 0 24px;">
              <tr><td style="padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px; width:140px;">Staff Member</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${staffName}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Office</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${shiftDetails.clinicId}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Date</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${shiftDate}</td>
                  </tr>
                  <tr><td colspan="2" style="border-bottom:1px solid #e5e5e7; padding:0; height:1px;"></td></tr>
                  <tr>
                    <td style="padding:6px 0; color:#86868b; font-size:13px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Time</td>
                    <td style="padding:6px 0; color:#1d1d1f; font-size:15px; font-weight:500;">${startTimeLocal} – ${endTimeLocal}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:28px 0 8px;">
                <a href="https://todaysdentalinsights.com/" style="display:inline-block; background:#1d1d1f; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:980px; font-size:15px; font-weight:500; letter-spacing:-0.2px;">View Schedule</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 28px; border-top:1px solid #e5e5e7; text-align:center;">
            <p style="margin:0; color:#86868b; font-size:12px; line-height:1.6;">This is an automated notification from ${APP_NAME}.<br>Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textBody = `Shift Rejected\n\nHello ${adminName || 'Admin'},\n\n${staffName} has rejected a shift you scheduled.\n\nShift Details:\nOffice: ${shiftDetails.clinicId}\nDate: ${shiftDate}\nTime: ${startTimeLocal} – ${endTimeLocal}\n\nView the schedule: https://todaysdentalinsights.com/\n\nThis is an automated notification from ${APP_NAME}.`;

  const command = new SendEmailCommand({
    Destination: { ToAddresses: [adminEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: bodyHtml },
          Text: { Data: textBody },
        },
      },
    },
    FromEmailAddress: FROM_EMAIL,
  });

  try {
    await ses.send(command);
    console.log(`Shift rejection email sent to admin ${adminEmail}`);
  } catch (e) {
    console.error(`Failed to send shift rejection email to admin ${adminEmail}:`, e);
  }
}

// ========================================
// MAIN HANDLER (ROUTER)
// ========================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  currentCorsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: currentCorsHeaders, body: "" };
  }

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
      return getDashboard(userPerms, isAdmin, event.queryStringParameters);
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
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return createShift(parsedBody, allowedClinics, userPerms, event);
    }

    // --- BATCH SHIFTS (multiday / multi-staff → one consolidated email per staff) ---
    if (method === 'POST' && path === '/shifts/batch') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return createBatchShifts(parsedBody, allowedClinics, userPerms, event);
    }

    // --- SHIFT REJECTION (must come before generic PUT /shifts/{id}) ---
    if (method === 'PUT' && path.startsWith('/shifts/') && path.endsWith('/reject')) {
      const shiftId = path.split('/')[2];
      return rejectShift(shiftId, userPerms, event);
    }

    if (method === 'PUT' && path.startsWith('/shifts/')) {
      const shiftId = path.split('/')[2];
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return updateShift(shiftId, parsedBody, allowedClinics, userPerms, event);
    }

    if (method === 'DELETE' && path.startsWith('/shifts/')) {
      const shiftId = path.split('/')[2];
      return deleteShift(shiftId, allowedClinics, userPerms, isAdmin, event);
    }

    // --- COPY WEEK SCHEDULE ---
    if (method === 'POST' && path === '/shifts/copy-week') {
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return copyWeekSchedule(parsedBody, allowedClinics, userPerms, event);
    }

    // --- ADMIN CALENDAR (All Clinics View) ---
    if (method === 'GET' && path === '/admin-calendar') {
      if (!isAdmin) {
        return httpErr(403, "Admin access required for calendar view");
      }
      return getAdminCalendarShifts(userPerms, event.queryStringParameters, allowedClinics);
    }

    // --- LEAVE REQUESTS ---
    if (method === 'GET' && path === '/leave') {
      return getLeave(userPerms, isAdmin);
    }

    if (method === 'POST' && path === '/leave') {
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return createLeave(userPerms.email, parsedBody, userPerms, event);
    }

    if (method === 'PUT' && path.startsWith('/leave/') && path.endsWith('/approve')) {
      const leaveId = path.split('/')[2];
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const approvalNotes = parsedBody?.notes;
      return approveLeave(leaveId, userPerms, event, approvalNotes);
    }

    if (method === 'PUT' && path.startsWith('/leave/') && path.endsWith('/deny')) {
      const leaveId = path.split('/')[2];
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const reason = parsedBody?.reason;
      return updateLeaveStatus(leaveId, 'denied', userPerms, event, reason);
    }

    if (method === 'DELETE' && path.startsWith('/leave/')) {
      const leaveId = path.split('/')[2];
      return deleteLeave(leaveId, userPerms, isAdmin, event);
    }


    // --- HR CONFIG (For frontend to consume business rule constants) ---
    if (method === 'GET' && path === '/config') {
      return getHrConfig();
    }

    // --- ADVANCE PAY REQUESTS ---
    if (method === 'GET' && path === '/advance-pay') {
      return getAdvancePayRequests(userPerms, isAdmin, allowedClinics);
    }

    if (method === 'POST' && path === '/advance-pay') {
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return createAdvancePayRequest(userPerms, parsedBody, allowedClinics, event);
    }

    // Admin-only route to record advance pays that were already given to staff
    if (method === 'POST' && path === '/advance-pay/admin-record') {
      if (!isAdmin) {
        return httpErr(403, "Admin access required to record advance pay");
      }
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return adminCreateAdvancePayRecord(userPerms, parsedBody, allowedClinics, event);
    }

    if (method === 'DELETE' && path.startsWith('/advance-pay/')) {
      const advanceId = path.split('/')[2];
      return deleteAdvancePayRequest(advanceId, userPerms, isAdmin, allowedClinics, event);
    }

    if (method === 'PUT' && path.startsWith('/advance-pay/') && path.endsWith('/approve')) {
      const advanceId = path.split('/')[2];
      if (!isAdmin) {
        return httpErr(403, "Admin access required to approve advance pay requests");
      }
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return approveAdvancePay(advanceId, userPerms, allowedClinics, event, parsedBody?.notes);
    }

    if (method === 'PUT' && path.startsWith('/advance-pay/') && path.endsWith('/deny')) {
      const advanceId = path.split('/')[2];
      if (!isAdmin) {
        return httpErr(403, "Admin access required to deny advance pay requests");
      }
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return denyAdvancePay(advanceId, userPerms, allowedClinics, event, parsedBody?.reason);
    }

    if (method === 'PUT' && path.startsWith('/advance-pay/') && path.endsWith('/mark-paid')) {
      const advanceId = path.split('/')[2];
      if (!isAdmin) {
        return httpErr(403, "Admin access required to mark advance pay as paid");
      }
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return markAdvancePayAsPaid(advanceId, userPerms, allowedClinics, event, parsedBody?.paymentReference);
    }

    // Admin initiates advance pay request for staff (staff must approve)
    if (method === 'POST' && path === '/advance-pay/admin-initiate') {
      if (!isAdmin) {
        return httpErr(403, "Admin access required to initiate advance pay for staff");
      }
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return adminInitiateAdvancePayForStaff(userPerms, parsedBody, allowedClinics, event);
    }

    // Staff approves admin-initiated advance pay request
    if (method === 'PUT' && path.startsWith('/advance-pay/') && path.endsWith('/staff-approve')) {
      const advanceId = path.split('/')[2];
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return staffApproveAdvancePay(advanceId, userPerms, event, parsedBody?.notes);
    }

    // Staff rejects admin-initiated advance pay request
    if (method === 'PUT' && path.startsWith('/advance-pay/') && path.endsWith('/staff-reject')) {
      const advanceId = path.split('/')[2];
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return staffRejectAdvancePay(advanceId, userPerms, event, parsedBody?.reason);
    }

    // --- ADMIN CALENDAR EVENTS (Tasks, Meetings, To-Dos) ---
    if (method === 'GET' && path === '/admin-calendar/events') {
      if (!isAdmin) {
        return httpErr(403, "Admin access required for calendar events");
      }
      return getAdminCalendarEvents(event.queryStringParameters, allowedClinics);
    }

    if (method === 'POST' && path === '/admin-calendar/events') {
      if (!isAdmin) {
        return httpErr(403, "Admin access required to create calendar events");
      }
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return createAdminCalendarEvent(parsedBody, userPerms, allowedClinics);
    }

    if (method === 'PUT' && path.match(/^\/admin-calendar\/events\/[^\/]+$/)) {
      if (!isAdmin) {
        return httpErr(403, "Admin access required to update calendar events");
      }
      const eventId = path.split('/')[3];
      const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      return updateAdminCalendarEvent(eventId, parsedBody, userPerms, allowedClinics);
    }

    if (method === 'PUT' && path.match(/^\/admin-calendar\/events\/[^\/]+\/complete$/)) {
      if (!isAdmin) {
        return httpErr(403, "Admin access required to complete calendar events");
      }
      const eventId = path.split('/')[3];
      return completeAdminCalendarEvent(eventId, userPerms, allowedClinics);
    }

    if (method === 'DELETE' && path.match(/^\/admin-calendar\/events\/[^\/]+$/)) {
      if (!isAdmin) {
        return httpErr(403, "Admin access required to delete calendar events");
      }
      const eventId = path.split('/')[3];
      return deleteAdminCalendarEvent(eventId, allowedClinics);
    }

    if (method === 'GET' && path === '/admin-calendar/admins') {
      if (!isAdmin) {
        return httpErr(403, "Admin access required");
      }
      return getAssignableAdmins(event.queryStringParameters, allowedClinics);
    }

    // --- AUDIT TRAIL ---
    if (method === 'GET' && path === '/audit') {
      return queryAuditLogs(event.queryStringParameters, userPerms, isAdmin, allowedClinics);
    }

    return httpErr(404, "Route not found");

  } catch (error: any) {
    console.error("Unhandled error:", error);
    return httpErr(500, error.message || "Internal server error");
  }
};

// ========================================
// DASHBOARD - OPTIMIZED WITH MULTI-CLINIC SUPPORT
// ========================================

/**
 * Get HR Dashboard statistics
 * 
 * @param userPerms - User permissions object
 * @param isAdmin - Whether user is admin
 * @param queryParams - Optional query parameters including clinicIds for filtering
 * 
 * OPTIMIZATIONS:
 * - Supports clinicIds filter to reduce data fetched
 * - Uses Promise.all for parallel queries
 * - ProjectionExpression to fetch only needed fields
 * - COUNT queries for totals where full data not needed
 * - Early filtering to reduce post-processing
 */
async function getDashboard(userPerms: any, isAdmin: boolean, queryParams?: any) {
  if (isAdmin) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(today.setDate(diff)).toISOString();
    const weekEnd = new Date(today.setDate(diff + 6)).toISOString();

    // Get all admin's clinics
    const allAdminClinics: string[] = userPerms.clinicRoles.map((cr: any) => cr.clinicId);

    // Parse clinicIds filter from query params
    let targetClinics = allAdminClinics;
    if (queryParams?.clinicIds) {
      const requestedClinicIds = queryParams.clinicIds.split(',').map((id: string) => id.trim()).filter(Boolean);
      // Only include clinics that the user has access to
      targetClinics = requestedClinicIds.filter((id: string) => allAdminClinics.includes(id));

      // If all requested clinics are invalid, return error
      if (targetClinics.length === 0 && requestedClinicIds.length > 0) {
        return httpErr(403, "No access to any of the requested clinics");
      }
    }

    const targetClinicSet = new Set(targetClinics);

    // OPTIMIZED: Run all independent queries in parallel
    // For staff counts, only query clinics we care about via FilterExpression on clinicId
    const staffClinicInfoPromise = ddb.send(new ScanCommand({
      TableName: STAFF_INFO_TABLE,
      ProjectionExpression: 'email, clinicId, workLocation',
      // OPTIMIZATION: If filtering to specific clinics, we can still use scan
      // but the set-based filtering below is fast enough for reasonable clinic counts
    }));

    // Query shifts for target clinics only (uses GSI for efficiency)
    const shiftQueryPromises = targetClinics.map((clinicId: string) =>
      ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byClinicAndDate',
        KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
          ':start': weekStart,
          ':end': weekEnd,
        },
        // OPTIMIZED: Only fetch required fields for shift calculations
        ProjectionExpression: 'totalHours, pay',
      }))
    );

    const [staffClinicInfoResponse, ...shiftResponses] = await Promise.all([
      staffClinicInfoPromise,
      ...shiftQueryPromises
    ]);

    const staffClinicInfoRecords = staffClinicInfoResponse.Items || [];

    // Calculate staff counts - only for target clinics
    let onPremiseStaff = 0;
    let remoteStaff = 0;
    const processedStaff = new Set<string>();

    // OPTIMIZED: Filter records to only include staff in target clinics
    const relevantStaffRecords = staffClinicInfoRecords.filter((staffInfo: any) =>
      targetClinicSet.has(staffInfo.clinicId)
    );

    relevantStaffRecords.forEach((staffInfo: any) => {
      const staffId = staffInfo.email || staffInfo.staffId;

      if (processedStaff.has(staffId)) {
        return;
      }
      processedStaff.add(staffId);

      if (staffInfo.workLocation) {
        if (staffInfo.workLocation.isRemote && !staffInfo.workLocation.isOnPremise) {
          remoteStaff++;
        } else if (staffInfo.workLocation.isOnPremise) {
          onPremiseStaff++;
        } else if (staffInfo.workLocation.isRemote) {
          remoteStaff++;
        } else {
          onPremiseStaff++;
        }
      } else {
        onPremiseStaff++;
      }
    });

    // Total unique staff = on-premise + remote
    const totalStaff = processedStaff.size;

    const allShifts = shiftResponses.flatMap(res => res.Items || []);

    let estimatedHours = 0;
    let estimatedCost = 0;
    allShifts.forEach(shift => {
      estimatedHours += shift.totalHours || 0;
      estimatedCost += shift.pay || 0;
    });

    return httpOk({
      totalOffices: targetClinics.length,
      totalStaff: totalStaff,
      onPremiseStaff: onPremiseStaff,
      remoteStaff: remoteStaff,
      thisWeeksShifts: allShifts.length,
      budgetStatus: "On Track",
      currentWeekOverview: {
        totalShifts: allShifts.length,
        estimatedHours: parseFloat(estimatedHours.toFixed(2)),
        estimatedCost: parseFloat(estimatedCost.toFixed(2)),
      },
      // Include metadata about the query for frontend reference
      _meta: {
        filteredClinics: queryParams?.clinicIds ? targetClinics : null,
        isFiltered: !!queryParams?.clinicIds,
      }
    });

  } else {
    // Staff dashboard - query their own shifts using efficient GSI
    const { Items: shifts } = await ddb.send(new QueryCommand({
      TableName: SHIFTS_TABLE,
      IndexName: 'byStaff',
      KeyConditionExpression: 'staffId = :staffId',
      FilterExpression: '#status = :completed',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':staffId': userPerms.email,
        ':completed': 'completed'
      },
      // OPTIMIZED: Only fetch required fields
      ProjectionExpression: 'totalHours, pay',
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

// ========================================
// ADMIN CALENDAR - ALL CLINICS VIEW
// ========================================

/**
 * Get shifts across all accessible clinics for admin calendar view
 * Supports optional clinicIds filter to show specific clinics
 */
async function getAdminCalendarShifts(
  userPerms: UserPermissions,
  queryParams: any,
  allowedClinics: Set<string>
) {
  const { startDate, endDate, clinicIds: clinicIdsParam } = queryParams || {};

  if (!startDate || !endDate) {
    return httpErr(400, "startDate and endDate are required");
  }

  // Parse clinicIds if provided (comma-separated string)
  let selectedClinics: string[] = [];
  if (clinicIdsParam) {
    selectedClinics = clinicIdsParam.split(',').filter((id: string) => id.trim());
  }

  // Determine which clinics to query
  const clinicsToQuery: string[] = selectedClinics.length > 0
    ? selectedClinics.filter(id => hasClinicAccess(allowedClinics, id))
    : Array.from(allowedClinics);

  if (clinicsToQuery.length === 0) {
    return httpOk({ shifts: [], clinics: [], leave: [] });
  }

  // Fetch shifts from all selected clinics in parallel
  const shiftPromises = clinicsToQuery.map(async (clinicId) => {
    try {
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
      const shifts = (Items || []).map((s: any) => ({
        ...s,
        startTime: normalizeToUtcIso(s.startTime, tz),
        endTime: normalizeToUtcIso(s.endTime, tz),
      }));

      return shifts;
    } catch (error) {
      console.error(`Error fetching shifts for clinic ${clinicId}:`, error);
      return [];
    }
  });

  // Fetch leave requests for the date range
  const leavePromise = ddb.send(new ScanCommand({
    TableName: LEAVE_TABLE,
    FilterExpression: '(#status = :pending OR #status = :approved) AND ' +
      '((startDate BETWEEN :startDate AND :endDate) OR (endDate BETWEEN :startDate AND :endDate) OR (startDate <= :startDate AND endDate >= :endDate))',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':pending': 'pending',
      ':approved': 'approved',
      ':startDate': startDate,
      ':endDate': endDate,
    }
  }));

  // Wait for all queries
  const [shiftResults, leaveResults] = await Promise.all([
    Promise.all(shiftPromises),
    leavePromise
  ]);

  // Flatten shifts and filter out cancelled
  const allShifts = shiftResults.flat().filter((s: any) => s.status !== 'cancelled');

  // Build clinic name map (for display)
  const clinicNameMap: Record<string, string> = {};
  for (const clinicId of clinicsToQuery) {
    // Try to get clinic name from user's clinic roles
    const clinicRole = userPerms.clinicRoles?.find((cr: any) => cr.clinicId === clinicId);
    clinicNameMap[clinicId] = (clinicRole as any)?.clinicName || clinicId;
  }

  // Build staff name map from shifts + leave (batch get from StaffUser table)
  const normalizeEmail = (value: any) => String(value || '').trim().toLowerCase();

  const shiftStaffIds = allShifts.map((s: any) => normalizeEmail(s.staffId)).filter(Boolean);
  const leaveStaffIds = (leaveResults.Items || []).map((l: any) => normalizeEmail(l.staffId)).filter(Boolean);
  const staffIds = Array.from(new Set([...shiftStaffIds, ...leaveStaffIds]));

  const staffNameMap: Record<string, string> = {};

  // DynamoDB BatchGet limit: 100 items
  const CHUNK_SIZE = 100;
  for (let i = 0; i < staffIds.length; i += CHUNK_SIZE) {
    const chunk = staffIds.slice(i, i + CHUNK_SIZE);
    let requestItems: Record<string, any> | undefined = {
      [STAFF_USER_TABLE]: {
        Keys: chunk.map((email) => ({ email })),
        ProjectionExpression: 'email, givenName, familyName',
      },
    };

    // Retry unprocessed keys a few times
    for (let attempt = 0; attempt < 3 && requestItems; attempt++) {
      const resp: BatchGetCommandOutput = await ddb.send(new BatchGetCommand({ RequestItems: requestItems }));
      const users = (resp.Responses?.[STAFF_USER_TABLE] || []) as any[];

      users.forEach((u) => {
        const email = normalizeEmail(u?.email);
        if (!email) return;
        const displayName = `${u?.givenName || ''} ${u?.familyName || ''}`.trim() || email;
        staffNameMap[email] = displayName;
      });

      requestItems =
        resp.UnprocessedKeys && Object.keys(resp.UnprocessedKeys).length > 0
          ? (resp.UnprocessedKeys as any)
          : undefined;
    }
  }

  // Fallback: if not found, show email
  staffIds.forEach((id) => {
    if (!staffNameMap[id]) staffNameMap[id] = id;
  });

  // Format leave requests
  const leaveRequests = (leaveResults.Items || []).map((leave: any) => {
    const staffEmail = normalizeEmail(leave.staffId);
    return {
      leaveId: leave.leaveId,
      staffId: leave.staffId,
      staffName: staffNameMap[staffEmail] || leave.staffId,
      startDate: leave.startDate,
      endDate: leave.endDate,
      status: leave.status,
      clinicIds: leave.clinicIds || [],
    };
  });

  return httpOk({
    shifts: allShifts,
    clinics: clinicsToQuery.map(id => ({ clinicId: id, clinicName: clinicNameMap[id] })),
    leave: leaveRequests,
    staffNames: staffNameMap,
    dateRange: { startDate, endDate },
  });
}

async function createShift(body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { staffId, clinicId, startTime: rawStartTime, endTime: rawEndTime, ...restBody } = body;
  if (!staffId || !clinicId || !rawStartTime || !rawEndTime) {
    return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
  }
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  const clinicTimezone = await getClinicTimezone(clinicId);
  const startTime = normalizeToUtcIso(rawStartTime, clinicTimezone);
  const endTime = normalizeToUtcIso(rawEndTime, clinicTimezone);

  const shiftDate = new Date(startTime);
  const isBlocked = await isDateBlocked(staffId, shiftDate);
  if (isBlocked) {
    return httpErr(400, "Cannot schedule shift: Staff has approved leave on this date");
  }

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

  // let hourlyRate = 0;
  // try {
  //   const { Item: staffInfo } = await ddb.send(new GetCommand({
  //     TableName: STAFF_INFO_TABLE,
  //     Key: { email: email, clinicId },
  //   }));

  //   if (staffInfo) {
  //     hourlyRate = staffInfo.hourlyRate || 0;
  //   }
  // } catch (err) {
  //   console.error("StaffClinicInfo lookup failed for hourlyRate:", err);
  // }
  // --- START UPDATE HERE ---
  let hourlyRate = 0;
  try {
    const { Item: staffInfo } = await ddb.send(new GetCommand({
      TableName: STAFF_INFO_TABLE,
      Key: { email: email, clinicId },
    }));

    if (staffInfo) {
      // FIX: Check 'hourlyPay' (correct schema) first, then 'hourlyRate' (legacy)
      hourlyRate = parseFloat(String(staffInfo.hourlyPay || staffInfo.hourlyRate || 0));
    }
  } catch (err) {
    console.error("StaffClinicInfo lookup failed for hourlyRate:", err);
  }

  const shiftId = uuidv4();
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  const totalHours = parseFloat(((endMs - startMs) / (1000 * 60 * 60)).toFixed(2));
  const pay = parseFloat((totalHours * hourlyRate).toFixed(2));

  const shift = {
    shiftId,
    staffId,
    clinicId,
    startTime,
    endTime,
    timezone: clinicTimezone, // Store clinic timezone for display and payroll context
    totalHours,
    pay,
    hourlyRate,
    status: 'scheduled',
    ...restBody,
  };

  await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));

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
      metadata: {
        ...AuditLogger.createShiftMetadata(shift),
        assignedTo: staffId,
        assignedToName: staffName,
        actionType: 'Shift Created',
      },
      ...AuditLogger.extractRequestContext(event),
    });
  }

  await sendShiftNotificationEmail(email, shift, staffName || staffId, clinicTimezone);

  return httpOk({ shiftId, message: "Shift created successfully" });
}

// ========================================
// BATCH SHIFTS — Create multiple shifts, send ONE consolidated email per staff
// ========================================

async function createBatchShifts(body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { shifts: shiftPayloads } = body;
  if (!Array.isArray(shiftPayloads) || shiftPayloads.length === 0) {
    return httpErr(400, "shifts array is required and must not be empty");
  }

  // Group payloads by staffId so each staff gets ONE consolidated email
  const byStaff: Record<string, typeof shiftPayloads> = {};
  for (const sp of shiftPayloads) {
    if (!sp.staffId || !sp.clinicId || !sp.startTime || !sp.endTime) {
      return httpErr(400, "Each shift must have staffId, clinicId, startTime, and endTime");
    }
    if (!hasClinicAccess(allowedClinics, sp.clinicId)) {
      return httpErr(403, `Forbidden: no access to clinic ${sp.clinicId}`);
    }
    const key = sp.staffId.toLowerCase();
    if (!byStaff[key]) byStaff[key] = [];
    byStaff[key].push(sp);
  }

  let totalCreated = 0;
  let totalFailed = 0;

  for (const [staffKey, staffShifts] of Object.entries(byStaff)) {
    // Look up staff user info once per staff
    let email: string;
    let staffName: string | undefined;
    try {
      const { Item: staffUser } = await ddb.send(new GetCommand({
        TableName: STAFF_USER_TABLE,
        Key: { email: staffKey },
      }));

      if (!staffUser) {
        console.error("Staff user not found for batch:", staffKey);
        totalFailed += staffShifts.length;
        continue;
      }

      email = staffUser.email?.toLowerCase();
      const givenName = staffUser.givenName;
      const familyName = staffUser.familyName;
      staffName = `${givenName || ''} ${familyName || ''}`.trim();
    } catch (err) {
      console.error("StaffUser lookup failed for batch:", err);
      totalFailed += staffShifts.length;
      continue;
    }

    if (!email) {
      totalFailed += staffShifts.length;
      continue;
    }

    // Fetch hourly rate ONCE per staff+clinic (all shifts in a batch share the same clinic)
    const clinicId = staffShifts[0].clinicId;
    let hourlyRate = 0;
    try {
      const { Item: staffInfo } = await ddb.send(new GetCommand({
        TableName: STAFF_INFO_TABLE,
        Key: { email: email, clinicId },
      }));
      if (staffInfo) {
        hourlyRate = parseFloat(String(staffInfo.hourlyPay || staffInfo.hourlyRate || 0));
      }
    } catch (err) {
      console.error("StaffClinicInfo lookup failed for batch:", err);
    }

    const clinicTimezone = await getClinicTimezone(clinicId);
    const createdShifts: any[] = [];

    for (const sp of staffShifts) {
      try {
        const startTime = normalizeToUtcIso(sp.startTime, clinicTimezone);
        const endTime = normalizeToUtcIso(sp.endTime, clinicTimezone);

        const shiftDate = new Date(startTime);
        const isBlocked = await isDateBlocked(sp.staffId, shiftDate);
        if (isBlocked) {
          console.warn(`Skipping shift on blocked date for ${sp.staffId}`);
          totalFailed++;
          continue;
        }

        const shiftId = uuidv4();
        const startMs = new Date(startTime).getTime();
        const endMs = new Date(endTime).getTime();
        const totalHours = parseFloat(((endMs - startMs) / (1000 * 60 * 60)).toFixed(2));
        const pay = parseFloat((totalHours * hourlyRate).toFixed(2));

        const shift = {
          shiftId,
          staffId: sp.staffId,
          clinicId: sp.clinicId,
          startTime,
          endTime,
          timezone: clinicTimezone,
          totalHours,
          pay,
          hourlyRate,
          role: sp.role || '',
          status: 'scheduled',
        };

        await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));

        if (userPerms) {
          await auditLogger.log({
            userId: userPerms.email,
            userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
            userRole: AuditLogger.getUserRole(userPerms),
            action: 'CREATE',
            resource: 'SHIFT',
            resourceId: shiftId,
            clinicId: sp.clinicId,
            after: AuditLogger.sanitizeForAudit(shift),
            metadata: {
              ...AuditLogger.createShiftMetadata(shift),
              assignedTo: sp.staffId,
              assignedToName: staffName,
              actionType: 'Shift Created (Batch)',
            },
            ...AuditLogger.extractRequestContext(event),
          });
        }

        createdShifts.push(shift);
        totalCreated++;
      } catch (err) {
        console.error("Failed to create shift in batch:", err);
        totalFailed++;
      }
    }

    // Send ONE consolidated email for all shifts created for this staff member
    if (createdShifts.length > 0) {
      await sendMultiShiftNotificationEmail(email, createdShifts, staffName || staffKey, clinicTimezone, clinicId);
    }
  }

  return httpOk({
    message: `Batch complete: ${totalCreated} shift(s) created, ${totalFailed} failed.`,
    totalCreated,
    totalFailed,
  });
}

// ========================================
// CONSOLIDATED MULTI-SHIFT EMAIL
// ========================================

async function sendMultiShiftNotificationEmail(
  recipientEmail: string,
  shifts: any[],
  staffName: string,
  clinicTimezone: string,
  clinicId: string,
) {
  if (!FROM_EMAIL || !recipientEmail || shifts.length === 0) {
    console.warn('Skipping multi-shift notification: Missing data.');
    return;
  }

  const tz = normalizeTimeZoneOrUtc(clinicTimezone);

  // Build shift rows
  let totalHoursAll = 0;
  let totalPayAll = 0;
  const shiftRows = shifts.map((s: any) => {
    const shiftDate = new Date(s.startTime).toLocaleDateString('en-US', {
      timeZone: tz, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
    const startLocal = new Date(s.startTime).toLocaleTimeString('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const endLocal = new Date(s.endTime).toLocaleTimeString('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    });

    totalHoursAll += s.totalHours || 0;
    totalPayAll += s.pay || 0;

    return `
              <tr>
                <td style="padding:12px 16px; border-bottom:1px solid #e5e5e7; color:#1d1d1f; font-size:14px;">${shiftDate}</td>
                <td style="padding:12px 16px; border-bottom:1px solid #e5e5e7; color:#1d1d1f; font-size:14px;">${startLocal} – ${endLocal}</td>
                <td style="padding:12px 16px; border-bottom:1px solid #e5e5e7; color:#1d1d1f; font-size:14px; text-align:right;">${(s.totalHours || 0).toFixed(2)}</td>
                <td style="padding:12px 16px; border-bottom:1px solid #e5e5e7; color:#1d1d1f; font-size:14px; text-align:right;">$${(s.pay || 0).toFixed(2)}</td>
              </tr>`;
  }).join('');

  const hourlyRate = shifts[0]?.hourlyRate || 0;

  const subject = `${shifts.length} Shift${shifts.length > 1 ? 's' : ''} Scheduled — ${clinicId}`;

  const bodyHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f5f5f7; font-family:-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7; padding:40px 20px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1d1d1f; padding:32px 40px; text-align:center;">
            <h1 style="margin:0; color:#ffffff; font-size:22px; font-weight:600; letter-spacing:-0.3px;">Shift Schedule</h1>
            <p style="margin:6px 0 0; color:rgba(255,255,255,0.6); font-size:13px; font-weight:400;">Today's Dental Insights</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px; color:#1d1d1f; font-size:16px; line-height:1.5;">Hello <strong>${staffName}</strong>,</p>
            <p style="margin:0 0 24px; color:#1d1d1f; font-size:16px; line-height:1.5;">${shifts.length > 1 ? `<strong>${shifts.length} shifts</strong> have` : 'A new shift has'} been scheduled for you. Review the details below.</p>

            <!-- Summary Card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7; border-radius:12px; margin:0 0 24px;">
              <tr><td style="padding:20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:#86868b; font-size:12px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;">Office</td>
                    <td style="color:#86868b; font-size:12px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px; text-align:center;">Hourly Rate</td>
                    <td style="color:#86868b; font-size:12px; font-weight:500; text-transform:uppercase; letter-spacing:0.5px; text-align:right;">Total Shifts</td>
                  </tr>
                  <tr>
                    <td style="color:#1d1d1f; font-size:17px; font-weight:600; padding-top:4px;">${clinicId}</td>
                    <td style="color:#1d1d1f; font-size:17px; font-weight:600; padding-top:4px; text-align:center;">$${hourlyRate.toFixed(2)}</td>
                    <td style="color:#1d1d1f; font-size:17px; font-weight:600; padding-top:4px; text-align:right;">${shifts.length}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <!-- Shifts Table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px; overflow:hidden; border:1px solid #e5e5e7;">
              <thead>
                <tr style="background:#f5f5f7;">
                  <th style="padding:10px 16px; text-align:left; font-size:12px; font-weight:600; color:#86868b; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #e5e5e7;">Date</th>
                  <th style="padding:10px 16px; text-align:left; font-size:12px; font-weight:600; color:#86868b; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #e5e5e7;">Time</th>
                  <th style="padding:10px 16px; text-align:right; font-size:12px; font-weight:600; color:#86868b; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #e5e5e7;">Hours</th>
                  <th style="padding:10px 16px; text-align:right; font-size:12px; font-weight:600; color:#86868b; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #e5e5e7;">Pay</th>
                </tr>
              </thead>
              <tbody>
                ${shiftRows}
                <!-- Totals Row -->
                <tr style="background:#1d1d1f;">
                  <td colspan="2" style="padding:14px 16px; color:#ffffff; font-size:14px; font-weight:600;">TOTAL</td>
                  <td style="padding:14px 16px; color:#ffffff; font-size:14px; font-weight:600; text-align:right;">${totalHoursAll.toFixed(2)}</td>
                  <td style="padding:14px 16px; color:#ffffff; font-size:16px; font-weight:700; text-align:right;">$${totalPayAll.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:28px 0 8px;">
                <a href="https://todaysdentalinsights.com/" style="display:inline-block; background:#1d1d1f; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:980px; font-size:15px; font-weight:500; letter-spacing:-0.2px;">View Your Schedule</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 28px; border-top:1px solid #e5e5e7; text-align:center;">
            <p style="margin:0; color:#86868b; font-size:12px; line-height:1.6;">This is an automated notification from ${APP_NAME}.<br>Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Plain text fallback
  const shiftLines = shifts.map((s: any) => {
    const shiftDate = new Date(s.startTime).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    const startLocal = new Date(s.startTime).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const endLocal = new Date(s.endTime).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    return `  ${shiftDate}: ${startLocal} – ${endLocal} (${(s.totalHours || 0).toFixed(2)} hrs, $${(s.pay || 0).toFixed(2)})`;
  }).join('\n');

  const textBody = `Shifts Scheduled\n\nHello ${staffName},\n\n${shifts.length} shift(s) have been scheduled for you at ${clinicId}.\n\nShift Details:\n${shiftLines}\n\nTotal Hours: ${totalHoursAll.toFixed(2)}\nTotal Pay: $${totalPayAll.toFixed(2)}\nHourly Rate: $${hourlyRate.toFixed(2)}\n\nView your schedule: https://todaysdentalinsights.com/\n\nThis is an automated notification from ${APP_NAME}.`;

  const command = new SendEmailCommand({
    Destination: { ToAddresses: [recipientEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: bodyHtml },
          Text: { Data: textBody },
        },
      },
    },
    FromEmailAddress: FROM_EMAIL,
  });

  try {
    await ses.send(command);
    console.log(`Multi-shift email sent to ${recipientEmail} for ${shifts.length} shifts`);
  } catch (e) {
    console.error(`Failed to send multi-shift email to ${recipientEmail}:`, e);
  }
}

async function updateShift(shiftId: string, body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { Item: existingShift } = await ddb.send(new GetCommand({
    TableName: SHIFTS_TABLE,
    Key: { shiftId }
  }));
  if (!existingShift) {
    return httpErr(404, "Shift not found");
  }
  if (!hasClinicAccess(allowedClinics, existingShift.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  const clinicTimezone = await getClinicTimezone(existingShift.clinicId);
  const rawStartTime = body.startTime || existingShift.startTime;
  const rawEndTime = body.endTime || existingShift.endTime;
  const startTime = normalizeToUtcIso(rawStartTime, clinicTimezone);
  const endTime = normalizeToUtcIso(rawEndTime, clinicTimezone);

  const shiftDate = new Date(startTime);
  const isBlocked = await isDateBlocked(existingShift.staffId, shiftDate);
  if (isBlocked) {
    return httpErr(400, "Cannot update shift: Staff has approved leave on this date");
  }

  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  const totalHours = parseFloat(((endMs - startMs) / (1000 * 60 * 60)).toFixed(2));

  // let hourlyRate = existingShift.hourlyRate || 0;
  // if (!hourlyRate) {
  //   try {
  //     const { Item: staffInfo } = await ddb.send(new GetCommand({
  //       TableName: STAFF_INFO_TABLE,
  //       Key: { email: existingShift.staffId, clinicId: existingShift.clinicId },
  //     }));
  //     if (staffInfo) {
  //       hourlyRate = staffInfo.hourlyRate || 0;
  //     }
  //   } catch (err) {
  //     console.error("StaffClinicInfo lookup failed:", err);
  //   }
  // }
  // --- START UPDATE HERE ---
  let hourlyRate = existingShift.hourlyRate || 0;
  if (!hourlyRate) {
    try {
      const { Item: staffInfo } = await ddb.send(new GetCommand({
        TableName: STAFF_INFO_TABLE,
        Key: { email: existingShift.staffId, clinicId: existingShift.clinicId },
      }));
      if (staffInfo) {
        // FIX: Check 'hourlyPay' first
        hourlyRate = parseFloat(String(staffInfo.hourlyPay || staffInfo.hourlyRate || 0));
      }
    } catch (err) {
      console.error("StaffClinicInfo lookup failed:", err);
    }
  }
  const pay = parseFloat((totalHours * hourlyRate).toFixed(2));

  const updatedShift = {
    ...existingShift,
    ...body,
    startTime,
    endTime,
    timezone: clinicTimezone, // Ensure timezone is stored/updated
    totalHours,
    pay,
    hourlyRate
  };

  await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: updatedShift }));

  if (userPerms) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'UPDATE',
      resource: 'SHIFT',
      resourceId: shiftId,
      clinicId: existingShift.clinicId,
      before: AuditLogger.sanitizeForAudit(existingShift),
      after: AuditLogger.sanitizeForAudit(updatedShift),
      metadata: {
        ...AuditLogger.createShiftMetadata(updatedShift),
        actionType: 'Shift Updated',
      },
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ shiftId, message: "Shift updated successfully" });
}

async function deleteShift(shiftId: string, allowedClinics: Set<string>, userPerms?: UserPermissions, isAdmin?: boolean, event?: APIGatewayProxyEvent) {
  const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));
  if (!Item) return httpErr(404, "Shift not found");

  if (!hasClinicAccess(allowedClinics, Item.clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  await ddb.send(new DeleteCommand({ TableName: SHIFTS_TABLE, Key: { shiftId } }));

  if (userPerms) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'DELETE',
      resource: 'SHIFT',
      resourceId: shiftId,
      clinicId: Item.clinicId,
      before: AuditLogger.sanitizeForAudit(Item),
      metadata: {
        ...AuditLogger.createShiftMetadata(Item),
        actionType: 'Shift Deleted',
      },
      ...AuditLogger.extractRequestContext(event),
    });
  }

  // Send shift cancellation email to staff
  try {
    const staffEmail = Item.staffId;
    let staffName = staffEmail;
    try {
      const { Item: staffUser } = await ddb.send(new GetCommand({
        TableName: STAFF_USER_TABLE,
        Key: { email: staffEmail.toLowerCase() },
      }));
      if (staffUser) {
        staffName = `${staffUser.givenName || ''} ${staffUser.familyName || ''}`.trim() || staffEmail;
      }
    } catch (lookupErr) {
      console.warn('Could not look up staff name for cancellation email:', lookupErr);
    }

    const clinicTimezone = await getClinicTimezone(Item.clinicId);
    await sendShiftCancelledEmail(staffEmail, staffName, Item, clinicTimezone);
  } catch (emailErr) {
    console.error('Failed to send shift cancellation email (shift still deleted):', emailErr);
  }

  return httpOk({ message: "Shift deleted successfully" });
}

async function rejectShift(shiftId: string, userPerms: UserPermissions, event?: APIGatewayProxyEvent) {
  const { Item: shift } = await ddb.send(new GetCommand({
    TableName: SHIFTS_TABLE,
    Key: { shiftId }
  }));

  if (!shift) {
    return httpErr(404, "Shift not found");
  }

  if (shift.staffId !== userPerms.email) {
    return httpErr(403, "Forbidden: Can only reject your own shifts");
  }

  const before = { ...shift };

  await ddb.send(new UpdateCommand({
    TableName: SHIFTS_TABLE,
    Key: { shiftId },
    UpdateExpression: 'set #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': 'rejected' }
  }));

  await auditLogger.log({
    userId: userPerms.email,
    userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
    userRole: AuditLogger.getUserRole(userPerms),
    action: 'UPDATE',
    resource: 'SHIFT',
    resourceId: shiftId,
    clinicId: shift.clinicId,
    before: AuditLogger.sanitizeForAudit(before),
    after: { status: 'rejected' },
    metadata: {
      ...AuditLogger.createShiftMetadata(shift),
      actionType: 'Shift Rejected By Staff',
    },
    ...AuditLogger.extractRequestContext(event),
  });

  // Send rejection notification email to admin who scheduled this shift
  try {
    // Get staff name for the email
    const staffName = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;
    const clinicTimezone = await getClinicTimezone(shift.clinicId);

    // Find the admin who created this shift by querying audit logs
    const auditResult = await auditLogger.queryByResource('SHIFT' as AuditResource, shiftId, { limit: 10 });
    const createEntry = auditResult.auditLogs.find((log: any) => log.action === 'CREATE');

    if (createEntry && createEntry.userId) {
      const adminEmail = createEntry.userId;
      const adminName = createEntry.userName || adminEmail;
      await sendShiftRejectedToAdminEmail(adminEmail, adminName, staffName, shift, clinicTimezone);
    } else {
      console.warn('Could not find admin who created shift for rejection email, shiftId:', shiftId);
    }
  } catch (emailErr) {
    console.error('Failed to send shift rejection email to admin (shift still rejected):', emailErr);
  }

  return httpOk({ message: "Shift rejected successfully" });
}

// ========================================
// COPY WEEK SCHEDULE - FIXED PARAMETER NAMES
// ========================================

async function copyWeekSchedule(body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  // FIXED: Accept both old and new parameter names for backward compatibility
  const sourceStartDate = body.sourceWeekStart || body.sourceStartDate;
  const targetStartDate = body.targetWeekStart || body.targetStartDate;
  const { clinicId } = body;

  if (!sourceStartDate || !targetStartDate || !clinicId) {
    return httpErr(400, "sourceWeekStart (or sourceStartDate), targetWeekStart (or targetStartDate), and clinicId are required");
  }

  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  // Calculate week boundaries
  const sourceStart = new Date(sourceStartDate + 'T00:00:00Z');
  const sourceEnd = new Date(sourceStart);
  sourceEnd.setDate(sourceEnd.getDate() + 6);
  sourceEnd.setHours(23, 59, 59, 999);

  const targetStart = new Date(targetStartDate + 'T00:00:00Z');

  // Fetch source week shifts
  const { Items: sourceShifts } = await ddb.send(new QueryCommand({
    TableName: SHIFTS_TABLE,
    IndexName: 'byClinicAndDate',
    KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :startDate AND :endDate',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':startDate': sourceStart.toISOString(),
      ':endDate': sourceEnd.toISOString(),
    }
  }));

  if (!sourceShifts || sourceShifts.length === 0) {
    return httpErr(404, "No shifts found in the source week");
  }

  // FIXED: Filter out rejected and cancelled shifts - they should NOT be copied
  const activeSourceShifts = sourceShifts.filter((shift: any) =>
    shift.status !== 'rejected' && shift.status !== 'cancelled'
  );

  if (activeSourceShifts.length === 0) {
    return httpErr(404, "No active (non-rejected/cancelled) shifts found in the source week to copy");
  }

  const timeDiff = targetStart.getTime() - sourceStart.getTime();
  const newShifts: any[] = [];
  const skippedStaff: string[] = [];
  const skippedRejected = sourceShifts.length - activeSourceShifts.length;

  const clinicTimezone = await getClinicTimezone(clinicId);

  for (const shift of activeSourceShifts) {
    const newStartTime = new Date(new Date(shift.startTime).getTime() + timeDiff);
    const newEndTime = new Date(new Date(shift.endTime).getTime() + timeDiff);

    // Check if staff has approved leave on the new date
    const isBlocked = await isDateBlocked(shift.staffId, newStartTime);
    if (isBlocked) {
      console.log(`⚠️ Skipping shift for ${shift.staffId} - has approved leave on ${newStartTime.toISOString()}`);
      if (!skippedStaff.includes(shift.staffId)) {
        skippedStaff.push(shift.staffId);
      }
      continue;
    }

    const newShiftId = uuidv4();
    const newShift = {
      ...shift,
      shiftId: newShiftId,
      startTime: newStartTime.toISOString(),
      endTime: newEndTime.toISOString(),
      // FIXED: Reset status to 'scheduled' for new copies
      status: 'scheduled',
    };

    newShifts.push(newShift);
  }

  // Batch write new shifts
  if (newShifts.length > 0) {
    const batchSize = 25; // DynamoDB limit
    for (let i = 0; i < newShifts.length; i += batchSize) {
      const batch = newShifts.slice(i, i + batchSize);
      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [SHIFTS_TABLE]: batch.map(shift => ({
            PutRequest: { Item: shift }
          }))
        }
      }));
    }

    // FIXED: Send email notifications to each staff member for their new shift
    console.log(`📧 Sending email notifications for ${newShifts.length} copied shifts...`);
    for (const newShift of newShifts) {
      try {
        // Get staff email and name
        const { Item: staffUser } = await ddb.send(new GetCommand({
          TableName: STAFF_USER_TABLE,
          Key: { email: newShift.staffId.toLowerCase() },
        }));

        if (staffUser && staffUser.email) {
          const staffName = `${staffUser.givenName || ''} ${staffUser.familyName || ''}`.trim() || newShift.staffId;
          await sendShiftNotificationEmail(staffUser.email, newShift, staffName, clinicTimezone);
          console.log(`✅ Email sent to ${staffUser.email} for shift on ${newShift.startTime}`);
        }
      } catch (emailError) {
        console.error(`⚠️ Failed to send email for shift ${newShift.shiftId}:`, emailError);
        // Continue with other emails even if one fails
      }
    }

    // Audit log
    if (userPerms) {
      await auditLogger.log({
        userId: userPerms.email,
        userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
        userRole: AuditLogger.getUserRole(userPerms),
        action: 'CREATE',
        resource: 'SHIFT',
        resourceId: 'BATCH_COPY',
        clinicId: clinicId,
        metadata: {
          sourceWeek: sourceStartDate,
          targetWeek: targetStartDate,
          copiedShifts: newShifts.length,
          skippedDueToLeave: activeSourceShifts.length - newShifts.length,
          skippedDueToRejected: skippedRejected,
          actionType: 'Copy Week Schedule',
        },
        ...AuditLogger.extractRequestContext(event),
      });
    }
  }

  return httpOk({
    message: `Successfully copied ${newShifts.length} shifts. ${activeSourceShifts.length - newShifts.length} skipped (leave). ${skippedRejected} rejected/cancelled shifts were not copied.`,
    shiftsCreated: newShifts.length,
    skippedShifts: activeSourceShifts.length - newShifts.length,
    skippedRejected: skippedRejected,
    skippedStaff: skippedStaff
  });
}

// ========================================
// LEAVE MANAGEMENT
// ========================================

async function getLeave(userPerms: any, isAdmin: boolean) {
  if (isAdmin) {
    const { Items } = await ddb.send(new ScanCommand({ TableName: LEAVE_TABLE }));
    return httpOk({ leaveRequests: Items || [] });
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

  // FIXED: Look up all clinics where this staff member works
  let staffClinicIds: string[] = [];
  try {
    const { Items: staffInfoRecords } = await ddb.send(new QueryCommand({
      TableName: STAFF_INFO_TABLE,
      IndexName: 'byEmail',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': staffId }
    }));

    if (staffInfoRecords && staffInfoRecords.length > 0) {
      staffClinicIds = staffInfoRecords.map((record: any) => record.clinicId).filter(Boolean);
    }
  } catch (lookupError) {
    console.warn('Could not look up staff clinics for leave request:', lookupError);
  }

  // Fall back to userPerms clinics if lookup fails
  if (staffClinicIds.length === 0 && userPerms?.clinicRoles) {
    staffClinicIds = userPerms.clinicRoles.map((cr: any) => cr.clinicId).filter(Boolean);
  }

  const leaveId = uuidv4();
  const leaveRequest = {
    leaveId,
    staffId,
    startDate,
    endDate,
    reason,
    status: 'pending',
    // FIXED: Store clinicIds in leave record for clinic-wise queries
    clinicIds: staffClinicIds,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));

  // FIXED: Log audit entry to each clinic where staff works
  if (userPerms) {
    const clinicsToLog = staffClinicIds.length > 0
      ? staffClinicIds
      : [userPerms.clinicRoles?.[0]?.clinicId].filter(Boolean);

    for (const clinicIdForAudit of clinicsToLog) {
      await auditLogger.log({
        userId: userPerms.email,
        userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
        userRole: AuditLogger.getUserRole(userPerms),
        action: 'CREATE',
        resource: 'LEAVE',
        resourceId: leaveId,
        clinicId: clinicIdForAudit,
        after: AuditLogger.sanitizeForAudit(leaveRequest),
        metadata: {
          ...AuditLogger.createLeaveMetadata(leaveRequest),
          actionType: 'Leave Request Created',
          affectedClinics: staffClinicIds,
        },
        ...AuditLogger.extractRequestContext(event),
      });
    }
  }

  return httpOk({ leaveId, message: "Leave request submitted", clinicIds: staffClinicIds });
}

async function deleteLeave(leaveId: string, userPerms: UserPermissions, isAdmin: boolean, event?: APIGatewayProxyEvent) {
  const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
  if (!Item) return httpErr(404, "Leave request not found");

  if (!isAdmin && Item.staffId !== userPerms.email) {
    return httpErr(403, "Forbidden");
  }

  await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));

  // FIXED: Determine clinics to log to - use stored clinicIds, or lookup from StaffClinicInfo
  let clinicsToLog: string[] = Array.isArray(Item.clinicIds) ? Item.clinicIds : [];

  if (clinicsToLog.length === 0) {
    // Fall back to lookup from StaffClinicInfo
    try {
      const { Items: staffInfoRecords } = await ddb.send(new QueryCommand({
        TableName: STAFF_INFO_TABLE,
        IndexName: 'byEmail',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': Item.staffId }
      }));

      if (staffInfoRecords && staffInfoRecords.length > 0) {
        clinicsToLog = staffInfoRecords.map((record: any) => record.clinicId).filter(Boolean);
      }
    } catch (lookupError) {
      console.warn('Could not look up staff clinics for delete audit:', lookupError);
    }
  }

  // Final fallback to actor's clinic
  if (clinicsToLog.length === 0) {
    const actorClinicId = userPerms.clinicRoles?.[0]?.clinicId;
    if (actorClinicId) clinicsToLog = [actorClinicId];
  }

  // Log audit to each clinic
  for (const clinicIdForAudit of clinicsToLog) {
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'DELETE',
      resource: 'LEAVE',
      resourceId: leaveId,
      clinicId: clinicIdForAudit,
      before: AuditLogger.sanitizeForAudit(Item),
      metadata: {
        ...AuditLogger.createLeaveMetadata(Item),
        actionType: 'Leave Request Deleted',
        affectedClinics: clinicsToLog,
      },
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ message: "Leave request deleted" });
}

// ========================================
// APPROVE LEAVE - ALREADY WORKING CORRECTLY (DELETES SHIFTS)
// ========================================

async function approveLeave(leaveId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, approvalNotes?: string) {
  console.log('🔄 Starting approveLeave for leaveId:', leaveId);

  try {
    if (!leaveId || leaveId === 'undefined') {
      console.error('❌ Invalid leaveId:', leaveId);
      return httpErr(400, "Invalid leave ID");
    }

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
    let overlappingShifts: any[] = [];
    if (leave.startDate && leave.endDate) {
      try {
        overlappingShifts = await getOverlappingShifts(
          leave.staffId,
          leave.startDate,
          leave.endDate
        );

        console.log(`📊 Found ${overlappingShifts.length} overlapping shifts:`,
          overlappingShifts.map(s => ({ shiftId: s.shiftId, startTime: s.startTime }))
        );
      } catch (shiftError) {
        console.error('⚠️ Error finding overlapping shifts (continuing anyway):', shiftError);
      }
    } else {
      console.warn('⚠️ Leave request missing dates, skipping shift cancellation');
    }

    // DELETE overlapping shifts (not just cancel - actually remove from table)
    if (overlappingShifts.length > 0) {
      try {
        console.log(`🔄 DELETING ${overlappingShifts.length} overlapping shift(s) from table...`);

        const deletePromises = overlappingShifts.map(async (shift) => {
          console.log('🗑️ Deleting shift:', shift.shiftId, 'for date:', shift.startTime);

          await ddb.send(new DeleteCommand({
            TableName: SHIFTS_TABLE,
            Key: { shiftId: shift.shiftId }
          }));

          console.log('✅ Shift deleted from table:', shift.shiftId);

          // Audit log for each deleted shift
          if (userPerms) {
            await auditLogger.log({
              userId: userPerms.email,
              userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
              userRole: AuditLogger.getUserRole(userPerms),
              action: 'DELETE',
              resource: 'SHIFT',
              resourceId: shift.shiftId,
              clinicId: shift.clinicId,
              before: AuditLogger.sanitizeForAudit(shift),
              reason: `Shift deleted due to approved leave request (${leaveId})`,
              metadata: {
                ...AuditLogger.createShiftMetadata(shift),
                leaveId: leaveId,
                leaveStartDate: leave.startDate,
                leaveEndDate: leave.endDate,
                actionType: 'Shift Deleted (Leave Approved)',
                staffId: shift.staffId,
                shiftDate: shift.startTime,
              },
              ...AuditLogger.extractRequestContext(event),
            });
          }
        });

        await Promise.all(deletePromises);
        console.log('✅ All overlapping shifts DELETED from table and logged');
      } catch (deleteError) {
        console.error('⚠️ Error deleting shifts (leave still approved):', deleteError);
      }
    }

    // Audit log for leave approval
    if (userPerms) {
      // FIXED: Combine shift clinics + stored leave clinicIds for comprehensive audit logging
      const shiftClinicIds = overlappingShifts.map(s => s.clinicId).filter(Boolean);
      const storedClinicIds = Array.isArray(leave.clinicIds) ? leave.clinicIds : [];
      const allClinicIds = [...new Set([...shiftClinicIds, ...storedClinicIds])];

      // Fall back to looking up from StaffClinicInfo if no clinics found
      let clinicsToLog = allClinicIds.length > 0 ? allClinicIds : [];
      if (clinicsToLog.length === 0) {
        try {
          const { Items: staffInfoRecords } = await ddb.send(new QueryCommand({
            TableName: STAFF_INFO_TABLE,
            IndexName: 'byEmail',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': leave.staffId }
          }));
          if (staffInfoRecords && staffInfoRecords.length > 0) {
            clinicsToLog = staffInfoRecords.map((record: any) => record.clinicId).filter(Boolean);
          }
        } catch (lookupError) {
          console.warn('Could not look up staff clinics for approve audit:', lookupError);
        }
      }

      // Final fallback to actor's clinic
      if (clinicsToLog.length === 0) {
        const actorClinicId = userPerms.clinicRoles?.[0]?.clinicId;
        if (actorClinicId) clinicsToLog = [actorClinicId];
      }

      for (const clinicIdForAudit of clinicsToLog) {
        await auditLogger.log({
          userId: userPerms.email,
          userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
          userRole: AuditLogger.getUserRole(userPerms),
          action: 'APPROVE',
          resource: 'LEAVE',
          resourceId: leaveId,
          clinicId: clinicIdForAudit,
          before: { status: leave.status, staffId: leave.staffId },
          after: { status: 'approved' },
          reason: approvalNotes,
          metadata: {
            ...AuditLogger.createLeaveMetadata(leave, { cancelledShifts: overlappingShifts.length }),
            actionBy: userPerms.email,
            actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
            actionType: 'Leave Approved',
            requestedBy: leave.staffId,
            affectedClinics: clinicsToLog,
            deletedShiftCount: overlappingShifts.length,
          },
          ...AuditLogger.extractRequestContext(event),
        });
      }
    }

    // Send leave approval email to staff + shift cancellation emails
    try {
      let staffName = leave.staffId;
      try {
        const { Item: staffUser } = await ddb.send(new GetCommand({
          TableName: STAFF_USER_TABLE,
          Key: { email: leave.staffId.toLowerCase() },
        }));
        if (staffUser) {
          staffName = `${staffUser.givenName || ''} ${staffUser.familyName || ''}`.trim() || leave.staffId;
        }
      } catch (lookupErr) {
        console.warn('Could not look up staff name for leave approval email:', lookupErr);
      }

      // Send leave approval email
      await sendLeaveStatusNotificationEmail(
        leave.staffId,
        staffName,
        'approved',
        leave.startDate,
        leave.endDate,
        approvalNotes,
        overlappingShifts.length
      );

      // Send individual shift cancellation emails for each deleted shift
      if (overlappingShifts.length > 0) {
        for (const shift of overlappingShifts) {
          try {
            const clinicTimezone = await getClinicTimezone(shift.clinicId);
            await sendShiftCancelledEmail(
              leave.staffId,
              staffName,
              shift,
              clinicTimezone,
              `Cancelled due to approved leave (${leave.startDate} to ${leave.endDate})`
            );
          } catch (shiftEmailErr) {
            console.warn('Failed to send shift cancellation email for shift:', shift.shiftId, shiftEmailErr);
          }
        }
      }
    } catch (emailErr) {
      console.error('Failed to send leave approval emails (leave still approved):', emailErr);
    }

    const response = {
      leaveId,
      status: 'approved',
      cancelledShifts: overlappingShifts.length,
      message: overlappingShifts.length > 0
        ? `Leave approved. ${overlappingShifts.length} overlapping shift(s) have been automatically deleted.`
        : 'Leave approved successfully. No shifts were affected.'
    };

    console.log('✅ Returning response:', response);
    return httpOk(response);

  } catch (error: any) {
    console.error('❌ Error in approveLeave:', error);
    return httpErr(500, `Failed to approve leave: ${error?.message || 'Unknown error'}`);
  }
}

async function updateLeaveStatus(leaveId: string, status: 'approved' | 'denied', userPerms?: UserPermissions, event?: APIGatewayProxyEvent, reason?: string) {
  const { Item: leave } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));
  if (!leave) {
    return httpErr(404, "Leave request not found");
  }

  const previousStatus = leave?.status;

  await ddb.send(new UpdateCommand({
    TableName: LEAVE_TABLE,
    Key: { leaveId },
    UpdateExpression: 'set #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status }
  }));

  if (userPerms) {
    // FIXED: Use stored clinicIds from leave record first, then fall back to StaffClinicInfo lookup
    let clinicsToLog: string[] = Array.isArray(leave.clinicIds) ? leave.clinicIds : [];

    // If no stored clinicIds, look up from StaffClinicInfo
    if (clinicsToLog.length === 0) {
      try {
        const { Items: staffInfoRecords } = await ddb.send(new QueryCommand({
          TableName: STAFF_INFO_TABLE,
          IndexName: 'byEmail',
          KeyConditionExpression: 'email = :email',
          ExpressionAttributeValues: { ':email': leave.staffId }
        }));

        if (staffInfoRecords && staffInfoRecords.length > 0) {
          clinicsToLog = staffInfoRecords.map((record: any) => record.clinicId).filter(Boolean);
        }
      } catch (lookupError) {
        console.warn('Could not look up staff clinics for audit:', lookupError);
      }
    }

    // Final fallback to actor's clinic
    if (clinicsToLog.length === 0) {
      const actorClinicId = userPerms.clinicRoles?.[0]?.clinicId;
      if (actorClinicId) clinicsToLog = [actorClinicId];
    }

    // Log to each relevant clinic
    for (const clinicIdForAudit of clinicsToLog) {
      await auditLogger.log({
        userId: userPerms.email,
        userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
        userRole: AuditLogger.getUserRole(userPerms),
        // FIXED: Use 'DENY' for denied status to match what the frontend expects
        action: status === 'approved' ? 'APPROVE' : 'DENY',
        resource: 'LEAVE',
        resourceId: leaveId,
        clinicId: clinicIdForAudit,
        before: { status: previousStatus, staffId: leave.staffId },
        after: { status },
        reason,
        metadata: {
          ...AuditLogger.createLeaveMetadata(leave),
          actionType: status === 'approved' ? 'Leave Approved' : 'Leave Denied',
          actionBy: userPerms.email,
          actionByName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim(),
          requestedBy: leave.staffId,
          affectedClinics: clinicsToLog,
        },
        ...AuditLogger.extractRequestContext(event),
      });
    }
  }

  // Send leave status email to staff (only for denied — approved uses approveLeave())
  if (status === 'denied') {
    try {
      let staffName = leave.staffId;
      try {
        const { Item: staffUser } = await ddb.send(new GetCommand({
          TableName: STAFF_USER_TABLE,
          Key: { email: leave.staffId.toLowerCase() },
        }));
        if (staffUser) {
          staffName = `${staffUser.givenName || ''} ${staffUser.familyName || ''}`.trim() || leave.staffId;
        }
      } catch (lookupErr) {
        console.warn('Could not look up staff name for leave denial email:', lookupErr);
      }

      await sendLeaveStatusNotificationEmail(
        leave.staffId,
        staffName,
        'denied',
        leave.startDate,
        leave.endDate,
        reason
      );
    } catch (emailErr) {
      console.error('Failed to send leave denial email (leave still denied):', emailErr);
    }
  }

  return httpOk({ leaveId, status, message: `Leave request ${status}` });
}

// ========================================
// AUDIT TRAIL QUERY
// ========================================

// =====================================================
// HR CONFIG ENDPOINT
// =====================================================

// Advance Pay - No business rule restrictions (all limits removed)
// Previously enforced limits have been disabled


/**
 * Get HR module configuration
 * Returns business rule constants for the frontend to consume
 * This is the single source of truth - frontend should fetch these values
 */
function getHrConfig() {
  return httpOk({
    advancePay: {
      // No restrictions - all limits removed
      maxAmountPerRequest: null,
      maxTotalOutstanding: null,
      maxPendingRequests: null,
      minTenureDays: 0,
      minDaysBetweenRequests: 0,
    },
    // Future: Add other module configs here
    // leave: { ... },
    // shifts: { ... },
  });
}

// =====================================================
// ADVANCE PAY FUNCTIONS
// =====================================================

interface AdvancePayRequest {
  advanceId: string;
  staffId: string;
  staffName?: string;
  clinicId: string;
  amount: number;
  reason?: string;
  // Extended status to support admin-initiated workflow
  status: 'pending' | 'approved' | 'denied' | 'paid' | 'pending_staff_approval';
  createdAt: string;
  updatedAt?: string;
  // Request type and initiator tracking
  requestType?: 'staff_initiated' | 'admin_initiated';
  requestedBy?: string; // Email of who created the request
  // Admin approval fields (for staff-initiated requests)
  approvedBy?: string;
  approvedAt?: string;
  deniedBy?: string;
  deniedAt?: string;
  denialReason?: string;
  approvalNotes?: string;
  // Staff approval fields (for admin-initiated requests)
  staffApprovedAt?: string;
  staffApprovalNotes?: string;
  // Payment fields
  paymentDate?: string;
  paymentReference?: string;
  paidBy?: string;
  // Soft delete fields
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

/**
 * Get advance pay requests
 * - Admin: Gets all requests for their clinics (optionally filtered by status)
 * - Staff: Gets only their own requests
 * 
 * Note: Filters out soft-deleted records
 */
async function getAdvancePayRequests(
  userPerms: UserPermissions,
  isAdmin: boolean,
  allowedClinics: Set<string>
) {
  try {
    if (isAdmin) {
      // Check if super admin (has access to all clinics - indicated by '*' in allowedClinics)
      if (allowedClinics.has('*')) {
        // Super Admin: Scan ALL advance pay requests
        console.log('🔑 Super Admin detected - scanning all advance pay requests');
        const { Items } = await ddb.send(new ScanCommand({
          TableName: ADVANCE_PAY_TABLE,
          FilterExpression: 'attribute_not_exists(isDeleted) OR isDeleted = :false',
          ExpressionAttributeValues: { ':false': false },
        }));

        const allRequests = (Items || []) as AdvancePayRequest[];

        // Sort by createdAt descending
        allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        console.log(`📋 Found ${allRequests.length} advance pay requests for super admin`);
        return httpOk({ advancePayRequests: allRequests });
      }

      // Regular Admin: Fetch requests for specific allowed clinics IN PARALLEL for performance
      const clinicIds = Array.from(allowedClinics);
      console.log(`👤 Admin - querying advance pay for clinics: ${clinicIds.join(', ')}`);

      // Execute all clinic queries in parallel using Promise.allSettled for resilience
      const queryPromises = clinicIds.map(clinicId =>
        ddb.send(new QueryCommand({
          TableName: ADVANCE_PAY_TABLE,
          IndexName: 'byClinic',
          KeyConditionExpression: 'clinicId = :clinicId',
          FilterExpression: 'attribute_not_exists(isDeleted) OR isDeleted = :false',
          ExpressionAttributeValues: { ':clinicId': clinicId, ':false': false },
          ScanIndexForward: false, // Most recent first
        })).then(result => ({ clinicId, items: result.Items || [] }))
          .catch(error => {
            console.error(`Error fetching advance pay for clinic ${clinicId}:`, error);
            return { clinicId, items: [] };
          })
      );

      const results = await Promise.all(queryPromises);

      // Flatten all results
      const allRequests: AdvancePayRequest[] = results.flatMap(r => r.items as AdvancePayRequest[]);

      // Sort by createdAt descending
      allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      console.log(`📋 Found ${allRequests.length} advance pay requests for admin`);
      return httpOk({ advancePayRequests: allRequests });
    } else {
      // Staff: Only their own requests
      const { Items } = await ddb.send(new QueryCommand({
        TableName: ADVANCE_PAY_TABLE,
        IndexName: 'byStaff',
        KeyConditionExpression: 'staffId = :staffId',
        FilterExpression: 'attribute_not_exists(isDeleted) OR isDeleted = :false',
        ExpressionAttributeValues: { ':staffId': userPerms.email, ':false': false },
        ScanIndexForward: false,
      }));

      return httpOk({ advancePayRequests: Items || [] });
    }
  } catch (error: any) {
    console.error('Error fetching advance pay requests:', error);
    return httpErr(500, `Failed to fetch advance pay requests: ${error.message}`);
  }
}



/**
 * Create a new advance pay request (Staff only)
 * 
 * Note: All business rule restrictions have been removed.
 * Only basic validation (positive amount, clinic access) is enforced.
 */
async function createAdvancePayRequest(
  userPerms: UserPermissions,
  body: any,
  allowedClinics: Set<string>,
  event?: APIGatewayProxyEvent
) {
  const { amount, reason, clinicId } = body;

  // Basic validation - only require positive amount
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return httpErr(400, "Valid amount (positive number) is required");
  }

  if (!clinicId) {
    return httpErr(400, "Clinic ID is required");
  }

  // Verify user has access to this clinic
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  try {

    const advanceId = `adv_${uuidv4()}`;
    const now = new Date().toISOString();
    const staffName = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    const advancePayRequest: AdvancePayRequest = {
      advanceId,
      staffId: userPerms.email,
      staffName,
      clinicId,
      amount,
      reason: reason || undefined, // Store undefined instead of empty string for cleaner data
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(new PutCommand({
      TableName: ADVANCE_PAY_TABLE,
      Item: advancePayRequest,
    }));

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName: staffName,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'CREATE',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId,
      after: { amount, status: 'pending', reason: reason || undefined },
      ...AuditLogger.extractRequestContext(event),
    });

    return httpOk({ success: true, advancePayRequest });
  } catch (error: any) {
    console.error('Error creating advance pay request:', error);
    return httpErr(500, `Failed to create advance pay request: ${error.message}`);
  }
}

/**
 * Admin-only: Create a record for an advance pay that was already given to a staff member
 * 
 * This is different from createAdvancePayRequest (staff self-service):
 * - Admin specifies the staff member (staffId)
 * - No tenure/frequency/pending limits enforced (already given, just recording)
 * - Record is created directly as 'paid' status
 * - paymentDate and paymentReference are recorded
 * 
 * Use case: Admin gave a cash advance to staff outside the system, now recording it
 */
async function adminCreateAdvancePayRecord(
  userPerms: UserPermissions,
  body: any,
  allowedClinics: Set<string>,
  event?: APIGatewayProxyEvent
) {
  const { staffId, amount, reason, clinicId, paymentDate, paymentReference } = body;

  // Basic validation
  if (!staffId || typeof staffId !== 'string') {
    return httpErr(400, "Staff ID is required");
  }

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return httpErr(400, "Valid amount (positive number) is required");
  }

  // No maximum amount validation - restrictions removed

  if (!clinicId) {
    return httpErr(400, "Clinic ID is required");
  }

  // Verify admin has access to this clinic
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  try {
    // Lookup staff name for display purposes
    const { Item: staffUser } = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: staffId.toLowerCase() },
    }));

    if (!staffUser) {
      return httpErr(404, "Staff member not found. Please verify the email address.");
    }

    const staffName = `${staffUser.givenName || ''} ${staffUser.familyName || ''}`.trim() || staffId;
    const adminName = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    const advanceId = `adv_${uuidv4()}`;
    const now = new Date().toISOString();

    // Use provided payment date or default to now
    const effectivePaymentDate = paymentDate || now;

    const advancePayRequest: AdvancePayRequest = {
      advanceId,
      staffId: staffId.toLowerCase(),
      staffName,
      clinicId,
      amount,
      reason: reason || undefined,
      status: 'paid', // Already given, so mark as paid directly
      createdAt: now,
      updatedAt: now,
      // Approval chain: record admin as both approver and payer since it's an immediate record
      approvedBy: adminName,
      approvedAt: now,
      paidBy: adminName,
      paymentDate: effectivePaymentDate,
      paymentReference: paymentReference || `Admin record by ${adminName}`,
    };

    await ddb.send(new PutCommand({
      TableName: ADVANCE_PAY_TABLE,
      Item: advancePayRequest,
    }));

    // Audit log - Record this as an admin-created entry
    await auditLogger.log({
      userId: userPerms.email,
      userName: adminName,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'CREATE',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId,
      after: {
        amount,
        status: 'paid',
        staffId: staffId.toLowerCase(),
        staffName,
        reason: reason || undefined,
        adminRecorded: true, // Flag to indicate this was admin-recorded, not staff-requested
        paymentDate: effectivePaymentDate,
        paymentReference: paymentReference || undefined,
      },
      ...AuditLogger.extractRequestContext(event),
    });

    return httpOk({
      success: true,
      advancePayRequest,
      message: `Advance pay record created for ${staffName}`,
    });
  } catch (error: any) {
    console.error('Error creating admin advance pay record:', error);
    return httpErr(500, `Failed to create advance pay record: ${error.message}`);
  }
}

/**
 * Delete/cancel an advance pay request
 * - Staff can delete their own pending requests only
 * - Admin can delete requests only for clinics they have access to
 * 
 * Note: Uses soft delete pattern - sets isDeleted flag instead of removing record
 */
async function deleteAdvancePayRequest(
  advanceId: string,
  userPerms: UserPermissions,
  isAdmin: boolean,
  allowedClinics: Set<string>,
  event?: APIGatewayProxyEvent
) {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ADVANCE_PAY_TABLE,
      Key: { advanceId },
    }));

    if (!Item) {
      return httpErr(404, "Advance pay request not found");
    }

    const request = Item as AdvancePayRequest;

    // Check if already deleted (soft delete)
    if ((request as any).isDeleted) {
      return httpErr(404, "Advance pay request not found");
    }

    // Staff can only delete their own pending requests
    if (!isAdmin) {
      if (request.staffId !== userPerms.email) {
        return httpErr(403, "Forbidden: can only delete your own requests");
      }
      if (request.status !== 'pending') {
        return httpErr(400, "Can only cancel pending requests");
      }
    } else {
      // Admin must have access to the clinic this request belongs to
      if (!hasClinicAccess(allowedClinics, request.clinicId)) {
        return httpErr(403, "Forbidden: no access to this clinic's requests");
      }
    }

    const now = new Date().toISOString();
    const userName = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    // Soft delete - update instead of delete
    await ddb.send(new UpdateCommand({
      TableName: ADVANCE_PAY_TABLE,
      Key: { advanceId },
      UpdateExpression: 'SET isDeleted = :isDeleted, deletedAt = :deletedAt, deletedBy = :deletedBy, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':isDeleted': true,
        ':deletedAt': now,
        ':deletedBy': userName,
        ':updatedAt': now,
      },
    }));

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'DELETE',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId: request.clinicId,
      before: { amount: request.amount, status: request.status, staffId: request.staffId },
      after: { isDeleted: true, deletedBy: userName },
      ...AuditLogger.extractRequestContext(event),
    });

    return httpOk({ success: true, message: "Advance pay request deleted" });
  } catch (error: any) {
    console.error('Error deleting advance pay request:', error);
    return httpErr(500, `Failed to delete advance pay request: ${error.message}`);
  }
}

/**
 * Approve an advance pay request (Admin only)
 * 
 * Uses conditional update to prevent race conditions (two admins approving simultaneously)
 */
async function approveAdvancePay(
  advanceId: string,
  userPerms: UserPermissions,
  allowedClinics: Set<string>,
  event?: APIGatewayProxyEvent,
  notes?: string
) {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ADVANCE_PAY_TABLE,
      Key: { advanceId },
    }));

    if (!Item) {
      return httpErr(404, "Advance pay request not found");
    }

    const request = Item as AdvancePayRequest;

    // Check soft delete
    if ((request as any).isDeleted) {
      return httpErr(404, "Advance pay request not found");
    }

    // Verify admin has access to this clinic
    if (!hasClinicAccess(allowedClinics, request.clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic's requests");
    }

    // Early status check for better error messages
    if (request.status !== 'pending') {
      return httpErr(400, `Cannot approve request with status: ${request.status}`);
    }

    const now = new Date().toISOString();
    const approvedBy = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    try {
      // Use conditional update to prevent race conditions
      // Build update expression dynamically - only include approvalNotes if notes is provided
      let updateExpression = 'SET #status = :newStatus, approvedBy = :approvedBy, approvedAt = :approvedAt, updatedAt = :updatedAt';
      const expressionAttributeValues: Record<string, any> = {
        ':newStatus': 'approved',
        ':pendingStatus': 'pending',
        ':approvedBy': approvedBy,
        ':approvedAt': now,
        ':updatedAt': now,
        ':false': false,
      };

      // Only add approvalNotes if notes is provided
      if (notes) {
        updateExpression += ', approvalNotes = :notes';
        expressionAttributeValues[':notes'] = notes;
      }

      await ddb.send(new UpdateCommand({
        TableName: ADVANCE_PAY_TABLE,
        Key: { advanceId },
        UpdateExpression: updateExpression,
        ConditionExpression: '#status = :pendingStatus AND (attribute_not_exists(isDeleted) OR isDeleted = :false)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: expressionAttributeValues,
      }));
    } catch (conditionError: any) {
      if (conditionError.name === 'ConditionalCheckFailedException') {
        return httpErr(409, "Request has already been processed by another admin. Please refresh and try again.");
      }
      throw conditionError;
    }

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName: approvedBy,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'APPROVE',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId: request.clinicId,
      before: { status: 'pending', staffId: request.staffId, amount: request.amount },
      after: { status: 'approved', approvedBy },
      reason: notes,
      ...AuditLogger.extractRequestContext(event),
    });

    return httpOk({
      success: true,
      message: "Advance pay request approved",
      advancePayRequest: { ...request, status: 'approved', approvedBy, approvedAt: now, approvalNotes: notes },
    });
  } catch (error: any) {
    console.error('Error approving advance pay request:', error);
    return httpErr(500, `Failed to approve advance pay request: ${error.message}`);
  }
}

/**
 * Deny an advance pay request (Admin only)
 * 
 * Uses conditional update to prevent race conditions
 */
async function denyAdvancePay(
  advanceId: string,
  userPerms: UserPermissions,
  allowedClinics: Set<string>,
  event?: APIGatewayProxyEvent,
  reason?: string
) {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ADVANCE_PAY_TABLE,
      Key: { advanceId },
    }));

    if (!Item) {
      return httpErr(404, "Advance pay request not found");
    }

    const request = Item as AdvancePayRequest;

    // Check soft delete
    if ((request as any).isDeleted) {
      return httpErr(404, "Advance pay request not found");
    }

    // Verify admin has access to this clinic
    if (!hasClinicAccess(allowedClinics, request.clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic's requests");
    }

    // Early status check for better error messages
    if (request.status !== 'pending') {
      return httpErr(400, `Cannot deny request with status: ${request.status}`);
    }

    const now = new Date().toISOString();
    const deniedBy = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    try {
      // Use conditional update to prevent race conditions
      await ddb.send(new UpdateCommand({
        TableName: ADVANCE_PAY_TABLE,
        Key: { advanceId },
        UpdateExpression: 'SET #status = :newStatus, deniedBy = :deniedBy, deniedAt = :deniedAt, denialReason = :reason, updatedAt = :updatedAt',
        ConditionExpression: '#status = :pendingStatus AND (attribute_not_exists(isDeleted) OR isDeleted = :false)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':newStatus': 'denied',
          ':pendingStatus': 'pending',
          ':deniedBy': deniedBy,
          ':deniedAt': now,
          ':reason': reason || undefined,
          ':updatedAt': now,
          ':false': false,
        },
      }));
    } catch (conditionError: any) {
      if (conditionError.name === 'ConditionalCheckFailedException') {
        return httpErr(409, "Request has already been processed by another admin. Please refresh and try again.");
      }
      throw conditionError;
    }

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName: deniedBy,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'DENY',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId: request.clinicId,
      before: { status: 'pending', staffId: request.staffId, amount: request.amount },
      after: { status: 'denied', deniedBy },
      reason,
      ...AuditLogger.extractRequestContext(event),
    });

    return httpOk({
      success: true,
      message: "Advance pay request denied",
      advancePayRequest: { ...request, status: 'denied', deniedBy, deniedAt: now, denialReason: reason },
    });
  } catch (error: any) {
    console.error('Error denying advance pay request:', error);
    return httpErr(500, `Failed to deny advance pay request: ${error.message}`);
  }
}

/**
 * Mark an approved advance pay request as paid (Admin only)
 * 
 * This tracks actual payroll deduction and prevents double-payment scenarios
 */
async function markAdvancePayAsPaid(
  advanceId: string,
  userPerms: UserPermissions,
  allowedClinics: Set<string>,
  event?: APIGatewayProxyEvent,
  paymentReference?: string
) {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ADVANCE_PAY_TABLE,
      Key: { advanceId },
    }));

    if (!Item) {
      return httpErr(404, "Advance pay request not found");
    }

    const request = Item as AdvancePayRequest;

    // Check soft delete
    if ((request as any).isDeleted) {
      return httpErr(404, "Advance pay request not found");
    }

    // Verify admin has access to this clinic
    if (!hasClinicAccess(allowedClinics, request.clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic's requests");
    }

    // Can only mark approved requests as paid
    if (request.status !== 'approved') {
      return httpErr(400, `Cannot mark as paid: request status is '${request.status}' (must be 'approved')`);
    }

    const now = new Date().toISOString();
    const paidBy = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    try {
      // Use conditional update to prevent race conditions
      await ddb.send(new UpdateCommand({
        TableName: ADVANCE_PAY_TABLE,
        Key: { advanceId },
        UpdateExpression: 'SET #status = :newStatus, paymentDate = :paymentDate, paymentReference = :paymentReference, paidBy = :paidBy, updatedAt = :updatedAt',
        ConditionExpression: '#status = :approvedStatus AND (attribute_not_exists(isDeleted) OR isDeleted = :false)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':newStatus': 'paid',
          ':approvedStatus': 'approved',
          ':paymentDate': now,
          ':paymentReference': paymentReference || `PAY-${Date.now()}`,
          ':paidBy': paidBy,
          ':updatedAt': now,
          ':false': false,
        },
      }));
    } catch (conditionError: any) {
      if (conditionError.name === 'ConditionalCheckFailedException') {
        return httpErr(409, "Request status has changed. Please refresh and try again.");
      }
      throw conditionError;
    }

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName: paidBy,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'UPDATE',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId: request.clinicId,
      before: { status: 'approved', staffId: request.staffId, amount: request.amount },
      after: { status: 'paid', paidBy, paymentReference: paymentReference || `PAY-${Date.now()}` },
      metadata: { paymentAction: 'MARK_AS_PAID' },
      ...AuditLogger.extractRequestContext(event),
    });

    return httpOk({
      success: true,
      message: "Advance pay marked as paid",
      advancePayRequest: {
        ...request,
        status: 'paid',
        paymentDate: now,
        paymentReference: paymentReference || `PAY-${Date.now()}`,
        paidBy,
      },
    });
  } catch (error: any) {
    console.error('Error marking advance pay as paid:', error);
    return httpErr(500, `Failed to mark advance pay as paid: ${error.message}`);
  }
}

/**
 * Admin initiates advance pay request for a staff member
 * 
 * This creates a request with status 'pending_staff_approval'
 * The staff member must approve before admin can mark as paid
 * 
 * Note: All business rule restrictions have been removed.
 * Only basic validation (staffId, amount > 0, clinic access) is enforced.
 */
async function adminInitiateAdvancePayForStaff(
  userPerms: UserPermissions,
  body: any,
  allowedClinics: Set<string>,
  event?: APIGatewayProxyEvent
) {
  const { staffId, amount, reason, clinicId } = body;

  // Basic validation - only require staffId and positive amount
  if (!staffId || typeof staffId !== 'string') {
    return httpErr(400, "Staff ID (email) is required");
  }

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return httpErr(400, "Valid amount (positive number) is required");
  }

  // No maximum amount validation - restrictions removed

  if (!clinicId) {
    return httpErr(400, "Clinic ID is required");
  }

  // Verify admin has access to this clinic
  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  try {
    // Lookup staff member
    const { Item: staffUser } = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: staffId.toLowerCase() },
    }));

    if (!staffUser) {
      return httpErr(404, "Staff member not found. Please verify the email address.");
    }

    // No tenure check, frequency check, pending count check, or outstanding amount check
    // All business rule restrictions have been removed

    const staffName = `${staffUser.givenName || ''} ${staffUser.familyName || ''}`.trim() || staffId;
    const adminName = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    const advanceId = `adv_${uuidv4()}`;
    const now = new Date().toISOString();

    const advancePayRequest: AdvancePayRequest = {
      advanceId,
      staffId: staffId.toLowerCase(),
      staffName,
      clinicId,
      amount,
      reason: reason || undefined,
      status: 'pending_staff_approval', // Staff must approve
      requestType: 'admin_initiated',
      requestedBy: userPerms.email,
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(new PutCommand({
      TableName: ADVANCE_PAY_TABLE,
      Item: advancePayRequest,
    }));

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName: adminName,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'CREATE',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId,
      after: {
        amount,
        status: 'pending_staff_approval',
        staffId: staffId.toLowerCase(),
        staffName,
        requestType: 'admin_initiated',
        reason: reason || undefined,
      },
      ...AuditLogger.extractRequestContext(event),
    });

    // TODO: Send email notification to staff member about pending approval request
    // await sendAdvancePayStatusEmail({ ... });

    return httpOk({
      success: true,
      advancePayRequest,
      message: `Advance pay request initiated for ${staffName}. Waiting for staff approval.`,
    });
  } catch (error: any) {
    console.error('Error initiating admin advance pay for staff:', error);
    return httpErr(500, `Failed to initiate advance pay: ${error.message}`);
  }
}

/**
 * Staff approves an admin-initiated advance pay request
 * 
 * This changes status from 'pending_staff_approval' to 'approved'
 * The admin can then mark it as paid
 */
async function staffApproveAdvancePay(
  advanceId: string,
  userPerms: UserPermissions,
  event?: APIGatewayProxyEvent,
  notes?: string
) {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ADVANCE_PAY_TABLE,
      Key: { advanceId },
    }));

    if (!Item) {
      return httpErr(404, "Advance pay request not found");
    }

    const request = Item as AdvancePayRequest;

    // Check soft delete
    if ((request as any).isDeleted) {
      return httpErr(404, "Advance pay request not found");
    }

    // Verify this is an admin-initiated request
    if (request.requestType !== 'admin_initiated') {
      return httpErr(400, "This request cannot be approved by staff. It was not initiated by an admin.");
    }

    // Verify the staff member is the target of this request
    if (request.staffId !== userPerms.email) {
      return httpErr(403, "Forbidden: you can only approve requests for yourself");
    }

    // Verify status is pending_staff_approval
    if (request.status !== 'pending_staff_approval') {
      return httpErr(400, `Cannot approve: request status is '${request.status}' (must be 'pending_staff_approval')`);
    }

    const now = new Date().toISOString();
    const staffName = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    try {
      // Use conditional update for safety
      await ddb.send(new UpdateCommand({
        TableName: ADVANCE_PAY_TABLE,
        Key: { advanceId },
        UpdateExpression: 'SET #status = :newStatus, staffApprovedAt = :staffApprovedAt, staffApprovalNotes = :notes, updatedAt = :updatedAt',
        ConditionExpression: '#status = :currentStatus AND (attribute_not_exists(isDeleted) OR isDeleted = :false)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':newStatus': 'approved',
          ':currentStatus': 'pending_staff_approval',
          ':staffApprovedAt': now,
          ':notes': notes || null,
          ':updatedAt': now,
          ':false': false,
        },
      }));
    } catch (conditionError: any) {
      if (conditionError.name === 'ConditionalCheckFailedException') {
        return httpErr(409, "Request status has changed. Please refresh and try again.");
      }
      throw conditionError;
    }

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName: staffName,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'APPROVE',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId: request.clinicId,
      before: { status: 'pending_staff_approval', staffId: request.staffId, amount: request.amount },
      after: { status: 'approved', staffApprovalNotes: notes || null },
      metadata: { approvalType: 'STAFF_APPROVAL', requestType: 'admin_initiated' },
      ...AuditLogger.extractRequestContext(event),
    });

    // TODO: Send email notification to admin about staff approval
    // await sendAdvancePayStatusEmail({ ... });

    return httpOk({
      success: true,
      message: "You have approved the advance pay request. Admin will process payment.",
      advancePayRequest: {
        ...request,
        status: 'approved',
        staffApprovedAt: now,
        staffApprovalNotes: notes || null,
      },
    });
  } catch (error: any) {
    console.error('Error in staff approve advance pay:', error);
    return httpErr(500, `Failed to approve advance pay: ${error.message}`);
  }
}

/**
 * Staff rejects an admin-initiated advance pay request
 * 
 * This changes status from 'pending_staff_approval' to 'denied'
 */
async function staffRejectAdvancePay(
  advanceId: string,
  userPerms: UserPermissions,
  event?: APIGatewayProxyEvent,
  reason?: string
) {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ADVANCE_PAY_TABLE,
      Key: { advanceId },
    }));

    if (!Item) {
      return httpErr(404, "Advance pay request not found");
    }

    const request = Item as AdvancePayRequest;

    // Check soft delete
    if ((request as any).isDeleted) {
      return httpErr(404, "Advance pay request not found");
    }

    // Verify this is an admin-initiated request
    if (request.requestType !== 'admin_initiated') {
      return httpErr(400, "This request cannot be rejected by staff. It was not initiated by an admin.");
    }

    // Verify the staff member is the target of this request
    if (request.staffId !== userPerms.email) {
      return httpErr(403, "Forbidden: you can only reject requests for yourself");
    }

    // Verify status is pending_staff_approval
    if (request.status !== 'pending_staff_approval') {
      return httpErr(400, `Cannot reject: request status is '${request.status}' (must be 'pending_staff_approval')`);
    }

    const now = new Date().toISOString();
    const staffName = `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email;

    try {
      // Use conditional update for safety
      await ddb.send(new UpdateCommand({
        TableName: ADVANCE_PAY_TABLE,
        Key: { advanceId },
        UpdateExpression: 'SET #status = :newStatus, deniedBy = :deniedBy, deniedAt = :deniedAt, denialReason = :reason, updatedAt = :updatedAt',
        ConditionExpression: '#status = :currentStatus AND (attribute_not_exists(isDeleted) OR isDeleted = :false)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':newStatus': 'denied',
          ':currentStatus': 'pending_staff_approval',
          ':deniedBy': staffName,
          ':deniedAt': now,
          ':reason': reason || 'Staff declined the advance pay offer',
          ':updatedAt': now,
          ':false': false,
        },
      }));
    } catch (conditionError: any) {
      if (conditionError.name === 'ConditionalCheckFailedException') {
        return httpErr(409, "Request status has changed. Please refresh and try again.");
      }
      throw conditionError;
    }

    // Audit log
    await auditLogger.log({
      userId: userPerms.email,
      userName: staffName,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'DENY',
      resource: 'ADVANCE_PAY' as AuditResource,
      resourceId: advanceId,
      clinicId: request.clinicId,
      before: { status: 'pending_staff_approval', staffId: request.staffId, amount: request.amount },
      after: { status: 'denied', deniedBy: staffName, denialReason: reason || 'Staff declined the advance pay offer' },
      metadata: { rejectionType: 'STAFF_REJECTION', requestType: 'admin_initiated' },
      ...AuditLogger.extractRequestContext(event),
    });

    // TODO: Send email notification to admin about staff rejection
    // await sendAdvancePayStatusEmail({ ... });

    return httpOk({
      success: true,
      message: "You have rejected the advance pay offer.",
      advancePayRequest: {
        ...request,
        status: 'denied',
        deniedBy: staffName,
        deniedAt: now,
        denialReason: reason || 'Staff declined the advance pay offer',
      },
    });
  } catch (error: any) {
    console.error('Error in staff reject advance pay:', error);
    return httpErr(500, `Failed to reject advance pay: ${error.message}`);
  }
}

async function queryAuditLogs(
  queryParams: any,
  userPerms: UserPermissions,
  isAdmin: boolean,
  allowedClinics: Set<string>
) {
  const { clinicId, userId, startDate, endDate, limit = 100, action, resource } = queryParams || {};

  // Non-admins can only see their own audit logs
  if (!isAdmin && userId && userId !== userPerms.email) {
    return httpErr(403, "You can only view your own audit logs");
  }

  // Admin must have clinic access if filtering by clinicId
  if (isAdmin && clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  try {
    let result;

    if (clinicId) {
      // Query by clinic
      result = await auditLogger.queryByClinic(clinicId, {
        startDate,
        endDate,
        limit: parseInt(limit, 10) || 100,
      });
    } else if (userId || !isAdmin) {
      // Query by user (non-admins always query their own)
      const targetUserId = isAdmin ? userId : userPerms.email;
      result = await auditLogger.queryByUser(targetUserId, {
        startDate,
        endDate,
        limit: parseInt(limit, 10) || 100,
      });
    } else {
      // Admin without clinic filter - query each allowed clinic and merge
      const allLogs: any[] = [];
      for (const cid of allowedClinics) {
        try {
          const clinicResult = await auditLogger.queryByClinic(cid, {
            startDate,
            endDate,
            limit: parseInt(limit, 10) || 50,
          });
          if (clinicResult.auditLogs) {
            allLogs.push(...clinicResult.auditLogs);
          }
        } catch (queryError) {
          console.error(`Failed to query audit logs for clinic ${cid}:`, queryError);
        }
      }
      // Sort by timestamp descending and limit
      allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      result = {
        auditLogs: allLogs.slice(0, parseInt(limit, 10) || 100),
        count: allLogs.length,
      };
    }

    // Apply client-side filtering for action and resource if provided
    let filteredLogs = result.auditLogs || [];

    if (action) {
      filteredLogs = filteredLogs.filter((log: any) => log.action === action);
    }

    if (resource) {
      filteredLogs = filteredLogs.filter((log: any) => log.resource === resource);
    }

    return httpOk({
      auditLogs: filteredLogs,
      count: filteredLogs.length,
    });
  } catch (error: any) {
    console.error('Error querying audit logs:', error);
    return httpErr(500, `Failed to query audit logs: ${error.message || 'Unknown error'}`);
  }
}

// ========================================
// ADMIN CALENDAR EVENTS (Tasks, Meetings, To-Dos)
// ========================================

async function getAdminCalendarEvents(queryParams: any, allowedClinics: Set<string>) {
  const { startDate, endDate } = queryParams || {};

  if (!startDate || !endDate) {
    return httpErr(400, "startDate and endDate are required");
  }

  try {
    // Add time components for proper ISO datetime comparison
    const startDateISO = startDate.includes('T') ? startDate : `${startDate}T00:00:00`;
    const endDateISO = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;

    // Query GLOBAL events (all admin calendar events are global)
    const { Items } = await ddb.send(new QueryCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      IndexName: 'byClinicAndDate',
      KeyConditionExpression: 'clinicId = :clinicId AND startDateTime BETWEEN :startDate AND :endDate',
      ExpressionAttributeValues: {
        ':clinicId': 'GLOBAL',
        ':startDate': startDateISO,
        ':endDate': endDateISO,
      },
    }));

    // Remove clinicId from events in response
    const events = (Items || []).map((event: any) => {
      const { clinicId, ...eventWithoutClinicId } = event;
      return eventWithoutClinicId;
    });

    // Sort by startDateTime
    events.sort((a: any, b: any) => a.startDateTime.localeCompare(b.startDateTime));

    return httpOk({ events });
  } catch (error: any) {
    console.error('Error fetching admin calendar events:', error);
    return httpErr(500, `Failed to fetch calendar events: ${error.message}`);
  }
}

async function createAdminCalendarEvent(body: any, userPerms: UserPermissions, allowedClinics: Set<string>) {
  const { eventType, title, description, startDateTime, endDateTime, allDay, assignedTo, meetingLink, priority, dueDate } = body;

  if (!eventType || !title || !startDateTime) {
    return httpErr(400, "eventType, title, and startDateTime are required");
  }

  const validEventTypes = ['task', 'meeting', 'todo'];
  if (!validEventTypes.includes(eventType)) {
    return httpErr(400, `eventType must be one of: ${validEventTypes.join(', ')}`);
  }

  const validPriorities = ['low', 'medium', 'high'];
  if (priority && !validPriorities.includes(priority)) {
    return httpErr(400, `priority must be one of: ${validPriorities.join(', ')}`);
  }

  const eventId = uuidv4();
  const now = new Date().toISOString();

  // Use GLOBAL as clinicId for database indexing - events are not clinic-specific
  const event = {
    eventId,
    clinicId: 'GLOBAL', // Internal use only for DB indexing
    eventType,
    title: title.trim(),
    description: description?.trim() || null,
    startDateTime,
    endDateTime: endDateTime || null,
    allDay: allDay || false,
    createdBy: userPerms.email,
    assignedTo: assignedTo || [],
    meetingLink: eventType === 'meeting' && meetingLink ? meetingLink.trim() : null,
    status: 'pending',
    priority: priority || 'medium',
    createdAt: now,
    updatedAt: now,
    dueDate: dueDate || null,
    completedAt: null,
  };

  try {
    await ddb.send(new PutCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      Item: event,
    }));

    // Return event without clinicId in response
    const { clinicId: _, ...responseEvent } = event;
    return httpOk({ success: true, ...responseEvent });
  } catch (error: any) {
    console.error('Error creating admin calendar event:', error);
    return httpErr(500, `Failed to create calendar event: ${error.message}`);
  }
}

async function updateAdminCalendarEvent(eventId: string, body: any, userPerms: UserPermissions, allowedClinics: Set<string>) {
  try {
    const { Item: existingEvent } = await ddb.send(new GetCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      Key: { eventId },
    }));

    if (!existingEvent) {
      return httpErr(404, "Calendar event not found");
    }

    if (!hasClinicAccess(allowedClinics, existingEvent.clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic");
    }

    const now = new Date().toISOString();
    const updatedEvent = {
      ...existingEvent,
      ...body,
      eventId, // Prevent override
      clinicId: existingEvent.clinicId, // Prevent clinic change
      createdBy: existingEvent.createdBy, // Preserve original creator
      createdAt: existingEvent.createdAt, // Preserve original timestamp
      updatedAt: now,
    };

    await ddb.send(new PutCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      Item: updatedEvent,
    }));

    return httpOk(updatedEvent);
  } catch (error: any) {
    console.error('Error updating admin calendar event:', error);
    return httpErr(500, `Failed to update calendar event: ${error.message}`);
  }
}

async function completeAdminCalendarEvent(eventId: string, userPerms: UserPermissions, allowedClinics: Set<string>) {
  try {
    const { Item: existingEvent } = await ddb.send(new GetCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      Key: { eventId },
    }));

    if (!existingEvent) {
      return httpErr(404, "Calendar event not found");
    }

    if (!hasClinicAccess(allowedClinics, existingEvent.clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic");
    }

    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      Key: { eventId },
      UpdateExpression: 'SET #status = :completed, completedAt = :completedAt, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':completed': 'completed',
        ':completedAt': now,
        ':updatedAt': now,
      },
    }));

    return httpOk({
      ...existingEvent,
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    });
  } catch (error: any) {
    console.error('Error completing admin calendar event:', error);
    return httpErr(500, `Failed to complete calendar event: ${error.message}`);
  }
}

async function deleteAdminCalendarEvent(eventId: string, allowedClinics: Set<string>) {
  try {
    const { Item: existingEvent } = await ddb.send(new GetCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      Key: { eventId },
    }));

    if (!existingEvent) {
      return httpErr(404, "Calendar event not found");
    }

    if (!hasClinicAccess(allowedClinics, existingEvent.clinicId)) {
      return httpErr(403, "Forbidden: no access to this clinic");
    }

    await ddb.send(new DeleteCommand({
      TableName: ADMIN_CALENDAR_TABLE,
      Key: { eventId },
    }));

    return httpOk({ message: "Calendar event deleted successfully" });
  } catch (error: any) {
    console.error('Error deleting admin calendar event:', error);
    return httpErr(500, `Failed to delete calendar event: ${error.message}`);
  }
}

async function getAssignableAdmins(queryParams: any, allowedClinics: Set<string>) {
  // No clinicId required - fetch ALL admins globally (Global Super Admin, SuperAdmin, Admin)

  try {
    // Scan all active users and filter by admin roles
    const { Items: staffUsers } = await ddb.send(new ScanCommand({
      TableName: STAFF_USER_TABLE,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
    }));

    const admins: any[] = [];
    const seenEmails = new Set<string>(); // Avoid duplicates

    for (const user of staffUsers || []) {
      // Check if user has admin role (GlobalSuperAdmin, SuperAdmin, or Admin)
      const isGlobalAdmin = user.role === 'GlobalSuperAdmin' || user.role === 'Global Super Admin' ||
        user.isSuperAdmin === true || user.isGlobalSuperAdmin === true;
      const isSuperAdmin = user.role === 'SuperAdmin' || user.role === 'Super Admin';
      const isAdmin = user.role === 'Admin';

      // Also check clinicRoles for any admin roles in any clinic
      const clinicRoles = user.clinicRoles || [];
      const hasClinicAdminRole = clinicRoles.some((cr: any) =>
        cr.role === 'SuperAdmin' || cr.role === 'Admin' || cr.role === 'Global Super Admin'
      );

      if (isGlobalAdmin || isSuperAdmin || isAdmin || hasClinicAdminRole) {
        // Avoid duplicates by email
        if (!seenEmails.has(user.email)) {
          seenEmails.add(user.email);

          // Determine the highest role
          let displayRole = 'Admin';
          if (isGlobalAdmin) displayRole = 'Global Super Admin';
          else if (isSuperAdmin) displayRole = 'Super Admin';

          admins.push({
            username: user.email,
            email: user.email,
            name: `${user.givenName || ''} ${user.familyName || ''}`.trim() || user.email,
            role: displayRole,
          });
        }
      }
    }

    // Sort by role priority (Global Super Admin > Super Admin > Admin) then by name
    const rolePriority: Record<string, number> = {
      'Global Super Admin': 1,
      'Super Admin': 2,
      'Admin': 3,
    };
    admins.sort((a, b) => {
      const priorityDiff = (rolePriority[a.role] || 4) - (rolePriority[b.role] || 4);
      if (priorityDiff !== 0) return priorityDiff;
      return a.name.localeCompare(b.name);
    });

    return httpOk({ admins });
  } catch (error: any) {
    console.error('Error fetching assignable admins:', error);
    return httpErr(500, `Failed to fetch assignable admins: ${error.message}`);
  }
}
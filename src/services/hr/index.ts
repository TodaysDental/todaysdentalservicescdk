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
// services/hr/index.ts
// COMPLETE FIXED VERSION with all requested features

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand, GetCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
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
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE!; // DynamoDB table for user lookups
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
    const endTime = new Date(leave.endDate).getTime() + (24 * 60 * 60 * 1000 - 1); 
    return dateTime >= startTime && dateTime <= endTime;
  });
}

// Get all shifts that overlap with a date range
async function getOverlappingShifts(staffId: string, startDate: string, endDate: string): Promise<any[]> {
  console.log(`🔍 getOverlappingShifts: Looking for shifts for staffId=${staffId} between ${startDate} and ${endDate}`);
  
  const leaveStartISO = new Date(startDate + 'T00:00:00Z').toISOString();
  const leaveEndISO = new Date(endDate + 'T23:59:59.999Z').toISOString();
  
  console.log(`🔍 Converted dates: leaveStart=${leaveStartISO}, leaveEnd=${leaveEndISO}`);
  
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

  console.log(`🔍 Found ${Items?.length || 0} overlapping shifts`);
  return Items || [];
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
  if (hasExplicitTimeZone(input)) {
    const d = new Date(input);
    return isNaN(d.getTime()) ? input : d.toISOString();
  }
  const parts = parseNaiveDateTime(input);
  if (!parts) {
    const d = new Date(input);
    return isNaN(d.getTime()) ? input : d.toISOString();
  }
  const utcDate = clinicLocalPartsToUtcDate(parts, tz);
  return utcDate.toISOString();
}

// Send email notification for new shift
async function sendShiftNotificationEmail(shiftDetails: any) {
    const recipientEmail = shiftDetails.staffId; // staffId is the email
    
    const clinicTimezone = await getClinicTimezone(shiftDetails.clinicId);
    const startTimeLocal = new Date(shiftDetails.startTime).toLocaleString('en-US', { timeZone: clinicTimezone });
    const endTimeLocal = new Date(shiftDetails.endTime).toLocaleString('en-US', { timeZone: clinicTimezone });
    const shiftDate = new Date(shiftDetails.startTime).toLocaleDateString('en-US', { 
        timeZone: clinicTimezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });

    let staffName = recipientEmail;
    try {
        const { Item: staffUser } = await ddb.send(new GetCommand({
            TableName: STAFF_USER_TABLE,
            Key: { email: recipientEmail.toLowerCase() },
        }));
        if (staffUser && staffUser.givenName) {
            staffName = `${staffUser.givenName} ${staffUser.familyName || ''}`.trim();
        }
    } catch (err) {
        console.log('Could not fetch staff name:', err);
    }

    const subject = `New Shift Scheduled - ${shiftDate}`;
    const bodyHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
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
                <p>Dear ${staffName},</p>
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
        console.log(`Email sent successfully to ${recipientEmail}`);
    } catch (e) {
        console.error(`Failed to send email to ${recipientEmail}:`, e);
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
      return createShift(parsedBody, allowedClinics, userPerms, event);
    }
    // NEW: Copy week schedule endpoint
    if (method === 'POST' && path === '/shifts/copy-week') {
      if (!isAdmin) return httpErr(403, "Forbidden");
      if (!event.body) return httpErr(400, "Missing request body");
      const parsedBody = JSON.parse(event.body);
      return copyWeekSchedule(parsedBody, allowedClinics, userPerms, event);
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
      const denialReason = event.body ? JSON.parse(event.body)?.reason : undefined;
      return updateLeaveStatus(leaveId, 'denied', userPerms, event, denialReason);
    }

    // --- AUDIT TRAIL ---
    if (method === 'GET' && path === '/audit') {
      return getAuditLogs(event.queryStringParameters, isAdmin, allowedClinics);
    }
    if (method === 'GET' && path.match(/^\/audit\/(staff|shift|leave)\/[^\/]+$/)) {
      const parts = path.split('/');
      const resourceType = parts[2] as 'staff' | 'shift' | 'leave';
      const resourceId = decodeURIComponent(parts[3]);
      const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : 50;
      return getResourceAuditTrail(resourceType, resourceId, limit);
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

async function getDashboard(userPerms: UserPermissions, isAdmin: boolean) {
  if (isAdmin) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(today.setDate(diff)).toISOString();
    const weekEnd = new Date(today.setDate(diff + 6)).toISOString();

    // Count active staff
    const staffCountPromise = ddb.send(new ScanCommand({
      TableName: STAFF_USER_TABLE,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
      Select: 'COUNT',
    }));

    // Get all staff with work locations
    const allStaffPromise = ddb.send(new ScanCommand({
      TableName: STAFF_INFO_TABLE,
      FilterExpression: 'attribute_exists(workLocation)',
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

    const [staffResponse, allStaffResponse, ...shiftResponses] = await Promise.all([
      staffCountPromise,
      allStaffPromise,
      ...shiftQueryPromises
    ]);
    
    const totalStaff = staffResponse.Count || 0;
    const allShifts = shiftResponses.flatMap(res => res.Items || []);
    
    // Calculate on-premise and remote staff
    let onPremiseStaff = 0;
    let remoteStaff = 0;
    const processedEmails = new Set<string>();
    
    (allStaffResponse.Items || []).forEach(staffInfo => {
      const email = staffInfo.email?.toLowerCase();
      if (!email || processedEmails.has(email)) return;
      processedEmails.add(email);
      
      if (staffInfo.workLocation) {
        if (staffInfo.workLocation.isRemote && !staffInfo.workLocation.isOnPremise) {
          remoteStaff++;
        } else if (staffInfo.workLocation.isOnPremise) {
          onPremiseStaff++;
        } else if (staffInfo.workLocation.isRemote) {
          remoteStaff++;
        }
      } else {
        onPremiseStaff++; // Default to on-premise if no location specified
      }
    });
    
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
      onPremiseStaff: onPremiseStaff,
      remoteStaff: remoteStaff,
      currentWeekOverview: {
        totalShifts: allShifts.length,
        estimatedHours: parseFloat(estimatedHours.toFixed(2)),
        estimatedCost: parseFloat(estimatedCost.toFixed(2)),
      }
    });

  } else {
    // STAFF DASHBOARD - FIXED TO USE ACTUAL COMPLETED HOURS
    const { Items: shifts } = await ddb.send(new QueryCommand({
        TableName: SHIFTS_TABLE,
        IndexName: 'byStaff',
        KeyConditionExpression: 'staffId = :staffId',
        FilterExpression: '#status = :completed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':staffId': userPerms.email,
          ':completed': 'completed'
        }
    }));
    
    let completedHours = 0;
    let totalEarnings = 0;
    const completedShifts = (shifts || []);

    // Use totalHours from each completed shift (which should be calculated from actual clock events)
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

async function createShift(body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
  const { staffId, clinicId, startTime, endTime } = body;
  if (!staffId || !clinicId || !startTime || !endTime) {
    return httpErr(400, "staffId, clinicId, startTime, and endTime are required");
  }

  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  const clinicTimezone = await getClinicTimezone(clinicId);
  const normalizedStartTime = normalizeToUtcIso(startTime, clinicTimezone);
  const shiftDate = new Date(normalizedStartTime);
  const isBlocked = await isDateBlocked(staffId, shiftDate);
  if (isBlocked) {
    return httpErr(400, "Cannot schedule shift: Staff has approved leave on this date");
  }

  let email: string | undefined;
  try {
    const { Item: staffUser } = await ddb.send(new GetCommand({
        TableName: STAFF_USER_TABLE,
        Key: { email: staffId.toLowerCase() },
    }));
    
    if (!staffUser) {
        console.error("Staff user not found:", staffId);
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
  const normalizedEndTime = normalizeToUtcIso(endTime, clinicTimezone);
  const totalHours = (new Date(normalizedEndTime).getTime() - new Date(normalizedStartTime).getTime()) / (1000 * 60 * 60);
  
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
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      role: body.role || 'Staff',
      totalHours: parseFloat(totalHours.toFixed(2)),
      hourlyRate: hourlyRate,
      pay: parseFloat(pay.toFixed(2)),
      status: 'scheduled'
  };

  await ddb.send(new PutCommand({ TableName: SHIFTS_TABLE, Item: shift }));

  // Send email notification
  await sendShiftNotificationEmail(shift);

  // Audit log
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

  return httpOk({ shiftId, message: "Shift created successfully" });
}

// NEW: Copy week schedule functionality
async function copyWeekSchedule(
  body: any, 
  allowedClinics: Set<string>, 
  userPerms?: UserPermissions, 
  event?: APIGatewayProxyEvent
) {
  const { clinicId, sourceWeekStart, targetWeekStart } = body;
  
  if (!clinicId || !sourceWeekStart || !targetWeekStart) {
    return httpErr(400, "clinicId, sourceWeekStart, and targetWeekStart are required");
  }

  if (!hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  // Calculate week end dates (7 days from start)
  const sourceStart = new Date(sourceWeekStart);
  const sourceEnd = new Date(sourceStart);
  sourceEnd.setDate(sourceEnd.getDate() + 7);
  
  const targetStart = new Date(targetWeekStart);
  const targetEnd = new Date(targetStart);
  targetEnd.setDate(targetEnd.getDate() + 7);

  console.log(`📅 Copying schedule from ${sourceStart.toISOString()} to ${targetStart.toISOString()}`);

  // Fetch source week shifts
  const { Items: sourceShifts } = await ddb.send(new QueryCommand({
    TableName: SHIFTS_TABLE,
    IndexName: 'byClinicAndDate',
    KeyConditionExpression: 'clinicId = :clinicId AND startTime BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':clinicId': clinicId,
      ':start': sourceStart.toISOString(),
      ':end': sourceEnd.toISOString(),
    }
  }));

  if (!sourceShifts || sourceShifts.length === 0) {
    return httpErr(400, "No shifts found in the source week");
  }

  console.log(`📋 Found ${sourceShifts.length} shifts to copy`);

  // Calculate time offset (in milliseconds)
  const timeOffset = targetStart.getTime() - sourceStart.getTime();

  // Create new shifts for target week
  const newShifts: any[] = [];
  const createdShiftIds: string[] = [];

  for (const sourceShift of sourceShifts) {
    // Skip non-scheduled shifts
    if (sourceShift.status !== 'scheduled') {
      console.log(`⏭️ Skipping shift ${sourceShift.shiftId} with status ${sourceShift.status}`);
      continue;
    }

    // Calculate new times
    const newStartTime = new Date(new Date(sourceShift.startTime).getTime() + timeOffset).toISOString();
    const newEndTime = new Date(new Date(sourceShift.endTime).getTime() + timeOffset).toISOString();

    // Check if staff has leave on this date
    const isBlocked = await isDateBlocked(sourceShift.staffId, new Date(newStartTime));
    if (isBlocked) {
      console.log(`⏭️ Skipping shift for ${sourceShift.staffId} - staff has leave on ${newStartTime}`);
      continue;
    }

    const newShiftId = uuidv4();
    const newShift = {
      ...sourceShift,
      shiftId: newShiftId,
      startTime: newStartTime,
      endTime: newEndTime,
      status: 'scheduled'
    };

    newShifts.push(newShift);
    createdShiftIds.push(newShiftId);
  }

  if (newShifts.length === 0) {
    return httpErr(400, "No shifts could be copied (all staff may have leave during target week)");
  }

  // Batch write new shifts (max 25 at a time)
  const batchSize = 25;
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

  console.log(`✅ Successfully copied ${newShifts.length} shifts`);

  // Send email notifications for all new shifts
  for (const shift of newShifts) {
    try {
      await sendShiftNotificationEmail(shift);
    } catch (err) {
      console.error(`Failed to send email for shift ${shift.shiftId}:`, err);
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
      resourceId: 'BULK_COPY',
      clinicId: clinicId,
      metadata: {
        actionType: 'Bulk Copy Schedule',
        sourceWeekStart: sourceWeekStart,
        targetWeekStart: targetWeekStart,
        shiftsCreated: newShifts.length,
        shiftIds: createdShiftIds,
      },
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ 
    message: `Successfully copied ${newShifts.length} shifts to the target week`,
    shiftsCreated: newShifts.length,
    shiftIds: createdShiftIds
  });
}

async function updateShift(shiftId: string, body: any, allowedClinics: Set<string>, userPerms?: UserPermissions, event?: APIGatewayProxyEvent) {
    const { Item: oldShift } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!oldShift) return httpErr(404, "Shift not found");

    const clinicId = body.clinicId || oldShift.clinicId;
    const staffId = body.staffId || oldShift.staffId;

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

    let email: string | undefined;
    try {
        const { Item: staffUser } = await ddb.send(new GetCommand({
            TableName: STAFF_USER_TABLE,
            Key: { email: staffId.toLowerCase() },
        }));
        
        if (!staffUser) {
            console.error("Staff user not found:", staffId);
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
    const { Item } = await ddb.send(new GetCommand({ TableName: SHIFTS_TABLE, Key: { shiftId }}));
    if (!Item) return httpErr(404, "Shift not found");
    const clinicId = Item.clinicId;
    if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
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
        clinicId: clinicId,
        before: AuditLogger.sanitizeForAudit(Item),
        metadata: AuditLogger.createShiftMetadata(Item),
        ...AuditLogger.extractRequestContext(event),
      });
    }

    return httpOk({ message: "Shift deleted successfully" });
}

async function rejectShift(shiftId: string, staffId: string, userPerms?: UserPermissions, event?: APIGatewayProxyEvent, reason?: string) {
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

    if (userPerms) {
      await auditLogger.log({
        userId: userPerms.email,
        userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
        userRole: AuditLogger.getUserRole(userPerms),
        action: 'REJECT',
        resource: 'SHIFT',
        resourceId: shiftId,
        clinicId: Item.clinicId,
        before: { status: Item.status },
        after: { status: 'rejected' },
        reason: reason,
        metadata: AuditLogger.createShiftMetadata(Item),
        ...AuditLogger.extractRequestContext(event),
      });
    }

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
  const leaveId = uuidv4();
  const leaveRequest = {
    leaveId,
    staffId,
    startDate,
    endDate,
    reason,
    status: 'pending'
  };
  await ddb.send(new PutCommand({ TableName: LEAVE_TABLE, Item: leaveRequest }));

  if (userPerms) {
    const userClinicId = userPerms.clinicRoles?.[0]?.clinicId;
    
    await auditLogger.log({
      userId: userPerms.email,
      userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
      userRole: AuditLogger.getUserRole(userPerms),
      action: 'CREATE',
      resource: 'LEAVE',
      resourceId: leaveId,
      clinicId: userClinicId,
      after: AuditLogger.sanitizeForAudit(leaveRequest),
      metadata: {
        ...AuditLogger.createLeaveMetadata(leaveRequest),
        actionType: 'Leave Request Created',
      },
      ...AuditLogger.extractRequestContext(event),
    });
  }

  return httpOk({ leaveId, message: "Leave request submitted" });
}

async function deleteLeave(leaveId: string, userPerms: UserPermissions, isAdmin: boolean, event?: APIGatewayProxyEvent) {
    const { Item } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
    if (!Item) return httpErr(404, "Leave request not found");
    
    if (!isAdmin && Item.staffId !== userPerms.email) {
        return httpErr(403, "Forbidden");
    }

    await ddb.send(new DeleteCommand({ TableName: LEAVE_TABLE, Key: { leaveId } }));

    if (userPerms) {
      const userClinicId = userPerms.clinicRoles?.[0]?.clinicId;
      
      await auditLogger.log({
        userId: userPerms.email,
        userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
        userRole: AuditLogger.getUserRole(userPerms),
        action: 'DELETE',
        resource: 'LEAVE',
        resourceId: leaveId,
        clinicId: userClinicId,
        before: AuditLogger.sanitizeForAudit(Item),
        metadata: {
          ...AuditLogger.createLeaveMetadata(Item),
          actionType: 'Leave Request Deleted',
        },
        ...AuditLogger.extractRequestContext(event),
      });
    }

    return httpOk({ message: "Leave request deleted" });
}

// UPDATED: Leave approval automatically deletes overlapping shifts
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

        // Find and DELETE overlapping shifts
        let overlappingShifts: any[] = [];
        if (leave.startDate && leave.endDate) {
            try {
                overlappingShifts = await getOverlappingShifts(
                    leave.staffId, 
                    leave.startDate, 
                    leave.endDate
                );
                
                console.log(`📊 Found ${overlappingShifts.length} overlapping shifts to delete`);
            } catch (shiftError) {
                console.error('⚠️ Error finding overlapping shifts:', shiftError);
            }
        }

        // DELETE overlapping shifts from the table
        if (overlappingShifts.length > 0) {
            try {
                console.log(`🗑️ DELETING ${overlappingShifts.length} overlapping shift(s)...`);
                
                const deletePromises = overlappingShifts.map(async (shift) => {
                    console.log('🗑️ Deleting shift:', shift.shiftId);
                    
                    await ddb.send(new DeleteCommand({
                        TableName: SHIFTS_TABLE,
                        Key: { shiftId: shift.shiftId }
                    }));
                    
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
                console.log('✅ All overlapping shifts DELETED');
            } catch (deleteError) {
                console.error('⚠️ Error deleting shifts:', deleteError);
            }
        }

        // Audit log for leave approval
        if (userPerms) {
          const affectedClinicIds = [...new Set(overlappingShifts.map(s => s.clinicId).filter(Boolean))];
          const primaryClinicId = affectedClinicIds[0] || userPerms.clinicRoles?.[0]?.clinicId;
          const clinicsToLog = affectedClinicIds.length > 0 ? affectedClinicIds : [primaryClinicId];
          
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
                affectedClinics: affectedClinicIds,
                deletedShiftCount: overlappingShifts.length,
              },
              ...AuditLogger.extractRequestContext(event),
            });
          }
        }

        return httpOk({
            leaveId, 
            status: 'approved',
            cancelledShifts: overlappingShifts.length,
            message: overlappingShifts.length > 0 
                ? `Leave approved. ${overlappingShifts.length} overlapping shift(s) have been automatically cancelled.`
                : 'Leave approved successfully. No shifts were affected.'
        });

    } catch (error) {
        console.error('❌ Error in approveLeave:', error);
        throw error;
    }
}

async function updateLeaveStatus(leaveId: string, status: 'approved' | 'denied', userPerms?: UserPermissions, event?: APIGatewayProxyEvent, denialReason?: string) {
    const { Item: leave } = await ddb.send(new GetCommand({ TableName: LEAVE_TABLE, Key: { leaveId }}));
    if (!leave) return httpErr(404, "Leave request not found");

    await ddb.send(new UpdateCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
        UpdateExpression: 'set #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status }
    }));

    if (userPerms) {
      const userClinicId = userPerms.clinicRoles?.[0]?.clinicId;
      
      await auditLogger.log({
        userId: userPerms.email,
        userName: `${userPerms.givenName || ''} ${userPerms.familyName || ''}`.trim() || userPerms.email,
        userRole: AuditLogger.getUserRole(userPerms),
        action: status === 'denied' ? 'DENY' : 'APPROVE',
        resource: 'LEAVE',
        resourceId: leaveId,
        clinicId: userClinicId,
        before: { status: leave.status },
        after: { status },
        reason: denialReason,
        metadata: {
          ...AuditLogger.createLeaveMetadata(leave),
          actionType: status === 'denied' ? 'Leave Denied' : 'Leave Approved',
        },
        ...AuditLogger.extractRequestContext(event),
      });
    }

    return httpOk({ leaveId, status });
}

// --- AUDIT TRAIL ---
async function getAuditLogs(queryParams: any, isAdmin: boolean, allowedClinics: Set<string>) {
  const { userId, clinicId, startDate, endDate, action, resource, limit } = queryParams || {};

  if (!isAdmin) {
    return httpErr(403, "Forbidden: Only admins can access audit logs");
  }

 
  if (clinicId && !hasClinicAccess(allowedClinics, clinicId)) {
    return httpErr(403, "Forbidden: no access to this clinic");
  }

  const params: any = {
    TableName: process.env.AUDIT_LOGS_TABLE || 'AuditLogs',
    Limit: limit ? parseInt(limit) : 100,
  };

  // Build filter expression
  const filterExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  if (userId) {
    filterExpressions.push('userId = :userId');
    expressionAttributeValues[':userId'] = userId;
  }

  if (clinicId) {
    filterExpressions.push('clinicId = :clinicId');
    expressionAttributeValues[':clinicId'] = clinicId;
  }

  if (action) {
    filterExpressions.push('#action = :action');
    expressionAttributeNames['#action'] = 'action';
    expressionAttributeValues[':action'] = action;
  }

  if (resource) {
    filterExpressions.push('#resource = :resource');
    expressionAttributeNames['#resource'] = 'resource';
    expressionAttributeValues[':resource'] = resource;
  }

  if (startDate && endDate) {
    filterExpressions.push('#timestamp BETWEEN :startDate AND :endDate');
    expressionAttributeNames['#timestamp'] = 'timestamp';
    expressionAttributeValues[':startDate'] = startDate;
    expressionAttributeValues[':endDate'] = endDate;
  }

  if (filterExpressions.length > 0) {
    params.FilterExpression = filterExpressions.join(' AND ');
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }
    params.ExpressionAttributeValues = expressionAttributeValues;
  }

  const { Items, Count } = await ddb.send(new ScanCommand(params));

  return httpOk({
    auditLogs: Items || [],
    count: Count || 0
  });
}

async function getResourceAuditTrail(
  resourceType: 'staff' | 'shift' | 'leave',
  resourceId: string,
  limit: number
) {
  const resourceMap: Record<string, string> = {
    'staff': 'STAFF',
    'shift': 'SHIFT',
    'leave': 'LEAVE'
  };

  const { Items } = await ddb.send(new QueryCommand({
    TableName: process.env.AUDIT_LOGS_TABLE || 'AuditLogs',
    IndexName: 'byResource',
    KeyConditionExpression: '#resource = :resource AND resourceId = :resourceId',
    ExpressionAttributeNames: { '#resource': 'resource' },
    ExpressionAttributeValues: {
      ':resource': resourceMap[resourceType],
      ':resourceId': resourceId
    },
    Limit: limit,
    ScanIndexForward: false // Most recent first
  }));

  return httpOk({
    auditTrail: Items || [],
    count: Items?.length || 0
  });
}
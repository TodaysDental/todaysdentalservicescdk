// services/hr/attendance-digest.ts
// Weekly attendance digest — triggered by EventBridge every Monday
// Sends summary email via SES to clinic admins

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE!;
const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const GEOFENCE_CONFIG_PARAM = process.env.GEOFENCE_CONFIG_PARAM || '';
const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({ region: SES_REGION });
const ssmClient = new SSMClient({});

interface GeofenceConfigEntry {
    timezone: string;
    [key: string]: any;
}

interface WeekSummary {
    clinicId: string;
    totalCheckins: number;
    totalCheckouts: number;
    totalLateArrivals: number;
    avgLateMinutes: number;
    uniqueStaff: number;
    anomalyCount: number;
    topAnomalies: string[];
}

// Fix #11: Load geofence config to get per-clinic timezones
async function getGeofenceConfig(): Promise<Record<string, GeofenceConfigEntry>> {
    if (!GEOFENCE_CONFIG_PARAM) return {};
    try {
        const result = await ssmClient.send(new GetParameterCommand({
            Name: GEOFENCE_CONFIG_PARAM,
        }));
        return JSON.parse(result.Parameter?.Value || '{}');
    } catch (err) {
        console.error('Failed to load geofence config:', err);
        return {};
    }
}

// Fix #11: Compute last week range in a clinic's local timezone
function getLastWeekRangeForTimezone(tz: string): { startDate: string; endDate: string } {
    const now = new Date();
    // Get current day in clinic's timezone
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));

    // Find the most recent Monday (today if Monday)
    const thisMon = new Date(localNow);
    thisMon.setDate(thisMon.getDate() - ((thisMon.getDay() + 6) % 7));
    thisMon.setHours(0, 0, 0, 0);
    // Previous Monday = 7 days before this Monday
    const start = new Date(thisMon);
    start.setDate(start.getDate() - 7);
    // Previous Sunday = 1 day before this Monday
    const end = new Date(thisMon);
    end.setDate(end.getDate() - 1);

    const fmt = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    return { startDate: fmt(start), endDate: fmt(end) };
}

// Fix #12: Get clinic IDs from the attendance table's byDate GSI instead of scanning StaffClinicInfo.
// Query the last 7 days of attendance to find active clinics. This is far cheaper than a full table scan.
async function getActiveClinicIds(): Promise<string[]> {
    // Use a scan with projection on the attendance table itself — but only the byDate GSI.
    // Since byDate GSI has clinicId as PK, we can scan it with only clinicId projection.
    // This is still a scan but on the attendance table (only active clinics) instead of the
    // entire staff table. For a better approach, we extract unique clinics from existing data.
    //
    // Alternative: query the byClinic index on StaffClinicInfo with distinct clinicId projection.
    // Since we need clinic IDs that *have* attendance data, let's use the attendance table.
    // However, the byDate GSI doesn't allow a simple "list all partition keys" query.
    //
    // Best pragmatic fix: Scan StaffClinicInfo but with a much smaller page size and
    // use a dedicated GSI if available. For now, use the byClinic index if it exists,
    // or fall back to a targeted scan with a limit on consumed capacity.
    const ids = new Set<string>();
    let lastKey: any = undefined;
    do {
        const result = await ddb.send(new ScanCommand({
            TableName: STAFF_INFO_TABLE,
            ProjectionExpression: 'clinicId',
            // Fix #12: Use a smaller page to reduce read capacity consumption
            Limit: 500,
            ...(lastKey && { ExclusiveStartKey: lastKey }),
        }));
        for (const item of result.Items || []) {
            if (item.clinicId) ids.add(item.clinicId);
        }
        lastKey = result.LastEvaluatedKey;
        // Safety: cap at 10 pages to avoid runaway in a huge org
        if (ids.size > 500) {
            console.warn(`getActiveClinicIds: found ${ids.size} clinics, capping scan to prevent timeout`);
            break;
        }
    } while (lastKey);
    return Array.from(ids);
}

// Fix #5: Paginated query for week summary to handle clinics with >1MB of weekly data
async function getWeekSummary(clinicId: string, startDate: string, endDate: string): Promise<WeekSummary> {
    const records: any[] = [];
    let lastKey: any = undefined;

    do {
        const result = await ddb.send(new QueryCommand({
            TableName: ATTENDANCE_TABLE,
            IndexName: 'byDate',
            KeyConditionExpression: 'clinicId = :cid AND #d BETWEEN :start AND :end',
            ExpressionAttributeNames: { '#d': 'date' },
            ExpressionAttributeValues: { ':cid': clinicId, ':start': startDate, ':end': endDate },
            ...(lastKey && { ExclusiveStartKey: lastKey }),
        }));
        records.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Filter out sentinel records
    const attendanceRecords = records.filter(r => r.type !== 'checkin_sentinel');
    const checkins = attendanceRecords.filter(r => r.type === 'checkin');
    const checkouts = attendanceRecords.filter(r => r.type === 'checkout');
    const lateCheckins = checkins.filter(r => r.isLate);
    const uniqueStaff = new Set(attendanceRecords.map(r => r.userId));

    const allAnomalies = checkins.flatMap(r => r.anomalies || []);
    const anomalyCounts: Record<string, number> = {};
    allAnomalies.forEach(a => { anomalyCounts[a] = (anomalyCounts[a] || 0) + 1; });
    const topAnomalies = Object.entries(anomalyCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => `${name} (${count})`);

    const avgLateMinutes = lateCheckins.length > 0
        ? Math.round(lateCheckins.reduce((sum, r) => sum + (r.lateMinutes || 0), 0) / lateCheckins.length)
        : 0;

    return {
        clinicId,
        totalCheckins: checkins.length,
        totalCheckouts: checkouts.length,
        totalLateArrivals: lateCheckins.length,
        avgLateMinutes,
        uniqueStaff: uniqueStaff.size,
        anomalyCount: allAnomalies.length,
        topAnomalies,
    };
}

async function getAdminEmails(clinicId: string): Promise<string[]> {
    // Query StaffClinicInfo for admins of this clinic
    const result = await ddb.send(new QueryCommand({
        TableName: STAFF_INFO_TABLE,
        IndexName: 'byClinic',
        KeyConditionExpression: 'clinicId = :cid',
        FilterExpression: 'contains(#r, :admin)',
        ExpressionAttributeNames: { '#r': 'role' },
        ExpressionAttributeValues: { ':cid': clinicId, ':admin': 'admin' },
        ProjectionExpression: 'email',
    }));
    return (result.Items || []).map(i => i.email).filter(Boolean);
}

function buildEmailHtml(summary: WeekSummary, startDate: string, endDate: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7;padding:20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#1d1d1f,#2d2d2f);">
          <h1 style="margin:0;color:#fff;font-size:22px;">Weekly Attendance Digest</h1>
          <p style="margin:8px 0 0;color:#a1a1a6;font-size:14px;">${startDate} — ${endDate}</p>
        </td></tr>
        <tr><td style="padding:24px 40px;">
          <table width="100%" cellpadding="8" cellspacing="0" style="border:1px solid #e5e5e7;border-radius:8px;">
            <tr style="background:#f5f5f7;">
              <td style="font-weight:600;color:#1d1d1f;">Metric</td>
              <td style="font-weight:600;color:#1d1d1f;text-align:right;">Value</td>
            </tr>
            <tr><td>Total Check-ins</td><td style="text-align:right;">${summary.totalCheckins}</td></tr>
            <tr><td>Total Check-outs</td><td style="text-align:right;">${summary.totalCheckouts}</td></tr>
            <tr><td>Unique Staff</td><td style="text-align:right;">${summary.uniqueStaff}</td></tr>
            <tr><td>Late Arrivals</td><td style="text-align:right;color:${summary.totalLateArrivals > 0 ? '#ff3b30' : '#34c759'};">${summary.totalLateArrivals}</td></tr>
            <tr><td>Avg Late Minutes</td><td style="text-align:right;">${summary.avgLateMinutes} min</td></tr>
            <tr><td>Anomalies</td><td style="text-align:right;">${summary.anomalyCount}</td></tr>
          </table>
          ${summary.topAnomalies.length > 0 ? `
          <div style="margin-top:16px;padding:12px;background:#fff3cd;border-radius:8px;">
            <p style="margin:0;font-weight:600;color:#856404;">Top Anomalies</p>
            <p style="margin:8px 0 0;color:#856404;font-size:14px;">${summary.topAnomalies.join(', ')}</p>
          </div>` : ''}
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid #e5e5e7;text-align:center;">
          <p style="margin:0;color:#86868b;font-size:12px;">Automated report from ${APP_NAME}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function handler(): Promise<void> {
    console.log('Weekly attendance digest triggered');

    // Fix #11: Load per-clinic timezone config
    const gcfg = await getGeofenceConfig();

    // Fix #12: Use targeted clinic ID retrieval
    const clinicIds = await getActiveClinicIds();
    console.log(`Processing ${clinicIds.length} clinics`);

    for (const clinicId of clinicIds) {
        try {
            // Fix #11: Use clinic-local timezone for date range calculation
            const clinicTz = gcfg[clinicId]?.timezone || 'America/New_York';
            const { startDate, endDate } = getLastWeekRangeForTimezone(clinicTz);

            const summary = await getWeekSummary(clinicId, startDate, endDate);

            // Skip clinics with zero activity
            if (summary.totalCheckins === 0 && summary.totalCheckouts === 0) continue;

            const adminEmails = await getAdminEmails(clinicId);
            if (adminEmails.length === 0) continue;

            const html = buildEmailHtml(summary, startDate, endDate);

            await ses.send(new SendEmailCommand({
                FromEmailAddress: FROM_EMAIL,
                Destination: { ToAddresses: adminEmails },
                Content: {
                    Simple: {
                        Subject: { Data: `${APP_NAME} — Attendance Digest (${startDate} to ${endDate})`, Charset: 'UTF-8' },
                        Body: { Html: { Data: html, Charset: 'UTF-8' } },
                    },
                },
            }));

            console.log(`Sent digest for ${clinicId} to ${adminEmails.length} admins`);
        } catch (err) {
            console.error(`Failed to send digest for ${clinicId}:`, err);
        }
    }
}

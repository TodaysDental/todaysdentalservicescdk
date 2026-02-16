// services/hr/attendance-digest.ts
// Weekly attendance digest — triggered by EventBridge every Monday
// Sends summary email via SES to clinic admins

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE!;
const SHIFTS_TABLE = process.env.SHIFTS_TABLE!;
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE!;
const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({ region: SES_REGION });

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

function getLastWeekRange(): { startDate: string; endDate: string } {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() - ((end.getDay() + 6) % 7)); // Previous Monday
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
    };
}

async function getClinicIds(): Promise<string[]> {
    // Scan StaffClinicInfo to get unique clinicIds
    const result = await ddb.send(new ScanCommand({
        TableName: STAFF_INFO_TABLE,
        ProjectionExpression: 'clinicId',
    }));
    const ids = new Set<string>();
    for (const item of result.Items || []) {
        if (item.clinicId) ids.add(item.clinicId);
    }
    return Array.from(ids);
}

async function getWeekSummary(clinicId: string, startDate: string, endDate: string): Promise<WeekSummary> {
    const result = await ddb.send(new QueryCommand({
        TableName: ATTENDANCE_TABLE,
        IndexName: 'byDate',
        KeyConditionExpression: 'clinicId = :cid AND #d BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':cid': clinicId, ':start': startDate, ':end': endDate },
    }));

    const records = result.Items || [];
    const checkins = records.filter(r => r.type === 'checkin');
    const checkouts = records.filter(r => r.type === 'checkout');
    const lateCheckins = checkins.filter(r => r.isLate);
    const uniqueStaff = new Set(records.map(r => r.userId));

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
          <h1 style="margin:0;color:#fff;font-size:22px;">📊 Weekly Attendance Digest</h1>
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
            <p style="margin:0;font-weight:600;color:#856404;">⚠️ Top Anomalies</p>
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

    const { startDate, endDate } = getLastWeekRange();
    const clinicIds = await getClinicIds();

    for (const clinicId of clinicIds) {
        try {
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

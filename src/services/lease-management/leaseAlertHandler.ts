/**
 * Lease Alert Handler
 * 
 * Scheduled Lambda that runs daily to check leases for dates that need alerts.
 * Sends individual alerts based on specific date triggers, NOT daily summaries.
 * 
 * Alert Triggers:
 * - Lease End Date: Alerts at 90, 60, 30, 7, 1 days before and on the day
 * - Renewal Request Start Date: Alerts at 30, 7, 1 days before and on the day
 * - Renewal Request End Date: Alerts at 30, 7, 1 days before and on the day
 * - Event Date: Alerts based on the event's reminder setting (1 day, 1 week, etc.)
 * 
 * Recipients:
 * - Users with Legal module access for the lease's clinic
 * - SuperAdmins
 * - Global SuperAdmins
 * 
 * Deduplication:
 * - Tracks sent alerts in the Lease table to avoid duplicate notifications
 */

import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { v4 as uuidv4 } from 'uuid';

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment Variables (matching HR module pattern for single source of truth)
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const APP_NAME = process.env.APP_NAME || 'TodaysDentalInsights';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalservices.com';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

// SES Client with explicit region (matching HR module)
const ses = new SESv2Client({ region: SES_REGION });

// Alert trigger days for each date type
const LEASE_END_ALERTS = [90, 60, 30, 7, 1, 0];  // Days before lease end
const RENEWAL_START_ALERTS = [30, 7, 1, 0];      // Days before renewal window opens
const RENEWAL_END_ALERTS = [30, 7, 1, 0];        // Days before renewal deadline

// ========================================
// TYPES
// ========================================

interface LeaseAlertItem {
  clinicId: string;
  leaseId: string;
  clinicName: string;
  address: string;
  alertType: 'lease_end' | 'renewal_start' | 'renewal_end' | 'event_reminder';
  eventTitle?: string;
  date: string;
  daysUntil: number;
}

interface AlertRecipient {
  email: string;
  name: string;
  clinicIds: string[];
  isGlobalAdmin: boolean;
}

interface LeaseEvent {
  id?: string;
  title?: string;
  date?: string;
  reminder?: string;
  description?: string;
}

// ========================================
// AWS SES EMAIL SENDER (matching HR module pattern)
// ========================================

/**
 * Send email using AWS SES (same pattern as HR shift notifications)
 */
async function sendEmailViaSES(
  to: string,
  subject: string,
  htmlBody: string,
  textBody: string
): Promise<boolean> {
  if (!FROM_EMAIL || !to) {
    console.warn('Skipping email: Missing FROM_EMAIL or recipient email.');
    return false;
  }

  try {
    const cmd = new SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: {
            Html: { Data: htmlBody },
            Text: { Data: textBody },
          },
        },
      },
      FromEmailAddress: FROM_EMAIL,
    });

    await ses.send(cmd);
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error: any) {
    console.error(`Failed to send email to ${to}:`, error.message);
    return false;
  }
}

// ========================================
// DATE CALCULATION HELPERS
// ========================================

/**
 * Calculate days until a date from today (0 = today, negative = past)
 */
function daysUntil(dateStr: string): number {
  if (!dateStr) return Infinity;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Parse reminder string to days before event
 */
function parseReminderDays(reminder: string | undefined): number | null {
  if (!reminder) return null;
  const lower = reminder.toLowerCase().trim();
  if (lower === 'day of' || lower === 'on the day') return 0;
  if (lower === '1 day before' || lower === '1 day') return 1;
  if (lower === '3 days before' || lower === '3 days') return 3;
  if (lower === '1 week before' || lower === '1 week' || lower === '7 days') return 7;
  if (lower === '2 weeks before' || lower === '2 weeks' || lower === '14 days') return 14;
  if (lower === '1 month before' || lower === '1 month' || lower === '30 days') return 30;
  return null;
}

/**
 * Get urgency label based on days
 */
function getUrgencyLabel(days: number): string {
  if (days === 0) return 'TODAY';
  if (days === 1) return 'TOMORROW';
  if (days <= 7) return 'THIS WEEK';
  if (days <= 30) return 'THIS MONTH';
  return 'UPCOMING';
}

/**
 * Get urgency color
 */
function getUrgencyColor(days: number): string {
  if (days === 0) return '#D32F2F';  // Red - TODAY
  if (days === 1) return '#E64A19';  // Deep Orange - TOMORROW
  if (days <= 7) return '#F57C00';   // Orange - THIS WEEK
  if (days <= 30) return '#FFA000';  // Amber - THIS MONTH
  return '#0288D1';                   // Blue - UPCOMING
}

// ========================================
// ALERT DEDUPLICATION
// ========================================

/**
 * Generate a unique key for an alert to prevent duplicates
 */
function generateAlertKey(
  leaseId: string,
  alertType: string,
  date: string,
  daysUntil: number,
  eventId?: string
): string {
  const eventPart = eventId ? `#${eventId}` : '';
  return `${leaseId}#${alertType}${eventPart}#${date}#${daysUntil}`;
}

/**
 * Check if an alert has already been sent today
 */
async function wasAlertSentToday(alertKey: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];

  try {
    const { Items } = await ddb.send(new QueryCommand({
      TableName: LEASE_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': 'ALERT_SENT',
        ':sk': `${today}#${alertKey}`,
      },
      Limit: 1,
    }));

    return (Items?.length || 0) > 0;
  } catch (error: any) {
    console.error('Error checking alert history:', error.message);
    return false;  // If we can't check, err on side of sending
  }
}

/**
 * Mark an alert as sent
 */
async function markAlertSent(
  alertKey: string,
  leaseId: string,
  alertType: string,
  recipientEmails: string[]
): Promise<void> {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  try {
    await ddb.send(new PutCommand({
      TableName: LEASE_TABLE_NAME,
      Item: {
        PK: 'ALERT_SENT',
        SK: `${today}#${alertKey}`,
        alertKey,
        leaseId,
        alertType,
        recipientEmails,
        sentAt: now,
        ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),  // Auto-delete after 7 days
      },
    }));
  } catch (error: any) {
    console.error('Error marking alert as sent:', error.message);
  }
}

// ========================================
// LEASE SCANNER
// ========================================

/**
 * Scan all leases and find alerts that need to be sent TODAY
 */
async function findAlertsToSend(): Promise<LeaseAlertItem[]> {
  const alertsToSend: LeaseAlertItem[] = [];

  // Scan all leases
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new ScanCommand({
      TableName: LEASE_TABLE_NAME,
      FilterExpression: 'begins_with(SK, :sk) AND (#status <> :deleted OR attribute_not_exists(#status))',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':sk': 'LEASE#',
        ':deleted': 'Deleted',
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    lastEvaluatedKey = LastEvaluatedKey;

    if (!Items) continue;

    for (const lease of Items) {
      const clinicId = lease.propertyInformation?.clinicId || lease.PK?.replace('CLINIC#', '') || '';
      const leaseId = lease.SK?.replace('LEASE#', '') || '';
      const clinicName = lease.propertyInformation?.clinicName || 'Unknown Clinic';
      const address = lease.propertyInformation?.address || '';
      const leaseTerms = lease.leaseTerms || {};
      const events: LeaseEvent[] = lease.events || [];

      // Check Lease End Date
      if (leaseTerms.endDate) {
        const days = daysUntil(leaseTerms.endDate);
        if (LEASE_END_ALERTS.includes(days)) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: 'lease_end',
            date: leaseTerms.endDate,
            daysUntil: days,
          });
        }
      }

      // Check Renewal Request Start Date
      if (leaseTerms.renewalRequestStartDate) {
        const days = daysUntil(leaseTerms.renewalRequestStartDate);
        if (RENEWAL_START_ALERTS.includes(days)) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: 'renewal_start',
            date: leaseTerms.renewalRequestStartDate,
            daysUntil: days,
          });
        }
      }

      // Check Renewal Request End Date
      if (leaseTerms.renewalRequestEndDate) {
        const days = daysUntil(leaseTerms.renewalRequestEndDate);
        if (RENEWAL_END_ALERTS.includes(days)) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: 'renewal_end',
            date: leaseTerms.renewalRequestEndDate,
            daysUntil: days,
          });
        }
      }

      // Check Events with reminders
      for (const event of events) {
        if (!event.date || !event.reminder) continue;

        const reminderDays = parseReminderDays(event.reminder);
        if (reminderDays === null) continue;

        const daysToEvent = daysUntil(event.date);

        // Send alert if today matches the reminder setting
        if (daysToEvent === reminderDays) {
          alertsToSend.push({
            clinicId,
            leaseId,
            clinicName,
            address,
            alertType: 'event_reminder',
            eventTitle: event.title || 'Lease Event',
            date: event.date,
            daysUntil: daysToEvent,
          });
        }
      }
    }
  } while (lastEvaluatedKey);

  console.log(`[LeaseAlerts] Found ${alertsToSend.length} potential alerts to send`);
  return alertsToSend;
}

// ========================================
// RECIPIENT RESOLUTION
// ========================================

/**
 * Find all users who should receive alerts for a given clinic
 */
async function findRecipientsForClinic(clinicId: string): Promise<AlertRecipient[]> {
  const recipients: AlertRecipient[] = [];

  // Scan all users
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new ScanCommand({
      TableName: STAFF_USER_TABLE,
      FilterExpression: 'isActive = :active OR attribute_not_exists(isActive)',
      ExpressionAttributeValues: { ':active': true },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    lastEvaluatedKey = LastEvaluatedKey;

    if (!Items) continue;

    for (const user of Items) {
      const email = user.email;
      if (!email) continue;

      const givenName = user.givenName || '';
      const familyName = user.familyName || '';
      const name = `${givenName} ${familyName}`.trim() || email;
      const isGlobalSuperAdmin = user.isGlobalSuperAdmin === true;
      const isSuperAdmin = user.isSuperAdmin === true;
      const clinicRoles = user.clinicRoles || [];

      // Global SuperAdmins and SuperAdmins receive all alerts
      if (isGlobalSuperAdmin || isSuperAdmin) {
        recipients.push({ email, name, clinicIds: [clinicId], isGlobalAdmin: true });
        continue;
      }

      // Check clinic-level access for Legal module
      for (const cr of clinicRoles) {
        if (cr.clinicId !== clinicId) continue;

        // Check if user is Admin at this clinic
        if (cr.role === 'Admin' || cr.role === 'SuperAdmin' || cr.role === 'Global super admin') {
          recipients.push({ email, name, clinicIds: [clinicId], isGlobalAdmin: false });
          break;
        }

        // Check for Legal module access
        const moduleAccess = cr.moduleAccess || [];
        const hasLegalAccess = moduleAccess.some(
          (ma: { module: string; permissions: string[] }) =>
            ma.module === 'Legal' && ma.permissions && ma.permissions.includes('read')
        );

        if (hasLegalAccess) {
          recipients.push({ email, name, clinicIds: [clinicId], isGlobalAdmin: false });
          break;
        }
      }
    }
  } while (lastEvaluatedKey);

  // Deduplicate by email
  const uniqueRecipients = new Map<string, AlertRecipient>();
  for (const r of recipients) {
    uniqueRecipients.set(r.email, r);
  }

  return Array.from(uniqueRecipients.values());
}

// ========================================
// EMAIL GENERATION
// ========================================

/**
 * Get alert type display label
 */
function getAlertTypeLabel(alertType: string): string {
  switch (alertType) {
    case 'lease_end': return 'Lease Expiration';
    case 'renewal_start': return 'Renewal Window Opens';
    case 'renewal_end': return 'Renewal Request Deadline';
    case 'event_reminder': return 'Event Reminder';
    default: return 'Lease Alert';
  }
}

/**
 * Get action-oriented message based on alert type and days
 */
function getAlertMessage(alert: LeaseAlertItem): string {
  const { alertType, daysUntil, eventTitle } = alert;

  const timePhrase = daysUntil === 0 ? 'today' :
    daysUntil === 1 ? 'tomorrow' :
      `in ${daysUntil} days`;

  switch (alertType) {
    case 'lease_end':
      return `Your lease expires ${timePhrase}. Please review and take necessary action.`;
    case 'renewal_start':
      return `Your renewal request window opens ${timePhrase}. Prepare your renewal documentation.`;
    case 'renewal_end':
      return `Your renewal request deadline is ${timePhrase}. Submit your renewal request before the deadline.`;
    case 'event_reminder':
      return `Reminder: "${eventTitle}" is scheduled ${timePhrase}.`;
    default:
      return `Important lease date coming up ${timePhrase}.`;
  }
}

/**
 * Generate HTML email for a single alert
 */
function generateAlertEmailHtml(alert: LeaseAlertItem, recipientName: string): string {
  const color = getUrgencyColor(alert.daysUntil);
  const urgencyLabel = getUrgencyLabel(alert.daysUntil);
  const dateStr = new Date(alert.date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${getAlertTypeLabel(alert.alertType)}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 32px;">
    
    <!-- Header with urgency badge -->
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; padding: 8px 16px; border-radius: 4px; font-size: 14px; font-weight: bold; color: white; background-color: ${color};">
        ${urgencyLabel}
      </span>
    </div>
    
    <!-- Alert Title -->
    <h1 style="color: ${color}; text-align: center; margin: 0 0 24px 0; font-size: 24px;">
      ${getAlertTypeLabel(alert.alertType)}
    </h1>
    
    <p style="margin-bottom: 16px;">Hello ${recipientName},</p>
    
    <p style="margin-bottom: 24px; font-size: 16px;">
      ${getAlertMessage(alert)}
    </p>
    
    <!-- Lease Details Card -->
    <div style="background-color: #f8f9fa; border-left: 4px solid ${color}; padding: 16px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; width: 120px;">Clinic:</td>
          <td style="padding: 8px 0;">${alert.clinicName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Address:</td>
          <td style="padding: 8px 0;">${alert.address || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Date:</td>
          <td style="padding: 8px 0;">${dateStr}</td>
        </tr>
        ${alert.eventTitle ? `
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Event:</td>
          <td style="padding: 8px 0;">${alert.eventTitle}</td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding: 8px 0; font-weight: bold;">Time Left:</td>
          <td style="padding: 8px 0; color: ${color}; font-weight: bold;">
            ${alert.daysUntil === 0 ? 'TODAY' : alert.daysUntil === 1 ? '1 day' : `${alert.daysUntil} days`}
          </td>
        </tr>
      </table>
    </div>
    
    <!-- CTA Button -->
    <div style="text-align: center; margin: 32px 0;">
      <a href="https://app.todaysdentalinsights.com/lease-management" 
         style="display: inline-block; padding: 12px 32px; background-color: #1976D2; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
        View Lease Details
      </a>
    </div>
    
    <hr style="margin: 32px 0; border: none; border-top: 1px solid #E0E0E0;" />
    
    <p style="color: #888; font-size: 12px; margin: 0; text-align: center;">
      This is an automated message from ${APP_NAME}.<br/>
      You are receiving this email because you have Legal module access.
    </p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text email for a single alert
 */
function generateAlertEmailText(alert: LeaseAlertItem, recipientName: string): string {
  const dateStr = new Date(alert.date).toLocaleDateString();
  const daysText = alert.daysUntil === 0 ? 'TODAY' : `in ${alert.daysUntil} days`;

  return `
${getAlertTypeLabel(alert.alertType).toUpperCase()}
${'='.repeat(40)}

Hello ${recipientName},

${getAlertMessage(alert)}

DETAILS:
- Clinic: ${alert.clinicName}
- Address: ${alert.address || 'N/A'}
- Date: ${dateStr}
${alert.eventTitle ? `- Event: ${alert.eventTitle}` : ''}
- Time Left: ${daysText}

View lease details: https://app.todaysdentalinsights.com/lease-management

---
This is an automated message from ${APP_NAME}.
  `.trim();
}

// ========================================
// SCHEDULED HANDLER
// ========================================

/**
 * Main scheduled handler
 * Runs daily to check for alerts that need to be sent based on specific date triggers
 */
export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log('[LeaseAlerts] Starting alert check:', new Date().toISOString());

  try {
    // 1. Find all alerts that should trigger today
    const alertsToSend = await findAlertsToSend();

    if (alertsToSend.length === 0) {
      console.log('[LeaseAlerts] No alerts to send today');
      return;
    }

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // 2. Process each alert
    for (const alert of alertsToSend) {
      const alertKey = generateAlertKey(
        alert.leaseId,
        alert.alertType,
        alert.date,
        alert.daysUntil,
        alert.eventTitle
      );

      // Check if already sent today (deduplication)
      const alreadySent = await wasAlertSentToday(alertKey);
      if (alreadySent) {
        console.log(`[LeaseAlerts] Skipping duplicate: ${alertKey}`);
        skippedCount++;
        continue;
      }

      // Find recipients for this clinic
      const recipients = await findRecipientsForClinic(alert.clinicId);
      if (recipients.length === 0) {
        console.log(`[LeaseAlerts] No recipients found for clinic: ${alert.clinicId}`);
        continue;
      }

      // Generate email subject
      const subject = alert.daysUntil === 0
        ? `🚨 [TODAY] ${getAlertTypeLabel(alert.alertType)} - ${alert.clinicName}`
        : `📅 [${alert.daysUntil} days] ${getAlertTypeLabel(alert.alertType)} - ${alert.clinicName}`;

      // Send to each recipient
      const recipientEmails: string[] = [];
      for (const recipient of recipients) {
        const htmlBody = generateAlertEmailHtml(alert, recipient.name);
        const textBody = generateAlertEmailText(alert, recipient.name);

        const sent = await sendEmailViaSES(recipient.email, subject, htmlBody, textBody);
        if (sent) {
          recipientEmails.push(recipient.email);
        } else {
          failedCount++;
        }
      }

      // Mark as sent
      if (recipientEmails.length > 0) {
        await markAlertSent(alertKey, alert.leaseId, alert.alertType, recipientEmails);
        sentCount++;
        console.log(`[LeaseAlerts] Sent alert: ${alertKey} to ${recipientEmails.length} recipients`);
      }
    }

    console.log(`[LeaseAlerts] Completed: ${sentCount} alerts sent, ${skippedCount} skipped (duplicates), ${failedCount} failed`);
  } catch (error: any) {
    console.error('[LeaseAlerts] Handler failed:', error);
    throw error;
  }
};

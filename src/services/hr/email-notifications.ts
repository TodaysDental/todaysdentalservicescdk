/**
 * HR Email Notifications
 * 
 * Centralized email sending functionality for HR-related notifications
 * Uses AWS SES v2 for sending emails
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { EMAIL_CONFIG } from './config';
import { utcToLocalDateTime, utcToLocalTime, normalizeTimeZoneOrUtc } from './timezone-utils';

// SES client
let sesClient: SESv2Client | null = null;

function getSesClient(): SESv2Client {
    if (!sesClient) {
        sesClient = new SESv2Client({ region: EMAIL_CONFIG.sesRegion });
    }
    return sesClient;
}

/**
 * Base email options
 */
interface BaseEmailOptions {
    to: string;
    subject: string;
    htmlBody: string;
    textBody: string;
}

/**
 * Send an email using SES
 */
async function sendEmail(options: BaseEmailOptions): Promise<boolean> {
    if (!EMAIL_CONFIG.enabled) {
        console.log('Email notifications disabled, skipping:', options.subject);
        return false;
    }

    if (!EMAIL_CONFIG.fromEmail || !options.to) {
        console.warn('Missing FROM_EMAIL or recipient, skipping email');
        return false;
    }

    try {
        const ses = getSesClient();
        await ses.send(new SendEmailCommand({
            Destination: { ToAddresses: [options.to] },
            Content: {
                Simple: {
                    Subject: { Data: options.subject },
                    Body: {
                        Html: { Data: options.htmlBody },
                        Text: { Data: options.textBody },
                    },
                },
            },
            FromEmailAddress: EMAIL_CONFIG.fromEmail,
        }));
        console.log(`Email sent successfully to ${options.to}`);
        return true;
    } catch (error) {
        console.error(`Failed to send email to ${options.to}:`, error);
        return false;
    }
}

/**
 * Generate email HTML wrapper
 */
function generateEmailWrapper(content: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px; background: #fff; }
        .header { background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; margin: -20px -20px 20px; }
        .header h2 { margin: 0; font-size: 1.5rem; }
        .content { padding: 0 10px; }
        .details { background: #f8f9fa; border-radius: 8px; padding: 15px; margin: 15px 0; }
        .detail-row { display: flex; margin-bottom: 8px; }
        .label { font-weight: bold; width: 140px; color: #555; }
        .value { flex: 1; color: #333; }
        .footer { margin-top: 30px; text-align: center; font-size: 0.8em; color: #777; border-top: 1px solid #eee; padding-top: 20px; }
        .btn { display: inline-block; background: #8b5cf6; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; margin-top: 15px; }
        .highlight { background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 15px 0; }
        .success { background: #d1fae5; border-left-color: #10b981; }
        .error { background: #fee2e2; border-left-color: #ef4444; }
      </style>
    </head>
    <body>
      <div class="container">
        ${content}
        <div class="footer">
          <p>This is an automated notification from ${EMAIL_CONFIG.appName}.</p>
          <p>Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ========================================
// SHIFT NOTIFICATIONS
// ========================================

interface ShiftNotificationData {
    recipientEmail: string;
    staffName: string;
    clinicId: string;
    clinicName?: string;
    startTime: string;
    endTime: string;
    role?: string;
    totalHours: number;
    hourlyRate: number;
    estimatedPay: number;
    clinicTimezone: string;
}

/**
 * Send shift assignment notification
 */
export async function sendShiftAssignmentEmail(data: ShiftNotificationData): Promise<boolean> {
    const tz = normalizeTimeZoneOrUtc(data.clinicTimezone);
    const startDate = new Date(data.startTime);
    const shiftDate = utcToLocalDateTime(startDate, tz);
    const startTimeLocal = utcToLocalTime(startDate, tz);
    const endTimeLocal = utcToLocalTime(new Date(data.endTime), tz);

    const subject = `New Shift Scheduled at ${data.clinicName || data.clinicId} for ${shiftDate.split(',')[0]}`;

    const htmlContent = `
    <div class="header">
      <h2>Shift Schedule Notification</h2>
    </div>
    <div class="content">
      <p>Dear ${data.staffName},</p>
      <p>A new shift has been scheduled for you. Please check the details below:</p>
      
      <div class="details">
        <div class="detail-row"><span class="label">Office:</span><span class="value">${data.clinicName || data.clinicId}</span></div>
        <div class="detail-row"><span class="label">Date:</span><span class="value">${shiftDate}</span></div>
        <div class="detail-row"><span class="label">Start Time:</span><span class="value">${startTimeLocal}</span></div>
        <div class="detail-row"><span class="label">End Time:</span><span class="value">${endTimeLocal}</span></div>
        <div class="detail-row"><span class="label">Role:</span><span class="value">${data.role || 'N/A'}</span></div>
        <div class="detail-row"><span class="label">Hours:</span><span class="value">${data.totalHours.toFixed(2)}</span></div>
        <div class="detail-row"><span class="label">Hourly Rate:</span><span class="value">$${data.hourlyRate.toFixed(2)}</span></div>
        <div class="detail-row"><span class="label">Estimated Pay:</span><span class="value">$${data.estimatedPay.toFixed(2)}</span></div>
      </div>
      
      <p>You can view and manage your shifts in the ${EMAIL_CONFIG.appName} portal.</p>
    </div>
  `;

    const textBody = `
New Shift Scheduled

Dear ${data.staffName},

A new shift has been scheduled for you at ${data.clinicName || data.clinicId}.

Date: ${shiftDate}
Time: ${startTimeLocal} - ${endTimeLocal}
Role: ${data.role || 'N/A'}
Hours: ${data.totalHours.toFixed(2)}
Estimated Pay: $${data.estimatedPay.toFixed(2)}

You can view and manage your shifts in the ${EMAIL_CONFIG.appName} portal.
  `.trim();

    return sendEmail({
        to: data.recipientEmail,
        subject,
        htmlBody: generateEmailWrapper(htmlContent),
        textBody,
    });
}

// ========================================
// LEAVE NOTIFICATIONS
// ========================================

interface LeaveNotificationData {
    recipientEmail: string;
    staffName: string;
    startDate: string;
    endDate: string;
    status: 'approved' | 'denied';
    reason?: string;
    approverName?: string;
    cancelledShifts?: number;
}

/**
 * Send leave status update notification
 */
export async function sendLeaveStatusEmail(data: LeaveNotificationData): Promise<boolean> {
    const isApproved = data.status === 'approved';
    const subject = `Leave Request ${isApproved ? 'Approved' : 'Denied'}: ${data.startDate} - ${data.endDate}`;

    const statusClass = isApproved ? 'success' : 'error';
    const statusIcon = isApproved ? '✓' : '✗';

    const htmlContent = `
    <div class="header">
      <h2>Leave Request Update</h2>
    </div>
    <div class="content">
      <p>Dear ${data.staffName},</p>
      
      <div class="highlight ${statusClass}">
        <strong>${statusIcon} Your leave request has been ${data.status}.</strong>
      </div>
      
      <div class="details">
        <div class="detail-row"><span class="label">Start Date:</span><span class="value">${data.startDate}</span></div>
        <div class="detail-row"><span class="label">End Date:</span><span class="value">${data.endDate}</span></div>
        <div class="detail-row"><span class="label">Status:</span><span class="value">${data.status.toUpperCase()}</span></div>
        ${data.approverName ? `<div class="detail-row"><span class="label">Processed By:</span><span class="value">${data.approverName}</span></div>` : ''}
        ${data.reason ? `<div class="detail-row"><span class="label">${isApproved ? 'Notes' : 'Reason'}:</span><span class="value">${data.reason}</span></div>` : ''}
      </div>
      
      ${isApproved && data.cancelledShifts && data.cancelledShifts > 0 ? `
        <div class="highlight">
          <strong>Note:</strong> ${data.cancelledShifts} shift(s) during this period have been automatically cancelled.
        </div>
      ` : ''}
    </div>
  `;

    const textBody = `
Leave Request ${data.status.toUpperCase()}

Dear ${data.staffName},

Your leave request has been ${data.status}.

Start Date: ${data.startDate}
End Date: ${data.endDate}
${data.approverName ? `Processed By: ${data.approverName}` : ''}
${data.reason ? `${isApproved ? 'Notes' : 'Reason'}: ${data.reason}` : ''}
${isApproved && data.cancelledShifts ? `\n${data.cancelledShifts} shift(s) during this period have been automatically cancelled.` : ''}
  `.trim();

    return sendEmail({
        to: data.recipientEmail,
        subject,
        htmlBody: generateEmailWrapper(htmlContent),
        textBody,
    });
}

// ========================================
// ADVANCE PAY NOTIFICATIONS
// ========================================

interface AdvancePayNotificationData {
    recipientEmail: string;
    staffName: string;
    amount: number;
    status: 'approved' | 'denied' | 'paid';
    reason?: string;
    approverName?: string;
    paymentReference?: string;
}

/**
 * Send advance pay status update notification
 */
export async function sendAdvancePayStatusEmail(data: AdvancePayNotificationData): Promise<boolean> {
    const subject = `Advance Pay Request ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}: $${data.amount.toFixed(2)}`;

    const statusClass = data.status === 'denied' ? 'error' : 'success';
    const statusMessages = {
        approved: 'Your advance pay request has been approved and will be processed.',
        denied: 'Your advance pay request has been denied.',
        paid: 'Your advance pay has been processed and will be deducted from your next paycheck.',
    };

    const htmlContent = `
    <div class="header">
      <h2>Advance Pay Update</h2>
    </div>
    <div class="content">
      <p>Dear ${data.staffName},</p>
      
      <div class="highlight ${statusClass}">
        <strong>${statusMessages[data.status]}</strong>
      </div>
      
      <div class="details">
        <div class="detail-row"><span class="label">Amount:</span><span class="value">$${data.amount.toFixed(2)}</span></div>
        <div class="detail-row"><span class="label">Status:</span><span class="value">${data.status.toUpperCase()}</span></div>
        ${data.approverName ? `<div class="detail-row"><span class="label">Processed By:</span><span class="value">${data.approverName}</span></div>` : ''}
        ${data.paymentReference ? `<div class="detail-row"><span class="label">Reference:</span><span class="value">${data.paymentReference}</span></div>` : ''}
        ${data.reason ? `<div class="detail-row"><span class="label">${data.status === 'denied' ? 'Reason' : 'Notes'}:</span><span class="value">${data.reason}</span></div>` : ''}
      </div>
    </div>
  `;

    const textBody = `
Advance Pay ${data.status.toUpperCase()}

Dear ${data.staffName},

${statusMessages[data.status]}

Amount: $${data.amount.toFixed(2)}
Status: ${data.status.toUpperCase()}
${data.approverName ? `Processed By: ${data.approverName}` : ''}
${data.paymentReference ? `Reference: ${data.paymentReference}` : ''}
${data.reason ? `${data.status === 'denied' ? 'Reason' : 'Notes'}: ${data.reason}` : ''}
  `.trim();

    return sendEmail({
        to: data.recipientEmail,
        subject,
        htmlBody: generateEmailWrapper(htmlContent),
        textBody,
    });
}

export default {
    sendShiftAssignmentEmail,
    sendLeaveStatusEmail,
    sendAdvancePayStatusEmail,
};

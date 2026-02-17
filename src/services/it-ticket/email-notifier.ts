// ============================================
// IT Ticket System — SES Email Notification Helper
// ============================================

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Ticket } from './types';

const ses = new SESv2Client({ region: process.env.SES_REGION || 'us-east-1' });
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com';

/**
 * Send a resolution notification email to the ticket reporter.
 * Called when an assignee resolves a ticket via PUT /tickets/{ticketId}/resolve.
 */
export async function sendResolutionEmail(ticket: Ticket): Promise<boolean> {
    if (!ticket.reporterEmail) {
        console.warn(`[ITTicket] No reporter email for ticket ${ticket.ticketId}, skipping notification`);
        return false;
    }

    const subject = `✅ Your ${ticket.ticketType === 'BUG' ? 'Bug Report' : 'Feature Request'} has been resolved — ${ticket.title}`;

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a73e8, #0d47a1); color: white; padding: 24px 30px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .body { padding: 30px; }
    .detail { margin-bottom: 16px; }
    .label { font-weight: 600; color: #555; display: inline-block; width: 130px; }
    .value { color: #333; }
    .resolution-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 16px; margin: 20px 0; border-radius: 0 4px 4px 0; }
    .resolution-box h3 { margin: 0 0 8px 0; color: #2e7d32; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
    .footer { background: #f5f5f5; padding: 16px 30px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #e0e0e0; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-resolved { background: #c8e6c9; color: #2e7d32; }
    .badge-bug { background: #ffcdd2; color: #c62828; }
    .badge-feature { background: #bbdefb; color: #1565c0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Ticket Resolved</h1>
    </div>
    <div class="body">
      <p>Hi <strong>${ticket.reporterName}</strong>,</p>
      <p>Your ticket has been resolved. Here are the details:</p>

      <div class="detail">
        <span class="label">Ticket ID:</span>
        <span class="value">${ticket.ticketId}</span>
      </div>
      <div class="detail">
        <span class="label">Type:</span>
        <span class="badge ${ticket.ticketType === 'BUG' ? 'badge-bug' : 'badge-feature'}">${ticket.ticketType === 'BUG' ? '🐛 Bug Report' : '✨ Feature Request'}</span>
      </div>
      <div class="detail">
        <span class="label">Title:</span>
        <span class="value">${ticket.title}</span>
      </div>
      <div class="detail">
        <span class="label">Module:</span>
        <span class="value">${ticket.module}</span>
      </div>
      <div class="detail">
        <span class="label">Status:</span>
        <span class="badge badge-resolved">✅ RESOLVED</span>
      </div>
      <div class="detail">
        <span class="label">Resolved By:</span>
        <span class="value">${ticket.assigneeName}</span>
      </div>
      <div class="detail">
        <span class="label">Resolved At:</span>
        <span class="value">${ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A'}</span>
      </div>

      ${ticket.resolution ? `
      <div class="resolution-box">
        <h3>Resolution Notes</h3>
        <p>${ticket.resolution.replace(/\n/g, '<br/>')}</p>
      </div>
      ` : ''}

      <p>If you believe this issue is not fully resolved, please reopen the ticket or add a comment.</p>

      <p>Thank you,<br/><strong>Today's Dental Insights IT Team</strong></p>
    </div>
    <div class="footer">
      <p>This is an automated notification from Today's Dental Insights IT Ticket System.</p>
      <p>Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

    const textBody = [
        `Hi ${ticket.reporterName},`,
        '',
        `Your ${ticket.ticketType === 'BUG' ? 'bug report' : 'feature request'} has been resolved.`,
        '',
        `Ticket ID: ${ticket.ticketId}`,
        `Title: ${ticket.title}`,
        `Module: ${ticket.module}`,
        `Resolved By: ${ticket.assigneeName}`,
        `Resolved At: ${ticket.resolvedAt || 'N/A'}`,
        '',
        ticket.resolution ? `Resolution Notes:\n${ticket.resolution}` : '',
        '',
        'If this issue is not fully resolved, please reopen the ticket or add a comment.',
        '',
        'Thank you,',
        "Today's Dental Insights IT Team",
    ].join('\n');

    try {
        const cmd = new SendEmailCommand({
            FromEmailAddress: FROM_EMAIL,
            Destination: { ToAddresses: [ticket.reporterEmail] },
            Content: {
                Simple: {
                    Subject: { Data: subject },
                    Body: {
                        Html: { Data: htmlBody },
                        Text: { Data: textBody },
                    },
                },
            },
            EmailTags: [
                { Name: 'source', Value: 'it-ticket-system' },
                { Name: 'type', Value: 'resolution-notification' },
                { Name: 'ticketId', Value: ticket.ticketId },
                { Name: 'module', Value: ticket.module },
            ],
        });

        const response = await ses.send(cmd);
        console.log(`[ITTicket] Resolution email sent to ${ticket.reporterEmail}, MessageId: ${response.MessageId}`);
        return true;
    } catch (error) {
        console.error(`[ITTicket] Failed to send resolution email to ${ticket.reporterEmail}:`, error);
        return false;
    }
}

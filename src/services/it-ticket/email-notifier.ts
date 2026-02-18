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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      margin: 0;
      padding: 40px 16px;
      background-color: #f4f4f5;
      color: #18181b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      max-width: 520px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .top-bar {
      height: 4px;
      background: #18181b;
    }
    .content {
      padding: 44px 40px 36px;
    }
    .badge {
      display: inline-block;
      background: #f0fdf4;
      color: #16a34a;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 5px 12px;
      border-radius: 20px;
      margin-bottom: 20px;
    }
    .content h1 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 700;
      color: #18181b;
      letter-spacing: -0.02em;
    }
    .subtitle {
      font-size: 15px;
      color: #71717a;
      margin: 0 0 32px;
      line-height: 1.5;
    }
    .divider {
      border: none;
      border-top: 1px solid #f0f0f0;
      margin: 0 0 24px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #fafafa;
    }
    .info-row:last-of-type {
      border-bottom: none;
    }
    .info-label {
      font-size: 13px;
      color: #a1a1aa;
      font-weight: 500;
    }
    .info-value {
      font-size: 13px;
      color: #18181b;
      font-weight: 600;
      text-align: right;
    }
    .resolution {
      margin: 28px 0 0;
      padding: 20px 24px;
      background: #fafafa;
      border-radius: 12px;
      border-left: 3px solid #18181b;
    }
    .resolution-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #a1a1aa;
      margin: 0 0 8px;
    }
    .resolution-text {
      font-size: 14px;
      color: #3f3f46;
      line-height: 1.7;
      margin: 0;
    }
    .footer {
      padding: 24px 40px;
      background: #fafafa;
      text-align: center;
      border-top: 1px solid #f0f0f0;
    }
    .footer p {
      margin: 0;
      font-size: 11px;
      color: #a1a1aa;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="content">
      <h1>Ticket Resolved</h1>
      <p class="subtitle">Hi ${ticket.reporterName}, your request <strong>${ticket.title}</strong> has been resolved by our team.</p>

      <hr class="divider" />

      <div class="info-row">
        <span class="info-label">Reference</span>
        <span class="info-value">#${ticket.ticketId.slice(-8).toUpperCase()}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Module</span>
        <span class="info-value">${ticket.module}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Handled by</span>
        <span class="info-value">${ticket.assigneeName || 'IT Team'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Resolved on</span>
        <span class="info-value">${ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
      </div>

      ${ticket.resolution ? `
      <div class="resolution">
        <p class="resolution-title">Resolution Note</p>
        <p class="resolution-text">${ticket.resolution.replace(/\\n/g, '<br/>')}</p>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <p>&copy; 2026 Today's Dental Technologies<br/>System-generated notification</p>
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

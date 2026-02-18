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

  const priorityLabel = ticket.priority || 'MEDIUM';
  const typeLabel = ticket.ticketType === 'BUG' ? 'Bug Report' : 'Feature Request';
  const resolvedDate = ticket.resolvedAt
    ? new Date(ticket.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const createdDate = ticket.createdAt
    ? new Date(ticket.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

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
      padding: 0;
      background: #0a0a0a;
      color: #ffffff;
      -webkit-font-smoothing: antialiased;
    }
    .outer {
      padding: 40px 16px;
      background: linear-gradient(145deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%);
      min-height: 100%;
    }
    .wrapper {
      max-width: 560px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    /* ── Top accent bar ── */
    .top-bar {
      height: 3px;
      background: linear-gradient(90deg, #ffffff 0%, rgba(255,255,255,0.3) 100%);
    }

    /* ── Header ── */
    .header {
      padding: 36px 40px 0;
    }
    .badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 5px 14px;
      border-radius: 20px;
      margin-bottom: 16px;
    }
    .header h1 {
      margin: 0 0 6px;
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.03em;
    }
    .subtitle {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.5);
      margin: 0 0 28px;
      line-height: 1.6;
    }
    .subtitle strong {
      color: #ffffff;
    }

    /* ── Glass divider ── */
    .divider {
      border: none;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      margin: 0;
    }

    /* ── Two-column data grid ── */
    .data-grid {
      padding: 28px 40px;
    }
    .data-row {
      display: flex;
      margin-bottom: 4px;
    }
    .data-row:last-child {
      margin-bottom: 0;
    }
    .data-cell {
      flex: 1;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .data-row:first-child .data-cell:first-child { border-radius: 12px 0 0 0; }
    .data-row:first-child .data-cell:last-child  { border-radius: 0 12px 0 0; }
    .data-row:last-child .data-cell:first-child   { border-radius: 0 0 0 12px; }
    .data-row:last-child .data-cell:last-child    { border-radius: 0 0 12px 0; }
    .data-label {
      display: block;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: rgba(255, 255, 255, 0.35);
      margin-bottom: 4px;
    }
    .data-value {
      display: block;
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
    }

    /* ── Resolution block ── */
    .resolution-wrap {
      padding: 0 40px 32px;
    }
    .resolution {
      padding: 20px 24px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      border-left: 3px solid #ffffff;
    }
    .resolution-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(255, 255, 255, 0.4);
      margin: 0 0 8px;
    }
    .resolution-text {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.75);
      line-height: 1.7;
      margin: 0;
    }

    /* ── Footer ── */
    .footer {
      padding: 20px 40px;
      background: rgba(0, 0, 0, 0.3);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      text-align: center;
    }
    .footer p {
      margin: 0;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.25);
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="outer">
    <div class="wrapper">
      <div class="top-bar"></div>

      <!-- Header -->
      <div class="header">
        <div class="badge">✓ Resolved</div>
        <h1>${ticket.title}</h1>
        <p class="subtitle">Hi <strong>${ticket.reporterName}</strong>, your ${typeLabel.toLowerCase()} has been resolved by our team.</p>
      </div>

      <hr class="divider" />

      <!-- Two-column data grid -->
      <div class="data-grid">
        <div class="data-row">
          <div class="data-cell">
            <span class="data-label">Reference</span>
            <span class="data-value">#${ticket.ticketId.slice(-8).toUpperCase()}</span>
          </div>
          <div class="data-cell">
            <span class="data-label">Type</span>
            <span class="data-value">${typeLabel}</span>
          </div>
        </div>
        <div class="data-row">
          <div class="data-cell">
            <span class="data-label">Module</span>
            <span class="data-value">${ticket.module}</span>
          </div>
          <div class="data-cell">
            <span class="data-label">Priority</span>
            <span class="data-value">${priorityLabel}</span>
          </div>
        </div>
        <div class="data-row">
          <div class="data-cell">
            <span class="data-label">Handled by</span>
            <span class="data-value">${ticket.assigneeName || 'IT Team'}</span>
          </div>
          <div class="data-cell">
            <span class="data-label">Resolved on</span>
            <span class="data-value">${resolvedDate}</span>
          </div>
        </div>
        <div class="data-row">
          <div class="data-cell">
            <span class="data-label">Reported by</span>
            <span class="data-value">${ticket.reporterName}</span>
          </div>
          <div class="data-cell">
            <span class="data-label">Created on</span>
            <span class="data-value">${createdDate}</span>
          </div>
        </div>
      </div>

      ${ticket.resolution ? `
      <!-- Resolution Note -->
      <div class="resolution-wrap">
        <div class="resolution">
          <p class="resolution-title">Resolution Note</p>
          <p class="resolution-text">${ticket.resolution.replace(/\\n/g, '<br/>')}</p>
        </div>
      </div>
      ` : ''}

      <div class="footer">
        <p>&copy; 2026 Today's Dental Technologies<br/>System-generated notification</p>
      </div>
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

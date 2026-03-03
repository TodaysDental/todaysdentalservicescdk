// ============================================
// IT Ticket System — SES Email Notification Helper
// ============================================

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Ticket } from './types';

const ses = new SESv2Client({ region: process.env.SES_REGION || 'us-east-1' });
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@todaysdentalservices.com';

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
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
      color: #1a1a1a;
      -webkit-font-smoothing: antialiased;
    }

    .outer {
      padding: 40px 20px;
      background-color: #f4f4f4;
    }

    .wrapper {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    }

    /* ── Dark Header ── */
    .header {
      background-color: #2d2d2d;
      padding: 40px 40px 32px;
      text-align: center;
    }

    .header h1 {
      margin: 0 0 8px;
      font-size: 28px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.02em;
    }

    .header-subtitle {
      font-size: 14px;
      color: #9ca3af;
      margin: 0;
    }

    /* ── Body ── */
    .body-content {
      padding: 36px 40px;
    }

    .greeting {
      font-size: 16px;
      color: #374151;
      margin: 0 0 8px;
      line-height: 1.6;
    }

    .greeting strong {
      color: #1a1a1a;
    }

    .intro {
      font-size: 15px;
      color: #4b5563;
      margin: 0 0 28px;
      line-height: 1.6;
    }

    .intro strong {
      color: #1a1a1a;
    }

    /* ── Dark Summary Bar ── */
    .summary-bar {
      background-color: #2d2d2d;
      border-radius: 12px;
      padding: 20px 28px;
      margin-bottom: 28px;
    }

    .summary-bar table {
      width: 100%;
      border-collapse: collapse;
    }

    .summary-bar td {
      text-align: center;
      vertical-align: top;
      padding: 0 8px;
    }

    .summary-label {
      display: block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #9ca3af;
      margin-bottom: 6px;
    }

    .summary-value {
      display: block;
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
    }

    /* ── Detail Table ── */
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
    }

    .detail-table thead th {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      padding: 10px 16px;
      text-align: left;
      border-bottom: 2px solid #e5e7eb;
    }

    .detail-table tbody td {
      font-size: 14px;
      color: #374151;
      padding: 14px 16px;
      border-bottom: 1px solid #f3f4f6;
    }

    .detail-table tbody tr:last-child td {
      border-bottom: none;
    }

    /* ── Resolution Block ── */
    .resolution-wrap {
      margin-bottom: 28px;
    }

    .resolution {
      background-color: #f9fafb;
      border-radius: 12px;
      padding: 24px 28px;
      border-left: 4px solid #2d2d2d;
    }

    .resolution-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #1a1a1a;
      margin: 0 0 10px;
    }

    .resolution-text {
      font-size: 14px;
      color: #4b5563;
      line-height: 1.7;
      margin: 0;
    }

    /* ── Dark Total Bar ── */
    .total-bar {
      background-color: #2d2d2d;
      border-radius: 12px;
      padding: 16px 28px;
      margin-bottom: 32px;
    }

    .total-bar table {
      width: 100%;
      border-collapse: collapse;
    }

    .total-bar td {
      vertical-align: middle;
      padding: 0;
    }

    .total-label {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .total-value {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      text-align: right;
    }

    /* ── CTA Button ── */
    .cta-wrap {
      text-align: center;
      padding: 0 0 8px;
    }

    .cta-btn {
      display: inline-block;
      background-color: #2d2d2d;
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      padding: 14px 36px;
      border-radius: 50px;
      text-decoration: none;
      letter-spacing: 0.02em;
    }

    /* ── Footer ── */
    .footer {
      padding: 28px 40px;
      text-align: center;
      border-top: 1px solid #f0f0f0;
    }

    .footer p {
      margin: 0;
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.6;
    }

    @media (max-width: 600px) {
      .body-content { padding: 28px 20px; }
      .header { padding: 32px 20px 24px; }
      .summary-bar { padding: 16px 16px; }
    }
  </style>
</head>
<body>
  <div class="outer">
    <div class="wrapper">

      <!-- Dark Header -->
      <div class="header">
        <h1>Issue Resolved</h1>
        <p class="header-subtitle">Today's Dental Insights</p>
      </div>

      <!-- Body -->
      <div class="body-content">
        <p class="greeting">Hello <strong>${ticket.reporterName}</strong>,</p>
        <p class="intro">Your <strong>${typeLabel}</strong> has been resolved. Review the details below.</p>

        <!-- Dark Summary Bar -->
        <div class="summary-bar">
          <table>
            <tr>
              <td style="text-align:left;">
                <span class="summary-label">Reference</span>
                <span class="summary-value">#${ticket.ticketId.slice(-8).toUpperCase()}</span>
              </td>
              <td>
                <span class="summary-label">Module</span>
                <span class="summary-value">${ticket.module}</span>
              </td>
              <td style="text-align:right;">
                <span class="summary-label">Priority</span>
                <span class="summary-value">${priorityLabel}</span>
              </td>
            </tr>
          </table>
        </div>

        <!-- Detail Table -->
        <table class="detail-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="font-weight:600;">Subject</td>
              <td>${ticket.title}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Handled by</td>
              <td>${ticket.assigneeName || 'IT Team'}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Submitted</td>
              <td>${createdDate}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Resolved on</td>
              <td>${resolvedDate}</td>
            </tr>
          </tbody>
        </table>

        ${ticket.resolution ? `
        <!-- Resolution Note -->
        <div class="resolution-wrap">
          <div class="resolution">
            <p class="resolution-title">Resolution Note</p>
            <p class="resolution-text">${ticket.resolution.replace(/\\n/g, '<br/>')}</p>
          </div>
        </div>
        ` : ''}

        <!-- Dark Total Bar -->
        <div class="total-bar">
          <table>
            <tr>
              <td><span class="total-label">Status</span></td>
              <td><span class="total-value">✅ Resolved</span></td>
            </tr>
          </table>
        </div>

        <!-- CTA Button -->
        <div class="cta-wrap">
          <a href="https://todaysdentalinsights.com" class="cta-btn">View Your Tickets</a>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <p>This is an automated notification from TodaysDentalInsights.<br/>Please do not reply to this email.</p>
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

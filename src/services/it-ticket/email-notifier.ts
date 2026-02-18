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
    :root {
      --bg-color: #f8f9fa;
      --container-bg: #ffffff;
      --glass-tile: rgba(255, 255, 255, 0.6);
      --glass-border: rgba(209, 213, 219, 0.3);
      --text-primary: #1a1a1a;
      --text-secondary: #6b7280;
      --text-muted: #9ca3af;
      --accent-gray: #f3f4f6;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      background-color: var(--bg-color);
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
    }

    .outer {
      padding: 60px 20px;
      background: radial-gradient(circle at top left, #ffffff, #f0f2f5);
      min-height: 100vh;
    }

    .wrapper {
      max-width: 580px;
      margin: 0 auto;
      background: var(--container-bg);
      border-radius: 32px;
      overflow: hidden;
      /* Smooth Layered Shadow */
      box-shadow: 
        0 4px 6px -1px rgba(0, 0, 0, 0.05), 
        0 10px 15px -3px rgba(0, 0, 0, 0.03),
        0 20px 25px -5px rgba(0, 0, 0, 0.02);
      border: 1px solid rgba(0, 0, 0, 0.02);
    }

    /* ── Header ── */
    .header {
      padding: 48px 40px 32px;
      text-align: center;
    }

    .badge {
      display: inline-block;
      background: var(--accent-gray);
      color: var(--text-primary);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 6px 16px;
      border-radius: 50px;
      margin-bottom: 20px;
      border: 1px solid rgba(0, 0, 0, 0.05);
    }

    .header h1 {
      margin: 0 0 12px;
      font-size: 32px;
      font-weight: 800;
      color: var(--text-primary);
      letter-spacing: -0.04em;
    }

    .subtitle {
      font-size: 16px;
      color: var(--text-secondary);
      margin: 0;
      line-height: 1.5;
    }

    .subtitle strong {
      color: var(--text-primary);
    }

    /* ── Data Grid (Glass Tiles) ── */
    .data-grid {
      padding: 0 40px 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .data-cell {
      padding: 20px;
      background: var(--glass-tile);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border);
      border-radius: 20px;
      transition: transform 0.2s ease;
    }

    /* Subject span full width */
    .subject-tile {
      grid-column: span 2;
    }

    .data-label {
      display: block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .data-value {
      display: block;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }

    /* ── Resolution Section ── */
    .resolution-wrap {
      padding: 0 40px 40px;
    }

    .resolution {
      padding: 28px;
      background: var(--accent-gray);
      border-radius: 24px;
      position: relative;
      overflow: hidden;
    }

    .resolution::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: var(--text-primary);
    }

    .resolution-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-primary);
      margin: 0 0 10px;
    }

    .resolution-text {
      font-size: 15px;
      color: var(--text-secondary);
      line-height: 1.7;
      margin: 0;
    }

    /* ── Footer ── */
    .footer {
      padding: 32px 40px;
      background: #fafafa;
      text-align: center;
      border-top: 1px solid #f0f0f0;
    }

    .footer p {
      margin: 0;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
    }

    @media (max-width: 600px) {
      .data-grid { grid-template-columns: 1fr; }
      .subject-tile { grid-column: span 1; }
      .header { padding: 40px 24px 24px; }
      .body { padding: 0 24px; }
    }
  </style>
</head>
<body>
  <div class="outer">
    <div class="wrapper">
      
      <div class="header">
        <div class="badge">Ticket Completion</div>
        <h1>Issue Resolved</h1>
        <p class="subtitle">Hi <strong>${ticket.reporterName}</strong>, the request you filed has been successfully processed by our team.</p>
      </div>

      <div class="data-grid">
        <div class="data-cell subject-tile">
          <span class="data-label">Subject</span>
          <span class="data-value">${ticket.title}</span>
        </div>
        <div class="data-cell">
          <span class="data-label">Reference</span>
          <span class="data-value">#${ticket.ticketId.slice(-8).toUpperCase()}</span>
        </div>
        <div class="data-cell">
          <span class="data-label">System Module</span>
          <span class="data-value">${ticket.module}</span>
        </div>
        <div class="data-cell">
          <span class="data-label">Handled by</span>
          <span class="data-value">${ticket.assigneeName || 'IT Team'}</span>
        </div>
        <div class="data-cell">
          <span class="data-label">Resolved on</span>
          <span class="data-value">${resolvedDate}</span>
        </div>
      </div>

      ${ticket.resolution ? `
      <div class="resolution-wrap">
        <div class="resolution">
          <p class="resolution-title">Resolution Note</p>
          <p class="resolution-text">${ticket.resolution.replace(/\\n/g, '<br/>')}</p>
        </div>
      </div>
      ` : ''}

      <div class="footer">
        <p>© 2026 Today's Dental Services<br/>System-generated status notification</p>
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

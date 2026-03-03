// ============================================
// Communication Module — Task Deadline Reminder (Scheduled Lambda)
// ============================================
// Runs HOURLY via EventBridge cron. Scans the FavorRequests (tasks) table for:
//   1. Tasks with deadlines within the next 1h, 12h, 18h, 24h → sends interval-specific reminder
//   2. Tasks with deadlines that have passed → sends "overdue" email
//
// Tracking fields to avoid duplicate reminders:
//   - `reminder1hSentAt`  — 1 hour before deadline
//   - `reminder12hSentAt` — 12 hours before deadline
//   - `reminder18hSentAt` — 18 hours before deadline
//   - `reminder24hSentAt` — 24 hours before deadline
//   - `overdueReminderSentAt` — after deadline has passed

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || 'no-reply@todaysdentalservices.com';
const USER_POOL_ID = process.env.USER_POOL_ID || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://todaysdentalinsights.com';

// SDK Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const ses = new SESv2Client({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

// ========================================
// TYPES
// ========================================
interface FavorRequest {
  favorRequestID: string;
  senderID: string;
  receiverID?: string;
  currentAssigneeID?: string;
  teamID?: string;
  title?: string;
  description?: string;
  status: string;
  priority?: string;
  category?: string;
  deadline?: string;
  createdAt: string;
  updatedAt: string;
  initialMessage?: string;
  // Granular reminder tracking
  reminder1hSentAt?: string;
  reminder12hSentAt?: string;
  reminder18hSentAt?: string;
  reminder24hSentAt?: string;
  // Legacy fields (kept for backward compatibility)
  deadlineReminderSentAt?: string;
  overdueReminderSentAt?: string;
  deletedBy?: string[];
}

interface UserDetails {
  email?: string;
  fullName: string;
}

// Reminder intervals (hours before deadline)
type ReminderInterval = '1h' | '12h' | '18h' | '24h' | 'overdue';

const REMINDER_INTERVALS: { interval: ReminderInterval; hours: number; sentField: string; label: string; emoji: string }[] = [
  { interval: '1h', hours: 1, sentField: 'reminder1hSentAt', label: '1 Hour', emoji: '🔴' },
  { interval: '12h', hours: 12, sentField: 'reminder12hSentAt', label: '12 Hours', emoji: '🟠' },
  { interval: '18h', hours: 18, sentField: 'reminder18hSentAt', label: '18 Hours', emoji: '🟡' },
  { interval: '24h', hours: 24, sentField: 'reminder24hSentAt', label: '24 Hours', emoji: '📢' },
];

// ========================================
// HANDLER
// ========================================
export async function handler(): Promise<{ statusCode: number; body: string }> {
  console.log('[DeadlineReminder] Lambda invoked at', new Date().toISOString());

  const now = new Date();

  try {
    // 1. Scan for all active tasks that have a deadline
    const tasks = await getTasksWithDeadlines();
    console.log(`[DeadlineReminder] Found ${tasks.length} active tasks with deadlines`);

    const counts: Record<string, number> = { overdue: 0, '1h': 0, '12h': 0, '18h': 0, '24h': 0, skipped: 0 };

    for (const task of tasks) {
      if (!task.deadline) continue;

      const deadlineDate = new Date(task.deadline);

      // Skip invalid dates
      if (isNaN(deadlineDate.getTime())) {
        counts.skipped++;
        continue;
      }

      // Skip tasks deleted for everyone
      if (task.status === 'deleted') {
        counts.skipped++;
        continue;
      }

      // Determine the assignee
      const assigneeID = task.currentAssigneeID || task.receiverID || task.senderID;
      if (!assigneeID) {
        console.warn(`[DeadlineReminder] Task ${task.favorRequestID} has no assignee, skipping`);
        counts.skipped++;
        continue;
      }

      // Check if deleted for the assignee
      if (task.deletedBy && task.deletedBy.includes(assigneeID)) {
        counts.skipped++;
        continue;
      }

      const hoursUntilDeadline = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);

      // ── OVERDUE CHECK ──
      if (hoursUntilDeadline < 0 && !task.overdueReminderSentAt) {
        console.log(`[DeadlineReminder] Task ${task.favorRequestID} is OVERDUE (deadline: ${task.deadline})`);
        const sent = await sendReminderEmail(task, assigneeID, 'overdue', deadlineDate, 0);
        if (sent) {
          await markReminderSent(task.favorRequestID, 'overdue');
          counts.overdue++;
        }
        continue;
      }

      // ── GRANULAR INTERVAL CHECKS ──
      // Check intervals from smallest (1h) to largest (24h)
      // Only send the most urgent applicable reminder that hasn't been sent yet
      let reminderSent = false;
      for (const { interval, hours, sentField, label } of REMINDER_INTERVALS) {
        if (hoursUntilDeadline > 0 && hoursUntilDeadline <= hours && !(task as any)[sentField]) {
          console.log(`[DeadlineReminder] Task ${task.favorRequestID} is due in ~${Math.round(hoursUntilDeadline)}h — sending ${label} reminder`);
          const sent = await sendReminderEmail(task, assigneeID, interval, deadlineDate, hoursUntilDeadline);
          if (sent) {
            await markReminderSent(task.favorRequestID, interval);
            counts[interval]++;
            reminderSent = true;
          }
          break; // Only send the most urgent (smallest interval) reminder
        }
      }

      if (!reminderSent) {
        counts.skipped++;
      }
    }

    const summary = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
    console.log(`[DeadlineReminder] Completed — ${summary}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, summary, totalTasks: tasks.length }),
    };
  } catch (error) {
    console.error('[DeadlineReminder] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: (error as Error).message }),
    };
  }
}

// ========================================
// DATA ACCESS
// ========================================

/**
 * Scans the FavorRequests table for active tasks with a deadline.
 */
async function getTasksWithDeadlines(): Promise<FavorRequest[]> {
  const allItems: FavorRequest[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: FAVORS_TABLE,
      FilterExpression: 'attribute_exists(deadline) AND deadline <> :empty AND #s <> :deleted AND #s <> :resolved AND #s <> :completed',
      ExpressionAttributeNames: {
        '#s': 'status',
      },
      ExpressionAttributeValues: {
        ':empty': '',
        ':deleted': 'deleted',
        ':resolved': 'resolved',
        ':completed': 'completed',
      },
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
    }));

    if (result.Items) {
      allItems.push(...(result.Items as FavorRequest[]));
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allItems;
}

/**
 * Marks a reminder as sent by updating the FavorRequest record in DynamoDB.
 */
async function markReminderSent(favorRequestID: string, type: ReminderInterval | 'overdue'): Promise<void> {
  const fieldMap: Record<string, string> = {
    '1h': 'reminder1hSentAt',
    '12h': 'reminder12hSentAt',
    '18h': 'reminder18hSentAt',
    '24h': 'reminder24hSentAt',
    'overdue': 'overdueReminderSentAt',
  };

  const field = fieldMap[type];
  if (!field) return;

  await ddb.send(new UpdateCommand({
    TableName: FAVORS_TABLE,
    Key: { favorRequestID },
    UpdateExpression: `SET ${field} = :now`,
    ExpressionAttributeValues: {
      ':now': new Date().toISOString(),
    },
  }));

  console.log(`[DeadlineReminder] Marked ${type} reminder sent for ${favorRequestID}`);
}

// ========================================
// USER LOOKUP
// ========================================

/**
 * Looks up user email and full name.
 * Falls back to using userID as email if it contains '@' (email-based userIDs).
 */
async function getUserDetails(userID: string): Promise<UserDetails> {
  const isEmail = userID.includes('@');

  if (!USER_POOL_ID) {
    console.warn('[DeadlineReminder] USER_POOL_ID is missing. Using userID as email fallback.');
    return {
      email: isEmail ? userID : undefined,
      fullName: isEmail ? userID.split('@')[0] : userID,
    };
  }

  try {
    const response = await cognito.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userID,
    }));

    const emailAttr = response.UserAttributes?.find(attr => attr.Name === 'email')?.Value;
    const givenNameAttr = response.UserAttributes?.find(attr => attr.Name === 'given_name')?.Value;
    const familyNameAttr = response.UserAttributes?.find(attr => attr.Name === 'family_name')?.Value;

    return {
      email: emailAttr || (isEmail ? userID : undefined),
      fullName: `${givenNameAttr || ''} ${familyNameAttr || ''}`.trim() || userID,
    };
  } catch (e) {
    console.error(`[DeadlineReminder] Error fetching Cognito user details for ${userID}:`, e);
    return {
      email: isEmail ? userID : undefined,
      fullName: isEmail ? userID.split('@')[0] : userID,
    };
  }
}

// ========================================
// EMAIL SENDING
// ========================================

async function sendReminderEmail(
  task: FavorRequest,
  assigneeID: string,
  type: ReminderInterval | 'overdue',
  deadlineDate: Date,
  hoursUntilDeadline: number
): Promise<boolean> {
  const user = await getUserDetails(assigneeID);

  if (!user.email) {
    console.warn(`[DeadlineReminder] No email found for user ${assigneeID}, skipping`);
    return false;
  }

  const taskTitle = task.title || task.initialMessage || 'Untitled Task';
  const priorityLabel = task.priority || 'Medium';
  const categoryLabel = task.category || '—';
  const deadlineFormatted = deadlineDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const deadlineTime = deadlineDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const isOverdue = type === 'overdue';
  const now = new Date();
  const hoursOverdue = isOverdue ? Math.round((now.getTime() - deadlineDate.getTime()) / (1000 * 60 * 60)) : 0;

  // Customize subject and urgency based on interval
  const intervalConfig = getIntervalConfig(type, taskTitle, hoursUntilDeadline, deadlineFormatted, deadlineTime, hoursOverdue);

  const htmlBody = buildEmailHtml({
    headerTitle: intervalConfig.headerTitle,
    headerColor: intervalConfig.headerColor,
    recipientName: user.fullName,
    urgencyMessage: intervalConfig.urgencyMessage,
    taskTitle,
    priorityLabel,
    categoryLabel,
    deadlineFormatted,
    deadlineTime,
    statusText: intervalConfig.statusText,
    isOverdue,
    hoursOverdue,
    taskDescription: task.description || task.initialMessage || '',
    frontendUrl: FRONTEND_URL,
    intervalLabel: intervalConfig.intervalLabel,
  });

  const textBody = [
    `Hi ${user.fullName},`,
    '',
    intervalConfig.urgencyPlainText,
    '',
    `Task: ${taskTitle}`,
    `Priority: ${priorityLabel}`,
    `Category: ${categoryLabel}`,
    `Deadline: ${deadlineFormatted} at ${deadlineTime}`,
    task.description ? `Description: ${task.description}` : '',
    '',
    'Please log in to the application to take action.',
    '',
    'Thank you,',
    "Today's Dental Insights",
  ].filter(Boolean).join('\n');

  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: SES_SOURCE_EMAIL,
      Destination: { ToAddresses: [user.email] },
      Content: {
        Simple: {
          Subject: { Data: intervalConfig.subject },
          Body: {
            Html: { Data: htmlBody },
            Text: { Data: textBody },
          },
        },
      },
      EmailTags: [
        { Name: 'source', Value: 'task-deadline-reminder' },
        { Name: 'type', Value: type },
        { Name: 'taskId', Value: task.favorRequestID },
        { Name: 'priority', Value: priorityLabel },
      ],
    }));

    console.log(`[DeadlineReminder] ${type} email sent to ${user.email} for task ${task.favorRequestID}`);
    return true;
  } catch (error) {
    console.error(`[DeadlineReminder] Failed to send ${type} email to ${user.email}:`, error);
    return false;
  }
}

// ========================================
// INTERVAL-SPECIFIC CONFIGURATION
// ========================================

interface IntervalConfig {
  subject: string;
  headerTitle: string;
  headerColor: string;
  statusText: string;
  urgencyMessage: string;
  urgencyPlainText: string;
  intervalLabel: string;
}

function getIntervalConfig(
  type: ReminderInterval | 'overdue',
  taskTitle: string,
  hoursUntil: number,
  deadlineFormatted: string,
  deadlineTime: string,
  hoursOverdue: number
): IntervalConfig {
  switch (type) {
    case '1h':
      return {
        subject: `🔴 URGENT: "${taskTitle}" — Due in 1 Hour!`,
        headerTitle: 'Urgent: Due in 1 Hour',
        headerColor: '#dc2626',
        statusText: '🔴 Due in 1 Hour',
        intervalLabel: '1 hour',
        urgencyMessage: `Your task is due in <strong style="color: #dc2626;">less than 1 hour</strong>! The deadline is <strong>${deadlineFormatted}</strong> at <strong>${deadlineTime}</strong>. Please complete it immediately.`,
        urgencyPlainText: `URGENT: Your task "${taskTitle}" is due in less than 1 hour! Deadline: ${deadlineFormatted} at ${deadlineTime}.`,
      };
    case '12h':
      return {
        subject: `🟠 Reminder: "${taskTitle}" — Due in 12 Hours`,
        headerTitle: 'Due in 12 Hours',
        headerColor: '#ea580c',
        statusText: '🟠 Due in 12 Hours',
        intervalLabel: '12 hours',
        urgencyMessage: `This is a reminder that your task is due in <strong>approximately 12 hours</strong> (<strong>${deadlineFormatted}</strong> at <strong>${deadlineTime}</strong>). Please plan accordingly to complete it on time.`,
        urgencyPlainText: `Reminder: Your task "${taskTitle}" is due in about 12 hours (${deadlineFormatted} at ${deadlineTime}).`,
      };
    case '18h':
      return {
        subject: `🟡 Heads Up: "${taskTitle}" — Due in 18 Hours`,
        headerTitle: 'Due in 18 Hours',
        headerColor: '#d97706',
        statusText: '🟡 Due in 18 Hours',
        intervalLabel: '18 hours',
        urgencyMessage: `Your task is due in <strong>approximately 18 hours</strong> (<strong>${deadlineFormatted}</strong> at <strong>${deadlineTime}</strong>). Make sure you have time allocated to complete it.`,
        urgencyPlainText: `Heads up: Your task "${taskTitle}" is due in about 18 hours (${deadlineFormatted} at ${deadlineTime}).`,
      };
    case '24h':
      return {
        subject: `📢 Reminder: "${taskTitle}" — Due Tomorrow`,
        headerTitle: 'Due Tomorrow',
        headerColor: '#2563eb',
        statusText: '📢 Due Tomorrow',
        intervalLabel: '24 hours',
        urgencyMessage: `This is a friendly reminder that your task is <strong>due tomorrow</strong> (<strong>${deadlineFormatted}</strong> at <strong>${deadlineTime}</strong>). Please plan to complete it before the deadline.`,
        urgencyPlainText: `Reminder: Your task "${taskTitle}" is due tomorrow (${deadlineFormatted} at ${deadlineTime}).`,
      };
    case 'overdue':
    default:
      return {
        subject: `⚠️ OVERDUE: "${taskTitle}" — Deadline has passed`,
        headerTitle: 'Task Overdue',
        headerColor: '#dc2626',
        statusText: `⚠️ Overdue by ${hoursOverdue}h`,
        intervalLabel: 'overdue',
        urgencyMessage: `This task is <strong style="color: #dc2626;">overdue</strong>. The deadline was <strong>${deadlineFormatted}</strong> at <strong>${deadlineTime}</strong>. Please complete it as soon as possible or update the deadline if needed.`,
        urgencyPlainText: `OVERDUE: Your task "${taskTitle}" is overdue by ${hoursOverdue} hours. Deadline was: ${deadlineFormatted} at ${deadlineTime}.`,
      };
  }
}

// ========================================
// EMAIL TEMPLATE
// ========================================

interface EmailTemplateParams {
  headerTitle: string;
  headerColor: string;
  recipientName: string;
  urgencyMessage: string;
  taskTitle: string;
  priorityLabel: string;
  categoryLabel: string;
  deadlineFormatted: string;
  deadlineTime: string;
  statusText: string;
  isOverdue: boolean;
  hoursOverdue: number;
  taskDescription: string;
  frontendUrl: string;
  intervalLabel: string;
}

function buildEmailHtml(params: EmailTemplateParams): string {
  const {
    headerTitle, headerColor, recipientName, urgencyMessage,
    taskTitle, priorityLabel, categoryLabel, deadlineFormatted,
    deadlineTime, statusText, isOverdue, taskDescription, frontendUrl,
  } = params;

  return `
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

    .header {
      background: linear-gradient(135deg, ${headerColor}, ${headerColor}dd);
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
      color: rgba(255,255,255,0.85);
      margin: 0;
    }

    .urgency-badge {
      display: inline-block;
      padding: 8px 20px;
      border-radius: 50px;
      font-size: 13px;
      font-weight: 700;
      color: ${headerColor};
      margin-top: 16px;
      background-color: #ffffff;
    }

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

    ${taskDescription ? `
    .description-wrap {
      margin-bottom: 28px;
    }

    .description {
      background-color: #f9fafb;
      border-radius: 12px;
      padding: 24px 28px;
      border-left: 4px solid ${headerColor};
    }

    .description-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #1a1a1a;
      margin: 0 0 10px;
    }

    .description-text {
      font-size: 14px;
      color: #4b5563;
      line-height: 1.7;
      margin: 0;
    }` : ''}

    .total-bar {
      background-color: ${headerColor};
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

      <!-- Header -->
      <div class="header">
        <h1>${headerTitle}</h1>
        <p class="header-subtitle">Today's Dental Insights</p>
        <span class="urgency-badge">${statusText}</span>
      </div>

      <!-- Body -->
      <div class="body-content">
        <p class="greeting">Hello <strong>${recipientName}</strong>,</p>
        <p class="intro">${urgencyMessage}</p>

        <!-- Dark Summary Bar -->
        <div class="summary-bar">
          <table>
            <tr>
              <td style="text-align:left;">
                <span class="summary-label">Priority</span>
                <span class="summary-value">${priorityLabel}</span>
              </td>
              <td>
                <span class="summary-label">Category</span>
                <span class="summary-value">${categoryLabel}</span>
              </td>
              <td style="text-align:right;">
                <span class="summary-label">Deadline</span>
                <span class="summary-value">${deadlineFormatted.split(',')[0] || deadlineFormatted}</span>
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
              <td style="font-weight:600;">Task</td>
              <td>${taskTitle}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Deadline</td>
              <td>${deadlineFormatted} at ${deadlineTime}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Priority</td>
              <td>${priorityLabel}</td>
            </tr>
            <tr>
              <td style="font-weight:600;">Category</td>
              <td>${categoryLabel}</td>
            </tr>
          </tbody>
        </table>

        ${taskDescription ? `
        <!-- Description Block -->
        <div class="description-wrap">
          <div class="description">
            <p class="description-title">Task Description</p>
            <p class="description-text">${taskDescription.replace(/\n/g, '<br/>')}</p>
          </div>
        </div>
        ` : ''}

        <!-- Status Bar -->
        <div class="total-bar">
          <table>
            <tr>
              <td><span class="total-label">Status</span></td>
              <td><span class="total-value">${statusText}</span></td>
            </tr>
          </table>
        </div>

        <!-- CTA Button -->
        <div class="cta-wrap">
          <a href="${frontendUrl}" class="cta-btn">View Task in App</a>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <p>This is an automated reminder from TodaysDentalInsights.<br/>Please do not reply to this email.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

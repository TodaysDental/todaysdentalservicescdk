// ============================================
// Communication Module — Task Deadline Reminder (Scheduled Lambda)
// ============================================
// Runs daily via EventBridge cron. Scans the FavorRequests (tasks) table for:
//   1. Tasks with deadlines within the next 24 hours → sends "upcoming deadline" email
//   2. Tasks with deadlines that have passed → sends "overdue" email
//
// Only sends ONE reminder per task per type to avoid spam:
//   - Uses `deadlineReminderSentAt` field to track "upcoming" reminder
//   - Uses `overdueReminderSentAt` field to track "overdue" reminder

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

// Environment Variables
const REGION = process.env.AWS_REGION || 'us-east-1';
const FAVORS_TABLE = process.env.FAVORS_TABLE || '';
const SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || 'no-reply@todaysdentalinsights.com';
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
    deadlineReminderSentAt?: string;
    overdueReminderSentAt?: string;
    deletedBy?: string[];
}

interface UserDetails {
    email?: string;
    fullName: string;
}

// ========================================
// HANDLER
// ========================================
export async function handler(): Promise<{ statusCode: number; body: string }> {
    console.log('[DeadlineReminder] Lambda invoked at', new Date().toISOString());

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 hours

    try {
        // 1. Scan for all active tasks that have a deadline
        const tasks = await getTasksWithDeadlines();
        console.log(`[DeadlineReminder] Found ${tasks.length} active tasks with deadlines`);

        let upcomingCount = 0;
        let overdueCount = 0;
        let skippedCount = 0;

        for (const task of tasks) {
            if (!task.deadline) continue;

            const deadlineDate = new Date(task.deadline);

            // Skip tasks deleted for everyone
            if (task.status === 'deleted') {
                skippedCount++;
                continue;
            }

            // Determine the assignee (currentAssigneeID takes priority, then receiverID, then senderID)
            const assigneeID = task.currentAssigneeID || task.receiverID || task.senderID;
            if (!assigneeID) {
                console.warn(`[DeadlineReminder] Task ${task.favorRequestID} has no assignee, skipping`);
                skippedCount++;
                continue;
            }

            // Check if deleted for the assignee
            if (task.deletedBy && task.deletedBy.includes(assigneeID)) {
                skippedCount++;
                continue;
            }

            // ── OVERDUE CHECK ──
            if (deadlineDate < now && !task.overdueReminderSentAt) {
                console.log(`[DeadlineReminder] Task ${task.favorRequestID} is OVERDUE (deadline: ${task.deadline})`);
                const sent = await sendReminderEmail(task, assigneeID, 'overdue', deadlineDate);
                if (sent) {
                    await markReminderSent(task.favorRequestID, 'overdue');
                    overdueCount++;
                }
                continue;
            }

            // ── UPCOMING CHECK (within next 24 hours) ──
            if (deadlineDate > now && deadlineDate <= tomorrow && !task.deadlineReminderSentAt) {
                console.log(`[DeadlineReminder] Task ${task.favorRequestID} is DUE SOON (deadline: ${task.deadline})`);
                const sent = await sendReminderEmail(task, assigneeID, 'upcoming', deadlineDate);
                if (sent) {
                    await markReminderSent(task.favorRequestID, 'upcoming');
                    upcomingCount++;
                }
                continue;
            }

            skippedCount++;
        }

        const summary = `Upcoming: ${upcomingCount}, Overdue: ${overdueCount}, Skipped: ${skippedCount}`;
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
 * Uses a FilterExpression to only return items that have a deadline field
 * and whose status is NOT 'deleted', 'resolved', or 'completed'.
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
 * This prevents duplicate reminders on subsequent Lambda invocations.
 */
async function markReminderSent(favorRequestID: string, type: 'upcoming' | 'overdue'): Promise<void> {
    const field = type === 'upcoming' ? 'deadlineReminderSentAt' : 'overdueReminderSentAt';

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
 * Looks up user email and full name from Cognito User Pool.
 * Same pattern used by ws-default.ts getUserDetails().
 */
async function getUserDetails(userID: string): Promise<UserDetails> {
    if (!USER_POOL_ID) {
        console.error('[DeadlineReminder] USER_POOL_ID is missing for user detail lookup.');
        return { fullName: userID };
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
            email: emailAttr,
            fullName: `${givenNameAttr || ''} ${familyNameAttr || ''}`.trim() || userID,
        };
    } catch (e) {
        console.error(`[DeadlineReminder] Error fetching Cognito user details for ${userID}:`, e);
        return { fullName: userID };
    }
}

// ========================================
// EMAIL SENDING
// ========================================

/**
 * Sends a deadline reminder email to the assignee.
 * Two types: 'upcoming' (due within 24h) and 'overdue' (past deadline).
 */
async function sendReminderEmail(
    task: FavorRequest,
    assigneeID: string,
    type: 'upcoming' | 'overdue',
    deadlineDate: Date
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

    const subject = isOverdue
        ? `⚠️ OVERDUE: "${taskTitle}" — Deadline has passed`
        : `⏰ Reminder: "${taskTitle}" — Due Tomorrow`;

    const headerTitle = isOverdue ? 'Task Overdue' : 'Deadline Reminder';
    const headerColor = isOverdue ? '#dc2626' : '#d97706';
    const statusText = isOverdue ? `⚠️ Overdue by ${hoursOverdue}h` : '⏰ Due Tomorrow';
    const urgencyMessage = isOverdue
        ? `This task is <strong style="color: #dc2626;">overdue</strong>. The deadline was <strong>${deadlineFormatted}</strong> at <strong>${deadlineTime}</strong>. Please complete it as soon as possible or update the deadline if needed.`
        : `This is a friendly reminder that your task is <strong>due tomorrow</strong> (<strong>${deadlineFormatted}</strong> at <strong>${deadlineTime}</strong>). Please make sure to complete it before the deadline.`;

    const htmlBody = buildEmailHtml({
        headerTitle,
        headerColor,
        recipientName: user.fullName,
        urgencyMessage,
        taskTitle,
        priorityLabel,
        categoryLabel,
        deadlineFormatted,
        deadlineTime,
        statusText,
        isOverdue,
        hoursOverdue,
        taskDescription: task.description || task.initialMessage || '',
        frontendUrl: FRONTEND_URL,
    });

    const textBody = [
        `Hi ${user.fullName},`,
        '',
        isOverdue
            ? `Your task "${taskTitle}" is OVERDUE. The deadline was ${deadlineFormatted} at ${deadlineTime}.`
            : `Reminder: Your task "${taskTitle}" is due tomorrow (${deadlineFormatted} at ${deadlineTime}).`,
        '',
        `Priority: ${priorityLabel}`,
        `Category: ${categoryLabel}`,
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
                    Subject: { Data: subject },
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

    .urgency-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 50px;
      font-size: 13px;
      font-weight: 700;
      color: #ffffff;
      margin-top: 12px;
      background-color: ${headerColor};
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
      border-left: 4px solid ${isOverdue ? '#dc2626' : '#d97706'};
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
      background-color: ${isOverdue ? '#dc2626' : '#d97706'};
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

      <!-- Dark Header -->
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

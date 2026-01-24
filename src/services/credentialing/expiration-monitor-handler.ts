/**
 * Expiration Monitoring Handler
 * 
 * Scheduled Lambda that scans credentials for upcoming expirations
 * and sends automated notifications via SMTP (using user email credentials).
 * 
 * Features:
 * - Daily scan for credentials expiring in 30/60/90 days
 * - Email notifications to credentialing team via SMTP
 * - Provider self-service reminder emails
 * - Auto-creation of renewal tasks
 * - Expiration dashboard data endpoint
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    ScanCommand,
    QueryCommand,
    PutCommand,
    GetCommand,
} from '@aws-sdk/lib-dynamodb';
import * as nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { StaffUser, UserEmailCredentials } from '../../shared/types/user';

// AWS Clients
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment Variables
const PROVIDERS_TABLE = process.env.PROVIDERS_TABLE!;
const PROVIDER_CREDENTIALS_TABLE = process.env.PROVIDER_CREDENTIALS_TABLE!;
const CREDENTIALING_TASKS_TABLE = process.env.CREDENTIALING_TASKS_TABLE!;
const EXPIRATION_ALERTS_TABLE = process.env.EXPIRATION_ALERTS_TABLE!;
const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
// The system email account used for sending credentialing notifications
const SYSTEM_SENDER_EMAIL = process.env.SYSTEM_SENDER_EMAIL || 'credentialing@todaysdentalinsights.com';
const CREDENTIALING_TEAM_EMAIL = process.env.CREDENTIALING_TEAM_EMAIL || 'credentialing@todaysdentalinsights.com';

// ========================================
// EMAIL CREDENTIALS HELPER
// ========================================

/**
 * Get email credentials for system sender from StaffUser table
 */
async function getSystemEmailCredentials(): Promise<UserEmailCredentials | null> {
    try {
        const result = await ddb.send(new GetCommand({
            TableName: STAFF_USER_TABLE,
            Key: { email: SYSTEM_SENDER_EMAIL },
        }));

        if (!result.Item) {
            console.warn(`[getSystemEmailCredentials] System sender not found: ${SYSTEM_SENDER_EMAIL}`);
            return null;
        }

        const user = result.Item as StaffUser;

        if (!user.userEmail) {
            console.warn(`[getSystemEmailCredentials] User ${SYSTEM_SENDER_EMAIL} does not have email credentials configured`);
            return null;
        }

        return user.userEmail;
    } catch (error: any) {
        console.error(`[getSystemEmailCredentials] Error fetching credentials:`, error.message);
        return null;
    }
}

/**
 * Send email using SMTP with user credentials
 */
async function sendEmailViaSMTP(
    creds: UserEmailCredentials,
    to: string,
    subject: string,
    body: string,
    senderName?: string
): Promise<boolean> {
    const { email, password, smtpHost, smtpPort } = creds;

    if (!email || !password || !smtpHost) {
        console.error('Missing email credentials for SMTP');
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || 587,
        secure: smtpPort === 465,
        auth: { user: email, pass: password },
    });

    const fromField = senderName ? `"${senderName}" <${email}>` : email;

    try {
        await transporter.sendMail({
            from: fromField,
            replyTo: email,
            to,
            subject,
            text: body,
        });
        console.log(`Email sent successfully to ${to}`);
        return true;
    } catch (error: any) {
        console.error(`Failed to send email to ${to}:`, error.message);
        return false;
    }
}

// ========================================
// TYPES
// ========================================

interface ExpiringCredential {
    providerId: string;
    providerName: string;
    credentialType: string;
    credentialId: string;
    expirationDate: string;
    daysUntilExpiry: number;
    urgency: 'critical' | 'warning' | 'notice';
    email?: string;
}

interface ExpirationAlert {
    alertId: string;
    providerId: string;
    credentialType: string;
    expirationDate: string;
    alertType: 'team_notification' | 'provider_reminder' | 'renewal_task';
    daysBeforeExpiry: number;
    sentAt: string;
    emailRecipient?: string;
    taskId?: string;
}

interface ExpirationSummary {
    critical: ExpiringCredential[]; // 0-30 days
    warning: ExpiringCredential[];  // 31-60 days
    notice: ExpiringCredential[];   // 61-90 days
    totalExpiring: number;
    scannedAt: string;
}

// ========================================
// CREDENTIAL EXPIRATION SCANNER
// ========================================

/**
 * Credential fields that have expiration dates
 */
const EXPIRATION_FIELDS: { field: string; label: string }[] = [
    { field: 'stateLicenseExpiry', label: 'State License' },
    { field: 'deaExpiry', label: 'DEA Certificate' },
    { field: 'cdsExpiry', label: 'CDS Certificate' },
    { field: 'malpracticeExpiry', label: 'Malpractice Insurance' },
    { field: 'boardCertExpiry', label: 'Board Certification' },
    { field: 'cprExpiry', label: 'CPR Certification' },
    { field: 'aclsExpiry', label: 'ACLS Certification' },
    { field: 'hipaaExpiry', label: 'HIPAA Training' },
    { field: 'oshaExpiry', label: 'OSHA Training' },
    { field: 'caqhExpiry', label: 'CAQH Attestation' },
];

/**
 * Scan all credentials for upcoming expirations
 */
async function scanExpiringCredentials(): Promise<ExpirationSummary> {
    const now = new Date();
    const scannedAt = now.toISOString();

    // Calculate threshold dates
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    const critical: ExpiringCredential[] = [];
    const warning: ExpiringCredential[] = [];
    const notice: ExpiringCredential[] = [];

    // Scan providers table
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
        const { Items, LastEvaluatedKey } = await ddb.send(new ScanCommand({
            TableName: PROVIDERS_TABLE,
            ExclusiveStartKey: lastEvaluatedKey,
        }));

        lastEvaluatedKey = LastEvaluatedKey;

        if (!Items) continue;

        for (const provider of Items) {
            const providerId = provider.providerId;
            const providerName = `${provider.firstName || ''} ${provider.lastName || ''}`.trim() || 'Unknown Provider';
            const email = provider.email;

            // Check each expiration field
            for (const { field, label } of EXPIRATION_FIELDS) {
                const expiryDate = provider[field];
                if (!expiryDate) continue;

                // Parse date string
                const expiryDateStr = typeof expiryDate === 'string' ? expiryDate.split('T')[0] : null;
                if (!expiryDateStr) continue;

                // Skip if already expired or not within 90 days
                if (expiryDateStr < today || expiryDateStr > in90Days) continue;

                // Calculate days until expiry
                const expiryTime = new Date(expiryDateStr).getTime();
                const daysUntilExpiry = Math.ceil((expiryTime - now.getTime()) / (24 * 60 * 60 * 1000));

                const credential: ExpiringCredential = {
                    providerId,
                    providerName,
                    credentialType: label,
                    credentialId: `${providerId}:${field}`,
                    expirationDate: expiryDateStr,
                    daysUntilExpiry,
                    urgency: daysUntilExpiry <= 30 ? 'critical' : daysUntilExpiry <= 60 ? 'warning' : 'notice',
                    email,
                };

                if (daysUntilExpiry <= 30) {
                    critical.push(credential);
                } else if (daysUntilExpiry <= 60) {
                    warning.push(credential);
                } else {
                    notice.push(credential);
                }
            }
        }
    } while (lastEvaluatedKey);

    // Sort by days until expiry
    const sortByDays = (a: ExpiringCredential, b: ExpiringCredential) => a.daysUntilExpiry - b.daysUntilExpiry;
    critical.sort(sortByDays);
    warning.sort(sortByDays);
    notice.sort(sortByDays);

    return {
        critical,
        warning,
        notice,
        totalExpiring: critical.length + warning.length + notice.length,
        scannedAt,
    };
}

// ========================================
// EMAIL NOTIFICATIONS
// ========================================

/**
 * Send daily summary email to credentialing team
 */
async function sendTeamSummaryEmail(summary: ExpirationSummary): Promise<void> {
    if (summary.totalExpiring === 0) {
        console.log('No expiring credentials found, skipping team email');
        return;
    }

    const criticalList = summary.critical.map(c =>
        `• ${c.providerName}: ${c.credentialType} expires in ${c.daysUntilExpiry} days (${c.expirationDate})`
    ).join('\n');

    const warningList = summary.warning.slice(0, 10).map(c =>
        `• ${c.providerName}: ${c.credentialType} expires in ${c.daysUntilExpiry} days`
    ).join('\n');

    const subject = `[Action Required] ${summary.critical.length} Credentials Expiring Soon`;

    const body = `
Credential Expiration Daily Report
==================================
Scan Date: ${new Date(summary.scannedAt).toLocaleDateString()}

CRITICAL (0-30 days): ${summary.critical.length} credentials
${criticalList || 'None'}

WARNING (31-60 days): ${summary.warning.length} credentials
${warningList || 'None'}
${summary.warning.length > 10 ? `... and ${summary.warning.length - 10} more` : ''}

NOTICE (61-90 days): ${summary.notice.length} credentials

TOTAL: ${summary.totalExpiring} credentials need attention

View full details: https://app.todaysdentalinsights.com/credentialing/expirations

---
This is an automated message from Today's Dental Insights Credentialing System.
    `.trim();

    // Get system email credentials
    const emailCreds = await getSystemEmailCredentials();
    if (!emailCreds) {
        console.error('Failed to get system email credentials, skipping team email');
        return;
    }

    const sent = await sendEmailViaSMTP(
        emailCreds,
        CREDENTIALING_TEAM_EMAIL,
        subject,
        body,
        'Credentialing Team'
    );

    if (sent) {
        console.log(`Team summary email sent to ${CREDENTIALING_TEAM_EMAIL}`);

        // Log the alert
        await logAlert({
            alertId: uuidv4(),
            providerId: 'SYSTEM',
            credentialType: 'DAILY_SUMMARY',
            expirationDate: summary.scannedAt,
            alertType: 'team_notification',
            daysBeforeExpiry: 0,
            sentAt: new Date().toISOString(),
            emailRecipient: CREDENTIALING_TEAM_EMAIL,
        });
    }
}

/**
 * Send reminder email to provider
 */
async function sendProviderReminderEmail(credential: ExpiringCredential): Promise<void> {
    if (!credential.email) {
        console.log(`No email for provider ${credential.providerId}, skipping reminder`);
        return;
    }

    const subject = `[Reminder] Your ${credential.credentialType} expires in ${credential.daysUntilExpiry} days`;

    const body = `
Dear ${credential.providerName},

This is a reminder that your ${credential.credentialType} will expire on ${credential.expirationDate}.

Please take action to renew your credential before the expiration date to avoid any interruptions in your payer enrollments.

Next Steps:
1. Obtain your renewed credential from the issuing authority
2. Upload the new document to your provider profile
3. Our credentialing team will update your payer enrollments

If you have any questions, please contact our credentialing team.

Best regards,
Today's Dental Insights Credentialing Team

---
This is an automated reminder from Today's Dental Insights.
    `.trim();

    // Get system email credentials
    const emailCreds = await getSystemEmailCredentials();
    if (!emailCreds) {
        console.error('Failed to get system email credentials, skipping provider reminder');
        return;
    }

    const sent = await sendEmailViaSMTP(
        emailCreds,
        credential.email,
        subject,
        body,
        'Credentialing Team'
    );

    if (sent) {
        console.log(`Provider reminder sent to ${credential.email}`);

        await logAlert({
            alertId: uuidv4(),
            providerId: credential.providerId,
            credentialType: credential.credentialType,
            expirationDate: credential.expirationDate,
            alertType: 'provider_reminder',
            daysBeforeExpiry: credential.daysUntilExpiry,
            sentAt: new Date().toISOString(),
            emailRecipient: credential.email,
        });
    }
}

// ========================================
// RENEWAL TASK CREATION
// ========================================

/**
 * Create renewal task for expiring credential
 */
async function createRenewalTask(credential: ExpiringCredential): Promise<string> {
    const taskId = uuidv4();
    const now = new Date().toISOString();

    const priority = credential.urgency === 'critical' ? 'urgent' :
        credential.urgency === 'warning' ? 'high' : 'medium';

    await ddb.send(new PutCommand({
        TableName: CREDENTIALING_TASKS_TABLE,
        Item: {
            taskId,
            providerId: credential.providerId,
            taskType: 'CREDENTIAL_RENEWAL',
            status: 'pending',
            priority,
            title: `Renew ${credential.credentialType} for ${credential.providerName}`,
            description: `${credential.credentialType} expires on ${credential.expirationDate} (${credential.daysUntilExpiry} days remaining)`,
            dueDate: credential.expirationDate,
            credentialType: credential.credentialType,
            createdAt: now,
            updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(taskId)',
    }));

    console.log(`Created renewal task ${taskId} for ${credential.credentialType}`);

    await logAlert({
        alertId: uuidv4(),
        providerId: credential.providerId,
        credentialType: credential.credentialType,
        expirationDate: credential.expirationDate,
        alertType: 'renewal_task',
        daysBeforeExpiry: credential.daysUntilExpiry,
        sentAt: now,
        taskId,
    });

    return taskId;
}

// ========================================
// ALERT LOGGING
// ========================================

async function logAlert(alert: ExpirationAlert): Promise<void> {
    await ddb.send(new PutCommand({
        TableName: EXPIRATION_ALERTS_TABLE,
        Item: alert,
    }));
}

/**
 * Check if alert was already sent today
 */
async function wasAlertSentToday(
    providerId: string,
    credentialType: string,
    alertType: string
): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];

    const { Items } = await ddb.send(new QueryCommand({
        TableName: EXPIRATION_ALERTS_TABLE,
        IndexName: 'byProviderCredential',
        KeyConditionExpression: 'providerId = :pid AND credentialType = :ct',
        FilterExpression: 'alertType = :at AND begins_with(sentAt, :today)',
        ExpressionAttributeValues: {
            ':pid': providerId,
            ':ct': credentialType,
            ':at': alertType,
            ':today': today,
        },
        Limit: 1,
    }));

    return (Items?.length || 0) > 0;
}

// ========================================
// SCHEDULED HANDLER (EventBridge)
// ========================================

export const scheduledHandler = async (event: ScheduledEvent): Promise<void> => {
    console.log('Starting daily credential expiration scan:', event.time);

    try {
        // Scan for expiring credentials
        const summary = await scanExpiringCredentials();
        console.log(`Found ${summary.totalExpiring} expiring credentials`);

        // Send team summary
        await sendTeamSummaryEmail(summary);

        // Process critical expirations (0-30 days)
        for (const credential of summary.critical) {
            // Send provider reminder if not already sent today
            const reminderSent = await wasAlertSentToday(
                credential.providerId,
                credential.credentialType,
                'provider_reminder'
            );
            if (!reminderSent && credential.email) {
                await sendProviderReminderEmail(credential);
            }

            // Create renewal task if not already created
            const taskCreated = await wasAlertSentToday(
                credential.providerId,
                credential.credentialType,
                'renewal_task'
            );
            if (!taskCreated) {
                await createRenewalTask(credential);
            }
        }

        // Send warning reminders (31-60 days) - weekly reminders
        const dayOfWeek = new Date().getDay();
        if (dayOfWeek === 1) { // Monday only for warnings
            for (const credential of summary.warning) {
                if (credential.email) {
                    const reminderSent = await wasAlertSentToday(
                        credential.providerId,
                        credential.credentialType,
                        'provider_reminder'
                    );
                    if (!reminderSent) {
                        await sendProviderReminderEmail(credential);
                    }
                }
            }
        }

        console.log('Daily expiration scan completed');
    } catch (error: any) {
        console.error('Expiration scan failed:', error);
        throw error;
    }
};

// ========================================
// API HANDLER (Dashboard endpoints)
// ========================================

let corsHeaders = buildCorsHeaders();

const httpErr = (code: number, msg: string): APIGatewayProxyResult => ({
    statusCode: code,
    headers: corsHeaders,
    body: JSON.stringify({ success: false, message: msg }),
});

const httpOk = (data: Record<string, any>): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ success: true, ...data }),
});

export const apiHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers?.origin || event.headers?.Origin;
    corsHeaders = buildCorsHeaders({}, origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const path = event.path.replace(/^\/credentialing/, '').replace(/\/$/, '');
    const method = event.httpMethod;

    try {
        // GET /expirations/summary - Get current expiration summary
        if (method === 'GET' && path === '/expirations/summary') {
            const summary = await scanExpiringCredentials();
            return httpOk({ summary });
        }

        // GET /expirations/critical - Get critical expirations only
        if (method === 'GET' && path === '/expirations/critical') {
            const summary = await scanExpiringCredentials();
            return httpOk({
                credentials: summary.critical,
                count: summary.critical.length,
            });
        }

        // GET /expirations/provider/{providerId} - Get expirations for specific provider
        if (method === 'GET' && path.match(/\/expirations\/provider\/.+/)) {
            const providerId = path.split('/')[3];
            const summary = await scanExpiringCredentials();

            const providerExpirations = [
                ...summary.critical,
                ...summary.warning,
                ...summary.notice,
            ].filter(c => c.providerId === providerId);

            return httpOk({ credentials: providerExpirations });
        }

        // GET /expirations/alerts?providerId=xxx - Get alert history
        if (method === 'GET' && path === '/expirations/alerts') {
            const providerId = event.queryStringParameters?.providerId;

            if (providerId) {
                const { Items } = await ddb.send(new QueryCommand({
                    TableName: EXPIRATION_ALERTS_TABLE,
                    IndexName: 'byProvider',
                    KeyConditionExpression: 'providerId = :pid',
                    ExpressionAttributeValues: { ':pid': providerId },
                    ScanIndexForward: false,
                    Limit: 50,
                }));
                return httpOk({ alerts: Items || [] });
            } else {
                // Get recent alerts (last 7 days)
                const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const { Items } = await ddb.send(new ScanCommand({
                    TableName: EXPIRATION_ALERTS_TABLE,
                    FilterExpression: 'sentAt >= :weekAgo',
                    ExpressionAttributeValues: { ':weekAgo': weekAgo },
                    Limit: 100,
                }));
                return httpOk({ alerts: Items || [] });
            }
        }

        // POST /expirations/scan - Trigger manual scan (for testing)
        if (method === 'POST' && path === '/expirations/scan') {
            const summary = await scanExpiringCredentials();
            return httpOk({ summary, message: 'Manual scan completed' });
        }

        // POST /expirations/notify - Send notifications for current expirations
        if (method === 'POST' && path === '/expirations/notify') {
            const summary = await scanExpiringCredentials();
            await sendTeamSummaryEmail(summary);
            return httpOk({ message: 'Team notification sent', summary });
        }

        return httpErr(404, 'Endpoint not found');
    } catch (error: any) {
        console.error('Expiration API error:', error);
        return httpErr(500, error.message);
    }
};

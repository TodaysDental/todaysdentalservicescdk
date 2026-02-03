/**
 * Push Notification Utilities for HR Module
 * 
 * Provides push notification integration for HR events:
 * - Shift assignments and updates
 * - Leave request approvals/denials
 * - Advance pay request updates
 * - Calendar event reminders
 * 
 * Uses the PushNotificationsStack's send-push Lambda for cross-stack invocation.
 * 
 * Robustness Features:
 * - Retry mechanism with exponential backoff
 * - Error tracking and detailed logging
 * - Idempotency keys to prevent duplicate notifications
 */

import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';

// Environment variables
const SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || '';
// Note: DEVICE_TOKENS_TABLE is handled internally by the send-push Lambda
// This utility only invokes the Lambda, so we only need the ARN
const PUSH_NOTIFICATIONS_ENABLED = !!SEND_PUSH_FUNCTION_ARN;

// Initialize Lambda client (reused across invocations)
let lambdaClient: LambdaClient | null = null;

function getLambdaClient(): LambdaClient {
    if (!lambdaClient) {
        lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
    }
    return lambdaClient;
}

// ========================================
// TYPES
// ========================================

export type HRNotificationType =
    | 'shift_assigned'
    | 'shift_updated'
    | 'shift_cancelled'
    | 'shift_reminder'
    | 'leave_submitted'
    | 'leave_approved'
    | 'leave_denied'
    | 'advance_pay_submitted'
    | 'advance_pay_approved'
    | 'advance_pay_denied'
    | 'advance_pay_disbursed'
    | 'calendar_event'
    | 'hr_alert';

export interface HRNotificationPayload {
    title: string;
    body: string;
    type: HRNotificationType;
    data?: Record<string, any>;
    sound?: string;
    idempotencyKey?: string;
}

export interface ShiftNotificationData {
    shiftId: string;
    staffId: string;
    staffName?: string;
    clinicId: string;
    clinicName?: string;
    startTime: string;
    endTime: string;
    role?: string;
}

export interface LeaveNotificationData {
    leaveId: string;
    staffId: string;
    staffName?: string;
    clinicId: string;
    clinicName?: string;
    startDate: string;
    endDate: string;
    leaveType: string;
    status: 'submitted' | 'approved' | 'denied';
    denyReason?: string;
}

export interface AdvancePayNotificationData {
    advanceId: string;
    staffId: string;
    staffName?: string;
    clinicId: string;
    clinicName?: string;
    amount: number;
    status: 'submitted' | 'approved' | 'denied' | 'disbursed';
    denyReason?: string;
}

export interface CalendarEventNotificationData {
    eventId: string;
    title: string;
    clinicId: string;
    clinicName?: string;
    startDateTime: string;
    endDateTime?: string;
    eventType: string;
}

export interface SendPushResult {
    success: boolean;
    sent?: number;
    failed?: number;
    error?: string;
}

// ========================================
// CORE PUSH NOTIFICATION FUNCTIONS
// ========================================

/**
 * Check if push notifications are enabled
 */
export function isPushNotificationsEnabled(): boolean {
    return PUSH_NOTIFICATIONS_ENABLED;
}

/**
 * Send push notification via the send-push Lambda
 * 
 * @param payload - The notification payload  
 * @param options - Configuration options
 *   - sync: If true, wait for response (default: false)
 *   - skipPreferenceCheck: If true, bypass user preferences
 */
async function invokeSendPushLambda(
    payload: any,
    options: { sync?: boolean; skipPreferenceCheck?: boolean } = {}
): Promise<SendPushResult> {
    if (!PUSH_NOTIFICATIONS_ENABLED) {
        console.log('[HRPush] Push notifications not configured, skipping');
        return { success: false, error: 'Push notifications not configured' };
    }

    const { sync = false, skipPreferenceCheck = false } = options;

    try {
        const invocationType: InvocationType = sync ? 'RequestResponse' : 'Event';

        const response = await getLambdaClient().send(new InvokeCommand({
            FunctionName: SEND_PUSH_FUNCTION_ARN,
            Payload: JSON.stringify({
                _internalCall: true,
                skipPreferenceCheck,
                ...payload,
            }),
            InvocationType: invocationType,
        }));

        // For async invocations, we only get StatusCode
        if (!sync) {
            const success = response.StatusCode === 202 || response.StatusCode === 200;
            if (!success) {
                console.error(`[HRPush] Async Lambda invocation failed, StatusCode: ${response.StatusCode}`);
            } else {
                console.log(`[HRPush] Async Lambda invoked, StatusCode: ${response.StatusCode}`);
            }
            return { success };
        }

        // For sync invocations, parse the response
        if (response.Payload) {
            const payloadStr = new TextDecoder().decode(response.Payload);
            const result = JSON.parse(payloadStr);

            // Handle Lambda function errors
            if (response.FunctionError) {
                console.error('[HRPush] Lambda function error:', result);
                return {
                    success: false,
                    error: result.errorMessage || 'Lambda function error',
                };
            }

            // Parse the response body
            if (result.statusCode && result.body) {
                const body = JSON.parse(result.body);
                return {
                    success: result.statusCode === 200,
                    sent: body.sent,
                    failed: body.failed,
                    error: body.error,
                };
            }

            return { success: true, ...result };
        }

        return { success: true };
    } catch (error: any) {
        console.error('[HRPush] Failed to invoke send-push Lambda:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send push notification with retry capability
 */
async function invokeSendPushLambdaWithRetry(
    payload: any,
    options: { sync?: boolean; skipPreferenceCheck?: boolean; maxRetries?: number } = {}
): Promise<SendPushResult> {
    const { maxRetries = 2, ...invokeOptions } = options;

    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await invokeSendPushLambda(payload, invokeOptions);

        if (result.success) {
            return result;
        }

        lastError = result.error;

        // Don't retry for certain errors
        if (result.error?.includes('not configured') ||
            result.error?.includes('Invalid') ||
            result.error?.includes('Unauthorized')) {
            break;
        }

        if (attempt < maxRetries) {
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
            console.log(`[HRPush] Retrying push notification (attempt ${attempt + 2})`);
        }
    }

    return { success: false, error: lastError || 'Max retries exceeded' };
}

/**
 * Format date/time for display
 */
function formatDateTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

/**
 * Format date for display
 */
function formatDate(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
}

// ========================================
// SHIFT NOTIFICATIONS
// ========================================

/**
 * Send notification when a shift is assigned to a staff member
 */
export async function sendShiftAssignedNotification(
    data: ShiftNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const startTime = formatDateTime(data.startTime);
    const clinicName = data.clinicName || data.clinicId;
    const idempotencyKey = `shift_assigned:${data.shiftId}:${data.staffId}`;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'New Shift Assigned',
            body: `You have been assigned a shift at ${clinicName} on ${startTime}`,
            type: 'shift_assigned',
            sound: 'default',
            idempotencyKey,
            data: {
                shiftId: data.shiftId,
                clinicId: data.clinicId,
                startTime: data.startTime,
                endTime: data.endTime,
                role: data.role,
                action: 'view_shift',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent shift assigned notification to ${data.staffId}`);
    }
}

/**
 * Send notification when a shift is updated
 */
export async function sendShiftUpdatedNotification(
    data: ShiftNotificationData,
    changesSummary: string
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const startTime = formatDateTime(data.startTime);
    const clinicName = data.clinicName || data.clinicId;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Shift Updated',
            body: `Your shift at ${clinicName} on ${startTime} has been updated: ${changesSummary}`,
            type: 'shift_updated',
            sound: 'default',
            data: {
                shiftId: data.shiftId,
                clinicId: data.clinicId,
                startTime: data.startTime,
                endTime: data.endTime,
                changes: changesSummary,
                action: 'view_shift',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent shift updated notification to ${data.staffId}`);
    }
}

/**
 * Send notification when a shift is cancelled
 */
export async function sendShiftCancelledNotification(
    data: ShiftNotificationData,
    reason?: string
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const startTime = formatDateTime(data.startTime);
    const clinicName = data.clinicName || data.clinicId;
    const reasonText = reason ? `: ${reason}` : '';

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Shift Cancelled',
            body: `Your shift at ${clinicName} on ${startTime} has been cancelled${reasonText}`,
            type: 'shift_cancelled',
            sound: 'default',
            data: {
                shiftId: data.shiftId,
                clinicId: data.clinicId,
                startTime: data.startTime,
                reason,
                action: 'view_shifts',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent shift cancelled notification to ${data.staffId}`);
    }
}

/**
 * Send shift reminder notification (e.g., 1 hour before shift)
 */
export async function sendShiftReminderNotification(
    data: ShiftNotificationData,
    minutesBefore: number
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const startTime = formatDateTime(data.startTime);
    const clinicName = data.clinicName || data.clinicId;
    const timeText = minutesBefore >= 60
        ? `${Math.floor(minutesBefore / 60)} hour${minutesBefore >= 120 ? 's' : ''}`
        : `${minutesBefore} minutes`;
    const idempotencyKey = `shift_reminder:${data.shiftId}:${minutesBefore}`;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Shift Reminder',
            body: `Your shift at ${clinicName} starts in ${timeText}`,
            type: 'shift_reminder',
            sound: 'default',
            idempotencyKey,
            data: {
                shiftId: data.shiftId,
                clinicId: data.clinicId,
                startTime: data.startTime,
                action: 'view_shift',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent shift reminder notification to ${data.staffId}`);
    }
}

// ========================================
// LEAVE NOTIFICATIONS
// ========================================

/**
 * Send notification when a leave request is submitted (to admins)
 */
export async function sendLeaveSubmittedNotification(
    data: LeaveNotificationData,
    adminUserIds: string[]
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED || adminUserIds.length === 0) return;

    const dateRange = data.startDate === data.endDate
        ? formatDate(data.startDate)
        : `${formatDate(data.startDate)} - ${formatDate(data.endDate)}`;
    const staffName = data.staffName || 'A staff member';
    const idempotencyKey = `leave_submitted:${data.leaveId}`;

    const result = await invokeSendPushLambda({
        userIds: adminUserIds,
        notification: {
            title: 'Leave Request Submitted',
            body: `${staffName} has requested ${data.leaveType} leave for ${dateRange}`,
            type: 'leave_submitted',
            sound: 'default',
            idempotencyKey,
            data: {
                leaveId: data.leaveId,
                staffId: data.staffId,
                clinicId: data.clinicId,
                leaveType: data.leaveType,
                startDate: data.startDate,
                endDate: data.endDate,
                action: 'review_leave',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent leave submitted notification to ${adminUserIds.length} admins`);
    }
}

/**
 * Send notification when a leave request is approved
 */
export async function sendLeaveApprovedNotification(
    data: LeaveNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const dateRange = data.startDate === data.endDate
        ? formatDate(data.startDate)
        : `${formatDate(data.startDate)} - ${formatDate(data.endDate)}`;
    const idempotencyKey = `leave_approved:${data.leaveId}`;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Leave Request Approved ✓',
            body: `Your ${data.leaveType} leave for ${dateRange} has been approved`,
            type: 'leave_approved',
            sound: 'default',
            idempotencyKey,
            data: {
                leaveId: data.leaveId,
                clinicId: data.clinicId,
                leaveType: data.leaveType,
                startDate: data.startDate,
                endDate: data.endDate,
                action: 'view_leave',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent leave approved notification to ${data.staffId}`);
    }
}

/**
 * Send notification when a leave request is denied
 */
export async function sendLeaveDeniedNotification(
    data: LeaveNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const dateRange = data.startDate === data.endDate
        ? formatDate(data.startDate)
        : `${formatDate(data.startDate)} - ${formatDate(data.endDate)}`;
    const reasonText = data.denyReason ? `: ${data.denyReason}` : '';
    const idempotencyKey = `leave_denied:${data.leaveId}`;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Leave Request Denied',
            body: `Your ${data.leaveType} leave for ${dateRange} has been denied${reasonText}`,
            type: 'leave_denied',
            sound: 'default',
            idempotencyKey,
            data: {
                leaveId: data.leaveId,
                clinicId: data.clinicId,
                leaveType: data.leaveType,
                startDate: data.startDate,
                endDate: data.endDate,
                denyReason: data.denyReason,
                action: 'view_leave',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent leave denied notification to ${data.staffId}`);
    }
}

// ========================================
// ADVANCE PAY NOTIFICATIONS
// ========================================

/**
 * Send notification when an advance pay request is submitted (to admins)
 */
export async function sendAdvancePaySubmittedNotification(
    data: AdvancePayNotificationData,
    adminUserIds: string[]
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED || adminUserIds.length === 0) return;

    const staffName = data.staffName || 'A staff member';
    const amountStr = formatCurrency(data.amount);
    const idempotencyKey = `advance_pay_submitted:${data.advanceId}`;

    const result = await invokeSendPushLambda({
        userIds: adminUserIds,
        notification: {
            title: 'Advance Pay Request',
            body: `${staffName} has requested an advance pay of ${amountStr}`,
            type: 'advance_pay_submitted',
            sound: 'default',
            idempotencyKey,
            data: {
                advanceId: data.advanceId,
                staffId: data.staffId,
                clinicId: data.clinicId,
                amount: data.amount,
                action: 'review_advance_pay',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent advance pay submitted notification to ${adminUserIds.length} admins`);
    }
}

/**
 * Send notification when an advance pay request is approved
 */
export async function sendAdvancePayApprovedNotification(
    data: AdvancePayNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const amountStr = formatCurrency(data.amount);
    const idempotencyKey = `advance_pay_approved:${data.advanceId}`;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Advance Pay Approved ✓',
            body: `Your advance pay request of ${amountStr} has been approved`,
            type: 'advance_pay_approved',
            sound: 'default',
            idempotencyKey,
            data: {
                advanceId: data.advanceId,
                clinicId: data.clinicId,
                amount: data.amount,
                action: 'view_advance_pay',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent advance pay approved notification to ${data.staffId}`);
    }
}

/**
 * Send notification when an advance pay request is denied
 */
export async function sendAdvancePayDeniedNotification(
    data: AdvancePayNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const amountStr = formatCurrency(data.amount);
    const reasonText = data.denyReason ? `: ${data.denyReason}` : '';
    const idempotencyKey = `advance_pay_denied:${data.advanceId}`;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Advance Pay Denied',
            body: `Your advance pay request of ${amountStr} has been denied${reasonText}`,
            type: 'advance_pay_denied',
            sound: 'default',
            idempotencyKey,
            data: {
                advanceId: data.advanceId,
                clinicId: data.clinicId,
                amount: data.amount,
                denyReason: data.denyReason,
                action: 'view_advance_pay',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent advance pay denied notification to ${data.staffId}`);
    }
}

/**
 * Send notification when an advance pay is disbursed
 */
export async function sendAdvancePayDisbursedNotification(
    data: AdvancePayNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const amountStr = formatCurrency(data.amount);
    const idempotencyKey = `advance_pay_disbursed:${data.advanceId}`;

    const result = await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Advance Pay Disbursed 💵',
            body: `Your advance pay of ${amountStr} has been disbursed`,
            type: 'advance_pay_disbursed',
            sound: 'default',
            idempotencyKey,
            data: {
                advanceId: data.advanceId,
                clinicId: data.clinicId,
                amount: data.amount,
                action: 'view_advance_pay',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent advance pay disbursed notification to ${data.staffId}`);
    }
}

// ========================================
// CALENDAR EVENT NOTIFICATIONS
// ========================================

/**
 * Send notification for a calendar event (to specific users)
 */
export async function sendCalendarEventNotification(
    data: CalendarEventNotificationData,
    userIds: string[]
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED || userIds.length === 0) return;

    const startTime = formatDateTime(data.startDateTime);
    const clinicName = data.clinicName || data.clinicId;
    const idempotencyKey = `calendar_event:${data.eventId}`;

    const result = await invokeSendPushLambda({
        userIds,
        notification: {
            title: data.title,
            body: `${data.eventType} at ${clinicName} on ${startTime}`,
            type: 'calendar_event',
            sound: 'default',
            idempotencyKey,
            data: {
                eventId: data.eventId,
                clinicId: data.clinicId,
                startDateTime: data.startDateTime,
                endDateTime: data.endDateTime,
                eventType: data.eventType,
                action: 'view_calendar',
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent calendar event notification to ${userIds.length} users`);
    }
}

/**
 * Send notification to all staff in a clinic
 */
export async function sendClinicHRAlert(
    clinicId: string,
    title: string,
    message: string,
    alertData?: Record<string, any>
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const result = await invokeSendPushLambda({
        clinicId,
        notification: {
            title,
            body: message,
            type: 'hr_alert',
            sound: 'default',
            data: {
                clinicId,
                ...alertData,
                action: 'view_hr_dashboard',
                timestamp: new Date().toISOString(),
            },
        },
    });

    if (result.success) {
        console.log(`[HRPush] Sent HR alert to clinic ${clinicId}: ${title}`);
    }
}

/**
 * Send notification with full result details
 * Returns detailed information about delivery success/failure
 */
export async function sendNotificationWithDetails(
    target: { userId?: string; userIds?: string[]; clinicId?: string },
    notification: HRNotificationPayload,
    options: { sync?: boolean; skipPreferenceCheck?: boolean } = {}
): Promise<SendPushResult> {
    return invokeSendPushLambdaWithRetry({
        ...target,
        notification,
    }, { ...options, sync: true });
}

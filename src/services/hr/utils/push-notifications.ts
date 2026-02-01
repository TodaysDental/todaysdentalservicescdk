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
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Environment variables
const SEND_PUSH_FUNCTION_ARN = process.env.SEND_PUSH_FUNCTION_ARN || '';
const DEVICE_TOKENS_TABLE = process.env.DEVICE_TOKENS_TABLE || '';
const PUSH_NOTIFICATIONS_ENABLED = !!(SEND_PUSH_FUNCTION_ARN && DEVICE_TOKENS_TABLE);

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
 */
async function invokeSendPushLambda(payload: any): Promise<boolean> {
    if (!PUSH_NOTIFICATIONS_ENABLED) {
        console.log('[HRPush] Push notifications not configured, skipping');
        return false;
    }

    try {
        const response = await getLambdaClient().send(new InvokeCommand({
            FunctionName: SEND_PUSH_FUNCTION_ARN,
            Payload: JSON.stringify({
                _internalCall: true,
                ...payload,
            }),
            InvocationType: 'Event', // Async - don't wait for response
        }));

        console.log(`[HRPush] Lambda invoked, StatusCode: ${response.StatusCode}`);
        return response.StatusCode === 202 || response.StatusCode === 200;
    } catch (error: any) {
        console.error('[HRPush] Failed to invoke send-push Lambda:', error.message);
        return false;
    }
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

    await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'New Shift Assigned',
            body: `You have been assigned a shift at ${clinicName} on ${startTime}`,
            type: 'shift_assigned',
            sound: 'default',
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

    console.log(`[HRPush] Sent shift assigned notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
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

    console.log(`[HRPush] Sent shift updated notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
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

    console.log(`[HRPush] Sent shift cancelled notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Shift Reminder',
            body: `Your shift at ${clinicName} starts in ${timeText}`,
            type: 'shift_reminder',
            sound: 'default',
            data: {
                shiftId: data.shiftId,
                clinicId: data.clinicId,
                startTime: data.startTime,
                action: 'view_shift',
            },
        },
    });

    console.log(`[HRPush] Sent shift reminder notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
        userIds: adminUserIds,
        notification: {
            title: 'Leave Request Submitted',
            body: `${staffName} has requested ${data.leaveType} leave for ${dateRange}`,
            type: 'leave_submitted',
            sound: 'default',
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

    console.log(`[HRPush] Sent leave submitted notification to ${adminUserIds.length} admins`);
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

    await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Leave Request Approved ✓',
            body: `Your ${data.leaveType} leave for ${dateRange} has been approved`,
            type: 'leave_approved',
            sound: 'default',
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

    console.log(`[HRPush] Sent leave approved notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Leave Request Denied',
            body: `Your ${data.leaveType} leave for ${dateRange} has been denied${reasonText}`,
            type: 'leave_denied',
            sound: 'default',
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

    console.log(`[HRPush] Sent leave denied notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
        userIds: adminUserIds,
        notification: {
            title: 'Advance Pay Request',
            body: `${staffName} has requested an advance pay of ${amountStr}`,
            type: 'advance_pay_submitted',
            sound: 'default',
            data: {
                advanceId: data.advanceId,
                staffId: data.staffId,
                clinicId: data.clinicId,
                amount: data.amount,
                action: 'review_advance_pay',
            },
        },
    });

    console.log(`[HRPush] Sent advance pay submitted notification to ${adminUserIds.length} admins`);
}

/**
 * Send notification when an advance pay request is approved
 */
export async function sendAdvancePayApprovedNotification(
    data: AdvancePayNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const amountStr = formatCurrency(data.amount);

    await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Advance Pay Approved ✓',
            body: `Your advance pay request of ${amountStr} has been approved`,
            type: 'advance_pay_approved',
            sound: 'default',
            data: {
                advanceId: data.advanceId,
                clinicId: data.clinicId,
                amount: data.amount,
                action: 'view_advance_pay',
            },
        },
    });

    console.log(`[HRPush] Sent advance pay approved notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Advance Pay Denied',
            body: `Your advance pay request of ${amountStr} has been denied${reasonText}`,
            type: 'advance_pay_denied',
            sound: 'default',
            data: {
                advanceId: data.advanceId,
                clinicId: data.clinicId,
                amount: data.amount,
                denyReason: data.denyReason,
                action: 'view_advance_pay',
            },
        },
    });

    console.log(`[HRPush] Sent advance pay denied notification to ${data.staffId}`);
}

/**
 * Send notification when an advance pay is disbursed
 */
export async function sendAdvancePayDisbursedNotification(
    data: AdvancePayNotificationData
): Promise<void> {
    if (!PUSH_NOTIFICATIONS_ENABLED) return;

    const amountStr = formatCurrency(data.amount);

    await invokeSendPushLambda({
        userId: data.staffId,
        notification: {
            title: 'Advance Pay Disbursed 💵',
            body: `Your advance pay of ${amountStr} has been disbursed`,
            type: 'advance_pay_disbursed',
            sound: 'default',
            data: {
                advanceId: data.advanceId,
                clinicId: data.clinicId,
                amount: data.amount,
                action: 'view_advance_pay',
            },
        },
    });

    console.log(`[HRPush] Sent advance pay disbursed notification to ${data.staffId}`);
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

    await invokeSendPushLambda({
        userIds,
        notification: {
            title: data.title,
            body: `${data.eventType} at ${clinicName} on ${startTime}`,
            type: 'calendar_event',
            sound: 'default',
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

    console.log(`[HRPush] Sent calendar event notification to ${userIds.length} users`);
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

    await invokeSendPushLambda({
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

    console.log(`[HRPush] Sent HR alert to clinic ${clinicId}: ${title}`);
}

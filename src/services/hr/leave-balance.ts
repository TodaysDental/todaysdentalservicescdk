/**
 * Leave Tracking Service
 * 
 * For hourly/contract workers - tracks leave history for reporting purposes.
 * No balance limits or accruals - staff can request leave as needed.
 * 
 * Features:
 * - Leave request history tracking
 * - Leave usage statistics/reports
 * - Shift cancellation on leave approval
 * - Calendar integration for scheduling visibility
 * 
 * @module leave-tracking
 */

import { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const LEAVE_TABLE = process.env.LEAVE_TABLE || 'HrLeaveRequests';

// ===== TYPES =====

/** Leave request status */
export type LeaveStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

/** Leave types for categorization/reporting */
export type LeaveCategory =
    | 'TIME_OFF'       // General time off request
    | 'PERSONAL'       // Personal reasons
    | 'MEDICAL'        // Medical/sick (no limit, just categorized)
    | 'FAMILY'         // Family emergency
    | 'OTHER';         // Other reasons

/** Leave request record */
export interface LeaveRequest {
    leaveId: string;
    staffId: string;
    staffName?: string;
    clinicId: string;
    clinicIds?: string[];        // Can affect multiple clinics
    startDate: string;           // ISO date
    endDate: string;             // ISO date
    category: LeaveCategory;
    reason?: string;
    status: LeaveStatus;
    hoursRequested?: number;     // For partial day requests
    createdAt: string;
    updatedAt?: string;
    approvedBy?: string;
    approvedAt?: string;
    deniedBy?: string;
    deniedAt?: string;
    denialReason?: string;
    cancelledAt?: string;
    cancelledBy?: string;
    // Tracking affected shifts
    affectedShiftIds?: string[];
    shiftsModified?: boolean;
}

/** Leave summary for a staff member */
export interface LeaveSummary {
    staffId: string;
    totalDaysRequested: number;
    totalDaysApproved: number;
    totalDaysPending: number;
    totalDaysDenied: number;
    recentRequests: LeaveRequest[];
    byCategory: Record<LeaveCategory, number>;
}

/** Leave report for a clinic/date range */
export interface LeaveReport {
    clinicId: string;
    startDate: string;
    endDate: string;
    totalRequests: number;
    approvedCount: number;
    pendingCount: number;
    deniedCount: number;
    byStaff: Record<string, number>;
    byCategory: Record<LeaveCategory, number>;
}

// ===== HELPER FUNCTIONS =====

/**
 * Calculate the number of days between two dates (inclusive)
 */
function calculateDays(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
}

// ===== SERVICE FUNCTIONS =====

/**
 * Create a new leave request
 * No balance checks - staff can request any amount of time off
 */
export async function createLeaveRequest(
    request: Omit<LeaveRequest, 'leaveId' | 'status' | 'createdAt'>
): Promise<LeaveRequest> {
    const { v4: uuidv4 } = await import('uuid');

    const leaveRequest: LeaveRequest = {
        ...request,
        leaveId: uuidv4(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        category: request.category || 'TIME_OFF',
    };

    await ddb.send(new PutCommand({
        TableName: LEAVE_TABLE,
        Item: leaveRequest,
    }));

    return leaveRequest;
}

/**
 * Get a leave request by ID
 */
export async function getLeaveRequest(leaveId: string): Promise<LeaveRequest | null> {
    const result = await ddb.send(new GetCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
    }));

    return (result.Item as LeaveRequest) || null;
}

/**
 * Get all leave requests for a staff member
 */
export async function getStaffLeaveRequests(
    staffId: string,
    options?: {
        status?: LeaveStatus;
        startDate?: string;
        endDate?: string;
        limit?: number;
    }
): Promise<LeaveRequest[]> {
    let filterExpressions: string[] = [];
    const expressionValues: Record<string, unknown> = { ':staffId': staffId };
    const expressionNames: Record<string, string> = { '#status': 'status' };

    if (options?.status) {
        filterExpressions.push('#status = :status');
        expressionValues[':status'] = options.status;
    }

    if (options?.startDate) {
        filterExpressions.push('startDate >= :startDateFilter');
        expressionValues[':startDateFilter'] = options.startDate;
    }

    if (options?.endDate) {
        filterExpressions.push('endDate <= :endDateFilter');
        expressionValues[':endDateFilter'] = options.endDate;
    }

    const result = await ddb.send(new QueryCommand({
        TableName: LEAVE_TABLE,
        IndexName: 'byStaff',
        KeyConditionExpression: 'staffId = :staffId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: expressionNames,
        Limit: options?.limit,
        ScanIndexForward: false, // Most recent first
    }));

    return (result.Items as LeaveRequest[]) || [];
}

/**
 * Get leave requests for a clinic within a date range
 */
export async function getClinicLeaveRequests(
    clinicId: string,
    startDate: string,
    endDate: string,
    options?: {
        status?: LeaveStatus;
    }
): Promise<LeaveRequest[]> {
    // Query by clinic with date range filter
    const expressionValues: Record<string, unknown> = {
        ':clinicId': clinicId,
        ':startDate': startDate,
        ':endDate': endDate,
    };
    const expressionNames: Record<string, string> = { '#status': 'status' };

    let filterExpression = 'startDate <= :endDate AND endDate >= :startDate';

    if (options?.status) {
        filterExpression += ' AND #status = :status';
        expressionValues[':status'] = options.status;
    }

    const result = await ddb.send(new QueryCommand({
        TableName: LEAVE_TABLE,
        IndexName: 'byClinic',
        KeyConditionExpression: 'clinicId = :clinicId',
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: expressionNames,
        ScanIndexForward: false,
    }));

    return (result.Items as LeaveRequest[]) || [];
}

/**
 * Approve a leave request
 */
export async function approveLeaveRequest(
    leaveId: string,
    approvedBy: string
): Promise<LeaveRequest> {
    const now = new Date().toISOString();

    const result = await ddb.send(new UpdateCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
        UpdateExpression: 'SET #status = :approved, approvedBy = :approvedBy, approvedAt = :now, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':approved': 'approved',
            ':approvedBy': approvedBy,
            ':now': now,
        },
        ReturnValues: 'ALL_NEW',
    }));

    return result.Attributes as LeaveRequest;
}

/**
 * Deny a leave request
 */
export async function denyLeaveRequest(
    leaveId: string,
    deniedBy: string,
    reason?: string
): Promise<LeaveRequest> {
    const now = new Date().toISOString();

    const updateExpression = reason
        ? 'SET #status = :denied, deniedBy = :deniedBy, deniedAt = :now, denialReason = :reason, updatedAt = :now'
        : 'SET #status = :denied, deniedBy = :deniedBy, deniedAt = :now, updatedAt = :now';

    const expressionValues: Record<string, unknown> = {
        ':denied': 'denied',
        ':deniedBy': deniedBy,
        ':now': now,
    };

    if (reason) {
        expressionValues[':reason'] = reason;
    }

    const result = await ddb.send(new UpdateCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: expressionValues,
        ReturnValues: 'ALL_NEW',
    }));

    return result.Attributes as LeaveRequest;
}

/**
 * Cancel a leave request (by staff member)
 */
export async function cancelLeaveRequest(
    leaveId: string,
    cancelledBy: string
): Promise<LeaveRequest> {
    const now = new Date().toISOString();

    const result = await ddb.send(new UpdateCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
        UpdateExpression: 'SET #status = :cancelled, cancelledBy = :cancelledBy, cancelledAt = :now, updatedAt = :now',
        ConditionExpression: '#status = :pending', // Can only cancel pending requests
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':cancelled': 'cancelled',
            ':pending': 'pending',
            ':cancelledBy': cancelledBy,
            ':now': now,
        },
        ReturnValues: 'ALL_NEW',
    }));

    return result.Attributes as LeaveRequest;
}

/**
 * Mark affected shifts when leave is approved
 */
export async function markAffectedShifts(
    leaveId: string,
    shiftIds: string[]
): Promise<void> {
    await ddb.send(new UpdateCommand({
        TableName: LEAVE_TABLE,
        Key: { leaveId },
        UpdateExpression: 'SET affectedShiftIds = :shiftIds, shiftsModified = :modified',
        ExpressionAttributeValues: {
            ':shiftIds': shiftIds,
            ':modified': true,
        },
    }));
}

/**
 * Get leave summary for a staff member
 * Useful for reporting - shows leave history without balance tracking
 */
export async function getStaffLeaveSummary(
    staffId: string,
    year?: number
): Promise<LeaveSummary> {
    const targetYear = year || new Date().getFullYear();
    const startDate = `${targetYear}-01-01`;
    const endDate = `${targetYear}-12-31`;

    const requests = await getStaffLeaveRequests(staffId, {
        startDate,
        endDate,
    });

    const summary: LeaveSummary = {
        staffId,
        totalDaysRequested: 0,
        totalDaysApproved: 0,
        totalDaysPending: 0,
        totalDaysDenied: 0,
        recentRequests: requests.slice(0, 10),
        byCategory: {
            TIME_OFF: 0,
            PERSONAL: 0,
            MEDICAL: 0,
            FAMILY: 0,
            OTHER: 0,
        },
    };

    for (const request of requests) {
        const days = calculateDays(request.startDate, request.endDate);
        summary.totalDaysRequested += days;

        // Track by status
        switch (request.status) {
            case 'approved':
                summary.totalDaysApproved += days;
                break;
            case 'pending':
                summary.totalDaysPending += days;
                break;
            case 'denied':
                summary.totalDaysDenied += days;
                break;
        }

        // Track by category
        const category = request.category || 'TIME_OFF';
        summary.byCategory[category] = (summary.byCategory[category] || 0) + days;
    }

    return summary;
}

/**
 * Generate leave report for a clinic
 */
export async function generateClinicLeaveReport(
    clinicId: string,
    startDate: string,
    endDate: string
): Promise<LeaveReport> {
    const requests = await getClinicLeaveRequests(clinicId, startDate, endDate);

    const report: LeaveReport = {
        clinicId,
        startDate,
        endDate,
        totalRequests: requests.length,
        approvedCount: 0,
        pendingCount: 0,
        deniedCount: 0,
        byStaff: {},
        byCategory: {
            TIME_OFF: 0,
            PERSONAL: 0,
            MEDICAL: 0,
            FAMILY: 0,
            OTHER: 0,
        },
    };

    for (const request of requests) {
        const days = calculateDays(request.startDate, request.endDate);

        // Count by status
        switch (request.status) {
            case 'approved':
                report.approvedCount++;
                break;
            case 'pending':
                report.pendingCount++;
                break;
            case 'denied':
                report.deniedCount++;
                break;
        }

        // Track by staff
        report.byStaff[request.staffId] = (report.byStaff[request.staffId] || 0) + days;

        // Track by category
        const category = request.category || 'TIME_OFF';
        report.byCategory[category] = (report.byCategory[category] || 0) + days;
    }

    return report;
}

/**
 * Check if staff has leave on a specific date
 * Used for scheduling conflict detection
 */
export async function hasLeaveOnDate(
    staffId: string,
    date: string
): Promise<{ hasLeave: boolean; leaveRequest?: LeaveRequest }> {
    const requests = await getStaffLeaveRequests(staffId, {
        status: 'approved',
    });

    const matchingRequest = requests.find(req => {
        return date >= req.startDate && date <= req.endDate;
    });

    return {
        hasLeave: !!matchingRequest,
        leaveRequest: matchingRequest,
    };
}

/**
 * Get upcoming approved leave for a clinic
 * Useful for scheduling visibility
 */
export async function getUpcomingLeave(
    clinicId: string,
    daysAhead: number = 30
): Promise<LeaveRequest[]> {
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const endDate = futureDate.toISOString().split('T')[0];

    return getClinicLeaveRequests(clinicId, today, endDate, { status: 'approved' });
}

/**
 * Get pending leave requests for admin review
 */
export async function getPendingLeaveRequests(
    clinicId: string
): Promise<LeaveRequest[]> {
    const result = await ddb.send(new QueryCommand({
        TableName: LEAVE_TABLE,
        IndexName: 'byClinic',
        KeyConditionExpression: 'clinicId = :clinicId',
        FilterExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':clinicId': clinicId,
            ':pending': 'pending',
        },
        ScanIndexForward: false,
    }));

    return (result.Items as LeaveRequest[]) || [];
}

export default {
    createLeaveRequest,
    getLeaveRequest,
    getStaffLeaveRequests,
    getClinicLeaveRequests,
    approveLeaveRequest,
    denyLeaveRequest,
    cancelLeaveRequest,
    markAffectedShifts,
    getStaffLeaveSummary,
    generateClinicLeaveReport,
    hasLeaveOnDate,
    getUpcomingLeave,
    getPendingLeaveRequests,
};

/**
 * HR Business Configuration
 * 
 * Centralized configuration for HR module business rules
 * This can be externalized to DynamoDB or environment variables for easier management
 */

// Advance Pay Configuration
export const ADVANCE_PAY_CONFIG = {
    // Maximum amount per single request
    maxAmountPerRequest: Number(process.env.MAX_ADVANCE_PAY_AMOUNT) || 500,

    // Maximum total outstanding (pending + approved) balance
    maxTotalOutstanding: Number(process.env.MAX_TOTAL_OUTSTANDING_ADVANCES) || 1000,

    // Maximum number of pending requests at a time
    maxPendingRequests: Number(process.env.MAX_PENDING_ADVANCE_REQUESTS) || 3,

    // Minimum employment tenure in days
    minTenureDays: Number(process.env.MIN_TENURE_DAYS) || 90,

    // Minimum days between approved/paid requests
    minDaysBetweenRequests: Number(process.env.MIN_DAYS_BETWEEN_REQUESTS) || 30,

    // Auto-expire pending requests after this many days
    autoExpireDays: Number(process.env.ADVANCE_PAY_EXPIRE_DAYS) || 30,
};

// Leave Management Configuration
export const LEAVE_CONFIG = {
    // Maximum days per single leave request
    maxDaysPerRequest: Number(process.env.MAX_LEAVE_DAYS_PER_REQUEST) || 14,

    // Minimum days notice for leave request
    minNoticeDays: Number(process.env.MIN_LEAVE_NOTICE_DAYS) || 2,

    // Auto-approve threshold (for short leaves)
    autoApproveMaxDays: Number(process.env.LEAVE_AUTO_APPROVE_MAX_DAYS) || 0,
};

// Shift Management Configuration
export const SHIFT_CONFIG = {
    // Minimum shift duration in hours
    minShiftHours: Number(process.env.MIN_SHIFT_HOURS) || 2,

    // Maximum shift duration in hours
    maxShiftHours: Number(process.env.MAX_SHIFT_HOURS) || 12,

    // Maximum shifts per day per staff
    maxShiftsPerDay: Number(process.env.MAX_SHIFTS_PER_DAY) || 2,

    // Minimum hours between shifts
    minHoursBetweenShifts: Number(process.env.MIN_HOURS_BETWEEN_SHIFTS) || 8,
};

// Rate Limiting Configuration
export const RATE_LIMIT_CONFIG = {
    // Advance pay requests per hour per user
    advancePayRequestsPerHour: Number(process.env.RATE_LIMIT_ADVANCE_PAY) || 5,

    // Shift creation per minute per admin
    shiftCreationPerMinute: Number(process.env.RATE_LIMIT_SHIFT_CREATE) || 30,

    // API calls per minute per user
    apiCallsPerMinute: Number(process.env.RATE_LIMIT_API) || 100,
};

// Audit Configuration
export const AUDIT_CONFIG = {
    // Default query limit for audit logs
    defaultQueryLimit: Number(process.env.AUDIT_DEFAULT_LIMIT) || 100,

    // Maximum query limit for audit logs
    maxQueryLimit: Number(process.env.AUDIT_MAX_LIMIT) || 1000,

    // Retention period in days (for archival)
    retentionDays: Number(process.env.AUDIT_RETENTION_DAYS) || 365,
};

// Timezone Configuration
export const TIMEZONE_CONFIG = {
    // Default timezone for clinics
    defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',

    // Cache TTL for timezone lookups (milliseconds)
    cacheTtlMs: Number(process.env.TIMEZONE_CACHE_TTL_MS) || 10 * 60 * 1000, // 10 minutes
};

// Email Notification Configuration
export const EMAIL_CONFIG = {
    // Application name for email templates
    appName: process.env.APP_NAME || 'TodaysDentalInsights',

    // From email address
    fromEmail: process.env.FROM_EMAIL || 'no-reply@todaysdentalinsights.com',

    // SES region
    sesRegion: process.env.SES_REGION || 'us-east-1',

    // Enable email notifications
    enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'false',
};

/**
 * Get all configuration as a single object
 * Used by /hr/config endpoint
 */
export const getHrConfigResponse = () => ({
    advancePay: {
        maxAmountPerRequest: ADVANCE_PAY_CONFIG.maxAmountPerRequest,
        maxTotalOutstanding: ADVANCE_PAY_CONFIG.maxTotalOutstanding,
        maxPendingRequests: ADVANCE_PAY_CONFIG.maxPendingRequests,
        minTenureDays: ADVANCE_PAY_CONFIG.minTenureDays,
        minDaysBetweenRequests: ADVANCE_PAY_CONFIG.minDaysBetweenRequests,
    },
    leave: {
        maxDaysPerRequest: LEAVE_CONFIG.maxDaysPerRequest,
        minNoticeDays: LEAVE_CONFIG.minNoticeDays,
    },
    shift: {
        minShiftHours: SHIFT_CONFIG.minShiftHours,
        maxShiftHours: SHIFT_CONFIG.maxShiftHours,
        maxShiftsPerDay: SHIFT_CONFIG.maxShiftsPerDay,
    },
});

export default {
    ADVANCE_PAY_CONFIG,
    LEAVE_CONFIG,
    SHIFT_CONFIG,
    RATE_LIMIT_CONFIG,
    AUDIT_CONFIG,
    TIMEZONE_CONFIG,
    EMAIL_CONFIG,
    getHrConfigResponse,
};

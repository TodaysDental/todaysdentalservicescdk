/**
 * HR Input Validation and Sanitization
 * 
 * Centralized validation utilities for HR module
 * Provides schema validation, sanitization, and error handling
 */

import { z } from 'zod';
import { ADVANCE_PAY_CONFIG, LEAVE_CONFIG, SHIFT_CONFIG } from './config';

// ========================================
// COMMON VALIDATORS
// ========================================

/**
 * Validate and sanitize string input
 * Trims whitespace and removes potentially dangerous characters
 */
export function sanitizeString(input: string | undefined | null, maxLength: number = 1000): string {
    if (!input) return '';
    return input
        .toString()
        .trim()
        .slice(0, maxLength)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
}

/**
 * Validate and sanitize email
 */
export function sanitizeEmail(email: string | undefined | null): string {
    if (!email) return '';
    return email.toString().trim().toLowerCase().slice(0, 255);
}

/**
 * Validate ISO date string
 */
export function isValidIsoDate(dateStr: string): boolean {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
}

/**
 * Validate UUID v4
 */
export function isValidUuid(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
}

/**
 * Validate clinic ID format
 */
export function isValidClinicId(clinicId: string): boolean {
    // Clinic IDs can be UUIDs or numeric strings
    return /^[\w\-]+$/.test(clinicId) && clinicId.length <= 50;
}

// ========================================
// SCHEMA DEFINITIONS
// ========================================

/**
 * Shift creation/update schema
 */
export const shiftInputSchema = z.object({
    staffId: z.string().email('Invalid staff email'),
    clinicId: z.string().min(1, 'Clinic ID is required'),
    role: z.string().min(1, 'Role is required').max(100),
    startTime: z.string().refine(isValidIsoDate, 'Invalid start time'),
    endTime: z.string().refine(isValidIsoDate, 'Invalid end time'),
    notes: z.string().max(500).optional(),
    hourlyRate: z.number().min(0).max(1000).optional(),
}).refine(
    (data: { startTime: string; endTime: string }) => {
        const start = new Date(data.startTime);
        const end = new Date(data.endTime);
        const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        return durationHours >= SHIFT_CONFIG.minShiftHours && durationHours <= SHIFT_CONFIG.maxShiftHours;
    },
    { message: `Shift duration must be between ${SHIFT_CONFIG.minShiftHours} and ${SHIFT_CONFIG.maxShiftHours} hours` }
);

/**
 * Leave request creation schema
 */
export const leaveInputSchema = z.object({
    startDate: z.string().refine(isValidIsoDate, 'Invalid start date'),
    endDate: z.string().refine(isValidIsoDate, 'Invalid end date'),
    reason: z.string().max(500).optional(),
}).refine(
    (data: { startDate: string; endDate: string }) => {
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        return days <= LEAVE_CONFIG.maxDaysPerRequest;
    },
    { message: `Maximum ${LEAVE_CONFIG.maxDaysPerRequest} days per leave request` }
).refine(
    (data: { startDate: string; endDate: string }) => {
        return new Date(data.startDate) <= new Date(data.endDate);
    },
    { message: 'End date must be after start date' }
);

/**
 * Advance pay request creation schema
 * Note: Max amount validation removed - no restrictions on advance pay amounts
 */
export const advancePayInputSchema = z.object({
    amount: z.number()
        .min(1, 'Amount must be at least $1'),
    reason: z.string().max(500).optional(),
    clinicId: z.string().min(1, 'Clinic ID is required'),
});

/**
 * Audit query parameters schema
 */
export const auditQuerySchema = z.object({
    userId: z.string().email().optional(),
    clinicId: z.string().optional(),
    startDate: z.string().refine((val: string) => !val || isValidIsoDate(val), 'Invalid start date').optional(),
    endDate: z.string().refine((val: string) => !val || isValidIsoDate(val), 'Invalid end date').optional(),
    action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'DENY', 'REJECT', 'ACTIVATE', 'DEACTIVATE', 'ROLE_CHANGE']).optional(),
    resource: z.enum(['STAFF', 'SHIFT', 'LEAVE', 'CLINIC_ROLE', 'ADVANCE_PAY']).optional(),
    limit: z.number().min(1).max(1000).optional(),
    cursor: z.string().optional(),
});

// ========================================
// VALIDATION HELPERS
// ========================================

export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    errors?: string[];
}

/**
 * Validate input against a Zod schema
 */
export function validateInput<T>(
    schema: z.ZodSchema<T>,
    input: unknown
): ValidationResult<T> {
    try {
        const data = schema.parse(input);
        return { success: true, data };
    } catch (error: unknown) {
        if (error instanceof z.ZodError) {
            const errors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
            return { success: false, errors };
        }
        return { success: false, errors: ['Validation failed'] };
    }
}

/**
 * Validate shift input
 */
export function validateShiftInput(input: unknown): ValidationResult<z.infer<typeof shiftInputSchema>> {
    return validateInput(shiftInputSchema, input);
}

/**
 * Validate leave input
 */
export function validateLeaveInput(input: unknown): ValidationResult<z.infer<typeof leaveInputSchema>> {
    return validateInput(leaveInputSchema, input);
}

/**
 * Validate advance pay input
 */
export function validateAdvancePayInput(input: unknown): ValidationResult<z.infer<typeof advancePayInputSchema>> {
    return validateInput(advancePayInputSchema, input);
}

/**
 * Validate audit query parameters
 */
export function validateAuditQuery(input: unknown): ValidationResult<z.infer<typeof auditQuerySchema>> {
    return validateInput(auditQuerySchema, input);
}

// ========================================
// ADDITIONAL SAFETY CHECKS
// ========================================

/**
 * Check for suspicious patterns in user input
 */
export function hasSuspiciousContent(input: string): boolean {
    const suspiciousPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+\s*=/i,
        /data:\s*text\/html/i,
        /expression\s*\(/i,
        /vbscript:/i,
    ];
    return suspiciousPatterns.some(pattern => pattern.test(input));
}

/**
 * Rate limit key generator
 */
export function generateRateLimitKey(userId: string, action: string): string {
    return `${action}:${userId}`;
}

/**
 * Check if a date is in the past
 */
export function isDateInPast(dateStr: string): boolean {
    const date = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return date < now;
}

/**
 * Check if a date is too far in the future (default: 1 year)
 */
export function isDateTooFarFuture(dateStr: string, maxDays: number = 365): boolean {
    const date = new Date(dateStr);
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDays);
    return date > maxDate;
}

export default {
    sanitizeString,
    sanitizeEmail,
    isValidIsoDate,
    isValidUuid,
    isValidClinicId,
    shiftInputSchema,
    leaveInputSchema,
    advancePayInputSchema,
    auditQuerySchema,
    validateInput,
    validateShiftInput,
    validateLeaveInput,
    validateAdvancePayInput,
    validateAuditQuery,
    hasSuspiciousContent,
    generateRateLimitKey,
    isDateInPast,
    isDateTooFarFuture,
};

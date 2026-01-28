/**
 * HR Timezone Utilities
 * 
 * Centralized timezone handling for the HR module
 * Handles clinic-local to UTC conversions with caching
 */

import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { TIMEZONE_CONFIG } from './config';

// Timezone cache to avoid repeated DynamoDB lookups
const timezoneCache = new Map<string, { timezone: string; timestamp: number }>();

/**
 * Get clinic timezone from Clinics table (with caching)
 */
export async function getClinicTimezone(
    ddb: DynamoDBDocumentClient,
    clinicsTable: string,
    clinicId: string
): Promise<string> {
    const DEFAULT_TIMEZONE = TIMEZONE_CONFIG.defaultTimezone;

    // Check cache first
    const cached = timezoneCache.get(clinicId);
    if (cached && Date.now() - cached.timestamp < TIMEZONE_CONFIG.cacheTtlMs) {
        return cached.timezone;
    }

    try {
        const { Item } = await ddb.send(new GetCommand({
            TableName: clinicsTable,
            Key: { clinicId },
        }));

        // Support both field names: timeZone and timezone
        const timezone = Item?.timeZone || Item?.timezone || DEFAULT_TIMEZONE;

        // Cache the result
        timezoneCache.set(clinicId, { timezone, timestamp: Date.now() });

        return timezone;
    } catch (error) {
        console.error(`Error fetching timezone for clinic ${clinicId}:`, error);
        return DEFAULT_TIMEZONE;
    }
}

/**
 * Validate and normalize timezone identifier
 */
export function normalizeTimeZoneOrUtc(timeZone: string): string {
    try {
        // Throws RangeError for invalid IANA zones
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        return timeZone;
    } catch {
        return 'UTC';
    }
}

/**
 * Check if a datetime string has an explicit timezone
 */
export function hasExplicitTimeZone(dateTime: string): boolean {
    // Examples: 2026-01-20T14:00:00.000Z, 2026-01-20T14:00:00Z, 2026-01-20T14:00:00-05:00
    return /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(dateTime);
}

/**
 * Parsed naive datetime parts
 */
interface NaiveDateTimeParts {
    year: number;
    month: number; // 1-12
    day: number;   // 1-31
    hour: number;  // 0-23
    minute: number;// 0-59
    second: number;// 0-59
}

/**
 * Parse a naive datetime string (no timezone)
 */
export function parseNaiveDateTime(dateTime: string): NaiveDateTimeParts | null {
    const normalized = dateTime.trim().replace(' ', 'T');
    const m = normalized.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
    );
    if (!m) return null;
    return {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: Number(m[4]),
        minute: Number(m[5]),
        second: m[6] ? Number(m[6]) : 0,
    };
}

/**
 * Get timezone offset in milliseconds for a given instant
 */
export function getTimeZoneOffsetMs(timeZone: string, utcInstant: Date): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const parts = dtf.formatToParts(utcInstant);
    const map: Record<string, string> = {};
    for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
    }
    const asUtc = Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour),
        Number(map.minute),
        Number(map.second)
    );
    return asUtc - utcInstant.getTime();
}

/**
 * Convert clinic-local datetime parts to UTC Date
 */
export function clinicLocalPartsToUtcDate(parts: NaiveDateTimeParts, timeZone: string): Date {
    // Create an initial UTC guess by treating the clinic-local wall time as if it were UTC
    const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));

    // First-pass offset at the guess instant
    const offset1 = getTimeZoneOffsetMs(timeZone, utcGuess);
    let utcDate = new Date(utcGuess.getTime() - offset1);

    // DST transitions can change the offset; do a second pass to stabilize
    const offset2 = getTimeZoneOffsetMs(timeZone, utcDate);
    if (offset2 !== offset1) {
        utcDate = new Date(utcGuess.getTime() - offset2);
    }

    return utcDate;
}

/**
 * Normalize a datetime string to UTC ISO format
 * Handles both timezone-aware and naive datetime strings
 */
export function normalizeToUtcIso(dateTime: string, clinicTimeZone: string): string {
    const tz = normalizeTimeZoneOrUtc(clinicTimeZone);
    const input = String(dateTime || '').trim();
    if (!input) throw new Error('Missing date/time');

    if (hasExplicitTimeZone(input)) {
        const d = new Date(input);
        if (isNaN(d.getTime())) throw new Error(`Invalid date/time: ${input}`);
        return d.toISOString();
    }

    const parts = parseNaiveDateTime(input);
    if (!parts) throw new Error(`Invalid date/time format (expected YYYY-MM-DDTHH:mm[:ss]): ${input}`);
    const utc = clinicLocalPartsToUtcDate(parts, tz);
    if (isNaN(utc.getTime())) throw new Error(`Invalid date/time after timezone conversion: ${input}`);
    return utc.toISOString();
}

/**
 * Convert UTC date to local date string (YYYY-MM-DD) for a timezone
 */
export function utcToLocalDate(utcDate: Date, timeZone: string): string {
    const tz = normalizeTimeZoneOrUtc(timeZone);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(utcDate);
}

/**
 * Convert UTC date to local datetime string for a timezone
 */
export function utcToLocalDateTime(utcDate: Date, timeZone: string): string {
    const tz = normalizeTimeZoneOrUtc(timeZone);
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
    return formatter.format(utcDate);
}

/**
 * Convert UTC date to local time string for a timezone
 */
export function utcToLocalTime(utcDate: Date, timeZone: string): string {
    const tz = normalizeTimeZoneOrUtc(timeZone);
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
    return formatter.format(utcDate);
}

/**
 * Convert local date (YYYY-MM-DD) to integer for comparison
 */
export function localDateToInt(dateStr: string): number {
    return parseInt(dateStr.replace(/-/g, ''), 10);
}

/**
 * Clear timezone cache (useful for testing)
 */
export function clearTimezoneCache(): void {
    timezoneCache.clear();
}

export default {
    getClinicTimezone,
    normalizeTimeZoneOrUtc,
    hasExplicitTimeZone,
    parseNaiveDateTime,
    getTimeZoneOffsetMs,
    clinicLocalPartsToUtcDate,
    normalizeToUtcIso,
    utcToLocalDate,
    utcToLocalDateTime,
    utcToLocalTime,
    localDateToInt,
    clearTimezoneCache,
};

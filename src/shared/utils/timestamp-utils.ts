/**
 * Timestamp Utilities
 * 
 * Standardizes timestamp handling across the codebase
 * - DynamoDB sort keys and time range queries: Unix seconds
 * - Display and logging: ISO strings
 * - Internal processing: Unix milliseconds
 */

/**
 * Convert any timestamp format to Unix seconds (for DynamoDB)
 */
export function toUnixSeconds(value: Date | string | number | null | undefined): number {
  if (!value) {
    return Math.floor(Date.now() / 1000);
  }

  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  if (typeof value === 'number') {
    // Detect if it's milliseconds (> year 2010 in seconds)
    // Timestamp 1262304000 = Jan 1, 2010 00:00:00 UTC
    if (value > 1262304000000) {
      // It's milliseconds
      return Math.floor(value / 1000);
    }
    // It's already seconds
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      console.warn('[TimestampUtils] Invalid date string:', value);
      return Math.floor(Date.now() / 1000);
    }
    return Math.floor(parsed.getTime() / 1000);
  }

  console.warn('[TimestampUtils] Unknown timestamp type:', typeof value);
  return Math.floor(Date.now() / 1000);
}

/**
 * Convert Unix seconds to ISO string (for display/logging)
 */
export function toISO(unixSeconds: number): string {
  // Handle both seconds and milliseconds
  const timestamp = unixSeconds > 1262304000000 
    ? unixSeconds 
    : unixSeconds * 1000;
  
  return new Date(timestamp).toISOString();
}

/**
 * Convert Unix seconds to ISO string with timezone
 */
export function toISOWithTimezone(unixSeconds: number, timezone: string): string {
  const timestamp = unixSeconds > 1262304000000 
    ? unixSeconds 
    : unixSeconds * 1000;
  
  const date = new Date(timestamp);
  
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short'
  }).format(date);
}

/**
 * Parse any timestamp format to Unix seconds
 * Alias for toUnixSeconds for clarity
 */
export function parseTimestamp(value: any): number {
  return toUnixSeconds(value);
}

/**
 * Get current timestamp in Unix seconds
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Get timestamp N seconds from now
 */
export function nowPlusSeconds(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/**
 * Get timestamp N days from now
 */
export function nowPlusDays(days: number): number {
  return Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60);
}

/**
 * Check if timestamp is in the past
 */
export function isPast(unixSeconds: number): boolean {
  return unixSeconds < Math.floor(Date.now() / 1000);
}

/**
 * Check if timestamp is in the future
 */
export function isFuture(unixSeconds: number): boolean {
  return unixSeconds > Math.floor(Date.now() / 1000);
}

/**
 * Get difference between two timestamps in seconds
 */
export function diffSeconds(start: number, end: number): number {
  return Math.abs(end - start);
}

/**
 * Get difference between two timestamps in minutes
 */
export function diffMinutes(start: number, end: number): number {
  return Math.round(Math.abs(end - start) / 60);
}

/**
 * Format duration in seconds to human readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Get start of day in Unix seconds (for date range queries)
 */
export function startOfDay(date: Date | string = new Date()): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Get end of day in Unix seconds (for date range queries)
 */
export function endOfDay(date: Date | string = new Date()): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  d.setHours(23, 59, 59, 999);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Convert Unix seconds to YYYY-MM-DD format (for agent performance periodDate)
 */
export function toDateString(unixSeconds: number): string {
  const timestamp = unixSeconds > 1262304000000 
    ? unixSeconds 
    : unixSeconds * 1000;
  
  return new Date(timestamp).toISOString().split('T')[0];
}

/**
 * Validate timestamp is within reasonable range
 * (Between year 2000 and 2100)
 */
export function isValidTimestamp(unixSeconds: number): boolean {
  // Jan 1, 2000 = 946684800
  // Dec 31, 2099 = 4102444799
  return unixSeconds >= 946684800 && unixSeconds <= 4102444799;
}


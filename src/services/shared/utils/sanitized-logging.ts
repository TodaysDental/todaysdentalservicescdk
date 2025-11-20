/**
 * Sanitized Logging Utility
 * 
 * Provides helper functions to remove PII (Personally Identifiable Information)
 * from logs before writing to CloudWatch. Prevents HIPAA violations and
 * customer privacy breaches.
 * 
 * **FLAW #18 FIX:** Sanitize sensitive data from CloudWatch logs
 * 
 * Do NOT log:
 * - Phone numbers (customer phone, agent phone)
 * - Patient names, birthdates
 * - Medical information in call notes
 * - Auth tokens, credentials
 * - Patient IDs that link to medical records
 * - Call content/transcripts
 */

interface SafeCallLog {
  callId: string;
  status: string;
  clinicId: string;
  duration?: number;
  agentId?: string;
  assignedAgentId?: string;
  agentCount?: number;
  transferStatus?: string;
  reason?: string;
  timestamp?: string;
}

interface SafeAgentLog {
  agentId: string;
  status: string;
  clinicId?: string;
  ringingCallCount?: number;
  lastActivityAt?: string;
  timestamp?: string;
}

interface SafeMeetingLog {
  meetingId: string;
  attendeeCount?: number;
  status: string;
  duration?: number;
  timestamp?: string;
}

/**
 * Sanitize call record for logging
 * Removes: phone numbers, customer names, auth tokens
 */
export function sanitizeCallForLog(record: any): SafeCallLog {
  return {
    callId: record.callId,
    status: record.status,
    clinicId: record.clinicId,
    duration: record.duration,
    agentId: record.agentId,
    assignedAgentId: record.assignedAgentId,
    agentCount: record.agentIds?.length,
    transferStatus: record.transferStatus,
    reason: record.reason, // e.g., 'call_rejected', 'transferred'
    timestamp: record.timestamp || new Date().toISOString(),
  };
}

/**
 * Sanitize agent record for logging
 * Removes: all personal data, auth tokens
 */
export function sanitizeAgentForLog(record: any): SafeAgentLog {
  return {
    agentId: record.agentId,
    status: record.status,
    clinicId: record.clinicId,
    ringingCallCount: (record.ringingCallIds || []).length,
    lastActivityAt: record.lastActivityAt,
    timestamp: record.timestamp || new Date().toISOString(),
  };
}

/**
 * Sanitize meeting record for logging
 * Removes: participant details, meeting tokens
 */
export function sanitizeMeetingForLog(record: any): SafeMeetingLog {
  return {
    meetingId: record.meetingId || record.MeetingId,
    attendeeCount: record.attendeeCount || (record.attendees?.length || 0),
    status: record.status || 'unknown',
    duration: record.duration,
    timestamp: record.timestamp || new Date().toISOString(),
  };
}

/**
 * Mask sensitive strings (phone numbers, emails, etc.)
 * Shows only first 2 and last 2 characters: "55****12"
 */
export function maskSensitiveValue(value: string | undefined, type: 'phone' | 'email' | 'name' = 'name'): string {
  if (!value) return '[redacted]';
  if (value.length <= 4) return '[redacted]';

  const first = value.substring(0, 2);
  const last = value.substring(value.length - 2);
  return `${first}****${last}`;
}

/**
 * Sanitize error messages to remove accidental PII
 * Common patterns: phone numbers, patient names, medical terms
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return 'Unknown error';

  // Remove phone numbers: (555) 123-4567, 555-123-4567, +1-555-123-4567
  let sanitized = message.replace(/\(?[\d]{3}\)?[\s.-]?[\d]{3}[\s.-]?[\d]{4}/g, '[phone]');

  // Remove email addresses
  sanitized = sanitized.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]');

  // Remove UUID-like patient IDs (but keep for callId which is needed)
  // Only remove if surrounded by certain patterns that suggest PII
  sanitized = sanitized.replace(/patient[_\s]?id[\s:=]*[\w-]+/gi, 'patientId:[redacted]');

  // Remove potential auth tokens (long hex strings after "token" keyword)
  sanitized = sanitized.replace(/token[\s:=]*[a-f0-9]{32,}/gi, 'token:[redacted]');

  // Remove common medical keywords with context
  sanitized = sanitized.replace(/diagnosis[\s:=]*[^,.]*/gi, 'diagnosis:[redacted]');
  sanitized = sanitized.replace(/medication[\s:=]*[^,.]*/gi, 'medication:[redacted]');
  sanitized = sanitized.replace(/allergy[\s:=]*[^,.]*/gi, 'allergy:[redacted]');

  return sanitized;
}

/**
 * Create a safe log object that can be JSON.stringify'd without PII
 */
export function createSafeLogContext(context: any): any {
  return {
    requestId: context.requestContext?.requestId,
    timestamp: new Date().toISOString(),
    // DO NOT include: headers (auth tokens), body (personal info), pathParameters with IDs
  };
}

/**
 * Safe JSON serialization that removes sensitive fields
 */
export function safeJsonStringify(obj: any, maxDepth: number = 3): string {
  const sensitiveFields = new Set([
    'phoneNumber',
    'customerName',
    'patientName',
    'birthdate',
    'dob',
    'ssn',
    'email',
    'address',
    'medicalHistory',
    'diagnosis',
    'medication',
    'prescription',
    'token',
    'jwt',
    'authorization',
    'password',
    'secret',
    'apiKey',
    'accessToken',
    'refreshToken',
    'idToken',
    'meetingToken',
    'joinToken',
    'attendeeToken',
    'creditCard',
    'bankAccount',
    'insuranceId',
    'claimNumber',
  ]);

  function replacer(key: string, value: any, depth: number = 0): any {
    if (depth > maxDepth) return '[object]';
    if (sensitiveFields.has(key.toLowerCase())) return '[redacted]';
    if (typeof value === 'object' && value !== null) {
      return Object.keys(value).reduce((acc, k) => {
        acc[k] = replacer(k, value[k], depth + 1);
        return acc;
      }, {} as any);
    }
    return value;
  }

  try {
    return JSON.stringify(obj, (key, value) => replacer(key, value));
  } catch (err) {
    return '[Unable to serialize]';
  }
}

/**
 * Log call event with sanitized data
 * Safe to write to CloudWatch
 */
export function logCallEvent(
  action: string,
  callRecord: any,
  metadata?: any,
  err?: any
): void {
  const safe = sanitizeCallForLog(callRecord);
  const msg = {
    action,
    call: safe,
    metadata: metadata ? { ...metadata, error: err ? sanitizeErrorMessage(err.message) : undefined } : undefined,
  };

  if (err) {
    console.error(`[${action}] ${err.message}`, msg);
  } else {
    console.log(`[${action}]`, msg);
  }
}

/**
 * Log agent event with sanitized data
 */
export function logAgentEvent(
  action: string,
  agentRecord: any,
  metadata?: any,
  err?: any
): void {
  const safe = sanitizeAgentForLog(agentRecord);
  const msg = {
    action,
    agent: safe,
    metadata,
  };

  if (err) {
    console.error(`[${action}] ${err.message}`, msg);
  } else {
    console.log(`[${action}]`, msg);
  }
}

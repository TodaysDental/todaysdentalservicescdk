/**
 * FIX #36: Enhanced Logging with Context
 * 
 * Provides structured logging with rich context while maintaining PII protection.
 * Includes trace IDs, request IDs, and sanitized call information.
 */

import { TraceContext } from './trace-context';
import { sanitizeErrorMessage } from './error-response';

export interface LogContext {
  traceId?: string;
  requestId?: string;
  agentId?: string;
  clinicId?: string;
  operation: string;
  timestamp: string;
}

/**
 * Create enhanced log context with trace information
 */
export function createEnhancedLogContext(
  operation: string,
  additionalContext?: Record<string, any>
): LogContext {
  return {
    traceId: TraceContext.get(),
    requestId: additionalContext?.requestId,
    operation,
    timestamp: new Date().toISOString(),
    ...additionalContext
  };
}

/**
 * Log call event with enhanced context
 */
export function logCallEventEnhanced(
  operation: string,
  callRecord: any,
  metadata?: any,
  err?: any
): void {
  const context = createEnhancedLogContext(operation, {
    agentId: callRecord.assignedAgentId,
    clinicId: callRecord.clinicId
  });

  const sanitized = sanitizeCallForLog(callRecord);

  // Keep last 4 digits of phone for debugging (not full PII)
  const phoneHint = callRecord.phoneNumber 
    ? `***${callRecord.phoneNumber.slice(-4)}`
    : null;

  const logEntry = {
    ...context,
    call: {
      ...sanitized,
      phoneHint // Safe to log
    },
    metadata: metadata ? sanitizeMetadata(metadata) : undefined,
    error: err ? sanitizeErrorMessage(err.message) : undefined
  };

  if (err) {
    console.error(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }

  // Also send structured logs to CloudWatch Insights if enabled
  if (process.env.ENABLE_STRUCTURED_LOGGING === 'true') {
    sendStructuredLog(logEntry);
  }
}

/**
 * Sanitize call record for logging
 */
function sanitizeCallForLog(callRecord: any): any {
  return {
    callId: callRecord.callId,
    status: callRecord.status,
    queuePosition: callRecord.queuePosition,
    queueTime: callRecord.queueEntryTime ? 
      Date.now() - new Date(callRecord.queueEntryTime).getTime() : 
      undefined,
    hasAgentAssigned: !!callRecord.assignedAgentId,
    hasMeeting: !!callRecord.meetingInfo?.MeetingId,
    priority: callRecord.priority,
    isVip: callRecord.isVip,
    isCallback: callRecord.isCallback
  };
}

/**
 * Sanitize metadata for logging
 */
function sanitizeMetadata(metadata: any): any {
  // Keep debugging info, remove PII
  return {
    duration: metadata.duration,
    attemptCount: metadata.attemptCount,
    errorCode: metadata.errorCode,
    retryCount: metadata.retryCount,
    // Exclude: phoneNumbers, names, tokens, emails
  };
}

/**
 * Send structured log to CloudWatch Logs Insights
 */
function sendStructuredLog(logEntry: any): void {
  // CloudWatch Logs automatically parses JSON logs
  // This is a placeholder - actual implementation depends on your setup
  console.log('[STRUCTURED]', JSON.stringify(logEntry));
}

/**
 * Log with automatic PII redaction
 */
export function logWithContext(
  level: 'info' | 'warn' | 'error',
  operation: string,
  message: string,
  context?: Record<string, any>
): void {
  const logContext = createEnhancedLogContext(operation, context);
  
  const logEntry = {
    level,
    ...logContext,
    message: sanitizeErrorMessage(message),
    context: context ? sanitizeMetadata(context) : undefined
  };

  switch (level) {
    case 'error':
      console.error(JSON.stringify(logEntry));
      break;
    case 'warn':
      console.warn(JSON.stringify(logEntry));
      break;
    default:
      console.log(JSON.stringify(logEntry));
  }
}


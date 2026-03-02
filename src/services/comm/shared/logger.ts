/**
 * Shared Structured Logger for Communications Stack
 *
 * JSON-formatted logs for CloudWatch with configurable log levels.
 * Consistent across all handlers (WebSocket and REST).
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
    requestId?: string;
    connectionId?: string;
    userID?: string;
    action?: string;
    operation?: string;
    [key: string]: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

function getConfiguredLevel(): LogLevel {
    const raw = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
    return raw in LOG_LEVEL_PRIORITY ? (raw as LogLevel) : 'INFO';
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getConfiguredLevel()];
}

function formatEntry(
    level: LogLevel,
    message: string,
    service: string,
    context?: LogContext,
    error?: Error,
): string {
    const entry: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level,
        message,
        service,
        ...(context && { context }),
    };

    if (error) {
        entry.error = {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    return JSON.stringify(entry);
}

/**
 * Create a scoped logger for a given service name.
 *
 * ```ts
 * const log = createLogger('comm-ws-default');
 * log.info('User connected', { userID, connectionId });
 * log.error('DynamoDB write failed', { favorRequestID }, err);
 * ```
 */
export function createLogger(service: string) {
    return {
        debug(message: string, context?: LogContext): void {
            if (shouldLog('DEBUG')) console.debug(formatEntry('DEBUG', message, service, context));
        },
        info(message: string, context?: LogContext): void {
            if (shouldLog('INFO')) console.info(formatEntry('INFO', message, service, context));
        },
        warn(message: string, context?: LogContext, error?: Error): void {
            if (shouldLog('WARN')) console.warn(formatEntry('WARN', message, service, context, error));
        },
        error(message: string, context?: LogContext, error?: Error): void {
            if (shouldLog('ERROR')) console.error(formatEntry('ERROR', message, service, context, error));
        },
    };
}

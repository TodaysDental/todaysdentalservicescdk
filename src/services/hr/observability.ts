/**
 * Observability Utilities
 * 
 * Provides observability features including:
 * - X-Ray tracing integration
 * - CloudWatch metrics
 * - Structured logging
 * - Performance monitoring
 * 
 * @module observability
 */

import { Segment, Subsegment } from 'aws-xray-sdk-core';

// Check if X-Ray is available
let AWSXRay: typeof import('aws-xray-sdk-core') | null = null;
try {
    AWSXRay = require('aws-xray-sdk-core');
} catch {
    console.log('[Observability] AWS X-Ray SDK not available, tracing disabled');
}

// Environment
const METRICS_NAMESPACE = process.env.METRICS_NAMESPACE || 'TodaysDentalInsights/HR';
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

// Types
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLog {
    timestamp: string;
    level: LogLevel;
    message: string;
    service: string;
    operation?: string;
    requestId?: string;
    userId?: string;
    clinicId?: string;
    duration?: number;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
    metadata?: Record<string, unknown>;
}

export interface MetricData {
    metricName: string;
    value: number;
    unit: 'Count' | 'Milliseconds' | 'Bytes' | 'None';
    dimensions?: Record<string, string>;
}

// Log level priority
const LOG_LEVELS: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

const currentLogLevel = LOG_LEVELS[LOG_LEVEL as LogLevel] || LOG_LEVELS.INFO;

/**
 * Structured logger
 */
class Logger {
    private service: string;
    private requestId?: string;
    private userId?: string;
    private clinicId?: string;

    constructor(service: string) {
        this.service = service;
    }

    setContext(context: { requestId?: string; userId?: string; clinicId?: string }) {
        this.requestId = context.requestId;
        this.userId = context.userId;
        this.clinicId = context.clinicId;
    }

    private log(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
        if (LOG_LEVELS[level] < currentLogLevel) return;

        const logEntry: StructuredLog = {
            timestamp: new Date().toISOString(),
            level,
            message,
            service: this.service,
            requestId: this.requestId,
            userId: this.userId,
            clinicId: this.clinicId,
            metadata,
        };

        const output = JSON.stringify(logEntry);

        switch (level) {
            case 'ERROR':
                console.error(output);
                break;
            case 'WARN':
                console.warn(output);
                break;
            default:
                console.log(output);
        }
    }

    debug(message: string, metadata?: Record<string, unknown>) {
        this.log('DEBUG', message, metadata);
    }

    info(message: string, metadata?: Record<string, unknown>) {
        this.log('INFO', message, metadata);
    }

    warn(message: string, metadata?: Record<string, unknown>) {
        this.log('WARN', message, metadata);
    }

    error(message: string, error?: Error, metadata?: Record<string, unknown>) {
        const errorData = error ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
        } : undefined;

        this.log('ERROR', message, { ...metadata, error: errorData });
    }
}

/**
 * Create a logger for a service
 */
export function createLogger(service: string): Logger {
    return new Logger(service);
}

/**
 * Trace a function execution with X-Ray
 */
export async function trace<T>(
    name: string,
    fn: () => Promise<T>,
    annotations?: Record<string, string | number | boolean>
): Promise<T> {
    if (!AWSXRay) {
        return fn();
    }

    let segment: Segment | Subsegment | undefined;

    try {
        segment = AWSXRay.getSegment();
    } catch {
        // No active segment
    }

    if (!segment) {
        return fn();
    }

    const subsegment = segment.addNewSubsegment(name);

    if (annotations) {
        for (const [key, value] of Object.entries(annotations)) {
            subsegment.addAnnotation(key, value);
        }
    }

    try {
        const result = await fn();
        subsegment.close();
        return result;
    } catch (err) {
        subsegment.addError(err as Error);
        subsegment.close();
        throw err;
    }
}

/**
 * Trace a synchronous function
 */
export function traceSync<T>(
    name: string,
    fn: () => T,
    annotations?: Record<string, string | number | boolean>
): T {
    if (!AWSXRay) {
        return fn();
    }

    let segment: Segment | Subsegment | undefined;

    try {
        segment = AWSXRay.getSegment();
    } catch {
        // No active segment
    }

    if (!segment) {
        return fn();
    }

    const subsegment = segment.addNewSubsegment(name);

    if (annotations) {
        for (const [key, value] of Object.entries(annotations)) {
            subsegment.addAnnotation(key, value);
        }
    }

    try {
        const result = fn();
        subsegment.close();
        return result;
    } catch (err) {
        subsegment.addError(err as Error);
        subsegment.close();
        throw err;
    }
}

/**
 * Add metadata to current X-Ray segment
 */
export function addTraceMetadata(key: string, value: unknown): void {
    if (!AWSXRay) return;

    try {
        const segment = AWSXRay.getSegment();
        if (segment) {
            segment.addMetadata(key, value);
        }
    } catch {
        // Ignore errors
    }
}

/**
 * Add annotation to current X-Ray segment
 */
export function addTraceAnnotation(key: string, value: string | number | boolean): void {
    if (!AWSXRay) return;

    try {
        const segment = AWSXRay.getSegment();
        if (segment) {
            segment.addAnnotation(key, value);
        }
    } catch {
        // Ignore errors
    }
}

/**
 * Performance timer for measuring operation durations
 */
export class Timer {
    private startTime: number;
    private endTime?: number;

    constructor() {
        this.startTime = Date.now();
    }

    stop(): number {
        this.endTime = Date.now();
        return this.getDuration();
    }

    getDuration(): number {
        const end = this.endTime || Date.now();
        return end - this.startTime;
    }
}

/**
 * Create a timed function wrapper
 */
export function timed<T extends unknown[], R>(
    name: string,
    fn: (...args: T) => Promise<R>,
    logger?: Logger
): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
        const timer = new Timer();

        try {
            const result = await fn(...args);
            const duration = timer.stop();

            if (logger) {
                logger.debug(`${name} completed`, { duration });
            }

            return result;
        } catch (err) {
            const duration = timer.stop();

            if (logger) {
                logger.error(`${name} failed`, err as Error, { duration });
            }

            throw err;
        }
    };
}

/**
 * CloudWatch metric emitter (uses embedded metric format)
 */
export function emitMetric(metric: MetricData): void {
    const emfLog = {
        _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
                {
                    Namespace: METRICS_NAMESPACE,
                    Dimensions: [Object.keys(metric.dimensions || {})],
                    Metrics: [
                        {
                            Name: metric.metricName,
                            Unit: metric.unit,
                        },
                    ],
                },
            ],
        },
        ...metric.dimensions,
        [metric.metricName]: metric.value,
    };

    console.log(JSON.stringify(emfLog));
}

/**
 * Common HR module metrics
 */
export const HrMetrics = {
    recordShiftCreation: (clinicId: string, duration: number) => {
        emitMetric({
            metricName: 'ShiftCreation',
            value: 1,
            unit: 'Count',
            dimensions: { ClinicId: clinicId },
        });
        emitMetric({
            metricName: 'ShiftCreationDuration',
            value: duration,
            unit: 'Milliseconds',
            dimensions: { ClinicId: clinicId },
        });
    },

    recordLeaveRequest: (clinicId: string, status: string) => {
        emitMetric({
            metricName: 'LeaveRequest',
            value: 1,
            unit: 'Count',
            dimensions: { ClinicId: clinicId, Status: status },
        });
    },

    recordAdvancePayRequest: (clinicId: string, amount: number) => {
        emitMetric({
            metricName: 'AdvancePayRequest',
            value: 1,
            unit: 'Count',
            dimensions: { ClinicId: clinicId },
        });
        emitMetric({
            metricName: 'AdvancePayAmount',
            value: amount,
            unit: 'None',
            dimensions: { ClinicId: clinicId },
        });
    },

    recordApiLatency: (operation: string, duration: number, success: boolean) => {
        emitMetric({
            metricName: 'ApiLatency',
            value: duration,
            unit: 'Milliseconds',
            dimensions: { Operation: operation, Success: String(success) },
        });
    },

    recordError: (operation: string, errorType: string) => {
        emitMetric({
            metricName: 'Error',
            value: 1,
            unit: 'Count',
            dimensions: { Operation: operation, ErrorType: errorType },
        });
    },
};

/**
 * Request context middleware
 */
export interface RequestContext {
    requestId: string;
    userId?: string;
    clinicId?: string;
    startTime: number;
    logger: Logger;
}

export function createRequestContext(
    requestId: string,
    serviceName: string = 'HR'
): RequestContext {
    const logger = createLogger(serviceName);
    logger.setContext({ requestId });

    return {
        requestId,
        startTime: Date.now(),
        logger,
    };
}

export function enrichContext(
    context: RequestContext,
    userId?: string,
    clinicId?: string
): void {
    context.userId = userId;
    context.clinicId = clinicId;
    context.logger.setContext({ requestId: context.requestId, userId, clinicId });
}

export default {
    createLogger,
    trace,
    traceSync,
    addTraceMetadata,
    addTraceAnnotation,
    Timer,
    timed,
    emitMetric,
    HrMetrics,
    createRequestContext,
    enrichContext,
};

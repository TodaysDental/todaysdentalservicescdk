/**
 * Performance Tracker Module
 * 
 * Tracks latency and performance metrics across call routing operations.
 * Provides insights for optimization and debugging.
 * 
 * @module performance-tracker
 */

import { publishMetric, MetricName } from './cloudwatch-metrics';
import { StandardUnit } from '@aws-sdk/client-cloudwatch';

export interface PerformanceSpan {
    name: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    metadata: Record<string, any>;
    children: PerformanceSpan[];
    error?: string;
}

export interface PerformanceTrace {
    traceId: string;
    rootSpan: PerformanceSpan;
    totalDuration: number;
    operationType: string;
    clinicId: string;
    callId?: string;
    success: boolean;
    timestamp: string;
}

// Active traces
const activeTraces: Map<string, PerformanceTrace> = new Map();
const spanStack: Map<string, PerformanceSpan[]> = new Map();

// Performance thresholds for alerting (ms)
export const PERFORMANCE_THRESHOLDS = {
    AGENT_SELECTION: parseInt(process.env.PERF_THRESHOLD_AGENT_SELECTION || '200', 10),
    BROADCAST_RING: parseInt(process.env.PERF_THRESHOLD_BROADCAST_RING || '500', 10),
    DDB_QUERY: parseInt(process.env.PERF_THRESHOLD_DDB_QUERY || '100', 10),
    AI_RESPONSE: parseInt(process.env.PERF_THRESHOLD_AI_RESPONSE || '5000', 10),
    TOTAL_ROUTING: parseInt(process.env.PERF_THRESHOLD_TOTAL_ROUTING || '2000', 10),
};

/**
 * Generates a trace ID
 */
function generateTraceId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Starts a performance trace for an operation
 */
export function startTrace(
    operationType: string,
    clinicId: string,
    callId?: string,
    metadata: Record<string, any> = {}
): string {
    const traceId = generateTraceId();

    const rootSpan: PerformanceSpan = {
        name: operationType,
        startTime: Date.now(),
        metadata,
        children: [],
    };

    const trace: PerformanceTrace = {
        traceId,
        rootSpan,
        totalDuration: 0,
        operationType,
        clinicId,
        callId,
        success: true,
        timestamp: new Date().toISOString(),
    };

    activeTraces.set(traceId, trace);
    spanStack.set(traceId, [rootSpan]);

    return traceId;
}

/**
 * Starts a child span within a trace
 */
export function startSpan(
    traceId: string,
    spanName: string,
    metadata: Record<string, any> = {}
): void {
    const trace = activeTraces.get(traceId);
    const stack = spanStack.get(traceId);

    if (!trace || !stack) {
        console.warn(`[startSpan] Trace ${traceId} not found`);
        return;
    }

    const newSpan: PerformanceSpan = {
        name: spanName,
        startTime: Date.now(),
        metadata,
        children: [],
    };

    // Add to parent's children
    const parent = stack[stack.length - 1];
    parent.children.push(newSpan);

    // Push to stack
    stack.push(newSpan);
}

/**
 * Ends the current span
 */
export function endSpan(
    traceId: string,
    error?: string
): number {
    const stack = spanStack.get(traceId);

    if (!stack || stack.length <= 1) {
        console.warn(`[endSpan] No span to end for trace ${traceId}`);
        return 0;
    }

    const span = stack.pop()!;
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.error = error;

    return span.duration;
}

/**
 * Ends a trace and returns the performance data
 */
export async function endTrace(
    traceId: string,
    success: boolean = true
): Promise<PerformanceTrace | null> {
    const trace = activeTraces.get(traceId);

    if (!trace) {
        console.warn(`[endTrace] Trace ${traceId} not found`);
        return null;
    }

    // End root span
    trace.rootSpan.endTime = Date.now();
    trace.rootSpan.duration = trace.rootSpan.endTime - trace.rootSpan.startTime;
    trace.totalDuration = trace.rootSpan.duration;
    trace.success = success;

    // Cleanup
    activeTraces.delete(traceId);
    spanStack.delete(traceId);

    // Publish metrics
    await publishTraceMetrics(trace);

    // Log if threshold exceeded
    checkThresholds(trace);

    console.log('[endTrace] Completed', {
        traceId,
        operation: trace.operationType,
        duration: trace.totalDuration,
        success,
    });

    return trace;
}

/**
 * Publishes trace metrics to CloudWatch
 */
async function publishTraceMetrics(trace: PerformanceTrace): Promise<void> {
    // Publish total duration
    await publishMetric(
        MetricName.ASSIGNMENT_LATENCY,
        trace.totalDuration,
        {
            clinicId: trace.clinicId,
            operation: trace.operationType,
            success: String(trace.success),
        }
    );

    // Publish individual span metrics
    async function publishSpanMetrics(span: PerformanceSpan, depth: number = 0): Promise<void> {
        if (span.duration) {
            await publishMetric(
                `${trace.operationType}_${span.name}_duration` as any,
                span.duration,
                {
                    clinicId: trace.clinicId,
                    depth: String(depth),
                }
            );
        }

        for (const child of span.children) {
            await publishSpanMetrics(child, depth + 1);
        }
    }

    for (const child of trace.rootSpan.children) {
        await publishSpanMetrics(child);
    }
}

/**
 * Checks if any spans exceeded thresholds
 */
function checkThresholds(trace: PerformanceTrace): void {
    const threshold = PERFORMANCE_THRESHOLDS[trace.operationType as keyof typeof PERFORMANCE_THRESHOLDS]
        || PERFORMANCE_THRESHOLDS.TOTAL_ROUTING;

    if (trace.totalDuration > threshold) {
        console.warn('[PERFORMANCE_WARNING]', {
            traceId: trace.traceId,
            operation: trace.operationType,
            duration: trace.totalDuration,
            threshold,
            exceededBy: trace.totalDuration - threshold,
            breakdown: getSpanBreakdown(trace.rootSpan),
        });
    }
}

/**
 * Gets a breakdown of span durations
 */
function getSpanBreakdown(span: PerformanceSpan): Record<string, number> {
    const breakdown: Record<string, number> = {};

    function collect(s: PerformanceSpan, prefix: string = ''): void {
        const name = prefix ? `${prefix}.${s.name}` : s.name;
        if (s.duration) {
            breakdown[name] = s.duration;
        }
        for (const child of s.children) {
            collect(child, name);
        }
    }

    collect(span);
    return breakdown;
}

/**
 * Convenience function to time an async operation
 */
export async function timeOperation<T>(
    traceId: string,
    operationName: string,
    operation: () => Promise<T>,
    metadata: Record<string, any> = {}
): Promise<T> {
    startSpan(traceId, operationName, metadata);

    try {
        const result = await operation();
        endSpan(traceId);
        return result;
    } catch (error: any) {
        endSpan(traceId, error.message);
        throw error;
    }
}

/**
 * Creates a timer for manual timing
 */
export function createTimer(): {
    elapsed: () => number;
    elapsedMs: () => number;
} {
    const start = process.hrtime.bigint();

    return {
        elapsed: () => Number(process.hrtime.bigint() - start) / 1e9, // seconds
        elapsedMs: () => Number(process.hrtime.bigint() - start) / 1e6, // milliseconds
    };
}

/**
 * Records a simple latency measurement
 */
export async function recordLatency(
    operationName: string,
    durationMs: number,
    clinicId: string,
    success: boolean = true,
    metadata: Record<string, any> = {}
): Promise<void> {
    await publishMetric(
        MetricName.ASSIGNMENT_LATENCY,
        durationMs,
        {
            clinicId,
            operation: operationName,
            success: String(success),
            ...metadata,
        }
    );

    // Check threshold
    const threshold = PERFORMANCE_THRESHOLDS[operationName as keyof typeof PERFORMANCE_THRESHOLDS];
    if (threshold && durationMs > threshold) {
        console.warn('[LATENCY_WARNING]', {
            operation: operationName,
            duration: durationMs,
            threshold,
        });
    }
}

/**
 * Gets active trace count (for monitoring)
 */
export function getActiveTraceCount(): number {
    return activeTraces.size;
}

/**
 * Cleans up stale traces (older than 5 minutes)
 */
export function cleanupStaleTraces(): number {
    const staleThreshold = Date.now() - (5 * 60 * 1000);
    let cleaned = 0;

    Array.from(activeTraces.entries()).forEach(([traceId, trace]) => {
        const traceTimestamp = new Date(trace.timestamp).getTime();
        if (traceTimestamp < staleThreshold) {
            activeTraces.delete(traceId);
            spanStack.delete(traceId);
            cleaned++;
        }
    });

    if (cleaned > 0) {
        console.warn(`[cleanupStaleTraces] Cleaned ${cleaned} stale traces`);
    }

    return cleaned;
}

/**
 * Formats a trace for logging/display
 */
export function formatTrace(trace: PerformanceTrace): string {
    const lines: string[] = [];
    lines.push(`Trace: ${trace.traceId}`);
    lines.push(`Operation: ${trace.operationType}`);
    lines.push(`Total Duration: ${trace.totalDuration}ms`);
    lines.push(`Success: ${trace.success}`);
    lines.push('');
    lines.push('Breakdown:');

    function formatSpan(span: PerformanceSpan, indent: number = 0): void {
        const prefix = '  '.repeat(indent);
        const status = span.error ? `[ERROR: ${span.error}]` : '';
        lines.push(`${prefix}├─ ${span.name}: ${span.duration || 0}ms ${status}`);
        for (const child of span.children) {
            formatSpan(child, indent + 1);
        }
    }

    for (const child of trace.rootSpan.children) {
        formatSpan(child);
    }

    return lines.join('\n');
}

/**
 * CloudWatch Custom Metrics Module
 * 
 * Centralized metrics publishing for Chime call center observability.
 * Provides real-time visibility into queue health, agent performance,
 * and call quality.
 * 
 * Key Metrics:
 * - Queue depth and wait times
 * - Agent utilization and availability
 * - Call abandonment and service levels
 * - Voice quality indicators
 * 
 * @module cloudwatch-metrics
 */

import {
    CloudWatchClient,
    PutMetricDataCommand,
    StandardUnit
} from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({});

const NAMESPACE = process.env.CHIME_METRICS_NAMESPACE || 'TodaysDental/Chime';
const METRICS_ENABLED = process.env.CHIME_METRICS_ENABLED !== 'false';

// Batch metrics to reduce CloudWatch API calls
interface MetricBatch {
    metrics: MetricData[];
    lastFlush: number;
}

interface MetricData {
    name: string;
    value: number;
    unit: StandardUnit;
    dimensions: Record<string, string>;
    timestamp: Date;
}

const metricBatch: MetricBatch = {
    metrics: [],
    lastFlush: Date.now(),
};

const BATCH_SIZE = 20; // CloudWatch limit per PutMetricData
const FLUSH_INTERVAL_MS = 10000; // Flush every 10 seconds

/**
 * Available metric names
 */
export enum MetricName {
    // Queue Metrics
    QUEUE_DEPTH = 'QueueDepth',
    QUEUE_WAIT_TIME = 'QueueWaitTime',
    LONGEST_QUEUE_WAIT = 'LongestQueueWait',
    CALLS_IN_QUEUE = 'CallsInQueue',

    // Agent Metrics
    AGENTS_ONLINE = 'AgentsOnline',
    AGENTS_AVAILABLE = 'AgentsAvailable',
    AGENTS_ON_CALL = 'AgentsOnCall',
    AGENTS_RINGING = 'AgentsRinging',
    AGENT_UTILIZATION = 'AgentUtilization',

    // Call Metrics
    CALL_VOLUME = 'CallVolume',
    CALLS_ANSWERED = 'CallsAnswered',
    CALLS_ABANDONED = 'CallsAbandoned',
    CALLS_MISSED = 'CallsMissed',
    CALL_DURATION = 'CallDuration',
    CALL_CLAIMED = 'CallClaimed',
    CALL_TIMEOUT = 'CallTimeout',

    // Performance Metrics
    TIME_TO_ANSWER = 'TimeToAnswer',
    SERVICE_LEVEL = 'ServiceLevel',
    FIRST_CALL_RESOLUTION = 'FirstCallResolution',

    // Quality Metrics
    SENTIMENT_SCORE = 'SentimentScore',
    AUDIO_QUALITY = 'AudioQuality',
    CALL_QUALITY_SCORE = 'CallQualityScore',

    // System Metrics
    ASSIGNMENT_LATENCY = 'AssignmentLatency',
    ROUTING_ERRORS = 'RoutingErrors',
    BROADCAST_AGENTS = 'BroadcastAgents',
    OVERFLOW_TRIGGERED = 'OverflowTriggered',
    RETRY_COUNT = 'RetryCount',

    // AI Metrics
    AI_CALLS = 'AICalls',
    AI_HANDOFF = 'AIHandoff',
    AI_SENTIMENT = 'AISentiment',
}

/**
 * Publishes a single metric to CloudWatch
 * Uses batching for efficiency
 */
export async function publishMetric(
    name: MetricName | string,
    value: number,
    dimensions: Record<string, string> = {},
    unit: StandardUnit = StandardUnit.Count
): Promise<void> {
    if (!METRICS_ENABLED) {
        return;
    }

    try {
        const metric: MetricData = {
            name,
            value,
            unit,
            dimensions,
            timestamp: new Date(),
        };

        metricBatch.metrics.push(metric);

        // Flush if batch is full or interval exceeded
        if (
            metricBatch.metrics.length >= BATCH_SIZE ||
            Date.now() - metricBatch.lastFlush >= FLUSH_INTERVAL_MS
        ) {
            await flushMetrics();
        }
    } catch (error: any) {
        console.error('[CloudWatchMetrics] Error queueing metric:', error.message);
    }
}

/**
 * Publishes multiple metrics in a single call
 */
export async function publishMetrics(
    metrics: Array<{
        name: MetricName | string;
        value: number;
        dimensions?: Record<string, string>;
        unit?: StandardUnit;
    }>
): Promise<void> {
    if (!METRICS_ENABLED) {
        return;
    }

    for (const metric of metrics) {
        await publishMetric(
            metric.name,
            metric.value,
            metric.dimensions || {},
            metric.unit || StandardUnit.Count
        );
    }
}

/**
 * Flushes all batched metrics to CloudWatch
 */
export async function flushMetrics(): Promise<void> {
    if (metricBatch.metrics.length === 0) {
        return;
    }

    const metricsToFlush = [...metricBatch.metrics];
    metricBatch.metrics = [];
    metricBatch.lastFlush = Date.now();

    try {
        // Split into batches of 20 (CloudWatch limit)
        for (let i = 0; i < metricsToFlush.length; i += BATCH_SIZE) {
            const batch = metricsToFlush.slice(i, i + BATCH_SIZE);

            await cloudwatch.send(new PutMetricDataCommand({
                Namespace: NAMESPACE,
                MetricData: batch.map(m => ({
                    MetricName: m.name,
                    Value: m.value,
                    Unit: m.unit,
                    Timestamp: m.timestamp,
                    Dimensions: Object.entries(m.dimensions).map(([Name, Value]) => ({
                        Name,
                        Value,
                    })),
                })),
            }));
        }

        console.log(`[CloudWatchMetrics] Flushed ${metricsToFlush.length} metrics`);
    } catch (error: any) {
        console.error('[CloudWatchMetrics] Error flushing metrics:', error.message);
        // Re-queue failed metrics (with limit to prevent memory leak)
        if (metricBatch.metrics.length < BATCH_SIZE * 5) {
            metricBatch.metrics.push(...metricsToFlush);
        }
    }
}

/**
 * Publishes queue health metrics
 */
export async function publishQueueMetrics(
    clinicId: string,
    metrics: {
        queueDepth: number;
        avgWaitTime: number;
        longestWait: number;
        callsInQueue: number;
    }
): Promise<void> {
    await publishMetrics([
        {
            name: MetricName.QUEUE_DEPTH,
            value: metrics.queueDepth,
            dimensions: { ClinicId: clinicId },
        },
        {
            name: MetricName.QUEUE_WAIT_TIME,
            value: metrics.avgWaitTime,
            dimensions: { ClinicId: clinicId },
            unit: StandardUnit.Seconds,
        },
        {
            name: MetricName.LONGEST_QUEUE_WAIT,
            value: metrics.longestWait,
            dimensions: { ClinicId: clinicId },
            unit: StandardUnit.Seconds,
        },
        {
            name: MetricName.CALLS_IN_QUEUE,
            value: metrics.callsInQueue,
            dimensions: { ClinicId: clinicId },
        },
    ]);
}

/**
 * Publishes agent status metrics
 */
export async function publishAgentMetrics(
    clinicId: string,
    metrics: {
        online: number;
        available: number;
        onCall: number;
        ringing: number;
    }
): Promise<void> {
    const utilization = metrics.online > 0
        ? Math.round((metrics.onCall / metrics.online) * 100)
        : 0;

    await publishMetrics([
        {
            name: MetricName.AGENTS_ONLINE,
            value: metrics.online,
            dimensions: { ClinicId: clinicId },
        },
        {
            name: MetricName.AGENTS_AVAILABLE,
            value: metrics.available,
            dimensions: { ClinicId: clinicId },
        },
        {
            name: MetricName.AGENTS_ON_CALL,
            value: metrics.onCall,
            dimensions: { ClinicId: clinicId },
        },
        {
            name: MetricName.AGENTS_RINGING,
            value: metrics.ringing,
            dimensions: { ClinicId: clinicId },
        },
        {
            name: MetricName.AGENT_UTILIZATION,
            value: utilization,
            dimensions: { ClinicId: clinicId },
            unit: StandardUnit.Percent,
        },
    ]);
}

/**
 * Publishes call completion metrics
 */
export async function publishCallMetrics(
    clinicId: string,
    callType: 'answered' | 'abandoned' | 'missed',
    duration: number = 0,
    waitTime: number = 0
): Promise<void> {
    const metricName = callType === 'answered' ? MetricName.CALLS_ANSWERED :
        callType === 'abandoned' ? MetricName.CALLS_ABANDONED :
            MetricName.CALLS_MISSED;

    await publishMetrics([
        {
            name: metricName,
            value: 1,
            dimensions: { ClinicId: clinicId },
        },
        {
            name: MetricName.CALL_VOLUME,
            value: 1,
            dimensions: { ClinicId: clinicId, CallType: callType },
        },
        ...(callType === 'answered' ? [
            {
                name: MetricName.CALL_DURATION,
                value: duration,
                dimensions: { ClinicId: clinicId },
                unit: StandardUnit.Seconds as StandardUnit,
            },
            {
                name: MetricName.TIME_TO_ANSWER,
                value: waitTime,
                dimensions: { ClinicId: clinicId },
                unit: StandardUnit.Seconds as StandardUnit,
            },
        ] : []),
    ]);
}

/**
 * Publishes service level metrics
 * Service Level = % of calls answered within threshold (e.g., 30 seconds)
 */
export async function publishServiceLevel(
    clinicId: string,
    answeredWithinThreshold: number,
    totalCalls: number,
    thresholdSeconds: number = 30
): Promise<void> {
    const serviceLevel = totalCalls > 0
        ? Math.round((answeredWithinThreshold / totalCalls) * 100)
        : 100;

    await publishMetric(
        MetricName.SERVICE_LEVEL,
        serviceLevel,
        { ClinicId: clinicId, ThresholdSeconds: String(thresholdSeconds) },
        StandardUnit.Percent
    );
}

/**
 * Publishes call quality metrics
 */
export async function publishQualityMetrics(
    clinicId: string,
    callId: string,
    metrics: {
        sentimentScore?: number;
        audioQuality?: number;
        overallQuality?: number;
    }
): Promise<void> {
    const metricsToPublish: Array<{
        name: MetricName;
        value: number;
        dimensions: Record<string, string>;
        unit?: StandardUnit;
    }> = [];

    if (metrics.sentimentScore !== undefined) {
        metricsToPublish.push({
            name: MetricName.SENTIMENT_SCORE,
            value: metrics.sentimentScore,
            dimensions: { ClinicId: clinicId },
        });
    }

    if (metrics.audioQuality !== undefined) {
        metricsToPublish.push({
            name: MetricName.AUDIO_QUALITY,
            value: metrics.audioQuality,
            dimensions: { ClinicId: clinicId },
        });
    }

    if (metrics.overallQuality !== undefined) {
        metricsToPublish.push({
            name: MetricName.CALL_QUALITY_SCORE,
            value: metrics.overallQuality,
            dimensions: { ClinicId: clinicId },
        });
    }

    await publishMetrics(metricsToPublish);
}

/**
 * Publishes routing performance metrics
 */
export async function publishRoutingMetrics(
    clinicId: string,
    metrics: {
        assignmentLatencyMs: number;
        broadcastAgentCount?: number;
        overflowTriggered?: boolean;
        retryCount?: number;
        success: boolean;
    }
): Promise<void> {
    await publishMetrics([
        {
            name: MetricName.ASSIGNMENT_LATENCY,
            value: metrics.assignmentLatencyMs,
            dimensions: { ClinicId: clinicId },
            unit: StandardUnit.Milliseconds,
        },
        ...(metrics.broadcastAgentCount !== undefined ? [{
            name: MetricName.BROADCAST_AGENTS,
            value: metrics.broadcastAgentCount,
            dimensions: { ClinicId: clinicId },
        }] : []),
        ...(metrics.overflowTriggered ? [{
            name: MetricName.OVERFLOW_TRIGGERED,
            value: 1,
            dimensions: { ClinicId: clinicId },
        }] : []),
        ...(metrics.retryCount !== undefined && metrics.retryCount > 0 ? [{
            name: MetricName.RETRY_COUNT,
            value: metrics.retryCount,
            dimensions: { ClinicId: clinicId },
        }] : []),
        ...(!metrics.success ? [{
            name: MetricName.ROUTING_ERRORS,
            value: 1,
            dimensions: { ClinicId: clinicId },
        }] : []),
    ]);
}

/**
 * Creates a timer for measuring latency
 * Returns a function that publishes the elapsed time when called
 */
export function createLatencyTimer(
    metricName: MetricName,
    dimensions: Record<string, string> = {}
): () => Promise<number> {
    const startTime = Date.now();

    return async () => {
        const elapsed = Date.now() - startTime;
        await publishMetric(metricName, elapsed, dimensions, StandardUnit.Milliseconds);
        return elapsed;
    };
}

/**
 * Shutdown hook to flush remaining metrics
 */
export async function shutdownMetrics(): Promise<void> {
    await flushMetrics();
    console.log('[CloudWatchMetrics] Shutdown complete');
}

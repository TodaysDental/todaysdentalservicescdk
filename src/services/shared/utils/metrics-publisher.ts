import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';

class MetricsPublisher {
  private static instance: MetricsPublisher;
  private client: CloudWatchClient;
  private namespace: string;
  private buffer: MetricDatum[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 20; // CloudWatch limit
  private readonly FLUSH_INTERVAL_MS = 60000; // 1 minute
  private readonly MAX_BUFFER_SIZE = 1000; // FIX #34: Prevent unbounded growth
  private dropped = 0; // FIX #34: Track dropped metrics

  private constructor(namespace: string = 'ContactCenter') {
    this.client = new CloudWatchClient({});
    this.namespace = namespace;
    this.startAutoFlush();
  }

  public static getInstance(namespace?: string): MetricsPublisher {
    if (!MetricsPublisher.instance) {
      MetricsPublisher.instance = new MetricsPublisher(namespace);
    }
    return MetricsPublisher.instance;
  }

  private startAutoFlush() {
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => console.error('[MetricsPublisher] Auto-flush error:', err));
    }, this.FLUSH_INTERVAL_MS);
  }

  public async publishMetric(
    name: string,
    value: number,
    unit: string = 'Count',
    dimensions?: Record<string, string>
  ) {
    // FIX #34: Check buffer capacity before adding
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.dropped++;

      // Log warning every 100 drops
      if (this.dropped % 100 === 0) {
        console.warn(`[MetricsPublisher] Dropped ${this.dropped} metrics due to buffer overflow`);
      }

      // Try emergency flush
      if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
        await this.flush().catch(err => 
          console.error('[MetricsPublisher] Emergency flush failed:', err)
        );
      }

      // If still full, drop this metric
      if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
        return;
      }
    }

    const metric: MetricDatum = {
      MetricName: name,
      Value: value,
      Unit: unit as any,
      Timestamp: new Date(),
    };

    if (dimensions) {
      metric.Dimensions = Object.entries(dimensions).map(([key, value]) => ({
        Name: key,
        Value: value,
      }));
    }

    this.buffer.push(metric);

    // Flush if buffer is full
    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flush();
    }
  }

  public async flush() {
    if (this.buffer.length === 0) return;

    // Take max one batch
    const metricsToSend = this.buffer.splice(0, this.BATCH_SIZE);

    try {
      await this.client.send(new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metricsToSend,
      }));

      console.log(`[MetricsPublisher] Published ${metricsToSend.length} metrics`);

      // FIX #34: Reset drop counter on successful flush
      if (this.dropped > 0) {
        console.log(`[MetricsPublisher] Recovered. Total dropped: ${this.dropped}`);
        this.dropped = 0;
      }

    } catch (err) {
      console.error('[MetricsPublisher] Failed to publish metrics:', err);

      // FIX #34: Re-add to front of buffer for retry (if space)
      if (this.buffer.length + metricsToSend.length <= this.MAX_BUFFER_SIZE) {
        this.buffer.unshift(...metricsToSend);
      } else {
        this.dropped += metricsToSend.length;
      }
    }
  }

  /**
   * FIX #34: Get count of dropped metrics
   */
  public getDroppedCount(): number {
    return this.dropped;
  }

  public async publishCallMetrics(callId: string, metrics: {
    queueTime?: number;
    ringTime?: number;
    talkTime?: number;
    holdTime?: number;
    abandoned?: boolean;
    transferred?: boolean;
  }) {
    const dimensions = { CallId: callId };

    if (metrics.queueTime !== undefined) {
      await this.publishMetric('QueueTimeSeconds', metrics.queueTime, 'Seconds', dimensions);
    }

    if (metrics.ringTime !== undefined) {
      await this.publishMetric('RingTimeSeconds', metrics.ringTime, 'Seconds', dimensions);
    }

    if (metrics.talkTime !== undefined) {
      await this.publishMetric('TalkTimeSeconds', metrics.talkTime, 'Seconds', dimensions);
    }

    if (metrics.holdTime !== undefined) {
      await this.publishMetric('HoldTimeSeconds', metrics.holdTime, 'Seconds', dimensions);
    }

    if (metrics.abandoned) {
      await this.publishMetric('AbandonedCalls', 1, 'Count', dimensions);
    }

    if (metrics.transferred) {
      await this.publishMetric('TransferredCalls', 1, 'Count', dimensions);
    }
  }

  public async publishQueueMetrics(clinicId: string, metrics: {
    queuedCount?: number;
    waitTime?: number;
    onlineAgents?: number;
  }) {
    const dimensions = { ClinicId: clinicId };

    if (metrics.queuedCount !== undefined) {
      await this.publishMetric('QueuedCallsCount', metrics.queuedCount, 'Count', dimensions);
    }

    if (metrics.waitTime !== undefined) {
      await this.publishMetric('AverageWaitTimeSeconds', metrics.waitTime, 'Seconds', dimensions);
    }

    if (metrics.onlineAgents !== undefined) {
      await this.publishMetric('OnlineAgentsCount', metrics.onlineAgents, 'Count', dimensions);
    }
  }

  public destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

export function getMetricsPublisher(namespace?: string): MetricsPublisher {
  return MetricsPublisher.getInstance(namespace);
}

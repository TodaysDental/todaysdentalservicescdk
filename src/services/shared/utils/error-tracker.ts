/**
 * FIX #51: Silent Failures on Cleanup
 * 
 * Implements comprehensive error tracking and alerting for cleanup operations
 * and other critical system functions.
 */

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ErrorEntry {
  operation: string;
  error: string;
  severity: ErrorSeverity;
  timestamp: string;
  metadata?: any;
  stack?: string;
}

export class ErrorTracker {
  private cloudwatch: CloudWatchClient;
  private sns: SNSClient;
  private errorBuffer: ErrorEntry[] = [];
  private readonly alertTopicArn?: string;
  private readonly namespace: string;

  constructor(options: {
    alertTopicArn?: string;
    namespace?: string;
  } = {}) {
    this.cloudwatch = new CloudWatchClient({});
    this.sns = new SNSClient({});
    this.alertTopicArn = options.alertTopicArn || process.env.ERROR_ALERT_TOPIC_ARN;
    this.namespace = options.namespace || 'ContactCenter/Errors';
  }

  /**
   * Track an error with specified severity
   * Automatically publishes metrics and sends alerts for HIGH/CRITICAL errors
   */
  async trackError(
    operation: string,
    error: Error,
    severity: ErrorSeverity = 'MEDIUM',
    metadata?: any
  ): Promise<void> {
    const errorEntry: ErrorEntry = {
      operation,
      error: error.message,
      severity,
      timestamp: new Date().toISOString(),
      metadata,
      stack: error.stack
    };

    this.errorBuffer.push(errorEntry);

    // Log to CloudWatch Logs
    console.error(`[ErrorTracker] ${severity}: ${operation}`, {
      message: error.message,
      metadata,
      stack: error.stack
    });

    // Publish metric (fire and forget, don't block on this)
    this.publishMetric(operation, severity).catch(err => {
      console.error('[ErrorTracker] Failed to publish metric:', err);
    });

    // Alert on HIGH/CRITICAL errors
    if ((severity === 'HIGH' || severity === 'CRITICAL') && this.alertTopicArn) {
      await this.sendAlert(errorEntry).catch(err => {
        console.error('[ErrorTracker] Failed to send alert:', err);
      });
    }
  }

  /**
   * Publish error metric to CloudWatch
   */
  private async publishMetric(operation: string, severity: ErrorSeverity): Promise<void> {
    try {
      await this.cloudwatch.send(new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: 'ErrorCount',
            Value: 1,
            Unit: 'Count',
            Timestamp: new Date(),
            Dimensions: [
              { Name: 'Operation', Value: operation },
              { Name: 'Severity', Value: severity }
            ]
          }
        ]
      }));
    } catch (err) {
      // Don't throw - metrics are best-effort
      console.error('[ErrorTracker] Metric publish failed:', err);
    }
  }

  /**
   * Send alert via SNS for critical errors
   */
  private async sendAlert(errorEntry: ErrorEntry): Promise<void> {
    if (!this.alertTopicArn) {
      console.warn('[ErrorTracker] No alert topic ARN configured, skipping alert');
      return;
    }

    try {
      await this.sns.send(new PublishCommand({
        TopicArn: this.alertTopicArn,
        Subject: `[${errorEntry.severity}] Call Center Error: ${errorEntry.operation}`,
        Message: JSON.stringify({
          severity: errorEntry.severity,
          operation: errorEntry.operation,
          error: errorEntry.error,
          timestamp: errorEntry.timestamp,
          metadata: errorEntry.metadata,
          stack: errorEntry.stack
        }, null, 2)
      }));
    } catch (err) {
      console.error('[ErrorTracker] Failed to send SNS alert:', err);
      // Don't throw - continue execution
    }
  }

  /**
   * Track a successful operation (for monitoring success rate)
   */
  async trackSuccess(operation: string, metadata?: any): Promise<void> {
    console.log(`[ErrorTracker] SUCCESS: ${operation}`, metadata);

    try {
      await this.cloudwatch.send(new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: 'SuccessCount',
            Value: 1,
            Unit: 'Count',
            Timestamp: new Date(),
            Dimensions: [
              { Name: 'Operation', Value: operation }
            ]
          }
        ]
      }));
    } catch (err) {
      // Don't throw - metrics are best-effort
      console.error('[ErrorTracker] Success metric publish failed:', err);
    }
  }

  /**
   * Get buffered errors (useful for debugging)
   */
  getBufferedErrors(): ErrorEntry[] {
    return [...this.errorBuffer];
  }

  /**
   * Clear error buffer
   */
  clearBuffer(): void {
    this.errorBuffer = [];
  }

  /**
   * Flush buffered errors to logs
   */
  async flush(): Promise<void> {
    if (this.errorBuffer.length > 0) {
      console.log(`[ErrorTracker] Flushing ${this.errorBuffer.length} buffered errors`);
      
      // Group by severity
      const bySeverity = this.errorBuffer.reduce((acc, err) => {
        acc[err.severity] = (acc[err.severity] || 0) + 1;
        return acc;
      }, {} as Record<ErrorSeverity, number>);

      console.log('[ErrorTracker] Error summary:', bySeverity);
      this.clearBuffer();
    }
  }
}

/**
 * Singleton instance for easy import
 */
let globalErrorTracker: ErrorTracker | null = null;

export function getErrorTracker(): ErrorTracker {
  if (!globalErrorTracker) {
    globalErrorTracker = new ErrorTracker();
  }
  return globalErrorTracker;
}

/**
 * Helper to wrap async functions with error tracking
 */
export function withErrorTracking<T>(
  operation: string,
  fn: () => Promise<T>,
  severity: ErrorSeverity = 'MEDIUM'
): Promise<T> {
  const tracker = getErrorTracker();
  
  return fn()
    .then(result => {
      tracker.trackSuccess(operation).catch(() => {});
      return result;
    })
    .catch(async err => {
      await tracker.trackError(operation, err, severity);
      throw err;
    });
}


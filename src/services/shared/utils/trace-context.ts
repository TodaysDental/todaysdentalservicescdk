/**
 * FIX #35: Call Flow Tracing
 * 
 * Provides end-to-end trace IDs for tracking calls through their lifecycle.
 * Integrates with AWS X-Ray when available.
 */

import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// Global async local storage for trace context
const asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

export class TraceContext {
  /**
   * Generate a new trace ID for a call
   */
  static generate(callId: string): string {
    // Format: call_{callId}_{timestamp}_{random}
    return `call_${callId}_${Date.now()}_${randomUUID().substring(0, 8)}`;
  }

  /**
   * Attach trace ID to current async context
   */
  static attach(traceId: string): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.set('traceId', traceId);
    }

    // Set in X-Ray if available
    if (process.env.AWS_XRAY_TRACING_ENABLED === 'true') {
      try {
        // Use AWS X-Ray SDK if available
        const AWSXRay = require('aws-xray-sdk-core');
        AWSXRay.getSegment()?.addAnnotation('traceId', traceId);
      } catch (err) {
        // X-Ray not available, skip
      }
    }
  }

  /**
   * Get current trace ID from context
   */
  static get(): string | undefined {
    const store = asyncLocalStorage.getStore();
    return store?.get('traceId');
  }

  /**
   * Run a function with trace context
   */
  static run<T>(traceId: string, fn: () => T): T {
    const store = new Map<string, any>();
    store.set('traceId', traceId);
    return asyncLocalStorage.run(store, fn);
  }

  /**
   * Create trace headers for HTTP requests
   */
  static getHeaders(): Record<string, string> {
    const traceId = TraceContext.get();
    if (!traceId) return {};

    return {
      'X-Trace-Id': traceId
    };
  }

  /**
   * Extract trace ID from request headers
   */
  static fromHeaders(headers: Record<string, string | undefined>): string | undefined {
    return headers['X-Trace-Id'] || 
           headers['x-trace-id'] || 
           headers['X-TRACE-ID'];
  }
}


/**
 * FIX #52: Partial Success Tracking
 * 
 * Tracks operations that partially succeed to enable retry and debugging.
 * Useful for batch operations where some items succeed and others fail.
 */

import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

export interface OperationResult {
  operation: string;
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ item: any; error: string }>;
  partialSuccess: boolean;
}

export class PartialSuccessTracker {
  private results: OperationResult[] = [];

  /**
   * Execute a batch of operations and track partial success
   */
  async executeAll<T>(
    items: T[],
    operation: string,
    handler: (item: T) => Promise<void>
  ): Promise<OperationResult> {
    const result: OperationResult = {
      operation,
      total: items.length,
      succeeded: 0,
      failed: 0,
      errors: [],
      partialSuccess: false
    };

    const promises = items.map(async (item) => {
      try {
        await handler(item);
        result.succeeded++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          item: this.sanitizeItem(item),
          error: err.message
        });
      }
    });

    await Promise.allSettled(promises);

    result.partialSuccess = result.succeeded > 0 && result.failed > 0;

    this.results.push(result);

    // Log result
    if (result.partialSuccess) {
      console.warn(`[PartialSuccess] ${operation}: ${result.succeeded}/${result.total} succeeded`, {
        errors: result.errors
      });
    } else if (result.failed === result.total) {
      console.error(`[PartialSuccess] ${operation}: All ${result.total} failed`);
    } else {
      console.log(`[PartialSuccess] ${operation}: All ${result.total} succeeded`);
    }

    return result;
  }

  /**
   * Sanitize items for logging (remove PII)
   */
  private sanitizeItem(item: any): any {
    // Remove PII from items for logging
    if (typeof item === 'string') return '***';
    if (typeof item === 'object') {
      return {
        type: item.constructor?.name,
        id: item.id || item.agentId || item.callId || '***'
      };
    }
    return item;
  }

  /**
   * Get all tracked results
   */
  getResults(): OperationResult[] {
    return this.results;
  }

  /**
   * Check if any operations had partial failures
   */
  hasPartialFailures(): boolean {
    return this.results.some(r => r.partialSuccess || r.failed > 0);
  }
}

/**
 * Store partial failure for retry
 */
export async function storePartialFailure(
  ddb: DynamoDBDocumentClient,
  result: OperationResult,
  tableName: string
): Promise<void> {
  if (!result.partialSuccess && result.failed === 0) {
    return; // No failures to store
  }

  await ddb.send(new PutCommand({
    TableName: tableName,
    Item: {
      failureId: randomUUID(),
      timestamp: Date.now(),
      operation: result.operation,
      result,
      retryCount: 0,
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    }
  }));
}


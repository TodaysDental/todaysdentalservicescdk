/**
 * FIX #42: Rate Limiter State Not Shared
 * 
 * Implements distributed rate limiting using DynamoDB
 * to enforce limits across all Lambda containers.
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export class DistributedRateLimiter {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private tableName: string,
    private limitKey: string,
    private maxRequests: number,
    private windowSeconds: number
  ) {}

  /**
   * Check if the request is within rate limits
   * Uses atomic DynamoDB operations to track and enforce limits
   */
  async checkLimit(tokens: number = 1): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - this.windowSeconds;

    try {
      // Attempt atomic increment with cleanup of old window
      const result = await this.ddb.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { limitKey: this.limitKey },
        UpdateExpression: `
          SET 
            requestCount = if_not_exists(requestCount, :zero) + :tokens,
            windowStart = if_not_exists(windowStart, :now),
            lastRequest = :now,
            ttl = :ttl
        `,
        ConditionExpression: `
          (attribute_not_exists(requestCount) OR 
           requestCount + :tokens <= :maxRequests OR
           windowStart < :windowStart)
        `,
        ExpressionAttributeValues: {
          ':zero': 0,
          ':tokens': tokens,
          ':now': now,
          ':windowStart': windowStart,
          ':maxRequests': this.maxRequests,
          ':ttl': now + this.windowSeconds + 300 // Extra buffer for cleanup
        },
        ReturnValues: 'ALL_NEW'
      }));

      // Check if we need to reset the window
      const currentWindowStart = result.Attributes?.windowStart || now;
      if (currentWindowStart < windowStart) {
        // Window expired, reset and try again
        await this.resetLimit();
        return this.checkLimit(tokens);
      }

      const requestCount = result.Attributes?.requestCount || 0;
      const resetAt = currentWindowStart + this.windowSeconds;

      return {
        allowed: true,
        remaining: Math.max(0, this.maxRequests - requestCount),
        resetAt
      };

    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        // Rate limit exceeded - get current state
        const { Item } = await this.ddb.send(new GetCommand({
          TableName: this.tableName,
          Key: { limitKey: this.limitKey }
        }));

        const currentWindowStart = Item?.windowStart || now;
        const resetAt = currentWindowStart + this.windowSeconds;
        const retryAfter = Math.max(0, resetAt - now);

        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter
        };
      }
      throw err;
    }
  }

  /**
   * Reset the rate limit for this key
   */
  async resetLimit(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    
    await this.ddb.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { limitKey: this.limitKey },
      UpdateExpression: 'SET requestCount = :zero, windowStart = :now, ttl = :ttl',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':now': now,
        ':ttl': now + this.windowSeconds + 300
      }
    }));
  }

  /**
   * Get current rate limit status without consuming tokens
   */
  async getStatus(): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    
    const { Item } = await this.ddb.send(new GetCommand({
      TableName: this.tableName,
      Key: { limitKey: this.limitKey }
    }));

    if (!Item) {
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: now + this.windowSeconds
      };
    }

    const windowStart = Item.windowStart || now;
    const requestCount = Item.requestCount || 0;
    const resetAt = windowStart + this.windowSeconds;

    // Check if window has expired
    if (windowStart < now - this.windowSeconds) {
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: now + this.windowSeconds
      };
    }

    const remaining = Math.max(0, this.maxRequests - requestCount);
    const allowed = remaining > 0;

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : Math.max(0, resetAt - now)
    };
  }
}

/**
 * Factory function to create rate limiters with common configurations
 */
export function createRateLimiter(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  config: {
    limitKey: string;
    maxRequests: number;
    windowSeconds: number;
  }
): DistributedRateLimiter {
  return new DistributedRateLimiter(
    ddb,
    tableName,
    config.limitKey,
    config.maxRequests,
    config.windowSeconds
  );
}

/**
 * Common rate limit configurations
 */
export const RATE_LIMIT_PRESETS = {
  // Aggressive limits for expensive operations
  STRICT: { maxRequests: 10, windowSeconds: 60 },
  
  // Standard API limits
  STANDARD: { maxRequests: 100, windowSeconds: 60 },
  
  // Relaxed limits for lightweight operations
  RELAXED: { maxRequests: 500, windowSeconds: 60 },
  
  // Per-hour limits for batch operations
  HOURLY: { maxRequests: 1000, windowSeconds: 3600 }
};

/**
 * Build standard rate limit headers for HTTP responses
 */
export function buildRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.remaining + (result.allowed ? 1 : 0)),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt)
  };

  if (result.retryAfter !== undefined) {
    headers['Retry-After'] = String(result.retryAfter);
  }

  return headers;
}


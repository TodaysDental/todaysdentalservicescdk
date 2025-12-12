import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

export interface LockConfig {
  tableName: string;
  lockKey: string;
  ttlSeconds?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Result of a lock acquisition with fencing token
 * The fencing token should be passed to downstream operations
 * to detect stale lock holders (e.g., after process pause/resume)
 */
export interface LockAcquisitionResult {
  acquired: boolean;
  fencingToken?: number;
}

// FIX: List of retryable DynamoDB errors
const RETRYABLE_ERRORS = [
  'ConditionalCheckFailedException', // Lock is held by another process
  'ProvisionedThroughputExceededException', // Throttling
  'ThrottlingException', // General throttling
  'RequestLimitExceeded', // Request rate limit
  'InternalServerError', // Transient internal error
  'ServiceUnavailable', // Service temporarily unavailable
];

export class DistributedLock {
  private lockId: string;
  private acquired: boolean = false;
  private fencingToken: number = 0;

  constructor(
    private ddb: DynamoDBDocumentClient,
    private config: LockConfig
  ) {
    this.lockId = randomUUID();
  }

  /**
   * Acquire the lock
   * @returns boolean for backwards compatibility
   */
  async acquire(): Promise<boolean> {
    const result = await this.acquireWithFencingToken();
    return result.acquired;
  }

  /**
   * Acquire the lock with a fencing token
   * The fencing token is a monotonically increasing value that can be used
   * to detect stale lock holders in downstream operations.
   * 
   * FIX: Addresses the distributed systems problem where:
   * 1. Process A acquires lock
   * 2. Process A freezes (GC pause, throttling)
   * 3. Lock expires via TTL
   * 4. Process B acquires lock and makes progress
   * 5. Process A resumes - both think they have the lock
   * 
   * Solution: Downstream operations should verify fencing token hasn't been superseded
   */
  async acquireWithFencingToken(): Promise<LockAcquisitionResult> {
    const { tableName, lockKey, ttlSeconds = 30, maxRetries = 3, retryDelayMs = 100 } = this.config;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // First, try to read current fencing token to increment it
        let nextFencingToken = 1;
        try {
          const { Item } = await this.ddb.send(new GetCommand({
            TableName: tableName,
            Key: { lockKey },
            ProjectionExpression: 'fencingToken'
          }));
          if (Item?.fencingToken && typeof Item.fencingToken === 'number') {
            nextFencingToken = Item.fencingToken + 1;
          }
        } catch (readErr) {
          // Ignore read errors - we'll use default token of 1
          console.warn(`[DistributedLock] Could not read current fencing token for ${lockKey}:`, readErr);
        }

        await this.ddb.send(new PutCommand({
          TableName: tableName,
          Item: {
            lockKey,
            lockId: this.lockId,
            acquiredAt: now,
            expiresAt,
            fencingToken: nextFencingToken,
            ttl: expiresAt + 300 // Clean up 5 minutes after expiry
          },
          ConditionExpression: 'attribute_not_exists(lockKey) OR expiresAt < :now',
          ExpressionAttributeValues: {
            ':now': now
          }
        }));

        this.acquired = true;
        this.fencingToken = nextFencingToken;
        console.log(`[DistributedLock] Acquired lock: ${lockKey} (fencingToken: ${nextFencingToken})`);
        return { acquired: true, fencingToken: nextFencingToken };
      } catch (err: any) {
        const errorName = err.name || err.code || '';
        const isRetryable = RETRYABLE_ERRORS.includes(errorName);
        
        if (isRetryable) {
          // FIX: Retry on throttling and other transient errors, not just condition failures
          if (attempt < maxRetries - 1) {
            // Use exponential backoff with jitter for throttling
            const baseBackoff = retryDelayMs * Math.pow(2, attempt);
            const jitter = Math.random() * baseBackoff * 0.1; // 10% jitter
            const backoff = Math.floor(baseBackoff + jitter);
            
            if (errorName !== 'ConditionalCheckFailedException') {
              console.warn(`[DistributedLock] Retryable error (${errorName}), attempt ${attempt + 1}/${maxRetries}, backoff ${backoff}ms: ${lockKey}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, backoff));
            continue;
          }
          // Last attempt failed with retryable error
          console.warn(`[DistributedLock] Exhausted retries for ${lockKey} after ${errorName}`);
        } else {
          // Non-retryable error - log and throw
          console.error(`[DistributedLock] Non-retryable error acquiring lock ${lockKey}:`, errorName, err.message);
          throw err;
        }
      }
    }

    console.warn(`[DistributedLock] Failed to acquire lock after ${maxRetries} attempts: ${lockKey}`);
    return { acquired: false };
  }

  async release(): Promise<void> {
    if (!this.acquired) return;

    const { tableName, lockKey } = this.config;

    // FIX: Add retry logic for release as well (throttling can happen here too)
    const maxReleaseRetries = 3;
    for (let attempt = 0; attempt < maxReleaseRetries; attempt++) {
      try {
        await this.ddb.send(new DeleteCommand({
          TableName: tableName,
          Key: { lockKey },
          ConditionExpression: 'lockId = :lockId',
          ExpressionAttributeValues: {
            ':lockId': this.lockId
          }
        }));

        this.acquired = false;
        console.log(`[DistributedLock] Released lock: ${lockKey}`);
        return;
      } catch (err: any) {
        const errorName = err.name || err.code || '';
        
        if (errorName === 'ConditionalCheckFailedException') {
          // Lock was already released or expired - that's fine
          this.acquired = false;
          console.log(`[DistributedLock] Lock already released or expired: ${lockKey}`);
          return;
        }
        
        // Check if it's a throttling error
        const isThrottling = ['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded'].includes(errorName);
        
        if (isThrottling && attempt < maxReleaseRetries - 1) {
          const backoff = 100 * Math.pow(2, attempt);
          console.warn(`[DistributedLock] Throttled releasing lock, retrying in ${backoff}ms: ${lockKey}`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        // Log but don't throw - release is best-effort
        // The TTL will eventually clean up the lock
        console.error(`[DistributedLock] Error releasing lock: ${lockKey}`, errorName, err.message);
        this.acquired = false; // Mark as not acquired to prevent further release attempts
        return;
      }
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const acquired = await this.acquire();
    if (!acquired) return null;

    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
  
  /**
   * Check if this lock instance currently holds the lock
   */
  isAcquired(): boolean {
    return this.acquired;
  }

  /**
   * Get the fencing token for this lock acquisition
   * Returns 0 if lock was not acquired
   */
  getFencingToken(): number {
    return this.fencingToken;
  }

  /**
   * Validate that the current fencing token is still valid
   * This should be called before performing critical operations
   * to detect if another process has acquired the lock
   * 
   * @returns true if the fencing token is still the highest for this lock
   */
  async validateFencingToken(): Promise<boolean> {
    if (!this.acquired || this.fencingToken === 0) {
      return false;
    }

    const { tableName, lockKey } = this.config;

    try {
      const { Item } = await this.ddb.send(new GetCommand({
        TableName: tableName,
        Key: { lockKey },
        ConsistentRead: true
      }));

      if (!Item) {
        // Lock record doesn't exist - we no longer hold it
        console.warn(`[DistributedLock] Lock record not found for ${lockKey} - fencing token invalid`);
        this.acquired = false;
        return false;
      }

      if (Item.lockId !== this.lockId) {
        // Another process acquired the lock
        console.warn(`[DistributedLock] Lock ${lockKey} owned by different process - fencing token invalid`);
        this.acquired = false;
        return false;
      }

      if (Item.fencingToken !== this.fencingToken) {
        // Fencing token changed (shouldn't happen if lockId matches, but check anyway)
        console.warn(`[DistributedLock] Fencing token mismatch for ${lockKey}: expected ${this.fencingToken}, got ${Item.fencingToken}`);
        this.acquired = false;
        return false;
      }

      // Check if lock has expired
      const now = Math.floor(Date.now() / 1000);
      if (Item.expiresAt < now) {
        console.warn(`[DistributedLock] Lock ${lockKey} has expired - fencing token invalid`);
        this.acquired = false;
        return false;
      }

      return true;
    } catch (err) {
      console.error(`[DistributedLock] Error validating fencing token for ${lockKey}:`, err);
      return false;
    }
  }
}

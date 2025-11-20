import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

export interface LockConfig {
  tableName: string;
  lockKey: string;
  ttlSeconds?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class DistributedLock {
  private lockId: string;
  private acquired: boolean = false;

  constructor(
    private ddb: DynamoDBDocumentClient,
    private config: LockConfig
  ) {
    this.lockId = randomUUID();
  }

  async acquire(): Promise<boolean> {
    const { tableName, lockKey, ttlSeconds = 30, maxRetries = 3, retryDelayMs = 100 } = this.config;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.ddb.send(new PutCommand({
          TableName: tableName,
          Item: {
            lockKey,
            lockId: this.lockId,
            acquiredAt: now,
            expiresAt,
            ttl: expiresAt + 300 // Clean up 5 minutes after expiry
          },
          ConditionExpression: 'attribute_not_exists(lockKey) OR expiresAt < :now',
          ExpressionAttributeValues: {
            ':now': now
          }
        }));

        this.acquired = true;
        console.log(`[DistributedLock] Acquired lock: ${lockKey}`);
        return true;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          // Lock is held by another process
          if (attempt < maxRetries - 1) {
            const backoff = retryDelayMs * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, backoff));
            continue;
          }
        } else {
          throw err;
        }
      }
    }

    console.warn(`[DistributedLock] Failed to acquire lock after ${maxRetries} attempts: ${lockKey}`);
    return false;
  }

  async release(): Promise<void> {
    if (!this.acquired) return;

    const { tableName, lockKey } = this.config;

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
    } catch (err: any) {
      if (err.name !== 'ConditionalCheckFailedException') {
        console.error(`[DistributedLock] Error releasing lock: ${lockKey}`, err);
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
}

/**
 * HR Rate Limiter
 *
 * WARNING: The in-memory functions (checkRateLimit, checkAdvancePayRateLimit,
 * checkShiftCreationRateLimit, checkApiRateLimit) only limit per Lambda instance.
 * They do NOT provide distributed rate limiting across concurrent Lambda invocations.
 * For critical operations, use checkDistributedRateLimit() which is DynamoDB-backed
 * and works across all Lambda instances.
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RATE_LIMIT_CONFIG } from './config';

// In-memory cache for rate limiting (per Lambda instance)
const rateLimitCache = new Map<string, { count: number; windowStart: number }>();

interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetIn: number; // seconds until reset
    message?: string;
}

/**
 * Check rate limit for an action (in-memory only, per Lambda instance).
 * NOTE: This does NOT rate-limit across Lambda instances. For cross-instance
 * rate limiting, use checkDistributedRateLimit() instead.
 */
export function checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
): RateLimitResult {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    const cached = rateLimitCache.get(key);

    if (!cached || now - cached.windowStart > windowMs) {
        // New window
        rateLimitCache.set(key, { count: 1, windowStart: now });
        return {
            allowed: true,
            remaining: limit - 1,
            resetIn: windowSeconds,
        };
    }

    if (cached.count >= limit) {
        const resetIn = Math.ceil((windowMs - (now - cached.windowStart)) / 1000);
        return {
            allowed: false,
            remaining: 0,
            resetIn,
            message: `Rate limit exceeded. Try again in ${resetIn} seconds.`,
        };
    }

    cached.count++;
    rateLimitCache.set(key, cached);

    return {
        allowed: true,
        remaining: limit - cached.count,
        resetIn: Math.ceil((windowMs - (now - cached.windowStart)) / 1000),
    };
}

/**
 * Check advance pay request rate limit
 */
export function checkAdvancePayRateLimit(userId: string): RateLimitResult {
    const key = `advance-pay:${userId}`;
    return checkRateLimit(key, RATE_LIMIT_CONFIG.advancePayRequestsPerHour, 3600);
}

/**
 * Check shift creation rate limit
 */
export function checkShiftCreationRateLimit(userId: string): RateLimitResult {
    const key = `shift-create:${userId}`;
    return checkRateLimit(key, RATE_LIMIT_CONFIG.shiftCreationPerMinute, 60);
}

/**
 * Check API call rate limit
 */
export function checkApiRateLimit(userId: string): RateLimitResult {
    const key = `api:${userId}`;
    return checkRateLimit(key, RATE_LIMIT_CONFIG.apiCallsPerMinute, 60);
}

/**
 * Distributed rate limiter using DynamoDB
 * Use this for critical operations that need cross-Lambda coordination
 */
export async function checkDistributedRateLimit(
    ddb: DynamoDBDocumentClient,
    tableName: string,
    key: string,
    limit: number,
    windowSeconds: number
): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const pk = `RATE_LIMIT#${key}`;
    const sk = String(windowStart);

    try {
        // Try to increment the counter
        const result = await ddb.send(new UpdateCommand({
            TableName: tableName,
            Key: { pk, sk },
            UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc, #ttl = :ttl',
            ExpressionAttributeNames: {
                '#count': 'count',
                '#ttl': 'ttl',
            },
            ExpressionAttributeValues: {
                ':zero': 0,
                ':inc': 1,
                ':ttl': windowStart + windowSeconds + 60, // TTL with buffer
            },
            ReturnValues: 'ALL_NEW',
        }));

        const count = (result.Attributes?.count as number) || 1;
        const resetIn = windowStart + windowSeconds - now;

        if (count > limit) {
            return {
                allowed: false,
                remaining: 0,
                resetIn,
                message: `Rate limit exceeded. Try again in ${resetIn} seconds.`,
            };
        }

        return {
            allowed: true,
            remaining: limit - count,
            resetIn,
        };
    } catch (error) {
        console.error('Rate limit check failed:', error);
        // Fail open - allow the request if rate limiting fails
        return {
            allowed: true,
            remaining: limit,
            resetIn: windowSeconds,
        };
    }
}

/**
 * Clear rate limit cache (useful for testing)
 */
export function clearRateLimitCache(): void {
    rateLimitCache.clear();
}

/**
 * Get current rate limit status for a key (useful for debugging)
 */
export function getRateLimitStatus(key: string): { count: number; windowStart: number } | null {
    return rateLimitCache.get(key) || null;
}

export default {
    checkRateLimit,
    checkAdvancePayRateLimit,
    checkShiftCreationRateLimit,
    checkApiRateLimit,
    checkDistributedRateLimit,
    clearRateLimitCache,
    getRateLimitStatus,
};

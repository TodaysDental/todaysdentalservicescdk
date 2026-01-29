/**
 * Smart Retry Module
 * 
 * Implements intelligent retry logic with exponential backoff and circuit breaker
 * patterns for resilient call routing.
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Circuit breaker to prevent cascade failures
 * - Retry classification (retryable vs permanent failures)
 * - Configurable retry policies per operation type
 * 
 * @module smart-retry
 */

import { publishMetric, MetricName } from './cloudwatch-metrics';

export interface RetryConfig {
    /** Maximum retry attempts */
    maxRetries: number;
    /** Base delay between retries (ms) */
    baseDelayMs: number;
    /** Maximum delay between retries (ms) */
    maxDelayMs: number;
    /** Jitter factor (0-1) to randomize delays */
    jitterFactor: number;
    /** Whether to use exponential backoff */
    exponentialBackoff: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: parseInt(process.env.CHIME_RETRY_MAX_ATTEMPTS || '3', 10),
    baseDelayMs: parseInt(process.env.CHIME_RETRY_BASE_DELAY_MS || '200', 10),
    maxDelayMs: parseInt(process.env.CHIME_RETRY_MAX_DELAY_MS || '5000', 10),
    jitterFactor: 0.3,
    exponentialBackoff: true,
};

/**
 * Error classification for retry decisions
 */
export enum ErrorType {
    TRANSIENT = 'TRANSIENT',           // Network issues, timeouts - should retry
    THROTTLED = 'THROTTLED',           // Rate limited - should retry with backoff
    RESOURCE_BUSY = 'RESOURCE_BUSY',   // Agent busy - should try different agent
    PERMANENT = 'PERMANENT',           // Invalid data - should not retry
    CIRCUIT_OPEN = 'CIRCUIT_OPEN',     // Circuit breaker - should fail fast
}

export interface RetryableError extends Error {
    errorType: ErrorType;
    retryable: boolean;
    retryAfterMs?: number;
}

/**
 * Classifies an error for retry decisions
 */
export function classifyError(error: any): ErrorType {
    const errorName = error.name || '';
    const errorCode = error.code || '';
    const message = error.message || '';

    // DynamoDB throttling
    if (
        errorName === 'ProvisionedThroughputExceededException' ||
        errorName === 'ThrottlingException' ||
        errorCode === 'ThrottlingException'
    ) {
        return ErrorType.THROTTLED;
    }

    // Transient network errors
    if (
        errorName === 'TimeoutError' ||
        errorName === 'NetworkingError' ||
        errorCode === 'ECONNRESET' ||
        errorCode === 'ETIMEDOUT' ||
        errorCode === 'ENOTFOUND' ||
        message.includes('socket hang up') ||
        message.includes('Connection reset')
    ) {
        return ErrorType.TRANSIENT;
    }

    // Resource busy (conditional check failures typically mean resource changed)
    if (
        errorName === 'ConditionalCheckFailedException' ||
        errorName === 'TransactionCanceledException'
    ) {
        return ErrorType.RESOURCE_BUSY;
    }

    // Permanent errors
    if (
        errorName === 'ValidationException' ||
        errorName === 'ResourceNotFoundException' ||
        errorCode === 'INVALID_PARAMETER'
    ) {
        return ErrorType.PERMANENT;
    }

    // Default to transient for unknown errors
    return ErrorType.TRANSIENT;
}

/**
 * Checks if an error is retryable
 */
export function isRetryable(error: any): boolean {
    const errorType = classifyError(error);
    return errorType !== ErrorType.PERMANENT && errorType !== ErrorType.CIRCUIT_OPEN;
}

/**
 * Calculates the delay before the next retry attempt
 */
export function calculateRetryDelay(
    attempt: number,
    config: Partial<RetryConfig> = {}
): number {
    const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

    let delay: number;

    if (fullConfig.exponentialBackoff) {
        // Exponential backoff: baseDelay * 2^attempt
        delay = fullConfig.baseDelayMs * Math.pow(2, attempt);
    } else {
        // Linear backoff
        delay = fullConfig.baseDelayMs * (attempt + 1);
    }

    // Apply jitter to prevent thundering herd
    if (fullConfig.jitterFactor > 0) {
        const jitter = delay * fullConfig.jitterFactor * Math.random();
        delay = delay + jitter - (jitter / 2); // +/- jitter/2
    }

    // Cap at max delay
    return Math.min(delay, fullConfig.maxDelayMs);
}

/**
 * Executes an operation with retry logic
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    config: Partial<RetryConfig> = {},
    context: Record<string, string> = {}
): Promise<T> {
    const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

    let lastError: any;

    for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
        try {
            const result = await operation();

            // Log success after retries
            if (attempt > 0) {
                console.log(`[withRetry] ${operationName} succeeded after ${attempt} retries`, context);
                await publishMetric(MetricName.RETRY_COUNT, attempt, {
                    operation: operationName,
                    success: 'true',
                    ...context,
                });
            }

            return result;

        } catch (error: any) {
            lastError = error;
            const errorType = classifyError(error);

            console.warn(`[withRetry] ${operationName} attempt ${attempt + 1} failed`, {
                errorType,
                errorMessage: error.message,
                ...context,
            });

            // Don't retry permanent errors or if circuit is open
            if (!isRetryable(error)) {
                console.error(`[withRetry] ${operationName} failed with non-retryable error`, {
                    errorType,
                    ...context,
                });
                throw error;
            }

            // Don't retry if we've exhausted attempts
            if (attempt >= fullConfig.maxRetries) {
                console.error(`[withRetry] ${operationName} failed after ${fullConfig.maxRetries} retries`, context);
                await publishMetric(MetricName.RETRY_COUNT, attempt, {
                    operation: operationName,
                    success: 'false',
                    ...context,
                });
                break;
            }

            // Calculate and wait for delay
            const delay = calculateRetryDelay(attempt, config);
            console.log(`[withRetry] Waiting ${delay}ms before retry ${attempt + 2}`);
            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * Circuit Breaker implementation
 */
export interface CircuitBreakerConfig {
    /** Number of failures before opening circuit */
    failureThreshold: number;
    /** Time in ms before attempting to close circuit */
    resetTimeoutMs: number;
    /** Number of successes needed to fully close circuit */
    successThreshold: number;
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: parseInt(process.env.CHIME_CIRCUIT_FAILURE_THRESHOLD || '5', 10),
    resetTimeoutMs: parseInt(process.env.CHIME_CIRCUIT_RESET_TIMEOUT_MS || '30000', 10),
    successThreshold: parseInt(process.env.CHIME_CIRCUIT_SUCCESS_THRESHOLD || '3', 10),
};

enum CircuitState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerState {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
    lastStateChange: number;
}

// In-memory circuit breaker states per resource
const circuitBreakers: Map<string, CircuitBreakerState> = new Map();

/**
 * Gets or creates a circuit breaker for a resource
 */
function getCircuitBreaker(resourceId: string): CircuitBreakerState {
    let breaker = circuitBreakers.get(resourceId);

    if (!breaker) {
        breaker = {
            state: CircuitState.CLOSED,
            failures: 0,
            successes: 0,
            lastFailureTime: 0,
            lastStateChange: Date.now(),
        };
        circuitBreakers.set(resourceId, breaker);
    }

    return breaker;
}

/**
 * Checks if circuit is open (failing fast)
 */
export function isCircuitOpen(
    resourceId: string,
    config: Partial<CircuitBreakerConfig> = {}
): boolean {
    const fullConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    const breaker = getCircuitBreaker(resourceId);

    if (breaker.state === CircuitState.OPEN) {
        // Check if we should try half-open
        const timeSinceLastFailure = Date.now() - breaker.lastFailureTime;
        if (timeSinceLastFailure >= fullConfig.resetTimeoutMs) {
            breaker.state = CircuitState.HALF_OPEN;
            breaker.successes = 0;
            breaker.lastStateChange = Date.now();
            console.log(`[CircuitBreaker] ${resourceId} transitioning to HALF_OPEN`);
            return false;
        }
        return true;
    }

    return false;
}

/**
 * Records a failure for circuit breaker
 */
export function recordFailure(
    resourceId: string,
    config: Partial<CircuitBreakerConfig> = {}
): void {
    const fullConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    const breaker = getCircuitBreaker(resourceId);

    breaker.failures++;
    breaker.lastFailureTime = Date.now();
    breaker.successes = 0;

    if (breaker.state === CircuitState.HALF_OPEN) {
        // Any failure in half-open opens the circuit again
        breaker.state = CircuitState.OPEN;
        breaker.lastStateChange = Date.now();
        console.log(`[CircuitBreaker] ${resourceId} re-opened after half-open failure`);
    } else if (breaker.failures >= fullConfig.failureThreshold) {
        breaker.state = CircuitState.OPEN;
        breaker.lastStateChange = Date.now();
        console.log(`[CircuitBreaker] ${resourceId} opened after ${breaker.failures} failures`);
    }
}

/**
 * Records a success for circuit breaker
 */
export function recordSuccess(
    resourceId: string,
    config: Partial<CircuitBreakerConfig> = {}
): void {
    const fullConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    const breaker = getCircuitBreaker(resourceId);

    breaker.successes++;

    if (breaker.state === CircuitState.HALF_OPEN) {
        if (breaker.successes >= fullConfig.successThreshold) {
            breaker.state = CircuitState.CLOSED;
            breaker.failures = 0;
            breaker.lastStateChange = Date.now();
            console.log(`[CircuitBreaker] ${resourceId} closed after ${breaker.successes} successes`);
        }
    } else if (breaker.state === CircuitState.CLOSED) {
        // Reset failures on success
        breaker.failures = Math.max(0, breaker.failures - 1);
    }
}

/**
 * Executes an operation with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
    operation: () => Promise<T>,
    resourceId: string,
    config: Partial<CircuitBreakerConfig> = {}
): Promise<T> {
    if (isCircuitOpen(resourceId, config)) {
        const error = new Error(`Circuit breaker open for ${resourceId}`);
        (error as RetryableError).errorType = ErrorType.CIRCUIT_OPEN;
        (error as RetryableError).retryable = false;
        throw error;
    }

    try {
        const result = await operation();
        recordSuccess(resourceId, config);
        return result;
    } catch (error) {
        recordFailure(resourceId, config);
        throw error;
    }
}

/**
 * Combined retry with circuit breaker
 */
export async function withRetryAndCircuitBreaker<T>(
    operation: () => Promise<T>,
    operationName: string,
    resourceId: string,
    retryConfig: Partial<RetryConfig> = {},
    circuitConfig: Partial<CircuitBreakerConfig> = {},
    context: Record<string, string> = {}
): Promise<T> {
    return withRetry(
        () => withCircuitBreaker(operation, resourceId, circuitConfig),
        operationName,
        retryConfig,
        context
    );
}

/**
 * Gets circuit breaker status for monitoring
 */
export function getCircuitBreakerStatus(resourceId: string): {
    state: string;
    failures: number;
    successes: number;
    timeSinceLastFailure: number;
} {
    const breaker = getCircuitBreaker(resourceId);

    return {
        state: breaker.state,
        failures: breaker.failures,
        successes: breaker.successes,
        timeSinceLastFailure: breaker.lastFailureTime > 0
            ? Date.now() - breaker.lastFailureTime
            : -1,
    };
}

/**
 * Resets a circuit breaker (for admin/testing purposes)
 */
export function resetCircuitBreaker(resourceId: string): void {
    circuitBreakers.delete(resourceId);
    console.log(`[CircuitBreaker] ${resourceId} reset`);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * FIX #38: Centralized Retry Configuration
 * 
 * Provides consistent retry behavior across all operations
 * using configuration from CHIME_CONFIG.
 */

import { CHIME_CONFIG } from '../../chime/config';

/**
 * Execute an operation with exponential backoff retry
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts?: number,
  baseDelay?: number
): Promise<T> {
  const attempts = maxAttempts || CHIME_CONFIG.RETRY.MAX_ATTEMPTS;
  const delayMs = baseDelay || CHIME_CONFIG.RETRY.BASE_DELAY_MS;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = attempt === attempts - 1;

      if (isLastAttempt) {
        console.error(`[retry] ${operationName} failed after ${attempts} attempts`);
        throw err;
      }

      // Check if error is retryable
      if (!isRetryableError(err)) {
        console.error(`[retry] ${operationName} failed with non-retryable error: ${err.name}`);
        throw err;
      }

      // Exponential backoff with jitter
      const delay = delayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * delay;
      const totalDelay = delay + jitter;

      console.warn(`[retry] ${operationName} attempt ${attempt + 1} failed, ` +
                   `retrying in ${Math.round(totalDelay)}ms: ${err.message}`);

      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }

  throw new Error('Should not reach here');
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(err: any): boolean {
  const retryableErrors = [
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'ServiceUnavailableException',
    'InternalServerError',
    'RequestTimeout',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND'
  ];

  return retryableErrors.includes(err.name) || 
         retryableErrors.includes(err.code) ||
         (err.statusCode >= 500 && err.statusCode < 600);
}

/**
 * Retry with custom configuration
 */
export async function retryWithConfig<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: {
    maxAttempts?: number;
    baseDelayMs?: number;
    shouldRetry?: (err: any) => boolean;
  }
): Promise<T> {
  const maxAttempts = config.maxAttempts || CHIME_CONFIG.RETRY.MAX_ATTEMPTS;
  const baseDelay = config.baseDelayMs || CHIME_CONFIG.RETRY.BASE_DELAY_MS;
  const shouldRetry = config.shouldRetry || isRetryableError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = attempt === maxAttempts - 1;

      if (isLastAttempt || !shouldRetry(err)) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * delay;
      const totalDelay = delay + jitter;

      console.warn(`[retry] ${operationName} attempt ${attempt + 1}/${maxAttempts} failed, ` +
                   `retrying in ${Math.round(totalDelay)}ms: ${err.message}`);

      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }

  throw new Error('Retry exhausted');
}


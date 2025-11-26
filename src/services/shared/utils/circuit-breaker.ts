/**
 * Simple Circuit Breaker Pattern Implementation
 * Prevents cascading failures by stopping requests to failing services
 */

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Blocking requests (service is down)
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Number of successes in HALF_OPEN before closing
  timeout: number;               // Milliseconds to wait before trying HALF_OPEN
  name: string;                  // Circuit name for logging
  monitoringPeriod?: number;     // Optional: period for monitoring failures (not implemented yet)
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttempt: number = Date.now();
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new Error(`Circuit breaker [${this.config.name}] is OPEN. Service unavailable.`);
      }
      // Timeout expired, try HALF_OPEN
      this.state = CircuitState.HALF_OPEN;
      console.log(`[CircuitBreaker] ${this.config.name} transitioning to HALF_OPEN`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if circuit allows requests
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN && Date.now() < this.nextAttempt;
  }

  /**
   * Get current state for monitoring
   */
  getState(): { state: CircuitState; failures: number; successes: number } {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount
    };
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        console.log(`[CircuitBreaker] ${this.config.name} CLOSED (service recovered)`);
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.timeout;
      console.error(`[CircuitBreaker] ${this.config.name} OPEN (threshold ${this.config.failureThreshold} failures reached)`);
    }
  }

  /**
   * Manually reset circuit (for testing or manual intervention)
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    console.log(`[CircuitBreaker] ${this.config.name} manually reset to CLOSED`);
  }
}

/**
 * Circuit breaker for DynamoDB operations
 */
export const dynamoDBCircuitBreaker = new CircuitBreaker({
  name: 'DynamoDB-AgentPerformance',
  failureThreshold: 5,           // Open after 5 failures
  successThreshold: 2,           // Close after 2 successes
  timeout: 60000                 // Wait 1 minute before retry
});

/**
 * Circuit breaker for SNS operations
 */
export const snsCircuitBreaker = new CircuitBreaker({
  name: 'SNS-Alerts',
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 30000
});

/**
 * Circuit breaker registry for dynamic creation
 */
const circuitBreakerRegistry = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker instance
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  if (!circuitBreakerRegistry.has(name)) {
    const defaultConfig: CircuitBreakerConfig = {
      name,
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000,
      ...config
    };
    circuitBreakerRegistry.set(name, new CircuitBreaker(defaultConfig));
  }
  return circuitBreakerRegistry.get(name)!;
}
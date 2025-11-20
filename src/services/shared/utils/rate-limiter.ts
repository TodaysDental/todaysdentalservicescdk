export interface RateLimiterConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  refillInterval: number; // ms
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private refillTimer: NodeJS.Timeout | null = null;

  constructor(private config: RateLimiterConfig) {
    this.tokens = config.maxTokens;
    this.lastRefillTime = Date.now();
    this.startRefill();
  }

  private startRefill() {
    this.refillTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastRefillTime;
      const tokensToAdd = (elapsed / 1000) * this.config.refillRate;
      
      this.tokens = Math.min(this.config.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }, this.config.refillInterval);
  }

  public async acquire(tokens: number = 1): Promise<boolean> {
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  public async waitForToken(tokens: number = 1, maxWaitMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      if (await this.acquire(tokens)) {
        return true;
      }
      
      // Wait for next refill cycle
      await new Promise(resolve => setTimeout(resolve, this.config.refillInterval));
    }
    
    return false;
  }

  public getAvailableTokens(): number {
    return Math.floor(this.tokens);
  }

  public destroy() {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
    }
  }
}

// Chime SDK specific rate limiters
class ChimeSDKRateLimiters {
  private static instance: ChimeSDKRateLimiters;
  
  // AWS Chime SDK limits (conservative values)
  public readonly meetings = new TokenBucketRateLimiter({
    maxTokens: 10,
    refillRate: 5, // 5 per second
    refillInterval: 200 // refill every 200ms
  });

  public readonly attendees = new TokenBucketRateLimiter({
    maxTokens: 20,
    refillRate: 10,
    refillInterval: 200
  });

  public readonly smaUpdates = new TokenBucketRateLimiter({
    maxTokens: 50,
    refillRate: 25,
    refillInterval: 200
  });

  public readonly smaCalls = new TokenBucketRateLimiter({
    maxTokens: 10,
    refillRate: 5,
    refillInterval: 200
  });

  private constructor() {
    console.log('[ChimeSDKRateLimiters] Initialized rate limiters');
  }

  public static getInstance(): ChimeSDKRateLimiters {
    if (!ChimeSDKRateLimiters.instance) {
      ChimeSDKRateLimiters.instance = new ChimeSDKRateLimiters();
    }
    return ChimeSDKRateLimiters.instance;
  }

  public getMetrics() {
    return {
      meetings: this.meetings.getAvailableTokens(),
      attendees: this.attendees.getAvailableTokens(),
      smaUpdates: this.smaUpdates.getAvailableTokens(),
      smaCalls: this.smaCalls.getAvailableTokens()
    };
  }
}

export function getChimeRateLimiters(): ChimeSDKRateLimiters {
  return ChimeSDKRateLimiters.getInstance();
}

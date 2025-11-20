import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Agent } from 'https';

interface DynamoDBConfig {
  maxRetries?: number;
  requestTimeout?: number;
  connectionTimeout?: number;
  maxSockets?: number;
}

class DynamoDBManager {
  private static instance: DynamoDBManager;
  private client: DynamoDBClient;
  private documentClient: DynamoDBDocumentClient;
  private requestCount: number = 0;
  private lastResetTime: number = Date.now();

  private constructor(config: DynamoDBConfig = {}) {
    const clientConfig: DynamoDBClientConfig = {
      maxAttempts: config.maxRetries || 3,
      requestHandler: {
        requestTimeout: config.requestTimeout || 3000,
        connectionTimeout: config.connectionTimeout || 1000,
        httpsAgent: new Agent({
          maxSockets: config.maxSockets || 50,
          keepAlive: true,
          keepAliveMsecs: 1000,
        }),
      } as any,
    };

    this.client = new DynamoDBClient(clientConfig);

    // Create document client with marshalling options
    this.documentClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });

    console.log('[DynamoDBManager] Initialized with connection pooling');
  }

  public static getInstance(config?: DynamoDBConfig): DynamoDBManager {
    if (!DynamoDBManager.instance) {
      DynamoDBManager.instance = new DynamoDBManager(config);
    }
    return DynamoDBManager.instance;
  }

  public getDocumentClient(): DynamoDBDocumentClient {
    this.requestCount++;
    
    // Log metrics every 1000 requests
    if (this.requestCount % 1000 === 0) {
      const elapsed = Date.now() - this.lastResetTime;
      const rps = (1000 / elapsed) * 1000; // requests per second
      console.log(`[DynamoDBManager] Metrics: ${this.requestCount} requests, ~${rps.toFixed(2)} req/sec`);
    }

    return this.documentClient;
  }

  public getMetrics() {
    const elapsed = Date.now() - this.lastResetTime;
    return {
      requestCount: this.requestCount,
      elapsedMs: elapsed,
      requestsPerSecond: (this.requestCount / elapsed) * 1000
    };
  }

  public resetMetrics() {
    this.requestCount = 0;
    this.lastResetTime = Date.now();
  }
}

export function getDynamoDBClient(config?: DynamoDBConfig) {
  return DynamoDBManager.getInstance(config).getDocumentClient();
}

export function getDynamoDBMetrics() {
  return DynamoDBManager.getInstance().getMetrics();
}

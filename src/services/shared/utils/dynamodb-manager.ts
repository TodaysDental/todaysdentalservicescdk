/**
 * FIX #43: Connection Pool Per Container
 * Enhanced DynamoDB manager with connection warming and optimized pooling
 */
import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
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
  private warmed: boolean = false;

  private constructor(config: DynamoDBConfig = {}) {
    // Optimize connection pool for Lambda
    const httpsAgent = new Agent({
      maxSockets: config.maxSockets || 50,
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxFreeSockets: 10, // Keep some connections ready
      timeout: 60000,
      scheduling: 'lifo' as any // Reuse recent connections first
    });

    const clientConfig: DynamoDBClientConfig = {
      maxAttempts: config.maxRetries || 3,
      requestHandler: {
        requestTimeout: config.requestTimeout || 3000,
        connectionTimeout: config.connectionTimeout || 1000,
        httpsAgent
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

    console.log('[DynamoDBManager] Initialized with optimized connection pooling');

    // Warm connections on first use (async, non-blocking)
    this.warmConnections();
  }

  /**
   * Warm DynamoDB connections on Lambda cold start
   * Makes a lightweight query to establish connection pool
   */
  private async warmConnections(): Promise<void> {
    if (this.warmed) return;

    try {
      // Make a lightweight query to establish connection
      // Use a dummy key that doesn't exist to minimize overhead
      await this.documentClient.send(new GetCommand({
        TableName: process.env.AGENT_PRESENCE_TABLE_NAME || 'warmup-dummy',
        Key: { agentId: '__warmup__' }
      })).catch(() => {}); // Ignore errors - warmup is best-effort

      this.warmed = true;
      console.log('[DynamoDBManager] Connections warmed successfully');
    } catch (err) {
      console.warn('[DynamoDBManager] Connection warming failed (non-fatal):', err);
      // Don't throw - warmup failure is not critical
    }
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

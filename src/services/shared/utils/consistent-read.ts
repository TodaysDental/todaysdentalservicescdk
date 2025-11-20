/**
 * FIX #45: Eventual Consistency Reads
 * 
 * Provides utilities for consistent reads with retry logic
 * for critical operations that require strong consistency.
 */

import { DynamoDBDocumentClient, GetCommand, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';

export interface ReadOptions {
  consistentRead?: boolean;
  retryOnNotFound?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Get a single item with optional strong consistency and retry logic
 */
export async function getItemWithConsistency<T>(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, any>,
  options: ReadOptions = {}
): Promise<T | null> {
  const {
    consistentRead = true, // Default to strong consistency for safety
    retryOnNotFound = false,
    maxRetries = 3,
    retryDelayMs = 100
  } = options;

  let attempt = 0;

  while (attempt < maxRetries) {
    const { Item } = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: key,
      ConsistentRead: consistentRead
    }));

    if (Item) {
      return Item as T;
    }

    if (!retryOnNotFound || attempt === maxRetries - 1) {
      return null;
    }

    // Wait before retry (exponential backoff)
    const delay = retryDelayMs * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
    attempt++;
  }

  return null;
}

/**
 * Query with optional strong consistency
 * Note: GSI queries cannot use strong consistency
 */
export async function queryWithConsistency<T>(
  ddb: DynamoDBDocumentClient,
  params: QueryCommandInput,
  options: ReadOptions = {}
): Promise<T[]> {
  const { consistentRead = false } = options; // Default to eventual for queries

  // Warn if trying to use consistent read with an index
  if (consistentRead && params.IndexName) {
    console.warn(
      `[ConsistentRead] Cannot use ConsistentRead with GSI query on index: ${params.IndexName}. ` +
      'Falling back to eventual consistency.'
    );
  }

  const result = await ddb.send(new QueryCommand({
    ...params,
    ConsistentRead: consistentRead && !params.IndexName
  }));

  return (result.Items || []) as T[];
}

/**
 * Get an item and verify it matches expected conditions
 * Retries with exponential backoff if conditions not met
 */
export async function getItemWithCondition<T>(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, any>,
  condition: (item: T) => boolean,
  options: ReadOptions = {}
): Promise<T | null> {
  const {
    consistentRead = true,
    maxRetries = 3,
    retryDelayMs = 100
  } = options;

  let attempt = 0;

  while (attempt < maxRetries) {
    const { Item } = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: key,
      ConsistentRead: consistentRead
    }));

    if (!Item) {
      return null;
    }

    const typedItem = Item as T;
    if (condition(typedItem)) {
      return typedItem;
    }

    // Condition not met, retry
    if (attempt < maxRetries - 1) {
      const delay = retryDelayMs * Math.pow(2, attempt);
      console.log(`[ConsistentRead] Condition not met, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    attempt++;
  }

  // Return the item even if condition failed after all retries
  // Let caller decide how to handle
  const { Item } = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: key,
    ConsistentRead: consistentRead
  }));

  return Item ? (Item as T) : null;
}

/**
 * Batch get items with consistency options
 */
export async function batchGetWithConsistency<T>(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, any>[],
  consistentRead: boolean = true
): Promise<T[]> {
  if (keys.length === 0) {
    return [];
  }

  // DynamoDB BatchGet limit is 100 items
  const batches: Record<string, any>[][] = [];
  for (let i = 0; i < keys.length; i += 100) {
    batches.push(keys.slice(i, i + 100));
  }

  const allItems: T[] = [];

  for (const batch of batches) {
    const { Responses } = await ddb.send({
      RequestItems: {
        [tableName]: {
          Keys: batch,
          ConsistentRead: consistentRead
        }
      }
    } as any);

    if (Responses && Responses[tableName]) {
      allItems.push(...(Responses[tableName] as T[]));
    }
  }

  return allItems;
}

/**
 * Read-after-write helper: ensures a write is visible before proceeding
 * Useful after critical writes where immediate read consistency is required
 */
export async function verifyWrite<T>(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, any>,
  expectedValue: Partial<T>,
  maxRetries: number = 5
): Promise<boolean> {
  let attempt = 0;

  while (attempt < maxRetries) {
    const { Item } = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: key,
      ConsistentRead: true
    }));

    if (Item) {
      // Check if all expected values match
      const matches = Object.entries(expectedValue).every(([key, value]) => {
        return (Item as any)[key] === value;
      });

      if (matches) {
        return true;
      }
    }

    // Wait before retry
    const delay = 50 * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
    attempt++;
  }

  return false;
}

/**
 * Helper to enforce consistent reads in critical code paths
 */
export function createConsistentReader(ddb: DynamoDBDocumentClient) {
  return {
    getItem: <T>(tableName: string, key: Record<string, any>, options?: ReadOptions) =>
      getItemWithConsistency<T>(ddb, tableName, key, { ...options, consistentRead: true }),

    getItemEventual: <T>(tableName: string, key: Record<string, any>, options?: ReadOptions) =>
      getItemWithConsistency<T>(ddb, tableName, key, { ...options, consistentRead: false }),

    query: <T>(params: QueryCommandInput, options?: ReadOptions) =>
      queryWithConsistency<T>(ddb, params, options),

    batchGet: <T>(tableName: string, keys: Record<string, any>[]) =>
      batchGetWithConsistency<T>(ddb, tableName, keys, true),

    verifyWrite: <T>(tableName: string, key: Record<string, any>, expectedValue: Partial<T>) =>
      verifyWrite<T>(ddb, tableName, key, expectedValue)
  };
}


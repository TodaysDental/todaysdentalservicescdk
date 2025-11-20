/**
 * FIX #40: Query Without Limits
 * 
 * Provides universal pagination for DynamoDB queries to prevent timeouts
 * and ensure consistent result retrieval across large datasets.
 */

import { DynamoDBDocumentClient, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';

export interface PaginationOptions {
  maxPages?: number;
  defaultLimit?: number;
}

/**
 * Generator function for paginated DynamoDB queries
 * Automatically handles LastEvaluatedKey and enforces safe limits
 */
export async function* paginatedQuery<T>(
  ddb: DynamoDBDocumentClient,
  params: QueryCommandInput,
  options: PaginationOptions = {}
): AsyncGenerator<T[], void, unknown> {
  const maxPages = options.maxPages || 50;
  const defaultLimit = options.defaultLimit || 100;
  
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;
  let pageCount = 0;
  
  do {
    const queryParams: QueryCommandInput = {
      ...params,
      Limit: params.Limit || defaultLimit,
      ExclusiveStartKey: lastEvaluatedKey
    };
    
    const result = await ddb.send(new QueryCommand(queryParams));
    
    if (result.Items && result.Items.length > 0) {
      yield result.Items as T[];
    }
    
    lastEvaluatedKey = result.LastEvaluatedKey;
    pageCount++;
    
    if (pageCount >= maxPages) {
      console.warn(`[paginatedQuery] Hit max pages limit (${maxPages}) for table ${params.TableName}`);
      break;
    }
    
  } while (lastEvaluatedKey);
}

/**
 * Collects all results from a paginated query into a single array
 * Use with caution on large datasets - prefer streaming with the generator
 */
export async function collectPaginatedResults<T>(
  ddb: DynamoDBDocumentClient,
  params: QueryCommandInput,
  options: PaginationOptions & { maxItems?: number } = {}
): Promise<{ items: T[]; truncated: boolean }> {
  const maxItems = options.maxItems || 1000;
  const allItems: T[] = [];
  let truncated = false;
  
  for await (const page of paginatedQuery<T>(ddb, params, options)) {
    allItems.push(...page);
    
    if (allItems.length >= maxItems) {
      truncated = true;
      break;
    }
  }
  
  return {
    items: allItems.slice(0, maxItems),
    truncated: truncated || allItems.length >= maxItems
  };
}

/**
 * Simple wrapper for queries that need basic pagination support
 */
export async function queryWithPagination<T>(
  ddb: DynamoDBDocumentClient,
  params: QueryCommandInput,
  limit: number = 100
): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, any> }> {
  const result = await ddb.send(new QueryCommand({
    ...params,
    Limit: Math.min(limit, 1000) // DynamoDB max
  }));
  
  return {
    items: (result.Items || []) as T[],
    lastEvaluatedKey: result.LastEvaluatedKey
  };
}


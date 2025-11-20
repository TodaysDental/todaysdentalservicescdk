/**
 * FIX #44: No Transaction on Multi-Table Updates
 * 
 * Provides a fluent API for building and executing DynamoDB transactions
 * with automatic handling of conditions, attribute names, and reserved keywords.
 */

import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

// Common DynamoDB reserved keywords
const RESERVED_KEYWORDS = new Set([
  'status', 'ttl', 'name', 'data', 'timestamp', 'type', 'value', 'key',
  'size', 'time', 'order', 'count', 'date', 'range', 'start', 'end',
  'connection', 'state', 'comment', 'percent', 'year', 'month', 'day'
]);

export interface UpdateOperations {
  set?: Record<string, any>;
  remove?: string[];
  add?: Record<string, number>;
  delete?: Record<string, Set<any>>;
}

export class TransactionBuilder {
  private items: any[] = [];

  /**
   * Add an Update operation to the transaction
   */
  addUpdate(
    tableName: string,
    key: Record<string, any>,
    updates: UpdateOperations,
    condition?: string,
    conditionValues?: Record<string, any>
  ): this {
    const expressionParts: string[] = [];
    const expressionValues: Record<string, any> = { ...conditionValues };
    const expressionNames: Record<string, string> = {};
    let nameCounter = 0;
    let valueCounter = 0;

    // Build SET clause
    if (updates.set && Object.keys(updates.set).length > 0) {
      const setParts = Object.entries(updates.set).map(([key, value]) => {
        const valueKey = `:set${valueCounter++}`;
        expressionValues[valueKey] = value;

        if (RESERVED_KEYWORDS.has(key.toLowerCase())) {
          const nameKey = `#n${nameCounter++}`;
          expressionNames[nameKey] = key;
          return `${nameKey} = ${valueKey}`;
        }
        return `${key} = ${valueKey}`;
      });
      expressionParts.push('SET ' + setParts.join(', '));
    }

    // Build REMOVE clause
    if (updates.remove && updates.remove.length > 0) {
      const removeParts = updates.remove.map(key => {
        if (RESERVED_KEYWORDS.has(key.toLowerCase())) {
          const nameKey = `#n${nameCounter++}`;
          expressionNames[nameKey] = key;
          return nameKey;
        }
        return key;
      });
      expressionParts.push('REMOVE ' + removeParts.join(', '));
    }

    // Build ADD clause
    if (updates.add && Object.keys(updates.add).length > 0) {
      const addParts = Object.entries(updates.add).map(([key, value]) => {
        const valueKey = `:add${valueCounter++}`;
        expressionValues[valueKey] = value;
        
        if (RESERVED_KEYWORDS.has(key.toLowerCase())) {
          const nameKey = `#n${nameCounter++}`;
          expressionNames[nameKey] = key;
          return `${nameKey} ${valueKey}`;
        }
        return `${key} ${valueKey}`;
      });
      expressionParts.push('ADD ' + addParts.join(', '));
    }

    // Build DELETE clause (for sets)
    if (updates.delete && Object.keys(updates.delete).length > 0) {
      const deleteParts = Object.entries(updates.delete).map(([key, value]) => {
        const valueKey = `:del${valueCounter++}`;
        expressionValues[valueKey] = value;
        
        if (RESERVED_KEYWORDS.has(key.toLowerCase())) {
          const nameKey = `#n${nameCounter++}`;
          expressionNames[nameKey] = key;
          return `${nameKey} ${valueKey}`;
        }
        return `${key} ${valueKey}`;
      });
      expressionParts.push('DELETE ' + deleteParts.join(', '));
    }

    const item: any = {
      Update: {
        TableName: tableName,
        Key: key,
        UpdateExpression: expressionParts.join(' ')
      }
    };

    if (Object.keys(expressionValues).length > 0) {
      item.Update.ExpressionAttributeValues = expressionValues;
    }

    if (Object.keys(expressionNames).length > 0) {
      item.Update.ExpressionAttributeNames = expressionNames;
    }

    if (condition) {
      item.Update.ConditionExpression = condition;
    }

    this.items.push(item);
    return this;
  }

  /**
   * Add a Put operation to the transaction
   */
  addPut(
    tableName: string,
    item: Record<string, any>,
    condition?: string,
    conditionValues?: Record<string, any>,
    conditionNames?: Record<string, string>
  ): this {
    const putItem: any = {
      Put: {
        TableName: tableName,
        Item: item
      }
    };

    if (condition) {
      putItem.Put.ConditionExpression = condition;
      if (conditionValues) {
        putItem.Put.ExpressionAttributeValues = conditionValues;
      }
      if (conditionNames) {
        putItem.Put.ExpressionAttributeNames = conditionNames;
      }
    }

    this.items.push(putItem);
    return this;
  }

  /**
   * Add a Delete operation to the transaction
   */
  addDelete(
    tableName: string,
    key: Record<string, any>,
    condition?: string,
    conditionValues?: Record<string, any>,
    conditionNames?: Record<string, string>
  ): this {
    const deleteItem: any = {
      Delete: {
        TableName: tableName,
        Key: key
      }
    };

    if (condition) {
      deleteItem.Delete.ConditionExpression = condition;
      if (conditionValues) {
        deleteItem.Delete.ExpressionAttributeValues = conditionValues;
      }
      if (conditionNames) {
        deleteItem.Delete.ExpressionAttributeNames = conditionNames;
      }
    }

    this.items.push(deleteItem);
    return this;
  }

  /**
   * Add a ConditionCheck operation to the transaction
   */
  addConditionCheck(
    tableName: string,
    key: Record<string, any>,
    condition: string,
    conditionValues?: Record<string, any>,
    conditionNames?: Record<string, string>
  ): this {
    const checkItem: any = {
      ConditionCheck: {
        TableName: tableName,
        Key: key,
        ConditionExpression: condition
      }
    };

    if (conditionValues) {
      checkItem.ConditionCheck.ExpressionAttributeValues = conditionValues;
    }

    if (conditionNames) {
      checkItem.ConditionCheck.ExpressionAttributeNames = conditionNames;
    }

    this.items.push(checkItem);
    return this;
  }

  /**
   * Execute the transaction
   */
  async execute(ddb: DynamoDBDocumentClient): Promise<void> {
    if (this.items.length === 0) {
      throw new Error('[TransactionBuilder] Transaction has no items');
    }

    if (this.items.length > 25) {
      throw new Error('[TransactionBuilder] Transaction cannot have more than 25 items (DynamoDB limit)');
    }

    console.log(`[TransactionBuilder] Executing transaction with ${this.items.length} items`);

    await ddb.send(new TransactWriteCommand({
      TransactItems: this.items
    }));
  }

  /**
   * Get the number of items in the transaction
   */
  getItemCount(): number {
    return this.items.length;
  }

  /**
   * Get the transaction items (for debugging)
   */
  getItems(): any[] {
    return [...this.items];
  }

  /**
   * Clear all items from the transaction
   */
  clear(): void {
    this.items = [];
  }
}

/**
 * Helper function to create a new transaction builder
 */
export function createTransaction(): TransactionBuilder {
  return new TransactionBuilder();
}


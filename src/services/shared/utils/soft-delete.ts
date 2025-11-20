/**
 * FIX #6: TTL Cleanup vs Active Operations
 * 
 * Implements soft delete mechanism to prevent TTL cleanup
 * from interfering with active operations.
 */

import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface SoftDeleteOptions {
  reason?: string;
  deletedBy?: string;
  deferHardDeleteSeconds?: number;
}

/**
 * FIX #6: Soft delete a record
 * Marks record as deleted without removing it immediately
 * Hard delete is deferred using TTL
 */
export async function softDelete(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, any>,
  options: SoftDeleteOptions = {}
): Promise<void> {
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  
  // Default to 24 hours deferred deletion
  const deferSeconds = options.deferHardDeleteSeconds || (24 * 60 * 60);
  const hardDeleteTTL = nowSeconds + deferSeconds;

  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: `
      SET isDeleted = :true,
          deletedAt = :now,
          deletedAtEpoch = :nowSeconds,
          deleteReason = :reason,
          #ttl = :ttl
    `,
    ExpressionAttributeNames: {
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':true': true,
      ':now': now.toISOString(),
      ':nowSeconds': nowSeconds,
      ':reason': options.reason || 'soft_delete',
      ':ttl': hardDeleteTTL
    }
  }));

  console.log(`[SoftDelete] Marked record as deleted, hard delete scheduled for ${new Date(hardDeleteTTL * 1000).toISOString()}`);
}

/**
 * FIX #6: Check if a record is soft-deleted
 */
export function isSoftDeleted(record: any): boolean {
  return record?.isDeleted === true;
}

/**
 * FIX #6: Restore a soft-deleted record
 */
export async function restoreSoftDeleted(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, any>,
  newTTL: number
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: `
      SET restoredAt = :now,
          #ttl = :ttl
      REMOVE isDeleted, deletedAt, deletedAtEpoch, deleteReason
    `,
    ConditionExpression: 'isDeleted = :true',
    ExpressionAttributeNames: {
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':true': true,
      ':now': new Date().toISOString(),
      ':ttl': newTTL
    }
  }));

  console.log('[SoftDelete] Record restored from soft delete');
}

/**
 * FIX #6: Query for soft-deleted records ready for hard deletion
 */
export async function querySoftDeletedRecords(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  indexName: string | undefined,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, any>
): Promise<any[]> {
  const now = Math.floor(Date.now() / 1000);

  const params: any = {
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    FilterExpression: 'isDeleted = :true AND deletedAtEpoch < :cutoff',
    ExpressionAttributeValues: {
      ...expressionAttributeValues,
      ':true': true,
      ':cutoff': now - (60 * 60) // Records deleted more than 1 hour ago
    }
  };

  if (indexName) {
    params.IndexName = indexName;
  }

  const result = await ddb.send(new QueryCommand(params));
  return result.Items || [];
}

/**
 * FIX #6: Add filter expression to exclude soft-deleted records from queries
 */
export function buildSoftDeleteFilter(existingFilter?: string): {
  filterExpression: string;
  attributeValues: Record<string, any>;
} {
  const softDeleteFilter = '(attribute_not_exists(isDeleted) OR isDeleted = :false)';
  
  return {
    filterExpression: existingFilter 
      ? `(${existingFilter}) AND ${softDeleteFilter}`
      : softDeleteFilter,
    attributeValues: {
      ':false': false
    }
  };
}

/**
 * FIX #6: Validate state transition isn't targeting a soft-deleted record
 */
export function validateNotSoftDeleted(record: any, operation: string): void {
  if (isSoftDeleted(record)) {
    throw new Error(`Cannot perform ${operation} on soft-deleted record`);
  }
}


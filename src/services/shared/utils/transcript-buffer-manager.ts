/**
 * Transcript Buffer Manager
 * 
 * Manages transcript buffers in DynamoDB to prevent data loss on Lambda cold starts
 * Replaces in-memory Map with persistent storage
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { toUnixSeconds, nowPlusSeconds } from '../../../shared/utils/timestamp-utils';

export interface TranscriptSegment {
  content: string;
  startTime: number;
  endTime: number;
  speaker: 'AGENT' | 'CUSTOMER';
  confidence: number;
}

export interface TranscriptBuffer {
  callId: string;
  segments: TranscriptSegment[];
  lastUpdate: number;
  segmentCount: number;
  ttl: number;
}

export class TranscriptBufferManager {
  private ddb: DynamoDBDocumentClient;
  private tableName: string;

  constructor(ddb: DynamoDBDocumentClient, tableName: string) {
    this.ddb = ddb;
    this.tableName = tableName;
  }

  /**
   * Initialize a new transcript buffer for a call
   */
  async initialize(callId: string): Promise<void> {
    const now = toUnixSeconds(Date.now());
    const ttl = nowPlusSeconds(3600); // 1 hour TTL

    try {
      await this.ddb.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          callId,
          segments: [],
          lastUpdate: now,
          segmentCount: 0,
          ttl,
          createdAt: new Date().toISOString()
        },
        ConditionExpression: 'attribute_not_exists(callId)' // Only create if doesn't exist
      }));

      console.log('[TranscriptBuffer] Initialized buffer for call:', callId);
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log('[TranscriptBuffer] Buffer already exists for call:', callId);
      } else {
        throw err;
      }
    }
  }

  /**
   * Add a segment to the transcript buffer
   * CRITICAL FIX: Handles out-of-order segments by sorting after insertion
   */
  async addSegment(callId: string, segment: TranscriptSegment): Promise<void> {
    const now = toUnixSeconds(Date.now());
    const ttl = nowPlusSeconds(3600);

    try {
      // CRITICAL FIX: Get existing buffer to check for out-of-order segments
      const existingBuffer = await this.get(callId);
      
      if (existingBuffer && existingBuffer.segments && existingBuffer.segments.length > 0) {
        const lastSegmentTime = existingBuffer.segments[existingBuffer.segments.length - 1].endTime;
        
        // Detect out-of-order segment
        if (segment.startTime < lastSegmentTime) {
          console.warn('[TranscriptBuffer] Out-of-order segment detected, will sort after insertion:', {
            callId,
            newSegmentStart: segment.startTime,
            lastSegmentEnd: lastSegmentTime,
            timeDiff: lastSegmentTime - segment.startTime
          });
          
          // Add segment and sort the entire array
          const updatedSegments = [...existingBuffer.segments, segment].sort((a, b) => a.startTime - b.startTime);
          
          // Note: 'segments' is a DynamoDB reserved keyword, so we alias it with #seg
          await this.ddb.send(new UpdateCommand({
            TableName: this.tableName,
            Key: { callId },
            UpdateExpression: `
              SET #seg = :sortedSegments,
                  segmentCount = :count,
                  lastUpdate = :now,
                  #ttl = :ttl,
                  hasOutOfOrderSegments = :true
            `,
            ExpressionAttributeNames: {
              '#seg': 'segments',
              '#ttl': 'ttl'
            },
            ExpressionAttributeValues: {
              ':sortedSegments': updatedSegments,
              ':count': updatedSegments.length,
              ':now': now,
              ':ttl': ttl,
              ':true': true
            }
          }));
          
          console.log('[TranscriptBuffer] Sorted segments after out-of-order insertion:', callId);
          return;
        }
      }
      
      // Normal case: append to end (in-order segment)
      // Note: 'segments' is a DynamoDB reserved keyword, so we alias it with #seg
      await this.ddb.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { callId },
        UpdateExpression: `
          SET #seg = list_append(if_not_exists(#seg, :empty), :segment),
              segmentCount = if_not_exists(segmentCount, :zero) + :one,
              lastUpdate = :now,
              #ttl = :ttl
        `,
        ExpressionAttributeNames: {
          '#seg': 'segments',
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':segment': [segment],
          ':empty': [],
          ':zero': 0,
          ':one': 1,
          ':now': now,
          ':ttl': ttl
        }
      }));

      console.log('[TranscriptBuffer] Added segment to buffer:', callId);
    } catch (err) {
      console.error('[TranscriptBuffer] Error adding segment:', err);
      throw err;
    }
  }

  /**
   * Get the current transcript buffer for a call
   */
  async get(callId: string): Promise<TranscriptBuffer | null> {
    try {
      const result = await this.ddb.send(new GetCommand({
        TableName: this.tableName,
        Key: { callId }
      }));

      if (!result.Item) {
        return null;
      }

      return result.Item as TranscriptBuffer;
    } catch (err) {
      console.error('[TranscriptBuffer] Error getting buffer:', err);
      return null;
    }
  }

  /**
   * Get only the latest N segments (for efficient retrieval)
   */
  async getLatestSegments(callId: string, count: number = 10): Promise<TranscriptSegment[]> {
    const buffer = await this.get(callId);
    
    if (!buffer || !buffer.segments) {
      return [];
    }

    return buffer.segments.slice(-count);
  }

  /**
   * Get segment count without retrieving all segments
   */
  async getSegmentCount(callId: string): Promise<number> {
    try {
      const result = await this.ddb.send(new GetCommand({
        TableName: this.tableName,
        Key: { callId },
        ProjectionExpression: 'segmentCount'
      }));

      return result.Item?.segmentCount || 0;
    } catch (err) {
      console.error('[TranscriptBuffer] Error getting segment count:', err);
      return 0;
    }
  }

  /**
   * Update TTL to keep buffer alive for active calls
   */
  async extendTTL(callId: string, additionalSeconds: number = 3600): Promise<void> {
    const newTTL = nowPlusSeconds(additionalSeconds);

    try {
      await this.ddb.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { callId },
        UpdateExpression: 'SET ttl = :ttl',
        ExpressionAttributeValues: {
          ':ttl': newTTL
        }
      }));
    } catch (err) {
      console.error('[TranscriptBuffer] Error extending TTL:', err);
    }
  }

  /**
   * Delete buffer (called when call completes)
   */
  async delete(callId: string): Promise<void> {
    try {
      await this.ddb.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { callId }
      }));

      console.log('[TranscriptBuffer] Deleted buffer for call:', callId);
    } catch (err) {
      console.error('[TranscriptBuffer] Error deleting buffer:', err);
    }
  }

  /**
   * Batch add segments (for bulk operations)
   */
  async addSegments(callId: string, segments: TranscriptSegment[]): Promise<void> {
    if (segments.length === 0) return;

    // Add segments one at a time to avoid exceeding item size limits
    // DynamoDB has 400KB item size limit
    for (const segment of segments) {
      await this.addSegment(callId, segment);
    }
  }

  /**
   * Cleanup old segments to prevent exceeding size limits
   * Keeps only last N segments in DynamoDB
   */
  async pruneSegments(callId: string, keepLast: number = 100): Promise<void> {
    const buffer = await this.get(callId);
    
    if (!buffer || buffer.segments.length <= keepLast) {
      return; // No pruning needed
    }

    // Keep only the last N segments
    const prunedSegments = buffer.segments.slice(-keepLast);

    try {
      // Note: 'segments' is a DynamoDB reserved keyword, so we alias it with #seg
      await this.ddb.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { callId },
        UpdateExpression: 'SET #seg = :segments, segmentCount = :count',
        ExpressionAttributeNames: {
          '#seg': 'segments'
        },
        ExpressionAttributeValues: {
          ':segments': prunedSegments,
          ':count': prunedSegments.length
        }
      }));

      console.log('[TranscriptBuffer] Pruned segments for call:', {
        callId,
        originalCount: buffer.segments.length,
        newCount: prunedSegments.length
      });
    } catch (err) {
      console.error('[TranscriptBuffer] Error pruning segments:', err);
    }
  }
}

/**
 * Singleton instance factory
 */
let bufferManagerInstance: TranscriptBufferManager | null = null;

export function getTranscriptBufferManager(
  ddb: DynamoDBDocumentClient,
  tableName: string
): TranscriptBufferManager {
  if (!bufferManagerInstance) {
    bufferManagerInstance = new TranscriptBufferManager(ddb, tableName);
  }
  return bufferManagerInstance;
}


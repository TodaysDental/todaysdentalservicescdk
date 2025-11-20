/**
 * FIX #41: Synchronous Cleanup - Async Cleanup Processor
 * 
 * Lambda function that processes cleanup tasks from SQS queue.
 * Handles cleanup of calls, agents, meetings, and recordings asynchronously.
 */

import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
// import { ChimeSDKMessagingClient, DeleteChannelCommand } from '@aws-sdk/client-chime-sdk-messaging';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getErrorTracker } from '../shared/utils/error-tracker';

const ddb = getDynamoDBClient();
const chime = new ChimeSDKMeetingsClient({});
const s3 = new S3Client({});
const errorTracker = getErrorTracker();

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log(`[CleanupProcessor] Processing ${event.Records.length} cleanup tasks`);

  for (const record of event.Records) {
    try {
      await processCleanupTask(record);
    } catch (err) {
      console.error('[CleanupProcessor] Error processing cleanup task:', err);
      await errorTracker.trackError(
        'cleanup_processor',
        err as Error,
        'HIGH',
        { messageId: record.messageId }
      );
      // Re-throw to trigger SQS retry
      throw err;
    }
  }

  await errorTracker.flush();
};

async function processCleanupTask(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body);
  const { resource, resourceId, metadata } = message;

  console.log(`[CleanupProcessor] Processing ${resource} cleanup: ${resourceId}`);

  switch (resource) {
    case 'call':
      await cleanupCallResources(resourceId, metadata);
      break;
    case 'agent':
      await cleanupAgentResources(resourceId, metadata);
      break;
    case 'meeting':
      await cleanupMeetingResources(resourceId, metadata);
      break;
    case 'recording':
      await cleanupRecordingResources(resourceId, metadata);
      break;
    default:
      console.warn(`[CleanupProcessor] Unknown resource type: ${resource}`);
  }
}

/**
 * Clean up all resources associated with a call
 */
async function cleanupCallResources(callId: string, metadata: any): Promise<void> {
  console.log(`[CleanupProcessor] Cleaning up call ${callId}`, metadata);

  // 1. Clean up Chime meeting if exists
  if (metadata.meetingId) {
    try {
      await chime.send(new DeleteMeetingCommand({
        MeetingId: metadata.meetingId
      }));
      console.log(`[CleanupProcessor] Deleted meeting ${metadata.meetingId}`);
    } catch (err: any) {
      if (err.name === 'NotFoundException') {
        console.log(`[CleanupProcessor] Meeting ${metadata.meetingId} already deleted`);
      } else {
        console.error('[CleanupProcessor] Failed to delete meeting:', err);
        // Continue with other cleanup steps
      }
    }
  }

  // 2. Clean up agent associations
  if (metadata.agentId) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: metadata.agentId },
        UpdateExpression: `
          SET #status = :online, lastActivityAt = :now
          REMOVE currentCallId, callStatus, ringingCallId, ringingCallTime
        `,
        ConditionExpression: 'currentCallId = :callId',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':online': 'Online',
          ':callId': callId,
          ':now': new Date().toISOString()
        }
      }));
      console.log(`[CleanupProcessor] Cleaned up agent ${metadata.agentId}`);
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`[CleanupProcessor] Agent ${metadata.agentId} already updated`);
      } else {
        console.error('[CleanupProcessor] Failed to clean up agent:', err);
      }
    }
  }

  // 3. Update call record to mark cleanup complete
  if (metadata.clinicId && metadata.queuePosition) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: {
          clinicId: metadata.clinicId,
          queuePosition: metadata.queuePosition
        },
        UpdateExpression: 'SET cleanupCompletedAt = :now REMOVE meetingInfo',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString()
        }
      }));
    } catch (err) {
      console.error('[CleanupProcessor] Failed to update call record:', err);
    }
  }

  console.log(`[CleanupProcessor] Completed cleanup for call ${callId}`);
}

/**
 * Clean up agent resources
 */
async function cleanupAgentResources(agentId: string, metadata: any): Promise<void> {
  console.log(`[CleanupProcessor] Cleaning up agent ${agentId}`, metadata);

  try {
    await ddb.send(new UpdateCommand({
      TableName: AGENT_PRESENCE_TABLE_NAME,
      Key: { agentId },
      UpdateExpression: `
        SET #status = :offline, lastActivityAt = :now, offlineReason = :reason
        REMOVE currentCallId, callStatus, ringingCallId, ringingCallTime, sessionExpiresAtEpoch
      `,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':offline': 'Offline',
        ':now': new Date().toISOString(),
        ':reason': metadata.reason || 'cleanup'
      }
    }));

    console.log(`[CleanupProcessor] Agent ${agentId} marked offline`);
  } catch (err) {
    console.error('[CleanupProcessor] Failed to clean up agent:', err);
    throw err;
  }
}

/**
 * Clean up meeting resources
 */
async function cleanupMeetingResources(meetingId: string, metadata: any): Promise<void> {
  console.log(`[CleanupProcessor] Cleaning up meeting ${meetingId}`, metadata);

  try {
    await chime.send(new DeleteMeetingCommand({
      MeetingId: meetingId
    }));
    console.log(`[CleanupProcessor] Deleted meeting ${meetingId}`);
  } catch (err: any) {
    if (err.name === 'NotFoundException') {
      console.log(`[CleanupProcessor] Meeting ${meetingId} already deleted`);
    } else {
      console.error('[CleanupProcessor] Failed to delete meeting:', err);
      throw err;
    }
  }

  // Update call record if provided
  if (metadata.callId) {
    try {
      // Find and update the call record
      const result = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': metadata.callId }
      }));

      if (result.Items && result.Items.length > 0) {
        const call = result.Items[0];
        await ddb.send(new UpdateCommand({
          TableName: CALL_QUEUE_TABLE_NAME,
          Key: {
            clinicId: call.clinicId,
            queuePosition: call.queuePosition
          },
          UpdateExpression: 'REMOVE meetingInfo SET meetingCleanedAt = :now',
          ExpressionAttributeValues: {
            ':now': new Date().toISOString()
          }
        }));
      }
    } catch (err) {
      console.error('[CleanupProcessor] Failed to update call record:', err);
    }
  }
}

/**
 * Clean up recording resources
 */
async function cleanupRecordingResources(recordingId: string, metadata: any): Promise<void> {
  console.log(`[CleanupProcessor] Cleaning up recording ${recordingId}`, metadata);

  // Delete from S3 if needed (based on retention policy)
  if (metadata.s3Bucket && metadata.s3Key && metadata.reason === 'retention_expired') {
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: metadata.s3Bucket,
        Key: metadata.s3Key
      }));
      console.log(`[CleanupProcessor] Deleted recording from S3: ${metadata.s3Key}`);
    } catch (err) {
      console.error('[CleanupProcessor] Failed to delete recording from S3:', err);
      throw err;
    }
  }

  // Note: Recording metadata in DynamoDB is kept for audit purposes
  // and cleaned up by TTL
}


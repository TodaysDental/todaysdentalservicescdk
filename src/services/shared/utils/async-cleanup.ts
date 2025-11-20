/**
 * FIX #41: Synchronous Cleanup
 * 
 * Provides async cleanup via SQS to prevent blocking API responses
 * with resource cleanup operations.
 */

import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
const CLEANUP_QUEUE_URL = process.env.CLEANUP_QUEUE_URL;

export type CleanupResource = 'call' | 'agent' | 'meeting' | 'recording';
export type CleanupPriority = 'low' | 'normal' | 'high';

export interface CleanupTask {
  resource: CleanupResource;
  resourceId: string;
  metadata: any;
  priority?: CleanupPriority;
  delaySeconds?: number;
}

/**
 * Schedule async cleanup for a resource
 * Non-blocking operation that queues cleanup for later processing
 */
export async function scheduleAsyncCleanup(task: CleanupTask): Promise<void> {
  if (!CLEANUP_QUEUE_URL) {
    console.warn('[AsyncCleanup] No cleanup queue URL configured, skipping cleanup');
    return;
  }

  const message = {
    ...task,
    scheduledAt: new Date().toISOString(),
    priority: task.priority || 'normal'
  };

  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl: CLEANUP_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        resourceType: {
          DataType: 'String',
          StringValue: task.resource
        },
        priority: {
          DataType: 'String',
          StringValue: message.priority
        },
        resourceId: {
          DataType: 'String',
          StringValue: task.resourceId
        }
      },
      DelaySeconds: task.delaySeconds || 0
    }));

    console.log(`[AsyncCleanup] Scheduled ${task.resource} cleanup: ${task.resourceId}`);
  } catch (err) {
    console.error('[AsyncCleanup] Failed to schedule cleanup:', err);
    // Don't throw - cleanup scheduling is best-effort
  }
}

/**
 * Schedule multiple cleanup tasks in batch
 * More efficient for bulk operations
 */
export async function scheduleAsyncCleanupBatch(tasks: CleanupTask[]): Promise<void> {
  if (!CLEANUP_QUEUE_URL) {
    console.warn('[AsyncCleanup] No cleanup queue URL configured, skipping cleanup');
    return;
  }

  if (tasks.length === 0) {
    return;
  }

  // SQS batch limit is 10 messages
  const batches: CleanupTask[][] = [];
  for (let i = 0; i < tasks.length; i += 10) {
    batches.push(tasks.slice(i, i + 10));
  }

  for (const batch of batches) {
    const entries = batch.map((task, index) => {
      const message = {
        ...task,
        scheduledAt: new Date().toISOString(),
        priority: task.priority || 'normal'
      };

      return {
        Id: `cleanup-${index}-${Date.now()}`,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          resourceType: {
            DataType: 'String',
            StringValue: task.resource
          },
          priority: {
            DataType: 'String',
            StringValue: message.priority
          },
          resourceId: {
            DataType: 'String',
            StringValue: task.resourceId
          }
        },
        DelaySeconds: task.delaySeconds || 0
      };
    });

    try {
      const result = await sqs.send(new SendMessageBatchCommand({
        QueueUrl: CLEANUP_QUEUE_URL,
        Entries: entries
      }));

      if (result.Successful) {
        console.log(`[AsyncCleanup] Scheduled ${result.Successful.length} cleanup tasks`);
      }

      if (result.Failed && result.Failed.length > 0) {
        console.error(`[AsyncCleanup] Failed to schedule ${result.Failed.length} tasks:`, result.Failed);
      }
    } catch (err) {
      console.error('[AsyncCleanup] Batch cleanup scheduling failed:', err);
      // Don't throw - cleanup scheduling is best-effort
    }
  }
}

/**
 * Helper functions for specific resource types
 */
export const CleanupScheduler = {
  /**
   * Schedule call cleanup
   */
  scheduleCallCleanup: async (
    callId: string,
    metadata: {
      clinicId: string;
      queuePosition: number;
      agentId?: string;
      meetingId?: string;
    },
    priority: CleanupPriority = 'normal'
  ) => {
    await scheduleAsyncCleanup({
      resource: 'call',
      resourceId: callId,
      metadata,
      priority,
      delaySeconds: priority === 'low' ? 10 : 0
    });
  },

  /**
   * Schedule agent cleanup
   */
  scheduleAgentCleanup: async (
    agentId: string,
    metadata: {
      reason: string;
      currentCallId?: string;
    },
    priority: CleanupPriority = 'normal'
  ) => {
    await scheduleAsyncCleanup({
      resource: 'agent',
      resourceId: agentId,
      metadata,
      priority,
      delaySeconds: 0
    });
  },

  /**
   * Schedule meeting cleanup
   */
  scheduleMeetingCleanup: async (
    meetingId: string,
    metadata: {
      callId?: string;
      reason: string;
    },
    priority: CleanupPriority = 'low'
  ) => {
    await scheduleAsyncCleanup({
      resource: 'meeting',
      resourceId: meetingId,
      metadata,
      priority,
      delaySeconds: 30 // Delay meeting cleanup to allow graceful termination
    });
  },

  /**
   * Schedule recording cleanup
   */
  scheduleRecordingCleanup: async (
    recordingId: string,
    metadata: {
      s3Bucket: string;
      s3Key: string;
      reason: string;
    },
    priority: CleanupPriority = 'low'
  ) => {
    await scheduleAsyncCleanup({
      resource: 'recording',
      resourceId: recordingId,
      metadata,
      priority,
      delaySeconds: 0
    });
  }
};


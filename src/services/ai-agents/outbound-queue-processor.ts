/**
 * Outbound Queue Processor - Async batch handler for high-volume scheduling
 * 
 * Processes batches of scheduled calls from SQS queue.
 * Enables scheduling 30,000+ calls without Lambda timeout issues.
 * 
 * Flow:
 * 1. Receive batch messages from SQS queue
 * 2. Create EventBridge schedules for each call
 * 3. Update BulkOutboundJobs table with progress
 * 4. Report partial failures for retry
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { v4 as uuidv4 } from 'uuid';

// ========================================================================
// CLIENTS
// ========================================================================

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const schedulerClient = new SchedulerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE || 'ScheduledCalls';
const BULK_OUTBOUND_JOBS_TABLE = process.env.BULK_OUTBOUND_JOBS_TABLE || 'BulkOutboundJobs';
const OUTBOUND_CALL_LAMBDA_ARN = process.env.OUTBOUND_CALL_LAMBDA_ARN || '';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || '';

// ========================================================================
// TYPES
// ========================================================================

interface CallBatchMessage {
  jobId: string;
  clinicId: string;
  agentId: string;
  batchIndex: number;
  totalBatches: number;
  calls: Array<{
    phoneNumber: string;
    patientName?: string;
    patientId?: string;
    scheduledTime: string;
    purpose: 'appointment_reminder' | 'follow_up' | 'payment_reminder' | 'reengagement' | 'custom';
    customMessage?: string;
    appointmentId?: string;
  }>;
  timezone?: string;
  maxAttempts?: number;
  createdBy: string;
}

interface ScheduledCall {
  callId: string;
  clinicId: string;
  agentId: string;
  phoneNumber: string;
  patientName?: string;
  patientId?: string;
  scheduledTime: string;
  timezone: string;
  purpose: string;
  customMessage?: string;
  appointmentId?: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  schedulerArn?: string;
  schedulerName?: string;
  jobId?: string; // Link to bulk job
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  ttl: number;
}

// ========================================================================
// HANDLER
// ========================================================================

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log('[OutboundQueueProcessor] Processing batch', {
    recordCount: event.Records.length,
  });

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as CallBatchMessage;
      
      console.log('[OutboundQueueProcessor] Processing batch message', {
        jobId: message.jobId,
        batchIndex: message.batchIndex,
        totalBatches: message.totalBatches,
        callCount: message.calls.length,
      });

      const results = await processBatch(message);
      
      // Update job progress
      await updateJobProgress(message.jobId, {
        processedCalls: results.processed,
        successfulCalls: results.successful,
        failedCalls: results.failed,
        isFinalBatch: message.batchIndex === message.totalBatches - 1,
      });

      console.log('[OutboundQueueProcessor] Batch processed', {
        jobId: message.jobId,
        batchIndex: message.batchIndex,
        processed: results.processed,
        successful: results.successful,
        failed: results.failed,
      });

    } catch (error) {
      console.error('[OutboundQueueProcessor] Failed to process batch', {
        messageId: record.messageId,
        error: (error as Error).message,
      });
      
      // Report failure for retry
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  return { batchItemFailures };
};

// ========================================================================
// BATCH PROCESSING
// ========================================================================

async function processBatch(message: CallBatchMessage): Promise<{
  processed: number;
  successful: number;
  failed: number;
}> {
  let successful = 0;
  let failed = 0;

  // Process calls in parallel with concurrency limit
  const PARALLEL_SIZE = 10;
  
  for (let i = 0; i < message.calls.length; i += PARALLEL_SIZE) {
    const batch = message.calls.slice(i, i + PARALLEL_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(call => createScheduledCall({
        ...call,
        clinicId: message.clinicId,
        agentId: message.agentId,
        timezone: message.timezone,
        maxAttempts: message.maxAttempts,
        jobId: message.jobId,
        createdBy: message.createdBy,
      }))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        successful++;
      } else {
        failed++;
        console.warn('[OutboundQueueProcessor] Call scheduling failed', {
          error: result.status === 'rejected' 
            ? (result.reason as Error).message 
            : result.value.error,
        });
      }
    }
  }

  return {
    processed: message.calls.length,
    successful,
    failed,
  };
}

async function createScheduledCall(params: {
  clinicId: string;
  agentId: string;
  phoneNumber: string;
  patientName?: string;
  patientId?: string;
  scheduledTime: string;
  timezone?: string;
  purpose: string;
  customMessage?: string;
  appointmentId?: string;
  maxAttempts?: number;
  jobId: string;
  createdBy: string;
}): Promise<{ success: boolean; callId?: string; error?: string }> {
  const callId = uuidv4();
  const timestamp = new Date().toISOString();
  const schedulerName = `outbound-call-${callId}`;

  // Parse scheduled time
  const scheduledDate = new Date(params.scheduledTime);
  if (scheduledDate <= new Date()) {
    return { success: false, error: 'scheduledTime must be in the future' };
  }

  // Validate phone number format
  const normalizedPhone = params.phoneNumber.replace(/\D/g, '');
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return { success: false, error: 'Invalid phone number' };
  }

  const scheduledCall: ScheduledCall = {
    callId,
    clinicId: params.clinicId,
    agentId: params.agentId,
    phoneNumber: params.phoneNumber,
    patientName: params.patientName,
    patientId: params.patientId,
    scheduledTime: params.scheduledTime,
    timezone: params.timezone || 'America/New_York',
    purpose: params.purpose,
    customMessage: params.customMessage,
    appointmentId: params.appointmentId,
    status: 'scheduled',
    attempts: 0,
    maxAttempts: params.maxAttempts || 3,
    schedulerName,
    jobId: params.jobId,
    createdAt: timestamp,
    createdBy: params.createdBy,
    updatedAt: timestamp,
    ttl: Math.floor(scheduledDate.getTime() / 1000) + (7 * 24 * 60 * 60), // 7 days after scheduled time
  };

  try {
    // Create EventBridge schedule
    const scheduleResponse = await schedulerClient.send(new CreateScheduleCommand({
      Name: schedulerName,
      ScheduleExpression: `at(${scheduledDate.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE', // Auto-cleanup after execution
      Target: {
        Arn: OUTBOUND_CALL_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          callId,
          clinicId: params.clinicId,
          agentId: params.agentId,
          phoneNumber: params.phoneNumber,
          patientName: params.patientName,
          purpose: params.purpose,
          customMessage: params.customMessage,
        }),
      },
    }));

    scheduledCall.schedulerArn = scheduleResponse.ScheduleArn;

    // Save to DynamoDB
    await docClient.send(new PutCommand({
      TableName: SCHEDULED_CALLS_TABLE,
      Item: scheduledCall,
    }));

    return { success: true, callId };
  } catch (error: any) {
    console.error('[OutboundQueueProcessor] Failed to create schedule', {
      callId,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

// ========================================================================
// JOB PROGRESS TRACKING
// ========================================================================

async function updateJobProgress(jobId: string, progress: {
  processedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  isFinalBatch: boolean;
}): Promise<void> {
  try {
    const updateExpression = progress.isFinalBatch
      ? 'SET processedCalls = processedCalls + :processed, successfulCalls = successfulCalls + :successful, failedCalls = failedCalls + :failed, #status = :completed, completedAt = :now, updatedAt = :now'
      : 'SET processedCalls = processedCalls + :processed, successfulCalls = successfulCalls + :successful, failedCalls = failedCalls + :failed, #status = :processing, updatedAt = :now';

    await docClient.send(new UpdateCommand({
      TableName: BULK_OUTBOUND_JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':processed': progress.processedCalls,
        ':successful': progress.successfulCalls,
        ':failed': progress.failedCalls,
        ':completed': 'completed',
        ':processing': 'processing',
        ':now': new Date().toISOString(),
      },
    }));
  } catch (error) {
    console.error('[OutboundQueueProcessor] Failed to update job progress', {
      jobId,
      error: (error as Error).message,
    });
  }
}

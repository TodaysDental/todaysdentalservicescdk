/**
 * Email Analytics Event Processor
 * 
 * Processes SES events from SNS notifications and updates DynamoDB tracking records.
 * Handles: Send, Delivery, Bounce, Complaint, Open, Click, Reject, RenderingFailure
 */

import { SNSEvent, SNSEventRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  SESEventNotification,
  SESEventType,
  EmailStatus,
  EmailTrackingRecord,
} from '../../shared/types/email-analytics';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE!;
const EMAIL_STATS_TABLE = process.env.EMAIL_STATS_TABLE!;

// Map SES event types to email status
const eventStatusMap: Record<SESEventType, EmailStatus> = {
  'Send': 'SENT',
  'Delivery': 'DELIVERED',
  'Bounce': 'BOUNCED',
  'Complaint': 'COMPLAINED',
  'Open': 'OPENED',
  'Click': 'CLICKED',
  'Reject': 'REJECTED',
  'RenderingFailure': 'FAILED',
  'DeliveryDelay': 'SENT', // Keep as sent, just note the delay
};

// Status priority for determining "current" status (higher wins if already set)
const statusPriority: Record<EmailStatus, number> = {
  'QUEUED': 0,
  'SENT': 1,
  'DELIVERED': 2,
  'OPENED': 3,
  'CLICKED': 4,
  'BOUNCED': 10, // Terminal states have high priority
  'COMPLAINED': 10,
  'REJECTED': 10,
  'FAILED': 10,
};

export const handler = async (event: SNSEvent): Promise<void> => {
  console.log('Processing SES events:', JSON.stringify(event));

  const promises = event.Records.map(processRecord);
  await Promise.allSettled(promises);
};

async function processRecord(record: SNSEventRecord): Promise<void> {
  try {
    const message = JSON.parse(record.Sns.Message) as SESEventNotification;
    console.log('Processing event:', message.eventType, 'MessageId:', message.mail.messageId);

    await updateEmailTracking(message);
    await updateAggregateStats(message);
  } catch (error) {
    console.error('Error processing record:', error);
    // Don't throw - we want to continue processing other records
  }
}

async function updateEmailTracking(event: SESEventNotification): Promise<void> {
  const messageId = event.mail.messageId;
  const eventType = event.eventType;
  const timestamp = new Date().toISOString();

  // Get existing record or create new one
  let existingRecord: EmailTrackingRecord | undefined;
  try {
    const result = await ddb.send(new GetCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Key: { messageId },
    }));
    existingRecord = result.Item as EmailTrackingRecord | undefined;
  } catch (error) {
    console.error('Error getting existing record:', error);
  }

  // Determine new status based on event
  const newStatus = eventStatusMap[eventType];
  const currentPriority = existingRecord ? statusPriority[existingRecord.status] : 0;
  const newPriority = statusPriority[newStatus];

  // Build update expression based on event type
  const updateExpressions: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, any> = {};

  // Always update lastEventAt
  updateExpressions.push('#lastEventAt = :lastEventAt');
  expressionNames['#lastEventAt'] = 'lastEventAt';
  expressionValues[':lastEventAt'] = timestamp;

  // Update status if new event has higher priority
  if (newPriority >= currentPriority) {
    updateExpressions.push('#status = :status');
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = newStatus;
  }

  // Add event-specific timestamp and data
  switch (eventType) {
    case 'Send':
      updateExpressions.push('sendTimestamp = :sendTs');
      expressionValues[':sendTs'] = event.mail.timestamp;
      // Set initial record data from mail object
      if (!existingRecord) {
        updateExpressions.push('recipientEmail = :recipient');
        updateExpressions.push('sentAt = :sentAt');
        expressionValues[':recipient'] = event.mail.destination[0];
        expressionValues[':sentAt'] = event.mail.timestamp;

        // Extract clinicId from tags if available
        if (event.mail.tags?.clinicId) {
          updateExpressions.push('clinicId = :clinicId');
          expressionValues[':clinicId'] = event.mail.tags.clinicId[0];
        }

        // Extract subject from common headers
        if (event.mail.commonHeaders?.subject) {
          updateExpressions.push('subject = :subject');
          expressionValues[':subject'] = event.mail.commonHeaders.subject;
        }
      }
      break;

    case 'Delivery':
      updateExpressions.push('deliveryTimestamp = :deliveryTs');
      expressionValues[':deliveryTs'] = event.delivery?.timestamp;
      break;

    case 'Bounce':
      updateExpressions.push('bounceTimestamp = :bounceTs');
      updateExpressions.push('bounceType = :bounceType');
      updateExpressions.push('bounceSubType = :bounceSubType');
      expressionValues[':bounceTs'] = event.bounce?.timestamp;
      expressionValues[':bounceType'] = event.bounce?.bounceType;
      expressionValues[':bounceSubType'] = event.bounce?.bounceSubType;
      if (event.bounce?.bouncedRecipients?.[0]?.diagnosticCode) {
        updateExpressions.push('bounceReason = :bounceReason');
        expressionValues[':bounceReason'] = event.bounce.bouncedRecipients[0].diagnosticCode;
      }
      break;

    case 'Complaint':
      updateExpressions.push('complaintTimestamp = :complaintTs');
      expressionValues[':complaintTs'] = event.complaint?.timestamp;
      if (event.complaint?.complaintFeedbackType) {
        updateExpressions.push('complaintFeedbackType = :feedbackType');
        expressionValues[':feedbackType'] = event.complaint.complaintFeedbackType;
      }
      break;

    case 'Open':
      updateExpressions.push('openTimestamp = if_not_exists(openTimestamp, :openTs)');
      updateExpressions.push('openCount = if_not_exists(openCount, :zero) + :one');
      expressionValues[':openTs'] = event.open?.timestamp;
      expressionValues[':zero'] = 0;
      expressionValues[':one'] = 1;
      if (event.open?.userAgent) {
        updateExpressions.push('userAgent = :userAgent');
        expressionValues[':userAgent'] = event.open.userAgent;
      }
      break;

    case 'Click':
      updateExpressions.push('clickTimestamp = if_not_exists(clickTimestamp, :clickTs)');
      expressionValues[':clickTs'] = event.click?.timestamp;
      if (event.click?.link) {
        updateExpressions.push('clickedLinks = list_append(if_not_exists(clickedLinks, :emptyList), :newLink)');
        expressionValues[':emptyList'] = [];
        expressionValues[':newLink'] = [event.click.link];
      }
      break;

    case 'Reject':
      updateExpressions.push('bounceReason = :rejectReason');
      expressionValues[':rejectReason'] = event.reject?.reason || 'Rejected by SES';
      break;

    case 'RenderingFailure':
      updateExpressions.push('bounceReason = :renderError');
      expressionValues[':renderError'] = event.renderingFailure?.errorMessage || 'Template rendering failed';
      break;
  }

  // Execute update
  try {
    await ddb.send(new UpdateCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Key: { messageId },
      UpdateExpression: 'SET ' + updateExpressions.join(', '),
      ExpressionAttributeNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      ExpressionAttributeValues: expressionValues,
    }));
    console.log('Updated tracking for messageId:', messageId);
  } catch (error) {
    console.error('Error updating tracking record:', error);
    throw error;
  }
}

async function updateAggregateStats(event: SESEventNotification): Promise<void> {
  // Extract clinicId from tags
  const clinicId = event.mail.tags?.clinicId?.[0] || 'unknown';
  const eventType = event.eventType;
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  // Build the attribute to increment based on event type
  let attributeToIncrement: string | null = null;
  let additionalUpdates: Record<string, any> = {};

  switch (eventType) {
    case 'Send':
      attributeToIncrement = 'totalSent';
      break;
    case 'Delivery':
      attributeToIncrement = 'totalDelivered';
      break;
    case 'Open':
      attributeToIncrement = 'totalOpened';
      break;
    case 'Click':
      attributeToIncrement = 'totalClicked';
      break;
    case 'Bounce':
      attributeToIncrement = 'totalBounced';
      if (event.bounce?.bounceType === 'Permanent') {
        additionalUpdates['hardBounces'] = 1;
      } else {
        additionalUpdates['softBounces'] = 1;
      }
      break;
    case 'Complaint':
      attributeToIncrement = 'totalComplained';
      break;
    case 'Reject':
    case 'RenderingFailure':
      attributeToIncrement = 'totalFailed';
      break;
    case 'DeliveryDelay':
      // DeliveryDelay is informational only — delivery hasn't failed yet,
      // so we don't increment any counter. The email will eventually
      // resolve to 'Delivery' or 'Bounce'.
      break;
  }

  if (!attributeToIncrement) return;

  // Build update expression
  const updates = [
    `${attributeToIncrement} = if_not_exists(${attributeToIncrement}, :zero) + :one`,
    'lastUpdated = :now',
  ];
  const values: Record<string, any> = {
    ':zero': 0,
    ':one': 1,
    ':now': now.toISOString(),
  };

  // Add any additional bounce type updates
  for (const [attr, inc] of Object.entries(additionalUpdates)) {
    updates.push(`${attr} = if_not_exists(${attr}, :zero) + :inc${attr}`);
    values[`:inc${attr}`] = inc;
  }

  try {
    await ddb.send(new UpdateCommand({
      TableName: EMAIL_STATS_TABLE,
      Key: {
        clinicId,
        period: monthKey,
      },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeValues: values,
    }));
    console.log('Updated stats for clinic:', clinicId, 'period:', monthKey);
  } catch (error) {
    console.error('Error updating aggregate stats:', error);
    // Don't throw - stats are secondary to tracking
  }
}

/**
 * Email Sender Lambda - Processes individual email tasks from the email queue
 * 
 * This Lambda receives one email task at a time and sends it via SES.
 * Benefits:
 * - Infinite scalability (no timeout issues for large batches)
 * - Individual retry per email (failed emails don't affect others)
 * - Better error tracking per email
 * - Rate limiting handled by SQS concurrency
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SQSEvent } from 'aws-lambda';
import { getClinicConfig, ClinicConfig } from '../../shared/utils/secrets-helper';

interface EmailTask {
  trackingId: string;
  clinicId: string;
  recipientEmail: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  templateName?: string;
  scheduleId: string;
}

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const ses = new SESv2Client({});

const EMAIL_ANALYTICS_TABLE = process.env.EMAIL_ANALYTICS_TABLE || '';
const SES_CONFIGURATION_SET_NAME = process.env.SES_CONFIGURATION_SET_NAME || '';

// Cache for clinic config (populated on demand from DynamoDB)
const clinicConfigCache: Record<string, ClinicConfig> = {};

/**
 * Get clinic config from DynamoDB (cached)
 */
async function getCachedClinicConfig(clinicId: string): Promise<ClinicConfig | null> {
  if (clinicConfigCache[clinicId]) {
    return clinicConfigCache[clinicId];
  }

  const config = await getClinicConfig(clinicId);
  if (config) {
    clinicConfigCache[clinicId] = config;
  }
  return config;
}

async function sendEmail(task: EmailTask): Promise<string | undefined> {
  const { clinicId, recipientEmail, subject, htmlBody, textBody, templateName } = task;
  
  const config = await getCachedClinicConfig(clinicId);
  if (!config?.sesIdentityArn) {
    throw new Error(`No SES identity configured for clinic: ${clinicId}`);
  }
  
  // Use the clinic's verified email address
  let from: string;
  
  if (!config.clinicEmail) {
    const fromDomain = config.sesIdentityArn.split(':identity/')[1] || 'todaysdentalinsights.com';
    from = `no-reply@${fromDomain}`;
  } else {
    from = config.clinicEmail;
  }
  
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    FromEmailAddressIdentityArn: config.sesIdentityArn,
    Destination: { ToAddresses: [recipientEmail] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { 
          Html: { Data: htmlBody }, 
          Text: { Data: textBody || htmlBody.replace(/<[^>]+>/g, ' ') } 
        },
      },
    },
    ConfigurationSetName: SES_CONFIGURATION_SET_NAME || undefined,
    EmailTags: [
      { Name: 'clinicId', Value: clinicId },
      { Name: 'source', Value: 'scheduled-email-queue' },
      ...(templateName ? [{ Name: 'templateName', Value: templateName }] : []),
    ],
  });
  
  const response = await ses.send(cmd);
  return response.MessageId;
}

async function updateEmailStatus(trackingId: string, status: string, sesMessageId?: string, errorMessage?: string): Promise<void> {
  if (!EMAIL_ANALYTICS_TABLE || !trackingId) return;
  
  try {
    const updateExpr = errorMessage 
      ? 'SET #status = :status, sentAt = :now, errorMessage = :err' + (sesMessageId ? ', sesMessageId = :sesId' : '')
      : 'SET #status = :status, sentAt = :now' + (sesMessageId ? ', sesMessageId = :sesId' : '');
    
    await doc.send(new UpdateCommand({
      TableName: EMAIL_ANALYTICS_TABLE,
      Key: { messageId: trackingId },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':now': new Date().toISOString(),
        ...(sesMessageId && { ':sesId': sesMessageId }),
        ...(errorMessage && { ':err': errorMessage }),
      },
    }));
  } catch (err) {
    console.warn(`Failed to update email status for ${trackingId}:`, err);
  }
}

async function processEmailTask(task: EmailTask): Promise<void> {
  try {
    console.log(`Sending email to ${task.recipientEmail} for clinic ${task.clinicId}`);
    
    const sesMessageId = await sendEmail(task);
    
    // Update tracking to SENT
    await updateEmailStatus(task.trackingId, 'SENT', sesMessageId);
    
    console.log(`Successfully sent email to ${task.recipientEmail}, SES ID: ${sesMessageId}`);
  } catch (error: any) {
    console.error(`Failed to send email to ${task.recipientEmail}:`, error);
    
    // Update tracking to FAILED
    await updateEmailStatus(task.trackingId, 'FAILED', undefined, error.message);
    
    // Re-throw to trigger SQS retry
    throw error;
  }
}

export const handler = async (event: SQSEvent) => {
  const failedRecords: { itemIdentifier: string }[] = [];
  
  for (const record of event.Records) {
    try {
      const task: EmailTask = JSON.parse(record.body);
      await processEmailTask(task);
    } catch (error) {
      console.error(`Failed to process email record ${record.messageId}:`, error);
      failedRecords.push({ itemIdentifier: record.messageId });
    }
  }
  
  console.log(`Email sender completed: ${event.Records.length - failedRecords.length} sent, ${failedRecords.length} failed`);
  
  return {
    batchItemFailures: failedRecords,
  };
};

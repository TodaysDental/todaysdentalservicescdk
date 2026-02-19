import { S3Event } from 'aws-lambda';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
    sendVoicemailNotification,
    isPushNotificationsEnabled,
} from './utils/push-notifications';

const ddb = getDynamoDBClient();
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;

/**
 * PROCESS VOICEMAIL
 *
 * Triggered by S3 ObjectCreated events on the voicemail bucket.
 * Key format: voicemails/{clinicId}/{callId}.wav
 *
 * 1. Parses the S3 key to extract clinicId and callId
 * 2. Updates the call queue record with voicemail metadata
 * 3. Sends push notification to clinic supervisors
 */
export const handler = async (event: S3Event): Promise<void> => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        const size = record.s3.object.size;

        console.log(`[process-voicemail] New voicemail: s3://${bucket}/${key} (${size} bytes)`);

        // Parse key: voicemails/{clinicId}/{callId}.wav
        const match = key.match(/^voicemails\/([^/]+)\/([^/]+)\.\w+$/);
        if (!match) {
            console.warn(`[process-voicemail] Skipping non-voicemail key: ${key}`);
            continue;
        }

        const [, clinicId, callId] = match;
        const voicemailId = `vm-${clinicId}-${callId}-${Date.now()}`;

        // Estimate duration from file size (WAV 8kHz 16-bit mono ≈ 16KB/sec)
        const estimatedDurationSeconds = Math.round(size / 16000);

        try {
            // Look up the call record by callId
            const { Items: callRecords } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: { ':callId': callId },
            }));

            const callRecord = callRecords?.[0];

            if (callRecord) {
                // Update call record with voicemail reference
                await ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                    UpdateExpression: `
            SET voicemailId = :vmId,
                voicemailS3Key = :s3Key,
                voicemailBucket = :bucket,
                voicemailDuration = :duration,
                voicemailRecordedAt = :now,
                hasVoicemail = :true
          `,
                    ExpressionAttributeValues: {
                        ':vmId': voicemailId,
                        ':s3Key': key,
                        ':bucket': bucket,
                        ':duration': estimatedDurationSeconds,
                        ':now': new Date().toISOString(),
                        ':true': true,
                    },
                }));

                console.log(`[process-voicemail] Updated call ${callId} with voicemail ${voicemailId}`);
            } else {
                console.warn(`[process-voicemail] Call record not found for callId: ${callId}`);
            }

            // Send push notification
            if (isPushNotificationsEnabled()) {
                const callerPhone = callRecord?.phoneNumber || 'Unknown';
                const clinicName = callRecord?.clinicName || clinicId;

                await sendVoicemailNotification({
                    callId,
                    clinicId,
                    clinicName,
                    callerPhoneNumber: callerPhone,
                    timestamp: new Date().toISOString(),
                    voicemailId,
                    durationSeconds: estimatedDurationSeconds,
                    s3Key: key,
                });

                console.log(`[process-voicemail] Push notification sent for voicemail ${voicemailId}`);
            }
        } catch (error) {
            console.error(`[process-voicemail] Error processing voicemail for call ${callId}:`, error);
            // Don't throw — process remaining records
        }
    }
};

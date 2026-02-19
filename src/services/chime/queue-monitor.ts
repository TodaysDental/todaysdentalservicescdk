import { ScheduledEvent } from 'aws-lambda';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { ChimeSDKVoiceClient } from '@aws-sdk/client-chime-sdk-voice';
import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CustomerNotificationService } from './utils/customer-notifications';
import { isPushNotificationsEnabled, sendClinicAlert } from './utils/push-notifications';
import { CHIME_CONFIG } from './config';

const ddb = getDynamoDBClient();
const chimeVoice = new ChimeSDKVoiceClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME!;

/**
 * QUEUE MONITOR
 *
 * Scheduled Lambda (EventBridge – every 2 minutes) that scans the call queue
 * across all clinics and sends proactive notifications to callers:
 *   - Estimated wait-time announcements
 *   - Queue-timeout notifications (→ voicemail offer)
 *   - Callback offers for long-waiting callers
 *
 * Also sends push notifications to clinic staff when the queue depth
 * exceeds the configured threshold (PUSH.QUEUE_BACKUP_ALERT_THRESHOLD).
 *
 * Uses the existing CustomerNotificationService utility which sends SMA
 * UpdateSipMediaApplicationCall commands to play messages to queued callers.
 */
export const handler = async (_event: ScheduledEvent): Promise<void> => {
    console.log('[queue-monitor] Starting queue scan');

    const notificationService = new CustomerNotificationService(chimeVoice, ddb, CALL_QUEUE_TABLE_NAME);

    try {
        // Get all clinics
        const { Items: clinics } = await ddb.send(new ScanCommand({
            TableName: CLINICS_TABLE_NAME,
            ProjectionExpression: 'clinicId, clinicName',
        }));

        if (!clinics || clinics.length === 0) {
            console.log('[queue-monitor] No clinics found');
            return;
        }

        const results = await Promise.allSettled(
            clinics.map(async (clinic) => {
                try {
                    // 1) Existing: SMA-based customer notifications (wait time, timeout, callback offers)
                    await notificationService.monitorQueueTimeouts(clinic.clinicId, CALL_QUEUE_TABLE_NAME);

                    // 2) New: Push queue-backup alert to clinic staff
                    if (isPushNotificationsEnabled()) {
                        await checkQueueBackup(clinic.clinicId, clinic.clinicName || clinic.clinicId);
                    }

                    return { clinicId: clinic.clinicId, status: 'ok' };
                } catch (err) {
                    console.error(`[queue-monitor] Error for clinic ${clinic.clinicId}:`, err);
                    return { clinicId: clinic.clinicId, status: 'error', error: err };
                }
            }),
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`[queue-monitor] Scan complete: ${succeeded} succeeded, ${failed} failed out of ${clinics.length} clinics`);
    } catch (error) {
        console.error('[queue-monitor] Fatal error:', error);
        throw error; // Let Lambda retry
    }
};

/**
 * Check if queue depth for a clinic exceeds the backup alert threshold.
 * If it does, send a push notification to all clinic staff.
 */
async function checkQueueBackup(clinicId: string, clinicName: string): Promise<void> {
    const threshold = CHIME_CONFIG.PUSH.QUEUE_BACKUP_ALERT_THRESHOLD;

    try {
        // Count active calls in queue (ringing or queued status)
        const { Items: queuedCalls } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            KeyConditionExpression: 'clinicId = :clinicId',
            FilterExpression: '#status IN (:ringing, :queued, :waiting)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':clinicId': clinicId,
                ':ringing': 'ringing',
                ':queued': 'queued',
                ':waiting': 'waiting',
            },
            Select: 'COUNT',
        }));

        const queueDepth = queuedCalls?.length ?? 0;

        if (queueDepth >= threshold) {
            console.log(`[queue-monitor] Queue backup detected for ${clinicId}: ${queueDepth} calls (threshold: ${threshold})`);

            await sendClinicAlert(
                clinicId,
                'Queue Backup Alert',
                `${queueDepth} calls waiting — queue exceeds threshold of ${threshold}`,
                {
                    alertType: 'queue_backup',
                    queueDepth,
                    threshold,
                    clinicName,
                },
            );
        }
    } catch (err) {
        console.warn(`[queue-monitor] Failed to check queue backup for ${clinicId}:`, err);
    }
}

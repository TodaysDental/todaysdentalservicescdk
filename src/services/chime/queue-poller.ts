import { ScheduledEvent } from 'aws-lambda';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient } from '@aws-sdk/client-chime-sdk-voice';
import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createCheckQueueForWork } from './utils/check-queue-for-work';

const ddb = getDynamoDBClient();
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const chimeVoiceClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });

const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME!;

// Initialize dispatcher
const checkQueueForWorkFn = createCheckQueueForWork({
    ddb,
    callQueueTableName: CALL_QUEUE_TABLE_NAME,
    agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
    chime,
    chimeVoiceClient,
});

/**
 * QUEUE POLLER (Improvement #2)
 *
 * Periodic safety-net Lambda (EventBridge — every 1 minute) that rescues
 * orphaned queued calls. Event-driven dispatch handles the happy path,
 * but calls can become stuck if:
 *   - All agents were busy when the call arrived and the event was lost
 *   - An agent status update event was missed
 *   - A ring timed out but the timeout handler failed to re-queue
 *
 * This poller scans for clinics with `status = queued` calls, then invokes
 * the same `dispatchForClinic()` logic used by the event-driven path.
 * The distributed lock on each clinic ensures safe concurrent execution.
 */
export const handler = async (_event: ScheduledEvent): Promise<void> => {
    console.log('[queue-poller] Starting periodic queue poll');

    try {
        // Find all clinics with queued calls
        const clinicIds = await getClinicsWithQueuedCalls();
        if (clinicIds.length === 0) {
            console.log('[queue-poller] No clinics with queued calls');
            return;
        }

        console.log(`[queue-poller] Found ${clinicIds.length} clinics with queued calls:`, clinicIds);

        // For each clinic, find an online agent (any) and invoke the dispatcher
        // We need at least one agent's agentInfo to call checkQueueForWork
        const results = await Promise.allSettled(
            clinicIds.map(async (clinicId) => {
                // Find any online agent for this clinic to use as trigger
                const { Items: onlineAgents } = await ddb.send(new QueryCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    IndexName: 'status-index',
                    KeyConditionExpression: '#status = :status',
                    FilterExpression: 'contains(activeClinicIds, :clinicId)',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':status': 'Online',
                        ':clinicId': clinicId,
                    },
                    ProjectionExpression: 'agentId, activeClinicIds',
                    Limit: 1,
                }));

                if (!onlineAgents || onlineAgents.length === 0) {
                    console.log(`[queue-poller] No online agents for clinic ${clinicId}, skipping`);
                    return;
                }

                const agent = onlineAgents[0];
                console.log(`[queue-poller] Dispatching for clinic ${clinicId} via agent ${agent.agentId}`);
                await checkQueueForWorkFn(agent.agentId, agent);
            })
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`[queue-poller] Complete: ${succeeded} succeeded, ${failed} failed out of ${clinicIds.length} clinics`);
    } catch (error) {
        console.error('[queue-poller] Fatal error:', error);
        throw error; // Let Lambda retry
    }
};

/**
 * Find all clinic IDs that currently have calls in `queued` status.
 * Uses a Scan with FilterExpression (acceptable for low-volume polling).
 */
async function getClinicsWithQueuedCalls(): Promise<string[]> {
    const clinicIdSet = new Set<string>();

    let lastKey: Record<string, any> | undefined;
    do {
        const result = await ddb.send(new ScanCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            FilterExpression: '#status = :queued',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':queued': 'queued' },
            ProjectionExpression: 'clinicId',
            ExclusiveStartKey: lastKey,
        }));

        if (result.Items) {
            for (const item of result.Items) {
                if (item.clinicId) clinicIdSet.add(item.clinicId);
            }
        }
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return Array.from(clinicIdSet);
}

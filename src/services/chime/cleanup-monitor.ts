import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';
import { MeetingLifecycleManager } from './utils/meeting-lifecycle';
import { ConsistencyChecker } from './utils/consistency-checker';
import { StateTimeoutManager } from './utils/state-timeouts';

const ddb = getDynamoDBClient();
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });
const chimeVoice = new ChimeSDKVoiceClient({});

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

// Initialize utility managers
const meetingLifecycle = new MeetingLifecycleManager(ddb, chime, CALL_QUEUE_TABLE_NAME!);
const consistencyChecker = new ConsistencyChecker(ddb, AGENT_PRESENCE_TABLE_NAME!, CALL_QUEUE_TABLE_NAME!);
const stateTimeoutManager = new StateTimeoutManager(ddb, chime, CALL_QUEUE_TABLE_NAME!, AGENT_PRESENCE_TABLE_NAME!);

// Thresholds for cleanup
const STALE_HEARTBEAT_MINUTES = 15; // Agent hasn't sent a heartbeat
const STALE_RINGING_DIALING_MINUTES = 5; // Agent stuck ringing or dialing
const STALE_QUEUED_CALL_MINUTES = 30; // Call stuck in queue (with a meeting) for 30+ mins
const ABANDONED_RINGING_CALL_MINUTES = 10; // Call stuck ringing (no answer) for 10+ mins
const MAX_CONNECTED_CALL_MINUTES = 60; // Hard limit for active meetings
const AUTO_HANGUP_COOLDOWN_MS = 5 * 60 * 1000; // Avoid duplicate hangup requests

export const handler = async (event: ScheduledEvent): Promise<void> => {
    console.log('[cleanup-monitor] Starting cleanup monitor run', {
        time: new Date().toISOString(),
        eventSource: event.source
    });

    let cleanupStats = {
        staleAgents: 0,
        orphanedMeetings: 0,
        abandonedCalls: 0,
        longRunningHangups: 0,
        stateTimeouts: 0,
        errors: 0
    };

    try {
        // 1. Clean up stale agent presence records
        await cleanupStaleAgentPresence(cleanupStats);
        
        // 2. CRITICAL FIX #12: Use MeetingLifecycleManager for orphaned meetings
        try {
            const meetingResult = await meetingLifecycle.cleanupOrphanedMeetings();
            cleanupStats.orphanedMeetings = meetingResult.cleanedCount;
            console.log('[cleanup-monitor] Meeting lifecycle cleanup:', meetingResult);
        } catch (meetingErr) {
            console.error('[cleanup-monitor] Meeting lifecycle error:', meetingErr);
            cleanupStats.errors++;
        }
        
        // 3. Clean up abandoned calls (ringing/dialing, NO meeting delete)
        await cleanupAbandonedCalls(cleanupStats);

        // 4. Hang up any meetings that exceeded the hard cap
        await cleanupLongRunningCalls(cleanupStats);
        
        // 5. CRITICAL FIX #13: Run consistency checker to reconcile states
        try {
            const consistencyReport = await consistencyChecker.checkAndReconcile();
            console.log('[cleanup-monitor] Consistency check:', {
                checked: consistencyReport.totalChecked,
                found: consistencyReport.inconsistenciesFound,
                reconciled: consistencyReport.reconciled,
                manualReview: consistencyReport.manualReviewNeeded.length
            });
            
            // Alert if many inconsistencies found
            if (consistencyReport.inconsistenciesFound > 10) {
                console.warn('[cleanup-monitor] HIGH INCONSISTENCY COUNT detected:', 
                           consistencyReport.inconsistenciesFound);
            }
        } catch (consistencyErr) {
            console.error('[cleanup-monitor] Consistency check error:', consistencyErr);
            cleanupStats.errors++;
        }
        
        // 6. FIX #14: Run state timeout manager to transition hung states
        try {
            const stateTimeoutResult = await stateTimeoutManager.checkAndTransitionTimedOutStates();
            cleanupStats.stateTimeouts = stateTimeoutResult.transitioned;
            console.log('[cleanup-monitor] State timeout check:', {
                transitioned: stateTimeoutResult.transitioned,
                errors: stateTimeoutResult.errors.length
            });
            
            if (stateTimeoutResult.errors.length > 0) {
                console.error('[cleanup-monitor] State timeout errors:', stateTimeoutResult.errors);
            }
        } catch (stateTimeoutErr) {
            console.error('[cleanup-monitor] State timeout check error:', stateTimeoutErr);
            cleanupStats.errors++;
        }
        
        console.log('[cleanup-monitor] Cleanup completed', cleanupStats);
        
    } catch (error) {
        console.error('[cleanup-monitor] Error during cleanup:', error);
        cleanupStats.errors++;
    }
};

async function cleanupStaleAgentPresence(stats: any): Promise<void> {
    console.log('[cleanup-monitor] Checking for stale agent presence records');
    
    if (!AGENT_PRESENCE_TABLE_NAME) {
        console.warn('[cleanup-monitor] AGENT_PRESENCE_TABLE_NAME not configured');
        return;
    }

    try {
        const now = new Date();
        const staleHeartbeatCutoff = new Date(now.getTime() - (STALE_HEARTBEAT_MINUTES * 60 * 1000)).toISOString();
        const staleRingDialCutoff = new Date(now.getTime() - (STALE_RINGING_DIALING_MINUTES * 60 * 1000)).toISOString();
        
        console.log(`[cleanup-monitor] Using cutoffs: Heartbeat < ${staleHeartbeatCutoff}, Ring/Dial < ${staleRingDialCutoff}`);

        const { Items: staleAgents } = await ddb.send(new ScanCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            FilterExpression: '(#s = :online AND lastHeartbeatAt < :heartbeatCutoff) OR ' + 
                              '(#s = :ringing AND ringingCallTime < :ringDialCutoff) OR ' +
                              '(#s = :dialing AND lastActivityAt < :ringDialCutoff)',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':online': 'Online',
                ':ringing': 'ringing',
                ':dialing': 'dialing',
                ':heartbeatCutoff': staleHeartbeatCutoff,
                ':ringDialCutoff': staleRingDialCutoff
            }
        }));

        if (staleAgents && staleAgents.length > 0) {
            console.log(`[cleanup-monitor] Found ${staleAgents.length} stale agent presence records`);
            
            // **FLAW #8 FIX: Use BatchWriteCommand instead of individual UpdateCommand calls**
            // Instead of 1000 API calls for 1000 agents, batch into groups of 25
            // Reduces from 1000 calls to 40 calls (~25x reduction)
            await batchCleanupStaleAgents(staleAgents, stats);
        } else {
            console.log('[cleanup-monitor] No stale agent presence records found');
        }
    } catch (error) {
        console.error('[cleanup-monitor] Error during stale agent cleanup:', error);
        stats.errors++;
    }
}

async function cleanupOrphanedMeetings(stats: any): Promise<void> {
    console.log('[cleanup-monitor] Checking for orphaned QUEUE meetings');
    
    if (!CALL_QUEUE_TABLE_NAME) {
        console.warn('[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured');
        return;
    }

    try {
        const cutoffISOString = new Date(Date.now() - (STALE_QUEUED_CALL_MINUTES * 60 * 1000)).toISOString();
        
        console.log(`[cleanup-monitor] Using queued call cutoff time: ${cutoffISOString}`);

        // **CRITICAL FIX**: Only find calls where status is 'queued'
        // These are the only calls with temporary meetings that need cleanup.
        const { Items: callsWithMeetings } = await ddb.send(new ScanCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            FilterExpression: '#s = :queued AND queueEntryTimeIso < :cutoff AND attribute_exists(meetingInfo)',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':queued': 'queued',
                ':cutoff': cutoffISOString
            }
        }));

        if (callsWithMeetings && callsWithMeetings.length > 0) {
            console.log(`[cleanup-monitor] Found ${callsWithMeetings.length} calls with orphaned queue meetings`);
            
            for (const call of callsWithMeetings) {
                const recordKey = { clinicId: call.clinicId, queuePosition: call.queuePosition };
                let priorMeetingId: string | undefined;
                try {
                    const updateResult = await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: recordKey,
                        UpdateExpression: 'SET #s = :abandoned, cleanupReason = :reason REMOVE meetingInfo, customerAttendeeInfo',
                        ExpressionAttributeNames: { '#s': 'status' },
                        ExpressionAttributeValues: {
                            ':abandoned': 'abandoned',
                            ':reason': 'orphaned_queue_meeting_cleanup',
                            ':queued': 'queued'
                        },
                        ConditionExpression: '#s = :queued',
                        ReturnValues: 'ALL_OLD'
                    }));
                    priorMeetingId = updateResult.Attributes?.meetingInfo?.MeetingId || call.meetingInfo?.MeetingId;
                } catch (updateErr: any) {
                    if (updateErr.name === 'ConditionalCheckFailedException') {
                        console.log(`[cleanup-monitor] Skipping meeting cleanup for call ${call.callId} - status changed`);
                        continue;
                    }
                    console.error(`[cleanup-monitor] Error updating call ${call.callId} before meeting cleanup:`, updateErr);
                    stats.errors++;
                    continue;
                }

                if (priorMeetingId) {
                    try {
                        await chime.send(new DeleteMeetingCommand({ MeetingId: priorMeetingId }));
                    } catch (meetingErr: any) {
                        if (meetingErr.name !== 'NotFoundException') {
                            console.error(`[cleanup-monitor] Error deleting meeting ${priorMeetingId}:`, meetingErr);
                            stats.errors++;
                        }
                    }
                }

                stats.orphanedMeetings++;
                console.log(`[cleanup-monitor] Cleaned up orphaned queue meeting for call ${call.callId} (meetingId=${priorMeetingId || 'unknown'})`);
            }
        } else {
            console.log('[cleanup-monitor] No orphaned queue meetings found');
        }
    } catch (error) {
        console.error('[cleanup-monitor] Error during orphaned meeting cleanup:', error);
        stats.errors++;
    }
}

async function cleanupLongRunningCalls(stats: any): Promise<void> {
    console.log(`[cleanup-monitor] Checking for active calls exceeding ${MAX_CONNECTED_CALL_MINUTES} minutes`);

    if (!CALL_QUEUE_TABLE_NAME) {
        console.warn('[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured');
        return;
    }

    try {
        const { Items: activeCalls } = await ddb.send(new ScanCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            FilterExpression: '#s = :connected OR #s = :onHold',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':connected': 'connected',
                ':onHold': 'on_hold'
            }
        }));

        if (!activeCalls || activeCalls.length === 0) {
            console.log('[cleanup-monitor] No connected/on-hold calls found');
            return;
        }

        const nowMs = Date.now();
        const thresholdMs = MAX_CONNECTED_CALL_MINUTES * 60 * 1000;
        let forcedCalls = 0;

        for (const call of activeCalls) {
            const acceptedTimestamp = parseTimestampMs(call.acceptedAt ?? call.acceptedAtIso);
            if (!acceptedTimestamp) {
                continue;
            }

            const callAgeMs = nowMs - acceptedTimestamp;
            if (callAgeMs < thresholdMs) {
                continue;
            }

            if (hasRecentAutoHangupRequest(call, nowMs)) {
                continue;
            }

            await requestHangupForCall(call, callAgeMs, stats);
            forcedCalls++;
        }

        if (forcedCalls === 0) {
            console.log('[cleanup-monitor] No calls exceeded the max duration threshold');
        }
    } catch (error) {
        console.error('[cleanup-monitor] Error while checking for long running calls:', error);
        stats.errors++;
    }
}

async function requestHangupForCall(callRecord: any, callAgeMs: number, stats: any): Promise<void> {
    if (!CALL_QUEUE_TABLE_NAME) {
        console.warn('[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured');
        return;
    }

    const callId = callRecord.callId;
    const clinicId = callRecord.clinicId;
    const queuePosition = callRecord.queuePosition;

    if (!callId || !clinicId || typeof queuePosition === 'undefined') {
        console.warn('[cleanup-monitor] Incomplete call record. Unable to request hangup.', {
            callId,
            clinicId,
            queuePosition
        });
        return;
    }

    const smaId = getSmaIdForClinic(clinicId);
    if (!smaId) {
        console.warn(`[cleanup-monitor] No SMA mapping for clinic ${clinicId}. Cannot hang up call ${callId}`);
        return;
    }

    const minutes = (callAgeMs / 60000).toFixed(1);
    console.log(`[cleanup-monitor] Auto hanging call ${callId} for clinic ${clinicId} after ${minutes} minutes`, {
        assignedAgentId: callRecord.assignedAgentId,
        status: callRecord.status
    });

    try {
        await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
            SipMediaApplicationId: smaId,
            TransactionId: callId,
            Arguments: {
                Action: 'Hangup'
            }
        }));
    } catch (error) {
        console.error(`[cleanup-monitor] Failed to submit hangup for call ${callId}:`, error);
        stats.errors++;
        return;
    }

    try {
        await ddb.send(new UpdateCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: {
                clinicId,
                queuePosition
            },
            UpdateExpression: 'SET cleanupReason = :reason, autoHangupRequestedAt = :now, autoHangupDurationSeconds = :duration',
            ExpressionAttributeValues: {
                ':reason': 'auto_hangup_max_duration',
                ':now': new Date().toISOString(),
                ':duration': Math.floor(callAgeMs / 1000)
            }
        }));
    } catch (annotationErr) {
        console.warn(`[cleanup-monitor] Unable to annotate call ${callId} after auto hangup:`, annotationErr);
    }

    stats.longRunningHangups++;
}

function parseTimestampMs(value: any): number | undefined {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? undefined : parsed;
    }

    if (typeof value === 'number') {
        return value > 1e12 ? value : value * 1000;
    }

    return undefined;
}

function hasRecentAutoHangupRequest(callRecord: any, nowMs: number): boolean {
    const requestedAt = parseTimestampMs(callRecord.autoHangupRequestedAt);
    if (requestedAt === undefined) {
        return false;
    }
    return (nowMs - requestedAt) < AUTO_HANGUP_COOLDOWN_MS;
}

async function cleanupAbandonedCalls(stats: any): Promise<void> {
    console.log('[cleanup-monitor] Checking for abandoned ringing/dialing calls');
    
    if (!CALL_QUEUE_TABLE_NAME) {
        console.warn('[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured');
        return;
    }

    try {
        const cutoffISOString = new Date(Date.now() - (ABANDONED_RINGING_CALL_MINUTES * 60 * 1000)).toISOString();
        
        console.log(`[cleanup-monitor] Using abandoned call cutoff: ${cutoffISOString}`);

        // Find calls that have been in 'ringing' or 'dialing' state for too long
        const { Items: abandonedCalls } = await ddb.send(new ScanCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            FilterExpression: '(#s = :ringing OR #s = :dialing) AND queueEntryTimeIso < :cutoff',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
                ':ringing': 'ringing',
                ':dialing': 'dialing',
                ':cutoff': cutoffISOString
            }
        }));

        if (abandonedCalls && abandonedCalls.length > 0) {
            console.log(`[cleanup-monitor] Found ${abandonedCalls.length} abandoned calls`);
            
            for (const call of abandonedCalls) {
                try {
                    // 1. Mark call as abandoned
                    // ** DO NOT REMOVE meetingInfo ** (it's the agent's session)
                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { 
                            clinicId: call.clinicId, 
                            queuePosition: call.queuePosition 
                        },
                        UpdateExpression: 'SET #s = :abandoned, endedAtIso = :now, cleanupReason = :reason',
                        ExpressionAttributeNames: { '#s': 'status' },
                        ExpressionAttributeValues: {
                            ':abandoned': 'abandoned',
                            ':now': new Date().toISOString(),
                            ':reason': `abandoned_${call.status}_cleanup`
                        }
                    }));
                    
                    // 2. Clean up any agents stuck on this call
                    const agentIdsToClear: string[] = [];
                    if (call.status === 'dialing' && call.assignedAgentId) {
                        agentIdsToClear.push(call.assignedAgentId);
                    } else if (call.status === 'ringing' && Array.isArray(call.agentIds)) {
                        agentIdsToClear.push(...call.agentIds);
                    }
                    
                    for (const agentId of agentIdsToClear) {
                        try {
                            const updateExpr = call.status === 'dialing'
                                ? 'SET #s = :online, lastActivityAt = :now REMOVE currentCallId, callStatus'
                                : 'SET #s = :online, lastActivityAt = :now REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode';
                                
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME!,
                                Key: { agentId },
                                UpdateExpression: updateExpr,
                                ConditionExpression: call.status === 'dialing' ? 'currentCallId = :callId' : 'ringingCallId = :callId',
                                ExpressionAttributeNames: { '#s': 'status' },
                                ExpressionAttributeValues: {
                                    ':callId': call.callId,
                                    ':online': 'Online',
                                    ':now': new Date().toISOString()
                                }
                            }));
                            console.log(`[cleanup-monitor] Reset agent ${agentId} from stuck call ${call.callId}`);
                        } catch (agentErr: any) {
                            if (agentErr.name !== 'ConditionalCheckFailedException') {
                                console.warn(`[cleanup-monitor] Error clearing ringing/dialing agent ${agentId}:`, agentErr);
                            }
                        }
                    }
                    
                    stats.abandonedCalls++;
                    console.log(`[cleanup-monitor] Cleaned up abandoned call: ${call.callId} (was ${call.status})`);
                    
                } catch (callErr) {
                    console.error(`[cleanup-monitor] Error cleaning up abandoned call ${call.callId}:`, callErr);
                    stats.errors++;
                }
            }
        } else {
            console.log('[cleanup-monitor] No abandoned calls found');
        }
    } catch (error) {
        console.error('[cleanup-monitor] Error during abandoned call cleanup:', error);
        stats.errors++;
    }
}

/**
 * **FLAW #8 FIX: Batch cleanup using BatchWriteCommand**
 * 
 * Instead of sending 1 UpdateCommand per agent (1000 agents = 1000 API calls),
 * batch updates into groups of 25 using BatchWriteCommand (1000 agents = 40 API calls).
 * 
 * DynamoDB BatchWriteItem allows up to 25 requests per batch, each batch = 1 API call.
 * This reduces cost by 25x and improves performance by reducing latency.
 */
async function batchCleanupStaleAgents(staleAgents: any[], stats: any): Promise<void> {
    if (!AGENT_PRESENCE_TABLE_NAME) {
        console.warn('[cleanup-monitor] AGENT_PRESENCE_TABLE_NAME not configured');
        return;
    }

    const BATCH_SIZE = 25; // DynamoDB BatchWriteItem limit
    const now = new Date().toISOString();

    // Group agents into batches of 25
    for (let i = 0; i < staleAgents.length; i += BATCH_SIZE) {
        const batch = staleAgents.slice(i, i + BATCH_SIZE);
        
        try {
            // Build batch write requests for this group
            const writeRequests = batch.map(agent => ({
                Update: {
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId: agent.agentId },
                    UpdateExpression: 'SET #s = :offline, lastActivityAt = :now, cleanupReason = :reason ' + 
                                      'REMOVE ringingCallId, currentCallId, callStatus, inboundMeetingInfo, ' + 
                                      'inboundAttendeeInfo, ringingCallTime, ringingCallFrom, ringingCallNotes, ' +
                                      'ringingCallTransferAgentId, ringingCallTransferMode, currentMeetingAttendeeId, ' +
                                      'heldCallMeetingId, heldCallId, heldCallAttendeeId',
                    ExpressionAttributeNames: { '#s': 'status' },
                    ExpressionAttributeValues: {
                        ':offline': 'Offline',
                        ':now': now,
                        ':reason': `stale_${agent.status}_cleanup`
                    }
                }
            }));

            // Send batch (all 25 updates in single API call)
            await ddb.send(new BatchWriteCommand({
                RequestItems: {
                    [AGENT_PRESENCE_TABLE_NAME]: writeRequests
                }
            }));

            stats.staleAgents += batch.length;
            console.log(`[cleanup-monitor] Batch cleaned ${batch.length} stale agents (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
            
        } catch (batchErr) {
            console.error(`[cleanup-monitor] Error cleaning batch of agents starting at index ${i}:`, batchErr);
            stats.errors++;
            // Continue processing remaining batches
        }
    }

    console.log(`[cleanup-monitor] Completed batch cleanup of ${staleAgents.length} stale agents in ${Math.ceil(staleAgents.length / BATCH_SIZE)} API calls`);
}

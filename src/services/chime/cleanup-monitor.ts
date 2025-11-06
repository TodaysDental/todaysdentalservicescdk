import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

// Thresholds for cleanup
const STALE_HEARTBEAT_MINUTES = 15; // Agent hasn't sent a heartbeat
const STALE_RINGING_DIALING_MINUTES = 5; // Agent stuck ringing or dialing
const STALE_QUEUED_CALL_MINUTES = 30; // Call stuck in queue (with a meeting) for 30+ mins
const ABANDONED_RINGING_CALL_MINUTES = 10; // Call stuck ringing (no answer) for 10+ mins

export const handler = async (event: ScheduledEvent): Promise<void> => {
    console.log('[cleanup-monitor] Starting cleanup monitor run', {
        time: new Date().toISOString(),
        eventSource: event.source
    });

    let cleanupStats = {
        staleAgents: 0,
        orphanedMeetings: 0,
        abandonedCalls: 0,
        errors: 0
    };

    try {
        // 1. Clean up stale agent presence records
        await cleanupStaleAgentPresence(cleanupStats);
        
        // 2. Clean up orphaned QUEUE meetings (Safe for Agent-Centric model)
        await cleanupOrphanedMeetings(cleanupStats);
        
        // 3. Clean up abandoned calls (ringing/dialing, NO meeting delete)
        await cleanupAbandonedCalls(cleanupStats);
        
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
            
            for (const agent of staleAgents) {
                try {
                    // Mark agent as Offline and clean up all call-related fields
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId: agent.agentId },
                        UpdateExpression: 'SET #s = :offline, lastActivityAt = :now, cleanupReason = :reason ' + 
                                          'REMOVE ringingCallId, currentCallId, callStatus, inboundMeetingInfo, ' + 
                                          'inboundAttendeeInfo, ringingCallTime, ringingCallFrom, ' + 
                                          'currentMeetingAttendeeId, heldCallMeetingId, heldCallId, heldCallAttendeeId',
                        ExpressionAttributeNames: { '#s': 'status' },
                        ExpressionAttributeValues: {
                            ':offline': 'Offline',
                            ':now': new Date().toISOString(),
                            ':reason': `stale_${agent.status}_cleanup`
                        }
                    }));
                    
                    stats.staleAgents++;
                    console.log(`[cleanup-monitor] Cleaned up stale agent: ${agent.agentId} (was ${agent.status})`);
                } catch (agentErr) {
                    console.error(`[cleanup-monitor] Error cleaning up agent ${agent.agentId}:`, agentErr);
                    stats.errors++;
                }
            }
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
                if (call.meetingInfo?.MeetingId) {
                    try {
                        // 1. Attempt to delete the meeting
                        await chime.send(new DeleteMeetingCommand({ 
                            MeetingId: call.meetingInfo.MeetingId 
                        }));
                        
                        // 2. Update call record to 'abandoned' and remove meeting info
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { 
                                clinicId: call.clinicId, 
                                queuePosition: call.queuePosition 
                            },
                            UpdateExpression: 'SET #s = :abandoned, cleanupReason = :reason REMOVE meetingInfo, customerAttendeeInfo',
                            ExpressionAttributeNames: { '#s': 'status' },
                            ExpressionAttributeValues: {
                                ':abandoned': 'abandoned',
                                ':reason': 'orphaned_queue_meeting_cleanup'
                            }
                        }));
                        
                        stats.orphanedMeetings++;
                        console.log(`[cleanup-monitor] Cleaned up orphaned queue meeting: ${call.meetingInfo.MeetingId} for call ${call.callId}`);
                        
                    } catch (meetingErr: any) {
                        if (meetingErr.name === 'NotFoundException') {
                            // Meeting already gone, just update DB
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { 
                                    clinicId: call.clinicId, 
                                    queuePosition: call.queuePosition 
                                },
                                UpdateExpression: 'SET #s = :abandoned, cleanupReason = :reason REMOVE meetingInfo, customerAttendeeInfo',
                                ExpressionAttributeNames: { '#s': 'status' },
                                ExpressionAttributeValues: {
                                     ':abandoned': 'abandoned',
                                    ':reason': 'orphaned_queue_meeting_cleanup (not_found)'
                                }
                            }));
                            stats.orphanedMeetings++;
                        } else {
                            console.error(`[cleanup-monitor] Error cleaning up meeting ${call.meetingInfo.MeetingId}:`, meetingErr);
                            stats.errors++;
                        }
                    }
                }
            }
        } else {
            console.log('[cleanup-monitor] No orphaned queue meetings found');
        }
    } catch (error) {
        console.error('[cleanup-monitor] Error during orphaned meeting cleanup:', error);
        stats.errors++;
    }
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
                                ? 'REMOVE currentCallId, callStatus SET #s = :online, lastActivityAt = :now'
                                : 'REMOVE ringingCallId, ringingCallTime, ringingCallFrom SET #s = :online, lastActivityAt = :now';
                            
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
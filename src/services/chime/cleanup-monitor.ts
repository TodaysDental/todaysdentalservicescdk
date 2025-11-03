import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';

/**
 * Cleanup Monitor Lambda
 * Runs periodically to clean up orphaned meetings, stale agent presence, and abandoned calls
 * This prevents resource leaks and inconsistent state in the call handling system
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

// Thresholds for cleanup
const STALE_AGENT_PRESENCE_MINUTES = 30; // Agent hasn't been active for 30+ minutes
const ORPHANED_CALL_MINUTES = 15; // Call has been in invalid state for 15+ minutes
const ABANDONED_QUEUE_MINUTES = 10; // Call has been queued with no activity for 10+ minutes

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
        
        // 2. Clean up orphaned meetings
        await cleanupOrphanedMeetings(cleanupStats);
        
        // 3. Clean up abandoned calls
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
        // CRITICAL FIX: Use ISO string format consistently for agent timestamps
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - (STALE_AGENT_PRESENCE_MINUTES * 60 * 1000));
        const cutoffISO = cutoffTime.toISOString();
        
        console.log(`[cleanup-monitor] Using agent cutoff time ${cutoffISO}`);

        // CRITICAL FIX: Check for lastHeartbeatAt specifically instead of general lastActivityAt
        // This prevents false cleanup of agents that are still active but haven't sent a heartbeat
        const { Items: staleAgents } = await ddb.send(new ScanCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            FilterExpression: '#status = :onlineStatus AND (attribute_not_exists(lastHeartbeatAt) OR lastHeartbeatAt < :cutoff)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':onlineStatus': 'Online',
                ':cutoff': cutoffISO
            }
        }));

        if (staleAgents && staleAgents.length > 0) {
            console.log(`[cleanup-monitor] Found ${staleAgents.length} stale agent presence records`);
            
            for (const agent of staleAgents) {
                try {
                    // Mark agent as Offline and clean up call-related fields
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId: agent.agentId },
                        UpdateExpression: 'SET #status = :offlineStatus, lastActivityAt = :timestamp, cleanupReason = :reason REMOVE ringingCallId, currentCallId, callStatus, inboundMeetingInfo, inboundAttendeeInfo',
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':offlineStatus': 'Offline',
                            ':timestamp': new Date().toISOString(),
                            ':reason': 'stale_presence_cleanup'
                        }
                    }));
                    
                    stats.staleAgents++;
                    console.log(`[cleanup-monitor] Cleaned up stale agent: ${agent.agentId}`);
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
    console.log('[cleanup-monitor] Checking for orphaned meetings');
    
    if (!CALL_QUEUE_TABLE_NAME) {
        console.warn('[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured');
        return;
    }

    try {
        // CRITICAL FIX: Standardize timestamp formats by using ISO strings consistently
        // Calculate cutoff time as ISO string
        const cutoffDate = new Date();
        cutoffDate.setMinutes(cutoffDate.getMinutes() - ORPHANED_CALL_MINUTES);
        const cutoffISOString = cutoffDate.toISOString();
        
        // Also calculate as Unix timestamp for backward compatibility
        const nowTimestamp = Math.floor(Date.now() / 1000);
        const cutoffTimestamp = nowTimestamp - (ORPHANED_CALL_MINUTES * 60);
        
        console.log(`[cleanup-monitor] Using cutoff timestamp: ${cutoffISOString} (${cutoffTimestamp} in Unix time)`);

        // Find calls with meetings that are in terminal states but meetings weren't cleaned up
        const { Items: callsWithMeetings } = await ddb.send(new ScanCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            // Create more precise conditions to handle both ISO strings and Unix timestamps
            // CRITICAL FIX: Replace invalid attribute_type with correct attribute_exists logic
            FilterExpression: 'attribute_exists(meetingInfo) AND (#status IN (:completed, :abandoned, :failed) OR ' +
                            '(attribute_exists(endedAt) AND ' +
                            '((endedAt < :cutoffUnix) OR ' +  
                            '(endedAt < :cutoffISO))))',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':completed': 'completed',
                ':abandoned': 'abandoned',
                ':failed': 'failed',
                ':cutoffUnix': cutoffTimestamp,
                ':cutoffISO': cutoffISOString
            }
        }));

        if (callsWithMeetings && callsWithMeetings.length > 0) {
            console.log(`[cleanup-monitor] Found ${callsWithMeetings.length} calls with potentially orphaned meetings`);
            
            for (const call of callsWithMeetings) {
                if (call.meetingInfo?.MeetingId) {
                    try {
                        // Attempt to delete the meeting
                        await chime.send(new DeleteMeetingCommand({ 
                            MeetingId: call.meetingInfo.MeetingId 
                        }));
                        
                        // Remove meeting info from call record
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { 
                                clinicId: call.clinicId, 
                                queuePosition: call.queuePosition 
                            },
                            UpdateExpression: 'REMOVE meetingInfo, customerAttendeeInfo SET cleanupReason = :reason',
                            ExpressionAttributeValues: {
                                ':reason': 'orphaned_meeting_cleanup'
                            }
                        }));
                        
                        stats.orphanedMeetings++;
                        console.log(`[cleanup-monitor] Cleaned up orphaned meeting: ${call.meetingInfo.MeetingId} for call ${call.callId}`);
                        
                    } catch (meetingErr: any) {
                        // Meeting might not exist anymore, which is fine
                        if (meetingErr.name === 'NotFoundException') {
                            // Just remove from DB
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { 
                                    clinicId: call.clinicId, 
                                    queuePosition: call.queuePosition 
                                },
                                UpdateExpression: 'REMOVE meetingInfo, customerAttendeeInfo SET cleanupReason = :reason',
                                ExpressionAttributeValues: {
                                    ':reason': 'nonexistent_meeting_cleanup'
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
            console.log('[cleanup-monitor] No orphaned meetings found');
        }
    } catch (error) {
        console.error('[cleanup-monitor] Error during orphaned meeting cleanup:', error);
        stats.errors++;
    }
}

async function cleanupAbandonedCalls(stats: any): Promise<void> {
    console.log('[cleanup-monitor] Checking for abandoned calls');
    
    if (!CALL_QUEUE_TABLE_NAME) {
        console.warn('[cleanup-monitor] CALL_QUEUE_TABLE_NAME not configured');
        return;
    }

    try {
        // CRITICAL FIX: Use consistent ISO string format for timestamps
        const cutoffDate = new Date();
        cutoffDate.setMinutes(cutoffDate.getMinutes() - ABANDONED_QUEUE_MINUTES);
        const cutoffISOString = cutoffDate.toISOString();
        
        // Also calculate Unix timestamp for backward compatibility
        const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000);
        
        console.log(`[cleanup-monitor] Using abandoned call cutoff: ${cutoffISOString} (${cutoffTimestamp} in Unix time)`);

        // Find calls that have been in queue/ringing state for too long
        const { Items: abandonedCalls } = await ddb.send(new ScanCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            // CRITICAL FIX: Replace invalid attribute_type with simpler expression
            FilterExpression: '(#status = :queued OR #status = :ringing OR #status = :dialing) AND ' +
                             '(queueEntryTime < :cutoffUnix OR ' +
                             'queueEntryTimeIso < :cutoffISO)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':queued': 'queued',
                ':ringing': 'ringing',
                ':dialing': 'dialing',
                ':cutoffUnix': cutoffTimestamp,
                ':cutoffISO': cutoffISOString
            }
        }));

        if (abandonedCalls && abandonedCalls.length > 0) {
            console.log(`[cleanup-monitor] Found ${abandonedCalls.length} abandoned calls`);
            
            for (const call of abandonedCalls) {
                try {
                    // Mark call as abandoned and clean up meeting if exists
                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { 
                            clinicId: call.clinicId, 
                            queuePosition: call.queuePosition 
                        },
                        // CRITICAL FIX: Use consistent timestamp formats (both Unix and ISO)
                        UpdateExpression: 'SET #status = :abandonedStatus, endedAt = :timestamp, endedAtIso = :timestampIso, cleanupReason = :reason',
                        ExpressionAttributeNames: { '#status': 'status' },
                        ExpressionAttributeValues: {
                            ':abandonedStatus': 'abandoned',
                            ':timestamp': Math.floor(Date.now() / 1000), // Keep Unix timestamp for backward compatibility
                            ':timestampIso': new Date().toISOString(),  // Add ISO format for consistency
                            ':reason': 'timeout_cleanup'
                        }
                    }));
                    
                    // Clean up meeting if it exists
                    if (call.meetingInfo?.MeetingId) {
                        try {
                            await chime.send(new DeleteMeetingCommand({ 
                                MeetingId: call.meetingInfo.MeetingId 
                            }));
                        } catch (meetingErr: any) {
                            if (meetingErr.name !== 'NotFoundException') {
                                console.warn(`[cleanup-monitor] Error cleaning up meeting for abandoned call ${call.callId}:`, meetingErr);
                            }
                        }
                    }
                    
                    // Clean up any agents who might be ringing for this call
                    if (call.agentIds && Array.isArray(call.agentIds)) {
                        for (const agentId of call.agentIds) {
                            try {
                                await ddb.send(new UpdateCommand({
                                    TableName: AGENT_PRESENCE_TABLE_NAME!,
                                    Key: { agentId },
                                    UpdateExpression: 'REMOVE ringingCallId, inboundMeetingInfo, inboundAttendeeInfo SET lastActivityAt = :timestamp',
                                    ConditionExpression: 'ringingCallId = :callId',
                                    ExpressionAttributeValues: {
                                        ':callId': call.callId,
                                        ':timestamp': new Date().toISOString()
                                    }
                                }));
                            } catch (agentErr: any) {
                                // Ignore conditional check failures (agent already cleared)
                                if (agentErr.name !== 'ConditionalCheckFailedException') {
                                    console.warn(`[cleanup-monitor] Error clearing ringing agent ${agentId}:`, agentErr);
                                }
                            }
                        }
                    }
                    
                    stats.abandonedCalls++;
                    console.log(`[cleanup-monitor] Cleaned up abandoned call: ${call.callId}`);
                    
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

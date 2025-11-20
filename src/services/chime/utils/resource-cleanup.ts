import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand, DeleteAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';

export interface CleanupContext {
    ddb: DynamoDBDocumentClient;
    chime: ChimeSDKMeetingsClient;
    callQueueTableName: string;
    agentPresenceTableName: string;
}

export interface CleanupResult {
    success: boolean;
    orphanedAttendeesRemoved: number;
    callRecordsUpdated: number;
    agentRecordsUpdated: number;
    errors: string[];
}

export async function cleanupOrphanedCallResources(
    ctx: CleanupContext,
    callId: string,
    reason: string
): Promise<CleanupResult> {
    const result: CleanupResult = {
        success: true,
        orphanedAttendeesRemoved: 0,
        callRecordsUpdated: 0,
        agentRecordsUpdated: 0,
        errors: []
    };

    console.log(`[ResourceCleanup] Starting cleanup for call ${callId}, reason: ${reason}`);

    try {
        // 1. Find call record
        const { Items: callRecords } = await ctx.ddb.send(new QueryCommand({
            TableName: ctx.callQueueTableName,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));

        if (!callRecords || callRecords.length === 0) {
            console.warn(`[ResourceCleanup] No call record found for ${callId}`);
            return result;
        }

        const callRecord = callRecords[0];
        const { clinicId, queuePosition, meetingInfo, customerAttendeeInfo, agentAttendeeInfo, assignedAgentId, agentIds } = callRecord;

        // 2. Clean up orphaned attendees if meeting exists
        if (meetingInfo?.MeetingId) {
            const meetingId = meetingInfo.MeetingId;
            
            // Try to remove customer attendee
            if (customerAttendeeInfo?.AttendeeId) {
                try {
                    await ctx.chime.send(new DeleteAttendeeCommand({
                        MeetingId: meetingId,
                        AttendeeId: customerAttendeeInfo.AttendeeId
                    }));
                    result.orphanedAttendeesRemoved++;
                    console.log(`[ResourceCleanup] Removed customer attendee ${customerAttendeeInfo.AttendeeId}`);
                } catch (err: any) {
                    if (err.name !== 'NotFoundException') {
                        result.errors.push(`Failed to remove customer attendee: ${err.message}`);
                    }
                }
            }

            // Try to remove agent attendee
            if (agentAttendeeInfo?.AttendeeId) {
                try {
                    await ctx.chime.send(new DeleteAttendeeCommand({
                        MeetingId: meetingId,
                        AttendeeId: agentAttendeeInfo.AttendeeId
                    }));
                    result.orphanedAttendeesRemoved++;
                    console.log(`[ResourceCleanup] Removed agent attendee ${agentAttendeeInfo.AttendeeId}`);
                } catch (err: any) {
                    if (err.name !== 'NotFoundException') {
                        result.errors.push(`Failed to remove agent attendee: ${err.message}`);
                    }
                }
            }

            // Only delete meeting if it was a queue meeting (status = queued)
            if (callRecord.status === 'queued') {
                try {
                    await ctx.chime.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
                    console.log(`[ResourceCleanup] Deleted queue meeting ${meetingId}`);
                } catch (err: any) {
                    if (err.name !== 'NotFoundException') {
                        result.errors.push(`Failed to delete meeting: ${err.message}`);
                    }
                }
            }
        }

        // 3. Update call record to mark as cleaned up
        try {
            await ctx.ddb.send(new UpdateCommand({
                TableName: ctx.callQueueTableName,
                Key: { clinicId, queuePosition },
                UpdateExpression: 'SET cleanedUp = :true, cleanupReason = :reason, cleanupAt = :now REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo',
                ExpressionAttributeValues: {
                    ':true': true,
                    ':reason': reason,
                    ':now': new Date().toISOString()
                }
            }));
            result.callRecordsUpdated++;
        } catch (err: any) {
            result.errors.push(`Failed to update call record: ${err.message}`);
        }

        // 4. Clean up agent presence records
        const affectedAgents = new Set<string>();
        if (assignedAgentId) affectedAgents.add(assignedAgentId);
        if (agentIds && Array.isArray(agentIds)) {
            agentIds.forEach(id => affectedAgents.add(id));
        }

        for (const agentId of affectedAgents) {
            try {
                await ctx.ddb.send(new UpdateCommand({
                    TableName: ctx.agentPresenceTableName,
                    Key: { agentId },
                    UpdateExpression: 'SET #status = :online, lastActivityAt = :now REMOVE currentCallId, ringingCallId, callStatus, inboundMeetingInfo, inboundAttendeeInfo, ringingCallTime, ringingCallFrom',
                    ConditionExpression: 'currentCallId = :callId OR ringingCallId = :callId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':online': 'Online',
                        ':now': new Date().toISOString(),
                        ':callId': callId
                    }
                }));
                result.agentRecordsUpdated++;
            } catch (err: any) {
                if (err.name !== 'ConditionalCheckFailedException') {
                    result.errors.push(`Failed to clean agent ${agentId}: ${err.message}`);
                }
            }
        }

        if (result.errors.length > 0) {
            result.success = false;
        }

        console.log(`[ResourceCleanup] Cleanup complete for ${callId}:`, result);
        return result;

    } catch (err: any) {
        result.success = false;
        result.errors.push(`Fatal error: ${err.message}`);
        console.error(`[ResourceCleanup] Fatal error cleaning ${callId}:`, err);
        return result;
    }
}

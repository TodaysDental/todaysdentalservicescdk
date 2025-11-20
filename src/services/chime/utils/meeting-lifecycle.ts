/**
 * Meeting Lifecycle Manager
 * Fix 12: Manages the lifecycle of Chime meetings to prevent orphaned resources
 * 
 * Handles:
 * - Orphaned meeting detection and cleanup
 * - Meeting validation
 * - Safe meeting deletion for temporary queue meetings
 */

import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { 
    ChimeSDKMeetingsClient, 
    DeleteMeetingCommand,
    GetMeetingCommand
} from '@aws-sdk/client-chime-sdk-meetings';

export interface MeetingCleanupResult {
    cleanedCount: number;
    errors: string[];
    skipped: number;
}

export class MeetingLifecycleManager {
    constructor(
        private ddb: DynamoDBDocumentClient,
        private chime: ChimeSDKMeetingsClient,
        private callQueueTable: string
    ) {}

    /**
     * Clean up meetings for calls in specific states
     * ONLY cleans up temporary meetings created for queued calls
     * Does NOT touch agent session meetings
     */
    async cleanupOrphanedMeetings(): Promise<MeetingCleanupResult> {
        const result: MeetingCleanupResult = {
            cleanedCount: 0,
            errors: [],
            skipped: 0
        };

        try {
            // Query calls with meetings that should be cleaned
            // CRITICAL: Only clean up 'queued', 'abandoned', or 'failed' status calls
            const { Items: calls } = await this.ddb.send(new ScanCommand({
                TableName: this.callQueueTable,
                FilterExpression: '(#status IN (:queued, :abandoned, :failed)) AND ' +
                                 'attribute_exists(meetingInfo) AND ' +
                                 'queueEntryTime < :cutoffTime',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':queued': 'queued',
                    ':abandoned': 'abandoned',
                    ':failed': 'failed',
                    // Clean up meetings older than 30 minutes
                    ':cutoffTime': Math.floor(Date.now() / 1000) - (30 * 60)
                }
            }));

            if (!calls || calls.length === 0) {
                console.log('[MeetingLifecycle] No orphaned meetings found');
                return result;
            }

            console.log(`[MeetingLifecycle] Found ${calls.length} potential orphaned meetings`);

            for (const call of calls) {
                try {
                    await this.cleanupMeeting(call, result);
                } catch (err: any) {
                    const errorMsg = `Failed to cleanup meeting for call ${call.callId}: ${err.message}`;
                    console.error(`[MeetingLifecycle] ${errorMsg}`);
                    result.errors.push(errorMsg);
                }
            }

            console.log('[MeetingLifecycle] Cleanup complete:', result);
        } catch (err: any) {
            const errorMsg = `Error during orphaned meeting scan: ${err.message}`;
            console.error(`[MeetingLifecycle] ${errorMsg}`);
            result.errors.push(errorMsg);
        }

        return result;
    }

    /**
     * Clean up a single meeting
     */
    private async cleanupMeeting(call: any, result: MeetingCleanupResult): Promise<void> {
        const meetingId = call.meetingInfo?.MeetingId;
        if (!meetingId) {
            result.skipped++;
            return;
        }

        const callAge = Date.now() - (call.queueEntryTime * 1000);
        const callAgeMinutes = Math.floor(callAge / (60 * 1000));

        // Additional safety check: Don't delete meetings for recently created calls
        if (callAgeMinutes < 30) {
            console.log(`[MeetingLifecycle] Skipping recent call ${call.callId} (${callAgeMinutes} min old)`);
            result.skipped++;
            return;
        }

        console.log(`[MeetingLifecycle] Cleaning up meeting ${meetingId} for call ${call.callId} ` +
                   `(status: ${call.status}, age: ${callAgeMinutes} min)`);

        try {
            // Delete meeting from Chime
            await this.chime.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
            console.log(`[MeetingLifecycle] Deleted orphaned meeting ${meetingId}`);

            // Update call record to remove meeting info
            await this.ddb.send(new UpdateCommand({
                TableName: this.callQueueTable,
                Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
                UpdateExpression: 'REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo ' +
                                 'SET meetingCleanedUpAt = :now, meetingCleanupReason = :reason',
                ExpressionAttributeValues: {
                    ':now': new Date().toISOString(),
                    ':reason': 'orphaned_meeting_cleanup'
                }
            }));

            result.cleanedCount++;
        } catch (err: any) {
            if (err.name === 'NotFoundException') {
                // Meeting already deleted - just update the record
                console.log(`[MeetingLifecycle] Meeting ${meetingId} already deleted`);
                await this.ddb.send(new UpdateCommand({
                    TableName: this.callQueueTable,
                    Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
                    UpdateExpression: 'REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo ' +
                                     'SET meetingCleanedUpAt = :now, meetingCleanupReason = :reason',
                    ExpressionAttributeValues: {
                        ':now': new Date().toISOString(),
                        ':reason': 'meeting_not_found'
                    }
                }));
                result.cleanedCount++;
            } else {
                throw err;
            }
        }
    }

    /**
     * Validate that a meeting still exists
     */
    async validateMeeting(meetingId: string): Promise<boolean> {
        try {
            await this.chime.send(new GetMeetingCommand({ MeetingId: meetingId }));
            return true;
        } catch (err: any) {
            if (err.name === 'NotFoundException') {
                return false;
            }
            throw err;
        }
    }

    /**
     * Clean up meeting by ID with verification
     */
    async deleteMeetingIfExists(meetingId: string): Promise<boolean> {
        try {
            await this.chime.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
            console.log(`[MeetingLifecycle] Deleted meeting ${meetingId}`);
            return true;
        } catch (err: any) {
            if (err.name === 'NotFoundException') {
                console.log(`[MeetingLifecycle] Meeting ${meetingId} not found (already deleted)`);
                return false;
            }
            console.error(`[MeetingLifecycle] Error deleting meeting ${meetingId}:`, err);
            throw err;
        }
    }

    /**
     * Get all active meetings for a call (for debugging)
     */
    async getCallMeetingInfo(callId: string): Promise<any> {
        const { Items: calls } = await this.ddb.send(new QueryCommand({
            TableName: this.callQueueTable,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));

        if (!calls || calls.length === 0) {
            return null;
        }

        const call = calls[0];
        if (!call.meetingInfo?.MeetingId) {
            return null;
        }

        const isValid = await this.validateMeeting(call.meetingInfo.MeetingId);

        return {
            callId: call.callId,
            meetingId: call.meetingInfo.MeetingId,
            status: call.status,
            isValid,
            queueEntryTime: call.queueEntryTime,
            assignedAgentId: call.assignedAgentId
        };
    }
}


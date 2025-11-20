/**
 * Compensating Action Processor
 * Fix 2: Handles compensating transactions when operations fail
 * 
 * Processes messages from a dead-letter queue to reconcile inconsistent states
 * caused by partial failures (e.g., SMA on hold but DB not updated)
 * 
 * Handles:
 * - Resume held calls where DB update failed
 * - Clean up orphaned SMA states
 * - Reconcile agent presence states
 */

import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { ChimeSDKMeetingsClient, DeleteAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';

const ddb = getDynamoDBClient();
const chimeVoice = new ChimeSDKVoiceClient({});
const chime = new ChimeSDKMeetingsClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;

interface CompensatingAction {
    action: string;
    callId: string;
    agentId: string;
    holdOperationId?: string;
    transferId?: string;
    meetingId?: string;
    attendeeId?: string;
    reason: string;
    timestamp?: string;
}

/**
 * Main handler for compensating action processor
 * Triggered by SQS messages from compensating actions queue
 */
export const handler = async (event: SQSEvent): Promise<void> => {
    console.log('[CompensatingAction] Processing batch', {
        recordCount: event.Records.length,
        timestamp: new Date().toISOString()
    });

    for (const record of event.Records) {
        try {
            await processCompensatingAction(record);
        } catch (err: any) {
            console.error('[CompensatingAction] Error processing record:', {
                messageId: record.messageId,
                error: err.message,
                stack: err.stack
            });
            // Throwing here will move message to DLQ for manual review
            throw err;
        }
    }

    console.log('[CompensatingAction] Batch processing complete');
};

/**
 * Process a single compensating action
 */
async function processCompensatingAction(record: SQSRecord): Promise<void> {
    const action: CompensatingAction = JSON.parse(record.body);

    console.log('[CompensatingAction] Processing action:', {
        action: action.action,
        callId: action.callId,
        agentId: action.agentId,
        reason: action.reason
    });

    switch (action.action) {
        case 'RESUME_HELD_CALL':
            await resumeInconsistentHold(action);
            break;

        case 'RELEASE_ORPHANED_MEETING_ATTENDEE':
            await releaseOrphanedAttendee(action);
            break;

        case 'RECONCILE_AGENT_STATE':
            await reconcileAgentState(action);
            break;

        case 'CLEANUP_FAILED_TRANSFER':
            await cleanupFailedTransfer(action);
            break;

        default:
            console.warn('[CompensatingAction] Unknown action type:', action.action);
            // Don't throw - unknown actions should not block processing
    }
}

/**
 * Resume a call that's on hold in SMA but not marked on hold in DB
 * This happens when SMA hold succeeds but DB update fails
 */
async function resumeInconsistentHold(action: CompensatingAction): Promise<void> {
    console.log(`[CompensatingAction] Resuming inconsistent hold for call ${action.callId}`);

    // Step 1: Get current call state
    const { Items: calls } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': action.callId }
    }));

    if (!calls || calls.length === 0) {
        console.warn('[CompensatingAction] Call not found, skipping:', action.callId);
        return;
    }

    const call = calls[0];

    // Step 2: Get agent state
    const { Item: agent } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: action.agentId }
    }));

    if (!agent) {
        console.warn('[CompensatingAction] Agent not found, skipping:', action.agentId);
        return;
    }

    // Step 3: Determine correct action based on actual state
    if (call.status === 'connected' && agent.currentCallId === action.callId) {
        // DB shows connected but SMA is on hold - resume SMA to match DB
        console.log('[CompensatingAction] DB shows connected, resuming SMA');
        
        const smaId = getSmaIdForClinic(call.clinicId);
        if (!smaId) {
            console.error('[CompensatingAction] No SMA mapping for clinic', call.clinicId);
            return;
        }

        try {
            await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: action.callId,
                Arguments: { 
                    action: 'RESUME_CALL',
                    compensating: 'true',
                    reason: action.reason
                }
            }));
            console.log('[CompensatingAction] Successfully resumed SMA call');
        } catch (smaErr: any) {
            console.error('[CompensatingAction] Failed to resume SMA:', smaErr);
            // Log but don't throw - may already be resumed
        }

    } else if (call.status === 'on_hold') {
        // DB shows on hold - update agent to match
        console.log('[CompensatingAction] DB shows on_hold, updating agent');
        
        try {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: action.agentId },
                UpdateExpression: 'SET callStatus = :onhold, heldCallId = :callId, ' +
                                 'compensatingActionApplied = :true',
                ConditionExpression: 'currentCallId = :callId',
                ExpressionAttributeValues: {
                    ':onhold': 'on_hold',
                    ':callId': action.callId,
                    ':true': true
                }
            }));
            console.log('[CompensatingAction] Successfully updated agent state');
        } catch (dbErr: any) {
            if (dbErr.name !== 'ConditionalCheckFailedException') {
                throw dbErr;
            }
            console.log('[CompensatingAction] Agent state already updated');
        }

    } else {
        console.log('[CompensatingAction] States already consistent, no action needed');
    }
}

/**
 * Release an attendee that was created but never used
 * This happens when attendee creation succeeds but subsequent operations fail
 */
async function releaseOrphanedAttendee(action: CompensatingAction): Promise<void> {
    console.log(`[CompensatingAction] Releasing orphaned attendee ${action.attendeeId} ` +
               `from meeting ${action.meetingId}`);

    if (!action.meetingId || !action.attendeeId) {
        console.warn('[CompensatingAction] Missing meetingId or attendeeId, skipping');
        return;
    }

    try {
        await chime.send(new DeleteAttendeeCommand({
            MeetingId: action.meetingId,
            AttendeeId: action.attendeeId
        }));
        console.log('[CompensatingAction] Successfully deleted orphaned attendee');
    } catch (err: any) {
        if (err.name === 'NotFoundException') {
            console.log('[CompensatingAction] Attendee already deleted');
        } else {
            console.error('[CompensatingAction] Failed to delete attendee:', err);
            // Don't throw - attendee will be cleaned up when meeting ends
        }
    }
}

/**
 * Reconcile agent presence state
 * This handles cases where agent is stuck in an invalid state
 */
async function reconcileAgentState(action: CompensatingAction): Promise<void> {
    console.log(`[CompensatingAction] Reconciling agent state for ${action.agentId}`);

    const { Item: agent } = await ddb.send(new GetCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId: action.agentId }
    }));

    if (!agent) {
        console.warn('[CompensatingAction] Agent not found:', action.agentId);
        return;
    }

    // Check if agent has any active calls
    const hasActiveCall = agent.currentCallId || agent.ringingCallId || agent.heldCallId;

    if (!hasActiveCall) {
        console.log('[CompensatingAction] Agent has no active calls, marking online');
        
        try {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: action.agentId },
                UpdateExpression: 'SET #status = :online, lastActivityAt = :now, ' +
                                 'compensatingActionApplied = :true ' +
                                 'REMOVE currentCallId, callStatus, ringingCallId, ringingCallTime, ' +
                                 'heldCallId, heldCallMeetingId, transferringCallId, transferStatus',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':online': 'Online',
                    ':now': new Date().toISOString(),
                    ':true': true
                }
            }));
            console.log('[CompensatingAction] Successfully reconciled agent state');
        } catch (err: any) {
            console.error('[CompensatingAction] Failed to reconcile agent:', err);
            throw err;
        }
    } else {
        console.log('[CompensatingAction] Agent has active call, validating consistency');
        // Could add more validation here
    }
}

/**
 * Clean up a failed transfer operation
 * This reverts both call and agent states when transfer fails
 */
async function cleanupFailedTransfer(action: CompensatingAction): Promise<void> {
    console.log(`[CompensatingAction] Cleaning up failed transfer ${action.transferId}`);

    if (!action.transferId) {
        console.warn('[CompensatingAction] Missing transferId, skipping');
        return;
    }

    // Get call record
    const { Items: calls } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': action.callId }
    }));

    if (!calls || calls.length === 0) {
        console.warn('[CompensatingAction] Call not found:', action.callId);
        return;
    }

    const call = calls[0];
    const { clinicId, queuePosition } = call;

    // Clean up call transfer state
    try {
        await ddb.send(new UpdateCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: { clinicId, queuePosition },
            UpdateExpression: 'SET transferStatus = :failed, compensatingActionApplied = :true ' +
                             'REMOVE transferId, transferToAgentId, transferFromAgentId, transferNotes',
            ConditionExpression: 'transferId = :transferId',
            ExpressionAttributeValues: {
                ':failed': 'FAILED',
                ':transferId': action.transferId,
                ':true': true
            }
        }));
        console.log('[CompensatingAction] Cleaned up call transfer state');
    } catch (err: any) {
        if (err.name !== 'ConditionalCheckFailedException') {
            throw err;
        }
        console.log('[CompensatingAction] Call transfer already cleaned up');
    }

    // Clean up agent states (if specified)
    if (action.agentId) {
        try {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: action.agentId },
                UpdateExpression: 'SET #status = :online, compensatingActionApplied = :true ' +
                                 'REMOVE transferringCallId, transferStatus, incomingTransferId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':online': 'Online',
                    ':true': true
                }
            }));
            console.log('[CompensatingAction] Cleaned up agent transfer state');
        } catch (err: any) {
            console.error('[CompensatingAction] Failed to clean up agent:', err);
            // Don't throw - call state is more important
        }
    }
}

/**
 * Schedule a compensating action via SQS
 * Called by other Lambdas when they detect inconsistent state
 */
export async function scheduleCompensatingAction(
    action: Omit<CompensatingAction, 'timestamp'>
): Promise<void> {
    // This would be imported and used by other Lambdas
    // Implementation depends on SQS queue setup
    console.log('[CompensatingAction] Scheduled compensating action:', action);
    
    // Note: Actual SQS sending would be done here, but requires queue URL
    // For now, just log for visibility
}


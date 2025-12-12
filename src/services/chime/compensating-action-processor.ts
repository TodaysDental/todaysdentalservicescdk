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
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { getSmaIdForClinic } from './utils/sma-map';

const ddb = getDynamoDBClient();
const sqsClient = new SQSClient({});
const ssmClient = new SSMClient({});

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeVoice = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });

const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;

// Cache for SQS queue URL
let cachedQueueUrl: string | null = null;

/**
 * Intent types for compensating actions - CRITICAL FIX: Use enum instead of string matching
 * This prevents fragile string-based intent detection
 */
export enum CompensatingIntent {
    /** The intended state was on_hold - DB should be updated to match SMA */
    INTENDED_HOLD = 'INTENDED_HOLD',
    /** The intended state was connected - SMA should be resumed to match DB */
    INTENDED_RESUME = 'INTENDED_RESUME',
    /** Unknown intent - use heuristics to determine correct action */
    UNKNOWN = 'UNKNOWN'
}

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
    // CRITICAL FIX #8: Additional fields from hold-call.ts for proper recovery
    clinicId?: string;
    queuePosition?: number;
    smaId?: string;
    // CRITICAL FIX: Explicit intent field instead of parsing reason string
    intent?: CompensatingIntent;
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
 * CRITICAL FIX #8: Now uses additional fields (clinicId, queuePosition, smaId) from hold-call.ts
 */
async function resumeInconsistentHold(action: CompensatingAction): Promise<void> {
    console.log(`[CompensatingAction] Resuming inconsistent hold for call ${action.callId}`, {
        holdOperationId: action.holdOperationId,
        clinicId: action.clinicId,
        hasQueuePosition: action.queuePosition !== undefined
    });

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
    // Use clinicId from action if available (more reliable), otherwise from call record
    const clinicId = action.clinicId || call.clinicId;

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
    // CRITICAL FIX: Use explicit intent field instead of fragile string matching
    // Fall back to heuristics only if intent is not set (for backwards compatibility)
    let wasIntendedHold = false;
    
    if (action.intent) {
        // Use explicit intent if provided (preferred)
        wasIntendedHold = action.intent === CompensatingIntent.INTENDED_HOLD;
        console.log('[CompensatingAction] Using explicit intent:', action.intent);
    } else {
        // LEGACY: Fall back to more robust heuristics for backwards compatibility
        // FIX #7: Use includes() instead of === for reason matching to handle additional context
        // Only consider it an intended hold if:
        // 1. The action type is specifically RESUME_HELD_CALL AND
        // 2. The reason contains DB_UPDATE_FAILED (handles messages like 'DB_UPDATE_FAILED: timeout')
        const isHoldActionType = action.action === 'RESUME_HELD_CALL';
        const hasDbUpdateFailure = action.reason?.includes('DB_UPDATE_FAILED') || 
                                   action.reason?.startsWith('DB_UPDATE_FAILED');
        
        // Be conservative: only mark as intended hold if we have strong evidence
        wasIntendedHold = isHoldActionType && hasDbUpdateFailure;
        
        console.warn('[CompensatingAction] Using legacy heuristics for intent detection', {
            action: action.action,
            reason: action.reason,
            wasIntendedHold,
            recommendation: 'Update caller to use explicit intent field for reliable recovery'
        });
    }
    
    if (call.status === 'connected' && agent.currentCallId === action.callId && !wasIntendedHold) {
        // DB shows connected and this wasn't a failed hold attempt - resume SMA to match DB
        console.log('[CompensatingAction] DB shows connected (not from failed hold), resuming SMA');
        
        // Use smaId from action if available (more reliable), otherwise lookup
        const smaId = action.smaId || getSmaIdForClinic(clinicId);
        if (!smaId) {
            console.error('[CompensatingAction] No SMA mapping for clinic', clinicId);
            return;
        }

        try {
            await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
                SipMediaApplicationId: smaId,
                TransactionId: action.callId,
                Arguments: { 
                    action: 'RESUME_CALL',
                    compensating: 'true',
                    reason: action.reason,
                    holdOperationId: action.holdOperationId || ''
                }
            }));
            console.log('[CompensatingAction] Successfully resumed SMA call');
        } catch (smaErr: any) {
            console.error('[CompensatingAction] Failed to resume SMA:', smaErr);
            // Log but don't throw - may already be resumed
        }

    } else if (call.status === 'connected' && wasIntendedHold) {
        // FIX: DB shows connected but intended state was on_hold - update DB to match SMA
        console.log('[CompensatingAction] DB shows connected but intended hold, updating DB to on_hold');
        
        try {
            // Update call record to on_hold
            await ddb.send(new UpdateCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
                UpdateExpression: 'SET #status = :onhold, callStatus = :onhold, holdStartTime = :now, ' +
                                 'heldByAgentId = :agentId, compensatingActionApplied = :true',
                ConditionExpression: '#status = :connected',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':onhold': 'on_hold',
                    ':connected': 'connected',
                    ':now': new Date().toISOString(),
                    ':agentId': action.agentId,
                    ':true': true
                }
            }));
            
            // Update agent record
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: action.agentId },
                UpdateExpression: 'SET callStatus = :onhold, heldCallId = :callId, ' +
                                 'heldCallMeetingId = :meetingId, compensatingActionApplied = :true',
                ExpressionAttributeValues: {
                    ':onhold': 'on_hold',
                    ':callId': action.callId,
                    ':meetingId': action.meetingId || null,
                    ':true': true
                }
            }));
            
            console.log('[CompensatingAction] Successfully updated DB to on_hold state');
        } catch (dbErr: any) {
            if (dbErr.name !== 'ConditionalCheckFailedException') {
                throw dbErr;
            }
            console.log('[CompensatingAction] Call state already changed');
        }

    } else if (call.status === 'on_hold') {
        // DB shows on hold - update agent to match
        console.log('[CompensatingAction] DB shows on_hold, updating agent');
        
        try {
            await ddb.send(new UpdateCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: action.agentId },
                UpdateExpression: 'SET callStatus = :onhold, heldCallId = :callId, ' +
                                 'compensatingActionApplied = :true, compensatingActionTime = :now',
                ConditionExpression: 'currentCallId = :callId',
                ExpressionAttributeValues: {
                    ':onhold': 'on_hold',
                    ':callId': action.callId,
                    ':true': true,
                    ':now': new Date().toISOString()
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
        console.log('[CompensatingAction] States already consistent, no action needed', {
            callStatus: call.status,
            agentCurrentCallId: agent.currentCallId,
            actionCallId: action.callId
        });
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
    // FIX: Check if agent is currently on another call before marking them Online
    if (action.agentId) {
        try {
            // First get current agent state
            const { Item: agent } = await ddb.send(new GetCommand({
                TableName: AGENT_PRESENCE_TABLE_NAME,
                Key: { agentId: action.agentId }
            }));
            
            if (!agent) {
                console.warn('[CompensatingAction] Agent not found:', action.agentId);
                return;
            }
            
            // Only mark Online if agent doesn't have another active call
            const hasOtherActiveCall = agent.currentCallId && agent.currentCallId !== action.callId;
            if (hasOtherActiveCall) {
                console.log('[CompensatingAction] Agent has another active call, only removing transfer fields', {
                    agentId: action.agentId,
                    currentCallId: agent.currentCallId
                });
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId: action.agentId },
                    UpdateExpression: 'SET compensatingActionApplied = :true ' +
                                     'REMOVE transferringCallId, transferStatus, incomingTransferId',
                    ExpressionAttributeValues: {
                        ':true': true
                    }
                }));
            } else {
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
            }
            console.log('[CompensatingAction] Cleaned up agent transfer state');
        } catch (err: any) {
            console.error('[CompensatingAction] Failed to clean up agent:', err);
            // Don't throw - call state is more important
        }
    }
}

/**
 * Get the compensating actions queue URL from SSM (cached)
 * CRITICAL FIX #9: Check for direct env var first (set by CDK), then fall back to SSM lookup
 */
async function getQueueUrl(): Promise<string | null> {
    if (cachedQueueUrl) {
        return cachedQueueUrl;
    }

    // First check for directly injected queue URL (preferred)
    const directQueueUrl = process.env.COMPENSATING_ACTIONS_QUEUE_URL;
    if (directQueueUrl) {
        cachedQueueUrl = directQueueUrl;
        return cachedQueueUrl;
    }

    // Fall back to SSM lookup (for cross-Lambda invocations)
    const stackName = process.env.STACK_NAME;
    if (!stackName) {
        console.error('[CompensatingAction] STACK_NAME env var not set and no COMPENSATING_ACTIONS_QUEUE_URL');
        return null;
    }
    
    const parameterName = `/${stackName}/CompensatingActionsQueueUrl`;

    try {
        const response = await ssmClient.send(new GetParameterCommand({
            Name: parameterName,
        }));
        cachedQueueUrl = response.Parameter?.Value || null;
        return cachedQueueUrl;
    } catch (err: any) {
        console.error('[CompensatingAction] Failed to get queue URL from SSM:', err);
        return null;
    }
}

/**
 * Schedule a compensating action via SQS
 * Called by other Lambdas when they detect inconsistent state
 * 
 * @param action - The compensating action to schedule. Include 'intent' field for reliable recovery.
 * @param queueUrl - Optional queue URL (if caller already has it). If not provided, will fetch from SSM.
 */
export async function scheduleCompensatingAction(
    action: Omit<CompensatingAction, 'timestamp'> & { intent?: CompensatingIntent },
    queueUrl?: string
): Promise<void> {
    const url = queueUrl || await getQueueUrl();
    
    if (!url) {
        console.error('[CompensatingAction] Cannot schedule - no queue URL available');
        // Log the action anyway for manual investigation
        console.error('[CompensatingAction] UNSCHEDULED ACTION:', JSON.stringify(action));
        return;
    }

    const messageBody: CompensatingAction = {
        ...action,
        timestamp: new Date().toISOString(),
    };

    try {
        await sqsClient.send(new SendMessageCommand({
            QueueUrl: url,
            MessageBody: JSON.stringify(messageBody),
            // Use callId for message deduplication in FIFO queues (if using FIFO)
            // MessageGroupId: action.callId,
        }));
        
        console.log('[CompensatingAction] Scheduled compensating action:', {
            action: action.action,
            callId: action.callId,
            agentId: action.agentId,
        });
    } catch (err: any) {
        console.error('[CompensatingAction] Failed to send to SQS:', err);
        // Log the action for manual investigation
        console.error('[CompensatingAction] FAILED ACTION:', JSON.stringify(messageBody));
        throw err;
    }
}


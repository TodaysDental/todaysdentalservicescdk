/**
 * FIX #14: State Timeout Manager
 * 
 * Prevents calls from being stuck in intermediate states indefinitely.
 * Automatically transitions calls that exceed state-specific timeouts.
 * 
 * Timeout thresholds:
 * - ringing: 2 minutes (agent not answering)
 * - dialing: 1 minute (outbound not connecting)
 * - queued: 24 hours (excessive queue time)
 * - transferring: 30 seconds (transfer not completing)
 * - on_hold: 1 hour (hold abandoned)
 */

import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';

export const STATE_TIMEOUTS = {
  ringing: 2 * 60, // 2 minutes max ringing
  dialing: 1 * 60, // 1 minute max dialing
  queued: 24 * 60 * 60, // 24 hours in queue
  transferring: 30, // 30 seconds for transfer
  on_hold: 60 * 60, // 1 hour max hold
};

export interface StateTimeoutResult {
  transitioned: number;
  errors: string[];
}

export class StateTimeoutManager {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private chime: ChimeSDKMeetingsClient,
    private callQueueTable: string,
    private agentPresenceTable: string
  ) {}

  /**
   * Check all timeout-prone states and transition expired calls
   */
  async checkAndTransitionTimedOutStates(): Promise<StateTimeoutResult> {
    const result: StateTimeoutResult = { transitioned: 0, errors: [] };
    const now = Date.now();

    // Check each timeout-prone state
    for (const [state, timeoutSeconds] of Object.entries(STATE_TIMEOUTS)) {
      try {
        const count = await this.transitionTimedOutCalls(state, timeoutSeconds, now);
        result.transitioned += count;
      } catch (err: any) {
        result.errors.push(`Failed to transition ${state}: ${err.message}`);
      }
    }

    return result;
  }

  /**
   * Find and transition calls in a specific state that have timed out
   */
  private async transitionTimedOutCalls(
    state: string,
    timeoutSeconds: number,
    now: number
  ): Promise<number> {
    const cutoffTime = new Date(now - timeoutSeconds * 1000).toISOString();

    // Query calls in this state that are too old
    const { Items: calls } = await this.ddb.send(new QueryCommand({
      TableName: this.callQueueTable,
      IndexName: 'status-lastStateChange-index',
      KeyConditionExpression: '#status = :state AND lastStateChange < :cutoff',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':state': state,
        ':cutoff': cutoffTime
      }
    }));

    if (!calls || calls.length === 0) return 0;

    let transitionCount = 0;

    for (const call of calls) {
      try {
        await this.transitionCall(call, state);
        transitionCount++;
      } catch (err) {
        console.error(`[StateTimeout] Failed to transition call ${call.callId}:`, err);
      }
    }

    return transitionCount;
  }

  /**
   * Transition a single call based on its current state
   */
  private async transitionCall(call: any, fromState: string): Promise<void> {
    let newState: string;
    let reason: string;

    // Determine correct transition
    switch (fromState) {
      case 'ringing':
        newState = 'abandoned';
        reason = 'no_answer_timeout';
        await this.cleanupRingingAgents(call);
        break;

      case 'dialing':
        newState = 'failed';
        reason = 'dial_timeout';
        break;

      case 'queued':
        newState = 'abandoned';
        reason = 'queue_timeout';
        await this.cleanupQueuedMeeting(call);
        break;

      case 'transferring':
        newState = 'connected';
        reason = 'transfer_timeout';
        await this.rollbackFailedTransfer(call);
        break;

      case 'on_hold':
        newState = 'abandoned';
        reason = 'hold_timeout';
        await this.cleanupHeldCall(call);
        break;

      default:
        console.warn(`[StateTimeout] Unknown state: ${fromState}`);
        return;
    }

    // Transition with audit trail
    await this.ddb.send(new UpdateCommand({
      TableName: this.callQueueTable,
      Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
      UpdateExpression: 'SET #status = :newStatus, ' +
                       'previousStatus = :oldStatus, ' +
                       'statusTransitionReason = :reason, ' +
                       'statusTransitionedAt = :now, ' +
                       'autoTransitioned = :true',
      ConditionExpression: '#status = :oldStatus', // Prevent race with manual transition
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':newStatus': newState,
        ':oldStatus': fromState,
        ':reason': reason,
        ':now': new Date().toISOString(),
        ':true': true
      }
    }));

    console.log(`[StateTimeout] Transitioned call ${call.callId}: ${fromState} -> ${newState} (${reason})`);
  }

  /**
   * Clean up agents stuck in ringing state for this call
   */
  private async cleanupRingingAgents(call: any): Promise<void> {
    if (!call.agentIds || call.agentIds.length === 0) return;

    const cleanupPromises = call.agentIds.map(async (agentId: string) => {
      try {
        await this.ddb.send(new UpdateCommand({
          TableName: this.agentPresenceTable,
          Key: { agentId },
          UpdateExpression: 'SET #status = :online, lastActivityAt = :now ' +
                           'REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId',
          ConditionExpression: 'ringingCallId = :callId',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':online': 'Online',
            ':now': new Date().toISOString(),
            ':callId': call.callId
          }
        }));
      } catch (err: any) {
        // Ignore if condition fails (agent moved on)
        if (err.name !== 'ConditionalCheckFailedException') {
          console.error(`[StateTimeout] Error cleaning agent ${agentId}:`, err);
        }
      }
    });

    await Promise.allSettled(cleanupPromises);
  }

  /**
   * Clean up meeting for queued call that timed out
   */
  private async cleanupQueuedMeeting(call: any): Promise<void> {
    if (!call.meetingInfo?.MeetingId) return;

    try {
      await this.chime.send(new DeleteMeetingCommand({
        MeetingId: call.meetingInfo.MeetingId
      }));
    } catch (err: any) {
      if (err.name !== 'NotFoundException') {
        console.error(`[StateTimeout] Error deleting meeting:`, err);
      }
    }
  }

  /**
   * Rollback failed transfer - return call to original agent
   */
  private async rollbackFailedTransfer(call: any): Promise<void> {
    // Return call to original agent if still available
    if (!call.assignedAgentId || !call.transferToAgentId) return;

    // Clean up target agent
    await this.ddb.send(new UpdateCommand({
      TableName: this.agentPresenceTable,
      Key: { agentId: call.transferToAgentId },
      UpdateExpression: 'REMOVE incomingTransferId, incomingTransferFrom, incomingTransferCallId',
      ConditionExpression: 'incomingTransferId = :transferId',
      ExpressionAttributeValues: {
        ':transferId': call.transferId
      }
    })).catch(() => {}); // Ignore if already cleaned

    // Restore original agent
    await this.ddb.send(new UpdateCommand({
      TableName: this.agentPresenceTable,
      Key: { agentId: call.assignedAgentId },
      UpdateExpression: 'REMOVE transferringCallId, transferStatus'
    })).catch(() => {});
  }

  /**
   * Clean up held call that was abandoned
   */
  private async cleanupHeldCall(call: any): Promise<void> {
    if (call.heldByAgentId) {
      await this.ddb.send(new UpdateCommand({
        TableName: this.agentPresenceTable,
        Key: { agentId: call.heldByAgentId },
        UpdateExpression: 'SET #status = :online ' +
                         'REMOVE heldCallId, heldCallMeetingId, callStatus',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':online': 'Online' }
      })).catch(() => {});
    }
  }
}


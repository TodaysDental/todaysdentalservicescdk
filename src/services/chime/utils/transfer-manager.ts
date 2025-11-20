/**
 * FIX #32: Warm Transfer Manager
 * 
 * Implements warm transfer (3-way call) instead of blind transfer.
 * Ensures customer is never orphaned during transfer process.
 * 
 * Transfer flow:
 * 1. Add target agent to meeting (customer + from agent + to agent)
 * 2. Wait for target agent to join
 * 3. Allow handoff conversation
 * 4. Remove original agent
 * 5. Update ownership
 */

import { ChimeSDKMeetingsClient, CreateAttendeeCommand, DeleteAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

export interface TransferResult {
  success: boolean;
  error?: string;
  transferId?: string;
}

export class TransferManager {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private chime: ChimeSDKMeetingsClient,
    private chimeVoice: ChimeSDKVoiceClient,
    private callQueueTable: string,
    private agentPresenceTable: string
  ) {}

  /**
   * Execute a warm transfer between agents
   */
  async executeWarmTransfer(
    call: any,
    fromAgentId: string,
    toAgentId: string,
    notes: string
  ): Promise<TransferResult> {
    const transferId = randomUUID();
    const meetingId = call.meetingInfo.MeetingId;

    try {
      // Step 1: Add target agent to meeting (customer + from agent + to agent)
      const targetAttendee = await this.chime.send(new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: `agent-${toAgentId}`
      }));

      console.log(`[Transfer] Added target agent ${toAgentId} to meeting`);

      // Step 2: Update call record to show transfer in progress
      await this.ddb.send(new UpdateCommand({
        TableName: this.callQueueTable,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: 'SET transferStatus = :inProgress, ' +
                         'transferId = :transferId, ' +
                         'transferringAgentId = :toAgentId, ' +
                         'transferTargetAttendeeInfo = :attendeeInfo',
        ExpressionAttributeValues: {
          ':inProgress': 'IN_PROGRESS',
          ':transferId': transferId,
          ':toAgentId': toAgentId,
          ':attendeeInfo': targetAttendee.Attendee
        }
      }));

      // Step 3: Notify target agent to join (via WebSocket/API)
      await this.notifyAgentToJoinTransfer(toAgentId, call, targetAttendee.Attendee!, notes);

      // Step 4: Wait for target agent to confirm they've joined
      const joined = await this.waitForAgentJoin(transferId, toAgentId, 30000); // 30s timeout

      if (!joined) {
        // Target agent didn't join - cancel transfer
        await this.cancelTransfer(call, transferId, toAgentId, targetAttendee.Attendee!.AttendeeId);
        return {
          success: false,
          error: 'Target agent did not join the call'
        };
      }

      // Step 5: Both agents are now in the call - allow handoff
      // Original agent can now leave when ready
      await this.ddb.send(new UpdateCommand({
        TableName: this.callQueueTable,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: 'SET transferStatus = :handoff',
        ExpressionAttributeValues: { ':handoff': 'HANDOFF' }
      }));

      // Step 6: Wait for original agent to complete handoff
      await this.waitForHandoffComplete(transferId, fromAgentId, 60000); // 60s timeout

      // Step 7: Remove original agent from meeting
      await this.chime.send(new DeleteAttendeeCommand({
        MeetingId: meetingId,
        AttendeeId: call.agentAttendeeInfo.AttendeeId
      }));

      // Step 8: Finalize transfer - update ownership
      await this.ddb.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.callQueueTable,
              Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
              UpdateExpression: 'SET transferStatus = :completed, ' +
                               'assignedAgentId = :toAgentId, ' +
                               'agentAttendeeInfo = :attendeeInfo, ' +
                               'previousAgentId = :fromAgentId, ' +
                               'transferCompletedAt = :now, ' +
                               'transferCount = if_not_exists(transferCount, :zero) + :one',
              ExpressionAttributeValues: {
                ':completed': 'COMPLETED',
                ':toAgentId': toAgentId,
                ':attendeeInfo': targetAttendee.Attendee,
                ':fromAgentId': fromAgentId,
                ':now': new Date().toISOString(),
                ':zero': 0,
                ':one': 1
              }
            }
          },
          {
            Update: {
              TableName: this.agentPresenceTable,
              Key: { agentId: fromAgentId },
              UpdateExpression: 'SET #status = :online, lastActivityAt = :now, ' +
                               'completedCalls = if_not_exists(completedCalls, :zero) + :one ' +
                               'REMOVE currentCallId, callStatus, transferringCallId',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':online': 'Online',
                ':now': new Date().toISOString(),
                ':zero': 0,
                ':one': 1
              }
            }
          },
          {
            Update: {
              TableName: this.agentPresenceTable,
              Key: { agentId: toAgentId },
              UpdateExpression: 'SET #status = :oncall, currentCallId = :callId, ' +
                               'callStatus = :connected, lastActivityAt = :now ' +
                               'REMOVE incomingTransferId',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':oncall': 'OnCall',
                ':callId': call.callId,
                ':connected': 'connected',
                ':now': new Date().toISOString()
              }
            }
          }
        ]
      }));

      console.log(`[Transfer] Warm transfer completed: ${fromAgentId} -> ${toAgentId}`);

      return { success: true, transferId };

    } catch (err: any) {
      console.error('[Transfer] Warm transfer failed:', err);

      // Attempt cleanup
      try {
        await this.cancelTransfer(call, transferId, toAgentId, undefined);
      } catch (cleanupErr) {
        console.error('[Transfer] Cleanup failed:', cleanupErr);
      }

      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Wait for agent to join the transfer
   */
  private async waitForAgentJoin(
    transferId: string,
    agentId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      // Check if agent has confirmed join
      const { Item: agent } = await this.ddb.send(new GetCommand({
        TableName: this.agentPresenceTable,
        Key: { agentId }
      }));

      if (agent?.transferJoined === transferId) {
        return true;
      }

      // Wait 500ms before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return false;
  }

  /**
   * Wait for handoff to complete
   */
  private async waitForHandoffComplete(
    transferId: string,
    fromAgentId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const { Item: agent } = await this.ddb.send(new GetCommand({
        TableName: this.agentPresenceTable,
        Key: { agentId: fromAgentId }
      }));

      if (agent?.handoffCompleted === transferId) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return false;
  }

  /**
   * Cancel a failed transfer
   */
  private async cancelTransfer(
    call: any,
    transferId: string,
    toAgentId: string,
    attendeeId?: string
  ): Promise<void> {
    // Remove target agent from meeting
    if (attendeeId) {
      try {
        await this.chime.send(new DeleteAttendeeCommand({
          MeetingId: call.meetingInfo.MeetingId,
          AttendeeId: attendeeId
        }));
      } catch (err) {
        console.error('[Transfer] Error removing target attendee:', err);
      }
    }

    // Clean up database
    await this.ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: this.callQueueTable,
            Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
            UpdateExpression: 'SET transferStatus = :failed ' +
                             'REMOVE transferId, transferringAgentId, transferTargetAttendeeInfo',
            ExpressionAttributeValues: { ':failed': 'FAILED' }
          }
        },
        {
          Update: {
            TableName: this.agentPresenceTable,
            Key: { agentId: toAgentId },
            UpdateExpression: 'REMOVE incomingTransferId, transferJoined'
          }
        }
      ]
    }));
  }

  /**
   * Notify agent to join transfer (via WebSocket or similar)
   */
  private async notifyAgentToJoinTransfer(
    agentId: string,
    call: any,
    attendeeInfo: any,
    notes: string
  ): Promise<void> {
    // Send via WebSocket, SNS, or API Gateway WebSocket
    // This would integrate with your frontend notification system

    await this.ddb.send(new UpdateCommand({
      TableName: this.agentPresenceTable,
      Key: { agentId },
      UpdateExpression: 'SET pendingTransferNotification = :notification',
      ExpressionAttributeValues: {
        ':notification': {
          callId: call.callId,
          fromAgent: call.assignedAgentId,
          notes,
          attendeeInfo,
          notifiedAt: new Date().toISOString()
        }
      }
    }));
  }
}


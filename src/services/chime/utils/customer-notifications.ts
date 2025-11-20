/**
 * FIX #26: Customer Notification Service
 * 
 * Provides proactive customer notifications during queue operations:
 * - Queue timeout notifications
 * - Estimated wait time announcements
 * - Callback offers
 */

import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getSmaIdForClinic } from './sma-map';

export class CustomerNotificationService {
  constructor(
    private chimeVoice: ChimeSDKVoiceClient,
    private ddb: DynamoDBDocumentClient,
    private callQueueTable: string
  ) {}

  /**
   * Notify customer that queue timeout has been reached
   */
  async notifyQueueTimeout(call: any): Promise<void> {
    const smaId = getSmaIdForClinic(call.clinicId);
    if (!smaId) {
      console.error('[Notifications] No SMA configured for clinic:', call.clinicId);
      return;
    }

    try {
      // Send SMA command to play timeout message
      await this.chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: call.callId,
        Arguments: {
          action: 'PLAY_TIMEOUT_MESSAGE',
          message: 'We apologize, but all of our agents are currently assisting other customers. ' +
                  'Please call back later or leave a message after the tone.',
          enableVoicemail: 'true',
          voicemailBucket: process.env.VOICEMAIL_BUCKET || '',
          voicemailKey: `voicemails/${call.clinicId}/${call.callId}.wav`
        }
      }));

      // Update call record
      await this.ddb.send(new UpdateCommand({
        TableName: this.callQueueTable,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: 'SET timeoutNotificationSent = :true, ' +
                         'timeoutNotificationAt = :now',
        ExpressionAttributeValues: {
          ':true': true,
          ':now': new Date().toISOString()
        }
      }));

      console.log(`[Notifications] Sent timeout notification for call ${call.callId}`);

    } catch (err) {
      console.error('[Notifications] Failed to send timeout message:', err);
    }
  }

  /**
   * Notify customer of estimated wait time
   */
  async notifyEstimatedWaitTime(call: any, waitMinutes: number): Promise<void> {
    const smaId = getSmaIdForClinic(call.clinicId);
    if (!smaId) return;

    try {
      await this.chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: call.callId,
        Arguments: {
          action: 'PLAY_WAIT_TIME',
          minutes: String(waitMinutes),
          message: `Your estimated wait time is ${waitMinutes} minutes. ` +
                  `Thank you for your patience.`
        }
      }));
    } catch (err) {
      console.error('[Notifications] Failed to send wait time:', err);
    }
  }

  /**
   * Offer callback to customer
   */
  async offerCallback(call: any, estimatedCallbackTime: string): Promise<void> {
    const smaId = getSmaIdForClinic(call.clinicId);
    if (!smaId) return;

    try {
      await this.chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
        SipMediaApplicationId: smaId,
        TransactionId: call.callId,
        Arguments: {
          action: 'OFFER_CALLBACK',
          estimatedTime: estimatedCallbackTime,
          message: 'Press 1 to receive a callback when an agent is available, ' +
                  'or press 2 to continue waiting.'
        }
      }));

      // Update call to track callback offer
      await this.ddb.send(new UpdateCommand({
        TableName: this.callQueueTable,
        Key: { clinicId: call.clinicId, queuePosition: call.queuePosition },
        UpdateExpression: 'SET callbackOffered = :true, callbackOfferedAt = :now',
        ExpressionAttributeValues: {
          ':true': true,
          ':now': new Date().toISOString()
        }
      }));

    } catch (err) {
      console.error('[Notifications] Failed to offer callback:', err);
    }
  }

  /**
   * Monitor queue and send proactive notifications
   */
  async monitorQueueTimeouts(clinicId: string, callQueueTable: string): Promise<void> {
    const now = Date.now();
    const warningThreshold = 10 * 60 * 1000; // 10 minutes
    const timeoutThreshold = 20 * 60 * 1000; // 20 minutes

    const { Items: queuedCalls } = await this.ddb.send(new QueryCommand({
      TableName: callQueueTable,
      IndexName: 'status-queueEntryTime-index',
      KeyConditionExpression: '#status = :queued',
      FilterExpression: 'queueEntryTime < :warningCutoff AND clinicId = :clinicId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':queued': 'queued',
        ':warningCutoff': new Date(now - warningThreshold).toISOString(),
        ':clinicId': clinicId
      }
    }));

    for (const call of queuedCalls || []) {
      const queueTime = now - new Date(call.queueEntryTime).getTime();

      if (queueTime > timeoutThreshold) {
        // Timeout - offer voicemail or callback
        if (!call.timeoutNotificationSent) {
          await this.notifyQueueTimeout(call);
        }
      } else if (queueTime > warningThreshold) {
        // Warning - offer callback
        if (!call.callbackOffered) {
          const waitMinutes = Math.ceil((timeoutThreshold - queueTime) / 60000);
          await this.offerCallback(call, `${waitMinutes} minutes`);
        }
      }
    }
  }
}


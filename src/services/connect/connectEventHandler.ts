/**
 * Amazon Connect Event Handler (Connect-native)
 *
 * This Lambda function handles events from Amazon Connect via EventBridge.
 * In Connect-native architecture, it uses Connect's contact attributes for metadata
 * instead of custom DynamoDB storage.
 */

import { EventBridgeEvent, Context } from 'aws-lambda';
import {
  ConnectClient,
  UpdateContactAttributesCommand,
  DescribeContactCommand,
  GetCurrentUserDataCommand
} from '@aws-sdk/client-connect';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;

interface ConnectEventDetail {
  eventType: string;
  contactId?: string;
  participantId?: string;
  userId?: string;
  agentId?: string;
  queueId?: string;
  routingProfileId?: string;
  contactAttributes?: Record<string, string>;
  timestamp: string;
  instanceId: string;
}

export const handler = async (event: EventBridgeEvent<string, ConnectEventDetail>, context: Context): Promise<void> => {
  try {
    console.log('Received Connect event:', JSON.stringify(event, null, 2));

    const detail = event.detail;
    const eventType = detail.eventType;

    switch (eventType) {
      case 'CONTACT_INITIATED':
        await handleContactInitiated(detail);
        break;
      case 'CONTACT_CONNECTED':
        await handleContactConnected(detail);
        break;
      case 'CONTACT_DISCONNECTED':
        await handleContactDisconnected(detail);
        break;
      case 'AGENT_CONNECTING':
        await handleAgentConnecting(detail);
        break;
      case 'AGENT_CONNECTED':
        await handleAgentConnected(detail);
        break;
      case 'AGENT_DISCONNECTED':
        await handleAgentDisconnected(detail);
        break;
      case 'CONTACT_MISSED':
        await handleContactMissed(detail);
        break;
      case 'CONTACT_QUEUED':
        await handleContactQueued(detail);
        break;
      default:
        console.log(`Unhandled event type: ${eventType}`);
    }

  } catch (error) {
    console.error('Error processing Connect event:', error);
    throw error;
  }
};

async function handleContactInitiated(detail: ConnectEventDetail): Promise<void> {
  const { contactId, userId, contactAttributes } = detail;

  if (!contactId) {
    console.warn('Contact initiated without contactId');
    return;
  }

  // Connect-native: store event metadata in contact attributes
  try {
    const attributes: Record<string, string> = {
      eventType: 'CONTACT_INITIATED',
      status: 'initiated',
      initiatedAt: new Date().toISOString(),
      clinicId: contactAttributes?.clinicId || 'unknown',
      callerNumber: contactAttributes?.callerNumber || '',
      destinationNumber: contactAttributes?.destinationNumber || '',
    };

    // Only add optional fields if they exist
    if (userId) {
      attributes.participantId = userId;
    }

    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: attributes,
    }));
  } catch (err) {
    console.warn('Could not update contact attributes for initiated event:', err);
  }

  console.log(`Contact ${contactId} initiated for clinic ${contactAttributes?.clinicId} (Connect-native)`);
}

async function handleContactConnected(detail: ConnectEventDetail): Promise<void> {
  const { contactId, participantId, contactAttributes } = detail;

  if (!contactId) return;

  // Connect-native: update contact attributes instead of routing table
  try {
    const attributes: Record<string, string> = {
      eventType: 'CONTACT_CONNECTED',
      status: 'connected',
      connectedAt: new Date().toISOString(),
      clinicId: contactAttributes?.clinicId || 'unknown',
    };

    // Only add optional fields if they exist
    if (participantId) {
      attributes.participantId = participantId;
    }

    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: attributes,
    }));
  } catch (err) {
    console.warn('Could not update contact attributes for connected event:', err);
  }

  // Update contact attributes
  await updateContactAttributes(contactId, {
    callStatus: 'connected',
    connectedAt: new Date().toISOString(),
    participantId: participantId || 'unknown',
  });

  console.log(`Contact ${contactId} connected with participant ${participantId || 'unknown'}`);
}

async function handleContactDisconnected(detail: ConnectEventDetail): Promise<void> {
  const { contactId, contactAttributes } = detail;

  if (!contactId) return;

  // Connect-native: update contact attributes instead of routing table
  try {
    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: {
        eventType: 'CONTACT_DISCONNECTED',
        status: 'disconnected',
        disconnectedAt: new Date().toISOString(),
        clinicId: contactAttributes?.clinicId || 'unknown',
      },
    }));
  } catch (err) {
    console.warn('Could not update contact attributes for disconnected event:', err);
  }

  // Update contact attributes
  await updateContactAttributes(contactId, {
    callStatus: 'disconnected',
    disconnectedAt: new Date().toISOString(),
  });

  console.log(`Contact ${contactId} disconnected (Connect-native)`);
}

async function handleAgentConnecting(detail: ConnectEventDetail): Promise<void> {
  const { userId, agentId } = detail;

  const agentIdToUse = userId || agentId;
  if (!agentIdToUse) return;

  console.log(`Agent ${agentIdToUse} connecting`);
  // You could add logic here to notify other systems about agent availability
}

async function handleAgentConnected(detail: ConnectEventDetail): Promise<void> {
  const { userId, agentId, routingProfileId } = detail;

  const agentIdToUse = userId || agentId;
  if (!agentIdToUse) return;

  console.log(`Agent ${agentIdToUse} connected with routing profile ${routingProfileId}`);
  // Update agent status in your system
}

async function handleAgentDisconnected(detail: ConnectEventDetail): Promise<void> {
  const { userId, agentId } = detail;

  const agentIdToUse = userId || agentId;
  if (!agentIdToUse) return;

  console.log(`Agent ${agentIdToUse} disconnected`);
  // Update agent status in your system
}

async function handleContactMissed(detail: ConnectEventDetail): Promise<void> {
  const { contactId, contactAttributes } = detail;

  if (!contactId) return;

  // Connect-native: update contact attributes instead of routing table
  try {
    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: {
        eventType: 'CONTACT_MISSED',
        status: 'missed',
        missedAt: new Date().toISOString(),
        clinicId: contactAttributes?.clinicId || 'unknown',
      },
    }));
  } catch (err) {
    console.warn('Could not update contact attributes for missed event:', err);
  }

  console.log(`Contact ${contactId} was missed (Connect-native)`);
}

async function handleContactQueued(detail: ConnectEventDetail): Promise<void> {
  const { contactId, queueId, contactAttributes } = detail;

  if (!contactId) return;

  // Connect-native: update contact attributes instead of routing table
  try {
    const attributes: Record<string, string> = {
      eventType: 'CONTACT_QUEUED',
      status: 'queued',
      queuedAt: new Date().toISOString(),
      clinicId: contactAttributes?.clinicId || 'unknown',
    };

    // Only add queueId if it exists
    if (queueId) {
      attributes.queueId = queueId;
    }

    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: attributes,
    }));
  } catch (err) {
    console.warn('Could not update contact attributes for queued event:', err);
  }

  console.log(`Contact ${contactId} queued in queue ${queueId} (Connect-native)`);
}

async function updateContactAttributes(contactId: string, attributes: Record<string, string>): Promise<void> {
  try {
    // Connect-native: actually update contact attributes using Connect API
    await connect.send(new UpdateContactAttributesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      InitialContactId: contactId,
      Attributes: attributes,
    }));

    console.log(`Updated contact ${contactId} attributes (Connect-native):`, attributes);
  } catch (error) {
    console.error('Failed to update contact attributes:', error);
  }
}

/**
 * Frontend integration for real-time call notifications
 *
 * Instead of polling, you can use WebSocket connections or Server-Sent Events
 * to push call notifications to the frontend in real-time.
 *
 * Example implementation:
 *
 * ```typescript
 * // In your softphone component
 * useEffect(() => {
 *   // Set up real-time connection for call events
 *   const eventSource = new EventSource('/api/connect/events');
 *
 *   eventSource.onmessage = (event) => {
 *     const callEvent = JSON.parse(event.data);
 *
 *     switch (callEvent.eventType) {
 *       case 'CONTACT_INITIATED':
 *         handleIncomingCall(callEvent);
 *         break;
 *       case 'CONTACT_CONNECTED':
 *         handleCallConnected(callEvent);
 *         break;
 *       case 'CONTACT_DISCONNECTED':
 *         handleCallDisconnected(callEvent);
 *         break;
 *     }
 *   };
 *
 *   return () => eventSource.close();
 * }, []);
 *
 * const handleIncomingCall = (event: any) => {
 *   const { contactId, contactAttributes } = event;
 *   showIncomingCallNotification(contactId, contactAttributes);
 * };
 * ```
 */

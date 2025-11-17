import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { getSmaIdForClinic } from './sma-map';

interface CheckQueueForWorkDeps {
    ddb: DynamoDBDocumentClient;
    callQueueTableName?: string;
    agentPresenceTableName?: string;
    chime: ChimeSDKMeetingsClient;
    chimeVoiceClient: ChimeSDKVoiceClient;
}

type AgentInfo = Record<string, any>;

export function createCheckQueueForWork(deps: CheckQueueForWorkDeps) {
    const { ddb, callQueueTableName, agentPresenceTableName, chime, chimeVoiceClient } = deps;

    if (!callQueueTableName || !agentPresenceTableName) {
        throw new Error('[checkQueueForWork] Table names are required to process the queue.');
    }

    return async function checkQueueForWork(agentId: string, agentInfo: AgentInfo): Promise<void> {
        if (!agentInfo?.activeClinicIds || agentInfo.activeClinicIds.length === 0) {
            console.log(`[checkQueueForWork] Agent ${agentId} has no active clinics. Skipping.`);
            return;
        }

        const agentMeeting = agentInfo.meetingInfo;
        if (!agentMeeting?.MeetingId) {
            console.warn(`[checkQueueForWork] Agent ${agentId} has no session meeting. Cannot accept queued calls.`);
            return;
        }

        const activeClinicIds: string[] = agentInfo.activeClinicIds;
        console.log(`[checkQueueForWork] Agent ${agentId} checking for queued calls in:`, activeClinicIds);

        for (const clinicId of activeClinicIds) {
            let callToAssign: any = null;
            try {
                const { Items: queuedCalls } = await ddb.send(new QueryCommand({
                    TableName: callQueueTableName,
                    KeyConditionExpression: 'clinicId = :clinicId',
                    FilterExpression: '#status = :status AND (attribute_not_exists(rejectedAgentIds) OR NOT contains(rejectedAgentIds, :agentId))',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':clinicId': clinicId,
                        ':status': 'queued',
                        ':agentId': agentId
                    },
                    ScanIndexForward: true,
                    Limit: 1
                }));

                if (!queuedCalls || queuedCalls.length === 0) {
                    continue;
                }

                callToAssign = queuedCalls[0];
                console.log(`[checkQueueForWork] Found queued call ${callToAssign.callId} for clinic ${clinicId}`);

                const smaId = getSmaIdForClinic(clinicId);
                if (!smaId) {
                    console.error(`[checkQueueForWork] No SMA mapping for clinic ${clinicId}. Skipping call.`);
                    continue;
                }

                const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                    MeetingId: agentMeeting.MeetingId,
                    ExternalUserId: `customer-${callToAssign.callId}`
                }));

                const customerAttendee = customerAttendeeResponse.Attendee;
                if (!customerAttendee?.AttendeeId || !customerAttendee.JoinToken) {
                    throw new Error('Failed to create customer attendee');
                }

                const assignmentTimestamp = new Date().toISOString();

                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: callQueueTableName,
                                Key: { clinicId: callToAssign.clinicId, queuePosition: callToAssign.queuePosition },
                                UpdateExpression: 'SET #status = :ringing, agentIds = :agentIds, assignedAgentId = :agentId, meetingInfo = :meeting, customerAttendeeInfo = :attendee',
                                ConditionExpression: '#status = :queued AND (attribute_not_exists(rejectedAgentIds) OR NOT contains(rejectedAgentIds, :agentId))',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':ringing': 'ringing',
                                    ':agentIds': [agentId],
                                    ':agentId': agentId,
                                    ':meeting': agentMeeting,
                                    ':attendee': customerAttendee,
                                    ':queued': 'queued'
                                }
                            }
                        },
                        {
                            Update: {
                                TableName: agentPresenceTableName,
                                Key: { agentId },
                                UpdateExpression: 'SET #status = :ringing, ringingCallId = :callId, ringingCallTime = :time, ringingCallFrom = :from, lastActivityAt = :time',
                                ConditionExpression: '#status = :online',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':ringing': 'ringing',
                                    ':callId': callToAssign.callId,
                                    ':time': assignmentTimestamp,
                                    ':from': callToAssign.phoneNumber || 'Unknown',
                                    ':online': 'Online'
                                }
                            }
                        }
                    ]
                }));

                await chimeVoiceClient.send(new UpdateSipMediaApplicationCallCommand({
                    SipMediaApplicationId: smaId,
                    TransactionId: callToAssign.callId,
                    Arguments: {
                        action: 'BRIDGE_CUSTOMER_INBOUND',
                        meetingId: agentMeeting.MeetingId,
                        customerAttendeeId: customerAttendee.AttendeeId!,
                        customerAttendeeJoinToken: customerAttendee.JoinToken!
                    }
                }));

                console.log(`[checkQueueForWork] Successfully assigned call ${callToAssign.callId} to agent ${agentId} and triggered bridge.`);
                return;
            } catch (err: any) {
                if (err?.name === 'TransactionCanceledException') {
                    console.warn(`[checkQueueForWork] Race condition assigning call for clinic ${clinicId}. Agent or call state changed.`);
                    if (callToAssign?.callId) {
                        console.warn(`[checkQueueForWork] An attendee may have been orphaned for call ${callToAssign.callId}`);
                    }
                } else {
                    console.error(`[checkQueueForWork] Error processing queue for clinic ${clinicId}:`, err);
                }
            }
        }

        console.log(`[checkQueueForWork] No queued calls found for agent ${agentId}.`);
    };
}

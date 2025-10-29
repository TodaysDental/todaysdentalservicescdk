import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';

// This Lambda is the "brain" for call routing.
// It is NOT triggered by API Gateway. It is triggered by the Chime SDK SIP Media Application.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const chime = new ChimeSDKMeetingsClient({});
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;

// Default queue timeout in seconds (10 minutes)
const QUEUE_TIMEOUT = 600;
// Average call duration in seconds (5 minutes) - used for wait time estimation
const AVG_CALL_DURATION = 300;

interface QueueEntry {
    clinicId: string;
    callId: string;
    queuePosition: number;
    queueEntryTime: number;
    phoneNumber: string;
    status: 'queued' | 'connecting' | 'connected' | 'abandoned';
    ttl: number;
}

async function addToQueue(clinicId: string, callId: string, phoneNumber: string): Promise<QueueEntry> {
    // Get current queue position
    const { Items: queueItems } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        KeyConditionExpression: 'clinicId = :cid',
        FilterExpression: 'status = :status',
        ExpressionAttributeValues: {
            ':cid': clinicId,
            ':status': 'queued'
        }
    }));

    const queuePosition = (queueItems?.length || 0) + 1;
    const now = Math.floor(Date.now() / 1000);
    
    const entry: QueueEntry = {
        clinicId,
        callId,
        phoneNumber,
        queuePosition,
        queueEntryTime: now,
        status: 'queued',
        ttl: now + QUEUE_TIMEOUT
    };

    await ddb.send(new PutCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Item: entry
    }));

    return entry;
}

async function getQueuePosition(clinicId: string, callId: string): Promise<{ position: number, estimatedWaitTime: number } | null> {
    // Get all queued calls for this clinic
    const { Items: queueItems } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        KeyConditionExpression: 'clinicId = :cid',
        FilterExpression: 'status = :status',
        ExpressionAttributeValues: {
            ':cid': clinicId,
            ':status': 'queued'
        }
    }));

    if (!queueItems) return null;

    // Find this call's position
    const currentCall = queueItems.find(item => item.callId === callId);
    if (!currentCall) return null;

    // Get number of online agents for wait time calculation
    const { Items: onlineAgents } = await ddb.send(new QueryCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status',
        FilterExpression: 'contains(activeClinicIds, :clinicId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':status': 'Online',
            ':clinicId': clinicId,
        }
    }));

    const numAgents = onlineAgents?.length || 1;
    const position = currentCall.queuePosition;
    
    // Estimate wait time based on position, number of agents, and average call duration
    const estimatedWaitTime = Math.ceil((position / numAgents) * AVG_CALL_DURATION);

    return { position, estimatedWaitTime };
}

async function removeFromQueue(clinicId: string, callId: string, status: QueueEntry['status'] = 'connected'): Promise<void> {
    const { Items } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :cid',
        ExpressionAttributeValues: { ':cid': callId }
    }));

    if (!Items?.[0]) return;

    const currentPosition = Items[0].queuePosition;

    // Update this call's status
    await ddb.send(new UpdateCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        Key: {
            clinicId,
            queuePosition: currentPosition
        },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status }
    }));

    // Reorder remaining queue positions
    if (status === 'connected' || status === 'abandoned') {
        const { Items: remainingItems } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            KeyConditionExpression: 'clinicId = :cid',
            FilterExpression: '#status = :status AND queuePosition > :pos',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':status': 'queued',
                ':pos': currentPosition
            }
        }));

        if (remainingItems) {
            await Promise.all(remainingItems.map(item =>
                ddb.send(new UpdateCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Key: {
                        clinicId,
                        queuePosition: item.queuePosition
                    },
                    UpdateExpression: 'SET queuePosition = :newPos',
                    ExpressionAttributeValues: {
                        ':newPos': item.queuePosition - 1
                    }
                }))
            ));
        }
    }
}

// TTL for temporary meetings (5 minutes)
const MEETING_TTL = 5 * 60;

// --- Chime Action Builders ---
// These functions create the JSON response Chime expects.

const buildActions = (actions: any[]) => ({
    SchemaVersion: '1.0',
    Actions: actions,
});

const buildJoinChimeMeetingAction = (meetingInfo: any, attendeeInfo: any) => ({
    Type: 'JoinChimeMeeting',
    Parameters: {
        JoinToken: attendeeInfo.JoinToken,
        MeetingId: meetingInfo.MeetingId,
        AttendeeId: attendeeInfo.AttendeeId,
    },
});

const buildJoinChimeMeetingActionOutbound = (meetingId: string, attendeeId: string) => ({
    Type: 'JoinChimeMeeting',
    Parameters: {
        // For the outbound leg, we only need the IDs to join the existing meeting
        MeetingId: meetingId,
        AttendeeId: attendeeId,
    },
});

const buildSpeakAndBridgeAction = (message: string) => ({
    Type: 'SpeakAndBridge',
    Parameters: {
        CallId: 'none', // Speaks to the current caller
        Speak: {
            Text: message,
            Voice: 'Joanna', // Standard AWS Polly voice
            Engine: 'neural',
        },
        Bridge: {
            Target: 'Hangup', // Hangs up after speaking
        }
    }
});

const buildHangupAction = (message?: string) => {
    if (message) {
         return buildSpeakAndBridgeAction(message);
    }
    return { Type: 'Hangup' };
};

// --- Meeting Management ---
async function createIncomingCallMeeting(callId: string, clinicId: string) {
    const meetingResponse = await chime.send(new CreateMeetingCommand({
        ClientRequestToken: `incoming-${callId}`,
        MediaRegion: process.env.AWS_REGION,
        ExternalMeetingId: `incoming-${callId}-${clinicId}`,
    }));

    const meeting = meetingResponse.Meeting;
    if (!meeting) throw new Error('Failed to create meeting');

    // Store meeting info in DynamoDB with TTL
    await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { callId },
        UpdateExpression: 'SET meetingInfo = :m, ttl = :ttl',
        ExpressionAttributeValues: {
            ':m': meeting,
            ':ttl': Math.floor(Date.now() / 1000) + MEETING_TTL
        }
    }));

    return meeting;
}

async function createAttendeeForAgent(meetingId: string, agentId: string) {
    const attendeeResponse = await chime.send(new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: agentId
    }));

    const attendee = attendeeResponse.Attendee;
    if (!attendee) throw new Error('Failed to create attendee');

    // Update agent's record with meeting and attendee info
    await ddb.send(new UpdateCommand({
        TableName: AGENT_PRESENCE_TABLE_NAME,
        Key: { agentId },
        UpdateExpression: 'SET callAttendeeInfo = :a',
        ExpressionAttributeValues: {
            ':a': attendee
        }
    }));

    return attendee;
}

async function cleanupMeeting(meetingId: string) {
    try {
        await chime.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
    } catch (err) {
        console.warn('Error cleaning up meeting:', err);
    }
}

// --- Phone Number Parser ---
// Parses a +E.164 number from a SIP URI like "sip:+12035551212@..."
function parsePhoneNumber(sipUri: string): string | null {
    try {
        const match = sipUri.match(/sip:(\+\d+)@/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

// --- Main Handler ---
export const handler = async (event: any): Promise<any> => {
    console.log('SMA Event:', JSON.stringify(event, null, 2));

    const eventType = event?.InvocationEventType;
    const callId = event?.CallDetails?.CallId;
    const args = event?.ActionData?.ArgumentsMap || event?.CallDetails?.ArgumentsMap || {};

    try {
        switch (eventType) {
            // Case 1: A new call from the PSTN (customer) to one of our clinic numbers
            case 'NEW_INBOUND_CALL': {
                const toPhoneNumber = parsePhoneNumber(event.CallDetails.SipHeaders.To);
                const callId = event.CallDetails.CallId;

                if (!toPhoneNumber) {
                    console.error("Could not parse 'To' phone number from SIP header");
                    return buildActions([buildHangupAction('There was an error connecting your call.')]);
                }

                // 1. Find which clinic was called
                const { Items: clinics } = await ddb.send(new QueryCommand({
                    TableName: CLINICS_TABLE_NAME,
                    IndexName: 'phoneNumber-index',
                    KeyConditionExpression: 'phoneNumber = :num',
                    ExpressionAttributeValues: { ':num': toPhoneNumber },
                }));

                if (!clinics || clinics.length === 0) {
                    console.warn(`No clinic found for number ${toPhoneNumber}`);
                    return buildActions([buildHangupAction('The number you dialed is not in service.')]);
                }
                const clinicId = clinics[0].clinicId;

                // 2. Find all "Online" agents for that clinic
                const { Items: agents } = await ddb.send(new QueryCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    IndexName: 'status-index',
                    KeyConditionExpression: '#status = :status',
                    FilterExpression: 'contains(activeClinicIds, :clinicId)',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':status': 'Online',
                        ':clinicId': clinicId,
                    },
                }));

                if (!agents || agents.length === 0) {
                    console.log(`No 'Online' agents found for clinic ${clinicId}. Adding to queue.`);
                    
                    // Add the call to the queue
                    const queueEntry = await addToQueue(clinicId, callId, toPhoneNumber);
                    
                    // Get estimated wait time
                    const queueInfo = await getQueuePosition(clinicId, callId);
                    
                    if (!queueInfo) {
                        return buildActions([buildSpeakAndBridgeAction('There was an error adding you to the queue. Please try again later.')]);
                    }

                    const waitMinutes = Math.ceil(queueInfo.estimatedWaitTime / 60);
                    const message = `All agents are currently busy. You are number ${queueInfo.position} in line. ` +
                                  `The estimated wait time is ${waitMinutes} minutes. ` +
                                  `Please stay on the line and an agent will assist you shortly.`;
                    
                    // Create a meeting for the queued call
                    const meeting = await createIncomingCallMeeting(callId, clinicId);
                    
                    // Keep the caller in a loop with periodic updates
                    return buildActions([
                        buildSpeakAndBridgeAction(message),
                        {
                            Type: 'Play',
                            Parameters: {
                                AudioSource: {
                                    Type: 'S3',
                                    BucketName: 'your-hold-music-bucket',
                                    Key: 'hold-music.wav'
                                }
                            }
                        }
                    ]);
                }

                try {
                    // 3. Create a new meeting for this incoming call
                    const meeting = await createIncomingCallMeeting(callId, clinicId);
                    
                    if (!meeting.MeetingId) {
                        throw new Error('Meeting created without MeetingId');
                    }

                    // 4. Create attendees for all available agents
                    const attendeePromises = agents.map(agent => 
                        agent.agentId ? createAttendeeForAgent(meeting.MeetingId!, agent.agentId) : null
                    ).filter((p): p is Promise<any> => p !== null);
                    
                    const attendees = await Promise.all(attendeePromises);

                    // 5. Store the call information
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { callId },
                        UpdateExpression: 'SET clinicId = :c, agentIds = :a, callStatus = :s, meetingId = :m',
                        ExpressionAttributeValues: {
                            ':c': clinicId,
                            ':a': agents.filter(a => a.agentId).map(a => a.agentId),
                            ':s': 'ringing',
                            ':m': meeting.MeetingId
                        }
                    }));

                    // 6. Ring all agents simultaneously by joining them to the meeting
                    console.log(`Ringing ${agents.length} agents for clinic ${clinicId}`);
                    
                    // Start with a welcome message and join the caller to the meeting
                    const actions = [
                        buildSpeakAndBridgeAction('Please hold while we connect you with an available agent.'),
                        buildJoinChimeMeetingAction(meeting, attendees[0])
                    ];

                    // Set a timer to clean up the meeting if no one answers
                    setTimeout(async () => {
                        try {
                            const { Items } = await ddb.send(new QueryCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                KeyConditionExpression: 'callId = :id',
                                ExpressionAttributeValues: { ':id': callId }
                            }));

                            const callRecord = Items?.[0];
                            if (callRecord && callRecord.callStatus === 'ringing' && meeting.MeetingId) {
                                await cleanupMeeting(meeting.MeetingId);
                                console.log(`No answer - cleaned up meeting ${meeting.MeetingId}`);
                            }
                        } catch (err) {
                            console.error('Error in cleanup timer:', err);
                        }
                    }, MEETING_TTL * 1000);

                    return buildActions(actions);

                } catch (err) {
                    console.error('Error setting up simultaneous ring:', err);
                    return buildActions([buildHangupAction('There was an error connecting your call. Please try again.')]);
                }
            }

            // Case 2: A new call *from* our system (agent outbound call)
            // This event is triggered by the CreateSipMediaApplicationCall in outbound-call.ts
            case 'NEW_OUTBOUND_CALL': {
                const { agentId, meetingId, attendeeId } = args;

                if (!agentId || !meetingId || !attendeeId) {
                    console.error('Missing arguments for NEW_OUTBOUND_CALL', args);
                     return buildActions([buildHangupAction()]);
                }

                console.log(`Joining outbound call leg to agent ${agentId}'s meeting ${meetingId}`);
                
                // This joins the new outbound call (to the customer)
                // into the agent's existing meeting.
                return buildActions([
                    buildJoinChimeMeetingActionOutbound(meetingId, attendeeId)
                ]);
            }
            
            // Case 3: Transfer initiated
            case 'TRANSFER_INITIATED': {
                const { fromAgentId, toAgentId } = args;
                if (!fromAgentId || !toAgentId) {
                    console.error('Missing agent IDs in transfer request');
                    return buildActions([]);
                }

                // Get target agent's status
                const { Item: targetAgent } = await ddb.send(new GetCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { agentId: toAgentId }
                }));

                if (!targetAgent || targetAgent.status !== 'Online') {
                    return buildActions([
                        buildSpeakAndBridgeAction('The requested agent is not available. Transfer cancelled.')
                    ]);
                }

                // Create attendee for target agent
                const { Item: callRecord } = await ddb.send(new GetCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { callId }
                }));

                if (!callRecord?.meetingInfo?.MeetingId) {
                    console.error('No active meeting found for transfer');
                    return buildActions([]);
                }

                const attendee = await createAttendeeForAgent(callRecord.meetingInfo.MeetingId, toAgentId);

                // Update call record with transfer status
                await ddb.send(new UpdateCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { callId },
                    UpdateExpression: 'SET transferStatus = :ts, transferToAgentId = :ta',
                    ExpressionAttributeValues: {
                        ':ts': 'pending',
                        ':ta': toAgentId
                    }
                }));

                // Notify customer of transfer
                return buildActions([
                    buildSpeakAndBridgeAction('Please hold while we transfer you to another agent.')
                ]);
            }

            // Case 4: Agent accepts the meeting
            case 'MEETING_ACCEPTED': {
                const { meetingId, agentId } = args;
                if (!meetingId || !agentId) {
                    console.error('Missing meetingId or agentId in MEETING_ACCEPTED event');
                    return buildActions([]);
                }

                // Check if this is a transfer acceptance
                const { Item: callRecord } = await ddb.send(new GetCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    Key: { callId }
                }));

                if (callRecord?.transferStatus === 'pending' && callRecord.transferToAgentId === agentId) {
                    // This is a transfer acceptance
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { callId },
                        UpdateExpression: 'SET callStatus = :s, assignedAgentId = :a, transferStatus = :ts, previousAgentId = :pa',
                        ExpressionAttributeValues: {
                            ':s': 'connected',
                            ':a': agentId,
                            ':ts': 'completed',
                            ':pa': callRecord.assignedAgentId
                        }
                    }));

                    // Announce transfer completion to customer
                    return buildActions([
                        buildSpeakAndBridgeAction('You have been transferred to another agent.')
                    ]);
                } else {
                    // Normal call acceptance
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { callId },
                        UpdateExpression: 'SET callStatus = :s, assignedAgentId = :a',
                        ExpressionAttributeValues: {
                            ':s': 'connected',
                            ':a': agentId
                        }
                    }));
                }

                console.log(`Call ${callId} accepted by agent ${agentId}`);
                return buildActions([]);
            }

            // Case 4: Call actions completed, or call ended
            case 'ACTION_SUCCESSFUL':
            case 'HANGUP':
            case 'CALL_ENDED': {
                // Clean up the meeting if it exists
                const { Items } = await ddb.send(new QueryCommand({
                    TableName: AGENT_PRESENCE_TABLE_NAME,
                    KeyConditionExpression: 'callId = :id',
                    ExpressionAttributeValues: { ':id': callId },
                    ProjectionExpression: 'meetingId, clinicId'
                }));

                if (Items && Items[0]) {
                    if (Items[0].meetingId) {
                        await cleanupMeeting(Items[0].meetingId);
                    }
                    
                    // Mark the call as abandoned in the queue if it exists
                    if (Items[0].clinicId) {
                        await removeFromQueue(Items[0].clinicId, callId, 'abandoned');
                    }
                }

                console.log(`Event ${eventType} received for call ${callId}. Cleaned up resources.`);
                return buildActions([]);
            }

            default:
                // Unknown event
                console.warn('Unknown event type:', eventType);
                return buildActions([buildHangupAction()]);
        }
    } catch (err: any) {
        console.error('Error in SMA handler:', err);
        // Hang up the call on any unexpected error
        return buildActions([buildHangupAction('An internal error occurred. Please try again.')]);
    }
};


import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { 
    ChimeSDKMeetingsClient, 
    CreateAttendeeCommand, 
    DeleteMeetingCommand
} from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';

// This Lambda is the "brain" for call routing.
// It is NOT triggered by API Gateway. It is triggered by the Chime SDK SIP Media Application.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// Chime meetings must be created in a supported media region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME;
const HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET;
const MAX_RING_AGENTS = Math.max(1, Number.parseInt(process.env.MAX_RING_AGENTS || '25', 10));
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidTransactionId(value: unknown): value is string {
    return typeof value === 'string' && UUID_REGEX.test(value);
}

// Default queue timeout in seconds (24 hours) - Increased to handle long calls
const QUEUE_TIMEOUT = 24 * 60 * 60;
// Average call duration in seconds (5 minutes) - used for wait time estimation
const AVG_CALL_DURATION = 300;

// Call states
type CallStatus = 
    | 'queued'              // Call is in the queue, waiting for an agent
    | 'ringing'             // Call is ringing to agents
    | 'connected'           // Call is connected to an agent
    | 'on_hold'             // Call is on hold (agent stepped away)
    | 'completed'           // Call was completed normally
    | 'abandoned'           // Call was abandoned (customer hung up)
    | 'timeout'             // Call timed out (no answer)
    | 'no_agents_available' // No agents available to take the call
    | 'dialing'             // For outbound: call is being dialed
    | 'failed';             // Call failed for technical reasons

// Valid call state transitions
const VALID_STATE_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
    'queued': ['ringing', 'abandoned', 'timeout', 'no_agents_available'],
    'ringing': ['connected', 'queued', 'abandoned', 'no_agents_available', 'timeout'],
    'dialing': ['connected', 'timeout', 'abandoned', 'failed'],
    'connected': ['on_hold', 'completed', 'abandoned'],
    'on_hold': ['connected', 'abandoned', 'completed'],
    'timeout': [],
    'completed': [],
    'abandoned': [],
    'no_agents_available': ['ringing', 'abandoned', 'queued'],
    'failed': []
};


// Helper function to validate state transitions
function isValidStateTransition(fromState: CallStatus, toState: CallStatus): boolean {
    return VALID_STATE_TRANSITIONS[fromState]?.includes(toState) ?? false;
}

interface QueueEntry {
    clinicId: string;
    callId: string;
    queuePosition: number;
    queueEntryTime: number;
    queueEntryTimeIso?: string;
    uniquePositionId?: string;
    phoneNumber: string;
    status: CallStatus;
    ttl: number;
}

async function addToQueue(clinicId: string, callId: string, phoneNumber: string): Promise<QueueEntry> {
    const now = Math.floor(Date.now() / 1000);
    const uuid = randomUUID();
    const uniqueId = `${Date.now()}-${uuid.substring(0, 13)}`;
    const queuePosition = Date.now() + Math.floor(Math.random() * 100);
    
    const entry: QueueEntry = {
        clinicId,
        callId,
        phoneNumber,
        queuePosition,
        queueEntryTime: now,
        queueEntryTimeIso: new Date().toISOString(),
        uniquePositionId: uniqueId,
        status: 'queued',
        ttl: now + QUEUE_TIMEOUT
    };

    try {
        await ddb.send(new PutCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Item: entry,
            ConditionExpression: 'attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)'
        }));
    } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
            console.error('[addToQueue] Duplicate queue entry detected', { clinicId, callId, queuePosition });
            const retryUuid = randomUUID();
            const retryUniqueId = `${Date.now()}-${retryUuid.substring(0, 13)}`;
            entry.uniquePositionId = retryUniqueId;
            const retryPosition = Date.now() + 1000 + Math.floor(Math.random() * 1000);
            entry.queuePosition = retryPosition;
            await ddb.send(new PutCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Item: entry
            }));
        } else {
            throw err;
        }
    }

    return entry;
}

async function getQueuePosition(clinicId: string, callId: string): Promise<{ position: number, estimatedWaitTime: number } | null> {
    try {
        const { Items: thisCallItems } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId }
        }));
        
        if (!thisCallItems?.[0]) return null;

        const thisCall = thisCallItems[0];
        const { queueEntryTime, status } = thisCall;
        
        if (status !== 'queued' || !queueEntryTime) return null;
        
        const { Items: allQueuedCalls } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            KeyConditionExpression: 'clinicId = :cid',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':status': 'queued'
            },
            ConsistentRead: true 
        }));
        
        if (!allQueuedCalls) return null;
        
        const sortedCalls = allQueuedCalls.sort((a, b) => a.queueEntryTime - b.queueEntryTime);
        const index = sortedCalls.findIndex(call => call.callId === callId);
        if (index === -1) return null; 
        
        const position = index + 1;
        
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
        const estimatedWaitTime = Math.ceil((position / numAgents) * AVG_CALL_DURATION);

        return { position, estimatedWaitTime };
    } catch (err: any) {
        console.error('[getQueuePosition] Error calculating queue position:', err);
        return null;
    }
}

// Note: This function is no longer used in the primary "ringing" flow,
// but is kept for the "queued" flow.
async function removeFromQueue(clinicId: string, callId: string, status: QueueEntry['status'] = 'connected'): Promise<void> {
    const { Items } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :cid',
        ExpressionAttributeValues: { ':cid': callId }
    }));

    if (!Items?.[0]) return;

    const currentPosition = Items[0].queuePosition;
    const currentStatus = Items[0].status;
    
    if (!isValidStateTransition(currentStatus as CallStatus, status as CallStatus)) {
        console.error(`[removeFromQueue] Invalid state transition from ${currentStatus} to ${status} for call ${callId}`);
        throw new Error(`Cannot transition call from ${currentStatus} to ${status}`);
    }
    
    console.log(`[removeFromQueue] Valid state transition from ${currentStatus} to ${status} for call ${callId}`);
    
    try {
        await ddb.send(new UpdateCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Key: {
                clinicId,
                queuePosition: currentPosition
            },
            UpdateExpression: 'SET #status = :status, endedAt = :timestamp',
            ExpressionAttributeNames: { '#status': 'status' },
            ConditionExpression: '#status = :expectedStatus',
            ExpressionAttributeValues: {
                ':status': status,
                ':timestamp': Math.floor(Date.now() / 1000),
                ':expectedStatus': currentStatus
            }
        }));
    } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
            console.warn(`Race condition detected removing call ${callId} from queue - already updated`);
            return;
        }
        throw err;
    }
}


// --- Chime Action Builders ---
const buildActions = (actions: any[]) => ({
    SchemaVersion: '1.0',
    Actions: actions,
});

const buildJoinChimeMeetingAction = (callLegId: string, meetingInfo: any, attendeeInfo: any) => ({
    Type: 'JoinChimeMeeting',
    Parameters: {
        CallId: callLegId,
        JoinToken: attendeeInfo.JoinToken,
        MeetingId: meetingInfo.MeetingId,
        AttendeeId: attendeeInfo.AttendeeId,
    },
});

const buildCallAndBridgeAction = (callerIdNumber: string, targetPhoneNumber: string, sipHeaders?: any) => ({
    Type: 'CallAndBridge',
    Parameters: {
        CallTimeoutSeconds: 30,
        CallerIdNumber: callerIdNumber,
        Endpoints: [{
            Uri: targetPhoneNumber,
            BridgeEndpointType: 'PSTN'
        }],
        SipHeaders: sipHeaders || {}
    }
});

const buildSpeakAction = (text: string, voiceId: string = 'Joanna', engine: string = 'neural') => ({
    Type: 'Speak',
    Parameters: {
        Text: text,
        Engine: engine,
        LanguageCode: 'en-US',
        TextType: 'text',
        VoiceId: voiceId
    }
});

const buildModifyChimeMeetingAttendeesAction = (meetingId: string, operation: 'Add' | 'Remove', attendeeIds: string[]) => ({
    Type: 'ModifyChimeMeetingAttendees',
    Parameters: {
        MeetingId: meetingId,
        Operation: operation,
        AttendeeIds: attendeeIds
    }
});

const buildSpeakAndBridgeAction = (text: string, voiceId: string = 'Joanna', engine: string = 'neural') => ({
    Type: 'SpeakAndBridge',
    Parameters: {
        Text: text,
        Engine: engine,
        LanguageCode: 'en-US',
        TextType: 'text',
        VoiceId: voiceId
    }
});

const buildPauseAction = (durationInMilliseconds: number) => ({
    Type: 'Pause',
    Parameters: {
        DurationInMilliseconds: durationInMilliseconds
    }
});

// Updated to include Repeat parameter
const buildPlayAudioAction = (audioSource: string, repeat: number = 1) => ({
    Type: 'PlayAudio',
    Parameters: {
        AudioSource: {
            Type: 'S3',
            BucketName: HOLD_MUSIC_BUCKET,
            Key: audioSource
        },
        PlaybackTerminators: ['#', '*'],
        Repeat: repeat,
    },
});

const buildPlayAudioAndGetDigitsAction = (audioSource: string, maxDigits: number = 1, timeoutInSeconds: number = 10) => ({
    Type: 'PlayAudioAndGetDigits',
    Parameters: {
        InputDigitsRegex: `^\\d{1,${maxDigits}}$`,
        AudioSource: {
            Type: 'S3',
            BucketName: HOLD_MUSIC_BUCKET,
            Key: audioSource
        },
        FailureAudioSource: {
            Type: 'S3',
            BucketName: HOLD_MUSIC_BUCKET,
            Key: 'error-prompt.wav'
        },
        MinNumberOfDigits: 1,
        MaxNumberOfDigits: maxDigits,
        TerminatorDigits: ['#'],
        InBetweenDigitsDurationInMilliseconds: 5000,
        Repeat: 3,
        RepeatDurationInMilliseconds: timeoutInSeconds * 1000
    }
});

const buildHangupAction = (message?: string) => {
    if (message) {
        return {
            Type: 'Speak',
            Parameters: {
                Text: message,
                Engine: 'neural',
                LanguageCode: 'en-US',
                TextType: 'text',
                VoiceId: 'Joanna'
            }
        };
    }
    return { Type: 'Hangup' };
};

async function cleanupMeeting(meetingId: string) {
    try {
        await chime.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
    } catch (err: any) {
        if (err.name !== 'NotFoundException') {
            console.warn('Error cleaning up meeting:', err);
        }
    }
}

// --- Phone Number Parser ---
function parsePhoneNumber(sipUri: string): string | null {
    try {
        const match = sipUri.match(/sip:(\+\d+)@/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

function getPstnLegCallId(event: any): string | undefined {
    const participants = event?.CallDetails?.Participants;
    if (!Array.isArray(participants) || participants.length === 0) {
        return undefined;
    }

    const legAParticipant = participants.find((participant: any) => participant.ParticipantTag === 'LEG-A');
    return legAParticipant?.CallId || participants[0]?.CallId;
}

// --- Main Handler ---
export const handler = async (event: any): Promise<any> => {
    console.log('SMA Event:', JSON.stringify(event, null, 2));

    const eventType = event?.InvocationEventType;
    const callId = event?.CallDetails?.TransactionId;
    if (!isValidTransactionId(callId)) {
        console.error('[inbound-router] Invalid or missing TransactionId', {
            rawTransactionId: callId,
            eventType: event?.InvocationEventType
        });
        return buildActions([buildHangupAction('There was an error connecting your call. Please try again later.')]);
    }
    const args = event?.ActionData?.Parameters?.Arguments || event?.ActionData?.ArgumentsMap || event?.CallDetails?.ArgumentsMap || {};
    const pstnLegCallId = getPstnLegCallId(event);

    try {
            switch (eventType) {
                // Case 1: A new call from the PSTN (customer) to one of our clinic numbers
                case 'NEW_INBOUND_CALL': {
                    const sipHeaders = event?.CallDetails?.SipHeaders || {};

                    const getPhoneFromValue = (value?: string | null) => {
                        if (!value) return null;
                        if (value.startsWith('+')) return value;
                        return parsePhoneNumber(value);
                    };

                    const participants = event?.CallDetails?.Participants || [];
                    const participantTo = participants[0]?.To;
                    const participantFrom = participants[0]?.From;

                    const toPhoneNumber =
                        getPhoneFromValue(typeof sipHeaders.To === 'string' ? sipHeaders.To : null) ||
                        getPhoneFromValue(typeof participantTo === 'string' ? participantTo : null);

                    const fromPhoneNumber =
                        getPhoneFromValue(typeof sipHeaders.From === 'string' ? sipHeaders.From : null) ||
                        getPhoneFromValue(typeof participantFrom === 'string' ? participantFrom : null) ||
                        'Unknown';

                    console.log('[NEW_INBOUND_CALL] Received inbound call', { callId, to: toPhoneNumber, from: fromPhoneNumber });

                    if (!toPhoneNumber) {
                        console.error("Could not parse 'To' phone number from event", {
                            rawSipTo: event.CallDetails?.SipHeaders?.To,
                            rawParticipantTo: participantTo,
                        });
                        return buildActions([buildHangupAction('There was an error connecting your call.')]);
                    }

                    // 1. Find which clinic was called
                    // (Assuming you have a GSI named 'phoneNumber-index' on your ClinicsTable)
                    const { Items: clinics } = await ddb.send(new QueryCommand({
                        TableName: CLINICS_TABLE_NAME,
                        IndexName: 'phoneNumber-index', // Make sure this GSI exists
                        KeyConditionExpression: 'phoneNumber = :num',
                        ExpressionAttributeValues: { ':num': toPhoneNumber },
                    }));

                    if (!clinics || clinics.length === 0) {
                        console.warn(`No clinic found for number ${toPhoneNumber}`);
                        return buildActions([buildHangupAction('The number you dialed is not in service.')]);
                    }
                    const clinicId = clinics[0].clinicId;
                    console.log(`[NEW_INBOUND_CALL] Call is for clinic ${clinicId}`);

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
                        Limit: MAX_RING_AGENTS
                    }));

                    const sortedAgents = (agents || []).sort((a, b) =>
                        (a?.lastActivityAt || 'z').localeCompare(b?.lastActivityAt || 'z')
                    );

                    let callAssigned = false;
                    let assignedAgentId: string | null = null;

                    if (sortedAgents.length > 0) {
                        const now = Date.now();
                        const queuePosition = now + Math.floor(Math.random() * 100);
                        const queueEntryTime = Math.floor(now / 1000);
                        const queueEntryTimeIso = new Date(now).toISOString();
                        const baseQueueItem = {
                            clinicId,
                            callId,
                            queuePosition,
                            queueEntryTime,
                            queueEntryTimeIso,
                            phoneNumber: fromPhoneNumber,
                            status: 'ringing',
                            direction: 'inbound',
                            ttl: queueEntryTime + QUEUE_TIMEOUT
                        };

                        for (const agent of sortedAgents) {
                            const agentId = agent?.agentId;
                            if (!agentId) {
                                continue;
                            }

                            const callQueueItem = {
                                ...baseQueueItem,
                                agentIds: [agentId],
                                assignedAgentId: agentId
                            };
                            const assignmentTimestamp = new Date().toISOString();

                            try {
                                await ddb.send(new TransactWriteCommand({
                                    TransactItems: [
                                        {
                                            Put: {
                                                TableName: CALL_QUEUE_TABLE_NAME,
                                                Item: callQueueItem,
                                                ConditionExpression: 'attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)'
                                            }
                                        },
                                        {
                                            Update: {
                                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                                Key: { agentId },
                                                UpdateExpression: 'SET #status = :ringing, ringingCallId = :callId, ringingCallTime = :time, ringingCallFrom = :from, lastActivityAt = :time',
                                                ConditionExpression: '#status = :online',
                                                ExpressionAttributeNames: { '#status': 'status' },
                                                ExpressionAttributeValues: {
                                                    ':ringing': 'ringing',
                                                    ':callId': callId,
                                                    ':time': assignmentTimestamp,
                                                    ':from': fromPhoneNumber,
                                                    ':online': 'Online'
                                                }
                                            }
                                        }
                                    ]
                                }));

                                callAssigned = true;
                                assignedAgentId = agentId;
                                console.log(`[NEW_INBOUND_CALL] Atomically assigned call ${callId} to agent ${agentId}`);
                                break;
                            } catch (err: any) {
                                if (err?.name === 'TransactionCanceledException') {
                                    console.warn(`[NEW_INBOUND_CALL] Agent ${agentId} was claimed by another call. Trying next agent.`);
                                } else {
                                    console.error(`[NEW_INBOUND_CALL] Transaction failed for agent ${agentId}:`, err);
                                }
                            }
                        }
                    }

                    if (callAssigned && assignedAgentId) {
                        console.log(`[NEW_INBOUND_CALL] Placing customer ${callId} on hold, ringing agent ${assignedAgentId}.`);
                        return buildActions([
                            buildSpeakAction('Thank you for calling. Please hold while we connect you with an available agent.'),
                            buildPauseAction(500),
                            buildPlayAudioAction('hold-music.wav', 999)
                        ]);
                    }

                    console.log(`[NEW_INBOUND_CALL] No available Online agents for clinic ${clinicId}. Adding to queue.`);
                    try {
                        const queueEntry = await addToQueue(clinicId, callId, fromPhoneNumber);
                        console.log('[NEW_INBOUND_CALL] Call added to queue', { clinicId, callId, queueEntry });

                        const queueInfo = await getQueuePosition(clinicId, callId);
                        const waitMinutes = Math.ceil((queueInfo?.estimatedWaitTime || 120) / 60);
                        const message = `All agents are currently busy. You are number ${queueInfo?.position || 1} in line. ` +
                                      `The estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}. ` +
                                      `Please stay on the line.`;

                        return buildActions([
                            buildSpeakAction(message),
                            buildPauseAction(500),
                            buildPlayAudioAction('hold-music.wav', 999)
                        ]);
                    } catch (queueErr) {
                        console.error('Error queuing call:', queueErr);
                        return buildActions([buildHangupAction('All agents are currently busy. Please try again later.')]);
                    }

                }

            // Case 2: A new call *from* our system (agent outbound call)
            // This is triggered by outbound-call.ts
            case 'NEW_OUTBOUND_CALL': {
                console.log(`[NEW_OUTBOUND_CALL] Initiated for call ${callId}`, args);
                // The outbound-call.ts Lambda has already created the call record
                // and updated the agent's status to 'dialing'.
                // This event just confirms the SMA is dialing. We let it dial.
                // The logic will be picked up by CALL_ANSWERED.
                return buildActions([]);
            }
            
            // Case 3: Customer answers an outbound call
            case 'CALL_ANSWERED': {
                console.log(`[CALL_ANSWERED] Received for call ${callId}.`, args);

                // Query DDB to get call details for this TransactionId
                const { Items: callRecords } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :id',
                    ExpressionAttributeValues: { ':id': callId }
                }));

                if (!callRecords || callRecords.length === 0) {
                     console.error(`[CALL_ANSWERED] No call record found for callId ${callId}`);
                     return buildActions([buildHangupAction()]);
                }
                
                const callRecord = callRecords[0];
                const { meetingInfo, assignedAgentId, status } = callRecord;

                // Check if this is an outbound call connecting
                if (status === 'dialing' && meetingInfo?.MeetingId && assignedAgentId) {
                    const meetingId = meetingInfo.MeetingId;
                    console.log(`[CALL_ANSWERED] Customer answered outbound call ${callId}. Bridging to meeting ${meetingId}.`);

                    try {
                        // 1. Create a customer attendee for the agent's meeting
                        const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                            MeetingId: meetingId,
                            ExternalUserId: `customer-pstn-${callId}`
                        }));
                        
                        if (!customerAttendeeResponse.Attendee?.AttendeeId) {
                            throw new Error('Failed to create customer attendee for outbound call');
                        }
                        const customerAttendee = customerAttendeeResponse.Attendee;
                        console.log(`[CALL_ANSWERED] Created customer attendee ${customerAttendee.AttendeeId}`);
                        
                        // 2. Update Call Queue Status
                        try {
                            const { Items: callRecords } = await ddb.send(new QueryCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                IndexName: 'callId-index',
                                KeyConditionExpression: 'callId = :id',
                                ExpressionAttributeValues: { ':id': callId }
                            }));
                            
                            if (callRecords && callRecords[0]) {
                                const { clinicId, queuePosition } = callRecords[0];
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId, queuePosition },
                                    UpdateExpression: 'SET #status = :status, acceptedAt = :timestamp, customerAttendeeInfo = :customerAttendee',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':status': 'connected',
                                        ':timestamp': new Date().toISOString(),
                                        ':customerAttendee': customerAttendee
                                    }
                                }));
                                console.log(`[CALL_ANSWERED] Call queue updated for ${callId}`);
                                
                                // FIX: Update the agent's status to 'OnCall'
                                await ddb.send(new UpdateCommand({
                                    TableName: AGENT_PRESENCE_TABLE_NAME,
                                    Key: { agentId: assignedAgentId },
                                    UpdateExpression: 'SET #status = :onCall, currentCallId = :callId, lastActivityAt = :now',
                                    ConditionExpression: '#status = :dialing',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':onCall': 'OnCall', // Or 'In Call', matching your other logic
                                        ':callId': callId,
                                        ':now': new Date().toISOString(),
                                        ':dialing': 'dialing'
                                    }
                                }));
                                console.log(`[CALL_ANSWERED] Agent ${assignedAgentId} status updated to OnCall`);
                            }
                        } catch (queueErr) {
                            console.warn(`[CALL_ANSWERED] Failed to update call queue:`, queueErr);
                        }
                        
                        // 3. Bridge customer (PSTN) into the agent's meeting
                        if (!pstnLegCallId) {
                            console.error('[CALL_ANSWERED] Missing PSTN CallId for JoinChimeMeeting');
                            return buildActions([
                                buildHangupAction('Unable to connect your call. Please try again.')
                            ]);
                        }

                        return buildActions([
                            buildJoinChimeMeetingAction(pstnLegCallId, { MeetingId: meetingId }, customerAttendee)
                        ]);
                        
                    } catch (err: any) {
                        console.error(`[CALL_ANSWERED] Error bridging customer to meeting:`, err);
                        return buildActions([
                            buildHangupAction('Unable to connect your call. Please try again.')
                        ]);
                    }
                }
                
                // If it's not an outbound call, it's an informational event.
                console.log(`[CALL_ANSWERED] Informational event for call ${callId}. No action needed.`);
                return buildActions([]);
            }



            // Case 5: Hold call - triggered by hold-call.ts API
            case 'HOLD_CALL': {
                if (args.action === 'HOLD_CALL' && args.agentId) {
                    const { agentId, meetingId, agentAttendeeId, removeAgent } = args;
                    console.log(`Processing hold request for call ${callId} from agent ${agentId}`, { meetingId, agentAttendeeId, removeAgent });
                    
                    const actions = [];
                    
                    if (meetingId && agentAttendeeId && (removeAgent === 'true' || removeAgent === true)) {
                        console.log(`[HOLD_CALL] Removing agent ${agentId} (attendee ${agentAttendeeId}) from meeting ${meetingId}`);
                        actions.push({
                            Type: 'ModifyChimeMeetingAttendees',
                            Parameters: {
                                Operation: 'Remove',
                                MeetingId: meetingId,
                                AttendeeList: [agentAttendeeId]
                            }
                        });
                    } else {
                        console.warn(`[HOLD_CALL] Cannot remove agent from meeting - missing required info`, {
                            hasMeetingId: !!meetingId,
                            hasAttendeeId: !!agentAttendeeId,
                            removeAgent
                        });
                    }
                    
                    actions.push(buildSpeakAction('You have been placed on hold. Please wait.'));
                    actions.push(buildPauseAction(500));
                    actions.push(buildPlayAudioAction('hold-music.wav', 999)); // Loop hold music
                    
                    return buildActions(actions);
                }
                console.warn('HOLD_CALL event without proper action');
                return buildActions([]);
            }
                
            // Case 6: Resume call - triggered by resume-call.ts API
            case 'RESUME_CALL': {
                if (args.action === 'RESUME_CALL' && args.agentId) {
                    const { agentId, meetingId, agentAttendeeId, reconnectAgent } = args;
                    console.log(`Processing resume request for call ${callId} from agent ${agentId}`, { meetingId, agentAttendeeId, reconnectAgent });

                    const { Items: callRecords } = await ddb.send(new QueryCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        IndexName: 'callId-index',
                        KeyConditionExpression: 'callId = :callId',
                        ExpressionAttributeValues: { ':callId': callId }
                    }));

                    if (!callRecords || callRecords.length === 0) {
                        return buildActions([buildSpeakAction('Unable to resume your call.')]);
                    }

                    const callRecord = callRecords[0];

                    if (!callRecord.customerAttendeeInfo?.AttendeeId) {
                        console.error('No customer attendee info found for call', callId);
                        return buildActions([buildSpeakAction('Unable to reconnect your call.')]);
                    }

                    const actions = [];
                    
                    if (meetingId && agentAttendeeId && (reconnectAgent === 'true' || reconnectAgent === true)) {
                        console.log(`[RESUME_CALL] Adding agent ${agentId} (attendee ${agentAttendeeId}) to meeting ${meetingId}`);
                        actions.push({
                            Type: 'ModifyChimeMeetingAttendees',
                            Parameters: {
                                Operation: 'Add',
                                MeetingId: meetingId,
                                AttendeeList: [agentAttendeeId]
                            }
                        });
                    }
                    
                    // Re-join the customer to the meeting (this stops the hold music)
                    actions.push(buildSpeakAction('Thank you for holding. Reconnecting now.'));
                    if (!pstnLegCallId) {
                        console.error('[RESUME_CALL] Missing PSTN CallId for JoinChimeMeeting');
                        return buildActions([buildSpeakAction('Unable to reconnect your call.')]);
                    }
                    actions.push(buildJoinChimeMeetingAction(pstnLegCallId, callRecord.meetingInfo, callRecord.customerAttendeeInfo));
                    
                    return buildActions(actions);
                }
                
                console.warn('RESUME_CALL event without proper action');
                return buildActions([]);
            }
            
            // Other events from original file
            case 'RING_NEW_AGENTS': {
                // This logic seems fine - it's triggered by call-rejected.ts
                if (args.action === 'RING_NEW_AGENTS' && args.agentIds) {
                    // ... (no changes needed to this case, it's part of the rejection flow) ...
                    console.log(`[RING_NEW_AGENTS] Rerouting call ${callId} to new agents: ${args.agentIds}`);
                    // Find the call record to get meeting info
                    const { Items: callRecords } = await ddb.send(new QueryCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        IndexName: 'callId-index',
                        KeyConditionExpression: 'callId = :callId',
                        ExpressionAttributeValues: { ':callId': callId }
                    }));

                    if (!callRecords || callRecords.length === 0) {
                        console.error('No call record found for ringing new agents');
                        return buildActions([ buildSpeakAndBridgeAction('All agents are busy. Please stay on the line.') ]);
                    }
                    
                    const callRecord = callRecords[0];
                    const agentIds = args.agentIds.split(',');

                    // Update agent presence for new agents
                    await Promise.all(agentIds.map(async (agentId: string) => {
                        try {
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                UpdateExpression: 'SET ringingCallId = :callId, #status = :ringingStatus, ringingCallTime = :time, ringingCallFrom = :from',
                                ConditionExpression: 'attribute_exists(agentId) AND #status = :onlineStatus AND attribute_not_exists(ringingCallId)',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':callId': callId,
                                    ':ringingStatus': 'ringing',
                                    ':time': new Date().toISOString(),
                                    ':from': callRecord.phoneNumber || 'Unknown',
                                    ':onlineStatus': 'Online'
                                }
                            }));
                            console.log(`[RING_NEW_AGENTS] Notified new agent ${agentId}`);
                        } catch (err: any) {
                             if (err.name === 'ConditionalCheckFailedException') {
                                console.warn(`[RING_NEW_AGENTS] Agent ${agentId} not available - skipping`);
                            } else {
                                console.error(`[RING_NEW_AGENTS] Error notifying agent ${agentId}:`, err);
                            }
                        }
                    }));
                    
                    // Let customer know we're still trying
                    return buildActions([
                        buildSpeakAndBridgeAction('We are connecting you with the next available agent. Please hold.')
                    ]);
                }
                return buildActions([]);
            }

            // Handle call update requests (e.g., hangup from another Lambda)
            case 'CALL_UPDATE_REQUESTED': {
                console.log(`[CALL_UPDATE_REQUESTED] Received for call ${callId}`, args);

                // *** FIX: Handle BRIDGE_CUSTOMER_INBOUND action here ***
                // This is triggered by call-accepted.ts
                if (args.action === 'BRIDGE_CUSTOMER_INBOUND' && args.meetingId && args.customerAttendeeId && args.customerAttendeeJoinToken) {
                    const { meetingId, customerAttendeeId, customerAttendeeJoinToken } = args;
                    
                    console.log(`[BRIDGE_CUSTOMER_INBOUND] Bridging customer PSTN leg into meeting ${meetingId}`);

                    if (!pstnLegCallId) {
                        console.error('[BRIDGE_CUSTOMER_INBOUND] Missing PSTN CallId for JoinChimeMeeting');
                        return buildActions([buildHangupAction('Unable to connect your call. Please try again.')]);
                    }

                    // Bridge the waiting customer (PSTN) into the agent's meeting
                    return buildActions([
                        buildSpeakAction('An agent will assist you now.'),
                        buildJoinChimeMeetingAction(
                            pstnLegCallId,
                            { MeetingId: meetingId },
                            { AttendeeId: customerAttendeeId, JoinToken: customerAttendeeJoinToken }
                        )
                    ]);
                }
                
                // Check if the update is a Hangup action
                // This is triggered by call-hungup.ts
                if (args.Action === 'Hangup') { // Note: This is 'Action' (capital A)
                    console.log(`[CALL_UPDATE_REQUESTED] Acknowledging Hangup request for call ${callId}`);
                    // Acknowledge by returning the Hangup action
                    return buildActions([
                        { Type: 'Hangup' }
                    ]);
                }
                
                // If it's another action (like 'Hold', etc.), just log and acknowledge
                console.log(`[CALL_UPDATE_REQUESTED] Acknowledging unknown action:`, args);
                return buildActions([]); // Return empty actions to acknowledge
            }

            // Case 7: Call actions completed, or call ended
            case 'HANGUP':
            case 'CALL_ENDED': {
                console.log(`[${eventType}] Call ${callId} ended. Cleaning up resources.`);
                
                const { Items: callRecords } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :id',
                    ExpressionAttributeValues: { ':id': callId }
                }));

                if (callRecords && callRecords[0]) {
                    const callRecord = callRecords[0];
                    const { clinicId, queuePosition, meetingInfo, assignedAgentId, agentIds, status } = callRecord;
                    
                    console.log(`[${eventType}] Found call record`, { callId, status, assignedAgent: assignedAgentId, hasMeeting: !!meetingInfo?.MeetingId });
                    
                    // *** CRITICAL FIX ***
                    // Only delete the meeting if it was a temporary "queue" meeting.
                    // Do NOT delete the meeting if it was an agent's session.
                    if (status === 'queued' && meetingInfo?.MeetingId) {
                        try {
                            await cleanupMeeting(meetingInfo.MeetingId);
                            console.log(`[${eventType}] Cleaned up QUEUE meeting ${meetingInfo.MeetingId}`);
                        } catch (meetingErr) {
                            console.warn(`[${eventType}] Failed to cleanup queue meeting:`, meetingErr);
                        }
                    } else if ((status === 'dialing' || status === 'failed') && meetingInfo?.MeetingId) {
                        try {
                            await cleanupMeeting(meetingInfo.MeetingId);
                            console.log(`[${eventType}] Cleaned up failed outbound meeting ${meetingInfo.MeetingId}`);
                        } catch (meetingErr) {
                            console.warn(`[${eventType}] Failed to cleanup outbound meeting:`, meetingErr);
                        }
                    } else if (meetingInfo?.MeetingId) {
                        console.log(`[${eventType}] Call ended for agent session meeting ${meetingInfo.MeetingId}. Meeting will NOT be deleted.`);
                    }
                    
                    // Update call status in the queue
                    const finalStatus = (status === 'connected' || status === 'on_hold') ? 'completed' : 'abandoned';
                    const callDuration = callRecord.acceptedAt 
                        ? Math.floor(Date.now() / 1000) - Math.floor(new Date(callRecord.acceptedAt).getTime() / 1000)
                        : 0;
                        
                    try {
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'SET #status = :status, endedAt = :timestamp, endedAtIso = :timestampIso, callDuration = :duration REMOVE meetingInfo, customerAttendeeInfo, agentAttendeeInfo',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':status': finalStatus,
                                ':timestamp': Math.floor(Date.now() / 1000),
                                ':timestampIso': new Date().toISOString(),
                                ':duration': callDuration
                            }
                        }));
                        
                    } catch (updateErr) {
                        console.error(`[${eventType}] Failed to update call record:`, updateErr);
                    }
                    
                    // Update agent status if they were assigned
                    if (assignedAgentId) {
                        try {
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: assignedAgentId },
                                UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp, lastCallEndedAt = :timestamp REMOVE currentCallId, callStatus, currentMeetingAttendeeId',
                                ConditionExpression: 'attribute_exists(agentId) AND (currentCallId = :callId OR attribute_not_exists(currentCallId))',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':status': 'Online',
                                    ':timestamp': new Date().toISOString(),
                                    ':callId': callId
                                }
                            }));
                            console.log(`[${eventType}] Agent ${assignedAgentId} marked as available.`);
                        } catch (agentErr: any) {
                            if (agentErr.name === 'ConditionalCheckFailedException') {
                                console.log(`[${eventType}] Agent ${assignedAgentId} was not on this call. Skipping cleanup.`);
                            } else {
                                console.warn(`[${eventType}] Failed to update agent ${assignedAgentId}:`, agentErr);
                            }
                        }
                    }
                    
                    // Clear ringing status for any agents who were ringing but didn't answer
                    if (status === 'ringing' && agentIds && Array.isArray(agentIds) && agentIds.length > 0) {
                        console.log(`[${eventType}] Clearing ringing status for ${agentIds.length} agents`);
                        await Promise.all(agentIds.map((agentId: string) =>
                            ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                UpdateExpression: 'SET #status = :online, lastActivityAt = :timestamp REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
                                ConditionExpression: 'attribute_exists(agentId) AND ringingCallId = :callId',
                                ExpressionAttributeNames: {
                                    '#status': 'status'
                                },
                                ExpressionAttributeValues: {
                                    ':online': 'Online',
                                    ':timestamp': new Date().toISOString(),
                                    ':callId': callId
                                }
                            })).catch((err) => {
                                if (err.name !== 'ConditionalCheckFailedException') {
                                    console.warn(`[${eventType}] Failed to clear ringing for agent ${agentId}:`, err.message);
                                }
                            })
                        ));
                    }
                }

                console.log(`[${eventType}] Call ${callId} cleanup completed.`);
                return buildActions([]);
            }
            
            // --- Informational events ---
            case 'RINGING':
            case 'ACTION_SUCCESSFUL':
            case 'INVALID_LAMBDA_RESPONSE': {
                console.log(`Received informational event type: ${eventType}, returning empty actions.`);
                return buildActions([]);
            }

            case 'ACTION_FAILED': {
                const failedActionType = event?.ActionData?.Type;
                const errorType = event?.ActionData?.ErrorType;
                const errorMessage = event?.ActionData?.ErrorMessage;
                console.warn(`[ACTION_FAILED] ${failedActionType ?? 'Unknown'} failed`, { errorType, errorMessage });

                if (failedActionType === 'PlayAudio') {
                    const audioKey = event?.ActionData?.Parameters?.AudioSource?.Key;
                    console.warn(`[ACTION_FAILED] PlayAudio for ${audioKey ?? 'unknown asset'} failed. Falling back to spoken hold prompt.`);
                    return buildActions([
                        buildSpeakAction('Please stay on the line while we connect you to the next available agent.'),
                        buildPauseAction(1000)
                    ]);
                }

                return buildActions([]);
            }

            default:
                // Unknown event
                console.warn('Unknown event type:', eventType);
                return buildActions([buildHangupAction()]);
        }
    } catch (err: any) {
        console.error('Error in SMA handler:', err);
        return buildActions([buildHangupAction('An internal error occurred. Please try again.')]);
    }
};



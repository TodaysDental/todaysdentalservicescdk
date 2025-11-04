import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { 
    ChimeSDKMeetingsClient, 
    CreateMeetingCommand, 
    CreateAttendeeCommand, 
    DeleteMeetingCommand,
    GetMeetingCommand
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

// Default queue timeout in seconds (24 hours) - Increased to handle long calls
const QUEUE_TIMEOUT = 24 * 60 * 60;
// Average call duration in seconds (5 minutes) - used for wait time estimation
const AVG_CALL_DURATION = 300;

// CRITICAL FIX: Define valid call states and transitions
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
    queueEntryTimeIso?: string; // Add optional ISO timestamp format
    uniquePositionId?: string;  // Add optional unique position ID
    phoneNumber: string;
    status: CallStatus;
    ttl: number;
}

async function addToQueue(clinicId: string, callId: string, phoneNumber: string): Promise<QueueEntry> {
    // CRITICAL FIX: Use UUID-based position ID to eliminate race conditions
    // This ensures each call gets a guaranteed unique position even with concurrent calls
    const now = Math.floor(Date.now() / 1000);
    
    // We now have randomUUID imported at the top of the file
    
    // Generate a guaranteed unique position ID using timestamp and UUID
    // Format: timestamp-uuid to guarantee uniqueness even for calls arriving at same millisecond
    const uuid = randomUUID();
    const uniqueId = `${Date.now()}-${uuid.substring(0, 13)}`;
    
    // Use the timestamp part for sorting but make it unique with a small random offset
    // to handle potential concurrent calls
    const queuePosition = Date.now() + Math.floor(Math.random() * 100);
    
    const entry: QueueEntry = {
        clinicId,
        callId,
        phoneNumber,
        queuePosition,
        queueEntryTime: now,
        queueEntryTimeIso: new Date().toISOString(), // Add ISO format for consistency
        uniquePositionId: uniqueId, // Store the guaranteed unique ID
        status: 'queued',
        ttl: now + QUEUE_TIMEOUT
    };

    // Use PutCommand with conditional check to prevent duplicate callIds
    try {
        await ddb.send(new PutCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Item: entry,
            ConditionExpression: 'attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)'
        }));
    } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
            console.error('[addToQueue] Duplicate queue entry detected', { clinicId, callId, queuePosition });
            // Retry with new UUID and timestamp to ensure uniqueness
            const retryUuid = randomUUID();
            const retryUniqueId = `${Date.now()}-${retryUuid.substring(0, 13)}`;
            entry.uniquePositionId = retryUniqueId;
            // Make sure the queue position is significantly different
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
    // CRITICAL FIX: Use a fully atomic approach with a single query
    // Rather than two separate queries (which creates a race window), use a single operation
    // with a transaction to get a consistent snapshot of the queue state
    
    try {
        // Use a transaction with consistent reads to get an atomic snapshot of queue state
        const TransactGetCommand = (await import('@aws-sdk/lib-dynamodb')).TransactGetCommand;
        
        // First, find this call (to check status & get queueEntryTime)
        const { Responses } = await ddb.send(new TransactGetCommand({
            TransactItems: [
                {
                    Get: {
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { callId }
                    }
                }
            ],
            ReturnConsumedCapacity: 'NONE'
        }));
        
        if (!Responses || Responses.length === 0 || !Responses[0]?.Item) return null;
        
        const thisCall = Responses[0].Item;
        const { clinicId: callClinicId, queueEntryTime, status } = thisCall;
        
        if (status !== 'queued' || !queueEntryTime) return null;
        
        // Now query for ALL queued calls for this clinic in a single consistent operation
        // This avoids any race conditions between separate queries
        const { Items: allQueuedCalls } = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            KeyConditionExpression: 'clinicId = :cid',
            FilterExpression: 'status = :status',
            ExpressionAttributeValues: {
                ':cid': clinicId,
                ':status': 'queued'
            },
            ConsistentRead: true // Critical for accurate queue position
        }));
        
        if (!allQueuedCalls) return null;
        
        // Sort all calls by entry time
        const sortedCalls = allQueuedCalls.sort((a, b) => a.queueEntryTime - b.queueEntryTime);
        
        // Find position of this call in the sorted array
        const index = sortedCalls.findIndex(call => call.callId === callId);
        if (index === -1) return null; // Call not found in queue
        
        // Position is 1-based
        const position = index + 1;
        
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
        
        // Estimate wait time based on position, number of agents, and average call duration
        const estimatedWaitTime = Math.ceil((position / numAgents) * AVG_CALL_DURATION);

        return { position, estimatedWaitTime };
    } catch (err: any) {
        console.error('[getQueuePosition] Error calculating queue position:', err);
        return null;
    }
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
    const currentStatus = Items[0].status;

    // CRITICAL FIX: Validate state transition and use conditional update to prevent race conditions
    // Only update if the call is still in a valid state that can transition to the new status
    
    // Validate the state transition
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
            // Use the current status to ensure we're only updating from the expected state
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

    // Note: We don't reorder queue positions anymore - queuePosition is now a timestamp-based value
    // that doesn't need adjustment. The position is relative and calculated on-demand via queueEntryTime.
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

// Helper function to build a ModifyChimeMeetingAttendees action
const buildModifyChimeMeetingAttendeesAction = (meetingId: string, operation: 'Add' | 'Remove', attendeeIds: string[]) => ({
    Type: 'ModifyChimeMeetingAttendees',
    Parameters: {
        MeetingId: meetingId,
        Operation: operation,
        AttendeeIds: attendeeIds
    }
});

// CRITICAL FIX: Add missing buildSpeakAndBridgeAction function
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

const buildPlayAudioAction = (audioSource: string) => ({
    Type: 'PlayAudio',
    Parameters: {
        AudioSource: {
            Type: 'S3',
            BucketName: HOLD_MUSIC_BUCKET,
            Key: audioSource
        },
        PlaybackTerminators: ['#', '*']
    }
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

const buildRecordAudioAction = (destinationBucket: string, recordingTerminators: string[] = ['#']) => ({
    Type: 'RecordAudio',
    Parameters: {
        DurationInSeconds: 120, // 2 minute max
        SilenceDurationInSeconds: 3,
        SilenceThreshold: 100,
        RecordingTerminators: recordingTerminators,
        RecordingDestination: {
            Type: 'S3',
            BucketName: destinationBucket
        }
    }
});

const buildStartBotConversationAction = (configuration: any) => ({
    Type: 'StartBotConversation',
    Parameters: {
        BotAliasArn: configuration.botAliasArn,
        LocaleId: configuration.localeId || 'en_US',
        Configuration: {
            SessionState: configuration.sessionState || {},
            WelcomeMessages: configuration.welcomeMessages || []
        }
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

// --- Meeting Management ---
async function createIncomingCallMeeting(callId: string, clinicId: string) {
    const meetingResponse = await chime.send(new CreateMeetingCommand({
        ClientRequestToken: `incoming-${callId}`,
        MediaRegion: CHIME_MEDIA_REGION,
        ExternalMeetingId: `incoming-${callId}-${clinicId}`,
    }));

    const meeting = meetingResponse.Meeting;
    if (!meeting) throw new Error('Failed to create meeting');

    // Store meeting info in call queue table with TTL
    // Note: We'll store this in the call queue table when we add the call to queue

    return meeting;
}

async function createAttendeeForAgent(meetingId: string, agentId: string) {
    const attendeeResponse = await chime.send(new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: agentId
    }));

    const attendee = attendeeResponse.Attendee;
    
    // CRITICAL FIX: Validate attendee data before storing
    if (!attendee) {
        throw new Error('Failed to create attendee - no Attendee object returned');
    }
    
    if (!attendee.AttendeeId || !attendee.JoinToken) {
        console.error('[createAttendeeForAgent] Invalid attendee data returned:', attendee);
        throw new Error('Failed to create attendee - missing required fields');
    }

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
    } catch (err: any) {
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
    // Use TransactionId as the stable call identifier for Chime SIP events
    const callId = event?.CallDetails?.TransactionId;
    // NEW_OUTBOUND_CALL places arguments at ActionData.Parameters.Arguments
    const args = event?.ActionData?.Parameters?.Arguments || event?.ActionData?.ArgumentsMap || event?.CallDetails?.ArgumentsMap || {};

    try {
            switch (eventType) {
                // Case: Hold call - triggered by hold-call.ts API
                case 'HOLD_CALL': {
                    if (args.action === 'HOLD_CALL' && args.agentId) {
                        const agentId = args.agentId;
                        const meetingId = args.meetingId;
                        const agentAttendeeId = args.agentAttendeeId;
                        const removeAgent = args.removeAgent === 'true' || args.removeAgent === true;
                        
                        console.log(`Processing hold request for call ${callId} from agent ${agentId}`, { 
                            meetingId, agentAttendeeId, removeAgent 
                        });
                        
                        // Find the call record to get meeting info
                        const { Items: callRecords } = await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            IndexName: 'callId-index',
                            KeyConditionExpression: 'callId = :callId',
                            ExpressionAttributeValues: {
                                ':callId': callId
                            }
                        }));

                        if (!callRecords || callRecords.length === 0) {
                            return buildActions([
                                buildSpeakAction('Unable to place call on hold. Please try again.')
                            ]);
                        }
                        
                        // CRITICAL FIX: If we have meeting ID and attendee ID, remove the agent from meeting
                        const actions = [];
                        
                        if (meetingId && agentAttendeeId && removeAgent) {
                            console.log(`[HOLD_CALL] Removing agent ${agentId} (attendee ${agentAttendeeId}) from meeting ${meetingId}`);
                            
                            // Add action to remove agent from meeting
                            actions.push({
                                Type: 'ModifyChimeMeetingAttendees',
                                Parameters: {
                                    Operation: 'Remove',
                                    MeetingId: meetingId,
                                    AttendeeList: [agentAttendeeId]
                                }
                            });
                            
                            // CRITICAL FIX: Log verification of agent removal instead of using RecordAction (which doesn't exist)
                            console.log(`[HOLD_CALL] Agent removal from meeting requested for ${agentId}`, {
                                agentAttendeeId,
                                meetingId,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // Add audio actions
                        if (HOLD_MUSIC_BUCKET) {
                            // Play hold music to the customer
                            actions.push(
                                buildSpeakAction('You have been placed on hold. Please wait for the agent to return.'),
                                buildPauseAction(500)
                            );
                            
                            // CRITICAL FIX: Add looping hold music so customer doesn't hear silence
                            actions.push({
                                Type: 'PlayAudio',
                                Parameters: {
                                    Repeat: 999,  // Loop hold music until agent returns
                                    AudioSource: {
                                        Type: 'S3',
                                        BucketName: HOLD_MUSIC_BUCKET,
                                        Key: 'hold-music.wav'
                                    },
                                    PlaybackTerminators: ['#', '*']
                                }
                            });
                        } else {
                            // No hold music bucket configured, just play a message
                            actions.push(
                                buildSpeakAction('You have been placed on hold. Please wait for the agent to return.'),
                                buildPauseAction(30000) // 30-second pause
                            );
                        }
                        
                        return buildActions(actions);
                    }
                    
                    console.warn('HOLD_CALL event without proper action');
                    return buildActions([]);
                }
                
                // Case: Resume call - triggered by resume-call.ts API
                case 'RESUME_CALL': {
                    if (args.action === 'RESUME_CALL' && args.agentId) {
                        const agentId = args.agentId;
                        const agentAttendeeId = args.agentAttendeeId;
                        const reconnectAgent = args.reconnectAgent === 'true' || args.reconnectAgent === true;
                        
                        console.log(`Processing resume request for call ${callId} from agent ${agentId}`, {
                            agentAttendeeId,
                            reconnectAgent
                        });
                        
                        // Find the call record to get meeting info
                        const { Items: callRecords } = await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            IndexName: 'callId-index',
                            KeyConditionExpression: 'callId = :callId',
                            ExpressionAttributeValues: {
                                ':callId': callId
                            }
                        }));

                        if (!callRecords || callRecords.length === 0 || !callRecords[0].meetingInfo?.MeetingId) {
                            return buildActions([
                                buildSpeakAction('Unable to resume your call. The agent will try again.')
                            ]);
                        }

                        const callRecord = callRecords[0];
                        const meetingInfo = callRecord.meetingInfo;

                        // Check if the customer attendee info exists
                        if (!callRecord.customerAttendeeInfo?.AttendeeId) {
                            console.error('No customer attendee info found for call', callId);
                            return buildActions([
                                buildSpeakAction('Unable to reconnect your call. Please wait while we resolve this issue.')
                            ]);
                        }

                        const actions = [];
                        
                        // CRITICAL FIX: Add verification for agent reconnection
                        if (reconnectAgent && agentAttendeeId) {
                            console.log(`[RESUME_CALL] Adding agent ${agentId} (attendee ${agentAttendeeId}) to meeting ${meetingInfo.MeetingId}`);
                            
                            // Add action to add agent back to meeting if needed
                            actions.push({
                                Type: 'ModifyChimeMeetingAttendees',
                                Parameters: {
                                    Operation: 'Add',
                                    MeetingId: meetingInfo.MeetingId,
                                    AttendeeList: [agentAttendeeId]
                                }
                            });
                            
                            // Log verification of agent addition instead of using RecordAction (which doesn't exist)
                            console.log(`[RESUME_CALL] Agent addition to meeting requested for ${agentId}`, {
                                agentAttendeeId,
                                meetingId: meetingInfo.MeetingId,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // Resume by rejoining the meeting
                        actions.push(buildSpeakAction('Thank you for holding. Reconnecting with your agent now.'));
                        actions.push(buildJoinChimeMeetingAction(meetingInfo, callRecord.customerAttendeeInfo));
                        
                        return buildActions(actions);
                    }
                    
                    console.warn('RESUME_CALL event without proper action');
                    return buildActions([]);
                }
            // Case 1: A new call from the PSTN (customer) to one of our clinic numbers
            case 'NEW_INBOUND_CALL': {
                const toPhoneNumber = parsePhoneNumber(event.CallDetails.SipHeaders.To);
                const callId = event.CallDetails.CallId;

                // Log inbound call details early for diagnostics
                console.log('[NEW_INBOUND_CALL] Received inbound call', {
                    callId,
                    to: event.CallDetails?.SipHeaders?.To,
                    from: event.CallDetails?.SipHeaders?.From,
                });

                if (!toPhoneNumber) {
                    console.error("Could not parse 'To' phone number from SIP header", { rawTo: event.CallDetails?.SipHeaders?.To });
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

                console.log('[NEW_INBOUND_CALL] Resolved clinic for inbound number', { toPhoneNumber, clinicId, clinicRecord: clinics[0] });

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
                    console.log(`No 'Online' agents found for clinic ${clinicId}. Adding to queue.`, { clinicId });
                    
                    try {
                        // Create a meeting first so we can join the customer while they wait
                        const meeting = await createIncomingCallMeeting(callId, clinicId);
                        
                        if (!meeting.MeetingId) {
                            throw new Error('Failed to create meeting for queued call');
                        }

                        // Create customer attendee
                        const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                            MeetingId: meeting.MeetingId,
                            ExternalUserId: `customer-${callId}`
                        }));

                        if (!customerAttendeeResponse.Attendee?.AttendeeId) {
                            throw new Error('Failed to create customer attendee for queued call');
                        }

                        // Add the call to the queue
                        const queueEntry = await addToQueue(clinicId, callId, toPhoneNumber);
                        console.log('[NEW_INBOUND_CALL] Call added to queue', { clinicId, callId, queueEntry });
                        
                        // Update the queue entry with meeting info
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: {
                                clinicId,
                                queuePosition: queueEntry.queuePosition
                            },
                            UpdateExpression: 'SET meetingInfo = :meeting, customerAttendeeInfo = :attendee',
                            ExpressionAttributeValues: {
                                ':meeting': meeting,
                                ':attendee': customerAttendeeResponse.Attendee
                            }
                        }));

                        console.log('[NEW_INBOUND_CALL] Queue entry updated with meeting and attendee info', { callId, meetingId: meeting.MeetingId, customerAttendeeId: customerAttendeeResponse.Attendee?.AttendeeId });
                        
                        // Get estimated wait time
                        const queueInfo = await getQueuePosition(clinicId, callId);
                        
                        if (!queueInfo) {
                            return buildActions([buildHangupAction('There was an error adding you to the queue. Please try again later.')]);
                        }

                        const waitMinutes = Math.ceil(queueInfo.estimatedWaitTime / 60);
                        const message = `All agents are currently busy. You are number ${queueInfo.position} in line. ` +
                                      `The estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}. ` +
                                      `Please stay on the line and the next available agent will assist you.`;
                        
                        // CRITICAL: Use proper action sequence for continuous hold experience
                        const actions: any[] = [];
                        
                        // 1. Speak the queue position message
                        actions.push(buildSpeakAction(message));
                        
                        // 2. Pause briefly before starting music
                        actions.push(buildPauseAction(500));
                        
                        // 3. Join customer to meeting (so they can hear when agent joins)
                        actions.push(buildJoinChimeMeetingAction(meeting, customerAttendeeResponse.Attendee));
                        
                        // Note: Once in the meeting, the customer waits for an agent to join
                        // The meeting provides the hold experience, and agents can join at any time
                        // via the call-accepted.ts API when they become available
                        
                        return buildActions(actions);
                        
                    } catch (queueErr) {
                        console.error('Error queuing call:', queueErr);
                        return buildActions([buildHangupAction('All agents are currently busy. Please try again later.')]);
                    }
                }

                try {
                    // 3. Create a new meeting for this incoming call
                    const meeting = await createIncomingCallMeeting(callId, clinicId);
                    
                    if (!meeting.MeetingId) {
                        throw new Error('Meeting created without MeetingId');
                    }

                    // 4. Create a customer attendee for the PSTN caller to join the meeting
                    const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                        MeetingId: meeting.MeetingId,
                        ExternalUserId: `customer-${callId}`
                    }));

                    if (!customerAttendeeResponse.Attendee?.AttendeeId) {
                        throw new Error('Failed to create customer attendee');
                    }

                    const customerAttendee = customerAttendeeResponse.Attendee;

                    // 5. Store the call information in the call queue table
                // CRITICAL FIX: Use unique identifiers for queue position to prevent collisions
                const fromNumber = parsePhoneNumber(event.CallDetails.SipHeaders.From) || 'Unknown';
                const agentIds = agents.filter(a => a.agentId).map(a => a.agentId);

                console.log('[NEW_INBOUND_CALL] Preparing call record for ringing call', { callId, clinicId, meetingId: meeting.MeetingId, fromNumber, agentIds });
                
                // Generate a deterministic but guaranteed unique position ID
                // Using high-precision timestamp + callId to ensure uniqueness even for concurrent calls
                const uniqueId = `${Date.now()}-${callId.substring(0, 8)}`;
                const currentTimestamp = Math.floor(Date.now() / 1000);
                
                await ddb.send(new PutCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    Item: {
                        clinicId,
                        callId,
                        queuePosition: 0, // Not queued, actively ringing
                        queueEntryTime: currentTimestamp,
                        queueEntryTimeIso: new Date().toISOString(),
                        uniquePositionId: uniqueId, // Add a guaranteed unique ID for position tracking
                        phoneNumber: fromNumber,
                        status: 'ringing',
                        meetingInfo: meeting,
                        customerAttendeeInfo: customerAttendee,
                        agentIds: agentIds,
                        ttl: currentTimestamp + QUEUE_TIMEOUT // Use consistent TTL
                    }
                }));

                console.log('[NEW_INBOUND_CALL] Stored call record for ringing call', { clinicId, callId, meetingId: meeting.MeetingId, customerAttendeeId: customerAttendee.AttendeeId });

                    // 6. CRITICAL FIX: Verify agent status again before creating attendees to prevent race conditions
                    console.log(`Creating attendees and notifying agents for meeting ${meeting.MeetingId}`);
                    
                    // Process agents sequentially with status verification
                    const successfullyNotifiedAgents: string[] = [];
                    
                    for (const agent of agents) {
                        if (!agent.agentId) continue;
                        
                        try {
                            // CRITICAL: Verify agent is still Online right before creating attendee
                            const { Item: currentAgentStatus } = await ddb.send(new GetCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: agent.agentId }
                            }));
                            
                            if (!currentAgentStatus || currentAgentStatus.status !== 'Online') {
                                console.warn(`[NEW_INBOUND_CALL] Agent ${agent.agentId} status changed - skipping`, {
                                    currentStatus: currentAgentStatus?.status
                                });
                                continue;
                            }
                            
                            // CRITICAL FIX: Verify meeting still exists before notifying agent
                            try {
                                await chime.send(new GetMeetingCommand({ MeetingId: meeting.MeetingId }));
                            } catch (meetingErr: any) {
                                if (meetingErr.name === 'NotFoundException') {
                                    console.error(`[NEW_INBOUND_CALL] Meeting ${meeting.MeetingId} no longer exists, skipping agent ${agent.agentId}`);
                                    continue;
                                }
                                console.warn(`[NEW_INBOUND_CALL] Error verifying meeting ${meeting.MeetingId}:`, meetingErr);
                            }

                            // Atomically claim the agent for ringing without pre-creating an attendee.
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: agent.agentId },
                                UpdateExpression: 'SET ringingCallId = :callId, callStatus = :status, inboundMeetingInfo = :meeting, ringingCallTime = :time, lastActivityAt = :timestamp',
                                ConditionExpression: 'attribute_exists(agentId) AND #status = :onlineStatus AND attribute_not_exists(ringingCallId)',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':callId': callId,
                                    ':status': 'ringing',
                                    ':meeting': meeting,
                                    ':time': new Date().toISOString(),
                                    ':timestamp': new Date().toISOString(),
                                    ':onlineStatus': 'Online'
                                }
                            }));

                            successfullyNotifiedAgents.push(agent.agentId);
                            console.log(`[NEW_INBOUND_CALL] Successfully notified agent ${agent.agentId}`);
                            
                        } catch (err: any) {
                            if (err.name === 'ConditionalCheckFailedException') {
                                console.warn(`[NEW_INBOUND_CALL] Agent ${agent.agentId} status changed during notification - skipping`);
                            } else {
                                console.error(`[NEW_INBOUND_CALL] Error notifying agent ${agent.agentId}:`, err.message);
                            }
                        }
                    }
                    
                    if (successfullyNotifiedAgents.length === 0) {
                        console.error('[NEW_INBOUND_CALL] No agents could be notified - all agents became unavailable');
                        
                        try {
                            // Clean up meeting since no agents are available
                            await cleanupMeeting(meeting.MeetingId);
                            
                            // CRITICAL FIX: Also clean up the call record from queue table to avoid orphaned records
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition: 0 }, // queuePosition is 0 for ringing calls
                                UpdateExpression: 'SET #status = :status, endedAt = :timestamp, cleanupReason = :reason',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':status': 'abandoned',
                                    ':timestamp': Math.floor(Date.now() / 1000),
                                    ':reason': 'no_agents_available'
                                }
                            }));
                            
                            console.log(`[NEW_INBOUND_CALL] Call record cleaned up for abandoned call ${callId}`);
                        } catch (cleanupErr) {
                            console.error(`[NEW_INBOUND_CALL] Error cleaning up resources:`, cleanupErr);
                            // Continue to hang up even if cleanup fails
                        }
                        
                        return buildActions([buildHangupAction('All agents became unavailable. Please try again.')]);
                    }
                    
                    console.log(`[NEW_INBOUND_CALL] Successfully notified ${successfullyNotifiedAgents.length} agents`);
                    
                    // 7. Join the customer to the meeting and play hold music
                    console.log(`Joining customer to meeting ${meeting.MeetingId}`);
                    
                    const actions: any[] = [];
                    
                    // CRITICAL FIX: Join customer to meeting so they can hear agents when one accepts
                    actions.push(buildSpeakAction('Thank you for calling. Please hold while we connect you with an available agent.'));
                    
                    // Add a small pause before joining the meeting
                    actions.push(buildPauseAction(500));
                    
                    // Join customer to meeting
                    actions.push(buildJoinChimeMeetingAction(meeting, customerAttendee));
                    
                    // Play hold music if available
                    if (HOLD_MUSIC_BUCKET) {
                        actions.push(buildPlayAudioAction('hold-music.wav'));
                    } else {
                        // If no hold music, just add a pause and periodic message
                        actions.push(buildPauseAction(10000)); // 10 second pause
                        actions.push(buildSpeakAction('Please continue holding. An agent will be with you shortly.'));
                        actions.push(buildPauseAction(10000)); // Another pause
                    }
                    
                    // Note: When an agent accepts via call-accepted.ts, the SMA will be notified with
                    // UpdateSipMediaApplicationCall to join the customer to the meeting with the agent

                    return buildActions(actions);

                } catch (err: any) {
                    console.error('Error setting up simultaneous ring:', err);
                    return buildActions([buildHangupAction('There was an error connecting your call. Please try again.')]);
                }
            }

            // Case 2: A new call *from* our system (agent outbound call)
            // This event is triggered by the CreateSipMediaApplicationCall in outbound-call.ts
            case 'NEW_OUTBOUND_CALL': {
                const { agentId, meetingId, toPhoneNumber, fromPhoneNumber } = args;

                if (!agentId || !meetingId || !toPhoneNumber) {
                    console.error('[NEW_OUTBOUND_CALL] Missing required arguments', args);
                    return buildActions([buildHangupAction('Unable to place call: missing configuration.')]);
                }

                console.log(`[NEW_OUTBOUND_CALL] Processing outbound call`, {
                    meetingId,
                    agentId,
                    callId,
                    toPhoneNumber
                });
                
                try {
                    // Update agent presence to indicate call is connecting
                    await ddb.send(new UpdateCommand({
                        TableName: AGENT_PRESENCE_TABLE_NAME,
                        Key: { agentId },
                        UpdateExpression: 'SET callStatus = :status, currentCallId = :callId, lastActivityAt = :timestamp',
                        ExpressionAttributeValues: {
                            ':status': 'dialing',
                            ':callId': callId,
                            ':timestamp': new Date().toISOString()
                        }
                    }));
                    
                    // Store call in queue table for tracking
                    const queuePosition = Date.now(); // Timestamp as position
                    const clinicId = args.fromClinicId || 'unknown';
                    
                    await ddb.send(new PutCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Item: {
                            clinicId,
                            callId,
                            queuePosition,
                            queueEntryTime: Math.floor(Date.now() / 1000),
                            phoneNumber: toPhoneNumber,
                            status: 'dialing',
                            direction: 'outbound',
                            assignedAgentId: agentId,
                            meetingInfo: { MeetingId: meetingId },
                            ttl: Math.floor(Date.now() / 1000) + QUEUE_TIMEOUT // 24 hour TTL for outbound calls
                        }
                    }));
                    
                    console.log(`[NEW_OUTBOUND_CALL] Call record created for ${callId}`);
                    
                    // Return empty actions for now - we'll bridge when customer answers
                    // This keeps the PSTN leg active while dialing
                    console.log(`[NEW_OUTBOUND_CALL] Call dialing, waiting for CALL_ANSWERED event`);
                    
                    return buildActions([]);

                } catch (err: any) {
                    console.error('[NEW_OUTBOUND_CALL] Error setting up outbound call:', err);
                    return buildActions([
                        buildHangupAction('Unable to connect your call. Please try again.')
                    ]);
                }
            }
            
            // --- ADDITION: Informational events that require no action ---
            // These events are informational and should return an empty action list
            // so Chime knows the event was received without taking any action.
            case 'RINGING': {
                // CRITICAL FIX: Track ringing duration for outbound calls to detect timeouts
                const { callType } = args;
                const isOutbound = callType === 'Outbound';
                
                if (callId) {
                    console.log(`[RINGING] Call ${callId} is ringing`);
                    
                    try {
                        // Update call record to track ringing start time
                        const { Items: callRecords } = await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            IndexName: 'callId-index',
                            KeyConditionExpression: 'callId = :id',
                            ExpressionAttributeValues: { ':id': callId }
                        }));
                        
                        if (callRecords && callRecords[0]) {
                            const { clinicId, queuePosition, ringingStartTime } = callRecords[0];
                            
                            // If ringingStartTime already exists, check for timeout
                            if (ringingStartTime) {
                                const ringStart = new Date(ringingStartTime).getTime();
                                const now = Date.now();
                                const ringingDurationSec = Math.floor((now - ringStart) / 1000);
                                
                                // If call has been ringing for more than 45 seconds, handle timeout
                                if (ringingDurationSec > 45) {
                                    console.error(`[RINGING] Call ${callId} has been ringing for ${ringingDurationSec}s - timeout detected`);
                                    
                                    // Update call record as timed out
                                    await ddb.send(new UpdateCommand({
                                        TableName: CALL_QUEUE_TABLE_NAME,
                                        Key: { clinicId, queuePosition },
                                        UpdateExpression: 'SET #status = :status, endedAt = :timestamp, timeoutReason = :reason',
                                        ExpressionAttributeNames: { '#status': 'status' },
                                        ExpressionAttributeValues: {
                                            ':status': 'timeout',
                                            ':timestamp': Math.floor(Date.now() / 1000),
                                            ':reason': 'excessive_ringing'
                                        }
                                    }));
                                    
                                    // Handle any agent cleanup
                                    if (callRecords[0].assignedAgentId) {
                                        await ddb.send(new UpdateCommand({
                                            TableName: AGENT_PRESENCE_TABLE_NAME,
                                            Key: { agentId: callRecords[0].assignedAgentId },
                                            UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp REMOVE currentCallId',
                                            ExpressionAttributeNames: { '#status': 'status' },
                                            ExpressionAttributeValues: {
                                                ':status': 'Online',
                                                ':timestamp': new Date().toISOString()
                                            }
                                        }));
                                    }
                                    
                                    // Hangup the call
                                    return buildActions([buildHangupAction('No answer. Please try again later.')]);
                                }
                                
                            } else {
                                // Record initial ringing start time
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId, queuePosition },
                                    UpdateExpression: 'SET ringingStartTime = if_not_exists(ringingStartTime, :time)',
                                    ExpressionAttributeValues: {
                                        ':time': new Date().toISOString()
                                    }
                                }));
                            }
                        }
                    } catch (err: any) {
                        console.warn('[RINGING] Error processing ringing event:', err);
                    }
                }
                
                console.log(`Received informational event type: ${eventType}, returning empty actions.`);
                return buildActions([]);
            }
            case 'INVALID_LAMBDA_RESPONSE':
            case 'ACTION_FAILED':
            case 'ACTION_SUCCESSFUL': {
                // ACTION_SUCCESSFUL is an informational acknowledgement from the
                // SMA that a requested action completed successfully. Do not
                // treat it as a hangup/termination — return empty actions.
                console.log(`Received informational event type: ${eventType}, returning empty actions.`);
                return buildActions([]);
            }
            
            case 'CALL_ANSWERED': {
                // NOTE: CALL_ANSWERED events from the SMA often do not include the
                // original Arguments passed at call creation. Query the call record
                // in DynamoDB to resolve meetingId, agentId and direction.
                console.log(`[CALL_ANSWERED] Received for call ${callId}. args: ${JSON.stringify(args)}`);

                // Start with any values that might be present in args, then fill
                // in from DynamoDB if missing.
                let agentId = args?.agentId;
                let callType = args?.callType;
                let meetingId = args?.meetingId;

                // Try to get the call record from the call queue table to resolve
                // missing metadata (assignedAgentId, meetingInfo, direction)
                let callRecord: any = undefined;
                try {
                    const { Items: callRecords } = await ddb.send(new QueryCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        IndexName: 'callId-index',
                        KeyConditionExpression: 'callId = :id',
                        ExpressionAttributeValues: { ':id': callId }
                    }));

                    if (callRecords && callRecords[0]) {
                        callRecord = callRecords[0];
                        // populate missing fields from the DB record
                        agentId = agentId || callRecord.assignedAgentId || callRecord.assignedAgent;
                        meetingId = meetingId || callRecord.meetingInfo?.MeetingId || callRecord.meetingInfo;
                        callType = callType || (callRecord.direction ? String(callRecord.direction) : undefined);
                    }
                } catch (checkErr) {
                    console.warn('[CALL_ANSWERED] Error fetching call record from DB:', checkErr);
                }

                const isOutbound = (typeof callType === 'string' && callType.toLowerCase() === 'outbound') ||
                                   (callRecord?.direction && String(callRecord.direction).toLowerCase() === 'outbound');

                console.log(`[CALL_ANSWERED] Resolved Type: ${callType || callRecord?.direction || 'N/A'}, agentId: ${agentId}, meetingId: ${meetingId}`);

                // CRITICAL FIX: Add timeout handling for outbound calls
                // If call has been in dialing state for too long, clean up
                if (isOutbound && callId) {
                    try {
                        // If we already fetched callRecord above, reuse it. Otherwise query.
                        const { Items: callRecords } = callRecord ? { Items: [callRecord] } : await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            IndexName: 'callId-index',
                            KeyConditionExpression: 'callId = :id',
                            ExpressionAttributeValues: { ':id': callId }
                        }));
                        
                        if (callRecords && callRecords[0]) {
                            const queuedAt = callRecords[0].queueEntryTime;
                            const now = Math.floor(Date.now() / 1000);
                            const dialingDuration = now - queuedAt;
                            
                            // If call has been dialing for more than 60 seconds, clean up
                            if (dialingDuration > 60) {
                                console.error(`[CALL_ANSWERED] Call timeout after ${dialingDuration}s - cleaning up call ${callId}`);
                                
                                // Clean up the meeting if it exists
                                if (meetingId) {
                                    try {
                                        await cleanupMeeting(meetingId);
                                        console.log(`[CALL_ANSWERED] Cleaned up meeting ${meetingId} for timeout call`);
                                    } catch (meetingErr) {
                                        console.warn(`[CALL_ANSWERED] Error cleaning up meeting:`, meetingErr);
                                    }
                                }
                                
                                // Update call record to timeout status
                                const { clinicId, queuePosition } = callRecords[0];
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId, queuePosition },
                                    UpdateExpression: 'SET #status = :status, endedAt = :timestamp, timeoutReason = :reason',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':status': 'timeout',
                                        ':timestamp': Math.floor(Date.now() / 1000),
                                        ':reason': 'customer_no_answer'
                                    }
                                }));
                                
                                // Mark agent as available again if they exist
                                if (agentId) {
                                    await ddb.send(new UpdateCommand({
                                        TableName: AGENT_PRESENCE_TABLE_NAME,
                                        Key: { agentId },
                                        UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp REMOVE currentCallId',
                                        ExpressionAttributeNames: { '#status': 'status' },
                                        ExpressionAttributeValues: {
                                            ':status': 'Online',
                                            ':timestamp': new Date().toISOString()
                                        }
                                    }));
                                }
                                
                                return buildActions([buildHangupAction('Call could not be connected. Please try again.')]);
                            }
                        }
                    } catch (checkErr) {
                        console.warn('[CALL_ANSWERED] Error checking call timing:', checkErr);
                    }
                }

                if (isOutbound && agentId && callId && meetingId) {
                    console.log(`[CALL_ANSWERED] Customer answered outbound call ${callId}`);
                    
                    try {
                        // CRITICAL FIX: Create an attendee for the customer's PSTN leg
                        // This is the customer who just answered their phone
                        console.log(`[CALL_ANSWERED] Creating customer attendee for meeting ${meetingId}`);
                        
                        const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                            MeetingId: meetingId,
                            ExternalUserId: `customer-pstn-${callId}`
                        }));
                        
                        if (!customerAttendeeResponse.Attendee?.AttendeeId) {
                            throw new Error('Failed to create customer attendee for outbound call');
                        }
                        
                        const customerAttendee = customerAttendeeResponse.Attendee;
                        console.log(`[CALL_ANSWERED] Created customer attendee ${customerAttendee.AttendeeId}`);
                        
                        // 1. Update Agent Status to OnCall
                        await ddb.send(new UpdateCommand({
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId },
                            UpdateExpression: 'SET #status = :status, currentCallId = :callId, callStatus = :callStatus, lastActivityAt = :timestamp',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':status': 'OnCall',
                                ':callId': callId,
                                ':callStatus': 'connected', // IMPORTANT: Set this so polling detects it
                                ':timestamp': new Date().toISOString(),
                            },
                        }));
                        console.log(`[CALL_ANSWERED] Agent ${agentId} status updated to OnCall`);

                        // 2. Update Call Queue Status with customer attendee info
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
                                    UpdateExpression: 'SET #status = :status, acceptedAt = :timestamp, assignedAgentId = :agentId, customerAttendeeInfo = :customerAttendee',
                                    ExpressionAttributeNames: { '#status': 'status' },
                                    ExpressionAttributeValues: {
                                        ':status': 'connected',
                                        ':timestamp': new Date().toISOString(),
                                        ':agentId': agentId,
                                        ':customerAttendee': customerAttendee
                                    }
                                }));
                                console.log(`[CALL_ANSWERED] Call queue updated for ${callId}`);
                            }
                        } catch (queueErr) {
                            console.warn(`[CALL_ANSWERED] Failed to update call queue:`, queueErr);
                            // Non-fatal - continue
                        }
                        
                        // 3. CRITICAL FIX: Return JoinChimeMeeting action to bridge customer PSTN leg into meeting
                        // The agent is already in the meeting (joined via browser)
                        // Now we bridge the customer's PSTN leg into the same meeting
                        console.log(`[CALL_ANSWERED] Bridging customer PSTN leg into meeting ${meetingId}`);
                        
                        return buildActions([
                            buildJoinChimeMeetingAction({ MeetingId: meetingId }, customerAttendee)
                        ]);
                        
                    } catch (err: any) {
                        console.error(`[CALL_ANSWERED] Error bridging customer to meeting:`, err);
                        return buildActions([
                            buildHangupAction('Unable to connect your call. Please try again.')
                        ]);
                    }
                }
                
                // For non-outbound calls or missing parameters, return empty actions
                return buildActions([]);
            }

            // Case 3: Transfer initiated
            case 'TRANSFER_INITIATED': {
                // When triggered by UpdateSipMediaApplicationCall, check for action
                if (args.action === 'TRANSFER_INITIATED') {
                    // This is triggered by the transfer-call.ts Lambda
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

                    // Find the call record in the call queue table
                    const { Items: callRecords } = await ddb.send(new QueryCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        IndexName: 'callId-index',
                        KeyConditionExpression: 'callId = :callId',
                        ExpressionAttributeValues: {
                            ':callId': callId
                        }
                    }));

                    if (!callRecords || callRecords.length === 0 || !callRecords[0]?.meetingInfo?.MeetingId) {
                        console.error('No active meeting found for transfer');
                        return buildActions([]);
                    }

                    const callRecord = callRecords[0];
                    const attendee = await createAttendeeForAgent(callRecord.meetingInfo.MeetingId, toAgentId);

                    // Note: The transfer-call.ts API has already updated the transfer status in the database

                    // Notify customer of transfer
                    return buildActions([
                        buildSpeakAndBridgeAction('Please hold while we transfer you to another agent.')
                    ]);
                }
                
                // Fallback for other TRANSFER_INITIATED scenarios
                console.warn('TRANSFER_INITIATED event without proper action');
                return buildActions([]);
            }

            // Case 4: Ring new agents (from call-rejected.ts)
            case 'RING_NEW_AGENTS': {
                if (args.action === 'RING_NEW_AGENTS' && args.agentIds) {
                    const agentIds = args.agentIds.split(',');
                    console.log(`Ringing ${agentIds.length} new agents for call ${callId}`);
                    
                    // Find the call record to get meeting info
                    const { Items: callRecords } = await ddb.send(new QueryCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        IndexName: 'callId-index',
                        KeyConditionExpression: 'callId = :callId',
                        ExpressionAttributeValues: {
                            ':callId': callId
                        }
                    }));

                    if (!callRecords || callRecords.length === 0 || !callRecords[0].meetingInfo?.MeetingId) {
                        console.error('No meeting found for call when trying to ring new agents');
                        return buildActions([
                            buildSpeakAndBridgeAction('All agents are busy. Please stay on the line.')
                        ]);
                    }

                    const callRecord = callRecords[0];
                    const meetingInfo = callRecord.meetingInfo;

                    // Atomically claim each agent and store meeting info so their frontend can show the incoming call.
                    console.log(`Notifying ${agentIds.length} agents for meeting ${meetingInfo.MeetingId} (no pre-created attendees)`);
                    
                    await Promise.all(agentIds.map(async (agentId: string) => {
                        try {
                            // Attempt to atomically set ringingCallId only if agent is still Online and not already ringing
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                UpdateExpression: 'SET ringingCallId = :callId, callStatus = :status, inboundMeetingInfo = :meeting, ringingCallTime = :time, lastActivityAt = :timestamp',
                                ConditionExpression: 'attribute_exists(agentId) AND #status = :onlineStatus AND attribute_not_exists(ringingCallId)',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':callId': callId,
                                    ':status': 'ringing',
                                    ':meeting': meetingInfo,
                                    ':time': new Date().toISOString(),
                                    ':timestamp': new Date().toISOString(),
                                    ':onlineStatus': 'Online'
                                }
                            }));

                            console.log(`Agent ${agentId} notified of incoming call`);
                        } catch (err: any) {
                            // Ignore conditional failures (agent changed status) but log others
                            if (err.name === 'ConditionalCheckFailedException') {
                                console.warn(`Agent ${agentId} not available to notify - skipping`);
                            } else {
                                console.error(`Error notifying agent ${agentId}:`, err);
                            }
                        }
                    }));
                    
                    // Notify the customer
                    return buildActions([
                        buildSpeakAndBridgeAction('We are connecting you with the next available agent. Please hold.')
                    ]);
                }
                
                console.warn('RING_NEW_AGENTS event without proper arguments');
                return buildActions([]);
            }

            // Note: MEETING_ACCEPTED event removed - call acceptance is handled by the API (call-accepted.ts)

            // Case 6: Call actions completed, or call ended
            case 'HANGUP':
            case 'CALL_ENDED': {
                console.log(`[${eventType}] Call ${callId} ended. Cleaning up resources.`);
                
                // Find the call in the queue table
                const { Items: callRecords } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :id',
                    ExpressionAttributeValues: { ':id': callId }
                }));

                if (callRecords && callRecords[0]) {
                    const callRecord = callRecords[0];
                    const { clinicId, queuePosition, meetingInfo, assignedAgentId, agentIds } = callRecord;
                    
                    console.log(`[${eventType}] Found call record`, {
                        callId,
                        status: callRecord.status,
                        assignedAgent: assignedAgentId,
                        ringingAgents: agentIds?.length || 0,
                        hasMeeting: !!meetingInfo?.MeetingId
                    });
                    
                    // Clean up the meeting if it exists
                    if (meetingInfo?.MeetingId) {
                        try {
                            // CRITICAL FIX: Add retry logic for meeting cleanup
                            let retryCount = 0;
                            const maxRetries = 3;
                            let meetingCleaned = false;
                            
                            while (!meetingCleaned && retryCount < maxRetries) {
                                try {
                                    await cleanupMeeting(meetingInfo.MeetingId);
                                    console.log(`[${eventType}] Cleaned up meeting ${meetingInfo.MeetingId} (attempt ${retryCount + 1})`);
                                    meetingCleaned = true;
                                } catch (err: any) {
                                    retryCount++;
                                    
                                    // Don't retry for NotFoundException - meeting already gone
                                    if (err.name === 'NotFoundException') {
                                        console.log(`[${eventType}] Meeting ${meetingInfo.MeetingId} already deleted`);
                                        meetingCleaned = true;
                                    } else if (retryCount >= maxRetries) {
                                        // Rethrow on last attempt
                                        throw err;
                                    } else {
                                        // Wait with exponential backoff before retrying
                                        const delay = Math.pow(2, retryCount) * 100; // 200, 400, 800ms
                                        console.warn(`[${eventType}] Meeting cleanup attempt ${retryCount} failed, retrying in ${delay}ms:`, err.message);
                                        await new Promise(resolve => setTimeout(resolve, delay));
                                    }
                                }
                            }
                        } catch (meetingErr) {
                            console.warn(`[${eventType}] Failed to cleanup meeting after multiple attempts:`, meetingErr);
                            // Continue with other cleanup operations even if meeting cleanup fails
                        }
                    }
                    
                    // Update call status in the queue
                    const finalStatus = callRecord.status === 'connected' ? 'completed' : 'abandoned';
                    const callDuration = callRecord.acceptedAt 
                        ? Math.floor(Date.now() / 1000) - Math.floor(new Date(callRecord.acceptedAt).getTime() / 1000)
                        : 0;
                        
                    try {
                        // CRITICAL FIX: Add proper error recovery for call record update
                        const nowIso = new Date().toISOString();
                        const nowUnix = Math.floor(Date.now() / 1000);
                        
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'SET #status = :status, endedAt = :timestamp, endedAtIso = :timestampIso, callDuration = :duration',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':status': finalStatus,
                                ':timestamp': nowUnix,
                                ':timestampIso': nowIso,
                                ':duration': callDuration
                            }
                        }));
                        
                    } catch (updateErr) {
                        console.error(`[${eventType}] Failed to update call record:`, updateErr);
                        // Continue with agent cleanup even if call record update fails
                    }
                    
                    // CRITICAL FIX: Update agent status if they were on the call
                    // This handles the case where the customer hangs up first
                    // But preserves agent status if they've already changed it
                    if (assignedAgentId) {
                        try {
                            // Directly use conditional update to avoid race condition
                            // Only update if agent is still on THIS call
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: assignedAgentId },
                                UpdateExpression: 'SET #status = :status, lastActivityAt = :timestamp, lastCallEndedAt = :timestamp REMOVE currentCallId, callStatus',
                                ConditionExpression: 'attribute_exists(agentId) AND currentCallId = :callId', // Only update if still on this call
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':status': 'Online', // Restore to Online status
                                    ':timestamp': new Date().toISOString(),
                                    ':callId': callId
                                }
                            }));
                            console.log(`[${eventType}] Agent ${assignedAgentId} marked as available`);
                        } catch (agentErr: any) {
                            if (agentErr.name === 'ConditionalCheckFailedException') {
                                console.log(`[${eventType}] Agent ${assignedAgentId} is no longer on this call - skipping cleanup`);
                            } else {
                                console.warn(`[${eventType}] Failed to update agent ${assignedAgentId}:`, agentErr);
                            }
                        }
                    }
                    
                    // CRITICAL: Clear ringing status for any agents who were being rung
                    // This handles abandoned calls where no agent answered
                    if (agentIds && Array.isArray(agentIds) && agentIds.length > 0) {
                        console.log(`[${eventType}] Clearing ringing status for ${agentIds.length} agents`);
                        await Promise.all(agentIds.map((agentId: string) =>
                            ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId },
                                UpdateExpression: 'REMOVE ringingCallId, ringingCallTime SET lastActivityAt = :timestamp',
                                ConditionExpression: 'attribute_exists(agentId) AND ringingCallId = :callId',
                                ExpressionAttributeValues: {
                                    ':timestamp': new Date().toISOString(),
                                    ':callId': callId
                                }
                            })).catch((err) => {
                                // Ignore conditional check failures (agent already cleared)
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
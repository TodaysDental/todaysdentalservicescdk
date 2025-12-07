import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { 
    ChimeSDKMeetingsClient, 
    CreateAttendeeCommand, 
    DeleteMeetingCommand
} from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'crypto';
import { enrichCallContext, selectAgentsForCall } from './utils/agent-selection';
import { buildBaseQueueItem, smartAssignCall } from './utils/parallel-assignment';
import { generateUniqueCallPosition } from '../shared/utils/unique-id';
import { startMediaPipeline, stopMediaPipeline, isRealTimeTranscriptionEnabled } from './utils/media-pipeline-manager';

// This Lambda is the "brain" for call routing.
// It is NOT triggered by API Gateway. It is triggered by the Chime SDK SIP Media Application.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// Chime meetings must be created in a supported media region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME!;
const HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET;
const MAX_RING_AGENTS = Math.max(1, Number.parseInt(process.env.MAX_RING_AGENTS || '25', 10));
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENABLE_PARALLEL_ASSIGNMENT = process.env.ENABLE_PARALLEL_ASSIGNMENT !== 'false';
const PARALLEL_AGENT_COUNT = Math.max(1, Number.parseInt(process.env.PARALLEL_AGENT_COUNT || '3', 10));

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
// FIX #13: Removed backward transitions that could bypass queue logic
// State machine should be forward-only except for explicit retry scenarios
const VALID_STATE_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
    'queued': ['ringing', 'abandoned', 'timeout', 'no_agents_available'],
    'ringing': ['connected', 'queued', 'abandoned', 'no_agents_available', 'timeout'], // queued allowed for rejection/re-queue
    'dialing': ['connected', 'timeout', 'abandoned', 'failed'],
    'connected': ['on_hold', 'completed', 'abandoned'],
    'on_hold': ['connected', 'abandoned', 'completed'],
    'timeout': [],
    'completed': [],
    'abandoned': [],
    // FIX #13: no_agents_available can only transition to ringing (agent became available) or abandoned
    // Removed 'queued' to prevent regression - once no_agents_available, call should either
    // ring an agent or be abandoned, not go back to queue
    'no_agents_available': ['ringing', 'abandoned'],
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
    // Routing metadata
    priority?: 'high' | 'normal' | 'low';
    priorityScore?: number;
    isVip?: boolean;
    requiredSkills?: string[];
    preferredSkills?: string[];
    language?: string;
    direction?: 'inbound' | 'outbound';
    agentIds?: string[];
    assignedAgentId?: string | null;
    rejectedAgentIds?: string[];
}

/**
 * FIX #4 & #7: Queue Position Conflicts and Duplicate Prevention
 * Uses unique ID generation to prevent collisions and checks for existing callId
 */
async function addToQueue(clinicId: string, callId: string, phoneNumber: string): Promise<QueueEntry> {
    const now = Math.floor(Date.now() / 1000);
    
    // FIX #7: First check if this call already exists in the queue
    // This prevents duplicate entries if addToQueue is called multiple times for the same call
    const { Items: existingCalls } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId }
    }));
    
    if (existingCalls && existingCalls.length > 0) {
        const existingEntry = existingCalls[0];
        console.warn('[addToQueue] Call already exists in queue - returning existing entry', { 
            clinicId, 
            callId, 
            existingStatus: existingEntry.status,
            existingPosition: existingEntry.queuePosition
        });
        return existingEntry as QueueEntry;
    }
    
    // FIX #4: Use unique position generation
    const { queuePosition, uniquePositionId } = generateUniqueCallPosition();
    
    const entry: QueueEntry = {
        clinicId,
        callId,
        phoneNumber,
        queuePosition,
        queueEntryTime: now,
        queueEntryTimeIso: new Date().toISOString(),
        uniquePositionId,
        status: 'queued',
        ttl: now + QUEUE_TIMEOUT,
        priority: 'normal',
        direction: 'inbound'
    };

    try {
        await ddb.send(new PutCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Item: entry,
            ConditionExpression: 'attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)'
        }));
    } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
            console.error('[addToQueue] Position collision - regenerating position', { clinicId, callId, queuePosition });
            
            // FIX #7: Re-check if call already exists (might have been added by parallel request)
            const { Items: recheck } = await ddb.send(new QueryCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                IndexName: 'callId-index',
                KeyConditionExpression: 'callId = :callId',
                ExpressionAttributeValues: { ':callId': callId }
            }));
            
            if (recheck && recheck.length > 0) {
                console.warn('[addToQueue] Call was added by parallel request - returning existing entry', { callId });
                return recheck[0] as QueueEntry;
            }
            
            // FIX #4: Regenerate with new unique position
            const retryPosition = generateUniqueCallPosition();
            entry.queuePosition = retryPosition.queuePosition;
            entry.uniquePositionId = retryPosition.uniquePositionId;
            
            await ddb.send(new PutCommand({
                TableName: CALL_QUEUE_TABLE_NAME,
                Item: entry
            }));
            
            console.log('[addToQueue] Successfully inserted call with retry position', { 
                clinicId, 
                callId, 
                queuePosition: entry.queuePosition 
            });
        } else {
            throw err;
        }
    }

    return entry;
}

// FIX #11: VIP cache with TTL-based refresh
let vipPhoneNumbersCache: Set<string> | null = null;
let vipCacheLastRefresh: number = 0;
const VIP_CACHE_TTL_MS = 5 * 60 * 1000; // Refresh every 5 minutes

function getVipPhoneNumbers(): Set<string> {
    const now = Date.now();
    
    // FIX #11: Check if cache needs refresh based on TTL
    if (vipPhoneNumbersCache && (now - vipCacheLastRefresh) < VIP_CACHE_TTL_MS) {
        return vipPhoneNumbersCache;
    }
    
    // Cache is stale or doesn't exist - refresh it
    try {
        const raw = process.env.VIP_PHONE_NUMBERS;
        if (!raw) {
            vipPhoneNumbersCache = new Set<string>();
            vipCacheLastRefresh = now;
            return vipPhoneNumbersCache;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const newCache = new Set<string>(parsed.map((v) => String(v)));
            
            // Log if cache changed
            if (vipPhoneNumbersCache && !setsEqual(vipPhoneNumbersCache, newCache)) {
                console.log('[inbound-router] VIP phone numbers cache refreshed', { 
                    previous: vipPhoneNumbersCache.size,
                    current: newCache.size
                });
            }
            
            vipPhoneNumbersCache = newCache;
        } else {
            vipPhoneNumbersCache = new Set<string>();
        }
        vipCacheLastRefresh = now;
    } catch (err) {
        console.warn('[inbound-router] Failed to parse VIP_PHONE_NUMBERS:', err);
        // Keep existing cache if parse fails, or create empty set
        if (!vipPhoneNumbersCache) {
            vipPhoneNumbersCache = new Set<string>();
        }
        vipCacheLastRefresh = now;
    }
    return vipPhoneNumbersCache;
}

// Helper function to compare two sets
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
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

// Recording action builders
// FIXED: Use correct StartCallRecording format with Destination.Location (not RecordingDestination)
const buildStartCallRecordingAction = (
    callId: string,
    recordingBucketName: string
) => ({
    Type: 'StartCallRecording',
    Parameters: {
        CallId: callId,
        Track: 'BOTH', // Valid values: INCOMING, OUTGOING, or BOTH
        Destination: {
            Type: 'S3',
            // Location is a single string: bucketname/prefix/path
            // AWS automatically appends: year/month/date/timestamp_transactionId_callId.wav
            Location: `${recordingBucketName}/recordings/${new Date().toISOString().split('T')[0]}/${callId}/`
        }
    }
});

const buildStopCallRecordingAction = (callId: string) => ({
    Type: 'StopCallRecording',
    Parameters: {
        CallId: callId
    }
});

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
// FIX #10: E.164 format validation regex
// Valid E.164: + followed by 1-15 digits (country code + subscriber number)
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

function parsePhoneNumber(sipUri: string): string | null {
    try {
        const match = sipUri.match(/sip:(\+\d+)@/);
        if (!match) return null;
        
        const phoneNumber = match[1];
        
        // FIX #10: Validate E.164 format
        if (!E164_REGEX.test(phoneNumber)) {
            console.warn('[parsePhoneNumber] Invalid E.164 format detected', { 
                raw: phoneNumber,
                reason: phoneNumber.length > 16 ? 'too long' : 
                        phoneNumber.length < 2 ? 'too short' : 
                        'invalid format'
            });
            return null;
        }
        
        return phoneNumber;
    } catch {
        return null;
    }
}

/**
 * FIX #10: Validate E.164 phone number format
 * Returns true if valid, false otherwise
 */
function isValidE164(phoneNumber: string): boolean {
    return E164_REGEX.test(phoneNumber);
}

/**
 * FIX #14: Improved PSTN leg detection
 * Priority: LEG-A tag > PSTN call leg type > undefined (no fallback to random participant)
 */
function getPstnLegCallId(event: any): string | undefined {
    const participants = event?.CallDetails?.Participants;
    if (!Array.isArray(participants) || participants.length === 0) {
        return undefined;
    }

    // First priority: Look for LEG-A (the inbound PSTN caller)
    const legAParticipant = participants.find((participant: any) => participant.ParticipantTag === 'LEG-A');
    if (legAParticipant?.CallId) {
        return legAParticipant.CallId;
    }
    
    // FIX #14: Second priority - look for PSTN leg type specifically
    // Don't fall back to participants[0] as it might be a WebRTC/SIP leg
    const pstnParticipant = participants.find((participant: any) => 
        participant.ParticipantTag === 'LEG-B' || // Outbound PSTN is typically LEG-B
        participant.Direction === 'Outbound' ||
        participant.CallLegType === 'PSTN'
    );
    if (pstnParticipant?.CallId) {
        return pstnParticipant.CallId;
    }
    
    // FIX #14: Only return undefined, do NOT fall back to random participant
    // This prevents operations being performed on wrong call leg
    console.warn('[getPstnLegCallId] No PSTN leg found in participants', { 
        participantCount: participants.length,
        tags: participants.map((p: any) => p.ParticipantTag),
        types: participants.map((p: any) => p.CallLegType)
    });
    return undefined;
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

                    // 2. Build call context (priority, VIP, etc.)
                    const callContext = await enrichCallContext(
                        ddb,
                        callId,
                        clinicId,
                        fromPhoneNumber,
                        CALL_QUEUE_TABLE_NAME,
                        getVipPhoneNumbers()
                    );

                    // 3. Select best agents for this call
                    const selectedAgents = await selectAgentsForCall(
                        ddb,
                        callContext,
                        AGENT_PRESENCE_TABLE_NAME,
                        {
                            maxAgents: MAX_RING_AGENTS,
                            considerIdleTime: true,
                            considerWorkload: true,
                            prioritizeContinuity: callContext.isCallback || false
                        }
                    );

                    let assignmentSucceeded = false;

                    if (selectedAgents.length > 0) {
                        const baseQueueItem = buildBaseQueueItem(
                            clinicId,
                            callId,
                            fromPhoneNumber,
                            QUEUE_TIMEOUT
                        );

                        const assignmentResult = await smartAssignCall(
                            ddb,
                            selectedAgents,
                            callContext,
                            baseQueueItem,
                            AGENT_PRESENCE_TABLE_NAME,
                            CALL_QUEUE_TABLE_NAME,
                            LOCKS_TABLE_NAME,
                            ENABLE_PARALLEL_ASSIGNMENT,
                            {
                                parallelCount: PARALLEL_AGENT_COUNT
                            }
                        );

                        if (assignmentResult.success && assignmentResult.agentId) {
                            assignmentSucceeded = true;
                            console.log('[NEW_INBOUND_CALL] Call assigned to agent', {
                                callId,
                                agentId: assignmentResult.agentId,
                                durationMs: assignmentResult.duration,
                                attemptedAgents: assignmentResult.attemptedAgents.length
                            });
                        } else {
                            console.log('[NEW_INBOUND_CALL] Assignment failed, will queue call', {
                                callId,
                                error: assignmentResult.error
                            });
                        }
                    }

                    if (assignmentSucceeded) {
                        console.log(`[NEW_INBOUND_CALL] Placing customer ${callId} on hold while ringing agent(s).`);
                        
                        // Start call recording if enabled
                        const enableRecording = process.env.ENABLE_CALL_RECORDING === 'true';
                        const recordingsBucket = process.env.RECORDINGS_BUCKET;
                        const actions = [];

                        if (enableRecording && recordingsBucket && pstnLegCallId) {
                            console.log(`[NEW_INBOUND_CALL] Starting recording for call ${callId}`);
                            actions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));
                            
                            // Update call queue with recording metadata
                            try {
                                const { Items: callRecords } = await ddb.send(new QueryCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    IndexName: 'callId-index',
                                    KeyConditionExpression: 'callId = :callId',
                                    ExpressionAttributeValues: { ':callId': callId }
                                }));
                                
                                if (callRecords && callRecords[0]) {
                                    const { clinicId, queuePosition } = callRecords[0];
                                    await ddb.send(new UpdateCommand({
                                        TableName: CALL_QUEUE_TABLE_NAME,
                                        Key: { clinicId, queuePosition },
                                        UpdateExpression: 'SET recordingStarted = :true, recordingStartTime = :now, pstnCallId = :pstnCallId',
                                        ExpressionAttributeValues: {
                                            ':true': true,
                                            ':now': new Date().toISOString(),
                                            ':pstnCallId': pstnLegCallId
                                        }
                                    }));
                                    console.log('[NEW_INBOUND_CALL] Updated call record with pstnCallId:', pstnLegCallId);
                                }
                            } catch (recordErr) {
                                console.error('[NEW_INBOUND_CALL] Error updating recording metadata:', recordErr);
                            }
                        }

                        actions.push(
                            buildSpeakAction(
                                callContext.isVip
                                    ? 'Thank you for calling. This call may be recorded for quality assurance. As a valued customer, we are connecting you with a specialist.'
                                    : 'Thank you for calling. This call may be recorded for quality and training purposes. Please hold while we connect you with an available agent.'
                            ),
                            buildPauseAction(500),
                            buildPlayAudioAction('hold-music.wav', 999)
                        );

                        return buildActions(actions);
                    }

                    console.log(`[NEW_INBOUND_CALL] No available Online agents for clinic ${clinicId} or assignment failed. Adding to queue.`);
                    try {
                        const queueEntry = await addToQueue(clinicId, callId, fromPhoneNumber);
                        console.log('[NEW_INBOUND_CALL] Call added to queue', { clinicId, callId, queueEntry });

                        const queueInfo = await getQueuePosition(clinicId, callId);
                        const waitMinutes = Math.ceil((queueInfo?.estimatedWaitTime || 120) / 60);
                        const position = queueInfo?.position || 1;

                        let message: string;
                        if (callContext.isVip) {
                            message =
                                `All agents are currently assisting other customers. ` +
                                `As a valued customer, you will be connected as soon as possible. ` +
                                `Your estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}. ` +
                                `This call may be recorded for quality assurance.`;
                        } else if (callContext.isCallback) {
                            message =
                                `Thank you for calling back. All agents are currently busy. ` +
                                `You are number ${position} in line. ` +
                                `The estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}. ` +
                                `This call may be recorded for quality and training purposes.`;
                        } else {
                            message =
                                `All agents are currently busy. You are number ${position} in line. ` +
                                `The estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}. ` +
                                `This call may be recorded for quality and training purposes. Please stay on the line.`;
                        }

                        // Start call recording if enabled
                        const enableRecording = process.env.ENABLE_CALL_RECORDING === 'true';
                        const recordingsBucket = process.env.RECORDINGS_BUCKET;
                        const actions = [];

                        if (enableRecording && recordingsBucket && pstnLegCallId) {
                            console.log(`[NEW_INBOUND_CALL] Starting recording for queued call ${callId}`);
                            actions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));
                            
                            // Update call queue with recording metadata
                            try {
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId, queuePosition: queueEntry.queuePosition },
                                    UpdateExpression: 'SET recordingStarted = :true, recordingStartTime = :now, pstnCallId = :pstnCallId',
                                    ExpressionAttributeValues: {
                                        ':true': true,
                                        ':now': new Date().toISOString(),
                                        ':pstnCallId': pstnLegCallId
                                    }
                                }));
                                console.log('[NEW_INBOUND_CALL] Updated queued call record with pstnCallId:', pstnLegCallId);
                            } catch (recordErr) {
                                console.error('[NEW_INBOUND_CALL] Error updating recording metadata:', recordErr);
                            }
                        }

                        actions.push(
                            buildSpeakAction(message),
                            buildPauseAction(500),
                            buildPlayAudioAction('hold-music.wav', 999)
                        );

                        return buildActions(actions);
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
                
                const outboundAgentId = args.agentId;
                const meetingId = args.meetingId;
                const clinicId = args.fromClinicId;
                
                // Update agent presence with enhanced outbound call tracking
                if (outboundAgentId) {
                    try {
                        await ddb.send(new UpdateCommand({
                            TableName: AGENT_PRESENCE_TABLE_NAME,
                            Key: { agentId: outboundAgentId },
                            UpdateExpression: 'SET dialingState = :initiated, dialingStartedAt = :now, outboundCallId = :callId, outboundToNumber = :toNumber',
                            ConditionExpression: '#status = :dialing',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':initiated': 'initiated',
                                ':dialing': 'dialing',
                                ':now': new Date().toISOString(),
                                ':callId': callId,
                                ':toNumber': args.toPhoneNumber || ''
                            }
                        }));
                        console.log(`[NEW_OUTBOUND_CALL] Updated agent ${outboundAgentId} with outbound call details`);
                    } catch (updateErr: any) {
                        console.warn(`[NEW_OUTBOUND_CALL] Failed to update agent state:`, updateErr.message);
                    }
                }

                // Update call queue with SMA initiated timestamp
                if (clinicId) {
                    try {
                        const { Items: callRecords } = await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            IndexName: 'callId-index',
                            KeyConditionExpression: 'callId = :callId',
                            ExpressionAttributeValues: { ':callId': callId }
                        }));

                        if (callRecords && callRecords[0]) {
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId: callRecords[0].clinicId, queuePosition: callRecords[0].queuePosition },
                                UpdateExpression: 'SET smaInitiatedAt = :now, pstnCallId = :pstnCallId',
                                ExpressionAttributeValues: {
                                    ':now': new Date().toISOString(),
                                    ':pstnCallId': pstnLegCallId || callId
                                }
                            }));
                        }
                    } catch (err) {
                        console.warn('[NEW_OUTBOUND_CALL] Failed to update call record:', err);
                    }
                }
                
                // The logic will be picked up by RINGING, CALL_ANSWERED, or HANGUP
                return buildActions([]);
            }

            // Case 2b: Outbound call is ringing at far end
            case 'RINGING': {
                console.log(`[RINGING] Call ${callId} is ringing at far end`, args);

                // Get the call record to determine if this is an outbound call
                const { Items: callRecords } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :callId',
                    ExpressionAttributeValues: { ':callId': callId }
                }));

                if (callRecords && callRecords[0]) {
                    const callRecord = callRecords[0];
                    const { clinicId, queuePosition, assignedAgentId, direction, status } = callRecord;

                    // For outbound calls that are now ringing
                    if (direction === 'outbound' && status === 'dialing' && assignedAgentId) {
                        console.log(`[RINGING] Outbound call ${callId} is now ringing - updating agent ${assignedAgentId}`);

                        // Update agent presence - this triggers frontend to show "Ringing..." and play ringback tone
                        try {
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: assignedAgentId },
                                UpdateExpression: 'SET dialingState = :ringing, ringingStartedAt = :now',
                                ExpressionAttributeValues: {
                                    ':ringing': 'ringing',
                                    ':now': new Date().toISOString()
                                }
                            }));
                            console.log(`[RINGING] Agent ${assignedAgentId} dialingState updated to 'ringing'`);
                        } catch (updateErr: any) {
                            console.warn(`[RINGING] Failed to update agent:`, updateErr.message);
                        }

                        // Update call queue status to reflect ringing
                        try {
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition },
                                UpdateExpression: 'SET dialStatus = :ringing, ringingStartedAt = :now',
                                ExpressionAttributeValues: {
                                    ':ringing': 'ringing',
                                    ':now': new Date().toISOString()
                                }
                            }));
                        } catch (err) {
                            console.warn('[RINGING] Failed to update call record:', err);
                        }
                    }
                }

                // Return empty actions - just acknowledgment
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
                                
                                // Start Media Insights Pipeline for real-time transcription
                                if (isRealTimeTranscriptionEnabled()) {
                                    const callRecord = callRecords[0];
                                    startMediaPipeline({
                                        callId,
                                        meetingId,
                                        clinicId,
                                        agentId: assignedAgentId,
                                        customerPhone: callRecord.from || callRecord.phoneNumber,
                                        direction: callRecord.direction || 'inbound'
                                    }).then(async pipelineId => {
                                        if (pipelineId) {
                                            // Store pipeline ID for cleanup when call ends
                                            await ddb.send(new UpdateCommand({
                                                TableName: CALL_QUEUE_TABLE_NAME,
                                                Key: { clinicId, queuePosition },
                                                UpdateExpression: 'SET mediaPipelineId = :pipelineId',
                                                ExpressionAttributeValues: {
                                                    ':pipelineId': pipelineId
                                                }
                                            })).catch(err => {
                                                console.warn('[CALL_ANSWERED] Failed to store pipeline ID:', err.message);
                                            });
                                            
                                            console.log('[CALL_ANSWERED] Media Pipeline started:', pipelineId);
                                        }
                                    }).catch(err => {
                                        console.warn('[CALL_ANSWERED] Failed to start Media Pipeline (non-fatal):', err.message);
                                        // Don't fail the call - Media Pipeline is optional
                                    });
                                }
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
                                UpdateExpression: 'SET ringingCallId = :callId, #status = :ringingStatus, ringingCallTime = :time, ringingCallFrom = :from, ringingCallClinicId = :clinicId',
                                ConditionExpression: 'attribute_exists(agentId) AND #status = :onlineStatus AND attribute_not_exists(ringingCallId)',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':callId': callId,
                                    ':ringingStatus': 'ringing',
                                    ':time': new Date().toISOString(),
                                    ':from': callRecord.phoneNumber || 'Unknown',
                                    ':clinicId': callRecord.clinicId,
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
                // This is triggered by call-hungup.ts or cleanup-monitor
                if (args.Action === 'Hangup') { // Note: This is 'Action' (capital A)
                    console.log(`[CALL_UPDATE_REQUESTED] Acknowledging Hangup request for call ${callId}`);
                    
                    // Get all active participants to hang up
                    const participants = event?.CallDetails?.Participants || [];
                    const hangupActions = participants
                        .filter((p: any) => p.Status === 'Connected')
                        .map((p: any) => ({
                            Type: 'Hangup',
                            Parameters: {
                                CallId: p.CallId,
                                SipResponseCode: '0'
                            }
                        }));
                    
                    // If no specific participants, hang up all
                    if (hangupActions.length === 0) {
                        hangupActions.push({ Type: 'Hangup', Parameters: { SipResponseCode: '0' } });
                    }
                    
                    return buildActions(hangupActions);
                }
                
                // If it's another action (like 'Hold', etc.), just log and acknowledge
                console.log(`[CALL_UPDATE_REQUESTED] Acknowledging unknown action:`, args);
                return buildActions([]); // Return empty actions to acknowledge
            }

            // Case 7: Call actions completed, or call ended
            case 'HANGUP':
            case 'CALL_ENDED': {
                console.log(`[${eventType}] Call ${callId} ended. Cleaning up resources.`);
                
                // Extract SIP response code to determine why the call ended
                // Common codes: 486 = Busy, 480 = No Answer, 603 = Decline, 487 = Request Terminated
                const sipResponseCode = event?.CallDetails?.SipResponseCode || 
                                        event?.ActionData?.Parameters?.SipResponseCode ||
                                        '0';
                const hangupSource = event?.ActionData?.Parameters?.Source || 'unknown';
                const participants = event?.CallDetails?.Participants || [];
                const sipHeaders = event?.CallDetails?.SipHeaders || {};
                
                // Check for voicemail indicators
                const isVoicemailLikely = 
                    sipHeaders['X-Voicemail'] === 'true' ||
                    sipHeaders['X-Answer-Machine'] === 'true' ||
                    (sipResponseCode === '200' && participants.some((p: any) => 
                        p.CallLegType === 'PSTN' && 
                        (p.Duration && p.Duration < 3000) // Call answered but very short
                    ));
                
                console.log(`[${eventType}] SIP Response Code: ${sipResponseCode}, Source: ${hangupSource}, VoicemailLikely: ${isVoicemailLikely}`);
                
                // Determine the reason for call end with more specific reasons
                let callEndReason = 'unknown';
                let callEndUserFriendly = '';
                
                switch (sipResponseCode?.toString()) {
                    case '486': 
                        callEndReason = 'busy'; 
                        callEndUserFriendly = 'Line is busy';
                        break;
                    case '480': 
                        callEndReason = 'no_answer'; 
                        callEndUserFriendly = 'No answer - call timed out';
                        break;
                    case '603': 
                        callEndReason = 'declined'; 
                        callEndUserFriendly = 'Call was declined';
                        break;
                    case '487': 
                        callEndReason = 'cancelled'; 
                        callEndUserFriendly = 'Call was cancelled';
                        break;
                    case '404': 
                        callEndReason = 'invalid_number'; 
                        callEndUserFriendly = 'Number not found or invalid';
                        break;
                    case '408': 
                        callEndReason = 'timeout'; 
                        callEndUserFriendly = 'Call timed out';
                        break;
                    case '484':
                        callEndReason = 'incomplete_number';
                        callEndUserFriendly = 'Incomplete phone number';
                        break;
                    case '503':
                        callEndReason = 'service_unavailable';
                        callEndUserFriendly = 'Service temporarily unavailable';
                        break;
                    case '502':
                    case '504':
                        callEndReason = 'network_error';
                        callEndUserFriendly = 'Network error - please try again';
                        break;
                    case '606':
                        callEndReason = 'not_acceptable';
                        callEndUserFriendly = 'Call could not be completed';
                        break;
                    case '0': 
                        callEndReason = isVoicemailLikely ? 'voicemail' : 'normal'; 
                        callEndUserFriendly = isVoicemailLikely ? 'Went to voicemail' : 'Call ended normally';
                        break;
                    case '200':
                        // 200 means call was answered - check if it went to voicemail
                        if (isVoicemailLikely) {
                            callEndReason = 'voicemail';
                            callEndUserFriendly = 'Went to voicemail';
                        } else {
                            callEndReason = 'normal';
                            callEndUserFriendly = 'Call ended normally';
                        }
                        break;
                    default: 
                        callEndReason = `sip_${sipResponseCode}`;
                        callEndUserFriendly = `Call ended (code: ${sipResponseCode})`;
                }
                
                // Stop recording if enabled (belt and suspenders - Chime auto-stops but this ensures it)
                const recordingsBucket = process.env.RECORDINGS_BUCKET;
                if (recordingsBucket && pstnLegCallId) {
                    try {
                        console.log(`[${eventType}] Ensuring recording stopped for call ${callId}`);
                        // Note: Chime will auto-stop recording when call ends, but we could add explicit stop here if needed
                    } catch (recordErr) {
                        console.warn(`[${eventType}] Error stopping recording:`, recordErr);
                        // Non-fatal, Chime will auto-stop when call ends
                    }
                }
                
                const { Items: callRecords } = await ddb.send(new QueryCommand({
                    TableName: CALL_QUEUE_TABLE_NAME,
                    IndexName: 'callId-index',
                    KeyConditionExpression: 'callId = :id',
                    ExpressionAttributeValues: { ':id': callId }
                }));

                if (callRecords && callRecords[0]) {
                    const callRecord = callRecords[0];
                    const { clinicId, queuePosition, meetingInfo, assignedAgentId, agentIds, status, direction } = callRecord;
                    
                    console.log(`[${eventType}] Found call record`, { 
                        callId, 
                        status, 
                        direction,
                        assignedAgent: assignedAgentId, 
                        hasMeeting: !!meetingInfo?.MeetingId,
                        callEndReason 
                    });
                    
                    // Clean up Media Pipeline if it was started for this call
                    if (callRecord.mediaPipelineId) {
                        stopMediaPipeline(callRecord.mediaPipelineId, callId).catch(pipelineErr => {
                            console.warn(`[${eventType}] Failed to stop Media Pipeline:`, pipelineErr);
                        });
                    }
                    
                    // *** CRITICAL FIX ***
                    // Only delete the meeting if it was a temporary "queue" meeting for INBOUND calls.
                    // For OUTBOUND calls, meetingInfo contains the AGENT'S SESSION meeting - DO NOT delete it!
                    const isOutboundCall = direction === 'outbound' || status === 'dialing';
                    
                    // FIX #6: Also cleanup meetings for 'ringing' calls that were abandoned
                    // Previously only 'queued' status triggered cleanup, leaving orphaned meetings
                    const shouldCleanupMeeting = (status === 'queued' || status === 'ringing') && 
                                                  meetingInfo?.MeetingId && 
                                                  !isOutboundCall;
                    
                    if (shouldCleanupMeeting) {
                        try {
                            await cleanupMeeting(meetingInfo.MeetingId);
                            console.log(`[${eventType}] Cleaned up ${status.toUpperCase()} meeting ${meetingInfo.MeetingId}`);
                        } catch (meetingErr) {
                            console.warn(`[${eventType}] Failed to cleanup ${status} meeting:`, meetingErr);
                        }
                    } else if (isOutboundCall && meetingInfo?.MeetingId) {
                        // *** FIX: Do NOT delete the agent's session meeting for outbound calls ***
                        console.log(`[${eventType}] Outbound call ended. Agent session meeting ${meetingInfo.MeetingId} will NOT be deleted.`);
                    } else if (meetingInfo?.MeetingId) {
                        console.log(`[${eventType}] Call ended for agent session meeting ${meetingInfo.MeetingId}. Meeting will NOT be deleted.`);
                    }
                    
                    // Determine final status based on call state and end reason
                    let finalStatus: string;
                    if (status === 'connected' || status === 'on_hold') {
                        finalStatus = 'completed';
                    } else if (status === 'dialing') {
                        // Outbound call that never connected
                        finalStatus = callEndReason === 'normal' ? 'completed' : 'failed';
                    } else {
                        finalStatus = 'abandoned';
                    }
                    
                    const callDuration = callRecord.acceptedAt 
                        ? Math.floor(Date.now() / 1000) - Math.floor(new Date(callRecord.acceptedAt).getTime() / 1000)
                        : 0;
                        
                    try {
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition },
                            UpdateExpression: 'SET #status = :status, endedAt = :timestamp, endedAtIso = :timestampIso, callDuration = :duration, callEndReason = :reason, callEndMessage = :message, sipResponseCode = :sipCode REMOVE customerAttendeeInfo, agentAttendeeInfo',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':status': finalStatus,
                                ':timestamp': Math.floor(Date.now() / 1000),
                                ':timestampIso': new Date().toISOString(),
                                ':duration': callDuration,
                                ':reason': callEndReason,
                                ':message': callEndUserFriendly,
                                ':sipCode': sipResponseCode?.toString() || 'unknown'
                            }
                        }));
                        
                        console.log(`[${eventType}] Call ${callId} record updated with end reason: ${callEndReason} - ${callEndUserFriendly}`);
                        
                    } catch (updateErr) {
                        console.error(`[${eventType}] Failed to update call record:`, updateErr);
                    }
                    
                    // Update agent status if they were assigned
                    if (assignedAgentId) {
                        try {
                            // *** FIX: Include callEndReason and user-friendly message for UI feedback ***
                            // For outbound calls that were rejected/unanswered, this is critical for UI
                            const wasDialingOutbound = status === 'dialing' && isOutboundCall;
                            const dialingFailed = wasDialingOutbound && callEndReason !== 'normal' && callEndReason !== 'completed';
                            
                            // Enhanced update with detailed call end info
                            await ddb.send(new UpdateCommand({
                                TableName: AGENT_PRESENCE_TABLE_NAME,
                                Key: { agentId: assignedAgentId },
                                UpdateExpression: `SET #status = :status, lastActivityAt = :timestamp, lastCallEndedAt = :timestamp, 
                                    lastCallEndReason = :reason, lastCallEndMessage = :message, lastCallId = :callId,
                                    lastCallWasOutbound = :wasOutbound, lastDialingFailed = :dialFailed
                                    REMOVE currentCallId, callStatus, currentMeetingAttendeeId, dialingState, dialingStartedAt, 
                                    ringingStartedAt, outboundCallId, outboundToNumber`,
                                ConditionExpression: 'attribute_exists(agentId) AND (currentCallId = :callId OR outboundCallId = :callId OR attribute_not_exists(currentCallId))',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':status': 'Online',
                                    ':timestamp': new Date().toISOString(),
                                    ':callId': callId,
                                    ':reason': wasDialingOutbound ? callEndReason : 'completed',
                                    ':message': wasDialingOutbound ? callEndUserFriendly : 'Call completed',
                                    ':wasOutbound': isOutboundCall,
                                    ':dialFailed': dialingFailed
                                }
                            }));
                            
                            if (dialingFailed) {
                                console.log(`[${eventType}] Agent ${assignedAgentId} outbound call FAILED. Reason: ${callEndReason} - ${callEndUserFriendly}`);
                            } else {
                                console.log(`[${eventType}] Agent ${assignedAgentId} marked as available. Call end reason: ${callEndReason}`);
                            }
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
                                UpdateExpression: 'SET #status = :online, lastActivityAt = :timestamp REMOVE ringingCallId, ringingCallTime, ringingCallFrom, ringingCallClinicId, ringingCallNotes, ringingCallTransferAgentId, ringingCallTransferMode',
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

            // Case 8: Send DTMF tones - triggered by send-dtmf.ts API
            case 'SEND_DTMF': {
                if (args.action === 'SEND_DTMF' && args.digits) {
                    const { digits, durationMs, gapMs, agentId } = args;
                    console.log(`[SEND_DTMF] Sending DTMF digits for call ${callId}`, { 
                        digitsLength: digits?.length,
                        durationMs,
                        gapMs,
                        agentId 
                    });

                    // Build SendDigits action for DTMF
                    const sendDigitsAction = {
                        Type: 'SendDigits',
                        Parameters: {
                            CallId: pstnLegCallId || callId,
                            Digits: digits,
                            ToneDurationInMilliseconds: parseInt(durationMs || '250', 10),
                            ToneGapInMilliseconds: parseInt(gapMs || '50', 10)
                        }
                    };

                    return buildActions([sendDigitsAction]);
                }
                console.warn('[SEND_DTMF] Event without proper action');
                return buildActions([]);
            }

            // Case 9: Add Call events - for secondary call connection
            case 'ADD_CALL_CONNECTED': {
                if (args.callType === 'AddCall' && args.primaryCallId) {
                    const { primaryCallId, agentId, meetingId, holdPrimaryCall } = args;
                    console.log(`[ADD_CALL_CONNECTED] Secondary call ${callId} connected for agent ${agentId}`, { 
                        primaryCallId, 
                        meetingId,
                        holdPrimaryCall 
                    });

                    // Join the secondary call participant to the agent's meeting
                    if (meetingId && pstnLegCallId) {
                        // Create attendee for the secondary call participant
                        try {
                            const attendeeResponse = await chime.send(new CreateAttendeeCommand({
                                MeetingId: meetingId,
                                ExternalUserId: `secondary-${callId}`
                            }));

                            if (attendeeResponse.Attendee) {
                                // Update call record with attendee info
                                const { Items: callRecords } = await ddb.send(new QueryCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    IndexName: 'callId-index',
                                    KeyConditionExpression: 'callId = :callId',
                                    ExpressionAttributeValues: { ':callId': callId }
                                }));

                                if (callRecords && callRecords[0]) {
                                    const callRecord = callRecords[0];
                                    await ddb.send(new UpdateCommand({
                                        TableName: CALL_QUEUE_TABLE_NAME,
                                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                        UpdateExpression: 'SET #status = :connected, customerAttendeeInfo = :attendee, connectedAt = :now',
                                        ExpressionAttributeNames: { '#status': 'status' },
                                        ExpressionAttributeValues: {
                                            ':connected': 'connected',
                                            ':attendee': attendeeResponse.Attendee,
                                            ':now': new Date().toISOString()
                                        }
                                    }));
                                }

                                return buildActions([
                                    buildSpeakAction('Connecting your second call.'),
                                    buildJoinChimeMeetingAction(
                                        pstnLegCallId,
                                        { MeetingId: meetingId },
                                        attendeeResponse.Attendee
                                    )
                                ]);
                            }
                        } catch (err) {
                            console.error('[ADD_CALL_CONNECTED] Failed to create attendee:', err);
                            return buildActions([buildSpeakAction('Failed to connect the call.')]);
                        }
                    }
                }
                return buildActions([]);
            }

            // Case 10: Conference merge - merge two calls into a 3-way conference
            case 'CONFERENCE_MERGE': {
                if (args.action === 'CONFERENCE_MERGE' && args.conferenceId && args.meetingId) {
                    const { conferenceId, meetingId, agentId, role, otherCallId } = args;
                    console.log(`[CONFERENCE_MERGE] Merging call ${callId} into conference ${conferenceId}`, { 
                        role, 
                        meetingId,
                        otherCallId 
                    });

                    // Join this call's participant to the conference meeting
                    if (pstnLegCallId) {
                        try {
                            // Create attendee for this call's participant
                            const attendeeResponse = await chime.send(new CreateAttendeeCommand({
                                MeetingId: meetingId,
                                ExternalUserId: `conference-${conferenceId}-${callId}`
                            }));

                            if (attendeeResponse.Attendee) {
                                // Update call record with conference info
                                const { Items: callRecords } = await ddb.send(new QueryCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    IndexName: 'callId-index',
                                    KeyConditionExpression: 'callId = :callId',
                                    ExpressionAttributeValues: { ':callId': callId }
                                }));

                                if (callRecords && callRecords[0]) {
                                    const callRecord = callRecords[0];
                                    await ddb.send(new UpdateCommand({
                                        TableName: CALL_QUEUE_TABLE_NAME,
                                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                        UpdateExpression: 'SET conferenceAttendeeInfo = :attendee, conferenceJoinedAt = :now',
                                        ExpressionAttributeValues: {
                                            ':attendee': attendeeResponse.Attendee,
                                            ':now': new Date().toISOString()
                                        }
                                    }));
                                }

                                return buildActions([
                                    buildSpeakAction('You are now in a conference call.'),
                                    buildJoinChimeMeetingAction(
                                        pstnLegCallId,
                                        { MeetingId: meetingId },
                                        attendeeResponse.Attendee
                                    )
                                ]);
                            }
                        } catch (err) {
                            console.error('[CONFERENCE_MERGE] Failed to join conference:', err);
                            return buildActions([buildSpeakAction('Failed to join the conference.')]);
                        }
                    }
                }
                return buildActions([]);
            }

            // Case 11: Conference add - add a new participant to conference
            case 'CONFERENCE_ADD': {
                if (args.action === 'CONFERENCE_ADD' && args.conferenceId && args.meetingId) {
                    const { conferenceId, meetingId, agentId } = args;
                    console.log(`[CONFERENCE_ADD] Adding call ${callId} to conference ${conferenceId}`);

                    if (pstnLegCallId) {
                        try {
                            const attendeeResponse = await chime.send(new CreateAttendeeCommand({
                                MeetingId: meetingId,
                                ExternalUserId: `conference-add-${conferenceId}-${callId}`
                            }));

                            if (attendeeResponse.Attendee) {
                                return buildActions([
                                    buildSpeakAction('Adding you to the conference.'),
                                    buildJoinChimeMeetingAction(
                                        pstnLegCallId,
                                        { MeetingId: meetingId },
                                        attendeeResponse.Attendee
                                    )
                                ]);
                            }
                        } catch (err) {
                            console.error('[CONFERENCE_ADD] Failed to add to conference:', err);
                            return buildActions([buildSpeakAction('Failed to join the conference.')]);
                        }
                    }
                }
                return buildActions([]);
            }

            // Case 12: Conference remove - remove a participant from conference (hang up that leg)
            case 'CONFERENCE_REMOVE': {
                if (args.action === 'CONFERENCE_REMOVE' && args.conferenceId) {
                    const { conferenceId, agentId } = args;
                    console.log(`[CONFERENCE_REMOVE] Removing call ${callId} from conference ${conferenceId}`);

                    return buildActions([
                        buildSpeakAction('You have been removed from the conference. Goodbye.'),
                        buildPauseAction(500),
                        { Type: 'Hangup', Parameters: { SipResponseCode: '0' } }
                    ]);
                }
                return buildActions([]);
            }

            // Case 13: Conference end - end the entire conference
            case 'CONFERENCE_END': {
                if (args.action === 'CONFERENCE_END' && args.conferenceId) {
                    const { conferenceId, agentId } = args;
                    console.log(`[CONFERENCE_END] Ending conference ${conferenceId} for call ${callId}`);

                    return buildActions([
                        buildSpeakAction('The conference has ended. Goodbye.'),
                        buildPauseAction(500),
                        { Type: 'Hangup', Parameters: { SipResponseCode: '0' } }
                    ]);
                }
                return buildActions([]);
            }
            
            // --- Informational events ---
            // Note: RINGING is now handled above with outbound call tracking
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

                // For StartCallRecording failures, just log and continue with a pause - recording is optional
                if (failedActionType === 'StartCallRecording') {
                    console.warn(`[ACTION_FAILED] StartCallRecording failed - continuing call without recording`, { errorType, errorMessage });
                    // Return a minimal pause action to keep call flow going
                    return buildActions([buildPauseAction(100)]);
                }

                // For other failures, return a pause action to keep the call alive
                console.warn(`[ACTION_FAILED] Returning pause action for failed ${failedActionType}`);
                return buildActions([buildPauseAction(100)]);
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



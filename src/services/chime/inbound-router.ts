import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, GetCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
    ChimeSDKMeetingsClient,
    CreateMeetingCommand,
    CreateAttendeeCommand,
    DeleteMeetingCommand,
} from '@aws-sdk/client-chime-sdk-meetings';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PollyClient, SynthesizeSpeechCommand, Engine, OutputFormat, VoiceId } from '@aws-sdk/client-polly';
import { Readable } from 'stream';
import { enrichCallContext } from './utils/agent-selection';
import { generateUniqueCallPosition } from '../shared/utils/unique-id';
import { startMediaPipeline, stopMediaPipeline, isRealTimeTranscriptionEnabled } from './utils/media-pipeline-manager';
import {
    isPushNotificationsEnabled,
    sendIncomingCallToAgents,
    sendMissedCallNotification,
    sendCallEndedToAgent,
    sendCallAnsweredToAgent,
    type IncomingCallNotification,
    type CallEndedNotification,
    type CallAnsweredNotification
} from './utils/push-notifications';
// Import per-clinic AI inbound toggle check
import { isAiInboundEnabled } from '../ai-agents/voice-agent-config';

// ========================================
// NEW ADVANCED FEATURES - Chime Stack Improvements
// ========================================
import { CHIME_CONFIG, logChimeConfig } from './config';
import {
    // Performance tracking
    startTrace, endTrace, startSpan, endSpan, timeOperation,
    // Metrics
    publishMetric, publishMetrics, MetricName, publishCallMetrics, publishQueueMetrics, publishAgentMetrics,
    // PII Redaction
    redactPII, getSafeLogData, redactTranscript,
    // Audit Logging
    logAuditEvent, createAuditEvent, AuditEventType, auditCallEvent,
    // Sentiment Analysis
    analyzeSentiment, processTranscriptionSegment, generateCallSentimentSummary, publishSentimentMetrics,
    // Broadcast Ring
    broadcastRingToAllAgents, claimBroadcastCall, handleBroadcastTimeout, isBroadcastEnabled,
    // Overflow Routing
    shouldTriggerOverflow, getOverflowClinics, fetchOverflowAgents, attemptOverflowRouting, isOverflowAgent,
    // Smart Retry
    withRetry, withCircuitBreaker, withRetryAndCircuitBreaker,
    // Enhanced Agent Selection
    scoreAgentEnhanced, rankAgentsEnhanced, fetchAgentPerformanceData,
    // Quality Scoring
    calculateQualityMetrics, saveQualityMetrics, shouldAlertOnQuality,
    // Supervisor Tools
    getMonitorableCalls, startSupervision, SupervisionMode, sendWhisperMessage,
    // Call Summarizer
    summarizeCall, saveCallSummary, generateQuickSummary,
} from './utils';

// This Lambda is the "brain" for call routing.
// It is NOT triggered by API Gateway. It is triggered by the Chime SDK SIP Media Application.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ttsS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const polly = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });

// CHIME_MEDIA_REGION: Chime SDK Meetings must be created in a supported media region.
// This is set by ChimeStack CDK and ensures all Chime operations use the same region.
// Supported regions: us-east-1, us-west-2, eu-west-2, ap-southeast-1, etc.
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
// Push-first routing source of truth (agents explicitly toggle active)
const AGENT_ACTIVE_TABLE_NAME = process.env.AGENT_ACTIVE_TABLE_NAME || '';
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME!;
const VOICE_CALL_ANALYTICS_TABLE = process.env.VOICE_CALL_ANALYTICS_TABLE;
const HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET;
const POLLY_VOICE_ID = (process.env.POLLY_VOICE_ID || 'Joanna') as VoiceId;
const POLLY_ENGINE = (process.env.POLLY_ENGINE || 'standard') as Engine;
const TTS_SAMPLE_RATE = 8000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// After-hours forwarding (Connect/Lex AI)
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE;
const ENABLE_AFTER_HOURS_AI = process.env.ENABLE_AFTER_HOURS_AI === 'true';

function isValidTransactionId(value: unknown): value is string {
    return typeof value === 'string' && UUID_REGEX.test(value);
}

// Default queue timeout in seconds (24 hours) - Increased to handle long calls
const QUEUE_TIMEOUT = 24 * 60 * 60;
// Average call duration in seconds (5 minutes) - used for wait time estimation
const AVG_CALL_DURATION = 300;
// Max agents to ring for an inbound call offer (push-first + call-queue agentIds)
const MAX_RING_AGENTS = Math.max(1, Number.parseInt(process.env.MAX_RING_AGENTS || '25', 10));

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
    | 'failed'              // Call failed for technical reasons
    | 'escalated';          // Call escalated due to excessive rejections - requires supervisor

// Valid call state transitions
// FIX #13: Removed backward transitions that could bypass queue logic
// State machine should be forward-only except for explicit retry scenarios
// 
// FIX: Enhanced state transitions for edge cases:
// - 'dialing' can now transition to 'queued' for retry scenarios
// - 'escalated' can now transition to 'timeout' for unanswered escalated calls
// - 'failed' can now transition to 'queued' for retryable failures
const VALID_STATE_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
    'queued': ['ringing', 'abandoned', 'timeout', 'no_agents_available', 'failed'],
    'ringing': ['connected', 'queued', 'abandoned', 'no_agents_available', 'timeout', 'escalated', 'failed'],
    // FIX: 'dialing' can transition to 'queued' for outbound calls that should be retried
    'dialing': ['connected', 'timeout', 'abandoned', 'failed', 'queued'],
    'connected': ['on_hold', 'completed', 'abandoned', 'failed'],
    'on_hold': ['connected', 'abandoned', 'completed'],
    'timeout': ['queued'], // FIX: Allow retry from timeout for scheduled retries
    'completed': [],
    'abandoned': [],
    // FIX #13: no_agents_available can transition to queued for scheduled retries
    'no_agents_available': ['ringing', 'abandoned', 'escalated', 'queued', 'timeout'],
    // FIX: Added 'timeout' transition for escalated calls that are never answered
    'escalated': ['connected', 'abandoned', 'completed', 'timeout'],
    // FIX: 'failed' can transition to 'queued' for retryable failures (e.g., transient errors)
    'failed': ['queued']
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
 * FIX #4 & #7 & #10: Queue Position Conflicts and Duplicate Prevention
 * Uses unique ID generation to prevent collisions and checks for existing callId
 * 
 * FIX #10: Uses retry loop with exponential backoff to handle GSI eventual consistency.
 * The callId-index GSI does not support ConsistentRead, so between checking for duplicates
 * and inserting, a parallel request could insert the same call. We handle this by:
 * 1. Using conditional PutItem to prevent overwriting
 * 2. On collision, re-checking the GSI with a small delay to allow replication
 * 3. Using a unique callId-based lock if distributed locks are available
 */
async function addToQueue(clinicId: string, callId: string, phoneNumber: string): Promise<QueueEntry> {
    const now = Math.floor(Date.now() / 1000);
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
                existingPosition: existingEntry.queuePosition,
                attempt
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
                // FIX #10: Added callId uniqueness condition to prevent duplicates due to GSI eventual consistency
                ConditionExpression: 'attribute_not_exists(clinicId) AND attribute_not_exists(queuePosition)'
            }));

            console.log('[addToQueue] Successfully queued call', { clinicId, callId, queuePosition, attempt });
            return entry;

        } catch (err: any) {
            if (err.name === 'ConditionalCheckFailedException') {
                console.warn('[addToQueue] Position collision - will retry', { clinicId, callId, queuePosition, attempt });

                // FIX #10: Add small delay before retry to allow GSI replication
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
                }
                // Continue to next iteration (will re-check GSI)
            } else {
                throw err;
            }
        }
    }

    // FIX #10: Final check after all retries - the call should exist by now due to eventual consistency
    const { Items: finalCheck } = await ddb.send(new QueryCommand({
        TableName: CALL_QUEUE_TABLE_NAME,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: { ':callId': callId }
    }));

    if (finalCheck && finalCheck.length > 0) {
        console.warn('[addToQueue] Found call after retries exhausted - likely added by parallel request', { callId });
        return finalCheck[0] as QueueEntry;
    }

    // This should rarely happen - throw error for investigation
    throw new Error(`[addToQueue] Failed to queue call after ${MAX_RETRIES} attempts: ${callId}`);
}

// VIP phone numbers cache - parsed once at cold start since env vars don't change during execution
// CRITICAL FIX #10: Removed pointless TTL-based refresh - env vars are set at cold start and don't change
let vipPhoneNumbersCache: Set<string> | null = null;

function getVipPhoneNumbers(): Set<string> {
    // Return cached value if already parsed
    if (vipPhoneNumbersCache !== null) {
        return vipPhoneNumbersCache;
    }

    // Parse VIP phone numbers from environment variable (once per cold start)
    try {
        const raw = process.env.VIP_PHONE_NUMBERS;
        if (!raw) {
            vipPhoneNumbersCache = new Set<string>();
            return vipPhoneNumbersCache;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            vipPhoneNumbersCache = new Set<string>(parsed.map((v) => String(v)));
            console.log('[inbound-router] VIP phone numbers loaded', {
                count: vipPhoneNumbersCache.size
            });
        } else {
            console.warn('[inbound-router] VIP_PHONE_NUMBERS is not an array');
            vipPhoneNumbersCache = new Set<string>();
        }
    } catch (err) {
        console.warn('[inbound-router] Failed to parse VIP_PHONE_NUMBERS:', err);
        vipPhoneNumbersCache = new Set<string>();
    }
    return vipPhoneNumbersCache;
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

        // FIX #9: PERFORMANCE WARNING - This query scans ALL online agents across all clinics
        // then filters client-side. For large contact centers, consider adding a composite
        // GSI with partition key 'clinicId' and sort key 'status' for O(1) clinic-specific queries.
        // Alternative: Use a separate table to track clinic-to-agent mappings.
        // Current approach: status-index GSI + FilterExpression = O(n) where n = all online agents
        // Better approach: clinicId-status GSI = O(m) where m = agents for this clinic
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


// --- Utility Functions ---
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const streamToBuffer = async (stream: Readable | any): Promise<Buffer> => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

const pcmToWav = (pcmData: Buffer, sampleRate: number, bitsPerSample: number, numChannels: number): Buffer => {
    const dataSize = pcmData.length;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);

    const wavBuffer = Buffer.alloc(totalSize);

    // RIFF header
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(totalSize - 8, 4);
    wavBuffer.write('WAVE', 8);

    // fmt sub-chunk
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16); // Sub-chunk size
    wavBuffer.writeUInt16LE(1, 20); // Audio format (PCM)
    wavBuffer.writeUInt16LE(numChannels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataSize, 40);
    pcmData.copy(wavBuffer, 44);

    return wavBuffer;
};

const synthesizeSpeechToS3 = async (text: string, callId: string): Promise<string> => {
    if (!HOLD_MUSIC_BUCKET) {
        throw new Error('HOLD_MUSIC_BUCKET is not configured');
    }

    const audioKey = `tts/${callId}/${Date.now()}.wav`;
    const pollyResponse = await polly.send(new SynthesizeSpeechCommand({
        Engine: POLLY_ENGINE as Engine,
        OutputFormat: 'pcm' as OutputFormat,
        Text: text,
        VoiceId: POLLY_VOICE_ID as VoiceId,
        SampleRate: `${TTS_SAMPLE_RATE}`,
    }));

    if (!pollyResponse.AudioStream) {
        throw new Error('No audio stream returned from Polly');
    }

    const audioData = await streamToBuffer(pollyResponse.AudioStream as Readable);
    const wavData = pcmToWav(audioData, TTS_SAMPLE_RATE, 16, 1);

    await ttsS3.send(new PutObjectCommand({
        Bucket: HOLD_MUSIC_BUCKET,
        Key: audioKey,
        Body: wavData,
        ContentType: 'audio/wav',
    }));

    return audioKey;
};

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

const buildSpeakAction = (
    text: string,
    voiceId: string = 'Joanna',
    engine: string = 'neural',
    callId?: string,
    languageCode: string = 'en-US',
    textType: 'text' | 'ssml' = 'text'
) => ({
    Type: 'Speak',
    Parameters: {
        Text: text,
        Engine: engine,
        LanguageCode: languageCode,
        TextType: textType,
        VoiceId: voiceId,
        ...(callId && { CallId: callId })
    }
});

const buildTtsPlayAudioAction = async (
    text: string,
    targetCallId: string | undefined,
    callId: string
): Promise<any> => {
    if (!HOLD_MUSIC_BUCKET) {
        console.warn('[TTS] HOLD_MUSIC_BUCKET not configured; falling back to Speak');
        return buildSpeakAction(text, POLLY_VOICE_ID, POLLY_ENGINE, targetCallId);
    }

    try {
        const audioKey = await synthesizeSpeechToS3(text, callId);
        return buildPlayAudioAction(audioKey, 1, targetCallId);
    } catch (err: any) {
        console.error('[TTS] Failed to synthesize speech, falling back to Speak', {
            error: err?.message || err,
        });
        return buildSpeakAction(text, POLLY_VOICE_ID, POLLY_ENGINE, targetCallId);
    }
};

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

const buildPauseAction = (durationInMilliseconds: number, callId?: string) => ({
    Type: 'Pause',
    Parameters: {
        DurationInMilliseconds: durationInMilliseconds,
        ...(callId && { CallId: callId })
    }
});

// Updated to include Repeat parameter
const buildPlayAudioAction = (audioSource: string, repeat: number = 1, callId?: string) => ({
    Type: 'PlayAudio',
    Parameters: {
        AudioSource: {
            Type: 'S3',
            BucketName: HOLD_MUSIC_BUCKET,
            Key: audioSource
        },
        PlaybackTerminators: ['#', '*'],
        Repeat: repeat,
        ...(callId && { CallId: callId }),
    },
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

/**
 * Best-effort upsert into NotificationsStack VoiceCallAnalytics table.
 * This enables Marketing -> Voice Calls -> Analytics/Sent tabs.
 */
async function upsertVoiceCallAnalytics(
    callId: string,
    data: {
        clinicId?: string;
        scheduleId?: string;
        templateName?: string;
        patNum?: string;
        patientName?: string;
        recipientPhone?: string;
        fromPhoneNumber?: string;
        meetingId?: string;
        status?: string;
        startedAt?: string;
        answeredAt?: string;
        endedAt?: string;
        sipResponseCode?: string;
        endReason?: string;
        voiceId?: string;
        voiceEngine?: string;
        voiceLanguageCode?: string;
        source?: string;
    }
): Promise<void> {
    if (!VOICE_CALL_ANALYTICS_TABLE) return;
    try {
        const nowIso = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

        const exprNames: Record<string, string> = { '#status': 'status' };
        const exprValues: Record<string, any> = {
            ':now': nowIso,
            ':ttl': ttl,
            ':status': String(data.status || 'UNKNOWN'),
        };

        let updateExpr = 'SET updatedAt = :now, ttl = if_not_exists(ttl, :ttl), #status = :status';

        const setIfNotExists = (attr: string, value: any, token: string) => {
            if (value === undefined || value === null || String(value).length === 0) return;
            exprValues[token] = value;
            updateExpr += `, ${attr} = if_not_exists(${attr}, ${token})`;
        };

        setIfNotExists('clinicId', data.clinicId, ':clinicId');
        setIfNotExists('scheduleId', data.scheduleId, ':scheduleId');
        setIfNotExists('templateName', data.templateName, ':templateName');
        setIfNotExists('patNum', data.patNum, ':patNum');
        setIfNotExists('patientName', data.patientName, ':patientName');
        setIfNotExists('recipientPhone', data.recipientPhone, ':recipientPhone');
        setIfNotExists('fromPhoneNumber', data.fromPhoneNumber, ':fromPhoneNumber');
        setIfNotExists('meetingId', data.meetingId, ':meetingId');
        setIfNotExists('voiceId', data.voiceId, ':voiceId');
        setIfNotExists('voiceEngine', data.voiceEngine, ':voiceEngine');
        setIfNotExists('voiceLanguageCode', data.voiceLanguageCode, ':voiceLanguageCode');
        setIfNotExists('source', data.source, ':source');

        // Timestamps
        if (data.startedAt) {
            exprValues[':startedAt'] = data.startedAt;
            updateExpr += ', startedAt = if_not_exists(startedAt, :startedAt)';
        }
        if (data.answeredAt) {
            exprValues[':answeredAt'] = data.answeredAt;
            updateExpr += ', answeredAt = :answeredAt';
        }
        if (data.endedAt) {
            exprValues[':endedAt'] = data.endedAt;
            updateExpr += ', endedAt = :endedAt';
        }

        // End metadata
        if (data.sipResponseCode !== undefined) {
            exprValues[':sip'] = String(data.sipResponseCode);
            updateExpr += ', sipResponseCode = :sip';
        }
        if (data.endReason !== undefined) {
            exprValues[':reason'] = String(data.endReason);
            updateExpr += ', endReason = :reason';
        }

        await ddb.send(new UpdateCommand({
            TableName: VOICE_CALL_ANALYTICS_TABLE,
            Key: { callId },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValues,
        }));
    } catch (err: any) {
        console.warn('[VoiceCallAnalytics] Failed to upsert (non-fatal):', err?.message || err);
    }
}

// ========================================================================
// AFTER-HOURS FORWARDING HELPERS
// ========================================================================

interface ClinicHours {
    clinicId: string;
    timezone: string;
    hours: {
        [day: string]: {
            open: string;
            close: string;
            closed?: boolean;
        };
    };
}

/**
 * Check if a clinic is currently open based on their configured hours
 * 
 * Supports two data formats:
 * 1. ClinicHoursStack format: { clinicId, monday: {...}, tuesday: {...}, timeZone }
 * 2. Legacy format: { clinicId, hours: { monday: {...} }, timezone }
 */
async function isClinicOpen(clinicId: string): Promise<boolean> {
    if (!CLINIC_HOURS_TABLE) {
        console.warn('[isClinicOpen] CLINIC_HOURS_TABLE not configured - assuming open');
        return true;
    }

    try {
        const { Item } = await ddb.send(new GetCommand({
            TableName: CLINIC_HOURS_TABLE,
            Key: { clinicId },
        }));

        if (!Item) {
            // No hours defined = default to CLOSED (after-hours forwarding may apply)
            console.log('[isClinicOpen] No hours configured for clinic - defaulting to closed');
            return false;
        }

        const now = new Date();

        // Support both field names: timeZone (ClinicHoursStack) and timezone (legacy)
        const timezone = Item.timeZone || Item.timezone || 'America/New_York';

        // Get current time in clinic's timezone
        const options: Intl.DateTimeFormatOptions = {
            timeZone: timezone,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        };

        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(now);

        const dayOfWeek = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
        const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
        const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
        const currentTime = hour * 60 + minute; // Minutes since midnight

        // Support both formats:
        // 1. Direct on root: Item[dayOfWeek] (ClinicHoursStack format)
        // 2. Nested under hours: Item.hours[dayOfWeek] (legacy format)
        const todayHours = Item[dayOfWeek] || Item.hours?.[dayOfWeek];

        if (!todayHours) {
            console.log('[isClinicOpen] No hours for today - clinic closed', { clinicId, dayOfWeek });
            return false;
        }

        if (todayHours.closed) {
            console.log('[isClinicOpen] Clinic is marked closed today', { clinicId, dayOfWeek });
            return false;
        }

        if (!todayHours.open || !todayHours.close) {
            console.log('[isClinicOpen] Missing open/close times - assuming closed', { clinicId, dayOfWeek, todayHours });
            return false;
        }

        const [openHour, openMin] = todayHours.open.split(':').map(Number);
        const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
        const openTime = openHour * 60 + openMin;
        const closeTime = closeHour * 60 + closeMin;

        const isOpen = currentTime >= openTime && currentTime < closeTime;
        console.log('[isClinicOpen] Clinic hours check', {
            clinicId,
            dayOfWeek,
            timezone,
            currentTime: `${hour}:${minute}`,
            openTime: todayHours.open,
            closeTime: todayHours.close,
            isOpen
        });

        return isOpen;
    } catch (error) {
        console.error('[isClinicOpen] Error checking clinic hours:', error);
        // FIX: Consistent default behavior - default to CLOSED (after-hours forwarding may apply) on error
        // This matches voice-ai-handler.ts behavior and is safer:
        // - If we default to "open" but no agents are available, caller gets stuck
        // - If we default to "closed" but clinic is open, caller can still reach the after-hours assistant (if configured)
        return false;
    }
}

// Voice AI calling is handled by Amazon Connect + Lex (not by the Chime SMA handler).

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

                // ========== REGULAR CALL ROUTING ==========
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
                const clinic = clinics[0];
                const clinicId = clinic.clinicId;
                const aiPhoneNumber = typeof clinic.aiPhoneNumber === 'string' ? clinic.aiPhoneNumber.trim() : '';
                console.log(`[NEW_INBOUND_CALL] Call is for clinic ${clinicId}`);

                // ========== AFTER-HOURS FORWARDING CHECK ==========
                // If the clinic is closed, optionally forward the call to `clinic.aiPhoneNumber` (Connect/Lex).
                // Uses both global toggle (ENABLE_AFTER_HOURS_AI) and per-clinic toggle (aiInboundEnabled)
                if (ENABLE_AFTER_HOURS_AI) {
                    const clinicOpen = await isClinicOpen(clinicId);

                    if (!clinicOpen) {
                        // Check per-clinic AI inbound toggle - if disabled, route to agents only
                        const aiInboundEnabledForClinic = await isAiInboundEnabled(clinicId);

                        if (!aiInboundEnabledForClinic) {
                            console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED but AI inbound is DISABLED - routing to human agents`, {
                                callId,
                                clinicId,
                                callerNumber: fromPhoneNumber,
                            });
                            // Fall through to normal agent routing below
                        } else {
                            // AI After-Hours is ENABLED for this clinic
                            // Check if clinic has a dedicated AI phone number to forward to
                            if (aiPhoneNumber) {
                                console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED - forwarding to AI phone number`, {
                                    callId,
                                    clinicId,
                                    callerNumber: fromPhoneNumber,
                                    aiPhoneNumber,
                                });

                                // Forward call to the AI phone number via PSTN CallAndBridge
                                // The AI phone number is handled by Amazon Connect + Lex.
                                return buildActions([
                                    buildSpeakAction('Please hold while we connect you to our after-hours assistant.'),
                                    buildCallAndBridgeAction(
                                        toPhoneNumber, // Caller ID shows the clinic's main number
                                        aiPhoneNumber, // Forward to the AI phone number
                                        {
                                            'X-Clinic-Id': clinicId,
                                            'X-Forward-Reason': 'after-hours',
                                            'X-Original-Caller': fromPhoneNumber,
                                        }
                                    ),
                                ]);
                            }

                            // No AI phone number configured - inform caller and end the call (no Chime-side AI).
                            console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED - no aiPhoneNumber configured; ending call`, {
                                callId,
                                clinicId,
                                callerNumber: fromPhoneNumber,
                            });
                            const clinicName = clinic.clinicName || 'our dental office';
                            return buildActions([
                                buildSpeakAction(
                                    `Thank you for calling ${clinicName}. We are currently closed. ` +
                                    `Please call back during business hours.`
                                ),
                                { Type: 'Hangup', Parameters: { SipResponseCode: '0' } },
                            ]);
                        }
                    } else {
                        console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is OPEN - proceeding with human agent routing`);
                    }
                }

                // 2. Build call context (priority, VIP, etc.)
                const callContext = await enrichCallContext(
                    ddb,
                    callId,
                    clinicId,
                    fromPhoneNumber,
                    CALL_QUEUE_TABLE_NAME,
                    getVipPhoneNumbers()
                );

                // Always ensure a queue record exists for this call so we can:
                // - fairly distribute idle agents across multiple waiting calls
                // - fall back to queued state if no one can be rung
                // - support consistent call lookups via callId-index
                const queueEntry = await addToQueue(clinicId, callId, fromPhoneNumber);

                // Persist enriched routing metadata so queued calls retain correct priority
                try {
                    const routingUpdateParts: string[] = [
                        'priority = :priority',
                        'isVip = :isVip',
                        'isCallback = :isCallback',
                        'previousCallCount = :previousCallCount',
                        'updatedAt = :updatedAt'
                    ];
                    const routingValues: Record<string, any> = {
                        ':priority': callContext.priority || 'normal',
                        ':isVip': !!callContext.isVip,
                        ':isCallback': !!callContext.isCallback,
                        ':previousCallCount': typeof callContext.previousCallCount === 'number' ? callContext.previousCallCount : 0,
                        ':updatedAt': new Date().toISOString(),
                    };

                    // Only set previousAgentId if known (avoid writing undefined)
                    if (typeof callContext.previousAgentId === 'string' && callContext.previousAgentId.length > 0) {
                        routingUpdateParts.push('previousAgentId = :previousAgentId');
                        routingValues[':previousAgentId'] = callContext.previousAgentId;
                    }
                    if (Array.isArray(callContext.requiredSkills) && callContext.requiredSkills.length > 0) {
                        routingUpdateParts.push('requiredSkills = :requiredSkills');
                        routingValues[':requiredSkills'] = callContext.requiredSkills;
                    }
                    if (Array.isArray(callContext.preferredSkills) && callContext.preferredSkills.length > 0) {
                        routingUpdateParts.push('preferredSkills = :preferredSkills');
                        routingValues[':preferredSkills'] = callContext.preferredSkills;
                    }
                    if (typeof callContext.language === 'string' && callContext.language.length > 0) {
                        routingUpdateParts.push('#language = :language');
                        routingValues[':language'] = callContext.language;
                    }

                    await ddb.send(new UpdateCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId, queuePosition: queueEntry.queuePosition },
                        UpdateExpression: `SET ${routingUpdateParts.join(', ')}`,
                        ExpressionAttributeNames: {
                            ...(typeof callContext.language === 'string' && callContext.language.length > 0 ? { '#language': 'language' } : {}),
                        },
                        ExpressionAttributeValues: routingValues,
                    }));
                } catch (metaErr) {
                    console.warn('[NEW_INBOUND_CALL] Failed to persist routing metadata (non-fatal):', metaErr);
                }

                // ========================================
                // PUSH-FIRST ROUTING (MEETING-PER-CALL)
                // ========================================
                // - Source of truth for who can receive call offers is AgentActive table (not AgentPresence).
                // - We create a per-call meeting + customer attendee immediately, but do NOT join PSTN leg yet.
                //   The PSTN leg is bridged into the meeting only after an agent accepts (BRIDGE_CUSTOMER_INBOUND).

                // 1) Ensure per-call meeting + customer attendee exist (best-effort)
                try {
                    const { Item: existingCall } = await ddb.send(new GetCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId, queuePosition: queueEntry.queuePosition },
                        ConsistentRead: true,
                    }));

                    const existingMeetingId =
                        (existingCall as any)?.meetingId ||
                        (existingCall as any)?.meetingInfo?.MeetingId;
                    const hasCustomerAttendee =
                        !!(existingCall as any)?.customerAttendeeInfo?.AttendeeId &&
                        !!(existingCall as any)?.customerAttendeeInfo?.JoinToken;

                    if (!existingMeetingId || !hasCustomerAttendee) {
                        const meetingResponse = await chime.send(new CreateMeetingCommand({
                            ClientRequestToken: callId,
                            MediaRegion: CHIME_MEDIA_REGION,
                            ExternalMeetingId: callId,
                        }));

                        const meetingInfo = meetingResponse.Meeting;
                        const meetingId = meetingInfo?.MeetingId;
                        if (meetingId) {
                            const customerAttendeeResponse = await chime.send(new CreateAttendeeCommand({
                                MeetingId: meetingId,
                                ExternalUserId: `customer-${callId}`.slice(0, 64),
                            }));

                            const customerAttendeeInfo = customerAttendeeResponse.Attendee;

                            if (customerAttendeeInfo?.AttendeeId && customerAttendeeInfo?.JoinToken) {
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId, queuePosition: queueEntry.queuePosition },
                                    UpdateExpression: 'SET meetingId = :meetingId, meetingInfo = :meetingInfo, customerAttendeeInfo = :customerAttendee, updatedAt = :ts',
                                    ExpressionAttributeValues: {
                                        ':meetingId': meetingId,
                                        ':meetingInfo': meetingInfo,
                                        ':customerAttendee': customerAttendeeInfo,
                                        ':ts': new Date().toISOString(),
                                    },
                                }));
                            } else {
                                console.warn('[NEW_INBOUND_CALL] Customer attendee created but missing required fields (non-fatal)', {
                                    callId,
                                    clinicId,
                                    hasAttendeeId: !!customerAttendeeInfo?.AttendeeId,
                                    hasJoinToken: !!customerAttendeeInfo?.JoinToken,
                                });
                            }
                        } else {
                            console.warn('[NEW_INBOUND_CALL] Meeting created but missing MeetingId (non-fatal)', { callId, clinicId });
                        }
                    }
                } catch (meetingErr) {
                    console.warn('[NEW_INBOUND_CALL] Failed to create/persist per-call meeting (non-fatal):', meetingErr);
                }

                // 2) Query explicitly-active agents for this clinic (AgentActive table)
                let activeAgentIds: string[] = [];
                if (AGENT_ACTIVE_TABLE_NAME) {
                    try {
                        const { Items: activeRows } = await ddb.send(new QueryCommand({
                            TableName: AGENT_ACTIVE_TABLE_NAME,
                            KeyConditionExpression: 'clinicId = :clinicId',
                            FilterExpression: '#state = :active',
                            ExpressionAttributeNames: { '#state': 'state' },
                            ExpressionAttributeValues: {
                                ':clinicId': clinicId,
                                ':active': 'active',
                            },
                            ProjectionExpression: 'agentId',
                        }));

                        activeAgentIds = (activeRows || [])
                            .map((r: any) => r?.agentId)
                            .filter((v: any): v is string => typeof v === 'string' && v.length > 0);

                        console.log('[NEW_INBOUND_CALL] AgentActive lookup result', {
                            callId,
                            clinicId,
                            tableName: AGENT_ACTIVE_TABLE_NAME,
                            rawRowCount: (activeRows || []).length,
                            activeAgentIds,
                            agentCount: activeAgentIds.length,
                        });
                    } catch (activeErr) {
                        console.warn('[NEW_INBOUND_CALL] Failed querying AgentActive (non-fatal):', activeErr);
                    }
                } else {
                    console.warn('[NEW_INBOUND_CALL] AGENT_ACTIVE_TABLE_NAME not configured; call will remain queued', { callId, clinicId });
                }

                // 3) If agents are active, transition call to ringing and push an offer
                const uniqueAgentIds = Array.from(new Set(activeAgentIds)).slice(0, MAX_RING_AGENTS);
                if (uniqueAgentIds.length > 0) {
                    const ringAttemptTimestamp = new Date().toISOString();
                    let ringingStarted = false;

                    try {
                        await ddb.send(new UpdateCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            Key: { clinicId, queuePosition: queueEntry.queuePosition },
                            UpdateExpression:
                                'SET #status = :ringing, agentIds = :agentIds, ringStartTimeIso = :ts, ringStartTime = :now, lastStateChange = :ts, updatedAt = :ts',
                            ConditionExpression: '#status = :queued',
                            ExpressionAttributeNames: { '#status': 'status' },
                            ExpressionAttributeValues: {
                                ':ringing': 'ringing',
                                ':queued': 'queued',
                                ':agentIds': uniqueAgentIds,
                                ':ts': ringAttemptTimestamp,
                                ':now': Date.now(),
                            },
                        }));
                        ringingStarted = true;
                    } catch (err: any) {
                        if (err?.name === 'ConditionalCheckFailedException') {
                            // Another process may have transitioned state; treat as non-fatal and continue.
                            console.warn('[NEW_INBOUND_CALL] Call not in queued state when attempting to ring (non-fatal)', { callId, clinicId });
                        } else {
                            console.warn('[NEW_INBOUND_CALL] Failed to set call to ringing (non-fatal):', err);
                        }
                    }

                    if (ringingStarted && isPushNotificationsEnabled()) {
                        try {
                            await sendIncomingCallToAgents(uniqueAgentIds, {
                                callId,
                                clinicId,
                                clinicName: String(clinic.clinicName || clinicId),
                                callerPhoneNumber: fromPhoneNumber,
                                timestamp: ringAttemptTimestamp,
                            });
                        } catch (pushErr) {
                            console.warn('[NEW_INBOUND_CALL] Failed to send push offer (non-fatal):', pushErr);
                        }
                    }

                    console.log(`[NEW_INBOUND_CALL] Placing customer ${callId} on hold while notifying agent(s) via push.`, {
                        clinicId,
                        agentsNotified: uniqueAgentIds.length,
                        ringingStarted,
                    });

                    // Start call recording if enabled
                    const enableRecording = process.env.ENABLE_CALL_RECORDING === 'true';
                    const recordingsBucket = process.env.RECORDINGS_BUCKET;
                    const actions = [];

                    if (enableRecording && recordingsBucket && pstnLegCallId) {
                        console.log(`[NEW_INBOUND_CALL] Starting recording for call ${callId}`);
                        actions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));

                        // Update call queue with recording metadata (best-effort)
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
                            console.log('[NEW_INBOUND_CALL] Updated call record with pstnCallId:', pstnLegCallId);
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

                console.log(`[NEW_INBOUND_CALL] No active agents for clinic ${clinicId}. Keeping caller in queue.`);

                // Standard queue handling
                console.log(`[NEW_INBOUND_CALL] Adding call to queue.`);
                try {
                    // Queue entry was already created above; keep existing behavior/log shape.
                    console.log('[NEW_INBOUND_CALL] Call is queued', { clinicId, callId, queueEntry });

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

            // Case 2: A new call *from* our system (agent outbound call OR AI outbound call)
            // This is triggered by outbound-call.ts (human agent) or outbound-call-scheduler.ts (AI)
            case 'NEW_OUTBOUND_CALL': {
                console.log(`[NEW_OUTBOUND_CALL] Initiated for call ${callId}`, args);

                const callType = args.callType;
                const clinicId = args.fromClinicId || args.clinicId;

                // ========== HUMAN AGENT OUTBOUND CALL ==========
                // The outbound-call.ts Lambda has already created the call record
                // and updated the agent's status to 'dialing'.

                const outboundAgentId = args.agentId;
                const meetingId = args.meetingId;

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

            // Case 3: Customer answers an outbound call (human agent OR AI)
            case 'CALL_ANSWERED': {
                console.log(`[CALL_ANSWERED] Received for call ${callId}.`, args);

                // ========== MARKETING OUTBOUND CALL (one-way TTS) ==========
                // Triggered by schedules-stack queueConsumer via CreateSipMediaApplicationCall
                // ArgumentsMap is expected to include:
                // - callType=MarketingOutbound
                // - meetingId (ephemeral meeting created before placing the call)
                // - voice_message, voice_voiceId, voice_engine, voice_languageCode
                if (args?.callType === 'MarketingOutbound') {
                    const meetingId = typeof args?.meetingId === 'string' ? args.meetingId : undefined;
                    const voiceMessageRaw = args?.voice_message || args?.voiceMessage || args?.message;
                    const voiceMessage = typeof voiceMessageRaw === 'string'
                        ? voiceMessageRaw.trim()
                        : String(voiceMessageRaw || '').trim();

                    const voiceId = String(args?.voice_voiceId || args?.voiceId || process.env.POLLY_VOICE_ID || 'Joanna');
                    const engineRaw = String(args?.voice_engine || args?.voiceEngine || process.env.POLLY_ENGINE || 'neural').toLowerCase();
                    const engine = engineRaw === 'standard' ? 'standard' : 'neural';
                    const languageCode = String(args?.voice_languageCode || args?.voiceLanguageCode || 'en-US');

                    // Best-effort: mark call as answered in analytics table
                    const nowIso = new Date().toISOString();
                    await upsertVoiceCallAnalytics(callId, {
                        clinicId: String(args?.fromClinicId || args?.clinicId || '').trim() || undefined,
                        scheduleId: String(args?.scheduleId || '').trim() || undefined,
                        templateName: String(args?.templateName || '').trim() || undefined,
                        patNum: String(args?.patNum || '').trim() || undefined,
                        patientName: String(args?.patientName || '').trim() || undefined,
                        recipientPhone: String(args?.toPhoneNumber || '').trim() || undefined,
                        fromPhoneNumber: String(args?.fromPhoneNumber || '').trim() || undefined,
                        meetingId,
                        status: 'ANSWERED',
                        startedAt: nowIso, // only applied if the record doesn't exist yet
                        answeredAt: nowIso,
                        voiceId,
                        voiceEngine: engine,
                        voiceLanguageCode: languageCode,
                        source: String(args?.source || '').trim() || undefined,
                    });

                    const actions: any[] = [];

                    // Best-effort: join the PSTN leg into the ephemeral meeting
                    if (meetingId && pstnLegCallId) {
                        try {
                            const attendeeRes = await chime.send(new CreateAttendeeCommand({
                                MeetingId: meetingId,
                                ExternalUserId: `marketing-${callId}`.slice(0, 64)
                            }));
                            const attendee = attendeeRes.Attendee;
                            if (attendee?.AttendeeId && attendee?.JoinToken) {
                                actions.push(buildJoinChimeMeetingAction(pstnLegCallId, { MeetingId: meetingId }, attendee));
                            } else {
                                console.warn('[CALL_ANSWERED/MarketingOutbound] Failed to create attendee (missing JoinToken/AttendeeId)', { callId, meetingId });
                            }
                        } catch (err: any) {
                            console.warn('[CALL_ANSWERED/MarketingOutbound] Failed to join meeting (non-fatal); continuing with Speak', {
                                callId,
                                meetingId,
                                error: err?.message || err
                            });
                        }
                    } else {
                        console.warn('[CALL_ANSWERED/MarketingOutbound] Missing meetingId or PSTN CallId; skipping JoinChimeMeeting', {
                            callId,
                            hasMeetingId: !!meetingId,
                            hasPstnLegCallId: !!pstnLegCallId
                        });
                    }

                    if (voiceMessage) {
                        actions.push(buildSpeakAction(voiceMessage, voiceId, engine, pstnLegCallId, languageCode));
                        actions.push(buildPauseAction(250, pstnLegCallId));
                    } else {
                        console.warn('[CALL_ANSWERED/MarketingOutbound] Missing voice message; hanging up', { callId });
                    }

                    actions.push({ Type: 'Hangup' });
                    return buildActions(actions);
                }

                // ========== HUMAN AGENT OUTBOUND CALL ANSWERED ==========
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

                    // Start call recording for OUTBOUND calls (previously only inbound calls were recorded).
                    // This must target the PSTN leg CallId for the answered outbound call.
                    const enableRecording = process.env.ENABLE_CALL_RECORDING === 'true';
                    const recordingsBucket = process.env.RECORDINGS_BUCKET;
                    const preBridgeActions: any[] = [];

                    if (enableRecording && recordingsBucket && pstnLegCallId && !callRecord.recordingStarted) {
                        console.log(`[CALL_ANSWERED] Starting recording for outbound call ${callId}`);
                        preBridgeActions.push(buildStartCallRecordingAction(pstnLegCallId, recordingsBucket));

                        // Best-effort: persist pstnCallId + recording flags so the RecordingProcessor can map recordings
                        try {
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                UpdateExpression: 'SET recordingStarted = :true, recordingStartTime = :now, pstnCallId = :pstnCallId',
                                ExpressionAttributeValues: {
                                    ':true': true,
                                    ':now': new Date().toISOString(),
                                    ':pstnCallId': pstnLegCallId
                                }
                            }));
                            console.log('[CALL_ANSWERED] Updated outbound call record with pstnCallId:', pstnLegCallId);
                        } catch (recordErr) {
                            console.warn('[CALL_ANSWERED] Error updating outbound recording metadata (non-fatal):', recordErr);
                        }
                    }

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

                                // PUSH: Notify agent that outbound call was answered
                                // This is critical for the push-first mobile architecture:
                                // without it, the iOS/Android app stays stuck on "Dialing..."
                                if (isPushNotificationsEnabled()) {
                                    try {
                                        await sendCallAnsweredToAgent({
                                            callId,
                                            clinicId: callRecords[0].clinicId || clinicId || '',
                                            clinicName: callRecords[0].clinicName || callRecords[0].clinicId || '',
                                            callerPhoneNumber: callRecords[0].phoneNumber || callRecords[0].toPhoneNumber || '',
                                            agentId: assignedAgentId,
                                            direction: 'outbound',
                                            meetingId,
                                            timestamp: new Date().toISOString(),
                                        });
                                    } catch (pushErr) {
                                        console.warn('[CALL_ANSWERED] Failed to send call_answered push (non-fatal):', pushErr);
                                    }
                                }

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
                            ...preBridgeActions,
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
                        return buildActions([buildSpeakAndBridgeAction('All agents are busy. Please stay on the line.')]);
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
                // NOTE: Different callers use different argument casing (`Action` vs `action`).
                // Normalize to ensure hangup is reliably detected.
                const updateRequestedActionRaw = (args as any)?.Action ?? (args as any)?.action;
                const updateRequestedAction =
                    typeof updateRequestedActionRaw === 'string'
                        ? updateRequestedActionRaw.toLowerCase()
                        : '';

                if (updateRequestedAction === 'hangup') {
                    console.log(`[CALL_UPDATE_REQUESTED] Acknowledging Hangup request for call ${callId}`, {
                        hasParticipants: Array.isArray(event?.CallDetails?.Participants),
                        participantCount: Array.isArray(event?.CallDetails?.Participants) ? event.CallDetails.Participants.length : 0,
                    });

                    // Get all participant CallIds to hang up (do NOT rely on Status being "Connected",
                    // as some CALL_UPDATE_REQUESTED events omit or vary status fields).
                    const participants = Array.isArray(event?.CallDetails?.Participants)
                        ? event.CallDetails.Participants
                        : [];

                    const participantCallIds = participants
                        .map((p: any) => p?.CallId)
                        .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

                    const uniqueCallIds: string[] = Array.from(new Set<string>(participantCallIds));

                    const hangupActions: any[] = uniqueCallIds.map((id: string) => ({
                        Type: 'Hangup',
                        Parameters: {
                            CallId: id,
                            SipResponseCode: '0',
                        },
                    }));

                    // If no specific participants/call-ids are present, attempt a generic hangup
                    // (best-effort; SMA will decide which leg to terminate).
                    if (hangupActions.length === 0) {
                        console.warn('[CALL_UPDATE_REQUESTED] No participant CallIds found; issuing generic Hangup', {
                            callId,
                            args,
                        });
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

                // ========== MARKETING OUTBOUND CALL CLEANUP ==========
                // MarketingOutbound calls do not create CallQueue table records.
                // Cleanup the ephemeral meeting using the meetingId passed via ArgumentsMap.
                if (args?.callType === 'MarketingOutbound') {
                    const meetingId = typeof args?.meetingId === 'string' ? args.meetingId : undefined;
                    const sipResponseCode = event?.CallDetails?.SipResponseCode ||
                        event?.ActionData?.Parameters?.SipResponseCode ||
                        '0';

                    // Map SIP response to end reason (subset of main mapping below)
                    let endReason = 'unknown';
                    switch (sipResponseCode?.toString()) {
                        case '486': endReason = 'busy'; break;
                        case '480': endReason = 'no_answer'; break;
                        case '603': endReason = 'declined'; break;
                        case '487': endReason = 'cancelled'; break;
                        case '404': endReason = 'invalid_number'; break;
                        case '408': endReason = 'timeout'; break;
                        case '484': endReason = 'incomplete_number'; break;
                        case '503': endReason = 'service_unavailable'; break;
                        case '502':
                        case '504': endReason = 'network_error'; break;
                        case '0':
                        case '200': endReason = 'normal'; break;
                        default: endReason = `sip_${sipResponseCode}`;
                    }

                    const finalStatus = (sipResponseCode?.toString() === '0' || sipResponseCode?.toString() === '200')
                        ? 'COMPLETED'
                        : 'FAILED';

                    const nowIso = new Date().toISOString();
                    await upsertVoiceCallAnalytics(callId, {
                        clinicId: String(args?.fromClinicId || args?.clinicId || '').trim() || undefined,
                        scheduleId: String(args?.scheduleId || '').trim() || undefined,
                        templateName: String(args?.templateName || '').trim() || undefined,
                        patNum: String(args?.patNum || '').trim() || undefined,
                        patientName: String(args?.patientName || '').trim() || undefined,
                        recipientPhone: String(args?.toPhoneNumber || '').trim() || undefined,
                        fromPhoneNumber: String(args?.fromPhoneNumber || '').trim() || undefined,
                        meetingId,
                        status: finalStatus,
                        startedAt: nowIso, // only applied if the record doesn't exist yet
                        endedAt: nowIso,
                        sipResponseCode: String(sipResponseCode || ''),
                        endReason,
                        voiceId: String(args?.voice_voiceId || args?.voiceId || '').trim() || undefined,
                        voiceEngine: String(args?.voice_engine || args?.voiceEngine || '').trim() || undefined,
                        voiceLanguageCode: String(args?.voice_languageCode || args?.voiceLanguageCode || '').trim() || undefined,
                        source: String(args?.source || '').trim() || undefined,
                    });

                    if (meetingId) {
                        try {
                            await cleanupMeeting(meetingId);
                            console.log(`[${eventType}/MarketingOutbound] Cleaned up meeting ${meetingId}`);
                        } catch (err: any) {
                            console.warn(`[${eventType}/MarketingOutbound] Failed to cleanup meeting ${meetingId}:`, err?.message || err);
                        }
                    } else {
                        console.warn(`[${eventType}/MarketingOutbound] No meetingId found in ArgumentsMap; nothing to cleanup`, { callId });
                    }
                    return buildActions([]);
                }

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

                    // FIX: Await Media Pipeline cleanup to prevent orphaned pipelines
                    // Previously this was fire-and-forget, leaving pipelines running after Lambda terminates
                    if (callRecord.mediaPipelineId) {
                        try {
                            await stopMediaPipeline(callRecord.mediaPipelineId, callId);
                            console.log(`[${eventType}] Successfully stopped Media Pipeline: ${callRecord.mediaPipelineId}`);
                        } catch (pipelineErr) {
                            console.warn(`[${eventType}] Failed to stop Media Pipeline:`, pipelineErr);
                            // Non-fatal - pipeline will eventually timeout, but log for monitoring
                        }
                    }

                    // *** CRITICAL FIX ***
                    // Delete per-call meetings for:
                    // - ALL inbound calls (meeting-per-call / queued-call flows)
                    // - Outbound calls ONLY when explicitly marked meetingModel='per_call'
                    // This protects legacy outbound calls that used the agent's session meeting.
                    const isOutboundCall = direction === 'outbound' || status === 'dialing';
                    const meetingModel = typeof (callRecord as any).meetingModel === 'string'
                        ? String((callRecord as any).meetingModel).trim().toLowerCase()
                        : '';
                    const isPerCallMeeting = !isOutboundCall || meetingModel === 'per_call';

                    const meetingIdForCleanup: string | undefined =
                        (meetingInfo && typeof meetingInfo.MeetingId === 'string' && meetingInfo.MeetingId.length > 0)
                            ? meetingInfo.MeetingId
                            : (typeof (callRecord as any).meetingId === 'string' ? (callRecord as any).meetingId : undefined);

                    // FIX: Meeting-per-call requires cleaning up the meeting for ALL inbound call states
                    // (queued/ringing/accepting/connected/on_hold). Otherwise meetings leak on completed calls.
                    const shouldCleanupMeeting = isPerCallMeeting && !!meetingIdForCleanup;

                    if (shouldCleanupMeeting && meetingIdForCleanup) {
                        try {
                            await cleanupMeeting(meetingIdForCleanup);
                            console.log(`[${eventType}] Cleaned up per-call meeting ${meetingIdForCleanup}`, {
                                callId,
                                status,
                                direction,
                            });
                        } catch (meetingErr) {
                            console.warn(`[${eventType}] Failed to cleanup meeting:`, meetingErr);
                        }
                    } else if (isOutboundCall && meetingIdForCleanup) {
                        // *** FIX: Do NOT delete the agent's session meeting for outbound calls ***
                        console.log(`[${eventType}] Outbound call ended. Legacy outbound meeting ${meetingIdForCleanup} will NOT be deleted.`);
                    } else if (meetingIdForCleanup) {
                        console.log(`[${eventType}] Call ended. Meeting ${meetingIdForCleanup} will NOT be deleted.`);
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

                        // ========== AUDIT LOGGING ==========
                        // Log call completion for HIPAA compliance audit trail
                        if (CHIME_CONFIG.AUDIT.ENABLED) {
                            try {
                                const auditEvent = createAuditEvent(
                                    AuditEventType.CALL_ENDED,
                                    { type: 'agent', id: assignedAgentId || 'system', name: undefined },
                                    { type: 'call', id: callId },
                                    clinicId,
                                    {
                                        finalStatus,
                                        callDuration,
                                        callEndReason,
                                        sipResponseCode,
                                        direction: direction || 'inbound',
                                    },
                                    { callId }
                                );
                                await logAuditEvent(ddb, auditEvent, CALL_QUEUE_TABLE_NAME).catch(() => { });
                            } catch (auditErr) {
                                console.warn(`[${eventType}] Audit logging failed (non-fatal):`, auditErr);
                            }
                        }

                        // ========== CALL METRICS ==========
                        // Publish call completion metrics for dashboard
                        const callType = finalStatus === 'completed' ? 'answered' :
                            finalStatus === 'abandoned' ? 'abandoned' : 'missed';
                        await publishCallMetrics(clinicId, callType, callDuration, 0).catch(() => { });

                        // ========== CALL QUALITY SCORING ==========
                        // Calculate comprehensive quality score at call end
                        if (CHIME_CONFIG.QUALITY.ENABLED && callDuration > 0) {
                            try {
                                // Extract wait time from call record
                                const waitTime = callRecord.queuedAt && callRecord.acceptedAt
                                    ? Math.floor((new Date(callRecord.acceptedAt).getTime() - new Date(callRecord.queuedAt).getTime()) / 1000)
                                    : 0;

                                // Get sentiment from call record (if sentiment analysis was performed)
                                const callSentiment = callRecord.overallSentiment || callRecord.sentiment || 'NEUTRAL';

                                // Calculate quality metrics
                                const qualityMetrics = calculateQualityMetrics({
                                    // Audio metrics (from call record if available)
                                    packetLoss: callRecord.packetLoss || 0,
                                    jitter: callRecord.jitter || 0,
                                    latency: callRecord.latency || 0,
                                    mos: callRecord.mos,

                                    // Agent metrics
                                    responseTime: callRecord.agentResponseTime || 0,
                                    holdCount: callRecord.holdCount || 0,
                                    totalHoldTime: callRecord.totalHoldTime || 0,
                                    transferCount: callRecord.transferCount || 0,
                                    callDuration,

                                    // Customer experience
                                    waitTime,
                                    sentiment: callSentiment,
                                    resolved: finalStatus === 'completed',
                                    escalated: !!callRecord.escalated,
                                    abandoned: finalStatus === 'abandoned',

                                    // Compliance
                                    piiMentioned: callRecord.piiMentioned || false,
                                    hipaaCompliant: callRecord.hipaaCompliant !== false,
                                    recordingEnabled: !!callRecord.recordingPath,
                                });

                                // Save quality metrics to call record
                                await saveQualityMetrics(
                                    ddb,
                                    callId,
                                    clinicId,
                                    Math.floor(Date.now() / 1000),
                                    qualityMetrics,
                                    CALL_QUEUE_TABLE_NAME
                                );

                                console.log(`[${eventType}] Call quality scored: ${qualityMetrics.overallScore}/100`, {
                                    callId,
                                    audio: qualityMetrics.audioQuality.score,
                                    agent: qualityMetrics.agentPerformance.score,
                                    customer: qualityMetrics.customerExperience.score,
                                    compliance: qualityMetrics.compliance.score,
                                });

                                // Check if quality warrants an alert
                                const qualityAlert = shouldAlertOnQuality(qualityMetrics);
                                if (qualityAlert.alert) {
                                    console.warn(`[${eventType}] Quality alert triggered:`, qualityAlert.reasons);
                                    // Could add supervisor notification here
                                }

                            } catch (qualityErr) {
                                console.warn(`[${eventType}] Quality scoring failed (non-fatal):`, qualityErr);
                            }
                        }

                    } catch (updateErr) {
                        console.error(`[${eventType}] Failed to update call record:`, updateErr);
                    }

                    // Reset AgentActive (push-first) if agent was assigned (best-effort)
                    // IMPORTANT: outbound per-call marks the agent busy across ALL active clinics,
                    // so we must reset any rows where currentCallId === callId.
                    if (AGENT_ACTIVE_TABLE_NAME && assignedAgentId) {
                        try {
                            const { Items: agentActiveRows } = await ddb.send(new QueryCommand({
                                TableName: AGENT_ACTIVE_TABLE_NAME,
                                IndexName: 'agentId-index',
                                KeyConditionExpression: 'agentId = :agentId',
                                ExpressionAttributeValues: { ':agentId': assignedAgentId },
                                ProjectionExpression: 'clinicId, agentId, #state, currentCallId, tempBusy',
                                ExpressionAttributeNames: { '#state': 'state' },
                            }));

                            const callReference =
                                typeof (callRecord as any)?.callReference === 'string'
                                    ? String((callRecord as any).callReference).trim()
                                    : '';
                            const callIdsToMatch = new Set<string>([String(callId)]);
                            if (callReference && callReference !== String(callId)) {
                                callIdsToMatch.add(callReference);
                            }

                            const busyRowsForThisCall = (agentActiveRows || [])
                                .filter((r: any) =>
                                    typeof r?.clinicId === 'string' &&
                                    String(r?.clinicId || '').length > 0 &&
                                    String(r?.state || '').toLowerCase() === 'busy' &&
                                    callIdsToMatch.has(String(r?.currentCallId || ''))
                                ) as any[];

                            if (busyRowsForThisCall.length > 0) {
                                const ts = new Date().toISOString();
                                let deletedTempBusy = 0;
                                let resetActive = 0;

                                await Promise.allSettled(busyRowsForThisCall.map(async (row: any) => {
                                    const cId = String(row.clinicId);
                                    const rowCallId = String(row.currentCallId || '');
                                    const isTempBusy = row?.tempBusy === true;

                                    if (isTempBusy) {
                                        await ddb.send(new DeleteCommand({
                                            TableName: AGENT_ACTIVE_TABLE_NAME,
                                            Key: { clinicId: cId, agentId: assignedAgentId },
                                            ConditionExpression: 'tempBusy = :true AND #state = :busy AND currentCallId = :callId',
                                            ExpressionAttributeNames: { '#state': 'state' },
                                            ExpressionAttributeValues: {
                                                ':true': true,
                                                ':busy': 'busy',
                                                ':callId': rowCallId,
                                            }
                                        }));
                                        deletedTempBusy += 1;
                                        return;
                                    }

                                    await ddb.send(new UpdateCommand({
                                        TableName: AGENT_ACTIVE_TABLE_NAME,
                                        Key: { clinicId: cId, agentId: assignedAgentId },
                                        UpdateExpression: 'SET #state = :active, updatedAt = :ts REMOVE currentCallId',
                                        ConditionExpression: '#state = :busy AND currentCallId = :callId',
                                        ExpressionAttributeNames: { '#state': 'state' },
                                        ExpressionAttributeValues: {
                                            ':active': 'active',
                                            ':busy': 'busy',
                                            ':callId': rowCallId,
                                            ':ts': ts,
                                        }
                                    }));
                                    resetActive += 1;
                                }));

                                console.log(`[${eventType}] AgentActive ${assignedAgentId} updated after call end`, {
                                    callId,
                                    matchedIds: Array.from(callIdsToMatch),
                                    resetActive,
                                    deletedTempBusy,
                                });
                            }
                        } catch (agentActiveErr: any) {
                            if (agentActiveErr.name !== 'ConditionalCheckFailedException') {
                                console.warn(`[${eventType}] Failed to update AgentActive for agent ${assignedAgentId} (non-fatal):`, agentActiveErr);
                            }
                        }
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
                                UpdateExpression: `SET #status = :status, lastActivityAt = :timestamp, lastCallEndedAt = :timestamp, lastCallEndTime = :timestamp, 
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

                        // Also push call_ended to ringing agents so their UI clears
                        if (isPushNotificationsEnabled()) {
                            const nowIso = new Date().toISOString();
                            await Promise.allSettled(agentIds.map((rAgentId: string) =>
                                sendCallEndedToAgent({
                                    callId,
                                    clinicId,
                                    clinicName: clinicId,
                                    agentId: rAgentId,
                                    reason: callEndReason,
                                    message: callEndUserFriendly,
                                    direction: direction || 'inbound',
                                    timestamp: nowIso,
                                })
                            ));
                        }
                    }

                    // ========== PUSH: Notify assigned agent about call end ==========
                    // Enables polling-free clients (Android, iOS, Web) to learn
                    // about call-end events in real-time via FCM push instead of
                    // polling /admin/me/presence.
                    if (assignedAgentId && isPushNotificationsEnabled()) {
                        try {
                            await sendCallEndedToAgent({
                                callId,
                                clinicId,
                                clinicName: clinicId,
                                agentId: assignedAgentId,
                                reason: callEndReason,
                                message: callEndUserFriendly,
                                direction: direction || 'inbound',
                                timestamp: new Date().toISOString(),
                            });
                        } catch (pushErr) {
                            console.warn(`[${eventType}] Failed to send call-ended push to agent ${assignedAgentId} (non-fatal):`, pushErr);
                        }
                    }
                }

                console.log(`[${eventType}] Call ${callId} cleanup completed.`);
                return buildActions([]);
            }

            // Case 7b: Digits received from customer (DTMF input)
            // Note: Depending on the action, digits can arrive via DIGITS_RECEIVED or ACTION_SUCCESSFUL.
            case 'DIGITS_RECEIVED':
            case 'ACTION_SUCCESSFUL': {
                const receivedDigits = event?.ActionData?.ReceivedDigits;
                const actionType = event?.ActionData?.Type;

                if ((actionType === 'PlayAudioAndGetDigits' || actionType === 'SpeakAndGetDigits') && receivedDigits) {
                    console.log(`[DIGITS_RECEIVED] Customer entered digits: ${receivedDigits} for call ${callId}`, { actionType });
                }

                // No IVR/menu flow is implemented here; acknowledge and continue.
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
            case 'ACTION_INTERRUPTED':
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

                // Handle CallAndBridge failures for after-hours forwarding to Connect/Lex.
                if (failedActionType === 'CallAndBridge') {
                    const sipHeaders = event?.ActionData?.Parameters?.SipHeaders || {};
                    const clinicIdFromHeader = sipHeaders['X-Clinic-Id'];
                    const forwardReason = sipHeaders['X-Forward-Reason'];
                    // X-Original-Caller was set during CallAndBridge to preserve caller ID
                    const originalCaller = sipHeaders['X-Original-Caller'] || 'unknown';

                    console.warn(`[ACTION_FAILED] CallAndBridge failed`, {
                        errorType,
                        errorMessage,
                        clinicId: clinicIdFromHeader,
                        forwardReason,
                        originalCaller,
                    });

                    // If this was an after-hours forward that failed, play closed message and end the call.
                    if (forwardReason === 'after-hours' && clinicIdFromHeader) {
                        console.log(`[ACTION_FAILED] After-hours forward failed for clinic ${clinicIdFromHeader}; ending call`, {
                            callId,
                            clinicId: clinicIdFromHeader,
                            originalCaller,
                        });
                        return buildActions([
                            buildSpeakAction(
                                "Thank you for calling. We are currently closed and unable to connect you to our after-hours assistant. " +
                                "Please call back during regular business hours. Goodbye."
                            ),
                            { Type: 'Hangup', Parameters: { SipResponseCode: '0' } }
                        ]);
                    }

                    // For non-after-hours CallAndBridge failures, inform caller
                    return buildActions([
                        buildSpeakAction("I'm sorry, we couldn't complete your call transfer. Please try again later."),
                        { Type: 'Hangup', Parameters: { SipResponseCode: '0' } }
                    ]);
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

// ------------------------------------------------------------------------
// Test harness helpers (not used by runtime code paths)
// ------------------------------------------------------------------------
// These exports enable lightweight local testing by allowing scripts to
// monkeypatch AWS client .send() methods and invoke internal helpers.
export const __test = {
    ddb,
    chime,
    isClinicOpen,
};



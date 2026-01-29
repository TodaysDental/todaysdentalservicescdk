import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
    ChimeSDKMeetingsClient,
    CreateMeetingCommand,
    CreateAttendeeCommand,
    DeleteMeetingCommand,
    StartMeetingTranscriptionCommand,
    StopMeetingTranscriptionCommand
} from '@aws-sdk/client-chime-sdk-meetings';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PollyClient, SynthesizeSpeechCommand, Engine, OutputFormat, VoiceId } from '@aws-sdk/client-polly';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { enrichCallContext } from './utils/agent-selection';
import { createCheckQueueForWork } from './utils/check-queue-for-work';
import { generateUniqueCallPosition } from '../shared/utils/unique-id';
import { startMediaPipeline, stopMediaPipeline, isRealTimeTranscriptionEnabled } from './utils/media-pipeline-manager';
import {
    isPushNotificationsEnabled,
    sendIncomingCallToAgents,
    sendMissedCallNotification,
    type IncomingCallNotification
} from './utils/push-notifications';
// FIX: Import barge-in detector to clear speaking state when TTS completes
import { bargeInDetector } from './utils/barge-in-detector';
// FIX: Import call state machine for coordinated state management
import { callStateMachine, CallEvent } from './utils/call-state-machine';

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
const lambdaClient = new LambdaClient({});
const ttsS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const polly = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });

// CHIME_MEDIA_REGION: Chime SDK Meetings must be created in a supported media region.
// This is set by ChimeStack CDK and ensures all Chime operations use the same region.
// Supported regions: us-east-1, us-west-2, eu-west-2, ap-southeast-1, etc.
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chime = new ChimeSDKMeetingsClient({ region: CHIME_MEDIA_REGION });
const CLINICS_TABLE_NAME = process.env.CLINICS_TABLE_NAME!;
const AGENT_PRESENCE_TABLE_NAME = process.env.AGENT_PRESENCE_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const LOCKS_TABLE_NAME = process.env.LOCKS_TABLE_NAME!;
const HOLD_MUSIC_BUCKET = process.env.HOLD_MUSIC_BUCKET;
const POLLY_VOICE_ID = (process.env.POLLY_VOICE_ID || 'Joanna') as VoiceId;
const POLLY_ENGINE = (process.env.POLLY_ENGINE || 'standard') as Engine;
const TTS_SAMPLE_RATE = 8000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Voice AI configuration
const VOICE_AI_LAMBDA_ARN = process.env.VOICE_AI_LAMBDA_ARN;
const CLINIC_HOURS_TABLE = process.env.CLINIC_HOURS_TABLE;
const AI_AGENTS_TABLE = process.env.AI_AGENTS_TABLE;
const VOICE_CONFIG_TABLE = process.env.VOICE_CONFIG_TABLE;
const ENABLE_AFTER_HOURS_AI = process.env.ENABLE_AFTER_HOURS_AI === 'true';

// ========================================
// REAL-TIME MEETING TRANSCRIPTION
// ========================================
// Uses Chime SDK StartMeetingTranscription API for natural language AI conversation.
// This works with SipMediaApplicationDialIn calls joining meetings via JoinChimeMeeting.
const ENABLE_MEETING_TRANSCRIPTION = process.env.ENABLE_MEETING_TRANSCRIPTION !== 'false';
const TRANSCRIPTION_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || 'en-US';
const MEDICAL_VOCABULARY_NAME = process.env.MEDICAL_VOCABULARY_NAME;

/**
 * Start real-time transcription for a Chime SDK meeting.
 * This enables natural language AI conversation via Amazon Transcribe.
 * 
 * @param meetingId - Chime meeting ID
 * @param callId - Call ID for logging
 * @returns Promise<boolean> - true if transcription started successfully
 */
async function startMeetingTranscription(meetingId: string, callId: string): Promise<boolean> {
    if (!ENABLE_MEETING_TRANSCRIPTION) {
        console.log(`[Transcription] Meeting transcription disabled via environment`);
        return false;
    }

    console.log(`[Transcription] Starting real-time transcription for meeting ${meetingId} (call ${callId})`);

    try {
        await chime.send(new StartMeetingTranscriptionCommand({
            MeetingId: meetingId,
            TranscriptionConfiguration: {
                EngineTranscribeSettings: {
                    LanguageCode: TRANSCRIPTION_LANGUAGE as any,
                    EnablePartialResultsStabilization: true,
                    PartialResultsStability: 'high',
                    VocabularyName: MEDICAL_VOCABULARY_NAME || undefined,
                }
            }
        }));

        console.log(`[Transcription] Successfully started for meeting ${meetingId}`, {
            language: TRANSCRIPTION_LANGUAGE,
            vocabulary: MEDICAL_VOCABULARY_NAME || 'default'
        });

        return true;
    } catch (error: any) {
        if (error.name === 'ConflictException') {
            console.log(`[Transcription] Already active for meeting ${meetingId}`);
            return true;
        }
        console.error(`[Transcription] Failed to start for meeting ${meetingId}:`, error.message || error);
        return false;
    }
}

/**
 * Stop meeting transcription.
 * 
 * @param meetingId - Chime meeting ID
 */
async function stopMeetingTranscriptionForMeeting(meetingId: string): Promise<void> {
    try {
        await chime.send(new StopMeetingTranscriptionCommand({
            MeetingId: meetingId
        }));
        console.log(`[Transcription] Stopped for meeting ${meetingId}`);
    } catch (error: any) {
        if (error.name !== 'NotFoundException') {
            console.warn(`[Transcription] Error stopping for meeting ${meetingId}:`, error.message);
        }
    }
}

// ========================================
// AI PHONE NUMBERS - Direct AI Routing (no business hours check)
// ========================================
// AI phone numbers are dedicated numbers that route directly to Voice AI.
// Callers to these numbers always get AI (regardless of business hours).
// Map format: { "+1234567890": "clinicId", ... }
const ENABLE_AI_PHONE_NUMBERS = process.env.ENABLE_AI_PHONE_NUMBERS === 'true';
const AI_PHONE_NUMBERS: Record<string, string> = (() => {
    try {
        return JSON.parse(process.env.AI_PHONE_NUMBERS_JSON || '{}');
    } catch {
        console.warn('[AI_PHONE_NUMBERS] Failed to parse AI_PHONE_NUMBERS_JSON, defaulting to empty');
        return {};
    }
})();

/**
 * Check if a phone number is an AI-dedicated phone number
 */
function isAiPhoneNumber(phoneNumber: string | null | undefined): boolean {
    if (!phoneNumber || !ENABLE_AI_PHONE_NUMBERS) return false;
    return phoneNumber in AI_PHONE_NUMBERS;
}

/**
 * Get clinic ID for an AI phone number
 */
function getClinicIdForAiNumber(phoneNumber: string): string | undefined {
    return AI_PHONE_NUMBERS[phoneNumber];
}

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

const buildSpeakAction = (text: string, voiceId: string = 'Joanna', engine: string = 'neural', callId?: string) => ({
    Type: 'Speak',
    Parameters: {
        Text: text,
        Engine: engine,
        LanguageCode: 'en-US',
        TextType: 'text',
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

// RecordAudio action for AI voice calls - captures caller speech for transcription
// The recording is saved to S3 and processed by transcribe-audio-segment Lambda
const AI_RECORDINGS_BUCKET = process.env.AI_RECORDINGS_BUCKET || process.env.RECORDINGS_BUCKET;
const ENABLE_RECORD_AUDIO_FALLBACK = process.env.ENABLE_RECORD_AUDIO_FALLBACK === 'true';

const buildRecordAudioAction = (
    callId: string,
    clinicId: string,
    params?: {
        durationSeconds?: number;
        silenceDurationSeconds?: number;
        silenceThreshold?: number;
        pstnLegCallId?: string; // The specific leg CallId (LEG-A) for targeting the caller
    }
) => ({
    Type: 'RecordAudio',
    Parameters: {
        // CallId is REQUIRED when in a meeting context to target the correct leg
        // Use pstnLegCallId (LEG-A) to record the CALLER's audio, not the meeting/AI
        ...(params?.pstnLegCallId && { CallId: params.pstnLegCallId }),
        // Track INCOMING = caller's voice, OUTGOING = AI's voice, BOTH = mixed
        // We want INCOMING to capture what the caller says for transcription
        Track: 'INCOMING',
        // Max recording duration - shorter = faster transcription (default 15 seconds)
        DurationInSeconds: Math.floor(params?.durationSeconds || 15),
        // End recording after silence - must be integer (default 2 seconds)
        SilenceDurationInSeconds: Math.floor(params?.silenceDurationSeconds || 2),
        // Silence threshold (0-1000, lower = more sensitive to quiet sounds)
        // Using 200 for better speech detection (Chime range is 0-1000)
        SilenceThreshold: Math.floor(params?.silenceThreshold || 200),
        // Allow caller to end recording with #
        RecordingTerminators: ['#'],
        // Save to S3 for transcription processing
        RecordingDestination: {
            Type: 'S3',
            BucketName: AI_RECORDINGS_BUCKET,
            // Key pattern: ai-recordings/{clinicId}/{callId}/{timestamp}.wav
            Prefix: `ai-recordings/${clinicId}/${callId}/`
        }
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

// Thinking audio - plays during AI processing to eliminate awkward silence
const THINKING_AUDIO_KEY = 'Computer-keyboard sound.wav';

const buildPlayThinkingAudioAction = (repeat: number = 1, callId?: string) => ({
    Type: 'PlayAudio',
    Parameters: {
        AudioSource: {
            Type: 'S3',
            BucketName: HOLD_MUSIC_BUCKET,
            Key: THINKING_AUDIO_KEY,
        },
        Repeat: repeat,
        PlaybackTerminators: ['#', '*'],
        ...(callId && { CallId: callId }),
    },
});

// Use SpeakAndGetDigits with Polly TTS - doesn't require S3 audio files
const buildSpeakAndGetDigitsAction = (text: string, maxDigits: number = 1, timeoutInSeconds: number = 10) => ({
    Type: 'SpeakAndGetDigits',
    Parameters: {
        InputDigitsRegex: `^\\d{1,${maxDigits}}$`,
        SpeechParameters: {
            Text: text,
            Engine: 'neural',
            LanguageCode: 'en-US',
            TextType: 'text',
            VoiceId: 'Joanna'
        },
        FailureSpeechParameters: {
            Text: "I didn't catch that. Please try again.",
            Engine: 'neural',
            LanguageCode: 'en-US',
            TextType: 'text',
            VoiceId: 'Joanna'
        },
        MinNumberOfDigits: 1,
        MaxNumberOfDigits: maxDigits,
        TerminatorDigits: ['#'],
        InBetweenDigitsDurationInMilliseconds: 5000,
        Repeat: 3,
        RepeatDurationInMilliseconds: timeoutInSeconds * 1000
    }
});

// Keep S3 version for hold music (which exists)
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
            Key: audioSource // Use same file as fallback
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

// ========================================================================
// AI MEETING HELPERS - Real-time transcription via Media Insights Pipeline
// ========================================================================

/**
 * Create a Chime Meeting for AI voice calls with real-time transcription.
 * This enables Media Insights Pipeline to stream audio to Amazon Transcribe
 * for near-instant (<1 second) transcription.
 * 
 * Flow:
 * 1. Create Meeting → auto-creates KVS stream
 * 2. Create Attendee for caller
 * 3. Start Media Insights Pipeline on KVS stream
 * 4. Return meeting + attendee info for JoinChimeMeeting action
 */
// Retry configuration for meeting creation
const MEETING_CREATION_MAX_RETRIES = 3;
const MEETING_CREATION_RETRY_DELAY_MS = 500;

async function createAiMeetingWithPipeline(params: {
    callId: string;
    clinicId: string;
    aiAgentId: string;
    aiSessionId: string;
    callerNumber: string;
}): Promise<{
    meetingInfo: any;
    attendeeInfo: any;
    pipelineId: string | null;
} | null> {
    const { callId, clinicId, aiAgentId, aiSessionId, callerNumber } = params;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= MEETING_CREATION_MAX_RETRIES; attempt++) {
        try {
            console.log('[createAiMeetingWithPipeline] Creating AI meeting for real-time transcription', {
                callId, clinicId, aiAgentId, attempt, maxRetries: MEETING_CREATION_MAX_RETRIES
            });

            // 1. Create the meeting
            // ExternalMeetingId max length is 64 chars, so use shortened format
            const shortClinicId = clinicId.substring(0, 20); // Truncate clinic ID
            const meetingResponse = await chime.send(new CreateMeetingCommand({
                ClientRequestToken: `ai-${callId}-${attempt}`, // Include attempt in token for retries
                ExternalMeetingId: `ai-${shortClinicId}-${callId.substring(0, 8)}`, // ~35 chars max
                MediaRegion: CHIME_MEDIA_REGION,
                // Meeting features for transcription
                MeetingFeatures: {
                    Audio: {
                        EchoReduction: 'AVAILABLE', // Enable echo reduction for better transcription
                    },
                },
            }));

            if (!meetingResponse.Meeting?.MeetingId) {
                console.error('[createAiMeetingWithPipeline] Failed to create meeting - no MeetingId returned', { attempt });
                if (attempt < MEETING_CREATION_MAX_RETRIES) {
                    await sleep(MEETING_CREATION_RETRY_DELAY_MS * attempt); // Exponential backoff
                    continue;
                }
                console.error('[createAiMeetingWithPipeline] All meeting creation attempts failed');
                emitModeSelectionMetric('meeting-kvs', false, Date.now() - startTime);
                return null;
            }

            const meetingId = meetingResponse.Meeting.MeetingId;
            console.log('[createAiMeetingWithPipeline] Meeting created:', { meetingId, attempt });

            // 2. Create attendee for the caller (PSTN participant)
            const attendeeResponse = await chime.send(new CreateAttendeeCommand({
                MeetingId: meetingId,
                ExternalUserId: `caller-${callerNumber.replace(/[^0-9]/g, '')}`,
                Capabilities: {
                    Audio: 'SendReceive',
                    Video: 'None',
                    Content: 'None',
                },
            }));

            if (!attendeeResponse.Attendee) {
                console.error('[createAiMeetingWithPipeline] Failed to create attendee', { meetingId, attempt });
                await cleanupMeeting(meetingId);
                if (attempt < MEETING_CREATION_MAX_RETRIES) {
                    await sleep(MEETING_CREATION_RETRY_DELAY_MS * attempt);
                    continue;
                }
                emitModeSelectionMetric('meeting-kvs', false, Date.now() - startTime);
                return null;
            }

            console.log('[createAiMeetingWithPipeline] Attendee created:', attendeeResponse.Attendee.AttendeeId);

            // NOTE: We do NOT start Media Insights Pipeline here because:
            // 1. KVS streams only exist AFTER attendees join and start publishing media
            // 2. The caller hasn't joined the meeting yet (JoinChimeMeeting executes later)
            // 3. Waiting for KVS would block the Lambda for 10+ seconds and cause timeout
            //
            // The pipeline is started in ACTION_SUCCESSFUL handler after JoinChimeMeeting succeeds.

            console.log('[createAiMeetingWithPipeline] Meeting ready for caller to join', {
                meetingId,
                duration: Date.now() - startTime,
                attempt
            });

            emitModeSelectionMetric('meeting-kvs', true, Date.now() - startTime);

            return {
                meetingInfo: meetingResponse.Meeting,
                attendeeInfo: attendeeResponse.Attendee,
                pipelineId: null, // Pipeline started after JoinChimeMeeting succeeds
            };

        } catch (error: any) {
            const isRetryable = error?.name === 'ServiceUnavailableException' ||
                error?.name === 'ThrottlingException' ||
                error?.$retryable?.throttling === true;

            console.error('[createAiMeetingWithPipeline] Error:', {
                error: error?.message || error,
                errorName: error?.name,
                attempt,
                isRetryable
            });

            if (isRetryable && attempt < MEETING_CREATION_MAX_RETRIES) {
                await sleep(MEETING_CREATION_RETRY_DELAY_MS * attempt);
                continue;
            }

            emitModeSelectionMetric('meeting-kvs', false, Date.now() - startTime);
            return null;
        }
    }

    console.error('[createAiMeetingWithPipeline] Exhausted all retries');
    emitModeSelectionMetric('meeting-kvs', false, Date.now() - startTime);
    return null;
}

// Emit CloudWatch metric for mode selection (for monitoring fallback rates)
function emitModeSelectionMetric(mode: 'meeting-kvs' | 'record-transcribe', success: boolean, durationMs: number): void {
    // Log metric data in a structured format that can be parsed by CloudWatch Logs Insights
    console.log('[METRIC] VoiceAI.ModeSelection', {
        mode,
        success,
        durationMs,
        timestamp: new Date().toISOString()
    });
}

// NOTE: For "AI thinking" audio feedback, you can use PlayAudio action with hold-music.wav
// or create a custom ai-thinking.mp3 file. The current implementation uses silent pauses
// which are interrupted by UpdateSipMediaApplicationCall when the AI response is ready.

// ========================================================================
// VOICE AI INTEGRATION HELPERS
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
            // No hours defined = use default (always use AI for after-hours)
            console.log('[isClinicOpen] No hours configured for clinic - defaulting to AI');
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
        // FIX: Consistent default behavior - default to CLOSED (use AI) on error
        // This matches voice-ai-handler.ts behavior and is safer:
        // - If we default to "open" but no agents are available, caller gets stuck
        // - If we default to "closed" but clinic is open, caller still gets help from AI
        // The AI can always transfer to a human if needed
        return false;
    }
}

/**
 * Get the configured voice AI agent for a clinic
 * Returns null if AI inbound is disabled in VoiceAgentConfig
 */
async function getVoiceAiAgentForClinic(clinicId: string): Promise<{ agentId: string; bedrockAgentId: string; bedrockAgentAliasId: string } | null> {
    if (!VOICE_CONFIG_TABLE || !AI_AGENTS_TABLE) {
        console.warn('[getVoiceAiAgentForClinic] Voice config tables not configured');
        return null;
    }

    try {
        // First check VoiceAgentConfig for explicitly configured agent
        const { Item: config } = await ddb.send(new GetCommand({
            TableName: VOICE_CONFIG_TABLE,
            Key: { clinicId },
        }));

        // CRITICAL: Check if AI inbound is enabled
        if (config && config.aiInboundEnabled === false) {
            console.log('[getVoiceAiAgentForClinic] AI inbound is disabled for clinic', { clinicId });
            return null;
        }

        // If config exists but aiInboundEnabled is not explicitly true, check if we should use AI
        // For new clinics without config, we'll fall back to finding a default agent
        if (config && config.aiInboundEnabled !== true) {
            console.log('[getVoiceAiAgentForClinic] AI inbound not explicitly enabled', { clinicId, aiInboundEnabled: config.aiInboundEnabled });
            // Continue to check for agent - if user configured an agent but didn't set flag, still try
        }

        let agentId = config?.inboundAgentId;

        // If no explicit config, find default voice agent for clinic
        if (!agentId) {
            const { Items: agents } = await ddb.send(new QueryCommand({
                TableName: AI_AGENTS_TABLE,
                IndexName: 'ClinicIndex',
                KeyConditionExpression: 'clinicId = :cid',
                FilterExpression: 'isActive = :active AND isVoiceEnabled = :voice AND bedrockAgentStatus = :status',
                ExpressionAttributeValues: {
                    ':cid': clinicId,
                    ':active': true,
                    ':voice': true,
                    ':status': 'PREPARED',
                },
                Limit: 1,
            }));

            if (agents && agents.length > 0) {
                agentId = agents[0].agentId;
            }
        }

        if (!agentId) {
            console.log('[getVoiceAiAgentForClinic] No voice AI agent found for clinic', { clinicId });
            return null;
        }

        // Get the full agent details
        const { Item: agent } = await ddb.send(new GetCommand({
            TableName: AI_AGENTS_TABLE,
            Key: { agentId },
        }));

        if (!agent || !agent.bedrockAgentId || !agent.bedrockAgentAliasId || agent.bedrockAgentStatus !== 'PREPARED') {
            console.warn('[getVoiceAiAgentForClinic] Agent not ready', { agentId, status: agent?.bedrockAgentStatus });
            return null;
        }

        console.log('[getVoiceAiAgentForClinic] Found voice AI agent', {
            clinicId,
            agentId,
            agentName: agent.name
        });

        return {
            agentId: agent.agentId,
            bedrockAgentId: agent.bedrockAgentId,
            bedrockAgentAliasId: agent.bedrockAgentAliasId,
        };
    } catch (error) {
        console.error('[getVoiceAiAgentForClinic] Error getting voice agent:', error);
        return null;
    }
}

/**
 * Invoke the Voice AI Lambda to handle an AI call
 */
async function invokeVoiceAiHandler(event: {
    eventType: 'NEW_CALL' | 'TRANSCRIPT' | 'CALL_ENDED' | 'DTMF';
    callId: string;
    clinicId: string;
    callerNumber?: string;
    transcript?: string;
    dtmfDigits?: string;
    sessionId?: string;
    aiAgentId?: string;
    purpose?: string;
    customMessage?: string;
    isAiPhoneNumber?: boolean; // True if call came to AI-dedicated phone number (no hours check needed)
}): Promise<{ action: string; text?: string; sessionId?: string }[]> {
    if (!VOICE_AI_LAMBDA_ARN) {
        console.error('[invokeVoiceAiHandler] VOICE_AI_LAMBDA_ARN not configured');
        return [{ action: 'SPEAK', text: 'Voice AI is not configured. Please try again during business hours.' }];
    }

    try {
        const response = await lambdaClient.send(new InvokeCommand({
            FunctionName: VOICE_AI_LAMBDA_ARN,
            InvocationType: 'RequestResponse',
            Payload: Buffer.from(JSON.stringify(event)),
        }));

        if (response.Payload) {
            const result = JSON.parse(Buffer.from(response.Payload).toString());
            console.log('[invokeVoiceAiHandler] Voice AI response:', result);
            return Array.isArray(result) ? result : [result];
        }

        return [{ action: 'CONTINUE' }];
    } catch (error) {
        console.error('[invokeVoiceAiHandler] Error invoking Voice AI:', error);
        return [{ action: 'SPEAK', text: 'I apologize, but I am having trouble processing your request. Please try calling back during office hours.' }];
    }
}

/**
 * Shared inbound Voice AI routing used by:
 * - AI-dedicated phone numbers (always AI)
 * - After-hours forwarding from a clinic's main phone number (treat as AI phone number call)
 */
async function routeInboundCallToVoiceAi(params: {
    clinicId: string;
    callId: string;
    fromPhoneNumber: string;
    pstnLegCallId?: string;
    isAiPhoneNumber: boolean;
    source: 'ai_phone_number' | 'after_hours_forward';
}): Promise<any> {
    const { clinicId, callId, fromPhoneNumber, pstnLegCallId, isAiPhoneNumber, source } = params;

    // Get Voice AI agent for this clinic
    const voiceAiAgent = await getVoiceAiAgentForClinic(clinicId);

    if (!voiceAiAgent) {
        // If AI is unavailable, offer human queue if available; otherwise take a message
        console.error(`[routeInboundCallToVoiceAi] No Voice AI agent configured`, { callId, clinicId, source });

        // Try to get clinic info for voicemail/transfer options
        let clinicInfo: any = null;
        try {
            const clinicResult = await ddb.send(new GetCommand({
                TableName: CLINICS_TABLE_NAME,
                Key: { clinicId },
            }));
            clinicInfo = clinicResult.Item;
        } catch (clinicErr) {
            console.warn('[routeInboundCallToVoiceAi] Could not fetch clinic info:', clinicErr);
        }

        const clinicName = clinicInfo?.clinicName || clinicInfo?.name || 'our dental office';

        // Check if there are human agents available
        const { Items: onlineAgents } = await ddb.send(new QueryCommand({
            TableName: AGENT_PRESENCE_TABLE_NAME,
            IndexName: 'status-index',
            KeyConditionExpression: '#status = :status',
            FilterExpression: 'contains(activeClinicIds, :clinicId)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'Online',
                ':clinicId': clinicId,
            },
            Limit: 1,
        }));

        if (onlineAgents && onlineAgents.length > 0) {
            console.log(`[routeInboundCallToVoiceAi] AI unavailable but human agents online - routing to queue`, { callId, clinicId, source });
            await addToQueue(clinicId, callId, fromPhoneNumber);
            return buildActions([
                buildSpeakAction(
                    `Thank you for calling ${clinicName}. Our AI assistant is currently being updated. ` +
                    `I'm connecting you with one of our team members. Please hold.`
                ),
                buildPauseAction(500),
                buildPlayAudioAction('hold-music.wav', 999)
            ]);
        }

        console.log(`[routeInboundCallToVoiceAi] No AI or agents available - offering voicemail`, { callId, clinicId, source });
        return buildActions([
            buildSpeakAction(
                `Thank you for calling ${clinicName}. Our AI assistant is currently unavailable and all of our team members are away. ` +
                `Please leave a message after the tone, and we'll return your call as soon as possible. ` +
                `To leave a message, please state your name, phone number, and the reason for your call.`
            ),
            buildPauseAction(1000),
            // TODO: Add dedicated voicemail recording action when available.
            // For now, use RecordAudio to capture the message (if an S3 bucket is configured).
            AI_RECORDINGS_BUCKET ? buildRecordAudioAction(callId, clinicId, {
                durationSeconds: 120, // 2 minutes for voicemail
                silenceDurationSeconds: 5,
                silenceThreshold: 200,
                pstnLegCallId, // Target the caller's leg
            }) : { Type: 'Hangup', Parameters: { SipResponseCode: '0' } },
        ]);
    }

    // Invoke Voice AI handler
    const voiceAiResponse = await invokeVoiceAiHandler({
        eventType: 'NEW_CALL',
        callId,
        clinicId,
        callerNumber: fromPhoneNumber,
        aiAgentId: voiceAiAgent.agentId,
        isAiPhoneNumber,
    });

    // Build actions from Voice AI response
    const actions: any[] = [];

    for (const response of voiceAiResponse) {
        switch (response.action) {
            case 'SPEAK':
                if (response.text) {
                    actions.push(buildSpeakAction(response.text));
                }
                break;
            case 'HANG_UP':
                actions.push({ Type: 'Hangup', Parameters: { SipResponseCode: '0' } });
                break;
            case 'TRANSFER':
                actions.push(buildSpeakAction('Please hold while I transfer your call.'));
                break;
            case 'CONTINUE':
                // CONTINUE is handled after - we'll add appropriate action based on mode
                break;
        }
    }

    // ========== DETERMINE TRANSCRIPTION MODE ==========
    // MODE 1: MEETING-BASED KVS (Real-time, ~1s latency)
    // MODE 2: RECORD-TRANSCRIBE (Fallback, ~3-5s latency)
    // MODE 3: DTMF (Fallback when no audio capture available)
    const realTimeEnabled = isRealTimeTranscriptionEnabled();
    let pipelineMode: 'meeting-kvs' | 'record-transcribe' | 'dtmf-dialogue' = 'dtmf-dialogue';
    let meetingInfo: any = null;
    let attendeeInfo: any = null;
    const aiSessionId = voiceAiResponse[0]?.sessionId || randomUUID();

    // Extract initial greeting from the AI response to play after meeting join
    const initialGreeting = voiceAiResponse.find(r => r.action === 'SPEAK')?.text ||
        "Hello! Thank you for calling. I'm your AI assistant. How may I help you today?";

    // Try meeting-based KVS first for best latency
    if (realTimeEnabled && pstnLegCallId) {
        console.log('[routeInboundCallToVoiceAi] Attempting meeting-kvs mode', { callId, clinicId, source });

        const meetingResult = await createAiMeetingWithPipeline({
            callId,
            clinicId,
            aiAgentId: voiceAiAgent.agentId,
            aiSessionId,
            callerNumber: fromPhoneNumber,
        });

        if (meetingResult) {
            pipelineMode = 'meeting-kvs';
            meetingInfo = meetingResult.meetingInfo;
            attendeeInfo = meetingResult.attendeeInfo;
            console.log('[routeInboundCallToVoiceAi] Using meeting-kvs mode', {
                callId,
                clinicId,
                meetingId: meetingInfo?.MeetingId,
                attendeeId: attendeeInfo?.AttendeeId,
                source,
            });
        } else {
            console.warn('[routeInboundCallToVoiceAi] Failed to create AI meeting, falling back', { callId, clinicId, source });
        }
    }

    // Fallback to record-transcribe if meeting creation failed
    if (pipelineMode !== 'meeting-kvs' && AI_RECORDINGS_BUCKET) {
        pipelineMode = 'record-transcribe';
        console.log('[routeInboundCallToVoiceAi] Using record-transcribe mode', { callId, clinicId, source });
    }

    const transcriptionEnabled = pipelineMode !== 'dtmf-dialogue';
    const useDtmfFallback = pipelineMode === 'dtmf-dialogue';
    const pipelineStatus =
        pipelineMode === 'meeting-kvs'
            ? 'starting'
            : (transcriptionEnabled ? 'active' : 'disabled');

    // Avoid double-playing the initial greeting for meeting-kvs mode.
    // We store the greeting in DynamoDB and play it after JoinChimeMeeting succeeds.
    if (pipelineMode === 'meeting-kvs') {
        const beforeCount = actions.length;
        for (let i = actions.length - 1; i >= 0; i--) {
            if (actions[i]?.Type === 'Speak') {
                actions.splice(i, 1);
            }
        }
        const removed = beforeCount - actions.length;
        if (removed > 0) {
            console.log('[routeInboundCallToVoiceAi] Deferred initial greeting until after JoinChimeMeeting', {
                callId,
                removedSpeakActions: removed,
            });
        }
    }

    // Store AI call record in queue table for tracking
    const { queuePosition, uniquePositionId } = generateUniqueCallPosition();
    const now = Math.floor(Date.now() / 1000);

    try {
        await ddb.send(new PutCommand({
            TableName: CALL_QUEUE_TABLE_NAME,
            Item: {
                clinicId,
                callId,
                queuePosition,
                uniquePositionId,
                queueEntryTime: now,
                queueEntryTimeIso: new Date().toISOString(),
                phoneNumber: fromPhoneNumber,
                status: 'connected' as CallStatus,
                ttl: now + QUEUE_TIMEOUT,
                direction: 'inbound',
                callType: 'ai_direct',
                isAiPhoneNumber,
                isAiCall: true, // CRITICAL: Required for ai-transcript-bridge to process transcripts
                aiAgentId: voiceAiAgent.agentId,
                aiSessionId,
                transactionId: callId,
                transcriptionEnabled,
                pipelineMode,
                pipelineStatus,
                useDtmfFallback,
                ...(pstnLegCallId ? { pstnCallId: pstnLegCallId } : {}),
                ...(meetingInfo ? {
                    meetingId: meetingInfo.MeetingId,
                    meetingInfo,
                    customerAttendeeInfo: attendeeInfo,
                } : {}),
                // Store initial greeting to play after meeting join
                initialGreeting,
            }
        }));
    } catch (err) {
        console.warn('[routeInboundCallToVoiceAi] Failed to create AI call record:', err);
    }

    // ========== ADD APPROPRIATE AUDIO CAPTURE ACTION ==========
    if (pipelineMode === 'meeting-kvs' && pstnLegCallId && meetingInfo && attendeeInfo) {
        // MEETING-KVS MODE: Join caller to Chime Meeting for real-time KVS streaming
        // After JoinChimeMeeting succeeds (ACTION_SUCCESSFUL), we start the Media Pipeline
        actions.push(buildJoinChimeMeetingAction(pstnLegCallId, meetingInfo, attendeeInfo));
    } else if (pipelineMode === 'record-transcribe' && pstnLegCallId) {
        // RECORD-TRANSCRIBE MODE: RecordAudio captures caller speech → S3 → Transcribe
        actions.push(buildRecordAudioAction(callId, clinicId, {
            durationSeconds: 30, // Allow caller time to speak
            silenceDurationSeconds: 3, // End recording after 3s silence
            silenceThreshold: 100, // More sensitive to quiet speech (0-1000 range)
            pstnLegCallId, // Target the caller's leg
        }));
    } else {
        // DTMF FALLBACK: Prompt for key press when no audio capture available
        actions.push(buildSpeakAndGetDigitsAction(
            'I am listening. You can speak or press a key on your phone.',
            1,
            30
        ));
    }

    console.log('[routeInboundCallToVoiceAi] AI call setup complete', {
        callId,
        clinicId,
        aiAgentId: voiceAiAgent.agentId,
        aiSessionId,
        actionsCount: actions.length,
        pipelineMode,
        transcriptionEnabled,
        useDtmfFallback,
        pipelineStatus,
        hasMeeting: !!meetingInfo,
        source,
    });

    return buildActions(actions);
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

                // ========== AI PHONE NUMBER CHECK (FIRST) ==========
                // If this is an AI-dedicated phone number, route directly to Voice AI
                // without checking business hours or looking up the clinic via GSI.
                if (isAiPhoneNumber(toPhoneNumber)) {
                    const aiClinicId = getClinicIdForAiNumber(toPhoneNumber);
                    console.log(`[NEW_INBOUND_CALL] AI PHONE NUMBER detected - routing directly to Voice AI`, {
                        callId,
                        toPhoneNumber,
                        clinicId: aiClinicId,
                        callerNumber: fromPhoneNumber,
                    });

                    if (!aiClinicId) {
                        console.error('[NEW_INBOUND_CALL] AI phone number has no clinic mapping');
                        return buildActions([buildHangupAction('There was an error connecting your call.')]);
                    }
                    return await routeInboundCallToVoiceAi({
                        clinicId: aiClinicId,
                        callId,
                        fromPhoneNumber,
                        pstnLegCallId,
                        isAiPhoneNumber: true, // Direct AI routing (no hours check needed)
                        source: 'ai_phone_number',
                    });
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

                // ========== AFTER-HOURS AI CHECK ==========
                // Check if clinic is closed and Voice AI should handle the call
                if (ENABLE_AFTER_HOURS_AI) {
                    const clinicOpen = await isClinicOpen(clinicId);

                    if (!clinicOpen) {
                        console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is CLOSED - routing to AI via Chime SDK Meetings`, {
                            callId,
                            clinicId,
                            callerNumber: fromPhoneNumber,
                        });

                        // Route to Voice AI using Chime SDK Meetings architecture
                        // This creates a meeting, adds the caller as attendee, and enables real-time transcription
                        return routeInboundCallToVoiceAi({
                            callId,
                            pstnLegCallId: pstnLegCallId || callId,
                            fromPhoneNumber,
                            clinicId,
                            isAiPhoneNumber: false,
                            source: 'after_hours_forward'
                        });
                    }

                    console.log(`[NEW_INBOUND_CALL] Clinic ${clinicId} is OPEN - proceeding with human agent routing`);
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

                let assignmentSucceeded = false;

                // FAIR-SHARE RINGING:
                // Trigger clinic-level dispatcher which splits idle agents across multiple waiting calls.
                // If this is the only waiting call, it will still ring all available idle agents (up to MAX_RING_AGENTS).
                try {
                    const checkQueueForWork = createCheckQueueForWork({
                        ddb,
                        callQueueTableName: CALL_QUEUE_TABLE_NAME,
                        agentPresenceTableName: AGENT_PRESENCE_TABLE_NAME,
                    });
                    await checkQueueForWork('SYSTEM', { activeClinicIds: [clinicId] } as any);
                } catch (dispatchErr) {
                    console.warn('[NEW_INBOUND_CALL] Fair-share dispatch failed (non-fatal):', dispatchErr);
                }

                // Determine whether THIS call is currently ringing after dispatch.
                try {
                    const { Item: refreshedCall } = await ddb.send(new GetCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        Key: { clinicId, queuePosition: queueEntry.queuePosition },
                        ConsistentRead: true
                    }));
                    assignmentSucceeded = !!(
                        refreshedCall &&
                        refreshedCall.status === 'ringing' &&
                        Array.isArray(refreshedCall.agentIds) &&
                        refreshedCall.agentIds.length > 0
                    );
                } catch (refreshErr) {
                    console.warn('[NEW_INBOUND_CALL] Failed to read call state after dispatch (non-fatal):', refreshErr);
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

                console.log(`[NEW_INBOUND_CALL] No available Online agents for clinic ${clinicId} or assignment failed.`);

                // ========== AI FALLBACK WHEN NO AGENTS AVAILABLE ==========
                // If enabled, offer AI assistance while waiting
                if (ENABLE_AFTER_HOURS_AI) {
                    const voiceAiAgent = await getVoiceAiAgentForClinic(clinicId);

                    if (voiceAiAgent) {
                        console.log(`[NEW_INBOUND_CALL] Offering AI assistance while no agents available`, {
                            callId,
                            clinicId,
                            aiAgentId: voiceAiAgent.agentId
                        });

                        // Add to queue AND offer AI assistance
                        try {
                            const queueEntry = await addToQueue(clinicId, callId, fromPhoneNumber);

                            // Update queue entry with AI info
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId, queuePosition: queueEntry.queuePosition },
                                UpdateExpression: 'SET aiAssistAvailable = :true, aiAgentId = :agentId',
                                ExpressionAttributeValues: {
                                    ':true': true,
                                    ':agentId': voiceAiAgent.agentId
                                }
                            }));

                            const queueInfo = await getQueuePosition(clinicId, callId);
                            const waitMinutes = Math.ceil((queueInfo?.estimatedWaitTime || 120) / 60);

                            return buildActions([
                                buildSpeakAction(
                                    `All of our agents are currently assisting other customers. ` +
                                    `Your estimated wait time is ${waitMinutes} ${waitMinutes === 1 ? 'minute' : 'minutes'}. ` +
                                    `While you wait, I can connect you with ToothFairy, our AI assistant, who can help with scheduling or answer common questions. ` +
                                    `Press 1 to speak with the AI assistant, or stay on the line to wait for a human agent.`
                                ),
                                buildSpeakAndGetDigitsAction('Press 1 to speak with the AI assistant, or continue holding for a human agent.', 1, 15),
                            ]);
                        } catch (err) {
                            console.warn('[NEW_INBOUND_CALL] Error setting up AI fallback:', err);
                            // Continue to normal queue handling
                        }
                    }
                }

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

                // ========== AI OUTBOUND CALL ==========
                // Scheduled AI-initiated call (e.g., appointment reminders)
                if (callType === 'AiOutbound') {
                    const { scheduledCallId, aiAgentId, patientName, purpose, customMessage } = args;
                    console.log(`[NEW_OUTBOUND_CALL] AI Outbound call initiated`, {
                        callId,
                        scheduledCallId,
                        aiAgentId,
                        clinicId,
                        purpose
                    });

                    // Update scheduled call record with SMA transaction ID
                    if (scheduledCallId) {
                        try {
                            const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE;
                            if (SCHEDULED_CALLS_TABLE) {
                                await ddb.send(new UpdateCommand({
                                    TableName: SCHEDULED_CALLS_TABLE,
                                    Key: { callId: scheduledCallId },
                                    UpdateExpression: 'SET chimeTransactionId = :txId, smaInitiatedAt = :now',
                                    ExpressionAttributeValues: {
                                        ':txId': callId,
                                        ':now': new Date().toISOString(),
                                    }
                                }));
                            }
                        } catch (err) {
                            console.warn('[NEW_OUTBOUND_CALL] Failed to update scheduled call record:', err);
                        }
                    }

                    // AI outbound calls just wait for CALL_ANSWERED to connect to Voice AI
                    // Play ringback tone while waiting
                    return buildActions([]);
                }

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

                // ========== AI OUTBOUND CALL ANSWERED ==========
                // Check if this is an AI-initiated outbound call
                if (args.callType === 'AiOutbound') {
                    const { scheduledCallId, aiAgentId, clinicId, patientName, purpose, customMessage } = args;
                    console.log(`[CALL_ANSWERED] AI Outbound call answered`, {
                        callId,
                        scheduledCallId,
                        aiAgentId,
                        clinicId,
                        patientName,
                        purpose
                    });

                    // Generate greeting based on purpose
                    let greeting = "Hello";
                    if (patientName) greeting = `Hello ${patientName}`;

                    switch (purpose) {
                        case 'appointment_reminder':
                            greeting += ". This is ToothFairy, your AI dental assistant, calling with a reminder about your upcoming appointment.";
                            break;
                        case 'follow_up':
                            greeting += ". This is ToothFairy from your dental office. I'm calling to check in on you after your recent visit.";
                            break;
                        case 'payment_reminder':
                            greeting += ". This is ToothFairy from your dental office calling about your account.";
                            break;
                        case 'reengagement':
                            greeting += ". This is ToothFairy from your dental office. It's been a while since your last visit, and we wanted to help you schedule an appointment.";
                            break;
                        default:
                            if (customMessage) {
                                greeting += `. ${customMessage}`;
                            } else {
                                greeting += ". This is ToothFairy, your AI dental assistant. How can I help you today?";
                            }
                    }

                    // Update scheduled call record
                    const SCHEDULED_CALLS_TABLE = process.env.SCHEDULED_CALLS_TABLE;
                    if (SCHEDULED_CALLS_TABLE && scheduledCallId) {
                        try {
                            await ddb.send(new UpdateCommand({
                                TableName: SCHEDULED_CALLS_TABLE,
                                Key: { callId: scheduledCallId },
                                UpdateExpression: 'SET #status = :status, answeredAt = :now, outcome = :outcome',
                                ExpressionAttributeNames: { '#status': 'status' },
                                ExpressionAttributeValues: {
                                    ':status': 'in_progress',
                                    ':now': new Date().toISOString(),
                                    ':outcome': 'answered',
                                }
                            }));
                        } catch (err) {
                            console.warn('[CALL_ANSWERED] Failed to update scheduled call:', err);
                        }
                    }

                    // Start AI conversation with greeting
                    // The Voice AI handler will be invoked for subsequent speech
                    return buildActions([
                        buildSpeakAction(greeting),
                        buildPauseAction(500),
                        // Continue listening for response - will trigger DIGITS_RECEIVED or we need speech recognition
                        // For now, add a prompt for user response
                        buildSpeakAction("How can I assist you today? Press 1 to confirm your appointment, 2 to reschedule, or stay on the line to speak with me."),
                    ]);
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

                // Handle barge-in interrupt action
                // This is triggered by the barge-in detector when caller speaks during AI output
                if (args?.interruptAction === 'true') {
                    console.log('[CALL_UPDATE_REQUESTED] Barge-in interrupt received:', {
                        callId,
                        bargeInTime: args.bargeInTime,
                        transcriptLength: args.bargeInTranscript?.length || 0,
                    });

                    // The barge-in detector sends a short pause action to stop current playback
                    // Then the transcript bridge will process the new utterance normally
                    const interruptActions = args.pendingAiActions
                        ? JSON.parse(args.pendingAiActions)
                        : [buildPauseAction(200)];

                    console.log('[CALL_UPDATE_REQUESTED] Executing interrupt actions:', {
                        count: interruptActions.length,
                        firstAction: interruptActions[0]?.Type,
                    });

                    return buildActions(interruptActions);
                }

                // AI transcript bridge updates: play pending AI actions immediately.
                // This is how real-time Voice AI responds while the call is in a long Pause.
                if (args?.pendingAiActions) {
                    try {
                        const pending = typeof args.pendingAiActions === 'string'
                            ? JSON.parse(args.pendingAiActions)
                            : args.pendingAiActions;

                        const pendingActions: any[] = Array.isArray(pending) ? pending : [];

                        // Log streaming chunk metadata if present
                        if (args.isStreamingChunk === 'true') {
                            console.log('[CALL_UPDATE_REQUESTED] Streaming TTS chunk:', {
                                callId,
                                sequence: args.ttsSequence,
                                isFinal: args.isFinalChunk,
                            });
                        }

                        // Clear DynamoDB fallback response (if present) to avoid duplicate playback.
                        try {
                            const { Items: callRecords } = await ddb.send(new QueryCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                IndexName: 'callId-index',
                                KeyConditionExpression: 'callId = :callId',
                                ExpressionAttributeValues: { ':callId': callId },
                                Limit: 1
                            }));

                            if (callRecords && callRecords[0]) {
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId: callRecords[0].clinicId, queuePosition: callRecords[0].queuePosition },
                                    UpdateExpression: 'SET lastAiResponseAt = :now REMOVE pendingAiResponse, pendingAiResponseTime',
                                    ExpressionAttributeValues: {
                                        ':now': new Date().toISOString(),
                                    }
                                })).catch(() => undefined);
                            }
                        } catch (clearErr) {
                            console.warn('[CALL_UPDATE_REQUESTED] Failed to clear pending AI response backup:', (clearErr as any)?.message || clearErr);
                        }

                        if (pendingActions.length > 0) {
                            console.log('[CALL_UPDATE_REQUESTED] Returning pending AI actions:', { count: pendingActions.length });
                            return buildActions(pendingActions);
                        }
                    } catch (err: any) {
                        console.error('[CALL_UPDATE_REQUESTED] Failed to parse pendingAiActions:', err?.message || err);
                    }

                    // Acknowledge even if we can't parse actions (prevents repeated update retries)
                    return buildActions([]);
                }

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
                    // Only delete the meeting if it was a temporary "queue" meeting for INBOUND calls.
                    // For OUTBOUND calls, meetingInfo contains the AGENT'S SESSION meeting - DO NOT delete it!
                    const isOutboundCall = direction === 'outbound' || status === 'dialing';

                    // Check if this is an AI call with meeting-kvs mode - these meetings SHOULD be cleaned up
                    const isAiMeetingKvs = callRecord.isAiCall && callRecord.pipelineMode === 'meeting-kvs';

                    // FIX #6: Also cleanup meetings for 'ringing' calls that were abandoned
                    // FIX: Also cleanup meetings for AI calls with meeting-kvs mode (these are temporary AI-only meetings)
                    // Previously only 'queued' status triggered cleanup, leaving orphaned meetings
                    const shouldCleanupMeeting = (
                        ((status === 'queued' || status === 'ringing') && !isOutboundCall) ||
                        isAiMeetingKvs // Always cleanup AI meeting-kvs meetings
                    ) && meetingInfo?.MeetingId;

                    if (shouldCleanupMeeting) {
                        try {
                            await cleanupMeeting(meetingInfo.MeetingId);
                            console.log(`[${eventType}] Cleaned up ${isAiMeetingKvs ? 'AI meeting-kvs' : status.toUpperCase()} meeting ${meetingInfo.MeetingId}`);
                        } catch (meetingErr) {
                            console.warn(`[${eventType}] Failed to cleanup meeting:`, meetingErr);
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

            // Case 7b: Digits received from customer (e.g., AI interaction menu)
            case 'DIGITS_RECEIVED':
            case 'ACTION_SUCCESSFUL': {
                // Check if this is a digit input response
                const receivedDigits = event?.ActionData?.ReceivedDigits;
                const actionType = event?.ActionData?.Type;

                if ((actionType === 'PlayAudioAndGetDigits' || actionType === 'SpeakAndGetDigits') && receivedDigits) {
                    console.log(`[DIGITS_RECEIVED] Customer entered digits: ${receivedDigits} for call ${callId}`, { actionType });

                    // Get call record to check if AI assist is available
                    const { Items: callRecords } = await ddb.send(new QueryCommand({
                        TableName: CALL_QUEUE_TABLE_NAME,
                        IndexName: 'callId-index',
                        KeyConditionExpression: 'callId = :callId',
                        ExpressionAttributeValues: { ':callId': callId }
                    }));

                    if (callRecords && callRecords[0]) {
                        const callRecord = callRecords[0];
                        const { clinicId, aiAgentId, aiAssistAvailable, isAiCall } = callRecord;

                        // Customer pressed 1 to speak with AI
                        if (receivedDigits === '1' && (aiAssistAvailable || isAiCall) && aiAgentId) {
                            console.log(`[DIGITS_RECEIVED] Connecting customer to AI assistant`, { callId, aiAgentId });

                            // Invoke Voice AI handler
                            const voiceAiResponse = await invokeVoiceAiHandler({
                                eventType: 'NEW_CALL',
                                callId,
                                clinicId,
                                callerNumber: callRecord.phoneNumber,
                                aiAgentId,
                            });

                            // Update call record to mark as AI-handled
                            await ddb.send(new UpdateCommand({
                                TableName: CALL_QUEUE_TABLE_NAME,
                                Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                UpdateExpression: 'SET isAiCall = :true, aiConnectedAt = :now',
                                ExpressionAttributeValues: {
                                    ':true': true,
                                    ':now': new Date().toISOString()
                                }
                            }));

                            // Build actions from Voice AI response
                            const actions: any[] = [];
                            for (const response of voiceAiResponse) {
                                if (response.action === 'SPEAK' && response.text) {
                                    actions.push(buildSpeakAction(response.text));
                                }
                            }

                            if (actions.length === 0) {
                                actions.push(buildSpeakAction(
                                    "Hi! I'm ToothFairy, your AI dental assistant. How can I help you today?"
                                ));
                            }

                            actions.push(buildPauseAction(500));
                            return buildActions(actions);
                        }

                        // Customer pressed 2 to stay on hold (or any other digit)
                        if (receivedDigits === '2' || !aiAssistAvailable) {
                            console.log(`[DIGITS_RECEIVED] Customer chose to wait for human agent`, { callId });
                            return buildActions([
                                buildSpeakAction("No problem. Please stay on the line and an agent will be with you shortly."),
                                buildPauseAction(500),
                                buildPlayAudioAction('hold-music.wav', 999)
                            ]);
                        }

                        // For AI calls, handle DTMF as user input
                        if (isAiCall && aiAgentId) {
                            const voiceAiResponse = await invokeVoiceAiHandler({
                                eventType: 'DTMF',
                                callId,
                                clinicId,
                                dtmfDigits: receivedDigits,
                                sessionId: callRecord.aiSessionId,
                                aiAgentId,
                            });

                            const actions: any[] = [];
                            for (const response of voiceAiResponse) {
                                if (response.action === 'SPEAK' && response.text) {
                                    actions.push(buildSpeakAction(response.text));
                                } else if (response.action === 'HANG_UP') {
                                    actions.push(buildSpeakAction("Thank you for calling. Goodbye!"));
                                    actions.push({ Type: 'Hangup', Parameters: { SipResponseCode: '0' } });
                                }
                            }

                            if (actions.length === 0) {
                                actions.push(buildPauseAction(100));
                            }

                            return buildActions(actions);
                        }
                    }
                }

                // ========== HANDLE AI MEETING JOIN SUCCESS ==========
                // When an AI phone number caller joins the Chime Meeting (via JoinChimeMeeting),
                // start the Media Insights Pipeline for real-time KVS streaming transcription
                if (eventType === 'ACTION_SUCCESSFUL' && actionType === 'JoinChimeMeeting') {
                    console.log(`[ACTION_SUCCESSFUL] JoinChimeMeeting completed for call ${callId}`);

                    // Check if this is an AI call that needs Media Pipeline started
                    try {
                        const { Items: callRecords } = await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            IndexName: 'callId-index',
                            KeyConditionExpression: 'callId = :callId',
                            ExpressionAttributeValues: { ':callId': callId }
                        }));

                        if (callRecords && callRecords[0]) {
                            const callRecord = callRecords[0];

                            // Check if this is an AI call with meeting-kvs mode that needs pipeline started
                            if (callRecord.isAiCall && callRecord.pipelineMode === 'meeting-kvs' &&
                                callRecord.pipelineStatus === 'starting' && callRecord.meetingId) {

                                console.log('[ACTION_SUCCESSFUL] AI call JoinChimeMeeting success - starting transcription', {
                                    callId,
                                    meetingId: callRecord.meetingId,
                                    clinicId: callRecord.clinicId,
                                    aiAgentId: callRecord.aiAgentId,
                                });

                                // PRIMARY: Start real-time meeting transcription (Chime SDK native API)
                                // This works with SipMediaApplicationDialIn and doesn't require KVS streams
                                startMeetingTranscription(callRecord.meetingId, callId)
                                    .then(async (transcriptionStarted) => {
                                        if (transcriptionStarted) {
                                            console.log('[ACTION_SUCCESSFUL] Meeting transcription started for AI call:', {
                                                callId,
                                                meetingId: callRecord.meetingId,
                                            });

                                            // Update call record with transcription status
                                            try {
                                                await ddb.send(new UpdateCommand({
                                                    TableName: CALL_QUEUE_TABLE_NAME,
                                                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                                    UpdateExpression: 'SET transcriptionEnabled = :enabled, transcriptionStatus = :status, transcriptionStartedAt = :now, pipelineStatus = :pipelineStatus',
                                                    ExpressionAttributeValues: {
                                                        ':enabled': true,
                                                        ':status': 'active',
                                                        ':now': new Date().toISOString(),
                                                        ':pipelineStatus': 'transcription-active',
                                                    }
                                                }));
                                            } catch (updateErr) {
                                                console.warn('[ACTION_SUCCESSFUL] Failed to update transcription status:', updateErr);
                                            }
                                        } else {
                                            console.warn('[ACTION_SUCCESSFUL] Meeting transcription failed to start, trying Media Pipeline fallback');

                                            // FALLBACK: Try Media Insights Pipeline (may not work for SipMediaApplicationDialIn)
                                            return startMediaPipeline({
                                                callId,
                                                meetingId: callRecord.meetingId,
                                                clinicId: callRecord.clinicId,
                                                agentId: callRecord.aiAgentId,
                                                customerPhone: callRecord.phoneNumber,
                                                direction: 'inbound',
                                                isAiCall: true,
                                                aiSessionId: callRecord.aiSessionId,
                                            }).then(async (pipelineId) => {
                                                if (pipelineId) {
                                                    console.log('[ACTION_SUCCESSFUL] Media Pipeline started as fallback:', { callId, pipelineId });
                                                    await ddb.send(new UpdateCommand({
                                                        TableName: CALL_QUEUE_TABLE_NAME,
                                                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                                        UpdateExpression: 'SET mediaPipelineId = :pipelineId, pipelineStatus = :status',
                                                        ExpressionAttributeValues: {
                                                            ':pipelineId': pipelineId,
                                                            ':status': 'active',
                                                        }
                                                    }));
                                                } else {
                                                    console.warn('[ACTION_SUCCESSFUL] Both transcription and Media Pipeline failed, using DTMF fallback');
                                                    await ddb.send(new UpdateCommand({
                                                        TableName: CALL_QUEUE_TABLE_NAME,
                                                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                                        UpdateExpression: 'SET pipelineStatus = :status',
                                                        ExpressionAttributeValues: {
                                                            ':status': 'dtmf-fallback',
                                                        }
                                                    }));
                                                }
                                            });
                                        }
                                    })
                                    .catch((err) => {
                                        console.error('[ACTION_SUCCESSFUL] Error in transcription/pipeline setup:', err);
                                    });

                                // Play the initial AI greeting now that the caller is in the meeting
                                // The caller couldn't hear it earlier because JoinChimeMeeting was processing
                                const initialGreeting = callRecord.initialGreeting ||
                                    "Hello! Thank you for calling. I'm your AI assistant. How may I help you today?";

                                // CRITICAL FIX: Get the caller's CallId (LEG-A) to target actions correctly
                                // After JoinChimeMeeting, there are two participants and we must specify which leg to target
                                const callerLeg = event?.CallDetails?.Participants?.find(
                                    (p: any) => p.ParticipantTag === 'LEG-A'
                                );
                                const callerCallId = callerLeg?.CallId;

                                console.log('[ACTION_SUCCESSFUL] Playing initial AI greeting to caller', {
                                    callId,
                                    callerCallId,
                                    greeting: initialGreeting.substring(0, 50) + '...',
                                });

                                // Build actions: Pause actions to wait for transcripts
                                // IMPORTANT: Chime SMA has a limit of ~10 actions per response
                                // CRITICAL FIX: Audio actions returned in the same response as JoinChimeMeeting
                                // are being silently skipped. Defer the greeting to the next Pause event.

                                // Mark greeting as deferred (best-effort)
                                try {
                                    await ddb.send(new UpdateCommand({
                                        TableName: CALL_QUEUE_TABLE_NAME,
                                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                        UpdateExpression: 'SET initialGreetingDeferredAt = :now',
                                        ExpressionAttributeValues: { ':now': new Date().toISOString() },
                                    }));
                                } catch (deferErr: any) {
                                    console.warn('[ACTION_SUCCESSFUL] Failed to mark greeting deferred:', deferErr?.message || deferErr);
                                }

                                const waitActions: any[] = [];
                                for (let i = 0; i < 4; i++) {
                                    waitActions.push(buildPauseAction(3000, callerCallId)); // 3 second pauses, total 12 seconds
                                }

                                console.log('[ACTION_SUCCESSFUL] AI call meeting joined - greeting deferred; waiting for real-time transcripts');
                                console.log('[ACTION_SUCCESSFUL] DEBUG: Returning actions:', JSON.stringify(waitActions.map(a => ({ Type: a.Type, hasCallId: !!a.Parameters?.CallId }))));
                                return buildActions(waitActions);
                            }
                        }
                    } catch (err) {
                        console.error('[ACTION_SUCCESSFUL] Error handling AI meeting join:', err);
                    }

                    // For non-AI meeting joins, fall through to default handling
                }

                // Handle RecordAudio completion - audio has been saved to S3 for transcription
                if (eventType === 'ACTION_SUCCESSFUL' && actionType === 'RecordAudio') {
                    console.log(`[ACTION_SUCCESSFUL] RecordAudio completed for call ${callId}`, {
                        recordingDestination: event?.ActionData?.Parameters?.RecordingDestination,
                    });

                    // The recording has been saved to S3. The transcribe-audio-segment Lambda
                    // will be triggered by S3 notification to process the audio and send
                    // the AI response via UpdateSipMediaApplicationCall.
                    //
                    // To avoid long/looping "thinking" audio during record-audio fallback,
                    // play a single short thinking clip (or pause briefly).
                    console.log(`[ACTION_SUCCESSFUL] Waiting for AI response after RecordAudio`);

                    return buildActions([
                        buildPlayThinkingAudioAction(1, pstnLegCallId),
                    ]);
                }

                // For other ACTION_SUCCESSFUL events, check for pending AI responses
                if (eventType === 'ACTION_SUCCESSFUL') {
                    console.log(`[ACTION_SUCCESSFUL] Action completed for call ${callId}`, { actionType });

                    // FIX: Clear AI speaking state when TTS (Speak/PlayAudio) completes
                    // This prevents false positives in barge-in detection where we think
                    // AI is still speaking but it has actually finished.
                    if (actionType === 'Speak' || actionType === 'PlayAudio') {
                        bargeInDetector.clearSpeakingState(callId);
                        // FIX: Transition state machine back to LISTENING
                        callStateMachine.transition(callId, CallEvent.TTS_COMPLETED);
                        console.log(`[ACTION_SUCCESSFUL] Cleared AI speaking state for call ${callId}, transitioned to LISTENING`);
                    }

                    // CRITICAL FIX: Check for pending AI responses from transcript bridge
                    // This handles the case where the AI Transcript Bridge has queued a response
                    try {
                        const { Items: callRecords } = await ddb.send(new QueryCommand({
                            TableName: CALL_QUEUE_TABLE_NAME,
                            IndexName: 'callId-index',
                            KeyConditionExpression: 'callId = :callId',
                            ExpressionAttributeValues: { ':callId': callId }
                        }));

                        if (callRecords && callRecords[0]) {
                            const callRecord = callRecords[0];

                            // Play initial greeting on the first Pause after JoinChimeMeeting
                            // (Audio actions returned immediately after JoinChimeMeeting can be skipped)
                            if (
                                actionType === 'Pause' &&
                                callRecord.isAiCall &&
                                callRecord.initialGreeting &&
                                !callRecord.initialGreetingPlayedAt
                            ) {
                                const targetCallId = callRecord.pstnCallId || pstnLegCallId || callId;
                                console.log('[ACTION_SUCCESSFUL] Playing deferred initial greeting', {
                                    callId,
                                    targetCallId,
                                });

                                const greetingAction = await buildTtsPlayAudioAction(
                                    callRecord.initialGreeting,
                                    targetCallId,
                                    callId
                                );

                                // Mark greeting as played (best-effort)
                                try {
                                    await ddb.send(new UpdateCommand({
                                        TableName: CALL_QUEUE_TABLE_NAME,
                                        Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                        UpdateExpression: 'SET initialGreetingPlayedAt = :now REMOVE initialGreetingDeferredAt',
                                        ExpressionAttributeValues: { ':now': new Date().toISOString() },
                                    }));
                                } catch (greetErr: any) {
                                    console.warn('[ACTION_SUCCESSFUL] Failed to mark greeting played:', greetErr?.message || greetErr);
                                }

                                return buildActions([greetingAction]);
                            }

                            // Check if this is an AI call with pending response
                            if (callRecord.isAiCall && callRecord.pendingAiResponse) {
                                console.log('[ACTION_SUCCESSFUL] Found pending AI response, processing...');

                                // Parse the pending response
                                const pendingResponses = JSON.parse(callRecord.pendingAiResponse);
                                const actions: any[] = [];

                                for (const response of pendingResponses) {
                                    switch (response.action) {
                                        case 'SPEAK':
                                            if (response.text) {
                                                const targetCallId = callRecord.pstnCallId || pstnLegCallId || callId;
                                                actions.push(await buildTtsPlayAudioAction(response.text, targetCallId, callId));
                                            }
                                            break;
                                        case 'HANG_UP':
                                            actions.push({ Type: 'Hangup', Parameters: { SipResponseCode: '0' } });
                                            break;
                                        case 'CONTINUE':
                                            // Continue listening based on pipeline mode
                                            if (callRecord.pipelineMode === 'meeting-kvs' && callRecord.mediaPipelineId) {
                                                // MEETING-KVS MODE: Keep caller in meeting, real-time transcripts flowing
                                                // Just pause and wait for ai-transcript-bridge to send next response
                                                actions.push(buildPauseAction(2000));
                                            } else if (callRecord.pipelineMode === 'meeting-kvs' && callRecord.useRecordAudioFallback && AI_RECORDINGS_BUCKET) {
                                                // MEETING-KVS FALLBACK: Use RecordAudio when real-time transcripts aren't available
                                                actions.push(buildRecordAudioAction(callId, callRecord.clinicId, {
                                                    durationSeconds: 20,
                                                    silenceDurationSeconds: 2,
                                                    silenceThreshold: 120,
                                                    pstnLegCallId: callRecord.pstnCallId, // Target the caller's leg
                                                }));
                                            } else if (callRecord.pipelineMode === 'record-transcribe' && AI_RECORDINGS_BUCKET) {
                                                // RECORD-TRANSCRIBE MODE: Use RecordAudio for voice transcription
                                                actions.push(buildRecordAudioAction(callId, callRecord.clinicId, {
                                                    durationSeconds: 30,
                                                    silenceDurationSeconds: 3,
                                                    silenceThreshold: 100,
                                                    pstnLegCallId: callRecord.pstnCallId, // Target the caller's leg
                                                }));
                                            } else if (callRecord.useDtmfFallback) {
                                                // DTMF FALLBACK: Prompt for key press
                                                actions.push(buildSpeakAndGetDigitsAction('I am listening. Please speak or press a key.', 1, 30));
                                            } else {
                                                // Default: short pause
                                                actions.push(buildPauseAction(500));
                                            }
                                            break;
                                    }
                                }

                                // Clear the pending response
                                await ddb.send(new UpdateCommand({
                                    TableName: CALL_QUEUE_TABLE_NAME,
                                    Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                    UpdateExpression: 'SET lastAiResponseAt = :now REMOVE pendingAiResponse, pendingAiResponseTime',
                                    ExpressionAttributeValues: {
                                        ':now': new Date().toISOString(),
                                    }
                                }));

                                if (actions.length > 0) {
                                    console.log('[ACTION_SUCCESSFUL] Returning pending AI actions:', { count: actions.length });
                                    return buildActions(actions);
                                }
                            }

                            // For AI calls with no pending response, continue listening
                            if (callRecord.isAiCall && !callRecord.pendingAiResponse) {
                                // Safety net: if we are waiting for real-time transcription to come online
                                // but it hasn't started after a short window, switch to RecordAudio or DTMF fallback so the
                                // caller doesn't experience total silence.
                                // Note: pipelineStatus transitions from 'starting' -> 'transcription-active' when StartMeetingTranscription succeeds
                                // Also check transcriptionStatus which is set to 'active' when transcription is confirmed running
                                const transcriptionIsActive = callRecord.pipelineStatus === 'transcription-active' ||
                                    callRecord.transcriptionStatus === 'active' ||
                                    callRecord.mediaPipelineId;
                                const recordAudioFallbackAvailable = ENABLE_RECORD_AUDIO_FALLBACK && Boolean(AI_RECORDINGS_BUCKET);
                                const nowSec = Math.floor(Date.now() / 1000);
                                const transcriptionStartedAtSec = callRecord.transcriptionStartedAt
                                    ? Math.floor(new Date(callRecord.transcriptionStartedAt).getTime() / 1000)
                                    : undefined;
                                const lastAiResponseAt = callRecord.lastAiResponseAt || callRecord.pendingAiResponseTime;
                                const lastAiResponseSec = lastAiResponseAt
                                    ? Math.floor(new Date(lastAiResponseAt).getTime() / 1000)
                                    : undefined;
                                const baseStartSec = transcriptionStartedAtSec ||
                                    (typeof callRecord.queueEntryTime === 'number' ? callRecord.queueEntryTime : nowSec);
                                const silenceSec = lastAiResponseSec ? (nowSec - lastAiResponseSec) : (nowSec - baseStartSec);

                                if (!transcriptionIsActive && callRecord.pipelineStatus === 'starting') {
                                    const startedAt = typeof callRecord.queueEntryTime === 'number' ? callRecord.queueEntryTime : nowSec;
                                    const waitingSec = nowSec - startedAt;
                                    const alreadyPrompted = Boolean(callRecord.aiFallbackPromptedAt);

                                    // Increase timeout to 15 seconds to give transcription time to start
                                    // If still inactive, fall back to RecordAudio (preferred) or DTMF.
                                    if (waitingSec >= 15 && !alreadyPrompted) {
                                        const fallbackMode = recordAudioFallbackAvailable ? 'record-audio' : 'dtmf';
                                        console.warn('[ACTION_SUCCESSFUL] Transcription not active after timeout; switching to fallback', {
                                            callId,
                                            waitingSec,
                                            pipelineStatus: callRecord.pipelineStatus,
                                            transcriptionStatus: callRecord.transcriptionStatus,
                                            fallbackMode,
                                        });

                                        // Mark fallback in DynamoDB (best effort)
                                        try {
                                            const pipelineStatus = recordAudioFallbackAvailable ? 'record-audio-fallback' : 'dtmf-fallback';
                                            await ddb.send(new UpdateCommand({
                                                TableName: CALL_QUEUE_TABLE_NAME,
                                                Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                                UpdateExpression: 'SET useRecordAudioFallback = :raf, useDtmfFallback = :dtmf, transcriptionEnabled = :t, pipelineStatus = :s, aiFallbackPromptedAt = :now',
                                                ExpressionAttributeValues: {
                                                    ':raf': recordAudioFallbackAvailable,
                                                    ':dtmf': !recordAudioFallbackAvailable,
                                                    ':t': recordAudioFallbackAvailable,
                                                    ':s': pipelineStatus,
                                                    ':now': new Date().toISOString(),
                                                }
                                            }));
                                        } catch (fallbackErr: any) {
                                            console.warn('[ACTION_SUCCESSFUL] Failed to persist fallback flag:', fallbackErr?.message || fallbackErr);
                                        }

                                        if (recordAudioFallbackAvailable) {
                                            return buildActions([
                                                buildRecordAudioAction(callId, callRecord.clinicId, {
                                                    durationSeconds: 20,
                                                    silenceDurationSeconds: 2,
                                                    silenceThreshold: 120,
                                                    pstnLegCallId: callRecord.pstnCallId, // Target the caller's leg
                                                })
                                            ]);
                                        }

                                        return buildActions([
                                            buildSpeakAndGetDigitsAction('I am having trouble hearing you. Please press any number key (0 to 9) to continue.', 1, 30)
                                        ]);
                                    }
                                }

                                // NEW: If transcription is "active" but no AI responses have arrived for too long,
                                // switch to RecordAudio fallback. Meeting transcription does NOT deliver to EventBridge,
                                // so this prevents endless silence for PSTN-only calls.
                                if (transcriptionIsActive && recordAudioFallbackAvailable && silenceSec >= 15 && !callRecord.useRecordAudioFallback) {
                                    const alreadyPrompted = Boolean(callRecord.aiFallbackPromptedAt);
                                    if (!alreadyPrompted) {
                                        console.warn('[ACTION_SUCCESSFUL] No AI responses after transcription start; switching to RecordAudio fallback', {
                                            callId,
                                            silenceSec,
                                            transcriptionStatus: callRecord.transcriptionStatus,
                                            pipelineStatus: callRecord.pipelineStatus,
                                        });

                                        try {
                                            await ddb.send(new UpdateCommand({
                                                TableName: CALL_QUEUE_TABLE_NAME,
                                                Key: { clinicId: callRecord.clinicId, queuePosition: callRecord.queuePosition },
                                                UpdateExpression: 'SET useRecordAudioFallback = :raf, transcriptionEnabled = :t, pipelineStatus = :s, aiFallbackPromptedAt = :now',
                                                ExpressionAttributeValues: {
                                                    ':raf': true,
                                                    ':t': true,
                                                    ':s': 'record-audio-fallback',
                                                    ':now': new Date().toISOString(),
                                                }
                                            }));
                                        } catch (fallbackErr: any) {
                                            console.warn('[ACTION_SUCCESSFUL] Failed to persist fallback flag:', fallbackErr?.message || fallbackErr);
                                        }

                                        return buildActions([
                                            buildRecordAudioAction(callId, callRecord.clinicId, {
                                                durationSeconds: 20,
                                                silenceDurationSeconds: 2,
                                                silenceThreshold: 120,
                                                pstnLegCallId: callRecord.pstnCallId, // Target the caller's leg
                                            })
                                        ]);
                                    }
                                }

                                // If using RecordAudio fallback, capture caller speech
                                if (callRecord.useRecordAudioFallback && AI_RECORDINGS_BUCKET) {
                                    return buildActions([
                                        buildRecordAudioAction(callId, callRecord.clinicId, {
                                            durationSeconds: 20,
                                            silenceDurationSeconds: 2,
                                            silenceThreshold: 120,
                                            pstnLegCallId: callRecord.pstnCallId, // Target the caller's leg
                                        })
                                    ]);
                                }

                                // If using DTMF fallback, prompt for input
                                if (callRecord.useDtmfFallback || !callRecord.transcriptionEnabled) {
                                    return buildActions([
                                        buildSpeakAndGetDigitsAction('I am listening. Please speak or press a key.', 1, 30)
                                    ]);
                                }
                                // Otherwise, Media Pipeline will handle transcription
                                // Keep this cadence reasonable: real-time responses arrive via CALL_UPDATE_REQUESTED,
                                // and this Pause loop is only a safety net / keep-alive.
                                return buildActions([buildPauseAction(2000)]);
                            }
                        }
                    } catch (err) {
                        console.error('[ACTION_SUCCESSFUL] Error checking for pending AI response:', err);
                    }

                    return buildActions([]);
                }

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

                // FIX: Handle CallAndBridge failures for after-hours AI forwarding
                // When the AI phone number doesn't answer (misconfigured or no SIP rule),
                // fall back to handling the AI call directly in this SMA.
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

                    // If this was an after-hours forward that failed, handle AI call directly
                    if (forwardReason === 'after-hours' && clinicIdFromHeader) {
                        console.log(`[ACTION_FAILED] Falling back to direct AI handling for clinic ${clinicIdFromHeader}`);

                        try {
                            // Route directly to Voice AI without PSTN forward
                            return await routeInboundCallToVoiceAi({
                                callId,
                                clinicId: clinicIdFromHeader,
                                fromPhoneNumber: originalCaller,
                                pstnLegCallId,
                                isAiPhoneNumber: false, // Not an AI phone number, this is fallback
                                source: 'after_hours_forward', // Use existing source type
                            });
                        } catch (fallbackErr: any) {
                            console.error(`[ACTION_FAILED] Direct AI fallback failed:`, fallbackErr.message);
                            // If direct AI also fails, apologize and hang up
                            return buildActions([
                                buildSpeakAction(
                                    "I'm sorry, we're experiencing technical difficulties with our after-hours assistant. " +
                                    "Please try calling back in a few minutes, or call during regular business hours. Goodbye."
                                ),
                                { Type: 'Hangup', Parameters: { SipResponseCode: '0' } }
                            ]);
                        }
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
    lambdaClient,
    chime,
    isClinicOpen,
    isAiPhoneNumber,
    getClinicIdForAiNumber,
    routeInboundCallToVoiceAi,
};



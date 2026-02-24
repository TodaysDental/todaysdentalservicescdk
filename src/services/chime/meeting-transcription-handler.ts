/**
 * Meeting Transcription Event Handler
 * 
 * Processes real-time transcription events from Chime SDK Meetings.
 * 
 * This handler receives transcription events via EventBridge when:
 * - StartMeetingTranscription is called on a meeting
 * - Participants speak during the meeting
 * - Transcription state changes (started, stopped, failed)
 * 
 * Flow:
 * 1. PSTN caller joins meeting via JoinChimeMeeting
 * 2. StartMeetingTranscription is called
 * 3. Chime sends audio to Amazon Transcribe
 * 4. Transcription events are published to EventBridge
 * 5. This Lambda processes events and invokes AI agent
 * 6. AI response is converted to speech via Polly
 * 7. Response is played to the meeting (via UpdateSipMediaApplicationCall or meeting audio)
 * 
 * Event Types:
 * - TranscriptionStarted: Transcription has begun
 * - TranscriptionStopped: Transcription has ended
 * - TranscriptionInterrupted: Transcription was interrupted
 * - TranscriptionFailed: Transcription failed to start
 * - Transcript: Actual transcription text from a participant
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { PollyClient, SynthesizeSpeechCommand, Engine, OutputFormat, VoiceId } from '@aws-sdk/client-polly';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
// Use Kinesis Data Streams for analytics (optional - only if stream is configured)
// Note: @aws-sdk/client-kinesis needs to be added to package.json if using Kinesis
// import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const polly = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const chimeVoice = new ChimeSDKVoiceClient({ region: process.env.CHIME_MEDIA_REGION || 'us-east-1' });

// Environment variables
const ACTIVE_MEETINGS_TABLE = process.env.ACTIVE_MEETINGS_TABLE!;
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE!;
const VOICE_SESSIONS_TABLE = process.env.VOICE_SESSIONS_TABLE!;
const BEDROCK_AGENT_ID = process.env.BEDROCK_AGENT_ID!;
const BEDROCK_AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';
const TTS_BUCKET = process.env.TTS_BUCKET!;
const AI_TRANSCRIPT_STREAM = process.env.AI_TRANSCRIPT_STREAM;
const POLLY_VOICE_ID = (process.env.POLLY_VOICE_ID || 'Joanna') as VoiceId;

// Debounce settings for partial transcripts
const TRANSCRIPT_DEBOUNCE_MS = parseInt(process.env.TRANSCRIPT_DEBOUNCE_MS || '500', 10);
const pendingTranscripts: Map<string, { text: string; timestamp: number; timer?: NodeJS.Timeout }> = new Map();

// Track conversation state per meeting
interface ConversationState {
    meetingId: string;
    callId: string;
    clinicId: string;
    callerPhone: string;
    sessionId: string;
    lastProcessedText: string;
    lastResponseTime: number;
    isProcessing: boolean;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
}

const conversationStates: Map<string, ConversationState> = new Map();

/**
 * Main Lambda handler for transcription events
 */
export async function handler(event: any): Promise<void> {
    console.log('[TranscriptionHandler] Received event:', JSON.stringify(event, null, 2));

    // Handle EventBridge event structure
    const detail = event.detail || event;
    const eventType = event['detail-type'] || detail.eventType || 'unknown';

    try {
        switch (eventType) {
            case 'Chime Meeting State Change':
                await handleMeetingStateChange(detail);
                break;

            case 'Chime Meeting Transcription':
            case 'Transcript':
                await handleTranscript(detail);
                break;

            case 'TranscriptionStarted':
                await handleTranscriptionStarted(detail);
                break;

            case 'TranscriptionStopped':
                await handleTranscriptionStopped(detail);
                break;

            case 'TranscriptionFailed':
                await handleTranscriptionFailed(detail);
                break;

            default:
                console.log(`[TranscriptionHandler] Unhandled event type: ${eventType}`);
        }
    } catch (error) {
        console.error('[TranscriptionHandler] Error processing event:', error);
        // Don't throw - we don't want to retry transcription events
    }
}

/**
 * Handle meeting state change events
 */
async function handleMeetingStateChange(detail: any): Promise<void> {
    const meetingId = detail.meetingId || detail.MeetingId;
    const state = detail.state || detail.State;

    console.log(`[TranscriptionHandler] Meeting ${meetingId} state change: ${state}`);

    if (state === 'ENDED') {
        // Clean up conversation state
        conversationStates.delete(meetingId);
        pendingTranscripts.delete(meetingId);
    }
}

/**
 * Handle transcription started event
 */
async function handleTranscriptionStarted(detail: any): Promise<void> {
    const meetingId = detail.meetingId || detail.MeetingId;
    console.log(`[TranscriptionHandler] Transcription started for meeting ${meetingId}`);

    // Update meeting status
    try {
        await ddb.send(new UpdateCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { meetingId },
            UpdateExpression: 'SET transcriptionStatus = :status',
            ExpressionAttributeValues: {
                ':status': 'active'
            }
        }));
    } catch (error) {
        console.warn(`[TranscriptionHandler] Failed to update meeting status:`, error);
    }
}

/**
 * Handle transcription stopped event
 */
async function handleTranscriptionStopped(detail: any): Promise<void> {
    const meetingId = detail.meetingId || detail.MeetingId;
    console.log(`[TranscriptionHandler] Transcription stopped for meeting ${meetingId}`);

    // Clean up
    conversationStates.delete(meetingId);
    pendingTranscripts.delete(meetingId);
}

/**
 * Handle transcription failed event
 */
async function handleTranscriptionFailed(detail: any): Promise<void> {
    const meetingId = detail.meetingId || detail.MeetingId;
    const reason = detail.reason || detail.Reason || 'Unknown';

    console.error(`[TranscriptionHandler] Transcription failed for meeting ${meetingId}: ${reason}`);

    // Update meeting status
    try {
        await ddb.send(new UpdateCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { meetingId },
            UpdateExpression: 'SET transcriptionStatus = :status, transcriptionError = :error',
            ExpressionAttributeValues: {
                ':status': 'failed',
                ':error': reason
            }
        }));
    } catch (error) {
        console.warn(`[TranscriptionHandler] Failed to update meeting status:`, error);
    }
}

/**
 * Handle transcript event - the main transcription text
 */
async function handleTranscript(detail: any): Promise<void> {
    const meetingId = detail.meetingId || detail.MeetingId;
    const attendeeId = detail.attendeeId || detail.AttendeeId;
    const transcript = detail.transcript || detail.Transcript || detail.results;
    const isPartial = detail.isPartial || detail.IsPartial || false;

    // Extract text from transcript structure
    let text = '';
    if (typeof transcript === 'string') {
        text = transcript;
    } else if (transcript?.alternatives?.[0]?.transcript) {
        text = transcript.alternatives[0].transcript;
    } else if (transcript?.text) {
        text = transcript.text;
    } else if (Array.isArray(transcript)) {
        // Handle array of results
        text = transcript
            .filter((r: any) => !r.isPartial)
            .map((r: any) => r.alternatives?.[0]?.transcript || r.transcript || '')
            .join(' ');
    }

    if (!text || text.trim().length === 0) {
        return;
    }

    console.log(`[TranscriptionHandler] Received transcript for meeting ${meetingId}:`, {
        attendeeId,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        isPartial
    });

    // Skip partial results to avoid processing incomplete sentences
    if (isPartial) {
        // Update pending transcript for debouncing
        const existing = pendingTranscripts.get(meetingId);
        if (existing?.timer) {
            clearTimeout(existing.timer);
        }
        pendingTranscripts.set(meetingId, {
            text,
            timestamp: Date.now()
        });
        return;
    }

    // Get or create conversation state
    let state = conversationStates.get(meetingId);
    if (!state) {
        // Fetch meeting info from DynamoDB
        const meetingInfo = await getMeetingInfo(meetingId);
        if (!meetingInfo) {
            console.warn(`[TranscriptionHandler] No meeting info found for ${meetingId}`);
            return;
        }

        state = {
            meetingId,
            callId: meetingInfo.callId,
            clinicId: meetingInfo.clinicId,
            callerPhone: String(meetingInfo.callerPhone || meetingInfo.callerNumber || meetingInfo.fromNumber || '').trim(),
            sessionId: randomUUID(),
            lastProcessedText: '',
            lastResponseTime: 0,
            isProcessing: false,
            conversationHistory: []
        };
        conversationStates.set(meetingId, state);
    }

    // Avoid processing duplicate text
    if (text === state.lastProcessedText) {
        console.log(`[TranscriptionHandler] Skipping duplicate text`);
        return;
    }

    // Avoid processing while already processing
    if (state.isProcessing) {
        console.log(`[TranscriptionHandler] Already processing, queuing transcript`);
        // Could implement a queue here for better handling
        return;
    }

    state.isProcessing = true;
    state.lastProcessedText = text;

    try {
        // Add to conversation history
        state.conversationHistory.push({
            role: 'user',
            content: text,
            timestamp: Date.now()
        });

        // Store transcript for analytics
        await storeTranscriptForAnalytics(state.callId, meetingId, text, 'user');

        // Invoke Bedrock Agent
        const aiResponse = await invokeBedrockAgent(
            text,
            state.sessionId,
            state.clinicId,
            state.callId,
            state.callerPhone
        );

        if (aiResponse) {
            // Add AI response to history
            state.conversationHistory.push({
                role: 'assistant',
                content: aiResponse,
                timestamp: Date.now()
            });

            // Store AI response for analytics
            await storeTranscriptForAnalytics(state.callId, meetingId, aiResponse, 'assistant');

            // Convert AI response to speech and play to meeting
            await playAiResponseToMeeting(meetingId, state.callId, aiResponse);

            state.lastResponseTime = Date.now();
        }
    } catch (error) {
        console.error(`[TranscriptionHandler] Error processing transcript:`, error);
    } finally {
        state.isProcessing = false;
    }
}

/**
 * Get meeting info from DynamoDB
 */
async function getMeetingInfo(meetingId: string): Promise<any> {
    try {
        const result = await ddb.send(new GetCommand({
            TableName: ACTIVE_MEETINGS_TABLE,
            Key: { meetingId }
        }));
        return result.Item;
    } catch (error) {
        console.error(`[TranscriptionHandler] Error getting meeting info:`, error);
        return null;
    }
}

/**
 * Invoke Bedrock Agent with the transcript text
 */
async function invokeBedrockAgent(
    userText: string,
    sessionId: string,
    clinicId: string,
    callId: string,
    callerPhone?: string
): Promise<string | null> {
    console.log(`[TranscriptionHandler] Invoking Bedrock Agent for session ${sessionId}`);

    const phone = String(callerPhone || '').trim();

    try {
        const response = await bedrock.send(new InvokeAgentCommand({
            agentId: BEDROCK_AGENT_ID,
            agentAliasId: BEDROCK_AGENT_ALIAS_ID,
            sessionId,
            inputText: userText,
            sessionState: {
                sessionAttributes: {
                    clinicId,
                    callId,
                    source: 'meeting-transcription',
                    // Pass caller phone so the Bedrock agent can do automatic
                    // caller-ID-based patient lookup via searchPatientsByPhone
                    ...(phone ? { callerPhone: phone, callerNumber: phone, PatientPhone: phone } : {}),
                }
            }
        }));

        // Collect response chunks
        let responseText = '';
        if (response.completion) {
            for await (const chunk of response.completion) {
                if (chunk.chunk?.bytes) {
                    responseText += new TextDecoder().decode(chunk.chunk.bytes);
                }
            }
        }

        console.log(`[TranscriptionHandler] Bedrock response:`, {
            sessionId,
            responseLength: responseText.length,
            preview: responseText.substring(0, 100) + (responseText.length > 100 ? '...' : '')
        });

        return responseText.trim() || null;
    } catch (error) {
        console.error(`[TranscriptionHandler] Error invoking Bedrock Agent:`, error);
        return null;
    }
}

/**
 * Play AI response to the meeting via TTS
 * 
 * This uses UpdateSipMediaApplicationCall to play audio to the PSTN participant
 * who joined the meeting via JoinChimeMeeting.
 */
async function playAiResponseToMeeting(
    meetingId: string,
    callId: string,
    responseText: string
): Promise<void> {
    console.log(`[TranscriptionHandler] Playing AI response to meeting ${meetingId}`);

    try {
        // Synthesize speech using Polly
        const audioKey = `tts/${callId}/${Date.now()}.wav`;

        const pollyResponse = await polly.send(new SynthesizeSpeechCommand({
            Engine: 'neural' as Engine,
            OutputFormat: 'pcm' as OutputFormat,
            Text: responseText,
            VoiceId: POLLY_VOICE_ID,
            SampleRate: '8000' // 8kHz for telephony
        }));

        if (!pollyResponse.AudioStream) {
            throw new Error('No audio stream from Polly');
        }

        // Convert to WAV format
        const audioData = await streamToBuffer(pollyResponse.AudioStream);
        const wavData = pcmToWav(audioData, 8000, 16, 1);

        // Upload to S3
        await s3.send(new PutObjectCommand({
            Bucket: TTS_BUCKET,
            Key: audioKey,
            Body: wavData,
            ContentType: 'audio/wav'
        }));

        const audioUrl = `s3://${TTS_BUCKET}/${audioKey}`;
        console.log(`[TranscriptionHandler] Uploaded TTS audio: ${audioUrl}`);

        // Update the SIP Media Application call to play the audio
        // This works because the PSTN participant is connected via JoinChimeMeeting
        // and has an associated SMA call leg
        await chimeVoice.send(new UpdateSipMediaApplicationCallCommand({
            SipMediaApplicationId: process.env.SIP_MEDIA_APPLICATION_ID,
            TransactionId: callId,
            Arguments: {
                action: 'playAudio',
                audioUrl,
                meetingId
            }
        }));

        console.log(`[TranscriptionHandler] Sent PlayAudio command for call ${callId}`);
    } catch (error) {
        console.error(`[TranscriptionHandler] Error playing AI response:`, error);
    }
}

/**
 * Store transcript for analytics
 * TODO: Implement Kinesis integration if real-time streaming is needed
 */
async function storeTranscriptForAnalytics(
    callId: string,
    meetingId: string,
    text: string,
    speaker: 'user' | 'assistant'
): Promise<void> {
    // Log transcript for CloudWatch Logs Insights analytics
    console.log('[TRANSCRIPT]', JSON.stringify({
        callId,
        meetingId,
        speaker,
        text,
        timestamp: Date.now(),
        source: 'meeting-transcription'
    }));

    // Store in DynamoDB conversations table for persistence
    try {
        await ddb.send(new PutCommand({
            TableName: CONVERSATIONS_TABLE,
            Item: {
                callId,
                timestamp: Date.now(),
                meetingId,
                speaker,
                text,
                source: 'meeting-transcription'
            }
        }));
    } catch (error) {
        console.warn(`[TranscriptionHandler] Failed to store transcript in DynamoDB:`, error);
    }
}

/**
 * Convert stream to buffer
 */
async function streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/**
 * Convert raw PCM to WAV format
 */
function pcmToWav(
    pcmData: Buffer,
    sampleRate: number,
    bitsPerSample: number,
    numChannels: number
): Buffer {
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
}

/**
 * Export functions for testing
 */
export {
    handleTranscript,
    invokeBedrockAgent,
    playAiResponseToMeeting
};

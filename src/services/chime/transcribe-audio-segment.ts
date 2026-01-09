/**
 * Transcribe Audio Segment Lambda - STREAMING VERSION
 * 
 * Processes audio recordings from AI voice calls using Amazon Transcribe Streaming.
 * This provides near-real-time transcription (~500ms-1.5s) compared to batch (~3-5s).
 * 
 * Flow:
 * 1. SMA RecordAudio action saves caller speech to S3
 * 2. S3 event notification triggers this Lambda
 * 3. Lambda downloads audio and streams to Transcribe Streaming API
 * 4. Transcript is immediately sent to Voice AI handler
 * 5. AI response is delivered via UpdateSipMediaApplicationCall
 * 
 * Key Optimization: Uses Transcribe Streaming WebSocket for sub-second transcription
 */

import { S3Event, S3EventRecord } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { 
    TranscribeStreamingClient,
    StartStreamTranscriptionCommand,
    AudioStream,
    LanguageCode,
    MediaEncoding,
} from '@aws-sdk/client-transcribe-streaming';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { getSmaIdForClinicSSM } from './utils/sma-map-ssm';
import { Readable } from 'stream';

const s3Client = new S3Client({});
const transcribeStreamingClient = new TranscribeStreamingClient({ 
    region: process.env.AWS_REGION || 'us-east-1' 
});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});
const chimeClient = new ChimeSDKVoiceClient({ 
    region: process.env.CHIME_MEDIA_REGION || 'us-east-1' 
});

// Environment variables
const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME!;
const VOICE_AI_LAMBDA_ARN = process.env.VOICE_AI_LAMBDA_ARN;

// Audio configuration for SMA recordings
// SMA records in 8kHz mono PCM (WAV format with 16-bit samples)
const SAMPLE_RATE = 8000;
const CHUNK_SIZE = 4096; // Bytes per chunk (256ms of audio at 8kHz 16-bit mono)

/**
 * Extract call metadata from S3 object key
 * Expected format: ai-recordings/{clinicId}/{callId}/{timestamp}.wav
 */
function parseRecordingKey(key: string): {
    clinicId: string;
    callId: string;
    timestamp: string;
} | null {
    const match = key.match(/ai-recordings\/([^/]+)\/([^/]+)\/([^/]+)\.(wav|mp3|ogg)/i);
    if (!match) {
        console.warn('[TranscribeStreaming] Could not parse recording key:', key);
        return null;
    }
    
    return {
        clinicId: match[1],
        callId: match[2],
        timestamp: match[3],
    };
}

/**
 * Get call record from DynamoDB
 */
async function getCallRecord(callId: string): Promise<any | null> {
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: CALL_QUEUE_TABLE,
            IndexName: 'callId-index',
            KeyConditionExpression: 'callId = :callId',
            ExpressionAttributeValues: { ':callId': callId },
            Limit: 1
        }));
        return result.Items?.[0] || null;
    } catch (error) {
        console.error('[TranscribeStreaming] Error getting call record:', error);
        return null;
    }
}

/**
 * Download audio from S3 and return as Buffer
 */
async function downloadAudio(bucket: string, key: string): Promise<Buffer> {
    const startTime = Date.now();
    
    const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    }));
    
    const chunks: Uint8Array[] = [];
    const stream = response.Body as Readable;
    
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    console.log(`[TranscribeStreaming] Downloaded audio in ${Date.now() - startTime}ms, size: ${buffer.length} bytes`);
    
    return buffer;
}

/**
 * Skip WAV header and return raw PCM data
 * WAV header is typically 44 bytes for standard format
 */
function extractPcmFromWav(wavBuffer: Buffer): Buffer {
    // Find 'data' chunk in WAV file
    let dataOffset = 44; // Default WAV header size
    
    // Look for 'data' marker
    for (let i = 0; i < Math.min(wavBuffer.length - 4, 100); i++) {
        if (wavBuffer.slice(i, i + 4).toString() === 'data') {
            // Skip 'data' + 4 bytes for chunk size
            dataOffset = i + 8;
            break;
        }
    }
    
    return wavBuffer.slice(dataOffset);
}

/**
 * Create an async generator that yields audio chunks for Transcribe Streaming
 */
async function* createAudioStream(pcmData: Buffer): AsyncGenerator<AudioStream> {
    let offset = 0;
    
    while (offset < pcmData.length) {
        const chunk = pcmData.slice(offset, offset + CHUNK_SIZE);
        offset += CHUNK_SIZE;
        
        yield { AudioEvent: { AudioChunk: chunk } };
        
        // Small delay to simulate real-time streaming (helps with API rate limits)
        // 256ms of audio at 8kHz = 4096 bytes, so we wait proportionally
        const delayMs = Math.floor((chunk.length / SAMPLE_RATE / 2) * 1000 * 0.5); // 50% speed for faster than real-time
        if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

/**
 * Use Transcribe Streaming to transcribe audio
 * This is significantly faster than batch transcription for short audio
 */
async function transcribeWithStreaming(pcmData: Buffer): Promise<string> {
    const startTime = Date.now();
    
    console.log(`[TranscribeStreaming] Starting streaming transcription, audio size: ${pcmData.length} bytes`);
    
    try {
        const response = await transcribeStreamingClient.send(
            new StartStreamTranscriptionCommand({
                LanguageCode: LanguageCode.EN_US,
                MediaEncoding: MediaEncoding.PCM,
                MediaSampleRateHertz: SAMPLE_RATE,
                AudioStream: createAudioStream(pcmData),
            })
        );
        
        let fullTranscript = '';
        
        // Process transcription results
        if (response.TranscriptResultStream) {
            for await (const event of response.TranscriptResultStream) {
                if (event.TranscriptEvent?.Transcript?.Results) {
                    for (const result of event.TranscriptEvent.Transcript.Results) {
                        // Only use final results, not partial
                        if (!result.IsPartial && result.Alternatives?.[0]?.Transcript) {
                            fullTranscript += result.Alternatives[0].Transcript + ' ';
                        }
                    }
                }
            }
        }
        
        const transcript = fullTranscript.trim();
        console.log(`[TranscribeStreaming] Transcription completed in ${Date.now() - startTime}ms: "${transcript.substring(0, 100)}..."`);
        
        return transcript;
    } catch (error: any) {
        console.error('[TranscribeStreaming] Streaming transcription error:', error);
        throw error;
    }
}

/**
 * Invoke Voice AI handler with transcript
 */
async function invokeVoiceAiHandler(params: {
    callId: string;
    clinicId: string;
    transcript: string;
    sessionId: string;
    aiAgentId: string;
}): Promise<{ action: string; text?: string; sessionId?: string }[]> {
    if (!VOICE_AI_LAMBDA_ARN) {
        console.error('[TranscribeStreaming] VOICE_AI_LAMBDA_ARN not configured');
        return [];
    }
    
    const startTime = Date.now();
    
    try {
        const response = await lambdaClient.send(new InvokeCommand({
            FunctionName: VOICE_AI_LAMBDA_ARN,
            InvocationType: 'RequestResponse',
            Payload: Buffer.from(JSON.stringify({
                eventType: 'TRANSCRIPT',
                callId: params.callId,
                clinicId: params.clinicId,
                transcript: params.transcript,
                sessionId: params.sessionId,
                aiAgentId: params.aiAgentId,
            })),
        }));
        
        if (response.Payload) {
            const result = JSON.parse(Buffer.from(response.Payload).toString());
            console.log(`[TranscribeStreaming] Voice AI response in ${Date.now() - startTime}ms:`, result);
            return Array.isArray(result) ? result : [result];
        }
        
        return [];
    } catch (error) {
        console.error('[TranscribeStreaming] Error invoking Voice AI:', error);
        return [];
    }
}

/**
 * Send AI response back to the call via UpdateSipMediaApplicationCall
 */
async function sendResponseToCall(
    callRecord: any,
    responses: { action: string; text?: string; sessionId?: string }[]
): Promise<void> {
    const clinicId = callRecord?.clinicId;
    const transactionId = callRecord?.transactionId || callRecord?.callId;
    
    const smaId = await getSmaIdForClinicSSM(clinicId);
    if (!smaId) {
        console.error('[TranscribeStreaming] No SMA ID found for clinic:', clinicId);
        return;
    }
    
    // Build SMA actions from Voice AI responses
    const actions: any[] = [];
    
    for (const response of responses) {
        switch (response.action) {
            case 'SPEAK':
                if (response.text) {
                    actions.push({
                        Type: 'Speak',
                        Parameters: {
                            Text: response.text,
                            Engine: 'neural',
                            LanguageCode: 'en-US',
                            TextType: 'text',
                            VoiceId: 'Joanna'
                        }
                    });
                }
                break;
            
            case 'HANG_UP':
                actions.push({
                    Type: 'Hangup',
                    Parameters: { SipResponseCode: '0' }
                });
                break;
            
            case 'CONTINUE':
                // Add RecordAudio action to continue listening
                const AI_RECORDINGS_BUCKET = process.env.AI_RECORDINGS_BUCKET;
                if (AI_RECORDINGS_BUCKET) {
                    actions.push({
                        Type: 'RecordAudio',
                        Parameters: {
                            DurationInSeconds: 30, // Longer to capture full utterances
                            SilenceDurationInSeconds: 3, // More time for user to think/respond
                            SilenceThreshold: 100, // Lower = more sensitive to quiet speech (0-1000 range)
                            RecordingTerminators: ['#'],
                            RecordingDestination: {
                                Type: 'S3',
                                BucketName: AI_RECORDINGS_BUCKET,
                                Prefix: `ai-recordings/${clinicId}/${callRecord.callId}/`
                            }
                        }
                    });
                }
                break;
        }
    }
    
    if (actions.length === 0) {
        console.log('[TranscribeStreaming] No actions to send to call');
        return;
    }
    
    console.log(`[TranscribeStreaming] Sending ${actions.length} actions to call ${transactionId}`);
    
    try {
        await chimeClient.send(new UpdateSipMediaApplicationCallCommand({
            SipMediaApplicationId: smaId,
            TransactionId: transactionId,
            Arguments: {
                // CRITICAL: pendingAiActions must contain CHIME SMA format actions
                // NOT the Voice AI response format. The inbound-router passes these
                // directly to Chime SDK which expects {Type: 'Speak', Parameters: {...}}
                pendingAiActions: JSON.stringify(actions),
                aiResponseTime: new Date().toISOString(),
            }
        }));
        
        console.log('[TranscribeStreaming] Successfully sent response to call');
    } catch (error: any) {
        // NotFoundException means the call has already ended (caller hung up)
        // This is expected behavior when processing audio chunks asynchronously
        if (error.name === 'NotFoundException') {
            console.log('[TranscribeStreaming] Call has ended, skipping response (transaction no longer exists)');
            return;
        }
        console.error('[TranscribeStreaming] Error sending response to call:', error);
        throw error;
    }
}

/**
 * Process a single S3 event record
 */
async function processRecord(record: S3EventRecord): Promise<void> {
    const totalStartTime = Date.now();
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    
    console.log('[TranscribeStreaming] Processing recording:', { bucket, key });
    
    // Parse the S3 key to extract call metadata
    const metadata = parseRecordingKey(key);
    if (!metadata) {
        console.error('[TranscribeStreaming] Could not parse recording key, skipping');
        return;
    }
    
    const { clinicId, callId, timestamp } = metadata;
    
    // Get the call record from DynamoDB
    const callRecord = await getCallRecord(callId);
    if (!callRecord) {
        console.error('[TranscribeStreaming] Call record not found:', callId);
        return;
    }
    
    try {
        // Step 1: Download audio from S3
        const wavBuffer = await downloadAudio(bucket, key);
        
        // Check for minimum audio size (empty or very short recordings)
        // At 8kHz mono 16-bit, 16000 bytes = 1 second of audio
        // Require at least 0.5 seconds (8000 bytes) to avoid processing noise/silence
        const MIN_AUDIO_BYTES = 8000;
        if (wavBuffer.length < MIN_AUDIO_BYTES) {
            console.log(`[TranscribeStreaming] Audio too short (${wavBuffer.length} bytes < ${MIN_AUDIO_BYTES}), sending continue action`);
            await sendResponseToCall(callRecord, [{ action: 'CONTINUE' }]);
            return;
        }
        
        // Step 2: Extract PCM data from WAV
        const pcmData = extractPcmFromWav(wavBuffer);
        
        // Step 3: Transcribe using Streaming API
        const transcript = await transcribeWithStreaming(pcmData);
        
        if (!transcript || transcript.length < 2) {
            console.log('[TranscribeStreaming] Empty or too short transcript, continuing to listen');
            await sendResponseToCall(callRecord, [{ action: 'CONTINUE' }]);
            return;
        }
        
        console.log('[TranscribeStreaming] Got transcript:', {
            callId,
            transcriptLength: transcript.length,
            preview: transcript.substring(0, 100),
        });
        
        // Step 4: Invoke Voice AI handler
        const aiResponses = await invokeVoiceAiHandler({
            callId,
            clinicId,
            transcript,
            sessionId: callRecord.aiSessionId || '',
            aiAgentId: callRecord.aiAgentId || '',
        });
        
        // Step 5: Send response back to call
        if (aiResponses.length > 0) {
            await sendResponseToCall(callRecord, aiResponses);
        } else {
            await sendResponseToCall(callRecord, [{ action: 'CONTINUE' }]);
        }
        
        console.log(`[TranscribeStreaming] Total processing time: ${Date.now() - totalStartTime}ms`);
        
    } catch (error: any) {
        // NotFoundException means the call has already ended - this is normal
        if (error.name === 'NotFoundException') {
            console.log('[TranscribeStreaming] Call ended before processing completed:', callId);
            return;
        }
        
        console.error('[TranscribeStreaming] Error processing recording:', {
            callId,
            error: error.message,
        });
        
        // Try to keep the call alive with a recovery message
        // (sendResponseToCall will gracefully handle if call has ended)
        try {
            await sendResponseToCall(callRecord, [
                { action: 'SPEAK', text: 'I apologize, I had trouble understanding. Could you please repeat that?' },
                { action: 'CONTINUE' }
            ]);
        } catch (e: any) {
            // Don't log as error if call just ended
            if (e.name === 'NotFoundException') {
                console.log('[TranscribeStreaming] Call ended during error recovery:', callId);
            } else {
                console.error('[TranscribeStreaming] Failed to send error recovery response:', e);
            }
        }
    }
}

/**
 * Main handler for S3 event notifications
 */
export const handler = async (event: S3Event): Promise<void> => {
    console.log('[TranscribeStreaming] Received S3 event:', JSON.stringify(event, null, 2));
    
    for (const record of event.Records) {
        try {
            await processRecord(record);
        } catch (error) {
            console.error('[TranscribeStreaming] Error processing record:', error);
        }
    }
};

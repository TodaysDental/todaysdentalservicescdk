/**
 * Streaming TTS Manager
 * 
 * Handles sentence-level TTS generation for streaming AI responses.
 * Instead of waiting for the full AI response, this splits text into
 * sentences and generates TTS progressively for lower latency.
 * 
 * Flow:
 * 1. AI generates streaming response → accumulate text
 * 2. Detect sentence boundaries (., !, ?)
 * 3. For each complete sentence, generate TTS immediately
 * 4. Send TTS audio to caller via UpdateSipMediaApplicationCall
 * 
 * IMPORTANT: Uses PCM format (WAV) for Chime SMA PlayAudio compatibility.
 * MP3 is NOT reliably supported by Chime SMA for telephony playback.
 */

import { PollyClient, SynthesizeSpeechCommand, Engine, OutputFormat, VoiceId } from '@aws-sdk/client-polly';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

// Use environment variable for region consistency
const REGION = process.env.CHIME_MEDIA_REGION || process.env.AWS_REGION || 'us-east-1';

const pollyClient = new PollyClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

// Environment variables
const TTS_AUDIO_BUCKET = process.env.TTS_AUDIO_BUCKET || process.env.HOLD_MUSIC_BUCKET;

// ========================================================================
// SENTENCE DETECTION CONFIGURATION
// ========================================================================

// FIX: Improved sentence boundary detection
// Handles abbreviations (Dr., Mr., etc.) and common edge cases
const ABBREVIATIONS = new Set([
    'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc', 'ltd',
    'am', 'pm', 'st', 'rd', 'ave', 'blvd', 'apt', 'no', 'tel', 'fax',
]);

/**
 * Split text into sentences with improved boundary detection
 * Handles abbreviations and common edge cases
 */
function splitIntoSentences(text: string): { sentences: string[]; hasIncompleteLast: boolean } {
    // Match sentence-ending punctuation followed by space or end of string
    const sentencePattern = /([^.!?]*[.!?])(?:\s+|$)/g;
    const sentences: string[] = [];
    let lastIndex = 0;
    let match;

    while ((match = sentencePattern.exec(text)) !== null) {
        const sentence = match[1].trim();
        const wordBeforePeriod = sentence.match(/(\w+)\.$/);
        
        // Skip if it's an abbreviation (e.g., "Dr.", "Mr.")
        if (wordBeforePeriod && ABBREVIATIONS.has(wordBeforePeriod[1].toLowerCase())) {
            continue;
        }
        
        sentences.push(sentence);
        lastIndex = match.index + match[0].length;
    }

    // Check if there's remaining text (incomplete sentence)
    const remaining = text.slice(lastIndex).trim();
    const hasIncompleteLast = remaining.length > 0;
    
    if (hasIncompleteLast) {
        // Don't include incomplete sentence in result - it stays in buffer
    }

    return { sentences, hasIncompleteLast };
}

// FIX: Lowered minimum sentence length to capture short responses like "Sure." "Okay."
const MIN_SENTENCE_LENGTH = 3;

// ========================================================================
// TTS CACHE WITH SIZE LIMITS
// ========================================================================

interface CacheEntry {
    s3Key: string;
    timestamp: number;
    accessCount: number;
}

// FIX: Added cache size limit and LRU-style eviction
const ttsCache: Map<string, CacheEntry> = new Map();
const TTS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (less than S3 lifecycle of 1 day to ensure cache doesn't outlive objects)
const TTS_CACHE_MAX_SIZE = 100; // Maximum cached entries

/**
 * Evict oldest/least-used entries when cache is full
 */
function evictCacheIfNeeded(): void {
    if (ttsCache.size <= TTS_CACHE_MAX_SIZE) return;
    
    // Sort by access count (ascending) then by timestamp (oldest first)
    const entries = Array.from(ttsCache.entries())
        .sort((a, b) => {
            if (a[1].accessCount !== b[1].accessCount) {
                return a[1].accessCount - b[1].accessCount;
            }
            return a[1].timestamp - b[1].timestamp;
        });
    
    // Remove 20% of entries
    const toRemove = Math.ceil(TTS_CACHE_MAX_SIZE * 0.2);
    for (let i = 0; i < toRemove && i < entries.length; i++) {
        ttsCache.delete(entries[i][0]);
    }
    
    console.log(`[StreamingTTS] Evicted ${toRemove} cache entries, new size: ${ttsCache.size}`);
}

/**
 * Clean up expired cache entries
 */
function cleanExpiredCache(): void {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of ttsCache.entries()) {
        if (now - entry.timestamp > TTS_CACHE_TTL_MS) {
            ttsCache.delete(key);
            removed++;
        }
    }
    
    if (removed > 0) {
        console.log(`[StreamingTTS] Cleaned ${removed} expired cache entries`);
    }
}

// ========================================================================
// TTS OPTIONS AND TYPES
// ========================================================================

export interface TTSOptions {
    voiceId?: string;
    engine?: 'neural' | 'standard' | 'generative' | 'long-form';
    sampleRate?: string;
    /** Use SSML for enhanced prosody and natural speech */
    useSSML?: boolean;
    /** Speaking rate adjustment (e.g., '95%' for slightly slower, '105%' for faster) */
    speakingRate?: string;
}

// Recommended neural voices for natural-sounding dental clinic conversations
export const RECOMMENDED_NEURAL_VOICES = [
    'Joanna',    // US English, female - warm and professional
    'Matthew',   // US English, male - clear and friendly
    'Kendra',    // US English, female - conversational
    'Joey',      // US English, male - casual and approachable
    'Salli',     // US English, female - pleasant and clear
] as const;

// Voice quality preference (neural > standard for natural speech)
export const VOICE_ENGINE_PREFERENCE: Engine[] = [Engine.NEURAL, Engine.STANDARD];

export interface TTSChunk {
    text: string;
    audioS3Key: string;
    isFinal: boolean;
    sequenceNumber: number;
}

export interface StreamingTTSManager {
    /**
     * Process streaming text and emit TTS chunks for complete sentences
     */
    processText(
        text: string,
        onChunk: (chunk: TTSChunk) => Promise<void>,
        options?: TTSOptions
    ): Promise<void>;

    /**
     * Flush any remaining text as final chunk
     */
    flush(onChunk: (chunk: TTSChunk) => Promise<void>, options?: TTSOptions): Promise<void>;

    /**
     * Reset the manager state for a new conversation turn
     */
    reset(): void;
}

/**
 * Create a new streaming TTS manager instance
 */
export function createStreamingTTSManager(callId: string): StreamingTTSManager {
    let buffer = '';
    let sequenceNumber = 0;
    let processedSentences: Set<string> = new Set();

    return {
        async processText(
            text: string,
            onChunk: (chunk: TTSChunk) => Promise<void>,
            options: TTSOptions = {}
        ): Promise<void> {
            // Append new text to buffer
            buffer += text;

            // FIX: Use improved sentence splitting
            const { sentences } = splitIntoSentences(buffer);

            // Process all complete sentences
            for (const sentence of sentences) {
                if (sentence.length >= MIN_SENTENCE_LENGTH && !processedSentences.has(sentence)) {
                    processedSentences.add(sentence);

                    // Remove processed sentence from buffer
                    const idx = buffer.indexOf(sentence);
                    if (idx !== -1) {
                        buffer = buffer.slice(idx + sentence.length).trimStart();
                    }

                    const s3Key = await generateTTSToS3(callId, sentence, sequenceNumber, options);

                    if (s3Key) {
                        await onChunk({
                            text: sentence,
                            audioS3Key: s3Key,
                            isFinal: false,
                            sequenceNumber: sequenceNumber++,
                        });
                    }
                }
            }
        },

        async flush(
            onChunk: (chunk: TTSChunk) => Promise<void>,
            options: TTSOptions = {}
        ): Promise<void> {
            const remainingText = buffer.trim();

            if (remainingText.length >= MIN_SENTENCE_LENGTH && !processedSentences.has(remainingText)) {
                const s3Key = await generateTTSToS3(callId, remainingText, sequenceNumber, options);

                if (s3Key) {
                    await onChunk({
                        text: remainingText,
                        audioS3Key: s3Key,
                        isFinal: true,
                        sequenceNumber: sequenceNumber++,
                    });
                }
            }

            buffer = '';
        },

        reset(): void {
            buffer = '';
            sequenceNumber = 0;
            processedSentences = new Set();
        },
    };
}

/**
 * Generate TTS for a single sentence and store in S3
 * Returns the S3 key for the audio file
 * 
 * FIX: Uses PCM format (8kHz, 16-bit, mono) for Chime SMA compatibility.
 * MP3 format is NOT reliably supported by Chime SMA PlayAudio action.
 * 
 * Optimizations:
 * - Neural voice engine for natural speech
 * - SSML support for prosody control
 * - Phrase caching for common responses with size limits
 * - PCM format optimized for telephony (8kHz)
 */
async function generateTTSToS3(
    callId: string,
    text: string,
    sequenceNumber: number,
    options: TTSOptions = {}
): Promise<string | null> {
    if (!TTS_AUDIO_BUCKET) {
        console.error('[StreamingTTS] TTS_AUDIO_BUCKET not configured');
        return null;
    }

    // Periodically clean expired cache entries
    if (Math.random() < 0.1) {
        cleanExpiredCache();
    }

    // Check cache for common phrases
    const cacheKey = `${options.voiceId || 'Joanna'}-${options.useSSML ? 'ssml-' : ''}${text}`;
    const cached = ttsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < TTS_CACHE_TTL_MS) {
        cached.accessCount++;
        console.log('[StreamingTTS] Using cached TTS', { text: text.substring(0, 30), s3Key: cached.s3Key });
        return cached.s3Key;
    }

    const startTime = Date.now();

    try {
        // Generate TTS with Polly Neural voice for natural speech
        const voiceId = (options.voiceId || 'Joanna') as VoiceId;
        const engine = (options.engine || 'neural') as Engine;
        
        // Build SSML for enhanced prosody if enabled
        let speechText = text;
        let textType: 'text' | 'ssml' = 'text';
        
        if (options.useSSML) {
            const rate = options.speakingRate || '100%';
            // Wrap text in SSML with prosody for natural pacing
            speechText = `<speak><prosody rate="${rate}">${escapeSSML(text)}</prosody></speak>`;
            textType = 'ssml';
        }

        // FIX: Use PCM format for Chime SMA compatibility
        // Chime SMA PlayAudio requires WAV (PCM) format, not MP3
        const response = await pollyClient.send(new SynthesizeSpeechCommand({
            Text: speechText,
            TextType: textType,
            OutputFormat: OutputFormat.PCM, // FIX: Changed from MP3 to PCM
            VoiceId: voiceId,
            Engine: engine,
            // 8kHz for telephony (standard PSTN quality)
            SampleRate: options.sampleRate || '8000',
        }));

        if (!response.AudioStream) {
            console.error('[StreamingTTS] No audio stream returned from Polly');
            return null;
        }

        // Convert stream to buffer
        const chunks: Uint8Array[] = [];
        const audioStream = response.AudioStream as AsyncIterable<Uint8Array>;
        for await (const chunk of audioStream) {
            chunks.push(chunk);
        }
        const pcmData = Buffer.concat(chunks);
        
        // FIX: Wrap PCM data in WAV header for proper playback
        const wavBuffer = createWavFromPcm(pcmData, 8000, 1, 16);

        // Store in S3 with .wav extension
        const s3Key = `tts/${callId}/${randomUUID()}-${sequenceNumber}.wav`;

        await s3Client.send(new PutObjectCommand({
            Bucket: TTS_AUDIO_BUCKET,
            Key: s3Key,
            Body: wavBuffer,
            ContentType: 'audio/wav', // FIX: Changed from audio/mpeg to audio/wav
            // Note: S3 "Expires" header is metadata only, doesn't delete objects.
            // Deletion is handled by S3 lifecycle rules configured in CDK.
        }));

        const durationMs = Date.now() - startTime;

        console.log('[StreamingTTS] Generated TTS', {
            text: text.substring(0, 50),
            s3Key,
            durationMs,
            audioBytes: wavBuffer.length,
            format: 'wav',
        });

        // Cache common phrases with eviction
        if (isCommonPhrase(text)) {
            evictCacheIfNeeded();
            ttsCache.set(cacheKey, { s3Key, timestamp: Date.now(), accessCount: 1 });
        }

        return s3Key;

    } catch (error: any) {
        console.error('[StreamingTTS] Error generating TTS:', {
            error: error.message,
            text: text.substring(0, 50),
        });
        return null;
    }
}

/**
 * Create a WAV file from raw PCM data
 * Chime SMA requires WAV format for PlayAudio action
 */
function createWavFromPcm(pcmData: Buffer, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;

    const header = Buffer.alloc(44);
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);
    
    // fmt subchunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    
    // data subchunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
}

/**
 * Check if a phrase is common enough to cache
 * FIX: More restrictive matching to avoid over-caching
 */
function isCommonPhrase(text: string): boolean {
    const lowerText = text.toLowerCase().trim();
    
    // Only cache exact or very close matches to common greetings/closings
    const exactPhrases = [
        'hello',
        'hi there',
        'thank you',
        'thanks',
        'goodbye',
        'bye',
        'please hold',
        'one moment',
        'one moment please',
        'how can i help you',
        'how may i help you',
        'is there anything else',
        'have a great day',
        'have a nice day',
    ];

    // Check for exact match or very close match (within a few chars)
    return exactPhrases.some(phrase => 
        lowerText === phrase || 
        lowerText.startsWith(phrase + '.') ||
        lowerText.startsWith(phrase + '!')
    );
}

/**
 * Escape text for safe inclusion in SSML
 */
function escapeSSML(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Pre-warm TTS cache with common phrases
 * Call this during Lambda cold start for faster initial responses
 */
export async function prewarmTTSCache(callId: string, options: TTSOptions = {}): Promise<void> {
    const commonPhrases = [
        "Thank you for calling. How may I help you today?",
        "Please hold while I look that up for you.",
        "Is there anything else I can help you with?",
        "Thank you. Have a great day!",
    ];

    console.log('[StreamingTTS] Pre-warming TTS cache with common phrases');

    await Promise.all(
        commonPhrases.map(phrase =>
            generateTTSToS3(callId, phrase, 0, options).catch(err => {
                console.warn('[StreamingTTS] Failed to pre-warm phrase:', phrase, err.message);
            })
        )
    );
}

/**
 * Generate TTS for a complete response (non-streaming fallback)
 */
export async function generateFullTTS(
    callId: string,
    text: string,
    options: TTSOptions = {}
): Promise<string | null> {
    return generateTTSToS3(callId, text, 0, options);
}

/**
 * Get cache statistics for monitoring
 */
export function getTTSCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
        size: ttsCache.size,
        maxSize: TTS_CACHE_MAX_SIZE,
        ttlMs: TTS_CACHE_TTL_MS,
    };
}

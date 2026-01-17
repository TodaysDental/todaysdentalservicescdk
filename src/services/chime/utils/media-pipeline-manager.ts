/**
 * Media Pipeline Manager
 * 
 * Manages Chime SDK Media Insights Pipelines for real-time call analytics
 * - Starts Media Pipeline when call connects
 * - Stops Media Pipeline when call ends
 * - Handles configuration retrieval from SSM Parameter Store
 */

import { 
    ChimeSDKMediaPipelinesClient,
    CreateMediaInsightsPipelineCommand,
    DeleteMediaPipelineCommand
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { KinesisVideoClient, DescribeStreamCommand } from '@aws-sdk/client-kinesis-video';

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';

const mediaPipelinesClient = new ChimeSDKMediaPipelinesClient({ region: CHIME_MEDIA_REGION });
const ssmClient = new SSMClient({ region: CHIME_MEDIA_REGION });
const kinesisVideoClient = new KinesisVideoClient({ region: CHIME_MEDIA_REGION });

const ENABLE_REAL_TIME_TRANSCRIPTION = process.env.ENABLE_REAL_TIME_TRANSCRIPTION === 'true';
const MEDIA_INSIGHTS_PIPELINE_PARAMETER = process.env.MEDIA_INSIGHTS_PIPELINE_PARAMETER;

// Cache for Media Insights Pipeline ARN
let cachedPipelineArn: string | null = null;
let pipelineArnCacheTime = 0;
const PIPELINE_ARN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache Kinesis Video Stream ARNs by stream name (avoids repeated DescribeStream calls)
const kvsStreamArnCache: Map<string, { arn: string; timestamp: number }> = new Map();
const KVS_CACHE_TTL_MS = 60 * 1000; // 1 minute cache for KVS ARNs

// Pipeline health metrics
interface PipelineHealthMetrics {
    pipelinesStarted: number;
    pipelinesFailed: number;
    kvsResolutionSuccesses: number;
    kvsResolutionFailures: number;
    avgStartupTimeMs: number;
    startupTimeSamples: number[];
}

const pipelineHealth: PipelineHealthMetrics = {
    pipelinesStarted: 0,
    pipelinesFailed: 0,
    kvsResolutionSuccesses: 0,
    kvsResolutionFailures: 0,
    avgStartupTimeMs: 0,
    startupTimeSamples: [],
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Log pipeline health metrics for CloudWatch monitoring
 */
function emitPipelineHealthMetric(): void {
    console.log('[METRIC] MediaPipeline.Health', {
        ...pipelineHealth,
        startupTimeSamples: undefined, // Don't log the array
        timestamp: new Date().toISOString()
    });
}

/**
 * Update pipeline health with a startup time sample
 */
function recordStartupTime(durationMs: number): void {
    pipelineHealth.startupTimeSamples.push(durationMs);
    // Keep only last 100 samples
    if (pipelineHealth.startupTimeSamples.length > 100) {
        pipelineHealth.startupTimeSamples.shift();
    }
    // Recalculate average
    const sum = pipelineHealth.startupTimeSamples.reduce((a, b) => a + b, 0);
    pipelineHealth.avgStartupTimeMs = Math.round(sum / pipelineHealth.startupTimeSamples.length);
}

/**
 * Resolve the *full* Kinesis Video Stream ARN (includes the required /creationTime suffix)
 * using DescribeStream, because constructing ARNs manually will fail validation.
 * 
 * Optimized for low latency:
 * - Uses cache with TTL
 * - Reduced retry delay (200ms instead of 500ms)
 * - Exponential backoff on retries
 */
async function resolveKinesisVideoStreamArn(streamName: string): Promise<string | null> {
    const now = Date.now();
    const cached = kvsStreamArnCache.get(streamName);
    if (cached && (now - cached.timestamp) < KVS_CACHE_TTL_MS) {
        return cached.arn;
    }

    // Increased defaults for SipMediaApplicationDialIn calls joining meetings:
    // Voice Connector takes longer to create KVS streams than regular SMA calls
    const maxAttempts = parseInt(process.env.KVS_DESCRIBE_RETRY_ATTEMPTS || '12', 10); // Increased from 8
    const baseDelayMs = parseInt(process.env.KVS_DESCRIBE_RETRY_DELAY_MS || '500', 10); // Increased from 200

    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const out = await kinesisVideoClient.send(new DescribeStreamCommand({
                StreamName: streamName,
            }));

            const arn = out.StreamInfo?.StreamARN || null;
            if (arn) {
                kvsStreamArnCache.set(streamName, { arn, timestamp: Date.now() });
                pipelineHealth.kvsResolutionSuccesses++;
                console.log('[MediaPipeline] KVS stream resolved', {
                    streamName,
                    attempt,
                    durationMs: Date.now() - startTime
                });
                return arn;
            }
        } catch (error: any) {
            const name = error?.name || 'UnknownError';
            // Stream not created yet (Chime/VC streaming is asynchronous) – retry briefly.
            if (name === 'ResourceNotFoundException' || name === 'NotFoundException') {
                if (attempt < maxAttempts) {
                    // Exponential backoff: 200ms, 400ms, 600ms, etc. (capped at 1s)
                    const delayMs = Math.min(baseDelayMs * attempt, 1000);
                    console.log('[MediaPipeline] KVS stream not found yet, retrying...', {
                        streamName,
                        attempt,
                        maxAttempts,
                        delayMs,
                    });
                    await sleep(delayMs);
                    continue;
                }
                console.warn('[MediaPipeline] KVS stream not found after retries', { 
                    streamName, 
                    maxAttempts,
                    durationMs: Date.now() - startTime
                });
                pipelineHealth.kvsResolutionFailures++;
                return null;
            }

            console.error('[MediaPipeline] Error describing KVS stream:', {
                streamName,
                error: error?.message || String(error),
                code: error?.code,
                name,
            });
            pipelineHealth.kvsResolutionFailures++;
            return null;
        }
    }

    pipelineHealth.kvsResolutionFailures++;
    return null;
}

/**
 * Get Media Insights Pipeline Configuration ARN from SSM Parameter Store
 * Cached with TTL to avoid repeated SSM calls
 */
async function getMediaInsightsPipelineArn(): Promise<string | null> {
    if (!MEDIA_INSIGHTS_PIPELINE_PARAMETER) {
        console.warn('[MediaPipeline] MEDIA_INSIGHTS_PIPELINE_PARAMETER not configured');
        return null;
    }

    const now = Date.now();
    
    // Return cached value if available and not expired
    if (cachedPipelineArn && (now - pipelineArnCacheTime) < PIPELINE_ARN_CACHE_TTL_MS) {
        return cachedPipelineArn;
    }

    try {
        const response = await ssmClient.send(new GetParameterCommand({
            Name: MEDIA_INSIGHTS_PIPELINE_PARAMETER,
        }));

        cachedPipelineArn = response.Parameter?.Value || null;
        pipelineArnCacheTime = now;
        console.log('[MediaPipeline] Retrieved pipeline ARN from SSM');
        return cachedPipelineArn;
    } catch (error: any) {
        console.error('[MediaPipeline] Failed to get pipeline ARN from SSM:', {
            parameter: MEDIA_INSIGHTS_PIPELINE_PARAMETER,
            error: error.message
        });
        return null;
    }
}

export interface StartMediaPipelineParams {
    callId: string;
    meetingId: string;
    clinicId: string;
    agentId?: string;
    customerPhone?: string;
    direction?: 'inbound' | 'outbound';
    // AI call specific metadata
    isAiCall?: boolean;
    aiSessionId?: string;
}

export type VoiceParticipantRole = 'AGENT' | 'CUSTOMER';

export interface StartMediaPipelineFromKvsStreamParams extends StartMediaPipelineParams {
    kvsStreamArn: string;
    startFragmentNumber?: string;
    participantRole?: VoiceParticipantRole;
    /**
     * Voice Connector streams are typically telephone audio (~8kHz).
     * If unknown, defaulting to 8000 is safest for PSTN.
     */
    mediaSampleRate?: number;
}

/**
 * Start a Media Insights Pipeline for real-time call analytics
 * 
 * This attaches to a Chime meeting and starts streaming transcripts and analytics
 * to the Kinesis stream for processing
 */
export async function startMediaPipeline(params: StartMediaPipelineParams): Promise<string | null> {
    const startTime = Date.now();
    
    if (!ENABLE_REAL_TIME_TRANSCRIPTION) {
        console.log('[MediaPipeline] Real-time transcription is disabled');
        return null;
    }

    const { callId, meetingId, clinicId, agentId, customerPhone, direction } = params;

    try {
        // Get pipeline configuration ARN
        const pipelineConfigArn = await getMediaInsightsPipelineArn();
        if (!pipelineConfigArn) {
            console.warn('[MediaPipeline] Pipeline configuration ARN not available');
            return null;
        }

        console.log('[MediaPipeline] Starting Media Insights Pipeline:', {
            callId,
            meetingId,
            clinicId
        });

        // Check if KVS streaming is enabled
        const kvsEnabled = process.env.ENABLE_KVS_STREAMING === 'true';
        if (!kvsEnabled) {
            console.log('[MediaPipeline] KVS streaming not enabled, skipping pipeline start');
            return null;
        }

        // Get AWS account info for KVS ARN construction
        const kvsPrefix = process.env.KVS_STREAM_PREFIX || 'call-';
        
        // IMPORTANT: For SipMediaApplicationDialIn numbers joining Chime meetings via JoinChimeMeeting,
        // the KVS stream is created by Voice Connector streaming, NOT by the meeting itself.
        // The stream name pattern depends on how Voice Connector streaming is configured.
        // 
        // Possible stream name patterns (in order of likelihood):
        // 1. {prefix}{meetingId} - Standard meeting-based pattern
        // 2. {prefix}{callId} - Call-based pattern
        // 3. ChimeVoiceConnector-{voiceConnectorId}-{timestamp} - Voice Connector pattern
        // 4. {stackName}-{meetingId} - Stack-prefixed pattern
        // 
        // We try multiple patterns to maximize chance of finding the stream.
        const candidateStreamNames = Array.from(new Set([
            `${kvsPrefix}${meetingId}`,
            `${kvsPrefix}${callId}`,
            // Also try without the full prefix (Voice Connector might use shorter names)
            `call-${meetingId}`,
            `chime-${meetingId}`,
            // Try the meeting ID alone (some configurations use this)
            meetingId,
        ]));

        let kvsStreamName: string | undefined;
        let kvsStreamArn: string | null = null;

        // Try each candidate stream name
        for (const name of candidateStreamNames) {
            const arn = await resolveKinesisVideoStreamArn(name);
            if (arn) {
                kvsStreamName = name;
                kvsStreamArn = arn;
                console.log('[MediaPipeline] Found KVS stream:', { 
                    streamName: name, 
                    triedPatterns: candidateStreamNames.length 
                });
                break;
            }
        }

        if (!kvsStreamArn || !kvsStreamName) {
            console.warn('[MediaPipeline] KVS stream ARN not available after trying all patterns', {
                candidates: candidateStreamNames,
                meetingId,
                callId,
                note: 'Voice Connector streaming may not be enabled or stream not created yet'
            });
            return null;
        }

        console.log('[MediaPipeline] Resolved KVS stream ARN:', {
            kvsStreamName,
            kvsStreamArn,
        });

        // Create full Media Insights Pipeline with Chime SDK meeting as source
        const command = new CreateMediaInsightsPipelineCommand({
            MediaInsightsPipelineConfigurationArn: pipelineConfigArn,
            
            // Chime SDK Meeting source - Chime will automatically stream to KVS
            KinesisVideoStreamSourceRuntimeConfiguration: {
                MediaEncoding: 'pcm',
                MediaSampleRate: 48000,
                Streams: [
                    {
                        // KVS stream for this specific meeting
                        StreamArn: kvsStreamArn,
                        StreamChannelDefinition: {
                            NumberOfChannels: 2, // Stereo: ch0=agent, ch1=customer
                            ChannelDefinitions: [
                                { ChannelId: 0, ParticipantRole: 'AGENT' },
                                { ChannelId: 1, ParticipantRole: 'CUSTOMER' },
                            ],
                        },
                    },
                ],
            },
            
            // Runtime metadata for analytics correlation
            // This metadata is passed through to the Kinesis stream and available to consumers
            MediaInsightsRuntimeMetadata: {
                callId,
                clinicId,
                meetingId,
                agentId: agentId || '',
                customerPhone: customerPhone || '',
                direction: direction || 'inbound',
                // AI call metadata for transcript-bridge Lambda
                isAiCall: params.isAiCall ? 'true' : 'false',
                aiSessionId: params.aiSessionId || '',
                transactionId: callId, // For UpdateSipMediaApplicationCall
            },
            
            // Tags for resource management and cost tracking
            Tags: [
                { Key: 'CallId', Value: callId },
                { Key: 'ClinicId', Value: clinicId },
                { Key: 'MeetingId', Value: meetingId },
                { Key: 'Type', Value: params.isAiCall ? 'AiVoiceCall' : 'RealTimeAnalytics' },
                ...(params.isAiCall ? [{ Key: 'AiSessionId', Value: params.aiSessionId || '' }] : []),
            ],
        });

        const response = await mediaPipelinesClient.send(command);
        const pipelineId = response.MediaInsightsPipeline?.MediaPipelineId;

        const startupDuration = Date.now() - startTime;
        
        if (pipelineId) {
            pipelineHealth.pipelinesStarted++;
            recordStartupTime(startupDuration);
            
            console.log('[MediaPipeline] Media Insights Pipeline started successfully:', {
                callId,
                pipelineId,
                meetingId,
                kvsStreamName,
                startupDurationMs: startupDuration,
            });
            
            // Emit health metrics periodically (every 10 pipelines)
            if (pipelineHealth.pipelinesStarted % 10 === 0) {
                emitPipelineHealthMetric();
            }
        } else {
            pipelineHealth.pipelinesFailed++;
            console.warn('[MediaPipeline] Pipeline created but no ID returned');
        }

        return pipelineId || null;
    } catch (error: any) {
        pipelineHealth.pipelinesFailed++;
        
        console.error('[MediaPipeline] Failed to start Media Insights Pipeline:', {
            callId,
            meetingId,
            error: error.message,
            code: error.code,
            startupDurationMs: Date.now() - startTime,
        });
        
        // Don't fail the call if Media Pipeline fails - it's a non-critical feature
        return null;
    }
}

/**
 * Start a Media Insights Pipeline from an existing Kinesis Video Stream ARN.
 *
 * Use this for Voice Connector streaming events, where the KVS Stream ARN is provided
 * by EventBridge (Chime VoiceConnector Streaming Status) and is not predictable by name.
 */
export async function startMediaPipelineFromKvsStream(params: StartMediaPipelineFromKvsStreamParams): Promise<string | null> {
    if (!ENABLE_REAL_TIME_TRANSCRIPTION) {
        console.log('[MediaPipeline] Real-time transcription is disabled');
        return null;
    }

    const { callId, meetingId, clinicId } = params;

    try {
        const pipelineConfigArn = await getMediaInsightsPipelineArn();
        if (!pipelineConfigArn) {
            console.warn('[MediaPipeline] Pipeline configuration ARN not available');
            return null;
        }

        const kvsStreamArn = params.kvsStreamArn;
        const fragmentNumber = params.startFragmentNumber;
        const participantRole: VoiceParticipantRole = params.participantRole || 'CUSTOMER';

        const mediaSampleRate = params.mediaSampleRate
            ?? parseInt(process.env.VC_MEDIA_SAMPLE_RATE || '8000', 10);

        console.log('[MediaPipeline] Starting Media Insights Pipeline from KVS stream:', {
            callId,
            clinicId,
            kvsStreamArn,
            fragmentNumber,
            participantRole,
            mediaSampleRate,
        });

        const command = new CreateMediaInsightsPipelineCommand({
            MediaInsightsPipelineConfigurationArn: pipelineConfigArn,
            KinesisVideoStreamSourceRuntimeConfiguration: {
                MediaEncoding: 'pcm',
                MediaSampleRate: mediaSampleRate,
                Streams: [
                    {
                        StreamArn: kvsStreamArn,
                        FragmentNumber: fragmentNumber,
                        StreamChannelDefinition: {
                            NumberOfChannels: 1,
                            ChannelDefinitions: [
                                { ChannelId: 0, ParticipantRole: participantRole },
                            ],
                        },
                    },
                ],
            },
            MediaInsightsRuntimeMetadata: {
                callId,
                clinicId,
                meetingId,
                agentId: params.agentId || '',
                customerPhone: params.customerPhone || '',
                direction: params.direction || 'inbound',
                isAiCall: params.isAiCall ? 'true' : 'false',
                aiSessionId: params.aiSessionId || '',
                transactionId: callId,
                // Helpful for debugging voice connector streams
                kvsFragmentNumber: fragmentNumber || '',
                kvsParticipantRole: participantRole,
            },
            Tags: [
                { Key: 'CallId', Value: callId },
                { Key: 'ClinicId', Value: clinicId },
                { Key: 'MeetingId', Value: meetingId },
                { Key: 'Type', Value: params.isAiCall ? 'AiVoiceCall' : 'RealTimeAnalytics' },
                { Key: 'KvsRole', Value: participantRole },
                ...(params.isAiCall ? [{ Key: 'AiSessionId', Value: params.aiSessionId || '' }] : []),
            ],
        });

        const response = await mediaPipelinesClient.send(command);
        const pipelineId = response.MediaInsightsPipeline?.MediaPipelineId;

        if (pipelineId) {
            console.log('[MediaPipeline] Media Insights Pipeline started successfully (KVS source):', {
                callId,
                pipelineId,
            });
        } else {
            console.warn('[MediaPipeline] Pipeline created but no ID returned (KVS source)');
        }

        return pipelineId || null;
    } catch (error: any) {
        console.error('[MediaPipeline] Failed to start Media Insights Pipeline (KVS source):', {
            callId,
            meetingId,
            error: error.message,
            code: error.code,
        });
        return null;
    }
}

/**
 * Stop a Media Insights Pipeline
 * 
 * This should be called when a call ends to clean up resources
 */
export async function stopMediaPipeline(pipelineId: string, callId: string): Promise<void> {
    if (!ENABLE_REAL_TIME_TRANSCRIPTION || !pipelineId) {
        return;
    }

    try {
        console.log('[MediaPipeline] Stopping Media Insights Pipeline:', {
            callId,
            pipelineId
        });

        await mediaPipelinesClient.send(new DeleteMediaPipelineCommand({
            MediaPipelineId: pipelineId,
        }));

        console.log('[MediaPipeline] Media Insights Pipeline stopped:', pipelineId);
    } catch (error: any) {
        // Pipeline might already be stopped or deleted
        if (error.code === 'NotFoundException') {
            console.log('[MediaPipeline] Pipeline already stopped:', pipelineId);
        } else {
            console.error('[MediaPipeline] Failed to stop Media Insights Pipeline:', {
                pipelineId,
                callId,
                error: error.message
            });
        }
    }
}

/**
 * Check if real-time transcription is enabled
 */
export function isRealTimeTranscriptionEnabled(): boolean {
    return ENABLE_REAL_TIME_TRANSCRIPTION;
}

/**
 * Get pipeline health metrics for monitoring
 */
export function getPipelineHealthMetrics(): Omit<PipelineHealthMetrics, 'startupTimeSamples'> {
    return {
        pipelinesStarted: pipelineHealth.pipelinesStarted,
        pipelinesFailed: pipelineHealth.pipelinesFailed,
        kvsResolutionSuccesses: pipelineHealth.kvsResolutionSuccesses,
        kvsResolutionFailures: pipelineHealth.kvsResolutionFailures,
        avgStartupTimeMs: pipelineHealth.avgStartupTimeMs,
    };
}


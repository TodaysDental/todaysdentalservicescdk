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

// Cache Kinesis Video Stream ARNs by stream name (avoids repeated DescribeStream calls)
const kvsStreamArnCache: Map<string, string> = new Map();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolve the *full* Kinesis Video Stream ARN (includes the required /creationTime suffix)
 * using DescribeStream, because constructing ARNs manually will fail validation.
 */
async function resolveKinesisVideoStreamArn(streamName: string): Promise<string | null> {
    const cached = kvsStreamArnCache.get(streamName);
    if (cached) return cached;

    const maxAttempts = parseInt(process.env.KVS_DESCRIBE_RETRY_ATTEMPTS || '10', 10);
    const delayMs = parseInt(process.env.KVS_DESCRIBE_RETRY_DELAY_MS || '500', 10);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const out = await kinesisVideoClient.send(new DescribeStreamCommand({
                StreamName: streamName,
            }));

            const arn = out.StreamInfo?.StreamARN || null;
            if (arn) {
                kvsStreamArnCache.set(streamName, arn);
                return arn;
            }
        } catch (error: any) {
            const name = error?.name || 'UnknownError';
            // Stream not created yet (Chime/VC streaming is asynchronous) – retry briefly.
            if (name === 'ResourceNotFoundException' || name === 'NotFoundException') {
                if (attempt < maxAttempts) {
                    console.log('[MediaPipeline] KVS stream not found yet, retrying...', {
                        streamName,
                        attempt,
                        maxAttempts,
                        delayMs,
                    });
                    await sleep(delayMs);
                    continue;
                }
                console.warn('[MediaPipeline] KVS stream not found after retries', { streamName, maxAttempts });
                return null;
            }

            console.error('[MediaPipeline] Error describing KVS stream:', {
                streamName,
                error: error?.message || String(error),
                code: error?.code,
                name,
            });
            return null;
        }
    }

    return null;
}

/**
 * Get Media Insights Pipeline Configuration ARN from SSM Parameter Store
 */
async function getMediaInsightsPipelineArn(): Promise<string | null> {
    if (!MEDIA_INSIGHTS_PIPELINE_PARAMETER) {
        console.warn('[MediaPipeline] MEDIA_INSIGHTS_PIPELINE_PARAMETER not configured');
        return null;
    }

    // Return cached value if available
    if (cachedPipelineArn) {
        return cachedPipelineArn;
    }

    try {
        const response = await ssmClient.send(new GetParameterCommand({
            Name: MEDIA_INSIGHTS_PIPELINE_PARAMETER,
        }));

        cachedPipelineArn = response.Parameter?.Value || null;
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
        
        // Stream names are deterministic, but the *ARN* contains a required /creationTime suffix.
        // We must DescribeStream to get the full ARN.
        const candidateStreamNames = Array.from(new Set([
            `${kvsPrefix}${meetingId}`,
            `${kvsPrefix}${callId}`,
        ]));

        let kvsStreamName: string | undefined;
        let kvsStreamArn: string | null = null;

        for (const name of candidateStreamNames) {
            const arn = await resolveKinesisVideoStreamArn(name);
            if (arn) {
                kvsStreamName = name;
                kvsStreamArn = arn;
                break;
            }
        }

        if (!kvsStreamArn || !kvsStreamName) {
            console.warn('[MediaPipeline] KVS stream ARN not available (DescribeStream failed)', {
                candidates: candidateStreamNames,
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

        if (pipelineId) {
            console.log('[MediaPipeline] Media Insights Pipeline started successfully:', {
                callId,
                pipelineId,
                meetingId,
                kvsStreamName,
            });
        } else {
            console.warn('[MediaPipeline] Pipeline created but no ID returned');
        }

        return pipelineId || null;
    } catch (error: any) {
        console.error('[MediaPipeline] Failed to start Media Insights Pipeline:', {
            callId,
            meetingId,
            error: error.message,
            code: error.code,
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


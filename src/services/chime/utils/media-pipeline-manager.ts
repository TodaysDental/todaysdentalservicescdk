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

// CHIME_MEDIA_REGION: Use environment variable for consistency across all handlers
// This is set by ChimeStack CDK and ensures all Chime operations use the same region
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';

const mediaPipelinesClient = new ChimeSDKMediaPipelinesClient({ region: CHIME_MEDIA_REGION });
const ssmClient = new SSMClient({ region: CHIME_MEDIA_REGION });

const ENABLE_REAL_TIME_TRANSCRIPTION = process.env.ENABLE_REAL_TIME_TRANSCRIPTION === 'true';
const MEDIA_INSIGHTS_PIPELINE_PARAMETER = process.env.MEDIA_INSIGHTS_PIPELINE_PARAMETER;

// Cache for Media Insights Pipeline ARN
let cachedPipelineArn: string | null = null;

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
        const region = CHIME_MEDIA_REGION;
        // Extract account ID from Lambda context or environment
        const account = process.env.AWS_ACCOUNT_ID || 
                       (process.env.AWS_LAMBDA_FUNCTION_NAME ? 
                        process.env.AWS_LAMBDA_FUNCTION_NAME.split(':')[4] : null) ||
                       '851620242036'; // Fallback to your account ID
        
        // Generate KVS stream ARN based on meeting ID
        // Note: The actual KVS stream will be created by Chime SDK when the meeting starts
        const kvsStreamName = `${kvsPrefix}${meetingId}`;
        const kvsStreamArn = account 
            ? `arn:aws:kinesisvideo:${region}:${account}:stream/${kvsStreamName}/`
            : null;

        if (!kvsStreamArn) {
            console.warn('[MediaPipeline] Cannot construct KVS ARN (missing account ID)');
            return null;
        }

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


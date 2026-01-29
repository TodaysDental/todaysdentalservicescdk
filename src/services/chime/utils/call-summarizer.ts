/**
 * Call Summarizer Module
 * 
 * Uses Amazon Bedrock to generate AI-powered call summaries from transcripts.
 * Provides structured summaries including key topics, action items, and follow-ups.
 * 
 * @module call-summarizer
 */

import {
    BedrockRuntimeClient,
    InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const bedrock = new BedrockRuntimeClient({});

const BEDROCK_MODEL_ID = process.env.BEDROCK_SUMMARY_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';
const MAX_TRANSCRIPT_LENGTH = 50000; // Characters

export interface CallSummary {
    /** Brief one-paragraph summary */
    summary: string;
    /** Main topics discussed */
    keyTopics: string[];
    /** Action items identified */
    actionItems: Array<{
        description: string;
        assignee: 'agent' | 'clinic' | 'patient';
        priority: 'high' | 'medium' | 'low';
    }>;
    /** Follow-up required */
    followUp: {
        required: boolean;
        type?: 'callback' | 'appointment' | 'email' | 'other';
        reason?: string;
        suggestedTimeframe?: string;
    };
    /** Patient intent */
    patientIntent: string;
    /** Resolution status */
    resolution: 'resolved' | 'partial' | 'unresolved' | 'escalated';
    /** Call category */
    category: string;
    /** Confidence score (0-100) */
    confidence: number;
}

export interface SummaryConfig {
    /** Enable call summarization */
    enabled: boolean;
    /** Model to use for summarization */
    modelId: string;
    /** Maximum tokens for summary */
    maxTokens: number;
    /** Include sentiment in summary */
    includeSentiment: boolean;
    /** Generate follow-up recommendations */
    generateFollowUps: boolean;
}

export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
    enabled: process.env.CHIME_ENABLE_CALL_SUMMARY !== 'false',
    modelId: BEDROCK_MODEL_ID,
    maxTokens: parseInt(process.env.CHIME_SUMMARY_MAX_TOKENS || '1024', 10),
    includeSentiment: true,
    generateFollowUps: true,
};

/**
 * Generates a summary of a call from its transcript
 */
export async function summarizeCall(
    transcript: string,
    callMetadata: {
        callId: string;
        clinicName?: string;
        agentName?: string;
        callerPhoneNumber?: string;
        direction: 'inbound' | 'outbound';
        duration: number;
        sentiment?: string;
    },
    config: Partial<SummaryConfig> = {}
): Promise<CallSummary | null> {
    const fullConfig = { ...DEFAULT_SUMMARY_CONFIG, ...config };

    if (!fullConfig.enabled) {
        return null;
    }

    if (!transcript || transcript.length < 50) {
        console.log('[summarizeCall] Transcript too short for summarization');
        return null;
    }

    // Truncate very long transcripts
    const truncatedTranscript = transcript.length > MAX_TRANSCRIPT_LENGTH
        ? transcript.substring(0, MAX_TRANSCRIPT_LENGTH) + '\n[Transcript truncated]'
        : transcript;

    console.log('[summarizeCall] Generating summary', {
        callId: callMetadata.callId,
        transcriptLength: transcript.length,
        direction: callMetadata.direction,
    });

    const prompt = buildSummaryPrompt(truncatedTranscript, callMetadata, fullConfig);

    try {
        const response = await bedrock.send(new InvokeModelCommand({
            modelId: fullConfig.modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: fullConfig.maxTokens,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            }),
        }));

        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiResponse = responseBody.content?.[0]?.text || '';

        return parseSummaryResponse(aiResponse);

    } catch (error: any) {
        console.error('[summarizeCall] Error:', error.message);
        return null;
    }
}

/**
 * Builds the prompt for call summarization
 */
function buildSummaryPrompt(
    transcript: string,
    metadata: {
        clinicName?: string;
        agentName?: string;
        direction: string;
        duration: number;
        sentiment?: string;
    },
    config: SummaryConfig
): string {
    const contextParts = [];
    if (metadata.clinicName) contextParts.push(`Clinic: ${metadata.clinicName}`);
    if (metadata.agentName) contextParts.push(`Agent: ${metadata.agentName}`);
    contextParts.push(`Direction: ${metadata.direction}`);
    contextParts.push(`Duration: ${Math.round(metadata.duration / 60)} minutes`);
    if (config.includeSentiment && metadata.sentiment) {
        contextParts.push(`Overall Sentiment: ${metadata.sentiment}`);
    }

    return `You are a dental clinic call center analyst. Analyze the following call transcript and provide a structured summary.

CALL CONTEXT:
${contextParts.join('\n')}

TRANSCRIPT:
${transcript}

Provide your response as a valid JSON object with the following structure:
{
  "summary": "A brief 2-3 sentence summary of the call",
  "keyTopics": ["topic1", "topic2"],
  "actionItems": [
    {
      "description": "Action description",
      "assignee": "agent|clinic|patient",
      "priority": "high|medium|low"
    }
  ],
  "followUp": {
    "required": true/false,
    "type": "callback|appointment|email|other",
    "reason": "Reason for follow-up",
    "suggestedTimeframe": "e.g., within 24 hours"
  },
  "patientIntent": "What the patient called about",
  "resolution": "resolved|partial|unresolved|escalated",
  "category": "Category of call (e.g., Scheduling, Billing, Emergency, General Inquiry)",
  "confidence": 0-100
}

Important:
- Be concise but capture essential information
- Identify any HIPAA-sensitive information that should be handled carefully
- For dental-specific calls, note any treatment discussions, insurance questions, or scheduling needs
- Respond with ONLY the JSON object, no additional text`;
}

/**
 * Parses the AI response into a structured summary
 */
function parseSummaryResponse(response: string): CallSummary | null {
    try {
        // Try to extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('[parseSummaryResponse] No JSON found in response');
            return null;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        return {
            summary: parsed.summary || 'No summary available',
            keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
            actionItems: Array.isArray(parsed.actionItems)
                ? parsed.actionItems.map((item: any) => ({
                    description: item.description || '',
                    assignee: item.assignee || 'agent',
                    priority: item.priority || 'medium',
                }))
                : [],
            followUp: {
                required: parsed.followUp?.required || false,
                type: parsed.followUp?.type,
                reason: parsed.followUp?.reason,
                suggestedTimeframe: parsed.followUp?.suggestedTimeframe,
            },
            patientIntent: parsed.patientIntent || 'Unknown',
            resolution: parsed.resolution || 'unresolved',
            category: parsed.category || 'General',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 70,
        };

    } catch (error: any) {
        console.error('[parseSummaryResponse] Parse error:', error.message);
        return null;
    }
}

/**
 * Saves call summary to the analytics record
 */
export async function saveCallSummary(
    ddb: DynamoDBDocumentClient,
    callId: string,
    clinicId: string,
    timestamp: number,
    summary: CallSummary,
    callAnalyticsTableName: string
): Promise<void> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: callAnalyticsTableName,
            Key: { callId, timestamp },
            UpdateExpression: `
        SET aiSummary = :summary,
            aiKeyTopics = :topics,
            aiActionItems = :actions,
            aiFollowUpRequired = :followUp,
            aiPatientIntent = :intent,
            aiResolution = :resolution,
            aiCategory = :category,
            aiConfidence = :confidence,
            summarizedAt = :time
      `,
            ExpressionAttributeValues: {
                ':summary': summary.summary,
                ':topics': summary.keyTopics,
                ':actions': summary.actionItems,
                ':followUp': summary.followUp,
                ':intent': summary.patientIntent,
                ':resolution': summary.resolution,
                ':category': summary.category,
                ':confidence': summary.confidence,
                ':time': new Date().toISOString(),
            },
        }));

        console.log('[saveCallSummary] Summary saved', { callId });

    } catch (error: any) {
        console.error('[saveCallSummary] Error:', error.message);
    }
}

/**
 * Generates a quick summary suitable for notification/display
 */
export function generateQuickSummary(summary: CallSummary): string {
    let quick = summary.summary;

    if (summary.followUp.required) {
        quick += ` [Follow-up: ${summary.followUp.type || 'Required'}]`;
    }

    if (summary.actionItems.length > 0) {
        quick += ` [${summary.actionItems.length} action item(s)]`;
    }

    return quick;
}

/**
 * Extracts callback information from summary
 */
export function extractCallbackInfo(summary: CallSummary): {
    shouldCallback: boolean;
    reason?: string;
    priority: 'high' | 'medium' | 'low';
    timeframe?: string;
} | null {
    if (!summary.followUp.required) {
        return null;
    }

    if (summary.followUp.type !== 'callback') {
        return null;
    }

    // Determine priority based on resolution and action items
    let priority: 'high' | 'medium' | 'low' = 'medium';

    if (summary.resolution === 'unresolved' || summary.resolution === 'escalated') {
        priority = 'high';
    } else if (summary.actionItems.some(a => a.priority === 'high')) {
        priority = 'high';
    }

    return {
        shouldCallback: true,
        reason: summary.followUp.reason,
        priority,
        timeframe: summary.followUp.suggestedTimeframe,
    };
}

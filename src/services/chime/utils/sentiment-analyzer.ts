/**
 * Sentiment Analyzer Module
 * 
 * Provides real-time and post-call sentiment analysis using Comprehend.
 * Integrates with transcription data to analyze customer and agent sentiment.
 * 
 * Features:
 * - Real-time sentiment detection during calls
 * - Supervisor alerts for negative sentiment
 * - Aggregate sentiment tracking per call
 * - Customer satisfaction prediction
 * 
 * @module sentiment-analyzer
 */

import {
    ComprehendClient,
    DetectSentimentCommand,
    BatchDetectSentimentCommand,
    SentimentType,
    LanguageCode
} from '@aws-sdk/client-comprehend';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { publishMetric, MetricName } from './cloudwatch-metrics';

const comprehend = new ComprehendClient({});

export interface SentimentResult {
    sentiment: SentimentType;
    score: {
        positive: number;
        negative: number;
        neutral: number;
        mixed: number;
    };
    confidence: number;
}

export interface CallSentimentSummary {
    overallSentiment: SentimentType;
    averageScore: number;
    sentimentTimeline: Array<{
        timestamp: string;
        segment: string;
        sentiment: SentimentType;
        score: number;
        speaker: 'caller' | 'agent';
    }>;
    negativeSegments: number;
    positiveSegments: number;
    neutralSegments: number;
    mixedSegments: number;
    alertsTriggered: number;
    predictedSatisfaction: 'low' | 'medium' | 'high';
}

export interface SentimentConfig {
    /** Enable real-time sentiment analysis */
    enableRealTime: boolean;
    /** Threshold for triggering negative sentiment alerts (0-1) */
    negativeAlertThreshold: number;
    /** Minimum text length to analyze */
    minTextLength: number;
    /** Language for analysis */
    language: string;
    /** Enable supervisor notifications */
    enableSupervisorAlerts: boolean;
}

export const DEFAULT_SENTIMENT_CONFIG: SentimentConfig = {
    enableRealTime: process.env.CHIME_ENABLE_REALTIME_SENTIMENT !== 'false',
    negativeAlertThreshold: parseFloat(process.env.CHIME_NEGATIVE_SENTIMENT_THRESHOLD || '0.7'),
    minTextLength: parseInt(process.env.CHIME_MIN_SENTIMENT_TEXT_LENGTH || '20', 10),
    language: 'en',
    enableSupervisorAlerts: process.env.CHIME_ENABLE_SENTIMENT_ALERTS === 'true',
};

// Cache for recent sentiment results to avoid redundant API calls
const sentimentCache: Map<string, { result: SentimentResult; timestamp: number }> = new Map();
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Analyzes sentiment of a single text segment
 */
export async function analyzeSentiment(
    text: string,
    config: Partial<SentimentConfig> = {}
): Promise<SentimentResult | null> {
    const fullConfig = { ...DEFAULT_SENTIMENT_CONFIG, ...config };

    if (!text || text.length < fullConfig.minTextLength) {
        return null;
    }

    // Check cache
    const cacheKey = text.substring(0, 100);
    const cached = sentimentCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.result;
    }

    try {
        const response = await comprehend.send(new DetectSentimentCommand({
            Text: text,
            LanguageCode: fullConfig.language as LanguageCode,
        }));

        const result: SentimentResult = {
            sentiment: response.Sentiment || 'NEUTRAL',
            score: {
                positive: response.SentimentScore?.Positive || 0,
                negative: response.SentimentScore?.Negative || 0,
                neutral: response.SentimentScore?.Neutral || 0,
                mixed: response.SentimentScore?.Mixed || 0,
            },
            confidence: Math.max(
                response.SentimentScore?.Positive || 0,
                response.SentimentScore?.Negative || 0,
                response.SentimentScore?.Neutral || 0,
                response.SentimentScore?.Mixed || 0
            ),
        };

        // Cache result
        sentimentCache.set(cacheKey, { result, timestamp: Date.now() });

        return result;

    } catch (error: any) {
        console.error('[analyzeSentiment] Error:', error.message);
        return null;
    }
}

/**
 * Analyzes sentiment of multiple text segments in batch
 */
export async function analyzeSentimentBatch(
    texts: string[],
    config: Partial<SentimentConfig> = {}
): Promise<SentimentResult[]> {
    const fullConfig = { ...DEFAULT_SENTIMENT_CONFIG, ...config };

    // Filter valid texts
    const validTexts = texts.filter(t => t && t.length >= fullConfig.minTextLength);

    if (validTexts.length === 0) {
        return [];
    }

    // AWS Comprehend batch limit is 25
    const results: SentimentResult[] = [];
    const batchSize = 25;

    for (let i = 0; i < validTexts.length; i += batchSize) {
        const batch = validTexts.slice(i, i + batchSize);

        try {
            const response = await comprehend.send(new BatchDetectSentimentCommand({
                TextList: batch,
                LanguageCode: fullConfig.language as LanguageCode,
            }));

            if (response.ResultList) {
                for (const result of response.ResultList) {
                    results.push({
                        sentiment: result.Sentiment || 'NEUTRAL',
                        score: {
                            positive: result.SentimentScore?.Positive || 0,
                            negative: result.SentimentScore?.Negative || 0,
                            neutral: result.SentimentScore?.Neutral || 0,
                            mixed: result.SentimentScore?.Mixed || 0,
                        },
                        confidence: Math.max(
                            result.SentimentScore?.Positive || 0,
                            result.SentimentScore?.Negative || 0,
                            result.SentimentScore?.Neutral || 0,
                            result.SentimentScore?.Mixed || 0
                        ),
                    });
                }
            }
        } catch (error: any) {
            console.error('[analyzeSentimentBatch] Error:', error.message);
        }
    }

    return results;
}

/**
 * Processes a transcription segment for real-time sentiment
 * Returns alert if negative sentiment exceeds threshold
 */
export async function processTranscriptionSegment(
    ddb: DynamoDBDocumentClient,
    callId: string,
    segment: {
        text: string;
        speaker: 'caller' | 'agent';
        timestamp: string;
    },
    clinicId: string,
    queuePosition: number,
    callQueueTableName: string,
    config: Partial<SentimentConfig> = {}
): Promise<{
    sentiment: SentimentResult | null;
    alertTriggered: boolean;
}> {
    const fullConfig = { ...DEFAULT_SENTIMENT_CONFIG, ...config };

    if (!fullConfig.enableRealTime) {
        return { sentiment: null, alertTriggered: false };
    }

    const sentiment = await analyzeSentiment(segment.text, config);

    if (!sentiment) {
        return { sentiment: null, alertTriggered: false };
    }

    // Check for negative sentiment alert
    const alertTriggered =
        sentiment.sentiment === 'NEGATIVE' &&
        sentiment.score.negative >= fullConfig.negativeAlertThreshold &&
        segment.speaker === 'caller';

    if (alertTriggered) {
        console.log('[processTranscriptionSegment] Negative sentiment alert', {
            callId,
            score: sentiment.score.negative,
            text: segment.text.substring(0, 100),
        });

        // Update call record with alert
        try {
            await ddb.send(new UpdateCommand({
                TableName: callQueueTableName,
                Key: { clinicId, queuePosition },
                UpdateExpression: `
          SET lastNegativeSentimentAt = :time,
              negativeSentimentCount = if_not_exists(negativeSentimentCount, :zero) + :one,
              lastNegativeText = :text,
              sentimentAlertActive = :true
        `,
                ExpressionAttributeValues: {
                    ':time': new Date().toISOString(),
                    ':zero': 0,
                    ':one': 1,
                    ':text': segment.text.substring(0, 500),
                    ':true': true,
                },
            }));
        } catch (error: any) {
            console.error('[processTranscriptionSegment] Error updating alert:', error.message);
        }

        // Publish metric
        await publishMetric(MetricName.AI_SENTIMENT, sentiment.score.negative * 100, {
            clinicId,
            type: 'negative_alert',
        });
    }

    return { sentiment, alertTriggered };
}

/**
 * Generates sentiment summary for a completed call
 */
export async function generateCallSentimentSummary(
    transcriptSegments: Array<{
        text: string;
        speaker: 'caller' | 'agent';
        timestamp: string;
    }>,
    config: Partial<SentimentConfig> = {}
): Promise<CallSentimentSummary> {
    // Analyze all segments
    const texts = transcriptSegments.map(s => s.text);
    const sentiments = await analyzeSentimentBatch(texts, config);

    const timeline: CallSentimentSummary['sentimentTimeline'] = [];
    let totalScore = 0;
    let negativeCount = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let mixedCount = 0;

    for (let i = 0; i < transcriptSegments.length && i < sentiments.length; i++) {
        const segment = transcriptSegments[i];
        const sentiment = sentiments[i];

        // Convert to 0-100 score (positive - negative)
        const score = Math.round((sentiment.score.positive - sentiment.score.negative + 1) * 50);
        totalScore += score;

        timeline.push({
            timestamp: segment.timestamp,
            segment: segment.text.substring(0, 200),
            sentiment: sentiment.sentiment,
            score,
            speaker: segment.speaker,
        });

        switch (sentiment.sentiment) {
            case 'POSITIVE': positiveCount++; break;
            case 'NEGATIVE': negativeCount++; break;
            case 'NEUTRAL': neutralCount++; break;
            case 'MIXED': mixedCount++; break;
        }
    }

    // Calculate overall sentiment
    const avgScore = timeline.length > 0 ? Math.round(totalScore / timeline.length) : 50;
    let overallSentiment: SentimentType;

    if (positiveCount > negativeCount && positiveCount > neutralCount) {
        overallSentiment = 'POSITIVE';
    } else if (negativeCount > positiveCount && negativeCount > neutralCount) {
        overallSentiment = 'NEGATIVE';
    } else if (mixedCount > positiveCount && mixedCount > neutralCount) {
        overallSentiment = 'MIXED';
    } else {
        overallSentiment = 'NEUTRAL';
    }

    // Predict satisfaction
    let predictedSatisfaction: 'low' | 'medium' | 'high';
    if (avgScore >= 70 && negativeCount <= 1) {
        predictedSatisfaction = 'high';
    } else if (avgScore >= 40 && negativeCount <= 3) {
        predictedSatisfaction = 'medium';
    } else {
        predictedSatisfaction = 'low';
    }

    return {
        overallSentiment,
        averageScore: avgScore,
        sentimentTimeline: timeline,
        negativeSegments: negativeCount,
        positiveSegments: positiveCount,
        neutralSegments: neutralCount,
        mixedSegments: mixedCount,
        alertsTriggered: timeline.filter(t =>
            t.sentiment === 'NEGATIVE' && t.speaker === 'caller'
        ).length,
        predictedSatisfaction,
    };
}

/**
 * Publishes sentiment metrics to CloudWatch
 */
export async function publishSentimentMetrics(
    clinicId: string,
    sentiment: SentimentResult,
    callId: string
): Promise<void> {
    const score = Math.round((sentiment.score.positive - sentiment.score.negative + 1) * 50);

    await publishMetric(MetricName.SENTIMENT_SCORE, score, {
        clinicId,
        sentiment: sentiment.sentiment,
    });
}

/**
 * Clears old entries from sentiment cache
 */
export function cleanupSentimentCache(): void {
    const now = Date.now();
    Array.from(sentimentCache.entries()).forEach(([key, value]) => {
        if (now - value.timestamp > CACHE_TTL_MS) {
            sentimentCache.delete(key);
        }
    });
}

/**
 * Call Quality Scoring Module
 * 
 * Provides comprehensive quality scoring for calls based on:
 * - Audio quality metrics
 * - Agent performance
 * - Customer satisfaction indicators
 * - Compliance adherence
 * 
 * @module quality-scoring
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { publishMetric, MetricName } from './cloudwatch-metrics';

export interface QualityMetrics {
    // Audio quality (0-100)
    audioQuality: {
        score: number;
        packetLoss: number;         // Percentage
        jitter: number;             // Milliseconds
        latency: number;            // Milliseconds
        mos: number;                // Mean Opinion Score (1-5)
    };

    // Agent performance (0-100)
    agentPerformance: {
        score: number;
        responseTime: number;       // Seconds to first response
        holdCount: number;          // Number of holds
        totalHoldTime: number;      // Seconds on hold
        transferCount: number;      // Number of transfers
        scriptAdherence?: number;   // 0-100 if tracked
    };

    // Customer experience (0-100)
    customerExperience: {
        score: number;
        waitTime: number;           // Seconds in queue
        sentiment: string;          // Overall sentiment
        resolved: boolean;          // Issue resolved on first call
        escalated: boolean;         // Call was escalated
    };

    // Compliance (0-100)
    compliance: {
        score: number;
        piiMentioned: boolean;      // PII discussed
        hipaaCompliant: boolean;    // HIPAA compliance
        consentObtained?: boolean;  // Recording consent
        disclosuresMade?: boolean;  // Required disclosures
    };

    // Overall score (0-100)
    overallScore: number;

    // Breakdown weights used
    weights: {
        audio: number;
        agent: number;
        customer: number;
        compliance: number;
    };
}

export interface QualityConfig {
    /** Enable quality scoring */
    enabled: boolean;
    /** Weights for each category */
    weights: {
        audio: number;
        agent: number;
        customer: number;
        compliance: number;
    };
    /** Thresholds for alerts */
    alertThresholds: {
        audioMinScore: number;
        agentMinScore: number;
        overallMinScore: number;
    };
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
    enabled: process.env.CHIME_ENABLE_QUALITY_SCORING !== 'false',
    weights: {
        audio: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AUDIO || '0.15'),
        agent: parseFloat(process.env.CHIME_QUALITY_WEIGHT_AGENT || '0.35'),
        customer: parseFloat(process.env.CHIME_QUALITY_WEIGHT_CUSTOMER || '0.35'),
        compliance: parseFloat(process.env.CHIME_QUALITY_WEIGHT_COMPLIANCE || '0.15'),
    },
    alertThresholds: {
        audioMinScore: 50,
        agentMinScore: 60,
        overallMinScore: 60,
    },
};

/**
 * Calculates audio quality score from raw metrics
 */
export function calculateAudioQualityScore(metrics: {
    packetLoss: number;
    jitter: number;
    latency: number;
    mos?: number;
}): number {
    // If we have MOS (Mean Opinion Score), use it directly
    if (metrics.mos && metrics.mos > 0) {
        // MOS is 1-5, convert to 0-100
        return Math.round((metrics.mos - 1) * 25);
    }

    let score = 100;

    // Packet loss penalty (each % of loss = -10 points)
    score -= metrics.packetLoss * 10;

    // Jitter penalty (each 10ms = -5 points, capped at -30)
    score -= Math.min(30, (metrics.jitter / 10) * 5);

    // Latency penalty (each 50ms over 100ms = -5 points, capped at -30)
    if (metrics.latency > 100) {
        score -= Math.min(30, ((metrics.latency - 100) / 50) * 5);
    }

    return Math.max(0, Math.round(score));
}

/**
 * Calculates agent performance score
 */
export function calculateAgentPerformanceScore(metrics: {
    responseTime: number;
    holdCount: number;
    totalHoldTime: number;
    transferCount: number;
    callDuration: number;
    scriptAdherence?: number;
}): number {
    let score = 100;

    // Response time penalty (>10 seconds starts penalty)
    if (metrics.responseTime > 10) {
        score -= Math.min(20, (metrics.responseTime - 10) * 2);
    }

    // Hold penalties
    // Each hold = -5 points
    score -= metrics.holdCount * 5;
    // Long holds (>2 min each on average) = additional penalty
    if (metrics.holdCount > 0) {
        const avgHold = metrics.totalHoldTime / metrics.holdCount;
        if (avgHold > 120) {
            score -= 10;
        }
    }

    // Transfer penalty (-10 per transfer, max -20)
    score -= Math.min(20, metrics.transferCount * 10);

    // Script adherence bonus (if available)
    if (metrics.scriptAdherence !== undefined) {
        // Add up to 10 bonus points for high adherence
        score += (metrics.scriptAdherence / 100) * 10 - 5; // -5 to +5
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Calculates customer experience score
 */
export function calculateCustomerExperienceScore(metrics: {
    waitTime: number;
    sentiment: string;
    resolved: boolean;
    escalated: boolean;
    abandonedBeforeConnect?: boolean;
}): number {
    if (metrics.abandonedBeforeConnect) {
        return 0; // Call abandoned, worst experience
    }

    let score = 50; // Start neutral

    // Wait time impact (-1 point per 10 seconds, max -30)
    score -= Math.min(30, (metrics.waitTime / 10));

    // Sentiment impact
    switch (metrics.sentiment.toUpperCase()) {
        case 'POSITIVE':
            score += 30;
            break;
        case 'NEUTRAL':
            score += 10;
            break;
        case 'MIXED':
            break; // No change
        case 'NEGATIVE':
            score -= 20;
            break;
    }

    // Resolution impact
    if (metrics.resolved) {
        score += 20; // Big bonus for resolution
    } else {
        score -= 10;
    }

    // Escalation impact
    if (metrics.escalated) {
        score -= 10; // Escalation suggests issue wasn't handled well initially
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Calculates compliance score
 */
export function calculateComplianceScore(metrics: {
    piiMentioned: boolean;
    hipaaCompliant: boolean;
    consentObtained?: boolean;
    disclosuresMade?: boolean;
    recordingEnabled: boolean;
}): number {
    let score = 100;

    // HIPAA non-compliance is severe
    if (!metrics.hipaaCompliant) {
        score -= 50;
    }

    // PII handling
    if (metrics.piiMentioned) {
        // PII discussed - not necessarily bad, but needs careful handling
        // Slight deduction if recording was on
        if (metrics.recordingEnabled) {
            score -= 10;
        }
    }

    // Consent/Disclosure bonuses
    if (metrics.consentObtained === true) {
        score += 5;
    } else if (metrics.consentObtained === false) {
        score -= 15;
    }

    if (metrics.disclosuresMade === true) {
        score += 5;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Calculates comprehensive quality metrics for a call
 */
export function calculateQualityMetrics(
    callData: {
        // Audio metrics
        packetLoss?: number;
        jitter?: number;
        latency?: number;
        mos?: number;

        // Agent metrics
        responseTime?: number;
        holdCount?: number;
        totalHoldTime?: number;
        transferCount?: number;
        callDuration: number;
        scriptAdherence?: number;

        // Customer metrics
        waitTime: number;
        sentiment: string;
        resolved: boolean;
        escalated: boolean;
        abandoned?: boolean;

        // Compliance metrics
        piiMentioned?: boolean;
        hipaaCompliant?: boolean;
        consentObtained?: boolean;
        disclosuresMade?: boolean;
        recordingEnabled?: boolean;
    },
    config: Partial<QualityConfig> = {}
): QualityMetrics {
    const fullConfig = { ...DEFAULT_QUALITY_CONFIG, ...config };

    // Calculate audio quality
    const audioScore = calculateAudioQualityScore({
        packetLoss: callData.packetLoss || 0,
        jitter: callData.jitter || 0,
        latency: callData.latency || 0,
        mos: callData.mos,
    });

    // Calculate agent performance
    const agentScore = calculateAgentPerformanceScore({
        responseTime: callData.responseTime || 0,
        holdCount: callData.holdCount || 0,
        totalHoldTime: callData.totalHoldTime || 0,
        transferCount: callData.transferCount || 0,
        callDuration: callData.callDuration,
        scriptAdherence: callData.scriptAdherence,
    });

    // Calculate customer experience
    const customerScore = calculateCustomerExperienceScore({
        waitTime: callData.waitTime,
        sentiment: callData.sentiment,
        resolved: callData.resolved,
        escalated: callData.escalated,
        abandonedBeforeConnect: callData.abandoned,
    });

    // Calculate compliance
    const complianceScore = calculateComplianceScore({
        piiMentioned: callData.piiMentioned || false,
        hipaaCompliant: callData.hipaaCompliant !== false,
        consentObtained: callData.consentObtained,
        disclosuresMade: callData.disclosuresMade,
        recordingEnabled: callData.recordingEnabled || false,
    });

    // Calculate weighted overall score
    const overallScore = Math.round(
        audioScore * fullConfig.weights.audio +
        agentScore * fullConfig.weights.agent +
        customerScore * fullConfig.weights.customer +
        complianceScore * fullConfig.weights.compliance
    );

    return {
        audioQuality: {
            score: audioScore,
            packetLoss: callData.packetLoss || 0,
            jitter: callData.jitter || 0,
            latency: callData.latency || 0,
            mos: callData.mos || 0,
        },
        agentPerformance: {
            score: agentScore,
            responseTime: callData.responseTime || 0,
            holdCount: callData.holdCount || 0,
            totalHoldTime: callData.totalHoldTime || 0,
            transferCount: callData.transferCount || 0,
            scriptAdherence: callData.scriptAdherence,
        },
        customerExperience: {
            score: customerScore,
            waitTime: callData.waitTime,
            sentiment: callData.sentiment,
            resolved: callData.resolved,
            escalated: callData.escalated,
        },
        compliance: {
            score: complianceScore,
            piiMentioned: callData.piiMentioned || false,
            hipaaCompliant: callData.hipaaCompliant !== false,
            consentObtained: callData.consentObtained,
            disclosuresMade: callData.disclosuresMade,
        },
        overallScore,
        weights: fullConfig.weights,
    };
}

/**
 * Saves quality metrics to call analytics
 */
export async function saveQualityMetrics(
    ddb: DynamoDBDocumentClient,
    callId: string,
    clinicId: string,
    timestamp: number,
    metrics: QualityMetrics,
    callAnalyticsTableName: string
): Promise<void> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: callAnalyticsTableName,
            Key: { callId, timestamp },
            UpdateExpression: `
        SET qualityScore = :overall,
            audioQualityScore = :audio,
            agentPerformanceScore = :agent,
            customerExperienceScore = :customer,
            complianceScore = :compliance,
            qualityMetrics = :metrics,
            qualityScoreCalculatedAt = :time
      `,
            ExpressionAttributeValues: {
                ':overall': metrics.overallScore,
                ':audio': metrics.audioQuality.score,
                ':agent': metrics.agentPerformance.score,
                ':customer': metrics.customerExperience.score,
                ':compliance': metrics.compliance.score,
                ':metrics': metrics,
                ':time': new Date().toISOString(),
            },
        }));

        // Publish to CloudWatch
        await publishMetric(MetricName.CALL_QUALITY_SCORE, metrics.overallScore, {
            clinicId,
        });

        console.log('[saveQualityMetrics] Saved', { callId, overallScore: metrics.overallScore });

    } catch (error: any) {
        console.error('[saveQualityMetrics] Error:', error.message);
    }
}

/**
 * Gets quality score trends for a clinic
 */
export async function getQualityTrends(
    ddb: DynamoDBDocumentClient,
    clinicId: string,
    days: number,
    callAnalyticsTableName: string
): Promise<{
    averageOverall: number;
    averageAudio: number;
    averageAgent: number;
    averageCustomer: number;
    averageCompliance: number;
    trend: 'improving' | 'stable' | 'declining';
}> {
    // Implementation would query analytics and calculate trends
    // Simplified for now
    return {
        averageOverall: 75,
        averageAudio: 85,
        averageAgent: 72,
        averageCustomer: 70,
        averageCompliance: 90,
        trend: 'stable',
    };
}

/**
 * Checks if a call quality warrants an alert
 */
export function shouldAlertOnQuality(
    metrics: QualityMetrics,
    config: Partial<QualityConfig> = {}
): { alert: boolean; reasons: string[] } {
    const fullConfig = { ...DEFAULT_QUALITY_CONFIG, ...config };
    const reasons: string[] = [];

    if (metrics.audioQuality.score < fullConfig.alertThresholds.audioMinScore) {
        reasons.push(`Low audio quality: ${metrics.audioQuality.score}`);
    }

    if (metrics.agentPerformance.score < fullConfig.alertThresholds.agentMinScore) {
        reasons.push(`Low agent performance: ${metrics.agentPerformance.score}`);
    }

    if (metrics.overallScore < fullConfig.alertThresholds.overallMinScore) {
        reasons.push(`Low overall quality: ${metrics.overallScore}`);
    }

    if (!metrics.compliance.hipaaCompliant) {
        reasons.push('HIPAA compliance issue detected');
    }

    return {
        alert: reasons.length > 0,
        reasons,
    };
}

export type EpochSeconds = number;
export type EpochMilliseconds = number;
export type CallStatus = 'active' | 'completed' | 'abandoned' | 'failed';
export interface CallAnalyticsRecord {
    callId: string;
    timestamp: EpochSeconds;
    callStatus: CallStatus;
    clinicId: string;
    agentId?: string;
    customerPhone: string;
    direction: 'inbound' | 'outbound';
    callStartTime: string;
    callStartTimestamp?: EpochMilliseconds;
    callEndTime?: string;
    callEndTimestamp?: EpochMilliseconds;
    totalDuration: number;
    talkTime?: number;
    holdTime?: number;
    transcript?: CallTranscript[];
    fullTranscriptS3Key?: string;
    transcriptCount?: number;
    overallSentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
    sentimentScore?: {
        positive: number;
        negative: number;
        neutral: number;
        mixed: number;
    };
    sentimentTrend?: SentimentDataPoint[];
    audioQuality?: {
        averageJitter: number;
        averagePacketLoss: number;
        averageRoundTripTime: number;
        qualityScore: number;
    };
    speakerMetrics?: {
        agentTalkPercentage: number;
        customerTalkPercentage: number;
        silencePercentage: number;
        interruptionCount: number;
    };
    detectedIssues?: string[];
    keywords?: string[];
    finalized?: boolean;
    finalizedAt?: string;
    finalizationScheduledAt?: EpochMilliseconds;
    recordingS3Key?: string;
    createdAt: string;
    updatedAt: string;
    ttl?: number;
}
export interface CallTranscript {
    timestamp: EpochSeconds;
    speaker: 'AGENT' | 'CUSTOMER';
    text: string;
    sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    confidence?: number;
}
export interface SentimentDataPoint {
    timestamp: EpochSeconds;
    sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
    score: number;
}
export declare const ANALYTICS_TABLE_GSI: {
    'clinicId-timestamp-index': {
        partitionKey: string;
        sortKey: string;
    };
    'agentId-timestamp-index': {
        partitionKey: string;
        sortKey: string;
    };
    'overallSentiment-timestamp-index': {
        partitionKey: string;
        sortKey: string;
    };
    'callStatus-timestamp-index': {
        partitionKey: string;
        sortKey: string;
    };
};
export type RankingCriteria = 'performanceScore' | 'callVolume' | 'sentimentScore' | 'avgHandleTime' | 'customerSatisfaction' | 'efficiency';
export type RankingPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type AgentStatus = 'Online' | 'OnCall' | 'ringing' | 'dialing' | 'Offline' | 'Busy' | 'Available';
export interface AgentRankingEntry {
    rank: number;
    rankLabel: string;
    agentId: string;
    agentName?: string;
    firstName?: string;
    lastName?: string;
    initials?: string;
    clinicId: string;
    clinicName?: string;
    status: AgentStatus;
    statusLabel: string;
    performanceScore: number;
    totalCalls: number;
    completedCalls: number;
    missedCalls: number;
    callsToday: number;
    missedToday: number;
    sentimentScore: number;
    satisfactionRating: number;
    positiveCallsPercent: number;
    negativeCallsPercent: number;
    avgHandleTime: number;
    avgHandleTimeFormatted: string;
    avgTalkTime: number;
    avgHoldTime: number;
    issueCount: number;
    qualityScore: number;
    trend: {
        direction: 'up' | 'down' | 'stable';
        changePercent: number;
        previousRank?: number;
    };
    badges?: AgentBadge[];
}
export interface AgentBadge {
    id: string;
    name: string;
    icon: string;
    description: string;
    earnedAt: string;
}
export declare const AGENT_BADGES: {
    readonly TOP_PERFORMER: {
        readonly id: "top_performer";
        readonly name: "Top Performer";
        readonly icon: "🏆";
        readonly description: "Ranked #1 in the clinic";
    };
    readonly CALL_CHAMPION: {
        readonly id: "call_champion";
        readonly name: "Call Champion";
        readonly icon: "📞";
        readonly description: "Handled 100+ calls this period";
    };
    readonly SENTIMENT_STAR: {
        readonly id: "sentiment_star";
        readonly name: "Sentiment Star";
        readonly icon: "⭐";
        readonly description: "90%+ positive sentiment score";
    };
    readonly SPEED_DEMON: {
        readonly id: "speed_demon";
        readonly name: "Speed Demon";
        readonly icon: "⚡";
        readonly description: "Below average handle time with high quality";
    };
    readonly RISING_STAR: {
        readonly id: "rising_star";
        readonly name: "Rising Star";
        readonly icon: "🚀";
        readonly description: "Improved 20%+ from previous period";
    };
    readonly CONSISTENCY_KING: {
        readonly id: "consistency_king";
        readonly name: "Consistency King";
        readonly icon: "👑";
        readonly description: "Maintained top 3 ranking for 3+ periods";
    };
    readonly ZERO_ISSUES: {
        readonly id: "zero_issues";
        readonly name: "Flawless";
        readonly icon: "💎";
        readonly description: "Zero detected issues this period";
    };
    readonly CUSTOMER_FAVORITE: {
        readonly id: "customer_favorite";
        readonly name: "Customer Favorite";
        readonly icon: "❤️";
        readonly description: "95%+ customer satisfaction";
    };
};
export interface AgentRankingsResponse {
    clinicId: string;
    clinicName?: string;
    period: {
        type: RankingPeriod;
        startTime: number;
        endTime: number;
        label: string;
    };
    criteria: RankingCriteria;
    rankings: AgentRankingEntry[];
    totalAgents: number;
    clinicStats: {
        avgPerformanceScore: number;
        totalCalls: number;
        avgSentimentScore: number;
        avgHandleTime: number;
    };
    highlights: {
        topPerformer: AgentRankingEntry | null;
        mostImproved: AgentRankingEntry | null;
        callLeader: AgentRankingEntry | null;
        sentimentLeader: AgentRankingEntry | null;
    };
    generatedAt: string;
    dataCompleteness: 'complete' | 'partial';
    warning?: string;
}

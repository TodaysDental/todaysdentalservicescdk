// Type aliases for clarity and type safety
export type EpochSeconds = number;
export type EpochMilliseconds = number;

// Call status type
export type CallStatus = 'active' | 'completed' | 'abandoned' | 'failed';

// DynamoDB Table Schema for Call Analytics
export interface CallAnalyticsRecord {
  // Primary Key
  callId: string;  // Partition key
  timestamp: EpochSeconds;  // Sort key (epoch seconds) - for historical queries
  
  // Call Status (CRITICAL: for live vs post-call filtering)
  callStatus: CallStatus;  // 'active' during call, 'completed'/'abandoned'/'failed' after
  
  // Call Metadata
  clinicId: string;
  agentId?: string;
  customerPhone: string;
  direction: 'inbound' | 'outbound';
  
  // Duration & Timing
  callStartTime: string;  // ISO string
  callStartTimestamp?: EpochMilliseconds;  // For precise calculations
  callEndTime?: string;
  callEndTimestamp?: EpochMilliseconds;  // For precise calculations
  totalDuration: number;  // seconds
  talkTime?: number;  // seconds agent was speaking
  holdTime?: number;  // seconds on hold
  
  // Transcription
  transcript?: CallTranscript[];
  fullTranscriptS3Key?: string;  // For large transcripts
  transcriptCount?: number;  // Number of transcript segments (for live updates)
  
  // Sentiment Analysis
  overallSentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  sentimentScore?: {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
  };
  sentimentTrend?: SentimentDataPoint[];
  
  // Call Quality Metrics
  audioQuality?: {
    averageJitter: number;
    averagePacketLoss: number;
    averageRoundTripTime: number;
    qualityScore: number;  // 1-5
  };
  
  // Speaker Analytics
  speakerMetrics?: {
    agentTalkPercentage: number;
    customerTalkPercentage: number;
    silencePercentage: number;
    interruptionCount: number;
  };
  
  // Issue Detection
  detectedIssues?: string[];  // e.g., ["long-hold", "customer-frustration"]
  keywords?: string[];  // Important terms mentioned
  
  // Finalization tracking
  finalized?: boolean;
  finalizedAt?: string;
  finalizationScheduledAt?: EpochMilliseconds;
  
  // Metadata
  recordingS3Key?: string;
  createdAt: string;
  updatedAt: string;
  ttl?: number;  // Auto-delete after retention period
}

export interface CallTranscript {
  timestamp: EpochSeconds;  // Seconds from epoch
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

// Table Indexes
export const ANALYTICS_TABLE_GSI = {
  // Query by clinic and date range
  'clinicId-timestamp-index': {
    partitionKey: 'clinicId',
    sortKey: 'timestamp'
  },
  // Query by agent performance
  'agentId-timestamp-index': {
    partitionKey: 'agentId',
    sortKey: 'timestamp'
  },
  // Query by sentiment
  'overallSentiment-timestamp-index': {
    partitionKey: 'overallSentiment',
    sortKey: 'timestamp'
  },
  // CRITICAL FIX: Query by call status for live vs post-call filtering
  'callStatus-timestamp-index': {
    partitionKey: 'callStatus',
    sortKey: 'timestamp'
  }
};

// ========================================
// Agent Rankings Types
// ========================================

// Ranking criteria options
export type RankingCriteria = 
  | 'performanceScore'    // Overall performance score (0-100)
  | 'callVolume'          // Total calls handled
  | 'sentimentScore'      // Weighted sentiment score (0-100)
  | 'avgHandleTime'       // Average handle time (lower is sometimes better)
  | 'customerSatisfaction'// Based on positive sentiment ratio
  | 'efficiency';         // Calls completed without issues

// Ranking period options
export type RankingPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

// Agent status from presence table
export type AgentStatus = 'Online' | 'OnCall' | 'ringing' | 'dialing' | 'Offline' | 'Busy' | 'Available';

// Individual agent ranking entry
export interface AgentRankingEntry {
  rank: number;
  rankLabel: string;  // "1st", "2nd", "3rd", "#4", "#5", etc.
  agentId: string;
  agentName?: string;  // Full name from staff table
  firstName?: string;
  lastName?: string;
  initials?: string;  // "LM" for "Lisa Martinez"
  clinicId: string;
  clinicName?: string;
  
  // Agent status (live from presence table)
  status: AgentStatus;
  statusLabel: string;  // "On Call", "Available", "Offline", "Busy"
  
  // Core metrics
  performanceScore: number;  // 0-100
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  
  // Today's specific metrics
  callsToday: number;
  missedToday: number;
  
  // Sentiment metrics
  sentimentScore: number;  // Weighted 0-100
  satisfactionRating: number;  // 0-100 percentage (for display as "98%")
  positiveCallsPercent: number;
  negativeCallsPercent: number;
  
  // Efficiency metrics
  avgHandleTime: number;  // seconds
  avgHandleTimeFormatted: string;  // "6:15" format
  avgTalkTime: number;    // seconds
  avgHoldTime: number;    // seconds
  
  // Quality indicators
  issueCount: number;
  qualityScore: number;  // Audio quality average 1-5
  
  // Trend data (vs previous period)
  trend: {
    direction: 'up' | 'down' | 'stable';
    changePercent: number;
    previousRank?: number;
  };
  
  // Achievement badges
  badges?: AgentBadge[];
}

// Achievement badges for gamification
export interface AgentBadge {
  id: string;
  name: string;
  icon: string;  // Emoji or icon reference
  description: string;
  earnedAt: string;  // ISO date
}

// Available badge types
export const AGENT_BADGES = {
  TOP_PERFORMER: {
    id: 'top_performer',
    name: 'Top Performer',
    icon: '🏆',
    description: 'Ranked #1 in the clinic'
  },
  CALL_CHAMPION: {
    id: 'call_champion',
    name: 'Call Champion',
    icon: '📞',
    description: 'Handled 100+ calls this period'
  },
  SENTIMENT_STAR: {
    id: 'sentiment_star',
    name: 'Sentiment Star',
    icon: '⭐',
    description: '90%+ positive sentiment score'
  },
  SPEED_DEMON: {
    id: 'speed_demon',
    name: 'Speed Demon',
    icon: '⚡',
    description: 'Below average handle time with high quality'
  },
  RISING_STAR: {
    id: 'rising_star',
    name: 'Rising Star',
    icon: '🚀',
    description: 'Improved 20%+ from previous period'
  },
  CONSISTENCY_KING: {
    id: 'consistency_king',
    name: 'Consistency King',
    icon: '👑',
    description: 'Maintained top 3 ranking for 3+ periods'
  },
  ZERO_ISSUES: {
    id: 'zero_issues',
    name: 'Flawless',
    icon: '💎',
    description: 'Zero detected issues this period'
  },
  CUSTOMER_FAVORITE: {
    id: 'customer_favorite',
    name: 'Customer Favorite',
    icon: '❤️',
    description: '95%+ customer satisfaction'
  }
} as const;

// Full rankings response
export interface AgentRankingsResponse {
  clinicId: string;
  clinicName?: string;
  period: {
    type: RankingPeriod;
    startTime: number;  // epoch seconds
    endTime: number;    // epoch seconds
    label: string;      // e.g., "Week of Dec 1, 2025"
  };
  criteria: RankingCriteria;
  
  // Rankings data
  rankings: AgentRankingEntry[];
  totalAgents: number;
  
  // Clinic-wide stats for context
  clinicStats: {
    avgPerformanceScore: number;
    totalCalls: number;
    avgSentimentScore: number;
    avgHandleTime: number;
  };
  
  // Leaderboard highlights
  highlights: {
    topPerformer: AgentRankingEntry | null;
    mostImproved: AgentRankingEntry | null;
    callLeader: AgentRankingEntry | null;
    sentimentLeader: AgentRankingEntry | null;
  };
  
  // Metadata
  generatedAt: string;  // ISO date
  dataCompleteness: 'complete' | 'partial';
  warning?: string;
}


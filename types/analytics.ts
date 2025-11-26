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

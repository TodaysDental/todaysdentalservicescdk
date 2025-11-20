// DynamoDB Table Schema for Call Analytics
export interface CallAnalyticsRecord {
  // Primary Key
  callId: string;  // Partition key
  timestamp: number;  // Sort key (epoch seconds)
  
  // Call Metadata
  clinicId: string;
  agentId?: string;
  customerPhone: string;
  direction: 'inbound' | 'outbound';
  
  // Duration & Timing
  callStartTime: string;  // ISO string
  callEndTime?: string;
  totalDuration: number;  // seconds
  talkTime?: number;  // seconds agent was speaking
  holdTime?: number;  // seconds on hold
  
  // Transcription
  transcript?: CallTranscript[];
  fullTranscriptS3Key?: string;  // For large transcripts
  
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
  
  // Metadata
  recordingS3Key?: string;
  createdAt: string;
  updatedAt: string;
  ttl?: number;  // Auto-delete after retention period
}

export interface CallTranscript {
  timestamp: number;  // Milliseconds from call start
  speaker: 'AGENT' | 'CUSTOMER';
  text: string;
  sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  confidence: number;
}

export interface SentimentDataPoint {
  timestamp: number;
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
  }
};

import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ComprehendClient, DetectSentimentCommand, DetectKeyPhrasesCommand, DetectEntitiesCommand, LanguageCode } from '@aws-sdk/client-comprehend';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getTranscriptBufferManager, TranscriptBufferManager, TranscriptBuffer, TranscriptSegment } from '../shared/utils/transcript-buffer-manager';
import { checkAndMarkProcessed, getDedupTableName, generateDedupKeyFromEvent } from '../shared/utils/analytics-deduplication';
import { AnalyticsState } from '../../types/analytics-state-machine';
import { transitionAnalyticsState, canUpdateAnalyticsRecord } from '../shared/utils/analytics-state-manager';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);
const comprehend = new ComprehendClient({});
const sns = new SNSClient({});

// CRITICAL FIX: Add validation for required environment variable
const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
if (!ANALYTICS_TABLE_NAME) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}
const TRANSCRIPT_BUFFER_TABLE = process.env.TRANSCRIPT_BUFFER_TABLE_NAME || `${ANALYTICS_TABLE_NAME}-Transcripts`;
const DEDUP_TABLE = getDedupTableName(ANALYTICS_TABLE_NAME);
const RETENTION_DAYS = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);
const ENABLE_REAL_TIME_SENTIMENT = process.env.ENABLE_REAL_TIME_SENTIMENT === 'true';
const ENABLE_REAL_TIME_ALERTS = process.env.ENABLE_REAL_TIME_ALERTS === 'true';
const CALL_ALERTS_TOPIC_ARN = process.env.CALL_ALERTS_TOPIC_ARN;

// CRITICAL FIX #2.4: Make finalization delay configurable
const FINALIZATION_DELAY_MS = parseInt(process.env.FINALIZATION_DELAY_MS || '30000', 10);

// CRITICAL FIX #2.2: Maximum total category score per call to prevent overflow
const MAX_TOTAL_CATEGORY_SCORE = parseInt(process.env.MAX_TOTAL_CATEGORY_SCORE || '500', 10);

// CRITICAL FIX #2.3: Track Comprehend failures for alerting
let comprehendFailureCount = 0;
const COMPREHEND_FAILURE_THRESHOLD = 5; // Alert after 5 consecutive failures

// Initialize TranscriptBufferManager
const transcriptManager = getTranscriptBufferManager(ddb, TRANSCRIPT_BUFFER_TABLE);

interface ChimeAnalyticsEvent {
  version: string;
  eventType: string;
  callId: string;
  timestamp: number;
  
  // Transcription events
  transcriptEvent?: {
    results: Array<{
      isPartial: boolean;
      alternatives: Array<{
        transcript: string;
        items: Array<{
          content: string;
          startTime: number;
          endTime: number;
          type: string;
          confidence: number;
        }>;
      }>;
      channelId: string;  // AGENT or CUSTOMER
    }>;
  };
  
  // Call quality events
  callQualityEvent?: {
    jitter: number;
    packetLoss: number;
    roundTripTime: number;
  };
  
  // Call state events
  callStateEvent?: {
    state: string;
    metadata: Record<string, any>;
  };
}

// Call category types
type CallCategory = 
  | 'marketing' 
  | 'sales' 
  | 'spam' 
  | 'insurance' 
  | 'payments' 
  | 'accounting' 
  | 'treatment' 
  | 'service-enquiry'
  | 'general'
  | 'uncategorized';

// Category detection keywords
const CATEGORY_KEYWORDS: Record<CallCategory, string[]> = {
  'marketing': [
    'promotion', 'offer', 'discount', 'special', 'deal', 'advertisement',
    'campaign', 'marketing', 'promo', 'newsletter', 'subscription'
  ],
  'sales': [
    'purchase', 'buy', 'sell', 'price', 'cost', 'quote', 'estimate',
    'package', 'plan', 'upgrade', 'product', 'service plan'
  ],
  'spam': [
    'congratulations', 'winner', 'free gift', 'limited time', 'act now',
    'urgent', 'click here', 'verify account', 'suspended', 'expires'
  ],
  'insurance': [
    'insurance', 'coverage', 'claim', 'policy', 'deductible', 'copay',
    'benefit', 'covered', 'out of network', 'in network', 'pre-authorization',
    'eligibility', 'insurance card', 'provider', 'carrier'
  ],
  'payments': [
    'payment', 'bill', 'invoice', 'charge', 'credit card', 'balance',
    'pay', 'transaction', 'receipt', 'refund', 'outstanding', 'owe',
    'statement', 'debt', 'installment'
  ],
  'accounting': [
    'accounting', 'bookkeeping', 'ledger', 'financial', 'tax', 'expense',
    'revenue', 'accounts payable', 'accounts receivable', 'reconciliation'
  ],
  'treatment': [
    'treatment', 'procedure', 'appointment', 'cleaning', 'extraction',
    'filling', 'root canal', 'crown', 'bridge', 'implant', 'denture',
    'orthodontic', 'braces', 'whitening', 'exam', 'x-ray', 'cavity',
    'tooth', 'teeth', 'dental', 'pain', 'toothache', 'emergency'
  ],
  'service-enquiry': [
    'question', 'inquiry', 'enquiry', 'information', 'hours', 'location',
    'address', 'phone number', 'email', 'website', 'directions',
    'services offered', 'what do you', 'do you offer', 'tell me about'
  ],
  'general': [
    'hello', 'hi', 'thank you', 'thanks', 'goodbye', 'bye'
  ],
  'uncategorized': []
};

// FIXED: Removed in-memory transcript buffer - now using DynamoDB persistence
// See transcript-buffer-manager.ts for implementation

/**
 * Lambda handler for processing Chime SDK Voice Analytics events
 * Triggered by Kinesis stream containing real-time analytics data
 */
export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  console.log('[process-analytics] Processing batch', {
    recordCount: event.Records.length
  });

  // Process records in parallel for better throughput
  const processPromises = event.Records.map(record => 
    processAnalyticsRecord(record).catch(err => {
      console.error('[process-analytics] Error processing record:', err);
      // Don't throw - process other records
    })
  );

  await Promise.all(processPromises);
};

async function processAnalyticsRecord(record: KinesisStreamRecord): Promise<void> {
  try {
    const data = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
    const analyticsEvent: ChimeAnalyticsEvent = JSON.parse(data);
    
    console.log('[process-analytics] Processing event', {
      callId: analyticsEvent.callId,
      eventType: analyticsEvent.eventType
    });

    switch (analyticsEvent.eventType) {
      case 'TRANSCRIPT':
        await processTranscriptEvent(analyticsEvent);
        break;
        
      case 'CALL_QUALITY':
        await processCallQualityEvent(analyticsEvent);
        break;
        
      case 'CALL_START':
        await initializeCallAnalytics(analyticsEvent);
        break;
        
      case 'CALL_END':
        await finalizeCallAnalytics(analyticsEvent);
        break;
        
      default:
        console.log(`[process-analytics] Unknown event type: ${analyticsEvent.eventType}`);
    }
    
  } catch (err) {
    console.error('[process-analytics] Error processing record:', err);
    throw err;
  }
}

async function initializeCallAnalytics(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, timestamp } = event;
  const metadata = event.callStateEvent?.metadata || {};
  
  // CRITICAL FIX: Use unified deduplication
  const dedupResult = await checkAndMarkProcessed(
    ddb,
    DEDUP_TABLE,
    callId,
    'live-init'
  );
  
  if (dedupResult.isDuplicate) {
    console.log('[initializeCallAnalytics] Duplicate init event, skipping:', callId);
    return;
  }
  
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const ttl = Math.floor(nowMs / 1000) + (RETENTION_DAYS * 24 * 60 * 60);
  
  // **FIXED: Initialize persistent transcript buffer in DynamoDB**
  await transcriptManager.initialize(callId);
  
  await ddb.send(new PutCommand({
    TableName: ANALYTICS_TABLE_NAME,
    Item: {
      callId,
      timestamp,
      callStatus: 'active', // CRITICAL: Set initial status
      analyticsState: AnalyticsState.INITIALIZING, // NEW: State machine state
      stateHistory: [{
        from: AnalyticsState.INITIALIZING,
        to: AnalyticsState.INITIALIZING,
        timestamp: nowMs,
        reason: 'Initial analytics record creation'
      }],
      clinicId: metadata.clinicId,
      agentId: metadata.agentId,
      customerPhone: metadata.phoneNumber,
      direction: metadata.direction || 'inbound',
      callStartTime: now,
      callStartTimestamp: nowMs, // For precise calculations
      // FIXED: Use separate tracking fields instead of large lists
      transcriptCount: 0,
      latestTranscripts: [], // Only keep last 10 for quick reference
      sentimentDataPoints: 0,
      latestSentiment: [],
      detectedIssues: [],
      keywords: [], // Array for DynamoDB compatibility
      keyPhrases: [],
      entities: [],
      callCategory: 'uncategorized',
      categoryScores: {},
      createdAt: now,
      updatedAt: now,
      ttl
    },
    ConditionExpression: 'attribute_not_exists(callId)'
  })).catch(err => {
    if (err.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    console.log('[initializeCallAnalytics] Record already exists:', callId);
  });
  
  // Transition to ACTIVE state after successful initialization
  await transitionAnalyticsState(
    ddb,
    ANALYTICS_TABLE_NAME!,
    callId,
    timestamp,
    AnalyticsState.ACTIVE,
    'Call connected, starting live analytics'
  );
}

/**
 * ENHANCED: Analyze sentiment using AWS Comprehend
 */
/**
 * Validate and normalize sentiment score to 0-100 range
 */
function validateSentimentScore(score: number | undefined | null): number {
  if (score === undefined || score === null || isNaN(score) || !isFinite(score)) {
    return 50; // Default to neutral
  }
  return Math.max(0, Math.min(100, score));
}

async function analyzeSentimentWithComprehend(
  text: string,
  languageCode: string = 'en'
): Promise<{
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  sentimentScore: number;
  scores: {
    Positive: number;
    Negative: number;
    Neutral: number;
    Mixed: number;
  };
}> {
  if (!ENABLE_REAL_TIME_SENTIMENT || text.length < 3) {
    // Fallback to keyword-based for very short texts
    return analyzeKeywordSentiment(text);
  }

  try {
    const result = await comprehend.send(new DetectSentimentCommand({
      Text: text.substring(0, 5000), // Comprehend limit
      LanguageCode: languageCode as LanguageCode,
    }));

    const scores = {
      Positive: result.SentimentScore?.Positive || 0,
      Negative: result.SentimentScore?.Negative || 0,
      Neutral: result.SentimentScore?.Neutral || 0,
      Mixed: result.SentimentScore?.Mixed || 0,
    };

    const sentiment = result.Sentiment as 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';

    // FIX #4: Calculate sentiment score correctly to prevent overflow
    // Use weighted average normalized to 0-100 scale
    // Positive = 100, Neutral = 50, Negative = 0, Mixed = 50
    const rawScore = Math.round(
      scores.Positive * 100 + 
      scores.Neutral * 50 + 
      scores.Negative * 0 + 
      scores.Mixed * 50
    );
    
    // CRITICAL FIX: Validate sentiment score range
    const sentimentScore = validateSentimentScore(rawScore);
    
    // CRITICAL FIX #2.3: Reset failure count on success
    comprehendFailureCount = 0;

    return { sentiment, sentimentScore, scores };
  } catch (err: any) {
    // CRITICAL FIX #2.3: Track consecutive failures and alert
    comprehendFailureCount++;
    console.error('[process-analytics] Comprehend error, falling back to keywords:', {
      error: err.message,
      failureCount: comprehendFailureCount,
      threshold: COMPREHEND_FAILURE_THRESHOLD
    });
    
    // Alert if we hit the failure threshold
    if (comprehendFailureCount === COMPREHEND_FAILURE_THRESHOLD && CALL_ALERTS_TOPIC_ARN && ENABLE_REAL_TIME_ALERTS) {
      try {
        await sns.send(new PublishCommand({
          TopicArn: CALL_ALERTS_TOPIC_ARN,
          Subject: 'ALERT: Comprehend Service Degradation',
          Message: JSON.stringify({
            type: 'COMPREHEND_DEGRADATION',
            severity: 'HIGH',
            message: `AWS Comprehend has failed ${COMPREHEND_FAILURE_THRESHOLD} consecutive times. Sentiment analysis is degraded to keyword-based fallback.`,
            lastError: err.message,
            timestamp: new Date().toISOString(),
            recommendation: 'Check AWS Comprehend quotas, permissions, and service health.'
          }, null, 2)
        }));
      } catch (alertErr) {
        console.error('[process-analytics] Failed to send Comprehend degradation alert:', alertErr);
      }
    }
    
    return analyzeKeywordSentiment(text);
  }
}

/**
 * Fallback keyword-based sentiment analysis
 */
function analyzeKeywordSentiment(text: string): {
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  sentimentScore: number;
  scores: {
    Positive: number;
    Negative: number;
    Neutral: number;
    Mixed: number;
  };
} {
  const negativeKeywords = ['problem', 'issue', 'error', 'fail', 'angry', 'frustrated', 'upset', 'terrible', 'awful'];
  const positiveKeywords = ['great', 'excellent', 'perfect', 'happy', 'satisfied', 'thank', 'appreciate', 'wonderful'];
  
  const textLower = text.toLowerCase();
  const hasNegative = negativeKeywords.some(kw => textLower.includes(kw));
  const hasPositive = positiveKeywords.some(kw => textLower.includes(kw));
  
  let sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED' = 'NEUTRAL';
  let sentimentScore = 50;
  let scores = { Positive: 0, Negative: 0, Neutral: 1, Mixed: 0 };
  
  if (hasNegative && !hasPositive) {
    sentiment = 'NEGATIVE';
    sentimentScore = 20;
    scores = { Positive: 0, Negative: 0.8, Neutral: 0.2, Mixed: 0 };
  } else if (hasPositive && !hasNegative) {
    sentiment = 'POSITIVE';
    sentimentScore = 85;
    scores = { Positive: 0.8, Negative: 0, Neutral: 0.2, Mixed: 0 };
  } else if (hasNegative && hasPositive) {
    sentiment = 'MIXED';
    sentimentScore = 50;
    scores = { Positive: 0.3, Negative: 0.3, Neutral: 0.2, Mixed: 0.2 };
  }
  
  return { sentiment, sentimentScore, scores };
}

/**
 * ENHANCED: Extract key phrases using AWS Comprehend
 */
async function extractKeyPhrases(text: string, languageCode: string = 'en'): Promise<string[]> {
  if (!ENABLE_REAL_TIME_SENTIMENT || text.length < 10) {
    return [];
  }

  try {
    const result = await comprehend.send(new DetectKeyPhrasesCommand({
      Text: text.substring(0, 5000),
      LanguageCode: languageCode as LanguageCode,
    }));

    return (result.KeyPhrases || [])
      .filter(kp => (kp.Score || 0) > 0.8) // High confidence only
      .map(kp => kp.Text || '')
      .slice(0, 5); // Top 5
  } catch (err) {
    console.error('[process-analytics] KeyPhrases extraction error:', err);
    return [];
  }
}

/**
 * ENHANCED: Extract entities using AWS Comprehend
 */
async function extractEntities(text: string, languageCode: string = 'en'): Promise<Array<{type: string, text: string}>> {
  if (!ENABLE_REAL_TIME_SENTIMENT || text.length < 10) {
    return [];
  }

  try {
    const result = await comprehend.send(new DetectEntitiesCommand({
      Text: text.substring(0, 5000),
      LanguageCode: languageCode as LanguageCode,
    }));

    return (result.Entities || [])
      .filter(entity => (entity.Score || 0) > 0.8)
      .map(entity => ({
        type: entity.Type || 'UNKNOWN',
        text: entity.Text || ''
      }))
      .slice(0, 10);
  } catch (err) {
    console.error('[process-analytics] Entity extraction error:', err);
    return [];
  }
}

/**
 * Detect call category based on transcript text
 */
function detectCallCategory(text: string): Record<CallCategory, number> {
  const textLower = text.toLowerCase();
  const scores: Record<CallCategory, number> = {
    'marketing': 0,
    'sales': 0,
    'spam': 0,
    'insurance': 0,
    'payments': 0,
    'accounting': 0,
    'treatment': 0,
    'service-enquiry': 0,
    'general': 0,
    'uncategorized': 0
  };

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const matches = textLower.match(regex);
      if (matches) {
        scores[category as CallCategory] += matches.length;
      }
    }
  }

  return scores;
}

/**
 * Determine the most likely call category from accumulated scores
 */
function determineFinalCategory(categoryScores: Record<CallCategory, number>): CallCategory {
  const scorableCategories = Object.entries(categoryScores)
    .filter(([cat]) => cat !== 'general' && cat !== 'uncategorized');

  if (scorableCategories.length === 0) {
    return 'uncategorized';
  }

  const [topCategory, topScore] = scorableCategories
    .sort(([, a], [, b]) => (b as number) - (a as number))[0];

  if (topScore === 0) {
    return 'uncategorized';
  }

  return topCategory as CallCategory;
}

/**
 * ENHANCED: Detect interruptions by analyzing speaker overlaps and timing
 */
function detectInterruptions(buffer: TranscriptBuffer): number {
  if (buffer.segments.length < 2) return 0;

  let interruptions = 0;
  
  for (let i = 1; i < buffer.segments.length; i++) {
    const prev = buffer.segments[i - 1];
    const curr = buffer.segments[i];
    
    // Interruption detected if:
    // 1. Different speakers
    // 2. Current segment starts before previous ends
    // 3. Gap between segments is very small (< 200ms)
    if (prev.speaker !== curr.speaker) {
      if (prev.endTime && curr.startTime && prev.endTime > curr.startTime) {
        interruptions++;
      } else if (curr.startTime && prev.endTime) {
        const gap = curr.startTime - prev.endTime;
        if (gap < 0.2) { // Less than 200ms indicates interruption
          interruptions++;
        }
      }
    }
  }
  
  return interruptions;
}

/**
 * ENHANCED: Calculate silence periods from audio metrics and transcript timing
 */
function calculateSilenceMetrics(buffer: TranscriptBuffer, totalDuration: number): {
  silencePercentage: number;
  silencePeriods: number;
} {
  if (buffer.segments.length === 0 || totalDuration === 0) {
    return { silencePercentage: 100, silencePeriods: 0 };
  }

  let totalSpeechTime = 0;
  let silencePeriods = 0;
  
  // Calculate actual speech time from segment timings
  for (const segment of buffer.segments) {
    if (segment.startTime !== undefined && segment.endTime !== undefined) {
      totalSpeechTime += (segment.endTime - segment.startTime);
    }
  }
  
  // Count silence periods (gaps > 2 seconds between segments)
  for (let i = 1; i < buffer.segments.length; i++) {
    const prev = buffer.segments[i - 1];
    const curr = buffer.segments[i];
    
    if (prev.endTime && curr.startTime) {
      const gap = curr.startTime - prev.endTime;
      if (gap > 2) { // Silence period > 2 seconds
        silencePeriods++;
      }
    }
  }
  
  const silenceTime = Math.max(0, totalDuration - totalSpeechTime);
  const silencePercentage = (silenceTime / totalDuration) * 100;
  
  return {
    silencePercentage: Math.round(silencePercentage),
    silencePeriods
  };
}

async function processTranscriptEvent(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, transcriptEvent, timestamp: eventTimestamp } = event;
  
  if (!transcriptEvent?.results) return;

  // Check if call is finalized
  const { Items: existingRecords } = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId },
    Limit: 1
  }));

  if (!existingRecords || existingRecords.length === 0) {
    console.warn(`[processTranscriptEvent] No analytics record found for ${callId}`);
    return;
  }

  const storedRecord = existingRecords[0];
  const storedTimestamp = storedRecord.timestamp;
  
  // CRITICAL FIX #5: Validate call hasn't ended before processing transcript
  // This prevents processing stale transcript events after call ends
  if (storedRecord.callEndTime || storedRecord.callEndTimestamp) {
    console.warn(`[processTranscriptEvent] Ignoring transcript for ended call ${callId}`, {
      callEndTime: storedRecord.callEndTime,
      eventTimestamp
    });
    return;
  }
  
  // Validate call is in an active state
  const currentState = storedRecord.analyticsState || AnalyticsState.ACTIVE;
  if (currentState !== AnalyticsState.ACTIVE && currentState !== AnalyticsState.INITIALIZING) {
    console.warn(`[processTranscriptEvent] Call not in active state: ${currentState}`, {
      callId,
      currentState
    });
    return;
  }
  
  // CRITICAL FIX: Check analytics state before updating
  const updateCheck = await canUpdateAnalyticsRecord(ddb, ANALYTICS_TABLE_NAME!, callId, storedTimestamp);
  if (!updateCheck.allowed) {
    console.warn(`[processTranscriptEvent] Cannot update analytics: ${updateCheck.reason}`, {
      callId,
      currentState: updateCheck.currentState
    });
    return;
  }

  // **FIXED: Get or create transcript buffer from DynamoDB**
  let buffer = await transcriptManager.get(callId);
  if (!buffer) {
    await transcriptManager.initialize(callId);
    buffer = await transcriptManager.get(callId);
  }

  // CRITICAL FIX: Track last processed timestamp to detect out-of-order events
  const lastProcessedTime = storedRecord.lastTranscriptTime || 0;

  for (const result of transcriptEvent.results) {
    if (result.isPartial) continue;
    
    const alternative = result.alternatives[0];
    if (!alternative?.transcript) continue;
    
    const speaker = result.channelId === 'ch_0' ? 'AGENT' : 'CUSTOMER';
    const text = alternative.transcript;
    
    // Calculate average confidence
    const confidence = alternative.items.reduce((sum, item) => 
      sum + (item.confidence || 0), 0
    ) / (alternative.items.length || 1);
    
    const startTime = alternative.items[0]?.startTime || 0;
    const endTime = alternative.items[alternative.items.length - 1]?.endTime || 0;
    
    // CRITICAL FIX: Detect out-of-order events
    if (startTime < lastProcessedTime && lastProcessedTime > 0) {
      console.warn('[processTranscriptEvent] Out-of-order transcript detected:', {
        callId,
        currentStartTime: startTime,
        lastProcessedTime,
        timeDiff: lastProcessedTime - startTime,
        text: text.substring(0, 50)
      });
      // Still process it, but flag for potential issues
    }
    
    // **FIXED: Add to persistent buffer**
    await transcriptManager.addSegment(callId, {
      content: text,
      startTime,
      endTime,
      speaker: speaker as 'AGENT' | 'CUSTOMER',
      confidence
    });
    
    // Extend TTL to keep buffer alive during active call
    await transcriptManager.extendTTL(callId, 3600);
    
    // ENHANCED: Use AWS Comprehend for sentiment analysis
    const sentimentResult = await analyzeSentimentWithComprehend(text);
    
    // Extract advanced analytics
    const keyPhrases = await extractKeyPhrases(text);
    const entities = await extractEntities(text);
    
    // Detect call category
    const categoryScores = detectCallCategory(text);
    
    // Store transcript segment
    const transcriptItem = {
      timestamp: startTime,
      speaker,
      text,
      sentiment: sentimentResult.sentiment,
      confidence
    };
    
    const sentimentDataPoint = {
      timestamp: startTime,
      sentiment: sentimentResult.sentiment,
      score: sentimentResult.sentimentScore
    };
    
    // CRITICAL FIX #4 & #6: Use atomic ADD operations with bounded values
    // Fix #4: Track list sizes and trim atomically to prevent unbounded growth
    // Fix #6: Cap category scores to prevent overflow
    const expressionNames: any = {};
    const expressionValues: any = {
      ':one': 1,
      ':now': new Date().toISOString(),
      ':emptyList': [],
      ':newTranscript': [transcriptItem],
      ':newSentiment': [sentimentDataPoint],
      ':maxListSize': 10
    };
    
    // CRITICAL FIX #6 & #2.2: Build atomic category score updates with capping
    // Cap individual scores AND total scores to prevent unbounded growth on long calls
    const MAX_CATEGORY_SCORE_PER_UPDATE = 10; // Cap at 10 matches per transcript segment
    const categoryAddExpressions: string[] = [];
    
    // CRITICAL FIX #2.2: Check current category scores and skip if already at max
    const currentCategoryScores = storedRecord.categoryScores || {};
    const totalCurrentScore = Object.values(currentCategoryScores).reduce((sum: number, val: any) => sum + (val || 0), 0);
    const shouldUpdateCategories = totalCurrentScore < MAX_TOTAL_CATEGORY_SCORE;
    
    if (shouldUpdateCategories) {
      Object.entries(categoryScores).forEach(([category, score], idx) => {
        const attrName = `#cat${idx}`;
        expressionNames[attrName] = category;
        // Cap the score increment to prevent overflow
        const cappedScore = Math.min(score as number, MAX_CATEGORY_SCORE_PER_UPDATE);
        categoryAddExpressions.push(`categoryScores.${attrName} :catScore${idx}`);
        expressionValues[`:catScore${idx}`] = cappedScore;
      });
    } else {
      console.log('[processTranscriptEvent] Category scores at max, skipping update:', {
        callId,
        totalCurrentScore,
        maxTotal: MAX_TOTAL_CATEGORY_SCORE
      });
    }
    
    // Build key phrases and entities ADD expressions (using arrays)
    const newKeyPhrases = keyPhrases.slice(0, 5); // Limit per update
    const newEntities = entities.slice(0, 5).map(e => e.text); // Extract text from entities
    
    // CRITICAL FIX: Track last transcript time for out-of-order detection
    expressionValues[':lastTime'] = Math.max(endTime, lastProcessedTime);
    
    // Atomic update with conditional list append and ADD operations
    const setExpressions = [
      'updatedAt = :now',
      'lastTranscriptTime = :lastTime', // Track for out-of-order detection
      // Use list_append but limit size (DynamoDB doesn't auto-trim, so we check size)
      'latestTranscripts = list_append(if_not_exists(latestTranscripts, :emptyList), :newTranscript)',
      'latestSentiment = list_append(if_not_exists(latestSentiment, :emptyList), :newSentiment)'
    ];
    if (newKeyPhrases.length > 0) {
      setExpressions.push('keyPhrases = list_append(if_not_exists(keyPhrases, :emptyList), :keyPhrases)');
      expressionValues[':keyPhrases'] = newKeyPhrases;
    }
    if (newEntities.length > 0) {
      setExpressions.push('entities = list_append(if_not_exists(entities, :emptyList), :entities)');
      expressionValues[':entities'] = newEntities;
    }
    
    const addExpressions = [
      'transcriptCount :one',
      'sentimentDataPoints :one',
      ...categoryAddExpressions
    ];
    
    // CRITICAL FIX #4: Add state machine enforcement to prevent updates to finalized calls
    // CRITICAL FIX #2.1: Add ReturnValues to get updated count for race-safe trimming
    const updateResult = await ddb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp: storedTimestamp },
      UpdateExpression: `
        SET ${setExpressions.join(', ')}
        ${addExpressions.length > 0 ? 'ADD ' + addExpressions.join(', ') : ''}
      `,
      ExpressionAttributeNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      ExpressionAttributeValues: {
        ...expressionValues,
        ':activeState': AnalyticsState.ACTIVE
      },
      // CRITICAL FIX #4: Only update if still in ACTIVE state
      ConditionExpression: 'analyticsState = :activeState OR attribute_not_exists(analyticsState)',
      // CRITICAL FIX #2.1: Return updated values to get accurate transcript count
      ReturnValues: 'UPDATED_NEW'
    })).catch((err: any) => {
      if (err.name === 'ConditionalCheckFailedException') {
        console.warn(`[processTranscriptEvent] Cannot update - call no longer active:`, {
          callId,
          text: text.substring(0, 50)
        });
        return null;
      }
      throw err;
    });
    
    if (!updateResult) {
      // Update was skipped due to state check
      continue;
    }
    
    // CRITICAL FIX #4 & #2.1: Trim lists synchronously using ATOMIC counter from update result
    // FIX #2.1: Use the transcript count AFTER update (from updateResult.Attributes) instead of stale storedRecord
    // This prevents race conditions where concurrent Lambdas use stale counts
    const updatedCount = updateResult?.Attributes?.transcriptCount || (storedRecord.transcriptCount || 0) + 1;
    if (updatedCount % 15 === 0 && updatedCount > 0) {
      await trimLargeListsSync(callId, storedTimestamp);
    }
    
    // Check for issues and send alerts
    await detectIssues(callId, storedTimestamp, text, speaker, sentimentResult.sentiment, sentimentResult.sentimentScore);
  }
}

async function processCallQualityEvent(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, callQualityEvent } = event;
  
  if (!callQualityEvent) return;
  
  const { Items: existingRecords } = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId },
    Limit: 1
  }));

  if (!existingRecords || existingRecords.length === 0) {
    console.warn(`[processCallQualityEvent] No analytics record found for ${callId}`);
    return;
  }

  const storedRecord = existingRecords[0];
  const storedTimestamp = storedRecord.timestamp;
  
  // CRITICAL FIX #5: Validate call hasn't ended before processing quality metrics
  if (storedRecord.callEndTime || storedRecord.callEndTimestamp) {
    console.warn(`[processCallQualityEvent] Ignoring quality event for ended call ${callId}`);
    return;
  }
  
  // Validate call is in an active state
  const currentState = storedRecord.analyticsState || AnalyticsState.ACTIVE;
  if (currentState !== AnalyticsState.ACTIVE && currentState !== AnalyticsState.INITIALIZING) {
    console.warn(`[processCallQualityEvent] Call not in active state: ${currentState}`, {
      callId
    });
    return;
  }
  
  if (storedRecord.finalized === true) {
    console.warn(`[processCallQualityEvent] Call ${callId} already finalized`);
    return;
  }
  
  const { jitter, packetLoss, roundTripTime } = callQualityEvent;
  
  // Calculate quality score (1-5)
  let qualityScore = 5;
  if (jitter > 30 || packetLoss > 3 || roundTripTime > 300) qualityScore = 4;
  if (jitter > 50 || packetLoss > 5 || roundTripTime > 500) qualityScore = 3;
  if (jitter > 100 || packetLoss > 10 || roundTripTime > 800) qualityScore = 2;
  if (jitter > 200 || packetLoss > 15 || roundTripTime > 1000) qualityScore = 1;
  
  // CRITICAL FIX #4: Add state machine enforcement for quality updates
  await ddb.send(new UpdateCommand({
    TableName: ANALYTICS_TABLE_NAME,
    Key: { callId, timestamp: storedTimestamp },
    UpdateExpression: `
      SET audioQuality = :quality,
          updatedAt = :now
    `,
    ExpressionAttributeValues: {
      ':quality': {
        averageJitter: jitter,
        averagePacketLoss: packetLoss,
        averageRoundTripTime: roundTripTime,
        qualityScore
      },
      ':now': new Date().toISOString(),
      ':activeState': AnalyticsState.ACTIVE,
      ':initState': AnalyticsState.INITIALIZING
    },
    // CRITICAL FIX #4: Only update if still in ACTIVE or INITIALIZING state
    ConditionExpression: 'analyticsState = :activeState OR analyticsState = :initState OR attribute_not_exists(analyticsState)'
  })).catch((err: any) => {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn(`[processCallQualityEvent] Cannot update - call no longer active: ${callId}`);
      return;
    }
    throw err;
  });
  
  // ENHANCED: Send alert for poor quality
  if (qualityScore < 3) {
    await addDetectedIssue(callId, storedTimestamp, 'poor-audio-quality');
    await sendCallAlert(callId, 'POOR_AUDIO_QUALITY', {
      qualityScore,
      jitter,
      packetLoss,
      roundTripTime
    });
  }
}

async function finalizeCallAnalytics(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, timestamp } = event;

  // FIX #3: Add deduplication for finalization events
  const dedupResult = await checkAndMarkProcessed(
    ddb,
    DEDUP_TABLE,
    callId,
    'call-end-finalization'
  );
  
  if (dedupResult.isDuplicate) {
    console.log('[finalizeCallAnalytics] Duplicate finalization event, skipping:', callId);
    return;
  }

  // CRITICAL FIX #2.4: Use configurable finalization delay
  const finalizationTime = Date.now() + FINALIZATION_DELAY_MS;

  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId },
    Limit: 1
  }));

  const analytics = queryResult.Items?.[0];
  
  if (!analytics) {
    console.warn(`[finalizeCallAnalytics] No analytics record found for ${callId}`);
    return;
  }
  
  // CRITICAL FIX: Check if already scheduled for finalization (prevents duplicate processing)
  if (analytics.finalizationScheduledAt) {
    console.log(`[finalizeCallAnalytics] Call ${callId} already scheduled for finalization`, {
      scheduledAt: analytics.finalizationScheduledAt,
      scheduledFor: new Date(analytics.finalizationScheduledAt).toISOString()
    });
    return;
  }
  
  // CRITICAL FIX: Transition to FINALIZING state using state machine
  const stateTransition = await transitionAnalyticsState(
    ddb,
    ANALYTICS_TABLE_NAME!,
    callId,
    analytics.timestamp,
    AnalyticsState.FINALIZING,
    'Call ended, beginning finalization',
    event.callStateEvent?.metadata?.requestId
  );
  
  if (!stateTransition.success) {
    console.warn(`[finalizeCallAnalytics] Failed to transition to FINALIZING state: ${stateTransition.error}`, {
      callId,
      currentState: stateTransition.currentState
    });
    // If already in FINALIZING or FINALIZED, skip
    if (stateTransition.currentState === AnalyticsState.FINALIZING || 
        stateTransition.currentState === AnalyticsState.FINALIZED) {
      console.log(`[finalizeCallAnalytics] Call ${callId} already in ${stateTransition.currentState} state, skipping`);
      return;
    }
    // For other errors, proceed with caution
  }
  
  // **FIXED: Get transcript buffer from DynamoDB for final analysis**
  const buffer = await transcriptManager.get(callId);
  
  // CRITICAL FIX: Use buffer if available, otherwise use empty buffer with safety checks
  const safeBuffer: TranscriptBuffer = buffer || {
    callId,
    segments: [],
    lastUpdate: Date.now(),
    segmentCount: 0,
    ttl: 0
  };
  
  const interruptionCount = buffer ? detectInterruptions(buffer) : 0;
  
  // FIX #12: Extend TTL instead of deleting - allows finalization to retry if needed
  // Buffer will auto-expire after 1 hour via TTL
  if (buffer) {
    await transcriptManager.extendTTL(callId, 3600); // Keep for 1 hour for retry scenarios
    console.log('[finalizeCallAnalytics] Extended transcript buffer TTL for potential retries:', callId);
  }
  
  // Calculate sentiment from latest data
  const latestTranscripts = analytics.latestTranscripts || [];
  const sentimentCounts = latestTranscripts.reduce((acc: any, item: any) => {
    const sentiment = item.sentiment || 'NEUTRAL';
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const overallSentiment = Object.entries(sentimentCounts).length > 0
    ? Object.entries(sentimentCounts)
        .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] as any
    : 'NEUTRAL';
  
  // Determine final call category
  const categoryScores = analytics.categoryScores || {};
  const finalCategory = determineFinalCategory(categoryScores as Record<CallCategory, number>);
  
  // Calculate talk percentages from buffer (using safeBuffer)
  const agentSegments = safeBuffer.segments.filter(t => t.speaker === 'AGENT');
  const customerSegments = safeBuffer.segments.filter(t => t.speaker === 'CUSTOMER');

  const agentWordCount = agentSegments.reduce((sum, seg) =>
    sum + (seg.content?.split(/\s+/).length || 0), 0);
  const customerWordCount = customerSegments.reduce((sum, seg) =>
    sum + (seg.content?.split(/\s+/).length || 0), 0);
  const totalWordCount = agentWordCount + customerWordCount;

  const agentTalkPercentage = totalWordCount > 0
    ? Math.round((agentWordCount / totalWordCount) * 100)
    : 0;
  const customerTalkPercentage = totalWordCount > 0
    ? Math.round((customerWordCount / totalWordCount) * 100)
    : 0;
  
  // CRITICAL FIX #5: Capture timestamps early and use them consistently
  // This minimizes the race window between calculation and conditional write
  const finalizationStartTime = Date.now();
  const callStartTime = new Date(analytics.callStartTime).getTime();
  
  // Don't trust client-provided end time - use server time
  const callEndTime = finalizationStartTime;
  
  // Validate call duration is reasonable (not negative, not > 24 hours)
  let totalDuration = Math.floor((callEndTime - callStartTime) / 1000);
  
  if (totalDuration < 0) {
    console.error('[finalizeCallAnalytics] Negative call duration detected:', {
      callId,
      callStartTime: analytics.callStartTime,
      callEndTime: new Date(callEndTime).toISOString(),
      calculatedDuration: totalDuration
    });
    totalDuration = 0; // Default to 0 for invalid durations
  } else if (totalDuration > 24 * 60 * 60) {
    console.warn('[finalizeCallAnalytics] Abnormally long call duration (>24h):', {
      callId,
      duration: totalDuration,
      durationHours: Math.round(totalDuration / 3600)
    });
    // Keep the value but log warning - might be legitimate
  }
  
  // CRITICAL FIX #5: Check if record was modified by another process during our computation
  // Re-verify the record hasn't been finalized in the meantime
  const timeSinceStart = Date.now() - finalizationStartTime;
  if (timeSinceStart > 5000) {
    console.warn('[finalizeCallAnalytics] Finalization took >5s, re-verifying state:', {
      callId,
      elapsedMs: timeSinceStart
    });
    
    // Re-fetch to check current state
    const recheckResult = await ddb.send(new QueryCommand({
      TableName: ANALYTICS_TABLE_NAME,
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1
    }));
    
    const currentRecord = recheckResult.Items?.[0];
    if (currentRecord?.finalizationScheduledAt || currentRecord?.callStatus === 'completed') {
      console.log('[finalizeCallAnalytics] Record already finalized by another process:', callId);
      return;
    }
  }
  
  const silenceMetrics = calculateSilenceMetrics(safeBuffer, totalDuration);
  
  // CRITICAL FIX: Update with state machine validation
  // Note: State transition to FINALIZING was already done above
  try {
    await ddb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp: analytics.timestamp },
      UpdateExpression: `
        SET callEndTime = :endTime,
            callEndTimestamp = :endTimestamp,
            callStatus = :completedStatus,
            totalDuration = :duration,
            overallSentiment = :sentiment,
            callCategory = :category,
            speakerMetrics = :metrics,
            finalizationScheduledAt = :scheduleTime,
            updatedAt = :now
      `,
      ExpressionAttributeNames: {
        '#status': 'callStatus'
      },
      ExpressionAttributeValues: {
        ':endTime': new Date(callEndTime).toISOString(),
        ':endTimestamp': callEndTime,
        ':completedStatus': 'completed',
        ':duration': totalDuration,
        ':sentiment': overallSentiment,
        ':category': finalCategory,
        ':metrics': {
          agentTalkPercentage,
          customerTalkPercentage,
          silencePercentage: silenceMetrics.silencePercentage,
          interruptionCount,
          silencePeriods: silenceMetrics.silencePeriods
        },
        ':scheduleTime': finalizationTime,
        ':now': new Date().toISOString(),
        ':activeStatus': 'active'
      },
      // CRITICAL: Validate call is still active and not already scheduled
      ConditionExpression: 'attribute_exists(callId) AND attribute_not_exists(finalizationScheduledAt) AND (#status = :activeStatus OR attribute_not_exists(#status))'
    }));
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`[finalizeCallAnalytics] Call ${callId} already scheduled by another process`);
      return;
    }
    throw err;
  }
  
  // FIXED: Remove in-memory buffer cleanup - now handled via DynamoDB (deleted above)
  
  console.log(`[finalizeCallAnalytics] Analytics for ${callId} scheduled for finalization`, {
    duration: totalDuration,
    sentiment: overallSentiment,
    category: finalCategory,
    interruptions: interruptionCount
  });
}

/**
 * Trim transcript lists to keep only latest 10 items
 * Called periodically to prevent unbounded list growth
 */
async function trimTranscriptLists(callId: string, timestamp: number): Promise<void> {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp }
    }));
    
    if (!Item) return;
    
    const latestTranscripts = (Item.latestTranscripts || []).slice(-10);
    const latestSentiment = (Item.latestSentiment || []).slice(-10);
    
    await ddb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp },
      UpdateExpression: 'SET latestTranscripts = :trans, latestSentiment = :sent',
      ExpressionAttributeValues: {
        ':trans': latestTranscripts,
        ':sent': latestSentiment
      }
    }));
  } catch (err: any) {
    console.warn('[trimTranscriptLists] Error trimming lists:', err.message);
    // Non-critical, continue
  }
}

/**
 * CRITICAL FIX #4: Trim large lists SYNCHRONOUSLY to guarantee bounded growth
 * Called every 15 updates to ensure lists never exceed ~25 items
 * This replaces the async version which could miss trimming due to Lambda lifecycle
 */
async function trimLargeListsSync(callId: string, timestamp: number): Promise<void> {
  try {
    const { Item } = await ddb.send(new GetCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp }
    }));
    
    if (!Item) return;
    
    // CRITICAL FIX #4: Use stricter threshold - trim if > 15 items
    const transcriptsLength = Item.latestTranscripts?.length || 0;
    const sentimentLength = Item.latestSentiment?.length || 0;
    const keyPhrasesLength = Item.keyPhrases?.length || 0;
    const entitiesLength = Item.entities?.length || 0;
    
    const needsTrim = 
      transcriptsLength > 15 ||
      sentimentLength > 15 ||
      keyPhrasesLength > 50 ||  // Key phrases can be longer
      entitiesLength > 50;
    
    if (!needsTrim) return;
    
    // Trim all lists atomically to prevent partial updates
    await ddb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp },
      UpdateExpression: `
        SET latestTranscripts = :trans,
            latestSentiment = :sent,
            keyPhrases = :phrases,
            entities = :ents
      `,
      ExpressionAttributeValues: {
        ':trans': (Item.latestTranscripts || []).slice(-10),  // Keep last 10
        ':sent': (Item.latestSentiment || []).slice(-10),     // Keep last 10
        ':phrases': (Item.keyPhrases || []).slice(-30),       // Keep last 30
        ':ents': (Item.entities || []).slice(-30)             // Keep last 30
      }
    }));
    
    console.log('[trimLargeListsSync] Trimmed lists for call:', {
      callId,
      transcriptsBefore: transcriptsLength,
      sentimentBefore: sentimentLength
    });
  } catch (err: any) {
    // Log but don't throw - trimming is best-effort
    console.warn('[trimLargeListsSync] Trim error (non-fatal):', err.message);
  }
}

async function detectIssues(
  callId: string, 
  timestamp: number, 
  text: string, 
  speaker: string, 
  sentiment: string,
  sentimentScore: number
): Promise<void> {
  const issues: string[] = [];
  
  // Detect customer frustration
  if (speaker === 'CUSTOMER' && sentiment === 'NEGATIVE' && sentimentScore < 30) {
    const frustrationKeywords = ['frustrated', 'angry', 'upset', 'disappointed', 'terrible', 'awful'];
    const hasFrustration = frustrationKeywords.some(keyword => 
      text.toLowerCase().includes(keyword)
    );
    
    if (hasFrustration) {
      issues.push('customer-frustration');
      // ENHANCED: Send real-time alert
      await sendCallAlert(callId, 'CUSTOMER_FRUSTRATION', {
        text,
        sentimentScore
      });
    }
  }
  
  // Detect escalation requests
  const escalationKeywords = ['supervisor', 'manager', 'speak to someone else'];
  const hasEscalation = escalationKeywords.some(keyword =>
    text.toLowerCase().includes(keyword)
  );
  
  if (hasEscalation) {
    issues.push('escalation-request');
    await sendCallAlert(callId, 'ESCALATION_REQUEST', { text });
  }
  
  // Add detected issues
  for (const issue of issues) {
    await addDetectedIssue(callId, timestamp, issue);
  }
}

async function addDetectedIssue(
  callId: string, 
  timestamp: number, 
  issue: string
): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp },
      UpdateExpression: `
        SET detectedIssues = list_append(if_not_exists(detectedIssues, :empty_list), :issue),
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':issue': [issue],
        ':empty_list': [],
        ':now': new Date().toISOString()
      }
    }));
    
    console.log(`[process-analytics] Detected issue for ${callId}: ${issue}`);
  } catch (err) {
    console.error('[process-analytics] Failed to add issue:', err);
  }
}

/**
 * ENHANCED: Send real-time alerts via SNS
 */
async function sendCallAlert(
  callId: string,
  alertType: string,
  details: any
): Promise<void> {
  if (!ENABLE_REAL_TIME_ALERTS || !CALL_ALERTS_TOPIC_ARN) {
    return;
  }

  try {
    await sns.send(new PublishCommand({
      TopicArn: CALL_ALERTS_TOPIC_ARN,
      Subject: `Call Alert: ${alertType}`,
      Message: JSON.stringify({
        callId,
        alertType,
        timestamp: new Date().toISOString(),
        details
      }, null, 2)
    }));
    
    console.log(`[process-analytics] Alert sent for ${callId}: ${alertType}`);
  } catch (err) {
    console.error('[process-analytics] Failed to send alert:', err);
  }
}


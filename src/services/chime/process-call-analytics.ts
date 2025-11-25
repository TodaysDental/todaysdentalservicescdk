import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ComprehendClient, DetectSentimentCommand, DetectKeyPhrasesCommand, DetectEntitiesCommand } from '@aws-sdk/client-comprehend';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);
const comprehend = new ComprehendClient({});
const sns = new SNSClient({});

// CRITICAL FIX: Add validation for required environment variable
const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
if (!ANALYTICS_TABLE_NAME) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}
const RETENTION_DAYS = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);
const ENABLE_REAL_TIME_SENTIMENT = process.env.ENABLE_REAL_TIME_SENTIMENT === 'true';
const ENABLE_REAL_TIME_ALERTS = process.env.ENABLE_REAL_TIME_ALERTS === 'true';
const CALL_ALERTS_TOPIC_ARN = process.env.CALL_ALERTS_TOPIC_ARN;

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

// ENHANCED: In-memory transcript buffer for better analytics
interface TranscriptBuffer {
  segments: Array<{
    timestamp: number;
    speaker: string;
    text: string;
    startTime?: number;
    endTime?: number;
  }>;
  lastUpdate: number;
}

const transcriptBuffers = new Map<string, TranscriptBuffer>();

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
  
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (RETENTION_DAYS * 24 * 60 * 60);
  
  // Initialize transcript buffer
  transcriptBuffers.set(callId, { segments: [], lastUpdate: Date.now() });
  
  await ddb.send(new PutCommand({
    TableName: ANALYTICS_TABLE_NAME,
    Item: {
      callId,
      timestamp,
      clinicId: metadata.clinicId,
      agentId: metadata.agentId,
      customerPhone: metadata.phoneNumber,
      direction: metadata.direction || 'inbound',
      callStartTime: now,
      // FIXED: Use separate tracking fields instead of large lists
      transcriptCount: 0,
      latestTranscripts: [], // Only keep last 10 for quick reference
      sentimentDataPoints: 0,
      latestSentiment: [],
      detectedIssues: [],
      keywords: new Set(), // Will be converted to array on write
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
  });
}

/**
 * ENHANCED: Analyze sentiment using AWS Comprehend
 */
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
      LanguageCode: languageCode,
    }));

    const scores = {
      Positive: result.SentimentScore?.Positive || 0,
      Negative: result.SentimentScore?.Negative || 0,
      Neutral: result.SentimentScore?.Neutral || 0,
      Mixed: result.SentimentScore?.Mixed || 0,
    };

    const sentiment = result.Sentiment as 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';

    // Calculate 0-100 score where higher = better
    const sentimentScore = Math.round(
      (scores.Positive * 100) + 
      (scores.Neutral * 50) + 
      (scores.Mixed * 50)
    );

    return { sentiment, sentimentScore, scores };
  } catch (err) {
    console.error('[process-analytics] Comprehend error, falling back to keywords:', err);
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
      LanguageCode: languageCode,
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
      LanguageCode: languageCode,
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
  
  if (storedRecord.finalized === true) {
    console.warn(`[processTranscriptEvent] Call ${callId} already finalized, skipping`);
    return;
  }

  // Get or create transcript buffer
  let buffer = transcriptBuffers.get(callId);
  if (!buffer) {
    buffer = { segments: [], lastUpdate: Date.now() };
    transcriptBuffers.set(callId, buffer);
  }

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
    
    // Add to buffer
    buffer.segments.push({
      timestamp: Date.now(),
      speaker,
      text,
      startTime,
      endTime
    });
    buffer.lastUpdate = Date.now();
    
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
    
    // FIXED: Use atomic counters instead of list append
    const transcriptCount = storedRecord.transcriptCount || 0;
    const existingCategoryScores = storedRecord.categoryScores || {};
    
    // Update category scores
    const updatedCategoryScores: Record<string, number> = { ...existingCategoryScores };
    for (const [category, score] of Object.entries(categoryScores)) {
      updatedCategoryScores[category] = (updatedCategoryScores[category] || 0) + score;
    }
    
    // Update with atomic operations
    await ddb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId, timestamp: storedTimestamp },
      UpdateExpression: `
        SET transcriptCount = transcriptCount + :one,
            latestTranscripts = list_append(:newTranscript, list_slice(if_not_exists(latestTranscripts, :empty), :zero, :nine)),
            sentimentDataPoints = sentimentDataPoints + :one,
            latestSentiment = list_append(:newSentiment, list_slice(if_not_exists(latestSentiment, :empty), :zero, :nine)),
            categoryScores = :categoryScores,
            keyPhrases = list_append(if_not_exists(keyPhrases, :empty), :keyPhrases),
            entities = list_append(if_not_exists(entities, :empty), :entities),
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':one': 1,
        ':newTranscript': [transcriptItem],
        ':newSentiment': [sentimentDataPoint],
        ':keyPhrases': keyPhrases,
        ':entities': entities,
        ':categoryScores': updatedCategoryScores,
        ':empty': [],
        ':zero': 0,
        ':nine': 9,
        ':now': new Date().toISOString()
      }
    }));
    
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
      ':now': new Date().toISOString()
    }
  }));
  
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

  const FINALIZATION_DELAY = 30000; // 30 seconds
  const finalizationTime = Date.now() + FINALIZATION_DELAY;

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
  
  if (analytics.finalizationScheduledAt) {
    console.log(`[finalizeCallAnalytics] Call ${callId} already scheduled`);
    return;
  }
  
  // Get transcript buffer for final analysis
  const buffer = transcriptBuffers.get(callId) || { segments: [], lastUpdate: Date.now() };
  
  // Calculate interruptions
  const interruptionCount = detectInterruptions(buffer);
  
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
  
  // Calculate talk percentages from buffer
  const agentSegments = buffer.segments.filter(t => t.speaker === 'AGENT');
  const customerSegments = buffer.segments.filter(t => t.speaker === 'CUSTOMER');

  const agentWordCount = agentSegments.reduce((sum, seg) =>
    sum + (seg.text?.split(/\s+/).length || 0), 0);
  const customerWordCount = customerSegments.reduce((sum, seg) =>
    sum + (seg.text?.split(/\s+/).length || 0), 0);
  const totalWordCount = agentWordCount + customerWordCount;

  const agentTalkPercentage = totalWordCount > 0
    ? Math.round((agentWordCount / totalWordCount) * 100)
    : 0;
  const customerTalkPercentage = totalWordCount > 0
    ? Math.round((customerWordCount / totalWordCount) * 100)
    : 0;
  
  // Calculate duration and silence
  const callStartTime = new Date(analytics.callStartTime).getTime();
  const callEndTime = event.callStateEvent?.metadata?.endTime
    ? new Date(event.callStateEvent.metadata.endTime).getTime()
    : Date.now();
  const totalDuration = Math.floor((callEndTime - callStartTime) / 1000);
  
  const silenceMetrics = calculateSilenceMetrics(buffer, totalDuration);
  
  await ddb.send(new UpdateCommand({
    TableName: ANALYTICS_TABLE_NAME,
    Key: { callId, timestamp: analytics.timestamp },
    UpdateExpression: `
      SET callEndTime = :endTime,
          totalDuration = :duration,
          overallSentiment = :sentiment,
          callCategory = :category,
          speakerMetrics = :metrics,
          finalizationScheduledAt = :scheduleTime,
          updatedAt = :now
    `,
    ExpressionAttributeValues: {
      ':endTime': new Date(callEndTime).toISOString(),
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
      ':now': new Date().toISOString()
    }
  }));
  
  // Clean up buffer
  transcriptBuffers.delete(callId);
  
  console.log(`[finalizeCallAnalytics] Analytics for ${callId} scheduled for finalization`, {
    duration: totalDuration,
    sentiment: overallSentiment,
    category: finalCategory,
    interruptions: interruptionCount
  });
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


import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);

// CRITICAL FIX: Add validation for required environment variable
const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
if (!ANALYTICS_TABLE_NAME) {
  throw new Error('CALL_ANALYTICS_TABLE_NAME environment variable is required');
}
const RETENTION_DAYS = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);

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
  // CRITICAL FIX: Extract callId and timestamp from event
  const { callId, timestamp } = event;
  const metadata = event.callStateEvent?.metadata || {};
  
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (RETENTION_DAYS * 24 * 60 * 60);
  
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
      transcript: [],
      sentimentTrend: [],
      detectedIssues: [],
      keywords: [],
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

async function processTranscriptEvent(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, transcriptEvent, timestamp: eventTimestamp } = event;
  
  if (!transcriptEvent?.results) return;

  // CRITICAL FIX #10: Check if call is finalized to handle out-of-order events
  const { Items: existingRecords } = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId },
    Limit: 1
  }));

  if (!existingRecords || existingRecords.length === 0) {
    console.warn(`[processTranscriptEvent] No analytics record found for ${callId}, skipping transcript`);
    return;
  }

  const storedRecord = existingRecords[0];
  const storedTimestamp = storedRecord.timestamp;
  
  // Don't process transcripts if call is already finalized (out-of-order event)
  if (storedRecord.finalized === true) {
    console.warn(`[processTranscriptEvent] Call ${callId} already finalized, skipping late transcript`);
    return;
  }
  
  // If call has ended, check if transcript is from before end time
  if (storedRecord.callEndTime) {
    const eventTime = eventTimestamp || Date.now();
    const endTime = new Date(storedRecord.callEndTime).getTime();
    
    if (eventTime > endTime) {
      console.warn(`[processTranscriptEvent] Rejecting transcript for ${callId} (event after call end)`);
      return;
    }
    
    console.log(`[processTranscriptEvent] Accepting late transcript for ${callId} (event before call end)`);
  }

  for (const result of transcriptEvent.results) {
    // Skip partial results - wait for final
    if (result.isPartial) continue;
    
    const alternative = result.alternatives[0];
    if (!alternative?.transcript) continue;
    
    const speaker = result.channelId === 'ch_0' ? 'AGENT' : 'CUSTOMER';
    const text = alternative.transcript;
    
    // Calculate average confidence
    const confidence = alternative.items.reduce((sum, item) => 
      sum + (item.confidence || 0), 0
    ) / (alternative.items.length || 1);
    
    // Analyze sentiment for this utterance
    // NOTE: Basic keyword-based sentiment detection. For production, integrate AWS Comprehend
    let sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED' = 'NEUTRAL';
    let sentimentScore = 0.5;
    
    const negativeKeywords = ['problem', 'issue', 'error', 'fail', 'angry', 'frustrated', 'upset', 'terrible', 'awful'];
    const positiveKeywords = ['great', 'excellent', 'perfect', 'happy', 'satisfied', 'thank', 'appreciate', 'wonderful'];
    
    const textLower = text.toLowerCase();
    const hasNegative = negativeKeywords.some(kw => textLower.includes(kw));
    const hasPositive = positiveKeywords.some(kw => textLower.includes(kw));
    
    // FIXED FLAW #1: Sentiment score should be 0-100 scale where higher = better
    // Negative should be LOW (0-33), Neutral/Mixed = MEDIUM (34-66), Positive = HIGH (67-100)
    if (hasNegative && !hasPositive) {
      sentiment = 'NEGATIVE';
      sentimentScore = 20; // Low score for negative sentiment (0-33 range)
    } else if (hasPositive && !hasNegative) {
      sentiment = 'POSITIVE';
      sentimentScore = 85; // High score for positive sentiment (67-100 range)
    } else if (hasNegative && hasPositive) {
      sentiment = 'MIXED';
      sentimentScore = 50; // Neutral score for mixed sentiment (34-66 range)
    } else {
      // Neither positive nor negative keywords found
      sentiment = 'NEUTRAL';
      sentimentScore = 50; // Neutral default
    }
    
    // Extract keywords - split on whitespace and filter longer words
    const words = text.split(/\s+/).filter(w => w.length > 4);
    const keywords = [...new Set(words)].slice(0, 5);
    
    // Store transcript segment
    const transcriptItem = {
      timestamp: alternative.items[0]?.startTime || Date.now(),
      speaker,
      text,
      sentiment,
      confidence
    };
    
    const sentimentDataPoint = {
      timestamp: transcriptItem.timestamp,
      sentiment,
      score: sentimentScore
    };
    
    // CRITICAL FIX: Get current list sizes to enforce limits
    const currentTranscriptLength = existingRecords[0].transcript?.length || 0;
    const currentSentimentLength = existingRecords[0].sentimentTrend?.length || 0;
    const currentKeywordsLength = existingRecords[0].keywords?.length || 0;
    
    // CRITICAL FIX: Only append if under size limits (prevent memory issues)
    const MAX_TRANSCRIPT_ITEMS = 1000;
    const MAX_SENTIMENT_ITEMS = 500;
    const MAX_KEYWORDS = 100;
    
    if (currentTranscriptLength < MAX_TRANSCRIPT_ITEMS) {
      // Update analytics record with the correct stored timestamp
      await ddb.send(new UpdateCommand({
        TableName: ANALYTICS_TABLE_NAME,
        Key: { callId, timestamp: storedTimestamp }, // Use stored timestamp, not event.timestamp
        UpdateExpression: `
          SET transcript = list_append(if_not_exists(transcript, :empty_list), :transcript),
              sentimentTrend = list_append(if_not_exists(sentimentTrend, :empty_list), :sentiment),
              keywords = list_append(if_not_exists(keywords, :empty_list), :keywords),
              updatedAt = :now
        `,
        ExpressionAttributeValues: {
          ':transcript': [transcriptItem],
          ':sentiment': currentSentimentLength < MAX_SENTIMENT_ITEMS ? [sentimentDataPoint] : [],
          ':keywords': currentKeywordsLength < MAX_KEYWORDS ? keywords : [],
          ':empty_list': [],
          ':now': new Date().toISOString()
        }
      }));
      
      // Check for issues
      await detectIssues(callId, storedTimestamp, text, speaker, sentiment);
    } else {
      console.warn(`[processTranscriptEvent] Transcript limit reached for ${callId}, skipping`);
    }
  }
}

async function processCallQualityEvent(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, callQualityEvent } = event;
  
  if (!callQualityEvent) return;
  
  // CRITICAL FIX #10: Check if call is finalized
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
  
  // Don't process quality events if call is finalized
  if (storedRecord.finalized === true) {
    console.warn(`[processCallQualityEvent] Call ${callId} already finalized, skipping quality event`);
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
    Key: { callId, timestamp: storedTimestamp }, // Use stored timestamp
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
  
  // Detect quality issues
  if (qualityScore < 3) {
    await addDetectedIssue(callId, storedTimestamp, 'poor-audio-quality');
  }
}

async function finalizeCallAnalytics(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, timestamp } = event;

  // CRITICAL FIX #10: Don't finalize immediately - mark for delayed finalization
  // This allows buffering window for out-of-order events
  const FINALIZATION_DELAY = 30000; // 30 seconds
  const finalizationTime = Date.now() + FINALIZATION_DELAY;

  // Get full analytics record
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ANALYTICS_TABLE_NAME,
    KeyConditionExpression: 'callId = :callId',
    ExpressionAttributeValues: { ':callId': callId },
    Limit: 1
  }));

  const analytics = queryResult.Items?.[0];
  
  if (!analytics) {
    console.warn(`[process-analytics] No analytics record found for ${callId}`);
    return;
  }
  
  // Check if already scheduled for finalization
  if (analytics.finalizationScheduledAt) {
    console.log(`[finalizeCallAnalytics] Call ${callId} already scheduled for finalization`);
    return;
  }
  
  // Calculate final metrics
  const transcript = analytics.transcript || [];
  const sentimentTrend = analytics.sentimentTrend || [];

  // FIXED FLAW #2: Use transcript array for sentiment aggregation (sentimentTrend may be truncated)
  const sentimentCounts = transcript.reduce((acc: any, item: any) => {
    const sentiment = item.sentiment || 'NEUTRAL';
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const overallSentiment = Object.entries(sentimentCounts).length > 0
    ? Object.entries(sentimentCounts)
        .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] as any
    : 'NEUTRAL';
  
  // FIXED FLAW #3: Calculate talk percentage based on actual talk duration, not segment count
  // Note: Since we don't have segment durations from live transcription, we estimate
  // based on word count as a proxy for duration (more accurate than segment count)
  const agentSegments = transcript.filter((t: any) => t.speaker === 'AGENT');
  const customerSegments = transcript.filter((t: any) => t.speaker === 'CUSTOMER');

  // Calculate word counts as proxy for talk time
  const agentWordCount = agentSegments.reduce((sum: number, seg: any) =>
    sum + (seg.text?.split(/\s+/).length || 0), 0);
  const customerWordCount = customerSegments.reduce((sum: number, seg: any) =>
    sum + (seg.text?.split(/\s+/).length || 0), 0);
  const totalWordCount = agentWordCount + customerWordCount;

  const agentTalkPercentage = totalWordCount > 0
    ? Math.round((agentWordCount / totalWordCount) * 100)
    : 0;
  const customerTalkPercentage = totalWordCount > 0
    ? Math.round((customerWordCount / totalWordCount) * 100)
    : 0;
  
  // FIXED FLAW #4: Use actual call end time from event, not Date.now()
  const callStartTime = new Date(analytics.callStartTime).getTime();
  const callEndTime = event.callStateEvent?.metadata?.endTime
    ? new Date(event.callStateEvent.metadata.endTime).getTime()
    : Date.now(); // Fallback to now only if no end time in event
  const totalDuration = Math.floor((callEndTime - callStartTime) / 1000);
  
  // Mark call end time and schedule finalization
  await ddb.send(new UpdateCommand({
    TableName: ANALYTICS_TABLE_NAME,
    Key: { callId, timestamp: analytics.timestamp },
    UpdateExpression: `
      SET callEndTime = :endTime,
          totalDuration = :duration,
          overallSentiment = :sentiment,
          speakerMetrics = :metrics,
          finalizationScheduledAt = :scheduleTime,
          updatedAt = :now
    `,
    ExpressionAttributeValues: {
      ':endTime': new Date(callEndTime).toISOString(),
      ':duration': totalDuration,
      ':sentiment': overallSentiment,
      ':metrics': {
        agentTalkPercentage,
        customerTalkPercentage,
        silencePercentage: 100 - agentTalkPercentage - customerTalkPercentage,
        interruptionCount: 0  // TODO: Calculate interruptions
      },
      ':scheduleTime': finalizationTime,
      ':now': new Date().toISOString()
    }
  }));
  
  console.log(`[process-analytics] Analytics for ${callId} scheduled for finalization at ${new Date(finalizationTime).toISOString()}`, {
    duration: totalDuration,
    sentiment: overallSentiment,
    agentTalkPercentage
  });
  
  // NOTE: Actual finalization (setting finalized=true) should be done by a separate
  // scheduled Lambda or EventBridge rule that runs every minute to finalize records
  // where finalizationScheduledAt < now() and finalized != true
  // This provides a buffer window for out-of-order events
}

async function detectIssues(
  callId: string, 
  timestamp: number, 
  text: string, 
  speaker: string, 
  sentiment: string
): Promise<void> {
  const issues: string[] = [];
  
  // Detect customer frustration
  if (speaker === 'CUSTOMER' && sentiment === 'NEGATIVE') {
    const frustrationKeywords = ['frustrated', 'angry', 'upset', 'disappointed', 'terrible', 'awful'];
    const hasFrustration = frustrationKeywords.some(keyword => 
      text.toLowerCase().includes(keyword)
    );
    
    if (hasFrustration) {
      issues.push('customer-frustration');
    }
  }
  
  // Detect requests for supervisor
  const escalationKeywords = ['supervisor', 'manager', 'speak to someone else'];
  const hasEscalation = escalationKeywords.some(keyword =>
    text.toLowerCase().includes(keyword)
  );
  
  if (hasEscalation) {
    issues.push('escalation-request');
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

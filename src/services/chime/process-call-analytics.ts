import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const dynamodbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamodbClient);

const ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME;
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
  const { callId, transcriptEvent } = event;
  
  if (!transcriptEvent?.results) return;

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
    
    if (hasNegative && !hasPositive) {
      sentiment = 'NEGATIVE';
      sentimentScore = 0.8;
    } else if (hasPositive && !hasNegative) {
      sentiment = 'POSITIVE';
      sentimentScore = 0.8;
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
    
    // Update analytics record
    await ddb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE_NAME,
      Key: { callId: event.callId, timestamp: event.timestamp },
      UpdateExpression: `
        SET transcript = list_append(if_not_exists(transcript, :empty_list), :transcript),
            sentimentTrend = list_append(if_not_exists(sentimentTrend, :empty_list), :sentiment),
            keywords = list_append(if_not_exists(keywords, :empty_list), :keywords),
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':transcript': [transcriptItem],
        ':sentiment': [sentimentDataPoint],
        ':keywords': keywords,
        ':empty_list': [],
        ':now': new Date().toISOString()
      }
    }));
    
    // Check for issues
    await detectIssues(event.callId, event.timestamp, text, speaker, sentiment);
  }
}

async function processCallQualityEvent(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, timestamp, callQualityEvent } = event;
  
  if (!callQualityEvent) return;
  
  const { jitter, packetLoss, roundTripTime } = callQualityEvent;
  
  // Calculate quality score (1-5)
  let qualityScore = 5;
  if (jitter > 30 || packetLoss > 3 || roundTripTime > 300) qualityScore = 4;
  if (jitter > 50 || packetLoss > 5 || roundTripTime > 500) qualityScore = 3;
  if (jitter > 100 || packetLoss > 10 || roundTripTime > 800) qualityScore = 2;
  if (jitter > 200 || packetLoss > 15 || roundTripTime > 1000) qualityScore = 1;
  
  await ddb.send(new UpdateCommand({
    TableName: ANALYTICS_TABLE_NAME,
    Key: { callId, timestamp },
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
    await addDetectedIssue(callId, timestamp, 'poor-audio-quality');
  }
}

async function finalizeCallAnalytics(event: ChimeAnalyticsEvent): Promise<void> {
  const { callId, timestamp } = event;

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
  
  // Calculate final metrics
  const transcript = analytics.transcript || [];
  const sentimentTrend = analytics.sentimentTrend || [];
  
  // Overall sentiment (most common)
  const sentimentCounts = sentimentTrend.reduce((acc: any, point: any) => {
    acc[point.sentiment] = (acc[point.sentiment] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const overallSentiment = Object.entries(sentimentCounts)
    .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] as any || 'NEUTRAL';
  
  // Speaker metrics
  const agentSegments = transcript.filter((t: any) => t.speaker === 'AGENT');
  const customerSegments = transcript.filter((t: any) => t.speaker === 'CUSTOMER');
  
  const totalSegments = transcript.length;
  const agentTalkPercentage = totalSegments > 0 
    ? (agentSegments.length / totalSegments) * 100 
    : 0;
  const customerTalkPercentage = totalSegments > 0
    ? (customerSegments.length / totalSegments) * 100
    : 0;
  
  // Calculate duration
  const callStartTime = new Date(analytics.callStartTime).getTime();
  const callEndTime = Date.now();
  const totalDuration = Math.floor((callEndTime - callStartTime) / 1000);
  
  await ddb.send(new UpdateCommand({
    TableName: ANALYTICS_TABLE_NAME,
    Key: { callId, timestamp: analytics.timestamp },
    UpdateExpression: `
      SET callEndTime = :endTime,
          totalDuration = :duration,
          overallSentiment = :sentiment,
          speakerMetrics = :metrics,
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
      ':now': new Date().toISOString()
    }
  }));
  
  console.log(`[process-analytics] Finalized analytics for ${callId}`, {
    duration: totalDuration,
    sentiment: overallSentiment,
    agentTalkPercentage
  });
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

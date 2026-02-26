/**
 * Process completed transcriptions and perform sentiment analysis
 * 
 * Triggered by AWS Transcribe completion events via EventBridge
 * Updates agent performance metrics based on call sentiment
 */

import { EventBridgeEvent } from 'aws-lambda';
import { getDynamoDBClient } from '../shared/utils/dynamodb-manager';
import { QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ComprehendClient, DetectSentimentCommand } from '@aws-sdk/client-comprehend';
import { TranscribeClient, GetTranscriptionJobCommand } from '@aws-sdk/client-transcribe';

const ddb = getDynamoDBClient();
const s3 = new S3Client({});
const comprehend = new ComprehendClient({});
const transcribe = new TranscribeClient({});

const RECORDING_METADATA_TABLE = process.env.RECORDING_METADATA_TABLE_NAME!;
const CALL_QUEUE_TABLE_NAME = process.env.CALL_QUEUE_TABLE_NAME!;
const AGENT_PERFORMANCE_TABLE_NAME = process.env.AGENT_PERFORMANCE_TABLE_NAME!;
const RECORDINGS_BUCKET = process.env.RECORDINGS_BUCKET_NAME!;
const CALL_ANALYTICS_TABLE_NAME = process.env.CALL_ANALYTICS_TABLE_NAME || '';

interface TranscribeEvent {
  TranscriptionJobName: string;
  TranscriptionJobStatus: 'COMPLETED' | 'FAILED';
  TranscriptionJob?: any;
}

export const handler = async (event: EventBridgeEvent<'Transcribe Job State Change', TranscribeEvent>): Promise<void> => {
  console.log('[TranscriptionComplete] ===== START PROCESSING =====');
  console.log('[TranscriptionComplete] Event:', JSON.stringify(event, null, 2));

  const detail = event.detail;
  
  if (detail.TranscriptionJobStatus === 'FAILED') {
    console.error('[TranscriptionComplete] Transcription job failed:', detail.TranscriptionJobName);
    return;
  }

  try {
    // Extract job information
    const jobName = detail.TranscriptionJobName;
    
    console.log('[TranscriptionComplete] Job name:', jobName);
    console.log('[TranscriptionComplete] Fetching transcription job details...');

    // Fetch the transcription job to get the transcript URI
    // EventBridge doesn't include the URI in the event, so we need to fetch it
    const getJobCommand = new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    });
    
    const jobResponse = await transcribe.send(getJobCommand);
    const transcriptUri = jobResponse.TranscriptionJob?.Transcript?.TranscriptFileUri;

    console.log('[TranscriptionComplete] Transcript URI:', transcriptUri);

    if (!transcriptUri) {
      console.error('[TranscriptionComplete] No transcript URI found in transcription job');
      return;
    }

    // Find recording metadata by job name
    const recordingMetadata = await findRecordingByJobName(jobName);
    
    if (!recordingMetadata) {
      console.error('[TranscriptionComplete] ❌ CRITICAL: Recording metadata not found for job:', jobName);
      console.error('[TranscriptionComplete] This means post-call analytics cannot proceed');
      console.error('[TranscriptionComplete] Check if transcriptionJobName is being saved correctly in RecordingMetadata table');
      return;
    }

    console.log('[TranscriptionComplete] ✅ Found recording metadata');
    console.log('[TranscriptionComplete] Processing transcription for call:', recordingMetadata.callId);
    console.log('[TranscriptionComplete] Agent ID:', recordingMetadata.agentId || 'none');
    console.log('[TranscriptionComplete] Clinic ID:', recordingMetadata.clinicId);

    // Download and parse transcription
    const transcript = await downloadTranscript(transcriptUri);
    
    if (!transcript) {
      console.error('[TranscriptionComplete] Failed to download transcript from:', transcriptUri);
      return;
    }

    console.log('[TranscriptionComplete] ✅ Downloaded transcript, length:', transcript.length);

    // Save transcript to recording metadata (even if sentiment analysis fails)
    await saveTranscriptText(recordingMetadata, transcript);

    // Perform sentiment analysis on the transcript
    console.log('[TranscriptionComplete] Starting sentiment analysis...');
    const sentimentResult = await analyzeSentiment(transcript);
    console.log('[TranscriptionComplete] ✅ Sentiment analysis complete:', sentimentResult.sentiment);

    // Update recording metadata with sentiment
    console.log('[TranscriptionComplete] Updating recording metadata...');
    await updateRecordingMetadata(recordingMetadata, sentimentResult);
    console.log('[TranscriptionComplete] ✅ Recording metadata updated');

    // Update call record with sentiment
    console.log('[TranscriptionComplete] Updating call record...');
    await updateCallRecord(recordingMetadata.callId, sentimentResult);
    console.log('[TranscriptionComplete] ✅ Call record updated');

    // Update CallAnalytics table with sentiment and transcript
    if (CALL_ANALYTICS_TABLE_NAME) {
      console.log('[TranscriptionComplete] Updating CallAnalytics table...');
      await updateCallAnalytics(recordingMetadata.callId, transcript, sentimentResult);
      console.log('[TranscriptionComplete] ✅ CallAnalytics table updated');
    }

    // Update agent performance metrics
    if (recordingMetadata.agentId) {
      console.log('[TranscriptionComplete] Updating agent performance...');
      await updateAgentPerformance(
        recordingMetadata.agentId,
        recordingMetadata.clinicId,
        recordingMetadata.callId,
        sentimentResult
      );
      console.log('[TranscriptionComplete] ✅ Agent performance updated');
    } else {
      console.warn('[TranscriptionComplete] No agent ID found, skipping agent performance update');
    }

    console.log('[TranscriptionComplete] ✅ Successfully processed transcription for call:', recordingMetadata.callId);
    console.log('[TranscriptionComplete] ===== END PROCESSING =====');

  } catch (error) {
    console.error('[TranscriptionComplete] ❌ ERROR processing transcription:', error);
    console.error('[TranscriptionComplete] Error details:', JSON.stringify(error, null, 2));
    throw error;
  }
};

/**
 * Find recording metadata by transcription job name
 * Includes fallback to find by callId if GSI query fails (eventual consistency)
 */
async function findRecordingByJobName(jobName: string): Promise<any | null> {
  try {
    // Try GSI query first
    console.log('[TranscriptionComplete] Querying by job name:', jobName);
    const result = await ddb.send(new QueryCommand({
      TableName: RECORDING_METADATA_TABLE,
      IndexName: 'transcriptionJobName-index',
      KeyConditionExpression: 'transcriptionJobName = :jobName',
      ExpressionAttributeValues: {
        ':jobName': jobName,
      },
      Limit: 1,
    }));

    if (result.Items?.[0]) {
      console.log('[TranscriptionComplete] Found recording via GSI');
      return result.Items[0];
    }

    // Fallback: Extract callId from job name and search by callId
    // Job name format: transcription-{callId}-{uuid}
    const match = jobName.match(/^transcription-(.+?)-[a-f0-9]{8}$/);
    if (match) {
      const callId = match[1];
      console.log('[TranscriptionComplete] GSI returned no results, trying callId fallback:', callId);
      
      const callIdResult = await ddb.send(new QueryCommand({
        TableName: RECORDING_METADATA_TABLE,
        IndexName: 'callId-index',
        KeyConditionExpression: 'callId = :callId',
        ExpressionAttributeValues: {
          ':callId': callId,
        },
        Limit: 1,
      }));

      if (callIdResult.Items?.[0]) {
        console.log('[TranscriptionComplete] Found recording via callId fallback');
        return callIdResult.Items[0];
      }
    }

    console.error('[TranscriptionComplete] Recording not found via GSI or callId fallback');
    return null;

  } catch (error) {
    console.error('[TranscriptionComplete] Error finding recording by job name:', error);
    return null;
  }
}

/**
 * Download transcript from S3
 * Handles both S3 URIs (s3://bucket/key) and HTTPS URLs from AWS Transcribe
 */
async function downloadTranscript(transcriptUri: string): Promise<string | null> {
  try {
    let bucket: string;
    let key: string;

    // Parse S3 URI (s3://bucket/key format)
    const s3Match = transcriptUri.match(/s3:\/\/([^\/]+)\/(.+)/);
    if (s3Match) {
      [, bucket, key] = s3Match;
    }
    // Virtual-hosted style: https://bucket.s3.region.amazonaws.com/key
    // or                    https://bucket.s3.amazonaws.com/key
    else {
      const virtualHostedMatch = transcriptUri.match(
        /https:\/\/([^.]+)\.s3(?:[.-][^.]+)?\.amazonaws\.com\/(.+)/
      );
      // Path-style: https://s3.region.amazonaws.com/bucket/key
      //          or https://s3-region.amazonaws.com/bucket/key
      //          or https://s3.amazonaws.com/bucket/key
      const pathStyleMatch = !virtualHostedMatch
        ? transcriptUri.match(/https:\/\/s3[^.]*\.amazonaws\.com\/([^\/]+)\/(.+)/)
        : null;

      if (virtualHostedMatch) {
        [, bucket, key] = virtualHostedMatch;
      } else if (pathStyleMatch) {
        [, bucket, key] = pathStyleMatch;
      } else {
        console.error('[TranscriptionComplete] Invalid transcript URI format:', transcriptUri);
        console.error('[TranscriptionComplete] Expected s3://, virtual-hosted, or path-style S3 URL');
        return null;
      }
    }

    console.log('[TranscriptionComplete] Downloading transcript from S3:', { bucket, key: key.substring(0, 50) + '...' });

    const response = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    const transcriptData = await response.Body?.transformToString();
    
    if (!transcriptData) {
      console.error('[TranscriptionComplete] Empty transcript data received');
      return null;
    }

    const parsed = JSON.parse(transcriptData);
    
    // Extract full transcript text
    const transcript = parsed.results?.transcripts?.[0]?.transcript || '';
    console.log('[TranscriptionComplete] Extracted transcript, length:', transcript.length);
    
    return transcript;

  } catch (error) {
    console.error('[TranscriptionComplete] Error downloading transcript:', error);
    return null;
  }
}

/**
 * Analyze sentiment of transcript using AWS Comprehend
 */
async function analyzeSentiment(transcript: string): Promise<{
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  sentimentScore: number;
  scores: {
    Positive: number;
    Negative: number;
    Neutral: number;
    Mixed: number;
  };
}> {
  try {
    // Split long transcripts into chunks (Comprehend has 5000 byte limit)
    const maxLength = 5000;
    const chunks: string[] = [];
    
    if (transcript.length <= maxLength) {
      chunks.push(transcript);
    } else {
      // Split by sentences to avoid cutting mid-sentence
      const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [transcript];
      let currentChunk = '';
      
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxLength) {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = sentence;
        } else {
          currentChunk += sentence;
        }
      }
      
      if (currentChunk) chunks.push(currentChunk);
    }

    // Analyze each chunk and aggregate results
    const results = await Promise.all(
      chunks.map(chunk =>
        comprehend.send(new DetectSentimentCommand({
          Text: chunk,
          LanguageCode: 'en',
        }))
      )
    );

    // Aggregate sentiment scores
    const aggregateScores = results.reduce(
      (acc, result) => ({
        Positive: acc.Positive + (result.SentimentScore?.Positive || 0),
        Negative: acc.Negative + (result.SentimentScore?.Negative || 0),
        Neutral: acc.Neutral + (result.SentimentScore?.Neutral || 0),
        Mixed: acc.Mixed + (result.SentimentScore?.Mixed || 0),
      }),
      { Positive: 0, Negative: 0, Neutral: 0, Mixed: 0 }
    );

    // Average the scores
    const count = results.length;
    const scores = {
      Positive: aggregateScores.Positive / count,
      Negative: aggregateScores.Negative / count,
      Neutral: aggregateScores.Neutral / count,
      Mixed: aggregateScores.Mixed / count,
    };

    // Determine overall sentiment (normalize to uppercase for consistency)
    const sentiment = Object.entries(scores).reduce((a, b) => 
      scores[a[0] as keyof typeof scores] > scores[b[0] as keyof typeof scores] ? a : b
    )[0].toUpperCase() as 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';

    // Calculate sentiment score (0-100, where 100 is most positive)
    const sentimentScore = Math.round(
      (scores.Positive * 100) + 
      (scores.Neutral * 50) + 
      (scores.Mixed * 50)
    );

    return { sentiment, sentimentScore, scores };

  } catch (error) {
    console.error('[TranscriptionComplete] Error analyzing sentiment:', error);
    
    // Return neutral sentiment on error
    return {
      sentiment: 'NEUTRAL',
      sentimentScore: 50,
      scores: { Positive: 0, Negative: 0, Neutral: 1, Mixed: 0 },
    };
  }
}

/**
 * Save transcript text to recording metadata (before sentiment analysis)
 */
async function saveTranscriptText(metadata: any, transcript: string): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: RECORDING_METADATA_TABLE,
      Key: {
        recordingId: metadata.recordingId,
        timestamp: metadata.timestamp,
      },
      UpdateExpression: `
        SET transcriptText = :text,
            transcriptionCompletedAt = :now,
            transcriptionStatus = :status
      `,
      ExpressionAttributeValues: {
        ':text': transcript.substring(0, 10000), // Limit to 10KB for DynamoDB
        ':now': new Date().toISOString(),
        ':status': 'COMPLETED',
      },
    }));
  } catch (error) {
    console.error('[TranscriptionComplete] Error saving transcript text:', error);
    // Don't throw - this is not critical
  }
}

/**
 * Update recording metadata with sentiment analysis results
 */
async function updateRecordingMetadata(metadata: any, sentimentResult: any): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: RECORDING_METADATA_TABLE,
    Key: {
      recordingId: metadata.recordingId,
      timestamp: metadata.timestamp,
    },
    UpdateExpression: `
      SET sentiment = :sentiment,
          sentimentScore = :score,
          sentimentScores = :scores,
          sentimentAnalyzedAt = :now
    `,
    ExpressionAttributeValues: {
      ':sentiment': sentimentResult.sentiment,
      ':score': sentimentResult.sentimentScore,
      ':scores': sentimentResult.scores,
      ':now': new Date().toISOString(),
    },
  }));
}

/**
 * Update call record with sentiment analysis
 */
async function updateCallRecord(callId: string, sentimentResult: any): Promise<void> {
  try {
    // Find call record by pstnCallId
    const result = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      IndexName: 'pstnCallId-index',
      KeyConditionExpression: 'pstnCallId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      Limit: 1,
    }));

    const callRecord = result.Items?.[0];
    
    if (!callRecord) {
      console.warn('[TranscriptionComplete] Call record not found:', callId);
      return;
    }

    await ddb.send(new UpdateCommand({
      TableName: CALL_QUEUE_TABLE_NAME,
      Key: {
        clinicId: callRecord.clinicId,
        queuePosition: callRecord.queuePosition,
      },
      UpdateExpression: `
        SET sentiment = :sentiment,
            sentimentScore = :score,
            sentimentScores = :scores
      `,
      ExpressionAttributeValues: {
        ':sentiment': sentimentResult.sentiment,
        ':score': sentimentResult.sentimentScore,
        ':scores': sentimentResult.scores,
      },
    }));

  } catch (error) {
    console.error('[TranscriptionComplete] Error updating call record:', error);
  }
}

/**
 * Update CallAnalytics table with sentiment and transcript from post-call transcription.
 * Finds the analytics record for the call and enriches it with data from Comprehend/Transcribe.
 */
async function updateCallAnalytics(
  callId: string,
  transcript: string,
  sentimentResult: { sentiment: string; sentimentScore: number; scores: Record<string, number> }
): Promise<void> {
  if (!CALL_ANALYTICS_TABLE_NAME) return;

  try {
    // Find the analytics record for this call
    const queryResult = await ddb.send(new QueryCommand({
      TableName: CALL_ANALYTICS_TABLE_NAME,
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: { ':callId': callId },
      ScanIndexForward: false,
      Limit: 1,
    }));

    const record = queryResult.Items?.[0];
    if (!record) {
      console.warn('[TranscriptionComplete] No CallAnalytics record found for callId:', callId);
      return;
    }

    // Determine category from transcript content
    const category = categorizeFromTranscript(transcript);

    // Update the analytics record with sentiment, category, and transcript
    await ddb.send(new UpdateCommand({
      TableName: CALL_ANALYTICS_TABLE_NAME,
      Key: { callId: record.callId, timestamp: record.timestamp },
      UpdateExpression: `
        SET overallSentiment = :sentiment,
            sentimentScore = :sentimentScore,
            callCategory = if_not_exists(callCategory, :category),
            fullTranscript = :transcript,
            transcriptCount = if_not_exists(transcriptCount, :one),
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':sentiment': sentimentResult.sentiment,
        ':sentimentScore': sentimentResult.sentimentScore,
        ':category': category,
        ':transcript': transcript.substring(0, 20000), // Limit to 20KB
        ':one': 1,
        ':now': new Date().toISOString(),
      },
      // Only update sentiment/category if they are missing or default
      ConditionExpression: 'attribute_exists(callId)',
    }));

    console.log(`[TranscriptionComplete] Updated CallAnalytics for ${callId}: sentiment=${sentimentResult.sentiment}, category=${category}`);
  } catch (error: any) {
    // ConditionalCheckFailed means record doesn't exist - that's fine
    if (error?.name === 'ConditionalCheckFailedException') {
      console.warn('[TranscriptionComplete] CallAnalytics record not found (condition failed):', callId);
      return;
    }
    console.error('[TranscriptionComplete] Error updating CallAnalytics:', error);
  }
}

/**
 * Simple rule-based categorization from transcript content.
 * Used as fallback when no real-time category was assigned.
 */
function categorizeFromTranscript(transcript: string): string {
  const lower = transcript.toLowerCase();
  
  const categories: Array<{ keywords: string[]; category: string }> = [
    { keywords: ['appointment', 'schedule', 'book', 'reschedule', 'cancel appointment', 'available time'], category: 'scheduling' },
    { keywords: ['insurance', 'coverage', 'copay', 'deductible', 'claim', 'in-network', 'out-of-network'], category: 'insurance' },
    { keywords: ['bill', 'payment', 'charge', 'balance', 'invoice', 'pay', 'cost', 'price', 'fee'], category: 'billing' },
    { keywords: ['emergency', 'pain', 'urgent', 'swelling', 'bleeding', 'broken tooth', 'toothache'], category: 'emergency' },
    { keywords: ['cleaning', 'checkup', 'exam', 'x-ray', 'filling', 'crown', 'root canal', 'extraction'], category: 'treatment' },
    { keywords: ['new patient', 'first visit', 'registration', 'new here'], category: 'new-patient' },
    { keywords: ['prescription', 'medication', 'antibiotic', 'pain medication'], category: 'prescription' },
    { keywords: ['referral', 'specialist', 'orthodontist', 'oral surgeon', 'periodontist'], category: 'referral' },
  ];

  let bestCategory = 'general-inquiry';
  let bestScore = 0;

  for (const { keywords, category } of categories) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

/**
 * Update agent performance metrics with sentiment data
 */
async function updateAgentPerformance(
  agentId: string,
  clinicId: string,
  callId: string,
  sentimentResult: any
): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Try to get existing performance record
    const existingRecord = await ddb.send(new GetCommand({
      TableName: AGENT_PERFORMANCE_TABLE_NAME,
      Key: {
        agentId,
        periodDate: today,
      },
    }));

    const existing = existingRecord.Item;

    // Increment sentiment counters based on result
    const sentimentIncrement: Record<string, number> = {
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0,
    };

    sentimentIncrement[sentimentResult.sentiment.toLowerCase()] = 1;

    if (existing) {
      // Update existing record
      await ddb.send(new UpdateCommand({
        TableName: AGENT_PERFORMANCE_TABLE_NAME,
        Key: {
          agentId,
          periodDate: today,
        },
        UpdateExpression: `
          SET sentimentScores.positive = sentimentScores.positive + :posInc,
              sentimentScores.neutral = sentimentScores.neutral + :neuInc,
              sentimentScores.negative = sentimentScores.negative + :negInc,
              sentimentScores.mixed = sentimentScores.mixed + :mixInc,
              averageSentiment = :newAvgSentiment,
              lastUpdated = :now,
              callIds = list_append(if_not_exists(callIds, :emptyList), :callId)
        `,
        ExpressionAttributeValues: {
          ':posInc': sentimentIncrement.positive,
          ':neuInc': sentimentIncrement.neutral,
          ':negInc': sentimentIncrement.negative,
          ':mixInc': sentimentIncrement.mixed,
          ':newAvgSentiment': calculateNewAverage(existing, sentimentResult.sentimentScore),
          ':now': new Date().toISOString(),
          ':emptyList': [],
          ':callId': [callId],
        },
      }));

    } else {
      // Create new record - this is a fallback; records should be created when calls complete
      console.log('[TranscriptionComplete] Creating new performance record for agent:', agentId);
      
      await ddb.send(new UpdateCommand({
        TableName: AGENT_PERFORMANCE_TABLE_NAME,
        Key: {
          agentId,
          periodDate: today,
        },
        UpdateExpression: `
          SET clinicId = if_not_exists(clinicId, :clinicId),
              totalCalls = if_not_exists(totalCalls, :zero),
              inboundCalls = if_not_exists(inboundCalls, :zero),
              outboundCalls = if_not_exists(outboundCalls, :zero),
              sentimentScores = if_not_exists(sentimentScores, :initialSentiment),
              averageSentiment = :sentimentScore,
              lastUpdated = :now,
              callIds = if_not_exists(callIds, :emptyList)
        `,
        ExpressionAttributeValues: {
          ':clinicId': clinicId,
          ':zero': 0,
          ':initialSentiment': {
            positive: sentimentIncrement.positive,
            neutral: sentimentIncrement.neutral,
            negative: sentimentIncrement.negative,
            mixed: sentimentIncrement.mixed,
          },
          ':sentimentScore': sentimentResult.sentimentScore,
          ':now': new Date().toISOString(),
          ':emptyList': [callId],
        },
      }));
    }

    console.log('[TranscriptionComplete] Updated agent performance for:', agentId, 'sentiment:', sentimentResult.sentiment);

  } catch (error) {
    console.error('[TranscriptionComplete] Error updating agent performance:', error);
  }
}

/**
 * Calculate new average sentiment score
 */
function calculateNewAverage(existing: any, newScore: number): number {
  const totalCallsWithSentiment = 
    (existing.sentimentScores?.positive || 0) +
    (existing.sentimentScores?.neutral || 0) +
    (existing.sentimentScores?.negative || 0) +
    (existing.sentimentScores?.mixed || 0);

  const currentTotal = (existing.averageSentiment || 50) * totalCallsWithSentiment;
  return Math.round((currentTotal + newScore) / (totalCallsWithSentiment + 1));
}


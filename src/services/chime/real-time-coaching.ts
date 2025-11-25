/**
 * Real-Time Coaching Lambda
 * 
 * Analyzes ongoing calls and provides real-time coaching suggestions to agents
 * Triggered by DynamoDB Streams from Call Analytics table
 */

import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const iot = new IoTDataPlaneClient({});

const AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME!;

interface CoachingSuggestion {
  type: 'POSITIVE' | 'WARNING' | 'INFO';
  category: string;
  message: string;
  priority: number; // 1-5, 5 being highest
}

/**
 * Main handler for real-time coaching
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  console.log('[RealTimeCoaching] Processing batch', {
    recordCount: event.Records.length
  });

  for (const record of event.Records) {
    try {
      await processCoachingRecord(record);
    } catch (err) {
      console.error('[RealTimeCoaching] Error processing record:', err);
      // Continue processing other records
    }
  }
};

async function processCoachingRecord(record: DynamoDBRecord): Promise<void> {
  // Only process MODIFY events (new transcript segments)
  if (record.eventName !== 'MODIFY') {
    return;
  }

  const newImage = record.dynamodb?.NewImage;
  const oldImage = record.dynamodb?.OldImage;

  if (!newImage) return;

  // Extract call data
  const callId = newImage.callId?.S;
  const agentId = newImage.agentId?.S;
  const transcriptCount = parseInt(newImage.transcriptCount?.N || '0');
  const oldTranscriptCount = parseInt(oldImage?.transcriptCount?.N || '0');
  const latestTranscripts = newImage.latestTranscripts?.L || [];
  const detectedIssues = newImage.detectedIssues?.L || [];
  const speakerMetrics = newImage.speakerMetrics?.M;

  // Only provide coaching if transcript updated
  if (transcriptCount === oldTranscriptCount || !agentId || !callId) {
    return;
  }

  const suggestions: CoachingSuggestion[] = [];

  // COACHING RULE 1: Agent talking too much
  const agentTalkPercentage = parseInt(speakerMetrics?.agentTalkPercentage?.N || '0');
  if (agentTalkPercentage > 70 && transcriptCount > 5) {
    suggestions.push({
      type: 'WARNING',
      category: 'TALK_TIME',
      message: 'You are talking more than 70% of the time. Try to listen more and ask open-ended questions.',
      priority: 4
    });
  } else if (agentTalkPercentage < 30 && transcriptCount > 5) {
    suggestions.push({
      type: 'INFO',
      category: 'TALK_TIME',
      message: 'Customer is doing most of the talking. Ensure you are providing helpful information.',
      priority: 2
    });
  }

  // COACHING RULE 2: Customer frustration detected
  const hasCustomerFrustration = detectedIssues.some(
    (issue: any) => issue.S === 'customer-frustration'
  );
  if (hasCustomerFrustration) {
    suggestions.push({
      type: 'WARNING',
      category: 'CUSTOMER_SENTIMENT',
      message: 'Customer frustration detected. Use empathetic language and acknowledge their concerns.',
      priority: 5
    });
  }

  // COACHING RULE 3: High interruption count
  const interruptionCount = parseInt(speakerMetrics?.interruptionCount?.N || '0');
  if (interruptionCount > 3) {
    suggestions.push({
      type: 'WARNING',
      category: 'INTERRUPTIONS',
      message: 'Multiple interruptions detected. Allow the customer to finish speaking.',
      priority: 4
    });
  }

  // COACHING RULE 4: Long silence periods
  const silencePeriods = parseInt(speakerMetrics?.silencePeriods?.N || '0');
  if (silencePeriods > 3) {
    suggestions.push({
      type: 'INFO',
      category: 'ENGAGEMENT',
      message: 'Multiple silence periods detected. Keep the conversation flowing with engaging questions.',
      priority: 3
    });
  }

  // COACHING RULE 5: Analyze recent sentiment trend
  const latestSentiment = newImage.latestSentiment?.L || [];
  if (latestSentiment.length >= 3) {
    const recentSentiments = latestSentiment.slice(-3);
    const negativeCount = recentSentiments.filter((s: any) => 
      s.M?.sentiment?.S === 'NEGATIVE'
    ).length;
    
    if (negativeCount >= 2) {
      suggestions.push({
        type: 'WARNING',
        category: 'SENTIMENT_TREND',
        message: 'Recent sentiment is declining. Consider offering solutions or escalating if needed.',
        priority: 4
      });
    }
  }

  // COACHING RULE 6: Positive reinforcement
  const overallSentiment = newImage.overallSentiment?.S;
  if (overallSentiment === 'POSITIVE' && transcriptCount > 5) {
    suggestions.push({
      type: 'POSITIVE',
      category: 'PERFORMANCE',
      message: 'Great job! Customer sentiment is positive. Keep up the good work!',
      priority: 2
    });
  }

  // COACHING RULE 7: Long call duration
  const callStartTime = newImage.callStartTime?.S;
  if (callStartTime) {
    const duration = (Date.now() - new Date(callStartTime).getTime()) / 1000 / 60; // minutes
    if (duration > 15) {
      suggestions.push({
        type: 'INFO',
        category: 'DURATION',
        message: 'Call duration is over 15 minutes. Consider summarizing and wrapping up.',
        priority: 3
      });
    }
  }

  // COACHING RULE 8: Escalation request
  const hasEscalationRequest = detectedIssues.some(
    (issue: any) => issue.S === 'escalation-request'
  );
  if (hasEscalationRequest) {
    suggestions.push({
      type: 'WARNING',
      category: 'ESCALATION',
      message: 'Customer requested escalation. Transfer to supervisor if unable to resolve.',
      priority: 5
    });
  }

  // Send top priority suggestions to agent
  if (suggestions.length > 0) {
    await sendCoachingSuggestions(callId, agentId, suggestions);
  }
}

/**
 * Send coaching suggestions to agent via IoT Core (WebSocket)
 */
async function sendCoachingSuggestions(
  callId: string,
  agentId: string,
  suggestions: CoachingSuggestion[]
): Promise<void> {
  // Sort by priority (highest first) and take top 2
  const topSuggestions = suggestions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 2);

  const message = {
    type: 'COACHING_SUGGESTION',
    callId,
    timestamp: new Date().toISOString(),
    suggestions: topSuggestions
  };

  try {
    // Publish to IoT topic for agent's dashboard
    await iot.send(new PublishCommand({
      topic: `coaching/agent/${agentId}`,
      payload: Buffer.from(JSON.stringify(message)),
      qos: 0 // At most once delivery
    }));

    console.log('[RealTimeCoaching] Sent suggestions to agent', {
      agentId,
      callId,
      count: topSuggestions.length
    });
  } catch (err) {
    console.error('[RealTimeCoaching] Error sending suggestions:', err);
  }

  // Also update agent presence table with latest coaching
  try {
    await ddb.send(new UpdateCommand({
      TableName: AGENT_PRESENCE_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET lastCoaching = :coaching, lastCoachingAt = :now',
      ExpressionAttributeValues: {
        ':coaching': topSuggestions,
        ':now': new Date().toISOString()
      }
    }));
  } catch (err) {
    console.error('[RealTimeCoaching] Error updating agent presence:', err);
  }
}

/**
 * Generate coaching summary for completed call
 */
export async function generateCallCoachingSummary(
  callAnalytics: any
): Promise<{ score: number; strengths: string[]; improvements: string[] }> {
  const strengths: string[] = [];
  const improvements: string[] = [];
  let score = 100;

  // Analyze agent performance
  const speakerMetrics = callAnalytics.speakerMetrics || {};
  const agentTalkPercentage = speakerMetrics.agentTalkPercentage || 0;
  const interruptionCount = speakerMetrics.interruptionCount || 0;
  const silencePercentage = speakerMetrics.silencePercentage || 0;
  const overallSentiment = callAnalytics.overallSentiment;
  const detectedIssues = callAnalytics.detectedIssues || [];

  // Evaluate talk time balance
  if (agentTalkPercentage >= 40 && agentTalkPercentage <= 60) {
    strengths.push('Good balance of listening and speaking');
  } else if (agentTalkPercentage > 70) {
    improvements.push('Listen more and allow customer to speak');
    score -= 10;
  } else if (agentTalkPercentage < 30) {
    improvements.push('Provide more guidance and information');
    score -= 5;
  }

  // Evaluate interruptions
  if (interruptionCount === 0) {
    strengths.push('Excellent active listening - no interruptions');
  } else if (interruptionCount <= 2) {
    strengths.push('Good listening skills');
  } else {
    improvements.push('Reduce interruptions - let customer finish speaking');
    score -= (interruptionCount * 3);
  }

  // Evaluate sentiment
  if (overallSentiment === 'POSITIVE') {
    strengths.push('Maintained positive customer sentiment');
    score += 10;
  } else if (overallSentiment === 'NEGATIVE') {
    improvements.push('Work on improving customer sentiment');
    score -= 15;
  }

  // Evaluate issues
  if (detectedIssues.includes('customer-frustration')) {
    improvements.push('Customer became frustrated - use more empathetic language');
    score -= 10;
  }
  if (detectedIssues.includes('escalation-request')) {
    improvements.push('Customer requested escalation - try to resolve issues earlier');
    score -= 5;
  }
  if (detectedIssues.includes('poor-audio-quality')) {
    improvements.push('Audio quality issues affected call - check equipment');
    score -= 5;
  }

  // Evaluate silence
  if (silencePercentage < 10) {
    strengths.push('Kept conversation engaging with minimal silence');
  } else if (silencePercentage > 25) {
    improvements.push('Reduce awkward silences - ask more questions');
    score -= 5;
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    strengths,
    improvements
  };
}


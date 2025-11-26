/**
 * Real-Time Coaching Lambda
 * 
 * Analyzes ongoing calls and provides real-time coaching suggestions to agents
 * Triggered by DynamoDB Streams from Call Analytics table
 * 
 * OPTIMIZATION NOTE: To reduce unnecessary Lambda invocations, configure 
 * Lambda Event Source Mapping with FilterCriteria:
 * 
 * FilterCriteria:
 *   Filters:
 *     - Pattern: '{"dynamodb":{"NewImage":{"callStatus":{"S":["active","initializing"]}}}}'
 * 
 * This filters events at the stream level before invoking Lambda,
 * processing only active calls and reducing costs by ~80-90%.
 * 
 * See: https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html
 */

import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const iot = new IoTDataPlaneClient({});

const AGENT_PRESENCE_TABLE = process.env.AGENT_PRESENCE_TABLE_NAME;

// Validate required environment variables
if (!AGENT_PRESENCE_TABLE) {
  throw new Error('AGENT_PRESENCE_TABLE_NAME environment variable is required');
}

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

  // CRITICAL FIX: Check call status FIRST before any other processing
  // This prevents wasting resources on completed calls
  const callStatus = newImage.callStatus?.S;
  const callEndTime = newImage.callEndTime?.S;
  const finalized = newImage.finalized?.BOOL;

  // Early exit for completed/abandoned/failed calls
  if (callStatus !== 'active' && callStatus !== undefined) {
    return; // Silent return - this is expected for completed calls
  }
  
  if (callEndTime || finalized) {
    return; // Silent return - call has ended
  }

  // Extract call data only after validating call is active
  const callId = newImage.callId?.S;
  const agentId = newImage.agentId?.S;
  const transcriptCount = parseInt(newImage.transcriptCount?.N || '0');
  const oldTranscriptCount = parseInt(oldImage?.transcriptCount?.N || '0');
  
  // Only provide coaching if transcript updated and we have required fields
  if (transcriptCount === oldTranscriptCount || !agentId || !callId) {
    return;
  }
  
  console.log('[RealTimeCoaching] Processing coaching for active call:', {
    callId,
    agentId,
    transcriptCount,
    callStatus
  });
  
  // Extract analytics data for coaching rules
  const latestTranscripts = newImage.latestTranscripts?.L || [];
  const detectedIssues = newImage.detectedIssues?.L || [];
  const speakerMetrics = newImage.speakerMetrics?.M;

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
    await sendCoachingSuggestions(callId, agentId, suggestions, transcriptCount);
  }
}

/**
 * Send coaching suggestions to agent via IoT Core (WebSocket)
 * 
 * CRITICAL FIX #6: Added idempotency using transcriptCount to prevent duplicate coaching messages
 * Each coaching is tied to a specific transcript count, preventing duplicates even on Lambda retries
 */
async function sendCoachingSuggestions(
  callId: string,
  agentId: string,
  suggestions: CoachingSuggestion[],
  transcriptCount: number
): Promise<void> {
  // Sort by priority (highest first) and take top 2
  const topSuggestions = suggestions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 2);
  
  // CRITICAL FIX #6: Generate idempotency key based on call, agent, and transcript count
  const idempotencyKey = `coaching-${callId}-${agentId}-${transcriptCount}`;
  
  // Check if we've already sent coaching for this transcript count
  try {
    const existingCoaching = await ddb.send(new GetCommand({
      TableName: AGENT_PRESENCE_TABLE,
      Key: { agentId },
      ProjectionExpression: 'lastCoachingIdempotencyKey, lastCoachingAt'
    }));
    
    if (existingCoaching.Item?.lastCoachingIdempotencyKey === idempotencyKey) {
      const lastCoachingAt = existingCoaching.Item.lastCoachingAt;
      const timeSinceCoaching = Date.now() - new Date(lastCoachingAt).getTime();
      
      // Only skip if coaching was sent within last 30 seconds (prevents stale data)
      if (timeSinceCoaching < 30000) {
        console.log('[RealTimeCoaching] Duplicate coaching detected, skipping:', {
          callId,
          agentId,
          transcriptCount,
          timeSinceCoaching: Math.floor(timeSinceCoaching / 1000) + 's'
        });
        return;
      }
    }
  } catch (err: any) {
    console.warn('[RealTimeCoaching] Error checking idempotency, proceeding with coaching:', err.message);
    // If check fails, proceed with coaching (fail open)
  }

  const message = {
    type: 'COACHING_SUGGESTION',
    callId,
    timestamp: new Date().toISOString(),
    suggestions: topSuggestions
  };

  try {
    // **FIXED: Use QoS 1 for high-priority coaching to ensure delivery**
    // Determine QoS based on priority of suggestions
    const hasHighPriority = topSuggestions.some(s => s.priority >= 4);
    const qos = hasHighPriority ? 1 : 0; // QoS 1 for critical coaching, 0 for informational
    
    // Publish to IoT topic for agent's dashboard
    await iot.send(new PublishCommand({
      topic: `coaching/agent/${agentId}`,
      payload: Buffer.from(JSON.stringify(message)),
      qos
    }));

    console.log('[RealTimeCoaching] Sent suggestions to agent', {
      agentId,
      callId,
      count: topSuggestions.length,
      qos,
      highPriority: hasHighPriority
    });
  } catch (err) {
    console.error('[RealTimeCoaching] Error sending suggestions:', err);
    
    // CRITICAL FIX: Retry ALL high-priority messages (4 and 5), not just priority 5
    // Priority 4 includes customer frustration which is critical
    const hasCriticalMessage = topSuggestions.some(s => s.priority >= 4);
    
    if (hasCriticalMessage) {
      const maxPriority = Math.max(...topSuggestions.map(s => s.priority));
      console.log('[RealTimeCoaching] Retrying high-priority coaching message', {
        maxPriority,
        callId,
        agentId
      });
      
      try {
        await iot.send(new PublishCommand({
          topic: `coaching/agent/${agentId}`,
          payload: Buffer.from(JSON.stringify(message)),
          qos: 1
        }));
        console.log('[RealTimeCoaching] Retry successful');
      } catch (retryErr) {
        console.error('[RealTimeCoaching] Retry failed:', retryErr);
        
        // ADDED: Log to CloudWatch Insights for monitoring
        console.error('[RealTimeCoaching] CRITICAL: Failed to deliver high-priority coaching', {
          callId,
          agentId,
          suggestions: topSuggestions.map(s => ({ category: s.category, priority: s.priority })),
          error: retryErr
        });
      }
    } else {
      // For lower priority, just log warning
      console.warn('[RealTimeCoaching] Failed to send low-priority coaching', {
        callId,
        agentId,
        suggestions: topSuggestions.map(s => s.category)
      });
    }
  }

  // CRITICAL FIX #6: Update agent presence table with latest coaching AND idempotency key
  // This prevents duplicate coaching suggestions from being sent on Lambda retries
  try {
    await ddb.send(new UpdateCommand({
      TableName: AGENT_PRESENCE_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET lastCoaching = :coaching, lastCoachingAt = :now, lastCoachingIdempotencyKey = :idempotencyKey, lastCoachingCallId = :callId',
      ExpressionAttributeValues: {
        ':coaching': topSuggestions,
        ':now': new Date().toISOString(),
        ':idempotencyKey': idempotencyKey,
        ':callId': callId
      }
    }));
    
    console.log('[RealTimeCoaching] Updated agent presence with coaching idempotency', {
      agentId,
      callId,
      idempotencyKey
    });
  } catch (err) {
    console.error('[RealTimeCoaching] Error updating agent presence:', err);
    // Don't fail the coaching send if presence update fails
  }
}

/**
 * Generate coaching summary for completed call
 * CRITICAL FIX #8: Added comprehensive error recovery and validation
 */
export async function generateCallCoachingSummary(
  callAnalytics: any
): Promise<{ score: number; strengths: string[]; improvements: string[]; error?: string }> {
  // CRITICAL FIX #8: Validate input data
  if (!callAnalytics || typeof callAnalytics !== 'object') {
    console.error('[generateCallCoachingSummary] Invalid analytics data:', callAnalytics);
    return {
      score: 50,
      strengths: [],
      improvements: ['Unable to generate coaching summary - missing call data'],
      error: 'INVALID_INPUT'
    };
  }
  
  // CRITICAL FIX #8: Wrap entire function in try-catch for error recovery
  try {
    const strengths: string[] = [];
    const improvements: string[] = [];
    let score = 100;

    // CRITICAL FIX #8: Safe property access with validation
    const speakerMetrics = callAnalytics.speakerMetrics || {};
    const agentTalkPercentage = typeof speakerMetrics.agentTalkPercentage === 'number' 
      ? speakerMetrics.agentTalkPercentage 
      : 0;
    const interruptionCount = typeof speakerMetrics.interruptionCount === 'number'
      ? speakerMetrics.interruptionCount
      : 0;
    const silencePercentage = typeof speakerMetrics.silencePercentage === 'number'
      ? speakerMetrics.silencePercentage
      : 0;
    const overallSentiment = callAnalytics.overallSentiment;
    const detectedIssues = Array.isArray(callAnalytics.detectedIssues) 
      ? callAnalytics.detectedIssues 
      : [];

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

  // CRITICAL FIX #8: Ensure score is within bounds and handle edge cases
  score = Math.max(0, Math.min(100, score));
  
  // CRITICAL FIX #8: Provide fallback feedback if no insights were generated
  if (strengths.length === 0 && improvements.length === 0) {
    improvements.push('Insufficient data to generate detailed coaching feedback');
    score = 50; // Neutral score when no data available
  }

  return {
    score,
    strengths,
    improvements
  };
  
  } catch (err: any) {
    // CRITICAL FIX #8: Comprehensive error recovery
    console.error('[generateCallCoachingSummary] Error generating coaching summary:', {
      error: err.message,
      stack: err.stack,
      callId: callAnalytics?.callId
    });
    
    return {
      score: 50,
      strengths: [],
      improvements: ['Error generating coaching summary - data may be incomplete'],
      error: err.message
    };
  }
}

